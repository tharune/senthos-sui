/* eslint-disable */
/**
 * REAL USDC on-chain test (devnet). Actually moves USDC.
 *
 * This is the production counterpart to test-onchain.cjs. Instead of
 * simulating, it:
 *
 *   1. Loads AUTHORITY_KEYPAIR from the path in .env (Victor's Mac keypair).
 *   2. Checks the authority's SOL + USDC balance on devnet.
 *      - If SOL < 0.01: prints airdrop instructions and exits.
 *      - If USDC < 1: prints the Circle faucet URL + authority pubkey and
 *        exits so Victor can fund it from the browser.
 *   3. If init_mock_adapter hasn't run on-chain yet, runs it with the
 *      authority as the signer (real tx).
 *   4. Builds a real initialize_note tx depositing 1 USDC into the mock
 *      Meteora adapter, signed by the authority.
 *   5. Sends via sendRawTransaction and confirms.
 *   6. Prints the Solscan URL so Victor can verify the USDC transfer
 *      actually landed on-chain.
 *   7. Fetches the PpnNote PDA and verifies principal_usdc, owner, and
 *      maturity_ts match what we sent.
 *
 * Usage: run from backend/ via `node test-real-usdc.cjs` or via the wrapper
 * 38-real-usdc-test.command on macOS.
 */

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const os = require("os");
const {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  LAMPORTS_PER_SOL,
  TransactionMessage,
  VersionedTransaction,
  ComputeBudgetProgram,
} = require("@solana/web3.js");
const {
  AnchorProvider,
  Program,
  Wallet,
  BN,
} = require("@coral-xyz/anchor");
const {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  getAccount,
} = require("@solana/spl-token");

const RPC_URL = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
const PPN_PROGRAM_ID = new PublicKey(process.env.TRAXIS_PPN_PROGRAM_ID);
const VAULT_PROGRAM_ID = new PublicKey(process.env.TRAXIS_VAULT_PROGRAM_ID);
const USDC_MINT = new PublicKey(process.env.USDC_MINT);

const AUTH_PATH_RAW = process.env.AUTHORITY_KEYPAIR;
if (!AUTH_PATH_RAW) {
  console.error("❌ AUTHORITY_KEYPAIR missing in .env");
  process.exit(1);
}
const AUTH_PATH = AUTH_PATH_RAW.startsWith("~")
  ? path.join(os.homedir(), AUTH_PATH_RAW.slice(1))
  : AUTH_PATH_RAW;

const IDL_DIR = path.join(__dirname, "src", "idl");
const ppnIdl = JSON.parse(
  fs.readFileSync(path.join(IDL_DIR, "traxis_ppn.json"), "utf-8"),
);
ppnIdl.address = PPN_PROGRAM_ID.toBase58();

function explorerTx(sig) {
  return `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
}
function explorerAcct(a) {
  return `https://explorer.solana.com/address/${a}?cluster=devnet`;
}
function solscanTx(sig) {
  return `https://solscan.io/tx/${sig}?cluster=devnet`;
}
function solscanAcct(a) {
  return `https://solscan.io/account/${a}?cluster=devnet`;
}

function derivePpnAdapter() {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("meteora_mock")],
    PPN_PROGRAM_ID,
  );
}
function derivePpnPool() {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("meteora_mock_pool")],
    PPN_PROGRAM_ID,
  );
}
function derivePpnNote(owner, seed8) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("ppn"), owner.toBuffer(), seed8],
    PPN_PROGRAM_ID,
  );
}
function randomSeed8() {
  const b = Buffer.alloc(8);
  for (let i = 0; i < 8; i++) b[i] = Math.floor(Math.random() * 256);
  return b;
}

function loadKeypair(p) {
  const raw = JSON.parse(fs.readFileSync(p, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

async function getUsdcBalance(conn, owner) {
  const ata = getAssociatedTokenAddressSync(USDC_MINT, owner);
  try {
    const info = await getAccount(conn, ata);
    return { ata, amount: BigInt(info.amount.toString()), exists: true };
  } catch (e) {
    return { ata, amount: 0n, exists: false };
  }
}

(async () => {
  console.log("===========================================================");
  console.log("  Traxis PPN — REAL USDC test (devnet)");
  console.log("===========================================================");
  console.log(`RPC:            ${RPC_URL}`);
  console.log(`PPN program:    ${PPN_PROGRAM_ID.toBase58()}`);
  console.log(`Vault program:  ${VAULT_PROGRAM_ID.toBase58()}`);
  console.log(`USDC mint:      ${USDC_MINT.toBase58()}`);
  console.log("");

  // --- 1. Load authority ---
  if (!fs.existsSync(AUTH_PATH)) {
    console.error(`❌ AUTHORITY_KEYPAIR not found at: ${AUTH_PATH}`);
    console.error(`   Edit backend/.env to point at your funded devnet keypair`);
    console.error(`   (usually ~/.config/solana/id.json).`);
    process.exit(1);
  }
  const authority = loadKeypair(AUTH_PATH);
  const authPk = authority.publicKey;
  console.log(`[authority] ${authPk.toBase58()}`);
  console.log(`            ${solscanAcct(authPk.toBase58())}`);
  console.log("");

  const conn = new Connection(RPC_URL, "confirmed");

  // --- 2. Balance checks ---
  console.log("[step 1] Balance checks");
  const solLamports = await conn.getBalance(authPk, "confirmed");
  const solBalance = solLamports / LAMPORTS_PER_SOL;
  console.log(`  SOL:  ${solBalance.toFixed(6)}`);

  const { ata: authUsdcAta, amount: usdcRaw, exists: usdcAtaExists } =
    await getUsdcBalance(conn, authPk);
  const usdcBalance = Number(usdcRaw) / 1_000_000;
  console.log(
    `  USDC: ${usdcBalance.toFixed(6)} (ata: ${authUsdcAta.toBase58()}, exists=${usdcAtaExists})`,
  );
  console.log("");

  if (solBalance < 0.01) {
    console.log("❌ Authority needs SOL to pay tx fees. Airdrop some:");
    console.log(`   solana airdrop 1 ${authPk.toBase58()} --url devnet`);
    console.log(`   (Or use: https://faucet.solana.com)`);
    process.exit(2);
  }

  if (usdcRaw < 1_000_000n) {
    console.log("❌ Authority needs devnet USDC to deposit. Request from Circle:");
    console.log(`   1. Open: https://faucet.circle.com/`);
    console.log(`   2. Network: Solana Devnet`);
    console.log(`   3. Address: ${authPk.toBase58()}`);
    console.log(`   4. Request 10 USDC (or whatever; test only needs 1).`);
    console.log(`   5. Re-run this script.`);
    console.log("");
    console.log(`   USDC ATA expected: ${authUsdcAta.toBase58()}`);
    console.log(`   USDC mint:         ${USDC_MINT.toBase58()}`);
    process.exit(3);
  }
  console.log("✅ Authority has enough SOL + USDC to run the real deposit.\n");

  // --- 3. Anchor program (signer = authority) ---
  const provider = new AnchorProvider(conn, new Wallet(authority), {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
    skipPreflight: false,
  });
  const program = new Program(ppnIdl, provider);

  // --- 4. Ensure adapter initialized on-chain ---
  console.log("[step 2] Mock adapter state");
  const [adapterPda] = derivePpnAdapter();
  const [adapterPool] = derivePpnPool();
  console.log(`  adapter PDA: ${adapterPda.toBase58()}`);
  console.log(`  pool PDA:    ${adapterPool.toBase58()}`);

  let adapterInfo = await conn.getAccountInfo(adapterPda);
  if (!adapterInfo) {
    console.log("  [status] NOT INITIALIZED — running real initialize_mock_adapter tx");
    const ix = await program.methods
      .initializeMockAdapter(800)
      .accounts({
        authority: authPk,
        adapter: adapterPda,
        usdcMint: USDC_MINT,
        usdcPool: adapterPool,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .instruction();

    const bh = await conn.getLatestBlockhash("confirmed");
    const msg = new TransactionMessage({
      payerKey: authPk,
      recentBlockhash: bh.blockhash,
      instructions: [
        ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
        ix,
      ],
    }).compileToV0Message();
    const tx = new VersionedTransaction(msg);
    tx.sign([authority]);

    const sig = await conn.sendRawTransaction(tx.serialize(), {
      skipPreflight: false,
      maxRetries: 3,
    });
    console.log(`  sent. sig=${sig}`);
    console.log(`  ${solscanTx(sig)}`);
    const conf = await conn.confirmTransaction(
      {
        signature: sig,
        blockhash: bh.blockhash,
        lastValidBlockHeight: bh.lastValidBlockHeight,
      },
      "confirmed",
    );
    if (conf.value.err) {
      console.log(`  ❌ confirm error: ${JSON.stringify(conf.value.err)}`);
      process.exit(4);
    }
    console.log("  ✅ adapter initialized on-chain.");
    adapterInfo = await conn.getAccountInfo(adapterPda);
  } else {
    const a = await program.account.meteoraMockAdapter.fetch(adapterPda);
    console.log(
      `  [status] already live. apyBps=${a.apyBps}, totalPrincipal=${a.totalPrincipal.toString()}`,
    );
  }
  console.log("");

  // --- 5. Pre-deposit balances ---
  console.log("[step 3] Pre-deposit balances");
  const authUsdcBefore = (await getUsdcBalance(conn, authPk)).amount;
  let poolUsdcBefore = 0n;
  try {
    const poolInfo = await getAccount(conn, adapterPool);
    poolUsdcBefore = BigInt(poolInfo.amount.toString());
  } catch (_) {
    // pool ATA may not exist yet if adapter never held funds
  }
  console.log(`  authority USDC: ${authUsdcBefore.toString()}`);
  console.log(`  adapter pool:   ${poolUsdcBefore.toString()}`);
  console.log("");

  // --- 6. Build and send real initialize_note ---
  console.log("[step 4] Send real initialize_note (deposit 1 USDC)");
  const noteSeed = randomSeed8();
  const [notePda] = derivePpnNote(authPk, noteSeed);
  // trax_vault and trax_mint aren't verified by initialize_note (not PDA-
  // constrained in the IDL). Pass any existing pubkeys. Using USDC mint as
  // trax_mint placeholder and authority pubkey as trax_vault — both are
  // real, initialized accounts on devnet.
  const fakeTraxMint = USDC_MINT;
  const fakeTraxVault = authPk;

  const principal = 1_000_000n; // 1 USDC
  const maturityTs = Math.floor(Date.now() / 1000) + 120; // 2 min maturity

  const ix = await program.methods
    .initializeNote({
      noteSeed: Array.from(noteSeed),
      principalUsdc: new BN(principal.toString()),
      maturityTs: new BN(maturityTs),
    })
    .accounts({
      owner: authPk,
      note: notePda,
      adapter: adapterPda,
      adapterPool,
      usdcMint: USDC_MINT,
      ownerUsdcAta: authUsdcAta,
      traxVault: fakeTraxVault,
      traxMint: fakeTraxMint,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .instruction();

  const bh = await conn.getLatestBlockhash("confirmed");
  const msg = new TransactionMessage({
    payerKey: authPk,
    recentBlockhash: bh.blockhash,
    instructions: [
      ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000 }),
      ix,
    ],
  }).compileToV0Message();
  const tx = new VersionedTransaction(msg);
  tx.sign([authority]);

  console.log(`  note PDA:   ${notePda.toBase58()}`);
  console.log(`  seed (hex): ${noteSeed.toString("hex")}`);
  console.log(`  principal:  ${principal.toString()} (1.000000 USDC)`);
  console.log(`  maturity:   ${maturityTs} (${new Date(maturityTs * 1000).toISOString()})`);
  console.log("");

  let sig;
  try {
    sig = await conn.sendRawTransaction(tx.serialize(), {
      skipPreflight: false,
      maxRetries: 3,
    });
  } catch (e) {
    console.log(`  ❌ sendRawTransaction failed: ${e.message}`);
    if (e.logs) for (const l of e.logs.slice(0, 30)) console.log(`    ${l}`);
    process.exit(5);
  }
  console.log(`  sent. sig=${sig}`);
  console.log(`  Solscan:  ${solscanTx(sig)}`);
  console.log(`  Explorer: ${explorerTx(sig)}`);

  const conf = await conn.confirmTransaction(
    {
      signature: sig,
      blockhash: bh.blockhash,
      lastValidBlockHeight: bh.lastValidBlockHeight,
    },
    "confirmed",
  );
  if (conf.value.err) {
    console.log(`  ❌ confirm error: ${JSON.stringify(conf.value.err)}`);
    process.exit(6);
  }
  console.log("  ✅ tx confirmed.\n");

  // --- 7. Post-deposit balances ---
  console.log("[step 5] Post-deposit balances — USDC actually moved?");
  const authUsdcAfter = (await getUsdcBalance(conn, authPk)).amount;
  let poolUsdcAfter = 0n;
  try {
    const poolInfo = await getAccount(conn, adapterPool);
    poolUsdcAfter = BigInt(poolInfo.amount.toString());
  } catch (_) {}
  const authDelta = authUsdcAfter - authUsdcBefore;
  const poolDelta = poolUsdcAfter - poolUsdcBefore;
  console.log(`  authority USDC: ${authUsdcBefore.toString()} → ${authUsdcAfter.toString()}  (Δ ${authDelta.toString()})`);
  console.log(`  adapter pool:   ${poolUsdcBefore.toString()} → ${poolUsdcAfter.toString()}  (Δ +${poolDelta.toString()})`);

  if (authDelta === -principal && poolDelta === principal) {
    console.log("  ✅ Balances prove exactly 1 USDC moved authority → adapter pool.");
  } else {
    console.log("  ⚠️  Balance delta didn't match expected 1_000_000. Something's off.");
  }
  console.log("");

  // --- 8. Fetch & verify PpnNote ---
  console.log("[step 6] Verify on-chain PpnNote account");
  const note = await program.account.ppnNote.fetch(notePda);
  console.log(`  owner:         ${note.owner.toBase58()}`);
  console.log(`  principalUsdc: ${note.principalUsdc.toString()}`);
  console.log(`  maturityTs:    ${note.maturityTs.toString()}`);
  console.log(`  traxVault:     ${note.traxVault.toBase58()}`);
  console.log(`  traxMint:      ${note.traxMint.toBase58()}`);
  console.log(`  state:         ${JSON.stringify(note.state)}`);
  console.log(`  Solscan:       ${solscanAcct(notePda.toBase58())}`);

  // Anchor serialises the PpnState enum as an object with one key —
  // { active: {} } for Active, { redeemed: {} } for Redeemed.
  const isActive = note.state && Object.prototype.hasOwnProperty.call(note.state, "active");

  const ok =
    note.owner.equals(authPk) &&
    note.principalUsdc.toString() === principal.toString() &&
    note.maturityTs.toNumber() === maturityTs &&
    isActive;
  if (ok) {
    console.log("  ✅ Note account matches expected state.");
  } else {
    console.log("  ❌ Note account mismatch.");
    process.exit(7);
  }
  console.log("");

  console.log("===========================================================");
  console.log("  REAL USDC TEST — PASSED");
  console.log("===========================================================");
  console.log(`  Tx signature:  ${sig}`);
  console.log(`  Solscan:       ${solscanTx(sig)}`);
  console.log(`  PpnNote PDA:   ${notePda.toBase58()}`);
  console.log(`  Open in Solscan to see the USDC transfer in inner ixs.`);
  console.log("");
})().catch((e) => {
  console.error("FATAL:", e);
  if (e.logs) {
    for (const l of e.logs.slice(0, 40)) console.error(`  ${l}`);
  }
  process.exit(1);
});

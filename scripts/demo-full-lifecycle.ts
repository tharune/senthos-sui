/**
 * End-to-end devnet smoke test that exercises the full Traxis lifecycle:
 *
 *   1. Pick a random active bundle with an onchain vault.
 *   2. Simulate a deposit from a freshly-generated wallet.
 *   3. Resolve every leg as Won (via admin CPI).
 *   4. Finalize the vault.
 *   5. Redeem all TRAX for USDC.
 *
 * Run this before the judge demo to confirm the live devnet stack is healthy.
 *
 *   cd backend && npm install
 *   cd .. && npx tsx scripts/demo-full-lifecycle.ts
 */
import * as dotenv from "dotenv";
import * as path from "path";
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
  getAccount,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  createMint,
} from "@solana/spl-token";

dotenv.config({ path: path.join(__dirname, "..", "backend", ".env") });

import { supabase } from "../backend/src/db/supabase";
import {
  getConfig,
  getConnection,
  getVaultProgram,
  getProvider,
} from "../backend/src/solana/anchor";
import {
  adminWithdrawFees,
  buildDepositTx,
  buildRedeemTx,
  finalizeVault,
  getVaultState,
  resolveLeg,
} from "../backend/src/services/solana";

async function main() {
  const cfg = getConfig();
  const conn = getConnection();

  // Find a bundle with an onchain vault.
  const { data: bundles } = await supabase
    .from("bundles")
    .select("id, name, vault_pda, trax_mint")
    .not("vault_pda", "is", null)
    .eq("status", "active")
    .limit(1);
  if (!bundles || bundles.length === 0) {
    throw new Error("No onchain-initialized bundle found; run scripts/init-demo-vaults.ts");
  }
  const bundle = bundles[0];
  console.log(`Using bundle: ${bundle.name} (${bundle.id})`);

  // Create a throwaway user wallet and fund it.
  const user = Keypair.generate();
  console.log(`Demo wallet: ${user.publicKey.toBase58()}`);
  const sig = await conn.requestAirdrop(user.publicKey, 2 * LAMPORTS_PER_SOL);
  await conn.confirmTransaction(sig, "confirmed");

  // Mint fake USDC to the user. This assumes the configured USDC_MINT is one
  // where the authority keypair is also the mint authority (typical of a dev
  // setup). If using Circle devnet USDC this step needs to be replaced by a
  // faucet call.
  const userUsdcAta = (
    await getOrCreateAssociatedTokenAccount(
      conn,
      cfg.authorityKeypair,
      cfg.usdcMint,
      user.publicKey,
    )
  ).address;
  try {
    await mintTo(
      conn,
      cfg.authorityKeypair,
      cfg.usdcMint,
      userUsdcAta,
      cfg.authorityKeypair,
      500_000_000, // 500 USDC
    );
    console.log(`  minted 500 mock USDC to user`);
  } catch (err) {
    console.warn(
      `  could not mint to user (USDC mint authority may not be our wallet): ${err}`,
    );
  }

  // 1. Build + submit a deposit tx.
  const built = await buildDepositTx(user.publicKey, bundle.id, 100_000_000n);
  const { VersionedTransaction } = await import("@solana/web3.js");
  const tx = VersionedTransaction.deserialize(
    Buffer.from(built.transactionBase64, "base64"),
  );
  tx.sign([user]);
  const depositSig = await conn.sendRawTransaction(tx.serialize());
  await conn.confirmTransaction(depositSig, "confirmed");
  console.log(`Deposit tx: ${depositSig}`);
  console.log(`  expected tokens: ${built.expectedTokens} (= ${Number(built.expectedTokens) / 1e6} TRAX)`);

  // 2. Resolve all legs as Won.
  const state = await getVaultState(bundle.id);
  if (!state) throw new Error("vault state missing after deposit");
  for (let i = 0; i < state.legCount; i++) {
    const sig = await resolveLeg(bundle.id, i, "won");
    console.log(`  resolved leg ${i} won: ${sig}`);
  }

  // 3. Finalize vault.
  const finSig = await finalizeVault(bundle.id);
  console.log(`Finalize tx: ${finSig}`);

  // 4. Redeem.
  const userTraxAta = getAssociatedTokenAddressSync(
    new PublicKey(bundle.trax_mint!),
    user.publicKey,
  );
  const traxAcct = await getAccount(conn, userTraxAta);
  const traxAmount = traxAcct.amount;
  const redeemBuilt = await buildRedeemTx(user.publicKey, bundle.id, traxAmount);
  const redeemTx = VersionedTransaction.deserialize(
    Buffer.from(redeemBuilt.transactionBase64, "base64"),
  );
  redeemTx.sign([user]);
  const redeemSig = await conn.sendRawTransaction(redeemTx.serialize());
  await conn.confirmTransaction(redeemSig, "confirmed");
  console.log(`Redeem tx: ${redeemSig}`);
  console.log(`  expected USDC: ${redeemBuilt.expectedUsdc} (= ${Number(redeemBuilt.expectedUsdc) / 1e6} USDC)`);

  // 5. Withdraw residual fees.
  const withSig = await adminWithdrawFees(bundle.id);
  console.log(`Fee withdraw tx: ${withSig}`);

  console.log("\nDemo cycle complete.");
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);

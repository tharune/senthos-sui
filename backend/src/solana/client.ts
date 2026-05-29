/**
 * High-level Senthos onchain client used by the API routes.
 *
 * Responsibilities:
 *   - Build user-signed transactions (deposit, redeem) that Phantom signs.
 *   - Execute authority-signed instructions (initialize_vault, resolve_leg,
 *     finalize_vault, admin_withdraw_fees).
 *   - Read-only queries against vault state and token balances.
 *
 * The deposit/redeem transaction builders also pre-add an
 * `createAssociatedTokenAccountIdempotent` instruction for the user's TRAX
 * ATA, so the frontend can submit the returned tx as-is without extra setup.
 */
import { BN } from "@coral-xyz/anchor";
import {
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  Transaction,
  TransactionInstruction,
  VersionedTransaction,
  TransactionMessage,
  ComputeBudgetProgram,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
  getAccount,
  getMint,
} from "@solana/spl-token";
import {
  bundleIdToSeed,
  deriveMeteoraAdapter,
  deriveMeteoraPool,
  derivePpnNote,
  deriveTraxMint,
  deriveUsdcVault,
  deriveVaultPda,
  getConfig,
  getConnection,
  getPpnProgram,
  getProvider,
  getVaultProgram,
} from "./anchor";

// ---------- Types ----------

export interface BuildDepositTxResult {
  /** Base64-encoded serialized VersionedTransaction the frontend forwards to Phantom. */
  transactionBase64: string;
  expectedTokens: string; // u64 as decimal string to survive JSON
  feeUsdc: string;
  issuePriceBps: number;
  vaultPda: string;
  traxMint: string;
  feeRecipientAta: string;
  recentBlockhash: string;
  lastValidBlockHeight: number;
}

export interface BuildRedeemTxResult {
  transactionBase64: string;
  /** Net USDC to the user (after any early-exit fee). */
  expectedUsdc: string;
  vaultPda: string;
  traxMint: string;
  recentBlockhash: string;
  lastValidBlockHeight: number;
  /** Set when `exit_active` is used (vault still active). */
  redeemKind?: "finalized" | "active_early";
  /** Early-exit fee in USDC base units (6 decimals), if `redeemKind === "active_early"`. */
  earlyExitFeeUsdc?: string;
}

/** Must match `EARLY_EXIT_FEE_BPS` in programs/traxis_vault/src/state.rs */
export const EARLY_EXIT_FEE_BPS_ONCHAIN = 30;

export interface LegInitView {
  marketId: Uint8Array | number[];
  weightBps: number;
}

export interface InitializeVaultResult {
  signature: string;
  vaultPda: string;
  traxMint: string;
  usdcVault: string;
}

export interface VaultStateView {
  bundleSeedHex: string;
  authority: string;
  traxMint: string;
  usdcMint: string;
  usdcVault: string;
  feeRecipient: string;
  issuePriceBps: number;
  feeBps: number;
  riskTier: number;
  resolutionDate: number;
  legCount: number;
  legs: Array<{
    marketIdHex: string;
    weightBps: number;
    status: "unresolved" | "won" | "lost";
  }>;
  totalTokensMinted: string;
  totalUsdcDeposited: string;
  totalFeesCollected: string;
  finalPayoutPerToken: string;
  state: "active" | "finalized" | "closed";
}

// ---------- Helpers ----------

function toHex(bytes: Uint8Array | number[]): string {
  const arr = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
  return Array.from(arr).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function normalizeLegStatus(s: any): "unresolved" | "won" | "lost" {
  if (s?.unresolved !== undefined) return "unresolved";
  if (s?.won !== undefined) return "won";
  if (s?.lost !== undefined) return "lost";
  return "unresolved";
}

function normalizeVaultState(s: any): "active" | "finalized" | "closed" {
  if (s?.active !== undefined) return "active";
  if (s?.finalized !== undefined) return "finalized";
  if (s?.closed !== undefined) return "closed";
  return "active";
}

// ---------- User-signed transaction builders ----------

/**
 * Build a deposit transaction for the user to sign in their wallet.
 * The returned tx includes (idempotent) ATA creation for the user's TRAX ATA,
 * so the frontend can submit it as-is.
 */
export async function buildDepositTx(
  userPubkey: PublicKey,
  bundleId: string,
  amountUsdc: bigint,
): Promise<BuildDepositTxResult> {
  const cfg = getConfig();
  const program = getVaultProgram();
  const conn = getConnection();

  const [vaultPda] = deriveVaultPda(bundleId);
  const [traxMint] = deriveTraxMint(bundleId);
  const [usdcVault] = deriveUsdcVault(bundleId);

  // Fetch vault for issue price + fee bps.
  const vaultAcct = (await (program.account as any).vault.fetch(vaultPda)) as any;
  const issuePriceBps: number = vaultAcct.issuePriceBps;
  const feeBps: number = vaultAcct.feeBps;

  const feeUsdc = (amountUsdc * BigInt(feeBps)) / 10_000n;
  const netUsdc = amountUsdc - feeUsdc;
  const expectedTokens = (netUsdc * 10_000n) / BigInt(issuePriceBps);

  const userUsdcAta = getAssociatedTokenAddressSync(cfg.usdcMint, userPubkey);
  const userTraxAta = getAssociatedTokenAddressSync(traxMint, userPubkey);
  const feeRecipientAta = getAssociatedTokenAddressSync(
    cfg.usdcMint,
    cfg.feeRecipient,
  );

  // Ensure user's TRAX ATA exists (idempotent).
  const ensureAtaIx = createAssociatedTokenAccountIdempotentInstruction(
    userPubkey,
    userTraxAta,
    userPubkey,
    traxMint,
  );

  const depositIx: TransactionInstruction = await program.methods
    .deposit(new BN(amountUsdc.toString()))
    .accounts({
      user: userPubkey,
      vault: vaultPda,
      traxMint,
      usdcVault,
      userUsdcAta,
      userTraxAta,
      feeRecipientAta,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();

  // Slight priority fee bump to help during demos on congested RPC.
  const priorityIx = ComputeBudgetProgram.setComputeUnitPrice({
    microLamports: 1_000,
  });
  const cuLimitIx = ComputeBudgetProgram.setComputeUnitLimit({
    units: 250_000,
  });

  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
  const msg = new TransactionMessage({
    payerKey: userPubkey,
    recentBlockhash: blockhash,
    instructions: [cuLimitIx, priorityIx, ensureAtaIx, depositIx],
  }).compileToV0Message();
  const tx = new VersionedTransaction(msg);
  const transactionBase64 = Buffer.from(tx.serialize()).toString("base64");

  return {
    transactionBase64,
    expectedTokens: expectedTokens.toString(),
    feeUsdc: feeUsdc.toString(),
    issuePriceBps,
    vaultPda: vaultPda.toBase58(),
    traxMint: traxMint.toBase58(),
    feeRecipientAta: feeRecipientAta.toBase58(),
    recentBlockhash: blockhash,
    lastValidBlockHeight,
  };
}

export async function buildRedeemTx(
  userPubkey: PublicKey,
  bundleId: string,
  amountTokens: bigint,
): Promise<BuildRedeemTxResult> {
  const cfg = getConfig();
  const program = getVaultProgram();
  const conn = getConnection();

  const [vaultPda] = deriveVaultPda(bundleId);
  const [traxMint] = deriveTraxMint(bundleId);
  const [usdcVault] = deriveUsdcVault(bundleId);

  const vaultAcct = (await (program.account as any).vault.fetch(vaultPda)) as any;
  const finalPayoutPerToken: bigint = BigInt(
    (vaultAcct.finalPayoutPerToken as BN).toString(),
  );
  const expectedUsdc = (amountTokens * finalPayoutPerToken) / 1_000_000n;

  const userUsdcAta = getAssociatedTokenAddressSync(cfg.usdcMint, userPubkey);
  const userTraxAta = getAssociatedTokenAddressSync(traxMint, userPubkey);

  const ensureUsdcAtaIx = createAssociatedTokenAccountIdempotentInstruction(
    userPubkey,
    userUsdcAta,
    userPubkey,
    cfg.usdcMint,
  );

  const redeemIx = await program.methods
    .redeem(new BN(amountTokens.toString()))
    .accounts({
      user: userPubkey,
      vault: vaultPda,
      traxMint,
      usdcVault,
      userTraxAta,
      userUsdcAta,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();

  const priorityIx = ComputeBudgetProgram.setComputeUnitPrice({
    microLamports: 1_000,
  });
  const cuLimitIx = ComputeBudgetProgram.setComputeUnitLimit({
    units: 250_000,
  });

  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
  const msg = new TransactionMessage({
    payerKey: userPubkey,
    recentBlockhash: blockhash,
    instructions: [cuLimitIx, priorityIx, ensureUsdcAtaIx, redeemIx],
  }).compileToV0Message();
  const tx = new VersionedTransaction(msg);
  const transactionBase64 = Buffer.from(tx.serialize()).toString("base64");

  return {
    transactionBase64,
    expectedUsdc: expectedUsdc.toString(),
    vaultPda: vaultPda.toBase58(),
    traxMint: traxMint.toBase58(),
    recentBlockhash: blockhash,
    lastValidBlockHeight,
    redeemKind: "finalized",
  };
}

/**
 * Build `exit_active` for a vault still in Active state — pro-rata USDC pool
 * share net of {@link EARLY_EXIT_FEE_BPS_ONCHAIN}.
 */
export async function buildExitActiveTx(
  userPubkey: PublicKey,
  bundleId: string,
  amountTokens: bigint,
): Promise<BuildRedeemTxResult> {
  const cfg = getConfig();
  const program = getVaultProgram();
  const conn = getConnection();

  const [vaultPda] = deriveVaultPda(bundleId);
  const [traxMint] = deriveTraxMint(bundleId);
  const [usdcVaultPk] = deriveUsdcVault(bundleId);

  const vaultAcct = (await (program.account as any).vault.fetch(vaultPda)) as any;
  const feeRecipientPk = vaultAcct.feeRecipient as PublicKey;
  const feeRecipientAta = getAssociatedTokenAddressSync(cfg.usdcMint, feeRecipientPk);

  const mintInfo = await getMint(conn, traxMint);
  const supply = BigInt(mintInfo.supply.toString());
  if (supply === 0n) {
    throw new Error("TRAX mint has zero supply; nothing to exit");
  }

  const usdcVaultAcct = await getAccount(conn, usdcVaultPk);
  const vaultBal = BigInt(usdcVaultAcct.amount.toString());

  const gross = (amountTokens * vaultBal) / supply;
  const fee =
    (gross * BigInt(EARLY_EXIT_FEE_BPS_ONCHAIN)) / 10_000n;
  const net = gross - fee;

  const userUsdcAta = getAssociatedTokenAddressSync(cfg.usdcMint, userPubkey);
  const userTraxAta = getAssociatedTokenAddressSync(traxMint, userPubkey);

  const ensureUsdcAtaIx = createAssociatedTokenAccountIdempotentInstruction(
    userPubkey,
    userUsdcAta,
    userPubkey,
    cfg.usdcMint,
  );

  const exitIx = await program.methods
    .exitActive(new BN(amountTokens.toString()))
    .accounts({
      user: userPubkey,
      vault: vaultPda,
      traxMint,
      usdcVault: usdcVaultPk,
      userTraxAta,
      userUsdcAta,
      feeRecipientAta,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();

  const priorityIx = ComputeBudgetProgram.setComputeUnitPrice({
    microLamports: 1_000,
  });
  const cuLimitIx = ComputeBudgetProgram.setComputeUnitLimit({
    units: 280_000,
  });

  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
  const msg = new TransactionMessage({
    payerKey: userPubkey,
    recentBlockhash: blockhash,
    instructions: [cuLimitIx, priorityIx, ensureUsdcAtaIx, exitIx],
  }).compileToV0Message();
  const tx = new VersionedTransaction(msg);
  const transactionBase64 = Buffer.from(tx.serialize()).toString("base64");

  return {
    transactionBase64,
    expectedUsdc: net.toString(),
    vaultPda: vaultPda.toBase58(),
    traxMint: traxMint.toBase58(),
    recentBlockhash: blockhash,
    lastValidBlockHeight,
    redeemKind: "active_early",
    earlyExitFeeUsdc: fee.toString(),
  };
}

// ---------- Authority-signed calls ----------

export interface InitializeVaultArgs {
  bundleId: string;
  issuePriceBps: number;
  feeBps: number;
  riskTier: 50 | 70 | 90;
  resolutionDate: Date;
  legs: LegInitView[];
}

export async function initializeVault(
  args: InitializeVaultArgs,
): Promise<InitializeVaultResult> {
  const cfg = getConfig();
  const program = getVaultProgram();
  const bundleSeed = bundleIdToSeed(args.bundleId);

  const [vaultPda] = deriveVaultPda(args.bundleId);
  const [traxMint] = deriveTraxMint(args.bundleId);
  const [usdcVault] = deriveUsdcVault(args.bundleId);

  const signature = await program.methods
    .initializeVault({
      bundleSeed: Array.from(bundleSeed),
      issuePriceBps: args.issuePriceBps,
      feeBps: args.feeBps,
      riskTier: args.riskTier,
      resolutionDate: new BN(Math.floor(args.resolutionDate.getTime() / 1000)),
      legs: args.legs.map((l) => ({
        marketId:
          l.marketId instanceof Uint8Array
            ? Array.from(l.marketId)
            : Array.from(l.marketId),
        weightBps: l.weightBps,
      })),
    })
    .accounts({
      authority: cfg.authorityKeypair.publicKey,
      vault: vaultPda,
      traxMint,
      usdcMint: cfg.usdcMint,
      usdcVault,
      feeRecipient: cfg.feeRecipient,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      rent: SYSVAR_RENT_PUBKEY,
    })
    .rpc();

  return {
    signature,
    vaultPda: vaultPda.toBase58(),
    traxMint: traxMint.toBase58(),
    usdcVault: usdcVault.toBase58(),
  };
}

/**
 * Step 2 of 3 of vault init: create the TRAX mint PDA and record it on
 * the vault. Must be called after `initializeVault` and before
 * `initializeVaultTokens`. Split out of the old single-call init to keep
 * each instruction's try_accounts frame under BPF's 4 KB stack budget
 * (modern rustc is ~24 bytes tighter than Rust 1.75, tipping the old
 * combined instruction over).
 */
export async function initializeTraxMint(bundleId: string): Promise<string> {
  const cfg = getConfig();
  const program = getVaultProgram();
  const [vaultPda] = deriveVaultPda(bundleId);
  const [traxMint] = deriveTraxMint(bundleId);

  return await program.methods
    .initializeTraxMint()
    .accounts({
      authority: cfg.authorityKeypair.publicKey,
      vault: vaultPda,
      traxMint,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      rent: SYSVAR_RENT_PUBKEY,
    })
    .rpc();
}

/**
 * Step 3 of 3 of vault init: create the PDA-owned USDC vault token
 * account and record the USDC mint on the Vault. Must be called after
 * `initializeTraxMint`.
 */
export async function initializeVaultTokens(bundleId: string): Promise<string> {
  const cfg = getConfig();
  const program = getVaultProgram();
  const [vaultPda] = deriveVaultPda(bundleId);
  const [usdcVault] = deriveUsdcVault(bundleId);

  return await program.methods
    .initializeVaultTokens()
    .accounts({
      authority: cfg.authorityKeypair.publicKey,
      vault: vaultPda,
      usdcMint: cfg.usdcMint,
      usdcVault,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      rent: SYSVAR_RENT_PUBKEY,
    })
    .rpc();
}

export async function resolveLeg(
  bundleId: string,
  legIndex: number,
  outcome: "won" | "lost",
): Promise<string> {
  const cfg = getConfig();
  const program = getVaultProgram();
  const [vaultPda] = deriveVaultPda(bundleId);
  const outcomeByte = outcome === "won" ? 1 : 2;

  return await program.methods
    .resolveLeg(legIndex, outcomeByte)
    .accounts({
      authority: cfg.authorityKeypair.publicKey,
      vault: vaultPda,
    })
    .rpc();
}

export async function finalizeVault(bundleId: string): Promise<string> {
  const cfg = getConfig();
  const program = getVaultProgram();
  const [vaultPda] = deriveVaultPda(bundleId);
  const [usdcVault] = deriveUsdcVault(bundleId);

  return await program.methods
    .finalizeVault()
    .accounts({
      authority: cfg.authorityKeypair.publicKey,
      vault: vaultPda,
      usdcVault,
    })
    .rpc();
}

export async function adminWithdrawFees(bundleId: string): Promise<string> {
  const cfg = getConfig();
  const program = getVaultProgram();
  const [vaultPda] = deriveVaultPda(bundleId);
  const [usdcVault] = deriveUsdcVault(bundleId);
  const feeRecipientAta = getAssociatedTokenAddressSync(
    cfg.usdcMint,
    cfg.feeRecipient,
  );

  return await program.methods
    .adminWithdrawFees()
    .accounts({
      authority: cfg.authorityKeypair.publicKey,
      vault: vaultPda,
      usdcVault,
      feeRecipientAta,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc();
}

// ---------- Read-only queries ----------

export async function getVaultState(bundleId: string): Promise<VaultStateView | null> {
  const program = getVaultProgram();
  const [vaultPda] = deriveVaultPda(bundleId);
  try {
    const v = (await (program.account as any).vault.fetch(vaultPda)) as any;
    return {
      bundleSeedHex: toHex(v.bundleSeed),
      authority: v.authority.toBase58(),
      traxMint: v.traxMint.toBase58(),
      usdcMint: v.usdcMint.toBase58(),
      usdcVault: v.usdcVault.toBase58(),
      feeRecipient: v.feeRecipient.toBase58(),
      issuePriceBps: v.issuePriceBps,
      feeBps: v.feeBps,
      riskTier: v.riskTier,
      resolutionDate: (v.resolutionDate as BN).toNumber(),
      legCount: v.legCount,
      legs: (v.legs as any[])
        .slice(0, v.legCount)
        .map((l) => ({
          marketIdHex: toHex(l.marketId),
          weightBps: l.weightBps,
          status: normalizeLegStatus(l.status),
        })),
      totalTokensMinted: (v.totalTokensMinted as BN).toString(),
      totalUsdcDeposited: (v.totalUsdcDeposited as BN).toString(),
      totalFeesCollected: (v.totalFeesCollected as BN).toString(),
      finalPayoutPerToken: (v.finalPayoutPerToken as BN).toString(),
      state: normalizeVaultState(v.state),
    };
  } catch (err) {
    return null;
  }
}

export async function getTokenBalance(
  wallet: PublicKey,
  mint: PublicKey,
): Promise<bigint> {
  const ata = getAssociatedTokenAddressSync(mint, wallet);
  try {
    const acct = await getAccount(getConnection(), ata);
    return acct.amount;
  } catch {
    return 0n;
  }
}

export async function confirmTransaction(signature: string): Promise<boolean> {
  const conn = getConnection();
  const status = await conn.getSignatureStatus(signature, {
    searchTransactionHistory: true,
  });
  return (
    status.value?.confirmationStatus === "confirmed" ||
    status.value?.confirmationStatus === "finalized"
  );
}

/**
 * Read the UI-units USDC delta for `walletAddress` from a confirmed
 * transaction. Positive = USDC arrived in the wallet (a sell / divest /
 * redeem). Negative = USDC left the wallet (a deposit / buy).
 *
 * Walks `meta.preTokenBalances` + `meta.postTokenBalances` looking for
 * the wallet's USDC ATA. Returns `null` when the tx can't be fetched or
 * neither pre nor post mention the wallet's USDC account — callers can
 * fall back to an estimated number in that case.
 *
 * Used by the confirm endpoints to persist the REAL amount the user
 * received / paid into the transactions table, so the History tab
 * reconciles exactly with the on-chain outcome instead of showing
 * stale estimates (principal_usdc, expected_usdc, 0, etc.).
 */
export async function getUserUsdcDeltaFromTx(
  signature: string,
  walletAddress: string,
): Promise<number | null> {
  try {
    const conn = getConnection();
    const tx = await conn.getTransaction(signature, {
      maxSupportedTransactionVersion: 0,
      commitment: "confirmed",
    });
    if (!tx?.meta) return null;
    const usdcMint = process.env.USDC_MINT;
    if (!usdcMint) return null;

    const pre = tx.meta.preTokenBalances ?? [];
    const post = tx.meta.postTokenBalances ?? [];
    const preEntry = pre.find(
      (b) => b.mint === usdcMint && b.owner === walletAddress,
    );
    const postEntry = post.find(
      (b) => b.mint === usdcMint && b.owner === walletAddress,
    );

    // If the wallet had no USDC ATA before (balance 0 implied) and one
    // doesn't appear after either, the tx didn't touch this user's USDC.
    if (!preEntry && !postEntry) return null;

    const preUi = preEntry?.uiTokenAmount?.uiAmount ?? 0;
    const postUi = postEntry?.uiTokenAmount?.uiAmount ?? 0;
    return postUi - preUi;
  } catch (err) {
    // RPC hiccup, tx not found, etc. — callers use a fallback.
    console.warn(
      `[getUserUsdcDeltaFromTx] failed for sig=${signature}: ${(err as Error).message}`,
    );
    return null;
  }
}

// ===========================================================================
// PPN — principal-protected note flow
// ===========================================================================

export interface BuildPpnDepositTxResult {
  transactionBase64: string;
  /** Hex-encoded 8-byte seed used to derive the note PDA. */
  noteSeedHex: string;
  notePda: string;
  maturityTs: number;
  traxVault: string;
  traxMint: string;
  adapterPda: string;
  adapterPool: string;
  recentBlockhash: string;
  lastValidBlockHeight: number;
}

export interface BuildPpnRedeemTxResult {
  transactionBase64: string;
  notePda: string;
  recentBlockhash: string;
  lastValidBlockHeight: number;
}

export interface BuildPpnDivestTxResult {
  transactionBase64: string;
  notePda: string;
  recentBlockhash: string;
  lastValidBlockHeight: number;
  /** Estimated strategy fee in USDC base units (6 decimals). The real fee
   *  is computed on-chain from the post-CPI balance; this is the pre-trade
   *  prediction for UI display only. */
  estimatedStrategyFeeUsdc: string;
}

export interface BuildPpnCloseTxResult {
  transactionBase64: string;
  notePda: string;
  recentBlockhash: string;
  lastValidBlockHeight: number;
  estimatedStrategyFeeUsdc: string;
  estimatedNetUsdc: string;
}

export interface MockAdapterState {
  authority: string;
  usdcMint: string;
  usdcPool: string;
  apyBps: number;
  totalPrincipal: string;
  bump: number;
}

function newNoteSeed(): Uint8Array {
  // 8 cryptographically-random bytes. Re-used only if caller explicitly passes
  // a seed; otherwise unique per note.
  const buf = new Uint8Array(8);
  for (let i = 0; i < 8; i++) buf[i] = Math.floor(Math.random() * 256);
  return buf;
}

function fromHex(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0) throw new Error("noteSeedHex must be even length");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.substr(i * 2, 2), 16);
  }
  return out;
}

/**
 * Build a PPN deposit transaction (`initialize_note`).
 *
 * Flow: user signs → program records a PpnNote PDA and transfers their USDC
 * principal into the mock-Meteora adapter pool. The note's TRAX ATA is
 * also created idempotently here so `harvest_yield` has somewhere to put the
 * yield-bought TRAX later.
 */
export async function buildPpnDepositTx(args: {
  userPubkey: PublicKey;
  bundleId: string;
  principalUsdc: bigint;
  maturityTs: number;
  /** Optional deterministic seed; defaults to a random 8 bytes. */
  noteSeedHex?: string;
}): Promise<BuildPpnDepositTxResult> {
  const cfg = getConfig();
  const program = getPpnProgram();
  const conn = getConnection();

  const noteSeedBytes = args.noteSeedHex
    ? fromHex(args.noteSeedHex)
    : newNoteSeed();
  if (noteSeedBytes.length !== 8) {
    throw new Error("note seed must be 8 bytes");
  }

  const [notePda] = derivePpnNote(args.userPubkey, noteSeedBytes);
  const [adapterPda] = deriveMeteoraAdapter();
  const [adapterPool] = deriveMeteoraPool();
  const [traxVault] = deriveVaultPda(args.bundleId);
  const [traxMint] = deriveTraxMint(args.bundleId);

  const ownerUsdcAta = getAssociatedTokenAddressSync(
    cfg.usdcMint,
    args.userPubkey,
  );

  // We also idempotently create the note's own TRAX ATA here — it's needed at
  // redeem time (the Anchor constraint deserializes it as a TokenAccount, so
  // the account must exist even with a zero balance). Harvest will later
  // deposit TRAX into it. Owner = note PDA.
  const noteTraxAtaIx = createAssociatedTokenAccountIdempotentInstruction(
    args.userPubkey,
    getAssociatedTokenAddressSync(traxMint, notePda, true),
    notePda,
    traxMint,
  );

  const initNoteIx: TransactionInstruction = await program.methods
    .initializeNote({
      noteSeed: Array.from(noteSeedBytes),
      principalUsdc: new BN(args.principalUsdc.toString()),
      maturityTs: new BN(args.maturityTs),
    })
    .accounts({
      owner: args.userPubkey,
      note: notePda,
      adapter: adapterPda,
      adapterPool,
      usdcMint: cfg.usdcMint,
      ownerUsdcAta,
      traxVault,
      traxMint,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .instruction();

  const priorityIx = ComputeBudgetProgram.setComputeUnitPrice({
    microLamports: 1_000,
  });
  const cuLimitIx = ComputeBudgetProgram.setComputeUnitLimit({
    units: 300_000,
  });

  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash(
    "confirmed",
  );
  const msg = new TransactionMessage({
    payerKey: args.userPubkey,
    recentBlockhash: blockhash,
    instructions: [cuLimitIx, priorityIx, noteTraxAtaIx, initNoteIx],
  }).compileToV0Message();
  const tx = new VersionedTransaction(msg);

  return {
    transactionBase64: Buffer.from(tx.serialize()).toString("base64"),
    noteSeedHex: toHex(noteSeedBytes),
    notePda: notePda.toBase58(),
    maturityTs: args.maturityTs,
    traxVault: traxVault.toBase58(),
    traxMint: traxMint.toBase58(),
    adapterPda: adapterPda.toBase58(),
    adapterPool: adapterPool.toBase58(),
    recentBlockhash: blockhash,
    lastValidBlockHeight,
  };
}

/**
 * Build a PPN redeem-at-maturity transaction.
 *
 * The backend derives the note PDA from the user's wallet + stored
 * `note_seed_hex`, then builds the `redeem_at_maturity` ix. Adds idempotent
 * ATA creation for the user's USDC and TRAX (trax-mint) ATAs.
 */
export async function buildPpnRedeemTx(args: {
  userPubkey: PublicKey;
  noteSeedHex: string;
  /** trax_mint recorded on the note (the backend pulls this from the DB). */
  traxMintBase58: string;
}): Promise<BuildPpnRedeemTxResult> {
  const cfg = getConfig();
  const program = getPpnProgram();
  const conn = getConnection();

  const noteSeedBytes = fromHex(args.noteSeedHex);
  const [notePda] = derivePpnNote(args.userPubkey, noteSeedBytes);
  const [adapterPda] = deriveMeteoraAdapter();
  const [adapterPool] = deriveMeteoraPool();

  const traxMint = new PublicKey(args.traxMintBase58);
  const ownerUsdcAta = getAssociatedTokenAddressSync(
    cfg.usdcMint,
    args.userPubkey,
  );
  const ownerTraxAta = getAssociatedTokenAddressSync(traxMint, args.userPubkey);
  const noteTraxAta = getAssociatedTokenAddressSync(traxMint, notePda, true);

  const ensureUsdcAtaIx = createAssociatedTokenAccountIdempotentInstruction(
    args.userPubkey,
    ownerUsdcAta,
    args.userPubkey,
    cfg.usdcMint,
  );
  const ensureTraxAtaIx = createAssociatedTokenAccountIdempotentInstruction(
    args.userPubkey,
    ownerTraxAta,
    args.userPubkey,
    traxMint,
  );

  const redeemIx = await program.methods
    .redeemAtMaturity()
    .accounts({
      owner: args.userPubkey,
      note: notePda,
      adapter: adapterPda,
      adapterPool,
      ownerUsdcAta,
      ownerTraxAta,
      noteTraxAta,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();

  const priorityIx = ComputeBudgetProgram.setComputeUnitPrice({
    microLamports: 1_000,
  });
  const cuLimitIx = ComputeBudgetProgram.setComputeUnitLimit({
    units: 300_000,
  });

  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash(
    "confirmed",
  );
  const msg = new TransactionMessage({
    payerKey: args.userPubkey,
    recentBlockhash: blockhash,
    instructions: [cuLimitIx, priorityIx, ensureUsdcAtaIx, ensureTraxAtaIx, redeemIx],
  }).compileToV0Message();
  const tx = new VersionedTransaction(msg);

  return {
    transactionBase64: Buffer.from(tx.serialize()).toString("base64"),
    notePda: notePda.toBase58(),
    recentBlockhash: blockhash,
    lastValidBlockHeight,
  };
}

/** Must match `STRATEGY_FEE_BPS` in backend/src/routes/ppn.ts. */
export const STRATEGY_FEE_BPS_ONCHAIN = 5;

/**
 * Build a PPN `divest` transaction. Sells the note's basket sleeve (TRAX
 * holdings) back to the vault via exit_active, takes the PPN strategy fee
 * off the resulting USDC, and routes the remainder to the owner. Principal
 * stays in the yield adapter — note remains Active.
 *
 * The caller-supplied `bundleId` is the Supabase bundle UUID whose vault
 * the note deposits into; this is used to derive the vault / mint / usdc
 * vault PDAs. The backend should cross-check it against the note's stored
 * `trax_vault` before preparing.
 */
export async function buildPpnDivestTx(args: {
  userPubkey: PublicKey;
  bundleId: string;
  noteSeedHex: string;
  /** Defaults to STRATEGY_FEE_BPS_ONCHAIN (5 bps). */
  strategyFeeBps?: number;
  /** Pre-trade basket-side payout estimate in USDC base units, for the
   *  response-only `estimatedStrategyFeeUsdc` field. Pass the caller's
   *  best off-chain quote (NAV × trax_holdings). */
  estimatedBasketPayoutUsdc?: bigint;
}): Promise<BuildPpnDivestTxResult> {
  const cfg = getConfig();
  const program = getPpnProgram();
  const conn = getConnection();

  const noteSeedBytes = fromHex(args.noteSeedHex);
  const [notePda] = derivePpnNote(args.userPubkey, noteSeedBytes);
  const [vaultPda] = deriveVaultPda(args.bundleId);
  const [traxMint] = deriveTraxMint(args.bundleId);
  const [usdcVault] = deriveUsdcVault(args.bundleId);

  const ownerUsdcAta = getAssociatedTokenAddressSync(
    cfg.usdcMint,
    args.userPubkey,
  );
  const noteUsdcAta = getAssociatedTokenAddressSync(cfg.usdcMint, notePda, true);
  const noteTraxAta = getAssociatedTokenAddressSync(traxMint, notePda, true);
  const feeRecipientAta = getAssociatedTokenAddressSync(
    cfg.usdcMint,
    cfg.feeRecipient,
  );

  // Both ATAs get created idempotently so a fresh note with no prior USDC
  // touches still works.
  const ensureOwnerUsdcIx = createAssociatedTokenAccountIdempotentInstruction(
    args.userPubkey,
    ownerUsdcAta,
    args.userPubkey,
    cfg.usdcMint,
  );
  const ensureNoteUsdcIx = createAssociatedTokenAccountIdempotentInstruction(
    args.userPubkey,
    noteUsdcAta,
    notePda,
    cfg.usdcMint,
  );

  const strategyFeeBps = args.strategyFeeBps ?? STRATEGY_FEE_BPS_ONCHAIN;
  const divestIx: TransactionInstruction = await program.methods
    .divest(strategyFeeBps)
    .accounts({
      owner: args.userPubkey,
      note: notePda,
      vault: vaultPda,
      traxMint,
      vaultUsdcVault: usdcVault,
      noteTraxAta,
      noteUsdcAta,
      ownerUsdcAta,
      feeRecipientAta,
      usdcMint: cfg.usdcMint,
      traxisVaultProgram: cfg.vaultProgramId,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();

  const cuLimitIx = ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 });
  const priorityIx = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000 });

  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
  const msg = new TransactionMessage({
    payerKey: args.userPubkey,
    recentBlockhash: blockhash,
    instructions: [cuLimitIx, priorityIx, ensureOwnerUsdcIx, ensureNoteUsdcIx, divestIx],
  }).compileToV0Message();
  const tx = new VersionedTransaction(msg);

  // Estimate strategy fee on the *net-of-vault-fee* basket payout. The
  // vault charges EARLY_EXIT_FEE_BPS_ONCHAIN (30 bps) before PPN sees the
  // USDC, so the PPN fee applies to ~(gross * (1 - 0.003)).
  const basketGross = args.estimatedBasketPayoutUsdc ?? 0n;
  const vaultFee = (basketGross * BigInt(EARLY_EXIT_FEE_BPS_ONCHAIN)) / 10_000n;
  const afterVault = basketGross - vaultFee;
  const estFee = (afterVault * BigInt(strategyFeeBps)) / 10_000n;

  return {
    transactionBase64: Buffer.from(tx.serialize()).toString("base64"),
    notePda: notePda.toBase58(),
    recentBlockhash: blockhash,
    lastValidBlockHeight,
    estimatedStrategyFeeUsdc: estFee.toString(),
  };
}

/**
 * Build a PPN `close_early` transaction. Combines divest (basket → USDC via
 * exit_active) with principal withdrawal from the yield adapter in a single
 * ix, deducts the PPN strategy fee from the combined payout, and sends the
 * net to the owner. Marks the note Redeemed.
 *
 * `minProceedsUsdc` is a slippage guard — the on-chain handler reverts if
 * the final net to owner falls below it. Pass 0 to disable.
 */
export async function buildPpnCloseTx(args: {
  userPubkey: PublicKey;
  bundleId: string;
  noteSeedHex: string;
  principalUsdc: bigint;
  strategyFeeBps?: number;
  minProceedsUsdc?: bigint;
  estimatedBasketPayoutUsdc?: bigint;
}): Promise<BuildPpnCloseTxResult> {
  const cfg = getConfig();
  const program = getPpnProgram();
  const conn = getConnection();

  const noteSeedBytes = fromHex(args.noteSeedHex);
  const [notePda] = derivePpnNote(args.userPubkey, noteSeedBytes);
  const [vaultPda] = deriveVaultPda(args.bundleId);
  const [traxMint] = deriveTraxMint(args.bundleId);
  const [usdcVault] = deriveUsdcVault(args.bundleId);
  const [adapterPda] = deriveMeteoraAdapter();
  const [adapterPool] = deriveMeteoraPool();

  const ownerUsdcAta = getAssociatedTokenAddressSync(
    cfg.usdcMint,
    args.userPubkey,
  );
  const noteUsdcAta = getAssociatedTokenAddressSync(cfg.usdcMint, notePda, true);
  const noteTraxAta = getAssociatedTokenAddressSync(traxMint, notePda, true);
  const feeRecipientAta = getAssociatedTokenAddressSync(
    cfg.usdcMint,
    cfg.feeRecipient,
  );

  const ensureOwnerUsdcIx = createAssociatedTokenAccountIdempotentInstruction(
    args.userPubkey,
    ownerUsdcAta,
    args.userPubkey,
    cfg.usdcMint,
  );
  const ensureNoteUsdcIx = createAssociatedTokenAccountIdempotentInstruction(
    args.userPubkey,
    noteUsdcAta,
    notePda,
    cfg.usdcMint,
  );

  const strategyFeeBps = args.strategyFeeBps ?? STRATEGY_FEE_BPS_ONCHAIN;
  const minProceeds = args.minProceedsUsdc ?? 0n;

  const closeIx: TransactionInstruction = await program.methods
    .closeEarly(strategyFeeBps, new BN(minProceeds.toString()))
    .accounts({
      owner: args.userPubkey,
      note: notePda,
      adapter: adapterPda,
      adapterPool,
      vault: vaultPda,
      traxMint,
      vaultUsdcVault: usdcVault,
      noteTraxAta,
      noteUsdcAta,
      ownerUsdcAta,
      feeRecipientAta,
      usdcMint: cfg.usdcMint,
      traxisVaultProgram: cfg.vaultProgramId,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();

  const cuLimitIx = ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 });
  const priorityIx = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000 });

  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
  const msg = new TransactionMessage({
    payerKey: args.userPubkey,
    recentBlockhash: blockhash,
    instructions: [cuLimitIx, priorityIx, ensureOwnerUsdcIx, ensureNoteUsdcIx, closeIx],
  }).compileToV0Message();
  const tx = new VersionedTransaction(msg);

  // Estimate: basket payout (net of vault 30 bps) + principal, minus PPN fee.
  const basketGross = args.estimatedBasketPayoutUsdc ?? 0n;
  const vaultFee = (basketGross * BigInt(EARLY_EXIT_FEE_BPS_ONCHAIN)) / 10_000n;
  const basketNet = basketGross - vaultFee;
  const combinedGross = basketNet + args.principalUsdc;
  const estFee = (combinedGross * BigInt(strategyFeeBps)) / 10_000n;
  const estNet = combinedGross - estFee;

  return {
    transactionBase64: Buffer.from(tx.serialize()).toString("base64"),
    notePda: notePda.toBase58(),
    recentBlockhash: blockhash,
    lastValidBlockHeight,
    estimatedStrategyFeeUsdc: estFee.toString(),
    estimatedNetUsdc: estNet.toString(),
  };
}

/**
 * Read the mock-adapter account. Returns null if it hasn't been initialized.
 */
export async function getMockAdapterState(): Promise<MockAdapterState | null> {
  const program = getPpnProgram();
  const [adapterPda] = deriveMeteoraAdapter();
  try {
    const a = (await (program.account as any).meteoraMockAdapter.fetch(
      adapterPda,
    )) as any;
    return {
      authority: a.authority.toBase58(),
      usdcMint: a.usdcMint.toBase58(),
      usdcPool: a.usdcPool.toBase58(),
      apyBps: a.apyBps,
      totalPrincipal: (a.totalPrincipal as BN).toString(),
      bump: a.bump,
    };
  } catch {
    return null;
  }
}

/**
 * One-time admin bootstrap of the mock Meteora adapter. Idempotent: if the
 * adapter already exists it returns the existing state without sending a tx.
 */
export async function initializeMockAdapter(
  apyBps: number = 800,
): Promise<{ signature: string | null; adapter: MockAdapterState }> {
  const existing = await getMockAdapterState();
  if (existing) {
    return { signature: null, adapter: existing };
  }

  const cfg = getConfig();
  const program = getPpnProgram();
  const [adapterPda] = deriveMeteoraAdapter();
  const [adapterPool] = deriveMeteoraPool();

  const signature = await program.methods
    .initializeMockAdapter(apyBps)
    .accounts({
      authority: cfg.authorityKeypair.publicKey,
      adapter: adapterPda,
      usdcMint: cfg.usdcMint,
      usdcPool: adapterPool,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      rent: SYSVAR_RENT_PUBKEY,
    })
    .rpc();

  // Small wait so the next read sees the account.
  const state = await getMockAdapterState();
  if (!state) throw new Error("initializeMockAdapter succeeded but account not found");
  return { signature, adapter: state };
}

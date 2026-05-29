/**
 * Solana integration service — **real implementation**.
 *
 * Replaces the stub interface with a thin adapter over the Anchor-based
 * client in src/solana/. Preserves the original function names used by
 * route handlers while extending them with real onchain behaviour.
 *
 * New transaction-building functions (buildDepositTx, buildRedeemTx) live in
 * src/solana/client.ts and are re-exported for direct use by route handlers
 * that want to hand a signed-tx-ready payload back to the frontend.
 *
 * Required env vars:
 *   SOLANA_RPC_URL            (default: https://api.devnet.solana.com)
 *   TRAXIS_VAULT_PROGRAM_ID   (required)
 *   TRAXIS_PPN_PROGRAM_ID     (optional, falls back to vault program id)
 *   USDC_MINT                 (default: Circle devnet USDC)
 *   FEE_RECIPIENT             (required — treasury wallet pubkey)
 *   AUTHORITY_KEYPAIR         (required — path to file OR JSON array string)
 */
import { PublicKey } from "@solana/web3.js";
import {
  adminWithdrawFees as _adminWithdrawFees,
  buildDepositTx as _buildDepositTx,
  buildPpnDepositTx as _buildPpnDepositTx,
  buildPpnRedeemTx as _buildPpnRedeemTx,
  buildPpnDivestTx as _buildPpnDivestTx,
  buildPpnCloseTx as _buildPpnCloseTx,
  buildRedeemTx as _buildRedeemTx,
  buildExitActiveTx as _buildExitActiveTx,
  confirmTransaction as _confirmTransaction,
  getUserUsdcDeltaFromTx as _getUserUsdcDeltaFromTx,
  finalizeVault as _finalizeVault,
  initializeTraxMint as _initializeTraxMint,
  initializeVaultTokens as _initializeVaultTokens,
  getMockAdapterState as _getMockAdapterState,
  getTokenBalance as _getTokenBalance,
  getVaultState as _getVaultState,
  initializeMockAdapter as _initializeMockAdapter,
  initializeVault as _initializeVault,
  resolveLeg as _resolveLeg,
  type BuildDepositTxResult,
  type BuildPpnDepositTxResult,
  type BuildPpnRedeemTxResult,
  type BuildRedeemTxResult,
  type InitializeVaultArgs,
  type InitializeVaultResult,
  type LegInitView,
  type MockAdapterState,
  type VaultStateView,
} from "../solana/client";
import { deriveTraxMint, deriveUsdcVault, deriveVaultPda } from "../solana/anchor";

// ---------- Re-exports (new, preferred interface) ----------

export {
  BuildDepositTxResult,
  BuildPpnDepositTxResult,
  BuildPpnRedeemTxResult,
  BuildRedeemTxResult,
  InitializeVaultArgs,
  InitializeVaultResult,
  LegInitView,
  MockAdapterState,
  VaultStateView,
};

export const buildDepositTx = _buildDepositTx;
export const buildRedeemTx = _buildRedeemTx;
export const buildExitActiveTx = _buildExitActiveTx;
export const buildPpnDepositTx = _buildPpnDepositTx;
export const buildPpnRedeemTx = _buildPpnRedeemTx;
export const buildPpnDivestTx = _buildPpnDivestTx;
export const buildPpnCloseTx = _buildPpnCloseTx;
export const initializeVault = _initializeVault;
export const initializeTraxMint = _initializeTraxMint;
export const initializeVaultTokens = _initializeVaultTokens;
export const resolveLeg = _resolveLeg;
export const finalizeVault = _finalizeVault;
export const adminWithdrawFees = _adminWithdrawFees;
export const getVaultState = _getVaultState;
export const confirmTransaction = _confirmTransaction;
export const getUserUsdcDeltaFromTx = _getUserUsdcDeltaFromTx;
export const getMockAdapterState = _getMockAdapterState;
export const initializeMockAdapter = _initializeMockAdapter;

// ---------- Legacy stub-compatible API ----------

export interface MintResult {
  success: boolean;
  tx_signature: string;
  tokens_minted: number;
  mint_address: string;
  error?: string;
}

export interface BurnResult {
  success: boolean;
  tx_signature: string;
  tokens_burned: number;
  error?: string;
}

export interface TokenBalance {
  wallet_address: string;
  mint_address: string;
  balance: number;
}

export interface VaultDeposit {
  success: boolean;
  tx_signature: string;
  vault_address: string;
  amount_usdc: number;
  error?: string;
}

/**
 * @deprecated Non-custodial: the user must sign the tx themselves.
 * Call `buildDepositTx` and return the transaction bytes to the frontend
 * so Phantom can sign + submit. Kept as a guard to surface incorrect usage.
 */
export async function mintTokens(
  _walletAddress: string,
  _bundleId: string,
  _amount: number,
): Promise<MintResult> {
  throw new Error(
    "mintTokens is deprecated. Use buildDepositTx and have the client sign the returned transaction with Phantom.",
  );
}

/**
 * @deprecated Non-custodial: call `buildRedeemTx` instead.
 */
export async function burnTokens(
  _walletAddress: string,
  _bundleId: string,
  _amount: number,
): Promise<BurnResult> {
  throw new Error(
    "burnTokens is deprecated. Use buildRedeemTx and have the client sign the returned transaction.",
  );
}

/**
 * Read a wallet's token balance for a given mint.
 * Accepts base58 strings for backward compatibility; returns a 6-decimal UI number.
 */
export async function getTokenBalance(
  walletAddress: string,
  mintAddress: string,
): Promise<TokenBalance> {
  const raw = await _getTokenBalance(
    new PublicKey(walletAddress),
    new PublicKey(mintAddress),
  );
  return {
    wallet_address: walletAddress,
    mint_address: mintAddress,
    balance: Number(raw) / 1_000_000, // 6-dec units → UI number
  };
}

/**
 * PPN deposit — creates a ppn note and moves USDC principal into the mock
 * Meteora adapter. Unlike vault deposits, this must also build a tx for
 * Phantom to sign. We expose a stub-compatible signature that throws, plus a
 * real builder in the PPN-specific module.
 *
 * For now kept as a placeholder returning a stub shape so the `ppn.ts` route
 * can opt into the real builder at its own pace.
 */
export async function depositToVault(
  _walletAddress: string,
  amountUsdc: number,
  vaultAddress: string,
): Promise<VaultDeposit> {
  // PPN deposits are user-signed; the frontend should call /api/ppn/deposit-tx.
  throw new Error(
    "depositToVault is deprecated for the vault path. Use buildDepositTx (vault) or /api/ppn/deposit-tx (PPN).",
  );
}

/**
 * Initialize a bundle vault on-chain. Returns the TRAX mint address so the
 * caller can store it on the `bundles` row.
 *
 * Backwards-compatible signature: takes the Supabase bundle UUID and a
 * partial set of args loaded from the DB.
 */
export async function createBundleMint(
  bundleId: string,
  opts?: {
    issuePriceBps?: number;
    feeBps?: number;
    riskTier?: 50 | 70 | 90;
    resolutionDate?: Date;
    legs?: LegInitView[];
  },
): Promise<string> {
  if (!opts?.legs || !opts?.issuePriceBps || !opts?.resolutionDate || !opts?.riskTier) {
    // Old-style caller asked for just-the-mint without initializing the vault.
    // Derive the deterministic mint address — it's known even before init.
    const [mint] = deriveTraxMint(bundleId);
    return mint.toBase58();
  }
  const res = await _initializeVault({
    bundleId,
    issuePriceBps: opts.issuePriceBps,
    feeBps: opts.feeBps ?? 50,
    riskTier: opts.riskTier,
    resolutionDate: opts.resolutionDate,
    legs: opts.legs,
  });
  return res.traxMint;
}

// ---------- Convenience: derive addresses without RPC ----------

export function derivedAddressesForBundle(bundleId: string): {
  vaultPda: string;
  traxMint: string;
  usdcVault: string;
} {
  const [vaultPda] = deriveVaultPda(bundleId);
  const [traxMint] = deriveTraxMint(bundleId);
  const [usdcVault] = deriveUsdcVault(bundleId);
  return {
    vaultPda: vaultPda.toBase58(),
    traxMint: traxMint.toBase58(),
    usdcVault: usdcVault.toBase58(),
  };
}

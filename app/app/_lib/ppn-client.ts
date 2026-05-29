/**
 * PPN (Principal-Protected Note) client.
 *
 * Mirrors the shape of `deposit-client.ts`: the backend is the source of truth
 * for PDAs / IDLs / account ordering — this module just:
 *   1. POSTs `/api/ppn/onchain/prepare` to get an unsigned tx + a pending
 *      Supabase vault row.
 *   2. Hands the base64 tx to the wallet to sign + submit.
 *   3. Waits for confirmation and POSTs `/api/ppn/onchain/confirm` so the
 *      backend links the signature to the vault row.
 *
 * Redeem is symmetric: `/api/ppn/onchain/redeem/prepare` → wallet → confirm.
 *
 * The normalizeName() trick from `deposit-client` isn't needed here because
 * the PPN endpoints take `bundle_id` as the bundle UUID directly, which the
 * deposit client already resolves via `/api/bundles`. We reuse that cache
 * through `resolveBundleUuidForPpn` to keep UI code symmetric between vault
 * and PPN flows.
 */

import { BACKEND_URL } from "./tokens";
import { IS_SUI, SUI_ACTIVE_ADDRESS } from "./chain";
import { openSuiBasketPosition, redeemSuiBasketPosition } from "./sui-client";

// ---------- Shared helpers (duplicated small footprint rather than ----------
//             cross-importing so this module stays server-safe + tree-shakable)

function normalizeName(name: string): string {
  // Pass through — the DB now seeds STHS-TIER-WINDOW rows directly, so the
  // old STHS- → LK- rewrite would send PPN setups to the wrong bundle.
  return name;
}

type BundleSummary = {
  id: string;
  name: string;
  vault_pda: string | null;
  trax_mint: string | null;
  onchain_tx_signature: string | null;
};

let _bundleMap: Promise<Map<string, BundleSummary>> | null = null;

function loadBundleMap(force = false): Promise<Map<string, BundleSummary>> {
  if (force) _bundleMap = null;
  if (_bundleMap) return _bundleMap;
  _bundleMap = (async () => {
    const res = await fetch(`${BACKEND_URL}/api/bundles`);
    if (!res.ok) {
      _bundleMap = null;
      throw new PpnError(
        `Failed to load /api/bundles (HTTP ${res.status})`,
        res.status,
      );
    }
    const rows = (await res.json()) as BundleSummary[];
    const map = new Map<string, BundleSummary>();
    for (const row of rows) map.set(row.name, row);
    return map;
  })();
  return _bundleMap;
}

/**
 * Parse tier number out of a UI basket id. `STHS-HIGH-*` / `LK-90-*` → 90,
 * `STHS-MID-*` / `LK-70-*` → 70, `STHS-LOW-*` / `LK-50-*` → 50.
 */
function tierFromName(name: string): 90 | 70 | 50 | null {
  const upper = name.toUpperCase();
  if (/\b(HIGH|-90-)/.test(upper)) return 90;
  if (/\b(MID|-70-)/.test(upper)) return 70;
  if (/\b(LOW|-50-)/.test(upper)) return 50;
  return null;
}

function pickFallbackBundle(
  map: Map<string, BundleSummary>,
  uiBundleId: string,
): BundleSummary | null {
  const initialized = Array.from(map.values()).filter((b) => b.vault_pda);
  if (initialized.length === 0) return null;
  const tier = tierFromName(uiBundleId);
  if (tier !== null) {
    const tierMatch = initialized.find((b) => tierFromName(b.name) === tier);
    if (tierMatch) return tierMatch;
  }
  return initialized[0];
}

async function resolveBundleUuidForPpn(uiBundleId: string): Promise<string> {
  // If the caller already passed a UUID, use it directly.
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uiBundleId)) {
    return uiBundleId;
  }
  const dbName = normalizeName(uiBundleId);
  const map = await loadBundleMap();
  const exact = map.get(dbName);
  if (exact) return exact.id;

  const fallback = pickFallbackBundle(map, uiBundleId);
  if (fallback) {
    if (typeof window !== "undefined") {
      console.warn(
        `[ppn-client] Basket "${uiBundleId}" not in backend; routing PPN to initialized bundle "${fallback.name}" (${fallback.id}).`,
      );
    }
    return fallback.id;
  }

  throw new PpnError(
    `Bundle "${dbName}" not found. Known bundles: ${Array.from(map.keys()).join(", ") || "(none)"}`,
    404,
  );
}

export class PpnError extends Error {
  status: number;
  payload: unknown;
  constructor(message: string, status: number, payload?: unknown) {
    super(message);
    this.status = status;
    this.payload = payload;
  }
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BACKEND_URL}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let payload: unknown = undefined;
  try {
    payload = text ? JSON.parse(text) : undefined;
  } catch {
    payload = text;
  }
  if (!res.ok) {
    const msg =
      (payload && typeof payload === "object" && "error" in payload
        ? String((payload as { error: unknown }).error)
        : null) ?? `HTTP ${res.status}`;
    throw new PpnError(msg, res.status, payload);
  }
  return payload as T;
}

// ---------- Response shapes ----------

export interface PpnPrepareResponse {
  kind: "prepared";
  vault_id: string;
  bundle_id: string;
  wallet_address: string;
  amount_usdc: number;
  /** Flat 10 bps management fee on deposit (matches constellation buys). */
  management_fee_bps: number;
  management_fee_usdc: number;
  /** 5 bps strategy fee charged on both open and close of the note. */
  strategy_fee_bps: number;
  strategy_fee_usdc: number;
  /** Sum of the two fees assessed at open. */
  total_open_fee_usdc: number;
  /** amount_usdc - total_open_fee_usdc. What actually gets split. */
  net_deposit_usdc: number;
  estimated_apy: number;
  maturity_date: string;
  maturity_ts: number;
  note_pda: string;
  note_seed_hex: string;
  adapter_pda: string;
  adapter_pool: string;
  trax_mint: string;
  trax_vault: string;
  /** Base64-encoded unsigned Solana transaction. */
  transaction_base64: string;
  recent_blockhash: string;
  last_valid_block_height: number;
}

export interface PpnConfirmResponse {
  vault_id: string;
  bundle_id: string;
  wallet_address: string;
  principal_usdc: number;
  signature: string;
  transaction_id: string | null;
}

export interface PpnRedeemPrepareResponse {
  kind: "prepared";
  vault_id: string;
  bundle_id: string;
  wallet_address: string;
  principal_usdc: number;
  /** Close-side 5 bps strategy fee. principal_usdc minus this = proceeds. */
  strategy_fee_bps: number;
  strategy_fee_usdc: number;
  expected_proceeds_usdc: number;
  note_pda: string;
  transaction_base64: string;
  recent_blockhash: string;
  last_valid_block_height: number;
}

export interface PpnRedeemConfirmResponse {
  vault_id: string;
  bundle_id: string;
  wallet_address: string;
  principal_returned: number;
  signature: string;
  transaction_id: string | null;
}

export interface PpnDivestPrepareResponse {
  kind: "prepared";
  vault_id: string;
  bundle_id: string;
  wallet_address: string;
  strategy_fee_bps: number;
  /** Pre-trade estimate; on-chain handler computes the real fee. */
  estimated_strategy_fee_usdc: number;
  note_pda: string;
  transaction_base64: string;
  recent_blockhash: string;
  last_valid_block_height: number;
}

export interface PpnDivestConfirmResponse {
  vault_id: string;
  bundle_id: string;
  wallet_address: string;
  signature: string;
  /** Always "active" — vault sleeve stays live after divest. */
  status: "active";
}

export interface PpnClosePrepareResponse {
  kind: "prepared";
  vault_id: string;
  bundle_id: string;
  wallet_address: string;
  principal_usdc: number;
  strategy_fee_bps: number;
  estimated_strategy_fee_usdc: number;
  estimated_net_usdc: number;
  note_pda: string;
  transaction_base64: string;
  recent_blockhash: string;
  last_valid_block_height: number;
}

export interface PpnCloseConfirmResponse {
  vault_id: string;
  bundle_id: string;
  wallet_address: string;
  principal_returned: number;
  signature: string;
  transaction_id: string | null;
  status: "withdrawn";
}

export interface TrancheSellRfqQuote {
  vault_id: string;
  bundle_id?: string;
  tranche_kind?: "senior" | "mezzanine" | "junior" | null;
  status: "can_execute_onchain" | "rfq_only" | "missing";
  /** True when the note has already hit its maturity_ts — routes through
   *  redeem_at_maturity. False means close_early is the right path. */
  matured?: boolean;
  maturity_ts?: number;
  seconds_remaining?: number;
  entry_price_per_token?: number;
  /** MM-desk indicative quote — what a real market maker would offer for
   *  an early exit given duration, tier, and adverse-selection tilt.
   *  Typically 93-99% of face value. The market-realistic price, not
   *  what this demo's on-chain program actually pays out. */
  indicative_price_per_token?: number;
  indicative_price_pct?: number;
  indicative_usdc?: number;
  mm_spread_bps?: number;
  slippage_bps?: number;
  underwriting_bps?: number;
  total_haircut_bps?: number;
  /** Honest on-chain settlement preview. close_early /
   *  redeem_at_maturity charge only the 30 bps basket-exit haircut
   *  (pre-maturity) + 5 bps strategy fee, so this sits much closer to
   *  100% of principal than the MM indicative above. This is what the
   *  wallet will actually receive when the tx confirms. */
  onchain_expected_usdc?: number;
  onchain_gross_usdc?: number;
  onchain_basket_exit_fee_bps?: number;
  onchain_strategy_fee_bps?: number;
  error?: string;
}

export interface TrancheSellRfqResponse {
  kind: "rfq";
  quotes: TrancheSellRfqQuote[];
  executable_count: number;
}

// ---------- Two-step primitives ----------

export interface TrancheOverlay {
  /** Tranche kind selects which payoff slice the note represents. */
  kind: "senior" | "mezzanine" | "junior";
  /**
   * Fraction of basket payout where this tranche starts earning, 0–1.
   * Matches ppn_vaults.tranche_attach in Supabase.
   */
  attach: number;
  /**
   * Fraction of basket payout where this tranche tops out, 0–1.
   * Must be strictly greater than `attach`.
   */
  detach: number;
  /** Issue price per $1 face, captured at the moment of purchase. */
  pricePerToken: number;
}

export async function preparePpnDeposit(args: {
  bundleId: string;
  walletAddress: string;
  amountUsdc: number;
  maturityDays?: number;
  /** Optional tranche overlay — passed through to /ppn/onchain/prepare. */
  tranche?: TrancheOverlay;
}): Promise<PpnPrepareResponse> {
  const uuid = await resolveBundleUuidForPpn(args.bundleId);
  const body: Record<string, unknown> = {
    bundle_id: uuid,
    wallet_address: args.walletAddress,
    amount_usdc: args.amountUsdc,
    maturity_days: args.maturityDays ?? 30,
  };
  if (args.tranche) {
    body.tranche_kind = args.tranche.kind;
    body.tranche_attach = args.tranche.attach;
    body.tranche_detach = args.tranche.detach;
    body.price_per_token = args.tranche.pricePerToken;
  }
  return postJson<PpnPrepareResponse>("/api/ppn/onchain/prepare", body);
}

export async function confirmPpnDeposit(args: {
  vaultId: string;
  signature: string;
}): Promise<PpnConfirmResponse> {
  return postJson<PpnConfirmResponse>("/api/ppn/onchain/confirm", {
    vault_id: args.vaultId,
    signature: args.signature,
  });
}

export async function preparePpnRedeem(
  args:
    | { vaultId: string; walletAddress: string }
    | { bundleId: string; walletAddress: string },
): Promise<PpnRedeemPrepareResponse> {
  const body: Record<string, unknown> = {};
  if ("vaultId" in args) {
    body.vault_id = args.vaultId;
    body.wallet_address = args.walletAddress;
  } else {
    body.bundle_id = await resolveBundleUuidForPpn(args.bundleId);
    body.wallet_address = args.walletAddress;
  }
  return postJson<PpnRedeemPrepareResponse>("/api/ppn/onchain/redeem/prepare", body);
}

export async function confirmPpnRedeem(args: {
  vaultId: string;
  signature: string;
  walletAddress?: string;
}): Promise<PpnRedeemConfirmResponse> {
  return postJson<PpnRedeemConfirmResponse>("/api/ppn/onchain/redeem/confirm", {
    vault_id: args.vaultId,
    signature: args.signature,
    wallet_address: args.walletAddress,
  });
}

export async function preparePpnDivest(args: {
  vaultId: string;
  walletAddress: string;
}): Promise<PpnDivestPrepareResponse> {
  return postJson<PpnDivestPrepareResponse>("/api/ppn/onchain/divest/prepare", {
    vault_id: args.vaultId,
    wallet_address: args.walletAddress,
  });
}

export async function confirmPpnDivest(args: {
  vaultId: string;
  signature: string;
  walletAddress?: string;
}): Promise<PpnDivestConfirmResponse> {
  return postJson<PpnDivestConfirmResponse>("/api/ppn/onchain/divest/confirm", {
    vault_id: args.vaultId,
    signature: args.signature,
    wallet_address: args.walletAddress,
  });
}

export async function preparePpnClose(args: {
  vaultId: string;
  walletAddress: string;
  /** Slippage guard in UI USDC (e.g. 0.5 = 500,000 base units). */
  minProceedsUsdc?: number;
}): Promise<PpnClosePrepareResponse> {
  return postJson<PpnClosePrepareResponse>("/api/ppn/onchain/close/prepare", {
    vault_id: args.vaultId,
    wallet_address: args.walletAddress,
    min_proceeds_usdc: args.minProceedsUsdc,
  });
}

export async function confirmPpnClose(args: {
  vaultId: string;
  signature: string;
  walletAddress?: string;
}): Promise<PpnCloseConfirmResponse> {
  return postJson<PpnCloseConfirmResponse>("/api/ppn/onchain/close/confirm", {
    vault_id: args.vaultId,
    signature: args.signature,
    wallet_address: args.walletAddress,
  });
}

export async function fetchTrancheSellRfq(args: {
  vaultIds: string[];
  walletAddress: string;
}): Promise<TrancheSellRfqResponse> {
  return postJson<TrancheSellRfqResponse>("/api/ppn/tranche/sell/rfq", {
    vault_ids: args.vaultIds,
    wallet_address: args.walletAddress,
  });
}

// ---------- Portfolio passthrough ----------

export interface PpnPortfolioEntry {
  vault_id: string;
  bundle_id: string;
  bundle_name: string;
  bundle_status: string;
  principal_usdc: number;
  yield_deployed_usdc: number;
  accrued_yield: number;
  projected_total_yield: number;
  estimated_apy: number;
  status: "active" | "matured" | "withdrawn";
  days_elapsed: number;
  days_remaining: number;
  maturity_date: string;
  created_at: string;
  total_value: number;
  tranche_kind: "senior" | "mezzanine" | "junior" | null;
  tranche_attach: number | null;
  tranche_detach: number | null;
  price_per_token: number | null;
}

export interface PpnPortfolio {
  wallet_address: string;
  vaults: PpnPortfolioEntry[];
  summary: {
    total_vaults: number;
    total_principal: number;
    total_accrued_yield: number;
    total_value: number;
    principal_protected: boolean;
  };
}

export async function fetchPpnPortfolio(walletAddress: string): Promise<PpnPortfolio> {
  const res = await fetch(
    `${BACKEND_URL}/api/ppn/portfolio/${encodeURIComponent(walletAddress)}`,
  );
  if (!res.ok) {
    throw new PpnError(`Failed to load PPN portfolio (HTTP ${res.status})`, res.status);
  }
  return (await res.json()) as PpnPortfolio;
}

// ---------- End-to-end wrappers ----------

/**
 * Minimal wallet surface required for the end-to-end helpers. Mirrors
 * `DepositClient#WalletSigner` so the UI can pass the `useWallet()` result
 * to either client without a wrapper.
 */
export interface WalletSigner {
  publicKey: { toBase58(): string } | null;
  signAndSendBase64Tx: (txBase64: string) => Promise<string>;
  waitForConfirmation: (signature: string, timeoutMs?: number) => Promise<boolean>;
}

/**
 * End-to-end PPN deposit: prepare → sign → confirm on-chain → persist.
 */
export async function ppnDeposit(args: {
  wallet: WalletSigner;
  bundleId: string;
  amountUsdc: number;
  maturityDays?: number;
  confirmationTimeoutMs?: number;
  /** Optional tranche overlay — tranche buys flow through this same rail. */
  tranche?: TrancheOverlay;
}): Promise<{
  signature: string;
  prepare: PpnPrepareResponse;
  confirm: PpnConfirmResponse;
}> {
  const { wallet, bundleId, amountUsdc } = args;
  if (IS_SUI) {
    const owner = wallet.publicKey?.toBase58() ?? SUI_ACTIVE_ADDRESS;
    const product = args.tranche ? `TRANCHE-${args.tranche.kind}` : "PPN";
    const opened = await openSuiBasketPosition({
      bundleId: `${product}-${bundleId}`,
      amountUsdc,
      recipient: owner,
    });
    const vaultId = `${opened.market_id}::${opened.position_id}`;
    const sig = opened.digests.buy ?? opened.digests.create_market ?? opened.digests.mint ?? opened.market_id;
    const now = Date.now();
    const maturityDays = args.maturityDays ?? 30;
    const prepare: PpnPrepareResponse = {
      kind: "prepared",
      vault_id: vaultId,
      bundle_id: bundleId,
      wallet_address: owner,
      amount_usdc: amountUsdc,
      management_fee_bps: 10,
      management_fee_usdc: amountUsdc * 0.001,
      strategy_fee_bps: 5,
      strategy_fee_usdc: amountUsdc * 0.0005,
      total_open_fee_usdc: amountUsdc * 0.0015,
      net_deposit_usdc: amountUsdc * 0.9985,
      estimated_apy: 8,
      maturity_date: new Date(now + maturityDays * 86_400_000).toISOString(),
      maturity_ts: Math.floor((now + maturityDays * 86_400_000) / 1000),
      note_pda: opened.position_id,
      note_seed_hex: opened.market_id,
      adapter_pda: opened.market_id,
      adapter_pool: "sui-local-mock-usdc",
      trax_mint: opened.position_id,
      trax_vault: opened.market_id,
      transaction_base64: "",
      recent_blockhash: opened.digests.create_market ?? "",
      last_valid_block_height: 0,
    };
    const confirm: PpnConfirmResponse = {
      vault_id: vaultId,
      bundle_id: bundleId,
      wallet_address: owner,
      principal_usdc: amountUsdc,
      signature: sig,
      transaction_id: sig,
    };
    return { signature: sig, prepare, confirm };
  }
  if (!wallet.publicKey) throw new PpnError("No wallet connected.", 0);

  const prep = await preparePpnDeposit({
    bundleId,
    walletAddress: wallet.publicKey.toBase58(),
    amountUsdc,
    maturityDays: args.maturityDays,
    tranche: args.tranche,
  });

  const sig = await wallet.signAndSendBase64Tx(prep.transaction_base64);
  const ok = await wallet.waitForConfirmation(sig, args.confirmationTimeoutMs ?? 60_000);
  if (!ok) throw new PpnError("Timed out waiting for PPN deposit confirmation.", 0);

  const confirm = await confirmPpnDeposit({ vaultId: prep.vault_id, signature: sig });
  return { signature: sig, prepare: prep, confirm };
}

/**
 * End-to-end PPN redeem at maturity: prepare → sign → confirm → persist.
 * Accepts either a pre-resolved vault_id, or the (bundleId, walletAddress)
 * pair if the UI only knows the bundle. The backend looks up the active note.
 */
export async function ppnRedeem(args: {
  wallet: WalletSigner;
  /** If known: the exact vault_id to redeem. */
  vaultId?: string;
  /** Otherwise the client will look up the active note for this bundle. */
  bundleId?: string;
  confirmationTimeoutMs?: number;
}): Promise<{
  signature: string;
  prepare: PpnRedeemPrepareResponse;
  confirm: PpnRedeemConfirmResponse;
}> {
  const { wallet } = args;
  if (IS_SUI) {
    const owner = wallet.publicKey?.toBase58() ?? SUI_ACTIVE_ADDRESS;
    const [marketId, positionId] = String(args.vaultId ?? "").split("::");
    if (!marketId || !positionId) throw new PpnError("Missing local Sui PPN position ids.", 404);
    const redeemed = await redeemSuiBasketPosition({ marketId, positionId });
    const sig = redeemed.digests.claim ?? redeemed.digests.resolve ?? marketId;
    const prepare: PpnRedeemPrepareResponse = {
      kind: "prepared",
      vault_id: args.vaultId!,
      bundle_id: args.bundleId ?? marketId,
      wallet_address: owner,
      principal_usdc: 0,
      strategy_fee_bps: 5,
      strategy_fee_usdc: 0,
      expected_proceeds_usdc: 0,
      note_pda: positionId,
      transaction_base64: "",
      recent_blockhash: redeemed.digests.resolve ?? "",
      last_valid_block_height: 0,
    };
    const confirm: PpnRedeemConfirmResponse = {
      vault_id: args.vaultId!,
      bundle_id: args.bundleId ?? marketId,
      wallet_address: owner,
      principal_returned: 0,
      signature: sig,
      transaction_id: sig,
    };
    return { signature: sig, prepare, confirm };
  }
  if (!wallet.publicKey) throw new PpnError("No wallet connected.", 0);

  const prep = args.vaultId
    ? await preparePpnRedeem({
        vaultId: args.vaultId,
        walletAddress: wallet.publicKey.toBase58(),
      })
    : await preparePpnRedeem({
        bundleId: args.bundleId!,
        walletAddress: wallet.publicKey.toBase58(),
      });

  const sig = await wallet.signAndSendBase64Tx(prep.transaction_base64);
  const ok = await wallet.waitForConfirmation(sig, args.confirmationTimeoutMs ?? 60_000);
  if (!ok) throw new PpnError("Timed out waiting for PPN redeem confirmation.", 0);

  const confirm = await confirmPpnRedeem({
    vaultId: prep.vault_id,
    signature: sig,
    walletAddress: wallet.publicKey.toBase58(),
  });
  return { signature: sig, prepare: prep, confirm };
}

/**
 * End-to-end PPN divest: prepare → sign → confirm → persist. Principal
 * stays in the yield adapter; the note keeps `status='active'`.
 */
export async function ppnDivest(args: {
  wallet: WalletSigner;
  vaultId: string;
  confirmationTimeoutMs?: number;
}): Promise<{
  signature: string;
  prepare: PpnDivestPrepareResponse;
  confirm: PpnDivestConfirmResponse;
}> {
  const { wallet, vaultId } = args;
  if (IS_SUI) {
    const redeemed = await ppnRedeem({ wallet, vaultId, confirmationTimeoutMs: args.confirmationTimeoutMs });
    return {
      signature: redeemed.signature,
      prepare: {
        kind: "prepared",
        vault_id: vaultId,
        bundle_id: redeemed.prepare.bundle_id,
        wallet_address: redeemed.prepare.wallet_address,
        strategy_fee_bps: 5,
        estimated_strategy_fee_usdc: 0,
        note_pda: redeemed.prepare.note_pda,
        transaction_base64: "",
        recent_blockhash: redeemed.prepare.recent_blockhash,
        last_valid_block_height: 0,
      },
      confirm: {
        vault_id: vaultId,
        bundle_id: redeemed.confirm.bundle_id,
        wallet_address: redeemed.confirm.wallet_address,
        signature: redeemed.signature,
        status: "active",
      },
    };
  }
  if (!wallet.publicKey) throw new PpnError("No wallet connected.", 0);

  const prep = await preparePpnDivest({
    vaultId,
    walletAddress: wallet.publicKey.toBase58(),
  });

  const sig = await wallet.signAndSendBase64Tx(prep.transaction_base64);
  const ok = await wallet.waitForConfirmation(
    sig,
    args.confirmationTimeoutMs ?? 60_000,
  );
  if (!ok) throw new PpnError("Timed out waiting for PPN divest confirmation.", 0);

  const confirm = await confirmPpnDivest({
    vaultId: prep.vault_id,
    signature: sig,
    walletAddress: wallet.publicKey.toBase58(),
  });
  return { signature: sig, prepare: prep, confirm };
}

/**
 * End-to-end PPN early close: prepare → sign → confirm → persist.
 * Withdraws principal AND basket sleeve, strategy fee applied, note marked
 * `withdrawn`. Skips the maturity gate `redeem_at_maturity` enforces.
 */
export async function ppnCloseEarly(args: {
  wallet: WalletSigner;
  vaultId: string;
  minProceedsUsdc?: number;
  confirmationTimeoutMs?: number;
}): Promise<{
  signature: string;
  prepare: PpnClosePrepareResponse;
  confirm: PpnCloseConfirmResponse;
}> {
  const { wallet, vaultId, minProceedsUsdc } = args;
  if (IS_SUI) {
    void minProceedsUsdc;
    const redeemed = await ppnRedeem({ wallet, vaultId, confirmationTimeoutMs: args.confirmationTimeoutMs });
    return {
      signature: redeemed.signature,
      prepare: {
        kind: "prepared",
        vault_id: vaultId,
        bundle_id: redeemed.prepare.bundle_id,
        wallet_address: redeemed.prepare.wallet_address,
        principal_usdc: 0,
        strategy_fee_bps: 5,
        estimated_strategy_fee_usdc: 0,
        estimated_net_usdc: 0,
        note_pda: redeemed.prepare.note_pda,
        transaction_base64: "",
        recent_blockhash: redeemed.prepare.recent_blockhash,
        last_valid_block_height: 0,
      },
      confirm: {
        vault_id: vaultId,
        bundle_id: redeemed.confirm.bundle_id,
        wallet_address: redeemed.confirm.wallet_address,
        principal_returned: 0,
        signature: redeemed.signature,
        transaction_id: redeemed.confirm.transaction_id,
        status: "withdrawn",
      },
    };
  }
  if (!wallet.publicKey) throw new PpnError("No wallet connected.", 0);

  const prep = await preparePpnClose({
    vaultId,
    walletAddress: wallet.publicKey.toBase58(),
    minProceedsUsdc,
  });

  const sig = await wallet.signAndSendBase64Tx(prep.transaction_base64);
  const ok = await wallet.waitForConfirmation(
    sig,
    args.confirmationTimeoutMs ?? 60_000,
  );
  if (!ok) throw new PpnError("Timed out waiting for PPN close confirmation.", 0);

  const confirm = await confirmPpnClose({
    vaultId: prep.vault_id,
    signature: sig,
    walletAddress: wallet.publicKey.toBase58(),
  });
  return { signature: sig, prepare: prep, confirm };
}

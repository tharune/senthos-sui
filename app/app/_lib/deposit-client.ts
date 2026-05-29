/**
 * Non-custodial deposit client.
 *
 * Calls the backend's `/api/deposit/prepare` endpoint to get an unsigned
 * transaction, hands it to Phantom to sign + submit, waits for the RPC to
 * confirm the signature, and finally calls `/api/deposit/confirm` so the
 * backend can persist the position + transaction rows.
 *
 * The backend builds the full Solana transaction (USDC transfer to vault
 * USDC-PDA + invoke of the traxis_vault::deposit instruction) so the
 * frontend doesn't need to know anything about PDA derivation or the
 * Anchor IDL. It's literally: prepare → sign → send → confirm.
 */

import { BACKEND_URL } from "./tokens";
import { IS_SUI, SUI_ACTIVE_ADDRESS } from "./chain";
import { openSuiBasketPosition, redeemSuiBasketPosition } from "./sui-client";

/**
 * The UI keys bundles by human name (`STHS-*` or legacy `LK-*`), but the
 * backend's deposit routes validate `bundle_id` as a UUID. We fetch
 * `/api/bundles` once, build a name → UUID map, and cache it for the session.
 *
 * Post seed.ts expansion the backend carries a dedicated bundle per
 * (tier, window) — `STHS-HIGH-SHORT`, `STHS-MID-MED`, `STHS-LOW-LONG`, etc.
 * — so an exact-name lookup is the happy path and every Constellation click
 * mints tokens for THAT specific constellation. Legacy LK-90-0430 and
 * LK-70-0515 rows are kept so historical on-chain positions remain
 * redeemable; clicking them as a fallback no longer happens once the STHS-*
 * rows are initialized.
 */

function normalizeName(name: string): string {
  // Pass through. The DB used to live with LK-* names pre-rebrand, but the
  // seed now emits STHS-TIER-WINDOW rows directly, so the STHS-* → LK-*
  // rewrite that used to live here would actively BREAK the exact-match
  // lookup below.
  return name;
}

type BundleSummary = {
  id: string;
  name: string;
  vault_pda: string | null;
  onchain_tx_signature: string | null;
};

let _bundleMap: Promise<Map<string, BundleSummary>> | null = null;

function loadBundleMap(force: boolean = false): Promise<Map<string, BundleSummary>> {
  if (force) _bundleMap = null;
  if (_bundleMap) return _bundleMap;
  _bundleMap = (async () => {
    const res = await fetch(`${BACKEND_URL}/api/bundles`);
    if (!res.ok) {
      _bundleMap = null;
      throw new DepositError(`Failed to load /api/bundles (HTTP ${res.status})`, res.status);
    }
    const rows = (await res.json()) as BundleSummary[];
    const map = new Map<string, BundleSummary>();
    for (const row of rows) {
      map.set(row.name, row);
    }
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

/**
 * Fallback: pick the best initialized bundle to route a synthetic-basket
 * deposit to. Prefers a bundle whose tier matches the click; otherwise
 * falls back to any initialized bundle (vault_pda != null).
 */
function pickFallbackBundle(
  map: Map<string, BundleSummary>,
  uiBundleId: string,
): BundleSummary | null {
  const initialized = Array.from(map.values()).filter((b) => b.vault_pda);
  if (initialized.length === 0) return null;
  const tier = tierFromName(uiBundleId);
  if (tier !== null) {
    const tierMatch = initialized.find((b) => {
      const t = tierFromName(b.name);
      return t === tier;
    });
    if (tierMatch) return tierMatch;
  }
  // No tier match — return the first initialized bundle as a last resort
  // so Buy still executes a real on-chain tx.
  return initialized[0];
}

export async function resolveBundleUuid(uiBundleId: string): Promise<string> {
  // Direct UUID passthrough (live baskets would do this once they carry one).
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uiBundleId)) {
    return uiBundleId;
  }
  const dbName = normalizeName(uiBundleId);
  const map = await loadBundleMap();
  const exact = map.get(dbName);
  if (exact) return exact.id;

  const fallback = pickFallbackBundle(map, uiBundleId);
  if (fallback) {
    // Only log in browser, not during SSR.
    if (typeof window !== "undefined") {
      console.warn(
        `[deposit-client] Basket "${uiBundleId}" not in backend; routing deposit to initialized bundle "${fallback.name}" (${fallback.id}).`,
      );
    }
    return fallback.id;
  }

  throw new DepositError(
    `Bundle "${dbName}" not found on backend and no initialized fallback is available. The backend currently has ${map.size} bundle(s): ${Array.from(map.keys()).join(", ") || "(none)"}`,
    404,
  );
}

export interface DepositPrepareResponse {
  kind: "prepared";
  bundle_id: string;
  wallet_address: string;
  amount_usdc: number;
  fee_usdc: number;
  net_usdc: number;
  issue_price: number;
  /** STHS tokens the user will receive (UI units). */
  tokens_minted: number;
  expected_tokens: number;
  /** Base64-encoded serialized Solana transaction, unsigned. */
  transaction_base64: string;
  vault_pda: string;
  trax_mint: string;
  recent_blockhash: string;
  last_valid_block_height: number;
}

export interface DepositConfirmResponse {
  transaction_id: string;
  bundle_id: string;
  tokens_minted: number;
  issue_price: number;
  fee_usdc: number;
  net_usdc: number;
}

export interface RedeemPrepareResponse {
  kind: "prepared";
  bundle_id: string;
  wallet_address: string;
  /** Total STHS tokens (UI units) that will be burned and paid out. */
  total_tokens: number;
  /** USDC the user will receive (UI units). */
  expected_usdc: number;
  /** `active_early` = pool pro-rata exit before finalize; `finalized` = outcome payout. */
  redeem_kind?: "finalized" | "active_early";
  /** Portion of gross sent to fee recipient on early exit (UI USDC). */
  exit_fee_usdc?: number;
  /** Base64-encoded serialized Solana transaction, unsigned. */
  transaction_base64: string;
  vault_pda: string;
  trax_mint: string;
  recent_blockhash: string;
  last_valid_block_height: number;
}

export interface RedeemConfirmResponse {
  wallet_address: string;
  bundle_id: string;
  total_tokens: number;
  payout_usdc: number;
  transaction_id?: string;
}

export class DepositError extends Error {
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
    throw new DepositError(msg, res.status, payload);
  }
  return payload as T;
}

/**
 * Ask the backend to build the deposit transaction. Does NOT write anything
 * to the DB yet — that happens in {@link confirmDeposit} after the chain
 * confirms the signature.
 */
export async function prepareDeposit(args: {
  bundleId: string;
  walletAddress: string;
  amountUsdc: number;
}): Promise<DepositPrepareResponse> {
  const uuid = await resolveBundleUuid(args.bundleId);
  // NOTE: Previously tried to dynamically import `cacheBundleDisplayName`
  // from portfolio-client to persist the synthetic-id → UUID mapping. That
  // export never existed (TS2339) and the try/catch swallowed the failure
  // at runtime, so the feature was dead code. Removed to unblock typecheck;
  // the portfolio page already resolves names via `resolveBasket` and the
  // on-chain bundle catalog, so no user-visible regression.
  return postJson<DepositPrepareResponse>("/api/deposit/prepare", {
    bundle_id: uuid,
    wallet_address: args.walletAddress,
    amount_usdc: args.amountUsdc,
  });
}

/**
 * Persist the deposit to the backend once we have a confirmed signature.
 * The backend re-verifies the signature against the chain before writing.
 */
export async function confirmDeposit(args: {
  bundleId: string;
  walletAddress: string;
  amountUsdc: number;
  signature: string;
  tokensMinted: number;
  issuePrice: number;
  feeUsdc: number;
}): Promise<DepositConfirmResponse> {
  const uuid = await resolveBundleUuid(args.bundleId);
  return postJson<DepositConfirmResponse>("/api/deposit/confirm", {
    bundle_id: uuid,
    wallet_address: args.walletAddress,
    amount_usdc: args.amountUsdc,
    signature: args.signature,
    tokens_minted: args.tokensMinted,
    issue_price: args.issuePrice,
    fee_usdc: args.feeUsdc,
  });
}

// ---------------------------------------------------------------------------
// Redeem (sell) flow
// ---------------------------------------------------------------------------
//
// • **Active vault:** backend builds `exit_active` — burn TRAX for a pro-rata
//   share of the vault USDC pool (net of a small combined on-chain exit fee).
// • **Finalized vault:** backend builds `redeem` — payout uses
//   `final_payout_per_token` after leg resolution.
//
// Partial exits are supported: pass `amount_tokens` on prepare; otherwise the
// backend uses the full tracked position.
//
// Typical UI flow:
//
//     const prep = await prepareRedeem({bundleId, walletAddress});
//     const sig  = await wallet.signAndSendBase64Tx(prep.transaction_base64);
//     await wallet.waitForConfirmation(sig);
//     await confirmRedeem({bundleId, walletAddress, signature: sig, expectedUsdc: prep.expected_usdc});
//
// Or just call {@link redeemFromBundle} which does all four steps for you.

/**
 * Ask the backend to build the sell/redeem transaction (active → `exit_active`,
 * finalized → `redeem`).
 */
export async function prepareRedeem(args: {
  bundleId: string;
  walletAddress: string;
  amountTokens?: number;
}): Promise<RedeemPrepareResponse> {
  const uuid = await resolveBundleUuid(args.bundleId);
  return postJson<RedeemPrepareResponse>("/api/deposit/redeem/prepare", {
    bundle_id: uuid,
    wallet_address: args.walletAddress,
    ...(args.amountTokens != null ? { amount_tokens: args.amountTokens } : {}),
  });
}

/**
 * Persist the redeem once we have a confirmed signature. The backend sets
 * the user's positions to 0 tokens and inserts a redemption transaction row.
 */
export async function confirmRedeem(args: {
  bundleId: string;
  walletAddress: string;
  signature: string;
  expectedUsdc: number;
  tokensRedeemed?: number;
}): Promise<RedeemConfirmResponse> {
  const uuid = await resolveBundleUuid(args.bundleId);
  return postJson<RedeemConfirmResponse>("/api/deposit/redeem/confirm", {
    bundle_id: uuid,
    wallet_address: args.walletAddress,
    signature: args.signature,
    expected_usdc: args.expectedUsdc,
    ...(args.tokensRedeemed != null ? { tokens_redeemed: args.tokensRedeemed } : {}),
  });
}

/**
 * Signature of the minimal wallet API we need for the end-to-end helpers.
 * Accepts the object returned by `useWallet()` — no direct dependency on
 * `wallet.tsx` so this file stays server-safe.
 */
export interface WalletSigner {
  publicKey: { toBase58(): string } | null;
  signAndSendBase64Tx: (txBase64: string) => Promise<string>;
  waitForConfirmation: (signature: string, timeoutMs?: number) => Promise<boolean>;
}

/**
 * End-to-end deposit: prepare → sign → confirm on-chain → persist.
 * Returns the confirmed signature so the caller can link to Explorer.
 */
export async function depositIntoBundle(args: {
  wallet: WalletSigner;
  bundleId: string;
  amountUsdc: number;
  /** Live NAV at deposit time — recorded as the virtual position's cost basis. */
  navAtDeposit?: number;
  confirmationTimeoutMs?: number;
  /** Called with each lifecycle stage so the UI can show granular progress. */
  onStage?: (stage: "preparing" | "signing" | "confirming" | "persisting") => void;
}): Promise<{
  signature: string;
  prepare: DepositPrepareResponse;
  confirm: DepositConfirmResponse;
}> {
  const { wallet, bundleId, amountUsdc } = args;
  if (IS_SUI) {
    args.onStage?.("preparing");
    const owner = wallet.publicKey?.toBase58() ?? SUI_ACTIVE_ADDRESS;
    const tokensMinted = amountUsdc / Math.max(args.navAtDeposit ?? 1, 0.000001);
    const opened = await openSuiBasketPosition({
      bundleId,
      amountUsdc,
      recipient: owner,
    });
    const sig = opened.digests.buy ?? opened.digests.create_market ?? opened.digests.mint ?? opened.market_id;

    try {
      const { recordVirtualPosition } = await import("./virtual-positions");
      recordVirtualPosition({
        wallet: owner,
        uuid: opened.market_id,
        uiBundleId: bundleId,
        tokens: tokensMinted,
        depositedUsdc: amountUsdc,
        navAtDeposit: args.navAtDeposit ?? 1,
        signature: sig,
        createdAt: Date.now(),
        chain: "sui",
        marketId: opened.market_id,
        positionId: opened.position_id,
      });
    } catch {
      // The local ledger is a convenience layer for the UI, not a chain write.
    }

    args.onStage?.("confirming");
    args.onStage?.("persisting");
    return {
      signature: sig,
      prepare: {
        kind: "prepared",
        bundle_id: opened.market_id,
        wallet_address: owner,
        amount_usdc: amountUsdc,
        fee_usdc: 0,
        net_usdc: amountUsdc,
        issue_price: args.navAtDeposit ?? 1,
        tokens_minted: tokensMinted,
        expected_tokens: tokensMinted,
        transaction_base64: "",
        vault_pda: opened.market_id,
        trax_mint: opened.position_id,
        recent_blockhash: opened.digests.create_market ?? "",
        last_valid_block_height: 0,
      },
      confirm: {
        transaction_id: sig,
        bundle_id: opened.market_id,
        tokens_minted: tokensMinted,
        issue_price: args.navAtDeposit ?? 1,
        fee_usdc: 0,
        net_usdc: amountUsdc,
      },
    };
  }
  if (!wallet.publicKey) throw new DepositError("No wallet connected.", 0);

  args.onStage?.("preparing");
  const prep = await prepareDeposit({
    bundleId,
    walletAddress: wallet.publicKey.toBase58(),
    amountUsdc,
  });

  args.onStage?.("signing");
  const sig = await wallet.signAndSendBase64Tx(prep.transaction_base64);

  args.onStage?.("confirming");
  const ok = await wallet.waitForConfirmation(sig, args.confirmationTimeoutMs ?? 60_000);
  if (!ok) throw new DepositError("Timed out waiting for deposit confirmation.", 0);

  args.onStage?.("persisting");
  const confirm = await confirmDeposit({
    bundleId,
    walletAddress: wallet.publicKey.toBase58(),
    amountUsdc,
    signature: sig,
    tokensMinted: prep.tokens_minted,
    issuePrice: prep.issue_price,
    feeUsdc: prep.fee_usdc,
  });

  // Record a virtual position with the UI-level bundle id the user clicked
  // and the NAV observed at deposit time. The portfolio groups by UI bundle
  // id so multiple windows of the same tier stay separate in the UI even
  // though they share one on-chain vault; using navAtDeposit as the cost
  // basis keeps PnL flat at zero on the instant of deposit.
  try {
    const { recordVirtualPosition } = await import("./virtual-positions");
    recordVirtualPosition({
      wallet: wallet.publicKey.toBase58(),
      uuid: prep.bundle_id,
      uiBundleId: bundleId,
      tokens: prep.tokens_minted,
      depositedUsdc: amountUsdc,
      navAtDeposit: args.navAtDeposit ?? prep.issue_price,
      signature: sig,
      createdAt: Date.now(),
    });
  } catch {
    // Non-fatal: the virtual ledger is a UX nicety, not a source of truth.
  }

  return { signature: sig, prepare: prep, confirm };
}

/**
 * End-to-end redeem: prepare → sign → confirm on-chain → persist.
 * Returns the confirmed signature so the caller can link to Explorer.
 */
export async function redeemFromBundle(args: {
  wallet: WalletSigner;
  bundleId: string;
  amountTokens?: number;
  confirmationTimeoutMs?: number;
  onStage?: (stage: "preparing" | "signing" | "confirming" | "persisting") => void;
}): Promise<{
  signature: string;
  prepare: RedeemPrepareResponse;
  confirm: RedeemConfirmResponse;
}> {
  const { wallet, bundleId } = args;
  if (IS_SUI) {
    const owner = wallet.publicKey?.toBase58() ?? SUI_ACTIVE_ADDRESS;
    args.onStage?.("preparing");
    const { getVirtualPositions, clearVirtualPositionBySuiIds } = await import("./virtual-positions");
    const candidate = getVirtualPositions(owner).find(
      (p) => p.chain === "sui" && p.uiBundleId === bundleId && p.marketId && p.positionId,
    );
    if (!candidate?.marketId || !candidate.positionId) {
      throw new DepositError("No local Sui position found for this basket.", 404);
    }
    const redeemed = await redeemSuiBasketPosition({
      marketId: candidate.marketId,
      positionId: candidate.positionId,
    });
    const sig = redeemed.digests.claim ?? redeemed.digests.resolve ?? candidate.marketId;
    clearVirtualPositionBySuiIds(owner, candidate.marketId, candidate.positionId);
    args.onStage?.("confirming");
    args.onStage?.("persisting");
    return {
      signature: sig,
      prepare: {
        kind: "prepared",
        bundle_id: candidate.marketId,
        wallet_address: owner,
        total_tokens: candidate.tokens,
        expected_usdc: candidate.depositedUsdc,
        redeem_kind: "finalized",
        exit_fee_usdc: 0,
        transaction_base64: "",
        vault_pda: candidate.marketId,
        trax_mint: candidate.positionId,
        recent_blockhash: redeemed.digests.resolve ?? "",
        last_valid_block_height: 0,
      },
      confirm: {
        wallet_address: owner,
        bundle_id: candidate.marketId,
        total_tokens: candidate.tokens,
        payout_usdc: candidate.depositedUsdc,
        transaction_id: sig,
      },
    };
  }
  if (!wallet.publicKey) throw new DepositError("No wallet connected.", 0);

  args.onStage?.("preparing");
  const prep = await prepareRedeem({
    bundleId,
    walletAddress: wallet.publicKey.toBase58(),
    amountTokens: args.amountTokens,
  });

  args.onStage?.("signing");
  const sig = await wallet.signAndSendBase64Tx(prep.transaction_base64);

  args.onStage?.("confirming");
  const ok = await wallet.waitForConfirmation(sig, args.confirmationTimeoutMs ?? 60_000);
  if (!ok) throw new DepositError("Timed out waiting for redeem confirmation.", 0);

  args.onStage?.("persisting");
  const confirm = await confirmRedeem({
    bundleId,
    walletAddress: wallet.publicKey.toBase58(),
    signature: sig,
    expectedUsdc: prep.expected_usdc,
    tokensRedeemed: args.amountTokens,
  });

  return { signature: sig, prepare: prep, confirm };
}

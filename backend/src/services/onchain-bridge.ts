/**
 * Bridge between DB state (Supabase) and on-chain state (traxis_vault program).
 *
 * Called in three places:
 *   1. Bundle creation (bundles.ts route) — after writing a new bundle to the DB,
 *      creates the onchain vault and stores its PDA / mint / usdc_vault back on
 *      the `bundles` row.
 *   2. Pricing cron (pricing.ts) — after a leg is marked resolved in DB, mirrors
 *      the resolution to chain via `resolve_leg`.
 *   3. Helius webhook (webhook.ts) — same as #2 but pushed from Solana rather
 *      than pulled from Polymarket polling.
 *
 * All onchain calls are fire-and-forget with retries: if the chain call fails
 * we log + alert, DB state is still the source of truth for the UI.
 */
import { supabase } from "../db/supabase";
import {
  getBundleById,
  getLegsByBundleId,
  updateBundleStatus,
} from "../db/queries";
import {
  finalizeVault as finalizeVaultOnchain,
  initializeVault,
  resolveLeg as resolveLegOnchain,
  derivedAddressesForBundle,
} from "./solana";

const RESOLVE_RETRIES = 3;
const RESOLVE_BACKOFF_MS = 1_500;

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Convert a market_id string (Polymarket conditionId, Kalshi ticker) to a 32-byte array. */
function marketIdToBytes(marketId: string): number[] {
  // If it's a 0x-prefixed 32-byte hex (Polymarket conditionId), parse directly.
  const trimmed = marketId.startsWith("0x") ? marketId.slice(2) : marketId;
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    const out: number[] = [];
    for (let i = 0; i < 32; i++) {
      out.push(parseInt(trimmed.slice(i * 2, i * 2 + 2), 16));
    }
    return out;
  }
  // Otherwise, hash the UTF-8 bytes to 32-byte array via SHA-256.
  const hash = require("crypto").createHash("sha256").update(marketId).digest();
  return Array.from(hash);
}

/**
 * Initialize the onchain vault for a bundle that already exists in the DB.
 * Idempotent: if `bundles.vault_pda` is already populated, returns without doing anything.
 */
export async function initializeOnchainVaultForBundle(
  bundleId: string,
): Promise<{ vaultPda: string; traxMint: string; usdcVault: string; signature: string } | null> {
  const bundle = await getBundleById(bundleId);
  if (!bundle) return null;

  const { data: row } = await supabase
    .from("bundles")
    .select("vault_pda, trax_mint, usdc_vault, onchain_tx_signature")
    .eq("id", bundleId)
    .single();
  if (row?.vault_pda && row?.trax_mint && row?.usdc_vault) {
    return {
      vaultPda: row.vault_pda,
      traxMint: row.trax_mint,
      usdcVault: row.usdc_vault,
      signature: row.onchain_tx_signature ?? "",
    };
  }

  const legs = await getLegsByBundleId(bundleId);
  if (legs.length === 0) {
    throw new Error(`Bundle ${bundleId} has no legs; cannot initialize onchain`);
  }

  // Assign leg_index in the order legs came back (stable sort by created_at).
  const sortedLegs = [...legs].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );

  // Persist leg_index to DB so downstream resolution path can look it up.
  await Promise.all(
    sortedLegs.map((leg, idx) =>
      supabase.from("legs").update({ leg_index: idx }).eq("id", leg.id),
    ),
  );

  const issuePriceBps = Math.round(bundle.issue_price * 10_000);

  // Normalize weights: scale sum of weights to 10_000 bps, correcting last leg for rounding.
  const totalWeight = sortedLegs.reduce((s, l) => s + (l.weight ?? 0), 0);
  const weightsBps = sortedLegs.map((l) =>
    Math.round(((l.weight ?? 0) / totalWeight) * 10_000),
  );
  const sumBps = weightsBps.reduce((s, w) => s + w, 0);
  weightsBps[weightsBps.length - 1] += 10_000 - sumBps;

  const legsArg = sortedLegs.map((l, i) => ({
    marketId: marketIdToBytes(l.market_id),
    weightBps: weightsBps[i],
  }));

  // Derive PDAs up-front so we can recover from a partially-initialized
  // on-chain state (e.g. vault PDA already allocated from a prior run but
  // the follow-up trax-mint / usdc-vault init instructions failed).
  const { deriveTraxMint, deriveUsdcVault, deriveVaultPda } = await import(
    "../solana/anchor"
  );
  const [vaultPdaKey] = deriveVaultPda(bundleId);
  const [traxMintKey] = deriveTraxMint(bundleId);
  const [usdcVaultKey] = deriveUsdcVault(bundleId);

  let res: { vaultPda: string; traxMint: string; usdcVault: string; signature: string };
  try {
    const initRes = await initializeVault({
      bundleId,
      issuePriceBps,
      feeBps: 50, // 0.5%
      riskTier: bundle.risk_tier as 50 | 70 | 90,
      resolutionDate: new Date(bundle.resolution_date),
      legs: legsArg,
    });
    res = initRes;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // If the vault account already exists from a prior run, move on to the
    // token-creation steps rather than failing the whole init.
    if (/already in use|already initialized/i.test(msg)) {
      console.log(
        `[onchain] initialize_vault: vault PDA already exists for ${bundleId}, continuing`,
      );
      res = {
        vaultPda: vaultPdaKey.toBase58(),
        traxMint: traxMintKey.toBase58(),
        usdcVault: usdcVaultKey.toBase58(),
        signature: "",
      };
    } else {
      throw err;
    }
  }

  // Steps 2 & 3: create the TRAX mint, then the USDC vault token account.
  // The Anchor program splits vault creation into three instructions — the
  // first builds the config PDA, the second builds the TRAX mint, the
  // third builds the USDC vault account. Each try_accounts frame must
  // stay under BPF's 4 KB stack limit; a two-instruction split was tight
  // on rustc 1.75 and overflows on rustc 1.89+, so we split further.
  const { initializeTraxMint, initializeVaultTokens } = await import(
    "../solana/client"
  );
  for (const [label, fn] of [
    ["initialize_trax_mint", initializeTraxMint],
    ["initialize_vault_tokens", initializeVaultTokens],
  ] as const) {
    try {
      await fn(bundleId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!/already in use|already initialized/i.test(msg)) {
        console.warn(`[onchain] ${label} failed for ${bundleId}:`, msg);
      }
    }
  }

  await supabase
    .from("bundles")
    .update({
      vault_pda: res.vaultPda,
      trax_mint: res.traxMint,
      usdc_vault: res.usdcVault,
      onchain_tx_signature: res.signature,
    })
    .eq("id", bundleId);

  return {
    vaultPda: res.vaultPda,
    traxMint: res.traxMint,
    usdcVault: res.usdcVault,
    signature: res.signature,
  };
}

/**
 * Mirror a DB leg resolution to chain. Looks up `leg_index` from the DB,
 * retries on transient failures, and stores the tx signature for audit.
 */
export async function resolveLegOnchainMirror(
  bundleId: string,
  legId: string,
  outcome: "won" | "lost",
): Promise<string | null> {
  // Load leg_index.
  const { data: leg } = await supabase
    .from("legs")
    .select("leg_index, onchain_resolved_at")
    .eq("id", legId)
    .single();
  if (!leg) {
    console.warn(`[onchain] leg ${legId} not found`);
    return null;
  }
  if (leg.onchain_resolved_at) {
    // Already mirrored; skip.
    return null;
  }
  if (leg.leg_index === null || leg.leg_index === undefined) {
    console.warn(`[onchain] leg ${legId} has no leg_index; initializeOnchainVaultForBundle first`);
    return null;
  }

  let lastErr: any = null;
  for (let attempt = 0; attempt < RESOLVE_RETRIES; attempt++) {
    try {
      const sig = await resolveLegOnchain(bundleId, leg.leg_index, outcome);
      await supabase
        .from("legs")
        .update({
          onchain_resolved_at: new Date().toISOString(),
          onchain_resolve_tx: sig,
        })
        .eq("id", legId);
      return sig;
    } catch (err) {
      lastErr = err;
      console.warn(
        `[onchain] resolve_leg failed (attempt ${attempt + 1}/${RESOLVE_RETRIES}):`,
        err,
      );
      await sleep(RESOLVE_BACKOFF_MS * (attempt + 1));
    }
  }
  console.error(`[onchain] resolve_leg gave up for leg ${legId}:`, lastErr);
  return null;
}

/**
 * If all legs of a bundle are resolved, call finalize_vault on-chain.
 * Idempotent via `onchain_finalized_at`.
 */
export async function finalizeBundleIfReady(bundleId: string): Promise<string | null> {
  const legs = await getLegsByBundleId(bundleId);
  if (legs.length === 0) return null;
  if (legs.some((l) => l.status !== "won" && l.status !== "lost")) return null;

  const { data: row } = await supabase
    .from("bundles")
    .select("onchain_finalized_at")
    .eq("id", bundleId)
    .single();
  if (row?.onchain_finalized_at) return null;

  try {
    const sig = await finalizeVaultOnchain(bundleId);
    await supabase
      .from("bundles")
      .update({
        onchain_finalized_at: new Date().toISOString(),
        onchain_finalize_tx: sig,
        status: "resolved",
      })
      .eq("id", bundleId);
    // Also update the logical status if not already.
    await updateBundleStatus(bundleId, "resolved");
    return sig;
  } catch (err) {
    console.error(`[onchain] finalize_vault failed for ${bundleId}:`, err);
    return null;
  }
}

export { derivedAddressesForBundle };

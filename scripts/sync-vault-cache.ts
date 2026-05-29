/**
 * Reconcile the `bundles` Supabase cache with on-chain PDAs derived from
 * the currently active cluster + program IDs.
 *
 * Why this exists: the shared Supabase project stores one `vault_pda` +
 * `trax_mint` + `usdc_vault` column per bundle row, so there's no
 * cluster dimension. If tooling initializes vaults on testnet it writes
 * testnet PDAs to the row; if the same tooling then runs on devnet it
 * writes devnet PDAs. Switching clusters silently corrupts the cache
 * for the other cluster.
 *
 * Backend tx-building is resilient — it derives PDAs fresh from current
 * program_id at tx-build time, ignoring the cache. But the frontend
 * reads `trax_mint` directly from /api/bundles to poll the user's STHS
 * balance (see `useStshBalances` in portfolio-client.ts), so a stale
 * mint address means "user deposits land correctly on-chain but their
 * STHS tokens never show up in the UI".
 *
 * This script fixes that by:
 *   1. Clearing every cached vault_pda/trax_mint/usdc_vault/onchain_tx_signature.
 *   2. Calling the onchain init-or-return bridge for each bundle, which
 *      derives PDAs from the current program_id + resolves them against
 *      the live chain (if the PDA already exists, the call idempotently
 *      returns it; if it doesn't, init_vault runs).
 *
 * Safe to run any time the cache feels stale. Idempotent on on-chain
 * state — won't create duplicate vaults.
 *
 * Usage:
 *   cd backend && npx tsx ../scripts/sync-vault-cache.ts
 */
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.join(__dirname, "..", "backend", ".env") });

import { initializeOnchainVaultForBundle } from "../backend/src/services/onchain-bridge";
import { supabase } from "../backend/src/db/supabase";

async function main() {
  console.log(`[sync] cluster=${process.env.SOLANA_CLUSTER} rpc=${process.env.SOLANA_RPC_URL}`);
  console.log(`[sync] vault_program=${process.env.TRAXIS_VAULT_PROGRAM_ID}`);
  console.log();

  // Step 1: clear any cached PDAs so the init bridge doesn't short-circuit
  // on a stale cache hit. Bundles with mismatched cached values get a
  // fresh derivation that matches the active cluster.
  const { data: active, error: aerr } = await supabase
    .from("bundles")
    .select("id, name")
    .eq("status", "active");
  if (aerr) throw new Error(aerr.message);
  if (!active || active.length === 0) {
    console.log("[sync] no active bundles. Did you run the seed?");
    return;
  }

  console.log(`[sync] clearing cache for ${active.length} active bundle(s)`);
  for (const b of active) {
    const { error } = await supabase
      .from("bundles")
      .update({
        vault_pda: null,
        trax_mint: null,
        usdc_vault: null,
        onchain_tx_signature: null,
      })
      .eq("id", b.id);
    if (error) {
      console.log(`  ✗ ${b.name}: ${error.message}`);
    } else {
      console.log(`  ✓ cleared ${b.name}`);
    }
  }

  console.log();
  console.log(`[sync] re-deriving + resolving vaults against devnet`);
  for (const b of active) {
    try {
      const res = await initializeOnchainVaultForBundle(b.id);
      if (!res) {
        console.log(`  ✗ ${b.name}: bridge returned null (missing legs?)`);
        continue;
      }
      console.log(
        `  ✓ ${b.name.padEnd(18)} vault=${res.vaultPda.slice(0, 12)}… mint=${res.traxMint.slice(0, 12)}…`,
      );
    } catch (err) {
      console.log(`  ✗ ${b.name}: ${(err as Error).message}`);
    }
  }

  console.log();
  console.log(`[sync] done. Hot-reload the frontend and refresh /app/portfolio`);
  console.log(`        to pick up the new trax_mint addresses.`);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);

/**
 * Reset Supabase rows that are cluster-scoped so the app can be re-seeded
 * against a different Solana cluster.
 *
 * What this wipes:
 *   - `ppn_vaults`  — every row (user notes + tranche positions; all carry
 *                     cluster-specific vault PDAs and tx signatures).
 *   - `positions`   — every row (cluster-scoped trade history).
 *   - `transactions` — every row with an `onchain_tx_signature` (stale sigs).
 *
 * What this nulls out (keeps the row, clears the on-chain pointers):
 *   - `bundles.vault_pda`, `bundles.trax_mint`, `bundles.usdc_vault`,
 *     `bundles.onchain_tx_signature`, `bundles.onchain_finalized_at`,
 *     `bundles.onchain_finalize_tx`
 *   - `legs.onchain_resolved_at`, `legs.onchain_resolve_tx`
 *
 * What this LEAVES alone:
 *   - `bundles` row definitions (name, risk_tier, legs, market IDs) — these
 *     are cluster-agnostic and you want them to persist across switches.
 *   - `legs.leg_index` and the leg → bundle link.
 *
 * Safety:
 *   - Requires SUPABASE_SERVICE_ROLE_KEY (not the anon key). The service role
 *     bypasses RLS and is the only way to truncate.
 *   - Prompts for `yes` confirmation before any destructive op (unless
 *     --yes is passed).
 *
 * Usage:
 *   npx tsx scripts/reset-cluster-state.ts
 *   npx tsx scripts/reset-cluster-state.ts --yes    (skip confirmation)
 *
 * Reads env from backend/.env (i.e. whichever cluster SWITCH-CLUSTER activated).
 */
import * as dotenv from "dotenv";
import * as path from "path";
import * as fs from "fs";
import * as readline from "readline";
import { createClient } from "@supabase/supabase-js";

const ENV_PATH = path.join(__dirname, "..", "backend", ".env");
if (!fs.existsSync(ENV_PATH)) {
  console.error(`backend/.env not found at ${ENV_PATH}`);
  console.error(`Run ./SWITCH-CLUSTER.command <devnet|testnet> first.`);
  process.exit(2);
}
dotenv.config({ path: ENV_PATH });

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const cluster = process.env.SOLANA_CLUSTER ?? "devnet";

if (!url) throw new Error("SUPABASE_URL missing in backend/.env");
if (!serviceKey) {
  throw new Error(
    "SUPABASE_SERVICE_ROLE_KEY missing in backend/.env. Find it at\n" +
      "Supabase Dashboard → Project Settings → API → service_role key.\n" +
      "Do NOT commit this key.",
  );
}

const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function rowCount(table: string): Promise<number> {
  const { count, error } = await supabase
    .from(table)
    .select("*", { count: "exact", head: true });
  if (error) {
    console.warn(`  (warn) could not count ${table}: ${error.message}`);
    return -1;
  }
  return count ?? 0;
}

async function confirm(prompt: string): Promise<boolean> {
  if (process.argv.includes("--yes")) return true;
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((res) => {
    rl.question(prompt, (ans) => {
      rl.close();
      res(ans.trim().toLowerCase() === "yes");
    });
  });
}

async function main() {
  console.log("=".repeat(68));
  console.log("  Reset cluster-scoped state for Supabase");
  console.log("=".repeat(68));
  console.log(`Supabase URL: ${url}`);
  console.log(`Active cluster (from backend/.env): ${cluster}`);
  console.log("");

  // Show BEFORE counts.
  console.log("Current row counts:");
  const tables = ["bundles", "legs", "ppn_vaults", "positions", "transactions"];
  for (const t of tables) {
    console.log(`  ${t.padEnd(16)} ${await rowCount(t)}`);
  }
  console.log("");

  const ok = await confirm(
    `Wipe ppn_vaults + positions + on-chain columns on bundles/legs/transactions?\n` +
      `This cannot be undone. Type "yes" to continue: `,
  );
  if (!ok) {
    console.log("Aborted.");
    process.exit(0);
  }

  // ── 1. TRUNCATE ppn_vaults ────────────────────────────────
  console.log("\n• Deleting all rows in ppn_vaults...");
  {
    const { error } = await supabase
      .from("ppn_vaults")
      // neq on a UUID col that exists guarantees "match all" (every UUID is
      // != the sentinel). PostgREST refuses unrestricted DELETEs.
      .delete()
      .neq("id", "00000000-0000-0000-0000-000000000000");
    if (error) console.warn(`  (warn) ${error.message}`);
  }

  // ── 2. TRUNCATE positions ─────────────────────────────────
  console.log("• Deleting all rows in positions...");
  {
    const { error } = await supabase
      .from("positions")
      .delete()
      .neq("id", "00000000-0000-0000-0000-000000000000");
    if (error) console.warn(`  (warn) ${error.message}`);
  }

  // ── 3. Clear on-chain sigs on transactions (keep rows for audit) ──
  console.log("• Clearing onchain_tx_signature on transactions...");
  {
    const { error } = await supabase
      .from("transactions")
      .update({ onchain_tx_signature: null })
      .not("onchain_tx_signature", "is", null);
    if (error) console.warn(`  (warn) ${error.message}`);
  }

  // ── 4. NULL out on-chain columns on bundles ───────────────
  console.log("• Nulling on-chain columns on bundles...");
  {
    const { error } = await supabase
      .from("bundles")
      .update({
        vault_pda: null,
        trax_mint: null,
        usdc_vault: null,
        onchain_tx_signature: null,
        onchain_finalized_at: null,
        onchain_finalize_tx: null,
      })
      .neq("id", "00000000-0000-0000-0000-000000000000");
    if (error) console.warn(`  (warn) ${error.message}`);
  }

  // ── 5. Clear on-chain columns on legs ─────────────────────
  console.log("• Clearing onchain_resolve_tx / onchain_resolved_at on legs...");
  {
    const { error } = await supabase
      .from("legs")
      .update({
        onchain_resolved_at: null,
        onchain_resolve_tx: null,
      })
      .not("onchain_resolved_at", "is", null);
    if (error) console.warn(`  (warn) ${error.message}`);
  }

  console.log("");
  console.log("Post-reset row counts:");
  for (const t of tables) {
    console.log(`  ${t.padEnd(16)} ${await rowCount(t)}`);
  }

  console.log("");
  console.log("=".repeat(68));
  console.log("Done. Next:");
  console.log("  - Reseed on the NEW cluster:");
  console.log("       ./DEPLOY-TO-TESTNET.command    (testnet)");
  console.log("       cd backend && npm run seed     (if bundles were emptied)");
  console.log("  - Or: just rerun scripts/init-demo-vaults.ts against the");
  console.log("    active cluster to re-populate bundles.vault_pda / trax_mint.");
  console.log("=".repeat(68));
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);

/**
 * One-off: null the cached vault_pda / trax_mint / usdc_vault / onchain_tx_signature
 * on every active bundle so initializeOnchainVaultForBundle will actually run
 * the on-chain init instead of short-circuiting on a devnet-era cache hit.
 *
 * Deposit/redeem code paths derive PDAs deterministically from bundle_id +
 * current program_id, so wiping these cache columns has no functional effect
 * on clusters where the vault IS initialized — subsequent inits will repopulate
 * them with the testnet-program addresses.
 */
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.join(__dirname, "..", "backend", ".env") });

import { supabase } from "../backend/src/db/supabase";

async function main() {
  const { data: bundles, error } = await supabase
    .from("bundles")
    .select("id, name, vault_pda, trax_mint")
    .eq("status", "active");
  if (error) throw new Error(error.message);
  if (!bundles || bundles.length === 0) {
    console.log("No active bundles.");
    return;
  }
  console.log(`Clearing on-chain cache on ${bundles.length} bundle(s):`);
  for (const b of bundles) {
    const { error: upErr } = await supabase
      .from("bundles")
      .update({
        vault_pda: null,
        trax_mint: null,
        usdc_vault: null,
        onchain_tx_signature: null,
      })
      .eq("id", b.id);
    if (upErr) {
      console.log(`  ✗ ${b.name} (${b.id}): ${upErr.message}`);
    } else {
      console.log(`  ✓ ${b.name} (${b.id})`);
    }
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);

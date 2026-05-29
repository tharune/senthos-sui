/**
 * Initialize onchain Traxis vaults for every bundle in Supabase that doesn't
 * yet have a vault_pda. Run this after:
 *
 *   1. scripts/deploy-devnet.sh        (programs live on devnet)
 *   2. backend schema_onchain.sql       (onchain columns added to Supabase)
 *   3. backend/npm run seed             (bundles + legs populated)
 *
 * Usage:
 *   cd backend && npm install
 *   cd .. && npx tsx scripts/init-demo-vaults.ts
 *
 * Env: reads backend/.env (same as backend itself).
 */
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.join(__dirname, "..", "backend", ".env") });

import { initializeOnchainVaultForBundle } from "../backend/src/services/onchain-bridge";
import { supabase } from "../backend/src/db/supabase";

async function main() {
  const { data: bundles, error } = await supabase
    .from("bundles")
    .select("id, name, vault_pda, status")
    .eq("status", "active")
    .order("created_at");
  if (error) throw new Error(error.message);
  if (!bundles || bundles.length === 0) {
    console.log("No active bundles found. Run `cd backend && npm run seed` first.");
    return;
  }

  for (const b of bundles) {
    if (b.vault_pda) {
      console.log(`${b.name}: already initialized (${b.vault_pda})`);
      continue;
    }
    console.log(`${b.name}: initializing onchain vault...`);
    try {
      const res = await initializeOnchainVaultForBundle(b.id);
      if (res) {
        console.log(`  ✓ vault=${res.vaultPda}`);
        console.log(`    mint=${res.traxMint}`);
        console.log(`    tx=${res.signature}`);
      } else {
        console.log(`  ✗ initialization returned null`);
      }
    } catch (err) {
      console.error(`  ✗ ${b.name}:`, err);
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

/**
 * Backfill: call `initialize_vault_tokens` on every bundle whose vault PDA
 * exists on-chain but whose TRAX mint + USDC vault DON'T.
 *
 * The Anchor vault program splits initialization into two steps:
 *   1. initialize_vault        — creates the vault config PDA
 *   2. initialize_vault_tokens — creates the TRAX mint + USDC vault token acct
 *
 * The STHS expansion only ran step (1), so every buy tx simulation hits
 * IncorrectProgramId when the ATA-create for the user's TRAX ATA tries to
 * read a non-existent mint account.
 *
 * Idempotent: skips vaults whose mint+usdc_vault already exist.
 *
 * Run from the `backend/` directory (where node_modules lives):
 *   cd backend && npx tsx ../scripts/init-vault-tokens-backfill.ts
 * or just use FIX-VAULTS.command at the repo root.
 */
import * as dotenv from "dotenv";
import * as path from "path";
dotenv.config({ path: path.join(__dirname, "..", "backend", ".env") });

import { Connection, PublicKey } from "@solana/web3.js";
import {
  deriveTraxMint,
  deriveUsdcVault,
  deriveVaultPda,
  getConfig,
} from "../backend/src/solana/anchor";
import { initializeVaultTokens } from "../backend/src/solana/client";
import { supabase } from "../backend/src/db/supabase";

async function main() {
  const cfg = getConfig();
  const conn = new Connection(cfg.rpcUrl, "confirmed");

  const { data: bundles, error } = await supabase
    .from("bundles")
    .select("id, name, vault_pda, trax_mint, status")
    .not("vault_pda", "is", null)
    .order("name");
  if (error) throw new Error(error.message);
  if (!bundles || bundles.length === 0) {
    console.log("No bundles with vault_pda found.");
    return;
  }

  let fixed = 0;
  let alreadyOk = 0;
  let skipped = 0;

  for (const b of bundles) {
    const [vaultPda] = deriveVaultPda(b.id);
    const [traxMint] = deriveTraxMint(b.id);
    const [usdcVault] = deriveUsdcVault(b.id);

    const [mintInfo, usdcInfo] = await Promise.all([
      conn.getAccountInfo(traxMint),
      conn.getAccountInfo(usdcVault),
    ]);

    if (mintInfo && usdcInfo) {
      console.log(`${b.name.padEnd(20)} ✓ mint+usdc already on-chain — skipping`);
      alreadyOk++;
      continue;
    }

    console.log(
      `${b.name.padEnd(20)} initializing tokens (mint=${mintInfo ? "✓" : "✗"} usdc=${usdcInfo ? "✓" : "✗"})`,
    );
    try {
      const sig = await initializeVaultTokens(b.id);
      console.log(`                     ✓ tx=${sig}`);

      if (!b.trax_mint) {
        await supabase
          .from("bundles")
          .update({
            trax_mint: traxMint.toBase58(),
            usdc_vault: usdcVault.toBase58(),
          })
          .eq("id", b.id);
      }
      fixed++;
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      // Anchor surfaces logs on the error — dump them so users can see why.
      const logs = err?.logs ? `\n                       logs: ${err.logs.slice(0, 5).join(" | ")}` : "";
      console.error(`                     ✗ ${msg}${logs}`);
      skipped++;
    }
  }

  console.log(`\nSummary: ${fixed} fixed · ${alreadyOk} already good · ${skipped} failed`);
  if (skipped > 0) process.exit(2);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error("FATAL:", err?.message ?? err);
    if (err?.logs) console.error("Logs:", err.logs);
    console.error(err?.stack ?? "");
    process.exit(1);
  },
);

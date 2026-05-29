/**
 * Simulate initialize_vault for the first bundle with CU bump + full logs.
 * Diagnostic helper - not idempotent, does not write to DB.
 */
import * as dotenv from "dotenv";
import * as path from "path";
dotenv.config({ path: path.join(__dirname, "..", "backend", ".env") });

import { BN } from "@coral-xyz/anchor";
import {
  ComputeBudgetProgram,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  Transaction,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { supabase } from "../backend/src/db/supabase";
import {
  getConfig,
  getConnection,
  getVaultProgram,
  bundleIdToSeed,
  deriveVaultPda,
  deriveTraxMint,
  deriveUsdcVault,
} from "../backend/src/solana/anchor";
import { getBundleById, getLegsByBundleId } from "../backend/src/db/queries";

async function main() {
  const { data: bundles } = await supabase
    .from("bundles")
    .select("id, name")
    .eq("status", "active")
    .order("created_at")
    .limit(1);
  const b = bundles?.[0];
  if (!b) throw new Error("no bundle");
  console.log(`Target bundle: ${b.name} (${b.id})`);

  const cfg = getConfig();
  const program = getVaultProgram();
  const bundle = await getBundleById(b.id);
  const legs = await getLegsByBundleId(b.id);
  console.log(`Legs count: ${legs.length}`);

  const bundleSeed = bundleIdToSeed(b.id);
  const [vaultPda] = deriveVaultPda(b.id);
  const [traxMint] = deriveTraxMint(b.id);
  const [usdcVault] = deriveUsdcVault(b.id);

  const issuePriceBps = Math.round((bundle!.issue_price as number) * 10_000);
  const totalWeight = legs.reduce((s, l) => s + (l.weight ?? 0), 0);
  const weightsBps = legs.map((l) => Math.round(((l.weight ?? 0) / totalWeight) * 10_000));
  const sumBps = weightsBps.reduce((s, w) => s + w, 0);
  weightsBps[weightsBps.length - 1] += 10_000 - sumBps;

  function marketIdToBytes(id: string): number[] {
    const trimmed = id.startsWith("0x") ? id.slice(2) : id;
    if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
      const out: number[] = [];
      for (let i = 0; i < 32; i++) out.push(parseInt(trimmed.slice(i * 2, i * 2 + 2), 16));
      return out;
    }
    const hash = require("crypto").createHash("sha256").update(id).digest();
    return Array.from(hash);
  }

  const legsArg = legs
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    .map((l, i) => ({
      marketId: marketIdToBytes(l.market_id),
      weightBps: weightsBps[i],
    }));

  const bumpCu = ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 });

  console.log("\n---simulate via anchor methods---");
  try {
    const sim = await program.methods
      .initializeVault({
        bundleSeed: Array.from(bundleSeed),
        issuePriceBps,
        feeBps: 50,
        riskTier: bundle!.risk_tier as 50 | 70 | 90,
        resolutionDate: new BN(Math.floor(new Date(bundle!.resolution_date).getTime() / 1000)),
        legs: legsArg,
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
      .preInstructions([bumpCu])
      .simulate();
    console.log("raw:", JSON.stringify(sim.raw, null, 2));
    console.log("events:", sim.events);
  } catch (e: any) {
    console.log("caught error class:", e?.constructor?.name);
    console.log("message:", e?.message);
    if (e?.simulationResponse) {
      console.log("simulationResponse logs:");
      for (const l of e.simulationResponse.logs ?? []) console.log("  ", l);
      console.log("err:", JSON.stringify(e.simulationResponse.err, null, 2));
      console.log("unitsConsumed:", e.simulationResponse.unitsConsumed);
    }
    if (e?.logs) {
      console.log("error.logs:");
      for (const l of e.logs) console.log("  ", l);
    }
    if (e?.programErrorStack) {
      console.log("programErrorStack:", e.programErrorStack);
    }
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);

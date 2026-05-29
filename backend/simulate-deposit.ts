/**
 * Simulate a deposit tx for a given wallet + bundle, and print simulation logs.
 * This reveals what Phantom's simulation would see (and why it rejects with
 * "Unexpected error").
 *
 * Usage: npx tsx simulate-deposit.ts <walletAddress> [bundleName] [amountUsdc]
 */
import * as dotenv from "dotenv";
import * as path from "path";
dotenv.config({ path: path.join(__dirname, ".env") });
import { Connection, PublicKey, VersionedTransaction } from "@solana/web3.js";
import { createClient } from "@supabase/supabase-js";
import { buildDepositTx } from "./src/solana/client";

(async () => {
  const walletStr = process.argv[2];
  const bundleName = process.argv[3] || "STHS-HIGH-MED";
  const amountUsdc = parseFloat(process.argv[4] || "1.0");
  if (!walletStr) {
    console.error("Usage: npx tsx simulate-deposit.ts <wallet> [bundle] [amount]");
    process.exit(1);
  }
  const wallet = new PublicKey(walletStr);

  // Look up bundle_id from DB.
  const s = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!);
  const { data, error } = await s.from("bundles").select("id,name,vault_pda,status").eq("name", bundleName).single();
  if (error || !data) { console.error("Bundle lookup failed:", error); process.exit(1); }
  console.log(`Bundle: ${data.name} (id=${data.id}, status=${data.status}, vault=${data.vault_pda?.slice(0,12)}…)`);

  // Build the tx exactly like /api/deposit/prepare would.
  const built = await buildDepositTx(wallet, data.id, BigInt(Math.round(amountUsdc * 1_000_000)));
  console.log("Built tx — expected tokens:", Number(built.expectedTokens)/1e6, "fee USDC:", Number(built.feeUsdc)/1e6);

  // Deserialize + simulate.
  const bytes = Buffer.from(built.transactionBase64, "base64");
  const tx = VersionedTransaction.deserialize(bytes);
  const conn = new Connection(process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com", "confirmed");
  const sim = await conn.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true });
  console.log("\n--- Simulation result ---");
  console.log("Err:", JSON.stringify(sim.value.err));
  console.log("Logs:");
  for (const line of sim.value.logs || []) console.log("  " + line);
  if (sim.value.err) process.exit(2);
})();

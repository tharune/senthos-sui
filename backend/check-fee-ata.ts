import * as dotenv from "dotenv";
import * as path from "path";
dotenv.config({ path: path.join("/sessions/zen-nice-wozniak/mnt/SCBC-Hackathon-2026/backend", ".env") });
import { Connection, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync, getAccount } from "@solana/spl-token";

(async () => {
  const conn = new Connection(process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com", "confirmed");
  const usdcMint = new PublicKey(process.env.USDC_MINT!);
  const feeRecipient = new PublicKey(process.env.FEE_RECIPIENT!);
  const feeAta = getAssociatedTokenAddressSync(usdcMint, feeRecipient);
  console.log("Fee recipient:", feeRecipient.toBase58());
  console.log("USDC mint:    ", usdcMint.toBase58());
  console.log("Fee ATA:      ", feeAta.toBase58());
  try {
    const acct = await getAccount(conn, feeAta);
    console.log("✓ Fee ATA exists; balance =", Number(acct.amount) / 1_000_000, "USDC");
  } catch (e: any) {
    console.log("✗ Fee ATA DOES NOT EXIST:", e.name || e.message);
  }
})();

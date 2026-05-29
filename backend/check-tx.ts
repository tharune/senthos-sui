import * as dotenv from "dotenv";
import * as path from "path";
dotenv.config({ path: path.join(__dirname, ".env") });
import { Connection, PublicKey } from "@solana/web3.js";
(async () => {
  const conn = new Connection(process.env.SOLANA_RPC_URL!, "confirmed");
  // tx for STHS-HIGH-MED init
  const sig = "5xMZG4bp2DW1QLmron1AjqK8BadWdFQCT3WyeLJywL9qcsniK6jVzrDNBE1QYbPCnfw973C6cxEi4bDgsGG7PpBt";
  const tx = await conn.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
  if (!tx) { console.log("tx not found"); return; }
  console.log("err:", tx.meta?.err);
  console.log("slot:", tx.slot);
  console.log("\nLogs:");
  for (const l of tx.meta?.logMessages || []) console.log(" ", l);
  console.log("\nAccounts involved:");
  const keys = tx.transaction.message.staticAccountKeys || [];
  for (let i = 0; i < keys.length; i++) console.log(`  #${i}: ${keys[i].toBase58()}`);
})();

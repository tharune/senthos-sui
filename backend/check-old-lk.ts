import * as dotenv from "dotenv";
import * as path from "path";
dotenv.config({ path: path.join("/sessions/zen-nice-wozniak/mnt/SCBC-Hackathon-2026/backend", ".env") });
import { Connection, PublicKey } from "@solana/web3.js";
(async () => {
  const conn = new Connection(process.env.SOLANA_RPC_URL!, "confirmed");
  const sig = "282J4iWmjr62rFpw6it69sVSWux2x5TNVffkt27UeozVBgE2jQUhazWRzFCU4tQRjEkCXncaYiKPueMu68V8rD3G";
  const tx = await conn.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
  console.log("err:", tx?.meta?.err);
  console.log("\nLogs:");
  for (const l of tx?.meta?.logMessages || []) console.log(" ", l);
  console.log("\nAccounts:");
  for (let i = 0; i < (tx?.transaction.message.staticAccountKeys.length || 0); i++) {
    console.log(`  #${i}: ${tx!.transaction.message.staticAccountKeys[i].toBase58()}`);
  }
})();

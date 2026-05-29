import * as dotenv from "dotenv";
import * as path from "path";
dotenv.config({ path: path.join(__dirname, ".env") });
import { Connection, PublicKey } from "@solana/web3.js";
import { createClient } from "@supabase/supabase-js";

(async () => {
  const conn = new Connection(process.env.SOLANA_RPC_URL!, "confirmed");
  const s = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!);
  const { data } = await s.from("bundles").select("name, trax_mint").eq("name", "STHS-HIGH-MED").single();
  if (!data?.trax_mint) { console.log("no trax_mint"); return; }
  const mintPk = new PublicKey(data.trax_mint);
  console.log("TRAX mint:", mintPk.toBase58());
  const info = await conn.getAccountInfo(mintPk);
  console.log("Owner:", info?.owner.toBase58());
  console.log("Data length:", info?.data.length);
})();

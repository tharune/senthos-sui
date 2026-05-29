import * as dotenv from "dotenv";
import * as path from "path";
dotenv.config({ path: path.join(__dirname, ".env") });
import { Connection, PublicKey } from "@solana/web3.js";
import { createClient } from "@supabase/supabase-js";
import { deriveTraxMint, deriveVaultPda, deriveUsdcVault } from "./src/solana/anchor";

(async () => {
  const conn = new Connection(process.env.SOLANA_RPC_URL!, "confirmed");
  const s = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!);
  const { data: rows } = await s.from("bundles").select("id, name, trax_mint, vault_pda").in("name", ["LK-90-0430","LK-70-0515"]);
  for (const r of rows!) {
    console.log("=== " + r.name + " ===");
    const [vault] = deriveVaultPda(r.id);
    const [mint] = deriveTraxMint(r.id);
    const [usdc] = deriveUsdcVault(r.id);
    const [vi, mi, ui] = await Promise.all([
      conn.getAccountInfo(vault), conn.getAccountInfo(mint), conn.getAccountInfo(usdc),
    ]);
    console.log("vault:", vault.toBase58(), "exists?", !!vi);
    console.log("mint: ", mint.toBase58(), "exists?", !!mi, mi?"size="+mi.data.length:"");
    console.log("usdc: ", usdc.toBase58(), "exists?", !!ui, ui?"size="+ui.data.length:"");
  }
})();

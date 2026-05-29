import * as dotenv from "dotenv";
import * as path from "path";
dotenv.config({ path: path.join(__dirname, ".env") });
import { Connection, PublicKey } from "@solana/web3.js";
import { createClient } from "@supabase/supabase-js";
import { deriveTraxMint, deriveVaultPda, deriveUsdcVault } from "./src/solana/anchor";

(async () => {
  const conn = new Connection(process.env.SOLANA_RPC_URL!, "confirmed");
  const s = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!);
  const { data: rows } = await s.from("bundles").select("id, name, trax_mint, vault_pda").in("name", ["STHS-HIGH-MED","STHS-HIGH-LONG"]);
  for (const r of rows!) {
    console.log("\n=== " + r.name + " ===");
    console.log("DB trax_mint:", r.trax_mint);
    console.log("DB vault_pda:", r.vault_pda);
    const [derivedVault] = deriveVaultPda(r.id);
    const [derivedMint] = deriveTraxMint(r.id);
    const [derivedUsdc] = deriveUsdcVault(r.id);
    console.log("Derived vault:", derivedVault.toBase58());
    console.log("Derived mint: ", derivedMint.toBase58());
    console.log("Derived usdc: ", derivedUsdc.toBase58());

    const vaultInfo = await conn.getAccountInfo(derivedVault);
    console.log("Vault on-chain?", !!vaultInfo, vaultInfo && "owner="+vaultInfo.owner.toBase58());
    const mintInfo = await conn.getAccountInfo(derivedMint);
    console.log("TRAX mint on-chain?", !!mintInfo, mintInfo && "owner="+mintInfo.owner.toBase58()+" size="+mintInfo.data.length);
    const usdcInfo = await conn.getAccountInfo(derivedUsdc);
    console.log("USDC vault on-chain?", !!usdcInfo, usdcInfo && "owner="+usdcInfo.owner.toBase58()+" size="+usdcInfo.data.length);
  }
})();

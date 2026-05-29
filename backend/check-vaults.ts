import * as dotenv from "dotenv";
import * as path from "path";
dotenv.config({ path: path.join("/sessions/zen-nice-wozniak/mnt/SCBC-Hackathon-2026/backend", ".env") });
import { createClient } from "@supabase/supabase-js";
const url = process.env.SUPABASE_URL!;
const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY)!;
const c = createClient(url, key);
(async () => {
  const { data, error } = await c.from("bundles").select("name, vault_pda, risk_tier, status").order("name");
  if (error) { console.error(error); process.exit(1); }
  for (const b of data!) {
    const v = b.vault_pda ? "✓ " + b.vault_pda.slice(0, 12) + "…" : "✗ NULL";
    console.log(`${b.name.padEnd(20)} [${b.risk_tier}] ${b.status.padEnd(8)} vault: ${v}`);
  }
})();

// Anchor's default workspace migration. Kept as a no-op since our
// initialization is driven by scripts/init-demo-vaults.ts which reads
// the bundle list from Supabase. `anchor migrate` is not used in this
// project.
import * as anchor from "@coral-xyz/anchor";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
module.exports = async function (_provider: anchor.AnchorProvider) {
  console.log(
    "anchor migrate is a no-op for this workspace. " +
      "Use: bash scripts/deploy-devnet.sh && npx tsx scripts/init-demo-vaults.ts",
  );
};

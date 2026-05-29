/**
 * One-time initialization of the mock Meteora adapter used by traxis_ppn.
 *
 * The PPN program uses a single shared adapter (PDA at [b"meteora_mock"]) that
 * every PpnNote deposits principal into. This script calls
 * initialize_mock_adapter(apy_bps=800) — 8% APY — and is safe to skip if the
 * adapter already exists.
 *
 * Usage:
 *   cd backend && npm install
 *   cd .. && npx tsx scripts/init-meteora-mock.ts
 */
import * as dotenv from "dotenv";
import * as path from "path";
import { PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";

dotenv.config({ path: path.join(__dirname, "..", "backend", ".env") });

import {
  deriveMeteoraAdapter,
  deriveMeteoraPool,
  getConfig,
  getPpnProgram,
  getProvider,
} from "../backend/src/solana/anchor";

async function main() {
  const cfg = getConfig();
  const program = getPpnProgram();
  const [adapterPda] = deriveMeteoraAdapter();
  const [poolPda] = deriveMeteoraPool();

  try {
    const existing = await (program.account as any).meteoraMockAdapter.fetch(adapterPda);
    console.log(
      `Mock adapter already initialized at ${adapterPda.toBase58()} (APY ${existing.apyBps} bps)`,
    );
    return;
  } catch {
    // Not initialized yet — continue.
  }

  const apyBps = parseInt(process.env.PPN_MOCK_APY_BPS ?? "800", 10);

  console.log(`Initializing mock adapter with ${apyBps} bps APY...`);
  const sig = await program.methods
    .initializeMockAdapter(apyBps)
    .accounts({
      authority: cfg.authorityKeypair.publicKey,
      adapter: adapterPda,
      usdcMint: cfg.usdcMint,
      usdcPool: poolPda,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      rent: SYSVAR_RENT_PUBKEY,
    })
    .rpc();
  console.log(`  tx: ${sig}`);
  console.log(`  adapter: ${adapterPda.toBase58()}`);
  console.log(`  pool:    ${poolPda.toBase58()}`);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);

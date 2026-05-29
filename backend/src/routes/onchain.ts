import { Router, Request, Response } from 'express';
import { Connection, PublicKey } from '@solana/web3.js';

/**
 * Lightweight on-chain status endpoint.
 *
 * Reads program-account info directly via web3.js (no Anchor provider required,
 * so this works even without AUTHORITY_KEYPAIR).
 */

const router = Router();

const RPC_URL = process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com';

// Defaults taken from Anchor.toml / devnet deploy. Env vars override if present.
const VAULT_PROGRAM_ID =
  process.env.TRAXIS_VAULT_PROGRAM_ID ?? 'E77R7yqUEAWz9jUk92kSnrpvUBEwGpPT3iZaThbKQcJb';
const PPN_PROGRAM_ID =
  process.env.TRAXIS_PPN_PROGRAM_ID ?? '4NnrpeWgdmVymcdGqbrmQUunHHvyVSevUXCKFGJYwbtE';

let _connection: Connection | null = null;
function conn(): Connection {
  if (!_connection) _connection = new Connection(RPC_URL, 'confirmed');
  return _connection;
}

async function probeProgram(name: string, id: string) {
  const t0 = Date.now();
  try {
    const pk = new PublicKey(id);
    const info = await conn().getAccountInfo(pk);
    return {
      name,
      program_id: id,
      deployed: info !== null,
      executable: info?.executable ?? false,
      owner: info?.owner.toBase58() ?? null,
      lamports: info?.lamports ?? 0,
      data_size: info?.data?.length ?? 0,
      latency_ms: Date.now() - t0,
    };
  } catch (err: any) {
    return {
      name,
      program_id: id,
      deployed: false,
      error: err?.message ?? String(err),
      latency_ms: Date.now() - t0,
    };
  }
}

/**
 * GET /api/onchain/status
 * Probes both Senthos programs on-chain and reports devnet health + deployment.
 */
router.get('/status', async (_req: Request, res: Response) => {
  const t0 = Date.now();
  let slot: number | null = null;
  let epoch: number | null = null;
  try {
    slot = await conn().getSlot('confirmed');
    const info = await conn().getEpochInfo('confirmed');
    epoch = info.epoch;
  } catch {
    /* best-effort  -  don't fail the whole response */
  }

  const [vault, ppn] = await Promise.all([
    probeProgram('traxis_vault', VAULT_PROGRAM_ID),
    probeProgram('traxis_ppn', PPN_PROGRAM_ID),
  ]);

  res.json({
    cluster: process.env.SOLANA_CLUSTER ?? 'devnet',
    rpc_url: RPC_URL,
    slot,
    epoch,
    programs: { vault, ppn },
    total_latency_ms: Date.now() - t0,
    timestamp: new Date().toISOString(),
  });
});

export const onchainRoutes = router;

import express from 'express';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { Connection, PublicKey } from '@solana/web3.js';
import { metrics } from '../services/metrics';
import { getModelManifest } from '../services/correlation';
import { config } from '../config';
import { supabase } from '../db/supabase';
import {
  getAllBundles,
  getAllLegs,
  getAllPositions,
  getAllTransactions,
} from '../db/queries';

/**
 * Standalone monitor server. Runs in the same Node process as the main API
 * so it can import the metrics store directly, but listens on its own port
 * (default 3002) and serves a single self-contained HTML dashboard.
 *
 * The dashboard polls /data every second and renders everything with hand-rolled
 * Canvas / SVG (no external chart libs).
 */

const MONITOR_PORT = parseInt(process.env.MONITOR_PORT || '3002', 10);
const RPC_URL = process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com';
const VAULT_PROGRAM_ID =
  process.env.TRAXIS_VAULT_PROGRAM_ID ?? 'E77R7yqUEAWz9jUk92kSnrpvUBEwGpPT3iZaThbKQcJb';
const PPN_PROGRAM_ID =
  process.env.TRAXIS_PPN_PROGRAM_ID ?? '4NnrpeWgdmVymcdGqbrmQUunHHvyVSevUXCKFGJYwbtE';

let _conn: Connection | null = null;
function conn() {
  if (!_conn) _conn = new Connection(RPC_URL, 'confirmed');
  return _conn;
}

async function probeProgram(name: string, id: string) {
  const t0 = Date.now();
  try {
    const info = await conn().getAccountInfo(new PublicKey(id));
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
  } catch (err) {
    return {
      name,
      program_id: id,
      deployed: false,
      latency_ms: Date.now() - t0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function probePolymarket() {
  const t0 = Date.now();
  try {
    const resp = await fetch('https://gamma-api.polymarket.com/markets?limit=1');
    return {
      status: resp.ok ? 'ok' : 'error',
      latency_ms: Date.now() - t0,
      http: resp.status,
    };
  } catch (err) {
    return {
      status: 'error',
      latency_ms: Date.now() - t0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function probeSupabase(): Promise<{
  status: 'ok' | 'error' | 'not_configured';
  latency_ms: number;
  error?: string;
}> {
  if (!config.supabaseConfigured) return { status: 'not_configured', latency_ms: 0 };
  const t0 = Date.now();
  try {
    const { error } = await supabase.from('bundles').select('id').limit(1);
    if (error) return { status: 'error', latency_ms: Date.now() - t0, error: error.message };
    return { status: 'ok', latency_ms: Date.now() - t0 };
  } catch (err) {
    return {
      status: 'error',
      latency_ms: Date.now() - t0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function readMlMetrics(): Record<string, unknown> | null {
  const candidates = [
    path.resolve(__dirname, '..', '..', '..', 'traxis-correlation-deliverables', 'final_summary_step19.json'),
    path.resolve(__dirname, '..', '..', 'traxis-correlation-deliverables', 'final_summary_step19.json'),
    path.resolve(process.cwd(), '..', 'traxis-correlation-deliverables', 'final_summary_step19.json'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      try {
        return JSON.parse(fs.readFileSync(p, 'utf-8')) as Record<string, unknown>;
      } catch {
        return null;
      }
    }
  }
  return null;
}

async function buildSnapshot() {
  const [vault, ppn, polymarket, supabaseProbe, slotInfo] = await Promise.all([
    probeProgram('traxis_vault', VAULT_PROGRAM_ID),
    probeProgram('traxis_ppn', PPN_PROGRAM_ID),
    probePolymarket(),
    probeSupabase(),
    (async () => {
      try {
        const [slot, epoch] = await Promise.all([
          conn().getSlot('confirmed'),
          conn().getEpochInfo('confirmed'),
        ]);
        return { slot, epoch: epoch.epoch, epoch_progress: epoch.slotIndex / epoch.slotsInEpoch };
      } catch {
        return { slot: null as number | null, epoch: null as number | null, epoch_progress: null as number | null };
      }
    })(),
  ]);

  const [bundles, legs, positions, transactions] = await Promise.all([
    getAllBundles(),
    getAllLegs(),
    getAllPositions(),
    getAllTransactions({ limit: 200 }),
  ]);

  const deposits = transactions.filter((t) => t.type === 'deposit');
  const redemptions = transactions.filter((t) => t.type === 'redemption');
  const totalDeposited = deposits.reduce((s, t) => s + t.amount_usdc, 0);
  const totalRedeemed = redemptions.reduce((s, t) => s + t.amount_usdc, 0);
  const totalFees = transactions.reduce((s, t) => s + t.fee_usdc, 0);

  const mlRaw = readMlMetrics();
  const ml = mlRaw
    ? {
        execution_status: String(mlRaw.execution_status ?? 'unknown'),
        all_checks_passed: Boolean(mlRaw.all_checks_passed),
        classifier_precision: Number(mlRaw.classifier_precision ?? 0),
        walkforward_mean_improvement: Number(mlRaw.walkforward_mean_improvement ?? 0),
        walkforward_p_value: Number(mlRaw.walkforward_p_value ?? 0),
        var_95: Number(mlRaw.var_95 ?? 0),
        var_99: Number(mlRaw.var_99 ?? 0),
        cvar_95: Number(mlRaw.cvar_95 ?? 0),
        cvar_99: Number(mlRaw.cvar_99 ?? 0),
      }
    : null;

  const mem = process.memoryUsage();
  const loadAvg = os.loadavg();

  return {
    meta: { timestamp: new Date().toISOString(), rpc_url: RPC_URL },
    process: {
      uptime_seconds: Math.floor(process.uptime()),
      wall_ms: Date.now() - metrics.startTime,
      pid: process.pid,
      node_version: process.version,
      platform: process.platform,
      memory: {
        rss_mb: +(mem.rss / 1024 / 1024).toFixed(2),
        heap_used_mb: +(mem.heapUsed / 1024 / 1024).toFixed(2),
        heap_total_mb: +(mem.heapTotal / 1024 / 1024).toFixed(2),
        external_mb: +(mem.external / 1024 / 1024).toFixed(2),
      },
      cpu: {
        load_1m: loadAvg[0],
        load_5m: loadAvg[1],
        load_15m: loadAvg[2],
        cores: os.cpus().length,
      },
    },
    requests: {
      total: metrics.requestsTotal,
      by_status: {
        '2xx': metrics.requests2xx,
        '3xx': metrics.requests3xx,
        '4xx': metrics.requests4xx,
        '5xx': metrics.requests5xx,
      },
      latency_60s: metrics.latencyPercentiles(60_000),
      error_rate_60s: metrics.errorRate(60_000),
      rpm_buckets: metrics.rpmBuckets(60, 5_000), // 60 buckets x 5s = 5min
      bucket_ms: 5_000,
      by_route_60s: metrics.routeBreakdown(60_000, 12),
      recent: metrics.getRecentRequests(50),
    },
    cron: {
      schedule: '*/2 * * * *',
      recent: metrics.getRecentCrons(10),
      last_ok: metrics.getRecentCrons(1)[0]?.ok ?? null,
      last_duration_ms: metrics.getRecentCrons(1)[0]?.duration_ms ?? null,
    },
    db: {
      supabase: supabaseProbe,
      configured: config.supabaseConfigured,
      counts: {
        bundles: bundles.length,
        active_bundles: bundles.filter((b) => b.status === 'active').length,
        resolved_bundles: bundles.filter((b) => b.status === 'resolved').length,
        cancelled_bundles: bundles.filter((b) => b.status === 'cancelled').length,
        legs: legs.length,
        positions: positions.length,
        transactions: transactions.length,
      },
      flows: {
        total_deposited_usdc: +totalDeposited.toFixed(2),
        total_redeemed_usdc: +totalRedeemed.toFixed(2),
        total_fees_usdc: +totalFees.toFixed(4),
        net_usdc: +(totalDeposited - totalRedeemed).toFixed(2),
      },
    },
    polymarket,
    solana: {
      cluster: 'devnet',
      ...slotInfo,
      programs: { vault, ppn },
    },
    ml,
    model_usage: {
      manifest: getModelManifest(),
      counters: {
        bundles_scored: metrics.modelBundlesScored,
        bundles_accepted: metrics.modelBundlesAccepted,
        bundles_rejected: metrics.modelBundlesRejected,
        last_version: metrics.modelLastVersion,
        last_internal_corr: metrics.modelLastInternalCorr,
      },
      recent_events: metrics.getRecentModelEvents(10),
    },
    market_filter: {
      counters: {
        runs_total: metrics.filterRunsTotal,
        markets_seen: metrics.filterMarketsSeen,
        markets_kept: metrics.filterMarketsKept,
        markets_rejected: metrics.filterMarketsRejected,
        per_stage_rejected: metrics.filterStageRejected,
        kept_rate:
          metrics.filterMarketsSeen > 0
            ? metrics.filterMarketsKept / metrics.filterMarketsSeen
            : 0,
      },
      recent_runs: metrics.getRecentFilterRuns(10),
    },
  };
}

export function startMonitorServer() {
  const app = express();

  // CORS (open since this is a dev-only monitor)
  app.use((_req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    next();
  });

  app.get('/data', async (_req, res) => {
    try {
      res.json(await buildSnapshot());
    } catch (err) {
      res
        .status(500)
        .json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get('/', (_req, res) => {
    const html = fs.readFileSync(path.join(__dirname, 'monitor.html'), 'utf-8');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  });

  app.listen(MONITOR_PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`Monitor server running on http://localhost:${MONITOR_PORT}`);
  });
}

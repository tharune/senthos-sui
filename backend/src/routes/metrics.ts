import { Router, Request, Response } from 'express';
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

const router = Router();

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
  if (!config.supabaseConfigured) {
    return { status: 'not_configured', latency_ms: 0 };
  }
  const t0 = Date.now();
  try {
    const { error } = await supabase.from('bundles').select('id').limit(1);
    if (error) {
      return { status: 'error', latency_ms: Date.now() - t0, error: error.message };
    }
    return { status: 'ok', latency_ms: Date.now() - t0 };
  } catch (err) {
    return {
      status: 'error',
      latency_ms: Date.now() - t0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function readMlMetrics(): unknown {
  const candidates = [
    path.resolve(__dirname, '..', '..', '..', 'traxis-correlation-deliverables', 'final_summary_step19.json'),
    path.resolve(__dirname, '..', '..', 'traxis-correlation-deliverables', 'final_summary_step19.json'),
    path.resolve(process.cwd(), '..', 'traxis-correlation-deliverables', 'final_summary_step19.json'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      try {
        return JSON.parse(fs.readFileSync(p, 'utf-8'));
      } catch {
        return null;
      }
    }
  }
  return null;
}

/**
 * GET /api/metrics
 * Returns a comprehensive snapshot for the /monitor dashboard.
 *
 * Everything here should be cheap to compute or parallelisable. Total budget
 * ~500ms on devnet RPC + Polymarket round-trip.
 */
router.get('/', async (_req: Request, res: Response) => {
  const t0 = Date.now();

  // Concurrently probe external services
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

  // DB aggregates (cheap with mock when unconfigured)
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

  // ML
  const mlRaw = readMlMetrics() as Record<string, unknown> | null;
  const mlOut = mlRaw
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

  // Process stats
  const mem = process.memoryUsage();
  const loadAvg = os.loadavg();
  const uptimeS = Math.floor(process.uptime());
  const wallUptimeMs = Date.now() - metrics.startTime;

  // Request metrics
  const latency = metrics.latencyPercentiles(60_000);
  const errors = metrics.errorRate(60_000);
  const rpmBuckets = metrics.rpmBuckets(30, 10_000); // 30 buckets × 10s = 5min history
  const byRoute = metrics.routeBreakdown(60_000, 8);
  const recentRequests = metrics.getRecentRequests(25);
  const recentCrons = metrics.getRecentCrons(10);

  res.json({
    meta: {
      timestamp: new Date().toISOString(),
      generation_ms: 0, // filled in below
      rpc_url: RPC_URL,
    },
    process: {
      uptime_seconds: uptimeS,
      wall_ms: wallUptimeMs,
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
      latency_60s: latency,
      error_rate_60s: errors,
      rpm_buckets: rpmBuckets,
      bucket_ms: 10_000,
      by_route_60s: byRoute,
      recent: recentRequests,
    },
    cron: {
      schedule: '*/2 * * * *',
      recent: recentCrons,
      runs_total: recentCrons.length,
      last_ok: recentCrons[0]?.ok ?? null,
      last_duration_ms: recentCrons[0]?.duration_ms ?? null,
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
    ml: mlOut,
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
  });

  // attach generation time after send (non-critical, just for debug)
  void t0;
});

export const metricsRoutes = router;

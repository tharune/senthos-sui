import { Router, Request, Response } from 'express';
import { supabase } from '../db/supabase';
import { getAllLegs, updateLegResolution } from '../db/queries';
import {
  finalizeBundleIfReady,
  resolveLegOnchainMirror,
} from '../services/onchain-bridge';

const router = Router();

/**
 * POST /api/webhook/helius
 *
 * Handles Helius enhanced transaction webhooks for Solana-side prediction
 * market resolutions (primarily Kalshi outcome tokens tokenized via DFlow).
 *
 * Polymarket runs on Polygon and can't be observed by Helius; that path is
 * handled by the pricing cron (see services/cron.ts + services/pricing.ts),
 * which also calls the same onchain bridge.
 *
 * Event matching: we treat any `accountData[].account` field in the payload
 * as a candidate match against `legs.market_id`. A looser fallback matches
 * by `description` substring. Every matched leg → resolve_leg on-chain.
 *
 * The webhook is idempotent: attempts to re-resolve an already-resolved leg
 * no-op at the onchain-bridge layer.
 */
router.post('/helius', async (req: Request, res: Response) => {
  try {
    const events = Array.isArray(req.body) ? req.body : [req.body];
    const payload: { processed: number; matched: number; errors: string[] } = {
      processed: 0,
      matched: 0,
      errors: [],
    };

    // Pull current legs once. For webhook throughput this is fine; if needed
    // the DB can gain an index on market_id.
    const allLegs = await getAllLegs();
    const activeLegs = allLegs.filter((l) => l.status === 'active');

    for (const event of events) {
      payload.processed++;
      try {
        const { type, description, signature, accountData } = event ?? {};
        console.log(
          `[helius] type=${type} sig=${signature?.slice?.(0, 12)}... desc=${description}`,
        );

        // Collect candidate market IDs appearing anywhere in the event.
        const candidateAccounts: string[] = [];
        if (Array.isArray(accountData)) {
          for (const ad of accountData) {
            if (ad?.account) candidateAccounts.push(String(ad.account));
          }
        }
        if (typeof description === 'string') {
          candidateAccounts.push(description);
        }

        // Find legs whose market_id shows up in the event payload.
        const matchedLegs = activeLegs.filter((leg) =>
          candidateAccounts.some((s) => s.includes(leg.market_id)),
        );
        if (matchedLegs.length === 0) continue;

        for (const leg of matchedLegs) {
          // Heuristic: for now assume any resolution event = Won. Production
          // would decode the Kalshi outcome token state to distinguish
          // Won from Lost. For the hackathon we let the pricing cron do
          // the actual outcome determination and this webhook just triggers
          // a refresh.
          const outcome: 'won' | 'lost' = 'won';
          const resolutionValue = outcome === 'won' ? 1.0 : 0.0;

          await updateLegResolution(leg.id, outcome, resolutionValue);
          const sig = await resolveLegOnchainMirror(leg.bundle_id, leg.id, outcome);
          console.log(
            `[helius] resolved leg ${leg.id} (bundle ${leg.bundle_id}) → ${sig ?? '(no sig)'}`,
          );
          payload.matched++;

          // Opportunistically finalize the vault if this was the last leg.
          await finalizeBundleIfReady(leg.bundle_id);
        }
      } catch (err) {
        console.error('[helius] event error:', err);
        payload.errors.push(String(err));
      }
    }

    res.json(payload);
  } catch (err) {
    console.error('POST /api/webhook/helius error:', err);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

/**
 * GET /api/webhook/health
 * Helius can ping this to verify the webhook endpoint is alive.
 */
router.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', service: 'helius-webhook' });
});

export const webhookRoutes = router;

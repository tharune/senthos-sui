import { Router, Request, Response } from 'express';
import {
  listDistributionPositions,
  listDistributionTemplates,
  openDistributionPosition,
  quoteDistributionMarket,
  settleDistributionPosition,
} from '../services/distribution';

const router = Router();

function bodyNumber(req: Request, key: string): number {
  const value = req.body?.[key];
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`${key} must be a number`);
  return n;
}

function bodyWeights(req: Request): number[] {
  const value = req.body?.weights;
  if (!Array.isArray(value)) throw new Error('weights must be an array');
  return value.map((entry) => Number(entry));
}

function errorResponse(res: Response, err: unknown) {
  const message = err instanceof Error ? err.message : 'Unknown distribution market error';
  return res.status(400).json({ error: message });
}

router.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    product: 'distribution-markets',
    chain: 'sui',
    templates: listDistributionTemplates().length,
    positions: listDistributionPositions().length,
  });
});

router.get('/templates', (_req, res) => {
  res.json({ templates: listDistributionTemplates() });
});

router.get('/positions', (req, res) => {
  const owner = typeof req.query.owner === 'string' ? req.query.owner : undefined;
  res.json({ positions: listDistributionPositions(owner) });
});

router.post('/quote', (req, res) => {
  try {
    const quote = quoteDistributionMarket({
      marketId: String(req.body?.market_id ?? ''),
      weights: bodyWeights(req),
      amountUsdc: bodyNumber(req, 'amount_usdc'),
    });
    res.json({ quote });
  } catch (err) {
    errorResponse(res, err);
  }
});

router.post('/open', async (req, res) => {
  try {
    const position = await openDistributionPosition({
      marketId: String(req.body?.market_id ?? ''),
      weights: bodyWeights(req),
      amountUsdc: bodyNumber(req, 'amount_usdc'),
      recipient: typeof req.body?.recipient === 'string' ? req.body.recipient : undefined,
    });
    res.json({ position });
  } catch (err) {
    errorResponse(res, err);
  }
});

router.post('/positions/:id/settle', async (req, res) => {
  try {
    const position = await settleDistributionPosition(req.params.id);
    res.json({ position });
  } catch (err) {
    errorResponse(res, err);
  }
});

export const distributionRoutes = router;

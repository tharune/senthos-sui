import { randomUUID } from 'node:crypto';
import {
  openSuiLocalBasketPosition,
  redeemSuiLocalBasketPosition,
  type SuiJson,
} from './sui';

export type DistributionBucket = {
  id: string;
  label: string;
  midpoint: number;
  reference_probability: number;
};

export type DistributionTemplate = {
  id: string;
  name: string;
  description: string;
  unit: string;
  collateral: string;
  expiry_label: string;
  buckets: DistributionBucket[];
};

export type DistributionQuote = {
  market_id: string;
  amount_usdc: number;
  amount_raw: string;
  weights: number[];
  normalized: number[];
  expected_value: number;
  reference_expected_value: number;
  peak_bucket: DistributionBucket;
  l2_distance: number;
  entropy: number;
  maker_fee_usdc: number;
  net_collateral_usdc: number;
  payout_curve: Array<{
    bucket_id: string;
    label: string;
    probability: number;
    reference_probability: number;
    payout_usdc: number;
    pnl_usdc: number;
  }>;
};

export type DistributionPosition = {
  id: string;
  owner: string;
  market_template_id: string;
  template_name: string;
  created_at: string;
  quote: DistributionQuote;
  chain: 'sui';
  network: string;
  sui_market_id: string;
  sui_position_id: string;
  digests: {
    mint: string | null;
    create_market: string | null;
    buy: string | null;
    resolve?: string | null;
    claim?: string | null;
  };
  status: 'open' | 'settled';
};

type SuiOpenResult = {
  chain: 'sui';
  network: string;
  owner: string;
  market_id: string;
  position_id: string;
  digests: {
    mint: string | null;
    create_market: string | null;
    buy: string | null;
  };
  raw: {
    mint: SuiJson;
    market: SuiJson;
    buy: SuiJson;
  };
};

type SuiRedeemResult = {
  chain: 'sui';
  network: string;
  digests: {
    resolve: string | null;
    claim: string | null;
  };
};

const DECIMALS = 1_000_000;
const MAKER_FEE_RATE = 0.003;

const templates: DistributionTemplate[] = [
  {
    id: 'btc-year-end-2026',
    name: 'BTC year-end close',
    description: 'A full curve for the BTC spot close on December 31, 2026.',
    unit: 'USD',
    collateral: 'mock USDC',
    expiry_label: 'Dec 31, 2026',
    buckets: [
      { id: 'lt-60k', label: '< 60k', midpoint: 50_000, reference_probability: 0.08 },
      { id: '60-80k', label: '60k-80k', midpoint: 70_000, reference_probability: 0.15 },
      { id: '80-100k', label: '80k-100k', midpoint: 90_000, reference_probability: 0.24 },
      { id: '100-125k', label: '100k-125k', midpoint: 112_500, reference_probability: 0.25 },
      { id: '125-160k', label: '125k-160k', midpoint: 142_500, reference_probability: 0.18 },
      { id: 'gt-160k', label: '> 160k', midpoint: 180_000, reference_probability: 0.10 },
    ],
  },
  {
    id: 'sui-tvl-q4-2026',
    name: 'Sui TVL Q4 2026',
    description: 'A probability distribution for Sui DeFi TVL at the end of Q4 2026.',
    unit: 'USD',
    collateral: 'mock USDC',
    expiry_label: 'Q4 2026',
    buckets: [
      { id: 'lt-2b', label: '< 2B', midpoint: 1.5, reference_probability: 0.10 },
      { id: '2-3b', label: '2B-3B', midpoint: 2.5, reference_probability: 0.16 },
      { id: '3-4b', label: '3B-4B', midpoint: 3.5, reference_probability: 0.22 },
      { id: '4-6b', label: '4B-6B', midpoint: 5, reference_probability: 0.24 },
      { id: '6-9b', label: '6B-9B', midpoint: 7.5, reference_probability: 0.18 },
      { id: 'gt-9b', label: '> 9B', midpoint: 10.5, reference_probability: 0.10 },
    ],
  },
  {
    id: 'fed-cuts-2026',
    name: 'Fed cuts in 2026',
    description: 'A discrete distribution over the number of 25 bps equivalent rate cuts in 2026.',
    unit: 'cuts',
    collateral: 'mock USDC',
    expiry_label: 'Dec 2026',
    buckets: [
      { id: 'zero', label: '0', midpoint: 0, reference_probability: 0.12 },
      { id: 'one', label: '1', midpoint: 1, reference_probability: 0.18 },
      { id: 'two', label: '2', midpoint: 2, reference_probability: 0.26 },
      { id: 'three', label: '3', midpoint: 3, reference_probability: 0.22 },
      { id: 'four', label: '4', midpoint: 4, reference_probability: 0.14 },
      { id: 'five-plus', label: '5+', midpoint: 5.5, reference_probability: 0.08 },
    ],
  },
];

const positions: DistributionPosition[] = [];

function roundUsd(value: number): number {
  return Math.round(value * 100) / 100;
}

function findTemplate(marketId: string): DistributionTemplate {
  const template = templates.find((candidate) => candidate.id === marketId);
  if (!template) throw new Error(`Unknown distribution market: ${marketId}`);
  return template;
}

function normalizeWeights(weights: number[], expectedLength: number): number[] {
  if (!Array.isArray(weights) || weights.length !== expectedLength) {
    throw new Error(`Expected ${expectedLength} distribution weights`);
  }
  const clean = weights.map((weight) => {
    const n = Number(weight);
    if (!Number.isFinite(n) || n < 0) throw new Error('Distribution weights must be non-negative numbers');
    return n;
  });
  const sum = clean.reduce((acc, n) => acc + n, 0);
  if (sum <= 0) throw new Error('Distribution weights must sum to a positive number');
  return clean.map((n) => n / sum);
}

function expectedValue(buckets: DistributionBucket[], probabilities: number[]): number {
  return buckets.reduce((acc, bucket, index) => acc + bucket.midpoint * probabilities[index], 0);
}

function entropy(probabilities: number[]): number {
  return probabilities.reduce((acc, probability) => {
    if (probability <= 0) return acc;
    return acc - probability * Math.log2(probability);
  }, 0);
}

function l2Distance(a: number[], b: number[]): number {
  return Math.sqrt(a.reduce((acc, value, index) => acc + (value - b[index]) ** 2, 0));
}

export function listDistributionTemplates(): DistributionTemplate[] {
  return templates;
}

export function quoteDistributionMarket(args: {
  marketId: string;
  weights: number[];
  amountUsdc: number;
}): DistributionQuote {
  const template = findTemplate(args.marketId);
  const amountUsdc = Number(args.amountUsdc);
  if (!Number.isFinite(amountUsdc) || amountUsdc <= 0) {
    throw new Error('amount_usdc must be a positive number');
  }
  const normalized = normalizeWeights(args.weights, template.buckets.length);
  const reference = template.buckets.map((bucket) => bucket.reference_probability);
  const maxIndex = normalized.reduce((best, value, index) => value > normalized[best] ? index : best, 0);
  const makerFeeUsdc = amountUsdc * MAKER_FEE_RATE;
  const netCollateralUsdc = amountUsdc - makerFeeUsdc;
  const amountRaw = String(Math.round(amountUsdc * DECIMALS));

  return {
    market_id: template.id,
    amount_usdc: roundUsd(amountUsdc),
    amount_raw: amountRaw,
    weights: args.weights,
    normalized,
    expected_value: expectedValue(template.buckets, normalized),
    reference_expected_value: expectedValue(template.buckets, reference),
    peak_bucket: template.buckets[maxIndex],
    l2_distance: l2Distance(normalized, reference),
    entropy: entropy(normalized),
    maker_fee_usdc: roundUsd(makerFeeUsdc),
    net_collateral_usdc: roundUsd(netCollateralUsdc),
    payout_curve: template.buckets.map((bucket, index) => {
      const payoutUsdc = netCollateralUsdc * normalized[index];
      return {
        bucket_id: bucket.id,
        label: bucket.label,
        probability: normalized[index],
        reference_probability: bucket.reference_probability,
        payout_usdc: roundUsd(payoutUsdc),
        pnl_usdc: roundUsd(payoutUsdc - amountUsdc * bucket.reference_probability),
      };
    }),
  };
}

export async function openDistributionPosition(args: {
  marketId: string;
  weights: number[];
  amountUsdc: number;
  recipient?: string;
}): Promise<DistributionPosition> {
  const template = findTemplate(args.marketId);
  const quote = quoteDistributionMarket(args);
  const onchain = await openSuiLocalBasketPosition({
    bundleId: `DIST-${template.id}`,
    amountRaw: quote.amount_raw,
    recipient: args.recipient,
  }) as SuiOpenResult;

  const position: DistributionPosition = {
    id: randomUUID(),
    owner: onchain.owner,
    market_template_id: template.id,
    template_name: template.name,
    created_at: new Date().toISOString(),
    quote,
    chain: 'sui',
    network: onchain.network,
    sui_market_id: onchain.market_id,
    sui_position_id: onchain.position_id,
    digests: onchain.digests,
    status: 'open',
  };
  positions.unshift(position);
  return position;
}

export function listDistributionPositions(owner?: string): DistributionPosition[] {
  if (!owner) return positions;
  return positions.filter((position) => position.owner.toLowerCase() === owner.toLowerCase());
}

export async function settleDistributionPosition(id: string): Promise<DistributionPosition> {
  const position = positions.find((candidate) => candidate.id === id);
  if (!position) throw new Error(`Unknown distribution position: ${id}`);
  if (position.status === 'settled') return position;

  const redemption = await redeemSuiLocalBasketPosition({
    marketId: position.sui_market_id,
    positionId: position.sui_position_id,
  }) as SuiRedeemResult;

  position.status = 'settled';
  position.digests.resolve = redemption.digests.resolve;
  position.digests.claim = redemption.digests.claim;
  return position;
}

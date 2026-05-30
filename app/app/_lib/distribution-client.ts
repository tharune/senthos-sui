"use client";

import { BACKEND_URL } from "./tokens";

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
  chain: "sui";
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
  status: "open" | "settled";
};

async function readJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  const payload = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload
        ? String((payload as { error: unknown }).error)
        : `HTTP ${res.status}`;
    throw new Error(message);
  }
  return payload as T;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BACKEND_URL}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return readJson<T>(res);
}

export async function fetchDistributionTemplates(): Promise<DistributionTemplate[]> {
  const res = await fetch(`${BACKEND_URL}/api/distribution/templates`, { cache: "no-store" });
  const body = await readJson<{ templates: DistributionTemplate[] }>(res);
  return body.templates;
}

export async function fetchDistributionPositions(owner?: string): Promise<DistributionPosition[]> {
  const suffix = owner ? `?owner=${encodeURIComponent(owner)}` : "";
  const res = await fetch(`${BACKEND_URL}/api/distribution/positions${suffix}`, { cache: "no-store" });
  const body = await readJson<{ positions: DistributionPosition[] }>(res);
  return body.positions;
}

export async function quoteDistribution(args: {
  marketId: string;
  weights: number[];
  amountUsdc: number;
}): Promise<DistributionQuote> {
  const body = await postJson<{ quote: DistributionQuote }>("/api/distribution/quote", {
    market_id: args.marketId,
    weights: args.weights,
    amount_usdc: args.amountUsdc,
  });
  return body.quote;
}

export async function openDistribution(args: {
  marketId: string;
  weights: number[];
  amountUsdc: number;
  recipient?: string;
}): Promise<DistributionPosition> {
  const body = await postJson<{ position: DistributionPosition }>("/api/distribution/open", {
    market_id: args.marketId,
    weights: args.weights,
    amount_usdc: args.amountUsdc,
    recipient: args.recipient,
  });
  return body.position;
}

export async function settleDistribution(id: string): Promise<DistributionPosition> {
  const body = await postJson<{ position: DistributionPosition }>(`/api/distribution/positions/${id}/settle`, {});
  return body.position;
}

import { computeBasketStats, quoteTranchesFromStats, quoteTrancheOrder } from "../app/app/tranche/_quote";
import { computeHedgeability } from "../app/app/tranche/_risk";

function mkMarkets(baseProb: number, n: number, vol: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `m${i}`,
    slug: `m${i}`,
    question: `q${i}`,
    probability: Math.max(0.01, Math.min(0.99, baseProb + ((i % 5) - 2) * 0.01)),
    spread: 0.01,
    volumeUsd: vol * (0.8 + (i % 7) / 10),
    weight: 1 / n,
    category: "other",
    tokenId: undefined,
    closesAt: new Date(Date.now() + 1000 * 3600 * 24 * 60).toISOString(),
  }));
}

const cases = [
  { name: "HIGH-SHORT", nav: 0.943, tier: 90 as const, days: 14, markets: mkMarkets(0.94, 180, 45_000) },
  { name: "HIGH-MED", nav: 0.943, tier: 90 as const, days: 62, markets: mkMarkets(0.94, 180, 45_000) },
  { name: "HIGH-LONG", nav: 0.943, tier: 90 as const, days: 220, markets: mkMarkets(0.94, 180, 45_000) },
  { name: "MID-SHORT", nav: 0.519, tier: 70 as const, days: 14, markets: mkMarkets(0.52, 180, 45_000) },
  { name: "MID-MED", nav: 0.519, tier: 70 as const, days: 62, markets: mkMarkets(0.52, 180, 45_000) },
  { name: "MID-LONG", nav: 0.519, tier: 70 as const, days: 220, markets: mkMarkets(0.52, 180, 45_000) },
  { name: "LOW-SHORT", nav: 0.043, tier: 50 as const, days: 14, markets: mkMarkets(0.045, 110, 28_000) },
  { name: "LOW-MED", nav: 0.043, tier: 50 as const, days: 63, markets: mkMarkets(0.045, 110, 28_000) },
  { name: "LOW-LONG", nav: 0.043, tier: 50 as const, days: 220, markets: mkMarkets(0.045, 110, 28_000) },
];

const amounts = [10, 100, 1_000, 10_000, 25_000];

for (const c of cases) {
  const stats = computeBasketStats(c.nav, c.markets, c.markets.length, c.days, c.tier);
  const quotes = quoteTranchesFromStats(stats);
  const hedgeability = computeHedgeability(c.markets, new Map());
  console.log(`\n=== ${c.name} (NAV ${(c.nav * 100).toFixed(1)}%, sigma ${(stats.sigma * 100).toFixed(2)}%) ===`);
  for (const q of quotes) {
    console.log(
      `\n${q.kind.toUpperCase()} fair=${q.fairPrice.toFixed(4)} ask=${q.marketPrice.toFixed(4)} any=${(q.attachProbability * 100).toFixed(2)}% full=${(q.fullPayProbability * 100).toFixed(2)}%`,
    );
    for (const a of amounts) {
      const o = quoteTrancheOrder(q, a, 35, { stats, hedgeability });
      console.log(`  $${a}: fees ${(o.totalFeeBps / 100).toFixed(2)}% | slip ${(o.slippageBps / 100).toFixed(2)}% | out ${o.tokensOut.toFixed(1)}`);
    }
  }
}

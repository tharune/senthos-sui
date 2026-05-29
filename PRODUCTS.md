# Senthos Product Taxonomy
Four primitives compose the entire Senthos product universe. Each is backed by the same set of underlying prediction markets; what differs is the payoff structure and risk allocation on top.
## The four primitives
### 1. Native Basket (Index)
A tokenized share of a pool of uncorrelated prediction market contracts. Holders get pro-rata exposure to the aggregate payout.
- Route: `/app/basket`, `/app/basket/[id]`
- Backend: `/api/bundles`, `/api/bundles/:id`
- Sandbox action: `basket/deposit`
- Payoff: one STHS token pays up to $1.00 at resolution, pro-rata to the basket's aggregate outcome
### 2. Tranched Pool Tokens
The same basket sliced into senior, mezzanine, and junior tranche tokens with an explicit payout waterfall.
- Route: `/app/tranche`, `/app/tranche/[id]`
- Backend: `/api/tranches`, `/api/tranches/:bundleId`
- Sandbox action: `tranche/deposit`
- Default attach/detach: senior 0–60%, mezzanine 60–85%, junior 85–100% of basket payout
- Pricing: fair-value + fixed premium + live slippage + liquidity-aware risk add-ons with bounded quadratic size scaling
- UX: waterfall bar; issue price, expected APY, any/full payout probabilities, and sell RFQ with `% of FV` quote
### 3. Principal Protected Note (PPN)
Structured token that locks principal in a yield vault and deploys only the expected yield into a prediction basket.
- Route: `/app/ppn`
- Backend: `/api/ppn` (existing)
- Sandbox action: `ppn/open`
- Default APY: 8.4% (Meteora USDC vault proxy)
- Payoff at maturity: principal guaranteed + basket-proportional yield return
### 4. Lending / Repo Market
Single USDC pool where holders post basket or tranche tokens as collateral to borrow USDC. Loans self-liquidate at basket resolution.
- Route: `/app/lending`
- Backend: `/api/lending`
- Sandbox actions: `lending/deposit`, `lending/withdraw`, `lending/borrow`, `lending/repay`
- LTV table: basket 90% tier = 0.85, 70% tier = 0.60, 50% tier = 0.40; tranches: senior 0.88, mezzanine 0.60, junior 0.30
- Rate model: piecewise linear utilization curve; supply APY = borrow APY × utilization × (1 − reserve factor 10%)
## Composition rules
These four primitives are designed to stack. Example loops we support on day one:
- Basket → Tranche → Lending: split a basket into tranches, keep junior for upside, post senior as collateral to borrow and buy more junior
- Cash → PPN: lock principal for risk-off yield while still participating in prediction market upside
- Basket → Lending: lever existing basket positions without unwinding them
- Hedge builder → Basket: use the hedge builder to design a custom long/short basket against the correlation gate, then deposit as a normal basket position
## Probability-zone matrix
How each primitive behaves across the probability spectrum:
Zone: ≥90% (near-money)
- Native Basket: money-market-like; variance collapses at scale
- Tranched Pool: senior tranche is pension-grade; junior is a small risk/return layer
- PPN: near-certain coupon + tiny speculative overlay
- Lending: ~85% LTV repo; self-liquidating at resolution
Zone: 40–75% (uncertain)
- Native Basket: delta-neutral barbells, alpha extraction from mispricings
- Tranched Pool: event-CLO analog; 3–5 tranches AAA-to-BB equivalent
- PPN: partial protection (family office sleeve) against basket
- Lending: margin lending; LTV scales with probability
Zone: ≤10% (tail)
- Native Basket: multi-trigger catastrophe hedge
- Tranched Pool: inverse catastrophe tranche (junior pays first)
- PPN: 95% T-bill + 5% long-shot "lottery note"
- Lending: float harvesting / short-premium book
## API surface map
Markets
- `GET /api/markets` — raw Polymarket listing
- `GET /api/markets/curated` — NLP + quality filter output (primary entry for every product)
- `GET /api/markets/curated/stats` — lifetime filter funnel counters
Native Basket
- `GET /api/bundles`, `GET /api/bundles/:id`, `GET /api/bundles/:id/performance`, `GET /api/bundles/:id/analysis`
- `POST /api/bundles` (runs the correlation gate + market-filter gate)
- `POST /api/deposit/prepare`, `POST /api/deposit/confirm`, redeem analogs
Tranche
- `GET /api/tranches`, `GET /api/tranches/:bundleId`
- `POST /api/ppn/tranche/sell/rfq` — per-lot sell RFQ (indicative `% of FV`, executable status)
PPN
- `POST /api/ppn/deposit`, `GET /api/ppn/portfolio/:walletAddress`, `POST /api/ppn/withdraw/:vaultId`
Lending
- `GET /api/lending`
- `POST /api/lending/quote`, `POST /api/lending/lend|withdraw|borrow|repay`
Hedge builder
- `POST /api/hedge/analyze` — pairwise correlation matrix, optimized weights, risk verdict, delta approximation
Model + ML
- `GET /api/ml/manifest`, `GET /api/ml/metrics`
Observability
- `GET /api/metrics` (JSON), `http://localhost:3002/data` (monitor JSON), `http://localhost:3002/` (HTML dashboard)
## What is real today vs. what is in-memory
Real backend + on-chain:
- Native Basket (Anchor `traxis_vault`, Supabase persistence, full deposit/redeem flows)
- PPN (Anchor `traxis_ppn`, Supabase persistence)
- Correlation model, market filter, metrics, monitor
In-memory / sandbox demo (clearly marked in UI):
- Tranches (pricing engine is real; positions are client-state)
- Lending pool (math is real; pool state is in-memory)
- Hedge builder positions (analysis is real; when you deposit, it creates a Native Basket position locally)
## Roadmap toward full on-chain
Short term (no Anchor changes needed):
- Persist tranche and lending positions in Supabase alongside baskets
- Extend the monitor with tranche + lending panels
- Promote the hedge-builder output to create a real Anchor vault via the existing `traxis_vault` program
Medium term (new Anchor programs):
- `traxis_tranches`: on-chain waterfall contract, tokenises senior/mezz/junior as separate SPL mints, enforces the payout order at resolution
- `traxis_lending`: standalone lending program with basket/tranche tokens as SPL-compatible collateral, on-chain LTV/liquidation keeper, self-liquidates at the basket resolution slot
Neither of these is blocking for the hackathon demo, which is why the initial implementation stays in-memory and UI-forward.

# Senthos — Architecture & Onboarding Guide
This is the single document a new teammate should read first. It covers the system topology, every runtime process, every route, and the math powering the non-obvious parts (correlation model, NLP pipeline, tranche pricing, lending curve).
If you are onboarding, read this doc in order and skim the linked files as you go. If you are making changes, the last section ("Recipes") shows you where to start for common tasks.

## 1. What Senthos is
Senthos packages prediction-market outcomes into four structured products: Native Basket (tokenized index), Tranched Pool Tokens (senior / mezzanine / junior claims), Principal Protected Notes (PPN), and a Lending / Repo Market. A fifth surface, the Hedge Builder, lets users compose custom long/short baskets from live Polymarket markets with live correlation + risk scoring.
Everything is Solana-first: baskets and PPN are real Anchor programs deployed to devnet. Tranches and lending live at the service layer for the hackathon scope; their math is real but state is in-memory (see `PRODUCTS.md` for the roadmap to on-chain).

## 2. Top-level layout
Single repo with four sub-systems. Frontend is the root Next.js app; backend, Anchor programs, and ML artifacts are sibling directories.
```
/
├── app/                          # Next.js App Router root (/ and /app/*)
├── backend/                      # Express backend (ports 3001, 3002)
├── programs/                     # Solana Anchor programs (Rust)
│   ├── traxis_vault/             #   Native Basket vault
│   └── traxis_ppn/               #   PPN vault
├── traxis-correlation-deliverables/   # ML artifacts (consumed by backend)
├── migrations/                   # Supabase SQL
├── scripts/                      # Repo-wide scripts (init demo vaults, etc.)
├── tests/                        # Anchor integration tests
├── Anchor.toml, Cargo.toml       # Solana workspace
├── next.config.ts, package.json  # Next.js config
└── docs:
    ├── README.md
    ├── ARCHITECTURE.md           # this file
    ├── SESSION_NOTES.md
    ├── PRODUCTS.md
    ├── MARKET_FILTER.md
    ├── MODEL_INTEGRATION.md
    └── CREDENTIALS.md
```

## 3. Runtime topology
Three processes run locally during development. In production the backend + monitor are one Node process; the Next.js app is a separate deployment.
```
┌─────────────────────────────────────────────────────────────┐
│                     Polymarket Gamma API                    │
└────────────────┬────────────────────────────────────────────┘
                 │ HTTPS
                 ▼
┌─────────────────────────────────────────────────────────────┐
│  Express backend (Node, port 3001)                          │
│  ─ routes/          (markets, bundles, tranches, lending,   │
│                      hedge, ppn, ml, onchain, metrics, ...) │
│  ─ services/        (correlation, nlp, market-filter,       │
│                      tranching, lending, pricing, nav, ...) │
│  ─ monitor/         (in-process monitor on port 3002)       │
│  ─ cron: price refresh every 2 min                          │
└──┬────────────────────────────┬──────────────────┬──────────┘
   │ HTTP (server components)   │ JSON RPC        │ import
   ▼                            ▼                  ▼
┌──────────────────────┐   ┌────────────────┐  ┌─────────────┐
│ Next.js app (3000)   │   │ Solana devnet  │  │ Supabase    │
│ / = landing          │   │ traxis_vault   │  │ (mock when  │
│ /app = Markets       │   │ traxis_ppn     │  │  unconfig.) │
│ /app/basket          │   └────────────────┘  └─────────────┘
│ /app/tranche         │
│ /app/ppn             │
│ /app/lending         │
│ /app/hedge           │
│ /app/portfolio       │
└──────────────────────┘
                 ▲
                 │ browser
                 ▼
             End user
```
Key design rule: **`/api/markets/curated` is the single entry point for every product that needs markets** (Hedge Builder especially). It wraps the raw Polymarket feed in the NLP + quality filter pipeline so no product ever sees a troll market.

## 4. Start / stop everything locally
### Prerequisites
- Node 22 (via nvm). `nvm use 22`.
- A `backend/.env` file. Defaults are fine for local; Supabase falls back to an in-memory mock if `SUPABASE_URL` / `SUPABASE_ANON_KEY` are placeholders. See `CREDENTIALS.md` for the complete env var inventory.
### Start
Two processes, two terminals:
```sh
# Backend + monitor (ports 3001 + 3002)
cd backend && npm install && npm run dev
# → "Senthos backend running on port 3001"
# → "Monitor server running on http://localhost:3002"
```
```sh
# Frontend (port 3000)
npm install
npm run dev
# → ▲ Next.js 16.2.4 (Turbopack), Ready in ~600ms
```
Open http://localhost:3000.
### Stop
Kill the dev processes with Ctrl-C, or from another terminal:
```sh
lsof -nP -iTCP:3000 -sTCP:LISTEN -t | xargs kill -9
lsof -nP -iTCP:3001 -sTCP:LISTEN -t | xargs kill -9
# 3002 shares the backend process; stopping 3001 stops the monitor too
```
### Verify
```sh
# Health checks
curl http://localhost:3001/api/health        # backend + deps
curl http://localhost:3001/api/onchain/status # Solana devnet, both programs
curl http://localhost:3002/data               # monitor JSON
curl http://localhost:3000/app                # markets page

# NLP + filter probes
cd backend && npx tsx scripts/nlp-probe.ts   # 26 assertions
```

## 5. Frontend walkthrough
Next.js 16 App Router with React 19. The root layout is the marketing landing; every `/app/*` route lives under a client-side shell that shares the sandbox context.
### Directory map
```
app/
├── layout.tsx                    # Global HTML shell (title, favicon)
├── globals.css
├── page.tsx                      # Landing (/), server component, fetches live stats
└── app/                          # Authenticated app shell
    ├── layout.tsx                # Wraps every /app/* in <SandboxProvider>
    ├── page.tsx                  # /app = Markets (live curated feed + product tiles)
    ├── _lib/                     # Private (leading "_" means Next.js ignores it as a route)
    │   ├── tokens.ts             # Colours, fonts, BACKEND_URL, helpers
    │   ├── bundles.ts            # 15 seeded STHS baskets
    │   └── demo-state.tsx        # SandboxProvider + useSandbox (reducer)
    ├── _components/              # Private
    │   ├── charts.tsx            # Sparkline, SvgDonut, PulseGauge, BundleCard, etc.
    │   └── Header.tsx            # Shared horizontal nav + balance pill
    ├── basket/
    │   ├── page.tsx              # /app/basket index
    │   └── [id]/page.tsx         # /app/basket/:id detail + deposit
    ├── tranche/
    │   ├── page.tsx              # /app/tranche index (15 baskets × 3 tranches)
    │   ├── _quote.ts             # Client-side tranche pricing (mirrors backend)
    │   └── [id]/page.tsx         # /app/tranche/:id detail + deposit
    ├── ppn/page.tsx              # /app/ppn (single-level route)
    ├── lending/page.tsx          # /app/lending
    ├── hedge/page.tsx            # /app/hedge (custom basket builder)
    └── portfolio/page.tsx        # /app/portfolio (cross-primitive view)
```
Anything with an `_` prefix is a [Next.js private folder](https://nextjs.org/docs) and never routes. The legacy monolithic page was archived at `app/_backup/monolith-page.tsx.bak` for reference.
### Sandbox state
All demo state lives in a single typed reducer in `app/app/_lib/demo-state.tsx`. The provider is installed once in `app/app/layout.tsx` and every product route reads/writes through `useSandbox()`.
```ts
type SandboxState = {
  usdc: number;
  basketPositions:  { bundleId, qty, avgCost }[];
  tranchePositions: { bundleId, kind, qty, avgCost }[];
  ppnVaults:        { id, bundleId, principal, basketAmount, apy, createdAt, maturityDays }[];
  loans:            { id, collateralKind, bundleId, trancheKind?, collateralQty,
                      borrowedUsdc, rateApy, openedAt }[];
  lend: { amount, startApy, startedAt } | null;
};
```
Actions dispatched: `reset`, `basket/deposit`, `basket/redeem`, `tranche/deposit`, `ppn/open`, `ppn/close`, `lending/borrow`, `lending/repay`, `lending/deposit`, `lending/withdraw`. See the reducer source for arguments.
Starting USDC is 10,000 (`SANDBOX_STARTING_USDC` in `tokens.ts`). A browser refresh or "Reset" button clears all positions and restores the starting balance.
### Per-page overview
- `/` — Marketing landing, server component. Fetches `/api/health`, `/api/onchain/status`, `/api/ml/metrics`, `/api/markets` in parallel and renders stats + hero + product tiles.
- `/app` (Markets) — Live Polymarket feed via `/api/markets/curated`, 4 product entry tiles, category filter. Polls every 30 s.
- `/app/basket` + `/[id]` — Grid of 15 seeded STHS baskets, filterable by tier (90/70/50), window, and sort. Detail page has NAV chart, metric tiles, deposit flow.
- `/app/tranche` + `/[id]` — Every basket auto-quoted into senior (0–60%) / mezzanine (60–85%) / junior (85–100%). Detail shows waterfall bar, attach/full-pay probabilities, per-tranche issue price + APY, deposit form.
- `/app/ppn` — First-class PPN product. Pick a reference basket + maturity; principal stays safe, yield is deployed into predictions.
- `/app/lending` — Dual-pane. Left = borrow against basket collateral at tier-specific LTV; right = supply USDC to earn utilization-scaled APY. Pool snapshot up top, loans list at bottom.
- `/app/hedge` — Custom basket builder. Pulls curated markets, each togglable as YES or NO. Every edit POSTs to `/api/hedge/analyze` and updates correlation matrix, risk-gate verdict, delta, and optimizer weights in-place.
- `/app/portfolio` — Unified cross-primitive view. Donut of cash / baskets / tranches / PPN / lending at the top, grouped position lists below with deep links back to each product.
### Shared components worth knowing
- `<Sparkline>` — 30-day NAV mini-chart (Canvas, DPR-aware)
- `<PulseGauge>` — Circular probability gauge for market cards
- `<SvgDonut>` — Portfolio allocation chart with hover + active slice offset
- `<BundleCard>` — Standard basket tile used by multiple pages
- `<MetricTile>` — Uniform "LABEL / value / sub" stats tile
- `<Pill>` — Filter / segmented control
- `<Header>` + `<PageFrame>` — Authenticated shell chrome

## 6. Backend walkthrough
Express 4 + TypeScript, single entry point at `backend/src/index.ts`. Non-blocking initialisation — missing Supabase creds degrade to an in-memory mock rather than crashing.
### Directory map
```
backend/src/
├── index.ts                 # App entry: mounts all routes + starts monitor + cron
├── config/                  # Env loading, Supabase detection
├── db/                      # Supabase client + mock + queries
├── middleware/              # Logger + error handler
├── monitor/                 # Standalone port-3002 dashboard
│   ├── server.ts            # Express app on 3002, /data endpoint
│   └── monitor.html         # Single-page self-contained HTML dashboard
├── routes/                  # HTTP surface (one file per feature)
│   ├── markets.ts           # Polymarket proxy + curated filter endpoints
│   ├── bundles.ts           # Native Basket CRUD + ML gate on POST
│   ├── tranches.ts          # Tranche quotes per bundle
│   ├── lending.ts           # Pool state + lend/borrow/repay
│   ├── hedge.ts             # /api/hedge/analyze
│   ├── ppn.ts               # PPN deposit/withdraw/portfolio
│   ├── deposit.ts           # Wallet-signed two-step basket deposit/redeem
│   ├── nav.ts, admin.ts, alerts.ts, ml.ts, onchain.ts, metrics.ts, sse.ts,
│   ├── leaderboard.ts, batch.ts, demo.ts, webhook.ts, docs.ts
├── services/                # Business logic
│   ├── correlation.ts       # ML-backed basket gate (loads audited artifacts)
│   ├── nlp.ts               # Tokenizer, stemmer, classifier, TF-IDF, quality
│   ├── market-filter.ts     # 5-stage filter pipeline + gateCheckLeg
│   ├── tranching.ts         # Senior/mezz/junior pricing via Normal-CDF
│   ├── lending.ts           # Pool state + utilization-based rate curve
│   ├── pricing.ts, nav.ts   # NAV computation + live probability refresh
│   ├── polymarket.ts        # Gamma API client
│   ├── metrics.ts           # In-memory counters + ring buffers (monitor store)
│   ├── cron.ts              # Price refresh job (every 2 min)
│   ├── solana.ts, onchain-bridge.ts, analytics.ts
├── solana/                  # Anchor client + IDL loader
├── idl/                     # traxis_vault.json + traxis_ppn.json IDLs
├── types/                   # Shared TS types
├── utils/                   # Zod validators, shared helpers
└── scripts/
    └── nlp-probe.ts         # 26-assertion NLP/pipeline smoke test
```
### HTTP surface
Mounted in `index.ts` under `/api/*`. Ports: 3001 = API, 3002 = monitor.
| Route prefix        | Purpose                                                 | Key verbs                                              |
|---------------------|----------------------------------------------------------|--------------------------------------------------------|
| `/api/health`       | Liveness + dep checks                                    | GET                                                    |
| `/api/markets`      | Polymarket passthrough                                   | GET list, GET `/:conditionId`, GET `/search/:query`    |
| `/api/markets/curated` | Filtered by NLP + quality pipeline                    | GET (+ `/stats`)                                       |
| `/api/bundles`      | Native Basket CRUD; POST runs market-filter + ML gate    | GET, GET `/name/:n`, `/:id/performance`, POST          |
| `/api/tranches`     | Senior/mezz/junior quotes                                | GET list, GET `/:bundleId`                             |
| `/api/lending`      | Pool snapshot, quote, lend/borrow/repay/withdraw         | GET, POST `/quote|lend|withdraw|borrow|repay`          |
| `/api/hedge`        | Custom basket analysis                                   | POST `/analyze`                                        |
| `/api/ppn`          | Principal Protected Notes                                | POST `/deposit`, GET `/portfolio/:w`, POST `/withdraw/:id` |
| `/api/deposit`      | Non-custodial wallet-signed basket deposit/redeem        | POST `/prepare`, POST `/confirm`, redeem analogs       |
| `/api/nav`          | Live NAV + history                                       | GET                                                    |
| `/api/ml`           | ML artifacts manifest + live metrics                     | GET `/manifest`, `/metrics`                            |
| `/api/onchain`      | Solana RPC probe + program status                        | GET `/status`                                          |
| `/api/metrics`      | Monitor snapshot (JSON)                                  | GET                                                    |
| Others              | admin, alerts, demo, docs, leaderboard, batch, webhook, sse (self-documented) | various |

## 7. Correlation model (the heart of the risk gate)
Every bundle creation runs through `services/correlation.ts`. The module loads four JSON artifacts from `traxis-correlation-deliverables/` at startup (lazy, memoised) and exposes three functions.
### Data flow
```
POST /api/bundles
   │
   │ enriched legs (Polymarket metadata attached)
   ▼
gateCheckLeg per leg  ◄── market-filter.ts
   │ (activity, quality_nlp, time_window)
   │
   ▼  (passing legs only)
optimizeWeights(legs) ◄── correlation.ts
   │ NxN corr matrix via scoreLegPair
   │ → per-leg 1-mean(corr) → normalise → clamp [2%, 25%]
   ▼
assessBasketRisk(legs, weights)
   │ internal_corr_mean via Σ w_i w_j ρ_ij
   │ σ_basket = σ_daily * √(ρ + (1-ρ)/N)
   │ VaR_95 = 1.645·σ·√7 , VaR_99 = 2.326·σ·√7 , CVaR_99 = 2.665·σ·√7
   │ risk_ratio = √(N·ρ + 1 − ρ)        (1.0 = fully diversified)
   ▼
accepted if risk_ratio ≤ 1.25           (tolerance)
```
### `scoreLegPair(a, b)` — the heuristic
Produces a [0, 1] predicted correlation. Three signals combined via **noisy-OR**:
- `textSim` = Jaccard over normalised question tokens (same tokenizer as NLP module)
- `tagSim` = Jaccard over Polymarket tags (if present)
- `temporalSim` = Gaussian decay on days-between-end-dates
```
notCorr = Π_i (1 − sim_i)
pairScore = 1 − notCorr
```
Design choice: noisy-OR instead of weighted sum so that a *single* strong signal (e.g., near-identical question text) flags the pair even without shared tags. This is intentionally conservative — it never under-estimates correlation vs the sklearn classifier in the audited artifact.
### Why a heuristic and not the classifier?
The trained sklearn classifier lives in `traxis-correlation-deliverables/*.tar.zst` and requires Python to invoke. The backend is pure Node. The TypeScript heuristic is a calibrated stand-in that matches the classifier's decision boundary (|ρ| >= 0.6) on every training-set pair that ever flipped. Details and audit in `MODEL_INTEGRATION.md`.
### Weights (`optimizeWeights`)
Greedy decorrelation:
1. Build the NxN pair-score matrix.
2. For each leg, compute its mean pair-score with the rest of the basket.
3. Raw weight = 1 − mean_pair_score, normalise to sum 1.
4. Clamp each weight to `[2%, 25%]`, renormalise.
For baskets of size ≤12 the decorrelation signal is noisy, so the optimiser effectively produces near-even weights — intentional for small baskets.
### Risk gate
`assessBasketRisk` projects a 7-day basket VaR and compares the **ratio** (not absolute) against the audited fully-diversified baseline. Previous absolute-CVaR comparison failed on small baskets because the audit was run at N=50; ratio framing handles any N.

## 8. NLP + market-filter pipeline
Implemented in `services/nlp.ts` + `services/market-filter.ts`. Full doc in `MARKET_FILTER.md`. Five stages, applied in order, short-circuit on failure:
1. `liquidity_floor` — drop closed / inactive / volume < $5k / no YES price
2. `quality_nlp` — drop troll / unanswerable via `assessQuality`
3. `time_window` — drop resolves-in < 2d or > 180d
4. `category_classify` — softmax over 7 lexicons; default-reject `other` and `entertainment`
5. `diversity_prefilter` — dedupe via TF-IDF cosine + `scoreLegPair`
### Why the pipeline matters
Polymarket's raw list is full of noise — troll markets ("Will Jesus return before GTA VI?"), markets resolving in hours, near-duplicate NHL-team-wins-Cup markets, uncategorisable joke markets. Every product (Basket construction, Hedge Builder, Markets page) goes through `/api/markets/curated` so no UI ever sees noise.
### Bundle gate
A caller-supplied bundle goes through a stricter `gateCheckLeg` that runs **all three** gate-relevant stages independently (no short-circuit) so a failure in one doesn't hide failures in others. The gate fails closed: a closed/inactive market AND a troll question produce two distinct failure reasons in the response.

## 9. Tranche pricing
Primary implementation is in `app/app/tranche/_quote.ts` with risk inputs from `app/app/tranche/_risk.ts`. Backend tranche list quotes come from `backend/src/services/tranching.ts`.

### Waterfall
Attach/detach bands are distribution-derived:
- senior: `[0, K1]`
- mezzanine: `[K1, K2]`
- junior: `[K2, 1]`

`K1` and `K2` move with basket NAV and sigma, so tranche widths adapt by tier and duration.

### Quote model
Buy quotes combine:
1. fair-value tranche price (call-spread form under Normal approximation)
2. fixed premium layer (protocol + MM premium)
3. order-book slippage
4. liquidity/risk adjustments (inventory, concentration, warehouse, underwriting)

Size response uses a bounded liquidity curve:
- quadratic core in utilization
- early ramp for low-ticket sensitivity
- smooth saturation to avoid unstable tails

Inputs include tranche kind, duration, sigma, and profile stress multipliers (95/50/5 tier mapping).

### Sell RFQ flow
Tranche sell path uses RFQ:
- `POST /api/ppn/tranche/sell/rfq` returns per-lot indicative `% of FV` and execution status
- UI shows a single `% of FV` line for each lot (clean view, no component-level fee string)
- quote request intentionally shows a randomized ~2–3 second loading state

Lots marked `can_execute_onchain` are redeemable immediately; `rfq_only` lots are quoted but not executable yet.

## 10. Lending pool
Located in `backend/src/services/lending.ts`. Single USDC pool, in-memory state.
### LTV table
```
basket tier   90%  →  0.85
basket tier   70%  →  0.60
basket tier   50%  →  0.40
tranche senior   →  0.88
tranche mezzanine→  0.60
tranche junior   →  0.30
```
### Rate curve
Piecewise linear utilization curve:
- u ≤ 0.8 :  borrowAPY = 0.02 + 0.08·u    (2% → 8.4%)
- u > 0.8 :  borrowAPY = 0.084 + 0.60·(u − 0.8)   (steep slope above 80%)
Supply APY = borrow APY × utilization × (1 − reserve_factor), with reserve_factor = 0.1.
### State transitions
The pool seeds with 50,000 USDC of deposits, 0 borrows. `POST /api/lending/lend|withdraw|borrow|repay` mutates the pool; every response returns the fresh snapshot. The frontend mirrors the sandbox actions locally so the wallet balance + the pool stat both update without round-trips.

## 11. Hedge Builder
`POST /api/hedge/analyze` is the single endpoint powering `/app/hedge`. It composes three existing services:
```
legs = [{market_id, side: YES|NO, question?}, ...]
   │
   │ fetch live Polymarket market per leg in parallel
   ▼
for each leg:
   yesProb = outcomePrices[0]
   effective = side === 'NO' ? 1 - yesProb : yesProb
   ▼
LegMetadata[] =  {id, question, end_date_iso, probability: effective}
   │
   ▼
scoreLegPair matrix   ◄── correlation.ts
optimizeWeights       ◄── correlation.ts
assessBasketRisk      ◄── correlation.ts
   │
   ▼
response:
  legs[] with effective_probability + weight
  correlation[] pairwise matrix
  risk: { accepted, internal_corr_mean, VaR_95, VaR_99, CVaR_99 }
  delta_approx  = Σ w_i · (p_effective_i − 0.5)
```
The NO-side trick is critical: a YES contract at probability p is economically equivalent to a NO contract at (1 − p), so flipping `probability` lets users construct synthetic shorts without the backend needing a new primitive.

## 12. Monitor (port 3002)
`backend/src/monitor/server.ts` + `monitor.html`. Shares the main Node process so it can import the `metrics` store directly (no serialization, no round-trips).
The HTML dashboard is **self-contained** — no external JS, no CSS framework, no chart libs. It polls `/data` every 1 s and renders 15 rows via hand-rolled Canvas / SVG:
- Status / uptime / PID / platform
- RPM + error rate + latency timeline
- Traffic by bucket / status stack / hot routes / recent requests
- Process memory + CPU load
- Solana RPC slot / epoch / program status
- External services (Polymarket, Supabase, RPC)
- Protocol state (bundle / leg / position counts)
- USDC flows (deposited, redeemed, net TVL, fees)
- Cron history
- ML audit (classifier precision, walk-forward p-value, VaR/CVaR)
- Model usage (bundles scored / accepted / rejected with recent events)
- **Market filter funnel** (seen / kept / rejected + per-stage totals)
- **Market filter recent runs** (last 10 invocations with stage-level rejection breakdown)
Pause button + polling interval selector (0.5–10 s).

## 13. Solana on-chain (devnet)
Two Anchor programs under `programs/`. Both deployed and executable on devnet.
| Program        | Program ID                                                 | Purpose                              |
|----------------|------------------------------------------------------------|--------------------------------------|
| `traxis_vault` | `DY7NAimrQZY7SxveXTb38XN7H69wAXjZZj8DRHto4Aat`             | Native Basket vault                  |
| `traxis_ppn`   | `3wDHsr9EnWkF968zYmSsj4hShNkAyFV6r7zxPrjqWNsp`             | Principal Protected Notes vault      |
Verify status at `GET http://localhost:3001/api/onchain/status`. Both programs return `deployed: true`, `executable: true`, owned by the upgradeable BPF loader.
Tranches and lending are **not** on-chain in v2; see `PRODUCTS.md` for the roadmap (`traxis_tranches`, `traxis_lending`).

## 14. Data flow: a deposit example
For new contributors, following a single user action end-to-end is the clearest way to see how the pieces connect.
**User action**: open `/app/basket/STHS-90-0430`, type `500`, click Deposit.
```
 1. React state in BasketDetail page captures amount
 2. handleConfirm() validates vs state.usdc
 3. dispatch({ type: 'basket/deposit', bundleId, usdcAmount: 500 })
 4. SandboxProvider reducer:
    ◦ tokens = 500 × 0.995 / basket.nav
    ◦ decrements state.usdc by 500
    ◦ merges into basketPositions with weighted avgCost
 5. UI re-renders: balance pill updates, portfolio donut updates next load
```
For a *real* on-chain deposit the flow continues through `POST /api/deposit/prepare` (builds the transaction, returns base64), wallet signs it, `POST /api/deposit/confirm` is called with the signature, backend verifies the tx landed on devnet and persists the row. See `backend/src/routes/deposit.ts`.

## 15. Recipes — common changes
### Add a new market category
1. Add a new key to the `Category` union in `backend/src/services/nlp.ts`
2. Add a lexicon array to `LEXICONS`
3. Add the category to `DEFAULT_FILTER_CONFIG.allowedCategories` if you want it surfaced
4. No frontend changes needed — the category flows through naturally
### Add a new NLP troll pattern
One line in `TROLL_PATTERNS` in `backend/src/services/nlp.ts`. Then re-run `npx tsx scripts/nlp-probe.ts`.
### Tune the correlation gate tolerance
`backend/src/services/correlation.ts`, inside `assessBasketRisk`:
```
const tolerance = 1.25;
```
Higher = admits more baskets; lower = stricter.
### Add a new product primitive
1. Backend: `services/<new-primitive>.ts` (pure business logic)
2. Backend: `routes/<new-primitive>.ts` (thin Express wrapper)
3. Mount in `backend/src/index.ts`
4. Frontend: add `app/app/<new-primitive>/page.tsx` (+ `[id]/page.tsx` if needed)
5. Extend `app/app/_lib/demo-state.tsx` reducer with new action types
6. Extend `app/app/portfolio/page.tsx` to show the new position class
7. Add a tile to `/app` page's product grid
### Tune tranche attach/detach points
`backend/src/services/tranching.ts` → `DEFAULT_TRANCHES`. Also update `app/app/tranche/_quote.ts` `SPECS` to match.
### Tune LTV or rate curve
`backend/src/services/lending.ts` → `LTV_BASKET`, `LTV_TRANCHE`, `borrowApy()`.
### Add a new monitor panel
Two places:
1. `backend/src/monitor/server.ts` — add a field to the `/data` JSON response
2. `backend/src/monitor/monitor.html` — new row in `scaffold()` + render in `render()`

## 16. Testing
| Test                      | Command                                                    | What it covers                 |
|---------------------------|------------------------------------------------------------|--------------------------------|
| Backend typecheck         | `cd backend && npx tsc --noEmit`                           | Type correctness               |
| Frontend typecheck        | `npx tsc --noEmit`                                         | Type correctness               |
| Frontend lint             | `npm run lint`                                             | React 19 purity, unused vars   |
| Frontend production build | `npm run build`                                            | End-to-end build + static gen  |
| NLP + filter probe        | `cd backend && npx tsx scripts/nlp-probe.ts`               | 26 assertions on NLP math      |
| Anchor tests              | `anchor test` (from repo root)                             | On-chain program behaviour     |
| HTTP smoke                | hit every endpoint listed in §6 with curl                  | Route mounting + wiring        |

## 17. Known limitations / v2 trade-offs
- Tranche and lending state is in-memory (per-backend-process). A restart wipes both. Upgrade path in `PRODUCTS.md`.
- Hedge Builder "Deposit" creates a local sandbox basket position, not an on-chain vault. Production would POST to `/api/bundles`.
- Tranche fair value still uses a Normal approximation on basket state; correlation-aware tranche valuation is a future upgrade.
- The sklearn classifier in the ML deliverables is never invoked; we use a conservative TypeScript stand-in. See `MODEL_INTEGRATION.md` §9.
- Lending and hedge remain hackathon-scope service flows, not full on-chain position rails.
- Sandbox state is ephemeral (per browser session). Promoting to Supabase tables is straightforward.

## 18. Index of docs
- `README.md` — 60-second quickstart
- `ARCHITECTURE.md` — this doc
- `SESSION_NOTES.md` — chronological session log
- `PRODUCTS.md` — product taxonomy and roadmap
- `MARKET_FILTER.md` — NLP + filter pipeline deep dive
- `MODEL_INTEGRATION.md` — correlation model + audit
- `CREDENTIALS.md` — env var inventory
- `ONCHAIN.md`, `ONCHAIN_DESIGN.md` — Anchor program notes
- `SECURITY.md`, `AUDIT.md` — security posture
- `STATE.md` — current deployment state (program IDs, vault PDAs)
- `CLAUDE.md`, `AGENTS.md` — agent-readable rules

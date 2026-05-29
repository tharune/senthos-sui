# Senthos Backend

Structured Prediction Market Products on Solana. Backend API for creating, pricing, and managing prediction market bundles powered by Polymarket.

**Stack:** Express + TypeScript + Supabase (Postgres) + Polymarket Gamma API

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
# Fill in SUPABASE_URL and SUPABASE_ANON_KEY (see Environment Variables below)

# 3. Create database tables
# Go to Supabase Dashboard > SQL Editor > New Query
# Paste contents of src/db/schema.sql and run

# 4. Verify setup
npm run setup

# 5. Seed demo data (creates 2 bundles with 10 legs each)
npm run seed

# 6. Start dev server
npm run dev
# Server runs on http://localhost:3001
```

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `SUPABASE_URL` | Yes | - | Supabase project URL (e.g. `https://abc123.supabase.co`) |
| `SUPABASE_ANON_KEY` | Yes | - | Supabase anon/public key |
| `PORT` | No | `3001` | Server port |
| `POLYMARKET_API_URL` | No | `https://clob.polymarket.com` | Polymarket CLOB API base URL |
| `FRONTEND_URL` | No | `*` | CORS allowed origin (set to Next.js URL in production) |

## API Endpoints

Base URL: `/api`

### Health and Docs

| Method | Path | Description |
|---|---|---|
| GET | `/api/health` | Health check with Supabase + Polymarket connectivity status |
| GET | `/api/docs` | Full API documentation as JSON |

### Bundles

| Method | Path | Description |
|---|---|---|
| GET | `/api/bundles` | List all bundles with NAV. Filter: `?risk_tier=90&status=active` |
| GET | `/api/bundles/:id` | Get bundle by UUID with legs and NAV |
| GET | `/api/bundles/name/:name` | Get bundle by name (e.g. `LK-90-0430`) |
| GET | `/api/bundles/:id/performance` | Rich performance metrics: risk score, probability stats, PnL |
| POST | `/api/bundles` | Create bundle with legs. Fetches live prices, calculates issue price |

### NAV (Net Asset Value)

| Method | Path | Description |
|---|---|---|
| GET | `/api/nav/:bundleId` | Live NAV with per-leg contribution breakdown |
| GET | `/api/nav/:bundleId/history` | Historical NAV snapshots for charts. `?since=ISO&limit=100` |
| POST | `/api/nav/:bundleId/check-resolutions` | Trigger resolution check. Auto-resolves bundle when all legs done |
| POST | `/api/nav/:bundleId/simulate-resolution` | Demo only: force-resolve a leg with `{ leg_id, outcome }` |

### Deposits and Portfolio

| Method | Path | Description |
|---|---|---|
| POST | `/api/deposit/prepare` | Build unsigned basket deposit transaction |
| POST | `/api/deposit/confirm` | Verify landed tx and persist basket deposit |
| POST | `/api/deposit/redeem/prepare` | Build unsigned basket redeem transaction |
| POST | `/api/deposit/redeem/confirm` | Verify landed tx and persist basket redeem |
| GET | `/api/deposit/portfolio/:wallet` | All positions for a wallet with current values and PnL |
| GET | `/api/deposit/transactions/:wallet` | Transaction history for a wallet |

### Tranche and PPN

| Method | Path | Description |
|---|---|---|
| GET | `/api/tranches` | List tranche quotes |
| GET | `/api/tranches/:bundleId` | Tranche quotes for one bundle |
| POST | `/api/ppn/tranche/sell/rfq` | Tranche sell RFQ per vault lot (`% of FV` + execution status) |
| POST | `/api/ppn/onchain/deposit/prepare` | Build unsigned PPN/tranche deposit transaction |
| POST | `/api/ppn/onchain/deposit/confirm` | Verify landed tx and persist PPN/tranche deposit |
| POST | `/api/ppn/onchain/redeem/prepare` | Build unsigned redeem transaction |
| POST | `/api/ppn/onchain/redeem/confirm` | Verify landed tx and persist redeem |

### Markets (Polymarket Proxy)

| Method | Path | Description |
|---|---|---|
| GET | `/api/markets` | List Polymarket markets. `?limit=20&active=true` |
| GET | `/api/markets/search/:query` | Search markets by text |
| GET | `/api/markets/:conditionId` | Single market by condition ID |

### Real-Time (Server-Sent Events)

| Method | Path | Description |
|---|---|---|
| GET | `/api/sse/nav/:bundleId` | Live NAV stream (updates every 30s, heartbeat every 15s) |
| GET | `/api/sse/portfolio/:wallet` | Live portfolio value stream (updates every 30s) |

### Leaderboard

| Method | Path | Description |
|---|---|---|
| GET | `/api/leaderboard` | Top wallets by total deposited. `?limit=10` |

### Admin

| Method | Path | Description |
|---|---|---|
| GET | `/api/admin/stats` | Platform stats: bundle counts, USDC flows, fee totals |
| POST | `/api/admin/bundles/:id/cancel` | Cancel an active bundle |
| GET | `/api/admin/transactions` | All transactions. `?wallet=...&type=deposit&limit=50` |

### Demo

| Method | Path | Description |
|---|---|---|
| POST | `/api/demo/simulate-lifecycle` | Full lifecycle in one call: pick bundle, deposit, get NAV, portfolio |
| GET | `/api/demo/status` | Check demo data availability |

## Architecture

```
src/
  index.ts              # Express app, middleware, route mounting
  config/index.ts       # Environment config
  types/
    index.ts            # Core TypeScript types (Bundle, Leg, Position, etc.)
    api.ts              # API request/response types (copy to frontend)
  db/
    supabase.ts         # Supabase client
    queries.ts          # All database operations
    schema.sql          # Supabase table definitions
  routes/
    bundles.ts          # Bundle CRUD + listing
    nav.ts              # Live NAV, history, resolution
    deposit.ts          # Deposits, redemptions, portfolio
    markets.ts          # Polymarket proxy
    sse.ts              # Server-Sent Events streams
    leaderboard.ts      # Wallet rankings
    admin.ts            # Platform stats + management
    demo.ts             # Hackathon demo helpers
    docs.ts             # Self-documenting API
  services/
    nav.ts              # NAV calculation (pure math)
    pricing.ts          # Live pricing (fetches Polymarket, updates DB)
    polymarket.ts       # Polymarket Gamma API client
    cron.ts             # Background jobs (price refresh every 2 min)
  middleware/
    errorHandler.ts     # Global error handler
    requestLogger.ts    # Request logging
  utils/
    validation.ts       # Zod schemas + validation middleware
  scripts/
    setup.ts            # Verify DB + API connectivity
    seed.ts             # Create demo bundles with live market data
```

## Key Concepts

**Bundle** - A structured product containing multiple prediction market legs. Named like `LK-90-0430` (prefix-riskTier-expiryMMDD). Each bundle has a risk tier (90/70/50) indicating the target probability threshold.

**Leg** - A single prediction market position within a bundle, linked to a Polymarket condition. Has a weight (sums to 1.0 across the bundle) and tracks live probability.

**NAV (Net Asset Value)** - The current price of one bundle token. Calculated as the weighted sum of leg probabilities (active legs) or resolution values (resolved legs). Ranges from 0 to 1.

**Issue Price** - The price at which new tokens are minted. Equal to the weighted average of leg probabilities at time of deposit, floored to the nearest cent (max 0.5 cent discount from fair value).

**Fees** - Computed per product path from protocol premium, MM premium, slippage, and liquidity/risk adjustments. See `app/app/tranche/_quote.ts` for tranche buy quote mechanics.

**Resolution** - When a leg's underlying market resolves (probability hits 0.99+ or 0.01-, or market closes), the leg is marked won (value=1.0) or lost (value=0.0). When all legs resolve, the bundle is marked resolved and tokens can be redeemed.

**Cron** - Every 2 minutes, a background job refreshes all active bundle probabilities from Polymarket, records NAV snapshots for historical charts, and checks for newly resolved legs.

## Shared Types for Frontend

The file `src/types/api.ts` contains all API request/response type definitions. It is self-contained with no backend imports. To use in the frontend:

1. Copy `src/types/api.ts` to your Next.js project (e.g. `src/types/api.ts`)
2. Import types and endpoint helpers:

```typescript
import { BundleResponse, NAVResponse, API_ENDPOINTS } from '@/types/api';

const res = await fetch(`${API_BASE}${API_ENDPOINTS.bundles.list}`);
const bundles: BundleResponse[] = await res.json();

const nav = await fetch(`${API_BASE}${API_ENDPOINTS.nav.live(bundleId)}`);
const navData: NAVResponse = await nav.json();
```

The file includes:
- Core domain types (Bundle, Leg, Position, Transaction)
- All request body types with validation constraints noted in comments
- All response types matching exact route handler output
- SSE event payload types
- `API_ENDPOINTS` const object with path builders for every route
- `APIError` type for error responses

## Development Commands

```bash
npm run dev        # Start with hot-reload (tsx watch)
npm run build      # Compile TypeScript to dist/
npm start          # Run compiled JS
npm run setup      # Verify Supabase + Polymarket connectivity
npm run seed       # Create demo bundles with live market data
npm run test:api   # API smoke tests
```

## Rate Limits

- General: 100 requests/minute per IP
- Market proxy (`/api/markets/*`): 30 requests/minute per IP

## Deployment (Railway)

The project includes `railway.json` and `Dockerfile` for Railway deployment.

```bash
# Railway will automatically:
# 1. Build from Dockerfile (node:20-alpine, npm ci, tsc)
# 2. Start with: node dist/index.js
# 3. Expose PORT (set in Railway env vars)
```

Set these environment variables in Railway:
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `PORT` (Railway sets this automatically)
- `FRONTEND_URL` (your deployed Next.js URL for CORS)

## Database Schema

Five tables in Supabase (see `src/db/schema.sql`):

- `bundles` - Structured products with risk tier, resolution date, status
- `legs` - Individual prediction market positions linked to bundles
- `positions` - User token holdings per bundle per wallet
- `transactions` - All deposits, redemptions, transfers with fee tracking
- `nav_snapshots` - Historical NAV values recorded every 2 minutes by cron

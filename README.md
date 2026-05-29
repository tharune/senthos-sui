# Senthos · SCBC Hackathon 2026 · Combined Repo

Structured-prediction-market protocol with four product primitives (Native Basket, Tranches, Principal Protected Notes, Lending/Repo) plus a custom hedge builder, all running on Solana devnet with live Polymarket data and an NLP-gated market filter.

## Start here
Read `ARCHITECTURE.md` first — it is the single onboarding document that covers the whole system (topology, every page, every endpoint, the math, and the recipe book for common changes).
Current tranche docs now include the live RFQ sell flow, `% of FV` quote display, and bounded quadratic liquidity scaling model.
Other docs, in reading order:
- `PRODUCTS.md` — taxonomy of the four primitives + roadmap
- `MARKET_FILTER.md` — the NLP + 5-stage filter pipeline
- `MODEL_INTEGRATION.md` — correlation model and audit
- `SESSION_NOTES.md` — chronological build log
- `CREDENTIALS.md` — env var inventory
- `ONCHAIN.md`, `ONCHAIN_DESIGN.md` — Anchor program details
- `AUDIT.md`, `SECURITY.md` — security posture

## 60-second quickstart (testnet, clone-and-go)
```bash
# 1. clone
git clone https://github.com/notveiker/SCBC-Hackathon-2026.git
cd SCBC-Hackathon-2026

# 2. env files — defaults already point at the shared testnet
cp .env.local.testnet.example .env.local
cp backend/.env.testnet.example backend/.env

# 3. install deps (root + backend)
npm install
(cd backend && npm install)

# 4. run — two terminals
(cd backend && npm run dev)          # terminal 1 → backend on :3001 (+ monitor :3002)
npm run dev                          # terminal 2 → frontend on :3000

# 5. open it
open http://localhost:3000           # landing
open http://localhost:3000/app       # authenticated app
```

In Phantom: **Settings → Developer Settings → Testnet Mode**. Then in the app,
connect your wallet, click **Request 1 SOL on testnet**, click **Get 100 mock
USDC**, and you can buy positions on any of the 11 baskets.

Full start/stop + verification commands are in `ARCHITECTURE.md` §4.

## Devnet quickstart (recommended — testnet RPC is heavily throttled)
Branch `deploy/devnet` ships a parallel devnet deployment. Programs,
mock USDC mint, and all 9 active bundle vaults are already on devnet — no
redeploy needed. Just switch the env and start the servers.
```bash
# From a fresh clone of deploy/devnet:
cp backend/.env.devnet.example backend/.env.devnet
cp .env.local.devnet.example .env.local.devnet
./SWITCH-CLUSTER.command devnet      # copies → backend/.env + .env.local, kills :3000/:3001
(cd backend && npm run dev)          # terminal 1
npm run dev                          # terminal 2
```
Phantom stays in Testnet Mode (the toggle enables both devnet + testnet).
Pick Devnet in the network selector if your wallet shows one. Airdrop
your Phantom some devnet SOL at https://faucet.solana.com. Then hit
**Get Mock USDC** in the app and you're live.

On-chain state (reuse — don't redeploy unless you know why):
- `traxis_vault`: `DyQDCYn82yGdJzmFaHE4sHruiS3QR9fWsf19bPbWpZvC`
- `traxis_ppn`: `8smi6Yvs2Q2MxA9dcbsLMUi6P94SVgHKXic5ZcNiiZEK`
- Mock USDC: `43kKa1CTQy8xU5uqEv2Kwx1gGqGc5nQFx7n5d8E5Fo1b`
- Fee recipient ATA: `Agf134nqwxfanp94pEoSeLyG1ZL97nUKiVyto3jfsiqf` (already created)

Latency on devnet is dramatically better: `/api/dev/balances` in ~30ms
(vs 8s + 429s on testnet).

### If buys land but STHS tokens don't show in the portfolio
The shared Supabase project has one `vault_pda` / `trax_mint` column per
bundle and no cluster dimension, so switching between testnet and devnet
with the same DB silently overwrites each cluster's cache with the other
cluster's PDAs. Backend tx-building derives PDAs fresh every time so on-
chain deposits always land correctly, but the frontend reads `trax_mint`
from `/api/bundles` to poll STHS balances — a stale mint means your
tokens exist on-chain but invisible in the UI.

One-shot fix any time this happens:
```bash
cd backend && npx tsx ../scripts/sync-vault-cache.ts
```
It clears the stale cache, re-derives PDAs from the currently active
program IDs, and writes the correct values back. Idempotent on on-chain
state — won't create duplicate vaults. Expect ~10 seconds runtime.

## Merge provenance
This folder merges **three branches** of [LuKresXD/SCBC-Hackathon-2026](https://github.com/LuKresXD/SCBC-Hackathon-2026) into a single working tree:

| Branch | Contribution |
|---|---|
| `main` (Senthos rebrand) | Next.js 16 frontend + Express/Supabase/Polymarket backend |
| `phase-15-devnet-deploy` | Solana Anchor on-chain programs (`traxis_vault`, `traxis_ppn`) + on-chain bridge in the backend |
| `ml-model` | Senthos correlation model audit artifacts, Monte-Carlo, walk-forward metrics |

## Layout
```
SCBC-Hackathon-2026-combined/
├── app/                             # Next.js 16 frontend (Senthos UI)
├── public/                          # Frontend static assets
├── backend/                         # Express API (Supabase, Polymarket, Solana bridge)
│   └── src/
│       ├── routes/                  # REST routes (bundles, nav, deposit, ppn, alerts…)
│       ├── services/                # cron, pricing, polymarket, solana, onchain-bridge
│       ├── solana/                  # Anchor provider, program handles, PDA derivation
│       └── idl/                     # traxis_vault.json, traxis_ppn.json (synced from anchor build)
├── programs/                        # Anchor programs (Rust)
│   ├── traxis_vault/                # Bundle vault (deposit/redeem/resolve/finalize)
│   ├── traxis_ppn/                  # Principal-protected notes + Meteora mock adapter
│   └── traxis_lending/              # Lending pool (supply, borrow, repay, withdraw)
├── scripts/                         # deploy-devnet.sh, init-demo-vaults.ts, sync-idl.sh…
├── migrations/                      # Anchor migration (deploy.ts)
├── tests/                           # Anchor integration tests (mocha/chai)
├── traxis-correlation-deliverables/ # ML model artifacts, reports, tarball
├── *.command                        # macOS double-click helpers for build/deploy
├── Anchor.toml / Cargo.toml / rust-toolchain.toml
├── ONCHAIN.md / ONCHAIN_DESIGN.md / STATE.md / SECURITY.md
└── package.json                     # Root = frontend (Next.js 16)
```

## Running locally

### 1. Frontend (Next.js 16 · Turbopack)
```bash
npm install           # already done
npm run dev           # http://localhost:3000
```

### 2. Backend (Express + tsx watch)
```bash
cd backend
npm install           # already done
cp .env.example .env  # already done with devnet defaults
npm run dev           # http://localhost:3001
```

The backend will run without real Supabase credentials  -  `config/index.ts` was softened to warn instead of exit. All list/portfolio endpoints will return empty arrays. To get real DB-backed behaviour, fill in `SUPABASE_URL` and `SUPABASE_ANON_KEY` in `backend/.env`.

### 3. On-chain (Anchor programs on Solana devnet)
The two programs are **already deployed on Solana devnet**:

| Program | Devnet Address |
|---|---|
| `traxis_vault` | `DY7NAimrQZY7SxveXTb38XN7H69wAXjZZj8DRHto4Aat` |
| `traxis_ppn`   | `3wDHsr9EnWkF968zYmSsj4hShNkAyFV6r7zxPrjqWNsp` |

To rebuild / redeploy you need the Solana toolchain (not installed on this host):
```bash
# Install prerequisites (only needed to rebuild programs)
sh -c "$(curl -sSfL https://release.anchor-lang.com/v0.30.1/install)"
sh -c "$(curl -sSfL https://release.solana.com/v1.18.26/install)"
rustup install 1.75.0

# Build + deploy
anchor build
bash scripts/deploy-devnet.sh
```

## Patches applied during the merge
1. `tsconfig.json`  -  target bumped to ES2020 and `programs/scripts/tests/migrations/traxis-correlation-deliverables/` added to `exclude` so Next.js 16 type check doesn't pull in the Anchor workspace.
2. `backend/src/index.ts`  -  removed `app.options('*', cors())` (Express 4.22 / path-to-regexp rejects the bare `*`) and migrated `express-rate-limit` options to v8 (`limit`, `standardHeaders: 'draft-7'`, explicit `validate`); added `DISABLE_RATE_LIMIT` env gate.
3. `backend/src/config/index.ts`  -  missing Supabase creds now warn instead of `process.exit(1)`.
4. `backend/src/middleware/requestLogger.ts`  -  added request-arrival log line.
5. `backend/.env`  -  populated with real devnet program IDs and `DISABLE_RATE_LIMIT=true`.

## Deep audit
See `AUDIT.md` in this folder for a full rundown of what works and what doesn't.

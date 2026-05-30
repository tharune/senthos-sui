# Senthos Sui Production Readiness Handoff

Last updated: May 30, 2026

## Current Status

This repository is a working Sui testnet port of the Senthos prediction-market
product surface. The app keeps the Senthos frontend flows intact while routing
local basket, tranche, PPN, and distribution-market actions through a deployed
Sui Move package and mock-USDC collateral.

The current build is suitable for hackathon demos and local testnet iteration.
It is not yet production-ready because transaction signing, indexing, settlement
policy, and product accounting still use a local backend harness instead of a
fully user-signed, indexed, auditable Sui production architecture.

## Published Repository

- GitHub: `https://github.com/tharune/senthos-sui`
- Published branch: `main`
- Current local branch used for publishing: `publish-sui`
- Collaborator invite: `notveiker` invited with write access

## Local Services

The local system is expected to run as:

- Frontend: `http://localhost:3000`
- Backend API: `http://localhost:3001`
- Backend monitor: `http://localhost:3002`
- Sui status endpoint: `http://localhost:3001/api/sui/status`

Key product pages:

- Portfolio: `http://localhost:3000/app/portfolio`
- Baskets: `http://localhost:3000/app/basket`
- Basket detail: `http://localhost:3000/app/basket/STHS-HIGH-SHORT`
- Tranches: `http://localhost:3000/app/tranche`
- Tranche detail: `http://localhost:3000/app/tranche/STHS-HIGH-SHORT`
- PPN: `http://localhost:3000/app/ppn`
- Distribution Markets: `http://localhost:3000/app/distribution`
- Docs: `http://localhost:3000/app/docs`

## Active Sui Testnet Deployment

Package:

- Package ID: `0xbb86d6dd74eaa2277f0aac7b2649e094ce4a92697baf3cf08e4fa5b842452cf8`
- Modules: `mock_usdc`, `prediction_market`
- Publish transaction: `89uojuuT4nCiewG2ezJhKtQihr4AMmfPMUkPxftVLEJN`
- Deployer: `0xee770af6c184b101aa91fab0fffdee62c1fecc86fd3e681d978336bf70eead79`
- UpgradeCap: `0x72915ed7c24053a81c9012289f4dfc4a04f5cdac555ce21487aeaf54457e5a40`

Mock USDC:

- Coin type: `0xbb86d6dd74eaa2277f0aac7b2649e094ce4a92697baf3cf08e4fa5b842452cf8::mock_usdc::MOCK_USDC`
- Symbol: `mUSDC`
- Decimals: `6`
- TreasuryCap: `0x5e50d50e6a82fd9583b87b31b5647cca49cc4d4aa580df7f8d12b56f4b63f90e`
- Metadata object: `0x55777a6792e90559480d91dfae8871c950f8ea3683a6ba3c051677b5819e5ecc`

Market admin:

- AdminCap: `0xbfebc54352926144ade0f20995b9c0e31e4689929d04b038e49ff0c544b981fa`

Configuration examples:

- Frontend example env: `sui.env.example`
- Backend example env: `backend/sui.env.example`

## What Works Now

On-chain and API:

- The Sui Move package builds and tests locally.
- `mock_usdc::MOCK_USDC` can be minted on testnet by the configured local
  TreasuryCap owner.
- `prediction_market` can create a market, buy YES/NO positions, resolve the
  market, and claim the winning side.
- Backend Sui routes under `/api/sui` wrap these Sui actions for local use.
- Distribution routes under `/api/distribution` normalize and quote submitted
  probability curves before opening Sui-backed local receipts.
- `/api/sui/status` reports active testnet config, package IDs, and balances.

Frontend:

- Sui mode is selected with `NEXT_PUBLIC_CHAIN=sui`.
- Header wallet display shows the configured Sui testnet dev address.
- Portfolio reads mock-USDC cash from the Sui status path.
- Basket buy creates a Sui testnet market, mints mock USDC, buys a Sui position,
  and stores local position metadata for UI continuity.
- Basket sell resolves and claims the Sui position and clears the local held
  balance.
- PPN open creates a Sui-backed local vault-style position and surfaces a Sui
  Explorer transaction.
- PPN close resolves and claims the backing position.
- Tranche buy creates a Sui-backed local position.
- Tranche sell uses the RFQ modal and executes the local Sui resolve/claim path.
- Distribution Markets has a working frontend tab, backend quote/open/settle
  routes, and Sui testnet-backed local receipts. The first implementation is a
  discrete bucketed probability curve inspired by Paradigm's December 2024
  distribution-market mechanism.

Verification already completed:

- Frontend production build passed with `npm run build`.
- Backend TypeScript build passed with `cd backend && npm run build`.
- Move tests passed with `sui move test --path senthos_sui_v2`.
- Browser checks passed for basket buy/redeem, PPN open/close, tranche
  buy/RFQ sell, and distribution quote/open on localhost.
- Backend API smoke tests produced fresh Sui testnet buy and claim digests.

## Current Architecture

The current Sui path is intentionally simple:

1. Frontend calls Senthos product actions.
2. Product clients branch on `NEXT_PUBLIC_CHAIN=sui`.
3. Sui-mode calls go to backend `/api/sui/*` endpoints.
4. Backend shells out to the Sui CLI using local Sui config.
5. Backend signs transactions with the configured local Sui dev account.
6. The Move package mints mock USDC, creates markets, opens position objects,
   resolves markets, and claims payouts.
7. Browser-local storage preserves Senthos position continuity for basket,
   tranche, and PPN UI flows.
8. Distribution Market positions are stored in backend memory for the local
   session and backed by Sui market/position object IDs.

This lets the full Senthos UI run against real Sui testnet transactions without
requiring a full production indexer or wallet-signed PTB flow yet.

## Production Gaps

### On-chain

The current Move package is a binary prediction-market primitive, not yet a
complete native Senthos structured-product protocol.

Needed:

- Replace local mock wrappers with production Move objects for Senthos products:
  basket vaults, tranche lots, PPN notes, distribution-market curves, fees,
  maturities, and settlement.
- Model basket vaults as shared objects with explicit lifecycle states:
  created, active, resolving, resolved, redeemed, cancelled.
- Add product-level accounting:
  deposits, withdrawals, fees, NAV snapshots, tranche notional, PPN principal
  allocation, distribution bucket/function exposure, yield sleeve state, and
  claimable payouts.
- Add permission boundaries:
  admin cap, upgrade cap custody, market creator roles, pause controls, fee
  recipient controls, and emergency resolution policy.
- Add events for every lifecycle transition:
  market created, vault opened, deposit, redeem, tranche buy, tranche sell,
  PPN open, PPN close, distribution curve opened, distribution curve settled,
  resolve, claim, fee withdrawal, and admin changes.
- Decide how DeepBook Predict is integrated:
  direct DeepBook Predict positions, or Senthos wrapper positions that settle
  from DeepBook Predict state.
- Replace the demo `resolve_yes` harness with real oracle/settlement authority
  tied to the chosen prediction-market source.
- Add invariant-focused Move tests:
  no double claim, no over-redemption, no fee overflow, no losing-side payout,
  correct pro-rata distribution, correct tranche waterfall, PPN principal
  preservation, distribution curve normalization, and payout solvency.
- Add negative tests for unauthorized resolution, invalid cap use, expired
  markets, zero deposits, stale settlement, and mismatched position ownership.
- Prepare upgrade strategy:
  audited upgrade policy, multisig custody, published package versioning, and
  clear migration plan from testnet to mainnet.

### Backend

The current backend is a local CLI-backed harness. Production needs a real Sui
service layer.

Needed:

- Replace `execFile("sui", ...)` calls with Sui TypeScript SDK transaction
  builders.
- Stop backend signing user actions. Build PTBs for the frontend wallet to sign.
- Keep backend signing only for explicitly server-owned roles such as admin,
  controlled faucet, indexer maintenance, or oracle actions.
- Add a Sui event/object indexer:
  subscribe to package events, persist objects, track ownership, and hydrate
  user portfolios from chain state rather than browser-local storage.
- Add persistent database tables for Sui:
  packages, markets, vaults, positions, transactions, claims, tranche lots,
  PPN notes, distribution curves, account balances, event cursor, and indexed
  checkpoints.
- Add checkpoint cursoring and idempotent replay so the indexer can recover
  after crashes.
- Add transaction status endpoints keyed by Sui digest.
- Add typed API contracts for Sui PTB preparation and transaction confirmation.
- Add request validation for all `/api/sui/*` routes.
- Add structured logging, metrics, and alerting for Sui RPC errors, failed PTBs,
  stale indexer cursors, and settlement failures.
- Add rate limits and abuse controls around any testnet faucet or admin action.
- Remove remaining legacy fallback env assumptions from production configs.
- Update the monitor to show Sui RPC, package object state, event lag, and
  indexed checkpoint freshness.
- Add integration tests that run against a local Sui test validator or a
  dedicated testnet namespace.

### Frontend

The current frontend preserves Senthos UX, but Sui mode still uses a dev account
display and local metadata bridge.

Needed:

- Add real Sui wallet support:
  Sui Wallet, Suiet, Ethos, Martian-compatible adapters if needed, account
  connect/disconnect, network validation, and transaction signing.
- Replace local dev account display with the connected Sui wallet address.
- Replace browser-local virtual positions with indexed positions from backend
  Sui state.
- Replace backend-signed product actions with wallet-signed PTBs:
  basket buy/sell, tranche buy/sell, PPN open/close, distribution open/settle,
  claim, and redeem.
- Add transaction review states:
  preparing, wallet approval, submitted, confirmed, indexed, failed, retry.
- Add Sui Explorer links for every digest and object.
- Add user-facing error copy for wallet rejection, wrong network, insufficient
  SUI gas, insufficient mock/real USDC, stale quote, and settlement failure.
- Make all product pages read their on-chain/indexed state from backend rather
  than local demo state.
- Replace Sui local fallback data with explicit loading/empty/error states once
  the indexer is live.
- Add production-ready docs pages for:
  architecture, contracts, risks, distribution-market mechanics, fees,
  settlement policy, testnet/mainnet status, and wallet setup.
- Add end-to-end browser tests for every critical path.

### Data, pricing, and risk

Senthos depends on curated market data and product pricing, so production needs
clear source-of-truth boundaries.

Needed:

- Define canonical source for prediction-market odds:
  Polymarket, DeepBook Predict, Senthos wrapper markets, or hybrid.
- Define oracle/settlement source and dispute/fallback process.
- Version every basket composition and keep immutable records of leg weights.
- Persist NAV snapshots and quote inputs used at trade time.
- Make tranche pricing deterministic and auditable.
- Make PPN principal protection math explicit and covered by tests.
- Decide whether yield routing is simulated, Sui-native, or integrated with a
  specific Sui lending venue.
- Add slippage, fee, and risk limits that are enforced on-chain or verified
  before signing.

### Security

Needed before production:

- Complete Move security review.
- Complete backend API security review.
- Remove all server-side user signing paths.
- Put admin and upgrade capabilities behind multisig custody.
- Add pause/emergency controls and document who can use them.
- Add RPC failover and chain reorg/checkpoint handling.
- Add secret scanning to CI.
- Add dependency audit and lockfile review.
- Add rate limits for all mutating endpoints.
- Add input validation and object ownership checks for every route.
- Add monitoring for abnormal minting, unusually large positions, repeated
  failed claims, and indexer lag.

## Suggested Production Milestones

### Milestone 1: Sui SDK transaction builder

Goal: remove CLI dependency from the backend.

Deliverables:

- Sui SDK client module.
- PTB builders for mint, create market, buy, resolve, and claim.
- Backend tests for PTB construction.
- API routes return unsigned transaction bytes where user signing is required.

### Milestone 2: Real Sui wallet signing

Goal: users sign their own transactions from the frontend.

Deliverables:

- Sui wallet adapter integration.
- Connected address replaces dev account.
- Basket buy/redeem works from connected wallet.
- Transaction lifecycle UI handles approval, rejection, digest, confirmation,
  and indexer wait.

### Milestone 3: Event indexer

Goal: remove browser-local position state.

Deliverables:

- Sui event cursor.
- Database schema for package events and product objects.
- Portfolio API hydrates from indexed chain state.
- Frontend portfolio, basket, tranche, and PPN pages read indexed positions.

### Milestone 4: Native Senthos product contracts

Goal: move beyond one generic binary market.

Deliverables:

- Basket vault Move module.
- Tranche Move module with waterfall accounting.
- PPN Move module with principal and upside split.
- Lifecycle events and invariant tests.
- Testnet redeploy and migration notes.

### Milestone 5: Settlement and DeepBook Predict integration

Goal: connect Senthos products to the hackathon track objective.

Deliverables:

- Chosen DeepBook Predict integration design.
- Market creation and settlement path.
- Oracle/admin permission model.
- End-to-end demo from market source to Senthos product payout.

### Milestone 6: Production hardening

Goal: make the system safe enough for a real launch candidate.

Deliverables:

- Security review complete.
- Monitoring and alerting live.
- CI build/test/e2e pipeline.
- Deployment docs.
- Mainnet readiness checklist.

## Immediate Next Steps

1. Replace backend Sui CLI calls with Sui SDK transaction builders.
2. Add Sui wallet connect/signing on the frontend.
3. Build a minimal Sui indexer for `prediction_market` events.
4. Replace browser-local virtual positions with indexed Sui positions.
5. Design the native basket, tranche, and PPN Move modules.
6. Decide the DeepBook Predict integration shape.
7. Add CI checks for frontend build, backend build, Move tests, and secret scan.
8. Update the monitor to report Sui package health and indexer lag.

## Known Demo Limitations

- Backend currently signs Sui transactions with a local dev key.
- Mock USDC is testnet-only and controlled by the local TreasuryCap owner.
- Basket, tranche, and PPN flows use local wrappers around a generic Sui
  prediction-market primitive.
- Portfolio continuity uses browser-local metadata until an indexer exists.
- Redundant Traxis/Solana docs, Anchor program source, command helpers, and
  correlation deliverables have been pruned from the published branch. A few
  legacy fallback modules remain where the current app still imports them.
- The monitor should be replaced with Sui-native health metrics before
  production.

## Definition Of Production Ready

Senthos-on-Sui should be considered production-ready only when:

- Users sign all user-owned actions in a Sui wallet.
- User portfolios hydrate from indexed Sui state, not local browser storage.
- Product accounting lives in audited Move contracts.
- Settlement rules are explicit, tested, and permissioned.
- Backend APIs are typed, validated, monitored, and idempotent.
- CI verifies frontend, backend, Move, e2e, lint, and secret scans.
- Admin and upgrade capabilities are held through secure operational custody.
- The team can reproduce deploy, index, trade, settle, and recover from a clean
  environment without hidden local state.

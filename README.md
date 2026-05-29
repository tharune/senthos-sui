# Senthos Sui

Senthos is a structured prediction-market interface running locally against a
Sui testnet Move package. The current build preserves the Senthos product
surface - baskets, tranches, principal-protected notes, portfolio views, and
docs - while routing local testnet actions through Sui mock USDC and a Sui
binary prediction-market module.

This repository is the Sui-focused hackathon branch. Legacy Traxis/Solana
handoff docs, Anchor programs, local command scripts, and correlation tarball
artifacts have been removed from the published tree so the repo reflects the
active Sui deployment.

## What Works

- Sui testnet Move package deployed with:
  - `mock_usdc::MOCK_USDC`
  - `prediction_market`
- Backend Sui API routes under `/api/sui`.
- Frontend Sui mode via `NEXT_PUBLIC_CHAIN=sui`.
- Portfolio reads the configured Sui testnet mock-USDC balance.
- Basket buy creates a Sui market, mints mock USDC, buys a Sui position object,
  and links to Sui Explorer.
- Basket sell resolves and claims the Sui position and clears local holdings.
- PPN open/close exercises the Sui-backed local position path.
- Tranche buy/RFQ sell exercises the Sui-backed local position path.
- Frontend build, backend build, and Move tests pass locally.

## Important Caveat

This is a working local Sui testnet harness, not a production custody model.
The backend currently signs Sui transactions with a configured local dev key.
Production must replace that with Sui wallet-signed programmable transaction
blocks, a real indexer, and audited product-level Move contracts. See
`detailed.md` for the production-readiness roadmap.

## Active Sui Testnet Deployment

Package:

- Package ID: `0xbb86d6dd74eaa2277f0aac7b2649e094ce4a92697baf3cf08e4fa5b842452cf8`
- Modules: `mock_usdc`, `prediction_market`
- Publish transaction: `89uojuuT4nCiewG2ezJhKtQihr4AMmfPMUkPxftVLEJN`
- Deployer: `0xee770af6c184b101aa91fab0fffdee62c1fecc86fd3e681d978336bf70eead79`

Mock USDC:

- Coin type: `0xbb86d6dd74eaa2277f0aac7b2649e094ce4a92697baf3cf08e4fa5b842452cf8::mock_usdc::MOCK_USDC`
- Decimals: `6`
- TreasuryCap: `0x5e50d50e6a82fd9583b87b31b5647cca49cc4d4aa580df7f8d12b56f4b63f90e`
- Metadata object: `0x55777a6792e90559480d91dfae8871c950f8ea3683a6ba3c051677b5819e5ecc`

Prediction market admin:

- AdminCap: `0xbfebc54352926144ade0f20995b9c0e31e4689929d04b038e49ff0c544b981fa`

## Repository Layout

```text
app/                    Next.js frontend
backend/                Express API and Sui local harness
senthos_sui_v2/         Sui Move package
public/                 Product assets
detailed.md             Production readiness roadmap
SUI_PARITY_PLAN.md      Current Sui parity status
sui.env.example         Frontend Sui env example
backend/sui.env.example Backend Sui env example
```

Some legacy Solana runtime modules still exist under `backend/src` and `app/app`
because the original product code imports them for fallback paths. They are no
longer presented as the deployment target. The active local mode is Sui.

## Quickstart

Prerequisites:

- Node.js 20+
- npm
- Sui CLI configured for testnet
- A Sui testnet account that owns the deployed package caps if you want to mint
  the existing mock USDC

Install dependencies:

```bash
npm install
(cd backend && npm install)
```

Configure env:

```bash
cp sui.env.example .env.local
cp backend/sui.env.example backend/.env
```

Then edit `backend/.env` if your local Sui keystore path differs:

```text
SUI_KEYSTORE_PATH=/path/to/.sui/sui_config
SUI_ACTIVE_ADDRESS=0xee770af6c184b101aa91fab0fffdee62c1fecc86fd3e681d978336bf70eead79
```

Run the backend:

```bash
cd backend
npm run dev
```

Run the frontend in another terminal:

```bash
npm run dev
```

Open:

- Frontend: `http://localhost:3000`
- Portfolio: `http://localhost:3000/app/portfolio`
- Baskets: `http://localhost:3000/app/basket`
- Tranches: `http://localhost:3000/app/tranche`
- PPN: `http://localhost:3000/app/ppn`
- Backend status: `http://localhost:3001/api/sui/status`
- Monitor: `http://localhost:3002`

## Verification

Frontend build:

```bash
npm run build
```

Backend build:

```bash
cd backend
npm run build
```

Move tests:

```bash
sui move test --path senthos_sui_v2
```

Backend Sui status:

```bash
curl http://localhost:3001/api/sui/status
```

## Sui API Surface

Main local Sui routes:

- `GET /api/sui/status`
- `POST /api/sui/mock-usdc/mint`
- `POST /api/sui/markets`
- `POST /api/sui/markets/:marketId/buy`
- `POST /api/sui/markets/:marketId/resolve`
- `POST /api/sui/markets/:marketId/claim`
- `POST /api/sui/local/basket/deposit`
- `POST /api/sui/local/basket/redeem`

The `/api/sui/local/basket/*` routes are the current local bridge used by
basket, tranche, and PPN UI flows.

## Documentation

- `detailed.md` - where the project stands and what is needed for production.
- `SUI_PARITY_PLAN.md` - current parity status and local architecture.
- `senthos_sui_v2/DEPLOYMENT.md` - deployed Sui package/object IDs.
- `backend/README.md` - backend-specific Sui setup.

## Production Roadmap

The short version:

1. Replace backend CLI signing with Sui SDK transaction builders.
2. Add real Sui wallet connect/signing in the frontend.
3. Build a Sui event/object indexer.
4. Replace browser-local virtual positions with indexed chain state.
5. Move basket, tranche, and PPN accounting into native audited Move modules.
6. Integrate DeepBook Predict or an explicit settlement source.
7. Add CI for frontend, backend, Move tests, browser e2e, and secret scanning.

Full roadmap: `detailed.md`.

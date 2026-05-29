# Senthos Backend

Express + TypeScript backend for the Senthos Sui local testnet harness.

The active Sui path is exposed under `/api/sui`. It wraps the deployed
`senthos_sui_v2` Move package, mock USDC, and local prediction-market actions
used by the frontend demo.

## Quickstart

```bash
npm install
cp sui.env.example .env
npm run dev
```

Backend:

- API: `http://localhost:3001`
- Monitor: `http://localhost:3002`
- Sui status: `http://localhost:3001/api/sui/status`

## Environment

Use `backend/sui.env.example` as the source of truth for local Sui mode.

Important values:

- `SUI_NETWORK=testnet`
- `SUI_RPC_URL=https://fullnode.testnet.sui.io:443`
- `SUI_CLI=sui`
- `SUI_KEYSTORE_PATH=/path/to/.sui/sui_config`
- `SUI_ACTIVE_ADDRESS=<local testnet address>`
- `SUI_PACKAGE_ID=0xbb86d6dd74eaa2277f0aac7b2649e094ce4a92697baf3cf08e4fa5b842452cf8`
- `SUI_MARKET_ADMIN_CAP_ID=0xbfebc54352926144ade0f20995b9c0e31e4689929d04b038e49ff0c544b981fa`
- `MOCK_USDC_TREASURY_CAP_ID=0x5e50d50e6a82fd9583b87b31b5647cca49cc4d4aa580df7f8d12b56f4b63f90e`

Supabase can be left unset for local Sui mode. The health endpoint reports
Supabase as `not_configured` while keeping the overall status `ok`.

## Sui Routes

- `GET /api/sui/status`
- `POST /api/sui/mock-usdc/mint`
- `POST /api/sui/markets`
- `POST /api/sui/markets/:marketId/buy`
- `POST /api/sui/markets/:marketId/resolve`
- `POST /api/sui/markets/:marketId/claim`
- `POST /api/sui/local/basket/deposit`
- `POST /api/sui/local/basket/redeem`

The `local/basket` routes are also used by current PPN and tranche UI flows.

## Build

```bash
npm run build
```

## Production Notes

This backend currently shells out to the Sui CLI and signs local testnet actions
with the configured Sui dev key. Production should replace that with:

- Sui TypeScript SDK transaction builders.
- Wallet-signed programmable transaction blocks for user actions.
- A Sui event/object indexer.
- Persistent portfolio state from indexed chain objects.
- Sui-native monitor metrics for package health and indexer lag.

See the root `detailed.md` for the full production-readiness plan.

# Senthos Sui v2 Testnet Deployment

This is the active Sui deployment for local Senthos-on-Sui work. It includes a
testnet-only Mock USDC coin and a USDC-collateral binary prediction market.

## Package

- Package ID: `0xbb86d6dd74eaa2277f0aac7b2649e094ce4a92697baf3cf08e4fa5b842452cf8`
- Modules: `mock_usdc`, `prediction_market`
- Publish transaction: `89uojuuT4nCiewG2ezJhKtQihr4AMmfPMUkPxftVLEJN`
- Deployer: `0xee770af6c184b101aa91fab0fffdee62c1fecc86fd3e681d978336bf70eead79`
- UpgradeCap: `0x72915ed7c24053a81c9012289f4dfc4a04f5cdac555ce21487aeaf54457e5a40`

## Mock USDC

- Coin type: `0xbb86d6dd74eaa2277f0aac7b2649e094ce4a92697baf3cf08e4fa5b842452cf8::mock_usdc::MOCK_USDC`
- Symbol: `mUSDC`
- Decimals: `6`
- Metadata object: `0x55777a6792e90559480d91dfae8871c950f8ea3683a6ba3c051677b5819e5ecc`
- TreasuryCap: `0x5e50d50e6a82fd9583b87b31b5647cca49cc4d4aa580df7f8d12b56f4b63f90e`
- Initial mint transaction: `B38qBe1fwowkfB9CL72wLjVUkBp34wuywvB8nnbsD7KE`
- Initial minted coin: `0x27e4ede71432940956a17d421e26591a4b4ce0dcd4b58bbb1f2dd2a8bcf66a50`

Mint authority is the owner of the TreasuryCap above. Local credentials are
referenced in `backend/.env.sui.local` via `SUI_KEYSTORE_PATH` and
`SUI_ACTIVE_ADDRESS`.

## Backend Smoke Test

Executed through `http://localhost:3001/api/sui/*`, not directly through the CLI.

- Market: `0x75e98a2fdb76d68b1b047c866d634a8f5e13a67f2c80b7d5ad4601b50f8e5ef2`
- YES position: `0x76f846b377d29f90c188a9d178bd7a1b3633d6bfb1267ab68539fa6b724e4d16`
- NO position: `0x3afbbcdcad9423cec75a06b8066fa91978bac86dd5781d248d39b2127287ac81`
- Resolve YES transaction: `FEFuepR2R85njgVv1yGo85LLuTZ5eTCeWEdtvPyU3ZU1`
- Claim YES transaction: `CtjF5qtQHqjd6iMzTwW4ehGAdVJmew6S242uErekpxDg`

The winning YES claim paid `30_000_000` raw mUSDC on a `10_000_000` raw mUSDC
stake against a `20_000_000` raw mUSDC losing pool.

# Senthos Onchain

Structured prediction-market products on Solana.

This doc is for judges and teammates who want to understand, verify, or extend the onchain layer. The full spec is in `ONCHAIN_DESIGN.md`. This is the operator's view.

## TL;DR

Two Anchor programs — `traxis_vault` (tranched TRAX tokens) and `traxis_ppn` (Meteora-backed principal protected notes) — deployed on Solana devnet. Non-custodial atomic deposits. Admin-triggered leg resolution via Helius webhooks + pricing cron. Finalization auto-fires when the last leg resolves. Full lifecycle runs end-to-end with `scripts/demo-full-lifecycle.ts`.

## Architecture

```
 ┌─────────────┐          user signs tx in Phantom
 │  Frontend   │◄─────────────────────────────────────────┐
 │  (Next.js)  │                                          │
 └──────┬──────┘                                          │
        │ GET/POST /api/...                               │
        ▼                                                 │
 ┌─────────────┐         builds versioned tx              │
 │   Backend   │─────────────────────────────────────────►│
 │ (Express)   │                                          │
 └──────┬──────┘                                          │
        │                                                 │
        │  signs resolve_leg / finalize_vault             │
        │  with server authority keypair                  │
        ▼                                                 │
 ┌──────────────────────────────────────────────────┐     │
 │                     Solana                       │     │
 │                                                  │     │
 │   traxis_vault      traxis_ppn       token       │     │
 │       │ CPI             │ CPI         │          │     │
 │       └───────┬─────────┘             │          │     │
 │               ▼                       │          │     │
 │        mint_to / transfer             │          │     │
 │        USDC + TRAX SPL tokens ◄───────┘          │     │
 └──────────────────────────────────────────────────┘     │
                                                          │
 ┌─────────────┐                                          │
 │   Helius    │──── webhook on market resolution ────────┘
 │   (devnet)  │
 └─────────────┘
```

## Programs

| Program        | Source                              | Devnet ID (written by deploy script)             |
|----------------|-------------------------------------|--------------------------------------------------|
| `traxis_vault` | `programs/traxis_vault/src/`        | `TRAXVau1tProgram11111111111111111111111111` (placeholder until first deploy) |
| `traxis_ppn`   | `programs/traxis_ppn/src/`          | `TRAXPPNpRogramm1111111111111111111111111111` (placeholder) |

Real IDs land in `target/deploy/*-keypair.json` the first time you run `scripts/deploy-devnet.sh`.

## File layout

```
programs/
  traxis_vault/
    src/
      lib.rs                    program entrypoint
      state.rs                  Vault + Leg account structs
      errors.rs
      events.rs
      instructions/
        initialize_vault.rs     admin creates vault + TRAX mint + USDC ATA
        deposit.rs              user USDC → TRAX atomic (+ fee routing)
        resolve_leg.rs          authority flips leg outcome
        finalize_vault.rs       lock final payout ratio
        redeem.rs               user burns TRAX → USDC pro-rata
        admin_withdraw_fees.rs  drain residual USDC to treasury
  traxis_ppn/
    src/
      lib.rs
      state.rs                  PpnNote + MeteoraMockAdapter
      errors.rs
      events.rs
      instructions/
        initialize_mock_adapter.rs
        initialize_note.rs      user deposit → principal into Meteora
        harvest_yield.rs        crank yield → CPI traxis_vault::deposit
        redeem_at_maturity.rs   return principal + accumulated TRAX

tests/
  helpers.ts                    shared test utilities (PDA derivation etc.)
  traxis_vault.test.ts          full lifecycle Anchor tests
  traxis_ppn.test.ts            PPN lifecycle tests

scripts/
  deploy-devnet.sh              build + deploy + sync IDL
  sync-idl.sh                   target/idl → backend/src/idl
  init-demo-vaults.ts           bootstrap onchain vaults from Supabase bundles
  init-meteora-mock.ts          one-time mock Meteora adapter init
  demo-full-lifecycle.ts        end-to-end devnet smoke test

backend/src/
  solana/
    anchor.ts                   program handles, env config, PDA derivation
    client.ts                   tx builders + authority-signed calls
  services/
    solana.ts                   thin adapter exposing the public API
    onchain-bridge.ts           DB ↔ chain mirroring (resolve, finalize, init)
  idl/                          anchor-generated JSON IDLs
    traxis_vault.json
    traxis_ppn.json
  db/schema_onchain.sql         additive migration adding onchain columns
```

## Setup (first time)

```bash
# 1. Install toolchains
sh -c "$(curl -sSfL https://release.solana.com/v1.18.26/install)"
cargo install --git https://github.com/coral-xyz/anchor avm --force
avm install 0.30.1 && avm use 0.30.1

# 2. Create / fund devnet wallet
solana-keygen new      # saves to ~/.config/solana/id.json
solana config set --url https://api.devnet.solana.com
solana airdrop 2

# 3. Apply onchain-additive DB migration (Supabase SQL editor)
#    Paste contents of backend/src/db/schema_onchain.sql and run.

# 4. Install JS deps
npm install                               # root (tests, scripts, anchor CLI glue)
cd backend && npm install && cd ..

# 5. Deploy to devnet
bash scripts/deploy-devnet.sh             # prints program IDs
# Copy the suggested env block into backend/.env

# 6. Initialize the mock Meteora adapter
npx tsx scripts/init-meteora-mock.ts

# 7. Seed bundles + legs into Supabase
cd backend && npm run seed && cd ..

# 8. Create onchain vaults for every active bundle
npx tsx scripts/init-demo-vaults.ts

# 9. Run the end-to-end smoke test
npx tsx scripts/demo-full-lifecycle.ts

# 10. Start the backend
cd backend && npm run dev
```

## API endpoints touched or added

### New onchain admin (`/api/admin`)

| Method | Path | What |
|---|---|---|
| POST | `/api/admin/bundles/:id/init-onchain` | Create onchain vault for a DB bundle |
| POST | `/api/admin/bundles/:id/resolve-leg` | Force-resolve a leg onchain (body: `{leg_id, outcome}`) |
| POST | `/api/admin/bundles/:id/finalize` | Trigger finalize_vault if all legs resolved |
| POST | `/api/admin/bundles/:id/withdraw-fees` | Drain residual USDC |
| GET | `/api/admin/bundles/:id/onchain` | Read onchain vault state |

### Migrated deposit flow (`/api/deposit`)

| Method | Path | What |
|---|---|---|
| POST | `/api/deposit/prepare` | Build deposit tx, return base64 for Phantom |
| POST | `/api/deposit/confirm` | Record DB row after user's tx confirms |
| POST | `/api/deposit/redeem/prepare` | Build redeem tx |
| POST | `/api/deposit/redeem/confirm` | Record redemption in DB |

`POST /api/deposit` and `POST /api/deposit/redeem` (legacy routes) now alias `prepare`.

### Helius webhook (`/api/webhook/helius`)

Real handler now: parses Helius enhanced tx events, matches `market_id` against Supabase legs, mirrors resolution on-chain, finalizes when complete. Helius setup:

1. Dashboard → Webhooks → Add.
2. Transaction type: `Any` (scoped by address).
3. Account addresses: include Polymarket-conditional-token addresses or DFlow-tokenized Kalshi position addresses (whichever is in scope for your legs).
4. Webhook URL: `https://<your-railway-app>.up.railway.app/api/webhook/helius`.

## Security model

- **Authority.** A single keypair signs `initialize_vault`, `resolve_leg`, `finalize_vault`, `admin_withdraw_fees`. For the hackathon this is the deployer keypair; for production it should be a Squads multisig.
- **No custody.** The protocol never holds user USDC outside the vault PDA. All deposits and redemptions are signed by the end user.
- **Overflow safety.** All arithmetic uses `checked_*` and returns `ArithOverflow` on failure. Integer-overflow checks are also enabled in release builds (`overflow-checks = true` in `Cargo.toml`).
- **Solvency.** `finalize_vault` refuses to lock a payout ratio if the vault's USDC balance is insufficient to pay all holders.
- **Idempotency.** `resolve_leg` with the same outcome as a prior call is a no-op. Webhook retries are safe.
- **State machine.** `deposit` requires `Active`. `redeem` requires `Finalized`. `finalize_vault` requires every leg `Won | Lost`.

## What's intentionally mocked

- **Meteora yield.** `traxis_ppn` uses a local `MeteoraMockAdapter` that accrues a constant APY against elapsed time. The program's yield-harvest instruction is shaped to match a real Meteora CPI so swapping in real Meteora is mechanical (one file, `harvest_yield.rs`, accounts list changes).
- **Real DFlow CPIs.** The hackathon vault holds USDC directly. In production, `deposit` would CPI into DFlow to buy tokenized Kalshi legs with the user's USDC. The payout computation in `finalize_vault` is already shaped to work with either design because it computes payout from `won_weight_bps`, not vault balance.

## Testing

```bash
# Full Anchor test suite (localnet)
anchor test

# Specific test file
npx ts-mocha -p tsconfig.json -t 1000000 tests/traxis_vault.test.ts

# Live devnet smoke test
npx tsx scripts/demo-full-lifecycle.ts
```

## Explorer links (after deploy)

Replace `<VAULT_ID>` / `<PPN_ID>` with what `scripts/deploy-devnet.sh` prints.

- Vault program: `https://explorer.solana.com/address/<VAULT_ID>?cluster=devnet`
- PPN program: `https://explorer.solana.com/address/<PPN_ID>?cluster=devnet`
- Live demo wallet (after running demo): printed by the smoke test.

## FAQ

**Why fixed `[Leg; 16]` instead of a dynamic Vec?** Deterministic account size. Avoids realloc edge cases during the hackathon. 16 is well above the product-doc "at least 10."

**Why derive TRAX mints at PDA addresses?** So the backend can compute the mint address from the bundle UUID alone, without an RPC round-trip. Same for vault + USDC vault.

**Why is `resolve_leg` idempotent?** Helius retries webhooks. Doing otherwise would break the live demo.

**What if a user sends USDC to the vault PDA directly without going through `deposit`?** It sits there until `admin_withdraw_fees` is called. Not ideal but non-harmful.

**Why is PPN harvesting permissionless?** So anyone can crank yield accrual — a classic Solana cranker pattern. The cranker pays the tx fee and gets the TRAX deposited into the note's ATA, not their own; no rent-seeking opportunity.

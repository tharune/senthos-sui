# Teammate Setup

This branch (`integration/full-wiring`) can be run end-to-end on devnet by any teammate. Here's how.

## What you'll need on your machine

- **macOS** (the `.command` scripts are Terminal scripts — on Linux/Windows, run the bash commands manually)
- **Node 20+** (`node --version`) — `brew install node` or use `nvm`
- **Rust + Anchor 0.30.1** (only if you want to rebuild the programs) — not required for backend/frontend testing
- **Solana CLI 2.x** (`solana --version`) — `sh -c "$(curl -sSfL https://release.solana.com/stable/install)"`
- A GitHub account with access to the repo

## Step 1 — Clone + checkout the integration branch

```bash
git clone https://github.com/LuKresXD/SCBC-Hackathon-2026.git
cd SCBC-Hackathon-2026
git checkout integration/full-wiring
```

## Step 2 — Run the onboarding script

From the repo root, double-click `00-onboard.command` in Finder (or run it from Terminal):

```bash
./00-onboard.command
```

This will:
1. Generate a fresh devnet Solana keypair at `~/.config/solana/dev-authority.json` (if one doesn't exist)
2. Airdrop 2 SOL on devnet
3. Print your authority address — you'll need it for the next step
4. Create `backend/.env` from `.env.example` and pre-fill everything except secrets
5. Print the list of things you still need

## Step 3 — Get devnet USDC

The test deposits real devnet USDC to prove on-chain movement. Fund your authority:

1. Open https://faucet.circle.com
2. Network: **Solana Devnet**
3. Paste the authority address `00-onboard.command` printed for you
4. Request 10 USDC

## Step 4 — Get the shared secrets from Victor

Ask Victor (via Signal / 1Password / whatever secure channel you use — **not Slack/Discord/email**) for:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY` (this is the Supabase service-role key; protect it)
- `HELIUS_API_KEY` (optional — only needed if you want webhook integration)

Paste those into `backend/.env`. The onboarding script has already written the public values (program IDs, USDC mint, RPC URL).

## Step 5 — Install backend deps

```bash
cd backend
npm install
```

## Step 6 — Verify

Run the real-USDC test to confirm on-chain movement works from your machine:

```bash
./38-real-usdc-test.command
```

You should see:
- A transaction signature + Solscan URL
- "Balances prove exactly 1 USDC moved authority → adapter pool"
- PpnNote account state = active

If you see "AUTHORITY HAS NO USDC", go back to step 3 and fund the authority.

## Step 7 — Run backend + frontend

Backend:
```bash
cd backend
npm run dev
# should boot on :3001
```

Frontend:
```bash
cd frontend
npm install
npm run dev
# boots on :3000
```

## What the tranche routes need

The tranche endpoints (`POST /api/tranches/prepare|confirm`, `GET /api/tranches/user/:wallet`) depend on a schema migration that may not yet be applied to Supabase.

If you get a 500 on those endpoints, Victor needs to run `backend/src/db/schema_tranche.sql` in the Supabase SQL editor. It's additive-only (no destructive changes).

## Things to NOT share

- `backend/.env` — contains secrets, already in `.gitignore`
- `~/.config/solana/dev-authority.json` — your local keypair. If it gets compromised, just generate a new one; these are devnet-only and have no real-money value.
- `backend/test-onchain-keypair.json` — older test keypair; same story, devnet-only.

## One-time Supabase schema

If you're the first person on your machine to hit the tranches endpoints and get 500s, paste the contents of `backend/src/db/schema_tranche.sql` into the Supabase SQL editor and run once. The migration only adds columns to existing tables.

## Troubleshooting

**`solana airdrop` fails with "429 Too Many Requests"** — the public devnet faucet rate-limits. Try https://faucet.solana.com or wait a few minutes.

**Backend says "missing AUTHORITY_KEYPAIR"** — the onboarding script should have set `AUTHORITY_KEYPAIR=~/.config/solana/dev-authority.json` in `backend/.env`. Check that line exists.

**`sendRawTransaction` fails with blockhash errors** — you might have stale blockhashes from rate-limited RPC. Swap `SOLANA_RPC_URL` to a Helius or QuickNode devnet URL.

**Tranche endpoints 500** — schema not migrated. See section above.

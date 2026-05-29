# Credentials & Secrets Inventory  -  Senthos

Everything in this file is an input you need to provide to take the project from the current "runs locally with mocks + live devnet reads" state to a fully production-capable deployment.

Credentials are grouped by the component that consumes them. Copy paste the templated `.env` snippets into the indicated file after filling in real values.

Legend:
- 🔴 **Required** to unlock the component at all
- 🟡 **Recommended** for production (defaults work, but are rate-limited or insecure)
- 🟢 **Optional**  -  only needed for specific features

---

## 1. Backend API (`backend/.env`)

### 1.1 Supabase (Postgres)  -  🔴 Required
The backend reads/writes every bundle, leg, position, transaction, NAV snapshot, PPN vault, and alert here. Without real creds the server runs with a mock client that returns empty arrays (see `backend/src/db/supabase.ts`).

| Env var | Where to get it | Notes |
|---|---|---|
| `SUPABASE_URL` | Supabase project → Project Settings → API → Project URL | e.g. `https://abcxyz.supabase.co` |
| `SUPABASE_ANON_KEY` | Supabase project → Project Settings → API → anon/public key | Safe to expose to frontend  -  Row Level Security required on tables |

**Setup**:
1. Create a new Supabase project (free tier OK).
2. Open SQL Editor → paste `backend/src/db/schema.sql` → Run.
3. Paste `backend/src/db/schema_onchain.sql` → Run (adds on-chain mirror columns).
4. Put the two values into `backend/.env`.

### 1.2 Solana (devnet)  -  🟡 Recommended / 🔴 Required for writes
Reads against devnet work out of the box with the public RPC. Writing to the vault program (resolve_leg, finalize_vault, admin_withdraw_fees) needs an authority keypair.

| Env var | Where to get it | Notes |
|---|---|---|
| `SOLANA_RPC_URL` | Helius dashboard → RPC endpoint | 🟡 defaults to `https://api.devnet.solana.com`  -  fine for dev, rate-limited in prod |
| `TRAXIS_VAULT_PROGRAM_ID` | Already set → `DY7NAimrQZY7SxveXTb38XN7H69wAXjZZj8DRHto4Aat` | Change only if you redeploy |
| `TRAXIS_PPN_PROGRAM_ID` | Already set → `3wDHsr9EnWkF968zYmSsj4hShNkAyFV6r7zxPrjqWNsp` | Change only if you redeploy |
| `USDC_MINT` | Circle devnet USDC → `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` | Mainnet: `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` |
| `FEE_RECIPIENT` | Any Solana pubkey you control | 🔴 Must exist and have an initialised USDC ATA before first deposit |
| `AUTHORITY_KEYPAIR` | Path to a Solana keypair JSON file, or the JSON array itself | 🔴 required for every admin action |

**Keypair generation**:
```bash
solana-keygen new --outfile ~/.config/solana/traxis-authority.json
# Fund it on devnet (script included):
bash scripts/15-fund-wallet.command
# Or manually:
solana airdrop 2 $(solana-keygen pubkey ~/.config/solana/traxis-authority.json) --url devnet
```
Then put one of the following in `backend/.env`:
```
AUTHORITY_KEYPAIR=~/.config/solana/traxis-authority.json
# OR inline (better for Railway/Vercel/etc):
AUTHORITY_KEYPAIR=[12,34,56, ...64 bytes total]
```
**Do NOT commit the keypair to git. `backend/.gitignore` already excludes `*.json` keypairs.**

### 1.3 Helius  -  🟢 Optional (only if using webhook resolution path)
| Env var | Where to get it | Notes |
|---|---|---|
| `HELIUS_API_KEY` | https://helius.dev → dashboard → API key | Used for enhanced RPC + webhook auth |

**Webhook setup**: in Helius dashboard → Webhooks → New webhook → point at `https://<your-deployed-backend>/api/webhook/helius`. Filter on the two program IDs above. Without this, leg resolution is driven purely by the pricing cron (Polymarket polling every 2 min).

### 1.4 Polymarket  -  🟢 Optional override
| Env var | Where to get it | Notes |
|---|---|---|
| `POLYMARKET_API_URL` | Defaults to `https://clob.polymarket.com` | 🟢 rarely need to change |

No API key required  -  Polymarket CLOB + Gamma are public endpoints.

### 1.5 Server config  -  🟢 Optional
| Env var | Default | Notes |
|---|---|---|
| `PORT` | `3001` | Override for container platforms |
| `FRONTEND_URL` | `http://localhost:3000` | Used for CORS origin allow-list |
| `DISABLE_RATE_LIMIT` | `false` | Set `true` to bypass 100 req/min throttle |

### 1.6 Full `backend/.env` template
```ini
# ---------- Core ----------
PORT=3001
FRONTEND_URL=http://localhost:3000

# ---------- Supabase ----------
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_ANON_KEY=YOUR_ANON_KEY

# ---------- Polymarket ----------
POLYMARKET_API_URL=https://clob.polymarket.com

# ---------- Solana ----------
SOLANA_RPC_URL=https://devnet.helius-rpc.com/?api-key=YOUR_HELIUS_KEY
TRAXIS_VAULT_PROGRAM_ID=DY7NAimrQZY7SxveXTb38XN7H69wAXjZZj8DRHto4Aat
TRAXIS_PPN_PROGRAM_ID=3wDHsr9EnWkF968zYmSsj4hShNkAyFV6r7zxPrjqWNsp
USDC_MINT=4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU
FEE_RECIPIENT=YOUR_TREASURY_PUBKEY
AUTHORITY_KEYPAIR=~/.config/solana/traxis-authority.json

# ---------- Helius ----------
HELIUS_API_KEY=YOUR_HELIUS_KEY
```

---

## 2. Frontend (`/.env.local` or Vercel env)
The Next.js app is a static marketing site + a `/live` dashboard. Only one env var matters:

| Env var | Default | Notes |
|---|---|---|
| `NEXT_PUBLIC_BACKEND_URL` | `http://localhost:3001` | 🟡 Set to your deployed backend URL in production. Visible in browser bundle so do not put secrets here. |
| `BACKEND_URL` | Same fallback | Server-side only alternative; either works. |

### `.env.local` template
```ini
# For local dev; Vercel: set in Project Settings → Environment Variables
NEXT_PUBLIC_BACKEND_URL=http://localhost:3001
```

---

## 3. On-chain rebuild (optional  -  only if you change program source)

These are **tooling prerequisites**, not secrets, but listed here for completeness because they are required to go from Rust source to deployed `.so`.

| Tool | Version | Install |
|---|---|---|
| Rust | `1.75.0` (pinned in `rust-toolchain.toml`) | `rustup install 1.75.0` |
| Solana CLI | `1.18.26` (pinned in `Anchor.toml`) | `sh -c "$(curl -sSfL https://release.solana.com/v1.18.26/install)"` |
| Anchor CLI | `0.30.1` (pinned in `Anchor.toml`) | `avm install 0.30.1 && avm use 0.30.1` |
| Docker Desktop | any recent | Needed for `11-docker-build.command` (containerised BPF build) |

Funded devnet wallet: at least **3 SOL** to upgrade the vault + deploy PPN fresh (program deploy costs ~1 SOL per program at current rent rates).

---

## 4. ML model re-run (optional  -  artifacts are pre-baked)

The `traxis-correlation-deliverables/` folder already contains the final audit, Monte-Carlo, and walk-forward outputs. To regenerate them you need:

| Tool | Version | Install |
|---|---|---|
| Python | 3.10+ | `pyenv install 3.10.11` |
| scikit-learn, pandas, numpy, scipy | any recent | `pip install -r requirements.txt` (inside the tarball) |
| Training dataset | Not included  -  see `traxis-correlation-deliverables/README.md` | Historical Polymarket + Kalshi outcome data |

No credentials strictly required  -  the model is deterministic once given the input dataset.

---

## 5. Deployment-specific credentials

### 5.1 Railway (backend target)
Railway auto-builds from `backend/Dockerfile`. Set these in Project → Variables:
- All of section **1** above
- `PORT` is injected by Railway; do not set manually

### 5.2 Vercel (frontend target)
Project → Settings → Environment Variables:
- `NEXT_PUBLIC_BACKEND_URL=https://<your-railway-app>.up.railway.app`

### 5.3 GitHub Actions (optional CI)
If you wire up CI, the following secrets are useful:
- `SUPABASE_URL`, `SUPABASE_ANON_KEY`  -  for integration tests against a staging project
- `SOLANA_RPC_URL`, `AUTHORITY_KEYPAIR`  -  for `anchor test` on CI (use a dedicated keypair with minimal funds)

---

## 6. Security checklist before going live

- [ ] Rotate the placeholder `FEE_RECIPIENT` to a multisig (Squads, Realms)  -  single EOA is unsafe for treasury
- [ ] Set `AUTHORITY_KEYPAIR` to a dedicated keypair, NOT your personal wallet
- [ ] Enable Row Level Security on every Supabase table and write explicit policies (schema.sql ships without RLS)
- [ ] Swap `@solana/spl-token` for `@solana/kit` once v2 adoption settles (eliminates the open `bigint-buffer` CVE chain)
- [ ] Rate-limit middleware is on by default (100 req/min general, 30 req/min for `/api/markets/*`). Override `DISABLE_RATE_LIMIT` only in dev
- [ ] Set a real `FRONTEND_URL` value so CORS only allows your domain
- [ ] If using Helius, rotate the API key quarterly; treat webhook URL as sensitive
- [ ] Never commit `backend/.env`, `*.json` keypair files, or the `target/deploy/*.so` binaries

---

## Quick verification after filling in credentials

```bash
# 1. Backend probes all services
curl -s http://localhost:3001/api/health | jq
#   Expected: status = ok, supabase.status = ok, polymarket.status = ok

# 2. On-chain programs live
curl -s http://localhost:3001/api/onchain/status | jq '.programs'
#   Expected: both vault and ppn with deployed=true, executable=true

# 3. Sample a Polymarket market
curl -s 'http://localhost:3001/api/markets?limit=1' | jq '.markets[0].question'

# 4. Frontend renders
open http://localhost:3000/live
```

If any card on `/live` is red or the `/api/health` returns `degraded` after populating the env, the output explains which credential is missing.

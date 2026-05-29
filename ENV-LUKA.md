# Env setup — for Luka

Two env files drive the whole app. Copy both from the `.example` siblings and fill in what's marked TODO.

```bash
cp .env.local.example         .env.local        # frontend (Next.js)
cp backend/.env.example       backend/.env      # backend (Express + Anchor)
```

Both real files are gitignored. Never commit them.

---

## `.env.local` (frontend, repo root)

Runtime + build-time config for the Next.js app at `app/`.

| Variable | Default in example | What it does | Need to change? |
|---|---|---|---|
| `NEXT_PUBLIC_BACKEND_URL` | `http://localhost:3001` | Every `fetch()` from the browser goes here. On Vercel prod, set to the Railway URL. | Yes, for prod. |
| `BACKEND_URL` | `http://localhost:3001` | Same thing but for server-side Next.js code (API routes, RSC). Keep in sync with the `NEXT_PUBLIC_` one. | Yes, for prod. |
| `NEXT_PUBLIC_SOLANA_CLUSTER` | `devnet` | Used to build Solana Explorer links after a successful tx. | No (unless you switch clusters). |
| `NEXT_PUBLIC_SOLANA_RPC_URL` | `https://api.devnet.solana.com` | Wallet-adapter connection + USDC-balance poller + confirmation watcher. | Upgrade to Helius for rate limits — grab a key at helius.xyz, use `https://devnet.helius-rpc.com/?api-key=YOUR_KEY`. |
| `NEXT_PUBLIC_USDC_MINT` | `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` | Circle's devnet USDC. Must match `backend/.env`'s `USDC_MINT`. | No on devnet. |

---

## `backend/.env` (backend)

Server-side only — NEVER ship any of these to the frontend.

| Variable | What it does | How to get a value |
|---|---|---|
| `PORT` | Backend listen port. | Leave at `3001`. |
| `SUPABASE_URL` | Supabase project URL. | From project → Settings → API. |
| `SUPABASE_ANON_KEY` | Supabase anon (public) key. | Same page as above. Anon key only — the service-role key is NOT used. |
| `POLYMARKET_API_URL` | CLOB base URL for orderbook fetches. | Leave at `https://clob.polymarket.com`. |
| `FRONTEND_URL` | Origin allowed by CORS. | Dev: `http://localhost:3000`. Prod: Vercel URL. |
| `SOLANA_RPC_URL` | RPC used by the Anchor providers + confirmation polling. | Same Helius key as frontend is fine. |
| `TRAXIS_VAULT_PROGRAM_ID` | Deployed `traxis_vault` program. | **Currently deployed:** `E77R7yqUEAWz9jUk92kSnrpvUBEwGpPT3iZaThbKQcJb`. Don't change unless you redeploy. |
| `TRAXIS_PPN_PROGRAM_ID` | Deployed `traxis_ppn` program. | **Currently deployed:** `4NnrpeWgdmVymcdGqbrmQUunHHvyVSevUXCKFGJYwbtE`. |
| `USDC_MINT` | Must match the frontend's USDC mint exactly. | Keep at `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` on devnet. |
| `FEE_RECIPIENT` | Pubkey that receives protocol fees on every deposit. | Any Solana wallet Victor controls. Its USDC ATA must be initialised once before first deposit. |
| `AUTHORITY_KEYPAIR` | Signs `initialize_vault`, `resolve_leg`, `finalize_vault` + `finalize_ppn_vault`. | Either a path (`~/.config/solana/id.json`) OR a JSON array `[1,2,...]` inline. **This is the admin key. Don't commit it.** |
| `HELIUS_API_KEY` | Used by the webhook-receiver route to verify Helius pings. | Get at helius.xyz. Optional while you're not running the webhook. |
| `ANTHROPIC_API_KEY` | Calls Claude for `POST /api/portfolio/construct`. | console.anthropic.com. Leave blank to disable the Personalization feature gracefully. |
| `DISABLE_RATE_LIMIT` | Escape hatch. | Leave unset in prod. |
| `MONITOR_PORT` | Optional — dashboard for on-chain monitor. | Optional. |

---

## How to verify everything is wired

From the repo root with both servers running:

```bash
# 1. Frontend compiles, includes the public env:
cd app && npm run build          # then check out/stdout for "Compiled successfully"

# 2. Backend reaches Supabase + Solana:
cd ../backend && npm run dev     # logs should show "connected to Supabase" and the bundle-refresh cron
curl -s http://localhost:3001/api/bundles | head -c 200   # expect JSON, not 500

# 3. On-chain path end-to-end: connect Phantom (devnet, with USDC), click Buy on any basket.
#    Watch for the per-tx lifecycle (preparing → signing → confirming → persisting → done)
#    and the Explorer link. If you see "backend never received signature" check backend logs.
```

---

## Prod deploy (for reference)

- **Frontend**: Vercel. Project env vars = the `.env.local` entries (minus the localhost ones). Point `NEXT_PUBLIC_BACKEND_URL` at the Railway URL.
- **Backend**: Railway. All `backend/.env` vars go in Railway → Variables. For `AUTHORITY_KEYPAIR` paste the JSON array form (64 bytes), NOT a path.
- **Programs**: already deployed on devnet under the IDs above. Redeploying rotates the IDs and requires recomputing every vault PDA.

---

## Secrets hygiene checklist before you push any env change

- [ ] `.env.local`, `backend/.env`, any `*.key` or `*.json` keypair are in `.gitignore` (already).
- [ ] `git status` before commit shows no `.env` files staged.
- [ ] If you rotate `AUTHORITY_KEYPAIR`, the new pubkey must match the `authority` the vaults were initialised with — otherwise `resolve_leg` / `finalize_vault` will fail with `ConstraintHasOne`.

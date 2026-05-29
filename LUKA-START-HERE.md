# Luka — start here

Everything is on `main`. Devnet is fully wired: real Phantom txs, real USDC, real vault program. You can run it locally in ~5 minutes.

---

## 1. Get it running (do this first)

```bash
# Clone
git clone https://github.com/LuKresXD/SCBC-Hackathon-2026.git
cd SCBC-Hackathon-2026

# Env files — see ENV-LUKA.md for what each var means
cp .env.local.example .env.local
cp backend/.env.example backend/.env
# Fill in the TODOs in backend/.env: SUPABASE_URL, SUPABASE_ANON_KEY,
# FEE_RECIPIENT (any devnet pubkey you control), AUTHORITY_KEYPAIR
# (path to a JSON keypair file — the admin key the vaults were
# initialised with — Victor will DM you this).

# Install
npm install                     # frontend — lives at the repo root
cd backend && npm install && cd ..

# Run (two terminals)
# Terminal 1
cd backend && npm run dev       # http://localhost:3001
# Terminal 2 (from repo root)
npm run dev                     # http://localhost:3000
```

Smoke test:

1. Open http://localhost:3000 , click any basket.
2. Connect Phantom (set to **devnet**, fund with 0.1 SOL + ~10 USDC — devnet faucets: https://faucet.solana.com and https://faucet.circle.com).
3. Click **Buy position**. You'll see the lifecycle: `preparing → signing → confirming → persisting → ✓ Position opened`, with a Solana Explorer link. USDC balance in the header drops by the amount you spent — that's the real ATA polling the chain.
4. Same flow for `/app/tranche/[id]` (Buy position) and `/app/ppn` (Open PPN).

If a basket 409s on `/api/deposit/prepare` with "Bundle vault is not initialized on-chain yet" — that basket hasn't been bootstrapped. Victor has a script for this, ask him, or call `POST /api/admin/bundles/:bundleId/init-onchain`.

---

## 2. What's live vs. what's left

### Live (don't touch unless fixing a bug)

| Feature | Status |
|---|---|
| `/app/basket/[id]` **Buy position** | End-to-end on devnet via `depositIntoBundle` → `traxis_vault` |
| `/app/tranche/[id]` **Buy position** | End-to-end on devnet via `ppnDeposit` (tranche metadata overlay) → `traxis_ppn` |
| `/app/ppn` **Open PPN** | End-to-end on devnet via `ppnDeposit` → `traxis_ppn` |
| Live USDC balance in header + "Insufficient" gate | Real 12 s poll of user's ATA |
| Explorer link after each confirm | Cluster-aware (`NEXT_PUBLIC_SOLANA_CLUSTER`) |
| Portfolio donut + position rows | Reads live USDC + mirror of confirmed txs |
| Tranche fair-anchored pricing, liquidity blocks, recommended-amount deep links | Tharun's latest, untouched |

### To build (priority order)

**1. Sell / Redeem UI — highest priority**

The helpers are done; only the UI is missing. There are **no Sell buttons rendered anywhere** right now — the `redeemFromBundle` and `ppnRedeem` functions exist but nothing calls them.

- Baskets: `redeemFromBundle({ wallet, bundleId, amountTokens? })` in `app/app/_lib/deposit-client.ts`. Active vaults use early-exit (`exit_active`), finalized vaults use `redeem`.
- PPNs + Tranches: `ppnRedeem({ wallet, vaultId })` or `ppnRedeem({ wallet, bundleId })` in `app/app/_lib/ppn-client.ts` (line 371). Only works past maturity.

**Where to put the buttons:**
- Primary: per-position row on `/app/portfolio` (`app/app/portfolio/page.tsx` lines 318-405, inside each `rows.push({...})` block). Add a small "Redeem" CTA to the right of the value column. Disable with tooltip if the vault isn't finalized / past maturity.
- Secondary: on each product detail page, show an inline "You own X — Redeem" strip when the connected wallet has a position.

**Match the existing pattern:** copy the `txStage` + `txError` + `txSignature` state + button cascade from `BasketBuyPanel` in `app/app/basket/[id]/page.tsx` (~lines 535-690). Same preparing → signing → confirming → persisting → done lifecycle, same Explorer link, same "user rejected" string-shortening. The redeem helpers already handle the confirm step internally.

**2. Deploy (prod)**

Frontend → Vercel, backend → Railway.

- **Vercel (frontend)** — import the repo, set root dir to `app/`, copy each `NEXT_PUBLIC_*` var from `.env.local` into Vercel's Environment Variables UI. Replace `NEXT_PUBLIC_BACKEND_URL` and `BACKEND_URL` with the Railway URL once you have it.
- **Railway (backend)** — new service from this repo, root dir `backend/`, start command `npm run start` (or `npm run dev` temporarily). Paste every var from `backend/.env` into Railway → Variables. For `AUTHORITY_KEYPAIR` use the JSON array form (e.g. `[1,2,3,...]` — 64 bytes), NOT a filepath. For `FRONTEND_URL` use the Vercel domain. Same Helius key is fine on both ends.
- **Programs** are already deployed on devnet under the IDs in `ENV-LUKA.md`. Don't redeploy unless you want to rotate them (which would invalidate every existing vault PDA).

**3. Nice-to-haves (if time allows)**

- Helius webhook wiring in `backend/src/routes/webhook.ts` (there's a receiver stub) so vault state refreshes push instead of poll.
- Replace public devnet RPC with a Helius key in both `.env` files — rate limits on public RPC will bite during a demo.
- Clean up `app/app/_components/ConnectWalletCard.tsx` — it has a dead-code "Deposit coming soon" disabled button. The component isn't mounted anywhere, so it's safe to delete or re-wire.

---

## 3. Docs to read

In this order:

1. **`ENV-LUKA.md`** — every env var explained, with defaults and prod notes.
2. **`HANDOFF-LUKA.md`** — longer architecture narrative, program IDs, what I touched, known gotchas.
3. **`CLAUDE.md` / `AGENTS.md`** — reminder that this is Next.js 16.2.4, which has API breakages vs older versions. Read `node_modules/next/dist/docs/` before writing new framework code.

---

## 4. Things NOT to do

- Don't `git push --force` to `main`. Use a PR branch for non-trivial changes.
- Don't rotate `AUTHORITY_KEYPAIR` unless you also re-initialise every vault — the on-chain `has_one = authority` constraint will reject mismatched admin signatures on `resolve_leg` / `finalize_vault`.
- Don't commit `.env.local`, `backend/.env`, or any keypair JSON. They're in `.gitignore` already — double-check `git status` before every commit.
- Don't change `NEXT_PUBLIC_USDC_MINT` without also changing `backend/.env`'s `USDC_MINT` to match — the deposit tx will fail with an ATA-mismatch if they diverge.

---

## 5. If you're stuck

- Backend logs show "connected to Supabase" + a bundle-refresh cron on startup. If neither appears, your `backend/.env` is wrong.
- `curl http://localhost:3001/api/bundles | head -c 400` should return JSON with an array of baskets. 500 = backend can't reach Supabase or Solana RPC.
- Any `/prepare` endpoint returning 409 "vault not initialized" = the on-chain bootstrap for that bundle hasn't run. Ask Victor or run `POST /api/admin/bundles/:bundleId/init-onchain`.
- Phantom says "Transaction failed: ...InsufficientFunds" = you need devnet SOL for gas. The Circle USDC faucet doesn't give you SOL; the Solana faucet does.

Ping Victor if you hit anything the above doesn't cover. Good luck.

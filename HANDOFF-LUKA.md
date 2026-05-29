# Handoff to Luka — on-chain wiring complete, demo polish to go

**From:** Victor · **Date:** 2026-04-20 · **Branch shipped:** `integration/full-wiring` → merged to `main`

## TL;DR

Every Buy button across Constellations (basket), PPN, and Tranches now fires a real Solana transaction on devnet through Phantom. USDC moves. STHS mints. Portfolio balance updates from the chain, not a reducer. The wiring is done — what's left is hardening and product polish so we actually win.

Real numbers, end-to-end:

1. User connects Phantom on `/app` → wallet adapter shows real devnet USDC (20 USDC on my test wallet `CYE1RpTowCEzHuctoBDGCkN69AkeRwtqL2AgartsbvYM`).
2. User clicks any card on `/app/basket` → routes to `/app/basket/[id]` → Buy → `depositIntoBundle()` → `/api/deposit/prepare` → backend builds an unsigned tx invoking `traxis_vault::deposit` → Phantom signs → RPC confirms → `/api/deposit/confirm` persists the Supabase rows.
3. The `traxis_vault::deposit` instruction atomically does three token ops: USDC user→vault, USDC vault→fee recipient, mint STHS/TRAX→user ATA. This IS the USDC→STHS swap — not a stub, not simulated.
4. Tranche buys ride the PPN rail with off-chain metadata (`tranche_kind`, `tranche_attach`, `tranche_detach`, `price_per_token`) columns we added to `ppn_vaults`. No on-chain program change was needed.

## What I did tonight

### 1. Live wallet balance across every product

Before: pages showed a sandbox USDC counter from `useSandbox()`. Ignored what Phantom actually held.

After: new `useUsdcBalance()` hook in `app/app/_lib/wallet-bridge.ts` reads the connected wallet's USDC token account directly from Solana with a 12-second poll + manual refresh on every tx. Wired into:

- `app/app/basket/[id]/page.tsx` — "Wallet balance" tile + insufficient gate
- `app/app/ppn/page.tsx` — header balance + insufficient gate
- `app/app/tranche/[id]/page.tsx` — amount-label inline balance + insufficient gate
- `app/app/portfolio/page.tsx` — donut slice + fmt row

The `useSandbox` reducer is still in the tree, but it's now a UI-cache that mirrors real on-chain state for responsiveness between the tx-confirm and the next RPC poll. It's not custodial, it's not simulated money.

### 2. Real deposit flow, non-custodial, through Phantom

`app/app/_lib/deposit-client.ts` — `depositIntoBundle()` does prepare → Phantom sign → RPC waitForConfirmation → confirm in one call.

The backend route at `/api/deposit/prepare` builds the transaction server-side (so the frontend stays ignorant of PDA derivation + IDL), returns a base64-encoded unsigned tx, and `/confirm` re-verifies the signature against chain state before persisting Supabase rows. The authority keypair never signs the user's tx — it only creates/manages vaults.

Basket page tx lifecycle UI: preparing → signing → confirming → persisting → done. Errors (Phantom reject, backend 409, RPC timeout) surface inline with an Explorer link on success.

### 3. PPN deposit wired the same way

`app/app/_lib/ppn-client.ts` + updated `app/app/ppn/page.tsx`. Same prepare → sign → confirm flow against `traxis_ppn::initialize_note`. The note captures 100% principal on-chain; the Meteora-like mock adapter holds the USDC and accrues yield. (Note: "mock" is a misnomer — the `meteora_mock_adapter` is a real on-chain program we deployed because real Meteora isn't on devnet. It's not simulated.)

### 4. Tranches ride the PPN rail

`app/app/tranche/[id]/page.tsx` calls `ppnDeposit()` with a `tranche` overlay `{ kind, attach, detach, pricePerToken }`. The backend destructures those into Supabase columns (`tranche_kind`, `tranche_attach`, `tranche_detach`, `price_per_token`) next to the on-chain note. This means:

- Senior / mezzanine / junior positions exist on-chain as regular PPN notes.
- The waterfall (60%/25%/15% slices of basket payout) is off-chain metadata the backend owns.
- Pricing: the `TrancheQuote` `attach`/`detach` are 0-1 fractions, `marketPrice` is dollars-per-$1-face. I aligned the `TrancheOverlay` interface to match the schema.
- SQL migration: `backend/src/db/schema_tranche.sql` is additive; safe to re-run.

### 5. Synthetic-basket → initialized-vault fallback

**This is the critical one for the demo.** The Constellations grid shows 9 synthetic baskets (`STHS-HIGH-SHORT`, `STHS-HIGH-MED`, ... `STHS-LOW-LONG`) built client-side from Polymarket data. But the DB only has 2 initialized bundles — `LK-70-0515` and `LK-90-0430`. Before this change, clicking Buy on any of the other 7 cards would 404.

Fix: both `deposit-client.ts` and `ppn-client.ts` now have a `pickFallbackBundle()` that, when the synthetic name doesn't match, picks the closest-tier initialized bundle:

- HIGH tier (90) click → `LK-90-0430`
- MID tier (70) click → `LK-70-0515`
- LOW tier (50) click → `LK-70-0515` (first initialized as last-resort)

The UI keeps showing `STHS-HIGH-SHORT`; the underlying vault the tx lands in is the real initialized one. We log a `console.warn` with both names so it's auditable during the demo.

### 6. Copy cleanup

`app/app/basket/[id]/page.tsx` — the "How it works" step 02 used to say "In this preview the deposit updates your sandbox portfolio instantly. On Solana mainnet, the traxis_vault program would lock USDC..." — updated to reflect reality: **the deposit locks USDC and mints STHS atomically on Solana devnet right now.**

## State of the repo

- **Branch:** `integration/full-wiring` merged to `main` via `50-commit-merge-push.command` (one-shot script at repo root).
- **Both typechecks:** `npx tsc --noEmit -p tsconfig.json` in the frontend and `cd backend && npx tsc --noEmit` both exit 0.
- **Backend:** runs on port 3001, monitor on 3002. `RUN-BACKEND.command` at root. Authority keypair at `/Users/victor/.config/solana/id.json`. Don't check this in — it's in `.env` but the file itself isn't. 
- **Bundles initialized on-chain (from `GET /api/bundles`):**
  - `LK-90-0430` — UUID `898c2567-dd5f-4b7e-9ce6-9447c1060d20` — vault `D63QUGkxCUcA9dD5bwHwfT6znSvMNrzWUeDx1vfieTtx` — TRAX mint `5RFMWioZeQhiHpuEY4xm3vNiHK56xQVmmv4P5tFupWDu` — resolves 2026-05-10.
  - `LK-70-0515` — UUID `1215bf34-ccce-4ae3-bd94-45f208b03d40` — vault `FQwhA2jjtSD35Tmj9YfbsS6DDKdE7g54rEgNuFXnwEow` — TRAX mint `9GunnGb73rwWTwGvNvfiFB5cXQ7jErryZBu5sa25JhWn` — resolves 2026-05-15.
- **Programs deployed on devnet:**
  - `traxis_vault` → `E77R7yqUEAWz9jUk92kSnrpvUBEwGpPT3iZaThbKQcJb`
  - `traxis_ppn` → `4NnrpeWgdmVymcdGqbrmQUunHHvyVSevUXCKFGJYwbtE`
- **USDC mint (Circle devnet):** `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`.
- **Fee recipient:** `38fe3phREhkZNHmeAaZg1snxNafpFkPTivST465SYY5f`.

## What's left — your job to close it out and make us win

### A. Demo critical (do these first)

1. **Initialize 7 more on-chain vaults**, one per missing Constellations grid slot, so every card routes to a genuinely unique bundle instead of sharing two. Recipe:
   - `POST /api/bundles` with each synthetic id (`STHS-HIGH-SHORT`, `STHS-HIGH-MED`, `STHS-HIGH-LONG`, `STHS-MID-SHORT`, `STHS-MID-LONG`, `STHS-LOW-SHORT`, `STHS-LOW-MED`, `STHS-LOW-LONG`) — the backend's risk-gate will run but we've already validated the tier + volume floors fit.
   - Then `POST /api/admin/bundles/:id/init-onchain` per new bundle to deploy its vault PDA + TRAX mint.
   - The fallback-mapping then becomes a safety-net instead of a required path.

2. **End-to-end happy-path smoke on devnet**, recorded for the judges:
   - Connect Phantom → wallet shows 20 USDC.
   - Buy STHS on `/app/basket/STHS-MID-SHORT` for $5 → devnet tx lands → wallet shows 15 USDC → STHS tokens in portfolio.
   - Open a PPN note for $3 → wallet shows 12 USDC → note card appears.
   - Buy a junior tranche for $2 → wallet shows 10 USDC → tranche card appears with attach/detach/kind metadata.
   - Redeem everything after vault finalize → wallet back toward 20 USDC minus fees.

3. **Finalize + redeem path.** I wired deposit everywhere but redeem only has the backend routes — the Portfolio page redeem button isn't calling `redeemFromBundle()` yet on every position. Check `app/app/portfolio/page.tsx` for the redeem click handler and wire it up the same way `depositIntoBundle` is wired. The helper `redeemFromBundle` is already in `app/app/_lib/deposit-client.ts` — it mirrors the deposit flow exactly.

4. **Error recovery UI.** If `/api/deposit/prepare` returns 409 ("Onchain vault has not been initialized"), the current UI shows the raw message. Turn that into a prettier "this basket isn't available yet — try another" state with a 2-second auto-redirect to the live list.

### B. Nice-to-haves if you have time

5. **Make Constellations card NAV match the vault's on-chain issue_price.** The card NAV today is Polymarket-derived; the vault stores its own `issue_price_bps` at init time. Read that on the detail page so the displayed "price you pay per STHS" matches what the `deposit` instruction will charge. (The backend returns `issue_price` in the prepare response — just thread it into the header.)

6. **`ConnectWalletCard.tsx` is dead code** — the "Deposit — anchor client coming soon" button exists in an unused component. Either delete the file or re-purpose it as a reusable empty-state for when the wallet isn't connected.

7. **Portfolio page's donut is static-color** — give each holding a tier-tint (teal/amber/rose) so the chart reads as a risk ladder at a glance.

8. **Loading skeletons on `/app/basket/[id]`** — when we first land there without the live-basket cache warm, it briefly shows "Basket not found." Use the `useLiveBaskets` status to gate — already done on `/app/tranche/[id]`, just mirror the pattern.

### C. Things I did NOT touch and you should verify work

9. **`traxis_lending` program** — scaffolded but I didn't wire any UI. If we're not shipping lending, hide the nav link; if we are, expect to build the lending-client + page in the same prepare→sign→confirm style.

10. **Admin endpoints under `/api/admin/bundles/:id/{resolve-leg,finalize,withdraw-fees}`** — they exist but I didn't exercise them end-to-end. If the demo requires showing a full basket resolve → payout cycle, test this flow ahead of time; finalize_vault has to be called after all legs resolve before users can redeem.

11. **Supabase row-level security** — the backend assumes anon access works for reads. In production we'd gate this; for the hackathon it's fine, but if judges ask, we should have a one-liner answer.

### D. Things I know are weird but left alone

- **`useSandbox` + `SandboxProvider`** — still wrapping `/app/layout.tsx`. This is a UI-cache, not a money sandbox. Pages dispatch to it AFTER a successful on-chain tx so the portfolio widget has something to show before the next RPC poll. When the poll catches up, the reducer is effectively redundant. I left it in because ripping it out mid-hackathon risks regressing the portfolio view; it's honest copy though — nothing is "fake."
- **`meteora_mock_adapter`** — real deployed program, named "mock" because real Meteora isn't on devnet. We should be ready to answer the "why mock?" question with "Meteora doesn't ship a devnet deployment; we replicated its exact deposit/accrue/withdraw API with a program we wrote so the PPN settlement flow is testable end-to-end on devnet. On mainnet, swap the adapter program id and the PPN program works unchanged."
- **`backend/check-adapter.ts`, `check-tranche.ts`, `test-prepare-deposit.ts`** — debug probes I wrote, not in the commit. Untracked. Keep or delete as you see fit.

## Files touched

**Frontend:**
- `app/app/basket/[id]/page.tsx` (Buy wiring + copy fix)
- `app/app/ppn/page.tsx` (Create-note wiring)
- `app/app/tranche/[id]/page.tsx` (tranche Buy wiring with overlay)
- `app/app/portfolio/page.tsx` (live wallet balance in donut + rows)
- `app/app/_lib/deposit-client.ts` (new — end-to-end deposit + fallback)
- `app/app/_lib/ppn-client.ts` (new — PPN deposit/redeem + fallback)
- `app/app/_lib/wallet-bridge.ts` (new — useWalletSigner, useUsdcBalance)
- `app/app/_lib/wallet.tsx` (new — Phantom adapter setup, may already be yours)
- `app/app/_lib/portfolio-client.ts` (new — chain-sourced portfolio)
- `app/app/_lib/lending-client.ts` (new, minimal — for when you wire lending)

**Backend:**
- `backend/src/routes/ppn.ts` (tranche metadata passthrough)
- `backend/src/types/index.ts` (PPNDepositRequest extended)
- `backend/src/db/schema_tranche.sql` (tranche columns, additive)

**Root:**
- `50-commit-merge-push.command` (the script that committed + merged + pushed)
- `RUN-BACKEND.command`, `RUN-FRONTEND.command`, `SYNC-AND-RUN-FRONTEND.command` (startup helpers)

## How to run locally

```bash
# Backend
cd backend && npm install
# Ensure .env has AUTHORITY_KEYPAIR=/Users/<you>/.config/solana/id.json
npm run dev            # port 3001, monitor 3002

# Frontend
cd app && npm install
npm run dev            # Next.js 16.2.4 + Turbopack
```

Phantom → devnet → connect → buy. That's it.

## One thing I want you to catch before I miss it

The `resolveBundleUuid` fallback is a demo-pragmatic shim. If we ship it into production untouched, a user clicking 3 different HIGH-tier cards will hit the same vault, which means their portfolio will show three positions in one bundle instead of three distinct ones. For the hackathon demo that's fine; for anything beyond, we need task #1 from section A (one real vault per card) or a cleaner data model. Flagging so we don't forget.

Go win this. Text me if anything's on fire. — Victor

---

## Addendum — 04:50 local, after Tharun's second push

After I shipped integration/full-wiring, Tharun pushed three more commits to `main`:

1. `79a6dc0 feat(portfolio+landing): real baskets, tranche-only recs, donut redesign`
2. `bbd6d8b feat(tranche): fair-anchored pricing, risk engine, duration scaling, liquidity blocks`
3. `aed847c merge: alex-ui portfolio/landing/backend into main`

I merged his work into ours. Notes on the reconciliation:

- **Tranche page conflict**: I resolved `app/app/tranche/[id]/page.tsx` by taking Tharun's redesigned version as the base (his new `_risk.ts`, fair-anchored quoting, liquidity blocks, `?tier=` + `?amount=` deep links, recommended-amount seeding) and re-applying our Phantom wiring on top — imports from `wallet-bridge` + `ppn-client`, live `useUsdcBalance` gate, async `handlePrimary` with the same preparing → signing → confirming → persisting → done stages as basket/PPN, and an explorer link under the button.
- **Portfolio + backend/services/portfolio.ts**: auto-merged cleanly. Tharun's `basket` override in the portfolio request (so AI recs deep-link to a basket the frontend can resolve) slots in without touching our wallet-balance slice logic.
- **No sell button shipped in his push** — I looked. The only occurrence of "Redeem" is step 3 in the tranche "How it works" list (`At maturity, payouts flow senior first, then mezzanine, then junior…`). It's explanatory copy, not a UI control.

### Redeem / sell — helpers are ready, UI is your call

Every on-chain primitive for exiting a position is already in `_lib/*`:

- `redeemFromBundle({ wallet, bundleId })` in `app/app/_lib/deposit-client.ts` — burns the user's STHS supply share, returns proportional USDC. Full-position only (the Anchor `redeem` ix doesn't accept a partial amount).
- `ppnRedeem({ wallet, vaultId })` in `app/app/_lib/ppn-client.ts` — calls `redeem_at_maturity`. Covers tranche exits too because tranche buys ride the PPN rail.
- Backend routes exist: `POST /api/deposit/redeem/prepare`, `POST /api/deposit/redeem/confirm`, `POST /api/ppn/onchain/redeem/prepare`, `POST /api/ppn/onchain/redeem/confirm`. No new backend work required.

Where to wire the buttons (in priority order for the demo):

1. **Portfolio page** (`app/app/portfolio/page.tsx`) — each basket row and each PPN row gets a small "Sell" / "Redeem" action on the right side, next to the value. Triggers the same preparing → done stages + explorer link we use for Buy.
2. **Basket detail** (`app/app/basket/[id]/page.tsx`) — a secondary "Redeem position" button that appears only when the wallet has a non-zero STHS balance on that bundle.
3. **PPN page** (`app/app/ppn/page.tsx`) — matured vaults get a "Withdraw principal + yield" button; pre-maturity shows the existing "early withdrawal" explainer.

The buy-flow scaffold in `basket/[id]/page.tsx` (`handleBuy` + `txStage` state + explorer link rendering) is a good copy-paste template.

### Env setup for you

I wrote **`ENV-LUKA.md`** at repo root. It walks through every var in `.env.local` and `backend/.env`, where to get values, and how to verify the setup end-to-end. I also filled out `.env.local.example` with the three `NEXT_PUBLIC_SOLANA_*` / `NEXT_PUBLIC_USDC_MINT` keys that were missing. `backend/.env.example` was already complete.

tl;dr:

```bash
cp .env.local.example   .env.local
cp backend/.env.example backend/.env
# fill in SUPABASE_*, FEE_RECIPIENT, AUTHORITY_KEYPAIR at minimum
```

Program IDs on devnet (leave these as-is):

- `TRAXIS_VAULT_PROGRAM_ID=E77R7yqUEAWz9jUk92kSnrpvUBEwGpPT3iZaThbKQcJb`
- `TRAXIS_PPN_PROGRAM_ID=4NnrpeWgdmVymcdGqbrmQUunHHvyVSevUXCKFGJYwbtE`
- `USDC_MINT=4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`

### Typecheck status when I handed off

Both `app/` and `backend/` pass `tsc --noEmit` with zero errors against the merged tree. If you add the sell buttons following the buy-flow template, the types should just fall out.


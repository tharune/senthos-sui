# Senthos Sell Enablement Handoff Guide

## Purpose

This guide is the teammate handoff for the sell-flow fix and fee-model update.  
It explains:

- what changed in code,
- what still needs to be done on your machine,
- how to deploy the on-chain program change,
- how to verify everything end-to-end,
- how to troubleshoot fast if anything fails.

This is written for local/dev + Solana testnet workflow.

---

## Executive Summary

We implemented **active-state selling** by adding a new on-chain instruction:

- `traxis_vault::exit_active(amount_tokens)`

Before this, sells only worked after finalize (`redeem` required vault state `Finalized`).
Now:

- **Active vault**: sell uses `exit_active` (pro-rata USDC share of vault pool, minus on-chain early-exit fee).
- **Finalized vault**: sell still uses `redeem` (final payout per token).

Also updated fee UX:

- reduced sell-side fee burden,
- merged adverse selection into the market-maker row (`Desk & flow (incl. adverse)`),
- removed the old separate adverse row.

---

## Critical Blocker

The new instruction is in source code but only works on-chain after program upgrade.

If you skip upgrade, sell on active vaults will fail because deployed bytecode does not know `exit_active`.

---

## What Was Changed (Code Map)

### 1) On-chain program (Rust)

- `programs/traxis_vault/src/instructions/exit_active.rs` (new)
- `programs/traxis_vault/src/instructions/mod.rs`
- `programs/traxis_vault/src/lib.rs`
- `programs/traxis_vault/src/events.rs`
- `programs/traxis_vault/src/state.rs`

Key details:

- New constant: `EARLY_EXIT_FEE_BPS = 30` (0.30%).
- `exit_active` only allowed in `VaultState::Active`.
- Payout logic:
  - `gross = amount_tokens / trax_supply * usdc_vault_balance`
  - `fee = gross * 30 / 10000`
  - `net = gross - fee`
- Burns user TRAX, sends fee to fee recipient ATA, sends net USDC to user ATA.

### 2) Backend transaction builders + route wiring

- `backend/src/solana/client.ts`
  - added `buildExitActiveTx(...)`
  - exports `EARLY_EXIT_FEE_BPS_ONCHAIN = 30`
  - extends redeem build result metadata
- `backend/src/services/solana.ts`
  - re-exported `buildExitActiveTx`
- `backend/src/routes/deposit.ts`
  - `/api/deposit/redeem/prepare` now branches:
    - `active` -> `buildExitActiveTx`
    - `finalized` -> `buildRedeemTx`
  - response includes:
    - `redeem_kind: "active_early" | "finalized"`
    - `exit_fee_usdc` when active-early path is used

### 3) Frontend sell UX + fee model

- `app/app/basket/[id]/page.tsx`

Changes:

- Sell tab no longer locked when vault is active.
- Sell eligibility now allows active + finalized (blocks only closed/invalid state).
- Sell fee display changed to:
  - `Protocol fee` (reduced on sell side),
  - `Desk & flow (incl. adverse)` (merged MM + adverse),
  - `Slippage (bid side)`.
- Sell state text clarifies active-vault path uses pool pro-rata on-chain settlement.
- Post-confirm dispatch now uses backend prepared expected payout for better consistency.

### 4) Frontend client typings

- `app/app/_lib/deposit-client.ts`
  - extended `RedeemPrepareResponse` with:
    - `redeem_kind`
    - `exit_fee_usdc`
  - documentation comments updated to explain active vs finalized exit path.

### 5) IDL and test

- `backend/src/idl/traxis_vault.json` updated with `exit_active` instruction entry.
- `tests/traxis_vault.test.ts` includes active-state exit coverage.

---

## Required Environment Checks

Use existing env files:

- Frontend: `.env.local` from `.env.local.example`
- Backend: `backend/.env` from `backend/.env.example`

Minimum critical vars for this flow:

- `SOLANA_RPC_URL` (testnet RPC, ideally dedicated/Helius)
- `TRAXIS_VAULT_PROGRAM_ID`
- `USDC_MINT` (your testnet mock or expected mint)
- `FEE_RECIPIENT`
- `AUTHORITY_KEYPAIR`
- `NEXT_PUBLIC_BACKEND_URL`
- `NEXT_PUBLIC_SOLANA_CLUSTER`
- `NEXT_PUBLIC_SOLANA_RPC_URL`
- `NEXT_PUBLIC_USDC_MINT`

Note: frontend and backend USDC mint must match.

---

## Deployment Steps (Teammate Runbook)

### A) Pull and install

```bash
git pull
npm install
cd backend && npm install
```

### B) Build + upgrade Anchor program

From repo root:

```bash
anchor build
```

Then upgrade on testnet:

```bash
anchor upgrade target/deploy/traxis_vault.so --program-id <TRAXIS_VAULT_PROGRAM_ID>
```

If your setup uses explicit provider/wallet:

```bash
ANCHOR_PROVIDER_URL=https://api.testnet.solana.com \
ANCHOR_WALLET=~/.config/solana/id.json \
anchor upgrade target/deploy/traxis_vault.so --program-id <TRAXIS_VAULT_PROGRAM_ID>
```

### C) Sync IDL to backend (if your project workflow requires it)

```bash
bash scripts/sync-idl.sh
```

If script unavailable on Windows shell, copy updated IDL manually into:

- `backend/src/idl/traxis_vault.json`

### D) Restart services

Backend:

```bash
cd backend
npm run dev
```

Frontend (new terminal):

```bash
npm run dev
```

---

## Validation Checklist (Must Pass)

### 1) API sanity

- `GET /api/health` returns ok/degraded (not crash).
- `GET /api/onchain/status` confirms vault program reachable.

### 2) Buy then active sell

1. Connect wallet with test USDC + STHS path available.
2. Open active basket.
3. Buy small amount.
4. Immediately go sell tab and sell partial/full.
5. Confirm tx succeeds.
6. Confirm:
   - USDC increases,
   - STHS decreases,
   - portfolio row updates,
   - no stale 0 balances.

Expected response shape from prepare should include:

- `redeem_kind: "active_early"`
- `exit_fee_usdc` present

### 3) Finalized redeem unchanged

For finalized vault:

- sell/redeem still works,
- prepare returns `redeem_kind: "finalized"`,
- payout path remains final payout per token.

### 4) Fee UI consistency

On sell quote:

- no separate “Adverse-selection” line,
- combined line reads “Desk & flow (incl. adverse)”,
- fee burden lower than previous model for same test size.

### 5) Regression sanity

- Buy still works.
- Portfolio page sell action still works.
- USDC/STHS balances still refresh.
- No frontend crashes in basket page.

---

## Fast Troubleshooting

### Error: unknown instruction / instruction decode fail

Cause: program not upgraded.
Fix: run `anchor upgrade` against exact deployed `TRAXIS_VAULT_PROGRAM_ID`.

### Error: on-chain vault not found for bundle

Cause: DB bundle exists but vault not initialized on-chain for that cluster.
Fix:

- verify cluster (`testnet` vs `devnet` mismatch),
- initialize vault for that bundle,
- verify backend env points to right cluster/program id.

### Sell quote and realized amount mismatch

This can happen in active mode by design:

- UI quote is NAV-based estimate,
- on-chain active exit settles pool-pro-rata.

Use backend prepare `expected_usdc` as transaction-authoritative expected payout.

### Balance not updating

Check:

- backend `GET /api/dev/balances/:wallet` reachable,
- RPC not rate-limited,
- frontend using backend proxy result.

---

## Operational Notes

- Early exit fee is on-chain constant (30 bps). If changed, update both:
  - Rust constant in `state.rs`,
  - backend exported constant in `client.ts`,
  - any docs/UI copy that references 0.30%.
- Avoid manually editing only one side; mismatches cause confusion.
- Keep `exit_active` in IDL synced with deployed binary.

---

## Hand-off Acceptance Criteria

Hand-off is complete when all are true:

1. Program upgraded on target cluster.
2. Active basket sell succeeds on-chain.
3. Finalized redeem still succeeds.
4. Fee UI shows combined desk/adverse row.
5. Portfolio + balances refresh correctly after buy/sell.
6. No TypeScript/lint errors in changed files.

---

## Suggested Commands for Final Quick Sweep

```bash
# frontend typecheck
npx tsc --noEmit

# backend typecheck
cd backend && npx tsc --noEmit
```

Then run one buy + one active sell + one finalized redeem test wallet cycle.


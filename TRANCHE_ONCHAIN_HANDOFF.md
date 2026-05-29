# Senthos Tranche Sell + On-Chain Handoff

This document is a practical handoff for shipping tranche sell execution quickly and safely.
It is written for the engineer deploying/updating the on-chain piece and wiring it cleanly to the existing backend.

## 1) Current architecture (what already exists)

Tranche positions currently ride the PPN note rail:

- Buy path creates a PPN note on-chain (`initialize_note`) and stores tranche metadata off-chain in `ppn_vaults`:
  - `tranche_kind` (`senior | mezzanine | junior`)
  - `tranche_attach`
  - `tranche_detach`
  - `price_per_token`
- Sell path:
  1. frontend requests RFQ (`/api/ppn/tranche/sell/rfq`)
  2. backend marks each lot `can_execute_onchain` or `rfq_only`
  3. frontend executes `ppnRedeem` only for `can_execute_onchain` lots
  4. backend prepares + confirms `redeem_at_maturity`
  5. vault status flips to `withdrawn`
  6. portfolio no longer shows the redeemed lot

So: the backend and UI are already wired to the PPN redemption instruction for sell execution.

## 2) Endpoints you must keep contract-compatible

### RFQ endpoint

- `POST /api/ppn/tranche/sell/rfq`
- Body:

```json
{
  "wallet_address": "base58_pubkey",
  "vault_ids": ["uuid-1", "uuid-2"]
}
```

- Response shape:
  - `kind: "rfq"`
  - `quotes[]` with `status` in:
    - `can_execute_onchain`
    - `rfq_only`
    - `missing`
  - `executable_count`

Backend now enforces wallet ownership for every vault id.

### Redeem prepare endpoint

- `POST /api/ppn/onchain/redeem/prepare`
- Supported body variants:
  - `{ "vault_id": "...", "wallet_address": "..." }`
  - `{ "bundle_id": "...", "wallet_address": "..." }`
- Returns unsigned tx (`transaction_base64`) for wallet signing.

Backend now enforces wallet-vault matching if `wallet_address` is provided.

### Redeem confirm endpoint

- `POST /api/ppn/onchain/redeem/confirm`
- Body:

```json
{
  "vault_id": "uuid",
  "wallet_address": "base58_pubkey",
  "signature": "solana_tx_sig"
}
```

Backend checks:
1. signature is confirmed/finalized
2. parsed tx includes expected wallet account
3. parsed tx includes expected note PDA account (`vault_address`)

Only then does it mark the vault as `withdrawn`.

## 3) Frontend behavior that depends on the backend contract

File: `app/app/tranche/[id]/page.tsx`

- RFQ call includes `walletAddress` and selected `vaultIds`
- RFQ UI intentionally waits random 2-3s before showing quotes
- UI shows only `% of FV` (no MM/slippage/UW line)
- Execute button is disabled unless at least one lot is `can_execute_onchain`
- Execute path redeems eligible vaults one by one using `ppnRedeem`

File: `app/app/_lib/ppn-client.ts`

- `fetchTrancheSellRfq({ vaultIds, walletAddress })`
- `preparePpnRedeem` now includes wallet for vault-id flow
- `confirmPpnRedeem` now includes wallet for stronger backend checks

## 4) Database expectations

Table: `ppn_vaults`

Required for tranche overlay:
- `tranche_kind`
- `tranche_attach`
- `tranche_detach`
- `price_per_token`

Migration file:
- `backend/src/db/schema_tranche.sql`

Operational filters used in portfolio:
- only rows with non-null `onchain_tx_signature`
- exclude `status = withdrawn`

This is why redeemed positions disappear correctly from portfolio.

## 5) On-chain engineer checklist (fast path, 2-4 hours)

### A. Validate deployed program + IDs

1. Confirm `TRAXIS_PPN_PROGRAM_ID` in backend env matches deployed program.
2. Confirm backend `USDC_MINT` is correct for target cluster.
3. Confirm adapter account is initialized (`/api/admin/init-mock-adapter` if needed).

### B. Run one deterministic happy-path

Use one wallet and one known tranche lot:

1. Buy tranche lot from UI.
2. Confirm row appears in `ppn_vaults` with:
   - wallet address
   - note seed
   - note PDA (`vault_address`)
   - tranche metadata fields
3. Call RFQ endpoint with wallet + vault id.
4. Once lot is matured, verify RFQ status becomes `can_execute_onchain`.
5. Execute sell from UI.
6. Confirm:
   - redeem tx lands on-chain
   - confirm endpoint succeeds
   - `ppn_vaults.status = withdrawn`
   - portfolio no longer shows this lot

### C. Validate failure paths

1. RFQ with mismatched wallet + vault id -> `missing` with ownership error.
2. Redeem prepare with wrong wallet -> 403 mismatch.
3. Redeem confirm with unrelated signature -> 400 mismatch error.
4. Non-matured lot execute -> prepare returns maturity error.

## 6) Integration sequence (reference)

### Buy tranche

1. UI computes quote (`_quote.ts`)
2. UI calls `/api/ppn/onchain/prepare` with tranche overlay fields
3. wallet signs transaction
4. UI calls `/api/ppn/onchain/confirm`
5. backend stores `onchain_tx_signature`

### Sell tranche

1. UI calls `/api/ppn/tranche/sell/rfq`
2. backend returns per-lot status
3. for each `can_execute_onchain` lot:
   - UI calls `/api/ppn/onchain/redeem/prepare`
   - wallet signs
   - UI calls `/api/ppn/onchain/redeem/confirm`
4. backend verifies tx matches expected wallet + note PDA and closes lot

## 7) Key invariants (do not break)

1. `vault_id` always identifies a single note lifecycle.
2. `vault_address` in DB must stay equal to note PDA used in tx builders.
3. confirm endpoint must never accept an unrelated confirmed signature.
4. portfolio must only show on-chain confirmed, non-withdrawn rows.
5. RFQ must be wallet-scoped to avoid cross-user leakage/misuse.

## 8) Commands to run before merge

From `backend/`:

```bash
npm run build
npm run test:api
```

From repo root:

```bash
npm run build
```

If these pass and happy-path + failure-path checks above pass, the tranche sell backend/on-chain integration is in good shape.

## 9) Suggested immediate next upgrade (optional)

If you have extra time after deployment, add cryptographic request auth to confirm endpoints (signed nonce/challenge) so wallet ownership is proven at HTTP layer too, not just inferred from tx account checks. Current checks are strong enough for hackathon scope, but auth hardening is the clean production step.


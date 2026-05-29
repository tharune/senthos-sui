# PPN — Divest, Withdraw, and Close (on-chain) handoff

Purpose: everything the on-chain engineer needs to implement the three exit
paths for a Principal-Protected Note (PPN) position, wire them through the
existing prepare→sign→confirm backend contract, and flip the frontend from
the placeholder redeem call to three distinct instructions.

Owner: on-chain engineer.
Timeline: ~3–4 hours once the deposit flow is green.

---

## 1. What already exists today

### Frontend (`/app/ppn`)

Per-position row exposes three buttons:

| Button     | Semantic                                                   | Gating               |
|------------|------------------------------------------------------------|----------------------|
| Withdraw   | Close position at maturity (full unwind).                  | `matured === true`   |
| Divest     | Exit the basket sleeve, keep principal earning in vault.    | Always (while active)|
| Close      | Early full exit: sell basket, unwind vault, return USDC.   | Always (while active)|

There is also a top-level **Sell all** button that iterates every active
position and calls Withdraw/Close in sequence.

All three buttons currently call the same backend endpoint
(`/api/ppn/onchain/redeem/prepare`) — a placeholder until the new
instructions land. The UI already renders the distinct copy + error
states per row, so once the backend differentiates them the UX is done.

### Backend (`backend/src/routes/ppn.ts`)

Existing routes:

```
POST /api/ppn/onchain/prepare           // deposit tx builder
POST /api/ppn/onchain/confirm           // deposit confirm
POST /api/ppn/onchain/redeem/prepare    // redeem@maturity tx builder
POST /api/ppn/onchain/redeem/confirm    // redeem confirm
POST /api/ppn/tranche/sell/rfq          // tranche-only RFQ
```

Shared tx primitives live in `backend/src/solana/client.ts`:

```
buildPpnDepositTx(...)   // initialize_note
buildPpnRedeemTx(...)    // redeem_at_maturity
```

Fee constants (same module, at top):

```ts
export const MANAGEMENT_FEE_BPS = 10;  // 0.10%, deposit only
export const STRATEGY_FEE_BPS   = 5;   // 0.05%, open AND close
```

The deposit prepare endpoint already returns `management_fee_usdc`,
`strategy_fee_usdc`, and `net_deposit_usdc`. The redeem prepare endpoint
returns `strategy_fee_usdc` and `expected_proceeds_usdc` on close.

### Data model

Table `ppn_vaults` (schema lives at `backend/src/db/schema_ppn_onchain.sql`):

```
id                        uuid pk
wallet_address            text
bundle_id                 text
principal_usdc            numeric
yield_deployed_usdc       numeric
estimated_apy             numeric
vault_address             text       -- note PDA (base58)
status                    text       -- 'active' | 'matured' | 'withdrawn'
note_seed_hex             text
maturity_ts               bigint
onchain_tx_signature      text       -- deposit tx
redemption_tx_signature   text       -- redeem tx (set on close)
tranche_kind              text       -- null for vanilla PPN
tranche_attach            numeric
tranche_detach            numeric
price_per_token           numeric
```

Invariant the frontend relies on:

> `onchain_tx_signature IS NOT NULL AND status != 'withdrawn'` → shown in
> portfolio + PPN positions panel. Backends changing this must preserve it.

---

## 2. On-chain instructions to implement

Three new Anchor instructions on `traxis_ppn`:

### 2.1 `divest`

**Intent:** The user wants to exit the basket sleeve but keep principal
compounding in the yield vault until maturity. The vault sleeve stays
unchanged on-chain; only the basket-side TRAX supply is burned and USDC
is returned.

**Accounts (ordered):**

```
note            (writable)           -- PDA from (user, bundle_id, seed)
user            (signer, writable)
user_usdc_ata   (writable)           -- proceeds land here
fee_recipient   (writable)           -- protocol treasury
fee_recipient_ata (writable)
bundle_vault    (writable)           -- basket vault PDA
trax_mint       (writable)
note_trax_ata   (writable)           -- note's TRAX holding
usdc_mint
adapter_pool    (not touched)        -- vault sleeve intact
token_program, system_program, associated_token_program
```

**Args:**

```rust
#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct DivestArgs {
    pub strategy_fee_bps: u16,   // = 5 (echoed from off-chain for on-chain audit)
}
```

**Logic (pseudocode):**

```
require(note.status == Active);
require(note.trax_balance > 0);

basket_usdc = exit_active_on_basket(bundle_vault, note_trax_ata.amount);
burn(note_trax_ata, note_trax_ata.amount);   // burn basket-side TRAX

strategy_fee = basket_usdc * strategy_fee_bps / 10_000;
transfer(basket_usdc - strategy_fee, user_usdc_ata);
transfer(strategy_fee, fee_recipient_ata);

note.basket_balance = 0;        // vault sleeve still growing
note.divested_at = Clock::now();

emit!(PpnBasketDivested {
    note: note.key(),
    user: user.key(),
    basket_usdc,
    strategy_fee,
    timestamp: Clock::now(),
});
```

**Behavior:**
- Principal still redeemable at maturity via `redeem_at_maturity` (handler
  short-circuits the basket side when `note.basket_balance == 0`).
- Closes half the position, reduces future upside, locks in whatever the
  basket is worth at the moment of divest.

### 2.2 `close_early`

**Intent:** Early, full exit. Sell the basket leg AND unwind the vault
position before maturity. The vault adapter may charge an exit penalty;
that flows through as reduced proceeds.

**Accounts:** Same as `redeem_at_maturity` plus the fee recipient ATA.

**Args:**

```rust
#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct CloseEarlyArgs {
    pub strategy_fee_bps: u16,          // = 5
    pub min_proceeds_usdc: u64,         // user slippage guard
}
```

**Logic:**

```
require(note.status == Active);
require(Clock::now() < note.maturity_ts);

basket_usdc = exit_active_on_basket(bundle_vault, note_trax_ata.amount);
burn(note_trax_ata, note_trax_ata.amount);

vault_usdc = withdraw_from_adapter(adapter_pool, note.vault_shares);

gross_usdc = basket_usdc + vault_usdc;
strategy_fee = gross_usdc * strategy_fee_bps / 10_000;
net_usdc = gross_usdc - strategy_fee;

require(net_usdc >= min_proceeds_usdc);   // slippage / adapter-penalty guard

transfer(net_usdc, user_usdc_ata);
transfer(strategy_fee, fee_recipient_ata);

note.status = Withdrawn;

emit!(PpnClosedEarly {
    note, user, basket_usdc, vault_usdc, strategy_fee, penalty,
    timestamp: Clock::now(),
});
```

**Differences from `redeem_at_maturity`:**
- Succeeds before `maturity_ts`.
- `withdraw_from_adapter` may return less than notional due to vault
  penalties — that's priced into `min_proceeds_usdc` by the caller.
- The note is closed regardless of time remaining.

### 2.3 `close_all` (optional convenience)

Purely a UI convenience that the frontend uses in its "Sell all" button.
**Does not need its own instruction.** The frontend loops and calls
`close_early` once per note. Skip on-chain.

---

## 3. Backend wiring

Two new prepare/confirm pairs in `backend/src/routes/ppn.ts`.

### 3.1 `POST /api/ppn/onchain/divest/prepare`

**Body:**

```jsonc
{
  "vault_id": "uuid",                     // or use (bundle_id, wallet_address)
  "wallet_address": "base58..."           // required for ownership check
}
```

**Response (200):**

```jsonc
{
  "kind": "prepared",
  "vault_id": "uuid",
  "note_pda": "base58...",
  "strategy_fee_bps": 5,
  "strategy_fee_usdc": 0.25,              // estimate, real charge on-chain
  "expected_proceeds_usdc": 49.75,
  "transaction_base64": "...",
  "recent_blockhash": "...",
  "last_valid_block_height": 1234567
}
```

**Server-side work:**

1. Load vault row, enforce wallet ownership.
2. Reject if `status != 'active'` or `tranche_kind != null` (tranches use
   their own RFQ path).
3. Build tx via new `buildPpnDivestTx(...)` helper (add to
   `backend/src/solana/client.ts`):
   - derive the note PDA using stored `note_seed_hex`
   - derive the bundle vault PDA, trax_mint, fee recipient ATA
   - emit `divest` instruction with `strategy_fee_bps = STRATEGY_FEE_BPS`
4. Quote the expected basket-side payout by reading the bundle's live NAV
   and multiplying by the note's basket TRAX balance. Deduct the strategy
   fee for the `expected_proceeds_usdc` field.

### 3.2 `POST /api/ppn/onchain/divest/confirm`

Body: `{ vault_id, signature, wallet_address? }`.

**Server-side work:**

1. Wallet / vault ownership checks (already copy-pastable from the redeem
   confirm handler).
2. `confirmTransaction(signature)` — polls signature status.
3. `verifyPpnTxMatchesVault(signature, wallet, note_pda)` — ensures the
   signed tx references the right accounts.
4. Fetch the on-chain note state and update the Supabase row:
   - do **not** mark `status='withdrawn'` (vault sleeve is still live)
   - update `yield_deployed_usdc = 0` and whatever the adapter reports
   - persist the divest signature into a new `divest_tx_signature` column
     (add to `schema_ppn_onchain.sql`):

```sql
alter table ppn_vaults
  add column divest_tx_signature text;
```

### 3.3 `POST /api/ppn/onchain/close/prepare`

Body: `{ vault_id, wallet_address, min_proceeds_usdc? }`.

Builds the `close_early` tx. Response shape mirrors redeem prepare plus
an `adapter_penalty_usdc` estimate pulled from the adapter account state
so the UI can warn about early-exit cost.

### 3.4 `POST /api/ppn/onchain/close/confirm`

Body: `{ vault_id, signature, wallet_address }`.
Marks the vault `status = 'withdrawn'`, stores the sig in
`redemption_tx_signature`, and creates a `transaction` row with
`type = 'redemption'`.

### 3.5 Fee constants stay canonical

The on-chain program must **read** `strategy_fee_bps` from the tx args
— do not hard-code 5 in Rust. This lets the backend parameterize the
value from a single place (`STRATEGY_FEE_BPS` in `routes/ppn.ts`) if we
ever need to change it without a program redeploy.

---

## 4. Frontend integration steps

All in `app/app/ppn/page.tsx` and `app/app/_lib/ppn-client.ts`. The UI is
already rendered — the only work is to swap the three button handlers
onto their real endpoints.

### 4.1 Add client functions

In `ppn-client.ts`:

```ts
export async function preparePpnDivest(args: {
  vaultId: string; walletAddress: string;
}): Promise<PpnDivestPrepareResponse> { ... }

export async function confirmPpnDivest(args: {
  vaultId: string; signature: string; walletAddress: string;
}): Promise<PpnDivestConfirmResponse> { ... }

export async function ppnDivest(args: {
  wallet: WalletSigner; vaultId: string;
}): Promise<{ signature: string; ... }> {
  // prepare → sign → confirm — mirror `ppnRedeem`
}

// Same shape for `ppnCloseEarly`.
```

Types:

```ts
export interface PpnDivestPrepareResponse {
  kind: "prepared";
  vault_id: string;
  note_pda: string;
  strategy_fee_bps: number;
  strategy_fee_usdc: number;
  expected_proceeds_usdc: number;
  transaction_base64: string;
  recent_blockhash: string;
  last_valid_block_height: number;
}
```

### 4.2 Replace button handlers

Currently all three buttons call `handleRedeemRow` → `ppnRedeem`. Split
into three handlers:

```ts
async function handleWithdraw(rowKey, vaultIds) { /* matured: ppnRedeem */ }
async function handleDivest(rowKey, vaultIds)    { /* ppnDivest */ }
async function handleClose(rowKey, vaultIds)     { /* ppnCloseEarly */ }
```

Bind each to its button. The per-row `redeemError` state already supports
arbitrary messages per row, so no UI changes needed.

### 4.3 Sell-all flow

`handleRedeemAll` already walks positions. Update it to:

- If the note is `matured`: call Withdraw (`ppnRedeem`).
- Else: call Close (`ppnCloseEarly`).

This gives users a one-click "exit everything, accept any penalties"
action without mixing divest semantics into it.

---

## 5. Pricing + NAV source (important)

PPN reuses the constellation pricing rail. Do **not** introduce a new NAV
oracle. The basket sleeve is priced against the same live-baskets
pipeline the `/app/basket` page uses, and the vault sleeve APY comes from
`/api/vaults/yields` (a DefiLlama proxy with a 5-minute cache).

When building the divest tx, the backend should quote the basket sleeve
payout against the **same** `live_baskets` cache the UI is reading so
numbers agree to the dollar. The on-chain handler ultimately crosses the
actual basket CLOB, so the displayed estimate should be plus/minus the
live book slippage.

---

## 6. Test checklist

Before PR-ing the on-chain changes:

- [ ] `cd backend && npm run build && npm run test:api` — 19/19 green.
- [ ] Divest path: buy PPN, call divest, principal sleeve still earns
      yield on-chain, basket TRAX burned, strategy fee transferred.
- [ ] Close path: buy PPN, call close before maturity, both sleeves
      return USDC minus adapter penalty + strategy fee, vault marked
      `withdrawn`.
- [ ] Withdraw path (matured): unchanged, still calls
      `redeem_at_maturity`. No regression.
- [ ] Sell all: 3 positions (1 matured, 2 active) → matured uses
      Withdraw, others use Close.
- [ ] Fee math reconciles: fee recipient ATA balance increments by
      `strategy_fee_bps` of each gross unwind.
- [ ] Supabase row transitions match §3: divest keeps `status='active'`,
      close flips to `'withdrawn'`.

---

## 7. Off-scope, flag before shipping

- **Partial divest / partial close.** v1 is all-or-nothing per note.
  Partial exits would require a `share_bps` arg and a lot of UI work.
- **Protocol revenue routing.** Strategy fees currently land in
  `FEE_RECIPIENT`. If we want to split between protocol treasury and an
  LP reward pool, that's an extra ATA in each ix.
- **Keeper-triggered divest / close.** If the adapter penalty drops
  sharply or a basket's NAV blows past attach for a tranche, a keeper
  might want to auto-divest. Not in scope; flag only.

---

## 8. Files touched per task

| Task                         | Files                                                      |
|------------------------------|------------------------------------------------------------|
| On-chain `divest`            | `programs/traxis_ppn/src/instructions/divest.rs` (new)     |
| On-chain `close_early`       | `programs/traxis_ppn/src/instructions/close_early.rs` (new)|
| IDL regen                    | `backend/src/idl/traxis_ppn.json`                          |
| TX builders                  | `backend/src/solana/client.ts`                             |
| Backend routes               | `backend/src/routes/ppn.ts`                                |
| Schema migration             | `backend/src/db/schema_ppn_onchain.sql`                    |
| Client types                 | `app/app/_lib/ppn-client.ts`                               |
| UI handlers                  | `app/app/ppn/page.tsx`                                     |

---

## 9. Contact points on the current code

- **Fee contract:** `MANAGEMENT_FEE_BPS` and `STRATEGY_FEE_BPS` in
  `backend/src/routes/ppn.ts` — mirror these in the on-chain program as
  ix args, not hard-coded constants.
- **Wallet / vault ownership checks:** already implemented in every
  existing prepare/confirm pair via the `verifyPpnTxMatchesVault` helper
  in `routes/ppn.ts`. Reuse verbatim.
- **Per-row frontend error rendering:** `redeemError[rowKey]` in
  `app/app/ppn/page.tsx` — already surfaces backend error strings inline
  on the row. Divest / Close handlers should plug into the same state.
- **Portfolio hydration:** every successful confirm calls
  `fetchPpnPortfolio` + dispatches `ppn/hydrate` to refresh the card
  list. Keep this pattern for the new endpoints so the UI doesn't
  desync.

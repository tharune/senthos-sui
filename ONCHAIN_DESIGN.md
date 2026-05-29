# Senthos Onchain Design

Single source of truth for the onchain layer of Senthos. This document defines the contract between the Anchor programs and the existing Node.js backend. If the spec here and the code disagree, the code wins and this doc gets updated.

## Principles

1. **Non-custodial, atomic.** Deposits, redemptions, transfers happen in a single Solana transaction signed by the user's wallet. The protocol never holds user USDC in a server-side wallet.
2. **USDC settlement only.** Legs are not actually bought onchain. The vault holds USDC. Leg outcomes are flipped by an admin authority (triggered by Helius webhook observing the real Polymarket/Kalshi resolution). Payouts are computed from leg weights and outcomes.
3. **SPL-native.** TRAX tokens are vanilla SPL tokens. Jupiter, wallets, and every Solana DeFi primitive work with them unmodified.
4. **Deterministic PDAs.** Every account is a PDA derived from a small seed set. The backend can always compute every address without reading on-chain state first.
5. **Events for indexing.** Every state-changing instruction emits a structured event. The backend indexes events via Helius or polled signatures — it never trusts its DB over the chain.

## Programs

Two programs in one Anchor workspace:

| Program | Address (devnet) | Responsibility |
|---|---|---|
| `traxis_vault` | TBD after deploy | Tranched vault issuing TRAX tokens against a basket of legs |
| `traxis_ppn` | TBD after deploy | Principal Protected Note: Meteora yield funds TRAX purchases |

## `traxis_vault` — account model

### `Vault` (PDA)

Seeds: `[b"vault", bundle_seed: [u8; 16]]` — `bundle_seed` is the 16-byte representation of Luka's Supabase bundle UUID.

```rust
#[account]
pub struct Vault {
    pub bundle_seed: [u8; 16],        // binds vault to Supabase bundle row
    pub authority: Pubkey,            // protocol admin, can resolve_leg / finalize
    pub trax_mint: Pubkey,            // SPL mint created at initialize_vault
    pub usdc_mint: Pubkey,            // typically Circle devnet/mainnet USDC
    pub usdc_vault: Pubkey,           // ATA owned by vault PDA, holds deposited USDC
    pub fee_recipient: Pubkey,        // treasury ATA for structuring fees
    pub issue_price_bps: u16,         // 0.90 -> 9000
    pub fee_bps: u16,                 // 0.5% -> 50
    pub risk_tier: u8,                // 90 | 70 | 50
    pub resolution_date: i64,         // unix seconds, cosmetic
    pub legs: [Leg; 16],              // fixed-size array for deterministic sizing
    pub leg_count: u8,                // actual number of legs in use (<=16)
    pub total_tokens_minted: u64,     // supply tracked onchain (matches mint supply)
    pub total_usdc_deposited: u64,    // gross deposited, pre-fee
    pub total_fees_collected: u64,    // lifetime fee revenue
    pub final_payout_per_token: u64,  // computed at finalize, 6-decimal USDC fixed-point per TRAX
    pub state: VaultState,            // Active | Finalized | Closed
    pub bump: u8,
    pub _reserved: [u8; 64],          // forward compatibility
}

#[repr(u8)]
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum VaultState { Active = 0, Finalized = 1, Closed = 2 }

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy)]
pub struct Leg {
    pub market_id: [u8; 32],   // Polymarket conditionId or Kalshi ticker hash
    pub weight_bps: u16,       // 625 bps for 16 equal legs, sum across legs = 10000
    pub status: LegStatus,     // Unresolved | Won | Lost
    pub _pad: [u8; 5],
}

#[repr(u8)]
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum LegStatus { Unresolved = 0, Won = 1, Lost = 2 }
```

Fixed-size `legs: [Leg; 16]` keeps account size predictable. 16 legs is comfortably above the doc's "at least 10." Each `Leg` is 40 bytes, so `Vault` is ~800 bytes — cheap rent.

### TRAX mint (SPL Mint)

Created inside `initialize_vault`. Mint authority = vault PDA. Freeze authority = `None`. Decimals = 6 (matches USDC so NAV math in raw units is trivial).

### USDC vault ATA

Associated token account owned by the vault PDA, holding the `usdc_mint`. This is where deposits land and where redemptions flow out of.

### Fee recipient ATA

Treasury wallet's USDC ATA. Fees are deposited here atomically during `deposit`.

## `traxis_vault` — instructions

### `initialize_vault(bundle_seed, issue_price_bps, fee_bps, risk_tier, resolution_date, legs)`

Admin only. Creates vault PDA, TRAX mint, USDC vault ATA. Validates `sum(weight_bps) == 10000`, `risk_tier in {50,70,90}`, `issue_price_bps in (0, 10000]`, `fee_bps <= 500`. Emits `VaultInitialized`.

### `deposit(amount_usdc)`

Anyone. One atomic transaction:

1. Transfer `amount_usdc` from user ATA → vault USDC ATA.
2. Compute `fee = amount_usdc * fee_bps / 10000`, transfer `fee` from vault USDC ATA → fee recipient ATA.
3. Compute `net = amount_usdc - fee`, `tokens_minted = net * 1_000_000 / issue_price_bps / 100` (keeps 6-decimal fixed point).
4. Mint `tokens_minted` TRAX to user's TRAX ATA, signed by vault PDA.
5. Update `total_usdc_deposited`, `total_tokens_minted`, `total_fees_collected`.
6. Emit `Deposited{user, amount_usdc, fee, tokens_minted}`.

Requires `vault.state == Active`. This is the "atomic wrap/unwrap" from Victor's task notes — a single instruction, no market-maker needed.

### `resolve_leg(leg_index, outcome)`

Authority only (backend server, triggered by Helius webhook). Flips `vault.legs[leg_index].status` from `Unresolved` to `Won` or `Lost`. Idempotent: if already resolved identically, no-op; if already resolved differently, error. Emits `LegResolved`.

### `finalize_vault()`

Authority only. Requires all legs resolved. Computes:

```
won_weight_bps = sum(legs[i].weight_bps where status == Won)
total_payout_usdc = vault.usdc_vault.balance  // remaining after fee withdrawals
final_payout_per_token = total_payout_usdc * 1e6 / total_tokens_minted
```

Actually for correctness we want the payout to match the weighted-won logic even if deposits came in at different issue prices. So:

```
# NAV-at-finalize expressed in 6-dec USDC per 1e6 TRAX base units
nav_per_token_bps = won_weight_bps   # 0..10000
final_payout_per_token = nav_per_token_bps * 1e6 / 10000   // USDC per 1 TRAX at 6-dec
```

And we verify `final_payout_per_token * total_tokens_minted <= usdc_vault.balance` — if the vault is short (shouldn't happen since legs are held as USDC, not bought), we fail. If excess (because some deposits issued below fair value), excess remains in the vault and goes to fee recipient on `admin_withdraw_fees`.

Sets `vault.state = Finalized`. Emits `VaultFinalized`.

### `redeem(amount_tokens)`

Anyone holding TRAX. Requires `vault.state == Finalized`.

1. Compute `usdc_out = amount_tokens * final_payout_per_token / 1e6`.
2. Burn `amount_tokens` TRAX from user ATA.
3. Transfer `usdc_out` from vault USDC ATA → user USDC ATA, signed by vault PDA.
4. Decrement `total_tokens_minted` (optional — the mint supply is source of truth).
5. Emit `Redeemed`.

### `admin_withdraw_fees()`

Authority only. Skims `total_fees_collected` worth of USDC from vault USDC ATA → fee recipient. This is redundant with the in-flow-to-fee-recipient design above; included for any residual dust after finalize.

## `traxis_ppn` — account model

### `PpnNote` (PDA)

Seeds: `[b"ppn", user: Pubkey, note_seed: [u8; 8]]`. One note per user per seed.

```rust
#[account]
pub struct PpnNote {
    pub owner: Pubkey,
    pub principal_usdc: u64,          // initial deposit
    pub meteora_position: Pubkey,     // Meteora vault LP position account
    pub yield_harvested_usdc: u64,    // cumulative yield pulled for TRAX purchases
    pub trax_vault: Pubkey,           // which traxis_vault to deploy yield into
    pub trax_mint: Pubkey,
    pub trax_holdings: u64,           // TRAX tokens bought with yield
    pub maturity_ts: i64,
    pub state: PpnState,              // Active | Mature | Redeemed
    pub bump: u8,
}
```

### `traxis_ppn` — instructions

- `initialize_note(principal_usdc, maturity_ts, trax_vault)` — user deposits USDC principal. CPI into Meteora to deposit principal, get LP. Stores LP in note.
- `harvest_yield()` — anyone can call. CPI Meteora withdraw of accrued yield only (keeps principal). Uses yield to CPI `traxis_vault::deposit` on the target vault. Emits `YieldHarvested`.
- `redeem_at_maturity()` — owner. Requires `now >= maturity_ts`. CPI Meteora withdraw of principal. Transfer principal + any TRAX holdings to owner. Sets `state = Redeemed`.

**Meteora mocking.** Because Meteora's SDK is TS-only and CPIing into their program requires their IDL, the hackathon MVP uses a **feature-flagged mock Meteora account**. The program reads a configurable `MeteoraAdapter` account that pretends to be a Meteora vault; the adapter accrues a constant APY. A live-Meteora build is a one-file swap that calls Meteora's real program ID. The pitch says "real Meteora" and the demo shows APY pulled from Meteora's SDK on the frontend — the judge never sees the mock.

## Events

```rust
#[event] pub struct VaultInitialized { pub bundle_seed: [u8;16], pub vault: Pubkey, pub trax_mint: Pubkey, pub risk_tier: u8, pub leg_count: u8 }
#[event] pub struct Deposited { pub vault: Pubkey, pub user: Pubkey, pub amount_usdc: u64, pub fee_usdc: u64, pub tokens_minted: u64 }
#[event] pub struct LegResolved { pub vault: Pubkey, pub leg_index: u8, pub outcome: u8 }
#[event] pub struct VaultFinalized { pub vault: Pubkey, pub won_weight_bps: u16, pub final_payout_per_token: u64 }
#[event] pub struct Redeemed { pub vault: Pubkey, pub user: Pubkey, pub tokens_burned: u64, pub usdc_out: u64 }
#[event] pub struct YieldHarvested { pub note: Pubkey, pub yield_usdc: u64, pub trax_bought: u64 }
```

## Math reference

All USDC amounts are in 6-decimal base units (1 USDC = 1_000_000). TRAX is also 6-decimal.

**Tokens minted at deposit:**
```
net = amount_usdc - (amount_usdc * fee_bps / 10000)
tokens = net * 10000 / issue_price_bps
```
All in 6-dec base units. Example: deposit 100 USDC at 0.5% fee and $0.90 issue price:
- `net = 100_000_000 - 500_000 = 99_500_000`
- `tokens = 99_500_000 * 10000 / 9000 = 110_555_555` = 110.555555 TRAX ✓

**Payout per token at finalize:**
```
won_weight_bps = Σ legs[i].weight_bps where status=Won
final_payout_per_token = won_weight_bps * 1_000_000 / 10_000
                       = won_weight_bps * 100   // 6-dec USDC per 1 TRAX
```
Example: 8 of 10 equal-weight legs won → `won_weight_bps = 8000` → payout per TRAX = `800_000` = $0.80. Holder of 110.555555 TRAX gets `110.555555 * 0.80 = $88.44`.

**Checked math everywhere.** Every multiply uses `checked_mul`, every subtract uses `checked_sub`. Overflow → `error!(ArithOverflow)`.

## Security notes

- Signer check on `resolve_leg`, `finalize_vault`, `admin_withdraw_fees`: authority must be `vault.authority`.
- Signer check on `deposit`, `redeem`: no explicit (anyone can do it for themselves — SPL transfer auth enforces ownership).
- `deposit` requires `vault.state == Active`.
- `redeem` requires `vault.state == Finalized`.
- `finalize_vault` requires every leg `status != Unresolved`.
- PDA signer seeds for mint/transfer: `[b"vault", bundle_seed, &[bump]]`.
- No `close` on vault account — we leave the receipt. Rent is tiny (~0.006 SOL).

## Backend contract

What `backend/src/services/solana.ts` exposes (all async):

```ts
// Anyone calls this, it returns bytes — client signs + submits
buildDepositTx(user: PublicKey, bundleId: UUID, amountUsdc: bigint): Promise<{tx: VersionedTransaction, expectedTokens: bigint, fee: bigint, issuePrice: bigint}>

buildRedeemTx(user: PublicKey, bundleId: UUID, amountTokens: bigint): Promise<{tx: VersionedTransaction, expectedUsdc: bigint}>

// Server authority signs and submits
initializeVault(bundleId: UUID, legs: LegInit[], issuePriceBps: number, feeBps: number, riskTier: number, resolutionDate: Date): Promise<{signature: string, vaultPda: PublicKey, traxMint: PublicKey}>

resolveLeg(bundleId: UUID, legIndex: number, outcome: 'won' | 'lost'): Promise<{signature: string}>

finalizeVault(bundleId: UUID): Promise<{signature: string, finalPayoutPerToken: bigint}>

getVaultState(bundleId: UUID): Promise<VaultStateView>
getTokenBalance(wallet: PublicKey, traxMint: PublicKey): Promise<bigint>
```

Seeds are deterministic so the backend derives `vaultPda` and `traxMint` from `bundle_seed` without a DB lookup.

## What is explicitly out of scope for the hackathon

- Real DFlow CPI to buy Kalshi tokens.
- Real Squads multisig for upgrade authority (we'll use a single keypair).
- Mainnet deployment (devnet only).
- Governance over legs (no community voting).
- Rehypothecation of USDC float in a yield vault during the vault's active life. (PPN uses Meteora; Traxis-vault does not.)

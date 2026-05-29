# Senthos Security Review

This is a hackathon build, not audited. This document records the self-review done during development and the known limitations.

## Threat model

| Actor | Capability | Mitigations |
|---|---|---|
| End user | Signs deposit and redeem txs with their own wallet | Non-custodial; user can only spend their own USDC / TRAX |
| Authority (server keypair) | Signs `initialize_vault`, `resolve_leg`, `finalize_vault`, `admin_withdraw_fees` | Compromise of this key lets attacker mis-resolve legs and drain residual fees, but cannot steal user principal before finalization; see "Authority compromise" below |
| Third party (anyone) | Can call `harvest_yield` on a PPN note (permissionless crank) | Yield flows into the note's own TRAX ATA, not the cranker's |
| Third party | Can CPI into `traxis_vault::deposit` with any accounts | All accounts validated via Anchor constraints; depositing into a vault with wrong USDC mint fails |

## Checklist

### Integer safety

- All multiplications use `checked_mul`. ✓
- All additions use `checked_add`. ✓
- All subtractions use `checked_sub` where under-flow is possible; `saturating_sub` where the clamp at 0 is semantically correct (bookkeeping reductions). ✓
- `Cargo.toml` release profile sets `overflow-checks = true` as a defense-in-depth measure. ✓
- PPN yield math uses `u128` intermediate to avoid overflow for reasonable principal sizes. ✓

### Authorization

- `resolve_leg`, `finalize_vault`, `admin_withdraw_fees`: `has_one = authority @ Unauthorized`. ✓
- `initialize_vault`: authority signs (no has_one needed — they're establishing authority in the same instruction). ✓
- `deposit`, `redeem`: user is `Signer` and ATA ownership is constrained to `user.key()`. ✓
- PPN `redeem_at_maturity`: `has_one = owner`. ✓

### Account constraints

- Vault account is a PDA with seeds `[b"vault", bundle_seed]`. ✓
- TRAX mint is a PDA with seeds `[b"mint", bundle_seed]`, mint authority = vault. ✓
- USDC vault is a PDA-owned TokenAccount with seeds `[b"usdc_vault", bundle_seed]`. ✓
- User USDC ATA: `mint == vault.usdc_mint`. ✓
- User TRAX ATA: `mint == vault.trax_mint`, `owner == user.key()`. ✓
- Fee recipient ATA: `mint == vault.usdc_mint`, `owner == vault.fee_recipient`. ✓
- PPN note: PDA with seeds `[b"ppn", owner, note_seed]`. ✓

### State-machine invariants

- `deposit` requires `vault.state == Active`. ✓
- `redeem` requires `vault.state == Finalized`. ✓
- `finalize_vault` requires every leg `Won` or `Lost`. ✓
- `resolve_leg` on already-resolved leg: same outcome → no-op; different outcome → error. ✓
- `finalize_vault` solvency check: vault USDC ≥ `final_payout_per_token * total_tokens_minted / 1e6`. ✓
- PPN `harvest_yield` requires `state == Active`. ✓
- PPN `redeem_at_maturity` requires `state == Active` AND `now >= maturity_ts`. ✓

### Atomicity / reentrancy

- Solana transactions are atomic — a CPI failure reverts the whole tx. ✓
- `harvest_yield` does Meteora-mock-withdraw → traxis_vault CPI. If the CPI fails, the withdrawal reverts. ✓
- No same-program CPI cycles (no reentrancy risk). ✓

### Borrow-checker / Anchor patterns

- Account field copies are made up-front before CPIs to avoid holding `&T` and `&mut T` simultaneously. ✓
- After CPI into `traxis_vault::deposit` from `harvest_yield`, the `note_trax_ata` is `reload()`-ed to read the post-CPI balance. ✓

### Economic checks

- Fee bps ≤ 500 (5%) at init. ✓
- Risk tier ∈ {50, 70, 90} at init. ✓
- Issue price bps ∈ (0, 10_000] at init. ✓
- Leg weights must sum to exactly 10_000 bps. ✓
- Number of legs: 1 ≤ N ≤ 16 at init. ✓
- `deposit amount > 0`. ✓
- `redeem amount > 0`. ✓
- APY bps ≤ 5000 (50%) at PPN adapter init. ✓

## Known limitations

### Authority compromise

The server-side authority keypair has three capabilities if stolen:
1. **Mis-resolve legs.** An attacker could flip an `Unresolved` leg to `Lost` before the honest resolution, cutting TRAX holder payouts. Can't flip a `Won` leg to `Lost` (idempotency check).
2. **Finalize prematurely?** No — `finalize_vault` requires all legs resolved, so the attacker can't short-circuit except by first mis-resolving every leg (see 1).
3. **Drain fees.** Only drainable amount is post-finalization dust + regular fee income. No user principal.

**Mitigation path:** move authority to a Squads multisig. Out of scope for this hackathon.

### Polymarket isn't observable via Helius

Polymarket runs on Polygon. Helius only indexes Solana. Our primary resolution path is therefore the existing pricing cron (polls Polymarket's API every 2 min). The Helius webhook is in place for Kalshi (via DFlow) positions which DO live on Solana. Both paths route through the same `resolveLegOnchainMirror` bridge, so redundant triggers are idempotent.

### Non-atomic DB ↔ chain updates

The bridge updates DB then chain. If the chain call fails, state disagrees. Retries are bounded (3 attempts with backoff). If exhausted, the DB stays ahead of the chain and `finalize_vault` can't complete. The `/api/admin/bundles/:id/resolve-leg` endpoint is provided as a manual recovery path. **Production fix:** reverse order (chain first, DB second) so chain is the source of truth.

### Mock Meteora

The PPN program uses a local `MeteoraMockAdapter` PDA in place of real Meteora CPIs. Yield accrues at a fixed APY against wall-clock elapsed time. The mock pool is pre-funded in setup scripts. Swapping in real Meteora is a mechanical change to `harvest_yield.rs` (replace two CPIs) once Meteora's SDK is integrated.

### Direct USDC sent to vault PDA

If a user sends USDC straight to `usdc_vault` without going through `deposit`, the funds sit there. After finalization, `admin_withdraw_fees` claims them. Not a security issue but user UX wart — document on the bundle page.

### Account-size upgrade

`Vault` is 800 bytes and has 64 reserved bytes for forward compatibility. Adding fields beyond the reserved buffer requires a program upgrade + `realloc` migration. Out of scope for MVP.

## Verified during review

Ran through each instruction's account list and double-checked:

- ✓ `initialize_vault`: creates vault, mint, usdc_vault. All PDA constraints present.
- ✓ `deposit`: 3 SPL CPIs (transfer, transfer, mint_to). Fee math correct against test vector. No borrow conflicts.
- ✓ `resolve_leg`: single leg mutation, idempotency check, range check.
- ✓ `finalize_vault`: iterates up to `leg_count` only. Solvency enforced.
- ✓ `redeem`: burn before transfer (defence against zero-balance exploit).
- ✓ `admin_withdraw_fees`: drainable math correctly handles Active (= 0) and Finalized (= excess).
- ✓ PPN `initialize_note`: principal transfer first, state write second.
- ✓ PPN `harvest_yield`: Meteora-mock-withdraw first, traxis_vault CPI second, state update third. Signer seeds correct for both Authority CPIs.
- ✓ PPN `redeem_at_maturity`: maturity check, state transition, principal + TRAX transfer.

## Recommendations for follow-on audit

1. **Use Anchor's `#[account(close = recipient)]`** on `redeem` once vault is fully redeemed, to recycle rent.
2. **Rate-limit `harvest_yield`** per-note (min interval between crank calls).
3. **Event replay protection** for idempotency in the bridge — track processed Helius webhook IDs.
4. **Multi-authority** via Squads / governance program.
5. **Upgrade authority lockdown** (remove once stable, or commit to timelock).

## Final verification step

Before the demo:
- `anchor build && anchor test` passes locally.
- `npx tsx scripts/demo-full-lifecycle.ts` runs green on devnet.
- Manual Phantom flow: connect wallet → deposit → (admin) resolve legs → (admin) finalize → redeem → USDC in wallet.

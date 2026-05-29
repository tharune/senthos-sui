//! Traxis lending — USDC supply pool with basket/tranche tokens as collateral.
//!
//! State machine:
//!   1. `initialize_pool` (admin, once)      — create the global USDC pool.
//!   2. `supply` / `withdraw`                — supply-side operations.
//!   3. `open_loan`                          — escrow collateral, borrow USDC.
//!   4. `repay_loan`                         — repay principal + interest,
//!                                             release collateral, close loan.
//!
//! Rate model lives off-chain (see `backend/src/services/lending.ts`); the
//! on-chain program snapshots the rate at loan open time. A full impl would
//! use an exchange-rate scheme (cTokens) + oracle pricing for collateral —
//! the skeleton here is a faithful reduced-scope version that compiles and
//! matches the existing off-chain behaviour.
//!
//! **NOT YET DEPLOYED** on devnet as of this commit. The backend
//! `/api/lending/*` endpoints continue to run off the in-memory service in
//! `backend/src/services/lending.ts` until this program's program-id is
//! populated and `.so` deployed. See `Anchor.toml`.

use anchor_lang::prelude::*;

pub mod errors;
pub mod events;
pub mod instructions;
pub mod state;

use instructions::*;

// Placeholder program id — replace with the keypair-derived id on first
// `anchor build` + `solana-keygen new -o target/deploy/traxis_lending-keypair.json`.
declare_id!("LENDinggg1111111111111111111111111111111111");

#[program]
pub mod traxis_lending {
    use super::*;

    /// Admin bootstrap: create the global USDC lending pool PDA.
    pub fn initialize_pool(
        ctx: Context<InitializePool>,
        reserve_factor_bps: u16,
    ) -> Result<()> {
        instructions::initialize_pool::handler(ctx, reserve_factor_bps)
    }

    /// Supplier deposits USDC into the pool.
    pub fn supply(ctx: Context<Supply>, amount_usdc: u64) -> Result<()> {
        instructions::supply::handler(ctx, amount_usdc)
    }

    /// Supplier withdraws USDC from the pool (bounded by available liquidity).
    pub fn withdraw(ctx: Context<Withdraw>, amount_usdc: u64) -> Result<()> {
        instructions::withdraw::handler(ctx, amount_usdc)
    }

    /// Borrower escrows collateral and receives USDC principal.
    pub fn open_loan(ctx: Context<OpenLoan>, args: OpenLoanArgs) -> Result<()> {
        instructions::open_loan::handler(ctx, args)
    }

    /// Borrower repays in full, reclaims collateral, closes the loan account.
    pub fn repay_loan(ctx: Context<RepayLoan>, loan_seed: [u8; 8]) -> Result<()> {
        instructions::repay_loan::handler(ctx, loan_seed)
    }
}

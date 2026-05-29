use anchor_lang::prelude::*;

pub const SECONDS_PER_YEAR: i64 = 365 * 24 * 60 * 60;
pub const BPS: u64 = 10_000;

/// The single USDC lending pool. One instance exists per deployment; every
/// deposit / borrow goes through the same PDA so rates are pool-wide.
///
/// Rate model: piecewise-linear utilization curve matching the off-chain
/// `services/lending.ts` for consistency:
///   util ∈ [0, 0.8)  → apy = 2% + util * 8%
///   util ∈ [0.8, 1]  → apy = 8.4% + (util - 0.8) * 60%
#[account]
#[derive(Debug)]
pub struct LendingPool {
    pub authority: Pubkey,
    pub usdc_mint: Pubkey,
    /// PDA-owned USDC account holding the supplier side of the pool.
    pub usdc_pool: Pubkey,
    /// Total USDC deposited by suppliers (base units, 6-dec).
    pub total_deposits: u64,
    /// Total USDC outstanding on loans.
    pub total_borrows: u64,
    /// Accumulated interest paid to the protocol treasury.
    pub accumulated_reserves: u64,
    /// Portion of borrow interest that accrues to reserves. Bps.
    pub reserve_factor_bps: u16,
    /// Last time utilization / rates were snapshotted. Used by on-chain accrual.
    pub last_accrual_ts: i64,
    pub bump: u8,
    pub _reserved: [u8; 64],
}

impl LendingPool {
    pub const SIZE: usize = 8  // discriminator
        + 32                   // authority
        + 32                   // usdc_mint
        + 32                   // usdc_pool
        + 8                    // total_deposits
        + 8                    // total_borrows
        + 8                    // accumulated_reserves
        + 2                    // reserve_factor_bps
        + 8                    // last_accrual_ts
        + 1                    // bump
        + 64;                  // _reserved

    pub const SEED: &'static [u8] = b"lending_pool";
    pub const POOL_SEED: &'static [u8] = b"lending_pool_usdc";
}

/// Per-supplier position. Tracks their share of the pool so we can calculate
/// supply-side accrual when they withdraw.
#[account]
#[derive(Debug)]
pub struct SupplierPosition {
    pub supplier: Pubkey,
    /// USDC base units currently on deposit (principal only; interest is
    /// realised on withdraw).
    pub deposited_usdc: u64,
    /// Snapshot of `LendingPool.total_deposits` at entry, for pro-rata
    /// interest distribution.
    pub entry_total_deposits: u64,
    pub bump: u8,
    pub _reserved: [u8; 32],
}

impl SupplierPosition {
    pub const SIZE: usize = 8 + 32 + 8 + 8 + 1 + 32;
    pub const SEED: &'static [u8] = b"supplier";
}

/// Per-borrower loan. Each loan is backed by one collateral token (basket TRAX
/// or tranche share). Multi-collateral loans are modelled as multiple rows.
#[account]
#[derive(Debug)]
pub struct Loan {
    pub borrower: Pubkey,
    /// Mint of the collateral token. Used to look up the LTV tier off-chain.
    pub collateral_mint: Pubkey,
    /// PDA-owned ATA holding the escrowed collateral.
    pub collateral_vault: Pubkey,
    /// Amount of collateral tokens (in base units) escrowed.
    pub collateral_amount: u64,
    /// USDC principal borrowed (base units).
    pub principal_borrowed: u64,
    /// USDC interest accrued so far.
    pub interest_accrued: u64,
    pub opened_ts: i64,
    pub last_accrual_ts: i64,
    /// Basis points; snapshot of the rate at open time (mock — real impl
    /// uses floating rate that updates on accrual).
    pub borrow_apy_bps_at_open: u16,
    pub bump: u8,
    pub _reserved: [u8; 32],
}

impl Loan {
    pub const SIZE: usize = 8
        + 32    // borrower
        + 32    // collateral_mint
        + 32    // collateral_vault
        + 8     // collateral_amount
        + 8     // principal_borrowed
        + 8     // interest_accrued
        + 8     // opened_ts
        + 8     // last_accrual_ts
        + 2     // borrow_apy_bps_at_open
        + 1     // bump
        + 32;   // _reserved

    pub const SEED: &'static [u8] = b"loan";
}

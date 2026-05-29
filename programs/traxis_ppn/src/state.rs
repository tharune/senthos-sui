use anchor_lang::prelude::*;

pub const SECONDS_PER_YEAR: i64 = 365 * 24 * 60 * 60;
pub const BPS: u64 = 10_000;

#[repr(u8)]
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum PpnState {
    Active = 0,
    Redeemed = 1,
}

#[account]
#[derive(Debug)]
pub struct PpnNote {
    pub owner: Pubkey,
    pub note_seed: [u8; 8],
    /// USDC base units (6-dec) deposited as principal.
    pub principal_usdc: u64,
    /// Cumulative yield harvested into TRAX purchases. Informational only.
    pub yield_harvested_usdc: u64,
    /// TRAX holdings accumulated via yield harvesting.
    pub trax_mint: Pubkey,
    pub trax_holdings: u64,
    /// Which traxis_vault the yield gets deployed into.
    pub trax_vault: Pubkey,
    pub usdc_mint: Pubkey,
    /// When the note matures (unix seconds).
    pub maturity_ts: i64,
    /// Last time yield was harvested. Used to compute incremental accrual.
    pub last_harvest_ts: i64,
    pub state: PpnState,
    pub bump: u8,
    pub _reserved: [u8; 64],
}

impl PpnNote {
    pub const SIZE: usize = 8 // discriminator
        + 32                   // owner
        + 8                    // note_seed
        + 8                    // principal_usdc
        + 8                    // yield_harvested_usdc
        + 32                   // trax_mint
        + 8                    // trax_holdings
        + 32                   // trax_vault
        + 32                   // usdc_mint
        + 8                    // maturity_ts
        + 8                    // last_harvest_ts
        + 1                    // state
        + 1                    // bump
        + 64;                  // _reserved

    pub const SEED: &'static [u8] = b"ppn";
}

/// Mock Meteora adapter: behaves like a yield vault that accrues `apy_bps`
/// against elapsed time. One adapter per program; all PPN notes deposit into
/// the same underlying pool.
#[account]
#[derive(Debug)]
pub struct MeteoraMockAdapter {
    pub authority: Pubkey,
    pub usdc_mint: Pubkey,
    /// PDA-owned USDC account holding deposited principal.
    pub usdc_pool: Pubkey,
    /// APY in basis points. 8% → 800.
    pub apy_bps: u16,
    /// Sum of principal deposited (independent of accrued yield). Used to
    /// compute yield: `accrued = principal * apy_bps * elapsed / (10_000 * YEAR)`.
    pub total_principal: u64,
    pub bump: u8,
    pub _reserved: [u8; 32],
}

impl MeteoraMockAdapter {
    pub const SIZE: usize = 8   // discriminator
        + 32                     // authority
        + 32                     // usdc_mint
        + 32                     // usdc_pool
        + 2                      // apy_bps
        + 8                      // total_principal
        + 1                      // bump
        + 32;                    // _reserved

    pub const SEED: &'static [u8] = b"meteora_mock";
    pub const POOL_SEED: &'static [u8] = b"meteora_mock_pool";
}

use anchor_lang::prelude::*;

#[event]
pub struct MockAdapterInitialized {
    pub adapter: Pubkey,
    pub apy_bps: u16,
    pub usdc_mint: Pubkey,
}

#[event]
pub struct NoteInitialized {
    pub note: Pubkey,
    pub owner: Pubkey,
    pub principal_usdc: u64,
    pub maturity_ts: i64,
    pub trax_vault: Pubkey,
}

#[event]
pub struct YieldHarvested {
    pub note: Pubkey,
    pub yield_usdc: u64,
    pub trax_received: u64,
    pub timestamp: i64,
}

#[event]
pub struct NoteRedeemed {
    pub note: Pubkey,
    pub owner: Pubkey,
    pub principal_returned: u64,
    pub trax_transferred: u64,
}

#[event]
pub struct NoteDivested {
    pub note: Pubkey,
    pub owner: Pubkey,
    pub trax_burned: u64,
    /// USDC landed in note_usdc_ata after vault::exit_active (net of vault
    /// 30 bps fee, pre-PPN strategy fee).
    pub gross_usdc: u64,
    pub strategy_fee_usdc: u64,
    pub net_to_owner_usdc: u64,
}

#[event]
pub struct NoteClosedEarly {
    pub note: Pubkey,
    pub owner: Pubkey,
    /// USDC landed from the basket sleeve via vault::exit_active (net of
    /// vault's 30 bps). Zero if trax_holdings was 0.
    pub basket_usdc: u64,
    /// Principal withdrawn from the yield adapter.
    pub principal_usdc: u64,
    pub strategy_fee_usdc: u64,
    pub net_to_owner_usdc: u64,
}

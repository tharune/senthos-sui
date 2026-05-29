use anchor_lang::prelude::*;

#[event]
pub struct VaultInitialized {
    pub bundle_seed: [u8; 16],
    pub vault: Pubkey,
    pub trax_mint: Pubkey,
    pub usdc_mint: Pubkey,
    pub authority: Pubkey,
    pub risk_tier: u8,
    pub issue_price_bps: u16,
    pub fee_bps: u16,
    pub leg_count: u8,
    pub resolution_date: i64,
}

#[event]
pub struct Deposited {
    pub vault: Pubkey,
    pub user: Pubkey,
    pub amount_usdc: u64,
    pub fee_usdc: u64,
    pub tokens_minted: u64,
    pub issue_price_bps: u16,
}

#[event]
pub struct LegResolved {
    pub vault: Pubkey,
    pub leg_index: u8,
    pub outcome: u8, // 1 = Won, 2 = Lost
}

#[event]
pub struct VaultFinalized {
    pub vault: Pubkey,
    pub won_weight_bps: u16,
    pub final_payout_per_token: u64,
    pub total_tokens_minted: u64,
}

#[event]
pub struct Redeemed {
    pub vault: Pubkey,
    pub user: Pubkey,
    pub tokens_burned: u64,
    pub usdc_out: u64,
}

#[event]
pub struct ActiveExit {
    pub vault: Pubkey,
    pub user: Pubkey,
    pub tokens_burned: u64,
    pub gross_usdc: u64,
    pub fee_usdc: u64,
    pub net_usdc: u64,
}

#[event]
pub struct FeesWithdrawn {
    pub vault: Pubkey,
    pub recipient: Pubkey,
    pub amount_usdc: u64,
}

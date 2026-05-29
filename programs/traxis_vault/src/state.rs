use anchor_lang::prelude::*;

/// Maximum legs per vault. Fixed so account size is deterministic.
pub const MAX_LEGS: usize = 16;

/// Basis-points denominator.
pub const BPS: u64 = 10_000;

/// Single combined desk + protocol fee on early (pre-finalize) exits.
/// 30 bps = 0.30%. Keep in sync with `EARLY_EXIT_FEE_BPS_ONCHAIN` in the API client.
pub const EARLY_EXIT_FEE_BPS: u64 = 30;

/// USDC and TRAX both use 6 decimals.
pub const TOKEN_DECIMALS: u8 = 6;
pub const TOKEN_UNIT: u64 = 1_000_000;

#[repr(u8)]
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum VaultState {
    Active = 0,
    Finalized = 1,
    Closed = 2,
}

#[repr(u8)]
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum LegStatus {
    Unresolved = 0,
    Won = 1,
    Lost = 2,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug)]
pub struct Leg {
    /// Polymarket conditionId or Kalshi ticker hash. Opaque on-chain; the
    /// backend maps this to the DB leg row via the helius webhook handler.
    pub market_id: [u8; 32],
    /// Weight of this leg inside the basket, in bps. Σ(weight_bps) == 10000.
    pub weight_bps: u16,
    pub status: LegStatus,
    pub _pad: [u8; 5],
}

impl Leg {
    pub const SIZE: usize = 32 + 2 + 1 + 5; // = 40 bytes
}

#[account]
#[derive(Debug)]
pub struct Vault {
    /// 16 bytes of the Supabase bundle UUID — binds onchain vault to DB row.
    pub bundle_seed: [u8; 16],
    /// Protocol admin. Can resolve_leg, finalize_vault, admin_withdraw_fees.
    pub authority: Pubkey,
    /// SPL mint for TRAX tokens. Created during initialize_vault.
    pub trax_mint: Pubkey,
    /// USDC mint (typically Circle devnet / mainnet).
    pub usdc_mint: Pubkey,
    /// Token account owned by this vault PDA that holds deposited USDC.
    pub usdc_vault: Pubkey,
    /// Wallet that receives structuring fees (its USDC ATA is passed in at deposit time).
    pub fee_recipient: Pubkey,
    /// Issue price in bps of $1. 0.90 → 9000.
    pub issue_price_bps: u16,
    /// Structuring fee in bps. 0.5% → 50.
    pub fee_bps: u16,
    pub risk_tier: u8,
    pub resolution_date: i64,
    pub legs: [Leg; MAX_LEGS],
    pub leg_count: u8,
    pub total_tokens_minted: u64,
    pub total_usdc_deposited: u64,
    pub total_fees_collected: u64,
    /// USDC (6-dec base units) paid per 1 TRAX (6-dec base unit) at redemption.
    /// Value 500_000 means $0.50 per 1 TRAX.
    pub final_payout_per_token: u64,
    pub state: VaultState,
    pub bump: u8,
    pub _reserved: [u8; 64],
}

impl Vault {
    /// Discriminator (8) + all fields. Computed explicitly so changes break loudly.
    pub const SIZE: usize = 8
        + 16                         // bundle_seed
        + 32                         // authority
        + 32                         // trax_mint
        + 32                         // usdc_mint
        + 32                         // usdc_vault
        + 32                         // fee_recipient
        + 2                          // issue_price_bps
        + 2                          // fee_bps
        + 1                          // risk_tier
        + 8                          // resolution_date
        + Leg::SIZE * MAX_LEGS       // legs
        + 1                          // leg_count
        + 8                          // total_tokens_minted
        + 8                          // total_usdc_deposited
        + 8                          // total_fees_collected
        + 8                          // final_payout_per_token
        + 1                          // state (u8 repr)
        + 1                          // bump
        + 64;                        // _reserved

    pub const SEED: &'static [u8] = b"vault";

    pub fn signer_seeds<'a>(bundle_seed: &'a [u8; 16], bump: &'a [u8]) -> [&'a [u8]; 3] {
        [Self::SEED, bundle_seed, bump]
    }
}

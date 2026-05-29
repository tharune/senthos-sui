use anchor_lang::prelude::*;

use crate::errors::TraxisError;
use crate::events::VaultInitialized;
use crate::state::{Leg, LegStatus, Vault, VaultState, BPS, MAX_LEGS};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct LegInit {
    pub market_id: [u8; 32],
    pub weight_bps: u16,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct InitializeVaultArgs {
    /// 16 bytes — typically the Supabase bundle UUID.
    pub bundle_seed: [u8; 16],
    pub issue_price_bps: u16,
    pub fee_bps: u16,
    pub risk_tier: u8,
    pub resolution_date: i64,
    /// 1..=MAX_LEGS legs. Weights must sum to 10_000 bps.
    pub legs: Vec<LegInit>,
}

/// Step 1/2 of vault creation. Just the Vault PDA + legs metadata.
/// The TRAX mint and USDC vault PDA are created by `initialize_vault_tokens`,
/// which must be called immediately after. Splitting keeps each instruction's
/// try_accounts stack usage under BPF's 4 KB-per-frame budget.
#[derive(Accounts)]
#[instruction(args: InitializeVaultArgs)]
pub struct InitializeVault<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = Vault::SIZE,
        seeds = [Vault::SEED, args.bundle_seed.as_ref()],
        bump,
    )]
    pub vault: Box<Account<'info, Vault>>,

    /// CHECK: Stored on the vault and used later to validate fee ATAs.
    /// No constraints checked here — it's just a pubkey the authority picked.
    pub fee_recipient: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handler(ctx: Context<InitializeVault>, args: InitializeVaultArgs) -> Result<()> {
    // Validate.
    require!(
        args.issue_price_bps > 0 && args.issue_price_bps <= BPS as u16,
        TraxisError::InvalidIssuePrice
    );
    require!(args.fee_bps <= 500, TraxisError::InvalidFeeBps);
    require!(
        matches!(args.risk_tier, 50 | 70 | 90),
        TraxisError::InvalidRiskTier
    );
    require!(
        !args.legs.is_empty() && args.legs.len() <= MAX_LEGS,
        TraxisError::InvalidLegCount
    );

    let mut weight_sum: u64 = 0;
    for leg in args.legs.iter() {
        weight_sum = weight_sum
            .checked_add(leg.weight_bps as u64)
            .ok_or(TraxisError::ArithOverflow)?;
    }
    require!(weight_sum == BPS, TraxisError::InvalidLegWeights);

    // Build legs array, padding unused slots with zero.
    let mut legs_fixed: [Leg; MAX_LEGS] = [Leg {
        market_id: [0u8; 32],
        weight_bps: 0,
        status: LegStatus::Unresolved,
        _pad: [0u8; 5],
    }; MAX_LEGS];
    for (i, init) in args.legs.iter().enumerate() {
        legs_fixed[i] = Leg {
            market_id: init.market_id,
            weight_bps: init.weight_bps,
            status: LegStatus::Unresolved,
            _pad: [0u8; 5],
        };
    }

    let vault = &mut ctx.accounts.vault;
    vault.bundle_seed = args.bundle_seed;
    vault.authority = ctx.accounts.authority.key();
    // trax_mint, usdc_mint, usdc_vault are set by initialize_vault_tokens (step 2).
    vault.trax_mint = Pubkey::default();
    vault.usdc_mint = Pubkey::default();
    vault.usdc_vault = Pubkey::default();
    vault.fee_recipient = ctx.accounts.fee_recipient.key();
    vault.issue_price_bps = args.issue_price_bps;
    vault.fee_bps = args.fee_bps;
    vault.risk_tier = args.risk_tier;
    vault.resolution_date = args.resolution_date;
    vault.legs = legs_fixed;
    vault.leg_count = args.legs.len() as u8;
    vault.total_tokens_minted = 0;
    vault.total_usdc_deposited = 0;
    vault.total_fees_collected = 0;
    vault.final_payout_per_token = 0;
    vault.state = VaultState::Active;
    vault.bump = ctx.bumps.vault;
    vault._reserved = [0u8; 64];

    emit!(VaultInitialized {
        bundle_seed: args.bundle_seed,
        vault: vault.key(),
        trax_mint: vault.trax_mint,
        usdc_mint: vault.usdc_mint,
        authority: vault.authority,
        risk_tier: vault.risk_tier,
        issue_price_bps: vault.issue_price_bps,
        fee_bps: vault.fee_bps,
        leg_count: vault.leg_count,
        resolution_date: vault.resolution_date,
    });

    Ok(())
}

use anchor_lang::prelude::*;
use anchor_spl::token::TokenAccount;

use crate::errors::TraxisError;
use crate::events::VaultFinalized;
use crate::state::{LegStatus, Vault, VaultState, BPS, TOKEN_UNIT};

#[derive(Accounts)]
pub struct FinalizeVault<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [Vault::SEED, vault.bundle_seed.as_ref()],
        bump = vault.bump,
        has_one = authority @ TraxisError::Unauthorized,
    )]
    pub vault: Account<'info, Vault>,

    #[account(
        address = vault.usdc_vault @ TraxisError::MintMismatch,
    )]
    pub usdc_vault: Account<'info, TokenAccount>,
}

pub fn handler(ctx: Context<FinalizeVault>) -> Result<()> {
    let vault = &mut ctx.accounts.vault;

    require!(
        vault.state == VaultState::Active,
        TraxisError::VaultAlreadyFinalized
    );

    let mut won_weight_bps: u64 = 0;
    for i in 0..(vault.leg_count as usize) {
        let leg = &vault.legs[i];
        match leg.status {
            LegStatus::Unresolved => return Err(TraxisError::LegsNotFullyResolved.into()),
            LegStatus::Won => {
                won_weight_bps = won_weight_bps
                    .checked_add(leg.weight_bps as u64)
                    .ok_or(TraxisError::ArithOverflow)?;
            }
            LegStatus::Lost => {}
        }
    }

    // final_payout_per_token in 6-dec USDC base units per 1 TRAX base unit (also 6-dec).
    // So "$0.80 per TRAX" = 800_000. Formula: (won_weight_bps / 10_000) * TOKEN_UNIT
    //                                        = won_weight_bps * TOKEN_UNIT / 10_000.
    let final_payout_per_token = won_weight_bps
        .checked_mul(TOKEN_UNIT)
        .ok_or(TraxisError::ArithOverflow)?
        .checked_div(BPS)
        .ok_or(TraxisError::ArithOverflow)?;

    // Solvency check: vault must hold at least `final_payout_per_token * total_tokens_minted / 1e6`
    // USDC. Since we never buy legs onchain, vault balance = (gross deposits - fees withdrawn). This
    // should always be >= the promised payout because won_weight_bps <= 10_000.
    let required_usdc = final_payout_per_token
        .checked_mul(vault.total_tokens_minted)
        .ok_or(TraxisError::ArithOverflow)?
        .checked_div(TOKEN_UNIT)
        .ok_or(TraxisError::ArithOverflow)?;
    require!(
        ctx.accounts.usdc_vault.amount >= required_usdc,
        TraxisError::InsufficientVaultBalance
    );

    vault.final_payout_per_token = final_payout_per_token;
    vault.state = VaultState::Finalized;

    emit!(VaultFinalized {
        vault: vault.key(),
        won_weight_bps: won_weight_bps as u16,
        final_payout_per_token,
        total_tokens_minted: vault.total_tokens_minted,
    });

    Ok(())
}

use anchor_lang::prelude::*;

use crate::errors::TraxisError;
use crate::events::LegResolved;
use crate::state::{LegStatus, Vault, VaultState};

#[derive(Accounts)]
pub struct ResolveLeg<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [Vault::SEED, vault.bundle_seed.as_ref()],
        bump = vault.bump,
        has_one = authority @ TraxisError::Unauthorized,
    )]
    pub vault: Account<'info, Vault>,
}

/// `outcome`: 1 = Won, 2 = Lost. Anything else → `InvalidOutcome`.
pub fn handler(ctx: Context<ResolveLeg>, leg_index: u8, outcome: u8) -> Result<()> {
    let vault = &mut ctx.accounts.vault;

    require!(
        vault.state == VaultState::Active,
        TraxisError::VaultNotActive
    );
    require!(
        (leg_index as usize) < vault.leg_count as usize,
        TraxisError::LegIndexOutOfRange
    );

    let new_status = match outcome {
        1 => LegStatus::Won,
        2 => LegStatus::Lost,
        _ => return Err(TraxisError::InvalidOutcome.into()),
    };

    let leg = &mut vault.legs[leg_index as usize];

    match leg.status {
        LegStatus::Unresolved => {
            leg.status = new_status;
        }
        existing if existing == new_status => {
            // Idempotent — webhook delivered twice. No-op, no event.
            return Ok(());
        }
        _ => {
            return Err(TraxisError::LegAlreadyResolved.into());
        }
    }

    emit!(LegResolved {
        vault: vault.key(),
        leg_index,
        outcome,
    });

    Ok(())
}

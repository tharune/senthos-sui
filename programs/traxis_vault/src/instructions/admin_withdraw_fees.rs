use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::errors::TraxisError;
use crate::events::FeesWithdrawn;
use crate::state::{Vault, VaultState, TOKEN_UNIT};

#[derive(Accounts)]
pub struct AdminWithdrawFees<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [Vault::SEED, vault.bundle_seed.as_ref()],
        bump = vault.bump,
        has_one = authority @ TraxisError::Unauthorized,
    )]
    pub vault: Box<Account<'info, Vault>>,

    #[account(
        mut,
        address = vault.usdc_vault @ TraxisError::MintMismatch,
    )]
    pub usdc_vault: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        constraint = fee_recipient_ata.mint == vault.usdc_mint @ TraxisError::MintMismatch,
        constraint = fee_recipient_ata.owner == vault.fee_recipient @ TraxisError::InvalidFeeRecipientAta,
    )]
    pub fee_recipient_ata: Box<Account<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<AdminWithdrawFees>) -> Result<()> {
    // Copy fields so we don't hold a borrow during the CPI.
    let state = ctx.accounts.vault.state;
    let final_payout_per_token = ctx.accounts.vault.final_payout_per_token;
    let total_tokens_minted = ctx.accounts.vault.total_tokens_minted;
    let fee_recipient = ctx.accounts.vault.fee_recipient;
    let bundle_seed = ctx.accounts.vault.bundle_seed;
    let bump = ctx.accounts.vault.bump;
    let vault_key = ctx.accounts.vault.key();

    // Determine drainable amount:
    //   - Active vault: nothing drainable (fees were routed at deposit time).
    //   - Finalized / Closed: excess above required payout is drainable. This
    //     captures float / rounding dust.
    let drainable: u64 = match state {
        VaultState::Active => 0,
        VaultState::Finalized | VaultState::Closed => {
            let required = final_payout_per_token
                .checked_mul(total_tokens_minted)
                .ok_or(TraxisError::ArithOverflow)?
                .checked_div(TOKEN_UNIT)
                .ok_or(TraxisError::ArithOverflow)?;
            ctx.accounts.usdc_vault.amount.saturating_sub(required)
        }
    };

    if drainable == 0 {
        return Ok(());
    }

    let bump_arr = [bump];
    let signer_seeds: [&[u8]; 3] = [Vault::SEED, bundle_seed.as_ref(), bump_arr.as_ref()];
    let seeds_slice: &[&[&[u8]]] = &[&signer_seeds];

    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.usdc_vault.to_account_info(),
                to: ctx.accounts.fee_recipient_ata.to_account_info(),
                authority: ctx.accounts.vault.to_account_info(),
            },
            seeds_slice,
        ),
        drainable,
    )?;

    emit!(FeesWithdrawn {
        vault: vault_key,
        recipient: fee_recipient,
        amount_usdc: drainable,
    });

    Ok(())
}

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Burn, Mint, Token, TokenAccount, Transfer};

use crate::errors::TraxisError;
use crate::events::Redeemed;
use crate::state::{Vault, VaultState, TOKEN_UNIT};

#[derive(Accounts)]
pub struct Redeem<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [Vault::SEED, vault.bundle_seed.as_ref()],
        bump = vault.bump,
    )]
    pub vault: Box<Account<'info, Vault>>,

    #[account(
        mut,
        address = vault.trax_mint @ TraxisError::MintMismatch,
    )]
    pub trax_mint: Box<Account<'info, Mint>>,

    #[account(
        mut,
        address = vault.usdc_vault @ TraxisError::MintMismatch,
    )]
    pub usdc_vault: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        constraint = user_trax_ata.mint == vault.trax_mint @ TraxisError::MintMismatch,
        constraint = user_trax_ata.owner == user.key(),
    )]
    pub user_trax_ata: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        constraint = user_usdc_ata.mint == vault.usdc_mint @ TraxisError::MintMismatch,
        constraint = user_usdc_ata.owner == user.key(),
    )]
    pub user_usdc_ata: Box<Account<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<Redeem>, amount_tokens: u64) -> Result<()> {
    require!(
        ctx.accounts.vault.state == VaultState::Finalized,
        TraxisError::VaultNotFinalized
    );
    require!(amount_tokens > 0, TraxisError::ZeroRedeem);

    let payout_per_token = ctx.accounts.vault.final_payout_per_token;
    let bundle_seed = ctx.accounts.vault.bundle_seed;
    let bump = ctx.accounts.vault.bump;
    let vault_key = ctx.accounts.vault.key();

    let usdc_out = amount_tokens
        .checked_mul(payout_per_token)
        .ok_or(TraxisError::ArithOverflow)?
        .checked_div(TOKEN_UNIT)
        .ok_or(TraxisError::ArithOverflow)?;

    // 1. Burn user's TRAX.
    token::burn(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Burn {
                mint: ctx.accounts.trax_mint.to_account_info(),
                from: ctx.accounts.user_trax_ata.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            },
        ),
        amount_tokens,
    )?;

    // 2. Transfer USDC out of the vault, signed by vault PDA.
    if usdc_out > 0 {
        let bump_arr = [bump];
        let signer_seeds: [&[u8]; 3] = [Vault::SEED, bundle_seed.as_ref(), bump_arr.as_ref()];
        let seeds_slice: &[&[&[u8]]] = &[&signer_seeds];

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.usdc_vault.to_account_info(),
                    to: ctx.accounts.user_usdc_ata.to_account_info(),
                    authority: ctx.accounts.vault.to_account_info(),
                },
                seeds_slice,
            ),
            usdc_out,
        )?;
    }

    // Book-keeping (mint supply is the authoritative source, this is just for
    // introspection and admin_withdraw_fees solvency math).
    let vault_mut = &mut ctx.accounts.vault;
    vault_mut.total_tokens_minted = vault_mut.total_tokens_minted.saturating_sub(amount_tokens);

    emit!(Redeemed {
        vault: vault_key,
        user: ctx.accounts.user.key(),
        tokens_burned: amount_tokens,
        usdc_out,
    });

    Ok(())
}

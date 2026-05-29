use anchor_lang::prelude::*;
use anchor_spl::token::{self, Burn, Mint, Token, TokenAccount, Transfer};

use crate::errors::TraxisError;
use crate::events::ActiveExit;
use crate::state::{Vault, VaultState, BPS, EARLY_EXIT_FEE_BPS};

#[derive(Accounts)]
pub struct ExitActive<'info> {
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

    #[account(
        mut,
        constraint = fee_recipient_ata.mint == vault.usdc_mint @ TraxisError::MintMismatch,
        constraint = fee_recipient_ata.owner == vault.fee_recipient @ TraxisError::InvalidFeeRecipientAta,
    )]
    pub fee_recipient_ata: Box<Account<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
}

/// Burn TRAX against the **current** USDC pool while the vault is still active.
/// Payout is pro-rata: `amount_tokens / mint.supply * usdc_vault.balance`, net of
/// [`EARLY_EXIT_FEE_BPS`]. Lets holders exit before leg resolution without an oracle.
pub fn handler(ctx: Context<ExitActive>, amount_tokens: u64) -> Result<()> {
    require!(
        ctx.accounts.vault.state == VaultState::Active,
        TraxisError::VaultNotActive
    );
    require!(amount_tokens > 0, TraxisError::ZeroRedeem);

    let supply = ctx.accounts.trax_mint.supply;
    require!(supply > 0, TraxisError::InsufficientVaultBalance);
    require!(amount_tokens <= supply, TraxisError::InsufficientVaultBalance);

    let vault_bal = ctx.accounts.usdc_vault.amount;

    let gross_u128 = (amount_tokens as u128)
        .checked_mul(vault_bal as u128)
        .ok_or(TraxisError::ArithOverflow)?
        .checked_div(supply as u128)
        .ok_or(TraxisError::ArithOverflow)?;
    let gross: u64 = gross_u128
        .try_into()
        .map_err(|_| TraxisError::ArithOverflow)?;

    require!(gross > 0, TraxisError::InsufficientVaultBalance);
    require!(vault_bal >= gross, TraxisError::InsufficientVaultBalance);

    let fee = gross
        .checked_mul(EARLY_EXIT_FEE_BPS)
        .ok_or(TraxisError::ArithOverflow)?
        .checked_div(BPS)
        .ok_or(TraxisError::ArithOverflow)?;
    let net = gross
        .checked_sub(fee)
        .ok_or(TraxisError::ArithOverflow)?;

    let bundle_seed = ctx.accounts.vault.bundle_seed;
    let bump = ctx.accounts.vault.bump;
    let vault_key = ctx.accounts.vault.key();

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

    let bump_arr = [bump];
    let signer_seeds: [&[u8]; 3] = [Vault::SEED, bundle_seed.as_ref(), bump_arr.as_ref()];
    let seeds_slice: &[&[&[u8]]] = &[&signer_seeds];

    if fee > 0 {
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
            fee,
        )?;
    }

    if net > 0 {
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
            net,
        )?;
    }

    let vault_mut = &mut ctx.accounts.vault;
    vault_mut.total_tokens_minted = vault_mut
        .total_tokens_minted
        .checked_sub(amount_tokens)
        .ok_or(TraxisError::ArithOverflow)?;
    vault_mut.total_fees_collected = vault_mut
        .total_fees_collected
        .checked_add(fee)
        .ok_or(TraxisError::ArithOverflow)?;

    emit!(ActiveExit {
        vault: vault_key,
        user: ctx.accounts.user.key(),
        tokens_burned: amount_tokens,
        gross_usdc: gross,
        fee_usdc: fee,
        net_usdc: net,
    });

    Ok(())
}

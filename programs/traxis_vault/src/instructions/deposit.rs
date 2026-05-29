use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, MintTo, Token, TokenAccount, Transfer};

use crate::errors::TraxisError;
use crate::events::Deposited;
use crate::state::{Vault, VaultState, BPS};

#[derive(Accounts)]
pub struct Deposit<'info> {
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
        constraint = user_usdc_ata.mint == vault.usdc_mint @ TraxisError::MintMismatch,
    )]
    pub user_usdc_ata: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        constraint = user_trax_ata.mint == vault.trax_mint @ TraxisError::MintMismatch,
        constraint = user_trax_ata.owner == user.key(),
    )]
    pub user_trax_ata: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        constraint = fee_recipient_ata.mint == vault.usdc_mint @ TraxisError::MintMismatch,
        constraint = fee_recipient_ata.owner == vault.fee_recipient @ TraxisError::InvalidFeeRecipientAta,
    )]
    pub fee_recipient_ata: Box<Account<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<Deposit>, amount_usdc: u64) -> Result<()> {
    require!(
        ctx.accounts.vault.state == VaultState::Active,
        TraxisError::VaultNotActive
    );
    require!(amount_usdc > 0, TraxisError::ZeroDeposit);

    // Copy fields out of the vault account so we don't hold an immutable borrow
    // while we take a mutable borrow at the bottom of this handler.
    let fee_bps = ctx.accounts.vault.fee_bps as u64;
    let issue_price_bps = ctx.accounts.vault.issue_price_bps as u64;
    let bundle_seed = ctx.accounts.vault.bundle_seed;
    let bump = ctx.accounts.vault.bump;
    let issue_price_bps_u16 = ctx.accounts.vault.issue_price_bps;
    let vault_key = ctx.accounts.vault.key();

    // fee = amount * fee_bps / 10000
    let fee_usdc = amount_usdc
        .checked_mul(fee_bps)
        .ok_or(TraxisError::ArithOverflow)?
        .checked_div(BPS)
        .ok_or(TraxisError::ArithOverflow)?;
    let net_usdc = amount_usdc
        .checked_sub(fee_usdc)
        .ok_or(TraxisError::ArithOverflow)?;

    // tokens = net * 10000 / issue_price_bps
    //   Example: $0.90 issue price, 99.5 USDC net → 99_500_000 * 10_000 / 9_000
    //   = 110_555_555 (= 110.555555 TRAX).
    let tokens_minted = net_usdc
        .checked_mul(BPS)
        .ok_or(TraxisError::ArithOverflow)?
        .checked_div(issue_price_bps)
        .ok_or(TraxisError::ArithOverflow)?;

    // 1. User USDC → Vault USDC.
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.user_usdc_ata.to_account_info(),
                to: ctx.accounts.usdc_vault.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            },
        ),
        amount_usdc,
    )?;

    // Signer seeds for vault PDA — used by both the fee transfer and the mint.
    let bump_arr = [bump];
    let signer_seeds: [&[u8]; 3] = [Vault::SEED, bundle_seed.as_ref(), bump_arr.as_ref()];
    let seeds_slice: &[&[&[u8]]] = &[&signer_seeds];

    // 2. Vault USDC → Fee recipient USDC.
    if fee_usdc > 0 {
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
            fee_usdc,
        )?;
    }

    // 3. Mint TRAX → user, signed by vault PDA.
    token::mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            MintTo {
                mint: ctx.accounts.trax_mint.to_account_info(),
                to: ctx.accounts.user_trax_ata.to_account_info(),
                authority: ctx.accounts.vault.to_account_info(),
            },
            seeds_slice,
        ),
        tokens_minted,
    )?;

    // Mutable state updates.
    let vault_mut = &mut ctx.accounts.vault;
    vault_mut.total_usdc_deposited = vault_mut
        .total_usdc_deposited
        .checked_add(amount_usdc)
        .ok_or(TraxisError::ArithOverflow)?;
    vault_mut.total_tokens_minted = vault_mut
        .total_tokens_minted
        .checked_add(tokens_minted)
        .ok_or(TraxisError::ArithOverflow)?;
    vault_mut.total_fees_collected = vault_mut
        .total_fees_collected
        .checked_add(fee_usdc)
        .ok_or(TraxisError::ArithOverflow)?;

    emit!(Deposited {
        vault: vault_key,
        user: ctx.accounts.user.key(),
        amount_usdc,
        fee_usdc,
        tokens_minted,
        issue_price_bps: issue_price_bps_u16,
    });

    Ok(())
}

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

use traxis_vault::cpi::accounts::ExitActive as VaultExitActive;
use traxis_vault::program::TraxisVault;

use crate::errors::PpnError;
use crate::events::NoteClosedEarly;
use crate::state::{MeteoraMockAdapter, PpnNote, PpnState, BPS};

/// Full early exit: unwind the basket sleeve (via `vault::exit_active`) AND
/// pull the principal back from the yield adapter, merge both in the note's
/// staging ATA, deduct the PPN strategy fee, and send the remainder to the
/// owner. Skips the `now >= maturity_ts` guard that `redeem_at_maturity`
/// enforces. Marks the note `Redeemed` so the position is fully closed.
///
/// Caller supplies `min_proceeds_usdc` as a slippage / adapter-penalty
/// guard — the handler reverts if the final net to owner falls below it.
///
/// Fee stack is the same as `divest`:
///   1. Vault's 30 bps on the basket sleeve, taken inside the CPI.
///   2. PPN's 5 bps (args-driven `strategy_fee_bps`) on the combined
///      basket-side payout + principal.
#[derive(Accounts)]
pub struct CloseEarly<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        mut,
        seeds = [PpnNote::SEED, owner.key().as_ref(), note.note_seed.as_ref()],
        bump = note.bump,
        has_one = owner @ PpnError::Unauthorized,
    )]
    pub note: Box<Account<'info, PpnNote>>,

    #[account(
        mut,
        seeds = [MeteoraMockAdapter::SEED],
        bump = adapter.bump,
    )]
    pub adapter: Box<Account<'info, MeteoraMockAdapter>>,

    #[account(
        mut,
        address = adapter.usdc_pool @ PpnError::MintMismatch,
    )]
    pub adapter_pool: Box<Account<'info, TokenAccount>>,

    /// CHECK: validated by CPI into vault::exit_active.
    #[account(mut, address = note.trax_vault @ PpnError::MintMismatch)]
    pub vault: UncheckedAccount<'info>,

    /// CHECK: validated by CPI.
    #[account(mut, address = note.trax_mint @ PpnError::MintMismatch)]
    pub trax_mint: UncheckedAccount<'info>,

    /// CHECK: validated by CPI.
    #[account(mut)]
    pub vault_usdc_vault: UncheckedAccount<'info>,

    #[account(
        mut,
        constraint = note_trax_ata.mint == note.trax_mint @ PpnError::MintMismatch,
        constraint = note_trax_ata.owner == note.key(),
    )]
    pub note_trax_ata: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        constraint = note_usdc_ata.mint == note.usdc_mint @ PpnError::MintMismatch,
        constraint = note_usdc_ata.owner == note.key(),
    )]
    pub note_usdc_ata: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        constraint = owner_usdc_ata.mint == note.usdc_mint @ PpnError::MintMismatch,
        constraint = owner_usdc_ata.owner == owner.key(),
    )]
    pub owner_usdc_ata: Box<Account<'info, TokenAccount>>,

    /// CHECK: validated by vault CPI (when used) + we send the PPN strategy
    /// fee here directly. Must be the USDC ATA owned by vault.fee_recipient.
    #[account(mut)]
    pub fee_recipient_ata: UncheckedAccount<'info>,

    pub usdc_mint: Box<Account<'info, Mint>>,
    pub traxis_vault_program: Program<'info, TraxisVault>,
    pub token_program: Program<'info, Token>,
}

pub fn handler(
    ctx: Context<CloseEarly>,
    strategy_fee_bps: u16,
    min_proceeds_usdc: u64,
) -> Result<()> {
    require!(
        ctx.accounts.note.state == PpnState::Active,
        PpnError::AlreadyRedeemed,
    );
    require!(strategy_fee_bps <= 100, PpnError::InvalidStrategyFee);

    let principal = ctx.accounts.note.principal_usdc;
    let trax_to_exit = ctx.accounts.note.trax_holdings;
    let note_owner = ctx.accounts.note.owner;
    let note_seed = ctx.accounts.note.note_seed;
    let note_bump = ctx.accounts.note.bump;
    let note_key = ctx.accounts.note.key();
    let adapter_bump = ctx.accounts.adapter.bump;

    let note_bump_arr = [note_bump];
    let note_seeds: [&[u8]; 4] = [
        PpnNote::SEED,
        note_owner.as_ref(),
        note_seed.as_ref(),
        note_bump_arr.as_ref(),
    ];
    let note_seeds_slice: &[&[&[u8]]] = &[&note_seeds];

    // Step 1: basket sleeve — CPI into vault::exit_active if we have TRAX.
    //         USDC lands in note_usdc_ata (net of vault's 30 bps).
    let basket_payout: u64 = if trax_to_exit > 0 {
        let usdc_before = ctx.accounts.note_usdc_ata.amount;
        let cpi_accounts = VaultExitActive {
            user: ctx.accounts.note.to_account_info(),
            vault: ctx.accounts.vault.to_account_info(),
            trax_mint: ctx.accounts.trax_mint.to_account_info(),
            usdc_vault: ctx.accounts.vault_usdc_vault.to_account_info(),
            user_trax_ata: ctx.accounts.note_trax_ata.to_account_info(),
            user_usdc_ata: ctx.accounts.note_usdc_ata.to_account_info(),
            fee_recipient_ata: ctx.accounts.fee_recipient_ata.to_account_info(),
            token_program: ctx.accounts.token_program.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.traxis_vault_program.to_account_info(),
            cpi_accounts,
            note_seeds_slice,
        );
        traxis_vault::cpi::exit_active(cpi_ctx, trax_to_exit)?;
        ctx.accounts.note_usdc_ata.reload()?;
        ctx.accounts
            .note_usdc_ata
            .amount
            .checked_sub(usdc_before)
            .ok_or(PpnError::ArithOverflow)?
    } else {
        0
    };

    // Step 2: principal sleeve — adapter_pool → note_usdc_ata, adapter PDA signs.
    //         Mock adapter doesn't charge a penalty; a real one might, which
    //         would flow through as < principal paid out.
    if principal > 0 {
        require!(
            ctx.accounts.adapter_pool.amount >= principal,
            PpnError::InsufficientPool,
        );
        let bump_arr = [adapter_bump];
        let signer_seeds: [&[u8]; 2] = [MeteoraMockAdapter::SEED, bump_arr.as_ref()];
        let seeds_slice: &[&[&[u8]]] = &[&signer_seeds];

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.adapter_pool.to_account_info(),
                    to: ctx.accounts.note_usdc_ata.to_account_info(),
                    authority: ctx.accounts.adapter.to_account_info(),
                },
                seeds_slice,
            ),
            principal,
        )?;

        let adapter_mut = &mut ctx.accounts.adapter;
        adapter_mut.total_principal =
            adapter_mut.total_principal.saturating_sub(principal);
    }

    // Step 3: combine in note_usdc_ata, deduct PPN strategy fee, pay owner.
    let gross = basket_payout
        .checked_add(principal)
        .ok_or(PpnError::ArithOverflow)?;

    let strategy_fee = (gross as u128)
        .checked_mul(strategy_fee_bps as u128)
        .ok_or(PpnError::ArithOverflow)?
        .checked_div(BPS as u128)
        .ok_or(PpnError::ArithOverflow)? as u64;
    let net = gross
        .checked_sub(strategy_fee)
        .ok_or(PpnError::ArithOverflow)?;

    require!(net >= min_proceeds_usdc, PpnError::SlippageExceeded);

    if strategy_fee > 0 {
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.note_usdc_ata.to_account_info(),
                    to: ctx.accounts.fee_recipient_ata.to_account_info(),
                    authority: ctx.accounts.note.to_account_info(),
                },
                note_seeds_slice,
            ),
            strategy_fee,
        )?;
    }

    if net > 0 {
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.note_usdc_ata.to_account_info(),
                    to: ctx.accounts.owner_usdc_ata.to_account_info(),
                    authority: ctx.accounts.note.to_account_info(),
                },
                note_seeds_slice,
            ),
            net,
        )?;
    }

    let note_mut = &mut ctx.accounts.note;
    note_mut.state = PpnState::Redeemed;
    note_mut.trax_holdings = 0;

    emit!(NoteClosedEarly {
        note: note_key,
        owner: note_owner,
        basket_usdc: basket_payout,
        principal_usdc: principal,
        strategy_fee_usdc: strategy_fee,
        net_to_owner_usdc: net,
    });

    Ok(())
}

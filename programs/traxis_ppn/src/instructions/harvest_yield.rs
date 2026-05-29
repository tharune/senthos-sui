use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use traxis_vault::cpi::accounts::Deposit as VaultDeposit;
use traxis_vault::program::TraxisVault;

use crate::errors::PpnError;
use crate::events::YieldHarvested;
use crate::state::{MeteoraMockAdapter, PpnNote, PpnState, BPS, SECONDS_PER_YEAR};

/// Compute yield accrued on `principal` for `elapsed_secs` at `apy_bps`.
/// Returns None on overflow (callers surface ArithOverflow).
fn compute_yield(principal: u64, apy_bps: u64, elapsed_secs: u64) -> Option<u64> {
    let numerator = (principal as u128)
        .checked_mul(apy_bps as u128)?
        .checked_mul(elapsed_secs as u128)?;
    let denominator = (BPS as u128).checked_mul(SECONDS_PER_YEAR as u128)?;
    let result = numerator.checked_div(denominator)?;
    if result > u64::MAX as u128 {
        None
    } else {
        Some(result as u64)
    }
}

#[derive(Accounts)]
pub struct HarvestYield<'info> {
    #[account(mut)]
    pub cranker: Signer<'info>,

    #[account(
        mut,
        seeds = [PpnNote::SEED, note.owner.as_ref(), note.note_seed.as_ref()],
        bump = note.bump,
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

    #[account(
        mut,
        constraint = note_usdc_ata.mint == note.usdc_mint @ PpnError::MintMismatch,
        constraint = note_usdc_ata.owner == note.key(),
    )]
    pub note_usdc_ata: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        constraint = note_trax_ata.mint == note.trax_mint @ PpnError::MintMismatch,
        constraint = note_trax_ata.owner == note.key(),
    )]
    pub note_trax_ata: Box<Account<'info, TokenAccount>>,

    /// CHECK: validated by CPI.
    #[account(mut, address = note.trax_vault @ PpnError::MintMismatch)]
    pub vault: UncheckedAccount<'info>,

    /// CHECK: validated by CPI.
    #[account(mut, address = note.trax_mint @ PpnError::MintMismatch)]
    pub trax_mint: UncheckedAccount<'info>,

    /// CHECK: validated by CPI.
    #[account(mut)]
    pub vault_usdc_vault: UncheckedAccount<'info>,

    /// CHECK: validated by CPI.
    #[account(mut)]
    pub fee_recipient_ata: UncheckedAccount<'info>,

    pub usdc_mint: Box<Account<'info, Mint>>,
    pub traxis_vault_program: Program<'info, TraxisVault>,
    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<HarvestYield>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    require!(
        ctx.accounts.note.state == PpnState::Active,
        PpnError::AlreadyRedeemed
    );

    // Copy fields.
    let principal_usdc = ctx.accounts.note.principal_usdc;
    let last_harvest_ts = ctx.accounts.note.last_harvest_ts;
    let apy_bps = ctx.accounts.adapter.apy_bps as u64;
    let adapter_bump = ctx.accounts.adapter.bump;
    let note_owner = ctx.accounts.note.owner;
    let note_seed = ctx.accounts.note.note_seed;
    let note_bump = ctx.accounts.note.bump;
    let note_key = ctx.accounts.note.key();

    let elapsed = now.saturating_sub(last_harvest_ts) as u64;
    let yield_usdc = compute_yield(principal_usdc, apy_bps, elapsed)
        .ok_or(PpnError::ArithOverflow)?;

    require!(yield_usdc > 0, PpnError::NoYield);
    require!(
        ctx.accounts.adapter_pool.amount >= yield_usdc,
        PpnError::InsufficientPool
    );

    // 1. Mock Meteora withdraw: adapter pool → note's intermediate USDC ATA.
    let adapter_bump_arr = [adapter_bump];
    let adapter_seeds: [&[u8]; 2] = [MeteoraMockAdapter::SEED, adapter_bump_arr.as_ref()];
    let adapter_seeds_slice: &[&[&[u8]]] = &[&adapter_seeds];
    anchor_spl::token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            anchor_spl::token::Transfer {
                from: ctx.accounts.adapter_pool.to_account_info(),
                to: ctx.accounts.note_usdc_ata.to_account_info(),
                authority: ctx.accounts.adapter.to_account_info(),
            },
            adapter_seeds_slice,
        ),
        yield_usdc,
    )?;

    // 2. CPI traxis_vault::deposit — note is the "user" here, signed by note PDA.
    let trax_balance_before = ctx.accounts.note_trax_ata.amount;
    let note_bump_arr = [note_bump];
    let note_seeds: [&[u8]; 4] = [
        PpnNote::SEED,
        note_owner.as_ref(),
        note_seed.as_ref(),
        note_bump_arr.as_ref(),
    ];
    let note_seeds_slice: &[&[&[u8]]] = &[&note_seeds];

    let cpi_accounts = VaultDeposit {
        user: ctx.accounts.note.to_account_info(),
        vault: ctx.accounts.vault.to_account_info(),
        trax_mint: ctx.accounts.trax_mint.to_account_info(),
        usdc_vault: ctx.accounts.vault_usdc_vault.to_account_info(),
        user_usdc_ata: ctx.accounts.note_usdc_ata.to_account_info(),
        user_trax_ata: ctx.accounts.note_trax_ata.to_account_info(),
        fee_recipient_ata: ctx.accounts.fee_recipient_ata.to_account_info(),
        token_program: ctx.accounts.token_program.to_account_info(),
    };
    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.traxis_vault_program.to_account_info(),
        cpi_accounts,
        note_seeds_slice,
    );
    traxis_vault::cpi::deposit(cpi_ctx, yield_usdc)?;

    // Reload note TRAX balance post-CPI.
    ctx.accounts.note_trax_ata.reload()?;
    let trax_received = ctx
        .accounts
        .note_trax_ata
        .amount
        .saturating_sub(trax_balance_before);

    let note_mut = &mut ctx.accounts.note;
    note_mut.last_harvest_ts = now;
    note_mut.yield_harvested_usdc = note_mut
        .yield_harvested_usdc
        .checked_add(yield_usdc)
        .ok_or(PpnError::ArithOverflow)?;
    note_mut.trax_holdings = note_mut
        .trax_holdings
        .checked_add(trax_received)
        .ok_or(PpnError::ArithOverflow)?;

    emit!(YieldHarvested {
        note: note_key,
        yield_usdc,
        trax_received,
        timestamp: now,
    });

    Ok(())
}

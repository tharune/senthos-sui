use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

use traxis_vault::cpi::accounts::ExitActive as VaultExitActive;
use traxis_vault::program::TraxisVault;

use crate::errors::PpnError;
use crate::events::NoteDivested;
use crate::state::{PpnNote, PpnState, BPS};

/// Exit the basket sleeve only. The PPN note's TRAX holdings are sold back
/// to the vault via CPI into `traxis_vault::exit_active`, the resulting USDC
/// is routed to the owner net of a protocol strategy fee, and the note's
/// principal stays deployed in the yield adapter until `close_early` or
/// `redeem_at_maturity`.
///
/// Note stays `Active`; only `trax_holdings` is zeroed. Subsequent
/// `harvest_yield` calls still work — they'll rebuild `trax_holdings` from
/// accrued yield, giving the user a way to re-enter the basket if they want.
///
/// Fee stack (as applied to the gross exit_active payout):
///   1. Vault charges `EARLY_EXIT_FEE_BPS` (30 bps) via its own
///      fee_recipient_ata — this happens inside the CPI.
///   2. PPN charges `STRATEGY_FEE_BPS_ONCHAIN` (5 bps, args-driven) on the
///      net amount that hit `note_usdc_ata` — this is the fee controlled
///      by this instruction.
#[derive(Accounts)]
pub struct Divest<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        mut,
        seeds = [PpnNote::SEED, owner.key().as_ref(), note.note_seed.as_ref()],
        bump = note.bump,
        has_one = owner @ PpnError::Unauthorized,
    )]
    pub note: Box<Account<'info, PpnNote>>,

    /// CHECK: validated by CPI into vault::exit_active (seeds match trax_vault).
    #[account(mut, address = note.trax_vault @ PpnError::MintMismatch)]
    pub vault: UncheckedAccount<'info>,

    /// CHECK: validated by CPI (vault constrains `vault.trax_mint == trax_mint`).
    #[account(mut, address = note.trax_mint @ PpnError::MintMismatch)]
    pub trax_mint: UncheckedAccount<'info>,

    /// CHECK: validated by CPI (vault's internal USDC pool).
    #[account(mut)]
    pub vault_usdc_vault: UncheckedAccount<'info>,

    /// Note's TRAX ATA — burned by the exit_active CPI.
    #[account(
        mut,
        constraint = note_trax_ata.mint == note.trax_mint @ PpnError::MintMismatch,
        constraint = note_trax_ata.owner == note.key(),
    )]
    pub note_trax_ata: Box<Account<'info, TokenAccount>>,

    /// Note's USDC ATA — staging account where exit_active pays and PPN
    /// then splits between owner + fee recipient.
    #[account(
        mut,
        constraint = note_usdc_ata.mint == note.usdc_mint @ PpnError::MintMismatch,
        constraint = note_usdc_ata.owner == note.key(),
    )]
    pub note_usdc_ata: Box<Account<'info, TokenAccount>>,

    /// Owner's USDC ATA — receives net payout.
    #[account(
        mut,
        constraint = owner_usdc_ata.mint == note.usdc_mint @ PpnError::MintMismatch,
        constraint = owner_usdc_ata.owner == owner.key(),
    )]
    pub owner_usdc_ata: Box<Account<'info, TokenAccount>>,

    /// CHECK: validated by the vault CPI (vault enforces
    /// `fee_recipient_ata.owner == vault.fee_recipient`). Reused for the
    /// PPN strategy fee transfer below so we keep a single treasury wallet.
    #[account(mut)]
    pub fee_recipient_ata: UncheckedAccount<'info>,

    pub usdc_mint: Box<Account<'info, Mint>>,
    pub traxis_vault_program: Program<'info, TraxisVault>,
    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<Divest>, strategy_fee_bps: u16) -> Result<()> {
    require!(
        ctx.accounts.note.state == PpnState::Active,
        PpnError::AlreadyRedeemed,
    );
    require!(strategy_fee_bps <= 100, PpnError::InvalidStrategyFee);
    require!(
        ctx.accounts.note.trax_holdings > 0,
        PpnError::NothingToDivest,
    );

    // Copy fields for CPI signer seeds.
    let note_owner = ctx.accounts.note.owner;
    let note_seed = ctx.accounts.note.note_seed;
    let note_bump = ctx.accounts.note.bump;
    let note_key = ctx.accounts.note.key();
    let trax_to_exit = ctx.accounts.note.trax_holdings;

    // Snapshot USDC balance before CPI so we know exactly what was paid.
    let usdc_before = ctx.accounts.note_usdc_ata.amount;

    // Build note PDA signer seeds.
    let note_bump_arr = [note_bump];
    let note_seeds: [&[u8]; 4] = [
        PpnNote::SEED,
        note_owner.as_ref(),
        note_seed.as_ref(),
        note_bump_arr.as_ref(),
    ];
    let note_seeds_slice: &[&[&[u8]]] = &[&note_seeds];

    // CPI: vault::exit_active. The note PDA signs as `user`; the note's
    // TRAX is burned; the vault pays USDC (net of its 30 bps fee) to
    // note_usdc_ata; the vault's early-exit fee lands in fee_recipient_ata.
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

    // Reload note_usdc_ata to see what the vault CPI paid out.
    ctx.accounts.note_usdc_ata.reload()?;
    let net_from_vault = ctx
        .accounts
        .note_usdc_ata
        .amount
        .checked_sub(usdc_before)
        .ok_or(PpnError::ArithOverflow)?;

    // PPN strategy fee on top of whatever landed.
    let strategy_fee = (net_from_vault as u128)
        .checked_mul(strategy_fee_bps as u128)
        .ok_or(PpnError::ArithOverflow)?
        .checked_div(BPS as u128)
        .ok_or(PpnError::ArithOverflow)? as u64;
    let to_owner = net_from_vault
        .checked_sub(strategy_fee)
        .ok_or(PpnError::ArithOverflow)?;

    // Transfer fee (if any) from note_usdc_ata → fee_recipient_ata, note PDA signs.
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

    // Transfer remainder from note_usdc_ata → owner_usdc_ata.
    if to_owner > 0 {
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
            to_owner,
        )?;
    }

    let note_mut = &mut ctx.accounts.note;
    note_mut.trax_holdings = 0;

    emit!(NoteDivested {
        note: note_key,
        owner: note_owner,
        trax_burned: trax_to_exit,
        gross_usdc: net_from_vault, // net of vault's 30 bps, pre-PPN strategy
        strategy_fee_usdc: strategy_fee,
        net_to_owner_usdc: to_owner,
    });

    Ok(())
}

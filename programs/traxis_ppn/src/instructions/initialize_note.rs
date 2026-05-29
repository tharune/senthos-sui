use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

use crate::errors::PpnError;
use crate::events::NoteInitialized;
use crate::state::{MeteoraMockAdapter, PpnNote, PpnState};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct InitializeNoteArgs {
    pub note_seed: [u8; 8],
    pub principal_usdc: u64,
    pub maturity_ts: i64,
}

#[derive(Accounts)]
#[instruction(args: InitializeNoteArgs)]
pub struct InitializeNote<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        init,
        payer = owner,
        space = PpnNote::SIZE,
        seeds = [PpnNote::SEED, owner.key().as_ref(), args.note_seed.as_ref()],
        bump,
    )]
    pub note: Account<'info, PpnNote>,

    #[account(
        mut,
        seeds = [MeteoraMockAdapter::SEED],
        bump = adapter.bump,
    )]
    pub adapter: Account<'info, MeteoraMockAdapter>,

    #[account(
        mut,
        address = adapter.usdc_pool @ PpnError::MintMismatch,
    )]
    pub adapter_pool: Account<'info, TokenAccount>,

    #[account(
        address = adapter.usdc_mint @ PpnError::MintMismatch,
    )]
    pub usdc_mint: Account<'info, Mint>,

    #[account(
        mut,
        constraint = owner_usdc_ata.mint == adapter.usdc_mint @ PpnError::MintMismatch,
        constraint = owner_usdc_ata.owner == owner.key(),
    )]
    pub owner_usdc_ata: Account<'info, TokenAccount>,

    /// CHECK: Just a pubkey recorded on the note. Validated at harvest_yield time
    /// when we CPI into traxis_vault::deposit.
    pub trax_vault: UncheckedAccount<'info>,

    /// CHECK: Same. The mint owned by `trax_vault`.
    pub trax_mint: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<InitializeNote>, args: InitializeNoteArgs) -> Result<()> {
    require!(args.principal_usdc > 0, PpnError::ZeroPrincipal);
    let now = Clock::get()?.unix_timestamp;
    require!(args.maturity_ts > now, PpnError::InvalidMaturity);

    // Transfer principal: owner USDC → adapter pool.
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.owner_usdc_ata.to_account_info(),
                to: ctx.accounts.adapter_pool.to_account_info(),
                authority: ctx.accounts.owner.to_account_info(),
            },
        ),
        args.principal_usdc,
    )?;

    // Record on the mock adapter.
    let adapter = &mut ctx.accounts.adapter;
    adapter.total_principal = adapter
        .total_principal
        .checked_add(args.principal_usdc)
        .ok_or(PpnError::ArithOverflow)?;

    let note = &mut ctx.accounts.note;
    note.owner = ctx.accounts.owner.key();
    note.note_seed = args.note_seed;
    note.principal_usdc = args.principal_usdc;
    note.yield_harvested_usdc = 0;
    note.trax_mint = ctx.accounts.trax_mint.key();
    note.trax_holdings = 0;
    note.trax_vault = ctx.accounts.trax_vault.key();
    note.usdc_mint = ctx.accounts.usdc_mint.key();
    note.maturity_ts = args.maturity_ts;
    note.last_harvest_ts = now;
    note.state = PpnState::Active;
    note.bump = ctx.bumps.note;
    note._reserved = [0u8; 64];

    emit!(NoteInitialized {
        note: note.key(),
        owner: note.owner,
        principal_usdc: note.principal_usdc,
        maturity_ts: note.maturity_ts,
        trax_vault: note.trax_vault,
    });

    Ok(())
}

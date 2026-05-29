use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::errors::PpnError;
use crate::events::NoteRedeemed;
use crate::state::{MeteoraMockAdapter, PpnNote, PpnState};

#[derive(Accounts)]
pub struct RedeemAtMaturity<'info> {
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

    #[account(
        mut,
        constraint = owner_usdc_ata.mint == note.usdc_mint @ PpnError::MintMismatch,
        constraint = owner_usdc_ata.owner == owner.key(),
    )]
    pub owner_usdc_ata: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        constraint = owner_trax_ata.mint == note.trax_mint @ PpnError::MintMismatch,
        constraint = owner_trax_ata.owner == owner.key(),
    )]
    pub owner_trax_ata: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        constraint = note_trax_ata.mint == note.trax_mint @ PpnError::MintMismatch,
        constraint = note_trax_ata.owner == note.key(),
    )]
    pub note_trax_ata: Box<Account<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<RedeemAtMaturity>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    require!(
        ctx.accounts.note.state == PpnState::Active,
        PpnError::AlreadyRedeemed
    );
    require!(now >= ctx.accounts.note.maturity_ts, PpnError::NotMatured);

    // Copy fields.
    let principal = ctx.accounts.note.principal_usdc;
    let trax_holdings = ctx.accounts.note.trax_holdings;
    let adapter_bump = ctx.accounts.adapter.bump;
    let note_owner = ctx.accounts.note.owner;
    let note_seed = ctx.accounts.note.note_seed;
    let note_bump = ctx.accounts.note.bump;
    let note_key = ctx.accounts.note.key();

    // 1. Mock Meteora: adapter pool → owner USDC ATA.
    if principal > 0 {
        require!(
            ctx.accounts.adapter_pool.amount >= principal,
            PpnError::InsufficientPool
        );
        let bump_arr = [adapter_bump];
        let signer_seeds: [&[u8]; 2] = [MeteoraMockAdapter::SEED, bump_arr.as_ref()];
        let seeds_slice: &[&[&[u8]]] = &[&signer_seeds];

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.adapter_pool.to_account_info(),
                    to: ctx.accounts.owner_usdc_ata.to_account_info(),
                    authority: ctx.accounts.adapter.to_account_info(),
                },
                seeds_slice,
            ),
            principal,
        )?;

        let adapter_mut = &mut ctx.accounts.adapter;
        adapter_mut.total_principal = adapter_mut.total_principal.saturating_sub(principal);
    }

    // 2. Transfer TRAX holdings from note's ATA → owner's TRAX ATA, signed by note PDA.
    if trax_holdings > 0 {
        let bump_arr = [note_bump];
        let signer_seeds: [&[u8]; 4] = [
            PpnNote::SEED,
            note_owner.as_ref(),
            note_seed.as_ref(),
            bump_arr.as_ref(),
        ];
        let seeds_slice: &[&[&[u8]]] = &[&signer_seeds];

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.note_trax_ata.to_account_info(),
                    to: ctx.accounts.owner_trax_ata.to_account_info(),
                    authority: ctx.accounts.note.to_account_info(),
                },
                seeds_slice,
            ),
            trax_holdings,
        )?;
    }

    let note_mut = &mut ctx.accounts.note;
    note_mut.state = PpnState::Redeemed;

    emit!(NoteRedeemed {
        note: note_key,
        owner: note_owner,
        principal_returned: principal,
        trax_transferred: trax_holdings,
    });

    Ok(())
}

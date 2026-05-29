use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::errors::PpnError;
use crate::events::MockAdapterInitialized;
use crate::state::MeteoraMockAdapter;

#[derive(Accounts)]
pub struct InitializeMockAdapter<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = MeteoraMockAdapter::SIZE,
        seeds = [MeteoraMockAdapter::SEED],
        bump,
    )]
    pub adapter: Account<'info, MeteoraMockAdapter>,

    pub usdc_mint: Account<'info, Mint>,

    #[account(
        init,
        payer = authority,
        seeds = [MeteoraMockAdapter::POOL_SEED],
        bump,
        token::mint = usdc_mint,
        token::authority = adapter,
    )]
    pub usdc_pool: Account<'info, TokenAccount>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handler(ctx: Context<InitializeMockAdapter>, apy_bps: u16) -> Result<()> {
    require!(apy_bps <= 5000, PpnError::InvalidApy);

    let adapter = &mut ctx.accounts.adapter;
    adapter.authority = ctx.accounts.authority.key();
    adapter.usdc_mint = ctx.accounts.usdc_mint.key();
    adapter.usdc_pool = ctx.accounts.usdc_pool.key();
    adapter.apy_bps = apy_bps;
    adapter.total_principal = 0;
    adapter.bump = ctx.bumps.adapter;
    adapter._reserved = [0u8; 32];

    emit!(MockAdapterInitialized {
        adapter: adapter.key(),
        apy_bps,
        usdc_mint: adapter.usdc_mint,
    });

    Ok(())
}

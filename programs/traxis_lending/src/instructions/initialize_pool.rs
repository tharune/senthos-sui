use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{Mint, Token, TokenAccount},
};

use crate::{events::PoolInitialized, state::LendingPool};

/// One-time bootstrap of the global USDC lending pool.
#[derive(Accounts)]
pub struct InitializePool<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = LendingPool::SIZE,
        seeds = [LendingPool::SEED],
        bump
    )]
    pub pool: Account<'info, LendingPool>,

    pub usdc_mint: Account<'info, Mint>,

    #[account(
        init,
        payer = authority,
        associated_token::mint = usdc_mint,
        associated_token::authority = pool,
    )]
    pub usdc_pool: Account<'info, TokenAccount>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handler(ctx: Context<InitializePool>, reserve_factor_bps: u16) -> Result<()> {
    let pool = &mut ctx.accounts.pool;
    pool.authority = ctx.accounts.authority.key();
    pool.usdc_mint = ctx.accounts.usdc_mint.key();
    pool.usdc_pool = ctx.accounts.usdc_pool.key();
    pool.total_deposits = 0;
    pool.total_borrows = 0;
    pool.accumulated_reserves = 0;
    pool.reserve_factor_bps = reserve_factor_bps;
    pool.last_accrual_ts = Clock::get()?.unix_timestamp;
    pool.bump = ctx.bumps.pool;

    emit!(PoolInitialized {
        authority: pool.authority,
        usdc_mint: pool.usdc_mint,
        reserve_factor_bps,
    });
    Ok(())
}

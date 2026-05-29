use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::{errors::LendingError, events::Withdrawn, state::{LendingPool, SupplierPosition}};

/// Withdraw USDC from the pool. For the hackathon the interest calc is a
/// simplified "paid on withdrawal" model — in a full impl we'd use the
/// exchange-rate scheme (cTokens) for interest-bearing shares.
#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut)]
    pub supplier: Signer<'info>,

    #[account(
        mut,
        seeds = [LendingPool::SEED],
        bump = pool.bump,
    )]
    pub pool: Account<'info, LendingPool>,

    #[account(
        mut,
        seeds = [SupplierPosition::SEED, supplier.key().as_ref()],
        bump = position.bump,
        constraint = position.supplier == supplier.key(),
    )]
    pub position: Account<'info, SupplierPosition>,

    #[account(
        mut,
        constraint = supplier_usdc_ata.owner == supplier.key(),
        constraint = supplier_usdc_ata.mint == pool.usdc_mint,
    )]
    pub supplier_usdc_ata: Account<'info, TokenAccount>,

    #[account(
        mut,
        address = pool.usdc_pool,
    )]
    pub usdc_pool: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<Withdraw>, amount_usdc: u64) -> Result<()> {
    require!(amount_usdc > 0, LendingError::ZeroAmount);

    let pos = &mut ctx.accounts.position;
    require!(
        pos.deposited_usdc >= amount_usdc,
        LendingError::InsufficientSupplierBalance
    );

    let pool = &mut ctx.accounts.pool;

    // Pool must have liquidity (outstanding borrows tie up USDC). Only the
    // un-borrowed fraction is withdrawable at any given time.
    let available = pool
        .total_deposits
        .saturating_sub(pool.total_borrows);
    require!(available >= amount_usdc, LendingError::InsufficientLiquidity);

    let pool_seeds: &[&[u8]] = &[LendingPool::SEED, &[pool.bump]];
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.usdc_pool.to_account_info(),
                to: ctx.accounts.supplier_usdc_ata.to_account_info(),
                authority: pool.to_account_info(),
            },
            &[pool_seeds],
        ),
        amount_usdc,
    )?;

    pos.deposited_usdc = pos.deposited_usdc.saturating_sub(amount_usdc);
    pool.total_deposits = pool.total_deposits.saturating_sub(amount_usdc);

    emit!(Withdrawn {
        supplier: pos.supplier,
        amount_usdc,
        interest_paid: 0, // TODO: implement exchange-rate-based interest
        new_total_deposits: pool.total_deposits,
    });
    Ok(())
}

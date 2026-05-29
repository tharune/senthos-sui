use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::{errors::LendingError, events::Supplied, state::{LendingPool, SupplierPosition}};

/// Deposit USDC into the pool and open (or top up) the caller's
/// SupplierPosition.
#[derive(Accounts)]
pub struct Supply<'info> {
    #[account(mut)]
    pub supplier: Signer<'info>,

    #[account(
        mut,
        seeds = [LendingPool::SEED],
        bump = pool.bump,
    )]
    pub pool: Account<'info, LendingPool>,

    #[account(
        init_if_needed,
        payer = supplier,
        space = SupplierPosition::SIZE,
        seeds = [SupplierPosition::SEED, supplier.key().as_ref()],
        bump,
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

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<Supply>, amount_usdc: u64) -> Result<()> {
    require!(amount_usdc > 0, LendingError::ZeroAmount);

    // Transfer USDC from supplier to the pool.
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.supplier_usdc_ata.to_account_info(),
                to: ctx.accounts.usdc_pool.to_account_info(),
                authority: ctx.accounts.supplier.to_account_info(),
            },
        ),
        amount_usdc,
    )?;

    let pool = &mut ctx.accounts.pool;
    pool.total_deposits = pool
        .total_deposits
        .checked_add(amount_usdc)
        .ok_or(LendingError::ArithmeticOverflow)?;

    let pos = &mut ctx.accounts.position;
    if pos.supplier == Pubkey::default() {
        pos.supplier = ctx.accounts.supplier.key();
        pos.entry_total_deposits = pool.total_deposits;
        pos.bump = ctx.bumps.position;
    }
    pos.deposited_usdc = pos
        .deposited_usdc
        .checked_add(amount_usdc)
        .ok_or(LendingError::ArithmeticOverflow)?;

    emit!(Supplied {
        supplier: pos.supplier,
        amount_usdc,
        new_total_deposits: pool.total_deposits,
    });
    Ok(())
}

use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self, Mint, Token, TokenAccount, Transfer},
};

use crate::{errors::LendingError, events::LoanOpened, state::{LendingPool, Loan}};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug)]
pub struct OpenLoanArgs {
    /// Collateral units (base units of the collateral mint).
    pub collateral_amount: u64,
    /// USDC base units to borrow.
    pub borrow_amount: u64,
    /// Loan-to-value for this collateral (bps). Validated off-chain against
    /// the collateral's tier; the program just enforces
    /// `borrow <= collateral_value * ltv_bps / 10_000`.
    ///
    /// `collateral_value_usdc` is trusted as passed by the caller for the
    /// hackathon; a production impl would read a price oracle PDA.
    pub ltv_bps: u16,
    pub collateral_value_usdc: u64,
    /// Snapshot of the borrow APY at open time, in bps. Off-chain caller
    /// computes from pool utilization.
    pub borrow_apy_bps: u16,
    /// 8-byte seed so a borrower can open multiple loans against the same
    /// collateral mint.
    pub loan_seed: [u8; 8],
}

#[derive(Accounts)]
#[instruction(args: OpenLoanArgs)]
pub struct OpenLoan<'info> {
    #[account(mut)]
    pub borrower: Signer<'info>,

    #[account(
        mut,
        seeds = [LendingPool::SEED],
        bump = pool.bump,
    )]
    pub pool: Account<'info, LendingPool>,

    #[account(
        init,
        payer = borrower,
        space = Loan::SIZE,
        seeds = [Loan::SEED, borrower.key().as_ref(), &args.loan_seed],
        bump,
    )]
    pub loan: Account<'info, Loan>,

    pub collateral_mint: Account<'info, Mint>,

    #[account(
        mut,
        constraint = borrower_collateral_ata.owner == borrower.key(),
        constraint = borrower_collateral_ata.mint == collateral_mint.key(),
    )]
    pub borrower_collateral_ata: Account<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = borrower,
        associated_token::mint = collateral_mint,
        associated_token::authority = loan,
    )]
    pub collateral_vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = borrower_usdc_ata.owner == borrower.key(),
        constraint = borrower_usdc_ata.mint == pool.usdc_mint,
    )]
    pub borrower_usdc_ata: Account<'info, TokenAccount>,

    #[account(
        mut,
        address = pool.usdc_pool,
    )]
    pub usdc_pool: Account<'info, TokenAccount>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handler(ctx: Context<OpenLoan>, args: OpenLoanArgs) -> Result<()> {
    require!(args.collateral_amount > 0, LendingError::ZeroAmount);
    require!(args.borrow_amount > 0, LendingError::ZeroAmount);

    // LTV guard. collateral_value * ltv_bps / 10_000 >= borrow_amount.
    let max_borrow = (args.collateral_value_usdc as u128)
        .checked_mul(args.ltv_bps as u128)
        .ok_or(LendingError::InsufficientCollateral)?
        / crate::state::BPS as u128;
    require!(
        (args.borrow_amount as u128) <= max_borrow,
        LendingError::InsufficientCollateral
    );

    // Pool must have enough liquidity.
    let pool = &mut ctx.accounts.pool;
    let available = pool
        .total_deposits
        .saturating_sub(pool.total_borrows);
    require!(
        available >= args.borrow_amount,
        LendingError::InsufficientLiquidity
    );

    // Escrow collateral → loan's PDA ATA.
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.borrower_collateral_ata.to_account_info(),
                to: ctx.accounts.collateral_vault.to_account_info(),
                authority: ctx.accounts.borrower.to_account_info(),
            },
        ),
        args.collateral_amount,
    )?;

    // Wire USDC from the pool → borrower.
    let pool_seeds: &[&[u8]] = &[LendingPool::SEED, &[pool.bump]];
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.usdc_pool.to_account_info(),
                to: ctx.accounts.borrower_usdc_ata.to_account_info(),
                authority: pool.to_account_info(),
            },
            &[pool_seeds],
        ),
        args.borrow_amount,
    )?;

    pool.total_borrows = pool
        .total_borrows
        .checked_add(args.borrow_amount)
        .ok_or(LendingError::ArithmeticOverflow)?;

    let loan = &mut ctx.accounts.loan;
    loan.borrower = ctx.accounts.borrower.key();
    loan.collateral_mint = ctx.accounts.collateral_mint.key();
    loan.collateral_vault = ctx.accounts.collateral_vault.key();
    loan.collateral_amount = args.collateral_amount;
    loan.principal_borrowed = args.borrow_amount;
    loan.interest_accrued = 0;
    loan.opened_ts = Clock::get()?.unix_timestamp;
    loan.last_accrual_ts = loan.opened_ts;
    loan.borrow_apy_bps_at_open = args.borrow_apy_bps;
    loan.bump = ctx.bumps.loan;

    emit!(LoanOpened {
        borrower: loan.borrower,
        collateral_mint: loan.collateral_mint,
        collateral_amount: args.collateral_amount,
        principal_borrowed: args.borrow_amount,
        borrow_apy_bps: args.borrow_apy_bps,
    });
    Ok(())
}

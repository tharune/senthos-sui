use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::{
    errors::LendingError,
    events::LoanRepaid,
    state::{LendingPool, Loan, BPS, SECONDS_PER_YEAR},
};

/// Repay the loan in full. Partial repayments would follow the same shape
/// with an `amount` parameter and proportional collateral release — deferred
/// until the happy path lands.
#[derive(Accounts)]
pub struct RepayLoan<'info> {
    #[account(mut)]
    pub borrower: Signer<'info>,

    #[account(
        mut,
        seeds = [LendingPool::SEED],
        bump = pool.bump,
    )]
    pub pool: Account<'info, LendingPool>,

    #[account(
        mut,
        seeds = [Loan::SEED, borrower.key().as_ref(), &loan_seed],
        bump = loan.bump,
        constraint = loan.borrower == borrower.key() @ LendingError::NotLoanBorrower,
        close = borrower,
    )]
    pub loan: Account<'info, Loan>,

    /// Escrowed collateral ATA owned by the loan PDA; drained back to the
    /// borrower as part of repayment.
    #[account(
        mut,
        address = loan.collateral_vault,
    )]
    pub collateral_vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = borrower_collateral_ata.owner == borrower.key(),
        constraint = borrower_collateral_ata.mint == loan.collateral_mint,
    )]
    pub borrower_collateral_ata: Account<'info, TokenAccount>,

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

    pub token_program: Program<'info, Token>,
}

/// The PDA seeds need to be passed so we can re-derive + close the loan
/// account. An alternative is to store the seed on the loan state — we chose
/// to require it as a parameter for symmetry with `open_loan`.
pub fn handler(ctx: Context<RepayLoan>, loan_seed: [u8; 8]) -> Result<()> {
    // Accrue interest since last update.
    let now = Clock::get()?.unix_timestamp;
    let loan = &mut ctx.accounts.loan;
    let elapsed = (now - loan.last_accrual_ts).max(0) as u128;
    let interest = (loan.principal_borrowed as u128)
        .checked_mul(loan.borrow_apy_bps_at_open as u128)
        .and_then(|x| x.checked_mul(elapsed))
        .map(|x| x / (BPS as u128) / (SECONDS_PER_YEAR as u128))
        .unwrap_or(0);
    loan.interest_accrued = loan
        .interest_accrued
        .saturating_add(interest as u64);
    loan.last_accrual_ts = now;

    let total_repayment = loan
        .principal_borrowed
        .checked_add(loan.interest_accrued)
        .ok_or(LendingError::ArithmeticOverflow)?;

    // Pull USDC repayment → pool.
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.borrower_usdc_ata.to_account_info(),
                to: ctx.accounts.usdc_pool.to_account_info(),
                authority: ctx.accounts.borrower.to_account_info(),
            },
        ),
        total_repayment,
    )?;

    // Release escrowed collateral back to borrower.
    let borrower_key = ctx.accounts.borrower.key();
    let loan_bump = loan.bump;
    let seeds: &[&[u8]] = &[Loan::SEED, borrower_key.as_ref(), &loan_seed, &[loan_bump]];
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.collateral_vault.to_account_info(),
                to: ctx.accounts.borrower_collateral_ata.to_account_info(),
                authority: loan.to_account_info(),
            },
            &[seeds],
        ),
        loan.collateral_amount,
    )?;

    let pool = &mut ctx.accounts.pool;
    pool.total_borrows = pool
        .total_borrows
        .saturating_sub(loan.principal_borrowed);
    // Reserve factor: slice of interest allocated to treasury.
    let reserve_cut = (loan.interest_accrued as u128)
        .checked_mul(pool.reserve_factor_bps as u128)
        .map(|x| x / (BPS as u128))
        .unwrap_or(0) as u64;
    pool.accumulated_reserves = pool
        .accumulated_reserves
        .saturating_add(reserve_cut);
    // The non-reserve part grows total_deposits (interest accrues to lenders).
    pool.total_deposits = pool
        .total_deposits
        .saturating_add(loan.interest_accrued.saturating_sub(reserve_cut));

    emit!(LoanRepaid {
        borrower: loan.borrower,
        principal_repaid: loan.principal_borrowed,
        interest_paid: loan.interest_accrued,
        collateral_returned: loan.collateral_amount,
    });
    Ok(())
}

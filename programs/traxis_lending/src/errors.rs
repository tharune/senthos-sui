use anchor_lang::prelude::*;

#[error_code]
pub enum LendingError {
    #[msg("Amount must be greater than zero")]
    ZeroAmount,

    #[msg("Pool has insufficient liquidity")]
    InsufficientLiquidity,

    #[msg("Collateral value is not enough for requested borrow")]
    InsufficientCollateral,

    #[msg("Loan is still outstanding — repay first")]
    LoanStillOutstanding,

    #[msg("Loan is already closed")]
    LoanAlreadyClosed,

    #[msg("Caller is not the loan borrower")]
    NotLoanBorrower,

    #[msg("Caller is not the pool authority")]
    NotPoolAuthority,

    #[msg("Supplier position has insufficient balance for requested withdraw")]
    InsufficientSupplierBalance,

    #[msg("Arithmetic overflow")]
    ArithmeticOverflow,
}

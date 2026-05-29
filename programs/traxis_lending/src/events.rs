use anchor_lang::prelude::*;

#[event]
pub struct PoolInitialized {
    pub authority: Pubkey,
    pub usdc_mint: Pubkey,
    pub reserve_factor_bps: u16,
}

#[event]
pub struct Supplied {
    pub supplier: Pubkey,
    pub amount_usdc: u64,
    pub new_total_deposits: u64,
}

#[event]
pub struct Withdrawn {
    pub supplier: Pubkey,
    pub amount_usdc: u64,
    pub interest_paid: u64,
    pub new_total_deposits: u64,
}

#[event]
pub struct LoanOpened {
    pub borrower: Pubkey,
    pub collateral_mint: Pubkey,
    pub collateral_amount: u64,
    pub principal_borrowed: u64,
    pub borrow_apy_bps: u16,
}

#[event]
pub struct LoanRepaid {
    pub borrower: Pubkey,
    pub principal_repaid: u64,
    pub interest_paid: u64,
    pub collateral_returned: u64,
}

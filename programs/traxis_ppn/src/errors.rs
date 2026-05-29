use anchor_lang::prelude::*;

#[error_code]
pub enum PpnError {
    #[msg("Arithmetic overflow")]
    ArithOverflow,

    #[msg("Principal must be greater than zero")]
    ZeroPrincipal,

    #[msg("Maturity must be in the future")]
    InvalidMaturity,

    #[msg("Note has already been redeemed")]
    AlreadyRedeemed,

    #[msg("Note has not matured yet")]
    NotMatured,

    #[msg("Unauthorized")]
    Unauthorized,

    #[msg("APY bps must be <= 5000 (50%)")]
    InvalidApy,

    #[msg("Mint or token account mismatch")]
    MintMismatch,

    #[msg("No yield to harvest")]
    NoYield,

    #[msg("Mock pool lacks sufficient USDC to cover withdrawal")]
    InsufficientPool,

    #[msg("Strategy fee bps must be <= 100 (1%)")]
    InvalidStrategyFee,

    #[msg("Note has no basket exposure to divest")]
    NothingToDivest,

    #[msg("Net proceeds fell below min_proceeds_usdc")]
    SlippageExceeded,
}

use anchor_lang::prelude::*;

#[error_code]
pub enum TraxisError {
    #[msg("Arithmetic overflow")]
    ArithOverflow,

    #[msg("Vault is not in Active state")]
    VaultNotActive,

    #[msg("Vault is not in Finalized state")]
    VaultNotFinalized,

    #[msg("Vault already finalized")]
    VaultAlreadyFinalized,

    #[msg("Leg index out of range")]
    LegIndexOutOfRange,

    #[msg("Leg already resolved with a different outcome")]
    LegAlreadyResolved,

    #[msg("Leg weights must sum to 10000 bps")]
    InvalidLegWeights,

    #[msg("Invalid leg count: must be between 1 and 16")]
    InvalidLegCount,

    #[msg("Issue price must be in (0, 10000] bps")]
    InvalidIssuePrice,

    #[msg("Fee bps must be <= 500 (5%)")]
    InvalidFeeBps,

    #[msg("Invalid risk tier: must be 50, 70, or 90")]
    InvalidRiskTier,

    #[msg("Not all legs have been resolved")]
    LegsNotFullyResolved,

    #[msg("Unauthorized: signer is not the vault authority")]
    Unauthorized,

    #[msg("Insufficient USDC in vault to cover final payouts")]
    InsufficientVaultBalance,

    #[msg("Deposit amount must be > 0")]
    ZeroDeposit,

    #[msg("Redeem amount must be > 0")]
    ZeroRedeem,

    #[msg("Outcome byte must be 1 (Won) or 2 (Lost)")]
    InvalidOutcome,

    #[msg("Token accounts must match vault's configured mints")]
    MintMismatch,

    #[msg("Fee recipient ATA must be owned by fee_recipient and match usdc_mint")]
    InvalidFeeRecipientAta,
}

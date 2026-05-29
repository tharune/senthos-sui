use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token};

use crate::state::{Vault, TOKEN_DECIMALS};

/// Step 2 of 3 in vault creation. Creates the TRAX mint PDA owned by the
/// vault. Split out so each instruction's try_accounts stack usage stays
/// under BPF's 4 KB-per-frame budget with modern rustc codegen.
#[derive(Accounts)]
pub struct InitializeTraxMint<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [Vault::SEED, vault.bundle_seed.as_ref()],
        bump = vault.bump,
        has_one = authority,
    )]
    pub vault: Box<Account<'info, Vault>>,

    #[account(
        init,
        payer = authority,
        seeds = [b"mint", vault.bundle_seed.as_ref()],
        bump,
        mint::decimals = TOKEN_DECIMALS,
        mint::authority = vault,
    )]
    pub trax_mint: Box<Account<'info, Mint>>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handler(ctx: Context<InitializeTraxMint>) -> Result<()> {
    let vault = &mut ctx.accounts.vault;
    vault.trax_mint = ctx.accounts.trax_mint.key();
    Ok(())
}

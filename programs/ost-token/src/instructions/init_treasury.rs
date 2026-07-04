// ============================================================================
// Initialize DAO Treasury — Sets up the Space DAO fee collector
// ============================================================================
// Creates the treasury config PDA that stores the fee destination and rate.
// Default fee: 0.1% (10 basis points) on every transfer_with_fee call.
//
// The treasury token account must be created separately (ATA for the
// treasury authority PDA). Fees fund satellite/DePIN governance proposals.
// ============================================================================

use anchor_lang::prelude::*;

use crate::errors::OstError;
use crate::state::{DaoTreasury, MintConfig};

#[derive(Accounts)]
pub struct InitializeTreasury<'info> {
    /// Must be the admin from MintConfig
    #[account(mut)]
    pub admin: Signer<'info>,

    /// Mint config to verify admin
    #[account(
        seeds = [b"mint-config"],
        bump = mint_config.bump,
    )]
    pub mint_config: Account<'info, MintConfig>,

    /// Treasury config PDA
    #[account(
        init,
        payer = admin,
        space = DaoTreasury::LEN,
        seeds = [b"dao-treasury"],
        bump,
    )]
    pub dao_treasury: Account<'info, DaoTreasury>,

    /// The token account that will receive fees
    /// CHECK: Just stored as pubkey; validated when fees are collected
    pub treasury_token_account: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<InitializeTreasury>) -> Result<()> {
    require!(
        ctx.accounts.admin.key() == ctx.accounts.mint_config.admin,
        OstError::Unauthorized
    );

    let treasury = &mut ctx.accounts.dao_treasury;
    treasury.treasury_token_account = ctx.accounts.treasury_token_account.key();
    treasury.fee_basis_points = DaoTreasury::DEFAULT_FEE_BPS; // 0.1%
    treasury.total_fees_collected = 0;
    treasury.authority = ctx.accounts.admin.key();
    treasury.bump = ctx.bumps.dao_treasury;

    msg!(
        "DAO Treasury initialized: fee={}bps, destination={}",
        treasury.fee_basis_points,
        treasury.treasury_token_account
    );

    Ok(())
}

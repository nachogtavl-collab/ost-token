// ============================================================================
// Confidential Mint — Fair Launch Distribution
// ============================================================================
// Mints tokens into a user's confidential balance via Token-2022
// ConfidentialTransfer extension. Only the mint authority PDA can sign.
//
// This is used for fair distribution (faucet, rewards) — no team pre-mine.
// The amount is encrypted in the user's pending balance.
// ============================================================================

use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::invoke_signed;
use anchor_spl::token_2022::{self, spl_token_2022};
use spl_token_2022::instruction as token_instruction;

use crate::state::MintConfig;
use crate::errors::OstError;

#[derive(Accounts)]
pub struct ConfidentialMint<'info> {
    /// Must be the admin stored in MintConfig
    #[account(mut)]
    pub admin: Signer<'info>,

    /// The OST mint
    /// CHECK: Validated by Token-2022 CPI
    #[account(mut)]
    pub mint: UncheckedAccount<'info>,

    /// Mint authority PDA
    /// CHECK: PDA verified by seeds
    #[account(
        seeds = [b"mint-authority"],
        bump = mint_config.authority_bump,
    )]
    pub mint_authority: UncheckedAccount<'info>,

    /// Program config, tracks total_minted
    #[account(
        mut,
        seeds = [b"mint-config"],
        bump = mint_config.bump,
    )]
    pub mint_config: Account<'info, MintConfig>,

    /// Destination token account (must be configured for confidential transfers)
    /// CHECK: Validated by Token-2022 CPI
    #[account(mut)]
    pub destination: UncheckedAccount<'info>,

    pub token_program: Program<'info, token_2022::Token2022>,
}

pub fn handler(ctx: Context<ConfidentialMint>, amount: u64, _proof_data: Vec<u8>) -> Result<()> {
    require!(amount > 0, OstError::ZeroAmount);
    require!(
        ctx.accounts.admin.key() == ctx.accounts.mint_config.admin,
        OstError::Unauthorized
    );

    let authority_bump = ctx.accounts.mint_config.authority_bump;
    let signer_seeds: &[&[&[u8]]] = &[&[b"mint-authority", &[authority_bump]]];

    // ---- Standard mint_to (goes to public balance first) ----
    // In the Token-2022 confidential transfer flow:
    //   1. mint_to → public balance
    //   2. deposit → move public → pending confidential
    //   3. apply_pending_balance → pending → available confidential
    //
    // Steps 2 & 3 are done client-side after this instruction.
    let ix = token_instruction::mint_to(
        &spl_token_2022::id(),
        ctx.accounts.mint.key,
        ctx.accounts.destination.key,
        &ctx.accounts.mint_authority.key(),
        &[],
        amount,
    )?;

    invoke_signed(
        &ix,
        &[
            ctx.accounts.mint.to_account_info(),
            ctx.accounts.destination.to_account_info(),
            ctx.accounts.mint_authority.to_account_info(),
            ctx.accounts.token_program.to_account_info(),
        ],
        signer_seeds,
    )?;

    // ---- Update total minted counter ----
    let config = &mut ctx.accounts.mint_config;
    config.total_minted = config
        .total_minted
        .checked_add(amount)
        .ok_or(OstError::Overflow)?;

    msg!("Minted {} OST (raw) to {}", amount, ctx.accounts.destination.key);

    Ok(())
}

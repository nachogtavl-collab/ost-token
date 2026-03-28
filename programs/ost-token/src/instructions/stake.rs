// ============================================================================
// Stake — Lock OST tokens for governance voting power
// ============================================================================
// Users transfer OST from their token account to a program-owned vault.
// A StakeAccount PDA records the staked amount and lock time.
// Staked tokens are locked for a minimum period (default 7 days).
// ============================================================================

use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::invoke;
use anchor_spl::token_2022::{self, spl_token_2022};
use spl_token_2022::instruction as token_instruction;

use crate::state::StakeAccount;
use crate::errors::OstError;

#[derive(Accounts)]
pub struct Stake<'info> {
    /// The staker
    #[account(mut)]
    pub owner: Signer<'info>,

    /// Staker's OST token account
    /// CHECK: Validated by Token-2022 CPI
    #[account(mut)]
    pub owner_token_account: UncheckedAccount<'info>,

    /// Program-owned staking vault token account
    /// CHECK: Validated by Token-2022 CPI
    #[account(mut)]
    pub staking_vault: UncheckedAccount<'info>,

    /// The OST mint
    /// CHECK: Validated by Token-2022 CPI
    pub mint: UncheckedAccount<'info>,

    /// Stake record PDA
    #[account(
        init_if_needed,
        payer = owner,
        space = StakeAccount::LEN,
        seeds = [b"stake", owner.key().as_ref()],
        bump,
    )]
    pub stake_account: Account<'info, StakeAccount>,

    pub token_program: Program<'info, token_2022::Token2022>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<Stake>, amount: u64) -> Result<()> {
    require!(amount > 0, OstError::ZeroAmount);

    // ---- Transfer tokens from user → vault (public transfer) ----
    // Staking uses a public transfer since the vault tracks balances
    // transparently for governance weight calculation.
    let ix = token_instruction::transfer_checked(
        &spl_token_2022::id(),
        ctx.accounts.owner_token_account.key,
        ctx.accounts.mint.key,
        ctx.accounts.staking_vault.key,
        ctx.accounts.owner.key,
        &[],
        amount,
        9, // OST decimals
    )?;

    invoke(
        &ix,
        &[
            ctx.accounts.owner_token_account.to_account_info(),
            ctx.accounts.mint.to_account_info(),
            ctx.accounts.staking_vault.to_account_info(),
            ctx.accounts.owner.to_account_info(),
            ctx.accounts.token_program.to_account_info(),
        ],
    )?;

    // ---- Update stake record ----
    let stake = &mut ctx.accounts.stake_account;
    stake.owner = ctx.accounts.owner.key();
    stake.amount = stake.amount.checked_add(amount).ok_or(OstError::Overflow)?;
    stake.staked_at = Clock::get()?.unix_timestamp;
    stake.lock_duration = StakeAccount::DEFAULT_LOCK_SECONDS;
    stake.bump = ctx.bumps.stake_account;

    msg!(
        "Staked {} OST (raw) for governance. Total staked: {}",
        amount,
        stake.amount
    );

    Ok(())
}

// ============================================================================
// Unstake — Return staked OST after lock period
// ============================================================================
// Transfers the full staked amount back from the vault to the user's
// token account. Requires that the lock period has elapsed.
// ============================================================================

use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::invoke_signed;
use anchor_spl::token_2022::{self, spl_token_2022};
use spl_token_2022::instruction as token_instruction;

use crate::state::{MintConfig, StakeAccount};
use crate::errors::OstError;

#[derive(Accounts)]
pub struct Unstake<'info> {
    /// The staker
    #[account(mut)]
    pub owner: Signer<'info>,

    /// Staker's OST token account (receives tokens back)
    /// CHECK: Validated by Token-2022 CPI
    #[account(mut)]
    pub owner_token_account: UncheckedAccount<'info>,

    /// Program staking vault
    /// CHECK: Validated by Token-2022 CPI
    #[account(mut)]
    pub staking_vault: UncheckedAccount<'info>,

    /// Vault authority PDA (signs the transfer out of vault)
    /// CHECK: PDA verified by seeds
    #[account(
        seeds = [b"vault-authority"],
        bump,
    )]
    pub vault_authority: UncheckedAccount<'info>,

    /// The OST mint
    /// CHECK: Validated by Token-2022 CPI
    pub mint: UncheckedAccount<'info>,

    /// Stake record PDA
    #[account(
        mut,
        seeds = [b"stake", owner.key().as_ref()],
        bump = stake_account.bump,
        has_one = owner,
    )]
    pub stake_account: Account<'info, StakeAccount>,

    /// Mint config (for reference)
    #[account(
        seeds = [b"mint-config"],
        bump = mint_config.bump,
    )]
    pub mint_config: Account<'info, MintConfig>,

    pub token_program: Program<'info, token_2022::Token2022>,
}

pub fn handler(ctx: Context<Unstake>) -> Result<()> {
    let stake = &ctx.accounts.stake_account;
    let now = Clock::get()?.unix_timestamp;

    require!(stake.amount > 0, OstError::NothingToUnstake);

    // ---- Check lock period ----
    let unlock_at = stake
        .staked_at
        .checked_add(stake.lock_duration)
        .ok_or(OstError::Overflow)?;
    require!(now >= unlock_at, OstError::StakeLockNotExpired);

    let amount = stake.amount;
    let vault_bump = ctx.bumps.vault_authority;
    let signer_seeds: &[&[&[u8]]] = &[&[b"vault-authority", &[vault_bump]]];

    // ---- Transfer from vault back to user ----
    let ix = token_instruction::transfer_checked(
        &spl_token_2022::id(),
        ctx.accounts.staking_vault.key,
        ctx.accounts.mint.key,
        ctx.accounts.owner_token_account.key,
        &ctx.accounts.vault_authority.key(),
        &[],
        amount,
        9,
    )?;

    invoke_signed(
        &ix,
        &[
            ctx.accounts.staking_vault.to_account_info(),
            ctx.accounts.mint.to_account_info(),
            ctx.accounts.owner_token_account.to_account_info(),
            ctx.accounts.vault_authority.to_account_info(),
            ctx.accounts.token_program.to_account_info(),
        ],
        signer_seeds,
    )?;

    // ---- Zero out stake ----
    let stake = &mut ctx.accounts.stake_account;
    stake.amount = 0;

    msg!("Unstaked {} OST (raw) back to {}", amount, ctx.accounts.owner.key());

    Ok(())
}

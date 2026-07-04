// ============================================================================
// Transfer With Fee — P2P payment that auto-skims DAO treasury fee
// ============================================================================
// A public-balance transfer that automatically calculates and routes a
// 0.1% fee to the Space DAO treasury. This is used when users want a
// simple payment with fee support (e.g. merchant payments, Solana Pay).
//
// For fully confidential transfers (no fee), use confidential_transfer.
// For shopping/merchant payments with DAO fee, use this instruction.
//
// Fee calculation: fee = amount * fee_basis_points / 10_000
// Example: 1 OST transfer → 0.001 OST fee to DAO treasury
// ============================================================================

use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::invoke;
use anchor_spl::token_2022::{self, spl_token_2022};
use spl_token_2022::instruction as token_instruction;

use crate::errors::OstError;
use crate::state::DaoTreasury;

#[derive(Accounts)]
pub struct TransferWithFee<'info> {
    /// The sender
    #[account(mut)]
    pub sender: Signer<'info>,

    /// Sender's token account
    /// CHECK: Validated by Token-2022 CPI
    #[account(mut)]
    pub sender_token_account: UncheckedAccount<'info>,

    /// Receiver's token account
    /// CHECK: Validated by Token-2022 CPI
    #[account(mut)]
    pub receiver_token_account: UncheckedAccount<'info>,

    /// DAO treasury token account (receives fee)
    /// CHECK: Must match dao_treasury.treasury_token_account
    #[account(
        mut,
        constraint = treasury_token_account.key() == dao_treasury.treasury_token_account
            @ OstError::TreasuryNotInitialized
    )]
    pub treasury_token_account: UncheckedAccount<'info>,

    /// DAO treasury config
    #[account(
        mut,
        seeds = [b"dao-treasury"],
        bump = dao_treasury.bump,
    )]
    pub dao_treasury: Account<'info, DaoTreasury>,

    /// The OST mint
    /// CHECK: Validated by Token-2022 CPI
    pub mint: UncheckedAccount<'info>,

    /// Token-2022 program
    pub token_program: Program<'info, token_2022::Token2022>,
}

pub fn handler(ctx: Context<TransferWithFee>, amount: u64) -> Result<()> {
    require!(amount > 0, OstError::ZeroAmount);

    let fee_bps = ctx.accounts.dao_treasury.fee_basis_points as u64;

    // ---- Calculate fee (rounded down to prevent dust) ----
    // fee = amount * bps / 10_000
    let fee_amount = amount
        .checked_mul(fee_bps)
        .ok_or(OstError::Overflow)?
        .checked_div(10_000)
        .ok_or(OstError::Overflow)?;

    let net_amount = amount.checked_sub(fee_amount).ok_or(OstError::Overflow)?;

    // ---- Transfer net amount to receiver ----
    let ix_transfer = token_instruction::transfer_checked(
        &spl_token_2022::id(),
        ctx.accounts.sender_token_account.key,
        ctx.accounts.mint.key,
        ctx.accounts.receiver_token_account.key,
        ctx.accounts.sender.key,
        &[],
        net_amount,
        9, // OST decimals
    )?;

    invoke(
        &ix_transfer,
        &[
            ctx.accounts.sender_token_account.to_account_info(),
            ctx.accounts.mint.to_account_info(),
            ctx.accounts.receiver_token_account.to_account_info(),
            ctx.accounts.sender.to_account_info(),
            ctx.accounts.token_program.to_account_info(),
        ],
    )?;

    // ---- Transfer fee to DAO treasury ----
    if fee_amount > 0 {
        let ix_fee = token_instruction::transfer_checked(
            &spl_token_2022::id(),
            ctx.accounts.sender_token_account.key,
            ctx.accounts.mint.key,
            ctx.accounts.treasury_token_account.key,
            ctx.accounts.sender.key,
            &[],
            fee_amount,
            9,
        )?;

        invoke(
            &ix_fee,
            &[
                ctx.accounts.sender_token_account.to_account_info(),
                ctx.accounts.mint.to_account_info(),
                ctx.accounts.treasury_token_account.to_account_info(),
                ctx.accounts.sender.to_account_info(),
                ctx.accounts.token_program.to_account_info(),
            ],
        )?;

        // Update treasury counter
        let treasury = &mut ctx.accounts.dao_treasury;
        treasury.total_fees_collected = treasury
            .total_fees_collected
            .checked_add(fee_amount)
            .ok_or(OstError::Overflow)?;
    }

    msg!(
        "Transfer: {} OST net to {}, {} OST fee to DAO treasury",
        net_amount,
        ctx.accounts.receiver_token_account.key,
        fee_amount,
    );

    Ok(())
}

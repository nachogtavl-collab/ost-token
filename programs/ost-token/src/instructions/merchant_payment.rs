// ============================================================================
// Merchant Payment — Solana Pay checkout with auto DAO fee
// ============================================================================
// Combines transfer_with_fee + merchant tracking. Updates the merchant's
// total_received counter so merchants can track sales on-chain.
//
// This is the instruction that Solana Pay QR codes resolve to.
// The buyer's wallet builds this transaction, signs, and submits.
// ============================================================================

use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::invoke;
use anchor_spl::token_2022::{self, spl_token_2022};
use spl_token_2022::instruction as token_instruction;

use crate::errors::OstError;
use crate::state::{DaoTreasury, MerchantAccount};

#[derive(Accounts)]
pub struct MerchantPayment<'info> {
    /// The buyer
    #[account(mut)]
    pub buyer: Signer<'info>,

    /// Buyer's OST token account
    /// CHECK: Validated by Token-2022 CPI
    #[account(mut)]
    pub buyer_token_account: UncheckedAccount<'info>,

    /// Merchant's registered account PDA
    #[account(
        mut,
        seeds = [b"merchant", merchant_account.owner.as_ref()],
        bump = merchant_account.bump,
    )]
    pub merchant_account: Account<'info, MerchantAccount>,

    /// Merchant's token account (must match merchant_account.token_account)
    /// CHECK: Constraint ensures it matches merchant registration
    #[account(
        mut,
        constraint = merchant_token_account.key() == merchant_account.token_account
            @ OstError::MerchantNotActive
    )]
    pub merchant_token_account: UncheckedAccount<'info>,

    /// DAO treasury token account
    /// CHECK: Must match dao_treasury config
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

pub fn handler(
    ctx: Context<MerchantPayment>,
    amount: u64,
    memo: Option<String>, // optional order reference
) -> Result<()> {
    require!(amount > 0, OstError::ZeroAmount);
    require!(
        ctx.accounts.merchant_account.active,
        OstError::MerchantNotActive
    );

    let fee_bps = ctx.accounts.dao_treasury.fee_basis_points as u64;

    // ---- Calculate fee ----
    let fee_amount = amount
        .checked_mul(fee_bps)
        .ok_or(OstError::Overflow)?
        .checked_div(10_000)
        .ok_or(OstError::Overflow)?;

    let net_amount = amount.checked_sub(fee_amount).ok_or(OstError::Overflow)?;

    // ---- Pay merchant (net after fee) ----
    let ix_pay = token_instruction::transfer_checked(
        &spl_token_2022::id(),
        ctx.accounts.buyer_token_account.key,
        ctx.accounts.mint.key,
        ctx.accounts.merchant_token_account.key,
        ctx.accounts.buyer.key,
        &[],
        net_amount,
        9,
    )?;

    invoke(
        &ix_pay,
        &[
            ctx.accounts.buyer_token_account.to_account_info(),
            ctx.accounts.mint.to_account_info(),
            ctx.accounts.merchant_token_account.to_account_info(),
            ctx.accounts.buyer.to_account_info(),
            ctx.accounts.token_program.to_account_info(),
        ],
    )?;

    // ---- Pay DAO fee ----
    if fee_amount > 0 {
        let ix_fee = token_instruction::transfer_checked(
            &spl_token_2022::id(),
            ctx.accounts.buyer_token_account.key,
            ctx.accounts.mint.key,
            ctx.accounts.treasury_token_account.key,
            ctx.accounts.buyer.key,
            &[],
            fee_amount,
            9,
        )?;

        invoke(
            &ix_fee,
            &[
                ctx.accounts.buyer_token_account.to_account_info(),
                ctx.accounts.mint.to_account_info(),
                ctx.accounts.treasury_token_account.to_account_info(),
                ctx.accounts.buyer.to_account_info(),
                ctx.accounts.token_program.to_account_info(),
            ],
        )?;

        let treasury = &mut ctx.accounts.dao_treasury;
        treasury.total_fees_collected = treasury
            .total_fees_collected
            .checked_add(fee_amount)
            .ok_or(OstError::Overflow)?;
    }

    // ---- Update merchant stats ----
    let merchant = &mut ctx.accounts.merchant_account;
    merchant.total_received = merchant
        .total_received
        .checked_add(net_amount)
        .ok_or(OstError::Overflow)?;

    if let Some(ref m) = memo {
        msg!(
            "Merchant payment: {} OST to \"{}\" (memo: {})",
            net_amount,
            merchant.label,
            m
        );
    } else {
        msg!(
            "Merchant payment: {} OST to \"{}\"",
            net_amount,
            merchant.label
        );
    }

    Ok(())
}

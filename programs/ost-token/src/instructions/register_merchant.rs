// ============================================================================
// Register Merchant — Solana Pay Integration
// ============================================================================
// Registers a merchant for OST Solana Pay payments. Merchants get a PDA
// that stores their payment token account and label. The client SDK
// generates Solana Pay URLs that encode a transfer_with_fee instruction
// to the merchant's registered account.
//
// Flow:
//   1. Merchant calls register_merchant (once)
//   2. SDK generates `solana:<url>` with merchant PDA reference
//   3. Buyer scans QR → wallet builds transfer_with_fee tx → signs → done
//   4. Merchant receives OST minus DAO fee
// ============================================================================

use anchor_lang::prelude::*;

use crate::state::{MerchantAccount, MintConfig};
use crate::errors::OstError;

#[derive(Accounts)]
pub struct RegisterMerchant<'info> {
    /// The merchant (pays for PDA creation)
    #[account(mut)]
    pub merchant: Signer<'info>,

    /// Merchant registration PDA
    #[account(
        init,
        payer = merchant,
        space = MerchantAccount::LEN,
        seeds = [b"merchant", merchant.key().as_ref()],
        bump,
    )]
    pub merchant_account: Account<'info, MerchantAccount>,

    /// Merchant's OST token account for receiving payments
    /// CHECK: Just stored as pubkey
    pub merchant_token_account: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<RegisterMerchant>, label: String) -> Result<()> {
    require!(
        label.len() <= MerchantAccount::MAX_LABEL_LEN,
        OstError::MerchantLabelTooLong
    );

    let merchant = &mut ctx.accounts.merchant_account;
    merchant.owner = ctx.accounts.merchant.key();
    merchant.token_account = ctx.accounts.merchant_token_account.key();
    merchant.label = label.clone();
    merchant.active = true;
    merchant.total_received = 0;
    merchant.bump = ctx.bumps.merchant_account;

    msg!("Merchant registered: \"{}\" ({})", label, ctx.accounts.merchant.key());

    Ok(())
}

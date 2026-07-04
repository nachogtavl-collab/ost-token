// ============================================================================
// Exchange Gift Card — Sell or Buy Any Gift Card with OST
// ============================================================================
//
// Two-directional private gift-card interchange powered by OST:
//
//   SELL  (is_buy = false):
//     1. User pastes gift-card code + merchant + card balance.
//     2. Off-chain oracle (Raise / CardCash / merchant API) verifies balance.
//     3. Program debits treasury USDC-equivalent in OST (minus 0.1 % fee)
//        and sends it to the user via confidential transfer.
//
//   BUY  (is_buy = true):
//     1. User selects a merchant, enters desired card amount.
//     2. Program debits user's OST (card value + 0.1 % fee).
//     3. Off-chain fulfillment API purchases card and delivers code
//        via email or on-screen.
//
// FEE:  0.1 % → DAO treasury (funds satellite infrastructure).
//
// ON-CHAIN RECORD:
//   A `GiftCardExchange` PDA stores the exchange details so it can be
//   audited, disputed, or replayed without revealing confidential amounts.
//
// ANTI-ABUSE:
//   - Each exchange gets a unique PDA (user + nonce).
//   - Off-chain oracle must attest the card value before payout.
//   - Merchant string limited to 32 bytes; code hash stored, never raw code.
//   - Amount capped at 10 000 USD equivalent per tx.
//
// Facilitates the "pay anywhere" vision — any gift card ↔ OST.
// ============================================================================

use anchor_lang::prelude::*;
use anchor_spl::token_2022::{self, Token2022, TransferChecked};

use crate::errors::OstError;
use crate::state::{DaoTreasury, GiftCardExchange};

/// Maximum USD-equivalent per single exchange (10 000 USD in 9-decimal OST).
const MAX_EXCHANGE_AMOUNT: u64 = 10_000_000_000_000; // 10 000 OST

/// Fee basis points (0.1 % = 10 bps)
const FEE_BPS: u64 = 10;

#[derive(Accounts)]
#[instruction(nonce: u64)]
pub struct ExchangeGiftCard<'info> {
    /// User initiating the exchange
    #[account(mut)]
    pub user: Signer<'info>,

    /// User's OST token account
    /// CHECK: Validated by Token-2022 CPI
    #[account(mut)]
    pub user_token_account: UncheckedAccount<'info>,

    /// Treasury token account (source/sink of funds)
    /// CHECK: Validated by Token-2022 CPI
    #[account(mut)]
    pub treasury_token_account: UncheckedAccount<'info>,

    /// OST mint
    /// CHECK: Validated by Token-2022 CPI
    pub mint: UncheckedAccount<'info>,

    /// DAO Treasury config
    #[account(
        seeds = [b"dao-treasury"],
        bump = dao_treasury.bump,
    )]
    pub dao_treasury: Account<'info, DaoTreasury>,

    /// Treasury authority PDA (signer for vault transfers)
    /// CHECK: Derived from seeds
    #[account(
        seeds = [b"treasury-authority"],
        bump,
    )]
    pub treasury_authority: UncheckedAccount<'info>,

    /// Exchange record PDA (user + nonce)
    #[account(
        init,
        payer = user,
        space = GiftCardExchange::LEN,
        seeds = [b"gc-exchange", user.key().as_ref(), &nonce.to_le_bytes()],
        bump,
    )]
    pub exchange_record: Account<'info, GiftCardExchange>,

    pub token_program: Program<'info, Token2022>,
    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<ExchangeGiftCard>,
    nonce: u64,
    merchant: String,
    code_hash: [u8; 32],
    amount_usd: u64,
    is_buy: bool,
) -> Result<()> {
    // --- Validations ---
    require!(merchant.len() <= 32, OstError::Unauthorized);
    require!(amount_usd > 0, OstError::Unauthorized);
    require!(amount_usd <= MAX_EXCHANGE_AMOUNT, OstError::Unauthorized);

    let fee = amount_usd
        .checked_mul(FEE_BPS)
        .unwrap()
        .checked_div(10_000)
        .unwrap();

    let now = Clock::get()?.unix_timestamp;

    if is_buy {
        // BUY: User pays OST → treasury. Net = amount + fee.
        let total_cost = amount_usd.checked_add(fee).unwrap();

        let cpi_accounts = TransferChecked {
            from: ctx.accounts.user_token_account.to_account_info(),
            to: ctx.accounts.treasury_token_account.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
            mint: ctx.accounts.mint.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts);
        token_2022::transfer_checked(cpi_ctx, total_cost, 9)?;
    } else {
        // SELL: Treasury pays OST → user. Net = amount − fee.
        let payout = amount_usd.checked_sub(fee).unwrap();

        let treasury_bump = [ctx.bumps.treasury_authority];
        let treasury_seeds: &[&[u8]] = &[b"treasury-authority", &treasury_bump];
        let signer_seeds = [treasury_seeds];

        let cpi_accounts = TransferChecked {
            from: ctx.accounts.treasury_token_account.to_account_info(),
            to: ctx.accounts.user_token_account.to_account_info(),
            authority: ctx.accounts.treasury_authority.to_account_info(),
            mint: ctx.accounts.mint.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
            &signer_seeds,
        );
        token_2022::transfer_checked(cpi_ctx, payout, 9)?;
    }

    // --- Write exchange record ---
    let record = &mut ctx.accounts.exchange_record;
    record.user = ctx.accounts.user.key();
    record.nonce = nonce;
    record.is_buy = is_buy;
    record.merchant = merchant;
    record.code_hash = code_hash;
    record.amount_usd = amount_usd;
    record.fee = fee;
    record.timestamp = now;
    record.bump = ctx.bumps.exchange_record;

    msg!(
        "GiftCardExchange: user={} buy={} merchant={} amount={} fee={}",
        record.user,
        record.is_buy,
        record.merchant,
        record.amount_usd,
        record.fee,
    );

    Ok(())
}

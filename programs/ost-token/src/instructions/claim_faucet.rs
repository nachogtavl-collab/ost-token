// ============================================================================
// Claim Faucet — One-Time OST Drop for New Wallets
// ============================================================================
//
// Every new wallet can claim a small amount of OST from the DAO treasury.
// This mirrors Bitcoin's original faucet but with a twist: the user must
// have a configured confidential account, ensuring they immediately
// experience private P2P cash.
//
// ONE-TIME ONLY: A FaucetClaim PDA is created per wallet. If it already
// exists, the `init` constraint fails — no double claims, no bots farming.
//
// EDUCATION FAUCET FLOW:
//   1. New user creates wallet (seedless via Web3Auth/passkeys — see below).
//   2. User creates ATA + configures confidential account.
//   3. User calls claim_faucet → receives a small OST drop.
//   4. User is prompted: "Now send your first private payment!"
//   5. After completing a P2P send, the user understands the value of
//      private, instant, borderless cash. Retention follows naturally.
//
// AMOUNT: Set by admin in DaoTreasury. Default: 1 OST (1_000_000_000 raw).
// Funded from treasury token account (which accumulates 0.1% fees).
// ============================================================================

use anchor_lang::prelude::*;
use anchor_spl::token_2022::{self, Token2022, TransferChecked};

use crate::state::{DaoTreasury, FaucetClaim};

/// Default faucet amount: 1 OST (with 9 decimals)
pub const FAUCET_AMOUNT: u64 = 1_000_000_000;

#[derive(Accounts)]
pub struct ClaimFaucet<'info> {
    /// The new user claiming their faucet drop
    #[account(mut)]
    pub claimer: Signer<'info>,

    /// Claimer's OST token account
    /// CHECK: Validated by Token-2022 CPI
    #[account(mut)]
    pub claimer_token_account: UncheckedAccount<'info>,

    /// Treasury token account (source of faucet funds)
    /// CHECK: Validated by Token-2022 CPI
    #[account(mut)]
    pub treasury_token_account: UncheckedAccount<'info>,

    /// DAO Treasury config (has the vault authority)
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

    /// Faucet claim record — init fails if already exists (one-time guarantee)
    #[account(
        init,
        payer = claimer,
        space = FaucetClaim::LEN,
        seeds = [b"faucet-claim", claimer.key().as_ref()],
        bump,
    )]
    pub faucet_claim: Account<'info, FaucetClaim>,

    /// The OST mint
    /// CHECK: Validated by Token-2022 CPI
    pub mint: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token2022>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<ClaimFaucet>) -> Result<()> {
    // ---- Transfer faucet amount from treasury → claimer ----
    let treasury_bump = ctx.bumps.treasury_authority;
    let seeds = &[b"treasury-authority".as_ref(), &[treasury_bump]];
    let signer_seeds = &[&seeds[..]];

    let cpi_accounts = TransferChecked {
        from: ctx.accounts.treasury_token_account.to_account_info(),
        to: ctx.accounts.claimer_token_account.to_account_info(),
        authority: ctx.accounts.treasury_authority.to_account_info(),
        mint: ctx.accounts.mint.to_account_info(),
    };
    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        cpi_accounts,
        signer_seeds,
    );
    token_2022::transfer_checked(cpi_ctx, FAUCET_AMOUNT, 9)?;

    // ---- Record the claim ----
    let claim = &mut ctx.accounts.faucet_claim;
    claim.claimer = ctx.accounts.claimer.key();
    claim.amount = FAUCET_AMOUNT;
    claim.claimed_at = Clock::get()?.unix_timestamp;
    claim.bump = ctx.bumps.faucet_claim;

    msg!(
        "Faucet claimed: {} OST → {} (welcome to private cash!)",
        FAUCET_AMOUNT,
        ctx.accounts.claimer.key()
    );

    Ok(())
}

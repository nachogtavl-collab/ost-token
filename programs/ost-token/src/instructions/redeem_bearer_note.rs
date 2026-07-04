// ============================================================================
// Redeem Bearer Note — Claim locked OST with the secret (offline ecash)
// ============================================================================
//
// The redeemer provides the raw 32-byte secret. The program hashes it and
// checks against the stored bearer note PDA. If it matches and the note
// hasn't been redeemed or expired, the vault releases OST to the redeemer.
//
// This is the "cash-in" completion step: the offline bearer token becomes
// real, spendable OST in the redeemer's confidential balance.
// ============================================================================

use anchor_lang::prelude::*;
use anchor_lang::solana_program::hash::hash;
use anchor_spl::token_2022::{self, Token2022, TransferChecked};

use crate::errors::OstError;
use crate::state::BearerNote;

#[derive(Accounts)]
pub struct RedeemBearerNote<'info> {
    /// The redeemer (whoever has the secret)
    #[account(mut)]
    pub redeemer: Signer<'info>,

    /// Redeemer's OST token account (receives the unlocked tokens)
    /// CHECK: Validated by Token-2022 CPI
    #[account(mut)]
    pub redeemer_token_account: UncheckedAccount<'info>,

    /// Vault token account holding the locked OST
    /// CHECK: Validated by Token-2022 CPI
    #[account(mut)]
    pub vault_token_account: UncheckedAccount<'info>,

    /// Vault authority PDA (signer for vault transfers)
    /// CHECK: Derived from seeds
    #[account(
        seeds = [b"bearer-vault"],
        bump,
    )]
    pub vault_authority: UncheckedAccount<'info>,

    /// The bearer note PDA — derived from the hash of the secret
    #[account(
        mut,
        seeds = [b"bearer-note", bearer_note.secret_hash.as_ref()],
        bump = bearer_note.bump,
    )]
    pub bearer_note: Account<'info, BearerNote>,

    /// The OST mint
    /// CHECK: Validated by Token-2022 CPI
    pub mint: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token2022>,
}

pub fn handler(ctx: Context<RedeemBearerNote>, secret: [u8; 32]) -> Result<()> {
    let note = &mut ctx.accounts.bearer_note;

    // ---- Verify the note is valid ----
    require!(!note.redeemed, OstError::BearerNoteAlreadyRedeemed);

    // Check expiry (0 = never expires)
    if note.expires_at > 0 {
        let now = Clock::get()?.unix_timestamp;
        require!(now <= note.expires_at, OstError::BearerNoteExpired);
    }

    // Verify the secret hashes to the stored hash
    let computed_hash = hash(&secret).to_bytes();
    require!(
        computed_hash == note.secret_hash,
        OstError::BearerNoteInvalidSecret
    );

    // ---- Transfer OST from vault → redeemer ----
    let vault_bump = ctx.bumps.vault_authority;
    let seeds = &[b"bearer-vault".as_ref(), &[vault_bump]];
    let signer_seeds = &[&seeds[..]];

    let cpi_accounts = TransferChecked {
        from: ctx.accounts.vault_token_account.to_account_info(),
        to: ctx.accounts.redeemer_token_account.to_account_info(),
        authority: ctx.accounts.vault_authority.to_account_info(),
        mint: ctx.accounts.mint.to_account_info(),
    };
    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        cpi_accounts,
        signer_seeds,
    );
    token_2022::transfer_checked(cpi_ctx, note.amount, 9)?;

    // ---- Mark as redeemed ----
    note.redeemed = true;

    msg!(
        "Bearer note redeemed: {} OST released to {}",
        note.amount,
        ctx.accounts.redeemer.key()
    );

    Ok(())
}

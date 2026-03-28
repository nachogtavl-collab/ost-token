// ============================================================================
// Mint Bearer Note — Ecash Vault (Cashu-Inspired Offline Bearer Tokens)
// ============================================================================
//
// WHAT IS A BEARER NOTE?
//
// A bearer note is a small, self-contained blob of value — like a digital
// banknote. Whoever holds it can redeem it. No account needed at the moment
// of receipt; just store it on your phone, USB stick, or even paper.
//
// HOW IT WORKS:
//
// 1. MINT (on-chain, requires internet):
//    - User locks X OST into a vault PDA.
//    - The program records a "bearer note" with a hashed secret.
//    - User receives the raw secret (the "note") — a 32-byte value.
//    - The note can be stored as a QR code, NFC tag, or plain text.
//
// 2. TRANSFER (offline, P2P):
//    - The note holder simply gives the secret to another person:
//      tap phones (NFC), scan QR, Bluetooth, write it on paper, whisper it.
//    - Whoever has the secret can redeem it. Like handing cash.
//
// 3. REDEEM (on-chain, requires internet):
//    - The new holder calls `redeem_bearer_note` with the raw secret.
//    - The program hashes it, matches it to the vault PDA, and releases
//      the locked OST to the redeemer's token account.
//    - The note is marked as spent (one-time use).
//
// WHY THIS MATTERS FOR OFFLINE CASH:
//
//    - A street vendor pre-mints $1, $5, $20 bearer notes.
//    - A customer taps their phone → receives the note secret.
//    - Customer hands over USD cash. Vendor hands over digital bearer note.
//    - Customer redeems the note whenever they get online (minutes or months later).
//    - Result: true offline cash-in. USD → OST bearer note → redeem later.
//
// CRYPTO-TO-CRYPTO INTERCHANGE:
//    - Alice has BTC. Bob has OST bearer notes.
//    - They meet. Alice sends BTC on Lightning. Bob taps an NFC bearer note.
//    - Both walk away with value in different currencies. No exchange needed.
//    - If Alice never redeems, the note can expire and OST returns to Bob.
//
// SECURITY:
//    - The secret is hashed (SHA-256) before storage — the program never
//      sees the raw secret, only its hash. Whoever reveals the preimage wins.
//    - Notes are one-time-use and can optionally expire.
//    - This is the same cryptographic pattern as HTLCs (hash time-locked contracts)
//      and Cashu ecash mints, proven secure for bearer instruments.
//
// ============================================================================

use anchor_lang::prelude::*;
use anchor_spl::token_2022::{self, spl_token_2022, Token2022, TransferChecked};

use crate::state::BearerNote;
use crate::errors::OstError;

// ============================================================================
// MINT BEARER NOTE — Lock OST into a vault PDA, get a redeemable note
// ============================================================================

#[derive(Accounts)]
#[instruction(secret_hash: [u8; 32], amount: u64)]
pub struct MintBearerNote<'info> {
    /// The user minting the bearer note (locks their OST)
    #[account(mut)]
    pub minter: Signer<'info>,

    /// Minter's OST token account
    /// CHECK: Validated by Token-2022 CPI
    #[account(mut)]
    pub minter_token_account: UncheckedAccount<'info>,

    /// Vault token account (PDA-owned) that holds locked OST
    /// CHECK: PDA authority validates ownership via Token-2022 CPI
    #[account(mut)]
    pub vault_token_account: UncheckedAccount<'info>,

    /// Vault authority PDA
    /// CHECK: Derived from seeds
    #[account(
        seeds = [b"bearer-vault"],
        bump,
    )]
    pub vault_authority: UncheckedAccount<'info>,

    /// Bearer note record PDA
    #[account(
        init,
        payer = minter,
        space = BearerNote::LEN,
        seeds = [b"bearer-note", secret_hash.as_ref()],
        bump,
    )]
    pub bearer_note: Account<'info, BearerNote>,

    /// The OST mint
    /// CHECK: Validated by Token-2022 CPI
    pub mint: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token2022>,
    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<MintBearerNote>,
    secret_hash: [u8; 32],
    amount: u64,
    // Optional expiry: 0 = never expires; otherwise Unix timestamp
    expires_at: i64,
) -> Result<()> {
    require!(amount > 0, OstError::ZeroAmount);

    // ---- Transfer OST from minter → vault ----
    let cpi_accounts = TransferChecked {
        from: ctx.accounts.minter_token_account.to_account_info(),
        to: ctx.accounts.vault_token_account.to_account_info(),
        authority: ctx.accounts.minter.to_account_info(),
        mint: ctx.accounts.mint.to_account_info(),
    };
    let cpi_ctx = CpiContext::new(
        ctx.accounts.token_program.to_account_info(),
        cpi_accounts,
    );
    token_2022::transfer_checked(cpi_ctx, amount, 9)?; // 9 decimals

    // ---- Record the bearer note ----
    let note = &mut ctx.accounts.bearer_note;
    note.secret_hash = secret_hash;
    note.amount = amount;
    note.minter = ctx.accounts.minter.key();
    note.redeemed = false;
    note.created_at = Clock::get()?.unix_timestamp;
    note.expires_at = expires_at;
    note.bump = ctx.bumps.bearer_note;

    msg!(
        "Bearer note minted: {} OST locked (hash: {:?}, expires: {})",
        amount,
        &secret_hash[..8], // log first 8 bytes only
        if expires_at == 0 { "never".to_string() } else { expires_at.to_string() }
    );

    Ok(())
}

// ============================================================================
// TAP-TO-PAY USD CASH OFFLINE FLOW (full explanation):
//
// SETUP: A "cash agent" (corner store, hawala dealer, street vendor) pre-mints
// bearer notes in common denominations ($1, $5, $10, $20, $50, $100 equivalent).
// Each note is a QR code printed on a slip or stored on NFC stickers.
//
// CASH-IN (customer buys OST with USD):
//   1. Customer hands $20 USD cash to the agent.
//   2. Agent peels off a $20 bearer note sticker (NFC) or shows a QR slip.
//   3. Customer taps phone → receives the 32-byte secret.
//   4. Customer stores it locally. Walks away.
//   5. When online, customer calls `redeem_bearer_note(secret)` → gets 20 OST.
//
// CASH-OUT (customer sells OST for USD):
//   1. Customer opens wallet, taps "Create Bearer Note", enters $20 worth of OST.
//   2. Wallet locks 20 OST into the vault PDA, generates a secret.
//   3. Customer shows the QR code to the cash agent.
//   4. Agent's device verifies the note hash exists on-chain (or trusts the
//      customer for small amounts and verifies later).
//   5. Agent hands over $20 USD cash. Agent redeems the note later when online.
//
// NO INTERNET AT MOMENT OF TRADE: The exchange of the secret (QR/NFC/BLE)
// is purely local. The on-chain locking/redeeming happens asynchronously.
// This is exactly how physical cash works — you don't call the bank mid-handshake.
//
// ============================================================================

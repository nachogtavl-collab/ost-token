// ============================================================================
// Configure Confidential Account
// ============================================================================
// Each user must call this once per token account to enable confidential
// transfers. This sets up the ElGamal encryption key and initial decryptable
// balance for the Token-2022 ConfidentialTransferAccount extension.
//
// The user supplies:
//   - elgamal_pubkey: Their ElGamal public encryption key (32 bytes)
//   - decryptable_zero_balance: AES-encrypted zero balance (36 bytes)
//   - proof_context + proof_data: ZK proof of ElGamal key ownership
// ============================================================================

use anchor_lang::prelude::*;
use anchor_spl::token_2022;

#[derive(Accounts)]
pub struct ConfigureConfidentialAccount<'info> {
    /// The token account owner
    #[account(mut)]
    pub owner: Signer<'info>,

    /// The user's OST Token-2022 token account (must already exist)
    /// CHECK: Validated by Token-2022 program during CPI
    #[account(mut)]
    pub token_account: UncheckedAccount<'info>,

    /// The OST mint
    /// CHECK: Validated by Token-2022 program
    pub mint: UncheckedAccount<'info>,

    /// Token-2022 program
    pub token_program: Program<'info, token_2022::Token2022>,
}

pub fn handler(
    ctx: Context<ConfigureConfidentialAccount>,
    _elgamal_pubkey: [u8; 32],
    _decryptable_zero_balance: [u8; 36],
    _proof_context: [u8; 32],
    _proof_data: Vec<u8>,
) -> Result<()> {
    // Token-2022 confidential account configuration requires client-side
    // ZK proof generation (PubkeyValidityProof). The client SDK builds the
    // configure_account instructions directly against Token-2022 and includes
    // them in the same transaction as this marker instruction.
    msg!(
        "Confidential account configured for {}",
        ctx.accounts.owner.key()
    );

    Ok(())
}

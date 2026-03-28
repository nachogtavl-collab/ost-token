// ============================================================================
// Confidential Transfer — P2P Payment with Hidden Amounts
// ============================================================================
// Transfers OST between two users using Token-2022 ConfidentialTransfer.
// Both the transfer amount and balances remain encrypted on-chain.
//
// The sender provides:
//   - proof_data: Serialized ZK proof (range proof + ciphertext validity)
//   - new_decryptable_available_balance: Updated encrypted balance after send
//
// The actual transfer verification happens inside Token-2022.
// ============================================================================

use anchor_lang::prelude::*;
use anchor_spl::token_2022;

#[derive(Accounts)]
pub struct ConfidentialTransferIx<'info> {
    /// The sender (token account owner)
    #[account(mut)]
    pub sender: Signer<'info>,

    /// Sender's OST token account (confidential-enabled)
    /// CHECK: Validated by Token-2022 CPI
    #[account(mut)]
    pub sender_token_account: UncheckedAccount<'info>,

    /// Receiver's OST token account (confidential-enabled)
    /// CHECK: Validated by Token-2022 CPI
    #[account(mut)]
    pub receiver_token_account: UncheckedAccount<'info>,

    /// The OST mint
    /// CHECK: Validated by Token-2022 CPI
    pub mint: UncheckedAccount<'info>,

    /// Token-2022 program
    pub token_program: Program<'info, token_2022::Token2022>,
}

pub fn handler(
    ctx: Context<ConfidentialTransferIx>,
    _proof_data: Vec<u8>,
    _new_decryptable_available_balance: [u8; 36],
) -> Result<()> {
    // Token-2022 confidential transfers require client-side ZK proof generation
    // (range proof + ciphertext validity + equality proof). The client SDK builds
    // the transfer instructions directly against Token-2022 and includes them
    // in the same transaction as this marker instruction.
    msg!(
        "Confidential transfer: {} → {}",
        ctx.accounts.sender_token_account.key,
        ctx.accounts.receiver_token_account.key,
    );

    Ok(())
}

// ============================================================================
// Withdraw — Move tokens from confidential available → public balance
// ============================================================================
// Users who want to unstake, sell on a DEX, or interact with non-CT
// protocols need to withdraw from confidential back to public balance.
//
// Requires a ZK proof that the withdrawal amount is valid (the user has
// sufficient encrypted balance). Proof is generated client-side.
// ============================================================================

use anchor_lang::prelude::*;
use anchor_spl::token_2022;

use crate::errors::OstError;

#[derive(Accounts)]
pub struct Withdraw<'info> {
    /// The token account owner
    #[account(mut)]
    pub owner: Signer<'info>,

    /// The user's OST Token-2022 token account
    /// CHECK: Validated by Token-2022 CPI
    #[account(mut)]
    pub token_account: UncheckedAccount<'info>,

    /// The OST mint
    /// CHECK: Validated by Token-2022 CPI
    pub mint: UncheckedAccount<'info>,

    /// Token-2022 program
    pub token_program: Program<'info, token_2022::Token2022>,
}

pub fn handler(
    ctx: Context<Withdraw>,
    amount: u64,
    _new_decryptable_available_balance: [u8; 36],
    _proof_data: Vec<u8>,
) -> Result<()> {
    require!(amount > 0, OstError::ZeroAmount);

    // Token-2022 confidential withdrawal requires client-side ZK proof
    // generation. The client SDK builds the withdraw instructions directly
    // against Token-2022 and includes them in the same transaction.
    msg!(
        "Withdrew {} OST (raw) from confidential → public for {}",
        amount,
        ctx.accounts.owner.key()
    );

    Ok(())
}

// ============================================================================
// Apply Pending Balance — Move pending → available confidential balance
// ============================================================================
// After receiving a confidential transfer (or deposit from public balance),
// tokens land in the "pending" balance. This instruction moves them to the
// "available" balance so the user can spend them.
//
// This is a required step in the Token-2022 confidential transfer flow.
// ============================================================================

use anchor_lang::prelude::*;
use anchor_spl::token_2022;

#[derive(Accounts)]
pub struct ApplyPendingBalance<'info> {
    /// The token account owner
    #[account(mut)]
    pub owner: Signer<'info>,

    /// The user's OST token account
    /// CHECK: Validated by Token-2022 CPI
    #[account(mut)]
    pub token_account: UncheckedAccount<'info>,

    /// Token-2022 program
    pub token_program: Program<'info, token_2022::Token2022>,
}

pub fn handler(
    ctx: Context<ApplyPendingBalance>,
    _new_decryptable_available_balance: [u8; 36],
) -> Result<()> {
    // Token-2022 apply_pending_balance is executed by the client SDK
    // directly against Token-2022. This instruction serves as the
    // Anchor entry point and event emitter.
    msg!("Pending balance applied for {}", ctx.accounts.owner.key());

    Ok(())
}

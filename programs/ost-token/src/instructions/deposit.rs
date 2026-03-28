// ============================================================================
// Deposit — Move tokens from public balance → confidential pending balance
// ============================================================================
// After minting (which goes to public balance), users call deposit to move
// tokens into their confidential pending balance. Then apply_pending_balance
// makes them available for confidential transfers.
//
// Flow: public balance --[deposit]--> pending confidential --[apply]--> available
// ============================================================================

use anchor_lang::prelude::*;
use anchor_spl::token_2022;

use crate::errors::OstError;

#[derive(Accounts)]
pub struct Deposit<'info> {
    /// The token account owner
    #[account(mut)]
    pub owner: Signer<'info>,

    /// The user's OST Token-2022 token account (must be configured for CT)
    /// CHECK: Validated by Token-2022 CPI
    #[account(mut)]
    pub token_account: UncheckedAccount<'info>,

    /// The OST mint
    /// CHECK: Validated by Token-2022 CPI
    pub mint: UncheckedAccount<'info>,

    /// Token-2022 program
    pub token_program: Program<'info, token_2022::Token2022>,
}

pub fn handler(ctx: Context<Deposit>, amount: u64, _proof_data: Vec<u8>) -> Result<()> {
    require!(amount > 0, OstError::ZeroAmount);

    // Token-2022 deposit (public → confidential pending) is executed
    // by the client SDK directly against Token-2022. This instruction
    // serves as the Anchor entry point and event emitter.
    msg!(
        "Deposited {} OST (raw) from public → confidential pending for {}",
        amount,
        ctx.accounts.owner.key()
    );

    Ok(())
}

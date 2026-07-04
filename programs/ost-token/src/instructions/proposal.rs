// ============================================================================
// Create Proposal — Governance proposal for OST upgrades
// ============================================================================
// Only the admin can create proposals. Stakers vote on proposals like:
//   - Adding quantum-resistance to the encryption layer
//   - Enabling on-chain ZK tax-report tools
//   - Modifying staking parameters
//   - Protocol upgrades
//
// Voting period defaults to 7 days from creation.
// ============================================================================

use anchor_lang::prelude::*;

use crate::errors::OstError;
use crate::state::{MintConfig, Proposal};

#[derive(Accounts)]
#[instruction(proposal_id: u64)]
pub struct CreateProposal<'info> {
    /// The admin (must match mint_config.admin)
    #[account(mut)]
    pub admin: Signer<'info>,

    /// Mint config to verify admin
    #[account(
        seeds = [b"mint-config"],
        bump = mint_config.bump,
    )]
    pub mint_config: Account<'info, MintConfig>,

    /// The new proposal PDA
    #[account(
        init,
        payer = admin,
        space = Proposal::LEN,
        seeds = [b"proposal", &proposal_id.to_le_bytes()],
        bump,
    )]
    pub proposal: Account<'info, Proposal>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<CreateProposal>, proposal_id: u64, description: String) -> Result<()> {
    require!(
        ctx.accounts.admin.key() == ctx.accounts.mint_config.admin,
        OstError::Unauthorized
    );
    require!(
        description.len() <= Proposal::MAX_DESCRIPTION_LEN,
        OstError::DescriptionTooLong
    );

    let now = Clock::get()?.unix_timestamp;
    let proposal = &mut ctx.accounts.proposal;

    proposal.proposal_id = proposal_id;
    proposal.proposer = ctx.accounts.admin.key();
    proposal.description = description;
    proposal.votes_for = 0;
    proposal.votes_against = 0;
    proposal.voting_ends_at = now
        .checked_add(Proposal::VOTING_PERIOD)
        .ok_or(OstError::Overflow)?;
    proposal.executed = false;
    proposal.bump = ctx.bumps.proposal;

    msg!(
        "Proposal {} created. Voting ends at {}",
        proposal_id,
        proposal.voting_ends_at
    );

    Ok(())
}

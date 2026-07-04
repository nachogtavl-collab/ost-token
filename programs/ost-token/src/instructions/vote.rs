// ============================================================================
// Vote — Cast governance vote weighted by staked OST
// ============================================================================
// Users can vote FOR or AGAINST a proposal. Vote weight = staked amount.
// A VoteRecord PDA prevents double-voting on the same proposal.
// ============================================================================

use anchor_lang::prelude::*;

use crate::errors::OstError;
use crate::state::{Proposal, StakeAccount, VoteRecord};

#[derive(Accounts)]
#[instruction(proposal_id: u64)]
pub struct CastVote<'info> {
    /// The voter
    #[account(mut)]
    pub voter: Signer<'info>,

    /// The voter's stake record (determines vote weight)
    #[account(
        seeds = [b"stake", voter.key().as_ref()],
        bump = stake_account.bump,
        has_one = owner @ OstError::Unauthorized,
    )]
    pub stake_account: Account<'info, StakeAccount>,

    /// Alias constraint: stake_account.owner == voter
    /// CHECK: Verified by has_one above
    pub owner: UncheckedAccount<'info>,

    /// The proposal being voted on
    #[account(
        mut,
        seeds = [b"proposal", &proposal_id.to_le_bytes()],
        bump = proposal.bump,
    )]
    pub proposal: Account<'info, Proposal>,

    /// Vote record PDA — prevents double voting
    #[account(
        init,
        payer = voter,
        space = VoteRecord::LEN,
        seeds = [b"vote", voter.key().as_ref(), &proposal_id.to_le_bytes()],
        bump,
    )]
    pub vote_record: Account<'info, VoteRecord>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<CastVote>, proposal_id: u64, approve: bool) -> Result<()> {
    let proposal = &mut ctx.accounts.proposal;
    let stake = &ctx.accounts.stake_account;
    let now = Clock::get()?.unix_timestamp;

    // ---- Verify voting period is still open ----
    require!(now < proposal.voting_ends_at, OstError::VotingPeriodEnded);

    // ---- Must have staked tokens to vote ----
    require!(stake.amount > 0, OstError::InsufficientStake);

    let weight = stake.amount;

    // ---- Tally vote ----
    if approve {
        proposal.votes_for = proposal
            .votes_for
            .checked_add(weight)
            .ok_or(OstError::Overflow)?;
    } else {
        proposal.votes_against = proposal
            .votes_against
            .checked_add(weight)
            .ok_or(OstError::Overflow)?;
    }

    // ---- Record vote ----
    let record = &mut ctx.accounts.vote_record;
    record.voter = ctx.accounts.voter.key();
    record.proposal_id = proposal_id;
    record.approve = approve;
    record.weight = weight;
    record.bump = ctx.bumps.vote_record;

    msg!(
        "Vote cast on proposal {}: {} (weight: {})",
        proposal_id,
        if approve { "FOR" } else { "AGAINST" },
        weight,
    );

    Ok(())
}

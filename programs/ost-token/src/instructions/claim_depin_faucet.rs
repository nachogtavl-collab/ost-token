// ============================================================================
// Claim DePIN Faucet — Reward for Building Decentralized Infrastructure
// ============================================================================
//
// OST rewards users who contribute device resources (bandwidth, GPU, CPU,
// storage, satellite relay) to the decentralized data centers and satellite
// internet that will power the OST sovereign network.
//
// HOW IT WORKS:
//   1. User registers their DePIN contribution via ai_reward_stake.
//   2. Off-chain oracle (or attestation service) verifies contribution.
//   3. User calls claim_depin_faucet with their attestation proof.
//   4. Treasury sends OST reward based on resource type and duration.
//
// RESOURCE REWARD RATES (per claim, max once per day):
//   Bandwidth  → 0.5 OST
//   GPU        → 2.0 OST
//   CPU        → 1.0 OST
//   Storage    → 0.5 OST
//   LoRa/5G    → 1.5 OST
//   Satellite  → 3.0 OST
//
// ANTI-ABUSE:
//   - Requires an existing AiRewardStake record (must be active).
//   - Cooldown: 24 hours between claims (86400 seconds).
//   - Attestation hash must be unique per claim (prevents replay).
//   - Treasury authority PDA signs transfers.
//
// Reward for building the decentralized data centers and satellite internet.
// ============================================================================

use anchor_lang::prelude::*;
use anchor_spl::token_2022::{self, Token2022, TransferChecked};

use crate::errors::OstError;
use crate::state::{AiRewardStake, DaoTreasury, DepinClaim};

/// Cooldown between claims: 24 hours
pub const DEPIN_COOLDOWN: i64 = 86_400;

/// Reward amounts per resource type (9 decimals)
const DEPIN_REWARDS: [u64; 6] = [
    500_000_000,   // 0: Bandwidth  — 0.5 OST
    2_000_000_000, // 1: GPU        — 2.0 OST
    1_000_000_000, // 2: CPU        — 1.0 OST
    500_000_000,   // 3: Storage    — 0.5 OST
    1_500_000_000, // 4: LoRa/5G    — 1.5 OST
    3_000_000_000, // 5: Satellite  — 3.0 OST
];

#[derive(Accounts)]
pub struct ClaimDepinFaucet<'info> {
    /// The contributor claiming their DePIN reward
    #[account(mut)]
    pub contributor: Signer<'info>,

    /// Contributor's OST token account
    /// CHECK: Validated by Token-2022 CPI
    #[account(mut)]
    pub contributor_token_account: UncheckedAccount<'info>,

    /// Treasury token account (source of reward funds)
    /// CHECK: Validated by Token-2022 CPI
    #[account(mut)]
    pub treasury_token_account: UncheckedAccount<'info>,

    /// DAO Treasury config
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

    /// AI Reward Stake record — must exist and be active
    #[account(
        seeds = [b"ai-reward", contributor.key().as_ref()],
        bump = reward_stake.bump,
        constraint = reward_stake.user == contributor.key() @ OstError::Unauthorized,
        constraint = reward_stake.active @ OstError::DepinNotActive,
    )]
    pub reward_stake: Account<'info, AiRewardStake>,

    /// DePIN claim record — tracks cooldown and attestation uniqueness
    #[account(
        init_if_needed,
        payer = contributor,
        space = DepinClaim::LEN,
        seeds = [b"depin-claim", contributor.key().as_ref()],
        bump,
    )]
    pub depin_claim: Account<'info, DepinClaim>,

    /// The OST mint
    /// CHECK: Validated by Token-2022 CPI
    pub mint: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token2022>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<ClaimDepinFaucet>, attestation_hash: [u8; 32]) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let claim = &mut ctx.accounts.depin_claim;

    // Enforce 24-hour cooldown
    if claim.last_claim_at > 0 {
        require!(
            now.saturating_sub(claim.last_claim_at) >= DEPIN_COOLDOWN,
            OstError::DepinCooldownActive,
        );
    }

    // Prevent attestation replay
    require!(
        claim.last_attestation_hash != attestation_hash,
        OstError::DepinDuplicateAttestation,
    );

    // Determine reward based on resource type from the stake record
    let resource_type = ctx.accounts.reward_stake.resource_type as usize;
    require!(
        resource_type < DEPIN_REWARDS.len(),
        OstError::InvalidResourceType
    );
    let reward_amount = DEPIN_REWARDS[resource_type];

    // ---- Transfer reward from treasury → contributor ----
    let treasury_bump = ctx.bumps.treasury_authority;
    let seeds = &[b"treasury-authority".as_ref(), &[treasury_bump]];
    let signer_seeds = &[&seeds[..]];

    let cpi_accounts = TransferChecked {
        from: ctx.accounts.treasury_token_account.to_account_info(),
        to: ctx.accounts.contributor_token_account.to_account_info(),
        authority: ctx.accounts.treasury_authority.to_account_info(),
        mint: ctx.accounts.mint.to_account_info(),
    };
    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        cpi_accounts,
        signer_seeds,
    );
    token_2022::transfer_checked(cpi_ctx, reward_amount, 9)?;

    // ---- Update claim record ----
    claim.contributor = ctx.accounts.contributor.key();
    claim.last_claim_at = now;
    claim.total_claimed = claim
        .total_claimed
        .checked_add(reward_amount)
        .ok_or(OstError::Overflow)?;
    claim.claim_count = claim.claim_count.checked_add(1).ok_or(OstError::Overflow)?;
    claim.last_attestation_hash = attestation_hash;
    claim.bump = ctx.bumps.depin_claim;

    msg!(
        "DePIN faucet claimed: {} OST → {} (resource={}, building satellite internet!)",
        reward_amount,
        ctx.accounts.contributor.key(),
        resource_type,
    );

    Ok(())
}

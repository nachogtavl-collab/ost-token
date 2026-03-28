// ============================================================================
// Family Grow Vaults — Multi-Generational OST Accounts
// ============================================================================
//
// REVOLUTIONARY CONCEPT: Babies, toddlers, kids & teens get their own OST
// vault before they can even speak. Parents/guardians create a custodial
// "Grow Vault" PDA linked to their wallet, with a birth year and milestone
// tracking. The vault receives tiny faucet drops from the community treasury
// at age milestones — making OST the first coin to be "born in space" with
// every new generation.
//
// HOW IT WORKS:
//   1. Parent calls create_grow_vault with child_birth_year.
//   2. Vault PDA is created, linked to parent's wallet.
//   3. At milestone ages (0, 1, 5, 10, 13, 16, 18), parent can call
//      claim_grow_faucet to receive a small OST drop from treasury.
//   4. At age 18, the vault is marked "graduated" — the child can take
//      full control by linking their own wallet.
//
// PRIVACY-FIRST:
//   - No real KYC: just a birth year flag (not a birthdate or name).
//   - Confidential-enabled from day one.
//   - The child's "view" is read-only until age 18.
//   - All faucet drops are tiny educational amounts, not investment.
//
// LEGAL DISCLAIMER (enforced on-site):
//   "For educational use only. Parents/guardians are responsible for all
//    tax, custody, and local laws regarding gifts to minors. OST is not
//    investment advice. Parental consent required for all child accounts."
//
// MILESTONE REWARDS (from treasury):
//   Age  0 → 1.0 OST   "Born in space"
//   Age  1 → 0.5 OST   "First orbit"
//   Age  5 → 1.0 OST   "Kindergarten explorer"
//   Age 10 → 2.0 OST   "Junior astronaut"
//   Age 13 → 3.0 OST   "Teen pioneer"
//   Age 16 → 5.0 OST   "Cadet"
//   Age 18 → 10.0 OST  "Full citizen of the OST universe"
//
// Family Grow Accounts for the next generation of space citizens.
// ============================================================================

use anchor_lang::prelude::*;
use anchor_spl::token_2022::{self, Token2022, TransferChecked};

use crate::state::{DaoTreasury, GrowVault};
use crate::errors::OstError;

/// Milestone ages and their OST rewards (raw amounts with 9 decimals)
const MILESTONES: [(u16, u64); 7] = [
    (0,  1_000_000_000),   // Born in space — 1 OST
    (1,    500_000_000),   // First orbit — 0.5 OST
    (5,  1_000_000_000),   // Kindergarten explorer — 1 OST
    (10, 2_000_000_000),   // Junior astronaut — 2 OST
    (13, 3_000_000_000),   // Teen pioneer — 3 OST
    (16, 5_000_000_000),   // Cadet — 5 OST
    (18, 10_000_000_000),  // Full citizen — 10 OST
];

// ============================================================================
// CREATE GROW VAULT
// ============================================================================

#[derive(Accounts)]
pub struct CreateGrowVault<'info> {
    /// Parent/guardian who controls the vault
    #[account(mut)]
    pub parent: Signer<'info>,

    /// Grow Vault PDA — one per parent
    #[account(
        init,
        payer = parent,
        space = GrowVault::LEN,
        seeds = [b"grow-vault", parent.key().as_ref()],
        bump,
    )]
    pub grow_vault: Account<'info, GrowVault>,

    pub system_program: Program<'info, System>,
}

pub fn handler_create(ctx: Context<CreateGrowVault>, child_birth_year: u16) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    // Approximate current year (Unix seconds / seconds-per-year + 1970)
    let current_year = 1970u16.saturating_add((now / 31_557_600) as u16);

    // Birth year must be reasonable: not in the future, not before 2000
    require!(child_birth_year >= 2000, OstError::InvalidBirthYear);
    require!(child_birth_year <= current_year, OstError::InvalidBirthYear);

    let vault = &mut ctx.accounts.grow_vault;
    vault.parent = ctx.accounts.parent.key();
    vault.child_birth_year = child_birth_year;
    vault.milestones_claimed = 0; // bitmask: bit 0 = age 0, bit 1 = age 1, ...
    vault.total_received = 0;
    vault.created_at = now;
    vault.graduated = false;
    vault.bump = ctx.bumps.grow_vault;

    msg!(
        "Grow Vault created: parent={}, child_birth_year={} — welcome to space, little one!",
        ctx.accounts.parent.key(),
        child_birth_year,
    );

    Ok(())
}

// ============================================================================
// CLAIM GROW FAUCET — Milestone-Based Treasury Rewards
// ============================================================================

#[derive(Accounts)]
pub struct ClaimGrowFaucet<'info> {
    /// Parent/guardian (must match vault.parent)
    #[account(mut)]
    pub parent: Signer<'info>,

    /// Parent's OST token account (receives the faucet drop for the child)
    /// CHECK: Validated by Token-2022 CPI
    #[account(mut)]
    pub parent_token_account: UncheckedAccount<'info>,

    /// Treasury token account (source of faucet funds)
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

    /// Grow Vault PDA — must belong to parent
    #[account(
        mut,
        seeds = [b"grow-vault", parent.key().as_ref()],
        bump = grow_vault.bump,
        constraint = grow_vault.parent == parent.key() @ OstError::Unauthorized,
        constraint = !grow_vault.graduated @ OstError::VaultAlreadyGraduated,
    )]
    pub grow_vault: Account<'info, GrowVault>,

    /// The OST mint
    /// CHECK: Validated by Token-2022 CPI
    pub mint: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token2022>,
    pub system_program: Program<'info, System>,
}

pub fn handler_claim(ctx: Context<ClaimGrowFaucet>, milestone_index: u8) -> Result<()> {
    require!(
        (milestone_index as usize) < MILESTONES.len(),
        OstError::InvalidMilestone,
    );

    let vault = &mut ctx.accounts.grow_vault;
    let now = Clock::get()?.unix_timestamp;
    let current_year = 1970u16.saturating_add((now / 31_557_600) as u16);
    let child_age = current_year.saturating_sub(vault.child_birth_year);

    let (required_age, reward_amount) = MILESTONES[milestone_index as usize];

    // Child must have reached the milestone age
    require!(child_age >= required_age, OstError::MilestoneNotReached);

    // Check bitmask — each milestone can only be claimed once
    let milestone_bit = 1u8 << milestone_index;
    require!(
        vault.milestones_claimed & milestone_bit == 0,
        OstError::MilestoneAlreadyClaimed,
    );

    // ---- Transfer reward from treasury → parent (for child) ----
    let treasury_bump = ctx.bumps.treasury_authority;
    let seeds = &[b"treasury-authority".as_ref(), &[treasury_bump]];
    let signer_seeds = &[&seeds[..]];

    let cpi_accounts = TransferChecked {
        from: ctx.accounts.treasury_token_account.to_account_info(),
        to: ctx.accounts.parent_token_account.to_account_info(),
        authority: ctx.accounts.treasury_authority.to_account_info(),
        mint: ctx.accounts.mint.to_account_info(),
    };
    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        cpi_accounts,
        signer_seeds,
    );
    token_2022::transfer_checked(cpi_ctx, reward_amount, 9)?;

    // ---- Update vault state ----
    vault.milestones_claimed |= milestone_bit;
    vault.total_received = vault.total_received.checked_add(reward_amount)
        .ok_or(OstError::Overflow)?;

    // If age 18 milestone claimed, mark vault as graduated
    if required_age == 18 {
        vault.graduated = true;
    }

    msg!(
        "Grow Vault milestone claimed: age={}, reward={} OST, parent={}",
        required_age,
        reward_amount,
        ctx.accounts.parent.key(),
    );

    Ok(())
}

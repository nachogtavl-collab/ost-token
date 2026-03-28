// ============================================================================
// Custom Errors for OST Token Program
// ============================================================================

use anchor_lang::prelude::*;

#[error_code]
pub enum OstError {
    #[msg("Confidential transfers must be enabled for this mint")]
    ConfidentialTransfersNotEnabled,

    #[msg("Stake lock period has not elapsed yet")]
    StakeLockNotExpired,

    #[msg("Insufficient staked balance")]
    InsufficientStake,

    #[msg("Voting period for this proposal has ended")]
    VotingPeriodEnded,

    #[msg("Voting period for this proposal has not ended yet")]
    VotingPeriodNotEnded,

    #[msg("User has already voted on this proposal")]
    AlreadyVoted,

    #[msg("Proposal description exceeds maximum length")]
    DescriptionTooLong,

    #[msg("Invalid proof data provided")]
    InvalidProofData,

    #[msg("Tax year must be between 2020 and 2100")]
    InvalidTaxYear,

    #[msg("Unauthorized: only admin can perform this action")]
    Unauthorized,

    #[msg("Amount must be greater than zero")]
    ZeroAmount,

    #[msg("Arithmetic overflow")]
    Overflow,

    #[msg("Proposal has already been executed")]
    ProposalAlreadyExecuted,

    #[msg("Cannot unstake zero amount")]
    NothingToUnstake,

    #[msg("Fee basis points cannot exceed 1000 (10%)")]
    FeeTooHigh,

    #[msg("Merchant label exceeds maximum length")]
    MerchantLabelTooLong,

    #[msg("Merchant account is not active")]
    MerchantNotActive,

    #[msg("DAO treasury not initialized")]
    TreasuryNotInitialized,

    #[msg("Deposit amount exceeds public balance")]
    InsufficientPublicBalance,

    #[msg("Bearer note has already been redeemed")]
    BearerNoteAlreadyRedeemed,

    #[msg("Bearer note has expired")]
    BearerNoteExpired,

    #[msg("Bearer note secret does not match hash")]
    BearerNoteInvalidSecret,

    #[msg("Faucet has already been claimed by this wallet")]
    FaucetAlreadyClaimed,

    #[msg("Invalid DePIN provider code")]
    InvalidProvider,

    #[msg("Invalid resource type code")]
    InvalidResourceType,
}

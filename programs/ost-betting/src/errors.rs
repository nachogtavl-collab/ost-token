use anchor_lang::prelude::*;

#[error_code]
pub enum BettingError {
    #[msg("Market is already locked for new bets")]
    MarketLocked,
    #[msg("Market has already been resolved")]
    MarketAlreadyResolved,
    #[msg("Market has not been resolved yet")]
    MarketNotResolved,
    #[msg("Only market authority can perform this action")]
    Unauthorized,
    #[msg("Invalid side. Use 0 for NO and 1 for YES")]
    InvalidSide,
    #[msg("Stake must be greater than zero")]
    InvalidStake,
    #[msg("Nothing to claim")]
    NothingToClaim,
    #[msg("Position has already been claimed")]
    AlreadyClaimed,
    #[msg("Math overflow")]
    MathOverflow,
    #[msg("Market cannot be resolved before resolve timestamp")]
    ResolveTooEarly,
}

use anchor_lang::prelude::*;

#[error_code]
pub enum GameError {
    #[msg("Stake must be greater than zero")]
    InvalidStake,
    #[msg("Stake is above the house limit for this bet")]
    StakeTooLarge,
    #[msg("Unknown game kind")]
    InvalidGame,
    #[msg("Game parameter is out of range")]
    InvalidParam,
    #[msg("This bet has already been settled")]
    AlreadySettled,
    #[msg("Randomness account does not match the one this bet was committed to")]
    WrongRandomness,
    #[msg("Randomness was not committed to a future slot — the value could already be known")]
    RandomnessNotFresh,
    #[msg("Randomness has not been revealed by the oracle yet")]
    RandomnessNotResolved,
    #[msg("Treasury does not match the one pinned on the house")]
    WrongTreasury,
    #[msg("House vault cannot cover the maximum payout for this bet")]
    InsufficientHouseLiquidity,
    #[msg("Math overflow")]
    MathOverflow,
}

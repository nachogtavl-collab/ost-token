use anchor_lang::prelude::*;

#[account]
pub struct Market {
    pub authority: Pubkey,
    pub mint: Pubkey,        // the OST mint this market escrows (Token-2022)
    pub market_id: u64,
    pub bump: u8,
    pub vault_bump: u8,
    pub created_at: i64,
    pub lock_ts: i64,
    pub resolve_ts: i64,
    pub yes_pool: u64,
    pub no_pool: u64,
    pub resolved: bool,
    pub winning_side: u8,
}

impl Market {
    pub const SIZE: usize = 32 + 32 + 8 + 1 + 1 + 8 + 8 + 8 + 8 + 8 + 1 + 1;
}

#[account]
pub struct Position {
    pub market: Pubkey,
    pub bettor: Pubkey,
    pub side: u8,
    pub stake: u64,
    pub claimed: bool,
}

impl Position {
    pub const SIZE: usize = 32 + 32 + 1 + 8 + 1;
}

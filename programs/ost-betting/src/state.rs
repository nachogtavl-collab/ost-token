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

    // ---- Pyth-verified settlement -----------------------------------------
    // The market carries the oracle feed it settles against and the OPEN price
    // locked from that feed on-chain. resolve() then reads the CLOSE price from
    // the same feed and decides the winner itself. No human, not even the
    // market creator, can choose the outcome.
    pub feed_id: [u8; 32],   // Pyth feed id (e.g. BTC/USD)
    pub open_price: i64,     // locked from Pyth at/after lock_ts
    pub open_expo: i32,
    pub close_price: i64,    // read from Pyth at resolve

    // ---- House edge (on-chain) --------------------------------------------
    // The treasury token account is PINNED at market creation, so a claimer can
    // never redirect the rake to an account they control.
    pub treasury_token: Pubkey,
    pub fees_collected: u64, // running total of rake taken by this market

    // ---- Market kind ------------------------------------------------------
    // 0 = PRICE market: resolves from Pyth (close vs open), `feed_id` is a Pyth
    //     feed id. 1 = EVENT market: resolves from a Switchboard pull feed,
    //     `feed_id` holds that feed account's pubkey bytes (arbitrary events —
    //     elections, sports, "will X happen"). Appended at the end so a fresh
    //     program's new markets carry it; existing (price) markets are unaffected.
    pub market_kind: u8,
}

impl Market {
    pub const SIZE: usize =
        32 + 32 + 8 + 1 + 1 + 8 + 8 + 8 + 8 + 8 + 1 + 1  // original
        + 32 + 8 + 4 + 8                                   // feed_id, open_price, open_expo, close_price
        + 32 + 8                                           // treasury_token, fees_collected
        + 1;                                               // market_kind
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

use anchor_lang::prelude::*;

/// Which game a bet is for. Each payout curve is a pure function of the revealed
/// randomness, so anyone can recompute a settled bet and check it themselves.
///
/// Only games whose payout is fully expressible on-chain live here. Plinko's
/// bucket table is deliberately NOT included yet — shipping half of it would let
/// the UI claim "on-chain fairness" for a game the chain does not actually
/// settle. It stays off-chain, and labelled as such, until its table is here.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum GameKind {
    /// Coinflip. `param` unused. Fair odds: wins pay 2x the stake.
    Coinflip,
    /// Dice: wins when roll (0..99) < `param`. Fair odds: 100/param.
    Dice,
}

#[account]
pub struct Bet {
    pub player: Pubkey,
    pub mint: Pubkey,
    /// The Switchboard randomness account this bet is bound to. Settlement MUST
    /// read this exact account, so a player cannot swap in a different one after
    /// seeing a value they like.
    pub randomness: Pubkey,
    /// The slot the randomness was committed to. The value does not exist yet at
    /// commit time — this pins WHICH future value is allowed to settle this bet.
    pub commit_slot: u64,
    pub kind: u8,
    pub param: u8,
    pub stake: u64,
    /// The most this bet can ever pay. Reserved against the house vault at commit
    /// so the house can always cover it.
    pub max_payout: u64,
    pub bump: u8,
    pub settled: bool,
    /// Written at settlement, for auditability.
    pub payout: u64,
    pub fee: u64,
    /// First 8 bytes of the revealed randomness — lets anyone re-derive the roll.
    pub revealed: [u8; 8],
}

impl Bet {
    pub const SIZE: usize = 32 + 32 + 32 + 8 + 1 + 1 + 8 + 8 + 1 + 1 + 8 + 8 + 8;
}

/// House config: the vault that backs payouts and the treasury that takes the
/// edge. Created once, owned by the program.
#[account]
pub struct House {
    pub authority: Pubkey,
    pub mint: Pubkey,
    pub treasury_token: Pubkey,
    pub bump: u8,
    pub vault_bump: u8,
    /// Sum of max_payout across every unsettled bet. The vault must always be
    /// able to cover this — otherwise the house could take bets it cannot pay,
    /// which is how a casino goes insolvent on a hot streak.
    pub outstanding_liability: u64,
    /// The house's books, on-chain and auditable by anyone.
    pub total_wagered: u64,
    pub total_paid: u64,
    pub fees_collected: u64,
}

impl House {
    pub const SIZE: usize = 32 + 32 + 32 + 1 + 1 + 8 + 8 + 8 + 8;
}

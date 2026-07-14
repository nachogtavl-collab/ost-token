/* ============================================================================
 * OST · On-chain games — REAL randomness, real OST, on-chain house edge
 * ----------------------------------------------------------------------------
 * WHY THIS EXISTS
 *
 * The web app's "provably fair" games were not fair. `docs/ost-games.js`
 * generates the SERVER seed with crypto.getRandomValues() *in the player's own
 * browser* and keeps it in localStorage. The player therefore holds the secret
 * the house is supposed to have committed to — anyone who opens devtools can
 * read it and predict every roll before betting. A commit-reveal where the
 * player holds both seeds proves nothing.
 *
 * This program fixes that at the root:
 *
 *   commit_bet  — the player escrows OST and BINDS the bet to a Switchboard
 *                 randomness account that is committed to a FUTURE slot. The
 *                 value does not exist yet, so nobody — player, house, or the
 *                 crank — can know or influence the outcome at bet time.
 *   settle_bet  — the oracle has revealed the value; the PROGRAM reads it,
 *                 derives the roll, and pays out. Anyone can recompute it.
 *
 * The house edge (2% of PROFIT only, never the stake) is taken by the program,
 * matching ost-betting and docs/ost-house.js.
 *
 * SOLVENCY: every bet reserves its maximum payout against the vault, so the
 * house can never accept a bet it cannot pay.
 * ========================================================================== */
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};
use switchboard_on_demand::accounts::RandomnessAccountData;

pub mod errors;
pub mod state;

use errors::GameError;
use state::{Bet, GameKind, House};

declare_id!("3Z1ZEG4VF83vUNZs1teNuJBozaF6jDZwKy34AxZiD5sa");

/// House edge in basis points, taken from the PROFIT only. Same rule and same
/// number as ost-betting and docs/ost-house.js. Compile-time constant on
/// purpose: nobody can raise the rake on a bet that is already in flight.
pub const HOUSE_FEE_BPS: u64 = 200;

/// Dice target bounds. The upper bound keeps the game honest (a 99 target is a
/// near-certain win and a pointless bet); the LOWER bound caps the maximum
/// multiplier at 20x, which bounds how much the house must reserve per bet.
pub const DICE_MIN_TARGET: u8 = 5;
pub const DICE_MAX_TARGET: u8 = 95;

#[program]
pub mod ost_games {
    use super::*;

    /// Create the house: one vault (PDA-owned) backing every payout, and the
    /// treasury the edge is swept into. The treasury is PINNED here, so it can
    /// never be redirected at settlement.
    pub fn initialize_house(ctx: Context<InitializeHouse>) -> Result<()> {
        let house = &mut ctx.accounts.house;
        house.authority = ctx.accounts.authority.key();
        house.mint = ctx.accounts.mint.key();
        house.treasury_token = ctx.accounts.treasury_token.key();
        house.bump = ctx.bumps.house;
        house.vault_bump = ctx.bumps.vault;
        house.outstanding_liability = 0;
        house.total_wagered = 0;
        house.total_paid = 0;
        house.fees_collected = 0;
        Ok(())
    }

    /// Place a bet against randomness that DOES NOT EXIST YET.
    pub fn commit_bet(ctx: Context<CommitBet>, kind: u8, param: u8, stake: u64) -> Result<()> {
        require!(stake > 0, GameError::InvalidStake);
        let game = decode_kind(kind)?;
        validate_param(game, param)?;

        // The maximum this bet could pay, at FAIR odds (the edge is only taken
        // from profit at settlement, so the base game itself is not shaded).
        let max_payout = fair_payout(game, param, stake)?;

        // ---- Freshness: the value must not be knowable yet --------------------
        // Switchboard commits a randomness account to a future slot. We require
        // the commit to have happened in the PREVIOUS slot, so the oracle has not
        // revealed anything and the player is betting blind. Without this check a
        // player could commit, wait to see the value, and only then place the bet
        // that wins — which is the on-chain version of the localStorage bug.
        let clock = Clock::get()?;
        let randomness_data =
            RandomnessAccountData::parse(ctx.accounts.randomness_account_data.data.borrow())
                .map_err(|_| error!(GameError::RandomnessNotFresh))?;
        require!(
            randomness_data.seed_slot == clock.slot - 1,
            GameError::RandomnessNotFresh
        );

        // ---- Solvency: never take a bet the house cannot pay ------------------
        let vault_after = ctx
            .accounts
            .vault
            .amount
            .checked_add(stake)
            .ok_or(GameError::MathOverflow)?;
        let liability_after = ctx
            .accounts
            .house
            .outstanding_liability
            .checked_add(max_payout)
            .ok_or(GameError::MathOverflow)?;
        require!(
            vault_after >= liability_after,
            GameError::InsufficientHouseLiquidity
        );

        // Escrow the stake in the house vault.
        token_interface::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.player_token.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.player.to_account_info(),
                },
            ),
            stake,
            ctx.accounts.mint.decimals,
        )?;

        let bet = &mut ctx.accounts.bet;
        bet.player = ctx.accounts.player.key();
        bet.mint = ctx.accounts.mint.key();
        bet.randomness = ctx.accounts.randomness_account_data.key();
        bet.commit_slot = randomness_data.seed_slot;
        bet.kind = kind;
        bet.param = param;
        bet.stake = stake;
        bet.max_payout = max_payout;
        bet.bump = ctx.bumps.bet;
        bet.settled = false;
        bet.payout = 0;
        bet.fee = 0;
        bet.revealed = [0u8; 8];

        let house = &mut ctx.accounts.house;
        house.outstanding_liability = liability_after;
        house.total_wagered = house
            .total_wagered
            .checked_add(stake)
            .ok_or(GameError::MathOverflow)?;

        emit!(BetCommitted {
            bet: bet.key(),
            player: bet.player,
            kind,
            param,
            stake,
            max_payout,
            commit_slot: bet.commit_slot,
        });
        Ok(())
    }

    /// Settle against the revealed oracle value. Permissionless: anyone can
    /// settle anyone's bet, so a player can always get paid even if the app,
    /// the crank, and the house all disappear.
    pub fn settle_bet(ctx: Context<SettleBet>) -> Result<()> {
        require!(!ctx.accounts.bet.settled, GameError::AlreadySettled);
        require!(
            ctx.accounts.randomness_account_data.key() == ctx.accounts.bet.randomness,
            GameError::WrongRandomness
        );

        let clock = Clock::get()?;
        let randomness_data =
            RandomnessAccountData::parse(ctx.accounts.randomness_account_data.data.borrow())
                .map_err(|_| error!(GameError::RandomnessNotResolved))?;

        // The account must still be the SAME committed draw. If it were re-committed
        // to a new slot, its value would be a different draw than the one this bet
        // was placed blind against — settling on that would let a player re-roll.
        require!(
            randomness_data.seed_slot == ctx.accounts.bet.commit_slot,
            GameError::WrongRandomness
        );

        // Fails until the oracle has actually revealed the value.
        let revealed = randomness_data
            .get_value(&clock)
            .map_err(|_| error!(GameError::RandomnessNotResolved))?;

        let bet_kind = decode_kind(ctx.accounts.bet.kind)?;
        let stake = ctx.accounts.bet.stake;
        let param = ctx.accounts.bet.param;

        // The roll: a pure function of the oracle's bytes. Anyone can recompute it.
        let roll = roll_from(&revealed);
        let won = match bet_kind {
            GameKind::Coinflip => roll % 2 == 0,
            GameKind::Dice => roll < param as u64,
        };

        let gross = if won {
            fair_payout(bet_kind, param, stake)?
        } else {
            0
        };

        // House edge: profit only. A loss is never taxed (there is no profit).
        let profit = gross.saturating_sub(stake);
        let fee = (profit as u128)
            .checked_mul(HOUSE_FEE_BPS as u128)
            .ok_or(GameError::MathOverflow)?
            .checked_div(10_000u128)
            .ok_or(GameError::MathOverflow)? as u64;
        let net = gross.checked_sub(fee).ok_or(GameError::MathOverflow)?;

        // Vault is owned by the HOUSE PDA — sign with the house's seeds.
        let mint_key = ctx.accounts.house.mint;
        let house_bump = [ctx.accounts.house.bump];
        let signer_seeds: &[&[&[u8]]] = &[&[b"house", mint_key.as_ref(), &house_bump]];

        if net > 0 {
            token_interface::transfer_checked(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    TransferChecked {
                        from: ctx.accounts.vault.to_account_info(),
                        mint: ctx.accounts.mint.to_account_info(),
                        to: ctx.accounts.player_token.to_account_info(),
                        authority: ctx.accounts.house.to_account_info(),
                    },
                    signer_seeds,
                ),
                net,
                ctx.accounts.mint.decimals,
            )?;
        }
        if fee > 0 {
            token_interface::transfer_checked(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    TransferChecked {
                        from: ctx.accounts.vault.to_account_info(),
                        mint: ctx.accounts.mint.to_account_info(),
                        to: ctx.accounts.treasury_token.to_account_info(),
                        authority: ctx.accounts.house.to_account_info(),
                    },
                    signer_seeds,
                ),
                fee,
                ctx.accounts.mint.decimals,
            )?;
        }

        let max_payout = ctx.accounts.bet.max_payout;
        let house = &mut ctx.accounts.house;
        // Release the reservation this bet held against the vault.
        house.outstanding_liability = house.outstanding_liability.saturating_sub(max_payout);
        house.total_paid = house
            .total_paid
            .checked_add(net)
            .ok_or(GameError::MathOverflow)?;
        house.fees_collected = house
            .fees_collected
            .checked_add(fee)
            .ok_or(GameError::MathOverflow)?;

        let bet = &mut ctx.accounts.bet;
        bet.settled = true;
        bet.payout = net;
        bet.fee = fee;
        bet.revealed.copy_from_slice(&revealed[0..8]);

        emit!(BetSettled {
            bet: bet.key(),
            player: bet.player,
            roll,
            won,
            stake,
            gross,
            fee,
            net,
        });
        Ok(())
    }

    /// Anyone can top the vault up — it backs the payouts, so a deeper vault
    /// simply means the house can accept bigger bets.
    pub fn fund_house(ctx: Context<FundHouse>, amount: u64) -> Result<()> {
        require!(amount > 0, GameError::InvalidStake);
        token_interface::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.funder_token.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.funder.to_account_info(),
                },
            ),
            amount,
            ctx.accounts.mint.decimals,
        )?;
        Ok(())
    }
}

// ---- pure game math (anyone can recompute these) ---------------------------

fn decode_kind(kind: u8) -> Result<GameKind> {
    match kind {
        0 => Ok(GameKind::Coinflip),
        1 => Ok(GameKind::Dice),
        _ => Err(error!(GameError::InvalidGame)),
    }
}

fn validate_param(kind: GameKind, param: u8) -> Result<()> {
    match kind {
        GameKind::Coinflip => Ok(()),
        GameKind::Dice => {
            require!(
                param >= DICE_MIN_TARGET && param <= DICE_MAX_TARGET,
                GameError::InvalidParam
            );
            Ok(())
        }
    }
}

/// The payout at FAIR odds (before the edge). Coinflip: 2x. Dice: 100/param.
/// The house's only margin is the profit-only edge taken at settlement — the
/// odds themselves are not secretly shaded, which is the honest way to do it.
fn fair_payout(kind: GameKind, param: u8, stake: u64) -> Result<u64> {
    let mult_bps: u128 = match kind {
        GameKind::Coinflip => 20_000,
        // 100/param, in basis points: 1_000_000 / param.
        GameKind::Dice => 1_000_000u128
            .checked_div(param as u128)
            .ok_or(GameError::MathOverflow)?,
    };
    let out = (stake as u128)
        .checked_mul(mult_bps)
        .ok_or(GameError::MathOverflow)?
        .checked_div(10_000u128)
        .ok_or(GameError::MathOverflow)?;
    Ok(u64::try_from(out).map_err(|_| error!(GameError::MathOverflow))?)
}

/// Derive a 0..99 roll from the oracle's 32 bytes. Uses the first 8 bytes as a
/// little-endian u64 so the derivation is trivial to reproduce off-chain.
fn roll_from(revealed: &[u8; 32]) -> u64 {
    let mut b = [0u8; 8];
    b.copy_from_slice(&revealed[0..8]);
    u64::from_le_bytes(b) % 100
}

// ---- events ---------------------------------------------------------------

#[event]
pub struct BetCommitted {
    pub bet: Pubkey,
    pub player: Pubkey,
    pub kind: u8,
    pub param: u8,
    pub stake: u64,
    pub max_payout: u64,
    pub commit_slot: u64,
}

#[event]
pub struct BetSettled {
    pub bet: Pubkey,
    pub player: Pubkey,
    pub roll: u64,
    pub won: bool,
    pub stake: u64,
    pub gross: u64,
    pub fee: u64,
    pub net: u64,
}

// ---- accounts -------------------------------------------------------------

#[derive(Accounts)]
pub struct InitializeHouse<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    pub mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        init,
        payer = authority,
        space = 8 + House::SIZE,
        seeds = [b"house", mint.key().as_ref()],
        bump
    )]
    pub house: Box<Account<'info, House>>,

    #[account(
        init,
        payer = authority,
        seeds = [b"vault", house.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = house,
        token::token_program = token_program
    )]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(token::mint = mint, token::token_program = token_program)]
    pub treasury_token: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CommitBet<'info> {
    #[account(mut)]
    pub player: Signer<'info>,

    #[account(mut, seeds = [b"house", mint.key().as_ref()], bump = house.bump, has_one = mint)]
    pub house: Box<Account<'info, House>>,

    pub mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        seeds = [b"vault", house.key().as_ref()],
        bump = house.vault_bump,
        token::mint = mint,
        token::authority = house,
        token::token_program = token_program
    )]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut, token::mint = mint, token::token_program = token_program)]
    pub player_token: Box<InterfaceAccount<'info, TokenAccount>>,

    /// One bet account per randomness draw: the randomness key is in the seeds,
    /// so a player cannot reuse one draw for two bets.
    #[account(
        init,
        payer = player,
        space = 8 + Bet::SIZE,
        seeds = [b"bet", player.key().as_ref(), randomness_account_data.key().as_ref()],
        bump
    )]
    pub bet: Box<Account<'info, Bet>>,

    /// CHECK: parsed and validated as a Switchboard RandomnessAccountData.
    pub randomness_account_data: AccountInfo<'info>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SettleBet<'info> {
    /// Permissionless: whoever pays the fee to push the settlement through. It
    /// is NOT the player, and it has no say in the outcome.
    #[account(mut)]
    pub settler: Signer<'info>,

    #[account(mut, seeds = [b"house", mint.key().as_ref()], bump = house.bump, has_one = mint)]
    pub house: Box<Account<'info, House>>,

    pub mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        seeds = [b"bet", bet.player.as_ref(), bet.randomness.as_ref()],
        bump = bet.bump
    )]
    pub bet: Box<Account<'info, Bet>>,

    #[account(
        mut,
        seeds = [b"vault", house.key().as_ref()],
        bump = house.vault_bump,
        token::mint = mint,
        token::authority = house,
        token::token_program = token_program
    )]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Must belong to the player who placed the bet — a settler cannot divert
    /// someone else's winnings into their own account.
    #[account(
        mut,
        constraint = player_token.owner == bet.player @ GameError::WrongRandomness,
        token::mint = mint,
        token::token_program = token_program
    )]
    pub player_token: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        address = house.treasury_token @ GameError::WrongTreasury,
        token::mint = mint,
        token::token_program = token_program
    )]
    pub treasury_token: Box<InterfaceAccount<'info, TokenAccount>>,

    /// CHECK: must be the exact account the bet was committed against.
    pub randomness_account_data: AccountInfo<'info>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct FundHouse<'info> {
    #[account(mut)]
    pub funder: Signer<'info>,

    #[account(seeds = [b"house", mint.key().as_ref()], bump = house.bump, has_one = mint)]
    pub house: Box<Account<'info, House>>,

    pub mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        seeds = [b"vault", house.key().as_ref()],
        bump = house.vault_bump,
        token::mint = mint,
        token::authority = house,
        token::token_program = token_program
    )]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut, token::mint = mint, token::token_program = token_program)]
    pub funder_token: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

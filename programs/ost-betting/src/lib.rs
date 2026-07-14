use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};
use pyth_solana_receiver_sdk::price_update::PriceUpdateV2;

pub mod errors;
pub mod state;

use errors::BettingError;
use state::{Market, Position};

declare_id!("F82m45QUAFJ4GtMsJrSFnWzDrjWdZjdzyh8HTPgTBHXr");

// ============================================================================
// OST on-chain prediction markets — pari-mutuel, escrowed in the OST token.
//
// ROOT-FIX NOTE: the first draft escrowed native SOL, but every OST market
// stakes OST (an SPL Token-2022 mint). Deploying the SOL version would have
// been decentralization theater — bets would still have moved OST off-chain.
// This version escrows the ACTUAL token: stakes flow into a program-owned
// token-account vault via transfer_checked, and payouts flow back out signed
// by the market PDA. Uses token_interface so the same code works for classic
// SPL Token and Token-2022 (OST is Token-2022).
//
// Economics v1 is pari-mutuel (winners split the whole pool pro-rata) — odds
// emerge from the pools themselves and no oracle price is needed to price a
// share. Resolution is authority-keyed for now; Pyth-verified resolution is
// the next stage and slots into `resolve_market`.
// ============================================================================

/// A Pyth update older than this is refused — a market must never settle on a
/// stale price.
pub const MAX_PRICE_AGE_SECS: u64 = 120;

/// House edge, in basis points, taken from the PROFIT only (never the stake).
/// 200 bps = 2%, matching docs/ost-house.js. It is a compile-time constant on
/// purpose: nobody can raise the rake on a market that already has money in it.
pub const HOUSE_FEE_BPS: u16 = 200;

#[event]
pub struct LegacyRefunded {
    pub market: Pubkey,
    pub bettor: Pubkey,
    pub stake: u64,
}

#[event]
pub struct PayoutClaimed {
    pub market: Pubkey,
    pub bettor: Pubkey,
    pub stake: u64,
    pub gross: u64,
    pub fee: u64,
    pub net: u64,
}

#[program]
pub mod ost_betting {
    use super::*;

    pub fn initialize_market(
        ctx: Context<InitializeMarket>,
        market_id: u64,
        lock_ts: i64,
        resolve_ts: i64,
        feed_id: [u8; 32],
    ) -> Result<()> {
        require!(resolve_ts > lock_ts, BettingError::ResolveTooEarly);

        let clock = Clock::get()?;
        let market = &mut ctx.accounts.market;
        market.authority = ctx.accounts.authority.key();
        market.mint = ctx.accounts.mint.key();
        market.market_id = market_id;
        market.bump = ctx.bumps.market;
        market.vault_bump = ctx.bumps.vault;
        market.created_at = clock.unix_timestamp;
        market.lock_ts = lock_ts;
        market.resolve_ts = resolve_ts;
        market.yes_pool = 0;
        market.no_pool = 0;
        market.resolved = false;
        market.winning_side = 0;
        market.feed_id = feed_id;
        market.open_price = 0;
        market.open_expo = 0;
        market.close_price = 0;
        // Pin the treasury now — the rake destination is fixed for the life of
        // this market and cannot be swapped at claim time.
        market.treasury_token = ctx.accounts.treasury_token.key();
        market.fees_collected = 0;

        Ok(())
    }

    /// Lock the market's OPEN price from Pyth. PERMISSIONLESS — anyone can call
    /// it, because the price comes from a signed oracle update the program
    /// verifies itself, not from the caller. Can only be set once, and only
    /// from the feed this market was created against.
    pub fn lock_open_price(ctx: Context<UsePythPrice>) -> Result<()> {
        let clock = Clock::get()?;
        let market = &mut ctx.accounts.market;
        require!(!market.resolved, BettingError::MarketAlreadyResolved);
        require!(market.open_price == 0, BettingError::OpenPriceAlreadySet);

        let price = ctx
            .accounts
            .price_update
            .get_price_no_older_than(&clock, MAX_PRICE_AGE_SECS, &market.feed_id)
            .map_err(|_| error!(BettingError::StaleOrWrongFeed))?;
        require!(price.price > 0, BettingError::StaleOrWrongFeed);

        market.open_price = price.price;
        market.open_expo = price.exponent;
        Ok(())
    }

    /// Resolve the market from the ORACLE. PERMISSIONLESS and trustless: the
    /// program reads the close price from the same Pyth feed and decides the
    /// winner itself (close >= open => YES). There is deliberately NO authority
    /// path — not even the market creator can choose the outcome.
    pub fn resolve_with_pyth(ctx: Context<UsePythPrice>) -> Result<()> {
        let clock = Clock::get()?;
        let market = &mut ctx.accounts.market;

        require!(!market.resolved, BettingError::MarketAlreadyResolved);
        require!(
            clock.unix_timestamp >= market.resolve_ts,
            BettingError::ResolveTooEarly
        );
        require!(market.open_price != 0, BettingError::OpenPriceMissing);

        let price = ctx
            .accounts
            .price_update
            .get_price_no_older_than(&clock, MAX_PRICE_AGE_SECS, &market.feed_id)
            .map_err(|_| error!(BettingError::StaleOrWrongFeed))?;

        // Pyth keeps the exponent stable per feed; refuse to compare mismatched
        // scales rather than silently settling on the wrong number.
        require!(
            price.exponent == market.open_expo,
            BettingError::ExponentMismatch
        );

        market.close_price = price.price;
        market.winning_side = if price.price >= market.open_price { 1 } else { 0 };
        market.resolved = true;

        Ok(())
    }

    /// Refund a stake stranded in a LEGACY market.
    ///
    /// Markets created before the Pyth upgrade have a shorter layout and no
    /// feed_id, so they can no longer be resolved (the authority-resolve
    /// instruction was deliberately deleted) and no longer deserialize into the
    /// current `Market`. Two of them still held real OST — 35 OST that no code
    /// path on earth could have released. Writing that off would have been
    /// exactly the kind of quiet loss we refuse to ship.
    ///
    /// This gives every bettor their ORIGINAL STAKE back. It is not a payout:
    /// nobody wins, nobody is raked, because those markets never had an outcome.
    ///
    /// SAFETY: this only accepts markets whose account is SMALLER than the
    /// current `Market` — i.e. provably legacy. A live market (8 + Market::SIZE
    /// bytes) can never be routed through here, so this cannot be used to drain
    /// an open pool. It is also permissionless: anyone can push the refund, but
    /// the funds can only ever go to the bettor recorded in the position.
    pub fn refund_legacy_position(ctx: Context<RefundLegacyPosition>) -> Result<()> {
        let market_ai = &ctx.accounts.market;
        let data = market_ai.try_borrow_data()?;

        // Provably legacy: too small to be a current Market.
        require!(
            data.len() < 8 + Market::SIZE,
            BettingError::NotALegacyMarket
        );
        // Still one of OUR market accounts (right discriminator), not junk.
        let expected_disc = Market::DISCRIMINATOR;
        require!(
            data.len() >= 8 + 116 && data[0..8] == *expected_disc,
            BettingError::NotALegacyMarket
        );

        // Old layout: authority(32) mint(32) market_id(8) bump(1) vault_bump(1) …
        let authority = Pubkey::try_from(&data[8..40]).map_err(|_| BettingError::NotALegacyMarket)?;
        let market_id = u64::from_le_bytes(data[72..80].try_into().unwrap());
        let bump = data[80];
        let vault_bump = data[81];
        drop(data);

        // The account really is the market PDA for that (authority, market_id).
        let expected_market = Pubkey::create_program_address(
            &[b"market", authority.as_ref(), &market_id.to_le_bytes(), &[bump]],
            &crate::ID,
        )
        .map_err(|_| BettingError::NotALegacyMarket)?;
        require_keys_eq!(expected_market, market_ai.key(), BettingError::NotALegacyMarket);

        // …and the vault really is that market's vault.
        let expected_vault = Pubkey::create_program_address(
            &[b"vault", market_ai.key().as_ref(), &[vault_bump]],
            &crate::ID,
        )
        .map_err(|_| BettingError::NotALegacyMarket)?;
        require_keys_eq!(
            expected_vault,
            ctx.accounts.vault.key(),
            BettingError::NotALegacyMarket
        );

        let position = &ctx.accounts.position;
        require!(!position.claimed, BettingError::AlreadyClaimed);
        require_keys_eq!(position.market, market_ai.key(), BettingError::NothingToClaim);
        let stake = position.stake;
        require!(stake > 0, BettingError::NothingToClaim);

        // Vault is owned by the market PDA — sign with the market's seeds.
        let market_id_bytes = market_id.to_le_bytes();
        let market_bump = [bump];
        let signer_seeds: &[&[&[u8]]] = &[&[
            b"market",
            authority.as_ref(),
            market_id_bytes.as_ref(),
            &market_bump,
        ]];

        token_interface::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.vault.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.bettor_token.to_account_info(),
                    authority: market_ai.to_account_info(),
                },
                signer_seeds,
            ),
            stake,
            ctx.accounts.mint.decimals,
        )?;

        ctx.accounts.position.claimed = true;

        emit!(LegacyRefunded {
            market: market_ai.key(),
            bettor: ctx.accounts.position.bettor,
            stake,
        });
        Ok(())
    }

    pub fn place_bet(ctx: Context<PlaceBet>, side: u8, amount: u64) -> Result<()> {
        require!(side <= 1, BettingError::InvalidSide);
        require!(amount > 0, BettingError::InvalidStake);

        let clock = Clock::get()?;
        require!(!ctx.accounts.market.resolved, BettingError::MarketAlreadyResolved);
        require!(
            clock.unix_timestamp < ctx.accounts.market.lock_ts,
            BettingError::MarketLocked
        );

        // Escrow the OST stake: bettor's token account -> market vault.
        token_interface::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.bettor_token.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.bettor.to_account_info(),
                },
            ),
            amount,
            ctx.accounts.mint.decimals,
        )?;

        let market = &mut ctx.accounts.market;
        if side == 1 {
            market.yes_pool = market
                .yes_pool
                .checked_add(amount)
                .ok_or(BettingError::MathOverflow)?;
        } else {
            market.no_pool = market
                .no_pool
                .checked_add(amount)
                .ok_or(BettingError::MathOverflow)?;
        }

        let position = &mut ctx.accounts.position;
        if position.stake == 0 {
            position.market = market.key();
            position.bettor = ctx.accounts.bettor.key();
            position.side = side;
            position.stake = amount;
            position.claimed = false;
        } else {
            require!(position.side == side, BettingError::InvalidSide);
            require!(!position.claimed, BettingError::AlreadyClaimed);
            position.stake = position
                .stake
                .checked_add(amount)
                .ok_or(BettingError::MathOverflow)?;
        }

        Ok(())
    }

    // NOTE: the old authority-signed `resolve_market(winning_side)` is GONE on
    // purpose. While it existed, the market creator could simply declare the
    // winner — the escrow was on-chain but the OUTCOME was still trusted, which
    // is exactly the kind of half-decentralization we refuse to ship. The only
    // way to resolve a market now is `resolve_with_pyth`, where the program
    // reads the price itself.

    pub fn claim_payout(ctx: Context<ClaimPayout>) -> Result<()> {
        require!(ctx.accounts.market.resolved, BettingError::MarketNotResolved);
        require!(!ctx.accounts.position.claimed, BettingError::AlreadyClaimed);

        // Losing side: mark claimed, nothing to transfer.
        if ctx.accounts.position.side != ctx.accounts.market.winning_side {
            ctx.accounts.position.claimed = true;
            return Ok(());
        }

        let market = &ctx.accounts.market;
        let winner_pool = if market.winning_side == 1 {
            market.yes_pool
        } else {
            market.no_pool
        };
        let total_pool = market
            .yes_pool
            .checked_add(market.no_pool)
            .ok_or(BettingError::MathOverflow)?;

        require!(winner_pool > 0, BettingError::NothingToClaim);

        // Pari-mutuel gross payout: stake * total_pool / winner_pool
        let stake = ctx.accounts.position.stake;
        let gross = (stake as u128)
            .checked_mul(total_pool as u128)
            .ok_or(BettingError::MathOverflow)?
            .checked_div(winner_pool as u128)
            .ok_or(BettingError::MathOverflow)? as u64;

        // ---- HOUSE EDGE, ON-CHAIN --------------------------------------------
        // Same rule the app has always advertised (docs/ost-house.js): the rake
        // is taken from the PROFIT ONLY (gross - stake), never from the stake.
        // A break-even or losing claim is never taxed. Enforced by the program
        // now, so the edge cannot be bypassed by talking to the chain directly —
        // which is exactly how testers used to dodge it.
        let profit = gross.saturating_sub(stake);
        let fee = ((profit as u128)
            .checked_mul(HOUSE_FEE_BPS as u128)
            .ok_or(BettingError::MathOverflow)?
            / 10_000u128) as u64;
        let net = gross.checked_sub(fee).ok_or(BettingError::MathOverflow)?;

        // Vault is owned by the MARKET PDA — sign with the market's seeds.
        let authority_key = market.authority;
        let market_id_bytes = market.market_id.to_le_bytes();
        let market_bump = [market.bump];
        let signer_seeds: &[&[&[u8]]] = &[&[
            b"market",
            authority_key.as_ref(),
            market_id_bytes.as_ref(),
            &market_bump,
        ]];

        // Pay the winner the NET amount.
        token_interface::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.vault.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.bettor_token.to_account_info(),
                    authority: ctx.accounts.market.to_account_info(),
                },
                signer_seeds,
            ),
            net,
            ctx.accounts.mint.decimals,
        )?;

        // Sweep the rake to the treasury token account, in the SAME transaction.
        // The treasury is pinned to the market at creation, so a claimer cannot
        // redirect the fee to an account of their choosing.
        if fee > 0 {
            token_interface::transfer_checked(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    TransferChecked {
                        from: ctx.accounts.vault.to_account_info(),
                        mint: ctx.accounts.mint.to_account_info(),
                        to: ctx.accounts.treasury_token.to_account_info(),
                        authority: ctx.accounts.market.to_account_info(),
                    },
                    signer_seeds,
                ),
                fee,
                ctx.accounts.mint.decimals,
            )?;
        }

        let market_mut = &mut ctx.accounts.market;
        market_mut.fees_collected = market_mut
            .fees_collected
            .checked_add(fee)
            .ok_or(BettingError::MathOverflow)?;

        ctx.accounts.position.claimed = true;

        emit!(PayoutClaimed {
            market: market_mut.key(),
            bettor: ctx.accounts.bettor.key(),
            stake,
            gross,
            fee,
            net,
        });

        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(market_id: u64)]
pub struct InitializeMarket<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        init,
        payer = authority,
        space = 8 + Market::SIZE,
        seeds = [b"market", authority.key().as_ref(), &market_id.to_le_bytes()],
        bump
    )]
    pub market: Account<'info, Market>,

    // Program-owned OST vault: a token account whose authority is the market
    // PDA, so only the program (signing with market seeds) can move funds out.
    #[account(
        init,
        payer = authority,
        seeds = [b"vault", market.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = market,
        token::token_program = token_program
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,

    /// Where the house edge is swept. Recorded on the market at creation.
    #[account(token::mint = mint, token::token_program = token_program)]
    pub treasury_token: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct PlaceBet<'info> {
    #[account(mut)]
    pub bettor: Signer<'info>,

    #[account(mut, has_one = mint)]
    pub market: Account<'info, Market>,

    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        seeds = [b"vault", market.key().as_ref()],
        bump = market.vault_bump,
        token::mint = mint,
        token::authority = market,
        token::token_program = token_program
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,

    // Bettor's own OST token account (their ATA); must match the market mint.
    #[account(mut, token::mint = mint, token::token_program = token_program)]
    pub bettor_token: InterfaceAccount<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = bettor,
        space = 8 + Position::SIZE,
        seeds = [b"position", market.key().as_ref(), bettor.key().as_ref()],
        bump
    )]
    pub position: Account<'info, Position>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

/// Used by BOTH lock_open_price and resolve_with_pyth. There is no `authority`
/// here on purpose: anyone may push the market forward, because the outcome is
/// decided by the verified oracle account, not by the signer.
#[derive(Accounts)]
pub struct UsePythPrice<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(mut)]
    pub market: Account<'info, Market>,

    /// Pyth price update posted on-chain by the Pyth receiver program. The SDK
    /// verifies it belongs to `market.feed_id` and is fresh; a forged or
    /// wrong-feed account makes the instruction fail.
    pub price_update: Account<'info, PriceUpdateV2>,
}

#[derive(Accounts)]
pub struct ClaimPayout<'info> {
    #[account(mut)]
    pub bettor: Signer<'info>,

    #[account(mut, has_one = mint)]
    pub market: Account<'info, Market>,

    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        constraint = position.market == market.key(),
        constraint = position.bettor == bettor.key(),
    )]
    pub position: Account<'info, Position>,

    #[account(
        mut,
        seeds = [b"vault", market.key().as_ref()],
        bump = market.vault_bump,
        token::mint = mint,
        token::authority = market,
        token::token_program = token_program
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,

    #[account(mut, token::mint = mint, token::token_program = token_program)]
    pub bettor_token: InterfaceAccount<'info, TokenAccount>,

    /// MUST be the treasury pinned on the market at creation. A claimer cannot
    /// point the rake at an account they control.
    #[account(
        mut,
        address = market.treasury_token @ BettingError::WrongTreasury,
        token::mint = mint,
        token::token_program = token_program
    )]
    pub treasury_token: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

/// Refund a stake out of a LEGACY market's vault. The market is an
/// UncheckedAccount ON PURPOSE: its old layout can no longer be deserialized
/// into `Market`, which is precisely why the funds were stuck. Every field we
/// rely on is re-derived and checked against the PDA seeds in the handler.
#[derive(Accounts)]
pub struct RefundLegacyPosition<'info> {
    /// Permissionless. Pays the fee; has no say in where the money goes.
    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: validated in the handler — discriminator, legacy size, and PDA seeds.
    #[account(mut)]
    pub market: UncheckedAccount<'info>,

    pub mint: InterfaceAccount<'info, Mint>,

    /// The Position layout never changed, so this still deserializes cleanly.
    #[account(mut, constraint = position.market == market.key() @ BettingError::NothingToClaim)]
    pub position: Account<'info, Position>,

    #[account(mut, token::mint = mint, token::token_program = token_program)]
    pub vault: InterfaceAccount<'info, TokenAccount>,

    /// Must belong to the bettor recorded in the position — a payer cannot
    /// redirect somebody else's refund into their own account.
    #[account(
        mut,
        constraint = bettor_token.owner == position.bettor @ BettingError::NothingToClaim,
        token::mint = mint,
        token::token_program = token_program
    )]
    pub bettor_token: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

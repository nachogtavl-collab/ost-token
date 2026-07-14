use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};

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

#[program]
pub mod ost_betting {
    use super::*;

    pub fn initialize_market(
        ctx: Context<InitializeMarket>,
        market_id: u64,
        lock_ts: i64,
        resolve_ts: i64,
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

    pub fn resolve_market(ctx: Context<ResolveMarket>, winning_side: u8) -> Result<()> {
        require!(winning_side <= 1, BettingError::InvalidSide);

        let clock = Clock::get()?;
        let market = &mut ctx.accounts.market;

        require!(
            ctx.accounts.authority.key() == market.authority,
            BettingError::Unauthorized
        );
        require!(!market.resolved, BettingError::MarketAlreadyResolved);
        require!(
            clock.unix_timestamp >= market.resolve_ts,
            BettingError::ResolveTooEarly
        );

        market.resolved = true;
        market.winning_side = winning_side;

        Ok(())
    }

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

        // Pari-mutuel payout: stake * total_pool / winner_pool
        let payout = (ctx.accounts.position.stake as u128)
            .checked_mul(total_pool as u128)
            .ok_or(BettingError::MathOverflow)?
            .checked_div(winner_pool as u128)
            .ok_or(BettingError::MathOverflow)? as u64;

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
            payout,
            ctx.accounts.mint.decimals,
        )?;

        ctx.accounts.position.claimed = true;

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

#[derive(Accounts)]
pub struct ResolveMarket<'info> {
    pub authority: Signer<'info>,

    #[account(mut)]
    pub market: Account<'info, Market>,
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

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

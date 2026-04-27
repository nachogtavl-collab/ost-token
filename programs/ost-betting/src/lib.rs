use anchor_lang::prelude::*;
use anchor_lang::system_program::{self, Transfer};

pub mod errors;
pub mod state;

use errors::BettingError;
use state::{Market, Position};

declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkgMQHGz5A9A");

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
        let market = &mut ctx.accounts.market;
        require!(!market.resolved, BettingError::MarketAlreadyResolved);
        require!(clock.unix_timestamp < market.lock_ts, BettingError::MarketLocked);

        // Transfer SOL stake from bettor to market vault PDA via Anchor CPI helper.
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.bettor.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                },
            ),
            amount,
        )?;

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

        require!(ctx.accounts.authority.key() == market.authority, BettingError::Unauthorized);
        require!(!market.resolved, BettingError::MarketAlreadyResolved);
        require!(clock.unix_timestamp >= market.resolve_ts, BettingError::ResolveTooEarly);

        market.resolved = true;
        market.winning_side = winning_side;

        Ok(())
    }

    pub fn claim_payout(ctx: Context<ClaimPayout>) -> Result<()> {
        let market = &ctx.accounts.market;
        let position = &mut ctx.accounts.position;

        require!(market.resolved, BettingError::MarketNotResolved);
        require!(!position.claimed, BettingError::AlreadyClaimed);

        // If user chose losing side, mark claimed and exit.
        if position.side != market.winning_side {
            position.claimed = true;
            return Ok(());
        }

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
        let payout = (position.stake as u128)
            .checked_mul(total_pool as u128)
            .ok_or(BettingError::MathOverflow)?
            .checked_div(winner_pool as u128)
            .ok_or(BettingError::MathOverflow)? as u64;

        let market_key = market.key();
        let market_id_bytes = market.market_id.to_le_bytes();
        let vault_bump = [market.vault_bump];
        let signer_seeds: &[&[&[u8]]] = &[&[
            b"vault",
            market_key.as_ref(),
            market_id_bytes.as_ref(),
            &vault_bump,
        ]];

        system_program::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.system_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.bettor.to_account_info(),
                },
                signer_seeds,
            ),
            payout,
        )?;

        position.claimed = true;

        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(market_id: u64)]
pub struct InitializeMarket<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = 8 + Market::SIZE,
        seeds = [b"market", authority.key().as_ref(), &market_id.to_le_bytes()],
        bump
    )]
    pub market: Account<'info, Market>,

    /// CHECK: System-owned PDA vault for SOL escrow.
    #[account(
        mut,
        seeds = [b"vault", market.key().as_ref(), &market_id.to_le_bytes()],
        bump
    )]
    pub vault: SystemAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct PlaceBet<'info> {
    #[account(mut)]
    pub bettor: Signer<'info>,

    #[account(mut)]
    pub market: Account<'info, Market>,

    /// CHECK: Market escrow vault PDA.
    #[account(
        mut,
        seeds = [b"vault", market.key().as_ref(), &market.market_id.to_le_bytes()],
        bump = market.vault_bump
    )]
    pub vault: AccountInfo<'info>,

    #[account(
        init_if_needed,
        payer = bettor,
        space = 8 + Position::SIZE,
        seeds = [b"position", market.key().as_ref(), bettor.key().as_ref()],
        bump
    )]
    pub position: Account<'info, Position>,

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

    #[account(mut)]
    pub market: Account<'info, Market>,

    #[account(
        mut,
        constraint = position.market == market.key(),
        constraint = position.bettor == bettor.key(),
    )]
    pub position: Account<'info, Position>,

    /// CHECK: Market escrow vault PDA, system-owned.
    #[account(
        mut,
        seeds = [b"vault", market.key().as_ref(), &market.market_id.to_le_bytes()],
        bump = market.vault_bump
    )]
    pub vault: SystemAccount<'info>,

    pub system_program: Program<'info, System>,
}

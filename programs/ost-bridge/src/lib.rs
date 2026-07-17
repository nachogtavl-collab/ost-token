use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    self, Burn, Mint, MintTo, TokenAccount, TokenInterface, TransferChecked,
};

// Real program id — matches target/deploy/ost_bridge-keypair.json.
declare_id!("J7jqcwT44CY4oXjwu6fwfiFvQDWBQRsueqL7dsZjnrJd");

// ===========================================================================
// OST BRIDGE — the ONE door between the two economies
// ---------------------------------------------------------------------------
// OSTC (currency: payments, commerce, mesh) and OSTG (in-app token: markets,
// games, memecoins) are deliberately different mints. This program is the only
// thing allowed to convert between them, and it does so 1:1:
//
//   deposit(amount) : user OSTC --> vault (escrow),  mint  `amount` OSTG --> user
//   withdraw(amount): burn `amount` OSTG from user,  vault --> user `amount` OSTC
//
// THE INVARIANT, and why it holds BY CONSTRUCTION rather than by promise:
//
//     OSTG total supply  ==  OSTC held in the bridge vault
//
// The program is the SOLE mint authority of OSTG and the SOLE owner of the OSTC
// vault. It mints exactly what it escrows and burns exactly what it releases.
// So every OSTG in existence is backed by an OSTC that cannot move until that
// OSTG is burned. Nobody — not even the deployer — can mint OSTG another way or
// drain the vault, because both authorities are a PDA with no private key. The
// off-chain /health/peg checker simply READS both numbers and confirms they
// match; if they ever diverge, the program has a bug, not a policy problem.
//
// This is the structural cure for the boundary-leak bug class (credits paying an
// on-chain ticket, silent downgrades, fabricated signatures): there is exactly
// one place value crosses, and its correctness is a one-line identity.
// ===========================================================================

#[program]
pub mod ost_bridge {
    use super::*;

    /// One-time setup. Records the two mints and pins the vault. The OSTG mint's
    /// authority MUST already be the bridge PDA (enforced by the constraint on
    /// `ostg_mint` below) — otherwise someone else could mint OSTG off-books and
    /// break the peg on day one.
    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        // 1:1 on RAW amounts only means anything if the decimals match. If they
        // differ, "amount" OSTC is not "amount" OSTG and the peg is a lie.
        require!(
            ctx.accounts.ostc_mint.decimals == ctx.accounts.ostg_mint.decimals,
            BridgeError::DecimalMismatch
        );

        let bridge = &mut ctx.accounts.bridge;
        bridge.ostc_mint = ctx.accounts.ostc_mint.key();
        bridge.ostg_mint = ctx.accounts.ostg_mint.key();
        bridge.vault = ctx.accounts.vault.key();
        bridge.bump = ctx.bumps.bridge;
        Ok(())
    }

    /// OSTC in, OSTG out, 1:1. Escrow first, then mint — never the reverse, so a
    /// failed escrow cannot leave freshly minted OSTG with nothing behind it.
    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        require!(amount > 0, BridgeError::ZeroAmount);
        let decimals = ctx.accounts.ostc_mint.decimals;

        // 1) Escrow the user's OSTC into the vault. Authority = the user.
        token_interface::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.user_ostc.to_account_info(),
                    mint: ctx.accounts.ostc_mint.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            amount,
            decimals,
        )?;

        // 2) Mint the same amount of OSTG to the user. Authority = bridge PDA.
        let signer_seeds: &[&[&[u8]]] = &[&[b"bridge", &[ctx.accounts.bridge.bump]]];
        token_interface::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                MintTo {
                    mint: ctx.accounts.ostg_mint.to_account_info(),
                    to: ctx.accounts.user_ostg.to_account_info(),
                    authority: ctx.accounts.bridge.to_account_info(),
                },
                signer_seeds,
            ),
            amount,
        )?;

        emit!(Bridged {
            user: ctx.accounts.user.key(),
            amount,
            direction: 0, // deposit
        });
        Ok(())
    }

    /// OSTG in (burned), OSTC out, 1:1. Burn first, then release — so a failed
    /// burn cannot let the vault pay out against OSTG that still exists.
    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        require!(amount > 0, BridgeError::ZeroAmount);
        let decimals = ctx.accounts.ostc_mint.decimals;

        // 1) Burn the user's OSTG. Authority = the user (they own the tokens).
        token_interface::burn(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Burn {
                    mint: ctx.accounts.ostg_mint.to_account_info(),
                    from: ctx.accounts.user_ostg.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            amount,
        )?;

        // 2) Release the same amount of OSTC from the vault. Authority = PDA.
        let signer_seeds: &[&[&[u8]]] = &[&[b"bridge", &[ctx.accounts.bridge.bump]]];
        token_interface::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.vault.to_account_info(),
                    mint: ctx.accounts.ostc_mint.to_account_info(),
                    to: ctx.accounts.user_ostc.to_account_info(),
                    authority: ctx.accounts.bridge.to_account_info(),
                },
                signer_seeds,
            ),
            amount,
            decimals,
        )?;

        emit!(Bridged {
            user: ctx.accounts.user.key(),
            amount,
            direction: 1, // withdraw
        });
        Ok(())
    }
}

// ---- accounts -------------------------------------------------------------

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = payer,
        space = 8 + Bridge::SIZE,
        seeds = [b"bridge"],
        bump
    )]
    pub bridge: Account<'info, Bridge>,

    pub ostc_mint: InterfaceAccount<'info, Mint>,

    // The OSTG mint authority MUST be the bridge PDA. If it were anything else,
    // that holder could mint unbacked OSTG. `mint::authority` makes Anchor verify
    // it, so initialize fails unless the mint was created correctly.
    #[account(
        mint::authority = bridge,
    )]
    pub ostg_mint: InterfaceAccount<'info, Mint>,

    // The vault is an OSTC token account OWNED BY the bridge PDA. Created here so
    // there is exactly one, pinned into the config, and no caller can substitute
    // a vault they control.
    #[account(
        init,
        payer = payer,
        seeds = [b"vault", bridge.key().as_ref()],
        bump,
        token::mint = ostc_mint,
        token::authority = bridge,
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,

    #[account(mut)]
    pub payer: Signer<'info>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(
        seeds = [b"bridge"],
        bump = bridge.bump,
        has_one = ostc_mint,
        has_one = ostg_mint,
        has_one = vault,
    )]
    pub bridge: Account<'info, Bridge>,

    #[account(mut)]
    pub ostc_mint: InterfaceAccount<'info, Mint>,
    #[account(mut)]
    pub ostg_mint: InterfaceAccount<'info, Mint>,

    // The pinned vault (has_one on bridge guarantees it is THE vault).
    #[account(mut)]
    pub vault: InterfaceAccount<'info, TokenAccount>,

    // User's OSTC source. Must be an OSTC account owned by the signer.
    #[account(
        mut,
        token::mint = ostc_mint,
        token::authority = user,
    )]
    pub user_ostc: InterfaceAccount<'info, TokenAccount>,

    // User's OSTG destination. Must be an OSTG account owned by the signer.
    #[account(
        mut,
        token::mint = ostg_mint,
        token::authority = user,
    )]
    pub user_ostg: InterfaceAccount<'info, TokenAccount>,

    pub user: Signer<'info>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(
        seeds = [b"bridge"],
        bump = bridge.bump,
        has_one = ostc_mint,
        has_one = ostg_mint,
        has_one = vault,
    )]
    pub bridge: Account<'info, Bridge>,

    #[account(mut)]
    pub ostc_mint: InterfaceAccount<'info, Mint>,
    #[account(mut)]
    pub ostg_mint: InterfaceAccount<'info, Mint>,

    #[account(mut)]
    pub vault: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        token::mint = ostc_mint,
        token::authority = user,
    )]
    pub user_ostc: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        token::mint = ostg_mint,
        token::authority = user,
    )]
    pub user_ostg: InterfaceAccount<'info, TokenAccount>,

    pub user: Signer<'info>,
    pub token_program: Interface<'info, TokenInterface>,
}

// ---- state ----------------------------------------------------------------

#[account]
pub struct Bridge {
    pub ostc_mint: Pubkey,
    pub ostg_mint: Pubkey,
    pub vault: Pubkey,
    pub bump: u8,
}

impl Bridge {
    // 3 pubkeys + 1 bump.
    pub const SIZE: usize = 32 + 32 + 32 + 1;
}

#[event]
pub struct Bridged {
    pub user: Pubkey,
    pub amount: u64,
    pub direction: u8, // 0 = deposit (OSTC->OSTG), 1 = withdraw (OSTG->OSTC)
}

#[error_code]
pub enum BridgeError {
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("OSTC and OSTG mints must have the same number of decimals for a 1:1 peg")]
    DecimalMismatch,
}

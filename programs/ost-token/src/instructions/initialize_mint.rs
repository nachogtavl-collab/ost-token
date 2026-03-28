// ============================================================================
// Initialize Mint — Creates the OST Token-2022 mint with confidential
// transfer extension enabled. No tokens are pre-mined (fair launch).
//
// Flow:
//   1. Create mint account with extra space for Token-2022 extensions
//   2. Initialize ConfidentialTransferMint extension
//   3. Initialize the mint itself (9 decimals)
//   4. Store config in MintConfig PDA
// ============================================================================

use anchor_lang::prelude::*;
use anchor_lang::solana_program::{program::invoke_signed, system_instruction};
use anchor_spl::token_2022::{self, spl_token_2022};
use spl_token_2022::{
    extension::{
        confidential_transfer::instruction as ct_instruction,
        ExtensionType,
    },
    instruction as token_instruction,
    state::Mint as MintState,
};

use crate::state::MintConfig;

#[derive(Accounts)]
pub struct InitializeMint<'info> {
    /// The deployer / admin who pays for account creation
    #[account(mut)]
    pub admin: Signer<'info>,

    /// The mint account (PDA) — will be created with Token-2022 extensions
    /// CHECK: We create this account manually via CPI to support extensions
    #[account(mut)]
    pub mint: Signer<'info>,

    /// The mint authority PDA — the program controls minting
    /// CHECK: PDA derived from seeds; never signs externally
    #[account(
        seeds = [b"mint-authority"],
        bump,
    )]
    pub mint_authority: UncheckedAccount<'info>,

    /// Stores program-level config for the OST mint
    #[account(
        init,
        payer = admin,
        space = MintConfig::LEN,
        seeds = [b"mint-config"],
        bump,
    )]
    pub mint_config: Account<'info, MintConfig>,

    /// Token-2022 program (NOT the legacy SPL Token program)
    pub token_program: Program<'info, token_2022::Token2022>,

    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handler(ctx: Context<InitializeMint>) -> Result<()> {
    let mint = &ctx.accounts.mint;
    let admin = &ctx.accounts.admin;
    let system_program = &ctx.accounts.system_program;
    let token_program = &ctx.accounts.token_program;
    let rent = &ctx.accounts.rent;

    // ---- Calculate space needed for mint + ConfidentialTransferMint ----
    let extensions = &[ExtensionType::ConfidentialTransferMint];
    let mint_space = ExtensionType::try_calculate_account_len::<MintState>(extensions)?;

    let rent_lamports = rent.minimum_balance(mint_space);

    // ---- Create the mint account (owned by Token-2022) ----
    invoke_signed(
        &system_instruction::create_account(
            admin.key,
            mint.key,
            rent_lamports,
            mint_space as u64,
            &spl_token_2022::id(),
        ),
        &[
            admin.to_account_info(),
            mint.to_account_info(),
            system_program.to_account_info(),
        ],
        &[], // mint is a signer, not a PDA
    )?;

    // ---- Initialize ConfidentialTransferMint extension ----
    // auto_approve = true: all accounts are automatically approved for
    // confidential transfers (no manual approval step needed)
    let ix_ct = ct_instruction::initialize_mint(
        &spl_token_2022::id(),
        mint.key,
        None,                        // no CT authority (fully decentralized)
        true,                        // auto_approve_new_accounts
        None,                        // no auditor
    )?;

    invoke_signed(
        &ix_ct,
        &[
            mint.to_account_info(),
            token_program.to_account_info(),
        ],
        &[],
    )?;

    // ---- Initialize the mint (9 decimals, PDA authority, no freeze) ----
    let ix_init_mint = token_instruction::initialize_mint2(
        &spl_token_2022::id(),
        mint.key,
        &ctx.accounts.mint_authority.key(), // mint authority = PDA
        None,                                // no freeze authority
        9,                                   // 9 decimals
    )?;

    invoke_signed(
        &ix_init_mint,
        &[
            mint.to_account_info(),
        ],
        &[],
    )?;

    // ---- Persist config ----
    let config = &mut ctx.accounts.mint_config;
    config.bump = ctx.bumps.mint_config;
    config.authority_bump = ctx.bumps.mint_authority;
    config.confidential_transfers_enabled = true;
    config.total_minted = 0; // Fair launch: zero pre-mine
    config.admin = admin.key();

    msg!("OST Mint initialized: {} (9 decimals, confidential transfers ON, zero pre-mine)", mint.key);

    Ok(())
}

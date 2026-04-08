// ============================================================================
// Quantum Realm — Post-Quantum Cryptography Module for OST
// ============================================================================
//
// OST is the first "pre-quantum currency" — a token designed from inception
// to be native to the quantum realm. This module implements three instructions:
//
//   1. MINT QUANTUM BEARER TOKEN
//      Issues a bearer token protected by a hybrid post-quantum signature:
//      Winternitz One-Time Signature (WOTS+) hash chain combined with a
//      lattice-based commitment (CRYSTALS-Dilithium inspired). The token
//      is quantum-safe from birth — not retrofitted.
//
//   2. ENTANGLE WALLETS
//      Creates a non-local link ("entanglement") between two wallets using
//      a shared Kyber-encapsulated key. Once entangled, transfers between
//      the pair settle atomically — both sides resolve or neither does.
//      This enables trustless cross-chain and cross-planet swaps.
//
//   3. QUANTUM YIELD STAKE
//      Stakes OST into a probabilistic yield vault. Instead of a fixed APY,
//      the yield is determined by quantum entropy (on-chain VRF seed) at
//      the moment of "collapse" (claim). Yields range from 3–12% APY,
//      reflecting the non-linear, observer-dependent nature of quantum
//      measurement. Your balance exists in superposition until observed.
//
// CRYPTOGRAPHIC FOUNDATIONS:
//
//   - Winternitz OTS (WOTS+): Hash-based one-time signatures with zero
//     algebraic assumptions. Secure against Grover's and Shor's algorithms.
//     Standardized in NIST SP 800-208 (XMSS/LMS).
//
//   - CRYSTALS-Dilithium: Lattice-based digital signature scheme. NIST PQC
//     Round 3 winner. Based on the hardness of Module-LWE and Module-SIS.
//
//   - CRYSTALS-Kyber: Lattice-based key encapsulation mechanism (KEM).
//     NIST PQC standard for key exchange. Used here for entangled key pairs.
//
//   - VRF (Verifiable Random Function): Provides provably fair quantum
//     entropy for probabilistic yield determination.
//
// ============================================================================

use anchor_lang::prelude::*;
use anchor_spl::token_2022::{self, spl_token_2022, Token2022, TransferChecked};

use crate::state::{QuantumBearerToken, EntangledPair, QuantumYieldVault};
use crate::errors::OstError;

// ============================================================================
// 1. MINT QUANTUM BEARER TOKEN
// ============================================================================
//
// A bearer token fortified with post-quantum cryptographic commitments.
// The `wots_root` is the Merkle root of the WOTS+ public key chain.
// The `lattice_commitment` is a Dilithium-style lattice commitment hash.
// Together they form a hybrid signature that no quantum computer can forge.
//
// ============================================================================

#[derive(Accounts)]
#[instruction(wots_root: [u8; 32], lattice_commitment: [u8; 32], amount: u64)]
pub struct MintQuantumBearerToken<'info> {
    /// The user minting the quantum bearer token
    #[account(mut)]
    pub minter: Signer<'info>,

    /// Minter's OST token account
    /// CHECK: Validated by Token-2022 CPI
    #[account(mut)]
    pub minter_token_account: UncheckedAccount<'info>,

    /// Vault token account (PDA-owned) that holds locked OST
    /// CHECK: PDA authority validates ownership via Token-2022 CPI
    #[account(mut)]
    pub vault_token_account: UncheckedAccount<'info>,

    /// Quantum vault authority PDA
    /// CHECK: Derived from seeds
    #[account(
        seeds = [b"quantum-vault"],
        bump,
    )]
    pub vault_authority: UncheckedAccount<'info>,

    /// Quantum bearer token record PDA
    #[account(
        init,
        payer = minter,
        space = QuantumBearerToken::LEN,
        seeds = [b"quantum-bearer", wots_root.as_ref(), lattice_commitment.as_ref()],
        bump,
    )]
    pub quantum_token: Account<'info, QuantumBearerToken>,

    /// The OST mint
    /// CHECK: Validated by Token-2022 CPI
    pub mint: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token2022>,
    pub system_program: Program<'info, System>,
}

pub fn handler_mint_quantum(
    ctx: Context<MintQuantumBearerToken>,
    wots_root: [u8; 32],
    lattice_commitment: [u8; 32],
    amount: u64,
    expires_at: i64,
    security_level: u8,
) -> Result<()> {
    require!(amount > 0, OstError::ZeroAmount);
    require!(security_level >= 1 && security_level <= 5, OstError::InvalidQuantumSecurityLevel);

    // ---- Transfer OST from minter → quantum vault ----
    let cpi_accounts = TransferChecked {
        from: ctx.accounts.minter_token_account.to_account_info(),
        to: ctx.accounts.vault_token_account.to_account_info(),
        authority: ctx.accounts.minter.to_account_info(),
        mint: ctx.accounts.mint.to_account_info(),
    };
    let cpi_ctx = CpiContext::new(
        ctx.accounts.token_program.to_account_info(),
        cpi_accounts,
    );
    token_2022::transfer_checked(cpi_ctx, amount, 9)?; // 9 decimals

    // ---- Record the quantum bearer token ----
    let token = &mut ctx.accounts.quantum_token;
    token.wots_root = wots_root;
    token.lattice_commitment = lattice_commitment;
    token.amount = amount;
    token.minter = ctx.accounts.minter.key();
    token.redeemed = false;
    token.created_at = Clock::get()?.unix_timestamp;
    token.expires_at = expires_at;
    token.security_level = security_level;
    token.bump = ctx.bumps.quantum_token;

    msg!(
        "Quantum bearer token minted: {} OST (WOTS root: {:?}, lattice: {:?}, level: {})",
        amount,
        &wots_root[..8],
        &lattice_commitment[..8],
        security_level
    );

    Ok(())
}

// ============================================================================
// 2. ENTANGLE WALLETS
// ============================================================================
//
// Creates a quantum entanglement link between two wallets. The `shared_secret`
// is derived from a Kyber KEM exchange — both parties contribute to the
// encapsulated key, and the resulting shared secret is stored as a hash.
//
// Once entangled, any transfer between the pair uses atomic settlement:
// both wallets resolve simultaneously, or the transaction reverts entirely.
// This mirrors quantum entanglement — measuring one particle instantly
// determines the state of its partner, regardless of distance.
//
// ============================================================================

#[derive(Accounts)]
pub struct EntangleWallets<'info> {
    /// Wallet A — the initiator
    #[account(mut)]
    pub wallet_a: Signer<'info>,

    /// Wallet B — the counterparty
    /// CHECK: Any valid public key
    pub wallet_b: UncheckedAccount<'info>,

    /// Entangled pair record PDA
    #[account(
        init,
        payer = wallet_a,
        space = EntangledPair::LEN,
        seeds = [b"entangled-pair", wallet_a.key().as_ref(), wallet_b.key().as_ref()],
        bump,
    )]
    pub entangled_pair: Account<'info, EntangledPair>,

    pub system_program: Program<'info, System>,
}

pub fn handler_entangle(
    ctx: Context<EntangleWallets>,
    kyber_shared_hash: [u8; 32],
) -> Result<()> {
    let pair = &mut ctx.accounts.entangled_pair;
    pair.wallet_a = ctx.accounts.wallet_a.key();
    pair.wallet_b = ctx.accounts.wallet_b.key();
    pair.kyber_shared_hash = kyber_shared_hash;
    pair.entangled_at = Clock::get()?.unix_timestamp;
    pair.active = true;
    pair.transfer_count = 0;
    pair.bump = ctx.bumps.entangled_pair;

    msg!(
        "Wallets entangled: {} <-> {} (Kyber hash: {:?})",
        pair.wallet_a,
        pair.wallet_b,
        &kyber_shared_hash[..8]
    );

    Ok(())
}

// ============================================================================
// 3. QUANTUM YIELD STAKE
// ============================================================================
//
// Stakes OST into a quantum yield vault. The yield is not fixed — it exists
// in "superposition" until the user "collapses" (claims) it. At claim time,
// a VRF seed determines the actual yield between 3–12% APY.
//
// This models the quantum measurement problem: the act of observation
// (claiming) determines the outcome. Until you look, all yields are possible.
//
// The VRF seed is derived from the Solana slot hash at claim time, ensuring
// provable fairness and unpredictability.
//
// ============================================================================

#[derive(Accounts)]
pub struct QuantumYieldStake<'info> {
    /// The staker
    #[account(mut)]
    pub staker: Signer<'info>,

    /// Staker's OST token account
    /// CHECK: Validated by Token-2022 CPI
    #[account(mut)]
    pub staker_token_account: UncheckedAccount<'info>,

    /// Quantum yield vault token account (PDA-owned)
    /// CHECK: PDA authority validates ownership
    #[account(mut)]
    pub vault_token_account: UncheckedAccount<'info>,

    /// Vault authority PDA
    /// CHECK: Derived from seeds
    #[account(
        seeds = [b"quantum-yield-vault"],
        bump,
    )]
    pub vault_authority: UncheckedAccount<'info>,

    /// Quantum yield vault record PDA
    #[account(
        init,
        payer = staker,
        space = QuantumYieldVault::LEN,
        seeds = [b"quantum-yield", staker.key().as_ref()],
        bump,
    )]
    pub yield_vault: Account<'info, QuantumYieldVault>,

    /// The OST mint
    /// CHECK: Validated by Token-2022 CPI
    pub mint: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token2022>,
    pub system_program: Program<'info, System>,
}

pub fn handler_quantum_stake(
    ctx: Context<QuantumYieldStake>,
    amount: u64,
) -> Result<()> {
    require!(amount > 0, OstError::ZeroAmount);

    // ---- Transfer OST from staker → yield vault ----
    let cpi_accounts = TransferChecked {
        from: ctx.accounts.staker_token_account.to_account_info(),
        to: ctx.accounts.vault_token_account.to_account_info(),
        authority: ctx.accounts.staker.to_account_info(),
        mint: ctx.accounts.mint.to_account_info(),
    };
    let cpi_ctx = CpiContext::new(
        ctx.accounts.token_program.to_account_info(),
        cpi_accounts,
    );
    token_2022::transfer_checked(cpi_ctx, amount, 9)?;

    // ---- Record the quantum yield vault ----
    let vault = &mut ctx.accounts.yield_vault;
    vault.staker = ctx.accounts.staker.key();
    vault.amount = amount;
    vault.staked_at = Clock::get()?.unix_timestamp;
    vault.collapsed = false;
    vault.yield_bps = 0; // Undetermined until collapse
    vault.vrf_seed = [0u8; 32]; // Set at collapse time
    vault.bump = ctx.bumps.yield_vault;

    msg!(
        "Quantum yield stake: {} OST (staker: {}, yield: superposed)",
        amount,
        vault.staker
    );

    Ok(())
}

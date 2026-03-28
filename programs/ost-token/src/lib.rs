// ============================================================================
// OST (Out-of-Space Token) — Anchor Program
// ============================================================================
// SPL Token-2022 with Confidential Transfers & Confidential Balances
// Fair-launch (no pre-mine), 9 decimals, governance staking, ZK tax reports
// ============================================================================

use anchor_lang::prelude::*;

pub mod state;
pub mod errors;
pub mod instructions;

use instructions::*;

declare_id!("J2jiS296YWVie1Sopb4SxcM3aJnP9aAwe6aLDhCqvGXY");

#[program]
pub mod ost_token {
    use super::*;

    // ========================================================================
    // 1. INITIALIZE MINT
    // ========================================================================
    // Creates the OST Token-2022 mint with ConfidentialTransferMint extension
    // enabled by default. No tokens are pre-mined — fair launch.
    //
    // The mint is created as a PDA so the program retains mint authority for
    // future controlled minting (e.g. staking rewards).
    // ========================================================================
    pub fn initialize_mint(ctx: Context<InitializeMint>) -> Result<()> {
        instructions::initialize_mint::handler(ctx)
    }

    // ========================================================================
    // 2. CONFIGURE CONFIDENTIAL ACCOUNT
    // ========================================================================
    // Each user must call this once to configure their token account for
    // confidential transfers. This sets up the ElGamal public key and the
    // decryptable balance for the account using Token-2022 extensions.
    // ========================================================================
    pub fn configure_confidential_account(
        ctx: Context<ConfigureConfidentialAccount>,
        elgamal_pubkey: [u8; 32],
        decryptable_zero_balance: [u8; 36],
        proof_context: [u8; 32],
        proof_data: Vec<u8>,
    ) -> Result<()> {
        instructions::configure_confidential::handler(
            ctx,
            elgamal_pubkey,
            decryptable_zero_balance,
            proof_context,
            proof_data,
        )
    }

    // ========================================================================
    // 3. CONFIDENTIAL MINT (Fair Launch Distribution)
    // ========================================================================
    // Mints tokens directly into a user's confidential balance. Only the
    // mint authority (program PDA) can call this. Used for fair distributions
    // such as faucet claims or staking rewards — never pre-mined to team.
    // ========================================================================
    pub fn confidential_mint(
        ctx: Context<ConfidentialMint>,
        amount: u64,
        proof_data: Vec<u8>,
    ) -> Result<()> {
        instructions::confidential_mint::handler(ctx, amount, proof_data)
    }

    // ========================================================================
    // 4. CONFIDENTIAL TRANSFER (P2P Payment)
    // ========================================================================
    // Transfers OST between two users with fully encrypted amounts. Both the
    // sender's and receiver's balances remain confidential. Uses Token-2022
    // ConfidentialTransfer extension with ZK range proofs.
    // ========================================================================
    pub fn confidential_transfer(
        ctx: Context<ConfidentialTransferIx>,
        proof_data: Vec<u8>,
        new_decryptable_available_balance: [u8; 36],
    ) -> Result<()> {
        instructions::confidential_transfer::handler(
            ctx,
            proof_data,
            new_decryptable_available_balance,
        )
    }

    // ========================================================================
    // 5. STAKE (Governance)
    // ========================================================================
    // Stakes OST tokens for governance voting. The staked amount is recorded
    // in a StakeAccount PDA. Staking locks tokens for a minimum period
    // before they can be unstaked.
    // ========================================================================
    pub fn stake(ctx: Context<Stake>, amount: u64) -> Result<()> {
        instructions::stake::handler(ctx, amount)
    }

    // ========================================================================
    // 6. UNSTAKE
    // ========================================================================
    // Returns staked tokens after the lock period has elapsed.
    // ========================================================================
    pub fn unstake(ctx: Context<Unstake>) -> Result<()> {
        instructions::unstake::handler(ctx)
    }

    // ========================================================================
    // 7. VOTE (Governance Proposal)
    // ========================================================================
    // Casts a governance vote weighted by staked OST. Users can vote for
    // upgrades such as quantum-resistance algorithms or tax-report tools.
    // ========================================================================
    pub fn cast_vote(ctx: Context<CastVote>, proposal_id: u64, approve: bool) -> Result<()> {
        instructions::vote::handler(ctx, proposal_id, approve)
    }

    // ========================================================================
    // 8. CREATE GOVERNANCE PROPOSAL
    // ========================================================================
    // Creates a new governance proposal that stakers can vote on.
    // ========================================================================
    pub fn create_proposal(
        ctx: Context<CreateProposal>,
        proposal_id: u64,
        description: String,
    ) -> Result<()> {
        instructions::proposal::handler(ctx, proposal_id, description)
    }

    // ========================================================================
    // 9. ZK TAX REPORT (Optional)
    // ========================================================================
    // Generates a zero-knowledge proof that taxes were calculated correctly
    // on a set of transactions, without revealing individual amounts, parties,
    // or balances. The proof is stored on-chain as a verifiable attestation.
    // ========================================================================
    pub fn submit_zk_tax_report(
        ctx: Context<SubmitZkTaxReport>,
        tax_year: u16,
        total_transactions: u32,
        proof_hash: [u8; 32],
        jurisdiction_code: [u8; 2],
    ) -> Result<()> {
        instructions::zk_tax_report::handler(
            ctx,
            tax_year,
            total_transactions,
            proof_hash,
            jurisdiction_code,
        )
    }

    // ========================================================================
    // 10. APPLY PENDING BALANCE
    // ========================================================================
    // After receiving confidential tokens, users must "apply" pending balance
    // to their available balance before they can spend. This is a Token-2022
    // confidential transfer requirement.
    // ========================================================================
    pub fn apply_pending_balance(
        ctx: Context<ApplyPendingBalance>,
        new_decryptable_available_balance: [u8; 36],
    ) -> Result<()> {
        instructions::apply_pending::handler(ctx, new_decryptable_available_balance)
    }

    // ========================================================================
    // 11. DEPOSIT (Public → Confidential)
    // ========================================================================
    // Moves tokens from public balance into confidential pending balance.
    // After minting, tokens are public — deposit makes them private.
    // User must call apply_pending_balance after this.
    // ========================================================================
    pub fn deposit(ctx: Context<Deposit>, amount: u64, proof_data: Vec<u8>) -> Result<()> {
        instructions::deposit::handler(ctx, amount, proof_data)
    }

    // ========================================================================
    // 12. WITHDRAW (Confidential → Public)
    // ========================================================================
    // Moves tokens from confidential available balance back to public.
    // Needed for staking, DEX interactions, or any non-CT protocol.
    // ========================================================================
    pub fn withdraw(
        ctx: Context<Withdraw>,
        amount: u64,
        new_decryptable_available_balance: [u8; 36],
        proof_data: Vec<u8>,
    ) -> Result<()> {
        instructions::withdraw::handler(ctx, amount, new_decryptable_available_balance, proof_data)
    }

    // ========================================================================
    // 13. INITIALIZE DAO TREASURY
    // ========================================================================
    // Sets up the Space DAO fee collector. Default 0.1% (10 bps) on every
    // transfer_with_fee and merchant_payment. Fees fund governance proposals
    // for satellite/DePIN infrastructure.
    // ========================================================================
    pub fn initialize_treasury(ctx: Context<InitializeTreasury>) -> Result<()> {
        instructions::init_treasury::handler(ctx)
    }

    // ========================================================================
    // 14. TRANSFER WITH FEE (P2P + DAO Fee)
    // ========================================================================
    // Public-balance transfer that auto-skims 0.1% to DAO treasury.
    // Use for payments where fee transparency is desired.
    // For fully private transfers (no fee), use confidential_transfer.
    // ========================================================================
    pub fn transfer_with_fee(ctx: Context<TransferWithFee>, amount: u64) -> Result<()> {
        instructions::transfer_with_fee::handler(ctx, amount)
    }

    // ========================================================================
    // 15. REGISTER MERCHANT (Solana Pay)
    // ========================================================================
    // Registers a merchant for OST payments. Creates a PDA with payment
    // details. The client SDK generates Solana Pay QR codes pointing to
    // the merchant_payment instruction.
    // ========================================================================
    pub fn register_merchant(ctx: Context<RegisterMerchant>, label: String) -> Result<()> {
        instructions::register_merchant::handler(ctx, label)
    }

    // ========================================================================
    // 16. MERCHANT PAYMENT (Solana Pay Checkout)
    // ========================================================================
    // Buyer pays merchant with auto DAO fee. This is the instruction that
    // Solana Pay QR codes resolve to. Tracks merchant sales on-chain.
    // ========================================================================
    pub fn merchant_payment(
        ctx: Context<MerchantPayment>,
        amount: u64,
        memo: Option<String>,
    ) -> Result<()> {
        instructions::merchant_payment::handler(ctx, amount, memo)
    }

    // ========================================================================
    // 17. OFFLINE CONFIDENTIAL TRANSFER
    // ========================================================================
    // Speed-of-light privacy: ZK proofs generated on-device, signed offline,
    // shared via QR/NFC/Bluetooth. Settles on-chain when connectivity returns.
    // The first true "tap-to-pay" private cash for offline environments.
    // ========================================================================
    pub fn offline_confidential_transfer(
        ctx: Context<OfflineConfidentialTransfer>,
        proof_data: Vec<u8>,
        new_decryptable_available_balance: [u8; 36],
        offline_nonce: u64,
        offline_timestamp: i64,
        transport_method: u8,
    ) -> Result<()> {
        instructions::offline_confidential_transfer::handler(
            ctx,
            proof_data,
            new_decryptable_available_balance,
            offline_nonce,
            offline_timestamp,
            transport_method,
        )
    }

    // ========================================================================
    // 18. MINT BEARER NOTE (Ecash Vault)
    // ========================================================================
    // Lock OST into a vault PDA and receive a redeemable bearer token.
    // Inspired by Cashu ecash: the secret is a 32-byte value that can be
    // shared via QR/NFC/paper. Whoever holds the secret can redeem the OST.
    // Enables tap-to-pay USD cash offline: agent gives cash, receives note.
    // ========================================================================
    pub fn mint_bearer_note(
        ctx: Context<MintBearerNote>,
        secret_hash: [u8; 32],
        amount: u64,
        expires_at: i64,
    ) -> Result<()> {
        instructions::mint_bearer_note::handler(ctx, secret_hash, amount, expires_at)
    }

    // ========================================================================
    // 19. REDEEM BEARER NOTE
    // ========================================================================
    // Reveal the raw secret to unlock OST from the ecash vault.
    // One-time use. Supports optional expiry for time-limited notes.
    // ========================================================================
    pub fn redeem_bearer_note(
        ctx: Context<RedeemBearerNote>,
        secret: [u8; 32],
    ) -> Result<()> {
        instructions::redeem_bearer_note::handler(ctx, secret)
    }

    // ========================================================================
    // 20. CLAIM FAUCET (Education Drop)
    // ========================================================================
    // One-time OST drop from treasury for new wallets. Mirrors Bitcoin's
    // original faucet but with built-in education: the user immediately
    // experiences private P2P cash. PDA ensures no double claims.
    // ========================================================================
    pub fn claim_faucet(ctx: Context<ClaimFaucet>) -> Result<()> {
        instructions::claim_faucet::handler(ctx)
    }

    // ========================================================================
    // 21. SEEDLESS ONBOARD (Web3Auth / Passkeys)
    // ========================================================================
    // Records seedless wallet creation for analytics and faucet eligibility.
    // Actual key derivation happens client-side via Web3Auth MPC or platform
    // passkeys (Face ID, fingerprint, Windows Hello). No seed phrase needed.
    // ========================================================================
    pub fn seedless_onboard(
        ctx: Context<SeedlessOnboard>,
        auth_method: u8,
    ) -> Result<()> {
        instructions::seedless_onboard::handler(ctx, auth_method)
    }

    // ========================================================================
    // 22. AI REWARD STAKE (DePIN Hook)
    // ========================================================================
    // Registers a user's device resources (bandwidth, GPU, CPU, storage)
    // for DePIN earning. The wallet's AI agent auto-stakes resources into
    // Grass, Render, Helium, Dawn, or Spacecoin — earning OST passively.
    // P2P-focused and private: all data stays on-device.
    // ========================================================================
    pub fn ai_reward_stake(
        ctx: Context<AiRewardStakeIx>,
        provider: u8,
        resource_type: u8,
    ) -> Result<()> {
        instructions::ai_reward_stake::handler(ctx, provider, resource_type)
    }

    // ========================================================================
    // 23. CREATE GROW VAULT (Family Accounts)
    // ========================================================================
    // Creates a custodial "Grow Vault" for a child. Parent/guardian controls
    // the vault until the child turns 18. The vault receives small OST drops
    // at age milestones — babies get their first OST before they can speak.
    // Family Grow Accounts for the next generation of space citizens.
    // ========================================================================
    pub fn create_grow_vault(
        ctx: Context<CreateGrowVault>,
        child_birth_year: u16,
    ) -> Result<()> {
        instructions::grow_vault::handler_create(ctx, child_birth_year)
    }

    // ========================================================================
    // 24. CLAIM GROW FAUCET (Milestone Rewards)
    // ========================================================================
    // Claims OST from treasury for reaching an age milestone. Max 7 claims
    // per vault (ages 0, 1, 5, 10, 13, 16, 18). Each milestone claimed once.
    // At age 18 the vault graduates — child takes full control.
    // ========================================================================
    pub fn claim_grow_faucet(
        ctx: Context<ClaimGrowFaucet>,
        milestone_index: u8,
    ) -> Result<()> {
        instructions::grow_vault::handler_claim(ctx, milestone_index)
    }

    // ========================================================================
    // 25. CLAIM DEPIN FAUCET (Infrastructure Rewards)
    // ========================================================================
    // Rewards users who contribute bandwidth, GPU, CPU, storage, LoRa/5G,
    // or satellite relay to the decentralized data centers and satellite
    // internet. Requires active DePIN stake + attestation proof. 24h cooldown.
    // Reward for building the decentralized data centers and satellite internet.
    // ========================================================================
    pub fn claim_depin_faucet(
        ctx: Context<ClaimDepinFaucet>,
        attestation_hash: [u8; 32],
    ) -> Result<()> {
        instructions::claim_depin_faucet::handler(ctx, attestation_hash)
    }
}

// ============================================================================
// State Accounts for OST Token Program
// ============================================================================

use anchor_lang::prelude::*;

// ============================================================================
// MINT CONFIG — Stores metadata about the OST mint (PDA-owned)
// ============================================================================
#[account]
pub struct MintConfig {
    /// The bump seed for the mint PDA
    pub bump: u8,
    /// The bump seed for the mint authority PDA
    pub authority_bump: u8,
    /// Whether confidential transfers are enabled (always true for OST)
    pub confidential_transfers_enabled: bool,
    /// Total supply minted so far (public counter for transparency)
    pub total_minted: u64,
    /// Admin who can create proposals (initially the deployer)
    pub admin: Pubkey,
    /// Reserved space for future upgrades
    pub _reserved: [u8; 128],
}

impl MintConfig {
    pub const LEN: usize = 8  // discriminator
        + 1   // bump
        + 1   // authority_bump
        + 1   // confidential_transfers_enabled
        + 8   // total_minted
        + 32  // admin
        + 128; // reserved
}

// ============================================================================
// STAKE ACCOUNT — Tracks a user's staked OST for governance
// ============================================================================
#[account]
pub struct StakeAccount {
    /// The user who staked
    pub owner: Pubkey,
    /// Amount of OST staked (in raw lamports, 9 decimals)
    pub amount: u64,
    /// Unix timestamp when the stake was created
    pub staked_at: i64,
    /// Minimum lock duration in seconds (default: 7 days)
    pub lock_duration: i64,
    /// The bump for this PDA
    pub bump: u8,
    /// Reserved space
    pub _reserved: [u8; 64],
}

impl Default for StakeAccount {
    fn default() -> Self {
        Self {
            owner: Pubkey::default(),
            amount: 0,
            staked_at: 0,
            lock_duration: 0,
            bump: 0,
            _reserved: [0u8; 64],
        }
    }
}

impl StakeAccount {
    pub const LEN: usize = 8  // discriminator
        + 32  // owner
        + 8   // amount
        + 8   // staked_at
        + 8   // lock_duration
        + 1   // bump
        + 64; // reserved

    /// Default lock period: 7 days
    pub const DEFAULT_LOCK_SECONDS: i64 = 7 * 24 * 60 * 60;
}

// ============================================================================
// GOVERNANCE PROPOSAL
// ============================================================================
#[account]
pub struct Proposal {
    /// Unique proposal ID
    pub proposal_id: u64,
    /// Creator of the proposal
    pub proposer: Pubkey,
    /// Short description (max 256 chars)
    pub description: String,
    /// Total votes in favour (weighted by staked amount)
    pub votes_for: u64,
    /// Total votes against
    pub votes_against: u64,
    /// Unix timestamp when voting ends (default: 7 days from creation)
    pub voting_ends_at: i64,
    /// Whether the proposal has been executed
    pub executed: bool,
    /// Bump
    pub bump: u8,
    /// Reserved
    pub _reserved: [u8; 64],
}

impl Proposal {
    pub const MAX_DESCRIPTION_LEN: usize = 256;
    pub const LEN: usize = 8  // discriminator
        + 8   // proposal_id
        + 32  // proposer
        + 4 + Self::MAX_DESCRIPTION_LEN // description (borsh string)
        + 8   // votes_for
        + 8   // votes_against
        + 8   // voting_ends_at
        + 1   // executed
        + 1   // bump
        + 64; // reserved

    /// Voting period: 7 days
    pub const VOTING_PERIOD: i64 = 7 * 24 * 60 * 60;
}

// ============================================================================
// VOTE RECORD — Prevents double voting
// ============================================================================
#[account]
pub struct VoteRecord {
    /// The voter
    pub voter: Pubkey,
    /// Which proposal
    pub proposal_id: u64,
    /// Vote cast (true = approve, false = reject)
    pub approve: bool,
    /// Weight of the vote (staked amount at time of voting)
    pub weight: u64,
    /// Bump
    pub bump: u8,
}

impl VoteRecord {
    pub const LEN: usize = 8  // discriminator
        + 32  // voter
        + 8   // proposal_id
        + 1   // approve
        + 8   // weight
        + 1; // bump
}

// ============================================================================
// DAO TREASURY CONFIG — Auto-fee destination for Space DAO
// ============================================================================
#[account]
pub struct DaoTreasury {
    /// The treasury token account (receives 0.1% of transfers)
    pub treasury_token_account: Pubkey,
    /// Fee in basis points (10 = 0.1%)
    pub fee_basis_points: u16,
    /// Total fees collected (running counter)
    pub total_fees_collected: u64,
    /// Authority who can update treasury config
    pub authority: Pubkey,
    /// Bump
    pub bump: u8,
    /// Reserved
    pub _reserved: [u8; 64],
}

impl DaoTreasury {
    /// Default fee: 0.1% = 10 basis points
    pub const DEFAULT_FEE_BPS: u16 = 10;
    pub const LEN: usize = 8  // discriminator
        + 32  // treasury_token_account
        + 2   // fee_basis_points
        + 8   // total_fees_collected
        + 32  // authority
        + 1   // bump
        + 64; // reserved
}

// ============================================================================
// MERCHANT REGISTRY — Registered merchants for Solana Pay integration
// ============================================================================
#[account]
pub struct MerchantAccount {
    /// Merchant's wallet pubkey
    pub owner: Pubkey,
    /// Merchant's token account for receiving OST
    pub token_account: Pubkey,
    /// Human-readable label (max 64 chars, e.g. "SpaceShop NYC")
    pub label: String,
    /// Whether merchant is active
    pub active: bool,
    /// Total payments received (counter)
    pub total_received: u64,
    /// Bump
    pub bump: u8,
    /// Reserved
    pub _reserved: [u8; 64],
}

impl MerchantAccount {
    pub const MAX_LABEL_LEN: usize = 64;
    pub const LEN: usize = 8  // discriminator
        + 32  // owner
        + 32  // token_account
        + 4 + Self::MAX_LABEL_LEN // label
        + 1   // active
        + 8   // total_received
        + 1   // bump
        + 64; // reserved
}

// ============================================================================
// BEARER NOTE — Ecash vault for offline redeemable tokens (Cashu-inspired)
// ============================================================================
#[account]
pub struct BearerNote {
    /// SHA-256 hash of the bearer secret (the program never sees the raw secret)
    pub secret_hash: [u8; 32],
    /// Amount of OST locked in this note
    pub amount: u64,
    /// Who minted (locked) the note
    pub minter: Pubkey,
    /// Whether the note has been redeemed
    pub redeemed: bool,
    /// When the note was created
    pub created_at: i64,
    /// Expiry timestamp (0 = never expires)
    pub expires_at: i64,
    /// Bump
    pub bump: u8,
}

impl BearerNote {
    pub const LEN: usize = 8  // discriminator
        + 32  // secret_hash
        + 8   // amount
        + 32  // minter
        + 1   // redeemed
        + 8   // created_at
        + 8   // expires_at
        + 1; // bump
}

// ============================================================================
// FAUCET CLAIM — Tracks one-time faucet claims per wallet
// ============================================================================
#[account]
pub struct FaucetClaim {
    /// The wallet that claimed
    pub claimer: Pubkey,
    /// Amount received
    pub amount: u64,
    /// When claimed
    pub claimed_at: i64,
    /// Bump
    pub bump: u8,
}

impl FaucetClaim {
    pub const LEN: usize = 8  // discriminator
        + 32  // claimer
        + 8   // amount
        + 8   // claimed_at
        + 1; // bump
}

// ============================================================================
// SEEDLESS ACCOUNT — Records seedless onboarding (Web3Auth / Passkeys)
// ============================================================================
#[account]
pub struct SeedlessAccount {
    /// The user's wallet pubkey (derived via MPC/passkey)
    pub user: Pubkey,
    /// Auth method: 0=Web3Auth, 1=Passkey, 2=Email-link, 3=Other
    pub auth_method: u8,
    /// When onboarded
    pub onboarded_at: i64,
    /// Bump
    pub bump: u8,
}

impl SeedlessAccount {
    pub const LEN: usize = 8  // discriminator
        + 32  // user
        + 1   // auth_method
        + 8   // onboarded_at
        + 1; // bump
}

// ============================================================================
// AI REWARD STAKE — DePIN integration for passive earning
// ============================================================================
#[account]
#[derive(Default)]
pub struct AiRewardStake {
    /// The user
    pub user: Pubkey,
    /// Provider: 0=Grass, 1=Render, 2=Helium, 3=Dawn, 4=Spacecoin, 5=Other
    pub provider: u8,
    /// Resource: 0=Bandwidth, 1=GPU, 2=CPU, 3=Storage, 4=LoRa/5G, 5=Satellite
    pub resource_type: u8,
    /// Whether actively staking resources
    pub active: bool,
    /// Total OST earned from DePIN rewards
    pub total_earned: u64,
    /// Last reward claim timestamp
    pub last_claim_at: i64,
    /// Bump
    pub bump: u8,
}

impl AiRewardStake {
    pub const LEN: usize = 8  // discriminator
        + 32  // user
        + 1   // provider
        + 1   // resource_type
        + 1   // active
        + 8   // total_earned
        + 8   // last_claim_at
        + 1; // bump
}

// ============================================================================
// ZK TAX REPORT — On-chain attestation of tax compliance
// ============================================================================
#[account]
pub struct ZkTaxReport {
    /// The taxpayer
    pub owner: Pubkey,
    /// Tax year (e.g. 2026)
    pub tax_year: u16,
    /// Number of transactions covered
    pub total_transactions: u32,
    /// Hash of the ZK proof (verified off-chain by auditors)
    pub proof_hash: [u8; 32],
    /// ISO 3166-1 alpha-2 country code (e.g. b"US")
    pub jurisdiction_code: [u8; 2],
    /// Timestamp of submission
    pub submitted_at: i64,
    /// Bump
    pub bump: u8,
    /// Reserved
    pub _reserved: [u8; 64],
}

impl ZkTaxReport {
    pub const LEN: usize = 8  // discriminator
        + 32  // owner
        + 2   // tax_year
        + 4   // total_transactions
        + 32  // proof_hash
        + 2   // jurisdiction_code
        + 8   // submitted_at
        + 1   // bump
        + 64; // reserved
}

// ============================================================================
// GROW VAULT — Family Grow Accounts for the next generation of space citizens
// ============================================================================
#[account]
pub struct GrowVault {
    /// Parent/guardian wallet
    pub parent: Pubkey,
    /// Child's birth year (e.g. 2024) — no real KYC, just an age flag
    pub child_birth_year: u16,
    /// Bitmask of claimed milestones (bit 0 = age 0, bit 1 = age 1, etc.)
    pub milestones_claimed: u8,
    /// Total OST received from milestone faucet drops
    pub total_received: u64,
    /// When the vault was created
    pub created_at: i64,
    /// Whether the child has "graduated" (turned 18)
    pub graduated: bool,
    /// Bump
    pub bump: u8,
}

impl GrowVault {
    pub const LEN: usize = 8   // discriminator
        + 32  // parent
        + 2   // child_birth_year
        + 1   // milestones_claimed
        + 8   // total_received
        + 8   // created_at
        + 1   // graduated
        + 1; // bump
}

// ============================================================================
// DEPIN CLAIM — Tracks DePIN faucet claims and cooldown
// ============================================================================
#[account]
#[derive(Default)]
pub struct DepinClaim {
    /// The contributor
    pub contributor: Pubkey,
    /// Last claim timestamp (for 24h cooldown)
    pub last_claim_at: i64,
    /// Total OST claimed from DePIN faucet
    pub total_claimed: u64,
    /// Number of claims made
    pub claim_count: u32,
    /// Hash of last attestation (prevents replay)
    pub last_attestation_hash: [u8; 32],
    /// Bump
    pub bump: u8,
}

impl DepinClaim {
    pub const LEN: usize = 8   // discriminator
        + 32  // contributor
        + 8   // last_claim_at
        + 8   // total_claimed
        + 4   // claim_count
        + 32  // last_attestation_hash
        + 1; // bump
}

// ============================================================================
// Gift Card Exchange — two-way interchange record
// ============================================================================

#[account]
pub struct GiftCardExchange {
    /// User who initiated the exchange
    pub user: Pubkey,
    /// Unique nonce (prevents PDA collision)
    pub nonce: u64,
    /// true = buying a gift card with OST, false = selling a gift card for OST
    pub is_buy: bool,
    /// Merchant / brand name (max 32 chars)
    pub merchant: String,
    /// SHA-256 hash of original gift card code (never store raw codes on-chain)
    pub code_hash: [u8; 32],
    /// USD-equivalent amount (9-decimal precision)
    pub amount_usd: u64,
    /// Fee deducted (0.1 %)
    pub fee: u64,
    /// Unix timestamp of the exchange
    pub timestamp: i64,
    /// Bump
    pub bump: u8,
}

impl GiftCardExchange {
    pub const LEN: usize = 8   // discriminator
        + 32  // user
        + 8   // nonce
        + 1   // is_buy
        + 36  // merchant (4 bytes len + 32 bytes data)
        + 32  // code_hash
        + 8   // amount_usd
        + 8   // fee
        + 8   // timestamp
        + 1; // bump
}

// ============================================================================
// QUANTUM BEARER TOKEN — Post-quantum protected bearer instrument
// ============================================================================
#[account]
pub struct QuantumBearerToken {
    pub wots_root: [u8; 32],
    pub lattice_commitment: [u8; 32],
    pub amount: u64,
    pub minter: Pubkey,
    pub redeemed: bool,
    pub created_at: i64,
    pub expires_at: i64,
    pub security_level: u8,
    pub bump: u8,
}

impl QuantumBearerToken {
    pub const LEN: usize = 8 + 32 + 32 + 8 + 32 + 1 + 8 + 8 + 1 + 1;
}

// ============================================================================
// ENTANGLED PAIR — Quantum-linked wallet pair
// ============================================================================
#[account]
pub struct EntangledPair {
    pub wallet_a: Pubkey,
    pub wallet_b: Pubkey,
    pub kyber_shared_hash: [u8; 32],
    pub entangled_at: i64,
    pub active: bool,
    pub transfer_count: u32,
    pub bump: u8,
}

impl EntangledPair {
    pub const LEN: usize = 8 + 32 + 32 + 32 + 8 + 1 + 4 + 1;
}

// ============================================================================
// QUANTUM YIELD VAULT — Superposition staking vault
// ============================================================================
#[account]
pub struct QuantumYieldVault {
    pub staker: Pubkey,
    pub amount: u64,
    pub staked_at: i64,
    pub collapsed: bool,
    pub yield_bps: u16,
    pub vrf_seed: [u8; 32],
    pub bump: u8,
}

impl QuantumYieldVault {
    pub const LEN: usize = 8 + 32 + 8 + 8 + 1 + 2 + 32 + 1;
}

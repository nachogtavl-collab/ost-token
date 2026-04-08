// ============================================================================
// Instructions module — re-exports all instruction handlers
// ============================================================================

pub mod initialize_mint;
pub mod configure_confidential;
pub mod confidential_mint;
pub mod confidential_transfer;
pub mod stake;
pub mod unstake;
pub mod vote;
pub mod proposal;
pub mod zk_tax_report;
pub mod apply_pending;
pub mod deposit;
pub mod withdraw;
pub mod init_treasury;
pub mod transfer_with_fee;
pub mod register_merchant;
pub mod merchant_payment;
pub mod offline_confidential_transfer;
pub mod mint_bearer_note;
pub mod redeem_bearer_note;
pub mod claim_faucet;
pub mod seedless_onboard;
pub mod ai_reward_stake;
pub mod grow_vault;
pub mod claim_depin_faucet;
pub mod exchange_gift_card;
pub mod quantum_realm;

pub use initialize_mint::*;
pub use configure_confidential::*;
pub use confidential_mint::*;
pub use confidential_transfer::*;
pub use stake::*;
pub use unstake::*;
pub use vote::*;
pub use proposal::*;
pub use zk_tax_report::*;
pub use apply_pending::*;
pub use deposit::*;
pub use withdraw::*;
pub use init_treasury::*;
pub use transfer_with_fee::*;
pub use register_merchant::*;
pub use merchant_payment::*;
pub use offline_confidential_transfer::*;
pub use mint_bearer_note::*;
pub use redeem_bearer_note::*;
pub use claim_faucet::*;
pub use seedless_onboard::*;
pub use ai_reward_stake::*;
pub use grow_vault::*;
pub use claim_depin_faucet::*;
pub use exchange_gift_card::*;
pub use quantum_realm::*;

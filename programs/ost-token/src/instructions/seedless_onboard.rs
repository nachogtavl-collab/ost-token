// ============================================================================
// Seedless Onboard — Frictionless Wallet Creation (Web3Auth / Passkeys)
// ============================================================================
//
// PROBLEM: Traditional crypto wallets require 12-word seed phrases. Normal
// people lose them, get confused, or simply don't start. OST needs to be
// as easy as downloading an app and tapping "Start".
//
// SOLUTION: Seedless authentication via Web3Auth or platform passkeys.
// The user's private key is derived from their existing identity (Google,
// Apple, email, or biometric passkey) and split using MPC/TSS so no single
// party ever holds the full key.
//
// HOW TO INTEGRATE WEB3AUTH (commented reference — client-side only):
//
// ```typescript
// import { Web3Auth } from "@web3auth/modal";
// import { SolanaPrivateKeyProvider } from "@web3auth/solana-provider";
//
// const web3auth = new Web3Auth({
//   clientId: "YOUR_WEB3AUTH_CLIENT_ID",
//   chainConfig: {
//     chainNamespace: "solana",
//     chainId: "0x3",  // devnet
//     rpcTarget: "https://api.devnet.solana.com",
//   },
//   web3AuthNetwork: "sapphire_mainnet",
// });
//
// await web3auth.initModal();
// const provider = await web3auth.connect(); // Google/Apple/Email login
// // provider now has a Solana keypair derived via MPC — no seed phrase!
//
// // Wrap in Anchor provider and use OstClient as normal:
// const anchorProvider = new AnchorProvider(connection, walletAdapter, {});
// const ostClient = new OstClient(anchorProvider);
// ```
//
// HOW TO INTEGRATE PASSKEYS (WebAuthn — commented reference):
//
// ```typescript
// // Browser-native passkey (Face ID / fingerprint / Windows Hello):
// const credential = await navigator.credentials.create({
//   publicKey: {
//     challenge: randomChallenge,
//     rp: { name: "OST Wallet" },
//     user: { id: userId, name: "user@example.com", displayName: "User" },
//     pubKeyCredParams: [{ alg: -7, type: "public-key" }], // ES256
//     authenticatorSelection: { residentKey: "required" },
//   },
// });
// // Derive Solana keypair from the passkey credential using a KDF
// // (e.g., HKDF over the credential's raw public key).
// // Store the derivation path locally — no seed phrase needed.
// ```
//
// ON-CHAIN PART: This instruction simply records that a wallet was onboarded
// via a seedless method, for analytics and faucet eligibility tracking.
// The actual key derivation happens entirely client-side.
// ============================================================================

use anchor_lang::prelude::*;

use crate::state::SeedlessAccount;

#[derive(Accounts)]
pub struct SeedlessOnboard<'info> {
    /// The new user's wallet (derived via Web3Auth/passkey on the client)
    #[account(mut)]
    pub user: Signer<'info>,

    /// Seedless onboarding record PDA
    #[account(
        init,
        payer = user,
        space = SeedlessAccount::LEN,
        seeds = [b"seedless", user.key().as_ref()],
        bump,
    )]
    pub seedless_account: Account<'info, SeedlessAccount>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<SeedlessOnboard>,
    // Auth method: 0=Web3Auth, 1=Passkey, 2=Email-link, 3=Other
    auth_method: u8,
) -> Result<()> {
    let account = &mut ctx.accounts.seedless_account;
    account.user = ctx.accounts.user.key();
    account.auth_method = auth_method;
    account.onboarded_at = Clock::get()?.unix_timestamp;
    account.bump = ctx.bumps.seedless_account;

    msg!(
        "Seedless onboarding: {} (method: {})",
        ctx.accounts.user.key(),
        match auth_method {
            0 => "Web3Auth",
            1 => "Passkey",
            2 => "Email-link",
            _ => "Other",
        }
    );

    Ok(())
}

// ============================================================================
// BUY WITH FIAT PLACEHOLDER
// ============================================================================
//
// Fiat on-ramp is handled entirely off-chain via third-party providers.
// The wallet UI embeds links/widgets from:
//
//   - Onramper (aggregator): Supports CNY, RUB, BRL, IRR, EUR, USD, etc.
//     URL: https://widget.onramper.com?defaultCrypto=SOL&onlyCryptos=SOL,USDC
//     After buying SOL/USDC, the wallet auto-swaps to OST via Jupiter.
//
//   - MoonPay: 100+ countries, card + bank transfer
//   - Transak: 150+ countries, lower fees in emerging markets
//   - Ramp Network: EU/UK focused, instant SEPA
//
// ```typescript
// // In the wallet UI:
// const fiatBuyUrl = `https://widget.onramper.com?` +
//   `defaultCrypto=SOL&onlyCryptos=SOL,USDC` +
//   `&walletAddress=${userWalletAddress}` +
//   `&defaultFiat=${userLocalCurrency}`;  // e.g., CNY, RUB, BRL
//
// // Open in embedded WebView or browser:
// window.open(fiatBuyUrl);
// // After purchase completes, SOL/USDC arrives in wallet.
// // Auto-swap to OST via Jupiter (see swap widget component).
// ```
//
// NO KYC FOR SWAPS: Once the user has any Solana token (from any source),
// swapping to OST via Jupiter is permissionless and KYC-free. The KYC
// requirement only applies at the fiat on-ramp level, which varies by
// provider and amount.
//
// ============================================================================

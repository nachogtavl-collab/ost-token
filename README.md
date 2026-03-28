# OST — Out-of-Space Token

**SPL Token-2022 with Confidential Transfers & Confidential Balances on Solana**

> Fair-launch utility token with governance staking, ZK tax reports, and encrypted P2P payments.

---

## Features

| Feature | Description |
|---|---|
| **Confidential Transfers** | All transfers use Token-2022 `ConfidentialTransfer` — amounts and balances are encrypted on-chain |
| **Confidential Balances** | Compatible with Helius 2026 Confidential Balances API for client-side decryption |
| **Fair Launch** | Zero pre-mine. No team allocation. All tokens are minted through controlled distribution |
| **9 Decimals** | Standard SPL precision for DeFi composability |
| **Governance Staking** | Stake OST to vote on protocol upgrades (quantum resistance, new features) |
| **ZK Tax Reports** | Optionally prove tax compliance with a zero-knowledge proof — no details revealed |
| **P2P Payments** | Basic confidential payment instruction for private peer-to-peer transfers |

---

## Architecture

```
ost-token/
├── programs/ost-token/src/
│   ├── lib.rs                          # Program entrypoint (10 instructions)
│   ├── state.rs                        # Account structs (MintConfig, StakeAccount, Proposal, etc.)
│   ├── errors.rs                       # Custom error codes
│   └── instructions/
│       ├── mod.rs                      # Instruction module re-exports
│       ├── initialize_mint.rs          # Create Token-2022 mint + CT extension
│       ├── configure_confidential.rs   # Enable CT on user's token account
│       ├── confidential_mint.rs        # Fair distribution minting
│       ├── confidential_transfer.rs    # P2P encrypted transfers
│       ├── apply_pending.rs            # Move pending → available balance
│       ├── stake.rs                    # Lock tokens for governance
│       ├── unstake.rs                  # Unlock tokens after 7-day period
│       ├── vote.rs                     # Cast weighted governance vote
│       ├── proposal.rs                 # Create governance proposal
│       └── zk_tax_report.rs           # Submit ZK proof of tax compliance
├── client/
│   └── ost-client.ts                   # TypeScript SDK
├── tests/
│   └── ost-token.ts                    # Integration tests (12 test cases)
├── scripts/
│   └── deploy-ost.ps1                  # Deployment automation
├── Anchor.toml                         # Anchor configuration
├── Cargo.toml                          # Rust workspace
├── package.json                        # Node dependencies
└── README.md                           # This file
```

---

## Prerequisites

```bash
# Solana CLI (v2.1+)
sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"

# Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Anchor CLI (v0.31+)
cargo install --git https://github.com/coral-xyz/anchor avm --locked --force
avm install latest
avm use latest

# Node.js (v20+)
# Install from https://nodejs.org
```

---

## Quick Start

### 1. Install Dependencies

```bash
cd ost-token
npm install
```

### 2. Build

```bash
anchor build
```

This generates:
- `target/deploy/ost_token-keypair.json` — Program keypair
- `target/deploy/ost_token.so` — Compiled BPF program
- `target/idl/ost_token.json` — IDL for client generation

### 3. Get Your Program ID

```bash
solana address -k target/deploy/ost_token-keypair.json
```

Update the program ID in:
- `programs/ost-token/src/lib.rs` → `declare_id!("YOUR_ID")`
- `Anchor.toml` → `[programs.devnet]`
- `client/ost-client.ts` → `OST_PROGRAM_ID`

Then rebuild:
```bash
anchor build
```

### 4. Deploy to Devnet

```powershell
# PowerShell
.\scripts\deploy-ost.ps1

# Or manually:
solana config set --url devnet
solana airdrop 2
anchor deploy --provider.cluster devnet
```

### 5. Run Tests

```bash
# Against local validator
anchor test

# Against devnet
anchor test --provider.cluster devnet
```

---

## Instruction Reference

### `initialize_mint`
Creates the OST Token-2022 mint with confidential transfers auto-enabled. No tokens minted.

### `configure_confidential_account`
Initializes a user's token account for confidential transfers with an ElGamal public key.

### `confidential_mint`
Mints tokens to a user's token account (public balance). Admin only. Used for fair launches.

### `confidential_transfer`
Encrypted P2P transfer between two confidential-enabled token accounts.

### `apply_pending_balance`
Moves received tokens from pending → available confidential balance (required after receiving).

### `stake`
Locks OST in the governance vault. 7-day lock period. Staked amount = voting weight.

### `unstake`
Returns staked tokens after the 7-day lock period.

### `create_proposal`
Admin creates a governance proposal. Examples:
- "Enable quantum-resistant encryption"
- "Add built-in ZK tax report tools"

### `cast_vote`
Casts a vote on a proposal. Weight = staked amount. Cannot double-vote.

### `submit_zk_tax_report`
Stores a ZK proof hash on-chain attesting that taxes were calculated correctly.

---

## Confidential Transfer Flow

The Token-2022 confidential transfer lifecycle:

```
┌──────────────┐     ┌──────────────────────┐     ┌─────────────────┐
│ 1. Mint      │     │ 2. Deposit           │     │ 3. Apply        │
│ confidential │────▶│ (public → pending    │────▶│ pending balance │
│ _mint()      │     │  confidential)       │     │                 │
└──────────────┘     └──────────────────────┘     └────────┬────────┘
                                                           │
                     ┌──────────────────────┐              │
                     │ 4. Transfer          │◀─────────────┘
                     │ confidential         │  Available balance
                     │ _transfer()          │  ready to spend
                     └──────────┬───────────┘
                                │
                     ┌──────────▼───────────┐
                     │ 5. Receiver applies  │
                     │ pending balance      │
                     └──────────────────────┘
```

---

## Helius Confidential Balances (2026)

OST is designed to work with Helius's Confidential Balances API:

```typescript
import { OstClient } from "./client/ost-client";

// Connect via Helius RPC for confidential balance support
const connection = new Connection("https://mainnet.helius-rpc.com/?api-key=YOUR_KEY");

// The Helius SDK provides methods like:
//   helius.getConfidentialBalance(tokenAccount, elgamalSecretKey)
//   helius.decryptPendingBalance(tokenAccount, elgamalSecretKey)
//
// These decrypt the on-chain ciphertexts using your ElGamal key
// locally, so balances are never exposed to the RPC provider.
```

---

## ZK Tax Report Flow

The optional tax compliance feature:

```
┌─────────────────────┐     ┌─────────────────────────┐
│ 1. User collects    │     │ 2. Off-chain ZK circuit  │
│ transaction history │────▶│ computes tax liability   │
│ (decrypted locally) │     │ and generates proof      │
└─────────────────────┘     └────────────┬────────────┘
                                         │
                            ┌────────────▼────────────┐
                            │ 3. SHA-256(proof) stored │
                            │ on-chain via             │
                            │ submit_zk_tax_report()   │
                            └────────────┬────────────┘
                                         │
                            ┌────────────▼────────────┐
                            │ 4. Auditor verifies:    │
                            │ - Fetches proof hash    │
                            │ - User provides proof   │
                            │ - Verifier confirms     │
                            └─────────────────────────┘
```

**What is revealed:** Only that taxes were calculated over N transactions.  
**What stays private:** All amounts, counterparties, and balances.

---

## Governance Proposals

Example proposals the community can vote on:

1. **Quantum Resistance** — Upgrade ElGamal encryption to lattice-based schemes when post-quantum standards are finalized
2. **ZK Tax Tools** — Build integrated zero-knowledge tax report generation for multiple jurisdictions
3. **Fee Structure** — Introduce optional micro-fees for protocol sustainability
4. **Auditor Integration** — Allow verified auditors to access encrypted data with user consent

---

## Security Considerations

- **No pre-mine:** Zero tokens exist until explicitly minted via `confidential_mint`
- **PDA authorities:** All sensitive operations use PDA-signed CPIs
- **Lock periods:** Staked tokens are locked for 7 days to prevent flash-loan governance attacks
- **Double-vote prevention:** VoteRecord PDA ensures one vote per user per proposal
- **Overflow protection:** All arithmetic uses `checked_*` operations
- **Admin-only minting:** Only the admin stored in MintConfig can mint tokens

---

## Devnet vs Mainnet

| Aspect | Devnet | Mainnet |
|---|---|---|
| SOL for deploy | Free (airdrop) | Real SOL (~3-5 SOL) |
| Program upgrade | Anytime | Requires multisig (recommended) |
| Confidential transfers | Fully supported | Fully supported |
| Helius API | Free tier available | Production tier needed |

**Always deploy to devnet first and run full test suite before mainnet.**

---

## License

MIT

---

## Contributing

1. Fork the repo
2. Create a feature branch
3. Submit a PR with tests

All governance changes to the protocol must go through on-chain voting.

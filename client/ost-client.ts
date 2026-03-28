// =============================================================================
// OST Token Client SDK
// =============================================================================
// TypeScript client for interacting with the OST Token-2022 program.
// Handles confidential transfer setup, minting, payments, and governance.
//
// Usage with Helius Confidential Balances (2026):
//   Helius RPC provides getConfidentialBalance and related methods that
//   decrypt confidential balances using the account owner's ElGamal key.
//   This client integrates with those endpoints.
// =============================================================================

import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, BN } from "@coral-xyz/anchor";
import {
  PublicKey,
  Keypair,
  SystemProgram,
  Transaction,
  SYSVAR_RENT_PUBKEY,
  Connection,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

// =============================================================================
// Program ID — replace after `anchor deploy`
// =============================================================================
const OST_PROGRAM_ID = new PublicKey(
  "J2jiS296YWVie1Sopb4SxcM3aJnP9aAwe6aLDhCqvGXY"
);

// =============================================================================
// PDA Derivation Helpers
// =============================================================================

/** Derive the mint authority PDA */
export function getMintAuthorityPda(programId = OST_PROGRAM_ID) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("mint-authority")],
    programId
  );
}

/** Derive the mint config PDA */
export function getMintConfigPda(programId = OST_PROGRAM_ID) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("mint-config")],
    programId
  );
}

/** Derive a user's stake account PDA */
export function getStakeAccountPda(
  owner: PublicKey,
  programId = OST_PROGRAM_ID
) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("stake"), owner.toBuffer()],
    programId
  );
}

/** Derive a proposal PDA */
export function getProposalPda(
  proposalId: number,
  programId = OST_PROGRAM_ID
) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(BigInt(proposalId));
  return PublicKey.findProgramAddressSync(
    [Buffer.from("proposal"), buf],
    programId
  );
}

/** Derive a vote record PDA */
export function getVoteRecordPda(
  voter: PublicKey,
  proposalId: number,
  programId = OST_PROGRAM_ID
) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(BigInt(proposalId));
  return PublicKey.findProgramAddressSync(
    [Buffer.from("vote"), voter.toBuffer(), buf],
    programId
  );
}

/** Derive a ZK tax report PDA */
export function getTaxReportPda(
  owner: PublicKey,
  taxYear: number,
  programId = OST_PROGRAM_ID
) {
  const buf = Buffer.alloc(2);
  buf.writeUInt16LE(taxYear);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("tax-report"), owner.toBuffer(), buf],
    programId
  );
}

/** Derive vault authority PDA */
export function getVaultAuthorityPda(programId = OST_PROGRAM_ID) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("vault-authority")],
    programId
  );
}

/** Derive DAO treasury config PDA */
export function getDaoTreasuryPda(programId = OST_PROGRAM_ID) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("dao-treasury")],
    programId
  );
}

/** Derive a merchant account PDA */
export function getMerchantPda(
  merchantOwner: PublicKey,
  programId = OST_PROGRAM_ID
) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("merchant"), merchantOwner.toBuffer()],
    programId
  );
}

/** Derive a bearer note PDA from the secret hash */
export function getBearerNotePda(
  secretHash: Uint8Array,
  programId = OST_PROGRAM_ID
) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("bearer-note"), Buffer.from(secretHash)],
    programId
  );
}

/** Derive the bearer vault authority PDA */
export function getBearerVaultPda(programId = OST_PROGRAM_ID) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("bearer-vault")],
    programId
  );
}

/** Derive a faucet claim PDA */
export function getFaucetClaimPda(
  claimer: PublicKey,
  programId = OST_PROGRAM_ID
) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("faucet-claim"), claimer.toBuffer()],
    programId
  );
}

/** Derive the treasury authority PDA */
export function getTreasuryAuthorityPda(programId = OST_PROGRAM_ID) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("treasury-authority")],
    programId
  );
}

/** Derive a seedless account PDA */
export function getSeedlessAccountPda(
  user: PublicKey,
  programId = OST_PROGRAM_ID
) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("seedless"), user.toBuffer()],
    programId
  );
}

/** Derive an AI reward stake PDA */
export function getAiRewardStakePda(
  user: PublicKey,
  programId = OST_PROGRAM_ID
) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("ai-reward"), user.toBuffer()],
    programId
  );
}

// =============================================================================
// OST Client Class
// =============================================================================

export class OstClient {
  program: Program;
  provider: AnchorProvider;
  mint: PublicKey | null = null;

  constructor(provider: AnchorProvider, programId = OST_PROGRAM_ID) {
    this.provider = provider;
    // The IDL is generated by `anchor build` and loaded at runtime
    this.program = new Program(require("../target/idl/ost_token.json"), provider);
  }

  // -------------------------------------------------------------------------
  // 1. Initialize Mint
  // -------------------------------------------------------------------------
  /**
   * Creates the OST mint with Token-2022 ConfidentialTransferMint extension.
   * Fair launch: zero tokens are pre-mined.
   *
   * @returns The mint public key
   */
  async initializeMint(): Promise<PublicKey> {
    const mintKeypair = Keypair.generate();
    const [mintAuthority] = getMintAuthorityPda();
    const [mintConfig] = getMintConfigPda();

    await this.program.methods
      .initializeMint()
      .accounts({
        admin: this.provider.wallet.publicKey,
        mint: mintKeypair.publicKey,
        mintAuthority,
        mintConfig,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .signers([mintKeypair])
      .rpc();

    this.mint = mintKeypair.publicKey;
    console.log(`✅ OST Mint created: ${this.mint.toBase58()}`);
    return this.mint;
  }

  // -------------------------------------------------------------------------
  // 2. Create Token Account (ATA) for a user
  // -------------------------------------------------------------------------
  /**
   * Creates an Associated Token Account for Token-2022.
   * Must be done before configuring confidential transfers.
   */
  async createTokenAccount(owner: PublicKey): Promise<PublicKey> {
    if (!this.mint) throw new Error("Mint not initialized");

    const ata = getAssociatedTokenAddressSync(
      this.mint,
      owner,
      false,
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    const tx = new Transaction().add(
      createAssociatedTokenAccountInstruction(
        this.provider.wallet.publicKey,
        ata,
        owner,
        this.mint,
        TOKEN_2022_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
    );

    await this.provider.sendAndConfirm(tx);
    console.log(`✅ Token account created: ${ata.toBase58()}`);
    return ata;
  }

  // -------------------------------------------------------------------------
  // 3. Configure Confidential Account
  // -------------------------------------------------------------------------
  /**
   * Enables confidential transfers on a user's token account.
   * The user must generate an ElGamal keypair client-side.
   *
   * @param tokenAccount - The user's ATA
   * @param elgamalPubkey - 32-byte ElGamal public key
   * @param decryptableZeroBalance - 36-byte AES-encrypted zero balance
   */
  async configureConfidentialAccount(
    tokenAccount: PublicKey,
    elgamalPubkey: Uint8Array,
    decryptableZeroBalance: Uint8Array
  ): Promise<string> {
    if (!this.mint) throw new Error("Mint not initialized");

    const proofContext = new Uint8Array(32); // placeholder context
    const proofData = Buffer.alloc(0); // proof handled by Token-2022

    const tx = await this.program.methods
      .configureConfidentialAccount(
        Array.from(elgamalPubkey),
        Array.from(decryptableZeroBalance),
        Array.from(proofContext),
        proofData
      )
      .accounts({
        owner: this.provider.wallet.publicKey,
        tokenAccount,
        mint: this.mint,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc();

    console.log(`✅ Confidential account configured: ${tx}`);
    return tx;
  }

  // -------------------------------------------------------------------------
  // 4. Confidential Mint (Fair Distribution)
  // -------------------------------------------------------------------------
  /**
   * Mints OST tokens to a destination account. Only admin can call.
   * Tokens go to public balance first, then must be deposited to confidential.
   *
   * @param destination - Recipient's token account
   * @param amount - Raw token amount (with 9 decimal places)
   */
  async confidentialMint(
    destination: PublicKey,
    amount: number
  ): Promise<string> {
    if (!this.mint) throw new Error("Mint not initialized");

    const [mintAuthority] = getMintAuthorityPda();
    const [mintConfig] = getMintConfigPda();

    const tx = await this.program.methods
      .confidentialMint(new BN(amount), Buffer.alloc(0))
      .accounts({
        admin: this.provider.wallet.publicKey,
        mint: this.mint,
        mintAuthority,
        mintConfig,
        destination,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc();

    console.log(`✅ Minted ${amount} OST to ${destination.toBase58()}: ${tx}`);
    return tx;
  }

  // -------------------------------------------------------------------------
  // 5. Confidential Transfer (P2P Payment)
  // -------------------------------------------------------------------------
  /**
   * Sends OST tokens confidentially from sender to receiver.
   * Amounts and balances are encrypted on-chain.
   *
   * @param senderTokenAccount - Sender's configured token account
   * @param receiverTokenAccount - Receiver's configured token account
   * @param proofData - ZK proof data (range + ciphertext validity)
   * @param newDecryptableBalance - Sender's new encrypted balance after send
   */
  async confidentialTransfer(
    senderTokenAccount: PublicKey,
    receiverTokenAccount: PublicKey,
    proofData: Buffer,
    newDecryptableBalance: Uint8Array
  ): Promise<string> {
    if (!this.mint) throw new Error("Mint not initialized");

    const tx = await this.program.methods
      .confidentialTransfer(proofData, Array.from(newDecryptableBalance))
      .accounts({
        sender: this.provider.wallet.publicKey,
        senderTokenAccount,
        receiverTokenAccount,
        mint: this.mint,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc();

    console.log(`✅ Confidential transfer: ${tx}`);
    return tx;
  }

  // -------------------------------------------------------------------------
  // 6. Stake for Governance
  // -------------------------------------------------------------------------
  /**
   * Stakes OST tokens for governance voting power.
   * Tokens are locked for 7 days by default.
   *
   * @param amount - Raw amount to stake
   * @param stakingVault - Program-owned vault token account
   */
  async stake(amount: number, stakingVault: PublicKey): Promise<string> {
    if (!this.mint) throw new Error("Mint not initialized");

    const owner = this.provider.wallet.publicKey;
    const ownerAta = getAssociatedTokenAddressSync(
      this.mint,
      owner,
      false,
      TOKEN_2022_PROGRAM_ID
    );
    const [stakeAccount] = getStakeAccountPda(owner);

    const tx = await this.program.methods
      .stake(new BN(amount))
      .accounts({
        owner,
        ownerTokenAccount: ownerAta,
        stakingVault,
        mint: this.mint,
        stakeAccount,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log(`✅ Staked ${amount} OST: ${tx}`);
    return tx;
  }

  // -------------------------------------------------------------------------
  // 7. Unstake
  // -------------------------------------------------------------------------
  /**
   * Returns staked tokens after the lock period (7 days default).
   */
  async unstake(stakingVault: PublicKey): Promise<string> {
    if (!this.mint) throw new Error("Mint not initialized");

    const owner = this.provider.wallet.publicKey;
    const ownerAta = getAssociatedTokenAddressSync(
      this.mint,
      owner,
      false,
      TOKEN_2022_PROGRAM_ID
    );
    const [stakeAccount] = getStakeAccountPda(owner);
    const [vaultAuthority] = getVaultAuthorityPda();
    const [mintConfig] = getMintConfigPda();

    const tx = await this.program.methods
      .unstake()
      .accounts({
        owner,
        ownerTokenAccount: ownerAta,
        stakingVault,
        vaultAuthority,
        mint: this.mint,
        stakeAccount,
        mintConfig,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc();

    console.log(`✅ Unstaked: ${tx}`);
    return tx;
  }

  // -------------------------------------------------------------------------
  // 8. Create Governance Proposal
  // -------------------------------------------------------------------------
  /**
   * Creates a new proposal for stakers to vote on.
   * Examples: "Enable quantum-resistant encryption", "Add ZK tax tools"
   *
   * @param proposalId - Unique proposal number
   * @param description - Short description (max 256 chars)
   */
  async createProposal(
    proposalId: number,
    description: string
  ): Promise<string> {
    const [mintConfig] = getMintConfigPda();
    const [proposal] = getProposalPda(proposalId);

    const tx = await this.program.methods
      .createProposal(new BN(proposalId), description)
      .accounts({
        admin: this.provider.wallet.publicKey,
        mintConfig,
        proposal,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log(`✅ Proposal #${proposalId} created: ${tx}`);
    return tx;
  }

  // -------------------------------------------------------------------------
  // 9. Cast Vote
  // -------------------------------------------------------------------------
  /**
   * Votes on a governance proposal. Weight = staked OST amount.
   *
   * @param proposalId - Which proposal to vote on
   * @param approve - true = FOR, false = AGAINST
   */
  async castVote(proposalId: number, approve: boolean): Promise<string> {
    const voter = this.provider.wallet.publicKey;
    const [stakeAccount] = getStakeAccountPda(voter);
    const [proposal] = getProposalPda(proposalId);
    const [voteRecord] = getVoteRecordPda(voter, proposalId);

    const tx = await this.program.methods
      .castVote(new BN(proposalId), approve)
      .accounts({
        voter,
        stakeAccount,
        owner: voter,
        proposal,
        voteRecord,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log(
      `✅ Voted ${approve ? "FOR" : "AGAINST"} proposal #${proposalId}: ${tx}`
    );
    return tx;
  }

  // -------------------------------------------------------------------------
  // 10. Submit ZK Tax Report
  // -------------------------------------------------------------------------
  /**
   * Submits a zero-knowledge proof of tax compliance.
   * The proof is generated off-chain; only the hash is stored on-chain.
   *
   * @param taxYear - e.g. 2026
   * @param totalTransactions - Number of transactions covered
   * @param proofHash - SHA-256 hash of the ZK proof (32 bytes)
   * @param jurisdictionCode - ISO 3166-1 alpha-2 code, e.g. "US"
   */
  async submitZkTaxReport(
    taxYear: number,
    totalTransactions: number,
    proofHash: Uint8Array,
    jurisdictionCode: string
  ): Promise<string> {
    const owner = this.provider.wallet.publicKey;
    const [taxReport] = getTaxReportPda(owner, taxYear);

    const jurisdictionBytes = [
      jurisdictionCode.charCodeAt(0),
      jurisdictionCode.charCodeAt(1),
    ];

    const tx = await this.program.methods
      .submitZkTaxReport(
        taxYear,
        totalTransactions,
        Array.from(proofHash),
        jurisdictionBytes
      )
      .accounts({
        owner,
        taxReport,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log(`✅ ZK Tax Report submitted for ${taxYear}: ${tx}`);
    return tx;
  }

  // -------------------------------------------------------------------------
  // 11. Apply Pending Balance
  // -------------------------------------------------------------------------
  /**
   * Moves tokens from pending → available confidential balance.
   * Must be called after receiving a confidential transfer.
   */
  async applyPendingBalance(
    tokenAccount: PublicKey,
    newDecryptableBalance: Uint8Array
  ): Promise<string> {
    const tx = await this.program.methods
      .applyPendingBalance(Array.from(newDecryptableBalance))
      .accounts({
        owner: this.provider.wallet.publicKey,
        tokenAccount,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc();

    console.log(`✅ Pending balance applied: ${tx}`);
    return tx;
  }

  // -------------------------------------------------------------------------
  // Helius Confidential Balance Helper (2026 API)
  // -------------------------------------------------------------------------
  /**
   * Fetches the decrypted confidential balance using Helius RPC.
   * Requires a Helius API key with confidential balance access.
   *
   * @param connection - Solana connection (Helius RPC endpoint)
   * @param tokenAccount - The token account to query
   * @returns The decrypted available and pending balances
   */
  async getConfidentialBalance(
    connection: Connection,
    tokenAccount: PublicKey
  ): Promise<{ available: bigint; pending: bigint }> {
    // Helius provides getConfidentialBalance as an enhanced RPC method.
    // This requires the user's ElGamal secret key for decryption,
    // which is done client-side in the Helius SDK.
    //
    // Example using Helius 2026 Confidential Balances API:
    //   const helius = new HeliusClient(apiKey);
    //   const balance = await helius.getConfidentialBalance(tokenAccount, elgamalSecretKey);
    //
    // For direct RPC usage:
    const accountInfo = await connection.getAccountInfo(tokenAccount);
    if (!accountInfo) {
      throw new Error("Token account not found");
    }

    // In production, parse the Token-2022 account data to extract
    // the ConfidentialTransferAccount extension and decrypt with
    // the user's ElGamal key. This is a simplified placeholder.
    console.log(
      "⚠️  Use Helius SDK for actual confidential balance decryption"
    );

    return { available: 0n, pending: 0n };
  }

  // -------------------------------------------------------------------------
  // 12. Deposit (Public → Confidential)
  // -------------------------------------------------------------------------
  /**
   * Moves tokens from public balance into confidential pending balance.
   * After minting, tokens start in public — this makes them private.
   * Call applyPendingBalance() afterwards to make them spendable.
   *
   * @param tokenAccount - User's token account
   * @param amount - Raw amount to deposit
   */
  async deposit(tokenAccount: PublicKey, amount: number): Promise<string> {
    if (!this.mint) throw new Error("Mint not initialized");

    const tx = await this.program.methods
      .deposit(new BN(amount), Buffer.alloc(0))
      .accounts({
        owner: this.provider.wallet.publicKey,
        tokenAccount,
        mint: this.mint,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc();

    console.log(`✅ Deposited ${amount} to confidential: ${tx}`);
    return tx;
  }

  // -------------------------------------------------------------------------
  // 13. Withdraw (Confidential → Public)
  // -------------------------------------------------------------------------
  /**
   * Moves tokens from confidential available balance back to public.
   * Needed before staking, DEX trades, or non-CT protocol interactions.
   *
   * @param tokenAccount - User's token account
   * @param amount - Raw amount to withdraw
   * @param newDecryptableBalance - Updated encrypted balance after withdrawal
   * @param proofData - ZK proof of sufficient confidential funds
   */
  async withdraw(
    tokenAccount: PublicKey,
    amount: number,
    newDecryptableBalance: Uint8Array,
    proofData: Buffer
  ): Promise<string> {
    if (!this.mint) throw new Error("Mint not initialized");

    const tx = await this.program.methods
      .withdraw(
        new BN(amount),
        Array.from(newDecryptableBalance),
        proofData
      )
      .accounts({
        owner: this.provider.wallet.publicKey,
        tokenAccount,
        mint: this.mint,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc();

    console.log(`✅ Withdrew ${amount} to public: ${tx}`);
    return tx;
  }

  // -------------------------------------------------------------------------
  // 14. Initialize DAO Treasury
  // -------------------------------------------------------------------------
  /**
   * Sets up the Space DAO fee collector (0.1% default).
   * Admin only. Must be called once before transfer_with_fee works.
   *
   * @param treasuryTokenAccount - Token account that receives fees
   */
  async initializeTreasury(treasuryTokenAccount: PublicKey): Promise<string> {
    const [mintConfig] = getMintConfigPda();
    const [daoTreasury] = getDaoTreasuryPda();

    const tx = await this.program.methods
      .initializeTreasury()
      .accounts({
        admin: this.provider.wallet.publicKey,
        mintConfig,
        daoTreasury,
        treasuryTokenAccount,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log(`✅ DAO Treasury initialized: ${tx}`);
    return tx;
  }

  // -------------------------------------------------------------------------
  // 15. Transfer With Fee (P2P + 0.1% DAO)
  // -------------------------------------------------------------------------
  /**
   * Public-balance transfer with automatic 0.1% DAO treasury fee.
   * Use for transparent payments. For private transfers, use confidentialTransfer.
   *
   * @param receiverTokenAccount - Recipient's token account
   * @param amount - Total amount (fee is deducted from this)
   */
  async transferWithFee(
    receiverTokenAccount: PublicKey,
    amount: number
  ): Promise<string> {
    if (!this.mint) throw new Error("Mint not initialized");

    const owner = this.provider.wallet.publicKey;
    const ownerAta = getAssociatedTokenAddressSync(
      this.mint,
      owner,
      false,
      TOKEN_2022_PROGRAM_ID
    );
    const [daoTreasury] = getDaoTreasuryPda();

    // Fetch treasury config to get the destination account
    const treasuryData = await this.program.account.daoTreasury.fetch(
      daoTreasury
    );

    const tx = await this.program.methods
      .transferWithFee(new BN(amount))
      .accounts({
        sender: owner,
        senderTokenAccount: ownerAta,
        receiverTokenAccount,
        treasuryTokenAccount: treasuryData.treasuryTokenAccount,
        daoTreasury,
        mint: this.mint,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc();

    console.log(`✅ Transfer with fee: ${tx}`);
    return tx;
  }

  // -------------------------------------------------------------------------
  // 16. Register Merchant (Solana Pay)
  // -------------------------------------------------------------------------
  /**
   * Registers a merchant for OST Solana Pay checkout.
   *
   * @param merchantTokenAccount - Merchant's token account for receiving OST
   * @param label - Human-readable store name (max 64 chars)
   */
  async registerMerchant(
    merchantTokenAccount: PublicKey,
    label: string
  ): Promise<string> {
    const merchant = this.provider.wallet.publicKey;
    const [merchantAccount] = getMerchantPda(merchant);

    const tx = await this.program.methods
      .registerMerchant(label)
      .accounts({
        merchant,
        merchantAccount,
        merchantTokenAccount,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log(`✅ Merchant "${label}" registered: ${tx}`);
    return tx;
  }

  // -------------------------------------------------------------------------
  // 17. Merchant Payment (Solana Pay Checkout)
  // -------------------------------------------------------------------------
  /**
   * Pays a registered merchant with auto DAO fee.
   * This is the instruction Solana Pay QR codes resolve to.
   *
   * @param merchantOwner - Merchant's wallet pubkey
   * @param amount - Total payment amount (fee deducted from this)
   * @param memo - Optional order reference / memo
   */
  async merchantPayment(
    merchantOwner: PublicKey,
    amount: number,
    memo?: string
  ): Promise<string> {
    if (!this.mint) throw new Error("Mint not initialized");

    const buyer = this.provider.wallet.publicKey;
    const buyerAta = getAssociatedTokenAddressSync(
      this.mint,
      buyer,
      false,
      TOKEN_2022_PROGRAM_ID
    );
    const [merchantAccount] = getMerchantPda(merchantOwner);
    const [daoTreasury] = getDaoTreasuryPda();

    // Fetch merchant and treasury data
    const merchantData = await this.program.account.merchantAccount.fetch(
      merchantAccount
    );
    const treasuryData = await this.program.account.daoTreasury.fetch(
      daoTreasury
    );

    const tx = await this.program.methods
      .merchantPayment(new BN(amount), memo ?? null)
      .accounts({
        buyer,
        buyerTokenAccount: buyerAta,
        merchantAccount,
        merchantTokenAccount: merchantData.tokenAccount,
        treasuryTokenAccount: treasuryData.treasuryTokenAccount,
        daoTreasury,
        mint: this.mint,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc();

    console.log(`✅ Paid merchant "${merchantData.label}": ${tx}`);
    return tx;
  }

  // -------------------------------------------------------------------------
  // 18. Generate Solana Pay URL
  // -------------------------------------------------------------------------
  /**
   * Generates a Solana Pay URL for a merchant payment.
   * The buyer scans this QR code → wallet builds merchant_payment tx.
   *
   * @param merchantOwner - Merchant's wallet pubkey
   * @param amount - Payment amount in OST (human-readable, e.g. 1.5)
   * @param label - Display label for the payment
   * @param memo - Optional order reference
   * @returns solana: protocol URL string
   */
  generateSolanaPayUrl(
    merchantOwner: PublicKey,
    amount: number,
    label: string,
    memo?: string
  ): string {
    // Solana Pay transfer URL format:
    // solana:<recipient>?amount=<amount>&spl-token=<mint>&label=<label>&memo=<memo>
    if (!this.mint) throw new Error("Mint not initialized");

    const params = new URLSearchParams();
    params.set("amount", amount.toString());
    params.set("spl-token", this.mint.toBase58());
    params.set("label", label);
    if (memo) params.set("memo", memo);

    const url = `solana:${merchantOwner.toBase58()}?${params.toString()}`;
    console.log(`🔗 Solana Pay URL: ${url}`);
    return url;
  }

  // -------------------------------------------------------------------------
  // 19. Offline Confidential Transfer
  // -------------------------------------------------------------------------
  /**
   * Submits a confidential transfer that was prepared and signed offline.
   * The ZK proofs were generated on-device; this just broadcasts the tx.
   *
   * Client-side workflow:
   *   1. Generate ZK proof + sign tx offline (no RPC needed)
   *   2. Share signed tx via QR/NFC/Bluetooth to receiver
   *   3. Either party calls this when internet is available
   *
   * @param senderTokenAccount - Sender's token account
   * @param receiverTokenAccount - Receiver's token account
   * @param proofData - ZK proof data (generated offline)
   * @param newDecryptableBalance - Sender's new encrypted balance
   * @param nonce - Unique offline nonce (prevents replay)
   * @param timestamp - When the tx was prepared offline
   * @param transport - 0=QR, 1=NFC, 2=Bluetooth, 3=Satellite
   */
  async offlineConfidentialTransfer(
    senderTokenAccount: PublicKey,
    receiverTokenAccount: PublicKey,
    proofData: Buffer,
    newDecryptableBalance: Uint8Array,
    nonce: number,
    timestamp: number,
    transport: number = 0
  ): Promise<string> {
    if (!this.mint) throw new Error("Mint not initialized");

    const tx = await this.program.methods
      .offlineConfidentialTransfer(
        proofData,
        Array.from(newDecryptableBalance),
        new BN(nonce),
        new BN(timestamp),
        transport
      )
      .accounts({
        sender: this.provider.wallet.publicKey,
        senderTokenAccount,
        receiverTokenAccount,
        mint: this.mint,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc();

    console.log(`\u2705 Offline confidential transfer settled: ${tx}`);
    return tx;
  }

  // -------------------------------------------------------------------------
  // 20. Mint Bearer Note (Ecash Vault)
  // -------------------------------------------------------------------------
  /**
   * Locks OST into a vault PDA and creates a redeemable bearer note.
   * The secret is generated client-side; only the hash is stored on-chain.
   *
   * @param vaultTokenAccount - PDA-owned vault token account
   * @param secretHash - SHA-256 hash of the bearer secret (32 bytes)
   * @param amount - OST amount to lock
   * @param expiresAt - Unix timestamp for expiry (0 = never)
   * @returns The bearer note PDA address
   */
  async mintBearerNote(
    vaultTokenAccount: PublicKey,
    secretHash: Uint8Array,
    amount: number,
    expiresAt: number = 0
  ): Promise<{ tx: string; notePda: PublicKey }> {
    if (!this.mint) throw new Error("Mint not initialized");

    const minter = this.provider.wallet.publicKey;
    const minterAta = getAssociatedTokenAddressSync(
      this.mint, minter, false, TOKEN_2022_PROGRAM_ID
    );
    const [bearerNote] = getBearerNotePda(secretHash);
    const [vaultAuthority] = getBearerVaultPda();

    const tx = await this.program.methods
      .mintBearerNote(Array.from(secretHash), new BN(amount), new BN(expiresAt))
      .accounts({
        minter,
        minterTokenAccount: minterAta,
        vaultTokenAccount,
        vaultAuthority,
        bearerNote,
        mint: this.mint,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log(`\u2705 Bearer note minted: ${amount} OST locked (${tx})`);
    return { tx, notePda: bearerNote };
  }

  // -------------------------------------------------------------------------
  // 21. Redeem Bearer Note
  // -------------------------------------------------------------------------
  /**
   * Redeems a bearer note by providing the raw secret.
   * OST is released from the vault to the redeemer's token account.
   *
   * @param vaultTokenAccount - Vault holding the locked OST
   * @param secret - The raw 32-byte bearer secret
   */
  async redeemBearerNote(
    vaultTokenAccount: PublicKey,
    secret: Uint8Array
  ): Promise<string> {
    if (!this.mint) throw new Error("Mint not initialized");

    // Hash the secret to derive the note PDA
    const crypto = await import("crypto");
    const secretHash = crypto.createHash("sha256").update(secret).digest();
    const [bearerNote] = getBearerNotePda(new Uint8Array(secretHash));
    const [vaultAuthority] = getBearerVaultPda();

    const redeemer = this.provider.wallet.publicKey;
    const redeemerAta = getAssociatedTokenAddressSync(
      this.mint, redeemer, false, TOKEN_2022_PROGRAM_ID
    );

    const tx = await this.program.methods
      .redeemBearerNote(Array.from(secret))
      .accounts({
        redeemer,
        redeemerTokenAccount: redeemerAta,
        vaultTokenAccount,
        vaultAuthority,
        bearerNote,
        mint: this.mint,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc();

    console.log(`\u2705 Bearer note redeemed: ${tx}`);
    return tx;
  }

  // -------------------------------------------------------------------------
  // 22. Claim Faucet
  // -------------------------------------------------------------------------
  /**
   * Claims a one-time OST faucet drop from the treasury.
   * Each wallet can only claim once (PDA prevents double claims).
   *
   * @param treasuryTokenAccount - Treasury's token account (source of funds)
   */
  async claimFaucet(treasuryTokenAccount: PublicKey): Promise<string> {
    if (!this.mint) throw new Error("Mint not initialized");

    const claimer = this.provider.wallet.publicKey;
    const claimerAta = getAssociatedTokenAddressSync(
      this.mint, claimer, false, TOKEN_2022_PROGRAM_ID
    );
    const [daoTreasury] = getDaoTreasuryPda();
    const [treasuryAuthority] = getTreasuryAuthorityPda();
    const [faucetClaim] = getFaucetClaimPda(claimer);

    const tx = await this.program.methods
      .claimFaucet()
      .accounts({
        claimer,
        claimerTokenAccount: claimerAta,
        treasuryTokenAccount,
        daoTreasury,
        treasuryAuthority,
        faucetClaim,
        mint: this.mint,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log(`\u2705 Faucet claimed (1 OST): ${tx}`);
    return tx;
  }

  // -------------------------------------------------------------------------
  // 23. Seedless Onboard
  // -------------------------------------------------------------------------
  /**
   * Records seedless wallet creation for analytics.
   * Call after Web3Auth/passkey login on the client.
   *
   * @param authMethod - 0=Web3Auth, 1=Passkey, 2=Email-link, 3=Other
   */
  async seedlessOnboard(authMethod: number = 0): Promise<string> {
    const user = this.provider.wallet.publicKey;
    const [seedlessAccount] = getSeedlessAccountPda(user);

    const tx = await this.program.methods
      .seedlessOnboard(authMethod)
      .accounts({
        user,
        seedlessAccount,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log(`\u2705 Seedless onboarding recorded: ${tx}`);
    return tx;
  }

  // -------------------------------------------------------------------------
  // 24. AI Reward Stake (DePIN)
  // -------------------------------------------------------------------------
  /**
   * Registers device resources for DePIN earning.
   * The wallet's AI agent auto-stakes into the best provider.
   *
   * @param provider - 0=Grass, 1=Render, 2=Helium, 3=Dawn, 4=Spacecoin, 5=Other
   * @param resourceType - 0=Bandwidth, 1=GPU, 2=CPU, 3=Storage, 4=LoRa/5G, 5=Satellite
   */
  async aiRewardStake(
    provider: number,
    resourceType: number
  ): Promise<string> {
    const user = this.provider.wallet.publicKey;
    const [rewardStake] = getAiRewardStakePda(user);

    const tx = await this.program.methods
      .aiRewardStake(provider, resourceType)
      .accounts({
        user,
        rewardStake,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log(`\u2705 AI reward stake registered: ${tx}`);
    return tx;
  }

  // -------------------------------------------------------------------------
  // Offline Payment Helpers (client-side preparation)
  // -------------------------------------------------------------------------

  /**
   * Generates a bearer note secret and its hash.
   * The secret is the "digital banknote" — share it to transfer value.
   *
   * @returns { secret, secretHash } - 32-byte values
   */
  static async generateBearerSecret(): Promise<{
    secret: Uint8Array;
    secretHash: Uint8Array;
  }> {
    const crypto = await import("crypto");
    const secret = crypto.randomBytes(32);
    const secretHash = crypto.createHash("sha256").update(secret).digest();
    return {
      secret: new Uint8Array(secret),
      secretHash: new Uint8Array(secretHash),
    };
  }

  /**
   * Encodes a bearer secret as a compact QR-friendly payload.
   * The receiver scans this to get the secret for later on-chain redemption.
   */
  static bearerNoteToQrPayload(secret: Uint8Array, amount: number): string {
    // Format: ost://bearer?s=<base64-secret>&a=<amount>
    const b64 = Buffer.from(secret).toString("base64url");
    return `ost://bearer?s=${b64}&a=${amount}`;
  }

  /**
   * Decodes a QR payload back into a bearer secret and amount.
   */
  static qrPayloadToBearerNote(payload: string): {
    secret: Uint8Array;
    amount: number;
  } {
    const url = new URL(payload);
    const s = url.searchParams.get("s");
    const a = url.searchParams.get("a");
    if (!s || !a) throw new Error("Invalid bearer note QR payload");
    return {
      secret: new Uint8Array(Buffer.from(s, "base64url")),
      amount: parseFloat(a),
    };
  }
}

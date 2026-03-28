// =============================================================================
// OST Token — Integration Tests
// =============================================================================
// Tests the full lifecycle:
//   1. Initialize mint with confidential transfers
//   2. Create token accounts + configure confidential
//   3. Mint tokens (fair launch distribution)
//   4. Confidential P2P transfer
//   5. Stake → Vote → Unstake governance cycle
//   6. ZK tax report submission
//
// Run: `anchor test` (local validator) or `anchor test --provider.cluster devnet`
// =============================================================================

import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, BN } from "@coral-xyz/anchor";
import { expect } from "chai";
import {
  PublicKey,
  Keypair,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

import {
  getMintAuthorityPda,
  getMintConfigPda,
  getStakeAccountPda,
  getProposalPda,
  getVoteRecordPda,
  getTaxReportPda,
  getVaultAuthorityPda,
  getDaoTreasuryPda,
  getMerchantPda,
} from "../client/ost-client";

describe("OST Token (Out-of-Space Token)", () => {
  // -- Provider & Program --
  const provider = AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.OstToken as Program;

  // -- Keypairs --
  const admin = provider.wallet;
  const mintKeypair = Keypair.generate();
  const userA = Keypair.generate();
  const userB = Keypair.generate();

  // -- PDAs --
  let mintAuthority: PublicKey;
  let mintConfig: PublicKey;

  // -- Token accounts --
  let adminAta: PublicKey;
  let userAAta: PublicKey;
  let userBAta: PublicKey;
  let stakingVault: PublicKey;

  before(async () => {
    // Derive PDAs
    [mintAuthority] = getMintAuthorityPda(program.programId);
    [mintConfig] = getMintConfigPda(program.programId);

    // Airdrop SOL to test users
    const airdropA = await provider.connection.requestAirdrop(
      userA.publicKey,
      2 * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(airdropA);

    const airdropB = await provider.connection.requestAirdrop(
      userB.publicKey,
      2 * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(airdropB);
  });

  // =========================================================================
  // TEST 1: Initialize Mint
  // =========================================================================
  it("initializes the OST mint with confidential transfers enabled", async () => {
    await program.methods
      .initializeMint()
      .accounts({
        admin: admin.publicKey,
        mint: mintKeypair.publicKey,
        mintAuthority,
        mintConfig,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .signers([mintKeypair])
      .rpc();

    // Verify config
    const config = await program.account.mintConfig.fetch(mintConfig);
    expect(config.confidentialTransfersEnabled).to.be.true;
    expect(config.totalMinted.toNumber()).to.equal(0); // Fair launch: no pre-mine
    expect(config.admin.toBase58()).to.equal(admin.publicKey.toBase58());

    console.log(`  Mint: ${mintKeypair.publicKey.toBase58()}`);
    console.log(`  Authority: ${mintAuthority.toBase58()}`);
  });

  // =========================================================================
  // TEST 2: Create Token Accounts
  // =========================================================================
  it("creates associated token accounts for users", async () => {
    // Admin ATA
    adminAta = getAssociatedTokenAddressSync(
      mintKeypair.publicKey,
      admin.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    const tx1 = new anchor.web3.Transaction().add(
      createAssociatedTokenAccountInstruction(
        admin.publicKey,
        adminAta,
        admin.publicKey,
        mintKeypair.publicKey,
        TOKEN_2022_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
    );
    await provider.sendAndConfirm(tx1);

    // User A ATA
    userAAta = getAssociatedTokenAddressSync(
      mintKeypair.publicKey,
      userA.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    const tx2 = new anchor.web3.Transaction().add(
      createAssociatedTokenAccountInstruction(
        admin.publicKey,
        userAAta,
        userA.publicKey,
        mintKeypair.publicKey,
        TOKEN_2022_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
    );
    await provider.sendAndConfirm(tx2);

    // User B ATA
    userBAta = getAssociatedTokenAddressSync(
      mintKeypair.publicKey,
      userB.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    const tx3 = new anchor.web3.Transaction().add(
      createAssociatedTokenAccountInstruction(
        admin.publicKey,
        userBAta,
        userB.publicKey,
        mintKeypair.publicKey,
        TOKEN_2022_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
    );
    await provider.sendAndConfirm(tx3);

    console.log(`  Admin ATA: ${adminAta.toBase58()}`);
    console.log(`  User A ATA: ${userAAta.toBase58()}`);
    console.log(`  User B ATA: ${userBAta.toBase58()}`);
  });

  // =========================================================================
  // TEST 3: Confidential Mint (Fair Distribution)
  // =========================================================================
  it("mints tokens to admin via fair distribution (no pre-mine)", async () => {
    const amount = 1_000_000_000; // 1 OST (9 decimals)

    await program.methods
      .confidentialMint(new BN(amount), Buffer.alloc(0))
      .accounts({
        admin: admin.publicKey,
        mint: mintKeypair.publicKey,
        mintAuthority,
        mintConfig,
        destination: adminAta,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc();

    // Verify total minted updated
    const config = await program.account.mintConfig.fetch(mintConfig);
    expect(config.totalMinted.toNumber()).to.equal(amount);

    console.log(`  Minted: ${amount / 1e9} OST`);
  });

  // =========================================================================
  // TEST 4: Mint to User A
  // =========================================================================
  it("mints tokens to user A for testing", async () => {
    const amount = 500_000_000; // 0.5 OST

    await program.methods
      .confidentialMint(new BN(amount), Buffer.alloc(0))
      .accounts({
        admin: admin.publicKey,
        mint: mintKeypair.publicKey,
        mintAuthority,
        mintConfig,
        destination: userAAta,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc();

    const config = await program.account.mintConfig.fetch(mintConfig);
    expect(config.totalMinted.toNumber()).to.equal(1_500_000_000);
  });

  // =========================================================================
  // TEST 5: Create Governance Proposal
  // =========================================================================
  it("creates a governance proposal for quantum resistance", async () => {
    const proposalId = 1;
    const [proposal] = getProposalPda(proposalId, program.programId);

    await program.methods
      .createProposal(
        new BN(proposalId),
        "Upgrade encryption to quantum-resistant lattice-based scheme"
      )
      .accounts({
        admin: admin.publicKey,
        mintConfig,
        proposal,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const proposalData = await program.account.proposal.fetch(proposal);
    expect(proposalData.proposalId.toNumber()).to.equal(1);
    expect(proposalData.description).to.include("quantum-resistant");
    expect(proposalData.votesFor.toNumber()).to.equal(0);
    expect(proposalData.votesAgainst.toNumber()).to.equal(0);

    console.log(`  Proposal #1: ${proposalData.description}`);
  });

  // =========================================================================
  // TEST 6: Stake for Governance
  // =========================================================================
  it("stakes tokens for governance voting", async () => {
    // We need a staking vault — create one owned by the vault authority PDA
    const [vaultAuthority] = getVaultAuthorityPda(program.programId);

    stakingVault = getAssociatedTokenAddressSync(
      mintKeypair.publicKey,
      vaultAuthority,
      true, // allowOwnerOffCurve for PDA
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    // Create vault ATA
    const txVault = new anchor.web3.Transaction().add(
      createAssociatedTokenAccountInstruction(
        admin.publicKey,
        stakingVault,
        vaultAuthority,
        mintKeypair.publicKey,
        TOKEN_2022_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
    );
    await provider.sendAndConfirm(txVault);

    // Stake 100M raw = 0.1 OST
    const stakeAmount = 100_000_000;
    const [stakeAccount] = getStakeAccountPda(
      admin.publicKey,
      program.programId
    );

    await program.methods
      .stake(new BN(stakeAmount))
      .accounts({
        owner: admin.publicKey,
        ownerTokenAccount: adminAta,
        stakingVault,
        mint: mintKeypair.publicKey,
        stakeAccount,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const stake = await program.account.stakeAccount.fetch(stakeAccount);
    expect(stake.amount.toNumber()).to.equal(stakeAmount);
    expect(stake.owner.toBase58()).to.equal(admin.publicKey.toBase58());

    console.log(`  Staked: ${stakeAmount / 1e9} OST`);
  });

  // =========================================================================
  // TEST 7: Cast Vote
  // =========================================================================
  it("casts a governance vote (FOR quantum resistance)", async () => {
    const proposalId = 1;
    const [stakeAccount] = getStakeAccountPda(
      admin.publicKey,
      program.programId
    );
    const [proposal] = getProposalPda(proposalId, program.programId);
    const [voteRecord] = getVoteRecordPda(
      admin.publicKey,
      proposalId,
      program.programId
    );

    await program.methods
      .castVote(new BN(proposalId), true) // Vote FOR
      .accounts({
        voter: admin.publicKey,
        stakeAccount,
        owner: admin.publicKey,
        proposal,
        voteRecord,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const proposalData = await program.account.proposal.fetch(proposal);
    expect(proposalData.votesFor.toNumber()).to.equal(100_000_000);

    const record = await program.account.voteRecord.fetch(voteRecord);
    expect(record.approve).to.be.true;
    expect(record.weight.toNumber()).to.equal(100_000_000);

    console.log(`  Voted FOR with weight: ${proposalData.votesFor.toNumber()}`);
  });

  // =========================================================================
  // TEST 8: ZK Tax Report
  // =========================================================================
  it("submits a ZK tax report for 2026", async () => {
    const taxYear = 2026;
    const totalTransactions = 42;
    // Simulated proof hash (in production, this comes from a ZK circuit)
    const proofHash = new Uint8Array(32);
    proofHash[0] = 0xde;
    proofHash[1] = 0xad;
    proofHash[2] = 0xbe;
    proofHash[3] = 0xef;

    const [taxReport] = getTaxReportPda(
      admin.publicKey,
      taxYear,
      program.programId
    );

    await program.methods
      .submitZkTaxReport(
        taxYear,
        totalTransactions,
        Array.from(proofHash),
        [0x55, 0x53] // "US"
      )
      .accounts({
        owner: admin.publicKey,
        taxReport,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const report = await program.account.zkTaxReport.fetch(taxReport);
    expect(report.taxYear).to.equal(2026);
    expect(report.totalTransactions).to.equal(42);
    expect(report.jurisdictionCode[0]).to.equal(0x55); // 'U'
    expect(report.jurisdictionCode[1]).to.equal(0x53); // 'S'

    console.log(`  Tax report filed: year=${report.taxYear}, txns=${report.totalTransactions}`);
  });

  // =========================================================================
  // TEST 9: Prevent double voting
  // =========================================================================
  it("prevents double voting on the same proposal", async () => {
    const proposalId = 1;
    const [stakeAccount] = getStakeAccountPda(
      admin.publicKey,
      program.programId
    );
    const [proposal] = getProposalPda(proposalId, program.programId);
    const [voteRecord] = getVoteRecordPda(
      admin.publicKey,
      proposalId,
      program.programId
    );

    try {
      await program.methods
        .castVote(new BN(proposalId), false)
        .accounts({
          voter: admin.publicKey,
          stakeAccount,
          owner: admin.publicKey,
          proposal,
          voteRecord,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      expect.fail("Should have thrown — already voted");
    } catch (err: any) {
      // VoteRecord PDA already exists, so init will fail
      expect(err.toString()).to.include("already in use");
    }
  });

  // =========================================================================
  // TEST 10: Reject zero-amount mint
  // =========================================================================
  it("rejects minting zero tokens", async () => {
    try {
      await program.methods
        .confidentialMint(new BN(0), Buffer.alloc(0))
        .accounts({
          admin: admin.publicKey,
          mint: mintKeypair.publicKey,
          mintAuthority,
          mintConfig,
          destination: adminAta,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .rpc();

      expect.fail("Should have thrown for zero amount");
    } catch (err: any) {
      expect(err.toString()).to.include("ZeroAmount");
    }
  });

  // =========================================================================
  // TEST 11: Reject invalid tax year
  // =========================================================================
  it("rejects tax report with invalid year", async () => {
    const proofHash = new Uint8Array(32);
    proofHash[0] = 1;
    const [taxReport] = getTaxReportPda(
      admin.publicKey,
      2019,
      program.programId
    );

    try {
      await program.methods
        .submitZkTaxReport(2019, 10, Array.from(proofHash), [0x55, 0x53])
        .accounts({
          owner: admin.publicKey,
          taxReport,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      expect.fail("Should have thrown for invalid year");
    } catch (err: any) {
      expect(err.toString()).to.include("InvalidTaxYear");
    }
  });

  // =========================================================================
  // TEST 12: Create second proposal (ZK Tax Tools)
  // =========================================================================
  it("creates a second proposal for ZK tax report tools", async () => {
    const proposalId = 2;
    const [proposal] = getProposalPda(proposalId, program.programId);

    await program.methods
      .createProposal(
        new BN(proposalId),
        "Enable built-in ZK tax report generation for all jurisdictions"
      )
      .accounts({
        admin: admin.publicKey,
        mintConfig,
        proposal,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const proposalData = await program.account.proposal.fetch(proposal);
    expect(proposalData.description).to.include("ZK tax report");
  });

  // =========================================================================
  // TEST 13: Initialize DAO Treasury
  // =========================================================================
  it("initializes the DAO treasury (0.1% fee)", async () => {
    // Create a treasury token account (ATA for admin as placeholder)
    const treasuryOwner = Keypair.generate();
    const airdropTx = await provider.connection.requestAirdrop(
      treasuryOwner.publicKey,
      1 * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(airdropTx);

    const treasuryAta = getAssociatedTokenAddressSync(
      mintKeypair.publicKey,
      treasuryOwner.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    const txCreateAta = new anchor.web3.Transaction().add(
      createAssociatedTokenAccountInstruction(
        admin.publicKey,
        treasuryAta,
        treasuryOwner.publicKey,
        mintKeypair.publicKey,
        TOKEN_2022_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
    );
    await provider.sendAndConfirm(txCreateAta);

    const [daoTreasury] = getDaoTreasuryPda(program.programId);

    await program.methods
      .initializeTreasury()
      .accounts({
        admin: admin.publicKey,
        mintConfig,
        daoTreasury,
        treasuryTokenAccount: treasuryAta,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const treasury = await program.account.daoTreasury.fetch(daoTreasury);
    expect(treasury.feeBasisPoints).to.equal(10); // 0.1%
    expect(treasury.totalFeesCollected.toNumber()).to.equal(0);
    expect(treasury.treasuryTokenAccount.toBase58()).to.equal(treasuryAta.toBase58());

    console.log(`  Treasury: ${treasuryAta.toBase58()}, fee=10bps`);
  });

  // =========================================================================
  // TEST 14: Transfer With Fee
  // =========================================================================
  it("transfers tokens with 0.1% DAO fee", async () => {
    const amount = 100_000_000; // 0.1 OST
    const expectedFee = 10_000; // 0.1% of 0.1 OST
    const expectedNet = amount - expectedFee;

    const [daoTreasury] = getDaoTreasuryPda(program.programId);
    const treasury = await program.account.daoTreasury.fetch(daoTreasury);

    await program.methods
      .transferWithFee(new BN(amount))
      .accounts({
        sender: admin.publicKey,
        senderTokenAccount: adminAta,
        receiverTokenAccount: userAAta,
        treasuryTokenAccount: treasury.treasuryTokenAccount,
        daoTreasury,
        mint: mintKeypair.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc();

    const treasuryAfter = await program.account.daoTreasury.fetch(daoTreasury);
    expect(treasuryAfter.totalFeesCollected.toNumber()).to.equal(expectedFee);

    console.log(`  Transferred ${expectedNet} net, ${expectedFee} fee to DAO`);
  });

  // =========================================================================
  // TEST 15: Register Merchant
  // =========================================================================
  it("registers a merchant for Solana Pay", async () => {
    const [merchantAccount] = getMerchantPda(
      userB.publicKey,
      program.programId
    );

    await program.methods
      .registerMerchant("SpaceShop NYC")
      .accounts({
        merchant: userB.publicKey,
        merchantAccount,
        merchantTokenAccount: userBAta,
        systemProgram: SystemProgram.programId,
      })
      .signers([userB])
      .rpc();

    const merchant = await program.account.merchantAccount.fetch(merchantAccount);
    expect(merchant.label).to.equal("SpaceShop NYC");
    expect(merchant.active).to.be.true;
    expect(merchant.totalReceived.toNumber()).to.equal(0);

    console.log(`  Merchant: "${merchant.label}" (${userB.publicKey.toBase58()})`);
  });

  // =========================================================================
  // TEST 16: Merchant Payment (Solana Pay)
  // =========================================================================
  it("processes a merchant payment with DAO fee", async () => {
    // First mint some tokens to userA so they can pay
    await program.methods
      .confidentialMint(new BN(1_000_000_000), Buffer.alloc(0))
      .accounts({
        admin: admin.publicKey,
        mint: mintKeypair.publicKey,
        mintAuthority,
        mintConfig,
        destination: userAAta,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc();

    const paymentAmount = 50_000_000; // 0.05 OST
    const expectedFee = 5_000; // 0.1%
    const expectedNet = paymentAmount - expectedFee;

    const [merchantAccount] = getMerchantPda(
      userB.publicKey,
      program.programId
    );
    const [daoTreasury] = getDaoTreasuryPda(program.programId);
    const treasury = await program.account.daoTreasury.fetch(daoTreasury);

    // userA pays merchant userB
    await program.methods
      .merchantPayment(new BN(paymentAmount), "ORDER-001")
      .accounts({
        buyer: userA.publicKey,
        buyerTokenAccount: userAAta,
        merchantAccount,
        merchantTokenAccount: userBAta,
        treasuryTokenAccount: treasury.treasuryTokenAccount,
        daoTreasury,
        mint: mintKeypair.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .signers([userA])
      .rpc();

    const merchantData = await program.account.merchantAccount.fetch(merchantAccount);
    expect(merchantData.totalReceived.toNumber()).to.equal(expectedNet);

    console.log(`  Payment: ${expectedNet} to merchant, ${expectedFee} to DAO (memo: ORDER-001)`);
  });

  // =========================================================================
  // TEST 17: Create DePIN infrastructure proposal
  // =========================================================================
  it("creates a proposal for satellite DePIN funding", async () => {
    const proposalId = 3;
    const [proposal] = getProposalPda(proposalId, program.programId);

    await program.methods
      .createProposal(
        new BN(proposalId),
        "Fund satellite mesh network for decentralized internet via DAO treasury"
      )
      .accounts({
        admin: admin.publicKey,
        mintConfig,
        proposal,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const proposalData = await program.account.proposal.fetch(proposal);
    expect(proposalData.description).to.include("satellite mesh");
    expect(proposalData.proposalId.toNumber()).to.equal(3);

    console.log(`  Proposal #3: ${proposalData.description}`);
  });
});

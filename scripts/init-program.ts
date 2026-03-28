// =============================================================================
// OST Post-Deploy Initialization Script
// =============================================================================
// Run after deploying ost_token.so to devnet/mainnet.
// Steps:
//   1. Initialize the OST Token-2022 mint (with confidential transfers)
//   2. Initialize the DAO Treasury (0.1% fee)
//   3. (Optional) Create admin's own token account
//
// Usage:
//   npx ts-node scripts/init-program.ts
//   npx ts-node scripts/init-program.ts --cluster mainnet
// =============================================================================

import * as anchor from "@coral-xyz/anchor";
import { AnchorProvider, Program, BN } from "@coral-xyz/anchor";
import {
  PublicKey,
  Keypair,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  Connection,
  clusterApiUrl,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const PROGRAM_ID = new PublicKey(
  "J2jiS296YWVie1Sopb4SxcM3aJnP9aAwe6aLDhCqvGXY"
);

const cluster = process.argv.includes("--cluster")
  ? process.argv[process.argv.indexOf("--cluster") + 1]
  : "devnet";

const rpcUrl =
  cluster === "mainnet"
    ? clusterApiUrl("mainnet-beta")
    : cluster === "localnet"
      ? "http://localhost:8899"
      : clusterApiUrl("devnet");

// ---------------------------------------------------------------------------
// PDA helpers
// ---------------------------------------------------------------------------
function getMintAuthorityPda() {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("mint-authority")],
    PROGRAM_ID
  );
}
function getMintConfigPda() {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("mint-config")],
    PROGRAM_ID
  );
}
function getDaoTreasuryPda() {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("dao-treasury")],
    PROGRAM_ID
  );
}
function getTreasuryAuthorityPda() {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("treasury-authority")],
    PROGRAM_ID
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log("============================================");
  console.log("  OST Token — Post-Deploy Initialization");
  console.log(`  Cluster: ${cluster}`);
  console.log(`  RPC:     ${rpcUrl}`);
  console.log("============================================\n");

  // Load deployer keypair from Solana CLI default
  const keypairPath =
    process.env.ANCHOR_WALLET ||
    path.join(
      process.env.USERPROFILE || process.env.HOME || ".",
      ".config",
      "solana",
      "id.json"
    );

  if (!fs.existsSync(keypairPath)) {
    console.error(`ERROR: Keypair not found at ${keypairPath}`);
    console.error("Run: solana-keygen new");
    process.exit(1);
  }

  const rawKey = JSON.parse(fs.readFileSync(keypairPath, "utf-8"));
  const adminKeypair = Keypair.fromSecretKey(Uint8Array.from(rawKey));
  console.log(`Admin: ${adminKeypair.publicKey.toBase58()}`);

  // Setup provider
  const connection = new Connection(rpcUrl, "confirmed");
  const wallet = new anchor.Wallet(adminKeypair);
  const provider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });

  // Load IDL
  const idlPath = path.join(__dirname, "..", "target", "idl", "ost_token.json");
  if (!fs.existsSync(idlPath)) {
    console.error(`ERROR: IDL not found at ${idlPath}`);
    console.error("Run: anchor build");
    process.exit(1);
  }
  const idl = JSON.parse(fs.readFileSync(idlPath, "utf-8"));
  const program = new Program(idl, provider);

  // Check balance
  const balance = await connection.getBalance(adminKeypair.publicKey);
  const solBalance = balance / 1e9;
  console.log(`Balance: ${solBalance.toFixed(4)} SOL`);

  if (solBalance < 0.5) {
    console.error(
      `ERROR: Insufficient SOL (${solBalance}). Need at least 0.5 SOL.`
    );
    console.error(
      "Visit https://faucet.solana.com to get devnet SOL, or fund your wallet."
    );
    process.exit(1);
  }

  // -----------------------------------------------------------------------
  // Step 1: Initialize Mint
  // -----------------------------------------------------------------------
  console.log("\n[1/3] Initializing OST Mint...");

  const [mintAuthority] = getMintAuthorityPda();
  const [mintConfig] = getMintConfigPda();

  // Check if already initialized
  const existingConfig = await connection.getAccountInfo(mintConfig);
  let mintPubkey: PublicKey;

  if (existingConfig) {
    console.log("  Mint already initialized. Skipping.");
    // Read mint from config (it's stored on-chain, but we also save locally)
    const mintInfoPath = path.join(__dirname, "..", "mint-info.json");
    if (fs.existsSync(mintInfoPath)) {
      const info = JSON.parse(fs.readFileSync(mintInfoPath, "utf-8"));
      mintPubkey = new PublicKey(info.mint);
    } else {
      console.error("  WARNING: mint-info.json not found. Provide mint address manually.");
      process.exit(1);
    }
  } else {
    const mintKeypair = Keypair.generate();
    mintPubkey = mintKeypair.publicKey;

    try {
      const tx = await program.methods
        .initializeMint()
        .accounts({
          admin: adminKeypair.publicKey,
          mint: mintKeypair.publicKey,
          mintAuthority,
          mintConfig,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([mintKeypair])
        .rpc();

      console.log(`  ✅ Mint created: ${mintPubkey.toBase58()}`);
      console.log(`  TX: ${tx}`);

      // Save mint info for future use
      const mintInfo = {
        mint: mintPubkey.toBase58(),
        admin: adminKeypair.publicKey.toBase58(),
        programId: PROGRAM_ID.toBase58(),
        cluster,
        createdAt: new Date().toISOString(),
      };
      fs.writeFileSync(
        path.join(__dirname, "..", "mint-info.json"),
        JSON.stringify(mintInfo, null, 2)
      );
      console.log("  Saved to mint-info.json");
    } catch (e: any) {
      console.error(`  ERROR: ${e.message}`);
      process.exit(1);
    }
  }

  // -----------------------------------------------------------------------
  // Step 2: Initialize DAO Treasury
  // -----------------------------------------------------------------------
  console.log("\n[2/3] Initializing DAO Treasury...");

  const [daoTreasury] = getDaoTreasuryPda();
  const existingTreasury = await connection.getAccountInfo(daoTreasury);

  if (existingTreasury) {
    console.log("  Treasury already initialized. Skipping.");
  } else {
    // Create a treasury token account (ATA for the treasury authority)
    const [treasuryAuthority] = getTreasuryAuthorityPda();
    const treasuryAta = getAssociatedTokenAddressSync(
      mintPubkey,
      treasuryAuthority,
      true, // allowOwnerOffCurve (PDA)
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    // Create the ATA first
    try {
      const ataIx = createAssociatedTokenAccountInstruction(
        adminKeypair.publicKey,
        treasuryAta,
        treasuryAuthority,
        mintPubkey,
        TOKEN_2022_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );

      const { Transaction } = await import("@solana/web3.js");
      const ataTx = new Transaction().add(ataIx);
      await provider.sendAndConfirm(ataTx);
      console.log(`  Treasury ATA: ${treasuryAta.toBase58()}`);
    } catch (e: any) {
      // ATA may already exist
      if (!e.message?.includes("already in use")) {
        console.log(`  Treasury ATA may already exist: ${treasuryAta.toBase58()}`);
      }
    }

    // Initialize treasury
    try {
      const tx = await program.methods
        .initializeTreasury()
        .accounts({
          admin: adminKeypair.publicKey,
          mintConfig,
          daoTreasury,
          treasuryTokenAccount: treasuryAta,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      console.log(`  ✅ DAO Treasury initialized (0.1% fee)`);
      console.log(`  TX: ${tx}`);
    } catch (e: any) {
      console.error(`  ERROR: ${e.message}`);
    }
  }

  // -----------------------------------------------------------------------
  // Step 3: Create Admin Token Account
  // -----------------------------------------------------------------------
  console.log("\n[3/3] Creating admin token account...");

  const adminAta = getAssociatedTokenAddressSync(
    mintPubkey,
    adminKeypair.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  const existingAta = await connection.getAccountInfo(adminAta);
  if (existingAta) {
    console.log(`  Admin ATA already exists: ${adminAta.toBase58()}`);
  } else {
    try {
      const { Transaction } = await import("@solana/web3.js");
      const ataIx = createAssociatedTokenAccountInstruction(
        adminKeypair.publicKey,
        adminAta,
        adminKeypair.publicKey,
        mintPubkey,
        TOKEN_2022_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );
      const ataTx = new Transaction().add(ataIx);
      await provider.sendAndConfirm(ataTx);
      console.log(`  ✅ Admin ATA created: ${adminAta.toBase58()}`);
    } catch (e: any) {
      console.error(`  ATA creation error: ${e.message}`);
    }
  }

  // -----------------------------------------------------------------------
  // Summary
  // -----------------------------------------------------------------------
  console.log("\n============================================");
  console.log("  ✅ OST Token Initialization Complete!");
  console.log("============================================");
  console.log(`  Program:  ${PROGRAM_ID.toBase58()}`);
  console.log(`  Mint:     ${mintPubkey.toBase58()}`);
  console.log(`  Admin:    ${adminKeypair.publicKey.toBase58()}`);
  console.log(`  Cluster:  ${cluster}`);
  console.log(`  Treasury: 0.1% DAO fee active`);
  console.log("============================================");
  console.log("\nNext steps:");
  console.log("  1. Use confidentialMint() to distribute tokens");
  console.log("  2. Users configure confidential accounts");
  console.log("  3. Set up Raydium/Orca liquidity pool");
  console.log("  4. Submit to Jupiter strict list");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

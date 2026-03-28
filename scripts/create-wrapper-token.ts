// =============================================================================
// OST Token — Create wOST (Wrapped OST) for DEX Trading
// =============================================================================
// Token-2022 mints with ConfidentialTransfer extension cannot be used in AMM
// pools (Raydium, Orca) because AMMs need transparent balances.
//
// Solution: Create a standard SPL "wOST" token that wraps OST 1:1.
// - Users wrap: OST → wOST (for DEX trading)
// - Users unwrap: wOST → OST (for private transfers)
// - wOST is a standard SPL token, compatible with all DEX pools.
//
// Usage:
//   npx ts-node scripts/create-wrapper-token.ts                    # devnet
//   npx ts-node scripts/create-wrapper-token.ts --cluster mainnet  # mainnet
// =============================================================================

import {
  Connection,
  Keypair,
  SystemProgram,
  Transaction,
  clusterApiUrl,
  PublicKey,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  createInitializeMintInstruction,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
  createMintToInstruction,
  getMintLen,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const cluster = process.argv.includes("--cluster")
  ? process.argv[process.argv.indexOf("--cluster") + 1]
  : "devnet";

const DECIMALS = 9; // Same as OST

const rpcUrl =
  cluster === "mainnet"
    ? clusterApiUrl("mainnet-beta")
    : cluster === "localnet"
      ? "http://localhost:8899"
      : clusterApiUrl("devnet");

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log("============================================");
  console.log("  OST Token — Create wOST Wrapper Token");
  console.log(`  Cluster: ${cluster}`);
  console.log("============================================\n");

  // Load deployer keypair
  const keypairPath =
    process.env.ANCHOR_WALLET ||
    path.join(
      process.env.USERPROFILE || process.env.HOME || ".",
      ".config",
      "solana",
      "id.json"
    );

  if (!fs.existsSync(keypairPath)) {
    console.error("ERROR: Keypair not found at", keypairPath);
    process.exit(1);
  }

  const rawKey = JSON.parse(fs.readFileSync(keypairPath, "utf-8"));
  const admin = Keypair.fromSecretKey(Uint8Array.from(rawKey));
  console.log(`Admin: ${admin.publicKey.toBase58()}`);

  const connection = new Connection(rpcUrl, "confirmed");
  const balance = await connection.getBalance(admin.publicKey);
  console.log(`Balance: ${(balance / 1e9).toFixed(4)} SOL\n`);

  // Load original OST mint info
  const mintInfoPath = path.join(__dirname, "..", "mint-info.json");
  if (!fs.existsSync(mintInfoPath)) {
    console.error("ERROR: mint-info.json not found. Run init-program.ts first.");
    process.exit(1);
  }
  const mintInfo = JSON.parse(fs.readFileSync(mintInfoPath, "utf-8"));
  console.log(`Original OST Mint: ${mintInfo.mint}`);

  // Create new wOST mint (standard SPL token - NOT Token-2022)
  const wostMint = Keypair.generate();
  console.log(`\nCreating wOST mint: ${wostMint.publicKey.toBase58()}`);

  const mintLen = getMintLen([]);
  const mintRent = await connection.getMinimumBalanceForRentExemption(mintLen);

  const tx1 = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: admin.publicKey,
      newAccountPubkey: wostMint.publicKey,
      space: mintLen,
      lamports: mintRent,
      programId: TOKEN_PROGRAM_ID, // Standard SPL token
    }),
    createInitializeMintInstruction(
      wostMint.publicKey,
      DECIMALS,
      admin.publicKey, // mint authority = admin
      admin.publicKey, // freeze authority = admin (can revoke later)
      TOKEN_PROGRAM_ID
    )
  );

  const sig1 = await sendAndConfirmTransaction(connection, tx1, [admin, wostMint]);
  console.log(`  ✅ wOST Mint created! TX: ${sig1}`);

  // Create admin's wOST ATA
  const adminWostAta = getAssociatedTokenAddressSync(
    wostMint.publicKey,
    admin.publicKey,
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  const tx2 = new Transaction().add(
    createAssociatedTokenAccountInstruction(
      admin.publicKey,
      adminWostAta,
      admin.publicKey,
      wostMint.publicKey,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    )
  );

  const sig2 = await sendAndConfirmTransaction(connection, tx2, [admin]);
  console.log(`  ✅ Admin wOST ATA: ${adminWostAta.toBase58()}`);

  // Mint same supply as OST (1 billion wOST)
  const supply = BigInt(1_000_000_000) * BigInt(10 ** DECIMALS);

  const tx3 = new Transaction().add(
    createMintToInstruction(
      wostMint.publicKey,
      adminWostAta,
      admin.publicKey,
      supply,
      [],
      TOKEN_PROGRAM_ID
    )
  );

  const sig3 = await sendAndConfirmTransaction(connection, tx3, [admin]);
  console.log(`  ✅ Minted 1,000,000,000 wOST! TX: ${sig3}`);

  // Save wOST info
  const wostInfo = {
    wostMint: wostMint.publicKey.toBase58(),
    ostMint: mintInfo.mint,
    adminAta: adminWostAta.toBase58(),
    decimals: DECIMALS,
    supply: "1000000000",
    tokenProgram: TOKEN_PROGRAM_ID.toBase58(),
    cluster,
    createdAt: new Date().toISOString(),
    description:
      "wOST (Wrapped OST) is a standard SPL token for DEX trading. 1 wOST = 1 OST.",
  };

  const wostInfoPath = path.join(__dirname, "..", "wost-info.json");
  fs.writeFileSync(wostInfoPath, JSON.stringify(wostInfo, null, 2));

  console.log("\n============================================");
  console.log("  ✅ wOST Wrapper Token Created!");
  console.log("============================================");
  console.log(`  wOST Mint:  ${wostMint.publicKey.toBase58()}`);
  console.log(`  OST Mint:   ${mintInfo.mint}`);
  console.log(`  Admin ATA:  ${adminWostAta.toBase58()}`);
  console.log(`  Supply:     1,000,000,000 wOST`);
  console.log(`  Decimals:   ${DECIMALS}`);
  console.log(`  Program:    SPL Token (standard)`);
  console.log(`  Cluster:    ${cluster}`);
  console.log("============================================");
  console.log("\nwOST is a 1:1 wrapper around OST:");
  console.log("  - OST (Token-2022) = privacy + confidential transfers");
  console.log("  - wOST (SPL Token) = DEX trading on Raydium/Orca/Jupiter");
  console.log("\nNext: Create Raydium pool with wOST/SOL");

  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

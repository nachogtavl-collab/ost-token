// =============================================================================
// OST Token — Mint Initial Supply
// =============================================================================
// Mints OST tokens to the admin's token account.
// Run AFTER init-program.ts has created the mint + treasury.
//
// Usage:
//   npx ts-node scripts/mint-supply.ts                    # 1 billion OST on devnet
//   npx ts-node scripts/mint-supply.ts --cluster mainnet  # mainnet
//   npx ts-node scripts/mint-supply.ts --amount 500000000 # custom amount
// =============================================================================

import * as anchor from "@coral-xyz/anchor";
import { AnchorProvider, Program, BN } from "@coral-xyz/anchor";
import {
  PublicKey,
  Keypair,
  Connection,
  clusterApiUrl,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAccount,
} from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const PROGRAM_ID = new PublicKey(
  "J2jiS296YWVie1Sopb4SxcM3aJnP9aAwe6aLDhCqvGXY"
);
const DECIMALS = 9;

const cluster = process.argv.includes("--cluster")
  ? process.argv[process.argv.indexOf("--cluster") + 1]
  : "devnet";

// Default: 1 billion OST tokens
const amountArg = process.argv.includes("--amount")
  ? parseInt(process.argv[process.argv.indexOf("--amount") + 1])
  : 1_000_000_000;

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

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const rawAmount = BigInt(amountArg) * BigInt(10 ** DECIMALS);

  console.log("============================================");
  console.log("  OST Token — Mint Supply");
  console.log(`  Cluster:   ${cluster}`);
  console.log(`  Amount:    ${amountArg.toLocaleString()} OST`);
  console.log(`  Raw:       ${rawAmount.toString()} (${DECIMALS} decimals)`);
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
    console.error(`ERROR: Keypair not found at ${keypairPath}`);
    process.exit(1);
  }

  const rawKey = JSON.parse(fs.readFileSync(keypairPath, "utf-8"));
  const adminKeypair = Keypair.fromSecretKey(Uint8Array.from(rawKey));
  console.log(`Admin: ${adminKeypair.publicKey.toBase58()}`);

  // Load mint info
  const mintInfoPath = path.join(__dirname, "..", "mint-info.json");
  if (!fs.existsSync(mintInfoPath)) {
    console.error("ERROR: mint-info.json not found. Run init-program.ts first.");
    process.exit(1);
  }
  const mintInfo = JSON.parse(fs.readFileSync(mintInfoPath, "utf-8"));
  const mintPubkey = new PublicKey(mintInfo.mint);
  console.log(`Mint:  ${mintPubkey.toBase58()}`);

  // Setup provider
  const connection = new Connection(rpcUrl, "confirmed");
  const wallet = new anchor.Wallet(adminKeypair);
  const provider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });

  // Load IDL and program
  const idlPath = path.join(__dirname, "..", "target", "idl", "ost_token.json");
  if (!fs.existsSync(idlPath)) {
    console.error("ERROR: IDL not found. Run anchor build first.");
    process.exit(1);
  }
  const idl = JSON.parse(fs.readFileSync(idlPath, "utf-8"));
  const program = new Program(idl, provider);

  // Get admin ATA
  const adminAta = getAssociatedTokenAddressSync(
    mintPubkey,
    adminKeypair.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
  console.log(`ATA:   ${adminAta.toBase58()}`);

  // Verify ATA exists
  const ataInfo = await connection.getAccountInfo(adminAta);
  if (!ataInfo) {
    console.error("ERROR: Admin ATA not found. Run init-program.ts first.");
    process.exit(1);
  }

  // Get PDA addresses
  const [mintAuthority] = getMintAuthorityPda();
  const [mintConfig] = getMintConfigPda();

  // Mint tokens
  console.log("\nMinting tokens...");

  try {
    const tx = await program.methods
      .confidentialMint(new BN(rawAmount.toString()), Buffer.from([]))
      .accounts({
        admin: adminKeypair.publicKey,
        mint: mintPubkey,
        mintAuthority,
        mintConfig,
        destination: adminAta,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc();

    console.log(`\n✅ Successfully minted ${amountArg.toLocaleString()} OST!`);
    console.log(`TX: ${tx}`);

    // Check resulting balance
    try {
      const account = await getAccount(
        connection,
        adminAta,
        "confirmed",
        TOKEN_2022_PROGRAM_ID
      );
      const displayBalance = Number(account.amount) / 10 ** DECIMALS;
      console.log(`\nToken balance: ${displayBalance.toLocaleString()} OST`);
    } catch {
      console.log("(Balance check skipped — may need manual verification)");
    }

    console.log("\n============================================");
    console.log("  ✅ OST Supply Minted!");
    console.log("============================================");
    console.log(`  Tokens:  ${amountArg.toLocaleString()} OST`);
    console.log(`  To:      ${adminAta.toBase58()}`);
    console.log(`  Mint:    ${mintPubkey.toBase58()}`);
    console.log(`  Cluster: ${cluster}`);
    console.log("============================================");
    console.log("\nNext steps:");
    console.log("  1. Transfer tokens to users / community wallets");
    console.log("  2. Create liquidity pool on Raydium/Orca");
    console.log("  3. List on Jupiter aggregator");
    console.log("  4. Users can buy OST via the website");
  } catch (e: any) {
    console.error(`\nERROR minting: ${e.message}`);
    if (e.logs) {
      console.error("\nProgram logs:");
      e.logs.forEach((l: string) => console.error(`  ${l}`));
    }
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

// =============================================================================
// OST Token — Create Metaplex Token Metadata
// =============================================================================
// Creates the standard Metaplex metadata PDA for the existing OST Token-2022
// mint. The mint authority is the OST program's mint-authority PDA, so this
// script calls the OST program instruction that signs the Metaplex CPI.
//
// Usage:
//   npx ts-node scripts/create-ost-metaplex-metadata.ts
// =============================================================================

import {
  PublicKey,
  Keypair,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  Connection,
  clusterApiUrl,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { createHash } from "crypto";
import * as fs from "fs";
import * as path from "path";

const PROGRAM_ID = new PublicKey("J2jiS296YWVie1Sopb4SxcM3aJnP9aAwe6aLDhCqvGXY");
const TOKEN_METADATA_PROGRAM_ID = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
const TOKEN_2022_PROGRAM_ID = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
const DEFAULT_METADATA_URI = "https://nachogtavl-collab.github.io/ost-token/assets/ost-metadata.json";
const DEFAULT_NAME = "OST";
const DEFAULT_SYMBOL = "OST";

const cluster = process.argv.includes("--cluster")
  ? process.argv[process.argv.indexOf("--cluster") + 1]
  : "devnet";

const rpcUrl = process.argv.includes("--rpc")
  ? process.argv[process.argv.indexOf("--rpc") + 1]
  : cluster === "mainnet"
    ? clusterApiUrl("mainnet-beta")
    : cluster === "localnet"
      ? "http://localhost:8899"
      : clusterApiUrl("devnet");

function readJson(filePath: string) {
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

function keypairPath() {
  return (
    process.env.ANCHOR_WALLET ||
    path.join(
      process.env.USERPROFILE || process.env.HOME || ".",
      ".config",
      "solana",
      "id.json"
    )
  );
}

function getMintAuthorityPda() {
  return PublicKey.findProgramAddressSync([Buffer.from("mint-authority")], PROGRAM_ID);
}

function getMintConfigPda() {
  return PublicKey.findProgramAddressSync([Buffer.from("mint-config")], PROGRAM_ID);
}

function getMetadataPda(mint: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("metadata"), TOKEN_METADATA_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    TOKEN_METADATA_PROGRAM_ID
  );
}

function anchorDiscriminator(name: string) {
  return createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
}

function encodeString(value: string) {
  const bytes = Buffer.from(value, "utf-8");
  const length = Buffer.alloc(4);
  length.writeUInt32LE(bytes.length);
  return Buffer.concat([length, bytes]);
}

function createMetaplexMetadataInstructionData(name: string, symbol: string, uri: string) {
  return Buffer.concat([
    anchorDiscriminator("create_metaplex_metadata"),
    encodeString(name),
    encodeString(symbol),
    encodeString(uri),
  ]);
}

async function main() {
  console.log("============================================");
  console.log("  OST Token — Create Metaplex Metadata");
  console.log(`  Cluster: ${cluster}`);
  console.log(`  RPC:     ${rpcUrl}`);
  console.log("============================================\n");

  const walletPath = keypairPath();
  if (!fs.existsSync(walletPath)) {
    throw new Error(`Keypair not found at ${walletPath}`);
  }

  const rawKey = readJson(walletPath);
  const admin = Keypair.fromSecretKey(Uint8Array.from(rawKey));
  console.log(`Admin/payer: ${admin.publicKey.toBase58()}`);

  const mintInfoPath = path.join(__dirname, "..", "mint-info.json");
  const mintInfo = readJson(mintInfoPath);
  const mint = new PublicKey(mintInfo.mint);
  console.log(`OST mint:    ${mint.toBase58()}`);

  const [mintAuthority] = getMintAuthorityPda();
  const [mintConfig] = getMintConfigPda();
  const [metadata] = getMetadataPda(mint);
  console.log(`Mint auth:   ${mintAuthority.toBase58()}`);
  console.log(`Metadata:    ${metadata.toBase58()}`);
  console.log(`URI:         ${DEFAULT_METADATA_URI}\n`);

  const connection = new Connection(rpcUrl, "confirmed");
  const existingMetadata = await connection.getAccountInfo(metadata);
  if (existingMetadata) {
    console.log("Metadata account already exists. Nothing to create.");
    console.log(`Owner: ${existingMetadata.owner.toBase58()}`);
    return;
  }

  const instruction = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: admin.publicKey, isSigner: true, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: true },
      { pubkey: metadata, isSigner: false, isWritable: true },
      { pubkey: mintConfig, isSigner: false, isWritable: false },
      { pubkey: mintAuthority, isSigner: false, isWritable: false },
      { pubkey: TOKEN_METADATA_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_INSTRUCTIONS_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: createMetaplexMetadataInstructionData(
      DEFAULT_NAME,
      DEFAULT_SYMBOL,
      DEFAULT_METADATA_URI
    ),
  });

  const transaction = new Transaction().add(instruction);
  const tx = await sendAndConfirmTransaction(connection, transaction, [admin], {
    commitment: "confirmed",
  });

  console.log(`Metadata created. TX: ${tx}`);

  const created = await connection.getAccountInfo(metadata, "confirmed");
  if (!created) {
    throw new Error("Metadata transaction confirmed, but metadata account was not found");
  }
  console.log(`Metadata owner: ${created.owner.toBase58()}`);
  console.log("\nDone. Wallets and indexers can now read OST through Metaplex metadata.");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
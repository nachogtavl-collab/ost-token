// =============================================================================
// OST Token — Set On-Chain Metadata for wOST (Metaplex Token Metadata)
// =============================================================================
// Jupiter, Raydium, and wallets read Metaplex on-chain metadata to display
// token name, symbol, and logo. This script creates the metadata account.
//
// Usage:
//   npx ts-node scripts/set-token-metadata.ts                    # devnet
//   npx ts-node scripts/set-token-metadata.ts --cluster mainnet  # mainnet
// =============================================================================

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
  clusterApiUrl,
  SystemProgram,
} from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";

// ---------------------------------------------------------------------------
// Metaplex Token Metadata Program
// ---------------------------------------------------------------------------
const TOKEN_METADATA_PROGRAM_ID = new PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
);

const cluster = process.argv.includes("--cluster")
  ? process.argv[process.argv.indexOf("--cluster") + 1]
  : "devnet";

const rpcUrl =
  cluster === "mainnet"
    ? clusterApiUrl("mainnet-beta")
    : clusterApiUrl("devnet");

// ---------------------------------------------------------------------------
// Borsh-like serialization helpers (avoid heavy dependency)
// ---------------------------------------------------------------------------
function encodeString(s: string): Buffer {
  const buf = Buffer.from(s, "utf-8");
  const len = Buffer.alloc(4);
  len.writeUInt32LE(buf.length);
  return Buffer.concat([len, buf]);
}

function encodeCreateMetadataV3(
  name: string,
  symbol: string,
  uri: string
): Buffer {
  // Discriminator for CreateMetadataAccountV3 = 33
  const disc = Buffer.from([33]);

  const nameEncoded = encodeString(name.padEnd(32, "\0").slice(0, 32));
  const symbolEncoded = encodeString(symbol.padEnd(10, "\0").slice(0, 10));
  const uriEncoded = encodeString(uri.padEnd(200, "\0").slice(0, 200));

  // seller_fee_basis_points = 0
  const sellerFee = Buffer.alloc(2);
  sellerFee.writeUInt16LE(0);

  // creators: None (Option<Vec<Creator>>)
  const creatorsNone = Buffer.from([0]);

  // collection: None
  const collectionNone = Buffer.from([0]);

  // uses: None
  const usesNone = Buffer.from([0]);

  // is_mutable = true
  const isMutable = Buffer.from([1]);

  // collection_details: None
  const collectionDetailsNone = Buffer.from([0]);

  return Buffer.concat([
    disc,
    nameEncoded,
    symbolEncoded,
    uriEncoded,
    sellerFee,
    creatorsNone,
    collectionNone,
    usesNone,
    isMutable,
    collectionDetailsNone,
  ]);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log("============================================");
  console.log("  OST Token — Set wOST On-Chain Metadata");
  console.log(`  Cluster: ${cluster}`);
  console.log("============================================\n");

  // Load keypair
  const keypairPath =
    process.env.ANCHOR_WALLET ||
    path.join(
      process.env.USERPROFILE || process.env.HOME || ".",
      ".config",
      "solana",
      "id.json"
    );
  const rawKey = JSON.parse(fs.readFileSync(keypairPath, "utf-8"));
  const admin = Keypair.fromSecretKey(Uint8Array.from(rawKey));
  console.log(`Admin: ${admin.publicKey.toBase58()}`);

  // Load wOST info
  const wostInfoPath = path.join(__dirname, "..", "wost-info.json");
  if (!fs.existsSync(wostInfoPath)) {
    console.error("ERROR: wost-info.json not found. Run create-wrapper-token.ts first.");
    process.exit(1);
  }
  const wostInfo = JSON.parse(fs.readFileSync(wostInfoPath, "utf-8"));
  const wostMint = new PublicKey(wostInfo.wostMint);
  console.log(`wOST Mint: ${wostMint.toBase58()}`);

  const connection = new Connection(rpcUrl, "confirmed");
  const balance = await connection.getBalance(admin.publicKey);
  console.log(`Balance: ${(balance / 1e9).toFixed(4)} SOL\n`);

  // Derive metadata PDA
  const [metadataPda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata"),
      TOKEN_METADATA_PROGRAM_ID.toBuffer(),
      wostMint.toBuffer(),
    ],
    TOKEN_METADATA_PROGRAM_ID
  );
  console.log(`Metadata PDA: ${metadataPda.toBase58()}`);

  // Check if metadata already exists
  const metaAccount = await connection.getAccountInfo(metadataPda);
  if (metaAccount) {
    console.log("\n⚠️  Metadata account already exists. Updating...");
    // Use UpdateMetadataAccountV2 (discriminator = 15)
    const data = encodeUpdateMetadataV2(
      "Wrapped OST",
      "wOST",
      "https://nachogtavl-collab.github.io/ost-token/wost-metadata.json"
    );

    const ix = new TransactionInstruction({
      keys: [
        { pubkey: metadataPda, isSigner: false, isWritable: true },
        { pubkey: admin.publicKey, isSigner: true, isWritable: false },
      ],
      programId: TOKEN_METADATA_PROGRAM_ID,
      data,
    });

    const tx = new Transaction().add(ix);
    const sig = await sendAndConfirmTransaction(connection, tx, [admin]);
    console.log(`\n✅ Metadata updated! TX: ${sig}`);
  } else {
    console.log("Creating new metadata account...\n");

    const data = encodeCreateMetadataV3(
      "Wrapped OST",
      "wOST",
      "https://nachogtavl-collab.github.io/ost-token/wost-metadata.json"
    );

    const ix = new TransactionInstruction({
      keys: [
        { pubkey: metadataPda, isSigner: false, isWritable: true },
        { pubkey: wostMint, isSigner: false, isWritable: false },
        { pubkey: admin.publicKey, isSigner: true, isWritable: true }, // mint authority
        { pubkey: admin.publicKey, isSigner: true, isWritable: true }, // payer
        { pubkey: admin.publicKey, isSigner: true, isWritable: false }, // update authority
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      programId: TOKEN_METADATA_PROGRAM_ID,
      data,
    });

    const tx = new Transaction().add(ix);
    const sig = await sendAndConfirmTransaction(connection, tx, [admin]);
    console.log(`\n✅ Metadata created! TX: ${sig}`);
  }

  console.log("\n============================================");
  console.log("  ✅ wOST Metadata Set!");
  console.log("============================================");
  console.log("  Name:    Wrapped OST");
  console.log("  Symbol:  wOST");
  console.log("  URI:     https://nachogtavl-collab.github.io/ost-token/wost-metadata.json");
  console.log("  Logo:    https://nachogtavl-collab.github.io/ost-token/ost-logo.svg");
  console.log("============================================");
  console.log("\nJupiter, Raydium, and wallets will now display wOST properly.");
  process.exit(0);
}

function encodeUpdateMetadataV2(
  name: string,
  symbol: string,
  uri: string
): Buffer {
  // Discriminator for UpdateMetadataAccountV2 = 15
  const disc = Buffer.from([15]);

  // data: Option<DataV2> — Some
  const dataSome = Buffer.from([1]);

  const nameEncoded = encodeString(name.padEnd(32, "\0").slice(0, 32));
  const symbolEncoded = encodeString(symbol.padEnd(10, "\0").slice(0, 10));
  const uriEncoded = encodeString(uri.padEnd(200, "\0").slice(0, 200));

  const sellerFee = Buffer.alloc(2);
  sellerFee.writeUInt16LE(0);

  const creatorsNone = Buffer.from([0]);
  const collectionNone = Buffer.from([0]);
  const usesNone = Buffer.from([0]);

  // new_update_authority: None
  const newAuthNone = Buffer.from([0]);
  // primary_sale_happened: None
  const primarySaleNone = Buffer.from([0]);
  // is_mutable: None
  const isMutableNone = Buffer.from([0]);

  return Buffer.concat([
    disc,
    dataSome,
    nameEncoded,
    symbolEncoded,
    uriEncoded,
    sellerFee,
    creatorsNone,
    collectionNone,
    usesNone,
    newAuthNone,
    primarySaleNone,
    isMutableNone,
  ]);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

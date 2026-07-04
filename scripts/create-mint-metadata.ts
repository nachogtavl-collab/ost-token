// =============================================================================
// Create Metaplex Token Metadata for an existing SPL mint (devnet/mainnet)
// =============================================================================
// Direct Metaplex Token Metadata path — no OST program CPI. Requires only the
// mint-authority keypair (defaults to the Solana CLI wallet at
// ~/.config/solana/id.json). Creates the metadata PDA if missing, otherwise
// updates it via UpdateMetadataAccountV2.
//
// Usage:
//   npx ts-node scripts/create-mint-metadata.ts \
//     --mint B2VzBDMbkHS6aiWb6XeDuXwK8fyhjH4uswcdJbhwgVfj \
//     --name "OST" --symbol "OST" \
//     --uri "https://nachogtavl-collab.github.io/ost-token/assets/ost-metadata.json"
//
// Defaults (if flags omitted):
//   --mint    -> mint-info.json:mint
//   --name    -> "OST"
//   --symbol  -> "OST"
//   --uri     -> "https://nachogtavl-collab.github.io/ost-token/assets/ost-metadata.json"
//   --cluster -> "devnet"
// =============================================================================

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  clusterApiUrl,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";

const TOKEN_METADATA_PROGRAM_ID = new PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
);

function argOf(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function encodeString(s: string): Buffer {
  const buf = Buffer.from(s, "utf-8");
  const len = Buffer.alloc(4);
  len.writeUInt32LE(buf.length);
  return Buffer.concat([len, buf]);
}

// CreateMetadataAccountV3 (Metaplex Token Metadata instruction discriminator = 33)
function encodeCreateMetadataV3(name: string, symbol: string, uri: string): Buffer {
  return Buffer.concat([
    Buffer.from([33]),
    encodeString(name),
    encodeString(symbol),
    encodeString(uri),
    (() => { const b = Buffer.alloc(2); b.writeUInt16LE(0); return b; })(), // seller_fee_basis_points
    Buffer.from([0]),                                                       // creators: None
    Buffer.from([0]),                                                       // collection: None
    Buffer.from([0]),                                                       // uses: None
    Buffer.from([1]),                                                       // is_mutable: true
    Buffer.from([0]),                                                       // collection_details: None
  ]);
}

// UpdateMetadataAccountV2 (instruction discriminator = 15)
function encodeUpdateMetadataV2(name: string, symbol: string, uri: string): Buffer {
  return Buffer.concat([
    Buffer.from([15]),
    Buffer.from([1]),                 // data: Some
    encodeString(name),
    encodeString(symbol),
    encodeString(uri),
    (() => { const b = Buffer.alloc(2); b.writeUInt16LE(0); return b; })(),
    Buffer.from([0]),                 // creators: None
    Buffer.from([0]),                 // update_authority: None (keep current)
    Buffer.from([0]),                 // primary_sale_happened: None
    Buffer.from([1, 1]),              // is_mutable: Some(true)
  ]);
}

async function main() {
  const cluster = argOf("--cluster") ?? "devnet";
  const rpcUrl =
    argOf("--rpc") ??
    (cluster === "mainnet" || cluster === "mainnet-beta"
      ? clusterApiUrl("mainnet-beta")
      : cluster === "localnet"
        ? "http://localhost:8899"
        : clusterApiUrl("devnet"));

  const keypairPath =
    argOf("--keypair") ??
    process.env.ANCHOR_WALLET ??
    path.join(
      process.env.USERPROFILE || process.env.HOME || ".",
      ".config",
      "solana",
      "id.json"
    );
  if (!fs.existsSync(keypairPath)) {
    throw new Error(`Keypair not found at ${keypairPath}`);
  }
  const signer = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(keypairPath, "utf-8")))
  );

  let mintArg = argOf("--mint");
  if (!mintArg) {
    const mintInfoPath = path.join(__dirname, "..", "mint-info.json");
    if (!fs.existsSync(mintInfoPath)) {
      throw new Error("--mint not provided and mint-info.json missing");
    }
    mintArg = JSON.parse(fs.readFileSync(mintInfoPath, "utf-8")).mint;
  }
  const mint = new PublicKey(mintArg!);

  const name = argOf("--name") ?? "OST";
  const symbol = argOf("--symbol") ?? "OST";
  const uri =
    argOf("--uri") ??
    "https://nachogtavl-collab.github.io/ost-token/assets/ost-metadata.json";

  const [metadataPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("metadata"), TOKEN_METADATA_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    TOKEN_METADATA_PROGRAM_ID
  );

  console.log("============================================");
  console.log("  Metaplex Token Metadata");
  console.log("============================================");
  console.log(`  Cluster:       ${cluster}`);
  console.log(`  RPC:           ${rpcUrl}`);
  console.log(`  Signer:        ${signer.publicKey.toBase58()}`);
  console.log(`  Mint:          ${mint.toBase58()}`);
  console.log(`  Metadata PDA:  ${metadataPda.toBase58()}`);
  console.log(`  Name:          ${name}`);
  console.log(`  Symbol:        ${symbol}`);
  console.log(`  URI:           ${uri}`);
  console.log("============================================\n");

  const connection = new Connection(rpcUrl, "confirmed");
  const balance = await connection.getBalance(signer.publicKey);
  console.log(`Signer balance: ${(balance / 1e9).toFixed(4)} SOL`);

  // Sanity: confirm signer is the current mint authority.
  const mintAccount = await connection.getAccountInfo(mint);
  if (!mintAccount) {
    throw new Error(`Mint ${mint.toBase58()} not found on ${cluster}`);
  }
  // SPL Token + Token-2022 mint layout: mint_authority option at bytes 0..36
  // (COption<Pubkey>: 4 bytes tag + 32 bytes pubkey).
  const tag = mintAccount.data.readUInt32LE(0);
  if (tag === 1) {
    const authority = new PublicKey(mintAccount.data.subarray(4, 36));
    console.log(`On-chain mint authority: ${authority.toBase58()}`);
    if (!authority.equals(signer.publicKey)) {
      throw new Error(
        `Signer ${signer.publicKey.toBase58()} is NOT the current mint authority (${authority.toBase58()}). Aborting.`
      );
    }
  } else {
    throw new Error("Mint authority is unset (None); cannot create Metaplex metadata.");
  }

  const existing = await connection.getAccountInfo(metadataPda);
  if (existing) {
    console.log("\nMetadata PDA already exists — sending UpdateMetadataAccountV2...");
    const ix = new TransactionInstruction({
      programId: TOKEN_METADATA_PROGRAM_ID,
      keys: [
        { pubkey: metadataPda,        isSigner: false, isWritable: true  },
        { pubkey: signer.publicKey,   isSigner: true,  isWritable: false }, // update_authority
      ],
      data: encodeUpdateMetadataV2(name, symbol, uri),
    });
    const sig = await sendAndConfirmTransaction(
      connection,
      new Transaction().add(ix),
      [signer],
      { commitment: "confirmed" }
    );
    console.log(`\nUpdated. TX: ${sig}`);
    console.log(`https://solscan.io/tx/${sig}?cluster=${cluster}`);
    return;
  }

  console.log("\nCreating metadata PDA (CreateMetadataAccountV3)...");
  const ix = new TransactionInstruction({
    programId: TOKEN_METADATA_PROGRAM_ID,
    keys: [
      { pubkey: metadataPda,                 isSigner: false, isWritable: true  },
      { pubkey: mint,                        isSigner: false, isWritable: false },
      { pubkey: signer.publicKey,            isSigner: true,  isWritable: false }, // mint_authority
      { pubkey: signer.publicKey,            isSigner: true,  isWritable: true  }, // payer
      { pubkey: signer.publicKey,            isSigner: false, isWritable: false }, // update_authority
      { pubkey: SystemProgram.programId,     isSigner: false, isWritable: false },
    ],
    data: encodeCreateMetadataV3(name, symbol, uri),
  });
  const sig = await sendAndConfirmTransaction(
    connection,
    new Transaction().add(ix),
    [signer],
    { commitment: "confirmed" }
  );

  console.log(`\nCreated. TX: ${sig}`);
  console.log(`https://solscan.io/tx/${sig}?cluster=${cluster}`);
  console.log(`https://solscan.io/token/${mint.toBase58()}?cluster=${cluster}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});

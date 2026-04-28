// =============================================================================
// OST Token — Fund Swap Pool Vault
// =============================================================================
// Mints OST directly into the swap pool ATA so the vault can pay out to many
// users (faucet cashouts, SOL→OST swaps, OST IOUs, treasury deposits).
//
// Defaults to 10,000,000 OST (10 million). Pool ATA already exists.
//
// Usage (from repo root):
//   npx ts-node scripts/fund-pool.ts                 # 10M OST to pool
//   npx ts-node scripts/fund-pool.ts --amount 50000000  # 50M
//
// Requires: deployer keypair at ~/.config/solana/id.json (same one that
// initialised the program — `6LvGarqaiQfaaZ8RsCd3NQE96UAhDYCz8MXvarw6bsfF`).
// =============================================================================

import * as anchor from "@coral-xyz/anchor";
import { AnchorProvider, Program, BN } from "@coral-xyz/anchor";
import { PublicKey, Keypair, Connection, clusterApiUrl } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, getAccount } from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";

const PROGRAM_ID = new PublicKey("J2jiS296YWVie1Sopb4SxcM3aJnP9aAwe6aLDhCqvGXY");
const MINT       = new PublicKey("383pTzoZ8Gp83dzk23ZnvLcfX2Sq32TAGN48CMQu2pAJ");
const POOL_ATA   = new PublicKey("5b5DBGw1DocFqFaDxukRxEv46kKGXwQQNDRkHBAwAiGK");
const DECIMALS   = 9;

const amountArg = process.argv.includes("--amount")
  ? parseInt(process.argv[process.argv.indexOf("--amount") + 1], 10)
  : 10_000_000; // 10 million OST default

function pda(seed: string) {
  return PublicKey.findProgramAddressSync([Buffer.from(seed)], PROGRAM_ID)[0];
}

async function main() {
  const raw = BigInt(amountArg) * BigInt(10 ** DECIMALS);
  console.log("============================================");
  console.log("  OST · Fund Swap Pool Vault (devnet)");
  console.log(`  Amount:   ${amountArg.toLocaleString()} OST`);
  console.log(`  Raw:      ${raw.toString()}`);
  console.log(`  Pool ATA: ${POOL_ATA.toBase58()}`);
  console.log("============================================\n");

  const kpPath = process.env.ANCHOR_WALLET ||
    path.join(process.env.USERPROFILE || process.env.HOME || ".",
              ".config", "solana", "id.json");
  if (!fs.existsSync(kpPath)) { console.error("Keypair not found:", kpPath); process.exit(1); }
  const admin = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(kpPath, "utf-8"))));
  console.log("Admin (deployer):", admin.publicKey.toBase58());

  const conn = new Connection(clusterApiUrl("devnet"), "confirmed");
  const provider = new AnchorProvider(conn, new anchor.Wallet(admin), { commitment: "confirmed" });

  const idlPath = path.join(__dirname, "..", "target", "idl", "ost_token.json");
  if (!fs.existsSync(idlPath)) { console.error("IDL not found — run `anchor build` first."); process.exit(1); }
  const idl = JSON.parse(fs.readFileSync(idlPath, "utf-8"));
  const program = new Program(idl, provider);

  // Sanity: pool ATA must already exist (it does — 49,599 OST in it today).
  const ataInfo = await conn.getAccountInfo(POOL_ATA);
  if (!ataInfo) {
    console.error("Pool ATA does not exist on-chain. Aborting — wrong network?");
    process.exit(1);
  }

  const before = await getAccount(conn, POOL_ATA, "confirmed", TOKEN_2022_PROGRAM_ID);
  console.log("Pool balance before:", (Number(before.amount) / 10 ** DECIMALS).toLocaleString(), "OST\n");

  console.log("Minting…");
  const tx = await program.methods
    .confidentialMint(new BN(raw.toString()), Buffer.from([]))
    .accounts({
      admin: admin.publicKey,
      mint: MINT,
      mintAuthority: pda("mint-authority"),
      mintConfig: pda("mint-config"),
      destination: POOL_ATA,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
    })
    .rpc();
  console.log("TX:", tx);

  const after = await getAccount(conn, POOL_ATA, "confirmed", TOKEN_2022_PROGRAM_ID);
  console.log("\n✅ Pool balance after:", (Number(after.amount) / 10 ** DECIMALS).toLocaleString(), "OST");
  console.log("Explorer: https://explorer.solana.com/address/" + POOL_ATA.toBase58() + "?cluster=devnet");
}

main().catch((e) => {
  console.error("\nERROR:", e.message || e);
  if (e.logs) e.logs.forEach((l: string) => console.error("  " + l));
  process.exit(1);
});

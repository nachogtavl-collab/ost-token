// =============================================================================
// OST Token - Ensure Swap/Payout Vault Is Funded
// =============================================================================
// Checks the devnet OST payout pool and, when --confirm is passed, mints enough
// OST to bring it back to the target reserve. The script verifies the pool token
// balance delta after minting, so a transaction signature alone is not treated
// as a successful refill.
//
// Usage:
//   npx ts-node scripts/ensure-vault-funded.ts
//   npx ts-node scripts/ensure-vault-funded.ts --target 10000000000 --low-water 1000000000
//   npx ts-node scripts/ensure-vault-funded.ts --confirm
// =============================================================================

import * as anchor from "@coral-xyz/anchor";
import { AnchorProvider, Program, BN } from "@coral-xyz/anchor";
import { PublicKey, Keypair, Connection, clusterApiUrl } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, getAccount } from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";

const PROGRAM_ID = new PublicKey("J2jiS296YWVie1Sopb4SxcM3aJnP9aAwe6aLDhCqvGXY");
const MINT = new PublicKey("383pTzoZ8Gp83dzk23ZnvLcfX2Sq32TAGN48CMQu2pAJ");
const POOL_ATA = new PublicKey("5b5DBGw1DocFqFaDxukRxEv46kKGXwQQNDRkHBAwAiGK");
const TOKEN_DECIMALS = 9;
const DEFAULT_TARGET_OST = "10000000000";
const DEFAULT_LOW_WATER_OST = "1000000000";

function flagValue(name: string, fallback?: string) {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) return fallback;
  const value = process.argv[index + 1];
  return value && !value.startsWith("--") ? value : "true";
}

function decimalToRawAmount(value: string, decimals: number) {
  const places = Math.max(0, decimals || 0);
  let text = String(value || "0").trim().replace(/,/g, "");
  if (/e/i.test(text)) text = Number(text || 0).toFixed(places);
  const [wholePart = "0", fractionPart = ""] = text.split(".");
  const whole = wholePart.replace(/[^0-9]/g, "") || "0";
  let fraction = fractionPart.replace(/[^0-9]/g, "").slice(0, places);
  while (fraction.length < places) fraction += "0";
  const scale = BigInt(10) ** BigInt(places);
  return BigInt(whole) * scale + BigInt(fraction || "0");
}

function rawToOstText(raw: bigint, decimals: number) {
  const places = Math.max(0, decimals || 0);
  const scale = BigInt(10) ** BigInt(places);
  const whole = raw / scale;
  const fraction = (raw % scale).toString().padStart(places, "0").replace(/0+$/, "");
  return whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (fraction ? `.${fraction}` : "");
}

function pda(seed: string) {
  return PublicKey.findProgramAddressSync([Buffer.from(seed)], PROGRAM_ID)[0];
}

async function readPoolRaw(conn: Connection) {
  const account = await getAccount(conn, POOL_ATA, "confirmed", TOKEN_2022_PROGRAM_ID);
  return account.amount;
}

async function waitForPoolDelta(conn: Connection, beforeRaw: bigint, expectedDeltaRaw: bigint) {
  let lastRaw = beforeRaw;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    lastRaw = await readPoolRaw(conn);
    if (lastRaw - beforeRaw >= expectedDeltaRaw) return { ok: true, afterRaw: lastRaw };
    await new Promise(resolve => setTimeout(resolve, 800 + attempt * 300));
  }
  return { ok: false, afterRaw: lastRaw };
}

async function main() {
  const confirm = process.argv.includes("--confirm");
  const targetRaw = decimalToRawAmount(flagValue("target", DEFAULT_TARGET_OST) || DEFAULT_TARGET_OST, TOKEN_DECIMALS);
  const lowWaterRaw = decimalToRawAmount(flagValue("low-water", DEFAULT_LOW_WATER_OST) || DEFAULT_LOW_WATER_OST, TOKEN_DECIMALS);
  const rpc = flagValue("rpc", process.env.SOLANA_RPC || clusterApiUrl("devnet")) || clusterApiUrl("devnet");

  if (targetRaw <= BigInt(0) || lowWaterRaw <= BigInt(0)) throw new Error("target and low-water must be positive");
  if (targetRaw <= lowWaterRaw) throw new Error("target must be greater than low-water");

  const conn = new Connection(rpc, "confirmed");
  const currentRaw = await readPoolRaw(conn);

  console.log("============================================");
  console.log("  OST - Vault Funding Watchdog");
  console.log("============================================");
  console.log("Pool ATA  :", POOL_ATA.toBase58());
  console.log("Current   :", rawToOstText(currentRaw, TOKEN_DECIMALS), "OST");
  console.log("Low-water :", rawToOstText(lowWaterRaw, TOKEN_DECIMALS), "OST");
  console.log("Target    :", rawToOstText(targetRaw, TOKEN_DECIMALS), "OST");
  console.log("Mode      :", confirm ? "LIVE refill enabled" : "DRY-RUN");
  console.log("");

  if (currentRaw >= targetRaw) {
    console.log("OK: vault is already at or above target. No refill needed.");
    return;
  }

  const refillRaw = targetRaw - currentRaw;
  if (currentRaw >= lowWaterRaw) {
    console.log("Top-off available: vault is above low-water but below target.");
  }
  console.log("Refill needed:", rawToOstText(refillRaw, TOKEN_DECIMALS), "OST");
  if (!confirm) {
    console.log("Dry-run only. Re-run with --confirm to mint this refill.");
    return;
  }

  const kpPath = process.env.ANCHOR_WALLET ||
    path.join(process.env.USERPROFILE || process.env.HOME || ".", ".config", "solana", "id.json");
  if (!fs.existsSync(kpPath)) throw new Error(`Keypair not found: ${kpPath}`);
  const admin = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(kpPath, "utf-8"))));
  console.log("Admin    :", admin.publicKey.toBase58());

  const provider = new AnchorProvider(conn, new anchor.Wallet(admin), { commitment: "confirmed" });
  const idlPath = path.join(__dirname, "..", "target", "idl", "ost_token.json");
  if (!fs.existsSync(idlPath)) throw new Error("IDL not found - run `anchor build` first.");
  const idl = JSON.parse(fs.readFileSync(idlPath, "utf-8"));
  const program = new Program(idl, provider);

  const tx = await program.methods
    .confidentialMint(new BN(refillRaw.toString()), Buffer.from([]))
    .accounts({
      admin: admin.publicKey,
      mint: MINT,
      mintAuthority: pda("mint-authority"),
      mintConfig: pda("mint-config"),
      destination: POOL_ATA,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
    })
    .rpc();
  console.log("TX       :", tx);

  const verified = await waitForPoolDelta(conn, currentRaw, refillRaw);
  if (!verified.ok) {
    throw new Error(`Refill signature sent, but pool increased by only ${rawToOstText(verified.afterRaw - currentRaw, TOKEN_DECIMALS)} OST of ${rawToOstText(refillRaw, TOKEN_DECIMALS)} OST expected.`);
  }

  console.log("After    :", rawToOstText(verified.afterRaw, TOKEN_DECIMALS), "OST");
  console.log("Verified : pool balance delta covers the full refill amount.");
}

main().catch((error) => {
  console.error("ERROR:", error?.message || error);
  process.exit(1);
});
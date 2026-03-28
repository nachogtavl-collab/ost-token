// =============================================================================
// OST Token — Create Raydium CPMM Liquidity Pool (wOST/SOL)
// =============================================================================
// Creates a Constant Product Market Maker pool on Raydium for wOST/SOL trading.
// Uses wOST (standard SPL wrapper) because Token-2022 ConfidentialTransfer
// extension is not supported by AMM pools.
//
// Usage:
//   npx ts-node scripts/create-raydium-pool.ts                     # devnet
//   npx ts-node scripts/create-raydium-pool.ts --cluster mainnet   # mainnet
//   npx ts-node scripts/create-raydium-pool.ts --sol-amount 2 --ost-amount 10000  # custom
// =============================================================================

import {
  Raydium,
  TxVersion,
  parseTokenAccountResp,
  DEVNET_PROGRAM_ID,
  CREATE_CPMM_POOL_PROGRAM,
  CREATE_CPMM_POOL_FEE_ACC,
  getCpmmPdaAmmConfigId,
  DEV_API_URLS,
} from "@raydium-io/raydium-sdk-v2";
import {
  Connection,
  Keypair,
  clusterApiUrl,
  PublicKey,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import BN from "bn.js";
import * as fs from "fs";
import * as path from "path";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const cluster = (
  process.argv.includes("--cluster")
    ? process.argv[process.argv.indexOf("--cluster") + 1]
    : "devnet"
) as "mainnet" | "devnet";

const solAmountArg = process.argv.includes("--sol-amount")
  ? parseFloat(process.argv[process.argv.indexOf("--sol-amount") + 1])
  : 1; // default: 1 SOL

const ostAmountArg = process.argv.includes("--ost-amount")
  ? parseFloat(process.argv[process.argv.indexOf("--ost-amount") + 1])
  : 100_000; // default: 100k OST

const OST_DECIMALS = 9;
const SOL_DECIMALS = 9;

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log("============================================");
  console.log("  OST Token — Create Raydium CPMM Pool");
  console.log(`  Cluster:    ${cluster}`);
  console.log(`  SOL amount: ${solAmountArg} SOL`);
  console.log(`  OST amount: ${ostAmountArg.toLocaleString()} OST`);
  console.log(`  Price:      1 OST = ${(solAmountArg / ostAmountArg).toFixed(10)} SOL`);
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
  const owner = Keypair.fromSecretKey(Uint8Array.from(rawKey));
  console.log(`Owner: ${owner.publicKey.toBase58()}`);

  // Load wOST info (wrapper token for DEX trading)
  const wostInfoPath = path.join(__dirname, "..", "wost-info.json");
  if (!fs.existsSync(wostInfoPath)) {
    console.error("ERROR: wost-info.json not found. Run create-wrapper-token.ts first.");
    process.exit(1);
  }
  const wostInfo = JSON.parse(fs.readFileSync(wostInfoPath, "utf-8"));
  const ostMint = wostInfo.wostMint;
  console.log(`wOST Mint: ${ostMint}`);

  // Setup connection
  const rpcUrl =
    cluster === "mainnet"
      ? clusterApiUrl("mainnet-beta")
      : clusterApiUrl("devnet");
  const connection = new Connection(rpcUrl, "confirmed");

  const balance = await connection.getBalance(owner.publicKey);
  console.log(`Balance: ${(balance / 1e9).toFixed(4)} SOL\n`);

  if (balance / 1e9 < solAmountArg + 0.5) {
    console.error(
      `ERROR: Need at least ${solAmountArg + 0.5} SOL (${solAmountArg} for pool + 0.5 for fees)`
    );
    process.exit(1);
  }

  // Initialize Raydium SDK
  console.log("Initializing Raydium SDK...");
  const raydium = await Raydium.load({
    owner,
    connection,
    cluster,
    disableFeatureCheck: true,
    disableLoadToken: false,
    blockhashCommitment: "finalized",
    ...(cluster === "devnet"
      ? {
          urlConfigs: {
            ...DEV_API_URLS,
            BASE_HOST: "https://api-v3-devnet.raydium.io",
            OWNER_BASE_HOST: "https://owner-v1-devnet.raydium.io",
            SWAP_HOST: "https://transaction-v1-devnet.raydium.io",
            CPMM_LOCK: "https://dynamic-ipfs-devnet.raydium.io/lock/cpmm/position",
          },
        }
      : {}),
  });
  console.log("Raydium SDK loaded.\n");

  // Fetch token info
  // SOL (wrapped SOL) — standard SPL token
  const mintB = {
    address: "So11111111111111111111111111111111111111112",
    programId: TOKEN_PROGRAM_ID.toBase58(),
    decimals: SOL_DECIMALS,
  };

  // wOST — standard SPL token (wrapper for DEX compatibility)
  const mintA = {
    address: ostMint,
    programId: TOKEN_PROGRAM_ID.toBase58(),
    decimals: OST_DECIMALS,
  };

  console.log("Token A (OST):", mintA.address);
  console.log("Token B (SOL):", mintB.address);

  // Get fee configs
  console.log("\nFetching fee configs...");
  const feeConfigs = await raydium.api.getCpmmConfigs();

  if (cluster === "devnet") {
    feeConfigs.forEach((config) => {
      config.id = getCpmmPdaAmmConfigId(
        DEVNET_PROGRAM_ID.CREATE_CPMM_POOL_PROGRAM,
        config.index
      ).publicKey.toBase58();
    });
  }

  console.log(`Found ${feeConfigs.length} fee configs.`);
  if (feeConfigs.length > 0) {
    console.log(`Using fee config: ${feeConfigs[0].id} (trade fee: ${feeConfigs[0].tradeFeeRate})`);
  }

  // Calculate raw amounts
  const ostRaw = new BN(
    BigInt(Math.floor(ostAmountArg * 10 ** OST_DECIMALS)).toString()
  );
  const solRaw = new BN(
    BigInt(Math.floor(solAmountArg * 10 ** SOL_DECIMALS)).toString()
  );

  console.log(`\nCreating CPMM pool...`);
  console.log(`  OST: ${ostAmountArg.toLocaleString()} (raw: ${ostRaw.toString()})`);
  console.log(`  SOL: ${solAmountArg} (raw: ${solRaw.toString()})`);

  // Create pool
  const { execute, extInfo } = await raydium.cpmm.createPool({
    programId:
      cluster === "devnet"
        ? DEVNET_PROGRAM_ID.CREATE_CPMM_POOL_PROGRAM
        : CREATE_CPMM_POOL_PROGRAM,
    poolFeeAccount:
      cluster === "devnet"
        ? DEVNET_PROGRAM_ID.CREATE_CPMM_POOL_FEE_ACC
        : CREATE_CPMM_POOL_FEE_ACC,
    mintA,
    mintB,
    mintAAmount: ostRaw,
    mintBAmount: solRaw,
    startTime: new BN(0),
    feeConfig: feeConfigs[0],
    associatedOnly: false,
    ownerInfo: {
      useSOLBalance: true,
    },
    txVersion: TxVersion.V0,
  });

  console.log("\nSending transaction...");
  const { txId } = await execute({ sendAndConfirm: true });

  const poolKeys = Object.keys(extInfo.address).reduce(
    (acc, cur) => ({
      ...acc,
      [cur]: extInfo.address[cur as keyof typeof extInfo.address].toString(),
    }),
    {} as Record<string, string>
  );

  console.log("\n============================================");
  console.log("  ✅ Raydium CPMM Pool Created!");
  console.log("============================================");
  console.log(`  TX:        ${txId}`);
  console.log(`  Pool ID:   ${poolKeys.poolId || "see tx"}`);
  console.log(`  OST Mint:  ${ostMint}`);
  console.log(`  SOL Mint:  So111...112`);
  console.log(`  OST/SOL:   ${ostAmountArg.toLocaleString()} / ${solAmountArg}`);
  console.log(`  Cluster:   ${cluster}`);
  console.log("============================================");

  // Save pool info
  const poolInfo = {
    poolId: poolKeys.poolId || txId,
    txId,
    mintA: ostMint,
    mintB: "So11111111111111111111111111111111111111112",
    amountA: ostAmountArg,
    amountB: solAmountArg,
    cluster,
    createdAt: new Date().toISOString(),
    poolKeys,
  };
  const poolInfoPath = path.join(__dirname, "..", "pool-info.json");
  fs.writeFileSync(poolInfoPath, JSON.stringify(poolInfo, null, 2));
  console.log(`\nPool info saved to pool-info.json`);

  console.log("\nNext steps:");
  console.log("  1. Anyone can now swap OST/SOL on Raydium");
  console.log("  2. Submit to Jupiter token list for wider visibility");
  console.log("  3. Share pool link with community");
  if (cluster === "devnet") {
    console.log(`  4. Raydium devnet: https://devnet.raydium.io/swap`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

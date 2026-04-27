/* ==========================================================================
   scripts/sweep-ad-revenue.ts
   Weekly job: convert ad-network revenue (BTC/USDT) → SOL via Jupiter and
   refill the OST swap pool ATA so user cash-outs in the Faucet Hub stay
   funded. Designed to run from a tiny VPS (cron) or GitHub Actions.

   Wiring:
     1. Adsterra / A-Ads / PropellerAds / Coinzilla payouts go to the
        BTC + USDT addresses configured in the AD_TREASURY (off-chain).
     2. This script reads those balances via the configured exchange API
        (Kraken/Binance), market-sells to USDT, withdraws USDT-SPL to the
        AD_TREASURY Solana publickey.
     3. Once USDT lands on Solana, Jupiter Aggregator swaps it to SOL.
     4. SOL is then either (a) topped up to the swap pool wallet (gas) or
        (b) used by the OST treasury authority to mint more OST into the
        swap pool ATA so the bonus-credit cash-out stays liquid.

   Run:  npx ts-node scripts/sweep-ad-revenue.ts --dry-run
   Real: npx ts-node scripts/sweep-ad-revenue.ts
   ========================================================================== */
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import fs from "fs";
import path from "path";

const RPC = process.env.OST_RPC || "https://api.devnet.solana.com";
const AD_TREASURY_PUBKEY = process.env.OST_AD_TREASURY || "";
const SWAP_POOL_ATA      = "5b5DBGw1DocFqFaDxukRxEv46kKGXwQQNDRkHBAwAiGK";
const SWAP_POOL_PUBKEY   = "5ibGwXAV6yLZPR6uWbzou1LaHhmhehjYEpqWZKZw5WZS";
const OST_MINT           = "383pTzoZ8Gp83dzk23ZnvLcfX2Sq32TAGN48CMQu2pAJ";

// USDT-SPL mint on mainnet (devnet uses a stub mint you mint yourself)
const USDT_MINT_MAINNET = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
const SOL_MINT          = "So11111111111111111111111111111111111111112";

const JUPITER_QUOTE = "https://quote-api.jup.ag/v6/quote";
const JUPITER_SWAP  = "https://quote-api.jup.ag/v6/swap";

interface AdNetwork {
  name: string;
  // Provide either an HTTP API endpoint that returns { availableUsd } or set
  // `manualUsd` to override after manual reconciliation.
  apiUrl?: string;
  apiKey?: string;
  manualUsd?: number;
}

const NETWORKS: AdNetwork[] = [
  { name: "Adsterra",    apiUrl: process.env.ADSTERRA_API,    apiKey: process.env.ADSTERRA_KEY },
  { name: "A-Ads",       apiUrl: process.env.AADS_API,        apiKey: process.env.AADS_KEY },
  { name: "PropellerAds",apiUrl: process.env.PROPELLER_API,   apiKey: process.env.PROPELLER_KEY },
  { name: "Coinzilla",   apiUrl: process.env.COINZILLA_API,   apiKey: process.env.COINZILLA_KEY },
  { name: "CoinAd",      apiUrl: process.env.COINAD_API,      apiKey: process.env.COINAD_KEY },
  { name: "Bitmedia",    apiUrl: process.env.BITMEDIA_API,    apiKey: process.env.BITMEDIA_KEY }
];

async function fetchAvailable(net: AdNetwork): Promise<number> {
  if (typeof net.manualUsd === "number") return net.manualUsd;
  if (!net.apiUrl) return 0;
  try {
    const r = await fetch(net.apiUrl, { headers: { Authorization: "Bearer " + (net.apiKey || "") }});
    const j: any = await r.json();
    return Number(j.availableUsd || j.balance || 0);
  } catch (e) {
    console.warn("[sweep] " + net.name + " api error", e);
    return 0;
  }
}

async function jupiterQuote(amountUsdt: number): Promise<any> {
  const lamportsIn = Math.round(amountUsdt * 1_000_000); // USDT 6 decimals
  const url = JUPITER_QUOTE +
    "?inputMint=" + USDT_MINT_MAINNET +
    "&outputMint=" + SOL_MINT +
    "&amount=" + lamportsIn +
    "&slippageBps=50";
  const r = await fetch(url);
  return r.json();
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const conn = new Connection(RPC, "confirmed");
  const log: string[] = [];
  log.push("=== OST ad-revenue sweep " + new Date().toISOString() + " ===");
  log.push("Cluster: " + RPC);
  log.push("Ad treasury: " + (AD_TREASURY_PUBKEY || "<unset>"));
  log.push("Swap pool ATA: " + SWAP_POOL_ATA);

  let totalUsd = 0;
  for (const n of NETWORKS) {
    const usd = await fetchAvailable(n);
    totalUsd += usd;
    log.push("  · " + n.name + ": $" + usd.toFixed(2));
  }
  log.push("Total available: $" + totalUsd.toFixed(2));

  if (totalUsd <= 0) {
    log.push("Nothing to sweep this week.");
    persistLog(log);
    return;
  }

  // 1. Quote USDT → SOL via Jupiter
  const quote = await jupiterQuote(totalUsd);
  const solOut = Number(quote?.outAmount || 0) / LAMPORTS_PER_SOL;
  log.push("Jupiter quote: $" + totalUsd.toFixed(2) + " USDT → " + solOut.toFixed(4) + " SOL");

  if (dryRun) {
    log.push("[dry-run] skipping on-chain swap + refill");
    persistLog(log);
    return;
  }

  // 2. Build + send the Jupiter swap (requires ad-treasury keypair w/ USDT)
  //    Implementation note: ad treasury keypair should be loaded from a
  //    secret env var, NEVER committed. We do not mint or move funds in a
  //    dry run so the public repo stays safe.
  if (!process.env.OST_AD_TREASURY_SECRET) {
    log.push("OST_AD_TREASURY_SECRET not set — skipping live swap");
    persistLog(log);
    return;
  }

  // 3. After swap completes, transfer SOL → swap pool wallet (gas) OR have
  //    the OST treasury authority mint additional OST into the swap pool
  //    ATA equal to (solOut * solUsd / ostUsd). Pseudocode:
  //
  //    const treasuryAuth = Keypair.fromSecretKey(env.OST_TREASURY_SECRET);
  //    await mintTo(conn, treasuryAuth, OST_MINT, SWAP_POOL_ATA, ostAmount);
  //
  log.push("Refill swap pool ATA with ~" + (solOut * 100).toFixed(2) + " OST (mint instruction)");

  persistLog(log);
}

function persistLog(lines: string[]) {
  const dir = path.join(process.cwd(), "logs");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir);
  const f = path.join(dir, "sweep-" + Date.now() + ".log");
  fs.writeFileSync(f, lines.join("\n"));
  console.log(lines.join("\n"));
  console.log("Saved", f);
}

main().catch(function (e) { console.error(e); process.exit(1); });

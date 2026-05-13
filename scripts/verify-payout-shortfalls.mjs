#!/usr/bin/env node
// =============================================================================
// OST Token - Verify Payout Shortfalls (READ-ONLY)
// =============================================================================
// Builds a payable recovery report from a prior lost-payout report. For each
// payout claim, it verifies the original transaction's recipient balance delta,
// subtracts any already-successful reissue logged against the same claim, and
// outputs only the remaining amount still owed.
//
// Usage:
//   node scripts/verify-payout-shortfalls.mjs --report reports/lost-ost-XYZ.json
// =============================================================================

import { Connection } from "@solana/web3.js";
import fs from "node:fs";
import path from "node:path";

const OST_MINT = "383pTzoZ8Gp83dzk23ZnvLcfX2Sq32TAGN48CMQu2pAJ";
const API = (process.env.OST_API || "https://ost-api.nachogtavl.workers.dev").replace(/\/+$/, "");
const RPC_ENDPOINTS = (process.env.SOLANA_RPC_LIST || process.env.SOLANA_RPC || "https://api.devnet.solana.com,https://devnet.helius-rpc.com/?api-key=public")
  .split(",")
  .map(value => value.trim())
  .filter(Boolean);

const PAYOUT_KINDS = new Set([
  "faucet-hub-cashout",
  "faucet-claim",
  "faucet-daily",
  "faucet-welcome",
  "prediction-settlement",
  "prediction-cashout",
  "prediction-sell",
  "stock-sell",
  "stock-payout",
  "stock-mirror-close",
  "ost-topup",
  "topup-claim",
  "topup-delivery",
  "game-win",
  "ost-games-win",
  "games-cashout",
  "fair-game-cashout",
  "fair-game-win",
  "apple-tap-win",
  "code-academy-reward",
  "memecoin-sell"
]);

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, arg, index, argv) => {
  if (arg.startsWith("--")) acc.push([arg.slice(2), argv[index + 1] && !argv[index + 1].startsWith("--") ? argv[index + 1] : true]);
  return acc;
}, []));

if (!args.report) {
  console.error("Missing --report <path>");
  process.exit(2);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function rawToOst(raw, decimals = 9) {
  return Number(raw) / Math.pow(10, decimals);
}

function roundOst(value) {
  return Number(Math.max(0, Number(value || 0)).toFixed(9));
}

function tokenRecipientDelta(tx, wallet) {
  if (!tx || !tx.meta || tx.meta.err) return { paidOstAmount: 0, error: tx?.meta?.err || "missing_tx" };
  const pre = tx.meta.preTokenBalances || [];
  const post = tx.meta.postTokenBalances || [];
  let paidRaw = BigInt(0);
  for (const after of post) {
    if (after.mint !== OST_MINT) continue;
    if (after.owner !== wallet) continue;
    const before = pre.find(item => item.accountIndex === after.accountIndex);
    const beforeRaw = BigInt(before?.uiTokenAmount?.amount || "0");
    const afterRaw = BigInt(after?.uiTokenAmount?.amount || "0");
    if (afterRaw > beforeRaw) paidRaw += afterRaw - beforeRaw;
  }
  return { paidOstAmount: rawToOst(paidRaw), error: "" };
}

const txCache = new Map();
async function fetchTx(signature) {
  if (!signature) return { tx: null, rpc: "", error: "missing signature" };
  if (txCache.has(signature)) return txCache.get(signature);
  let lastError = null;
  for (let round = 0; round < 4; round += 1) {
    for (const endpoint of RPC_ENDPOINTS) {
      const conn = new Connection(endpoint, "confirmed");
      try {
        const tx = await conn.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
        if (tx) {
          const result = { tx, rpc: endpoint, error: "" };
          txCache.set(signature, result);
          return result;
        }
        lastError = new Error("transaction not found");
      } catch (error) {
        lastError = error;
      }
      await sleep(250 + round * 250);
    }
  }
  const result = { tx: null, rpc: "", error: lastError?.message || String(lastError || "not found") };
  txCache.set(signature, result);
  return result;
}

const auditCache = new Map();
const usedReissueSigsByWallet = new Map();
let localReissueRecords = null;
async function fetchWalletAudit(wallet) {
  if (auditCache.has(wallet)) return auditCache.get(wallet);
  const response = await fetch(`${API}/wallet/payouts/${wallet}`).catch(() => null);
  const body = response && response.ok ? await response.json().catch(() => ({})) : {};
  const payouts = Array.isArray(body.payouts) ? body.payouts : [];
  auditCache.set(wallet, payouts);
  return payouts;
}

function loadLocalReissueRecords() {
  if (localReissueRecords) return localReissueRecords;
  const reportDir = path.join(process.cwd(), "reports");
  const bySig = new Map();
  if (!fs.existsSync(reportDir)) {
    localReissueRecords = [];
    return localReissueRecords;
  }
  for (const name of fs.readdirSync(reportDir)) {
    if (!/^reissue-.*\.json$/i.test(name)) continue;
    const filePath = path.join(reportDir, name);
    let report = null;
    try {
      report = JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch {
      continue;
    }
    if (report?.confirm !== true) continue;
    const ok = Array.isArray(report?.results?.ok) ? report.results.ok : [];
    for (const item of ok) {
      const sig = String(item?.sig || "");
      const wallet = String(item?.wallet || "");
      const amount = Number(item?.ostAmount || 0);
      if (!sig || !wallet || amount <= 0) continue;
      bySig.set(sig, {
        stage: "result",
        kind: "reissue",
        wallet,
        ostAmount: amount,
        sig,
        ref: String(item?.claimSig || ""),
        source: path.relative(process.cwd(), filePath)
      });
    }
  }
  localReissueRecords = [...bySig.values()];
  return localReissueRecords;
}

async function verifiedReissuedAmount(wallet, claimSig, expectedAmount) {
  const payouts = await fetchWalletAudit(wallet);
  const used = usedReissueSigsByWallet.get(wallet) || new Set();
  const bySig = new Map();
  for (const record of [...payouts, ...loadLocalReissueRecords().filter(record => record.wallet === wallet)]) {
    if (record?.sig) bySig.set(String(record.sig), record);
  }
  const resultRecords = [...bySig.values()].filter(record =>
    record &&
    String(record.stage || "") === "result" &&
    String(record.kind || "") === "reissue" &&
    String(record.sig || "")
  );
  const linked = claimSig
    ? resultRecords.filter(record => String(record.ref || "") === claimSig)
    : [];
  const unlinked = resultRecords.filter(record => {
    if (String(record.ref || "")) return false;
    if (used.has(String(record.sig || ""))) return false;
    return Math.abs(Number(record.ostAmount || 0) - Number(expectedAmount || 0)) < 0.000001;
  });
  const matches = linked.length ? linked : unlinked;
  let total = 0;
  for (const record of matches) {
    if (used.has(String(record.sig || ""))) continue;
    const fetched = await fetchTx(record.sig);
    const delta = tokenRecipientDelta(fetched.tx, wallet);
    const remaining = Math.max(0, Number(expectedAmount || 0) - total);
    const received = Math.min(Number(record.ostAmount || 0), Number(delta.paidOstAmount || 0), remaining);
    if (received > 0) {
      total += received;
      used.add(String(record.sig || ""));
    }
    if (total >= Number(expectedAmount || 0) - 0.000000001) break;
  }
  usedReissueSigsByWallet.set(wallet, used);
  return total;
}

const sourceReport = JSON.parse(fs.readFileSync(args.report, "utf8"));
const candidates = (sourceReport.items || []).filter(item => {
  const kind = String(item.kind || "").toLowerCase();
  if (!PAYOUT_KINDS.has(kind)) return false;
  return Number(item.expectedOstAmount || item.ostAmount || 0) > 0;
});

console.log("============================================");
console.log("  OST - Verify Payout Shortfalls");
console.log("============================================");
console.log("Report    :", args.report);
console.log("Candidates:", candidates.length);
console.log("RPCs      :", RPC_ENDPOINTS.join(", "));
console.log("");

const checked = [];
const owedItems = [];
for (let index = 0; index < candidates.length; index += 1) {
  const item = candidates[index];
  const expected = Number(item.expectedOstAmount || item.ostAmount || 0);
  const wallet = String(item.wallet || "");
  const claimSig = String(item.claimSig || item.sig || "");
  process.stdout.write(`[${index + 1}/${candidates.length}] ${wallet.slice(0, 6)}...${wallet.slice(-4)} ${expected.toFixed(6)} OST ${item.kind} `);
  const fetched = await fetchTx(claimSig);
  const originalDelta = tokenRecipientDelta(fetched.tx, wallet);
  const originalPaid = Number(originalDelta.paidOstAmount || 0);
  const alreadyReissued = await verifiedReissuedAmount(wallet, claimSig, expected);
  const owed = roundOst(expected - originalPaid - alreadyReissued);
  const record = {
    wallet,
    kind: item.kind,
    ostAmount: owed,
    expectedOstAmount: roundOst(expected),
    paidOstAmount: roundOst(originalPaid),
    reissuedOstAmount: roundOst(alreadyReissued),
    claimSig,
    claimTs: item.claimTs || 0,
    claimTsIso: item.claimTsIso || "",
    memo: item.memo || "",
    sourceReport: path.relative(process.cwd(), args.report),
    verification: {
      originalTxFound: Boolean(fetched.tx),
      originalTxError: fetched.error || originalDelta.error || "",
      rpc: fetched.rpc || ""
    }
  };
  checked.push(record);
  if (owed > 0.000000001) owedItems.push(record);
  console.log(owed > 0.000000001 ? `OWED ${owed.toFixed(6)} OST` : "COVERED");
}

const perWallet = owedItems.reduce((map, item) => {
  if (!map[item.wallet]) map[item.wallet] = { wallet: item.wallet, totalOwed: 0, claims: [] };
  map[item.wallet].totalOwed = roundOst(map[item.wallet].totalOwed + item.ostAmount);
  map[item.wallet].claims.push(item);
  return map;
}, {});
const total = owedItems.reduce((sum, item) => sum + item.ostAmount, 0);
const outDir = path.join(process.cwd(), "reports");
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);
const out = path.join(outDir, `payout-shortfalls-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
const report = {
  generatedAt: new Date().toISOString(),
  sourceReport: path.relative(process.cwd(), args.report),
  type: "payout-shortfalls",
  checkedCount: checked.length,
  lostCount: owedItems.length,
  totalOstOwed: roundOst(total),
  walletsChecked: new Set(candidates.map(item => item.wallet)).size,
  affectedWallets: Object.keys(perWallet).length,
  checkedItems: checked,
  perWallet,
  items: owedItems
};
fs.writeFileSync(out, JSON.stringify(report, null, 2));

console.log("");
console.log("============================================");
console.log("  Shortfall verification complete");
console.log("============================================");
console.log("Checked items   :", checked.length);
console.log("Shortfall items :", owedItems.length);
console.log("Affected wallets:", Object.keys(perWallet).length);
console.log("Total OST owed  :", report.totalOstOwed);
console.log("Output          :", path.relative(process.cwd(), out));
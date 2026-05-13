#!/usr/bin/env node
// =============================================================================
// OST Token - Verify Prediction Payout Shortfalls (READ-ONLY)
// =============================================================================
// Consumes a lost-payout report or fetches wallet-event prediction payout claims,
// then checks each claimed signature on-chain. A claim is only considered paid
// for the OST amount that actually increased the recipient wallet balance.
//
// Usage:
//   node scripts/verify-prediction-payouts.mjs --report reports/lost-ost-XYZ.json
//   node scripts/verify-prediction-payouts.mjs --wallets <wallet1,wallet2> --since 2026-05-13
// =============================================================================

import { Connection, PublicKey } from "@solana/web3.js";
import fs from "node:fs";
import path from "node:path";

const OST_MINT = "383pTzoZ8Gp83dzk23ZnvLcfX2Sq32TAGN48CMQu2pAJ";
const API = (process.env.OST_API || "https://ost-api.nachogtavl.workers.dev").replace(/\/+$/, "");
const RPC_ENDPOINTS = (process.env.SOLANA_RPC_LIST || process.env.SOLANA_RPC || "https://api.devnet.solana.com,https://devnet.helius-rpc.com/?api-key=public")
  .split(",")
  .map(value => value.trim())
  .filter(Boolean);

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, arg, index, argv) => {
  if (arg.startsWith("--")) acc.push([arg.slice(2), argv[index + 1] && !argv[index + 1].startsWith("--") ? argv[index + 1] : true]);
  return acc;
}, []));

if (!args.report && !args.wallets && !args.wallet) {
  console.error("Missing --report <path> or --wallets <comma-separated wallets>");
  process.exit(2);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function rawToOst(raw, decimals = 9) {
  return Number(raw) / Math.pow(10, decimals);
}

function txRecipientDelta(tx, wallet) {
  if (!tx || !tx.meta || tx.meta.err) return { paidOstAmount: 0, err: tx?.meta?.err || "missing_tx" };
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
  return { paidOstAmount: rawToOst(paidRaw) };
}

async function fetchTx(signature) {
  if (!signature) return { tx: null, rpc: "", error: "missing signature" };
  let lastError = null;
  for (let round = 0; round < 4; round += 1) {
    for (const endpoint of RPC_ENDPOINTS) {
      const conn = new Connection(endpoint, "confirmed");
      try {
        const tx = await conn.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
        if (tx) return { tx, rpc: endpoint, error: "" };
        lastError = new Error("transaction not found");
      } catch (error) {
        lastError = error;
      }
      await sleep(250 + round * 250);
    }
  }
  return { tx: null, rpc: "", error: lastError?.message || String(lastError || "not found") };
}

async function fetchWalletPredictionClaims(wallet, sinceTs) {
  const response = await fetch(`${API}/wallet/events/${wallet}?limit=500`).catch(() => null);
  if (!response || !response.ok) return [];
  const body = await response.json().catch(() => ({}));
  return (body.events || []).filter(event => {
    const kind = String(event.kind || event.source || "").toLowerCase();
    if (!/^prediction-(sell|settlement|cashout)$/.test(kind)) return false;
    if (Number(event.amount || 0) <= 0) return false;
    if (sinceTs && Number(event.ts || 0) < sinceTs) return false;
    return true;
  }).map(event => ({
    wallet,
    kind: event.kind || event.source || "prediction-payout",
    ostAmount: Number(event.amount || 0),
    claimSig: event.sig || event.signature || "",
    claimTs: Number(event.ts || 0),
    claimTsIso: event.ts ? new Date(Number(event.ts)).toISOString() : "",
    memo: event.label || event.memo || "",
    sourceLedger: "wallet-events"
  }));
}

async function loadCandidates() {
  if (args.report) {
    const sourceReport = JSON.parse(fs.readFileSync(args.report, "utf8"));
    return {
      source: path.relative(process.cwd(), args.report),
      candidates: (sourceReport.items || []).filter(item => /^prediction-(sell|settlement|cashout)/i.test(String(item.kind || "")))
    };
  }
  const sinceTs = args.since ? Date.parse(String(args.since)) : 0;
  const wallets = String(args.wallets || args.wallet || "").split(",").map(value => value.trim()).filter(Boolean);
  const claims = [];
  for (const wallet of wallets) claims.push(...await fetchWalletPredictionClaims(wallet, sinceTs));
  return { source: `wallet-events since ${sinceTs ? new Date(sinceTs).toISOString() : "beginning"}`, candidates: claims };
}

const loaded = await loadCandidates();
const candidates = loaded.candidates;
const verified = [];
const checked = [];

console.log("============================================");
console.log("  OST - Verify Prediction Payout Shortfalls");
console.log("============================================");
console.log("Source    :", loaded.source);
console.log("Candidates:", candidates.length);
console.log("RPCs      :", RPC_ENDPOINTS.join(", "));
console.log("");

for (let index = 0; index < candidates.length; index += 1) {
  const item = candidates[index];
  const expected = Number(item.expectedOstAmount || item.ostAmount || 0);
  process.stdout.write(`[${index + 1}/${candidates.length}] ${item.wallet.slice(0, 6)}...${item.wallet.slice(-4)} ${expected.toFixed(6)} OST ${item.kind} `);
  const fetched = await fetchTx(item.claimSig || "");
  const delta = txRecipientDelta(fetched.tx, item.wallet);
  const paid = Number(delta.paidOstAmount || 0);
  const owed = Math.max(0, expected - paid);
  const record = {
    wallet: item.wallet,
    kind: item.kind,
    ostAmount: Number(owed.toFixed(9)),
    expectedOstAmount: Number(expected.toFixed(9)),
    paidOstAmount: Number(paid.toFixed(9)),
    claimSig: item.claimSig || "",
    claimTs: item.claimTs || 0,
    claimTsIso: item.claimTsIso || "",
    memo: item.memo || "",
    source: item.sourceLedger || loaded.source,
    verification: {
      txFound: Boolean(fetched.tx),
      txError: fetched.error || (delta.err ? JSON.stringify(delta.err) : ""),
      rpc: fetched.rpc || ""
    }
  };
  checked.push(record);
  if (record.ostAmount > 0.000000001) verified.push(record);
  console.log(record.ostAmount > 0.000000001 ? `OWED ${record.ostAmount.toFixed(6)} OST` : "PAID");
}

const perWallet = verified.reduce((map, item) => {
  if (!map[item.wallet]) map[item.wallet] = { wallet: item.wallet, totalOwed: 0, claims: [] };
  map[item.wallet].totalOwed = Number((map[item.wallet].totalOwed + item.ostAmount).toFixed(9));
  map[item.wallet].claims.push(item);
  return map;
}, {});
const total = verified.reduce((sum, item) => sum + item.ostAmount, 0);
const outDir = path.join(process.cwd(), "reports");
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);
const out = path.join(outDir, `prediction-shortfalls-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
const report = {
  generatedAt: new Date().toISOString(),
  source: loaded.source,
  type: "prediction-payout-shortfalls",
  checkedCount: checked.length,
  lostCount: verified.length,
  totalOstOwed: Number(total.toFixed(9)),
  walletsChecked: new Set(candidates.map(item => item.wallet)).size,
  affectedWallets: Object.keys(perWallet).length,
  checkedItems: checked,
  perWallet,
  items: verified
};
fs.writeFileSync(out, JSON.stringify(report, null, 2));

console.log("");
console.log("============================================");
console.log("  Prediction verification complete");
console.log("============================================");
console.log("Shortfall items :", verified.length);
console.log("Affected wallets:", Object.keys(perWallet).length);
console.log("Total OST owed  :", report.totalOstOwed);
console.log("Output          :", path.relative(process.cwd(), out));

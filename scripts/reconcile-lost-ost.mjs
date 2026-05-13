#!/usr/bin/env node
// =============================================================================
// OST Token — Lost-Payout Reconciliation (READ-ONLY)
// =============================================================================
// Cross-references local/server "we paid you" records against actual on-chain
// pool transfers, identifying every wallet that was debited locally but did
// not receive OST from the pool.
//
// Caused by the silent confirmTransaction.catch(()=>{}) bug in
// site/devnet-rescue.js (fixed in commit 9f35f04 on 2026-05-13). Any payout
// that failed on-chain or got dropped before landing left OST in the pool
// while the user's local credits were debited.
//
// THIS SCRIPT DOES NOT MOVE FUNDS. It produces a JSON report. A separate
// script (reissue-lost-ost.mjs) consumes the report to re-pay users — that
// step requires explicit human approval.
//
// Usage:
//   node scripts/reconcile-lost-ost.mjs                  # all surfaces
//   node scripts/reconcile-lost-ost.mjs --since 2026-04-01
//   node scripts/reconcile-lost-ost.mjs --wallet <pk>    # single user
//
// Outputs:
//   reports/lost-ost-<timestamp>.json
// =============================================================================

import { Connection, PublicKey } from "@solana/web3.js";
import fs from "node:fs";
import path from "node:path";

const POOL_PUBKEY = new PublicKey("5ibGwXAV6yLZPR6uWbzou1LaHhmhehjYEpqWZKZw5WZS");
const POOL_ATA    = new PublicKey("5b5DBGw1DocFqFaDxukRxEv46kKGXwQQNDRkHBAwAiGK");
const OST_MINT    = new PublicKey("383pTzoZ8Gp83dzk23ZnvLcfX2Sq32TAGN48CMQu2pAJ");
const RPC         = process.env.SOLANA_RPC || "https://api.devnet.solana.com";
const API         = (process.env.OST_API || "https://ost-api.nachogtavl.workers.dev").replace(/\/+$/, "");

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => {
  if (a.startsWith("--")) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith("--") ? arr[i + 1] : true]);
  return acc;
}, []));

const sinceTs = args.since ? Date.parse(args.since) : Date.now() - 60 * 24 * 60 * 60 * 1000;
const onlyWallet = args.wallet || null;

console.log("============================================");
console.log("  OST · Lost Payout Reconciliation (READ-ONLY)");
console.log("============================================");
console.log("RPC          :", RPC);
console.log("Worker API   :", API);
console.log("Pool ATA     :", POOL_ATA.toBase58());
console.log("Since        :", new Date(sinceTs).toISOString());
if (onlyWallet) console.log("Filter wallet:", onlyWallet);
console.log("");

const conn = new Connection(RPC, "confirmed");

// ── Step 1: pull all on-chain pool transfers since `since` ──────────────────
async function fetchPoolHistory() {
  console.log("[1/4] Pulling on-chain pool transfer history…");
  const sigs = [];
  let before;
  while (true) {
    const batch = await conn.getSignaturesForAddress(POOL_PUBKEY, { limit: 1000, before });
    if (!batch.length) break;
    for (const s of batch) {
      if ((s.blockTime || 0) * 1000 < sinceTs) return sigs;
      sigs.push(s);
    }
    before = batch[batch.length - 1].signature;
    if (batch.length < 1000) break;
  }
  return sigs;
}

// Parse a tx and extract { recipient, amountOst, memo, sig, ts } if it's a
// pool→user OST transferChecked (token-2022).
async function parsePayoutTx(sigInfo) {
  try {
    const tx = await conn.getTransaction(sigInfo.signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    if (!tx || !tx.meta || tx.meta.err) return null;
    const pre = tx.meta.preTokenBalances || [];
    const post = tx.meta.postTokenBalances || [];
    // Find an account whose OST balance increased and is NOT the pool ATA
    let recipient = null;
    let deltaUi = 0;
    for (const p of post) {
      if (p.mint !== OST_MINT.toBase58()) continue;
      if (p.owner === POOL_PUBKEY.toBase58()) continue;
      const prev = pre.find(x => x.accountIndex === p.accountIndex);
      const beforeAmt = prev ? Number(prev.uiTokenAmount.uiAmountString || 0) : 0;
      const afterAmt = Number(p.uiTokenAmount.uiAmountString || 0);
      if (afterAmt > beforeAmt) { recipient = p.owner; deltaUi = afterAmt - beforeAmt; break; }
    }
    if (!recipient) return null;
    let memo = "";
    for (const log of (tx.meta.logMessages || [])) {
      const m = log.match(/Program log: Memo \(len \d+\): "(.*)"$/);
      if (m) { memo = m[1]; break; }
    }
    return {
      sig: sigInfo.signature,
      recipient,
      ostAmount: deltaUi,
      memo,
      ts: (sigInfo.blockTime || 0) * 1000
    };
  } catch (_) { return null; }
}

// ── Step 2: pull "we paid you" claims from worker KV ─────────────────────────
// Only event kinds that represent pool→user transfers count as a "claim we
// owe". Buys / stakes / fees are user→pool and must be excluded.
const PAYOUT_KINDS = new Set([
  "faucet-hub-cashout",
  "faucet-claim",
  "prediction-settlement",
  "prediction-cashout",
  "prediction-sell",
  "stock-sell",
  "stock-payout",
  "ost-topup",
  "topup-claim",
  "topup-delivery",
  "game-win",
  "ost-games-win",
  "apple-tap-win",
  "code-academy-reward",
  "memecoin-sell",
  "reissue"
]);

async function fetchWalletClaims(wallet) {
  const r = await fetch(`${API}/wallet/events/${wallet}?limit=500`).catch(() => null);
  if (!r || !r.ok) return [];
  const j = await r.json().catch(() => ({}));
  return (j.events || []).filter(e => {
    if (!e || Number(e.amount || 0) <= 0) return false;
    if ((e.ts || 0) < sinceTs) return false;
    const kind = String(e.kind || e.source || "").toLowerCase();
    return PAYOUT_KINDS.has(kind);
  });
}

async function fetchAllAffectedWallets() {
  // The worker doesn't index wallets directly, so we derive them from the
  // recent payouts tail (post-fix audit ledger) PLUS the on-chain pool
  // history (every recipient who ever received OST is a candidate to check).
  const wallets = new Set();
  if (onlyWallet) { wallets.add(onlyWallet); return [...wallets]; }
  try {
    const r = await fetch(`${API}/wallet/payouts/recent?limit=500`);
    if (r.ok) {
      const j = await r.json();
      for (const e of (j.recent || [])) if (e && e.wallet) wallets.add(e.wallet);
    }
  } catch (_) {}
  return [...wallets];
}

(async () => {
  const poolSigs = await fetchPoolHistory();
  console.log("       on-chain pool signatures:", poolSigs.length);

  console.log("[2/4] Parsing pool transfers (this is the slow step)…");
  const onChainPayouts = [];
  for (let i = 0; i < poolSigs.length; i++) {
    const p = await parsePayoutTx(poolSigs[i]);
    if (p) onChainPayouts.push(p);
    if (i % 50 === 0) process.stdout.write(`         parsed ${i}/${poolSigs.length}\r`);
  }
  console.log(`         parsed ${poolSigs.length}/${poolSigs.length}`);
  console.log("       on-chain payouts to users:", onChainPayouts.length);

  // Index by recipient → list of {ostAmount, ts, sig}
  const byRecipient = new Map();
  for (const p of onChainPayouts) {
    if (!byRecipient.has(p.recipient)) byRecipient.set(p.recipient, []);
    byRecipient.get(p.recipient).push(p);
  }

  console.log("[3/4] Pulling worker-side payout claims…");
  const wallets = onlyWallet ? [onlyWallet] : [...new Set([...byRecipient.keys(), ...(await fetchAllAffectedWallets())])];
  console.log("       wallets to check:", wallets.length);

  const lost = [];
  for (const w of wallets) {
    const claims = await fetchWalletClaims(w);
    if (!claims.length) continue;
    const onChain = byRecipient.get(w) || [];
    // Greedy match: each on-chain transfer satisfies at most one claim with
    // the same amount within ±5 minutes. Unmatched claims → lost.
    const used = new Set();
    for (const cl of claims) {
      const amt = Number(cl.amount || 0);
      const ts = Number(cl.ts || 0);
      const match = onChain.find((p, idx) =>
        !used.has(idx) &&
        Math.abs(p.ostAmount - amt) < 0.0001 &&
        Math.abs(p.ts - ts) < 5 * 60 * 1000
      );
      if (match) {
        used.add(onChain.indexOf(match));
      } else {
        lost.push({
          wallet: w,
          kind: cl.kind || cl.source || "unknown",
          ostAmount: amt,
          claimSig: cl.sig || "",
          claimTs: ts,
          claimTsIso: ts ? new Date(ts).toISOString() : "",
          memo: cl.label || cl.memo || ""
        });
      }
    }
  }

  console.log("[4/4] Writing report…");
  const reportDir = path.join(process.cwd(), "reports");
  if (!fs.existsSync(reportDir)) fs.mkdirSync(reportDir);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(reportDir, `lost-ost-${stamp}.json`);
  const totalLost = lost.reduce((a, b) => a + b.ostAmount, 0);
  const report = {
    generatedAt: new Date().toISOString(),
    sinceTs,
    rpc: RPC,
    pool: POOL_PUBKEY.toBase58(),
    walletsChecked: wallets.length,
    onChainPayouts: onChainPayouts.length,
    lostCount: lost.length,
    totalOstOwed: Number(totalLost.toFixed(4)),
    perWallet: Object.fromEntries(
      [...lost.reduce((m, e) => {
        if (!m.has(e.wallet)) m.set(e.wallet, { wallet: e.wallet, totalOwed: 0, claims: [] });
        const r = m.get(e.wallet);
        r.totalOwed = Number((r.totalOwed + e.ostAmount).toFixed(4));
        r.claims.push(e);
        return m;
      }, new Map())].map(([k, v]) => [k, v])
    ),
    items: lost
  };
  fs.writeFileSync(file, JSON.stringify(report, null, 2));
  console.log("");
  console.log("============================================");
  console.log("  Reconciliation complete");
  console.log("============================================");
  console.log("Wallets checked    :", wallets.length);
  console.log("On-chain payouts   :", onChainPayouts.length);
  console.log("Unmatched claims   :", lost.length);
  console.log("Total OST owed     :", totalLost.toFixed(4));
  console.log("Affected wallets   :", Object.keys(report.perWallet).length);
  console.log("Report             :", path.relative(process.cwd(), file));
  console.log("");
  console.log("Next step: review the report, then run");
  console.log("  node scripts/reissue-lost-ost.mjs --report", path.relative(process.cwd(), file));
  console.log("(reissue script will require --confirm to actually re-pay)");
})().catch(err => {
  console.error("FATAL:", err);
  process.exit(1);
});

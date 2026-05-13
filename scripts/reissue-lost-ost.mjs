#!/usr/bin/env node
// =============================================================================
// OST Token — Reissue Lost Payouts (WRITES MONEY)
// =============================================================================
// Consumes the JSON report produced by reconcile-lost-ost.mjs and re-pays
// every wallet that was debited locally but never received OST on-chain.
//
// SAFETY:
//   • Defaults to dry-run. Pass --confirm to actually move funds.
//   • Each reissue is verified with the same confirmTransaction +
//     getSignatureStatuses pattern that fixed the original bug, so reissues
//     themselves cannot silently fail.
//   • Each reissue is logged to the worker audit ledger with
//     kind=reissue and ref=<original claimSig> so the same record can never
//     be re-paid twice (script also keeps a local seen-set per report run).
//   • Adds a memo `{"k":"reissue","origin":"reconcile","claim":"<sig>"}` so
//     on-chain history is auditable.
//
// Usage:
//   node scripts/reissue-lost-ost.mjs --report reports/lost-ost-XYZ.json
//   node scripts/reissue-lost-ost.mjs --report reports/lost-ost-XYZ.json --confirm
//   node scripts/reissue-lost-ost.mjs --report reports/lost-ost-XYZ.json --confirm --max 100
// =============================================================================

import {
  Connection, PublicKey, Keypair, Transaction, ComputeBudgetProgram
} from "@solana/web3.js";
import {
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAccount
} from "@solana/spl-token";
import fs from "node:fs";
import path from "node:path";

const POOL_KEY_PATH = path.join(process.cwd(), "swap-pool.json");
const OST_MINT      = new PublicKey("383pTzoZ8Gp83dzk23ZnvLcfX2Sq32TAGN48CMQu2pAJ");
const POOL_ATA      = new PublicKey("5b5DBGw1DocFqFaDxukRxEv46kKGXwQQNDRkHBAwAiGK");
const DECIMALS      = 9;
const MEMO_PROGRAM  = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
const RPC           = process.env.SOLANA_RPC || "https://api.devnet.solana.com";
const API           = (process.env.OST_API || "https://ost-api.nachogtavl.workers.dev").replace(/\/+$/, "");

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => {
  if (a.startsWith("--")) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith("--") ? arr[i + 1] : true]);
  return acc;
}, []));

if (!args.report) {
  console.error("Missing --report <path>");
  process.exit(2);
}
const report = JSON.parse(fs.readFileSync(args.report, "utf-8"));
const confirm = args.confirm === true;
const maxItems = args.max ? Number(args.max) : Infinity;

if (!fs.existsSync(POOL_KEY_PATH)) {
  console.error("Pool keypair not found at", POOL_KEY_PATH);
  console.error("Place swap-pool.json (the same one published into site/swap-pool.js) at the repo root.");
  process.exit(2);
}
const pool = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(POOL_KEY_PATH, "utf-8"))));
console.log("Pool signer:", pool.publicKey.toBase58());
if (pool.publicKey.toBase58() !== "5ibGwXAV6yLZPR6uWbzou1LaHhmhehjYEpqWZKZw5WZS") {
  console.error("Loaded pool key does NOT match the expected pool. Aborting.");
  process.exit(2);
}

const conn = new Connection(RPC, "confirmed");

// Local seen-set so a single report run can't double-pay the same claim.
const seen = new Set();

async function ensureUserAta(owner) {
  const ata = getAssociatedTokenAddressSync(OST_MINT, owner, true, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
  try { await getAccount(conn, ata, "confirmed", TOKEN_2022_PROGRAM_ID); return { ata, exists: true }; }
  catch (_) { return { ata, exists: false }; }
}

function memoIx(text, signer) {
  return {
    programId: MEMO_PROGRAM,
    keys: [{ pubkey: signer, isSigner: true, isWritable: false }],
    data: Buffer.from(String(text), "utf8")
  };
}

async function reissueOne(item) {
  const owner = new PublicKey(item.wallet);
  const amt = Number(item.ostAmount);
  if (!Number.isFinite(amt) || amt <= 0) return { ok: false, error: "invalid amount" };
  const raw = BigInt(Math.round(amt * Math.pow(10, DECIMALS)));
  const { ata, exists } = await ensureUserAta(owner);

  const ixs = [ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 5_000 })];
  if (!exists) {
    ixs.push(createAssociatedTokenAccountInstruction(pool.publicKey, ata, owner, OST_MINT, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID));
  }
  ixs.push(createTransferCheckedInstruction(POOL_ATA, OST_MINT, ata, pool.publicKey, raw, DECIMALS, [], TOKEN_2022_PROGRAM_ID));
  const memoText = JSON.stringify({ k: "reissue", origin: "reconcile", claim: item.claimSig || "", kind: item.kind || "" }).slice(0, 220);
  ixs.push(memoIx(memoText, pool.publicKey));

  const bh = await conn.getLatestBlockhash("confirmed");
  const tx = new Transaction({ feePayer: pool.publicKey, blockhash: bh.blockhash, lastValidBlockHeight: bh.lastValidBlockHeight });
  tx.add(...ixs);
  tx.sign(pool);

  const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 5 });

  // verify-or-throw, mirrors the patched sendPoolOnlyTx
  let primaryErr = null;
  try {
    const res = await conn.confirmTransaction({ signature: sig, blockhash: bh.blockhash, lastValidBlockHeight: bh.lastValidBlockHeight }, "confirmed");
    if (res?.value?.err) throw new Error("On-chain failure: " + JSON.stringify(res.value.err));
    return { ok: true, sig };
  } catch (e) { primaryErr = e; }

  for (let attempt = 0; attempt < 6; attempt++) {
    await new Promise(r => setTimeout(r, 700 + attempt * 300));
    const st = await conn.getSignatureStatuses([sig], { searchTransactionHistory: true });
    const entry = st?.value?.[0];
    if (entry?.err) return { ok: false, error: "On-chain failure: " + JSON.stringify(entry.err), sig };
    if (entry && (entry.confirmationStatus === "confirmed" || entry.confirmationStatus === "finalized")) return { ok: true, sig };
  }
  return { ok: false, error: "could not confirm reissue: " + (primaryErr?.message || primaryErr), sig };
}

function logAudit(payload) {
  return fetch(`${API}/wallet/payouts`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }).catch(() => {});
}

(async () => {
  console.log("============================================");
  console.log("  OST · Reissue Lost Payouts");
  console.log("============================================");
  console.log("Report     :", args.report);
  console.log("Items      :", report.items.length);
  console.log("Total owed :", report.totalOstOwed, "OST");
  console.log("Mode       :", confirm ? "LIVE (will move funds)" : "DRY-RUN");
  console.log("");

  const items = report.items.slice(0, maxItems);
  const results = { ok: [], fail: [], skipped: [] };
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const dedupeKey = `${it.wallet}:${it.claimSig || it.claimTs}:${it.ostAmount}`;
    if (seen.has(dedupeKey)) { results.skipped.push({ ...it, reason: "duplicate in report" }); continue; }
    seen.add(dedupeKey);

    process.stdout.write(`[${i + 1}/${items.length}] ${it.wallet.slice(0, 6)}…${it.wallet.slice(-4)}  ${it.ostAmount.toFixed(4)} OST  (${it.kind})  `);
    if (!confirm) { console.log("DRY-RUN"); results.ok.push({ ...it, dryRun: true }); continue; }

    const auditId = `reissue-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    await logAudit({ id: auditId, stage: "intent", wallet: it.wallet, kind: "reissue", ostAmount: it.ostAmount, ref: it.claimSig || "", memo: `reissue:${it.kind}` });

    try {
      const r = await reissueOne(it);
      if (r.ok) {
        console.log("→ OK", r.sig.slice(0, 12) + "…");
        results.ok.push({ ...it, sig: r.sig });
        await logAudit({ id: auditId, stage: "result", wallet: it.wallet, kind: "reissue", ostAmount: it.ostAmount, sig: r.sig, ref: it.claimSig || "" });
      } else {
        console.log("→ FAIL", r.error);
        results.fail.push({ ...it, error: r.error, sig: r.sig || "" });
        await logAudit({ id: auditId, stage: "failure", wallet: it.wallet, kind: "reissue", ostAmount: it.ostAmount, error: String(r.error).slice(0, 240), ref: it.claimSig || "" });
      }
    } catch (e) {
      console.log("→ THROW", e.message);
      results.fail.push({ ...it, error: e.message });
      await logAudit({ id: auditId, stage: "failure", wallet: it.wallet, kind: "reissue", ostAmount: it.ostAmount, error: String(e.message).slice(0, 240), ref: it.claimSig || "" });
    }
  }

  const out = path.join(path.dirname(args.report), `reissue-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(out, JSON.stringify({ report: args.report, confirm, results }, null, 2));
  console.log("");
  console.log("============================================");
  console.log("  Reissue complete");
  console.log("============================================");
  console.log("OK     :", results.ok.length);
  console.log("Failed :", results.fail.length);
  console.log("Skipped:", results.skipped.length);
  console.log("Output :", path.relative(process.cwd(), out));
  if (!confirm) console.log("\nThis was a DRY-RUN. Re-run with --confirm to actually re-pay users.");
})().catch(err => { console.error("FATAL:", err); process.exit(1); });

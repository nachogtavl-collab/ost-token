/* ==========================================================================
 * OST · Play Ledger — the authoritative OSTG-backed play balance
 * --------------------------------------------------------------------------
 * project-docs/PLAY-BALANCE.md, Phase 2 increment 2a (deposit + peg).
 *
 * A single global Durable Object holds every player's play balance and the
 * running total. A balance is REAL: it only ever increases after the DO has
 * VERIFIED on-chain that the matching OSTG actually landed in the pool. So the
 * ledger can never credit money that isn't backed — the exact opposite of the
 * forgeable localStorage credits it replaces.
 *
 * The second peg, checkable at /health/play:
 *     pool OSTG balance  >=  Σ all play balances       (solvency, not equality)
 * The pool may hold MORE (house profit, buffer); it must never hold less, or a
 * cash-out could fail to pay. If the read fails we say so — never a fake "fine".
 *
 * Cash-out (pool -> user OSTG) is NOT here. It can drain the pool, so it lands in
 * increment 2b behind this solvency gate, with the crash-safe idempotent send
 * pattern PayoutGate already proved. Deposit is safe to ship alone: it only adds
 * to the ledger, and only for money already in the pool.
 *
 * CONCURRENCY: like PayoutGate, this DO does slow Solana RPC (verifying the
 * deposit). Never hold blockConcurrencyWhile across that — verify UNLOCKED, then
 * lock only the short "dedup + credit + write" section. Wrapping the whole
 * request in the lock hits Cloudflare's production lock ceiling (the Phase 0 bug).
 * ========================================================================== */
import { PublicKey } from '@solana/web3.js';
import * as Pool from './solana-pool.js';

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
};
function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: Object.assign({ 'content-type': 'application/json' }, CORS_HEADERS) });
}
function cleanText(v, max) { return typeof v === 'string' ? v.slice(0, max) : ''; }
function isPubkey(s) { return typeof s === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s); }

function tokenAmountFromInfo(info) {
  const t = info && (info.tokenAmount || info.uiTokenAmount);
  if (t && Number.isFinite(Number(t.uiAmount))) return Number(t.uiAmount);
  if (t && t.uiAmountString) return Number(t.uiAmountString);
  if (info && Number.isFinite(Number(info.amount)) && Number.isFinite(Number(info.decimals))) {
    return Number(info.amount) / (10 ** Number(info.decimals));
  }
  return Number((info && info.amount) || 0);
}
function parsedInstructions(tx) {
  const top = (tx && tx.transaction && tx.transaction.message && tx.transaction.message.instructions) || [];
  const inner = [];
  for (const g of (tx && tx.meta && tx.meta.innerInstructions) || []) {
    for (const ix of g.instructions || []) inner.push(ix);
  }
  return top.concat(inner);
}

// Verify, on-chain, that `signature` moved OSTG FROM the wallet's OSTG account TO
// the pool's OSTG account, and return the amount. Trusts nothing the client says
// about the amount — reads it from the confirmed transaction. Because a transfer
// is identified by DESTINATION = the pool's OSTG ATA (a mint-specific address),
// this cannot be spoofed with some other token.
async function verifyDeposit(env, signature, walletStr) {
  const ostgMint = new PublicKey(Pool.OSTG_MINT);
  const poolOstg = Pool.poolAtaForMint(env, ostgMint).toBase58();
  const userOstg = Pool.ataForMint(walletStr, ostgMint).toBase58();
  return Pool.withRpc('play-verify-deposit', async (conn) => {
    const st = await conn.getSignatureStatuses([signature]);
    const status = st && st.value && st.value[0];
    if (!status) return { ok: false, error: 'tx_not_found' };
    if (status.err) return { ok: false, error: 'tx_failed' };
    const tx = await conn.getParsedTransaction(signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
    if (!tx) return { ok: false, error: 'tx_not_found' };
    let amount = 0;
    for (const ix of parsedInstructions(tx)) {
      const p = ix && ix.parsed;
      if (!p || (ix.program !== 'spl-token' && ix.program !== 'spl-token-2022')) continue;
      if (p.type !== 'transfer' && p.type !== 'transferChecked') continue;
      const info = p.info || {};
      if (String(info.destination) !== poolOstg) continue;      // must land in the pool's OSTG account
      if (String(info.source) !== userOstg) continue;           // must come from THIS wallet
      amount += tokenAmountFromInfo(info);
    }
    return amount > 0 ? { ok: true, amount } : { ok: false, error: 'no_ostg_to_pool' };
  });
}

export class PlayLedger {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) { return this.handle(request); }

  async balOf(wallet) { return Number((await this.state.storage.get('bal:' + wallet)) || 0); }
  async total() { return Number((await this.state.storage.get('total')) || 0); }

  async handle(request) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, '') || '/';
    const method = request.method;
    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });

    try {
      if (path === '/play/balance' && method === 'GET') {
        const wallet = cleanText(url.searchParams.get('wallet'), 64);
        if (!isPubkey(wallet)) return json({ error: 'invalid_wallet' }, 400);
        return json({ ok: true, wallet, balance: await this.balOf(wallet), total: await this.total() });
      }

      if (path === '/play/deposit' && method === 'POST') return await this.handleDeposit(request);

      if (path === '/health/play' && method === 'GET') return await this.handleHealth();
    } catch (err) {
      return json({ error: 'internal_error', message: String((err && err.message) || err).slice(0, 200) }, 500);
    }
    return json({ error: 'unknown_play_endpoint', path }, 404);
  }

  async handleDeposit(request) {
    let body; try { body = await request.json(); } catch (_) { return json({ error: 'invalid_json' }, 400); }
    const wallet = cleanText(body && body.wallet, 64);
    const signature = cleanText(body && body.signature, 128);
    if (!isPubkey(wallet)) return json({ error: 'invalid_wallet' }, 400);
    if (!signature) return json({ error: 'missing_signature' }, 400);

    // Fast idempotency reject (also re-checked under the lock).
    const already = await this.state.storage.get('dep:' + signature);
    if (already) return json({ ok: true, credited: already.amount, balance: await this.balOf(wallet), idempotent: true });

    // VERIFY ON-CHAIN, UNLOCKED (slow RPC). The amount comes from the confirmed
    // transaction, never from the client.
    let v;
    try { v = await verifyDeposit(this.env, signature, wallet); }
    catch (e) { return json({ error: 'verify_failed', message: String((e && e.message) || e).slice(0, 160) }, 502); }
    if (!v.ok) return json({ error: v.error || 'deposit_unverified' }, 400);

    // LOCKED: dedup decide + credit + write. Short and pure — no RPC in here.
    const out = await this.state.blockConcurrencyWhile(async () => {
      const existing = await this.state.storage.get('dep:' + signature);
      if (existing) return { credited: existing.amount, balance: Number((await this.state.storage.get('bal:' + wallet)) || 0), idempotent: true };
      const bal = Number((await this.state.storage.get('bal:' + wallet)) || 0) + v.amount;
      const total = Number((await this.state.storage.get('total')) || 0) + v.amount;
      await this.state.storage.put('dep:' + signature, { wallet, amount: v.amount, at: Date.now() });
      await this.state.storage.put('bal:' + wallet, bal);
      await this.state.storage.put('total', total);
      return { credited: v.amount, balance: bal, idempotent: false };
    });
    return json(Object.assign({ ok: true, wallet }, out));
  }

  async handleHealth() {
    const total = await this.total();
    let poolOstg = null;
    try {
      poolOstg = await Pool.withRpc('play-health', async (conn) => {
        const res = await conn.getTokenAccountBalance(Pool.poolAtaForMint(this.env, new PublicKey(Pool.OSTG_MINT)));
        return Number(res && res.value ? res.value.uiAmount : NaN);
      });
    } catch (_) { poolOstg = null; }
    // Read failure must NOT read as a healthy 0/0 (ost-masking-antipattern).
    if (poolOstg == null || !Number.isFinite(poolOstg)) {
      return json({ ok: false, error: 'pool_read_failed', playTotal: total,
        note: 'Could not read pool OSTG — NOT a solvency verdict.' }, 502);
    }
    const solvent = poolOstg + 1e-9 >= total;
    return json({
      ok: solvent,
      solvent,
      poolOstg,
      playTotal: Number(total.toFixed(9)),
      buffer: Number((poolOstg - total).toFixed(9)),
      note: solvent
        ? 'pool OSTG >= Σ play balances: every play balance is backed by real OSTG.'
        : 'UNDER-COLLATERALIZED — pool OSTG is less than outstanding play balances.'
    }, solvent ? 200 : 500);
  }
}

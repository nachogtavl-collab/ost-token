/* ==========================================================================
   OST /wallet/payout · /wallet/ata-rent · /wallet/cosign(/submit|/status)
   ----------------------------------------------------------------------------
   Server-side replacement for docs/devnet-rescue.js's browser-side pool
   signing (Phase 0 — project-docs/TOKEN-ARCHITECTURE.md). The PayoutGate
   Durable Object is the single authoritative checker of solvency/reserve/
   cap limits and payout idempotency — client-side copies of these checks
   are UX hints only and are never trusted here.

   Every transaction is built ENTIRELY by this module (see solana-pool.js's
   header comment) from validated scalars, never from client-supplied
   instructions — EXCEPT kind:'fee-only' (see solana-pool.js assertPoolAbsent
   for why that one case is safe). /wallet/cosign is a two-step flow because
   the user still has to add their own signature for their leg:
     1. POST /wallet/cosign        → worker builds + partial-signs, returns
                                      the still-incomplete tx for the user's
                                      wallet to sign.
     2. POST /wallet/cosign/submit → client posts back the now fully-signed
                                      tx; worker submits + confirms it.

   MONEY OUTCOME PROTOCOL (contract C4, 2026-10 money-rails fix):
     200 {ok:true, sig}                 confirmed on chain
     202 {ok:true, pending:true, sig}   broadcast, not confirmed yet
     4xx {error, code, message}         refused BEFORE anything was broadcast
                                        (or landed-and-failed: nothing moved)
     503 {error:'state_unknown'|'gate_reset', retryable:true, sig?}
   Never a 5xx after a broadcast without the sig. The signature is known
   BEFORE broadcast (the pool is the fee payer, so signatures[0] — the txid —
   is the pool's own signature) and is persisted first, so a Durable Object
   reset mid-send is recovered by confirming that signature, never by building
   a second transaction. Idempotency is by business key (payoutId / cosignId /
   ticket id), never by amount.
     GET /wallet/cosign/status/:cosignId   GET /wallet/payout/status/:payoutId
   ========================================================================== */
import { PublicKey } from '@solana/web3.js';
import * as Pool from './solana-pool.js';

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'content-type, accept, x-ost-wallet, x-ost-ts, x-ost-nonce, x-ost-sig, x-ost-session, x-ost-internal',
  'access-control-expose-headers': 'x-ost-server-time, x-ost-auth, retry-after'
};

function json(data, status = 200, extra = null) {
  const headers = Object.assign({ 'content-type': 'application/json', 'cache-control': 'no-store', 'x-ost-server-time': String(Date.now()), 'date': new Date().toUTCString() }, CORS_HEADERS, extra || {});
  return new Response(JSON.stringify(data), { status, headers });
}
// Contract C3: every refusal carries a machine `code` and a human `message`.
// `error` keeps the historical name where old clients key off it.
function fail(status, error, message, extra) {
  const body = Object.assign({ ok: false, error, code: error, message }, extra || {});
  if (extra && extra.code) body.code = extra.code;
  return json(body, status, extra && extra.retryAfterMs ? { 'retry-after': String(Math.ceil(extra.retryAfterMs / 1000)) } : null);
}

function cleanText(value, max = 200) {
  return String(value == null ? '' : value).slice(0, max);
}
function cleanNumber(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
function isValidPubkey(text) {
  try { new PublicKey(String(text || '')); return true; }
  catch (_) { return false; }
}
function stableHash(text) {
  let hash = 2166136261;
  const s = String(text || '');
  for (let i = 0; i < s.length; i++) { hash ^= s.charCodeAt(i); hash = Math.imul(hash, 16777619); }
  return ('00000000' + (hash >>> 0).toString(16)).slice(-8);
}
function cleanId(value, prefix) {
  const text = String(value || '').replace(/[^a-z0-9_.:-]/gi, '-').slice(0, 72);
  return text || (prefix + '-' + Date.now().toString(36) + '-' + stableHash(Math.random()));
}
const r6 = (n) => Math.round((Number(n) || 0) * 1e6) / 1e6;
const SIG_RE = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

// Legacy localStorage credits stop being cashable on this date (founder-approved
// hard reset, announced with a 7-day notice on 2026-09-18).
const CREDITS_RETIRE_AT = Date.parse('2026-09-25T00:00:00Z');
// Interim caps on CLIENT-originated payouts (kinds that still assert their own
// amount: legacy prediction claims, memecoin sells, fair-game cash-outs) until
// Phase 1 wallet-signature auth + Phase 4 rail collapse remove them entirely.
const CLIENT_WALLET_CAP_24H_OST = 2000;
const CLIENT_GLOBAL_CAP_24H_OST = 100000;

// SRV-7: separate, success-counted limits. A sell (payout) is never blocked by
// buys/bridge converts (cosigns), and a refused or replayed call costs nothing.
const RATE_WINDOW_MS = 10 * 60 * 1000;
const PAYOUT_RATE_LIMIT = 10;        // successful client payouts / wallet / 10 min
const COSIGN_RATE_LIMIT = 40;        // successful cosign submits / wallet / 10 min
const COSIGN_BUILD_LIMIT = 120;      // cosign builds (cheap, but RPC-costly) / wallet / 10 min

// SRV-3: a wallet prediction ticket (ETH/SOL fast + venue markets) still has a
// CLIENT-asserted outcome until decision D3 Phase 2 moves those markets onto a
// server ledger. Until then the server bounds what one can pay:
//   payout <= stake x min(TICKET_MAX_MULTIPLE, 1 / memo price)
// The memo price is written by the user, so it can only LOWER the bound; the
// multiple is a server-side constant (override with OST_TICKET_MAX_MULTIPLE).
// The ticket's PROFIT (payout - stake) also counts against the 24h client caps.
const TICKET_MIN_PRICE = 0.02;
const TICKET_MAX_MULTIPLE = 3;
const PREDICTION_MEMO_PREFIX = 'OST|prediction|';

// payoutIds the SERVER derives (faucet claim slot, top-up intent, treasury
// deposit, play rail). A client may never create or squat one (review: a client
// payout under 'faucet-welcome-<victim>' marked the victim's welcome as paid).
const RESERVED_PAYOUT_ID_RE = /^(faucet-|topup-|treasury-|play-)/i;

// Legacy 'building' records (old code broadcast before saving the sig) are
// reconciled by scanning the pool's history for the payoutId memo. The scan is
// incremental and throttled; after a few inconclusive windows the record is
// marked needs_support (an honest answer, no alarm loop, no RPC scan per read).
const LEGACY_SCAN_INTERVAL_MS = 2 * 60 * 1000;
const LEGACY_SCAN_MAX_ATTEMPTS = 3;
const NEEDS_SUPPORT_MESSAGE = 'Nothing was sent. OST could not confirm whether an earlier payout for this claim landed on Solana, so it will not send another one automatically. Contact support with your wallet address.';

// SRV-8 defaults (override with OST_SPONSOR_PER_SENDER_DAILY / OST_SPONSOR_DAILY_LAMPORTS).
// The per-sender count and the global lamport budget are CHARGED when the pool
// signs the quote (the client could broadcast that tx itself and never call
// /submit); a quote that provably never landed is credited back.
const SPONSOR_PER_SENDER_DAILY = 10;
const SPONSOR_ATA_RENT_PER_OWNER_DAILY = 4;  // /wallet/ata-rent creations per owner per day
const SPONSOR_DAILY_LAMPORTS = 500000000;   // 0.5 SOL of pool rent per UTC day (all sponsored creations)

// fee-only cosign: the pool is the fee payer of client instructions, so the
// client must not be able to set the fee the pool pays (review: a 42 SOL
// priority fee in one transaction).
const COMPUTE_BUDGET_PROGRAM = 'ComputeBudget111111111111111111111111111111';
const FEE_ONLY_MAX_CU_LIMIT = 400000;
const FEE_ONLY_MAX_CU_PRICE = 10000;         // micro-lamports per compute unit
const FEE_ONLY_MAX_SIGNERS = 4;
const FEE_ONLY_MAX_FEE_LAMPORTS = 50000;

// Errors that may be retried with the SAME key once the cause clears.
function preBroadcastResponse(e) {
  if (!e) return fail(503, 'rpc_unavailable', 'Solana could not be reached. Nothing was sent — try again.', { retryable: true });
  if (e.code === 'simulation_failed' || e instanceof Pool.SimulationFailedError) {
    return fail(422, 'simulation_failed', e.message, { code: e.reason || 'simulation_failed', asset: e.asset, logs: (e.logs || []).slice(-6) });
  }
  if (e.code === 'blockhash_expired') return fail(409, 'blockhash_expired', 'This quote expired before it was sent. Nothing was sent — please try again.', { retryable: true });
  if (e.code === 'rpc_unavailable' || e.code === 'rpc_refused' || e.code === 'rpc_not_configured') {
    return fail(503, 'rpc_unavailable', String(e.message || 'Solana could not be reached.').slice(0, 240) + (/nothing was sent/i.test(e.message || '') ? '' : ' Nothing was sent.'), { retryable: true });
  }
  return fail(503, 'gate_reset', 'The OST payout service restarted before sending. Nothing was sent — try again.', { retryable: true });
}

function parsePredictionMemo(memo) {
  const out = {};
  String(memo || '').split('|').forEach(part => {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i)] = part.slice(i + 1);
  });
  return out;
}
function tokenAmountOf(info) {
  const t = info && (info.tokenAmount || info.uiTokenAmount);
  if (t && t.amount != null && Number.isFinite(Number(t.decimals))) return Number(t.amount) / Math.pow(10, Number(t.decimals));
  if (t && Number.isFinite(Number(t.uiAmount))) return Number(t.uiAmount);
  return 0;
}
function faultAfterBroadcast(env, where) {
  // Staging-only acceptance hook (plan §5 worker acceptance 2). Never set in
  // production: simulates the Durable Object being reset right after a
  // broadcast, so the recovery paths can be exercised end to end.
  if (String((env && env.FAULT_AFTER_BROADCAST) || '') !== '1') return;
  const e = new Error('Durable Object reset because its code was updated. [FAULT_AFTER_BROADCAST at ' + where + ']');
  e.faultInjection = true;
  throw e;
}

export class PayoutGate {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  // NOTE: unlike FaucetGate, this DO does real network I/O (Solana RPC calls).
  // Wrapping the ENTIRE request in blockConcurrencyWhile blocks every other
  // request to this DO for that whole duration and can itself hit the
  // platform's lock timeout. Each handler locks only the short state-mutating
  // section (decide + persist sig + one broadcast) and confirms OUTSIDE the lock.
  async fetch(request) {
    return this.handle(request);
  }

  // ── SRV-7 rate limits (cosign): check without counting; count only after success ──
  async rateState(kind, wallet, limit) {
    const key = 'rate:' + kind + ':' + wallet;
    const now = Date.now();
    const rec = (await this.state.storage.get(key)) || { windowStart: now, count: 0 };
    if (now - rec.windowStart > RATE_WINDOW_MS) { rec.windowStart = now; rec.count = 0; }
    return { limited: rec.count >= limit, retryAfterMs: Math.max(1000, rec.windowStart + RATE_WINDOW_MS - now), remaining: Math.max(0, limit - rec.count) };
  }
  async rateCount(kind, wallet) {
    try {
      const key = 'rate:' + kind + ':' + wallet;
      const now = Date.now();
      const rec = (await this.state.storage.get(key)) || { windowStart: now, count: 0 };
      if (now - rec.windowStart > RATE_WINDOW_MS) { rec.windowStart = now; rec.count = 0; }
      rec.count += 1;
      await this.state.storage.put(key, rec);
    } catch (_) { /* a counter write must never turn a landed payout into an error */ }
  }
  rateLimited(kind, rs) {
    const minutes = Math.max(1, Math.ceil(rs.retryAfterMs / 60000));
    const what = kind === 'payout' ? 'payouts' : 'wallet transactions';
    return fail(429, 'rate_limited', 'Too many ' + what + ' from this wallet in 10 minutes — try again in about ' + minutes + ' min.', { retryAfterMs: rs.retryAfterMs, limitKind: kind });
  }

  // Client-originated payouts: the 10-min rate slot and the rolling-24h cap
  // amount are RESERVED atomically — check AND count in one storage-only lock —
  // BEFORE any network wait. (Counting only after the RPC round-trips let N
  // concurrent requests all pass the same check: review R2, 6 x 1000 OST vs a
  // 2000 cap.) A reservation is released only when nothing was paid: a refusal
  // before broadcast, or a transaction that landed and failed.
  // Same storage keys and shapes as before ('rate:payout:<w>', 'cap24:<w>').
  async reservePayoutBudget(wallet, capAmt) {
    return this.state.blockConcurrencyWhile(async () => {
      const now = Date.now();
      const rk = 'rate:payout:' + wallet;
      const rate = (await this.state.storage.get(rk)) || { windowStart: now, count: 0 };
      if (now - rate.windowStart > RATE_WINDOW_MS) { rate.windowStart = now; rate.count = 0; }
      if (rate.count >= PAYOUT_RATE_LIMIT) {
        return { response: this.rateLimited('payout', { retryAfterMs: Math.max(1000, rate.windowStart + RATE_WINDOW_MS - now) }) };
      }
      const read = async (key) => {
        const rec = (await this.state.storage.get(key)) || { windowStart: now, sum: 0 };
        if (now - rec.windowStart > DAY_MS) { rec.windowStart = now; rec.sum = 0; }
        return rec;
      };
      const w = await read('cap24:' + wallet);
      const g = await read('cap24:__global__');
      if (w.sum + capAmt > CLIENT_WALLET_CAP_24H_OST + 1e-9) {
        const remaining = r6(Math.max(0, CLIENT_WALLET_CAP_24H_OST - w.sum));
        return { response: fail(409, 'daily_wallet_cap', 'Daily payout cap reached (' + CLIENT_WALLET_CAP_24H_OST + ' OST per 24 h for this wallet). ' + remaining + ' OST left today. Nothing was sent.', { remaining, retryAfterMs: Math.max(0, w.windowStart + DAY_MS - now) }) };
      }
      if (g.sum + capAmt > CLIENT_GLOBAL_CAP_24H_OST + 1e-9) {
        return { response: fail(409, 'daily_global_cap', 'The shared daily payout budget is used up. Nothing was sent — try again later.', { retryAfterMs: Math.max(0, g.windowStart + DAY_MS - now) }) };
      }
      rate.count += 1;
      w.sum = r6(w.sum + capAmt);
      g.sum = r6(g.sum + capAmt);
      await this.state.storage.put({ [rk]: rate, ['cap24:' + wallet]: w, 'cap24:__global__': g });
      return { reservation: { wallet, capAmt, rateWindow: rate.windowStart, walletWindow: w.windowStart, globalWindow: g.windowStart, released: false } };
    });
  }
  // Give a reservation back (idempotent). Never call it from inside a lock.
  async releasePayoutBudget(res) {
    if (!res || res.released) return;
    res.released = true;
    try {
      await this.state.blockConcurrencyWhile(async () => {
        const puts = {};
        const rk = 'rate:payout:' + res.wallet;
        const rate = await this.state.storage.get(rk);
        if (rate && rate.windowStart === res.rateWindow && rate.count > 0) puts[rk] = Object.assign({}, rate, { count: rate.count - 1 });
        for (const [key, win] of [['cap24:' + res.wallet, res.walletWindow], ['cap24:__global__', res.globalWindow]]) {
          const rec = await this.state.storage.get(key);
          if (rec && rec.windowStart === win) puts[key] = Object.assign({}, rec, { sum: Math.max(0, r6(rec.sum - res.capAmt)) });
        }
        if (Object.keys(puts).length) await this.state.storage.put(puts);
      });
    } catch (_) { /* a stuck counter only ever errs on the safe side */ }
  }

  async handle(request) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, '') || '/';
    const method = request.method;
    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
    // SRV-5: configure the RPC list BEFORE anything can touch a connection.
    try { Pool.ensureRpcConfigured(this.env); } catch (_) {}

    try {
      if (path === '/wallet/payout' && method === 'POST') return await this.handlePayout(request);
      if (path === '/wallet/ata-rent' && method === 'POST') return await this.handleAtaRent(request);
      if (path === '/wallet/cosign' && method === 'POST') {
        // Building a quote never broadcasts anything, so ANY failure here is a
        // definite "nothing was signed or sent" — never state_unknown.
        try { return await this.handleCosignBuild(request); }
        catch (e) {
          if (e && e.code === 'sol_price_unavailable') return fail(503, 'price_unavailable', 'Could not get a live SOL price, so no quote was made. Nothing was signed or sent — try again shortly.', { retryable: true });
          return fail(503, 'rpc_unavailable', 'Could not prepare this transaction right now (' + String((e && e.message) || e).slice(0, 120) + '). Nothing was signed or sent — try again.', { retryable: true });
        }
      }
      if (path === '/wallet/cosign/submit' && method === 'POST') return await this.handleCosignSubmit(request);
      const cs = path.match(/^\/wallet\/cosign\/status\/([^/]+)$/);
      if (cs && method === 'GET') return await this.handleCosignStatus(decodeURIComponent(cs[1]));
      const ps = path.match(/^\/wallet\/payout\/status\/([^/]+)$/);
      if (ps && method === 'GET') return await this.handlePayoutStatus(decodeURIComponent(ps[1]));
    } catch (err) {
      if (err && err.faultInjection) throw err;   // staging fault hook: behave like a real reset
      if (err && err.code === 'blockhash_expired') return fail(409, 'blockhash_expired', err.message, { retryable: true });
      if (err && err.preBroadcast) return preBroadcastResponse(err);
      // We cannot prove nothing was broadcast here, so never "failed": the
      // caller checks the status endpoint (or retries with the SAME key).
      return fail(503, 'state_unknown', 'The OST payout service hit an error mid-request. Check the status before retrying — a retry with the same id never pays twice.', { retryable: true, detail: String((err && err.message) || err).slice(0, 200) });
    }
    return json({ error: 'unknown_wallet_endpoint', code: 'unknown_wallet_endpoint', path }, 404);
  }

  // =======================================================================
  // POST /wallet/payout  { wallet, amountOst, memo, payoutId }
  // Pool → user transferChecked. Worker builds the entire tx alone.
  // =======================================================================
  async handlePayout(request) {
    let body; try { body = await request.json(); } catch (_) { return fail(400, 'invalid_json', 'Request body must be JSON.'); }
    const walletStr = cleanText(body && body.wallet, 64);
    const amt = cleanNumber(body && body.amountOst, null);
    const memo = cleanText(body && body.memo, 200);
    if (!isValidPubkey(walletStr)) return fail(400, 'invalid_wallet', 'That is not a valid Solana wallet address.');
    if (!(amt > 0)) return fail(400, 'invalid_amount', 'The payout amount must be greater than zero.');
    const payoutId = (body && body.payoutId) ? cleanId(body.payoutId, 'pay') : cleanId('pay-' + stableHash([walletStr, memo].join('|')), 'pay');

    // ── ORIGIN GATE ── Server-originated payouts (FaucetGate, ledgers) carry the
    // internal key and pay the amount THEY computed. Client-originated ones are
    // the old money printer: faucet/credits kinds are refused outright, the rest
    // are verified (predictions), rate-limited and hard-capped.
    const internalKey = this.env && this.env.INTERNAL_MUTATION_KEY;
    const internal = !!internalKey && request.headers.get('x-ost-internal') === internalKey;
    let memoJson = null;
    try { memoJson = JSON.parse(memo); } catch (_) {}
    const memoKind = String((memoJson && memoJson.k) || '');
    if (!internal) {
      if (memoKind === 'ost-new-here') return fail(403, 'server_only_kind', 'Faucet payouts are issued by the server — claim through the faucet.');
      if (memoKind === 'ost-topup' || memoKind === 'ost-topup-local-verified') return fail(403, 'server_only_kind', 'Top-up deliveries are paid by the server once the payment is verified.');
      if (memoKind === 'treasury-deposit') return fail(403, 'server_only_kind', 'Crypto deposits are credited by the server after the deposit is verified — use Top up → Crypto.');
      if (memoKind === 'faucet-hub-cashout' && Date.now() >= CREDITS_RETIRE_AT) return fail(403, 'credits_retired', 'Legacy credits were retired on 2026-09-25 and are no longer cashable. Play with OSTG.');
      if (RESERVED_PAYOUT_ID_RE.test(payoutId)) return fail(403, 'reserved_payout_id', 'This payout id is reserved for payouts the server makes itself. Nothing was sent.');
    }

    // ── 1. IDEMPOTENCY by payoutId, REGARDLESS of amount (SRV-3) ──
    const existing = await this.state.storage.get('payout:' + payoutId);
    if (existing) {
      if (existing.wallet && existing.wallet !== walletStr) return fail(409, 'payout_id_conflict', 'This payout id already belongs to a different wallet.');
      const early = await this.resumeExistingPayout(payoutId, existing);
      if (early) return early;
      // else: definitively never landed (failed / expired / unsent build) -> pay fresh below
    }

    // ── 2. ONE welcome grant per wallet, whatever the payoutId (SRV-1) ──
    const isWelcome = internal && memoKind === 'ost-new-here' && memoJson && memoJson.kind === 'welcome';
    if (isWelcome) {
      const prior = await this.welcomeRecord(walletStr);
      if (prior && prior.payoutId !== payoutId && prior.state === 'confirmed') {
        return fail(409, 'already_paid', 'This wallet already received its 100 OST welcome.', { sig: prior.sig || '', payoutId: prior.payoutId, status: prior.state });
      }
      if (prior && prior.payoutId !== payoutId && prior.state === 'needs_support') {
        return fail(409, 'needs_support', NEEDS_SUPPORT_MESSAGE, { payoutId: prior.payoutId, status: prior.state, retryable: false });
      }
      // An earlier welcome under another id whose outcome is not settled yet:
      // never send a second one, and never call it "paid" before it is.
      if (prior && prior.payoutId !== payoutId && prior.state !== 'failed') {
        const msg = prior.state === 'unknown'
          ? 'An earlier 100 OST welcome for this wallet is still being checked on Solana. Nothing new is sent until that check finishes.'
          : 'Your 100 OST welcome is already on its way — confirming on Solana.';
        return fail(409, 'claim_in_progress', msg, { sig: prior.sig || '', payoutId: prior.payoutId, status: prior.state, retryable: true });
      }
    }

    // ── 3. CLIENT prediction claims: verify the ticket server-side (SRV-3) ──
    let ticket = null;
    if (!internal && (memoKind === 'prediction-settlement' || memoKind === 'prediction-sell')) {
      const v = await this.verifyPredictionTicket(walletStr, memoJson, amt, payoutId);
      if (v.response) return v.response;
      ticket = v.ticket;
    }

    // ── 4. Rate + daily cap: RESERVED atomically here, before any network
    // wait; given back only if nothing gets paid (SRV-7 + review R2). A ticket
    // counts only its PROFIT: paying a user's own stake back extracts nothing.
    let budget = null;
    if (!internal) {
      const capAmt = ticket ? Math.max(0, r6(amt - ticket.stakeOst)) : amt;
      const rb = await this.reservePayoutBudget(walletStr, capAmt);
      if (rb.response) return rb.response;
      budget = rb.reservation;
    }
    const refuse = async (response) => { await this.releasePayoutBudget(budget); return response; };

    // ── 5. Solvency (unlocked reads — Solana itself rejects an overdraw, so a
    // stale snapshot is a soft business-rule risk, not a fund-safety one) ──
    const cfg = Pool.vaultConfig(this.env);
    if (cfg.maxSinglePayout > 0 && amt > cfg.maxSinglePayout) {
      return refuse(fail(409, 'cap_exceeded', 'Payout ' + Pool.formatOstAmount(amt) + ' OST exceeds the vault limit of ' + Pool.formatOstAmount(cfg.maxSinglePayout) + ' OST.'));
    }
    let poolBal;
    try {
      poolBal = await Pool.getPoolOstBalance(this.env);
    } catch (e) {
      return refuse(fail(503, 'balance_unknown', 'Could not verify the vault balance right now — nothing was sent, try again shortly.', { retryable: true }));
    }
    if (poolBal + 1e-9 < amt) {
      return refuse(fail(409, 'insufficient_pool', 'OST payout vault needs refill before paying ' + Pool.formatOstAmount(amt) + ' OST.'));
    }
    if (cfg.maxPayoutFraction > 0 && cfg.maxPayoutFraction < 1) {
      const dynamicCap = poolBal * cfg.maxPayoutFraction;
      if (amt > dynamicCap) {
        return refuse(fail(409, 'solvency_cap', 'This payout of ' + Pool.formatOstAmount(amt) + ' OST exceeds the live vault solvency cap of ' + Pool.formatOstAmount(dynamicCap) + ' OST.'));
      }
    }
    if (cfg.minReserve > 0 && poolBal - amt < cfg.minReserve) {
      return refuse(fail(409, 'reserve_protected', 'OST payout vault is protecting its shared reserve.'));
    }

    const owner = new PublicKey(walletStr);
    const mint = Pool.getMint(this.env);
    const pool = Pool.getPoolKeypair(this.env);
    const fromAta = Pool.poolAta(this.env);
    const toAta = Pool.userAta(this.env, owner);
    // Idempotent create, always included: a no-op when the account exists, and
    // no RPC round-trip spent asking first (SRV-4/SRV-5).
    const instructions = [Pool.ixCreateAta(pool.publicKey, toAta, owner, mint)];
    const rawAmount = Pool.decimalToRawAmount(amt, Pool.OST_TOKEN_DECIMALS);
    instructions.push(Pool.ixTransferChecked(fromAta, mint, toAta, pool.publicKey, rawAmount, Pool.OST_TOKEN_DECIMALS));
    // payoutId always goes on-chain in the memo, so any record can be
    // reconciled from the pool's history.
    instructions.push(Pool.ixMemo('payoutId:' + payoutId + (memo ? ' ' + memo : ''), pool.publicKey));

    // ── LOCKED: decide + persist 'building' + sign + persist 'sending <sig>' +
    // ONE broadcast. Confirmation happens after, unlocked.
    const outcome = await this.state.blockConcurrencyWhile(async () => {
      const cur = await this.state.storage.get('payout:' + payoutId);
      if (cur && cur.status === 'confirmed') {
        return { done: true, response: json({ ok: true, sig: cur.sig, ost: cur.ost, idempotent: true, payoutId }) };
      }
      if (cur && (cur.status === 'sent' || cur.status === 'sending') && cur.sig) return { resumeOnly: cur };
      if (cur && cur.status === 'building' && cur.v === 2 && Date.now() - (cur.createdAt || 0) < 30000) {
        return { done: true, response: fail(409, 'claim_in_progress', 'This payout is being sent right now — it lands in a few seconds.', { payoutId, retryable: true }) };
      }
      if (ticket) {
        const tk = await this.state.storage.get('pticket:' + ticket.id);
        if (tk && tk.payoutId !== payoutId && (tk.status === 'sending' || tk.status === 'sent' || tk.status === 'confirmed')) {
          return { done: true, response: fail(409, 'already_paid', 'This ticket has already been paid.', { sig: tk.sig || '', payoutId: tk.payoutId }) };
        }
      }
      if (isWelcome) {
        // Re-checked under the lock: two CONCURRENT welcomes under different
        // payoutIds both passed welcomeRecord above (verifier SRV-1 race). The
        // first one's 'fw:' index entry is written before its broadcast.
        const fw = await this.state.storage.get('fw:' + walletStr);
        if (fw && fw.payoutId && fw.payoutId !== payoutId && (fw.status === 'sending' || fw.status === 'sent' || fw.status === 'confirmed')) {
          return { done: true, response: fw.status === 'confirmed'
            ? fail(409, 'already_paid', 'This wallet already received its 100 OST welcome.', { sig: fw.sig || '', payoutId: fw.payoutId, status: 'confirmed' })
            : fail(409, 'claim_in_progress', 'Your 100 OST welcome is already on its way — confirming on Solana.', { sig: fw.sig || '', payoutId: fw.payoutId, status: 'pending', retryable: true }) };
        }
      }
      const baseRec = { v: 2, wallet: walletStr, ost: amt, memo, kind: memoKind, origin: internal ? 'server' : 'client', ticketId: ticket ? ticket.id : undefined, createdAt: Date.now() };
      await this.state.storage.put('payout:' + payoutId, Object.assign({ status: 'building' }, baseRec));
      let sent;
      try {
        sent = await Pool.buildSignSend(this.env, instructions, [], 'OST payout', {
          onSigned: async (sig, bh, txB64) => {
            const rec = Object.assign({ status: 'sending', sig, blockhashInfo: bh, txB64, sendingAt: Date.now() }, baseRec);
            const puts = { ['payout:' + payoutId]: rec };
            if (isWelcome) puts['fw:' + walletStr] = { payoutId, sig, status: 'sending', createdAt: baseRec.createdAt };
            if (ticket) puts['pticket:' + ticket.id] = { payoutId, sig, status: 'sending', wallet: walletStr, ost: amt, at: Date.now() };
            await this.state.storage.put(puts);
          }
        });
      } catch (e) {
        if (e && e.preBroadcast) {
          try {
            await this.state.storage.put('payout:' + payoutId, Object.assign({ status: 'failed', error: String((e && e.message) || e).slice(0, 300), failCode: e.reason || e.code || 'failed' }, baseRec));
            if (ticket) await this.state.storage.delete('pticket:' + ticket.id);
            if (isWelcome) await this.state.storage.delete('fw:' + walletStr);
          } catch (_) {}
          return { done: true, response: preBroadcastResponse(e) };
        }
        throw e;
      }
      return { resume: Object.assign({ status: 'sending', sig: sent.sig, blockhashInfo: sent.blockhashInfo }, baseRec), first: true };
    });

    if (outcome.done) { await this.releasePayoutBudget(budget); return outcome.response; }
    if (outcome.resumeOnly) {
      // Another request for this payoutId already broadcast: no new tx here.
      await this.releasePayoutBudget(budget);
      return this.confirmPayout(payoutId, outcome.resumeOnly, {});
    }
    faultAfterBroadcast(this.env, 'payout');
    return this.confirmPayout(payoutId, outcome.resume, { budget });
  }

  // Confirm a broadcast payout. Every storage write after the broadcast is
  // best-effort: the money already moved, so the answer is the signature.
  // The rate/cap reservation was charged before the broadcast; it is given
  // back only if the transaction landed and FAILED (nothing was paid).
  async confirmPayout(payoutId, rec, ctx) {
    try {
      await Pool.confirmSignature(rec.sig, rec.blockhashInfo, { label: 'OST payout' });
    } catch (e) {
      if (e && e.code === 'tx_failed') {
        await this.markPayoutFailed(payoutId, rec, e);
        await this.releasePayoutBudget(ctx && ctx.budget);
        return fail(422, 'tx_failed', 'The payout transaction failed on chain, so nothing was paid. You can try again.', { code: e.reason || 'tx_failed', sig: rec.sig, payoutId });
      }
      return json({ ok: true, pending: true, sig: rec.sig, ost: rec.ost, payoutId, auditId: payoutId, message: 'Sent — still confirming. Check your balance before trying again; a retry never pays twice.' }, 202);
    }
    await this.markPayoutConfirmed(payoutId, rec);
    return json({ ok: true, sig: rec.sig, ost: rec.ost, auditId: payoutId, payoutId });
  }

  // ── Post-reconcile writes are COMPARE-AND-SET (review: a slow status read
  // that loaded 'sending S1' finished after a retry had paid and confirmed S2,
  // overwrote the record with 'failed S1', and the next drive paid a third
  // time). Each re-reads payout:<id> under the lock and writes only if the
  // stored record is still the attempt it reasoned about (same sig, same
  // createdAt). Returns true when written (or already recorded the same way).
  // NEVER call these from inside another blockConcurrencyWhile.
  async markPayoutConfirmed(payoutId, rec, expectSig) {
    const expect = arguments.length >= 3 ? expectSig : rec.sig;
    try {
      return await this.state.blockConcurrencyWhile(async () => {
        const cur = await this.state.storage.get('payout:' + payoutId);
        if (cur && cur.status === 'confirmed') return cur.sig === rec.sig;
        if (cur && ((cur.sig || '') !== (expect || '') || (cur.createdAt || 0) !== (rec.createdAt || 0))) return false;
        const puts = { ['payout:' + payoutId]: Object.assign({}, rec, { status: 'confirmed', txB64: undefined, confirmedAt: Date.now() }) };
        let memoJson = null; try { memoJson = JSON.parse(rec.memo || ''); } catch (_) {}
        if (memoJson && memoJson.k === 'ost-new-here' && memoJson.kind === 'welcome' && rec.wallet) {
          const fw = await this.state.storage.get('fw:' + rec.wallet);
          if (!fw || fw.payoutId === payoutId || fw.status !== 'confirmed') puts['fw:' + rec.wallet] = { payoutId, sig: rec.sig, status: 'confirmed', createdAt: rec.createdAt || 0 };
        }
        if (rec.ticketId) {
          const tk = await this.state.storage.get('pticket:' + rec.ticketId);
          if (!tk || tk.payoutId === payoutId) puts['pticket:' + rec.ticketId] = { payoutId, sig: rec.sig, status: 'confirmed', wallet: rec.wallet, ost: rec.ost, at: Date.now() };
        }
        await this.state.storage.put(puts);
        return true;
      });
    } catch (_) { return true; }   // a failed bookkeeping write must not change the answer: it landed
  }
  async markPayoutFailed(payoutId, rec, e, expectSig) {
    const expect = arguments.length >= 4 ? expectSig : rec.sig;
    try {
      return await this.state.blockConcurrencyWhile(async () => {
        const cur = await this.state.storage.get('payout:' + payoutId);
        if (!cur) return false;
        if (!(cur.status === 'sending' || cur.status === 'sent' || cur.status === 'building')) return false;
        if ((cur.sig || '') !== (expect || '') || (cur.createdAt || 0) !== (rec.createdAt || 0)) return false;
        await this.state.storage.put('payout:' + payoutId, Object.assign({}, cur, { status: 'failed', sig: rec.sig || cur.sig, txB64: undefined, error: String((e && e.message) || e || '').slice(0, 300), failCode: (e && (e.reason || e.code)) || 'failed', failedAt: Date.now() }));
        if (cur.ticketId) {
          const tk = await this.state.storage.get('pticket:' + cur.ticketId);
          if (tk && tk.payoutId === payoutId && (tk.sig || '') === (cur.sig || '')) await this.state.storage.delete('pticket:' + cur.ticketId);
        }
        let memoJson = null; try { memoJson = JSON.parse(cur.memo || ''); } catch (_) {}
        if (memoJson && memoJson.k === 'ost-new-here' && memoJson.kind === 'welcome' && cur.wallet) {
          const fw = await this.state.storage.get('fw:' + cur.wallet);
          if (fw && fw.payoutId === payoutId && (fw.sig || '') === (cur.sig || '')) await this.state.storage.delete('fw:' + cur.wallet);
        }
        return true;
      });
    } catch (_) { return false; }
  }
  // Legacy-record scan bookkeeping (CAS on the same attempt).
  async patchLegacyRecord(payoutId, rec, patch) {
    try {
      await this.state.blockConcurrencyWhile(async () => {
        const cur = await this.state.storage.get('payout:' + payoutId);
        if (!cur || cur.status !== 'building' || cur.v === 2 || (cur.createdAt || 0) !== (rec.createdAt || 0)) return;
        await this.state.storage.put('payout:' + payoutId, Object.assign({}, cur, patch));
      });
    } catch (_) {}
  }

  // An existing record for this payoutId. Returns a Response when the answer is
  // known (confirmed / pending / still unknown), or null when it provably never
  // landed and a fresh send with the same id is safe.
  async resumeExistingPayout(payoutId, stored) {
    const r = await this.reconcilePayout(payoutId, stored);
    const rec = r.rec || stored;
    if (r.state === 'confirmed') return json({ ok: true, sig: r.sig, ost: rec.ost, idempotent: true, payoutId });
    if (r.state === 'pending') {
      // Not seen by any node yet (e.g. the DO reset between saving the sig and
      // the broadcast): re-send the IDENTICAL signed bytes — same signature, so
      // it can never pay twice — then give it a short confirm window.
      if (!r.seen && rec.txB64 && rec.sig === r.sig) {
        try { await Pool.sendSerialized(Buffer.from(rec.txB64, 'base64'), r.sig, { label: 'OST payout (resume)' }); } catch (_) {}
      }
      try {
        await Pool.confirmSignature(r.sig, rec.blockhashInfo, { label: 'OST payout', timeoutMs: 6000 });
        await this.markPayoutConfirmed(payoutId, Object.assign({}, rec, { sig: r.sig }));
        return json({ ok: true, sig: r.sig, ost: rec.ost, idempotent: true, payoutId });
      } catch (e) {
        if (e && e.code === 'tx_failed') {
          await this.markPayoutFailed(payoutId, rec, e);
          // Only a record WE just moved to failed is safe to pay fresh from.
          const now = await this.state.storage.get('payout:' + payoutId);
          if (now && now.status === 'failed' && now.sig === r.sig) return null;
          return fail(503, 'state_unknown', 'This payout changed while it was being checked. Nothing will be sent twice — check its status before retrying.', { payoutId, sig: r.sig, retryable: true });
        }
        return json({ ok: true, pending: true, sig: r.sig, ost: rec.ost, payoutId, idempotent: true, message: 'Sent — still confirming. A retry never pays twice.' }, 202);
      }
    }
    if (r.state === 'in_progress') return fail(409, 'claim_in_progress', 'This payout is being sent right now — it lands in a few seconds.', { payoutId, retryable: true });
    if (r.state === 'needs_support') return fail(409, 'needs_support', NEEDS_SUPPORT_MESSAGE, { payoutId, retryable: false });
    if (r.state === 'unknown') return fail(503, 'state_unknown', 'A previous attempt for this payout has not been reconciled yet. Nothing will be sent twice — try again in a minute.', { payoutId, sig: r.sig || undefined, retryable: true });
    return null;   // 'failed' / 'expired' / unsent build: safe to pay fresh (re-checked under the lock)
  }

  // Bring one payout record up to date with the chain.
  //   { state: confirmed | pending | failed | in_progress | unknown | needs_support, sig, rec }
  // `rec` is the record the answer is about: when a compare-and-set write
  // finds the stored record has moved on (another request paid meanwhile), the
  // answer is recomputed from the CURRENT record, never from the stale one.
  async reconcilePayout(payoutId, rec, depth = 0) {
    if (!rec) return { state: 'not_found' };
    const again = async (fallback) => {
      if (depth >= 2) return Object.assign({ rec }, fallback, { state: 'unknown' });
      const cur = await this.state.storage.get('payout:' + payoutId);
      return this.reconcilePayout(payoutId, cur, depth + 1);
    };
    if (rec.status === 'confirmed') return { state: 'confirmed', sig: rec.sig, rec };
    if (rec.status === 'failed') return { state: 'failed', sig: rec.sig || '', rec };
    if ((rec.status === 'sent' || rec.status === 'sending') && rec.sig) {
      const st = await Pool.checkSignature(rec.sig, rec.blockhashInfo);
      if (st.state === 'confirmed') {
        if (await this.markPayoutConfirmed(payoutId, rec)) return { state: 'confirmed', sig: rec.sig, rec };
        return again({ sig: rec.sig });
      }
      if (st.state === 'failed') {
        if (await this.markPayoutFailed(payoutId, rec, { message: 'On-chain failure: ' + JSON.stringify(st.err), code: 'tx_failed' })) return { state: 'failed', sig: rec.sig, rec };
        return again({ sig: rec.sig });
      }
      if (st.state === 'expired') {
        if (await this.markPayoutFailed(payoutId, rec, { message: 'Never landed: blockhash expired (every RPC confirmed)', code: 'expired' })) return { state: 'failed', sig: rec.sig, expired: true, rec };
        return again({ sig: rec.sig });
      }
      return { state: st.state === 'unknown' ? 'unknown' : 'pending', seen: !!st.seen, sig: rec.sig, rec };
    }
    if (rec.status === 'building') {
      const age = Date.now() - (rec.createdAt || 0);
      if (rec.v === 2) {
        // New-code 'building' is written BEFORE signing; 'sending <sig>' is
        // written before any broadcast. So a stale v2 'building' never left.
        return age < 30000 ? { state: 'in_progress', rec } : { state: 'failed', rec };
      }
      // LEGACY 'building' (old code broadcast before saving the sig): the only
      // trace is the on-chain memo. Reconcile once the blockhash window closed,
      // scanning incrementally (cursor kept on the record) at most once per
      // LEGACY_SCAN_INTERVAL_MS, and give up honestly after a few windows.
      if (rec.needsSupport) return { state: 'needs_support', rec };
      if (age < 3 * 60 * 1000) return { state: 'unknown', rec };
      const scan = rec.legacyScan || {};
      if (scan.lastAt && Date.now() - scan.lastAt < LEGACY_SCAN_INTERVAL_MS) return { state: 'unknown', cached: true, rec };
      let hit = null;
      try { hit = await Pool.findPoolTxByMemo(this.env, 'payoutId:' + payoutId, (rec.createdAt || 0) - 60000, 4, scan.cursor || undefined); }
      catch (_) { hit = null; }
      if (hit && hit.found) {
        const fixed = Object.assign({}, rec, { sig: hit.sig, reconciledFrom: 'memo' });
        if (hit.err) {
          if (await this.markPayoutFailed(payoutId, fixed, { message: 'On-chain failure: ' + JSON.stringify(hit.err), code: 'tx_failed' }, rec.sig)) return { state: 'failed', sig: hit.sig, rec: fixed };
          return again({ sig: hit.sig });
        }
        if (await this.markPayoutConfirmed(payoutId, fixed, rec.sig)) return { state: 'confirmed', sig: hit.sig, rec: fixed };
        return again({ sig: hit.sig });
      }
      if (hit && hit.complete) {
        if (await this.markPayoutFailed(payoutId, rec, { message: 'Legacy building record: memo not found on chain', code: 'never_landed' })) return { state: 'failed', rec };
        return again({});
      }
      // Still inconclusive (or the RPC failed): remember how far the scan got.
      // Only a scan that actually ran counts as an attempt.
      const attempts = (Number(scan.attempts) || 0) + (hit ? 1 : 0);
      const needsSupport = attempts >= LEGACY_SCAN_MAX_ATTEMPTS;
      await this.patchLegacyRecord(payoutId, rec, { legacyScan: { attempts, lastAt: Date.now(), cursor: (hit && hit.cursor) || scan.cursor || null }, needsSupport: needsSupport || undefined });
      return { state: needsSupport ? 'needs_support' : 'unknown', rec };
    }
    return { state: 'unknown', sig: rec.sig || '', rec };
  }

  // ── SRV-1: one welcome per wallet, across every payoutId ever used ──
  // Builds (once) an index of legacy welcome payouts (payoutId 'faucet-<uuid>')
  // so wallets paid before the deterministic id existed are recognised too.
  async ensureWelcomeIndex() {
    if (this._fwIndexed) return;
    if (await this.state.storage.get('fw:index:v1')) { this._fwIndexed = true; return; }
    const rank = { building: 1, sent: 2, sending: 2, confirmed: 3 };
    let startAfter;
    for (let pages = 0; pages < 200; pages++) {
      const opts = { prefix: 'payout:faucet-', limit: 500 };
      if (startAfter) opts.startAfter = startAfter;
      const page = await this.state.storage.list(opts);
      if (!page || !page.size) break;
      const best = {};
      for (const [key, rec] of page) {
        startAfter = key;
        if (!rec || !rec.wallet || !rank[rec.status]) continue;
        let m = null; try { m = JSON.parse(String(rec.memo || '')); } catch (_) {}
        if (!m || m.k !== 'ost-new-here' || m.kind !== 'welcome') continue;
        const cand = { payoutId: key.slice('payout:'.length), sig: rec.sig || '', status: rec.status, createdAt: rec.createdAt || 0 };
        const cur = best[rec.wallet];
        if (!cur || rank[cand.status] > rank[cur.status]) best[rec.wallet] = cand;
      }
      const entries = Object.entries(best);
      for (let i = 0; i < entries.length; i += 100) {
        const chunk = {};
        for (const [w, cand] of entries.slice(i, i + 100)) {
          const prev = await this.state.storage.get('fw:' + w);
          if (!prev || (rank[cand.status] || 0) > (rank[prev.status] || 0)) chunk['fw:' + w] = cand;
        }
        if (Object.keys(chunk).length) await this.state.storage.put(chunk);
      }
      if (page.size < 500) break;
    }
    await this.state.storage.put('fw:index:v1', Date.now());
    this._fwIndexed = true;
  }
  // -> null | { payoutId, sig, state: 'confirmed'|'pending'|'failed'|'in_progress'|'unknown' }
  async welcomeRecord(wallet) {
    await this.ensureWelcomeIndex();
    const directId = 'faucet-welcome-' + wallet;
    const direct = await this.state.storage.get('payout:' + directId);
    const idx = await this.state.storage.get('fw:' + wallet);
    const candidates = [];
    if (direct) candidates.push(directId);
    if (idx && idx.payoutId && idx.payoutId !== directId) candidates.push(idx.payoutId);
    let fallback = null;
    for (const id of candidates) {
      const rec = id === directId ? direct : await this.state.storage.get('payout:' + id);
      if (!rec) continue;
      const r = await this.reconcilePayout(id, rec);
      const out = { payoutId: id, sig: r.sig || rec.sig || '', state: r.state };
      if (r.state !== 'failed') return out;
      fallback = fallback || out;
    }
    return fallback;
  }

  // ── SRV-3: is this a real, unpaid wallet prediction ticket? ──
  ticketMaxMultiple() {
    const m = Number(this.env && this.env.OST_TICKET_MAX_MULTIPLE);
    return Number.isFinite(m) && m >= 1 && m <= 50 ? m : TICKET_MAX_MULTIPLE;
  }
  async verifyPredictionTicket(wallet, memoJson, amt, payoutId) {
    const ticketId = cleanText(memoJson && memoJson.id, 128);
    if (/^p_/.test(ticketId)) {
      return { response: fail(403, 'server_settled', 'This position is settled by the OST server straight into your play balance — there is nothing to claim here.', { ticketId }) };
    }
    if (!SIG_RE.test(ticketId)) {
      return { response: fail(403, 'ticket_unverified', 'Only tickets staked on-chain from this wallet can be paid out here.', { ticketId: ticketId || null }) };
    }
    const tk = await this.state.storage.get('pticket:' + ticketId);
    if (tk && tk.payoutId !== payoutId) {
      if (tk.status === 'confirmed' || tk.status === 'sending' || tk.status === 'sent') {
        return { response: fail(409, 'already_paid', 'This ticket has already been paid.', { sig: tk.sig || '', payoutId: tk.payoutId }) };
      }
    }
    const sv = await this.resolveStake(ticketId);
    if (sv.response) return sv;
    const stake = sv.stake;
    if (stake.wallet !== wallet) return { response: fail(403, 'ticket_unverified', 'This ticket was staked by a different wallet.', { ticketId }) };
    // The OUTCOME of a wallet ticket is still client-asserted (D3 Phase 1), so
    // the bound is a server-side multiple of the stake. The memo price (user-
    // written) can only make it smaller, never larger.
    const mult = this.ticketMaxMultiple();
    const memoPrice = Number(stake.price);
    const priceMult = memoPrice > 0 ? 1 / Math.min(0.999, Math.max(TICKET_MIN_PRICE, memoPrice)) : mult;
    const maxOst = r6(stake.amount * Math.min(mult, priceMult));
    if (amt > maxOst * 1.0001 + 1e-6) {
      return { response: fail(409, 'payout_exceeds_ticket', 'This ticket can pay at most ' + maxOst + ' OST. While fast-market and venue results are not verified by the OST server (devnet), a ticket pays at most ' + Math.min(mult, r6(priceMult)) + 'x its ' + stake.amount + ' OST stake. Nothing was sent.', { maxOst, ticketId, stakeOst: stake.amount, maxMultiple: mult }) };
    }
    return { ticket: { id: ticketId, maxOst, stakeOst: stake.amount } };
  }

  // Is this cosign record a wallet-ticket stake? Only a peer-transfer of OST
  // (the OSTC mint) INTO the pool, carrying the prediction memo, that this
  // worker built itself. An OST->SOL cash-out (the pool pays SOL back in the
  // same tx), a fee-only tx, or an OSTG transfer (a PlayLedger deposit) never is.
  isStakeCosign(record) {
    if (!record || record.kind !== 'peer-transfer' || !record.sig) return false;
    if (String(record.memo || '').indexOf(PREDICTION_MEMO_PREFIX) !== 0) return false;
    let poolStr = '', ostMint = '';
    try { poolStr = Pool.getPoolKeypair(this.env).publicKey.toBase58(); ostMint = Pool.getMint(this.env).toBase58(); } catch (_) { return false; }
    return record.to === poolStr && record.mint === ostMint && Number(record.amount) > 0;
  }
  stakeFromCosign(cosignId, record) {
    const f = parsePredictionMemo(record.memo);
    return {
      ok: true, wallet: record.wallet, amount: r6(record.amount), mint: record.mint,
      price: Number(f.price) || null, side: f.side || '', market: f.market || '',
      memo: String(record.memo).slice(0, 200), verifiedAt: Date.now(), via: 'cosign:' + cosignId
    };
  }
  // -> { stake } | { response }
  async resolveStake(sig) {
    const cached = await this.state.storage.get('stake:' + sig);
    if (cached && cached.ok && /^(cosign:|chain-v2)/.test(String(cached.via || ''))) return { stake: cached };
    // 1) A transaction this worker BUILT (every cosign is indexed by its sig):
    //    trust our own record for WHAT it does; ask the chain only whether it landed.
    const cosignId = await this.state.storage.get('cosignsig:' + sig);
    const record = cosignId ? await this.state.storage.get('cosign:' + cosignId) : null;
    if (record) {
      if (!this.isStakeCosign(record)) {
        return { response: fail(403, 'ticket_unverified', 'That transaction is not a prediction stake (only an OST transfer into the OST pool with a market memo is), so it cannot be paid as a ticket.', { ticketId: sig }) };
      }
      let landed = record.status === 'confirmed' ? 'confirmed' : null;
      if (!landed) {
        const st = await Pool.checkSignature(sig, { blockhash: record.blockhash, lastValidBlockHeight: record.lastValidBlockHeight });
        landed = st.state;
      }
      if (landed === 'confirmed') {
        const stake = this.stakeFromCosign(cosignId, record);
        try { await this.state.storage.put('stake:' + sig, stake); } catch (_) {}
        return { stake };
      }
      if (landed === 'pending' || landed === 'unknown') {
        return { response: fail(409, 'stake_unconfirmed', 'This ticket\'s stake is not confirmed on Solana yet. Nothing was paid — try again in a minute.', { ticketId: sig, retryable: true }) };
      }
      return { response: fail(403, 'ticket_unverified', 'This ticket\'s stake never landed on Solana (' + landed + '), so it cannot be paid.', { ticketId: sig }) };
    }
    // 2) A stake sent before this worker indexed its cosigns: read the chain,
    //    accepting ONLY the plain shape of a stake (see verifyStakeOnChain).
    const stake = await this.verifyStakeOnChain(sig);
    if (stake && stake.ok) {
      try { await this.state.storage.put('stake:' + sig, stake); } catch (_) {}
      return { stake };
    }
    if (stake && stake.unavailable) return { response: fail(503, 'verify_unavailable', 'Could not verify this ticket on chain right now. Nothing was paid — try again shortly.', { retryable: true }) };
    return { response: fail(403, 'ticket_unverified', 'This ticket\'s stake could not be verified on chain (' + ((stake && stake.reason) || 'unknown') + '), so it cannot be paid.', { ticketId: sig }) };
  }

  // Read a stake transaction that this worker did not build. Accepted ONLY if
  // the whole transaction is a plain stake: confirmed without error, and every
  // top-level instruction is a memo, a compute-budget hint, the idempotent
  // create of the POOL's own OST account, or an OST transfer INTO the pool's
  // OST account authorised by one non-pool wallet; no inner transfers at all.
  // Anything else (a SOL leg, a pool leg, another program, an OSTG transfer
  // that PlayLedger credits as a deposit) is refused: such a tx can pay the
  // user back in the same breath (review R3/R4).
  async verifyStakeOnChain(sig) {
    let poolStr, ostMint, poolOstAta;
    try {
      poolStr = Pool.getPoolKeypair(this.env).publicKey.toBase58();
      ostMint = Pool.getMint(this.env).toBase58();
      poolOstAta = Pool.poolAta(this.env).toBase58();
    } catch (_) { return { ok: false, unavailable: true }; }
    let tx;
    try {
      tx = await Pool.withRpc('stake-verify', conn => conn.getParsedTransaction(sig, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 }));
    } catch (_) { return { ok: false, unavailable: true }; }
    if (!tx) return { ok: false, reason: 'not_found' };
    if (tx.meta && tx.meta.err) return { ok: false, reason: 'stake_failed' };
    const top = (tx.transaction && tx.transaction.message && tx.transaction.message.instructions) || [];
    const notPlain = { ok: false, reason: 'not_a_plain_stake' };
    let memo = '';
    let amount = 0, authority = '';
    for (const ix of top) {
      if (!ix) return notPlain;
      const prog = String(ix.program || '');
      const pid = String(ix.programId || '');
      if (prog === 'spl-memo' || pid === 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr') {
        if (typeof ix.parsed === 'string' && ix.parsed.indexOf(PREDICTION_MEMO_PREFIX) === 0) memo = ix.parsed;
        continue;
      }
      if (pid === COMPUTE_BUDGET_PROGRAM) continue;
      if (prog === 'spl-associated-token-account') {
        const acct = ix.parsed && ix.parsed.info && ix.parsed.info.account;
        if (String(acct || '') === poolOstAta) continue;
        return notPlain;
      }
      const p = ix.parsed;
      if ((prog === 'spl-token' || prog === 'spl-token-2022') && p && (p.type === 'transferChecked' || p.type === 'transfer')) {
        const info = p.info || {};
        if (String(info.destination || '') !== poolOstAta) return notPlain;
        if (info.mint && String(info.mint) !== ostMint) return notPlain;
        const auth = String(info.authority || info.multisigAuthority || '');
        if (!auth || auth === poolStr) return notPlain;
        if (authority && auth !== authority) return notPlain;
        authority = auth;
        amount += tokenAmountOf(info);
        continue;
      }
      return notPlain;
    }
    for (const g of (tx.meta && tx.meta.innerInstructions) || []) {
      for (const ix of g.instructions || []) {
        const t = ix && ix.parsed && ix.parsed.type;
        if (t === 'transfer' || t === 'transferChecked' || t === 'transferWithSeed') return notPlain;
      }
    }
    if (!memo) return { ok: false, reason: 'not_a_prediction_stake' };
    if (!(amount > 0) || !authority) return { ok: false, reason: 'no_stake_to_pool' };
    const fields = parsePredictionMemo(memo);
    return {
      ok: true, wallet: authority, amount: r6(amount), mint: ostMint,
      price: Number(fields.price) || null, side: fields.side || '', market: fields.market || '',
      memo: memo.slice(0, 200), blockTime: tx.blockTime || null, verifiedAt: Date.now(), via: 'chain-v2'
    };
  }

  // =======================================================================
  // GET /wallet/payout/status/:payoutId
  // =======================================================================
  async handlePayoutStatus(rawId) {
    const payoutId = cleanId(rawId, 'pay');
    let id = payoutId;
    let rec = await this.state.storage.get('payout:' + payoutId);
    let legacyPayoutId;
    if (!rec && payoutId.indexOf('faucet-welcome-') === 0) {
      // Wallets paid before the deterministic id: answer from the legacy index.
      const fw = await this.welcomeRecord(payoutId.slice('faucet-welcome-'.length));
      if (fw && fw.payoutId) { id = fw.payoutId; legacyPayoutId = fw.payoutId; rec = await this.state.storage.get('payout:' + id); }
    }
    if (!rec) return json({ ok: false, error: 'payout_not_found', code: 'payout_not_found', status: 'not_found', payoutId, message: 'No payout with this id has reached the server.' }, 404);
    // Reconcile writes are compare-and-set, so a slow read here can never
    // overwrite a newer attempt; the answer describes the CURRENT record.
    const r = await this.reconcilePayout(id, rec);
    const cur = r.rec || rec;
    const status = r.state === 'in_progress' ? 'pending' : r.state;
    let kind = cur.kind || '';
    let memoKindOf = '';
    if (!kind || kind === 'ost-new-here') { try { const m = JSON.parse(cur.memo || ''); kind = kind || String((m && m.k) || ''); memoKindOf = String((m && m.kind) || ''); } catch (_) {} }
    return json({ ok: true, payoutId, legacyPayoutId, status, sig: r.sig || cur.sig || '', ost: cur.ost, wallet: cur.wallet, kind: kind || undefined, memoKind: memoKindOf || undefined, origin: cur.origin || undefined, createdAt: cur.createdAt || 0, message: status === 'needs_support' ? NEEDS_SUPPORT_MESSAGE : undefined });
  }

  // =======================================================================
  // POST /wallet/ata-rent  { owner, mint? }
  // Pool-paid ATA creation. With the IDEMPOTENT create a false "missing" can no
  // longer fail on-chain (SRV-5), and an existing account answers in one read.
  // =======================================================================
  async handleAtaRent(request) {
    let body; try { body = await request.json(); } catch (_) { return fail(400, 'invalid_json', 'Request body must be JSON.'); }
    const ownerStr = cleanText(body && body.owner, 64);
    if (!isValidPubkey(ownerStr)) return fail(400, 'invalid_owner', 'That is not a valid Solana wallet address.');
    const owner = new PublicKey(ownerStr);
    // Which token's account to create. Defaults to OST; OSTG is allowed so a
    // seedless user (no SOL) can hold the game token without paying rent.
    let mint;
    try { mint = Pool.resolveSponsoredMint(this.env, cleanText(body && body.mint, 64)); }
    catch (_) { return fail(400, 'mint_not_sponsored', 'OST only sponsors accounts for OST and OSTG.'); }
    const ata = Pool.ataForMint(owner, mint);
    let exists = null;
    try { exists = await Pool.ataExists(null, ata); } catch (_) { exists = null; }
    if (exists === true) return json({ ok: true, created: false, ata: ata.toBase58() });
    // SRV-8: the pool pays ~0.002 SOL of rent here, and a token account can be
    // closed to reclaim that rent, so creations are budgeted per owner and from
    // the same global daily budget as sponsored recipients.
    const sp = await this.sponsorReserve('ata', ownerStr);
    if (sp.refused) return fail(409, 'sponsor_daily_cap', sp.refused.message, { reason: sp.refused.reason, retryAfterMs: sp.refused.retryAfterMs });
    const pool = Pool.getPoolKeypair(this.env);
    let sent;
    try {
      sent = await Pool.buildSignSend(this.env, [Pool.ixCreateAta(pool.publicKey, ata, owner, mint)], [], 'ATA rent');
    } catch (e) {
      if (e && e.preBroadcast) { await this.sponsorRelease(sp.ticket); return preBroadcastResponse(e); }
      throw e;
    }
    try {
      await Pool.confirmSignature(sent.sig, sent.blockhashInfo, { label: 'ATA rent', timeoutMs: 10000 });
    } catch (e) {
      if (e && e.code === 'tx_failed') {
        await this.sponsorRelease(sp.ticket);
        return fail(422, 'tx_failed', 'Creating the token account failed on chain. Nothing was charged to you.', { code: e.reason || 'tx_failed', sig: sent.sig, ata: ata.toBase58() });
      }
      return json({ ok: true, pending: true, sig: sent.sig, ata: ata.toBase58(), created: exists === false ? true : null }, 202);
    }
    return json({ ok: true, created: exists === false ? true : null, ata: ata.toBase58(), sig: sent.sig });
  }

  // ── SRV-8: budget for pool-sponsored account creation ──
  sponsorLimits() {
    const per = Number(this.env && this.env.OST_SPONSOR_PER_SENDER_DAILY);
    const lam = Number(this.env && this.env.OST_SPONSOR_DAILY_LAMPORTS);
    return {
      perSender: Number.isFinite(per) && per >= 0 ? per : SPONSOR_PER_SENDER_DAILY,
      perOwnerAta: SPONSOR_ATA_RENT_PER_OWNER_DAILY,
      dailyLamports: Number.isFinite(lam) && lam >= 0 ? lam : SPONSOR_DAILY_LAMPORTS
    };
  }
  // Check AND charge in one storage-only lock (review: checking at build but
  // counting at submit let 15 quotes built first all pass a cap of 10, and a
  // client that broadcast the pool-signed quote itself was never counted).
  //   kind 'peer': per SENDER (recipient accounts) | 'ata': per OWNER (/wallet/ata-rent)
  // -> { ticket: {kind, who, day} } | { refused: {reason, message, retryAfterMs} }
  async sponsorReserve(kind, who) {
    return this.state.blockConcurrencyWhile(async () => {
      const now = Date.now();
      const day = Math.floor(now / DAY_MS);
      const lim = this.sponsorLimits();
      const wk = (kind === 'ata' ? 'sponsor:a:' : 'sponsor:w:') + who + ':' + day;
      const perLimit = kind === 'ata' ? lim.perOwnerAta : lim.perSender;
      const per = Number((await this.state.storage.get(wk)) || 0);
      const glob = (await this.state.storage.get('sponsor:g:' + day)) || { count: 0, lamports: 0 };
      const retryAfterMs = (day + 1) * DAY_MS - now;
      if (per >= perLimit) {
        return { refused: kind === 'ata'
          ? { reason: 'owner_daily_cap', retryAfterMs, message: 'OST already opened ' + perLimit + ' token accounts for this wallet today. Nothing was sent — try again tomorrow.' }
          : { reason: 'sender_daily_cap', retryAfterMs, message: 'OST already paid to open ' + perLimit + ' new recipient accounts for this wallet today. The recipient needs an OST account first (they can claim free OST), or try again tomorrow.' } };
      }
      if (Number(glob.lamports || 0) + Pool.SPONSORED_ATA_LAMPORTS > lim.dailyLamports) {
        return { refused: kind === 'ata'
          ? { reason: 'daily_budget', retryAfterMs, message: 'OST\'s daily budget for opening token accounts is used up. Nothing was sent — try again tomorrow.' }
          : { reason: 'daily_budget', retryAfterMs, message: 'OST\'s daily budget for opening new recipient accounts is used up. The recipient needs an OST account first (they can claim free OST), or try again tomorrow.' } };
      }
      await this.state.storage.put({ [wk]: per + 1, ['sponsor:g:' + day]: { count: Number(glob.count || 0) + 1, lamports: Number(glob.lamports || 0) + Pool.SPONSORED_ATA_LAMPORTS } });
      return { ticket: { kind, who, day } };
    });
  }
  // Credit a charge back — only when nothing was created: the quote was never
  // signed, or it provably never landed / landed and failed. Never inside a lock.
  async sponsorRelease(t) {
    if (!t || t.released) return;
    t.released = true;
    try {
      await this.state.blockConcurrencyWhile(async () => {
        const wk = (t.kind === 'ata' ? 'sponsor:a:' : 'sponsor:w:') + t.who + ':' + t.day;
        const per = Number((await this.state.storage.get(wk)) || 0);
        const glob = await this.state.storage.get('sponsor:g:' + t.day);
        const puts = {};
        if (per > 0) puts[wk] = per - 1;
        if (glob && Number(glob.count) > 0) puts['sponsor:g:' + t.day] = { count: Number(glob.count) - 1, lamports: Math.max(0, Number(glob.lamports || 0) - Pool.SPONSORED_ATA_LAMPORTS) };
        if (Object.keys(puts).length) await this.state.storage.put(puts);
      });
    } catch (_) {}
  }
  // A sponsored quote whose outcome is now KNOWN to have created nothing.
  // The "already credited" marker is its own key, so a later write of a stale
  // copy of the cosign record can never re-arm a second credit.
  async releaseSponsoredQuote(cosignId, record) {
    if (!record || !record.sponsorTicket) return;
    try {
      const first = await this.state.blockConcurrencyWhile(async () => {
        if (await this.state.storage.get('sponsorrel:' + cosignId)) return false;
        await this.state.storage.put('sponsorrel:' + cosignId, Date.now());
        return true;
      });
      if (first) await this.sponsorRelease(Object.assign({}, record.sponsorTicket));
    } catch (_) {}
  }

  // =======================================================================
  // POST /wallet/cosign  { kind, wallet, amount, memo, to?, mint? }
  // kind: 'sol-to-ost' | 'ost-to-sol' | 'peer-transfer' | 'fee-only'
  // Every amount/balance/rent rule is checked HERE and the built tx is
  // SIMULATED before the user is ever asked to sign (SRV-6): a doomed transfer
  // is refused in well under a second, and no pool transaction is created.
  // =======================================================================
  async handleCosignBuild(request) {
    let body; try { body = await request.json(); } catch (_) { return fail(400, 'invalid_json', 'Request body must be JSON.'); }
    const kind = cleanText(body && body.kind, 32);
    const walletStr = cleanText(body && body.wallet, 64);
    const amt = cleanNumber(body && body.amount, null);
    const memo = cleanText(body && body.memo, 200);
    const toStr = cleanText(body && body.to, 64);
    const mintStr = cleanText(body && body.mint, 64);
    if (!isValidPubkey(walletStr)) return fail(400, 'invalid_wallet', 'That is not a valid Solana wallet address.');
    if (kind !== 'fee-only' && !(amt > 0)) return fail(400, 'invalid_amount', 'Enter an amount greater than zero.');
    // A conversion pays the user back in the same transaction, so it must never
    // look like a prediction stake (review R3: an OST->SOL cash-out carrying the
    // stake memo was then claimed as a ticket — SOL AND an OST payout).
    if ((kind === 'sol-to-ost' || kind === 'ost-to-sol') && memo.indexOf(PREDICTION_MEMO_PREFIX) === 0) {
      return fail(400, 'invalid_memo', 'A conversion cannot carry a prediction-stake memo. Nothing was signed or sent.');
    }
    const rsb = await this.rateState('cosignbuild', walletStr, COSIGN_BUILD_LIMIT);
    if (rsb.limited) return this.rateLimited('cosign', rsb);
    const rss = await this.rateState('cosign', walletStr, COSIGN_RATE_LIMIT);
    if (rss.limited) return this.rateLimited('cosign', rss);

    const owner = new PublicKey(walletStr);
    const pool = Pool.getPoolKeypair(this.env);
    const ostMint = Pool.getMint(this.env);
    const poolOstAta = Pool.poolAta(this.env);
    const ownerOstAta = Pool.userAta(this.env, owner);

    let instructions = [];
    let quote = null;
    let asset = 'OST';
    let mintUsed = ostMint;
    let sponsoredAta = false;
    let sponsorTicket = null;
    let destStr = '';

    // Balance pre-check shared by every kind that spends the user's tokens.
    const tokenCheck = async (ata, needOst, assetName) => {
      let acct;
      try { acct = await Pool.readTokenAccount(ata); } catch (_) { return null; }   // unknown: simulation decides
      if (!acct.exists) return fail(422, 'no_token_account', 'This wallet has no ' + assetName + ' yet.', { asset: assetName, have: 0 });
      const need = Pool.decimalToRawAmount(needOst, Pool.OST_TOKEN_DECIMALS);
      if (acct.raw < need) {
        const have = Pool.rawToOstNumber(acct.raw, Pool.OST_TOKEN_DECIMALS);
        return fail(422, 'insufficient_balance', 'You have ' + Pool.formatOstAmount(have) + ' ' + assetName + ' — not enough to send ' + Pool.formatOstAmount(needOst) + '.', { asset: assetName, have });
      }
      return null;
    };

    if (kind === 'fee-only') {
      const rawList = Array.isArray(body && body.instructions) ? body.instructions : null;
      if (!rawList || !rawList.length || rawList.length > 10) return fail(400, 'invalid_instructions', 'Send between 1 and 10 instructions.');
      try {
        instructions = rawList.map(Pool.ixFromJson);
        Pool.assertPoolAbsent(instructions, pool.publicKey);
      } catch (e) {
        return fail(400, 'invalid_instructions', String(e && e.message || e).slice(0, 200));
      }
      // The pool pays this transaction's fee, so the CLIENT must not choose it:
      // ComputeBudget instructions carry no account keys (assertPoolAbsent
      // cannot see them) yet set the priority fee (review: 1.4M CU x 3e10
      // micro-lamports = a 42 SOL fee from one request).
      const cb = Pool.checkComputeBudget(instructions, { maxUnitLimit: FEE_ONLY_MAX_CU_LIMIT, maxUnitPrice: FEE_ONLY_MAX_CU_PRICE });
      if (!cb.ok) return fail(400, 'invalid_instructions', cb.message + ' Nothing was signed or sent.', { reason: cb.reason });
      asset = 'OSTG';
    } else if (kind === 'sol-to-ost') {
      const q = await Pool.quoteSolToOst(this.env, amt);
      if (!(q.ost > 0)) return fail(400, 'quote_too_small', 'That amount is too small to convert.');
      const cfg = Pool.vaultConfig(this.env);
      const poolBal = await Pool.getPoolOstBalance(this.env);
      const dynamicCap = cfg.maxPayoutFraction > 0 ? poolBal * cfg.maxPayoutFraction : Infinity;
      if (q.ost > dynamicCap || (cfg.maxSinglePayout > 0 && q.ost > cfg.maxSinglePayout)) return fail(409, 'solvency_cap', 'That conversion is larger than the vault can pay in one go. Try a smaller amount.');
      if (poolBal + 1e-9 < q.ost) return fail(409, 'insufficient_pool', 'The OST vault needs a refill before this conversion.');
      // RNT-1: the wallet must end at 0 lamports or at least the rent minimum.
      const lamportsOut = Math.round(amt * 1e9);
      let ownerLamports = null;
      try { ownerLamports = await Pool.getLamports(owner); } catch (_) { ownerLamports = null; }
      if (ownerLamports != null) {
        if (lamportsOut > ownerLamports) return fail(422, 'insufficient_balance', 'You have ' + (ownerLamports / 1e9) + ' SOL — not enough to convert ' + amt + ' SOL.', { asset: 'SOL', have: ownerLamports / 1e9 });
        const remainder = ownerLamports - lamportsOut;
        if (remainder > 0 && remainder < Pool.RENT_EXEMPT_MIN_LAMPORTS) {
          const maxSol = Math.max(0, ownerLamports - Pool.RENT_EXEMPT_MIN_LAMPORTS) / 1e9;
          return fail(409, 'keep_rent_reserve', 'Solana needs at least 0.00089 SOL left in a wallet. Convert at most ' + maxSol + ' SOL, or all ' + (ownerLamports / 1e9) + ' SOL.', { maxSol, allSol: ownerLamports / 1e9, minRemainSol: Pool.RENT_EXEMPT_MIN_LAMPORTS / 1e9 });
        }
      }
      quote = { solAmount: amt, ostAmount: q.ost, fee: q.fee, rate: q.solUsd / q.ostUsd, solUsd: q.solUsd, ostUsd: q.ostUsd };
      instructions.push(Pool.ixCreateAta(pool.publicKey, ownerOstAta, owner, ostMint));
      instructions.push(Pool.ixSolTransfer(owner, pool.publicKey, lamportsOut));
      instructions.push(Pool.ixTransferChecked(poolOstAta, ostMint, ownerOstAta, pool.publicKey, Pool.decimalToRawAmount(q.ost, Pool.OST_TOKEN_DECIMALS), Pool.OST_TOKEN_DECIMALS));
      if (memo) instructions.push(Pool.ixMemo(memo, owner));
      asset = 'SOL';
    } else if (kind === 'ost-to-sol') {
      const q = await Pool.quoteOstToSol(this.env, amt);
      if (!(q.sol > 0)) return fail(400, 'quote_too_small', 'That amount is too small to convert.');
      const poolSol = await Pool.getPoolSolBalance(this.env);
      const solReserve = 0.05; // keep enough SOL to keep paying fees
      if (poolSol - q.sol < solReserve) return fail(409, 'insufficient_pool_sol', 'The SOL side of the vault is low right now. Try a smaller amount later.');
      const bad = await tokenCheck(ownerOstAta, amt, 'OST');
      if (bad) return bad;
      // RNT-1: a wallet that ends below the rent minimum makes the whole tx fail.
      const solLamports = Math.round(q.sol * 1e9);
      let ownerLamports = null;
      try { ownerLamports = await Pool.getLamports(owner); } catch (_) { ownerLamports = null; }
      if (ownerLamports != null && ownerLamports + solLamports < Pool.RENT_EXEMPT_MIN_LAMPORTS) {
        const needLamports = Pool.RENT_EXEMPT_MIN_LAMPORTS - ownerLamports;
        const minOst = Math.ceil(((needLamports / 1e9) * q.solUsd / q.ostUsd / (1 - 0.005)) * 100) / 100;
        return fail(409, 'below_rent_minimum', 'Solana needs at least 0.00089 SOL in a wallet, so a first cash-out must be at least ' + minOst + ' OST.', { minOst, minRemainSol: Pool.RENT_EXEMPT_MIN_LAMPORTS / 1e9 });
      }
      quote = { ostAmount: amt, solAmount: q.sol, fee: q.fee, rate: q.solUsd / q.ostUsd, solUsd: q.solUsd, ostUsd: q.ostUsd };
      instructions.push(Pool.ixTransferChecked(ownerOstAta, ostMint, poolOstAta, owner, Pool.decimalToRawAmount(amt, Pool.OST_TOKEN_DECIMALS), Pool.OST_TOKEN_DECIMALS));
      instructions.push(Pool.ixSolTransfer(pool.publicKey, owner, solLamports));
      if (memo) instructions.push(Pool.ixMemo(memo, owner));
    } else if (kind === 'peer-transfer') {
      if (!isValidPubkey(toStr)) return fail(400, 'invalid_destination', 'That is not a valid Solana address.');
      // TRF-2: OST (default) or OSTG.
      try { mintUsed = Pool.resolveSponsoredMint(this.env, mintStr); }
      catch (_) { return fail(400, 'mint_not_sponsored', 'Only OST and OSTG can be sent this way.'); }
      asset = mintUsed.toBase58() === Pool.OSTG_MINT ? 'OSTG' : 'OST';
      const dest = new PublicKey(toStr);
      destStr = dest.toBase58();
      if (destStr === walletStr) return fail(400, 'invalid_destination', 'That is your own wallet.', { reason: 'self' });
      if (destStr === Pool.OSTC_MINT || destStr === Pool.OSTG_MINT) return fail(400, 'invalid_destination', 'That address is a token mint, not a wallet.', { reason: 'mint' });
      const ownerAta = Pool.ataForMint(owner, mintUsed);
      const destAta = Pool.ataForMint(dest, mintUsed);
      const poolDest = destStr === pool.publicKey.toBase58();
      const bad = await tokenCheck(ownerAta, amt, asset);
      if (bad) return bad;
      quote = { ostAmount: amt, asset, mint: mintUsed.toBase58() };
      let destExists = null;
      if (!poolDest) { try { destExists = await Pool.ataExists(null, destAta); } catch (_) { destExists = null; } }
      if (!poolDest && destExists !== true) {
        // The pool would pay rent to open the recipient's account (SRV-8).
        let meta = null;
        try { meta = await Pool.accountMeta(dest); } catch (_) { meta = null; }
        if (meta && meta.exists && meta.owner && meta.owner !== '11111111111111111111111111111111') {
          return fail(400, 'invalid_destination', 'That address is a program or token account, not a wallet. Ask for their wallet address.', { reason: 'not_a_wallet' });
        }
        if (!PublicKey.isOnCurve(dest.toBytes())) {
          return fail(409, 'recipient_needs_account', 'That address is a program-owned address without an ' + asset + ' account. It has to open one before it can receive.', { reason: 'off_curve' });
        }
        // Charged NOW, before the pool signs anything (SRV-8 + review).
        const sp = await this.sponsorReserve('peer', walletStr);
        if (sp.refused) return fail(409, 'recipient_needs_account', sp.refused.message, { reason: sp.refused.reason, retryAfterMs: sp.refused.retryAfterMs });
        sponsorTicket = sp.ticket;
        instructions.push(Pool.ixCreateAta(pool.publicKey, destAta, dest, mintUsed));
        sponsoredAta = true;
      }
      instructions.push(Pool.ixTransferChecked(ownerAta, mintUsed, destAta, owner, Pool.decimalToRawAmount(amt, Pool.OST_TOKEN_DECIMALS), Pool.OST_TOKEN_DECIMALS));
      if (memo) instructions.push(Pool.ixMemo(memo, owner));
    } else {
      return fail(400, 'unknown_kind', 'Unknown transaction kind.');
    }

    // From here on nothing has been handed to the client yet: any refusal or
    // error gives a sponsorship charge back.
    try {
      const built = await Pool.buildAndPartialSignByPool(this.env, instructions);
      if (kind === 'fee-only') {
        // Bound what the pool can be made to pay: signatures x 5000 lamports
        // plus the (already capped) priority fee.
        const fee = Pool.estimateFeeLamports(built.tx);
        if (fee.signers > FEE_ONLY_MAX_SIGNERS || fee.lamports > FEE_ONLY_MAX_FEE_LAMPORTS) {
          return await this.refuseBuild(sponsorTicket, fail(400, 'invalid_instructions', 'This transaction would cost the OST fee payer too much (' + fee.signers + ' signatures, ' + fee.lamports + ' lamports). Nothing was signed or sent.', { reason: 'fee_too_high', signers: fee.signers, feeLamports: fee.lamports }));
        }
      }
      // SRV-6: simulate first. A tx the network would reject is refused NOW,
      // before the user signs and before the pool pays a fee for a doomed send.
      const sim = await Pool.simulateTx(built.tx, { asset });
      if (sim.ok === false) {
        if (sim.code === 'blockhash_expired') return await this.refuseBuild(sponsorTicket, fail(409, 'blockhash_expired', sim.message, { retryable: true }));
        const extra = { code: sim.code, asset: sim.asset || asset, logs: (sim.logs || []).slice(-6) };
        if (sim.code === 'insufficient_balance') {
          const have = await this.haveForRefusal(kind, owner, sim.asset || asset, mintUsed);
          if (have != null) extra.have = have;
        }
        return await this.refuseBuild(sponsorTicket, fail(422, 'simulation_failed', sim.message, extra));
      }
      const cosignId = cleanId(crypto.randomUUID(), 'cosign');
      const record = {
        kind, wallet: walletStr, quote,
        blockhash: built.blockhashInfo.blockhash,
        lastValidBlockHeight: built.blockhashInfo.lastValidBlockHeight,
        createdAt: Date.now(),
        status: 'built',
        sig: built.sig,
        amount: amt, asset, to: destStr || undefined,
        mint: mintUsed.toBase58(),
        memo: memo || undefined,
        sponsoredAta: sponsoredAta || undefined,
        sponsorTicket: sponsorTicket || undefined
      };
      // 'cosignsig:<sig>' indexes every tx this worker built, so a later
      // ticket claim can tell OUR stake from any other transaction (SRV-3).
      try { await this.state.storage.put({ ['cosign:' + cosignId]: record, ['cosignsig:' + built.sig]: cosignId }); }
      catch (_) { return await this.refuseBuild(sponsorTicket, fail(503, 'gate_reset', 'The OST service restarted. Nothing was signed or sent — try again.', { retryable: true })); }
      await this.rateCount('cosignbuild', walletStr);
      return json({ ok: true, cosignId, kind, quote, sig: built.sig, txBase64: Pool.txToBase64(built.tx), blockhash: built.blockhashInfo.blockhash, lastValidBlockHeight: built.blockhashInfo.lastValidBlockHeight, simulated: sim.ok === true, sponsoredAta });
    } catch (e) {
      await this.sponsorRelease(sponsorTicket);
      throw e;
    }
  }
  async refuseBuild(sponsorTicket, response) {
    await this.sponsorRelease(sponsorTicket);
    return response;
  }
  // `have` for an insufficient_balance refusal (contract C3), best effort.
  async haveForRefusal(kind, owner, assetName, mintPk) {
    try {
      if (assetName === 'SOL') return (await Pool.getLamports(owner)) / 1e9;
      const acct = await Pool.readTokenAccount(Pool.ataForMint(owner, kind === 'peer-transfer' ? mintPk : Pool.getMint(this.env)));
      return acct.exists ? Pool.rawToOstNumber(acct.raw, Pool.OST_TOKEN_DECIMALS) : 0;
    } catch (_) { return null; }
  }

  // After a cosign is broadcast (confirmed or still confirming): count it, and
  // remember a prediction stake so its later claim verifies without an RPC read.
  // (Sponsorship was already charged when the quote was signed.)
  async afterCosignSent(cosignId, record, confirmed) {
    await this.rateCount('cosign', record.wallet);
    try {
      if (confirmed && this.isStakeCosign(record)) {
        await this.state.storage.put('stake:' + record.sig, this.stakeFromCosign(cosignId, record));
      }
    } catch (_) {}
  }

  // =======================================================================
  // POST /wallet/cosign/submit  { cosignId, signedTxBase64 }
  // =======================================================================
  async handleCosignSubmit(request) {
    let body; try { body = await request.json(); } catch (_) { return fail(400, 'invalid_json', 'Request body must be JSON.'); }
    const cosignId = cleanText(body && body.cosignId, 80);
    const signedTxBase64 = cleanText(body && body.signedTxBase64, 4000);
    if (!cosignId || !signedTxBase64) return fail(400, 'missing_fields', 'cosignId and signedTxBase64 are required.');

    const record = await this.state.storage.get('cosign:' + cosignId);
    if (!record) return fail(404, 'cosign_not_found', 'This quote is unknown or too old — request a new one.');
    if (record.status === 'confirmed' && record.sig) return json({ ok: true, sig: record.sig, idempotent: true, cosignId });
    const bh = { blockhash: record.blockhash, lastValidBlockHeight: record.lastValidBlockHeight };
    if ((record.status === 'sending' || record.status === 'sent') && record.sig) {
      // A resubmit of something already broadcast: never build or sign again.
      // If the caller re-posted the IDENTICAL signed tx, re-broadcast those
      // exact bytes (same signature: the network dedupes, so it cannot move
      // money twice) — this recovers a reset between 'sending' and the send.
      try {
        const again = Pool.txFromBase64(signedTxBase64);
        if (Pool.signatureOf(again) === record.sig) await Pool.sendSerialized(again.serialize(), record.sig, { label: 'Cosigned transfer (resume)' });
      } catch (_) {}
      try {
        await Pool.confirmSignature(record.sig, bh, { label: 'Cosigned transfer', timeoutMs: 8000 });
      } catch (e) {
        if (e && e.code === 'tx_failed') {
          try { await this.state.storage.put('cosign:' + cosignId, Object.assign({}, record, { status: 'failed', failCode: e.reason })); } catch (_) {}
          await this.releaseSponsoredQuote(cosignId, record);   // a failed tx created nothing
          return fail(422, 'tx_failed', e.humanMessage || 'The transaction failed on chain, so nothing moved.', { code: e.reason || 'tx_failed', sig: record.sig, cosignId });
        }
        const st = await Pool.checkSignature(record.sig, bh);
        if (st.state === 'expired') {
          try { await this.state.storage.put('cosign:' + cosignId, Object.assign({}, record, { status: 'expired' })); } catch (_) {}
          await this.releaseSponsoredQuote(cosignId, record);
          return fail(409, 'blockhash_expired', 'This transfer never landed and its quote has expired. Nothing moved — request a new quote.', { sig: record.sig, cosignId, retryable: true });
        }
        return json({ ok: true, pending: true, sig: record.sig, cosignId, idempotent: true, message: 'Sent — still confirming. Check your balance before trying again.' }, 202);
      }
      try { await this.state.storage.put('cosign:' + cosignId, Object.assign({}, record, { status: 'confirmed', confirmedAt: Date.now() })); } catch (_) {}
      return json({ ok: true, sig: record.sig, idempotent: true, cosignId });
    }
    if (record.status === 'expired' || record.status === 'failed') {
      return fail(409, 'blockhash_expired', 'This quote is no longer valid. Nothing moved — request a new one.', { cosignId, retryable: true });
    }

    let tx;
    try { tx = Pool.txFromBase64(signedTxBase64); }
    catch (_) { return fail(400, 'invalid_transaction', 'That is not a valid transaction.'); }
    if (tx.recentBlockhash !== record.blockhash) {
      return fail(409, 'blockhash_expired', 'This quote is stale, request a new one.', { retryable: true });
    }
    const sig = Pool.signatureOf(tx);
    if (record.sig && sig !== record.sig) return fail(400, 'invalid_transaction', 'This is not the transaction OST signed for this quote.');
    let serialized;
    try { serialized = tx.serialize(); }
    catch (_) { return fail(400, 'invalid_signature', 'The wallet signature is missing or invalid. Nothing was sent.'); }

    // Persist 'sending <sig>' BEFORE the broadcast (SRV-2). If this write
    // fails, nothing has been sent and the client may simply retry.
    try { await this.state.storage.put('cosign:' + cosignId, Object.assign({}, record, { status: 'sending', sig, sendingAt: Date.now() })); }
    catch (_) { return fail(503, 'gate_reset', 'The OST service restarted before sending. Nothing was sent — try again.', { retryable: true, sig }); }
    const sending = Object.assign({}, record, { status: 'sending', sig });

    let sent;
    try {
      sent = await Pool.sendSerialized(serialized, sig, { label: 'Cosigned transfer', asset: record.asset, feePayer: tx.feePayer, programIds: tx.instructions.map(ix => ix.programId.toBase58()) });
    } catch (e) {
      if (e && e.preBroadcast) {
        try { await this.state.storage.put('cosign:' + cosignId, Object.assign({}, record, { status: e.code === 'blockhash_expired' ? 'expired' : 'built', lastError: String(e.message || '').slice(0, 200) })); } catch (_) {}
        return preBroadcastResponse(e);
      }
      throw e;
    }
    faultAfterBroadcast(this.env, 'cosign-submit');

    try {
      await Pool.confirmSignature(sig, bh, { label: 'Cosigned transfer' });
    } catch (e) {
      if (e && e.code === 'tx_failed') {
        try { await this.state.storage.put('cosign:' + cosignId, Object.assign({}, sending, { status: 'failed', failCode: e.reason })); } catch (_) {}
        await this.releaseSponsoredQuote(cosignId, sending);
        return fail(422, 'tx_failed', e.humanMessage || 'The transaction failed on chain, so nothing moved.', { code: e.reason || 'tx_failed', sig, cosignId });
      }
      await this.afterCosignSent(cosignId, sending, false);
      return json({ ok: true, pending: true, sig, cosignId, message: 'Sent — still confirming. Check your balance before trying again.', uncertain: !!sent.uncertain }, 202);
    }
    try { await this.state.storage.put('cosign:' + cosignId, Object.assign({}, sending, { status: 'confirmed', confirmedAt: Date.now() })); } catch (_) {}
    await this.afterCosignSent(cosignId, sending, true);
    return json({ ok: true, sig, cosignId });
  }

  // =======================================================================
  // GET /wallet/cosign/status/:cosignId
  // =======================================================================
  async handleCosignStatus(rawId) {
    const cosignId = cleanText(rawId, 80);
    const record = await this.state.storage.get('cosign:' + cosignId);
    if (!record) return json({ ok: false, error: 'cosign_not_found', code: 'cosign_not_found', status: 'not_found', cosignId, message: 'No such quote on the server.' }, 404);
    const base = { ok: true, cosignId, kind: record.kind, quote: record.quote || null, sig: record.sig || '' };
    if (record.status === 'confirmed') return json(Object.assign(base, { status: 'confirmed' }));
    if (record.status === 'failed') return json(Object.assign(base, { status: 'failed', code: record.failCode || 'tx_failed' }));
    if (!record.sig) return json(Object.assign(base, { status: record.status === 'built' ? 'built' : 'unknown' }));
    const st = await Pool.checkSignature(record.sig, { blockhash: record.blockhash, lastValidBlockHeight: record.lastValidBlockHeight });
    if (st.state === 'confirmed') {
      try { await this.state.storage.put('cosign:' + cosignId, Object.assign({}, record, { status: 'confirmed', confirmedAt: Date.now() })); } catch (_) {}
      if (record.status === 'built') await this.afterCosignSent(cosignId, record, true);   // signed+sent by the wallet itself
      return json(Object.assign(base, { status: 'confirmed' }));
    }
    if (st.state === 'failed') {
      try { await this.state.storage.put('cosign:' + cosignId, Object.assign({}, record, { status: 'failed', failCode: 'tx_failed' })); } catch (_) {}
      await this.releaseSponsoredQuote(cosignId, record);
      return json(Object.assign(base, { status: 'failed', code: 'tx_failed' }));
    }
    if (st.state === 'expired') {
      // Proven by every RPC (checkSignature): it can never land, so a
      // sponsored recipient account was never created — credit the charge.
      await this.releaseSponsoredQuote(cosignId, record);
      return json(Object.assign(base, { status: 'expired', message: 'Never landed — its quote expired. Nothing moved.' }));
    }
    // A quote that was built but never seen on chain is just a quote.
    if (record.status === 'built' && !st.seen) return json(Object.assign(base, { status: 'built' }));
    return json(Object.assign(base, { status: st.state === 'unknown' ? 'unknown' : 'pending' }));
  }
}

export function walletPayoutsDoId(env) {
  return env.PAYOUT_GATE.idFromName('global');
}

// Every stub call is wrapped: a Durable Object reset must reach the browser as
// a readable, CORS-enabled 503 (contract C4), never an opaque platform error.
export async function handleWalletPayoutsRequest(request, env) {
  if (!env.PAYOUT_GATE) return fail(503, 'payout_gate_not_configured', 'The OST payout service is not configured.');
  try {
    const id = walletPayoutsDoId(env);
    return await env.PAYOUT_GATE.get(id).fetch(request);
  } catch (err) {
    return fail(503, 'gate_reset', 'The OST payout service restarted mid-request. If you already signed, check the status before retrying — a retry with the same id never pays twice.', { retryable: true, detail: String((err && err.message) || err).slice(0, 160) });
  }
}

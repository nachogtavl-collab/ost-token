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
import { GAMES, computeBet, randomSeedHex, sha256Hex } from './play-games.js';

const MAX_BATCH = 50;          // auto-bet: at most N nonces per /play/bet call
const POOL_CACHE_MS = 20000;   // re-read pool OSTG for solvency at most this often

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

      if (path === '/play/cashout' && method === 'POST') return await this.handleCashout(request);

      if (path === '/play/seed' && method === 'GET') return await this.handleSeed(url);
      if (path === '/play/bet' && method === 'POST') return await this.handleBet(request);
      if (path === '/play/rotate' && method === 'POST') return await this.handleRotate(request);

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

  // CASH OUT — the drain-sensitive pool -> user OSTG send. Every safety property
  // here is load-bearing; this is the fake-signature bug's favourite costume.
  //
  //  · LEDGER-GATED: debit the play balance under the lock BEFORE sending. A
  //    cash-out for more than the balance is rejected with no debit and no send.
  //  · IDEMPOTENT per client idempotencyKey: a retry re-confirms the SAME
  //    signature, never sends again (crash-after-broadcast = double-pay otherwise;
  //    this is the exact Phase 0 lesson from PayoutGate).
  //  · REFUND on a broadcast that never left: if buildSignSend throws, the tx did
  //    not land, so the debit is restored. A 'building' crash (broadcast may have
  //    landed) is NOT auto-refunded and NOT auto-resent — it needs human
  //    reconciliation, because guessing either way risks a double-pay or a drain.
  //  · Never fabricates a signature. A failed/unconfirmed cash-out says so.
  async handleCashout(request) {
    let body; try { body = await request.json(); } catch (_) { return json({ error: 'invalid_json' }, 400); }
    const wallet = cleanText(body && body.wallet, 64);
    const amount = Number(body && body.amount);
    const id = cleanText(body && body.idempotencyKey, 96);
    if (!isPubkey(wallet)) return json({ error: 'invalid_wallet' }, 400);
    if (!(amount > 0)) return json({ error: 'invalid_amount' }, 400);
    if (!id) return json({ error: 'missing_idempotency_key', message: 'Supply a unique idempotencyKey per cash-out so a retry cannot double-pay.' }, 400);

    // Fast idempotent reject (re-checked under the lock).
    const pre = await this.state.storage.get('cashout:' + id);
    if (pre && pre.status === 'confirmed') return json({ ok: true, sig: pre.sig, amount: pre.amount, idempotent: true, balance: await this.balOf(wallet) });

    const ostgMint = new PublicKey(Pool.OSTG_MINT);
    const pool = Pool.getPoolKeypair(this.env);
    const userOstg = Pool.ataForMint(wallet, ostgMint);
    const poolOstg = Pool.poolAtaForMint(this.env, ostgMint);

    // Build instructions UNLOCKED (may hit RPC for ataExists). The pool builds
    // and signs this tx entirely — no client instructions — so there is no
    // assertPoolAbsent concern; the pool legitimately pays ATA rent + moves OSTG.
    const conn = Pool.getConnection();
    const rawAmount = Pool.decimalToRawAmount(amount, Pool.OST_TOKEN_DECIMALS);
    const instructions = [];
    try {
      if (!(await Pool.ataExists(conn, userOstg))) {
        instructions.push(Pool.ixCreateAta(pool.publicKey, userOstg, new PublicKey(wallet), ostgMint));
      }
    } catch (_) { /* if the check fails, the create is idempotent on-chain anyway */ }
    instructions.push(Pool.ixTransferChecked(poolOstg, ostgMint, userOstg, pool.publicKey, rawAmount, Pool.OST_TOKEN_DECIMALS));

    // LOCKED: idempotency decide + balance check + DEBIT + building + BROADCAST.
    // Confirmation is unlocked, after this returns.
    const outcome = await this.state.blockConcurrencyWhile(async () => {
      const existing = await this.state.storage.get('cashout:' + id);
      if (existing && existing.status === 'confirmed') {
        return { done: true, response: json({ ok: true, sig: existing.sig, amount: existing.amount, idempotent: true, balance: Number((await this.state.storage.get('bal:' + wallet)) || 0) }) };
      }
      if (existing && existing.status === 'sent' && existing.sig) {
        return { done: false, resume: existing };   // recover: confirm the sig we already have
      }
      if (existing && existing.status === 'building') {
        return { done: true, response: json({ error: 'cashout_unknown_state', message: 'A previous cash-out for this key did not finish cleanly and may or may not have landed. Support must reconcile before retrying — do not resend.', idempotencyKey: id }, 409) };
      }

      const bal = Number((await this.state.storage.get('bal:' + wallet)) || 0);
      if (bal + 1e-9 < amount) {
        return { done: true, response: json({ error: 'insufficient_balance', balance: bal, requested: amount }, 400) };  // NO debit, NO send
      }
      const total = Number((await this.state.storage.get('total')) || 0);

      // Debit + mark building BEFORE broadcasting. A crash after broadcast but
      // before the 'sent' write leaves this 'building' record → 409 above on
      // retry (human reconciles), never an auto double-pay.
      await this.state.storage.put('bal:' + wallet, bal - amount);
      await this.state.storage.put('total', total - amount);
      await this.state.storage.put('cashout:' + id, { status: 'building', wallet, amount, createdAt: Date.now() });

      let sent;
      try {
        sent = await Pool.buildSignSend(this.env, instructions, [], 'OSTG cashout');
      } catch (e) {
        // Broadcast never left → the OSTG did not move → restore the debit.
        await this.state.storage.put('bal:' + wallet, bal);
        await this.state.storage.put('total', total);
        await this.state.storage.put('cashout:' + id, { status: 'failed', wallet, amount, refunded: true, error: String((e && e.message) || e).slice(0, 200), createdAt: Date.now() });
        return { done: true, response: json({ error: 'cashout_send_failed', message: String((e && e.message) || e).slice(0, 200) }, 502) };
      }
      const record = { status: 'sent', wallet, amount, sig: sent.sig, blockhashInfo: sent.blockhashInfo, createdAt: Date.now() };
      await this.state.storage.put('cashout:' + id, record);
      return { done: false, resume: record };
    });

    if (outcome.done) return outcome.response;

    // Unlocked confirmation. On failure the sig EXISTS — a retry re-confirms it;
    // we do NOT refund here, because the OSTG may well have landed.
    const rec = outcome.resume;
    try {
      await Pool.confirmSignature(rec.sig, rec.blockhashInfo, 'OSTG cashout');
    } catch (e) {
      return json({ error: 'cashout_unconfirmed', message: String((e && e.message) || e).slice(0, 200), sig: rec.sig }, 409);
    }
    await this.state.blockConcurrencyWhile(async () => {
      await this.state.storage.put('cashout:' + id, Object.assign({}, rec, { status: 'confirmed' }));
    });
    return json({ ok: true, sig: rec.sig, amount: rec.amount, balance: await this.balOf(wallet) });
  }

  // ---- provably-fair seed (per wallet, lives HERE so bets are authoritative
  //      and self-contained — no cross-DO hop to fetch the seed) --------------
  async ensureSeed(wallet, clientSeed) {
    let rec = await this.state.storage.get('seed:' + wallet);
    if (!rec) {
      const seed = randomSeedHex();
      rec = { serverSeed: seed, serverSeedHash: await sha256Hex(seed), nonce: 0, clientSeed: clientSeed || ('ost-' + randomSeedHex().slice(0, 16)), epoch: 1 };
      await this.state.storage.put('seed:' + wallet, rec);
    } else if (clientSeed && clientSeed !== rec.clientSeed) {
      rec.clientSeed = clientSeed;
      await this.state.storage.put('seed:' + wallet, rec);
    }
    return rec;
  }

  async handleSeed(url) {
    const wallet = cleanText(url.searchParams.get('wallet'), 64);
    if (!isPubkey(wallet)) return json({ error: 'invalid_wallet' }, 400);
    const rec = await this.ensureSeed(wallet);
    // Publishes only the HASH + clientSeed + nonce. Never the secret serverSeed
    // (that is only revealed on rotate, so past bets become verifiable).
    return json({ ok: true, serverSeedHash: rec.serverSeedHash, clientSeed: rec.clientSeed, nonce: rec.nonce, epoch: rec.epoch });
  }

  // Refresh the cached pool OSTG balance (the bankroll) for the solvency guard.
  // Read UNLOCKED and cached — a WIN raises Σ balances with no new pool OSTG, so
  // we must never credit a win the pool cannot ultimately pay out.
  async poolBankroll() {
    const cached = await this.state.storage.get('poolOstgCache');
    if (cached && (Date.now() - cached.at) < POOL_CACHE_MS && Number.isFinite(cached.v)) return cached.v;
    try {
      const v = await Pool.withRpc('play-bankroll', async (conn) => {
        const res = await conn.getTokenAccountBalance(Pool.poolAtaForMint(this.env, new PublicKey(Pool.OSTG_MINT)));
        return Number(res && res.value ? res.value.uiAmount : NaN);
      });
      if (Number.isFinite(v)) { await this.state.storage.put('poolOstgCache', { v, at: Date.now() }); return v; }
    } catch (_) {}
    return cached && Number.isFinite(cached.v) ? cached.v : null;
  }

  async handleBet(request) {
    let body; try { body = await request.json(); } catch (_) { return json({ error: 'invalid_json' }, 400); }
    const wallet = cleanText(body && body.wallet, 64);
    const game = cleanText(body && body.game, 32);
    const wager = Number(body && body.wager);
    const count = Math.max(1, Math.min(MAX_BATCH, Math.floor(Number(body && body.count) || 1)));
    const params = (body && body.params && typeof body.params === 'object') ? body.params : {};
    const clientSeed = cleanText(body && body.clientSeed, 128) || null;
    if (!isPubkey(wallet)) return json({ error: 'invalid_wallet' }, 400);
    const g = GAMES[game];
    if (!g) return json({ error: 'unknown_game', supported: Object.keys(GAMES) }, 400);
    if (!(wager > 0)) return json({ error: 'invalid_wager' }, 400);
    const perr = g.validateParams ? g.validateParams(params) : null;
    if (perr) return json({ error: 'invalid_params', message: perr }, 400);

    // Bankroll for the solvency guard, refreshed UNLOCKED (never RPC in the lock).
    const bankroll = await this.poolBankroll();

    // LOCKED: the whole play + ledger update. HMAC is microseconds (fine in the
    // lock); there is NO network I/O here.
    const out = await this.state.blockConcurrencyWhile(async () => {
      const seedRec = await this.ensureSeed(wallet, clientSeed);
      let balance = Number((await this.state.storage.get('bal:' + wallet)) || 0);
      let total = Number((await this.state.storage.get('total')) || 0);
      let nonce = seedRec.nonce;
      const results = [];
      let stopped = null;

      for (let i = 0; i < count; i++) {
        if (balance + 1e-9 < wager) { stopped = 'insufficient_balance'; break; }
        // Bind params to the NEXT nonce, THEN compute the outcome from the secret
        // seed — the client cannot have known this roll when it chose params.
        nonce += 1;
        const r = await computeBet(game, seedRec.serverSeed, seedRec.clientSeed, nonce, params, wager);
        const net = Math.round((r.payout - wager) * 1e9) / 1e9;
        // SOLVENCY: never let a win push Σ balances above what the pool can pay.
        if (net > 0 && bankroll != null && (total + net) > bankroll + 1e-9) { nonce -= 1; stopped = 'bankroll_cap'; break; }
        balance = Math.round((balance + net) * 1e9) / 1e9;
        total = Math.round((total + net) * 1e9) / 1e9;
        results.push({ nonce: r.nonce, rolled: r.rolled, win: r.win, payout: r.payout, net, balance });
      }

      if (results.length) {
        await this.state.storage.put('bal:' + wallet, balance);
        await this.state.storage.put('total', total);
        await this.state.storage.put('seed:' + wallet, Object.assign({}, seedRec, { nonce }));
      }
      return { results, balance, stopped, serverSeedHash: seedRec.serverSeedHash, clientSeed: seedRec.clientSeed };
    });

    return json(Object.assign({ ok: out.results.length > 0, wallet, game, played: out.results.length }, out));
  }

  // Reveal the current secret seed and commit a fresh one. Lets a player verify
  // every past bet: HMAC(revealedSeed, clientSeed:nonce:round) must reproduce the
  // outcomes the server credited. sha256(revealedSeed) must equal the hash we
  // published before those bets.
  async handleRotate(request) {
    let body; try { body = await request.json(); } catch (_) { return json({ error: 'invalid_json' }, 400); }
    const wallet = cleanText(body && body.wallet, 64);
    if (!isPubkey(wallet)) return json({ error: 'invalid_wallet' }, 400);
    return await this.state.blockConcurrencyWhile(async () => {
      const rec = await this.ensureSeed(wallet);
      const revealedSeed = rec.serverSeed;
      const revealedHash = rec.serverSeedHash;
      const revealedThroughNonce = rec.nonce;
      const seed = randomSeedHex();
      const next = { serverSeed: seed, serverSeedHash: await sha256Hex(seed), nonce: 0, clientSeed: rec.clientSeed, epoch: (rec.epoch || 1) + 1 };
      await this.state.storage.put('seed:' + wallet, next);
      return json({ ok: true, revealedSeed, revealedHash, revealedThroughNonce, clientSeed: rec.clientSeed, newServerSeedHash: next.serverSeedHash, epoch: next.epoch });
    });
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

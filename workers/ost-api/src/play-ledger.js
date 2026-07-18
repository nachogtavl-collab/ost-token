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
import { GAMES, MULTI, computeBet, layoutFor, randomSeedHex, sha256Hex } from './play-games.js';

const MAX_BATCH = 50;          // auto-bet: at most N nonces per /play/bet call
const POOL_CACHE_MS = 20000;   // re-read pool OSTG for solvency at most this often

// ── Memecoin bonding curve (server-authoritative, funded by the play balance) ──
// Byte-identical to docs/launchpad-engine.js so quotes match. The server owns
// `tokensSold` per coin + per-wallet holdings, so a modified client cannot mint
// tokens or fabricate proceeds. price(r) = BASE*(1 + r*STEEP).
const MEME_BASE_PRICE = 0.00003;
const MEME_STEEP = 199;
const MEME_SUPPLY = 1000000000;      // 1e9 default supply
const MEME_GRAD_MCAP = 69000;        // OSTG market cap that locks the curve
const MEME_EDGE = 0.02;              // 2% of PROFIT on a sell (matches OST_HOUSE)
function memePriceAt(r) { const x = Math.max(0, Math.min(1, r)); return MEME_BASE_PRICE * (1 + x * MEME_STEEP); }
// ∫ price ds from s0..s1 — the OSTG cost to move sold from s0 to s1.
function memeCurveCost(s0, s1, supply) {
  return MEME_BASE_PRICE * (s1 - s0) + (MEME_BASE_PRICE * MEME_STEEP / (2 * supply)) * (s1 * s1 - s0 * s0);
}
// Inverse: tokens minted for `ostIn` OSTG starting at sold s0.
function memeTokensForOst(ostIn, s0, supply) {
  const A = MEME_BASE_PRICE * MEME_STEEP / (2 * supply);
  const B = MEME_BASE_PRICE * (1 + MEME_STEEP * s0 / supply);
  if (A <= 0) return ostIn / Math.max(1e-12, B);
  return (-B + Math.sqrt(B * B + 4 * A * ostIn)) / (2 * A);
}

// ── Mirror stocks (server-authoritative, funded by the play balance) ──────────
// The SERVER fetches the entry/exit price (public Yahoo feed, same source as the
// worker's /stocks relay), so a client can never open/close at a price it chose.
// P&L is 1x on the stake: payoutMove = ±(exit-entry)/entry. 2%-of-profit edge.
const STOCK_EDGE = 0.02;
async function fetchStockPrice(symbol) {
  const url = 'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(symbol) + '?range=1d&interval=5m&includePrePost=false';
  const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0', accept: 'application/json' }, cf: { cacheTtl: 5 } });
  if (!res.ok) throw new Error('quote_fetch_failed');
  const j = await res.json();
  const r0 = j && j.chart && j.chart.result && j.chart.result[0];
  const price = r0 && r0.meta && Number(r0.meta.regularMarketPrice);
  if (!(price > 0)) throw new Error('no_price');
  return price;
}

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
function round9(n) { return Math.round(Number(n) * 1e9) / 1e9; }

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

      if (path === '/play/session/start' && method === 'POST') return await this.handleSessionStart(request);
      if (path === '/play/session/step' && method === 'POST') return await this.handleSessionStep(request);
      if (path === '/play/session/cashout' && method === 'POST') return await this.handleSessionCashout(request);

      if (path === '/play/meme/coin' && method === 'GET') return await this.handleMemeCoin(url);
      if (path === '/play/meme/holdings' && method === 'GET') return await this.handleMemeHoldings(url);
      if (path === '/play/meme/buy' && method === 'POST') return await this.handleMemeBuy(request);
      if (path === '/play/meme/sell' && method === 'POST') return await this.handleMemeSell(request);

      if (path === '/play/stock/positions' && method === 'GET') return await this.handleStockPositions(url);
      if (path === '/play/stock/open' && method === 'POST') return await this.handleStockOpen(request);
      if (path === '/play/stock/close' && method === 'POST') return await this.handleStockClose(request);

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
        // Pass the FULL outcome detail (game-specific fields + the floats used) so
        // the client can animate the exact settled outcome. net/balance overwrite
        // any same-named outcome field last.
        results.push(Object.assign({}, r, { net, balance }));
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

  // ---- MULTI-STEP game sessions (mines etc.) ------------------------------
  // start: debit the wager and pin the hidden layout from the secret seed. step:
  // reveal one action against that layout. cashout: credit the current multiplier.
  // The layout is fixed at start (before the player acts) and re-derivable once
  // the seed is revealed — provable-fair. No on-chain movement here (pure ledger),
  // so no crash-safe broadcast; just the DO lock on each mutation.
  async handleSessionStart(request) {
    let body; try { body = await request.json(); } catch (_) { return json({ error: 'invalid_json' }, 400); }
    const wallet = cleanText(body && body.wallet, 64);
    const game = cleanText(body && body.game, 32);
    const wager = Number(body && body.wager);
    const params = (body && body.params && typeof body.params === 'object') ? body.params : {};
    const clientSeed = cleanText(body && body.clientSeed, 128) || null;
    if (!isPubkey(wallet)) return json({ error: 'invalid_wallet' }, 400);
    const g = MULTI[game];
    if (!g) return json({ error: 'unknown_game', supported: Object.keys(MULTI) }, 400);
    if (!(wager > 0)) return json({ error: 'invalid_wager' }, 400);
    const perr = g.validateParams ? g.validateParams(params) : null;
    if (perr) return json({ error: 'invalid_params', message: perr }, 400);

    return await this.state.blockConcurrencyWhile(async () => {
      const seedRec = await this.ensureSeed(wallet, clientSeed);
      const balance = Number((await this.state.storage.get('bal:' + wallet)) || 0);
      if (balance + 1e-9 < wager) return json({ error: 'insufficient_balance', balance }, 400);
      const total = Number((await this.state.storage.get('total')) || 0);
      const nonce = seedRec.nonce + 1;
      const layout = await layoutFor(game, seedRec.serverSeed, seedRec.clientSeed, nonce, params);
      const sessionId = crypto.randomUUID();
      const session = { wallet, game, params, wager, nonce, layout, state: { safeRevealed: 0, revealed: [], ended: false, won: false }, createdAt: Date.now() };
      // Some games reveal a public starting state and seed their own state fields
      // (e.g. hilo's first card + mult) — do this BEFORE persisting so the mutated
      // state is what gets stored.
      const reveal = g.startReveal ? g.startReveal(params, layout, session.state) : null;
      await this.state.storage.put('bal:' + wallet, round9(balance - wager));
      await this.state.storage.put('total', round9(total - wager));
      await this.state.storage.put('seed:' + wallet, Object.assign({}, seedRec, { nonce }));
      await this.state.storage.put('sess:' + sessionId, session);
      return json({ ok: true, sessionId, game, config: g.config ? g.config(params) : {}, reveal, wager, serverSeedHash: seedRec.serverSeedHash, nonce, balance: round9(balance - wager) });
    });
  }

  async handleSessionStep(request) {
    let body; try { body = await request.json(); } catch (_) { return json({ error: 'invalid_json' }, 400); }
    const wallet = cleanText(body && body.wallet, 64);
    const sessionId = cleanText(body && body.sessionId, 64);
    const action = (body && body.action && typeof body.action === 'object') ? body.action : {};
    if (!isPubkey(wallet)) return json({ error: 'invalid_wallet' }, 400);
    if (!sessionId) return json({ error: 'missing_session' }, 400);

    // Bankroll for the solvency guard on a WON-ended step (perfect clear), fetched
    // UNLOCKED like the cashout path.
    const bankroll = await this.poolBankroll();

    return await this.state.blockConcurrencyWhile(async () => {
      const session = await this.state.storage.get('sess:' + sessionId);
      if (!session || session.wallet !== wallet) return json({ error: 'unknown_session' }, 404);
      if (session.state.ended) return json({ error: 'session_ended' }, 409);
      const g = MULTI[session.game];
      const res = g.step(session.params, session.layout, session.state, action);
      if (res.error) return json({ error: res.error }, 400);
      let paid = null;
      if (res.ended) {
        session.state.ended = true; session.state.won = !!res.won;
        // A step that ENDS the session as a WIN (perfect clear: all safe tiles /
        // top of the tower / all floors) must PAY here — there is no cashout to
        // follow (cashout would reject an ended session). Credit like cashout,
        // solvency-gated. A losing end pays nothing.
        if (res.won && !session.cashedOut) {
          const mult = g.currentMultiplier(session.params, session.state);
          const payout = round9(session.wager * mult);
          const balance = Number((await this.state.storage.get('bal:' + wallet)) || 0);
          const total = Number((await this.state.storage.get('total')) || 0);
          if (bankroll != null && (total + payout) > bankroll + 1e-9) {
            // Can't back the win right now: keep the session OPEN so the player can
            // cash out once the bankroll recovers, rather than voiding the win.
            session.state.ended = false; session.state.won = false;
            await this.state.storage.put('sess:' + sessionId, session);
            return json({ error: 'bankroll_cap', message: 'House bankroll can’t cover that win yet — cash out shortly.' }, 409);
          }
          session.cashedOut = true;
          await this.state.storage.put('bal:' + wallet, round9(balance + payout));
          await this.state.storage.put('total', round9(total + payout));
          paid = { payout, multiplier: mult, balance: round9(balance + payout) };
        }
      }
      await this.state.storage.put('sess:' + sessionId, session);
      const canCashout = !session.state.ended && (g.canCashout ? g.canCashout(session.state) : (session.state.safeRevealed || 0) > 0);
      return json(Object.assign({ ok: true, sessionId }, res, paid || {}, {
        currentMultiplier: g.currentMultiplier ? g.currentMultiplier(session.params, session.state) : 0,
        canCashout,
      }));
    });
  }

  async handleSessionCashout(request) {
    let body; try { body = await request.json(); } catch (_) { return json({ error: 'invalid_json' }, 400); }
    const wallet = cleanText(body && body.wallet, 64);
    const sessionId = cleanText(body && body.sessionId, 64);
    if (!isPubkey(wallet)) return json({ error: 'invalid_wallet' }, 400);
    if (!sessionId) return json({ error: 'missing_session' }, 400);

    const bankroll = await this.poolBankroll();   // UNLOCKED

    return await this.state.blockConcurrencyWhile(async () => {
      const session = await this.state.storage.get('sess:' + sessionId);
      if (!session || session.wallet !== wallet) return json({ error: 'unknown_session' }, 404);
      if (session.state.ended) return json({ error: 'session_ended', message: 'This session already ended (busted or cashed out).' }, 409);
      const g = MULTI[session.game];
      let mult;
      if (g.cashout) {
        // Reactive game (crash): the eject multiplier is authoritative on the
        // SERVER clock. The client's displayed mult is only an upper-bounded hint
        // (can't claim faster than server-elapsed time), and the hidden bust point
        // is checked server-side — so a modified client can neither time-travel
        // nor eject past the crash. A too-late eject busts (no payout).
        const claimedMult = Number(body && body.claimedMult);
        const res = g.cashout(session.params, session.layout, session.state, claimedMult, Date.now());
        if (res.busted) {
          session.state.ended = true; session.state.won = false; session.state.busted = true;
          await this.state.storage.put('sess:' + sessionId, session);
          return json({ ok: true, sessionId, busted: true, crashAt: res.crashAt, payout: 0, multiplier: 0 });
        }
        mult = res.mult;
      } else {
        // Game-agnostic cashout guard. Most games gate on "made progress"
        // (currentMultiplier >= 1). Games whose multiplier can dip below 1 on a
        // near-certain step (hilo) define canCashout(state) to gate on progress
        // directly, then pay wager × the real multiplier (which may be < 1).
        const cm = g.currentMultiplier(session.params, session.state);
        const eligible = g.canCashout ? g.canCashout(session.state) : (cm >= 1);
        if (!eligible) return json({ error: 'nothing_to_cashout' }, 400);
        mult = cm;
      }
      const payout = round9(session.wager * mult);

      const balance = Number((await this.state.storage.get('bal:' + wallet)) || 0);
      const total = Number((await this.state.storage.get('total')) || 0);
      // Solvency: a win raises Σ balances with no new pool OSTG.
      if (bankroll != null && (total + payout) > bankroll + 1e-9) {
        return json({ error: 'bankroll_cap', message: 'Cash-out exceeds what the pool can currently back.' }, 409);
      }
      session.state.ended = true; session.state.won = true; session.cashedOut = true;
      await this.state.storage.put('bal:' + wallet, round9(balance + payout));
      await this.state.storage.put('total', round9(total + payout));
      await this.state.storage.put('sess:' + sessionId, session);
      return json({ ok: true, sessionId, payout, multiplier: mult, balance: round9(balance + payout) });
    });
  }

  // ── Memecoins (server-authoritative bonding curve, play-balance funded) ──
  memeCoinView(c) {
    const supply = Number(c.supply) || MEME_SUPPLY;
    const sold = Number(c.sold) || 0;
    const price = memePriceAt(sold / supply);
    const mcap = sold * price;
    const curve = Math.max(0, Math.min(100, Math.floor((mcap / MEME_GRAD_MCAP) * 100)));
    return { mint: c.mint, symbol: c.symbol || '', supply, sold: round9(sold), price: round9(price), mcap: Math.round(mcap), curve, trades: Number(c.trades) || 0, graduated: curve >= 100 };
  }

  async handleMemeCoin(url) {
    const mint = cleanText(url.searchParams.get('mint'), 64);
    if (!mint) return json({ error: 'missing_mint' }, 400);
    const c = (await this.state.storage.get('meme:' + mint)) || { mint, symbol: cleanText(url.searchParams.get('symbol'), 32) || '', supply: MEME_SUPPLY, sold: 0, trades: 0 };
    return json({ ok: true, coin: this.memeCoinView(c) });
  }

  async handleMemeHoldings(url) {
    const wallet = cleanText(url.searchParams.get('wallet'), 64);
    if (!isPubkey(wallet)) return json({ error: 'invalid_wallet' }, 400);
    const holds = (await this.state.storage.get('meme:hold:' + wallet)) || {};
    return json({ ok: true, wallet, holdings: holds });
  }

  async handleMemeBuy(request) {
    let body; try { body = await request.json(); } catch (_) { return json({ error: 'invalid_json' }, 400); }
    const wallet = cleanText(body && body.wallet, 64);
    const mint = cleanText(body && body.mint, 64);
    const symbol = cleanText(body && body.symbol, 32) || '';
    const ostIn = Number(body && body.ostIn);
    if (!isPubkey(wallet)) return json({ error: 'invalid_wallet' }, 400);
    if (!mint) return json({ error: 'missing_mint' }, 400);
    if (!(ostIn > 0)) return json({ error: 'invalid_amount' }, 400);

    return await this.state.blockConcurrencyWhile(async () => {
      const coin = (await this.state.storage.get('meme:' + mint)) || { mint, symbol, supply: MEME_SUPPLY, sold: 0, trades: 0 };
      if (symbol && !coin.symbol) coin.symbol = symbol;
      const supply = Number(coin.supply) || MEME_SUPPLY;
      if (this.memeCoinView(coin).graduated) return json({ error: 'graduated', message: 'Coin has graduated — trading locked.' }, 409);
      const balance = Number((await this.state.storage.get('bal:' + wallet)) || 0);
      let amt = ostIn;
      if (balance + 1e-9 < amt) return json({ error: 'insufficient_balance', balance }, 400);
      const s0 = Number(coin.sold) || 0;
      let tokens = memeTokensForOst(amt, s0, supply);
      if (s0 + tokens > supply) { tokens = supply - s0; amt = memeCurveCost(s0, supply, supply); }   // last buy fills the curve
      if (!(tokens > 0)) return json({ error: 'nothing_to_buy' }, 400);
      const total = Number((await this.state.storage.get('total')) || 0);
      // Buying spends the play balance INTO the curve — a debit, always safe.
      await this.state.storage.put('bal:' + wallet, round9(balance - amt));
      await this.state.storage.put('total', round9(total - amt));
      coin.sold = s0 + tokens; coin.trades = (Number(coin.trades) || 0) + 1;
      await this.state.storage.put('meme:' + mint, coin);
      const holdsKey = 'meme:hold:' + wallet;
      const holds = (await this.state.storage.get(holdsKey)) || {};
      const pos = holds[mint] || { tokens: 0, costOst: 0 };
      pos.tokens = round9(pos.tokens + tokens); pos.costOst = round9(pos.costOst + amt);
      holds[mint] = pos;
      await this.state.storage.put(holdsKey, holds);
      return json({ ok: true, ostIn: round9(amt), tokens: round9(tokens), position: pos, coin: this.memeCoinView(coin), balance: round9(balance - amt) });
    });
  }

  async handleMemeSell(request) {
    let body; try { body = await request.json(); } catch (_) { return json({ error: 'invalid_json' }, 400); }
    const wallet = cleanText(body && body.wallet, 64);
    const mint = cleanText(body && body.mint, 64);
    const tokensIn = Number(body && body.tokensIn);
    if (!isPubkey(wallet)) return json({ error: 'invalid_wallet' }, 400);
    if (!mint) return json({ error: 'missing_mint' }, 400);
    if (!(tokensIn > 0)) return json({ error: 'invalid_amount' }, 400);

    const bankroll = await this.poolBankroll();   // UNLOCKED

    return await this.state.blockConcurrencyWhile(async () => {
      const coin = await this.state.storage.get('meme:' + mint);
      if (!coin) return json({ error: 'unknown_coin' }, 404);
      const supply = Number(coin.supply) || MEME_SUPPLY;
      const holdsKey = 'meme:hold:' + wallet;
      const holds = (await this.state.storage.get(holdsKey)) || {};
      const pos = holds[mint] || { tokens: 0, costOst: 0 };
      let tokens = tokensIn;
      if (tokens > pos.tokens + 1e-9) return json({ error: 'insufficient_tokens', held: pos.tokens }, 400);
      if (tokens > pos.tokens) tokens = pos.tokens;
      const s1 = Number(coin.sold) || 0;
      const s0 = Math.max(0, s1 - tokens);
      let ostOut = memeCurveCost(s0, s1, supply);
      // House edge: 2% of PROFIT above the sold tokens' cost basis (never taxes a loss).
      const basis = pos.tokens > 0 ? pos.costOst * (tokens / pos.tokens) : 0;
      const fee = round9(Math.max(0, ostOut - basis) * MEME_EDGE);
      ostOut = round9(ostOut - fee);
      const balance = Number((await this.state.storage.get('bal:' + wallet)) || 0);
      const total = Number((await this.state.storage.get('total')) || 0);
      // Selling CREDITS the play balance — solvency-gate it like a game win.
      if (bankroll != null && (total + ostOut) > bankroll + 1e-9) return json({ error: 'bankroll_cap', message: 'Pool can’t back that sell right now.' }, 409);
      coin.sold = s0; coin.trades = (Number(coin.trades) || 0) + 1;
      await this.state.storage.put('meme:' + mint, coin);
      const remainTokens = round9(pos.tokens - tokens);
      if (remainTokens > 1e-9) holds[mint] = { tokens: remainTokens, costOst: round9(pos.costOst * (remainTokens / pos.tokens)) };
      else delete holds[mint];
      await this.state.storage.put(holdsKey, holds);
      await this.state.storage.put('bal:' + wallet, round9(balance + ostOut));
      await this.state.storage.put('total', round9(total + ostOut));
      return json({ ok: true, tokens: round9(tokens), ostOut, fee, position: holds[mint] || { tokens: 0, costOst: 0 }, coin: this.memeCoinView(coin), balance: round9(balance + ostOut) });
    });
  }

  // ── Mirror stocks (server-fetched price, play-balance funded) ──
  async handleStockPositions(url) {
    const wallet = cleanText(url.searchParams.get('wallet'), 64);
    if (!isPubkey(wallet)) return json({ error: 'invalid_wallet' }, 400);
    const list = await this.state.storage.list({ prefix: 'stockpos:' + wallet + ':' });
    const positions = [];
    list.forEach((v) => { if (v && v.open) positions.push(v); });
    return json({ ok: true, wallet, positions });
  }

  async handleStockOpen(request) {
    let body; try { body = await request.json(); } catch (_) { return json({ error: 'invalid_json' }, 400); }
    const wallet = cleanText(body && body.wallet, 64);
    const symbol = cleanText(body && body.symbol, 12).toUpperCase();
    const side = (body && body.side) === 'short' ? 'short' : 'long';
    const stake = Number(body && body.stake);
    if (!isPubkey(wallet)) return json({ error: 'invalid_wallet' }, 400);
    if (!/^[A-Z.\-]{1,12}$/.test(symbol)) return json({ error: 'invalid_symbol' }, 400);
    if (!(stake > 0)) return json({ error: 'invalid_stake' }, 400);

    // Fetch the entry price UNLOCKED (network I/O never inside the lock). Never
    // fabricate a price — a fetch failure rejects the open.
    let entryPrice;
    try { entryPrice = await fetchStockPrice(symbol); }
    catch (_) { return json({ error: 'quote_unavailable', message: 'Could not fetch a live price for ' + symbol + '.' }, 502); }

    return await this.state.blockConcurrencyWhile(async () => {
      const balance = Number((await this.state.storage.get('bal:' + wallet)) || 0);
      if (balance + 1e-9 < stake) return json({ error: 'insufficient_balance', balance }, 400);
      const total = Number((await this.state.storage.get('total')) || 0);
      const id = crypto.randomUUID();
      const pos = { id, wallet, symbol, side, stake: round9(stake), entryPrice, shares: round9(stake / entryPrice), openedAt: Date.now(), open: true };
      await this.state.storage.put('bal:' + wallet, round9(balance - stake));   // debit stake — safe
      await this.state.storage.put('total', round9(total - stake));
      await this.state.storage.put('stockpos:' + wallet + ':' + id, pos);
      return json({ ok: true, position: pos, balance: round9(balance - stake) });
    });
  }

  async handleStockClose(request) {
    let body; try { body = await request.json(); } catch (_) { return json({ error: 'invalid_json' }, 400); }
    const wallet = cleanText(body && body.wallet, 64);
    const positionId = cleanText(body && body.positionId, 64);
    if (!isPubkey(wallet)) return json({ error: 'invalid_wallet' }, 400);
    if (!positionId) return json({ error: 'missing_position' }, 400);

    const key = 'stockpos:' + wallet + ':' + positionId;
    const pos = await this.state.storage.get(key);
    if (!pos || !pos.open) return json({ error: 'unknown_position' }, 404);

    // Exit price + bankroll fetched UNLOCKED.
    let exitPrice;
    try { exitPrice = await fetchStockPrice(pos.symbol); }
    catch (_) { return json({ error: 'quote_unavailable', message: 'Could not fetch a live price to close.' }, 502); }
    const bankroll = await this.poolBankroll();

    return await this.state.blockConcurrencyWhile(async () => {
      const fresh = await this.state.storage.get(key);
      if (!fresh || !fresh.open) return json({ error: 'already_closed' }, 409);
      const move = (exitPrice - fresh.entryPrice) / fresh.entryPrice;
      const signed = fresh.side === 'short' ? -move : move;              // 1x on the stake
      let payout = Math.max(0, round9(fresh.stake * (1 + signed)));
      const fee = round9(Math.max(0, payout - fresh.stake) * STOCK_EDGE);  // 2% of profit only
      payout = round9(payout - fee);
      const balance = Number((await this.state.storage.get('bal:' + wallet)) || 0);
      const total = Number((await this.state.storage.get('total')) || 0);
      if (bankroll != null && (total + payout) > bankroll + 1e-9) return json({ error: 'bankroll_cap', message: 'Pool can’t back that close right now.' }, 409);
      fresh.open = false; fresh.exitPrice = exitPrice; fresh.closedAt = Date.now(); fresh.payout = payout; fresh.fee = fee;
      await this.state.storage.put(key, fresh);
      await this.state.storage.put('bal:' + wallet, round9(balance + payout));
      await this.state.storage.put('total', round9(total + payout));
      return json({ ok: true, position: fresh, payout, fee, entryPrice: fresh.entryPrice, exitPrice, move: round9(signed), balance: round9(balance + payout) });
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

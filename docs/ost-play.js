/* ==========================================================================
 * OST · Play — client contract for the OSTG-backed play balance
 * --------------------------------------------------------------------------
 * project-docs/PLAY-BALANCE.md, Phase 2 increment 4b.
 *
 * This is the ONE client entry point for the real game economy. It replaces the
 * forgeable localStorage `credits` with the server-authoritative play balance:
 *
 *   OST_PLAY.balance()            -> the player's play balance (server truth)
 *   OST_PLAY.bet(game, params, w) -> the SERVER computes the outcome from its
 *                                    secret seed and returns it; the client only
 *                                    animates to what came back. No local payout.
 *   OST_PLAY.deposit(ostg)        -> move OSTG wallet -> pool (gas-free) + credit
 *   OST_PLAY.cashout(amount)      -> ledger-gated pool -> wallet OSTG payout
 *
 * WHY THE CLIENT NO LONGER DECIDES OUTCOMES: the old path let the client compute
 * the win and tell the balance what it earned — cheatable against real value.
 * Here the server owns the seed, the outcome, the edge and the balance. The
 * client is a renderer. (See PLAY-BALANCE.md "the correct model".)
 * ========================================================================== */
(function () {
  'use strict';
  if (window.OST_PLAY) return;

  var API = (window.OST_API_BASE || 'https://ost-api.nachogtavl.workers.dev').replace(/\/+$/, '');
  var OSTG_MINT = 'DfgxMbdN49AX2Za9LuvsyixF1jgVh45RbgWYSGonxQos';
  var POOL_OSTG_ATA = 'BtXrBdbFrHdQ4d9F9uxV76fMa6TFHv1miL7MK9RipVKG';
  var TOKEN_2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
  var ASSOC = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
  var DEC = 9;

  var mirror = undefined;   // last known balance (undefined = not yet known)

  function wallet() {
    try { var s = window.OST_WALLET && window.OST_WALLET.session; return (s && s.publicKey) || null; }
    catch (_) { return null; }
  }
  function addr() { var w = wallet(); return w ? w.toBase58() : ''; }
  var lastAddr = '';

  function emit() {
    try { window.dispatchEvent(new CustomEvent('ost:play:balance', { detail: { balance: mirror } })); } catch (_) {}
  }

  async function api(method, path, body) {
    // Timeout so a stalled worker/RPC can't hang a bet/deposit forever.
    var ctrl = new AbortController();
    var to = setTimeout(function () { try { ctrl.abort(); } catch (_) {} }, 15000);
    var res;
    try {
      res = await fetch(API + path, {
        method: method,
        headers: body ? { 'content-type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        cache: 'no-store',
        signal: ctrl.signal,
      });
    } catch (e) {
      var ne = new Error(e && e.name === 'AbortError' ? 'timeout' : 'network_error'); ne.code = ne.message; throw ne;
    } finally { clearTimeout(to); }
    var json = await res.json().catch(function () { return {}; });
    if (!res.ok) { var er = new Error(json.error || ('http_' + res.status)); er.detail = json; throw er; }
    return json;
  }

  // ---- balance ------------------------------------------------------------
  // LAST-KNOWN CACHE, per wallet. Display-only and never spendable - every
  // debit still goes through the server, which is the sole authority. This
  // exists because of a real bug: on load the wallet adapter has not attached
  // yet, so addr() is '' for a moment. The old code treated that as "no
  // wallet" and wiped the mirror to undefined, which is why OSTG vanished on
  // every refresh and looked inconsistent. Same fix the on-chain balance tree
  // already uses.
  var CACHE_KEY = 'ost.play.balance.lastknown.v1';

  function readCache(a) {
    try {
      var all = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
      var v = all && all[a];
      return Number.isFinite(Number(v)) ? Number(v) : undefined;
    } catch (_) { return undefined; }
  }
  function writeCache(a, v) {
    if (!a || !Number.isFinite(Number(v))) return;
    try {
      var all = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
      all[a] = Number(v);
      localStorage.setItem(CACHE_KEY, JSON.stringify(all));
    } catch (_) {}
  }

  // NET-3: concurrent refreshes share ONE /play/balance request (several
  // modules refresh on the same wallet / money event). refresh(true) — after a
  // money action whose result must be read fresh — always asks the server.
  var refreshInFlight = null, refreshInFlightAddr = '';
  function refresh(force) {
    var a = addr();
    if (force !== true && refreshInFlight && refreshInFlightAddr === a) return refreshInFlight;
    var p = refreshNow();
    if (force !== true) {
      refreshInFlight = p; refreshInFlightAddr = a;
      p.then(function () { if (refreshInFlight === p) refreshInFlight = null; }, function () { if (refreshInFlight === p) refreshInFlight = null; });
    }
    return p;
  }
  async function refreshNow() {
    var a = addr();
    if (!a) {
      // Wallet not attached YET is not the same as no wallet. Keep whatever we
      // last knew so the number does not blink out during boot; a genuine
      // disconnect fires ost:wallet-changed and is handled there.
      if (mirror === undefined) {
        var seed = readCache(lastAddr);
        if (seed !== undefined) { mirror = seed; emit(); }
      }
      return mirror;
    }
    lastAddr = a;
    if (mirror === undefined) {
      var cached = readCache(a);
      if (cached !== undefined) { mirror = cached; emit(); }   // paint instantly
    }
    try {
      var r = await api('GET', '/play/balance?wallet=' + encodeURIComponent(a));
      mirror = Number(r.balance) || 0;
      writeCache(a, mirror);
    } catch (_) { /* keep last known; unknown is not zero */ }
    emit();
    return mirror;
  }
  function balance() { return mirror; }

  // The one place a spend decides WHICH OSTG it uses. Defaults to personal:
  // if the selector has not loaded, we must never fall back to borrowed money.
  function activeBucket(explicit) {
    if (explicit) return explicit;
    try {
      if (window.OST_OSTG_SOURCE && window.OST_OSTG_SOURCE.current) return window.OST_OSTG_SOURCE.current();
    } catch (_) {}
    return 'clean';
  }

  // ---- bet (server-authoritative) ----------------------------------------
  // Returns the server response: { results:[{nonce,win,payout,net,balance,...}],
  // played, balance, stopped }. The caller animates to results[i]'s fields.
  async function bet(game, params, wager, count) {
    var a = addr();
    if (!a) throw new Error('Connect your wallet first.');
    if (!(Number(wager) > 0)) throw new Error('Enter a wager greater than zero.');
    var r = await api('POST', '/play/bet', {
      wallet: a, game: game, params: params || {}, wager: Number(wager),
      count: Math.max(1, Math.min(50, Math.floor(Number(count) || 1))),
      bucket: activeBucket(),
    });
    if (typeof r.balance === 'number') { mirror = r.balance; writeCache(a, mirror); emit(); }
    return r;
  }

  // ---- multi-step sessions (mines, crash, tower, dragontower, hilo) -------
  // The server pins the hidden layout from its secret seed at start; each step is
  // revealed server-side; cash-out is solvency-gated. The client only renders what
  // comes back — it never knows the layout/bust ahead of time.
  async function sessionStart(game, params, wager) {
    var a = addr();
    if (!a) throw new Error('Connect your wallet first.');
    if (!(Number(wager) > 0)) throw new Error('Enter a wager greater than zero.');
    var r = await api('POST', '/play/session/start', { wallet: a, game: game, params: params || {}, wager: Number(wager) });
    if (typeof r.balance === 'number') { mirror = r.balance; emit(); }
    return r;
  }
  async function sessionStep(sessionId, action) {
    var a = addr();
    if (!a) throw new Error('Connect your wallet first.');
    return await api('POST', '/play/session/step', { wallet: a, sessionId: sessionId, action: action || {} });
  }
  async function sessionCashout(sessionId, claimedMult) {
    var a = addr();
    if (!a) throw new Error('Connect your wallet first.');
    var body = { wallet: a, sessionId: sessionId };
    if (claimedMult != null) body.claimedMult = Number(claimedMult);
    var r = await api('POST', '/play/session/cashout', body);
    if (typeof r.balance === 'number') { mirror = r.balance; emit(); }
    return r;
  }

  // ---- memecoins (server-authoritative bonding curve, play-balance funded) --
  async function memeBuy(mint, symbol, ostIn) {
    var a = addr();
    if (!a) throw new Error('Connect your wallet first.');
    var r = await api('POST', '/play/meme/buy', { wallet: a, mint: mint, symbol: symbol || '', ostIn: Number(ostIn) });
    if (typeof r.balance === 'number') { mirror = r.balance; emit(); }
    return r;
  }
  async function memeSell(mint, tokensIn) {
    var a = addr();
    if (!a) throw new Error('Connect your wallet first.');
    var r = await api('POST', '/play/meme/sell', { wallet: a, mint: mint, tokensIn: Number(tokensIn) });
    if (typeof r.balance === 'number') { mirror = r.balance; emit(); }
    return r;
  }
  async function memeCoin(mint, symbol) {
    var q = '/play/meme/coin?mint=' + encodeURIComponent(mint) + (symbol ? '&symbol=' + encodeURIComponent(symbol) : '');
    return (await api('GET', q)).coin;
  }
  async function memeHoldings() {
    var a = addr();
    if (!a) return {};
    return (await api('GET', '/play/meme/holdings?wallet=' + encodeURIComponent(a))).holdings || {};
  }

  // ---- mirror stocks (server-priced, play-balance funded) -----------------
  async function stockOpen(symbol, side, stake) {
    var a = addr();
    if (!a) throw new Error('Connect your wallet first.');
    var r = await api('POST', '/play/stock/open', { wallet: a, symbol: symbol, side: side, stake: Number(stake) });
    if (typeof r.balance === 'number') { mirror = r.balance; emit(); }
    return r;
  }
  async function stockClose(positionId) {
    var a = addr();
    if (!a) throw new Error('Connect your wallet first.');
    var r = await api('POST', '/play/stock/close', { wallet: a, positionId: positionId });
    if (typeof r.balance === 'number') { mirror = r.balance; emit(); }
    return r;
  }
  async function stockPositions() {
    var a = addr();
    if (!a) return [];
    return (await api('GET', '/play/stock/positions?wallet=' + encodeURIComponent(a))).positions || [];
  }

  // ---- deposit: OSTG wallet -> play balance (gas-free) --------------------
  // Requires OSTG in the wallet (get it 1:1 from OST via the bridge). Moves it to
  // the pool with the fee-only cosign path (pool pays gas), then credits the
  // ledger from the verified on-chain transfer.
  function PK(s) { return new solanaWeb3.PublicKey(s); }
  function ataOf(mint, owner) {
    return solanaWeb3.PublicKey.findProgramAddressSync(
      [owner.toBuffer(), PK(TOKEN_2022).toBuffer(), PK(mint).toBuffer()], PK(ASSOC)
    )[0];
  }
  function transferCheckedIx(from, to, ownerPk, rawAmount) {
    // SPL Token-2022 TransferChecked (instruction 12): [amount u64][decimals u8].
    var data = new Uint8Array(10);
    data[0] = 12;
    new DataView(data.buffer).setBigUint64(1, BigInt(rawAmount), true);
    data[9] = DEC;
    return new solanaWeb3.TransactionInstruction({
      programId: PK(TOKEN_2022),
      keys: [
        { pubkey: from, isSigner: false, isWritable: true },
        { pubkey: PK(OSTG_MINT), isSigner: false, isWritable: false },
        { pubkey: to, isSigner: false, isWritable: true },
        { pubkey: ownerPk, isSigner: true, isWritable: false },
      ],
      data: data,
    });
  }

  // Wallet OSTG straight from the chain (raw base units + ui), or null when the
  // read failed (unknown is not zero). `exists` says whether the account exists.
  async function readWalletOstg(owner) {
    var conn = null;
    try { conn = window.OST_WALLET && window.OST_WALLET.getConnection ? window.OST_WALLET.getConnection() : null; } catch (_) { conn = null; }
    var ata = ataOf(OSTG_MINT, owner);
    var call = function (fn) {
      if (window.OST_WALLET && typeof window.OST_WALLET.rpcCall === 'function') return window.OST_WALLET.rpcCall(fn);
      return conn ? fn(conn) : Promise.reject(new Error('rpc unavailable'));
    };
    try {
      var info = await call(function (c) { return c.getAccountInfo(ata); });
      if (!info) return { exists: false, raw: 0n, ui: 0 };
      var bal = await call(function (c) { return c.getTokenAccountBalance(ata); });
      var raw = BigInt(String((bal && bal.value && bal.value.amount) || '0'));
      return { exists: true, raw: raw, ui: Number(raw) / Math.pow(10, DEC) };
    } catch (_) { return null; }
  }

  async function deposit(uiAmount, opts) {
    opts = opts || {};
    var w = wallet();
    if (!w) throw new Error('Connect your wallet first.');
    var rescue = window.OST_RESCUE;
    if (!rescue || !rescue.sendPoolFeeOnly || !rescue.ensureUserAtaForMint) {
      throw new Error('Deposit needs the pool rail (OST_RESCUE) — reload and try again.');
    }
    var amt = Number(uiAmount);
    if (!(amt > 0)) throw new Error('Enter an amount greater than zero.');
    var rawAmount = BigInt(Math.round(amt * 10 ** DEC));

    // PRD-2 / SRV-5: check the WALLET OSTG before touching the pool rail. A
    // deposit from an empty account used to be broadcast anyway and fail on
    // chain (Custom:1) after ~9 s; a cold worker isolate also mis-reported the
    // existing account as missing (IllegalOwner). Now: read the account first;
    // only ask the pool to create it when it is really absent; refuse plainly
    // when the OSTG is not there. A just-converted balance may take a moment to
    // become visible, so a short wait is allowed (opts.waitMs).
    var deadline = Date.now() + (Number(opts.waitMs) || 0);
    var have = await readWalletOstg(w);
    while (have && have.raw < rawAmount && Date.now() < deadline) {
      await sleepMs(1500);
      have = await readWalletOstg(w);
    }
    if (have && have.raw < rawAmount) {
      var ie = new Error('Your wallet holds ' + have.ui.toFixed(2) + ' OSTG — not enough to move ' + amt.toFixed(2) + ' OSTG to your play balance. Convert OST → OSTG first (1:1, fees paid by OST).');
      ie.code = 'insufficient_ostg'; ie.have = have.ui;
      throw ie;
    }
    if (!have || !have.exists) {
      // Ensure the user's OSTG account exists (pool-paid). A false failure on a
      // cold worker is tolerated when the account turns out to exist.
      try { await rescue.ensureUserAtaForMint(w, OSTG_MINT); }
      catch (ataErr) {
        var again = await readWalletOstg(w);
        if (!(again && again.exists)) throw ataErr;
      }
    }
    // Move OSTG to the pool gas-free. The transfer references the pool's ATA
    // (not the pool pubkey), so it passes assertPoolAbsent — the pool signs
    // only as fee payer.
    // Retry the TRANSFER on transient failures. The pool-cosign build reads
    // account/blockhash state from a throttled RPC, so it intermittently returns
    // IllegalOwner / blockhash_expired / 429 even though the accounts are valid
    // (it succeeds on a retry). Only transient errors retry; a real rejection throws.
    var sig, lastErr;
    for (var _t = 0; _t < 3; _t++) {
      try { var sent = await rescue.sendPoolFeeOnly([transferCheckedIx(ataOf(OSTG_MINT, w), PK(POOL_OSTG_ATA), w, rawAmount)]); sig = String((sent && sent.sig) || sent || ''); break; }
      catch (e) {
        lastErr = e; var msg = String((e && e.message) || e);
        // Retry ONLY when nothing can have been sent (C4): an error that carries
        // a signature or says "pending" may have landed — never build a 2nd tx.
        var mayHaveLanded = !!(e && (e.sig || e.pending || (e.body && e.body.sig)));
        if (mayHaveLanded) { sig = String(e.sig || (e.body && e.body.sig) || ''); if (sig) break; throw e; }
        if (_t < 2 && /IllegalOwner|blockhash|expired|429|Too Many|rate.?limit/i.test(msg + ' ' + String(e && e.code || ''))) { await sleepMs(2200); continue; }
        throw e;
      }
    }
    if (!sig) throw (lastErr || new Error('deposit transfer failed'));
    // The OSTG has now MOVED on-chain. Crediting it is idempotent by signature,
    // so we must RETRY the credit — a single verify that 429s would otherwise
    // strand the deposit (funds in the pool, no play credit). Remember the sig so
    // a failure is recovered automatically later.
    addPendingDeposit(sig);
    return await creditDeposit(sig);
  }

  function sleepMs(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  var PENDING_KEY = 'ost.play.pendingDeposits.v1';
  function readPending() { try { var a = JSON.parse(localStorage.getItem(PENDING_KEY) || '[]'); return Array.isArray(a) ? a : []; } catch (_) { return []; } }
  function addPendingDeposit(sig) { try { var a = readPending(); if (a.indexOf(sig) < 0) a.push(sig); localStorage.setItem(PENDING_KEY, JSON.stringify(a.slice(-30))); } catch (_) {} }
  function removePendingDeposit(sig) { try { localStorage.setItem(PENDING_KEY, JSON.stringify(readPending().filter(function (x) { return x !== sig; }))); } catch (_) {} }

  // Retry the credit until the chain confirms + the RPC cooperates. Transient
  // errors (tx_not_found, verify_failed, 429) retry; a permanent verdict stops.
  async function creditDeposit(sig) {
    var lastErr = '';
    for (var i = 0; i < 8; i++) {
      try {
        var r = await api('POST', '/play/deposit', { wallet: addr(), signature: sig });
        if (r && r.ok !== false && (r.credited != null || typeof r.balance === 'number' || r.idempotent)) {
          removePendingDeposit(sig);
          if (typeof r.balance === 'number') { mirror = r.balance; emit(); }
          return r;
        }
        lastErr = (r && (r.error || r.message)) || 'unverified';
        if (lastErr === 'no_ostg_to_pool' || lastErr === 'tx_failed' || lastErr === 'invalid_wallet') { removePendingDeposit(sig); throw new Error('Deposit could not be verified: ' + lastErr); }
      } catch (e) { lastErr = (e && e.message) || String(e); if (/could not be verified/.test(lastErr)) throw e; }
      await sleepMs(i < 2 ? 1500 : 3000);
    }
    // Left pending on purpose — the background sweep will finish it; funds are safe in the pool.
    throw new Error('Your OSTG moved to the pool but the credit is still confirming — it will finish automatically in a moment.');
  }
  // On load + periodically, finish any deposit whose credit didn't land (e.g. a
  // 429 during verify). Idempotent by signature, so this can only ever help.
  function sweepPendingDeposits() { readPending().forEach(function (sig) { creditDeposit(sig).catch(function () {}); }); }
  window.OST_PLAY_SWEEP_DEPOSITS = sweepPendingDeposits;

  // ---- cashout: play balance -> wallet OSTG ------------------------------
  async function cashout(uiAmount) {
    var a = addr();
    if (!a) throw new Error('Connect your wallet first.');
    var amt = Number(uiAmount);
    if (!(amt > 0)) throw new Error('Enter an amount greater than zero.');
    var r = await api('POST', '/play/cashout', {
      wallet: a, amount: amt,
      idempotencyKey: 'co-' + a.slice(0, 8) + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7),
    });
    if (typeof r.balance === 'number') { mirror = r.balance; emit(); }
    return r;
  }

  // Refresh on wallet change / resume so the mirror tracks the server.
  window.addEventListener('ost:wallet-changed', function () { refresh(); setTimeout(sweepPendingDeposits, 2500); });
  window.addEventListener('ost:resume', function () { refresh(); sweepPendingDeposits(); });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', refresh);
  else refresh();
  // Finish any deposit whose credit didn't land, and keep checking (idempotent).
  setTimeout(sweepPendingDeposits, 4000);
  setInterval(sweepPendingDeposits, 60000);

  // Generic stake/settle for non-game products (predictions, stocks). `bucket`
  // says WHERE the money comes from - 'clean' (own OSTG) or a loan id - and the
  // server enforces the provenance rules. Winnings must be settled back to the
  // SAME bucket, which is what keeps loan-funded profit locked to its loan.
  async function stake(amount, opts) {
    var a = addr();
    if (!a) return { ok: false, error: 'no_wallet' };
    var bucket = activeBucket(opts && opts.bucket);
    try {
      var r = await api('POST', '/play/stake', { wallet: a, amount: Number(amount), bucket: bucket });
      if (r && r.ok && Number.isFinite(Number(r.balance))) { mirror = Number(r.balance); writeCache(a, mirror); emit(); }
      return r;
    } catch (e) { return { ok: false, error: (e && e.message) || 'stake_failed' }; }
  }
  async function settle(payout, opts) {
    var a = addr();
    if (!a) return { ok: false, error: 'no_wallet' };
    var bucket = activeBucket(opts && opts.bucket);
    try {
      var r = await api('POST', '/play/settle', {
        wallet: a, payout: Number(payout), bucket: bucket,
        // Fee already withheld from `payout` by OST_HOUSE/OST_ARB. Reported so
        // the server can record how much house edge grew the lending headroom.
        fee: Number((opts && opts.fee) || 0)
      });
      if (r && r.ok && Number.isFinite(Number(r.balance))) { mirror = Number(r.balance); writeCache(a, mirror); emit(); }
      return r;
    } catch (e) { return { ok: false, error: (e && e.message) || 'settle_failed' }; }
  }

  window.OST_PLAY = {
    balance: balance,
    refresh: refresh,
    stake: stake,
    settle: settle,
    bet: bet,
    sessionStart: sessionStart,
    sessionStep: sessionStep,
    sessionCashout: sessionCashout,
    memeBuy: memeBuy,
    memeSell: memeSell,
    memeCoin: memeCoin,
    memeHoldings: memeHoldings,
    stockOpen: stockOpen,
    stockClose: stockClose,
    stockPositions: stockPositions,
    deposit: deposit,
    cashout: cashout,
    addresses: { api: API, ostgMint: OSTG_MINT, poolOstgAta: POOL_OSTG_ATA },
  };
})();

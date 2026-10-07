/* ==========================================================================
   OST Devnet Rescue v4 — Server-signed, pool-paid UX + money outcome protocol
   ----------------------------------------------------------------------------
   The pool keypair never reaches the browser: every payout, ATA rental and
   cosigned swap/send is built and signed by the Cloudflare Worker
   (workers/ost-api/src/wallet-payouts.js). This file calls the worker, adds the
   user's own signature where needed, and implements contract C4 of the money
   plan on the client:

     · The transaction signature is known BEFORE submit (the pool's fee-payer
       signature is signatures[0]). It is saved first, so a lost answer can
       always be resolved by looking the signature up on chain.
     · 200 {ok, sig}            -> confirmed
       202 {ok, pending, sig}   -> sent; confirm by signature
       any lost / 5xx answer    -> re-POST the SAME cosignId + SAME signed tx
                                   once, then confirmBySig(sig, 30 s)
       Never "failed" after a broadcast unless the chain says the tx failed.
     · No code path builds a NEW transaction automatically after an unknown
       outcome. Every result is { ok, sig, pending }.
     · Every settled money move dispatches `ost:wallet-tx` (contract C5).

   Works against the old worker (no status endpoints, no 202) and the new one.
   ========================================================================== */
(function () {
  'use strict';

  if (typeof solanaWeb3 === 'undefined') return;

  var PAYOUT_RECEIPTS_KEY = 'ost.payout.receipts.v1';
  var PAYOUT_PENDING_KEY = 'ost.payout.pending.v1';
  var COSIGN_PENDING_KEY = 'ost.cosign.pending.v1';
  var OSTG_MINT = 'DfgxMbdN49AX2Za9LuvsyixF1jgVh45RbgWYSGonxQos';
  var TOKEN_2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
  var SYSTEM_PROGRAM = '11111111111111111111111111111111';
  var payoutLocks = {};

  function readStorageJson(key, fallback) {
    try {
      var parsed = JSON.parse(localStorage.getItem(key) || 'null');
      return parsed == null ? fallback : parsed;
    } catch (_) { return fallback; }
  }
  function writeStorageJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) {}
  }
  function stableHash(value) {
    var text = String(value || '');
    var hash = 2166136261;
    for (var index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return ('00000000' + (hash >>> 0).toString(16)).slice(-8);
  }
  function cleanPayoutId(value) {
    var text = String(value || '').replace(/[^a-z0-9_.:-]/gi, '-').slice(0, 72);
    return text || ('payout-' + Date.now().toString(36));
  }
  function payoutRefFromMemo(memoText) {
    var raw = String(memoText || '');
    try {
      var parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        return [
          parsed.k || parsed.kind || '',
          parsed.intent || parsed.reservation || parsed.id || parsed.market || parsed.payment || '',
          parsed.game || parsed.token || parsed.cur || '',
          parsed.side || parsed.role || ''
        ].join('|');
      }
    } catch (_) {}
    return raw.slice(0, 180);
  }
  function buildPayoutId(wallet, amount, memoText, options) {
    if (options && options.idempotencyKey) return cleanPayoutId(options.idempotencyKey);
    var ref = payoutRefFromMemo(memoText);
    return cleanPayoutId('pay-' + stableHash([wallet, Number(amount || 0).toFixed(9), ref].join('|')));
  }
  function getPayoutReceipt(id, wallet, amount) {
    var receipts = readStorageJson(PAYOUT_RECEIPTS_KEY, {});
    var receipt = receipts && receipts[id];
    if (!receipt || !receipt.sig) return null;
    if (receipt.verified !== true) return null;
    if (receipt.wallet && wallet && receipt.wallet !== wallet) return null;
    if (Math.abs(Number(receipt.ost || 0) - Number(amount || 0)) > 0.000000001) return null;
    return receipt;
  }
  function rememberPayoutReceipt(id, receipt) {
    var receipts = readStorageJson(PAYOUT_RECEIPTS_KEY, {});
    receipts[id] = Object.assign({ at: Date.now() }, receipt || {});
    var keys = Object.keys(receipts).sort(function (a, b) { return Number(receipts[b].at || 0) - Number(receipts[a].at || 0); });
    if (keys.length > 200) keys.slice(200).forEach(function (key) { delete receipts[key]; });
    writeStorageJson(PAYOUT_RECEIPTS_KEY, receipts);
  }
  function rememberPendingPayout(id, payload) {
    var pending = readStorageJson(PAYOUT_PENDING_KEY, {});
    pending[id] = Object.assign({ id: id, at: Date.now() }, payload || {});
    writeStorageJson(PAYOUT_PENDING_KEY, pending);
  }
  function clearPendingPayout(id) {
    var pending = readStorageJson(PAYOUT_PENDING_KEY, {});
    if (pending && pending[id]) { delete pending[id]; writeStorageJson(PAYOUT_PENDING_KEY, pending); }
  }
  function pendingPayouts() { return readStorageJson(PAYOUT_PENDING_KEY, {}); }

  // Cosigned transactions whose outcome was not yet known. Informational only:
  // NOTHING here is ever re-sent automatically (SOL-6). A later lookup by
  // signature tells the user what happened.
  function rememberPendingCosign(rec) {
    var all = readStorageJson(COSIGN_PENDING_KEY, {});
    all[rec.sig] = Object.assign({ at: Date.now() }, rec);
    var keys = Object.keys(all).sort(function (a, b) { return Number(all[b].at || 0) - Number(all[a].at || 0); });
    if (keys.length > 40) keys.slice(40).forEach(function (k) { delete all[k]; });
    writeStorageJson(COSIGN_PENDING_KEY, all);
  }
  function clearPendingCosign(sig) {
    var all = readStorageJson(COSIGN_PENDING_KEY, {});
    if (all && all[sig]) { delete all[sig]; writeStorageJson(COSIGN_PENDING_KEY, all); }
  }

  // -----------------------------------------------------------------------
  // RPC — reads go through the wallet's cooldown-aware rotation (app.js
  // rpcCall over the worker's /rpc-config endpoints). No public shared keys,
  // no keyed endpoints without a key (NET-1).
  // -----------------------------------------------------------------------
  var FALLBACK_ENDPOINTS = ['https://api.devnet.solana.com'];
  var rpcIndex = 0;
  var rpcConnections = {};
  function endpoints() {
    var list = (window.OST_RPC_ACTIVE_ENDPOINTS && window.OST_RPC_ACTIVE_ENDPOINTS.length) ? window.OST_RPC_ACTIVE_ENDPOINTS : FALLBACK_ENDPOINTS;
    return list.filter(function (u) { return !/ankr\.com|genesysgo|api-key=public/i.test(u); });
  }
  function makeConn(url) {
    if (!rpcConnections[url]) {
      try { rpcConnections[url] = new solanaWeb3.Connection(url, { commitment: 'confirmed', disableRetryOnRateLimit: true }); }
      catch (e) { return null; }
    }
    return rpcConnections[url];
  }
  function getRpc() {
    try { if (window.OST_WALLET && typeof window.OST_WALLET.getConnection === 'function') { var c = window.OST_WALLET.getConnection(); if (c) return c; } } catch (_) {}
    var list = endpoints();
    return makeConn(list[rpcIndex % list.length]);
  }
  function rotateRpc() {
    try { if (window.OST_WALLET && typeof window.OST_WALLET.rotateRpc === 'function') window.OST_WALLET.rotateRpc(); } catch (_) {}
    rpcIndex = (rpcIndex + 1) % Math.max(1, endpoints().length);
    return getRpc();
  }
  async function withRpc(label, fn) {
    if (window.OST_WALLET && typeof window.OST_WALLET.rpcCall === 'function') return window.OST_WALLET.rpcCall(fn);
    var lastErr = null, list = endpoints();
    for (var attempt = 0; attempt < list.length + 1; attempt++) {
      var conn = makeConn(list[(rpcIndex + attempt) % list.length]);
      try { return await fn(conn); }
      catch (e) { lastErr = e; await new Promise(function (r) { setTimeout(r, 250 * (attempt + 1)); }); }
    }
    throw lastErr || new Error(label + ' failed on every RPC');
  }

  // UNKNOWN IS NOT ZERO: a failed read returns undefined; the server is the
  // only solvency authority.
  async function getPoolOstBalance() {
    if (!window.OST_SWAP_POOL) return undefined;
    return withRpc('pool-ost', async function (conn) {
      var ata = new solanaWeb3.PublicKey(window.OST_SWAP_POOL.ata);
      var bal = await conn.getTokenAccountBalance(ata);
      var v = bal && bal.value && bal.value.uiAmount;
      return (v == null) ? undefined : Number(v);
    }).catch(function () { return undefined; });
  }
  async function getPoolSolBalance() {
    if (!window.OST_SWAP_POOL) return undefined;
    return withRpc('pool-sol', async function (conn) {
      var pk = new solanaWeb3.PublicKey(window.OST_SWAP_POOL.publicKey);
      var lam = await conn.getBalance(pk);
      return lam / solanaWeb3.LAMPORTS_PER_SOL;
    }).catch(function () { return undefined; });
  }

  // Client-side vault knobs are DISPLAY HINTS only; the worker re-checks all.
  function numberSetting(name, fallback) {
    var value = Number(window[name]);
    return Number.isFinite(value) && value >= 0 ? value : fallback;
  }
  function vaultConfig() {
    return {
      minReserve: numberSetting('OST_VAULT_MIN_RESERVE', 0),
      lowWater: numberSetting('OST_VAULT_LOW_WATER', 1000000000),
      targetReserve: numberSetting('OST_VAULT_TARGET_RESERVE', 10000000000),
      maxSinglePayout: numberSetting('OST_MAX_SINGLE_PAYOUT', 1000000000)
    };
  }

  function ostApiBaseSafe() {
    try { return (window.OST_API_BASE || 'https://ost-api.nachogtavl.workers.dev').replace(/\/+$/, ''); } catch (_) { return ''; }
  }

  // Errors carry { code, status, body, sig } so OST_MONEY_ERRORS can word
  // them; the message itself is already plain English.
  // `serverMessage` keeps the server's own sentence; `message` becomes the
  // worded "Title — body", and `human` marks it so OST_MONEY_ERRORS never
  // re-uses it as a body (no doubled titles). `stage` says whether the failure
  // came before anything was sent ('build') or while it was being sent ('submit').
  function rehumanize(e) {
    try {
      if (window.OST_MONEY_ERRORS) {
        var h = window.OST_MONEY_ERRORS.humanize(e, e.stage ? { stage: e.stage } : undefined);
        e.human = h;
        e.message = h.title + (h.body ? ' — ' + h.body : '');
      }
    } catch (_) {}
    return e;
  }
  function moneyError(code, message, extra) {
    var e = new Error(message || 'That didn’t go through.');
    e.code = code;
    e.serverMessage = String(message || '');
    if (extra) Object.keys(extra).forEach(function (k) { e[k] = extra[k]; });
    return rehumanize(e);
  }
  // Re-word an error once its stage is known (a failed quote request is
  // "nothing was sent", never "still confirming").
  function atStage(e, stage) {
    if (!e || typeof e !== 'object') return moneyError('unknown', String(e || ''), { stage: stage });
    e.stage = stage;
    if (e.human || e.serverMessage != null) rehumanize(e);
    else if (!e.code) { e.serverMessage = String(e.message || ''); e.code = 'unknown'; rehumanize(e); }
    return e;
  }

  async function apiRequest(method, path, body, timeoutMs) {
    var base = ostApiBaseSafe();
    if (!base) throw moneyError('network_error', 'OST API not configured');
    var res, resJson, rawText = '';
    var ctrl = new AbortController();
    var to = setTimeout(function () { try { ctrl.abort(); } catch (_) {} }, timeoutMs || 20000);
    try {
      res = await fetch(base + path, method === 'GET'
        ? { method: 'GET', cache: 'no-store', signal: ctrl.signal }
        : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: ctrl.signal });
      rawText = await res.text();
      try { resJson = JSON.parse(rawText); } catch (_) { resJson = null; }
    } catch (e) {
      var aborted = e && e.name === 'AbortError';
      throw moneyError(aborted ? 'timeout' : 'network_error', aborted ? 'The OST service took too long to answer.' : 'Could not reach the OST service.', { status: 0 });
    } finally { clearTimeout(to); }
    if (!resJson) {
      var capped = /error code:\s*1027/i.test(rawText) || res.status === 1027;
      throw moneyError(capped ? 'cf_1027' : 'bad_response', capped ? 'OST is over its daily request budget.' : 'OST returned an unexpected response.', { status: res.status });
    }
    if (!res.ok || resJson.ok === false || (!resJson.ok && resJson.error)) {
      throw moneyError(String(resJson.error || 'http_' + res.status), resJson.message || resJson.error, { status: res.status, body: resJson, sig: resJson.sig || null });
    }
    resJson.__status = res.status;
    return resJson;
  }
  function apiPost(path, body, timeoutMs) { return apiRequest('POST', path, body, timeoutMs); }
  function apiGet(path, timeoutMs) { return apiRequest('GET', path, null, timeoutMs || 8000); }

  function logPayoutAudit(payload) {
    try {
      var base = ostApiBaseSafe();
      if (!base) return;
      var body = JSON.stringify(payload);
      // No sendBeacon: it sends credentials, which the worker's `*` CORS answer
      // rejects on every call. A text/plain keepalive fetch needs no preflight
      // and the worker parses the JSON body regardless of its content type.
      fetch(base + '/wallet/payouts', { method: 'POST', headers: { 'content-type': 'text/plain;charset=UTF-8' }, body: body, keepalive: true, credentials: 'omit' }).catch(function () {});
    } catch (_) {}
  }

  // -----------------------------------------------------------------------
  // C5 — one event for every settled money move.
  // -----------------------------------------------------------------------
  function walletTx(detail) {
    try {
      var d = Object.assign({ status: 'confirmed', source: 'rails' }, detail || {});
      window.dispatchEvent(new CustomEvent('ost:wallet-tx', { detail: d }));
    } catch (_) {}
  }

  // A sig that also carries { ok, sig, pending }: old callers keep using it as
  // a string (String(x), x.slice), new callers read the fields (C4).
  function sigResult(r) {
    var s = new String(r.sig || '');
    s.ok = r.ok !== false; s.sig = r.sig || ''; s.pending = !!r.pending;
    if (r.cosignId) s.cosignId = r.cosignId;
    if (r.quote) s.quote = r.quote;
    return s;
  }

  // -----------------------------------------------------------------------
  // Base58 (signatures) — tiny encoder so the sig is known before submit.
  // -----------------------------------------------------------------------
  var B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  function b58encode(bytes) {
    if (!bytes || !bytes.length) return '';
    var digits = [0];
    for (var i = 0; i < bytes.length; i++) {
      var carry = bytes[i];
      for (var j = 0; j < digits.length; j++) { carry += digits[j] << 8; digits[j] = carry % 58; carry = (carry / 58) | 0; }
      while (carry > 0) { digits.push(carry % 58); carry = (carry / 58) | 0; }
    }
    var out = '';
    for (var k = 0; k < bytes.length && bytes[k] === 0; k++) out += '1';
    for (var q = digits.length - 1; q >= 0; q--) out += B58[digits[q]];
    return out;
  }
  function firstSig(tx) {
    try {
      var s = tx && tx.signatures && tx.signatures[0];
      var raw = s && (s.signature || s);
      if (raw && raw.length === 64 && raw.some(function (b) { return b !== 0; })) return b58encode(raw);
    } catch (_) {}
    return '';
  }

  // -----------------------------------------------------------------------
  // confirmBySig(sig, {timeoutMs, cosignId, payoutId, lastValidBlockHeight})
  //   -> { ok:true,  pending:false, sig }            confirmed on chain
  //      { ok:false, pending:false, sig, err, code }  landed but FAILED on chain
  //      { ok:false, pending:false, sig, expired }    never landed (blockhash expired)
  //      { ok:true,  pending:true,  sig }             still unknown at timeout
  // Uses the worker status endpoint when present, else getSignatureStatuses.
  // -----------------------------------------------------------------------
  var statusEndpoint = { cosign: null, payout: null };   // null unknown, false missing
  var SIG_LIFETIME_MS = 4 * 60 * 1000;
  async function workerStatus(kind, id) {
    if (!id || statusEndpoint[kind] === false) return null;
    try {
      var r = await apiGet('/wallet/' + kind + '/status/' + encodeURIComponent(id), 6000);
      statusEndpoint[kind] = true;
      return r;
    } catch (e) {
      // The OLD worker answers these paths with "unknown endpoint" 404s. A new
      // worker's "no such id" answer is different and keeps the endpoint on.
      var bodyMsg = String((e && e.body && e.body.message) || '');
      if (e && e.status === 404 && (e.code === 'unknown_wallet_endpoint' || (e.code === 'not_found' && /unknown endpoint/i.test(bodyMsg)))) statusEndpoint[kind] = false;
      return null;
    }
  }
  function chainStatus(sig) {
    return withRpc('sig-status', function (c) { return c.getSignatureStatuses([sig], { searchTransactionHistory: true }); })
      .then(function (r) {
        if (!r || !Array.isArray(r.value)) throw new Error('signature status unavailable');   // unknown, not "not found"
        return r.value[0] || null;
      });
  }
  function blockHeight() {
    return withRpc('block-height', function (c) { return c.getBlockHeight('confirmed'); });
  }
  function decodeOnchainErr(err) {
    try { return window.OST_MONEY_ERRORS ? window.OST_MONEY_ERRORS.codeFromText(JSON.stringify(err)) || 'transaction_failed' : 'transaction_failed'; }
    catch (_) { return 'transaction_failed'; }
  }
  async function confirmBySig(sig, opts) {
    opts = opts || {};
    var timeoutMs = Number(opts.timeoutMs) || 30000;
    var deadline = Date.now() + timeoutMs;
    var poll = 0;
    while (true) {
      if (!sig && opts.payoutId) {
        var ps = await workerStatus('payout', opts.payoutId);
        if (ps) {
          var pst = String(ps.status || '').toLowerCase();
          if (ps.sig) sig = ps.sig;
          if ((pst === 'failed' || pst === 'released' || pst === 'refused') && !ps.sig) return { ok: false, pending: false, sig: '', code: ps.error || 'payout_failed' };
          if (pst === 'confirmed' && ps.sig) return { ok: true, pending: false, sig: ps.sig };
        } else if (statusEndpoint.payout === false) {
          return { ok: true, pending: true, sig: '' };      // old worker: cannot look it up
        }
      }
      if (sig) {
        // New worker: GET /wallet/cosign/status/:id knows confirmed / failed /
        // expired (it checks the blockhash window itself). Asked on the first
        // look and then every ~10 s, never in a tight loop.
        if (opts.cosignId && (poll === 0 || poll % 8 === 7) && statusEndpoint.cosign !== false) {
          var cs = await workerStatus('cosign', opts.cosignId);
          var cst = cs ? String(cs.status || '') : '';
          if (cs && (!cs.sig || cs.sig === sig)) {
            if (cst === 'confirmed') return { ok: true, pending: false, sig: sig };
            if (cst === 'failed') return { ok: false, pending: false, sig: sig, code: cs.code || 'tx_failed' };
            if (cst === 'expired') return { ok: false, pending: false, sig: sig, expired: true, code: 'blockhash_expired' };
          }
        }
        // A lookup that FAILED (every RPC down / rate-limited) is "unknown",
        // never "not found": only an RPC that answered null may count toward
        // "expired". Otherwise a landed payment could be reported as failed.
        var st = null, stKnown = false;
        try { st = await chainStatus(sig); stKnown = true; } catch (_) { st = null; stKnown = false; }
        if (st) {
          if (st.err) return { ok: false, pending: false, sig: sig, err: st.err, code: decodeOnchainErr(st.err) };
          if (st.confirmationStatus === 'confirmed' || st.confirmationStatus === 'finalized') return { ok: true, pending: false, sig: sig };
        } else if (stKnown && opts.lastValidBlockHeight && (poll % 3 === 2 || (poll === 0 && opts.expiryFirst))) {
          try {
            var h = await blockHeight();
            if (h > Number(opts.lastValidBlockHeight)) {
              // One more look: it may have landed in the final slots.
              var again = null, againKnown = false;
              try { again = await chainStatus(sig); againKnown = true; } catch (_) {}
              if (againKnown && !again) return { ok: false, pending: false, sig: sig, expired: true, code: 'blockhash_expired' };
            }
          } catch (_) {}
        } else if (stKnown && !opts.lastValidBlockHeight && Number(opts.signedAt) > 0 && Date.now() - Number(opts.signedAt) > SIG_LIFETIME_MS) {
          // No block height saved (older record): a transaction can only land
          // within ~150 blocks (~1-2 min) of its blockhash, which is older than
          // the moment it was signed. Not seen 4 min after signing, twice in a
          // row, means it never landed.
          var again2 = null, again2Known = false;
          try { await new Promise(function (r) { setTimeout(r, 1500); }); again2 = await chainStatus(sig); again2Known = true; } catch (_) {}
          if (again2Known && !again2) return { ok: false, pending: false, sig: sig, expired: true, code: 'blockhash_expired' };
        }
      }
      if (Date.now() >= deadline) return { ok: true, pending: true, sig: sig || '' };
      poll++;
      var waitMs = Number(opts.intervalMs) > 0 ? Number(opts.intervalMs) : (poll < 8 ? 1000 : 2000);
      await new Promise(function (r) { setTimeout(r, Math.min(waitMs, Math.max(250, deadline - Date.now()))); });
    }
  }

  // -----------------------------------------------------------------------
  // PAYOUT OST (pool -> user). Keyed by business object, never by amount.
  // -----------------------------------------------------------------------
  var DEFINITIVE_PAYOUT_REFUSALS = /^(invalid_|server_only_kind|credits_retired|rate_limited|cap_|cap_exceeded|daily_wallet_cap|daily_global_cap|insufficient_pool|solvency_cap|reserve_protected|balance_unknown|wallet_auth_required|unauthorized|already_paid|forbidden|bad_|missing_|mint_not_sponsored|below_rent_minimum|keep_rent_reserve|rpc_unavailable|verify_unavailable|price_unavailable|ticket_unverified|server_settled|payout_exceeds_ticket|payout_id_conflict)/;
  // A 5xx that the worker words as "nothing was sent / nothing was paid" is a
  // refusal before broadcast too (new worker: preBroadcastResponse).
  function saysNothingSent(err) {
    return /nothing was (?:signed or )?sent|nothing was paid|restarted before sending/i.test(String((err && (err.serverMessage || (err.body && err.body.message))) || ''));
  }
  async function payoutOst(toPubkeyInput, amountOst, memoText, options) {
    var to = (toPubkeyInput && toPubkeyInput.toBase58) ? toPubkeyInput : new solanaWeb3.PublicKey(toPubkeyInput);
    var walletStr = to.toBase58();
    var amt = Number(amountOst);
    if (!Number.isFinite(amt) || amt <= 0) throw moneyError('invalid_amount', 'Invalid payout amount');
    var memoSummary = String(memoText || '').slice(0, 200);
    var payoutId = buildPayoutId(walletStr, amt, memoText, options || {});

    var prior = getPayoutReceipt(payoutId, walletStr, amt);
    if (prior) return { ok: true, pending: false, sig: prior.sig, ost: Number(prior.ost || amt), auditId: payoutId, idempotent: true };
    if (payoutLocks[payoutId]) return payoutLocks[payoutId];

    payoutLocks[payoutId] = (async function () {
      logPayoutAudit({ id: payoutId, stage: 'intent', wallet: walletStr, kind: 'payout', ostAmount: amt, memo: memoSummary, ref: payoutRefFromMemo(memoText) });
      var resJson = null, failure = null;
      try {
        resJson = await apiPost('/wallet/payout', { wallet: walletStr, amountOst: amt, memo: memoText ? String(memoText) : '', payoutId: payoutId }, 25000);
      } catch (err) { failure = err; }

      if (failure && failure.code === 'already_paid' && failure.sig) { resJson = { ok: true, sig: failure.sig, ost: amt }; failure = null; }

      var fStatus = Number(failure && failure.status) || 0;
      var fCode = String((failure && failure.code) || '');
      // 422 tx_failed carries the sig of a payout that FAILED on chain: nothing was paid.
      var failedOnChain = failure && fCode === 'tx_failed' && fStatus === 422;
      if (failure && (failedOnChain || (!failure.sig && (DEFINITIVE_PAYOUT_REFUSALS.test(fCode) ||
          (fCode === 'gate_reset' && saysNothingSent(failure)) ||
          (fStatus >= 400 && fStatus < 500 && !/unconfirmed|unknown|pending|in_progress/.test(fCode)))))) {
        clearPendingPayout(payoutId);
        logPayoutAudit({ id: payoutId, stage: 'failure', wallet: walletStr, kind: 'payout', ostAmount: amt, memo: memoSummary, error: String(failure.code || '').slice(0, 80), ref: payoutRefFromMemo(memoText) });
        throw failedOnChain ? failure : atStage(failure, 'build');
      }

      var sig = resJson && resJson.sig ? String(resJson.sig) : (failure && failure.sig ? String(failure.sig) : '');
      var pending = !!(resJson && resJson.pending) || !!failure;
      if (pending) {
        // Lost answer, 5xx, 202 or "unconfirmed": find out what happened. Never pay again blindly.
        rememberPendingPayout(payoutId, { wallet: walletStr, ostAmount: amt, memo: memoSummary, sig: sig || null, stage: (failure && failure.code) || 'pending' });
        var c = await confirmBySig(sig, { timeoutMs: 30000, payoutId: payoutId });
        if (c.ok && !c.pending && c.sig) { sig = c.sig; pending = false; }
        else if (!c.ok && !c.pending) {
          clearPendingPayout(payoutId);
          throw moneyError(c.code || 'payout_failed', 'The payout did not go through.', { sig: c.sig || null, payoutId: payoutId });
        } else {
          // Still unknown: say so. The caller shows "Paying…" and must not retry with a new id.
          walletTx({ sig: c.sig || sig || '', asset: 'OST', amount: amt, direction: 'in', status: 'pending', source: 'payout' });
          throw moneyError('state_unknown', 'Still confirming.', { pending: true, sig: c.sig || sig || null, payoutId: payoutId, stage: 'submit' });
        }
      }
      clearPendingPayout(payoutId);
      var paidOst = (resJson && resJson.ost) || amt;
      rememberPayoutReceipt(payoutId, { wallet: walletStr, ost: paidOst, sig: sig, memo: memoSummary, ref: payoutRefFromMemo(memoText), verified: true });
      logPayoutAudit({ id: payoutId, stage: 'result', wallet: walletStr, kind: 'payout', ostAmount: amt, memo: memoSummary, sig: sig, ref: payoutRefFromMemo(memoText) });
      walletTx({ sig: sig, asset: 'OST', amount: Number(paidOst), direction: 'in', status: 'confirmed', source: 'payout' });
      return { ok: true, pending: false, sig: sig, ost: paidOst, auditId: payoutId };
    })();

    try { return await payoutLocks[payoutId]; }
    finally { delete payoutLocks[payoutId]; }
  }

  async function payoutStatus(payoutId) { return workerStatus('payout', payoutId); }
  async function cosignStatus(cosignId) { return workerStatus('cosign', cosignId); }

  // -----------------------------------------------------------------------
  // POOL-PAID TOKEN ACCOUNTS (SRV-5 client): look on chain first; only ask the
  // worker when the account is really missing; never surface a false
  // IllegalOwner as a failure when the account turns out to exist.
  // -----------------------------------------------------------------------
  var ATA_EXISTS = Object.create(null);
  function ataFor(owner, mintKey) {
    var w = window.OST_WALLET;
    var c = (w && w.constants) || {};
    var progId = c.TOKEN_2022_PROGRAM_ID || new solanaWeb3.PublicKey(TOKEN_2022);
    if (w && typeof w.associatedAddress === 'function') return w.associatedAddress(new solanaWeb3.PublicKey(mintKey), owner, true, progId, c.ASSOCIATED_TOKEN_PROGRAM_ID);
    return solanaWeb3.PublicKey.findProgramAddressSync(
      [owner.toBuffer(), new solanaWeb3.PublicKey(TOKEN_2022).toBuffer(), new solanaWeb3.PublicKey(mintKey).toBuffer()],
      new solanaWeb3.PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'))[0];
  }
  async function accountExists(pk) {
    try { var info = await withRpc('ata-exists', function (c) { return c.getAccountInfo(pk); }); return info ? true : false; }
    catch (_) { return null; }     // unknown
  }
  async function ensureUserAtaForMint(userPubkey, mint) {
    var owner = (userPubkey && userPubkey.toBase58) ? userPubkey : new solanaWeb3.PublicKey(userPubkey);
    var ownerKey = owner.toBase58();
    var mintKey = (mint && mint.toBase58) ? mint.toBase58() : String(mint || (window.OST_SWAP_POOL && window.OST_SWAP_POOL.mint));
    var cacheKey = ownerKey + ':' + mintKey;
    var ata = ataFor(owner, mintKey);
    if (ATA_EXISTS[cacheKey]) return ata;
    if (await accountExists(ata) === true) { ATA_EXISTS[cacheKey] = true; return ata; }
    try {
      var resJson = await apiPost('/wallet/ata-rent', { owner: ownerKey, mint: mintKey }, 25000);
      ATA_EXISTS[cacheKey] = true;
      return resJson && resJson.ata ? new solanaWeb3.PublicKey(resJson.ata) : ata;
    } catch (e) {
      // The worker may report a failed re-create of an account that exists.
      if (await accountExists(ata) === true) { ATA_EXISTS[cacheKey] = true; return ata; }
      throw e;
    }
  }
  async function ensureUserOstAtaPoolPaid(userPubkey) {
    return ensureUserAtaForMint(userPubkey, window.OST_SWAP_POOL && window.OST_SWAP_POOL.mint);
  }

  // -----------------------------------------------------------------------
  // Built-transaction checks: before the user signs, make sure the worker
  // built exactly what was asked (amount typed == amount signed; the right
  // token). An old worker that ignores `mint` is caught here.
  // -----------------------------------------------------------------------
  function readU64(data, off) {
    var v = 0n;
    for (var i = 7; i >= 0; i--) v = (v << 8n) | BigInt(data[off + i]);
    return v;
  }
  function describeTx(tx) {
    var out = { sol: [], token: [] };
    (tx.instructions || []).forEach(function (ix) {
      var pid = ix.programId.toBase58();
      var d = ix.data;
      if (pid === SYSTEM_PROGRAM && d && d.length >= 12 && d[0] === 2 && d[1] === 0 && d[2] === 0 && d[3] === 0) {
        out.sol.push({ from: ix.keys[0].pubkey.toBase58(), to: ix.keys[1].pubkey.toBase58(), lamports: readU64(d, 4) });
      } else if (pid === TOKEN_2022 && d && d.length >= 10 && d[0] === 12) {
        out.token.push({ source: ix.keys[0].pubkey.toBase58(), mint: ix.keys[1].pubkey.toBase58(), dest: ix.keys[2].pubkey.toBase58(), owner: ix.keys[3].pubkey.toBase58(), amount: readU64(d, 1), decimals: d[9] });
      }
    });
    return out;
  }
  function toBase(amount, decimals) {
    var s = String(amount);
    if (/e/i.test(s)) s = Number(amount).toFixed(decimals);
    var parts = s.split('.');
    var frac = (parts[1] || '').slice(0, decimals);
    while (frac.length < decimals) frac += '0';
    return BigInt(parts[0] || '0') * (10n ** BigInt(decimals)) + BigInt(frac || '0');
  }
  function verifyBuilt(kind, params, tx, wallet) {
    var d = describeTx(tx);
    var ostMint = (window.OST_SWAP_POOL && window.OST_SWAP_POOL.mint) || '';
    if (kind === 'sol-to-ost') {
      var mine = d.sol.filter(function (s) { return s.from === wallet; });
      var want = toBase(params.amount, 9);
      if (mine.length !== 1 || mine[0].lamports !== want) throw moneyError('amount_mismatch', 'The amount to sign didn’t match what you typed.');
    } else if (kind === 'ost-to-sol') {
      var outT = d.token.filter(function (t) { return t.owner === wallet; });
      var wantO = toBase(params.amount, 9);
      if (outT.length !== 1 || outT[0].amount !== wantO || (ostMint && outT[0].mint !== ostMint)) throw moneyError('amount_mismatch', 'The amount to sign didn’t match what you typed.');
      if (d.sol.some(function (s) { return s.from === wallet; })) throw moneyError('amount_mismatch', 'Unexpected SOL debit.');
    } else if (kind === 'peer-transfer') {
      var wantMint = params.mint || ostMint;
      var t = d.token.filter(function (x) { return x.owner === wallet; });
      if (t.length !== 1) throw moneyError('amount_mismatch', 'Unexpected transfer shape.');
      if (wantMint && t[0].mint !== wantMint) throw moneyError('needs_new_service', 'Sending this token needs the updated OST service.');
      if (t[0].amount !== toBase(params.amount, t[0].decimals)) throw moneyError('amount_mismatch', 'The amount to sign didn’t match what you typed.');
      if (d.sol.some(function (s) { return s.from === wallet; })) throw moneyError('amount_mismatch', 'Unexpected SOL debit.');
    }
  }

  // -----------------------------------------------------------------------
  // COSIGN — worker builds + pool partial-signs; the user adds their own
  // signature; the worker submits. C4 outcome handling lives here.
  // -----------------------------------------------------------------------
  function base64ToUint8(base64) {
    var binary = atob(base64);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
  function uint8ToBase64(bytes) {
    var binary = '';
    for (var i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }
  var PRE_BROADCAST = /^(blockhash_expired|invalid_transaction|missing_fields|cosign_not_found|invalid_json|wallet_auth_required|unauthorized)$/;
  // New-worker 5xx answers that state nothing was signed or sent (C4: these
  // would ideally be 4xx). Only the FIRST submit answer may prove it.
  var NOTHING_SENT_5XX = /^(rpc_unavailable|price_unavailable|verify_unavailable|balance_unknown|insufficient_pool_sol|daily_global_cap)$/;

  async function cosignSwap(kind, params, opts) {
    opts = opts || {};
    var w = window.OST_WALLET;
    if (!w || !w.session || !w.session.publicKey) throw moneyError('no_wallet', 'Connect a wallet first', { stage: 'build' });
    var walletStr = w.session.publicKey.toBase58();
    var body = Object.assign({ kind: kind, wallet: walletStr }, params);
    // BUILD: nothing is signed or sent until the user's signature is added, so
    // every failure up to that point is "nothing was sent", never pending.
    var built, tx;
    try {
      built = await apiPost('/wallet/cosign', body, 25000);
      tx = solanaWeb3.Transaction.from(base64ToUint8(built.txBase64));
    } catch (e) {
      if (e && (e.code || e.human)) throw atStage(e, 'build');
      throw moneyError('bad_response', 'OST returned an unexpected transaction.', { stage: 'build' });
    }
    if (opts.verify !== false) {
      try { verifyBuilt(kind, params || {}, tx, walletStr); } catch (e) { throw atStage(e, 'build'); }
    }
    var session = w.session;
    var providerSig = '';
    var poolSig = firstSig(tx) || (built && typeof built.sig === 'string' ? built.sig : '');
    try {
      if (session.kind === 'local' && session.keypair) {
        tx.partialSign(session.keypair);
      } else if (session.provider && typeof session.provider.signTransaction === 'function') {
        tx = await session.provider.signTransaction(tx);
      } else if (session.provider && typeof session.provider.signAndSendTransaction === 'function') {
        // Signs AND submits in one call; the pool's signature is already on it.
        if (poolSig) rememberPendingCosign({ sig: poolSig, cosignId: built.cosignId, kind: kind, amount: params && params.amount, to: params && params.to, mint: params && params.mint, wallet: walletStr, lastValidBlockHeight: built.lastValidBlockHeight });
        var res;
        try { res = await session.provider.signAndSendTransaction(tx); }
        catch (sendErr) {
          if (sendErr && (sendErr.code === 4001 || /reject|cancel|denied|declined/i.test(String(sendErr && sendErr.message)))) { if (poolSig) clearPendingCosign(poolSig); throw sendErr; }
          // The wallet may have broadcast before failing: look it up by the
          // pool's signature (known before signing) instead of guessing.
          if (!poolSig) throw sendErr;
          providerSig = poolSig;
        }
        if (!providerSig) providerSig = typeof res === 'string' ? res : (res && res.signature) || '';
        if (!providerSig) throw moneyError('wallet_cannot_sign', 'Wallet did not return a signature', { stage: 'build' });
      } else {
        throw moneyError('wallet_cannot_sign', 'Wallet cannot sign transactions', { stage: 'build' });
      }
    } catch (e) {
      if (e && (e.code === 4001 || e.code === 'user_rejected' || /reject|cancel|denied|declined/i.test(String(e && (e.serverMessage || e.message))))) throw moneyError('user_rejected', 'Cancelled in your wallet.', { stage: 'build' });
      if (e && e.human) throw atStage(e, 'build');
      throw moneyError('sign_failed', 'Your wallet didn’t sign it.', { stage: 'build', rawMessage: String((e && e.message) || e || '').slice(0, 300) });
    }

    var sig = providerSig || firstSig(tx) || poolSig;
    var rec = { sig: sig, cosignId: built.cosignId, kind: kind, amount: params && params.amount, to: params && params.to, mint: params && params.mint, wallet: walletStr, lastValidBlockHeight: built.lastValidBlockHeight };
    // SOL-4 / C4: save the signature BEFORE anything is sent.
    if (sig) rememberPendingCosign(rec);
    if (opts.onSigned) { try { opts.onSigned(sig, built); } catch (_) {} }

    var result;
    if (providerSig) {
      var pc = await confirmBySig(sig, { timeoutMs: 30000, cosignId: built.cosignId, lastValidBlockHeight: built.lastValidBlockHeight });
      result = finish(pc, rec, built);
    } else {
      var signedTxBase64 = uint8ToBase64(tx.serialize({ requireAllSignatures: false, verifySignatures: false }));
      var submitted = null, lastErr = null;
      for (var attempt = 0; attempt < 2 && !submitted; attempt++) {
        try {
          submitted = await apiPost('/wallet/cosign/submit', { cosignId: built.cosignId, signedTxBase64: signedTxBase64 }, 25000);
        } catch (err) {
          lastErr = err;
          var code = String((err && err.code) || '');
          var st4 = Number(err && err.status) || 0;
          if (err && typeof err === 'object' && !err.stage) { err.stage = 'submit'; rehumanize(err); }
          // 422 tx_failed: it landed and FAILED on chain — definitive, nothing moved.
          if (code === 'tx_failed' && st4 === 422) { clearPendingCosign(sig); throw err; }
          // C4: a 4xx without a signature is a refusal BEFORE broadcast (insufficient
          // balance, rent minimum, stale quote, auth…). 5xx / lost answers are not,
          // except the new worker's explicit "nothing was sent" 5xx answers.
          // Only the FIRST answer can prove "never sent": after an unknown first
          // attempt the retry's 4xx (cosign_not_found, blockhash_expired…) says
          // nothing about the first broadcast. blockhash_expired can also come
          // AFTER a broadcast, so both go to the definitive chain check below.
          if (attempt > 0 || code === 'blockhash_expired') { if (code === 'blockhash_expired') lastErr = err; break; }
          var refusedBeforeSend = (!(err && err.sig) && (PRE_BROADCAST.test(code) || NOTHING_SENT_5XX.test(code) ||
            (st4 >= 400 && st4 < 500 && !/unconfirmed|unknown|pending|in_progress/.test(code)))) ||
            (code === 'gate_reset' && saysNothingSent(err));
          if (refusedBeforeSend) {
            // One quick look on chain, so a refusal is never shown for something that landed.
            var pre = null;
            if (sig) { try { pre = await chainStatus(sig); } catch (_) { pre = null; } }
            if (pre && !pre.err) { submitted = { ok: true, sig: sig, pending: !(pre.confirmationStatus === 'confirmed' || pre.confirmationStatus === 'finalized') }; break; }
            clearPendingCosign(sig);
            throw atStage(err, 'build');
          }
          if (err && err.sig && !sig) { sig = err.sig; rec.sig = sig; }
          // Anything else: re-POST the SAME cosignId + SAME signed tx once (same
          // signature, so it can never pay twice), then look it up by signature.
        }
      }
      if (submitted && submitted.sig && !submitted.pending) {
        if (sig && submitted.sig !== sig) sig = submitted.sig;
        result = finish({ ok: true, pending: false, sig: submitted.sig || sig }, rec, built);
      } else {
        var cs = await confirmBySig((submitted && submitted.sig) || sig, { timeoutMs: 30000, cosignId: built.cosignId, lastValidBlockHeight: built.lastValidBlockHeight });
        if (!cs.ok && !cs.pending && cs.expired && lastErr && !submitted) {
          clearPendingCosign(sig);
          // It provably never landed: say "nothing moved", not the lost answer's "still confirming".
          throw moneyError('blockhash_expired', 'It was never sent and its quote expired. Nothing moved.', { sig: sig || null, expired: true, stage: 'build' });
        }
        result = finish(cs, rec, built);
      }
    }
    // Unknown after 30 s: keep looking in the background until the blockhash
    // window closes, then say what happened (C4: pending -> confirmed|failed).
    if (result && result.pending) watchPendingCosign(rec);
    return result;
  }

  function finish(c, rec, built) {
    if (c.ok && !c.pending) {
      clearPendingCosign(rec.sig);
      return { ok: true, pending: false, sig: c.sig || rec.sig, quote: built.quote, cosignId: built.cosignId };
    }
    if (c.ok && c.pending) {
      return { ok: true, pending: true, sig: c.sig || rec.sig, quote: built.quote, cosignId: built.cosignId };
    }
    clearPendingCosign(rec.sig);
    throw moneyError(c.code || 'transaction_failed', c.expired ? 'It was never sent and its quote expired. Nothing moved.' : 'It didn’t go through.', { sig: c.sig || rec.sig || null, onchainErr: c.err || null, expired: !!c.expired, stage: c.expired ? 'build' : 'submit' });
  }

  // -----------------------------------------------------------------------
  // Unknown outcomes are resolved, never forgotten. A pending cosign is looked
  // up by signature (and by cosignId on the new worker) until it confirms,
  // fails on chain, or its blockhash expires; then `ost:wallet-tx` fires with
  // status confirmed|failed and the person is told. On load, any pending
  // record left by a closed/reloaded tab is resolved the same way.
  // NOTHING is ever re-signed or re-sent here (SOL-6).
  // -----------------------------------------------------------------------
  var watching = Object.create(null);
  function assetOfRec(rec) {
    var ostMint = (window.OST_SWAP_POOL && window.OST_SWAP_POOL.mint) || '';
    if (rec.kind === 'peer-transfer') return (rec.mint && rec.mint !== ostMint) ? (rec.mint === OSTG_MINT ? 'OSTG' : 'TOKEN') : 'OST';
    if (rec.kind === 'sol-to-ost') return 'SOL';
    if (rec.kind === 'ost-to-sol') return 'OST';
    return '';
  }
  function describeRec(rec) {
    var amt = Number(rec.amount);
    var asset = assetOfRec(rec);
    var what = rec.kind === 'peer-transfer' ? 'send' : (rec.kind === 'fee-only' ? 'transaction' : 'conversion');
    return 'Your ' + what + (Number.isFinite(amt) && amt > 0 && asset ? ' of ' + amt + ' ' + asset : '') +
      (rec.kind === 'peer-transfer' && rec.to && rec.to !== (window.OST_SWAP_POOL && window.OST_SWAP_POOL.publicKey) ? ' to ' + String(rec.to).slice(0, 4) + '…' + String(rec.to).slice(-4) : '');
  }
  function announceResolution(rec, c, fromReload) {
    var ok = c.ok && !c.pending;
    var asset = assetOfRec(rec);
    if (rec.kind !== 'fee-only' || asset) {
      walletTx({ sig: rec.sig, asset: asset, amount: Number(rec.amount) || 0, direction: rec.kind === 'peer-transfer' ? 'out' : 'convert', to: rec.to, kind: rec.kind, status: ok ? 'confirmed' : 'failed', source: 'cosign:' + rec.kind, resolved: true, cosignId: rec.cosignId });
    } else {
      walletTx({ sig: rec.sig, asset: '', amount: 0, direction: 'out', kind: rec.kind, status: ok ? 'confirmed' : 'failed', source: 'cosign:fee-only', resolved: true, cosignId: rec.cosignId });
    }
    var title = ok ? (fromReload ? 'Earlier transaction confirmed' : 'Confirmed') : 'It didn’t go through';
    var body = ok ? describeRec(rec) + ' went through.' : describeRec(rec) + (c.expired ? ' was never sent. Nothing moved — you can try again.' : ' failed on chain. Nothing moved — you can try again.');
    try {
      if (typeof window.OST_NOTIFY === 'function') window.OST_NOTIFY({ id: 'cosign-' + rec.sig, kind: ok ? 'ok' : 'warn', title: title, body: body, sig: ok ? rec.sig : undefined });
      else if (typeof window.toast === 'function') window.toast(ok ? '✅' : '⚠️', title + ' — ' + body);
    } catch (_) {}
  }
  function watchPendingCosign(rec, fromReload) {
    if (!rec || !rec.sig) return null;
    if (watching[rec.sig]) return watching[rec.sig];
    var p = (async function () {
      // The blockhash window is ~60-90 s; look for up to 4 min (slowly: one
      // lookup every ~5 s), then leave the record for the next page load.
      var deadline = Date.now() + 4 * 60 * 1000;
      while (Date.now() < deadline) {
        var c = await confirmBySig(rec.sig, { timeoutMs: 45000, intervalMs: 5000, cosignId: rec.cosignId, lastValidBlockHeight: rec.lastValidBlockHeight, signedAt: rec.at, expiryFirst: true });
        if (!c.pending) {
          clearPendingCosign(rec.sig);
          announceResolution(rec, c, fromReload);
          return c;
        }
      }
      return { ok: true, pending: true, sig: rec.sig };
    })().catch(function () { return { ok: true, pending: true, sig: rec.sig }; });
    watching[rec.sig] = p;
    p.then(function () { delete watching[rec.sig]; });
    return p;
  }
  var PAGE_LOADED_AT = Date.now();
  function resolveSavedCosigns() {
    var all = readStorageJson(COSIGN_PENDING_KEY, {});
    var keys = Object.keys(all || {});
    if (!keys.length) return;
    var me = '';
    try { me = window.OST_WALLET && window.OST_WALLET.session && window.OST_WALLET.session.publicKey ? window.OST_WALLET.session.publicKey.toBase58() : ''; } catch (_) {}
    keys.forEach(function (k, i) {
      var rec = all[k];
      if (!rec || !rec.sig) { clearPendingCosign(k); return; }
      // Week-old unknowns cannot be told apart any more; drop them quietly.
      if (Date.now() - Number(rec.at || 0) > 7 * 24 * 3600 * 1000) { clearPendingCosign(k); return; }
      if (Number(rec.at || 0) >= PAGE_LOADED_AT) return;          // in flight on this page: its own flow resolves it
      if (me && rec.wallet && rec.wallet !== me) return;
      setTimeout(function () { watchPendingCosign(rec, true); }, i * 1500);
    });
  }

  function cosignEvent(kind, params, r) {
    var ostMint = (window.OST_SWAP_POOL && window.OST_SWAP_POOL.mint) || '';
    var asset = kind === 'peer-transfer' ? ((params.mint && params.mint !== ostMint) ? (params.mint === OSTG_MINT ? 'OSTG' : 'TOKEN') : 'OST')
      : kind === 'sol-to-ost' ? 'SOL' : kind === 'ost-to-sol' ? 'OST' : '';
    walletTx({ sig: r.sig, asset: asset, amount: Number(params.amount) || 0, direction: kind === 'peer-transfer' ? 'out' : 'convert', to: params.to, kind: kind, status: r.pending ? 'pending' : 'confirmed', source: 'cosign:' + kind });
  }

  // Public cosign: same shape as before plus { ok, pending } and the C5 event.
  async function cosignPublic(kind, params, opts) {
    var r = await cosignSwap(kind, params || {}, opts);
    if (kind !== 'fee-only') cosignEvent(kind, params || {}, r);
    return r;
  }

  async function userSendsOstToPool(amountOst, memoText) {
    var amt = Number(amountOst);
    if (!Number.isFinite(amt) || amt <= 0) throw moneyError('invalid_amount', 'Enter a valid OST amount');
    var result = await cosignPublic('peer-transfer', { to: window.OST_SWAP_POOL.publicKey, amount: amt, memo: memoText ? String(memoText) : '' });
    return { ok: true, sig: result.sig, ost: amt, pending: result.pending };
  }

  // sendPeerOst(to, amount, memo, mint?) — pool pays the fee AND the recipient's
  // token account (TRF-1). Resolves to a signature string carrying
  // { ok, sig, pending } (C4). mint = OSTG needs the updated worker (TRF-2);
  // an old worker is detected before signing and refused with a clear message.
  async function sendPeerOst(toAddress, amountOst, memoText, mint) {
    var amt = Number(amountOst);
    if (!Number.isFinite(amt) || amt <= 0) throw moneyError('invalid_amount', 'Enter a valid amount.');
    var params = { to: String(toAddress), amount: amt, memo: memoText ? String(memoText) : '' };
    var mintKey = mint ? ((mint.toBase58) ? mint.toBase58() : String(mint)) : '';
    if (mintKey && mintKey !== (window.OST_SWAP_POOL && window.OST_SWAP_POOL.mint)) params.mint = mintKey;
    var r = await cosignPublic('peer-transfer', params);
    return sigResult(r);
  }

  // Pool pays the fee only — for arbitrary instructions (bridge, play deposit).
  async function sendPoolFeeOnly(instructions, opts) {
    var list = (instructions || []).filter(Boolean).map(function (ix) {
      return {
        programId: ix.programId.toBase58(),
        keys: ix.keys.map(function (k) { return { pubkey: k.pubkey.toBase58(), isSigner: !!k.isSigner, isWritable: !!k.isWritable }; }),
        data: uint8ToBase64(ix.data instanceof Uint8Array ? ix.data : new Uint8Array(ix.data || []))
      };
    });
    var result = await cosignSwap('fee-only', { instructions: list }, opts && typeof opts.onSigned === 'function' ? { onSigned: opts.onSigned } : undefined);
    return sigResult(result);
  }

  // -----------------------------------------------------------------------
  // MEMECOIN BUY / SELL
  // -----------------------------------------------------------------------
  async function memecoinBuy(token, ostAmount) {
    return userSendsOstToPool(ostAmount,
      JSON.stringify({ k: 'memecoin-buy', token: String(token || ''), ost: Number(ostAmount), t: Date.now() })
    ).then(function (r) { return Object.assign({ side: 'buy', token: token }, r); });
  }
  async function memecoinSell(token, ostAmount) {
    var w = window.OST_WALLET;
    if (!w || !w.session || !w.session.publicKey) throw moneyError('no_wallet', 'Connect a wallet first');
    return payoutOst(w.session.publicKey, ostAmount,
      JSON.stringify({ k: 'memecoin-sell', token: String(token || ''), ost: Number(ostAmount), t: Date.now() })
    ).then(function (r) { return Object.assign({ side: 'sell', token: token }, r); });
  }

  // -----------------------------------------------------------------------
  // PREDICTION CASH-OUT — keyed per ticket, never by amount (C4 / SRV-3).
  // Resolves { ok, sig, pending:false } when paid; rejects with
  // { code:'state_unknown', pending:true, payoutId, sig? } when the outcome is
  // unknown (show "Paying…", reconcile with OST_RESCUE.payoutStatus).
  // -----------------------------------------------------------------------
  async function predictionCashOut(orderRecord, payoutAmount) {
    var w = window.OST_WALLET;
    if (!w || !w.session || !w.session.publicKey) throw moneyError('no_wallet', 'Connect a wallet first');
    var orderId = orderRecord && (orderRecord.signature || orderRecord.sig || orderRecord.remoteId || orderRecord.id || '');
    return payoutOst(w.session.publicKey, payoutAmount,
      JSON.stringify({
        k: orderRecord && orderRecord.cashoutKind === 'prediction-sell' ? 'prediction-sell' : 'prediction-settlement',
        id: orderId,
        market: orderRecord && orderRecord.marketId,
        side: orderRecord && orderRecord.side,
        stake: orderRecord && Number(orderRecord.stake || 0),
        payout: Number(payoutAmount),
        t: Date.now()
      }),
      { idempotencyKey: 'prediction-cashout:' + (orderId || stableHash(JSON.stringify(orderRecord || {}))) }
    );
  }

  // -----------------------------------------------------------------------
  // OST_WALLET.ensureFee -> no-op without RPC (the pool pays every OST fee).
  // -----------------------------------------------------------------------
  function patchEnsureFee() {
    var w = window.OST_WALLET;
    if (!w || w.__rescuePatched) return;
    w.__rescuePatched = true;
    var origEnsure = w.ensureFee;
    try {
      w.ensureFee = async function () { return { feeCovered: true, funded: false, source: 'pool-paid' }; };
      w.ensureFeeOriginal = origEnsure;
    } catch (_) {}
  }

  // -----------------------------------------------------------------------
  // PUBLIC API
  // -----------------------------------------------------------------------
  window.OST_RESCUE = {
    rpc: { get: getRpc, rotate: rotateRpc, endpoints: endpoints(), withRpc: withRpc },
    poolBalance: getPoolOstBalance,
    poolSolBalance: getPoolSolBalance,
    pendingPayouts: pendingPayouts,
    pendingCosigns: function () { return readStorageJson(COSIGN_PENDING_KEY, {}); },
    resolvePendingCosigns: resolveSavedCosigns,
    watchPendingCosign: function (sig) { var all = readStorageJson(COSIGN_PENDING_KEY, {}); return all && all[sig] ? watchPendingCosign(all[sig]) : null; },
    sigOf: firstSig,
    vaultConfig: vaultConfig,
    ensureUserAta: ensureUserOstAtaPoolPaid,
    ensureUserAtaForMint: ensureUserAtaForMint,
    payoutOst: payoutOst,
    payoutStatus: payoutStatus,
    cosignStatus: cosignStatus,
    userSendsOstToPool: userSendsOstToPool,
    sendPeerOst: sendPeerOst,
    sendPoolFeeOnly: sendPoolFeeOnly,
    cosignSwap: cosignPublic,
    confirmBySig: confirmBySig,
    walletTx: walletTx,
    describeTx: describeTx,
    OSTG_MINT: OSTG_MINT
  };
  window.OST_TRADE = window.OST_TRADE || {};
  window.OST_TRADE.memecoinBuy = memecoinBuy;
  window.OST_TRADE.memecoinSell = memecoinSell;
  window.OST_TRADE.predictionCashOut = predictionCashOut;
  window.OST_TRADE.payoutOst = payoutOst;

  var resolvedOnce = false;
  function bootstrap() {
    if (!window.OST_WALLET) { return setTimeout(bootstrap, 250); }
    patchEnsureFee();
    // Resolve sends left unknown by a closed or reloaded tab — after the page
    // settles, and only when there is something to resolve (no idle RPC).
    if (!resolvedOnce) {
      resolvedOnce = true;
      setTimeout(function () { try { resolveSavedCosigns(); } catch (_) {} }, 6000);
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }
})();

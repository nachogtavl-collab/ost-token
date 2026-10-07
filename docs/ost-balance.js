/* ==========================================================================
 * OST · Balance — the ONE client-side answer, backed by /balance/truth
 * --------------------------------------------------------------------------
 * Contract C6 (money plan §6):
 *
 *   OST_BALANCE.get() -> { ost, ostg, play, sol }   each a Number or null
 *       ost  = on-chain OSTC (the mint shown as "OST" everywhere)
 *       ostg = on-chain OSTG (game token) in the wallet
 *       play = server PlayLedger OSTG
 *       sol  = native devnet SOL
 *     null means UNKNOWN and must render as "—", never as 0.
 *
 *   refresh(force) — runs on `ost:wallet-tx` / wallet change; otherwise this
 *   module polls at most once per 60 s, and only while the tab is visible.
 *   No other module runs its own balance loop: read get() / snapshot() and
 *   listen for `ost:balance` (emitted by this module only).
 *
 * THE RULES IT ENFORCES
 *   · UNKNOWN IS NEVER ZERO. Before the first successful read every getter
 *     returns undefined (get() returns null).
 *   · FOUR SEPARATE PLACES, never blended: on-chain OSTC, on-chain OSTG, the
 *     play mirror, and loan-locked (a SUBSET of play, never added to it).
 *   · STALE IS LABELLED.
 *   · LOAD BUDGET (NET-3): a forced refresh is coalesced (≥ 4 s apart), an
 *     unforced one is served from cache for 60 s, and a chain read reported by
 *     the app updates the cached figure instead of triggering another fetch.
 * ========================================================================== */
(function () {
  'use strict';
  if (window.OST_BALANCE) return;

  var API = window.OST_API_BASE || 'https://ost-api.nachogtavl.workers.dev';
  var FORCED_GAP_MS = 4000;     // coalesce bursts of forced refreshes
  var CACHE_MS = 60000;         // unforced reads are served from cache this long
  var POLL_MS = 60000;          // visible-only heartbeat

  var state = { truth: null, at: 0, inflight: null, lastWallet: '', sol: null, solAt: 0, queued: null };

  function wallet() {
    try {
      var W = window.OST_WALLET;
      var s = W && W.session;
      if (s && s.publicKey && s.publicKey.toBase58) return s.publicKey.toBase58();
      if (W && typeof W.address === 'function') { var a = W.address(); if (a) return String(a); }
      if (W && typeof W.address === 'string' && W.address) return W.address;
    } catch (_) {}
    return '';
  }

  function refresh(force) {
    var w = wallet();
    if (!w) { state.truth = null; state.sol = null; state.lastWallet = ''; return Promise.resolve(null); }
    if (w !== state.lastWallet) { state.truth = null; state.sol = null; state.lastWallet = w; force = true; state.at = 0; }
    if (state.inflight) return state.inflight;
    var age = Date.now() - state.at;
    if (!force && state.truth && age < CACHE_MS) return Promise.resolve(state.truth);
    if (force && state.truth && age < FORCED_GAP_MS) {
      // Coalesce: one trailing refresh after the gap instead of a request per caller.
      if (!state.queued) {
        state.queued = new Promise(function (res) {
          setTimeout(function () { state.queued = null; state.at = 0; res(refresh(true)); }, FORCED_GAP_MS - age);
        });
      }
      return state.queued;
    }

    var reqWallet = w;
    var fresh = force && Number(state.freshUntil) > Date.now();
    state.inflight = fetch(API + '/balance/truth?wallet=' + encodeURIComponent(w) + (fresh ? '&fresh=1' : ''), { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (reqWallet !== state.lastWallet) return state.truth;
        // Only replace a good answer with another good answer.
        if (d && d.ok) { state.truth = d; }
        state.at = Date.now();
        return Promise.all([backfillOnchain(w), readSol(w)]).then(function () { emit(); checkDrift(); return state.truth; });
      })
      .catch(function () {
        state.at = Date.now();
        return Promise.all([backfillOnchain(w), readSol(w)]).then(function () { emit(); return state.truth; });
      })
      .then(function (t) { state.inflight = null; return t; }, function (e) { state.inflight = null; throw e; });
    return state.inflight;
  }

  // When /balance/truth is degraded, read the missing place client-side.
  var OSTG_MINT = 'DfgxMbdN49AX2Za9LuvsyixF1jgVh45RbgWYSGonxQos';
  function readClientMint(w, mintStr) {
    try {
      var W = window.OST_WALLET, w3 = window.solanaWeb3;
      if (!(W && W.rpcCall && W.associatedAddress && W.constants && w3)) return Promise.resolve(null);
      var ata = W.associatedAddress(new w3.PublicKey(mintStr), new w3.PublicKey(w), false, W.constants.TOKEN_2022_PROGRAM_ID, W.constants.ASSOCIATED_TOKEN_PROGRAM_ID);
      return W.rpcCall(function (c) { return c.getTokenAccountBalance(ata); })
        .then(function (r) { return r && r.value ? (Number(r.value.uiAmount) || 0) : 0; })
        .catch(function (e) { return /could not find account|invalid param/i.test(String(e && e.message || e)) ? 0 : null; });
    } catch (_) { return Promise.resolve(null); }
  }
  function backfillOnchain(w) {
    if (!w) return Promise.resolve();
    var t = state.truth || (state.truth = { ok: true, places: {}, derived: {}, wallet: w, readAt: Date.now(), degraded: true });
    if (!t.places) t.places = {};
    var ostcMint = (window.OST_CONFIG && OST_CONFIG.mint) || (window.OST_SWAP_POOL && OST_SWAP_POOL.mint) || null;
    function needs(name) { var p = t.places[name]; return !p || !p.ok || p.value == null || p.stale; }
    var jobs = [];
    if (ostcMint && needs('onchainOstc')) jobs.push(readClientMint(w, ostcMint).then(function (v) { if (v != null) t.places.onchainOstc = { value: v, ok: true, source: 'client-rpc' }; }));
    if (needs('onchainOstg')) jobs.push(readClientMint(w, OSTG_MINT).then(function (v) { if (v != null) t.places.onchainOstg = { value: v, ok: true, source: 'client-rpc' }; }));
    if (!jobs.length) return Promise.resolve();
    return Promise.all(jobs).catch(function () {});
  }
  // Native SOL: one cheap RPC read per refresh (the server does not report it).
  function readSol(w) {
    try {
      var W = window.OST_WALLET, w3 = window.solanaWeb3;
      if (!(W && W.rpcCall && w3)) return Promise.resolve();
      return W.rpcCall(function (c) { return c.getBalance(new w3.PublicKey(w)); })
        .then(function (lam) { if (w === state.lastWallet && Number.isFinite(Number(lam))) { state.sol = Number(lam) / 1e9; state.solAt = Date.now(); } })
        .catch(function () {});
    } catch (_) { return Promise.resolve(); }
  }

  function emit() {
    try { window.dispatchEvent(new CustomEvent('ost:balance', { detail: snapshot() })); } catch (_) {}
  }

  function place(name) {
    var t = state.truth;
    if (!t || !t.places || !t.places[name]) return undefined;   // unknown
    var p = t.places[name];
    if (!p.ok || p.value == null) return undefined;             // unknown, NOT 0
    return Number(p.value);
  }
  function orNull(v) { return (v === undefined || v === null || !Number.isFinite(Number(v))) ? null : Number(v); }

  function get() {
    return {
      ost: orNull(place('onchainOstc')),
      ostg: orNull(place('onchainOstg')),
      play: orNull(place('play')),
      sol: orNull(state.sol),
      wallet: state.lastWallet || null,
      readAt: state.at || null
    };
  }

  function snapshot() {
    var t = state.truth;
    return {
      onchainOstc: place('onchainOstc'),
      onchainOstg: place('onchainOstg'),
      play:        place('play'),
      loanLocked:  place('loanLocked'),
      sol:         state.sol == null ? undefined : state.sol,
      spendablePlay: (t && t.derived && t.derived.spendablePlay != null) ? Number(t.derived.spendablePlay) : undefined,
      owedUsd:       (t && t.derived) ? t.derived.owedUsd : undefined,
      degraded:      t ? !!t.degraded : undefined,
      stale: !!(t && t.places && ((t.places.onchainOstc && t.places.onchainOstc.stale) ||
                                  (t.places.onchainOstg && t.places.onchainOstg.stale))),
      readAt: t ? t.readAt : null
    };
  }

  // Formatting helper so callers stop inventing their own "0.00" fallbacks.
  function fmt(v, unit) {
    if (v === undefined || v === null || !Number.isFinite(Number(v))) return '—';
    return Number(v).toFixed(2) + (unit ? ' ' + unit : '');
  }

  /* ---- drift detection (fast play mirror vs. authority) ------------------- */
  var DRIFT_TOLERANCE = 0.01;
  function drift() {
    var authoritative = place('play');
    if (authoritative === undefined) return undefined;
    var fast;
    try { fast = window.OST_PLAY && window.OST_PLAY.balance(); } catch (_) { fast = undefined; }
    if (!Number.isFinite(Number(fast))) return undefined;
    var delta = Number(fast) - authoritative;
    return { authoritative: authoritative, fast: Number(fast), delta: Math.round(delta * 1e6) / 1e6, agrees: Math.abs(delta) <= DRIFT_TOLERANCE };
  }
  function checkDrift() {
    var d = drift();
    if (!d || d.agrees) return d;
    try {
      console.warn('[OST_BALANCE] play-balance drift: authoritative=' + d.authoritative + ' fast=' + d.fast + ' delta=' + d.delta);
      window.dispatchEvent(new CustomEvent('ost:balance-drift', { detail: d }));
    } catch (_) {}
    return d;
  }

  window.OST_BALANCE = {
    get: get,
    drift: drift,
    checkDrift: checkDrift,
    refresh: refresh,
    snapshot: snapshot,
    // Individual getters. EVERY one returns undefined when unknown.
    onchainOstc: function () { return place('onchainOstc'); },
    onchainOstg: function () { return place('onchainOstg'); },
    play:        function () { return place('play'); },
    sol:         function () { return state.sol == null ? undefined : state.sol; },
    loanLocked:  function () { return place('loanLocked'); },
    spendablePlay: function () { return snapshot().spendablePlay; },
    isDegraded:  function () { return snapshot().degraded; },
    fmt: fmt
  };

  function boot() {
    refresh(true);
    window.addEventListener('ost:wallet-changed', function () { refresh(true); });
    // C5: every settled money move. Read now, and once more after the RPC
    // catches up (a just-confirmed transfer can lag a read by a second or two).
    var lagTimer = null;
    window.addEventListener('ost:wallet-tx', function () {
      // Right after a transaction the worker's short reuse window could hand
      // back the pre-transaction numbers: ask for a fresh read (?fresh=1; an
      // older worker ignores the flag).
      state.freshUntil = Date.now() + 8000;
      refresh(true);
      clearTimeout(lagTimer);
      lagTimer = setTimeout(function () { refresh(true); }, 5000);
    });
    // app.js reports every on-chain OST read here: take the number instead of
    // fetching /balance/truth again (that was one extra request per read).
    window.addEventListener('ost:tree-changed', function (e) {
      try {
        var ch = e && e.detail && e.detail.chain;
        if (!ch || ch.stale || ch.source !== 'live' || !state.truth || !state.truth.places) return;
        var cur = state.truth.places.onchainOstc;
        var v = Number(ch.amount);
        if (!Number.isFinite(v)) return;
        if (cur && cur.ok && Math.abs(Number(cur.value) - v) < 1e-9) return;
        state.truth.places.onchainOstc = { value: v, ok: true, source: 'app-read', at: Date.now() };
        emit();
      } catch (_) {}
    });
    // PUSH-FIRST: a play-balance event carries the server-returned balance.
    window.addEventListener('ost:play:balance', function (e) {
      var v = e && e.detail && Number(e.detail.balance);
      if (Number.isFinite(v) && state.truth && state.truth.places) {
        state.truth.places.play = { value: v, ok: true, source: 'event', at: Date.now() };
        try { var ll = state.truth.places.loanLocked; var d = state.truth.derived || (state.truth.derived = {}); if (ll && ll.ok && ll.value != null) d.spendablePlay = Math.max(0, v - Number(ll.value || 0)); } catch (_) {}
        emit();
      } else refresh(false);
    });
    document.addEventListener('visibilitychange', function () { if (!document.hidden) refresh(false); });
    setInterval(function () {
      if (document.hidden || !wallet()) return;
      if (Date.now() - state.at >= POLL_MS - 1000) refresh(true);
    }, POLL_MS);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();

/* ==========================================================================
 * OST · Balance — the ONE client-side answer, backed by /balance/truth
 * --------------------------------------------------------------------------
 * WHAT THIS REPLACES
 * Eight modules each decided for themselves what "the balance" was, reading
 * from five different sources. Three of them did this:
 *
 *     parseFloat(document.getElementById('wdOstBal').textContent)
 *
 * i.e. they read the number off the SCREEN. If that element had not rendered,
 * or showed a spinner, or was mid-update, the "balance" was 0 - and a funded
 * user was told they had nothing. Rendered text is a picture of a balance, not
 * a balance.
 *
 * Every reader now asks this module, which asks the server's single authority
 * (/balance/truth) and caches the answer. One question, one answer, everywhere.
 *
 * THE RULES IT INHERITS AND ENFORCES
 *   · UNKNOWN IS NEVER ZERO. Before the first successful read, every getter
 *     returns undefined. Callers must render "—" or "loading", never "0".
 *     This is the single most important rule in the file: a fabricated zero is
 *     what makes money look like it disappeared.
 *   · FOUR SEPARATE PLACES, never blended: on-chain OSTC, on-chain OSTG, the
 *     play mirror, and loan-locked (a SUBSET of play, never added to it).
 *   · STALE IS LABELLED. If the server served a cached on-chain figure, that
 *     is reported, not hidden.
 * ========================================================================== */
(function () {
  'use strict';
  if (window.OST_BALANCE) return;

  var API = window.OST_API_BASE || 'https://ost-api.nachogtavl.workers.dev';
  var MIN_GAP_MS = 6000;        // never hammer: the server does real RPC work

  var state = { truth: null, at: 0, inflight: null, lastWallet: '' };

  function wallet() {
    // Identical resolution to ost-play.js. A module that resolves the address
    // differently queries a different wallet - that was a real bug.
    try {
      var s = window.OST_WALLET && window.OST_WALLET.session;
      if (s && s.publicKey && s.publicKey.toBase58) return s.publicKey.toBase58();
      if (window.OST_WALLET && window.OST_WALLET.address) return window.OST_WALLET.address;
      if (window.solana && window.solana.publicKey) return window.solana.publicKey.toString();
    } catch (_) {}
    return '';
  }

  function refresh(force) {
    var w = wallet();
    if (!w) { state.truth = null; state.lastWallet = ''; return Promise.resolve(null); }
    if (w !== state.lastWallet) { state.truth = null; state.lastWallet = w; force = true; }
    if (!force && state.truth && (Date.now() - state.at) < MIN_GAP_MS) return Promise.resolve(state.truth);
    if (state.inflight) return state.inflight;

    state.inflight = fetch(API + '/balance/truth?wallet=' + encodeURIComponent(w), { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        // Only replace a good answer with another good answer. A failed read
        // must not wipe what we already knew.
        if (d && d.ok) { state.truth = d; state.at = Date.now(); emit(); checkDrift(); }
        state.inflight = null;
        return state.truth;
      })
      .catch(function () { state.inflight = null; return state.truth; });
    return state.inflight;
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

  function snapshot() {
    var t = state.truth;
    return {
      onchainOstc: place('onchainOstc'),
      onchainOstg: place('onchainOstg'),
      play:        place('play'),
      loanLocked:  place('loanLocked'),
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

  /* ---- drift detection ----------------------------------------------------
   * OST_PLAY keeps a FAST local mirror of the play balance so a bet settles
   * instantly; this module holds the server's authoritative figure. Both read
   * the same Durable Object, so they should agree.
   *
   * They are deliberately NOT merged: forcing games onto the cached authority
   * would add latency to every spin for no correctness gain. Instead we watch
   * for disagreement and SAY SO. Silent drift between two views of the same
   * money is precisely how "my balance changed by itself" starts.
   */
  var DRIFT_TOLERANCE = 0.01;
  function drift() {
    var authoritative = place('play');
    if (authoritative === undefined) return undefined;      // nothing to compare
    var fast;
    try { fast = window.OST_PLAY && window.OST_PLAY.balance(); } catch (_) { fast = undefined; }
    if (!Number.isFinite(Number(fast))) return undefined;
    var delta = Number(fast) - authoritative;
    return {
      authoritative: authoritative,
      fast: Number(fast),
      delta: Math.round(delta * 1e6) / 1e6,
      agrees: Math.abs(delta) <= DRIFT_TOLERANCE
    };
  }

  function checkDrift() {
    var d = drift();
    if (!d || d.agrees) return d;
    // Loud, not swallowed. A mismatch here means one of the two views is stale
    // or wrong, and the user is looking at one of them.
    try {
      console.warn('[OST_BALANCE] play-balance drift: authoritative=' + d.authoritative +
                   ' fast=' + d.fast + ' delta=' + d.delta);
      window.dispatchEvent(new CustomEvent('ost:balance-drift', { detail: d }));
    } catch (_) {}
    return d;
  }

  window.OST_BALANCE = {
    drift: drift,
    checkDrift: checkDrift,
    refresh: refresh,
    snapshot: snapshot,
    // Individual getters. EVERY one returns undefined when unknown.
    onchainOstc: function () { return place('onchainOstc'); },
    onchainOstg: function () { return place('onchainOstg'); },
    play:        function () { return place('play'); },
    loanLocked:  function () { return place('loanLocked'); },
    spendablePlay: function () { return snapshot().spendablePlay; },
    isDegraded:  function () { return snapshot().degraded; },
    fmt: fmt
  };

  function boot() {
    refresh(true);
    ['ost:wallet-changed', 'ost:play:balance', 'ost:tree-changed'].forEach(function (ev) {
      window.addEventListener(ev, function () { refresh(true); });
    });
    document.addEventListener('visibilitychange', function () { if (!document.hidden) refresh(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();

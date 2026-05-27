// =============================================================================
// OST Optimistic UX layer (Phase 1)
// -----------------------------------------------------------------------------
// Adds three primitives used by faucet/bet/swap call sites:
//   1. toast(msg, kind)                — pick the best in-page toast
//   2. balanceHint({ deltaOst, kind }) — fire ost:wallet-changed + ost:balance-hint
//   3. simulate(connection, tx, payer) — local tx simulation w/ friendly error
//   4. wrap({ label, optimistic, run, onConfirm, onError, rollback })
//
// IMPORTANT: callers must remain functional if this module fails to load.
// Every integration in faucet-hub.js / ost-onchain-bet.js / wallet-extras.js is
// guarded with `if (window.OST_OPTIMISTIC) { ... }`. This file never throws on
// load.
// =============================================================================
(function () {
  'use strict';
  if (window.OST_OPTIMISTIC) return; // idempotent

  // ----- toast --------------------------------------------------------------
  function pickToastImpl() {
    // 1) user-provided global
    if (typeof window.toast === 'function') {
      return function (msg, kind) { try { window.toast(msg, kind || 'info'); } catch (e) {} };
    }
    // 2) faucet-hub pop() exposed indirectly via OST_FAUCET_HUB? (not exposed)
    //    Fall back to our own minimal toast.
    return null;
  }
  var _fallbackHost = null;
  function ensureHost() {
    if (_fallbackHost && document.body && _fallbackHost.parentNode === document.body) return _fallbackHost;
    if (!document.body) return null;
    _fallbackHost = document.createElement('div');
    _fallbackHost.id = 'ost-optimistic-host';
    _fallbackHost.style.cssText = [
      'position:fixed', 'left:50%', 'top:24px', 'transform:translateX(-50%)',
      'z-index:2147483600', 'display:flex', 'flex-direction:column', 'gap:8px',
      'pointer-events:none', 'max-width:92vw'
    ].join(';');
    document.body.appendChild(_fallbackHost);
    return _fallbackHost;
  }
  function fallbackToast(msg, kind) {
    var host = ensureHost();
    if (!host) return;
    var el = document.createElement('div');
    var bg = kind === 'error' ? '#3a1a1a'
           : kind === 'success' ? '#103a22'
           : kind === 'pending' ? '#1a2a3a'
           : '#222a33';
    var fg = kind === 'error' ? '#ffb3b3'
           : kind === 'success' ? '#9ff5c1'
           : kind === 'pending' ? '#bce4ff'
           : '#e7eef6';
    el.style.cssText = [
      'background:' + bg, 'color:' + fg,
      'padding:10px 16px', 'border-radius:12px',
      'font:500 13.5px/1.35 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif',
      'box-shadow:0 8px 24px rgba(0,0,0,.45)', 'border:1px solid rgba(255,255,255,.08)',
      'pointer-events:auto', 'opacity:0', 'transform:translateY(-6px)',
      'transition:opacity .18s ease, transform .18s ease', 'max-width:560px',
      'text-align:center'
    ].join(';');
    el.textContent = String(msg);
    host.appendChild(el);
    requestAnimationFrame(function () { el.style.opacity = '1'; el.style.transform = 'translateY(0)'; });
    var dwell = kind === 'error' ? 3600 : kind === 'pending' ? 2200 : 2400;
    setTimeout(function () {
      el.style.opacity = '0'; el.style.transform = 'translateY(-6px)';
      setTimeout(function () { try { el.remove(); } catch (e) {} }, 220);
    }, dwell);
  }
  function toast(msg, kind) {
    var impl = pickToastImpl();
    if (impl) return impl(msg, kind);
    return fallbackToast(msg, kind);
  }

  // ----- balance hint -------------------------------------------------------
  // Fires events that existing listeners already react to, plus an optimistic
  // detail payload so future listeners can show the delta before confirm.
  function balanceHint(detail) {
    detail = detail || {};
    try {
      window.dispatchEvent(new CustomEvent('ost:balance-hint', { detail: detail }));
    } catch (e) {}
    try {
      window.dispatchEvent(new CustomEvent('ost:wallet-changed', { detail: detail }));
    } catch (e) {}
  }

  // ----- simulate -----------------------------------------------------------
  // Runs connection.simulateTransaction with a 2.5s safety timeout.
  // Returns { ok, err, logs, unitsConsumed, friendly }.
  function withTimeout(promise, ms, label) {
    return new Promise(function (resolve) {
      var done = false;
      var t = setTimeout(function () {
        if (done) return; done = true;
        resolve({ __timeout: true, label: label });
      }, ms);
      Promise.resolve(promise).then(function (v) {
        if (done) return; done = true; clearTimeout(t); resolve(v);
      }, function (e) {
        if (done) return; done = true; clearTimeout(t); resolve({ __error: e });
      });
    });
  }
  function friendlyFromLogs(logs) {
    if (!logs || !logs.length) return null;
    // Common Anchor error format: "AnchorError caused by account: x. Error Code: Y. Error Number: N. Error Message: Z."
    for (var i = logs.length - 1; i >= 0; i--) {
      var l = String(logs[i] || '');
      var m = l.match(/Error Message:\s*(.+?)\s*$/);
      if (m) return m[1].replace(/\.$/, '');
      if (/insufficient funds/i.test(l)) return 'Insufficient funds';
      if (/already in use/i.test(l)) return 'Account already exists';
    }
    return null;
  }
  async function simulate(connection, tx, feePayer) {
    if (!connection || !tx) return { ok: true, skipped: true };
    try {
      if (!tx.feePayer && feePayer) tx.feePayer = feePayer;
      if (!tx.recentBlockhash) {
        // Don't fetch a blockhash here — that doubles RPC load. Caller may set it.
        // simulateTransaction tolerates a missing blockhash on newer web3.js by
        // using the cluster's default; if it errors, we skip gracefully.
      }
      var res = await withTimeout(
        connection.simulateTransaction(tx, undefined, false),
        2500,
        'simulate'
      );
      if (res && res.__timeout) return { ok: true, skipped: true, reason: 'timeout' };
      if (res && res.__error) return { ok: true, skipped: true, reason: 'rpc-error' };
      var value = res && res.value ? res.value : res;
      if (!value) return { ok: true, skipped: true, reason: 'empty' };
      var err = value.err;
      var logs = value.logs || [];
      if (err) {
        return {
          ok: false,
          err: err,
          logs: logs,
          unitsConsumed: value.unitsConsumed || 0,
          friendly: friendlyFromLogs(logs) || 'Transaction would fail'
        };
      }
      return { ok: true, logs: logs, unitsConsumed: value.unitsConsumed || 0 };
    } catch (e) {
      // Never let simulation block the user — return ok=true with skipped.
      return { ok: true, skipped: true, reason: 'exception' };
    }
  }

  // ----- wrap (generic helper, optional) ------------------------------------
  // Usage:
  //   OST_OPTIMISTIC.wrap({
  //     label: 'Bet placed',
  //     optimistic: () => { /* show pending toast + balance hint */ },
  //     run: async () => { return await sendTx(...); }, // returns signature
  //     onConfirm: (sig) => { /* finalize UI */ },
  //     onError: (err) => { /* rollback */ }
  //   })
  async function wrap(opts) {
    opts = opts || {};
    var labelPending = opts.label || 'Submitted';
    try {
      if (typeof opts.optimistic === 'function') opts.optimistic();
      else toast(labelPending + '…', 'pending');
    } catch (e) {}
    try {
      var result = await opts.run();
      try {
        if (typeof opts.onConfirm === 'function') opts.onConfirm(result);
        else toast('✓ ' + labelPending, 'success');
      } catch (e) {}
      return result;
    } catch (err) {
      try {
        if (typeof opts.onError === 'function') opts.onError(err);
        else {
          var m = (err && err.message) ? err.message : 'Failed';
          toast(m.length > 80 ? m.slice(0, 80) + '…' : m, 'error');
        }
      } catch (e) {}
      throw err;
    }
  }

  window.OST_OPTIMISTIC = {
    toast: toast,
    balanceHint: balanceHint,
    simulate: simulate,
    wrap: wrap,
    version: 1
  };

  // Convenience: if no global toast exists, expose ours as window.toast so
  // other modules pick it up automatically. Don't clobber an existing one.
  if (typeof window.toast !== 'function') {
    window.toast = toast;
  }
})();

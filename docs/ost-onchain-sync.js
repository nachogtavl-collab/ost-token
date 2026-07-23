/* ==========================================================================
 * OST · On-chain sync — anchor the fast mirror to the slow truth
 * --------------------------------------------------------------------------
 * The play balance (games, predictions, stocks) is a FAST MIRROR held in the
 * PlayLedger Durable Object. It is not where money lives - it is a cache of
 * OSTG that actually sits in the pool on Solana. That design is deliberate:
 * games settle many times per second, and putting every micro-bet on-chain
 * would cost a SOL fee and ~400ms per action. The mirror is what makes OST
 * fast.
 *
 * But a cache is only honest if it can be PROVEN against the truth. This module
 * does two jobs that make the mirror trustworthy instead of opaque:
 *
 *   1. RECONCILE. Continuously checks the mirror (Σ play balances) against the
 *      real on-chain pool OSTG and shows the result. A positive buffer is
 *      healthy; a negative one is under-collateralization and is shown in red,
 *      never hidden. "Verified against Solana Ns ago" is the honest version of
 *      a balance you can otherwise only trust blindly.
 *
 *   2. SURFACE THE TWO PLACES. A user's OSTG lives in TWO distinct spots:
 *        · on-chain, in their own wallet  (they hold it; not yet playable)
 *        · the play balance / mirror      (deposited; spendable in-app)
 *      Blending them is what produces "positive in my wallet but the app says
 *      not enough". This shows both, labelled, with ONE-TAP DEPOSIT to move
 *      wallet OSTG into the play balance.
 *
 * Reconciliation runs only while the tab is VISIBLE and on a backoff, so it
 * never becomes the kind of idle-polling that exhausted the DO quota before.
 * ========================================================================== */
(function () {
  'use strict';
  if (window.OST_ONCHAIN_SYNC) return;

  var API = window.OST_API_BASE || 'https://ost-api.nachogtavl.workers.dev';

  function wallet() {
    // Same resolution as ost-play.js - session first, or we query a different
    // (or empty) wallet than the one holding the OSTG.
    try {
      var s = window.OST_WALLET && window.OST_WALLET.session;
      if (s && s.publicKey && s.publicKey.toBase58) return s.publicKey.toBase58();
      if (window.OST_WALLET && window.OST_WALLET.address) return window.OST_WALLET.address;
      if (window.solana && window.solana.publicKey) return window.solana.publicKey.toString();
    } catch (_) {}
    return '';
  }
  function fmt(n) { return (Number(n) || 0).toFixed(2); }
  function esc(t) {
    return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  var state = { recon: null, onchain: null, reconAt: 0, delay: 30000, busy: false };

  function injectStyle() {
    if (document.getElementById('ost-onchain-sync-style')) return;
    var css =
      '.oxs-card{border-radius:16px;background:#06111d;border:1px solid rgba(127,216,255,.2);padding:15px;color:#dff8ff;}' +
      '.oxs-head{display:flex;align-items:center;justify-content:space-between;gap:9px;margin-bottom:11px;}' +
      '.oxs-head h4{margin:0;font-size:14px;}' +
      '.oxs-badge{font-size:11px;padding:4px 9px;border-radius:999px;display:inline-flex;align-items:center;gap:6px;}' +
      '.oxs-badge.ok{background:rgba(20,90,50,.35);border:1px solid rgba(94,234,212,.4);color:#7fe3b0;}' +
      '.oxs-badge.bad{background:rgba(120,20,20,.3);border:1px solid rgba(255,138,138,.5);color:#ff9a9a;}' +
      '.oxs-badge.wait{background:rgba(40,60,80,.4);border:1px solid rgba(127,216,255,.3);color:#9fbfd8;}' +
      '.oxs-dot{width:7px;height:7px;border-radius:50%;background:currentColor;}' +
      '.oxs-two{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:11px;}' +
      '.oxs-slot{border-radius:12px;padding:11px;background:#08161f;border:1px solid rgba(255,255,255,.07);}' +
      '.oxs-slot .k{font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;color:#8fb0c4;}' +
      '.oxs-slot .v{font-size:19px;font-weight:680;margin-top:3px;}' +
      '.oxs-slot .s{font-size:10.5px;color:#7f9fb2;margin-top:2px;line-height:1.35;}' +
      '.oxs-slot.chain .v{color:#c6a1ff;}' +
      '.oxs-slot.play .v{color:#7fd8ff;}' +
      '.oxs-deposit{display:flex;gap:8px;align-items:center;}' +
      '.oxs-deposit input{flex:1 1 auto;min-width:0;height:36px;border-radius:10px;border:1px solid rgba(255,255,255,.14);background:#020a12;color:#dff8ff;padding:0 10px;font-size:14px;}' +
      '.oxs-btn{height:36px;padding:0 14px;border-radius:10px;border:1px solid rgba(127,216,255,.4);background:#12405c;color:#dff8ff;cursor:pointer;font-size:13px;flex:0 0 auto;}' +
      '.oxs-btn:disabled{opacity:.45;cursor:not-allowed;}' +
      '.oxs-recon{font-size:11px;color:#8fb0c4;margin-top:10px;line-height:1.5;}' +
      '.oxs-recon b{color:#dff8ff;}' +
      '.oxs-msg{font-size:12px;margin-top:8px;min-height:15px;}' +
      '.oxs-msg.ok{color:#7fe3b0;}.oxs-msg.err{color:#ff9a9a;}';
    var tag = document.createElement('style');
    tag.id = 'ost-onchain-sync-style';
    tag.textContent = css;
    document.head.appendChild(tag);
  }

  function fetchJson(path) {
    return fetch(API + path, { cache: 'no-store' }).then(function (r) { return r.json(); }).catch(function () { return null; });
  }

  function loadOnchain() {
    var w = wallet();
    if (!w) { state.onchain = null; return Promise.resolve(null); }
    return fetchJson('/play/onchain?wallet=' + encodeURIComponent(w)).then(function (d) {
      state.onchain = (d && d.ok) ? d : null;
      return state.onchain;
    });
  }
  function loadRecon() {
    return fetchJson('/play/reconcile').then(function (d) {
      if (d && typeof d.reconciled === 'boolean') { state.recon = d; state.reconAt = Date.now(); }
      return state.recon;
    });
  }

  function reconBadge() {
    if (!state.recon) return '<span class="oxs-badge wait"><span class="oxs-dot"></span>checking Solana…</span>';
    if (state.recon.reconciled) {
      var ago = Math.max(0, Math.round((Date.now() - state.reconAt) / 1000));
      return '<span class="oxs-badge ok"><span class="oxs-dot"></span>backed by Solana · ' + ago + 's ago</span>';
    }
    return '<span class="oxs-badge bad"><span class="oxs-dot"></span>UNDER-COLLATERALIZED</span>';
  }

  function render(host) {
    if (!host) return;
    injectStyle();
    var oc = state.onchain;
    var chain = oc ? oc.onchainOstg : null;
    var play = oc ? oc.playBalance : null;

    host.innerHTML =
      '<div class="oxs-card">' +
        '<div class="oxs-head"><h4>OSTG · wallet & play</h4>' + reconBadge() + '</div>' +
        '<div class="oxs-two">' +
          '<div class="oxs-slot chain">' +
            '<div class="k">In your wallet</div>' +
            '<div class="v">' + (chain == null ? '—' : fmt(chain)) + '</div>' +
            '<div class="s">On-chain OSTG you hold. Deposit it to play.</div>' +
          '</div>' +
          '<div class="oxs-slot play">' +
            '<div class="k">Play balance</div>' +
            '<div class="v">' + (play == null ? '—' : fmt(play)) + '</div>' +
            '<div class="s">Deposited &amp; spendable in games/markets.</div>' +
          '</div>' +
        '</div>' +
        (chain != null && chain > 0
          ? '<div class="oxs-deposit">' +
              '<input type="number" id="oxsAmt" min="0" step="0.01" placeholder="Amount" value="' + fmt(chain) + '">' +
              '<button type="button" class="oxs-btn" id="oxsDeposit">Deposit to play</button>' +
            '</div>'
          : '<p class="oxs-recon">No OSTG in your wallet to deposit. Convert OSTC → OSTG, or draw a credit line.</p>') +
        '<div class="oxs-msg" id="oxsMsg"></div>' +
        '<p class="oxs-recon" id="oxsRecon"></p>' +
      '</div>';

    var rc = host.querySelector('#oxsRecon');
    if (rc && state.recon) {
      rc.innerHTML = 'Mirror <b>' + fmt(state.recon.mirrorTotal) + '</b> OSTG is backed by <b>' +
        fmt(state.recon.onchainPoolOstg) + '</b> OSTG on Solana ' +
        '(surplus <b>' + fmt(state.recon.drift) + '</b>). The play balance is a fast mirror of real on-chain OSTG, ' +
        'not a separate store — verified against the chain, not asserted.';
    }

    var dep = host.querySelector('#oxsDeposit');
    if (dep) dep.addEventListener('click', function () { doDeposit(host); });
  }

  function doDeposit(host) {
    if (state.busy) return;
    var amt = parseFloat((host.querySelector('#oxsAmt') || {}).value);
    var msg = host.querySelector('#oxsMsg');
    if (!(amt > 0)) { if (msg) { msg.textContent = 'Enter an amount.'; msg.className = 'oxs-msg err'; } return; }
    if (!window.OST_PLAY || typeof window.OST_PLAY.deposit !== 'function') {
      if (msg) { msg.textContent = 'Deposit rail unavailable — reload and try again.'; msg.className = 'oxs-msg err'; }
      return;
    }
    state.busy = true;
    if (msg) { msg.textContent = 'Moving OSTG into your play balance…'; msg.className = 'oxs-msg'; }
    Promise.resolve(window.OST_PLAY.deposit(amt)).then(function (r) {
      state.busy = false;
      if (r && r.ok === false) { if (msg) { msg.textContent = r.error || 'Deposit failed.'; msg.className = 'oxs-msg err'; } return; }
      if (msg) { msg.textContent = 'Deposited ' + fmt(amt) + ' OSTG. Now spendable.'; msg.className = 'oxs-msg ok'; }
      try { window.dispatchEvent(new CustomEvent('ost:wallet-changed')); } catch (_) {}
      refresh();
    }).catch(function (e) {
      state.busy = false;
      if (msg) { msg.textContent = (e && e.message) || 'Deposit failed.'; msg.className = 'oxs-msg err'; }
    });
  }

  function host() { return document.getElementById('ostOnchainSync'); }

  function refresh() {
    return Promise.all([loadOnchain(), loadRecon()]).then(function () {
      var h = host();
      if (h) render(h);
    });
  }

  /* ---- visible-only backoff loop ------------------------------------------
   * Continuous reconciliation with NO human intervention, but only while the
   * tab is visible - a hidden tab reconciles nothing, so this never becomes the
   * idle DO-polling that took the backend down before.
   */
  function tick() {
    if (document.hidden) { schedule(); return; }
    refresh().then(function () {
      // Drift is rare and slow-moving, so ease off when all is well; stay
      // tighter if we are under-collateralized so a problem is caught fast.
      state.delay = (state.recon && !state.recon.reconciled) ? 15000 : Math.min(120000, state.delay * 1.5);
      schedule();
    });
  }
  var timer = null;
  function schedule() { clearTimeout(timer); timer = setTimeout(tick, state.delay); }

  window.OST_ONCHAIN_SYNC = {
    refresh: refresh,
    reconciliation: function () { return state.recon; },
    onchain: function () { return state.onchain; },
    mount: function (el) { if (el) { el.id = 'ostOnchainSync'; refresh(); } }
  };

  function boot() {
    state.delay = 30000;
    if (host()) refresh();
    tick();
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) { state.delay = 5000; clearTimeout(timer); timer = setTimeout(tick, 300); }
    });
    window.addEventListener('ost:wallet-changed', refresh);
    window.addEventListener('ost:play:balance', function () { var h = host(); if (h) render(h); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();

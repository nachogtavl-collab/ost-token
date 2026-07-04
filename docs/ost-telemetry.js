/* ==========================================================================
 * OST · Telemetry — make the network's live data REAL
 * --------------------------------------------------------------------------
 * The worker runs a full live-stats + price engine at POST /ost/event:
 *   every event bumps a 24h wallet set, a tx list, and a volume sum, which
 *   feed /ost/stats AND the OST price itself (activity = volatility).
 * The site was doing tons of activity but NEVER reporting it, so every
 * "live" number read zero and the price sat flat. This module is the wire.
 *
 * It listens to events the app ALREADY dispatches and forwards them, once,
 * debounced, with graceful failure and an offline queue:
 *   faucet claims, game wins/losses, prediction/parlay stakes, cash-outs,
 *   swaps, top-ups, sends.
 *
 * Identity: the connected wallet when present, else a persistent anonymous
 * device id (so a returning tester keeps counting as the same wallet).
 * No secrets ever leave the device — only { wallet, type, volume }.
 * ========================================================================== */
(function () {
  'use strict';

  var QUEUE_KEY = 'ost.telemetry.queue.v1';
  var DEVICE_KEY = 'ost.telemetry.device.v1';
  var VALID = { faucet: 1, send: 1, cashout: 1, game_win: 1, game_loss: 1, swap: 1, topup: 1, other: 1 };
  var MIN_GAP_MS = 60000;  // one KV-write-bearing flush per minute (free-tier safe)
  var lastSentAt = 0;
  var pending = [];

  function apiBase() {
    return (typeof window !== 'undefined' && window.OST_API_BASE)
      ? String(window.OST_API_BASE).replace(/\/$/, '') : '';
  }

  function deviceId() {
    try {
      var v = localStorage.getItem(DEVICE_KEY);
      if (!v) {
        v = 'anon-' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
        localStorage.setItem(DEVICE_KEY, v);
      }
      return v;
    } catch (_) { return 'anon-fallback'; }
  }

  function walletId() {
    try {
      if (window.OST_WALLET && window.OST_WALLET.session && window.OST_WALLET.session.publicKey) {
        return window.OST_WALLET.session.publicKey.toBase58();
      }
      if (window.OST_CONNECTED_WALLET) return String(window.OST_CONNECTED_WALLET);
    } catch (_) {}
    return deviceId();
  }

  function loadQueue() {
    try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]') || []; } catch (_) { return []; }
  }
  function saveQueue(q) {
    try { localStorage.setItem(QUEUE_KEY, JSON.stringify(q.slice(-200))); } catch (_) {}
  }

  function enqueue(type, volume) {
    if (!VALID[type]) type = 'other';
    pending.push({ wallet: walletId(), type: type, volume: Math.max(0, Number(volume) || 0), ts: Date.now() });
    flushSoon();
  }

  var flushTimer = null;
  function flushSoon() {
    if (flushTimer) return;
    var wait = Math.max(0, MIN_GAP_MS - (Date.now() - lastSentAt));
    flushTimer = setTimeout(function () { flushTimer = null; flush(); }, wait);
  }

  function flush() {
    var base = apiBase();
    if (!base) return;
    var batch = loadQueue().concat(pending);
    pending = [];
    if (!batch.length) { saveQueue([]); return; }
    saveQueue(batch);
    // Coalesce the whole queued batch into ONE event: sum volume, keep the
    // most meaningful type. This turns N activity events into a single POST
    // (one server-side write window) instead of N — the fix for exhausting
    // the free KV write budget.
    var totalVol = batch.reduce(function (s2, e) { return s2 + (Number(e.volume) || 0); }, 0);
    var pref = ['game_win', 'cashout', 'faucet', 'swap', 'topup', 'send', 'game_loss', 'other'];
    var type = 'other';
    for (var pi = 0; pi < pref.length; pi++) { if (batch.some(function (e) { return e.type === pref[pi]; })) { type = pref[pi]; break; } }
    var ev = { wallet: batch[batch.length - 1].wallet, type: type, volume: totalVol };
    lastSentAt = Date.now();
    fetch(base + '/ost/event', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(ev),
      keepalive: true
    }).then(function (r) {
      if (!r.ok) throw new Error('http ' + r.status);
      return r.json();
    }).then(function (res) {
      saveQueue([]); // whole batch represented by the one accepted event
      try { window.dispatchEvent(new CustomEvent('ost:telemetry-accepted', { detail: res })); } catch (_) {}
    }).catch(function () {
      // leave batch queued; retry next interval
    });
  }

  // ---- map existing app events to telemetry -----------------------------
  function wire() {
    // faucet + any credits award (games, academy, faucet hub)
    window.addEventListener('ost-faucet-hub-award', function (e) {
      var d = (e && e.detail) || {};
      var src = String(d.source || '');
      var amt = Number(d.credits || 0);
      if (/game|plinko|mines|crash|dice|limbo|wheel|coin|tower|slots|keno|hilo/.test(src)) enqueue('game_win', amt);
      else if (/faucet|academy|daily|streak|rakeback/.test(src)) enqueue('faucet', amt);
      else enqueue('other', amt);
    }, false);

    // money changes on OS pages (spend = activity)
    window.addEventListener('ost-money-changed', function (e) {
      var d = (e && e.detail) || {};
      if (Number(d.delta) < 0) enqueue('other', Math.abs(Number(d.delta) || 0));
    }, false);

    // game wager (loss risk / play volume)
    window.addEventListener('ost:game-wager', function (e) {
      enqueue('game_loss', Number((e && e.detail && e.detail.amount) || 0));
    }, false);

    // prediction + parlay stakes
    window.addEventListener('ost:prediction-order-recorded', function (e) {
      enqueue('other', Number((e && e.detail && e.detail.stake) || 0));
    }, false);
    window.addEventListener('ost:parlay-won', function (e) {
      enqueue('cashout', Number((e && e.detail && e.detail.payout) || 0));
    }, false);

    // real on-chain wallet activity
    window.addEventListener('ost:wallet-changed', function () { enqueue('other', 0); }, false);
    window.addEventListener('ost:survival-token-minted', function (e) {
      enqueue('other', Number((e && e.detail && e.detail.amount) || 0));
    }, false);

    // best-effort flush of any queued events on load + periodically
    flush();
    setInterval(flush, 60000);
    window.addEventListener('online', flush, false);
    // count this session as an active wallet immediately
    enqueue('other', 0);
  }

  window.OST_TELEMETRY = {
    report: enqueue,
    walletId: walletId,
    queued: function () { return loadQueue().length + pending.length; }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(wire, 1500); });
  else setTimeout(wire, 1500);
})();

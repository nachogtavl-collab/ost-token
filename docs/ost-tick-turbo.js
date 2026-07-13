/* ==========================================================================
 * OST · Tick Turbo — sub-second prices ONLY where the user is looking
 * --------------------------------------------------------------------------
 * The 5-min markets used to tick at a flat 5s REST poll no matter what. Now:
 *
 *  - When the user is INSIDE a 5-min market (it's the selected market on the
 *    desk) and the tab is visible, we open ONE Binance WebSocket miniTicker
 *    stream for just that coin and stream real-time prices into the existing
 *    engines (OST_FAST_MARKETS.pushTick + OST_PRICES.markTurbo), and emit a
 *    coalesced `ost:turbo-tick` so the ticket re-renders at tick speed.
 *  - The moment they leave the market / hide the tab, the socket CLOSES.
 *    Everything else keeps the calm 5s baseline — no global bottleneck, no
 *    background battery drain, other markets are untouched.
 *  - Device-adaptive: UI events are coalesced to ≥250ms (≥600ms on Save-Data
 *    or ≤2GB-RAM devices). The stream itself is Binance's own push cadence.
 *  - BTC's 5-min round odds stay SERVER-authoritative (worker NativeMarketHub)
 *    — turbo only accelerates the spot price/momentum display for BTC.
 * ========================================================================== */
(function () {
  'use strict';

  var STREAMS = {
    btc5m: 'btcusdt@miniTicker',
    eth5m: 'ethusdt@miniTicker',
    sol5m: 'solusdt@miniTicker'
  };
  var WS_BASE = 'wss://stream.binance.com:9443/ws/';

  var minGap = 150;   // fast devices: up to ~6-7 UI events/sec inside a market
  try {
    var c = navigator.connection || {};
    if (c.saveData || (typeof navigator.deviceMemory === 'number' && navigator.deviceMemory <= 2)) minGap = 600;
  } catch (_) {}

  var ws = null, wsKey = null, lastEmit = 0, lastPrice = 0, ticks = 0;
  // The Binance WebSocket handshake is REFUSED from the production origin (and
  // geo-blocked for some testers), so turbo delivered ZERO ticks in the wild.
  // When the socket fails or goes silent we fast-poll the OST worker relay
  // instead — same tick stream, just over HTTP.
  var pollTimer = 0, pollKey = null, wsAlive = false, offStreak = 0;
  var SYMBOLS = { btc5m: 'BTCUSDT', eth5m: 'ETHUSDT', sol5m: 'SOLUSDT' };
  function relayBase() {
    var b = (typeof window !== 'undefined' && window.OST_API_BASE) || '';
    return b ? String(b).replace(/\/$/, '') : '';
  }
  function emitPrice(key, p) {
    if (!Number.isFinite(p) || p <= 0) return;
    lastPrice = p; ticks++;
    try { if (window.OST_FAST_MARKETS && window.OST_FAST_MARKETS.pushTick) window.OST_FAST_MARKETS.pushTick(key, p); } catch (_) {}
    var id = marketIdFor(key);
    try { if (id && window.OST_PRICES && window.OST_PRICES.markTurbo) window.OST_PRICES.markTurbo(id); } catch (_) {}
    var now = Date.now();
    if (now - lastEmit >= minGap) {
      lastEmit = now;
      try { window.dispatchEvent(new CustomEvent('ost:turbo-tick', { detail: { key: key, price: p, marketId: id, ts: now } })); } catch (_) {}
    }
  }
  function startPolling(key) {
    // IDEMPOTENT: ws error/close and the focus watcher can all call this. If we
    // blindly restarted the interval, the 1s timer got cleared before it ever
    // fired and the poller emitted ZERO ticks while still reporting "running".
    if (pollTimer && pollKey === key) return;
    stopPolling();
    var sym = SYMBOLS[key];
    if (!sym) return;
    pollKey = key;
    var rb = relayBase();
    // binance.vision IS reachable from the browser (only api.binance.com is
    // CORS-blocked). Binance 403s Cloudflare, so it cannot be relayed — the
    // worker's Coinbase-backed /spot is the fallback for blocked regions.
    var primary = 'https://data-api.binance.vision/api/v3/ticker/price?symbol=' + sym;
    var backup = rb ? (rb + '/spot?symbol=' + sym) : null;
    var useBackup = false;
    function poll() {
      if (wsKey !== key) { stopPolling(); return; }
      var url = (useBackup && backup) ? backup : primary;
      fetch(url, { cache: 'no-store' })
        .then(function (r) { if (!r.ok) throw new Error('bad status'); return r.json(); })
        .then(function (j) { emitPrice(key, Number(j && j.price)); })
        .catch(function () { if (backup) useBackup = true; });   // stick to the reachable source
    }
    poll();                                   // don't make the user wait 1s for tick #1
    pollTimer = setInterval(poll, 1000);
  }
  function stopPolling() { if (pollTimer) { clearInterval(pollTimer); } pollTimer = 0; pollKey = null; }

  function deskOnScreen() {
    // The desk auto-selects a market at boot, so selection alone is NOT
    // "the user is inside the market". Require the prediction stage to be
    // rendered AND actually intersecting the viewport.
    var el = document.getElementById('predictionMarketStage') || document.getElementById('live-bet');
    if (!el || !el.offsetHeight) return false;                  // hidden compartment (mobile focus mode)
    var r = el.getBoundingClientRect();
    return r.bottom > 0 && r.top < (window.innerHeight || 0);   // scrolled into view
  }

  function focusedKey() {
    try {
      if (document.visibilityState !== 'visible') return null;
      if (!deskOnScreen()) return null;
      var st = window.__predictionState;
      var id = st && st.selectedMarketId ? String(st.selectedMarketId) : '';
      var m = id.match(/^ost-(btc|eth|sol)5m-/);
      return m ? (m[1] + '5m') : null;
    } catch (_) { return null; }
  }

  function marketIdFor(key) {
    try {
      var st = window.__predictionState;
      var id = st && st.selectedMarketId ? String(st.selectedMarketId) : '';
      return id.indexOf('ost-' + key.slice(0, 3) + '5m-') === 0 ? id : null;
    } catch (_) { return null; }
  }

  function open(key) {
    close();
    wsKey = key;
    wsAlive = false;
    try {
      ws = new WebSocket(WS_BASE + STREAMS[key]);
      ws.onmessage = function (ev) {
        var p;
        try { p = Number(JSON.parse(ev.data).c); } catch (_) { return; }
        if (!wsAlive) { wsAlive = true; stopPolling(); }   // socket works — drop the poller
        emitPrice(key, p);
      };
      // Socket refused (the production case) -> immediately fall back to the relay.
      ws.onerror = function () { if (wsKey === key) startPolling(key); };
      ws.onclose = function () {
        if (wsKey === key) { ws = null; wsAlive = false; startPolling(key); }
      };
    } catch (_) { ws = null; }
    // Don't wait for a failure verdict: poll from the start, and stop the poller
    // the moment a real ws tick arrives. Guarantees ticks either way.
    startPolling(key);
  }

  function close() {
    if (ws) { try { ws.close(); } catch (_) {} }
    ws = null; wsKey = null; wsAlive = false;
    stopPolling();
  }

  // Focus watcher: 1s is plenty to notice entering/leaving a market.
  setInterval(function () {
    var key = focusedKey();
    if (key) {
      offStreak = 0;
      if (key !== wsKey) open(key);
      return;
    }
    // HYSTERESIS: the desk re-renders constantly, so deskOnScreen() can flicker
    // false for a frame. Tearing the stream down on a single miss meant we
    // close/open every second and the poller never survived long enough to
    // fire. Require 2 consecutive misses before letting go.
    // (Check wsKey, not ws: with the socket blocked the poller runs with ws=null.)
    if (wsKey && ++offStreak >= 2) { offStreak = 0; close(); }
  }, 1000);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'visible') close();
  }, false);
  window.addEventListener('pagehide', close, false);

  // Pyth (Solana's oracle) ticks arrive via ost-pyth.js — feed them into the
  // focused market too. Free extra tick density from the Solana ecosystem.
  window.addEventListener('ost:pyth-tick', function (e) {
    var d = e && e.detail;
    if (!d || !wsKey) return;
    if (SYMBOLS[wsKey] === String(d.symbol || '') + 'USDT') emitPrice(wsKey, Number(d.price));
  }, false);

  window.OST_TURBO = {
    status: function () {
      return {
        active: !!wsKey,                       // focused on a market (ws OR relay poll)
        key: wsKey,
        transport: wsAlive ? 'websocket' : (pollTimer ? 'relay-poll' : 'none'),
        lastPrice: lastPrice, ticks: ticks, minGapMs: minGap
      };
    },
    // manual override for tests / power users
    focus: function (key) { if (STREAMS[key]) open(key); },
    stop: close
  };
})();

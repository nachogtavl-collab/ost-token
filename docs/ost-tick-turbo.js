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

  var minGap = 250;
  try {
    var c = navigator.connection || {};
    if (c.saveData || (typeof navigator.deviceMemory === 'number' && navigator.deviceMemory <= 2)) minGap = 600;
  } catch (_) {}

  var ws = null, wsKey = null, lastEmit = 0, lastPrice = 0, ticks = 0;

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
    try {
      ws = new WebSocket(WS_BASE + STREAMS[key]);
      ws.onmessage = function (ev) {
        var p;
        try { p = Number(JSON.parse(ev.data).c); } catch (_) { return; }
        if (!Number.isFinite(p) || p <= 0) return;
        lastPrice = p; ticks++;
        // Feed the engines (ETH/SOL recompute odds from this; BTC display only).
        try { if (window.OST_FAST_MARKETS && window.OST_FAST_MARKETS.pushTick) window.OST_FAST_MARKETS.pushTick(key, p); } catch (_) {}
        var id = marketIdFor(key);
        try { if (id && window.OST_PRICES && window.OST_PRICES.markTurbo) window.OST_PRICES.markTurbo(id); } catch (_) {}
        var now = Date.now();
        if (now - lastEmit >= minGap) {
          lastEmit = now;
          try { window.dispatchEvent(new CustomEvent('ost:turbo-tick', { detail: { key: key, price: p, marketId: id, ts: now } })); } catch (_) {}
        }
      };
      ws.onerror = function () { close(); };   // baseline 5s poll still runs — turbo is purely additive
      ws.onclose = function () { if (wsKey === key) { ws = null; } };
    } catch (_) { ws = null; wsKey = null; }
  }

  function close() {
    if (ws) { try { ws.close(); } catch (_) {} }
    ws = null; wsKey = null;
  }

  // Focus watcher: 1s is plenty to notice entering/leaving a market.
  setInterval(function () {
    var key = focusedKey();
    if (key && key !== wsKey) open(key);
    else if (!key && ws) close();
  }, 1000);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'visible') close();
  }, false);
  window.addEventListener('pagehide', close, false);

  window.OST_TURBO = {
    status: function () {
      return { active: !!ws, key: wsKey, lastPrice: lastPrice, ticks: ticks, minGapMs: minGap };
    },
    // manual override for tests / power users
    focus: function (key) { if (STREAMS[key]) open(key); },
    stop: close
  };
})();

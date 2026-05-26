// ── OST Live Price Client (Step 3) ──────────────────────────────────────────
// Tiny, defensive client for the worker's /ost/price endpoint.
// COMPLETELY INERT unless `window.OST_LIVE_PRICE === true`.
//
// Public API (on window.OST):
//   OST.getPrice()        → last cached number, or null if not ready / disabled
//   OST.getMeta()         → { price, change24h, btcChange24h, btcMood, ts } or null
//   OST.refreshPrice()    → force an immediate fetch (returns Promise<number|null>)
//   OST.onPrice(fn)       → subscribe to updates; returns unsubscribe fn
//   OST.enableLive()      → flips the flag ON and starts polling
//   OST.disableLive()     → flips the flag OFF and stops polling
//
// Default state: flag OFF → no network calls, no UI side-effects.
// ────────────────────────────────────────────────────────────────────────────
(function () {
  'use strict';
  if (typeof window === 'undefined') return;
  window.OST = window.OST || {};
  if (window.OST.__livePriceLoaded) return;
  window.OST.__livePriceLoaded = true;

  var POLL_MS = 10_000;        // fetch every 10s when active
  var STALE_MS = 60_000;       // treat cached price as stale after 60s
  var subscribers = [];
  var cache = null;            // { price, change24h, btcChange24h, btcMood, ts, fetchedAt }
  var pollTimer = null;
  var inFlight = null;

  function apiBase() {
    var b = window.OST_API_BASE || '';
    return String(b).replace(/\/+$/, '');
  }

  function emit() {
    for (var i = 0; i < subscribers.length; i++) {
      try { subscribers[i](cache); } catch (_) {}
    }
    try {
      window.dispatchEvent(new CustomEvent('ost:price', { detail: cache }));
    } catch (_) {}
  }

  function fetchOnce() {
    if (inFlight) return inFlight;
    var base = apiBase();
    if (!base) return Promise.resolve(null);
    inFlight = fetch(base + '/ost/price', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (!j || typeof j.price !== 'number' || !isFinite(j.price) || j.price <= 0) return null;
        cache = {
          price: j.price,
          change24h: Number(j.change24h) || 0,
          btcChange24h: Number(j.btcChange24h) || 0,
          btcMood: Number(j.btcMood) || 1,
          ts: j.ts || new Date().toISOString(),
          fetchedAt: Date.now()
        };
        emit();
        return cache.price;
      })
      .catch(function () { return null; })
      .then(function (v) { inFlight = null; return v; });
    return inFlight;
  }

  function startPolling() {
    if (pollTimer) return;
    fetchOnce();
    pollTimer = setInterval(fetchOnce, POLL_MS);
  }

  function stopPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  window.OST.getPrice = function () {
    if (!window.OST_LIVE_PRICE) return null;
    if (!cache) return null;
    if (Date.now() - cache.fetchedAt > STALE_MS * 6) return null; // hard-stale guard
    return cache.price;
  };

  window.OST.getMeta = function () {
    if (!window.OST_LIVE_PRICE || !cache) return null;
    return {
      price: cache.price,
      change24h: cache.change24h,
      btcChange24h: cache.btcChange24h,
      btcMood: cache.btcMood,
      ts: cache.ts,
      ageMs: Date.now() - cache.fetchedAt
    };
  };

  window.OST.refreshPrice = function () {
    if (!window.OST_LIVE_PRICE) return Promise.resolve(null);
    return fetchOnce();
  };

  window.OST.onPrice = function (fn) {
    if (typeof fn !== 'function') return function () {};
    subscribers.push(fn);
    if (cache) { try { fn(cache); } catch (_) {} }
    return function () {
      var i = subscribers.indexOf(fn);
      if (i >= 0) subscribers.splice(i, 1);
    };
  };

  window.OST.enableLive = function () {
    window.OST_LIVE_PRICE = true;
    startPolling();
  };

  window.OST.disableLive = function () {
    window.OST_LIVE_PRICE = false;
    stopPolling();
  };

  // Auto-start if the flag was set before this script loaded.
  if (window.OST_LIVE_PRICE === true) startPolling();
})();

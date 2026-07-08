/* ==========================================================================
 * OST · Prices — ONE live price per market, everywhere
 * --------------------------------------------------------------------------
 * The board card, the trade ticket, the pop-out trade tab, transaction history
 * and the fast/native engines each derived a market's live price on their own,
 * so the SAME market could read 55c on the card and 53c in the ticket. This is
 * the single source of truth: every surface asks OST_PRICES.get(marketId) and
 * gets the same yes/no/mid, refreshed from the feed state + native builder.
 *
 *   OST_PRICES.get(id)  -> { yes, no, mid, ts, source } | null
 *   OST_PRICES.mid(id, side) -> number (0..1)   // 'yes' | 'no'
 *   OST_PRICES.set(id, yes, source)             // producers push here
 *
 * Reads are cached for ~1s so repeated lookups in one render are consistent;
 * the cache is keyed by marketId so a card and its ticket never disagree.
 * ========================================================================== */
(function () {
  'use strict';

  var CACHE_TTL = 1000;
  var cache = {};       // id -> { yes, no, mid, ts, source }
  var overrides = {};   // id -> { yes, ts, source } pushed by producers

  function clampP(p) {
    p = Number(p);
    if (!Number.isFinite(p)) return NaN;
    return Math.max(0.001, Math.min(0.999, p));   // 0.1c floor .. 99.9c ceiling
  }

  // Pull the freshest market object the feed maintains, plus live native rounds.
  function resolveYes(id) {
    if (id == null) return NaN;
    // 1) a producer override wins if it is fresh (< 5s)
    var ov = overrides[id];
    if (ov && Date.now() - ov.ts < 5000 && Number.isFinite(ov.yes)) return ov.yes;

    // 2) native / fast rounds recompute their odds through the builder
    try {
      if (typeof window.buildOstNativeMarkets === 'function') {
        var natives = window.buildOstNativeMarkets() || [];
        for (var i = 0; i < natives.length; i++) {
          var n = natives[i];
          if (!n || n.id == null) continue;
          if (n.id === id) return Number(n.yesPriceNumber);
          // fast round ids change every 5 min — match by prefix
          if (/^ost-(btc|eth|sol)5m-/.test(String(id))) {
            var prefix = String(id).replace(/\d+$/, '');
            if (String(n.id).indexOf(prefix) === 0) return Number(n.yesPriceNumber);
          }
        }
      }
    } catch (_) {}

    // 3) the feed state (board cards read this too)
    try {
      var st = window.__predictionState;
      if (st && Array.isArray(st.markets)) {
        var m = st.markets.find(function (x) { return x && x.id === id; });
        if (m && Number.isFinite(Number(m.yesPriceNumber))) return Number(m.yesPriceNumber);
      }
    } catch (_) {}
    return NaN;
  }

  // Turbo mode: while the user is INSIDE a market, ost-tick-turbo marks it so
  // its cache TTL drops to 250ms — the ticket tracks streamed ticks instead of
  // the 1s render cache. Everything else keeps the calm 1s TTL (no bottleneck).
  var turboUntil = {};
  function markTurbo(id) { if (id != null) turboUntil[id] = Date.now() + 5000; }

  function get(id) {
    var c = cache[id];
    var ttl = (turboUntil[id] && Date.now() < turboUntil[id]) ? 250 : CACHE_TTL;
    if (c && Date.now() - c.ts < ttl) return c;
    var yes = clampP(resolveYes(id));
    if (!Number.isFinite(yes)) return c || null;   // keep last good if resolve fails
    var rec = { yes: yes, no: clampP(1 - yes), mid: yes, ts: Date.now(), source: 'ost-prices' };
    cache[id] = rec;
    return rec;
  }

  function mid(id, side) {
    var rec = get(id);
    if (!rec) return NaN;
    return (String(side).toLowerCase() === 'no') ? rec.no : rec.yes;
  }

  function set(id, yes, source) {
    var y = clampP(yes);
    if (id == null || !Number.isFinite(y)) return;
    overrides[id] = { yes: y, ts: Date.now(), source: source || 'producer' };
    cache[id] = { yes: y, no: clampP(1 - y), mid: y, ts: Date.now(), source: source || 'producer' };
  }

  window.OST_PRICES = { get: get, mid: mid, set: set, clampP: clampP, markTurbo: markTurbo };
})();

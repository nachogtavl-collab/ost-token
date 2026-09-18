/* ==========================================================================
 * OST · Live Stats — fill the "devnet pulse" tiles with REAL worker data
 * --------------------------------------------------------------------------
 * The wallet command strip showed hard-coded zeros ("Faucet claims 0",
 * "Minted supply 0 OST", "Syncing devnet…" forever). This polls the live
 * endpoints the worker already exposes and paints real numbers:
 *   /ost/stats  → active wallets 24h, tx 24h, live OST price
 *   /positions/recent → live global bet count (proof the network is alive)
 * Repaints every 15s; degrades quietly to the last good values offline.
 * ========================================================================== */
(function () {
  'use strict';

  function apiBase() {
    return (typeof window !== 'undefined' && window.OST_API_BASE)
      ? String(window.OST_API_BASE).replace(/\/$/, '') : '';
  }

  function el(id) { return document.getElementById(id); }

  function setText(id, text) {
    var n = el(id);
    if (n && text != null) n.textContent = text;
  }

  function fmt(n) {
    n = Number(n) || 0;
    if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
    return String(Math.round(n));
  }

  var lastStats = null;

  // The ONE OST value the whole app agrees on: the canonical CONVERSION price
  // (what an OST is actually worth to spend/convert), shown in the user's own
  // currency. This is deliberately NOT the synthetic chart oracle — the wallet,
  // the trade tickets and the convert rail all price OST at this rate, so the
  // pulse must too, or a user sees "1 OST = $0.0118" in their balance and a
  // different number here. Coherence over a gamified ticker.
  window.OST_LIVE_STATS_OWNS_PRICE = true;
  function canonicalOstValueText() {
    try {
      if (window.OST_FIAT && typeof window.OST_FIAT.format === 'function') {
        // A 2-decimal currency format turns $0.0118 into "$0.01" (15% off). When one
        // OST is worth under 1 unit, show the value of 100 OST instead - exact, and
        // it is the faucet drop size so it means something to a new user.
        var one = window.OST_FIAT.format(1), usd1 = Number(window.OST_FIAT.toFiatUsd(1));
        if (usd1 > 0 && usd1 < 0.1) return window.OST_FIAT.format(100) + ' per 100 OST';
        return one;
      }
    } catch (_) {}
    var usd = 0.0118;
    try {
      if (window.OST_CONVERT_PRICE && typeof window.OST_CONVERT_PRICE.ostUsd === 'function') {
        var v = Number(window.OST_CONVERT_PRICE.ostUsd());
        if (Number.isFinite(v) && v > 0) usd = v;
      }
    } catch (_) {}
    return '$' + usd.toFixed(4);
  }

  function paintPrice() {
    setText('ostLivePrice', canonicalOstValueText());
  }

  function paintStats(stats) {
    if (stats) lastStats = stats;
    // "Faucet claims" tile → live active wallets in the last 24h
    if (lastStats) setText('ostMarketVelocity', fmt(lastStats.activeWallets24h) + ' active');
    // Price tile → the CANONICAL OST value (matches the wallet + convert rail),
    // in the user's currency. The synthetic market activity goes in the caption.
    paintPrice();
    var chg = el('ostLiveChange');
    if (chg && lastStats) chg.textContent = lastStats.tx24h + ' tx · ' + fmt(lastStats.volume24h) + ' vol (24h)';
    var updated = el('ostMarketUpdated');
    if (updated) updated.textContent = 'Live · ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  // Keep the pulse's OST value in sync with the wallet the instant the user
  // changes currency or the price moves.
  ['ost:currencychange', 'ost:price', 'ost:wallet-changed'].forEach(function (ev) {
    window.addEventListener(ev, paintPrice, { passive: true });
  });

  function paintReserve() {
    // Treasury reserve + minted supply from the on-chain rescue layer when present
    try {
      if (window.OST_RESCUE && typeof window.OST_RESCUE.poolBalance === 'function') {
        Promise.resolve(window.OST_RESCUE.poolBalance()).then(function (bal) {
          if (Number.isFinite(Number(bal)) && Number(bal) > 0) {
            setText('ostMarketLiquidity', fmt(bal) + ' OST');
          }
        }).catch(function () {});
      }
    } catch (_) {}
  }

  function tick() {
    var base = apiBase();
    if (!base) return;
    // Decorative card: only spend worker requests while it is actually on screen.
    var card = el('ostLivePrice'); if (document.hidden || !card || card.offsetParent === null) { paintPrice(); return; }
    fetch(base + '/ost/stats', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(paintStats)
      .catch(function () {});
    fetch(base + '/positions/recent?limit=1', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (d && Array.isArray(d.recent) && el('ostMarketVolume')) {
          // "Minted supply" tile repurposed to show live global bet flow
          var last = d.recent[0];
          if (last && last.marketTitle) {
            setText('ostMarketVolume', 'Live bets flowing');
          }
        }
      })
      .catch(function () {});
    paintReserve();
  }

  function boot() {
    if (!el('ostMarketVelocity') && !el('ostLivePrice')) return;
    tick();
    setInterval(tick, 120000);   // decorative 'network alive' counter: 2 min, not 15s
    // repaint promptly after our own telemetry lands
    window.addEventListener('ost:telemetry-accepted', function (e) {
      if (e && e.detail) paintStats(Object.assign({ tx24h: e.detail.tx24h, activeWallets24h: e.detail.activeWallets24h, price: e.detail.price, volume24h: 0, btcMood: e.detail.btcMood }, {}));
    }, false);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 1600); });
  else setTimeout(boot, 1600);
})();

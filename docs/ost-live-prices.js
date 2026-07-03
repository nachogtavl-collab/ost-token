/* ==========================================================================
 * OST · Live Prices — in-place dynamic odds on every visible market card
 * --------------------------------------------------------------------------
 * The board fully re-renders on the ~10s feed cycle, but between renders
 * prices sat frozen — the page felt static. This module marks visible
 * cards to market every 4 seconds straight from window.__predictionState
 * (which the feed loop keeps fresh) and from the fast-market engines:
 * yes/no numbers, probability bar, with a green/red flash on movement.
 * DOM is patched in place — no re-render, no scroll jumps.
 * ========================================================================== */
(function () {
  'use strict';

  var TICK_MS = 4000;
  var lastShown = {}; // marketId -> yes price last painted

  function fmtPct(p) {
    return Math.round(Number(p) * 100) + '%';
  }

  function marketsById() {
    var map = {};
    try {
      var st = window.__predictionState;
      (st && st.markets || []).forEach(function (m) { if (m && m.id != null) map[m.id] = m; });
    } catch (_) {}
    return map;
  }

  function injectStyles() {
    if (document.getElementById('ostLivePriceStyle')) return;
    var st = document.createElement('style');
    st.id = 'ostLivePriceStyle';
    st.textContent =
      '.olp-up{animation:olpUp 1.4s ease;}' +
      '.olp-down{animation:olpDown 1.4s ease;}' +
      '@keyframes olpUp{20%{box-shadow:inset 0 0 0 1px rgba(52,211,153,0.75), 0 0 18px rgba(52,211,153,0.28);}100%{box-shadow:none;}}' +
      '@keyframes olpDown{20%{box-shadow:inset 0 0 0 1px rgba(255,124,138,0.75), 0 0 18px rgba(255,124,138,0.28);}100%{box-shadow:none;}}' +
      '.prediction-market-bar-fill{transition:width .8s ease;}';
    document.head.appendChild(st);
  }

  function paintCard(card, market) {
    var yes = Number(market.yesPriceNumber);
    if (!Number.isFinite(yes)) return;
    var id = market.id;
    var prev = lastShown[id];
    var yesText = market.yesValue || fmtPct(yes);
    var noText = market.noValue || fmtPct(1 - yes);

    var strongs = card.querySelectorAll('.prediction-market-price strong');
    if (strongs[0]) strongs[0].textContent = yesText;
    if (strongs[1]) strongs[1].textContent = noText;

    var probSpans = card.querySelectorAll('.prediction-market-probability-row span');
    if (probSpans[0]) probSpans[0].textContent = (market.yesLabel || 'Yes') + ' ' + yesText;
    if (probSpans[1]) probSpans[1].textContent = (market.noLabel || 'No') + ' ' + noText;

    var bar = card.querySelector('.prediction-market-bar-fill');
    if (bar) bar.style.width = Math.max(0, Math.min(100, yes * 100)) + '%';

    if (Number.isFinite(prev) && Math.abs(yes - prev) >= 0.005) {
      card.classList.remove('olp-up', 'olp-down');
      void card.offsetWidth;
      card.classList.add(yes > prev ? 'olp-up' : 'olp-down');
    }
    lastShown[id] = yes;
  }

  function tick() {
    var cards = document.querySelectorAll('#predictionMarketList [data-prediction-market-id]');
    if (!cards.length) return;
    var map = marketsById();
    // fast rounds refresh their odds through the native builder
    try {
      if (typeof window.buildOstNativeMarkets === 'function') {
        (window.buildOstNativeMarkets() || []).forEach(function (m) {
          if (m && m.isOstNative && m.id != null) map[m.id] = m;
        });
      }
    } catch (_) {}
    cards.forEach(function (card) {
      var id = card.getAttribute('data-prediction-market-id');
      var market = map[id];
      // fast round ids change every 5 min — match by prefix for the new round
      if (!market && /^ost-(btc|eth|sol)5m-/.test(id || '')) {
        var prefix = id.replace(/\d+$/, '');
        var key = Object.keys(map).find(function (k) { return k.indexOf(prefix) === 0; });
        if (key) market = map[key];
      }
      if (market) paintCard(card, market);
    });
  }

  function boot() {
    if (!document.getElementById('walletBtn')) return;
    injectStyles();
    setInterval(tick, TICK_MS);
    setTimeout(tick, 1500);
  }

  window.OST_LIVE_PRICES = { tick: tick };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 1500); });
  else setTimeout(boot, 1500);
})();

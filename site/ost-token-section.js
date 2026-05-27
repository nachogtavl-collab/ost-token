// ── OST Dynamic Token Section ───────────────────────────────────────────────
// Replaces static "Loading..." price with the live oracle feed and renders
// the on-page token attributes from /ost-metadata.json.
//
// Safe to load anywhere after ost-price-client.js. No-op if the API or the
// metadata file is unreachable; existing DOM defaults stay in place.
// ────────────────────────────────────────────────────────────────────────────
(function () {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__ostTokenSectionLoaded) return;
  window.__ostTokenSectionLoaded = true;

  var $ = function (id) { return document.getElementById(id); };

  function fmtPrice(n) {
    if (!isFinite(n) || n <= 0) return null;
    if (n >= 1)    return '$' + n.toFixed(4);
    if (n >= 0.01) return '$' + n.toFixed(5);
    return '$' + n.toPrecision(4);
  }

  function fmtChange(pct) {
    if (!isFinite(pct)) return '';
    var sign = pct > 0 ? '+' : '';
    return sign + pct.toFixed(2) + '%';
  }

  function applyPrice(meta) {
    if (!meta) return;
    var priceTxt = fmtPrice(meta.price);
    if (!priceTxt) return;

    var tp = $('tickerPrice');
    if (tp) {
      tp.textContent = priceTxt;
      tp.classList.add('is-live');
    }

    var tc = $('tickerChange');
    if (tc) {
      var txt = fmtChange(meta.change24h);
      tc.textContent = txt;
      tc.classList.remove('up', 'down', 'flat');
      tc.classList.add(meta.change24h > 0 ? 'up' : meta.change24h < 0 ? 'down' : 'flat');
    }

    var live = $('ostLivePrice');
    if (live && live.dataset.ostLive !== '0') {
      live.dataset.ostLive = '1';
      live.textContent = priceTxt + ' / OST';
    }
    var liveChg = $('ostLiveChange');
    if (liveChg) liveChg.textContent = 'Live oracle · ' + fmtChange(meta.change24h) + ' 24h';

    var upd = $('ostMarketUpdated');
    if (upd) {
      var ageS = Math.max(0, Math.round((meta.ageMs || 0) / 1000));
      upd.textContent = 'Updated ' + ageS + 's ago';
    }
  }

  function bootPrice() {
    if (!window.OST || typeof window.OST.onPrice !== 'function') return;
    // Push current value (if any) and subscribe to updates.
    var meta = typeof window.OST.getMeta === 'function' ? window.OST.getMeta() : null;
    if (meta) applyPrice(meta);
    window.OST.onPrice(function () {
      var m = window.OST.getMeta && window.OST.getMeta();
      if (m) applyPrice(m);
    });
    // Lightweight "ageMs" refresher so the "Updated Xs ago" label ticks.
    setInterval(function () {
      var m = window.OST.getMeta && window.OST.getMeta();
      if (m) applyPrice(m);
    }, 5000);
  }

  function applyMetadata(meta) {
    if (!meta || typeof meta !== 'object') return;
    var attrs = {};
    (meta.attributes || []).forEach(function (a) { attrs[a.trait_type] = a.value; });

    if (attrs['Total Supply']) {
      var t = $('transpTreasury');
      if (t) t.textContent = String(attrs['Total Supply']);
    }

    var host = $('ostTokenAttributes');
    if (host && Array.isArray(meta.attributes)) {
      host.innerHTML = meta.attributes.map(function (a) {
        return '<div class="ost-attr"><span class="ost-attr-key">' +
          String(a.trait_type) +
          '</span><span class="ost-attr-val">' +
          String(a.value) +
          '</span></div>';
      }).join('');
    }
  }

  function loadMetadata() {
    try {
      fetch('./ost-metadata.json', { cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(applyMetadata)
        .catch(function () {});
    } catch (_) {}
  }

  function start() {
    bootPrice();
    loadMetadata();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();

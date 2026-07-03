/* ==========================================================================
 * OST · World Cup Live + Bet rail
 * --------------------------------------------------------------------------
 * Replaces the stale featured-match area (the EPL Leeds–Burnley card whose
 * game ended months ago) with a living rail of UPCOMING World Cup markets:
 * next matches and stage markets sorted by close time, live odds, one-tap
 * bet through the unified trade modal, and a 📺 broadcast slot per match
 * that lights up the moment a stream link is configured in
 * window.OST_WC_STREAMS = { <marketId>: 'https://…' }.
 *
 * Data comes straight from the live prediction state (worldcup topic), so
 * the rail creates/updates/expires itself with zero human intervention.
 * ========================================================================== */
(function () {
  'use strict';

  var MAX_ITEMS = 8;
  var host = null;

  function wcMarkets() {
    var now = Date.now();
    try {
      var ms = (window.__predictionState || {}).markets || [];
      return ms.filter(function (m) {
        if (!m || !(m.topics instanceof Set) || !m.topics.has('worldcup')) return false;
        if (!Number.isFinite(Number(m.yesPriceNumber))) return false;
        var close = Number(m.closeAtMs || 0);
        return close > now; // upcoming / still open only
      }).sort(function (a, b) {
        // matches ("vs") first, then soonest close
        var av = / vs\.? /i.test(a.title) ? 0 : 1;
        var bv = / vs\.? /i.test(b.title) ? 0 : 1;
        if (av !== bv) return av - bv;
        return (a.closeAtMs || 9e15) - (b.closeAtMs || 9e15);
      }).slice(0, MAX_ITEMS);
    } catch (_) { return []; }
  }

  function closesIn(ms) {
    var d = ms - Date.now();
    if (d <= 0) return 'closing';
    var h = Math.floor(d / 3600000);
    if (h >= 48) return 'in ' + Math.round(h / 24) + 'd';
    if (h >= 1) return 'in ' + h + 'h ' + Math.round((d % 3600000) / 60000) + 'm';
    return 'in ' + Math.max(1, Math.round(d / 60000)) + 'm';
  }

  function injectStyles() {
    if (document.getElementById('ostWcRailStyle')) return;
    var st = document.createElement('style');
    st.id = 'ostWcRailStyle';
    st.textContent =
      '.owc-rail{margin:12px 0 18px;}' +
      '.owc-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px;}' +
      '.owc-title{font-weight:900;font-size:1.02rem;color:#f8fafc;display:flex;align-items:center;gap:8px;}' +
      '.owc-live{background:rgba(255,77,90,0.16);border:1px solid rgba(255,77,90,0.45);color:#ff8d96;font-size:10px;font-weight:800;border-radius:999px;padding:3px 9px;letter-spacing:.06em;}' +
      '.owc-scroll{display:grid;grid-auto-flow:column;grid-auto-columns:260px;gap:10px;overflow-x:auto;padding-bottom:6px;-webkit-overflow-scrolling:touch;scrollbar-width:thin;}' +
      '.owc-card{background:linear-gradient(165deg,#10182b,#0a0f1e);border:1px solid rgba(109,159,255,0.25);border-radius:14px;padding:11px 12px;display:flex;flex-direction:column;gap:8px;}' +
      '.owc-card-title{font-size:12.5px;font-weight:800;color:#e2e8f0;line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;min-height:34px;}' +
      '.owc-meta{display:flex;justify-content:space-between;align-items:center;font-size:10.5px;color:#94a3b8;}' +
      '.owc-odds{display:flex;gap:6px;}' +
      '.owc-odd{flex:1;text-align:center;border-radius:9px;padding:7px 0;font-size:12px;font-weight:900;cursor:pointer;border:1px solid transparent;}' +
      '.owc-odd--yes{background:rgba(52,211,153,0.14);border-color:rgba(52,211,153,0.4);color:#7ce6a8;}' +
      '.owc-odd--no{background:rgba(255,124,138,0.12);border-color:rgba(255,124,138,0.4);color:#ff9aa5;}' +
      '.owc-odd:hover{filter:brightness(1.25);}' +
      '.owc-cast{display:flex;align-items:center;gap:6px;font-size:10.5px;font-weight:700;}' +
      '.owc-cast a{color:#7dd3fc;text-decoration:none;}' +
      '.owc-cast .is-soon{color:#64748b;}' +
      '@media (max-width:430px){.owc-scroll{grid-auto-columns:82vw;}}';
    document.head.appendChild(st);
  }

  function render() {
    if (!host) return;
    var items = wcMarkets();
    if (!items.length) {
      host.innerHTML =
        '<div class="owc-head"><span class="owc-title">⚽ World Cup · Live + Bet</span></div>' +
        '<div style="color:#64748b;font-size:12px;">World Cup markets are loading…</div>';
      return;
    }
    var streams = window.OST_WC_STREAMS || {};
    host.innerHTML =
      '<div class="owc-head">' +
        '<span class="owc-title">⚽ World Cup · Live + Bet <span class="owc-live">TOURNAMENT LIVE</span></span>' +
        '<button type="button" class="opl-chip" data-owc-all style="border:1px solid rgba(255,255,255,0.2);background:transparent;color:#cbd5e1;border-radius:999px;padding:5px 12px;font-size:11px;font-weight:700;cursor:pointer;">All ' + '⚽' + ' markets →</button>' +
      '</div>' +
      '<div class="owc-scroll">' +
        items.map(function (m) {
          var yes = Number(m.yesPriceNumber);
          var stream = streams[m.id];
          return '<div class="owc-card" data-owc-market="' + String(m.id).replace(/"/g, '&quot;') + '">' +
            '<div class="owc-card-title">' + escapeHtml(m.title) + '</div>' +
            '<div class="owc-meta"><span>' + escapeHtml(m.sourceLabel || 'Polymarket') + '</span><span>closes ' + closesIn(Number(m.closeAtMs)) + '</span></div>' +
            '<div class="owc-odds">' +
              '<button type="button" class="owc-odd owc-odd--yes" data-owc-side="yes">YES ' + Math.round(yes * 100) + '¢</button>' +
              '<button type="button" class="owc-odd owc-odd--no" data-owc-side="no">NO ' + Math.round((1 - yes) * 100) + '¢</button>' +
            '</div>' +
            '<div class="owc-cast">' +
              (stream
                ? '📺 <a href="' + stream + '" target="_blank" rel="noopener">Watch live broadcast</a>'
                : '<span class="is-soon">📺 Broadcast link slot — ready to connect</span>') +
            '</div>' +
          '</div>';
        }).join('') +
      '</div>';
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  function onClick(e) {
    var all = e.target.closest('[data-owc-all]');
    if (all && host.contains(all)) {
      var chip = document.querySelector('[data-prediction-topic="worldcup"]');
      if (chip) { chip.click(); chip.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
      return;
    }
    var side = e.target.closest('[data-owc-side]');
    if (!side || !host.contains(side)) return;
    var card = side.closest('[data-owc-market]');
    if (!card) return;
    var id = card.getAttribute('data-owc-market');
    try {
      var m = ((window.__predictionState || {}).markets || []).find(function (x) { return x && x.id === id; });
      if (m && window.OST_MARKET_MODAL && typeof window.OST_MARKET_MODAL.open === 'function') {
        window.OST_MARKET_MODAL.open(m);
        var want = side.getAttribute('data-owc-side') === 'yes' ? 'YES' : 'NO';
        setTimeout(function () {
          var modal = document.getElementById('ost-market-modal');
          var btn = modal && modal.querySelector('.ost-modal__side-btn[data-side="' + want + '"]');
          if (btn) btn.click();
        }, 60);
      }
    } catch (_) {}
  }

  function mount() {
    var section = document.getElementById('live-bet');
    if (!section) return false;
    if (document.getElementById('ostWcRail')) return true;
    injectStyles();
    host = document.createElement('div');
    host.id = 'ostWcRail';
    host.className = 'owc-rail';
    section.parentNode.insertBefore(host, section);
    // The old featured card promotes a match that ended months ago — hide it
    // once its market is past close (live-watch keeps it pinned regardless).
    try {
      var stale = true;
      var ms = (window.__predictionState || {}).markets || [];
      var epl = ms.find(function (m) { return m && String(m.id).indexOf('native-polymarket-epl') === 0; });
      if (epl && Number(epl.closeAtMs) > Date.now()) stale = false;
      if (stale) section.style.display = 'none';
    } catch (_) {}
    document.addEventListener('click', onClick, true);
    render();
    setInterval(render, 20000);
    return true;
  }

  function boot() {
    if (mount()) return;
    var tries = 0;
    var t = setInterval(function () {
      tries++;
      if (mount() || tries > 40) clearInterval(t);
    }, 700);
  }

  window.OST_WC_RAIL = { render: render, markets: wcMarkets };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 1800); });
  else setTimeout(boot, 1800);
})();

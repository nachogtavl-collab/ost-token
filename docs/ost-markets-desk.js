/* ==========================================================================
 * OST Markets — desktop terminal for the prediction markets (#ostPredictMobile).
 *
 * The predict module renders phone-first. On desktop this module:
 *   · switches it to a wide layout (.opm-desk; styles in ost-markets-desk.css)
 *   · adds a right rail: LIVE TRADES (real /positions/recent + realtime fills)
 *     and YOUR TICKETS (the local prediction ledger)
 *   · splits a market page into chart + tabs | sticky trade panel, moving the
 *     module's own nodes (ids and listeners stay intact)
 *   · routes OST_MARKET_MODAL.open(...) to the market page: the legacy modal
 *     renders squashed on desktop
 * Everything is additive and desktop-only; phones keep the existing layout.
 * ========================================================================== */
(function () {
  'use strict';
  if (window.OST_MARKETS_DESK) return;

  var API = String(window.OST_API_BASE || 'https://ost-api.nachogtavl.workers.dev').replace(/\/+$/, '');
  function $(id) { return document.getElementById(id); }
  function isMobile() {
    try { if (window.OST_MOBILE && OST_MOBILE.isMobile) return !!OST_MOBILE.isMobile(); } catch (_) {}
    return window.matchMedia('(max-width: 820px), (pointer: coarse) and (max-width: 1024px)').matches;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function num(v) { var n = Number(v); return Number.isFinite(n) ? n : undefined; }
  function ago(ts) {
    var t = typeof ts === 'number' ? ts : Date.parse(ts);
    if (!Number.isFinite(t)) return '';
    var s = Math.max(0, Math.round((Date.now() - t) / 1000));
    if (s < 60) return s + 's'; if (s < 3600) return Math.floor(s / 60) + 'm';
    if (s < 86400) return Math.floor(s / 3600) + 'h'; return Math.floor(s / 86400) + 'd';
  }
  function amt(v) { v = num(v); return v === undefined ? '—' : v.toLocaleString(undefined, { maximumFractionDigits: 2 }); }
  function markets() { try { return Array.isArray(window.__ostPredictionMarkets) ? window.__ostPredictionMarkets : []; } catch (_) { return []; } }
  function natives() { try { return (typeof window.buildOstNativeMarkets === 'function' && window.buildOstNativeMarkets()) || []; } catch (_) { return []; } }
  function findMarket(id) {
    id = String(id || ''); if (!id) return null;
    var all = markets().concat(natives());
    for (var i = 0; i < all.length; i++) if (all[i] && String(all[i].id) === id) return all[i];
    if (/^ost-btc5m/.test(id)) for (var j = 0; j < all.length; j++) if (all[j] && /^ost-btc5m/.test(String(all[j].id))) return all[j];
    return null;
  }

  var host = null, desk = false;

  /* ---------------------------------------------------------------- layout */
  function applyMode() {
    host = $('ostPredictMobile'); if (!host) return;
    desk = !isMobile();
    host.classList.toggle('opm-desk', desk);
    document.documentElement.classList.toggle('omd-on', desk);
    if (desk) { ensureRail(); splitDetail(); }
    else unsplitDetail();
  }

  function splitDetail() {
    var d = $('opmDetail'); if (!d) return;
    var scroll = d.querySelector(':scope > .opm-scroll'); if (!scroll || scroll.__omd) return;
    scroll.__omd = true;
    var wrap = document.createElement('div'); wrap.className = 'omd-detail';
    var L = document.createElement('div'); L.className = 'omd-l';
    var R = document.createElement('div'); R.className = 'omd-r';
    var kids = Array.prototype.slice.call(scroll.children);
    var head = null;
    kids.forEach(function (k) {
      if (k.classList.contains('opm-qhead')) head = k;
      else if (k.id === 'opmYn' || k.classList.contains('opm-pool') || k.id === 'opmPosWrap') R.appendChild(k);
      else L.appendChild(k);
    });
    var bar = d.querySelector(':scope > .opm-buybar'); if (bar) R.appendChild(bar);
    if (head) wrap.appendChild(head);
    wrap.appendChild(L); wrap.appendChild(R);
    scroll.appendChild(wrap);
    setTimeout(fitCanvases, 60);
  }
  // The module draws from canvas.width/height (402x150 phone buffers). Stretched to
  // the desktop column that blurred the chart and blew its labels up, so match the
  // drawing buffer to the real box; the module's next frame draws at full width.
  function fitCanvases() {
    if (!desk) return;
    var changed = false;
    ['opmG', 'opmStdG'].forEach(function (id) {
      var c = $(id); if (!c) return;
      var w = Math.round(c.clientWidth), h = Math.round(c.clientHeight);
      if (w > 0 && h > 0 && (c.width !== w || c.height !== h)) { c.width = w; c.height = h; changed = true; }
    });
    // Resizing clears a canvas; repaint now instead of waiting for the next tick.
    if (changed) { try { if (window.OST_PREDICT_MOBILE && OST_PREDICT_MOBILE.redraw) OST_PREDICT_MOBILE.redraw(); } catch (_) {} }
  }
  function unsplitDetail() {
    var d = $('opmDetail'); if (!d) return;
    var wrap = d.querySelector('.omd-detail'); if (!wrap) return;
    var scroll = wrap.parentNode, bar = wrap.querySelector('.opm-buybar');
    var head = wrap.querySelector(':scope > .opm-qhead'), L = wrap.querySelector('.omd-l'), R = wrap.querySelector('.omd-r');
    var order = [];
    if (head) order.push(head);
    // Restore the module's original order: chart block, yn, pool, position, tabs.
    var lk = L ? Array.prototype.slice.call(L.children) : [], rk = R ? Array.prototype.slice.call(R.children).filter(function (x) { return x !== bar; }) : [];
    var chart = lk.filter(function (x) { return !(x.id === 'opmSeg' || x.classList.contains('opm-pane')); });
    var tabs = lk.filter(function (x) { return x.id === 'opmSeg' || x.classList.contains('opm-pane'); });
    order = order.concat(chart, rk, tabs);
    order.forEach(function (n) { scroll.appendChild(n); });
    wrap.remove(); scroll.__omd = false;
    if (bar) d.insertBefore(bar, scroll.nextSibling);
  }

  /* ---------------------------------------------------------------- rail */
  var rail = null, trades = [], seen = {}, railTimer = 0, railVisible = false;
  function ensureRail() {
    var browse = $('opmBrowse'); if (!browse) return;
    if (rail && rail.parentNode === browse) return;
    rail = document.createElement('aside');
    rail.className = 'omd-rail';
    rail.setAttribute('aria-label', 'Live market activity');
    rail.innerHTML =
      '<div class="omd-box"><div class="omd-h"><span class="d" aria-hidden="true"></span>Live trades<span class="sp"></span></div>' +
        '<div class="omd-list" id="omdTrades"><div class="omd-empty">Loading the live tape…</div></div></div>' +
      '<div class="omd-box"><div class="omd-h">Your tickets<span class="sp"></span><button type="button" id="omdAllTix">View all</button></div>' +
        '<div class="omd-list" id="omdTix"></div></div>';
    browse.appendChild(rail);
    rail.addEventListener('click', function (e) {
      if (e.target.closest('#omdAllTix')) { try { OST_PREDICT_MOBILE.openPositions(); } catch (_) {} return; }
      var row = e.target.closest('[data-mid]'); if (!row) return;
      var m = findMarket(row.getAttribute('data-mid'));
      if (m && window.OST_PREDICT_MOBILE) OST_PREDICT_MOBILE.openMarket(m);
    });
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (en) {
        railVisible = en.some(function (x) { return x.isIntersecting; });
        if (railVisible) { loadTrades(); renderTickets(); }
      }).observe(rail);
    } else { railVisible = true; loadTrades(); }
    renderTickets();
  }

  function tradeRow(t, fresh) {
    var side = String(t.side || '').toLowerCase() === 'no' ? 'n' : 'y';
    var px = num(t.price); var pc = px === undefined ? '' : ' @ ' + Math.round((px > 1 ? px : px * 100)) + '¢';
    return '<div class="omd-row' + (fresh ? ' in' : '') + '" data-mid="' + esc(t.marketId || '') + '" title="' + esc(t.title || '') + '">' +
      '<span class="omd-side ' + side + '">' + (side === 'y' ? 'Yes' : 'No') + '</span>' +
      '<span class="omd-t">' + esc(t.title || 'Market') + '</span>' +
      '<span class="omd-a">' + amt(t.stake) + '</span>' +
      '<span class="omd-m"><span>' + esc(t.who || 'trader') + pc + '</span><span>' + ago(t.ts) + '</span></span></div>';
  }
  function renderTrades(freshKey) {
    var box = $('omdTrades'); if (!box) return;
    if (!trades.length) { box.innerHTML = '<div class="omd-empty">No trades yet. The tape fills the moment someone takes a side.</div>'; return; }
    box.innerHTML = trades.slice(0, 30).map(function (t) { return tradeRow(t, t.key === freshKey); }).join('');
  }
  function pushTrade(t, fresh) {
    if (!t || seen[t.key]) return; seen[t.key] = 1;
    trades.push(t);
    trades.sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); });
    if (trades.length > 60) trades.length = 60;
    if (fresh) renderTrades(t.key);
  }
  function fromPosition(x) {
    return { key: 'p:' + (x.id || x.ts + x.wallet), marketId: x.marketId, title: x.marketTitle || x.title, side: x.side, stake: x.stake, price: x.price, who: x.walletShort || '', ts: num(x.ts) || Date.parse(x.ts) };
  }
  var loadingTrades = false, lastLoad = 0;
  function loadTrades() {
    if (loadingTrades || document.hidden || !railVisible || Date.now() - lastLoad < 25000) return;
    loadingTrades = true; lastLoad = Date.now();
    fetch(API + '/positions/recent?limit=40', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      (j && j.recent || []).forEach(function (x) { pushTrade(fromPosition(x), false); });
      renderTrades();
    }).catch(function () {
      var box = $('omdTrades'); if (box && !trades.length) box.innerHTML = '<div class="omd-empty">The tape is offline. It retries automatically.</div>';
    }).then(function () { loadingTrades = false; });
  }
  window.addEventListener('ost:realtime', function (e) {
    var ev = e.detail; if (!ev || ev.type !== 'prediction.fill' || !rail) return;
    var p = ev.payload || {};
    pushTrade({ key: 'r:' + (ev.id || ev.ts), marketId: ev.marketId || p.marketId, title: ev.title || p.marketTitle || p.title, side: p.side || ev.side, stake: ev.amount != null ? ev.amount : p.stake, price: p.price, who: ev.walletShort || p.walletShort || '', ts: num(ev.ts) || Date.parse(ev.ts) || Date.now() }, true);
  });

  function tickets() {
    try { return (window.OST_PREDICTION_API && OST_PREDICTION_API.readOrders && OST_PREDICTION_API.readOrders()) || []; } catch (_) { return []; }
  }
  function renderTickets() {
    var box = $('omdTix'); if (!box) return;
    var list = tickets().slice().sort(function (a, b) { return (num(b.ts) || 0) - (num(a.ts) || 0); }).slice(0, 6);
    if (!list.length) { box.innerHTML = '<div class="omd-empty">No tickets yet. Pick a market and take a side — your open and settled tickets show here.</div>'; return; }
    box.innerHTML = list.map(function (o) {
      var st = String(o.status || 'open').toLowerCase();
      var cls = /won|claim|paid/.test(st) ? 'won' : /lost/.test(st) ? 'lost' : 'open';
      var side = String(o.side || o.outcomeKey || '').toLowerCase() === 'no' ? 'n' : 'y';
      return '<div class="omd-row" data-mid="' + esc(o.marketId || '') + '">' +
        '<span class="omd-side ' + side + '">' + (side === 'y' ? 'Yes' : 'No') + '</span>' +
        '<span class="omd-t">' + esc(o.title || o.marketTitle || 'Market') + '</span>' +
        '<span class="omd-a">' + amt(o.stake) + '</span>' +
        '<span class="omd-m"><span class="omd-st ' + cls + '">' + esc(st) + '</span><span>' + ago(num(o.ts) || o.ts) + '</span></span></div>';
    }).join('');
  }
  ['ost:prediction:order-changed', 'ost:prediction-update', 'ost:balance'].forEach(function (n) {
    window.addEventListener(n, function () { if (rail) renderTickets(); });
  });

  /* ---------------------------------------------------------------- legacy modal → market page */
  function patchModal() {
    var M = window.OST_MARKET_MODAL;
    if (!M || typeof M.open !== 'function' || M.open.__omd) return !!M;
    var orig = M.open;
    var wrapped = function (arg) {
      if (desk && window.OST_PREDICT_MOBILE && OST_PREDICT_MOBILE.openMarket) {
        var m = (arg && typeof arg === 'object') ? arg : findMarket(arg);
        if (m) { openOnDesk(m); return; }
      }
      return orig.apply(this, arguments);
    };
    wrapped.__omd = true;
    M.open = wrapped;
    return true;
  }
  function openOnDesk(m) {
    try { if (window.OST_COMPARTMENTS) OST_COMPARTMENTS.activate('wallet', false); } catch (_) {}
    try { if (window.setWalletPanel) window.setWalletPanel('predict'); } catch (_) {}
    setTimeout(function () {
      try { OST_PREDICT_MOBILE.openMarket(m); } catch (_) {}
      try { history.replaceState(null, '', '#markets'); } catch (_) {}
    }, 80);
  }

  /* ---------------------------------------------------------------- boot */
  function watch() {
    host = $('ostPredictMobile'); if (!host) return false;
    applyMode();
    // The module rewrites #opmDetail on every market open: re-split each time.
    new MutationObserver(function () { if (desk) splitDetail(); }).observe($('opmDetail'), { childList: true });
    return true;
  }
  function boot() {
    var tries = 0;
    (function wait() {
      if (watch()) return;
      if (++tries < 60) setTimeout(wait, 250);
    })();
    var mt = 0; (function waitModal() { if (!patchModal() && ++mt < 40) setTimeout(waitModal, 300); })();
    var rt = 0;
    window.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(function () { applyMode(); fitCanvases(); }, 180); });
    setInterval(function () { if (railVisible && !document.hidden) loadTrades(); }, 30000);
  }

  window.OST_MARKETS_DESK = { open: function (idOrMarket) { var m = typeof idOrMarket === 'object' ? idOrMarket : findMarket(idOrMarket); if (m) openOnDesk(m); }, refresh: applyMode };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();

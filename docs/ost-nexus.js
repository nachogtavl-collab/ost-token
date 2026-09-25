/* ==========================================================================
 * OST Nexus — the living home + a HUD that reaches every area.
 *
 *   · Living OST panel   model price (odometer + sparkline), your OSTC/OSTG,
 *                        network vitals, live BTC
 *   · Pulse              real network events (bets, faucet claims, new coins,
 *                        game results) streamed across the home; each one pings
 *                        the globe
 *   · Universe           one tile per area, with a live line where data exists
 *   · Command palette    Ctrl/Cmd+K or "/" — jump anywhere, open any market,
 *                        or hand the question to Ghost
 *   · Dock (desktop)     one bar for price, balance and every tool that used to
 *                        float in its own corner
 *
 * HONESTY: every number comes from a real source or renders "—". The OST price
 * is the worker's MODEL price (FX-anchored, moved by activity + BTC mood) and is
 * labelled so. Launchpad seed coins (creator ost-genesis / id seed-*) are never
 * shown as "new". Game results are self-reported by players' browsers and are
 * tagged as such.
 * ========================================================================== */
(function () {
  'use strict';
  if (window.OST_NEXUS) return;

  var API = String(window.OST_API_BASE || 'https://ost-api.nachogtavl.workers.dev').replace(/\/+$/, '');
  var RM = false;
  try { RM = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (_) {}
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
  function compact(n) {
    n = num(n); if (n === undefined) return '—';
    var a = Math.abs(n);
    if (a >= 1e9) return (n / 1e9).toFixed(a >= 1e10 ? 0 : 1) + 'B';
    if (a >= 1e6) return (n / 1e6).toFixed(a >= 1e7 ? 0 : 1) + 'M';
    if (a >= 1e4) return (n / 1e3).toFixed(a >= 1e5 ? 0 : 1) + 'K';
    return Math.round(n).toLocaleString();
  }
  function fmtOst(p) {
    p = num(p); if (p === undefined) return '—';
    return '$' + (p >= 1 ? p.toFixed(3) : p >= 0.01 ? p.toFixed(4) : p.toFixed(6));
  }
  function fmtUsd0(p) { p = num(p); return p === undefined ? '—' : '$' + Math.round(p).toLocaleString(); }
  function fmtAmt(v) {
    v = num(v); if (v === undefined) return '—';
    return v >= 1e5 ? compact(v) : v.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: v < 1000 ? 2 : 0 });
  }
  function ago(ts) {
    var t = typeof ts === 'number' ? ts : Date.parse(ts);
    if (!Number.isFinite(t)) return '';
    var s = Math.max(0, Math.round((Date.now() - t) / 1000));
    if (s < 45) return 'now';
    if (s < 3600) return Math.round(s / 60) + 'm';
    if (s < 86400) return Math.round(s / 3600) + 'h';
    return Math.round(s / 86400) + 'd';
  }
  function shortAddr(w) {
    w = String(w || ''); if (!w) return 'someone';
    return w.length > 10 ? w.slice(0, 4) + '…' + w.slice(-4) : w;
  }
  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (_) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} }

  // Count THROUGH values (odometer feel) instead of jumping.
  function tween(el, to, fmt, dur) {
    if (!el) return;
    var from = el.__nxV;
    el.__nxV = to;
    if (RM || from === undefined || !Number.isFinite(from) || !Number.isFinite(to) || from === to) { el.textContent = fmt(to); return; }
    var t0 = performance.now(); dur = dur || 650;
    cancelAnimationFrame(el.__nxRaf);
    (function frame(t) {
      var k = Math.min(1, (t - t0) / dur); k = 1 - Math.pow(1 - k, 3);
      el.textContent = fmt(from + (to - from) * k);
      if (k < 1) el.__nxRaf = requestAnimationFrame(frame);
    })(t0);
  }

  // Is the home hero on screen? Gates polling + animation so hidden work is free.
  var homeVisible = false;
  function onHomeVisibility(fn) {
    var home = $('home'); if (!home || !('IntersectionObserver' in window)) { homeVisible = true; fn(true); return; }
    new IntersectionObserver(function (en) {
      var v = en.some(function (e) { return e.isIntersecting; });
      if (v !== homeVisible) { homeVisible = v; fn(v); }
    }).observe(home);
  }

  /* ======================================================================
   * Navigation — one door into every area
   * ==================================================================== */
  function waitFor(test, cb, ms) {
    var t0 = Date.now();
    (function poll() {
      var v; try { v = test(); } catch (_) {}
      if (v) { cb(v); return; }
      if (Date.now() - t0 > (ms || 8000)) return;
      setTimeout(poll, 150);
    })();
  }
  function flushLazy() { try { if (window.OST_LAZY && OST_LAZY.flush) OST_LAZY.flush(); } catch (_) {} }
  function activate(id) {
    try { if (window.OST_COMPARTMENTS && OST_COMPARTMENTS.activate) { OST_COMPARTMENTS.activate(id, true); return true; } } catch (_) {}
    location.hash = '#' + id; return false;
  }
  function openWalletPanel(panel) {
    activate('wallet');
    setTimeout(function () { try { if (window.setWalletPanel) window.setWalletPanel(panel, { scroll: true }); } catch (_) {} }, 60);
  }
  function go(target, arg) {
    switch (target) {
      case 'markets':
        try { if (window.OST_COMPARTMENTS) OST_COMPARTMENTS.activate('wallet', false); } catch (_) {}
        try { if (window.setWalletPanel) window.setWalletPanel('predict'); } catch (_) {}
        try { if (isMobile() && window.OST_PREDICT_MOBILE && OST_PREDICT_MOBILE.showBrowse) OST_PREDICT_MOBILE.showBrowse(); } catch (_) {}
        setTimeout(function () {
          try { history.replaceState(null, '', '#markets'); } catch (_) {}
          var el = $('ostPredictMobile') || $('wallet-panel-predict');
          if (el && el.offsetParent !== null) el.scrollIntoView({ block: 'start', behavior: RM ? 'auto' : 'smooth' });
        }, 120);
        return;
      case 'market':
        if (!arg) return go('markets');
        if (isMobile() && window.OST_PREDICT_MOBILE && OST_PREDICT_MOBILE.openMarket) { go('markets'); setTimeout(function () { try { OST_PREDICT_MOBILE.openMarket(arg); } catch (_) {} }, 200); return; }
        // Desktop: select the market on the board itself (the desk's own path).
        // OST_MARKET_MODAL opened directly renders squashed on desktop (pre-existing).
        go('markets');
        var mid = String(arg.id || arg);
        waitFor(function () {
          var list = $('predictionMarketList'); if (!list) return null;
          return list.querySelector('.prediction-market-card[data-prediction-market-id="' + (window.CSS && CSS.escape ? CSS.escape(mid) : mid) + '"]') ||
            (/^ost-btc5m/.test(mid) ? list.querySelector('.prediction-market-card[data-prediction-market-id^="ost-btc5m"]') : null);
        }, function (card) { card.click(); }, 4000);
        return;
      case 'wallet': return openWalletPanel(arg || 'access');
      case 'convert': return openWalletPanel('convert');
      case 'connect': {
        var b = $('walletBtn'); if (b) b.click(); else openWalletPanel('access');
        return;
      }
      case 'mesh':
        if (window.OST_MESH && OST_MESH.open) return OST_MESH.open();
        flushLazy(); waitFor(function () { return window.OST_MESH && OST_MESH.open; }, function () { OST_MESH.open(); });
        return;
      case 'ghost':
        waitFor(function () { return window.OST_GHOST_COMPANION && OST_GHOST_COMPANION.open; }, function () {
          OST_GHOST_COMPANION.open();
          if (arg) setTimeout(function () { try { OST_GHOST_COMPANION.ask(arg); } catch (_) {} }, 250);
        }, 6000);
        return;
      case 'academy':
        if (typeof window.OST_OPEN_CODE_ACADEMY === 'function') return window.OST_OPEN_CODE_ACADEMY();
        flushLazy(); waitFor(function () { return typeof window.OST_OPEN_CODE_ACADEMY === 'function'; }, function () { window.OST_OPEN_CODE_ACADEMY(); });
        return;
      case 'world':
        if (window.OST_WORLD && OST_WORLD.open) return OST_WORLD.open();
        waitFor(function () { return window.OST_WORLD && OST_WORLD.open; }, function () { OST_WORLD.open(); }, 5000);
        return;
      case 'trade': if (window.OST_TRADE_POPOUT) { OST_TRADE_POPOUT.toggle(); } return;
      case 'parlay':
        if (window.OST_PARLAY && OST_PARLAY.open) return OST_PARLAY.open();
        var pd = $('ostParlayDock'); if (pd) pd.click();
        return;
      case 'card': if (window.OST_CARD && OST_CARD.openFullCard) OST_CARD.openFullCard(); return;
      case 'flagship':
        if (isMobile() && window.OST_PREDICT_MOBILE && OST_PREDICT_MOBILE.openFlagship) { go('markets'); setTimeout(function () { try { OST_PREDICT_MOBILE.openFlagship(); } catch (_) {} }, 200); return; }
        var btc = nativeMarkets().filter(function (m) { return /^ost-btc5m/.test(String(m.id || '')); })[0];
        return go('market', btc || null);
      case 'home':
        activate('home'); window.scrollTo({ top: 0, behavior: RM ? 'auto' : 'smooth' }); return;
      default:
        activate(target);
    }
  }

  /* ======================================================================
   * Living OST: model price, sparkline, balances, vitals, BTC
   * ==================================================================== */
  var HIST_KEY = 'ost.nexus.px.v1';
  var hist = lsGet(HIST_KEY, []);
  if (!Array.isArray(hist)) hist = [];
  var lastPx;

  function recordPrice(price, ts) {
    var t = Date.parse(ts); if (!Number.isFinite(t)) t = Date.now();
    var last = hist[hist.length - 1];
    if (last && (t - last[0] < 20000) && last[1] === price) return;
    if (last && t <= last[0]) { if (last[1] !== price) last[1] = price; }
    else hist.push([t, price]);
    if (hist.length > 240) hist = hist.slice(-240);
    lsSet(HIST_KEY, hist);
  }

  function drawSpark() {
    var c = $('nxOstSpark'); if (!c) return;
    var w = c.clientWidth, h = c.clientHeight; if (!w || !h) return;
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    if (c.width !== Math.round(w * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    var x = c.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, w, h);
    var pts = hist.slice(-120);
    if (pts.length < 2) {
      x.setLineDash([3, 5]); x.strokeStyle = 'rgba(165,180,207,.35)'; x.lineWidth = 1.2;
      x.beginPath(); x.moveTo(0, h / 2); x.lineTo(w, h / 2); x.stroke(); x.setLineDash([]);
      return;
    }
    var lo = Infinity, hi = -Infinity;
    pts.forEach(function (p) { lo = Math.min(lo, p[1]); hi = Math.max(hi, p[1]); });
    var pad = (hi - lo) * 0.18 || hi * 0.002 || 1; lo -= pad; hi += pad;
    var t0 = pts[0][0], t1 = pts[pts.length - 1][0] || t0 + 1;
    var X = function (t) { return 2 + (t - t0) / Math.max(1, t1 - t0) * (w - 6); };
    var Y = function (v) { return 3 + (1 - (v - lo) / (hi - lo)) * (h - 6); };
    var up = pts[pts.length - 1][1] >= pts[0][1];
    var col = up ? '52,211,153' : '251,113,133';
    var g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, 'rgba(' + col + ',.28)'); g.addColorStop(1, 'rgba(' + col + ',0)');
    x.beginPath(); x.moveTo(X(pts[0][0]), h);
    pts.forEach(function (p) { x.lineTo(X(p[0]), Y(p[1])); });
    x.lineTo(X(pts[pts.length - 1][0]), h); x.closePath(); x.fillStyle = g; x.fill();
    x.beginPath(); pts.forEach(function (p, i) { i ? x.lineTo(X(p[0]), Y(p[1])) : x.moveTo(X(p[0]), Y(p[1])); });
    x.strokeStyle = 'rgb(' + col + ')'; x.lineWidth = 1.8; x.lineJoin = 'round'; x.stroke();
    var lx = X(pts[pts.length - 1][0]), ly = Y(pts[pts.length - 1][1]);
    x.beginPath(); x.arc(lx, ly, 3, 0, 7); x.fillStyle = 'rgb(' + col + ')'; x.fill();
  }

  function renderPrice() {
    var meta = null;
    try { meta = window.OST && OST.getMeta ? OST.getMeta() : null; } catch (_) {}
    var pxEl = $('nxOstPx'), chEl = $('nxOstChg'), dot = $('nxOstDot');
    if (!pxEl) return;
    if (!meta || !Number.isFinite(meta.price)) {
      if (dot) dot.classList.remove('is-live');
      return;
    }
    if (lastPx !== undefined && meta.price !== lastPx && !RM) {
      pxEl.classList.remove('flash-up', 'flash-down'); void pxEl.offsetWidth;
      pxEl.classList.add(meta.price > lastPx ? 'flash-up' : 'flash-down');
    }
    lastPx = meta.price;
    tween(pxEl, meta.price, fmtOst, 900);
    var ch = num(meta.change24h);
    if (chEl) {
      chEl.className = 'nx-chg' + (ch === undefined ? '' : ch >= 0 ? ' up' : ' down');
      chEl.textContent = ch === undefined ? '—' : (ch >= 0 ? '▲ ' : '▼ ') + Math.abs(ch).toFixed(2) + '% 24h';
    }
    if (dot) dot.classList.toggle('is-live', meta.ageMs < 6 * 60000);
    recordPrice(meta.price, meta.ts);
    var hEl = $('nxOstHist');
    if (hEl) hEl.textContent = hist.length < 2 ? 'Collecting price history…' : hist.length + ' readings since ' + new Date(hist[0][0]).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    renderAge();
    drawSpark();
    renderDock();
  }
  function renderAge() {
    var el = $('nxOstAge'); if (!el) return;
    var meta = null; try { meta = OST.getMeta(); } catch (_) {}
    el.textContent = meta ? 'updated ' + ago(Date.now() - meta.ageMs) + (ago(Date.now() - meta.ageMs) === 'now' ? '' : ' ago') : '';
  }

  function walletConnected() {
    try { if (window.OST_WALLET && OST_WALLET.ready && OST_WALLET.ready()) return true; } catch (_) {}
    return !!window.OST_WALLET_PUBKEY;
  }
  function balances() {
    var B = window.OST_BALANCE, out = { ostc: undefined, ostg: undefined };
    if (!B) return out;
    try {
      out.ostc = num(B.onchainOstc());
      var a = num(B.onchainOstg()), p = num(B.play());
      out.ostg = (a === undefined && p === undefined) ? undefined : (a || 0) + (p || 0);
    } catch (_) {}
    return out;
  }
  function renderBalances() {
    var b = balances(), conn = walletConnected();
    tween($('nxBalOstc'), b.ostc, function (v) { return v === undefined ? '—' : fmtAmt(v); });
    tween($('nxBalOstg'), b.ostg, function (v) { return v === undefined ? '—' : fmtAmt(v); });
    var cb = $('nxConnect'); if (cb) cb.hidden = conn;
    renderDock();
  }

  var statsTimer = 0, statsAt = 0;
  function fetchStats() {
    if (document.hidden || !homeVisible) return;
    if (Date.now() - statsAt < 110000) return;
    statsAt = Date.now();
    fetch(API + '/ost/stats', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      if (!j) return;
      tween($('nxStWallets'), num(j.activeWallets24h), function (v) { return v === undefined ? '—' : compact(v); });
      tween($('nxStTx'), num(j.tx24h), function (v) { return v === undefined ? '—' : compact(v); });
    }).catch(function () {});
  }

  var btcPx;
  function onBtc(p) {
    p = num(p); if (p === undefined || p <= 0) return;
    btcPx = p;
    tween($('nxBtc'), p, fmtUsd0, 500);
    setLive('markets', 'BTC ' + fmtUsd0(p) + ' · 5-min round live');
  }

  /* ======================================================================
   * Pulse — real events only
   * ==================================================================== */
  var events = [];
  var seen = {};
  var KIND_COL = { bet: '#7fd8ff', faucet: '#34d399', coin: '#f5c468', game: '#a78bfa' };

  function isSeedCoin(o) {
    o = o || {}; var p = o.payload || {};
    var id = String(o.id || o.coinId || p.id || p.coinId || '');
    var creator = String(o.creator || p.creator || '');
    return /^seed-/.test(id) || creator === 'ost-genesis';
  }

  function fromRealtime(e) {
    if (!e || !e.type) return null;
    var p = e.payload || {};
    var who = e.walletShort || p.walletShort || shortAddr(e.wallet || p.wallet);
    var amt = num(e.amount != null ? e.amount : (p.stake != null ? p.stake : p.amount));
    var title = e.title || p.marketTitle || p.title || '';
    switch (e.type) {
      case 'prediction.fill': {
        var side = String(p.side || e.side || '').toUpperCase();
        return { kind: 'bet', tag: 'bet', html: '<b>' + esc(who) + '</b> ' + (side ? 'took <b>' + esc(side) + '</b> on ' : 'traded ') + esc(trim(title, 48) || 'a market') + (amt ? ' · ' + fmtAmt(amt) + ' OST' : '') };
      }
      case 'prediction.resolved':
        return { kind: 'bet', tag: 'settled', html: esc(trim(title, 56) || 'A market') + ' <b>settled</b>' + (p.outcome ? ' · ' + esc(String(p.outcome).toUpperCase()) : '') };
      case 'faucet.claim':
        return { kind: 'faucet', tag: 'faucet', html: '<b>' + esc(who) + '</b> claimed' + (amt ? ' <b>' + fmtAmt(amt) + ' OST</b>' : '') + ' from the faucet' };
      case 'game.result':
        return { kind: 'game', tag: 'game', html: esc(trim(e.message || title || (who + ' finished a game'), 60)) + ' <span class="t">self-reported</span>' };
      case 'launchpad.coin':
        if (isSeedCoin(e)) return null;
        return { kind: 'coin', tag: 'new coin', html: '<b>$' + esc(e.symbol || p.symbol || '???') + '</b> launched' + (p.name || e.title ? ' · ' + esc(trim(p.name || e.title, 28)) : '') };
      case 'launchpad.trade':
        if (isSeedCoin(e)) return null;
        return { kind: 'coin', tag: 'trade', html: '<b>' + esc(who) + '</b> traded <b>$' + esc(e.symbol || p.symbol || '???') + '</b>' + (amt ? ' · ' + fmtAmt(amt) + ' OST' : '') };
      default: return null;
    }
  }
  function trim(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; }

  function addEvent(ev, id, ts, live) {
    if (!ev) return;
    var key = id || (ev.kind + ev.html);
    if (seen[key]) return; seen[key] = 1;
    ev.ts = ts || Date.now(); ev.fresh = !!live;
    events.unshift(ev);
    events.sort(function (a, b) { return b.ts - a.ts; });
    events = events.slice(0, 16);
    renderPulse();
    if (live) {
      ripple(KIND_COL[ev.kind]);
      if (ev.kind === 'game') setLive('games', 'Latest: ' + ev.html.replace(/<[^>]+>/g, '').replace(' self-reported', ''));
      if (ev.kind === 'faucet') setLive('faucet', 'Last faucet claim just now');
      if (ev.kind === 'coin' && ev.tag === 'new coin') setLive('launchpad', 'Newest: ' + ev.html.replace(/<[^>]+>/g, ''));
    }
  }

  var pulseX = 0, pulseRaf = 0, pulseW = 0, pulseVisible = false;
  function renderPulse() {
    var list = $('nxPulseList'); if (!list || !events.length) return;
    var html = events.map(function (e) {
      return '<span class="nx-ev' + (e.fresh ? ' is-new' : '') + '"><i class="' + e.kind + '">' + esc(e.tag) + '</i>' + e.html + ' <span class="t">' + ago(e.ts) + '</span></span>';
    }).join('');
    events.forEach(function (e) { e.fresh = false; });
    // Two copies so the strip loops seamlessly.
    list.innerHTML = html + (RM ? '' : html);
    pulseW = RM ? 0 : list.scrollWidth / 2;
    if (!RM) startPulse();
  }
  function startPulse() {
    if (pulseRaf || RM || !pulseVisible || document.hidden) return;
    var last = performance.now();
    (function step(t) {
      var list = $('nxPulseList');
      if (!list || !pulseVisible || document.hidden) { pulseRaf = 0; return; }
      pulseX -= (t - last) * 0.035; last = t;
      if (pulseW && -pulseX >= pulseW) pulseX += pulseW;
      list.style.transform = 'translate3d(' + pulseX.toFixed(1) + 'px,0,0)';
      pulseRaf = requestAnimationFrame(step);
    })(last);
  }

  function ripple(col) {
    if (RM || !homeVisible || document.hidden) return;
    var wrap = $('heroGlobeWrap'); if (!wrap || !wrap.clientWidth) return;
    var r = document.createElement('span'); r.className = 'nx-ripple';
    var a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * 0.28;
    r.style.left = (50 + Math.cos(a) * d * 100) + '%';
    r.style.top = (50 + Math.sin(a) * d * 100) + '%';
    r.style.setProperty('--rc', col || '#7fd8ff');
    wrap.appendChild(r);
    setTimeout(function () { r.remove(); }, 1700);
  }

  var seeded = false;
  function seedPulse() {
    if (seeded) return; seeded = true;
    fetch(API + '/positions/recent?limit=12', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      (j && j.recent || []).forEach(function (x) {
        var side = String(x.side || '').toUpperCase();
        addEvent({ kind: 'bet', tag: 'bet', html: '<b>' + esc(x.walletShort || shortAddr(x.wallet)) + '</b> ' + (side ? 'took <b>' + esc(side) + '</b> on ' : 'traded ') + esc(trim(x.marketTitle || x.title, 48) || 'a market') + (num(x.stake) ? ' · ' + fmtAmt(x.stake) + ' OST' : '') }, 'pos:' + x.id, num(x.ts) || Date.parse(x.ts), false);
      });
      if (!events.length) { var l = $('nxPulseList'); if (l) l.innerHTML = '<span class="nx-pulse__empty">Quiet right now. New bets, claims and coins appear here the moment they happen.</span>'; }
    }).catch(function () {
      var l = $('nxPulseList'); if (l && !events.length) l.innerHTML = '<span class="nx-pulse__empty">Pulse is offline. It reconnects automatically.</span>';
    });
    fetch(API + '/launchpad/coins', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      var coins = (j && j.coins || []).filter(function (c) { return !isSeedCoin(c); });
      coins.sort(function (a, b) { return (num(b.createdAt) || Date.parse(b.createdAt) || 0) - (num(a.createdAt) || Date.parse(a.createdAt) || 0); });
      launchCoins = coins.slice(0, 30);
      if (coins[0]) setLive('launchpad', 'Newest: $' + coins[0].symbol + (coins[0].name ? ' · ' + trim(coins[0].name, 22) : ''));
    }).catch(function () {});
  }

  function setLive(key, text) {
    var el = document.querySelector('[data-nx-live="' + key + '"]');
    if (el && el.textContent !== text) el.textContent = text;
  }

  /* ======================================================================
   * Universe tiles
   * ==================================================================== */
  function wireTiles() {
    var grid = $('nxUniverse'); if (!grid) return;
    grid.addEventListener('click', function (e) {
      var t = e.target.closest('[data-nx-go]'); if (t) { go(t.getAttribute('data-nx-go')); return; }
      if (e.target.closest('[data-nx-palette]')) openPalette();
    });
    grid.addEventListener('pointermove', function (e) {
      var t = e.target.closest('.nx-tile'); if (!t) return;
      var r = t.getBoundingClientRect();
      t.style.setProperty('--mx', ((e.clientX - r.left) / r.width * 100).toFixed(1) + '%');
      t.style.setProperty('--my', ((e.clientY - r.top) / r.height * 100).toFixed(1) + '%');
    }, { passive: true });
    setLive('ghost', 'Ready · ask about your bets');
    setLive('world', 'Or tap the globe');
    var nc = $('nxConnect'); if (nc) nc.addEventListener('click', function () { go('connect'); });
  }

  /* ======================================================================
   * Command palette
   * ==================================================================== */
  var launchCoins = [];
  var I = {
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
    trend: '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
    bolt: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
    wallet: '<path d="M3 7h18v12H3z"/><path d="M16 13h2M3 10h18"/>',
    ghost: '<path d="M5 20V11a7 7 0 0114 0v9l-2.5-2-2.3 2-2.2-2-2.2 2-2.3-2z"/>',
    coin: '<circle cx="12" cy="12" r="8"/><path d="M9.5 12h5M12 9.5v5"/>',
    grid: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
    ticket: '<path d="M4 8a2 2 0 012-2h12a2 2 0 012 2 2 2 0 000 4 2 2 0 000 4 2 2 0 01-2 2H6a2 2 0 01-2-2 2 2 0 000-4 2 2 0 000-4z"/>',
    layers: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18"/>',
    mesh: '<circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="7" r="2.5"/><circle cx="12" cy="18" r="2.5"/><path d="M8.2 7h7.4M7.3 8.2l3.6 7.6M16.8 9.2l-3.6 6.6"/>',
    code: '<path d="M8 9l-4 3 4 3M16 9l4 3-4 3M13.5 6l-3 12"/>',
    cart: '<path d="M3 4h2l2.4 11h11L21 7H6.2"/><circle cx="9" cy="19.5" r="1.3"/><circle cx="17" cy="19.5" r="1.3"/>',
    game: '<rect x="3" y="7" width="18" height="11" rx="4"/><path d="M8 11v3M6.5 12.5h3"/>',
    rocket: '<path d="M12 2c3 3 4 7 3 11l-3 3-3-3C8 9 9 5 12 2z"/><path d="M10 20h4"/>',
    arrow: '<path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 17v3h16v-3"/>'
  };
  function svg(k) { return '<svg class="nx-ic" viewBox="0 0 24 24">' + (I[k] || I.grid) + '</svg>'; }

  function nativeMarkets() {
    try { return (typeof window.buildOstNativeMarkets === 'function' && window.buildOstNativeMarkets()) || []; } catch (_) { return []; }
  }

  function staticItems() {
    var items = [
      { id: 'a:markets', grp: 'Go to', ico: 'trend', t: 'Prediction markets', s: 'Crypto, politics, sports — Polymarket and Kalshi grade', run: function () { go('markets'); }, kw: 'bet predict polymarket kalshi odds' },
      { id: 'a:flagship', grp: 'Go to', ico: 'bolt', t: 'BTC 5-minute round', s: 'Will BTC be higher in 5 minutes?', run: function () { go('flagship'); }, kw: 'bitcoin btc fast up down' },
      { id: 'a:mirror', grp: 'Go to', ico: 'layers', t: 'Market mirror', s: 'Real-world markets mirrored in OST', run: function () { go('stock-market'); }, kw: 'stocks equities mirror' },
      { id: 'a:games', grp: 'Go to', ico: 'game', t: 'Fair games', s: 'Crash, dice, plinko, duels — provably fair', run: function () { go('games'); }, kw: 'casino stake rainbet duel crash dice plinko' },
      { id: 'a:launchpad', grp: 'Go to', ico: 'rocket', t: 'Launchpad', s: 'Launch or trade memecoins on a bonding curve', run: function () { go('launchpad'); }, kw: 'memecoin pump token create' },
      { id: 'a:mesh', grp: 'Go to', ico: 'mesh', t: 'Mesh', s: 'Chats, stories, groups, calls', run: function () { go('mesh'); }, kw: 'social chat message friends stories' },
      { id: 'a:ghost', grp: 'Go to', ico: 'ghost', t: 'Ghost AI', s: 'Your companion', run: function () { go('ghost'); }, kw: 'ai assistant help' },
      { id: 'a:academy', grp: 'Go to', ico: 'code', t: 'Code Academy', s: 'Learn to code, earn OST', run: function () { go('academy'); }, kw: 'learn course programming' },
      { id: 'a:shop', grp: 'Go to', ico: 'cart', t: 'Shop', s: 'Goods, gift cards, fuel', run: function () { go('commerce'); }, kw: 'buy store commerce gift card gas' },
      { id: 'a:world', grp: 'Go to', ico: 'globe', t: 'OST World', s: 'Browse the open web', run: function () { go('world'); }, kw: 'browser internet web' },
      { id: 'x:connect', grp: 'Do', ico: 'wallet', t: 'Connect wallet', s: 'Phantom, Solflare or an OST wallet', run: function () { go('connect'); }, kw: 'login sign in phantom solflare' },
      { id: 'x:faucet', grp: 'Do', ico: 'arrow', t: 'Claim free OST', s: 'Faucet and first balance', run: function () { go('new-here'); }, kw: 'faucet free get ost start' },
      { id: 'x:convert', grp: 'Do', ico: 'coin', t: 'Convert SOL ↔ OST', s: 'Swap and transfer rail', run: function () { go('convert'); }, kw: 'swap exchange buy ost sol' },
      { id: 'x:trade', grp: 'Do', ico: 'ticket', t: 'Open trade ticket', s: 'Quick buy / sell', run: function () { go('trade'); }, kw: 'ticket order' },
      { id: 'x:parlay', grp: 'Do', ico: 'layers', t: 'Build a parlay', s: 'Combine outcomes', run: function () { go('parlay'); }, kw: 'combo multi' },
      { id: 'x:card', grp: 'Do', ico: 'ticket', t: 'OST Tap Ticket', s: 'Your pay card', run: function () { go('card'); }, kw: 'card pay tap' }
    ];
    try {
      (window.OST_COMPARTMENTS && OST_COMPARTMENTS.sections || []).forEach(function (s) {
        if (/^(home|games|commerce|launchpad|stock-market|wallet|new-here)$/.test(s.id)) return;
        items.push({ id: 's:' + s.id, grp: 'Go to', ico: 'grid', t: s.label, s: s.desc || '', run: function () { go(s.id); }, kw: s.id });
      });
    } catch (_) {}
    items.push({ id: 's:wallet', grp: 'Go to', ico: 'wallet', t: 'Wallet', s: 'Balances, receive, back up', run: function () { go('wallet'); }, kw: 'balance' });
    items.push({ id: 's:home', grp: 'Go to', ico: 'globe', t: 'Home', s: 'The living OST', run: function () { go('home'); }, kw: 'start' });
    return items;
  }
  function dynamicItems() {
    var out = [];
    nativeMarkets().slice(0, 40).forEach(function (m) {
      if (!m || !m.title) return;
      var yes = num(m.yesPriceNumber);
      out.push({ id: 'm:' + m.id, grp: 'Markets', ico: 'trend', t: m.title, s: (yes !== undefined ? 'YES ' + Math.round(yes * 100) + '¢ · ' : '') + (m.topic || 'market'), run: function () { go('market', m); }, kw: (m.topic || '') + ' market' });
    });
    launchCoins.forEach(function (c) {
      out.push({ id: 'c:' + (c.id || c.mint), grp: 'Coins', ico: 'rocket', t: '$' + c.symbol + (c.name ? ' · ' + c.name : ''), s: 'Launchpad coin' + (num(c.holderCount) ? ' · ' + c.holderCount + ' holders' : ''), run: function () { go('launchpad'); }, kw: 'coin token memecoin' });
    });
    return out;
  }

  // Fuzzy subsequence match; rewards word starts and runs. Returns [score, matchedIdx] or null.
  function match(q, text) {
    var t = text.toLowerCase(), i = 0, j = 0, score = 0, run = 0, idx = [];
    for (; i < q.length; i++) {
      var ch = q[i]; if (ch === ' ') { run = 0; continue; }
      var k = t.indexOf(ch, j); if (k < 0) return null;
      var start = k === 0 || /[\s\-·:$(]/.test(t[k - 1]);
      run = (k === j) ? run + 1 : 0;
      score += 1 + (start ? 6 : 0) + run * 3 - Math.min(8, (k - j) * 0.5);
      idx.push(k); j = k + 1;
    }
    if (t.indexOf(q) >= 0) score += 12;
    return [score - t.length * 0.01, idx];
  }
  function hl(text, idx) {
    if (!idx || !idx.length) return esc(text);
    var set = {}; idx.forEach(function (k) { set[k] = 1; });
    var out = ''; for (var i = 0; i < text.length; i++) out += set[i] ? '<mark>' + esc(text[i]) + '</mark>' : esc(text[i]);
    return out;
  }

  var pal = null, palSel = 0, palItems = [], palPrevFocus = null;
  var RECENT_KEY = 'ost.nexus.recent.v1';

  function buildPalette() {
    var scrim = document.createElement('div');
    scrim.className = 'nx-pal-scrim';
    scrim.innerHTML =
      '<div class="nx-pal" role="dialog" aria-modal="true" aria-label="Search OST">' +
        '<div class="nx-pal__in">' + svg('search') +
          '<input type="text" autocomplete="off" spellcheck="false" placeholder="Search markets, games, coins — or ask Ghost" aria-label="Search OST" aria-controls="nxPalList" role="combobox" aria-expanded="true">' +
          '<kbd>Esc</kbd></div>' +
        '<div class="nx-pal__list" id="nxPalList" role="listbox"></div>' +
        '<div class="nx-pal__foot"><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>Enter</kbd> open</span><span><kbd>Esc</kbd> close</span></div>' +
      '</div>';
    document.body.appendChild(scrim);
    var input = scrim.querySelector('input'), list = scrim.querySelector('.nx-pal__list');
    input.addEventListener('input', function () { palSel = 0; renderPal(); });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); palSel = Math.min(palItems.length - 1, palSel + 1); paintSel(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); palSel = Math.max(0, palSel - 1); paintSel(); }
      else if (e.key === 'Enter') { e.preventDefault(); pick(palSel); }
      else if (e.key === 'Escape') { e.preventDefault(); closePalette(); }
      else if (e.key === 'Tab') { e.preventDefault(); }
    });
    list.addEventListener('click', function (e) { var b = e.target.closest('[data-i]'); if (b) pick(+b.getAttribute('data-i')); });
    list.addEventListener('mousemove', function (e) { var b = e.target.closest('[data-i]'); if (b && +b.getAttribute('data-i') !== palSel) { palSel = +b.getAttribute('data-i'); paintSel(); } });
    scrim.addEventListener('mousedown', function (e) { if (e.target === scrim) closePalette(); });
    return { scrim: scrim, input: input, list: list };
  }

  function renderPal() {
    var q = pal.input.value.trim().toLowerCase();
    var all = staticItems().concat(dynamicItems());
    var res = [];
    if (!q) {
      var recent = lsGet(RECENT_KEY, []);
      var byId = {}; all.forEach(function (it) { byId[it.id] = it; });
      recent.forEach(function (id) { if (byId[id]) res.push({ it: Object.assign({}, byId[id], { grp: 'Recent' }), idx: null }); });
      all.filter(function (it) { return it.grp !== 'Markets' && it.grp !== 'Coins'; }).forEach(function (it) {
        if (recent.indexOf(it.id) < 0) res.push({ it: it, idx: null });
      });
    } else {
      all.forEach(function (it) {
        var m = match(q, it.t), mk = match(q, (it.s || '') + ' ' + (it.kw || ''));
        var sc = m ? m[0] + 8 : mk ? mk[0] * 0.6 : null;
        if (sc !== null) res.push({ it: it, idx: m ? m[1] : null, sc: sc });
      });
      res.sort(function (a, b) { return b.sc - a.sc; });
      // Drop scattered-letter matches once a strong one exists ("btc" ≠ "Brazil … Cup").
      var best = res.length ? res[0].sc : 0;
      res = res.filter(function (r) { return r.sc >= best * 0.45; }).slice(0, 24);
      res.push({ it: { id: 'ghost:q', grp: 'Ask', ico: 'ghost', t: 'Ask Ghost: “' + pal.input.value.trim() + '”', s: 'Ghost answers from your own records first', run: (function (qq) { return function () { go('ghost', qq); }; })(pal.input.value.trim()) }, idx: null });
    }
    palItems = res.map(function (r) { return r.it; });
    var html = '', grp = '';
    res.forEach(function (r, i) {
      if (r.it.grp !== grp) { grp = r.it.grp; html += '<div class="nx-pal__grp" role="presentation">' + esc(grp) + '</div>'; }
      html += '<button type="button" class="nx-pal__it" role="option" id="nxPalOpt' + i + '" data-i="' + i + '"><span class="ico">' + svg(r.it.ico) + '</span><span class="txt">' + hl(r.it.t, r.idx) + (r.it.s ? '<small>' + esc(r.it.s) + '</small>' : '') + '</span><span class="go">↵</span></button>';
    });
    pal.list.innerHTML = html || '<div class="nx-pal__grp">Nothing found</div>';
    paintSel();
  }
  function paintSel() {
    var opts = pal.list.querySelectorAll('[data-i]');
    opts.forEach(function (o) { var on = +o.getAttribute('data-i') === palSel; o.classList.toggle('sel', on); o.setAttribute('aria-selected', on ? 'true' : 'false'); });
    var cur = pal.list.querySelector('[data-i="' + palSel + '"]');
    if (cur) { cur.scrollIntoView({ block: 'nearest' }); pal.input.setAttribute('aria-activedescendant', cur.id); }
  }
  function pick(i) {
    var it = palItems[i]; if (!it) return;
    if (it.id && it.id !== 'ghost:q') {
      var r = lsGet(RECENT_KEY, []).filter(function (x) { return x !== it.id; }); r.unshift(it.id); lsSet(RECENT_KEY, r.slice(0, 5));
    }
    closePalette();
    setTimeout(function () { try { it.run(); } catch (e) { console.warn('[nexus]', e); } }, 30);
  }
  function openPalette(prefill) {
    if (!pal) pal = buildPalette();
    if (pal.scrim.classList.contains('open')) return;
    palPrevFocus = document.activeElement;
    pal.scrim.style.display = 'flex';
    pal.input.value = prefill || '';
    palSel = 0; renderPal();
    requestAnimationFrame(function () { pal.scrim.classList.add('open'); pal.input.focus(); });
  }
  function closePalette() {
    if (!pal) return;
    pal.scrim.classList.remove('open');
    setTimeout(function () { if (!pal.scrim.classList.contains('open')) pal.scrim.style.display = 'none'; }, 150);
    try { if (palPrevFocus && palPrevFocus.focus) palPrevFocus.focus(); } catch (_) {}
  }
  document.addEventListener('keydown', function (e) {
    var k = (e.key || '').toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === 'k') { e.preventDefault(); if (pal && pal.scrim.classList.contains('open')) closePalette(); else openPalette(); return; }
    if (k === '/' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      var t = e.target, tag = (t && t.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || (t && t.isContentEditable)) return;
      e.preventDefault(); openPalette();
    }
  });

  /* ======================================================================
   * Dock (desktop): price, balance, and every tool in one bar
   * ==================================================================== */
  var dock = null;
  function mountDock() {
    if (dock || isMobile()) return;
    dock = document.createElement('div');
    dock.className = 'nx-dock';
    dock.setAttribute('role', 'toolbar');
    dock.setAttribute('aria-label', 'OST dock');
    var btn = function (k, ico, tip) { return '<button type="button" class="nx-dock__btn" data-dk="' + k + '" data-tip="' + tip + '" aria-label="' + tip + '">' + svg(ico) + '</button>'; };
    dock.innerHTML =
      '<button type="button" class="nx-dock__chip" data-dk="home" title="OST model price — FX-anchored index, devnet"><span class="k">OST</span><span class="v" id="nxDkPx">—</span></button>' +
      '<button type="button" class="nx-dock__chip" data-dk="wallet" title="Your on-chain OSTC"><span class="k">Balance</span><span class="v" id="nxDkBal">—</span></button>' +
      '<span class="nx-dock__sep" aria-hidden="true"></span>' +
      btn('markets', 'trend', 'Markets') + btn('trade', 'ticket', 'Trade ticket') + btn('parlay', 'layers', 'Parlay') +
      btn('ghost', 'ghost', 'Ghost AI') + btn('mesh', 'mesh', 'Mesh') + btn('world', 'globe', 'OST World') + btn('card', 'wallet', 'Tap Ticket') +
      '<span class="nx-dock__sep" aria-hidden="true"></span>' +
      '<button type="button" class="nx-dock__search" data-dk="search" aria-label="Search OST">' + svg('search') + '<span>Search</span><kbd>Ctrl K</kbd></button>';
    document.body.appendChild(dock);
    dock.addEventListener('click', function (e) {
      var b = e.target.closest('[data-dk]'); if (!b) return;
      var k = b.getAttribute('data-dk');
      if (k === 'search') openPalette(); else go(k);
    });
    document.documentElement.classList.add('nx-dock-on');
    renderDock();
    requestAnimationFrame(function () { requestAnimationFrame(function () { dock.classList.add('in'); }); });
  }
  function renderDock() {
    if (!dock) return;
    var meta = null; try { meta = OST.getMeta(); } catch (_) {}
    var pe = $('nxDkPx');
    if (pe) {
      if (meta && Number.isFinite(meta.price)) {
        var ch = num(meta.change24h);
        pe.innerHTML = esc(fmtOst(meta.price)) + (ch !== undefined ? '<small style="color:' + (ch >= 0 ? 'var(--nx-up)' : 'var(--nx-down)') + '">' + (ch >= 0 ? '+' : '') + ch.toFixed(1) + '%</small>' : '');
      } else pe.textContent = '—';
    }
    var be = $('nxDkBal');
    if (be) {
      var b = balances();
      be.textContent = walletConnected() ? (b.ostc === undefined ? '—' : fmtAmt(b.ostc) + ' OSTC') : 'Connect';
    }
  }
  var dockMq = window.matchMedia('(max-width: 820px), (pointer: coarse) and (max-width: 1024px)');
  function syncDockForViewport() {
    if (isMobile()) { if (dock) { dock.remove(); dock = null; document.documentElement.classList.remove('nx-dock-on'); } }
    else mountDock();
  }

  /* ======================================================================
   * Boot
   * ==================================================================== */
  function boot() {
    wireTiles();

    // Price
    try { if (window.OST && OST.onPrice) OST.onPrice(function () { renderPrice(); }); } catch (_) {}
    window.addEventListener('ost:price', renderPrice);
    renderPrice(); drawSpark();
    setInterval(function () { if (!document.hidden && homeVisible) renderAge(); }, 30000);
    var rt = 0; window.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(function () { drawSpark(); syncDockForViewport(); }, 150); });
    if (dockMq.addEventListener) dockMq.addEventListener('change', syncDockForViewport);

    // Money
    ['ost:balance', 'ost:wallet-changed', 'ost:wallet-ready', 'ost:wallet-disconnected', 'ost:play:balance', 'ost:tree-changed'].forEach(function (n) {
      window.addEventListener(n, renderBalances);
    });
    renderBalances();

    // BTC
    window.addEventListener('ost:btc-spot', function (e) { onBtc(e.detail && e.detail.price); });
    try { var pb = window.OST_PYTH && OST_PYTH.get && OST_PYTH.get('BTC'); if (pb) onBtc(pb.price); } catch (_) {}

    // Pulse
    window.addEventListener('ost:realtime', function (e) {
      var ev = e.detail; if (!ev) return;
      addEvent(fromRealtime(ev), ev.id, num(ev.ts) || Date.parse(ev.ts) || Date.now(), true);
    });
    var pulse = $('nxPulse');
    if (pulse && 'IntersectionObserver' in window) {
      new IntersectionObserver(function (en) {
        pulseVisible = en.some(function (x) { return x.isIntersecting; });
        if (pulseVisible) { seedPulse(); startPulse(); }
      }).observe(pulse);
    } else { pulseVisible = true; seedPulse(); }
    document.addEventListener('visibilitychange', function () { if (!document.hidden) { startPulse(); fetchStats(); } });

    onHomeVisibility(function (v) { if (v) { fetchStats(); drawSpark(); renderAge(); } });
    statsTimer = setInterval(fetchStats, 120000);

    // Dock after the page has settled — never competes with first paint.
    var dockBoot = function () { setTimeout(syncDockForViewport, 400); };
    if (document.readyState === 'complete') dockBoot(); else window.addEventListener('load', dockBoot, { once: true });
  }

  window.OST_NEXUS = { palette: openPalette, closePalette: closePalette, go: go, pulse: function (ev) { addEvent(ev, null, Date.now(), true); } };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();

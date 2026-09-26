/* ==========================================================================
 * OST Markets Pro — the prediction markets browse, Polymarket-grade.
 *
 *   · Live HUD        markets live · 24h volume · liquidity · live BTC ·
 *                     how fresh the odds are
 *   · Featured hero   top markets by 24h volume, rotating; a REAL price chart
 *                     (Polymarket CLOB prices-history, 1D/1W/1M/All) with a
 *                     crosshair; live Yes/No; Trade buttons
 *   · Cards           real 7-day sparkline, real 7-day change, 24h volume, and
 *                     the market's Polymarket image
 *   · Live odds       visible markets re-priced from CLOB /midpoints every
 *                     ~20s (only while on screen and the tab is visible)
 *   · Sort            Trending · 24h volume · Ending soon · Newest · Movers
 *
 * Everything is additive on top of ost-predict-mobile.js (which still owns
 * rendering, trading and the market page). Data is real or absent: a market
 * without CLOB history shows no sparkline rather than a made-up one.
 * ========================================================================== */
(function () {
  'use strict';
  if (window.OST_MARKETS_PRO) return;

  var API = String(window.OST_API_BASE || 'https://ost-api.nachogtavl.workers.dev').replace(/\/+$/, '');
  var CLOB = 'https://clob.polymarket.com';
  var GAMMA = 'https://gamma-api.polymarket.com';
  var RM = false; try { RM = matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (_) {}
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function num(v) { var n = Number(v); return Number.isFinite(n) ? n : undefined; }
  function money(n) {
    n = num(n); if (n === undefined) return '—';
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(n >= 1e7 ? 1 : 2) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + 'K';
    return '$' + Math.round(n);
  }
  function markets() { try { return Array.isArray(window.__ostPredictionMarkets) ? window.__ostPredictionMarkets : []; } catch (_) { return []; } }
  function byId(id) { id = String(id); var a = markets(); for (var i = 0; i < a.length; i++) if (String(a[i].id) === id) return a[i]; return null; }
  function raw(m, k) { return m && m.raw ? num(m.raw[k]) : undefined; }
  function vol24(m) { var v = raw(m, 'volume24hr'); return v === undefined ? 0 : v; }
  function liq(m) { var v = raw(m, 'liquidityNum'); return v === undefined ? 0 : v; }
  function yesTok(m) {
    var r = m && (m.clobTokenIds || (m.raw && m.raw.clobTokenIds));
    if (typeof r === 'string') { try { r = JSON.parse(r); } catch (_) { r = r.split(','); } }
    var t = Array.isArray(r) ? r[0] : r;
    t = String(t || '').replace(/[^0-9]/g, '');
    return t.length > 20 ? t : '';
  }
  function yesPct(m) {
    var v = liveMid[yesTok(m)];
    if (v === undefined) v = num(m && m.yesPriceNumber);
    return v === undefined ? undefined : v * 100;
  }
  function isPoly(m) { return m && String(m.source) === 'polymarket'; }

  /* ---------------------------------------------------------------- price history (real) */
  var RANGES = { '1d': { interval: '1d', fidelity: 5, label: '1D' }, '1w': { interval: '1w', fidelity: 60, label: '1W' }, '1m': { interval: '1m', fidelity: 360, label: '1M' }, 'max': { interval: 'max', fidelity: 1440, label: 'All' } };
  var hist = {};               // key tok|range -> {at, pts:[{t,y}], p:Promise}
  function history(tok, range) {
    var key = tok + '|' + range, c = hist[key];
    if (c && (c.p || Date.now() - c.at < 10 * 60 * 1000)) return c.p || Promise.resolve(c.pts);
    var R = RANGES[range] || RANGES['1w'];
    var q = 'market=' + tok + '&interval=' + R.interval + '&fidelity=' + R.fidelity;
    var p = fetch(CLOB + '/prices-history?' + q).then(function (r) { if (!r.ok) throw 0; return r.json(); })
      .catch(function () { return fetch(API + '/clob/prices-history?' + q).then(function (r) { return r.ok ? r.json() : null; }); })
      .then(function (j) {
        var pts = ((j && j.history) || []).map(function (x) { return { t: Number(x.t) * 1000, y: Number(x.p) * 100 }; })
          .filter(function (x) { return x.t > 0 && x.y >= 0 && x.y <= 100; });
        hist[key] = { at: Date.now(), pts: pts }; return pts;
      }).catch(function () { hist[key] = { at: Date.now(), pts: [] }; return []; });
    hist[key] = { at: Date.now(), pts: (c && c.pts) || [], p: p };
    return p;
  }

  /* ---------------------------------------------------------------- live midpoints */
  var liveMid = {}, liveAt = 0;
  function pollMids(toks) {
    toks = toks.filter(Boolean).slice(0, 60);
    if (!toks.length || document.hidden) return Promise.resolve();
    return fetch(CLOB + '/midpoints', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(toks.map(function (t) { return { token_id: t }; })) })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (!j) return;
        liveAt = Date.now();
        Object.keys(j).forEach(function (t) {
          var v = num(j[t]); if (v === undefined || v <= 0 || v >= 1) return;
          var prev = liveMid[t]; liveMid[t] = v;
          // Keep the market object on the live quote (the snapshot can be hours old),
          // the same way the Kalshi path reprices on open.
          markets().forEach(function (m) { if (isPoly(m) && yesTok(m) === t) { m.yesPriceNumber = v; m.noPriceNumber = 1 - v; m.__liveQuoteAt = liveAt; } });
          if (prev !== undefined && Math.round(prev * 100) !== Math.round(v * 100)) paintCardOdds(t, v > prev);
        });
        paintHud();
        if (heroM && liveMid[yesTok(heroM)] !== undefined) paintHeroOdds();
        if (dState && liveMid[dState.tok] !== undefined) paintDetail();
      }).catch(function () {});
  }

  /* ---------------------------------------------------------------- images (Polymarket gamma) */
  var imgs = {}, imgAsked = {};
  function loadImages(ids) {
    ids = ids.filter(function (id) { return /^\d+$/.test(id) && !imgAsked[id]; }).slice(0, 25);
    if (!ids.length) return;
    ids.forEach(function (id) { imgAsked[id] = 1; });
    fetch(GAMMA + '/markets?' + ids.map(function (id) { return 'id=' + id; }).join('&') + '&limit=' + ids.length)
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (arr) {
        (Array.isArray(arr) ? arr : []).forEach(function (x) { if (x && x.id && (x.image || x.icon)) imgs[String(x.id)] = x.image || x.icon; });
        applyImages();
        if (heroM && imgs[String(heroM.id)]) paintHeroImg();
      }).catch(function () {});
  }
  function imgTag(src) { return '<img alt="" loading="lazy" referrerpolicy="no-referrer" src="' + esc(src) + '" onerror="this.parentNode.classList.remove(\'omp-has-img\');this.remove()">'; }
  function applyImages() {
    document.querySelectorAll('#opmGrid .opm-mcard[data-mid]').forEach(function (card) {
      var src = imgs[card.getAttribute('data-mid')]; var mi = card.querySelector('.mi');
      if (src && mi && !mi.classList.contains('omp-has-img')) { mi.classList.add('omp-has-img'); mi.innerHTML = imgTag(src); }
    });
  }

  /* ---------------------------------------------------------------- charts */
  function sizeCanvas(c) {
    var w = c.clientWidth, h = c.clientHeight, d = Math.min(2, window.devicePixelRatio || 1);
    if (!w || !h) return null;
    if (c.width !== Math.round(w * d)) { c.width = Math.round(w * d); c.height = Math.round(h * d); }
    var x = c.getContext('2d'); x.setTransform(d, 0, 0, d, 0, 0); return { x: x, w: w, h: h };
  }
  function drawLine(c, pts, opt) {
    opt = opt || {};
    var s = sizeCanvas(c); if (!s) return null;
    var x = s.x, w = s.w, h = s.h; x.clearRect(0, 0, w, h);
    if (!pts || pts.length < 2) return null;
    var lo = Infinity, hi = -Infinity; pts.forEach(function (p) { lo = Math.min(lo, p.y); hi = Math.max(hi, p.y); });
    var padV = Math.max(2, (hi - lo) * 0.15); lo = Math.max(0, lo - padV); hi = Math.min(100, hi + padV); if (hi - lo < 4) { hi = Math.min(100, hi + 2); lo = Math.max(0, lo - 2); }
    var padL = opt.axis ? 4 : 1, padR = opt.axis ? 44 : 1, padT = opt.axis ? 10 : 3, padB = opt.axis ? 18 : 3;
    var t0 = pts[0].t, t1 = pts[pts.length - 1].t || t0 + 1;
    var X = function (t) { return padL + (t - t0) / Math.max(1, t1 - t0) * (w - padL - padR); };
    var Y = function (v) { return padT + (1 - (v - lo) / (hi - lo)) * (h - padT - padB); };
    var up = pts[pts.length - 1].y >= pts[0].y, col = up ? '52,211,153' : '251,113,133';
    if (opt.axis) {
      x.font = '10px ui-monospace,SF Mono,Menlo,monospace'; x.textAlign = 'left'; x.textBaseline = 'middle';
      [0, .5, 1].forEach(function (f) {
        var v = lo + (hi - lo) * f, yy = Y(v);
        x.strokeStyle = 'rgba(127,216,255,.08)'; x.lineWidth = 1; x.beginPath(); x.moveTo(padL, yy); x.lineTo(w - padR, yy); x.stroke();
        x.fillStyle = 'rgba(160,184,203,.75)'; x.fillText(Math.round(v) + '%', w - padR + 6, yy);
      });
      x.textAlign = 'left'; x.textBaseline = 'alphabetic';
      var fmtT = function (t) { var d = new Date(t); return (t1 - t0) < 36e5 * 30 ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString([], { month: 'short', day: 'numeric' }); };
      x.fillStyle = 'rgba(160,184,203,.6)'; x.fillText(fmtT(t0), padL, h - 4); x.textAlign = 'right'; x.fillText(fmtT(t1), w - padR, h - 4);
    }
    var g = x.createLinearGradient(0, padT, 0, h); g.addColorStop(0, 'rgba(' + col + ',' + (opt.axis ? .26 : .22) + ')'); g.addColorStop(1, 'rgba(' + col + ',0)');
    x.beginPath(); x.moveTo(X(pts[0].t), h - padB); pts.forEach(function (p) { x.lineTo(X(p.t), Y(p.y)); }); x.lineTo(X(pts[pts.length - 1].t), h - padB); x.closePath(); x.fillStyle = g; x.fill();
    x.beginPath(); pts.forEach(function (p, i) { i ? x.lineTo(X(p.t), Y(p.y)) : x.moveTo(X(p.t), Y(p.y)); });
    x.strokeStyle = 'rgb(' + col + ')'; x.lineWidth = opt.axis ? 2 : 1.5; x.lineJoin = 'round'; x.stroke();
    var lp = pts[pts.length - 1]; x.beginPath(); x.arc(X(lp.t), Y(lp.y), opt.axis ? 4 : 2.5, 0, 7); x.fillStyle = 'rgb(' + col + ')'; x.fill();
    if (opt.cross !== undefined && opt.cross !== null) {
      var cp = pts[opt.cross];
      if (cp) {
        x.strokeStyle = 'rgba(238,246,252,.35)'; x.setLineDash([3, 3]); x.beginPath(); x.moveTo(X(cp.t), padT); x.lineTo(X(cp.t), h - padB); x.stroke(); x.setLineDash([]);
        x.beginPath(); x.arc(X(cp.t), Y(cp.y), 4.5, 0, 7); x.fillStyle = '#eef6fc'; x.fill();
      }
    }
    return { X: X, padL: padL, padR: padR, w: w, t0: t0, t1: t1 };
  }

  /* ---------------------------------------------------------------- HUD */
  var btc;
  function mountHud(scroll) {
    if ($('ompHud')) return;
    var hud = document.createElement('div'); hud.className = 'omp-hud'; hud.id = 'ompHud';
    hud.innerHTML =
      '<div><div class="k"><span class="omp-dot live" id="ompLive"></span>Markets live</div><div class="v" id="ompHCount">—</div></div>' +
      '<div><div class="k">24h volume</div><div class="v" id="ompHVol">—</div></div>' +
      '<div><div class="k">Liquidity</div><div class="v" id="ompHLiq">—</div></div>' +
      '<div><div class="k">BTC live</div><div class="v gold" id="ompHBtc">—</div></div>' +
      '<div><div class="k">Odds updated</div><div class="v" id="ompHAge">—</div></div>';
    scroll.insertBefore(hud, scroll.firstChild);
  }
  function paintHud() {
    var ms = markets(); if (!$('ompHud')) return;
    var v = 0, l = 0; ms.forEach(function (m) { v += vol24(m); l += liq(m); });
    $('ompHCount').textContent = ms.length ? ms.length.toLocaleString() : '—';
    $('ompHVol').textContent = v ? money(v) : '—';
    $('ompHLiq').textContent = l ? money(l) : '—';
    if (btc) $('ompHBtc').textContent = '$' + Math.round(btc).toLocaleString();
    var age = liveAt ? Math.round((Date.now() - liveAt) / 1000) : null;
    $('ompHAge').textContent = age === null ? 'snapshot' : age < 5 ? 'just now' : age + 's ago';
    var dot = $('ompLive'); if (dot) dot.classList.toggle('live', !!liveAt && Date.now() - liveAt < 90000);
  }

  /* ---------------------------------------------------------------- hero */
  var heroList = [], heroIdx = 0, heroM = null, heroRange = '1w', heroPts = [], heroGeom = null, heroTimer = 0;
  function pickHero() {
    heroList = markets().filter(function (m) { var y = yesPct(m); return isPoly(m) && yesTok(m) && y > 6 && y < 94 && vol24(m) > 0; })
      .sort(function (a, b) { return vol24(b) - vol24(a); }).slice(0, 5);
  }
  function mountHero(scroll) {
    if ($('ompHero')) return;
    var hero = document.createElement('div'); hero.className = 'omp-hero'; hero.id = 'ompHero';
    var hud = $('ompHud'); scroll.insertBefore(hero, hud ? hud.nextSibling : scroll.firstChild);
    hero.addEventListener('click', function (e) {
      var b = e.target.closest('[data-omp]'); if (!b) return;
      var a = b.getAttribute('data-omp');
      if (a === 'open') openM(heroM);
      else if (a === 'yes' || a === 'no') openM(heroM, a);
      else if (a === 'range') { heroRange = b.getAttribute('data-r'); paintHeroChart(); stopRotate(); }
      else if (a === 'dot') { showHero(+b.getAttribute('data-i')); stopRotate(); }
      else if (a === 'prev') { showHero((heroIdx + heroList.length - 1) % heroList.length); stopRotate(); }
      else if (a === 'next') { showHero((heroIdx + 1) % heroList.length); stopRotate(); }
    });
    hero.addEventListener('pointerenter', stopRotate);
  }
  function showHero(i) {
    if (!heroList.length) { var h = $('ompHero'); if (h) h.style.display = 'none'; return; }
    heroIdx = i; heroM = heroList[i];
    var m = heroM, hero = $('ompHero'); hero.style.display = '';
    var close = m.closeAtMs ? new Date(m.closeAtMs).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : '';
    hero.classList.remove('fade'); void hero.offsetWidth; if (!RM) hero.classList.add('fade');
    hero.innerHTML =
      '<div class="omp-slide">' +
        '<div style="min-width:0">' +
          '<div class="omp-hh"><div class="omp-img" id="ompHImg">' + esc(String(m.title || '?').charAt(0)) + '</div><div style="min-width:0">' +
            '<span class="omp-tag"><span class="omp-dot live"></span>Featured · #' + (i + 1) + ' by 24h volume</span>' +
            '<h3 class="omp-hq" data-omp="open">' + esc(m.title) + '</h3>' +
            '<div class="omp-hmeta"><span><b>' + money(vol24(m)) + '</b> 24h vol</span><span><b>' + money(raw(m, 'liquidityNum')) + '</b> liquidity</span>' + (close ? '<span>ends <b>' + esc(close) + '</b></span>' : '') + '</div>' +
          '</div></div>' +
          '<div class="omp-chartbox"><canvas class="omp-chart" id="ompChart"></canvas><div class="omp-tip" id="ompTip"></div></div>' +
          '<div class="omp-ranges">' + Object.keys(RANGES).map(function (k) { return '<button data-omp="range" data-r="' + k + '"' + (k === heroRange ? ' class="on"' : '') + '>' + RANGES[k].label + '</button>'; }).join('') +
            '<span class="src">Polymarket CLOB · live</span></div>' +
        '</div>' +
        '<div class="omp-side">' +
          '<div><div class="omp-big" id="ompHPct">—<small>chance</small></div><div class="omp-chg" id="ompHChg"></div></div>' +
          '<div class="omp-yn"><button class="y" data-omp="yes">Buy Yes<small id="ompHY">—</small></button><button class="n" data-omp="no">Buy No<small id="ompHN">—</small></button></div>' +
        '</div>' +
      '</div>' +
      '<div class="omp-nav"><button data-omp="prev" aria-label="Previous market">‹</button><button data-omp="next" aria-label="Next market">›</button></div>' +
      '<div class="omp-dots">' + heroList.map(function (_, k) { return '<button data-omp="dot" data-i="' + k + '" aria-label="Market ' + (k + 1) + '"' + (k === i ? ' class="on"' : '') + '></button>'; }).join('') + '</div>';
    paintHeroImg(); paintHeroOdds(); paintHeroChart(); wireCrosshair();
    loadImages([String(m.id)]);
    pollMids([yesTok(m)]);
  }
  function paintHeroImg() { var b = $('ompHImg'); if (b && heroM && imgs[String(heroM.id)] && !b.querySelector('img')) b.innerHTML = imgTag(imgs[String(heroM.id)]); }
  function paintHeroOdds() {
    if (!heroM) return;
    var y = yesPct(heroM); if (y === undefined) return;
    var el = $('ompHPct'); if (el) el.innerHTML = (y < 1 ? '<1' : Math.round(y)) + '%<small>chance</small>';
    var Y = $('ompHY'), N = $('ompHN'); if (Y) Y.textContent = y.toFixed(1) + '¢'; if (N) N.textContent = (100 - y).toFixed(1) + '¢';
  }
  function paintHeroChart() {
    if (!heroM) return;
    document.querySelectorAll('#ompHero [data-omp="range"]').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-r') === heroRange); });
    var m = heroM, tok = yesTok(m), range = heroRange;
    history(tok, range).then(function (pts) {
      if (heroM !== m || heroRange !== range) return;
      var live = liveMid[tok]; heroPts = pts.slice();
      if (live !== undefined && heroPts.length) heroPts.push({ t: Date.now(), y: live * 100 });
      var c = $('ompChart'); if (!c) return;
      heroGeom = drawLine(c, heroPts, { axis: true });
      if (!heroGeom) { var s = sizeCanvas(c); if (s) { s.x.fillStyle = 'rgba(160,184,203,.7)'; s.x.font = '12px system-ui'; s.x.fillText('No price history for this range yet', 10, 24); } }
      var chg = $('ompHChg');
      if (chg && heroPts.length > 1) {
        var d = heroPts[heroPts.length - 1].y - heroPts[0].y;
        chg.className = 'omp-chg ' + (Math.abs(d) < 0.05 ? 'flat' : d > 0 ? 'up' : 'down');
        chg.textContent = (d > 0 ? '▲ ' : d < 0 ? '▼ ' : '') + Math.abs(d).toFixed(1) + ' pts · ' + RANGES[range].label;
      }
    });
  }
  function wireCrosshair() {
    var c = $('ompChart'), tip = $('ompTip'); if (!c) return;
    function at(e) {
      if (!heroGeom || heroPts.length < 2) return;
      var r = c.getBoundingClientRect(), px = e.clientX - r.left;
      var t = heroGeom.t0 + (px - heroGeom.padL) / (heroGeom.w - heroGeom.padL - heroGeom.padR) * (heroGeom.t1 - heroGeom.t0);
      var best = 0, bd = Infinity; heroPts.forEach(function (p, i) { var d = Math.abs(p.t - t); if (d < bd) { bd = d; best = i; } });
      drawLine(c, heroPts, { axis: true, cross: best });
      var p = heroPts[best], d = new Date(p.t);
      tip.textContent = d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' · ' + p.y.toFixed(1) + '%';
      tip.style.left = Math.max(60, Math.min(r.width - 60, heroGeom.X(p.t))) + 'px'; tip.classList.add('on');
    }
    c.addEventListener('pointermove', at);
    c.addEventListener('pointerleave', function () { tip.classList.remove('on'); if (heroPts.length > 1) heroGeom = drawLine(c, heroPts, { axis: true }); });
  }
  function startRotate() { stopRotate(); if (RM || heroList.length < 2) return; heroTimer = setInterval(function () { if (!document.hidden && browseVisible) showHero((heroIdx + 1) % heroList.length); }, 9000); }
  function stopRotate() { clearInterval(heroTimer); heroTimer = 0; }

  function openM(m, side) {
    if (!m || !window.OST_PREDICT_MOBILE) return;
    OST_PREDICT_MOBILE.openMarket(m);
    if (side) setTimeout(function () { var b = $(side === 'no' ? 'opmBuyN' : 'opmBuyY'); if (b) b.click(); }, 350);
  }

  /* ---------------------------------------------------------------- sort */
  var sortKey = 'trending';
  var SORTS = [['trending', 'Trending'], ['volume', '24h volume'], ['ending', 'Ending soon'], ['newest', 'Newest'], ['movers', 'Biggest movers']];
  function mountSort() {
    if ($('ompSort')) return;
    var grid = $('opmGrid'); if (!grid) return;
    var bar = document.createElement('div'); bar.className = 'omp-sort'; bar.id = 'ompSort';
    bar.innerHTML = SORTS.map(function (s) { return '<button data-s="' + s[0] + '"' + (s[0] === sortKey ? ' class="on"' : '') + '>' + s[1] + '</button>'; }).join('');
    grid.parentNode.insertBefore(bar, grid);
    bar.addEventListener('click', function (e) {
      var b = e.target.closest('[data-s]'); if (!b) return;
      sortKey = b.getAttribute('data-s');
      bar.querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x === b); });
      applySort();
    });
  }
  function sortVal(m) {
    switch (sortKey) {
      case 'volume': return -vol24(m);
      case 'ending': { var c = num(m.closeAtMs); return c && c > Date.now() ? c : 9e15; }
      case 'newest': return -(num(m.createdAtMs) || 0);
      case 'movers': return -Math.abs(num(m.oneWeekPriceChangeNumber) || 0);
      default: return 0;
    }
  }
  var sorting = false, gridObs = null;
  function applySort() {
    var grid = $('opmGrid'); if (!grid) return;
    var cards = Array.prototype.slice.call(grid.querySelectorAll(':scope > .opm-mcard[data-mid]'));
    if (!cards.length) return;
    cards.forEach(function (c, i) { if (c.__ompI === undefined) c.__ompI = i; });
    var ranked = cards.map(function (c) { var m = byId(c.getAttribute('data-mid')); return { c: c, v: sortKey === 'trending' || !m ? c.__ompI : sortVal(m) }; })
      .sort(function (a, b) { return (a.v - b.v) || (a.c.__ompI - b.c.__ompI); });
    sorting = true;
    ranked.forEach(function (r) { grid.appendChild(r.c); });
    // Our own reorder is not a re-render: drop those records, or the observer
    // re-sorts, which reorders, which... (it looped until the tab crashed).
    if (gridObs) gridObs.takeRecords();
    sorting = false;
  }

  /* ---------------------------------------------------------------- cards */
  var sparkIO = null, queue = [], active = 0;
  function enhanceCards() {
    var grid = $('opmGrid'); if (!grid) return;
    var fresh = [], added = 0;
    grid.querySelectorAll(':scope > .opm-mcard[data-mid]').forEach(function (card, i) {
      if (card.__omp) return; card.__omp = true; card.__ompI = i; added++;
      var m = byId(card.getAttribute('data-mid')); if (!m) return;
      var ch = num(m.oneWeekPriceChangeNumber);
      var chTxt = ch === undefined ? '' : '<b class="' + (ch > 0.0005 ? 'up' : ch < -0.0005 ? 'down' : '') + '">' + (ch > 0 ? '▲' : ch < 0 ? '▼' : '') + Math.abs(ch * 100).toFixed(1) + ' pts 7d</b>';
      var v = vol24(m);
      var bar = card.querySelector('.mbar');
      var tok = yesTok(m);
      if (tok) {
        var cv = document.createElement('canvas'); cv.className = 'omp-spark'; cv.setAttribute('aria-hidden', 'true');
        if (bar) bar.parentNode.insertBefore(cv, bar); else card.appendChild(cv);
        card.__ompTok = tok; card.setAttribute('data-omp-tok', tok);
        if (sparkIO) sparkIO.observe(card);
      }
      if (chTxt || v) {
        var meta = document.createElement('div'); meta.className = 'omp-cm';
        meta.innerHTML = '<span>' + (chTxt || '') + '</span><span>' + (v ? money(v) + ' 24h' : '') + '</span>';
        var myn = card.querySelector('.myn'); if (myn) myn.parentNode.insertBefore(meta, myn.nextSibling); else card.appendChild(meta);
      }
      if (isPoly(m)) fresh.push(String(m.id));
    });
    if (fresh.length) { applyImages(); loadImages(fresh); }
    if (added && sortKey !== 'trending') applySort();
  }
  function pump() {
    while (active < 3 && queue.length) {
      var card = queue.shift(); if (!card.isConnected) continue;
      active++;
      (function (card) {
        history(card.__ompTok, '1w').then(function (pts) {
          var cv = card.querySelector('.omp-spark');
          if (cv) { if (pts.length > 1) drawLine(cv, pts); else cv.remove(); }
        }).then(function () { active--; pump(); });
      })(card);
    }
  }
  function paintCardOdds(tok, up) {
    document.querySelectorAll('#opmGrid .opm-mcard[data-omp-tok="' + tok + '"]').forEach(function (card) {
      var v = liveMid[tok]; if (v === undefined) return;
      var yc = Math.round(v * 100);
      var cy = card.querySelector('.myn .cy'), cn = card.querySelector('.myn .cn'), bar = card.querySelector('.mbar i');
      if (cy) cy.textContent = 'Yes ' + yc + '¢'; if (cn) cn.textContent = 'No ' + (100 - yc) + '¢'; if (bar) bar.style.width = yc + '%';
      if (!RM) { card.classList.remove('flash-up', 'flash-down'); void card.offsetWidth; card.classList.add(up ? 'flash-up' : 'flash-down'); }
    });
  }
  function visibleToks() {
    var out = [];
    document.querySelectorAll('#opmGrid .opm-mcard[data-omp-tok]').forEach(function (c) {
      var r = c.getBoundingClientRect(); if (r.bottom > -200 && r.top < innerHeight + 400) out.push(c.getAttribute('data-omp-tok'));
    });
    if (heroM) out.unshift(yesTok(heroM));
    if (dState) out.unshift(dState.tok);
    return out;
  }

  /* ---------------------------------------------------------------- market page chart */
  // Polymarket markets get the same interactive chart on their page: ranges +
  // crosshair. Ours replaces the module's 1-week canvas (it redraws that one on
  // its own 30s timer), and follows the live midpoint.
  var dState = null;   // {m, tok, range, pts, geom}
  function mountDetailChart() {
    var std = $('opmStdG'); if (!std || std.__omp) return;
    var m = null;
    try { var t = document.querySelector('#opmDetail .opm-qhead h1'); var title = t && t.textContent.trim(); m = markets().filter(function (x) { return x.title === title; })[0]; } catch (_) {}
    if (!m || !isPoly(m) || !yesTok(m)) return;
    std.__omp = true; std.style.display = 'none';
    var box = document.createElement('div'); box.className = 'omp-chartbox';
    box.innerHTML = '<canvas class="omp-chart" id="ompDChart"></canvas><div class="omp-tip" id="ompDTip"></div>';
    std.parentNode.insertBefore(box, std.nextSibling);
    var rb = document.createElement('div'); rb.className = 'omp-ranges';
    rb.innerHTML = Object.keys(RANGES).map(function (k) { return '<button data-r="' + k + '"' + (k === '1w' ? ' class="on"' : '') + '>' + RANGES[k].label + '</button>'; }).join('') + '<span class="src">Polymarket CLOB · live</span>';
    box.parentNode.insertBefore(rb, box.nextSibling);
    dState = { m: m, tok: yesTok(m), range: '1w', pts: [], geom: null };
    rb.addEventListener('click', function (e) {
      var b = e.target.closest('[data-r]'); if (!b) return;
      rb.querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x === b); });
      dState.range = b.getAttribute('data-r'); paintDetail();
    });
    var c = $('ompDChart'), tip = $('ompDTip');
    c.addEventListener('pointermove', function (e) {
      if (!dState || !dState.geom || dState.pts.length < 2) return;
      var g = dState.geom, r = c.getBoundingClientRect(), px = e.clientX - r.left;
      var t = g.t0 + (px - g.padL) / (g.w - g.padL - g.padR) * (g.t1 - g.t0);
      var best = 0, bd = Infinity; dState.pts.forEach(function (p, i) { var d = Math.abs(p.t - t); if (d < bd) { bd = d; best = i; } });
      drawLine(c, dState.pts, { axis: true, cross: best });
      var p = dState.pts[best], d = new Date(p.t);
      tip.textContent = d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' · ' + p.y.toFixed(1) + '%';
      tip.style.left = Math.max(60, Math.min(r.width - 60, g.X(p.t))) + 'px'; tip.classList.add('on');
    });
    c.addEventListener('pointerleave', function () { tip.classList.remove('on'); if (dState && dState.pts.length > 1) dState.geom = drawLine(c, dState.pts, { axis: true }); });
    paintDetail();
    pollMids([dState.tok]);
    // the market's own image in the page header
    var setIco = function () { var ico = document.querySelector('#opmDetail .opm-qhead .ico'), src = imgs[String(m.id)]; if (ico && src && !ico.classList.contains('omp-has-img')) { ico.classList.add('omp-has-img'); ico.innerHTML = imgTag(src); } };
    if (imgs[String(m.id)]) setIco(); else { loadImages([String(m.id)]); setTimeout(setIco, 1500); }
  }
  function paintDetail() {
    if (!dState) return;
    var s = dState, range = s.range;
    history(s.tok, range).then(function (pts) {
      if (dState !== s || s.range !== range) return;
      var c = $('ompDChart'); if (!c) return;
      s.pts = pts.slice(); var live = liveMid[s.tok];
      if (live !== undefined && s.pts.length) s.pts.push({ t: Date.now(), y: live * 100 });
      s.geom = drawLine(c, s.pts, { axis: true });
      if (!s.geom) { var z = sizeCanvas(c); if (z) { z.x.fillStyle = 'rgba(160,184,203,.7)'; z.x.font = '12px system-ui'; z.x.fillText('No price history for this range yet', 10, 24); } }
    });
  }

  function redrawVisible() {
    requestAnimationFrame(function () {
      var c = $('ompChart');
      if (c && c.clientWidth) { if (heroPts.length > 1) heroGeom = drawLine(c, heroPts, { axis: true }); else paintHeroChart(); }
      document.querySelectorAll('#opmGrid .omp-spark').forEach(function (cv) {
        var card = cv.closest('.opm-mcard'); var h = card && hist[card.__ompTok + '|1w'];
        if (h && h.pts && h.pts.length > 1 && cv.clientWidth) drawLine(cv, h.pts);
      });
    });
  }

  /* ---------------------------------------------------------------- boot */
  var browseVisible = false;
  function mount() {
    var browse = $('opmBrowse'), scroll = browse && browse.querySelector(':scope > .opm-scroll');
    if (!scroll || !$('opmGrid')) return false;
    if ('IntersectionObserver' in window) {
      sparkIO = new IntersectionObserver(function (en) {
        en.forEach(function (e) { if (e.isIntersecting) { sparkIO.unobserve(e.target); queue.push(e.target); } });
        pump();
      }, { rootMargin: '200px' });
      new IntersectionObserver(function (en) {
        browseVisible = en.some(function (e) { return e.isIntersecting; });
        // On phones the browse starts hidden (0-width canvases draw nothing): redraw on show.
        if (browseVisible) { paintHud(); startRotate(); redrawVisible(); } else stopRotate();
      }).observe(browse);
    }
    mountHud(scroll);
    mountHero(scroll);
    mountSort();
    // ost-predict-mobile re-renders the grid on search/category/refresh.
    gridObs = new MutationObserver(function () { if (!sorting) enhanceCards(); });
    gridObs.observe($('opmGrid'), { childList: true });
    // ...and rewrites the market page on every open.
    var det = $('opmDetail');
    if (det) new MutationObserver(function () { dState = null; setTimeout(mountDetailChart, 0); }).observe(det, { childList: true });
    var q = $('opmQ'); if (q) q.addEventListener('input', function () { var h = $('ompHero'); if (h) h.style.display = q.value.trim() ? 'none' : (heroList.length ? '' : 'none'); });
    enhanceCards();
    return true;
  }
  function ready() { return markets().length > 0; }
  function boot() {
    var tries = 0;
    (function wait() {
      if (mount()) {
        (function waitData() {
          if (!ready()) { setTimeout(waitData, 600); return; }
          pickHero(); showHero(0); startRotate(); paintHud(); enhanceCards();
        })();
        return;
      }
      if (++tries < 80) setTimeout(wait, 300);
    })();
    window.addEventListener('ost:btc-spot', function (e) { var p = num(e.detail && e.detail.price); if (p) { btc = p; paintHud(); } });
    setInterval(function () { if ((browseVisible || (dState && $('ompDChart'))) && !document.hidden) pollMids(visibleToks()); }, 20000);
    setInterval(function () { if (browseVisible && !document.hidden) paintHud(); }, 5000);
    var rt = 0; window.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(function () { if (heroPts.length > 1) { var c = $('ompChart'); if (c) heroGeom = drawLine(c, heroPts, { axis: true }); } }, 200); });
    // First live pass shortly after data arrives.
    setTimeout(function () { if (ready()) pollMids(visibleToks()); }, 4000);
  }

  window.OST_MARKETS_PRO = { refresh: function () { pickHero(); showHero(0); enhanceCards(); }, history: history };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();

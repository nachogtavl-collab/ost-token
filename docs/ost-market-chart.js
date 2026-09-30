/* ==========================================================================
 * OST · Market Chart — the ONE price-history engine for prediction markets.
 *
 * Polymarket/Kalshi-grade chart for the market page (#opmDetail) and a shared
 * history + draw API that the browse hero and card sparklines reuse.
 *
 *   · Real data only: Polymarket CLOB prices-history (browser-direct, worker
 *     relay as CORS fallback) or the worker's Kalshi trade history. A market
 *     with no history draws a flat line at its current price and SAYS so —
 *     never a made-up curve.
 *   · Yes / No are two real series: the No token has its own CLOB history;
 *     when a market has no No token the No line is the mirror (100 − Yes).
 *     The trade-side buttons (#opmYn) and the chart legend are ONE state.
 *   · Ranges 1H · 6H · 1D · 1W · 1M · ALL, plotted by time (a quiet hour is a
 *     flat stretch, a burst is a burst), crosshair + tooltip, DPR-sharp.
 *   · Multi-outcome ladders (Polymarket "group" events): an outcome list with
 *     live prices; the chart follows the picked outcome, and the pick is
 *     published (ost:predict:outcome) so the ticket buys THAT leg.
 *   · Robust: failed fetches retry after 20s (not cached for 10 minutes), a
 *     generation token drops stale responses from a previous market, resize +
 *     visibility redraw, and drawing while hidden never corrupts the canvas.
 * ========================================================================== */
(function () {
  'use strict';
  if (window.OST_MARKET_CHART) return;

  var API = String(window.OST_API_BASE || 'https://ost-api.nachogtavl.workers.dev').replace(/\/+$/, '');
  var CLOB = 'https://clob.polymarket.com';
  var RM = false; try { RM = matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (_) {}
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function num(v) { var n = Number(v); return Number.isFinite(n) ? n : undefined; }
  function markets() { try { return Array.isArray(window.__ostPredictionMarkets) ? window.__ostPredictionMarkets : []; } catch (_) { return []; } }
  function byId(id) { id = String(id || ''); var a = markets(); for (var i = 0; i < a.length; i++) if (a[i] && String(a[i].id) === id) return a[i]; return null; }
  function isPoly(m) { return !!m && String(m.source) === 'polymarket'; }
  function isKalshi(m) { return !!m && String(m.source) === 'kalshi'; }
  function isNative(m) { return !!m && /^ost-(btc|eth|sol)5m/.test(String(m.id || '')); }

  /* ------------------------------------------------------------------ tokens */
  function parseIds(raw) {
    if (!raw) return [];
    if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch (_) { raw = raw.split(','); } }
    if (!Array.isArray(raw)) return [];
    return raw.map(function (x) { return String((x && typeof x === 'object') ? (x.tokenId || x.token_id || x.id || '') : (x || '')).replace(/[^0-9]/g, ''); })
      .filter(function (t) { return t.length > 20; });
  }
  // Outcomes of a grouped (ladder) market, each with its own token pair.
  function outcomesOf(m) {
    if (!m || !m.isGrouped || !Array.isArray(m.outcomes)) return [];
    return m.outcomes.map(function (o, i) {
      return { key: String(o.key || o.marketId || o.label || i), label: String(o.label || ('Outcome ' + (i + 1))), price: num(o.price),
        legId: o.marketId ? String(o.marketId) : '', conditionId: o.conditionId || '', ids: parseIds(o.clobTokenIds) };
    });
  }
  var picked = {};   // grouped market id -> outcome key
  function pickedOutcome(m) {
    var os = outcomesOf(m); if (!os.length) return null;
    var k = picked[String(m.id)];
    for (var i = 0; i < os.length; i++) if (os[i].key === k) return os[i];
    return os[0];
  }
  // {yes, no} token ids for the market (or its picked outcome).
  function tokensOf(m) {
    var ids = [];
    var o = pickedOutcome(m);
    if (o) ids = o.ids;
    if (!ids.length) ids = parseIds(m && (m.clobTokenIds || (m.raw && (m.raw.clobTokenIds || m.raw.clob_token_ids))));
    return { yes: ids[0] || '', no: ids[1] || '' };
  }
  function yesFrac(m) {
    var o = pickedOutcome(m);
    var v = o && o.price !== undefined ? o.price : num(m && m.yesPriceNumber);
    if (v === undefined) return undefined;
    if (v > 1) v = v / 100;
    return Math.max(0, Math.min(1, v));
  }

  /* ------------------------------------------------------------------ history */
  var RANGES = {
    '1h':  { interval: '1h',  fidelity: 1,    label: '1H' },
    '6h':  { interval: '6h',  fidelity: 5,    label: '6H' },
    '1d':  { interval: '1d',  fidelity: 5,    label: '1D' },
    '1w':  { interval: '1w',  fidelity: 60,   label: '1W' },
    '1m':  { interval: '1m',  fidelity: 360,  label: '1M' },
    'all': { interval: 'max', fidelity: 1440, label: 'ALL' }
  };
  var OK_TTL = 120000, ERR_TTL = 20000;
  var cache = {};   // key -> {at, pts, p?, err?}
  function fetchJson(url, ms) {
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var t = setTimeout(function () { try { ctrl && ctrl.abort(); } catch (_) {} }, ms || 8000);
    return fetch(url, { signal: ctrl ? ctrl.signal : undefined }).then(function (r) { clearTimeout(t); if (!r.ok) throw new Error('http ' + r.status); return r.json(); }, function (e) { clearTimeout(t); throw e; });
  }
  function toPts(h) {
    return (Array.isArray(h) ? h : []).map(function (x) { var t = Number(x.t); if (t > 0 && t < 1e11) t *= 1000; return { t: t, y: Number(x.p) * 100 }; })
      .filter(function (x) { return x.t > 0 && x.y >= 0 && x.y <= 100; }).sort(function (a, b) { return a.t - b.t; });
  }
  // Polymarket CLOB history for one token. Resolves [] on "no data", rejects on failure.
  function clobHistory(tok, range) {
    var key = 'clob:' + tok + '|' + range, c = cache[key], now = Date.now();
    if (c && c.p) return c.p;
    if (c && !c.err && now - c.at < OK_TTL) return Promise.resolve(c.pts);
    if (c && c.err && now - c.at < ERR_TTL) return Promise.reject(new Error('cooldown'));
    var R = RANGES[range] || RANGES['1w'];
    var q = 'market=' + tok + '&interval=' + R.interval + '&fidelity=' + R.fidelity;
    var p = fetchJson(CLOB + '/prices-history?' + q, 7000)
      .catch(function () { return fetchJson(API + '/clob/prices-history?' + q, 8000); })
      .then(function (j) { var pts = toPts(j && j.history); cache[key] = { at: Date.now(), pts: pts }; return pts; })
      .catch(function (e) { cache[key] = { at: Date.now(), pts: (c && c.pts) || [], err: true }; throw e; });
    cache[key] = { at: now, pts: (c && c.pts) || [], p: p };
    return p;
  }
  // Kalshi: worker relay (Kalshi blocks browsers). 7-day trade history, Yes side.
  function kalshiHistory(ticker) {
    var key = 'kalshi:' + ticker, c = cache[key], now = Date.now();
    if (c && c.p) return c.p;
    if (c && !c.err && now - c.at < OK_TTL) return Promise.resolve(c.pts);
    if (c && c.err && now - c.at < ERR_TTL) return Promise.reject(new Error('cooldown'));
    var url = API + '/kalshi/market?ticker=' + encodeURIComponent(ticker);
    // Kalshi throttles Cloudflare's shared IPs (~half of calls 429): one quiet retry after 5s.
    var p = fetchJson(url, 9000).then(function (j) { if (j && j.ok) return j; return new Promise(function (res) { setTimeout(res, 5000); }).then(function () { return fetchJson(url, 9000); }); })
      .then(function (j) { if (!j || !j.ok) throw new Error((j && j.error) || 'kalshi'); var pts = toPts(j.history); cache[key] = { at: Date.now(), pts: pts, quote: j }; return pts; })
      .catch(function (e) { cache[key] = { at: Date.now(), pts: (c && c.pts) || [], err: true }; throw e; });
    cache[key] = { at: now, pts: (c && c.pts) || [], p: p };
    return p;
  }
  function mirror(pts) { return pts.map(function (p) { return { t: p.t, y: 100 - p.y }; }); }
  function clipRange(pts, range) {
    var R = { '1h': 36e5, '6h': 6 * 36e5, '1d': 864e5, '1w': 7 * 864e5, '1m': 30 * 864e5 }[range];
    if (!R) return pts; var from = Date.now() - R;
    var out = pts.filter(function (p) { return p.t >= from; });
    return out.length >= 2 ? out : pts.slice(-2);
  }
  // Series for a market + side + range → Promise<{pts, mirrored, src}>. Rejects on fetch failure.
  function series(m, side, range) {
    side = side === 'no' ? 'no' : 'yes';
    if (isKalshi(m)) {
      return kalshiHistory(String(m.id)).then(function (pts) { pts = clipRange(pts, range); return { pts: side === 'no' ? mirror(pts) : pts, mirrored: side === 'no', src: 'Kalshi trades' }; });
    }
    var tk = tokensOf(m);
    if (!tk.yes) return Promise.resolve({ pts: [], mirrored: false, src: '' });
    if (side === 'no' && tk.no) return clobHistory(tk.no, range).then(function (pts) { return { pts: pts, mirrored: false, src: 'Polymarket CLOB' }; });
    return clobHistory(tk.yes, range).then(function (pts) { return { pts: side === 'no' ? mirror(pts) : pts, mirrored: side === 'no', src: 'Polymarket CLOB' }; });
  }

  /* ------------------------------------------------------------------ live quote */
  // The catalog price can be a deploy-time snapshot hours old (the Fed ladder read
  // 55c while the CLOB traded at 27c). Reprice the open market from CLOB midpoints
  // so the odds, the ticket and the chart's live point all agree with the venue.
  var QUOTE_FRESH_MS = 90000;
  function quoteFresh(m) { return !!(m && m.__liveQuoteAt && Date.now() - m.__liveQuoteAt < QUOTE_FRESH_MS); }
  function midpoints(toks) {
    toks = toks.filter(Boolean).slice(0, 40);
    if (!toks.length) return Promise.resolve({});
    var body = JSON.stringify(toks.map(function (t) { return { token_id: t }; }));
    return fetchJson2(CLOB + '/midpoints', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body }, 6000)
      .catch(function () {
        // Relay fallback: the worker forwards GETs only, so ask per token (few markets need this).
        return Promise.all(toks.slice(0, 12).map(function (t) { return fetchJson(API + '/clob/midpoint?token_id=' + t, 6000).then(function (j) { return [t, j && j.mid]; }).catch(function () { return [t, undefined]; }); }))
          .then(function (rows) { var o = {}; rows.forEach(function (r) { if (r[1] !== undefined) o[r[0]] = r[1]; }); return o; });
      });
  }
  function fetchJson2(url, init, ms) {
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var t = setTimeout(function () { try { ctrl && ctrl.abort(); } catch (_) {} }, ms || 8000);
    init = init || {}; if (ctrl) init.signal = ctrl.signal;
    return fetch(url, init).then(function (r) { clearTimeout(t); if (!r.ok) throw new Error('http ' + r.status); return r.json(); }, function (e) { clearTimeout(t); throw e; });
  }
  var quoteInFlight = {};
  function refreshQuote(m) {
    if (!isPoly(m)) return Promise.resolve(false);
    var id = String(m.id); if (quoteInFlight[id]) return quoteInFlight[id];
    var os = outcomesOf(m), toks = os.length ? os.map(function (o) { return o.ids[0]; }) : [tokensOf(m).yes];
    quoteInFlight[id] = midpoints(toks).then(function (j) {
      var changed = false, now = Date.now();
      function take(t) { var v = num(j[t]); return v !== undefined && v > 0 && v < 1 ? v : undefined; }
      if (os.length && Array.isArray(m.outcomes)) {
        m.outcomes.forEach(function (o, i) { var v = take(os[i] && os[i].ids[0]); if (v !== undefined && Math.abs((num(o.price) || 0) - v) > 1e-6) { o.price = v; changed = true; } });
        var top = num(m.outcomes[0] && m.outcomes[0].price);
        if (top !== undefined) { m.yesPriceNumber = top; m.noPriceNumber = 1 - top; }
      } else {
        var v = take(toks[0]);
        if (v !== undefined && Math.abs((num(m.yesPriceNumber) || 0) - v) > 1e-6) { m.yesPriceNumber = v; m.noPriceNumber = 1 - v; changed = true; }
      }
      if (Object.keys(j).length) m.__liveQuoteAt = now;
      return changed;
    }).catch(function () { return false; }).then(function (changed) { delete quoteInFlight[id]; return changed; });
    return quoteInFlight[id];
  }
  function publishQuote(m) {
    try { window.dispatchEvent(new CustomEvent('ost:predict:quote', { detail: { marketId: String(m.id), yesPriceNumber: num(m.yesPriceNumber), live: quoteFresh(m) } })); } catch (_) {}
    if (m.isGrouped) { var o = pickedOutcome(m); if (o) try { window.dispatchEvent(new CustomEvent('ost:predict:outcome', { detail: { marketId: String(m.id), key: o.key, label: o.label, legId: o.legId, conditionId: o.conditionId, legPrice: o.price, clobTokenIds: o.ids, quiet: true } })); } catch (_) {} }
  }

  /* ------------------------------------------------------------------ drawing */
  var COL = { yes: '52,211,153', no: '251,113,133', flat: '160,184,203' };
  function sizeCanvas(c) {
    var w = c.clientWidth, h = c.clientHeight, d = Math.min(2, window.devicePixelRatio || 1);
    if (!w || !h) return null;
    var W = Math.round(w * d), H = Math.round(h * d);
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    var x = c.getContext('2d'); x.setTransform(d, 0, 0, d, 0, 0); return { x: x, w: w, h: h };
  }
  function fmtT(t, span) {
    var d = new Date(t);
    if (span < 36e5 * 30) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (span < 864e5 * 400) return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    return d.toLocaleDateString([], { month: 'short', year: '2-digit' });
  }
  // draw(canvas, pts, {side, axis, cross, msg, flatAt}) → geometry or null
  function draw(c, pts, opt) {
    opt = opt || {};
    var s = sizeCanvas(c); if (!s) return null;
    var x = s.x, w = s.w, h = s.h; x.clearRect(0, 0, w, h);
    var side = opt.side === 'no' ? 'no' : 'yes';
    var axis = !!opt.axis;
    var padL = axis ? 6 : 1, padR = axis ? 46 : 1, padT = axis ? 12 : 3, padB = axis ? 20 : 3;
    var mono = '10.5px ui-monospace,SF Mono,Menlo,monospace';
    if (!pts || pts.length < 2) {
      // Empty state: flat guide at the current price (if known) + a plain message.
      if (axis) {
        var fa = num(opt.flatAt);
        if (fa !== undefined) {
          var yy = padT + (1 - fa / 100) * (h - padT - padB);
          x.setLineDash([4, 4]); x.strokeStyle = 'rgba(' + COL[side] + ',.55)'; x.lineWidth = 1.5; x.beginPath(); x.moveTo(padL, yy); x.lineTo(w - padR, yy); x.stroke(); x.setLineDash([]);
          x.fillStyle = 'rgb(' + COL[side] + ')'; x.font = 'bold ' + mono; x.textAlign = 'left'; x.textBaseline = 'middle'; x.fillText(fa.toFixed(fa < 1 || fa > 99 ? 1 : 0) + '%', w - padR + 6, yy);
        }
        if (opt.msg) { x.fillStyle = 'rgba(160,184,203,.8)'; x.font = '12px system-ui,sans-serif'; x.textAlign = 'left'; x.textBaseline = 'alphabetic'; x.fillText(opt.msg, padL + 4, padT + 12); }
      }
      return null;
    }
    var lo = Infinity, hi = -Infinity; pts.forEach(function (p) { if (p.y < lo) lo = p.y; if (p.y > hi) hi = p.y; });
    var padV = Math.max(2, (hi - lo) * 0.18); lo = Math.max(0, lo - padV); hi = Math.min(100, hi + padV);
    if (hi - lo < 5) { var mid = (hi + lo) / 2; lo = Math.max(0, mid - 2.5); hi = Math.min(100, mid + 2.5); }
    var t0 = pts[0].t, t1 = pts[pts.length - 1].t; if (t1 <= t0) t1 = t0 + 1;
    var X = function (t) { return padL + (t - t0) / (t1 - t0) * (w - padL - padR); };
    var Y = function (v) { return padT + (1 - (v - lo) / (hi - lo)) * (h - padT - padB); };
    var col = COL[side];
    if (axis) {
      x.font = mono; x.textAlign = 'left'; x.textBaseline = 'middle';
      var liveY = Y(pts[pts.length - 1].y);
      [0, .5, 1].forEach(function (f) {
        var v = lo + (hi - lo) * f, gy = Y(v);
        x.strokeStyle = 'rgba(127,216,255,.09)'; x.lineWidth = 1; x.beginPath(); x.moveTo(padL, gy); x.lineTo(w - padR, gy); x.stroke();
        if (Math.abs(gy - liveY) > 12) { x.fillStyle = 'rgba(160,184,203,.7)'; x.fillText(Math.round(v) + '%', w - padR + 6, gy); }
      });
      x.textBaseline = 'alphabetic'; x.fillStyle = 'rgba(160,184,203,.6)';
      var span = t1 - t0, nT = Math.max(2, Math.min(6, Math.floor((w - padL - padR) / 110)));
      for (var i = 0; i < nT; i++) {
        var tt = t0 + span * (i / (nT - 1));
        x.textAlign = i === 0 ? 'left' : i === nT - 1 ? 'right' : 'center';
        x.fillText(fmtT(tt, span), X(tt), h - 5);
      }
    }
    var g = x.createLinearGradient(0, padT, 0, h - padB); g.addColorStop(0, 'rgba(' + col + ',' + (axis ? .28 : .22) + ')'); g.addColorStop(1, 'rgba(' + col + ',0)');
    x.beginPath(); x.moveTo(X(pts[0].t), h - padB); pts.forEach(function (p) { x.lineTo(X(p.t), Y(p.y)); }); x.lineTo(X(pts[pts.length - 1].t), h - padB); x.closePath(); x.fillStyle = g; x.fill();
    x.beginPath(); pts.forEach(function (p, i) { i ? x.lineTo(X(p.t), Y(p.y)) : x.moveTo(X(p.t), Y(p.y)); });
    x.strokeStyle = 'rgb(' + col + ')'; x.lineWidth = axis ? 2 : 1.5; x.lineJoin = 'round'; x.lineCap = 'round'; x.stroke();
    var lp = pts[pts.length - 1], lx = X(lp.t), ly = Y(lp.y);
    if (axis) {
      // live value tag on the right axis
      x.fillStyle = 'rgb(' + col + ')'; x.font = 'bold ' + mono; x.textAlign = 'left'; x.textBaseline = 'middle';
      var tag = lp.y.toFixed(lp.y < 1 || lp.y > 99 ? 1 : 0) + '%'; var tw = x.measureText(tag).width + 8;
      x.globalAlpha = .18; x.fillRect(w - padR + 2, ly - 8, tw, 16); x.globalAlpha = 1; x.fillText(tag, w - padR + 6, ly);
      x.beginPath(); x.arc(lx, ly, 6.5, 0, 7); x.fillStyle = 'rgba(' + col + ',.25)'; x.fill();
    }
    x.beginPath(); x.arc(lx, ly, axis ? 3.5 : 2.5, 0, 7); x.fillStyle = 'rgb(' + col + ')'; x.fill();
    if (opt.cross !== undefined && opt.cross !== null && pts[opt.cross]) {
      var cp = pts[opt.cross], cx = X(cp.t), cy = Y(cp.y);
      x.strokeStyle = 'rgba(238,246,252,.35)'; x.setLineDash([3, 3]); x.lineWidth = 1; x.beginPath(); x.moveTo(cx, padT); x.lineTo(cx, h - padB); x.stroke(); x.setLineDash([]);
      x.beginPath(); x.arc(cx, cy, 5, 0, 7); x.fillStyle = '#eef6fc'; x.fill(); x.beginPath(); x.arc(cx, cy, 3, 0, 7); x.fillStyle = 'rgb(' + col + ')'; x.fill();
    }
    return { X: X, Y: Y, padL: padL, padR: padR, padT: padT, padB: padB, w: w, h: h, t0: t0, t1: t1 };
  }
  function nearest(pts, t) { var b = 0, bd = Infinity; for (var i = 0; i < pts.length; i++) { var d = Math.abs(pts[i].t - t); if (d < bd) { bd = d; b = i; } } return b; }

  /* ------------------------------------------------------------------ market page */
  var S = null;   // {gen, m, side, range, pts, geom, box, canvas, tip, mirrored}
  var gen = 0;
  function currentMarket() {
    try { if (window.OST_PREDICT_MOBILE && OST_PREDICT_MOBILE.current) { var c = OST_PREDICT_MOBILE.current(); if (c) return c; } } catch (_) {}
    var d = $('opmDetail'); return d ? byId(d.getAttribute('data-mid')) : null;
  }
  function tradeSide() { var b = document.querySelector('#opmYn button.sel'); return b && b.getAttribute('data-s') === 'no' ? 'no' : 'yes'; }

  function mountDetail() {
    var std = $('opmStdG'); if (!std || std.__mkc) return;
    var m = currentMarket(); if (!m || isNative(m)) return;
    if (!(isPoly(m) || isKalshi(m))) return;
    std.__mkc = true; std.style.display = 'none';
    var note = $('opmStdNote'); if (note && isPoly(m)) note.style.display = 'none';
    gen++;
    var box = document.createElement('div'); box.className = 'mkc'; box.id = 'mkcBox';
    var yp = yesFrac(m), yc = yp === undefined ? undefined : yp * 100;
    box.innerHTML =
      (m.isGrouped ? '<div class="mkc-ladder" id="mkcLadder"></div>' : '') +
      '<div class="mkc-head">' +
        '<div class="mkc-legend" id="mkcLegend" role="tablist" aria-label="Chart outcome">' +
          '<button type="button" class="y" data-mkc-side="yes" role="tab"><i></i>Yes <b id="mkcYesPx">' + (yc === undefined ? '—' : pct(yc)) + '</b></button>' +
          '<button type="button" class="n" data-mkc-side="no" role="tab"><i></i>No <b id="mkcNoPx">' + (yc === undefined ? '—' : pct(100 - yc)) + '</b></button>' +
        '</div>' +
        '<div class="mkc-chg" id="mkcChg"></div>' +
      '</div>' +
      '<div class="mkc-chartbox"><canvas class="mkc-chart" id="mkcChart" aria-label="Price history"></canvas><div class="mkc-tip" id="mkcTip"></div><div class="mkc-over" id="mkcOver"></div></div>' +
      '<div class="mkc-ranges" id="mkcRanges">' + Object.keys(RANGES).map(function (k) { return '<button type="button" data-r="' + k + '"' + (k === '1w' ? ' class="on"' : '') + '>' + RANGES[k].label + '</button>'; }).join('') +
        '<span class="src" id="mkcSrc">' + (isKalshi(m) ? 'Kalshi · 7d' : 'Polymarket CLOB · live') + '</span></div>';
    std.parentNode.insertBefore(box, std.nextSibling);
    S = { gen: gen, m: m, side: tradeSide(), range: '1w', pts: [], geom: null, box: box, canvas: $('mkcChart'), tip: $('mkcTip'), over: $('mkcOver'), mirrored: false, provisional: false, loading: false };
    if (m.isGrouped) renderLadder();
    box.addEventListener('click', function (e) {
      var b = e.target.closest('[data-r]'); if (b) { setRange(b.getAttribute('data-r')); return; }
      var l = e.target.closest('[data-mkc-side]');
      if (l) { var want = l.getAttribute('data-mkc-side'); var tb = document.querySelector('#opmYn button[data-s="' + want + '"]'); if (tb) tb.click(); else setSide(want); return; }
      var o = e.target.closest('[data-mkc-outcome]'); if (o) { pickOutcome(o.getAttribute('data-mkc-outcome')); return; }
      if (e.target.closest('[data-mkc-retry]')) { paint(true); }
    });
    wireCrosshair();
    syncLegend();
    paint();
    pullQuote();
    // Redraw when the box is resized (desktop split, orientation) or becomes visible.
    if ('ResizeObserver' in window) { var ro = new ResizeObserver(function () { redraw(); }); ro.observe(box); S.ro = ro; }
    if ('IntersectionObserver' in window) { var io = new IntersectionObserver(function (en) { if (en.some(function (x) { return x.isIntersecting; })) redraw(); }); io.observe(box); S.io = io; }
  }
  function pct(v) { v = Number(v); return (v < 1 || v > 99 ? v.toFixed(1) : String(Math.round(v))) + '¢'; }
  function syncLegend() {
    if (!S) return;
    var Y = document.querySelector('#mkcLegend .y'), N = document.querySelector('#mkcLegend .n');
    if (Y) { Y.classList.toggle('on', S.side === 'yes'); Y.setAttribute('aria-selected', S.side === 'yes'); }
    if (N) { N.classList.toggle('on', S.side === 'no'); N.setAttribute('aria-selected', S.side === 'no'); }
    var yp = yesFrac(S.m);
    if (yp !== undefined) { var a = $('mkcYesPx'), b = $('mkcNoPx'); if (a) a.textContent = pct(yp * 100); if (b) b.textContent = pct(100 - yp * 100); }
  }
  function setSide(side) {
    if (!S) return; side = side === 'no' ? 'no' : 'yes';
    if (S.side === side) return;
    // INSTANT FLIP. The other side's series is exactly the mirror of what is on
    // screen (a binary market's No = 100 − Yes at every instant), so draw that
    // right away and let the real token history replace it when it lands. The
    // old code kept the previous side's line under the new legend until the
    // fetch finished — and forever when it failed.
    S.side = side;
    if (S.pts.length > 1) { S.pts = mirror(S.pts); S.provisional = true; S.mirrored = true; }
    else { S.pts = []; S.provisional = false; }
    syncLegend(); redraw(); paintChange(); paint();
  }
  function setRange(r) {
    if (!S || !RANGES[r] || S.range === r) return;
    S.range = r; S.pts = []; S.provisional = false;
    document.querySelectorAll('#mkcRanges [data-r]').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-r') === r); });
    redraw(); paint();
  }
  function overlay(html) { if (S && S.over) { S.over.innerHTML = html || ''; S.over.classList.toggle('on', !!html); } }
  function paint(force) {
    if (!S) return;
    var s = S, g = s.gen, side = s.side, range = s.range, m = s.m;
    var c = s.canvas; if (!c) return;
    var yp = yesFrac(m), flatAt = yp === undefined ? undefined : (side === 'no' ? 100 - yp * 100 : yp * 100);
    if (!s.pts.length) draw(c, [], { axis: true, side: side, flatAt: flatAt, msg: 'Loading price history…' });
    if (force) { var tk = tokensOf(m); ['clob:' + tk.yes + '|' + range, 'clob:' + tk.no + '|' + range, 'kalshi:' + m.id].forEach(function (k) { delete cache[k]; }); }
    overlay('');
    series(m, side, range).then(function (r) {
      if (S !== s || s.gen !== g || s.side !== side || s.range !== range) return;
      if (r.pts.length < 2 && s.provisional && s.pts.length > 1) { s.mirrored = true; markSrc(m, true, 'no history for this token yet'); paintChange(); return; }   // keep the mirror rather than blank
      s.mirrored = r.mirrored; s.provisional = false; s.pts = r.pts.slice();
      appendLive(s);
      markSrc(m, r.mirrored, '');
      redraw();
      if (s.pts.length < 2) overlay('<span>No price history yet for this range.</span>');
      paintChange();
    }).catch(function () {
      if (S !== s || s.gen !== g || s.side !== side || s.range !== range) return;
      if (s.provisional && s.pts.length > 1) { markSrc(m, true, 'live history unavailable'); return; }   // the mirror stays: it is a correct No line
      if (s.pts.length < 2) { draw(c, [], { axis: true, side: side, flatAt: flatAt, msg: '' }); overlay('<span>Couldn’t load price history.</span><button type="button" data-mkc-retry>Retry</button>'); }
    });
  }
  function markSrc(m, mirrored, note) {
    var src = $('mkcSrc'); if (!src) return;
    var base = isKalshi(m) ? 'Kalshi trades' : 'Polymarket CLOB';
    src.textContent = base + (mirrored ? ' · No = 100 − Yes' : (isKalshi(m) ? '' : ' · live')) + (note ? ' · ' + note : '');
  }
  // The live quote becomes the last point so the line ends at "now".
  function appendLive(s) {
    var yp = yesFrac(s.m); if (yp === undefined || !s.pts.length || !quoteFresh(s.m)) return;
    var v = s.side === 'no' ? 100 - yp * 100 : yp * 100;
    var last = s.pts[s.pts.length - 1];
    if (last && last.live) { last.t = Date.now(); last.y = v; } else s.pts.push({ t: Date.now(), y: v, live: true });
  }
  function paintChange() {
    var el = $('mkcChg'); if (!el || !S) return;
    if (S.pts.length < 2) { el.textContent = ''; el.className = 'mkc-chg'; return; }
    var d = S.pts[S.pts.length - 1].y - S.pts[0].y;
    el.className = 'mkc-chg ' + (Math.abs(d) < 0.05 ? 'flat' : d > 0 ? 'up' : 'down');
    el.textContent = (d > 0 ? '▲ ' : d < 0 ? '▼ ' : '') + Math.abs(d).toFixed(1) + ' pts · ' + RANGES[S.range].label;
  }
  function redraw() {
    if (!S || !S.canvas) return;
    var yp = yesFrac(S.m), flatAt = yp === undefined ? undefined : (S.side === 'no' ? 100 - yp * 100 : yp * 100);
    if (S.pts.length > 1) S.geom = draw(S.canvas, S.pts, { axis: true, side: S.side });
    else draw(S.canvas, [], { axis: true, side: S.side, flatAt: flatAt, msg: S.loading ? 'Loading price history…' : '' });
  }
  function wireCrosshair() {
    var c = S.canvas, tip = S.tip; if (!c) return;
    function at(e) {
      var s = S; if (!s || !s.geom || s.pts.length < 2) return;
      var g = s.geom, r = c.getBoundingClientRect(), px = e.clientX - r.left;
      var t = g.t0 + (px - g.padL) / (g.w - g.padL - g.padR) * (g.t1 - g.t0);
      var i = nearest(s.pts, t), p = s.pts[i], d = new Date(p.t);
      draw(c, s.pts, { axis: true, side: s.side, cross: i });
      tip.innerHTML = '<b>' + (s.side === 'no' ? 'No' : 'Yes') + ' ' + p.y.toFixed(1) + '%</b>' + esc(d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
      tip.style.left = Math.max(70, Math.min(r.width - 70, g.X(p.t))) + 'px'; tip.classList.add('on');
    }
    c.addEventListener('pointermove', at, { passive: true });
    c.addEventListener('pointerdown', at, { passive: true });
    c.addEventListener('pointerleave', function () { tip.classList.remove('on'); redraw(); });
  }
  function pullQuote() {
    var s = S; if (!s) return;
    refreshQuote(s.m).then(function (changed) {
      if (S !== s) return;
      if (s.m.isGrouped) renderLadder();
      syncLegend(); appendLive(s); redraw(); paintChange();
      if (changed || quoteFresh(s.m)) publishQuote(s.m);
    });
  }
  /* ---- multi-outcome ladder */
  function renderLadder() {
    var host = $('mkcLadder'); if (!host || !S) return;
    var os = outcomesOf(S.m), cur = pickedOutcome(S.m);
    host.innerHTML = '<div class="mkc-lh">Outcomes <span>pick one to chart &amp; trade</span></div>' + os.slice(0, 12).map(function (o) {
      var p = o.price === undefined ? undefined : (o.price > 1 ? o.price : o.price * 100);
      var on = cur && cur.key === o.key;
      return '<button type="button" class="mkc-row' + (on ? ' on' : '') + '" data-mkc-outcome="' + esc(o.key) + '" role="radio" aria-checked="' + on + '">' +
        '<span class="l">' + esc(o.label) + '</span><span class="bar"><i style="width:' + (p === undefined ? 0 : Math.max(1, p)) + '%"></i></span>' +
        '<span class="p">' + (p === undefined ? '—' : pct(p)) + '</span></button>';
    }).join('');
  }
  function pickOutcome(key) {
    if (!S || !S.m || !S.m.isGrouped) return;
    picked[String(S.m.id)] = key;
    var o = pickedOutcome(S.m);
    renderLadder(); syncLegend();
    S.pts = []; S.provisional = false; redraw(); paint();
    try { window.dispatchEvent(new CustomEvent('ost:predict:outcome', { detail: { marketId: String(S.m.id), key: o.key, label: o.label, legId: o.legId, conditionId: o.conditionId, legPrice: o.price, clobTokenIds: o.ids } })); } catch (_) {}
  }
  function selection(marketId) {
    var m = byId(marketId); if (!m || !m.isGrouped) return null;
    var o = pickedOutcome(m); if (!o) return null;
    return { key: o.key, label: o.label, legId: o.legId, conditionId: o.conditionId, legPrice: o.price, clobTokenIds: o.ids };
  }

  /* ------------------------------------------------------------------ boot */
  var liveTimer = 0;
  function boot() {
    var det = $('opmDetail');
    if (!det) { setTimeout(boot, 400); return; }
    // The module rewrites #opmDetail on every open; remount after it settles.
    var mo = new MutationObserver(function () { if (S) { try { S.ro && S.ro.disconnect(); S.io && S.io.disconnect(); } catch (_) {} } S = null; gen++; setTimeout(mountDetail, 0); });
    mo.observe(det, { childList: true });
    // Trade-side buttons drive the chart side (one state, two places).
    det.addEventListener('click', function (e) { var b = e.target.closest('#opmYn button[data-s]'); if (b) setTimeout(function () { setSide(b.getAttribute('data-s')); }, 0); });
    // Follow the live quote: refresh the last point every few seconds while visible.
    liveTimer = setInterval(function () { if (!S || document.hidden || !S.pts.length) return; appendLive(S); redraw(); syncLegend(); paintChange(); }, 5000);
    setInterval(function () { if (S && !document.hidden) pullQuote(); }, 20000);
    setTimeout(mountDetail, 0);
  }
  window.OST_MARKET_CHART = {
    history: clobHistory, series: series, draw: draw, refreshQuote: refreshQuote, quoteFresh: quoteFresh, ranges: RANGES, tokensOf: tokensOf, outcomesOf: outcomesOf,
    selection: selection, pick: function (marketId, key) { picked[String(marketId)] = key; if (S && String(S.m.id) === String(marketId)) pickOutcome(key); },
    side: function (s) { if (s) setSide(s); return S ? S.side : 'yes'; }, redraw: redraw, remount: function () { var std = $('opmStdG'); if (std) std.__mkc = false; S = null; mountDetail(); }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();

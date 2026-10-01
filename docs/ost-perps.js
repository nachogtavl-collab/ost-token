/* ==========================================================================
 * OST · Perps — perpetual futures on the mirrored markets (devnet OSTG).
 *
 * A "Perps" mode inside the stock mirror section (#stock-market):
 *   · Markets board   16 mirrored markets (crypto 24/7, stocks + indexes in
 *                     market hours): mark, 24h move, funding/8h, open interest.
 *   · Chart           the shared chart engine in price mode (daily history from
 *                     the worker's /stocks relay + the live mark as last point).
 *   · Ticket          Long / Short, margin, leverage slider (caps per market),
 *                     notional, liquidation price, fees, funding — all computed
 *                     with the same formulas the server settles with.
 *   · Positions       live PnL / ROE, liquidation distance, funding accrued,
 *                     one-tap close; history of closed and liquidated positions.
 *
 * Money: the SERVER (worker PlayLedger + perp-ledger.js) prices entry and exit,
 * debits margin and pays out — this file never computes a payout it then
 * credits. Requests go through fetch(), which ost-auth.js signs for /play/*.
 * Devnet OSTG only — no cash value. No new floating buttons.
 * ========================================================================== */
(function () {
  'use strict';
  if (window.OST_PERPS) return;

  var API = String(window.OST_API_BASE || 'https://ost-api.nachogtavl.workers.dev').replace(/\/+$/, '');
  var MODE_KEY = 'ost.mirror.mode.v1';
  var RULES = { mmr: 0.005, fee: 0.0005, edge: 0.02, fundingPeriodMs: 288e5, minMargin: 1 };
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function num(v) { var n = Number(v); return Number.isFinite(n) ? n : undefined; }
  function usd(v, dp) { v = Number(v); if (!Number.isFinite(v)) return '—'; if (dp == null) dp = v >= 1000 ? 0 : v >= 100 ? 2 : v >= 1 ? 2 : 4; return '$' + v.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp }); }
  function ostg(v, dp) { v = Number(v); if (!Number.isFinite(v)) return '—'; return v.toLocaleString(undefined, { minimumFractionDigits: dp == null ? 2 : dp, maximumFractionDigits: dp == null ? 2 : dp }); }
  function pct(v, dp) { v = Number(v); if (!Number.isFinite(v)) return '—'; return (v > 0 ? '+' : '') + (v * 100).toFixed(dp == null ? 2 : dp) + '%'; }
  function signed(v, dp) { v = Number(v) || 0; return (v > 0.005 ? '+' : v < -0.005 ? '−' : '') + Math.abs(v).toFixed(dp == null ? 2 : dp); }
  function ago(ts) { var s = Math.max(0, Math.round((Date.now() - Number(ts)) / 1000)); if (s < 60) return s + 's'; if (s < 3600) return Math.floor(s / 60) + 'm'; if (s < 86400) return Math.floor(s / 3600) + 'h'; return Math.floor(s / 86400) + 'd'; }
  function toast(msg) { try { if (typeof window.toast === 'function') { window.toast('info', msg); return; } } catch (_) {} try { if (window.OST_OPTIMISTIC) { OST_OPTIMISTIC.toast(msg, 'info'); return; } } catch (_) {} console.log('[perps]', msg); }
  function walletAddr() { try { var s = window.OST_WALLET && OST_WALLET.session; if (s && s.publicKey) return s.publicKey.toBase58 ? s.publicKey.toBase58() : String(s.publicKey); } catch (_) {} try { return (window.OST_PREDICTION_API && OST_PREDICTION_API.walletAddress && OST_PREDICTION_API.walletAddress()) || ''; } catch (_) { return ''; } }
  function playBal() { try { if (window.OST_PLAY && OST_PLAY.balance) { var b = OST_PLAY.balance(); return b == null ? undefined : Number(b); } } catch (_) {} return undefined; }
  function fetchJson(url, init, ms) {
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var t = setTimeout(function () { try { ctrl && ctrl.abort(); } catch (_) {} }, ms || 12000);
    init = Object.assign({ cache: 'no-store' }, init || {}); if (ctrl) init.signal = ctrl.signal;
    return fetch(url, init).then(function (r) { clearTimeout(t); return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok || j.ok === false || j.error) { var e = new Error(j.note || j.message || j.error || ('http ' + r.status)); e.code = j.error; e.detail = j; throw e; } return j; }); }, function (e) { clearTimeout(t); throw e; });
  }
  function post(path, body) { return fetchJson(API + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); }

  /* ---- same math as the server (perp-ledger.js) ---- */
  function liqPrice(side, entry, lev) { var f = 1 / lev - RULES.mmr; return side === 'long' ? entry * (1 - f) : entry * (1 + f); }
  function markPos(p, mark) {
    var move = (mark - p.entryPrice) / p.entryPrice, pnl = p.notional * (p.side === 'short' ? -move : move);
    var periods = Math.max(0, (Date.now() - p.openedAt) / RULES.fundingPeriodMs), funding = p.notional * (p.side === 'long' ? p.fundingRate : -p.fundingRate) * periods;
    var closeFee = p.notional * RULES.fee, equity = p.margin + pnl - funding - closeFee, liq = equity <= p.notional * RULES.mmr;
    if (liq) equity = 0;
    var profit = Math.max(0, equity - p.margin), payout = Math.max(0, equity - profit * RULES.edge);
    return { pnl: pnl, funding: funding, closeFee: closeFee, payout: payout, roe: p.margin > 0 ? (payout - p.margin) / p.margin : 0, liq: liq, move: move };
  }

  /* ---- state ---- */
  var S = { mode: 'spot', markets: [], rules: RULES, sel: null, side: 'long', margin: 25, lev: 5, range: '3m', positions: [], history: [], pending: [], hist: {}, lastMarkets: 0, lastPos: 0, loading: false, err: '' };
  try { S.mode = localStorage.getItem(MODE_KEY) === 'perps' ? 'perps' : 'spot'; } catch (_) {}
  function market(sym) { for (var i = 0; i < S.markets.length; i++) if (S.markets[i].symbol === sym) return S.markets[i]; return null; }
  function selected() { return market(S.sel) || S.markets[0] || null; }

  /* ---- data ---- */
  var marketsInFlight = null;
  function loadMarkets(force) {
    if (marketsInFlight) return marketsInFlight;
    if (!force && Date.now() - S.lastMarkets < 8000) return Promise.resolve(S.markets);
    marketsInFlight = fetchJson(API + '/play/perp/markets', null, 12000).then(function (j) {
      S.markets = Array.isArray(j.markets) ? j.markets : []; if (j.rules) { S.rules = Object.assign({}, RULES, j.rules); RULES = S.rules; }
      S.lastMarkets = Date.now(); S.err = '';
      if (!S.sel && S.markets.length) S.sel = S.markets[0].symbol;
      return S.markets;
    }).catch(function (e) { S.err = 'Perp markets are not answering right now.'; throw e; }).finally(function () { marketsInFlight = null; });
    return marketsInFlight;
  }
  var posInFlight = null;
  function loadPositions(force) {
    var w = walletAddr(); if (!w) { S.positions = []; S.history = []; return Promise.resolve([]); }
    if (posInFlight) return posInFlight;
    if (!force && Date.now() - S.lastPos < 8000) return Promise.resolve(S.positions);
    posInFlight = fetchJson(API + '/play/perp/positions?wallet=' + encodeURIComponent(w), null, 12000).then(function (j) {
      S.positions = Array.isArray(j.positions) ? j.positions : []; S.history = Array.isArray(j.history) ? j.history : []; S.lastPos = Date.now();
      // server truth arrived: drop optimistic placeholders that are now real
      S.pending = S.pending.filter(function (p) { return Date.now() - p.at < 15000 && !S.positions.some(function (x) { return x.id === p.id; }); });
      return S.positions;
    }).finally(function () { posInFlight = null; });
    return posInFlight;
  }
  function loadHistory(sym) {
    var c = S.hist[sym]; if (c && (c.p || Date.now() - c.at < 10 * 60000)) return c.p || Promise.resolve(c.pts);
    var p = fetchJson(API + '/stocks/' + encodeURIComponent(sym) + '/history', null, 15000).then(function (j) {
      var pts = (j.history || []).map(function (r) { return { t: Date.parse(r.date + 'T21:00:00Z') || 0, y: Number(r.close) }; }).filter(function (x) { return x.t > 0 && x.y > 0; });
      S.hist[sym] = { at: Date.now(), pts: pts }; return pts;
    }).catch(function () { S.hist[sym] = { at: Date.now() - 9 * 60000, pts: (c && c.pts) || [] }; return (c && c.pts) || []; });
    S.hist[sym] = { at: Date.now(), pts: (c && c.pts) || [], p: p };
    return p;
  }

  /* ---- mount ---- */
  var root = null, shell = null;
  function mount() {
    shell = document.querySelector('#stock-market .stock-shell'); if (!shell || $('ostPerps')) return !!shell;
    var top = shell.querySelector('.stock-topbar');
    var bar = document.createElement('div'); bar.className = 'opx-modebar'; bar.id = 'opxModeBar';
    bar.innerHTML = '<div class="opx-seg" role="tablist"><button type="button" data-mode="spot" role="tab">Spot mirror</button><button type="button" data-mode="perps" role="tab">Perps <em>new</em></button></div>' +
      '<div class="opx-modenote" id="opxModeNote"></div>';
    (top && top.parentNode === shell) ? shell.insertBefore(bar, top.nextSibling) : shell.insertBefore(bar, shell.firstChild);
    root = document.createElement('div'); root.id = 'ostPerps'; root.className = 'opx';
    root.innerHTML =
      '<div class="opx-hud" id="opxHud"></div>' +
      '<div class="opx-board" id="opxBoard"><div class="opx-empty">Loading perp markets…</div></div>' +
      '<div class="opx-main">' +
        '<div class="opx-chartcard">' +
          '<div class="opx-chead"><div><div class="opx-sym" id="opxSym">—</div><div class="opx-name" id="opxName"></div></div><div class="opx-price"><strong id="opxMark">—</strong><span id="opxChg"></span></div></div>' +
          '<div class="opx-stats" id="opxStats"></div>' +
          '<div class="opx-chartbox"><canvas class="opx-chart" id="opxChart" aria-label="Price history"></canvas><div class="opx-tip" id="opxTip"></div></div>' +
          '<div class="opx-ranges" id="opxRanges"><button type="button" data-r="1m">1M</button><button type="button" data-r="3m" class="on">3M</button><button type="button" data-r="1y">1Y</button><span class="src">Daily closes · live mark</span></div>' +
        '</div>' +
        '<aside class="opx-ticket" id="opxTicket"></aside>' +
      '</div>' +
      '<div class="opx-lower"><div class="opx-poscard"><div class="opx-h">Open positions <span class="sp"></span><span class="opx-muted" id="opxPosNote"></span></div><div id="opxPositions"><div class="opx-empty">No open perps.</div></div></div>' +
      '<div class="opx-poscard"><div class="opx-h">History</div><div id="opxHistory"><div class="opx-empty">Closed and liquidated positions show here.</div></div></div></div>' +
      '<div class="opx-fine">Perps settle in devnet OSTG on the OST play balance — no cash value. Entry, exit, funding and liquidation are computed by the OST server from public market data; max loss is your margin.</div>';
    bar.parentNode.insertBefore(root, bar.nextSibling);
    bar.addEventListener('click', function (e) { var b = e.target.closest('[data-mode]'); if (b) setMode(b.getAttribute('data-mode')); });
    root.addEventListener('click', onClick);
    root.addEventListener('input', onInput);
    wireChart();
    setMode(S.mode, true);
    return true;
  }
  function setMode(m, silent) {
    S.mode = m === 'perps' ? 'perps' : 'spot';
    try { localStorage.setItem(MODE_KEY, S.mode); } catch (_) {}
    if (shell) shell.classList.toggle('is-perps', S.mode === 'perps');
    document.querySelectorAll('#opxModeBar [data-mode]').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-mode') === S.mode); b.setAttribute('aria-selected', b.getAttribute('data-mode') === S.mode); });
    var note = $('opxModeNote'); if (note) note.textContent = S.mode === 'perps' ? 'Long or short with leverage · crypto 24/7 · stocks in market hours' : 'Mirror a stock 1:1 with OSTG';
    if (S.mode === 'perps') refresh(true);
  }

  /* ---- render ---- */
  function renderAll() { renderHud(); renderBoard(); renderSelected(); renderTicket(); renderPositions(); renderHistory(); }
  function renderHud() {
    var h = $('opxHud'); if (!h) return;
    var open = S.markets.filter(function (m) { return m.open; }).length, oi = 0; S.markets.forEach(function (m) { oi += (m.oiLong || 0) + (m.oiShort || 0); });
    var eq = 0, up = 0; S.positions.forEach(function (p) { var mk = marked(p); eq += mk.payout; up += mk.pnl; });
    var bal = playBal();
    h.innerHTML = '<div><div class="k"><span class="opx-dot' + (S.err ? '' : ' live') + '"></span>Markets live</div><div class="v">' + (S.markets.length ? open + ' / ' + S.markets.length : '—') + '</div></div>' +
      '<div><div class="k">Open interest</div><div class="v">' + ostg(oi, 0) + ' <small>OSTG</small></div></div>' +
      '<div><div class="k">Your positions</div><div class="v">' + S.positions.length + (S.positions.length ? ' · ' + ostg(eq, 2) : '') + '</div></div>' +
      '<div><div class="k">Unrealized P&amp;L</div><div class="v ' + (up >= 0 ? 'up' : 'down') + '">' + (S.positions.length ? signed(up) : '—') + '</div></div>' +
      '<div><div class="k">Play balance</div><div class="v gold">' + (bal === undefined ? '—' : ostg(bal)) + '</div></div>';
  }
  function renderBoard() {
    var b = $('opxBoard'); if (!b) return;
    if (!S.markets.length) { b.innerHTML = '<div class="opx-empty">' + (S.err ? esc(S.err) + ' <button type="button" class="opx-btn sm" data-act="retry">Retry</button>' : 'Loading perp markets…') + '</div>'; return; }
    var sel = selected();
    b.innerHTML = S.markets.map(function (m) {
      var oiT = (m.oiLong || 0) + (m.oiShort || 0), lp = oiT > 0 ? Math.round(m.oiLong / oiT * 100) : 50;
      var ch = num(m.changePct);
      return '<button type="button" class="opx-mkt' + (sel && sel.symbol === m.symbol ? ' on' : '') + (m.open ? '' : ' closed') + '" data-sym="' + esc(m.symbol) + '">' +
        '<div class="t"><span class="s">' + esc(m.symbol.replace('-USD', '')) + '<small>' + esc(m.kind === 'crypto' ? 'PERP · 24/7' : (m.open ? 'PERP' : 'CLOSED')) + '</small></span><span class="lev">' + m.maxLev + '×</span></div>' +
        '<div class="p">' + usd(m.mark) + '</div>' +
        '<div class="m"><span class="' + (ch === undefined ? '' : ch >= 0 ? 'up' : 'down') + '">' + (ch === undefined ? '—' : pct(ch)) + '</span><span class="f" title="funding per 8h">' + (num(m.fundingRate) === undefined ? '' : 'fund ' + pct(m.fundingRate, 3)) + '</span></div>' +
        '<div class="oi"><i style="width:' + lp + '%"></i></div></button>';
    }).join('');
  }
  var chartPts = [], chartGeom = null;
  function renderSelected() {
    var m = selected(); if (!m) return;
    var sy = $('opxSym'), nm = $('opxName'), mk = $('opxMark'), ch = $('opxChg');
    if (sy) sy.textContent = m.symbol.replace('-USD', '') + '-PERP'; if (nm) nm.textContent = m.name + (m.open ? '' : ' · market closed');
    if (mk) mk.textContent = usd(m.mark); if (ch) { var c = num(m.changePct); ch.textContent = c === undefined ? '' : pct(c) + ' 24h'; ch.className = c === undefined ? '' : c >= 0 ? 'up' : 'down'; }
    var st = $('opxStats'); if (st) { var oiT = (m.oiLong || 0) + (m.oiShort || 0);
      st.innerHTML = '<div><span>Funding / 8h</span><strong class="' + (m.fundingRate > 0 ? 'down' : 'up') + '">' + pct(m.fundingRate, 3) + '</strong><small>' + (m.fundingRate > 0 ? 'longs pay shorts' : 'shorts pay longs') + '</small></div>' +
        '<div><span>Open interest</span><strong>' + ostg(oiT, 0) + '</strong><small>' + (oiT > 0 ? Math.round(m.oiLong / oiT * 100) + '% long' : 'no positions yet') + '</small></div>' +
        '<div><span>Max leverage</span><strong>' + m.maxLev + '×</strong><small>maint. ' + (RULES.mmr * 100).toFixed(1) + '%</small></div>' +
        '<div><span>Fee</span><strong>' + (RULES.fee * 100).toFixed(2) + '%</strong><small>open + close</small></div>'; }
    paintChart();
  }
  function rangePts(pts) { var R = { '1m': 31, '3m': 93, '1y': 400 }[S.range] || 93; var from = Date.now() - R * 864e5; var out = pts.filter(function (p) { return p.t >= from; }); return out.length > 1 ? out : pts; }
  function paintChart() {
    var m = selected(), c = $('opxChart'); if (!m || !c || !window.OST_MARKET_CHART) return;
    var sym = m.symbol;
    loadHistory(sym).then(function (pts) {
      var cur = selected(); if (!cur || cur.symbol !== sym) return;
      var arr = rangePts(pts).slice(); if (num(cur.mark) !== undefined && arr.length) arr.push({ t: Date.now(), y: cur.mark, live: true });
      chartPts = arr;
      chartGeom = OST_MARKET_CHART.draw(c, arr, { axis: true, scale: 'price', color: 'auto', fmt: function (v) { return usd(v, v >= 1000 ? 0 : 2); }, padRight: 62 });
      if (!chartGeom) { var s = c.getContext('2d'); s.font = '12px system-ui'; s.fillStyle = 'rgba(160,184,203,.8)'; s.fillText(pts.length ? 'Loading…' : 'No price history for ' + sym + ' yet.', 10, 24); }
    });
  }
  function wireChart() {
    var c = $('opxChart'), tip = $('opxTip'); if (!c) return;
    function at(e) {
      if (!chartGeom || chartPts.length < 2) return; var g = chartGeom, r = c.getBoundingClientRect(), px = e.clientX - r.left;
      var t = g.t0 + (px - g.padL) / (g.w - g.padL - g.padR) * (g.t1 - g.t0), best = 0, bd = Infinity;
      chartPts.forEach(function (p, i) { var d = Math.abs(p.t - t); if (d < bd) { bd = d; best = i; } });
      var p = chartPts[best], d = new Date(p.t);
      OST_MARKET_CHART.draw(c, chartPts, { axis: true, scale: 'price', color: 'auto', fmt: function (v) { return usd(v, v >= 1000 ? 0 : 2); }, padRight: 62, cross: best });
      tip.innerHTML = '<b>' + usd(p.y) + '</b>' + esc(p.live ? 'now' : d.toLocaleDateString([], { month: 'short', day: 'numeric', year: '2-digit' }));
      tip.style.left = Math.max(60, Math.min(r.width - 60, g.X(p.t))) + 'px'; tip.classList.add('on');
    }
    c.addEventListener('pointermove', at, { passive: true }); c.addEventListener('pointerdown', at, { passive: true });
    c.addEventListener('pointerleave', function () { tip.classList.remove('on'); paintChart(); });
    if ('ResizeObserver' in window) new ResizeObserver(function () { paintChart(); }).observe(c);
  }
  function ticketCalc(m) {
    var lev = Math.max(1, Math.min(m.maxLev, Math.floor(S.lev))), margin = Math.max(0, Number(S.margin) || 0), notional = margin * lev;
    var fee = notional * RULES.fee, mark = num(m.mark);
    return { lev: lev, margin: margin, notional: notional, fee: fee, cost: margin + fee, liq: mark ? liqPrice(S.side, mark, lev) : NaN, mark: mark, size: mark ? notional / mark : 0, liqDist: mark ? Math.abs((liqPrice(S.side, mark, lev) - mark) / mark) : NaN, funding8h: notional * (S.side === 'long' ? 1 : -1) * (num(m.fundingRate) || 0) };
  }
  function renderTicket() {
    var t = $('opxTicket'), m = selected(); if (!t) return;
    if (!m) { t.innerHTML = '<div class="opx-empty">Pick a market.</div>'; return; }
    if (S.lev > m.maxLev) S.lev = m.maxLev;
    var k = ticketCalc(m), w = walletAddr(), bal = playBal();
    var reason = !w ? 'Connect a wallet to trade perps.' : !m.open ? (m.symbol.replace('-USD', '') + ' is closed right now — stock perps open in market hours. Crypto trades 24/7.') : !(k.margin >= RULES.minMargin) ? ('Minimum margin is ' + RULES.minMargin + ' OSTG.') : (bal !== undefined && bal + 1e-9 < k.cost) ? ('Not enough play OSTG (need ' + ostg(k.cost) + ', have ' + ostg(bal) + ').') : '';
    var sideLab = S.side === 'long' ? 'Long' : 'Short';
    t.innerHTML =
      '<div class="opx-th"><span class="opx-kicker">Perp ticket</span><h3>' + esc(m.symbol.replace('-USD', '')) + ' · ' + sideLab + ' ' + k.lev + '×</h3></div>' +
      '<div class="opx-sides"><button type="button" class="l' + (S.side === 'long' ? ' on' : '') + '" data-side="long">Long ▲</button><button type="button" class="s' + (S.side === 'short' ? ' on' : '') + '" data-side="short">Short ▼</button></div>' +
      '<label class="opx-lab">Margin (OSTG)<div class="opx-amt"><input id="opxMargin" inputmode="decimal" type="number" min="1" step="1" value="' + esc(S.margin) + '"><span>OSTG</span></div></label>' +
      '<div class="opx-quick">' + [10, 25, 100, 'Max'].map(function (q) { return '<button type="button" data-q="' + String(q).toLowerCase() + '">' + q + '</button>'; }).join('') + '</div>' +
      '<label class="opx-lab">Leverage <b id="opxLevV">' + k.lev + '×</b><input id="opxLev" type="range" min="1" max="' + m.maxLev + '" step="1" value="' + k.lev + '"></label>' +
      '<div class="opx-levmarks">' + [1, Math.round(m.maxLev / 4), Math.round(m.maxLev / 2), m.maxLev].filter(function (v, i, a) { return a.indexOf(v) === i; }).map(function (v) { return '<button type="button" data-lev="' + v + '"' + (v === k.lev ? ' class="on"' : '') + '>' + v + '×</button>'; }).join('') + '</div>' +
      '<div class="opx-bd">' +
        '<div><span>Entry (mark)</span><b>' + usd(k.mark) + '</b></div>' +
        '<div><span>Notional</span><b>' + ostg(k.notional) + ' OSTG</b></div>' +
        '<div><span>Size</span><b>' + (k.size ? k.size.toFixed(k.size >= 100 ? 1 : 4) : '—') + ' ' + esc(m.symbol.replace('-USD', '')) + '</b></div>' +
        '<div><span>Liquidation</span><b class="down">' + usd(k.liq) + (Number.isFinite(k.liqDist) ? ' <small>(' + (k.liqDist * 100).toFixed(1) + '% away)</small>' : '') + '</b></div>' +
        '<div><span>Open fee (' + (RULES.fee * 100).toFixed(2) + '%)</span><b>' + ostg(k.fee) + '</b></div>' +
        '<div><span>Funding / 8h</span><b class="' + (k.funding8h > 0 ? 'down' : 'up') + '">' + (k.funding8h > 0 ? '−' : '+') + ostg(Math.abs(k.funding8h), 3) + '</b></div>' +
        '<div class="big"><span>You pay now</span><b>' + ostg(k.cost) + ' OSTG</b></div>' +
      '</div>' +
      '<div class="opx-status' + (reason ? ' warn' : '') + '" id="opxStatus">' + esc(reason || ('Max loss ' + ostg(k.margin) + ' OSTG (your margin). A ' + (100 / k.lev).toFixed(1) + '% move against you ≈ liquidation.')) + '</div>' +
      '<button type="button" class="opx-go ' + (S.side === 'long' ? 'l' : 's') + '" id="opxGo"' + (reason ? ' disabled' : '') + '>' + (reason && !w ? 'Connect wallet' : 'Open ' + sideLab + ' ' + k.lev + '× · ' + ostg(k.margin, 0) + ' OSTG') + '</button>' +
      '<div class="opx-fine">Fees: ' + (RULES.fee * 100).toFixed(2) + '% to open and close · ' + Math.round(RULES.edge * 100) + '% of profit house edge · funding accrues pro-rata.</div>';
  }
  function marked(p) { var m = market(p.symbol); var mk = num(p.mark) !== undefined ? p.mark : (m && num(m.mark)); if (mk === undefined || mk === null) return { pnl: 0, payout: p.margin, roe: 0, funding: 0, liq: false, mark: undefined }; var r = markPos(p, mk); r.mark = mk; return r; }
  function renderPositions() {
    var host = $('opxPositions'), note = $('opxPosNote'); if (!host) return;
    var rows = S.pending.map(function (p) { return '<div class="opx-pos pending"><div class="l"><b>' + esc(p.symbol.replace('-USD', '')) + '</b> <span class="side ' + p.side + '">' + p.side + ' ' + p.leverage + '×</span><span class="opx-muted"> · opening…</span></div><div class="r"><span class="opx-muted">' + ostg(p.margin) + ' OSTG margin</span></div></div>'; });
    S.positions.forEach(function (p) {
      var k = marked(p), dist = num(k.mark) !== undefined ? (p.side === 'long' ? (k.mark - p.liqPrice) / k.mark : (p.liqPrice - k.mark) / k.mark) : NaN;
      var distPct = Number.isFinite(dist) ? Math.max(0, Math.min(1, dist / (1 / p.leverage))) : 1;
      rows.push('<div class="opx-pos' + (p.__closing ? ' pending' : '') + '" data-id="' + esc(p.id) + '">' +
        '<div class="l"><b>' + esc(p.symbol.replace('-USD', '')) + '</b> <span class="side ' + p.side + '">' + p.side + ' ' + p.leverage + '×</span>' +
          '<div class="opx-muted">' + ostg(p.notional, 0) + ' OSTG notional · entry ' + usd(p.entryPrice) + ' → ' + usd(k.mark) + ' · ' + ago(p.openedAt) + '</div>' +
          '<div class="liq"><span>liq ' + usd(p.liqPrice) + '</span><i class="bar"><em style="width:' + Math.round(distPct * 100) + '%;background:' + (distPct < .25 ? 'var(--opx-no)' : distPct < .5 ? 'var(--opx-gold)' : 'var(--opx-yes)') + '"></em></i><span>' + (Number.isFinite(dist) ? (dist * 100).toFixed(1) + '% away' : '') + '</span></div></div>' +
        '<div class="r"><div class="pnl ' + (k.pnl >= 0 ? 'up' : 'down') + '">' + signed(k.pnl) + ' <small>' + pct(k.roe, 1) + '</small></div><div class="opx-muted">margin ' + ostg(p.margin) + (k.funding ? ' · funding ' + signed(-k.funding, 3) : '') + '</div>' +
          '<button type="button" class="opx-btn sm' + (k.pnl >= 0 ? ' ok' : '') + '" data-close="' + esc(p.id) + '"' + (p.__closing ? ' disabled' : '') + '>' + (p.__closing ? 'Closing…' : 'Close · ' + ostg(k.payout)) + '</button></div></div>');
    });
    host.innerHTML = rows.length ? rows.join('') : '<div class="opx-empty">' + (walletAddr() ? 'No open perps. Pick a market and open a long or short.' : 'Connect a wallet to see your perps.') + '</div>';
    if (note) note.textContent = S.positions.length ? S.positions.length + ' open · marks refresh every 10s' : '';
  }
  function renderHistory() {
    var host = $('opxHistory'); if (!host) return;
    if (!S.history.length) { host.innerHTML = '<div class="opx-empty">Closed and liquidated positions show here.</div>'; return; }
    host.innerHTML = S.history.slice(0, 25).map(function (p) {
      var pl = (Number(p.payout) || 0) - (Number(p.margin) || 0);
      return '<div class="opx-pos hist"><div class="l"><b>' + esc(p.symbol.replace('-USD', '')) + '</b> <span class="side ' + p.side + '">' + p.side + ' ' + p.leverage + '×</span> <span class="tag ' + (p.status === 'liquidated' ? 'liq' : '') + '">' + esc(p.status) + '</span>' +
        '<div class="opx-muted">' + usd(p.entryPrice) + ' → ' + usd(p.exitPrice) + ' · ' + ostg(p.notional, 0) + ' notional · ' + ago(p.closedAt) + '</div></div>' +
        '<div class="r"><div class="pnl ' + (pl >= 0 ? 'up' : 'down') + '">' + signed(pl) + ' <small>' + pct(p.margin > 0 ? pl / p.margin : 0, 1) + '</small></div><div class="opx-muted">paid ' + ostg(p.payout) + '</div></div></div>';
    }).join('');
  }

  /* ---- actions ---- */
  function onInput(e) {
    if (e.target.id === 'opxMargin') { S.margin = parseFloat(e.target.value) || 0; softTicket(); }
    else if (e.target.id === 'opxLev') { S.lev = parseInt(e.target.value, 10) || 1; softTicket(); }
  }
  // Patch the numbers in place while typing (never rebuild the inputs under the user's finger).
  function softTicket() {
    var m = selected(); if (!m) return; var k = ticketCalc(m);
    var lv = $('opxLevV'); if (lv) lv.textContent = k.lev + '×';
    var h3 = document.querySelector('#opxTicket .opx-th h3'); if (h3) h3.textContent = m.symbol.replace('-USD', '') + ' · ' + (S.side === 'long' ? 'Long' : 'Short') + ' ' + k.lev + '×';
    document.querySelectorAll('#opxTicket [data-lev]').forEach(function (b) { b.classList.toggle('on', Number(b.getAttribute('data-lev')) === k.lev); });
    var bd = document.querySelector('#opxTicket .opx-bd'); if (bd) { var bs = bd.querySelectorAll('b'); if (bs.length >= 7) { bs[1].textContent = ostg(k.notional) + ' OSTG'; bs[2].textContent = (k.size ? k.size.toFixed(k.size >= 100 ? 1 : 4) : '—') + ' ' + m.symbol.replace('-USD', ''); bs[3].innerHTML = usd(k.liq) + (Number.isFinite(k.liqDist) ? ' <small>(' + (k.liqDist * 100).toFixed(1) + '% away)</small>' : ''); bs[4].textContent = ostg(k.fee); bs[5].textContent = (k.funding8h > 0 ? '−' : '+') + ostg(Math.abs(k.funding8h), 3); bs[5].className = k.funding8h > 0 ? 'down' : 'up'; bs[6].textContent = ostg(k.cost) + ' OSTG'; } }
    var go = $('opxGo'), st = $('opxStatus'), bal = playBal(), w = walletAddr();
    var reason = !w ? 'Connect a wallet to trade perps.' : !m.open ? 'Market closed right now.' : !(k.margin >= RULES.minMargin) ? ('Minimum margin is ' + RULES.minMargin + ' OSTG.') : (bal !== undefined && bal + 1e-9 < k.cost) ? ('Not enough play OSTG (need ' + ostg(k.cost) + ', have ' + ostg(bal) + ').') : '';
    if (st) { st.textContent = reason || ('Max loss ' + ostg(k.margin) + ' OSTG (your margin). A ' + (100 / k.lev).toFixed(1) + '% move against you ≈ liquidation.'); st.classList.toggle('warn', !!reason); }
    if (go) { go.disabled = !!reason; go.textContent = (reason && !w) ? 'Connect wallet' : 'Open ' + (S.side === 'long' ? 'Long' : 'Short') + ' ' + k.lev + '× · ' + ostg(k.margin, 0) + ' OSTG'; go.className = 'opx-go ' + (S.side === 'long' ? 'l' : 's'); }
  }
  function onClick(e) {
    var t = e.target;
    var mk = t.closest('[data-sym]'); if (mk) { S.sel = mk.getAttribute('data-sym'); renderBoard(); renderSelected(); renderTicket(); return; }
    var sd = t.closest('[data-side]'); if (sd) { S.side = sd.getAttribute('data-side') === 'short' ? 'short' : 'long'; renderTicket(); return; }
    var q = t.closest('[data-q]'); if (q) { var v = q.getAttribute('data-q'); S.margin = v === 'max' ? Math.max(1, Math.floor((playBal() || 0) / (1 + RULES.fee * S.lev))) : parseFloat(v); renderTicket(); return; }
    var lv = t.closest('[data-lev]'); if (lv) { S.lev = parseInt(lv.getAttribute('data-lev'), 10) || 1; renderTicket(); return; }
    var rg = t.closest('#opxRanges [data-r]'); if (rg) { S.range = rg.getAttribute('data-r'); document.querySelectorAll('#opxRanges [data-r]').forEach(function (b) { b.classList.toggle('on', b === rg); }); paintChart(); return; }
    if (t.closest('[data-act="retry"]')) { refresh(true); return; }
    if (t.closest('#opxGo')) { openPosition(); return; }
    var cl = t.closest('[data-close]'); if (cl) { closePosition(cl.getAttribute('data-close')); return; }
  }
  function balanceBump(delta) { try { if (window.OST_PLAY && OST_PLAY.refresh) setTimeout(function () { OST_PLAY.refresh(); }, 400); } catch (_) {} try { window.dispatchEvent(new CustomEvent('ost:money:change', { detail: { source: 'perps', delta: delta } })); } catch (_) {} }
  function openPosition() {
    var m = selected(), w = walletAddr(); if (!m || !w) { if (!w) try { if (typeof window.connectWallet === 'function') window.connectWallet(); } catch (_) {} return; }
    var k = ticketCalc(m); if (!(k.margin >= RULES.minMargin)) return;
    var go = $('opxGo'); if (go) { go.disabled = true; go.textContent = 'Opening…'; }
    // OPTIMISTIC: the position shows the instant they tap; the server fill replaces it.
    var tmp = { id: 'tmp_' + Date.now().toString(36), at: Date.now(), symbol: m.symbol, side: S.side, leverage: k.lev, margin: k.margin };
    S.pending.push(tmp); renderPositions();
    post('/play/perp/open', { wallet: w, symbol: m.symbol, side: S.side, margin: k.margin, leverage: k.lev }).then(function (j) {
      S.pending = S.pending.filter(function (p) { return p !== tmp; });
      if (j.position) { S.positions.unshift(j.position); S.lastPos = Date.now(); }
      toast('Opened ' + (S.side === 'long' ? 'long' : 'short') + ' ' + k.lev + '× ' + m.symbol.replace('-USD', '') + ' at ' + usd(j.position && j.position.entryPrice) + '.');
      balanceBump(-k.cost); renderAll(); loadMarkets(true).then(renderAll).catch(function () {});
      setTimeout(function () { loadPositions(true).then(renderAll).catch(function () {}); }, 1500);
    }).catch(function (e) {
      S.pending = S.pending.filter(function (p) { return p !== tmp; }); renderPositions(); renderTicket();
      toast('Could not open: ' + ((e && e.message) || 'try again') + '.');
    });
  }
  function closePosition(id) {
    var p = S.positions.filter(function (x) { return x.id === id; })[0], w = walletAddr(); if (!p || !w || p.__closing) return;
    p.__closing = true; renderPositions();
    var est = marked(p);
    post('/play/perp/close', { wallet: w, id: id }).then(function (j) {
      S.positions = S.positions.filter(function (x) { return x.id !== id; });
      if (j.position) S.history.unshift(j.position);
      var pl = (Number(j.payout) || 0) - (Number(p.margin) || 0);
      toast((j.status === 'liquidated' ? 'Liquidated — ' : 'Closed — ') + signed(pl) + ' OSTG (' + pct(p.margin > 0 ? pl / p.margin : 0, 1) + ').');
      balanceBump(Number(j.payout) || 0); renderAll(); loadMarkets(true).then(renderAll).catch(function () {});
    }).catch(function (e) {
      p.__closing = false; renderPositions();
      if (e && e.detail && e.detail.replay) { loadPositions(true).then(renderAll); return; }
      toast('Could not close: ' + ((e && e.message) || 'try again') + '.');
    });
    void est;
  }

  /* ---- refresh loop ---- */
  var visible = false;
  function refresh(force) {
    if (S.mode !== 'perps') return;
    Promise.all([loadMarkets(force).catch(function () {}), loadPositions(force).catch(function () {})]).then(renderAll);
  }
  function boot() {
    if (!mount()) { var n = 0; var iv = setInterval(function () { if (mount() || ++n > 40) clearInterval(iv); }, 500); }
    if ('IntersectionObserver' in window) { var tries = 0; (function w() { var sec = $('stock-market'); if (!sec) { if (++tries < 40) setTimeout(w, 500); return; } new IntersectionObserver(function (en) { visible = en.some(function (x) { return x.isIntersecting; }); if (visible) refresh(false); }).observe(sec); })(); }
    setInterval(function () { if (visible && !document.hidden && S.mode === 'perps') refresh(false); }, 10000);
    ['ost:wallet-changed', 'ost:play:balance', 'ost:money:change', 'ost:balance'].forEach(function (n) { window.addEventListener(n, function () { if (S.mode === 'perps') { renderHud(); softTicket(); } }); });
    window.addEventListener('ost:wallet-changed', function () { S.lastPos = 0; if (S.mode === 'perps') refresh(true); });
    window.addEventListener('ost:realtime', function (e) {
      var ev = e.detail; if (!ev || !/^perp\./.test(String(ev.type || ''))) return;
      if (ev.type === 'perp.liquidated' && ev.wallet && ev.wallet === walletAddr()) toast('Your ' + String(ev.payload && ev.payload.symbol || '').replace('-USD', '') + ' ' + (ev.payload && ev.payload.side) + ' was liquidated at ' + usd(ev.payload && ev.payload.mark) + '.');
      S.lastPos = 0; S.lastMarkets = 0; if (S.mode === 'perps') refresh(true);
    });
    window.addEventListener('resize', function () { clearTimeout(boot._rt); boot._rt = setTimeout(paintChart, 200); });
  }
  window.OST_PERPS = { open: function (sym) { setMode('perps'); if (sym) { S.sel = sym; } refresh(true); try { $('stock-market').scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (_) {} }, mode: setMode, state: function () { return S; }, refresh: function () { refresh(true); } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();

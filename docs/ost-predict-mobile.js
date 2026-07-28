/* ==========================================================================
 * OST · Predict Mobile — v4 design, real data, ALL markets.
 * --------------------------------------------------------------------------
 * Two views inside one clean surface:
 *   BROWSE  — main menu + search + every real market (crypto 5-min, Polymarket,
 *             Kalshi, parlays…) from window.__ostPredictionMarkets, the SAME
 *             ranked list the app already computes.
 *   DETAIL  — the approved v4 market page. BTC 5-min gets the full live
 *             treatment (odometer price + green/red price-to-beat graph from
 *             /btc/round + the ost:btc-spot stream). Every other market gets a
 *             standard detail (probability + stats) — no fabricated crypto graph.
 *
 * SAFE MONEY REUSE (no new money code):
 *   · BUY  -> OST_PREDICTION_API.placeBet({marketId, side, stake}) — the proven
 *             path; it drives the (hidden-but-live) board/desk for any market.
 *   · SELL/SETTLE -> triggers the existing ledger cash-out button for the user's
 *             position (app.js owns payout/fee/bucket rules).
 *
 * Old chrome stays in the DOM (hidden by CSS) so all those money paths work
 * underneath; this surface just drives them.
 * ========================================================================== */
(function () {
  'use strict';
  if (window.OST_PREDICT_MOBILE) return;
  var API = (window.OST_API_BASE || 'https://ost-api.nachogtavl.workers.dev').replace(/\/+$/, '');
  var RM = matchMedia('(prefers-reduced-motion:reduce)').matches;

  var P = {
    btc: 'M9 8h5a2.5 2.5 0 010 5H9zm0 5h5.5a2.5 2.5 0 010 5H9zm0-5V5m3 0v3m-3 13v-3m3 3v-3',
    eth: 'M12 3l6 9-6 3-6-3zM6 13l6 3 6-3-6 8z', sol: 'M6 8h10l-2 2H4zm2 4h12l-2 2H6zm-2 4h10l-2 2H4z',
    scale: 'M12 3v18M6 7l-3 6h6zM18 7l3 6h-6M3 13a3 3 0 006 0M15 13a3 3 0 006 0M8 21h8',
    trades: 'M3 17l6-6 4 4 8-8M15 7h6v6',
    users: 'M9 11a3 3 0 100-6 3 3 0 000 6zM3 20a6 6 0 0112 0M17 11a3 3 0 10-1-5.8M21 20a6 6 0 00-4-5.6',
    chat: 'M4 5h16v11H9l-5 4z',
    ticket: 'M4 8a2 2 0 012-2h12a2 2 0 012 2 2 2 0 000 4 2 2 0 000 4 2 2 0 01-2 2H6a2 2 0 01-2-2 2 2 0 000-4 2 2 0 000-4zM12 6v12',
    lock: 'M6 11h12v9H6zM8 11V7a4 4 0 018 0v4', coin: 'M12 3a9 9 0 100 18 9 9 0 000-18zM9 12h6M12 9v6',
    go: 'M5 12h14M13 6l6 6-6 6', back: 'M15 5l-7 7 7 7', search: 'M11 4a7 7 0 105 12l4 4M11 4a7 7 0 015 12',
    bolt: 'M13 3L4 14h7l-1 7 9-11h-7z', flag: 'M5 21V4h11l-2 4 2 4H5', ball: 'M12 3a9 9 0 100 18 9 9 0 000-18zM12 3v18M3 12h18',
    chart: 'M3 17l5-5 4 3 6-7M21 8v4h-4', globe: 'M12 3a9 9 0 100 18 9 9 0 000-18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18',
    star: 'M12 3l2.5 6L21 9l-5 4 2 7-6-4-6 4 2-7-5-4 6.5 0z', layers: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5', grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z'
  };
  function icon(n, c) { var d = P[n] || P.grid; return '<svg class="opm-ic ' + (c || '') + '" viewBox="0 0 24 24">' + d.split('M').filter(Boolean).map(function (s) { return '<path d="M' + s + '"/>'; }).join('') + '</svg>'; }
  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function el(id) { return document.getElementById(id); }
  function ago(ts) { var n = Number(ts); if (!n || !isFinite(n)) { var d = Date.parse(ts); n = isFinite(d) ? d : 0; } if (!n) return ''; var s = Math.max(0, Math.round((Date.now() - n) / 1000)); if (s < 60) return s + 's'; if (s < 3600) return Math.floor(s / 60) + 'm'; if (s < 86400) return Math.floor(s / 3600) + 'h'; return Math.floor(s / 86400) + 'd'; }
  function compact(n) { n = Number(n) || 0; if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M'; if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + 'k'; return Math.round(n).toString(); }
  function num0(v) { return Math.round(v).toLocaleString(); }

  /* ---- state ---- */
  var view = 'browse';
  var cat = 'all', query = '';
  var currentMarket = null;      // selected market object (detail)
  var round = null;              // /btc/round (BTC live detail only)
  var price = 0, beat = 0, midYes = 50, hrs = 1, hist = [], HIST_MAX = 400;
  var side = 'yes', poolY = 0, poolN = 0, myPos = null;
  var seenTrades = {}, firstTrades = true;

  /* ---- TICK ENGINE (interpolated playback) ----------------------------------
   * The number people watch must ALWAYS glide at a CONSTANT, LINEAR rate — never
   * freeze, never snap. Real BTC ticks arrive irregularly (bursts, then gaps), so
   * driving the display straight off them looks jumpy. Instead every tick is
   * stored TIMESTAMPED in `buf`, and the display renders the price as it was
   * `DELAY` ms in the PAST, LINEARLY interpolating between the two real ticks that
   * bracket that render-time. Playing back on a small delay means there is almost
   * always a "next" real sample to glide toward, so motion is piecewise-linear
   * (constant velocity between ticks) with no exponential easing and no burst
   * jump. DELAY auto-tracks the feed's own cadence so it works whether ticks come
   * 2/sec or 1/5sec. If ticks stall, we drift along the last segment at half speed
   * (capped) so the number keeps breathing without fabricating a big move. Share
   * prices (YES/NO cents), P&L and the graph all read this SAME interpolated
   * price — every number on screen flows from one honest source. */
  var buf = [], DELAY = 1600, dispPrice = 0, headPrice = 0, flowOn = false, lastDraw = 0, baseMidSet = false;
  var _lastTickAt = 0, _gapEMA = 1200;   // exponential moving avg of inter-tick gap -> adaptive DELAY
  var onchainActive = false;   // true when this round's bets live in the Solana program vault

  /* ---- odometer ---- */
  function tween(elm, to, fmt, dur) {
    if (!elm) return; var from = (elm._v == null ? to : elm._v); elm._v = to;
    if (RM || from === to) { elm.textContent = fmt(to); return; }
    var t0 = performance.now(); dur = dur || 500;
    function fr(t) { var k = Math.min(1, (t - t0) / dur); elm.textContent = fmt(from + (to - from) * k); if (k < 1) requestAnimationFrame(fr); }
    requestAnimationFrame(fr);
  }
  var usd = function (v) { return '$' + Math.round(v).toLocaleString(); };
  var cents = function (v) { return Math.round(v) + '¢'; };

  /* ---- market helpers ---- */
  function allMarkets() { try { return Array.isArray(window.__ostPredictionMarkets) ? window.__ostPredictionMarkets : []; } catch (_) { return []; } }
  function isBtcLive(m) { return m && /^ost-btc5m/.test(String(m.id || '')); }
  function isNative5m(m) { return m && (/^ost-(btc|eth|sol)5m/.test(String(m.id || '')) || (m.isOstNative && /minute|5-?min/i.test(String(m.title || '') + ' ' + String(m.contractLabel || '')))); }
  function yesCents(m) {
    var v = Number(m && m.yesPriceNumber);
    if (!isFinite(v)) v = parseFloat(String((m && m.yesValue) || '').replace(/[^\d.]/g, ''));
    if (!isFinite(v)) return 50;
    if (v > 0 && v <= 1) v *= 100;
    return Math.max(1, Math.min(99, Math.round(v)));
  }
  function marketIcon(m) {
    var s = ((m && m.title) || '') + ' ' + ((m && m.topic) || '') + ' ' + ((m && m.contractLabel) || '') + ' ' + ((m && m.searchText) || '');
    s = s.toLowerCase();
    if (/btc|bitcoin/.test(s)) return 'btc'; if (/eth|ether/.test(s)) return 'eth'; if (/\bsol\b|solana/.test(s)) return 'sol';
    if (/elect|senate|president|trump|fed|rate|congress|vote|政/.test(s)) return 'flag';
    if (/nba|nfl|nhl|mlb|cup|league|match|game|win\b|vs\b/.test(s)) return 'ball';
    if (/gdp|cpi|inflation|stock|s&p|nasdaq|jobs|econ/.test(s)) return 'chart';
    if (/weather|temp|climate|world|country|war/.test(s)) return 'globe';
    if (/parlay/.test(s)) return 'layers';
    return 'star';
  }
  var CATS = [
    { k: 'all', label: 'All', ic: 'grid' },
    { k: 'live', label: 'Live 5-min', ic: 'bolt' },
    { k: 'crypto', label: 'Crypto', ic: 'btc' },
    { k: 'politics', label: 'Politics', ic: 'flag' },
    { k: 'sports', label: 'Sports', ic: 'ball' },
    { k: 'econ', label: 'Economy', ic: 'chart' },
    { k: 'world', label: 'World', ic: 'globe' },
    { k: 'parlay', label: 'Parlays', ic: 'layers' }
  ];
  function catMatch(m, k) {
    if (k === 'all') return true;
    if (k === 'live') return isNative5m(m);
    var s = (((m.title || '') + ' ' + (m.topic || '') + ' ' + (m.contractLabel || '') + ' ' + (m.searchText || '')) || '').toLowerCase();
    if (k === 'crypto') return /btc|bitcoin|eth|ether|\bsol\b|solana|crypto|coin/.test(s);
    if (k === 'politics') return /elect|senate|president|trump|fed|rate|congress|vote|politic/.test(s);
    if (k === 'sports') return /nba|nfl|nhl|mlb|cup|league|match|game|sport|vs\b/.test(s);
    if (k === 'econ') return /gdp|cpi|inflation|stock|s&p|nasdaq|jobs|econ|rate/.test(s);
    if (k === 'world') return /weather|temp|climate|world|country|war|global/.test(s);
    if (k === 'parlay') return /parlay/.test(s) || /^ost-parlay/.test(String(m.id || ''));
    return true;
  }

  /* ---- balance / wallet ---- */
  function walletAddr() { try { return (window.OST_PREDICTION_API && OST_PREDICTION_API.walletAddress && OST_PREDICTION_API.walletAddress()) || ''; } catch (_) { return ''; } }
  function meshHandle() { try { if (window.OST_MESH_IDENTITY && OST_MESH_IDENTITY.handle) return OST_MESH_IDENTITY.handle; } catch (_) {} return ''; }
  function ledgerOrders() { try { return (window.OST_PREDICTION_API && OST_PREDICTION_API.ledger && OST_PREDICTION_API.ledger()) || []; } catch (_) { return []; } }
  // The user's REAL total OSTG: their on-chain wallet OSTG token (DfgxMbdN, the
  // actual wallet funds) + the custodial play OSTG (OST_PLAY). Both are real
  // OSTG; showing the sum means the header reflects actual wallet funds AND
  // moves when a bet debits play. Never the credits pool. Unknown stays unknown
  // (last-known cache in OST_SESSION keeps it from flashing to 0 on a 429).
  function playBal() {
    var w, p, known = false;
    try { if (window.OST_SESSION && OST_SESSION.walletBalance) { w = OST_SESSION.walletBalance(); if (w != null) known = true; } } catch (_) {}
    try { if (window.OST_PLAY && OST_PLAY.balance) { p = OST_PLAY.balance(); if (p != null) known = true; } } catch (_) {}
    if (known) return (Number(w) || 0) + (Number(p) || 0);
    try { if (window.OST_SESSION && OST_SESSION.spendable) { var s = OST_SESSION.spendable(); if (s !== undefined) return s; } } catch (_) {}
    return undefined;
  }
  // Optimistic hold: after a bet/sell we show the expected balance and refuse to
  // let a slow reconcile-read bounce it the WRONG way before the server confirms
  // — that bounce is what made buying feel non-optimistic.
  var _balHold = null;   // { v, dir:'down'|'up', until }
  function setBalDisplay(v) {
    if (v != null && _balHold && Date.now() < _balHold.until) {
      var nv = Number(v);
      if (_balHold.dir === 'down' && nv > _balHold.v + 0.001) v = _balHold.v;
      else if (_balHold.dir === 'up' && nv < _balHold.v - 0.001) v = _balHold.v;
      else _balHold = null;   // the real balance crossed the optimistic point -> release
    }
    document.querySelectorAll('#ostPredictMobile .opm-balv').forEach(function (e) { e.textContent = (v == null ? '—' : Number(Math.max(0, v)).toLocaleString(undefined, { maximumFractionDigits: 2 })); });
  }
  function refreshBalance() {
    try { if (window.OST_SESSION && OST_SESSION.refresh) OST_SESSION.refresh(); } catch (_) {}
    try { if (window.OST_PLAY && OST_PLAY.refresh) OST_PLAY.refresh(); } catch (_) {}
    var b = playBal();
    setBalDisplay(b);
    var f = ''; try { if (window.OST_CCY && OST_CCY.fiat && b != null) f = OST_CCY.fiat(b) || ''; } catch (_) {}
    document.querySelectorAll('#ostPredictMobile .opm-balf').forEach(function (e) { e.textContent = f; });
  }
  function balChip() { return '<div class="opm-bal"><span class="k">OSTG</span><span class="v opm-balv">—</span><span class="f opm-balf"></span></div>'; }

  /* ===================================================================== */
  /* BROWSE                                                                 */
  /* ===================================================================== */
  function browseTemplate() {
    return '' +
    '<div class="opm-tb"><div><h2 class="opm-htitle">Predictions</h2><div class="opm-hsub">Trade real markets with OSTG</div></div><div class="opm-sp"></div><button class="opm-tickets-btn" id="opmTicketsBtn">' + icon('ticket') + 'Tickets</button>' + balChip() + '</div>' +
    '<div class="opm-scroll">' +
      '<div class="opm-search">' + icon('search') + '<input id="opmQ" type="search" placeholder="Search Bitcoin, Trump, NBA, inflation…" autocomplete="off"></div>' +
      '<div class="opm-chips" id="opmChips">' + CATS.map(function (c) { return '<button class="opm-chip' + (c.k === 'all' ? ' on' : '') + '" data-c="' + c.k + '">' + icon(c.ic) + c.label + '</button>'; }).join('') + '</div>' +
      '<div id="opmFeatWrap"></div>' +
      '<div class="opm-sec">' + icon('grid') + ' Markets <span class="opm-sp"></span><span id="opmCount" style="font-family:var(--opm-mono)"></span></div>' +
      '<div class="opm-grid" id="opmGrid"><div class="opm-empty" style="grid-column:1/-1">Loading live markets…</div></div>' +
    '</div>';
  }

  function featCard(m) {
    var yc = yesCents(m), ic = marketIcon(m);
    var label = /btc/.test(ic) ? 'Bitcoin' : /eth/.test(ic) ? 'Ethereum' : /sol/.test(ic) ? 'Solana' : (m.contractLabel || 'Live');
    return '<div class="opm-fcard" data-mid="' + esc(m.id) + '">' +
      '<div class="ft"><div class="fi">' + icon(ic) + '</div><b>' + esc(label) + '</b><span class="fl"><span class="d"></span> LIVE</span></div>' +
      '<div class="fq">' + esc(m.title || m.contractLabel || 'Will it be higher?') + '</div>' +
      '<div class="fyn"><span class="fy">Yes ' + yc + '¢</span><span class="fn">No ' + (100 - yc) + '¢</span></div></div>';
  }
  function mCard(m) {
    var yc = yesCents(m), ic = marketIcon(m);
    var src = String(m.source || (isNative5m(m) ? 'ost' : '')).toLowerCase();
    var srcColor = src === 'kalshi' ? 'var(--opm-yes)' : src === 'polymarket' ? 'var(--opm-cyan)' : 'var(--opm-gold)';
    return '<div class="opm-mcard" data-mid="' + esc(m.id) + '">' +
      '<div class="mt"><div class="mi">' + icon(ic) + '</div><div class="mq">' + esc(m.title || m.contractLabel || 'Market') + '</div></div>' +
      '<div class="mbar"><i style="width:' + yc + '%"></i></div>' +
      '<div class="myn"><span class="cy">Yes ' + yc + '¢</span><span class="cn">No ' + (100 - yc) + '¢</span></div>' +
      '<div class="mf"><span class="msrc" style="color:' + srcColor + '">' + esc(src || 'market') + '</span><span>' + esc(m.closeText || m.closeLabel || '') + '</span></div></div>';
  }

  function renderBrowse() {
    var grid = el('opmGrid'); if (!grid) return;
    var ms = allMarkets();
    var filtered = ms.filter(function (m) { return catMatch(m, cat) && (!query || String(m.searchText || (m.title || '')).toLowerCase().indexOf(query) !== -1); });
    // featured: live native 5-min crypto (only on All / Live / Crypto with no search)
    var featWrap = el('opmFeatWrap');
    if (featWrap) {
      var showFeat = !query && (cat === 'all' || cat === 'live' || cat === 'crypto');
      var feat = showFeat ? ms.filter(isNative5m).slice(0, 4) : [];
      featWrap.innerHTML = feat.length ? ('<div class="opm-sec">' + icon('bolt') + ' Live 5-min</div><div class="opm-feat">' + feat.map(featCard).join('') + '</div>') : '';
    }
    var cnt = el('opmCount'); if (cnt) cnt.textContent = filtered.length + ' live';
    if (!filtered.length) { grid.innerHTML = '<div class="opm-empty" style="grid-column:1/-1">' + (ms.length ? 'No markets match.' : 'Loading live markets…') + '</div>'; return; }
    grid.innerHTML = filtered.slice(0, 80).map(mCard).join('');
  }

  function wireBrowse() {
    var q = el('opmQ'); if (q) q.addEventListener('input', function () { query = String(this.value || '').trim().toLowerCase(); renderBrowse(); });
    var chips = el('opmChips'); if (chips) chips.onclick = function (e) {
      var b = e.target.closest('.opm-chip'); if (!b) return;
      cat = b.getAttribute('data-c');
      chips.querySelectorAll('.opm-chip').forEach(function (x) { x.classList.toggle('on', x === b); });
      renderBrowse();
    };
    var host = el('opmBrowse'); if (host) host.addEventListener('click', function (e) {
      var card = e.target.closest('[data-mid]'); if (!card) return;
      var id = card.getAttribute('data-mid');
      var m = allMarkets().filter(function (x) { return String(x.id) === id; })[0];
      if (m) openMarket(m);
    });
  }

  /* ===================================================================== */
  /* DETAIL                                                                 */
  /* ===================================================================== */
  function openMarket(m) {
    currentMarket = m; view = 'detail';
    side = 'yes'; myPos = null; seenTrades = {}; firstTrades = true; hist = []; hrs = 1;
    buf = []; dispPrice = 0; _lastTickAt = 0; baseMidSet = false; onchainActive = false;
    round = null; price = 0; beat = 0; midYes = yesCents(m);
    el('opmDetail').innerHTML = detailTemplate(m);
    showView('detail');
    wireDetail();
    refreshBalance();
    if (isBtcLive(m)) { loadRound(); startFlow(); }   // trades load once the round id is known (avoids family-history flash)
    else { stopFlow(); paintStandard(); loadTrades(); }
    loadComments(); refreshPosition();
    // Scroll to the TOP OF THE PREDICT SURFACE, not the whole page — window.scrollTo(0,0)
    // yanked the user up to the wallet/convert rails above the panel.
    try { var h = el('ostPredictMobile'); if (h && h.scrollIntoView) h.scrollIntoView({ block: 'start' }); } catch (_) {}
  }

  function detailHead(m) {
    var ic = marketIcon(m);
    var catLabel = isNative5m(m) ? '5-min crypto' : (m.source ? (m.source[0].toUpperCase() + m.source.slice(1)) : 'Market');
    return '<div class="opm-tb"><div class="opm-back" id="opmBack">' + icon('back') + '</div>' +
      '<div class="opm-cat">' + esc(catLabel) + '<b>' + esc((/btc/.test(ic) ? 'Bitcoin' : /eth/.test(ic) ? 'Ethereum' : /sol/.test(ic) ? 'Solana' : (m.contractLabel || m.topic || 'Market'))) + '</b></div>' +
      '<div class="opm-sp"></div>' + balChip() + '</div>';
  }

  function ynBlock() {
    return '<div class="opm-yn" id="opmYn">' +
      '<button class="y sel" data-s="yes"><span class="lab">Yes' + (currentMarket && isNative5m(currentMarket) ? ' · higher' : '') + '</span><span class="px" id="opmYnY">—</span><span class="sh" id="opmYnYx"></span></button>' +
      '<button class="n" data-s="no"><span class="lab">No' + (currentMarket && isNative5m(currentMarket) ? ' · lower' : '') + '</span><span class="px" id="opmYnN">—</span><span class="sh" id="opmYnNx"></span></button></div>';
  }
  function poolBlock() {
    var native = currentMarket && isNative5m(currentMarket);
    return '<div class="opm-pool"><div class="h"><span>' + (native ? 'Round pool' : 'Market odds') + '</span><span class="rt">' + icon('scale') + ' ' + (native ? 'pari-mutuel' : 'live odds') + '</span></div>' +
      '<div class="opm-splbar"><span class="yy" id="opmPoolY" style="width:50%">50%</span><span class="nn" id="opmPoolN">50%</span></div>' +
      '<div class="sub"><span id="opmPoolYA"></span><span id="opmPoolTot"></span><span id="opmPoolNA"></span></div></div>';
  }
  function tabsBlock() {
    return '<div class="opm-seg" id="opmSeg">' +
      '<button data-p="trades" class="on">' + icon('trades') + 'Trades</button>' +
      '<button data-p="holders">' + icon('users') + 'Holders</button>' +
      '<button data-p="comments">' + icon('chat') + 'Comments</button></div>' +
      '<div class="opm-pane on" data-pane="trades"><div id="opmTrades"><div class="opm-empty">Loading live trades…</div></div></div>' +
      '<div class="opm-pane" data-pane="holders"><div id="opmHolders"><div class="opm-empty">Loading holders…</div></div></div>' +
      '<div class="opm-pane" data-pane="comments">' +
        '<div class="opm-meshcta" id="opmMesh"><svg class="opm-ic" viewBox="0 0 24 24"><path d="M4 5h16v11H9l-5 4z"/><path d="M8 10h8M8 13h5"/></svg>' +
          '<div class="t"><b>Discuss in OST Mesh</b><span>Comments are real OST users, from the Mesh social layer</span></div>' + icon('go', 'go') + '</div>' +
        '<div class="opm-cmtbox"><input id="opmCmtIn" maxlength="280" placeholder="Add a comment…"><button id="opmCmtSend">Post</button></div>' +
        '<div id="opmComments"><div class="opm-empty">Be the first to comment.</div></div></div>';
  }
  function buyBarBlock() {
    return '<div class="opm-buybar"><button class="by" data-open="yes" id="opmBuyY">Buy Yes</button><button class="bn" data-open="no" id="opmBuyN">Buy No</button></div>' +
      '<div class="opm-scrim" id="opmScrim"></div>' +
      '<div class="opm-sheet" id="opmSheet"><div class="opm-grab"></div><div id="opmTicket"></div></div>';
  }

  function detailTemplate(m) {
    var head = detailHead(m);
    var body;
    if (isBtcLive(m)) {
      body = '<div class="opm-qhead"><div class="ico">' + icon('btc') + '</div><div><h1>Will BTC be higher in 5 minutes?</h1>' +
        '<span class="opm-live"><span class="d"></span> Live · closes <span class="opm-mono" id="opmCd">—</span></span></div></div>' +
        '<div class="opm-px up" id="opmPx"><div class="opm-pxrow"><div class="opm-pxnow" id="opmNow">—</div><div class="opm-pxdelta" id="opmDelta">—</div></div>' +
        '<div class="opm-beat"><span class="sw"></span> Price to beat <b id="opmBeat">—</b></div>' +
        '<canvas class="opm-g" id="opmG" width="402" height="150"></canvas>' +
        '<div class="opm-tf" id="opmTf"><button data-h="1" class="on">1H</button><button data-h="3">3H</button><button data-h="6">6H</button><button data-h="12">12H</button></div></div>';
    } else {
      var yc = yesCents(m);
      body = '<div class="opm-qhead"><div class="ico">' + icon(marketIcon(m)) + '</div><div><h1>' + esc(m.title || m.contractLabel || 'Market') + '</h1>' +
        '<span class="opm-live"><span class="d"></span> ' + esc(m.closeText || m.closeLabel || 'Live market') + '</span></div></div>' +
        '<div class="opm-prob"><div class="pv" id="opmProb">' + yc + '%</div><div class="pl">implied Yes</div><div class="pbar"><i id="opmProbBar" style="width:' + yc + '%"></i></div>' +
          '<canvas class="opm-g" id="opmStdG" width="402" height="120" style="height:120px;margin:12px 0 0"></canvas></div>' +
        '<div class="opm-statrow"><div class="st"><div class="k">24h volume</div><div class="v">' + esc(Number(m.volumeNumber) > 0 ? compact(m.volumeNumber) : (/\d/.test(String(m.volumeLabel || '')) ? m.volumeLabel : '—')) + '</div></div>' +
        '<div class="st"><div class="k">Closes</div><div class="v">' + esc(m.closeText || m.closeLabel || '—') + '</div></div>' +
        '<div class="st"><div class="k">Source</div><div class="v" style="text-transform:capitalize">' + esc(m.source || 'OST') + '</div></div></div>';
    }
    return head + '<div class="opm-scroll">' + body + ynBlock() + poolBlock() + '<div id="opmPosWrap"></div>' + tabsBlock() + '</div>' + buyBarBlock();
  }

  /* ---- BTC live graph ---- */
  function draw() {
    var cv = el('opmG'); if (!cv) return; var ctx = cv.getContext('2d');
    var w = cv.width, ht = cv.height, pad = 4;
    var data = hist.slice(-Math.min(hist.length, hrs * 33 || 33)); if (data.length < 2) data = hist.slice();
    // Live edge = the SAME interpolated number shown above the chart, so the dot
    // and the price readout are never out of step (one honest source for all #s).
    if (price > 0 && data.length) { data = data.slice(); data[data.length - 1] = price; }
    var n = data.length; if (!n || !beat) { ctx.clearRect(0, 0, w, ht); return; }
    var lo = Math.min(beat, Math.min.apply(0, data)), hi = Math.max(beat, Math.max.apply(0, data));
    var rng = (hi - lo) || 1; lo -= rng * .12; hi += rng * .12; rng = hi - lo;
    var gx = function (i) { return pad + (n === 1 ? 0 : i / (n - 1) * (w - 2 * pad)); }, gy = function (p) { return pad + (1 - (p - lo) / rng) * (ht - 2 * pad); };
    var up = price >= beat, col = up ? '52,211,153' : '251,113,133';
    ctx.clearRect(0, 0, w, ht);
    var by = gy(beat); ctx.setLineDash([5, 5]); ctx.beginPath(); ctx.moveTo(pad, by); ctx.lineTo(w - pad, by); ctx.strokeStyle = 'rgba(160,184,203,.55)'; ctx.lineWidth = 1.2; ctx.stroke(); ctx.setLineDash([]);
    var g = ctx.createLinearGradient(0, 0, 0, ht); g.addColorStop(0, 'rgba(' + col + ',.34)'); g.addColorStop(1, 'rgba(' + col + ',0)');
    ctx.beginPath(); ctx.moveTo(gx(0), ht - pad); data.forEach(function (p, i) { ctx.lineTo(gx(i), gy(p)); }); ctx.lineTo(gx(n - 1), ht - pad); ctx.closePath(); ctx.fillStyle = g; ctx.fill();
    ctx.beginPath(); data.forEach(function (p, i) { i ? ctx.lineTo(gx(i), gy(p)) : ctx.moveTo(gx(i), gy(p)); }); ctx.strokeStyle = 'rgb(' + col + ')'; ctx.lineWidth = 2.2; ctx.lineJoin = 'round'; ctx.stroke();
    var lp = data[n - 1]; ctx.beginPath(); ctx.arc(gx(n - 1), gy(lp), 4, 0, 7); ctx.fillStyle = 'rgb(' + col + ')'; ctx.fill();
    ctx.beginPath(); ctx.arc(gx(n - 1), gy(lp), 8, 0, 7); ctx.strokeStyle = 'rgba(' + col + ',.4)'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = 'rgba(160,184,203,.9)'; ctx.font = '10px ui-monospace,monospace'; ctx.textAlign = 'right'; ctx.fillText('to beat', w - pad - 2, by - 5);
  }
  function applyDir() { var pb = el('opmPx'); if (!pb || !beat) return; var up = price >= beat; pb.classList.toggle('up', up); pb.classList.toggle('down', !up); var d = ((price - beat) / beat * 100); var de = el('opmDelta'); if (de) de.textContent = (up ? '▲ ' : '▼ ') + Math.abs(d).toFixed(2) + '%'; }
  function pushHist(p) { if (!(p > 0)) return; hist.push(p); if (hist.length > HIST_MAX) hist.shift(); }

  // real tick in -> buffer (odometer lag playback) + graph history
  function pushTick(p) {
    if (!(p > 0)) return;
    headPrice = p; var now = Date.now();
    // Learn the feed's cadence so DELAY sits ~1.6x the typical gap — enough that a
    // "next" real sample is almost always available to interpolate toward.
    if (_lastTickAt) { var g = now - _lastTickAt; if (g > 40 && g < 20000) { _gapEMA += (g - _gapEMA) * 0.2; DELAY = Math.max(1000, Math.min(4000, _gapEMA * 1.6)); } }
    _lastTickAt = now;
    buf.push({ t: now, p: p }); if (buf.length > 800) buf.shift(); pushHist(p);
  }

  function startFlow() { if (flowOn) return; flowOn = true; dispPrice = 0; requestAnimationFrame(flow); }
  function stopFlow() { flowOn = false; }
  // The price as it was `DELAY` ms ago, LINEARLY interpolated between the two real
  // ticks bracketing that instant. Before the first tick -> first price. Past the
  // newest tick -> drift along the last segment at half speed, capped to DELAY, so
  // it never hard-freezes but never fakes a big move either.
  function sampleAt(rt) {
    var n = buf.length; if (!n) return 0;
    if (rt <= buf[0].t) return buf[0].p;
    var last = buf[n - 1];
    if (rt >= last.t) {
      if (n >= 2) { var prev = buf[n - 2], span = last.t - prev.t; if (span > 0) { var v = (last.p - prev.p) / span; return last.p + v * Math.min(rt - last.t, DELAY) * 0.5; } }
      return last.p;
    }
    for (var i = n - 1; i > 0; i--) {
      var a = buf[i - 1], b = buf[i];
      if (a.t <= rt && rt <= b.t) { var s = b.t - a.t; return s > 0 ? a.p + (b.p - a.p) * ((rt - a.t) / s) : b.p; }
    }
    return last.p;
  }
  function flow(ts) {
    if (!flowOn) return;
    if (view === 'detail' && isBtcLive(currentMarket) && buf.length) {
      // The interpolation is already smooth + linear in time, so track it directly
      // — no second easing layer (that was the exponential decel that "snapped").
      var val = sampleAt(Date.now() - DELAY);
      if (val > 0) {
        dispPrice = val;
        price = dispPrice;
        var nowEl = el('opmNow'); if (nowEl) nowEl.textContent = usd(price);
        applyDir();
        updateLiveOdds();
        if (!lastDraw || ts - lastDraw > 60) { draw(); lastDraw = ts; }   // graph ~15fps, number 60fps
      }
    }
    requestAnimationFrame(flow);
  }

  // live share prices: implied Yes from the flowing price vs the beat, sharper as
  // the round nears close. Display-only; the real fill price comes from the
  // server/chain at buy time.
  function updateLiveOdds() {
    if (!(beat > 0)) return;
    var tLeftFrac = round ? Math.max(0, Math.min(1, (Number(round.closeAt) - Date.now()) / 300000)) : 1;
    var sens = 9000 * (1 + (1 - tLeftFrac) * 1.4);
    var implied = Math.max(1, Math.min(99, Math.round(50 + (price - beat) / beat * sens)));
    if (implied === midYes) return;
    midYes = implied;
    renderOddsLive();
  }
  function renderOddsLive() {
    var y = el('opmYnY'), n = el('opmYnN'); if (y) y.textContent = midYes + '¢'; if (n) n.textContent = (100 - midYes) + '¢';
    var yMul = midYes > 0 ? (100 / midYes) : 0, nMul = (100 - midYes) > 0 ? (100 / (100 - midYes)) : 0;
    var yx = el('opmYnYx'); if (yx) yx.textContent = yMul ? yMul.toFixed(2) + '× payout' : '';
    var nx = el('opmYnNx'); if (nx) nx.textContent = nMul ? nMul.toFixed(2) + '× payout' : '';
    var by = el('opmBuyY'), bn = el('opmBuyN'); if (by) by.textContent = 'Buy Yes · ' + midYes + '¢'; if (bn) bn.textContent = 'Buy No · ' + (100 - midYes) + '¢';
    if (myPos) renderPosition();   // live P&L follows the live price
    refreshOpenSheet();            // the buy/sell HUD tracks the live price too
  }

  // accurate fee via the real house engine (2% of profit), fallback to 2%
  function feeOf(gross, stake) { try { if (window.OST_HOUSE && OST_HOUSE.quote) return Number(OST_HOUSE.quote(gross, stake).fee) || 0; } catch (_) {} return Math.max(0, (gross - stake) * 0.02); }
  function sheetOpen() { var s = el('opmSheet'); return !!(s && s.classList.contains('open')); }
  // Keep the OPEN buy/sell sheet in sync with the flowing price so it never
  // freezes on the price it was opened at. Buy: patch the derived fields but
  // never the amount input (preserve typing). Sell: rebuild (no input to keep).
  function refreshOpenSheet() {
    if (!sheetOpen()) return;
    var t = el('opmTicket'); if (!t) return;
    if (mode === 'sell') { t.innerHTML = sellConfirmTicket(); var cfs = el('opmCfSell'); if (cfs) cfs.onclick = confirmSell; return; }
    var inp = el('opmAmtIn'); var a = inp ? (parseFloat(inp.value) || 0) : amt;
    var ty = t.querySelector('.opm-tkout .y .px'); if (ty) ty.textContent = midYes + '¢';
    var tn = t.querySelector('.opm-tkout .n .px'); if (tn) tn.textContent = (100 - midYes) + '¢';
    var bd = el('opmBuyBd'); if (bd) bd.innerHTML = buyBdHtml(buyEstimate(a));   // rebuild keeps the spread line in sync
    var cf = el('opmCf'); if (cf && !/Bought|Placing/.test(cf.textContent)) cf.textContent = 'Buy ' + (side === 'yes' ? 'Yes' : 'No') + ' · ' + a + ' OSTG';
  }

  function paintOdds() {
    tween(el('opmYnY'), midYes, cents); tween(el('opmYnN'), 100 - midYes, cents);
    var yMul = midYes > 0 ? (100 / midYes) : 0, nMul = (100 - midYes) > 0 ? (100 / (100 - midYes)) : 0;
    var yx = el('opmYnYx'); if (yx) yx.textContent = yMul ? yMul.toFixed(2) + '× payout' : '';
    var nx = el('opmYnNx'); if (nx) nx.textContent = nMul ? nMul.toFixed(2) + '× payout' : '';
    var yp = (poolY + poolN > 0) ? Math.round(poolY / (poolY + poolN) * 100) : midYes;
    var py = el('opmPoolY'), pn = el('opmPoolN'); if (py) { py.style.width = yp + '%'; py.textContent = yp + '%'; } if (pn) pn.textContent = (100 - yp) + '%';
    var ya = el('opmPoolYA'), na = el('opmPoolNA'), tot = el('opmPoolTot');
    if (poolY + poolN > 0) { if (ya) ya.textContent = 'Yes ' + num0(poolY) + ' OSTG'; if (na) na.textContent = 'No ' + num0(poolN) + ' OSTG'; if (tot) tot.textContent = num0(poolY + poolN) + ' OSTG total'; }
    else { if (ya) ya.textContent = 'Yes ' + yp + '%'; if (na) na.textContent = 'No ' + (100 - yp) + '%'; if (tot) tot.textContent = 'implied odds'; }
    var by = el('opmBuyY'), bn = el('opmBuyN'); if (by) by.textContent = 'Buy Yes · ' + midYes + '¢'; if (bn) bn.textContent = 'Buy No · ' + (100 - midYes) + '¢';
    var pr = el('opmProb'); if (pr) pr.textContent = midYes + '%'; var prb = el('opmProbBar'); if (prb) prb.style.width = midYes + '%';
  }
  function paintStandard() {
    // refresh currentMarket odds from the freshest __ostPredictionMarkets
    var fresh = allMarkets().filter(function (x) { return String(x.id) === String(currentMarket.id); })[0];
    if (fresh) currentMarket = fresh;
    midYes = yesCents(currentMarket);
    paintOdds();
    drawStd();
  }

  /* ---- probability history graph for EVERY (non-crypto) market ----
   * A readable, client-side record: the market's implied-Yes % accumulated over
   * time (persisted per market), rendered as a green/red trend line. No server
   * needed — it builds a real history as the odds move. */
  function stdKey(id) { return 'ost.predict.stdhist.' + id; }
  function stdLoad(id) { try { var a = JSON.parse(localStorage.getItem(stdKey(id)) || '[]'); return Array.isArray(a) ? a : []; } catch (_) { return []; } }
  function stdAppend(id, yc) {
    if (!id || !(yc > 0)) return stdLoad(id);
    var arr = stdLoad(id), now = Date.now(), last = arr[arr.length - 1];
    if (!last || now - last.t > 20000 || Math.abs(last.y - yc) >= 1) { arr.push({ t: now, y: yc }); arr = arr.slice(-120); try { localStorage.setItem(stdKey(id), JSON.stringify(arr)); } catch (_) {} }
    return arr;
  }
  function drawStd() {
    var cv = el('opmStdG'); if (!cv || !currentMarket) return; var ctx = cv.getContext('2d');
    var w = cv.width, h = cv.height, pad = 4;
    var arr = stdAppend(currentMarket.id, midYes);
    ctx.clearRect(0, 0, w, h);
    if (arr.length < 2) {
      var yy = pad + (1 - midYes / 100) * (h - 2 * pad);
      ctx.setLineDash([4, 4]); ctx.strokeStyle = 'rgba(127,216,255,.5)'; ctx.beginPath(); ctx.moveTo(pad, yy); ctx.lineTo(w - pad, yy); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(160,184,203,.75)'; ctx.font = '10px ui-monospace,monospace'; ctx.textAlign = 'left'; ctx.fillText('building probability history…', pad + 4, 14);
      ctx.textAlign = 'right'; ctx.fillText(midYes + '% Yes', w - pad - 2, 14); return;
    }
    var ys = arr.map(function (p) { return p.y; });
    var lo = Math.min.apply(0, ys), hi = Math.max.apply(0, ys); var rng = (hi - lo) || 1; lo -= rng * .15; hi += rng * .15; rng = hi - lo;
    var n = arr.length, gx = function (i) { return pad + i / (n - 1) * (w - 2 * pad); }, gy = function (v) { return pad + (1 - (v - lo) / rng) * (h - 2 * pad); };
    var up = ys[n - 1] >= ys[0], col = up ? '52,211,153' : '251,113,133';
    var g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, 'rgba(' + col + ',.28)'); g.addColorStop(1, 'rgba(' + col + ',0)');
    ctx.beginPath(); ctx.moveTo(gx(0), h - pad); ys.forEach(function (v, i) { ctx.lineTo(gx(i), gy(v)); }); ctx.lineTo(gx(n - 1), h - pad); ctx.closePath(); ctx.fillStyle = g; ctx.fill();
    ctx.beginPath(); ys.forEach(function (v, i) { i ? ctx.lineTo(gx(i), gy(v)) : ctx.moveTo(gx(i), gy(v)); }); ctx.strokeStyle = 'rgb(' + col + ')'; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.stroke();
    ctx.beginPath(); ctx.arc(gx(n - 1), gy(ys[n - 1]), 3.5, 0, 7); ctx.fillStyle = 'rgb(' + col + ')'; ctx.fill();
    ctx.fillStyle = 'rgba(160,184,203,.85)'; ctx.font = '10px ui-monospace,monospace'; ctx.textAlign = 'right'; ctx.fillText(midYes + '% Yes', w - pad - 2, 13);
  }

  function saveRoundCache(d) { try { localStorage.setItem('ost.btc5m.round.lk', JSON.stringify({ marketId: d.marketId, openAt: d.openAt, closeAt: d.closeAt, priceToBeat: d.priceToBeat, openPrice: d.openPrice })); } catch (_) {} }
  function lastRoundCache() { try { return JSON.parse(localStorage.getItem('ost.btc5m.round.lk') || 'null'); } catch (_) { return null; } }
  // A round computed with NO backend at all — clock 5-min boundaries + the client
  // BTC price. This is the always-works fallback when /btc/round is down, KV is
  // exhausted, or the RPC is 429ing. Deterministic id scheme matches the server.
  function clientRound() {
    var FIVE = 300000, openAt = Math.floor(Date.now() / FIVE) * FIVE, closeAt = openAt + FIVE;
    var d = { ok: true, marketId: 'ost-btc5m-' + openAt, openAt: openAt, closeAt: closeAt, msLeft: closeAt - Date.now(), fallback: true, ticks: [] };
    try { if (window.OST_PREDICTION_API && OST_PREDICTION_API.fiveMinRound) { var r = OST_PREDICTION_API.fiveMinRound(); if (r) { d.openPrice = Number(r.openPrice) || 0; d.priceToBeat = Number(r.priceToBeat || r.openPrice) || 0; d.livePrice = Number(r.livePrice) || price || 0; if (isFinite(Number(r.price)) && Number(r.price) > 0 && Number(r.price) < 1) d.yesPriceNumber = Number(r.price); } } } catch (_) {}
    var lk = lastRoundCache();
    if (!(d.priceToBeat > 0) && lk && lk.openAt === openAt && lk.priceToBeat > 0) d.priceToBeat = lk.priceToBeat;   // same bucket -> keep the beat
    if (!(d.priceToBeat > 0)) d.priceToBeat = beat || price || d.livePrice || 0;
    if (!(d.livePrice > 0)) d.livePrice = price || d.priceToBeat;
    return d;
  }
  function applyRound(d) {
    if (!d || view !== 'detail') return;
    var prevId = round && round.marketId; round = d;
    beat = Number(d.priceToBeat) || beat;
    if (Number(d.livePrice) > 0) pushTick(Number(d.livePrice));
    if (!baseMidSet && isFinite(Number(d.yesPriceNumber))) { midYes = Math.max(1, Math.min(99, Math.round(Number(d.yesPriceNumber) * 100))); baseMidSet = true; renderOddsLive(); }
    var newRound = prevId && prevId !== d.marketId;
    if (newRound) {   // rollover = a NEW market: reset this round's live state
      buf = []; hist = []; dispPrice = 0; _lastTickAt = 0; baseMidSet = false; seenTrades = {}; firstTrades = true; onchainActive = false;
      myPos = null; renderPosition(); refreshPosition();
    }
    if (!prevId || newRound) loadTrades();   // (re)load round-scoped trades once the round id is known
    if (Array.isArray(d.ticks) && d.ticks.length && hist.length < 8) {
      d.ticks.map(function (t) { return Number(t.p != null ? t.p : t.price); }).filter(function (x) { return x > 0; }).forEach(pushHist);
    }
    tween(el('opmBeat'), beat, usd); applyDir(); draw();
    loadOnchain();
  }
  function loadRound() {
    return fetch(API + '/btc/round', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (d) {
      if (!d || d.ok === false) throw new Error('bad round');
      saveRoundCache(d); applyRound(d);
    }).catch(function () {
      // ALWAYS-WORKS FALLBACK: no worker / KV exhausted / RPC 429 -> compute the
      // round on the client from the clock + BTC price. The market stays live and
      // tradeable (bets fall through to the credits rail, which is pure client).
      applyRound(clientRound());
    });
  }

  // REAL on-chain pool for this round, straight from the Solana program vault.
  // Requires a connected wallet (available()) AND that the crank has opened this
  // round's market on-chain; otherwise we quietly keep the feed/implied pool.
  // The bet itself already routes on-chain (ost-onchain-route wraps placeOrder),
  // so this makes the POOL people see match the vault they're actually betting into.
  function loadOnchain() {
    if (!(view === 'detail' && isBtcLive(currentMarket))) return;
    try {
      if (!(window.OST_ONCHAIN && OST_ONCHAIN.available && OST_ONCHAIN.available() && OST_ONCHAIN.marketFor)) { onchainActive = false; return; }
      var openAtSec = Math.floor(Number(String((round && round.marketId) || '').replace('ost-btc5m-', '')) / 1000);
      if (!(openAtSec > 0)) return;
      Promise.resolve(OST_ONCHAIN.marketFor(openAtSec)).then(function (m) {
        if (!m || !m.exists || view !== 'detail' || !isBtcLive(currentMarket)) { onchainActive = false; return; }
        onchainActive = true;
        poolY = Math.round(Number(m.yes) || 0); poolN = Math.round(Number(m.no) || 0);
        var rt = document.querySelector('#opmDetail .opm-pool .h .rt');
        if (rt) rt.innerHTML = icon('scale') + ' on-chain vault';
        paintOdds();
      }).catch(function () {});
    } catch (_) {}
  }

  /* ---- feed ids ----
   * Trades + holders are scoped to the EXACT round (each 5-min timestamp is its
   * own market), so the HUD shows only this round's activity — not all history.
   * Comments stay at the market-family level, or a 5-min thread would reset and
   * look empty every round. */
  function feedTradeId() { return isBtcLive(currentMarket) ? ((round && round.marketId) || 'ost-btc5m') : String(currentMarket && currentMarket.id || ''); }
  function feedCommentId() { return isBtcLive(currentMarket) ? 'ost-btc5m' : String(currentMarket && currentMarket.id || ''); }
  function activeMarketId() { return isBtcLive(currentMarket) ? (round && round.marketId) : String(currentMarket && currentMarket.id || ''); }

  function loadTrades() {
    var fid = feedTradeId(); if (!fid) return;
    return fetch(API + '/positions/recent?marketId=' + encodeURIComponent(fid) + '&limit=60', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (d) {
      var arr = (d && d.recent) || []; renderTrades(arr); aggregateHolders(arr); aggregatePool(arr); paintOdds();
    }).catch(function () {});
  }
  function renderTrades(arr) {
    var host = el('opmTrades'); if (!host) return;
    if (!arr.length) { host.innerHTML = '<div class="opm-empty">No trades yet — be the first.</div>'; return; }
    host.innerHTML = arr.slice(0, 12).map(function (r) {
      var y = String(r.side || '').toUpperCase() === 'YES'; var k = r.id || (r.wallet + r.ts); var isNew = !seenTrades[k]; seenTrades[k] = 1;
      var amt = Number(r.stake) > 0 ? compact(r.stake) + ' OSTG' : (Number(r.shares) > 0 ? compact(r.shares) + ' sh' : '');
      var px = Number(r.price) > 0 ? ' @ ' + Math.round(Number(r.price) * 100) + '¢' : '';
      return '<div class="opm-trade' + (isNew && !firstTrades ? ' in' : '') + '"><span class="s ' + (y ? 'y' : 'n') + '">' + (y ? 'Yes' : 'No') + '</span>' +
        '<span class="who">' + esc(r.walletShort || (String(r.wallet || '').slice(0, 4) + '…')) + '</span><span class="amt">' + esc(amt + px) + '</span><span class="t">' + esc(ago(r.ts || r.createdAt)) + '</span></div>';
    }).join(''); firstTrades = false;
  }
  function aggregatePool(arr) {
    if (onchainActive) return;   // the on-chain vault is authoritative; don't overwrite it
    var y = 0, n = 0; arr.forEach(function (r) { var isSell = String(r.id || '').indexOf('sell:') === 0; var stake = Number(r.stake) || 0; if (isSell || !(stake > 0)) return; if (String(r.side || '').toUpperCase() === 'YES') y += stake; else n += stake; });
    poolY = Math.round(y); poolN = Math.round(n);
  }
  function aggregateHolders(arr) {
    var host = el('opmHolders'); if (!host) return; var by = {};
    arr.forEach(function (r) { var w = r.wallet; if (!w) return; var sh = Number(r.shares) || 0; if (!(sh > 0)) return; var isSell = String(r.id || '').indexOf('sell:') === 0; var y = String(r.side || '').toUpperCase() === 'YES'; by[w] = by[w] || { short: r.walletShort || (String(w).slice(0, 4) + '…' + String(w).slice(-4)), net: 0, side: y ? 'y' : 'n' }; by[w].net += (isSell ? -sh : sh); if (!isSell) by[w].side = y ? 'y' : 'n'; });
    var list = Object.keys(by).map(function (k) { return by[k]; }).filter(function (h) { return h.net > 0.01; }).sort(function (a, b) { return b.net - a.net; }).slice(0, 8);
    if (!list.length) { host.innerHTML = '<div class="opm-empty">No holders yet.</div>'; return; }
    var max = list[0].net || 1;
    host.innerHTML = list.map(function (h, i) { var pct = Math.max(6, Math.round(h.net / max * 100)); var col = h.side === 'n' ? 'linear-gradient(90deg,#e11d48,#fb7185)' : 'linear-gradient(90deg,#10b981,#34d399)'; var c = h.side === 'n' ? 'var(--opm-no)' : 'var(--opm-yes)'; return '<div class="opm-holder"><span class="rank">' + (i + 1) + '</span><span class="addr">' + esc(h.short) + '</span><span class="bar"><i style="width:' + pct + '%;background:' + col + '"></i></span><span class="sh" style="color:' + c + '">' + num0(h.net) + '</span></div>'; }).join('');
  }
  function loadComments() {
    var fid = feedCommentId(); if (!fid) return;
    return fetch(API + '/predict/comments?marketId=' + encodeURIComponent(fid), { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (d) {
      var arr = (d && d.comments) || []; var host = el('opmComments'); if (!host) return;
      if (!arr.length) { host.innerHTML = '<div class="opm-empty">Be the first to comment.</div>'; return; }
      host.innerHTML = arr.slice().reverse().slice(0, 40).map(function (c) { var initials = String(c.handle || c.walletShort || '?').replace(/[^a-z0-9]/gi, '').slice(0, 2).toUpperCase() || '0X'; return '<div class="opm-cmt"><div class="av">' + esc(initials) + '</div><div class="b"><div class="n">' + esc(c.handle || c.walletShort || 'anon') + '<span>' + ago(c.ts) + '</span></div><p>' + esc(c.text) + '</p></div></div>'; }).join('');
    }).catch(function () {});
  }
  function postComment() {
    var inp = el('opmCmtIn'); if (!inp) return; var text = String(inp.value || '').trim(); if (!text) return;
    var wallet = walletAddr(); if (!wallet) { toast('Connect a wallet to comment.'); return; }
    inp.value = ''; inp.disabled = true;
    fetch(API + '/predict/comments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ wallet: wallet, text: text, marketId: feedCommentId(), handle: meshHandle() }) })
      .then(function (r) { return r.json(); }).then(function (d) { inp.disabled = false; if (d && d.error === 'slow_down') { toast('Slow down a moment.'); return; } loadComments(); })
      .catch(function () { inp.disabled = false; });
  }

  /* ---- position ---- */
  function refreshPosition() {
    var mid = activeMarketId(); var orders = ledgerOrders();
    var open = orders.filter(function (o) {
      if (!o || o.cashedOut) return false; var st = String(o.status || o.outcome || '').toLowerCase(); if (st === 'won' || st === 'lost' || st === 'settled' || st === 'sold') return false;
      var omid = String(o.marketId || '');
      if (isBtcLive(currentMarket)) return mid ? omid === mid : /^ost-btc5m-\d+$/.test(omid);
      return omid === String(currentMarket && currentMarket.id || '');
    });
    if (!open.length) { myPos = null; renderPosition(); return; }
    var o = open.sort(function (a, b) { return Number(b.ts || 0) - Number(a.ts || 0); })[0];
    var sig = o.signature || o.sig || o.id || '';
    var btn = sig ? document.querySelector('.prediction-cashout-btn[data-order-sig="' + (window.CSS && CSS.escape ? CSS.escape(sig) : sig) + '"]') : null;
    myPos = { order: o, sig: sig, side: (o.side === 'no' ? 'no' : 'yes'), shares: Number(o.shares) || 0, entry: Number(o.entry) || Number(o.price) || 0, locked: (o.fundedBy === 'ostg-native') && round && Number(round.closeAt) > Date.now(), sellBtn: btn, cashText: btn ? btn.textContent : '' };
    renderPosition();
  }
  function posValueNow() { if (!myPos) return 0; var c = myPos.side === 'yes' ? midYes : (100 - midYes); return myPos.shares * (c / 100); }
  function posCost() { return myPos ? myPos.shares * (myPos.entry || 0) : 0; }
  function renderPosition() {
    var wrap = el('opmPosWrap'); if (!wrap) return; if (!myPos) { wrap.innerHTML = ''; return; }
    var val = posValueNow(), cost = posCost(), pnl = val - cost, up = pnl >= 0;
    var pnlTxt = (up ? '+' : '−') + Math.abs(pnl).toFixed(2) + ' OSTG' + (cost > 0 ? ' (' + (up ? '+' : '−') + Math.abs(pnl / cost * 100).toFixed(0) + '%)' : '');
    var sideCls = myPos.side === 'yes' ? 'y' : 'n', sideLab = myPos.side === 'yes' ? 'Yes' : 'No';
    var action;
    if (myPos.locked) { action = '<div class="opm-locked">' + icon('lock') + ' Locked · settles automatically at round close</div>'; }
    else if (myPos.sellBtn) { var net = (myPos.cashText.match(/([\d,]+\.?\d*)\s*$/) || [])[1] || val.toFixed(2); var isSettle = /settle|claim/i.test(myPos.cashText); action = '<div class="opm-pcbtns"><button class="addmore" id="opmAddMore">Add more</button><button class="sell" id="opmSellBtn">' + (isSettle ? 'Settle' : 'Sell') + ' · ' + esc(net) + ' OSTG</button></div>'; }
    else { action = '<div class="opm-pcbtns"><button class="addmore" id="opmAddMore">Add more</button><button class="sell" id="opmSellBtn">Sell · ' + val.toFixed(2) + ' OSTG</button></div>'; }
    wrap.innerHTML = '<div class="opm-poscard"><div class="pch">Your position <span class="side ' + sideCls + '">' + sideLab + '</span><span class="sp"></span><span class="pnl ' + (up ? 'up' : 'down') + '">' + esc(pnlTxt) + '</span></div>' +
      '<div class="opm-pcgrid"><div class="opm-pcg"><div class="k">Shares</div><div class="v">' + myPos.shares.toFixed(2) + '</div></div><div class="opm-pcg"><div class="k">Avg entry</div><div class="v">' + Math.round((myPos.entry || 0) * 100) + '¢</div></div><div class="opm-pcg"><div class="k">Value now</div><div class="v">' + val.toFixed(2) + '</div></div></div>' + action + '</div>';
    var am = el('opmAddMore'); if (am) am.onclick = function () { openSheet('buy', myPos.side); };
    var sb = el('opmSellBtn'); if (sb && !sb.disabled) sb.onclick = doSell;
  }

  /* ---- AUTONOMOUS ON-CHAIN AUTO-CLAIM ----
   * Wins are money the user already earned. For every closed on-chain 5-min
   * ticket, once the program has resolved it, claim it automatically (session-
   * signed, no popup) so it lands in the wallet OSTG (= the balance). Losers are
   * marked, never claim-spammed. Idempotent + attempt-capped. */
  var _claimTries = {};
  function patchOrder(o, patch) {
    try {
      var ref = o.reference || o.signature || o.sig || o.id;
      if (window.OST_PREDICTION_API && OST_PREDICTION_API.patchOrderByRef && ref) { OST_PREDICTION_API.patchOrderByRef(ref, patch); return; }
      if (window.OST_PREDICTION_API && OST_PREDICTION_API.recordOrder) OST_PREDICTION_API.recordOrder(Object.assign({}, o, patch));
    } catch (_) {}
  }
  async function autoClaimOnchain() {
    if (autoClaimOnchain._busy) return; autoClaimOnchain._busy = true;
    try {
      if (!(window.OST_ONCHAIN && OST_ONCHAIN.available && OST_ONCHAIN.available() && OST_ONCHAIN.claim && OST_ONCHAIN.marketFor)) return;
      var orders = ledgerOrders(); var credited = false;
      for (var i = 0; i < orders.length && i < 16; i++) {
        var o = orders[i]; if (!o || o.cashedOut) continue;
        var st = String(o.status || o.outcome || '').toLowerCase();
        if (st === 'lost' || st === 'sold' || st === 'paid') continue;
        var mm = String(o.marketId || '').match(/^ost-btc5m-(\d+)$/); if (!mm) continue;   // on-chain rail = btc5m
        var openAt = o.onChainOpenAt ? Number(o.onChainOpenAt) : Math.floor(Number(mm[1]) / 1000);
        if (!(openAt > 0) || Date.now() < (openAt + 300) * 1000 + 6000) continue;          // round not closed yet
        var key = o.signature || o.sig || o.id || String(openAt);
        if ((_claimTries[key] || 0) > 4) continue; _claimTries[key] = (_claimTries[key] || 0) + 1;
        var m = await OST_ONCHAIN.marketFor(openAt); if (!m || !m.exists || !m.resolved) continue;
        var mySide = (o.side === 'no' || o.side === 0) ? 0 : 1;
        if (m.winningSide !== mySide) { patchOrder(o, { status: 'lost' }); continue; }     // lost — mark, don't claim
        try {
          var r = await OST_ONCHAIN.claim(openAt);                                          // session-signed, no popup
          var net = window.OST_ONCHAIN.quoteNet ? Number(OST_ONCHAIN.quoteNet(m, mySide, Number(o.stake) || 0).net) : 0;
          patchOrder(o, { status: 'won', cashedOut: true, cashoutOst: net, claimSig: r && r.signature });
          credited = true;
        } catch (e) { /* already claimed / not payable yet — leave for next sweep */ }
      }
      if (credited) { refreshBalance(); if (view === 'positions') renderPositions(); toast('Auto-claimed your winnings to OSTG.'); }
    } catch (_) {} finally { autoClaimOnchain._busy = false; }
  }

  /* ---- buy / sell sheet ---- */
  var amt = 25, mode = 'buy';
  function openSheet(m, s) { mode = m; if (s) side = s; syncYnSel(); paintTicket(); el('opmSheet').classList.add('open'); el('opmScrim').classList.add('open'); }
  function closeSheet() { var sh = el('opmSheet'), sc = el('opmScrim'); if (sh) sh.classList.remove('open'); if (sc) sc.classList.remove('open'); }
  function maxBal() { var b = playBal(); return b > 0 ? Math.floor(b) : 25; }
  function syncYnSel() { document.querySelectorAll('#opmYn button').forEach(function (b) { b.classList.toggle('sel', b.getAttribute('data-s') === side); }); }
  // One estimate used by the sheet + its live refresher. When the on-chain arb
  // is active, part of the stake is the market-maker spread (skimmed to treasury
  // in the same Solana tx), so the rest is what buys shares — shown, never hidden.
  function arbBps() { try { if (onchainActive && window.OST_ARB && OST_ARB.bps) return Number(OST_ARB.bps()) || 0; } catch (_) {} return 0; }
  function buyEstimate(stake) {
    var c = side === 'yes' ? midYes : (100 - midYes);
    var sBps = arbBps(), spreadAmt = Math.max(0, stake * sBps / 10000), effStake = stake - spreadAmt;
    var shares = c > 0 ? effStake / (c / 100) : 0, fee = feeOf(shares, effStake), net = shares - fee;
    return { c: c, spreadAmt: spreadAmt, sBps: sBps, shares: shares, fee: fee, net: net, roi: stake > 0 ? ((net - stake) / stake * 100) : 0 };
  }
  function buyBdHtml(e) {
    var rows = '<div class="opm-tl"><span class="k">Fill price</span><span class="v">' + e.c + '¢</span></div>' +
      '<div class="opm-tl"><span class="k">Shares</span><span class="v" id="opmShV">' + e.shares.toFixed(2) + '</span></div>';
    if (e.spreadAmt > 0) rows += '<div class="opm-tl"><span class="k">Market spread (' + (e.sBps / 100) + '%)</span><span class="v">' + e.spreadAmt.toFixed(2) + '</span></div>';
    rows += '<div class="opm-tl"><span class="k">Fee (2% profit)</span><span class="v">' + e.fee.toFixed(2) + '</span></div>' +
      '<div class="opm-tl big"><span class="k">To win</span><span class="v">' + e.net.toFixed(2) + ' OSTG<span class="opm-roi">+' + e.roi.toFixed(0) + '%</span></span></div>';
    return rows;
  }
  function buyTicket() {
    var e = buyEstimate(amt);
    return '<h3>' + icon('ticket') + ' Buy</h3>' +
      '<div class="opm-tkout"><button class="y' + (side === 'yes' ? ' sel' : '') + '" data-t="yes"><span class="lab">Yes</span><span class="px">' + midYes + '¢</span></button>' +
      '<button class="n' + (side === 'no' ? ' sel' : '') + '" data-t="no"><span class="lab">No</span><span class="px">' + (100 - midYes) + '¢</span></button></div>' +
      '<div class="opm-amt"><input id="opmAmtIn" inputmode="decimal" value="' + amt + '"><span class="cur">OSTG</span></div>' +
      '<div class="opm-quick">' + [10, 25, 100, 'Max'].map(function (q) { return '<button data-q="' + String(q).toLowerCase() + '">' + q + '</button>'; }).join('') + '</div>' +
      '<div class="opm-src"><span class="l"><span class="d"></span> ' + (onchainActive ? 'Wallet OST · on-chain' : 'Personal OSTG') + '</span></div>' +
      '<div class="opm-sess" id="opmSess"></div>' +
      '<div class="opm-bd" id="opmBuyBd">' + buyBdHtml(e) + '</div>' +
      '<button class="opm-confirm' + (side === 'no' ? ' no' : '') + '" id="opmCf">Buy ' + (side === 'yes' ? 'Yes' : 'No') + ' · ' + amt + ' OSTG</button>' +
      '<div class="opm-fine">' + icon('lock') + ' ' + (isBtcLive(currentMarket) ? 'Settles from the on-chain price at close' : 'Settles when the market resolves') + '</div>';
  }
  function sellConfirmTicket() {
    var c = myPos ? (myPos.side === 'yes' ? midYes : (100 - midYes)) : 0;
    var shares = myPos ? myPos.shares : 0, gross = shares * (c / 100), cost = posCost();
    var profit = Math.max(0, gross - cost), fee = profit * 0.02;
    var realNet = (myPos && (myPos.cashText.match(/([\d,]+\.?\d*)\s*$/) || [])[1]) || (gross - fee).toFixed(2);
    var netNum = parseFloat(String(realNet).replace(/,/g, '')) || (gross - fee);
    var pnl = netNum - cost, up = pnl >= 0;
    var isSettle = myPos && /settle|claim/i.test(myPos.cashText);
    return '<h3>' + icon('coin') + ' ' + (isSettle ? 'Settle position' : 'Sell your ' + (myPos && myPos.side === 'yes' ? 'Yes' : 'No') + ' position') + '</h3>' +
      '<div class="opm-fine" style="text-align:left;color:var(--opm-ink2)">' + (isSettle ? 'Claim your settled position — the amount is computed and paid by the server.' : 'Exit now — OST buys your shares back at the live price. You keep the move so far instead of waiting for close.') + '</div>' +
      '<div class="opm-bd">' +
        '<div class="opm-tl"><span class="k">Selling</span><span class="v">' + shares.toFixed(2) + ' shares</span></div>' +
        '<div class="opm-tl"><span class="k">Sell price</span><span class="v">' + c + '¢</span></div>' +
        '<div class="opm-tl"><span class="k">Fee (2% profit)</span><span class="v">' + fee.toFixed(2) + '</span></div>' +
        '<div class="opm-tl"><span class="k">Realized P&amp;L</span><span class="v" style="color:var(--opm-' + (up ? 'yes' : 'no') + ')">' + (up ? '+' : '−') + Math.abs(pnl).toFixed(2) + ' OSTG</span></div>' +
        '<div class="opm-tl big"><span class="k">You receive</span><span class="v" style="color:var(--opm-gold)">' + esc(realNet) + ' OSTG</span></div>' +
      '</div>' +
      '<button class="opm-confirm sellc" id="opmCfSell">' + (isSettle ? 'Settle for ' : 'Sell for ') + esc(realNet) + ' OSTG</button>' +
      '<div class="opm-fine">' + icon('lock') + ' Proceeds return to your Play OSTG instantly.</div>';
  }
  // One-tap betting (session key). Only meaningful on the on-chain 5-min rail.
  function sessionActive() { try { return !!(window.OST_SESSION && OST_SESSION.exists() && OST_SESSION.balance() > 0); } catch (_) { return false; } }
  function renderSessionRow() {
    var host = el('opmSess'); if (!host) return;
    if (!isBtcLive(currentMarket)) { host.innerHTML = ''; return; }
    if (sessionActive()) {
      host.innerHTML = '<div class="opm-sesson"><span>⚡ 1-tap ON · ' + (Number(OST_SESSION.balance()) || 0).toFixed(0) + ' OSTG left</span><button id="opmSessEnd">End</button></div>';
      var e = el('opmSessEnd'); if (e) e.onclick = function () { e.disabled = true; e.textContent = '…'; OST_SESSION.end().then(function () { toast('Session ended — funds returned to your wallet.'); renderSessionRow(); }).catch(function (err) { toast((err && err.message) || 'Could not end session'); e.disabled = false; e.textContent = 'End'; }); };
    } else {
      host.innerHTML = '<button class="opm-sessbtn" id="opmSessOn">⚡ Enable 1-tap betting</button>';
      var b = el('opmSessOn'); if (b) b.onclick = function () { b.disabled = true; b.textContent = 'Funding… (one signature)'; OST_SESSION.fund(25).then(function () { toast('1-tap on — bets are instant now, capped at what you loaded.'); renderSessionRow(); }).catch(function (err) { toast((err && err.message) || 'Could not enable 1-tap'); b.disabled = false; b.textContent = '⚡ Enable 1-tap betting'; }); };
    }
  }
  function paintTicket() {
    var t = el('opmTicket'); if (!t) return;
    if (mode === 'sell') { t.innerHTML = sellConfirmTicket(); var cfs = el('opmCfSell'); if (cfs) cfs.onclick = confirmSell; return; }
    t.innerHTML = buyTicket();
    renderSessionRow();
    document.querySelectorAll('#opmTicket .opm-tkout button').forEach(function (b) { b.onclick = function () { side = b.getAttribute('data-t'); syncYnSel(); paintTicket(); }; });
    document.querySelectorAll('#opmTicket .opm-quick button').forEach(function (b) { b.onclick = function () { var q = b.getAttribute('data-q'); amt = q === 'max' ? maxBal() : (parseFloat(q) || amt); paintTicket(); }; });
    var inp = el('opmAmtIn'); if (inp) inp.oninput = function () { amt = parseFloat(this.value) || 0; refreshOpenSheet(); };
    var cf = el('opmCf'); if (cf) cf.onclick = confirmBuy;
  }
  function confirmBuy() {
    var cf = el('opmCf'); if (!cf || cf.disabled) return; var stake = amt;
    if (!(stake > 0)) { toast('Enter an amount.'); return; }
    var mid = activeMarketId(); if (!mid) { toast('Market not ready — try again.'); return; }
    var bSide = side, c = bSide === 'yes' ? midYes : (100 - midYes), sh = c > 0 ? stake / (c / 100) : 0, entry = c / 100;
    // OPTIMISTIC: reflect the bet the instant they tap — balance down, position in.
    // The real placeBet reconciles in the background; on failure we revert to truth.
    var bBefore = playBal();
    // OPTIMISTIC: the balance drops the instant they tap and HOLDS there (won't
    // bounce back up on a stale reconcile-read) until the server confirms.
    if (bBefore != null) { var opt = Math.max(0, bBefore - stake); _balHold = { v: opt, dir: 'down', until: Date.now() + 9000 }; setBalDisplay(opt); }
    if (myPos && myPos.side === bSide) { var tot = myPos.shares + sh; myPos.entry = (myPos.shares * (myPos.entry || 0) + sh * entry) / (tot || 1); myPos.shares = tot; myPos.pending = true; }
    else { myPos = { order: {}, sig: '', side: bSide, shares: sh, entry: entry, locked: false, sellBtn: null, cashText: '', pending: true }; }
    renderPosition(); closeSheet(); if (_balHold) _balHold.until = Date.now() + 16000;
    ensurePlayFunds(stake)
      .then(function () { return window.OST_PREDICTION_API.placeBet({ marketId: mid, side: bSide, stake: stake }); })
      .then(function () { setTimeout(function () { refreshBalance(); refreshPosition(); loadTrades(); }, 800); })
      .catch(function (e) { _balHold = null; toast((e && e.message) ? e.message : 'Could not place the bet — reverted.'); refreshBalance(); refreshPosition(); });
  }
  // DEPOSIT BRIDGE — makes WALLET OSTG directly spendable. If the custodial play
  // balance can't cover the stake, top it up from the wallet (gas-free pool rail,
  // OST_PLAY.deposit) before betting. On-chain rail spends the wallet directly,
  // so no top-up there.
  function ensurePlayFunds(stake) {
    try {
      if (onchainActive) return Promise.resolve();
      if (!(window.OST_PLAY && OST_PLAY.deposit && OST_PLAY.balance)) return Promise.resolve();
      var play = Number(OST_PLAY.balance()) || 0;
      if (play >= stake) return Promise.resolve();
      var shortfall = Math.ceil((stake - play) * 100) / 100;
      var w = 0; try { if (window.OST_SESSION && OST_SESSION.walletBalance) w = Number(OST_SESSION.walletBalance()) || 0; } catch (_) {}
      if (w > 0 && w < shortfall) return Promise.reject(new Error('Not enough OSTG in your wallet for this bet.'));
      return Promise.resolve(OST_PLAY.deposit(shortfall)).then(function () { refreshBalance(); });
    } catch (e) { return Promise.reject(e); }
  }
  function confirmSell() {
    if (!myPos) { closeSheet(); return; }
    var cfs = el('opmCfSell'); if (cfs) { cfs.disabled = true; cfs.textContent = 'Processing…'; }
    var sig = myPos.sig, tries = 0;
    // ROBUST + optimistic-on-the-go: retry finding the proven cash-out button
    // (it may not have rendered the instant they tap), then trigger it and
    // reconcile from the ledger. NEVER optimistically clear the position — a
    // failed sale must leave it intact, not vanish (that was the "crash").
    (function attempt() {
      var btn = document.querySelector('.prediction-cashout-btn[data-order-sig="' + (window.CSS && CSS.escape ? CSS.escape(sig) : sig) + '"]');
      if (!btn) {
        if (tries++ < 4) { setTimeout(attempt, 500); return; }
        if (cfs) { cfs.disabled = false; cfs.textContent = 'Sell'; }
        toast("This position isn't sellable yet — it settles at close.");
        return;
      }
      try { btn.click(); }
      catch (e) { if (cfs) { cfs.disabled = false; cfs.textContent = 'Sell'; } toast('Could not start the sale — try again.'); return; }
      var net = parseFloat(String((btn.textContent.match(/([\d,]+\.?\d*)\s*$/) || [])[1] || '').replace(/,/g, '')) || posValueNow();
      var b = playBal(); if (b != null && net > 0) { _balHold = { v: b + net, dir: 'up', until: Date.now() + 12000 }; setBalDisplay(b + net); }
      setTimeout(function () {
        closeSheet();
        var still = ledgerOrders().some(function (o) { return (o.signature || o.sig || o.id) === sig && !o.cashedOut && !/won|lost|sold|settled/i.test(String(o.status || '')); });
        if (still) { _balHold = null; }   // sale didn't take -> release the optimistic bump
        refreshBalance(); refreshPosition(); loadTrades();
      }, 1700);
    })();
  }
  function doSell() { openSheet('sell'); }

  function wireDetail() {
    var back = el('opmBack'); if (back) back.onclick = showBrowse;
    document.querySelectorAll('#opmSeg button').forEach(function (b) { b.onclick = function () { document.querySelectorAll('#opmSeg button').forEach(function (x) { x.classList.remove('on'); }); b.classList.add('on'); var p = b.getAttribute('data-p'); document.querySelectorAll('#opmDetail .opm-pane').forEach(function (pn) { pn.classList.toggle('on', pn.getAttribute('data-pane') === p); }); if (p === 'comments') loadComments(); }; });
    document.querySelectorAll('#opmYn button').forEach(function (b) { b.onclick = function () { side = b.getAttribute('data-s'); syncYnSel(); }; });
    document.querySelectorAll('#opmBuyY,#opmBuyN,#opmDetail [data-open]').forEach(function (b) { b.onclick = function () { openSheet('buy', b.getAttribute('data-open')); }; });
    var scr = el('opmScrim'); if (scr) scr.onclick = closeSheet;
    document.querySelectorAll('#opmTf button').forEach(function (b) { b.onclick = function () { document.querySelectorAll('#opmTf button').forEach(function (z) { z.classList.remove('on'); }); b.classList.add('on'); hrs = +b.getAttribute('data-h'); draw(); }; });
    var mesh = el('opmMesh'); if (mesh) mesh.onclick = function () { try { if (window.OST_MESH && OST_MESH.open) OST_MESH.open(); } catch (_) {} };
    var cs = el('opmCmtSend'); if (cs) cs.onclick = postComment;
    var ci = el('opmCmtIn'); if (ci) ci.addEventListener('keydown', function (e) { if (e.key === 'Enter') postComment(); });
    syncYnSel();
  }

  function toast(msg) { try { if (typeof window.toast === 'function') { window.toast('info', msg); return; } } catch (_) {} console.log('[predict]', msg); }

  /* ================= POSITIONS (trade tickets) ================= */
  var posFilter = 'all';
  function orderState(o) {
    if (!o) return 'open';
    if (o.cashedOut) return 'paid';
    var st = String(o.status || o.outcome || '').toLowerCase();
    if (st === 'won') return 'claim';
    if (st === 'lost') return 'lost';
    if (st === 'sold' || st === 'settled' || st === 'refunded') return 'paid';
    return 'open';
  }
  function computePortfolio(orders) {
    var p = { staked: 0, value: 0, pnl: 0, open: 0, claim: 0, lost: 0, paid: 0 };
    orders.forEach(function (o) {
      var stake = Number(o.stake) || 0; p.staked += stake; var st = orderState(o);
      if (st === 'paid') { p.paid++; var got = Number(o.cashoutOst) || 0; p.value += got; p.pnl += got - stake; }
      else if (st === 'claim') { p.claim++; var v = Number(o.potentialReturn) || Number(o.shares) || stake; p.value += v; p.pnl += v - stake; }
      else if (st === 'lost') { p.lost++; p.pnl -= stake; }
      else { p.open++; var val = Number(o.shares) > 0 ? Number(o.shares) * (Number(o.entry || o.price) || 0) : stake; if (!(val > 0)) val = stake; p.value += val; p.pnl += val - stake; }
    });
    return p;
  }
  function cashBtnFor(sig) { if (!sig) return null; try { return document.querySelector('.prediction-cashout-btn[data-order-sig="' + (window.CSS && CSS.escape ? CSS.escape(sig) : sig) + '"]'); } catch (_) { return null; } }
  function ticketRow(o) {
    var st = orderState(o), side = o.side === 'no' ? 'no' : 'yes';
    var stake = Number(o.stake) || 0, shares = Number(o.shares) || 0, sig = o.signature || o.sig || o.id || '';
    var btn = cashBtnFor(sig), actionHtml;
    if ((st === 'open' || st === 'claim') && btn) {
      var net = (btn.textContent.match(/([\d,]+\.?\d*)\s*$/) || [])[1] || '';
      var claim = /claim|settle/i.test(btn.textContent);
      actionHtml = '<button class="opm-tbtn' + (claim ? ' claimw' : '') + '" data-sig="' + esc(sig) + '">' + (claim ? 'Claim' : 'Sell') + (net ? ' · ' + esc(net) : '') + '</button>';
    } else if (st === 'claim') { actionHtml = '<span class="opm-tbadge" style="color:var(--opm-gold)">Won</span>'; }
    else if (st === 'paid') { actionHtml = '<span class="opm-tres" style="color:var(--opm-yes)">+' + (Number(o.cashoutOst) || 0).toFixed(2) + '</span>'; }
    else if (st === 'lost') { actionHtml = '<span class="opm-tres" style="color:var(--opm-no)">−' + stake.toFixed(2) + '</span>'; }
    else { actionHtml = '<span class="opm-tbadge">Open</span>'; }
    return '<div class="opm-trow" data-mid="' + esc(o.marketId || '') + '"><div class="opm-tmain"><div class="opm-ttitle">' + esc(o.title || o.marketId || 'Ticket') + '</div>' +
      '<div class="opm-tmeta"><span class="opm-tside ' + (side === 'yes' ? 'y' : 'n') + '">' + (side === 'yes' ? 'Yes' : 'No') + '</span> ' + stake.toFixed(0) + ' OSTG · ' + (shares > 0 ? shares.toFixed(1) + ' sh · ' : '') + ago(o.ts) + '</div></div>' +
      '<div class="opm-tact">' + actionHtml + '</div></div>';
  }
  function positionsTemplate() {
    return '<div class="opm-tb"><div class="opm-back" id="opmPosBack">' + icon('back') + '</div><div class="opm-cat">Your<b>Trade tickets</b></div><div class="opm-sp"></div>' + balChip() + '</div>' +
      '<div class="opm-scroll">' +
        '<div class="opm-psum">' +
          '<div class="opm-ps"><div class="k">Staked</div><div class="v" id="opmPfStaked">—</div></div>' +
          '<div class="opm-ps"><div class="k">Value</div><div class="v" id="opmPfValue">—</div></div>' +
          '<div class="opm-ps"><div class="k">P&amp;L</div><div class="v" id="opmPfPnl">—</div></div>' +
          '<div class="opm-ps"><div class="k">Open / Won</div><div class="v" id="opmPfCounts">—</div></div>' +
        '</div>' +
        '<div class="opm-chips" id="opmPosChips">' + [['all', 'All'], ['open', 'Open'], ['claim', 'Claim wins'], ['paid', 'Cashed out'], ['lost', 'Lost']].map(function (c) { return '<button class="opm-chip' + (c[0] === 'all' ? ' on' : '') + '" data-f="' + c[0] + '">' + c[1] + '</button>'; }).join('') + '</div>' +
        '<div id="opmPosList"><div class="opm-empty">Loading…</div></div>' +
      '</div>';
  }
  function renderPositions() {
    if (!el('opmPositions')) return;
    var orders = ledgerOrders().slice().sort(function (a, b) { return Number(b.ts || 0) - Number(a.ts || 0); });
    var pf = computePortfolio(orders);
    var set = function (id, txt, cls) { var e = el(id); if (e) { e.textContent = txt; if (cls != null) e.className = 'v ' + cls; } };
    set('opmPfStaked', num0(pf.staked)); set('opmPfValue', num0(pf.value));
    set('opmPfPnl', (pf.pnl >= 0 ? '+' : '−') + num0(Math.abs(pf.pnl)), pf.pnl >= 0 ? 'up' : 'down');
    set('opmPfCounts', pf.open + ' / ' + pf.claim);
    var list = el('opmPosList'); if (!list) return;
    var rows = orders.filter(function (o) { return posFilter === 'all' || orderState(o) === posFilter; });
    list.innerHTML = rows.length ? rows.map(ticketRow).join('') : '<div class="opm-empty">' + (orders.length ? 'No tickets in this filter.' : 'No tickets yet — place a bet to get started.') + '</div>';
    list.querySelectorAll('.opm-tbtn').forEach(function (b) {
      b.onclick = function (e) { e.stopPropagation(); var real = cashBtnFor(b.getAttribute('data-sig')); if (!real) { toast('Settling — try again shortly.'); return; } b.disabled = true; b.textContent = '…'; try { real.click(); } catch (_) {} setTimeout(function () { refreshBalance(); renderPositions(); }, 1500); };
    });
    list.querySelectorAll('.opm-trow').forEach(function (r) {
      r.onclick = function () { var mid = r.getAttribute('data-mid'); var m = allMarkets().filter(function (x) { return String(x.id) === mid; })[0]; if (m) openMarket(m); };
    });
  }
  function wirePositions() {
    var back = el('opmPosBack'); if (back) back.onclick = showBrowse;
    var chips = el('opmPosChips'); if (chips) chips.onclick = function (e) { var b = e.target.closest('.opm-chip'); if (!b) return; posFilter = b.getAttribute('data-f'); chips.querySelectorAll('.opm-chip').forEach(function (x) { x.classList.toggle('on', x === b); }); renderPositions(); };
  }
  function openPositions() {
    try { if (window.setWalletPanel) window.setWalletPanel('predict', { scroll: true }); } catch (_) {}
    stopFlow(); mount(); showView('positions'); wirePositions(); renderPositions();
    try { var host = el('ostPredictMobile'); if (host) host.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (_) {}
  }

  /* ===================================================================== */
  /* VIEW SWITCHING + MOUNT                                                 */
  /* ===================================================================== */
  function showView(v) { view = v; var b = el('opmBrowse'), d = el('opmDetail'), p = el('opmPositions'); if (b) b.classList.toggle('on', v === 'browse'); if (d) d.classList.toggle('on', v === 'detail'); if (p) p.classList.toggle('on', v === 'positions'); }
  function showBrowse() { stopFlow(); showView('browse'); currentMarket = null; renderBrowse(); refreshBalance(); }

  function mount() {
    var panel = el('wallet-panel-predict'); if (!panel || el('ostPredictMobile')) return true;
    var host = document.createElement('div'); host.id = 'ostPredictMobile';
    host.innerHTML = '<div class="opm-view on" id="opmBrowse">' + browseTemplate() + '</div><div class="opm-view" id="opmDetail"></div><div class="opm-view" id="opmPositions">' + positionsTemplate() + '</div>';
    panel.insertBefore(host, panel.firstChild);
    Array.prototype.forEach.call(panel.children, function (c) { if (c !== host) c.style.display = 'none'; });
    wireBrowse(); wirePositions();
    var tb = el('opmTicketsBtn'); if (tb) tb.onclick = openPositions;
    renderBrowse(); refreshBalance();
    return true;
  }

  /* live BTC stream (only affects the BTC detail while open) */
  window.addEventListener('ost:btc-spot', function (e) { if (view !== 'detail' || !isBtcLive(currentMarket)) return; var p = e && e.detail && Number(e.detail.price); if (p > 0) pushTick(p); });
  window.addEventListener('ost:btc-market-updated', function (e) { if (view !== 'detail' || !isBtcLive(currentMarket)) return; try { var m = e.detail && e.detail.tick; if (m && Number(m.price) > 0) pushTick(Number(m.price)); } catch (_) {} });
  window.addEventListener('ost:prediction-markets', function () { if (view === 'browse') renderBrowse(); });
  window.addEventListener('ost:prediction-order-recorded', function () { if (view === 'detail') setTimeout(refreshPosition, 400); if (view === 'positions') setTimeout(renderPositions, 400); });
  window.addEventListener('ost:prediction-resolutions-refreshed', function () { if (view === 'positions') renderPositions(); });
  window.addEventListener('ost:money:change', function () { refreshBalance(); if (view === 'positions') renderPositions(); });
  window.addEventListener('ost:play:balance', refreshBalance);
  window.addEventListener('ost:session:change', function () { if (sheetOpen() && mode === 'buy') renderSessionRow(); });

  // Entry point for the "Trade ticket" launchers: show the predict panel and
  // drop straight into the flagship live market (new upgraded UI + OSTG buy sheet).
  function openFlagship() {
    try { if (window.setWalletPanel) window.setWalletPanel('predict', { scroll: true }); } catch (_) {}
    mount();
    var ms = allMarkets();
    var flag = ms.filter(isBtcLive)[0] || ms.filter(isNative5m)[0] || ms[0];
    if (flag) openMarket(flag); else showBrowse();
    try { var host = el('ostPredictMobile'); if (host) host.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (_) {}
  }
  window.OST_PREDICT_MOBILE = { mount: mount, showBrowse: showBrowse, openMarket: openMarket, openFlagship: openFlagship, openPositions: openPositions };

  function boot() {
    if (!mount()) { var n = 0; var iv = setInterval(function () { if (mount() || ++n > 40) clearInterval(iv); }, 500); }
    // detail tickers
    setInterval(function () { if (view !== 'detail') return; if (isBtcLive(currentMarket)) { var cd = el('opmCd'); if (cd && round) { var left = Math.max(0, Math.floor((Number(round.closeAt) - Date.now()) / 1000)); cd.textContent = Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0'); if (left <= 0) loadRound(); } } }, 1000);
    // All polling pauses when the tab is hidden (was hammering the network even
    // in the background — a big part of the request storm).
    setInterval(function () { if (view === 'detail' && isBtcLive(currentMarket) && !document.hidden) loadRound(); }, 6000);
    setInterval(function () { if (view === 'detail' && !document.hidden) { loadTrades(); refreshPosition(); if (!isBtcLive(currentMarket)) paintStandard(); } }, 13000);
    setInterval(function () { if (!document.hidden) refreshBalance(); }, 40000);
    // autonomous autopay: claim resolved on-chain wins to the wallet OSTG.
    // Runs only while visible; it no-ops immediately when there are no open
    // on-chain tickets, so it isn't network churn most of the time.
    setTimeout(function () { if (!document.hidden) autoClaimOnchain(); }, 8000);
    setInterval(function () { if (!document.hidden) autoClaimOnchain(); }, 60000);
    // markets can arrive after boot
    var t = 0; var iv2 = setInterval(function () { if (allMarkets().length) { if (view === 'browse') renderBrowse(); clearInterval(iv2); } else if (++t > 40) clearInterval(iv2); }, 700);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();

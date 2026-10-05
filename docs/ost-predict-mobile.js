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
  var price = 0, beat = 0, midYes = 50, hrs = 0, hist = [], HIST_MAX = 400;
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
  // toLocaleString() builds a fresh Intl formatter on EVERY call, and the live desk
  // calls it 60x/s (price, delta, graph labels) — it was the top main-thread cost on
  // phones. One cached formatter each.
  var _nf0 = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }), _nf2 = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
  var usd = function (v) { return '$' + _nf0.format(Math.round(v)); };
  // Cents display shows the FULL range: one decimal at the extremes (0.1¢ / 99.9¢)
  // where a whole-cent round would hide them, plain integer in the middle.
  var fmtc = function (v) { v = Number(v) || 0; return (v > 0 && v < 1) || v > 99 ? v.toFixed(1) : String(Math.round(v)); };
  var cents = function (v) { return fmtc(v) + '¢'; };

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
  // FULL spendable = wallet OSTG + custodial play + SESSION OSTG (1-tap). Read the
  // WALLET + PLAY numbers from the ONE canonical source (OST_BALANCE ->
  // /balance/truth), so the predictions desk agrees with the wallet dashboard, the
  // bridge, and the server — no more per-surface drift. Session-key OSTG is a
  // distinct on-chain account the canonical read doesn't cover, so it is added.
  // Falls back to the module's own reads only when canonical is unknown.
  function playBal() {
    var wallet, play, sess, known = false;
    try { if (window.OST_BALANCE) { var og = OST_BALANCE.onchainOstg(); if (og != null) { wallet = og; known = true; } var pl = OST_BALANCE.play(); if (pl != null) { play = pl; known = true; } } } catch (_) {}
    if (wallet == null) { try { if (window.OST_SESSION && OST_SESSION.walletBalance) { var w = OST_SESSION.walletBalance(); if (w != null) { wallet = w; known = true; } } } catch (_) {} }
    if (play == null) { try { if (window.OST_PLAY && OST_PLAY.balance) { var p = OST_PLAY.balance(); if (p != null) { play = p; known = true; } } } catch (_) {} }
    try { if (window.OST_SESSION && OST_SESSION.balance) { var sv = OST_SESSION.balance(); if (sv != null) { sess = sv; known = true; } } } catch (_) {}
    if (!known) return undefined;
    return (Number(wallet) || 0) + (Number(play) || 0) + (Number(sess) || 0);
  }
  // Optimistic hold: after a bet/sell we show the expected balance and refuse to
  // let a slow reconcile-read bounce it the WRONG way before the server confirms
  // — that bounce is what made buying feel non-optimistic.
  var _balHold = null;   // { v, dir:'down'|'up', until }
  // Sell price LOCK: 5-min BTC odds move every tick, so a sell ticket that
  // re-quotes on every tick shifts the exit price under the user's finger — the
  // "whole panoramic view changed" so the tap never resolves to a stable sale.
  // We snapshot the quote when the sell sheet opens and hold it; the ticket is
  // static (tap always lands), and the user can tap "update" to re-lock to the
  // current price. Cleared whenever the sheet closes or switches to buy.
  var _sellLock = null;
  function setBalDisplay(v) {
    if (v != null && _balHold && Date.now() < _balHold.until) {
      var nv = Number(v);
      if (_balHold.dir === 'down' && nv > _balHold.v + 0.001) v = _balHold.v;
      else if (_balHold.dir === 'up' && nv < _balHold.v - 0.001) v = _balHold.v;
      else _balHold = null;   // the real balance crossed the optimistic point -> release
    }
    document.querySelectorAll('#ostPredictMobile .opm-balv').forEach(function (e) { e.textContent = (v == null ? '—' : Number(Math.max(0, v)).toLocaleString(undefined, { maximumFractionDigits: 2 })); });
  }
  // READ-ONLY repaint of the balance chip from whatever the canonical source
  // currently holds. Safe to call from an event handler — it never triggers a
  // refresh, so it can't loop with the ost:balance event.
  function paintBalance() {
    var b = playBal();
    setBalDisplay(b);
    var f = ''; try { if (window.OST_CCY && OST_CCY.fiat && b != null) f = OST_CCY.fiat(b) || ''; } catch (_) {}
    document.querySelectorAll('#ostPredictMobile .opm-balf').forEach(function (e) { e.textContent = f; });
  }
  // Repaint the fiat hint when the user changes currency (it used to keep whatever currency
  // was active when the balance last changed - e.g. INR from a moment in onboarding).
  try { window.addEventListener('ost:currencychange', function () { setTimeout(paintBalance, 0); }); } catch (_) {}
  function refreshBalance() {
    // These are ASYNC: they kick off a fetch and fire `ost:balance` /
    // `ost:play:balance` when the fresh number lands. paintBalance() here shows
    // the current value immediately; the event listeners below repaint again the
    // moment the refresh completes — THAT is what makes the chip actually move
    // after a bet/sell instead of showing a stale number forever.
    try { if (window.OST_BALANCE && OST_BALANCE.refresh) OST_BALANCE.refresh(true); } catch (_) {}   // canonical /balance/truth
    try { if (window.OST_SESSION && OST_SESSION.refresh) OST_SESSION.refresh(); } catch (_) {}
    try { if (window.OST_PLAY && OST_PLAY.refresh) OST_PLAY.refresh(); } catch (_) {}
    paintBalance();
  }
  function balChip() { return '<div class="opm-bal"><span class="k">OSTG</span><span class="v opm-balv">—</span><span class="f opm-balf"></span></div>'; }

  /* ===================================================================== */
  /* BROWSE                                                                 */
  /* ===================================================================== */
  function browseTemplate() {
    return '' +
    '<div class="opm-tb"><div><h2 class="opm-htitle">Predictions</h2><div class="opm-hsub">Real-world markets · devnet OSTG (no cash value)</div></div><div class="opm-sp"></div><button class="opm-tickets-btn" id="opmTicketsBtn">' + icon('ticket') + 'Portfolio</button>' + balChip() + '</div>' +
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
  // "Closes in 780d" / "Closes 02:35 PM" -> "780d" / "02:35 PM": the label already says Closes.
  function shortClose(m) { return String((m && (m.closeText || m.closeLabel)) || '').replace(/^\s*closes\s*(in\s*)?/i, '').trim(); }
  var SRC_SHORT = { polymarket: 'Poly', kalshi: 'Kalshi', ost: 'OST' };
  // BROWSE RANKING. The grid used to be feed order, which put dozens of decided 1c/99c
  // novelty contracts ("Will LeBron win the presidency") ahead of anything tradable.
  // Rank by how CONTESTED a market is, weighted by real volume; near-decided ones sink.
  function rankScore(m) {
    var yc = yesCents(m), contested = 1 - Math.abs(yc - 50) / 50;          // 1 at 50c, 0 at 0/100c
    var vol = Math.log10((Number(m.volumeNumber) || 0) + 10);               // ~1..8
    var s = contested * 3 + vol * 0.45;
    if (yc <= 3 || yc >= 97) s -= 6;                                        // effectively decided
    if (isNative5m(m)) s += 4;                                              // OST's own live rounds lead
    return s;
  }
  function mCard(m) {
    var yc = yesCents(m), ic = marketIcon(m);
    var src = String(m.source || (isNative5m(m) ? 'ost' : '')).toLowerCase();
    var srcColor = src === 'kalshi' ? 'var(--opm-yes)' : src === 'polymarket' ? 'var(--opm-cyan)' : 'var(--opm-gold)';
    return '<div class="opm-mcard" data-mid="' + esc(m.id) + '">' +
      '<div class="mt"><div class="mi">' + icon(ic) + '</div><div class="mq">' + esc(m.title || m.contractLabel || 'Market') + '</div></div>' +
      '<div class="mbar"><i style="width:' + yc + '%"></i></div>' +
      '<div class="myn"><span class="cy">Yes ' + yc + '¢</span><span class="cn">No ' + (100 - yc) + '¢</span></div>' +
      '<div class="mf"><span class="msrc" style="color:' + srcColor + '">' + esc(SRC_SHORT[src] || src || 'market') + '</span><span class="mcl">' + esc(shortClose(m)) + '</span></div></div>';
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
    if (cat === 'parlay' && !query) {
      var slips = []; try { slips = (window.OST_PARLAY && OST_PARLAY.slips() || []).slice().reverse(); } catch (_) {}
      grid.innerHTML = '<div class="opm-empty opm-parlay-cta" style="grid-column:1/-1;text-align:left"><b>⚡ Parlays</b><br>Combine 2–6 markets into one ticket — the odds multiply. Open any market and tap <b>Parlay YES / NO</b> under the price, or add the live 5-min coins from the slip.' +
        '<div style="margin-top:10px"><button class="opm-tbtn" id="opmOpenParlay">Open the parlay slip' + (slips.length ? ' · ' + slips.filter(function (x) { return x.status === 'open'; }).length + ' live' : '') + '</button></div></div>';
      var ob = el('opmOpenParlay'); if (ob) ob.onclick = function () { try { if (window.OST_PARLAY && OST_PARLAY.open) OST_PARLAY.open(); } catch (_) {} };
      return;
    }
    if (!filtered.length) { grid.innerHTML = '<div class="opm-empty" style="grid-column:1/-1">' + (ms.length ? 'No markets match.' : 'Loading live markets…') + '</div>'; return; }
    var ranked = filtered.map(function (m, i) { return { m: m, s: rankScore(m), i: i }; }).sort(function (a, b) { return (b.s - a.s) || (a.i - b.i); }).map(function (x) { return x.m; });
    grid.innerHTML = ranked.slice(0, 80).map(mCard).join('');
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
    side = 'yes'; myPos = null; seenTrades = {}; firstTrades = true; hist = []; hrs = 0;
    buf = []; dispPrice = 0; _lastTickAt = 0; baseMidSet = false; onchainActive = false;
    round = null; price = 0; beat = 0; midYes = yesCents(m); legPick = null; _ostHolders = []; _venueHolders = null;
    Object.keys(pane).forEach(function (k) { clearTimeout(pane[k].timer); pane[k].tries = 0; });
    // The market id travels on the container so chart/parlay modules can find the
    // market without matching titles (duplicate titles charted the wrong market).
    try { el('opmDetail').setAttribute('data-mid', String(m.id || '')); } catch (_) {}
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
          '<div class="t"><b>Discuss in OST Mesh</b><span>Post this market to your OST Mesh feed</span></div>' + icon('go', 'go') + '</div>' +
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
        '<div class="opm-beat"><span class="sw"></span> Price to beat <b id="opmBeat">—</b></div><div id="opmFeedNote" style="font-size:10px;color:#f5c468;min-height:0;padding:0 2px"></div>' +
        '<canvas class="opm-g" id="opmG" width="402" height="150"></canvas>' +
        '<div class="opm-tf" id="opmTf"><button data-h="0" class="on">LIVE</button><button data-h="1">1H</button><button data-h="6">6H</button><button data-h="12">12H</button></div></div>';
    } else {
      var yc = yesCents(m);
      body = '<div class="opm-qhead"><div class="ico">' + icon(marketIcon(m)) + '</div><div><h1>' + esc(m.title || m.contractLabel || 'Market') + '</h1>' +
        '<span class="opm-live"><span class="d"></span> ' + esc(m.closeText || m.closeLabel || 'Live market') + '</span></div></div>' +
        '<div class="opm-prob"><div class="pv" id="opmProb">' + yc + '%</div><div class="pl">implied Yes</div><div class="pbar"><i id="opmProbBar" style="width:' + yc + '%"></i></div>' +
          '<canvas class="opm-g" id="opmStdG" width="402" height="120" style="height:120px;margin:12px 0 0"></canvas><div id="opmStdNote" style="font-size:10px;color:#8fa6b8;padding:4px 2px 0;font-family:ui-monospace,monospace">' + (m.source === 'kalshi' ? 'checking live Kalshi price…' : '') + '</div></div>' +
        '<div class="opm-statrow"><div class="st"><div class="k">24h volume</div><div class="v">' + esc(Number(m.volumeNumber) > 0 ? compact(m.volumeNumber) : (/\d/.test(String(m.volumeLabel || '')) ? m.volumeLabel : '—')) + '</div></div>' +
        '<div class="st"><div class="k">Closes</div><div class="v">' + esc(shortClose(m) || '—') + '</div></div>' +
        '<div class="st"><div class="k">Source</div><div class="v" style="text-transform:capitalize">' + esc(m.source || 'OST') + '</div></div></div>';
    }
    return head + '<div class="opm-scroll">' + body + ynBlock() + poolBlock() + '<div id="opmPosWrap"></div>' + tabsBlock() + '</div>' + buyBarBlock();
  }

  /* ---- BTC live graph ---- */
  // REAL TIME RANGES. "1H/3H/6H/12H" used to slice the last 33xN live ticks - about
  // 13 seconds per "hour", so 12H was really ~2.5 minutes. LIVE is now the honest
  // name for the tick view; the hour ranges plot real 1-minute BTC closes fetched
  // browser-direct from Binance's public data API (no worker requests), cached 60s.
  var _kl = {};
  function loadKlines(h) {
    var c = _kl[h]; if (c && (c.loading || Date.now() - c.at < 60000)) return;
    _kl[h] = { at: Date.now(), pts: (c && c.pts) || [], loading: true };
    fetch('https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=' + Math.min(1000, h * 60))
      .then(function (r) { if (!r.ok) throw new Error('klines ' + r.status); return r.json(); })
      .then(function (rows) {
        var pts = (Array.isArray(rows) ? rows : []).map(function (k) { return Number(k[4]); }).filter(function (x) { return x > 0; });
        _kl[h] = { at: Date.now(), pts: pts, failed: pts.length < 2 };
        if (view === 'detail' && hrs === h) draw();
      }).catch(function () { _kl[h] = { at: Date.now(), pts: [], failed: true }; if (view === 'detail' && hrs === h) draw(); });
  }
  function draw() {
    var cv = el('opmG'); if (!cv) return; var ctx = cv.getContext('2d');
    var w = cv.width, ht = cv.height, pad = 4;
    var data, note = '';
    if (hrs > 0) {
      loadKlines(hrs); var k = _kl[hrs];
      if (!k || !k.pts || k.pts.length < 2) {
        ctx.clearRect(0, 0, w, ht); ctx.fillStyle = 'rgba(160,184,203,.8)'; ctx.font = '11px ui-monospace,monospace'; ctx.textAlign = 'left';
        ctx.fillText((k && k.failed) ? 'price history unavailable right now - LIVE still works' : 'loading ' + hrs + 'h of BTC price…', pad + 4, ht / 2);
        return;
      }
      data = k.pts.concat([price > 0 ? price : k.pts[k.pts.length - 1]]); note = 'last ' + hrs + 'h · 1-min closes · Binance';
    } else { data = hist.slice(); var times = (histT.length === hist.length) ? histT.slice() : null; if (times) times[times.length - 1] = Date.now(); }
    // Live edge = the SAME interpolated number shown above the chart, so the dot
    // and the price readout are never out of step (one honest source for all #s).
    if (price > 0 && data.length) { data = data.slice(); data[data.length - 1] = price; }
    var n = data.length; if (!n || !beat) { ctx.clearRect(0, 0, w, ht); return; }
    var lo = Math.min(beat, Math.min.apply(0, data)), hi = Math.max(beat, Math.max.apply(0, data));
    // Floor the vertical span at 0.02% of price (~$16 on BTC): without it a 50-cent
    // wiggle filled the whole chart and read as a crash/spike that never happened.
    var minSpan = beat * 0.0002; if (hi - lo < minSpan) { var midP = (hi + lo) / 2; lo = midP - minSpan / 2; hi = midP + minSpan / 2; }
    var rng = (hi - lo) || 1; lo -= rng * .12; hi += rng * .12; rng = hi - lo;
    var t0 = times && times[0], tSpan = times ? (times[n - 1] - t0) : 0;
    var gx = function (i) { return pad + (n === 1 ? 0 : ((times && tSpan > 0) ? (times[i] - t0) / tSpan : i / (n - 1)) * (w - 2 * pad)); }, gy = function (p) { return pad + (1 - (p - lo) / rng) * (ht - 2 * pad); };
    var up = price >= beat, col = up ? '52,211,153' : '251,113,133';
    ctx.clearRect(0, 0, w, ht);
    var by = gy(beat); ctx.setLineDash([5, 5]); ctx.beginPath(); ctx.moveTo(pad, by); ctx.lineTo(w - pad, by); ctx.strokeStyle = 'rgba(160,184,203,.55)'; ctx.lineWidth = 1.2; ctx.stroke(); ctx.setLineDash([]);
    var g = ctx.createLinearGradient(0, 0, 0, ht); g.addColorStop(0, 'rgba(' + col + ',.34)'); g.addColorStop(1, 'rgba(' + col + ',0)');
    ctx.beginPath(); ctx.moveTo(gx(0), ht - pad); data.forEach(function (p, i) { ctx.lineTo(gx(i), gy(p)); }); ctx.lineTo(gx(n - 1), ht - pad); ctx.closePath(); ctx.fillStyle = g; ctx.fill();
    ctx.beginPath(); data.forEach(function (p, i) { i ? ctx.lineTo(gx(i), gy(p)) : ctx.moveTo(gx(i), gy(p)); }); ctx.strokeStyle = 'rgb(' + col + ')'; ctx.lineWidth = 2.2; ctx.lineJoin = 'round'; ctx.stroke();
    var lp = data[n - 1]; ctx.beginPath(); ctx.arc(gx(n - 1), gy(lp), 4, 0, 7); ctx.fillStyle = 'rgb(' + col + ')'; ctx.fill();
    ctx.beginPath(); ctx.arc(gx(n - 1), gy(lp), 8, 0, 7); ctx.strokeStyle = 'rgba(' + col + ',.4)'; ctx.lineWidth = 2; ctx.stroke();
    // USD numerical labels (not %): the beat line and the live price, so the graph
    // reads in dollars — the units the bet is actually decided in.
    ctx.fillStyle = 'rgba(160,184,203,.9)'; ctx.font = '10px ui-monospace,monospace'; ctx.textAlign = 'right';
    ctx.fillText('to beat ' + usd(beat), w - pad - 2, by - 5);
    ctx.fillStyle = 'rgb(' + col + ')'; ctx.font = 'bold 10px ui-monospace,monospace'; ctx.textAlign = 'left';
    ctx.fillText(usd(lp), pad + 2, 12);
    if (note) { ctx.fillStyle = 'rgba(160,184,203,.6)'; ctx.font = '9px ui-monospace,monospace'; ctx.textAlign = 'left'; ctx.fillText(note, pad + 2, ht - 6); }
  }
  function applyDir() {
    var pb = el('opmPx'); if (!pb || !beat) return;
    var up = price >= beat;
    if (pb.__up !== up) { pb.__up = up; pb.classList.toggle('up', up); pb.classList.toggle('down', !up); }
    // Show the USD gap between live and price-to-beat, not a percentage — a BTC
    // 5-min bet is decided by the numerical difference, so that is what to surface.
    var diff = price - beat;
    var de = el('opmDelta');
    if (de) { var dt = (up ? '▲ ' : '▼ ') + '$' + _nf2.format(Math.abs(diff)); if (de.__t !== dt) { de.__t = dt; de.textContent = dt; } }
  }
  // histT = the time of each hist point, so LIVE plots by TIME. Plotting by tick index
  // drew a burst of identical ticks as a long flat plateau and a quiet minute as nothing.
  var histT = [];
  function pushHist(p, t) { if (!(p > 0)) return; if (hist.length !== histT.length) histT = hist.map(function (_, i) { return Date.now() - (hist.length - i) * 1000; }); hist.push(p); histT.push(Number(t) > 0 ? Number(t) : Date.now()); if (hist.length > HIST_MAX) { hist.shift(); histT.shift(); } }

  // real tick in -> buffer (odometer lag playback) + graph history
  function pushTick(p) {
    if (!(p > 0)) return;
    headPrice = p; var now = Date.now();
    // Learn the feed's UPDATE cadence so DELAY sits ~1.6x the typical gap — enough
    // that a "next" real sample is almost always available to interpolate toward.
    // Ignore intra-burst gaps (<120ms): several ticks landing in one cluster are a
    // single update, not the real spacing — counting them would collapse DELAY to
    // its floor and leave between-burst silences unbridged (a visible freeze).
    if (_lastTickAt) { var g = now - _lastTickAt; if (g >= 120 && g < 20000) { _gapEMA += (g - _gapEMA) * 0.25; DELAY = Math.max(1200, Math.min(4000, _gapEMA * 1.6)); } }
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
        var nowEl = el('opmNow'); if (nowEl) { var nt = usd(price); if (nowEl.__t !== nt) { nowEl.__t = nt; nowEl.textContent = nt; } }
        applyDir();
        updateLiveOdds();
        if (!lastDraw || ts - lastDraw > 60) { draw(); lastDraw = ts; }   // graph ~15fps, number 60fps
      }
    }
    requestAnimationFrame(flow);
  }

  // live share prices: implied Yes from the flowing price vs the beat. This MUST
  // use the SAME logistic model as the server (serverComputeBtcOdds) and the other
  // clients (prediction-pro/fast-markets) or the desk disagrees with the canonical
  // quote. The OLD form here — 50 + (price-beat)/beat*sens — centered every quote
  // at 50 and ignored the real probability, so shares looked "static at 50¢" no
  // matter what BTC did. Now: logistic on deltaPct/scale, sqrt-time band, clamped
  // to [0.1%,99.9%] exactly like the worker (BTC_PROB_MIN/MAX). Display-only; the
  // real fill price still comes from the server/chain at buy time.
  function updateLiveOdds() {
    if (!(beat > 0) || !(price > 0)) return;
    var FIVE = 300000;
    var msLeft = round ? Math.max(0, Math.min(FIVE, Number(round.closeAt) - Date.now())) : FIVE;
    var timeLeftRatio = msLeft / FIVE;
    var deltaPct = (price - beat) / beat * 100;
    var scale = 0.15 * Math.sqrt(Math.max(timeLeftRatio, 0.04));
    var z = Math.max(-8, Math.min(8, deltaPct / Math.max(scale, 0.001)));
    var yes = 1 / (1 + Math.exp(-z));
    yes = Math.max(0.001, Math.min(0.999, yes));            // BTC_PROB_MIN / MAX -> full 0.1c..99.9c range
    // EXACT cents at 0.1 precision (was rounded+clamped to [1,99], which hid the
    // extremes). So a near-certain outcome shows 99.9c / 0.1c, not a flat 99 / 1.
    var implied = Math.round(yes * 1000) / 10;
    if (implied === midYes) return;
    midYes = implied;
    renderOddsLive();
  }
  var _posDomAt = 0;
  // TRADE GATE. With no fresh SETTLEMENT price the round cannot be priced: the desk used
  // to keep quoting 50c/50c off a frozen number and still let people buy. Now: no settlement
  // tick in 20s -> buying is disabled and the desk says so (the server refuses too).
  function btcPriceLive() { return !isBtcLive(currentMarket) || (Date.now() - (_srvTickAt || 0) < 20000); }
  function paintTradeGate() {
    var live = btcPriceLive(), by = el('opmBuyY'), bn = el('opmBuyN'), cf = el('opmCf');
    [by, bn].forEach(function (b) { if (!b) return; b.disabled = !live; b.style.opacity = live ? '' : '.45'; });
    if (!live) { if (by) by.textContent = 'Price unavailable'; if (bn) bn.textContent = 'Trading paused'; if (cf) { cf.disabled = true; cf.textContent = 'Price unavailable - trading paused'; } setFeedNote('No live BTC price right now - trading is paused until it returns.'); }
    else if (by && by.textContent === 'Price unavailable') { renderOddsLive(); setFeedNote(''); if (cf && /unavailable/.test(cf.textContent)) { cf.disabled = false; paintTicket(); } }
  }
  setInterval(function () { if (view === 'detail' && !document.hidden) paintTradeGate(); }, 2000);
  function renderOddsLive() {
    // CHEAP text updates run every tick (no buttons here to destroy):
    var y = el('opmYnY'), n = el('opmYnN'); if (y) y.textContent = fmtc(midYes) + '¢'; if (n) n.textContent = fmtc(100 - midYes) + '¢';
    var yMul = midYes > 0 ? (100 / midYes) : 0, nMul = (100 - midYes) > 0 ? (100 / (100 - midYes)) : 0;
    var yx = el('opmYnYx'); if (yx) yx.textContent = yMul ? yMul.toFixed(2) + '× payout' : '';
    var nx = el('opmYnNx'); if (nx) nx.textContent = nMul ? nMul.toFixed(2) + '× payout' : '';
    var by = el('opmBuyY'), bn = el('opmBuyN'); if (btcPriceLive()) { if (by) by.textContent = 'Buy Yes · ' + fmtc(midYes) + '¢'; if (bn) bn.textContent = 'Buy No · ' + fmtc(100 - midYes) + '¢'; }
    // EXPENSIVE DOM rebuilds (position card + open sheet) carry BUTTONS, so they
    // are throttled — rebuilding them at frame rate destroyed the Sell/Buy buttons
    // mid-tap (the "can't click while data flows" bug).
    var now = Date.now();
    if (myPos && now - _posDomAt >= 450) { _posDomAt = now; renderPosition(); }
    refreshOpenSheet();            // self-throttled (450ms) + patches, never rebuilds the button
  }

  // accurate fee via the real house engine (2% of profit), fallback to 2%
  function feeOf(gross, stake) { try { if (window.OST_HOUSE && OST_HOUSE.quote) return Number(OST_HOUSE.quote(gross, stake).fee) || 0; } catch (_) {} return Math.max(0, (gross - stake) * 0.02); }
  function sheetOpen() { var s = el('opmSheet'); return !!(s && s.classList.contains('open')); }
  // Keep the OPEN buy/sell sheet in sync with the flowing price — WITHOUT ever
  // rebuilding its buttons at tick rate. The old code did `t.innerHTML =
  // sellConfirmTicket()` on every odds change (~60x/s once odds went to 0.1c
  // precision), which destroyed the Sell button mid-tap — that is exactly why
  // buy/sell "can't be clicked when data is flowing". Now: throttled, and it
  // PATCHES text into the existing elements so the buttons are never replaced.
  // `force` (user typing) bypasses the throttle for instant feedback.
  var _sheetRefreshAt = 0;
  function refreshOpenSheet(force) {
    if (!sheetOpen()) return;
    var now = Date.now();
    if (!force && now - _sheetRefreshAt < 450) return;   // taps must land — never thrash the DOM at frame rate
    _sheetRefreshAt = now;
    var t = el('opmTicket'); if (!t) return;
    if (mode === 'sell') {
      var cfs = el('opmCfSell');
      if (!cfs) { t.innerHTML = sellConfirmTicket(); cfs = el('opmCfSell'); if (cfs) cfs.onclick = confirmSell; wireSellLockRow(); return; }
      // LOCKED: leave the exit price exactly as snapshotted. Ticks no longer move
      // the numbers under the user's finger — this is the fix for "it doesn't sell
      // because the whole panoramic view changed". The user taps "update" to
      // re-lock. Settle (non-lockable) still shows the server-computed amount live.
      if (_sellLock && !_sellLock.isSettle) return;
      var q = _sellLock || sellQuote();
      var px = el('opmSellPx'); if (px) px.textContent = fmtc(q.c) + '¢';
      var fe = el('opmSellFee'); if (fe) fe.textContent = q.fee.toFixed(2);
      var pl = el('opmSellPnl'); if (pl) { pl.textContent = (q.up ? '+' : '−') + Math.abs(q.pnl).toFixed(2) + ' OSTG'; pl.style.color = 'var(--opm-' + (q.up ? 'yes' : 'no') + ')'; }
      var nt = el('opmSellNet'); if (nt) nt.textContent = q.realNet + ' OSTG';
      if (!/Processing|Selling/.test(cfs.textContent)) cfs.textContent = (q.isSettle ? 'Settle for ' : 'Sell for ') + q.realNet + ' OSTG';
      return;
    }
    var inp = el('opmAmtIn'); var a = inp ? (parseFloat(inp.value) || 0) : amt;
    var ty = t.querySelector('.opm-tkout .y .px'); if (ty) ty.textContent = fmtc(midYes) + '¢';
    var tn = t.querySelector('.opm-tkout .n .px'); if (tn) tn.textContent = fmtc(100 - midYes) + '¢';
    var bd = el('opmBuyBd'); if (bd) bd.innerHTML = buyBdHtml(buyEstimate(a));   // patch the breakdown; the confirm button below is untouched
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
    var by = el('opmBuyY'), bn = el('opmBuyN'); if (btcPriceLive()) { if (by) by.textContent = 'Buy Yes · ' + fmtc(midYes) + '¢'; if (bn) bn.textContent = 'Buy No · ' + fmtc(100 - midYes) + '¢'; }
    var pr = el('opmProb'); if (pr) pr.textContent = fmtc(midYes) + '%'; var prb = el('opmProbBar'); if (prb) prb.style.width = midYes + '%';
  }
  // Multi-outcome ladders: the chart module publishes the outcome the user picked
  // (ost:predict:outcome). The quote, the ticket and the order all follow it.
  var legPick = null;
  window.addEventListener('ost:predict:outcome', function (e) {
    var d = e && e.detail; if (!d || !currentMarket || String(d.marketId) !== String(currentMarket.id)) return;
    var switched = !legPick || String(legPick.legId || '') !== String(d.legId || '');
    legPick = d;
    var p = Number(d.legPrice); if (p > 1) p /= 100;
    if (p > 0 && p < 1) { midYes = Math.max(0.1, Math.min(99.9, Math.round(p * 1000) / 10)); paintOdds(); }
    if (switched && !d.quiet && view === 'detail') { loadTrades(); refreshPosition(); }   // the tape/holders follow the picked leg
  });
  window.addEventListener('ost:predict:quote', function (e) {
    var d = e && e.detail; if (!d || view !== 'detail' || !currentMarket || String(d.marketId) !== String(currentMarket.id) || isBtcLive(currentMarket)) return;
    paintStandard();
  });
  function paintStandard() {
    // refresh currentMarket odds from the freshest __ostPredictionMarkets
    var fresh = allMarkets().filter(function (x) { return String(x.id) === String(currentMarket.id); })[0];
    if (fresh) currentMarket = fresh;
    midYes = yesCents(currentMarket);
    if (legPick) { var lp = Number(legPick.legPrice); if (lp > 1) lp /= 100; if (lp > 0 && lp < 1) midYes = Math.max(0.1, Math.min(99.9, Math.round(lp * 1000) / 10)); }
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
  // REAL HISTORY. The standard-market graph used to be only a localStorage log of
  // odds THIS device happened to see — a new user got a dashed line, nobody saw the
  // market's actual history. Fetch the real 7-day price series from Polymarket's
  // public CLOB straight from the browser (worker relay only as a CORS fallback),
  // cache 2 min, and append the live mid as the tail.
  var _realHist = {};
  function tokenIdsOf(m) {
    var raw = m && (m.clobTokenIds || m.tokenIds || (m.raw && (m.raw.clobTokenIds || m.raw.clob_token_ids)));
    if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch (_) { raw = []; } }
    return Array.isArray(raw) ? raw.map(function (x) { return String((x && (x.tokenId || x.token_id || x.id)) || x || ''); }).filter(Boolean) : [];
  }
  function setStdNote(txt) { var n = el('opmStdNote'); if (n) n.textContent = txt || ''; }
  function loadRealHistory(m) {
    if (!m || !m.id) return; var c = _realHist[m.id];
    if (c && (c.loading || Date.now() - c.at < 120000)) return;
    // KALSHI: its catalog on this site is a static deploy-time snapshot (Kalshi blocks
    // browsers), so the card price can be hours old. Opening the market makes ONE cached
    // worker call for the LIVE quote + real 7-day trade history, and the desk reprices
    // to it before the user can trade on a stale number.
    if (m.source === 'kalshi') {
      _realHist[m.id] = { at: Date.now(), pts: (c && c.pts) || [], loading: true };
      var kUrl = API + '/kalshi/market?ticker=' + encodeURIComponent(m.id);
      // Kalshi throttles Cloudflare's shared IPs (~half of calls 429). One delayed retry, then say so.
      fetch(kUrl).then(function (r) { return r.json(); }).then(function (j) { if (j && j.ok) return j; return new Promise(function (res) { setTimeout(res, 5000); }).then(function () { return fetch(kUrl); }).then(function (r) { return r.json(); }); }).then(function (j) {
        if (!j || !j.ok) throw new Error((j && j.error) || 'kalshi');
        var pts = (j.history || []).map(function (x) { return { t: Number(x.t), y: Number(x.p) * 100 }; }).filter(function (x) { return x.t > 0 && x.y >= 0 && x.y <= 100; });
        _realHist[m.id] = { at: Date.now(), pts: pts, src: 'Kalshi trades · 7d' };
        var live = (j.yesBid > 0 && j.yesAsk > 0 && j.yesAsk < 1) ? (j.yesBid + j.yesAsk) / 2 : (j.last > 0 ? j.last : (j.yesBid > 0 ? j.yesBid : NaN));
        if (live > 0 && live < 1) { m.yesPriceNumber = live; m.noPriceNumber = 1 - live; m.__liveQuoteAt = Date.now(); }
        if (currentMarket && currentMarket.id === m.id && view === 'detail') { if (live > 0 && live < 1) { midYes = Math.max(0.1, Math.min(99.9, Math.round(live * 1000) / 10)); renderOddsLive(); } setStdNote(j.quoteStale ? 'Kalshi is rate-limiting - showing the last good quote' : 'live Kalshi quote'); drawStd(); }
      }).catch(function () { _realHist[m.id] = { at: Date.now(), pts: [], failed: true }; if (currentMarket && currentMarket.id === m.id && view === 'detail') { setStdNote('Kalshi unreachable - price is from the ' + 'site snapshot and may be old'); drawStd(); } });
      return;
    }
    var ids = tokenIdsOf(m);
    if (!ids.length) { _realHist[m.id] = { at: Date.now(), pts: [], none: true }; return; }
    _realHist[m.id] = { at: Date.now(), pts: (c && c.pts) || [], loading: true };
    var q = 'market=' + encodeURIComponent(ids[0]) + '&interval=1w&fidelity=60';
    fetch('https://clob.polymarket.com/prices-history?' + q).then(function (r) { if (!r.ok) throw new Error('clob ' + r.status); return r.json(); })
      .catch(function () { return fetch(API + '/clob/prices-history?' + q).then(function (r) { return r.ok ? r.json() : null; }); })
      .then(function (j) {
        var h = (j && j.history) || [];
        var pts = h.map(function (x) { return { t: Number(x.t) * 1000, y: Number(x.p) * 100 }; }).filter(function (x) { return x.t > 0 && x.y >= 0 && x.y <= 100; });
        _realHist[m.id] = { at: Date.now(), pts: pts };
        if (currentMarket && currentMarket.id === m.id && view === 'detail') drawStd();
      }).catch(function () { _realHist[m.id] = { at: Date.now(), pts: [], failed: true }; });
  }
  function drawStd() {
    var cv = el('opmStdG'); if (!cv || !currentMarket) return; var ctx = cv.getContext('2d');
    var w = cv.width, h = cv.height, pad = 4;
    var local = stdAppend(currentMarket.id, midYes);
    loadRealHistory(currentMarket);
    var rh = _realHist[currentMarket.id];
    var isReal = !!(rh && rh.pts && rh.pts.length > 1);
    var rawYes = Number(currentMarket.yesPriceNumber) * 100;
    var arr = isReal ? rh.pts.concat([{ t: Date.now(), y: (rawYes >= 0 && rawYes <= 100) ? rawYes : midYes }]) : local;
    ctx.clearRect(0, 0, w, h);
    if (arr.length < 2) {
      var yy = pad + (1 - midYes / 100) * (h - 2 * pad);
      ctx.setLineDash([4, 4]); ctx.strokeStyle = 'rgba(127,216,255,.5)'; ctx.beginPath(); ctx.moveTo(pad, yy); ctx.lineTo(w - pad, yy); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(160,184,203,.75)'; ctx.font = '10px ui-monospace,monospace'; ctx.textAlign = 'left'; ctx.fillText((rh && rh.loading) ? 'loading price history…' : 'no price history for this market yet', pad + 4, 14);
      ctx.textAlign = 'right'; ctx.fillText(Math.round(midYes) + '% Yes', w - pad - 2, 14); return;
    }
    var ys = arr.map(function (p) { return p.y; });
    var lo = Math.min.apply(0, ys), hi = Math.max.apply(0, ys); var rng = (hi - lo) || 1; lo -= rng * .15; hi += rng * .15; rng = hi - lo;
    var n = arr.length, gx = function (i) { return pad + i / (n - 1) * (w - 2 * pad); }, gy = function (v) { return pad + (1 - (v - lo) / rng) * (h - 2 * pad); };
    var up = ys[n - 1] >= ys[0], col = up ? '52,211,153' : '251,113,133';
    var g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, 'rgba(' + col + ',.28)'); g.addColorStop(1, 'rgba(' + col + ',0)');
    ctx.beginPath(); ctx.moveTo(gx(0), h - pad); ys.forEach(function (v, i) { ctx.lineTo(gx(i), gy(v)); }); ctx.lineTo(gx(n - 1), h - pad); ctx.closePath(); ctx.fillStyle = g; ctx.fill();
    ctx.beginPath(); ys.forEach(function (v, i) { i ? ctx.lineTo(gx(i), gy(v)) : ctx.moveTo(gx(i), gy(v)); }); ctx.strokeStyle = 'rgb(' + col + ')'; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.stroke();
    ctx.beginPath(); ctx.arc(gx(n - 1), gy(ys[n - 1]), 3.5, 0, 7); ctx.fillStyle = 'rgb(' + col + ')'; ctx.fill();
    ctx.fillStyle = 'rgba(160,184,203,.85)'; ctx.font = '10px ui-monospace,monospace'; ctx.textAlign = 'right'; ctx.fillText(Math.round(midYes) + '% Yes', w - pad - 2, 13);
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
  var _lastFillPushAt = 0, _fillT = null;
  window.addEventListener('ost:prediction-update', function (e) {
    var ev = e && e.detail; if (!ev || !/^prediction\.(fill|resolved)$/.test(String(ev.type))) return;
    _lastFillPushAt = Date.now();
    if (view !== 'detail') return;
    clearTimeout(_fillT); _fillT = setTimeout(function () { loadTrades(); refreshPosition(); }, 1500);
  });
  var lastPushRoundAt = 0;
  window.addEventListener('ost:btc-round', function (e) {
    var d = e && e.detail; if (!d || !Number.isFinite(Number(d.openAt))) return;
    lastPushRoundAt = Date.now();
    if (view === 'detail' && isBtcLive(currentMarket)) { saveRoundCache(d); applyRound(d); }
  });
  function applyRound(d) {
    if (!d || view !== 'detail') return;
    var prevId = round && round.marketId; round = d;
    try { var cfb = el('opmCf'); if (cfb && /round unavailable/i.test(cfb.getAttribute('data-blocked') || '')) { cfb.disabled = false; cfb.removeAttribute('data-blocked'); } } catch (_) {}
    beat = Number(d.priceToBeat) || beat;
    if (Number(d.livePrice) > 0) acceptTick(Number(d.livePrice), true);
    if (!baseMidSet && isFinite(Number(d.yesPriceNumber))) { midYes = Math.max(0.1, Math.min(99.9, Math.round(Number(d.yesPriceNumber) * 1000) / 10)); baseMidSet = true; renderOddsLive(); }
    var newRound = prevId && prevId !== d.marketId;
    if (newRound) {   // rollover = a NEW market: reset this round's live state
      buf = []; hist = []; dispPrice = 0; _lastTickAt = 0; baseMidSet = false; seenTrades = {}; firstTrades = true; onchainActive = false;
      myPos = null; renderPosition(); refreshPosition();
    }
    if (!prevId || newRound) loadTrades();   // (re)load round-scoped trades once the round id is known
    // The server sends THIS round's real ticks (timestamped, from round open). They used
    // to be dropped whenever 8 live ticks had already arrived - i.e. always - so LIVE
    // only ever showed the seconds since the page opened: a flat line. Merge every
    // server tick older than what we hold in FRONT of the live ones.
    if (Array.isArray(d.ticks) && d.ticks.length) {
      if (hist.length !== histT.length) histT = hist.map(function (_, i) { return Date.now() - (hist.length - i) * 1000; });
      var firstT = histT.length ? histT[0] : Infinity, addP = [], addT = [];
      d.ticks.forEach(function (t) { var tp = Number(t.p != null ? t.p : t.price), tt = Number(t.t || t.ts || t.at); if (tt > 0 && tt < 1e12) tt *= 1000; if (tp > 0 && tt > 0 && tt < firstT - 500) { addP.push(tp); addT.push(tt); } });
      if (addP.length) { hist = addP.concat(hist).slice(-HIST_MAX); histT = addT.concat(histT).slice(-HIST_MAX); }
    }
    tween(el('opmBeat'), beat, usd); applyDir(); draw();
    loadOnchain();
  }
  function loadRound() {
    return fetch(API + '/btc/round', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (d) {
      if (!d || d.ok === false) throw new Error('bad round');
      saveRoundCache(d); applyRound(d);
    }).catch(function () {
      // HONEST: no fabricated round. Use the last REAL round only while it is
      // still open; otherwise say the round is unavailable and block Buy.
      var c = null; try { c = JSON.parse(localStorage.getItem('ost.btc5m.round.lk') || 'null'); } catch (_) {}
      if (c && Number(c.closeAt) > Date.now()) { applyRound(c); return; }
      try { var cf = el('opmCf'); if (cf) { cf.disabled = true; cf.setAttribute('data-blocked', 'round unavailable'); } } catch (_) {}
      toast('Live round unavailable — reconnecting to the price feed.');
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

  /* ---- panes: trades · holders · comments ----
   * These used to fire one fetch each with an EMPTY catch, so a 429 from the worker
   * (it rate-limits per IP) left "Loading live trades…" on screen forever and a
   * second open never retried. Now every pane: times out, retries with backoff,
   * shows an honest error with a Retry button, reloads when its tab is opened,
   * and — for Polymarket markets — shows the venue's own activity next to OST's:
   * real trades and top holders from Polymarket's public data API. */
  function fetchJsonT(url, ms, init) {
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var t = setTimeout(function () { try { ctrl && ctrl.abort(); } catch (_) {} }, ms || 9000);
    init = Object.assign({ cache: 'no-store' }, init || {}); if (ctrl) init.signal = ctrl.signal;
    return fetch(url, init).then(function (r) { clearTimeout(t); if (!r.ok) throw new Error('http ' + r.status); return r.json(); }, function (e) { clearTimeout(t); throw e; });
  }
  var DATA_API = 'https://data-api.polymarket.com', GAMMA_API = 'https://gamma-api.polymarket.com';
  function dataApi(path) { return fetchJsonT(DATA_API + path, 8000).catch(function () { return fetchJsonT(API + '/data' + path, 9000); }); }
  function gammaApi(path) { return fetchJsonT(GAMMA_API + path, 8000).catch(function () { return fetchJsonT(API + '/gamma' + path, 9000); }); }
  var pane = { trades: { tries: 0, timer: 0 }, holders: { tries: 0, timer: 0 }, comments: { tries: 0, timer: 0 } };
  function paneRetry(kind, fn) {
    var st = pane[kind]; clearTimeout(st.timer); st.tries++;
    st.timer = setTimeout(function () { if (view === 'detail') fn(); }, Math.min(30000, 2500 * st.tries));
  }
  function paneError(hostId, msg, fn) {
    var host = el(hostId); if (!host) return;
    host.innerHTML = '<div class="opm-empty">' + esc(msg) + ' <button type="button" class="opm-tbtn opm-retry">Retry</button></div>';
    var b = host.querySelector('.opm-retry'); if (b) b.onclick = function () { host.innerHTML = '<div class="opm-empty">Loading…</div>'; fn(); };
  }
  function esc2(v) { return esc(v == null ? '' : v); }
  // Polymarket identity of the open market (a picked ladder outcome is its own market).
  function venueCondition(m) {
    if (!m || m.source !== 'polymarket') return '';
    if (m.isGrouped) { var lp = (legPick && String(legPick.marketId) === String(m.id)) ? legPick : null; if (!lp) { try { lp = window.OST_MARKET_CHART && OST_MARKET_CHART.selection(m.id); } catch (_) {} } return String((lp && lp.conditionId) || ''); }
    return String(m.conditionId || (m.raw && (m.raw.conditionId || m.raw.condition_id)) || '');
  }
  var _venue = {};   // conditionId -> { at, trades, holders }
  function venueTrades(m) {
    var c = venueCondition(m); if (!c) return Promise.resolve([]);
    var v = _venue[c]; if (v && v.trades && Date.now() - v.at < 30000) return Promise.resolve(v.trades);
    return dataApi('/trades?market=' + encodeURIComponent(c) + '&limit=40').then(function (arr) {
      arr = (Array.isArray(arr) ? arr : []).map(function (t) {
        var oi = Number(t.outcomeIndex), buy = String(t.side || '').toUpperCase() !== 'SELL';
        return { venue: true, id: 'pm:' + (t.transactionHash || (t.timestamp + ':' + t.proxyWallet)), side: (oi === 1 ? 'no' : 'yes'), outcome: t.outcome || (oi === 1 ? 'No' : 'Yes'), buy: buy, who: t.pseudonym || t.name || (String(t.proxyWallet || '').slice(0, 6) + '…'), avatar: t.profileImageOptimized || t.profileImage || '', size: Number(t.size) || 0, price: Number(t.price) || 0, ts: Number(t.timestamp) * 1000 };
      });
      _venue[c] = Object.assign(_venue[c] || {}, { at: Date.now(), trades: arr }); return arr;
    });
  }
  function venueHolders(m) {
    var c = venueCondition(m); if (!c) return Promise.resolve(null);
    var v = _venue[c]; if (v && v.holders && Date.now() - v.at < 60000) return Promise.resolve(v.holders);
    return dataApi('/holders?market=' + encodeURIComponent(c) + '&limit=8').then(function (arr) {
      var out = { yes: [], no: [] };
      (Array.isArray(arr) ? arr : []).forEach(function (tok) {
        (tok.holders || []).forEach(function (h) { var oi = Number(h.outcomeIndex); (oi === 1 ? out.no : out.yes).push({ who: h.pseudonym || h.name || (String(h.proxyWallet || '').slice(0, 6) + '…'), amount: Number(h.amount) || 0, avatar: h.profileImageOptimized || h.profileImage || '' }); });
      });
      out.yes.sort(function (a, b) { return b.amount - a.amount; }); out.no.sort(function (a, b) { return b.amount - a.amount; });
      _venue[c] = Object.assign(_venue[c] || {}, { at: Date.now(), holders: out }); return out;
    });
  }

  var _tradesGen = 0;
  function loadTrades() {
    var fid = feedTradeId(); if (!fid) return;
    var gen = ++_tradesGen, m = currentMarket;
    var ostP = fetchJsonT(API + '/positions/recent?marketId=' + encodeURIComponent(fid) + '&limit=60', 9000).then(function (d) { return (d && d.recent) || []; });
    var venP = venueTrades(m).catch(function () { return null; });
    return Promise.all([ostP.then(function (a) { return { ok: true, a: a }; }, function () { return { ok: false, a: [] }; }), venP]).then(function (res) {
      if (gen !== _tradesGen || view !== 'detail') return;
      var ost = res[0].a, venue = res[1];
      if (!res[0].ok && !(venue && venue.length)) { paneError('opmTrades', 'The live tape is not answering right now.', loadTrades); paneRetry('trades', loadTrades); return; }
      pane.trades.tries = 0;
      renderTrades(ost, venue || []); aggregateHolders(ost); aggregatePool(ost); paintOdds();
      if (!res[0].ok) paneRetry('trades', loadTrades);   // venue rows are up; keep trying for OST fills
      if (m && m.source === 'polymarket') loadHolders();
    });
  }
  function renderTrades(arr, venue) {
    var host = el('opmTrades'); if (!host) return;
    var rows = [];
    (arr || []).forEach(function (r) { var isSell = String(r.id || '').indexOf('sell:') === 0; rows.push({ venue: false, id: r.id || (r.wallet + r.ts), side: String(r.side || '').toUpperCase() === 'YES' ? 'yes' : 'no', buy: !isSell, who: r.walletShort || (String(r.wallet || '').slice(0, 4) + '…'), size: Number(r.shares) || 0, stake: Number(r.stake) || 0, price: Number(r.price) || 0, ts: Number(r.ts || r.createdAt) || Date.parse(r.ts || r.createdAt) || 0 }); });
    (venue || []).forEach(function (t) { rows.push(t); });
    rows.sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); });
    if (!rows.length) { host.innerHTML = '<div class="opm-empty">No trades yet — be the first.</div>'; firstTrades = false; return; }
    var ostCount = (arr || []).length, venCount = (venue || []).length;
    var head = (venCount ? '<div class="opm-tapehead"><span><i class="ost"></i>OST ' + ostCount + '</span><span><i class="pm"></i>Polymarket ' + venCount + '</span></div>' : '');
    host.innerHTML = head + rows.slice(0, 30).map(function (r) {
      var y = r.side === 'yes'; var isNew = !seenTrades[r.id]; seenTrades[r.id] = 1;
      var amt = r.venue ? (compact(r.size) + ' sh') : (r.stake > 0 ? compact(r.stake) + ' OSTG' : (r.size > 0 ? compact(r.size) + ' sh' : ''));
      var px = r.price > 0 ? ' @ ' + fmtc(r.price * 100) + '¢' : '';
      var lab = (r.buy === false ? 'Sold ' : '') + (r.venue && r.outcome && !/^(yes|no)$/i.test(r.outcome) ? r.outcome : (y ? 'Yes' : 'No'));
      return '<div class="opm-trade' + (isNew && !firstTrades ? ' in' : '') + (r.venue ? ' venue' : '') + '"><span class="s ' + (y ? 'y' : 'n') + '">' + esc2(lab) + '</span>' +
        '<span class="who">' + (r.avatar ? '<img class="av" alt="" loading="lazy" referrerpolicy="no-referrer" src="' + esc2(r.avatar) + '">' : '') + esc2(r.who) + (r.venue ? ' <em>PM</em>' : '') + '</span><span class="amt">' + esc2(amt + px) + '</span><span class="t">' + esc2(ago(r.ts)) + '</span></div>';
    }).join(''); firstTrades = false;
  }
  function aggregatePool(arr) {
    if (onchainActive) return;   // the on-chain vault is authoritative; don't overwrite it
    var y = 0, n = 0; arr.forEach(function (r) { var isSell = String(r.id || '').indexOf('sell:') === 0; var stake = Number(r.stake) || 0; if (isSell || !(stake > 0)) return; if (String(r.side || '').toUpperCase() === 'YES') y += stake; else n += stake; });
    poolY = Math.round(y); poolN = Math.round(n);
  }
  var _ostHolders = [];
  function aggregateHolders(arr) {
    var by = {};
    (arr || []).forEach(function (r) { var w = r.wallet; if (!w) return; var sh = Number(r.shares) || 0; if (!(sh > 0)) return; var isSell = String(r.id || '').indexOf('sell:') === 0; var y = String(r.side || '').toUpperCase() === 'YES'; by[w] = by[w] || { short: r.walletShort || (String(w).slice(0, 4) + '…' + String(w).slice(-4)), net: 0, side: y ? 'y' : 'n' }; by[w].net += (isSell ? -sh : sh); if (!isSell) by[w].side = y ? 'y' : 'n'; });
    _ostHolders = Object.keys(by).map(function (k) { return by[k]; }).filter(function (h) { return h.net > 0.01; }).sort(function (a, b) { return b.net - a.net; }).slice(0, 8);
    renderHolders();
  }
  var _venueHolders = null, _holdersGen = 0;
  function loadHolders() {
    var m = currentMarket; if (!m || m.source !== 'polymarket') { _venueHolders = null; renderHolders(); return; }
    var gen = ++_holdersGen;
    venueHolders(m).then(function (h) { if (gen !== _holdersGen || view !== 'detail') return; _venueHolders = h; pane.holders.tries = 0; renderHolders(); })
      .catch(function () { if (gen !== _holdersGen || view !== 'detail') return; _venueHolders = { error: true }; renderHolders(); paneRetry('holders', loadHolders); });
  }
  function holderRows(list, sideCls, unit) {
    var max = list[0] ? (list[0].net || list[0].amount || 1) : 1;
    return list.map(function (h, i) { var v = h.net != null ? h.net : h.amount; var pct = Math.max(6, Math.round(v / max * 100)); var col = sideCls === 'n' ? 'linear-gradient(90deg,#e11d48,#fb7185)' : 'linear-gradient(90deg,#10b981,#34d399)'; var c = sideCls === 'n' ? 'var(--opm-no)' : 'var(--opm-yes)';
      return '<div class="opm-holder"><span class="rank">' + (i + 1) + '</span><span class="addr">' + (h.avatar ? '<img class="av" alt="" loading="lazy" referrerpolicy="no-referrer" src="' + esc2(h.avatar) + '">' : '') + esc2(h.short || h.who) + '</span><span class="bar"><i style="width:' + pct + '%;background:' + col + '"></i></span><span class="sh" style="color:' + c + '">' + num0(v) + (unit ? ' ' + unit : '') + '</span></div>'; }).join('');
  }
  function renderHolders() {
    var host = el('opmHolders'); if (!host) return;
    var html = '';
    if (_ostHolders.length) html += '<div class="opm-sec2">OST holders</div>' + holderRows(_ostHolders.filter(function (h) { return h.side === 'y'; }), 'y', 'sh') + holderRows(_ostHolders.filter(function (h) { return h.side === 'n'; }), 'n', 'sh');
    var vh = _venueHolders;
    if (vh && !vh.error && (vh.yes.length || vh.no.length)) {
      html += '<div class="opm-sec2">Polymarket · top Yes holders</div>' + (vh.yes.length ? holderRows(vh.yes.slice(0, 5), 'y', '') : '<div class="opm-empty">—</div>') +
              '<div class="opm-sec2">Polymarket · top No holders</div>' + (vh.no.length ? holderRows(vh.no.slice(0, 5), 'n', '') : '<div class="opm-empty">—</div>');
    } else if (vh && vh.error && !html) { paneError('opmHolders', 'Holders are not answering right now.', loadHolders); return; }
    else if (!html && currentMarket && currentMarket.source === 'polymarket' && !vh) { host.innerHTML = '<div class="opm-empty">Loading holders…</div>'; return; }
    host.innerHTML = html || '<div class="opm-empty">No holders yet.</div>';
  }
  // Comments: OST users (worker) + the venue's thread (Gamma, read-only) for Polymarket markets.
  var _cmtGen = 0, _venueEvent = {};
  function venueEventId(m) {
    if (!m || m.source !== 'polymarket') return Promise.resolve('');
    var id = String(m.id); if (/^group:\d+$/.test(id)) return Promise.resolve(id.slice(6));
    if (_venueEvent[id] !== undefined) return Promise.resolve(_venueEvent[id]);
    if (!/^\d+$/.test(id)) return Promise.resolve('');
    return gammaApi('/markets/' + id).then(function (g) { var ev = g && Array.isArray(g.events) && g.events[0]; _venueEvent[id] = ev && ev.id ? String(ev.id) : ''; return _venueEvent[id]; }).catch(function () { return ''; });
  }
  function loadComments() {
    var fid = feedCommentId(); if (!fid) return;
    var gen = ++_cmtGen, m = currentMarket;
    var ostP = fetchJsonT(API + '/predict/comments?marketId=' + encodeURIComponent(fid), 9000).then(function (d) { return { ok: true, a: (d && d.comments) || [] }; }, function () { return { ok: false, a: [] }; });
    var venP = venueEventId(m).then(function (eid) { if (!eid) return []; return gammaApi('/comments?parent_entity_type=Event&parent_entity_id=' + eid + '&limit=25&order=createdAt&ascending=false').then(function (arr) { return Array.isArray(arr) ? arr : []; }); }).catch(function () { return []; });
    return Promise.all([ostP, venP]).then(function (res) {
      if (gen !== _cmtGen || view !== 'detail') return;
      var host = el('opmComments'); if (!host) return;
      var ost = res[0].a.slice().reverse(), ven = res[1];
      if (!res[0].ok && !ven.length) { paneError('opmComments', 'Comments are not answering right now.', loadComments); paneRetry('comments', loadComments); return; }
      pane.comments.tries = 0;
      var rows = ost.slice(0, 40).map(function (c) { var initials = String(c.handle || c.walletShort || '?').replace(/[^a-z0-9]/gi, '').slice(0, 2).toUpperCase() || '0X'; return '<div class="opm-cmt"><div class="av">' + esc2(initials) + '</div><div class="b"><div class="n">' + esc2(c.handle || c.walletShort || 'anon') + '<span>' + ago(c.ts) + '</span></div><p>' + esc2(c.text) + '</p></div></div>'; });
      if (ven.length) rows.push('<div class="opm-sec2">Polymarket thread</div>');
      ven.slice(0, 25).forEach(function (c) { var p = c.profile || {}; var name = p.name || p.pseudonym || (String(p.proxyWallet || c.userAddress || '').slice(0, 6) + '…'); var av = p.profileImageOptimized || p.profileImage || ''; rows.push('<div class="opm-cmt venue"><div class="av">' + (av ? '<img alt="" loading="lazy" referrerpolicy="no-referrer" src="' + esc2(av) + '">' : esc2(String(name).slice(0, 2).toUpperCase())) + '</div><div class="b"><div class="n">' + esc2(name) + ' <em>PM</em><span>' + ago(Date.parse(c.createdAt || '') || 0) + '</span></div><p>' + esc2(c.body || '') + '</p></div></div>'); });
      host.innerHTML = rows.length ? rows.join('') : '<div class="opm-empty">Be the first to comment.</div>';
      if (!res[0].ok) paneRetry('comments', loadComments);
    });
  }
  function postComment() {
    var inp = el('opmCmtIn'); if (!inp) return; var text = String(inp.value || '').trim(); if (!text) return;
    var wallet = walletAddr(); if (!wallet) { toast('Connect a wallet to comment.'); return; }
    inp.value = ''; inp.disabled = true;
    fetch(API + '/predict/comments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ wallet: wallet, text: text, marketId: feedCommentId(), handle: meshHandle() }) })
      .then(function (r) { return r.json(); }).then(function (d) { inp.disabled = false; if (d && d.error === 'slow_down') { toast('Slow down a moment.'); return; } loadComments(); })
      .catch(function () { inp.disabled = false; inp.value = text; toast('Could not post — try again.'); });
  }

  /* ---- position ---- */
  function refreshPosition() {
    var mid = activeMarketId(); var orders = ledgerOrders();
    var open = orders.filter(function (o) {
      if (!o || o.cashedOut) return false; var st = String(o.status || o.outcome || '').toLowerCase(); if (st === 'won' || st === 'lost' || st === 'settled' || st === 'sold') return false;
      var omid = String(o.marketId || '');
      if (isBtcLive(currentMarket)) return mid ? omid === mid : /^ost-btc5m-\d+$/.test(omid);
      return marketOwnsOrder(currentMarket, omid);
    });
    if (!open.length) { myPos = null; renderPosition(); return; }
    var o = open.sort(function (a, b) { return Number(b.ts || 0) - Number(a.ts || 0); })[0];
    var sig = o.signature || o.sig || o.id || '';
    var btn = sig ? document.querySelector('.prediction-cashout-btn[data-order-sig="' + (window.CSS && CSS.escape ? CSS.escape(sig) : sig) + '"]') : null;
    // ostg-native positions used to be LOCKED until close (the server had no early
    // exit). They now sell via /play/predict/cashout, so they are no longer locked
    // — carry the server position id so confirmSell can cash them out on demand.
    var isNative = (o.fundedBy === 'ostg-native');
    myPos = { order: o, sig: sig, native: isNative, posId: o.serverPositionId || o.id || sig, side: (o.side === 'no' ? 'no' : 'yes'), shares: Number(o.shares) || 0, entry: Number(o.entry) || Number(o.price) || 0, locked: false, sellBtn: btn, cashText: btn ? btn.textContent : '' };
    renderPosition();
  }
  // A ladder bet lives on the LEG market (its own id); the page is the group.
  function marketOwnsOrder(m, omid) {
    if (!m) return false; if (omid === String(m.id || '')) return true;
    if (m.isGrouped && Array.isArray(m.outcomes)) return m.outcomes.some(function (o) { return o && String(o.marketId || o.key || '') === omid; });
    return false;
  }
  function marketForOrderId(omid) {
    var ms = allMarkets(); omid = String(omid || '');
    for (var i = 0; i < ms.length; i++) if (marketOwnsOrder(ms[i], omid)) return ms[i];
    return null;
  }
  function posValueNow() { if (!myPos) return 0; var c = myPos.side === 'yes' ? midYes : (100 - midYes); return myPos.shares * (c / 100); }
  function posCost() { return myPos ? myPos.shares * (myPos.entry || 0) : 0; }
  function renderPosition() {
    var wrap = el('opmPosWrap'); if (!wrap) return; if (!myPos) { wrap.innerHTML = ''; return; }
    var val = posValueNow(), cost = posCost(), pnl = val - cost, up = pnl >= 0;
    var pnlTxt = (up ? '+' : '−') + Math.abs(pnl).toFixed(2) + ' OSTG' + (cost > 0 ? ' (' + (up ? '+' : '−') + Math.abs(pnl / cost * 100).toFixed(0) + '%)' : '');
    var sideCls = myPos.side === 'yes' ? 'y' : 'n', sideLab = myPos.side === 'yes' ? 'Yes' : 'No';
    var action;
    var pendTag = myPos.pending ? '<span class="opm-pend">confirming…</span>' : (myPos.justFilled && Date.now() - myPos.justFilled < 4000 ? '<span class="opm-pend ok">✓ filled</span>' : '');
    if (myPos.selling) { action = '<div class="opm-locked">Selling… confirming with the server</div>'; }
    else if (myPos.locked) { action = '<div class="opm-locked">' + icon('lock') + ' Locked · settles automatically at round close</div>'; }
    else if (myPos.sellBtn) { var net = (myPos.cashText.match(/([\d,]+\.?\d*)\s*$/) || [])[1] || val.toFixed(2); var isSettle = /settle|claim/i.test(myPos.cashText); action = '<div class="opm-pcbtns"><button class="addmore" id="opmAddMore">Add more</button><button class="sell" id="opmSellBtn">' + (isSettle ? 'Settle' : 'Sell') + ' · ' + esc(net) + ' OSTG</button></div>'; }
    else { action = '<div class="opm-pcbtns"><button class="addmore" id="opmAddMore">Add more</button><button class="sell" id="opmSellBtn">Sell · ' + val.toFixed(2) + ' OSTG</button></div>'; }
    wrap.innerHTML = '<div class="opm-poscard"><div class="pch">Your position <span class="side ' + sideCls + '">' + sideLab + '</span>' + pendTag + '<span class="sp"></span><span class="pnl ' + (up ? 'up' : 'down') + '">' + esc(pnlTxt) + '</span></div>' +
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
      if (window.OST_PREDICTION_API && OST_PREDICTION_API.patchOrderByRef && ref && OST_PREDICTION_API.patchOrderByRef(ref, patch) !== false) return;   // false = not found: record it instead of pretending
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
  function openSheet(m, s) {
    mode = m; if (s) side = s;
    // Lock the exit price the instant the sell ticket opens; clear it for buy.
    _sellLock = (m === 'sell') ? lockSellQuote() : null;
    syncYnSel(); paintTicket(); el('opmSheet').classList.add('open'); el('opmScrim').classList.add('open');
  }
  function closeSheet() { _sellLock = null; var sh = el('opmSheet'), sc = el('opmScrim'); if (sh) sh.classList.remove('open'); if (sc) sc.classList.remove('open'); }
  // Snapshot the live quote as the locked exit. Re-callable to "update" the lock.
  function lockSellQuote() { var q = sellQuote(); q.at = Date.now(); return q; }
  function relockSell() { _sellLock = lockSellQuote(); var t = el('opmTicket'); if (t) { t.innerHTML = sellConfirmTicket(); var cfs = el('opmCfSell'); if (cfs) cfs.onclick = confirmSell; wireSellLockRow(); } }
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
    var rows = '<div class="opm-tl"><span class="k">Fill price</span><span class="v">' + fmtc(e.c) + '¢</span></div>' +
      '<div class="opm-tl"><span class="k">Shares</span><span class="v" id="opmShV">' + e.shares.toFixed(2) + '</span></div>';
    if (e.spreadAmt > 0) rows += '<div class="opm-tl"><span class="k">Market spread (' + (e.sBps / 100) + '%)</span><span class="v">' + e.spreadAmt.toFixed(2) + '</span></div>';
    rows += '<div class="opm-tl"><span class="k">Fee (2% profit)</span><span class="v">' + e.fee.toFixed(2) + '</span></div>' +
      '<div class="opm-tl big"><span class="k">To win</span><span class="v">' + e.net.toFixed(2) + ' OSTG<span class="opm-roi">+' + e.roi.toFixed(0) + '%</span></span></div>';
    return rows;
  }
  function buyTicket() {
    var e = buyEstimate(amt);
    return '<h3>' + icon('ticket') + ' Buy</h3>' +
      '<div class="opm-tkout"><button class="y' + (side === 'yes' ? ' sel' : '') + '" data-t="yes"><span class="lab">Yes</span><span class="px">' + fmtc(midYes) + '¢</span></button>' +
      '<button class="n' + (side === 'no' ? ' sel' : '') + '" data-t="no"><span class="lab">No</span><span class="px">' + fmtc(100 - midYes) + '¢</span></button></div>' +
      '<div class="opm-amt"><input id="opmAmtIn" inputmode="decimal" value="' + amt + '"><span class="cur">OSTG</span></div>' +
      '<div class="opm-quick">' + [10, 25, 100, 'Max'].map(function (q) { return '<button data-q="' + String(q).toLowerCase() + '">' + q + '</button>'; }).join('') + '</div>' +
      '<div class="opm-src"><span class="l"><span class="d"></span> ' + (onchainActive ? 'Wallet OST · on-chain' : 'Personal OSTG') + '</span></div>' +
      '<div class="opm-sess" id="opmSess"></div>' +
      '<div class="opm-bd" id="opmBuyBd">' + buyBdHtml(e) + '</div>' +
      '<button class="opm-confirm' + (side === 'no' ? ' no' : '') + '" id="opmCf">Buy ' + (side === 'yes' ? 'Yes' : 'No') + ' · ' + amt + ' OSTG</button>' +
      '<div class="opm-fine">' + icon('lock') + ' ' + (isBtcLive(currentMarket) ? 'Settles from the on-chain price at close' : 'Settles when the market resolves') + '</div>';
  }
  function sellQuote() {
    var c = myPos ? (myPos.side === 'yes' ? midYes : (100 - midYes)) : 0;
    var shares = myPos ? myPos.shares : 0, gross = shares * (c / 100), cost = posCost();
    var profit = Math.max(0, gross - cost), fee = profit * 0.02;
    var realNet = (myPos && myPos.cashText && (myPos.cashText.match(/([\d,]+\.?\d*)\s*$/) || [])[1]) || (gross - fee).toFixed(2);
    var netNum = parseFloat(String(realNet).replace(/,/g, '')) || (gross - fee);
    var pnl = netNum - cost, up = pnl >= 0;
    var isSettle = myPos && /settle|claim/i.test(myPos.cashText || '');
    return { c: c, shares: shares, fee: fee, realNet: String(realNet), pnl: pnl, up: up, isSettle: isSettle };
  }
  function sellConfirmTicket() {
    // Use the LOCKED snapshot so the ticket is stable while open (see _sellLock).
    var q = _sellLock || sellQuote();
    var lockRow = q.isSettle ? '' :
      '<div class="opm-tl" style="cursor:pointer" id="opmSellLockRow"><span class="k">' + icon('lock') + ' Exit price locked</span><span class="v" style="color:var(--opm-gold);text-decoration:underline">tap to update</span></div>';
    return '<h3>' + icon('coin') + ' ' + (q.isSettle ? 'Settle position' : 'Sell your ' + (myPos && myPos.side === 'yes' ? 'Yes' : 'No') + ' position') + '</h3>' +
      '<div class="opm-fine" style="text-align:left;color:var(--opm-ink2)">' + (q.isSettle ? 'Claim your settled position — the amount is computed and paid by the server.' : 'Exit at the locked price below — it stays put while ticks move, so your tap always sells. Tap “update” to grab the newest price.') + '</div>' +
      '<div class="opm-bd">' +
        lockRow +
        '<div class="opm-tl"><span class="k">Selling</span><span class="v">' + q.shares.toFixed(2) + ' shares</span></div>' +
        '<div class="opm-tl"><span class="k">Sell price</span><span class="v" id="opmSellPx">' + fmtc(q.c) + '¢</span></div>' +
        '<div class="opm-tl"><span class="k">Fee (2% profit)</span><span class="v" id="opmSellFee">' + q.fee.toFixed(2) + '</span></div>' +
        '<div class="opm-tl"><span class="k">Realized P&amp;L</span><span class="v" id="opmSellPnl" style="color:var(--opm-' + (q.up ? 'yes' : 'no') + ')">' + (q.up ? '+' : '−') + Math.abs(q.pnl).toFixed(2) + ' OSTG</span></div>' +
        '<div class="opm-tl big"><span class="k">You receive</span><span class="v" id="opmSellNet" style="color:var(--opm-gold)">' + q.realNet + ' OSTG</span></div>' +
      '</div>' +
      '<button class="opm-confirm sellc" id="opmCfSell">' + (q.isSettle ? 'Settle for ' : 'Sell for ') + q.realNet + ' OSTG</button>' +
      '<div class="opm-fine">' + icon('lock') + ' Proceeds return to your Play OSTG instantly.</div>';
  }
  function wireSellLockRow() { var r = el('opmSellLockRow'); if (r) r.onclick = relockSell; }
  // One-tap betting (session key). Only meaningful on the on-chain 5-min rail.
  function sessionActive() { try { return !!(window.OST_SESSION && OST_SESSION.exists() && OST_SESSION.balance() > 0); } catch (_) { return false; } }
  function renderSessionRow() {
    var host = el('opmSess'); if (!host) return;
    if (!isBtcLive(currentMarket)) { host.innerHTML = ''; return; }
    if (sessionActive()) {
      host.innerHTML = '<div class="opm-sesson"><span>⚡ 1-tap ON · ' + (Number(OST_SESSION.balance()) || 0).toFixed(0) + ' OSTG left</span><button id="opmSessEnd">End</button></div>';
      var e = el('opmSessEnd'); if (e) e.onclick = function () { e.disabled = true; e.textContent = '…'; OST_SESSION.end().then(function () { toast('Session ended — funds returned to your wallet.'); renderSessionRow(); }).catch(function (err) { toast((err && err.message) || 'Could not end session'); e.disabled = false; e.textContent = 'End'; }); };
    } else {
      // Explicit, amount-first consent: the user picks how much OSTG to park in
      // the session key (hard-capped by OST_SESSION.limits and by the wallet),
      // and the confirm button's label carries that amount. Nothing is funded
      // until that tap — the old row moved the whole wallet balance.
      var lim = (OST_SESSION.limits) || { min: 1, max: 500, suggested: 25 };
      var wal = 0; try { wal = Math.floor(Number(OST_SESSION.walletBalance()) || 0); } catch (_) {}
      var maxF = Math.max(0, Math.min(lim.max, wal));
      if (!(maxF >= lim.min)) { host.innerHTML = '<div class="opm-sessoff"><span>⚡ 1-tap betting</span><em>' + (wal > 0 ? 'Needs at least ' + lim.min + ' OSTG in your wallet.' : 'Add OSTG to your wallet to enable 1-tap.') + '</em></div>'; return; }
      var pick = Math.min(sessPick || lim.suggested, maxF);
      var chips = [10, 25, 50, 100, 250].filter(function (v) { return v <= maxF; });
      if (chips.indexOf(maxF) < 0 && maxF < 250) chips.push(maxF);
      host.innerHTML = '<div class="opm-sessoff">' +
        '<div class="opm-sessh"><span>⚡ 1-tap betting</span><em>Park a small amount in a session key — bets then confirm instantly with no popup. Only this amount can ever be spent; End returns the rest.</em></div>' +
        '<div class="opm-sesschips">' + chips.map(function (v) { return '<button type="button" data-v="' + v + '"' + (v === pick ? ' class="on"' : '') + '>' + v + '</button>'; }).join('') +
          '<input type="number" id="opmSessAmt" min="' + lim.min + '" max="' + maxF + '" step="1" value="' + pick + '" aria-label="OSTG to load"></div>' +
        '<button class="opm-sessbtn" id="opmSessOn">Load ' + pick + ' OSTG into 1-tap · 1 signature</button>' +
        '<div class="opm-fine">Wallet ' + wal + ' OSTG · max ' + maxF + ' per session</div></div>';
      host.querySelectorAll('.opm-sesschips button').forEach(function (c) { c.onclick = function () { sessPick = Number(c.getAttribute('data-v')) || lim.suggested; renderSessionRow(); }; });
      var ai = el('opmSessAmt'); if (ai) ai.oninput = function () { var v = Math.floor(Number(this.value) || 0); sessPick = v; var bb = el('opmSessOn'); if (bb) { var ok = v >= lim.min && v <= maxF; bb.disabled = !ok; bb.textContent = ok ? 'Load ' + v + ' OSTG into 1-tap · 1 signature' : 'Enter ' + lim.min + '–' + maxF + ' OSTG'; } };
      var b = el('opmSessOn'); if (b) b.onclick = function () {
        var v = Math.floor(Number((el('opmSessAmt') || {}).value) || pick);
        if (!(v >= lim.min && v <= maxF)) { toast('Pick between ' + lim.min + ' and ' + maxF + ' OSTG.'); return; }
        b.disabled = true; b.textContent = 'Funding ' + v + ' OSTG… approve in your wallet';
        OST_SESSION.fund(v, { consent: true }).then(function () { toast('1-tap on — ' + v + ' OSTG loaded. Bets now confirm instantly.'); renderSessionRow(); refreshBalance(); }).catch(function (err) { toast((err && err.message) || 'Could not enable 1-tap'); renderSessionRow(); });
      };
    }
  }
  var sessPick = 0;
  window.addEventListener('ost:session:offer', function () { try { renderSessionRow(); } catch (_) {} });
  window.addEventListener('ost:session:change', function () { try { if (el('opmSess') && !el('opmSessAmt')) renderSessionRow(); } catch (_) {} });
  function paintTicket() {
    var t = el('opmTicket'); if (!t) return;
    if (mode === 'sell') { t.innerHTML = sellConfirmTicket(); var cfs = el('opmCfSell'); if (cfs) cfs.onclick = confirmSell; wireSellLockRow(); return; }
    t.innerHTML = buyTicket();
    renderSessionRow();
    document.querySelectorAll('#opmTicket .opm-tkout button').forEach(function (b) { b.onclick = function () { side = b.getAttribute('data-t'); syncYnSel(); paintTicket(); }; });
    document.querySelectorAll('#opmTicket .opm-quick button').forEach(function (b) { b.onclick = function () { var q = b.getAttribute('data-q'); amt = q === 'max' ? maxBal() : (parseFloat(q) || amt); paintTicket(); }; });
    var inp = el('opmAmtIn'); if (inp) inp.oninput = function () { amt = parseFloat(this.value) || 0; refreshOpenSheet(true); };
    var cf = el('opmCf'); if (cf) cf.onclick = confirmBuy;
  }
  function confirmBuy() {
    var cf = el('opmCf'); if (!cf || cf.disabled) return; var stake = amt;
    if (!(stake > 0)) { toast('Enter an amount.'); return; }
    if (!btcPriceLive()) { toast('No live BTC price right now - trading is paused.'); paintTradeGate(); return; }
    var mid = activeMarketId(); if (!mid) { toast('Market not ready — try again.'); return; }
    var bSide = side, c = bSide === 'yes' ? midYes : (100 - midYes), sh = c > 0 ? stake / (c / 100) : 0, entry = c / 100;
    // OPTIMISTIC: reflect the bet the instant they tap — balance down, position in.
    // The real placeBet reconciles in the background; on failure we revert to truth.
    var bBefore = playBal();
    // OPTIMISTIC: the balance drops the instant they tap and HOLDS there (won't
    // bounce back up on a stale reconcile-read) until the server confirms.
    // Hold the reduced value long enough to outlast the on-chain wallet read lag
    // after the top-up deposit — otherwise a stale-high re-read bounces the balance
    // back up and it "doesn't react". The hold auto-releases the instant a real
    // read confirms a total <= the optimistic value (see setBalDisplay).
    if (bBefore != null) { var opt = Math.max(0, bBefore - stake); _balHold = { v: opt, dir: 'down', until: Date.now() + 40000 }; setBalDisplay(opt); }
    if (myPos && myPos.side === bSide) { var tot = myPos.shares + sh; myPos.entry = (myPos.shares * (myPos.entry || 0) + sh * entry) / (tot || 1); myPos.shares = tot; myPos.pending = true; }
    else { myPos = { order: {}, sig: '', side: bSide, shares: sh, entry: entry, locked: false, sellBtn: null, cashText: '', pending: true }; }
    renderPosition(); closeSheet();
    // DIRECT ORDER for every non-BTC market. The old path clicked the hidden
    // legacy board (card → side toggle → stake input → action button) and then
    // POLLED the ledger every 500ms for up to 45s — that was the "not instant"
    // feeling. placeOrder records the ticket synchronously (credits) or
    // optimistically (wallet), so the position is real the moment it returns.
    var api = window.OST_PREDICTION_API || {};
    var run = (!isBtcLive(currentMarket) && typeof api.placeOrder === 'function')
      ? Promise.resolve().then(function () { return api.placeOrder(buildDirectOrder(currentMarket, bSide, stake)); })
      : ensurePlayFunds(stake).then(function () { return api.placeBet({ marketId: mid, side: bSide, stake: stake }); });
    run.then(function () {
        if (myPos) { myPos.pending = false; myPos.justFilled = Date.now(); }
        refreshPosition(); renderPosition(); refreshBalance();
        setTimeout(function () { refreshBalance(); refreshPosition(); loadTrades(); }, 900);
      })
      .catch(function (e) { _balHold = null; toast((e && e.message) ? e.message : 'Could not place the bet — reverted.'); refreshBalance(); refreshPosition(); });
  }
  // The order payload app.js's createPredictionMarketOrder expects, built from the
  // page's own live quote. A picked ladder outcome routes the bet to that REAL leg
  // market (each Polymarket bucket is its own binary market), so it resolves natively.
  function buildDirectOrder(m, bSide, stake) {
    var lp = (legPick && String(legPick.marketId) === String(m.id)) ? legPick : null;
    if (!lp && m.isGrouped) { try { lp = window.OST_MARKET_CHART && OST_MARKET_CHART.selection(m.id); } catch (_) {} }
    var yes = Math.max(0.001, Math.min(0.999, midYes / 100));
    var priceFraction = bSide === 'yes' ? yes : 1 - yes;
    var shares = stake / priceFraction;
    var marketId = String(m.id), title = m.title || m.contractLabel || 'Market', cond = m.conditionId || (m.raw && (m.raw.conditionId || m.raw.condition_id)) || '';
    var gammaId = m.gammaMarketId || '', ids = tokenIdsOf(m);
    if (lp && lp.legId) { marketId = String(lp.legId); title = title + ' · ' + lp.label; cond = lp.conditionId || cond; gammaId = String(lp.legId); ids = Array.isArray(lp.clobTokenIds) ? lp.clobTokenIds : ids; }
    var live = false; try { live = !!(window.OST_MARKET_CHART && OST_MARKET_CHART.quoteFresh(m)); } catch (_) {}
    return {
      source: m.source, marketId: marketId, conditionId: cond, gammaMarketId: gammaId, title: title, topic: m.topic || '',
      side: bSide, outcomeKey: lp ? String(lp.key || '') : '', outcomeLabel: lp ? String(lp.label || '') : '',
      stake: stake, price: priceFraction, yesPrice: yes, noPrice: 1 - yes, shares: shares, potentialReturn: shares,
      closeAtMs: Number(m.closeAtMs) || 0, clobTokenIds: ids, sourceUrl: m.primaryUrl || '',
      baseYesPrice: yes, fairYesPrice: yes, fairNoPrice: 1 - yes, tradableYesPrice: yes, tradableNoPrice: 1 - yes,
      quotedAt: Date.now(), quoteSource: live ? 'clob-live' : 'catalog', reference: 'ost-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
    };
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
    // ostg-native positions exit through the server cash-out endpoint (there is no
    // DOM cash-out button for them). This is what unlocks "go out before close".
    if (myPos.native) { return confirmSellNative(cfs); }
    var api = window.OST_PREDICTION_API, sig = myPos.sig;
    if (!(api && typeof api.cashOut === 'function' && sig)) { return confirmSellLegacy(cfs); }
    // INSTANT: the sale used to click the hidden ledger button and wait a fixed
    // 1.7s before re-reading. Now it calls the cash-out routine directly. The
    // balance jumps by the locked quote and the sheet closes the instant they tap;
    // the position shows "Selling…" until the payout lands, and a failure restores
    // it and says why (the ticket stays exactly as sellable as it was).
    var lockedNet = _sellLock && parseFloat(String(_sellLock.realNet).replace(/,/g, ''));
    var est = lockedNet > 0 ? lockedNet : posValueNow();
    var b = playBal(); if (b != null && est > 0) { _balHold = { v: b + est, dir: 'up', until: Date.now() + 40000 }; setBalDisplay(b + est); }
    var sellingPos = myPos; sellingPos.selling = true; closeSheet(); renderPosition();
    api.cashOut(sig).then(function (r) {
      if (!r || r.ok === false) throw new Error((r && r.label) ? r.label : 'not sellable yet');
      if (_balHold) _balHold.until = Date.now() + 4000;
      myPos = null; renderPosition(); refreshPosition();
      var got = Number(r.payout) || 0;
      toast((r.kind === 'prediction-settlement' || /settle|claim/i.test(String(r.kind || '')) ? 'Settled — ' : 'Sold — ') + got.toFixed(2) + ' OSTG back to your balance.');
      setTimeout(function () { refreshBalance(); refreshPosition(); loadTrades(); }, 600);
    }).catch(function (e) {
      _balHold = null; sellingPos.selling = false; renderPosition(); refreshPosition();
      toast('Could not sell — ' + ((e && e.message) || 'try again') + '.');
      refreshBalance();
    });
  }
  // Fallback when the cash-out API is not loaded: drive the ledger button.
  function confirmSellLegacy(cfs) {
    var sig = myPos.sig, tries = 0;
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
      var b = playBal(); if (b != null && net > 0) { _balHold = { v: b + net, dir: 'up', until: Date.now() + 40000 }; setBalDisplay(b + net); }
      setTimeout(function () {
        closeSheet();
        var still = ledgerOrders().some(function (o) { return (o.signature || o.sig || o.id) === sig && !o.cashedOut && !/won|lost|sold|settled/i.test(String(o.status || '')); });
        if (still) { _balHold = null; }
        refreshBalance(); refreshPosition(); loadTrades();
      }, 1700);
    })();
  }
  // Early cash-out for an ostg-native position via the server. Optimistic: the
  // balance jumps by the estimated proceeds the instant they tap, and reverts if
  // the server rejects. The server prices the sell at ITS current odds and pays
  // shares × price − fee, so the number may settle slightly off the estimate.
  function confirmSellNative(cfs) {
    var posId = myPos.posId, order = myPos.order;
    if (!posId) { if (cfs) { cfs.disabled = false; cfs.textContent = 'Sell'; } toast('This position has no server id yet — try again in a moment.'); return; }
    if (round && Number(round.closeAt) - Date.now() < 3000) {   // server would reject as round_closed
      if (cfs) { cfs.disabled = false; cfs.textContent = 'Sell'; }
      toast('Too close to round end — it settles automatically now.');
      return;
    }
    // Use the LOCKED net the user actually saw for the optimistic bump, not a
    // fresh live recompute (which would already have drifted).
    var lockedNet = _sellLock && parseFloat(String(_sellLock.realNet).replace(/,/g, ''));
    var estGross = (lockedNet > 0 ? lockedNet : posValueNow());
    var b = playBal(); if (b != null && estGross > 0) { _balHold = { v: b + estGross, dir: 'up', until: Date.now() + 40000 }; setBalDisplay(b + estGross); }
    // INSTANT: the sheet used to sit on "Processing…" for the whole server round-trip.
    // Close it now and show the position as "Selling…"; a failure restores it + says why.
    var sellingPos = myPos; sellingPos.selling = true; closeSheet(); renderPosition();
    var ctrl = new AbortController(); var to = setTimeout(function () { try { ctrl.abort(); } catch (_) {} }, 12000);
    fetch(API + '/play/predict/cashout', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: posId, marketId: activeMarketId(), wallet: walletAddr() }),
      signal: ctrl.signal
    }).then(function (r) { clearTimeout(to); return r.json(); })
      .then(function (r) {
        if (!r || r.ok === false) throw new Error((r && (r.note || r.error)) || 'cashout_failed');
        patchOrder(order, { status: 'sold', cashedOut: true, cashoutOst: Number(r.payout) || 0, cashoutAt: Date.now(), cashoutKind: 'ostg-native-sell' });
        if (_balHold) _balHold.until = Date.now() + 4000;
        myPos = null; renderPosition();
        toast('Sold — ' + (Number(r.payout) || 0).toFixed(2) + ' OSTG back to your balance.');
        closeSheet();
        setTimeout(function () { refreshBalance(); refreshPosition(); loadTrades(); }, 600);
      })
      .catch(function (e) {
        clearTimeout(to); _balHold = null;   // release the optimistic bump — the sale didn't take
        sellingPos.selling = false; renderPosition();
        if (cfs) { cfs.disabled = false; cfs.textContent = 'Sell'; }
        var msg = String((e && e.message) || '');
        if (/round_closed/.test(msg)) toast('Round just closed — it settles automatically.');
        else toast('Could not sell — ' + (msg || 'try again') + '.');
        refreshBalance(); refreshPosition();
      });
  }
  function doSell() { openSheet('sell'); }

  // "Discuss in OST Mesh" = the composer with this market attached, exactly what the
  // header's "↗ Share" button (.osl-mshare, ost-social.js) does with its market embed.
  // Never the legacy pavilion (its feed was local-only).
  function discussInMesh() {
    try { if (currentMarket && window.OST_SOCIAL && typeof OST_SOCIAL.marketEmbed === 'function' && typeof OST_SOCIAL.compose === 'function') { OST_SOCIAL.compose({ embed: OST_SOCIAL.marketEmbed(currentMarket) }); return; } } catch (_) {}
    var share = document.querySelector('#opmDetail .osl-mshare');
    if (share) { share.click(); return; }
    try { if (window.OST_MESH_APP && typeof OST_MESH_APP.open === 'function') OST_MESH_APP.open(); } catch (_) {}
  }
  function wireDetail() {
    var back = el('opmBack'); if (back) back.onclick = showBrowse;
    document.querySelectorAll('#opmSeg button').forEach(function (b) { b.onclick = function () { document.querySelectorAll('#opmSeg button').forEach(function (x) { x.classList.remove('on'); }); b.classList.add('on'); var p = b.getAttribute('data-p'); document.querySelectorAll('#opmDetail .opm-pane').forEach(function (pn) { pn.classList.toggle('on', pn.getAttribute('data-pane') === p); }); if (p === 'comments') loadComments(); else if (p === 'holders') loadHolders(); else if (p === 'trades' && el('opmTrades') && el('opmTrades').querySelector('.opm-retry')) loadTrades(); }; });
    document.querySelectorAll('#opmYn button').forEach(function (b) { b.onclick = function () { side = b.getAttribute('data-s'); syncYnSel(); }; });
    document.querySelectorAll('#opmBuyY,#opmBuyN,#opmDetail [data-open]').forEach(function (b) { b.onclick = function () { openSheet('buy', b.getAttribute('data-open')); }; });
    var scr = el('opmScrim'); if (scr) scr.onclick = closeSheet;
    document.querySelectorAll('#opmTf button').forEach(function (b) { b.onclick = function () { document.querySelectorAll('#opmTf button').forEach(function (z) { z.classList.remove('on'); }); b.classList.add('on'); hrs = +b.getAttribute('data-h'); draw(); }; });
    var mesh = el('opmMesh'); if (mesh) mesh.onclick = discussInMesh;
    var cs = el('opmCmtSend'); if (cs) cs.onclick = postComment;
    var ci = el('opmCmtIn'); if (ci) ci.addEventListener('keydown', function (e) { if (e.key === 'Enter') postComment(); });
    syncYnSel();
  }

  function toast(msg) { try { if (typeof window.toast === 'function') { window.toast('info', msg); return; } } catch (_) {} console.log('[predict]', msg); }

  /* ================= PORTFOLIO (positions + history) =================
   * Polymarket-style portfolio: every open position marked to the LIVE price,
   * unrealized + realized P&L, claimable wins first, full history. The list is
   * the local ledger shown instantly, then reconciled with the wallet's remote
   * ledger (so a fresh device sees the same positions) and the resolution engine
   * (so finished markets show won/lost without waiting for the desk's 30s poll).
   * It re-renders on every ledger/balance/market event and re-marks every 15s. */
  var posFilter = 'all', _pfStatus = { syncing: false, syncedAt: 0, note: '' }, _pfTimer = 0;
  function orderState(o) {
    if (!o) return 'open';
    if (o.cashedOut) return 'paid';
    var st = String(o.status || o.outcome || '').toLowerCase();
    if (st === 'won') return 'claim';
    if (st === 'lost') return 'lost';
    if (st === 'sold' || st === 'settled' || st === 'refunded') return 'paid';
    if (String(o.source || '') === 'ost-parlay') return 'open';
    var close = Number(o.closeAt || o.closeAtMs || 0);
    if (o.fundedBy === 'ostg-native' && close > 0 && close <= Date.now()) return 'settle';
    return 'open';
  }
  function isBtcRoundId(id) { return /^ost-btc5m-\d+$/.test(String(id || '')); }
  // Live price for an open ticket's side, as a fraction. Same sources as the desk.
  function livePriceFor(o) {
    var side = o.side === 'no' ? 'no' : 'yes', mid = String(o.marketId || '');
    try { if (window.OST_PRICES && OST_PRICES.mid) { var v = Number(OST_PRICES.mid(mid, side)); if (v > 0 && v < 1) return v; } } catch (_) {}
    if (isBtcRoundId(mid)) {
      try { var r = window.OST_PREDICTION_API && OST_PREDICTION_API.fiveMinRound && OST_PREDICTION_API.fiveMinRound(); if (r && String(r.id || r.marketId || '') === mid && isFinite(Number(r.yesPriceNumber))) { var y = Number(r.yesPriceNumber); return side === 'yes' ? y : 1 - y; } } catch (_) {}
      return NaN;   // a past round: no live price (it settles, it doesn't trade)
    }
    var m = marketForOrderId(mid);
    if (m) {
      var yv = NaN;
      if (m.isGrouped && Array.isArray(m.outcomes)) { var oc = m.outcomes.filter(function (x) { return x && String(x.marketId || x.key || '') === mid; })[0]; if (oc) yv = Number(oc.price); }
      if (!(yv > 0 && yv < 1)) yv = Number(m.yesPriceNumber);
      if (yv > 1) yv /= 100;
      if (yv > 0 && yv < 1) return side === 'yes' ? yv : 1 - yv;
    }
    return NaN;
  }
  function parlaySlipOf(o) { try { var id = String(o.marketId || '').replace(/^ost-parlay:/, ''); return (window.OST_PARLAY && OST_PARLAY.slips() || []).filter(function (x) { return x.id === id; })[0] || null; } catch (_) { return null; } }
  function markTicket(o) {
    var st = orderState(o), stake = Number(o.stake) || 0, shares = Number(o.shares) || 0;
    var entry = Number(o.entry || o.price) || (shares > 0 ? stake / shares : 0);
    var t = { o: o, st: st, stake: stake, shares: shares, entry: entry, value: stake, pnl: 0, live: false, label: '', net: 0 };
    if (String(o.source || '') === 'ost-parlay') {
      var sl = parlaySlipOf(o);
      if (st === 'open') { t.value = sl ? (Number(OST_PARLAY.valueOf(sl)) || 0) : stake; t.net = sl ? (Number(OST_PARLAY.offerOf(sl)) || 0) : 0; t.live = !!sl; t.pnl = t.value - stake; t.label = 'parlay'; return t; }
    }
    if (st === 'paid') { t.value = Number(o.cashoutOst) || 0; t.pnl = t.value - stake; return t; }
    if (st === 'lost') { t.value = 0; t.pnl = -stake; return t; }
    if (st === 'claim') { t.value = Number(o.potentialReturn) || shares || stake; t.net = feeNet(t.value, stake); t.pnl = t.net - stake; return t; }
    if (st === 'settle') { t.value = shares || stake; t.net = t.value; t.pnl = 0; return t; }
    var lp = livePriceFor(o);
    if (lp > 0 && shares > 0) { t.value = shares * lp; t.live = true; } else t.value = stake;
    t.net = feeNet(t.value, stake); t.pnl = t.value - stake;
    return t;
  }
  function feeNet(gross, stake) { try { if (window.OST_HOUSE && OST_HOUSE.quote) return Number(OST_HOUSE.quote(gross, stake).net) || gross; } catch (_) {} return gross - Math.max(0, gross - stake) * 0.02; }
  function computePortfolio(marked) {
    var p = { open: 0, openValue: 0, openStake: 0, unrealized: 0, realized: 0, claim: 0, claimValue: 0, won: 0, lost: 0, paid: 0, staked: 0 };
    marked.forEach(function (t) {
      p.staked += t.stake;
      if (t.st === 'open' || t.st === 'settle') { p.open++; p.openValue += t.value; p.openStake += t.stake; p.unrealized += t.pnl; }
      else if (t.st === 'claim') { p.claim++; p.claimValue += t.net; p.won++; p.unrealized += t.pnl; }
      else if (t.st === 'paid') { p.paid++; p.realized += t.pnl; if (t.pnl > 0.005) p.won++; }
      else if (t.st === 'lost') { p.lost++; p.realized += t.pnl; }
    });
    return p;
  }
  function cashBtnFor(sig) { if (!sig) return null; try { return document.querySelector('.prediction-cashout-btn[data-order-sig="' + (window.CSS && CSS.escape ? CSS.escape(sig) : sig) + '"]'); } catch (_) { return null; } }
  function signed(v, dp) { v = Number(v) || 0; return (v > 0.005 ? '+' : v < -0.005 ? '−' : '') + Math.abs(v).toFixed(dp == null ? 2 : dp); }
  function ticketRow(t) {
    var o = t.o, st = t.st, side = o.side === 'no' ? 'no' : 'yes';
    var sig = o.signature || o.sig || o.id || '', isParlay = String(o.source || '') === 'ost-parlay';
    var actionHtml, badge = '';
    if (isParlay && st === 'open') {
      var slipId = String(o.marketId || '').replace(/^ost-parlay:/, '');
      actionHtml = t.net >= 0.05 ? '<button class="opm-tbtn" data-parlay-sell="' + esc(slipId) + '">Sell · ' + t.net.toFixed(2) + '</button>' : '<span class="opm-tbadge">⚡ live</span>';
    } else if (st === 'claim') {
      var cb = cashBtnFor(sig); var netTxt = cb ? ((cb.textContent.match(/([\d,]+\.?\d*)\s*$/) || [])[1] || t.net.toFixed(2)) : t.net.toFixed(2);
      actionHtml = '<button class="opm-tbtn claimw" data-sig="' + esc(sig) + '">Claim · ' + esc(netTxt) + '</button>';
    } else if (st === 'settle') {
      actionHtml = '<button class="opm-tbtn" data-sig="' + esc(sig) + '">Settle</button>';
    } else if (st === 'open') {
      var native = o.fundedBy === 'ostg-native', closed = Number(o.closeAt || o.closeAtMs || 0) > 0 && Number(o.closeAt || o.closeAtMs) <= Date.now();
      var cb2 = cashBtnFor(sig);
      if (native && !cb2) actionHtml = '<span class="opm-tbadge">Locked · settles at close</span>';
      else if (closed && !cb2) actionHtml = '<span class="opm-tbadge">Awaiting result</span>';
      else { var n2 = cb2 ? ((cb2.textContent.match(/([\d,]+\.?\d*)\s*$/) || [])[1] || t.net.toFixed(2)) : t.net.toFixed(2); actionHtml = '<button class="opm-tbtn" data-sig="' + esc(sig) + '">Sell · ' + esc(n2) + '</button>'; }
    } else if (st === 'paid') { actionHtml = '<span class="opm-tres" style="color:' + (t.pnl >= 0 ? 'var(--opm-yes)' : 'var(--opm-no)') + '">' + signed(t.pnl) + '</span>'; badge = (String(o.status || '').toLowerCase() === 'sold' || /sell|cashout/.test(String(o.cashoutKind || ''))) ? 'Sold' : (String(o.status || '').toLowerCase() === 'refunded' ? 'Refunded' : 'Won'); }
    else if (st === 'lost') { actionHtml = '<span class="opm-tres" style="color:var(--opm-no)">−' + t.stake.toFixed(2) + '</span>'; badge = 'Lost'; }
    else { actionHtml = '<span class="opm-tbadge">Open</span>'; }
    var title = o.title || o.marketTitle || o.marketId || 'Ticket';
    var when = o.cashoutAt || o.resolvedAt || o.ts || o.createdAt;
    var valTxt = (st === 'open' || st === 'settle') ? ('<b class="' + (t.pnl >= 0 ? 'up' : 'down') + '">' + t.value.toFixed(2) + '</b> <i>' + signed(t.pnl) + (t.stake > 0 ? ' (' + signed(t.pnl / t.stake * 100, 0) + '%)' : '') + (t.live ? '' : ' · at entry') + '</i>')
      : st === 'claim' ? ('<b class="up">won · ' + t.net.toFixed(2) + '</b>') : '';
    return '<div class="opm-trow st-' + st + '" data-mid="' + esc(o.marketId || '') + '">' +
      '<div class="opm-timg"></div>' +
      '<div class="opm-tmain"><div class="opm-ttitle">' + esc(title) + '</div>' +
        '<div class="opm-tmeta"><span class="opm-tside ' + (side === 'yes' ? 'y' : 'n') + '">' + esc(o.outcomeLabel && !isParlay ? o.outcomeLabel : (side === 'yes' ? 'Yes' : 'No')) + '</span> ' +
          t.stake.toFixed(2) + ' <small>OSTG</small>' + (t.entry > 0 && !isParlay ? ' @ ' + fmtc(t.entry * 100) + '¢' : '') + (t.shares > 0 && !isParlay ? ' · ' + t.shares.toFixed(1) + ' sh' : '') + ' · ' + ago(when) + (badge ? ' · <em>' + badge + '</em>' : '') + '</div>' +
        (valTxt ? '<div class="opm-tval">' + valTxt + '</div>' : '') + '</div>' +
      '<div class="opm-tact">' + actionHtml + '</div></div>';
  }
  function positionsTemplate() {
    return '<div class="opm-tb"><div class="opm-back" id="opmPosBack">' + icon('back') + '</div><div class="opm-cat">Your<b>Portfolio</b></div><div class="opm-sp"></div><button class="opm-tickets-btn" id="opmPfSync" title="Sync with the server">↻</button>' + balChip() + '</div>' +
      '<div class="opm-scroll">' +
        '<div class="opm-psum">' +
          '<div class="opm-ps"><div class="k">Positions value</div><div class="v" id="opmPfValue">—</div></div>' +
          '<div class="opm-ps"><div class="k">Unrealized P&amp;L</div><div class="v" id="opmPfPnl">—</div></div>' +
          '<div class="opm-ps"><div class="k">Realized P&amp;L</div><div class="v" id="opmPfReal">—</div></div>' +
          '<div class="opm-ps"><div class="k">Open · Won · Lost</div><div class="v" id="opmPfCounts">—</div></div>' +
        '</div>' +
        '<div class="opm-pfstatus" id="opmPfStatus"></div>' +
        '<div id="opmPfClaim"></div>' +
        '<div class="opm-chips" id="opmPosChips">' + [['all', 'All'], ['open', 'Open'], ['claim', 'Claimable'], ['paid', 'History'], ['lost', 'Lost']].map(function (c) { return '<button class="opm-chip' + (c[0] === 'all' ? ' on' : '') + '" data-f="' + c[0] + '">' + c[1] + '</button>'; }).join('') + '</div>' +
        '<div id="opmPosList"><div class="opm-empty">Loading your positions…</div></div>' +
      '</div>';
  }
  function renderPositions() {
    if (!el('opmPositions')) return;
    var orders = ledgerOrders().slice().sort(function (a, b) { return Number(b.ts || b.createdAt || 0) - Number(a.ts || a.createdAt || 0); });
    var marked = orders.map(markTicket);
    var pf = computePortfolio(marked);
    var set = function (id, txt, cls) { var e = el(id); if (e) { e.textContent = txt; if (cls != null) e.className = 'v ' + cls; } };
    set('opmPfValue', num2(pf.openValue + pf.claimValue));
    set('opmPfPnl', signed(pf.unrealized), pf.unrealized >= 0 ? 'up' : 'down');
    set('opmPfReal', signed(pf.realized), pf.realized >= 0 ? 'up' : 'down');
    set('opmPfCounts', pf.open + ' · ' + pf.won + ' · ' + pf.lost);
    var stEl = el('opmPfStatus');
    if (stEl) {
      var w = walletAddr();
      var txt = _pfStatus.syncing ? 'Syncing with the server…' : (_pfStatus.note ? _pfStatus.note : (w ? (_pfStatus.syncedAt ? 'Synced ' + ago(_pfStatus.syncedAt) + ' ago · ' + w.slice(0, 4) + '…' + w.slice(-4) : 'Local tickets · syncing…') : 'Local tickets · connect a wallet to sync across devices'));
      stEl.innerHTML = '<span class="d' + (_pfStatus.syncing ? ' busy' : '') + '"></span>' + esc(txt) + '<span class="sp"></span>' + (orders.length ? orders.length + ' tickets' : '');
    }
    var claimHost = el('opmPfClaim');
    if (claimHost) { var cl = marked.filter(function (t) { return t.st === 'claim'; }); claimHost.innerHTML = cl.length ? '<div class="opm-claimbar"><span>🎉 ' + cl.length + ' win' + (cl.length > 1 ? 's' : '') + ' to claim · ' + num2(pf.claimValue) + ' OSTG</span><button class="opm-tbtn claimw" id="opmClaimAll">Claim all</button></div>' : '';
      var ca = el('opmClaimAll'); if (ca) ca.onclick = function () { ca.disabled = true; ca.textContent = 'Claiming…'; claimAll(cl); }; }
    var list = el('opmPosList'); if (!list) return;
    var rows = marked.filter(function (t) { return posFilter === 'all' || t.st === posFilter || (posFilter === 'open' && t.st === 'settle') || (posFilter === 'paid' && t.st === 'lost'); });
    var order = { claim: 0, settle: 1, open: 2, paid: 3, lost: 3 };
    if (posFilter === 'all') rows.sort(function (a, b) { return (order[a.st] - order[b.st]) || (Number(b.o.ts || 0) - Number(a.o.ts || 0)); });
    if (!rows.length) {
      list.innerHTML = '<div class="opm-empty">' + (orders.length ? 'Nothing in this filter yet.' : (_pfStatus.syncing ? 'Loading your positions…' : 'No positions yet. Open a market and take a side — your tickets, wins and history show up here.')) + '</div>';
      return;
    }
    var html = '', lastGroup = '';
    rows.forEach(function (t) {
      var g = (t.st === 'claim' || t.st === 'settle') ? 'Ready to claim' : t.st === 'open' ? 'Open positions' : 'History';
      if (posFilter === 'all' && g !== lastGroup) { html += '<div class="opm-sec2">' + g + '</div>'; lastGroup = g; }
      html += ticketRow(t);
    });
    list.innerHTML = html;
    try { if (window.OST_MARKET_ART) OST_MARKET_ART.apply(); } catch (_) {}
    list.querySelectorAll('.opm-tbtn[data-parlay-sell]').forEach(function (b) {
      b.onclick = function (e) { e.stopPropagation(); b.disabled = true; b.textContent = '…'; try { OST_PARLAY.sell(b.getAttribute('data-parlay-sell')); } catch (_) {} setTimeout(function () { refreshBalance(); renderPositions(); }, 300); };
    });
    list.querySelectorAll('.opm-tbtn[data-sig]').forEach(function (b) {
      b.onclick = function (e) { e.stopPropagation(); cashOutTicket(b.getAttribute('data-sig'), b); };
    });
    list.querySelectorAll('.opm-trow').forEach(function (r) {
      r.onclick = function () { var m = marketForOrderId(r.getAttribute('data-mid')); if (m) openMarket(m); else toast('That market is no longer in the live list.'); };
    });
  }
  function num2(v) { return (Number(v) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function cashOutTicket(sig, b) {
    var api = window.OST_PREDICTION_API;
    if (b) { b.disabled = true; b.textContent = '…'; }
    if (api && typeof api.cashOut === 'function' && sig) {
      return api.cashOut(sig).then(function (r) { if (r && r.ok !== false) toast(((r.kind === 'prediction-settlement' || /resolve|claim/.test(String(r.kind || ''))) ? 'Claimed ' : 'Sold for ') + (Number(r.payout) || 0).toFixed(2) + ' OSTG.'); else if (r && r.label) toast(r.label); })
        .catch(function (err) { toast('Could not cash out — ' + ((err && err.message) || 'try again') + '.'); })
        .then(function () { refreshBalance(); renderPositions(); });
    }
    var real = cashBtnFor(sig); if (!real) { if (b) b.disabled = false; toast('Settling — try again shortly.'); return Promise.resolve(); }
    try { real.click(); } catch (_) {} setTimeout(function () { refreshBalance(); renderPositions(); }, 1500);
    return Promise.resolve();
  }
  function claimAll(list) {
    var chain = Promise.resolve();
    list.forEach(function (t) { var sig = t.o.signature || t.o.sig || t.o.id; if (sig) chain = chain.then(function () { return cashOutTicket(sig, null); }); });
    chain.then(function () { refreshBalance(); renderPositions(); });
  }
  // Reconcile with the server: the wallet's remote ledger + fresh resolutions.
  function syncPortfolio(force) {
    var api = window.OST_PREDICTION_API || {};
    if (_pfStatus.syncing) return;
    if (!force && _pfStatus.syncedAt && Date.now() - _pfStatus.syncedAt < 20000) { renderPositions(); return; }
    _pfStatus.syncing = true; _pfStatus.note = ''; renderPositions();
    var jobs = [];
    if (walletAddr() && typeof api.syncOrders === 'function') jobs.push(Promise.resolve(api.syncOrders()).catch(function () { return false; }));
    if (typeof api.refreshResolutions === 'function') jobs.push(Promise.resolve(api.refreshResolutions()).catch(function () { return false; }));
    try { if (window.OST_PARLAY && OST_PARLAY.settleScan) OST_PARLAY.settleScan(); } catch (_) {}
    var to = new Promise(function (res) { setTimeout(res, 12000); });
    Promise.race([Promise.all(jobs), to]).then(function () {
      _pfStatus.syncing = false; _pfStatus.syncedAt = Date.now();
      renderPositions(); refreshBalance();
    });
  }
  function wirePositions() {
    var back = el('opmPosBack'); if (back) back.onclick = showBrowse;
    var sy = el('opmPfSync'); if (sy) sy.onclick = function () { syncPortfolio(true); };
    var chips = el('opmPosChips'); if (chips) chips.onclick = function (e) { var b = e.target.closest('.opm-chip'); if (!b) return; posFilter = b.getAttribute('data-f'); chips.querySelectorAll('.opm-chip').forEach(function (x) { x.classList.toggle('on', x === b); }); renderPositions(); };
  }
  function openPositions() {
    try { if (window.setWalletPanel) window.setWalletPanel('predict', { scroll: true }); } catch (_) {}
    stopFlow(); mount(); showView('positions'); wirePositions(); renderPositions(); syncPortfolio(false);
    try { var host = el('ostPredictMobile'); if (host) host.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (_) {}
  }
  var _pfRender = 0;
  function schedulePositions() { if (view !== 'positions') return; clearTimeout(_pfRender); _pfRender = setTimeout(renderPositions, 250); }
  ['ost:prediction-orders-synced', 'ost:prediction-resolutions-refreshed', 'ost:prediction-markets', 'ost:parlay-won', 'ost:btc-round'].forEach(function (n) { window.addEventListener(n, schedulePositions); });
  setInterval(function () { if (view === 'positions' && !document.hidden) renderPositions(); }, 15000);   // live re-mark

  /* ===================================================================== */
  /* VIEW SWITCHING + MOUNT                                                 */
  /* ===================================================================== */
  // The pinned Buy bar belongs to the market: show it only while the market is on screen.
  var _detailIO = null;
  function watchDetailInView() { try { var d = el('opmDetail'); if (!d || _detailIO || !('IntersectionObserver' in window)) { if (d && !('IntersectionObserver' in window)) d.classList.add('opm-inview'); return; } _detailIO = new IntersectionObserver(function (es) { es.forEach(function (e) { d.classList.toggle('opm-inview', e.isIntersecting); }); }, { threshold: 0.05 }); _detailIO.observe(d); } catch (_) {} }
  function showView(v) { view = v; watchDetailInView(); try { var ab = document.getElementById('ostAppBar'); document.documentElement.style.setProperty('--opm-appbar-h', ((ab && ab.offsetHeight) || 0) + 'px'); } catch (_) {} var b = el('opmBrowse'), d = el('opmDetail'), p = el('opmPositions'); if (b) b.classList.toggle('on', v === 'browse'); if (d) d.classList.toggle('on', v === 'detail'); if (p) p.classList.toggle('on', v === 'positions'); }
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
  // ONE FEED PER ROUND. 'ost:btc-spot' carries BOTH the server's settlement feed
  // (Coinbase - the price the round is actually decided on) and the browser's own
  // Pyth/exchange feed, which sits tens of dollars away. Mixing them drew a sawtooth
  // and could show "winning" against a beat line the settlement price was losing to.
  // The round view follows the SETTLEMENT feed; the browser feed is used only if the
  // server has been silent for 20s, and the hero says so.
  var _srvTickAt = 0;
  function isServerTick(d) { return !!(d && (d.livePriceSource || d.marketId || d.priceToBeat || d.closeAt)); }
  function setFeedNote(txt) { var n = el('opmFeedNote'); if (n && n.__t !== txt) { n.__t = txt; n.textContent = txt; } }
  function acceptTick(p, fromServer) {
    if (!(p > 0)) return;
    if (fromServer) { _srvTickAt = Date.now(); setFeedNote(''); pushTick(p); return; }
    if (Date.now() - _srvTickAt < 20000) return;   // settlement feed is live: ignore the other feed
    setFeedNote('settlement feed quiet - showing backup price'); pushTick(p);
  }
  window.addEventListener('ost:btc-spot', function (e) { if (view !== 'detail' || !isBtcLive(currentMarket)) return; var d = e && e.detail; acceptTick(d && Number(d.price), isServerTick(d)); });
  window.addEventListener('ost:btc-market-updated', function (e) { if (view !== 'detail' || !isBtcLive(currentMarket)) return; try { var m = e.detail && e.detail.tick; if (m) acceptTick(Number(m.price), false); } catch (_) {} });
  window.addEventListener('ost:prediction-markets', function () { if (view === 'browse') renderBrowse(); });
  window.addEventListener('ost:prediction-order-recorded', function () { if (view === 'detail') setTimeout(refreshPosition, 400); if (view === 'positions') setTimeout(renderPositions, 400); });
  // Background confirm / fail / sell of a ticket (wallet rail settles after the tap).
  window.addEventListener('ost:prediction:order-changed', function () { if (view === 'detail') refreshPosition(); if (view === 'positions') renderPositions(); });
  window.addEventListener('ost:prediction-resolutions-refreshed', function () { if (view === 'positions') renderPositions(); });
  window.addEventListener('ost:money:change', function () { refreshBalance(); if (view === 'positions') renderPositions(); });
  window.addEventListener('ost:play:balance', paintBalance);
  // THE missing link: OST_BALANCE fires this when its async /balance/truth read
  // (and on-chain OSTG) lands. Without it the chip stayed frozen on the pre-bet
  // number, and a win/loss only "sometimes" showed. Repaint (read-only) here so
  // the balance reacts every time — and also refresh a visible position card.
  window.addEventListener('ost:balance', function () { paintBalance(); if (view === 'detail') renderPosition(); if (view === 'positions') renderPositions(); });
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
  // redraw: repaint the open market's chart now (ost-markets-desk.js resizes the
  // canvas buffers for the desktop layout, which clears them).
  function redraw() { try { if (view !== 'detail' || !currentMarket) return; if (isBtcLive(currentMarket)) draw(); else drawStd(); } catch (_) {} }
  window.OST_PREDICT_MOBILE = { mount: mount, showBrowse: showBrowse, openMarket: openMarket, openFlagship: openFlagship, openPositions: openPositions, redraw: redraw, current: function () { return view === 'detail' ? currentMarket : null; } };

  function boot() {
    if (!mount()) { var n = 0; var iv = setInterval(function () { if (mount() || ++n > 40) clearInterval(iv); }, 500); }
    // detail tickers
    setInterval(function () { if (view !== 'detail') return; if (isBtcLive(currentMarket)) { var cd = el('opmCd'); if (cd && round) { var left = Math.max(0, Math.floor((Number(round.closeAt) - Date.now()) / 1000)); cd.textContent = Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0'); if (left <= 0) loadRound(); } } }, 1000);
    // All polling pauses when the tab is hidden (was hammering the network even
    // in the background — a big part of the request storm).
    setInterval(function () { if (view === 'detail' && isBtcLive(currentMarket) && !document.hidden && Date.now() - lastPushRoundAt > 20000) loadRound(); }, 6000);   // push-first: poll only when the socket is stale
    setInterval(function () { if (view === 'detail' && !document.hidden) { if (Date.now() - _lastFillPushAt > 60000) loadTrades(); refreshPosition(); if (!isBtcLive(currentMarket)) paintStandard(); } }, 30000);   // push-first   // was 13s
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

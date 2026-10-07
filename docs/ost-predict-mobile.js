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
 * MONEY RAILS (money plan PRD-1..7 — every sheet names the real rail + unit):
 *   · BTC 5-min -> the OST server ledger (play balance, OSTG). A wallet with
 *             only OST converts 1:1 to OSTG and deposits first (ensurePlayFunds),
 *             then OST_PREDICTION_API.placeBet opens it. The SERVER settles from
 *             the BTC close price and credits the play balance — never a client
 *             claim from the OST pool.
 *   · every other market -> OST_PREDICTION_API.placeOrder: wallet OST moved
 *             on-chain to the OST pool, filled at the exact quote shown.
 *   · SELL / CLAIM -> OST_PREDICTION_API.cashOut (app.js), the one payout
 *             routine (C4 outcomes: paid / "Paying…" / refused). No credits.
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
  // WAL-8: the ONE wallet gate (contract C1). With no wallet, Buy opens the
  // wallet home start view and resumes the action once a wallet exists.
  function requireWallet(reason, resume) {
    try {
      var W = window.OST_WALLET;
      if (W && typeof W.requireWallet === 'function') { W.requireWallet({ reason: reason || 'buy', resume: resume }); return; }
      if (window.OST_WALLET_HOME && typeof window.OST_WALLET_HOME.open === 'function') { window.OST_WALLET_HOME.open('start'); return; }
    } catch (_) {}
    notify('info', 'Create a free wallet to trade', 'Open the Wallet tab to create or connect one.');
  }
  // UX-1: every buy / sell / claim result is visible (contract C2). Falls back
  // to the back-compatible window.toast, then OST_OPTIMISTIC.
  function notify(kind, title, body, opts) {
    var o = Object.assign({ kind: kind, title: title, body: body || '' }, opts || {});
    try { if (typeof window.OST_NOTIFY === 'function') { window.OST_NOTIFY(o); return; } } catch (_) {}
    var msg = title + (body ? ' — ' + body : '');
    try { if (typeof window.toast === 'function') { window.toast(kind === 'error' ? '⚠️' : kind === 'ok' ? '✅' : 'ℹ️', msg); return; } } catch (_) {}
    try { if (window.OST_OPTIMISTIC && OST_OPTIMISTIC.toast) { OST_OPTIMISTIC.toast(msg, kind === 'ok' ? 'success' : kind); return; } } catch (_) {}
    try { console.log('[predict]', msg); } catch (_) {}
  }
  // Plain-English error copy (contract C3) when the module is present.
  function human(err, stage, asset) {
    try { if (window.OST_MONEY_ERRORS && typeof OST_MONEY_ERRORS.humanize === 'function') { var h = OST_MONEY_ERRORS.humanize(err, { stage: stage || 'build', asset: asset || 'OST' }); if (h && h.title) return h; } } catch (_) {}
    var m = String((err && err.message) || err || '');
    if (!m || /^[a-z_]+$/.test(m) || /[{}\[\]]/.test(m)) m = 'That did not go through. Nothing was taken — try again in a moment.';
    return { state: 'failed', title: m, body: '' };
  }
  // Our own messages are already plain English; use them as-is.
  function errText(err, stage, asset) {
    var own = String((err && err.message) || '');
    if (err && /^(no_wallet|insufficient_ostg|insufficient_funds_for_ticket|balance_unknown|price_moved|state_unknown|stake_confirming|play_loading|rail_loading|convert_failed|deposit_failed|open_failed|open_failed_after_deposit|timeout|network_error|cashout_failed|round_closed|price_unavailable|predictions_not_live|round_open_price_unknown|insufficient_bucket|insufficient_play_balance|wallet_cannot_sign)$/.test(String(err.code || '')) && own && !/[{}\[\]]/.test(own)) return own;
    var h = human(err, stage, asset); return h.title + (h.body ? ' — ' + h.body : '');
  }
  // Contract C6 balances: { ost, ostg, play, sess } — each a number or undefined
  // (unknown renders "—", never 0). ost = wallet OST (OSTC), ostg = wallet OSTG,
  // play = the server play balance (OSTG), sess = 1-tap session OSTG.
  function balances() {
    var b = { ost: undefined, ostg: undefined, play: undefined, sess: undefined };
    try {
      var B = window.OST_BALANCE;
      if (B && typeof B.get === 'function') { var g = B.get() || {}; if (g.ost != null) b.ost = Number(g.ost); if (g.ostg != null) b.ostg = Number(g.ostg); if (g.play != null) b.play = Number(g.play); }
      if (B) {
        if (b.ost === undefined && B.onchainOstc) { var c = B.onchainOstc(); if (c != null) b.ost = Number(c); }
        if (b.ostg === undefined && B.onchainOstg) { var gg = B.onchainOstg(); if (gg != null) b.ostg = Number(gg); }
        if (b.play === undefined && B.play) { var pl = B.play(); if (pl != null) b.play = Number(pl); }
      }
    } catch (_) {}
    try { if (b.ostg === undefined && window.OST_SESSION && OST_SESSION.walletBalance) { var w = OST_SESSION.walletBalance(); if (w != null) b.ostg = Number(w); } } catch (_) {}
    try { if (b.play === undefined && window.OST_PLAY && OST_PLAY.balance) { var p = OST_PLAY.balance(); if (p != null) b.play = Number(p); } } catch (_) {}
    try { if (window.OST_SESSION && OST_SESSION.balance) { var sv = OST_SESSION.balance(); if (sv != null) b.sess = Number(sv); } } catch (_) {}
    return b;
  }
  // The rail a market's buy actually uses (PRD-3), and its unit.
  //   play    — BTC 5-min: the OST server ledger, OSTG play balance
  //   onchain — BTC 5-min when an on-chain round market exists: wallet OSTG
  //   wallet  — every other market: wallet OST moved on-chain to the OST pool
  function railOf(m) { return isBtcLive(m) ? (onchainActive ? 'onchain' : 'play') : 'wallet'; }
  function unitOfRail(r) { return r === 'wallet' ? 'OST' : 'OSTG'; }
  function fmtAmt(v) { return v == null || !isFinite(v) ? '—' : Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 }); }
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
    var b = balances();
    if (b.ostg === undefined && b.play === undefined && b.sess === undefined) return undefined;
    return (Number(b.ostg) || 0) + (Number(b.play) || 0) + (Number(b.sess) || 0);
  }
  // What a buy on this market can spend, in its unit (PRD-2: the sheet shows the
  // real balance it spends). BTC: play + wallet OSTG + wallet OST (converted 1:1).
  function spendableFor(m) {
    var b = balances(), r = railOf(m);
    if (r === 'wallet') return b.ost;
    if (r === 'onchain') return b.ostg;
    if (b.play === undefined && b.ostg === undefined && b.ost === undefined) return undefined;
    return (Number(b.play) || 0) + (Number(b.ostg) || 0) + (Number(b.ost) || 0);
  }
  // Optimistic hold: after a bet/sell we show the expected balance and refuse to
  // let a slow reconcile-read bounce it the WRONG way before the server confirms
  // — that bounce is what made buying feel non-optimistic.
  var _balHold = null;   // { v, dir:'down'|'up', until }
  // (The old sell-price "lock" is gone — PRD-5: the price was never locked, the
  // server / cash-out re-prices. The sell sheet shows a live estimate and only
  // patches its text, so the Sell button under the user's finger never moves.)
  function setBalDisplay(v) {
    if (v != null && _balHold && Date.now() < _balHold.until) {
      var nv = Number(v);
      if (_balHold.dir === 'down' && nv > _balHold.v + 0.001) v = _balHold.v;
      else if (_balHold.dir === 'up' && nv < _balHold.v - 0.001) v = _balHold.v;
      else _balHold = null;   // the real balance crossed the optimistic point -> release
    }
    document.querySelectorAll('#ostPredictMobile .opm-balv').forEach(function (e) { e.textContent = (v == null ? '—' : Number(Math.max(0, v)).toLocaleString(undefined, { maximumFractionDigits: 2 })); });
    // PRD-2: the faucet pays OST, so the header shows OST next to OSTG.
    var bo = walletAddr() ? balances().ost : undefined;
    document.querySelectorAll('#ostPredictMobile .opm-balost').forEach(function (e) { e.textContent = fmtAmt(bo); });
  }
  // READ-ONLY repaint of the balance chip from whatever the canonical source
  // currently holds. Safe to call from an event handler — it never triggers a
  // refresh, so it can't loop with the ost:balance event.
  function paintBalance() {
    // No wallet = no balance to show ("—"), never a made-up 0.
    var b = walletAddr() ? playBal() : undefined;
    setBalDisplay(b);
    var f = ''; try { if (window.OST_CCY && OST_CCY.fiat && b != null) f = OST_CCY.fiat(b) || ''; } catch (_) {}
    document.querySelectorAll('#ostPredictMobile .opm-balf').forEach(function (e) { e.textContent = f; });
  }
  // Repaint the fiat hint when the user changes currency (it used to keep whatever currency
  // was active when the balance last changed - e.g. INR from a moment in onboarding).
  try { window.addEventListener('ost:currencychange', function () { setTimeout(paintBalance, 0); }); } catch (_) {}
  // force=true after a money action (buy / sell / claim / deposit): read fresh
  // now. Otherwise (view changes, the idle timer) at most one network refresh
  // per 20 s and a non-forced OST_BALANCE read (NET-3 — opening the page used to
  // fire five forced balance reads in a row).
  var _balNetAt = 0;
  function refreshBalance(force) {
    // These are ASYNC: they kick off a fetch and fire `ost:balance` /
    // `ost:play:balance` when the fresh number lands. paintBalance() here shows
    // the current value immediately; the event listeners below repaint again the
    // moment the refresh completes — THAT is what makes the chip actually move
    // after a bet/sell instead of showing a stale number forever.
    var now = Date.now();
    if (force === true || now - _balNetAt > 20000) {
      _balNetAt = now;
      try { if (window.OST_BALANCE && OST_BALANCE.refresh) OST_BALANCE.refresh(force === true); } catch (_) {}   // canonical /balance/truth
      // C6 / NET-3: OST_BALANCE already carries the play balance; the play
      // mirror and the 1-tap session are re-read only after a money action.
      try { if (force === true && onchainActive && window.OST_SESSION && OST_SESSION.exists && OST_SESSION.exists() && OST_SESSION.refresh) OST_SESSION.refresh(); } catch (_) {}
      try { if (force === true && window.OST_PLAY && OST_PLAY.refresh) OST_PLAY.refresh(); } catch (_) {}
    }
    paintBalance();
  }
  // PRD-2: the faucet pays OST and the BTC rail spends OSTG — the chip shows
  // both (unknown renders "—", never 0).
  function balChip() { return '<div class="opm-bal" title="OST = wallet OST (faucet, sends, venue + ETH/SOL markets). OSTG = game token (wallet + play balance, BTC 5-min). 1 OST converts to 1 OSTG. Devnet — no cash value."><span class="k">OST · OSTG</span><span class="v"><b class="opm-balost">—</b><i>·</i><b class="opm-balv">—</b></span><span class="f opm-balf"></span></div>'; }

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
  // ETH/SOL 5-min rounds: the catalog list can hold a round that has already
  // closed (it refreshes every few minutes). Always trade the CURRENT round, and
  // price it from OST_PRICES — the same live source the order fills at (PRD-4).
  function isFastRound(m) { return !!(m && /^ost-(eth|sol)5m-\d+$/.test(String(m.id || ''))); }
  function currentFastRound(m) {
    if (!isFastRound(m)) return m;
    try {
      var prefix = String(m.id).replace(/\d+$/, '');
      var natives = (typeof window.buildOstNativeMarkets === 'function' && window.buildOstNativeMarkets()) || [];
      for (var i = 0; i < natives.length; i++) if (natives[i] && String(natives[i].id).indexOf(prefix) === 0) return natives[i];
    } catch (_) {}
    return m;
  }
  function preciseCents(m) {
    var v = Number(m && m.yesPriceNumber);
    if (!isFinite(v) || v <= 0) return yesCents(m);
    if (v <= 1) v *= 100;
    return Math.max(0.1, Math.min(99.9, Math.round(v * 10) / 10));
  }
  function fastMidCents(m) {
    try { var g = window.OST_PRICES && OST_PRICES.get && OST_PRICES.get(m.id); if (g && g.yes > 0 && g.yes < 1) return Math.round(g.yes * 1000) / 10; } catch (_) {}
    return NaN;
  }
  function openMarket(m) {
    m = currentFastRound(m);
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
    // Honest label: the BTC round is priced by the OST server (the on-chain
    // pari-mutuel vault is offline until the crank runs — D4); loadOnchain()
    // relabels it when a live on-chain round really exists.
    var btc = currentMarket && isBtcLive(currentMarket);
    return '<div class="opm-pool"><div class="h"><span>Market odds</span><span class="rt">' + icon('scale') + ' ' + (btc ? 'OST server odds · on-chain pool offline' : 'live odds') + '</span></div>' +
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
      if (!cfs) return;   // "not sellable" sheet: nothing live to patch
      if (/Processing|Selling/.test(cfs.textContent)) return;
      // Live ESTIMATE (PRD-5: nothing is "locked" — the cash-out re-checks the
      // price and asks again if it moved > 5%). Patches text only, so the Sell
      // button under the user's finger is never replaced.
      var q = sellQuote(), u = q.unit;
      var px = el('opmSellPx'); if (px) px.textContent = fmtc(q.c) + '¢';
      var fe = el('opmSellFee'); if (fe) fe.textContent = q.fee.toFixed(2);
      var pl = el('opmSellPnl'); if (pl) { pl.textContent = (q.up ? '+' : '−') + Math.abs(q.pnl).toFixed(2) + ' ' + u; pl.style.color = 'var(--opm-' + (q.up ? 'yes' : 'no') + ')'; }
      var nt = el('opmSellNet'); if (nt) nt.textContent = '≈' + q.realNet + ' ' + u;
      cfs.textContent = 'Sell for ≈' + q.realNet + ' ' + u;
      return;
    }
    var inp = el('opmAmtIn'); var a = inp ? (parseFloat(inp.value) || 0) : amt;
    var ty = t.querySelector('.opm-tkout .y .px'); if (ty) ty.textContent = fmtc(midYes) + '¢';
    var tn = t.querySelector('.opm-tkout .n .px'); if (tn) tn.textContent = fmtc(100 - midYes) + '¢';
    var bd = el('opmBuyBd'); if (bd) bd.innerHTML = buyBdHtml(buyEstimate(a));   // patch the breakdown; the confirm button below is untouched
    // The funding plan (what this buy spends, PRD-2) follows the amount + balance.
    var plan = fundingPlan(a), r = railOf(currentMarket), u2 = plan.unit || unitOfRail(r);
    var pe = el('opmPlan'); if (pe) pe.textContent = (plan.needWallet || plan.short || plan.empty) ? '' : plan.text;
    var cur = el('opmAmtCur'); if (cur) cur.textContent = u2;
    var key = planKey();
    var ctaBox = el('opmCta');
    if (ctaBox && t.__planKey !== key) { t.__planKey = key; ctaBox.innerHTML = ctaHtml(plan, r, u2); wireCta(); return; }   // CTA shape changed: swap only the CTA box
    var cf = el('opmCf'); if (cf && !/Bought|Placing/.test(cf.textContent)) cf.textContent = 'Buy ' + (side === 'yes' ? 'Yes' : 'No') + ' · ' + fmtAmt(a) + ' ' + u2;
  }

  function paintOdds() {
    tween(el('opmYnY'), midYes, cents); tween(el('opmYnN'), 100 - midYes, cents);
    var yMul = midYes > 0 ? (100 / midYes) : 0, nMul = (100 - midYes) > 0 ? (100 / (100 - midYes)) : 0;
    var yx = el('opmYnYx'); if (yx) yx.textContent = yMul ? yMul.toFixed(2) + '× payout' : '';
    var nx = el('opmYnNx'); if (nx) nx.textContent = nMul ? nMul.toFixed(2) + '× payout' : '';
    // Whole percent (PRD-7: an unrounded 0.1¢ mid printed "99.94%"-style values).
    var yp = Math.max(0, Math.min(100, Math.round((poolY + poolN > 0) ? (poolY / (poolY + poolN) * 100) : midYes)));
    var py = el('opmPoolY'), pn = el('opmPoolN'); if (py) { py.style.width = yp + '%'; py.textContent = yp + '%'; } if (pn) pn.textContent = (100 - yp) + '%';
    var ya = el('opmPoolYA'), na = el('opmPoolNA'), tot = el('opmPoolTot');
    var pu = unitOfRail(railOf(currentMarket));
    if (poolY + poolN > 0) { if (ya) ya.textContent = 'Yes ' + num0(poolY) + ' ' + pu; if (na) na.textContent = 'No ' + num0(poolN) + ' ' + pu; if (tot) tot.textContent = num0(poolY + poolN) + ' ' + pu + ' total'; }
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
    if (isFastRound(currentMarket)) {
      // Roll to the current round (the old one closed) and price it from the
      // SAME source the fill uses, at 0.1¢ precision (PRD-4).
      var cur = currentFastRound(currentMarket);
      if (cur && cur.id !== currentMarket.id) { currentMarket = cur; try { el('opmDetail').setAttribute('data-mid', String(cur.id)); } catch (_) {} myPos = null; refreshPosition(); }
      var fc = fastMidCents(currentMarket);
      midYes = fc > 0 ? fc : yesCents(currentMarket);
      paintOdds(); drawStd();
      return;
    }
    // 0.1¢ precision: the same number OST_PRICES gives the sell quote, so a buy
    // and an immediate sell differ only by the spread (PRD-4).
    midYes = preciseCents(currentMarket);
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
  // NET-3: a public fill for ANOTHER market never reloads this market's tape,
  // and this market's tape reloads at most once per 5 s however many fills
  // arrive (it used to GET /positions/recent on every public event).
  var _lastFillPushAt = 0, _fillT = null, _fillRunAt = 0;
  window.addEventListener('ost:prediction-update', function (e) {
    var ev = e && e.detail; if (!ev || !/^prediction\.(fill|resolved)$/.test(String(ev.type))) return;
    _lastFillPushAt = Date.now();   // the socket is delivering
    if (view !== 'detail') return;
    var p = ev.payload || {};
    var evMid = String(p.marketId || ev.marketId || '');
    var fid = String(feedTradeId() || '');
    var mine = false;
    try { var w = walletAddr(); mine = !!(w && String(ev.wallet || p.wallet || '') === w); } catch (_) {}
    if (!mine && (!evMid || !fid || evMid !== fid)) return;
    if (_fillT) return;   // one refresh is already scheduled
    var wait = Math.max(1500, 5000 - (Date.now() - _fillRunAt));
    _fillT = setTimeout(function () { _fillT = null; _fillRunAt = Date.now(); loadTrades(); refreshPosition(); }, wait);
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
        if (rt) rt.innerHTML = icon('scale') + ' on-chain vault · pari-mutuel';
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
      // PRD-3: the market's real unit (OST on the wallet rail, OSTG on BTC 5-min).
      var amt = r.venue ? (compact(r.size) + ' sh') : (r.stake > 0 ? compact(r.stake) + ' ' + unitOfRail(railOf(currentMarket)) : (r.size > 0 ? compact(r.size) + ' sh' : ''));
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
  var _sellingRef = '';   // the ticket a sell is in flight for (survives re-renders)
  function orderKey(o) { return String((o && (o.signature || o.sig || o.reference || o.id)) || ''); }
  // C6: every ticket carries its unit + rail (older tickets: derived from fundedBy).
  // The ONE classifier (app.js predictionTicketTrust): a p_… server position is
  // the play rail even when an older client stored it without fundedBy (PRD-1).
  function trustOf(o) {
    try { var api = window.OST_PREDICTION_API; if (api && typeof api.ticketTrust === 'function') { var t = api.ticketTrust(o); if (t) return t; } } catch (_) {}
    var f = String((o && o.fundedBy) || ''), sig = String((o && (o.signature || o.sig)) || '');
    var native = /^p_\d+_/.test(String((o && (o.serverPositionId || o.signature || o.sig || o.id)) || '').replace(/^desk-/, '')) || f === 'ostg-native';
    var rail = (native || f === 'ostg' || (o && o.rail === 'play')) ? 'play' : (f === 'onchain' || (o && (o.onChain || o.rail === 'onchain'))) ? 'onchain' : (f === 'credits' || /^credits-/.test(sig)) ? 'credits' : 'wallet';
    var pend = !!(o && (o.fundingState === 'submitting' || o.fundingState === 'confirming' || o.pending));
    return { rail: rail, unit: (rail === 'play' || rail === 'onchain') ? 'OSTG' : 'OST', native: native, fake: rail === 'wallet' && !/^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(sig) && !pend, fakePaid: false, unverifiable: false };
  }
  function orderUnit(o) { if (!o) return 'OST'; return trustOf(o).unit; }
  function orderRail(o) { if (!o) return 'wallet'; return trustOf(o).rail; }
  function refreshPosition() {
    var mid = activeMarketId(); var orders = ledgerOrders();
    var open = orders.filter(function (o) {
      if (!o || o.cashedOut) return false; var st = String(o.status || o.outcome || '').toLowerCase(); if (st === 'won' || st === 'lost' || st === 'settled' || st === 'sold' || st === 'refunded' || st === 'failed') return false;
      if (orderRail(o) === 'credits') return false;   // D1: retired legacy credits tickets are history, never a live position
      var omid = String(o.marketId || '');
      if (isBtcLive(currentMarket)) return mid ? omid === mid : /^ost-btc5m-\d+$/.test(omid);
      return marketOwnsOrder(currentMarket, omid);
    });
    if (!open.length) { if (!(myPos && myPos.placing)) myPos = null; renderPosition(); return; }
    var o = open.sort(function (a, b) { return Number(b.ts || 0) - Number(a.ts || 0); })[0];
    var sig = o.signature || o.sig || o.id || '';
    var isNative = trustOf(o).native;
    var prev = myPos;
    myPos = {
      order: o, sig: sig, ref: orderKey(o), native: isNative, posId: o.serverPositionId || o.id || sig,
      side: (o.side === 'no' ? 'no' : 'yes'), shares: Number(o.shares) || 0, stake: Number(o.stake) || 0,
      // The RECORDED fill (effective price paid = stake / shares), not a re-quote.
      entry: Number(o.fillPrice) || Number(o.entry) || Number(o.price) || 0,
      unit: orderUnit(o), rail: orderRail(o),
      pending: o.fundingState === 'confirming' || o.fundingState === 'submitting' || !!o.pending,
      paying: !!o.cashoutPending,
      selling: !!(_sellingRef && (_sellingRef === orderKey(o) || _sellingRef === sig)),
      justFilled: prev && prev.justFilled
    };
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
  // The cash-out quote for the open position. Wallet tickets: the EXACT number
  // the cash-out pays (OST_PREDICTION_API.quoteCashOut — PRD-4). BTC server
  // ledger: an estimate from this page's live odds (the server fills at ITS odds).
  function posQuote() {
    if (!myPos) return null;
    if (!myPos.native && !myPos.placing) {
      try { var api = window.OST_PREDICTION_API; if (api && api.quoteCashOut && myPos.ref) { var q = api.quoteCashOut(myPos.ref); if (q) return q; } } catch (_) {}
    }
    var c = myPos.side === 'yes' ? midYes : (100 - midYes);
    var gross = Math.min(myPos.shares, myPos.shares * (c / 100));
    var fee = Math.max(0, gross - posCost()) * 0.02;
    return { kind: myPos.native ? 'ostg-native-sell' : 'prediction-sell', canCash: gross > 0, gross: gross, net: Math.max(0, gross - fee), fee: fee, mid: c / 100, unit: myPos.unit, rail: myPos.rail, estimate: true };
  }
  function posValueNow() { var q = posQuote(); return q ? (Number(q.net) || 0) : 0; }
  function posCost() { return myPos ? (Number(myPos.stake) || myPos.shares * (myPos.entry || 0)) : 0; }
  function renderPosition() {
    var wrap = el('opmPosWrap'); if (!wrap) return; if (!myPos) { wrap.innerHTML = ''; return; }
    var u = myPos.unit || unitOfRail(railOf(currentMarket));
    var q = posQuote() || {};
    var val = Number(q.net) || 0, cost = posCost(), pnl = val - cost, up = pnl >= 0;
    var pnlTxt = (up ? '+' : '−') + Math.abs(pnl).toFixed(2) + ' ' + u + (cost > 0 ? ' (' + (up ? '+' : '−') + Math.abs(pnl / cost * 100).toFixed(0) + '%)' : '');
    var sideCls = myPos.side === 'yes' ? 'y' : 'n', sideLab = myPos.side === 'yes' ? 'Yes' : 'No';
    var action;
    var pendTag = myPos.placing ? '<span class="opm-pend">placing…</span>'
      : myPos.pending ? '<span class="opm-pend">confirming stake…</span>'
      : myPos.paying ? '<span class="opm-pend">paying…</span>'
      : (myPos.justFilled && Date.now() - myPos.justFilled < 4000 ? '<span class="opm-pend ok">✓ filled</span>' : '');
    if (myPos.selling) action = '<div class="opm-locked">' + (myPos.rail === 'wallet' ? 'Selling… paying OST to your wallet' : 'Selling… the OST server is filling at its current odds') + '</div>';
    else if (myPos.paying) action = '<div class="opm-locked">Paying… checking whether the payout landed. Check your wallet balance before retrying.</div>';
    else if (myPos.placing) action = '<div class="opm-locked">' + esc(myPos.placingText || 'Placing your ticket…') + '</div>';
    else if (myPos.pending) action = '<div class="opm-locked">Confirming your stake on chain — you can sell once it lands.</div>';
    else if (q && q.canCash === false) action = '<div class="opm-locked">' + esc(q.detail || q.label || 'Not sellable right now') + '</div>';
    else action = '<div class="opm-pcbtns"><button class="addmore" id="opmAddMore">Add more</button><button class="sell" id="opmSellBtn">Sell · ≈' + val.toFixed(2) + ' ' + esc(u) + '</button></div>';
    wrap.innerHTML = '<div class="opm-poscard"><div class="pch">Your position <span class="side ' + sideCls + '">' + sideLab + '</span>' + pendTag + '<span class="sp"></span><span class="pnl ' + (up ? 'up' : 'down') + '">' + esc(pnlTxt) + '</span></div>' +
      '<div class="opm-pcgrid"><div class="opm-pcg"><div class="k">Shares</div><div class="v">' + myPos.shares.toFixed(2) + '</div></div><div class="opm-pcg"><div class="k">Avg fill</div><div class="v">' + (myPos.entry > 0 ? fmtc(myPos.entry * 100) + '¢' : '—') + '</div></div><div class="opm-pcg"><div class="k">Value ≈ ' + esc(u) + '</div><div class="v">' + val.toFixed(2) + '</div></div></div>' + action + '</div>';
    var am = el('opmAddMore'); if (am) am.onclick = function () { openSheet('buy', myPos.side); };
    var sb = el('opmSellBtn'); if (sb && !sb.disabled) sb.onclick = doSell;
  }

  /* ---- AUTONOMOUS ON-CHAIN AUTO-CLAIM ----
   * For a ticket escrowed in the ON-CHAIN program vault only (fundedBy
   * 'onchain'): once the program has resolved its round, claim it from the
   * program (session-signed). PRD-1: this never touches a server-ledger (play
   * rail) ticket — the OST server pays those itself. Idempotent + capped. */
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
        if (!(o.onChain || o.fundedBy === 'onchain')) continue;                                // on-chain escrow tickets ONLY
        var st = String(o.status || o.outcome || '').toLowerCase();
        if (st === 'lost' || st === 'sold' || st === 'paid') continue;
        var mm = String(o.marketId || '').match(/^ost-btc5m-(\d+)$/); if (!mm) continue;
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
          patchOrder(o, { status: 'won', cashedOut: true, cashoutOst: net, cashoutSig: r && r.signature, claimSig: r && r.signature });
          credited = true;
        } catch (e) { /* already claimed / not payable yet — leave for next sweep */ }
      }
      if (credited) { refreshBalance(true); if (view === 'positions') renderPositions(); notify('ok', 'Claimed your on-chain winnings', 'Paid to your wallet as OSTG.'); }
    } catch (_) {} finally { autoClaimOnchain._busy = false; }
  }

  /* ---- buy / sell sheet ---- */
  var amt = 5, mode = 'buy';
  function openSheet(m, s) {
    mode = m; if (s) side = s;
    syncYnSel(); paintTicket(); el('opmSheet').classList.add('open'); el('opmScrim').classList.add('open');
    if (m === 'buy') { try { if (window.OST_BALANCE && OST_BALANCE.refresh) Promise.resolve(OST_BALANCE.refresh(false)).then(function () { refreshOpenSheet(true); }).catch(function () {}); } catch (_) {} }
  }
  function closeSheet() { var sh = el('opmSheet'), sc = el('opmScrim'); if (sh) sh.classList.remove('open'); if (sc) sc.classList.remove('open'); }
  function maxBal() { var b = spendableFor(currentMarket); return b > 0 ? Math.floor(b * 100) / 100 : 5; }
  function syncYnSel() { document.querySelectorAll('#opmYn button').forEach(function (b) { b.classList.toggle('sel', b.getAttribute('data-s') === side); }); }
  // When the on-chain arb is active, part of the stake is the market-maker
  // spread (skimmed in the same Solana tx) — shown, never hidden.
  function arbBps() { try { if (onchainActive && window.OST_ARB && OST_ARB.bps) return Number(OST_ARB.bps()) || 0; } catch (_) {} return 0; }
  // One estimate used by the sheet + its live refresher.
  //   wallet rail: the SAME quote the order fills at (OST_ARB.buyQuote at the
  //                side price shown) — quote = fill = record (PRD-4).
  //   play / on-chain: the server / program fills at its own odds — an estimate.
  function buyEstimate(stake) {
    var r = railOf(currentMarket);
    var c = side === 'yes' ? midYes : (100 - midYes), px = Math.max(0.001, Math.min(0.999, c / 100));
    if (r === 'wallet') {
      var q = null; try { q = (window.OST_ARB && OST_ARB.buyQuote) ? OST_ARB.buyQuote(stake, px) : null; } catch (_) { q = null; }
      var shares = q && q.shares > 0 ? q.shares : (stake / px);
      var fee = feeOf(shares, stake), net = shares - fee;
      var sb = 0; try { sb = q && window.OST_ARB && OST_ARB.bps ? Number(OST_ARB.bps()) || 0 : 0; } catch (_) {}
      return { c: c, fill: q && q.ask > 0 ? q.ask * 100 : c, spreadAmt: q ? q.arb : 0, sBps: sb, shares: shares, fee: fee, net: net, roi: stake > 0 ? ((net - stake) / stake * 100) : 0, estimate: false };
    }
    var sBps = arbBps(), spreadAmt = Math.max(0, stake * sBps / 10000), effStake = stake - spreadAmt;
    var sh = c > 0 ? effStake / (c / 100) : 0, fee2 = feeOf(sh, effStake), net2 = sh - fee2;
    return { c: c, fill: c, spreadAmt: spreadAmt, sBps: sBps, shares: sh, fee: fee2, net: net2, roi: stake > 0 ? ((net2 - stake) / stake * 100) : 0, estimate: true };
  }
  function buyBdHtml(e) {
    var winUnit = railOf(currentMarket) === 'wallet' ? 'OST' : 'OSTG';
    var rows = '<div class="opm-tl"><span class="k">' + (e.estimate ? 'Price now' : 'Fill price') + '</span><span class="v">' + fmtc(e.fill) + '¢</span></div>' +
      '<div class="opm-tl"><span class="k">Shares' + (e.estimate ? ' (est.)' : '') + '</span><span class="v" id="opmShV">' + (e.estimate ? '≈' : '') + e.shares.toFixed(2) + '</span></div>';
    if (e.spreadAmt > 0) rows += '<div class="opm-tl"><span class="k">Market spread (' + (e.sBps / 100) + '%)</span><span class="v">' + e.spreadAmt.toFixed(2) + '</span></div>';
    rows += '<div class="opm-tl"><span class="k">Fee (2% of profit)</span><span class="v">' + e.fee.toFixed(2) + '</span></div>' +
      '<div class="opm-tl big"><span class="k">If right you get</span><span class="v">' + (e.estimate ? '≈' : '') + e.net.toFixed(2) + ' ' + winUnit + '<span class="opm-roi">+' + e.roi.toFixed(0) + '%</span></span></div>';
    return rows;
  }
  // PRD-2: what this buy will actually spend, said BEFORE the tap. A BTC buy
  // spends the play balance (OSTG), then wallet OSTG, then wallet OST converted
  // 1:1 on chain — never a silent failure from an empty account.
  function fundingPlan(stake) {
    var r = railOf(currentMarket), b = balances();
    if (!walletAddr()) return { needWallet: true, text: 'Create a free devnet wallet to trade — it takes two taps, then claim 100 free OST.' };
    if (!(stake > 0)) return { empty: true, unit: unitOfRail(r), text: 'Enter an amount.' };
    if (r === 'wallet') {
      if (b.ost === undefined) return { unit: 'OST', text: 'Pays ' + fmtAmt(stake) + ' OST from your wallet · on-chain transfer to the OST pool, ~2 s · fees paid by OST' };
      if (b.ost + 1e-9 < stake) return { short: true, unit: 'OST', text: 'You have ' + fmtAmt(b.ost) + ' OST — not enough for ' + fmtAmt(stake) + ' OST.' };
      return { unit: 'OST', text: 'Pays ' + fmtAmt(stake) + ' OST from your wallet (you have ' + fmtAmt(b.ost) + ') · on-chain transfer to the OST pool, ~2 s · fees paid by OST' };
    }
    if (r === 'onchain') {
      if (b.ostg !== undefined && b.ostg + 1e-9 < stake) return { short: true, unit: 'OSTG', text: 'You have ' + fmtAmt(b.ostg) + ' OSTG in your wallet — not enough for ' + fmtAmt(stake) + ' OSTG.' };
      return { unit: 'OSTG', text: 'Pays ' + fmtAmt(stake) + ' OSTG from your wallet into the on-chain program vault.' };
    }
    if (b.play === undefined && b.ostg === undefined && b.ost === undefined) return { unit: 'OSTG', unknown: true, text: 'Checking your balance…' };
    var play = Number(b.play) || 0, wg = Number(b.ostg) || 0, wo = Number(b.ost) || 0;
    if (play + 1e-9 >= stake) return { unit: 'OSTG', text: 'Pays ' + fmtAmt(stake) + ' OSTG from your play balance (you have ' + fmtAmt(play) + ' OSTG).' };
    var need = stake - play;
    if (wg + 1e-9 >= need) return { unit: 'OSTG', moves: need, text: 'Pays ' + fmtAmt(stake) + ' OSTG · first moves ' + fmtAmt(need) + ' OSTG from your wallet to your play balance · fees paid by OST' };
    var conv = need - wg;
    if (wo + 1e-9 >= conv) return { unit: 'OST', convert: conv, text: 'Pay ' + fmtAmt(stake) + ' OST · converted 1:1 to OSTG · fees paid by OST' + ((play + wg) > 0.005 ? ' (uses your ' + fmtAmt(play + wg) + ' OSTG first)' : '') + ' · takes ~10–30 s' };
    return { short: true, unit: 'OST', text: 'You have ' + fmtAmt(wo) + ' OST + ' + fmtAmt(play + wg) + ' OSTG — not enough for ' + fmtAmt(stake) + '.' };
  }
  function railLine(r) {
    return r === 'wallet' ? 'Wallet OST · on-chain transfer to the OST pool, ~2 s'
      : r === 'onchain' ? 'Wallet OSTG · on-chain betting program vault'
      : 'OST play balance (OSTG) · OST server ledger';
  }
  function settleLine() {
    if (isBtcLive(currentMarket)) return onchainActive ? 'Settled on-chain by the betting program from the Pyth BTC close price' : 'Settled by the OST server from the BTC close price · a win is paid to your play balance automatically';
    if (isFastRound(currentMarket)) return 'Settles from the 5-minute candle at close · a win is claimed to your wallet as OST';
    return 'Settles when the market resolves · a win is claimed to your wallet as OST';
  }
  // The sheet's call to action (buy button, wallet gate, or "not enough" with
  // the two ways out). Lives in its own box so a live refresh can swap it
  // without touching the amount input the user is typing in.
  function ctaHtml(plan, r, u) {
    if (plan.needWallet) return '<div class="opm-short">' + esc(plan.text) + '</div><button class="opm-confirm" id="opmCfWallet">Create free wallet / Connect</button>';
    // "Convert" only helps when there is wallet OST to convert.
    var canConvert = r !== 'wallet' && Number(balances().ost) > 0;
    if (plan.short) return '<div class="opm-short" id="opmShort">' + esc(plan.text) + '</div><div class="opm-pcbtns"><button class="addmore" id="opmGetOst">Get free OST</button>' + (canConvert ? '<button class="addmore" id="opmConvert">Convert OST ⇄ OSTG</button>' : '') + '</div>';
    return '<button class="opm-confirm' + (side === 'no' ? ' no' : '') + '" id="opmCf"' + (plan.empty ? ' disabled' : '') + '>Buy ' + (side === 'yes' ? 'Yes' : 'No') + ' · ' + fmtAmt(amt) + ' ' + esc(u) + '</button>';
  }
  function buyTicket() {
    var e = buyEstimate(amt), r = railOf(currentMarket), plan = fundingPlan(amt), u = plan.unit || unitOfRail(r);
    return '<h3>' + icon('ticket') + ' Buy</h3>' +
      '<div class="opm-tkout"><button class="y' + (side === 'yes' ? ' sel' : '') + '" data-t="yes"><span class="lab">Yes</span><span class="px">' + fmtc(midYes) + '¢</span></button>' +
      '<button class="n' + (side === 'no' ? ' sel' : '') + '" data-t="no"><span class="lab">No</span><span class="px">' + fmtc(100 - midYes) + '¢</span></button></div>' +
      '<div class="opm-amt"><input id="opmAmtIn" inputmode="decimal" value="' + amt + '"><span class="cur" id="opmAmtCur">' + esc(u) + '</span></div>' +
      '<div class="opm-quick">' + [5, 10, 25, 'Max'].map(function (q) { return '<button data-q="' + String(q).toLowerCase() + '">' + q + '</button>'; }).join('') + '</div>' +
      '<div class="opm-src"><span class="l"><span class="d"></span> ' + esc(railLine(r)) + '</span></div>' +
      '<div class="opm-plan" id="opmPlan">' + esc(plan.needWallet || plan.short || plan.empty ? '' : plan.text) + '</div>' +
      // PRD-5 / D4: 1-tap only exists with a LIVE on-chain round market.
      (r === 'onchain' ? '<div class="opm-sess" id="opmSess"></div>' : '') +
      '<div class="opm-bd" id="opmBuyBd">' + buyBdHtml(e) + '</div>' +
      '<div id="opmCta">' + ctaHtml(plan, r, u) + '</div>' +
      '<div class="opm-fine">' + icon('lock') + ' ' + esc(settleLine()) + (e.estimate ? ' · the share count is an estimate — the server fills at its current odds' : '') +
        (isBtcLive(currentMarket) && !onchainActive ? '<br>On-chain betting program: offline (devnet R&amp;D)' : '') + '</div>';
  }
  // Sell quote: wallet tickets use the cash-out's own quote (what gets paid);
  // BTC server tickets an estimate at this page's live odds.
  function sellQuote() {
    var q = posQuote() || {};
    var cost = posCost(), net = Number(q.net) || 0, gross = Number(q.gross) || 0;
    var c = myPos ? (myPos.side === 'yes' ? midYes : (100 - midYes)) : 0;
    if (!(myPos && myPos.native) && Number(q.mid) > 0) c = Number(q.mid) * 100;
    var pnl = net - cost;
    return { c: c, shares: myPos ? myPos.shares : 0, fee: Number(q.fee) || 0, gross: gross, net: net, realNet: net.toFixed(2), pnl: pnl, up: pnl >= 0,
      canCash: q.canCash !== false, detail: q.detail || q.label || '', unit: (myPos && myPos.unit) || 'OST', rail: (myPos && myPos.rail) || 'wallet', native: !!(myPos && myPos.native) };
  }
  function sellConfirmTicket() {
    var q = sellQuote(), u = q.unit;
    // PRD-3: say where the proceeds go — the real rail and unit.
    var dest = q.rail === 'wallet' ? 'Proceeds go to your wallet as OST (on-chain payout from the OST pool, ~2 s).'
      : q.rail === 'onchain' ? 'Proceeds go to your wallet as OSTG.' : 'Proceeds go to your play balance (OSTG).';
    // PRD-5: no "exit price locked" — BTC sells fill at the SERVER's odds.
    var est = q.native ? 'Estimated — the server fills at its current odds.' : 'Estimate at the live price. If the price moves more than 5% before you tap, you are asked again.';
    return '<h3>' + icon('coin') + ' Sell your ' + (myPos && myPos.side === 'yes' ? 'Yes' : 'No') + ' position</h3>' +
      '<div class="opm-fine" style="text-align:left;color:var(--opm-ink2)">' + esc(est) + '</div>' +
      '<div class="opm-bd">' +
        '<div class="opm-tl"><span class="k">Selling</span><span class="v">' + q.shares.toFixed(2) + ' shares</span></div>' +
        '<div class="opm-tl"><span class="k">Sell price</span><span class="v" id="opmSellPx">' + fmtc(q.c) + '¢</span></div>' +
        '<div class="opm-tl"><span class="k">' + (q.native ? 'Fee (2% of profit, est.)' : 'Market spread') + '</span><span class="v" id="opmSellFee">' + q.fee.toFixed(2) + '</span></div>' +
        '<div class="opm-tl"><span class="k">Realized P&amp;L</span><span class="v" id="opmSellPnl" style="color:var(--opm-' + (q.up ? 'yes' : 'no') + ')">' + (q.up ? '+' : '−') + Math.abs(q.pnl).toFixed(2) + ' ' + esc(u) + '</span></div>' +
        '<div class="opm-tl big"><span class="k">You receive</span><span class="v" id="opmSellNet" style="color:var(--opm-gold)">≈' + q.realNet + ' ' + esc(u) + '</span></div>' +
      '</div>' +
      (q.canCash ? '<button class="opm-confirm sellc" id="opmCfSell">Sell for ≈' + q.realNet + ' ' + esc(u) + '</button>' : '<div class="opm-short">' + esc(q.detail || 'Not sellable right now.') + '</div>') +
      '<div class="opm-fine">' + icon('lock') + ' ' + esc(dest) + '</div>';
  }
  // One-tap betting (session key). Only on a LIVE on-chain round (PRD-5 / D4).
  function sessionActive() { try { return !!(window.OST_SESSION && OST_SESSION.exists() && OST_SESSION.balance() > 0); } catch (_) { return false; } }
  function renderSessionRow() {
    var host = el('opmSess'); if (!host) return;
    if (!isBtcLive(currentMarket) || !onchainActive || !window.OST_SESSION) { host.innerHTML = ''; return; }
    if (sessionActive()) {
      host.innerHTML = '<div class="opm-sesson"><span>⚡ 1-tap ON · ' + (Number(OST_SESSION.balance()) || 0).toFixed(0) + ' OSTG left</span><button id="opmSessEnd">End</button></div>';
      var e = el('opmSessEnd'); if (e) e.onclick = function () { e.disabled = true; e.textContent = '…'; OST_SESSION.end().then(function () { notify('ok', 'Session ended', 'Funds returned to your wallet.'); renderSessionRow(); }).catch(function (err) { notify('error', 'Could not end the session', errText(err, 'submit', 'OSTG')); e.disabled = false; e.textContent = 'End'; }); };
    } else {
      // Explicit, amount-first consent: the user picks how much OSTG to park in
      // the session key (hard-capped by OST_SESSION.limits and by the wallet).
      var lim = (OST_SESSION.limits) || { min: 1, max: 500, suggested: 25 };
      var wal = 0; try { wal = Math.floor(Number(OST_SESSION.walletBalance()) || 0); } catch (_) {}
      var maxF = Math.max(0, Math.min(lim.max, wal));
      if (!(maxF >= lim.min)) { host.innerHTML = '<div class="opm-sessoff"><span>⚡ 1-tap betting</span><em>' + (wal > 0 ? 'Needs at least ' + lim.min + ' OSTG in your wallet.' : 'Add OSTG to your wallet to enable 1-tap.') + '</em></div>'; return; }
      var pick = Math.min(sessPick || lim.suggested, maxF);
      var chips = [10, 25, 50, 100, 250].filter(function (v) { return v <= maxF; });
      if (chips.indexOf(maxF) < 0 && maxF < 250) chips.push(maxF);
      host.innerHTML = '<div class="opm-sessoff">' +
        '<div class="opm-sessh"><span>⚡ 1-tap betting</span><em>Park a small amount in a session key — bets then confirm with no popup. Only this amount can ever be spent; End returns the rest. Needs a little devnet SOL for the session’s fees.</em></div>' +
        '<div class="opm-sesschips">' + chips.map(function (v) { return '<button type="button" data-v="' + v + '"' + (v === pick ? ' class="on"' : '') + '>' + v + '</button>'; }).join('') +
          '<input type="number" id="opmSessAmt" min="' + lim.min + '" max="' + maxF + '" step="1" value="' + pick + '" aria-label="OSTG to load"></div>' +
        '<button class="opm-sessbtn" id="opmSessOn">Load ' + pick + ' OSTG into 1-tap · 1 signature</button>' +
        '<div class="opm-fine">Wallet ' + wal + ' OSTG · max ' + maxF + ' per session</div></div>';
      host.querySelectorAll('.opm-sesschips button').forEach(function (c) { c.onclick = function () { sessPick = Number(c.getAttribute('data-v')) || lim.suggested; renderSessionRow(); }; });
      var ai = el('opmSessAmt'); if (ai) ai.oninput = function () { var v = Math.floor(Number(this.value) || 0); sessPick = v; var bb = el('opmSessOn'); if (bb) { var ok = v >= lim.min && v <= maxF; bb.disabled = !ok; bb.textContent = ok ? 'Load ' + v + ' OSTG into 1-tap · 1 signature' : 'Enter ' + lim.min + '–' + maxF + ' OSTG'; } };
      var b = el('opmSessOn'); if (b) b.onclick = function () {
        var v = Math.floor(Number((el('opmSessAmt') || {}).value) || pick);
        if (!(v >= lim.min && v <= maxF)) { notify('info', 'Pick an amount', 'Between ' + lim.min + ' and ' + maxF + ' OSTG.'); return; }
        b.disabled = true; b.textContent = 'Funding ' + v + ' OSTG… approve in your wallet';
        OST_SESSION.fund(v, { consent: true }).then(function () { notify('ok', '1-tap on', v + ' OSTG loaded. Bets now confirm instantly.'); renderSessionRow(); refreshBalance(true); }).catch(function (err) { notify('error', 'Could not enable 1-tap', errText(err, 'submit', 'OSTG')); renderSessionRow(); });
      };
    }
  }
  var sessPick = 0;
  window.addEventListener('ost:session:offer', function () { try { renderSessionRow(); } catch (_) {} });
  window.addEventListener('ost:session:change', function () { try { if (el('opmSess') && !el('opmSessAmt')) renderSessionRow(); } catch (_) {} });
  function paintTicket() {
    var t = el('opmTicket'); if (!t) return;
    if (mode === 'sell') { t.innerHTML = sellConfirmTicket(); var cfs = el('opmCfSell'); if (cfs) cfs.onclick = confirmSell; return; }
    t.innerHTML = buyTicket();
    t.__planKey = planKey();
    renderSessionRow();
    document.querySelectorAll('#opmTicket .opm-tkout button').forEach(function (b) { b.onclick = function () { side = b.getAttribute('data-t'); syncYnSel(); paintTicket(); }; });
    document.querySelectorAll('#opmTicket .opm-quick button').forEach(function (b) { b.onclick = function () { var q = b.getAttribute('data-q'); amt = q === 'max' ? maxBal() : (parseFloat(q) || amt); paintTicket(); }; });
    var inp = el('opmAmtIn'); if (inp) inp.oninput = function () { amt = parseFloat(this.value) || 0; refreshOpenSheet(true); };
    wireCta();
  }
  function wireCta() {
    var cf = el('opmCf'); if (cf) cf.onclick = confirmBuy;
    var cw = el('opmCfWallet'); if (cw) cw.onclick = function () { var s = side; closeSheet(); requireWallet('buy', function () { openSheet('buy', s); }); };
    var go = el('opmGetOst'); if (go) go.onclick = function () {
      closeSheet();
      try {
        if (window.OST_WALLET_HOME && typeof OST_WALLET_HOME.open === 'function') { OST_WALLET_HOME.open('home'); return; }
        if (window.OST_WALLET && typeof OST_WALLET.openHome === 'function') { OST_WALLET.openHome('home'); return; }
      } catch (_) {}
      notify('info', 'Get free OST', 'Open the Wallet tab and tap “Get 100 free OST”.');
    };
    var cv = el('opmConvert'); if (cv) cv.onclick = function () {
      closeSheet();
      try { if (window.OST_BRIDGE_UI && typeof OST_BRIDGE_UI.open === 'function') { OST_BRIDGE_UI.open(); return; } } catch (_) {}
      try { if (window.OST_WALLET_HOME && typeof OST_WALLET_HOME.open === 'function') { OST_WALLET_HOME.open('convert'); return; } } catch (_) {}
      notify('info', 'Convert OST ⇄ OSTG', 'Open Wallet → Convert. 1:1, fees paid by OST.');
    };
  }
  // The sheet's CTA shape depends on wallet + balance; rebuild only when it changes.
  function planKey() { var p = fundingPlan(amt); return (p.needWallet ? 'w' : p.short ? 's' : p.empty ? 'e' : 'ok') + '|' + (p.unit || '') + '|' + side; }
  // ONE buy at a time. A desktop double-click on the confirm button used to run
  // confirmBuy twice before the sheet moved away — two stakes, two tickets, two
  // charges for one intended buy. The latch is taken BEFORE anything async and
  // released only when the order settled (or was refused).
  var _buyInFlight = false, _buyLatchAt = 0;
  function confirmBuy() {
    var cf = el('opmCf'); if (!cf || cf.disabled) return; var stake = Number(amt);
    if (_buyInFlight && Date.now() - _buyLatchAt < 120000) {
      if (Date.now() - _buyLatchAt > 1500) notify('info', 'Your last order is still being placed', 'One moment — it shows in your position as soon as it lands.');
      return;
    }
    if (!(stake > 0)) { notify('info', 'Enter an amount', 'Type how much to stake.'); return; }
    var bSide = side;
    if (!walletAddr()) { closeSheet(); requireWallet('buy', function () { openSheet('buy', bSide); }); return; }
    if (!btcPriceLive()) { notify('warn', 'Trading paused', 'No live BTC price right now — buying is paused until it returns.'); paintTradeGate(); return; }
    var mid = activeMarketId(); if (!mid) { notify('warn', 'Market not ready', 'The live round is still loading — try again in a moment.'); return; }
    var m = currentMarket, r = railOf(m), plan = fundingPlan(stake);
    if (plan.short) { notify('warn', 'Not enough balance', plan.text); paintTicket(); return; }
    if (isFastRound(m) && Number(m.closeAtMs) - Date.now() < 15000) { notify('info', 'Round closing', 'This 5-minute round closes in a few seconds — buy in the next round.'); return; }
    var e = buyEstimate(stake), u = plan.unit || unitOfRail(r);
    // Wallet-rail orders: build the order now so this notice shares its id
    // with app.js's background stake notices ('stake-<ref>'), which then
    // update the SAME card to "Ticket live" or "Ticket not placed".
    var direct = !isBtcLive(m) ? buildDirectOrder(m, bSide, stake) : null;
    var nid = direct ? 'stake-' + String(direct.reference).slice(0, 18) : 'buy-' + Date.now().toString(36);
    myPos = { order: {}, sig: '', ref: '', side: bSide, shares: e.shares, stake: stake, entry: e.fill / 100, unit: r === 'wallet' ? 'OST' : 'OSTG', rail: r, native: r === 'play', placing: true, placingText: 'Placing your ticket…' };
    renderPosition(); closeSheet();
    notify('pending', 'Placing your ' + (bSide === 'yes' ? 'Yes' : 'No') + ' ticket…', plan.text || '', { id: nid });
    var api = window.OST_PREDICTION_API || {};
    var step = function (t) { if (myPos && myPos.placing) { myPos.placingText = t; renderPosition(); } notify('pending', t, '', { id: nid }); };
    // Taken synchronously in the same click that starts the order, so a second
    // click (desktop double-click) can never start another one.
    _buyInFlight = true; _buyLatchAt = Date.now();
    cf.disabled = true; cf.setAttribute('data-busy', '1');
    var releaseBuy = function () {
      _buyInFlight = false;
      var c2 = el('opmCf'); if (c2 && c2.getAttribute('data-busy')) { c2.removeAttribute('data-busy'); c2.disabled = false; }
    };
    var run;
    if (!isBtcLive(m)) {
      // Every non-BTC market: the direct order (wallet OST rail), filled at the
      // exact price + shares this sheet showed (quoteLocked — PRD-4).
      run = (typeof api.placeOrder === 'function')
        ? Promise.resolve().then(function () { return api.placeOrder(direct); })
        : Promise.reject(Object.assign(new Error('The market desk is still loading — try again in a moment.'), { code: 'rail_loading' }));
    } else if (typeof api.placeBet !== 'function') {
      run = Promise.reject(Object.assign(new Error('The market desk is still loading — try again in a moment.'), { code: 'rail_loading' }));
    } else {
      // BTC 5-min: fund the play balance (convert OST → OSTG 1:1 if needed),
      // then the OST server opens the position.
      run = ensurePlayFunds(stake, step).then(function () { step('Opening your position…'); return api.placeBet({ marketId: mid, side: bSide, stake: stake }); });
    }
    run.then(function (res) {
      releaseBuy();
      var rec = (res && res.record) || res || {};
      if (myPos && myPos.placing) { myPos.placing = false; myPos.justFilled = Date.now(); }
      refreshPosition(); refreshBalance(true);
      var walletPending = !!(res && res.pending) || rec.fundingState === 'submitting' || rec.fundingState === 'confirming' || !!rec.pending;
      if (walletPending) {
        // The wallet stake confirms in the background; app.js reports the
        // final outcome (stake-<ref>) and clears this ticket if it is refused.
        notify('pending', 'Ticket placed — confirming your stake', fmtAmt(stake) + ' ' + (rec.unit || u) + ' is moving on-chain.', { id: nid });
      } else {
        notify('ok', 'Position open · ' + (bSide === 'yes' ? 'Yes' : 'No') + ' · ' + (Number(rec.shares) || e.shares).toFixed(2) + ' shares',
          'Paid ' + fmtAmt(stake) + ' ' + (rec.unit || (r === 'wallet' ? 'OST' : 'OSTG')) + (rec.fundedBy === 'ostg-native' ? ' from your play balance · settled by the OST server' : ''), { id: nid });
      }
      setTimeout(function () { refreshBalance(true); refreshPosition(); loadTrades(); }, 900);
    }).catch(function (err) {
      releaseBuy();
      if (myPos && myPos.placing) myPos = null;
      renderPosition(); refreshPosition(); refreshBalance(true);
      var code = String((err && err.code) || '');
      if (code === 'no_wallet') { requireWallet('buy', function () { openSheet('buy', bSide); }); }
      if (code === 'price_moved' && err.livePrice > 0) { midYes = Math.max(0.1, Math.min(99.9, Math.round(err.livePrice * 1000) / 10)); renderOddsLive(); }
      var unknown = code === 'state_unknown';
      notify(unknown ? 'warn' : 'error', unknown ? 'Checking your ticket' : 'Ticket not placed', errText(err, 'build', u), { id: nid });
    });
  }
  // The order payload app.js's createPredictionMarketOrder expects, built from the
  // page's own live quote — and FILLED at it (quoteLocked: quote = fill = record).
  // A picked ladder outcome routes the bet to that REAL leg market.
  function buildDirectOrder(m, bSide, stake) {
    var lp = (legPick && String(legPick.marketId) === String(m.id)) ? legPick : null;
    if (!lp && m.isGrouped) { try { lp = window.OST_MARKET_CHART && OST_MARKET_CHART.selection(m.id); } catch (_) {} }
    var yes = Math.max(0.001, Math.min(0.999, midYes / 100));
    var priceFraction = bSide === 'yes' ? yes : 1 - yes;
    var q = null; try { q = (window.OST_ARB && OST_ARB.buyQuote) ? OST_ARB.buyQuote(stake, priceFraction) : null; } catch (_) {}
    var shares = q && q.shares > 0 ? q.shares : stake / priceFraction;
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
      quotedAt: Date.now(), quoteSource: isFastRound(m) ? 'ost-prices' : (live ? 'clob-live' : 'catalog'), quoteLocked: true,
      reference: 'ost-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
    };
  }
  // PRD-2: fund the PLAY balance for a BTC buy, one confirmed step at a time:
  //   play balance ≥ stake          -> nothing to do
  //   + wallet OSTG covers the rest -> OST_PLAY.deposit (pool pays the fee)
  //   + wallet OST covers the rest  -> OST_BRIDGE_UI.convert OST → OSTG 1:1, then deposit
  //   otherwise                     -> refuse BEFORE anything moves, with the numbers
  // Balances are read fresh from the chain for this decision; an unknown balance
  // refuses ("try again") rather than broadcasting from an empty account.
  function readWalletTokens() {
    var B = window.OST_BRIDGE_UI;
    var fromCanon = function () { var b = balances(); return { ost: b.ost, ostg: b.ostg }; };
    if (B && typeof B.balances === 'function') {
      return Promise.resolve(B.balances()).then(function (a) {
        var c = fromCanon();
        return { ost: (a && a[0] != null) ? Number(a[0]) : c.ost, ostg: (a && a[1] != null) ? Number(a[1]) : c.ostg };
      }).catch(fromCanon);
    }
    return Promise.resolve(fromCanon());
  }
  function fundErr(code, msg) { var e = new Error(msg); e.code = code; return e; }
  function ensurePlayFunds(stake, step) {
    step = step || function () {};
    if (onchainActive) return Promise.resolve({ moved: 0 });   // the on-chain rail spends wallet OSTG directly
    if (!(window.OST_PLAY && OST_PLAY.deposit && OST_PLAY.balance)) return Promise.reject(fundErr('play_loading', 'The play balance is still loading — try again in a moment.'));
    return Promise.resolve(OST_PLAY.refresh ? OST_PLAY.refresh(true) : OST_PLAY.balance()).catch(function () { return OST_PLAY.balance(); }).then(function (pNow) {
      var play = Number(pNow); if (!isFinite(play)) play = Number(OST_PLAY.balance());
      if (!isFinite(play)) throw fundErr('balance_unknown', 'Could not read your play balance — nothing was taken. Try again in a moment.');
      if (play + 1e-9 >= stake) return { moved: 0 };
      var shortfall = Math.ceil((stake - play) * 1e6) / 1e6;
      return readWalletTokens().then(function (wb) {
        if (wb.ostg == null || wb.ost == null || !isFinite(wb.ostg) || !isFinite(wb.ost)) throw fundErr('balance_unknown', 'Could not read your wallet balance — nothing was taken. Try again in a moment.');
        var needConvert = Math.max(0, Math.ceil((shortfall - wb.ostg) * 1e6) / 1e6);
        if (needConvert > 0 && wb.ost + 1e-9 < needConvert) {
          throw fundErr('insufficient_funds_for_ticket', 'You have ' + fmtAmt(wb.ost) + ' OST + ' + fmtAmt(wb.ostg + play) + ' OSTG — not enough for ' + fmtAmt(stake) + '. Get free OST in your wallet, then try again.');
        }
        var chain = Promise.resolve();
        if (needConvert > 0) {
          if (!(window.OST_BRIDGE_UI && typeof OST_BRIDGE_UI.convert === 'function')) return Promise.reject(fundErr('rail_loading', 'The OST ⇄ OSTG converter is still loading — try again in a moment.'));
          step('Converting ' + fmtAmt(needConvert) + ' OST → OSTG (1:1)…');
          chain = Promise.resolve(OST_BRIDGE_UI.convert('deposit', needConvert)).catch(function (ce) {
            var c = fundErr('convert_failed', 'Could not convert OST → OSTG: ' + errText(ce, 'submit', 'OST') + ' Nothing else moved.');
            c.cause = ce; throw c;
          });
        }
        return chain.then(function () {
          step('Moving ' + fmtAmt(shortfall) + ' OSTG to your play balance…');
          return Promise.resolve(OST_PLAY.deposit(shortfall, { waitMs: needConvert > 0 ? 25000 : 4000 })).catch(function (de) {
            var msg = needConvert > 0
              ? 'Your OST was converted to OSTG (it is in your wallet), but moving it to your play balance did not finish: ' + errText(de, 'submit', 'OSTG') + ' Buy again — it skips the conversion.'
              : 'Moving OSTG to your play balance did not finish: ' + errText(de, 'submit', 'OSTG');
            var d = fundErr('deposit_failed', msg); d.cause = de; throw d;
          });
        }).then(function () { refreshBalance(true); return { moved: shortfall, converted: needConvert }; });
      });
    });
  }
  function confirmSell() {
    if (!myPos) { closeSheet(); return; }
    var cfs = el('opmCfSell'); if (cfs) { cfs.disabled = true; cfs.textContent = 'Processing…'; }
    var api = window.OST_PREDICTION_API, ref = myPos.ref || myPos.sig;
    if (!(api && typeof api.cashOut === 'function' && ref)) { if (cfs) { cfs.disabled = false; cfs.textContent = 'Sell'; } notify('error', 'Sell is still loading', 'Try again in a moment.'); return; }
    if (myPos.native && round && Number(round.closeAt) - Date.now() < 3000) {   // the server would refuse (round_closed)
      if (cfs) { cfs.disabled = false; cfs.textContent = 'Sell'; }
      notify('info', 'Round closing', 'Too close to the round end — it settles automatically from the BTC close price.');
      return;
    }
    // The sale goes through the ONE cash-out routine (app.js): wallet tickets
    // pay OST on chain, BTC server tickets sell back to the server. Every
    // outcome is reported there (OST_NOTIFY); this card just follows it.
    var q = sellQuote();
    var sellingPos = myPos; sellingPos.selling = true; _sellingRef = ref; closeSheet(); renderPosition();
    api.cashOut(ref, sellingPos.native ? {} : { expectNet: q.net }).then(function (r) {
      sellingPos.selling = false; _sellingRef = '';
      if (r && r.pending) { refreshPosition(); setTimeout(function () { refreshBalance(true); refreshPosition(); }, 1500); return; }
      if (!r || r.ok === false) {
        refreshPosition();
        notify('info', 'Not sold', (r && r.label) ? r.label : 'This position is not sellable right now.');
        return;
      }
      myPos = null; renderPosition(); refreshPosition();
      setTimeout(function () { refreshBalance(true); refreshPosition(); loadTrades(); }, 600);
    }).catch(function (e) {
      sellingPos.selling = false; _sellingRef = ''; renderPosition(); refreshPosition(); refreshBalance(true);
      if (e && e.code === 'price_moved') notify('warn', 'Price moved', String(e.message || 'Review the new price and sell again.'));
      else if (!(e && e.notified)) notify('error', 'Sell did not go through', errText(e, 'submit', sellingPos.unit || 'OST'));
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

  // Legacy name kept for the few non-money notes on this page (comments, feed).
  function toast(msg) { notify('info', String(msg || '')); }

  /* ================= PORTFOLIO (positions + history) =================
   * Polymarket-style portfolio: every open position marked to the SAME quote
   * the cash-out pays (OST_PREDICTION_API.actionFor — PRD-4 / PRD-6), realized
   * P&L from the RECORDED payout, wins that need a claim first, full history.
   * PRD-1 / PRD-6: a BTC 5-min (play-rail) win is paid by the OST server to the
   * play balance — it is never shown with a Claim; a paid ticket is never "Sell";
   * every row shows its own unit (OST on the wallet rail, OSTG on the play rail).
   * The list is the local ledger shown instantly, then reconciled with the
   * wallet's remote ledger and the resolution engines. */
  var posFilter = 'all', _pfStatus = { syncing: false, syncedAt: 0, note: '' }, _pfTimer = 0;
  function actionOf(o) {
    try { var api = window.OST_PREDICTION_API; if (api && typeof api.actionFor === 'function') return api.actionFor(o); } catch (_) {}
    return null;
  }
  // States: open · confirming · paying · settle (server is settling) · claim
  // (a wallet win to claim) · paid · lost · legacy (retired credits ticket).
  function orderState(o, a) {
    if (!o) return 'open';
    var tr = trustOf(o);
    // PRD-7: an old client's invented 'local-…' payout is not a receipt.
    if (o.cashedOut && (tr.fakePaid || (a && a.kind === 'legacy-receipt'))) return 'legacy';
    if (o.cashedOut) return 'paid';
    if (tr.rail === 'credits') return 'legacy';
    var st = String(o.status || o.outcome || '').toLowerCase();
    if (st === 'failed') return 'legacy';
    if (o.cashoutPending) return 'paying';
    if (o.fundingState === 'confirming' || o.fundingState === 'submitting' || o.pending) return 'confirming';
    // PRD-7 / SRV-3: no real on-chain stake, or a stake not found on chain for
    // this wallet — history only, never a Claim or a Sell.
    if (tr.fake || tr.unverifiable || (a && (a.kind === 'legacy-fake' || a.kind === 'unverified'))) return 'legacy';
    var native = tr.native || tr.rail === 'play';
    if (native) {
      // Only the SERVER's answer counts for a play-rail ticket (PRD-1).
      if (o.serverResolvedAt) {
        if (st === 'lost') return 'lost';
        if (st === 'won' || st === 'sold' || st === 'refunded' || st === 'settled') return 'paid';
      }
      var close = Number(o.closeAt || o.closeAtMs || 0);
      if (close > 0 && close <= Date.now()) return 'settle';
      return 'open';
    }
    if (st === 'lost') return 'lost';
    if (st === 'sold' || st === 'settled' || st === 'refunded') return 'paid';
    if (String(o.source || '') === 'ost-parlay') return 'open';
    if (tr.rail === 'onchain') return (a && a.finalStatus === 'lost') ? 'lost' : 'open';
    // A Claim exists ONLY where the cash-out would really pay it (same rule as
    // the HUD: OST_PREDICTION_API.actionFor).
    if (a && a.kind === 'prediction-settlement' && a.finalStatus === 'won' && a.canCash) return 'claim';
    if (a && a.finalStatus === 'lost') return 'lost';
    if (!a && st === 'won' && tr.rail === 'wallet' && !tr.fake) return 'claim';
    return 'open';
  }
  function isBtcRoundId(id) { return /^ost-btc5m-\d+$/.test(String(id || '')); }
  function parlaySlipOf(o) { try { var id = String(o.marketId || '').replace(/^ost-parlay:/, ''); return (window.OST_PARLAY && OST_PARLAY.slips() || []).filter(function (x) { return x.id === id; })[0] || null; } catch (_) { return null; } }
  function markTicket(o) {
    var a = actionOf(o);
    var st = orderState(o, a), stake = Number(o.stake) || 0, shares = Number(o.shares) || 0;
    var entry = Number(o.fillPrice) || Number(o.entry) || Number(o.price) || (shares > 0 ? stake / shares : 0);
    var t = { o: o, a: a, st: st, stake: stake, shares: shares, entry: entry, value: stake, pnl: 0, live: false, label: '', net: 0, unit: (a && a.unit) || orderUnit(o), rail: (a && a.rail) || orderRail(o), canCash: false };
    if (String(o.source || '') === 'ost-parlay') {
      var sl = parlaySlipOf(o);
      if (st === 'open') { t.value = sl ? (Number(OST_PARLAY.valueOf(sl)) || 0) : stake; t.net = sl ? (Number(OST_PARLAY.offerOf(sl)) || 0) : 0; t.live = !!sl; t.pnl = t.value - stake; t.label = 'parlay'; return t; }
    }
    // Realized: the RECORDED payout (never a re-quote — PRD-4 / PRD-6).
    if (st === 'paid') { t.value = Number(o.cashoutOst != null ? o.cashoutOst : o.payout) || 0; t.pnl = t.value - stake; return t; }
    if (st === 'lost') { t.value = 0; t.pnl = -stake; return t; }
    if (st === 'legacy') { t.value = 0; t.pnl = 0; return t; }
    if (st === 'paying') { t.value = Number(o.cashoutRequestedOst) || (a ? Number(a.net) || 0 : 0); t.net = t.value; t.pnl = t.value - stake; return t; }
    if (st === 'claim') { t.net = a ? Number(a.net) || 0 : (Number(o.potentialReturn) || shares); t.value = t.net; t.pnl = t.net - stake; t.canCash = true; return t; }
    if (st === 'settle' || st === 'confirming') { t.value = stake; t.net = 0; t.pnl = 0; t.unknown = true; return t; }
    // Open: the exact number a sell pays right now (or the server estimate).
    if (a) {
      t.net = Number(a.net) || 0; t.canCash = !!a.canCash; t.label = a.label || '';
      if (t.net > 0) { t.value = t.net; t.live = Number(a.livePrice) > 0; }
      t.pnl = t.value - stake;
    }
    return t;
  }
  function computePortfolio(marked) {
    var p = { open: 0, openValue: 0, openStake: 0, unrealized: 0, realized: 0, claim: 0, claimValue: 0, won: 0, lost: 0, paid: 0, staked: 0 };
    marked.forEach(function (t) {
      if (t.st === 'legacy') return;   // D1: retired credits are not money — kept out of every total
      p.staked += t.stake;
      if (t.st === 'open' || t.st === 'settle' || t.st === 'confirming' || t.st === 'paying') { p.open++; p.openValue += t.value; p.openStake += t.stake; p.unrealized += t.pnl; }
      else if (t.st === 'claim') { p.claim++; p.claimValue += t.net; p.won++; p.unrealized += t.pnl; }
      else if (t.st === 'paid') { p.paid++; p.realized += t.pnl; if (t.pnl > 0.005) p.won++; }
      else if (t.st === 'lost') { p.lost++; p.realized += t.pnl; }
    });
    return p;
  }
  function signed(v, dp) { v = Number(v) || 0; return (v > 0.005 ? '+' : v < -0.005 ? '−' : '') + Math.abs(v).toFixed(dp == null ? 2 : dp); }
  function ticketRow(t) {
    var o = t.o, st = t.st, side = o.side === 'no' ? 'no' : 'yes', u = esc(t.unit);
    var ref = orderKey(o), isParlay = String(o.source || '') === 'ost-parlay';
    var playRail = t.rail === 'play';
    var actionHtml, badge = '';
    if (isParlay && st === 'open') {
      var slipId = String(o.marketId || '').replace(/^ost-parlay:/, '');
      actionHtml = t.net >= 0.05 ? '<button class="opm-tbtn" data-parlay-sell="' + esc(slipId) + '">Sell · ' + t.net.toFixed(2) + '</button>' : '<span class="opm-tbadge">⚡ live</span>';
    } else if (st === 'claim') {
      actionHtml = '<button class="opm-tbtn claimw" data-ref="' + esc(ref) + '">Claim · ' + t.net.toFixed(2) + ' ' + u + '</button>';
    } else if (st === 'settle') {
      actionHtml = '<span class="opm-tbadge">Settling · paid automatically</span>';
    } else if (st === 'paying') {
      actionHtml = '<span class="opm-tbadge">Paying…</span>';
    } else if (st === 'confirming') {
      actionHtml = '<span class="opm-tbadge">Confirming stake…</span>';
    } else if (st === 'open') {
      if (t.canCash && t.net > 0) actionHtml = '<button class="opm-tbtn" data-ref="' + esc(ref) + '">Sell · ≈' + t.net.toFixed(2) + ' ' + u + '</button>';
      else actionHtml = '<span class="opm-tbadge">' + esc(t.label && !/^sell/i.test(t.label) ? t.label : 'Open') + '</span>';
    } else if (st === 'paid') {
      actionHtml = '<span class="opm-tres" style="color:' + (t.pnl >= 0 ? 'var(--opm-yes)' : 'var(--opm-no)') + '">' + signed(t.pnl) + ' ' + u + '</span>';
      var ost = String(o.status || '').toLowerCase();
      badge = (ost === 'sold' || /sell|cashout/.test(String(o.cashoutKind || ''))) ? 'Sold' : (ost === 'refunded' ? 'Refunded' : 'Won');
      if (playRail) badge += ' · paid to play balance';
      else if (o.cashoutSig && !/^(local|credits|sim)-/.test(String(o.cashoutSig))) badge += ' · paid to wallet';
    }
    else if (st === 'lost') { actionHtml = '<span class="opm-tres" style="color:var(--opm-no)">−' + t.stake.toFixed(2) + ' ' + u + '</span>'; badge = 'Lost'; }
    else if (st === 'legacy') {
      actionHtml = '<span class="opm-tbadge">Not cashable</span>';
      var lk = t.a && t.a.kind;
      badge = String(o.status || '') === 'failed' ? 'Not placed'
        : lk === 'legacy-receipt' ? 'Legacy receipt · never paid on chain'
        : lk === 'unverified' ? 'Stake not found on chain'
        : lk === 'legacy-fake' ? 'Legacy · no on-chain stake'
        : 'Legacy credits';
    }
    else { actionHtml = '<span class="opm-tbadge">Open</span>'; }
    // A payout that failed on chain is not hidden: the row says nothing was
    // paid, and Sell / Claim is offered again (PRD-6).
    if (!badge && o.cashoutFailedAt && (st === 'claim' || st === 'open') && Date.now() - Number(o.cashoutFailedAt) < 86400000) badge = 'Last payout failed · nothing was paid';
    var title = o.title || o.marketTitle || o.marketId || 'Ticket';
    var when = o.cashoutAt || o.resolvedAt || o.ts || o.createdAt;
    var valTxt = (st === 'open' || st === 'paying') ? ('<b class="' + (t.pnl >= 0 ? 'up' : 'down') + '">' + t.value.toFixed(2) + ' ' + u + '</b> <i>' + signed(t.pnl) + (t.stake > 0 ? ' (' + signed(t.pnl / t.stake * 100, 0) + '%)' : '') + (t.live ? '' : ' · at entry') + '</i>')
      : st === 'claim' ? ('<b class="up">won · ' + t.net.toFixed(2) + ' ' + u + '</b>')
      : st === 'settle' ? '<i>Settled by the OST server from the BTC close price</i>' : '';
    // Meta line: each piece is its own no-wrap chip, so a phone wraps BETWEEN
    // pieces, never mid-word (PRD-6).
    var meta = ['<span class="opm-tside ' + (side === 'yes' ? 'y' : 'n') + '">' + esc(o.outcomeLabel && !isParlay ? o.outcomeLabel : (side === 'yes' ? 'Yes' : 'No')) + '</span>',
      '<span>' + t.stake.toFixed(2) + ' <small>' + u + '</small></span>'];
    if (t.entry > 0 && !isParlay) meta.push('<span>@ ' + fmtc(t.entry * 100) + '¢</span>');
    if (t.shares > 0 && !isParlay) meta.push('<span>' + t.shares.toFixed(1) + ' sh</span>');
    meta.push('<span>' + ago(when) + '</span>');
    if (badge) meta.push('<span><em>' + esc(badge) + '</em></span>');
    return '<div class="opm-trow st-' + st + '" data-mid="' + esc(o.marketId || '') + '">' +
      '<div class="opm-timg"></div>' +
      '<div class="opm-tmain"><div class="opm-ttitle">' + esc(title) + '</div>' +
        '<div class="opm-tmeta">' + meta.join('') + '</div>' +
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
        '<div class="opm-pfnote">Totals add OST (wallet rail) and OSTG (play rail) 1:1 · devnet, no cash value.</div>' +
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
    if (claimHost) { var cl = marked.filter(function (t) { return t.st === 'claim'; }); claimHost.innerHTML = cl.length ? '<div class="opm-claimbar"><span>🎉 ' + cl.length + ' win' + (cl.length > 1 ? 's' : '') + ' to claim · ' + num2(pf.claimValue) + ' OST to your wallet</span><button class="opm-tbtn claimw" id="opmClaimAll">Claim all</button></div>' : '';
      var ca = el('opmClaimAll'); if (ca) ca.onclick = function () { ca.disabled = true; ca.textContent = 'Claiming…'; claimAll(cl); }; }
    var list = el('opmPosList'); if (!list) return;
    var isOpenish = function (s) { return s === 'open' || s === 'settle' || s === 'paying' || s === 'confirming'; };
    var rows = marked.filter(function (t) { return posFilter === 'all' || t.st === posFilter || (posFilter === 'open' && isOpenish(t.st)) || (posFilter === 'paid' && (t.st === 'lost' || t.st === 'legacy')); });
    var order = { claim: 0, paying: 1, settle: 1, confirming: 1, open: 2, paid: 3, lost: 3, legacy: 4 };
    if (posFilter === 'all') rows.sort(function (a, b) { return (order[a.st] - order[b.st]) || (Number(b.o.ts || 0) - Number(a.o.ts || 0)); });
    if (!rows.length) {
      list.innerHTML = '<div class="opm-empty">' + (orders.length ? 'Nothing in this filter yet.' : (_pfStatus.syncing ? 'Loading your positions…' : 'No positions yet. Open a market and take a side — your tickets, wins and history show up here.')) + '</div>';
      return;
    }
    var html = '', lastGroup = '';
    rows.forEach(function (t) {
      var g = t.st === 'claim' ? 'Ready to claim' : isOpenish(t.st) ? 'Open positions' : 'History';
      if (posFilter === 'all' && g !== lastGroup) { html += '<div class="opm-sec2">' + g + '</div>'; lastGroup = g; }
      html += ticketRow(t);
    });
    list.innerHTML = html;
    try { if (window.OST_MARKET_ART) OST_MARKET_ART.apply(); } catch (_) {}
    list.querySelectorAll('.opm-tbtn[data-parlay-sell]').forEach(function (b) {
      b.onclick = function (e) { e.stopPropagation(); b.disabled = true; b.textContent = '…'; try { OST_PARLAY.sell(b.getAttribute('data-parlay-sell')); } catch (_) {} setTimeout(function () { refreshBalance(true); renderPositions(); }, 300); };
    });
    list.querySelectorAll('.opm-tbtn[data-ref]').forEach(function (b) {
      b.onclick = function (e) { e.stopPropagation(); cashOutTicket(b.getAttribute('data-ref'), b); };
    });
    list.querySelectorAll('.opm-trow').forEach(function (r) {
      r.onclick = function () { var m = marketForOrderId(r.getAttribute('data-mid')); if (m) openMarket(m); else notify('info', 'Market closed', 'That market is no longer in the live list.'); };
    });
  }
  function num2(v) { return (Number(v) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  // Sell / claim one ticket through the ONE cash-out routine (app.js). It shows
  // every outcome itself (OST_NOTIFY); this only covers "nothing to cash" and
  // errors it did not already report.
  function cashOutTicket(ref, b, opts) {
    var api = window.OST_PREDICTION_API;
    if (b) { b.disabled = true; b.textContent = '…'; }
    if (!(api && typeof api.cashOut === 'function' && ref)) {
      if (b) b.disabled = false;
      notify('error', 'Payouts are still loading', 'Try again in a moment.');
      return Promise.resolve();
    }
    return Promise.resolve(api.cashOut(ref, opts || {}))
      .then(function (r) { if (r && r.ok === false && r.label) notify('info', 'Nothing to pay yet', r.label); })
      .catch(function (err) { if (!(err && err.notified)) notify('error', 'Payout did not go through', errText(err, 'submit', 'OST')); })
      .then(function () { refreshBalance(true); renderPositions(); });
  }
  function claimAll(list) {
    var chain = Promise.resolve();
    list.forEach(function (t) { var ref = orderKey(t.o); if (ref) chain = chain.then(function () { return cashOutTicket(ref, null); }); });
    chain.then(function () { refreshBalance(true); renderPositions(); });
  }
  // Reconcile with the server: the wallet's remote ledger + fresh resolutions.
  function syncPortfolio(force) {
    var api = window.OST_PREDICTION_API || {};
    if (_pfStatus.syncing) return;
    if (!force && _pfStatus.syncedAt && Date.now() - _pfStatus.syncedAt < 20000) { renderPositions(); return; }
    _pfStatus.syncing = true; _pfStatus.note = ''; renderPositions();
    var jobs = [];
    // NET-3: one remote sync per user action — the ↻ button forces it; an
    // automatic open is throttled by app.js (≤ 1 per 60 s).
    if (walletAddr() && typeof api.syncOrders === 'function') jobs.push(Promise.resolve(api.syncOrders({ force: !!force })).catch(function () { return false; }));
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
  window.addEventListener('ost:money:change', function () { refreshBalance(true); if (view === 'positions') renderPositions(); });
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
    // NET-3 / C6: idle re-reads only while this page is on screen, ≥ 60 s apart
    // (OST_BALANCE throttles itself; no play / session poll from here).
    setInterval(function () { var host = el('ostPredictMobile'); if (!document.hidden && host && host.offsetParent !== null) refreshBalance(); }, 60000);
    // PRD-4: an ETH/SOL 5-min round re-prices every second. The detail (and an
    // open buy sheet) follows OST_PRICES — the SAME source the fill checks — so
    // the quote the user taps is the price the order is filled at. Local only
    // (no network): OST_PRICES derives the odds from the cached spot feed.
    setInterval(function () {
      if (view !== 'detail' || document.hidden || !isFastRound(currentMarket)) return;
      var cur = currentFastRound(currentMarket);
      if (cur && cur.id !== currentMarket.id) { paintStandard(); return; }
      var fc = fastMidCents(currentMarket);
      if (fc > 0 && Math.abs(fc - midYes) >= 0.1) { midYes = fc; paintOdds(); renderOddsLive(); }
    }, 1500);
    // autonomous autopay: claim resolved on-chain wins to the wallet OSTG.
    // Runs only while visible; it no-ops immediately when there are no open
    // on-chain tickets, so it isn't network churn most of the time.
    setTimeout(function () { if (!document.hidden) autoClaimOnchain(); }, 8000);
    setInterval(function () { if (!document.hidden) autoClaimOnchain(); }, 60000);
    // SRV-2 / PRD-6: after a reload, finish what the last session left open —
    // a wallet stake still 'confirming', a payout still 'Paying…' (looked up by
    // signature / payoutId, never re-sent as a new transaction), and BTC
    // server-ledger results (read-only). Once per wallet attach.
    var _reconciledFor = '';
    function reconcileOnLoad() {
      var w = walletAddr(); if (!w || _reconciledFor === w) return; _reconciledFor = w;
      var api = window.OST_PREDICTION_API || {};
      try { if (typeof api.reconcilePendingStakes === 'function') api.reconcilePendingStakes(); } catch (_) {}
      try { if (typeof api.reconcilePendingCashouts === 'function') api.reconcilePendingCashouts(); } catch (_) {}
      try { if (typeof api.refreshNativeResolutions === 'function') api.refreshNativeResolutions(); } catch (_) {}
    }
    setTimeout(reconcileOnLoad, 3000);
    window.addEventListener('ost:wallet-changed', function () { setTimeout(reconcileOnLoad, 2000); });
    // markets can arrive after boot
    var t = 0; var iv2 = setInterval(function () { if (allMarkets().length) { if (view === 'browse') renderBrowse(); clearInterval(iv2); } else if (++t > 40) clearInterval(iv2); }, 700);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();

/* ==========================================================================
 * OST · Predict Mobile — the v4 design, wired to REAL data + REAL money.
 * --------------------------------------------------------------------------
 * A single-market, mobile-portrait prediction page (the BTC 5-min flagship)
 * that IS the approved v4 mockup. It replaces the old cluttered prediction
 * board with one clean surface.
 *
 * SAFE MONEY REUSE (no new money code):
 *   · BUY  -> window.OST_PREDICTION_API.placeBet({marketId, side, stake})
 *             (the existing, proven quoting + routing path).
 *   · SELL/SETTLE -> triggers the existing, proven ledger cash-out button for
 *             the user's position (app.js owns the payout math + fee + bucket
 *             rules). We never recompute a payout here.
 *
 * The old #predictionMarketBoard is HIDDEN (not deleted) so every money path,
 * ledger and event it powers keeps working underneath — this surface just
 * drives them through a clean UI.
 *
 * Everything real:
 *   · round + price-to-beat  <- /btc/round (authoritative)
 *   · live price + graph     <- ost:btc-spot stream + round ticks (<=12h cap)
 *   · odds / pool split      <- round yesPriceNumber (implied), stake totals
 *                               from the real /positions/recent feed
 *   · trades                 <- /positions/recent (real cross-user bets)
 *   · holders                <- aggregated from that same real feed
 *   · comments               <- /predict/comments (real, per-market) + Mesh
 *   · balance                <- OST_PLAY (server-authoritative play OSTG)
 *   · your position          <- OST_PREDICTION_API.ledger()
 * ========================================================================== */
(function () {
  'use strict';
  if (window.OST_PREDICT_MOBILE) return;
  var API = (window.OST_API_BASE || 'https://ost-api.nachogtavl.workers.dev').replace(/\/+$/, '');
  var RM = matchMedia('(prefers-reduced-motion:reduce)').matches;

  var P = {
    btc: 'M9 8h5a2.5 2.5 0 010 5H9zm0 5h5.5a2.5 2.5 0 010 5H9zm0-5V5m3 0v3m-3 13v-3m3 3v-3',
    scale: 'M12 3v18M6 7l-3 6h6zM18 7l3 6h-6M3 13a3 3 0 006 0M15 13a3 3 0 006 0M8 21h8',
    trades: 'M3 17l6-6 4 4 8-8M15 7h6v6',
    users: 'M9 11a3 3 0 100-6 3 3 0 000 6zM3 20a6 6 0 0112 0M17 11a3 3 0 10-1-5.8M21 20a6 6 0 00-4-5.6',
    chat: 'M4 5h16v11H9l-5 4z',
    ticket: 'M4 8a2 2 0 012-2h12a2 2 0 012 2 2 2 0 000 4 2 2 0 000 4 2 2 0 01-2 2H6a2 2 0 01-2-2 2 2 0 000-4 2 2 0 000-4zM12 6v12',
    lock: 'M6 11h12v9H6zM8 11V7a4 4 0 018 0v4',
    coin: 'M12 3a9 9 0 100 18 9 9 0 000-18zM9 12h6M12 9v6',
    go: 'M5 12h14M13 6l6 6-6 6', back: 'M15 5l-7 7 7 7', clock: 'M12 3a9 9 0 100 18 9 9 0 000-18zM12 8v4l3 2'
  };
  function icon(n, c) { return '<svg class="opm-ic ' + (c || '') + '" viewBox="0 0 24 24">' + P[n].split('M').filter(Boolean).map(function (d) { return '<path d="M' + d + '"/>'; }).join('') + '</svg>'; }
  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function el(id) { return document.getElementById(id); }
  function ago(ts) {
    var n = Number(ts);
    if (!n || !isFinite(n)) { var d = Date.parse(ts); n = isFinite(d) ? d : 0; }
    if (!n) return '';
    var s = Math.max(0, Math.round((Date.now() - n) / 1000));
    if (s < 60) return s + 's'; if (s < 3600) return Math.floor(s / 60) + 'm'; if (s < 86400) return Math.floor(s / 3600) + 'h'; return Math.floor(s / 86400) + 'd';
  }
  function compact(n) { n = Number(n) || 0; if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M'; if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + 'k'; return Math.round(n).toString(); }

  /* ---- state ---- */
  var round = null;          // authoritative round
  var price = 0, beat = 0, midYes = 50, hrs = 1;
  var hist = [];             // rolling real price history (<=12h)
  var HIST_MAX = 400;
  var side = 'yes';
  var poolY = 0, poolN = 0;  // real stake totals (from feed); 0 => show split only
  var myPos = null;          // {order, sig, side, shares, entry, cashBtnText, sellable, locked}
  var seenTrades = {}, firstTrades = true;

  /* ---- odometer ---- */
  function tween(elm, to, fmt, dur) {
    if (!elm) return;
    var from = (elm._v == null ? to : elm._v); elm._v = to;
    if (RM || from === to) { elm.textContent = fmt(to); return; }
    var t0 = performance.now(); dur = dur || 500;
    function fr(t) { var k = Math.min(1, (t - t0) / dur); elm.textContent = fmt(from + (to - from) * k); if (k < 1) requestAnimationFrame(fr); }
    requestAnimationFrame(fr);
  }
  var usd = function (v) { return '$' + Math.round(v).toLocaleString(); };
  var cents = function (v) { return Math.round(v) + '¢'; };
  var num0 = function (v) { return Math.round(v).toLocaleString(); };

  /* ================= TEMPLATE ================= */
  function template() {
    return '' +
    '<div class="opm-tb">' +
      '<div class="opm-cat">5-min crypto<b>Bitcoin</b></div>' +
      '<div class="opm-sp"></div>' +
      '<div class="opm-bal"><span class="k">Play OSTG</span><span class="v" id="opmBal">—</span><span class="f" id="opmBalF"></span></div>' +
    '</div>' +
    '<div class="opm-scroll">' +
      '<div class="opm-qhead">' +
        '<div class="ico">' + icon('btc') + '</div>' +
        '<div><h1>Will BTC be higher in 5 minutes?</h1>' +
          '<span class="opm-live"><span class="d"></span> Live · closes <span class="opm-mono" id="opmCd">—</span></span></div>' +
      '</div>' +
      '<div class="opm-px up" id="opmPx">' +
        '<div class="opm-pxrow"><div class="opm-pxnow" id="opmNow">—</div><div class="opm-pxdelta" id="opmDelta">—</div></div>' +
        '<div class="opm-beat"><span class="sw"></span> Price to beat <b id="opmBeat">—</b></div>' +
        '<canvas class="opm-g" id="opmG" width="402" height="150"></canvas>' +
        '<div class="opm-tf" id="opmTf"><button data-h="1" class="on">1H</button><button data-h="3">3H</button><button data-h="6">6H</button><button data-h="12">12H</button></div>' +
      '</div>' +
      '<div class="opm-yn" id="opmYn">' +
        '<button class="y sel" data-s="yes"><span class="lab">Yes · higher</span><span class="px" id="opmYnY">—</span><span class="sh" id="opmYnYx"></span></button>' +
        '<button class="n" data-s="no"><span class="lab">No · lower</span><span class="px" id="opmYnN">—</span><span class="sh" id="opmYnNx"></span></button>' +
      '</div>' +
      '<div class="opm-pool">' +
        '<div class="h"><span>Round pool</span><span class="rt">' + icon('scale') + ' pari-mutuel</span></div>' +
        '<div class="opm-splbar"><span class="yy" id="opmPoolY" style="width:50%">50%</span><span class="nn" id="opmPoolN">50%</span></div>' +
        '<div class="sub"><span id="opmPoolYA"></span><span id="opmPoolTot"></span><span id="opmPoolNA"></span></div>' +
      '</div>' +
      '<div id="opmPosWrap"></div>' +
      '<div class="opm-seg" id="opmSeg">' +
        '<button data-p="trades" class="on">' + icon('trades') + 'Trades</button>' +
        '<button data-p="holders">' + icon('users') + 'Holders</button>' +
        '<button data-p="comments">' + icon('chat') + 'Comments</button>' +
      '</div>' +
      '<div class="opm-pane on" data-pane="trades"><div id="opmTrades"><div class="opm-empty">Loading live trades…</div></div></div>' +
      '<div class="opm-pane" data-pane="holders"><div id="opmHolders"><div class="opm-empty">Loading holders…</div></div></div>' +
      '<div class="opm-pane" data-pane="comments">' +
        '<div class="opm-meshcta" id="opmMesh"><svg class="opm-ic" viewBox="0 0 24 24"><path d="M4 5h16v11H9l-5 4z"/><path d="M8 10h8M8 13h5"/></svg>' +
          '<div class="t"><b>Discuss in OST Mesh</b><span>Comments are real OST users, from the Mesh social layer</span></div>' + icon('go', 'go') + '</div>' +
        '<div class="opm-cmtbox"><input id="opmCmtIn" maxlength="280" placeholder="Add a comment…"><button id="opmCmtSend">Post</button></div>' +
        '<div id="opmComments"><div class="opm-empty">Be the first to comment.</div></div>' +
      '</div>' +
    '</div>' +
    '<div class="opm-buybar"><button class="by" data-open="yes" id="opmBuyY">Buy Yes</button><button class="bn" data-open="no" id="opmBuyN">Buy No</button></div>' +
    '<div class="opm-scrim" id="opmScrim"></div>' +
    '<div class="opm-sheet" id="opmSheet"><div class="opm-grab"></div><div id="opmTicket"></div></div>';
  }

  /* ================= GRAPH ================= */
  function draw() {
    var cv = el('opmG'); if (!cv) return;
    var ctx = cv.getContext('2d');
    var w = cv.width, ht = cv.height, pad = 4;
    var data = hist.slice(-Math.min(hist.length, hrs * 33 || 33));
    if (data.length < 2) data = hist.slice();
    var n = data.length;
    if (!n || !beat) { ctx.clearRect(0, 0, w, ht); return; }
    var lo = Math.min(beat, Math.min.apply(0, data)), hi = Math.max(beat, Math.max.apply(0, data));
    var rng = (hi - lo) || 1; lo -= rng * .12; hi += rng * .12; rng = hi - lo;
    var gx = function (i) { return pad + (n === 1 ? 0 : i / (n - 1) * (w - 2 * pad)); };
    var gy = function (p) { return pad + (1 - (p - lo) / rng) * (ht - 2 * pad); };
    var up = price >= beat, col = up ? '52,211,153' : '251,113,133';
    ctx.clearRect(0, 0, w, ht);
    var by = gy(beat);
    ctx.setLineDash([5, 5]); ctx.beginPath(); ctx.moveTo(pad, by); ctx.lineTo(w - pad, by);
    ctx.strokeStyle = 'rgba(160,184,203,.55)'; ctx.lineWidth = 1.2; ctx.stroke(); ctx.setLineDash([]);
    var g = ctx.createLinearGradient(0, 0, 0, ht); g.addColorStop(0, 'rgba(' + col + ',.34)'); g.addColorStop(1, 'rgba(' + col + ',0)');
    ctx.beginPath(); ctx.moveTo(gx(0), ht - pad); data.forEach(function (p, i) { ctx.lineTo(gx(i), gy(p)); }); ctx.lineTo(gx(n - 1), ht - pad); ctx.closePath(); ctx.fillStyle = g; ctx.fill();
    ctx.beginPath(); data.forEach(function (p, i) { i ? ctx.lineTo(gx(i), gy(p)) : ctx.moveTo(gx(i), gy(p)); });
    ctx.strokeStyle = 'rgb(' + col + ')'; ctx.lineWidth = 2.2; ctx.lineJoin = 'round'; ctx.stroke();
    var lp = data[n - 1];
    ctx.beginPath(); ctx.arc(gx(n - 1), gy(lp), 4, 0, 7); ctx.fillStyle = 'rgb(' + col + ')'; ctx.fill();
    ctx.beginPath(); ctx.arc(gx(n - 1), gy(lp), 8, 0, 7); ctx.strokeStyle = 'rgba(' + col + ',.4)'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = 'rgba(160,184,203,.9)'; ctx.font = '10px ui-monospace,monospace'; ctx.textAlign = 'right'; ctx.fillText('to beat', w - pad - 2, by - 5);
  }

  function applyDir() {
    var pb = el('opmPx'); if (!pb || !beat) return;
    var up = price >= beat;
    pb.classList.toggle('up', up); pb.classList.toggle('down', !up);
    var d = ((price - beat) / beat * 100);
    var de = el('opmDelta'); if (de) de.textContent = (up ? '▲ ' : '▼ ') + Math.abs(d).toFixed(2) + '%';
  }

  function pushHist(p) { if (!(p > 0)) return; hist.push(p); if (hist.length > HIST_MAX) hist.shift(); }

  /* ================= ODDS / POOL ================= */
  function paintOdds() {
    tween(el('opmYnY'), midYes, cents); tween(el('opmYnN'), 100 - midYes, cents);
    var yMul = midYes > 0 ? (100 / midYes) : 0, nMul = (100 - midYes) > 0 ? (100 / (100 - midYes)) : 0;
    var yx = el('opmYnYx'); if (yx) yx.textContent = yMul ? yMul.toFixed(2) + '× payout' : '';
    var nx = el('opmYnNx'); if (nx) nx.textContent = nMul ? nMul.toFixed(2) + '× payout' : '';
    // pool split from implied odds (real); amounts from the real feed if we have them
    var yp;
    if (poolY + poolN > 0) yp = Math.round(poolY / (poolY + poolN) * 100);
    else yp = midYes;
    var py = el('opmPoolY'), pn = el('opmPoolN');
    if (py) { py.style.width = yp + '%'; py.textContent = yp + '%'; }
    if (pn) pn.textContent = (100 - yp) + '%';
    var ya = el('opmPoolYA'), na = el('opmPoolNA'), tot = el('opmPoolTot');
    if (poolY + poolN > 0) {
      if (ya) ya.textContent = 'Yes ' + num0(poolY) + ' OSTG';
      if (na) na.textContent = 'No ' + num0(poolN) + ' OSTG';
      if (tot) tot.textContent = num0(poolY + poolN) + ' OSTG total';
    } else {
      if (ya) ya.textContent = 'Yes ' + yp + '% implied';
      if (na) na.textContent = 'No ' + (100 - yp) + '% implied';
      if (tot) tot.textContent = 'live odds';
    }
    var by = el('opmBuyY'), bn = el('opmBuyN');
    if (by) by.textContent = 'Buy Yes · ' + midYes + '¢';
    if (bn) bn.textContent = 'Buy No · ' + (100 - midYes) + '¢';
  }

  /* ================= DATA LOADERS ================= */
  function loadRound() {
    return fetch(API + '/btc/round', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (d) {
      if (!d || d.ok === false) return;
      var prevId = round && round.marketId;
      round = d;
      beat = Number(d.priceToBeat) || beat;
      if (Number(d.livePrice) > 0) { price = Number(d.livePrice); pushHist(price); }
      if (Number.isFinite(Number(d.yesPriceNumber))) midYes = Math.max(1, Math.min(99, Math.round(Number(d.yesPriceNumber) * 100)));
      // seed history from real round ticks once (or on round change)
      if (prevId !== d.marketId && Array.isArray(d.ticks) && d.ticks.length) {
        var pts = d.ticks.map(function (t) { return Number(t.p != null ? t.p : t.price); }).filter(function (x) { return x > 0; });
        if (pts.length) { pts.forEach(function (p) { pushHist(p); }); }
        // new round -> the old position no longer applies to this round
        myPos = null; renderPosition();
        refreshPosition(); loadTrades(); loadComments();
      }
      tween(el('opmNow'), price, usd, 700); tween(el('opmBeat'), beat, usd);
      applyDir(); draw(); paintOdds();
    }).catch(function () {});
  }

  function feedMarket() { return 'ost-btc5m'; } // the Bitcoin 5-min market (all rounds)

  function loadTrades() {
    return fetch(API + '/positions/recent?marketId=' + encodeURIComponent(feedMarket()) + '&limit=60', { cache: 'no-store' })
      .then(function (r) { return r.json(); }).then(function (d) {
        var arr = (d && d.recent) || [];
        renderTrades(arr);
        aggregateHolders(arr);
        aggregatePool(arr);
        paintOdds();
      }).catch(function () {});
  }

  function renderTrades(arr) {
    var host = el('opmTrades'); if (!host) return;
    if (!arr.length) { host.innerHTML = '<div class="opm-empty">No trades yet — be the first.</div>'; return; }
    host.innerHTML = arr.slice(0, 12).map(function (r) {
      var y = String(r.side || '').toUpperCase() === 'YES';
      var k = r.id || (r.wallet + r.ts);
      var isNew = !seenTrades[k]; seenTrades[k] = 1;
      var amt = Number(r.stake) > 0 ? compact(r.stake) + ' OSTG' : (Number(r.shares) > 0 ? compact(r.shares) + ' sh' : '');
      var px = Number(r.price) > 0 ? ' @ ' + Math.round(Number(r.price) * 100) + '¢' : '';
      var t = ago(r.ts || r.createdAt);
      return '<div class="opm-trade' + (isNew && !firstTrades ? ' in' : '') + '"><span class="s ' + (y ? 'y' : 'n') + '">' + (y ? 'Yes' : 'No') + '</span>' +
        '<span class="who">' + esc(r.walletShort || (String(r.wallet || '').slice(0, 4) + '…')) + '</span>' +
        '<span class="amt">' + esc(amt + px) + '</span>' +
        '<span class="t">' + esc(t) + '</span></div>';
    }).join('');
    firstTrades = false;
  }

  function aggregatePool(arr) {
    // real Yes/No stake totals from the recent feed (windowed but real)
    var y = 0, n = 0;
    arr.forEach(function (r) {
      var isSell = String(r.id || '').indexOf('sell:') === 0;
      var stake = Number(r.stake) || 0; if (isSell || !(stake > 0)) return;
      if (String(r.side || '').toUpperCase() === 'YES') y += stake; else n += stake;
    });
    poolY = Math.round(y); poolN = Math.round(n);
  }

  function aggregateHolders(arr) {
    var host = el('opmHolders'); if (!host) return;
    var by = {};
    arr.forEach(function (r) {
      var w = r.wallet; if (!w) return;
      var sh = Number(r.shares) || 0; if (!(sh > 0)) return;
      var isSell = String(r.id || '').indexOf('sell:') === 0;
      var y = String(r.side || '').toUpperCase() === 'YES';
      by[w] = by[w] || { w: w, short: r.walletShort || (String(w).slice(0, 4) + '…' + String(w).slice(-4)), net: 0, side: y ? 'y' : 'n' };
      by[w].net += (isSell ? -sh : sh);
      if (!isSell) by[w].side = y ? 'y' : 'n';
    });
    var list = Object.keys(by).map(function (k) { return by[k]; }).filter(function (h) { return h.net > 0.01; }).sort(function (a, b) { return b.net - a.net; }).slice(0, 8);
    if (!list.length) { host.innerHTML = '<div class="opm-empty">No holders yet.</div>'; return; }
    var max = list[0].net || 1;
    host.innerHTML = list.map(function (h, i) {
      var pct = Math.max(6, Math.round(h.net / max * 100));
      var col = h.side === 'n' ? 'linear-gradient(90deg,#e11d48,#fb7185)' : 'linear-gradient(90deg,#10b981,#34d399)';
      var c = h.side === 'n' ? 'var(--opm-no)' : 'var(--opm-yes)';
      return '<div class="opm-holder"><span class="rank">' + (i + 1) + '</span><span class="addr">' + esc(h.short) + '</span>' +
        '<span class="bar"><i style="width:' + pct + '%;background:' + col + '"></i></span>' +
        '<span class="sh" style="color:' + c + '">' + num0(h.net) + '</span></div>';
    }).join('');
  }

  function loadComments() {
    var mid = (round && round.marketId) || feedMarket();
    return fetch(API + '/predict/comments?marketId=' + encodeURIComponent(feedMarket()), { cache: 'no-store' })
      .then(function (r) { return r.json(); }).then(function (d) {
        var arr = (d && d.comments) || [];
        var host = el('opmComments'); if (!host) return;
        if (!arr.length) { host.innerHTML = '<div class="opm-empty">Be the first to comment.</div>'; return; }
        host.innerHTML = arr.slice().reverse().slice(0, 40).map(function (c) {
          var initials = String(c.handle || c.walletShort || '?').replace(/[^a-z0-9]/gi, '').slice(0, 2).toUpperCase() || '0X';
          return '<div class="opm-cmt"><div class="av">' + esc(initials) + '</div><div class="b"><div class="n">' + esc(c.handle || c.walletShort || 'anon') +
            '<span>' + ago(c.ts) + '</span></div><p>' + esc(c.text) + '</p></div></div>';
        }).join('');
      }).catch(function () {});
  }

  function postComment() {
    var inp = el('opmCmtIn'); if (!inp) return;
    var text = String(inp.value || '').trim(); if (!text) return;
    var wallet = walletAddr();
    if (!wallet) { toast('Connect a wallet to comment.'); return; }
    var mid = feedMarket();
    inp.value = ''; inp.disabled = true;
    fetch(API + '/predict/comments', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet: wallet, text: text, marketId: mid, handle: meshHandle() })
    }).then(function (r) { return r.json(); }).then(function (d) {
      inp.disabled = false;
      if (d && d.error === 'slow_down') { toast('Slow down a moment.'); return; }
      loadComments();
    }).catch(function () { inp.disabled = false; });
  }

  /* ================= BALANCE ================= */
  function refreshBalance() {
    try {
      if (window.OST_PLAY && OST_PLAY.refresh) OST_PLAY.refresh();
      var b = (window.OST_PLAY && OST_PLAY.balance && OST_PLAY.balance());
      var bal = el('opmBal'), balF = el('opmBalF');
      if (bal) bal.textContent = (b == null ? '—' : num0(b) + (b % 1 ? '' : ''));
      if (bal && b != null) bal.textContent = Number(b).toLocaleString(undefined, { maximumFractionDigits: 2 });
      if (balF) {
        var f = '';
        try { if (window.OST_CCY && OST_CCY.fiat && b != null) f = OST_CCY.fiat(b) || ''; } catch (_) {}
        balF.textContent = f;
      }
    } catch (_) {}
  }

  /* ================= YOUR POSITION ================= */
  function walletAddr() {
    try { return (window.OST_PREDICTION_API && OST_PREDICTION_API.walletAddress && OST_PREDICTION_API.walletAddress()) || ''; } catch (_) { return ''; }
  }
  function meshHandle() {
    try { if (window.OST_MESH_IDENTITY && OST_MESH_IDENTITY.handle) return OST_MESH_IDENTITY.handle; } catch (_) {}
    return '';
  }
  function ledgerOrders() {
    try { return (window.OST_PREDICTION_API && OST_PREDICTION_API.ledger && OST_PREDICTION_API.ledger()) || []; } catch (_) { return []; }
  }

  // Find the user's OPEN order for the current round + its real cash-out button.
  function refreshPosition() {
    var mid = round && round.marketId;
    var orders = ledgerOrders();
    var open = orders.filter(function (o) {
      if (!o || o.cashedOut) return false;
      var st = String(o.status || o.outcome || '').toLowerCase();
      if (st === 'won' || st === 'lost' || st === 'settled' || st === 'sold') return false;
      // match the current round (or any live btc5m round if id not stamped)
      var omid = String(o.marketId || '');
      return mid ? omid === mid : /^ost-btc5m-\d+$/.test(omid);
    });
    if (!open.length) { myPos = null; renderPosition(); return; }
    // most recent
    var o = open.sort(function (a, b) { return Number(b.ts || 0) - Number(a.ts || 0); })[0];
    var sig = o.signature || o.sig || o.id || '';
    var shares = Number(o.shares) || 0;
    var entry = Number(o.entry) || Number(o.price) || 0;
    var locked = (o.fundedBy === 'ostg-native') && round && Number(round.closeAt) > Date.now();
    // the real, proven cash-out button (rendered in the hidden ledger)
    var btn = sig ? document.querySelector('.prediction-cashout-btn[data-order-sig="' + (window.CSS && CSS.escape ? CSS.escape(sig) : sig) + '"]') : null;
    myPos = {
      order: o, sig: sig, side: (o.side === 'no' ? 'no' : 'yes'), shares: shares, entry: entry,
      locked: locked, sellBtn: btn, cashText: btn ? btn.textContent : ''
    };
    renderPosition();
  }

  function posValueNow() {
    if (!myPos) return 0;
    var c = myPos.side === 'yes' ? midYes : (100 - midYes);
    return myPos.shares * (c / 100);
  }
  function posCost() { return myPos ? myPos.shares * (myPos.entry || 0) : 0; }

  function renderPosition() {
    var wrap = el('opmPosWrap'); if (!wrap) return;
    if (!myPos) { wrap.innerHTML = ''; return; }
    var val = posValueNow(), cost = posCost(), pnl = val - cost, up = pnl >= 0;
    var pnlTxt = (up ? '+' : '−') + Math.abs(pnl).toFixed(2) + ' OSTG' + (cost > 0 ? ' (' + (up ? '+' : '−') + Math.abs(pnl / cost * 100).toFixed(0) + '%)' : '');
    var sideCls = myPos.side === 'yes' ? 'y' : 'n', sideLab = myPos.side === 'yes' ? 'Yes' : 'No';
    var action;
    if (myPos.locked) {
      action = '<div class="opm-locked">' + icon('lock') + ' Locked · settles automatically at round close</div>';
    } else if (myPos.sellBtn) {
      // read the REAL net the app computes onto its own button
      var net = (myPos.cashText.match(/([\d,]+\.?\d*)\s*$/) || [])[1] || val.toFixed(2);
      var isSettle = /settle|claim/i.test(myPos.cashText);
      action = '<div class="opm-pcbtns"><button class="addmore" id="opmAddMore">Add more</button>' +
        '<button class="sell" id="opmSellBtn">' + (isSettle ? 'Settle' : 'Sell') + ' · ' + esc(net) + ' OSTG</button></div>';
    } else {
      action = '<div class="opm-pcbtns"><button class="addmore" id="opmAddMore">Add more</button>' +
        '<button class="sell" id="opmSellBtn" disabled style="opacity:.6">Sell (loading…)</button></div>';
    }
    wrap.innerHTML =
      '<div class="opm-poscard">' +
        '<div class="pch">Your position <span class="side ' + sideCls + '">' + sideLab + '</span><span class="sp"></span>' +
          '<span class="pnl ' + (up ? 'up' : 'down') + '">' + esc(pnlTxt) + '</span></div>' +
        '<div class="opm-pcgrid">' +
          '<div class="opm-pcg"><div class="k">Shares</div><div class="v">' + myPos.shares.toFixed(2) + '</div></div>' +
          '<div class="opm-pcg"><div class="k">Avg entry</div><div class="v">' + Math.round((myPos.entry || 0) * 100) + '¢</div></div>' +
          '<div class="opm-pcg"><div class="k">Value now</div><div class="v">' + val.toFixed(2) + '</div></div>' +
        '</div>' + action +
      '</div>';
    var am = el('opmAddMore'); if (am) am.onclick = function () { openSheet('buy', myPos.side); };
    var sb = el('opmSellBtn'); if (sb && !sb.disabled) sb.onclick = doSell;
  }

  /* ================= BUY / SELL SHEET ================= */
  var amt = 25, mode = 'buy';
  function openSheet(m, s) { mode = m; if (s) side = s; syncYnSel(); paintTicket(); el('opmSheet').classList.add('open'); el('opmScrim').classList.add('open'); }
  function closeSheet() { el('opmSheet').classList.remove('open'); el('opmScrim').classList.remove('open'); }

  function buyTicket() {
    var c = side === 'yes' ? midYes : (100 - midYes);
    var shares = c > 0 ? amt / (c / 100) : 0;
    var win = shares, fee = Math.max(0, (win - amt) * 0.02), net = win - fee, roi = amt > 0 ? ((net - amt) / amt * 100) : 0;
    return '<h3>' + icon('ticket') + ' Buy</h3>' +
      '<div class="opm-tkout"><button class="y' + (side === 'yes' ? ' sel' : '') + '" data-t="yes"><span class="lab">Yes</span><span class="px">' + midYes + '¢</span></button>' +
      '<button class="n' + (side === 'no' ? ' sel' : '') + '" data-t="no"><span class="lab">No</span><span class="px">' + (100 - midYes) + '¢</span></button></div>' +
      '<div class="opm-amt"><input id="opmAmtIn" inputmode="decimal" value="' + amt + '"><span class="cur">OSTG</span></div>' +
      '<div class="opm-quick">' + [10, 25, 100, 'Max'].map(function (q) { return '<button data-q="' + String(q).toLowerCase() + '">' + q + '</button>'; }).join('') + '</div>' +
      '<div class="opm-src"><span class="l"><span class="d"></span> Personal OSTG</span></div>' +
      '<div class="opm-bd"><div class="opm-tl"><span class="k">Fill price</span><span class="v">' + c + '¢</span></div>' +
        '<div class="opm-tl"><span class="k">Shares</span><span class="v" id="opmShV">' + shares.toFixed(2) + '</span></div>' +
        '<div class="opm-tl"><span class="k">Fee (2% profit)</span><span class="v">' + fee.toFixed(2) + '</span></div>' +
        '<div class="opm-tl big"><span class="k">To win</span><span class="v">' + net.toFixed(2) + ' OSTG<span class="opm-roi">+' + roi.toFixed(0) + '%</span></span></div></div>' +
      '<button class="opm-confirm' + (side === 'no' ? ' no' : '') + '" id="opmCf">Buy ' + (side === 'yes' ? 'Yes' : 'No') + ' · ' + amt + ' OSTG</button>' +
      '<div class="opm-fine">' + icon('lock') + ' Settles from the on-chain price at close</div>';
  }

  function sellConfirmTicket() {
    var val = posValueNow();
    var net = (myPos && myPos.cashText.match(/([\d,]+\.?\d*)\s*$/) || [])[1] || val.toFixed(2);
    var isSettle = myPos && /settle|claim/i.test(myPos.cashText);
    return '<h3>' + icon('coin') + ' ' + (isSettle ? 'Settle position' : 'Sell your ' + (myPos.side === 'yes' ? 'Yes' : 'No') + ' position') + '</h3>' +
      '<div class="opm-fine" style="text-align:left;color:var(--opm-ink2)">' + (isSettle
        ? 'Claim your settled position. The amount is computed and paid by the server.'
        : 'Exit early — OST buys your shares back at the current price. You keep the move so far instead of waiting for settlement.') + '</div>' +
      '<div class="opm-bd"><div class="opm-tl"><span class="k">Shares</span><span class="v">' + (myPos ? myPos.shares.toFixed(2) : '0') + '</span></div>' +
        '<div class="opm-tl"><span class="k">' + (myPos && myPos.side === 'yes' ? 'Yes' : 'No') + ' price</span><span class="v">' + (myPos && myPos.side === 'yes' ? midYes : (100 - midYes)) + '¢</span></div>' +
        '<div class="opm-tl big"><span class="k">You receive</span><span class="v" style="color:var(--opm-gold)">' + esc(net) + ' OSTG</span></div></div>' +
      '<button class="opm-confirm sellc" id="opmCfSell">' + (isSettle ? 'Settle for ' : 'Sell for ') + esc(net) + ' OSTG</button>' +
      '<div class="opm-fine">' + icon('lock') + ' Proceeds return to your Play OSTG.</div>';
  }

  function paintTicket() {
    var t = el('opmTicket'); if (!t) return;
    if (mode === 'sell') {
      t.innerHTML = sellConfirmTicket();
      var cfs = el('opmCfSell'); if (cfs) cfs.onclick = confirmSell;
      return;
    }
    t.innerHTML = buyTicket();
    document.querySelectorAll('#opmTicket .opm-tkout button').forEach(function (b) { b.onclick = function () { side = b.getAttribute('data-t'); syncYnSel(); paintTicket(); }; });
    document.querySelectorAll('#opmTicket .opm-quick button').forEach(function (b) {
      b.onclick = function () { var q = b.getAttribute('data-q'); amt = q === 'max' ? maxBal() : (parseFloat(q) || amt); paintTicket(); };
    });
    var inp = el('opmAmtIn'); if (inp) inp.oninput = function () {
      amt = parseFloat(this.value) || 0;
      var c = side === 'yes' ? midYes : (100 - midYes), sh = c > 0 ? amt / (c / 100) : 0, net = sh - Math.max(0, (sh - amt) * .02);
      var v = document.querySelector('#opmTicket .opm-tl.big .v'); if (v) v.innerHTML = net.toFixed(2) + ' OSTG<span class="opm-roi">+' + (amt > 0 ? ((net - amt) / amt * 100) : 0).toFixed(0) + '%</span>';
      var s = el('opmShV'); if (s) s.textContent = sh.toFixed(2);
    };
    var cf = el('opmCf'); if (cf) cf.onclick = confirmBuy;
  }
  function maxBal() { try { var b = window.OST_PLAY && OST_PLAY.balance && OST_PLAY.balance(); return b > 0 ? Math.floor(b) : 25; } catch (_) { return 25; } }
  function syncYnSel() { document.querySelectorAll('#opmYn button').forEach(function (b) { b.classList.toggle('sel', b.getAttribute('data-s') === side); }); }

  function confirmBuy() {
    var cf = el('opmCf'); if (!cf || cf.disabled) return;
    var stake = amt;
    if (!(stake > 0)) { toast('Enter an amount.'); return; }
    if (!round || !round.marketId) { toast('Round not loaded — try again.'); return; }
    cf.disabled = true; cf.textContent = 'Placing…';
    Promise.resolve(window.OST_PREDICTION_API.placeBet({ marketId: round.marketId, side: side, stake: stake }))
      .then(function () {
        cf.textContent = '✓ Bought';
        setTimeout(function () { closeSheet(); refreshBalance(); refreshPosition(); loadTrades(); }, 700);
      })
      .catch(function (e) {
        cf.disabled = false; cf.textContent = 'Buy ' + (side === 'yes' ? 'Yes' : 'No') + ' · ' + amt + ' OSTG';
        toast((e && e.message) ? e.message : 'Could not place the bet.');
      });
  }

  function confirmSell() {
    if (!myPos) { closeSheet(); return; }
    var cfs = el('opmCfSell');
    // re-find the live button (ledger may have re-rendered)
    var btn = myPos.sellBtn && document.body.contains(myPos.sellBtn) ? myPos.sellBtn
      : document.querySelector('.prediction-cashout-btn[data-order-sig="' + (window.CSS && CSS.escape ? CSS.escape(myPos.sig) : myPos.sig) + '"]');
    if (!btn) { toast('Position is settling — try again in a moment.'); return; }
    if (cfs) { cfs.disabled = true; cfs.textContent = 'Processing…'; }
    try { btn.click(); } catch (_) {}
    // the real handler runs async; reflect the result shortly
    setTimeout(function () { closeSheet(); refreshBalance(); refreshPosition(); loadTrades(); }, 1400);
  }
  function doSell() { openSheet('sell'); }

  /* ================= TABS ================= */
  function wireTabs() {
    document.querySelectorAll('#opmSeg button').forEach(function (b) {
      b.onclick = function () {
        document.querySelectorAll('#opmSeg button').forEach(function (x) { x.classList.remove('on'); });
        b.classList.add('on');
        var p = b.getAttribute('data-p');
        document.querySelectorAll('#ostPredictMobile .opm-pane').forEach(function (pn) { pn.classList.toggle('on', pn.getAttribute('data-pane') === p); });
        if (p === 'comments') loadComments();
      };
    });
    document.querySelectorAll('#opmYn button').forEach(function (b) { b.onclick = function () { side = b.getAttribute('data-s'); syncYnSel(); }; });
    document.querySelectorAll('#opmBuyY,#opmBuyN,[data-open]').forEach(function (b) { b.onclick = function () { openSheet('buy', b.getAttribute('data-open')); }; });
    var scr = el('opmScrim'); if (scr) scr.onclick = closeSheet;
    document.querySelectorAll('#opmTf button').forEach(function (b) { b.onclick = function () { document.querySelectorAll('#opmTf button').forEach(function (z) { z.classList.remove('on'); }); b.classList.add('on'); hrs = +b.getAttribute('data-h'); draw(); }; });
    var mesh = el('opmMesh'); if (mesh) mesh.onclick = function () { try { if (window.OST_MESH && OST_MESH.open) OST_MESH.open(); } catch (_) {} };
    var cs = el('opmCmtSend'); if (cs) cs.onclick = postComment;
    var ci = el('opmCmtIn'); if (ci) ci.addEventListener('keydown', function (e) { if (e.key === 'Enter') postComment(); });
  }

  function toast(msg) {
    try { if (typeof window.toast === 'function') { window.toast('info', msg); return; } } catch (_) {}
    console.log('[predict]', msg);
  }

  /* ================= MOUNT ================= */
  function mount() {
    var panel = el('wallet-panel-predict');
    if (!panel || el('ostPredictMobile')) return true;
    var host = document.createElement('div');
    host.id = 'ostPredictMobile';
    host.innerHTML = template();
    panel.insertBefore(host, panel.firstChild);
    // Remove ALL old chrome: hide every other child of the predict panel (the old
    // board, the positions HUD, any other module's widgets). They stay in the DOM
    // (display:none) so the ledger + money paths they power keep working underneath
    // — this surface just drives them through the clean UI.
    // Old chrome (board, positions HUD, etc.) is hidden authoritatively by the
    // CSS rule `#wallet-panel-predict > :not(#ostPredictMobile){display:none!important}`
    // — no JS tug-of-war needed. They stay in the DOM so their money paths work.
    Array.prototype.forEach.call(panel.children, function (c) { if (c !== host) c.style.display = 'none'; });
    wireTabs(); syncYnSel();
    loadRound(); refreshBalance(); loadTrades(); loadComments(); refreshPosition();
    return true;
  }

  /* live price stream */
  window.addEventListener('ost:btc-spot', function (e) { var p = e && e.detail && Number(e.detail.price); if (p > 0) { price = p; pushHist(p); tween(el('opmNow'), price, usd, 700); applyDir(); draw(); } });
  window.addEventListener('ost:btc-market-updated', function (e) { try { var m = e.detail && e.detail.tick; if (m && Number(m.price) > 0) { price = Number(m.price); pushHist(price); tween(el('opmNow'), price, usd, 700); applyDir(); draw(); } } catch (_) {} });
  window.addEventListener('ost:prediction-order-recorded', function () { setTimeout(refreshPosition, 400); });
  window.addEventListener('ost:money:change', refreshBalance);
  window.addEventListener('ost:play:balance', refreshBalance);

  window.OST_PREDICT_MOBILE = { mount: mount, refresh: function () { loadRound(); refreshPosition(); } };

  function boot() {
    if (!mount()) { var n = 0; var iv = setInterval(function () { if (mount() || ++n > 40) clearInterval(iv); }, 500); }
    // countdown ticker
    setInterval(function () {
      if (!round) return;
      var cd = el('opmCd'); if (!cd) return;
      var left = Math.max(0, Math.floor((Number(round.closeAt) - Date.now()) / 1000));
      cd.textContent = Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0');
      if (left <= 0) { loadRound(); }
    }, 1000);
    setInterval(loadRound, 5000);
    setInterval(function () { if (!document.hidden) { loadTrades(); refreshPosition(); } }, 11000);
    setInterval(refreshBalance, 30000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();

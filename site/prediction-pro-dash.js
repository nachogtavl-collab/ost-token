/* ==========================================================================
   OST Prediction PRO Dashboard
   --------------------------------------------------------------------------
   A modern, modular command-center mounted ABOVE the existing prediction
   market grid. Surfaces every feature added in v75:

     * Live 5-min BTC OST native market tile (countdown, current/open price,
       projected payout, one-click YES/NO bet via window.OST_PREDICTION_API)
     * Polymarket relay status (configured, healthy, edge POP)
     * Bot/arbitrage public API panel (copy snippets, doc links)
     * Scalar / date market quick-browse strip
     * Auto-refresh every 1s with cancellable rAF — designed for stronger
       computing power: no per-tick layout thrash, all DOM updates batched.

   Decoupled from app.js: works even if the legacy pipeline is broken,
   degrades gracefully when offline / when Polymarket / Coinbase are slow.
   ========================================================================== */
(function () {
  'use strict';

  if (window.__OST_PRO_DASH_LOADED) return;
  window.__OST_PRO_DASH_LOADED = true;

  var FIVE_MIN_MS = 5 * 60 * 1000;
  var BTC_PRICE_URL = 'https://api.coinbase.com/v2/prices/BTC-USD/spot';
  var BTC_HISTORY_URL = 'https://api.coinbase.com/v2/prices/BTC-USD/historic?period=hour';
  var ROUND_KEY = 'ost.prediction.btc5m.rounds.v1';
  var ORDERS_KEY = 'ost.prediction.orders.v1';

  var state = {
    btcPrice: 0,
    btcPrev: 0,
    btcSource: '',
    yesOdds: 0.5,
    noOdds: 0.5,
    btcUpdatedAt: 0,
    btcSeries: [],         // last ~150 ticks for sparkline
    relayUrl: null,
    relayHealth: null,
    relayEdge: null,
    apiAvailable: false,
    rounds: {},
    orders: [],
    scalarMarkets: []
  };

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  function $(sel, root) { return (root || document).querySelector(sel); }
  function fmtTime(ms) {
    if (!ms || ms < 0) return '00:00';
    var s = Math.max(0, Math.floor(ms / 1000));
    var m = Math.floor(s / 60); s = s % 60;
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }
  function fmtUsd(n, dp) {
    if (!Number.isFinite(n)) return '—';
    return '$' + Number(n).toLocaleString(undefined, { minimumFractionDigits: dp || 2, maximumFractionDigits: dp || 2 });
  }
  function fmtCents(n) {
    if (!Number.isFinite(n)) return '—';
    return (n * 100).toFixed(1) + '¢';
  }
  function readJson(key, fallback) {
    try { var v = JSON.parse(localStorage.getItem(key) || 'null'); return v == null ? fallback : v; }
    catch (_) { return fallback; }
  }
  function currentRound() {
    var now = Date.now();
    var openAt = Math.floor(now / FIVE_MIN_MS) * FIVE_MIN_MS;
    return { openAt: openAt, closeAt: openAt + FIVE_MIN_MS, id: 'ost-btc5m-' + openAt };
  }

  // ---------------------------------------------------------------------------
  // Timeout-aware fetch helper (3 s hard abort)
  // ---------------------------------------------------------------------------
  function fetchTimeout(url, opts) {
    var ctrl = new AbortController();
    var tid = setTimeout(function () { ctrl.abort(); }, 3000);
    return fetch(url, Object.assign({ signal: ctrl.signal }, opts || {}))
      .then(function (r) { clearTimeout(tid); return r; })
      .catch(function (e) { clearTimeout(tid); throw e; });
  }

  function rememberBtcDashboardPrice(price) {
    var p = Number(price);
    if (!Number.isFinite(p) || p <= 0) return;
    var last = state.btcSeries[state.btcSeries.length - 1];
    if (last === p) return;
    state.btcSeries.push(p);
    if (state.btcSeries.length > 150) state.btcSeries.shift();
  }

  // ---------------------------------------------------------------------------
  // Data fetchers
  // ---------------------------------------------------------------------------
  function refreshBtc() {
    if (window.OST_PREDICTION_API && typeof window.OST_PREDICTION_API.btcSpot === 'function') {
      return window.OST_PREDICTION_API.btcSpot({ force: true })
        .then(function (tick) {
          var p = tick && Number(tick.price);
          if (!Number.isFinite(p) || p <= 0) return;
          state.btcPrev = state.btcPrice || p;
          state.btcPrice = p;
          state.btcSource = tick.source || state.btcSource || '';
          state.btcUpdatedAt = tick.ts || Date.now();
          rememberBtcDashboardPrice(p);
        })
        .catch(function () { /* keep last value */ });
    }
    // Public CORS-safe feeds only. The optional OST edge worker /btc/price
    // endpoint isn't deployed yet — calling it spams the console with 404s.
    var feeds = [
      { url: BTC_PRICE_URL, pick: function (j) { return j && j.data && Number(j.data.amount); } },
      { url: 'https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT', pick: function (j) { return j && Number(j.price); } }
    ];
    var racePromises = feeds.map(function (f) {
      return fetchTimeout(f.url, { headers: { accept: 'application/json' } })
        .then(function (r) { return r.ok ? r.json() : Promise.reject(); })
        .then(function (j) {
          var p = f.pick(j);
          if (!Number.isFinite(p) || p <= 0) return Promise.reject();
          return p;
        });
    });
    var race = (Promise.any ? Promise.any(racePromises)
      : racePromises.reduce(function (ch, p) { return ch.catch(function () { return p; }); }, Promise.reject()));
    return race
      .then(function (p) {
        state.btcPrev = state.btcPrice || p;
        state.btcPrice = p;
        state.btcSource = 'direct';
        state.btcUpdatedAt = Date.now();
        rememberBtcDashboardPrice(p);
      })
      .catch(function () { /* all feeds failed — keep last value */ });
  }

  function refreshRelay() {
    state.relayUrl = (window.OST_POLY_RELAY_URL || '').replace(/\/$/, '') || null;
    if (!state.relayUrl) { state.relayHealth = 'not-configured'; state.relayEdge = null; return Promise.resolve(); }
    return fetchTimeout(state.relayUrl + '/health', { headers: { accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (j && j.ok) { state.relayHealth = 'live'; state.relayEdge = j.edge || null; }
        else { state.relayHealth = 'down'; state.relayEdge = null; }
      })
      .catch(function () { state.relayHealth = 'down'; state.relayEdge = null; });
  }

  function refreshLocalState() {
    state.rounds = readJson(ROUND_KEY, {});
    state.orders = readJson(ORDERS_KEY, []) || [];
    state.apiAvailable = !!window.OST_PREDICTION_API;
  }

  // ---------------------------------------------------------------------------
  // DOM scaffold
  // ---------------------------------------------------------------------------
  function buildScaffold() {
    var root = document.createElement('section');
    root.id = 'ost-pro-dash';
    root.className = 'ost-pro-dash';
    root.setAttribute('aria-label', 'OST Prediction Pro Dashboard');
    root.innerHTML = ''
      + '<div class="ost-pro-dash__grid">'
      +   '<article class="ost-pro-tile ost-pro-tile--btc" data-tile="btc">'
      +     '<header class="ost-pro-tile__head">'
      +       '<span class="ost-pro-pill ost-pro-pill--live">LIVE · 5-min round</span>'
      +       '<span class="ost-pro-tile__countdown" data-bind="countdown">--:--</span>'
      +     '</header>'
      +     '<div class="ost-pro-tile__body">'
      +       '<div class="ost-pro-btc-now">'
      +         '<span class="ost-pro-btc-now__label">BTC-USD spot</span>'
      +         '<span class="ost-pro-btc-now__price" data-bind="btcPrice">$—</span>'
      +         '<span class="ost-pro-btc-now__delta" data-bind="btcDelta">·</span>'
      +       '</div>'
      +       '<svg class="ost-pro-spark" data-bind="spark" viewBox="0 0 200 50" preserveAspectRatio="none"><polyline fill="none" stroke="currentColor" stroke-width="1.5" points=""/></svg>'
      +       '<div class="ost-pro-odds">'
      +         '<span>UP <strong data-bind="yesOdds">50.0¢</strong></span>'
      +         '<span>DOWN <strong data-bind="noOdds">50.0¢</strong></span>'
      +       '</div>'
      +       '<dl class="ost-pro-tile__stats">'
      +         '<div><dt>Round opens</dt><dd data-bind="openAt">—</dd></div>'
      +         '<div><dt>Open price</dt><dd data-bind="openPrice">—</dd></div>'
      +         '<div><dt>Feed</dt><dd data-bind="btcSource">—</dd></div>'
      +         '<div><dt>You staked</dt><dd data-bind="userStake">—</dd></div>'
      +       '</dl>'
      +     '</div>'
      +     '<footer class="ost-pro-tile__foot">'
      +       '<button type="button" class="ost-pro-bet ost-pro-bet--yes" data-bet="YES">Bet UP · 50.0¢</button>'
      +       '<button type="button" class="ost-pro-bet ost-pro-bet--no"  data-bet="NO">Bet DOWN · 50.0¢</button>'
      +     '</footer>'
      +     '<div class="ost-pro-bet-row">'
      +       '<label>Stake (OST)<input type="number" min="0.01" step="0.01" value="1" data-bind="stake"></label>'
      +       '<output class="ost-pro-bet-row__projected" data-bind="projected">Win 2.00 OST · risk 1.00 OST</output>'
      +     '</div>'
      +   '</article>'

      +   '<article class="ost-pro-tile ost-pro-tile--relay" data-tile="relay">'
      +     '<header class="ost-pro-tile__head">'
      +       '<span class="ost-pro-pill" data-bind="relayPill">RELAY</span>'
      +       '<span class="ost-pro-tile__sub">Polymarket edge proxy</span>'
      +     '</header>'
      +     '<div class="ost-pro-tile__body">'
      +       '<p class="ost-pro-relay__url" data-bind="relayUrl">No relay configured</p>'
      +       '<dl class="ost-pro-tile__stats">'
      +         '<div><dt>Status</dt><dd data-bind="relayStatus">—</dd></div>'
      +         '<div><dt>Edge POP</dt><dd data-bind="relayEdge">—</dd></div>'
      +         '<div><dt>Routes</dt><dd>Gamma · CLOB · Data</dd></div>'
      +       '</dl>'
      +       '<details class="ost-pro-relay__how">'
      +         '<summary>How to enable</summary>'
      +         '<ol>'
      +           '<li>Deploy <code>workers/polymarket-relay</code> with <code>wrangler deploy</code>.</li>'
      +           '<li>Add <code>&lt;script&gt;window.OST_POLY_RELAY_URL = "https://&lt;your-relay-origin&gt;"&lt;/script&gt;</code> to the page.</li>'
      +           '<li>Reload — every Polymarket fetch routes through Cloudflare\'s nearest PoP.</li>'
      +         '</ol>'
      +       '</details>'
      +     '</div>'
      +   '</article>'

      +   '<article class="ost-pro-tile ost-pro-tile--api" data-tile="api">'
      +     '<header class="ost-pro-tile__head">'
      +       '<span class="ost-pro-pill ost-pro-pill--api">BOT API</span>'
      +       '<span class="ost-pro-tile__sub">Public read + place</span>'
      +     '</header>'
      +     '<div class="ost-pro-tile__body">'
      +       '<p class="ost-pro-api__hint">Run from any page or browser console:</p>'
      +       '<pre class="ost-pro-api__snippet"><code>const m = await OST_PREDICTION_API.markets();\nconst r = OST_PREDICTION_API.fiveMinRound();\nawait OST_PREDICTION_API.placeBet({\n  marketId: r.id || \'ost-btc5m\',\n  side: \'YES\',\n  stake: 1\n});</code></pre>'
      +       '<div class="ost-pro-api__actions">'
      +         '<button type="button" data-action="copy-snippet">Copy snippet</button>'
      +         '<button type="button" data-action="open-console">Open in console</button>'
      +       '</div>'
      +       '<dl class="ost-pro-tile__stats">'
      +         '<div><dt>API loaded</dt><dd data-bind="apiLoaded">—</dd></div>'
      +         '<div><dt>Open positions</dt><dd data-bind="openPositions">0</dd></div>'
      +         '<div><dt>Settled rounds</dt><dd data-bind="settledRounds">0</dd></div>'
      +       '</dl>'
      +     '</div>'
      +   '</article>'

      +   '<article class="ost-pro-tile ost-pro-tile--scalar" data-tile="scalar">'
      +     '<header class="ost-pro-tile__head">'
      +       '<span class="ost-pro-pill ost-pro-pill--scalar">SCALAR / DATE</span>'
      +       '<span class="ost-pro-tile__sub">Range & timeline markets</span>'
      +     '</header>'
      +     '<div class="ost-pro-tile__body">'
      +       '<p class="ost-pro-scalar__hint">Multi-outcome markets parsed into price ranges or date windows. Pick a bucket on any card below to bet on that range.</p>'
      +       '<ul class="ost-pro-scalar__list" data-bind="scalarList"><li class="ost-pro-scalar__empty">Loading…</li></ul>'
      +     '</div>'
      +   '</article>'
      + '</div>'
      + '<div class="ost-pro-dash__toast" data-bind="toast" hidden></div>';
    return root;
  }

  function mountScaffold() {
    var anchor = document.getElementById('predictionMarketList');
    if (!anchor) return null;
    var existing = document.getElementById('ost-pro-dash');
    if (existing) return existing;
    var root = buildScaffold();
    anchor.parentNode.insertBefore(root, anchor);
    return root;
  }

  // ---------------------------------------------------------------------------
  // Render — pure functions of state, no layout thrash
  // ---------------------------------------------------------------------------
  function paintBtc(root) {
    var rd = currentRound();
    var apiRound = null;
    try {
      if (window.OST_PREDICTION_API && typeof window.OST_PREDICTION_API.fiveMinRound === 'function') apiRound = window.OST_PREDICTION_API.fiveMinRound();
    } catch (_) { apiRound = null; }
    if (apiRound && apiRound.openAt) rd = { openAt: apiRound.openAt, closeAt: apiRound.closeAt, id: apiRound.id || ('ost-btc5m-' + apiRound.openAt) };
    var rec = Object.assign({}, state.rounds[String(rd.openAt)] || {}, apiRound || {});
    var openPrice = Number(rec.openPrice) || state.btcPrice;
    var msLeft = rd.closeAt - Date.now();
    var yesOdds = Number(rec.yesPriceNumber);
    var noOdds = Number(rec.noPriceNumber);
    if (!Number.isFinite(yesOdds)) yesOdds = 0.5;
    if (!Number.isFinite(noOdds)) noOdds = 1 - yesOdds;
    state.yesOdds = yesOdds;
    state.noOdds = noOdds;

    setText(root, 'countdown', fmtTime(msLeft));
    setText(root, 'btcPrice', fmtUsd(state.btcPrice));
    var deltaEl = root.querySelector('[data-bind="btcDelta"]');
    if (deltaEl && state.btcPrice && openPrice) {
      var d = state.btcPrice - openPrice;
      var pct = (d / openPrice) * 100;
      deltaEl.textContent = (d >= 0 ? '▲ +' : '▼ ') + fmtUsd(d) + '  (' + pct.toFixed(2) + '%)';
      deltaEl.classList.toggle('is-up',   d >= 0);
      deltaEl.classList.toggle('is-down', d <  0);
    }
    setText(root, 'openAt',    new Date(rd.openAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    setText(root, 'openPrice', openPrice ? fmtUsd(openPrice) : '—');
    setText(root, 'btcSource', (rec.source || state.btcSource || 'direct').toString().toUpperCase());
    setText(root, 'yesOdds', fmtCents(yesOdds));
    setText(root, 'noOdds', fmtCents(noOdds));
    var yesBtn = root.querySelector('[data-bet="YES"]');
    var noBtn = root.querySelector('[data-bet="NO"]');
    if (yesBtn) yesBtn.textContent = 'Bet UP · ' + fmtCents(yesOdds);
    if (noBtn) noBtn.textContent = 'Bet DOWN · ' + fmtCents(noOdds);

    var myStake = state.orders
      .filter(function (o) { return o.marketId && String(o.marketId).indexOf('ost-btc5m-' + rd.openAt) === 0; })
      .reduce(function (acc, o) { return acc + (Number(o.stake) || Number(o.amount) || 0); }, 0);
    setText(root, 'userStake', myStake > 0 ? (myStake.toFixed(2) + ' OST') : '0 OST');

    paintSpark(root);
    paintProjected(root);
  }

  function paintSpark(root) {
    var poly = root.querySelector('[data-bind="spark"] polyline');
    if (!poly || state.btcSeries.length < 2) return;
    var s = state.btcSeries;
    var min = Math.min.apply(null, s), max = Math.max.apply(null, s);
    var naturalRange = max - min;
    var latest = s[s.length - 1] || state.btcPrice || 1;
    var range = Math.max(naturalRange, Math.abs(latest) * 0.0012, 1);
    if (range > naturalRange) {
      var center = naturalRange > 0 ? (min + max) / 2 : latest;
      min = center - range / 2;
      max = center + range / 2;
    }
    var w = 200, h = 50;
    var step = w / (s.length - 1);
    var pts = s.map(function (p, i) {
      var y = h - ((p - min) / range) * h;
      return (i * step).toFixed(1) + ',' + y.toFixed(1);
    }).join(' ');
    poly.setAttribute('points', pts);
    poly.setAttribute('stroke', state.btcPrice >= state.btcPrev ? '#7ce6a8' : '#ff7c8a');
  }

  function paintRelay(root) {
    var pill = root.querySelector('[data-bind="relayPill"]');
    var status = state.relayHealth;
    if (pill) {
      pill.classList.remove('ost-pro-pill--live', 'ost-pro-pill--warn', 'ost-pro-pill--off');
      if (status === 'live')   { pill.classList.add('ost-pro-pill--live'); pill.textContent = 'RELAY · LIVE'; }
      else if (status === 'down') { pill.classList.add('ost-pro-pill--warn'); pill.textContent = 'RELAY · DOWN'; }
      else                      { pill.classList.add('ost-pro-pill--off');  pill.textContent = 'RELAY · OFF'; }
    }
    setText(root, 'relayUrl', state.relayUrl || 'No relay configured — falling back to direct Polymarket APIs');
    setText(root, 'relayStatus', status || '—');
    setText(root, 'relayEdge', state.relayEdge || '—');
  }

  function paintApi(root) {
    setText(root, 'apiLoaded', state.apiAvailable ? 'yes (window.OST_PREDICTION_API)' : 'no');
    var open = state.orders.filter(function (o) { return o.status === 'open' || !o.status; }).length;
    setText(root, 'openPositions', String(open));
    var settled = Object.keys(state.rounds || {}).filter(function (k) { return state.rounds[k].closePrice; }).length;
    setText(root, 'settledRounds', String(settled));
  }

  function paintScalar(root) {
    var ul = root.querySelector('[data-bind="scalarList"]');
    if (!ul) return;
    var items = state.scalarMarkets.slice(0, 5);
    if (!items.length) {
      ul.innerHTML = '<li class="ost-pro-scalar__empty">No scalar/date markets in the latest feed snapshot. They are surfaced automatically when Polymarket exposes a multi-outcome event with numeric or date bucket labels.</li>';
      return;
    }
    ul.innerHTML = items.map(function (m) {
      var b0 = (m.outcomeBuckets && m.outcomeBuckets[0]) || {};
      var bN = (m.outcomeBuckets && m.outcomeBuckets[m.outcomeBuckets.length - 1]) || {};
      return '<li class="ost-pro-scalar__row">'
           +   '<div class="ost-pro-scalar__title">' + escapeHtml(m.title || 'Untitled') + '</div>'
           +   '<div class="ost-pro-scalar__meta"><span class="ost-pro-pill ost-pro-pill--scalar">' + (m.marketType || 'scalar').toUpperCase() + '</span> · '
           +     (m.outcomeBuckets ? m.outcomeBuckets.length : 0) + ' buckets · '
           +     escapeHtml((b0.label || '') + ' … ' + (bN.label || ''))
           +   '</div>'
           + '</li>';
    }).join('');
  }

  function escapeHtml(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]); }); }
  function setText(root, key, val) {
    var el = root.querySelector('[data-bind="' + key + '"]');
    if (el) el.textContent = val;
  }
  function paintProjected(root) {
    var stakeEl = root.querySelector('[data-bind="stake"]');
    var out = root.querySelector('[data-bind="projected"]');
    if (!stakeEl || !out) return;
    var s = Math.max(0, parseFloat(stakeEl.value) || 0);
    var yes = Number.isFinite(state.yesOdds) && state.yesOdds > 0 ? state.yesOdds : 0.5;
    out.textContent = 'UP wins ' + (s / yes).toFixed(2) + ' OST · risk ' + s.toFixed(2) + ' OST · @ ' + fmtCents(yes);
  }

  // ---------------------------------------------------------------------------
  // Interactions
  // ---------------------------------------------------------------------------
  function showToast(root, msg, kind) {
    var t = root.querySelector('[data-bind="toast"]');
    if (!t) return;
    t.textContent = msg;
    t.hidden = false;
    t.classList.remove('is-ok', 'is-err'); t.classList.add(kind === 'err' ? 'is-err' : 'is-ok');
    clearTimeout(t._timer);
    t._timer = setTimeout(function () { t.hidden = true; }, 4500);
  }

  function placeBet(root, side) {
    var rd = currentRound();
    var rec = state.rounds[String(rd.openAt)] || {};
    try {
      if (window.OST_PREDICTION_API && typeof window.OST_PREDICTION_API.fiveMinRound === 'function') {
        rec = Object.assign({}, rec, window.OST_PREDICTION_API.fiveMinRound() || {});
        if (rec.openAt) rd = { openAt: rec.openAt, closeAt: rec.closeAt, id: rec.id || ('ost-btc5m-' + rec.openAt) };
      }
    } catch (_) {}
    var yesOdds = Number(rec.yesPriceNumber);
    var noOdds = Number(rec.noPriceNumber);
    if (!Number.isFinite(yesOdds)) yesOdds = Number.isFinite(state.yesOdds) ? state.yesOdds : 0.5;
    if (!Number.isFinite(noOdds)) noOdds = Number.isFinite(state.noOdds) ? state.noOdds : 1 - yesOdds;
    // Open the unified market modal (preferred UX) — the user gets full
    // context: live BTC, countdown, depth, ticks, bet panel.
    if (window.OST_MARKET_MODAL && typeof window.OST_MARKET_MODAL.open === 'function') {
      // Build a synthetic OST native market record so the modal can render
      // even if the card hasn't been injected into the list yet.
      window.OST_MARKET_MODAL.open({
        id: rd.id,
        title: '5-min BTC: will price be UP at ' + new Date(rd.closeAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + '?',
        detail: 'Native OST market. Settles automatically every 5 minutes from the shared BTC-USD exchange feed.',
        sourceLabel: 'OST 5-min BTC',
        source: 'ost',
        yesLabel: 'YES (UP)', noLabel: 'NO (DOWN/SAME)',
        yesPriceNumber: yesOdds, noPriceNumber: noOdds,
        closeText: 'Closes ' + new Date(rd.closeAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        contractLabel: 'OST native · 5-min round',
        primaryUrl: 'https://www.coinbase.com/price/bitcoin',
        primaryLabel: 'Open Coinbase',
        isOstNative: true,
        meta: { kind: 'btc5m', openAt: rd.openAt, closeAt: rd.closeAt, openPrice: rec.openPrice || state.btcPrice, livePrice: state.btcPrice, yesPriceNumber: yesOdds, noPriceNumber: noOdds, priceSource: rec.source || state.btcSource || '' }
      });
      // Pre-select the side the user clicked
      setTimeout(function () {
        var modal = document.getElementById('ost-market-modal');
        if (!modal) return;
        var btn = modal.querySelector('.ost-modal__side-btn[data-side="' + side + '"]');
        if (btn) btn.click();
      }, 50);
      return;
    }
    showToast(root, 'Market modal not loaded — refresh the page.', 'err');
  }

  function copySnippet(root) {
    var pre = root.querySelector('.ost-pro-api__snippet code');
    if (!pre) return;
    var text = pre.textContent;
    var done = function (ok) { showToast(root, ok ? '📋 Snippet copied. Paste it into the browser console.' : '⚠️ Copy blocked.', ok ? 'ok' : 'err'); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(false); });
    } else { done(false); }
  }

  function bindEvents(root) {
    // Clicking anywhere on the BTC tile (except the bet buttons / input)
    // opens the unified market modal.
    var btcTile = root.querySelector('[data-tile="btc"]');
    if (btcTile) {
      btcTile.addEventListener('click', function (ev) {
        if (ev.target.closest('[data-bet], input, label, button')) return;
        placeBet(root, 'YES'); // opens modal; user picks side inside
      });
      btcTile.style.cursor = 'pointer';
    }
    root.addEventListener('click', function (ev) {
      var bet = ev.target.closest('[data-bet]');
      if (bet) { ev.stopPropagation(); placeBet(root, bet.getAttribute('data-bet')); return; }
      var act = ev.target.closest('[data-action]');
      if (!act) return;
      if (act.getAttribute('data-action') === 'copy-snippet') copySnippet(root);
      else if (act.getAttribute('data-action') === 'open-console') {
        if (window.OST_CONSOLE) window.OST_CONSOLE.open();
        else showToast(root, 'API console loading — try again in a moment.', 'ok');
      }
    });
    root.addEventListener('input', function (ev) {
      if (ev.target && ev.target.matches && ev.target.matches('[data-bind="stake"]')) paintProjected(root);
    });
  }

  // ---------------------------------------------------------------------------
  // Scalar discovery — pulls from app.js's loaded state if possible, plus
  // window.OST_PREDICTION_API.markets() as a fallback. Filters via the
  // scalar normalizer in prediction-scalar.js.
  // ---------------------------------------------------------------------------
  function discoverScalarMarkets() {
    var found = [];
    function pushIfScalar(raw) {
      if (!raw || !window.OST_PREDICTION_SCALAR) return;
      var n = window.OST_PREDICTION_SCALAR.normalizeMarket(raw);
      if (n && (n.marketType === 'scalar' || n.marketType === 'date') && n.outcomeBuckets && n.outcomeBuckets.length >= 2) {
        found.push(n);
      }
    }
    // Cheap: scan app.js's exposed market list if available
    try {
      var scope = window.__predictionState || null;
      if (scope && Array.isArray(scope.markets)) scope.markets.forEach(pushIfScalar);
    } catch (_) { /* ignore */ }
    // Authoritative: query the bot API
    if (!found.length && window.OST_PREDICTION_API && typeof window.OST_PREDICTION_API.markets === 'function') {
      return window.OST_PREDICTION_API.markets().then(function (snap) {
        (snap && snap.polymarket || []).forEach(pushIfScalar);
        state.scalarMarkets = found;
      }).catch(function () { state.scalarMarkets = found; });
    }
    state.scalarMarkets = found;
    return Promise.resolve();
  }

  // ---------------------------------------------------------------------------
  // Boot loop
  // ---------------------------------------------------------------------------
  function boot() {
    if (!document.getElementById('predictionMarketBoard')) { setTimeout(boot, 400); return; }
    var root = mountScaffold();
    if (!root) { setTimeout(boot, 400); return; }
    bindEvents(root);
    paintProjected(root);

    refreshLocalState();
    refreshBtc().then(function () {
      paintBtc(root); paintApi(root); paintRelay(root);
    });
    refreshRelay().then(function () { paintRelay(root); });
    discoverScalarMarkets().then(function () { paintScalar(root); });

    // 1Hz UI tick (countdown, stats, projections)
    setInterval(function () {
      refreshLocalState();
      paintBtc(root); paintApi(root);
    }, 1000);
    // 15s BTC price tick — keeps the dashboard fresh without flooding
    // public exchange APIs or the console with rate-limit errors.
    setInterval(function () {
      refreshBtc().then(function () { paintBtc(root); });
    }, 15000);
    // 30s relay health tick
    setInterval(function () { refreshRelay().then(function () { paintRelay(root); }); }, 30000);
    // 60s scalar discovery
    setInterval(function () { discoverScalarMarkets().then(function () { paintScalar(root); }); }, 60000);

    // Refresh whenever the app fires any prediction event
    ['ost:prediction-rounds-settled', 'ost:prediction-order-recorded', 'ost:wallet-changed'].forEach(function (evt) {
      window.addEventListener(evt, function () { refreshLocalState(); paintBtc(root); paintApi(root); });
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();

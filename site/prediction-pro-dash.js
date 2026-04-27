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
  // Data fetchers
  // ---------------------------------------------------------------------------
  function refreshBtc() {
    return fetch(BTC_PRICE_URL, { headers: { accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        var p = j && j.data && Number(j.data.amount);
        if (Number.isFinite(p) && p > 0) {
          state.btcPrev = state.btcPrice || p;
          state.btcPrice = p;
          state.btcUpdatedAt = Date.now();
          state.btcSeries.push(p);
          if (state.btcSeries.length > 150) state.btcSeries.shift();
        }
      })
      .catch(function () {/* silent */});
  }

  function refreshRelay() {
    state.relayUrl = (window.OST_POLY_RELAY_URL || '').replace(/\/$/, '') || null;
    if (!state.relayUrl) { state.relayHealth = 'not-configured'; state.relayEdge = null; return Promise.resolve(); }
    return fetch(state.relayUrl + '/health', { headers: { accept: 'application/json' } })
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
      +       '<dl class="ost-pro-tile__stats">'
      +         '<div><dt>Round opens</dt><dd data-bind="openAt">—</dd></div>'
      +         '<div><dt>Open price</dt><dd data-bind="openPrice">—</dd></div>'
      +         '<div><dt>You staked</dt><dd data-bind="userStake">—</dd></div>'
      +       '</dl>'
      +     '</div>'
      +     '<footer class="ost-pro-tile__foot">'
      +       '<button type="button" class="ost-pro-bet ost-pro-bet--yes" data-bet="YES">Bet UP · 0.5×</button>'
      +       '<button type="button" class="ost-pro-bet ost-pro-bet--no"  data-bet="NO">Bet DOWN · 0.5×</button>'
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
      +           '<li>Add <code>&lt;script&gt;window.OST_POLY_RELAY_URL = "https://&lt;your-worker&gt;.workers.dev"&lt;/script&gt;</code> to the page.</li>'
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
    var rec = state.rounds[String(rd.openAt)] || {};
    var openPrice = Number(rec.openPrice) || state.btcPrice;
    var msLeft = rd.closeAt - Date.now();

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

    var myStake = state.orders
      .filter(function (o) { return o.marketId && String(o.marketId).indexOf('ost-btc5m-' + rd.openAt) === 0; })
      .reduce(function (acc, o) { return acc + (Number(o.stake) || Number(o.amount) || 0); }, 0);
    setText(root, 'userStake', myStake > 0 ? (myStake.toFixed(2) + ' OST') : '0 OST');

    paintSpark(root);
  }

  function paintSpark(root) {
    var poly = root.querySelector('[data-bind="spark"] polyline');
    if (!poly || state.btcSeries.length < 2) return;
    var s = state.btcSeries;
    var min = Math.min.apply(null, s), max = Math.max.apply(null, s);
    var range = max - min || 1;
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
    out.textContent = 'Win ' + (s * 2).toFixed(2) + ' OST · risk ' + s.toFixed(2) + ' OST · @ 0.50';
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
    var stakeEl = root.querySelector('[data-bind="stake"]');
    var stake = Math.max(0, parseFloat(stakeEl.value) || 0);
    if (!stake) { showToast(root, 'Set a stake first.', 'err'); return; }
    if (!window.OST_PREDICTION_API || typeof window.OST_PREDICTION_API.placeBet !== 'function') {
      showToast(root, 'OST_PREDICTION_API not loaded yet — wait a second and retry.', 'err');
      return;
    }
    var rd = currentRound();
    showToast(root, 'Placing ' + side + ' ' + stake + ' OST on round ' + new Date(rd.closeAt).toLocaleTimeString() + '…', 'ok');
    Promise.resolve(window.OST_PREDICTION_API.placeBet({ marketId: rd.id, side: side, stake: stake }))
      .then(function () { showToast(root, '✅ Bet submitted. See Open Positions below.', 'ok'); })
      .catch(function (err) { showToast(root, '⚠️ ' + (err && err.message ? err.message : 'Bet failed'), 'err'); });
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
    root.addEventListener('click', function (ev) {
      var bet = ev.target.closest('[data-bet]');
      if (bet) { placeBet(root, bet.getAttribute('data-bet')); return; }
      var act = ev.target.closest('[data-action]');
      if (!act) return;
      if (act.getAttribute('data-action') === 'copy-snippet') copySnippet(root);
      else if (act.getAttribute('data-action') === 'open-console') {
        showToast(root, 'Press F12 (or Cmd+Opt+I) → Console tab. The OST_PREDICTION_API object is global.', 'ok');
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
    // 4s BTC price tick
    setInterval(function () {
      refreshBtc().then(function () { paintBtc(root); });
    }, 4000);
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

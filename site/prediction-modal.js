/* ==========================================================================
   OST Prediction — Unified Market Modal
   --------------------------------------------------------------------------
   ONE modal that handles every market: Polymarket binary, Polymarket scalar,
   Kalshi, OST native 5-min BTC. Replaces the older mini-modal so popups no
   longer clip inside the wallet portal.

   * Mounted at <body> level with z-index 2147483647 → never trapped
     inside scrollable / transformed parents.
   * Click ANY .prediction-market-card opens it. Click the dashboard BTC
     tile opens it. Bet buttons inside open it. ESC / backdrop closes.
   * For Polymarket markets: pulls REAL data from the relay (or direct
     Polymarket APIs as fallback): orderbook depth, recent trades, price
     history. No more synthetic numbers.
   * For OST native 5-min BTC: live countdown + Coinbase spot tick.
   * Bet buttons certify the full path: select market in trade desk →
     set side → set stake → fire trade action. Success/failure shown
     inside the modal (not a clipped toast).
   ========================================================================== */
(function () {
  'use strict';
  if (window.__OST_MODAL_LOADED) return;
  window.__OST_MODAL_LOADED = true;

  var MODAL_ID = 'ost-market-modal';
  var FIVE_MIN_MS = 5 * 60 * 1000;
  var ROUND_KEY = 'ost.prediction.btc5m.rounds.v1';
  var ORDERS_KEY = 'ost.prediction.orders.v1';
  // BTC price feeds — try in order, all browser-CORS-safe.
  var BTC_PRICE_FEEDS = [
    {
      name: 'coinbase',
      url: 'https://api.coinbase.com/v2/prices/BTC-USD/spot',
      pick: function (j) { return j && j.data && Number(j.data.amount); }
    },
    {
      name: 'binance',
      url: 'https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT',
      pick: function (j) { return j && Number(j.price); }
    },
    {
      name: 'coingecko',
      url: 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd',
      pick: function (j) { return j && j.bitcoin && Number(j.bitcoin.usd); }
    },
    {
      name: 'kraken',
      url: 'https://api.kraken.com/0/public/Ticker?pair=XBTUSD',
      pick: function (j) {
        try { var k = Object.keys(j.result || {})[0]; return Number(j.result[k].c[0]); } catch (_) { return null; }
      }
    }
  ];
  var BTC_FEED_INDEX = 0;

  // Track timers for the currently-open modal so we can stop them on close.
  var liveTimers = [];

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------
  function relayBase() {
    var v = (typeof window !== 'undefined' && window.OST_POLY_RELAY_URL) || '';
    return v ? String(v).replace(/\/$/, '') : '';
  }
  function pmGamma(path, query) {
    var b = relayBase();
    if (b) return b + '/gamma' + path + (query ? ('?' + query) : '');
    return 'https://gamma-api.polymarket.com' + path + (query ? ('?' + query) : '');
  }
  function pmClob(path, query) {
    var b = relayBase();
    if (b) return b + '/clob' + path + (query ? ('?' + query) : '');
    return 'https://clob.polymarket.com' + path + (query ? ('?' + query) : '');
  }
  function pmData(path, query) {
    var b = relayBase();
    if (b) return b + '/data' + path + (query ? ('?' + query) : '');
    return 'https://data-api.polymarket.com' + path + (query ? ('?' + query) : '');
  }

  function readJson(key, fallback) {
    try { var v = JSON.parse(localStorage.getItem(key) || 'null'); return v == null ? fallback : v; }
    catch (_) { return fallback; }
  }

  // ----- Timeout-aware, CORS-resilient fetch ----------------------------------
  // Each attempt gets a hard 4 s abort budget so a stalled CORS proxy can
  // never block the next refresh tick.
  var CORS_PROXIES = [
    'https://corsproxy.io/?url=',
    'https://api.allorigins.win/raw?url='
  ];
  var FETCH_TIMEOUT_MS = 4000;
  function fetchWithTimeout(url, opts) {
    var ctrl = new AbortController();
    var tid = setTimeout(function () { ctrl.abort(); }, FETCH_TIMEOUT_MS);
    return fetch(url, Object.assign({ signal: ctrl.signal }, opts))
      .then(function (r) { clearTimeout(tid); return r; })
      .catch(function (e) { clearTimeout(tid); throw e; });
  }
  function fetchJsonResilient(url) {
    var attempt = function (target) {
      return fetchWithTimeout(target, { headers: { accept: 'application/json' }, mode: 'cors' })
        .then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.json();
        });
    };
    return attempt(url)
      .catch(function () {
        return attempt(CORS_PROXIES[0] + encodeURIComponent(url));
      })
      .catch(function () {
        return attempt(CORS_PROXIES[1] + encodeURIComponent(url));
      })
      .catch(function (e) {
        console.warn('[ost-modal] fetch failed', url, e && e.message);
        return null;
      });
  }
  // Race all BTC feeds simultaneously — return whichever answers first.
  function fetchBtcRace() {
    var racePromises = BTC_PRICE_FEEDS.map(function (feed, i) {
      return fetchWithTimeout(feed.url, { headers: { accept: 'application/json' }, mode: 'cors' })
        .then(function (r) { return r.ok ? r.json() : Promise.reject(); })
        .then(function (j) {
          var p = feed.pick(j);
          if (!Number.isFinite(p) || p < 1000) return Promise.reject();
          BTC_FEED_INDEX = i;
          return p;
        });
    });
    return Promise.any
      ? Promise.any(racePromises)
      : racePromises.reduce(function (chain, p) { return chain.catch(function () { return p; }); }, Promise.reject());
  }
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];
    });
  }
  function fmtUsd(n, dp) {
    if (!Number.isFinite(n)) return '—';
    return '$' + Number(n).toLocaleString(undefined, { minimumFractionDigits: dp == null ? 2 : dp, maximumFractionDigits: dp == null ? 2 : dp });
  }
  function fmtCents(n) {
    if (!Number.isFinite(n)) return '—';
    return (n * 100).toFixed(1) + '¢';
  }
  function fmtTime(ts) {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }
  function clearLiveTimers() {
    liveTimers.forEach(function (t) { try { clearInterval(t); } catch (_) {} });
    liveTimers = [];
  }

  // --------------------------------------------------------------------------
  // DOM build
  // --------------------------------------------------------------------------
  function ensureModal() {
    var el = document.getElementById(MODAL_ID);
    if (el) return el;
    el = document.createElement('div');
    el.id = MODAL_ID;
    el.className = 'ost-modal';
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML =
      '<div class="ost-modal__backdrop" data-act="close"></div>' +
      '<div class="ost-modal__panel" role="dialog" aria-modal="true" aria-labelledby="ost-modal-title">' +
      '  <button class="ost-modal__close" aria-label="Close" data-act="close">×</button>' +
      '  <div class="ost-modal__body" data-bind="body"></div>' +
      '  <div class="ost-modal__toast" data-bind="toast" hidden></div>' +
      '</div>';
    document.body.appendChild(el);
    el.addEventListener('click', function (ev) {
      var t = ev.target.closest('[data-act]');
      if (t && t.getAttribute('data-act') === 'close') closeModal();
    });
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && el.classList.contains('is-open')) closeModal();
    });
    return el;
  }

  function openModal(html) {
    var el = ensureModal();
    var body = el.querySelector('[data-bind="body"]');
    if (body) body.innerHTML = html;
    el.classList.add('is-open');
    el.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    document.body.classList.add('ost-modal-open');
    try { window.dispatchEvent(new CustomEvent('ost-modal:open')); } catch (_) {}
  }

  function closeModal() {
    clearLiveTimers();
    var el = document.getElementById(MODAL_ID);
    if (!el) return;
    el.classList.remove('is-open');
    el.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    document.body.classList.remove('ost-modal-open');
    try { window.dispatchEvent(new CustomEvent('ost-modal:close')); } catch (_) {}
  }

  function toast(msg, kind) {
    var el = document.getElementById(MODAL_ID);
    if (!el) return;
    var t = el.querySelector('[data-bind="toast"]');
    if (!t) return;
    t.textContent = msg;
    t.hidden = false;
    t.classList.remove('is-ok', 'is-err');
    t.classList.add(kind === 'err' ? 'is-err' : 'is-ok');
    clearTimeout(t._timer);
    t._timer = setTimeout(function () { t.hidden = true; }, 5000);
  }

  // --------------------------------------------------------------------------
  // Market record discovery — pull the FULL market object from app.js's
  // rendered card. Falls back to whatever is exposed via window.__predictionState.
  // --------------------------------------------------------------------------
  function findMarket(id) {
    if (!id) return null;
    // 1) Authoritative — if app.js exposed state
    try {
      var st = window.__predictionState || (window.OST_PREDICTION_API && window.OST_PREDICTION_API._state);
      if (st && Array.isArray(st.markets)) {
        var m = st.markets.find(function (mk) { return mk && mk.id === id; });
        if (m) return m;
      }
    } catch (_) {}
    // 2) Reconstruct from DOM card
    var card = document.querySelector('[data-prediction-market-id="' + String(id).replace(/"/g, '\\"') + '"]');
    if (!card) return { id: id, title: id, sourceLabel: '', detail: '' };
    var txt = function (sel) { var n = card.querySelector(sel); return n ? n.textContent.trim() : ''; };
    var srcLabel = txt('.prediction-market-source');
    var yesValue = txt('.prediction-market-price strong');
    var noValueAll = card.querySelectorAll('.prediction-market-price strong');
    var noValue = noValueAll[1] ? noValueAll[1].textContent.trim() : '';
    var yes = parseFloat(yesValue) / 100; if (!Number.isFinite(yes)) yes = NaN;
    var no  = parseFloat(noValue) / 100; if (!Number.isFinite(no))  no  = NaN;
    var primary = card.querySelector('.prediction-market-link');
    var feed    = card.querySelector('.prediction-market-api-link');
    var rec = {
      id: id,
      title: txt('h5'),
      detail: txt('.prediction-market-copy p'),
      sourceLabel: srcLabel,
      source: srcLabel.toLowerCase(),
      yesLabel: 'YES', noLabel: 'NO',
      yesValue: yesValue, noValue: noValue,
      yesPriceNumber: yes, noPriceNumber: no,
      closeText: txt('.prediction-market-meta-row .prediction-market-metric:last-child strong'),
      contractLabel: txt('.prediction-market-contract'),
      primaryUrl: primary ? primary.href : '',
      primaryLabel: primary ? primary.textContent.trim() : 'Open',
      secondaryUrl: feed ? feed.href : '',
      secondaryLabel: feed ? feed.textContent.trim() : ''
    };
    if (id.indexOf('ost-btc5m-') === 0) {
      var openAt = parseInt(id.replace('ost-btc5m-', ''), 10);
      var rounds = readJson(ROUND_KEY, {});
      var rd = rounds[String(openAt)] || {};
      rec.isOstNative = true;
      rec.meta = { kind: 'btc5m', openAt: openAt, closeAt: openAt + FIVE_MIN_MS, openPrice: rd.openPrice || 0 };
    }
    return rec;
  }

  // --------------------------------------------------------------------------
  // Polymarket live data fetchers (uses relay if configured)
  // --------------------------------------------------------------------------
  function looksLikePolymarketId(market) {
    if (!market) return false;
    if (market.source === 'polymarket') return true;
    if (market.sourceLabel && /polymarket/i.test(market.sourceLabel)) return true;
    if (market.primaryUrl && /polymarket\.com/i.test(market.primaryUrl)) return true;
    return false;
  }
  function findPolymarketTokenId(market) {
    if (!market) return null;
    if (market.tokenId) return market.tokenId;
    if (market.clobTokenIds && market.clobTokenIds[0]) return market.clobTokenIds[0];
    if (market.raw) {
      try {
        var t = market.raw.clobTokenIds || market.raw.outcomeTokens;
        if (typeof t === 'string') t = JSON.parse(t);
        if (Array.isArray(t) && t[0]) return t[0];
      } catch (_) {}
    }
    return null;
  }
  function fetchPolyOrderbook(tokenId) {
    if (!tokenId) return Promise.resolve(null);
    return fetchJsonResilient(pmClob('/book', 'token_id=' + encodeURIComponent(tokenId)));
  }
  function fetchPolyTrades(marketId) {
    if (!marketId) return Promise.resolve(null);
    return fetchJsonResilient(pmClob('/trades', 'market=' + encodeURIComponent(marketId) + '&limit=20'));
  }
  function fetchPolyHistory(marketId) {
    if (!marketId) return Promise.resolve(null);
    return fetchJsonResilient(pmData('/prices-history', 'market=' + encodeURIComponent(marketId) + '&interval=1d&fidelity=10'));
  }
  // Gamma-api fallback — works from browsers (CORS-enabled), gives us
  // bestBid / bestAsk / lastTradePrice / volume24hr without needing CLOB.
  function fetchPolyGammaMarket(marketId) {
    if (!marketId) return Promise.resolve(null);
    return fetchJsonResilient(pmGamma('/markets/' + encodeURIComponent(marketId)));
  }

  // --------------------------------------------------------------------------
  // Chart drawing
  // --------------------------------------------------------------------------
  function drawSeries(canvas, points, color) {
    if (!canvas || !points || points.length < 2) return;
    var ctx = canvas.getContext('2d');
    var dpr = window.devicePixelRatio || 1;
    var w = canvas.clientWidth || 600;
    var h = canvas.clientHeight || 200;
    canvas.width = Math.floor(w * dpr); canvas.height = Math.floor(h * dpr);
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);
    var min = Math.min.apply(null, points), max = Math.max.apply(null, points);
    var range = Math.max(1e-9, max - min);
    // Grid
    ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 1;
    for (var i = 1; i < 4; i++) {
      var y = (i / 4) * h;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }
    // Fill
    var grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, color + '55'); grad.addColorStop(1, color + '00');
    ctx.fillStyle = grad;
    ctx.beginPath();
    points.forEach(function (p, i) {
      var x = (i / (points.length - 1)) * w;
      var py = h - ((p - min) / range) * (h - 8) - 4;
      if (i === 0) ctx.moveTo(x, py); else ctx.lineTo(x, py);
    });
    ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath(); ctx.fill();
    // Line
    ctx.strokeStyle = color; ctx.lineWidth = 2;
    ctx.beginPath();
    points.forEach(function (p, i) {
      var x = (i / (points.length - 1)) * w;
      var py = h - ((p - min) / range) * (h - 8) - 4;
      if (i === 0) ctx.moveTo(x, py); else ctx.lineTo(x, py);
    });
    ctx.stroke();
  }

  // --------------------------------------------------------------------------
  // Bet flow — drives the existing trade desk so OST cash actually moves
  // --------------------------------------------------------------------------
  function placeBetViaTradeDesk(market, side, stake) {
    return new Promise(function (resolve, reject) {
      // Select card → set side → set stake → click action
      var card = document.querySelector('[data-prediction-market-id="' + String(market.id).replace(/"/g, '\\"') + '"]');
      if (!card) return reject(new Error('Market card not in DOM. Refresh the markets list and try again.'));
      card.click();
      // app.js may need a microtask to render the trade desk for this market
      setTimeout(function () {
        var sideToggle = document.getElementById('predictionOutcomeToggle');
        if (sideToggle) {
          var sb = sideToggle.querySelector('button[data-prediction-side="' + side.toLowerCase() + '"]');
          if (sb) sb.click();
        }
        var stakeInput = document.getElementById('predictionStakeInput');
        if (stakeInput) {
          stakeInput.value = String(stake);
          stakeInput.dispatchEvent(new Event('input', { bubbles: true }));
          stakeInput.dispatchEvent(new Event('change', { bubbles: true }));
        }
        var actionBtn = document.getElementById('predictionTradeAction') ||
                        document.querySelector('[data-prediction-trade-action]');
        if (!actionBtn) return reject(new Error('Trade desk button not found.'));
        var prevLedger = readJson(ORDERS_KEY, []) || [];
        var prevLen = prevLedger.length;
        actionBtn.click();
        var deadline = Date.now() + 45000;
        var iv = setInterval(function () {
          var now = readJson(ORDERS_KEY, []) || [];
          if (now.length > prevLen) {
            clearInterval(iv);
            resolve(now[now.length - 1]);
            return;
          }
          if (Date.now() > deadline) {
            clearInterval(iv);
            // Don't fail loudly — the trade may have completed but not landed
            // in localStorage yet. Tell the user where to look.
            reject(new Error('Bet submitted — check the open positions list below for confirmation.'));
          }
        }, 600);
      }, 80);
    });
  }

  // --------------------------------------------------------------------------
  // Render market detail
  // --------------------------------------------------------------------------
  function renderHeaderBlock(m) {
    var tags = [];
    if (m.sourceLabel) tags.push('<span class="ost-modal__tag">' + escapeHtml(m.sourceLabel) + '</span>');
    if (m.contractLabel) tags.push('<span class="ost-modal__tag">' + escapeHtml(m.contractLabel) + '</span>');
    if (m.closeText) tags.push('<span class="ost-modal__tag ost-modal__tag--time">' + escapeHtml(m.closeText) + '</span>');
    return '<div class="ost-modal__tags">' + tags.join('') + '</div>' +
           '<h2 id="ost-modal-title" class="ost-modal__title">' + escapeHtml(m.title || 'Market') + '</h2>' +
           (m.detail ? '<p class="ost-modal__detail">' + escapeHtml(m.detail) + '</p>' : '');
  }

  function renderPricesBlock(m) {
    var yes = Number(m.yesPriceNumber);
    var no = Number(m.noPriceNumber);
    return '<div class="ost-modal__prices">' +
      '<div class="ost-modal__price ost-modal__price--yes"><span>' + escapeHtml(m.yesLabel || 'YES') + '</span><strong data-bind="yesPct">' + (Number.isFinite(yes) ? Math.round(yes * 100) + '%' : '—') + '</strong></div>' +
      '<div class="ost-modal__price ost-modal__price--no"><span>' + escapeHtml(m.noLabel || 'NO') + '</span><strong data-bind="noPct">' + (Number.isFinite(no) ? Math.round(no * 100) + '%' : '—') + '</strong></div>' +
    '</div>';
  }

  function renderBtcBlock(m) {
    if (!m.isOstNative || !m.meta || m.meta.kind !== 'btc5m') return '';
    return '<section class="ost-modal__btc">' +
      '<div class="ost-modal__btc-row"><span>5-min round</span><strong data-bind="btcCountdown">--:--</strong></div>' +
      '<div class="ost-modal__btc-row"><span>Open price</span><strong data-bind="btcOpen">' + (m.meta.openPrice ? fmtUsd(m.meta.openPrice) : '—') + '</strong></div>' +
      '<div class="ost-modal__btc-row"><span>Live BTC</span><strong data-bind="btcLive">—</strong></div>' +
      '<div class="ost-modal__btc-row"><span>Δ from open</span><strong data-bind="btcDelta">—</strong></div>' +
    '</section>';
  }

  function renderChartBlock() {
    return '<section class="ost-modal__chart">' +
      '<div class="ost-modal__chart-head"><h4>Price history</h4><span data-bind="chartStatus">Loading…</span></div>' +
      '<canvas data-bind="chart"></canvas>' +
    '</section>';
  }

  function renderBookBlock() {
    return '<section class="ost-modal__book">' +
      '<div class="ost-modal__book-head"><h4>Order depth</h4><span data-bind="bookStatus">—</span></div>' +
      '<div class="ost-modal__book-cols">' +
        '<div><div class="ost-modal__book-label ost-modal__book-label--yes">YES bids</div><div data-bind="bookYes" class="ost-modal__book-list"><div class="ost-modal__book-empty">—</div></div></div>' +
        '<div><div class="ost-modal__book-label ost-modal__book-label--no">NO bids</div><div data-bind="bookNo" class="ost-modal__book-list"><div class="ost-modal__book-empty">—</div></div></div>' +
      '</div>' +
    '</section>';
  }

  function renderTradesBlock() {
    return '<section class="ost-modal__trades">' +
      '<div class="ost-modal__trades-head"><h4>Recent ticks</h4><span data-bind="tradesStatus">—</span></div>' +
      '<div class="ost-modal__trades-scroll"><table class="ost-modal__trades-table"><thead><tr><th>Time</th><th>Side</th><th>Price</th><th>Size</th></tr></thead><tbody data-bind="tradesBody"><tr><td colspan="4" style="text-align:center;opacity:0.6;">Loading…</td></tr></tbody></table></div>' +
    '</section>';
  }

  function renderBetBlock(m) {
    return '<section class="ost-modal__bet">' +
      '<div class="ost-modal__bet-head"><h4>Place a bet with OST</h4></div>' +
      '<div class="ost-modal__bet-grid">' +
        '<div class="ost-modal__bet-side">' +
          '<div class="ost-modal__bet-toggle">' +
            '<button type="button" data-side="YES" class="ost-modal__side-btn ost-modal__side-btn--yes is-active">YES</button>' +
            '<button type="button" data-side="NO"  class="ost-modal__side-btn ost-modal__side-btn--no">NO</button>' +
          '</div>' +
        '</div>' +
        '<label class="ost-modal__bet-stake">Stake (OST)<input type="number" min="0.01" step="0.01" value="1" data-bind="stake"></label>' +
        '<output class="ost-modal__bet-projected" data-bind="projected">—</output>' +
        '<button type="button" class="ost-modal__bet-action" data-act="placebet">Place bet</button>' +
      '</div>' +
      (m.primaryUrl ? '<a class="ost-modal__bet-venue" href="' + escapeHtml(m.primaryUrl) + '" target="_blank" rel="noopener">Open on ' + escapeHtml(m.sourceLabel || 'venue') + ' ↗</a>' : '') +
    '</section>';
  }

  function renderSkeleton(m) {
    return '<header class="ost-modal__header">' + renderHeaderBlock(m) + '</header>' +
           '<div class="ost-modal__main">' +
             renderBtcBlock(m) +
             renderPricesBlock(m) +
             renderChartBlock() +
             '<div class="ost-modal__two-col">' +
               renderBookBlock() +
               renderTradesBlock() +
             '</div>' +
             renderBetBlock(m) +
           '</div>';
  }

  function setText(scope, key, val) {
    var n = scope.querySelector('[data-bind="' + key + '"]');
    if (n) n.textContent = val;
  }

  // --------------------------------------------------------------------------
  // OPEN — public entry point
  // --------------------------------------------------------------------------
  function open(marketIdOrObj) {
    var market = (marketIdOrObj && typeof marketIdOrObj === 'object') ? marketIdOrObj : findMarket(marketIdOrObj);
    if (!market) { console.warn('[ost-modal] no market for', marketIdOrObj); return; }

    openModal(renderSkeleton(market));
    var modal = ensureModal();
    var bodyEl = modal.querySelector('[data-bind="body"]');

    // ---- Bet wiring ----
    var selectedSide = 'YES';
    bodyEl.querySelectorAll('.ost-modal__side-btn').forEach(function (b) {
      b.addEventListener('click', function () {
        selectedSide = b.getAttribute('data-side');
        bodyEl.querySelectorAll('.ost-modal__side-btn').forEach(function (x) { x.classList.remove('is-active'); });
        b.classList.add('is-active');
        recalcProjected();
      });
    });
    function getStake() {
      var i = bodyEl.querySelector('[data-bind="stake"]');
      return Math.max(0, parseFloat(i && i.value) || 0);
    }
    function recalcProjected() {
      var s = getStake();
      var px = selectedSide === 'YES' ? Number(market.yesPriceNumber) : Number(market.noPriceNumber);
      if (!Number.isFinite(px) || px <= 0) px = 0.5;
      var shares = s / px;
      setText(bodyEl, 'projected', 'Win ' + shares.toFixed(2) + ' OST · risk ' + s.toFixed(2) + ' OST · @ ' + fmtCents(px));
    }
    var stakeInput = bodyEl.querySelector('[data-bind="stake"]');
    if (stakeInput) stakeInput.addEventListener('input', recalcProjected);
    recalcProjected();

    bodyEl.querySelector('[data-act="placebet"]').addEventListener('click', function () {
      var s = getStake();
      if (!s) { toast('Set a stake first.', 'err'); return; }
      toast('Submitting ' + selectedSide + ' ' + s + ' OST…', 'ok');
      placeBetViaTradeDesk(market, selectedSide, s)
        .then(function (rec) {
          toast('✅ Bet recorded' + (rec && rec.sig ? ' (sig ' + String(rec.sig).slice(0, 8) + '…)' : '') + '. Check Open Positions below.', 'ok');
          // Auto-close after 2.5s so user can see positions
          setTimeout(closeModal, 2500);
        })
        .catch(function (err) {
          toast('⚠️ ' + (err && err.message ? err.message : 'Bet failed'), 'err');
        });
    });

    // ---- Live BTC tile ----
    if (market.isOstNative && market.meta && market.meta.kind === 'btc5m') {
      var tickBtc = function () {
        var msLeft = Math.max(0, market.meta.closeAt - Date.now());
        var mm = Math.floor(msLeft / 60000), ss = Math.floor((msLeft % 60000) / 1000);
        setText(bodyEl, 'btcCountdown', mm + ':' + (ss < 10 ? '0' : '') + ss);
        var rec = (readJson(ROUND_KEY, {})[String(market.meta.openAt)] || {});
        if (rec.openPrice && !market.meta.openPrice) market.meta.openPrice = rec.openPrice;
        setText(bodyEl, 'btcOpen', market.meta.openPrice ? fmtUsd(market.meta.openPrice) : '—');
      };
      tickBtc();
      liveTimers.push(setInterval(tickBtc, 500));
      var fetchBtcLive = function () {
        fetchBtcRace()
          .then(function (p) {
            if (!Number.isFinite(p)) {
              setText(bodyEl, 'btcLive', 'feed offline');
              return;
            }
          setText(bodyEl, 'btcLive', fmtUsd(p) + '  · ' + BTC_PRICE_FEEDS[BTC_FEED_INDEX].name);
          // Persist open price on first tick of the round if missing.
          if (!market.meta.openPrice) {
            market.meta.openPrice = p;
            try {
              var rounds = readJson(ROUND_KEY, {});
              rounds[String(market.meta.openAt)] = Object.assign({}, rounds[String(market.meta.openAt)] || {}, { openPrice: p });
              localStorage.setItem(ROUND_KEY, JSON.stringify(rounds));
            } catch (_) {}
            setText(bodyEl, 'btcOpen', fmtUsd(p));
          }
          var d = p - market.meta.openPrice;
          var pct = (d / market.meta.openPrice) * 100;
          var n = bodyEl.querySelector('[data-bind="btcDelta"]');
          if (n) {
            n.textContent = (d >= 0 ? '▲ +' : '▼ ') + fmtUsd(d) + '  (' + pct.toFixed(3) + '%)';
            n.style.color = d >= 0 ? '#7ce6a8' : '#ff7c8a';
          }
          // Live YES/NO odds from delta sign + magnitude (0.5 + tanh(delta*100))
          var yesProb = 0.5 + 0.5 * Math.tanh(pct * 0.6);
          yesProb = Math.max(0.02, Math.min(0.98, yesProb));
          market.yesPriceNumber = yesProb;
          market.noPriceNumber = 1 - yesProb;
          var yEl = bodyEl.querySelector('[data-bind="yesPct"]');
          var nEl2 = bodyEl.querySelector('[data-bind="noPct"]');
          if (yEl) yEl.textContent = (yesProb * 100).toFixed(1) + '%';
          if (nEl2) nEl2.textContent = ((1 - yesProb) * 100).toFixed(1) + '%';
          recalcProjected();
        });
      };
      fetchBtcLive();
      liveTimers.push(setInterval(fetchBtcLive, 800));
    }

    // ---- Polymarket live data ----
    if (looksLikePolymarketId(market)) {
      var tokenId = findPolymarketTokenId(market);
      // Correct precedence: prefer raw conditionId, then market.conditionId, fallback to market.id
      var rawId = (market.raw && (market.raw.conditionId || market.raw.condition_id))
               || market.conditionId
               || (market.raw && market.raw.id)
               || market.id;

      // Apply a fresh YES/NO from any source.
      var applyYes = function (yesPx, src) {
        if (!Number.isFinite(yesPx) || yesPx <= 0 || yesPx >= 1) return;
        market.yesPriceNumber = yesPx;
        market.noPriceNumber = 1 - yesPx;
        var yEl = bodyEl.querySelector('[data-bind="yesPct"]');
        var n2 = bodyEl.querySelector('[data-bind="noPct"]');
        if (yEl) yEl.textContent = (yesPx * 100).toFixed(1) + '% · ' + src;
        if (n2) n2.textContent = ((1 - yesPx) * 100).toFixed(1) + '%';
        recalcProjected();
      };

      // Gamma-api refresh — works even when CLOB CORS blocks. Gives us
      // bestBid/bestAsk/lastTradePrice. Refreshed every 2s.
      var refreshGamma = function () {
        fetchPolyGammaMarket(rawId).then(function (g) {
          if (!g) return;
          var bb = Number(g.bestBid), ba = Number(g.bestAsk), lt = Number(g.lastTradePrice);
          var yesPx = NaN;
          if (Number.isFinite(bb) && Number.isFinite(ba)) yesPx = (bb + ba) / 2;
          else if (Number.isFinite(lt)) yesPx = lt;
          else if (Number.isFinite(bb)) yesPx = bb;
          else if (Number.isFinite(ba)) yesPx = ba;
          applyYes(yesPx, 'gamma');
          // Update header tag with live volume.
          if (Number.isFinite(Number(g.volume24hr))) {
            setText(bodyEl, 'tradesStatus', 'gamma · 24h vol $' + Math.round(Number(g.volume24hr)).toLocaleString());
          }
          // If we didn't have clobTokenIds or conditionId, pull them from gamma now
          // and immediately trigger the dependent fetches with the correct IDs.
          if (!tokenId || rawId === market.id) {
            try {
              var t = g.clobTokenIds; if (typeof t === 'string') t = JSON.parse(t);
              if (Array.isArray(t) && t[0]) { tokenId = String(t[0]); }
            } catch (_) {}
            // Update rawId with the proper condition ID from gamma
            if (g.conditionId || g.condition_id) rawId = g.conditionId || g.condition_id;
            if (tokenId) refreshBook();
          }
        });
      };
      refreshGamma();
      liveTimers.push(setInterval(refreshGamma, 2000));

      // Order book — refreshed every 5s. Updates YES/NO prices from book mid.
      var refreshBook = function () {
        if (!tokenId) { setText(bodyEl, 'bookStatus', 'token id unknown — book unavailable'); return; }
        setText(bodyEl, 'bookStatus', 'fetching…');
        fetchPolyOrderbook(tokenId).then(function (book) {
          if (!book) { setText(bodyEl, 'bookStatus', 'book offline'); return; }
          var bids = (book.bids || []).slice(0, 8);
          var asks = (book.asks || []).slice(0, 8);
          setText(bodyEl, 'bookStatus', 'live · ' + bids.length + 'b / ' + asks.length + 'a · ' + fmtTime(Date.now()));
          var fmtRow = function (r) {
            var px = Number(r.price), sz = Number(r.size);
            return '<div class="ost-modal__book-row"><span>' + (Number.isFinite(px) ? (px * 100).toFixed(1) + '¢' : '—') + '</span><span>' + (Number.isFinite(sz) ? sz.toFixed(0) : '—') + '</span></div>';
          };
          var yesEl = bodyEl.querySelector('[data-bind="bookYes"]');
          var noEl  = bodyEl.querySelector('[data-bind="bookNo"]');
          if (yesEl) yesEl.innerHTML = bids.length ? bids.map(fmtRow).join('') : '<div class="ost-modal__book-empty">No bids</div>';
          if (noEl)  noEl.innerHTML  = asks.length ? asks.map(fmtRow).join('') : '<div class="ost-modal__book-empty">No asks</div>';
          // Live YES price = best bid (mid of best bid/ask if both available).
          var bestBid = bids[0] && Number(bids[0].price);
          var bestAsk = asks[0] && Number(asks[0].price);
          var yesPx = NaN;
          if (Number.isFinite(bestBid) && Number.isFinite(bestAsk)) yesPx = (bestBid + bestAsk) / 2;
          else if (Number.isFinite(bestBid)) yesPx = bestBid;
          else if (Number.isFinite(bestAsk)) yesPx = bestAsk;
          if (Number.isFinite(yesPx) && yesPx > 0 && yesPx < 1) {
            applyYes(yesPx, 'clob');
          }
        });
      };
      refreshBook();
      liveTimers.push(setInterval(refreshBook, 1500));

      // Trades — refresh every 8s
      var refreshTrades = function () {
        setText(bodyEl, 'tradesStatus', 'fetching…');
        fetchPolyTrades(rawId).then(function (trades) {
          var body = bodyEl.querySelector('[data-bind="tradesBody"]');
          if (!body) return;
          if (!trades || !Array.isArray(trades) || !trades.length) {
            body.innerHTML = '<tr><td colspan="4" style="text-align:center;opacity:0.6;">No recent trades available</td></tr>';
            setText(bodyEl, 'tradesStatus', 'no ticks');
            return;
          }
          setText(bodyEl, 'tradesStatus', 'live · ' + trades.length + ' · ' + fmtTime(Date.now()));
          body.innerHTML = trades.slice(0, 18).map(function (t) {
            var side = (t.side || t.outcome || '').toString().toUpperCase();
            var color = /YES|BUY/i.test(side) ? '#7ce6a8' : '#ff7c8a';
            var px = Number(t.price);
            var sz = Number(t.size || t.amount);
            var rawTs = Number(t.timestamp || t.match_time || t.ts);
            var ts = rawTs > 1e12 ? rawTs : rawTs * 1000;
            return '<tr>' +
              '<td>' + escapeHtml(fmtTime(ts)) + '</td>' +
              '<td style="color:' + color + ';font-weight:700;">' + escapeHtml(side || '—') + '</td>' +
              '<td>' + (Number.isFinite(px) ? (px * 100).toFixed(1) + '¢' : '—') + '</td>' +
              '<td>' + (Number.isFinite(sz) ? sz.toFixed(1) : '—') + '</td>' +
            '</tr>';
          }).join('');
        });
      };
      refreshTrades();
      liveTimers.push(setInterval(refreshTrades, 3000));

      // Price history — refresh every 30s
      var refreshHistory = function () {
        setText(bodyEl, 'chartStatus', 'fetching…');
        fetchPolyHistory(rawId).then(function (h) {
          var canvas = bodyEl.querySelector('[data-bind="chart"]');
          if (!canvas || !h) { setText(bodyEl, 'chartStatus', 'history unavailable'); return; }
          var pts = (h.history || h.prices || []).map(function (r) { return Number(r.p || r.price); }).filter(Number.isFinite);
          if (pts.length < 2) { setText(bodyEl, 'chartStatus', 'no series'); return; }
          canvas.style.width = '100%'; canvas.style.height = '200px';
          drawSeries(canvas, pts, '#6ce6a4');
          setText(bodyEl, 'chartStatus', pts.length + ' pts · ' + fmtTime(Date.now()));
        });
      };
      refreshHistory();
      liveTimers.push(setInterval(refreshHistory, 30000));
    } else {
      // OST native or unknown — synthesize a minimal placeholder chart
      setText(bodyEl, 'chartStatus', 'native market');
      setText(bodyEl, 'bookStatus', 'native market');
      setText(bodyEl, 'tradesStatus', 'native market');
      var canvas = bodyEl.querySelector('[data-bind="chart"]');
      if (canvas && market.isOstNative) {
        // Build a quick BTC sparkline from saved rounds
        var rounds = readJson(ROUND_KEY, {});
        var keys = Object.keys(rounds).sort();
        var pts = keys.map(function (k) { return rounds[k].closePrice || rounds[k].openPrice; }).filter(Number.isFinite);
        if (pts.length >= 2) { canvas.style.width = '100%'; canvas.style.height = '200px'; drawSeries(canvas, pts, '#ffd980'); }
      }
    }
  }

  // --------------------------------------------------------------------------
  // Auto-wire: ANY click on a market card opens the modal.
  // We use a single delegated capture-phase listener so it works for cards
  // inserted later by app.js's renderer.
  // --------------------------------------------------------------------------
  function onCardClick(ev) {
    // Skip when the modal is already open (otherwise our internal trade-desk
    // selector .click() would re-trigger us and we'd loop).
    var existing = document.getElementById(MODAL_ID);
    if (existing && existing.classList.contains('is-open')) return;
    // Don't hijack clicks on links / venue buttons
    var ignore = ev.target.closest('a[href], .prediction-market-link, .prediction-market-api-link');
    var card = ev.target.closest('.prediction-market-card[data-prediction-market-id]');
    if (!card) return;
    if (ignore) return;
    ev.preventDefault();
    ev.stopPropagation();
    var id = card.getAttribute('data-prediction-market-id') || '';
    open(id);
  }
  document.addEventListener('click', onCardClick, true);

  // Public API
  window.OST_MARKET_MODAL = {
    open: open,
    close: closeModal
  };

  // Replace the older detail modal trigger (prediction-pro.js) so we don't
  // open two competing dialogs. The old script's `injectDetailButtons` sets
  // text "📊 Details" — when found, intercept its click.
  document.addEventListener('click', function (ev) {
    var t = ev.target.closest('.ost-prodetail-trigger');
    if (!t) return;
    ev.preventDefault();
    ev.stopPropagation();
    ev.stopImmediatePropagation();
    var card = t.closest('[data-prediction-market-id]');
    if (card) open(card.getAttribute('data-prediction-market-id'));
  }, true);
})();

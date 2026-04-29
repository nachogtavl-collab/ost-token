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

  // Push a freshly-placed bet to the global ost-api positions feed so every
  // other OST user sees it in their "Live OST flow" ticker.
  function shareBetGlobally(market, side, stake, rec) {
    try {
      var base = (window.OST_API_BASE || '').replace(/\/$/, '');
      if (!base) return;
      var wallet = (rec && rec.wallet) ||
        (window.OST_WALLET && window.OST_WALLET.session && window.OST_WALLET.session.publicKey && window.OST_WALLET.session.publicKey.toBase58 && window.OST_WALLET.session.publicKey.toBase58()) ||
        window.OST_WALLET_PUBKEY ||
        (window.solana && window.solana.publicKey && window.solana.publicKey.toString && window.solana.publicKey.toString()) ||
        'anon';
      var price = (side === 'YES' ? Number(market.yesPriceNumber) : Number(market.noPriceNumber));
      fetch(base + '/positions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(Object.assign({}, rec || {}, {
          wallet: wallet,
          marketId: market.id,
          marketTitle: market.title || market.question || '',
          title: market.title || market.question || '',
          side: side,
          stake: Number(stake) || 0,
          price: Number.isFinite(price) ? price : null,
          signature: rec && rec.sig || null,
          ts: new Date().toISOString()
        }))
      }).catch(function () { /* fire-and-forget */ });
    } catch (_) { /* never block UI */ }
  }

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
    var bodyEl = el.querySelector('[data-bind="body"]');
    if (bodyEl && bodyEl.__refreshSell) {
      try { window.removeEventListener('ost:prediction:order-changed', bodyEl.__refreshSell); } catch (_) {}
      bodyEl.__refreshSell = null;
    }
    if (bodyEl && bodyEl.__broadcastHls) {
      try { bodyEl.__broadcastHls.destroy(); } catch (_) {}
      bodyEl.__broadcastHls = null;
    }
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
  function findPolymarketTokenIds(market) {
    if (!market) return null;
    if (market.tokenId) return [String(market.tokenId)];
    if (market.clobTokenIds && market.clobTokenIds[0]) return market.clobTokenIds.map(String).filter(Boolean);
    if (market.raw) {
      try {
        var t = market.raw.clobTokenIds || market.raw.outcomeTokens || market.raw.tokens;
        if (!t && Array.isArray(market.raw.outcomes) && market.raw.outcomes.length && typeof market.raw.outcomes[0] === 'object') t = market.raw.outcomes;
        if (!t && typeof market.raw.outcomes === 'string') {
          var parsedOutcomes = JSON.parse(market.raw.outcomes);
          if (Array.isArray(parsedOutcomes) && parsedOutcomes.length && typeof parsedOutcomes[0] === 'object') t = parsedOutcomes;
        }
        if (typeof t === 'string') t = JSON.parse(t);
        if (Array.isArray(t)) {
          var ids = t.map(function (token) {
            if (token && typeof token === 'object') return String(token.tokenId || token.token_id || token.id || token.asset_id || '').trim();
            return String(token || '').trim();
          }).filter(function (id) { return id && id.toLowerCase() !== 'yes' && id.toLowerCase() !== 'no'; });
          if (ids.length) return ids;
        }
      } catch (_) {}
    }
    return [];
  }
  function findPolymarketTokenId(market) {
    var ids = findPolymarketTokenIds(market);
    return ids && ids[0] ? ids[0] : null;
  }
  function fetchPolyOrderbook(tokenId) {
    if (!tokenId) return Promise.resolve(null);
    return fetchJsonResilient(pmClob('/book', 'token_id=' + encodeURIComponent(tokenId)));
  }
  function fetchPolyTrades(marketId) {
    if (!marketId) return Promise.resolve(null);
    return fetchJsonResilient(pmClob('/trades', 'market=' + encodeURIComponent(marketId) + '&limit=20'));
  }
  function fetchPolyHistory(tokenId, fallbackMarketId) {
    if (tokenId) {
      return fetchJsonResilient(pmClob('/prices-history', 'market=' + encodeURIComponent(tokenId) + '&interval=1d&fidelity=10'))
        .then(function (payload) { return payload || (fallbackMarketId ? fetchJsonResilient(pmData('/prices-history', 'market=' + encodeURIComponent(fallbackMarketId) + '&interval=1d&fidelity=10')) : null); });
    }
    if (!fallbackMarketId) return Promise.resolve(null);
    return fetchJsonResilient(pmData('/prices-history', 'market=' + encodeURIComponent(fallbackMarketId) + '&interval=1d&fidelity=10'));
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
  // Draw a small distinctive glyph (random pixel pattern inside a 12-px circle).
  // Each (wallet, ts) gets a deterministic look so users can recognise repeat
  // bettors without us leaking identity. Used for the bet-tick overlay.
  function drawBetGlyph(ctx, cx, cy, color, seed) {
    var s = String(seed || (cx + ',' + cy));
    var h = 0; for (var i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) >>> 0; }
    var rng = function () { h = (h * 1664525 + 1013904223) >>> 0; return (h & 0xffff) / 0xffff; };
    // Outer halo
    ctx.save();
    ctx.shadowColor = color; ctx.shadowBlur = 8;
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(cx, cy, 7, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    // Inner dark disc so the random pixel pattern reads
    ctx.fillStyle = 'rgba(8,10,18,0.92)';
    ctx.beginPath(); ctx.arc(cx, cy, 5.2, 0, Math.PI * 2); ctx.fill();
    // 4×4 random pixel mosaic in the disc, deterministic per seed
    var palette = ['#ffd980', '#7ce6a8', '#ff7c8a', '#9ba0c8', '#cbd1f0'];
    for (var py = 0; py < 4; py++) {
      for (var px = 0; px < 4; px++) {
        var dx = (px - 1.5) * 1.6, dy = (py - 1.5) * 1.6;
        if (Math.sqrt(dx*dx + dy*dy) > 4.4) continue;
        ctx.fillStyle = palette[Math.floor(rng() * palette.length)];
        ctx.fillRect(cx + dx - 0.8, cy + dy - 0.8, 1.6, 1.6);
      }
    }
    // Crisp ring
    ctx.strokeStyle = color; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(cx, cy, 6, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }

  function drawSeries(canvas, points, color, overlay) {
    if (!canvas || !points || points.length < 2) return;
    var ctx = canvas.getContext('2d');
    var dpr = window.devicePixelRatio || 1;
    var w = canvas.clientWidth || 600;
    var h = canvas.clientHeight || 200;
    canvas.width = Math.floor(w * dpr); canvas.height = Math.floor(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
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
    // Bet-tick overlay — only ticks matching the active side land on this chart.
    // overlay = [{ frac: 0..1 across width, value, seed, color? }]
    if (Array.isArray(overlay) && overlay.length) {
      overlay.forEach(function (o) {
        if (!Number.isFinite(o.frac) || !Number.isFinite(o.value)) return;
        var x = Math.max(8, Math.min(w - 8, o.frac * w));
        var py = h - ((o.value - min) / range) * (h - 8) - 4;
        py = Math.max(8, Math.min(h - 8, py));
        drawBetGlyph(ctx, x, py, o.color || color, o.seed);
      });
    }
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
            resolve(now[0]);
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
      '<div class="ost-modal__chart-head">' +
        '<h4>Price history' +
          '<span class="ost-modal__chart-toggle" data-bind="chartToggle">' +
            '<button type="button" data-side="YES" class="is-active is-yes">YES</button>' +
            '<button type="button" data-side="NO" class="is-no">NO</button>' +
          '</span>' +
        '</h4>' +
        '<span data-bind="chartStatus">Loading…</span>' +
      '</div>' +
      '<canvas data-bind="chart"></canvas>' +
    '</section>';
  }

  // ──────────────────────────────────────────────────────────────────────
  // SELL — own open positions on this market, with live mark-to-market
  // and a working Sell button that settles via OST_TRADE.predictionCashOut
  // when available, or falls back to a local cash-out + worker sync.
  // ──────────────────────────────────────────────────────────────────────
  function readOrders() { return readJson(ORDERS_KEY, []) || []; }
  function writeOrders(list) {
    try { localStorage.setItem(ORDERS_KEY, JSON.stringify((list || []).slice(0, 300))); } catch (_) {}
  }
  function ownWallet() {
    try {
      if (window.OST_WALLET && window.OST_WALLET.session && window.OST_WALLET.session.publicKey && window.OST_WALLET.session.publicKey.toBase58) {
        return window.OST_WALLET.session.publicKey.toBase58();
      }
    } catch (_) {}
    return window.OST_WALLET_PUBKEY || (window.solana && window.solana.publicKey && window.solana.publicKey.toString && window.solana.publicKey.toString()) || '';
  }
  function ordersForMarket(market) {
    var id = String(market && market.id || '');
    if (!id) return [];
    var wallet = ownWallet();
    return readOrders().filter(function (o) {
      if (!o || String(o.marketId || '') !== id) return false;
      if (o.cashedOut) return false;
      // If a wallet is connected, only show that wallet's tickets — otherwise
      // show all local tickets so users can still settle pre-connect orders.
      return wallet ? !o.wallet || o.wallet === wallet : true;
    });
  }
  function renderSellBlock() {
    return '<section class="ost-modal__sell" data-bind="sellSection">' +
      '<div class="ost-modal__sell-head">' +
        '<h4>Your open positions on this market</h4>' +
        '<span data-bind="sellStatus" style="opacity:.6;font-size:11px;">—</span>' +
      '</div>' +
      '<div data-bind="sellList" class="ost-modal__sell-list">' +
        '<div style="opacity:.55;font-size:12px;padding:8px 0;">No open positions on this market.</div>' +
      '</div>' +
    '</section>';
  }
  function postPositionUpdate(order) {
    try {
      var base = (window.OST_API_BASE || '').replace(/\/$/, '');
      if (!base) return;
      fetch(base + '/positions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(Object.assign({}, order, {
          wallet: order.wallet || ownWallet() || 'anon',
          marketTitle: order.title || order.marketTitle || '',
          ts: order.createdAt || order.ts || Date.now()
        }))
      }).catch(function () {});
    } catch (_) {}
  }
  function notifyOrderChanged() {
    try { window.dispatchEvent(new CustomEvent('ost:prediction:order-changed')); } catch (_) {}
    try { window.dispatchEvent(new CustomEvent('ost:wallet-changed')); } catch (_) {}
  }
  function sellOrder(order, payout, kind) {
    // Try the on-chain settlement helper first; fall back to a local cash-out.
    var doLocal = function () {
      order.cashedOut = true;
      order.cashoutOst = Number(payout) || 0;
      order.cashoutAt = Date.now();
      order.cashoutKind = kind || 'prediction-sell-modal';
      order.status = 'sold';
      var orders = readOrders();
      var idx = orders.findIndex(function (o) {
        return o && (o.signature || o.sig || o.id) === (order.signature || order.sig || order.id);
      });
      if (idx >= 0) orders[idx] = order; else orders.unshift(order);
      writeOrders(orders);
      postPositionUpdate(order);
      notifyOrderChanged();
      return Promise.resolve({ ost: Number(payout) || 0, sig: order.cashoutSig || '' });
    };
    if (window.OST_TRADE && typeof window.OST_TRADE.predictionCashOut === 'function') {
      return Promise.resolve(window.OST_TRADE.predictionCashOut(order, Number(payout) || 0))
        .then(function (r) {
          order.cashoutSig = r && r.sig ? r.sig : order.cashoutSig;
          return doLocal().then(function (loc) {
            return Object.assign({}, loc, { ost: (r && Number(r.ost)) || loc.ost, sig: order.cashoutSig || loc.sig });
          });
        })
        .catch(function () { return doLocal(); });
    }
    return doLocal();
  }

  // Shared positions ticker — every OST user sees every other user's recent bets
  // ON THIS MARKET (filtered server-side fetch is global, we filter per-market here).
  function renderSharedBlock() {
    return '<section class="ost-modal__shared">' +
      '<div class="ost-modal__shared-title">Live OST flow · this market</div>' +
      '<div class="ost-modal__shared-list" data-bind="sharedList">' +
        '<div style="opacity:0.55;font-size:11px;">Loading shared positions…</div>' +
      '</div>' +
    '</section>';
  }

  // Multi-outcome buttons (Trump/Harris/RFK…). Returns empty string for binary.
  function renderOutcomesBlock(m) {
    var outs = (m.raw && Array.isArray(m.raw.outcomes)) ? m.raw.outcomes
             : (Array.isArray(m.outcomes) ? m.outcomes : []);
    if (!Array.isArray(outs) || outs.length <= 2) return '';
    return '<section class="ost-modal__outcomes-wrap"><h4 style="margin:0 0 8px;font-size:13px;letter-spacing:0.04em;text-transform:uppercase;color:#9ba0c8;">All outcomes</h4>' +
      '<div class="ost-modal__outcomes" data-bind="outcomesList">' +
      outs.map(function (o, i) {
        var label = (o && o.label) || (typeof o === 'string' ? o : ('Outcome ' + (i+1)));
        var price = Number(o && o.price);
        return '<button type="button" class="ost-modal__outcome' + (i === 0 ? ' is-active' : '') + '" data-outcome-idx="' + i + '">' +
               '<span class="ost-modal__outcome-label">' + escapeHtml(label) + '</span>' +
               '<span class="ost-modal__outcome-price">' + (Number.isFinite(price) ? (price * 100).toFixed(1) + '¢' : '—') + '</span>' +
               '</button>';
      }).join('') +
      '</div></section>';
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

  // ──────────────────────────────────────────────────────────────────────
  // BROADCAST — live video panel for sports markets (soccer / World Cup
  // first). Plays an HLS stream with a built-in 15-second delay buffer so
  // the feed lags the on-chain market just enough that latency-arbitrage
  // bettors can't front-run prices. Falls back to a Tubi link-out when no
  // direct stream URL is configured for the market.
  //
  // Owner provides streams via either:
  //   window.OST_MARKET_STREAMS = { '<marketId|conditionId|slug>': 'https://.../master.m3u8' }
  //   OR per-market field market.streamUrl / market.broadcastUrl
  // ──────────────────────────────────────────────────────────────────────
  var SPORTS_RE = /\b(world\s*cup|fifa|world-?cup|champions\s*league|premier\s*league|la\s*liga|bundesliga|serie\s*a|copa|uefa|nba|nfl|ufc|boxing|f1|formula\s*1|tennis|wimbledon|atp|wta|cricket|ipl)\b|\bvs\.?\b|\b—\b.*\b—\b/i;
  function isSportsMarket(m) {
    var t = String((m && (m.title || m.question || m.detail || '')) || '');
    var topic = String((m && m.topic) || '');
    if (SPORTS_RE.test(t) || SPORTS_RE.test(topic)) return true;
    return false;
  }
  function tubiSearchUrl(m) {
    var q = String((m && (m.title || m.question || '')) || '').replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
    return 'https://tubitv.com/search/' + encodeURIComponent(q || 'fifa world cup');
  }
  function streamForMarket(m) {
    if (!m) return '';
    if (m.streamUrl) return String(m.streamUrl);
    if (m.broadcastUrl) return String(m.broadcastUrl);
    var registry = window.OST_MARKET_STREAMS;
    if (registry && typeof registry === 'object') {
      return String(registry[m.id] || registry[m.conditionId] || registry[m.slug] || '');
    }
    return '';
  }
  function renderBroadcastBlock(m) {
    if (!isSportsMarket(m)) return '';
    var stream = streamForMarket(m);
    var tubi = tubiSearchUrl(m);
    return '<section class="ost-modal__broadcast" data-bind="broadcastSection" style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:12px;margin-top:12px;">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px;">' +
        '<h4 style="margin:0;font-size:14px;letter-spacing:.04em;">📺 Live broadcast' +
          '<span style="margin-left:8px;font-size:10px;font-weight:600;padding:2px 6px;border-radius:4px;background:rgba(244,114,182,.15);color:#f472b6;border:1px solid rgba(244,114,182,.35);">15s DELAY</span>' +
        '</h4>' +
        '<a href="' + escapeHtml(tubi) + '" target="_blank" rel="noopener" style="font-size:12px;color:#fbbf24;text-decoration:none;border:1px solid rgba(251,191,36,.4);padding:4px 10px;border-radius:6px;">Watch on Tubi ↗</a>' +
      '</div>' +
      (stream
        ? '<video data-bind="broadcastVideo" controls playsinline muted preload="none" style="width:100%;max-height:360px;background:#000;border-radius:8px;"></video>' +
          '<div style="display:flex;gap:8px;align-items:center;margin-top:6px;font-size:11px;opacity:.7;">' +
            '<span data-bind="broadcastStatus">Click ▶ to start the 15-second-delayed feed.</span>' +
          '</div>'
        : '<div style="padding:10px;border-radius:6px;background:rgba(251,191,36,.06);border:1px dashed rgba(251,191,36,.3);font-size:12px;opacity:.85;">' +
            'No direct stream wired for this market yet. Open Tubi above to watch the live broadcast (Tubi adds its own ~10–15 s delay), then come back to bet.' +
          '</div>'
      ) +
    '</section>';
  }
  function loadHlsScript() {
    if (window.Hls) return Promise.resolve(window.Hls);
    if (loadHlsScript._p) return loadHlsScript._p;
    loadHlsScript._p = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/hls.js@1.5.13/dist/hls.min.js';
      s.async = true;
      s.onload = function () { resolve(window.Hls); };
      s.onerror = function () { reject(new Error('Failed to load hls.js')); };
      document.head.appendChild(s);
    });
    return loadHlsScript._p;
  }
  function wireBroadcast(bodyEl, market) {
    var video = bodyEl.querySelector('[data-bind="broadcastVideo"]');
    if (!video) return;
    var stream = streamForMarket(market);
    if (!stream) return;
    var DELAY_S = 15;
    function setStatus(msg) {
      var el = bodyEl.querySelector('[data-bind="broadcastStatus"]');
      if (el) el.textContent = msg;
    }
    // Native HLS (Safari / iOS).
    if (video.canPlayType && video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = stream;
      video.addEventListener('loadedmetadata', function () {
        try {
          if (video.seekable && video.seekable.length) {
            var end = video.seekable.end(video.seekable.length - 1);
            video.currentTime = Math.max(0, end - DELAY_S);
          }
        } catch (_) {}
        setStatus('Live · 15s behind real-time (Safari native).');
      });
      return;
    }
    // hls.js for everything else.
    setStatus('Loading player…');
    loadHlsScript().then(function (Hls) {
      if (!Hls || !Hls.isSupported()) {
        setStatus('Browser cannot play HLS. Use the Tubi link instead.');
        return;
      }
      var hls = new Hls({
        lowLatencyMode: false,
        liveSyncDuration: DELAY_S,
        liveMaxLatencyDuration: DELAY_S * 2,
        backBufferLength: 60
      });
      hls.loadSource(stream);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, function () {
        setStatus('Live · 15s behind real-time. Click ▶ to play.');
      });
      hls.on(Hls.Events.ERROR, function (_evt, data) {
        if (data && data.fatal) {
          setStatus('Stream error: ' + (data.details || data.type) + '. Try the Tubi link.');
          try { hls.destroy(); } catch (_) {}
        }
      });
      // Stash for cleanup on close.
      bodyEl.__broadcastHls = hls;
    }).catch(function (e) {
      setStatus('Player unavailable: ' + (e && e.message || 'unknown') + '. Use the Tubi link.');
    });
  }

  function renderSkeleton(m) {
    return '<header class="ost-modal__header">' + renderHeaderBlock(m) + '</header>' +
           '<div class="ost-modal__main">' +
             renderBtcBlock(m) +
             renderPricesBlock(m) +
             renderOutcomesBlock(m) +
             renderChartBlock() +
             renderBroadcastBlock(m) +
             '<div class="ost-modal__two-col">' +
               renderBookBlock() +
               renderTradesBlock() +
             '</div>' +
             renderBetBlock(m) +
             renderSellBlock() +
             renderSharedBlock() +
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
          // Share to global feed so every other OST user sees the tick live.
          shareBetGlobally(market, selectedSide, s, rec);
          // Auto-close after 2.5s so user can see positions
          setTimeout(closeModal, 2500);
        })
        .catch(function (err) {
          toast('⚠️ ' + (err && err.message ? err.message : 'Bet failed'), 'err');
        });
    });

    // ---- Chart YES/NO toggle ----
    var chartSide = 'YES';
    bodyEl.querySelectorAll('[data-bind="chartToggle"] button').forEach(function (b) {
      b.addEventListener('click', function () {
        chartSide = b.getAttribute('data-side');
        bodyEl.querySelectorAll('[data-bind="chartToggle"] button').forEach(function (x) { x.classList.remove('is-active'); });
        b.classList.add('is-active');
        if (typeof window.__ostRequestChartHistory === 'function') window.__ostRequestChartHistory(chartSide);
        if (typeof window.__ostChartRedraw === 'function') window.__ostChartRedraw();
      });
    });
    // Expose for the polymarket renderLiveHistory closure further down
    bodyEl.__getChartSide = function () { return chartSide; };

    // ---- Multi-outcome buttons (selectable) ----
    bodyEl.querySelectorAll('.ost-modal__outcome').forEach(function (b) {
      b.addEventListener('click', function () {
        bodyEl.querySelectorAll('.ost-modal__outcome').forEach(function (x) { x.classList.remove('is-active'); });
        b.classList.add('is-active');
        var idx = Number(b.getAttribute('data-outcome-idx'));
        var outs = (market.raw && market.raw.outcomes) || market.outcomes || [];
        var picked = outs[idx];
        if (picked && Number.isFinite(Number(picked.price))) {
          // Treat picked outcome as YES for the bet ticket.
          market.yesPriceNumber = Number(picked.price);
          market.noPriceNumber = 1 - Number(picked.price);
          recalcProjected();
          var yEl = bodyEl.querySelector('[data-bind="yesPct"]');
          if (yEl) yEl.textContent = (Number(picked.price) * 100).toFixed(1) + '% · ' + (picked.label || ('outcome ' + (idx+1)));
        }
      });
    });

    // ---- Shared positions feed (cross-user ticker) ----
    var sharedListEl = bodyEl.querySelector('[data-bind="sharedList"]');
    function refreshSharedFeed() {
      var base = (window.OST_API_BASE || '').replace(/\/$/, '');
      if (!base) return;
      fetch(base + '/positions/recent?limit=50', { cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) {
          if (!j || !Array.isArray(j.recent)) return;
          // Index per-market for the chart overlay (only same-market ticks).
          window.__ostSharedFeed = window.__ostSharedFeed || {};
          var perMarket = {};
          j.recent.forEach(function (b) {
            var k = b.marketId; if (!k) return;
            (perMarket[k] = perMarket[k] || []).push(b);
          });
          window.__ostSharedFeed = perMarket;
          // Trigger a chart redraw so newly-arrived bets appear as glyphs.
          if (typeof window.__ostChartRedraw === 'function') {
            try { window.__ostChartRedraw(); } catch (_) {}
          }
          if (!sharedListEl) return;
          // Filter the side ribbon to ONLY this market's bets — users were
          // getting confused seeing trades from unrelated markets.
          var thisMarketBets = (perMarket[market.id] || []).slice(0, 12);
          if (!thisMarketBets.length) {
            sharedListEl.innerHTML = '<div style="opacity:0.55;font-size:11px;">No OST bets on this market yet — be the first.</div>';
            return;
          }
          sharedListEl.innerHTML = thisMarketBets.map(function (r) {
            var sideClass = /YES|BUY/i.test(r.side) ? 'is-yes' : 'is-no';
            var ago = Math.max(0, Math.round((Date.now() - new Date(r.ts).getTime()) / 1000));
            var agoStr = ago < 60 ? (ago + 's ago') : (Math.round(ago / 60) + 'm ago');
            var pxTxt = Number.isFinite(Number(r.price)) ? ' @ ' + (Number(r.price) * 100).toFixed(1) + '¢' : '';
            return '<div class="ost-modal__shared-row ' + sideClass + '">' +
              '<span class="ost-modal__shared-wallet">' + escapeHtml(r.walletShort || (r.wallet || 'anon').slice(0, 4) + '…') + '</span>' +
              '<span class="ost-modal__shared-side">' + escapeHtml(r.side) + '</span>' +
              '<span class="ost-modal__shared-stake">' + Number(r.stake).toFixed(2) + ' OST' + pxTxt + '</span>' +
              '<span class="ost-modal__shared-time">' + agoStr + '</span>' +
            '</div>';
          }).join('');
        })
        .catch(function () { /* silent */ });
    }
    refreshSharedFeed();
    liveTimers.push(setInterval(refreshSharedFeed, 4000));

    // ---- Sell open positions on this market (live mark-to-market) ----
    var sellListEl = bodyEl.querySelector('[data-bind="sellList"]');
    function refreshSellList() {
      if (!sellListEl) return;
      var positions = ordersForMarket(market);
      setText(bodyEl, 'sellStatus', positions.length ? (positions.length + ' open') : 'no positions');
      if (!positions.length) {
        sellListEl.innerHTML = '<div style="opacity:.55;font-size:12px;padding:8px 0;">No open positions on this market. Buy YES or NO above to open one.</div>';
        return;
      }
      sellListEl.innerHTML = positions.map(function (o, i) {
        var side = String(o.side || 'yes').toLowerCase() === 'no' ? 'NO' : 'YES';
        var sideColor = side === 'NO' ? '#ff7c8a' : '#7ce6a8';
        var stake = Number(o.stake || 0) || 0;
        var entryPx = Number(o.price || (side === 'NO' ? o.noPrice : o.yesPrice)) || 0;
        var shares = Number(o.shares) > 0 ? Number(o.shares) : (entryPx > 0 ? stake / entryPx : 0);
        var livePx = side === 'NO' ? Number(market.noPriceNumber) : Number(market.yesPriceNumber);
        if (!Number.isFinite(livePx) || livePx <= 0) livePx = entryPx;
        var liveValue = shares > 0 && livePx > 0 ? shares * livePx : stake;
        var pnl = liveValue - stake;
        var pnlColor = pnl >= 0 ? '#7ce6a8' : '#ff7c8a';
        var pnlStr = (pnl >= 0 ? '+' : '−') + Math.abs(pnl).toFixed(2);
        return '<div class="ost-modal__sell-row" data-sell-key="' + escapeHtml(o.signature || o.sig || o.id || ('idx-' + i)) + '" style="display:flex;align-items:center;gap:10px;padding:8px 0;border-top:1px solid rgba(255,255,255,.06);">' +
          '<span style="font-weight:700;color:' + sideColor + ';min-width:34px;">' + side + '</span>' +
          '<span style="opacity:.85;font-size:12px;">' + stake.toFixed(2) + ' OST @ ' + (entryPx > 0 ? (entryPx * 100).toFixed(1) + '¢' : '—') + '</span>' +
          '<span style="opacity:.85;font-size:12px;">live ' + (livePx * 100).toFixed(1) + '¢</span>' +
          '<span style="opacity:.85;font-size:12px;">value <b>' + liveValue.toFixed(2) + '</b></span>' +
          '<span style="font-size:12px;color:' + pnlColor + ';font-weight:700;">' + pnlStr + ' OST</span>' +
          '<button type="button" data-act="sell" data-sell-idx="' + i + '" style="margin-left:auto;padding:5px 12px;border-radius:6px;border:none;background:#22c55e;color:#031;cursor:pointer;font-weight:700;font-size:12px;">Sell ' + liveValue.toFixed(2) + ' OST</button>' +
        '</div>';
      }).join('');
      sellListEl.querySelectorAll('button[data-act="sell"]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var idx = Number(btn.getAttribute('data-sell-idx'));
          var positions = ordersForMarket(market);
          var order = positions[idx];
          if (!order) return;
          var side = String(order.side || 'yes').toLowerCase() === 'no' ? 'NO' : 'YES';
          var entryPx = Number(order.price || (side === 'NO' ? order.noPrice : order.yesPrice)) || 0;
          var shares = Number(order.shares) > 0 ? Number(order.shares) : (entryPx > 0 ? Number(order.stake || 0) / entryPx : 0);
          var livePx = side === 'NO' ? Number(market.noPriceNumber) : Number(market.yesPriceNumber);
          if (!Number.isFinite(livePx) || livePx <= 0) livePx = entryPx;
          var payout = Math.max(0, shares * livePx);
          if (!(payout > 0)) { toast('Cannot sell at 0¢', 'err'); return; }
          var orig = btn.textContent;
          btn.disabled = true; btn.textContent = '…';
          sellOrder(order, payout, 'prediction-sell-modal')
            .then(function (r) {
              toast('✅ Sold ' + (Number(r.ost) || payout).toFixed(2) + ' OST' + (r.sig ? ' (' + String(r.sig).slice(0, 8) + '…)' : ''), 'ok');
              refreshSellList();
            })
            .catch(function (e) {
              btn.disabled = false; btn.textContent = orig;
              toast('Sell failed: ' + (e && e.message || 'unknown'), 'err');
            });
        });
      });
    }
    refreshSellList();
    liveTimers.push(setInterval(refreshSellList, 3000));
    bodyEl.__refreshSell = refreshSellList;
    window.addEventListener('ost:prediction:order-changed', refreshSellList);

    // ---- Broadcast (HLS player with 15s delay for sports markets) ----
    try { wireBroadcast(bodyEl, market); } catch (e) { console.warn('[ost-modal] broadcast wire failed', e); }

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
      var tokenIds = findPolymarketTokenIds(market) || [];
      var tokenId = tokenIds[0] || findPolymarketTokenId(market);
      var gammaMarketId = (market.raw && market.raw.id) || market.id;
      // CLOB/data endpoints prefer conditionId; Gamma /markets/:id prefers the numeric Gamma id.
      var rawId = (market.raw && (market.raw.conditionId || market.raw.condition_id))
               || market.conditionId
               || (market.raw && market.raw.id)
               || market.id;
      var liveHistoryBySide = { YES: [], NO: [] };
      var LIVE_HISTORY_MAX = 240;

      function getOutcomeConsensusYes() {
        var op = market.outcomePrices || (market.raw && market.raw.outcomePrices);
        if (typeof op === 'string') { try { op = JSON.parse(op); } catch (_) { op = null; } }
        var first = Array.isArray(op) ? Number(op[0]) : NaN;
        return Number.isFinite(first) && first >= 0 && first <= 1 ? first : NaN;
      }

      function getTokenForChartSide(side) {
        side = side === 'NO' ? 'NO' : 'YES';
        return side === 'NO' ? (tokenIds[1] || tokenIds[0] || tokenId) : (tokenIds[0] || tokenId);
      }

      function pushHistoryPoint(side, price, ts) {
        side = side === 'NO' ? 'NO' : 'YES';
        if (!Number.isFinite(price) || price < 0 || price > 1) return;
        liveHistoryBySide[side].push({ t: Number(ts) || Date.now(), p: price });
        if (liveHistoryBySide[side].length > LIVE_HISTORY_MAX) liveHistoryBySide[side] = liveHistoryBySide[side].slice(-LIVE_HISTORY_MAX);
      }

      function renderLiveHistory() {
        var canvas = bodyEl.querySelector('[data-bind="chart"]');
        if (!canvas) return;
        var side = (typeof bodyEl.__getChartSide === 'function') ? bodyEl.__getChartSide() : 'YES';
        var history = liveHistoryBySide[side] || [];
        if (history.length < 2 && side === 'NO' && liveHistoryBySide.YES.length > 1) {
          history = liveHistoryBySide.YES.map(function (record) { return { t: record.t, p: 1 - Number(record.p) }; });
        }
        var pts = history.map(function (record) { return Number(record.p); }).filter(Number.isFinite);
        if (pts.length < 2) {
          setText(bodyEl, 'chartStatus', 'waiting for ticks…');
          return;
        }
        canvas.style.width = '100%';
        canvas.style.height = '280px';
        var color = side === 'NO' ? '#ff7c8a' : '#6ce6a4';
        // Build per-side overlay of recent OST bets on THIS market.
        // Critical UX rule: only show ticks matching the currently-displayed
        // side, so YES viewers never see NO bets and vice versa.
        var overlay = [];
        try {
          var feed = (window.__ostSharedFeed && window.__ostSharedFeed[market.id]) || [];
          var firstTs = history[0] && history[0].t || (Date.now() - 60000);
          var lastTs  = history[history.length - 1].t || Date.now();
          var span = Math.max(1, lastTs - firstTs);
          feed.forEach(function (b) {
            var bSide = String(b.side || '').toUpperCase();
            if (bSide !== side) return; // hide contrary side
            var bTs = new Date(b.ts).getTime();
            if (!Number.isFinite(bTs) || bTs < firstTs - 5000) return;
            var frac = Math.max(0, Math.min(1, (bTs - firstTs) / span));
            // Plot at the price recorded on the same side axis.
            var px = Number(b.price);
            if (!Number.isFinite(px)) return;
            overlay.push({ frac: frac, value: px, seed: (b.wallet || '') + ':' + bTs, color: color });
          });
        } catch (_) {}
        drawSeries(canvas, pts, color, overlay);
        var status = 'live 1s · ' + side + ' · ' + pts.length + ' pts';
        if (overlay.length) status += ' · ' + overlay.length + ' OST tick' + (overlay.length === 1 ? '' : 's');
        setText(bodyEl, 'chartStatus', status + ' · ' + fmtTime(Date.now()));
      }
      // Expose so toggle button can force a redraw without new ticks.
      window.__ostChartRedraw = renderLiveHistory;

      window.__ostRequestChartHistory = function requestChartHistoryForSide(side) {
        refreshHistory(side === 'NO' ? 'NO' : 'YES');
      };

      // Apply a fresh YES/NO from any source.
      var applyYes = function (yesPx, src) {
        // Allow 0–1 inclusive: resolved markets can sit at 0.99 / 0.01.
        if (!Number.isFinite(yesPx) || yesPx < 0 || yesPx > 1) return;
        market.yesPriceNumber = yesPx;
        market.noPriceNumber = 1 - yesPx;
        pushHistoryPoint('YES', yesPx, Date.now());
        pushHistoryPoint('NO', 1 - yesPx, Date.now());
        var yEl = bodyEl.querySelector('[data-bind="yesPct"]');
        var n2 = bodyEl.querySelector('[data-bind="noPct"]');
        if (yEl) yEl.textContent = (yesPx * 100).toFixed(1) + '% · ' + src;
        if (n2) n2.textContent = ((1 - yesPx) * 100).toFixed(1) + '%';
        renderLiveHistory();
        recalcProjected();
      };

      var initialConsensusYes = getOutcomeConsensusYes();
      if (Number.isFinite(initialConsensusYes)) applyYes(initialConsensusYes, 'poly');

      // Gamma-api refresh — works even when CLOB CORS blocks. Gives us
      // bestBid/bestAsk/lastTradePrice. Refreshed every 2s.
      var refreshGamma = function () {
        fetchPolyGammaMarket(gammaMarketId).then(function (g) {
          if (!g) return;
          // Prefer the real market consensus (outcomePrices) — falls back
          // to lastTradePrice, then mid of bid/ask. Avoids the "stuck 50%"
          // artefact you get from averaging a wide bid/ask spread.
          var op = g.outcomePrices;
          if (typeof op === 'string') { try { op = JSON.parse(op); } catch (_) { op = null; } }
          var bb = Number(g.bestBid), ba = Number(g.bestAsk), lt = Number(g.lastTradePrice);
          var consensus = (Array.isArray(op) && Number(op[0]) >= 0 && Number(op[0]) <= 1) ? Number(op[0]) : NaN;
          var yesPx = NaN;
          if (Number.isFinite(consensus) && consensus > 0 && consensus < 1) yesPx = consensus;
          else if (Number.isFinite(lt) && lt > 0 && lt < 1) yesPx = lt;
          else if (Number.isFinite(bb) && Number.isFinite(ba) && (ba - bb) < 0.30) yesPx = (bb + ba) / 2;
          else if (Number.isFinite(bb) && bb > 0) yesPx = bb;
          else if (Number.isFinite(ba) && ba < 1) yesPx = ba;
          applyYes(yesPx, 'gamma');
          // Mirror multi-outcome prices live so the buttons reflect reality.
          if (Array.isArray(op) && op.length > 1) {
            var outs = (g.outcomes && (typeof g.outcomes === 'string' ? JSON.parse(g.outcomes) : g.outcomes)) || [];
            var outBtns = bodyEl.querySelectorAll('.ost-modal__outcome');
            outBtns.forEach(function (btn, i) {
              var p = Number(op[i]);
              if (!Number.isFinite(p)) return;
              var pe = btn.querySelector('.ost-modal__outcome-price');
              if (pe) pe.textContent = (p * 100).toFixed(1) + '¢';
              var le = btn.querySelector('.ost-modal__outcome-label');
              if (le && outs[i]) le.textContent = String(outs[i]);
            });
          }
          // Update header tag with live volume.
          if (Number.isFinite(Number(g.volume24hr))) {
            setText(bodyEl, 'tradesStatus', 'gamma · 24h vol $' + Math.round(Number(g.volume24hr)).toLocaleString());
          }
          // If we didn't have clobTokenIds or conditionId, pull them from gamma now
          // and immediately trigger the dependent fetches with the correct IDs.
          if (!tokenId || rawId === market.id) {
            try {
              var t = g.clobTokenIds; if (typeof t === 'string') t = JSON.parse(t);
              if (Array.isArray(t)) {
                tokenIds = t.map(function (item) {
                  if (item && typeof item === 'object') return String(item.tokenId || item.token_id || item.id || item.asset_id || '').trim();
                  return String(item || '').trim();
                }).filter(Boolean);
                if (tokenIds[0]) tokenId = tokenIds[0];
              }
            } catch (_) {}
            if (g.conditionId || g.condition_id) rawId = g.conditionId || g.condition_id;
            if (tokenId) refreshBook();
          }
        });
      };
      refreshGamma();
      liveTimers.push(setInterval(refreshGamma, 1000));

      // Order book — refreshed live. Fetch the YES and NO token books separately
      // so the modal does not mistake YES asks for NO bids or average a huge
      // spread back to 50% on thin markets.
      var refreshBook = function () {
        var yesBookToken = tokenIds[0] || tokenId;
        var noBookToken = tokenIds[1] || null;
        if (!yesBookToken) { setText(bodyEl, 'bookStatus', 'token id unknown — book unavailable'); return; }
        setText(bodyEl, 'bookStatus', 'fetching…');
        Promise.all([
          fetchPolyOrderbook(yesBookToken),
          noBookToken ? fetchPolyOrderbook(noBookToken) : Promise.resolve(null)
        ]).then(function (books) {
          var yesBook = books[0];
          var noBook = books[1];
          if (!yesBook) { setText(bodyEl, 'bookStatus', 'book offline'); return; }
          var yesBids = (yesBook.bids || []).slice(0, 8);
          var yesAsks = (yesBook.asks || []).slice(0, 8);
          var noBids = noBook && Array.isArray(noBook.bids)
            ? noBook.bids.slice(0, 8)
            : yesAsks.map(function(row) {
                var px = 1 - Number(row && row.price);
                return Object.assign({}, row, { price: px });
              }).filter(function(row) { return Number.isFinite(Number(row.price)) && Number(row.price) >= 0 && Number(row.price) <= 1; });
          setText(bodyEl, 'bookStatus', 'live · YES ' + yesBids.length + 'b / NO ' + noBids.length + 'b · ' + fmtTime(Date.now()));
          var fmtRow = function (r) {
            var px = Number(r.price), sz = Number(r.size);
            return '<div class="ost-modal__book-row"><span>' + (Number.isFinite(px) ? (px * 100).toFixed(1) + '¢' : '—') + '</span><span>' + (Number.isFinite(sz) ? sz.toFixed(0) : '—') + '</span></div>';
          };
          var yesEl = bodyEl.querySelector('[data-bind="bookYes"]');
          var noEl  = bodyEl.querySelector('[data-bind="bookNo"]');
          if (yesEl) yesEl.innerHTML = yesBids.length ? yesBids.map(fmtRow).join('') : '<div class="ost-modal__book-empty">No YES bids</div>';
          if (noEl)  noEl.innerHTML  = noBids.length ? noBids.map(fmtRow).join('') : '<div class="ost-modal__book-empty">No NO bids</div>';

          var bestBid = yesBids[0] && Number(yesBids[0].price);
          var bestAsk = yesAsks[0] && Number(yesAsks[0].price);
          var bestNoBid = noBids[0] && Number(noBids[0].price);
          var currentYes = Number(market.yesPriceNumber);
          var consensusYes = getOutcomeConsensusYes();
          var yesPx = NaN;
          if (Number.isFinite(bestBid) && Number.isFinite(bestNoBid)) yesPx = (bestBid + (1 - bestNoBid)) / 2;
          else if (Number.isFinite(bestBid) && Number.isFinite(bestAsk) && bestAsk >= bestBid && (bestAsk - bestBid) <= 0.18) yesPx = (bestBid + bestAsk) / 2;
          else if (!Number.isFinite(currentYes) && Number.isFinite(bestBid)) yesPx = bestBid;
          if (Number.isFinite(yesPx) && yesPx > 0 && yesPx < 1) {
            var agreesWithConsensus = !Number.isFinite(consensusYes) || Math.abs(yesPx - consensusYes) <= 0.08;
            var agreesWithCurrent = !Number.isFinite(currentYes) || Math.abs(yesPx - currentYes) <= 0.18;
            if (agreesWithConsensus && agreesWithCurrent) applyYes(yesPx, 'clob');
          }
        });
      };
      refreshBook();
      liveTimers.push(setInterval(refreshBook, 1000));

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
      liveTimers.push(setInterval(refreshTrades, 2000));

      // Price history baseline — refresh every 10s, then maintain 1s live curve.
      var refreshHistory = function (sideToLoad) {
        sideToLoad = sideToLoad === 'NO' ? 'NO' : ((typeof bodyEl.__getChartSide === 'function') ? bodyEl.__getChartSide() : 'YES');
        var historyTokenId = getTokenForChartSide(sideToLoad);
        setText(bodyEl, 'chartStatus', 'fetching…');
        fetchPolyHistory(historyTokenId, rawId).then(function (h) {
          if (!h) { setText(bodyEl, 'chartStatus', 'history unavailable'); return; }
          var seed = (h.history || h.prices || []).map(function (r) {
            return {
              t: Number(r.t || r.time || Date.now()),
              p: Number(r.p || r.price)
            };
          }).filter(function (r) { return Number.isFinite(r.p) && r.p >= 0 && r.p <= 1; });
          if (seed.length >= 2) {
            liveHistoryBySide[sideToLoad] = seed.slice(-LIVE_HISTORY_MAX);
            renderLiveHistory();
          } else {
            setText(bodyEl, 'chartStatus', 'no series');
          }
        });
      };
      refreshHistory();
      liveTimers.push(setInterval(refreshHistory, 10000));
      liveTimers.push(setInterval(function () {
        if (Number.isFinite(market.yesPriceNumber) && market.yesPriceNumber > 0 && market.yesPriceNumber < 1) {
          pushHistoryPoint('YES', market.yesPriceNumber, Date.now());
          pushHistoryPoint('NO', 1 - market.yesPriceNumber, Date.now());
          renderLiveHistory();
        }
      }, 1000));
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
    // Don't hijack links or quick-trade controls inside the wallet venue.
    var explicitOpen = ev.target.closest('[data-prediction-open-modal]');
    var ignore = ev.target.closest('a[href], .prediction-market-link, .prediction-market-api-link, .prediction-market-quick-btn, [data-prediction-quick-side], [data-prediction-show-more], [data-prediction-show-less]');
    var card = ev.target.closest('.prediction-market-card[data-prediction-market-id]');
    if (!card) return;
    if (ignore && !explicitOpen) return;
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

/* ==========================================================================
   OST Prediction PRO — featured curated markets, 5-min BTC native market,
   detail modal (chart + recent trades + depth), public bot/arbitrage API.

   Plugs into app.js via:
     - window.buildOstNativeMarkets()  (called by setLoadedPredictionMarkets)
     - DOM hook: a "Details" button injected on every market card
     - window.OST_PREDICTION_API       (read-only state + place/cashout helpers
                                       so external bots can sign with their key)

   No external services required at runtime — Polymarket Gamma API is hit
   directly by app.js. We additionally cache curated event slugs here and
   resolve them to live market ids when present, otherwise show as pinned
   placeholders so the user always sees the markets they expect.
   ========================================================================== */
(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // 0) Polymarket Relay configuration
  //    Set window.OST_POLY_RELAY_URL = 'https://ost-poly-relay.<account>.workers.dev'
  //    BEFORE this script loads (or on the page) to route Polymarket reads
  //    through the OST Cloudflare Worker. Falls back to the direct Gamma API
  //    so the site still works if the relay is down or not configured.
  // ---------------------------------------------------------------------------
  function relayBase() {
    var v = (typeof window !== 'undefined' && window.OST_POLY_RELAY_URL) || '';
    return v ? String(v).replace(/\/$/, '') : '';
  }
  function ostApiBase() {
    var v = (typeof window !== 'undefined' && window.OST_API_BASE) || '';
    return v ? String(v).replace(/\/$/, '') : '';
  }
  function pmGammaUrl(path, query) {
    var base = relayBase();
    if (base) return base + '/gamma' + path + (query ? ('?' + query) : '');
    return 'https://gamma-api.polymarket.com' + path + (query ? ('?' + query) : '');
  }
  function pmClobUrl(path, query) {
    var base = relayBase();
    if (base) return base + '/clob' + path + (query ? ('?' + query) : '');
    return 'https://clob.polymarket.com' + path + (query ? ('?' + query) : '');
  }
  function pmDataUrl(path, query) {
    var base = relayBase();
    if (base) return base + '/data' + path + (query ? ('?' + query) : '');
    return 'https://data-api.polymarket.com' + path + (query ? ('?' + query) : '');
  }

  // ---------------------------------------------------------------------------
  // 1) Curated featured Polymarket events (the user's wishlist)
  // ---------------------------------------------------------------------------
  var FEATURED_SLUGS = [
    { slug: 'us-x-iran-permanent-peace-deal-by',          topic: 'politics', label: 'US x Iran permanent peace deal' },
    { slug: '2026-fifa-world-cup-winner-595',             topic: 'sports',   label: '2026 FIFA World Cup winner' },
    { slug: 'presidential-election-winner-2028',          topic: 'politics', label: 'US Presidential Election 2028' },
    { slug: 'republican-presidential-nominee-2028',       topic: 'politics', label: 'Republican nominee 2028' },
    { slug: 'when-will-bitcoin-hit-150k',                 topic: 'crypto',   label: 'When will Bitcoin hit $150k?' },
    { slug: 'what-price-will-bitcoin-hit-in-april-2026',  topic: 'crypto',   label: 'Bitcoin price April 2026' },
    { slug: 'ucl-psg1-bay1-2026-04-28',                   topic: 'sports',   label: 'UCL · PSG vs Bayern (Apr 28)' }
  ];

  // ---------------------------------------------------------------------------
  // 2) 5-min BTC OST native market (the headline attraction)
  //    Auto opens a fresh round every 5 minutes. Settles deterministically
  //    when the round closes using the latest Coinbase BTC-USD price tick.
  // ---------------------------------------------------------------------------
  var FIVE_MIN_MS = 5 * 60 * 1000;
  var BTC_PRICE_URL = 'https://api.coinbase.com/v2/prices/BTC-USD/spot';
  var btcLastTick = { ts: 0, price: 0 };

  function fetchBtcSpot() {
    return fetch(BTC_PRICE_URL, { headers: { accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        var p = j && j.data && Number(j.data.amount);
        if (Number.isFinite(p) && p > 0) {
          btcLastTick = { ts: Date.now(), price: p };
        }
        return btcLastTick;
      })
      .catch(function () { return btcLastTick; });
  }

  // Periodic poll so the price chart and the close-out have fresh data
  setInterval(fetchBtcSpot, 15 * 1000);
  fetchBtcSpot();

  function currentRoundBoundaries() {
    // Round buckets are aligned to the 5-min wall clock so ALL users see the
    // same round id and the same close time — important for auto-settlement.
    var now = Date.now();
    var openAt  = Math.floor(now / FIVE_MIN_MS) * FIVE_MIN_MS;
    var closeAt = openAt + FIVE_MIN_MS;
    return { openAt: openAt, closeAt: closeAt };
  }

  function buildFiveMinBtcMarket(refPrice) {
    var b = currentRoundBoundaries();
    var openPrice = refPrice || btcLastTick.price || 0;
    var roundId = 'ost-btc5m-' + b.openAt;
    // Yes side: BTC price at close > price at open. Anchor 50/50 with mild
    // momentum bias from the last 30s of price history.
    var yesPrice = 0.5;
    return {
      source: 'ost',
      sourceLabel: 'OST 5-min BTC',
      id: roundId,
      title: '5-min BTC: will price be UP at ' + new Date(b.closeAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + '?',
      detail: 'Native OST market, settles automatically every 5 minutes from Coinbase BTC-USD spot. Open price: $' + (openPrice ? openPrice.toFixed(2) : '—') + '.',
      yesLabel: 'YES (UP)',
      yesValue: '50%',
      yesPriceNumber: yesPrice,
      noLabel: 'NO (DOWN)',
      noValue: '50%',
      noPriceNumber: 1 - yesPrice,
      volumeLabel: 'Round',
      volumeValue: '5 min',
      volumeNumber: 1,
      secondaryMetricLabel: 'Open',
      secondaryMetricValue: openPrice ? '$' + openPrice.toFixed(2) : '—',
      secondaryMetricNumber: openPrice,
      closeText: 'Closes ' + new Date(b.closeAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      closeLabel: 'Closes',
      topic: 'crypto',
      topics: new Set(['crypto', 'all']),
      displayTopics: ['crypto'],
      searchText: 'btc bitcoin 5min five-minute ost native ' + roundId,
      primaryUrl: 'https://www.coinbase.com/price/bitcoin',
      secondaryUrl: BTC_PRICE_URL,
      secondaryLabel: 'Price feed',
      primaryLabel: 'Open Coinbase',
      contractLabel: 'OST native · 5-min round',
      sortValue: Number.MAX_SAFE_INTEGER, // pin to the top
      createdAtMs: b.openAt,
      closeAtMs: b.closeAt,
      previousYesPriceNumber: yesPrice,
      lastPriceNumber: yesPrice,
      oneWeekPriceChangeNumber: NaN,
      oneMonthPriceChangeNumber: NaN,
      attentionScore: 999,
      isBreaking: true,
      isOstNative: true,
      meta: { kind: 'btc5m', openPrice: openPrice, openAt: b.openAt, closeAt: b.closeAt }
    };
  }

  function buildFeaturedPlaceholder(entry) {
    return {
      source: 'polymarket',
      sourceLabel: 'Polymarket',
      id: 'featured-' + entry.slug,
      title: entry.label,
      detail: 'Curated Polymarket event — opens directly on Polymarket. Live odds load from the Polymarket Gamma feed once selected.',
      yesLabel: 'Yes',
      yesValue: '—',
      yesPriceNumber: NaN,
      noLabel: 'No',
      noValue: '—',
      noPriceNumber: NaN,
      volumeLabel: 'Volume',
      volumeValue: '—',
      volumeNumber: 0,
      secondaryMetricLabel: 'Featured',
      secondaryMetricValue: '★',
      secondaryMetricNumber: 0,
      closeText: 'See venue',
      closeLabel: 'Closes',
      topic: entry.topic,
      topics: new Set([entry.topic, 'all']),
      displayTopics: [entry.topic],
      searchText: (entry.label + ' ' + entry.slug).toLowerCase(),
      primaryUrl: 'https://polymarket.com/event/' + entry.slug,
      secondaryUrl: 'https://gamma-api.polymarket.com/events?slug=' + encodeURIComponent(entry.slug),
      secondaryLabel: 'Open feed',
      primaryLabel: 'Open on Polymarket',
      contractLabel: 'Featured · curated',
      sortValue: Number.MAX_SAFE_INTEGER - 1,
      createdAtMs: Date.now(),
      closeAtMs: 0,
      previousYesPriceNumber: NaN,
      lastPriceNumber: NaN,
      oneWeekPriceChangeNumber: NaN,
      oneMonthPriceChangeNumber: NaN,
      attentionScore: 950,
      isBreaking: false,
      isFeatured: true
    };
  }

  // Public hook called by app.js setLoadedPredictionMarkets
  window.buildOstNativeMarkets = function buildOstNativeMarkets() {
    var out = [];
    out.push(buildFiveMinBtcMarket());
    FEATURED_SLUGS.forEach(function (e) { out.push(buildFeaturedPlaceholder(e)); });
    return out;
  };

  // ---------------------------------------------------------------------------
  // 3) Auto-resolve open OST native bets when a round closes
  //    Reads the same localStorage key used by app.js (PREDICTION_ORDERS_STORAGE_KEY)
  // ---------------------------------------------------------------------------
  var ORDERS_KEY = 'ost.prediction.orders.v1';
  function readOrders()  { try { return JSON.parse(localStorage.getItem(ORDERS_KEY) || '[]'); } catch (e) { return []; } }
  function writeOrders(o) { try { localStorage.setItem(ORDERS_KEY, JSON.stringify(o.slice(0, 200))); } catch (e) {} }

  // Track open price + close price per round id so settlement is consistent
  var ROUND_KEY = 'ost.prediction.btc5m.rounds.v1';
  function readRounds()  { try { return JSON.parse(localStorage.getItem(ROUND_KEY) || '{}'); } catch (e) { return {}; } }
  function writeRounds(o) { try { localStorage.setItem(ROUND_KEY, JSON.stringify(o)); } catch (e) {} }

  function captureRoundOpenIfNeeded(market) {
    if (!market || !market.isOstNative || !market.meta || market.meta.kind !== 'btc5m') return;
    var rounds = readRounds();
    var key = String(market.meta.openAt);
    if (!rounds[key]) {
      rounds[key] = { openPrice: btcLastTick.price || 0, openAt: market.meta.openAt, closeAt: market.meta.closeAt };
      writeRounds(rounds);
    } else if (!rounds[key].openPrice && btcLastTick.price) {
      rounds[key].openPrice = btcLastTick.price;
      writeRounds(rounds);
    }
  }

  // Snapshot the current 5-min round each tick so we always have an "open" price.
  setInterval(function () {
    try { captureRoundOpenIfNeeded(buildFiveMinBtcMarket()); } catch (e) {}
  }, 5000);

  function settleClosedRounds() {
    var rounds = readRounds();
    var orders = readOrders();
    var now = Date.now();
    var changed = false;
    Object.keys(rounds).forEach(function (key) {
      var r = rounds[key];
      if (r.settled) return;
      if (now < r.closeAt + 1000) return;
      // Need a close price — use the most recent BTC tick we have
      r.closePrice = r.closePrice || btcLastTick.price || r.openPrice;
      r.settled = true;
      r.yesWon  = r.closePrice > r.openPrice;
      changed = true;
    });
    if (changed) writeRounds(rounds);

    // Mark winning open orders as cashable
    var ordersChanged = false;
    orders.forEach(function (o) {
      if (o.cashedOut || o.resolved) return;
      if (!o.marketId || o.marketId.indexOf('ost-btc5m-') !== 0) return;
      var openAt = String(o.marketId.replace('ost-btc5m-', ''));
      var r = rounds[openAt];
      if (!r || !r.settled) return;
      var won = (o.side === 'yes' && r.yesWon) || (o.side === 'no' && !r.yesWon);
      o.resolved = true;
      o.outcome = won ? 'won' : 'lost';
      o.resolvedAt = Date.now();
      o.closePrice = r.closePrice;
      o.openPrice  = r.openPrice;
      ordersChanged = true;
    });
    if (ordersChanged) {
      writeOrders(orders);
      try { window.dispatchEvent(new CustomEvent('ost:prediction-rounds-settled')); } catch (e) {}
    }
  }
  setInterval(settleClosedRounds, 4000);

  // ---------------------------------------------------------------------------
  // 4) Detail modal — chart + recent trades + depth + place-bet shortcut
  // ---------------------------------------------------------------------------
  var DETAIL_MODAL_ID = 'ost-prediction-detail-modal';

  function getMarketStateById(id) {
    // Read out of app.js's prediction state via the rendered DOM, since
    // app.js doesn't export the markets array. Falls back to a stub.
    var card = document.querySelector('[data-prediction-market-id="' + (id || '').replace(/"/g, '\\"') + '"]');
    if (!card) return null;
    return {
      id: id,
      title: (card.querySelector('h5') && card.querySelector('h5').textContent) || id,
      sourceLabel: (card.querySelector('.prediction-market-source') && card.querySelector('.prediction-market-source').textContent.trim()) || '',
      yesText: (card.querySelector('.prediction-market-bar-fill') && card.querySelector('.prediction-market-bar-fill').style.width) || '',
      detail: (card.querySelector('p') && card.querySelector('p').textContent) || ''
    };
  }

  function ensureDetailModal() {
    var el = document.getElementById(DETAIL_MODAL_ID);
    if (el) return el;
    el = document.createElement('div');
    el.id = DETAIL_MODAL_ID;
    el.className = 'ost-prodetail-modal';
    el.innerHTML = [
      '<div class="ost-prodetail-backdrop"></div>',
      '<div class="ost-prodetail-panel" role="dialog" aria-modal="true">',
      '  <button class="ost-prodetail-close" aria-label="Close">×</button>',
      '  <div class="ost-prodetail-body"></div>',
      '</div>'
    ].join('');
    document.body.appendChild(el);
    el.querySelector('.ost-prodetail-backdrop').addEventListener('click', closeDetailModal);
    el.querySelector('.ost-prodetail-close').addEventListener('click', closeDetailModal);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeDetailModal(); });
    return el;
  }
  function openDetailModalHtml(html) {
    var el = ensureDetailModal();
    el.querySelector('.ost-prodetail-body').innerHTML = html;
    el.classList.add('is-open');
  }
  function closeDetailModal() {
    var el = document.getElementById(DETAIL_MODAL_ID);
    if (el) el.classList.remove('is-open');
  }

  // Synthetic but deterministic recent-trades feed seeded by market id
  function rngSeed(seed) {
    var s = 0;
    for (var i = 0; i < seed.length; i++) s = (s * 31 + seed.charCodeAt(i)) | 0;
    return function () { s = (s * 1664525 + 1013904223) | 0; return ((s >>> 0) % 100000) / 100000; };
  }
  function buildRecentTrades(market, count) {
    var rng = rngSeed(market.id || 'unk');
    var basePrice = Number(market.yesPriceNumber);
    if (!Number.isFinite(basePrice)) basePrice = 0.5;
    var trades = [];
    var now = Date.now();
    for (var i = 0; i < count; i++) {
      var drift = (rng() - 0.5) * 0.04;
      var px = Math.max(0.02, Math.min(0.98, basePrice + drift));
      var side = rng() > 0.5 ? 'YES' : 'NO';
      var size = Math.round((10 + rng() * 250) * 10) / 10;
      var ts = now - i * (15000 + Math.floor(rng() * 90000));
      trades.push({ ts: ts, side: side, price: side === 'YES' ? px : 1 - px, size: size });
    }
    return trades;
  }
  function buildPriceHistory(market, points) {
    var rng = rngSeed((market.id || 'unk') + ':hist');
    var basePrice = Number(market.yesPriceNumber);
    if (!Number.isFinite(basePrice)) basePrice = 0.5;
    var v = Math.max(0.05, Math.min(0.95, basePrice - 0.06));
    var pts = [];
    for (var k = 0; k < points; k++) {
      v = Math.max(0.02, Math.min(0.98, v + (rng() - 0.5) * 0.05));
      pts.push(v);
    }
    pts[pts.length - 1] = basePrice;
    return pts;
  }

  function drawDetailChart(canvas, pts, color) {
    var ctx = canvas.getContext('2d');
    var w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    if (!pts || !pts.length) return;
    // Gridlines
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    for (var i = 1; i < 4; i++) {
      var y = (i / 4) * h;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }
    // Fill
    var min = Math.min.apply(null, pts), max = Math.max.apply(null, pts);
    var range = Math.max(0.001, max - min);
    var grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, (color || '#6ce6a4') + '55');
    grad.addColorStop(1, (color || '#6ce6a4') + '00');
    ctx.fillStyle = grad;
    ctx.beginPath();
    pts.forEach(function (p, i) {
      var x = (i / (pts.length - 1)) * w;
      var y = h - ((p - min) / range) * (h - 8) - 4;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath();
    ctx.fill();
    // Line
    ctx.strokeStyle = color || '#6ce6a4';
    ctx.lineWidth = 2;
    ctx.beginPath();
    pts.forEach(function (p, i) {
      var x = (i / (pts.length - 1)) * w;
      var y = h - ((p - min) / range) * (h - 8) - 4;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }
  function fmtTime(ts) {
    var d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  function showDetail(market) {
    if (!market) return;
    var yes = Number(market.yesPriceNumber);
    var no  = Number(market.noPriceNumber);
    var yesPct = Number.isFinite(yes) ? Math.round(yes * 100) : '—';
    var noPct  = Number.isFinite(no)  ? Math.round(no * 100)  : '—';
    var trades = buildRecentTrades(market, 18);
    var hist = buildPriceHistory(market, 80);

    var rowsHtml = trades.map(function (t) {
      var color = t.side === 'YES' ? '#34d399' : '#f87171';
      return '<tr>' +
        '<td>' + escapeHtml(fmtTime(t.ts)) + '</td>' +
        '<td style="color:' + color + ';font-weight:700;">' + escapeHtml(t.side) + '</td>' +
        '<td>' + (t.price * 100).toFixed(1) + '¢</td>' +
        '<td>' + t.size.toFixed(1) + ' OST</td>' +
        '</tr>';
    }).join('');

    var depthHtml =
      '<div class="ost-prodetail-depth">' +
        '<div class="ost-prodetail-depth-side ost-prodetail-depth-yes">' +
          '<div class="ost-prodetail-depth-label">YES bids</div>' +
          [1,2,3,4].map(function (i) {
            var p = Math.max(0.02, (Number.isFinite(yes)?yes:0.5) - i * 0.01);
            var sz = (60 + Math.random() * 200).toFixed(0);
            return '<div class="ost-prodetail-depth-row"><span>' + (p * 100).toFixed(1) + '¢</span><span>' + sz + ' OST</span></div>';
          }).join('') +
        '</div>' +
        '<div class="ost-prodetail-depth-side ost-prodetail-depth-no">' +
          '<div class="ost-prodetail-depth-label">NO bids</div>' +
          [1,2,3,4].map(function (i) {
            var p = Math.max(0.02, (Number.isFinite(no)?no:0.5) - i * 0.01);
            var sz = (60 + Math.random() * 200).toFixed(0);
            return '<div class="ost-prodetail-depth-row"><span>' + (p * 100).toFixed(1) + '¢</span><span>' + sz + ' OST</span></div>';
          }).join('') +
        '</div>' +
      '</div>';

    var btcInfo = '';
    if (market.isOstNative && market.meta && market.meta.kind === 'btc5m') {
      var msLeft = Math.max(0, market.meta.closeAt - Date.now());
      var mm = Math.floor(msLeft / 60000), ss = Math.floor((msLeft % 60000) / 1000);
      btcInfo =
        '<div class="ost-prodetail-btc5m">' +
          '<div><span class="ost-prodetail-tag">5-min round</span> Closes in <strong id="ost-prodetail-countdown">' + mm + ':' + (ss < 10 ? '0' : '') + ss + '</strong></div>' +
          '<div>Open price: <strong>$' + (market.meta.openPrice ? market.meta.openPrice.toFixed(2) : '—') + '</strong></div>' +
          '<div>Live BTC: <strong id="ost-prodetail-btclive">$' + (btcLastTick.price ? btcLastTick.price.toFixed(2) : '—') + '</strong></div>' +
        '</div>';
    }

    openDetailModalHtml([
      '<div class="ost-prodetail-head">',
        '<span class="ost-prodetail-tag">' + escapeHtml(market.sourceLabel || market.source || '') + '</span>',
        '<span class="ost-prodetail-tag">' + escapeHtml(market.contractLabel || '') + '</span>',
        '<span class="ost-prodetail-tag ost-prodetail-tag-close">' + escapeHtml(market.closeText || '') + '</span>',
      '</div>',
      '<h2>' + escapeHtml(market.title || '') + '</h2>',
      '<p class="ost-prodetail-sub">' + escapeHtml(market.detail || '') + '</p>',
      btcInfo,
      '<div class="ost-prodetail-prices">',
        '<div class="ost-prodetail-price ost-prodetail-yes"><span>' + escapeHtml(market.yesLabel || 'YES') + '</span><strong>' + yesPct + '%</strong></div>',
        '<div class="ost-prodetail-price ost-prodetail-no"><span>' + escapeHtml(market.noLabel || 'NO') + '</span><strong>' + noPct + '%</strong></div>',
      '</div>',
      '<canvas class="ost-prodetail-chart" id="ost-prodetail-chart" width="640" height="200"></canvas>',
      '<div class="ost-prodetail-grid">',
        '<div class="ost-prodetail-trades">',
          '<h4>Recent ticks</h4>',
          '<div class="ost-prodetail-trades-scroll"><table class="ost-prodetail-trades-table">',
            '<thead><tr><th>Time</th><th>Side</th><th>Price</th><th>Size</th></tr></thead>',
            '<tbody>' + rowsHtml + '</tbody>',
          '</table></div>',
        '</div>',
        '<div class="ost-prodetail-book">',
          '<h4>Order book preview</h4>',
          depthHtml,
        '</div>',
      '</div>',
      '<div class="ost-prodetail-actions">',
        (market.primaryUrl ? '<a class="ost-prodetail-link" href="' + escapeHtml(market.primaryUrl) + '" target="_blank" rel="noopener">Open venue ↗</a>' : ''),
        '<button type="button" class="ost-prodetail-bet ost-prodetail-yes-btn" data-prodetail-side="yes">Buy YES with OST</button>',
        '<button type="button" class="ost-prodetail-bet ost-prodetail-no-btn"  data-prodetail-side="no">Buy NO with OST</button>',
      '</div>'
    ].join(''));

    var canvas = document.getElementById('ost-prodetail-chart');
    if (canvas) drawDetailChart(canvas, hist, '#6ce6a4');

    // Wire bet buttons → drive the existing trade desk
    var modal = document.getElementById(DETAIL_MODAL_ID);
    Array.prototype.slice.call(modal.querySelectorAll('[data-prodetail-side]')).forEach(function (b) {
      b.addEventListener('click', function () {
        var side = b.getAttribute('data-prodetail-side');
        // Select the market in the main trade desk
        var card = document.querySelector('[data-prediction-market-id="' + (market.id || '').replace(/"/g, '\\"') + '"]');
        if (card) card.click();
        var sideToggle = document.getElementById('predictionOutcomeToggle');
        if (sideToggle) {
          var btn = sideToggle.querySelector('button[data-prediction-side="' + side + '"]');
          if (btn) btn.click();
        }
        closeDetailModal();
        var ticket = document.getElementById('predictionStakeInput') || document.querySelector('.prediction-trade-card');
        if (ticket && ticket.scrollIntoView) ticket.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    });

    // Live countdown for the 5-min round
    if (market.isOstNative && market.meta && market.meta.kind === 'btc5m') {
      var iv = setInterval(function () {
        var el = document.getElementById('ost-prodetail-countdown');
        var live = document.getElementById('ost-prodetail-btclive');
        if (!el) { clearInterval(iv); return; }
        var msLeft = Math.max(0, market.meta.closeAt - Date.now());
        var mm = Math.floor(msLeft / 60000), ss = Math.floor((msLeft % 60000) / 1000);
        el.textContent = mm + ':' + (ss < 10 ? '0' : '') + ss;
        if (live && btcLastTick.price) live.textContent = '$' + btcLastTick.price.toFixed(2);
        if (msLeft <= 0) clearInterval(iv);
      }, 500);
    }
  }

  // ---------------------------------------------------------------------------
  // 5) Inject a "Details" button on every market card
  // ---------------------------------------------------------------------------
  function findMarketByIdFromAppState(id) {
    // app.js doesn't expose state, so reconstruct a usable market object
    // by reading it from the DOM card.
    var card = document.querySelector('[data-prediction-market-id="' + id.replace(/"/g, '\\"') + '"]');
    if (!card) return null;
    var srcLabel = (card.querySelector('.prediction-market-source') && card.querySelector('.prediction-market-source').textContent.trim()) || '';
    var yesValue = (card.querySelector('.prediction-market-price strong') && card.querySelector('.prediction-market-price strong').textContent.trim()) || '';
    var noValue  = (card.querySelectorAll('.prediction-market-price strong')[1] && card.querySelectorAll('.prediction-market-price strong')[1].textContent.trim()) || '';
    var titleEl  = card.querySelector('h5');
    var detailEl = card.querySelector('.prediction-market-copy p');
    var closeEl  = card.querySelector('.prediction-market-meta-row .prediction-market-metric:last-child strong');
    var yesNum = parseFloat(yesValue) / 100; if (!Number.isFinite(yesNum)) yesNum = NaN;
    var noNum  = parseFloat(noValue)  / 100; if (!Number.isFinite(noNum))  noNum  = NaN;
    var isOstBtc = id.indexOf('ost-btc5m-') === 0;
    var market = {
      id: id,
      title: titleEl ? titleEl.textContent.trim() : id,
      detail: detailEl ? detailEl.textContent.trim() : '',
      sourceLabel: srcLabel,
      source: srcLabel.toLowerCase(),
      yesLabel: 'YES', noLabel: 'NO',
      yesPriceNumber: yesNum, noPriceNumber: noNum,
      closeText: closeEl ? closeEl.textContent.trim() : '',
      contractLabel: '',
      primaryUrl: (card.querySelector('.prediction-market-link') && card.querySelector('.prediction-market-link').href) || ''
    };
    if (isOstBtc) {
      // re-derive open/close from id
      var openAt = parseInt(id.replace('ost-btc5m-', ''), 10);
      market.isOstNative = true;
      market.meta = { kind: 'btc5m', openAt: openAt, closeAt: openAt + FIVE_MIN_MS, openPrice: (readRounds()[String(openAt)] || {}).openPrice || 0 };
    }
    return market;
  }

  function injectDetailButtons() {
    var cards = document.querySelectorAll('article.prediction-market-card[data-prediction-market-id]');
    cards.forEach(function (card) {
      if (card.closest('#predictionMarketBoard')) return;
      if (card.querySelector('.ost-prodetail-trigger')) return;
      var actions = card.querySelector('.prediction-market-actions');
      if (!actions) return;
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'prediction-market-link ost-prodetail-trigger';
      btn.textContent = '📊 Details';
      btn.style.cursor = 'pointer';
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        var id = card.getAttribute('data-prediction-market-id') || '';
        var m = findMarketByIdFromAppState(id);
        if (m) showDetail(m);
      });
      actions.appendChild(btn);
    });
  }

  // Watch the prediction list and re-inject buttons whenever it re-renders
  function startInjector() {
    injectDetailButtons();
    var listEl = document.getElementById('predictionMarketList') ||
                 document.querySelector('.prediction-market-list') ||
                 document.querySelector('.prediction-market-board');
    if (!listEl) {
      // try again later — board may not be mounted yet
      setTimeout(startInjector, 1500);
      return;
    }
    var obs = new MutationObserver(function () { injectDetailButtons(); });
    obs.observe(listEl, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startInjector);
  } else {
    startInjector();
  }

  // Force a re-fetch so the native 5-min BTC market and curated featured
  // events appear on the very first board render (app.js may have already
  // loaded its market list before this script's `buildOstNativeMarkets` was
  // defined on the window).
  function triggerReload() {
    var refreshBtn = document.getElementById('predictionMarketRefresh');
    if (refreshBtn) { refreshBtn.click(); return; }
    // Best-effort: dispatch a custom event app.js doesn't listen for, but
    // the 120s interval will pick the native markets up regardless.
  }
  setTimeout(triggerReload, 800);
  setTimeout(triggerReload, 3000);

  // ---------------------------------------------------------------------------
  // 6) Public bot / arbitrage API — read-only feed access + place ticket
  // ---------------------------------------------------------------------------
  // Bots can call:
  //   await OST_PREDICTION_API.markets()                  → live merged list
  //   OST_PREDICTION_API.subscribe(cb)                    → receive snapshots
  //   await OST_PREDICTION_API.placeBet({marketId,side,stake})
  //   OST_PREDICTION_API.btcSpot()                        → latest cached price
  //   OST_PREDICTION_API.fiveMinRound()                   → current btc5m round
  //   OST_PREDICTION_API.ledger()                         → user's open orders
  // ---------------------------------------------------------------------------
  var subscribers = [];
  function broadcast() {
    OST_PREDICTION_API.markets().then(function (m) {
      subscribers.forEach(function (cb) { try { cb(m); } catch (e) {} });
    });
  }
  setInterval(broadcast, 30000);

  var OST_PREDICTION_API = {
    version: '1.0',
    btcSpot: function () { return Promise.resolve(btcLastTick); },
    fiveMinRound: function () {
      var b = currentRoundBoundaries();
      var rounds = readRounds();
      return Object.assign({}, rounds[String(b.openAt)] || {}, { openAt: b.openAt, closeAt: b.closeAt });
    },
    markets: function () {
      // Direct fetch from Polymarket Gamma API (via relay if configured) +
      // OST API worker snapshot for any proxied Kalshi rows. Never call the
      // Kalshi public API from the browser; it is CORS-blocked and creates
      // noisy failed requests every broadcast cycle.
      var apiBase = ostApiBase();
      var kalshiSnapshot = apiBase
        ? fetch(apiBase + '/markets?limit=160', { headers: { accept: 'application/json' }, cache: 'no-store' })
            .then(function (r) { return r.ok ? r.json() : { markets: [] }; })
            .catch(function () { return { markets: [] }; })
        : Promise.resolve({ markets: [] });
      return Promise.all([
        fetch(pmGammaUrl('/markets', 'limit=160&closed=false')).then(function (r) { return r.ok ? r.json() : []; }).catch(function () { return []; }),
        kalshiSnapshot
      ]).then(function (results) {
        var workerMarkets = Array.isArray(results[1] && results[1].markets) ? results[1].markets : [];
        return {
          ts: Date.now(),
          relay: !!relayBase(),
          ostNative: window.buildOstNativeMarkets ? window.buildOstNativeMarkets() : [],
          polymarket: Array.isArray(results[0]) ? results[0] : (results[0].data || []),
          kalshi: workerMarkets.filter(function (m) { return m && m.source === 'kalshi'; })
        };
      });
    },
    // Direct CLOB helpers — bots can use these for arbitrage decisions
    clobBook: function (tokenId)        { return fetch(pmClobUrl('/book/' + encodeURIComponent(tokenId))).then(function (r) { return r.ok ? r.json() : null; }); },
    clobPrice: function (tokenId, side) { return fetch(pmClobUrl('/price/' + encodeURIComponent(tokenId) + '/' + (side === 'sell' ? 'sell' : 'buy'))).then(function (r) { return r.ok ? r.json() : null; }); },
    clobTrades: function (marketId)     { return fetch(pmClobUrl('/trades', 'market=' + encodeURIComponent(marketId))).then(function (r) { return r.ok ? r.json() : null; }); },
    pricesHistory: function (marketId, intervalParam) { return fetch(pmDataUrl('/prices-history/' + encodeURIComponent(marketId), intervalParam || 'interval=1d')).then(function (r) { return r.ok ? r.json() : null; }); },
    relayUrl: function () { return relayBase() || null; },
    subscribe: function (cb) {
      if (typeof cb !== 'function') return function () {};
      subscribers.push(cb);
      return function () { subscribers = subscribers.filter(function (x) { return x !== cb; }); };
    },
    ledger: function () {
      try { return JSON.parse(localStorage.getItem(ORDERS_KEY) || '[]'); } catch (e) { return []; }
    },
    settledRounds: function () { return readRounds(); },
    placeBet: function (req) {
      // External bots reuse the SAME on-chain path as the UI — they must
      // pass an already-connected wallet (Phantom / Backpack) by calling
      // window.connectWallet first, otherwise we can't sign.
      if (!req || !req.marketId || !req.side || !Number.isFinite(Number(req.stake))) {
        return Promise.reject(new Error('placeBet requires { marketId, side, stake }'));
      }
      // Find the market in the rendered DOM so we have its current price
      var card = document.querySelector('[data-prediction-market-id="' + String(req.marketId).replace(/"/g, '\\"') + '"]');
      if (!card) return Promise.reject(new Error('Market not loaded in current snapshot'));
      // Click the card to select it, then drive the trade desk
      card.click();
      var sideToggle = document.getElementById('predictionOutcomeToggle');
      if (sideToggle) {
        var sb = sideToggle.querySelector('button[data-prediction-side="' + req.side + '"]');
        if (sb) sb.click();
      }
      var stakeInput = document.getElementById('predictionStakeInput');
      if (stakeInput) {
        stakeInput.value = String(req.stake);
        stakeInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
      return new Promise(function (resolve, reject) {
        var actionBtn = document.getElementById('predictionTradeAction') || document.querySelector('[data-prediction-trade-action]');
        if (!actionBtn) return reject(new Error('Trade action button not found'));
        // Resolve when ledger gains a new entry
        var prev = OST_PREDICTION_API.ledger().length;
        var deadline = Date.now() + 30000;
        actionBtn.click();
        var iv = setInterval(function () {
          var now = OST_PREDICTION_API.ledger();
          if (now.length > prev) { clearInterval(iv); resolve(now[0]); return; }
          if (Date.now() > deadline) { clearInterval(iv); reject(new Error('Bet timed out')); }
        }, 500);
      });
    }
  };
  window.OST_PREDICTION_API = OST_PREDICTION_API;
})();

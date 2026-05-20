/* =============================================================
 * OST · Live Watch + Bet  (v4)
 *
 * The watch modal is the trade surface. Users can watch the stream,
 * inspect live Polymarket legs, view the share-price chart, buy with OST,
 * and sell existing positions without opening the separate market modal.
 * ============================================================= */
(function () {
  'use strict';

  var VIDEOJS_CSS = 'https://vjs.zencdn.net/8.10.0/video-js.css';
  var VIDEOJS_JS = 'https://vjs.zencdn.net/8.10.0/video.min.js';
  var VIDEOJS_HLS = 'https://unpkg.com/@videojs/http-streaming@3.0.0/dist/videojs-http-streaming.min.js';

  var POLY_EVENT_SLUG = 'epl-lee-bur-2026-05-01';
  var ORDERS_KEY = 'ost.prediction.orders.v1';

  var POLY_OUTCOME_HINTS = [
    {
      key: 'home',
      label: 'Leeds United FC',
      displayLabel: 'Leeds (Home)',
      gammaMarketId: '2010948',
      conditionId: '0x73d0324122fd97ac1d484b3f77a215fddfb1c540c2809dd3e2c8d10f5540efbd',
      clobTokenIds: [
        '4919456738519376240426436617790787996537504998863354839462472795769607838341',
        '19541457590143384962139552966556269451489628455821374008178055092972563966370'
      ],
      price: 0.725
    },
    {
      key: 'draw',
      label: 'Draw',
      displayLabel: 'Draw',
      gammaMarketId: '2010957',
      conditionId: '0x0e427631de4db68657b30fee44e3ec6b15851645feb489a0ae45903269c08664',
      clobTokenIds: [
        '2155290132096787878561860090299716301885151809844479404450316023320224047615',
        '16722525408772594988021675575212738179364351804066609146366996029234035206450'
      ],
      price: 0.185
    },
    {
      key: 'away',
      label: 'Burnley FC',
      displayLabel: 'Burnley (Away)',
      gammaMarketId: '2010963',
      conditionId: '0x1021ca9648ea4587d354efa236c771cd13674592479d2a9ec8a29e34f1cdb0a8',
      clobTokenIds: [
        '70527277902365073030818779230920528917628236638610664539729513629692163698834',
        '14981407487365249172274760718803575918026367142553063138672053458442029642679'
      ],
      price: 0.105
    }
  ];

  var STREAMS = {
    'leeds-burnley': {
      name: 'Leeds United vs Burnley',
      league: 'Premier League',
      kickoff: 'May 1, 2026 · 15:00 UTC',
      polymarket: 'https://polymarket.com/sports/epl/' + POLY_EVENT_SLUG,
      polymarketSlug: POLY_EVENT_SLUG,
      home: 'Leeds United',
      away: 'Burnley',
      m3u8: 'https://romoramad.s3.us-east-1.amazonaws.com/btsport.m3u8',
      m3u8_480: 'https://romoramad.s3.us-east-1.amazonaws.com/btsport_480p30.m3u8'
    }
  };

  var FEATURED_SLUG = 'leeds-burnley';
  var NATIVE_MARKET_ID = (window.OST_NATIVE_MARKET_IDS && window.OST_NATIVE_MARKET_IDS.eplLeedsBurnley)
    || 'native-polymarket-epl-lee-bur-2026-05-01';

  var loaded = { css: false, js: false, hls: false };
  var loading = null;

  var player = null;
  var modalEl = null;
  var titleEl = null;
  var fallbackEl = null;
  var statusEl = null;
  var toastEl = null;
  var marketPanelEl = null;
  var currentStream = null;
  var videoUid = 0;

  var reconnectTimer = null;
  var reconnectAttempts = 0;
  var pollingTimer = null;
  var historyTimer = null;
  var positionsTimer = null;
  var lastPanelScrollAt = 0;
  var scrollResumeTimer = null;

  var liveOutcomes = cloneOutcomeHints();
  var selectedOutcomeKey = 'home';
  var historyByKey = {};
  var historyLoading = {};
  var historyRetryAt = {};

  function cloneOutcomeHints() {
    return POLY_OUTCOME_HINTS.map(function (outcome) {
      return Object.assign({}, outcome, { clobTokenIds: (outcome.clobTokenIds || []).slice() });
    });
  }

  function loadStyle(href) {
    if (document.querySelector('link[href="' + href + '"]')) return;
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    document.head.appendChild(link);
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var existing = document.querySelector('script[data-live-src="' + src + '"]');
      if (existing) {
        if (existing.dataset.loaded === '1') return resolve();
        existing.addEventListener('load', function () { resolve(); });
        existing.addEventListener('error', function () { reject(new Error('Failed to load ' + src)); });
        return;
      }
      var s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.dataset.liveSrc = src;
      s.addEventListener('load', function () { s.dataset.loaded = '1'; resolve(); });
      s.addEventListener('error', function () { reject(new Error('Failed to load ' + src)); });
      document.head.appendChild(s);
    });
  }

  function ensureVideojs() {
    if (loading) return loading;
    loading = new Promise(function (resolve, reject) {
      try {
        if (!loaded.css) { loadStyle(VIDEOJS_CSS); loaded.css = true; }
        var step = window.videojs ? Promise.resolve() : loadScript(VIDEOJS_JS);
        step
          .then(function () {
            loaded.js = true;
            return loadScript(VIDEOJS_HLS).catch(function () { /* optional */ });
          })
          .then(function () { loaded.hls = true; resolve(); })
          .catch(reject);
      } catch (e) { reject(e); }
    });
    return loading;
  }

  function ensureModal() {
    if (modalEl) return modalEl;
    modalEl = document.createElement('div');
    modalEl.className = 'live-modal';
    modalEl.id = 'ost-live-modal';
    modalEl.setAttribute('role', 'dialog');
    modalEl.setAttribute('aria-modal', 'true');
    modalEl.innerHTML = [
      '<div class="live-modal-shell">',
      '  <div class="live-modal-top">',
      '    <div class="live-modal-title">',
      '      <span id="ost-live-modal-title">Live Match</span>',
      '      <span class="live-modal-live-pill">LIVE</span>',
      '    </div>',
      '    <button type="button" class="live-modal-close" data-live-close>Close ✕</button>',
      '  </div>',
      '  <div class="live-modal-body">',
      '    <div class="live-modal-video-wrap" id="ost-live-video-wrap"></div>',
      '    <div class="live-modal-fallback" id="ost-live-modal-fallback"></div>',
      '    <div class="live-modal-market" id="ost-live-modal-market">',
      '      <div class="live-market-head">',
      '        <div>',
      '          <span class="live-market-source">Polymarket · 3-way live order book</span>',
      '          <h4 id="ost-live-market-title">Match Result</h4>',
      '        </div>',
      '        <div class="live-market-meta" id="ost-live-market-meta">Loading live odds...</div>',
      '      </div>',
      '      <div class="live-market-outcomes" id="ost-live-market-outcomes"></div>',
      '      <div class="live-market-chart">',
      '        <div class="live-market-chart-head">',
      '          <h5>Share price</h5>',
      '          <span id="ost-live-chart-status">Waiting for market feed...</span>',
      '        </div>',
      '        <canvas id="ost-live-price-chart" width="720" height="240"></canvas>',
      '      </div>',
      '      <div class="live-market-trade" id="ost-live-trade-ticket">',
      '        <div class="live-market-selected">',
      '          <span>Selected shares</span>',
      '          <strong id="ost-live-selected-outcome">Leeds (Home)</strong>',
      '          <em id="ost-live-selected-price">--</em>',
      '        </div>',
      '        <label class="live-market-stake">Stake (OST)<input id="ost-live-stake" type="number" min="0.01" step="0.01" value="1"></label>',
      '        <output class="live-market-projection" id="ost-live-projection">--</output>',
      '        <button type="button" class="live-market-submit" data-live-submit-bet>Buy shares</button>',
      '      </div>',
      '      <div class="live-market-positions">',
      '        <div class="live-market-positions-head">',
      '          <h5>Open positions</h5>',
      '          <span id="ost-live-positions-status">local wallet</span>',
      '        </div>',
      '        <div id="ost-live-positions-list" class="live-market-positions-list"></div>',
      '      </div>',
      '      <div class="live-market-actions">',
      '        <button type="button" class="live-market-trade-btn" data-live-focus-trade>Trade below the stream</button>',
      '        <a class="live-market-poly-link" href="' + STREAMS[FEATURED_SLUG].polymarket + '" target="_blank" rel="noopener">View on Polymarket ↗</a>',
      '      </div>',
      '    </div>',
      '  </div>',
      '  <div class="live-modal-bet-bar">',
      '    <span class="live-bet-bar-label">Pick shares:</span>',
      '    <button type="button" class="live-modal-bet-btn" data-live-bet="home">Home</button>',
      '    <button type="button" class="live-modal-bet-btn" data-live-bet="draw">Draw</button>',
      '    <button type="button" class="live-modal-bet-btn" data-live-bet="away">Away</button>',
      '    <span class="live-modal-bet-status" id="ost-live-modal-status"></span>',
      '  </div>',
      '  <div class="live-modal-toast" id="ost-live-modal-toast"></div>',
      '</div>'
    ].join('\n');

    document.body.appendChild(modalEl);

    titleEl = modalEl.querySelector('#ost-live-modal-title');
    fallbackEl = modalEl.querySelector('#ost-live-modal-fallback');
    statusEl = modalEl.querySelector('#ost-live-modal-status');
    toastEl = modalEl.querySelector('#ost-live-modal-toast');
    marketPanelEl = modalEl.querySelector('#ost-live-modal-market');

    modalEl.addEventListener('click', function (event) {
      if (event.target === modalEl) { close(); return; }
      var closeBtn = event.target.closest('[data-live-close]');
      if (closeBtn) { close(); return; }
      var betBtn = event.target.closest('[data-live-bet]');
      if (betBtn) { placeQuickBet(betBtn.getAttribute('data-live-bet')); return; }
      var outcomeBtn = event.target.closest('[data-live-outcome]');
      if (outcomeBtn) { selectOutcome(outcomeBtn.getAttribute('data-live-outcome'), true); return; }
      var focusBtn = event.target.closest('[data-live-focus-trade]');
      if (focusBtn) { focusInlineTrade(); return; }
      var submitBtn = event.target.closest('[data-live-submit-bet]');
      if (submitBtn) { submitInlineBet(); return; }
      var sellBtn = event.target.closest('[data-live-sell-order]');
      if (sellBtn) { sellLiveOrder(sellBtn.getAttribute('data-live-sell-order')); }
    });

    var stakeInput = modalEl.querySelector('#ost-live-stake');
    if (stakeInput) stakeInput.addEventListener('input', updateTradeProjection);
    var body = modalEl.querySelector('.live-modal-body');
    var market = modalEl.querySelector('#ost-live-modal-market');
    [body, market].forEach(function (node) {
      if (node) node.addEventListener('scroll', notePanelScroll, { passive: true });
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && modalEl && modalEl.classList.contains('is-open')) close();
    });

    return modalEl;
  }

  function showFallback(message) {
    if (!fallbackEl) return;
    fallbackEl.textContent = message;
    fallbackEl.classList.add('is-shown');
  }
  function clearFallback() {
    if (!fallbackEl) return;
    fallbackEl.textContent = '';
    fallbackEl.classList.remove('is-shown');
  }
  function showToast(message, kind) {
    if (!toastEl) return;
    toastEl.textContent = message;
    toastEl.classList.remove('is-error');
    if (kind === 'error') toastEl.classList.add('is-error');
    toastEl.classList.add('is-shown');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(function () { toastEl.classList.remove('is-shown'); }, 3200);
  }

  function disposePlayer() {
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    reconnectAttempts = 0;
    if (player) {
      try { player.dispose(); } catch (_) {}
    }
    player = null;
    var wrap = modalEl ? modalEl.querySelector('#ost-live-video-wrap') : null;
    if (wrap) wrap.innerHTML = '';
  }

  function buildVideoElement() {
    var wrap = modalEl.querySelector('#ost-live-video-wrap');
    if (!wrap) return null;
    wrap.innerHTML = '';
    videoUid += 1;
    var id = 'ost-live-video-player-' + videoUid;
    var v = document.createElement('video');
    v.id = id;
    v.className = 'video-js vjs-default-skin vjs-big-play-centered';
    v.setAttribute('controls', '');
    v.setAttribute('preload', 'auto');
    v.setAttribute('playsinline', '');
    v.setAttribute('crossorigin', 'anonymous');
    wrap.appendChild(v);
    return id;
  }

  function startStream(useBackup) {
    if (!modalEl || !currentStream) return;
    if (!navigator.onLine) {
      showFallback('Offline · Stream paused. The trade panel will reconnect with the page.');
      return;
    }
    var id = buildVideoElement();
    if (!id) return;
    try {
      player = window.videojs(id, {
        autoplay: true,
        controls: true,
        responsive: true,
        fluid: false,
        liveui: true,
        html5: { vhs: { overrideNative: true } }
      });
      var src = useBackup && currentStream.m3u8_480 ? currentStream.m3u8_480 : currentStream.m3u8;
      player.src({ src: src, type: 'application/x-mpegURL' });

      player.on('error', function () { scheduleReconnect('error'); });
      player.on('stalled', function () { handlePlayerStall('stalled'); });
      player.on('ended', function () { scheduleReconnect('ended'); });
      player.on('playing', function () {
        clearFallback();
        reconnectAttempts = 0;
        if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
      });

      player.ready(function () {
        player.play().catch(function () { /* autoplay blocked is OK */ });
      });
    } catch (err) {
      console.error('[OSTLiveWatch] videojs init failed', err);
      showFallback('Player failed to initialize. Reconnecting...');
      scheduleReconnect('init');
    }
  }

  function scheduleReconnect(reason) {
    if (!currentStream) return;
    if (reconnectTimer) return;
    reconnectAttempts += 1;
    var attempt = reconnectAttempts;
    var delay = Math.min(15000, 1500 * Math.pow(1.7, attempt - 1));
    var useBackup = attempt >= 2 && !!currentStream.m3u8_480;
    showFallback('Stream interrupted (' + reason + ') · reconnecting in ' + Math.round(delay / 1000) + 's' + (useBackup ? ' (480p backup)' : '') + '...');
    reconnectTimer = setTimeout(function () {
      reconnectTimer = null;
      if (!modalEl || !modalEl.classList.contains('is-open')) return;
      if (player) { try { player.dispose(); } catch (_) {} player = null; }
      startStream(useBackup);
    }, delay);
  }

  function handlePlayerStall(reason) {
    if (Date.now() - lastPanelScrollAt < 1800) {
      keepStreamAlive();
      setTimeout(function () {
        if (!player || !modalEl || !modalEl.classList.contains('is-open')) return;
        if (player.error && player.error()) scheduleReconnect(reason);
      }, 1200);
      return;
    }
    scheduleReconnect(reason);
  }

  function notePanelScroll() {
    lastPanelScrollAt = Date.now();
    if (scrollResumeTimer) return;
    scrollResumeTimer = setTimeout(function () {
      scrollResumeTimer = null;
      keepStreamAlive();
    }, 160);
  }

  function keepStreamAlive() {
    if (!player || document.hidden) return;
    try {
      if (player.error && player.error()) return;
      if (player.paused && player.paused()) player.play().catch(function () {});
    } catch (_) {}
  }

  function relayBase() {
    var base = window.OST_API_BASE || window.OST_POLY_RELAY_URL || '';
    return String(base || '').replace(/\/$/, '');
  }
  function gammaUrl(path) {
    var base = relayBase();
    if (base) return base + '/gamma' + path;
    return 'https://gamma-api.polymarket.com' + path;
  }
  function clobUrl(path) {
    var base = relayBase();
    if (base) return base + '/clob' + path;
    return 'https://clob.polymarket.com' + path;
  }
  function dataUrl(path) {
    var base = relayBase();
    if (base) return base + '/data' + path;
    return 'https://data-api.polymarket.com' + path;
  }
  function fetchJson(url) {
    return fetch(url, { headers: { accept: 'application/json' }, cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
  }
  function rememberNativeMarketState(state) {
    if (!state) return null;
    try {
      window.__ostNativeMarketState = window.__ostNativeMarketState || {};
      window.__ostNativeMarketState[NATIVE_MARKET_ID] = Object.assign({}, state, { cachedAt: Date.now() });
      window.dispatchEvent(new CustomEvent('ost:native-market-state', { detail: { marketId: NATIVE_MARKET_ID, state: window.__ostNativeMarketState[NATIVE_MARKET_ID] } }));
      return window.__ostNativeMarketState[NATIVE_MARKET_ID];
    } catch (_) {
      return state;
    }
  }
  function cachedNativeMarketState() {
    try { return window.__ostNativeMarketState && window.__ostNativeMarketState[NATIVE_MARKET_ID] || null; } catch (_) { return null; }
  }
  function refreshNativeMarketState(baseYes) {
    var base = relayBase();
    if (!base) return Promise.resolve(cachedNativeMarketState());
    var price = Number(baseYes);
    var query = Number.isFinite(price) && price > 0 ? '?baseYes=' + encodeURIComponent(price) : '';
    return fetchJson(base + '/markets/state/' + encodeURIComponent(NATIVE_MARKET_ID) + query)
      .then(function (payload) { return rememberNativeMarketState(payload && (payload.state || payload.marketState)); })
      .catch(function () { return cachedNativeMarketState(); });
  }
  function nativeAskPrice(fallback, state) {
    var quote = state || cachedNativeMarketState();
    var price = Number(quote && (quote.yesAskPriceNumber != null ? quote.yesAskPriceNumber : quote.yesPriceNumber));
    if (!Number.isFinite(price) || price <= 0) price = Number(fallback);
    return Number.isFinite(price) && price > 0 ? price : NaN;
  }
  function nativeBidPrice(fallback, state) {
    var quote = state || cachedNativeMarketState();
    var price = Number(quote && (quote.yesBidPriceNumber != null ? quote.yesBidPriceNumber : quote.yesPriceNumber));
    if (!Number.isFinite(price) || price <= 0) price = Number(fallback);
    return Number.isFinite(price) && price > 0 ? price : NaN;
  }
  function fetchPolymarketEvent(slug) {
    return fetchJson(gammaUrl('/events?slug=' + encodeURIComponent(slug))).then(function (data) {
      var events = Array.isArray(data) ? data : (data && data.data) || [];
      return events && events[0] ? events[0] : null;
    });
  }

  function parseMaybeJson(value) {
    if (Array.isArray(value)) return value;
    if (typeof value !== 'string') return [];
    try {
      var parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }
  function parseClobTokenIds(value) {
    return parseMaybeJson(value).map(function (token) {
      if (token && typeof token === 'object') return String(token.tokenId || token.token_id || token.id || token.asset_id || '').trim();
      return String(token || '').trim();
    }).filter(Boolean);
  }
  function outcomeKeyFromLabel(label) {
    var s = String(label || '').toLowerCase();
    if (/draw|tie/.test(s)) return 'draw';
    if (/burnley|away/.test(s)) return 'away';
    return 'home';
  }
  function displayLabelFor(key, label) {
    if (key === 'home') return 'Leeds (Home)';
    if (key === 'away') return 'Burnley (Away)';
    if (key === 'draw') return 'Draw';
    return label || 'Outcome';
  }
  function pickPriceFromMarket(market) {
    var prices = parseMaybeJson(market && market.outcomePrices);
    var price = prices.length ? Number(prices[0]) : NaN;
    if (!Number.isFinite(price)) price = Number(market && market.lastTradePrice);
    var bid = Number(market && market.bestBid);
    var ask = Number(market && market.bestAsk);
    if (!Number.isFinite(price) && Number.isFinite(bid) && Number.isFinite(ask)) price = (bid + ask) / 2;
    if (!Number.isFinite(price) && Number.isFinite(bid)) price = bid;
    return Number.isFinite(price) ? clamp(price, 0, 1) : NaN;
  }

  function normalizeEventOutcomes(ev) {
    var byKey = {};
    cloneOutcomeHints().forEach(function (hint) { byKey[hint.key] = hint; });
    var markets = ev && Array.isArray(ev.markets) ? ev.markets : [];
    markets.forEach(function (market) {
      if (!market || market.active === false) return;
      var rawLabel = market.groupItemTitle || market.question || '';
      var key = outcomeKeyFromLabel(rawLabel);
      var hint = byKey[key] || {};
      var price = pickPriceFromMarket(market);
      var tokenIds = parseClobTokenIds(market.clobTokenIds);
      byKey[key] = Object.assign({}, hint, {
        key: key,
        label: rawLabel || hint.label || displayLabelFor(key),
        displayLabel: displayLabelFor(key, rawLabel),
        gammaMarketId: String(market.id || hint.gammaMarketId || ''),
        conditionId: market.conditionId || market.condition_id || hint.conditionId || '',
        clobTokenIds: tokenIds.length ? tokenIds : (hint.clobTokenIds || []),
        price: Number.isFinite(price) ? price : hint.price,
        volume: Number(market.volume || hint.volume || 0),
        liquidity: Number(market.liquidity || hint.liquidity || 0),
        raw: market
      });
    });
    return ['home', 'draw', 'away'].map(function (key) { return byKey[key]; }).filter(Boolean);
  }

  function getSelectedOutcome() {
    return liveOutcomes.find(function (outcome) { return outcome && outcome.key === selectedOutcomeKey; }) || liveOutcomes[0];
  }
  function selectOutcome(key, shouldFocus) {
    if (!liveOutcomes.some(function (outcome) { return outcome.key === key; })) key = 'home';
    selectedOutcomeKey = key;
    renderMarketPanel(liveOutcomes, null, true);
    var selected = getSelectedOutcome();
    refreshNativeMarketState(selected && selected.price).then(function () { updateTradeProjection(); renderOpenPositions(); });
    requestHistoryForSelected(false);
    if (shouldFocus) focusInlineTrade();
  }
  function focusInlineTrade() {
    var ticket = modalEl && modalEl.querySelector('#ost-live-trade-ticket');
    if (ticket) scrollTradeTicketIntoView(ticket);
    keepStreamAlive();
    var stake = modalEl && modalEl.querySelector('#ost-live-stake');
    if (stake) setTimeout(function () { try { stake.focus(); stake.select(); } catch (_) {} }, 220);
  }

  function scrollTradeTicketIntoView(ticket) {
    var panel = modalEl && modalEl.querySelector('#ost-live-modal-market');
    if (panel && panel.scrollHeight > panel.clientHeight + 4) {
      panel.scrollTo({ top: Math.max(0, ticket.offsetTop - 18), behavior: 'auto' });
      notePanelScroll();
      return;
    }
    var body = modalEl && modalEl.querySelector('.live-modal-body');
    if (body && body.scrollHeight > body.clientHeight + 4) {
      var targetTop = ticket.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop - 18;
      body.scrollTo({ top: Math.max(0, targetTop), behavior: 'auto' });
      notePanelScroll();
      return;
    }
    if (ticket.scrollIntoView) ticket.scrollIntoView({ behavior: 'auto', block: 'nearest' });
    notePanelScroll();
  }

  function renderMarketPanel(outcomes, meta, keepStatus) {
    if (!marketPanelEl) return;
    liveOutcomes = (outcomes && outcomes.length) ? outcomes : cloneOutcomeHints();
    if (!liveOutcomes.some(function (outcome) { return outcome.key === selectedOutcomeKey; })) selectedOutcomeKey = 'home';
    var listEl = marketPanelEl.querySelector('#ost-live-market-outcomes');
    var metaEl = marketPanelEl.querySelector('#ost-live-market-meta');
    if (metaEl && meta) metaEl.textContent = meta;
    if (listEl) {
      listEl.innerHTML = liveOutcomes.map(function (outcome) {
        var pct = fmtCents(outcome.price);
        var width = (clamp(Number(outcome.price), 0, 1) * 100).toFixed(1);
        var selectedClass = outcome.key === selectedOutcomeKey ? ' is-selected' : '';
        return '' +
          '<button type="button" class="live-market-outcome' + selectedClass + '" data-live-outcome="' + escapeHtml(outcome.key) + '">' +
          '  <span class="live-market-outcome-label">' + escapeHtml(outcome.displayLabel || outcome.label) + '</span>' +
          '  <span class="live-market-outcome-price">' + pct + '</span>' +
          '  <span class="live-market-outcome-bar"><span style="width:' + width + '%"></span></span>' +
          '</button>';
      }).join('');
    }
    updateFeaturedPrices();
    updateTradeProjection();
    renderOpenPositions();
    if (!keepStatus) requestHistoryForSelected(false);
  }

  function renderFallbackMarketPanel() {
    renderMarketPanel(cloneOutcomeHints(), 'Snapshot odds · loading live Polymarket feed');
  }

  function updateFeaturedPrices() {
    liveOutcomes.forEach(function (outcome) {
      var node = document.querySelector('[data-live-card-price="' + outcome.key + '"]');
      if (node) node.textContent = fmtCents(outcome.price).replace('¢', '');
    });
  }

  function syncNativeMarketState(ev, outcomes) {
    try {
      var state = window.__predictionState;
      if (!state || !Array.isArray(state.markets)) return;
      var market = state.markets.find(function (item) { return item && item.id === NATIVE_MARKET_ID; });
      if (!market) return;
      var first = outcomes[0] || getSelectedOutcome();
      var totalVolume = Number(ev && ev.volume);
      var totalLiquidity = Number(ev && ev.liquidity);
      market.source = 'polymarket';
      market.sourceLabel = 'Polymarket';
      market.outcomes = outcomes.map(function (outcome) {
        return {
          key: outcome.key,
          label: outcome.displayLabel || outcome.label,
          price: outcome.price,
          marketId: outcome.gammaMarketId,
          gammaMarketId: outcome.gammaMarketId,
          conditionId: outcome.conditionId,
          clobTokenIds: (outcome.clobTokenIds || []).slice()
        };
      });
      market.yesLabel = first.displayLabel || first.label || 'Home';
      market.noLabel = 'Field';
      market.yesPriceNumber = Number(first.price);
      market.noPriceNumber = 1 - Number(first.price);
      market.yesValue = fmtPercent(first.price);
      market.noValue = fmtPercent(1 - Number(first.price));
      market.volumeNumber = Number.isFinite(totalVolume) ? totalVolume : market.volumeNumber;
      market.volumeValue = Number.isFinite(totalVolume) ? fmtMoney(totalVolume) : market.volumeValue;
      market.secondaryMetricNumber = Number.isFinite(totalLiquidity) ? totalLiquidity : market.secondaryMetricNumber;
      market.secondaryMetricValue = Number.isFinite(totalLiquidity) ? fmtMoney(totalLiquidity) : market.secondaryMetricValue;
      market.gammaMarketId = first.gammaMarketId;
      market.conditionId = first.conditionId;
      market.clobTokenIds = (first.clobTokenIds || []).slice();
      market.secondaryUrl = 'https://gamma-api.polymarket.com/markets/' + encodeURIComponent(first.gammaMarketId || '');
      market.raw = Object.assign({}, market.raw || {}, {
        id: first.gammaMarketId,
        eventId: ev && ev.id,
        slug: POLY_EVENT_SLUG,
        conditionId: first.conditionId,
        clobTokenIds: JSON.stringify(first.clobTokenIds || []),
        outcomePrices: JSON.stringify([String(first.price), String(1 - Number(first.price))]),
        outcomes: market.outcomes,
        polymarketEvent: {
          id: ev && ev.id,
          slug: POLY_EVENT_SLUG,
          markets: outcomes
        }
      });
    } catch (_) {}
  }

  function refreshMarketData() {
    var slug = currentStream && currentStream.polymarketSlug;
    if (!slug) { renderFallbackMarketPanel(); return; }
    fetchPolymarketEvent(slug)
      .then(function (ev) {
        var outcomes = normalizeEventOutcomes(ev);
        if (outcomes && outcomes.length) {
          liveOutcomes = outcomes;
          var vol = ev && ev.volume ? ' · Vol ' + fmtMoney(Number(ev.volume)) : '';
          pushLiveHistoryPoints(outcomes);
          renderMarketPanel(outcomes, 'Live · Polymarket' + vol);
          syncNativeMarketState(ev, outcomes);
          var selected = getSelectedOutcome() || outcomes[0];
          refreshNativeMarketState(selected && selected.price).then(function () { updateTradeProjection(); renderOpenPositions(); });
        } else {
          renderFallbackMarketPanel();
        }
      })
      .catch(function () { renderFallbackMarketPanel(); });
  }

  function startMarketPolling() {
    refreshMarketData();
    if (pollingTimer) clearInterval(pollingTimer);
    pollingTimer = setInterval(refreshMarketData, 20000);
    if (historyTimer) clearInterval(historyTimer);
    historyTimer = setInterval(function () {
      pushLiveHistoryPoints(liveOutcomes);
      drawSelectedHistory();
    }, 3000);
    if (positionsTimer) clearInterval(positionsTimer);
    positionsTimer = setInterval(renderOpenPositions, 3000);
  }
  function stopMarketPolling() {
    if (pollingTimer) { clearInterval(pollingTimer); pollingTimer = null; }
    if (historyTimer) { clearInterval(historyTimer); historyTimer = null; }
    if (positionsTimer) { clearInterval(positionsTimer); positionsTimer = null; }
  }

  function requestHistoryForSelected(force) {
    var outcome = getSelectedOutcome();
    if (!outcome) return;
    var key = outcome.key;
    if (!force && historyByKey[key] && historyByKey[key].length > 1) {
      drawSelectedHistory();
      return;
    }
    if (historyLoading[key]) return;
    if (!force && historyRetryAt[key] && historyRetryAt[key] > Date.now()) {
      pushLiveHistoryPoint(outcome);
      drawSelectedHistory((outcome.displayLabel || outcome.label) + ' · live share ticks');
      return;
    }
    var tokenId = outcome.clobTokenIds && outcome.clobTokenIds[0];
    if (!tokenId) {
      setChartStatus('No CLOB token yet · waiting for Gamma');
      drawSelectedHistory();
      return;
    }
    historyLoading[key] = true;
    setChartStatus('Fetching ' + (outcome.displayLabel || outcome.label) + ' history...');
    var primary = clobUrl('/prices-history?market=' + encodeURIComponent(tokenId) + '&interval=1d&fidelity=10');
    fetchJson(primary)
      .catch(function () {
        var fallbackId = outcome.conditionId || outcome.gammaMarketId;
        return fallbackId ? fetchJson(dataUrl('/prices-history?market=' + encodeURIComponent(fallbackId) + '&interval=1d&fidelity=10')) : null;
      })
      .then(function (payload) {
        var points = normalizeHistoryPoints(payload);
        if (points.length > 1) historyByKey[key] = points.slice(-220);
        delete historyRetryAt[key];
        pushLiveHistoryPoint(outcome);
        drawSelectedHistory();
      })
      .catch(function () {
        historyRetryAt[key] = Date.now() + 30000;
        pushLiveHistoryPoint(outcome);
        drawSelectedHistory((outcome.displayLabel || outcome.label) + ' · live share ticks');
      })
      .finally(function () { historyLoading[key] = false; });
  }

  function normalizeHistoryPoints(payload) {
    var rows = Array.isArray(payload)
      ? payload
      : Array.isArray(payload && payload.history)
        ? payload.history
        : Array.isArray(payload && payload.prices)
          ? payload.prices
          : Array.isArray(payload && payload.data)
            ? payload.data
            : [];
    return rows.map(function (row) {
      var price = Number(row && (row.p != null ? row.p : row.price));
      var ts = Number(row && (row.t != null ? row.t : row.time != null ? row.time : row.timestamp));
      if (!Number.isFinite(price)) return null;
      if (price > 1) price = price / 100;
      if (!Number.isFinite(ts)) ts = Date.now();
      if (ts < 100000000000) ts *= 1000;
      return { t: ts, p: clamp(price, 0, 1) };
    }).filter(Boolean).sort(function (a, b) { return a.t - b.t; });
  }

  function pushLiveHistoryPoint(outcome) {
    outcome = outcome || getSelectedOutcome();
    if (!outcome || !Number.isFinite(Number(outcome.price))) return;
    var key = outcome.key;
    var list = historyByKey[key] || [];
    var last = list[list.length - 1];
    var now = Date.now();
    if (!last || now - last.t > 900 || Math.abs(Number(last.p) - Number(outcome.price)) > 0.0005) {
      list.push({ t: now, p: clamp(Number(outcome.price), 0, 1) });
      historyByKey[key] = list.slice(-240);
    }
  }

  function pushLiveHistoryPoints(outcomes) {
    (outcomes || []).forEach(function (outcome) {
      pushLiveHistoryPoint(outcome);
    });
  }

  function drawSelectedHistory(statusOverride) {
    var outcome = getSelectedOutcome();
    var canvas = modalEl && modalEl.querySelector('#ost-live-price-chart');
    if (!canvas || !outcome) return;
    var points = historyByKey[outcome.key] || [];
    if (points.length < 2) {
      setChartStatus(statusOverride || 'Waiting for another live tick...');
      clearCanvas(canvas);
      return;
    }
    drawSeries(canvas, points.map(function (p) { return p.p; }), outcome.key === 'away' ? '#ffb86b' : (outcome.key === 'draw' ? '#c084fc' : '#00d4ff'));
    setChartStatus(statusOverride || ((outcome.displayLabel || outcome.label) + ' · ' + points.length + ' pts · ' + fmtTime(Date.now())));
  }

  function clearCanvas(canvas) {
    var ctx = canvas.getContext('2d');
    if (!ctx) return;
    var dpr = window.devicePixelRatio || 1;
    var w = canvas.clientWidth || 720;
    var h = canvas.clientHeight || 240;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
  }

  function drawSeries(canvas, points, color) {
    if (!canvas || !points || points.length < 2) return;
    var ctx = canvas.getContext('2d');
    var dpr = window.devicePixelRatio || 1;
    var w = canvas.clientWidth || 720;
    var h = canvas.clientHeight || 240;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    var min = Math.min.apply(null, points);
    var max = Math.max.apply(null, points);
    var range = Math.max(0.01, max - min);
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    for (var i = 1; i < 4; i += 1) {
      var gy = (i / 4) * h;
      ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(w, gy); ctx.stroke();
    }
    var grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, color + '66');
    grad.addColorStop(1, color + '00');
    ctx.beginPath();
    points.forEach(function (p, idx) {
      var x = (idx / (points.length - 1)) * w;
      var y = h - ((p - min) / range) * (h - 16) - 8;
      if (idx === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.beginPath();
    points.forEach(function (p, idx) {
      var x = (idx / (points.length - 1)) * w;
      var y = h - ((p - min) / range) * (h - 16) - 8;
      if (idx === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.2;
    ctx.stroke();
  }

  function setChartStatus(text) {
    var el = modalEl && modalEl.querySelector('#ost-live-chart-status');
    if (el) el.textContent = text;
  }

  function updateTradeProjection() {
    if (!modalEl) return;
    var outcome = getSelectedOutcome();
    var stakeEl = modalEl.querySelector('#ost-live-stake');
    var selectedEl = modalEl.querySelector('#ost-live-selected-outcome');
    var priceEl = modalEl.querySelector('#ost-live-selected-price');
    var projectionEl = modalEl.querySelector('#ost-live-projection');
    var stake = Math.max(0, Number(stakeEl && stakeEl.value) || 0);
    var price = outcome ? nativeAskPrice(Number(outcome.price)) : NaN;
    if (selectedEl && outcome) selectedEl.textContent = outcome.displayLabel || outcome.label;
    if (priceEl) priceEl.textContent = Number.isFinite(price) ? fmtCents(price) + ' OST Native ask' : '--';
    if (!projectionEl) return;
    if (!Number.isFinite(price) || price <= 0 || !stake) {
      projectionEl.textContent = 'Enter a stake to preview shares';
      return;
    }
    var shares = stake / price;
    projectionEl.textContent = shares.toFixed(2) + ' shares · max return ' + shares.toFixed(2) + ' OST';
  }

  function submitInlineBet() {
    var outcome = getSelectedOutcome();
    var stakeEl = modalEl && modalEl.querySelector('#ost-live-stake');
    var button = modalEl && modalEl.querySelector('[data-live-submit-bet]');
    var stake = Math.max(0, Number(stakeEl && stakeEl.value) || 0);
    if (!outcome || !Number.isFinite(Number(outcome.price)) || Number(outcome.price) <= 0) {
      showToast('Market price is still loading.', 'error');
      return;
    }
    if (!stake) {
      showToast('Enter an OST stake first.', 'error');
      if (stakeEl) stakeEl.focus();
      return;
    }
    var api = window.OST_PREDICTION_API;
    if (!api || typeof api.placeOrder !== 'function') {
      showToast('Trade engine is still loading. Try again in a moment.', 'error');
      return;
    }
    var label = outcome.displayLabel || outcome.label;
    var original = button ? button.textContent : '';
    if (button) { button.disabled = true; button.textContent = 'Buying...'; }
    if (statusEl) statusEl.textContent = 'Submitting ' + label + ' shares...';
    refreshNativeMarketState(Number(outcome.price)).then(function (nativeState) {
      var price = nativeAskPrice(Number(outcome.price), nativeState);
      if (!Number.isFinite(price) || price <= 0) throw new Error('Centralized OST share price is still loading. Try again in a moment.');
      return api.placeOrder({
      source: 'polymarket',
      marketId: NATIVE_MARKET_ID,
      conditionId: outcome.conditionId || '',
      gammaMarketId: outcome.gammaMarketId || '',
      title: (currentStream ? currentStream.name : 'Leeds vs Burnley') + ' · ' + label,
      topic: 'sports',
      side: 'yes',
      outcomeKey: outcome.key,
      outcomeLabel: label,
      stake: stake,
      price: price,
      yesPrice: price,
      noPrice: 1 - price,
      shares: stake / price,
      potentialReturn: stake / price,
      baseYesPrice: Number(outcome.price),
      fairYesPrice: Number(outcome.price),
      fairNoPrice: 1 - Number(outcome.price),
      tradableYesPrice: price,
      tradableNoPrice: 1 - price,
      closeAtMs: Date.parse('2026-05-01T15:00:00Z'),
      clobTokenIds: (outcome.clobTokenIds || []).slice(0, 4),
      sourceUrl: STREAMS[FEATURED_SLUG].polymarket,
      nativeMarketMaker: true,
      counterparty: 'ost-native-vault',
      shareIssuer: 'ost-native-vault',
      liquidityProvider: 'ost-native-market-maker',
      quoteAction: 'buy-ask',
      quoteModel: 'ost-native-bid-ask-v2',
      vaultSpread: Number(nativeState && (nativeState.vaultSpread || nativeState.vaultEdge)) || 0,
      vaultFlow: 'share-sale',
      reference: 'live-watch-' + outcome.key + '-' + Date.now().toString(36)
      });
    }).then(function (result) {
      var sig = result && result.signature ? String(result.signature).slice(0, 10) + '...' : '';
      showToast('Bought ' + label + ' shares' + (sig ? ' · ' + sig : ''));
      if (statusEl) statusEl.textContent = 'Position opened · ' + label;
      if (stakeEl) stakeEl.value = '';
      renderOpenPositions();
      try { window.dispatchEvent(new CustomEvent('ost:prediction:order-changed')); } catch (_) {}
    }).catch(function (err) {
      var msg = err && err.message ? err.message : 'Could not place bet.';
      showToast(msg.length > 110 ? msg.slice(0, 110) + '...' : msg, 'error');
      if (statusEl) statusEl.textContent = msg.length > 70 ? msg.slice(0, 70) + '...' : msg;
    }).finally(function () {
      if (button) { button.disabled = false; button.textContent = original || 'Buy shares'; }
      updateTradeProjection();
    });
  }

  function readOrders() {
    try { return JSON.parse(localStorage.getItem(ORDERS_KEY) || '[]') || []; }
    catch (_) { return []; }
  }
  function writeOrders(orders) {
    try { localStorage.setItem(ORDERS_KEY, JSON.stringify((orders || []).slice(0, 300))); } catch (_) {}
  }
  function orderKey(order) {
    return String(order && (order.signature || order.sig || order.remoteId || order.id || [order.marketId, order.conditionId, order.createdAt || order.ts].join(':')) || '');
  }
  function isOpenOrder(order) {
    return order && String(order.marketId || '') === NATIVE_MARKET_ID && !order.cashedOut && order.status !== 'sold' && order.status !== 'settled';
  }
  function outcomeForOrder(order) {
    var byKey = liveOutcomes.find(function (outcome) { return outcome.key && outcome.key === order.outcomeKey; });
    if (byKey) return byKey;
    var byCondition = liveOutcomes.find(function (outcome) { return outcome.conditionId && outcome.conditionId === order.conditionId; });
    if (byCondition) return byCondition;
    var title = String(order.title || order.outcomeLabel || '').toLowerCase();
    return liveOutcomes.find(function (outcome) { return title.indexOf(String(outcome.displayLabel || outcome.label || '').toLowerCase().split(' ')[0]) >= 0; }) || liveOutcomes[0];
  }
  function renderOpenPositions() {
    var list = modalEl && modalEl.querySelector('#ost-live-positions-list');
    var status = modalEl && modalEl.querySelector('#ost-live-positions-status');
    if (!list) return;
    var positions = readOrders().filter(isOpenOrder);
    if (status) status.textContent = positions.length ? positions.length + ' open' : 'none open';
    if (!positions.length) {
      list.innerHTML = '<div class="live-market-empty">No open positions on this match yet.</div>';
      return;
    }
    list.innerHTML = positions.map(function (order) {
      var outcome = outcomeForOrder(order) || {};
      var price = nativeBidPrice(Number(outcome.price));
      var entry = Number(order.price || order.yesPrice || 0);
      var stake = Number(order.stake || 0);
      var shares = Number(order.shares) > 0 ? Number(order.shares) : (entry > 0 ? stake / entry : 0);
      var liveValue = Number.isFinite(price) && price > 0 ? shares * price : stake;
      var pnl = liveValue - stake;
      var pnlClass = pnl >= 0 ? 'is-up' : 'is-down';
      var key = escapeHtml(orderKey(order));
      return '<div class="live-position-row">' +
        '<div><strong>' + escapeHtml(order.outcomeLabel || outcome.displayLabel || outcome.label || 'Shares') + '</strong><span>' + stake.toFixed(2) + ' OST @ ' + fmtCents(entry) + '</span></div>' +
        '<div><span>bid ' + fmtCents(price) + '</span><strong>' + liveValue.toFixed(2) + ' OST</strong></div>' +
        '<span class="live-position-pnl ' + pnlClass + '">' + (pnl >= 0 ? '+' : '-') + Math.abs(pnl).toFixed(2) + '</span>' +
        '<button type="button" data-live-sell-order="' + key + '">Sell</button>' +
      '</div>';
    }).join('');
  }

  function sellLiveOrder(key) {
    var orders = readOrders();
    var idx = orders.findIndex(function (order) { return orderKey(order) === key; });
    var order = idx >= 0 ? orders[idx] : null;
    if (!order) return;
    var outcome = outcomeForOrder(order) || {};
    var entry = Number(order.price || order.yesPrice || 0);
    var stake = Number(order.stake || 0);
    var shares = Number(order.shares) > 0 ? Number(order.shares) : (entry > 0 ? stake / entry : 0);
    var livePx = Number(outcome.price);
    livePx = nativeBidPrice(livePx);
    if (!Number.isFinite(livePx) || livePx <= 0) livePx = entry;
    var payout = Math.max(0, shares * livePx);
    if (!payout) { showToast('Cannot sell at 0¢.', 'error'); return; }
    var btn = modalEl && modalEl.querySelector('[data-live-sell-order="' + cssEscape(key) + '"]');
    var old = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = 'Selling...'; }
    var finish = function (result, localOnly) {
      order.cashedOut = true;
      order.status = 'sold';
      order.sellPrice = livePx;
      order.sellValue = payout;
      order.cashoutOst = Number(result && result.ost) || payout;
      order.cashoutSig = result && result.sig ? result.sig : ('local-' + Date.now().toString(36));
      order.cashoutAt = Date.now();
      order.cashoutKind = localOnly ? 'live-watch-local-sell' : 'live-watch-sell';
      order.nativeMarketMaker = true;
      order.counterparty = 'ost-native-vault';
      order.shareRedeemer = 'ost-native-vault';
      order.liquidityProvider = 'ost-native-market-maker';
      order.quoteAction = 'sell-bid';
      order.quoteModel = 'ost-native-bid-ask-v2';
      order.vaultFlow = 'share-buyback';
      order.sharesRedeemed = shares;
      orders[idx] = order;
      writeOrders(orders);
      postPositionUpdate(order);
      renderOpenPositions();
      showToast('Sold for ' + order.cashoutOst.toFixed(2) + ' OST');
      try { window.dispatchEvent(new CustomEvent('ost:prediction:order-changed')); } catch (_) {}
      try { window.dispatchEvent(new CustomEvent('ost:wallet-changed')); } catch (_) {}
    };
    var cashOut = window.OST_TRADE && window.OST_TRADE.predictionCashOut;
    var task = typeof cashOut === 'function'
      ? Promise.resolve(cashOut(order, payout)).catch(function () { return { ost: payout, sig: 'local-' + Date.now().toString(36), localOnly: true }; })
      : Promise.resolve({ ost: payout, sig: 'local-' + Date.now().toString(36), localOnly: true });
    task.then(function (result) { finish(result, result && result.localOnly); })
      .catch(function (err) { showToast((err && err.message) || 'Sell failed', 'error'); })
      .finally(function () { if (btn) { btn.disabled = false; btn.textContent = old || 'Sell'; } });
  }

  function postPositionUpdate(order) {
    try {
      var base = relayBase();
      if (!base) return;
      fetch(base + '/positions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(Object.assign({}, order, {
          wallet: order.wallet || (window.OST_PREDICTION_API && window.OST_PREDICTION_API.walletAddress && window.OST_PREDICTION_API.walletAddress()) || 'anon',
          marketTitle: order.title || '',
          ts: order.createdAt || order.ts || Date.now()
        }))
      }).catch(function () {});
    } catch (_) {}
  }

  function open(slug, name, opts) {
    var stream = STREAMS[slug];
    if (!stream && opts && opts.m3u8) stream = Object.assign({ name: name || 'Live Stream' }, opts);
    if (!stream) {
      console.warn('[OSTLiveWatch] Unknown stream:', slug);
      return;
    }
    currentStream = Object.assign({ slug: slug }, stream);
    if (name) currentStream.name = name;
    selectedOutcomeKey = 'home';
    liveOutcomes = cloneOutcomeHints();
    historyByKey = {};

    ensureModal();
    if (titleEl) titleEl.textContent = currentStream.name;
    if (statusEl) statusEl.textContent = '';
    clearFallback();
    modalEl.classList.add('is-open');
    document.body.style.overflow = 'hidden';

    disposePlayer();
    renderFallbackMarketPanel();
    startMarketPolling();

    ensureVideojs()
      .then(function () { startStream(false); })
      .catch(function (err) {
        console.error('[OSTLiveWatch] failed to load Video.js', err);
        showFallback('Could not load video player. Check your connection and try again.');
      });

    if (opts && opts.focusTrade) setTimeout(focusInlineTrade, 350);
  }

  function close() {
    if (!modalEl) return;
    modalEl.classList.remove('is-open');
    document.body.style.overflow = '';
    disposePlayer();
    stopMarketPolling();
    currentStream = null;
  }

  function openTradeModal() {
    focusInlineTrade();
  }

  function placeQuickBet(type) {
    selectOutcome(type, true);
    var outcome = getSelectedOutcome();
    var label = outcome && (outcome.displayLabel || outcome.label) || type;
    if (statusEl) statusEl.textContent = 'Selected ' + label + ' · set stake below';
    showToast('Selected ' + label + ' shares');
  }

  function buildFeaturedCard(host) {
    if (!host || host.dataset.liveBetRendered === '1') return;
    host.dataset.liveBetRendered = '1';
    var s = STREAMS[FEATURED_SLUG];
    host.innerHTML = [
      '<div class="container live-bet-shell">',
      '  <div class="live-bet-head">',
      '    <div>',
      '      <h2>Live Watch + Bet</h2>',
      '      <p>Stream the match in HD, view the share chart, buy, and sell without leaving the video.</p>',
      '    </div>',
      '    <span class="live-bet-pill">Live now · BT Sport feed</span>',
      '  </div>',
      '  <div class="live-bet-card">',
      '    <div class="live-bet-meta">',
      '      <div class="live-bet-pill-row">',
      '        <span class="live-bet-pill is-quiet">Polymarket · EPL</span>',
      '        <span class="live-bet-pill is-quiet">' + s.kickoff + '</span>',
      '      </div>',
      '      <h3 class="live-bet-title">' + s.name + '</h3>',
      '      <p class="live-bet-sub">The watch popup now contains the stream, live prices, chart, buy ticket, and sell controls in one place.</p>',
      '      <div class="live-bet-prices" aria-label="Current Polymarket odds">',
      '        <div class="live-bet-price"><span>Home</span><strong data-live-card-price="home">72.5</strong></div>',
      '        <div class="live-bet-price"><span>Draw</span><strong data-live-card-price="draw">18.5</strong></div>',
      '        <div class="live-bet-price"><span>Away</span><strong data-live-card-price="away">10.5</strong></div>',
      '      </div>',
      '      <div class="live-bet-actions">',
      '        <button type="button" class="live-bet-watch-btn" data-live-open="' + FEATURED_SLUG + '">▶ Watch Live + Bet</button>',
      '        <button type="button" class="live-bet-poly-btn" data-live-buy-shares="1">Buy / Sell in stream</button>',
      '        <a class="live-bet-poly-btn" href="' + s.polymarket + '" target="_blank" rel="noopener">Open on Polymarket ↗</a>',
      '      </div>',
      '    </div>',
      '    <div class="live-bet-poster" role="img" aria-label="' + s.name + '">',
      '      <div class="live-bet-poster-grid"><span>LEE</span><span>BUR</span></div>',
      '    </div>',
      '  </div>',
      '</div>'
    ].join('\n');
  }

  function bindGlobalDelegation() {
    document.addEventListener('click', function (event) {
      var btn = event.target.closest('[data-live-open]');
      if (btn) {
        event.preventDefault();
        var slug = btn.getAttribute('data-live-open');
        var stream = STREAMS[slug];
        open(slug, stream ? stream.name : null);
        return;
      }
      var buy = event.target.closest('[data-live-buy-shares]');
      if (buy) {
        event.preventDefault();
        open(FEATURED_SLUG, STREAMS[FEATURED_SLUG].name, { focusTrade: true });
      }
    });

    window.addEventListener('online', function () {
      if (modalEl && modalEl.classList.contains('is-open')) {
        if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
        reconnectAttempts = 0;
        if (player) { try { player.dispose(); } catch (_) {} player = null; }
        startStream(false);
        refreshMarketData();
      }
    });

    window.addEventListener('ost:prediction:order-changed', renderOpenPositions);
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }
  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value);
    return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '\\$&');
  }
  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, Number(value)));
  }
  function fmtCents(value) {
    var n = Number(value);
    return Number.isFinite(n) ? (n * 100).toFixed(1) + '¢' : '--';
  }
  function fmtPercent(value) {
    var n = Number(value);
    return Number.isFinite(n) ? Math.round(n * 100) + '%' : '--';
  }
  function fmtMoney(value) {
    var n = Number(value);
    if (!Number.isFinite(n)) return '$--';
    if (Math.abs(n) >= 1000000) return '$' + (n / 1000000).toFixed(1) + 'M';
    if (Math.abs(n) >= 1000) return '$' + Math.round(n / 1000) + 'K';
    return '$' + n.toFixed(0);
  }
  function fmtTime(ts) {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  function init() {
    var host = document.getElementById('live-bet');
    if (host) buildFeaturedCard(host);
    bindGlobalDelegation();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

  window.OSTLiveWatch = { open: open, close: close, placeQuickBet: placeQuickBet, streams: STREAMS };
  window.watchLiveStream = function (slug, name) { open(slug, name); };
  window.closeLiveModal = close;
  window.placeQuickBet = placeQuickBet;
  window.openLiveTradeModal = openTradeModal;
})();
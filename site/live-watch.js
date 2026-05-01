/* =============================================================
 * OST · Live Watch + Bet  (v3)
 *
 * Self-contained module that:
 *  - Renders a featured Polymarket "live sports" card (Leeds vs Burnley)
 *    inside the markets section.
 *  - Lazy-loads Video.js + HLS playback for live HLS streams.
 *  - Surfaces a "Watch Live" modal that combines:
 *      • the HLS player
 *      • a live, embedded 3-outcome (Home / Draw / Away) Polymarket market
 *      • a quick OST bet bar that deep-links into the full trade desk
 *  - Pulls live odds from the OST Polymarket relay (gamma proxy) on open
 *    and refreshes them every 20s while the modal is open.
 *  - Recovers from stream disconnects: error → 480p → reconnect with
 *    exponential backoff, and fully rebuilds the player on every open so
 *    reopening always works.
 *
 * Public API:
 *   window.OSTLiveWatch.open(slug, name, opts?)
 *   window.OSTLiveWatch.close()
 *   window.watchLiveStream(slug, name)   // back-compat alias
 *   window.closeLiveModal()              // back-compat alias
 *   window.placeQuickBet(type)           // back-compat alias
 * ============================================================= */
(function () {
  'use strict';

  var VIDEOJS_CSS = 'https://vjs.zencdn.net/8.10.0/video-js.css';
  var VIDEOJS_JS = 'https://vjs.zencdn.net/8.10.0/video.min.js';
  var VIDEOJS_HLS = 'https://unpkg.com/@videojs/http-streaming@3.0.0/dist/videojs-http-streaming.min.js';

  var POLY_EVENT_SLUG = 'epl-lee-bur-2026-05-01';

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
      '          <span class="live-market-source">Polymarket · 3-way</span>',
      '          <h4 id="ost-live-market-title">Match Result</h4>',
      '        </div>',
      '        <div class="live-market-meta" id="ost-live-market-meta">Loading live odds…</div>',
      '      </div>',
      '      <div class="live-market-outcomes" id="ost-live-market-outcomes"></div>',
      '      <div class="live-market-actions">',
      '        <button type="button" class="live-market-trade-btn" data-live-open-trade>Open full trade desk ↗</button>',
      '        <a class="live-market-poly-link" href="' + STREAMS[FEATURED_SLUG].polymarket + '" target="_blank" rel="noopener">View on Polymarket</a>',
      '      </div>',
      '    </div>',
      '  </div>',
      '  <div class="live-modal-bet-bar">',
      '    <span class="live-bet-bar-label">Quick OST bet:</span>',
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
      if (outcomeBtn) { placeQuickBet(outcomeBtn.getAttribute('data-live-outcome')); return; }
      var tradeBtn = event.target.closest('[data-live-open-trade]');
      if (tradeBtn) { openTradeModal(); }
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
  function showToast(message) {
    if (!toastEl) return;
    toastEl.textContent = message;
    toastEl.classList.add('is-shown');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(function () { toastEl.classList.remove('is-shown'); }, 2400);
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
      showFallback('Offline · Stream paused. The bet desk still works on devnet.');
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
      player.on('stalled', function () { scheduleReconnect('stalled'); });
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
      showFallback('Player failed to initialize. Reconnecting…');
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
    showFallback('Stream interrupted (' + reason + ') · reconnecting in ' + Math.round(delay / 1000) + 's' + (useBackup ? ' (480p backup)' : '') + '…');
    reconnectTimer = setTimeout(function () {
      reconnectTimer = null;
      if (!modalEl || !modalEl.classList.contains('is-open')) return;
      if (player) { try { player.dispose(); } catch (_) {} player = null; }
      startStream(useBackup);
    }, delay);
  }

  // ─── Live market data (Polymarket via OST relay) ─────────────
  function relayBase() {
    var base = window.OST_API_BASE || window.OST_POLY_RELAY_URL || '';
    return String(base || '').replace(/\/$/, '');
  }
  function gammaUrl(path) {
    var base = relayBase();
    if (base) return base + '/gamma' + path;
    return 'https://gamma-api.polymarket.com' + path;
  }
  function fetchPolymarketEvent(slug) {
    var url = gammaUrl('/events?slug=' + encodeURIComponent(slug));
    return fetch(url, { headers: { 'Accept': 'application/json' } })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (data) {
        var events = Array.isArray(data) ? data : (data && data.data) || [];
        return events && events[0] ? events[0] : null;
      });
  }
  function pickOutcomesFromEvent(ev) {
    if (!ev || !Array.isArray(ev.markets)) return null;
    var outcomes = ev.markets
      .filter(function (m) { return m && m.active !== false && (m.question || m.groupItemTitle); })
      .map(function (m) {
        var label = m.groupItemTitle || m.question || '';
        var price = NaN;
        try {
          if (m.outcomePrices) {
            var arr = typeof m.outcomePrices === 'string' ? JSON.parse(m.outcomePrices) : m.outcomePrices;
            if (Array.isArray(arr) && arr.length) price = Number(arr[0]);
          }
          if (!Number.isFinite(price) && m.lastTradePrice) price = Number(m.lastTradePrice);
        } catch (_) {}
        return { label: label, price: price };
      })
      .filter(function (o) { return Number.isFinite(o.price); });
    if (!outcomes.length) return null;
    outcomes.sort(function (a, b) {
      var pri = function (label) {
        var s = String(label || '').toLowerCase();
        if (/draw|tie/.test(s)) return 1;
        if (/leeds|home/.test(s)) return 0;
        if (/burnley|away/.test(s)) return 2;
        return 3;
      };
      return pri(a.label) - pri(b.label);
    });
    return outcomes;
  }
  function renderMarketPanel(outcomes, meta) {
    if (!marketPanelEl) return;
    var listEl = marketPanelEl.querySelector('#ost-live-market-outcomes');
    var metaEl = marketPanelEl.querySelector('#ost-live-market-meta');
    if (metaEl) metaEl.textContent = meta || ('Live · ' + outcomes.length + ' outcomes');
    if (!listEl) return;
    listEl.innerHTML = outcomes.map(function (o, i) {
      var pct = (Math.max(0, Math.min(1, o.price)) * 100).toFixed(1);
      var key = i === 0 ? 'home' : (i === 1 ? 'draw' : 'away');
      return '' +
        '<button type="button" class="live-market-outcome" data-live-outcome="' + key + '">' +
        '  <span class="live-market-outcome-label">' + escapeHtml(o.label || key.toUpperCase()) + '</span>' +
        '  <span class="live-market-outcome-price">' + pct + '¢</span>' +
        '  <span class="live-market-outcome-bar"><span style="width:' + pct + '%"></span></span>' +
        '</button>';
    }).join('');
  }
  function renderFallbackMarketPanel() {
    var snap = [
      { label: 'Leeds (Home)', price: 0.46 },
      { label: 'Draw', price: 0.27 },
      { label: 'Burnley (Away)', price: 0.31 }
    ];
    renderMarketPanel(snap, 'Snapshot odds · live feed offline');
  }
  function refreshMarketData() {
    var slug = currentStream && currentStream.polymarketSlug;
    if (!slug) { renderFallbackMarketPanel(); return; }
    fetchPolymarketEvent(slug)
      .then(function (ev) {
        var outcomes = pickOutcomesFromEvent(ev);
        if (outcomes && outcomes.length) {
          var vol = ev && ev.volume ? ' · Vol $' + Math.round(Number(ev.volume) / 1000) + 'K' : '';
          renderMarketPanel(outcomes, 'Live · Polymarket' + vol);
          try {
            var state = window.__predictionState;
            if (state && Array.isArray(state.markets)) {
              for (var i = 0; i < state.markets.length; i += 1) {
                if (state.markets[i] && state.markets[i].id === NATIVE_MARKET_ID) {
                  state.markets[i].outcomes = outcomes.map(function (o) { return { label: o.label, price: o.price }; });
                  state.markets[i].yesPriceNumber = outcomes[0].price;
                  state.markets[i].noPriceNumber = 1 - outcomes[0].price;
                  state.markets[i].yesValue = (outcomes[0].price * 100).toFixed(0) + '%';
                  state.markets[i].noValue = ((1 - outcomes[0].price) * 100).toFixed(0) + '%';
                  break;
                }
              }
            }
          } catch (_) {}
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
  }
  function stopMarketPolling() {
    if (pollingTimer) { clearInterval(pollingTimer); pollingTimer = null; }
  }

  // ─── Modal lifecycle ─────────────────────────────────────────
  function open(slug, name, opts) {
    var stream = STREAMS[slug];
    if (!stream && opts && opts.m3u8) {
      stream = Object.assign({ name: name || 'Live Stream' }, opts);
    }
    if (!stream) {
      console.warn('[OSTLiveWatch] Unknown stream:', slug);
      return;
    }
    currentStream = Object.assign({ slug: slug }, stream);
    if (name) currentStream.name = name;

    ensureModal();
    if (titleEl) titleEl.textContent = currentStream.name;
    if (statusEl) statusEl.textContent = '';
    clearFallback();
    modalEl.classList.add('is-open');
    document.body.style.overflow = 'hidden';

    // Always tear down before starting — prevents the "second open won't load" bug.
    disposePlayer();

    renderFallbackMarketPanel();
    startMarketPolling();

    ensureVideojs()
      .then(function () { startStream(false); })
      .catch(function (err) {
        console.error('[OSTLiveWatch] failed to load Video.js', err);
        showFallback('Could not load video player. Check your connection and try again.');
      });
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
    try {
      if (window.OST_MARKET_MODAL && typeof window.OST_MARKET_MODAL.open === 'function') {
        window.OST_MARKET_MODAL.open(NATIVE_MARKET_ID);
        return;
      }
    } catch (_) {}
    if (currentStream && currentStream.polymarket) {
      window.open(currentStream.polymarket, '_blank', 'noopener');
    }
  }

  function placeQuickBet(type) {
    if (!currentStream) return;
    var label = ({
      home: currentStream.home || 'Home',
      draw: 'Draw',
      away: currentStream.away || 'Away'
    })[type] || type;
    if (statusEl) statusEl.textContent = '✓ Selected ' + label + ' · routing to trade desk…';
    showToast('Opening OST trade desk · ' + label);
    openTradeModal();
  }

  // ─── Featured card on the markets page ───────────────────────
  function buildFeaturedCard(host) {
    if (!host || host.dataset.liveBetRendered === '1') return;
    host.dataset.liveBetRendered = '1';
    var s = STREAMS[FEATURED_SLUG];
    host.innerHTML = [
      '<div class="container live-bet-shell">',
      '  <div class="live-bet-head">',
      '    <div>',
      '      <h2>Live Watch + Bet</h2>',
      '      <p>Stream the match in HD and trade the same Polymarket contract from one panel.</p>',
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
      '      <p class="live-bet-sub">Watch the live HLS broadcast and route OST bets through the embedded 3-way market (Home / Draw / Away).</p>',
      '      <div class="live-bet-prices" aria-label="Current Polymarket odds (snapshot)">',
      '        <div class="live-bet-price"><span>Home</span><strong>0.46</strong></div>',
      '        <div class="live-bet-price"><span>Draw</span><strong>0.27</strong></div>',
      '        <div class="live-bet-price"><span>Away</span><strong>0.31</strong></div>',
      '      </div>',
      '      <div class="live-bet-actions">',
      '        <button type="button" class="live-bet-watch-btn" data-live-open="' + FEATURED_SLUG + '">▶ Watch Live + Bet</button>',
      '        <button type="button" class="live-bet-poly-btn" data-live-buy-shares="1">Buy Shares (3-way)</button>',
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
        openTradeModal();
      }
    });

    // Auto-reconnect when network comes back during a live session.
    window.addEventListener('online', function () {
      if (modalEl && modalEl.classList.contains('is-open')) {
        if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
        reconnectAttempts = 0;
        if (player) { try { player.dispose(); } catch (_) {} player = null; }
        startStream(false);
      }
    });
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
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
})();

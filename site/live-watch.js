/* =============================================================
 * OST · Live Watch + Bet
 * Self-contained module that:
 *  - Renders a featured Polymarket "live sports" card (Leeds vs Burnley).
 *  - Lazy-loads Video.js + HLS playback for live HLS streams.
 *  - Surfaces a "Watch Live" modal with a quick OST bet bar.
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

  // Catalog of live streams. Keyed by slug.
  var STREAMS = {
    'leeds-burnley': {
      name: 'Leeds United vs Burnley',
      league: 'Premier League',
      kickoff: 'May 1, 2026 · 15:00 UTC',
      polymarket: 'https://polymarket.com/sports/epl/epl-lee-bur-2026-05-01',
      home: 'Leeds United',
      away: 'Burnley',
      m3u8: 'https://romoramad.s3.us-east-1.amazonaws.com/btsport.m3u8',
      m3u8_480: 'https://romoramad.s3.us-east-1.amazonaws.com/btsport_480p30.m3u8'
    }
  };

  var FEATURED_SLUG = 'leeds-burnley';

  var loaded = { css: false, js: false, hls: false };
  var loading = null;
  var player = null;
  var modalEl = null;
  var titleEl = null;
  var fallbackEl = null;
  var statusEl = null;
  var toastEl = null;
  var currentStream = null;

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
            // videojs 8 has HLS support built-in via VHS; loading the plugin
            // adds remote HLS quality features but is optional.
            if (window.videojs && window.videojs.getTech && window.videojs.getTech('Html5')) {
              return loadScript(VIDEOJS_HLS).catch(function () { /* optional */ });
            }
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
      '  <div class="live-modal-video-wrap">',
      '    <video id="ost-live-video-player" class="video-js vjs-default-skin vjs-big-play-centered" controls preload="auto" playsinline crossorigin="anonymous"></video>',
      '  </div>',
      '  <div class="live-modal-fallback" id="ost-live-modal-fallback"></div>',
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

    modalEl.addEventListener('click', function (event) {
      if (event.target === modalEl) close();
      var closeBtn = event.target.closest('[data-live-close]');
      if (closeBtn) close();
      var betBtn = event.target.closest('[data-live-bet]');
      if (betBtn) placeQuickBet(betBtn.getAttribute('data-live-bet'));
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
    if (player && typeof player.dispose === 'function') {
      try { player.dispose(); } catch (_) {}
    }
    player = null;
  }

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

    if (!navigator.onLine) {
      showFallback('Offline · Stream paused. Reconnect to resume the live feed. Bet bar still works on the OST devnet.');
      return;
    }

    ensureVideojs()
      .then(function () {
        var videoEl = modalEl.querySelector('#ost-live-video-player');
        if (!videoEl) return;
        // Recreate video tag each open to avoid Video.js disposal artifacts.
        var fresh = videoEl.cloneNode(false);
        videoEl.parentNode.replaceChild(fresh, videoEl);
        disposePlayer();
        try {
          player = window.videojs('ost-live-video-player', {
            autoplay: true,
            controls: true,
            responsive: true,
            fluid: false,
            liveui: true,
            html5: { vhs: { overrideNative: true } }
          });
          player.src({ src: currentStream.m3u8, type: 'application/x-mpegURL' });
          player.on('error', function () {
            if (currentStream.m3u8_480 && player.currentSrc() !== currentStream.m3u8_480) {
              player.src({ src: currentStream.m3u8_480, type: 'application/x-mpegURL' });
              player.play().catch(function () {});
              showFallback('Switched to 480p backup feed.');
              return;
            }
            showFallback('Live feed temporarily unavailable. Try reopening or check the Polymarket page for status.');
          });
          player.ready(function () {
            player.play().catch(function () { /* autoplay may be blocked, controls work */ });
          });
        } catch (err) {
          console.error('[OSTLiveWatch] videojs init failed', err);
          showFallback('Player failed to initialize. Reload the page and try again.');
        }
      })
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
    currentStream = null;
  }

  function placeQuickBet(type) {
    if (!currentStream) return;
    var label = ({ home: currentStream.home || 'Home', draw: 'Draw', away: currentStream.away || 'Away' })[type] || type;
    if (statusEl) statusEl.textContent = '✓ Routing to trade desk · ' + label + '…';
    showToast('Opening OST trade desk · ' + label);

    // Deep-link into the existing prediction trade modal (3-outcome flow).
    try {
      var nativeId = (window.OST_NATIVE_MARKET_IDS && window.OST_NATIVE_MARKET_IDS.eplLeedsBurnley)
        || 'native-polymarket-epl-lee-bur-2026-05-01';
      if (window.OST_MARKET_MODAL && typeof window.OST_MARKET_MODAL.open === 'function') {
        window.OST_MARKET_MODAL.open(nativeId);
        // Hand-off: leave the live modal open in the background so the user
        // can keep watching while the trade desk pops over the top.
        return;
      }
    } catch (e) { /* fall back to local record */ }

    // Fallback: write a local pending order so the wallet panel reflects it.
    try {
      var record = {
        id: 'live-' + currentStream.slug + '-' + type + '-' + Date.now(),
        marketId: 'native-polymarket-epl-lee-bur-2026-05-01',
        market: currentStream.name,
        outcome: label,
        side: type,
        amountOst: 10,
        source: 'polymarket',
        sourceUrl: currentStream.polymarket || '',
        ts: Date.now(),
        status: 'pending'
      };
      var KEY = 'ost.prediction.orders.v1';
      var raw = localStorage.getItem(KEY);
      var list = raw ? JSON.parse(raw) : [];
      if (Array.isArray(list)) {
        list.push(record);
        localStorage.setItem(KEY, JSON.stringify(list.slice(-200)));
      }
      window.dispatchEvent(new CustomEvent('ost-tx-history-update'));
    } catch (_) { /* non-fatal */ }
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
      '      <p>Stream the match in HD and route quick OST bets from the same panel.</p>',
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
      '      <p class="live-bet-sub">Watch the live HLS broadcast and place 10 OST quick bets on Home, Draw, or Away. Settles against the official Polymarket result.</p>',
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
        var nativeId = (window.OST_NATIVE_MARKET_IDS && window.OST_NATIVE_MARKET_IDS.eplLeedsBurnley)
          || 'native-polymarket-epl-lee-bur-2026-05-01';
        if (window.OST_MARKET_MODAL && typeof window.OST_MARKET_MODAL.open === 'function') {
          window.OST_MARKET_MODAL.open(nativeId);
        } else {
          window.open(STREAMS[FEATURED_SLUG].polymarket, '_blank', 'noopener');
        }
      }
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
  // Back-compat aliases (the user's spec referenced these globals).
  window.watchLiveStream = function (slug, name) { open(slug, name); };
  window.closeLiveModal = close;
  window.placeQuickBet = placeQuickBet;
})();

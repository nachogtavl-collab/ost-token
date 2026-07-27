const CACHE_NAME = 'ost-pwa-cache-v368';
const RUNTIME_CACHE = 'ost-pwa-runtime-v253';
const CACHE_PREFIX = 'ost-pwa-';

const PRECACHE_PATHS = [
  './',
  './index.html',
  './markets.html',
  './desktop.html',
  './fast-markets.js?v=5',
  './ost-pyth.js?v=2',
  './ost-tick-turbo.js?v=5',
  './commerce.html',
  './ost-money.js?v=3',
  './ost-house.js?v=1',
  './ost-prices.js?v=3',
  './ost-arbitrage.js?v=1',
  './ost-quantum.js?v=1',
  './ost-parlay.js?v=3',
  './ost-games-meta.js?v=1',
  './ost-games-identity.js?v=1',
  './prediction-modal-redesign.css?v=1',
  './ost-live-prices.js?v=1',
  './ost-telemetry.js?v=1',
  './ost-live-stats.js?v=2',
  './ost-treasury-engine.js?v=2',
  './ost-engine-guard.js?v=1',
  './ost-appbar.js?v=11',
  './ost-ghost-brain.js?v=3',
  './ost-world.js?v=4',
  './ost-world-bubble.js?v=4',
  './ost-shortcuts.js?v=1',
  './ost-games-lanes.js?v=1',
  './ost-balance.js?v=2',
  './ost-onchain-sync.js?v=1',
  './ost-loan-usd.js?v=1',
  './ost-currency-colors.css?v=1',
  './ost-cards-hub.js?v=10',
  './ost-ostg-source.js?v=5',
  './ost-ghost-companion.js?v=4',
  './ost-data-guard.js?v=3',
  './ost-balance-tree.js?v=1',
  './ost-pro-fast-tiles.js?v=1',
  './ost-wc-rail.js?v=1',
  './ost-mobile-fit.css?v=1',
  './ost-appbar.css?v=2',
  './predict-mobile.css?v=2',
  './ost-total-balance.js?v=2',
  './ost-ostg-wallet.js?v=1',
  './manifest.json',
  './favicon.svg',
  './ost-logo.svg',
  './icon-192.png',
  './icon-512.png',
  './style.css?v=79',
  './mobile.css?v=7',
  './polish.css?v=1',
  './compartments.css?v=3',
  './prediction-extras.css?v=5',
  './prediction-pro.css?v=1',
  './prediction-modal.css?v=6',
  './prediction-trade-popout.css?v=5',
  './prediction-pro-dash.css?v=4',
  './ost-console.css?v=1',
  './prediction-scalar.css?v=1',
  './faucet-hub.css?v=4',
  './topup.css?v=4',
  './offline-vault.css?v=1',
  './stock-market.css?v=1',
  './mobile-shell.css?v=14',
  './ost-mobile-scale.css?v=3',
  './rpc-multiplexer.js?v=200',
  './ost-optimistic.js?v=5',
  './ost-celebrate.js?v=1',
  './ost-fx.js?v=2',
  './ost-currency-format.js?v=2',
  './realtime.js?v=2',
  './ost-notifications.js?v=3',
  './app.js?v=242',
  './ost-predict-mobile.js?v=18',
  './ost-predict-mobile.css?v=6',
  './ost-session-key.js?v=6',
  './ost-onchain-market.js?v=7',
  './ost-onchain-route.js?v=3',
  './ost-lazy.js?v=1',
  './ost-instant.js?v=1',
  './ost-instant.css?v=1',
  './icons.js?v=1',
  './nuevo-laredo-gas.js?v=2',
  './shop-quickview.js?v=3',
  './interchange-live.js?v=2',
  './polish.js?v=2',
  './swap-pool.js?v=2',
  './wallet-extras.js?v=208',
  './ost-price-client.js?v=202',
  './ost-token-section.js?v=2',
  './assets/ost-metadata.json',
  './assets/ost-logo.svg',
  './ghost/ghost.js?v=8',
  './ghost/ghost-terminal.js?v=1',
  './ghost/orb.js?v=1',
  './ghost/translator.js?v=4',
  './ghost/core.js?v=1',
  './ghost/mesh.js?v=1',
  './ghost/recursive.js?v=1',
  './ghost/signal.js?v=1',
  './ghost/awareness.js?v=1',
  './ghost/ghost.css?v=3',
  './mesh/mesh.js?v=36',
  './mesh/veil.js?v=1',
  './mesh/mesh-play.js?v=14',
  './mesh/mesh-fair-fx.js?v=1',
  './mesh/mesh-upgrade.js?v=13',
  './vendor/qrcode-generator.js',
  './vendor/jsqr.min.js',
  './mesh/mesh-link.js?v=2',
  './mesh/mesh-games.js?v=2',
  './mesh/games/tictactoe.js?v=1',
  './mesh/games/chess.js?v=1',
  './mesh/games/pool8.js?v=1',
  './mesh/games/cuppong.js?v=1',
  './mesh/games/minigolf.js?v=1',
  './mesh/mesh-social-x.js?v=3',
  './mesh/mesh-group-markets.js?v=2',
  './mesh/mesh-location-pro.js?v=7',
  './mesh/mesh-crypto.js?v=1',
  './mesh/mesh-rtc.js?v=10',
  './mesh/mesh.css?v=14',
  './compartments.js?v=7',
  './prediction-extras.js?v=18',
  './ost-positions.js?v=2',
  './prediction-pro.js?v=206',
  './prediction-scalar.js?v=4',
  './prediction-modal.js?v=210',
  './ost-ticket-overlay.js?v=2',
  './prediction-trade-popout.js?v=10',
  './prediction-pro-dash.js?v=15',
  './ost-console.js?v=3',
  './ost-onchain-bet.js?v=200',
  './ux-extras.js?v=10',
  './mobile-shell.js?v=12',
  './faucet-hub.js?v=18',
  './faucet-hub-ads.js?v=101',
  './ost-idle-guard.js?v=2',
  './ost-update.js?v=1',
  './ost-offline-mode.js?v=1',
  './ost-bridge-ui.js?v=3',
  './ost-play.js?v=11',
  './ost-audit.js?v=2',
  './offline-vault.js?v=10',
  './ost-scroll-fix.css?v=1',
  './apple-tap.js?v=4',
  './ost-card.js?v=8',
  './launchpad-engine.js?v=7',
  './swap-resilient.js?v=202',
  './ost-games.js?v=30',
  './code-academy.js?v=3',
  './i18n-runtime.js?v=4',
  './devnet-rescue.js?v=204',
  './launchpad-trenches.js?v=6',
  './stock-market.js?v=13',
  './topup.js?v=12',
  './live-watch.css?v=5',
  './live-watch.js?v=200',
  './native-markets.js?v=3',
  './redesign.css?v=1',
  './redesign.js?v=1',
  './mainnet-audit.js?v=1',
  './ost-pq-demo.js?v=1',
  './ost-microfx.js?v=2',
  './ost-microfx.css?v=1',
  // three.js + leaflet are lazy-loaded on demand (runtime-cached when used), so
  // they are intentionally NOT precached — keeps the SW install light on mobile.
  'https://unpkg.com/@solana/web3.js@1.98.0/lib/index.iife.min.js',
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Playfair+Display:wght@400;600;700&display=swap',
  'https://fonts.googleapis.com/css2?family=Noto+Sans+Egyptian+Hieroglyphs&display=swap'
];

const scopeUrl = new URL(self.registration.scope);
const OFFLINE_URL = new URL('./', scopeUrl).toString();
const INDEX_URL = new URL('./index.html', scopeUrl).toString();

function toScopedUrl(path) {
  return new URL(path, scopeUrl).toString();
}

function canCache(request, response) {
  if (!response) return false;
  if (response.type === 'opaque') return true;
  if (!response.ok) return false;
  return request.method === 'GET';
}

async function putInCache(cacheName, request, response) {
  if (!canCache(request, response)) return;
  const cache = await caches.open(cacheName);
  await cache.put(request, response.clone());
}

// How many files the SW may pull at once while precaching.
//
// This used to be `Promise.allSettled(urls.map(cache.add))` — all 136 files
// fired AT ONCE, each with `cache: 'reload'` so they bypass the HTTP cache and
// really hit the network. Every deploy bumps CACHE_NAME, so that storm re-ran
// after EVERY push, fighting the page's own ~250 requests for bandwidth and
// sockets. That is why the app "got slow after the last pushes".
//
// A small pool keeps the install cheap and leaves the network free for the page
// the user is actually looking at.
const PRECACHE_CONCURRENCY = 4;

// The shell the app cannot render without. Fetched first; everything else is
// topped up afterwards, so a cold install never blocks on a game or a 3D lib.
const CRITICAL = /(?:^|\/)(?:index\.html|markets\.html|style\.css|app\.js|manifest\.json|sw\.js)$|\/$/i;

async function fetchInto(cache, url) {
  try {
    await cache.add(new Request(url, { cache: 'reload' }));
  } catch (_) {
    /* one missing asset must never fail the whole install */
  }
}

async function pooled(cache, urls, limit) {
  let i = 0;
  const workers = new Array(Math.min(limit, urls.length)).fill(0).map(async () => {
    while (i < urls.length) {
      const url = urls[i++];
      await fetchInto(cache, url);
    }
  });
  await Promise.all(workers);
}

async function precache() {
  const cache = await caches.open(CACHE_NAME);
  const urls = PRECACHE_PATHS.map(toScopedUrl);
  const critical = urls.filter((u) => CRITICAL.test(u));
  const rest = urls.filter((u) => !CRITICAL.test(u));

  // Only the shell is awaited — install completes fast.
  await pooled(cache, critical, PRECACHE_CONCURRENCY);

  // The rest fills in behind the user's back. Deliberately NOT awaited: the
  // install event should not hold the network hostage while they wait to trade.
  pooled(cache, rest, PRECACHE_CONCURRENCY);
}

async function navigationResponse(request) {
  try {
    const networkResponse = await fetch(request);
    await putInCache(RUNTIME_CACHE, request, networkResponse);
    return networkResponse;
  } catch (_) {
    return (await caches.match(request))
      || (await caches.match(OFFLINE_URL))
      || (await caches.match(INDEX_URL))
      || Response.error();
  }
}

async function cacheFirstResponse(request) {
  const cached = await caches.match(request);
  if (cached) {
    fetch(request)
      .then((response) => putInCache(RUNTIME_CACHE, request, response))
      .catch(() => {});
    return cached;
  }

  try {
    const networkResponse = await fetch(request);
    await putInCache(RUNTIME_CACHE, request, networkResponse);
    return networkResponse;
  } catch (_) {
    return cached || Response.error();
  }
}

async function networkFirstResponse(request) {
  try {
    const networkResponse = await fetch(request, { cache: 'no-store' });
    await putInCache(RUNTIME_CACHE, request, networkResponse);
    return networkResponse;
  } catch (_) {
    return (await caches.match(request)) || Response.error();
  }
}

// Serve from cache, then refresh in the background. The user gets bytes at disk
// speed and still ends up on the newest code by the next load.
async function staleWhileRevalidate(request) {
  const cached = await caches.match(request);
  const network = fetch(request)
    .then((response) => {
      putInCache(CACHE_NAME, request, response.clone()).catch(() => {});
      return response;
    })
    .catch(() => null);

  if (cached) return cached;                 // instant
  const fresh = await network;
  return fresh || (await caches.match(request)) || Response.error();
}

// WHY THIS CHANGED
//
// This used to return true for every .html, .css AND .js — sending all of them
// down networkFirstResponse(), which fetches with `cache: 'no-store'`. That
// means on EVERY page load the browser re-downloaded ~1MB across ~99 scripts
// from the network, deliberately bypassing the HTTP cache, and only touched the
// SW cache if the network FAILED. A PWA that re-downloads its whole codebase on
// every visit cannot feel fast, and on a flaky connection a single dropped
// request hard-failed a feature outright (no cached copy to fall back to).
//
// Scripts and styles are already versioned (`?v=N`), so a changed file has a
// changed URL. They can safely be served from cache and revalidated behind the
// user's back. Only DOCUMENTS stay network-first, so a new deploy is still
// picked up immediately rather than being pinned to a stale shell.
function isSameOrigin(request) {
  try { return new URL(request.url).origin === scopeUrl.origin; } catch (_) { return false; }
}

function shouldNetworkFirst(request) {
  try {
    const url = new URL(request.url);
    if (url.origin !== scopeUrl.origin) return false;
    return /\.html$/i.test(url.pathname) || url.pathname === scopeUrl.pathname || url.pathname.endsWith('/');
  } catch (_) {
    return false;
  }
}

function shouldStaleWhileRevalidate(request) {
  try {
    const url = new URL(request.url);
    if (url.origin !== scopeUrl.origin) return false;
    return /\.(?:css|js|json|svg|woff2?|png|jpg|jpeg|webp)$/i.test(url.pathname);
  } catch (_) {
    return false;
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(precache().then(() => {
    // skipWaiting() is RIGHT on a first install and WRONG on an update.
    //
    // First install — nothing is controlling this page yet, so activating at
    // once costs nobody anything and makes the app work offline from the very
    // first visit instead of the second.
    //
    // Update — `registration.active` exists, meaning a page is open RIGHT NOW
    // running the OLD JS. Seizing control of it mid-session means that old JS
    // starts fetching NEW assets: version skew, where app.js from build N talks
    // to modules from build N+1. That is a whole genre of "it froze / it went
    // weird after a while" bugs, and it is self-inflicted. So we stay in the
    // waiting state and let the page decide when to swap — ost-update.js asks
    // the user, then posts OST_SKIP_WAITING below.
    if (!self.registration.active) return self.skipWaiting();
    return undefined;
  }));
});

// The page has told us the user accepted the new version and is ready to reload.
// This is the ONLY path that takes over a live session.
self.addEventListener('message', (event) => {
  const data = event && event.data;
  if (data && data.type === 'OST_SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names
        .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME && name !== RUNTIME_CACHE)
        .map((name) => caches.delete(name))))
      .then(() => self.clients.claim())
  );
});

// Static things that are worth serving from cache when the network is gone.
// `destination` is the browser telling us what the request is FOR, which is far
// more reliable than sniffing file extensions off a URL.
//
// Deliberately absent: '' / 'empty' — that is fetch() and XHR, i.e. every live
// API poll (markets/state, spot, coingecko, kraken). See the fetch handler.
const CACHEABLE_DESTINATIONS = new Set(['style', 'script', 'font', 'image']);

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  // Only OUR navigations. A cross-origin <iframe> navigation (the a-ads banners)
  // is also routed through this worker, and answering it meant awaiting a fetch
  // to a third-party ad server — pinning the worker as a pending event for as
  // long as that server felt like taking, on every ad refresh. We could never
  // serve that response from our cache anyway, so intercepting it was pure cost.
  if (request.mode === 'navigate') {
    if (isSameOrigin(request)) event.respondWith(navigationResponse(request));
    return;
  }

  if (shouldNetworkFirst(request)) {
    event.respondWith(networkFirstResponse(request));
    return;
  }
  // Versioned code/assets: cache-first, revalidated in the background.
  if (shouldStaleWhileRevalidate(request)) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }
  // Cross-origin static assets we precache (web3.js from unpkg, Google fonts).
  if (CACHEABLE_DESTINATIONS.has(request.destination)) {
    event.respondWith(cacheFirstResponse(request));
    return;
  }

  // EVERYTHING ELSE FALLS THROUGH UNTOUCHED — AND THAT IS THE WHOLE POINT.
  //
  // This used to end in a catch-all `event.respondWith(cacheFirstResponse(...))`
  // that swallowed every GET on the page. Both helpers above bail on cross-origin,
  // so each of OST's live API polls — markets/state several times a SECOND, spot,
  // coingecko, kraken — landed in that catch-all. Two bad consequences:
  //
  //  1. IT MADE THE APP UNUPDATABLE. Calling respondWith() makes the fetch a
  //     PENDING EVENT on the active worker. The spec's "Try Activate" step only
  //     activates a waiting worker when the active one has NO pending events AND
  //     (nobody is using it OR skipWaiting was called). skipWaiting() waives the
  //     clients half — it does NOT waive pending events. A live trading app never
  //     has zero in-flight fetches, so that condition was never true and a new
  //     worker could NEVER take over a running page. Measured: 12 requests still
  //     open 8s after load. This is why fixes never reached testers and why only
  //     fully closing the app ever picked up a new build.
  //  2. It cache-first'd live market data — an extra worker hop on every tick,
  //     for responses that must never come from a cache.
  //
  // A service worker that does not call respondWith() lets the browser do the
  // request directly: no interception, no pending event, no hop. So between asset
  // loads the worker is genuinely idle and an update can land.
});

function notificationPayload(data = {}) {
  return {
    title: data.title || 'OST Mesh',
    options: {
      body: data.body || '',
      icon: data.icon || './icon-192.png',
      badge: data.badge || './icon-192.png',
      tag: data.tag || 'ost-mesh',
      renotify: false,
      requireInteraction: !!data.requireInteraction,
      vibrate: data.vibrate || [90, 45, 90],
      data: {
        url: data.url || './?openMesh=1',
        type: data.type || 'mesh'
      },
      actions: data.actions || [{ action: 'open', title: 'Open OST Mesh' }]
    }
  };
}

const NOTIFICATION_COOLDOWN_MS = 30000;
const URGENT_NOTIFICATION_COOLDOWN_MS = 12000;
const notificationLastShownAt = new Map();

function shouldShowNotification(data = {}) {
  if (data.force && data.type === 'system') return true;
  const tag = data.tag || `ost-mesh-${data.type || 'mesh'}`;
  const now = Date.now();
  const type = data.type || 'mesh';
  const cooldown = type === 'call' || type === 'video-call' || type === 'challenge'
    ? URGENT_NOTIFICATION_COOLDOWN_MS
    : NOTIFICATION_COOLDOWN_MS;
  if (now - (notificationLastShownAt.get(tag) || 0) < cooldown) return false;
  notificationLastShownAt.set(tag, now);
  return true;
}

// In-memory cache of the user's most recent location fix, set by the page
// before unload so background sync handlers can replay it. Survives only as
// long as the SW is alive — for true persistence the page also writes to
// localStorage and re-hydrates on next load.
let __ostLastLocation = null;

self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'ost-notify') {
    if (!shouldShowNotification(data)) return;
    const payload = notificationPayload(data);
    event.waitUntil(self.registration.showNotification(payload.title, payload.options));
    return;
  }
  if (data.type === 'ost-location-cache' && data.fix) {
    __ostLastLocation = { fix: data.fix, session: data.session || null, cachedAt: Date.now() };
  }
});

async function broadcastLocationPing(reason) {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const msg = { type: 'ost-location-bg-tick', reason: reason, fix: __ostLastLocation && __ostLastLocation.fix, ts: Date.now() };
  clients.forEach((c) => { try { c.postMessage(msg); } catch (e) {} });
}

self.addEventListener('sync', (event) => {
  if (event.tag === 'ost-location-ping') {
    event.waitUntil(broadcastLocationPing('sync'));
  }
});

self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'ost-location-periodic') {
    event.waitUntil(broadcastLocationPing('periodic'));
  }
});

// Server pushes carry NO encrypted payload on purpose (see workers/ost-api/src/
// push.js): that crypto fails silently when it is subtly wrong, which is the
// worst way for an alert system to break. Instead we wake and ask what happened,
// so the notification shows what is true NOW rather than when it was queued.
async function pendingMessage() {
  try {
    const sub = await self.registration.pushManager.getSubscription();
    if (!sub) return null;
    const base = 'https://ost-api.nachogtavl.workers.dev';
    const res = await fetch(base + '/push/pending?endpoint=' + encodeURIComponent(sub.endpoint), { cache: 'no-store' });
    if (!res.ok) return null;
    const m = await res.json();
    return (m && m.title) ? m : null;
  } catch (_) { return null; }
}

self.addEventListener('push', (event) => {
  event.waitUntil((async () => {
    let data = {};
    try { data = event.data ? event.data.json() : {}; }
    catch (_) {
      try { data = { title: 'OST', body: event.data ? event.data.text() : '' }; } catch (__) { data = {}; }
    }
    // No payload = a bare VAPID push from our worker. Go find out what it means.
    if (!event.data) data = (await pendingMessage()) || data;

    // userVisibleOnly is a promise to the browser that every push shows a
    // notification; silently returning here can cost us the push permission
    // entirely. So if we have nothing to say, still say something true.
    if (!shouldShowNotification(data)) {
      if (!data || !data.title) {
        await self.registration.showNotification('OST', { body: 'Tap to open OST.', icon: './icon-192.png', tag: 'ost-generic' });
      }
      return;
    }
    const payload = notificationPayload(data);
    await self.registration.showNotification(payload.title, payload.options);
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data && event.notification.data.url || './?openMesh=1', scopeUrl).toString();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.startsWith(scopeUrl.origin) && 'focus' in client) {
          client.postMessage({ type: 'ost-open-mesh', url: targetUrl });
          return client.focus();
        }
      }
      return clients.openWindow(targetUrl);
    })
  );
});

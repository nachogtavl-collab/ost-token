const CACHE_NAME = 'ost-pwa-cache-v238';
const RUNTIME_CACHE = 'ost-pwa-runtime-v238';
const CACHE_PREFIX = 'ost-pwa-';

const PRECACHE_PATHS = [
  './',
  './index.html',
  './markets.html',
  './desktop.html',
  './fast-markets.js?v=1',
  './commerce.html',
  './ost-money.js?v=2',
  './ost-house.js?v=1',
  './ost-prices.js?v=1',
  './ost-arbitrage.js?v=1',
  './ost-quantum.js?v=1',
  './ost-parlay.js?v=3',
  './ost-games-meta.js?v=1',
  './ost-games-identity.js?v=1',
  './prediction-modal-redesign.css?v=1',
  './ost-live-prices.js?v=1',
  './ost-telemetry.js?v=1',
  './ost-live-stats.js?v=1',
  './ost-treasury-engine.js?v=2',
  './ost-engine-guard.js?v=1',
  './ost-appbar.js?v=3',
  './ost-ghost-companion.js?v=1',
  './ost-data-guard.js?v=1',
  './ost-pro-fast-tiles.js?v=1',
  './ost-wc-rail.js?v=1',
  './ost-mobile-fit.css?v=1',
  './ost-appbar.css?v=2',
  './predict-mobile.css?v=1',
  './ost-total-balance.js?v=1',
  './manifest.json',
  './favicon.svg',
  './ost-logo.svg',
  './icon-192.png',
  './icon-512.png',
  './style.css?v=77',
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
  './ost-optimistic.js?v=4',
  './realtime.js?v=1',
  './ost-notifications.js?v=3',
  './app.js?v=213',
  './icons.js?v=1',
  './nuevo-laredo-gas.js?v=2',
  './shop-quickview.js?v=3',
  './interchange-live.js?v=2',
  './polish.js?v=2',
  './swap-pool.js?v=1',
  './wallet-extras.js?v=203',
  './ost-price-client.js?v=202',
  './ost-token-section.js?v=2',
  './assets/ost-metadata.json',
  './assets/ost-logo.svg',
  './ghost/ghost.js?v=7',
  './ghost/orb.js?v=1',
  './ghost/translator.js?v=4',
  './ghost/core.js?v=1',
  './ghost/mesh.js?v=1',
  './ghost/recursive.js?v=1',
  './ghost/signal.js?v=1',
  './ghost/awareness.js?v=1',
  './ghost/ghost.css?v=3',
  './mesh/mesh.js?v=33',
  './mesh/veil.js?v=1',
  './mesh/mesh-play.js?v=13',
  './mesh/mesh-fair-fx.js?v=1',
  './mesh/mesh-upgrade.js?v=12',
  './vendor/qrcode-generator.js',
  './vendor/jsqr.min.js',
  './mesh/mesh-link.js?v=2',
  './mesh/mesh-games.js?v=1',
  './mesh/games/tictactoe.js?v=1',
  './mesh/games/chess.js?v=1',
  './mesh/games/pool8.js?v=1',
  './mesh/games/cuppong.js?v=1',
  './mesh/games/minigolf.js?v=1',
  './mesh/mesh-social-x.js?v=3',
  './mesh/mesh-location-pro.js?v=7',
  './mesh/mesh-crypto.js?v=1',
  './mesh/mesh-rtc.js?v=10',
  './mesh/mesh.css?v=14',
  './compartments.js?v=6',
  './prediction-extras.js?v=13',
  './prediction-pro.js?v=200',
  './prediction-scalar.js?v=3',
  './prediction-modal.js?v=204',
  './prediction-trade-popout.js?v=7',
  './prediction-pro-dash.js?v=14',
  './ost-console.js?v=3',
  './ost-onchain-bet.js?v=200',
  './ux-extras.js?v=10',
  './mobile-shell.js?v=12',
  './faucet-hub.js?v=16',
  './faucet-hub-ads.js?v=100',
  './offline-vault.js?v=9',
  './ost-scroll-fix.css?v=1',
  './apple-tap.js?v=4',
  './ost-card.js?v=7',
  './launchpad-engine.js?v=5',
  './swap-resilient.js?v=200',
  './ost-games.js?v=23',
  './code-academy.js?v=3',
  './i18n-runtime.js?v=4',
  './devnet-rescue.js?v=200',
  './launchpad-trenches.js?v=6',
  './stock-market.js?v=10',
  './topup.js?v=11',
  './live-watch.css?v=5',
  './live-watch.js?v=200',
  './native-markets.js?v=3',
  './redesign.css?v=1',
  './redesign.js?v=1',
  './mainnet-audit.js?v=1',
  './ost-pq-demo.js?v=1',
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

async function precache() {
  const cache = await caches.open(CACHE_NAME);
  const urls = PRECACHE_PATHS.map(toScopedUrl);
  await Promise.allSettled(urls.map((url) => cache.add(new Request(url, { cache: 'reload' }))));
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

function shouldNetworkFirst(request) {
  try {
    const url = new URL(request.url);
    if (url.origin !== scopeUrl.origin) return false;
    return /\.(?:html|css|js)$/i.test(url.pathname) || url.pathname === scopeUrl.pathname || url.pathname.endsWith('/');
  } catch (_) {
    return false;
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(precache().then(() => self.skipWaiting()));
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

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  if (request.mode === 'navigate') {
    event.respondWith(navigationResponse(request));
    return;
  }

  event.respondWith(shouldNetworkFirst(request) ? networkFirstResponse(request) : cacheFirstResponse(request));
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

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; }
  catch (_) {
    try { data = { title: 'OST Mesh', body: event.data ? event.data.text() : '' }; } catch (__) { data = {}; }
  }
  const payload = notificationPayload(data);
  if (!shouldShowNotification(data)) return;
  event.waitUntil(self.registration.showNotification(payload.title, payload.options));
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

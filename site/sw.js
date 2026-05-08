const CACHE_NAME = 'ost-pwa-cache-v49';
const RUNTIME_CACHE = 'ost-pwa-runtime-v49';
const CACHE_PREFIX = 'ost-pwa-';

const PRECACHE_PATHS = [
  './',
  './index.html',
  './manifest.json',
  './favicon.svg',
  './ost-logo.svg',
  './icon-192.png',
  './icon-512.png',
  './style.css?v=64',
  './mobile.css?v=7',
  './polish.css?v=1',
  './compartments.css?v=1',
  './prediction-extras.css?v=4',
  './prediction-pro.css?v=1',
  './prediction-modal.css?v=3',
  './prediction-trade-popout.css?v=2',
  './prediction-pro-dash.css?v=3',
  './ost-console.css?v=1',
  './prediction-scalar.css?v=1',
  './faucet-hub.css?v=4',
  './topup.css?v=4',
  './offline-vault.css?v=1',
  './mobile-shell.css?v=2',
  './rpc-multiplexer.js?v=1',
  './app.js?v=110',
  './nuevo-laredo-gas.js?v=1',
  './shop-quickview.js?v=1',
  './interchange-live.js?v=1',
  './polish.js?v=2',
  './swap-pool.js?v=1',
  './wallet-extras.js?v=12',
  './ghost/ghost.js?v=3',
  './ghost/orb.js?v=1',
  './ghost/translator.js?v=3',
  './ghost/core.js?v=1',
  './ghost/mesh.js?v=1',
  './ghost/recursive.js?v=1',
  './ghost/signal.js?v=1',
  './ghost/ghost.css?v=1',
  './mesh/mesh.js?v=18',
  './mesh/veil.js?v=1',
  './mesh/mesh-play.js?v=3',
  './mesh/mesh-upgrade.js?v=1',
  './mesh/mesh-crypto.js?v=1',
  './mesh/mesh-rtc.js?v=10',
  './mesh/mesh.css?v=3',
  './compartments.js?v=3',
  './prediction-extras.js?v=7',
  './prediction-pro.js?v=8',
  './prediction-scalar.js?v=2',
  './prediction-modal.js?v=19',
  './prediction-trade-popout.js?v=1',
  './prediction-pro-dash.js?v=6',
  './ost-console.js?v=2',
  './ost-onchain-bet.js?v=1',
  './ux-extras.js?v=5',
  './mobile-shell.js?v=2',
  './faucet-hub.js?v=12',
  './faucet-hub-ads.js?v=2',
  './offline-vault.js?v=3',
  './apple-tap.js?v=1',
  './ost-games.js?v=13',
  './code-academy.js?v=3',
  './i18n-runtime.js?v=1',
  './devnet-rescue.js?v=4',
  './launchpad-trenches.js?v=2',
  './topup.js?v=7',
  './live-watch.css?v=5',
  './live-watch.js?v=6',
  './native-markets.js?v=3',
  'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js',
  'https://unpkg.com/@solana/web3.js@1.98.0/lib/index.iife.min.js',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
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

  event.respondWith(cacheFirstResponse(request));
});

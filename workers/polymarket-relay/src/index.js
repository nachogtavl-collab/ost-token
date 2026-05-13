/**
 * OST Polymarket Read-Only Relay
 * ------------------------------------------------------------------
 * Proxies Polymarket's public Gamma + CLOB read endpoints through
 * Cloudflare's edge. Adds CORS, edge caching, and a stable hostname
 * so frontend + bots get low-latency, predictable access.
 *
 * NO order placement. NO private keys. Read-only.
 */

const ROUTES = [
  // Gamma — events / markets metadata
  { match: /^\/gamma\/markets\/(?<id>[^/?]+)$/,                 to: (m, e) => `${e.GAMMA_BASE}/markets/${encodeURIComponent(m.groups.id)}`,                          ttl: 5 },
  { match: /^\/gamma\/events\/slug\/(?<slug>[^/?]+)$/,          to: (m, e) => `${e.GAMMA_BASE}/events?slug=${encodeURIComponent(m.groups.slug)}`,                  ttl: 10 },
  { match: /^\/gamma\/markets\/?$/,                             to: (_, e, q) => `${e.GAMMA_BASE}/markets${q ? `?${q}` : ''}`,                                      ttl: 5 },
  { match: /^\/gamma\/events\/?$/,                              to: (_, e, q) => `${e.GAMMA_BASE}/events${q ? `?${q}` : ''}`,                                       ttl: 5 },

  // CLOB — order books, prices, trades
  { match: /^\/clob\/markets\/?$/,                              to: (_, e, q) => `${e.CLOB_BASE}/markets${q ? `?${q}` : ''}`,                                       ttl: 5 },
  { match: /^\/clob\/book\/(?<tokenId>[^/?]+)$/,                to: (m, e) => `${e.CLOB_BASE}/book?token_id=${encodeURIComponent(m.groups.tokenId)}`,               ttl: 1 },
  { match: /^\/clob\/price\/(?<tokenId>[^/?]+)\/(?<side>buy|sell)$/, to: (m, e) => `${e.CLOB_BASE}/price?token_id=${encodeURIComponent(m.groups.tokenId)}&side=${m.groups.side}`, ttl: 1 },
  { match: /^\/clob\/trades\/?$/,                               to: (_, e, q) => `${e.CLOB_BASE}/trades${q ? `?${q}` : ''}`,                                        ttl: 2 },
  { match: /^\/clob\/midpoint\/(?<tokenId>[^/?]+)$/,            to: (m, e) => `${e.CLOB_BASE}/midpoint?token_id=${encodeURIComponent(m.groups.tokenId)}`,           ttl: 1 },

  // Data — historical price series for charts
  { match: /^\/data\/prices-history\/(?<market>[^/?]+)$/,       to: (m, e, q) => `${e.DATA_BASE}/prices-history?market=${encodeURIComponent(m.groups.market)}${q ? `&${q}` : ''}`, ttl: 30 }
];

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type, accept',
  'Access-Control-Max-Age': '86400'
};

function jsonResponse(body, init = {}) {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...CORS,
      ...(init.headers || {})
    }
  });
}

async function proxyToUpstream(upstreamUrl, ttl, request, ctx) {
  // Use Cloudflare's edge cache so repeated requests within the TTL
  // window are served from the same PoP without an upstream fetch.
  const cacheKey = new Request(upstreamUrl, { method: 'GET' });
  const cache = caches.default;
  let cached = await cache.match(cacheKey);
  if (cached) {
    const headers = new Headers(cached.headers);
    Object.entries(CORS).forEach(([k, v]) => headers.set(k, v));
    headers.set('x-relay-cache', 'HIT');
    // Stale-while-revalidate: if the cached entry is older than its TTL,
    // refresh it in the background so the next caller still sees a HIT but
    // with fresh data. Best-effort — never blocks the current response.
    const ageHeader = Number(headers.get('age')) || 0;
    if (ctx && ageHeader >= ttl) {
      try {
        ctx.waitUntil(refreshUpstream(upstreamUrl, ttl, cache, cacheKey));
        headers.set('x-relay-cache', 'HIT-REVALIDATING');
      } catch (_) { /* ignore */ }
    }
    return new Response(cached.body, { status: cached.status, headers });
  }

  // Request coalescing — if another request for the SAME upstream URL is
  // already in flight, await its promise instead of firing a duplicate.
  // This protects upstream APIs when 200 users open the same market at once.
  const inflight = INFLIGHT.get(upstreamUrl);
  if (inflight) {
    const sharedResp = await inflight;
    return cloneRelayResponse(sharedResp, 'COALESCED');
  }

  const fetchPromise = (async () => {
    let upstream;
    try {
      upstream = await fetch(upstreamUrl, {
        method: 'GET',
        headers: {
          accept: 'application/json',
          'user-agent': 'OST-PolyRelay/1.0'
        },
        cf: {
          cacheTtl: ttl,
          cacheEverything: true
        }
      });
    } catch (err) {
      return jsonResponse({ error: 'upstream_fetch_failed', message: String(err && err.message || err) }, { status: 502 });
    }

    const body = await upstream.arrayBuffer();
    const respHeaders = new Headers();
    respHeaders.set('content-type', upstream.headers.get('content-type') || 'application/json; charset=utf-8');
    respHeaders.set('cache-control', `public, max-age=${ttl}, s-maxage=${ttl}`);
    respHeaders.set('x-relay-cache', 'MISS');
    respHeaders.set('x-relay-upstream', upstreamUrl);
    Object.entries(CORS).forEach(([k, v]) => respHeaders.set(k, v));

    const out = new Response(body, { status: upstream.status, headers: respHeaders });
    if (upstream.ok) ctxCachePut(cache, cacheKey, out.clone());
    return out;
  })();

  INFLIGHT.set(upstreamUrl, fetchPromise);
  try {
    const resp = await fetchPromise;
    return resp;
  } finally {
    // Allow the same URL to be re-fetched after this promise settles.
    INFLIGHT.delete(upstreamUrl);
  }
}

// In-flight fetch dedupe map. Key = upstream URL, value = pending Response.
const INFLIGHT = new Map();

function cloneRelayResponse(resp, marker) {
  const headers = new Headers(resp.headers);
  Object.entries(CORS).forEach(([k, v]) => headers.set(k, v));
  if (marker) headers.set('x-relay-cache', marker);
  return new Response(resp.clone().body, { status: resp.status, headers });
}

async function refreshUpstream(upstreamUrl, ttl, cache, cacheKey) {
  try {
    const upstream = await fetch(upstreamUrl, {
      method: 'GET',
      headers: { accept: 'application/json', 'user-agent': 'OST-PolyRelay/1.0' },
      cf: { cacheTtl: ttl, cacheEverything: true }
    });
    if (!upstream.ok) return;
    const body = await upstream.arrayBuffer();
    const respHeaders = new Headers();
    respHeaders.set('content-type', upstream.headers.get('content-type') || 'application/json; charset=utf-8');
    respHeaders.set('cache-control', `public, max-age=${ttl}, s-maxage=${ttl}`);
    respHeaders.set('x-relay-cache', 'BACKGROUND-REFRESH');
    Object.entries(CORS).forEach(([k, v]) => respHeaders.set(k, v));
    await cache.put(cacheKey, new Response(body, { status: upstream.status, headers: respHeaders }));
  } catch (_) { /* ignore */ }
}

function ctxCachePut(cache, key, resp) {
  // Best-effort cache write, swallow errors
  try { cache.put(key, resp); } catch (_) { /* ignore */ }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }
    if (request.method !== 'GET') {
      return jsonResponse({ error: 'method_not_allowed', message: 'This relay is read-only. Only GET is allowed.' }, { status: 405 });
    }

    if (url.pathname === '/' || url.pathname === '/health') {
      return jsonResponse({
        ok: true,
        service: 'ost-poly-relay',
        version: '1.1',
        readonly: true,
        upstreams: { gamma: env.GAMMA_BASE, clob: env.CLOB_BASE, data: env.DATA_BASE },
        endpoints: ROUTES.map(r => String(r.match)),
        features: ['edge-cache', 'request-coalescing', 'stale-while-revalidate', 'cors'],
        ts: new Date().toISOString(),
        edge: request.cf && request.cf.colo ? request.cf.colo : 'unknown'
      });
    }

    for (const route of ROUTES) {
      const m = route.match.exec(url.pathname);
      if (!m) continue;
      const upstreamUrl = route.to(m, env, url.searchParams.toString());
      return proxyToUpstream(upstreamUrl, route.ttl, request, ctx);
    }

    return jsonResponse({ error: 'not_found', message: 'Unknown relay path. See /health for the list of routes.' }, { status: 404 });
  }
};

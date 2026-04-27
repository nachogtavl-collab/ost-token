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

async function proxyToUpstream(upstreamUrl, ttl, request) {
  // Use Cloudflare's edge cache so repeated requests within the TTL
  // window are served from the same PoP without an upstream fetch.
  const cacheKey = new Request(upstreamUrl, { method: 'GET' });
  const cache = caches.default;
  let cached = await cache.match(cacheKey);
  if (cached) {
    const headers = new Headers(cached.headers);
    Object.entries(CORS).forEach(([k, v]) => headers.set(k, v));
    headers.set('x-relay-cache', 'HIT');
    return new Response(cached.body, { status: cached.status, headers });
  }

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

  // Forward the body but rewrite headers to add CORS + cache hint.
  const body = await upstream.arrayBuffer();
  const respHeaders = new Headers();
  respHeaders.set('content-type', upstream.headers.get('content-type') || 'application/json; charset=utf-8');
  respHeaders.set('cache-control', `public, max-age=${ttl}, s-maxage=${ttl}`);
  respHeaders.set('x-relay-cache', 'MISS');
  respHeaders.set('x-relay-upstream', upstreamUrl);
  Object.entries(CORS).forEach(([k, v]) => respHeaders.set(k, v));

  const out = new Response(body, { status: upstream.status, headers: respHeaders });
  // Only cache successful responses
  if (upstream.ok) {
    // Don't await — ship to client first, populate cache in the background
    ctxCachePut(cache, cacheKey, out.clone());
  }
  return out;
}

function ctxCachePut(cache, key, resp) {
  // Best-effort cache write, swallow errors
  try { cache.put(key, resp); } catch (_) { /* ignore */ }
}

export default {
  async fetch(request, env) {
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
        version: '1.0',
        readonly: true,
        upstreams: { gamma: env.GAMMA_BASE, clob: env.CLOB_BASE, data: env.DATA_BASE },
        endpoints: ROUTES.map(r => String(r.match)),
        ts: new Date().toISOString(),
        edge: request.cf && request.cf.colo ? request.cf.colo : 'unknown'
      });
    }

    for (const route of ROUTES) {
      const m = route.match.exec(url.pathname);
      if (!m) continue;
      const upstreamUrl = route.to(m, env, url.searchParams.toString());
      return proxyToUpstream(upstreamUrl, route.ttl, request);
    }

    return jsonResponse({ error: 'not_found', message: 'Unknown relay path. See /health for the list of routes.' }, { status: 404 });
  }
};

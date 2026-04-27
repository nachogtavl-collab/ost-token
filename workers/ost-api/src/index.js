/**
 * OST Prediction API Server — Cloudflare Worker
 * ============================================================
 * A real edge server that powers the OST prediction market UI.
 * Deployed at the edge (Cloudflare) so it's fast everywhere.
 *
 * ENDPOINTS
 * ---------
 *   GET /health                      → server status + BTC price
 *   GET /btc/price                   → live BTC-USD from multi-source waterfall
 *   GET /btc/history                 → 30-min tick history for the sparkline
 *   GET /markets                     → Polymarket active markets
 *   GET /markets/:id                 → single market with book + trades + history
 *   GET /markets/:id/book            → orderbook only
 *   GET /markets/:id/trades          → recent trades
 *   GET /rounds/current              → current 5-min BTC round metadata
 *   POST /rounds/open-price          → set open price for a round (from UI)
 *   GET /positions/:wallet           → positions for a wallet (KV-backed)
 *   POST /positions                  → record a new position  (KV-backed)
 *   OPTIONS *                        → CORS preflight
 *
 * DEPLOY
 * ------
 *   cd workers/ost-api
 *   npx wrangler deploy
 *
 * Then set window.OST_API_BASE on the site:
 *   <script>window.OST_API_BASE = "https://ost-api.<account>.workers.dev";</script>
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type, accept, x-ost-wallet',
  'Access-Control-Max-Age': '86400'
};
const FIVE_MIN_MS = 5 * 60 * 1000;

// ── helpers ─────────────────────────────────────────────────────────────────

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...CORS_HEADERS,
      ...extra
    }
  });
}

function currentRound() {
  const now = Date.now();
  const openAt = Math.floor(now / FIVE_MIN_MS) * FIVE_MIN_MS;
  return {
    id: `ost-btc5m-${openAt}`,
    openAt,
    closeAt: openAt + FIVE_MIN_MS,
    msLeft: openAt + FIVE_MIN_MS - now,
    description: '5-minute BTC-USD direction market. Settles on Coinbase spot at close.'
  };
}

// ── BTC price: waterfall of public feeds ─────────────────────────────────────

const BTC_FEEDS = [
  {
    name: 'coinbase',
    url: 'https://api.coinbase.com/v2/prices/BTC-USD/spot',
    pick: j => j?.data?.amount && Number(j.data.amount)
  },
  {
    name: 'binance',
    url: 'https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT',
    pick: j => j?.price && Number(j.price)
  },
  {
    name: 'coingecko',
    url: 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd',
    pick: j => j?.bitcoin?.usd && Number(j.bitcoin.usd)
  }
];

async function fetchBtcPrice() {
  for (const feed of BTC_FEEDS) {
    try {
      const r = await fetch(feed.url, {
        headers: { accept: 'application/json', 'user-agent': 'OST-API/1.0' },
        cf: { cacheTtl: 4, cacheEverything: true }
      });
      if (!r.ok) continue;
      const j = await r.json();
      const price = feed.pick(j);
      if (Number.isFinite(price) && price > 1000) return { price, source: feed.name };
    } catch (_) { /* try next */ }
  }
  return null;
}

// ── Polymarket helpers ────────────────────────────────────────────────────────

async function polyGamma(env, path, query = '') {
  const url = `${env.GAMMA_BASE}${path}${query ? '?' + query : ''}`;
  const r = await fetch(url, {
    headers: { accept: 'application/json', 'user-agent': 'OST-API/1.0' },
    cf: { cacheTtl: 5, cacheEverything: true }
  });
  return r.ok ? r.json() : null;
}

async function polyClob(env, path, query = '') {
  const url = `${env.CLOB_BASE}${path}${query ? '?' + query : ''}`;
  const r = await fetch(url, {
    headers: { accept: 'application/json', 'user-agent': 'OST-API/1.0' },
    cf: { cacheTtl: 2, cacheEverything: true }
  });
  return r.ok ? r.json() : null;
}

async function polyData(env, path, query = '') {
  const url = `${env.DATA_BASE}${path}${query ? '?' + query : ''}`;
  const r = await fetch(url, {
    headers: { accept: 'application/json', 'user-agent': 'OST-API/1.0' },
    cf: { cacheTtl: 30, cacheEverything: true }
  });
  return r.ok ? r.json() : null;
}

// Normalise a raw Polymarket market record into our schema
function normaliseMarket(raw) {
  const yesPrice = Math.max(0, Math.min(1, Number(raw.outcomePrices?.[0] ?? raw.bestBid ?? raw.lastTradePrice ?? 0.5)));
  let clobTokenIds = raw.clobTokenIds;
  if (typeof clobTokenIds === 'string') { try { clobTokenIds = JSON.parse(clobTokenIds); } catch (_) {} }
  return {
    id:             String(raw.id),
    source:         'polymarket',
    title:          raw.question || raw.title || '',
    detail:         raw.description || '',
    slug:           raw.slug || null,
    yesPriceNumber: yesPrice,
    noPriceNumber:  1 - yesPrice,
    volumeNumber:   Number(raw.volume24hr || raw.volume || 0),
    liquidityNumber:Number(raw.liquidityNum || raw.liquidity || raw.liquidityClob || 0),
    closeAtMs:      raw.endDate ? new Date(raw.endDate).getTime() : null,
    conditionId:    raw.conditionId || raw.condition_id || null,
    clobTokenIds:   Array.isArray(clobTokenIds) ? clobTokenIds.map(String) : null,
    primaryUrl:     raw.slug ? `https://polymarket.com/event/${encodeURIComponent(raw.slug)}` : 'https://polymarket.com/',
    bestBid:        Number(raw.bestBid ?? NaN),
    bestAsk:        Number(raw.bestAsk ?? NaN),
    lastTradePrice: Number(raw.lastTradePrice ?? NaN)
  };
}

// ── KV helpers (positions + round prices) ─────────────────────────────────────

async function kvGet(env, key, fallback = null) {
  if (!env.OST_KV) return fallback;
  try { const v = await env.OST_KV.get(key, { type: 'json' }); return v ?? fallback; }
  catch (_) { return fallback; }
}
async function kvPut(env, key, value, expirationTtl = 86400 * 7) {
  if (!env.OST_KV) return false;
  try { await env.OST_KV.put(key, JSON.stringify(value), { expirationTtl }); return true; }
  catch (_) { return false; }
}

// ── router ───────────────────────────────────────────────────────────────────

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, '') || '/';
    const method = request.method;

    if (method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // ── GET /health ──────────────────────────────────────────────────────────
    if (path === '/health' || path === '/') {
      const btcResult = await fetchBtcPrice();
      const round = currentRound();
      return json({
        ok: true,
        service: 'ost-api',
        version: '1.0',
        ts: new Date().toISOString(),
        edge: request.cf?.colo ?? 'unknown',
        btcPrice: btcResult?.price ?? null,
        btcSource: btcResult?.source ?? null,
        round,
        kv: !!env.OST_KV,
        endpoints: [
          'GET  /health',
          'GET  /btc/price',
          'GET  /btc/history',
          'GET  /markets',
          'GET  /markets/:id',
          'GET  /markets/:id/book',
          'GET  /markets/:id/trades',
          'GET  /rounds/current',
          'POST /rounds/open-price',
          'GET  /positions/:wallet',
          'POST /positions'
        ]
      });
    }

    // ── GET /btc/price ───────────────────────────────────────────────────────
    if (path === '/btc/price' && method === 'GET') {
      const result = await fetchBtcPrice();
      if (!result) return json({ error: 'all_feeds_failed', price: null }, 503);
      const round = currentRound();
      // Record as round open price if this is the first fetch of the round
      const roundKey = `round:${round.openAt}`;
      const existing = await kvGet(env, roundKey);
      if (!existing) await kvPut(env, roundKey, { openAt: round.openAt, openPrice: result.price, closeAt: round.closeAt }, 3600);
      return json({
        price: result.price,
        currency: 'USD',
        source: result.source,
        round,
        ts: new Date().toISOString()
      }, 200, { 'cache-control': 'no-store' });
    }

    // ── GET /btc/history ─────────────────────────────────────────────────────
    if (path === '/btc/history' && method === 'GET') {
      try {
        const r = await fetch('https://api.coinbase.com/v2/prices/BTC-USD/historic?period=hour', {
          headers: { accept: 'application/json', 'user-agent': 'OST-API/1.0' },
          cf: { cacheTtl: 60, cacheEverything: true }
        });
        if (!r.ok) throw new Error('upstream ' + r.status);
        const j = await r.json();
        return json({ series: (j?.data?.prices || []).map(p => ({ t: p.time, p: Number(p.price) })), ts: new Date().toISOString() });
      } catch (e) {
        return json({ error: 'fetch_failed', message: String(e?.message || e), series: [] }, 502);
      }
    }

    // ── GET /rounds/current ──────────────────────────────────────────────────
    if (path === '/rounds/current' && method === 'GET') {
      const round = currentRound();
      const stored = await kvGet(env, `round:${round.openAt}`);
      return json({ ...round, openPrice: stored?.openPrice ?? null, ts: new Date().toISOString() });
    }

    // ── POST /rounds/open-price ──────────────────────────────────────────────
    if (path === '/rounds/open-price' && method === 'POST') {
      let body;
      try { body = await request.json(); } catch (_) { return json({ error: 'invalid_json' }, 400); }
      const { openAt, openPrice } = body || {};
      if (!openAt || !Number.isFinite(Number(openPrice))) return json({ error: 'missing_fields', required: ['openAt', 'openPrice'] }, 400);
      const key = `round:${openAt}`;
      const existing = await kvGet(env, key, {});
      await kvPut(env, key, { ...existing, openAt: Number(openAt), openPrice: Number(openPrice) });
      return json({ ok: true, openAt, openPrice });
    }

    // ── GET /markets ─────────────────────────────────────────────────────────
    if (path === '/markets' && method === 'GET') {
      const limit = Number(url.searchParams.get('limit') || 60);
      const raw = await polyGamma(env, '/markets', `limit=${limit}&closed=false`);
      if (!raw) return json({ error: 'upstream_failed', markets: [] }, 502);
      const markets = (Array.isArray(raw) ? raw : raw.markets || []).map(normaliseMarket);
      return json({ markets, count: markets.length, ts: new Date().toISOString() },
        200, { 'cache-control': 'public, max-age=5' });
    }

    // ── GET /markets/:id  ────────────────────────────────────────────────────
    const mktMatch = path.match(/^\/markets\/([^/]+)$/);
    if (mktMatch && method === 'GET') {
      const id = decodeURIComponent(mktMatch[1]);
      const [gmkt, book, trades, history] = await Promise.all([
        polyGamma(env, `/markets/${encodeURIComponent(id)}`),
        polyClob(env, '/book', `token_id=${encodeURIComponent(id)}`),
        polyClob(env, '/trades', `market=${encodeURIComponent(id)}&limit=20`),
        polyData(env, '/prices-history', `market=${encodeURIComponent(id)}&interval=1d&fidelity=10`)
      ]);
      if (!gmkt) return json({ error: 'market_not_found', id }, 404);
      return json({
        market: normaliseMarket(gmkt),
        book: book || null,
        trades: (Array.isArray(trades) ? trades : trades?.data || []).slice(0, 20),
        history: (history?.history || history?.prices || []).map(p => ({ t: p.t || p.time, p: Number(p.p || p.price) })),
        ts: new Date().toISOString()
      });
    }

    // ── GET /markets/:id/book ─────────────────────────────────────────────────
    const bookMatch = path.match(/^\/markets\/([^/]+)\/book$/);
    if (bookMatch && method === 'GET') {
      const tokenId = decodeURIComponent(bookMatch[1]);
      const book = await polyClob(env, '/book', `token_id=${encodeURIComponent(tokenId)}`);
      if (!book) return json({ error: 'book_unavailable', tokenId }, 502);
      return json(book, 200, { 'cache-control': 'no-store' });
    }

    // ── GET /markets/:id/trades ──────────────────────────────────────────────
    const tradesMatch = path.match(/^\/markets\/([^/]+)\/trades$/);
    if (tradesMatch && method === 'GET') {
      const marketId = decodeURIComponent(tradesMatch[1]);
      const trades = await polyClob(env, '/trades', `market=${encodeURIComponent(marketId)}&limit=20`);
      const list = Array.isArray(trades) ? trades : trades?.data || [];
      return json({ trades: list.slice(0, 20), ts: new Date().toISOString() });
    }

    // ── GET /positions/:wallet ────────────────────────────────────────────────
    const posMatch = path.match(/^\/positions\/([^/]+)$/);
    if (posMatch && method === 'GET') {
      const wallet = decodeURIComponent(posMatch[1]);
      if (!env.OST_KV) return json({ positions: [], note: 'KV not configured — positions are local-only', wallet });
      const positions = await kvGet(env, `positions:${wallet}`, []);
      return json({ positions, wallet, ts: new Date().toISOString() });
    }

    // ── POST /positions ───────────────────────────────────────────────────────
    if (path === '/positions' && method === 'POST') {
      let body;
      try { body = await request.json(); } catch (_) { return json({ error: 'invalid_json' }, 400); }
      const { wallet, marketId, side, stake, ts } = body || {};
      if (!wallet || !marketId || !side || !Number.isFinite(Number(stake))) {
        return json({ error: 'missing_fields', required: ['wallet', 'marketId', 'side', 'stake'] }, 400);
      }
      if (!env.OST_KV) return json({ ok: true, stored: false, note: 'KV not configured — position not persisted server-side' });
      const key = `positions:${wallet}`;
      const existing = await kvGet(env, key, []);
      const record = { id: crypto.randomUUID(), wallet, marketId, side: String(side).toUpperCase(), stake: Number(stake), ts: ts || new Date().toISOString(), status: 'open' };
      existing.push(record);
      await kvPut(env, key, existing);
      return json({ ok: true, stored: true, record });
    }

    return json({ error: 'not_found', message: 'Unknown endpoint. GET /health for the full endpoint list.' }, 404);
  }
};

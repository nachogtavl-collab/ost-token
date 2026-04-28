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

// Normalise a raw Polymarket market record into our schema.
// Now supports multi-outcome markets (Trump/Harris/RFK, scalar ranges, etc.)
// instead of forcing every market into binary YES/NO.
function normaliseMarket(raw) {
  let outcomePrices = raw.outcomePrices;
  if (typeof outcomePrices === 'string') { try { outcomePrices = JSON.parse(outcomePrices); } catch (_) { outcomePrices = null; } }
  let outcomes = raw.outcomes;
  if (typeof outcomes === 'string') { try { outcomes = JSON.parse(outcomes); } catch (_) { outcomes = null; } }
  let clobTokenIds = raw.clobTokenIds;
  if (typeof clobTokenIds === 'string') { try { clobTokenIds = JSON.parse(clobTokenIds); } catch (_) {} }

  // Build a normalised outcomes[] array: each entry has label + price + tokenId.
  const outcomeList = [];
  if (Array.isArray(outcomes) && outcomes.length) {
    outcomes.forEach((label, i) => {
      const price = Number(outcomePrices && outcomePrices[i]);
      const tokenId = Array.isArray(clobTokenIds) ? String(clobTokenIds[i] || '') : '';
      outcomeList.push({
        label: String(label),
        price: Number.isFinite(price) ? Math.max(0, Math.min(1, price)) : null,
        tokenId
      });
    });
  }

  // Pick a canonical YES price for back-compat (binary path uses this).
  // For multi-outcome, the first outcome is the "primary".
  const yesPrice = Math.max(0, Math.min(1, Number(
    (outcomeList[0] && outcomeList[0].price) ?? raw.bestBid ?? raw.lastTradePrice ?? 0.5
  )));

  return {
    id:             String(raw.id),
    source:         'polymarket',
    title:          raw.question || raw.title || '',
    detail:         raw.description || '',
    slug:           raw.slug || null,
    yesPriceNumber: yesPrice,
    noPriceNumber:  outcomeList.length > 1 && Number.isFinite(outcomeList[1] && outcomeList[1].price)
                    ? outcomeList[1].price : 1 - yesPrice,
    volumeNumber:   Number(raw.volume24hr || raw.volume || 0),
    liquidityNumber:Number(raw.liquidityNum || raw.liquidity || raw.liquidityClob || 0),
    closeAtMs:      raw.endDate ? new Date(raw.endDate).getTime() : null,
    conditionId:    raw.conditionId || raw.condition_id || null,
    clobTokenIds:   Array.isArray(clobTokenIds) ? clobTokenIds.map(String) : null,
    outcomes:       outcomeList,                       // ← NEW: full outcomes list for multi-outcome markets
    isBinary:       outcomeList.length <= 2,
    primaryUrl:     raw.slug ? `https://polymarket.com/event/${encodeURIComponent(raw.slug)}` : 'https://polymarket.com/',
    bestBid:        Number(raw.bestBid ?? NaN),
    bestAsk:        Number(raw.bestAsk ?? NaN),
    lastTradePrice: Number(raw.lastTradePrice ?? NaN),
    image:          raw.image || raw.icon || null
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
          'GET  /positions/recent',
          'GET  /positions/recent',
          'GET  /positions/:wallet',
          'POST /positions',
          'GET  /launchpad/coins',
          'POST /launchpad/coins',
          'POST /launchpad/trade',
          'GET  /launchpad/ticks/:mint',
          'GET  /launchpad/coins',
          'POST /launchpad/coins',
          'POST /launchpad/trade',
          'GET  /launchpad/ticks/:mint'
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

    // ── /gamma/* /clob/* /data/* — transparent CORS-safe Polymarket proxy ──
    // The site's prediction-modal.js calls relayBase()+'/gamma'/'/clob'/'/data',
    // expecting these to mirror Polymarket's gamma-api/clob/data-api hosts.
    // Without these passes the modal silently fails over to public CORS proxies
    // which throttle and produce the "stuck at 50%" symptom.
    const proxyMap = {
      '/gamma/': env.GAMMA_BASE || 'https://gamma-api.polymarket.com',
      '/clob/' : env.CLOB_BASE  || 'https://clob.polymarket.com',
      '/data/' : env.DATA_BASE  || 'https://data-api.polymarket.com'
    };
    for (const prefix in proxyMap) {
      if (path.startsWith(prefix)) {
        const upstream = proxyMap[prefix] + path.slice(prefix.length - 1) + (url.search || '');
        try {
          const r = await fetch(upstream, {
            method,
            headers: { accept: 'application/json', 'user-agent': 'OST-API/1.0' },
            cf: { cacheTtl: 5, cacheEverything: true }
          });
          const text = await r.text();
          return new Response(text, {
            status: r.status,
            headers: {
              ...CORS_HEADERS,
              'content-type': r.headers.get('content-type') || 'application/json',
              'cache-control': 'public, max-age=2'
            }
          });
        } catch (e) {
          return json({ error: 'upstream_failed', upstream, message: String(e?.message || e) }, 502);
        }
      }
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

    // ── GET /positions/recent ─ GLOBAL FEED of all bets across all wallets ──
    // Powers the shared "Recent ticks" ribbon so every user sees what every
    // other OST user just bought, on which market, at what price.
    if (path === '/positions/recent' && method === 'GET') {
      const limit = Math.min(50, Number(url.searchParams.get('limit') || 30));
      if (!env.OST_KV) return json({ recent: [], note: 'KV not configured' });
      const recent = await kvGet(env, 'positions:recent', []);
      return json({ recent: recent.slice(0, limit), ts: new Date().toISOString() }, 200, { 'cache-control': 'no-store' });
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
      const { wallet, marketId, marketTitle, side, stake, price, ts, signature } = body || {};
      if (!wallet || !marketId || !side || !Number.isFinite(Number(stake))) {
        return json({ error: 'missing_fields', required: ['wallet', 'marketId', 'side', 'stake'] }, 400);
      }
      if (!env.OST_KV) return json({ ok: true, stored: false, note: 'KV not configured — position not persisted server-side' });
      const record = {
        id: crypto.randomUUID(),
        wallet: String(wallet).slice(0, 64),
        walletShort: String(wallet).slice(0, 4) + '…' + String(wallet).slice(-4),
        marketId: String(marketId).slice(0, 128),
        marketTitle: String(marketTitle || '').slice(0, 200),
        side: String(side).toUpperCase().slice(0, 32),
        stake: Number(stake),
        price: Number.isFinite(Number(price)) ? Number(price) : null,
        signature: signature ? String(signature).slice(0, 128) : null,
        ts: ts || new Date().toISOString(),
        status: 'open'
      };
      // Per-wallet bucket (keep last 100, newest first)
      const walletKey = `positions:${wallet}`;
      const walletBucket = (await kvGet(env, walletKey, [])).slice(0, 99);
      walletBucket.unshift(record);
      await kvPut(env, walletKey, walletBucket);
      // Global recent feed (keep last 100)
      const recent = (await kvGet(env, 'positions:recent', [])).slice(0, 99);
      recent.unshift(record);
      await kvPut(env, 'positions:recent', recent, 60 * 60 * 24 * 7);
      return json({ ok: true, stored: true, record });
    }

    // ── LAUNCHPAD ─ pump.fun-style fair-launch coin registry ────────────────
    // Anyone can read; anyone can publish a coin or trade it on the bonding curve.
    // KV-backed so every visitor sees the same coins and their live mcap/curve.
    if (path === '/launchpad/coins' && method === 'GET') {
      if (!env.OST_KV) return json({ coins: [], note: 'KV not configured' });
      const coins = await kvGet(env, 'launchpad:coins', []);
      return json({ coins, count: coins.length, ts: new Date().toISOString() }, 200, { 'cache-control': 'public, max-age=2' });
    }
    if (path === '/launchpad/coins' && method === 'POST') {
      let body;
      try { body = await request.json(); } catch (_) { return json({ error: 'invalid_json' }, 400); }
      const { name, symbol, desc, image, twitter, telegram, website, creator, mcap, curve, supply } = body || {};
      if (!name || !symbol) return json({ error: 'missing_fields', required: ['name', 'symbol'] }, 400);
      if (!env.OST_KV) return json({ ok: true, stored: false, note: 'KV not configured' });
      const record = {
        id: crypto.randomUUID(),
        mint: 'ost' + crypto.randomUUID().replace(/-/g, '').slice(0, 40),
        name: String(name).slice(0, 64),
        symbol: String(symbol).toUpperCase().slice(0, 12),
        desc: String(desc || '').slice(0, 1000),
        image: image ? String(image).slice(0, 500_000) : null,
        twitter: twitter ? String(twitter).slice(0, 200) : null,
        telegram: telegram ? String(telegram).slice(0, 200) : null,
        website: website ? String(website).slice(0, 200) : null,
        creator: creator ? String(creator).slice(0, 64) : 'anon',
        mcap: Number(mcap) || 100,
        curve: Math.max(0, Math.min(100, Number(curve) || 1)),
        supply: Number(supply) || 1_000_000_000,
        createdAt: Date.now(),
        trades: 0,
        holders: [{ addr: creator || 'anon', pct: 100 }]
      };
      const coins = (await kvGet(env, 'launchpad:coins', [])).slice(0, 199);
      coins.unshift(record);
      await kvPut(env, 'launchpad:coins', coins);
      return json({ ok: true, stored: true, coin: record });
    }
    // POST /launchpad/trade  { mint, side: 'buy'|'sell', amount, trader }
    if (path === '/launchpad/trade' && method === 'POST') {
      let body;
      try { body = await request.json(); } catch (_) { return json({ error: 'invalid_json' }, 400); }
      const { mint, side, amount, trader } = body || {};
      if (!mint || !side || !Number.isFinite(Number(amount))) return json({ error: 'missing_fields', required: ['mint', 'side', 'amount'] }, 400);
      if (!env.OST_KV) return json({ ok: true, stored: false, note: 'KV not configured' });
      const coins = await kvGet(env, 'launchpad:coins', []);
      const idx = coins.findIndex(c => c.mint === mint);
      if (idx < 0) return json({ error: 'coin_not_found', mint }, 404);
      const c = coins[idx];
      const amt = Number(amount);
      // Simple bonding-curve: each OST in moves mcap by ~10x; sells drop it.
      const delta = side === 'buy' ? amt * 10 : -amt * 10;
      c.mcap = Math.max(100, (Number(c.mcap) || 100) + delta);
      c.curve = Math.max(0, Math.min(100, Math.floor((c.mcap / 690))));
      c.trades = (c.trades || 0) + 1;
      c.lastTradeAt = Date.now();
      coins[idx] = c;
      await kvPut(env, 'launchpad:coins', coins);
      const tickKey = `launchpad:ticks:${mint}`;
      const ticks = (await kvGet(env, tickKey, [])).slice(0, 199);
      ticks.unshift({ side, amount: amt, mcap: c.mcap, trader: trader ? String(trader).slice(0, 8) + '…' : 'anon', ts: Date.now() });
      await kvPut(env, tickKey, ticks, 60 * 60 * 24 * 7);
      return json({ ok: true, coin: c });
    }
    const tickMatch = path.match(/^\/launchpad\/ticks\/([^/]+)$/);
    if (tickMatch && method === 'GET') {
      const mint = decodeURIComponent(tickMatch[1]);
      if (!env.OST_KV) return json({ ticks: [] });
      const ticks = await kvGet(env, `launchpad:ticks:${mint}`, []);
      return json({ ticks, ts: new Date().toISOString() });
    }

    return json({ error: 'not_found', message: 'Unknown endpoint. GET /health for the full endpoint list.' }, 404);
  }
};

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
 *   GET /wallet/events/:wallet       -> wallet activity events for one address
 *   POST /wallet/events              -> record wallet activity for cross-device sync
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
async function kvPut(env, key, value, expirationTtl = null) {
  if (!env.OST_KV) return false;
  try {
    const opts = Number.isFinite(Number(expirationTtl)) && Number(expirationTtl) > 0
      ? { expirationTtl: Number(expirationTtl) }
      : undefined;
    await env.OST_KV.put(key, JSON.stringify(value), opts);
    return true;
  }
  catch (_) { return false; }
}

function toMs(value) {
  if (!value) return Date.now();
  const n = Number(value);
  if (Number.isFinite(n)) return n < 100000000000 ? n * 1000 : n;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function cleanText(value, max = 200) {
  return String(value == null ? '' : value).replace(/[\r\n]+/g, ' ').slice(0, max);
}

function cleanNumber(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function mergeNewest(bucket, record, limit = 100) {
  const key = record.signature || record.sig || record.id;
  const current = Array.isArray(bucket) ? bucket : [];
  const next = key
    ? current.filter(item => (item?.signature || item?.sig || item?.id) !== key)
    : current;
  next.unshift(record);
  return next.slice(0, limit);
}

// ── Top-Up helpers ───────────────────────────────────────────────────────────
// Tier table is the single source of truth (server-validated). Front-end
// shows the same numbers but always re-validates here on intent creation.
const TOPUP_TIERS = {
  5:  { usd: 5,  ostAmount: 1200  },
  10: { usd: 10, ostAmount: 3000  },
  25: { usd: 25, ostAmount: 9000  },
  50: { usd: 50, ostAmount: 20000 }
};

function isLikelySolanaAddress(s) {
  return typeof s === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s.trim());
}

function shortMemo() {
  // 12-char base32-ish memo, easy to type into a memo field.
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return 'OST-' + Array.from(bytes, b => b.toString(36).padStart(2, '0')).join('').slice(0, 10).toUpperCase();
}

function buildPublicSiteUrl(env, request) {
  return env.PUBLIC_SITE_URL || 'https://nachogtavl-collab.github.io/ost-token/';
}

async function stripeApi(env, path, formObj) {
  const body = new URLSearchParams();
  function add(prefix, value) {
    if (value === null || value === undefined) return;
    if (Array.isArray(value)) {
      value.forEach((v, i) => add(`${prefix}[${i}]`, v));
    } else if (typeof value === 'object') {
      for (const k of Object.keys(value)) add(`${prefix}[${k}]`, value[k]);
    } else {
      body.append(prefix, String(value));
    }
  }
  for (const k of Object.keys(formObj || {})) add(k, formObj[k]);
  const r = await fetch(`https://api.stripe.com${path}`, {
    method: 'POST',
    headers: {
      'authorization': `Bearer ${env.STRIPE_SECRET_KEY}`,
      'content-type': 'application/x-www-form-urlencoded'
    },
    body
  });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, body: j };
}

// Verify Stripe webhook signature: header `Stripe-Signature: t=<ts>,v1=<sig>,...`
async function verifyStripeSignature(rawBody, sigHeader, secret) {
  if (!sigHeader || !secret) return false;
  const parts = Object.fromEntries(sigHeader.split(',').map(p => {
    const idx = p.indexOf('='); return [p.slice(0, idx).trim(), p.slice(idx + 1).trim()];
  }));
  const t = parts.t; const v1 = parts.v1;
  if (!t || !v1) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const macBuf = await crypto.subtle.sign('HMAC', key, enc.encode(`${t}.${rawBody}`));
  const mac = Array.from(new Uint8Array(macBuf), b => b.toString(16).padStart(2, '0')).join('');
  // Constant-time compare
  if (mac.length !== v1.length) return false;
  let diff = 0;
  for (let i = 0; i < mac.length; i++) diff |= mac.charCodeAt(i) ^ v1.charCodeAt(i);
  return diff === 0;
}

async function loadIntent(env, id) {
  if (!id) return null;
  return await kvGet(env, `topup:intent:${id}`);
}
async function saveIntent(env, intent) {
  // 30-day TTL
  await kvPut(env, `topup:intent:${intent.id}`, intent, 60 * 60 * 24 * 30);
}
async function pushQueue(env, id) {
  const q = (await kvGet(env, 'topup:queue', [])).filter(x => x !== id);
  q.unshift(id);
  await kvPut(env, 'topup:queue', q.slice(0, 500));
}
async function removeQueue(env, id) {
  const q = (await kvGet(env, 'topup:queue', [])).filter(x => x !== id);
  await kvPut(env, 'topup:queue', q);
}

function adminAuthorized(request, env) {
  if (!env.TOPUP_ADMIN_TOKEN) return false;
  const h = request.headers.get('authorization') || '';
  return h === `Bearer ${env.TOPUP_ADMIN_TOKEN}`;
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
          'GET  /wallet/events/:wallet',
          'POST /wallet/events',
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
      const createdAt = toMs(body.createdAt || ts);
      const record = {
        id: cleanText(body.id || signature || crypto.randomUUID(), 128),
        wallet: String(wallet).slice(0, 64),
        walletShort: String(wallet).slice(0, 4) + '…' + String(wallet).slice(-4),
        marketId: String(marketId).slice(0, 128),
        conditionId: cleanText(body.conditionId || body.condition_id || '', 128),
        marketTitle: cleanText(marketTitle || body.title || '', 200),
        title: cleanText(body.title || marketTitle || '', 200),
        topic: cleanText(body.topic || '', 64),
        source: cleanText(body.source || 'polymarket', 32),
        side: String(side).toUpperCase().slice(0, 32),
        stake: Number(stake),
        price: Number.isFinite(Number(price)) ? Number(price) : null,
        yesPrice: cleanNumber(body.yesPrice),
        noPrice: cleanNumber(body.noPrice),
        shares: cleanNumber(body.shares),
        potentialReturn: cleanNumber(body.potentialReturn),
        closeAtMs: cleanNumber(body.closeAtMs, 0),
        clobTokenIds: Array.isArray(body.clobTokenIds) ? body.clobTokenIds.map(v => cleanText(v, 128)).slice(0, 8) : [],
        sourceUrl: cleanText(body.sourceUrl || '', 500),
        signature: signature ? String(signature).slice(0, 128) : null,
        sig: signature ? String(signature).slice(0, 128) : null,
        ts: new Date(createdAt).toISOString(),
        createdAt,
        status: cleanText(body.status || 'open', 32),
        cashoutKind: cleanText(body.cashoutKind || '', 40),
        cashoutSig: cleanText(body.cashoutSig || '', 128),
        cashoutOst: cleanNumber(body.cashoutOst),
        cashoutAt: cleanNumber(body.cashoutAt, 0),
        finalYesPrice: cleanNumber(body.finalYesPrice),
        finalNoPrice: cleanNumber(body.finalNoPrice),
        resolvedAt: cleanNumber(body.resolvedAt, 0),
        syncedAt: Date.now()
      };
      // Per-wallet bucket (keep last 100, newest first)
      const walletKey = `positions:${wallet}`;
      const walletBucket = await kvGet(env, walletKey, []);
      await kvPut(env, walletKey, mergeNewest(walletBucket, record, 100));
      // Global recent feed (keep last 100)
      const recent = await kvGet(env, 'positions:recent', []);
      await kvPut(env, 'positions:recent', mergeNewest(recent, record, 100), 60 * 60 * 24 * 7);
      return json({ ok: true, stored: true, record });
    }

    // ── GET /wallet/events/:wallet ──────────────────────────────────────────
    const walletEventsMatch = path.match(/^\/wallet\/events\/([^/]+)$/);
    if (walletEventsMatch && method === 'GET') {
      const wallet = decodeURIComponent(walletEventsMatch[1]);
      const limit = Math.min(300, Number(url.searchParams.get('limit') || 200));
      if (!env.OST_KV) return json({ events: [], note: 'KV not configured', wallet });
      const events = await kvGet(env, `wallet:events:${wallet}`, []);
      return json({ events: events.slice(0, limit), wallet, ts: new Date().toISOString() }, 200, { 'cache-control': 'no-store' });
    }

    // ── POST /wallet/events ─────────────────────────────────────────────────
    if (path === '/wallet/events' && method === 'POST') {
      let body;
      try { body = await request.json(); } catch (_) { return json({ error: 'invalid_json' }, 400); }
      const wallet = cleanText(body?.wallet || '', 64);
      const kind = cleanText(body?.kind || '', 48);
      if (!wallet || !kind) return json({ error: 'missing_fields', required: ['wallet', 'kind'] }, 400);
      if (!env.OST_KV) return json({ ok: true, stored: false, note: 'KV not configured' });
      const eventTs = toMs(body.ts || body.createdAt || body.cashoutAt);
      const id = cleanText(body.id || body.eventId || body.sig || body.signature || `${kind}:${eventTs}:${body.amount || ''}:${body.token || body.game || body.marketId || ''}`, 160);
      const record = {
        id,
        wallet,
        kind,
        amount: cleanNumber(body.amount, 0),
        sig: cleanText(body.sig || body.signature || '', 128),
        source: cleanText(body.source || '', 48),
        label: cleanText(body.label || '', 200),
        token: cleanText(body.token || '', 32),
        game: cleanText(body.game || '', 48),
        marketId: cleanText(body.marketId || '', 128),
        title: cleanText(body.title || '', 200),
        side: cleanText(body.side || '', 16),
        price: cleanNumber(body.price),
        potentialReturn: cleanNumber(body.potentialReturn),
        cashoutKind: cleanText(body.cashoutKind || '', 48),
        ostBalance: cleanNumber(body.ostBalance),
        solBalance: cleanNumber(body.solBalance),
        gameCredits: cleanNumber(body.gameCredits),
        launchpadExposure: cleanNumber(body.launchpadExposure),
        ts: eventTs,
        syncedAt: Date.now()
      };
      const key = `wallet:events:${wallet}`;
      const bucket = await kvGet(env, key, []);
      await kvPut(env, key, mergeNewest(bucket, record, 300));
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

    // ── TOP-UP: real-money OST refill ───────────────────────────────────────
    // Tier table + receivers + Stripe enable flag.
    if (path === '/topup/config' && method === 'GET') {
      return json({
        tiers: Object.entries(TOPUP_TIERS).map(([id, t]) => ({ id: Number(id), usd: t.usd, ostAmount: t.ostAmount })),
        stripeEnabled: !!env.STRIPE_SECRET_KEY,
        receivers: {
          usdcMainnet: env.TREASURY_USDC_MAINNET || null,
          solMainnet:  env.TREASURY_SOL_MAINNET  || null
        },
        ostMint: env.OST_MINT || '383pTzoZ8Gp83dzk23ZnvLcfX2Sq32TAGN48CMQu2pAJ',
        cluster: 'devnet'
      });
    }

    // Create an intent (validated against TOPUP_TIERS).
    if (path === '/topup/intent' && method === 'POST') {
      let body; try { body = await request.json(); } catch { return json({ error: 'invalid_json' }, 400); }
      const tierId = Number(body && body.tier);
      const tier = TOPUP_TIERS[tierId];
      if (!tier) return json({ error: 'invalid_tier' }, 400);
      const wallet = String(body.wallet || '').trim();
      if (!isLikelySolanaAddress(wallet)) return json({ error: 'invalid_wallet' }, 400);
      const method2 = body.method === 'crypto' ? 'crypto' : 'stripe';
      if (!env.OST_KV) return json({ error: 'kv_not_configured' }, 503);

      const intent = {
        id: crypto.randomUUID(),
        memo: shortMemo(),
        tier: tierId,
        usd: tier.usd,
        ostAmount: tier.ostAmount,
        wallet,
        method: method2,
        status: 'pending',          // pending → paid → sent (or cancelled)
        signature: null,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      await saveIntent(env, intent);
      return json({ id: intent.id, memo: intent.memo, ostAmount: intent.ostAmount, status: intent.status });
    }

    // Create a Stripe Checkout session for an existing intent.
    if (path === '/topup/checkout' && method === 'POST') {
      if (!env.STRIPE_SECRET_KEY) return json({ error: 'stripe_not_configured' }, 503);
      let body; try { body = await request.json(); } catch { return json({ error: 'invalid_json' }, 400); }
      const intent = await loadIntent(env, body && body.intentId);
      if (!intent) return json({ error: 'intent_not_found' }, 404);
      if (intent.status !== 'pending') return json({ error: 'intent_not_pending', status: intent.status }, 409);

      const site = buildPublicSiteUrl(env, request);
      const successUrl = `${site}${site.includes('?') ? '&' : '?'}topup=success&intent=${intent.id}#new-here`;
      const cancelUrl  = `${site}${site.includes('?') ? '&' : '?'}topup=cancel&intent=${intent.id}#new-here`;

      const r = await stripeApi(env, '/v1/checkout/sessions', {
        mode: 'payment',
        success_url: successUrl,
        cancel_url:  cancelUrl,
        client_reference_id: intent.id,
        metadata: { intent_id: intent.id, wallet: intent.wallet, ost_amount: String(intent.ostAmount) },
        'line_items': [{
          quantity: 1,
          price_data: {
            currency: 'usd',
            unit_amount: intent.usd * 100,
            product_data: {
              name: `OST Top-Up — ${intent.ostAmount.toLocaleString()} OST`,
              description: `Devnet OST delivered to ${intent.wallet.slice(0, 8)}…${intent.wallet.slice(-6)}`
            }
          }
        }]
      });
      if (!r.ok) return json({ error: 'stripe_error', detail: r.body }, 502);
      const session = r.body;
      // Map session → intent so the webhook can resolve it.
      await kvPut(env, `topup:stripe:${session.id}`, intent.id, 60 * 60 * 24 * 30);
      intent.stripeSessionId = session.id;
      intent.updatedAt = Date.now();
      await saveIntent(env, intent);
      return json({ url: session.url, sessionId: session.id });
    }

    // Stripe webhook receiver. MUST verify the signature with the raw body.
    if (path === '/topup/stripe/webhook' && method === 'POST') {
      if (!env.STRIPE_WEBHOOK_SECRET) return json({ error: 'webhook_not_configured' }, 503);
      const sig = request.headers.get('stripe-signature') || '';
      const raw = await request.text();
      const ok = await verifyStripeSignature(raw, sig, env.STRIPE_WEBHOOK_SECRET);
      if (!ok) return json({ error: 'bad_signature' }, 400);
      let evt; try { evt = JSON.parse(raw); } catch { return json({ error: 'bad_json' }, 400); }
      if (evt.type === 'checkout.session.completed') {
        const session = evt.data && evt.data.object;
        const intentId = (session && session.client_reference_id) ||
                         (session && session.metadata && session.metadata.intent_id) ||
                         await kvGet(env, `topup:stripe:${session && session.id}`);
        if (intentId) {
          const intent = await loadIntent(env, intentId);
          if (intent && intent.status === 'pending') {
            intent.status = 'paid';
            intent.paidAt = Date.now();
            intent.updatedAt = Date.now();
            intent.paymentRef = session.payment_intent || session.id;
            await saveIntent(env, intent);
            await pushQueue(env, intent.id);
          }
        }
      }
      return json({ received: true });
    }

    // Public status polling.
    const statusMatch = path.match(/^\/topup\/status\/([^/]+)$/);
    if (statusMatch && method === 'GET') {
      const intent = await loadIntent(env, decodeURIComponent(statusMatch[1]));
      if (!intent) return json({ error: 'not_found' }, 404);
      return json({
        id: intent.id,
        status: intent.status,
        ostAmount: intent.ostAmount,
        signature: intent.signature || null,
        wallet: intent.wallet,
        memo: intent.memo,
        updatedAt: intent.updatedAt
      });
    }

    // Admin: list paid-but-not-sent intents (for the dispatcher).
    if (path === '/topup/admin/pending' && method === 'GET') {
      if (!adminAuthorized(request, env)) return json({ error: 'unauthorized' }, 401);
      const ids = await kvGet(env, 'topup:queue', []);
      const out = [];
      for (const id of ids.slice(0, 50)) {
        const it = await loadIntent(env, id);
        if (it && it.status === 'paid') out.push(it);
      }
      return json({ pending: out, count: out.length });
    }

    // Admin: mark intent as sent (called by the dispatcher after transferChecked).
    if (path === '/topup/admin/mark-sent' && method === 'POST') {
      if (!adminAuthorized(request, env)) return json({ error: 'unauthorized' }, 401);
      let body; try { body = await request.json(); } catch { return json({ error: 'invalid_json' }, 400); }
      const intent = await loadIntent(env, body && body.id);
      if (!intent) return json({ error: 'not_found' }, 404);
      intent.status = 'sent';
      intent.signature = String(body.signature || '').slice(0, 128) || null;
      intent.sentAt = Date.now();
      intent.updatedAt = Date.now();
      await saveIntent(env, intent);
      await removeQueue(env, intent.id);
      const recent = await kvGet(env, 'topup:sent', []);
      recent.unshift({ id: intent.id, ostAmount: intent.ostAmount, wallet: intent.wallet, signature: intent.signature, sentAt: intent.sentAt });
      await kvPut(env, 'topup:sent', recent.slice(0, 200));
      return json({ ok: true, intent });
    }

    // Admin: manually confirm a crypto payment (for the on-chain receivers).
    if (path === '/topup/admin/confirm-crypto' && method === 'POST') {
      if (!adminAuthorized(request, env)) return json({ error: 'unauthorized' }, 401);
      let body; try { body = await request.json(); } catch { return json({ error: 'invalid_json' }, 400); }
      const intent = await loadIntent(env, body && body.id);
      if (!intent) return json({ error: 'not_found' }, 404);
      if (intent.status === 'pending') {
        intent.status = 'paid';
        intent.paidAt = Date.now();
        intent.updatedAt = Date.now();
        intent.paymentRef = String(body.txSignature || '').slice(0, 128) || 'manual';
        await saveIntent(env, intent);
        await pushQueue(env, intent.id);
      }
      return json({ ok: true, intent });
    }

    return json({ error: 'not_found', message: 'Unknown endpoint. GET /health for the full endpoint list.' }, 404);
  }
};

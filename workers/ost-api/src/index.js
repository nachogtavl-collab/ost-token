// Ghost AI v2 — sovereign rebuild. Mounts at /ghost/v2/*
import { handleGhostV2Request } from './ghost/index.js';
import { handleMeshRequest }    from './mesh/index.js';

export { MeshHub } from './mesh/hub.js';

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
 *   <script>window.OST_API_BASE = "https://ost-api-pages.pages.dev";</script>
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

// ── Canonical BTC round state ────────────────────────────────────────────────
// The worker is the SINGLE SOURCE OF TRUTH for the 5-min BTC round so that
// every browser sees the IDENTICAL openPrice, livePrice, and YES/NO odds.
// Without this, two users who happen to hit Coinbase / Binance / Kraken at
// slightly different ms can lock different open prices and get wildly
// different YES/NO numbers (~80¢ vs ~50¢ on the exact same round).
const BTC_TICK_RING_MAX = 600;          // ~10 min of 1Hz ticks per round bucket
const BTC_LIVE_TTL_S = 60 * 30;         // shared "latest tick" cache TTL

async function lockRoundOpenPrice(env, round, price, source) {
  if (!env.OST_KV || !Number.isFinite(price) || price <= 0) return null;
  const key = `round:${round.openAt}`;
  const existing = await kvGet(env, key, null);
  if (existing && Number.isFinite(Number(existing.openPrice)) && Number(existing.openPrice) > 0) {
    // Open price already locked for this round — never overwrite.
    return existing;
  }
  const record = {
    openAt: round.openAt,
    closeAt: round.closeAt,
    openPrice: price,
    openPriceSource: source || '',
    openPriceTs: Date.now(),
    lockedBy: 'worker'
  };
  // 2h TTL is long enough to cover settlement after close + late-arriving bots.
  await kvPut(env, key, record, 60 * 60 * 2);
  return record;
}

async function appendBtcTick(env, round, price, source) {
  if (!env.OST_KV || !Number.isFinite(price) || price <= 0) return;
  const ringKey = `btc:ticks:${round.openAt}`;
  const ring = await kvGet(env, ringKey, []);
  const last = ring.length ? ring[ring.length - 1] : null;
  // Dedupe identical prints inside 800ms — same guard the client used to apply.
  const now = Date.now();
  if (last && last.p === price && now - last.t < 800) return;
  ring.push({ t: now, p: price, s: source || '' });
  if (ring.length > BTC_TICK_RING_MAX) ring.splice(0, ring.length - BTC_TICK_RING_MAX);
  await kvPut(env, ringKey, ring, 60 * 60 * 1);
  // Also keep a "latest tick" pointer so cached requests resolve in 1 KV read.
  await kvPut(env, 'btc:latest', { t: now, p: price, s: source || '', round: round.openAt }, BTC_LIVE_TTL_S);
}

// Deterministic 5-min BTC YES/NO equation. SAME inputs => SAME outputs across
// every client and bot. No Math.random, no per-client volatility window.
//   openPrice  : USD locked at the start of the round
//   livePrice  : latest USD tick
//   msLeft     : ms until round close (clamped 0 .. 5 min)
function serverComputeBtcOdds(openPrice, livePrice, msLeft) {
  const FIVE = 5 * 60 * 1000;
  if (!Number.isFinite(openPrice) || !Number.isFinite(livePrice) || openPrice <= 0 || livePrice <= 0) {
    return { yes: 0.5, no: 0.5, deltaPct: 0, delta: 0, scale: 0 };
  }
  const left = Math.max(0, Math.min(FIVE, Number(msLeft) || 0));
  const elapsedRatio = 1 - (left / FIVE);
  const remainingRatio = left / FIVE;
  const delta = livePrice - openPrice;
  const deltaPct = (delta / openPrice) * 100;
  // Reference 5-min realised vol on BTC ~ 0.22% (1-sigma). Sqrt-time scaling
  // shrinks the band as the round progresses so a 0.10% move late in the
  // round becomes much more decisive than the same move at t=0.
  const scale = 0.22 * Math.sqrt(Math.max(remainingRatio, 0.05));
  const z = deltaPct / Math.max(scale, 0.001);
  let yes = 1 / (1 + Math.exp(-z));
  // Confidence ramp: at t=0 odds are pulled hard toward 0.5; at t=close they
  // commit to the directional probability.
  const confidence = 0.55 + 0.40 * elapsedRatio;
  yes = 0.5 + (yes - 0.5) * confidence;
  yes = Math.max(0.02, Math.min(0.98, yes));
  return { yes, no: 1 - yes, deltaPct, delta, scale };
}

async function buildCanonicalBtcRound(env, opts) {
  const round = currentRound();
  const wantFresh = opts && opts.refresh !== false;
  let latest = await kvGet(env, 'btc:latest', null);
  const latestIsCurrentRound = latest && Number(latest.round) === round.openAt;
  const stale = !latest || !latestIsCurrentRound || (Date.now() - Number(latest.t || 0) > 1500);
  if (wantFresh && stale) {
    const live = await fetchBtcPrice();
    if (live) {
      latest = { t: Date.now(), p: live.price, s: live.source, round: round.openAt };
      await lockRoundOpenPrice(env, round, live.price, live.source);
      await appendBtcTick(env, round, live.price, live.source);
    }
  }
  const currentLatest = latest && Number(latest.round) === round.openAt ? latest : null;
  let stored = await kvGet(env, `round:${round.openAt}`, null);
  const openPrice = Number(stored && stored.openPrice) || (currentLatest && Number(currentLatest.p)) || 0;
  // First call of a fresh round and we just got the live price — that price IS
  // the open price by definition.
  if (currentLatest && openPrice && !stored) {
    stored = await lockRoundOpenPrice(env, round, openPrice, currentLatest.s || '') || stored;
  }
  const livePrice = (currentLatest && Number(currentLatest.p)) || openPrice;
  const odds = serverComputeBtcOdds(openPrice, livePrice, round.msLeft);
  return {
    id: round.id,
    openAt: round.openAt,
    closeAt: round.closeAt,
    msLeft: round.msLeft,
    openPrice: openPrice || null,
    priceToBeat: openPrice || null,
    openPriceSource: stored && stored.openPriceSource || '',
    openPriceTs: stored && stored.openPriceTs || null,
    livePrice: livePrice || null,
    livePriceSource: currentLatest && currentLatest.s || '',
    livePriceTs: currentLatest && Number(currentLatest.t) || null,
    source: currentLatest && currentLatest.s || stored && stored.openPriceSource || '',
    yesPriceNumber: odds.yes,
    noPriceNumber: odds.no,
    deltaPct: odds.deltaPct,
    delta: odds.delta,
    scale: odds.scale,
    canonical: true
  };
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

function cleanProbability(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  let normalized = number;
  if (number > 1) {
    if (number <= 100) normalized = number / 100;
  }
  return Math.max(0, Math.min(1, normalized));
}

function inferBinaryPrices(side, price, yesPrice, noPrice) {
  const sideUp = String(side || '').toUpperCase() === 'NO' ? 'NO' : 'YES';
  let selected = cleanProbability(price);
  let yes = cleanProbability(yesPrice);
  let no = cleanProbability(noPrice);
  if (yes == null && selected != null) yes = sideUp === 'NO' ? 1 - selected : selected;
  if (no == null && selected != null) no = sideUp === 'NO' ? selected : 1 - selected;
  if (selected == null) selected = sideUp === 'NO' ? no : yes;
  return { price: selected, yesPrice: yes, noPrice: no };
}

const NATIVE_MARKET_STATE_TTL_S = 60 * 60 * 6;
const NATIVE_MARKET_LIQUIDITY_SHARES = 750;
const NATIVE_MARKET_LIQUIDITY_OST = 500;
const NATIVE_MARKET_MAX_SHARE_IMPACT = 0.32;
const NATIVE_MARKET_MAX_STAKE_IMPACT = 0.08;

function clampNativeProbability(value) {
  const probability = cleanProbability(value);
  return probability == null ? null : Math.max(0.02, Math.min(0.98, probability));
}

function isOstNativeMarketId(marketId, source) {
  const marketText = String(marketId == null ? '' : marketId);
  const sourceText = String(source == null ? '' : source).toLowerCase();
  if (marketText.indexOf('ost-btc5m-') === 0) return true;
  if (sourceText === 'ost') return true;
  return sourceText === 'ost-native';
}

function nativeMarketStateKey(marketId) {
  return 'market:state:' + cleanText(marketId, 128);
}

function defaultNativeMarketState(marketId) {
  return {
    marketId: cleanText(marketId, 128),
    openYesShares: 0,
    openNoShares: 0,
    openYesStake: 0,
    openNoStake: 0,
    baseYesPrice: 0.5,
    liquidityShares: NATIVE_MARKET_LIQUIDITY_SHARES,
    liquidityOst: NATIVE_MARKET_LIQUIDITY_OST,
    orders: {},
    updatedAt: 0
  };
}

function normalizeNativeMarketState(state, marketId) {
  let raw = {};
  if (state) {
    if (typeof state === 'object') raw = state;
  }
  const normalized = Object.assign(defaultNativeMarketState(marketId), raw);
  normalized.marketId = cleanText(normalized.marketId ? normalized.marketId : marketId, 128);
  normalized.openYesShares = Math.max(0, cleanNumber(normalized.openYesShares, 0));
  normalized.openNoShares = Math.max(0, cleanNumber(normalized.openNoShares, 0));
  normalized.openYesStake = Math.max(0, cleanNumber(normalized.openYesStake, 0));
  normalized.openNoStake = Math.max(0, cleanNumber(normalized.openNoStake, 0));
  const baseYes = clampNativeProbability(normalized.baseYesPrice);
  normalized.baseYesPrice = baseYes == null ? 0.5 : baseYes;
  normalized.liquidityShares = Math.max(100, cleanNumber(normalized.liquidityShares, NATIVE_MARKET_LIQUIDITY_SHARES));
  normalized.liquidityOst = Math.max(100, cleanNumber(normalized.liquidityOst, NATIVE_MARKET_LIQUIDITY_OST));
  let orders = {};
  if (normalized.orders) {
    if (typeof normalized.orders === 'object') {
      if (!Array.isArray(normalized.orders)) orders = normalized.orders;
    }
  }
  normalized.orders = orders;
  normalized.updatedAt = cleanNumber(normalized.updatedAt, 0);
  return normalized;
}

function nativePositionKey(positionRecord) {
  if (positionRecord) {
    const keys = ['id', 'signature', 'sig', 'txid', 'txHash'];
    for (const key of keys) {
      if (positionRecord[key]) return cleanText(positionRecord[key], 180);
    }
  }
  const fallbackParts = [
    positionRecord ? positionRecord.wallet : '',
    positionRecord ? positionRecord.marketId : '',
    positionRecord ? positionRecord.side : '',
    positionRecord ? positionRecord.createdAt : '',
    positionRecord ? positionRecord.ts : ''
  ];
  return cleanText(fallbackParts.join(':'), 180);
}

function positionIsClosed(positionRecord) {
  if (!positionRecord) return false;
  const status = String(positionRecord.status ? positionRecord.status : (positionRecord.outcome ? positionRecord.outcome : '')).toLowerCase();
  if (positionRecord.cashedOut) return true;
  if (positionRecord.resolved) return true;
  if (Number(positionRecord.cashoutAt ? positionRecord.cashoutAt : 0) > 0) return true;
  return ['sold', 'cashed-out', 'settled', 'won', 'lost', 'closed', 'resolved'].indexOf(status) >= 0;
}
function nativePositionImpact(positionRecord) {
  const side = String(positionRecord ? positionRecord.side : '').toUpperCase() === 'NO' ? 'NO' : 'YES';
  const stake = Math.max(0, cleanNumber(positionRecord ? positionRecord.stake : 0, 0));
  const selectedPrice = cleanProbability(positionRecord ? positionRecord.price : null);
  const yesPrice = cleanProbability(positionRecord ? positionRecord.yesPrice : null);
  const noPrice = cleanProbability(positionRecord ? positionRecord.noPrice : null);
  let sidePrice = selectedPrice == null ? 0 : selectedPrice;
  if (side === 'NO') {
    if (noPrice != null) sidePrice = noPrice;
  } else if (yesPrice != null) {
    sidePrice = yesPrice;
  }
  let shares = Math.max(0, cleanNumber(positionRecord ? positionRecord.shares : 0, 0));
  if (!(shares > 0)) {
    if (stake > 0) {
      if (sidePrice > 0) shares = stake / sidePrice;
    }
  }
  const isOpen = !positionIsClosed(positionRecord);
  return {
    side,
    stake,
    shares,
    price: sidePrice,
    status: cleanText(positionRecord ? positionRecord.status : (isOpen ? 'open' : 'closed'), 32),
    openYesShares: isOpen ? (side === 'YES' ? shares : 0) : 0,
    openNoShares: isOpen ? (side === 'NO' ? shares : 0) : 0,
    openYesStake: isOpen ? (side === 'YES' ? stake : 0) : 0,
    openNoStake: isOpen ? (side === 'NO' ? stake : 0) : 0,
    updatedAt: Date.now()
  };
}

function applyNativeStateDelta(state, impact, direction) {
  state.openYesShares = Math.max(0, cleanNumber(state.openYesShares, 0) + direction * cleanNumber(impact ? impact.openYesShares : 0, 0));
  state.openNoShares = Math.max(0, cleanNumber(state.openNoShares, 0) + direction * cleanNumber(impact ? impact.openNoShares : 0, 0));
  state.openYesStake = Math.max(0, cleanNumber(state.openYesStake, 0) + direction * cleanNumber(impact ? impact.openYesStake : 0, 0));
  state.openNoStake = Math.max(0, cleanNumber(state.openNoStake, 0) + direction * cleanNumber(impact ? impact.openNoStake : 0, 0));
}

function quoteNativeMarketState(state, baseYesPrice) {
  const baseInput = baseYesPrice != null ? baseYesPrice : state.baseYesPrice;
  const clampedBase = clampNativeProbability(baseInput);
  const baseYes = clampedBase == null ? 0.5 : clampedBase;
  const openYesShares = cleanNumber(state.openYesShares, 0);
  const openNoShares = cleanNumber(state.openNoShares, 0);
  const openYesStake = cleanNumber(state.openYesStake, 0);
  const openNoStake = cleanNumber(state.openNoStake, 0);
  const liquidityShares = Math.max(100, cleanNumber(state.liquidityShares, NATIVE_MARKET_LIQUIDITY_SHARES));
  const liquidityOst = Math.max(100, cleanNumber(state.liquidityOst, NATIVE_MARKET_LIQUIDITY_OST));
  const netShares = openYesShares - openNoShares;
  const netStake = openYesStake - openNoStake;
  const shareImpact = Math.tanh(netShares / liquidityShares) * NATIVE_MARKET_MAX_SHARE_IMPACT;
  const stakeImpact = Math.tanh(netStake / liquidityOst) * NATIVE_MARKET_MAX_STAKE_IMPACT;
  const clampedYes = clampNativeProbability(baseYes + shareImpact + stakeImpact);
  const yesPriceNumber = clampedYes == null ? 0.5 : clampedYes;
  const orderSource = state.orders ? state.orders : {};
  return {
    baseYesPrice: baseYes,
    baseNoPrice: 1 - baseYes,
    yesPriceNumber,
    noPriceNumber: 1 - yesPriceNumber,
    openYesShares,
    openNoShares,
    openYesStake,
    openNoStake,
    netShares,
    netStake,
    liquidityShares,
    liquidityOst,
    shareImpact,
    stakeImpact,
    totalImpact: yesPriceNumber - baseYes,
    orderCount: Object.keys(orderSource).length,
    updatedAt: state.updatedAt ? state.updatedAt : Date.now()
  };
}

function pruneNativeMarketOrders(state) {
  const orders = state.orders ? state.orders : {};
  const keys = Object.keys(orders);
  if (keys.length <= 500) return;
  keys.sort((leftKey, rightKey) => cleanNumber(orders[rightKey] ? orders[rightKey].updatedAt : 0, 0) - cleanNumber(orders[leftKey] ? orders[leftKey].updatedAt : 0, 0));
  keys.slice(500).forEach(key => { delete orders[key]; });
}
async function nativeBaseYesForMarket(env, marketId, fallbackBaseYes) {
  let baseYes = clampNativeProbability(fallbackBaseYes);
  const marketText = String(marketId == null ? '' : marketId);
  if (marketText.indexOf('ost-btc5m-') === 0) {
    const openAt = Number(marketText.replace('ost-btc5m-', ''));
    const current = currentRound();
    if (Number.isFinite(openAt)) {
      if (openAt === current.openAt) {
        const round = await buildCanonicalBtcRound(env, { refresh: true });
        const roundYes = clampNativeProbability(round ? round.yesPriceNumber : null);
        if (roundYes != null) baseYes = roundYes;
      }
    }
  }
  return baseYes == null ? 0.5 : baseYes;
}

async function loadNativeMarketState(env, marketId) {
  const cleanMarketId = cleanText(marketId, 128);
  if (!env.OST_KV) return defaultNativeMarketState(cleanMarketId);
  return normalizeNativeMarketState(await kvGet(env, nativeMarketStateKey(cleanMarketId), null), cleanMarketId);
}

function publicNativeMarketState(state) {
  const quoted = quoteNativeMarketState(state, state.baseYesPrice);
  return Object.assign({ marketId: state.marketId }, quoted);
}

async function getNativeMarketState(env, marketId, fallbackBaseYes) {
  const state = await loadNativeMarketState(env, marketId);
  state.baseYesPrice = await nativeBaseYesForMarket(env, state.marketId, fallbackBaseYes != null ? fallbackBaseYes : state.baseYesPrice);
  state.updatedAt = state.updatedAt ? state.updatedAt : Date.now();
  const quoted = quoteNativeMarketState(state, state.baseYesPrice);
  Object.assign(state, quoted);
  if (env.OST_KV) await kvPut(env, nativeMarketStateKey(state.marketId), state, NATIVE_MARKET_STATE_TTL_S);
  return publicNativeMarketState(state);
}

async function applyNativePositionToMarketState(env, positionRecord, fallbackBaseYes) {
  if (!env.OST_KV) return null;
  if (!positionRecord) return null;
  if (!isOstNativeMarketId(positionRecord.marketId, positionRecord.source)) return null;
  const state = await loadNativeMarketState(env, positionRecord.marketId);
  const positionKey = nativePositionKey(positionRecord);
  const previousImpact = state.orders[positionKey] ? state.orders[positionKey] : null;
  if (previousImpact) applyNativeStateDelta(state, previousImpact, -1);
  const nextImpact = nativePositionImpact(positionRecord);
  applyNativeStateDelta(state, nextImpact, 1);
  state.orders[positionKey] = nextImpact;
  state.baseYesPrice = await nativeBaseYesForMarket(env, state.marketId, fallbackBaseYes != null ? fallbackBaseYes : state.baseYesPrice);
  state.updatedAt = Date.now();
  const quoted = quoteNativeMarketState(state, state.baseYesPrice);
  Object.assign(state, quoted);
  pruneNativeMarketOrders(state);
  await kvPut(env, nativeMarketStateKey(state.marketId), state, NATIVE_MARKET_STATE_TTL_S);
  return publicNativeMarketState(state);
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

function recentFlowRecordForPosition(record) {
  if (!record || !positionIsClosed(record)) return record;
  const positionKey = nativePositionKey(record);
  const closedAt = cleanNumber(record.cashoutAt, 0) || cleanNumber(record.resolvedAt, 0) || cleanNumber(record.syncedAt, 0) || Date.now();
  const side = String(record.side || '').toUpperCase() === 'NO' ? 'NO' : 'YES';
  const sellPrice = clampNativeProbability(record.sellPrice != null ? record.sellPrice : record.price);
  let yesPrice = clampNativeProbability(record.finalYesPrice != null ? record.finalYesPrice : record.yesPrice);
  let noPrice = clampNativeProbability(record.finalNoPrice != null ? record.finalNoPrice : record.noPrice);
  if (sellPrice != null) {
    if (side === 'NO') {
      noPrice = sellPrice;
      if (yesPrice == null) yesPrice = 1 - sellPrice;
    } else {
      yesPrice = sellPrice;
      if (noPrice == null) noPrice = 1 - sellPrice;
    }
  }
  const selectedPrice = side === 'NO' ? noPrice : yesPrice;
  const sellValue = cleanNumber(record.sellValue, null) ?? cleanNumber(record.cashoutOst, null) ?? cleanNumber(record.potentialReturn, null) ?? cleanNumber(record.stake, 0);
  const cashoutSig = cleanText(record.cashoutSig || '', 128);
  return Object.assign({}, record, {
    id: cleanText(`sell:${positionKey}:${closedAt}`, 180),
    signature: cashoutSig || null,
    sig: cashoutSig || null,
    relatedPositionId: cleanText(record.id || record.signature || record.sig || positionKey, 128),
    flowAction: 'sell',
    tradeAction: 'sell',
    action: 'sell',
    status: 'sold',
    side,
    price: selectedPrice != null ? selectedPrice : record.price,
    yesPrice: yesPrice != null ? yesPrice : record.yesPrice,
    noPrice: noPrice != null ? noPrice : record.noPrice,
    stake: sellValue,
    amount: sellValue,
    sellValue,
    shares: cleanNumber(record.shares, 0),
    ts: new Date(closedAt).toISOString(),
    createdAt: closedAt,
    syncedAt: Date.now()
  });
}

const FAUCET_WELCOME_AMOUNT = 100;
const FAUCET_DAILY_AMOUNT = 1;
const FAUCET_DAILY_MS = 24 * 60 * 60 * 1000;
const FAUCET_RESERVATION_MS = 2 * 60 * 1000;

const STOCK_UNIVERSE = [
  { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ', sector: 'Technology', currency: 'USD' },
  { symbol: 'MSFT', name: 'Microsoft Corp.', exchange: 'NASDAQ', sector: 'Technology', currency: 'USD' },
  { symbol: 'NVDA', name: 'NVIDIA Corp.', exchange: 'NASDAQ', sector: 'Semiconductors', currency: 'USD' },
  { symbol: 'TSLA', name: 'Tesla Inc.', exchange: 'NASDAQ', sector: 'Automotive', currency: 'USD' },
  { symbol: 'AMZN', name: 'Amazon.com Inc.', exchange: 'NASDAQ', sector: 'Consumer', currency: 'USD' },
  { symbol: 'META', name: 'Meta Platforms Inc.', exchange: 'NASDAQ', sector: 'Technology', currency: 'USD' },
  { symbol: 'GOOGL', name: 'Alphabet Inc.', exchange: 'NASDAQ', sector: 'Technology', currency: 'USD' },
  { symbol: 'AMD', name: 'Advanced Micro Devices', exchange: 'NASDAQ', sector: 'Semiconductors', currency: 'USD' },
  { symbol: 'JPM', name: 'JPMorgan Chase & Co.', exchange: 'NYSE', sector: 'Financials', currency: 'USD' },
  { symbol: 'V', name: 'Visa Inc.', exchange: 'NYSE', sector: 'Payments', currency: 'USD' },
  { symbol: 'KO', name: 'Coca-Cola Co.', exchange: 'NYSE', sector: 'Consumer staples', currency: 'USD' },
  { symbol: 'SPY', name: 'SPDR S&P 500 ETF', exchange: 'NYSE Arca', sector: 'Index ETF', currency: 'USD' },
  { symbol: 'QQQ', name: 'Invesco QQQ Trust', exchange: 'NASDAQ', sector: 'Index ETF', currency: 'USD' },
  { symbol: 'DIA', name: 'SPDR Dow Jones Industrial Average ETF', exchange: 'NYSE Arca', sector: 'Index ETF', currency: 'USD' }
];

function normalizeStockSymbol(value) {
  return cleanText(value || '', 16).replace(/[^a-z0-9.-]/gi, '').toUpperCase();
}

function stockMeta(symbol) {
  return STOCK_UNIVERSE.find(item => item.symbol === symbol) || { symbol, name: symbol, exchange: 'US', sector: 'Equity', currency: 'USD' };
}

function stooqSymbol(symbol) {
  return normalizeStockSymbol(symbol).replace(/\./g, '-').toLowerCase() + '.us';
}

function yahooSymbol(symbol) {
  return normalizeStockSymbol(symbol).replace(/\./g, '-');
}

function parseCsvRows(text) {
  return String(text || '').trim().split(/\r?\n/).filter(Boolean).map(line => line.split(',').map(cell => cell.trim()));
}

function parseStockQuoteCsv(text, symbol) {
  const rows = parseCsvRows(text);
  if (rows.length < 2) return null;
  const headers = rows[0].map(h => h.toLowerCase());
  const row = rows[1];
  const get = name => row[headers.indexOf(name)] || '';
  const close = cleanNumber(get('close'));
  const open = cleanNumber(get('open'));
  const high = cleanNumber(get('high'));
  const low = cleanNumber(get('low'));
  if (!Number.isFinite(close) || close <= 0) return null;
  const previous = Number.isFinite(open) && open > 0 ? open : close;
  const change = close - previous;
  const meta = stockMeta(symbol);
  return {
    symbol,
    name: meta.name,
    exchange: meta.exchange,
    sector: meta.sector,
    currency: meta.currency || 'USD',
    price: close,
    open: Number.isFinite(open) ? open : null,
    high: Number.isFinite(high) ? high : null,
    low: Number.isFinite(low) ? low : null,
    volume: cleanNumber(get('volume'), 0) || 0,
    change,
    changePct: previous ? change / previous * 100 : 0,
    asOf: [get('date'), get('time')].filter(Boolean).join(' '),
    source: 'stooq-public'
  };
}

async function fetchStockQuote(symbol) {
  const clean = normalizeStockSymbol(symbol);
  if (!clean) return null;
  const response = await fetch(`https://stooq.com/q/l/?s=${encodeURIComponent(stooqSymbol(clean))}&f=sd2t2ohlcv&h&e=csv`, {
    headers: { accept: 'text/csv', 'user-agent': 'OST-Stock-Mirror/1.0' },
    cf: { cacheTtl: 20, cacheEverything: true }
  });
  if (!response.ok) return null;
  return parseStockQuoteCsv(await response.text(), clean);
}

async function fetchStockHistory(symbol) {
  const clean = normalizeStockSymbol(symbol);
  if (!clean) return { history: [], source: 'none' };

  const chartResponse = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol(clean))}?range=1y&interval=1d&includePrePost=false`, {
    headers: { accept: 'application/json', 'user-agent': 'OST-Stock-Mirror/1.0' },
    cf: { cacheTtl: 60 * 15, cacheEverything: true }
  });
  if (chartResponse.ok) {
    try {
      const payload = await chartResponse.json();
      const result = payload && payload.chart && Array.isArray(payload.chart.result) ? payload.chart.result[0] : null;
      const timestamps = result && Array.isArray(result.timestamp) ? result.timestamp : [];
      const quote = result && result.indicators && Array.isArray(result.indicators.quote) ? result.indicators.quote[0] : null;
      const history = timestamps.map((timestamp, index) => ({
        date: new Date(Number(timestamp) * 1000).toISOString().slice(0, 10),
        open: cleanNumber(quote && quote.open && quote.open[index]),
        high: cleanNumber(quote && quote.high && quote.high[index]),
        low: cleanNumber(quote && quote.low && quote.low[index]),
        close: cleanNumber(quote && quote.close && quote.close[index]),
        volume: cleanNumber(quote && quote.volume && quote.volume[index], 0) || 0
      })).filter(point => point.date && Number.isFinite(point.close)).slice(-260);
      if (history.length) return { history, source: 'yahoo-chart-public' };
    } catch (_) {}
  }

  const csvResponse = await fetch(`https://stooq.com/q/d/l/?s=${encodeURIComponent(stooqSymbol(clean))}&i=d`, {
    headers: { accept: 'text/csv', 'user-agent': 'OST-Stock-Mirror/1.0' },
    cf: { cacheTtl: 60 * 15, cacheEverything: true }
  });
  if (!csvResponse.ok) return { history: [], source: 'unavailable' };
  const rows = parseCsvRows(await csvResponse.text());
  if (rows.length < 2) return { history: [], source: 'unavailable' };
  const headers = rows[0].map(h => h.toLowerCase());
  const idx = name => headers.indexOf(name);
  const history = rows.slice(1).map(row => ({
    date: row[idx('date')] || '',
    open: cleanNumber(row[idx('open')]),
    high: cleanNumber(row[idx('high')]),
    low: cleanNumber(row[idx('low')]),
    close: cleanNumber(row[idx('close')]),
    volume: cleanNumber(row[idx('volume')], 0) || 0
  })).filter(point => point.date && Number.isFinite(point.close)).slice(-260);
  return { history, source: history.length ? 'stooq-public' : 'unavailable' };
}

async function recordStockWalletEvent(env, order) {
  if (!env.OST_KV || !order || !order.wallet) return;
  const record = {
    id: order.id,
    wallet: order.wallet,
    kind: 'stock-mirror-order',
    amount: cleanNumber(order.ostStake, 0) || 0,
    sig: cleanText(order.signature || '', 128),
    source: 'stock-mirror',
    label: `${order.side.toUpperCase()} ${order.symbol} stock mirror`,
    token: 'OST',
    marketId: order.symbol,
    title: order.name,
    side: order.side,
    price: order.price,
    potentialReturn: order.notionalUsd,
    ts: order.createdAt,
    syncedAt: Date.now()
  };
  const key = `wallet:events:${record.wallet}`;
  const bucket = await kvGet(env, key, []);
  await kvPut(env, key, mergeNewest(bucket, record, 300));
}

function normalizeFaucetWallet(value) {
  const wallet = cleanText(value || '', 64);
  return isLikelySolanaAddress(wallet) ? wallet : '';
}

function publicFaucetState(record, now = Date.now()) {
  const state = record || {};
  const welcomeClaimedAt = cleanNumber(state.welcomeClaimedAt, 0) || 0;
  const lastDailyClaimAt = cleanNumber(state.lastDailyClaimAt || welcomeClaimedAt, 0) || 0;
  const nextDailyClaimAt = welcomeClaimedAt ? lastDailyClaimAt + FAUCET_DAILY_MS : 0;
  const pending = state.pendingReservation && state.pendingReservation.expiresAt > now
    ? state.pendingReservation
    : null;
  return {
    wallet: cleanText(state.wallet || '', 64),
    welcomeClaimed: welcomeClaimedAt > 0,
    welcomeClaimedAt,
    welcomeAmount: cleanNumber(state.welcomeAmount, 0) || 0,
    lastDailyClaimAt,
    nextDailyClaimAt,
    dailyReady: welcomeClaimedAt > 0 && now >= nextDailyClaimAt,
    dailyClaimCount: cleanNumber(state.dailyClaimCount, 0) || 0,
    totalClaimed: cleanNumber(state.totalClaimed, 0) || 0,
    lastSignature: cleanText(state.lastSignature || '', 128),
    lastReservationId: cleanText(state.lastReservationId || '', 80),
    updatedAt: cleanNumber(state.updatedAt, 0) || 0,
    pendingReservation: pending ? {
      id: cleanText(pending.id || '', 80),
      kind: cleanText(pending.kind || '', 16),
      amount: cleanNumber(pending.amount, 0) || 0,
      expiresAt: cleanNumber(pending.expiresAt, 0) || 0
    } : null
  };
}

function faucetWalletKey(wallet) {
  return `faucet:v1:wallet:${wallet}`;
}

async function recordFaucetWalletEvent(env, event) {
  if (!env.OST_KV || !event || !event.wallet) return;
  const record = {
    id: cleanText(event.id || event.sig || crypto.randomUUID(), 160),
    wallet: cleanText(event.wallet, 64),
    kind: cleanText(event.kind || 'faucet-claim', 48),
    amount: cleanNumber(event.amount, 0) || 0,
    sig: cleanText(event.sig || event.signature || '', 128),
    source: 'faucet-gate',
    label: cleanText(event.label || 'OST faucet claim', 200),
    token: 'OST',
    ts: cleanNumber(event.ts, Date.now()) || Date.now(),
    syncedAt: Date.now()
  };
  const key = `wallet:events:${record.wallet}`;
  const bucket = await kvGet(env, key, []);
  await kvPut(env, key, mergeNewest(bucket, record, 300));
}

export class FaucetGate {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    return this.state.blockConcurrencyWhile(() => this.handle(request));
  }

  async readWallet(wallet) {
    const raw = await this.state.storage.get(faucetWalletKey(wallet));
    const now = Date.now();
    const record = Object.assign({ wallet }, raw || {});
    if (record.pendingReservation && record.pendingReservation.expiresAt <= now) {
      delete record.pendingReservation;
      await this.state.storage.put(faucetWalletKey(wallet), record);
    }
    return record;
  }

  async writeWallet(wallet, record) {
    await this.state.storage.put(faucetWalletKey(wallet), record);
  }

  async handle(request) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, '') || '/';
    const method = request.method;
    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });

    const stateMatch = path.match(/^\/faucet\/v1\/state\/([^/]+)$/);
    if (stateMatch && method === 'GET') {
      const wallet = normalizeFaucetWallet(decodeURIComponent(stateMatch[1]));
      if (!wallet) return json({ error: 'invalid_wallet' }, 400);
      const record = await this.readWallet(wallet);
      return json({ ok: true, state: publicFaucetState(record) }, 200, { 'cache-control': 'no-store' });
    }

    if (path === '/faucet/v1/reserve' && method === 'POST') {
      let body;
      try { body = await request.json(); } catch (_) { return json({ error: 'invalid_json' }, 400); }
      const wallet = normalizeFaucetWallet(body && body.wallet);
      if (!wallet) return json({ error: 'invalid_wallet' }, 400);
      const now = Date.now();
      const record = await this.readWallet(wallet);
      const current = publicFaucetState(record, now);
      if (current.pendingReservation) {
        return json({ ok: false, error: 'claim_in_progress', state: current }, 409, { 'cache-control': 'no-store' });
      }
      let kind = 'welcome';
      let amount = FAUCET_WELCOME_AMOUNT;
      if (current.welcomeClaimed) {
        if (!current.dailyReady) {
          return json({ ok: false, error: 'cooldown', state: current, nextDailyClaimAt: current.nextDailyClaimAt }, 409, { 'cache-control': 'no-store' });
        }
        kind = 'daily';
        amount = FAUCET_DAILY_AMOUNT;
      }
      const reservation = {
        id: crypto.randomUUID(),
        wallet,
        kind,
        amount,
        reservedAt: now,
        expiresAt: now + FAUCET_RESERVATION_MS
      };
      record.pendingReservation = reservation;
      record.updatedAt = now;
      await this.writeWallet(wallet, record);
      await this.state.storage.put(`faucet:v1:reservation:${reservation.id}`, reservation);
      return json({ ok: true, reservationId: reservation.id, kind, amount, expiresAt: reservation.expiresAt, state: publicFaucetState(record, now) }, 200, { 'cache-control': 'no-store' });
    }

    if (path === '/faucet/v1/commit' && method === 'POST') {
      let body;
      try { body = await request.json(); } catch (_) { return json({ error: 'invalid_json' }, 400); }
      const wallet = normalizeFaucetWallet(body && body.wallet);
      const reservationId = cleanText(body && body.reservationId, 80);
      const signature = cleanText(body && (body.signature || body.sig), 128);
      if (!wallet || !reservationId || !signature) return json({ error: 'missing_fields', required: ['wallet', 'reservationId', 'signature'] }, 400);
      const now = Date.now();
      const record = await this.readWallet(wallet);
      if (record.lastReservationId === reservationId) {
        return json({ ok: true, state: publicFaucetState(record, now), idempotent: true }, 200, { 'cache-control': 'no-store' });
      }
      const pending = record.pendingReservation;
      if (!pending || pending.id !== reservationId) return json({ error: 'reservation_not_active', state: publicFaucetState(record, now) }, 409);
      if (pending.expiresAt <= now) {
        delete record.pendingReservation;
        await this.writeWallet(wallet, record);
        return json({ error: 'reservation_expired', state: publicFaucetState(record, now) }, 409);
      }
      const amount = Math.min(cleanNumber(body && body.amount, pending.amount) || pending.amount, pending.amount);
      record.totalClaimed = (cleanNumber(record.totalClaimed, 0) || 0) + amount;
      record.lastSignature = signature;
      record.lastReservationId = reservationId;
      record.updatedAt = now;
      if (pending.kind === 'welcome') {
        record.welcomeClaimedAt = record.welcomeClaimedAt || now;
        record.welcomeAmount = record.welcomeAmount || amount;
        record.lastDailyClaimAt = record.lastDailyClaimAt || now;
      } else {
        record.lastDailyClaimAt = now;
        record.dailyClaimCount = (cleanNumber(record.dailyClaimCount, 0) || 0) + 1;
      }
      delete record.pendingReservation;
      await this.writeWallet(wallet, record);
      await recordFaucetWalletEvent(this.env, {
        id: reservationId,
        wallet,
        kind: pending.kind === 'welcome' ? 'faucet-welcome' : 'faucet-daily',
        amount,
        sig: signature,
        label: pending.kind === 'welcome' ? '100 OST head start' : 'Daily 1 OST faucet',
        ts: now
      });
      return json({ ok: true, state: publicFaucetState(record, now) }, 200, { 'cache-control': 'no-store' });
    }

    if (path === '/faucet/v1/cancel' && method === 'POST') {
      let body;
      try { body = await request.json(); } catch (_) { return json({ error: 'invalid_json' }, 400); }
      const wallet = normalizeFaucetWallet(body && body.wallet);
      const reservationId = cleanText(body && body.reservationId, 80);
      if (!wallet || !reservationId) return json({ error: 'missing_fields', required: ['wallet', 'reservationId'] }, 400);
      const record = await this.readWallet(wallet);
      if (record.pendingReservation && record.pendingReservation.id === reservationId) {
        delete record.pendingReservation;
        record.updatedAt = Date.now();
        await this.writeWallet(wallet, record);
      }
      return json({ ok: true, state: publicFaucetState(record) }, 200, { 'cache-control': 'no-store' });
    }

    return json({ error: 'unknown_faucet_endpoint', path }, 404);
  }
}

// ── Top-Up helpers ───────────────────────────────────────────────────────────
// Flexible value-based pricing is the source of truth. The legacy tier table is
// kept only so older cached clients can still create valid intents.
const TOPUP_USD_PER_OST = 0.0118;
const TOPUP_MIN_USD = 1;
const TOPUP_MAX_USD = 5000;
const TOPUP_TIERS = {
  5:  { usd: 5,  ostAmount: 1200  },
  10: { usd: 10, ostAmount: 3000  },
  25: { usd: 25, ostAmount: 9000  },
  50: { usd: 50, ostAmount: 20000 }
};

function topupUsdPerOst(env) {
  const configured = Number(env.TOPUP_USD_PER_OST);
  return Number.isFinite(configured) && configured > 0 ? configured : TOPUP_USD_PER_OST;
}

function normalizeTopupUsd(value) {
  const usd = Math.round(Number(value || 0) * 100) / 100;
  if (!Number.isFinite(usd) || usd < TOPUP_MIN_USD) return null;
  if (usd > TOPUP_MAX_USD) return null;
  return usd;
}

function calculateTopupOst(usd, rate) {
  return Math.floor((usd / rate) * 100) / 100;
}

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

const USDC_MAINNET_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const USDC_DEVNET_MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const LAMPORTS_PER_SOL = 1_000_000_000;

function normalizeSolanaCluster(raw) {
  const value = String(raw || '').toLowerCase();
  return (value === 'mainnet' || value === 'mainnet-beta') ? 'mainnet-beta' : 'devnet';
}

function topupCluster(env) {
  return normalizeSolanaCluster(env.TOPUP_SOLANA_CLUSTER || env.SOLANA_CLUSTER || 'devnet');
}

function topupSolReceiver(env, cluster) {
  const isMainnet = normalizeSolanaCluster(cluster) === 'mainnet-beta';
  return isMainnet
    ? (env.TREASURY_SOL_MAINNET || env.TREASURY_SOL_DEVNET || '')
    : (env.TREASURY_SOL_DEVNET || env.TREASURY_SOL_MAINNET || '');
}

function topupUsdcReceiver(env, cluster) {
  const isMainnet = normalizeSolanaCluster(cluster) === 'mainnet-beta';
  return isMainnet
    ? (env.TREASURY_USDC_MAINNET || env.TREASURY_USDC_DEVNET || topupSolReceiver(env, cluster))
    : (env.TREASURY_USDC_DEVNET || env.TREASURY_USDC_MAINNET || topupSolReceiver(env, cluster));
}

function topupUsdcMint(env, cluster) {
  const configured = env.TOPUP_USDC_MINT || env.USDC_MINT || '';
  if (configured) return configured;
  return normalizeSolanaCluster(cluster) === 'mainnet-beta' ? USDC_MAINNET_MINT : USDC_DEVNET_MINT;
}

function topupRpcUrls(env, cluster) {
  const isMainnet = normalizeSolanaCluster(cluster) === 'mainnet-beta';
  if (isMainnet) {
    return [
      env.SOLANA_MAINNET_RPC,
      'https://solana-rpc.publicnode.com',
      'https://api.mainnet-beta.solana.com'
    ].filter(Boolean);
  }
  return [
    env.SOLANA_DEVNET_RPC,
    'https://api.devnet.solana.com',
    'https://rpc.ankr.com/solana_devnet'
  ].filter(Boolean);
}

async function fetchSolUsd() {
  const feeds = [
    {
      url: 'https://api.coinbase.com/v2/prices/SOL-USD/spot',
      pick: body => body?.data?.amount && Number(body.data.amount)
    },
    {
      url: 'https://api.binance.com/api/v3/ticker/price?symbol=SOLUSDT',
      pick: body => body?.price && Number(body.price)
    },
    {
      url: 'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd',
      pick: body => body?.solana?.usd && Number(body.solana.usd)
    }
  ];
  for (const feed of feeds) {
    try {
      const response = await fetch(feed.url, {
        headers: { accept: 'application/json', 'user-agent': 'OST-API/1.0' },
        cf: { cacheTtl: 10, cacheEverything: true }
      });
      if (!response.ok) continue;
      const body = await response.json();
      const price = feed.pick(body);
      if (Number.isFinite(price) && price > 1) return price;
    } catch (_) {}
  }
  return null;
}

async function solanaRpc(env, method, params, options = {}) {
  const cluster = normalizeSolanaCluster(options.cluster || topupCluster(env));
  const urls = topupRpcUrls(env, cluster);
  let lastError = 'rpc_unavailable';
  for (const rpcUrl of urls) {
    try {
      const response = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: crypto.randomUUID(), method, params })
      });
      const body = await response.json().catch(() => ({}));
      if (response.ok && !body.error) return body.result;
      lastError = body?.error?.message || `solana_rpc_${response.status}`;
      if (/invalid|signature|transaction/i.test(lastError) && !/blocked|rate|too many|unavailable/i.test(lastError)) {
        throw new Error(lastError);
      }
    } catch (error) {
      lastError = String(error?.message || error);
      if (/invalid|signature|transaction/i.test(lastError) && !/blocked|rate|too many|unavailable/i.test(lastError)) {
        throw new Error(lastError);
      }
    }
  }
  throw new Error(lastError);
}

function accountKeyAt(tx, index) {
  const keys = tx?.transaction?.message?.accountKeys || [];
  const key = keys[index];
  return typeof key === 'string' ? key : key?.pubkey || '';
}

function collectParsedInstructions(tx) {
  const instructions = [...(tx?.transaction?.message?.instructions || [])];
  const inner = tx?.meta?.innerInstructions || [];
  for (const group of inner) {
    if (Array.isArray(group?.instructions)) instructions.push(...group.instructions);
  }
  return instructions;
}

function transactionHasMemo(tx, memo) {
  const needle = String(memo || '').trim();
  if (!needle) return false;
  for (const instruction of collectParsedInstructions(tx)) {
    const programId = String(instruction?.programId || '');
    if (instruction?.program === 'spl-memo' || programId.startsWith('Memo')) {
      const parsed = instruction?.parsed;
      if (typeof parsed === 'string' && parsed.includes(needle)) return true;
      if (parsed && typeof parsed === 'object' && String(parsed.memo || parsed.text || '').includes(needle)) return true;
    }
  }
  const logs = Array.isArray(tx?.meta?.logMessages) ? tx.meta.logMessages.join('\n') : '';
  return logs.includes(needle);
}

function sumSolLamportsTo(tx, receiver) {
  let total = 0;
  for (const instruction of collectParsedInstructions(tx)) {
    const parsed = instruction?.parsed;
    if (instruction?.program !== 'system' || !parsed || parsed.type !== 'transfer') continue;
    const info = parsed.info || {};
    if (String(info.destination || '') === receiver) total += Number(info.lamports || 0);
  }
  return total;
}

function tokenAmountFromInfo(info) {
  const tokenAmount = info?.tokenAmount || info?.uiTokenAmount;
  if (tokenAmount && Number.isFinite(Number(tokenAmount.uiAmount))) return Number(tokenAmount.uiAmount);
  if (tokenAmount && tokenAmount.uiAmountString) return Number(tokenAmount.uiAmountString);
  if (Number.isFinite(Number(info?.amount)) && Number.isFinite(Number(info?.decimals))) {
    return Number(info.amount) / (10 ** Number(info.decimals));
  }
  return Number(info?.amount || 0);
}

function sumUsdcToTreasury(tx, treasuryOwner, usdcMint) {
  const treasuryTokenAccounts = new Set();
  for (const balance of tx?.meta?.postTokenBalances || []) {
    if (balance?.mint === usdcMint && balance?.owner === treasuryOwner) {
      const account = accountKeyAt(tx, balance.accountIndex);
      if (account) treasuryTokenAccounts.add(account);
    }
  }
  let total = 0;
  for (const instruction of collectParsedInstructions(tx)) {
    const parsed = instruction?.parsed;
    const info = parsed?.info || {};
    if (instruction?.program !== 'spl-token' || !parsed) continue;
    if (parsed.type !== 'transfer' && parsed.type !== 'transferChecked') continue;
    if (info.mint && info.mint !== usdcMint) continue;
    if (!treasuryTokenAccounts.has(String(info.destination || ''))) continue;
    const amount = tokenAmountFromInfo(info);
    if (Number.isFinite(amount)) total += amount;
  }
  return total;
}

async function verifyCryptoTopupSignature(env, intent, signature) {
  const cluster = topupCluster(env);
  const usdcMint = topupUsdcMint(env, cluster);
  const cleanSignature = cleanText(signature, 128);
  if (!cleanSignature) return { ok: false, error: 'missing_signature' };
  let tx = null;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const statusRes = await solanaRpc(env, 'getSignatureStatuses', [[cleanSignature], { searchTransactionHistory: true }], { cluster });
    const status = statusRes?.value?.[0] || null;
    if (status?.err) return { ok: false, error: 'transaction_failed' };
    if (!status && attempt >= 2) {
      return { ok: false, error: 'transaction_not_found', detail: { retryable: true } };
    }

    const commitment = status?.confirmationStatus === 'finalized' ? 'finalized' : 'confirmed';
    tx = await solanaRpc(env, 'getTransaction', [cleanSignature, {
      encoding: 'jsonParsed',
      commitment,
      maxSupportedTransactionVersion: 0
    }], { cluster });
    if (tx) break;
    if (attempt < 7) {
      await new Promise((resolve) => setTimeout(resolve, 450 + attempt * 200));
    }
  }
  if (!tx) return { ok: false, error: 'transaction_not_found', detail: { retryable: true } };
  if (tx?.meta?.err) return { ok: false, error: 'transaction_failed' };
  if (!transactionHasMemo(tx, intent.memo)) return { ok: false, error: 'memo_not_found' };

  const treasury = topupSolReceiver(env, cluster) || topupUsdcReceiver(env, cluster) || '';
  const solLamports = sumSolLamportsTo(tx, treasury);
  const usdcAmount = sumUsdcToTreasury(tx, topupUsdcReceiver(env, cluster), usdcMint);
  const usdDue = Number(intent.usd || 0);
  const usdcPaid = usdcAmount + 0.000001 >= usdDue;
  let solPaid = false;
  let solUsd = null;
  if (solLamports > 0) {
    solUsd = await fetchSolUsd();
    if (solUsd) {
      const paidUsd = (solLamports / LAMPORTS_PER_SOL) * solUsd;
      solPaid = paidUsd + 0.02 >= usdDue * 0.985;
    }
  }
  if (!usdcPaid && !solPaid) {
    return {
      ok: false,
      error: 'amount_too_low',
      detail: { solLamports, usdcAmount, solUsd, usdDue }
    };
  }
  return {
    ok: true,
    signature: cleanSignature,
    rail: usdcPaid
      ? ('usdc-solana-' + (cluster === 'mainnet-beta' ? 'mainnet' : 'devnet'))
      : ('sol-solana-' + (cluster === 'mainnet-beta' ? 'mainnet' : 'devnet')),
    solLamports,
    usdcAmount,
    solUsd,
    slot: tx.slot || null
  };
}

async function markIntentPaidFromCrypto(env, intent, verification, options = {}) {
  const signatureKey = `topup:crypto:sig:${verification.signature}`;
  const existingIntentId = await kvGet(env, signatureKey, null);
  if (existingIntentId && existingIntentId !== intent.id) return { ok: false, error: 'signature_already_used' };
  intent.status = 'paid';
  intent.cryptoRail = verification.rail;
  intent.paymentRef = verification.signature;
  intent.paidAt = Date.now();
  intent.updatedAt = Date.now();
  await saveIntent(env, intent);
  await kvPut(env, signatureKey, intent.id, 60 * 60 * 24 * 90);
  if (options.enqueueDispatcher !== false) {
    await pushQueue(env, intent.id);
  }
  return { ok: true, intent };
}

async function findCryptoTopupPayment(env, intent) {
  const cluster = topupCluster(env);
  const receiver = topupSolReceiver(env, cluster) || '';
  if (!receiver) return null;
  const signatures = await solanaRpc(env, 'getSignaturesForAddress', [receiver, { limit: 120 }], { cluster });
  for (const item of signatures || []) {
    const signature = cleanText(item?.signature, 128);
    if (!signature) continue;
    const used = await kvGet(env, `topup:crypto:sig:${signature}`, null);
    if (used && used !== intent.id) continue;
    try {
      const verification = await verifyCryptoTopupSignature(env, intent, signature);
      if (verification.ok) return verification;
    } catch (_) {}
  }
  return null;
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

    // Ghost router (Phase 2) will be wired here.
    if (path.startsWith('/ghost/')) {
      const ghostV2 = await handleGhostV2Request(request, env, { path, method });
      if (ghostV2) return ghostV2;
      return json({ error: 'unknown ghost endpoint', path }, { status: 404 });
    }

    // OST Mesh — quantum-ready P2P signaling + identity directory.
    if (path.startsWith('/mesh/')) {
      return handleMeshRequest(request, env, { path, method });
    }

    // OST Faucet Gate — shared per-wallet faucet state + anti-double-claim reservations.
    if (path.startsWith('/faucet/v1/')) {
      if (!env.FAUCET_GATE) return json({ error: 'faucet_gate_not_configured' }, 503);
      const id = env.FAUCET_GATE.idFromName('global');
      return env.FAUCET_GATE.get(id).fetch(request);
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
          'GET  /btc/round',
          'GET  /btc/ticks',
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
          'POST /wallet/payouts',
          'GET  /wallet/payouts/recent',
          'GET  /wallet/payouts/:wallet',
          'GET  /launchpad/coins',
          'POST /launchpad/coins',
          'POST /launchpad/trade',
          'GET  /launchpad/ticks/:mint',
          'GET  /stocks/universe',
          'GET  /stocks/quotes',
          'GET  /stocks/:symbol',
          'GET  /stocks/:symbol/history',
          'GET  /stocks/orders/:wallet',
          'POST /stocks/orders',
          'GET  /topup/config',
          'POST /topup/intent',
          'POST /topup/checkout',
          'POST /topup/claim',
          'GET  /faucet/v1/state/:wallet',
          'POST /faucet/v1/reserve',
          'POST /faucet/v1/commit',
          'POST /faucet/v1/cancel',
          'POST /topup/crypto/verify',
          'GET  /topup/crypto/check/:intent',
          'POST /ghost/v2/memory/save',
          'GET  /ghost/v2/memory/recent',
          'GET  /mesh/v1/health',
          'POST /mesh/v1/identity/announce',
          'GET  /mesh/v1/identity/lookup',
          'POST /mesh/v1/signal/send',
          'GET  /mesh/v1/signal/inbox',
          'GET  /launchpad/coins',
          'POST /launchpad/coins',
          'POST /launchpad/trade',
          'GET  /launchpad/ticks/:mint',
          'GET  /bot/v1/health',
          'GET  /bot/v1/markets',
          'GET  /bot/v1/markets/:id',
          'GET  /bot/v1/btc/round',
          'GET  /bot/v1/quote/:id',
          'GET  /bot/v1/positions/:wallet',
          'POST /bot/v1/order',
          'POST /bot/v1/order/cashout'
        ]
      });
    }

    // ── GET /btc/price ───────────────────────────────────────────────────────
    // Canonical live price. ALL clients pull from here so they see identical
    // numbers; the worker also locks the round open price + appends to the
    // shared tick ring on every call.
    if (path === '/btc/price' && method === 'GET') {
      const result = await fetchBtcPrice();
      if (!result) {
        // Surface the cached latest so the chart doesn't go blank when a
        // single upstream blip happens.
        const cached = await kvGet(env, 'btc:latest', null);
        if (cached) return json({ price: cached.p, currency: 'USD', source: cached.s || 'cached', stale: true, round: currentRound(), ts: new Date(cached.t).toISOString() }, 200, { 'cache-control': 'no-store' });
        return json({ error: 'all_feeds_failed', price: null }, 503);
      }
      const round = currentRound();
      await lockRoundOpenPrice(env, round, result.price, result.source);
      await appendBtcTick(env, round, result.price, result.source);
      return json({
        price: result.price,
        currency: 'USD',
        source: result.source,
        round,
        ts: new Date().toISOString()
      }, 200, { 'cache-control': 'no-store' });
    }

    // ── GET /btc/round ───────────────────────────────────────────────────────
    // Single source of truth for the 5-min BTC round. Every browser/bot in the
    // SAME round MUST get the SAME openPrice + livePrice + yesPriceNumber here.
    // Resolves the "user A sees 80¢ NO, user B sees 50¢ NO" discrepancy.
    if (path === '/btc/round' && method === 'GET') {
      const refresh = url.searchParams.get('refresh') !== '0';
      const data = await buildCanonicalBtcRound(env, { refresh });
      return json(data, 200, { 'cache-control': 'no-store' });
    }

    // ── GET /btc/ticks ───────────────────────────────────────────────────────
    // Shared tick ring for the chart. Every client renders the SAME ticks so
    // the BTC line and YES/NO probability line line up across all devices.
    // Optional ?openAt=<ms> selects a specific round bucket; default = current.
    if (path === '/btc/ticks' && method === 'GET') {
      const openAtParam = Number(url.searchParams.get('openAt'));
      const round = Number.isFinite(openAtParam) && openAtParam > 0
        ? { openAt: Math.floor(openAtParam / FIVE_MIN_MS) * FIVE_MIN_MS, closeAt: Math.floor(openAtParam / FIVE_MIN_MS) * FIVE_MIN_MS + FIVE_MIN_MS }
        : currentRound();
      const since = Number(url.searchParams.get('since')) || 0;
      const ringKey = `btc:ticks:${round.openAt}`;
      let ring = await kvGet(env, ringKey, []);
      if (!Array.isArray(ring)) ring = [];
      const isCurrentRound = round.openAt === currentRound().openAt;
      const lastTick = ring.length ? ring[ring.length - 1] : null;
      if (isCurrentRound && (!ring.length || Date.now() - Number(lastTick && lastTick.t || 0) > 2000)) {
        const snapshot = await buildCanonicalBtcRound(env, { refresh: true });
        const livePrice = Number(snapshot && snapshot.livePrice);
        if (Number.isFinite(livePrice) && livePrice > 0) {
          const liveSource = snapshot.livePriceSource || 'ost-canonical';
          await appendBtcTick(env, round, livePrice, liveSource);
          const refreshedRing = await kvGet(env, ringKey, []);
          if (Array.isArray(refreshedRing) && refreshedRing.length) {
            ring = refreshedRing;
          } else {
            const syntheticTick = { t: Number(snapshot.livePriceTs) || Date.now(), p: livePrice, s: liveSource };
            ring = ring.concat([syntheticTick]).slice(-BTC_TICK_RING_MAX);
          }
        } else {
          const refreshedRing = await kvGet(env, ringKey, []);
          ring = Array.isArray(refreshedRing) ? refreshedRing : [];
        }
      }
      const ticks = since > 0 ? ring.filter(t => Number(t.t) > since) : ring;
      return json({
        openAt: round.openAt,
        closeAt: round.closeAt,
        ticks,
        count: ticks.length,
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
      // Return the canonical round so two browsers always see identical odds
      // and identical open price. Same payload as /btc/round, kept under both
      // paths for back-compat with older site builds.
      const data = await buildCanonicalBtcRound(env, { refresh: true });
      return json({ ...data, ts: new Date().toISOString() }, 200, { 'cache-control': 'no-store' });
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


    // -- GET /markets/state/:id - OST native market-maker state ---------------
    const nativeStateMatch = path.match(/^\/markets\/state\/([^/]+)$/);
    if (nativeStateMatch && method === 'GET') {
      const marketId = decodeURIComponent(nativeStateMatch[1]);
      const baseYes = cleanProbability(url.searchParams.get('baseYes'));
      const state = await getNativeMarketState(env, marketId, baseYes);
      return json({ ok: true, marketId, state, ts: new Date().toISOString() }, 200, { 'cache-control': 'no-store' });
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
      const nativeMarketStateBefore = isOstNativeMarketId(marketId, body.source)
        ? await getNativeMarketState(env, String(marketId), body.baseYesPrice != null ? body.baseYesPrice : body.fairYesPrice)
        : null;
      const nativeOpenPosition = nativeMarketStateBefore ? !positionIsClosed(body) : false;
      const nativeQuotePrice = nativeOpenPosition
        ? (String(side).toUpperCase() === 'NO' ? nativeMarketStateBefore.noPriceNumber : nativeMarketStateBefore.yesPriceNumber)
        : price;
      const inferredPrices = nativeOpenPosition
        ? inferBinaryPrices(side, nativeQuotePrice, nativeMarketStateBefore.yesPriceNumber, nativeMarketStateBefore.noPriceNumber)
        : inferBinaryPrices(side, price, body.yesPrice, body.noPrice);
      const inferredShares = nativeOpenPosition
        ? (inferredPrices.price > 0 ? Number(stake) / inferredPrices.price : cleanNumber(body.shares))
        : cleanNumber(body.shares);
      const inferredPotentialReturn = nativeOpenPosition
        ? (inferredShares > 0 ? inferredShares : cleanNumber(body.potentialReturn))
        : cleanNumber(body.potentialReturn);
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
        price: inferredPrices.price,
        yesPrice: inferredPrices.yesPrice,
        noPrice: inferredPrices.noPrice,
        shares: inferredShares,
        potentialReturn: inferredPotentialReturn,
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
        sellPrice: cleanNumber(body.sellPrice),
        sellValue: cleanNumber(body.sellValue),
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
      const flowRecord = recentFlowRecordForPosition(record);
      await kvPut(env, 'positions:recent', mergeNewest(recent, flowRecord, 100), 60 * 60 * 24 * 7);
      const marketState = await applyNativePositionToMarketState(env, record, nativeMarketStateBefore ? nativeMarketStateBefore.baseYesPrice : null);
      return json({ ok: true, stored: true, record, marketState, flowRecord: flowRecord !== record ? flowRecord : null });
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
      const { mint, side, amount, trader, signature } = body || {};
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
      const traderWallet = cleanText(trader || '', 64);
      const cleanSignature = cleanText(signature || body.sig || '', 128);
      ticks.unshift({ side, amount: amt, mcap: c.mcap, trader: traderWallet ? traderWallet.slice(0, 8) + '…' : 'anon', wallet: traderWallet, sig: cleanSignature, ts: Date.now() });
      await kvPut(env, tickKey, ticks, 60 * 60 * 24 * 7);
      if (traderWallet) {
        const event = {
          id: cleanSignature || crypto.randomUUID(),
          wallet: traderWallet,
          kind: side === 'sell' ? 'launchpad-sell' : 'launchpad-buy',
          amount: amt,
          sig: cleanSignature,
          source: 'launchpad',
          label: `${side === 'sell' ? 'Sell' : 'Buy'} $${c.symbol}`,
          token: cleanText(c.symbol || '', 32),
          marketId: c.mint,
          title: c.name,
          side: cleanText(side || '', 16),
          price: cleanNumber(c.mcap, 0),
          ts: Date.now()
        };
        const walletKey = `wallet:events:${traderWallet}`;
        const walletEvents = await kvGet(env, walletKey, []);
        await kvPut(env, walletKey, mergeNewest(walletEvents, event, 300));
      }
      return json({ ok: true, coin: c });
    }
    const tickMatch = path.match(/^\/launchpad\/ticks\/([^/]+)$/);
    if (tickMatch && method === 'GET') {
      const mint = decodeURIComponent(tickMatch[1]);
      if (!env.OST_KV) return json({ ticks: [] });
      const ticks = await kvGet(env, `launchpad:ticks:${mint}`, []);
      return json({ ticks, ts: new Date().toISOString() });
    }

    // -- STOCK MIRROR: public quote/history relay + OST-denominated orders ----
    if (path === '/stocks/universe' && method === 'GET') {
      return json({ universe: STOCK_UNIVERSE, count: STOCK_UNIVERSE.length, ts: new Date().toISOString() }, 200, { 'cache-control': 'public, max-age=300' });
    }
    if (path === '/stocks/quotes' && method === 'GET') {
      const rawSymbols = cleanText(url.searchParams.get('symbols') || '', 300)
        .split(',')
        .map(normalizeStockSymbol)
        .filter(Boolean);
      const symbols = (rawSymbols.length ? rawSymbols : STOCK_UNIVERSE.slice(0, 10).map(item => item.symbol)).slice(0, 24);
      const quotes = (await Promise.all(symbols.map(fetchStockQuote))).filter(Boolean);
      return json({ quotes, count: quotes.length, ts: new Date().toISOString(), source: 'stooq-public' }, 200, { 'cache-control': 'public, max-age=20' });
    }
    const stockHistoryMatch = path.match(/^\/stocks\/([^/]+)\/history$/);
    if (stockHistoryMatch && method === 'GET') {
      const symbol = normalizeStockSymbol(decodeURIComponent(stockHistoryMatch[1]));
      if (!symbol) return json({ error: 'invalid_symbol' }, 400);
      const result = await fetchStockHistory(symbol);
      return json({ symbol, history: result.history, count: result.history.length, ts: new Date().toISOString(), source: result.source }, 200, { 'cache-control': 'public, max-age=900' });
    }
    const stockQuoteMatch = path.match(/^\/stocks\/([^/]+)$/);
    if (stockQuoteMatch && method === 'GET') {
      const symbol = normalizeStockSymbol(decodeURIComponent(stockQuoteMatch[1]));
      if (!symbol) return json({ error: 'invalid_symbol' }, 400);
      const quote = await fetchStockQuote(symbol);
      if (!quote) return json({ error: 'quote_unavailable', symbol }, 502);
      return json({ quote, ts: new Date().toISOString() }, 200, { 'cache-control': 'public, max-age=20' });
    }
    const stockOrdersMatch = path.match(/^\/stocks\/orders\/([^/]+)$/);
    if (stockOrdersMatch && method === 'GET') {
      const wallet = cleanText(decodeURIComponent(stockOrdersMatch[1]), 64);
      if (!wallet) return json({ error: 'invalid_wallet' }, 400);
      if (!env.OST_KV) return json({ orders: [], note: 'KV not configured', wallet });
      const limit = Math.min(200, Number(url.searchParams.get('limit') || 100));
      const orders = await kvGet(env, `stocks:orders:${wallet}`, []);
      return json({ orders: orders.slice(0, limit), wallet, ts: new Date().toISOString() }, 200, { 'cache-control': 'no-store' });
    }
    if (path === '/stocks/orders' && method === 'POST') {
      let body;
      try { body = await request.json(); } catch (_) { return json({ error: 'invalid_json' }, 400); }
      const wallet = cleanText(body && body.wallet, 64);
      const symbol = normalizeStockSymbol(body && body.symbol);
      const side = String(body && body.side || '').toLowerCase() === 'sell' ? 'sell' : 'buy';
      const ostStake = cleanNumber(body && body.ostStake, 0) || 0;
      const quote = await fetchStockQuote(symbol).catch(() => null);
      const price = cleanNumber(body && body.price, quote && quote.price) || (quote && quote.price) || 0;
      if (!wallet || !symbol || !ostStake || ostStake <= 0 || !price) return json({ error: 'missing_fields', required: ['wallet', 'symbol', 'ostStake', 'price'] }, 400);
      if (!env.OST_KV) return json({ ok: true, stored: false, note: 'KV not configured' });
      const meta = stockMeta(symbol);
      const order = {
        id: cleanText(body.id || body.signature || crypto.randomUUID(), 160),
        wallet,
        symbol,
        name: cleanText(body.name || meta.name, 120),
        exchange: cleanText(body.exchange || meta.exchange, 40),
        sector: cleanText(body.sector || meta.sector, 60),
        side,
        price,
        shares: cleanNumber(body && body.shares, price > 0 ? cleanNumber(body && body.notionalUsd, 0) / price : 0) || 0,
        notionalUsd: cleanNumber(body && body.notionalUsd, 0) || 0,
        ostStake,
        brokerCurrency: cleanText(body && body.brokerCurrency || 'USD', 8),
        signature: cleanText(body && (body.signature || body.sig), 128),
        status: cleanText(body && body.status || 'ost-mirror-open', 32),
        settlement: 'OST devnet vault mirror; broker execution requires regulated KYC relay',
        quoteSource: quote && quote.source || 'client',
        quoteAsOf: quote && quote.asOf || '',
        createdAt: toMs(body && (body.createdAt || body.ts)),
        syncedAt: Date.now()
      };
      const walletKey = `stocks:orders:${wallet}`;
      const walletOrders = await kvGet(env, walletKey, []);
      await kvPut(env, walletKey, mergeNewest(walletOrders, order, 200));
      const recent = await kvGet(env, 'stocks:orders:recent', []);
      await kvPut(env, 'stocks:orders:recent', mergeNewest(recent, order, 200), 60 * 60 * 24 * 14);
      await recordStockWalletEvent(env, order);
      return json({ ok: true, stored: true, order });
    }

    // ── TOP-UP: real-money OST refill ───────────────────────────────────────
    // Tier table + receivers + Stripe enable flag.
    if (path === '/topup/config' && method === 'GET') {
      const cluster = topupCluster(env);
      const usdcReceiver = topupUsdcReceiver(env, cluster);
      const solReceiver = topupSolReceiver(env, cluster);
      const rate = topupUsdPerOst(env);
      let solUsd = null;
      try { solUsd = await fetchSolUsd(); } catch (_) {}
      return json({
        mode: 'flexible-value',
        pricing: {
          usdPerOst: rate,
          minUsd: TOPUP_MIN_USD,
          maxUsd: TOPUP_MAX_USD,
          suggestedUsd: [5, 10, 25, 50],
          solUsd
        },
        tiers: Object.entries(TOPUP_TIERS).map(([id, t]) => ({ id: Number(id), usd: t.usd, ostAmount: calculateTopupOst(t.usd, rate) })),
        stripeEnabled: !!env.STRIPE_SECRET_KEY,
        receivers: {
          usdcMainnet: env.TREASURY_USDC_MAINNET || usdcReceiver || null,
          solMainnet:  env.TREASURY_SOL_MAINNET  || solReceiver || null,
          usdcDevnet: env.TREASURY_USDC_DEVNET || usdcReceiver || null,
          solDevnet:  env.TREASURY_SOL_DEVNET  || solReceiver || null
        },
        ostMint: env.OST_MINT || '383pTzoZ8Gp83dzk23ZnvLcfX2Sq32TAGN48CMQu2pAJ',
        usdcMint: topupUsdcMint(env, cluster),
        cluster
      });
    }

    // Create an exact-value intent. Legacy tier requests are converted to USD,
    // then repriced server-side using the current flexible rate.
    if (path === '/topup/intent' && method === 'POST') {
      let body; try { body = await request.json(); } catch { return json({ error: 'invalid_json' }, 400); }
      const tierId = Number(body && body.tier);
      const legacyTier = TOPUP_TIERS[tierId];
      const usd = normalizeTopupUsd(body && body.usd !== undefined ? body.usd : legacyTier && legacyTier.usd);
      if (usd === null) return json({ error: 'invalid_usd_amount', minUsd: TOPUP_MIN_USD, maxUsd: TOPUP_MAX_USD }, 400);
      const rate = topupUsdPerOst(env);
      const ostAmount = calculateTopupOst(usd, rate);
      const wallet = String(body.wallet || '').trim();
      if (!isLikelySolanaAddress(wallet)) return json({ error: 'invalid_wallet' }, 400);
      const method2 = body.method === 'crypto' ? 'crypto' : 'stripe';
      if (!env.OST_KV) return json({ error: 'kv_not_configured' }, 503);

      const intent = {
        id: crypto.randomUUID(),
        memo: shortMemo(),
        tier: legacyTier ? tierId : null,
        usd,
        usdPerOst: rate,
        ostAmount,
        wallet,
        method: method2,
        status: 'pending',          // pending → paid → sent (or cancelled)
        signature: null,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      await saveIntent(env, intent);
      return json({ id: intent.id, memo: intent.memo, usd: intent.usd, usdPerOst: intent.usdPerOst, ostAmount: intent.ostAmount, status: intent.status });
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
            unit_amount: Math.round(Number(intent.usd || 0) * 100),
            product_data: {
              name: `OST Converter Hub - ${Number(intent.ostAmount || 0).toLocaleString()} OST`,
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
        usd: intent.usd,
        usdPerOst: intent.usdPerOst,
        method: intent.method,
        ostAmount: intent.ostAmount,
        signature: intent.signature || null,
        paymentRef: intent.paymentRef || null,
        wallet: intent.wallet,
        memo: intent.memo,
        createdAt: intent.createdAt,
        updatedAt: intent.updatedAt
      });
    }

    // Public: finalize a paid intent after the client-side devnet release.
    if (path === '/topup/claim' && method === 'POST') {
      if (!env.OST_KV) return json({ error: 'kv_not_configured' }, 503);
      let body; try { body = await request.json(); } catch { return json({ error: 'invalid_json' }, 400); }
      const intent = await loadIntent(env, body && body.id);
      if (!intent) return json({ error: 'not_found' }, 404);
      if (intent.status === 'sent') return json({ ok: true, intent });
      if (intent.status !== 'paid') return json({ error: 'intent_not_paid', status: intent.status }, 409);

      const deliveryWallet = cleanText(body && body.wallet, 64);
      if (deliveryWallet && intent.wallet && deliveryWallet !== intent.wallet) {
        return json({ error: 'wallet_mismatch' }, 409);
      }

      const deliverySignature = cleanText(body && body.signature, 128);
      if (!deliverySignature) return json({ error: 'missing_delivery_signature' }, 400);

      intent.status = 'sent';
      intent.signature = deliverySignature;
      intent.sentAt = Date.now();
      intent.updatedAt = Date.now();
      intent.deliveryKind = cleanText(body && body.deliveryKind, 40) || 'client-release';
      await saveIntent(env, intent);
      await removeQueue(env, intent.id);

      const recent = await kvGet(env, 'topup:sent', []);
      recent.unshift({
        id: intent.id,
        ostAmount: intent.ostAmount,
        wallet: intent.wallet,
        signature: intent.signature,
        sentAt: intent.sentAt,
        deliveryKind: intent.deliveryKind
      });
      await kvPut(env, 'topup:sent', recent.slice(0, 200));
      return json({ ok: true, intent });
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

    // Public: verify a user-submitted Solana mainnet payment signature.
    // If the transaction pays the configured treasury, includes the intent
    // memo, and covers the tier amount, the client can release devnet OST
    // immediately and then finalize the intent via /topup/claim.
    if (path === '/topup/crypto/verify' && method === 'POST') {
      if (!env.OST_KV) return json({ error: 'kv_not_configured' }, 503);
      let body; try { body = await request.json(); } catch { return json({ error: 'invalid_json' }, 400); }
      const intent = await loadIntent(env, body && body.intentId);
      if (!intent) return json({ error: 'intent_not_found' }, 404);
      if (intent.status === 'sent' || intent.status === 'paid') {
        return json({ ok: true, status: intent.status, intent });
      }
      if (intent.status !== 'pending') return json({ error: 'intent_not_pending', status: intent.status }, 409);
      let verification;
      try {
        verification = await verifyCryptoTopupSignature(env, intent, body && body.signature);
      } catch (error) {
        return json({ error: 'solana_rpc_failed', detail: cleanText(error?.message || error, 180) }, 502);
      }
      if (!verification.ok) return json({ error: verification.error, detail: verification.detail || null }, 400);
      const paid = await markIntentPaidFromCrypto(env, intent, verification, { enqueueDispatcher: false });
      if (!paid.ok) return json({ error: paid.error }, 409);
      return json({ ok: true, status: 'paid', rail: verification.rail, signature: verification.signature, intent: paid.intent });
    }

    // Public: lightweight auto-detection for SOL payments to the treasury
    // wallet. Manual signature verification above also handles USDC transfers.
    const cryptoCheckMatch = path.match(/^\/topup\/crypto\/check\/([^/]+)$/);
    if (cryptoCheckMatch && method === 'GET') {
      if (!env.OST_KV) return json({ error: 'kv_not_configured' }, 503);
      const intent = await loadIntent(env, decodeURIComponent(cryptoCheckMatch[1]));
      if (!intent) return json({ error: 'intent_not_found' }, 404);
      if (intent.status !== 'pending') return json({ ok: true, status: intent.status, intent });
      let verification = null;
      try {
        verification = await findCryptoTopupPayment(env, intent);
      } catch (error) {
        return json({ ok: true, status: 'pending', found: false, scanError: cleanText(error?.message || error, 180) });
      }
      if (!verification) return json({ ok: true, status: 'pending', found: false });
      const paid = await markIntentPaidFromCrypto(env, intent, verification, { enqueueDispatcher: false });
      if (!paid.ok) return json({ error: paid.error }, 409);
      return json({ ok: true, status: 'paid', found: true, rail: verification.rail, signature: verification.signature, intent: paid.intent });
    }

    // ── OFFLINE VAULT: proof sync queue ───────────────────────────────────
    // Public endpoint: devices upload locally verified bearer/game proofs when
    // they reconnect. This is the durable reconciliation queue; on-chain
    // settlement can consume these records in a later worker/dispatcher pass.
    if (path === '/offline-vault/sync' && method === 'POST') {
      if (!env.OST_KV) return json({ error: 'kv_not_configured' }, 503);
      let body; try { body = await request.json(); } catch { return json({ error: 'invalid_json' }, 400); }
      const deviceId = cleanText(body && body.deviceId, 80) || `anon-${crypto.randomUUID()}`;
      const events = Array.isArray(body && body.events) ? body.events.slice(0, 100) : [];
      if (!events.length) return json({ ok: true, accepted: 0, acceptedIds: [], status: 'empty' });

      const accepted = events.map((event) => ({
        id: cleanText(event && event.id, 100) || crypto.randomUUID(),
        kind: cleanText(event && event.kind, 80),
        amount: cleanNumber(event && event.amount, 0),
        ts: cleanNumber(event && event.ts, Date.now()),
        iso: cleanText(event && event.iso, 40),
        offline: !!(event && event.offline),
        source: cleanText(event && event.source, 80),
        tokenId: cleanText(event && event.tokenId, 120),
        proof: event && event.proof ? JSON.stringify(event.proof).slice(0, 4000) : null,
        game: cleanText(event && event.game, 80),
        receivedAt: Date.now()
      }));
      const key = `offline-vault:${deviceId}`;
      const existing = await kvGet(env, key, []);
      const merged = accepted.reduce((bucket, record) => mergeNewest(bucket, record, 500), existing);
      await kvPut(env, key, merged, 60 * 60 * 24 * 90);

      const recent = await kvGet(env, 'offline-vault:recent', []);
      const recentMerged = accepted.reduce((bucket, record) => mergeNewest(bucket, { ...record, deviceId }, 500), recent);
      await kvPut(env, 'offline-vault:recent', recentMerged, 60 * 60 * 24 * 30);

      return json({
        ok: true,
        accepted: accepted.length,
        acceptedIds: accepted.map((e) => e.id),
        status: 'queued_for_onchain_reconciliation',
        deviceId
      });
    }

    const offlineVaultStatusMatch = path.match(/^\/offline-vault\/status\/([^/]+)$/);
    if (offlineVaultStatusMatch && method === 'GET') {
      if (!env.OST_KV) return json({ events: [], count: 0 });
      const deviceId = cleanText(decodeURIComponent(offlineVaultStatusMatch[1]), 80);
      const events = await kvGet(env, `offline-vault:${deviceId}`, []);
      return json({ deviceId, events: events.slice(0, 50), count: events.length, ts: new Date().toISOString() });
    }

    // ── Payout audit ledger ──────────────────────────────────────────────────
    // Every client-side payout (faucet cash-out, prediction sell, top-up
    // claim, stock sell, fair-game win) writes an "intent" entry here BEFORE
    // signing the on-chain tx, then writes the result afterwards. If the
    // browser crashes between intent + result, the unresolved intent stays
    // visible so support / scripts can reconcile lost OST.
    if (path === '/wallet/payouts' && method === 'POST') {
      let body;
      try { body = await request.json(); } catch (_) { return json({ error: 'invalid_json' }, 400); }
      const wallet = cleanText(body && body.wallet, 64);
      if (!wallet) return json({ error: 'missing_wallet' }, 400);
      if (!env.OST_KV) return json({ ok: true, stored: false });
      const stage = cleanText(body && body.stage || 'intent', 16); // 'intent' | 'result' | 'failure'
      const id = cleanText(body && body.id || crypto.randomUUID(), 80);
      const record = {
        id,
        wallet,
        walletShort: wallet.slice(0, 4) + '…' + wallet.slice(-4),
        stage,
        kind: cleanText(body.kind || 'payout', 32),     // faucet|prediction|topup|stock|game
        ostAmount: cleanNumber(body.ostAmount, 0),
        memo: cleanText(body.memo || '', 240),
        sig: cleanText(body.sig || body.signature || '', 128),
        error: cleanText(body.error || '', 240),
        ref: cleanText(body.ref || '', 128),            // intent id, market id, etc.
        ts: Date.now()
      };
      const walletKey = `payouts:${wallet}`;
      const bucket = await kvGet(env, walletKey, []);
      // Replace prior entry with same id (intent → result) instead of duplicating
      const existingIdx = bucket.findIndex(e => e && e.id === id);
      if (existingIdx >= 0) {
        bucket[existingIdx] = Object.assign({}, bucket[existingIdx], record, { history: (bucket[existingIdx].history || []).concat([{ stage: bucket[existingIdx].stage, ts: bucket[existingIdx].ts }]).slice(-5) });
      } else {
        bucket.unshift(record);
      }
      // Cap per-wallet history at 200 entries.
      if (bucket.length > 200) bucket.length = 200;
      await kvPut(env, walletKey, bucket, 60 * 60 * 24 * 30);
      // Global tail (newest 500) for support dashboards
      const tail = await kvGet(env, 'payouts:tail', []);
      tail.unshift({ wallet, walletShort: record.walletShort, kind: record.kind, stage, ostAmount: record.ostAmount, sig: record.sig, error: record.error, ts: record.ts, id });
      if (tail.length > 500) tail.length = 500;
      await kvPut(env, 'payouts:tail', tail, 60 * 60 * 24 * 14);
      return json({ ok: true, stored: true, record });
    }

    if (path === '/wallet/payouts/recent' && method === 'GET') {
      if (!env.OST_KV) return json({ recent: [], note: 'KV not configured' });
      const limit = Math.min(200, Number(url.searchParams.get('limit') || 50));
      const tail = await kvGet(env, 'payouts:tail', []);
      return json({ recent: tail.slice(0, limit), ts: new Date().toISOString() }, 200, { 'cache-control': 'no-store' });
    }

    const walletPayoutsMatch = path.match(/^\/wallet\/payouts\/([^/]+)$/);
    if (walletPayoutsMatch && method === 'GET') {
      const wallet = decodeURIComponent(walletPayoutsMatch[1]);
      if (!env.OST_KV) return json({ payouts: [], wallet, note: 'KV not configured' });
      const bucket = await kvGet(env, `payouts:${wallet}`, []);
      const onlyOpen = url.searchParams.get('open') === '1';
      const filtered = onlyOpen ? bucket.filter(e => e && e.stage === 'intent') : bucket;
      return json({ payouts: filtered, wallet, count: filtered.length, ts: new Date().toISOString() }, 200, { 'cache-control': 'no-store' });
    }

    // ── Bot / autonomous AI trader API ───────────────────────────────────────
    // Public, documented surface so external bots can buy / sell / hold /
    // re-buy / arbitrage in OST prediction markets without driving the UI.
    // Auth: pass header `x-ost-bot-key`. The default public key is enabled
    // unless BOT_API_KEY is set in worker secrets, so anyone can smoke-test
    // the API in dev with a single header.
    if (path.startsWith('/bot/v1/')) {
      const expectedKey = (env.BOT_API_KEY || 'ost-bot-public-test-key');
      const presentedKey = request.headers.get('x-ost-bot-key') || url.searchParams.get('botKey') || '';
      const sub = path.slice('/bot/v1'.length);

      if (sub === '/health' && method === 'GET') {
        return json({
          ok: true,
          service: 'ost-bot-api',
          version: '1.0',
          authRequired: !!env.BOT_API_KEY,
          docs: {
            markets: 'GET /bot/v1/markets — Polymarket + OST native markets',
            market:  'GET /bot/v1/markets/:id — single market with book + odds',
            btcRound:'GET /bot/v1/btc/round — canonical 5-min BTC round',
            quote:   'GET /bot/v1/quote/:id?side=yes&stake=10 — price + expected payout',
            buy:     'POST /bot/v1/order — body {wallet, marketId, side, stake, price, signature?}',
            cashout: 'POST /bot/v1/order/cashout — body {wallet, orderId, signature, payoutOst}',
            positions: 'GET /bot/v1/positions/:wallet'
          },
          ts: new Date().toISOString()
        }, 200, { 'cache-control': 'no-store' });
      }

      // Reject unauthenticated bot calls EXCEPT /health (so docs are reachable).
      if (presentedKey !== expectedKey) {
        return json({ error: 'unauthorized', message: 'Pass x-ost-bot-key header. See /bot/v1/health for docs.' }, 401);
      }

      if (sub === '/markets' && method === 'GET') {
        const limit = Math.min(200, Number(url.searchParams.get('limit') || 60));
        const raw = await polyGamma(env, '/markets', `limit=${limit}&closed=false`);
        const markets = (Array.isArray(raw) ? raw : raw?.markets || []).map(normaliseMarket);
        const btcRound = await buildCanonicalBtcRound(env, { refresh: false });
        const nativeState = btcRound && btcRound.openPrice ? await getNativeMarketState(env, btcRound.id, btcRound.yesPriceNumber) : null;
        const ostNative = btcRound.openPrice ? [{
          id: btcRound.id,
          source: 'ost',
          title: '5-min BTC: will price be UP at close?',
          isOstNative: true,
          openPrice: btcRound.openPrice,
          livePrice: btcRound.livePrice,
          yesPriceNumber: nativeState ? nativeState.yesPriceNumber : btcRound.yesPriceNumber,
          noPriceNumber: nativeState ? nativeState.noPriceNumber : btcRound.noPriceNumber,
          marketState: nativeState,
          closeAtMs: btcRound.closeAt,
          msLeft: btcRound.msLeft
        }] : [];
        return json({ markets: ostNative.concat(markets), count: ostNative.length + markets.length, ts: new Date().toISOString() }, 200, { 'cache-control': 'no-store' });
      }

      const botMktMatch = sub.match(/^\/markets\/([^/]+)$/);
      if (botMktMatch && method === 'GET') {
        const id = decodeURIComponent(botMktMatch[1]);
        if (id.indexOf('ost-btc5m-') === 0) {
          const r = await buildCanonicalBtcRound(env, { refresh: true });
          const state = await getNativeMarketState(env, id, r && r.yesPriceNumber);
          return json({ market: Object.assign({}, r, state, { marketState: state }), source: 'ost-native' }, 200, { 'cache-control': 'no-store' });
        }
        const [gmkt, book] = await Promise.all([
          polyGamma(env, `/markets/${encodeURIComponent(id)}`),
          polyClob(env, '/book', `token_id=${encodeURIComponent(id)}`)
        ]);
        if (!gmkt) return json({ error: 'market_not_found', id }, 404);
        return json({ market: normaliseMarket(gmkt), book: book || null, source: 'polymarket', ts: new Date().toISOString() }, 200, { 'cache-control': 'no-store' });
      }

      if (sub === '/btc/round' && method === 'GET') {
        const r = await buildCanonicalBtcRound(env, { refresh: true });
        return json(r, 200, { 'cache-control': 'no-store' });
      }

      const quoteMatch = sub.match(/^\/quote\/([^/]+)$/);
      if (quoteMatch && method === 'GET') {
        const id = decodeURIComponent(quoteMatch[1]);
        const side = (url.searchParams.get('side') || 'yes').toLowerCase() === 'no' ? 'NO' : 'YES';
        const stake = Math.max(0, Number(url.searchParams.get('stake')) || 0);
        let price = 0.5;
        if (id.indexOf('ost-btc5m-') === 0) {
          const r = await getNativeMarketState(env, id, url.searchParams.get('baseYes'));
          price = side === 'NO' ? r.noPriceNumber : r.yesPriceNumber;
        } else {
          const gmkt = await polyGamma(env, `/markets/${encodeURIComponent(id)}`);
          if (!gmkt) return json({ error: 'market_not_found', id }, 404);
          const m = normaliseMarket(gmkt);
          price = side === 'NO' ? m.noPriceNumber : m.yesPriceNumber;
        }
        const shares = price > 0 ? stake / price : 0;
        const expectedPayout = shares; // 1 OST per winning share
        return json({
          marketId: id,
          side,
          price,
          stake,
          shares,
          expectedPayout,
          expectedReturn: expectedPayout - stake,
          ts: new Date().toISOString()
        }, 200, { 'cache-control': 'no-store' });
      }

      const botPosMatch = sub.match(/^\/positions\/([^/]+)$/);
      if (botPosMatch && method === 'GET') {
        const wallet = decodeURIComponent(botPosMatch[1]);
        if (!env.OST_KV) return json({ positions: [], note: 'KV not configured', wallet });
        const positions = await kvGet(env, `positions:${wallet}`, []);
        return json({ positions, wallet, count: positions.length, ts: new Date().toISOString() }, 200, { 'cache-control': 'no-store' });
      }

      if (sub === '/order' && method === 'POST') {
        let body;
        try { body = await request.json(); } catch (_) { return json({ error: 'invalid_json' }, 400); }
        const wallet = cleanText(body && body.wallet, 64);
        const marketId = cleanText(body && body.marketId, 128);
        const side = String((body && body.side) || 'yes').toUpperCase().slice(0, 8);
        const stake = Number(body && body.stake);
        if (!wallet || !marketId || !Number.isFinite(stake) || stake <= 0) {
          return json({ error: 'missing_fields', required: ['wallet', 'marketId', 'side', 'stake'] }, 400);
        }
        // Resolve a fair quote price right now so the bot can't backdate.
        const nativeMarketStateBefore = isOstNativeMarketId(marketId, body && body.source)
          ? await getNativeMarketState(env, marketId, body && (body.baseYesPrice != null ? body.baseYesPrice : body.fairYesPrice))
          : null;
        let price = nativeMarketStateBefore
          ? (side === 'NO' ? nativeMarketStateBefore.noPriceNumber : nativeMarketStateBefore.yesPriceNumber)
          : Number(body && body.price);
        if (!Number.isFinite(price) || price <= 0 || price >= 1) {
          if (marketId.indexOf('ost-btc5m-') === 0) {
            const r = await buildCanonicalBtcRound(env, { refresh: true });
            price = side === 'NO' ? r.noPriceNumber : r.yesPriceNumber;
          } else {
            const gmkt = await polyGamma(env, `/markets/${encodeURIComponent(marketId)}`);
            if (!gmkt) return json({ error: 'market_not_found', marketId }, 404);
            const m = normaliseMarket(gmkt);
            price = side === 'NO' ? m.noPriceNumber : m.yesPriceNumber;
          }
        }
        const inferredPrices = nativeMarketStateBefore
          ? inferBinaryPrices(side, price, nativeMarketStateBefore.yesPriceNumber, nativeMarketStateBefore.noPriceNumber)
          : inferBinaryPrices(side, price, body && body.yesPrice, body && body.noPrice);
        price = inferredPrices.price;
        const createdAt = Date.now();
        const id = cleanText(body.id || body.signature || `bot-${createdAt}-${Math.random().toString(36).slice(2, 10)}`, 128);
        const record = {
          id,
          wallet,
          walletShort: wallet.slice(0, 4) + '…' + wallet.slice(-4),
          marketId,
          marketTitle: cleanText(body.marketTitle || body.title || marketId, 200),
          title: cleanText(body.title || body.marketTitle || marketId, 200),
          side,
          stake,
          price,
          yesPrice: inferredPrices.yesPrice,
          noPrice: inferredPrices.noPrice,
          shares: price > 0 ? stake / price : 0,
          potentialReturn: price > 0 ? stake / price : stake,
          source: 'bot',
          channel: cleanText(body.channel || 'bot-api', 32),
          signature: cleanText(body.signature || '', 128),
          sig: cleanText(body.signature || '', 128),
          createdAt,
          ts: new Date(createdAt).toISOString(),
          status: 'open',
          syncedAt: createdAt
        };
        if (env.OST_KV) {
          const walletKey = `positions:${wallet}`;
          const walletBucket = await kvGet(env, walletKey, []);
          await kvPut(env, walletKey, mergeNewest(walletBucket, record, 200));
          const recent = await kvGet(env, 'positions:recent', []);
          await kvPut(env, 'positions:recent', mergeNewest(recent, record, 100), 60 * 60 * 24 * 7);
        }
        const marketState = await applyNativePositionToMarketState(env, record, nativeMarketStateBefore ? nativeMarketStateBefore.baseYesPrice : null);
        return json({ ok: true, order: record, stored: !!env.OST_KV, marketState }, 200, { 'cache-control': 'no-store' });
      }

      if (sub === '/order/cashout' && method === 'POST') {
        let body;
        try { body = await request.json(); } catch (_) { return json({ error: 'invalid_json' }, 400); }
        const wallet = cleanText(body && body.wallet, 64);
        const orderId = cleanText(body && body.orderId, 128);
        if (!wallet || !orderId) return json({ error: 'missing_fields', required: ['wallet', 'orderId'] }, 400);
        if (!env.OST_KV) return json({ error: 'kv_not_configured' }, 503);
        const walletKey = `positions:${wallet}`;
        const walletBucket = await kvGet(env, walletKey, []);
        const idx = walletBucket.findIndex(p => p && (p.id === orderId || p.signature === orderId));
        if (idx < 0) return json({ error: 'order_not_found', orderId }, 404);
        const order = walletBucket[idx];
        order.status = 'cashed-out';
        order.cashedOut = true;
        order.cashoutKind = cleanText(body.cashoutKind || 'bot-cashout', 40);
        order.cashoutSig = cleanText(body.signature || '', 128);
        order.cashoutOst = cleanNumber(body.payoutOst, order.potentialReturn);
        order.cashoutAt = Date.now();
        order.resolvedAt = Date.now();
        walletBucket[idx] = order;
        await kvPut(env, walletKey, walletBucket);
        const marketState = await applyNativePositionToMarketState(env, order, order.yesPrice);
        const recent = await kvGet(env, 'positions:recent', []);
        const flowRecord = recentFlowRecordForPosition(order);
        await kvPut(env, 'positions:recent', mergeNewest(recent, flowRecord, 100), 60 * 60 * 24 * 7);
        return json({ ok: true, order, marketState, flowRecord: flowRecord !== order ? flowRecord : null }, 200, { 'cache-control': 'no-store' });
      }

      return json({ error: 'unknown_bot_endpoint', path, hint: 'GET /bot/v1/health for docs' }, 404);
    }

    return json({ error: 'not_found', message: 'Unknown endpoint. GET /health for the full endpoint list.' }, 404);
  }
};

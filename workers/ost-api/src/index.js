// Ghost AI v2 — sovereign rebuild. Mounts at /ghost/v2/*
import { handleGhostV2Request } from './ghost/index.js';
import { handleMeshRequest }    from './mesh/index.js';
import { handleOstPriceRequest } from './ost-price.js';
import { handleRealtimeRequest, publishRealtimeEvent } from './realtime.js';
import { handleWalletPayoutsRequest } from './wallet-payouts.js';
import { handleGamesRngRequest } from './games-rng.js';
import { handleSettlementRequest } from './settlement.js';
import { handleAdRequest } from './ad-treasury.js';
import { handleAnchorRequest } from './ost-anchor.js';
import { handleBalanceTruth } from './balance-truth.js';

export { MeshHub } from './mesh/hub.js';
export { RealtimeHub } from './realtime.js';
export { PayoutGate } from './wallet-payouts.js';
export { GameSeedHub } from './games-rng.js';
export { PurchaseLedger } from './purchase-ledger.js';
export { AdTreasury } from './ad-treasury.js';
export { LoanLedger } from './loan-ledger.js';
export { PredictionLedger } from './prediction-ledger.js';
export { PlayLedger } from './play-ledger.js';

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
  'Access-Control-Expose-Headers': 'x-ost-relay',
  'Access-Control-Max-Age': '86400'
};
const FIVE_MIN_MS = 5 * 60 * 1000;

// ── helpers ─────────────────────────────────────────────────────────────────

import { handlePush } from './push.js';

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
    description: '5-minute BTC-USDT direction market. Settles on Binance spot at close.'
  };
}

// ── BTC price: waterfall of public feeds ─────────────────────────────────────

const BTC_FEEDS = [
  {
    name: 'binance',
    url: 'https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT',
    pick: j => j?.price && Number(j.price)
  },
  {
    name: 'binance-vision',
    url: 'https://data-api.binance.vision/api/v3/ticker/price?symbol=BTCUSDT',
    pick: j => j?.price && Number(j.price)
  },
  {
    name: 'coinbase',
    url: 'https://api.coinbase.com/v2/prices/BTC-USD/spot',
    pick: j => j?.data?.amount && Number(j.data.amount)
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
        headers: {
          accept: 'application/json',
          'cache-control': 'no-cache, no-store, max-age=0',
          pragma: 'no-cache',
          'user-agent': 'OST-API/1.0'
        },
        cf: { cacheTtl: 0 }
      });
      if (!r.ok) continue;
      const j = await r.json();
      const price = feed.pick(j);
      if (Number.isFinite(price) && price > 1000) return { price, source: feed.name };
    } catch (_) { /* try next */ }
  }
  return null;
}

async function fetchBtcPriceFast(timeoutMs = 520) {
  const attempts = BTC_FEEDS.map(async feed => {
    const r = await fetchWithDeadline(feed.url, {
      headers: {
        accept: 'application/json',
        'cache-control': 'no-cache, no-store, max-age=0',
        pragma: 'no-cache',
        'user-agent': 'OST-API/1.0'
      },
      cf: { cacheTtl: 0 }
    }, timeoutMs);
    if (!r.ok) throw new Error(feed.name + ' ' + r.status);
    const j = await r.json();
    const price = feed.pick(j);
    if (!Number.isFinite(price) || price <= 1000) throw new Error(feed.name + ' empty price');
    return { price, source: feed.name };
  });
  const results = await Promise.allSettled(attempts);
  for (const result of results) {
    if (result.status === 'fulfilled' && result.value) return result.value;
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
// Share-price bounds: a side can bottom at 0.1c and top at 99.9c (~100c).
// Was 2c/98c, which clipped deep in/out-of-the-money quotes on both ends.
const BTC_PROB_MIN = 0.001;
const BTC_PROB_MAX = 0.999;
const BTC_LIVE_REFRESH_MS = 650;        // keep Binance stream hot without stale 50/50 rounds
const BTC_DO_SNAPSHOT_CACHE_MS = 250;   // sub-second shared cache inside the Durable Object
const BTC_DO_TICK_MIN_GAP_MS = 550;
const BTC_ROUND_OPEN_MEMORY = new Map();
const BTC_PRIOR_DRIFT_MEMORY = new Map();
// Forward-projection blend factor — priceToBeat = openPrice * (1 + driftBlend * priorDrift).
// Half-mean-revert: assume the next 5 min will repeat ~50% of the last 5 min's drift.
const BTC_DRIFT_BLEND = 0.5;
// Cap projection so a one-off 5-min spike can't push priceToBeat absurdly far
// from the open price (locks the round into a guaranteed YES/NO).
const BTC_DRIFT_CAP_PCT = 0.30;

async function storeRoundOpenPrice(env, round, price, source, ts, priceToBeat) {
  if (!env.OST_KV || !Number.isFinite(price) || price <= 0) return null;
  const beat = Number.isFinite(priceToBeat) && priceToBeat > 0 ? priceToBeat : price;
  const record = {
    openAt: round.openAt,
    closeAt: round.closeAt,
    openPrice: price,
    priceToBeat: beat,
    priceToBeatSource: beat === price ? 'open' : 'projected-5m-drift',
    openPriceSource: source || '',
    openPriceTs: Number(ts) || Date.now(),
    lockedBy: 'worker'
  };
  await kvPut(env, `round:${round.openAt}`, record, 60 * 60 * 2);
  return record;
}

// Fetch the prior 5-min Binance kline so we can project a forward priceToBeat
// instead of using the raw open price (which leaves YES/NO pinned for users
// when BTC trends one way for several minutes). Returns drift fraction
// (priorClose - priorOpen)/priorOpen, or 0 if unavailable.
async function fetchBtcPrior5mDrift(round) {
  const cached = BTC_PRIOR_DRIFT_MEMORY.get(round.openAt);
  if (cached !== undefined) return cached;
  const priorOpenAt = round.openAt - 5 * 60 * 1000;
  const urls = [
    `https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=5m&startTime=${priorOpenAt}&limit=1`,
    `https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=5m&startTime=${priorOpenAt}&limit=1`
  ];
  for (const url of urls) {
    try {
      const r = await fetch(url, {
        headers: {
          accept: 'application/json',
          'cache-control': 'no-cache, no-store, max-age=0',
          pragma: 'no-cache',
          'user-agent': 'OST-API/1.0'
        },
        cf: { cacheTtl: 0 }
      });
      if (!r.ok) continue;
      const rows = await r.json();
      const row = Array.isArray(rows) ? rows[0] : null;
      const openTime = Number(row && row[0]);
      const op = Number(row && row[1]);
      const cp = Number(row && row[4]);
      if (openTime === priorOpenAt && Number.isFinite(op) && op > 1000 && Number.isFinite(cp) && cp > 0) {
        const drift = (cp - op) / op;
        BTC_PRIOR_DRIFT_MEMORY.set(round.openAt, drift);
        if (BTC_PRIOR_DRIFT_MEMORY.size > 8) {
          const oldest = Array.from(BTC_PRIOR_DRIFT_MEMORY.keys()).sort((a, b) => a - b)[0];
          BTC_PRIOR_DRIFT_MEMORY.delete(oldest);
        }
        return drift;
      }
    } catch (_) { /* try next */ }
  }
  BTC_PRIOR_DRIFT_MEMORY.set(round.openAt, 0);
  return 0;
}

function projectPriceToBeat(openPrice, priorDrift) {
  if (!Number.isFinite(openPrice) || openPrice <= 0) return openPrice;
  if (!Number.isFinite(priorDrift) || priorDrift === 0) return openPrice;
  const blended = priorDrift * BTC_DRIFT_BLEND;
  const cap = BTC_DRIFT_CAP_PCT / 100; // 0.003 → ±0.3%
  const clamped = Math.max(-cap, Math.min(cap, blended));
  return openPrice * (1 + clamped);
}

async function fetchBtcRoundOpenPrice(round) {
  const cached = BTC_ROUND_OPEN_MEMORY.get(round.openAt);
  if (cached && Number.isFinite(Number(cached.price)) && Number(cached.price) > 0) return cached;
  const urls = [
    `https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=5m&startTime=${round.openAt}&limit=1`,
    `https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=5m&startTime=${round.openAt}&limit=1`
  ];
  for (const url of urls) {
    try {
      const r = await fetch(url, {
        headers: {
          accept: 'application/json',
          'cache-control': 'no-cache, no-store, max-age=0',
          pragma: 'no-cache',
          'user-agent': 'OST-API/1.0'
        },
        cf: { cacheTtl: 0 }
      });
      if (!r.ok) continue;
      const rows = await r.json();
      const row = Array.isArray(rows) ? rows[0] : null;
      const openTime = Number(row && row[0]);
      const openPrice = Number(row && row[1]);
      if (openTime === round.openAt && Number.isFinite(openPrice) && openPrice > 1000) {
        const source = url.includes('binance.vision') ? 'binance-kline' : 'binance-kline-api';
        const record = { price: openPrice, source, t: openTime };
        BTC_ROUND_OPEN_MEMORY.set(round.openAt, record);
        if (BTC_ROUND_OPEN_MEMORY.size > 6) {
          const oldest = Array.from(BTC_ROUND_OPEN_MEMORY.keys()).sort((a, b) => a - b)[0];
          BTC_ROUND_OPEN_MEMORY.delete(oldest);
        }
        return record;
      }
    } catch (_) { /* try next */ }
  }
  return null;
}

async function fetchBtcPrior5mDriftFast(round, timeoutMs = 180) {
  return Promise.race([
    fetchBtcPrior5mDrift(round).catch(() => 0),
    new Promise(resolve => setTimeout(() => resolve(0), timeoutMs))
  ]);
}

async function fetchBtcRoundOpenPriceFast(round, timeoutMs = 520) {
  const cached = BTC_ROUND_OPEN_MEMORY.get(round.openAt);
  if (cached && Number.isFinite(Number(cached.price)) && Number(cached.price) > 0) return cached;
  const urls = [
    `https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=5m&startTime=${round.openAt}&limit=1`,
    `https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=5m&startTime=${round.openAt}&limit=1`
  ];
  const attempts = urls.map(async url => {
    const r = await fetchWithDeadline(url, {
      headers: {
        accept: 'application/json',
        'cache-control': 'no-cache, no-store, max-age=0',
        pragma: 'no-cache',
        'user-agent': 'OST-API/1.0'
      },
      cf: { cacheTtl: 0 }
    }, timeoutMs);
    if (!r.ok) throw new Error('kline ' + r.status);
    const rows = await r.json();
    const row = Array.isArray(rows) ? rows[0] : null;
    const openTime = Number(row && row[0]);
    const openPrice = Number(row && row[1]);
    if (openTime !== round.openAt || !Number.isFinite(openPrice) || openPrice <= 1000) throw new Error('kline empty');
    const source = url.includes('binance.vision') ? 'binance-kline' : 'binance-kline-api';
    const record = { price: openPrice, source, t: openTime };
    BTC_ROUND_OPEN_MEMORY.set(round.openAt, record);
    if (BTC_ROUND_OPEN_MEMORY.size > 6) {
      const oldest = Array.from(BTC_ROUND_OPEN_MEMORY.keys()).sort((a, b) => a - b)[0];
      BTC_ROUND_OPEN_MEMORY.delete(oldest);
    }
    return record;
  });
  try {
    return Promise.any ? await Promise.any(attempts) : await attempts[0].catch(() => attempts[1]);
  } catch (_) {
    return null;
  }
}

async function lockRoundOpenPrice(env, round, price, source) {
  if (!env.OST_KV || !Number.isFinite(price) || price <= 0) return null;
  const key = `round:${round.openAt}`;
  const existing = await kvGet(env, key, null);
  if (existing && Number.isFinite(Number(existing.openPrice)) && Number(existing.openPrice) > 0) {
    // Open price already locked for this round — never overwrite.
    // Backfill priceToBeat once if a previous worker version locked the
    // round before the projected target existed.
    if (!(Number.isFinite(Number(existing.priceToBeat)) && Number(existing.priceToBeat) > 0)) {
      const drift = await fetchBtcPrior5mDrift(round);
      const beat = projectPriceToBeat(Number(existing.openPrice), drift);
      const patched = {
        ...existing,
        priceToBeat: beat,
        priceToBeatSource: beat === Number(existing.openPrice) ? 'open' : 'projected-5m-drift'
      };
      await kvPut(env, key, patched, 60 * 60 * 2);
      return patched;
    }
    return existing;
  }
  // 2h TTL is long enough to cover settlement after close + late-arriving bots.
  const drift = await fetchBtcPrior5mDrift(round);
  const beat = projectPriceToBeat(price, drift);
  return storeRoundOpenPrice(env, round, price, source, Date.now(), beat);
}

async function appendBtcTick(env, round, price, source) {
  if (!Number.isFinite(price) || price <= 0) return;
  const now = Date.now();
  const latest = { t: now, p: price, s: source || '', round: round.openAt };
  // ALWAYS keep the freshest tick in isolate memory — free, instant, and totally
  // independent of KV. Reads prefer this, so the live price the prediction market
  // streams NEVER waits on (or is bottlenecked by) KV. This is the "work with the
  // bottleneck" path: the price keeps flowing even when KV is exhausted.
  memPut('btc:latest', latest, BTC_LIVE_TTL_S);
  // Under KV pressure (breaker tripped) OR no KV, do NOT touch the KV tick ring at
  // all — the ephemeral per-round display ring is the first thing to shed. The
  // client renders live ticks from Pyth (Solana's oracle) directly regardless, so
  // dropping the KV ring costs nothing user-visible and stops it burning the
  // ~1k/day KV write budget.
  if (!env.OST_KV || tierDown('kv')) return;
  const ringKey = `btc:ticks:${round.openAt}`;
  const ring = await kvGet(env, ringKey, []);
  const last = ring.length ? ring[ring.length - 1] : null;
  // Dedupe identical prints inside 800ms — same guard the client used to apply.
  if (last && last.p === price && now - last.t < 800) return;
  ring.push({ t: now, p: price, s: source || '' });
  if (ring.length > BTC_TICK_RING_MAX) ring.splice(0, ring.length - BTC_TICK_RING_MAX);
  await kvPut(env, ringKey, ring, 60 * 60 * 1);
  // "latest tick" pointer (KV_HOT_RE-throttled) so cross-isolate reads still work.
  await kvPut(env, 'btc:latest', latest, BTC_LIVE_TTL_S);
}

// Deterministic 5-min BTC YES/NO equation. SAME inputs => SAME outputs across
// every client and bot. No Math.random, no per-client volatility window.
//   openPrice  : USD locked at the start of the round
//   livePrice  : latest USD tick
//   msLeft     : ms until round close (clamped 0 .. 5 min)
function serverComputeBtcOdds(openPrice, livePrice, msLeft, priceToBeat) {
  const FIVE = 5 * 60 * 1000;
  if (!Number.isFinite(openPrice) || !Number.isFinite(livePrice) || openPrice <= 0 || livePrice <= 0) {
    return { yes: 0.5, no: 0.5, deltaPct: 0, delta: 0, scale: 0 };
  }
  const beat = Number.isFinite(priceToBeat) && priceToBeat > 0 ? priceToBeat : openPrice;
  const left = Math.max(0, Math.min(FIVE, Number(msLeft) || 0));
  const elapsedRatio = 1 - (left / FIVE);
  const remainingRatio = left / FIVE;
  const delta = livePrice - beat;
  const deltaPct = (delta / beat) * 100;
  // Reference 5-min realised vol on BTC ~ 0.10% (tightened from 0.22 so the
  // probability actually reacts to small intra-round moves instead of
  // hugging 50/50). Sqrt-time scaling still shrinks the band as the round
  // progresses so late ticks decide harder than early ones.
  const scale = 0.10 * Math.sqrt(Math.max(remainingRatio, 0.04));
  const z = Math.max(-8, Math.min(8, deltaPct / Math.max(scale, 0.001)));
  let yes = 1 / (1 + Math.exp(-z));
  // NO confidence damping. The ramp (0.65 -> 0.97) pulled every quote toward
  // 50/50 — worst at the START of a round — which is why prices read slow and
  // disagreed with the equation. sqrt-time in `scale` already encodes time decay,
  // so the quote is now exactly the model probability. Client (fast-markets,
  // prediction-pro, prediction-modal) uses the identical form, so canonical and
  // client odds agree tick-for-tick.
  yes = Math.max(BTC_PROB_MIN, Math.min(BTC_PROB_MAX, yes));
  return { yes, no: 1 - yes, deltaPct, delta, scale };
}

function btcRoundHasHotLivePrice(round) {
  const live = Number(round?.livePrice);
  if (!Number.isFinite(live) || live <= 1000) return false;
  const source = String(round?.livePriceSource || round?.source || '');
  if (/binance/i.test(source)) return true;
  const ts = Number(round?.livePriceTs || 0);
  if (!ts || Date.now() - ts > 2500) return false;
  const open = Number(round?.priceToBeat || round?.openPrice);
  if (Number.isFinite(open) && open > 1000 && Math.abs(live - open) < 0.000001) return false;
  return true;
}

async function buildCanonicalBtcRound(env, opts) {
  const round = currentRound();
  const wantFresh = opts && opts.refresh !== false;
  // Prefer the isolate-memory tick (free, instant) over a KV read — the price
  // stream never blocks on KV. KV is only consulted when memory is cold.
  let latest = memGet('btc:latest') || await kvGet(env, 'btc:latest', null);
  const latestIsCurrentRound = latest && Number(latest.round) === round.openAt;
  const stale = !latest || !latestIsCurrentRound || (Date.now() - Number(latest.t || 0) > BTC_LIVE_REFRESH_MS);
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
  const roundOpen = await fetchBtcRoundOpenPrice(round);
  if (roundOpen && Number.isFinite(Number(roundOpen.price)) && Number(roundOpen.price) > 0) {
    const storedOpen = Number(stored && stored.openPrice);
    if (!Number.isFinite(storedOpen) || Math.abs(storedOpen - Number(roundOpen.price)) > 0.000001 || stored.openPriceSource !== roundOpen.source) {
      let beat = Number(stored && stored.priceToBeat);
      if (!Number.isFinite(beat) || beat <= 0) {
        const drift = await fetchBtcPrior5mDrift(round);
        beat = projectPriceToBeat(Number(roundOpen.price), drift);
      }
      stored = await storeRoundOpenPrice(env, round, Number(roundOpen.price), roundOpen.source, roundOpen.t, beat) || stored;
    }
  }
  const openPrice = (roundOpen && Number(roundOpen.price)) || Number(stored && stored.openPrice) || (currentLatest && Number(currentLatest.p)) || 0;
  // First call of a fresh round and we just got the live price — that price IS
  // the open price by definition.
  if (currentLatest && openPrice && !stored) {
    stored = await lockRoundOpenPrice(env, round, openPrice, currentLatest.s || '') || stored;
  }
  // Forward-projected price-to-beat (locked at round open). Falls back to
  // openPrice if the prior-kline fetch failed or the round was locked by an
  // older worker version with no projection field.
  const storedBeat = Number(stored && stored.priceToBeat);
  const priceToBeat = Number.isFinite(storedBeat) && storedBeat > 0 ? storedBeat : openPrice;
  const livePrice = (currentLatest && Number(currentLatest.p)) || openPrice;
  const odds = serverComputeBtcOdds(openPrice, livePrice, round.msLeft, priceToBeat);
  const openPriceSource = (roundOpen && roundOpen.source) || stored && stored.openPriceSource || '';
  const openPriceTs = (roundOpen && Number(roundOpen.t)) || stored && stored.openPriceTs || null;
  return {
    id: round.id,
    openAt: round.openAt,
    closeAt: round.closeAt,
    msLeft: round.msLeft,
    openPrice: openPrice || null,
    priceToBeat: priceToBeat || openPrice || null,
    priceToBeatSource: (stored && stored.priceToBeatSource) || (priceToBeat && priceToBeat !== openPrice ? 'projected-5m-drift' : 'open'),
    openPriceSource,
    openPriceTs,
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
  const r = await fetchWithDeadline(url, {
    headers: { accept: 'application/json', 'user-agent': 'OST-API/1.0' },
    cf: { cacheTtl: 5, cacheEverything: true }
  }, 4500);
  return r.ok ? r.json() : null;
}

async function polyClob(env, path, query = '') {
  const url = `${env.CLOB_BASE}${path}${query ? '?' + query : ''}`;
  const r = await fetchWithDeadline(url, {
    headers: { accept: 'application/json', 'user-agent': 'OST-API/1.0' },
    cf: { cacheTtl: 2, cacheEverything: true }
  }, 4000);
  return r.ok ? r.json() : null;
}

async function polyData(env, path, query = '') {
  const url = `${env.DATA_BASE}${path}${query ? '?' + query : ''}`;
  const r = await fetchWithDeadline(url, {
    headers: { accept: 'application/json', 'user-agent': 'OST-API/1.0' },
    cf: { cacheTtl: 30, cacheEverything: true }
  }, 5000);
  return r.ok ? r.json() : null;
}

async function fetchWithDeadline(url, init, timeoutMs = 4500) {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timeoutId = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    return await fetch(url, {
      ...(init || {}),
      signal: controller ? controller.signal : undefined
    });
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
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

// ── Storage with a real backup chain ─────────────────────────────────────────
//
//   memory  ->  Cache API (edge)  ->  KV  ->  D1  ->  R2 (if bound)
//
// WHY NOT "more KV namespaces": Cloudflare KV limits (~1k writes/day free) are
// PER ACCOUNT, not per namespace. A second/third KV would run out at the exact
// same instant as the first, so it is not a backup at all. The tiers below are
// DIFFERENT products, each with its own separate quota — that is what actually
// keeps the app alive when one runs dry.
//
// Reads try each tier in order and BACKFILL the faster tiers on a hit.
// Writes go to every healthy tier, so no single store holds the only copy.
// A circuit breaker trips a tier that is erroring/exhausted so we stop hammering
// it (and stop burning quota on calls that will fail) until it is retried.

const MEM = new Map();                       // isolate-local, fastest, free
const MEM_MAX = 500;
const BREAKER = Object.create(null);          // tier -> retry-after timestamp
const BREAK_MS = 60_000;

function tierDown(tier) { return (BREAKER[tier] || 0) > Date.now(); }
function tripTier(tier) { BREAKER[tier] = Date.now() + BREAK_MS; }
function healTier(tier) { BREAKER[tier] = 0; }

function memGet(key) {
  const e = MEM.get(key);
  if (!e) return undefined;
  if (e.exp && Date.now() > e.exp) { MEM.delete(key); return undefined; }
  return e.v;
}
function memPut(key, value, ttlS) {
  if (MEM.size >= MEM_MAX) MEM.delete(MEM.keys().next().value);   // simple LRU-ish
  MEM.set(key, { v: value, exp: ttlS ? Date.now() + ttlS * 1000 : 0 });
}

const CACHE_ORIGIN = 'https://ost-store.internal/';
function cacheReq(key) { return new Request(CACHE_ORIGIN + encodeURIComponent(key)); }

async function cacheGet(key) {
  if (tierDown('cache')) return undefined;
  try {
    const r = await caches.default.match(cacheReq(key));
    if (!r) return undefined;
    return await r.json();
  } catch (_) { tripTier('cache'); return undefined; }
}
async function cachePut(key, value, ttlS) {
  if (tierDown('cache')) return false;
  try {
    await caches.default.put(cacheReq(key), new Response(JSON.stringify(value), {
      headers: { 'content-type': 'application/json', 'cache-control': 'max-age=' + (ttlS && ttlS > 0 ? ttlS : 300) }
    }));
    return true;
  } catch (_) { tripTier('cache'); return false; }
}

// The D1 backup writes into a `kv` table — but nothing ever created it (no
// migration, no CREATE). So the moment KV hit its daily quota and the store fell
// through to D1, every query threw "no such table: kv", D1 tripped too, and the
// app was left with only ephemeral memory/cache. That is exactly why trades and
// rounds stopped persisting on a heavy day.
//
// Create it lazily and idempotently, once per isolate. This makes D1 a genuine
// backup with NO manual migration step — it self-heals on first use.
let D1_READY = false;
async function d1Ensure(env) {
  if (D1_READY || !env.DB) return D1_READY;
  try {
    await env.DB.prepare(
      'CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL, exp INTEGER, updated_at INTEGER)'
    ).run();
    D1_READY = true;
  } catch (_) { /* leave false; the caller trips the tier and D1/R2 or cache carry on */ }
  return D1_READY;
}

async function d1Get(env, key) {
  if (!env.DB || tierDown('d1')) return undefined;
  try {
    if (!(await d1Ensure(env))) throw new Error('d1 schema unavailable');
    const row = await env.DB.prepare('SELECT v, exp FROM kv WHERE k = ?').bind(key).first();
    if (!row) { healTier('d1'); return undefined; }   // a working empty read still proves D1 is up
    if (row.exp && Date.now() > Number(row.exp)) return undefined;
    healTier('d1');
    return JSON.parse(row.v);
  } catch (_) { tripTier('d1'); return undefined; }
}
async function d1Put(env, key, value, ttlS) {
  if (!env.DB || tierDown('d1')) return false;
  try {
    if (!(await d1Ensure(env))) throw new Error('d1 schema unavailable');
    const exp = ttlS && ttlS > 0 ? Date.now() + ttlS * 1000 : null;
    await env.DB.prepare(
      'INSERT INTO kv (k, v, exp, updated_at) VALUES (?, ?, ?, ?) ' +
      'ON CONFLICT(k) DO UPDATE SET v = excluded.v, exp = excluded.exp, updated_at = excluded.updated_at'
    ).bind(key, JSON.stringify(value), exp, Date.now()).run();
    healTier('d1');
    return true;
  } catch (_) { tripTier('d1'); return false; }
}

async function r2Get(env, key) {
  if (!env.BACKUP_R2 || tierDown('r2')) return undefined;
  try {
    const o = await env.BACKUP_R2.get('kv/' + key);
    if (!o) return undefined;
    healTier('r2');
    return await o.json();
  } catch (_) { tripTier('r2'); return undefined; }
}
async function r2Put(env, key, value) {
  if (!env.BACKUP_R2 || tierDown('r2')) return false;
  try {
    await env.BACKUP_R2.put('kv/' + key, JSON.stringify(value), { httpMetadata: { contentType: 'application/json' } });
    healTier('r2');
    return true;
  } catch (_) { tripTier('r2'); return false; }
}

async function kvNativeGet(env, key) {
  if (!env.OST_KV || tierDown('kv')) return undefined;
  try {
    const v = await env.OST_KV.get(key, { type: 'json' });
    healTier('kv');
    return v ?? undefined;
  } catch (_) { tripTier('kv'); return undefined; }   // quota exhausted / erroring -> stop hammering
}
async function kvNativePut(env, key, value, ttlS) {
  if (!env.OST_KV || tierDown('kv')) return false;
  try {
    const opts = ttlS && ttlS > 0 ? { expirationTtl: ttlS } : undefined;
    await env.OST_KV.put(key, JSON.stringify(value), opts);
    healTier('kv');
    return true;
  } catch (_) { tripTier('kv'); return false; }       // KV is out -> D1/R2 carry the write
}

// Same signatures as before, so every existing call site gets failover for free.
async function kvGet(env, key, fallback = null) {
  const m = memGet(key);
  if (m !== undefined) return m;

  const c = await cacheGet(key);
  if (c !== undefined) { memPut(key, c, 60); return c; }

  const k = await kvNativeGet(env, key);
  if (k !== undefined) { memPut(key, k, 60); await cachePut(key, k, 300); return k; }

  const d = await d1Get(env, key);
  if (d !== undefined) { memPut(key, d, 60); await cachePut(key, d, 300); return d; }

  const r = await r2Get(env, key);
  if (r !== undefined) { memPut(key, r, 60); await cachePut(key, r, 300); return r; }

  return fallback;
}

// Per-key KV-write throttle for HOT, EPHEMERAL keys only. Cloudflare KV free tier
// is ~1,000 writes/DAY, and the live price/tick keys (btc:latest, the per-round
// tick ring, launchpad tick rings, the OST price counters) are rewritten every
// few seconds — they alone burn the whole daily budget. We write those to KV at
// most once per window; D1 still gets EVERY write and memory+cache keep reads
// fresh, so nothing is lost.
//
// Scoped ON PURPOSE to reconstructable price data. Durable/position/round keys
// are NEVER throttled — kvGet reads KV before D1, so throttling a durable key
// could let a stale KV copy shadow a fresh D1 write on a cross-colo read. Live
// prices don't care about 25s of staleness (they recompute); a position does.
const KV_LAST_WRITE = new Map();
const KV_MIN_GAP_MS = 25_000;
const KV_HOT_RE = /^(btc:latest$|btc:ticks:|launchpad:ticks:|ost:counters$|ost:history$)/;
// True when `key` is a hot, reconstructable price key that has ALREADY been
// persisted within the throttle window — in which case we skip the durable
// tiers (memory + cache already hold the fresh value). Non-hot keys are never
// throttled. Live prices don't care about ≤25s of staleness; a position would,
// which is why only price/tick keys match KV_HOT_RE.
function hotThrottled(key) {
  if (!KV_HOT_RE.test(key)) return false;
  const last = KV_LAST_WRITE.get(key) || 0;
  if (Date.now() - last < KV_MIN_GAP_MS) return true;      // within window → skip durable write
  if (KV_LAST_WRITE.size > 2000) KV_LAST_WRITE.delete(KV_LAST_WRITE.keys().next().value);
  KV_LAST_WRITE.set(key, Date.now());
  return false;                                            // persist this one
}

async function kvPut(env, key, value, expirationTtl = null) {
  const ttlS = Number.isFinite(Number(expirationTtl)) && Number(expirationTtl) > 0 ? Number(expirationTtl) : null;
  memPut(key, value, ttlS);
  await cachePut(key, value, ttlS);
  // A hot price key already persisted this window: memory + cache have the fresh
  // value, so skip the durable tiers and protect BOTH the KV and D1 daily quotas.
  // This is the change that keeps the app on its fast path all day instead of
  // burning the whole KV budget on live ticks before noon.
  if (hotThrottled(key)) return true;
  // Otherwise write every healthy durable tier — no single store is the only
  // copy, and if KV is exhausted the data still lands in D1 (and R2 when bound).
  const [kv, d1, r2] = await Promise.all([
    kvNativePut(env, key, value, ttlS),
    d1Put(env, key, value, ttlS),
    r2Put(env, key, value)
  ]);
  return kv || d1 || r2;
}

function storeHealth(env) {
  const now = Date.now();
  const tier = (name, bound) => ({
    bound: !!bound,
    healthy: !!bound && !tierDown(name),
    retryInMs: Math.max(0, (BREAKER[name] || 0) - now)
  });
  return {
    memory: { bound: true, healthy: true, entries: MEM.size },
    cache: tier('cache', true),
    kv: tier('kv', env.OST_KV),
    d1: tier('d1', env.DB),
    r2: tier('r2', env.BACKUP_R2)
  };
}

const ACTIVE_MARKETS_MEMORY = new Map();
const MARKET_DETAIL_MEMORY = new Map();

async function fetchActiveMarkets(env, limit) {
  const cleanLimit = Math.max(1, Math.min(200, Number(limit) || 60));
  const cacheKey = `markets:active:${cleanLimit}`;
  try {
    const raw = await polyGamma(env, '/markets', `limit=${cleanLimit}&closed=false`);
    const rows = Array.isArray(raw) ? raw : raw && raw.markets || [];
    if (Array.isArray(rows) && rows.length) {
      const payload = { raw, ts: Date.now() };
      ACTIVE_MARKETS_MEMORY.set(cacheKey, payload);
      if (ACTIVE_MARKETS_MEMORY.size > 12) {
        const firstKey = ACTIVE_MARKETS_MEMORY.keys().next().value;
        if (firstKey) ACTIVE_MARKETS_MEMORY.delete(firstKey);
      }
      await kvPut(env, cacheKey, payload, 60 * 10);
      return { raw, stale: false, source: 'gamma' };
    }
  } catch (_) {}

  const hot = ACTIVE_MARKETS_MEMORY.get(cacheKey);
  if (hot && hot.raw) return { raw: hot.raw, stale: true, source: 'memory', cachedAt: hot.ts || 0 };

  const cached = await kvGet(env, cacheKey, null);
  if (cached && cached.raw) return { raw: cached.raw, stale: true, source: 'kv', cachedAt: cached.ts || 0 };

  return { raw: null, stale: false, source: 'none' };
}

async function fetchMarketDetail(env, id) {
  const cleanId = cleanText(id, 128);
  if (!cleanId) return { raw: null, stale: false, source: 'none' };
  const cacheKey = `markets:detail:${cleanId}`;
  try {
    const raw = await polyGamma(env, `/markets/${encodeURIComponent(cleanId)}`);
    if (raw && typeof raw === 'object') {
      const payload = { raw, ts: Date.now() };
      MARKET_DETAIL_MEMORY.set(cacheKey, payload);
      if (MARKET_DETAIL_MEMORY.size > 160) {
        const firstKey = MARKET_DETAIL_MEMORY.keys().next().value;
        if (firstKey) MARKET_DETAIL_MEMORY.delete(firstKey);
      }
      await kvPut(env, cacheKey, payload, 60 * 30);
      return { raw, stale: false, source: 'gamma' };
    }
  } catch (_) {}

  const hot = MARKET_DETAIL_MEMORY.get(cacheKey);
  if (hot && hot.raw) return { raw: hot.raw, stale: true, source: 'memory', cachedAt: hot.ts || 0 };

  const cached = await kvGet(env, cacheKey, null);
  if (cached && cached.raw) return { raw: cached.raw, stale: true, source: 'kv', cachedAt: cached.ts || 0 };

  return { raw: null, stale: false, source: 'none' };
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

function walletChannelForRealtime(wallet) {
  const clean = cleanText(wallet || '', 80);
  return clean ? 'wallet:' + clean : '';
}

function channelForRealtime(prefix, value) {
  const clean = cleanText(value || '', 160)
    .toLowerCase()
    .replace(/[^a-z0-9:_./-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return clean ? prefix + ':' + clean : '';
}

function publishPositionRealtime(env, record, marketState, flowRecord) {
  if (!record) return;
  const walletChannel = walletChannelForRealtime(record.wallet);
  const marketChannel = channelForRealtime('market', record.marketId);
  const closed = positionIsClosed(record);
  const amount = closed
    ? cleanNumber(record.cashoutOst != null ? record.cashoutOst : record.sellValue, 0) || 0
    : cleanNumber(record.stake, 0) || 0;
  const channels = ['all', 'prediction', 'orderbook'];
  if (marketChannel) channels.push(marketChannel);
  if (walletChannel) channels.push(walletChannel);
  publishRealtimeEvent(env, {
    type: closed ? 'prediction.cashout' : 'prediction.order',
    public: true,
    channels,
    wallet: record.wallet || '',
    marketId: record.marketId || '',
    amount,
    token: 'OST',
    title: closed ? 'Prediction cash-out' : 'Prediction order live',
    message: closed
      ? 'Prediction cash-out settled for ' + amount + ' OST'
      : String(record.side || 'YES').toUpperCase() + ' order opened for ' + amount + ' OST',
    payload: { record, marketState: marketState || null, flowRecord: flowRecord || null }
  }).catch(() => {});
  if (marketState) {
    publishRealtimeEvent(env, {
      type: 'orderbook.update',
      public: true,
      channels: ['all', 'orderbook', 'prediction', marketChannel].filter(Boolean),
      marketId: record.marketId || '',
      title: 'Market book updated',
      message: record.marketTitle || record.title || record.marketId || 'OST market update',
      silent: true,
      payload: { marketState, record: flowRecord || record }
    }).catch(() => {});
  }
  if (walletChannel) {
    publishRealtimeEvent(env, {
      type: 'transaction.alert',
      private: true,
      channels: [walletChannel],
      wallet: record.wallet || '',
      marketId: record.marketId || '',
      amount,
      token: 'OST',
      title: closed ? 'Cash-out confirmed' : 'Prediction order confirmed',
      message: closed ? '+' + amount + ' OST cash-out' : '-' + amount + ' OST stake locked',
      payload: { record, marketState: marketState || null }
    }).catch(() => {});
  }
}

function publishWalletRealtime(env, record, overrides = {}) {
  if (!record || !record.wallet) return;
  const walletChannel = walletChannelForRealtime(record.wallet);
  if (!walletChannel) return;
  const amount = cleanNumber(record.amount != null ? record.amount : record.ostAmount, 0) || 0;
  publishRealtimeEvent(env, Object.assign({
    type: 'wallet.event',
    private: true,
    channels: [walletChannel],
    wallet: record.wallet,
    marketId: record.marketId || '',
    gameId: record.game || '',
    amount,
    token: record.token || 'OST',
    title: record.label || record.kind || 'Wallet activity',
    message: amount ? String(record.kind || 'Activity') + ' ' + amount + ' ' + (record.token || 'OST') : String(record.kind || 'Wallet activity'),
    payload: { record }
  }, overrides)).catch(() => {});
}

function cleanNumber(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

// ── LAUNCHPAD bonding curve (REAL) ─────────────────────────────────────────
// A linear bonding curve priced in OST, identical math to the client engine
// so server and client agree. price(r) = BASE*(1 + r*STEEP), r = sold/supply.
// Buying integrates the curve (costs more as supply sells); selling refunds
// the same integral. This replaces the old fake `mcap += amt*10` random bump.
const LP_BASE_PRICE = 0.00003;      // OST per token at zero supply
const LP_CURVE_STEEPNESS = 199;     // price multiplier at full supply
const LP_DEFAULT_SUPPLY = 1_000_000_000;
const LP_GRADUATION_MCAP = 69000;   // OST mcap that locks the curve (DEX migration)

function lpPriceAt(soldRatio) {
  const r = Math.max(0, Math.min(1, soldRatio));
  return LP_BASE_PRICE * (1 + r * LP_CURVE_STEEPNESS);
}
// Integral of price from s0..s1 tokens sold = OST cost to move the curve.
function lpCurveCost(s0, s1, supply) {
  const ds = s1 - s0;
  const ds2 = s1 * s1 - s0 * s0;
  return LP_BASE_PRICE * ds + (LP_BASE_PRICE * LP_CURVE_STEEPNESS / (2 * supply)) * ds2;
}
// Inverse: tokens minted for a given OST input, starting at sold s0.
function lpTokensForOst(ostIn, s0, supply) {
  const A = LP_BASE_PRICE * LP_CURVE_STEEPNESS / (2 * supply);
  const B = LP_BASE_PRICE * (1 + LP_CURVE_STEEPNESS * s0 / supply);
  if (A <= 0) return ostIn / Math.max(1e-12, B);
  const disc = B * B + 4 * A * ostIn;
  return (-B + Math.sqrt(disc)) / (2 * A);
}
// Recompute a coin's public fields from its authoritative tokensSold.
function lpRecompute(coin) {
  const supply = Number(coin.supply) || LP_DEFAULT_SUPPLY;
  let sold = Number(coin.tokensSold);
  if (!Number.isFinite(sold) || sold < 0) sold = 0;
  sold = Math.min(sold, supply);
  const price = lpPriceAt(sold / supply);
  const mcap = sold * price;
  coin.supply = supply;
  coin.tokensSold = sold;
  coin.price = price;
  coin.mcap = Math.round(mcap);
  coin.curve = Math.max(0, Math.min(100, Math.floor((mcap / LP_GRADUATION_MCAP) * 100)));
  return coin;
}
// Honest starter coins seeded with ZERO trades — their mcap grows only from
// real trades, never invented. Gives the launchpad life without fake numbers.
function lpStarterCoins() {
  const now = Date.now();
  const mk = (name, symbol, desc) => lpRecompute({
    id: 'seed-' + symbol.toLowerCase(),
    mint: 'ost' + symbol.toLowerCase() + 'seed0000000000000000000000000000',
    name, symbol, desc,
    image: null, twitter: null, telegram: null, website: null,
    creator: 'ost-genesis', createdAt: now, trades: 0,
    supply: LP_DEFAULT_SUPPLY, tokensSold: 0, holders: {}
  });
  return [
    mk('Ancients', 'ANKH', 'Genesis meme of the OST realm. Zero trades — the curve starts here.'),
    mk('Scarab', 'SCRB', 'The lucky beetle. Real bonding curve, priced in OST.'),
    mk('Pyramid', 'PYRA', 'Build it block by block. Every buy moves the curve for real.'),
    mk('Nile', 'NILE', 'Liquidity flows downstream. Fair launch, no presale.')
  ];
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
const NATIVE_MARKET_BASE_SPREAD = 0.06;
const NATIVE_MARKET_MAX_SPREAD = 0.16;
const NATIVE_MARKET_IMBALANCE_SPREAD = 0.07;
const NATIVE_MARKET_ACTIVITY_SPREAD = 0.03;
const NATIVE_MARKET_CROWDED_SIDE_PENALTY = 0.05;
const NATIVE_MARKET_SELL_HAIRCUT = 0.015;
const NATIVE_MARKET_STATE_MEMORY = new Map();
const POSITION_RECENT_MEMORY = [];
const POSITION_RECENT_MEMORY_LIMIT = 300;

function clampNativeProbability(value) {
  const probability = cleanProbability(value);
  return probability == null ? null : Math.max(BTC_PROB_MIN, Math.min(BTC_PROB_MAX, probability));
}

function clampNativeTradeProbability(value) {
  const probability = cleanProbability(value);
  return probability == null ? null : Math.max(BTC_PROB_MIN, Math.min(BTC_PROB_MAX, probability));
}

function clampNativeSpread(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return NATIVE_MARKET_BASE_SPREAD;
  return Math.max(NATIVE_MARKET_BASE_SPREAD, Math.min(NATIVE_MARKET_MAX_SPREAD, number));
}

function isOstNativeMarketId(marketId, source) {
  const marketText = String(marketId == null ? '' : marketId);
  const sourceText = String(source == null ? '' : source).toLowerCase();
  if (marketText.indexOf('ost-btc5m-') === 0) return true;
  if (marketText.indexOf('native-') === 0) return true;
  if (sourceText === 'ost') return true;
  return sourceText === 'ost-native';
}

function nativeMarketStateKey(marketId) {
  return 'market:state:' + cleanText(marketId, 128);
}

function clonePlain(value) {
  if (!value || typeof value !== 'object') return value;
  try { return JSON.parse(JSON.stringify(value)); } catch (_) { return Object.assign({}, value); }
}

function rememberNativeMarketStateHot(state) {
  if (!state || !state.marketId) return null;
  const marketId = cleanText(state.marketId, 128);
  const copy = clonePlain(Object.assign({}, state, { marketId, hotAt: Date.now() }));
  NATIVE_MARKET_STATE_MEMORY.set(marketId, copy);
  if (NATIVE_MARKET_STATE_MEMORY.size > 250) {
    const firstKey = NATIVE_MARKET_STATE_MEMORY.keys().next().value;
    if (firstKey) NATIVE_MARKET_STATE_MEMORY.delete(firstKey);
  }
  return clonePlain(copy);
}

function readNativeMarketStateHot(marketId) {
  const cleanMarketId = cleanText(marketId, 128);
  const state = NATIVE_MARKET_STATE_MEMORY.get(cleanMarketId);
  if (!state) return null;
  const hotAt = cleanNumber(state.hotAt, state.updatedAt || 0) || 0;
  if (hotAt && Date.now() - hotAt > NATIVE_MARKET_STATE_TTL_S * 1000) {
    NATIVE_MARKET_STATE_MEMORY.delete(cleanMarketId);
    return null;
  }
  return clonePlain(state);
}

function recentPositionKey(record) {
  return cleanText(record && (record.signature || record.sig || record.id || [record.wallet, record.marketId, record.side, record.createdAt, record.ts].join(':')), 180);
}

function rememberRecentPositionHot(record) {
  if (!record) return;
  const key = recentPositionKey(record);
  for (let i = POSITION_RECENT_MEMORY.length - 1; i >= 0; i--) {
    if (recentPositionKey(POSITION_RECENT_MEMORY[i]) === key) POSITION_RECENT_MEMORY.splice(i, 1);
  }
  POSITION_RECENT_MEMORY.unshift(clonePlain(Object.assign({}, record, { hotAt: Date.now() })));
  if (POSITION_RECENT_MEMORY.length > POSITION_RECENT_MEMORY_LIMIT) POSITION_RECENT_MEMORY.length = POSITION_RECENT_MEMORY_LIMIT;
}

function publicRecentPositionRecord(record) {
  if (!record) return record;
  const copy = clonePlain(record);
  const cashoutSig = cleanText(copy.cashoutSig || '', 128);
  const fallbackSignature = cashoutSig || cleanText(copy.relatedPositionId || copy.id || copy.signature || copy.sig || copy.txid || copy.txHash || [copy.wallet, copy.marketId, copy.side, copy.createdAt, copy.ts].join(':'), 128);
  if (!copy.signature && fallbackSignature) copy.signature = fallbackSignature;
  if (!copy.sig && fallbackSignature) copy.sig = fallbackSignature;
  if (positionIsSellCashout(copy)) {
    const cashoutPending = !cashoutSig && (copy.cashoutPending === true || cleanNumber(copy.cashoutOst, 0) > 0 || cleanNumber(copy.sellValue, 0) > 0);
    copy.cashoutSig = cashoutSig;
    copy.cashoutPending = cashoutPending;
    copy.cashoutVerified = copy.cashoutVerified === true;
    copy.verificationState = copy.cashoutVerified ? 'verified' : cashoutSig ? 'submitted' : cashoutPending ? 'pending' : (copy.verificationState || 'closed');
  }
  return copy;
}

function recentPositionMatchesMarket(record, marketIdFilter) {
  const filter = cleanText(marketIdFilter || '', 128);
  if (!filter) return true;
  const recordMarketId = cleanText(record && record.marketId || '', 128);
  if (recordMarketId === filter) return true;
  if (filter === 'ost-btc5m' && recordMarketId.indexOf('ost-btc5m-') === 0) return true;
  if (recordMarketId === 'ost-btc5m' && filter.indexOf('ost-btc5m-') === 0) return true;
  return false;
}

function mergeRecentPositionRows(kvRows) {
  const seen = new Set();
  const rows = [];
  POSITION_RECENT_MEMORY.concat(Array.isArray(kvRows) ? kvRows : []).forEach(record => {
    const normalized = publicRecentPositionRecord(record);
    if (!normalized) return;
    const key = recentPositionKey(normalized);
    if (key && seen.has(key)) return;
    if (key) seen.add(key);
    rows.push(normalized);
  });
  rows.sort((left, right) => (cleanNumber(right?.createdAt, 0) || toMs(right?.ts) || cleanNumber(right?.hotAt, 0) || 0) - (cleanNumber(left?.createdAt, 0) || toMs(left?.ts) || cleanNumber(left?.hotAt, 0) || 0));
  return rows;
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
  const midYesPriceNumber = clampedYes == null ? 0.5 : clampedYes;
  const midNoPriceNumber = 1 - midYesPriceNumber;
  const shareImbalance = liquidityShares > 0 ? netShares / liquidityShares : 0;
  const stakeImbalance = liquidityOst > 0 ? netStake / liquidityOst : 0;
  const imbalanceSignal = Math.tanh((shareImbalance + stakeImbalance) / 2);
  const imbalancePressure = Math.tanh(Math.max(Math.abs(shareImbalance), Math.abs(stakeImbalance)));
  const activityPressure = Math.tanh((openYesStake + openNoStake) / Math.max(1, liquidityOst * 2));
  const vaultSpread = clampNativeSpread(
    NATIVE_MARKET_BASE_SPREAD +
    imbalancePressure * NATIVE_MARKET_IMBALANCE_SPREAD +
    activityPressure * NATIVE_MARKET_ACTIVITY_SPREAD
  );
  const halfSpread = vaultSpread / 2;
  const yesCrowdPenalty = Math.max(0, imbalanceSignal) * NATIVE_MARKET_CROWDED_SIDE_PENALTY;
  const noCrowdPenalty = Math.max(0, -imbalanceSignal) * NATIVE_MARKET_CROWDED_SIDE_PENALTY;
  const sellHaircut = NATIVE_MARKET_SELL_HAIRCUT + vaultSpread * 0.25;
  const yesAskPriceNumber = clampNativeTradeProbability(midYesPriceNumber + halfSpread + yesCrowdPenalty) ?? 0.5;
  const noAskPriceNumber = clampNativeTradeProbability(midNoPriceNumber + halfSpread + noCrowdPenalty) ?? 0.5;
  const rawYesBid = clampNativeTradeProbability(midYesPriceNumber - halfSpread - sellHaircut - yesCrowdPenalty) ?? 0.01;
  const rawNoBid = clampNativeTradeProbability(midNoPriceNumber - halfSpread - sellHaircut - noCrowdPenalty) ?? 0.01;
  const yesBidPriceNumber = Math.max(0.01, Math.min(rawYesBid, yesAskPriceNumber - 0.01));
  const noBidPriceNumber = Math.max(0.01, Math.min(rawNoBid, noAskPriceNumber - 0.01));
  const orderSource = state.orders ? state.orders : {};
  return {
    baseYesPrice: baseYes,
    baseNoPrice: 1 - baseYes,
    fairYesPriceNumber: midYesPriceNumber,
    fairNoPriceNumber: midNoPriceNumber,
    yesPriceNumber: yesAskPriceNumber,
    noPriceNumber: noAskPriceNumber,
    yesAskPriceNumber,
    noAskPriceNumber,
    yesBidPriceNumber,
    noBidPriceNumber,
    yesMidPriceNumber: midYesPriceNumber,
    noMidPriceNumber: midNoPriceNumber,
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
    totalImpact: midYesPriceNumber - baseYes,
    quoteImpact: yesAskPriceNumber - baseYes,
    vaultSpread,
    vaultEdge: vaultSpread,
    sellHaircut,
    imbalanceSignal,
    imbalancePressure,
    activityPressure,
    yesCrowdPenalty,
    noCrowdPenalty,
    orderCount: Object.keys(orderSource).length,
    updatedAt: state.updatedAt ? state.updatedAt : Date.now()
  };
}

function nativeTradePriceFromState(state, side, action) {
  if (!state) return null;
  const sideKey = String(side || '').toUpperCase() === 'NO' ? 'NO' : 'YES';
  const actionKey = String(action || 'buy').toLowerCase();
  let value = null;
  if (actionKey === 'sell' || actionKey === 'cashout') {
    value = sideKey === 'NO' ? state.noBidPriceNumber : state.yesBidPriceNumber;
  } else if (actionKey === 'mid' || actionKey === 'fair') {
    value = sideKey === 'NO' ? state.noMidPriceNumber : state.yesMidPriceNumber;
  } else {
    value = sideKey === 'NO'
      ? (state.noAskPriceNumber != null ? state.noAskPriceNumber : state.noPriceNumber)
      : (state.yesAskPriceNumber != null ? state.yesAskPriceNumber : state.yesPriceNumber);
  }
  const price = cleanProbability(value);
  return price == null ? null : Math.max(0.01, Math.min(0.99, price));
}

function positionIsSellCashout(positionRecord) {
  if (!positionRecord || !positionIsClosed(positionRecord)) return false;
  const status = String(positionRecord.status || positionRecord.outcome || '').toLowerCase();
  const kind = String(positionRecord.cashoutKind || positionRecord.flowAction || positionRecord.tradeAction || positionRecord.action || '').toLowerCase();
  if (status === 'won' || status === 'lost' || status === 'settled' || status === 'resolved') return false;
  return status === 'sold' || status === 'cashed-out' || kind.indexOf('sell') >= 0 || kind.indexOf('cashout') >= 0;
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
        const round = await getCanonicalBtcRound(env, { refresh: true });
        const roundYes = clampNativeProbability(round ? round.yesPriceNumber : null);
        if (roundYes != null && btcRoundHasHotLivePrice(round)) baseYes = roundYes;
      }
    }
  }
  return baseYes == null ? 0.5 : baseYes;
}

async function loadNativeMarketState(env, marketId) {
  const cleanMarketId = cleanText(marketId, 128);
  const hot = readNativeMarketStateHot(cleanMarketId);
  if (hot) return normalizeNativeMarketState(hot, cleanMarketId);
  if (!env.OST_KV) return defaultNativeMarketState(cleanMarketId);
  return normalizeNativeMarketState(await kvGet(env, nativeMarketStateKey(cleanMarketId), null), cleanMarketId);
}

function publicNativeMarketState(state) {
  const quoted = quoteNativeMarketState(state, state.baseYesPrice);
  return Object.assign({ marketId: state.marketId }, quoted);
}

async function getNativeMarketState(env, marketId, fallbackBaseYes) {
  const hubState = await getNativeMarketStateFromHub(env, marketId, fallbackBaseYes);
  // The hub (a Durable Object) is a SINGLE global instance, which is precisely
  // what makes it the authority: every reader on Earth sees the same numbers.
  if (hubState) return Object.assign({}, hubState, { authoritative: true, degraded: false });

  // ── DEGRADED PATH — READ THIS BEFORE CHANGING IT ─────────────────────────
  // We are here because the hub failed. What follows is per-colo cached state:
  // `caches.default` is scoped to ONE data centre and pinned for 300s, over KV
  // that takes ~60s to propagate. So this value is whatever this colo happened to
  // see last — a tester in Mexico and one in China get different numbers for the
  // same market, which is exactly the "no correlation between same markets"
  // report, and it has been happening since day one of prediction markets.
  //
  // Previously this was returned bare, indistinguishable from hub state. That
  // silence is the entire bug: the Durable Object was added to fix the desync and
  // then quietly bypassed on every hiccup, so it looked like the DO "didn't work".
  //
  // It is still better to answer with a stale price than to fail the request —
  // but it must never again PRETEND to be authoritative. Flag it, and let the UI
  // say "reconnecting" instead of showing a confidently wrong number.
  const state = await loadNativeMarketState(env, marketId);
  state.baseYesPrice = await nativeBaseYesForMarket(env, state.marketId, fallbackBaseYes != null ? fallbackBaseYes : state.baseYesPrice);
  state.updatedAt = state.updatedAt ? state.updatedAt : Date.now();
  const quoted = quoteNativeMarketState(state, state.baseYesPrice);
  Object.assign(state, quoted);
  rememberNativeMarketStateHot(state);
  // DO NOT write KV here — this is the DEGRADED READ path (hub unreachable). It
  // runs on every poll while degraded; writing KV on a read wastes the quota and
  // accelerates exhaustion. The in-memory hot cache above already serves it.
  return Object.assign({}, publicNativeMarketState(state), {
    authoritative: false,
    degraded: true,
    degradedReason: HUB_HEALTH.lastError || 'market hub unreachable',
    staleAsOf: state.updatedAt || null
  });
}

async function applyNativePositionToMarketState(env, positionRecord, fallbackBaseYes) {
  if (!positionRecord) return null;
  if (!isOstNativeMarketId(positionRecord.marketId, positionRecord.source)) return null;
  const hubState = await applyNativePositionToMarketStateHub(env, positionRecord, fallbackBaseYes);
  if (hubState) return hubState;
  if (!env.OST_KV) return null;
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
  rememberNativeMarketStateHot(state);
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

function nativeMarketHubStub(env) {
  if (!env || !env.NATIVE_MARKET_HUB) return null;
  try {
    const id = env.NATIVE_MARKET_HUB.idFromName('ost-native-market-hub-v1');
    return env.NATIVE_MARKET_HUB.get(id);
  } catch (_) {
    return null;
  }
}

// Why the hub last failed, and how often. This exists because the silent `null`
// below hid a year-long bug: the Durable Object IS the authority for market
// state, but every failure mode returned a bare null, and the caller read null as
// "quietly serve the per-colo cache instead". Testers in different regions were
// therefore served different prices for the same market, and NOTHING anywhere
// said the authority had been bypassed. A fallback you cannot see is a fallback
// you cannot fix.
const HUB_HEALTH = { fails: 0, lastError: '', lastFailAt: 0, lastOkAt: 0 };

function hubFailed(reason) {
  HUB_HEALTH.fails++;
  HUB_HEALTH.lastError = String(reason || 'unknown').slice(0, 160);
  HUB_HEALTH.lastFailAt = Date.now();
  // Loud on purpose. This is the line that would have caught the desync.
  console.error('[NativeMarketHub] UNREACHABLE — falling back to per-colo cache, prices may diverge:', HUB_HEALTH.lastError);
  return null;
}

async function nativeMarketHubJson(env, path, init) {
  const stub = nativeMarketHubStub(env);
  if (!stub) return hubFailed('no DO binding (NATIVE_MARKET_HUB missing from wrangler.toml)');
  try {
    const response = await stub.fetch('https://ost-native-market-hub.local' + path, init || {});
    if (!response) return hubFailed('empty response');
    if (!response.ok) return hubFailed('HTTP ' + response.status + ' from hub' + path);
    const body = await response.json();
    HUB_HEALTH.lastOkAt = Date.now();
    return body;
  } catch (e) {
    return hubFailed((e && e.message) || 'threw');
  }
}

function normalizeHubBtcRound(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const source = payload.round && Number.isFinite(Number(payload.round.openAt))
    ? Object.assign({}, payload, payload.round)
    : payload;
  if (!Number.isFinite(Number(source.openAt))) return null;
  const openAt = Number(source.openAt);
  const closeAt = Number(source.closeAt) || openAt + FIVE_MIN_MS;
  const openPrice = cleanNumber(source.openPrice, null);
  const priceToBeat = cleanNumber(source.priceToBeat, openPrice);
  const livePrice = cleanNumber(source.livePrice, openPrice);
  return Object.assign({}, source, {
    id: cleanText(source.id || source.marketId || `ost-btc5m-${openAt}`, 128),
    marketId: cleanText(source.marketId || source.id || `ost-btc5m-${openAt}`, 128),
    openAt,
    closeAt,
    msLeft: Math.max(0, closeAt - Date.now()),
    openPrice,
    priceToBeat,
    openPriceSource: cleanText(source.openPriceSource || source.openSource || '', 64),
    openPriceTs: cleanNumber(source.openPriceTs, null),
    livePrice,
    livePriceSource: cleanText(source.livePriceSource || source.liveSource || source.source || '', 64),
    livePriceTs: cleanNumber(source.livePriceTs || source.liveTs, null),
    source: cleanText(source.source || source.livePriceSource || source.liveSource || source.openPriceSource || source.openSource || '', 64),
    yesPriceNumber: clampNativeProbability(source.yesPriceNumber) ?? 0.5,
    noPriceNumber: clampNativeProbability(source.noPriceNumber) ?? 0.5,
    canonical: true
  });
}

async function getCanonicalBtcRound(env, opts = {}) {
  const refresh = opts.refresh !== false;
  const hubPath = '/btc/round' + (refresh ? '' : '?refresh=0');
  const hubRound = normalizeHubBtcRound(await nativeMarketHubJson(env, hubPath));
  if (hubRound) return hubRound;
  return buildCanonicalBtcRound(env, opts);
}

async function getCanonicalBtcTicks(env, openAt, since, opts = {}) {
  const params = new URLSearchParams();
  if (Number.isFinite(Number(openAt)) && Number(openAt) > 0) params.set('openAt', String(Math.floor(Number(openAt) / FIVE_MIN_MS) * FIVE_MIN_MS));
  if (Number.isFinite(Number(since)) && Number(since) > 0) params.set('since', String(Number(since)));
  if (opts.refresh === false) params.set('refresh', '0');
  const payload = await nativeMarketHubJson(env, '/btc/ticks' + (params.toString() ? '?' + params.toString() : ''));
  if (!payload || !Array.isArray(payload.ticks)) return null;
  return payload;
}

// The authoritative close snapshot for a settled round, from the DO. Returns
// null unless the round has actually rolled over (i.e. a real close price
// exists). Callers must treat null as "not settled yet", never guess.
async function getBtcRoundResult(env, openAt) {
  const norm = Math.floor(Number(openAt) / FIVE_MIN_MS) * FIVE_MIN_MS;
  if (!(norm > 0)) return null;
  const payload = await nativeMarketHubJson(env, '/btc/round-result?openAt=' + norm);
  return (payload && payload.found === true) ? payload : null;
}

async function getNativeMarketStateFromHub(env, marketId, fallbackBaseYes) {
  const cleanMarketId = cleanText(marketId, 128);
  if (!cleanMarketId) return null;
  const params = new URLSearchParams();
  if (fallbackBaseYes != null) params.set('baseYes', String(fallbackBaseYes));
  const payload = await nativeMarketHubJson(env, '/state/' + encodeURIComponent(cleanMarketId) + (params.toString() ? '?' + params.toString() : ''));
  const state = payload && payload.state;
  if (!state) return null;
  rememberNativeMarketStateHot(state);
  return state;
}

async function applyNativePositionToMarketStateHub(env, positionRecord, fallbackBaseYes) {
  if (!positionRecord || !isOstNativeMarketId(positionRecord.marketId, positionRecord.source)) return null;
  const payload = await nativeMarketHubJson(env, '/position', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ record: positionRecord, fallbackBaseYes })
  });
  const state = payload && payload.marketState;
  if (!state) return null;
  rememberNativeMarketStateHot(state);
  if (payload.flowRecord) rememberRecentPositionHot(payload.flowRecord);
  return state;
}

async function getNativeRecentPositionsFromHub(env, marketId, limit) {
  const params = new URLSearchParams();
  if (marketId) params.set('marketId', marketId);
  if (limit) params.set('limit', String(limit));
  const payload = await nativeMarketHubJson(env, '/recent' + (params.toString() ? '?' + params.toString() : ''));
  return payload && Array.isArray(payload.recent) ? payload.recent : null;
}

export class NativeMarketHub {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.btcSnapshotCache = null;
    this.btcSnapshotCacheAt = 0;
  }

  async fetch(request) {
    return this.state.blockConcurrencyWhile(() => this.handle(request));
  }

  async readMarket(marketId) {
    const cleanMarketId = cleanText(marketId, 128);
    const raw = await this.state.storage.get(nativeMarketStateKey(cleanMarketId));
    return normalizeNativeMarketState(raw, cleanMarketId);
  }

  async writeMarket(state) {
    const cleanMarketId = cleanText(state && state.marketId, 128);
    if (!cleanMarketId) return;
    await this.state.storage.put(nativeMarketStateKey(cleanMarketId), state);
  }

  emptyBtcState(round) {
    return {
      roundOpenAt: round.openAt,
      roundCloseAt: round.closeAt,
      openPrice: 0,
      priceToBeat: 0,
      priceToBeatSource: '',
      openPriceSource: '',
      openPriceTs: 0,
      livePrice: 0,
      livePriceSource: '',
      livePriceTs: 0,
      ticks: []
    };
  }

  async readBtcState(round) {
    const stored = await this.state.storage.get('btc:state');
    const base = this.emptyBtcState(round);
    return Object.assign(base, stored || {}, {
      roundOpenAt: cleanNumber(stored && stored.roundOpenAt, base.roundOpenAt) || base.roundOpenAt,
      roundCloseAt: cleanNumber(stored && stored.roundCloseAt, base.roundCloseAt) || base.roundCloseAt,
      ticks: Array.isArray(stored && stored.ticks) ? stored.ticks : []
    });
  }

  async writeBtcState(state) {
    await this.state.storage.put('btc:state', state);
  }

  appendBtcStateTick(state, price, source, ts) {
    const p = Number(price);
    if (!Number.isFinite(p) || p <= 1000) return;
    const tickTs = Number(ts) || Date.now();
    const ticks = Array.isArray(state.ticks) ? state.ticks : [];
    const last = ticks.length ? ticks[ticks.length - 1] : null;
    if (last && Number(last.p) === p && tickTs - Number(last.t || 0) < BTC_DO_TICK_MIN_GAP_MS) return;
    ticks.push({ t: tickTs, p, s: source || '' });
    if (ticks.length > BTC_TICK_RING_MAX) ticks.splice(0, ticks.length - BTC_TICK_RING_MAX);
    state.ticks = ticks;
  }

  async rolloverBtcStateIfNeeded(state, round) {
    if (state.roundOpenAt === round.openAt) return state;
    if (state.roundOpenAt && Number(state.openPrice) > 1000) {
      const beat = Number(state.priceToBeat) > 1000 ? Number(state.priceToBeat) : Number(state.openPrice);
      const closePrice = Number(state.livePrice) > 1000 ? Number(state.livePrice) : 0;
      await this.state.storage.put(`btc:round:${state.roundOpenAt}`, {
        openAt: state.roundOpenAt,
        closeAt: state.roundCloseAt,
        openPrice: state.openPrice,
        priceToBeat: beat,
        openPriceSource: state.openPriceSource || '',
        openPriceTs: state.openPriceTs || 0,
        closePrice: closePrice || null,
        closeSource: state.livePriceSource || '',
        settledAt: Date.now(),
        yesWon: closePrice ? closePrice > beat : null,
        tied: closePrice ? closePrice === beat : null
      });
      await this.state.storage.put(`btc:ticks:${state.roundOpenAt}`, Array.isArray(state.ticks) ? state.ticks.slice(-BTC_TICK_RING_MAX) : []);
    }
    return this.emptyBtcState(round);
  }

  async refreshBtcState(force) {
    const round = currentRound();
    let state = await this.readBtcState(round);
    state = await this.rolloverBtcStateIfNeeded(state, round);
    const now = Date.now();

    const hasKlineOpen = /kline/i.test(String(state.openPriceSource || ''));
    const liveStale = !Number(state.livePrice) || Number(state.livePrice) <= 1000 || now - Number(state.livePriceTs || 0) > BTC_LIVE_REFRESH_MS;
    const needsOpen = !Number(state.openPrice) || Number(state.openPrice) <= 1000 || !hasKlineOpen;
    const [roundOpen, live] = await Promise.all([
      needsOpen ? fetchBtcRoundOpenPriceFast(round) : Promise.resolve(null),
      (force || liveStale) ? fetchBtcPriceFast() : Promise.resolve(null)
    ]);
    if (roundOpen && Number(roundOpen.price) > 1000) {
      const drift = await fetchBtcPrior5mDriftFast(round);
      state.openPrice = Number(roundOpen.price);
      state.openPriceSource = roundOpen.source || 'binance-kline';
      state.openPriceTs = Number(roundOpen.t) || round.openAt;
      state.priceToBeat = projectPriceToBeat(state.openPrice, drift);
      state.priceToBeatSource = state.priceToBeat === state.openPrice ? 'open' : 'projected-5m-drift';
    }
    if (live && Number(live.price) > 1000) {
      state.livePrice = Number(live.price);
      state.livePriceSource = live.source || 'binance';
      state.livePriceTs = now;
      this.appendBtcStateTick(state, state.livePrice, state.livePriceSource, state.livePriceTs);
    }

    if ((!Number(state.openPrice) || Number(state.openPrice) <= 1000) && Number(state.livePrice) > 1000) {
      const drift = await fetchBtcPrior5mDriftFast(round);
      state.openPrice = Number(state.livePrice);
      state.openPriceSource = `${state.livePriceSource || 'live'}-provisional-open`;
      state.openPriceTs = state.livePriceTs || now;
      state.priceToBeat = projectPriceToBeat(state.openPrice, drift);
      state.priceToBeatSource = state.priceToBeat === state.openPrice ? 'open-provisional' : 'projected-5m-drift-provisional';
    }

    if (Number(state.openPrice) > 1000 && (!Number(state.priceToBeat) || Number(state.priceToBeat) <= 1000)) {
      const drift = await fetchBtcPrior5mDriftFast(round);
      state.priceToBeat = projectPriceToBeat(Number(state.openPrice), drift);
      state.priceToBeatSource = state.priceToBeat === Number(state.openPrice) ? 'open' : 'projected-5m-drift';
    }
    if ((!Number(state.livePrice) || Number(state.livePrice) <= 1000) && Number(state.openPrice) > 1000) {
      state.livePrice = Number(state.openPrice);
      state.livePriceSource = state.openPriceSource || 'open-price';
      state.livePriceTs = state.openPriceTs || now;
      this.appendBtcStateTick(state, state.livePrice, state.livePriceSource, state.livePriceTs);
    }

    state.roundOpenAt = round.openAt;
    state.roundCloseAt = round.closeAt;
    await this.writeBtcState(state);
    return state;
  }

  async btcSnapshot(opts = {}) {
    const refresh = opts.refresh !== false;
    const now = Date.now();
    if (!opts.force && this.btcSnapshotCache && now - this.btcSnapshotCacheAt < BTC_DO_SNAPSHOT_CACHE_MS) {
      return this.btcSnapshotCache;
    }
    const state = await this.refreshBtcState(!!opts.force || refresh);
    const round = currentRound();
    const openPrice = Number(state.openPrice) > 1000 ? Number(state.openPrice) : null;
    const priceToBeat = Number(state.priceToBeat) > 1000 ? Number(state.priceToBeat) : openPrice;
    const livePrice = Number(state.livePrice) > 1000 ? Number(state.livePrice) : openPrice;
    const odds = serverComputeBtcOdds(openPrice || 0, livePrice || 0, round.msLeft, priceToBeat || openPrice || 0);
    const payload = {
      ok: true,
      id: round.id,
      marketId: round.id,
      openAt: round.openAt,
      closeAt: round.closeAt,
      msLeft: round.msLeft,
      openPrice,
      priceToBeat,
      priceToBeatSource: state.priceToBeatSource || (priceToBeat && priceToBeat !== openPrice ? 'projected-5m-drift' : 'open'),
      openPriceSource: state.openPriceSource || '',
      openPriceTs: state.openPriceTs || null,
      livePrice,
      livePriceSource: state.livePriceSource || '',
      livePriceTs: state.livePriceTs || null,
      source: state.livePriceSource || state.openPriceSource || '',
      yesPriceNumber: odds.yes,
      noPriceNumber: odds.no,
      deltaPct: odds.deltaPct,
      delta: odds.delta,
      scale: odds.scale,
      ticks: Array.isArray(state.ticks) ? state.ticks.slice(-120) : [],
      canonical: true,
      hub: 'native-market-hub'
    };
    if (Number(payload.livePrice) > 1000) {
      const shouldPublish = !this.lastRealtimeBtcAt
        || now - this.lastRealtimeBtcAt > 1200
        || Math.abs(Number(payload.livePrice) - Number(this.lastRealtimeBtcPrice || 0)) >= 0.5;
      if (shouldPublish) {
        this.lastRealtimeBtcAt = now;
        this.lastRealtimeBtcPrice = Number(payload.livePrice);
        publishRealtimeEvent(this.env, {
          type: 'price.tick',
          public: true,
          channels: ['all', 'price', 'price:btc', 'prediction', 'market:' + payload.marketId],
          marketId: payload.marketId,
          amount: payload.livePrice,
          token: 'BTC',
          title: 'BTC price update',
          message: 'BTC ' + Number(payload.livePrice).toFixed(2) + ' USD',
          silent: true,
          payload
        }).catch(() => {});
      }
    }
    this.btcSnapshotCache = payload;
    this.btcSnapshotCacheAt = Date.now();
    return payload;
  }

  async btcTicks(openAt, since, refresh) {
    const current = currentRound();
    const cleanOpenAt = Number.isFinite(Number(openAt)) && Number(openAt) > 0
      ? Math.floor(Number(openAt) / FIVE_MIN_MS) * FIVE_MIN_MS
      : current.openAt;
    let ticks = [];
    if (cleanOpenAt === current.openAt) {
      const snap = await this.btcSnapshot({ refresh: refresh !== false });
      ticks = Array.isArray(snap.ticks) ? snap.ticks.slice() : [];
    } else {
      ticks = await this.state.storage.get(`btc:ticks:${cleanOpenAt}`) || [];
    }
    const filtered = Number(since) > 0 ? ticks.filter(t => Number(t && t.t) > Number(since)) : ticks;
    return {
      ok: true,
      openAt: cleanOpenAt,
      closeAt: cleanOpenAt + FIVE_MIN_MS,
      ticks: filtered,
      count: filtered.length,
      ts: new Date().toISOString(),
      hub: 'native-market-hub'
    };
  }

  async nativeBaseYesForMarket(marketId, fallbackBaseYes) {
    let baseYes = clampNativeProbability(fallbackBaseYes);
    const marketText = String(marketId == null ? '' : marketId);
    if (marketText.indexOf('ost-btc5m-') === 0) {
      const openAt = Number(marketText.replace('ost-btc5m-', ''));
      const current = currentRound();
      if (Number.isFinite(openAt) && openAt === current.openAt) {
        const round = await this.btcSnapshot({ refresh: true });
        const roundYes = clampNativeProbability(round && round.yesPriceNumber);
        if (roundYes != null && btcRoundHasHotLivePrice(round)) baseYes = roundYes;
      }
    }
    return baseYes == null ? 0.5 : baseYes;
  }

  async quoteMarket(marketId, fallbackBaseYes) {
    const state = await this.readMarket(marketId);
    state.baseYesPrice = await this.nativeBaseYesForMarket(state.marketId, fallbackBaseYes != null ? fallbackBaseYes : state.baseYesPrice);
    state.updatedAt = state.updatedAt ? state.updatedAt : Date.now();
    const quoted = quoteNativeMarketState(state, state.baseYesPrice);
    Object.assign(state, quoted);
    await this.writeMarket(state);
    return publicNativeMarketState(state);
  }

  async recordRecent(record) {
    if (!record) return;
    const bucket = await this.state.storage.get('positions:recent') || [];
    await this.state.storage.put('positions:recent', mergeNewest(bucket, record, POSITION_RECENT_MEMORY_LIMIT));
  }

  async applyPosition(record, fallbackBaseYes) {
    if (!record || !isOstNativeMarketId(record.marketId, record.source)) return null;
    const state = await this.readMarket(record.marketId);
    const positionKey = nativePositionKey(record);
    const previousImpact = state.orders[positionKey] ? state.orders[positionKey] : null;
    if (previousImpact) applyNativeStateDelta(state, previousImpact, -1);
    const nextImpact = nativePositionImpact(record);
    applyNativeStateDelta(state, nextImpact, 1);
    state.orders[positionKey] = nextImpact;
    state.baseYesPrice = await this.nativeBaseYesForMarket(state.marketId, fallbackBaseYes != null ? fallbackBaseYes : state.baseYesPrice);
    state.updatedAt = Date.now();
    const quoted = quoteNativeMarketState(state, state.baseYesPrice);
    Object.assign(state, quoted);
    pruneNativeMarketOrders(state);
    await this.writeMarket(state);
    const flowRecord = recentFlowRecordForPosition(record);
    await this.recordRecent(flowRecord);
    return { marketState: publicNativeMarketState(state), flowRecord: flowRecord !== record ? flowRecord : null };
  }

  async readRecent(marketId, limit) {
    const cleanMarketId = cleanText(marketId || '', 128);
    const rows = await this.state.storage.get('positions:recent') || [];
    const filtered = cleanMarketId ? rows.filter(record => cleanText(record?.marketId || '', 128) === cleanMarketId) : rows;
    return filtered.slice(0, Math.min(200, cleanNumber(limit, 60) || 60));
  }

  async handle(request) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, '') || '/';
    const method = request.method;
    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });

    if ((path === '/btc/round' || path === '/snapshot') && method === 'GET') {
      const refresh = url.searchParams.get('refresh') !== '0';
      return json(await this.btcSnapshot({ refresh }), 200, { 'cache-control': 'no-store' });
    }

    if (path === '/btc/ticks' && method === 'GET') {
      const refresh = url.searchParams.get('refresh') !== '0';
      return json(await this.btcTicks(url.searchParams.get('openAt'), url.searchParams.get('since'), refresh), 200, { 'cache-control': 'no-store' });
    }

    // The authoritative settled snapshot for one closed round — the REAL close
    // price captured at rollover (see rolloverBtcStateIfNeeded). This is what
    // OSTG prediction settlement reads, so a position settles against the price
    // the market actually closed at, not whatever the price is when resolve runs.
    if (path === '/btc/round-result' && method === 'GET') {
      const openAt = Math.floor(Number(url.searchParams.get('openAt') || 0) / FIVE_MIN_MS) * FIVE_MIN_MS;
      if (!(openAt > 0)) return json({ found: false, error: 'openAt_required' }, 400);
      const rec = await this.state.storage.get(`btc:round:${openAt}`);
      if (!rec) return json({ found: false, openAt }, 200, { 'cache-control': 'no-store' });
      return json(Object.assign({ found: true }, rec), 200, { 'cache-control': 'no-store' });
    }

    if (path === '/poke' && method === 'POST') {
      return json(await this.btcSnapshot({ refresh: true, force: true }), 200, { 'cache-control': 'no-store' });
    }

    const stateMatch = path.match(/^\/state\/([^/]+)$/);
    if (stateMatch && method === 'GET') {
      const marketId = decodeURIComponent(stateMatch[1]);
      const baseYes = cleanProbability(url.searchParams.get('baseYes'));
      const state = await this.quoteMarket(marketId, baseYes);
      return json({ ok: true, marketId, state, ts: new Date().toISOString() }, 200, { 'cache-control': 'no-store' });
    }

    if (path === '/position' && method === 'POST') {
      let body;
      try { body = await request.json(); } catch (_) { return json({ error: 'invalid_json' }, 400); }
      const result = await this.applyPosition(body && body.record, body && body.fallbackBaseYes);
      if (!result) return json({ ok: false, error: 'not_native' }, 400);
      return json(Object.assign({ ok: true }, result), 200, { 'cache-control': 'no-store' });
    }

    if (path === '/recent' && method === 'GET') {
      const marketId = cleanText(url.searchParams.get('marketId') || '', 128);
      const limit = Math.min(200, cleanNumber(url.searchParams.get('limit'), 60) || 60);
      const recent = await this.readRecent(marketId, limit);
      return json({ ok: true, recent, marketId: marketId || null, ts: new Date().toISOString() }, 200, { 'cache-control': 'no-store' });
    }

    return json({ error: 'not_found' }, 404);
  }
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
  const relatedPositionId = cleanText(record.id || record.signature || record.sig || positionKey, 128);
  const flowSignature = cashoutSig || relatedPositionId;
  const cashoutPending = !cashoutSig && (record.cashoutPending === true || cleanNumber(record.cashoutOst, 0) > 0 || cleanNumber(record.sellValue, 0) > 0);
  const cashoutVerified = record.cashoutVerified === true;
  return Object.assign({}, record, {
    id: cleanText(`sell:${positionKey}:${closedAt}`, 180),
    signature: flowSignature || null,
    sig: flowSignature || null,
    relatedPositionId,
    flowAction: 'sell',
    tradeAction: 'sell',
    action: 'sell',
    status: 'sold',
    cashoutSig,
    cashoutPending,
    cashoutVerified,
    verificationState: cashoutVerified ? 'verified' : cashoutSig ? 'submitted' : cashoutPending ? 'pending' : 'closed',
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
  { symbol: 'DIA', name: 'SPDR Dow Jones Industrial Average ETF', exchange: 'NYSE Arca', sector: 'Index ETF', currency: 'USD' },
  { symbol: 'NFLX', name: 'Netflix Inc.', exchange: 'NASDAQ', sector: 'Media', currency: 'USD' },
  { symbol: 'ORCL', name: 'Oracle Corp.', exchange: 'NYSE', sector: 'Technology', currency: 'USD' },
  { symbol: 'CRM', name: 'Salesforce Inc.', exchange: 'NYSE', sector: 'Technology', currency: 'USD' },
  { symbol: 'PLTR', name: 'Palantir Technologies', exchange: 'NASDAQ', sector: 'Technology', currency: 'USD' },
  { symbol: 'UBER', name: 'Uber Technologies', exchange: 'NYSE', sector: 'Technology', currency: 'USD' },
  { symbol: 'TSM', name: 'Taiwan Semiconductor ADR', exchange: 'NYSE', sector: 'Semiconductors', currency: 'USD' },
  { symbol: 'ASML', name: 'ASML Holding ADR', exchange: 'NASDAQ', sector: 'Semiconductors', currency: 'USD' },
  { symbol: 'AVGO', name: 'Broadcom Inc.', exchange: 'NASDAQ', sector: 'Semiconductors', currency: 'USD' },
  { symbol: 'MA', name: 'Mastercard Inc.', exchange: 'NYSE', sector: 'Payments', currency: 'USD' },
  { symbol: 'BAC', name: 'Bank of America', exchange: 'NYSE', sector: 'Financials', currency: 'USD' },
  { symbol: 'GS', name: 'Goldman Sachs Group', exchange: 'NYSE', sector: 'Financials', currency: 'USD' },
  { symbol: 'PEP', name: 'PepsiCo Inc.', exchange: 'NASDAQ', sector: 'Consumer staples', currency: 'USD' },
  { symbol: 'MCD', name: 'McDonald’s Corp.', exchange: 'NYSE', sector: 'Consumer', currency: 'USD' },
  { symbol: 'NKE', name: 'Nike Inc.', exchange: 'NYSE', sector: 'Consumer', currency: 'USD' },
  { symbol: 'WMT', name: 'Walmart Inc.', exchange: 'NYSE', sector: 'Retail', currency: 'USD' },
  { symbol: 'DIS', name: 'Walt Disney Co.', exchange: 'NYSE', sector: 'Media', currency: 'USD' },
  { symbol: 'JNJ', name: 'Johnson & Johnson', exchange: 'NYSE', sector: 'Healthcare', currency: 'USD' },
  { symbol: 'PFE', name: 'Pfizer Inc.', exchange: 'NYSE', sector: 'Healthcare', currency: 'USD' },
  { symbol: 'UNH', name: 'UnitedHealth Group', exchange: 'NYSE', sector: 'Healthcare', currency: 'USD' },
  { symbol: 'LLY', name: 'Eli Lilly & Co.', exchange: 'NYSE', sector: 'Healthcare', currency: 'USD' },
  { symbol: 'XOM', name: 'Exxon Mobil Corp.', exchange: 'NYSE', sector: 'Energy', currency: 'USD' },
  { symbol: 'CVX', name: 'Chevron Corp.', exchange: 'NYSE', sector: 'Energy', currency: 'USD' },
  { symbol: 'BA', name: 'Boeing Co.', exchange: 'NYSE', sector: 'Industrials', currency: 'USD' },
  { symbol: 'CAT', name: 'Caterpillar Inc.', exchange: 'NYSE', sector: 'Industrials', currency: 'USD' },
  { symbol: 'COIN', name: 'Coinbase Global', exchange: 'NASDAQ', sector: 'Crypto equities', currency: 'USD' },
  { symbol: 'MSTR', name: 'MicroStrategy Inc.', exchange: 'NASDAQ', sector: 'Crypto equities', currency: 'USD' },
  { symbol: 'HOOD', name: 'Robinhood Markets', exchange: 'NASDAQ', sector: 'Crypto equities', currency: 'USD' },
  { symbol: 'GLD', name: 'SPDR Gold Shares', exchange: 'NYSE Arca', sector: 'Commodity ETF', currency: 'USD' }
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

async function fetchYahooStockQuote(clean) {
  const response = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol(clean))}?range=1d&interval=5m&includePrePost=false`, {
    headers: { accept: 'application/json', 'user-agent': 'OST-Stock-Mirror/1.0' },
    cf: { cacheTtl: 20, cacheEverything: true }
  });
  if (!response.ok) return null;
  let payload = null;
  try { payload = await response.json(); } catch (_) { return null; }
  const result = payload && payload.chart && Array.isArray(payload.chart.result) ? payload.chart.result[0] : null;
  const yahooMeta = result && result.meta ? result.meta : null;
  const price = cleanNumber(yahooMeta && yahooMeta.regularMarketPrice);
  if (!Number.isFinite(price) || price <= 0) return null;
  const previous = cleanNumber(yahooMeta.chartPreviousClose != null ? yahooMeta.chartPreviousClose : yahooMeta.previousClose) || price;
  const change = price - previous;
  const meta = stockMeta(clean);
  return {
    symbol: clean,
    name: meta.name,
    exchange: meta.exchange,
    sector: meta.sector,
    currency: (yahooMeta && yahooMeta.currency) || meta.currency || 'USD',
    price,
    open: cleanNumber(yahooMeta.regularMarketOpen) || null,
    high: cleanNumber(yahooMeta.regularMarketDayHigh) || null,
    low: cleanNumber(yahooMeta.regularMarketDayLow) || null,
    volume: cleanNumber(yahooMeta.regularMarketVolume, 0) || 0,
    change,
    changePct: previous ? change / previous * 100 : 0,
    asOf: yahooMeta.regularMarketTime ? new Date(Number(yahooMeta.regularMarketTime) * 1000).toISOString() : new Date().toISOString(),
    source: 'yahoo-chart-public'
  };
}

async function fetchStockQuote(symbol) {
  const clean = normalizeStockSymbol(symbol);
  if (!clean) return null;
  // Yahoo first — Stooq started blocking Cloudflare egress (empty CSV/451),
  // which left the whole stock mirror without live prices.
  try {
    const yahoo = await fetchYahooStockQuote(clean);
    if (yahoo) return yahoo;
  } catch (_) {}
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
      const state = publicFaucetState(record, now);
      publishRealtimeEvent(this.env, {
        type: 'faucet.claim',
        public: true,
        channels: ['all', 'faucet', walletChannelForRealtime(wallet)],
        wallet,
        amount,
        token: 'OST',
        title: 'Faucet claim confirmed',
        message: '+' + amount + ' OST ' + (pending.kind === 'welcome' ? 'head start' : 'daily claim'),
        payload: { state, reservationId, signature, kind: pending.kind }
      }).catch(() => {});
      return json({ ok: true, state }, 200, { 'cache-control': 'no-store' });
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


/* ── Jurisdiction gate ──────────────────────────────────────────────────────
 * OST's stated posture is that it does not serve US or EU customers. Intent is
 * not a defence - "they found us on their own" has failed for offshore
 * operators repeatedly, because jurisdiction follows the CUSTOMER, not where
 * the company sits. What makes the posture real is refusing the request.
 *
 * Cloudflare gives us the resolved country free on every request via
 * CF-IPCountry, so this costs nothing and cannot be forgotten at the client.
 *
 * This is a coarse control: a VPN defeats it. It is not meant to stop a
 * determined individual - it is meant to ensure OST does not KNOWINGLY serve
 * a restricted market, which is the part a regulator or processor asks about.
 * Applied to money paths only (loans, settlement, top-up); browsing, games and
 * mesh stay open.
 */
const EU_EEA = new Set([
  'AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IE','IT',
  'LV','LT','LU','MT','NL','PL','PT','RO','SK','SI','ES','SE','IS','LI','NO'
]);
const RESTRICTED_EXTRA = new Set(['US', 'GB']);

function requestCountry(request) {
  return String(request.headers.get('CF-IPCountry') || '').toUpperCase();
}

function jurisdictionBlocked(request, env) {
  // OFF on devnet by choice (nothing here moves real money yet), but MAINNET
  // FORCES IT ON. Tying it to the cluster instead of to a flag means it cannot
  // be forgotten in the rush of a launch - the exact moment it starts to
  // matter is the moment it switches itself on. GEOBLOCK_ENABLED='false' can
  // silence it pre-mainnet; on mainnet the flag is ignored.
  const mainnet = topupCluster(env) === 'mainnet-beta';
  if (!mainnet && env.GEOBLOCK_ENABLED === 'false') return null;
  const cc = requestCountry(request);
  // T1 = Tor, XX = unknown. Treat unknown as allowed rather than blocking real
  // users on a header we did not get; the block is about not KNOWINGLY serving.
  if (!cc || cc === 'XX') return null;
  if (EU_EEA.has(cc) || RESTRICTED_EXTRA.has(cc)) {
    return json({
      ok: false,
      error: 'jurisdiction_not_served',
      country: cc,
      note: 'OST does not offer funded accounts or credit in this jurisdiction.'
    }, 451);
  }
  return null;
}

/* ── Purchase ledger (real money) ──────────────────────────────────────────
 * Intents used to live in OST_KV. That put every paid customer behind the same
 * ~1k/day write budget the games burn through, and behind tierDown('kv'), which
 * DELIBERATELY sheds writes under load. A shed write on the money path means a
 * customer paid and the record of it vanished. Intents now live in a Durable
 * Object (no daily write cap) with a D1 audit journal. See purchase-ledger.js.
 */
function purchaseLedger(env) {
  if (!env.PURCHASE_LEDGER) return null;
  return env.PURCHASE_LEDGER.get(env.PURCHASE_LEDGER.idFromName('purchases-v1'));
}

async function ledgerOp(env, payload) {
  const stub = purchaseLedger(env);
  if (!stub) throw new Error('purchase ledger unavailable');
  const r = await stub.fetch('https://purchase-ledger/op', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await r.json().catch(() => ({ ok: false, error: 'ledger returned non-json' }));
  return data;
}

async function loadIntent(env, id) {
  if (!id) return null;
  const res = await ledgerOp(env, { op: 'get', id });
  return (res && res.ok) ? (res.intent || null) : null;
}
async function saveIntent(env, intent) {
  const res = await ledgerOp(env, { op: 'put', intent });
  // A failed save must NOT look like success: the caller is about to tell a
  // customer their purchase is recorded.
  if (!res || !res.ok) throw new Error('intent_not_saved: ' + ((res && res.error) || 'unknown'));
  return res.intent;
}
async function pushQueue(env, id) {
  await ledgerOp(env, { op: 'queue.push', id });
}
async function removeQueue(env, id) {
  await ledgerOp(env, { op: 'queue.remove', id });
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
  // api.devnet.solana.com 403s Cloudflare Workers' shared egress IPs
  // ("Your IP or provider is blocked from this endpoint" — confirmed
  // directly against this deployed worker) and rpc.ankr.com/solana_devnet
  // now requires an API key too, so both were silently failing every devnet
  // topup verification. Helius' public devnet endpoint and Alchemy's demo
  // endpoint verified working from this worker's actual egress.
  return [
    env.SOLANA_DEVNET_RPC,
    'https://devnet.helius-rpc.com/?api-key=public',
    'https://solana-devnet.g.alchemy.com/v2/demo',
    'https://api.devnet.solana.com'
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
  // The old body did: kvGet(sig) -> check -> ... -> kvPut(sig). That is
  // check-then-write across an eventually consistent store, and it has two real
  // racers: /topup/crypto/verify (user pressed Verify) and the auto-detect
  // poller /topup/crypto/check/:intent. Both could read null in different colos
  // and both credit - ONE payment delivered TWICE. The DO now does the check,
  // the status transition, the save and the queue push inside a single
  // serialized section, keyed on the payment reference.
  const res = await ledgerOp(env, {
    op: 'credit',
    intentId: intent.id,
    ref: verification.signature,
    rail: verification.rail,
    enqueue: options.enqueueDispatcher !== false
  });
  if (!res || !res.ok) {
    return { ok: false, error: (res && res.error) || 'credit_failed' };
  }
  intent = res.intent;
  if (res.replay) {
    // Already delivered on an earlier call. Returning ok (not an error) keeps
    // the poller and the button idempotent, but we do NOT re-notify.
    return { ok: true, intent, replay: true };
  }
  publishWalletRealtime(env, {
    id: intent.id,
    wallet: intent.wallet,
    kind: 'topup-paid',
    amount: intent.ostAmount,
    sig: verification.signature,
    label: 'Payment verified; OST delivery queued',
    token: 'OST',
    ts: intent.paidAt
  }, {
    type: 'topup.paid',
    title: 'Payment verified',
    message: intent.ostAmount + ' OST delivery is queued'
  });
  return { ok: true, intent };
}

async function findCryptoTopupPayment(env, intent) {
  const cluster = topupCluster(env);
  const receiver = topupSolReceiver(env, cluster) || '';
  if (!receiver) return null;
  const signatures = await solanaRpc(env, 'getSignaturesForAddress', [receiver, { limit: 120 }], { cluster });
  const candidates = (signatures || [])
    .map((item) => cleanText(item?.signature, 128))
    .filter(Boolean);
  // One batched ledger call instead of a per-signature lookup inside the loop.
  let spent = {};
  try {
    const res = await ledgerOp(env, { op: 'sig.owners', refs: candidates });
    if (res && res.ok) spent = res.owners || {};
  } catch (_) {
    // Ledger unreachable: do NOT silently treat every signature as unspent -
    // that is how one payment gets scanned into two intents. The atomic credit
    // still refuses a reused ref, so fall through and let it be the gate.
  }
  for (const signature of candidates) {
    const used = spent[signature];
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





    // GET /health/hub — is the market authority actually being used? A year of
    // desync hid behind a silent null; this makes the answer one curl away.
    if (path === '/health/hub' && method === 'GET') {
      const now = Date.now();
      return json({
        fails: HUB_HEALTH.fails,
        lastError: HUB_HEALTH.lastError,
        lastFailAgoMs: HUB_HEALTH.lastFailAt ? now - HUB_HEALTH.lastFailAt : null,
        lastOkAgoMs: HUB_HEALTH.lastOkAt ? now - HUB_HEALTH.lastOkAt : null,
        bindingPresent: !!(env && env.NATIVE_MARKET_HUB),
        note: 'fails > 0 means market state was served from a per-colo cache and testers CAN see different prices. Counters are per-isolate, so poll repeatedly.'
      });
    }

    // GET /health/peg — the public 1:1 checker for the OSTG<->OSTC bridge.
    //
    // The bridge's whole promise is the identity  supply(OSTG) == vault(OSTC).
    // This does not TRUST it — it READS both numbers straight off the chain and
    // reports whether they match. Anyone can verify the peg without our say-so,
    // which is the only kind of promise worth making about money. If drift is
    // ever non-zero, the program minted or released something it should not have,
    // and this endpoint says so out loud instead of hiding it.
    if (path === '/health/peg' && method === 'GET') {
      const OSTG_MINT = 'DfgxMbdN49AX2Za9LuvsyixF1jgVh45RbgWYSGonxQos';
      const VAULT = '8X6pL7QtYqGd8pzkVA3nkWu36rRw9YQsUGh79V6XRYak';
      try {
        // Real network reads, in parallel. No cache — a stale peg is a lie.
        const [supplyRes, vaultRes] = await Promise.all([
          solanaRpc(env, 'getTokenSupply', [OSTG_MINT], { cluster: 'devnet' }),
          solanaRpc(env, 'getTokenAccountBalance', [VAULT], { cluster: 'devnet' }),
        ]);
        const ostgSupply = supplyRes?.value?.uiAmount;
        const vaultOstc = vaultRes?.value?.uiAmount;
        // undefined means the read FAILED — do not report a fake 0/0 "it's fine".
        // (This is the masking anti-pattern; a peg checker that lies is worse than
        // none.) Say the read failed instead.
        if (ostgSupply == null || vaultOstc == null) {
          return json({ ok: false, error: 'rpc_read_failed', ostgSupply, vaultOstc,
            note: 'Could not read supply and/or vault — this is NOT a peg verdict.' }, 502);
        }
        const drift = Number((ostgSupply - vaultOstc).toFixed(9));
        const pegHolds = Math.abs(drift) < 1e-9;
        return json({
          ok: pegHolds,
          pegHolds,
          ostgSupply,
          vaultOstc,
          drift,
          ostgMint: OSTG_MINT,
          vault: VAULT,
          note: pegHolds
            ? 'supply(OSTG) == vault(OSTC): every OSTG is backed 1:1 by escrowed OSTC.'
            : 'PEG BROKEN — OSTG supply and vault OSTC disagree. The bridge minted or released money it should not have.'
        }, pegHolds ? 200 : 500);
      } catch (e) {
        return json({ ok: false, error: 'peg_check_threw', detail: String(e && e.message).slice(0, 160) }, 502);
      }
    }

    // Web Push: /push/key, /push/subscribe, /push/unsubscribe, /push/test.
    // Returns null for anything that is not a push route, so the rest of the
    // router is untouched.
    if (path.startsWith('/push/')) {
      const pushed = await handlePush(request, env, path, method, json);
      if (pushed) return pushed;
    }

    // Ghost router (Phase 2) will be wired here.
    // ── POST /ghost/chat ─ OST Ghost companion brain (Workers AI, free tier) ──
    if (path === '/ghost/chat' && method === 'POST') {
      if (!env.AI || typeof env.AI.run !== 'function') {
        return json({ error: 'ai_unavailable', note: 'Workers AI binding not deployed yet' }, 503);
      }
      // RATE LIMIT (red-team MED). /ghost/chat was unauthenticated and ran
      // billable Workers AI unbounded — free unlimited inference for anyone,
      // and a way to exhaust the daily AI quota so real users lose Ghost.
      // Native rate limiter (strongly consistent per-colo): KV was tried first
      // but is eventually consistent, so a burst read 0 every time and the cap
      // never fired. Fail-open only if the binding is absent — a cost limiter
      // must not take Ghost offline on its own.
      try {
        if (env.PLAY_LEDGER) {
          const ip = request.headers.get('CF-Connecting-IP') || 'anon';
          const pl = env.PLAY_LEDGER.get(env.PLAY_LEDGER.idFromName('global'));
          const rlRes = await pl.fetch('https://play-ledger/play/rl', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: 'ghost:' + ip, limit: 12, windowSec: 60 })
          });
          const rl = await rlRes.json().catch(() => ({ allowed: true }));
          if (rl && rl.allowed === false) {
            return json({ error: 'rate_limited', note: 'Too many Ghost requests. Wait a minute and try again.' }, 429);
          }
        }
      } catch (_) { /* limiter unavailable: allow rather than take Ghost offline */ }
      let body = {};
      try { body = await request.json(); } catch (_) {}
      const userMessages = Array.isArray(body.messages) ? body.messages.slice(-6) : [];
      const context = body.context && typeof body.context === 'object' ? body.context : {};
      const cleanMsgs = userMessages
        .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
        .map(m => ({ role: m.role, content: String(m.content).slice(0, 600) }));
      if (!cleanMsgs.length) return json({ error: 'no_messages' }, 400);
      const ctxSummary = JSON.stringify(context).slice(0, 1500);
      const system = 'You are the OST Ghost, the friendly in-page companion of the OST token devnet app '
        + '(prediction markets, 5-minute BTC/ETH/SOL rounds, parlays, faucet arcade games, offline vault). '
        + 'You can see the live session data of this user: ' + ctxSummary + '. '
        + 'Be warm, concise (2-4 sentences), concrete, and honest. Use their real numbers when relevant. '
        + 'If they are losing, be kind and suggest a break or lower stakes - never promise wins. '
        + 'Everything here is devnet test-token play, never financial advice. Answer questions about app features plainly.';
      // Model fallback chain — Workers AI deprecates models over time, so we
      // walk the list until one answers instead of hard-coding a single id.
      const GHOST_MODELS = [
        '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
        '@cf/mistralai/mistral-small-3.1-24b-instruct',
        '@cf/meta/llama-3.2-3b-instruct'
      ];
      const errors = [];
      let lastError = '';
      for (const model of GHOST_MODELS) {
        try {
          const ai = await env.AI.run(model, {
            messages: [{ role: 'system', content: system }].concat(cleanMsgs),
            max_tokens: 320
          });
          const reply = (ai && (ai.response || ai.result || '')) || '';
          if (!reply) throw new Error('empty reply');
          return json({ ok: true, reply: String(reply).slice(0, 2000), model, ts: Date.now() });
        } catch (error) {
          lastError = String(error && error.message || error).slice(0, 160);
          errors.push(model.split('/').pop() + ': ' + lastError);
        }
      }
      return json({ error: 'ai_failed', message: errors.join(' | ').slice(0, 500) }, 502);
    }

    if (path.startsWith('/ghost/')) {
      const ghostV2 = await handleGhostV2Request(request, env, { path, method });
      if (ghostV2) return ghostV2;
      return json({ error: 'unknown ghost endpoint', path }, 404);
    }

    // OST Mesh — quantum-ready P2P signaling + identity directory.
    if (path.startsWith('/mesh/')) {
      return handleMeshRequest(request, env, { path, method });
    }

    // Server-side pool payouts (Phase 0 — replaces browser-held pool secret key).
    if (path === '/wallet/payout' || path === '/wallet/ata-rent' || path.startsWith('/wallet/cosign')) {
      return handleWalletPayoutsRequest(request, env);
    }

    // Server-side provably-fair seed (Phase 0 — replaces browser-generated serverSeed).
    if (path.startsWith('/games/')) {
      return handleGamesRngRequest(request, env);
    }

    // OSTG-backed play balance (Phase 2 — project-docs/PLAY-BALANCE.md). Single
    // global PlayLedger Durable Object owns every player's balance + the peg.
    // Real-money settlement (payment processor webhooks). We hold no keys;
    // the processor handles custody, confirmations and reorgs.
    if (path.startsWith('/settlement/')) {
      const geoS = jurisdictionBlocked(request, env);
      if (geoS && path !== '/settlement/health') return geoS;
      const settled = await handleSettlementRequest(request, env, {
        path,
        method,
        deps: {
          loadIntent,
          mapRef: (e, ref, intentId) => ledgerOp(e, { op: 'ref.map', ref, intentId }),
          creditIntent: (e, args) => ledgerOp(e, { op: 'credit', ...args }),
          // Cash repayment: dollars paid by card/crypto retire debt directly in
          // the loan ledger. No OSTG is debited because none was spent - the
          // user paid with outside money, which is exactly the "repay from a
          // source unrelated to the loan" rule.
          repayLoanFromCash: async (e, { wallet, loanId, usd, usdPerOstg, ref }) => {
            if (!e.LOAN_LEDGER) return { ok: false, error: 'loan_ledger_unavailable' };
            const amountOstg = Math.round((Number(usd) / Number(usdPerOstg || 0.0118)) * 1e6) / 1e6;
            const stub = e.LOAN_LEDGER.get(e.LOAN_LEDGER.idFromName('loans-v1'));
            const r = await stub.fetch('https://loan-ledger/repay', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                address: wallet, loanId, amount: amountOstg,
                from: 'cash', viaPlay: true, cashRef: ref
              })
            });
            return await r.json().catch(() => ({ ok: false, error: 'loan_ledger_bad_response' }));
          }
        }
      });
      if (settled) return settled;
      return json({ error: 'unknown settlement endpoint', path }, 404);
    }

    // Ad revenue treasury — server-side view cap + honest accrued/received split.
    if (path.startsWith('/ads/')) {
      const handled = await handleAdRequest(request, env, { path, method, adminAuthorized });
      if (handled) return handled;
      return json({ error: 'unknown ads endpoint', path }, 404);
    }

    // OSTG credit lines. Gated twice: LOANS_LIVE must be "true" AND the
    // cluster must be mainnet - lending devnet tokens against real money
    // would be lending against nothing.
    if (path.startsWith('/loans/')) {
      if (!env.LOAN_LEDGER) return json({ ok: false, error: 'loan_ledger_not_configured' }, 503);
      const geo = jurisdictionBlocked(request, env);
      if (geo) return geo;
      const op = path.slice('/loans/'.length);
      // THREE STATES, not a single mainnet switch.
      //   off  - refuses everything but health/summary (default).
      //   test - devnet. The mechanism is FULLY REAL: real credit line, real
      //          provenance, real interest, real repayment, and the drawn OSTG
      //          is genuinely backed by devnet SPL tokens in the pool. What is
      //          "test" is the MONEY, not the machinery - which is exactly what
      //          you need to hand paid testers before mainnet.
      //   live - mainnet.
      // A blunt mainnet-only gate made the system impossible to prove before
      // the day it had to work, which is the wrong order to find bugs in.
      const mode = String(env.LOANS_MODE || 'off').toLowerCase();
      const cluster = topupCluster(env);
      const enabled = (mode === 'live' && cluster === 'mainnet-beta') || (mode === 'test' && cluster !== 'mainnet-beta');
      if (!enabled && op !== 'health' && op !== 'summary') {
        return json({
          ok: false,
          error: 'loans_not_enabled',
          mode,
          cluster,
          note: mode === 'live'
            ? 'LOANS_MODE=live requires mainnet'
            : 'set LOANS_MODE=test on devnet, or live on mainnet'
        }, 503);
      }

      // Draw and repay go through PlayLedger, which owns the balance AND the
      // pool view. Both are gated in the DO behind the internal key, so this
      // proxy attaches it — this is the ONLY path that legitimately reaches
      // those mutators, so the LOANS_MODE + geoblock checks above cannot be
      // bypassed by hitting /play/loan-* directly.
      if ((op === 'draw' || op === 'repay') && request.method === 'POST') {
        if (!env.PLAY_LEDGER) return json({ ok: false, error: 'play_ledger_not_configured' }, 503);
        if (!env.INTERNAL_MUTATION_KEY) return json({ ok: false, error: 'internal_key_not_configured' }, 503);
        const pl = env.PLAY_LEDGER.get(env.PLAY_LEDGER.idFromName('global'));
        return await pl.fetch('https://play-ledger/play/loan-' + (op === 'draw' ? 'draw' : 'repay'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-ost-internal': env.INTERNAL_MUTATION_KEY },
          body: await request.text()
        });
      }
      try {
        const stub = env.LOAN_LEDGER.get(env.LOAN_LEDGER.idFromName('loans-v1'));
        const init = { method: request.method, headers: { 'Content-Type': 'application/json' } };
        if (request.method === 'POST') init.body = await request.text();
        // Summary is enriched with the REAL lending capacity. The credit line is
        // denominated in USD, but the pool can only lend its backed surplus, so
        // the line alone can promise OSTG that cannot actually be drawn. The UI
        // must show the binding limit, in BOTH units, or a user hits a refusal
        // for money the screen said they had.
        if (op === 'summary') {
          const stubS = env.LOAN_LEDGER.get(env.LOAN_LEDGER.idFromName('loans-v1'));
          const res = await stubS.fetch('https://loan-ledger/summary' + url.search);
          const data = await res.json().catch(() => null);
          if (!data || !data.ok) return json(data || { ok: false, error: 'summary_failed' }, res.status);
          try {
            const plS = env.PLAY_LEDGER.get(env.PLAY_LEDGER.idFromName('global'));
            const h = await (await plS.fetch('https://play-ledger/health/play')).json();
            // Must mirror play-ledger's RESERVE_FRACTION exactly. If this shows
            // the whole buffer while the server lends only a fraction, the UI
            // promises money the draw will refuse.
            const reserveFraction = Number(env.LENDING_RESERVE_FRACTION || 0.5);
            const buffer = Math.max(0, Number(h.buffer) || 0) * reserveFraction;
            const rate = Number(url.searchParams.get('usdPerOstg')) || 0.0118;
            data.capacity = {
              lendableOstg: buffer,
              poolBufferOstg: Math.max(0, Number(h.buffer) || 0),
              reserveFraction,
              lendableUsd: Math.round(buffer * rate * 100) / 100,
              usdPerOstg: rate,
              // What the user can actually draw right now: the smaller of their
              // remaining credit line and what the pool can back.
              maxDrawUsd: Math.min(Number(data.availableUsd) || 0, Math.round(buffer * rate * 100) / 100),
              maxDrawOstg: Math.min(Math.round(((Number(data.availableUsd) || 0) / rate) * 1e6) / 1e6, buffer),
              limitedBy: (Number(data.availableUsd) || 0) > (buffer * rate) ? 'lending_reserve' : 'credit_line'
            };
          } catch (_) { /* capacity is additive; summary still returns without it */ }
          return json(data);
        }

        // Carry the query string through. Rebuilding the URL without it made
        // GET /loans/summary?address=... arrive with no address, so the DO
        // looked up the empty wallet and reported "no loans" for a wallet that
        // had one.
        return await stub.fetch('https://loan-ledger/' + op + url.search, init);
      } catch (error) {
        return json({ ok: false, error: 'loan_ledger_unreachable', detail: String(error?.message || error) }, 502);
      }
    }

    // OST anchor — the index-linked reference rate, from real Pyth FX feeds.
    if (path.startsWith('/anchor/')) {
      if (!env.__store) env.__store = { get: (k, fb) => kvGet(env, k, fb), put: (k, v, ttl) => kvPut(env, k, v, ttl) };
      const a = await handleAnchorRequest(request, env, { path, store: env.__store });
      if (a) return a;
      return json({ error: 'unknown anchor endpoint', path }, 404);
    }

    // SERVER-AUTHORITATIVE OSTG predictions. open computes entry odds from the
    // server's own market data (never the client's); resolve settles from the
    // server's price. Gated by PREDICT_LIVE (off until confirmed). See
    // prediction-ledger.js.
    if (path.startsWith('/play/predict/')) {
      if (!env.PREDICTION_LEDGER) return json({ ok: false, error: 'prediction_ledger_not_configured' }, 503);
      const pop = path.slice('/play/predict/'.length);
      const stub = env.PREDICTION_LEDGER.get(env.PREDICTION_LEDGER.idFromName('predictions-v1'));
      if (pop === 'open' && method === 'POST') {
        let b; try { b = await request.json(); } catch { return json({ ok: false, error: 'invalid_json' }, 400); }
        // Compute the server's YES odds for the round; the DO uses this, not any
        // client-supplied price, so entry shares can't be gamed.
        // Entry odds AND the price-to-beat both come from the CANONICAL round
        // (the same server data the hero/desk show the user), so a position is
        // opened, priced, and later settled against ONE consistent line.
        let oddsYes = 0.5, priceToBeat = null;
        try {
          const m = String(b.marketId || '').match(/^ost-btc5m-(\d+)$/);
          if (m) {
            const openAt = Number(m[1]);
            if (!env.__store) env.__store = { get: (k, fb) => kvGet(env, k, fb), put: (k, v, ttl) => kvPut(env, k, v, ttl) };
            const canon = await getCanonicalBtcRound(env, { refresh: false });
            const live = (memGet('btc:latest') || await kvGet(env, 'btc:latest', null));
            const livePrice = Number(live && (live.price || live.p || live.value));
            // Only trust canon if it is THIS round; otherwise fall back to KV.
            const canonOpen = canon && Number(canon.openAt) === openAt ? Number(canon.openPrice) : NaN;
            const canonBeat = canon && Number(canon.openAt) === openAt ? Number(canon.priceToBeat) : NaN;
            const rec = await kvGet(env, 'round:' + openAt, null);
            const openPrice = Number.isFinite(canonOpen) && canonOpen > 0 ? canonOpen : Number(rec && rec.openPrice);
            const beat = Number.isFinite(canonBeat) && canonBeat > 0 ? canonBeat
              : (Number(rec && rec.priceToBeat) > 0 ? Number(rec.priceToBeat) : openPrice);
            if (Number.isFinite(openPrice) && openPrice > 0) {
              priceToBeat = Number.isFinite(beat) && beat > 0 ? beat : openPrice;
              if (Number.isFinite(livePrice)) {
                const msLeft = Math.max(0, (openAt + 5 * 60 * 1000) - Date.now());
                const o = serverComputeBtcOdds(openPrice, livePrice, msLeft, priceToBeat);
                if (o && Number.isFinite(o.yes)) oddsYes = o.yes;
              }
            }
          }
        } catch (_) {}
        return await stub.fetch('https://prediction-ledger/open', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(Object.assign({}, b, { oddsYes, priceToBeat }))
        });
      }
      if (pop === 'resolve' && method === 'POST') {
        let b; try { b = await request.json(); } catch { return json({ ok: false, error: 'invalid_json' }, 400); }
        // Authoritative settle price = the round's REAL close price captured by
        // the NativeMarketHub at rollover — NOT the current price. If the round
        // has not rolled over yet there is no close price, so settlePrice stays
        // NaN and the ledger refuses to resolve (it NEVER guesses an outcome).
        // openAt is embedded in the position id (p_<openAt>_…); marketId is a
        // fallback for callers that pass it.
        let openAt = 0;
        const im = String(b.id || '').match(/^p_(\d+)_/);
        if (im) openAt = Number(im[1]);
        if (!openAt) { const mm = String(b.marketId || '').match(/^ost-btc5m-(\d+)$/); if (mm) openAt = Number(mm[1]); }
        let settlePrice = NaN;
        if (openAt > 0) {
          const rr = await getBtcRoundResult(env, openAt);
          if (rr && Number.isFinite(Number(rr.closePrice)) && Number(rr.closePrice) > 0) settlePrice = Number(rr.closePrice);
        }
        return await stub.fetch('https://prediction-ledger/resolve', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(Object.assign({}, b, { settlePrice }))
        });
      }
      if (pop === 'get' && method === 'GET') return await stub.fetch('https://prediction-ledger/get?id=' + encodeURIComponent(url.searchParams.get('id') || ''));
      if (pop === 'health') return await stub.fetch('https://prediction-ledger/health');
      return json({ ok: false, error: 'unknown prediction op' }, 404);
    }

    // ONE answer to "how much does this wallet have". See balance-truth.js.
    if (path === '/balance/truth') {
      const bt = await handleBalanceTruth(request, env, { path, url });
      if (bt) return bt;
    }

    // Purchase ledger health — proves the real-money path is on the Durable
    // Object and not back on the KV write budget.
    if (path === '/health/purchase') {
      if (!env.PURCHASE_LEDGER) return json({ ok: false, error: 'purchase_ledger_not_configured' }, 503);
      try {
        return json(await ledgerOp(env, { op: 'health' }));
      } catch (error) {
        return json({ ok: false, error: String(error?.message || error) }, 503);
      }
    }

    if (path.startsWith('/play/') || path === '/health/play') {
      const id = env.PLAY_LEDGER.idFromName('global');
      return env.PLAY_LEDGER.get(id).fetch(request);
    }

    // OST Live Price — devnet synthetic price engine. Additive, isolated.
    if (path.startsWith('/ost/')) {
      // Hand the price module the SAME tiered store (memory→cache→KV→D1→R2) the
      // rest of the worker uses, so its history/counters survive a KV-exhausted
      // day instead of resetting. It falls back to its own KV path if absent.
      if (!env.__store) env.__store = { get: (k, fb) => kvGet(env, k, fb), put: (k, v, ttl) => kvPut(env, k, v, ttl) };
      const ostResp = await handleOstPriceRequest(request, env, { path, method, url });
      if (ostResp) return ostResp;
    }

    // OST Realtime — WebSocket events for prices, orders, wallet alerts, games.
    if (path.startsWith('/realtime/')) {
      return handleRealtimeRequest(request, env, { path, method });
    }

    // OST Faucet Gate — shared per-wallet faucet state + anti-double-claim reservations.
    if (path === '/faucet/state' && method === 'GET') {
      if (!env.FAUCET_GATE) return json({ error: 'faucet_gate_not_configured' }, 503);
      const wallet = cleanText(url.searchParams.get('wallet') || '', 80);
      if (!wallet) return json({ error: 'missing_wallet' }, 400);
      const id = env.FAUCET_GATE.idFromName('global');
      const aliasUrl = new URL(request.url);
      aliasUrl.pathname = '/faucet/v1/state/' + encodeURIComponent(wallet);
      return env.FAUCET_GATE.get(id).fetch(new Request(aliasUrl.toString(), request));
    }
    if (path.startsWith('/faucet/v1/')) {
      if (!env.FAUCET_GATE) return json({ error: 'faucet_gate_not_configured' }, 503);
      const id = env.FAUCET_GATE.idFromName('global');
      return env.FAUCET_GATE.get(id).fetch(request);
    }

    // ── Polymarket relay: /gamma/* /clob/* /data/* ───────────────────────────
    // The site sets OST_POLY_RELAY_URL to this worker and requests these
    // prefixes, but the routes never existed — every relayed fetch 404'd and
    // fell back to direct Polymarket (blocked/geo-limited for some testers).
    // GET-only, host-allowlisted, edge-cached 15s so heavy use never hammers
    // the upstream or this worker's limits.
    const RELAY_HOSTS = {
      '/gamma': 'https://gamma-api.polymarket.com',
      '/clob': 'https://clob.polymarket.com',
      '/data': 'https://data-api.polymarket.com'
      // NOTE: no Binance relay here on purpose — Binance returns 403 to
      // Cloudflare/datacenter IPs, so proxying it server-side does not work.
      // Browsers CAN reach data-api.binance.vision directly (api.binance.com is
      // the one that's CORS-blocked), so the client hits binance.vision first
      // and falls back to GET /spot below, which is Coinbase-backed and works
      // from the edge — that's the path for regions where Binance is blocked.
    };
    for (const prefix of Object.keys(RELAY_HOSTS)) {
      if (method === 'GET' && (path === prefix || path.startsWith(prefix + '/'))) {
        const upstream = RELAY_HOSTS[prefix] + path.slice(prefix.length) + url.search;
        const ttl = 15;
        try {
          const resp = await fetch(upstream, {
            headers: { accept: 'application/json', 'user-agent': 'ost-relay/1.0 (+https://ost-token.pages.dev)' },
            cf: { cacheTtl: ttl, cacheEverything: true }
          });
          const body = await resp.arrayBuffer();
          return new Response(body, {
            status: resp.status,
            headers: {
              ...CORS_HEADERS,
              'content-type': resp.headers.get('content-type') || 'application/json',
              'cache-control': 'public, max-age=' + ttl,
              'x-ost-relay': prefix.slice(1)
            }
          });
        } catch (err) {
          return json({ error: 'relay_failed', upstream: prefix, message: String(err?.message || err).slice(0, 200) }, 502);
        }
      }
    }

    // ── GET /store/health ─ which storage tier is carrying the load ──────────
    // Shows the backup chain live: memory -> cache -> KV -> D1 -> R2. A tier
    // that errors or runs out of quota is "tripped" (circuit breaker) and the
    // next tier carries writes/reads until it is retried.
    if (path === '/store/health' && method === 'GET') {
      return json({ ok: true, chain: ['memory', 'cache', 'kv', 'd1', 'r2'], tiers: storeHealth(env), ts: Date.now() });
    }

    // ── GET /store/selftest ─ prove the chain actually fails over ────────────
    if (path === '/store/selftest' && method === 'GET') {
      const key = 'store:selftest:' + Date.now();
      const value = { probe: true, at: Date.now() };
      const wrote = await kvPut(env, key, value, 300);
      const readBack = await kvGet(env, key, null);
      // Read straight out of D1 to prove the backup tier really holds a copy.
      let d1Copy = null;
      try {
        if (env.DB) {
          const row = await env.DB.prepare('SELECT v FROM kv WHERE k = ?').bind(key).first();
          d1Copy = row ? JSON.parse(row.v) : null;
        }
      } catch (_) {}
      return json({
        ok: !!wrote && !!readBack,
        wrote, readBack,
        d1HasIndependentCopy: !!d1Copy && d1Copy.probe === true,
        tiers: storeHealth(env)
      });
    }

    // ── GET /spot?symbol=BTCUSDT ─ edge-reachable spot price ─────────────────
    // The browser's Binance paths can be blocked (api.binance.com is CORS-
    // blocked everywhere; binance.vision + the ws stream are blocked in some
    // regions, e.g. CN). Binance also 403s Cloudflare IPs, so we CANNOT relay
    // it. Coinbase does answer from the edge — so this is the always-reachable
    // fallback tick source. 1s edge cache: all clients in the same second share
    // one upstream call.
    if (path === '/spot' && method === 'GET') {
      const symbol = String(url.searchParams.get('symbol') || '').toUpperCase();
      const MAP = { BTCUSDT: 'BTC-USD', ETHUSDT: 'ETH-USD', SOLUSDT: 'SOL-USD' };
      const pair = MAP[symbol];
      if (!pair) return json({ error: 'unsupported_symbol', symbol, supported: Object.keys(MAP) }, 400);
      try {
        const r = await fetch('https://api.coinbase.com/v2/prices/' + pair + '/spot', {
          headers: { accept: 'application/json' },
          cf: { cacheTtl: 1, cacheEverything: true }
        });
        const j = await r.json();
        const price = Number(j && j.data && j.data.amount);
        if (!Number.isFinite(price) || price <= 0) return json({ error: 'no_price', symbol }, 502);
        return json({ symbol, price, source: 'coinbase', ts: Date.now() }, 200,
          { 'cache-control': 'public, max-age=1', 'x-ost-spot': 'coinbase' });
      } catch (err) {
        return json({ error: 'spot_failed', message: String(err?.message || err).slice(0, 160) }, 502);
      }
    }

    // ── GET /bot/v1/info — machine-readable API index for AIs/bots/servers ──
    // CORS is * and all listed GETs are key-free, so agents, localhost scripts
    // and servers can integrate directly. This endpoint is the contract.
    if (path === '/bot/v1/info' && method === 'GET') {
      return json({
        ok: true,
        name: 'OST Bot API',
        version: 1,
        network: 'solana-devnet',
        mint: '383pTzoZ8Gp83dzk23ZnvLcfX2Sq32TAGN48CMQu2pAJ',
        app: 'https://ost-token.pages.dev',
        note: 'Devnet test tokens only — no real-money value. Read endpoints are public; rate-limit friendly (cache ~15s where marked).',
        endpoints: [
          { method: 'GET', path: '/bot/v1/info', desc: 'this API index' },
          { method: 'GET', path: '/health', desc: 'service health + BTC price + current 5-min round' },
          { method: 'GET', path: '/markets', desc: 'live OST-native prediction markets (BTC 5-min rounds)' },
          { method: 'GET', path: '/btc/round', desc: 'current server-authoritative BTC 5-min round' },
          { method: 'GET', path: '/btc/price', desc: 'live BTC spot used for rounds' },
          { method: 'GET', path: '/btc/ticks', desc: 'recent BTC tick history' },
          { method: 'GET', path: '/btc/history', desc: 'settled BTC 5-min round history' },
          { method: 'GET', path: '/positions/recent', desc: 'global recent bet feed (anonymized wallets)' },
          { method: 'GET', path: '/stocks/universe', desc: 'stock-mirror instrument list' },
          { method: 'GET', path: '/stocks/quotes', desc: 'stock-mirror live quotes' },
          { method: 'GET', path: '/launchpad/coins', desc: 'launchpad memecoin list + curves' },
          { method: 'GET', path: '/gamma/*', desc: 'Polymarket Gamma API relay (edge-cached 15s)' },
          { method: 'GET', path: '/clob/*', desc: 'Polymarket CLOB API relay (edge-cached 15s)' },
          { method: 'GET', path: '/data/*', desc: 'Polymarket data API relay (edge-cached 15s)' }
        ],
        realtime: {
          websocket: '/realtime/ws',
          desc: 'live prices, orders, wallet alerts, games (Durable Object hub)'
        },
        ts: Date.now()
      });
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
          'GET  /ost/price',
          'GET  /ost/stats',
          'GET  /ost/history',
          'POST /ost/event',
          'GET  /realtime/v1/health',
          'GET  /realtime/v1/ws',
          'POST /realtime/v1/publish',
          'GET  /realtime/v1/events',
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
      // Serve from the shared ~900ms round cache when possible — same DO-load
      // relief as /btc/round (see below).
      const cachedRound = globalThis.__ostRoundCache;
      if (cachedRound && Date.now() - cachedRound.ts < 900 && Number(cachedRound.data && cachedRound.data.livePrice) > 1000) {
        const c = cachedRound.data;
        return json({
          price: Number(c.livePrice), currency: 'USD',
          source: c.livePriceSource || c.source || 'ost-canonical',
          round: { id: c.id, openAt: c.openAt, closeAt: c.closeAt, msLeft: Math.max(0, Number(c.closeAt) - Date.now()) },
          canonical: true, ts: new Date(Number(c.livePriceTs) || Date.now()).toISOString()
        }, 200, { 'cache-control': 'no-store', 'x-ost-cache': 'isolate' });
      }
      const canonical = await getCanonicalBtcRound(env, { refresh: true });
      if (canonical && Number(canonical.livePrice) > 1000) {
        return json({
          price: Number(canonical.livePrice),
          currency: 'USD',
          source: canonical.livePriceSource || canonical.source || 'ost-canonical',
          round: {
            id: canonical.id,
            openAt: canonical.openAt,
            closeAt: canonical.closeAt,
            msLeft: canonical.msLeft
          },
          canonical: true,
          ts: new Date(Number(canonical.livePriceTs) || Date.now()).toISOString()
        }, 200, { 'cache-control': 'no-store' });
      }
      const result = await fetchBtcPrice();
      if (!result) {
        // Surface the cached latest so the chart doesn't go blank when a
        // single upstream blip happens — memory first, KV only if cold.
        const cached = memGet('btc:latest') || await kvGet(env, 'btc:latest', null);
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
    // PERF: every client polls this at ~1.5s and EVERY request used to
    // serialize through the single NativeMarketHub DO — under load the DO
    // queued, responses lagged past the client's 4.5s freshness window, and
    // the round UI froze/guessed. A ~900ms isolate cache means all users in
    // the same second share ONE DO round-trip; data is at most 0.9s old,
    // well inside the ws-tick cadence that keeps prices live between polls.
    if (path === '/btc/round' && method === 'GET') {
      const now = Date.now();
      if (globalThis.__ostRoundCache && now - globalThis.__ostRoundCache.ts < 900) {
        return json(globalThis.__ostRoundCache.data, 200, { 'cache-control': 'no-store', 'x-ost-cache': 'isolate' });
      }
      const refresh = url.searchParams.get('refresh') !== '0';
      const data = await getCanonicalBtcRound(env, { refresh });
      if (data && Number(data.closeAt) > now) globalThis.__ostRoundCache = { ts: now, data };
      return json(data, 200, { 'cache-control': 'no-store' });
    }

    // ── GET /btc/round-result ─ the authoritative settled snapshot for a round.
    // Public read of the DO's rollover snapshot (real close price + outcome).
    // Used by OSTG settlement internally and by the client to show settled
    // results. Returns { found:false } until the round has actually closed.
    if (path === '/btc/round-result' && method === 'GET') {
      const openAt = Math.floor(Number(url.searchParams.get('openAt') || 0) / FIVE_MIN_MS) * FIVE_MIN_MS;
      if (!(openAt > 0)) return json({ found: false, error: 'openAt_required' }, 400);
      const rr = await getBtcRoundResult(env, openAt);
      return json(rr || { found: false, openAt }, 200, { 'cache-control': 'no-store' });
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
      const hubTicks = await getCanonicalBtcTicks(env, round.openAt, since, { refresh: round.openAt === currentRound().openAt });
      if (hubTicks) return json(hubTicks, 200, { 'cache-control': 'no-store' });
      const ringKey = `btc:ticks:${round.openAt}`;
      let ring = await kvGet(env, ringKey, []);
      if (!Array.isArray(ring)) ring = [];
      const isCurrentRound = round.openAt === currentRound().openAt;
      const lastTick = ring.length ? ring[ring.length - 1] : null;
      if (isCurrentRound && (!ring.length || Date.now() - Number(lastTick && lastTick.t || 0) > 800)) {
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
      if (isCurrentRound && ring.length < 2) {
        const snapshot = await buildCanonicalBtcRound(env, { refresh: true });
        const openPrice = Number(snapshot && snapshot.openPrice);
        const livePrice = Number(snapshot && snapshot.livePrice) || openPrice;
        const liveTs = Number(snapshot && snapshot.livePriceTs) || Date.now();
        const synthetic = [];
        if (Number.isFinite(openPrice) && openPrice > 1000) {
          synthetic.push({ t: round.openAt, p: openPrice, s: snapshot.openPriceSource || 'binance-kline' });
        }
        if (Number.isFinite(livePrice) && livePrice > 1000) {
          synthetic.push({ t: Math.max(round.openAt + 1, liveTs), p: livePrice, s: snapshot.livePriceSource || snapshot.source || 'binance' });
        }
        if (synthetic.length) {
          const seen = new Set();
          ring = ring.concat(synthetic)
            .filter(t => Number.isFinite(Number(t && t.t)) && Number.isFinite(Number(t && t.p)) && Number(t.p) > 1000)
            .sort((a, b) => Number(a.t) - Number(b.t))
            .filter(t => {
              const key = `${Number(t.t)}:${Number(t.p)}`;
              if (seen.has(key)) return false;
              seen.add(key);
              return true;
            })
            .slice(-BTC_TICK_RING_MAX);
          await kvPut(env, ringKey, ring, 60 * 60 * 1);
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
      const data = await getCanonicalBtcRound(env, { refresh: true });
      return json({ ...data, ts: new Date().toISOString() }, 200, { 'cache-control': 'no-store' });
    }

    // ── POST /rounds/open-price ──────────────────────────────────────────────
    if (path === '/rounds/open-price' && method === 'POST') {
      let body;
      try { body = await request.json(); } catch (_) { return json({ error: 'invalid_json' }, 400); }
      const { openAt, openPrice } = body || {};
      if (!openAt || !Number.isFinite(Number(openPrice))) return json({ error: 'missing_fields', required: ['openAt', 'openPrice'] }, 400);
      const cleanOpenAt = Math.floor(Number(openAt) / FIVE_MIN_MS) * FIVE_MIN_MS;
      const round = { id: `ost-btc5m-${cleanOpenAt}`, openAt: cleanOpenAt, closeAt: cleanOpenAt + FIVE_MIN_MS, msLeft: Math.max(0, cleanOpenAt + FIVE_MIN_MS - Date.now()) };
      const existing = await kvGet(env, `round:${round.openAt}`, null);
      if (existing && Number.isFinite(Number(existing.openPrice)) && Number(existing.openPrice) > 0) {
        return json({ ok: true, openAt: round.openAt, openPrice: existing.openPrice, priceToBeat: existing.priceToBeat || existing.openPrice, source: existing.openPriceSource || 'locked', locked: true }, 200, { 'cache-control': 'no-store' });
      }
      const roundOpen = await fetchBtcRoundOpenPrice(round);
      const serverPrice = roundOpen && Number.isFinite(Number(roundOpen.price)) && Number(roundOpen.price) > 0
        ? Number(roundOpen.price)
        : Number(openPrice);
      const stored = await lockRoundOpenPrice(env, round, serverPrice, roundOpen && roundOpen.source || 'client-fallback');
      return json({ ok: true, openAt: round.openAt, openPrice: stored && stored.openPrice || serverPrice, priceToBeat: stored && stored.priceToBeat || serverPrice, source: stored && stored.openPriceSource || 'client-fallback', locked: true }, 200, { 'cache-control': 'no-store' });
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
      const active = await fetchActiveMarkets(env, limit);
      const raw = active.raw;
      if (!raw) return json({ error: 'upstream_failed', markets: [] }, 502, { 'cache-control': 'no-store' });
      const markets = (Array.isArray(raw) ? raw : raw.markets || []).map(normaliseMarket);
      return json({ markets, count: markets.length, stale: !!active.stale, source: active.source, cachedAt: active.cachedAt || null, ts: new Date().toISOString() },
        200, { 'cache-control': 'no-store' });
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
      const detail = await fetchMarketDetail(env, id);
      const gmkt = detail.raw;
      const [book, trades, history] = await Promise.all([
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
        stale: !!detail.stale,
        source: detail.source,
        cachedAt: detail.cachedAt || null,
        ts: new Date().toISOString()
      }, 200, { 'cache-control': 'no-store' });
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
      const limit = Math.min(200, Number(url.searchParams.get('limit') || 60));
      const marketIdFilter = cleanText(url.searchParams.get('marketId') || '', 128);
      if (!env.OST_KV) return json({ recent: [], note: 'KV not configured' });
      const hubMarketFilter = marketIdFilter === 'ost-btc5m' ? '' : marketIdFilter;
      const hubRows = await getNativeRecentPositionsFromHub(env, hubMarketFilter, limit);
      const recent = await kvGet(env, 'positions:recent', []);
      const rows = mergeRecentPositionRows((Array.isArray(hubRows) ? hubRows : []).concat(recent));
      const filteredRows = marketIdFilter
        ? rows.filter(record => recentPositionMatchesMarket(record, marketIdFilter))
        : rows;
      return json({ recent: filteredRows.slice(0, limit), marketId: marketIdFilter || null, ts: new Date().toISOString() }, 200, { 'cache-control': 'no-store' });
    }

    // ── Prediction-market comments ─ REAL per-market thread, Mesh-identity linked
    // A public append-only comment thread keyed by marketId. Every row is a real
    // OST wallet (identity = the connected wallet); the poster's Mesh handle is
    // carried through so the client can link a comment back to that user in the
    // OST Mesh social layer. Stored server-side (KV+D1), capped, flood-guarded.
    // Not money — eventual consistency is fine here.
    if (path === '/predict/comments' && method === 'GET') {
      const marketId = cleanText(url.searchParams.get('marketId') || '', 128);
      if (!marketId) return json({ error: 'marketId_required' }, 400);
      const list = await kvGet(env, `comments:${marketId}`, []);
      const rows = Array.isArray(list) ? list : [];
      return json({ comments: rows.slice(-120), marketId, count: rows.length }, 200, { 'cache-control': 'no-store' });
    }
    if (path === '/predict/comments' && method === 'POST') {
      let body;
      try { body = await request.json(); } catch (_) { return json({ error: 'invalid_json' }, 400); }
      const wallet = String((body && body.wallet) || '').slice(0, 64);
      const text = cleanText((body && body.text) || '', 280);
      const marketId = cleanText((body && body.marketId) || '', 128);
      if (!wallet || !text || !marketId) {
        return json({ error: 'missing_fields', required: ['wallet', 'marketId', 'text'] }, 400);
      }
      const handle = cleanText((body && body.handle) || '', 40);
      const key = `comments:${marketId}`;
      const existing = await kvGet(env, key, []);
      const arr = Array.isArray(existing) ? existing : [];
      // per-wallet flood guard: 1 comment / 5s
      for (let i = arr.length - 1; i >= 0; i--) {
        if (arr[i] && arr[i].wallet === wallet) {
          if (Date.now() - Number(arr[i].ts || 0) < 5000) return json({ error: 'slow_down' }, 429);
          break;
        }
      }
      const comment = {
        id: crypto.randomUUID(),
        wallet,
        walletShort: wallet.slice(0, 4) + '…' + wallet.slice(-4),
        handle: handle || (wallet.slice(0, 4) + '…' + wallet.slice(-4)),
        text,
        ts: Date.now()
      };
      arr.push(comment);
      await kvPut(env, key, arr.slice(-200));
      return json({ ok: true, comment });
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
      const sideUp = String(side).toUpperCase() === 'NO' ? 'NO' : 'YES';
      const nativeOpenPosition = nativeMarketStateBefore ? !positionIsClosed(body) : false;
      const nativeSellPosition = nativeMarketStateBefore ? positionIsSellCashout(body) : false;
      const nativeQuotePrice = nativeOpenPosition
        ? nativeTradePriceFromState(nativeMarketStateBefore, sideUp, 'buy')
        : nativeSellPosition
          ? nativeTradePriceFromState(nativeMarketStateBefore, sideUp, 'sell')
        : price;
      const inferredPrices = nativeOpenPosition
        ? inferBinaryPrices(side, nativeQuotePrice, nativeMarketStateBefore.yesPriceNumber, nativeMarketStateBefore.noPriceNumber)
        : nativeSellPosition
          ? inferBinaryPrices(side, nativeQuotePrice, null, null)
          : inferBinaryPrices(side, price, body.yesPrice, body.noPrice);
      let inferredShares = nativeOpenPosition
        ? (inferredPrices.price > 0 ? Number(stake) / inferredPrices.price : cleanNumber(body.shares))
        : cleanNumber(body.shares);
      if (nativeSellPosition && !(inferredShares > 0)) {
        inferredShares = cleanNumber(body.potentialReturn, 0) || cleanNumber(body.shares, 0) || 0;
      }
      const inferredPotentialReturn = nativeOpenPosition
        ? (inferredShares > 0 ? inferredShares : cleanNumber(body.potentialReturn))
        : cleanNumber(body.potentialReturn);
      const centralSellValue = nativeSellPosition && inferredShares > 0 && inferredPrices.price > 0
        ? inferredShares * inferredPrices.price
        : null;
      const reportedSellValue = cleanNumber(body.sellValue, null) ?? cleanNumber(body.cashoutOst, null);
      const safeSellValue = centralSellValue != null
        ? Math.max(0, Math.min(Number.isFinite(reportedSellValue) && reportedSellValue >= 0 ? reportedSellValue : centralSellValue, centralSellValue))
        : cleanNumber(body.sellValue);
      const nativeVaultTrade = !!nativeMarketStateBefore;
      const nativeQuoteAction = nativeSellPosition ? 'sell-bid' : nativeOpenPosition ? 'buy-ask' : '';
      const nativeSelectedBid = nativeVaultTrade ? nativeTradePriceFromState(nativeMarketStateBefore, sideUp, 'sell') : null;
      const nativeSelectedAsk = nativeVaultTrade ? nativeTradePriceFromState(nativeMarketStateBefore, sideUp, 'buy') : null;
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
        side: sideUp,
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
        cashoutOst: nativeSellPosition && safeSellValue != null ? safeSellValue : cleanNumber(body.cashoutOst),
        cashoutAt: cleanNumber(body.cashoutAt, 0),
        sellPrice: nativeSellPosition ? inferredPrices.price : cleanNumber(body.sellPrice),
        sellValue: nativeSellPosition && safeSellValue != null ? safeSellValue : cleanNumber(body.sellValue),
        finalYesPrice: nativeSellPosition && inferredPrices.yesPrice != null ? inferredPrices.yesPrice : cleanNumber(body.finalYesPrice),
        finalNoPrice: nativeSellPosition && inferredPrices.noPrice != null ? inferredPrices.noPrice : cleanNumber(body.finalNoPrice),
        resolvedAt: cleanNumber(body.resolvedAt, 0),
        nativeMarketMaker: nativeVaultTrade,
        counterparty: nativeVaultTrade ? 'ost-native-vault' : cleanText(body.counterparty || '', 64),
        liquidityProvider: nativeVaultTrade ? 'ost-native-market-maker' : cleanText(body.liquidityProvider || '', 64),
        shareIssuer: nativeOpenPosition ? 'ost-native-vault' : cleanText(body.shareIssuer || '', 64),
        shareRedeemer: nativeSellPosition ? 'ost-native-vault' : cleanText(body.shareRedeemer || '', 64),
        quoteAction: nativeQuoteAction || cleanText(body.quoteAction || '', 32),
        quoteModel: nativeVaultTrade ? 'ost-native-bid-ask-v2' : cleanText(body.quoteModel || '', 48),
        quotePrice: nativeVaultTrade ? inferredPrices.price : cleanNumber(body.quotePrice),
        askPrice: nativeSelectedAsk,
        bidPrice: nativeSelectedBid,
        vaultSpread: nativeVaultTrade ? cleanNumber(nativeMarketStateBefore.vaultSpread || nativeMarketStateBefore.vaultEdge, 0) : cleanNumber(body.vaultSpread),
        vaultEdge: nativeVaultTrade ? cleanNumber(nativeMarketStateBefore.vaultEdge || nativeMarketStateBefore.vaultSpread, 0) : cleanNumber(body.vaultEdge),
        vaultFlow: nativeOpenPosition ? 'share-sale' : nativeSellPosition ? 'share-buyback' : cleanText(body.vaultFlow || '', 48),
        vaultGrossInOst: nativeOpenPosition ? Number(stake) : 0,
        vaultGrossOutOst: nativeSellPosition && safeSellValue != null ? safeSellValue : 0,
        sharesCreated: nativeOpenPosition ? inferredShares : 0,
        sharesRedeemed: nativeSellPosition ? inferredShares : 0,
        syncedAt: Date.now()
      };
      // Per-wallet bucket (keep last 100, newest first)
      const walletKey = `positions:${wallet}`;
      const walletBucket = await kvGet(env, walletKey, []);
      await kvPut(env, walletKey, mergeNewest(walletBucket, record, 100));
      // Global recent feed (keep last 100)
      const recent = await kvGet(env, 'positions:recent', []);
      const flowRecord = recentFlowRecordForPosition(record);
      rememberRecentPositionHot(flowRecord);
      await kvPut(env, 'positions:recent', mergeNewest(recent, flowRecord, 100), 60 * 60 * 24 * 7);
      const marketState = await applyNativePositionToMarketState(env, record, nativeMarketStateBefore ? nativeMarketStateBefore.baseYesPrice : null);
      publishPositionRealtime(env, record, marketState, flowRecord);
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
        vaultFlow: cleanText(body.vaultFlow || '', 48),
        vault: cleanText(body.vault || '', 64),
        subKind: cleanText(body.subKind || '', 64),
        stake: cleanNumber(body.stake),
        retainedOst: cleanNumber(body.retainedOst),
        payoutOst: cleanNumber(body.payoutOst),
        linkedId: cleanText(body.linkedId || '', 160),
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
      publishWalletRealtime(env, record, {
        type: 'transaction.alert',
        title: record.label || record.kind || 'Wallet activity',
        message: record.amount ? String(record.label || record.kind) + ' +' + record.amount + ' ' + (record.token || 'OST') : String(record.label || record.kind)
      });
      return json({ ok: true, stored: true, record });
    }

    // ── LAUNCHPAD ─ pump.fun-style fair-launch coin registry ────────────────
    // Anyone can read; anyone can publish a coin or trade it on the bonding curve.
    // KV-backed so every visitor sees the same coins and their live mcap/curve.
    if (path === '/launchpad/coins' && method === 'GET') {
      if (!env.OST_KV) return json({ coins: [], note: 'KV not configured' });
      let coins = await kvGet(env, 'launchpad:coins', []);
      // Lazy-seed honest starter coins once, so a fresh registry isn't empty
      // but every number is still curve-real (zero trades = base mcap).
      if (!Array.isArray(coins) || coins.length === 0) {
        coins = lpStarterCoins();
        await kvPut(env, 'launchpad:coins', coins);
      }
      // Never leak internal holder ledgers to the public list; expose a count.
      const publicCoins = coins.map(c => {
        const holderCount = c.holders && typeof c.holders === 'object' ? Object.keys(c.holders).length : (Array.isArray(c.holders) ? c.holders.length : 0);
        const { holders, ...rest } = c;
        return { ...rest, holderCount };
      });
      return json({ coins: publicCoins, count: publicCoins.length, ts: new Date().toISOString() }, 200, { 'cache-control': 'public, max-age=2' });
    }
    if (path === '/launchpad/coins' && method === 'POST') {
      let body;
      try { body = await request.json(); } catch (_) { return json({ error: 'invalid_json' }, 400); }
      const { name, symbol, desc, image, twitter, telegram, website, creator, mcap, curve, supply } = body || {};
      if (!name || !symbol) return json({ error: 'missing_fields', required: ['name', 'symbol'] }, 400);
      if (!env.OST_KV) return json({ ok: true, stored: false, note: 'KV not configured' });
      // A new coin starts at ZERO tokens sold — its mcap is the honest curve
      // base, not an invented number. An optional creator "initial buy" moves
      // the curve for real (tokens credited to the creator's holder balance).
      const supplyN = Number(supply) || LP_DEFAULT_SUPPLY;
      const initialBuyOst = Math.max(0, Number(body.initialBuyOst) || 0);
      const creatorAddr = creator ? String(creator).slice(0, 64) : 'anon';
      const record = lpRecompute({
        id: crypto.randomUUID(),
        mint: 'ost' + crypto.randomUUID().replace(/-/g, '').slice(0, 40),
        name: String(name).slice(0, 64),
        symbol: String(symbol).toUpperCase().slice(0, 12),
        desc: String(desc || '').slice(0, 1000),
        image: image ? String(image).slice(0, 500_000) : null,
        twitter: twitter ? String(twitter).slice(0, 200) : null,
        telegram: telegram ? String(telegram).slice(0, 200) : null,
        website: website ? String(website).slice(0, 200) : null,
        creator: creatorAddr,
        supply: supplyN,
        tokensSold: 0,
        createdAt: Date.now(),
        trades: 0,
        holders: {}
      });
      if (initialBuyOst > 0) {
        const tok = Math.min(supplyN, lpTokensForOst(initialBuyOst, 0, supplyN));
        record.tokensSold = tok;
        record.holders[creatorAddr] = tok;
        record.trades = 1;
        lpRecompute(record);
      }
      const coins = (await kvGet(env, 'launchpad:coins', [])).slice(0, 199);
      coins.unshift(record);
      await kvPut(env, 'launchpad:coins', coins);
      const { holders: _hc, ...publicRecord } = record;
      publishRealtimeEvent(env, {
        type: 'launchpad.coin',
        public: true,
        channels: ['all', 'launchpad', channelForRealtime('launchpad', record.mint)],
        mint: record.mint,
        symbol: record.symbol,
        wallet: record.creator,
        title: '$' + record.symbol + ' launched',
        message: record.name + ' is live on OST Launchpad',
        payload: { coin: publicRecord }
      }).catch(() => {});
      return json({ ok: true, stored: true, coin: publicRecord });
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
      if (!(amt > 0)) return json({ error: 'bad_amount' }, 400);
      const supplyC = Number(c.supply) || LP_DEFAULT_SUPPLY;
      if (typeof c.tokensSold !== 'number') c.tokensSold = 0;
      if (!c.holders || typeof c.holders !== 'object' || Array.isArray(c.holders)) c.holders = {};
      const traderKey = cleanText(trader || '', 64) || 'anon';
      // REAL bonding curve. Buy: `amount` is OST in -> tokens minted on the
      // curve. Sell: `amount` is tokens -> OST refunded from the curve. The
      // holder ledger is authoritative: you cannot sell tokens you never held.
      let tradedTokens = 0, tradedOst = 0;
      if (side === 'buy') {
        if ((Number(c.curve) || 0) >= 100) return json({ error: 'graduated' }, 409);
        const s0 = c.tokensSold;
        let tokens = lpTokensForOst(amt, s0, supplyC);
        let ostSpent = amt;
        if (s0 + tokens > supplyC) { tokens = supplyC - s0; ostSpent = lpCurveCost(s0, supplyC, supplyC); }
        c.tokensSold = s0 + tokens;
        c.holders[traderKey] = (Number(c.holders[traderKey]) || 0) + tokens;
        tradedTokens = tokens; tradedOst = ostSpent;
      } else {
        const held = Number(c.holders[traderKey]) || 0;
        const tokens = Math.min(amt, held, c.tokensSold);
        if (!(tokens > 0)) return json({ error: 'no_balance', held }, 409);
        const s1 = c.tokensSold;
        const s0 = Math.max(0, s1 - tokens);
        const ostOut = lpCurveCost(s0, s1, supplyC);
        c.tokensSold = s0;
        c.holders[traderKey] = Math.max(0, held - tokens);
        if (c.holders[traderKey] < 1e-9) delete c.holders[traderKey];
        tradedTokens = tokens; tradedOst = ostOut;
      }
      c.trades = (c.trades || 0) + 1;
      c.lastTradeAt = Date.now();
      lpRecompute(c);
      coins[idx] = c;
      await kvPut(env, 'launchpad:coins', coins);
      const tickKey = `launchpad:ticks:${mint}`;
      const ticks = (await kvGet(env, tickKey, [])).slice(0, 199);
      const traderWallet = cleanText(trader || '', 64);
      const cleanSignature = cleanText(signature || body.sig || '', 128);
      ticks.unshift({ side, amount: amt, ost: Number(tradedOst.toFixed(6)), tokens: Number(tradedTokens.toFixed(4)), price: c.price, mcap: c.mcap, trader: traderWallet ? traderWallet.slice(0, 8) + '…' : 'anon', wallet: traderWallet, sig: cleanSignature, ts: Date.now() });
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
        publishWalletRealtime(env, event, { type: 'transaction.alert' });
      }
      publishRealtimeEvent(env, {
        type: 'launchpad.trade',
        public: true,
        channels: ['all', 'launchpad', channelForRealtime('launchpad', mint), traderWallet ? walletChannelForRealtime(traderWallet) : ''].filter(Boolean),
        mint,
        symbol: c.symbol,
        wallet: traderWallet,
        amount: amt,
        token: 'OST',
        title: '$' + c.symbol + ' trade',
        message: (side === 'sell' ? 'Sold for ' + tradedOst.toFixed(2) + ' OST' : 'Bought ' + tradedTokens.toFixed(0) + ' for ' + tradedOst.toFixed(2) + ' OST'),
        payload: { coin: (({ holders, ...rest }) => rest)(c), tick: ticks[0] }
      }).catch(() => {});
      // Public response: coin state without the holder ledger + this trade's
      // real fill and the trader's new balance.
      const { holders: _h, ...publicCoin } = c;
      return json({
        ok: true,
        coin: publicCoin,
        fill: { side, tokens: Number(tradedTokens.toFixed(4)), ost: Number(tradedOst.toFixed(6)), price: c.price },
        balance: Number((c.holders[traderKey] || 0).toFixed(4))
      });
    }
    // GET /launchpad/holdings/:wallet — a trader's real balances across coins.
    const lpHoldMatch = path.match(/^\/launchpad\/holdings\/([^/]+)$/);
    if (lpHoldMatch && method === 'GET') {
      if (!env.OST_KV) return json({ holdings: [] });
      const wallet = cleanText(decodeURIComponent(lpHoldMatch[1]), 64);
      const allCoins = await kvGet(env, 'launchpad:coins', []);
      const holdings = [];
      for (const c of allCoins) {
        const bal = c.holders && typeof c.holders === 'object' ? Number(c.holders[wallet]) : 0;
        if (bal > 1e-9) holdings.push({ mint: c.mint, symbol: c.symbol, name: c.name, tokens: Number(bal.toFixed(4)), price: c.price, value: Number((bal * c.price).toFixed(4)) });
      }
      return json({ wallet, holdings, ts: new Date().toISOString() });
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
      publishRealtimeEvent(env, {
        type: 'stock.order',
        public: true,
        channels: ['all', 'stock', channelForRealtime('stock', symbol), walletChannelForRealtime(wallet)].filter(Boolean),
        wallet,
        symbol,
        amount: order.ostStake,
        token: 'OST',
        title: symbol + ' mirror order',
        message: side.toUpperCase() + ' ' + symbol + ' for ' + order.ostStake + ' OST',
        payload: { order }
      }).catch(() => {});
      publishWalletRealtime(env, {
        id: order.id,
        wallet,
        kind: 'stock-mirror-order',
        amount: order.ostStake,
        sig: order.signature,
        label: order.side.toUpperCase() + ' ' + order.symbol + ' stock mirror',
        token: 'OST',
        marketId: order.symbol,
        ts: order.createdAt
      }, { type: 'transaction.alert' });
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
      if (!env.PURCHASE_LEDGER) return json({ error: 'purchase_ledger_not_configured' }, 503);

      // A payment can BUY OSTG (default) or REPAY A LOAN. Repayment is the same
      // money rail, but the settled funds retire debt instead of crediting a
      // spendable balance - so the purpose is recorded on the intent and the
      // credit path branches on it. Without this, paying a loan by card would
      // hand the user MORE OSTG instead of clearing what they owe.
      const purpose = (body.purpose === 'loan-repay') ? 'loan-repay' : 'buy-ostg';
      const loanId = purpose === 'loan-repay' ? cleanText(body.loanId, 96) : null;
      if (purpose === 'loan-repay' && !loanId) return json({ error: 'loan_required' }, 400);

      const intent = {
        id: crypto.randomUUID(),
        memo: shortMemo(),
        tier: legacyTier ? tierId : null,
        usd,
        usdPerOst: rate,
        ostAmount,
        wallet,
        method: method2,
        purpose,
        loanId,
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
      await ledgerOp(env, { op: 'ref.map', ref: session.id, intentId: intent.id });
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
                         (await ledgerOp(env, { op: 'ref.get', ref: session && session.id })).intentId;
        if (intentId) {
          const intent = await loadIntent(env, intentId);
          if (intent && intent.status === 'pending') {
            intent.status = 'paid';
            intent.paidAt = Date.now();
            intent.updatedAt = Date.now();
            intent.paymentRef = session.payment_intent || session.id;
            await saveIntent(env, intent);
            await pushQueue(env, intent.id);
            publishWalletRealtime(env, {
              id: intent.id,
              wallet: intent.wallet,
              kind: 'topup-paid',
              amount: intent.ostAmount,
              sig: intent.paymentRef,
              label: 'Payment verified; OST delivery queued',
              token: 'OST',
              ts: intent.paidAt
            }, {
              type: 'topup.paid',
              title: 'Payment verified',
              message: intent.ostAmount + ' OST delivery is queued'
            });
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
      if (!env.PURCHASE_LEDGER) return json({ error: 'purchase_ledger_not_configured' }, 503);
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

      await ledgerOp(env, { op: 'sent.push', row: {
        id: intent.id,
        ostAmount: intent.ostAmount,
        wallet: intent.wallet,
        signature: intent.signature,
        sentAt: intent.sentAt,
        deliveryKind: intent.deliveryKind
      } });
      publishWalletRealtime(env, {
        id: intent.id,
        wallet: intent.wallet,
        kind: 'topup-sent',
        amount: intent.ostAmount,
        sig: intent.signature,
        label: 'OST top-up delivered',
        token: 'OST',
        ts: intent.sentAt
      }, {
        type: 'topup.sent',
        title: 'Top-up delivered',
        message: '+' + intent.ostAmount + ' OST delivered'
      });
      return json({ ok: true, intent });
    }

    // Admin: list paid-but-not-sent intents (for the dispatcher).
    if (path === '/topup/admin/pending' && method === 'GET') {
      if (!adminAuthorized(request, env)) return json({ error: 'unauthorized' }, 401);
      const ids = (await ledgerOp(env, { op: 'queue.list' })).ids || [];
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
      await ledgerOp(env, { op: 'sent.push', row: { id: intent.id, ostAmount: intent.ostAmount, wallet: intent.wallet, signature: intent.signature, sentAt: intent.sentAt } });
      publishWalletRealtime(env, {
        id: intent.id,
        wallet: intent.wallet,
        kind: 'topup-sent',
        amount: intent.ostAmount,
        sig: intent.signature,
        label: 'OST top-up delivered',
        token: 'OST',
        ts: intent.sentAt
      }, {
        type: 'topup.sent',
        title: 'Top-up delivered',
        message: '+' + intent.ostAmount + ' OST delivered'
      });
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
      if (!env.PURCHASE_LEDGER) return json({ error: 'purchase_ledger_not_configured' }, 503);
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
      if (!env.PURCHASE_LEDGER) return json({ error: 'purchase_ledger_not_configured' }, 503);
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
      publishWalletRealtime(env, record, {
        type: stage === 'failure' ? 'payout.failure' : stage === 'result' ? 'payout.result' : 'payout.intent',
        title: stage === 'failure' ? 'Payout failed' : stage === 'result' ? 'Payout confirmed' : 'Payout started',
        message: stage === 'failure'
          ? (record.error || 'Payout failed')
          : (stage === 'result' ? '+' : '') + record.ostAmount + ' OST ' + record.kind
      });
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
        const active = await fetchActiveMarkets(env, limit);
        const raw = active.raw;
        const markets = (Array.isArray(raw) ? raw : raw?.markets || []).map(normaliseMarket);
        const btcRound = await getCanonicalBtcRound(env, { refresh: false });
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
        return json({ markets: ostNative.concat(markets), count: ostNative.length + markets.length, stale: !!active.stale, source: active.source, cachedAt: active.cachedAt || null, ts: new Date().toISOString() }, 200, { 'cache-control': 'no-store' });
      }

      const botMktMatch = sub.match(/^\/markets\/([^/]+)$/);
      if (botMktMatch && method === 'GET') {
        const id = decodeURIComponent(botMktMatch[1]);
        if (id.indexOf('ost-btc5m-') === 0) {
          const r = await getCanonicalBtcRound(env, { refresh: true });
          const state = await getNativeMarketState(env, id, r && r.yesPriceNumber);
          return json({ market: Object.assign({}, r, state, { marketState: state }), source: 'ost-native' }, 200, { 'cache-control': 'no-store' });
        }
        if (isOstNativeMarketId(id, 'ost-native')) {
          const state = await getNativeMarketState(env, id, url.searchParams.get('baseYes'));
          return json({ market: Object.assign({ id, source: 'ost-native', isOstNative: true, title: id }, state, { marketState: state }), source: 'ost-native' }, 200, { 'cache-control': 'no-store' });
        }
        const [detail, book] = await Promise.all([
          fetchMarketDetail(env, id),
          polyClob(env, '/book', `token_id=${encodeURIComponent(id)}`)
        ]);
        const gmkt = detail.raw;
        if (!gmkt) return json({ error: 'market_not_found', id }, 404);
        return json({ market: normaliseMarket(gmkt), book: book || null, source: 'polymarket', stale: !!detail.stale, cachedAt: detail.cachedAt || null, ts: new Date().toISOString() }, 200, { 'cache-control': 'no-store' });
      }

      if (sub === '/btc/round' && method === 'GET') {
        const r = await getCanonicalBtcRound(env, { refresh: true });
        return json(r, 200, { 'cache-control': 'no-store' });
      }

      const quoteMatch = sub.match(/^\/quote\/([^/]+)$/);
      if (quoteMatch && method === 'GET') {
        const id = decodeURIComponent(quoteMatch[1]);
        const side = (url.searchParams.get('side') || 'yes').toLowerCase() === 'no' ? 'NO' : 'YES';
        const stake = Math.max(0, Number(url.searchParams.get('stake')) || 0);
        let price = 0.5;
        if (isOstNativeMarketId(id, url.searchParams.get('source'))) {
          const r = await getNativeMarketState(env, id, url.searchParams.get('baseYes'));
          price = nativeTradePriceFromState(r, side, 'buy') || (side === 'NO' ? r.noPriceNumber : r.yesPriceNumber);
          const bidPrice = nativeTradePriceFromState(r, side, 'sell') || price;
          const shares = price > 0 ? stake / price : 0;
          return json({
            marketId: id,
            side,
            action: 'buy',
            price,
            askPrice: price,
            bidPrice,
            stake,
            shares,
            expectedPayout: shares,
            expectedCashoutValue: shares * bidPrice,
            expectedReturn: shares - stake,
            marketState: r,
            ts: new Date().toISOString()
          }, 200, { 'cache-control': 'no-store' });
        } else {
          const detail = await fetchMarketDetail(env, id);
          const gmkt = detail.raw;
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
          ? nativeTradePriceFromState(nativeMarketStateBefore, side, 'buy')
          : Number(body && body.price);
        if (!Number.isFinite(price) || price <= 0 || price >= 1) {
          if (marketId.indexOf('ost-btc5m-') === 0) {
            const r = await getCanonicalBtcRound(env, { refresh: true });
            price = side === 'NO' ? r.noPriceNumber : r.yesPriceNumber;
          } else {
            const detail = await fetchMarketDetail(env, marketId);
            const gmkt = detail.raw;
            if (!gmkt) return json({ error: 'market_not_found', marketId }, 404);
            const m = normaliseMarket(gmkt);
            price = side === 'NO' ? m.noPriceNumber : m.yesPriceNumber;
          }
        }
        const inferredPrices = nativeMarketStateBefore
          ? inferBinaryPrices(side, price, nativeMarketStateBefore.yesPriceNumber, nativeMarketStateBefore.noPriceNumber)
          : inferBinaryPrices(side, price, body && body.yesPrice, body && body.noPrice);
        price = inferredPrices.price;
        const nativeVaultTrade = !!nativeMarketStateBefore;
        const nativeSelectedBid = nativeVaultTrade ? nativeTradePriceFromState(nativeMarketStateBefore, side, 'sell') : null;
        const nativeSelectedAsk = nativeVaultTrade ? nativeTradePriceFromState(nativeMarketStateBefore, side, 'buy') : null;
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
          nativeMarketMaker: nativeVaultTrade,
          counterparty: nativeVaultTrade ? 'ost-native-vault' : cleanText(body.counterparty || '', 64),
          liquidityProvider: nativeVaultTrade ? 'ost-native-market-maker' : cleanText(body.liquidityProvider || '', 64),
          shareIssuer: nativeVaultTrade ? 'ost-native-vault' : cleanText(body.shareIssuer || '', 64),
          quoteAction: nativeVaultTrade ? 'buy-ask' : cleanText(body.quoteAction || '', 32),
          quoteModel: nativeVaultTrade ? 'ost-native-bid-ask-v2' : cleanText(body.quoteModel || '', 48),
          quotePrice: nativeVaultTrade ? price : cleanNumber(body.quotePrice),
          askPrice: nativeSelectedAsk,
          bidPrice: nativeSelectedBid,
          vaultSpread: nativeVaultTrade ? cleanNumber(nativeMarketStateBefore.vaultSpread || nativeMarketStateBefore.vaultEdge, 0) : cleanNumber(body.vaultSpread),
          vaultEdge: nativeVaultTrade ? cleanNumber(nativeMarketStateBefore.vaultEdge || nativeMarketStateBefore.vaultSpread, 0) : cleanNumber(body.vaultEdge),
          vaultFlow: nativeVaultTrade ? 'share-sale' : cleanText(body.vaultFlow || '', 48),
          vaultGrossInOst: nativeVaultTrade ? stake : 0,
          vaultGrossOutOst: 0,
          sharesCreated: nativeVaultTrade && price > 0 ? stake / price : 0,
          sharesRedeemed: 0,
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
        publishPositionRealtime(env, record, marketState, record);
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
        const side = String(order.side || body.side || 'YES').toUpperCase() === 'NO' ? 'NO' : 'YES';
        const nativeStateBefore = isOstNativeMarketId(order.marketId, order.source)
          ? await getNativeMarketState(env, order.marketId, order.baseYesPrice != null ? order.baseYesPrice : order.yesPrice)
          : null;
        const entryPrice = cleanProbability(order.price != null ? order.price : (side === 'NO' ? order.noPrice : order.yesPrice));
        const shares = Math.max(0, cleanNumber(order.shares, entryPrice > 0 ? cleanNumber(order.stake, 0) / entryPrice : 0) || 0);
        const bidPrice = nativeStateBefore ? nativeTradePriceFromState(nativeStateBefore, side, 'sell') : cleanProbability(body.sellPrice != null ? body.sellPrice : order.sellPrice);
        const serverPayout = bidPrice != null && shares > 0 ? shares * bidPrice : cleanNumber(order.potentialReturn, 0);
        const requestedPayout = cleanNumber(body.payoutOst, null);
        const payoutOst = Math.max(0, Math.min(Number.isFinite(requestedPayout) && requestedPayout >= 0 ? requestedPayout : serverPayout, serverPayout));
        order.status = 'cashed-out';
        order.cashedOut = true;
        order.cashoutKind = cleanText(body.cashoutKind || 'bot-cashout', 40);
        order.cashoutSig = cleanText(body.signature || '', 128);
        order.cashoutOst = payoutOst;
        order.cashoutAt = Date.now();
        order.resolvedAt = Date.now();
        if (bidPrice != null) {
          order.sellPrice = bidPrice;
          order.sellValue = payoutOst;
          order.finalYesPrice = side === 'YES' ? bidPrice : 1 - bidPrice;
          order.finalNoPrice = side === 'NO' ? bidPrice : 1 - bidPrice;
        }
        if (nativeStateBefore) {
          order.nativeMarketMaker = true;
          order.counterparty = 'ost-native-vault';
          order.liquidityProvider = 'ost-native-market-maker';
          order.shareRedeemer = 'ost-native-vault';
          order.quoteAction = 'sell-bid';
          order.quoteModel = 'ost-native-bid-ask-v2';
          order.quotePrice = bidPrice;
          order.bidPrice = bidPrice;
          order.vaultSpread = cleanNumber(nativeStateBefore.vaultSpread || nativeStateBefore.vaultEdge, 0);
          order.vaultEdge = cleanNumber(nativeStateBefore.vaultEdge || nativeStateBefore.vaultSpread, 0);
          order.vaultFlow = 'share-buyback';
          order.vaultGrossInOst = 0;
          order.vaultGrossOutOst = payoutOst;
          order.sharesCreated = 0;
          order.sharesRedeemed = shares;
        }
        walletBucket[idx] = order;
        await kvPut(env, walletKey, walletBucket);
        const marketState = await applyNativePositionToMarketState(env, order, order.yesPrice);
        const recent = await kvGet(env, 'positions:recent', []);
        const flowRecord = recentFlowRecordForPosition(order);
        await kvPut(env, 'positions:recent', mergeNewest(recent, flowRecord, 100), 60 * 60 * 24 * 7);
        publishPositionRealtime(env, order, marketState, flowRecord);
        return json({ ok: true, order, marketState, flowRecord: flowRecord !== order ? flowRecord : null }, 200, { 'cache-control': 'no-store' });
      }

      return json({ error: 'unknown_bot_endpoint', path, hint: 'GET /bot/v1/health for docs' }, 404);
    }

    return json({ error: 'not_found', message: 'Unknown endpoint. GET /health for the full endpoint list.' }, 404);
  }
};

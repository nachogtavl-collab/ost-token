/**
 * NativeMarketHub — Durable Object
 * ============================================================================
 * Single-globally-consistent source of truth for the OST 5-minute BTC market.
 *
 * Why a Durable Object (and not KV)?
 *   KV is eventually consistent at the edge: two users polling the same
 *   `/btc/round` endpoint from different colocations could get different
 *   yes/no quotes for several seconds. That is exactly the "stuck 50/50 /
 *   delayed live quote / recent ticks don't load" symptom we are fixing.
 *
 *   A Durable Object pins all writes/reads of the canonical BTC round state
 *   to a single instance, so every user gets the SAME ticks, the SAME open
 *   price and the SAME yes/no odds — fairly, in real-time.
 *
 * Endpoints (all consumed by the Worker fetch handler):
 *   GET  /snapshot     → current round + ticks + odds
 *   POST /poke         → force a refresh (bounded by minimum spacing)
 *
 * Storage layout:
 *   state            → { roundOpenAt, roundCloseAt, openPrice, openSource,
 *                        lastPrice, lastSource, lastFetchAt, ticks: [...] }
 *   round:<openAt>   → { openAt, closeAt, openPrice, closePrice, settledAt,
 *                        yesWon, tied }
 */

const FIVE_MIN_MS = 5 * 60 * 1000;
const TICK_MIN_GAP_MS = 600;
const TICK_MAX_GAP_MS = 4000;
const TICK_BUFFER = 240;
const FEED_TIMEOUT_MS = 3000;
const SNAPSHOT_CACHE_MS = 250;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type, accept, x-ost-wallet',
  'Access-Control-Max-Age': '86400'
};

const PRICE_FEEDS = [
  { name: 'binance', url: 'https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT', pick: j => j && Number(j.price) },
  { name: 'binance-vision', url: 'https://data-api.binance.vision/api/v3/ticker/price?symbol=BTCUSDT', pick: j => j && Number(j.price) },
  { name: 'coinbase', url: 'https://api.coinbase.com/v2/prices/BTC-USD/spot', pick: j => j && j.data && Number(j.data.amount) },
  { name: 'kraken', url: 'https://api.kraken.com/0/public/Ticker?pair=XBTUSD', pick: j => {
    try { const k = Object.keys(j && j.result || {})[0]; return Number(j.result[k].c[0]); } catch (_) { return NaN; }
  } }
];

const KLINE_URLS = [
  'https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=5m&limit=1',
  'https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=5m&limit=1'
];

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...CORS_HEADERS
    }
  });
}

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function currentBoundaries(now) {
  const t = now || Date.now();
  const openAt = Math.floor(t / FIVE_MIN_MS) * FIVE_MIN_MS;
  return { openAt, closeAt: openAt + FIVE_MIN_MS };
}

async function fetchWithTimeout(url, ms) {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const id = controller ? setTimeout(() => controller.abort(), ms) : null;
  try {
    const r = await fetch(url, {
      headers: { accept: 'application/json', 'user-agent': 'OST-NativeMarketHub/1.0' },
      cf: { cacheTtl: 1, cacheEverything: false },
      signal: controller ? controller.signal : undefined
    });
    return r;
  } finally {
    if (id) clearTimeout(id);
  }
}

async function fetchSpotPrice() {
  for (const feed of PRICE_FEEDS) {
    try {
      const r = await fetchWithTimeout(feed.url, FEED_TIMEOUT_MS);
      if (!r.ok) continue;
      const j = await r.json();
      const price = feed.pick(j);
      if (Number.isFinite(price) && price > 1000) {
        return { price, source: feed.name, ts: Date.now() };
      }
    } catch (_) { /* try next */ }
  }
  return null;
}

async function fetchRoundOpenFromKline(expectedOpenAt) {
  for (const url of KLINE_URLS) {
    try {
      const r = await fetchWithTimeout(url, FEED_TIMEOUT_MS);
      if (!r.ok) continue;
      const payload = await r.json();
      const row = Array.isArray(payload) && Array.isArray(payload[0]) ? payload[0] : null;
      if (!row) continue;
      const openAt = Number(row[0]);
      const openPrice = Number(row[1]);
      if (!Number.isFinite(openPrice) || openPrice <= 1000) continue;
      if (Number.isFinite(expectedOpenAt) && Math.abs(openAt - expectedOpenAt) > 1000) continue;
      return {
        openAt,
        openPrice,
        source: url.indexOf('binance.vision') >= 0 ? 'binance-vision-kline' : 'binance-kline'
      };
    } catch (_) { /* try next */ }
  }
  return null;
}

function estimateVolatilityPct(ticks) {
  const cutoff = Date.now() - 45000;
  const recent = ticks.filter(t => t.ts >= cutoff && t.price > 0);
  if (recent.length < 3) return 0.025;
  const returns = [];
  for (let i = 1; i < recent.length; i += 1) {
    const prev = recent[i - 1].price;
    const next = recent[i].price;
    if (prev > 0 && next > 0) returns.push(Math.abs((next - prev) / prev) * 100);
  }
  if (!returns.length) return 0.025;
  const avg = returns.reduce((s, v) => s + v, 0) / returns.length;
  const prices = recent.map(t => t.price);
  const span = ((Math.max.apply(null, prices) - Math.min.apply(null, prices)) / recent[recent.length - 1].price) * 100;
  return Math.max(0.018, Math.min(0.45, avg * 8 + span * 0.55));
}

function estimateMomentumPct(ticks) {
  if (ticks.length < 2) return 0;
  const latest = ticks[ticks.length - 1];
  const cutoff = latest.ts - 15000;
  let anchor = ticks[0];
  for (let i = ticks.length - 1; i >= 0; i -= 1) {
    if (ticks[i].ts <= cutoff) { anchor = ticks[i]; break; }
  }
  if (!anchor || !anchor.price || !latest.price) return 0;
  return ((latest.price - anchor.price) / anchor.price) * 100;
}

function computeOdds(openPrice, livePrice, boundaries, ticks) {
  let yes = 0.5;
  const hasPrices = Number(openPrice) > 0 && Number(livePrice) > 0;
  const delta = hasPrices ? Number(livePrice) - Number(openPrice) : NaN;
  const deltaPct = hasPrices ? (delta / openPrice) * 100 : 0;
  const volatilityPct = estimateVolatilityPct(ticks);
  const momentumPct = estimateMomentumPct(ticks);
  if (hasPrices) {
    const msLeft = clampNumber(boundaries.closeAt - Date.now(), 0, FIVE_MIN_MS);
    const timeLeftRatio = msLeft / FIVE_MIN_MS;
    const scale = Math.max(0.012, volatilityPct * Math.sqrt(Math.max(timeLeftRatio, 0.08)) * 2.4);
    const score = clampNumber((deltaPct + momentumPct * 0.22) / scale, -4.5, 4.5);
    yes = 1 / (1 + Math.exp(-score));
    const confidence = 0.70 + (1 - timeLeftRatio) * 0.25;
    yes = 0.5 + (yes - 0.5) * confidence;
    if (Math.abs(delta) < 0.25) yes = 0.5 + (yes - 0.5) * 0.35;
    yes = clampNumber(yes, 0.03, 0.97);
  }
  return { yes, no: 1 - yes, delta, deltaPct, volatilityPct, momentumPct };
}

export class NativeMarketHub {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.cachedSnapshot = null;
    this.cachedSnapshotAt = 0;
    this.refreshInFlight = null;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, '') || '/';
    const method = request.method;
    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
    try {
      if (path === '/snapshot' && method === 'GET') {
        return jsonResponse(await this.snapshot());
      }
      if (path === '/poke' && method === 'POST') {
        return jsonResponse(await this.snapshot({ force: true }));
      }
      return jsonResponse({ error: 'unknown_endpoint', path }, 404);
    } catch (error) {
      return jsonResponse({ error: 'native_market_hub_failed', message: String(error && error.message || error) }, 500);
    }
  }

  async loadState() {
    const stored = await this.state.storage.get('state');
    return stored || {
      roundOpenAt: 0,
      roundCloseAt: 0,
      openPrice: 0,
      openSource: '',
      lastPrice: 0,
      lastSource: '',
      lastFetchAt: 0,
      ticks: []
    };
  }

  async saveState(s) {
    await this.state.storage.put('state', s);
  }

  async snapshot(opts) {
    const force = !!(opts && opts.force);
    const now = Date.now();
    if (!force && this.cachedSnapshot && now - this.cachedSnapshotAt < SNAPSHOT_CACHE_MS) {
      return this.cachedSnapshot;
    }
    if (this.refreshInFlight) {
      try { await this.refreshInFlight; } catch (_) {}
    } else {
      this.refreshInFlight = this.refresh(force).catch(() => null);
      try { await this.refreshInFlight; } finally { this.refreshInFlight = null; }
    }
    const snap = await this.buildSnapshot();
    this.cachedSnapshot = snap;
    this.cachedSnapshotAt = Date.now();
    return snap;
  }

  async refresh(force) {
    return this.state.blockConcurrencyWhile(async () => {
      const st = await this.loadState();
      const now = Date.now();
      const boundaries = currentBoundaries(now);
      const rolledOver = st.roundOpenAt !== boundaries.openAt;
      if (rolledOver) {
        // Settle previous round if any
        if (st.roundOpenAt && st.openPrice > 0 && st.lastPrice > 0) {
          const closePrice = st.lastPrice;
          const yesWon = closePrice > st.openPrice;
          const tied = closePrice === st.openPrice;
          await this.state.storage.put(`round:${st.roundOpenAt}`, {
            openAt: st.roundOpenAt,
            closeAt: st.roundCloseAt,
            openPrice: st.openPrice,
            closePrice,
            closeSource: st.lastSource || '',
            settledAt: now,
            yesWon,
            tied
          });
        }
        st.roundOpenAt = boundaries.openAt;
        st.roundCloseAt = boundaries.closeAt;
        st.openPrice = 0;
        st.openSource = '';
        st.ticks = [];
      }
      // Resolve open price from Binance kline if missing
      if (!st.openPrice || st.openPrice <= 1000) {
        const kline = await fetchRoundOpenFromKline(boundaries.openAt);
        if (kline) {
          st.openPrice = kline.openPrice;
          st.openSource = kline.source;
        }
      }
      const sinceLast = now - (st.lastFetchAt || 0);
      if (force || sinceLast >= TICK_MIN_GAP_MS) {
        const tick = await fetchSpotPrice();
        if (tick) {
          st.lastPrice = tick.price;
          st.lastSource = tick.source;
          st.lastFetchAt = tick.ts;
          // Append tick if it's been long enough since last recorded tick
          const lastTick = st.ticks.length ? st.ticks[st.ticks.length - 1] : null;
          if (!lastTick || tick.ts - lastTick.ts >= TICK_MIN_GAP_MS) {
            st.ticks.push({ ts: tick.ts, price: tick.price, source: tick.source });
            if (st.ticks.length > TICK_BUFFER) st.ticks = st.ticks.slice(-TICK_BUFFER);
          }
          // Backfill open price from current tick if kline failed and we're early in round
          if ((!st.openPrice || st.openPrice <= 1000) && (now - boundaries.openAt) < 2500) {
            st.openPrice = tick.price;
            st.openSource = tick.source + '-fallback';
          }
        } else if (sinceLast > TICK_MAX_GAP_MS) {
          // No price available this cycle; mark stale by leaving lastFetchAt unchanged
        }
      }
      await this.saveState(st);
    });
  }

  async buildSnapshot() {
    const st = await this.loadState();
    const boundaries = currentBoundaries();
    const odds = computeOdds(st.openPrice, st.lastPrice, boundaries, st.ticks || []);
    const settled = await this.state.storage.list({ prefix: 'round:', reverse: true, limit: 6 });
    const settledRounds = [];
    settled.forEach(value => settledRounds.push(value));
    return {
      ok: true,
      ts: Date.now(),
      hubBuild: 'nmh-v2-2026-05-15-flat',
      round: {
        id: `ost-btc5m-${boundaries.openAt}`,
        openAt: boundaries.openAt,
        closeAt: boundaries.closeAt,
        msLeft: Math.max(0, boundaries.closeAt - Date.now())
      },
      openPrice: st.openPrice || 0,
      openSource: st.openSource || '',
      livePrice: st.lastPrice || 0,
      liveSource: st.lastSource || '',
      liveTs: st.lastFetchAt || 0,
      yesPriceNumber: odds.yes,
      noPriceNumber: odds.no,
      delta: Number.isFinite(odds.delta) ? odds.delta : 0,
      deltaPct: Number.isFinite(odds.deltaPct) ? odds.deltaPct : 0,
      momentumPct: odds.momentumPct,
      volatilityPct: odds.volatilityPct,
      ticks: (st.ticks || []).slice(-120),
      settledRounds
    };
  }
}

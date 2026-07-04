// ── OST Live Price (devnet) ──────────────────────────────────────────────────
// Network-weighted synthetic price for OST on devnet.
//
//   P(t) = P0 * N(t) * V(t) * M(t)
//
//   P0   = anchor                       ($0.10)
//   N(t) = 1 + α·ln(1+W) + β·ln(1+T) + γ·ln(1+Vol24h)   (network demand, log-bounded)
//   V(t) = mean-reverting random walk   (±2%, deterministic per-tick seed)
//   M(t) = 1 + 0.01·btc24hPct           (BTC mood, clamped [0.9, 1.1])
//
// W = unique wallets active in last 24h
// T = transactions in last 24h
// Vol24h = total OST volume moved in last 24h
//
// Floor ≈ $0.10 * 1 * 0.98 * 0.9 = $0.0882
// Ceiling = unbounded (log growth — hundreds of users to move it 50%)
//
// Storage: Cloudflare KV (binding OST_KV).
//   ost:counters  → { wallets24h: { addr: lastTs }, tx24h: [{ ts, type, volume }] }
//   ost:history   → ring of 1-min OHLC candles, last 1440 entries (24h)
//                   shape: { ts, open, high, low, close, n }
//
// KV writes only on /ost/event POSTs. BTC 24h ticker is fetched with 60s
// edge-cache so /ost/price stays fast.

// ── local helpers (kept self-contained; no coupling to index.js) ────────────
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type, accept, x-ost-wallet'
};
function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...CORS, ...extra }
  });
}
async function kvGet(env, key, fallback = null) {
  if (!env.OST_KV) return fallback;
  try { const v = await env.OST_KV.get(key, { type: 'json' }); return v ?? fallback; }
  catch (_) { return fallback; }
}
async function kvPut(env, key, value, expirationTtl = null) {
  if (!env.OST_KV) return false;
  try {
    const opts = Number.isFinite(Number(expirationTtl)) && Number(expirationTtl) > 0
      ? { expirationTtl: Number(expirationTtl) } : undefined;
    await env.OST_KV.put(key, JSON.stringify(value), opts);
    return true;
  } catch (_) { return false; }
}
function cleanText(value, max = 200) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

// ── tuning constants ────────────────────────────────────────────────────────
const OST_ANCHOR        = 0.10;
const OST_VOL_BAND      = 0.02;        // ±2%
const OST_TICK_MS       = 5000;        // volatility tick = 5s
const OST_HISTORY_MAX   = 1440;        // 24h at 1-min snapshots
const OST_HISTORY_MS    = 60_000;      // 1-min bucket cadence
const OST_WINDOW_MS     = 24 * 60 * 60 * 1000;
const OST_EVENT_MAX     = 5000;        // hard cap on tx24h array

const ALPHA = 0.05;   // active wallets weight
const BETA  = 0.05;   // tx count weight
const GAMMA = 0.05;   // volume weight

// BTC mood — pct here means percent points (e.g. -1.5 for -1.5%).
// MOOD_PER_PCT = 0.01 means a ±10% BTC day saturates the [0.9, 1.1] band.
const MOOD_PER_PCT = 0.01;
const MOOD_FLOOR   = 0.90;
const MOOD_CEIL    = 1.10;
const BTC_MOOD_CACHE_TTL_S = 60;

const ALLOWED_EVENT_TYPES = new Set([
  'faucet', 'send', 'cashout', 'game_win', 'game_loss', 'swap', 'topup', 'other'
]);

// ── deterministic PRNG (mulberry32) ─────────────────────────────────────────
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function tickNoise(tickIndex) {
  return (mulberry32(tickIndex)() - 0.5) * 2 * OST_VOL_BAND;
}

// Linear interp between two adjacent tick noises so the line is continuous.
function volMultiplier(ts) {
  const t = ts / OST_TICK_MS;
  const i = Math.floor(t);
  const f = t - i;
  const a = tickNoise(i);
  const b = tickNoise(i + 1);
  return 1 + a * (1 - f) + b * f;
}

// ── counters ────────────────────────────────────────────────────────────────
function emptyCounters() { return { wallets24h: {}, tx24h: [] }; }

function pruneCounters(counters, now) {
  const cutoff = now - OST_WINDOW_MS;
  const wallets = {};
  for (const [addr, lastTs] of Object.entries(counters.wallets24h || {})) {
    if (Number(lastTs) >= cutoff) wallets[addr] = Number(lastTs);
  }
  let tx = (counters.tx24h || []).filter(e => Number(e.ts) >= cutoff);
  if (tx.length > OST_EVENT_MAX) tx = tx.slice(-OST_EVENT_MAX);
  return { wallets24h: wallets, tx24h: tx };
}

function networkFactor(counters) {
  const W = Object.keys(counters.wallets24h || {}).length;
  const tx = counters.tx24h || [];
  const T = tx.length;
  const V = tx.reduce((s, e) => s + Math.max(0, Number(e.volume) || 0), 0);
  const n = 1 + ALPHA * Math.log(1 + W) + BETA * Math.log(1 + T) + GAMMA * Math.log(1 + V);
  return Math.max(1, n);
}

function btcMood(pct) {
  if (!Number.isFinite(pct)) return 1.0;
  return Math.max(MOOD_FLOOR, Math.min(MOOD_CEIL, 1 + pct * MOOD_PER_PCT));
}

// ── BTC 24h change (with 60s edge cache) ────────────────────────────────────
const BTC_24H_FEEDS = [
  {
    name: 'binance',
    url: 'https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT',
    pick: j => Number(j?.priceChangePercent)
  },
  {
    name: 'binance-vision',
    url: 'https://data-api.binance.vision/api/v3/ticker/24hr?symbol=BTCUSDT',
    pick: j => Number(j?.priceChangePercent)
  }
];

async function fetchBtc24hChangePct() {
  for (const feed of BTC_24H_FEEDS) {
    try {
      const r = await fetch(feed.url, {
        headers: { accept: 'application/json', 'user-agent': 'OST-API/1.0' },
        cf: { cacheTtl: BTC_MOOD_CACHE_TTL_S, cacheEverything: true }
      });
      if (!r.ok) continue;
      const j = await r.json();
      const v = feed.pick(j);
      if (Number.isFinite(v) && Math.abs(v) < 100) return { pct: v, source: feed.name };
    } catch (_) { /* try next */ }
  }
  return null;
}

// ── price computation (pure) ────────────────────────────────────────────────
function computePrice(counters, ts, mood = 1.0) {
  const n = networkFactor(counters);
  const v = volMultiplier(ts);
  const raw = OST_ANCHOR * n * v * mood;
  return Math.max(OST_ANCHOR * 0.5, raw);
}

function change24hPct(counters, nowPrice, ts, mood) {
  const prevTs = ts - OST_WINDOW_MS;
  const tx24hAtThen = (counters.tx24h || []).filter(e => Number(e.ts) < prevTs);
  const walletsAtThen = {};
  for (const [addr, lastTs] of Object.entries(counters.wallets24h || {})) {
    if (Number(lastTs) < prevTs) walletsAtThen[addr] = Number(lastTs);
  }
  const prevPrice = computePrice({ wallets24h: walletsAtThen, tx24h: tx24hAtThen }, prevTs, mood);
  if (!Number.isFinite(prevPrice) || prevPrice <= 0) return 0;
  return ((nowPrice - prevPrice) / prevPrice) * 100;
}

// ── OHLC candle helpers ─────────────────────────────────────────────────────
function bucketHighLow(counters, bucketStart, bucketEndExclusive, mood) {
  const n = networkFactor(counters);
  let hi = -Infinity, lo = Infinity;
  for (let t = bucketStart; t < bucketEndExclusive; t += OST_TICK_MS) {
    const p = OST_ANCHOR * n * volMultiplier(t) * mood;
    if (p > hi) hi = p;
    if (p < lo) lo = p;
  }
  const floor = OST_ANCHOR * 0.5;
  return { high: Math.max(hi, floor), low: Math.max(lo, floor) };
}

function normalizeHistoryEntry(p) {
  if (p && p.open != null) return p;
  const price = Number(p?.price) || 0;
  return { ts: Number(p?.ts) || 0, open: price, high: price, low: price, close: price, n: Number(p?.n) || 1 };
}

async function loadHistory(env) {
  const raw = (await kvGet(env, 'ost:history', [])) || [];
  return raw.map(normalizeHistoryEntry);
}

async function updateHistoryOnEvent(env, counters, mood, now) {
  const history = await loadHistory(env);
  const bucketStart = Math.floor(now / OST_HISTORY_MS) * OST_HISTORY_MS;
  const livePrice = computePrice(counters, now, mood);
  const last = history.length ? history[history.length - 1] : null;

  if (last && last.ts === bucketStart) {
    last.close = Number(livePrice.toFixed(8));
    last.high  = Number(Math.max(last.high, livePrice).toFixed(8));
    last.low   = Number(Math.min(last.low,  livePrice).toFixed(8));
    last.n     = Number(networkFactor(counters).toFixed(6));
  } else {
    const opened = computePrice(counters, bucketStart, mood);
    const { high, low } = bucketHighLow(counters, bucketStart, now + 1, mood);
    history.push({
      ts: bucketStart,
      open: Number(opened.toFixed(8)),
      high: Number(Math.max(high, opened, livePrice).toFixed(8)),
      low:  Number(Math.min(low,  opened, livePrice).toFixed(8)),
      close: Number(livePrice.toFixed(8)),
      n: Number(networkFactor(counters).toFixed(6))
    });
  }
  while (history.length > OST_HISTORY_MAX) history.shift();
  await kvPut(env, 'ost:history', history);
  return history;
}

// ── router ──────────────────────────────────────────────────────────────────
export async function handleOstPriceRequest(request, env, ctx) {
  const { path, method, url } = ctx;

  if (path === '/ost/price' && method === 'GET') {
    const now = Date.now();
    const counters = pruneCounters((await kvGet(env, 'ost:counters', emptyCounters())) || emptyCounters(), now);
    const btc = await fetchBtc24hChangePct();
    const mood = btcMood(btc?.pct);
    const price = computePrice(counters, now, mood);
    const change = change24hPct(counters, price, now, mood);
    return json({
      price: Number(price.toFixed(8)),
      currency: 'USD',
      anchor: OST_ANCHOR,
      change24h: Number(change.toFixed(4)),
      btcChange24h: btc ? Number(btc.pct.toFixed(4)) : null,
      btcMood: Number(mood.toFixed(6)),
      source: 'ost-devnet-synthetic',
      model: 'P0 * N(t) * V(t) * M(t)',
      ts: new Date(now).toISOString()
    }, 200, { 'cache-control': 'no-store' });
  }

  if (path === '/ost/stats' && method === 'GET') {
    const now = Date.now();
    const counters = pruneCounters((await kvGet(env, 'ost:counters', emptyCounters())) || emptyCounters(), now);
    const btc = await fetchBtc24hChangePct();
    const mood = btcMood(btc?.pct);
    const W = Object.keys(counters.wallets24h).length;
    const T = counters.tx24h.length;
    const V = counters.tx24h.reduce((s, e) => s + Math.max(0, Number(e.volume) || 0), 0);
    const n = networkFactor(counters);
    const v = volMultiplier(now);
    const price = computePrice(counters, now, mood);
    return json({
      ts: new Date(now).toISOString(),
      anchor: OST_ANCHOR,
      activeWallets24h: W,
      tx24h: T,
      volume24h: Number(V.toFixed(8)),
      networkFactor: Number(n.toFixed(6)),
      volMultiplier: Number(v.toFixed(6)),
      btcChange24h: btc ? Number(btc.pct.toFixed(4)) : null,
      btcMoodSource: btc?.source || null,
      btcMood: Number(mood.toFixed(6)),
      price: Number(price.toFixed(8)),
      weights: { alpha: ALPHA, beta: BETA, gamma: GAMMA, moodPerPct: MOOD_PER_PCT },
      volBand: OST_VOL_BAND,
      moodBand: [MOOD_FLOOR, MOOD_CEIL],
      tickMs: OST_TICK_MS,
      bucketMs: OST_HISTORY_MS
    }, 200, { 'cache-control': 'no-store' });
  }

  if (path === '/ost/history' && method === 'GET') {
    const range = String(url.searchParams.get('range') || '24h').toLowerCase();
    const now = Date.now();
    const cutoffMs = range === '1h' ? 60 * 60 * 1000
      : range === '7d' ? 7 * 24 * 60 * 60 * 1000
      : 24 * 60 * 60 * 1000;
    const cutoff = now - cutoffMs;
    const counters = pruneCounters((await kvGet(env, 'ost:counters', emptyCounters())) || emptyCounters(), now);
    const btc = await fetchBtc24hChangePct();
    const mood = btcMood(btc?.pct);

    const history = (await loadHistory(env)).filter(p => Number(p.ts) >= cutoff);
    const bucketStart = Math.floor(now / OST_HISTORY_MS) * OST_HISTORY_MS;
    const opened = computePrice(counters, bucketStart, mood);
    const livePrice = computePrice(counters, now, mood);
    const { high, low } = bucketHighLow(counters, bucketStart, now + 1, mood);
    const live = {
      ts: bucketStart,
      open: Number(opened.toFixed(8)),
      high: Number(Math.max(high, opened, livePrice).toFixed(8)),
      low:  Number(Math.min(low,  opened, livePrice).toFixed(8)),
      close: Number(livePrice.toFixed(8)),
      n: Number(networkFactor(counters).toFixed(6)),
      inProgress: true
    };
    if (history.length && history[history.length - 1].ts === bucketStart) {
      history[history.length - 1] = { ...history[history.length - 1], ...live };
    } else {
      history.push(live);
    }

    return json({
      range,
      points: history,
      count: history.length,
      shape: 'OHLC',
      ts: new Date(now).toISOString()
    }, 200, { 'cache-control': 'no-store' });
  }

  if (path === '/ost/event' && method === 'POST') {
    let body = {};
    try { body = await request.json(); } catch (_) {}
    const wallet = cleanText(body.wallet || '', 80);
    const type = cleanText(body.type || 'other', 24);
    const volume = Math.max(0, Math.min(1e12, Number(body.volume) || 0));
    if (!wallet) return json({ error: 'missing_wallet' }, 400);
    if (!ALLOWED_EVENT_TYPES.has(type)) return json({ error: 'invalid_type', type }, 400);

    const now = Date.now();
    const counters = pruneCounters((await kvGet(env, 'ost:counters', emptyCounters())) || emptyCounters(), now);
    counters.wallets24h[wallet] = now;
    counters.tx24h.push({ ts: now, type, volume });
    if (counters.tx24h.length > OST_EVENT_MAX) counters.tx24h = counters.tx24h.slice(-OST_EVENT_MAX);

    // ── KV write COALESCING ─────────────────────────────────────────────
    // Free-tier KV is 1000 writes/day. Writing counters+history on EVERY
    // event exhausted the daily budget (and broke mesh chat, which shares
    // the account write quota). We now persist counters at most once per
    // COUNTER_WRITE_GAP_MS, and history only when its minute bucket rolls.
    const COUNTER_WRITE_GAP_MS = 20000;
    const bucketStart = Math.floor(now / OST_HISTORY_MS) * OST_HISTORY_MS;
    const lastWrite = Number(counters._lastWriteTs || 0);
    const lastBucket = Number(counters._lastBucket || 0);
    const btc = await fetchBtc24hChangePct();
    const mood = btcMood(btc?.pct);

    const bucketRolled = bucketStart !== lastBucket;
    if (bucketRolled || (now - lastWrite) >= COUNTER_WRITE_GAP_MS) {
      counters._lastWriteTs = now;
      counters._lastBucket = bucketStart;
      await kvPut(env, 'ost:counters', counters);
      await updateHistoryOnEvent(env, counters, mood, now);
    }
    // else: event is still counted in-memory for THIS response; it will be
    // persisted by the next event that crosses the write gap. Approximate
    // stats, exact-enough price, and the write budget survives the day.

    const price = computePrice(counters, now, mood);
    return json({
      ok: true,
      accepted: { wallet, type, volume },
      price: Number(price.toFixed(8)),
      btcMood: Number(mood.toFixed(6)),
      activeWallets24h: Object.keys(counters.wallets24h).length,
      tx24h: counters.tx24h.length,
      ts: new Date(now).toISOString()
    }, 200, { 'cache-control': 'no-store' });
  }

  return null;
}

// ── OST Live Price (devnet) ──────────────────────────────────────────────────
// Network-weighted synthetic price for OST on devnet.
//
//   P(t) = P0 * N(t) * V(t) * M(t)
//
//   P0   = anchor                       ($0.10)
//   N(t) = 1 + α·ln(1+W) + β·ln(1+T) + γ·ln(1+Vol24h)   (network demand, log-bounded)
//   V(t) = mean-reverting random walk   (±2%, deterministic per-tick seed)
//   M(t) = 1 + δ·btc24hPct              (BTC mood — stubbed at 1.0 for step 1)
//
// W = unique wallets active in last 24h
// T = transactions in last 24h
// Vol24h = total OST volume moved in last 24h
//
// Floor ≈ $0.10 * 1 * 0.98 * 0.9 = $0.0882
// Ceiling = unbounded (log growth — hundreds of users to move it 50%)
//
// Storage: Cloudflare KV (binding OST_KV).
//   ost:counters     → { wallets24h: { addr: lastTs }, tx24h: [{ ts, type, volume }] }
//   ost:history      → ring of 1-min snapshots, last 1440 entries (24h)
//
// No clock-driven writes. KV writes happen only on /ost/event POSTs.

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
const OST_HISTORY_MS    = 60_000;      // 1-min snapshot cadence
const OST_WINDOW_MS     = 24 * 60 * 60 * 1000;
const OST_EVENT_MAX     = 5000;        // hard cap on tx24h array

const ALPHA = 0.05;   // active wallets weight
const BETA  = 0.05;   // tx count weight
const GAMMA = 0.05;   // volume weight
const DELTA = 0.10;   // btc mood weight (stub disabled for step 1)

const ALLOWED_EVENT_TYPES = new Set(['faucet', 'send', 'cashout', 'game_win', 'game_loss', 'swap', 'topup', 'other']);

// ── deterministic PRNG (mulberry32) ─────────────────────────────────────────
// Same seed → same output across all worker instances → all callers asking at
// the same wall-clock 5-second tick get the IDENTICAL price wiggle.
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
  // centered in [-OST_VOL_BAND, +OST_VOL_BAND]
  return (mulberry32(tickIndex)() - 0.5) * 2 * OST_VOL_BAND;
}

// Linear-interpolate between two adjacent tick noises so the price line is
// continuous and looks "alive" instead of stair-stepping every 5s.
function volMultiplier(ts) {
  const t = ts / OST_TICK_MS;
  const i = Math.floor(t);
  const f = t - i;
  const a = tickNoise(i);
  const b = tickNoise(i + 1);
  return 1 + a * (1 - f) + b * f;
}

// ── counters ────────────────────────────────────────────────────────────────
function emptyCounters() {
  return { wallets24h: {}, tx24h: [] };
}

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

function btcMood(/* btc24hPct */) {
  // Stub for step 1 — enable in step 2 once we wire 24hr ticker.
  return 1.0;
}

// ── price computation ──────────────────────────────────────────────────────
function computePrice(counters, ts) {
  const n = networkFactor(counters);
  const v = volMultiplier(ts);
  const m = btcMood();
  const raw = OST_ANCHOR * n * v * m;
  // Hard floor at $0.05 (half-anchor) just in case future weights misbehave.
  return Math.max(OST_ANCHOR * 0.5, raw);
}

function change24hPct(counters, nowPrice, ts) {
  const prevTs = ts - OST_WINDOW_MS;
  // Reconstruct N(t) at prevTs by filtering counters to events that already
  // existed at prevTs. For wallets24h we approximate (we only store last-seen
  // ts per addr); this is fine for devnet — exact history lives in ost:history.
  const tx24hAtThen = (counters.tx24h || []).filter(e => Number(e.ts) < prevTs);
  const walletsAtThen = {};
  for (const [addr, lastTs] of Object.entries(counters.wallets24h || {})) {
    if (Number(lastTs) < prevTs) walletsAtThen[addr] = Number(lastTs);
  }
  const prevPrice = computePrice({ wallets24h: walletsAtThen, tx24h: tx24hAtThen }, prevTs);
  if (!Number.isFinite(prevPrice) || prevPrice <= 0) return 0;
  return ((nowPrice - prevPrice) / prevPrice) * 100;
}

// ── history ring ───────────────────────────────────────────────────────────
async function maybeSnapshotHistory(env, counters, ts) {
  const history = (await kvGet(env, 'ost:history', [])) || [];
  const lastTs = history.length ? Number(history[history.length - 1].ts) : 0;
  if (ts - lastTs < OST_HISTORY_MS) return history;
  const price = computePrice(counters, ts);
  history.push({ ts, price: Number(price.toFixed(8)), n: Number(networkFactor(counters).toFixed(6)) });
  while (history.length > OST_HISTORY_MAX) history.shift();
  await kvPut(env, 'ost:history', history);
  return history;
}

// ── router ─────────────────────────────────────────────────────────────────
export async function handleOstPriceRequest(request, env, ctx) {
  const { path, method, url } = ctx;

  if (path === '/ost/price' && method === 'GET') {
    const now = Date.now();
    const counters = pruneCounters((await kvGet(env, 'ost:counters', emptyCounters())) || emptyCounters(), now);
    const price = computePrice(counters, now);
    const change = change24hPct(counters, price, now);
    return json({
      price: Number(price.toFixed(8)),
      currency: 'USD',
      anchor: OST_ANCHOR,
      change24h: Number(change.toFixed(4)),
      source: 'ost-devnet-synthetic',
      model: 'P0 * N(t) * V(t) * M(t)',
      ts: new Date(now).toISOString()
    }, 200, { 'cache-control': 'no-store' });
  }

  if (path === '/ost/stats' && method === 'GET') {
    const now = Date.now();
    const counters = pruneCounters((await kvGet(env, 'ost:counters', emptyCounters())) || emptyCounters(), now);
    const W = Object.keys(counters.wallets24h).length;
    const T = counters.tx24h.length;
    const V = counters.tx24h.reduce((s, e) => s + Math.max(0, Number(e.volume) || 0), 0);
    const n = networkFactor(counters);
    const v = volMultiplier(now);
    const m = btcMood();
    const price = OST_ANCHOR * n * v * m;
    return json({
      ts: new Date(now).toISOString(),
      anchor: OST_ANCHOR,
      activeWallets24h: W,
      tx24h: T,
      volume24h: Number(V.toFixed(8)),
      networkFactor: Number(n.toFixed(6)),
      volMultiplier: Number(v.toFixed(6)),
      btcMood: Number(m.toFixed(6)),
      price: Number(price.toFixed(8)),
      weights: { alpha: ALPHA, beta: BETA, gamma: GAMMA, delta: DELTA },
      volBand: OST_VOL_BAND,
      tickMs: OST_TICK_MS
    }, 200, { 'cache-control': 'no-store' });
  }

  if (path === '/ost/history' && method === 'GET') {
    const range = String(url.searchParams.get('range') || '24h').toLowerCase();
    const now = Date.now();
    const cutoffMs = range === '1h' ? 60 * 60 * 1000
      : range === '7d' ? 7 * 24 * 60 * 60 * 1000
      : 24 * 60 * 60 * 1000;
    const cutoff = now - cutoffMs;
    const history = ((await kvGet(env, 'ost:history', [])) || []).filter(p => Number(p.ts) >= cutoff);
    return json({
      range,
      points: history,
      count: history.length,
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
    await kvPut(env, 'ost:counters', counters);
    await maybeSnapshotHistory(env, counters, now);

    const price = computePrice(counters, now);
    return json({
      ok: true,
      accepted: { wallet, type, volume },
      price: Number(price.toFixed(8)),
      activeWallets24h: Object.keys(counters.wallets24h).length,
      tx24h: counters.tx24h.length,
      ts: new Date(now).toISOString()
    }, 200, { 'cache-control': 'no-store' });
  }

  return null;
}

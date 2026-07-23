/* ==========================================================================
 * OST · Anchor — a REAL reference rate, from real published market data
 * --------------------------------------------------------------------------
 * WHAT THIS REPLACES
 * The old rate came from `ost-devnet-synthetic`: a mean-reverting random walk.
 * The number moved, but nothing moved it. This module replaces the invention
 * with an INDEX built from live Pyth FX feeds, so when the rate changes it is
 * because the world changed.
 *
 * THE ECONOMIC THESIS, IMPLEMENTED HONESTLY
 * Cabo Verde's escudo is hard-pegged to the euro (CVE/EUR is a fixed
 * administrative rate, not a market). So for anyone holding value in CVE, the
 * only thing that actually moves their purchasing power against the world is
 * EUR crossing the majors. That is the real, checkable link between OST's home
 * economy and the large ones - and it is what this index tracks:
 *
 *     ANCHOR = w_eur · (EURUSD / EURUSD_base) + w_cnh · (CNHUSD / CNHUSD_base)
 *
 * Both legs come from Pyth. The bases are pinned once, published, and never
 * silently re-pinned - moving a base retroactively would rewrite history and
 * is exactly how an "always up" chart gets manufactured.
 *
 * WHAT THIS DELIBERATELY IS NOT
 * There is NO growth term, drift constant, or floor. The index can fall,
 * because real FX falls. A rate engineered to only rise, shown as a market
 * price while the token is sold for money, is funded by nothing but the next
 * buyer - and that is the structure that collapses and takes a licence with
 * it. If the honest index is not attractive enough, the fix is a better
 * product, not a better-looking line.
 *
 * HONEST FAILURE. If a feed is stale or unreachable we report `stale: true`
 * and serve the last good value with its age. We never fabricate a tick to
 * keep a chart smooth - a smooth line made of invented points is worse than a
 * visible gap, because nobody can tell it happened.
 * ========================================================================== */

const HERMES = 'https://hermes.pyth.network/v2/updates/price/latest';

// Pyth FX feeds (mainnet price service - real market data).
const FEEDS = {
  eurusd: 'a995d00bb36a63cef7fd2c287dc105fc8f3d93779f062f09551b0af3e81ec30b',
  usdcnh: 'eef52e09c878ad41f6a81803e3640fe04dceea727de894edd4ea117e2e332e66'
};

// Index weights. EUR dominates because it is what CVE is actually pegged to;
// CNH is the second large-economy reference.
const W_EUR = 0.7;
const W_CNH = 0.3;

// Bases: pinned reference levels the index is measured against. CHANGING THESE
// REWRITES EVERY HISTORICAL POINT - they are constants on purpose. If they ever
// need re-basing, publish the change and keep the old series.
const BASE = { eurusd: 1.0850, cnhusd: 0.1380 };

const CACHE_KEY = 'anchor:last';
const STALE_MS = 5 * 60 * 1000;

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'cache-control': 'no-store'
    }
  });

function decodePrice(entry) {
  // Pyth returns price as an integer with a signed exponent.
  if (!entry || !entry.price) return NaN;
  const p = Number(entry.price.price);
  const e = Number(entry.price.expo);
  if (!Number.isFinite(p) || !Number.isFinite(e)) return NaN;
  return p * Math.pow(10, e);
}

export async function fetchAnchor(env, store) {
  const url = HERMES + '?ids[]=' + FEEDS.eurusd + '&ids[]=' + FEEDS.usdcnh;
  let parsed = null;
  try {
    const r = await fetch(url, { cf: { cacheTtl: 15 } });
    if (r.ok) {
      const body = await r.json();
      parsed = body && body.parsed;
    }
  } catch (_) { /* handled below - we do not invent a tick */ }

  const last = store ? await store.get(CACHE_KEY, null) : null;

  if (!parsed || parsed.length < 2) {
    if (last) {
      return Object.assign({}, last, {
        stale: true,
        ageMs: Date.now() - Number(last.ts || 0),
        note: 'live feeds unreachable; serving last good value'
      });
    }
    return { ok: false, error: 'no_feed_and_no_cache', note: 'refusing to invent a rate' };
  }

  const byId = {};
  for (const p of parsed) byId[String(p.id).replace(/^0x/, '')] = p;

  const eurusd = decodePrice(byId[FEEDS.eurusd]);
  const usdcnh = decodePrice(byId[FEEDS.usdcnh]);
  if (!Number.isFinite(eurusd) || !Number.isFinite(usdcnh) || usdcnh === 0) {
    if (last) return Object.assign({}, last, { stale: true, note: 'feed decode failed; last good value' });
    return { ok: false, error: 'feed_decode_failed' };
  }

  const cnhusd = 1 / usdcnh;
  const legEur = eurusd / BASE.eurusd;
  const legCnh = cnhusd / BASE.cnhusd;
  const index = W_EUR * legEur + W_CNH * legCnh;

  const out = {
    ok: true,
    index: Math.round(index * 1e6) / 1e6,
    legs: {
      eurusd: Math.round(eurusd * 1e6) / 1e6,
      cnhusd: Math.round(cnhusd * 1e6) / 1e6,
      legEur: Math.round(legEur * 1e6) / 1e6,
      legCnh: Math.round(legCnh * 1e6) / 1e6
    },
    weights: { eur: W_EUR, cnh: W_CNH },
    base: BASE,
    formula: 'index = 0.7*(EURUSD/1.0850) + 0.3*(CNHUSD/0.1380)',
    source: 'pyth-hermes-fx',
    verify: 'https://hermes.pyth.network/v2/updates/price/latest?ids[]=' + FEEDS.eurusd + '&ids[]=' + FEEDS.usdcnh,
    stale: false,
    ts: Date.now()
  };

  if (store) { try { await store.put(CACHE_KEY, out, 86400); } catch (_) {} }
  return out;
}

export async function handleAnchorRequest(request, env, { path, store }) {
  if (path === '/anchor/rate') {
    const a = await fetchAnchor(env, store);
    return json(a, a.ok === false ? 503 : 200);
  }

  if (path === '/anchor/about') {
    return json({
      ok: true,
      what: 'An index-linked reference rate for OST, built from live Pyth FX feeds.',
      why: "Cabo Verde's escudo is hard-pegged to the euro, so EUR against the majors is what actually moves local purchasing power. The index tracks that.",
      formula: 'index = 0.7*(EURUSD/1.0850) + 0.3*(CNHUSD/0.1380)',
      guarantees: [
        'No growth term, drift constant, or floor. The index falls when FX falls.',
        'Bases are pinned constants; re-basing would rewrite history and is not done silently.',
        'A stale or unreachable feed is reported as stale with its age - ticks are never invented.'
      ],
      notAClaim: 'This is a reference index, not a market price, and not a promise of appreciation.',
      source: 'pyth-hermes-fx'
    });
  }

  return null;
}

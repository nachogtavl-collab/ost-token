const fs = require('node:fs/promises');
const path = require('node:path');

// Multiple Polymarket pulls so sports (World Cup!), games and the main feed
// all land in the snapshot. Deduped by id below.
const POLYMARKET_URLS = [
  'https://gamma-api.polymarket.com/markets?limit=160&closed=false',
  'https://gamma-api.polymarket.com/markets?limit=120&closed=false&tag_id=100639', // sports
  'https://gamma-api.polymarket.com/markets?limit=80&closed=false&tag_id=100640',  // games
  'https://gamma-api.polymarket.com/markets?limit=80&closed=false&order=volume24hr&ascending=false' // hottest
];
const KALSHI_URL = 'https://api.elections.kalshi.com/trade-api/v2/markets?limit=200&status=open';
const OUTPUT_PATH = path.join(__dirname, '..', 'docs', 'data', 'prediction-market-snapshot.json');

function extractPolymarketMarkets(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data && data.value)) return data.value;
  return [];
}

function extractKalshiMarkets(data) {
  if (Array.isArray(data && data.markets)) return data.markets;
  if (Array.isArray(data)) return data;
  return [];
}

async function fetchJson(label, url) {
  const response = await fetch(url, {
    headers: {
      accept: 'application/json',
      'user-agent': 'ost-token-pages-build/1.0'
    }
  });

  if (!response.ok) {
    throw new Error(label + ' returned ' + response.status);
  }

  return response.json();
}

async function loadSource(label, url, extractor, filterFn) {
  try {
    const payload = await fetchJson(label, url);
    return {
      ok: true,
      markets: extractor(payload).filter(filterFn)
    };
  } catch (error) {
    console.error('[prediction-snapshot] ' + label + ' failed: ' + error.message);
    return {
      ok: false,
      markets: []
    };
  }
}

function polymarketFilter(item) {
  return item && item.active !== false && item.closed !== true;
}

// Kalshi multi-leg/parlay records have machine-generated titles like
// "yes A's,yes Milwaukee,yes Cape Verde advances" — unreadable on a board.
function kalshiFilter(item) {
  if (!item || (item.status && item.status !== 'active' && item.status !== 'open')) return false;
  const title = String(item.title || '');
  if (!title || title.length < 8) return false;
  if (/^yes\s/i.test(title) || /,\s*yes\s/i.test(title) || /,\s*no\s/i.test(title)) return false;
  return true;
}

async function main() {
  const polyResults = await Promise.all(
    POLYMARKET_URLS.map((url, i) =>
      loadSource('Polymarket[' + i + ']', url, extractPolymarketMarkets, polymarketFilter))
  );
  const kalshi = await loadSource('Kalshi', KALSHI_URL, extractKalshiMarkets, kalshiFilter);

  const seen = new Set();
  const polymarketMarkets = [];
  let polyOk = false;
  polyResults.forEach(res => {
    if (res.ok) polyOk = true;
    res.markets.forEach(m => {
      const id = m && (m.id || m.conditionId);
      if (!id || seen.has(id)) return;
      seen.add(id);
      polymarketMarkets.push(m);
    });
  });

  if (!polyOk && !kalshi.ok) {
    console.warn('[prediction-snapshot] All sources failed — writing empty snapshot so deploy continues.');
  }

  const snapshot = {
    generatedAt: new Date().toISOString(),
    sourceHealth: {
      polymarket: polyOk && polymarketMarkets.length > 0,
      kalshi: kalshi.ok && kalshi.markets.length > 0
    },
    polymarket: polymarketMarkets,
    kalshi: kalshi.markets
  };

  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fs.writeFile(OUTPUT_PATH, JSON.stringify(snapshot) + '\n', 'utf8');

  console.log(
    '[prediction-snapshot] Wrote ' + OUTPUT_PATH +
    ' (' + snapshot.polymarket.length + ' Polymarket, ' + snapshot.kalshi.length + ' Kalshi)'
  );
}

main().catch(function(error) {
  console.error('[prediction-snapshot] ' + error.message);
  // Do NOT set a non-zero exit code — a failed snapshot must never block the
  // Pages deployment. The site handles an empty/stale snapshot gracefully.
});

const fs = require('node:fs/promises');
const path = require('node:path');

const POLYMARKET_URL = 'https://gamma-api.polymarket.com/markets?limit=160&closed=false';
const KALSHI_URL = 'https://api.elections.kalshi.com/trade-api/v2/markets?limit=160';
const OUTPUT_PATH = path.join(__dirname, '..', 'site', 'data', 'prediction-market-snapshot.json');

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

async function main() {
  const [polymarket, kalshi] = await Promise.all([
    loadSource(
      'Polymarket',
      POLYMARKET_URL,
      extractPolymarketMarkets,
      function(item) {
        return item && item.active !== false && item.closed !== true;
      }
    ),
    loadSource(
      'Kalshi',
      KALSHI_URL,
      extractKalshiMarkets,
      function(item) {
        return item && item.status === 'active';
      }
    )
  ]);

  if (!polymarket.ok && !kalshi.ok) {
    throw new Error('Prediction snapshot fetch failed for both sources');
  }

  const snapshot = {
    generatedAt: new Date().toISOString(),
    sourceHealth: {
      polymarket: polymarket.ok && polymarket.markets.length > 0,
      kalshi: kalshi.ok && kalshi.markets.length > 0
    },
    polymarket: polymarket.markets,
    kalshi: kalshi.markets
  };

  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fs.writeFile(OUTPUT_PATH, JSON.stringify(snapshot, null, 2) + '\n', 'utf8');

  console.log(
    '[prediction-snapshot] Wrote ' + OUTPUT_PATH +
    ' (' + snapshot.polymarket.length + ' Polymarket, ' + snapshot.kalshi.length + ' Kalshi)'
  );
}

main().catch(function(error) {
  console.error('[prediction-snapshot] ' + error.message);
  process.exitCode = 1;
});
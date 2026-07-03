const fs = require('node:fs/promises');
const path = require('node:path');

/*
 * Prediction market snapshot builder — runs before every site deploy.
 *
 * Polymarket: several Gamma pulls (main feed, sports incl. World Cup, games,
 * hottest by volume, deep page) deduped by id.
 *
 * Kalshi: their public API stripped prices from market/event listings, but
 * the per-market ORDERBOOK endpoint is still public. So: page /events for
 * clean titles, then harvest orderbooks in small parallel batches and derive
 * real prices from the book (yes bid = best yes_dollars level, yes ask =
 * 1 - best no_dollars level). Only markets with a live book ship.
 */

const POLYMARKET_URLS = [
  'https://gamma-api.polymarket.com/markets?limit=500&closed=false',
  'https://gamma-api.polymarket.com/markets?limit=300&closed=false&tag_id=100639', // sports / World Cup
  'https://gamma-api.polymarket.com/markets?limit=120&closed=false&tag_id=100640', // games
  'https://gamma-api.polymarket.com/markets?limit=200&closed=false&order=volume24hr&ascending=false',
  'https://gamma-api.polymarket.com/markets?limit=300&closed=false&offset=500',
  'https://gamma-api.polymarket.com/markets?limit=300&closed=false&offset=800'
];
const KALSHI_BASE = 'https://api.elections.kalshi.com/trade-api/v2';
const KALSHI_EVENT_PAGES = 10;          // 4 x 200 events scanned
const KALSHI_TARGET = 200;             // aim for ~this many priced markets
const KALSHI_BATCH = 5;                // parallel orderbook fetches
const OUTPUT_PATH = path.join(__dirname, '..', 'docs', 'data', 'prediction-market-snapshot.json');

function extractPolymarketMarkets(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data && data.value)) return data.value;
  return [];
}

async function fetchJson(label, url) {
  const response = await fetch(url, {
    headers: { accept: 'application/json', 'user-agent': 'ost-token-pages-build/1.1' }
  });
  if (!response.ok) throw new Error(label + ' returned ' + response.status);
  return response.json();
}

function polymarketFilter(item) {
  return item && item.active !== false && item.closed !== true;
}

// ---------------------------------------------------------------- Polymarket
const POLYMARKET_SEARCHES = ['world cup', 'fifa 2026', 'golden boot', 'champions league', 'nba finals', 'ufc', 'formula 1'];

function legPrice(m) {
  try {
    const prices = typeof m.outcomePrices === 'string' ? JSON.parse(m.outcomePrices) : m.outcomePrices;
    const p = Number(prices && prices[0]);
    return Number.isFinite(p) ? p : NaN;
  } catch (_) { return NaN; }
}

function legLabel(event, m) {
  const gi = String(m.groupItemTitle || '').trim();
  if (gi) return gi;
  let q = String(m.question || '').trim();
  const ev = String(event.title || '').trim();
  if (ev && q.toLowerCase().startsWith(ev.toLowerCase())) q = q.slice(ev.length).replace(/^[\s:—-]+/, '');
  return q || 'Option';
}

function flattenEventMarkets(events) {
  const out = [];
  (events || []).forEach(event => {
    const legs = (event.markets || []).filter(polymarketFilter);
    // Polymarket's signature: grouped events (Who wins? A/B/C/…) become ONE
    // record carrying the whole outcome ladder instead of N scattered cards.
    const priced = legs.map(m => ({ m, price: legPrice(m) })).filter(x => Number.isFinite(x.price) && x.price > 0.001 && x.price < 0.999);
    if (legs.length >= 3 && priced.length >= 3 && event.title) {
      priced.sort((a, b) => b.price - a.price);
      out.push({
        id: 'group:' + (event.id || event.slug || event.title),
        question: event.title,
        description: 'Multi-outcome event — ' + priced.length + ' options. Prices are live Polymarket consensus per outcome.',
        slug: event.slug || '',
        groupOutcomes: priced.slice(0, 10).map(x => ({
          label: legLabel(event, x.m).slice(0, 48),
          price: Number(x.price.toFixed(4)),
          marketId: x.m.id,
          conditionId: x.m.conditionId,
          clobTokenIds: x.m.clobTokenIds
        })),
        endDate: legs.reduce((mx, m) => (m.endDate && (!mx || m.endDate > mx)) ? m.endDate : mx, ''),
        volume24hr: legs.reduce((sv, m) => sv + (Number(m.volume24hr) || 0), 0),
        liquidityNum: legs.reduce((sv, m) => sv + (Number(m.liquidityNum) || 0), 0),
        active: true,
        closed: false
      });
      return; // group record replaces the scattered legs
    }
    legs.forEach(m => {
      if (event.title && m.question && m.question.length < 26) {
        m = Object.assign({}, m, { question: event.title + ': ' + m.question });
      }
      out.push(m);
    });
  });
  return out;
}

async function loadPolymarketSearch() {
  const results = await Promise.all(POLYMARKET_SEARCHES.map(async q => {
    try {
      const payload = await fetchJson('search:' + q,
        'https://gamma-api.polymarket.com/public-search?q=' + encodeURIComponent(q) + '&limit_per_type=25');
      return flattenEventMarkets(payload && payload.events);
    } catch (error) {
      console.error('[prediction-snapshot] search "' + q + '" failed: ' + error.message);
      return [];
    }
  }));
  return results.flat();
}

async function loadPolymarketSportsEvents() {
  try {
    const payload = await fetchJson('sports-events',
      'https://gamma-api.polymarket.com/events?limit=200&closed=false&tag_id=100639');
    return flattenEventMarkets(Array.isArray(payload) ? payload : payload && payload.value);
  } catch (error) {
    console.error('[prediction-snapshot] sports events failed: ' + error.message);
    return [];
  }
}

async function loadPolymarket() {
  const [urlResults, searchMarkets, sportsMarkets] = await Promise.all([
    Promise.all(POLYMARKET_URLS.map(async (url, i) => {
      try {
        const payload = await fetchJson('Polymarket[' + i + ']', url);
        return extractPolymarketMarkets(payload).filter(polymarketFilter);
      } catch (error) {
        console.error('[prediction-snapshot] Polymarket[' + i + '] failed: ' + error.message);
        return [];
      }
    })),
    loadPolymarketSearch(),
    loadPolymarketSportsEvents()
  ]);
  const seen = new Set();
  const markets = [];
  urlResults.flat().concat(searchMarkets, sportsMarkets).forEach(m => {
    const id = m && (m.id || m.conditionId);
    if (!id || seen.has(id)) return;
    seen.add(id);
    markets.push(slimPolymarket(m));
  });
  return markets;
}

// Keep only the fields the client mapper reads — the raw gamma records made
// the snapshot >5 MB, which is hostile to phones.
const POLY_KEEP = ['id', 'question', 'slug', 'outcomes', 'outcomePrices', 'conditionId', 'groupOutcomes',
  'clobTokenIds', 'endDate', 'endDateIso', 'startDate', 'createdAt', 'category',
  'volume24hr', 'volumeNum', 'volume', 'liquidityNum', 'liquidity', 'bestBid', 'bestAsk',
  'lastTradePrice', 'oneWeekPriceChange', 'oneMonthPriceChange', 'active', 'closed'];

function slimPolymarket(m) {
  const out = {};
  POLY_KEEP.forEach(k => { if (m[k] !== undefined && m[k] !== null) out[k] = m[k]; });
  if (m.description) out.description = String(m.description).slice(0, 220);
  return out;
}

// -------------------------------------------------------------------- Kalshi
function cleanKalshiTitle(event, market) {
  const evTitle = String(event.title || '').trim();
  const sub = String(market.yes_sub_title || market.subtitle || '').trim();
  if (!evTitle) return '';
  if (!sub || evTitle.toLowerCase().includes(sub.toLowerCase())) return evTitle;
  return evTitle + ' — ' + sub;
}

function junkTitle(title) {
  return !title || title.length < 8 || /^yes\s/i.test(title) || /,\s*(yes|no)\s/i.test(title);
}

async function kalshiEvents() {
  const events = [];
  let cursor = '';
  for (let page = 0; page < KALSHI_EVENT_PAGES; page++) {
    const url = KALSHI_BASE + '/events?limit=200&status=open&with_nested_markets=true' +
      (cursor ? '&cursor=' + encodeURIComponent(cursor) : '');
    try {
      const payload = await fetchJson('Kalshi events p' + page, url);
      (payload.events || []).forEach(e => events.push(e));
      cursor = payload.cursor || '';
      if (!cursor) break;
    } catch (error) {
      console.error('[prediction-snapshot] ' + error.message);
      break;
    }
  }
  return events;
}

function bookBest(levels) {
  // levels: [["0.6500","284.00"], ...] price->resting dollars; best = highest price
  let best = 0, depth = 0;
  (levels || []).forEach(l => {
    const price = Number(l[0]);
    const qty = Number(l[1]);
    if (Number.isFinite(qty)) depth += qty;
    if (Number.isFinite(price) && price > best) best = price;
  });
  return { best, depth };
}

async function kalshiOrderbook(ticker) {
  const payload = await fetchJson('orderbook', KALSHI_BASE + '/markets/' + encodeURIComponent(ticker) + '/orderbook');
  const book = payload.orderbook_fp || payload.orderbook || {};
  const yes = bookBest(book.yes_dollars || book.yes);
  const no = bookBest(book.no_dollars || book.no);
  if (!(yes.best > 0) && !(no.best > 0)) return null;
  const yesBid = yes.best > 0 ? yes.best : null;
  const yesAsk = no.best > 0 ? 1 - no.best : null;
  const mid = yesBid != null && yesAsk != null ? (yesBid + yesAsk) / 2
            : yesBid != null ? yesBid : yesAsk;
  if (!(mid > 0) || mid >= 1) return null;
  return {
    yesBid: yesBid != null ? Number(yesBid.toFixed(4)) : null,
    yesAsk: yesAsk != null ? Number(yesAsk.toFixed(4)) : null,
    mid: Number(mid.toFixed(4)),
    liquidity: Math.round(yes.depth + no.depth)
  };
}

async function loadKalshi() {
  const events = await kalshiEvents();
  console.log('[prediction-snapshot] Kalshi events scanned: ' + events.length);

  // Candidate legs: clean title, active, closing within 18 months.
  // World Cup / sports events get priority, then everything else.
  const horizon = Date.now() + 548 * 86400000;
  const candidates = [];
  events.forEach(event => {
    (event.markets || []).forEach(market => {
      if (market.status && market.status !== 'active') return;
      const title = cleanKalshiTitle(event, market);
      if (junkTitle(title)) return;
      const closeMs = Date.parse(market.close_time || '');
      if (!Number.isFinite(closeMs) || closeMs < Date.now() || closeMs > horizon) return;
      candidates.push({
        event, market, title, closeMs,
        priority: /world cup|fifa|soccer|football/i.test(title + ' ' + (event.category || '')) ? 0
                : (event.category === 'Politics' || event.category === 'Elections') ? 1
                : (event.category === 'Economics' || event.category === 'Financials') ? 1
                : 2
      });
    });
  });
  candidates.sort((a, b) => a.priority - b.priority || a.closeMs - b.closeMs);
  // Cap per event so one series doesn't eat the whole quota
  const perEvent = {};
  const queue = candidates.filter(c => {
    const key = c.event.event_ticker || c.event.title;
    perEvent[key] = (perEvent[key] || 0) + 1;
    return perEvent[key] <= 4;
  }).slice(0, 400);

  const out = [];
  for (let i = 0; i < queue.length && out.length < KALSHI_TARGET; i += KALSHI_BATCH) {
    const batch = queue.slice(i, i + KALSHI_BATCH);
    const books = await Promise.all(batch.map(c => kalshiOrderbook(c.market.ticker).catch(() => null)));
    books.forEach((book, j) => {
      if (!book) return;
      const c = batch[j];
      out.push({
        ticker: c.market.ticker,
        event_ticker: c.event.event_ticker,
        title: c.title,
        yes_sub_title: c.market.yes_sub_title || '',
        rules_primary: (c.market.rules_primary || '').slice(0, 240),
        category: c.event.category || '',
        close_time: c.market.close_time,
        open_time: c.market.open_time,
        status: 'active',
        yes_bid_dollars: book.yesBid,
        yes_ask_dollars: book.yesAsk,
        last_price_dollars: book.mid,
        liquidity_dollars: book.liquidity,
        source: 'kalshi-orderbook-public'
      });
    });
    await new Promise(res => setTimeout(res, 180)); // stay polite on rate limits
  }
  return out;
}

// ---------------------------------------------------------------------- main
async function main() {
  const [polymarket, kalshi] = await Promise.all([
    loadPolymarket(),
    loadKalshi().catch(error => {
      console.error('[prediction-snapshot] Kalshi failed: ' + error.message);
      return [];
    })
  ]);

  const snapshot = {
    generatedAt: new Date().toISOString(),
    sourceHealth: {
      polymarket: polymarket.length > 0,
      kalshi: kalshi.length > 0
    },
    polymarket,
    kalshi
  };

  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fs.writeFile(OUTPUT_PATH, JSON.stringify(snapshot) + '\n', 'utf8');
  console.log('[prediction-snapshot] Wrote ' + OUTPUT_PATH +
    ' (' + polymarket.length + ' Polymarket, ' + kalshi.length + ' Kalshi)');
}

main().catch(function(error) {
  console.error('[prediction-snapshot] ' + error.message);
  // never block the deploy
});

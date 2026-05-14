/* ==========================================================================
   OST Prediction PRO — featured curated markets, 5-min BTC native market,
   detail modal (chart + recent trades + depth), public bot/arbitrage API.

   Plugs into app.js via:
     - window.buildOstNativeMarkets()  (called by setLoadedPredictionMarkets)
     - DOM hook: a "Details" button injected on every market card
     - window.OST_PREDICTION_API       (read-only state + place/cashout helpers
                                       so external bots can sign with their key)

   No external services required at runtime — Polymarket Gamma API is hit
   directly by app.js. We additionally cache curated event slugs here and
   resolve them to live market ids when present, otherwise show as pinned
   placeholders so the user always sees the markets they expect.
   ========================================================================== */
(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // 0) Polymarket Relay configuration
  //    Set window.OST_POLY_RELAY_URL = 'https://<your-relay-origin>'
  //    BEFORE this script loads (or on the page) to route Polymarket reads
  //    through the OST Cloudflare Worker. Falls back to the direct Gamma API
  //    so the site still works if the relay is down or not configured.
  // ---------------------------------------------------------------------------
  function relayBase() {
    var v = (typeof window !== 'undefined' && window.OST_POLY_RELAY_URL) || '';
    return v ? String(v).replace(/\/$/, '') : '';
  }
  function ostApiBase() {
    var v = (typeof window !== 'undefined' && window.OST_API_BASE) || '';
    return v ? String(v).replace(/\/$/, '') : '';
  }
  function pmGammaUrl(path, query) {
    var base = relayBase();
    if (base) return base + '/gamma' + path + (query ? ('?' + query) : '');
    return 'https://gamma-api.polymarket.com' + path + (query ? ('?' + query) : '');
  }
  function pmClobUrl(path, query) {
    var base = relayBase();
    if (base) return base + '/clob' + path + (query ? ('?' + query) : '');
    return 'https://clob.polymarket.com' + path + (query ? ('?' + query) : '');
  }
  function pmDataUrl(path, query) {
    var base = relayBase();
    if (base) return base + '/data' + path + (query ? ('?' + query) : '');
    return 'https://data-api.polymarket.com' + path + (query ? ('?' + query) : '');
  }

  // ---------------------------------------------------------------------------
  // 1) Curated featured Polymarket events (the user's wishlist)
  // ---------------------------------------------------------------------------
  var FEATURED_SLUGS = [
    { slug: 'us-x-iran-permanent-peace-deal-by',          topic: 'politics', label: 'US x Iran permanent peace deal' },
    { slug: '2026-fifa-world-cup-winner-595',             topic: 'sports',   label: '2026 FIFA World Cup winner' },
    { slug: 'presidential-election-winner-2028',          topic: 'politics', label: 'US Presidential Election 2028' },
    { slug: 'republican-presidential-nominee-2028',       topic: 'politics', label: 'Republican nominee 2028' },
    { slug: 'when-will-bitcoin-hit-150k',                 topic: 'crypto',   label: 'When will Bitcoin hit $150k?' },
    { slug: 'what-price-will-bitcoin-hit-in-april-2026',  topic: 'crypto',   label: 'Bitcoin price April 2026' },
    { slug: 'ucl-psg1-bay1-2026-04-28',                   topic: 'sports',   label: 'UCL · PSG vs Bayern (Apr 28)' }
  ];

  // ---------------------------------------------------------------------------
  // 2) 5-min BTC OST native market (the headline attraction)
  //    Auto opens a fresh round every 5 minutes. Settles deterministically
  //    when the round closes using the latest Coinbase BTC-USD price tick.
  // ---------------------------------------------------------------------------
  var FIVE_MIN_MS = 5 * 60 * 1000;
  var BTC_PRICE_URL = 'https://api.coinbase.com/v2/prices/BTC-USD/spot';
  var BTC_REFRESH_MS = 1000;          // live tick cadence for the shared BTC stream
  var BTC_DEDUPE_MS  = 800;           // dedupe identical prints inside this window
  var BTC_FEED_TIMEOUT_MS = 3000;
  var BTC_MAX_SERIES = 600;           // ~10 min of 1Hz history for the chart
  var BTC_PRICE_FEEDS = [
    {
      name: 'coinbase',
      url: BTC_PRICE_URL,
      pick: function (j) { return j && j.data && Number(j.data.amount); }
    },
    {
      name: 'binance',
      url: 'https://data-api.binance.vision/api/v3/ticker/price?symbol=BTCUSDT',
      pick: function (j) { return j && Number(j.price); }
    },
    {
      name: 'kraken',
      url: 'https://api.kraken.com/0/public/Ticker?pair=XBTUSD',
      pick: function (j) {
        try {
          var key = Object.keys(j && j.result || {})[0];
          return Number(j.result[key].c[0]);
        } catch (e) { return NaN; }
      }
    },
    {
      // CoinGecko ships permissive CORS headers, so it works as a last-resort
      // public feed when Coinbase / Binance / Kraken are blocked by the
      // user's network or region. Without it the modal would lock at 50/50.
      name: 'coingecko',
      url: 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&precision=2',
      pick: function (j) { return j && j.bitcoin && Number(j.bitcoin.usd); }
    }
  ];
  // CORS proxies used as a final fallback when every direct feed fails. The
  // 5-min BTC equation needs a live price to escape the cold 50/50 default,
  // so we pay one extra hop rather than display a static market.
  var BTC_CORS_PROXIES = [
    'https://corsproxy.io/?url=',
    'https://api.allorigins.win/raw?url='
  ];
  var btcLastTick = { ts: 0, price: 0, source: '' };
  var btcPrevTick = { ts: 0, price: 0, source: '' };
  var btcSeries = [];
  var btcPreferredSource = '';
  var btcLastOdds = { roundId: '', yes: 0.5, previousYes: 0.5 };
  // Canonical round snapshot from the OST worker — when present, ALL clients
  // see the same openPrice + livePrice + yesProb regardless of which exchange
  // their browser would have hit. This kills the cross-user discrepancy
  // where one user saw NO at 80¢ and another saw NO at 50¢ on the same round.
  var canonicalRound = null;            // last successful /btc/round payload
  var canonicalRoundFetchedAt = 0;
  var canonicalTicksSeededFor = 0;      // openAt of the round whose ticks we've seeded
  var canonicalTicksLoadingFor = 0;

  function canonicalRoundIsFresh() {
    return canonicalRound && (Date.now() - canonicalRoundFetchedAt < 4500);
  }

  function clampNumber(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function formatUsd(value) {
    var number = Number(value);
    if (!Number.isFinite(number) || number < 0) return '$--';
    return '$' + number.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function formatSignedUsd(value) {
    var number = Number(value);
    if (!Number.isFinite(number)) return '--';
    return (number >= 0 ? '+' : '-') + formatUsd(Math.abs(number));
  }

  function getBtcFeeds() {
    // OST edge worker /btc/price isn't deployed yet \u2014 calling it spams 404s,
    // so we rely solely on public CORS-safe exchange feeds.
    return BTC_PRICE_FEEDS.slice();
  }

  function fetchWithTimeout(url, opts, timeoutMs) {
    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timeoutId = controller ? setTimeout(function () { controller.abort(); }, timeoutMs || BTC_FEED_TIMEOUT_MS) : null;
    return fetch(url, Object.assign({ cache: 'no-store', signal: controller ? controller.signal : undefined }, opts || {}))
      .then(function (response) {
        if (timeoutId) clearTimeout(timeoutId);
        return response;
      })
      .catch(function (error) {
        if (timeoutId) clearTimeout(timeoutId);
        throw error;
      });
  }

  function orderedBtcFeeds() {
    var feeds = getBtcFeeds();
    if (!btcPreferredSource) return feeds;
    var preferred = feeds.filter(function (feed) { return feed.name === btcPreferredSource; });
    var fallback = feeds.filter(function (feed) { return feed.name !== btcPreferredSource; });
    return preferred.concat(fallback);
  }

  function fetchBtcFeed(feed) {
    return fetchWithTimeout(feed.url, { headers: { accept: 'application/json' }, mode: 'cors' }, BTC_FEED_TIMEOUT_MS)
      .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error(feed.name + ' ' + r.status)); })
      .then(function (j) {
        var price = feed.pick(j);
        if (!Number.isFinite(price) || price <= 1000) throw new Error(feed.name + ' empty price');
        return { price: price, source: feed.name };
      });
  }

  // Wrap fetchBtcFeed with a CORS-proxy retry chain. If a user's network or
  // region blocks the direct exchange API, the equation would otherwise stay
  // pinned at 50/50 because btcLastTick.price never moves off zero.
  function fetchBtcFeedResilient(feed) {
    return fetchBtcFeed(feed).catch(function (firstError) {
      var attempt = function (idx) {
        if (idx >= BTC_CORS_PROXIES.length) return Promise.reject(firstError);
        var proxiedUrl = BTC_CORS_PROXIES[idx] + encodeURIComponent(feed.url);
        return fetchWithTimeout(proxiedUrl, { headers: { accept: 'application/json' } }, BTC_FEED_TIMEOUT_MS)
          .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error(feed.name + ' proxy ' + r.status)); })
          .then(function (j) {
            var price = feed.pick(j);
            if (!Number.isFinite(price) || price <= 1000) throw new Error(feed.name + ' proxy empty');
            return { price: price, source: feed.name + '*' };
          })
          .catch(function () { return attempt(idx + 1); });
      };
      return attempt(0);
    });
  }

  function tryBtcFeeds(feeds, index, lastError) {
    if (index >= feeds.length) return Promise.reject(lastError || new Error('no btc feed'));
    return fetchBtcFeedResilient(feeds[index]).catch(function (error) {
      if (feeds[index].name === btcPreferredSource) btcPreferredSource = '';
      return tryBtcFeeds(feeds, index + 1, error);
    });
  }

  function rememberBtcTick(price, source) {
    var p = Number(price);
    if (!Number.isFinite(p) || p <= 1000) return btcLastTick;
    var now = Date.now();
    if (btcLastTick.price === p && now - btcLastTick.ts < BTC_DEDUPE_MS) {
      btcLastTick = { ts: now, price: p, source: source || btcLastTick.source || 'btc' };
      try { window.dispatchEvent(new CustomEvent('ost:btc-spot', { detail: Object.assign({}, btcLastTick) })); } catch (e) {}
      return btcLastTick;
    }
    if (btcLastTick.price) btcPrevTick = btcLastTick;
    btcLastTick = { ts: now, price: p, source: source || 'btc' };
    btcSeries.push({ ts: btcLastTick.ts, price: p, source: btcLastTick.source });
    if (btcSeries.length > BTC_MAX_SERIES) btcSeries = btcSeries.slice(-BTC_MAX_SERIES);
    try { window.dispatchEvent(new CustomEvent('ost:btc-spot', { detail: Object.assign({}, btcLastTick) })); } catch (e) {}
    return btcLastTick;
  }

  function fetchBtcSpot(options) {
    var force = options && options.force;
    if (!force && btcLastTick.price && Date.now() - btcLastTick.ts < 700) {
      return Promise.resolve(Object.assign({}, btcLastTick));
    }
    var fetchDirectSpot = function () {
      return tryBtcFeeds(orderedBtcFeeds(), 0)
      .then(function (result) {
        btcPreferredSource = result.source && result.source.replace(/\*$/, '') || btcPreferredSource;
        return Object.assign({}, rememberBtcTick(result.price, result.source));
      })
      .catch(function () {
        // Last-ditch fallback: borrow whatever BTC quote app.js already has
        // cached so the 5-min market can leave the cold 50/50 default even
        // when every public feed (and proxy) is unreachable.
        try {
          var fallbackPx = (typeof window !== 'undefined'
            && window.__ostPrices && Number(window.__ostPrices.bitcoin))
            || (typeof window !== 'undefined' && Number(window.OST_BTC_FALLBACK_PRICE))
            || 0;
          if (Number.isFinite(fallbackPx) && fallbackPx > 1000) {
            return Object.assign({}, rememberBtcTick(fallbackPx, 'cache'));
          }
        } catch (_) {}
        return Object.assign({}, btcLastTick, { stale: !!btcLastTick.price });
      });
    };
    if (ostApiBase()) {
      return fetchCanonicalRound()
        .then(function (round) {
          var p = round && Number(round.livePrice);
          if (Number.isFinite(p) && p > 1000) {
            return Object.assign({}, rememberBtcTick(p, round.livePriceSource || 'ost-canonical'));
          }
          return fetchDirectSpot();
        })
        .catch(fetchDirectSpot);
    }
    return fetchDirectSpot();
  }

  function estimateRecentBtcVolPct() {
    var cutoff = Date.now() - 45000;
    var recent = btcSeries.filter(function (point) { return point.ts >= cutoff && point.price > 0; });
    if (recent.length < 3) return 0.025;
    var returns = [];
    for (var i = 1; i < recent.length; i += 1) {
      var prev = recent[i - 1].price;
      var next = recent[i].price;
      if (prev > 0 && next > 0) returns.push(Math.abs((next - prev) / prev) * 100);
    }
    if (!returns.length) return 0.025;
    var avg = returns.reduce(function (sum, value) { return sum + value; }, 0) / returns.length;
    var prices = recent.map(function (point) { return point.price; });
    var span = ((Math.max.apply(null, prices) - Math.min.apply(null, prices)) / recent[recent.length - 1].price) * 100;
    return Math.max(0.018, Math.min(0.45, avg * 8 + span * 0.55));
  }

  function estimateBtcMomentumPct() {
    if (btcSeries.length < 2) return 0;
    var latest = btcSeries[btcSeries.length - 1];
    var cutoff = latest.ts - 15000;
    var anchor = btcSeries[0];
    for (var i = btcSeries.length - 1; i >= 0; i -= 1) {
      if (btcSeries[i].ts <= cutoff) { anchor = btcSeries[i]; break; }
    }
    if (!anchor || !anchor.price || !latest.price) return 0;
    return ((latest.price - anchor.price) / anchor.price) * 100;
  }

  function computeBtcOdds(openPrice, livePrice, boundaries) {
    var roundId = 'ost-btc5m-' + boundaries.openAt;
    var previousYes = btcLastOdds.roundId === roundId && Number.isFinite(btcLastOdds.yes)
      ? btcLastOdds.yes
      : 0.5;
    var yes = 0.5;
    var delta = Number(livePrice) - Number(openPrice);
    var deltaPct = Number.isFinite(delta) && openPrice > 0 ? (delta / openPrice) * 100 : 0;
    if (openPrice > 0 && livePrice > 0) {
      var msLeft = clampNumber(boundaries.closeAt - Date.now(), 0, FIVE_MIN_MS);
      var timeLeftRatio = msLeft / FIVE_MIN_MS;
      var volatilityPct = estimateRecentBtcVolPct();
      var momentumPct = estimateBtcMomentumPct();
      var scale = Math.max(0.012, volatilityPct * Math.sqrt(Math.max(timeLeftRatio, 0.08)) * 2.4);
      var score = clampNumber((deltaPct + momentumPct * 0.22) / scale, -4.5, 4.5);
      yes = 1 / (1 + Math.exp(-score));
      var confidence = 0.70 + (1 - timeLeftRatio) * 0.25;
      yes = 0.5 + (yes - 0.5) * confidence;
      if (Math.abs(delta) < 0.25) yes = 0.5 + (yes - 0.5) * 0.35;
      yes = clampNumber(yes, 0.03, 0.97);
    }
    btcLastOdds = { roundId: roundId, yes: yes, previousYes: previousYes };
    return {
      yes: yes,
      no: 1 - yes,
      previousYes: previousYes,
      delta: delta,
      deltaPct: deltaPct,
      volatilityPct: estimateRecentBtcVolPct(),
      momentumPct: estimateBtcMomentumPct()
    };
  }

  function publishBtcMarketUpdate(reason) {
    var market = buildFiveMinBtcMarket();
    captureRoundOpenIfNeeded(market);
    try {
      window.dispatchEvent(new CustomEvent('ost:btc-market-updated', {
        detail: {
          reason: reason || 'btc-tick',
          tick: Object.assign({}, btcLastTick),
          market: market
        }
      }));
    } catch (e) {}
    return market;
  }
  function pollBtcMarket() {
    // Skip polling when the page is hidden to avoid flooding public APIs.
    if (typeof document !== 'undefined' && document.hidden) return;
    // Canonical worker round is the SOURCE OF TRUTH. Try it first; only fall
    // back to direct exchange polls if the worker is unreachable so the chart
    // never goes blank.
    fetchCanonicalRound()
      .then(function (round) {
        if (round && Number.isFinite(Number(round.livePrice)) && round.livePrice > 0) {
          // Mirror the canonical live price into the local cache + series so
          // every consumer (cards, modal, OST_PREDICTION_API) reads identical
          // numbers across all browsers.
          rememberBtcTick(Number(round.livePrice), round.livePriceSource || 'ost-canonical');
          publishBtcMarketUpdate('canonical-round');
          maybeSeedTickHistory(round.openAt);
          settleClosedRounds();
          return;
        }
        // Worker round had no live price (cold start) — keep the public-feed
        // waterfall so the UI stays alive.
        return fetchBtcSpot({ force: true }).then(function () {
          try { publishBtcMarketUpdate('direct-feed'); } catch (e) {}
          settleClosedRounds();
        });
      })
      .catch(function () {
        return fetchBtcSpot({ force: true }).then(function () {
          try { publishBtcMarketUpdate('direct-feed'); } catch (e) {}
          settleClosedRounds();
        });
      });
  }

  function fetchCanonicalRound() {
    var apiBase = ostApiBase();
    if (!apiBase) return Promise.resolve(null);
    return fetch(apiBase + '/btc/round', { headers: { accept: 'application/json' }, cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (!data || !Number.isFinite(Number(data.openAt))) return null;
        canonicalRound = data;
        canonicalRoundFetchedAt = Date.now();
        try { window.__OST_CANONICAL_BTC_ROUND = data; } catch (_) {}
        try { window.dispatchEvent(new CustomEvent('ost:btc-round', { detail: data })); } catch (_) {}
        return data;
      })
      .catch(function () { return null; });
  }

  // Seed the local BTC tick series with the SHARED ring from the worker the
  // first time we see a new round id, so two users opening the modal see
  // the same chart even if one of them just landed on the page.
  function maybeSeedTickHistory(openAt) {
    if (!openAt || canonicalTicksSeededFor === openAt || canonicalTicksLoadingFor === openAt) return;
    var apiBase = ostApiBase();
    if (!apiBase) return;
    canonicalTicksLoadingFor = openAt;
    fetch(apiBase + '/btc/ticks?openAt=' + encodeURIComponent(openAt), { headers: { accept: 'application/json' }, cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (!j || !Array.isArray(j.ticks) || !j.ticks.length) return;
        // Replace local series for this round with the canonical ring so
        // every device renders the IDENTICAL chart line.
        var seeded = j.ticks
          .filter(function (t) { return Number.isFinite(Number(t && t.p)) && Number(t.p) > 1000; })
          .map(function (t) { return { ts: Number(t.t) || Date.now(), price: Number(t.p), source: t.s || 'ost-canonical' }; });
        if (!seeded.length) return;
        btcSeries = seeded.slice(-BTC_MAX_SERIES);
        var last = seeded[seeded.length - 1];
        btcLastTick = { ts: last.ts, price: last.price, source: last.source };
        canonicalTicksSeededFor = openAt;
        try { window.dispatchEvent(new CustomEvent('ost:btc-spot', { detail: Object.assign({}, btcLastTick) })); } catch (_) {}
      })
      .catch(function () { /* keep local series */ })
      .then(function () { if (canonicalTicksLoadingFor === openAt) canonicalTicksLoadingFor = 0; });
  }

  // Periodic poll so cards, charts, and close-outs all share fresh BTC data.
  setInterval(pollBtcMarket, BTC_REFRESH_MS);
  pollBtcMarket();

  function currentRoundBoundaries() {
    // Round buckets are aligned to the 5-min wall clock so ALL users see the
    // same round id and the same close time — important for auto-settlement.
    var now = Date.now();
    var openAt  = Math.floor(now / FIVE_MIN_MS) * FIVE_MIN_MS;
    var closeAt = openAt + FIVE_MIN_MS;
    return { openAt: openAt, closeAt: closeAt };
  }

  function buildFiveMinBtcMarket(refPrice) {
    var b = currentRoundBoundaries();
    var roundRecord = readRounds()[String(b.openAt)] || {};
    // Prefer the canonical worker round when it matches the current bucket so
    // EVERY browser sees the same openPrice + livePrice + YES/NO.
    var canon = canonicalRoundIsFresh() && canonicalRound && Number(canonicalRound.openAt) === b.openAt
      ? canonicalRound
      : null;
    var canonOpenPrice = canon && Number(canon.openPrice);
    var canonLivePrice = canon && Number(canon.livePrice);
    var livePrice = (Number.isFinite(canonLivePrice) && canonLivePrice > 0 ? canonLivePrice : 0) || btcLastTick.price || refPrice || roundRecord.openPrice || 0;
    var openPrice = (Number.isFinite(canonOpenPrice) && canonOpenPrice > 0 ? canonOpenPrice : 0) || Number(roundRecord.openPrice) || refPrice || livePrice || 0;
    var useCanonicalOdds = canon && Number.isFinite(Number(canon.yesPriceNumber)) && Number.isFinite(canonOpenPrice) && canonOpenPrice > 0;
    var odds;
    if (useCanonicalOdds) {
      var yes = Math.max(0.02, Math.min(0.98, Number(canon.yesPriceNumber)));
      var prevYes = btcLastOdds.roundId === ('ost-btc5m-' + b.openAt) && Number.isFinite(btcLastOdds.yes) ? btcLastOdds.yes : yes;
      btcLastOdds = { roundId: 'ost-btc5m-' + b.openAt, yes: yes, previousYes: prevYes };
      odds = {
        yes: yes,
        no: 1 - yes,
        previousYes: prevYes,
        delta: Number(canon.delta) || (livePrice - openPrice),
        deltaPct: Number(canon.deltaPct) || (openPrice > 0 ? ((livePrice - openPrice) / openPrice) * 100 : 0),
        volatilityPct: 0,
        momentumPct: 0,
        canonical: true
      };
    } else {
      odds = computeBtcOdds(openPrice, livePrice, b);
    }
    var roundId = 'ost-btc5m-' + b.openAt;
    var yesPct = (odds.yes * 100).toFixed(1) + '%';
    var noPct = (odds.no * 100).toFixed(1) + '%';
    var sourceLabel = (canon && (canon.livePriceSource || canon.source)) || btcLastTick.source || 'BTC FEED';
    sourceLabel = String(sourceLabel).toUpperCase();
    var priceToBeat = openPrice;
    var priceToBeatText = priceToBeat ? formatUsd(priceToBeat) : '$--';
    var equation = 'YES wins if BTC closes above ' + priceToBeatText + '; NO wins if BTC closes at or below ' + priceToBeatText + '.';
    return {
      source: 'ost',
      sourceLabel: 'OST 5-min BTC',
      id: roundId,
      title: '5-min BTC: will price be UP at ' + new Date(b.closeAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + '?',
      detail: 'Price to beat: ' + priceToBeatText + '. Live BTC ' + (livePrice ? formatUsd(livePrice) : '$--') + ' is ' + formatSignedUsd(odds.delta) + ' from the beat via ' + sourceLabel + '. ' + equation,
      yesLabel: 'YES (UP)',
      yesValue: yesPct,
      yesPriceNumber: odds.yes,
      noLabel: 'NO (DOWN/SAME)',
      noValue: noPct,
      noPriceNumber: odds.no,
      priceToBeat: priceToBeat,
      equation: equation,
      volumeLabel: 'Round',
      volumeValue: '5 min',
      volumeNumber: 1,
      secondaryMetricLabel: 'Price to beat',
      secondaryMetricValue: openPrice ? formatUsd(openPrice) : '--',
      secondaryMetricNumber: openPrice,
      closeText: 'Closes ' + new Date(b.closeAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      closeLabel: 'Closes',
      topic: 'crypto',
      topics: new Set(['crypto', 'all']),
      displayTopics: ['crypto'],
      searchText: 'btc bitcoin 5min five-minute ost native ' + roundId,
      primaryUrl: 'https://www.coinbase.com/price/bitcoin',
      secondaryUrl: BTC_PRICE_URL,
      secondaryLabel: 'Price feed',
      primaryLabel: 'Open Coinbase',
      contractLabel: 'OST native · 5-min round',
      sortValue: Number.MAX_SAFE_INTEGER, // pin to the top
      createdAtMs: b.openAt,
      closeAtMs: b.closeAt,
      previousYesPriceNumber: odds.previousYes,
      lastPriceNumber: odds.yes,
      oneWeekPriceChangeNumber: NaN,
      oneMonthPriceChangeNumber: NaN,
      attentionScore: 999,
      isBreaking: true,
      isOstNative: true,
      meta: {
        kind: 'btc5m',
        openPrice: openPrice,
        priceToBeat: priceToBeat,
        livePrice: livePrice,
        openAt: b.openAt,
        closeAt: b.closeAt,
        equation: equation,
        priceDelta: odds.delta,
        priceDeltaPct: odds.deltaPct,
        yesPriceNumber: odds.yes,
        noPriceNumber: odds.no,
        priceSource: (canon && (canon.livePriceSource || canon.source)) || btcLastTick.source || '',
        updatedAt: (canon && Number(canon.livePriceTs)) || btcLastTick.ts || 0,
        volatilityPct: odds.volatilityPct,
        momentumPct: odds.momentumPct
      }
    };
  }

  function buildFeaturedPlaceholder(entry) {
    return {
      source: 'polymarket',
      sourceLabel: 'Polymarket',
      id: 'featured-' + entry.slug,
      title: entry.label,
      detail: 'Curated Polymarket event — opens directly on Polymarket. Live odds load from the Polymarket Gamma feed once selected.',
      yesLabel: 'Yes',
      yesValue: '—',
      yesPriceNumber: NaN,
      noLabel: 'No',
      noValue: '—',
      noPriceNumber: NaN,
      volumeLabel: 'Volume',
      volumeValue: '—',
      volumeNumber: 0,
      secondaryMetricLabel: 'Featured',
      secondaryMetricValue: '★',
      secondaryMetricNumber: 0,
      closeText: 'See venue',
      closeLabel: 'Closes',
      topic: entry.topic,
      topics: new Set([entry.topic, 'all']),
      displayTopics: [entry.topic],
      searchText: (entry.label + ' ' + entry.slug).toLowerCase(),
      primaryUrl: 'https://polymarket.com/event/' + entry.slug,
      secondaryUrl: 'https://gamma-api.polymarket.com/events?slug=' + encodeURIComponent(entry.slug),
      secondaryLabel: 'Open feed',
      primaryLabel: 'Open on Polymarket',
      contractLabel: 'Featured · curated',
      sortValue: Number.MAX_SAFE_INTEGER - 1,
      createdAtMs: Date.now(),
      closeAtMs: 0,
      previousYesPriceNumber: NaN,
      lastPriceNumber: NaN,
      oneWeekPriceChangeNumber: NaN,
      oneMonthPriceChangeNumber: NaN,
      attentionScore: 950,
      isBreaking: false,
      isFeatured: true
    };
  }

  var existingNativeMarketBuilder = typeof window.buildOstNativeMarkets === 'function'
    ? window.buildOstNativeMarkets
    : null;

  function pushUniqueMarket(target, seen, market) {
    if (!market || !market.id || seen[market.id]) return;
    seen[market.id] = true;
    target.push(market);
  }

  // Public hook called by app.js setLoadedPredictionMarkets
  window.buildOstNativeMarkets = function buildOstNativeMarkets() {
    var out = [];
    var seen = Object.create(null);
    if (existingNativeMarketBuilder) {
      try {
        var seeded = existingNativeMarketBuilder();
        if (Array.isArray(seeded)) seeded.forEach(function (market) { pushUniqueMarket(out, seen, market); });
      } catch (error) {
        console.warn('[OST native markets]', error);
      }
    }
    pushUniqueMarket(out, seen, buildFiveMinBtcMarket());
    FEATURED_SLUGS.forEach(function (e) { pushUniqueMarket(out, seen, buildFeaturedPlaceholder(e)); });
    return out;
  };

  // ---------------------------------------------------------------------------
  // 3) Auto-resolve open OST native bets when a round closes
  //    Reads the same localStorage key used by app.js (PREDICTION_ORDERS_STORAGE_KEY)
  // ---------------------------------------------------------------------------
  var ORDERS_KEY = 'ost.prediction.orders.v1';
  function readOrders()  { try { return JSON.parse(localStorage.getItem(ORDERS_KEY) || '[]'); } catch (e) { return []; } }
  function writeOrders(o) { try { localStorage.setItem(ORDERS_KEY, JSON.stringify(o.slice(0, 200))); } catch (e) {} }

  function shareSettledOrder(order) {
    try {
      var base = ostApiBase();
      var wallet = order && (order.wallet || (window.OST_PREDICTION_API && window.OST_PREDICTION_API.walletAddress && window.OST_PREDICTION_API.walletAddress()));
      if (!base || !wallet || !order || !order.marketId) return;
      fetch(base + '/positions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(Object.assign({}, order, {
          wallet: wallet,
          marketTitle: order.title || order.marketTitle || '',
          signature: order.signature || order.sig || order.id || '',
          ts: order.createdAt || order.ts || order.resolvedAt || Date.now()
        }))
      }).catch(function () {});
    } catch (e) {}
  }

  // Track open price + close price per round id so settlement is consistent
  var ROUND_KEY = 'ost.prediction.btc5m.rounds.v1';
  function readRounds()  { try { return JSON.parse(localStorage.getItem(ROUND_KEY) || '{}'); } catch (e) { return {}; } }
  function writeRounds(o) { try { localStorage.setItem(ROUND_KEY, JSON.stringify(o)); } catch (e) {} }

  function captureRoundOpenIfNeeded(market) {
    if (!market || !market.isOstNative || !market.meta || market.meta.kind !== 'btc5m') return;
    var rounds = readRounds();
    var key = String(market.meta.openAt);
    var canonOpen = canonicalRoundIsFresh() && canonicalRound && Number(canonicalRound.openAt) === market.meta.openAt
      ? Number(canonicalRound.openPrice) || 0
      : 0;
    var openPrice = canonOpen || Number(market.meta.openPrice) || btcLastTick.price || 0;
    var existingOpen = Number(rounds[key] && rounds[key].openPrice);
    var shouldWrite = !rounds[key] || !existingOpen || (canonOpen && Math.abs(existingOpen - canonOpen) > 0.01);
    if (shouldWrite) {
      rounds[key] = {
        openPrice: openPrice,
        priceToBeat: openPrice,
        openAt: market.meta.openAt,
        closeAt: market.meta.closeAt,
        openPriceTs: (canonicalRound && Number(canonicalRound.openPriceTs)) || btcLastTick.ts || Date.now(),
        openPriceSource: (canonOpen ? 'ost-canonical' : (btcLastTick.source || ''))
      };
      writeRounds(rounds);
    }
  }

  // Snapshot the current 5-min round each tick so we always have an "open" price.
  // Tightened from 5s → 1s so the dashboard's "Open price" cell never lags
  // more than one tick behind the live BTC feed.
  setInterval(function () {
    try { publishBtcMarketUpdate('direct-feed'); } catch (e) {}
  }, 1000);

  // Also snapshot opportunistically on every fresh BTC tick so a brand-new
  // round captures its open price the instant the first tick lands instead
  // of waiting up to a full second.
  try {
    window.addEventListener('ost:btc-spot', function () {
      try { publishBtcMarketUpdate('direct-feed'); } catch (e) {}
    });
  } catch (e) {}

  var btcSettlementInFlight = false;

  function finalizeClosedBtcRounds() {
    var rounds = readRounds();
    var orders = readOrders();
    var now = Date.now();
    var changed = false;
    Object.keys(rounds).forEach(function (key) {
      var r = rounds[key];
      if (r.settled) return;
      if (now < r.closeAt + 1000) return;
      var openPrice = Number(r.openPrice);
      var closePrice = Number(btcLastTick.price);
      if (!Number.isFinite(openPrice) || openPrice <= 0) {
        r.settlementStatus = 'waiting-open-price';
        changed = true;
        return;
      }
      if (!Number.isFinite(closePrice) || closePrice <= 0) {
        r.settlementStatus = 'waiting-btc-feed';
        changed = true;
        return;
      }
      var tickIsNearClose = btcLastTick.ts >= r.closeAt - 15000;
      var roundIsOld = now - r.closeAt > 120000;
      if (!tickIsNearClose && !roundIsOld) {
        r.settlementStatus = 'waiting-close-tick';
        changed = true;
        return;
      }
      r.closePrice = r.closePrice || closePrice;
      r.closePriceTs = btcLastTick.ts || now;
      r.closePriceSource = btcLastTick.source || '';
      r.settled = true;
      r.settledAt = now;
      r.settlementStatus = 'settled';
      r.yesWon  = r.closePrice > openPrice;
      r.tied = r.closePrice === openPrice;
      changed = true;
    });
    if (changed) writeRounds(rounds);

    // Mark winning open orders as cashable
    var ordersChanged = false;
    var settledOrders = [];
    orders.forEach(function (o) {
      if (o.cashedOut || o.resolved) return;
      if (!o.marketId || o.marketId.indexOf('ost-btc5m-') !== 0) return;
      var openAt = String(o.marketId.replace('ost-btc5m-', ''));
      var r = rounds[openAt];
      if (!r || !r.settled) return;
      var side = String(o.side || 'yes').toLowerCase() === 'no' ? 'no' : 'yes';
      var won = (side === 'yes' && r.yesWon) || (side === 'no' && !r.yesWon);
      o.resolved = true;
      o.status = won ? 'won' : 'lost';
      o.outcome = won ? 'won' : 'lost';
      o.resolvedAt = Date.now();
      o.closePrice = r.closePrice;
      o.openPrice  = r.openPrice;
      o.finalYesPrice = r.yesWon ? 1 : 0;
      o.finalNoPrice = r.yesWon ? 0 : 1;
      o.settlementSource = 'ost-btc5m-' + (r.closePriceSource || 'btc-feed');
      ordersChanged = true;
      settledOrders.push(o);
    });
    if (ordersChanged) {
      writeOrders(orders);
      settledOrders.forEach(shareSettledOrder);
      try { window.dispatchEvent(new CustomEvent('ost:prediction-rounds-settled')); } catch (e) {}
      try { window.dispatchEvent(new CustomEvent('ost:prediction:order-changed')); } catch (e) {}
    }
  }

  function settleClosedRounds() {
    if (btcSettlementInFlight) return;
    var rounds = readRounds();
    var now = Date.now();
    var due = Object.keys(rounds).some(function (key) {
      var r = rounds[key];
      return r && !r.settled && now >= Number(r.closeAt || 0) + 1000;
    });
    if (!due) return;
    btcSettlementInFlight = true;
    fetchBtcSpot({ force: true })
      .then(finalizeClosedBtcRounds)
      .catch(finalizeClosedBtcRounds)
      .finally(function () { btcSettlementInFlight = false; });
  }
  setInterval(settleClosedRounds, 4000);

  // ---------------------------------------------------------------------------
  // 4) Detail modal — chart + recent trades + depth + place-bet shortcut
  // ---------------------------------------------------------------------------
  var DETAIL_MODAL_ID = 'ost-prediction-detail-modal';

  function getMarketStateById(id) {
    // Read out of app.js's prediction state via the rendered DOM, since
    // app.js doesn't export the markets array. Falls back to a stub.
    var card = document.querySelector('[data-prediction-market-id="' + (id || '').replace(/"/g, '\\"') + '"]');
    if (!card) return null;
    return {
      id: id,
      title: (card.querySelector('h5') && card.querySelector('h5').textContent) || id,
      sourceLabel: (card.querySelector('.prediction-market-source') && card.querySelector('.prediction-market-source').textContent.trim()) || '',
      yesText: (card.querySelector('.prediction-market-bar-fill') && card.querySelector('.prediction-market-bar-fill').style.width) || '',
      detail: (card.querySelector('p') && card.querySelector('p').textContent) || ''
    };
  }

  function ensureDetailModal() {
    var el = document.getElementById(DETAIL_MODAL_ID);
    if (el) return el;
    el = document.createElement('div');
    el.id = DETAIL_MODAL_ID;
    el.className = 'ost-prodetail-modal';
    el.innerHTML = [
      '<div class="ost-prodetail-backdrop"></div>',
      '<div class="ost-prodetail-panel" role="dialog" aria-modal="true">',
      '  <button class="ost-prodetail-close" aria-label="Close">×</button>',
      '  <div class="ost-prodetail-body"></div>',
      '</div>'
    ].join('');
    document.body.appendChild(el);
    el.querySelector('.ost-prodetail-backdrop').addEventListener('click', closeDetailModal);
    el.querySelector('.ost-prodetail-close').addEventListener('click', closeDetailModal);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeDetailModal(); });
    return el;
  }
  function openDetailModalHtml(html) {
    var el = ensureDetailModal();
    el.querySelector('.ost-prodetail-body').innerHTML = html;
    el.classList.add('is-open');
  }
  function closeDetailModal() {
    var el = document.getElementById(DETAIL_MODAL_ID);
    if (el) el.classList.remove('is-open');
  }

  // Synthetic but deterministic recent-trades feed seeded by market id
  function rngSeed(seed) {
    var s = 0;
    for (var i = 0; i < seed.length; i++) s = (s * 31 + seed.charCodeAt(i)) | 0;
    return function () { s = (s * 1664525 + 1013904223) | 0; return ((s >>> 0) % 100000) / 100000; };
  }
  function buildRecentTrades(market, count) {
    var rng = rngSeed(market.id || 'unk');
    var basePrice = Number(market.yesPriceNumber);
    if (!Number.isFinite(basePrice)) basePrice = 0.5;
    var trades = [];
    var now = Date.now();
    for (var i = 0; i < count; i++) {
      var drift = (rng() - 0.5) * 0.04;
      var px = Math.max(0.02, Math.min(0.98, basePrice + drift));
      var side = rng() > 0.5 ? 'YES' : 'NO';
      var size = Math.round((10 + rng() * 250) * 10) / 10;
      var ts = now - i * (15000 + Math.floor(rng() * 90000));
      trades.push({ ts: ts, side: side, price: side === 'YES' ? px : 1 - px, size: size });
    }
    return trades;
  }
  function buildPriceHistory(market, points) {
    var rng = rngSeed((market.id || 'unk') + ':hist');
    var basePrice = Number(market.yesPriceNumber);
    if (!Number.isFinite(basePrice)) basePrice = 0.5;
    var v = Math.max(0.05, Math.min(0.95, basePrice - 0.06));
    var pts = [];
    for (var k = 0; k < points; k++) {
      v = Math.max(0.02, Math.min(0.98, v + (rng() - 0.5) * 0.05));
      pts.push(v);
    }
    pts[pts.length - 1] = basePrice;
    return pts;
  }

  function drawDetailChart(canvas, pts, color) {
    var ctx = canvas.getContext('2d');
    var w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    if (!pts || !pts.length) return;
    // Gridlines
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    for (var i = 1; i < 4; i++) {
      var y = (i / 4) * h;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }
    // Fill
    var min = Math.min.apply(null, pts), max = Math.max.apply(null, pts);
    var range = Math.max(0.001, max - min);
    var grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, (color || '#6ce6a4') + '55');
    grad.addColorStop(1, (color || '#6ce6a4') + '00');
    ctx.fillStyle = grad;
    ctx.beginPath();
    pts.forEach(function (p, i) {
      var x = (i / (pts.length - 1)) * w;
      var y = h - ((p - min) / range) * (h - 8) - 4;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath();
    ctx.fill();
    // Line
    ctx.strokeStyle = color || '#6ce6a4';
    ctx.lineWidth = 2;
    ctx.beginPath();
    pts.forEach(function (p, i) {
      var x = (i / (pts.length - 1)) * w;
      var y = h - ((p - min) / range) * (h - 8) - 4;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }
  function fmtTime(ts) {
    var d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  function showDetail(market) {
    if (!market) return;
    var yes = Number(market.yesPriceNumber);
    var no  = Number(market.noPriceNumber);
    var yesPct = Number.isFinite(yes) ? Math.round(yes * 100) : '—';
    var noPct  = Number.isFinite(no)  ? Math.round(no * 100)  : '—';
    var trades = buildRecentTrades(market, 18);
    var hist = buildPriceHistory(market, 80);

    var rowsHtml = trades.map(function (t) {
      var color = t.side === 'YES' ? '#34d399' : '#f87171';
      return '<tr>' +
        '<td>' + escapeHtml(fmtTime(t.ts)) + '</td>' +
        '<td style="color:' + color + ';font-weight:700;">' + escapeHtml(t.side) + '</td>' +
        '<td>' + (t.price * 100).toFixed(1) + '¢</td>' +
        '<td>' + t.size.toFixed(1) + ' OST</td>' +
        '</tr>';
    }).join('');

    var depthHtml =
      '<div class="ost-prodetail-depth">' +
        '<div class="ost-prodetail-depth-side ost-prodetail-depth-yes">' +
          '<div class="ost-prodetail-depth-label">YES bids</div>' +
          [1,2,3,4].map(function (i) {
            var p = Math.max(0.02, (Number.isFinite(yes)?yes:0.5) - i * 0.01);
            var sz = (60 + Math.random() * 200).toFixed(0);
            return '<div class="ost-prodetail-depth-row"><span>' + (p * 100).toFixed(1) + '¢</span><span>' + sz + ' OST</span></div>';
          }).join('') +
        '</div>' +
        '<div class="ost-prodetail-depth-side ost-prodetail-depth-no">' +
          '<div class="ost-prodetail-depth-label">NO bids</div>' +
          [1,2,3,4].map(function (i) {
            var p = Math.max(0.02, (Number.isFinite(no)?no:0.5) - i * 0.01);
            var sz = (60 + Math.random() * 200).toFixed(0);
            return '<div class="ost-prodetail-depth-row"><span>' + (p * 100).toFixed(1) + '¢</span><span>' + sz + ' OST</span></div>';
          }).join('') +
        '</div>' +
      '</div>';

    var btcInfo = '';
    if (market.isOstNative && market.meta && market.meta.kind === 'btc5m') {
      var msLeft = Math.max(0, market.meta.closeAt - Date.now());
      var mm = Math.floor(msLeft / 60000), ss = Math.floor((msLeft % 60000) / 1000);
      btcInfo =
        '<div class="ost-prodetail-btc5m">' +
          '<div><span class="ost-prodetail-tag">5-min round</span> Closes in <strong id="ost-prodetail-countdown">' + mm + ':' + (ss < 10 ? '0' : '') + ss + '</strong></div>' +
          '<div>Open price: <strong>$' + (market.meta.openPrice ? market.meta.openPrice.toFixed(2) : '—') + '</strong></div>' +
          '<div>Live BTC: <strong id="ost-prodetail-btclive">$' + (btcLastTick.price ? btcLastTick.price.toFixed(2) : '—') + '</strong></div>' +
        '</div>';
    }

    openDetailModalHtml([
      '<div class="ost-prodetail-head">',
        '<span class="ost-prodetail-tag">' + escapeHtml(market.sourceLabel || market.source || '') + '</span>',
        '<span class="ost-prodetail-tag">' + escapeHtml(market.contractLabel || '') + '</span>',
        '<span class="ost-prodetail-tag ost-prodetail-tag-close">' + escapeHtml(market.closeText || '') + '</span>',
      '</div>',
      '<h2>' + escapeHtml(market.title || '') + '</h2>',
      '<p class="ost-prodetail-sub">' + escapeHtml(market.detail || '') + '</p>',
      btcInfo,
      '<div class="ost-prodetail-prices">',
        '<div class="ost-prodetail-price ost-prodetail-yes"><span>' + escapeHtml(market.yesLabel || 'YES') + '</span><strong>' + yesPct + '%</strong></div>',
        '<div class="ost-prodetail-price ost-prodetail-no"><span>' + escapeHtml(market.noLabel || 'NO') + '</span><strong>' + noPct + '%</strong></div>',
      '</div>',
      '<canvas class="ost-prodetail-chart" id="ost-prodetail-chart" width="640" height="200"></canvas>',
      '<div class="ost-prodetail-grid">',
        '<div class="ost-prodetail-trades">',
          '<h4>Recent ticks</h4>',
          '<div class="ost-prodetail-trades-scroll"><table class="ost-prodetail-trades-table">',
            '<thead><tr><th>Time</th><th>Side</th><th>Price</th><th>Size</th></tr></thead>',
            '<tbody>' + rowsHtml + '</tbody>',
          '</table></div>',
        '</div>',
        '<div class="ost-prodetail-book">',
          '<h4>Order book preview</h4>',
          depthHtml,
        '</div>',
      '</div>',
      '<div class="ost-prodetail-actions">',
        (market.primaryUrl ? '<a class="ost-prodetail-link" href="' + escapeHtml(market.primaryUrl) + '" target="_blank" rel="noopener">Open venue ↗</a>' : ''),
        '<button type="button" class="ost-prodetail-bet ost-prodetail-yes-btn" data-prodetail-side="yes">Buy YES with OST</button>',
        '<button type="button" class="ost-prodetail-bet ost-prodetail-no-btn"  data-prodetail-side="no">Buy NO with OST</button>',
      '</div>'
    ].join(''));

    var canvas = document.getElementById('ost-prodetail-chart');
    if (canvas) drawDetailChart(canvas, hist, '#6ce6a4');

    // Wire bet buttons → drive the existing trade desk
    var modal = document.getElementById(DETAIL_MODAL_ID);
    Array.prototype.slice.call(modal.querySelectorAll('[data-prodetail-side]')).forEach(function (b) {
      b.addEventListener('click', function () {
        var side = b.getAttribute('data-prodetail-side');
        // Select the market in the main trade desk
        var card = document.querySelector('[data-prediction-market-id="' + (market.id || '').replace(/"/g, '\\"') + '"]');
        if (card) card.click();
        var sideToggle = document.getElementById('predictionOutcomeToggle');
        if (sideToggle) {
          var btn = sideToggle.querySelector('button[data-prediction-side="' + side + '"]');
          if (btn) btn.click();
        }
        closeDetailModal();
        var ticket = document.getElementById('predictionStakeInput') || document.querySelector('.prediction-trade-card');
        if (ticket && ticket.scrollIntoView) ticket.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    });

    // Live countdown for the 5-min round
    if (market.isOstNative && market.meta && market.meta.kind === 'btc5m') {
      var iv = setInterval(function () {
        var el = document.getElementById('ost-prodetail-countdown');
        var live = document.getElementById('ost-prodetail-btclive');
        if (!el) { clearInterval(iv); return; }
        var msLeft = Math.max(0, market.meta.closeAt - Date.now());
        var mm = Math.floor(msLeft / 60000), ss = Math.floor((msLeft % 60000) / 1000);
        el.textContent = mm + ':' + (ss < 10 ? '0' : '') + ss;
        if (live && btcLastTick.price) live.textContent = '$' + btcLastTick.price.toFixed(2);
        if (msLeft <= 0) clearInterval(iv);
      }, 500);
    }
  }

  // ---------------------------------------------------------------------------
  // 5) Inject a "Details" button on every market card
  // ---------------------------------------------------------------------------
  function findMarketByIdFromAppState(id) {
    // app.js doesn't expose state, so reconstruct a usable market object
    // by reading it from the DOM card.
    var card = document.querySelector('[data-prediction-market-id="' + id.replace(/"/g, '\\"') + '"]');
    if (!card) return null;
    var srcLabel = (card.querySelector('.prediction-market-source') && card.querySelector('.prediction-market-source').textContent.trim()) || '';
    var yesValue = (card.querySelector('.prediction-market-price strong') && card.querySelector('.prediction-market-price strong').textContent.trim()) || '';
    var noValue  = (card.querySelectorAll('.prediction-market-price strong')[1] && card.querySelectorAll('.prediction-market-price strong')[1].textContent.trim()) || '';
    var titleEl  = card.querySelector('h5');
    var detailEl = card.querySelector('.prediction-market-copy p');
    var closeEl  = card.querySelector('.prediction-market-meta-row .prediction-market-metric:last-child strong');
    var yesNum = parseFloat(yesValue) / 100; if (!Number.isFinite(yesNum)) yesNum = NaN;
    var noNum  = parseFloat(noValue)  / 100; if (!Number.isFinite(noNum))  noNum  = NaN;
    var isOstBtc = id.indexOf('ost-btc5m-') === 0;
    var market = {
      id: id,
      title: titleEl ? titleEl.textContent.trim() : id,
      detail: detailEl ? detailEl.textContent.trim() : '',
      sourceLabel: srcLabel,
      source: srcLabel.toLowerCase(),
      yesLabel: 'YES', noLabel: 'NO',
      yesPriceNumber: yesNum, noPriceNumber: noNum,
      closeText: closeEl ? closeEl.textContent.trim() : '',
      contractLabel: '',
      primaryUrl: (card.querySelector('.prediction-market-link') && card.querySelector('.prediction-market-link').href) || ''
    };
    if (isOstBtc) {
      // re-derive open/close from id
      var openAt = parseInt(id.replace('ost-btc5m-', ''), 10);
      market.isOstNative = true;
      market.meta = { kind: 'btc5m', openAt: openAt, closeAt: openAt + FIVE_MIN_MS, openPrice: (readRounds()[String(openAt)] || {}).openPrice || 0 };
    }
    return market;
  }

  function injectDetailButtons() {
    var cards = document.querySelectorAll('article.prediction-market-card[data-prediction-market-id]');
    cards.forEach(function (card) {
      if (card.closest('#predictionMarketBoard')) return;
      if (card.querySelector('.ost-prodetail-trigger')) return;
      var actions = card.querySelector('.prediction-market-actions');
      if (!actions) return;
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'prediction-market-link ost-prodetail-trigger';
      btn.textContent = '📊 Details';
      btn.style.cursor = 'pointer';
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        var id = card.getAttribute('data-prediction-market-id') || '';
        var m = findMarketByIdFromAppState(id);
        if (m) showDetail(m);
      });
      actions.appendChild(btn);
    });
  }

  // Watch the prediction list and re-inject buttons whenever it re-renders
  function startInjector() {
    injectDetailButtons();
    var listEl = document.getElementById('predictionMarketList') ||
                 document.querySelector('.prediction-market-list') ||
                 document.querySelector('.prediction-market-board');
    if (!listEl) {
      // try again later — board may not be mounted yet
      setTimeout(startInjector, 1500);
      return;
    }
    var obs = new MutationObserver(function () { injectDetailButtons(); });
    obs.observe(listEl, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startInjector);
  } else {
    startInjector();
  }

  // Force a re-fetch so the native 5-min BTC market and curated featured
  // events appear on the very first board render (app.js may have already
  // loaded its market list before this script's `buildOstNativeMarkets` was
  // defined on the window).
  function triggerReload() {
    var refreshBtn = document.getElementById('predictionMarketRefresh');
    if (refreshBtn) { refreshBtn.click(); return; }
    // Best-effort: dispatch a custom event app.js doesn't listen for, but
    // the 120s interval will pick the native markets up regardless.
  }
  setTimeout(triggerReload, 800);
  setTimeout(triggerReload, 3000);

  // ---------------------------------------------------------------------------
  // 6) Public bot / arbitrage API — read-only feed access + place ticket
  // ---------------------------------------------------------------------------
  // Bots can call:
  //   await OST_PREDICTION_API.markets()                  → live merged list
  //   OST_PREDICTION_API.subscribe(cb)                    → receive snapshots
  //   await OST_PREDICTION_API.placeBet({marketId,side,stake})
  //   OST_PREDICTION_API.btcSpot()                        → latest cached price
  //   OST_PREDICTION_API.btcSeries()                      → recent BTC ticks
  //   OST_PREDICTION_API.fiveMinRound()                   → current btc5m round
  //   OST_PREDICTION_API.ledger()                         → user's open orders
  // ---------------------------------------------------------------------------
  var subscribers = [];
  function broadcast() {
    OST_PREDICTION_API.markets().then(function (m) {
      subscribers.forEach(function (cb) { try { cb(m); } catch (e) {} });
    });
  }
  setInterval(broadcast, 30000);

  var OST_PREDICTION_API = {
    version: '1.1',
    btcSpot: function (options) {
      return options && options.force
        ? fetchBtcSpot({ force: true })
        : Promise.resolve(Object.assign({}, btcLastTick));
    },
    btcSeries: function () { return btcSeries.slice(); },
    canonicalRound: function () { return canonicalRoundIsFresh() ? Object.assign({}, canonicalRound) : null; },
    refreshCanonicalRound: function () { return fetchCanonicalRound(); },
    fiveMinRound: function () {
      var b = currentRoundBoundaries();
      var market = buildFiveMinBtcMarket();
      var rounds = readRounds();
      var rec = rounds[String(b.openAt)] || {};
      return Object.assign({}, rec, market.meta || {}, {
        id: market.id,
        openAt: b.openAt,
        closeAt: b.closeAt,
        yesPriceNumber: market.yesPriceNumber,
        noPriceNumber: market.noPriceNumber,
        yesValue: market.yesValue,
        noValue: market.noValue,
        price: market.yesPriceNumber,
        livePrice: market.meta && market.meta.livePrice,
        source: market.meta && market.meta.priceSource,
        updatedAt: market.meta && market.meta.updatedAt
      });
    },
    markets: function () {
      // Direct fetch from Polymarket Gamma API (via relay if configured) +
      // OST API worker snapshot for any proxied Kalshi rows. Never call the
      // Kalshi public API from the browser; it is CORS-blocked and creates
      // noisy failed requests every broadcast cycle.
      var apiBase = ostApiBase();
      var kalshiSnapshot = apiBase
        ? fetch(apiBase + '/markets?limit=160', { headers: { accept: 'application/json' }, cache: 'no-store' })
            .then(function (r) { return r.ok ? r.json() : { markets: [] }; })
            .catch(function () { return { markets: [] }; })
        : Promise.resolve({ markets: [] });
      return Promise.all([
        fetch(pmGammaUrl('/markets', 'limit=160&closed=false')).then(function (r) { return r.ok ? r.json() : []; }).catch(function () { return []; }),
        kalshiSnapshot
      ]).then(function (results) {
        var workerMarkets = Array.isArray(results[1] && results[1].markets) ? results[1].markets : [];
        return {
          ts: Date.now(),
          relay: !!relayBase(),
          ostNative: window.buildOstNativeMarkets ? window.buildOstNativeMarkets() : [],
          polymarket: Array.isArray(results[0]) ? results[0] : (results[0].data || []),
          kalshi: workerMarkets.filter(function (m) { return m && m.source === 'kalshi'; })
        };
      });
    },
    // Direct CLOB helpers — bots can use these for arbitrage decisions
    clobBook: function (tokenId)        { return fetch(pmClobUrl('/book/' + encodeURIComponent(tokenId))).then(function (r) { return r.ok ? r.json() : null; }); },
    clobPrice: function (tokenId, side) { return fetch(pmClobUrl('/price/' + encodeURIComponent(tokenId) + '/' + (side === 'sell' ? 'sell' : 'buy'))).then(function (r) { return r.ok ? r.json() : null; }); },
    clobTrades: function (marketId)     { return fetch(pmClobUrl('/trades', 'market=' + encodeURIComponent(marketId))).then(function (r) { return r.ok ? r.json() : null; }); },
    pricesHistory: function (marketId, intervalParam) { return fetch(pmDataUrl('/prices-history/' + encodeURIComponent(marketId), intervalParam || 'interval=1d')).then(function (r) { return r.ok ? r.json() : null; }); },
    relayUrl: function () { return relayBase() || null; },
    subscribe: function (cb) {
      if (typeof cb !== 'function') return function () {};
      subscribers.push(cb);
      return function () { subscribers = subscribers.filter(function (x) { return x !== cb; }); };
    },
    ledger: function () {
      try { return JSON.parse(localStorage.getItem(ORDERS_KEY) || '[]'); } catch (e) { return []; }
    },
    settledRounds: function () { return readRounds(); },
    placeBet: function (req) {
      // External bots reuse the SAME on-chain path as the UI - they must
      // pass an already-connected wallet (Phantom / Backpack) by calling
      // window.connectWallet first, otherwise we can't sign.
      if (!req || !req.marketId || !req.side || !Number.isFinite(Number(req.stake))) {
        return Promise.reject(new Error('placeBet requires { marketId, side, stake }'));
      }
      var marketId = String(req.marketId);
      var side = String(req.side).toLowerCase() === 'no' ? 'no' : 'yes';
      var card = document.querySelector('[data-prediction-market-id="' + marketId.replace(/"/g, '\\"') + '"]');
      if (!card) return Promise.reject(new Error('Market not loaded in current snapshot'));
      card.click();
      var sideToggle = document.getElementById('predictionOutcomeToggle');
      if (sideToggle) {
        var sb = sideToggle.querySelector('button[data-prediction-side="' + side + '"]');
        if (sb) sb.click();
      }
      var stakeInput = document.getElementById('predictionStakeInput');
      if (stakeInput) {
        stakeInput.value = String(req.stake);
        stakeInput.dispatchEvent(new Event('input', { bubbles: true }));
        stakeInput.dispatchEvent(new Event('change', { bubbles: true }));
      }
      return new Promise(function (resolve, reject) {
        var actionBtn = document.getElementById('predictionTradeAction') || document.querySelector('[data-prediction-trade-action]');
        if (!actionBtn) return reject(new Error('Trade action button not found'));
        var done = false;
        var iv = null;
        var timeout = null;
        function cleanup() {
          if (iv) clearInterval(iv);
          if (timeout) clearTimeout(timeout);
          try { window.removeEventListener('ost:prediction-order-recorded', onRecorded); } catch (e) {}
        }
        function finish(record) {
          if (done) return;
          done = true;
          cleanup();
          resolve(record);
        }
        function fail(error) {
          if (done) return;
          done = true;
          cleanup();
          reject(error);
        }
        function onRecorded(event) {
          var record = event && event.detail;
          if (!record || String(record.marketId || '') !== marketId) return;
          finish(record);
        }
        var prev = OST_PREDICTION_API.ledger().length;
        try { window.addEventListener('ost:prediction-order-recorded', onRecorded); } catch (e) {}
        actionBtn.click();
        timeout = setTimeout(function () { fail(new Error('Bet timed out')); }, 45000);
        iv = setInterval(function () {
          var now = OST_PREDICTION_API.ledger();
          if (now.length > prev) {
            var latest = now.filter(function (order) { return order && String(order.marketId || '') === marketId; })[0] || now[0];
            finish(latest);
          }
        }, 500);
      });
    }
  };
  window.OST_PREDICTION_API = Object.assign(window.OST_PREDICTION_API || {}, OST_PREDICTION_API);
})();

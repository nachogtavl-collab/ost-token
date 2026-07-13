/* ==========================================================================
 * OST · Fast Markets — ETH & SOL 5-minute up/down rounds
 * --------------------------------------------------------------------------
 * Extends the beloved 5-min BTC market to more coins. Same mechanics:
 * clock-aligned 5-minute rounds, YES wins if price closes above the round's
 * open, NO wins otherwise. Settlement is deterministic for every user
 * because both the open and close come from the same public Binance 5-min
 * kline (with binance.vision and Coinbase spot fallbacks) — no server
 * needed, everyone sees identical numbers.
 *
 * Integration points (all existing rails, nothing forked):
 *  - Markets are injected by chaining window.buildOstNativeMarkets(), the
 *    same hook native-markets.js uses, so cards render in the normal list.
 *  - Bets flow through OST_PREDICTION_API.placeOrder → real OST moves to
 *    the settlement vault with a signature, and the order lands in
 *    `ost.prediction.orders.v1` like every other ticket.
 *  - On round close this module marks those orders won/lost; the existing
 *    ledger then shows "Claim win" which pays from the vault.
 *  - Odds use the same volatility/momentum logistic as the BTC hub.
 * ========================================================================== */
(function () {
  'use strict';

  var FIVE_MIN = 5 * 60 * 1000;
  var ORDERS_KEY = 'ost.prediction.orders.v1';
  var POLL_MS = 5000;
  var SETTLE_SCAN_MS = 15000;

  var COINS = [
    {
      key: 'eth5m',
      idPrefix: 'ost-eth5m-',
      symbol: 'ETHUSDT',
      name: 'Ethereum',
      short: 'ETH',
      coinbase: 'ETH-USD',
      externalUrl: 'https://www.coinbase.com/price/ethereum'
    },
    {
      key: 'sol5m',
      idPrefix: 'ost-sol5m-',
      symbol: 'SOLUSDT',
      name: 'Solana',
      short: 'SOL',
      coinbase: 'SOL-USD',
      externalUrl: 'https://www.coinbase.com/price/solana'
    }
  ];

  // Per-coin live state
  var live = {};
  COINS.forEach(function (c) {
    live[c.key] = { openAt: 0, closeAt: 0, openPrice: 0, price: 0, ticks: [], source: '', quoteVolume24h: 0 };
  });

  function boundaries(now) {
    var t = now || Date.now();
    var openAt = Math.floor(t / FIVE_MIN) * FIVE_MIN;
    return { openAt: openAt, closeAt: openAt + FIVE_MIN };
  }

  // ------------------------------------------------------------------ feeds
  function fetchJson(url, timeoutMs) {
    return new Promise(function (resolve, reject) {
      var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var timer = setTimeout(function () { if (ctrl) ctrl.abort(); reject(new Error('timeout')); }, timeoutMs || 4000);
      fetch(url, { cache: 'no-store', signal: ctrl ? ctrl.signal : undefined })
        .then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.json(); })
        .then(function (j) { clearTimeout(timer); resolve(j); })
        .catch(function (e) { clearTimeout(timer); reject(e); });
    });
  }

  // api.binance.com is CORS-BLOCKED from the browser (and geo-blocked for some
  // testers), yet it used to be tried FIRST — so every single poll burned a
  // guaranteed failure (~200ms) before falling back. That is a big part of the
  // "lag / guessing / waiting on new data". Order now: OST worker relay (edge,
  // always reachable, 1s cache) -> binance.vision -> coinbase.
  function relayBase() {
    var b = (typeof window !== 'undefined' && window.OST_API_BASE) || '';
    return b ? String(b).replace(/\/$/, '') : '';
  }

  function fetchSpot(coin) {
    var rb = relayBase();
    var feeds = [
      { url: 'https://data-api.binance.vision/api/v3/ticker/price?symbol=' + coin.symbol, pick: function (j) { return Number(j && j.price); }, name: 'binance-vision' },
      { url: 'https://api.coinbase.com/v2/prices/' + coin.coinbase + '/spot', pick: function (j) { return Number(j && j.data && j.data.amount); }, name: 'coinbase' }
    ];
    // Last resort for regions where BOTH Binance and Coinbase are blocked:
    // the OST worker's Coinbase-backed /spot (Binance 403s the edge, so it
    // cannot be relayed).
    if (rb) feeds.push({ url: rb + '/spot?symbol=' + coin.symbol, pick: function (j) { return Number(j && j.price); }, name: 'ost-spot' });
    var i = 0;
    function next() {
      if (i >= feeds.length) return Promise.resolve(null);
      var f = feeds[i++];
      return fetchJson(f.url, 3500).then(function (j) {
        var p = f.pick(j);
        return (Number.isFinite(p) && p > 0) ? { price: p, source: f.name } : next();
      }).catch(next);
    }
    return next();
  }

  // Kline for a specific round — the shared source of truth for open/close.
  function fetchKline(coin, openAt) {
    var q = '?symbol=' + coin.symbol + '&interval=5m&limit=1&startTime=' + openAt;
    // Settlement source stays the Binance 5m kline (deterministic for everyone).
    // api.binance.com is CORS-blocked from the browser; binance.vision is not.
    var urls = ['https://data-api.binance.vision/api/v3/klines' + q];
    var i = 0;
    function next() {
      if (i >= urls.length) return Promise.resolve(null);
      return fetchJson(urls[i++], 4000).then(function (rows) {
        var row = Array.isArray(rows) && Array.isArray(rows[0]) ? rows[0] : null;
        if (!row || Number(row[0]) !== openAt) return next();
        return { openAt: Number(row[0]), open: Number(row[1]), close: Number(row[4]) };
      }).catch(next);
    }
    return next();
  }

  // ------------------------------------------------------------ odds (same
  // volatility/momentum logistic the BTC NativeMarketHub uses server-side)
  function estimateVolatilityPct(ticks) {
    var cutoff = Date.now() - 45000;
    var recent = ticks.filter(function (t) { return t.ts >= cutoff && t.price > 0; });
    if (recent.length < 3) return 0.025;
    var returns = [];
    for (var i = 1; i < recent.length; i++) {
      var prev = recent[i - 1].price, nxt = recent[i].price;
      if (prev > 0 && nxt > 0) returns.push(Math.abs((nxt - prev) / prev) * 100);
    }
    if (!returns.length) return 0.025;
    var avg = returns.reduce(function (s, v) { return s + v; }, 0) / returns.length;
    var prices = recent.map(function (t) { return t.price; });
    var span = ((Math.max.apply(null, prices) - Math.min.apply(null, prices)) / recent[recent.length - 1].price) * 100;
    return Math.max(0.018, Math.min(0.45, avg * 8 + span * 0.55));
  }

  function estimateMomentumPct(ticks) {
    if (ticks.length < 2) return 0;
    var latest = ticks[ticks.length - 1];
    var cutoff = latest.ts - 15000;
    var anchor = ticks[0];
    for (var i = ticks.length - 1; i >= 0; i--) {
      if (ticks[i].ts <= cutoff) { anchor = ticks[i]; break; }
    }
    if (!anchor || !anchor.price || !latest.price) return 0;
    return ((latest.price - anchor.price) / anchor.price) * 100;
  }

  function computeYesOdds(st) {
    var yes = 0.5;
    if (st.openPrice > 0 && st.price > 0) {
      var deltaPct = ((st.price - st.openPrice) / st.openPrice) * 100;
      var msLeft = Math.max(0, Math.min(st.closeAt - Date.now(), FIVE_MIN));
      var timeLeftRatio = msLeft / FIVE_MIN;
      var vol = estimateVolatilityPct(st.ticks);
      var mom = estimateMomentumPct(st.ticks);
      var scale = Math.max(0.012, vol * Math.sqrt(Math.max(timeLeftRatio, 0.08)) * 2.4);
      var score = Math.max(-4.5, Math.min(4.5, (deltaPct + mom * 0.22) / scale));
      yes = 1 / (1 + Math.exp(-score));
      var confidence = 0.70 + (1 - timeLeftRatio) * 0.25;
      yes = 0.5 + (yes - 0.5) * confidence;
      if (Math.abs(st.price - st.openPrice) < st.openPrice * 0.00002) yes = 0.5 + (yes - 0.5) * 0.35;
      yes = Math.max(0.03, Math.min(0.97, yes));
    }
    return yes;
  }

  // ---------------------------------------------------------------- polling
  function tickCoin(coin) {
    var st = live[coin.key];
    var b = boundaries();
    if (st.openAt !== b.openAt) {
      st.openAt = b.openAt;
      st.closeAt = b.closeAt;
      st.openPrice = 0;
      st.ticks = [];
      // Authoritative open from the kline
      fetchKline(coin, b.openAt).then(function (k) {
        if (k && k.open > 0) st.openPrice = k.open;
      });
    }
    fetchSpot(coin).then(function (tick) {
      if (!tick) return;
      st.price = tick.price;
      st.source = tick.source;
      st.ticks.push({ ts: Date.now(), price: tick.price });
      if (st.ticks.length > 240) st.ticks = st.ticks.slice(-240);
      if (!st.openPrice && (Date.now() - st.openAt) < 4000) st.openPrice = tick.price;
    });
  }

  function refreshDayVolume(coin) {
    var st = live[coin.key];
    var urls = ['https://data-api.binance.vision/api/v3/ticker/24hr?symbol=' + coin.symbol];
    var i = 0;
    function next() {
      if (i >= urls.length) return Promise.resolve(null);
      return fetchJson(urls[i++], 4000).then(function (j) {
        var v = Number(j && j.quoteVolume);
        if (Number.isFinite(v) && v > 0) { st.quoteVolume24h = v; return v; }
        return next();
      }).catch(next);
    }
    return next();
  }

  // ---------------------------------------------------- market card builder
  function fmtUsd(n) {
    if (!Number.isFinite(n) || n <= 0) return '—';
    return '$' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function buildMarket(coin) {
    var st = live[coin.key];
    var b = boundaries();
    var yes = computeYesOdds(st);
    var closeLabel = new Date(b.closeAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    var beat = st.openPrice || st.price || 0;
    return {
      id: coin.idPrefix + b.openAt,
      isOstNative: true,
      source: 'ost',
      sourceLabel: 'OST 5-min ' + coin.short,
      title: '5-min ' + coin.short + ': will price be UP at ' + closeLabel + '?',
      detail: 'Price to beat: ' + fmtUsd(beat) + '. YES wins if ' + coin.short + ' closes above the price to beat; NO wins if it closes at or below it. Settles against the Binance 5-minute candle.',
      topic: 'crypto',
      displayTopics: ['Crypto', coin.short, 'Fast'],
      contractLabel: 'OST native · 5-min round',
      yesLabel: 'YES (UP)',
      noLabel: 'NO (DOWN/SAME)',
      yesValue: Math.round(yes * 100) + '%',
      noValue: Math.round((1 - yes) * 100) + '%',
      yesPriceNumber: yes,
      noPriceNumber: 1 - yes,
      volumeNumber: st.quoteVolume24h || 0,
      volumeValue: st.quoteVolume24h ? '$' + (st.quoteVolume24h / 1e9).toFixed(2) + 'B · Binance 24h' : 'Live',
      secondaryMetricLabel: 'Underlying 24h volume',
      secondaryMetricValue: st.quoteVolume24h ? '$' + (st.quoteVolume24h / 1e9).toFixed(2) + 'B' : '—',
      secondaryMetricNumber: st.quoteVolume24h || 0,
      closeText: 'Closes ' + closeLabel,
      closeAtMs: b.closeAt,
      primaryUrl: coin.externalUrl,
      primaryLabel: 'Open Coinbase',
      meta: {
        kind: 'fast5m',
        coin: coin.key,
        symbol: coin.symbol,
        openAt: b.openAt,
        closeAt: b.closeAt,
        openPrice: st.openPrice,
        priceToBeat: beat,
        livePrice: st.price,
        yesPriceNumber: yes,
        noPriceNumber: 1 - yes,
        priceSource: st.source,
        equation: 'YES wins if ' + coin.short + ' closes above ' + fmtUsd(beat) + '; NO wins if it closes at or below it.'
      },
      raw: { fastMarket: true, coin: coin.key }
    };
  }

  // Chain the existing native-markets hook so our cards join the same list.
  var prevBuilder = window.buildOstNativeMarkets;
  window.buildOstNativeMarkets = function () {
    var base = [];
    try { base = (typeof prevBuilder === 'function' && prevBuilder()) || []; } catch (_) { base = []; }
    try {
      COINS.forEach(function (c) { base.push(buildMarket(c)); });
    } catch (_) {}
    return base;
  };

  // -------------------------------------------------------------- settlement
  function readOrders() {
    try { return JSON.parse(localStorage.getItem(ORDERS_KEY) || '[]') || []; } catch (_) { return []; }
  }
  function writeOrders(arr) {
    try { localStorage.setItem(ORDERS_KEY, JSON.stringify(arr.slice(-500))); } catch (_) {}
  }

  function coinForOrder(order) {
    var id = String(order && order.marketId || '');
    for (var i = 0; i < COINS.length; i++) {
      if (id.indexOf(COINS[i].idPrefix) === 0) return COINS[i];
    }
    return null;
  }

  var settleInFlight = false;
  function settleScan() {
    if (settleInFlight) return;
    var orders = readOrders();
    var now = Date.now();
    var pending = [];
    orders.forEach(function (o, idx) {
      if (!o || (o.status && o.status !== 'open')) return;
      var coin = coinForOrder(o);
      if (!coin) return;
      var openAt = Number(String(o.marketId).slice(coin.idPrefix.length));
      if (!Number.isFinite(openAt) || openAt <= 0) return;
      // Give Binance a few seconds to finalize the candle after close
      if (openAt + FIVE_MIN + 8000 > now) return;
      pending.push({ idx: idx, order: o, coin: coin, openAt: openAt });
    });
    if (!pending.length) return;
    settleInFlight = true;
    var chain = Promise.resolve();
    var changed = false;
    pending.forEach(function (p) {
      chain = chain.then(function () {
        return fetchKline(p.coin, p.openAt).then(function (k) {
          if (!k || !(k.open > 0) || !(k.close > 0)) return;
          var upWon = k.close > k.open;
          var side = String(p.order.side || 'yes').toLowerCase();
          var won = (side === 'yes' && upWon) || (side === 'no' && !upWon);
          orders[p.idx] = Object.assign({}, orders[p.idx], {
            status: won ? 'won' : 'lost',
            resolved: true,
            settledAt: Date.now(),
            openPrice: k.open,
            closePrice: k.close,
            settlementSource: 'binance-5m-kline'
          });
          changed = true;
        });
      });
    });
    chain.then(function () {
      if (changed) {
        writeOrders(orders);
        try { window.dispatchEvent(new CustomEvent('ost:prediction:order-changed')); } catch (_) {}
        try { window.dispatchEvent(new CustomEvent('ost:prediction-resolutions-refreshed')); } catch (_) {}
      }
    }).finally(function () { settleInFlight = false; });
  }

  // ------------------------------------------------------------------- boot
  function boot() {
    COINS.forEach(function (c, i) {
      setTimeout(function () {
        tickCoin(c);
        refreshDayVolume(c);
        setInterval(function () { tickCoin(c); }, POLL_MS);
        setInterval(function () { refreshDayVolume(c); }, 120000);
      }, i * 700);
    });
    setInterval(settleScan, SETTLE_SCAN_MS);
    setTimeout(settleScan, 4000);
  }

  // External tick injection: ost-tick-turbo streams Binance ws prices when the
  // user is inside a 5-min market. Same handling as a fetchSpot() result.
  function pushTick(key, price) {
    var st = live[key];
    var p = Number(price);
    if (!st || !Number.isFinite(p) || p <= 0) return false;
    st.price = p;
    st.source = 'ws';
    st.ticks.push({ ts: Date.now(), price: p });
    if (st.ticks.length > 240) st.ticks = st.ticks.slice(-240);
    if (!st.openPrice && st.openAt && (Date.now() - st.openAt) < 4000) st.openPrice = p;
    return true;
  }

  window.OST_FAST_MARKETS = {
    coins: COINS.map(function (c) { return c.key; }),
    state: function (key) { return live[key] ? Object.assign({}, live[key]) : null; },
    buildMarket: buildMarket,
    settleScan: settleScan,
    pushTick: pushTick
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();

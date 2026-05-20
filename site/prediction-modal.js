/* ==========================================================================
   OST Prediction — Unified Market Modal
   --------------------------------------------------------------------------
   ONE modal that handles every market: Polymarket binary, Polymarket scalar,
   Kalshi, OST native 5-min BTC. Replaces the older mini-modal so popups no
   longer clip inside the wallet portal.

   * Mounted at <body> level with z-index 2147483647 → never trapped
     inside scrollable / transformed parents.
   * Click ANY .prediction-market-card opens it. Click the dashboard BTC
     tile opens it. Bet buttons inside open it. ESC / backdrop closes.
   * For Polymarket markets: pulls REAL data from the relay (or direct
     Polymarket APIs as fallback): orderbook depth, recent trades, price
     history. No more synthetic numbers.
    * For OST native 5-min BTC: live countdown + Binance spot tick.
   * Bet buttons certify the full path: select market in trade desk →
     set side → set stake → fire trade action. Success/failure shown
     inside the modal (not a clipped toast).
   ========================================================================== */
(function () {
  'use strict';
  if (window.__OST_MODAL_LOADED) return;
  window.__OST_MODAL_LOADED = true;

  var MODAL_ID = 'ost-market-modal';
  var FIVE_MIN_MS = 5 * 60 * 1000;
  var ROUND_KEY = 'ost.prediction.btc5m.rounds.v1';
  var ORDERS_KEY = 'ost.prediction.orders.v1';
  // BTC price feeds — try in order, all browser-CORS-safe.
  var BTC_PRICE_FEEDS = [
    {
      name: 'binance',
      url: 'https://data-api.binance.vision/api/v3/ticker/price?symbol=BTCUSDT',
      pick: function (j) { return j && Number(j.price); }
    },
    {
      name: 'binance-us',
      url: 'https://api.binance.us/api/v3/ticker/price?symbol=BTCUSDT',
      pick: function (j) { return j && Number(j.price); }
    },
    {
      name: 'coinbase',
      url: 'https://api.coinbase.com/v2/prices/BTC-USD/spot',
      pick: function (j) { return j && j.data && Number(j.data.amount); }
    },
    {
      name: 'kraken',
      url: 'https://api.kraken.com/0/public/Ticker?pair=XBTUSD',
      pick: function (j) {
        try { var k = Object.keys(j.result || {})[0]; return Number(j.result[k].c[0]); } catch (_) { return null; }
      }
    }
  ];
  var BTC_FEED_INDEX = 0;

  // Track timers for the currently-open modal so we can stop them on close.
  var liveTimers = [];
  var nativeStateFetchAt = {};
  var nativeStateInFlight = {};
  var nativeStateInFlightBase = {};
  var NATIVE_STATE_BASE_TOLERANCE = 0.005;
  var NATIVE_STATE_REFRESH_MS = 750;
  var POSITION_SYNC_RETRY_KEY = 'ost.prediction.position.sync.retry.v1';

  function ostApiBase() {
    return String(window.OST_API_BASE || '').replace(/\/$/, '');
  }
  function cachedCanonicalBtcRound() {
    try {
      if (window.OST_PREDICTION_API && typeof window.OST_PREDICTION_API.canonicalRound === 'function') {
        var apiRound = window.OST_PREDICTION_API.canonicalRound();
        if (apiRound && Number.isFinite(Number(apiRound.openAt))) return apiRound;
      }
    } catch (_) {}
    try {
      if (window.__OST_CANONICAL_BTC_ROUND && Number.isFinite(Number(window.__OST_CANONICAL_BTC_ROUND.openAt))) {
        return window.__OST_CANONICAL_BTC_ROUND;
      }
    } catch (_) {}
    return null;
  }
  function fetchCanonicalBtcRound() {
    try {
      if (window.OST_PREDICTION_API && typeof window.OST_PREDICTION_API.refreshCanonicalRound === 'function') {
        return Promise.resolve(window.OST_PREDICTION_API.refreshCanonicalRound()).then(function (round) {
          return round && Number.isFinite(Number(round.openAt)) ? round : null;
        });
      }
    } catch (_) {}
    var base = ostApiBase();
    if (!base) return Promise.resolve(null);
    return fetch(base + '/btc/round', { headers: { accept: 'application/json' }, cache: 'no-store' })
      .then(function (r) { return r && r.ok ? r.json() : null; })
      .then(function (round) {
        if (!round || !Number.isFinite(Number(round.openAt))) return null;
        try { window.__OST_CANONICAL_BTC_ROUND = round; } catch (_) {}
        return round;
      })
      .catch(function () { return null; });
  }
  function canonicalRoundMatchesMarket(market, round) {
    return !!(market && market.meta && round && Number(market.meta.openAt) === Number(round.openAt));
  }
  function isFastBtcMarket(market) {
    var id = String(market && market.id || '');
    var kind = String(market && market.meta && market.meta.kind || '');
    return /^ost-btc5m-/.test(id) || /btc\s*-?\s*5m|btc5m/i.test(kind);
  }
  function isOstNativeMarket(market) {
    var id = String(market && market.id || '');
    return !!(market && (market.isOstNative || market.source === 'ost' || /^ost-|^native-/i.test(id)));
  }
  function canonicalBtcRoundIsHot(round) {
    var price = Number(round && round.livePrice);
    if (!Number.isFinite(price) || price <= 1000) return false;
    var source = String(round && (round.livePriceSource || round.source) || '');
    if (/binance/i.test(source)) return true;
    var ts = Number(round && (round.livePriceTs || round.updatedAt)) || 0;
    if (!ts || Date.now() - ts > 2500) return false;
    var open = Number(round && (round.priceToBeat || round.openPrice));
    if (Number.isFinite(open) && open > 1000 && Math.abs(price - open) < 0.000001) return false;
    return true;
  }
  function applyCanonicalBtcRoundToMarket(market, round) {
    if (!canonicalRoundMatchesMarket(market, round)) return null;
    var openPrice = Number(round.openPrice);
    var priceToBeat = Number(round.priceToBeat);
    if (!Number.isFinite(priceToBeat) || priceToBeat <= 0) priceToBeat = Number.isFinite(openPrice) && openPrice > 0 ? openPrice : Number(round.priceToBeat || round.openPrice);
    var livePrice = Number(round.livePrice);
    var yes = Number(round.yesPriceNumber);
    var no = Number(round.noPriceNumber);
    market.meta = market.meta || {};
    market.meta.openAt = Number(round.openAt) || market.meta.openAt;
    market.meta.closeAt = Number(round.closeAt) || market.meta.closeAt;
    if (Number.isFinite(openPrice) && openPrice > 0) {
      market.meta.openPrice = openPrice;
    }
    if (Number.isFinite(priceToBeat) && priceToBeat > 0) {
      market.meta.priceToBeat = priceToBeat;
      market.priceToBeat = priceToBeat;
    }
    if (Number.isFinite(livePrice) && livePrice > 0) market.meta.livePrice = livePrice;
    if (Number.isFinite(yes) && yes > 0 && yes < 1) {
      market.baseYesPriceNumber = yes;
      market.baseNoPriceNumber = Number.isFinite(no) ? no : 1 - yes;
      market.fairYesPriceNumber = yes;
      market.fairNoPriceNumber = Number.isFinite(no) ? no : 1 - yes;
      market.meta.fairYesPriceNumber = yes;
      market.meta.fairNoPriceNumber = Number.isFinite(no) ? no : 1 - yes;
    }
    if (Number.isFinite(livePrice) && livePrice > 0) market.meta.updatedAt = Number(round.livePriceTs || round.updatedAt) || Date.now();
    market.meta.priceSource = round.livePriceSource || round.source || market.meta.priceSource || '';
    market.closeAtMs = Number(round.closeAt) || market.closeAtMs;
    return round;
  }
  function computeFastBtcYesProbability(market, livePrice, round, updatedAt) {
    var p = Number(livePrice);
    var beat = Number(market && market.meta && (market.meta.priceToBeat || market.meta.openPrice));
    if (!Number.isFinite(p) || p <= 1000 || !Number.isFinite(beat) || beat <= 0) return NaN;
    var roundLive = Number(round && round.livePrice);
    var roundTs = Number(round && (round.livePriceTs || round.updatedAt)) || 0;
    var liveTs = Number(updatedAt) || Date.now();
    var roundYes = Number(round && round.yesPriceNumber);
    var canUseRoundOdds = canonicalBtcRoundIsHot(round)
      && Number.isFinite(roundYes)
      && roundYes > 0
      && roundYes < 1
      && Number.isFinite(roundLive)
      && Math.abs(roundLive - p) < 0.01
      && (!roundTs || !liveTs || Math.abs(liveTs - roundTs) < 250);
    if (canUseRoundOdds) return Math.max(0.02, Math.min(0.98, roundYes));
    var closeAt = Number(market && market.meta && market.meta.closeAt) || (Date.now() + FIVE_MIN_MS);
    var pct = ((p - beat) / beat) * 100;
    var msLeft = Math.max(0, Math.min(FIVE_MIN_MS, closeAt - Date.now()));
    var remRatio = msLeft / FIVE_MIN_MS;
    var elapsedRatio = 1 - remRatio;
    var scale = 0.10 * Math.sqrt(Math.max(remRatio, 0.04));
    var z = Math.max(-8, Math.min(8, pct / Math.max(scale, 0.001)));
    var yes = 1 / (1 + Math.exp(-z));
    var confidence = 0.65 + 0.32 * elapsedRatio;
    yes = 0.5 + (yes - 0.5) * confidence;
    return Math.max(0.02, Math.min(0.98, yes));
  }
  function syncFastBtcMarketQuote(market, livePrice, source, round, updatedAt) {
    if (!isFastBtcMarket(market)) return NaN;
    market.meta = market.meta || {};
    if (canonicalRoundMatchesMarket(market, round)) applyCanonicalBtcRoundToMarket(market, round);
    if (!market.meta.openPrice) {
      var storedRound = (readJson(ROUND_KEY, {})[String(market.meta.openAt)] || {});
      if (Number(storedRound.openPrice) > 0) market.meta.openPrice = Number(storedRound.openPrice);
      if (Number(storedRound.priceToBeat) > 0 && !market.meta.priceToBeat) market.meta.priceToBeat = Number(storedRound.priceToBeat);
    }
    var p = Number(livePrice);
    if (canonicalRoundMatchesMarket(market, round) && canonicalBtcRoundIsHot(round)) {
      p = Number(round.livePrice);
      source = round.livePriceSource || round.source || source;
      updatedAt = Number(round.livePriceTs || round.updatedAt) || updatedAt;
    }
    if (Number.isFinite(p) && p > 1000) market.meta.livePrice = p;
    else p = Number(market.meta.livePrice);
    var beat = Number(market.meta.priceToBeat || market.meta.openPrice || 0);
    if (!(beat > 0) || !(p > 1000)) return NaN;
    market.meta.priceToBeat = beat;
    market.priceToBeat = beat;
    market.meta.priceSource = source || market.meta.priceSource || '';
    market.meta.updatedAt = Number(updatedAt) || Date.now();
    market.meta.equation = 'YES wins if BTC closes above ' + fmtUsd(beat) + '; NO wins if BTC closes at or below ' + fmtUsd(beat) + '.';
    market.equation = market.meta.equation;
    market.meta.priceDelta = p - beat;
    market.meta.priceDeltaPct = beat > 0 ? ((p - beat) / beat) * 100 : 0;
    var yesProb = computeFastBtcYesProbability(market, p, round, updatedAt);
    if (!Number.isFinite(yesProb)) return NaN;
    market.baseYesPriceNumber = yesProb;
    market.baseNoPriceNumber = 1 - yesProb;
    market.fairYesPriceNumber = yesProb;
    market.fairNoPriceNumber = 1 - yesProb;
    market.yesPriceNumber = yesProb;
    market.noPriceNumber = 1 - yesProb;
    market.yesValue = (yesProb * 100).toFixed(1) + '%';
    market.noValue = ((1 - yesProb) * 100).toFixed(1) + '%';
    market.meta.fairYesPriceNumber = yesProb;
    market.meta.fairNoPriceNumber = 1 - yesProb;
    market.meta.yesPriceNumber = yesProb;
    market.meta.noPriceNumber = 1 - yesProb;
    market.meta.tradableYesPriceNumber = yesProb;
    market.meta.tradableNoPriceNumber = 1 - yesProb;
    return yesProb;
  }
  function cachedBtcTicksForRound(openAt) {
    try {
      var bag = window.__ostBtcTicksByRound || {};
      var rows = bag[String(openAt)] || [];
      return Array.isArray(rows) ? rows.slice() : [];
    } catch (_) { return []; }
  }
  function hydrateCanonicalBtcTicks(market, bodyEl) {
    var base = ostApiBase();
    var openAt = Number(market && market.meta && market.meta.openAt);
    if (!base || !Number.isFinite(openAt) || openAt <= 0) return Promise.resolve([]);
    window.__ostBtcTicksByRound = window.__ostBtcTicksByRound || {};
    return fetch(base + '/btc/ticks?openAt=' + encodeURIComponent(openAt), { headers: { accept: 'application/json' }, cache: 'no-store' })
      .then(function (r) { return r && r.ok ? r.json() : null; })
      .then(function (j) {
        var ticks = j && Array.isArray(j.ticks) ? j.ticks : [];
        var rows = ticks.map(function (tick) {
          return { ts: Number(tick && tick.t) || Date.now(), price: Number(tick && tick.p), source: tick && tick.s || 'ost-canonical' };
        }).filter(function (tick) { return Number.isFinite(tick.price) && tick.price > 1000; });
        if (rows.length) {
          window.__ostBtcTicksByRound[String(openAt)] = rows.slice(-240);
          try { if (typeof window.__ostChartRedraw === 'function') window.__ostChartRedraw(); } catch (_) {}
          try { if (bodyEl && typeof bodyEl.__syncNativeQuoteUi === 'function') bodyEl.__syncNativeQuoteUi(); } catch (_) {}
        }
        return rows;
      })
      .catch(function () { return []; });
  }
  function nativeBaseYesInput(market, override) {
    var explicit = Number(override);
    if (Number.isFinite(explicit)) return explicit;
    var base = Number(market && (market.baseYesPriceNumber != null ? market.baseYesPriceNumber : market.baseYesPrice));
    if (Number.isFinite(base)) return base;
    var stateBase = Number(market && market.marketState && market.marketState.baseYesPrice);
    if (Number.isFinite(stateBase)) return stateBase;
    var yes = Number(market && market.yesPriceNumber);
    return Number.isFinite(yes) ? yes : 0.5;
  }

  function nativePressureTools() {
    try { return window.OST_NATIVE_MARKET_PRESSURE || null; } catch (_) { return null; }
  }

  function quoteNativeStateWithPressure(market, state, baseYes) {
    var tools = nativePressureTools();
    if (!market || !state || !tools || typeof tools.quote !== 'function') return state;
    try { return tools.quote(market.id, state, baseYes); } catch (_) { return state; }
  }

  function confirmNativeStatePressure(market, state) {
    var tools = nativePressureTools();
    if (!market || !state || state.localPressureApplied || !tools || typeof tools.confirm !== 'function') return;
    try { tools.confirm(market.id, state); } catch (_) {}
  }

  function rememberNativePressure(record) {
    var tools = nativePressureTools();
    if (!record || !tools || typeof tools.remember !== 'function') return null;
    try { return tools.remember(record); } catch (_) { return null; }
  }

  function syncNativeQuoteBody(bodyEl) {
    try { if (bodyEl && typeof bodyEl.__syncNativeQuoteUi === 'function') bodyEl.__syncNativeQuoteUi(); } catch (_) {}
  }

  function applyNativeMarketState(market, state) {
    if (!market || !state) return null;
    market.meta = market.meta || {};
    confirmNativeStatePressure(market, state);
    state = quoteNativeStateWithPressure(market, state, nativeBaseYesInput(market, state.baseYesPrice));
    var yes = Number(state.yesPriceNumber);
    var no = Number(state.noPriceNumber);
    if (!Number.isFinite(yes) || !Number.isFinite(no)) return null;
    market.marketState = Object.assign({}, market.marketState || {}, state);
    market.baseYesPriceNumber = Number.isFinite(Number(state.baseYesPrice)) ? Number(state.baseYesPrice) : nativeBaseYesInput(market);
    market.baseNoPriceNumber = Number.isFinite(Number(state.baseNoPrice)) ? Number(state.baseNoPrice) : 1 - market.baseYesPriceNumber;
    market.fairYesPriceNumber = market.baseYesPriceNumber;
    market.fairNoPriceNumber = market.baseNoPriceNumber;
    market.yesPriceNumber = Math.max(0.01, Math.min(0.99, yes));
    market.noPriceNumber = Math.max(0.01, Math.min(0.99, no));
    market.meta.marketState = market.marketState;
    market.meta.baseYesPrice = market.baseYesPriceNumber;
    market.meta.baseNoPrice = market.baseNoPriceNumber;
    market.meta.fairYesPriceNumber = market.baseYesPriceNumber;
    market.meta.fairNoPriceNumber = market.baseNoPriceNumber;
    market.meta.yesPriceNumber = market.yesPriceNumber;
    market.meta.noPriceNumber = market.noPriceNumber;
    market.meta.tradableYesPriceNumber = market.yesPriceNumber;
    market.meta.tradableNoPriceNumber = market.noPriceNumber;
    market.meta.yesAskPriceNumber = Number(state.yesAskPriceNumber != null ? state.yesAskPriceNumber : market.yesPriceNumber);
    market.meta.noAskPriceNumber = Number(state.noAskPriceNumber != null ? state.noAskPriceNumber : market.noPriceNumber);
    market.meta.yesBidPriceNumber = Number(state.yesBidPriceNumber != null ? state.yesBidPriceNumber : market.yesPriceNumber);
    market.meta.noBidPriceNumber = Number(state.noBidPriceNumber != null ? state.noBidPriceNumber : market.noPriceNumber);
    market.meta.vaultSpread = Number(state.vaultSpread || state.vaultEdge || 0) || 0;
    market.meta.sellHaircut = Number(state.sellHaircut || 0) || 0;
    window.__ostNativeMarketState = window.__ostNativeMarketState || {};
    window.__ostNativeMarketState[market.id] = market.marketState;
    try { window.dispatchEvent(new CustomEvent('ost:native-market-state', { detail: { marketId: market.id, state: market.marketState } })); } catch (_) {}
    return market.marketState;
  }
  function fetchNativeMarketState(market, baseYesOverride) {
    var base = ostApiBase();
    if (!base || !market || !market.id || !market.isOstNative) return Promise.resolve(null);
    var baseYes = nativeBaseYesInput(market, baseYesOverride);
    if (nativeStateInFlight[market.id]) {
      var pendingBase = Number(nativeStateInFlightBase[market.id]);
      if (!Number.isFinite(pendingBase) || Math.abs(pendingBase - baseYes) < NATIVE_STATE_BASE_TOLERANCE) return nativeStateInFlight[market.id];
    }
    if (Date.now() - (nativeStateFetchAt[market.id] || 0) < 450) {
      try {
        var cached = window.__ostNativeMarketState && window.__ostNativeMarketState[market.id];
        var cachedBase = Number(cached && cached.baseYesPrice);
        if (cached && (!Number.isFinite(cachedBase) || Math.abs(cachedBase - baseYes) < NATIVE_STATE_BASE_TOLERANCE)) return Promise.resolve(cached);
      } catch (_) {}
    }
    nativeStateFetchAt[market.id] = Date.now();
    nativeStateInFlightBase[market.id] = baseYes;
    nativeStateInFlight[market.id] = fetch(base + '/markets/state/' + encodeURIComponent(market.id) + '?baseYes=' + encodeURIComponent(baseYes), { cache: 'no-store' })
      .then(function (r) { return r && r.ok ? r.json() : null; })
      .then(function (j) { return j && (j.state || j.marketState) || null; })
      .then(function (state) {
        if (nativeStateInFlightBase[market.id] === baseYes) {
          delete nativeStateInFlight[market.id];
          delete nativeStateInFlightBase[market.id];
        }
        return state;
      })
      .catch(function (error) {
        if (nativeStateInFlightBase[market.id] === baseYes) {
          delete nativeStateInFlight[market.id];
          delete nativeStateInFlightBase[market.id];
        }
        throw error;
      });
    return nativeStateInFlight[market.id];
  }
  function refreshNativeMarketState(market, bodyEl, baseYesOverride) {
    return fetchNativeMarketState(market, baseYesOverride).then(function (state) {
      var applied = applyNativeMarketState(market, state);
      if (applied && bodyEl && typeof bodyEl.__syncNativeQuoteUi === 'function') bodyEl.__syncNativeQuoteUi();
      return applied;
    }).catch(function () { return null; });
  }
  function withTimeout(promise, ms, fallback) {
    var done = false;
    return Promise.race([
      Promise.resolve(promise).then(function (value) { done = true; return value; }, function () { done = true; return fallback; }),
      new Promise(function (resolve) {
        setTimeout(function () { if (!done) resolve(fallback); }, ms || 1200);
      })
    ]);
  }

  function readPositionSyncQueue() {
    try {
      var rows = JSON.parse(localStorage.getItem(POSITION_SYNC_RETRY_KEY) || '[]');
      return Array.isArray(rows) ? rows : [];
    } catch (_) { return []; }
  }

  function writePositionSyncQueue(rows) {
    try { localStorage.setItem(POSITION_SYNC_RETRY_KEY, JSON.stringify((rows || []).slice(0, 80))); } catch (_) {}
  }

  function positionSyncKey(payload) {
    return String(payload && (payload.signature || payload.sig || payload.id || [payload.wallet || '', payload.marketId || '', payload.side || '', payload.createdAt || payload.ts || ''].join(':')) || '');
  }

  function rememberPositionSyncFailure(payload, error) {
    if (!payload || !payload.marketId) return;
    var key = positionSyncKey(payload);
    var rows = readPositionSyncQueue().filter(function (row) { return positionSyncKey(row && row.payload) !== key; });
    rows.unshift({ payload: payload, error: String(error && error.message || error || 'sync failed').slice(0, 180), retryAt: Date.now() + 2500, tries: 0, queuedAt: Date.now() });
    writePositionSyncQueue(rows);
    try { window.dispatchEvent(new CustomEvent('ost:position-sync-failed', { detail: { payload: payload, error: error } })); } catch (_) {}
  }

  function postPositionToWorker(payload, onOk) {
    var base = (window.OST_API_BASE || '').replace(/\/$/, '');
    if (!base) {
      rememberPositionSyncFailure(payload, 'OST API unavailable');
      return Promise.resolve(null);
    }
    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timeoutId = controller ? setTimeout(function () { try { controller.abort(); } catch (_) {} }, 4500) : null;
    return fetch(base + '/positions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller ? controller.signal : undefined
    }).then(function (r) {
      if (timeoutId) clearTimeout(timeoutId);
      if (r && r.ok) return r.json();
      return (r ? r.text() : Promise.resolve('')).then(function (text) {
        throw new Error('position sync failed (' + (r && r.status || 'network') + ')' + (text ? ': ' + text.slice(0, 120) : ''));
      });
    }).then(function (j) {
      if (typeof onOk === 'function') onOk(j);
      return j;
    }).catch(function (error) {
      if (timeoutId) clearTimeout(timeoutId);
      rememberPositionSyncFailure(payload, error);
      throw error;
    });
  }

  var positionSyncFlushInFlight = false;
  function flushPositionSyncQueue() {
    if (positionSyncFlushInFlight) return;
    var rows = readPositionSyncQueue();
    var due = rows.filter(function (row) { return !row.retryAt || row.retryAt <= Date.now(); });
    if (!due.length) return;
    positionSyncFlushInFlight = true;
    var remaining = rows.filter(function (row) { return row.retryAt && row.retryAt > Date.now(); });
    var chain = Promise.resolve();
    due.slice(0, 8).forEach(function (row) {
      chain = chain.then(function () {
        return postPositionToWorker(row.payload).catch(function () {
          row.tries = Number(row.tries || 0) + 1;
          row.retryAt = Date.now() + Math.min(30000, 2500 * Math.max(1, row.tries));
          remaining.push(row);
        });
      });
    });
    chain.then(function () { writePositionSyncQueue(remaining); }).finally(function () { positionSyncFlushInFlight = false; });
  }
  setInterval(flushPositionSyncQueue, 5000);
  try { window.addEventListener('online', flushPositionSyncQueue); } catch (_) {}
  setTimeout(flushPositionSyncQueue, 1200);
  function isClosedFlowRecord(record) {
    var status = String(record && (record.status || record.outcome) || '').toLowerCase();
    return !!(record && (record.cashedOut || record.resolved || Number(record.cashoutAt || 0) > 0 || ['sold', 'cashed-out', 'closed', 'settled', 'resolved', 'won', 'lost'].indexOf(status) >= 0));
  }


  // Push a freshly-placed bet to the global ost-api positions feed so every
  // other OST user sees it in their "Live OST flow" ticker.
  function shareBetGlobally(market, side, stake, rec, outcomeKey, bodyEl) {
    try {
      var wallet = (rec && rec.wallet) ||
        (window.OST_WALLET && window.OST_WALLET.session && window.OST_WALLET.session.publicKey && window.OST_WALLET.session.publicKey.toBase58 && window.OST_WALLET.session.publicKey.toBase58()) ||
        window.OST_WALLET_PUBKEY ||
        (window.solana && window.solana.publicKey && window.solana.publicKey.toString && window.solana.publicKey.toString()) ||
        'anon';
      var contract = getModalTradeContract(market, side, outcomeKey || (rec && rec.outcomeKey) || '');
      var sideUp = String(side || (contract && contract.side) || 'YES').toUpperCase() === 'NO' ? 'NO' : 'YES';
      var price = Number(rec && rec.price);
      if (!Number.isFinite(price)) price = Number(contract && contract.price);
      var payload = Object.assign({}, rec || {}, {
        wallet: wallet,
        marketId: market.id,
        conditionId: (contract && contract.conditionId) || market.conditionId || (market.raw && (market.raw.conditionId || market.raw.condition_id)) || '',
        gammaMarketId: (contract && contract.gammaMarketId) || market.gammaMarketId || (market.raw && market.raw.id) || '',
        marketTitle: market.title || market.question || '',
        title: market.title || market.question || '',
        side: sideUp,
        stake: Number(stake) || 0,
        price: Number.isFinite(price) ? price : null,
        yesPrice: Number.isFinite(contract && contract.yesPrice) ? Number(contract.yesPrice) : null,
        noPrice: Number.isFinite(contract && contract.noPrice) ? Number(contract.noPrice) : null,
        shares: Number(rec && rec.shares) || (Number.isFinite(price) && price > 0 ? (Number(stake) || 0) / price : 0),
        potentialReturn: Number(rec && rec.potentialReturn) || (Number.isFinite(price) && price > 0 ? (Number(stake) || 0) / price : 0),
        baseYesPrice: nativeBaseYesInput(market),
        flowAction: 'buy',
        tradeAction: 'buy',
        outcomeKey: (contract && contract.key) || outcomeKey || (rec && rec.outcomeKey) || '',
        outcomeLabel: (contract && contract.label) || (rec && rec.outcomeLabel) || sideUp,
        clobTokenIds: contract && contract.clobTokenIds ? contract.clobTokenIds.slice() : normalizeOutcomeTokenIds(market.clobTokenIds),
        source: market.source || (market.isOstNative ? 'ost-native' : 'polymarket'),
        topic: market.topic || '',
        closeAtMs: market.closeAtMs || (market.meta && market.meta.closeAt) || 0,
        signature: rec && (rec.signature || rec.sig || rec.id) || null,
        ts: rec && (rec.ts || rec.createdAt) || new Date().toISOString()
      });
      optimisticallyMergeFlowRecord(market, payload);
      rememberNativePressure(payload);
      syncNativeQuoteBody(bodyEl);
      postPositionToWorker(payload, function (j) {
          if (j && j.marketState) applyNativeMarketState(market, j.marketState);
          if (j && j.record) optimisticallyMergeFlowRecord(market, j.record);
          if (j && j.flowRecord) optimisticallyMergeFlowRecord(market, j.flowRecord);
          syncNativeQuoteBody(bodyEl);
        }).catch(function (error) {
          try { toast('Bet recorded. Live market sync is retrying: ' + String(error && error.message || 'worker unavailable').slice(0, 90), 'err'); } catch (_) {}
        });
    } catch (_) { /* never block UI */ }
  }

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------
  function relayBase() {
    var v = (typeof window !== 'undefined' && window.OST_POLY_RELAY_URL) || '';
    return v ? String(v).replace(/\/$/, '') : '';
  }
  function pmGamma(path, query) {
    var b = relayBase();
    if (b) return b + '/gamma' + path + (query ? ('?' + query) : '');
    return 'https://gamma-api.polymarket.com' + path + (query ? ('?' + query) : '');
  }
  function pmClob(path, query) {
    var b = relayBase();
    if (b) return b + '/clob' + path + (query ? ('?' + query) : '');
    return 'https://clob.polymarket.com' + path + (query ? ('?' + query) : '');
  }
  function pmData(path, query) {
    var b = relayBase();
    if (b) return b + '/data' + path + (query ? ('?' + query) : '');
    return 'https://data-api.polymarket.com' + path + (query ? ('?' + query) : '');
  }

  function readJson(key, fallback) {
    try { var v = JSON.parse(localStorage.getItem(key) || 'null'); return v == null ? fallback : v; }
    catch (_) { return fallback; }
  }

  // ----- Timeout-aware, CORS-resilient fetch ----------------------------------
  // Each attempt gets a hard 4 s abort budget so a stalled CORS proxy can
  // never block the next refresh tick.
  var CORS_PROXIES = [
    'https://corsproxy.io/?url=',
    'https://api.allorigins.win/raw?url='
  ];
  var FETCH_TIMEOUT_MS = 4000;
  function fetchWithTimeout(url, opts) {
    var ctrl = new AbortController();
    var tid = setTimeout(function () { ctrl.abort(); }, FETCH_TIMEOUT_MS);
    return fetch(url, Object.assign({ signal: ctrl.signal }, opts))
      .then(function (r) { clearTimeout(tid); return r; })
      .catch(function (e) { clearTimeout(tid); throw e; });
  }
  function fetchJsonResilient(url) {
    var attempt = function (target) {
      return fetchWithTimeout(target, { headers: { accept: 'application/json' }, mode: 'cors' })
        .then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.json();
        });
    };
    return attempt(url)
      .catch(function () {
        return attempt(CORS_PROXIES[0] + encodeURIComponent(url));
      })
      .catch(function () {
        return attempt(CORS_PROXIES[1] + encodeURIComponent(url));
      })
      .catch(function (e) {
        console.warn('[ost-modal] fetch failed', url, e && e.message);
        return null;
      });
  }
  // Race all BTC feeds simultaneously — return whichever answers first.
  // BTC_LOCKED_FEED keeps the chosen source stable for the lifetime of the
  // current 5-min round; flipping between binance/coinbase/kraken every tick
  // produced visible 30¢ price discrepancies on the share chart.
  var BTC_LOCKED_FEED = null;       // index of the locked feed
  var BTC_LOCKED_ROUND = 0;         // openAt of the round the lock belongs to
  function lockBtcFeedForRound(roundOpenAt) {
    if (Number.isFinite(roundOpenAt) && roundOpenAt !== BTC_LOCKED_ROUND) {
      BTC_LOCKED_FEED = null;
      BTC_LOCKED_ROUND = roundOpenAt;
    }
  }
  function fetchBtcSingle(idx) {
    var feed = BTC_PRICE_FEEDS[idx];
    if (!feed) return Promise.reject(new Error('feed missing'));
    return fetchWithTimeout(feed.url, { headers: { accept: 'application/json', 'cache-control': 'no-cache' }, mode: 'cors', cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(); })
      .then(function (j) {
        var p = feed.pick(j);
        if (!Number.isFinite(p) || p < 1000) return Promise.reject();
        return p;
      });
  }
  function fetchBtcRace() {
    // Stay on the locked feed for the round if it still answers.
    if (BTC_LOCKED_FEED != null) {
      return fetchBtcSingle(BTC_LOCKED_FEED)
        .then(function (p) { BTC_FEED_INDEX = BTC_LOCKED_FEED; return p; })
        .catch(function () {
          // Locked feed went offline — fall through to a fresh race and
          // re-lock on the new winner.
          BTC_LOCKED_FEED = null;
          return raceAllFeeds();
        });
    }
    return raceAllFeeds();
  }
  function raceAllFeeds() {
    var racePromises = BTC_PRICE_FEEDS.map(function (feed, i) {
      return fetchBtcSingle(i).then(function (p) {
        if (BTC_LOCKED_FEED == null) BTC_LOCKED_FEED = i;
        BTC_FEED_INDEX = i;
        return p;
      });
    });
    return Promise.any
      ? Promise.any(racePromises)
      : racePromises.reduce(function (chain, p) { return chain.catch(function () { return p; }); }, Promise.reject());
  }
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];
    });
  }
  function fmtUsd(n, dp) {
    if (!Number.isFinite(n)) return '—';
    return '$' + Number(n).toLocaleString(undefined, { minimumFractionDigits: dp == null ? 2 : dp, maximumFractionDigits: dp == null ? 2 : dp });
  }
  function fmtCents(n) {
    if (!Number.isFinite(n)) return '—';
    return (n * 100).toFixed(1) + '¢';
  }
  function fmtTime(ts) {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }
  function clearLiveTimers() {
    var timers = liveTimers.slice();
    liveTimers = [];
    timers.forEach(function (t) {
      try {
        if (t && typeof t === 'object' && typeof t.removeOnClose === 'function') {
          t.removeOnClose();
        } else {
          clearInterval(t);
          clearTimeout(t);
        }
      } catch (_) {}
    });
  }

  // --------------------------------------------------------------------------
  // DOM build
  // --------------------------------------------------------------------------
  function ensureModal() {
    var el = document.getElementById(MODAL_ID);
    if (el) return el;
    el = document.createElement('div');
    el.id = MODAL_ID;
    el.className = 'ost-modal';
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML =
      '<div class="ost-modal__backdrop" data-act="close"></div>' +
      '<div class="ost-modal__panel" role="dialog" aria-modal="true" aria-labelledby="ost-modal-title">' +
      '  <button class="ost-modal__close" aria-label="Close" data-act="close">×</button>' +
      '  <div class="ost-modal__body" data-bind="body"></div>' +
      '  <div class="ost-modal__toast" data-bind="toast" hidden></div>' +
      '</div>';
    document.body.appendChild(el);
    function closeFromIntent(ev) {
      var target = ev && ev.target && ev.target.closest ? ev.target.closest('[data-act]') : null;
      if (!target || target.getAttribute('data-act') !== 'close') return false;
      try { ev.preventDefault(); } catch (_) {}
      try { ev.stopPropagation(); } catch (_) {}
      try { if (typeof ev.stopImmediatePropagation === 'function') ev.stopImmediatePropagation(); } catch (_) {}
      closeModal();
      return true;
    }
    el.addEventListener('pointerdown', closeFromIntent, true);
    el.addEventListener('touchend', closeFromIntent, true);
    el.addEventListener('click', function (ev) {
      closeFromIntent(ev);
    });
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && el.classList.contains('is-open')) closeModal();
    });
    return el;
  }

  function openModal(html) {
    var el = ensureModal();
    var body = el.querySelector('[data-bind="body"]');
    if (body) body.innerHTML = html;
    el.classList.add('is-open');
    el.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    document.body.classList.add('ost-modal-open');
    try { window.dispatchEvent(new CustomEvent('ost-modal:open')); } catch (_) {}
  }

  function closeModal() {
    clearLiveTimers();
    var el = document.getElementById(MODAL_ID);
    if (!el) return;
    var bodyEl = el.querySelector('[data-bind="body"]');
    if (bodyEl && bodyEl.__refreshSell) {
      try { window.removeEventListener('ost:prediction:order-changed', bodyEl.__refreshSell); } catch (_) {}
      bodyEl.__refreshSell = null;
    }
    if (bodyEl && bodyEl.__nativeStateListener) {
      try { window.removeEventListener('ost:native-market-state', bodyEl.__nativeStateListener); } catch (_) {}
      bodyEl.__nativeStateListener = null;
    }
    if (bodyEl && bodyEl.__broadcastHls) {
      try { bodyEl.__broadcastHls.destroy(); } catch (_) {}
      bodyEl.__broadcastHls = null;
    }
    el.classList.remove('is-open');
    el.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    document.body.classList.remove('ost-modal-open');
    try { window.dispatchEvent(new CustomEvent('ost-modal:close')); } catch (_) {}
  }

  function toast(msg, kind) {
    var el = document.getElementById(MODAL_ID);
    if (!el) return;
    var t = el.querySelector('[data-bind="toast"]');
    if (!t) return;
    t.textContent = msg;
    t.hidden = false;
    t.classList.remove('is-ok', 'is-err');
    t.classList.add(kind === 'err' ? 'is-err' : 'is-ok');
    clearTimeout(t._timer);
    t._timer = setTimeout(function () { t.hidden = true; }, 5000);
  }

  // --------------------------------------------------------------------------
  // Market record discovery — pull the FULL market object from app.js's
  // rendered card. Falls back to whatever is exposed via window.__predictionState.
  // --------------------------------------------------------------------------
  function findMarket(id) {
    if (!id) return null;
    // 1) Authoritative — if app.js exposed state
    try {
      var st = window.__predictionState || (window.OST_PREDICTION_API && window.OST_PREDICTION_API._state);
      if (st && Array.isArray(st.markets)) {
        var m = st.markets.find(function (mk) { return mk && mk.id === id; });
        if (m) return m;
      }
    } catch (_) {}
    // 2) Reconstruct from DOM card
    var card = document.querySelector('[data-prediction-market-id="' + String(id).replace(/"/g, '\\"') + '"]');
    if (!card) return { id: id, title: id, sourceLabel: '', detail: '' };
    var txt = function (sel) { var n = card.querySelector(sel); return n ? n.textContent.trim() : ''; };
    var srcLabel = txt('.prediction-market-source');
    var yesValue = txt('.prediction-market-price strong');
    var noValueAll = card.querySelectorAll('.prediction-market-price strong');
    var noValue = noValueAll[1] ? noValueAll[1].textContent.trim() : '';
    var yes = parseFloat(yesValue) / 100; if (!Number.isFinite(yes)) yes = NaN;
    var no  = parseFloat(noValue) / 100; if (!Number.isFinite(no))  no  = NaN;
    var primary = card.querySelector('.prediction-market-link');
    var feed    = card.querySelector('.prediction-market-api-link');
    var rec = {
      id: id,
      title: txt('h5'),
      detail: txt('.prediction-market-copy p'),
      sourceLabel: srcLabel,
      source: srcLabel.toLowerCase(),
      yesLabel: 'YES', noLabel: 'NO',
      yesValue: yesValue, noValue: noValue,
      yesPriceNumber: yes, noPriceNumber: no,
      closeText: txt('.prediction-market-meta-row .prediction-market-metric:last-child strong'),
      contractLabel: txt('.prediction-market-contract'),
      primaryUrl: primary ? primary.href : '',
      primaryLabel: primary ? primary.textContent.trim() : 'Open',
      secondaryUrl: feed ? feed.href : '',
      secondaryLabel: feed ? feed.textContent.trim() : ''
    };
    if (id.indexOf('ost-btc5m-') === 0) {
      var openAt = parseInt(id.replace('ost-btc5m-', ''), 10);
      var rounds = readJson(ROUND_KEY, {});
      var rd = rounds[String(openAt)] || {};
      rec.isOstNative = true;
      rec.meta = { kind: 'btc5m', openAt: openAt, closeAt: openAt + FIVE_MIN_MS, openPrice: rd.openPrice || 0, priceToBeat: rd.priceToBeat || rd.openPrice || 0 };
    }
    return rec;
  }

  // --------------------------------------------------------------------------
  // Polymarket live data fetchers (uses relay if configured)
  // --------------------------------------------------------------------------
  function looksLikePolymarketId(market) {
    if (!market) return false;
    if (market.source === 'polymarket') return true;
    if (market.sourceLabel && /polymarket/i.test(market.sourceLabel)) return true;
    if (market.primaryUrl && /polymarket\.com/i.test(market.primaryUrl)) return true;
    return false;
  }
  function normalizeOutcomeTokenIds(raw) {
    if (typeof raw === 'string') {
      try { raw = JSON.parse(raw); }
      catch (_) { raw = raw ? [raw] : []; }
    }
    if (!Array.isArray(raw)) raw = raw == null ? [] : [raw];
    return raw.map(function (token) {
      if (token && typeof token === 'object') return String(token.tokenId || token.token_id || token.id || token.asset_id || '').trim();
      return String(token || '').trim();
    }).filter(Boolean);
  }
  function isBinaryOutcomeLabel(value) {
    return /^(yes|no)$/i.test(String(value || '').trim());
  }
  function getModalOutcomeContracts(market) {
    if (!market) return [];
    var outcomes = Array.isArray(market.outcomes) ? market.outcomes : [];
    if ((!outcomes.length || typeof outcomes[0] !== 'object') && market.raw) {
      if (Array.isArray(market.raw.outcomes)) outcomes = market.raw.outcomes;
      else if (typeof market.raw.outcomes === 'string') {
        try { outcomes = JSON.parse(market.raw.outcomes); }
        catch (_) { outcomes = []; }
      }
    }
    return (Array.isArray(outcomes) ? outcomes : []).map(function (outcome, index) {
      if (!outcome || typeof outcome !== 'object') return null;
      var price = Number(outcome.price != null ? outcome.price : outcome.lastTradePrice);
      if (price > 1) price = price / 100;
      return {
        key: String(outcome.key || outcome.outcomeKey || outcome.slug || ('outcome-' + (index + 1))).trim().toLowerCase(),
        label: String(outcome.displayLabel || outcome.outcomeLabel || outcome.label || outcome.name || outcome.title || ('Outcome ' + (index + 1))).trim(),
        price: Number.isFinite(price) ? Math.max(0, Math.min(1, price)) : NaN,
        gammaMarketId: String(outcome.gammaMarketId || outcome.marketId || outcome.id || '').trim(),
        conditionId: String(outcome.conditionId || outcome.condition_id || '').trim(),
        clobTokenIds: normalizeOutcomeTokenIds(outcome.clobTokenIds || outcome.outcomeTokens || outcome.tokens || outcome.tokenIds || outcome.tokenId),
        raw: outcome
      };
    }).filter(Boolean);
  }
  function hasExplicitOutcomeContracts(market) {
    var outcomes = getModalOutcomeContracts(market);
    if (!outcomes.length) return false;
    if (outcomes.length > 2) return true;
    return outcomes.some(function (outcome) {
      return !isBinaryOutcomeLabel(outcome.key) && !isBinaryOutcomeLabel(outcome.label);
    });
  }
  function getSelectedOutcomeContract(market, outcomeKey) {
    if (!hasExplicitOutcomeContracts(market)) return null;
    var outcomes = getModalOutcomeContracts(market);
    var targetKey = String(outcomeKey || '').trim().toLowerCase();
    return outcomes.find(function (outcome) { return outcome.key === targetKey; }) || outcomes[0] || null;
  }
  function getModalTradeContract(market, side, outcomeKey) {
    var selectedOutcome = getSelectedOutcomeContract(market, outcomeKey);
    if (selectedOutcome) {
      return {
        key: selectedOutcome.key,
        label: selectedOutcome.label,
        side: 'YES',
        price: selectedOutcome.price,
        yesPrice: selectedOutcome.price,
        noPrice: Number.isFinite(selectedOutcome.price) ? Math.max(0, Math.min(1, 1 - selectedOutcome.price)) : NaN,
        gammaMarketId: selectedOutcome.gammaMarketId || market.gammaMarketId || market.id || '',
        conditionId: selectedOutcome.conditionId || market.conditionId || '',
        clobTokenIds: selectedOutcome.clobTokenIds.slice()
      };
    }
    var normalizedSide = side === 'NO' ? 'NO' : 'YES';
    var yesPrice = Number(market && market.meta && (market.meta.tradableYesPriceNumber != null ? market.meta.tradableYesPriceNumber : market.meta.yesPriceNumber));
    var noPrice = Number(market && market.meta && (market.meta.tradableNoPriceNumber != null ? market.meta.tradableNoPriceNumber : market.meta.noPriceNumber));
    if (!Number.isFinite(yesPrice)) yesPrice = Number(market && market.yesPriceNumber);
    if (!Number.isFinite(noPrice)) noPrice = Number(market && market.noPriceNumber);
    if (!Number.isFinite(noPrice) && Number.isFinite(yesPrice)) noPrice = 1 - yesPrice;
    if (!Number.isFinite(yesPrice) && Number.isFinite(noPrice)) yesPrice = 1 - noPrice;
    return {
      key: normalizedSide.toLowerCase(),
      label: normalizedSide,
      side: normalizedSide,
      price: normalizedSide === 'NO' ? noPrice : yesPrice,
      yesPrice: yesPrice,
      noPrice: noPrice,
      gammaMarketId: market && (market.gammaMarketId || market.id) || '',
      conditionId: market && market.conditionId || '',
      clobTokenIds: normalizeOutcomeTokenIds(market && market.clobTokenIds)
    };
  }
  function getNativeSellQuotePrice(market, side, fallback) {
    var sideKey = String(side || '').toUpperCase() === 'NO' ? 'NO' : 'YES';
    var price = NaN;
    if (market && market.isOstNative) {
      var state = market.marketState || (window.__ostNativeMarketState && window.__ostNativeMarketState[market.id]) || null;
      if (state) price = sideKey === 'NO' ? Number(state.noBidPriceNumber) : Number(state.yesBidPriceNumber);
      if (!Number.isFinite(price) && market.meta) price = sideKey === 'NO' ? Number(market.meta.noBidPriceNumber) : Number(market.meta.yesBidPriceNumber);
    }
    if (!Number.isFinite(price) || price <= 0) price = Number(fallback);
    return Number.isFinite(price) && price > 0 ? price : NaN;
  }
  function clampProbability(value) {
    var n = Number(value);
    return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : NaN;
  }
  function sellFlowRecord(order, market, payout, sale) {
    if (!order) return null;
    sale = sale || {};
    var side = String(order.side || sale.side || 'YES').toUpperCase() === 'NO' ? 'NO' : 'YES';
    var cashoutAt = Number(order.cashoutAt || sale.cashoutAt || Date.now()) || Date.now();
    var baseKey = String(order.id || order.signature || order.sig || order.txid || order.createdAt || cashoutAt);
    var price = clampProbability(sale.sellPrice != null ? sale.sellPrice : (order.sellPrice != null ? order.sellPrice : order.price));
    var yesPrice = clampProbability(sale.finalYesPrice != null ? sale.finalYesPrice : (order.finalYesPrice != null ? order.finalYesPrice : order.yesPrice));
    var noPrice = clampProbability(sale.finalNoPrice != null ? sale.finalNoPrice : (order.finalNoPrice != null ? order.finalNoPrice : order.noPrice));
    if (Number.isFinite(price)) {
      if (side === 'NO') {
        noPrice = price;
        if (!Number.isFinite(yesPrice)) yesPrice = 1 - price;
      } else {
        yesPrice = price;
        if (!Number.isFinite(noPrice)) noPrice = 1 - price;
      }
    }
    var selectedPrice = side === 'NO' ? noPrice : yesPrice;
    var sellValue = Number(sale.sellValue != null ? sale.sellValue : payout);
    if (!Number.isFinite(sellValue)) sellValue = Number(order.cashoutOst || order.sellValue || order.potentialReturn || order.stake || 0) || 0;
    return Object.assign({}, order, {
      id: 'sell:' + baseKey + ':' + cashoutAt,
      signature: order.cashoutSig || '',
      sig: order.cashoutSig || '',
      relatedPositionId: baseKey,
      flowAction: 'sell',
      tradeAction: 'sell',
      action: 'sell',
      status: 'sold',
      side: side,
      price: Number.isFinite(selectedPrice) ? selectedPrice : null,
      yesPrice: Number.isFinite(yesPrice) ? yesPrice : null,
      noPrice: Number.isFinite(noPrice) ? noPrice : null,
      stake: sellValue,
      amount: sellValue,
      sellPrice: Number.isFinite(selectedPrice) ? selectedPrice : null,
      sellValue: sellValue,
      shares: Number(sale.shares || order.shares || 0) || 0,
      ts: new Date(cashoutAt).toISOString(),
      createdAt: cashoutAt,
      marketId: order.marketId || (market && market.id) || '',
      marketTitle: order.marketTitle || order.title || (market && (market.title || market.question)) || ''
    });
  }
  function addAlias(list, value) {
    var text = String(value == null ? '' : value).trim();
    if (text && list.indexOf(text) < 0) list.push(text);
  }
  function marketAliasList(market) {
    var aliases = [];
    if (!market) return aliases;
    addAlias(aliases, market.id);
    addAlias(aliases, market.marketId);
    addAlias(aliases, market.conditionId || market.condition_id);
    addAlias(aliases, market.gammaMarketId);
    normalizeOutcomeTokenIds(market.clobTokenIds).forEach(function (id) { addAlias(aliases, id); });
    if (market.raw) {
      addAlias(aliases, market.raw.id);
      addAlias(aliases, market.raw.conditionId || market.raw.condition_id);
      addAlias(aliases, market.raw.gammaMarketId);
      normalizeOutcomeTokenIds(market.raw.clobTokenIds || market.raw.outcomeTokens || market.raw.tokens).forEach(function (id) { addAlias(aliases, id); });
    }
    getModalOutcomeContracts(market).forEach(function (outcome) {
      addAlias(aliases, outcome.gammaMarketId);
      addAlias(aliases, outcome.conditionId);
      (outcome.clobTokenIds || []).forEach(function (id) { addAlias(aliases, id); });
    });
    return aliases;
  }
  function flowRecordAliasList(record) {
    var aliases = [];
    if (!record) return aliases;
    addAlias(aliases, record.marketId);
    addAlias(aliases, record.conditionId || record.condition_id);
    addAlias(aliases, record.gammaMarketId);
    addAlias(aliases, record.id && String(record.id).indexOf('ost-btc5m-') === 0 ? record.id : '');
    normalizeOutcomeTokenIds(record.clobTokenIds || record.outcomeTokens || record.tokens || record.tokenIds || record.tokenId).forEach(function (id) { addAlias(aliases, id); });
    return aliases;
  }
  function isYesFlowSide(side) {
    return /^(YES|BUY|UP|LONG)$/i.test(String(side || '').trim());
  }
  function normalizeFlowSide(side) {
    return isYesFlowSide(side) ? 'YES' : 'NO';
  }
  function flowRecordKey(record) {
    return String(record && (record.signature || record.sig || record.id || record.txid || record.txHash) || '') ||
      [record && record.marketId, record && record.conditionId, record && record.wallet, record && record.side, record && record.stake, record && (record.ts || record.createdAt)].join(':');
  }
  function recordMatchesMarket(record, market) {
    if (!record || !market) return false;
    var marketId = String(market.id || '').trim();
    var recordMarketId = String(record.marketId || '').trim();
    if (marketId && recordMarketId === marketId) return true;
    if (isOstNativeMarket(market)) return false;
    var marketAliases = marketAliasList(market);
    if (!marketAliases.length) return false;
    var recordAliases = flowRecordAliasList(record);
    return recordAliases.some(function (alias) { return marketAliases.indexOf(alias) >= 0; });
  }
  function recordMatchesOutcome(record, market, outcomeKey) {
    if (!hasExplicitOutcomeContracts(market)) return true;
    var selected = getSelectedOutcomeContract(market, outcomeKey);
    if (!selected) return true;
    var recKey = String(record && (record.outcomeKey || record.key) || '').trim().toLowerCase();
    var recLabel = String(record && (record.outcomeLabel || record.label) || '').trim().toLowerCase();
    if (!recKey && !recLabel) return true;
    var selectedLabel = String(selected.label || '').trim().toLowerCase();
    return recKey === selected.key || recLabel === selectedLabel || recLabel === selected.key;
  }
  function normalizeFlowRecord(market, record, outcomeKey, origin) {
    if (!record) return null;
    var side = normalizeFlowSide(record.side || record.outcome || record.action);
    var actionText = String(record.flowAction || record.tradeAction || record.action || '').toLowerCase();
    var isSell = actionText === 'sell' || isClosedFlowRecord(record);
    var price = clampProbability(isSell && record.sellPrice != null ? record.sellPrice : (record.price != null ? record.price : record.entryPrice));
    var yesPrice = clampProbability(record.yesPrice != null ? record.yesPrice : record.yes_price);
    var noPrice = clampProbability(record.noPrice != null ? record.noPrice : record.no_price);
    var contract = market ? getModalTradeContract(market, side, record.outcomeKey || outcomeKey || '') : null;
    if (!Number.isFinite(yesPrice) && Number.isFinite(price)) yesPrice = side === 'YES' ? price : 1 - price;
    if (!Number.isFinite(noPrice) && Number.isFinite(price)) noPrice = side === 'NO' ? price : 1 - price;
    if (!Number.isFinite(yesPrice) && contract && Number.isFinite(contract.yesPrice)) yesPrice = Number(contract.yesPrice);
    if (!Number.isFinite(noPrice) && contract && Number.isFinite(contract.noPrice)) noPrice = Number(contract.noPrice);
    if (!Number.isFinite(price)) price = side === 'NO' ? noPrice : yesPrice;
    var ts = record.ts || record.createdAt || record.syncedAt || Date.now();
    return Object.assign({}, record, {
      marketId: record.marketId || (market && market.id) || '',
      marketTitle: record.marketTitle || record.title || (market && (market.title || market.question)) || '',
      side: side,
      stake: Number(isSell ? (record.sellValue || record.cashoutOst || record.stake || record.amount || record.size) : (record.stake || record.amount || record.size)) || 0,
      price: Number.isFinite(price) ? price : null,
      yesPrice: Number.isFinite(yesPrice) ? yesPrice : null,
      noPrice: Number.isFinite(noPrice) ? noPrice : null,
      flowAction: isSell ? 'sell' : (actionText || 'buy'),
      outcomeKey: record.outcomeKey || (contract && contract.key) || '',
      outcomeLabel: record.outcomeLabel || (contract && contract.label) || side,
      walletShort: record.walletShort || (record.wallet ? String(record.wallet).slice(0, 4) + '...' + String(record.wallet).slice(-4) : ''),
      ts: ts,
      origin: origin || record.origin || 'remote'
    });
  }
  function dedupeFlowRecords(records) {
    var seen = {};
    return (records || []).filter(function (record) {
      var key = flowRecordKey(record);
      if (seen[key]) return false;
      seen[key] = 1;
      return true;
    });
  }
  function addFlowToIndex(index, record) {
    var aliases = flowRecordAliasList(record);
    if (!aliases.length && record && record.marketId) addAlias(aliases, record.marketId);
    aliases.forEach(function (alias) { (index[alias] = index[alias] || []).push(record); });
  }
  function buildSharedFlowIndex(remoteRecords, activeMarket) {
    var index = {};
    dedupeFlowRecords(remoteRecords || []).forEach(function (raw) {
      if (activeMarket && !recordMatchesMarket(raw, activeMarket)) return;
      var normalized = normalizeFlowRecord(activeMarket || null, raw, '', 'remote');
      if (!normalized) return;
      addFlowToIndex(index, normalized);
      if (activeMarket) {
        marketAliasList(activeMarket).forEach(function (alias) { (index[alias] = index[alias] || []).push(normalized); });
      }
    });
    try {
      dedupeFlowRecords(readOrders()).forEach(function (raw) {
        if (activeMarket && !recordMatchesMarket(raw, activeMarket)) return;
        var normalized = normalizeFlowRecord(activeMarket || null, raw, '', 'local');
        if (!normalized) return;
        addFlowToIndex(index, normalized);
        if (activeMarket) {
          marketAliasList(activeMarket).forEach(function (alias) { (index[alias] = index[alias] || []).push(normalized); });
        }
      });
    } catch (_) {}
    Object.keys(index).forEach(function (key) { index[key] = dedupeFlowRecords(index[key]); });
    return index;
  }
  function getFlowForMarket(market, outcomeKey) {
    var rows = [];
    var bag = window.__ostSharedFeed || {};
    marketAliasList(market).forEach(function (alias) {
      if (Array.isArray(bag[alias])) rows = rows.concat(bag[alias].slice());
    });
    try {
      readOrders().forEach(function (record) { if (recordMatchesMarket(record, market)) rows.push(record); });
    } catch (_) {}
    rows = dedupeFlowRecords(rows).map(function (record) {
      return normalizeFlowRecord(market, record, outcomeKey, record && record.origin);
    }).filter(function (record) {
      return record && recordMatchesMarket(record, market) && recordMatchesOutcome(record, market, outcomeKey);
    });
    rows.sort(function (a, b) { return (new Date(b.ts).getTime() || 0) - (new Date(a.ts).getTime() || 0); });
    return rows;
  }
  function optimisticallyMergeFlowRecord(market, record) {
    try {
      var index = buildSharedFlowIndex([], market);
      var normalized = normalizeFlowRecord(market, record, record && record.outcomeKey, 'local');
      if (normalized && recordMatchesMarket(normalized, market)) {
        addFlowToIndex(index, normalized);
        marketAliasList(market).forEach(function (alias) { (index[alias] = index[alias] || []).push(normalized); });
      }
      Object.keys(index).forEach(function (key) { index[key] = dedupeFlowRecords(index[key]); });
      window.__ostSharedFeed = index;
      if (typeof window.__ostChartRedraw === 'function') window.__ostChartRedraw();
    } catch (_) {}
  }
  function getMarketQuotePrices(market, outcomeKey) {
    var yesContract = getModalTradeContract(market, 'YES', outcomeKey || '');
    var noContract = getModalTradeContract(market, 'NO', outcomeKey || '');
    var yes = clampProbability(yesContract && yesContract.yesPrice);
    var no = clampProbability(noContract && noContract.noPrice);
    if (!Number.isFinite(yes)) yes = clampProbability(market && market.yesPriceNumber);
    if (!Number.isFinite(no)) no = clampProbability(market && market.noPriceNumber);
    if (!Number.isFinite(no) && Number.isFinite(yes)) no = 1 - yes;
    if (!Number.isFinite(yes) && Number.isFinite(no)) yes = 1 - no;
    if (!Number.isFinite(yes)) yes = 0.5;
    if (!Number.isFinite(no)) no = 1 - yes;
    return { yes: yes, no: no };
  }
  function bookListLooksEmpty(target) {
    if (!target) return true;
    var text = String(target.textContent || '').trim();
    return !target.children.length || text === '-' || text === '—' || /No .*bids|No live|book unavailable|awaiting/i.test(text) || target.innerHTML.indexOf('book-empty') >= 0;
  }
  function renderQuoteDepthFallback(bodyEl, market, outcomeKey, force) {
    var yesEl = bodyEl.querySelector('[data-bind="bookYes"]');
    var noEl = bodyEl.querySelector('[data-bind="bookNo"]');
    if (!force && !bookListLooksEmpty(yesEl) && !bookListLooksEmpty(noEl)) return false;
    var q = getMarketQuotePrices(market, outcomeKey);
    function row(price, color, label) {
      return '<div class="ost-modal__book-row book-empty" style="opacity:.9;background:rgba(255,255,255,.035);">' +
        '<span style="color:' + color + ';font-weight:700;">' + fmtCents(price) + ' ' + label + '</span>' +
        '<span>live quote</span>' +
      '</div>';
    }
    if (yesEl && (force || bookListLooksEmpty(yesEl))) yesEl.innerHTML = row(q.yes, '#7ce6a8', 'quote');
    if (noEl && (force || bookListLooksEmpty(noEl))) noEl.innerHTML = row(q.no, '#ff7c8a', 'quote');
    setText(bodyEl, 'bookStatus', 'quote live - awaiting OST depth - ' + fmtTime(Date.now()));
    return true;
  }
  function renderQuoteTradesFallback(bodyEl, market, outcomeKey, statusText) {
    var body = bodyEl.querySelector('[data-bind="tradesBody"]');
    if (!body) return false;
    var q = getMarketQuotePrices(market, outcomeKey);
    var now = fmtTime(Date.now());
    body.innerHTML = '<tr>' +
      '<td>' + escapeHtml(now) + '</td>' +
      '<td style="color:#7ce6a8;font-weight:700;">YES quote</td>' +
      '<td>' + fmtCents(q.yes) + '</td>' +
      '<td>market</td>' +
    '</tr><tr>' +
      '<td>' + escapeHtml(now) + '</td>' +
      '<td style="color:#ff7c8a;font-weight:700;">NO quote</td>' +
      '<td>' + fmtCents(q.no) + '</td>' +
      '<td>market</td>' +
    '</tr>';
    setText(bodyEl, 'tradesStatus', (statusText || 'quote - awaiting OST trades') + ' - ' + now);
    return true;
  }
  function findPolymarketTokenIds(market, outcomeKey) {
    if (!market) return null;
    var selectedOutcome = getSelectedOutcomeContract(market, outcomeKey);
    if (selectedOutcome && selectedOutcome.clobTokenIds.length) return selectedOutcome.clobTokenIds.slice();
    if (market.tokenId) return [String(market.tokenId)];
    if (market.clobTokenIds && market.clobTokenIds[0]) return market.clobTokenIds.map(String).filter(Boolean);
    if (market.raw) {
      try {
        var t = market.raw.clobTokenIds || market.raw.outcomeTokens || market.raw.tokens;
        if (!t && Array.isArray(market.raw.outcomes) && market.raw.outcomes.length && typeof market.raw.outcomes[0] === 'object') t = market.raw.outcomes;
        if (!t && typeof market.raw.outcomes === 'string') {
          var parsedOutcomes = JSON.parse(market.raw.outcomes);
          if (Array.isArray(parsedOutcomes) && parsedOutcomes.length && typeof parsedOutcomes[0] === 'object') t = parsedOutcomes;
        }
        if (typeof t === 'string') t = JSON.parse(t);
        if (Array.isArray(t)) {
          var ids = t.map(function (token) {
            if (token && typeof token === 'object') return String(token.tokenId || token.token_id || token.id || token.asset_id || '').trim();
            return String(token || '').trim();
          }).filter(function (id) { return id && id.toLowerCase() !== 'yes' && id.toLowerCase() !== 'no'; });
          if (ids.length) return ids;
        }
      } catch (_) {}
    }
    return [];
  }
  function findPolymarketTokenId(market, outcomeKey) {
    var ids = findPolymarketTokenIds(market, outcomeKey);
    return ids && ids[0] ? ids[0] : null;
  }
  function fetchPolyOrderbook(tokenId) {
    if (!tokenId) return Promise.resolve(null);
    return fetchJsonResilient(pmClob('/book', 'token_id=' + encodeURIComponent(tokenId)));
  }
  function fetchPolyTrades(marketId) {
    if (!marketId) return Promise.resolve(null);
    return fetchJsonResilient(pmClob('/trades', 'market=' + encodeURIComponent(marketId) + '&limit=20'));
  }
  function fetchPolyHistory(tokenId, fallbackMarketId) {
    if (tokenId) {
      return fetchJsonResilient(pmClob('/prices-history', 'market=' + encodeURIComponent(tokenId) + '&interval=1d&fidelity=10'))
        .then(function (payload) { return payload || (fallbackMarketId ? fetchJsonResilient(pmData('/prices-history', 'market=' + encodeURIComponent(fallbackMarketId) + '&interval=1d&fidelity=10')) : null); });
    }
    if (!fallbackMarketId) return Promise.resolve(null);
    return fetchJsonResilient(pmData('/prices-history', 'market=' + encodeURIComponent(fallbackMarketId) + '&interval=1d&fidelity=10'));
  }
  // Gamma-api fallback — works from browsers (CORS-enabled), gives us
  // bestBid / bestAsk / lastTradePrice / volume24hr without needing CLOB.
  function fetchPolyGammaMarket(marketId) {
    if (!marketId) return Promise.resolve(null);
    return fetchJsonResilient(pmGamma('/markets/' + encodeURIComponent(marketId)));
  }

  // --------------------------------------------------------------------------
  // Chart drawing
  // --------------------------------------------------------------------------
  // Draw a small distinctive glyph (random pixel pattern inside a 12-px circle).
  // Each (wallet, ts) gets a deterministic look so users can recognise repeat
  // bettors without us leaking identity. Used for the bet-tick overlay.
  function drawBetGlyph(ctx, cx, cy, color, seed) {
    var s = String(seed || (cx + ',' + cy));
    var h = 0; for (var i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) >>> 0; }
    var rng = function () { h = (h * 1664525 + 1013904223) >>> 0; return (h & 0xffff) / 0xffff; };
    // Outer halo
    ctx.save();
    ctx.shadowColor = color; ctx.shadowBlur = 8;
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(cx, cy, 7, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    // Inner dark disc so the random pixel pattern reads
    ctx.fillStyle = 'rgba(8,10,18,0.92)';
    ctx.beginPath(); ctx.arc(cx, cy, 5.2, 0, Math.PI * 2); ctx.fill();
    // 4×4 random pixel mosaic in the disc, deterministic per seed
    var palette = ['#ffd980', '#7ce6a8', '#ff7c8a', '#9ba0c8', '#cbd1f0'];
    for (var py = 0; py < 4; py++) {
      for (var px = 0; px < 4; px++) {
        var dx = (px - 1.5) * 1.6, dy = (py - 1.5) * 1.6;
        if (Math.sqrt(dx*dx + dy*dy) > 4.4) continue;
        ctx.fillStyle = palette[Math.floor(rng() * palette.length)];
        ctx.fillRect(cx + dx - 0.8, cy + dy - 0.8, 1.6, 1.6);
      }
    }
    // Crisp ring
    ctx.strokeStyle = color; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(cx, cy, 6, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }

  function drawSeries(canvas, points, color, overlay) {
    if (!canvas || !points || points.length < 2) return;
    var ctx = canvas.getContext('2d');
    var dpr = window.devicePixelRatio || 1;
    var w = canvas.clientWidth || 600;
    var h = canvas.clientHeight || 200;
    canvas.width = Math.floor(w * dpr); canvas.height = Math.floor(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    points = points.map(Number).filter(Number.isFinite);
    if (points.length < 2) return;
    var min = Math.min.apply(null, points), max = Math.max.apply(null, points);
    var latest = points[points.length - 1];
    var naturalRange = max - min;
    var minimumRange = Math.abs(latest) >= 1000 ? Math.abs(latest) * 0.0012 : Math.max(Math.abs(latest) * 0.01, 0.0025);
    var range = Math.max(1e-9, naturalRange, minimumRange);
    if (range > naturalRange) {
      var center = naturalRange > 0 ? (min + max) / 2 : latest;
      min = center - range / 2;
      max = center + range / 2;
    }
    // Grid
    ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 1;
    for (var i = 1; i < 4; i++) {
      var y = (i / 4) * h;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }
    // Fill
    var grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, color + '55'); grad.addColorStop(1, color + '00');
    ctx.fillStyle = grad;
    ctx.beginPath();
    points.forEach(function (p, i) {
      var x = (i / (points.length - 1)) * w;
      var py = h - ((p - min) / range) * (h - 8) - 4;
      if (i === 0) ctx.moveTo(x, py); else ctx.lineTo(x, py);
    });
    ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath(); ctx.fill();
    // Line
    ctx.strokeStyle = color; ctx.lineWidth = 2;
    ctx.beginPath();
    points.forEach(function (p, i) {
      var x = (i / (points.length - 1)) * w;
      var py = h - ((p - min) / range) * (h - 8) - 4;
      if (i === 0) ctx.moveTo(x, py); else ctx.lineTo(x, py);
    });
    ctx.stroke();
    // Bet-tick overlay — only ticks matching the active side land on this chart.
    // overlay = [{ frac: 0..1 across width, value, seed, color? }]
    if (Array.isArray(overlay) && overlay.length) {
      overlay.forEach(function (o) {
        if (!Number.isFinite(o.frac) || !Number.isFinite(o.value)) return;
        var x = Math.max(8, Math.min(w - 8, o.frac * w));
        var py = h - ((o.value - min) / range) * (h - 8) - 4;
        py = Math.max(8, Math.min(h - 8, py));
        drawBetGlyph(ctx, x, py, o.color || color, o.seed);
      });
    }
  }

  // Combined chart: BTC USD price line (left axis) + YES/NO probability line
  // (right axis) overlaid on a single canvas. Replaces the old "toggle between
  // ticks and points" UX so users see BOTH series move in lock-step.
  //   pricePoints  : array of BTC USD numbers (the "ticks" graph)
  //   probPoints   : array of probabilities 0..1 aligned to pricePoints index
  //                  (the "points" graph). Pass null to skip the overlay.
  //   overlay      : optional bet-glyph markers anchored to the price line
  function drawCombinedSeries(canvas, pricePoints, probPoints, options) {
    if (!canvas) return;
    var opts = options || {};
    var ctx = canvas.getContext('2d');
    var dpr = window.devicePixelRatio || 1;
    var w = canvas.clientWidth || 600;
    var h = canvas.clientHeight || 220;
    canvas.width = Math.floor(w * dpr); canvas.height = Math.floor(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    var prices = (pricePoints || []).map(Number).filter(Number.isFinite);
    var probs = (probPoints || []).map(Number).filter(function (v) { return Number.isFinite(v) && v >= 0 && v <= 1; });
    if (prices.length < 2 && probs.length < 2) return;

    // Grid
    ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 1;
    for (var i = 1; i < 4; i++) {
      var y = (i / 4) * h;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }
    // Mid-line for probability axis (50%)
    ctx.strokeStyle = 'rgba(255, 217, 128, 0.20)'; ctx.setLineDash([4, 4]); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke();
    ctx.setLineDash([]);

    // ---- BTC USD price line (left axis, green/red by direction) ----
    if (prices.length >= 2) {
      var pmin = Math.min.apply(null, prices), pmax = Math.max.apply(null, prices);
      var latest = prices[prices.length - 1];
      var natural = pmax - pmin;
      var minimumRange = Math.abs(latest) >= 1000 ? Math.abs(latest) * 0.0012 : Math.max(Math.abs(latest) * 0.01, 0.0025);
      var range = Math.max(1e-9, natural, minimumRange);
      if (range > natural) {
        var center = natural > 0 ? (pmin + pmax) / 2 : latest;
        pmin = center - range / 2;
        pmax = center + range / 2;
      }
      var dir = latest >= prices[0] ? 'up' : 'down';
      var priceColor = opts.priceColor || (dir === 'up' ? '#7ce6a8' : '#ff7c8a');
      // Filled area
      var grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, priceColor + '40'); grad.addColorStop(1, priceColor + '00');
      ctx.fillStyle = grad;
      ctx.beginPath();
      prices.forEach(function (p, i) {
        var x = (i / (prices.length - 1)) * w;
        var py = h - ((p - pmin) / range) * (h - 12) - 6;
        if (i === 0) ctx.moveTo(x, py); else ctx.lineTo(x, py);
      });
      ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath(); ctx.fill();
      // Line
      ctx.strokeStyle = priceColor; ctx.lineWidth = 2;
      ctx.beginPath();
      prices.forEach(function (p, i) {
        var x = (i / (prices.length - 1)) * w;
        var py = h - ((p - pmin) / range) * (h - 12) - 6;
        if (i === 0) ctx.moveTo(x, py); else ctx.lineTo(x, py);
      });
      ctx.stroke();
      // Latest price label (left axis)
      ctx.fillStyle = priceColor; ctx.font = '11px system-ui, sans-serif'; ctx.textAlign = 'left';
      ctx.fillText('$' + latest.toFixed(2), 6, 14);
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.fillText('$' + pmin.toFixed(2), 6, h - 6);
    }

    // ---- YES probability line (right axis, fixed 0..1) ----
    if (probs.length >= 2) {
      var probColor = opts.probColor || '#ffd980';
      ctx.strokeStyle = probColor; ctx.lineWidth = 2;
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      probs.forEach(function (p, i) {
        var x = (i / (probs.length - 1)) * w;
        var py = h - p * (h - 12) - 6;
        if (i === 0) ctx.moveTo(x, py); else ctx.lineTo(x, py);
      });
      ctx.stroke();
      ctx.setLineDash([]);
      // Right-axis labels
      var lastProb = probs[probs.length - 1];
      ctx.fillStyle = probColor; ctx.font = '11px system-ui, sans-serif'; ctx.textAlign = 'right';
      ctx.fillText('YES ' + (lastProb * 100).toFixed(1) + '%', w - 6, 14);
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.fillText('100%', w - 6, 14 + 14);
      ctx.fillText('0%', w - 6, h - 6);
    }

    // Bet-tick overlay anchored to the price line
    if (Array.isArray(opts.overlay) && opts.overlay.length && prices.length >= 2) {
      var pmin2 = Math.min.apply(null, prices), pmax2 = Math.max.apply(null, prices);
      var latest2 = prices[prices.length - 1];
      var natural2 = pmax2 - pmin2;
      var min2 = Math.abs(latest2) >= 1000 ? Math.abs(latest2) * 0.0012 : Math.max(Math.abs(latest2) * 0.01, 0.0025);
      var range2 = Math.max(1e-9, natural2, min2);
      if (range2 > natural2) {
        var c2 = natural2 > 0 ? (pmin2 + pmax2) / 2 : latest2;
        pmin2 = c2 - range2 / 2;
        pmax2 = c2 + range2 / 2;
      }
      opts.overlay.forEach(function (o) {
        if (!Number.isFinite(o.frac) || !Number.isFinite(o.value)) return;
        var x = Math.max(8, Math.min(w - 8, o.frac * w));
        var py = h - ((o.value - pmin2) / range2) * (h - 12) - 6;
        py = Math.max(8, Math.min(h - 8, py));
        drawBetGlyph(ctx, x, py, o.color || '#cbd1f0', o.seed);
      });
    }
  }

  // --------------------------------------------------------------------------
  // Bet flow — drives the existing trade desk so OST cash actually moves
  // --------------------------------------------------------------------------
  function placeBetViaTradeDesk(market, side, stake, outcomeKey) {
    side = String(side || 'YES').toLowerCase() === 'no' ? 'no' : 'yes';
    return new Promise(function (resolve, reject) {
      var done = false;
      var iv = null;
      var timeout = null;
      function cleanup() {
        if (iv) clearInterval(iv);
        if (timeout) clearTimeout(timeout);
        try { window.removeEventListener('ost:prediction-order-recorded', onRecorded); } catch (_) {}
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
        if (!record) return;
        if (String(record.marketId || '') !== String(market.id || '')) return;
        finish(record);
      }
      try { window.addEventListener('ost:prediction-order-recorded', onRecorded); } catch (_) {}

      var card = document.querySelector('[data-prediction-market-id="' + String(market.id).replace(/"/g, '\\"') + '"]');
      if (!card) return fail(new Error('Market card not in DOM. Refresh the markets list and try again.'));
      card.click();
      setTimeout(function () {
        var sideToggle = document.getElementById('predictionOutcomeToggle');
        if (sideToggle) {
          if (outcomeKey) {
            var outcomeButton = sideToggle.querySelector('button[data-prediction-outcome-key="' + String(outcomeKey).replace(/"/g, '\\"') + '"]');
            if (outcomeButton) outcomeButton.click();
          } else {
            var sb = sideToggle.querySelector('button[data-prediction-side="' + side + '"]');
            if (sb) sb.click();
          }
        }
        var stakeInput = document.getElementById('predictionStakeInput');
        if (stakeInput) {
          stakeInput.value = String(stake);
          stakeInput.dispatchEvent(new Event('input', { bubbles: true }));
          stakeInput.dispatchEvent(new Event('change', { bubbles: true }));
        }
        var actionBtn = document.getElementById('predictionTradeAction') ||
                        document.querySelector('[data-prediction-trade-action]');
        if (!actionBtn) return fail(new Error('Trade desk button not found.'));
        var prevLedger = readJson(ORDERS_KEY, []) || [];
        var prevLen = prevLedger.length;
        actionBtn.click();
        timeout = setTimeout(function () {
          fail(new Error('Bet submitted - check the open positions list below for confirmation.'));
        }, 45000);
        iv = setInterval(function () {
          var now = readJson(ORDERS_KEY, []) || [];
          if (now.length > prevLen) {
            var latest = now.filter(function (order) { return order && String(order.marketId || '') === String(market.id || ''); })[0] || now[0];
            finish(latest);
          }
        }, 600);
      }, 80);
    });
  }

  function placeBetDirectly(market, side, stake, outcomeKey) {
    var api = window.OST_PREDICTION_API;
    if (!api || typeof api.placeOrder !== 'function') {
      return Promise.reject(new Error('Direct OST order API is not loaded yet.'));
    }
    if (market && market.isOstNative && market.meta && market.meta.closeAt && Date.now() >= Number(market.meta.closeAt)) {
      return Promise.reject(new Error('This 5-minute round just closed. Loading the next round...'));
    }
    var requestedSide = String(side || 'YES').toUpperCase() === 'NO' ? 'NO' : 'YES';

    // Mobile clients often reach this path before the centralized OST share state
    // has finished loading. Instead of rejecting outright, fetch the live state
    // here so the buy can proceed using the same authoritative quote that the
    // arbitrage / pressure pricing depends on.
    function ensureNativeAskReady() {
      if (!market || !market.isOstNative) return Promise.resolve();
      var existing = market.marketState || (market.meta && market.meta.marketState) || null;
      var ask = requestedSide === 'NO'
        ? Number(existing && (existing.noAskPriceNumber != null ? existing.noAskPriceNumber : existing.noPriceNumber))
        : Number(existing && (existing.yesAskPriceNumber != null ? existing.yesAskPriceNumber : existing.yesPriceNumber));
      if (existing && Number.isFinite(ask) && ask > 0) return Promise.resolve();
      return withTimeout(
        refreshNativeMarketState(market, null, nativeBaseYesInput(market)),
        5000,
        null
      );
    }

    return ensureNativeAskReady().then(function () { return placeBetDirectlyResolved(market, side, stake, outcomeKey, requestedSide); });
  }

  function placeBetDirectlyResolved(market, side, stake, outcomeKey, requestedSide) {
    var api = window.OST_PREDICTION_API;
    var contract = getModalTradeContract(market, requestedSide, outcomeKey || '');
    if (market && market.isOstNative) {
      var state = market.marketState || (market.meta && market.meta.marketState) || null;
      var ask = requestedSide === 'NO'
        ? Number(state && (state.noAskPriceNumber != null ? state.noAskPriceNumber : state.noPriceNumber))
        : Number(state && (state.yesAskPriceNumber != null ? state.yesAskPriceNumber : state.yesPriceNumber));
      if (!state || !Number.isFinite(ask) || ask <= 0) {
        return Promise.reject(new Error('Centralized OST share price is still loading. Try again in a moment.'));
      }
    }
    var contractSide = contract && contract.side ? String(contract.side).toUpperCase() : requestedSide;
    var sideForOrder = contractSide.toLowerCase();
    var price = Number(contract && contract.price);
    if (!Number.isFinite(price) || price <= 0) {
      price = contractSide === 'NO' ? Number(market && market.noPriceNumber) : Number(market && market.yesPriceNumber);
    }
    var yesPrice = Number(contract && contract.yesPrice);
    var noPrice = Number(contract && contract.noPrice);
    if (!Number.isFinite(yesPrice)) yesPrice = Number(market && market.yesPriceNumber);
    if (!Number.isFinite(noPrice)) noPrice = Number(market && market.noPriceNumber);
    if (!Number.isFinite(noPrice) && Number.isFinite(yesPrice)) noPrice = 1 - yesPrice;
    if (!Number.isFinite(yesPrice) && Number.isFinite(noPrice)) yesPrice = 1 - noPrice;
    if (!Number.isFinite(price) || price <= 0) {
      return Promise.reject(new Error('Live share price is still loading. Try again in a moment.'));
    }
    var numericStake = Number(stake) || 0;
    var shares = numericStake / price;
    var baseYes = Number(market && (market.baseYesPriceNumber != null ? market.baseYesPriceNumber : market.fairYesPriceNumber));
    if (!Number.isFinite(baseYes) && market && market.meta) baseYes = Number(market.meta.fairYesPriceNumber != null ? market.meta.fairYesPriceNumber : market.meta.baseYesPrice);
    if (!Number.isFinite(baseYes)) baseYes = Number.isFinite(yesPrice) ? yesPrice : price;
    return Promise.resolve(api.placeOrder({
      source: market.source || (market.isOstNative ? 'ost' : 'polymarket'),
      marketId: market.id,
      conditionId: (contract && contract.conditionId) || market.conditionId || (market.raw && (market.raw.conditionId || market.raw.condition_id)) || '',
      gammaMarketId: (contract && contract.gammaMarketId) || market.gammaMarketId || (market.raw && market.raw.id) || '',
      title: contract && contract.label && contract.label !== requestedSide ? (market.title + ' - ' + contract.label) : (market.title || market.question || 'Prediction ticket'),
      topic: market.topic || '',
      side: sideForOrder,
      outcomeKey: (contract && contract.key) || outcomeKey || '',
      outcomeLabel: (contract && contract.label) || requestedSide,
      stake: numericStake,
      price: price,
      yesPrice: yesPrice,
      noPrice: noPrice,
      shares: shares,
      potentialReturn: shares,
      closeAtMs: market.closeAtMs || (market.meta && market.meta.closeAt) || 0,
      clobTokenIds: contract && contract.clobTokenIds ? contract.clobTokenIds.slice(0, 4) : normalizeOutcomeTokenIds(market.clobTokenIds).slice(0, 4),
      sourceUrl: market.primaryUrl || market.sourceUrl || location.href.split('#')[0],
      baseYesPrice: baseYes,
      fairYesPrice: baseYes,
      fairNoPrice: 1 - baseYes,
      tradableYesPrice: yesPrice,
      tradableNoPrice: noPrice,
      quotedAt: Date.now(),
      quoteSource: market.meta && market.meta.priceSource || '',
      openAt: market.meta && market.meta.openAt,
      closeAt: market.meta && market.meta.closeAt,
      openPrice: market.meta && market.meta.openPrice,
      priceToBeat: market.meta && market.meta.priceToBeat,
      livePrice: market.meta && market.meta.livePrice,
      reference: Date.now().toString(36)
    })).then(function (result) {
      return result && result.record ? result.record : result;
    });
  }

  function refreshMarketQuoteBeforeBet(market) {
    if (!isFastBtcMarket(market)) {
      if (isOstNativeMarket(market)) {
        // 4.5 s gives the centralized worker fetch room to land on slow mobile
        // links — placeBetDirectly retries the fetch internally if it still misses.
        return withTimeout(refreshNativeMarketState(market, null, nativeBaseYesInput(market)), 4500, null).then(function () { return market; });
      }
      return Promise.resolve(market);
    }
    var api = window.OST_PREDICTION_API || {};
    return withTimeout(fetchCanonicalBtcRound(), 900, null)
      .then(function (round) {
        if (canonicalRoundMatchesMarket(market, round)) applyCanonicalBtcRoundToMarket(market, round);
        var spotRefresh = api && typeof api.btcSpot === 'function'
          ? withTimeout(api.btcSpot({ force: true }), 700, null)
          : Promise.resolve(null);
        return Promise.resolve(spotRefresh).then(function (tick) {
          var cachedRound = canonicalRoundMatchesMarket(market, round) ? round : cachedCanonicalBtcRound();
          var tickPrice = Number(tick && tick.price);
          var livePrice = Number.isFinite(tickPrice) && tickPrice > 1000 ? tickPrice : Number(cachedRound && cachedRound.livePrice);
          var source = (tick && tick.source) || (cachedRound && (cachedRound.livePriceSource || cachedRound.source)) || (market.meta && market.meta.priceSource) || '';
          var updatedAt = Number(tick && (tick.ts || tick.updatedAt)) || Number(cachedRound && (cachedRound.livePriceTs || cachedRound.updatedAt)) || Date.now();
          var fairYes = syncFastBtcMarketQuote(market, livePrice, source, cachedRound, updatedAt);
          if (!Number.isFinite(fairYes)) fairYes = Number(market && (market.fairYesPriceNumber != null ? market.fairYesPriceNumber : market.yesPriceNumber));
          return withTimeout(refreshNativeMarketState(market, null, fairYes), 900, null).then(function () { return market; });
        });
      })
      .catch(function () { return market; });
  }

  function placeBet(market, side, stake, outcomeKey) {
    var api = window.OST_PREDICTION_API;
    if (isFastBtcMarket(market) && api && typeof api.placeBet === 'function') {
      var sideKey = String(side || 'YES').toUpperCase() === 'NO' ? 'no' : 'yes';
      return Promise.resolve(api.placeBet({ marketId: market.id, side: sideKey, stake: stake }));
    }
    return refreshMarketQuoteBeforeBet(market).then(function (freshMarket) {
      return placeBetDirectly(freshMarket || market, side, stake, outcomeKey);
    })
      .catch(function (directError) {
        if (!directError || !/Direct OST order API/i.test(String(directError.message || ''))) throw directError;
        return placeBetViaTradeDesk(market, side, stake, outcomeKey);
      });
  }

  // --------------------------------------------------------------------------
  // Render market detail
  // --------------------------------------------------------------------------
  function renderHeaderBlock(m) {
    var tags = [];
    if (m.sourceLabel) tags.push('<span class="ost-modal__tag">' + escapeHtml(m.sourceLabel) + '</span>');
    if (m.contractLabel) tags.push('<span class="ost-modal__tag">' + escapeHtml(m.contractLabel) + '</span>');
    if (m.closeText) tags.push('<span class="ost-modal__tag ost-modal__tag--time">' + escapeHtml(m.closeText) + '</span>');
    return '<div class="ost-modal__tags">' + tags.join('') + '</div>' +
           '<h2 id="ost-modal-title" class="ost-modal__title">' + escapeHtml(m.title || 'Market') + '</h2>' +
           (m.detail ? '<p class="ost-modal__detail">' + escapeHtml(m.detail) + '</p>' : '');
  }

  function renderPricesBlock(m) {
    var defaultOutcome = getSelectedOutcomeContract(m, getModalOutcomeContracts(m)[0] && getModalOutcomeContracts(m)[0].key);
    var yes = defaultOutcome ? Number(defaultOutcome.price) : Number(m.yesPriceNumber);
    var no = defaultOutcome && Number.isFinite(defaultOutcome.price) ? 1 - Number(defaultOutcome.price) : Number(m.noPriceNumber);
    var yesLabel = defaultOutcome ? defaultOutcome.label : (m.yesLabel || 'YES');
    var noLabel = hasExplicitOutcomeContracts(m) ? 'Field' : (m.noLabel || 'NO');
    return '<div class="ost-modal__prices">' +
      '<div class="ost-modal__price ost-modal__price--yes"><span data-bind="yesLabel">' + escapeHtml(yesLabel) + '</span><strong data-bind="yesPct">' + (Number.isFinite(yes) ? Math.round(yes * 100) + '%' : '—') + '</strong></div>' +
      '<div class="ost-modal__price ost-modal__price--no"><span data-bind="noLabel">' + escapeHtml(noLabel) + '</span><strong data-bind="noPct">' + (Number.isFinite(no) ? Math.round(no * 100) + '%' : '—') + '</strong></div>' +
    '</div>';
  }

  function renderBtcBlock(m) {
    if (!m.isOstNative || !m.meta || m.meta.kind !== 'btc5m') return '';
    var priceToBeat = Number(m.priceToBeat || m.meta.priceToBeat || m.meta.openPrice || 0);
    var priceText = priceToBeat ? fmtUsd(priceToBeat) : '—';
    var equation = m.equation || m.meta.equation || ('YES wins if BTC closes above ' + priceText + '; NO wins if BTC closes at or below ' + priceText + '.');
    return '<section class="ost-modal__btc ost-modal__btc--hero">' +
      '<div class="ost-modal__btc-hero">' +
        '<div class="ost-modal__btc-hero-live">' +
          '<span>Live BTC</span>' +
          '<strong data-bind="btcLive">—</strong>' +
          '<em data-bind="btcDelta">—</em>' +
        '</div>' +
        '<div class="ost-modal__btc-hero-clock">' +
          '<span>Round closes in</span>' +
          '<strong data-bind="btcCountdown">--:--</strong>' +
        '</div>' +
      '</div>' +
      '<div class="ost-modal__btc-grid">' +
        '<div class="ost-modal__btc-row"><span>Price to beat</span><strong data-bind="btcOpen">' + priceText + '</strong></div>' +
        '<div class="ost-modal__btc-row"><span>YES odds</span><strong data-bind="yesPct">—</strong></div>' +
        '<div class="ost-modal__btc-row"><span>NO odds</span><strong data-bind="noPct">—</strong></div>' +
        '<div class="ost-modal__btc-row"><span>Equation</span><strong data-bind="btcEquation">' + escapeHtml(equation) + '</strong></div>' +
      '</div>' +
    '</section>';
  }

  function renderChartBlock() {
    return '<section class="ost-modal__chart">' +
      '<div class="ost-modal__chart-head">' +
        '<h4>Price history' +
          '<span class="ost-modal__chart-toggle" data-bind="chartToggle">' +
            '<button type="button" data-side="YES" class="is-active is-yes">YES</button>' +
            '<button type="button" data-side="NO" class="is-no">NO</button>' +
          '</span>' +
        '</h4>' +
        '<span data-bind="chartStatus">Loading…</span>' +
      '</div>' +
      '<canvas data-bind="chart"></canvas>' +
    '</section>';
  }

  // ──────────────────────────────────────────────────────────────────────
  // SELL — own open positions on this market, with live mark-to-market
  // and a working Sell button that settles via OST_TRADE.predictionCashOut
  // when available, or falls back to a local cash-out + worker sync.
  // ──────────────────────────────────────────────────────────────────────
  function readOrders() { return readJson(ORDERS_KEY, []) || []; }
  function writeOrders(list) {
    try { localStorage.setItem(ORDERS_KEY, JSON.stringify((list || []).slice(0, 300))); } catch (_) {}
  }
  function ownWallet() {
    try {
      if (window.OST_WALLET && window.OST_WALLET.session && window.OST_WALLET.session.publicKey && window.OST_WALLET.session.publicKey.toBase58) {
        return window.OST_WALLET.session.publicKey.toBase58();
      }
    } catch (_) {}
    return window.OST_WALLET_PUBKEY || (window.solana && window.solana.publicKey && window.solana.publicKey.toString && window.solana.publicKey.toString()) || '';
  }
  function ordersForMarket(market) {
    var id = String(market && market.id || '');
    if (!id) return [];
    var wallet = ownWallet();
    return readOrders().filter(function (o) {
      if (!o || String(o.marketId || '') !== id) return false;
      if (o.cashedOut) return false;
      // If a wallet is connected, only show that wallet's tickets — otherwise
      // show all local tickets so users can still settle pre-connect orders.
      return wallet ? !o.wallet || o.wallet === wallet : true;
    });
  }
  function renderSellBlock() {
    return '<section class="ost-modal__sell" data-bind="sellSection">' +
      '<div class="ost-modal__sell-head">' +
        '<h4>Your open positions on this market</h4>' +
        '<span data-bind="sellStatus" style="opacity:.6;font-size:11px;">—</span>' +
      '</div>' +
      '<div class="ost-modal__live-pl" data-bind="livePlBar" hidden>' +
        '<div class="ost-modal__live-pl-cell"><span>Stake</span><strong data-bind="livePlStake">0.00</strong></div>' +
        '<div class="ost-modal__live-pl-cell"><span>Now worth</span><strong data-bind="livePlValue">0.00</strong></div>' +
        '<div class="ost-modal__live-pl-cell"><span>P/L</span><strong data-bind="livePlPnl">+0.00</strong></div>' +
      '</div>' +
      '<div data-bind="sellList" class="ost-modal__sell-list">' +
        '<div style="opacity:.55;font-size:12px;padding:8px 0;">No open positions on this market.</div>' +
      '</div>' +
    '</section>';
  }
  function postPositionUpdate(order, market, bodyEl) {
    try {
      var payload = Object.assign({}, order, {
        wallet: order.wallet || ownWallet() || 'anon',
        marketTitle: order.title || order.marketTitle || '',
        ts: order.createdAt || order.ts || Date.now(),
        baseYesPrice: market ? nativeBaseYesInput(market) : null
      });
      rememberNativePressure(payload);
      syncNativeQuoteBody(bodyEl);
      postPositionToWorker(payload, function (j) {
          if (market && j && j.marketState) applyNativeMarketState(market, j.marketState);
          if (market && j && j.record) optimisticallyMergeFlowRecord(market, j.record);
          if (market && j && j.flowRecord) optimisticallyMergeFlowRecord(market, j.flowRecord);
          syncNativeQuoteBody(bodyEl);
        }).catch(function () {});
    } catch (_) {}
  }
  function notifyOrderChanged(order, market) {
    try { window.dispatchEvent(new CustomEvent('ost:prediction:order-changed', { detail: { order: order || null, marketId: order && order.marketId || (market && market.id) || '' } })); } catch (_) {}
    try { window.dispatchEvent(new CustomEvent('ost:wallet-changed')); } catch (_) {}
  }
  function sellOrder(order, payout, kind, market, sale, bodyEl) {
    // Positive payouts must land on-chain before the ticket is marked sold.
    var doLocal = function () {
      order.cashedOut = true;
      order.cashoutOst = Number(payout) || 0;
      order.cashoutAt = Date.now();
      order.cashoutKind = kind || 'prediction-sell-modal';
      order.status = 'sold';
      sale = sale || {};
      if (Number.isFinite(Number(sale.sellPrice))) order.sellPrice = Number(sale.sellPrice);
      if (Number.isFinite(Number(sale.sellValue))) order.sellValue = Number(sale.sellValue);
      else order.sellValue = Number(payout) || 0;
      if (Number.isFinite(Number(sale.shares))) order.sellShares = Number(sale.shares);
      var retained = Math.max(0, Number(order.stake || 0) - Number(payout || 0));
      if (retained > 0 && !order.vaultRetainedAt && typeof window.recordOstVaultRetainedLoss === 'function') {
        order.vaultRetainedAt = Date.now();
        order.vaultRetainedOst = retained;
        try {
          window.recordOstVaultRetainedLoss({
            source: 'prediction',
            subKind: 'prediction-sell-loss',
            amount: retained,
            retainedOst: retained,
            stake: Number(order.stake || 0) || 0,
            payoutOst: Number(payout || 0) || 0,
            marketId: order.marketId || (market && market.id) || '',
            title: order.title || order.marketTitle || (market && market.title) || '',
            side: order.side || '',
            linkedId: order.signature || order.sig || order.id || '',
            sig: order.cashoutSig || ''
          });
        } catch (_) {}
      }
      var sellTick = market ? sellFlowRecord(order, market, payout, sale) : null;
      var orders = readOrders();
      var idx = orders.findIndex(function (o) {
        return o && (o.signature || o.sig || o.id) === (order.signature || order.sig || order.id);
      });
      if (idx >= 0) orders[idx] = order; else orders.unshift(order);
      writeOrders(orders);
      if (sellTick) optimisticallyMergeFlowRecord(market, sellTick);
      postPositionUpdate(order, market, bodyEl);
      notifyOrderChanged(order, market);
      return Promise.resolve({ ost: Number(payout) || 0, sig: order.cashoutSig || '' });
    };
    if (!(Number(payout) > 0)) return doLocal();
    if (window.OST_TRADE && typeof window.OST_TRADE.predictionCashOut === 'function') {
      return Promise.resolve(window.OST_TRADE.predictionCashOut(order, Number(payout) || 0))
        .then(function (r) {
          if (!r || !r.sig) throw new Error('Payout was not confirmed on-chain.');
          if (Number(r.ost || 0) + 0.000000001 < Number(payout || 0)) throw new Error('Payout was not fully funded.');
          order.cashoutSig = r.sig;
          return doLocal().then(function (loc) {
            return Object.assign({}, loc, { ost: (r && Number(r.ost)) || loc.ost, sig: order.cashoutSig || loc.sig });
          });
        });
    }
    return Promise.reject(new Error('OST settlement vault is still loading. Try again in a moment.'));
  }

  // Shared positions ticker — every OST user sees every other user's recent bets
  // ON THIS MARKET (filtered server-side fetch is global, we filter per-market here).
  function renderSharedBlock() {
    return '<section class="ost-modal__shared">' +
      '<div class="ost-modal__shared-title">Live OST flow · this market</div>' +
      '<div class="ost-modal__shared-list" data-bind="sharedList">' +
        '<div style="opacity:0.55;font-size:11px;">Loading shared positions…</div>' +
      '</div>' +
    '</section>';
  }

  // Multi-outcome buttons (Trump/Harris/RFK…). Returns empty string for binary.
  function renderOutcomesBlock(m) {
    var outs = getModalOutcomeContracts(m);
    if (!Array.isArray(outs) || outs.length <= 2) return '';
    return '<section class="ost-modal__outcomes-wrap"><h4 style="margin:0 0 8px;font-size:13px;letter-spacing:0.04em;text-transform:uppercase;color:#9ba0c8;">All outcomes</h4>' +
      '<div class="ost-modal__outcomes" data-bind="outcomesList">' +
      outs.map(function (o, i) {
        var label = (o && o.label) || ('Outcome ' + (i+1));
        var price = Number(o && o.price);
        return '<button type="button" class="ost-modal__outcome' + (i === 0 ? ' is-active' : '') + '" data-outcome-idx="' + i + '">' +
               '<span class="ost-modal__outcome-label">' + escapeHtml(label) + '</span>' +
               '<span class="ost-modal__outcome-price">' + (Number.isFinite(price) ? (price * 100).toFixed(1) + '¢' : '—') + '</span>' +
               '</button>';
      }).join('') +
      '</div></section>';
  }

  function renderBookBlock() {
    return '<section class="ost-modal__book">' +
      '<div class="ost-modal__book-head"><h4>Order depth</h4><span data-bind="bookStatus">—</span></div>' +
      '<div class="ost-modal__book-cols">' +
        '<div><div class="ost-modal__book-label ost-modal__book-label--yes">YES bids</div><div data-bind="bookYes" class="ost-modal__book-list"><div class="ost-modal__book-empty">—</div></div></div>' +
        '<div><div class="ost-modal__book-label ost-modal__book-label--no">NO bids</div><div data-bind="bookNo" class="ost-modal__book-list"><div class="ost-modal__book-empty">—</div></div></div>' +
      '</div>' +
    '</section>';
  }

  function renderTradesBlock() {
    return '<section class="ost-modal__trades">' +
      '<div class="ost-modal__trades-head"><h4>Recent ticks</h4><span data-bind="tradesStatus">—</span></div>' +
      '<div class="ost-modal__trades-scroll"><table class="ost-modal__trades-table"><thead><tr><th>Time</th><th>Side</th><th>Price</th><th>Size</th></tr></thead><tbody data-bind="tradesBody"><tr><td colspan="4" style="text-align:center;opacity:0.6;">Loading…</td></tr></tbody></table></div>' +
    '</section>';
  }

  function renderBetBlock(m) {
    var multiOutcome = hasExplicitOutcomeContracts(m);
    return '<section class="ost-modal__bet">' +
      '<div class="ost-modal__bet-head"><h4>Place a bet with OST</h4></div>' +
      '<div class="ost-modal__bet-grid">' +
        '<div class="ost-modal__bet-side">' +
          '<div class="ost-modal__bet-toggle">' +
            (multiOutcome
              ? '<button type="button" data-side="YES" class="ost-modal__side-btn ost-modal__side-btn--yes is-active">Selected outcome</button>'
              : '<button type="button" data-side="YES" class="ost-modal__side-btn ost-modal__side-btn--yes is-active">YES</button>' +
                '<button type="button" data-side="NO"  class="ost-modal__side-btn ost-modal__side-btn--no">NO</button>') +
          '</div>' +
        '</div>' +
        '<label class="ost-modal__bet-stake">Stake (OST)<input type="number" min="0.01" step="0.01" value="1" data-bind="stake"></label>' +
        '<output class="ost-modal__bet-projected" data-bind="projected">—</output>' +

        '<button type="button" class="ost-modal__bet-action" data-act="placebet">Place bet</button>' +
      '</div>' +
      (m.primaryUrl ? '<a class="ost-modal__bet-venue" href="' + escapeHtml(m.primaryUrl) + '" target="_blank" rel="noopener">Open on ' + escapeHtml(m.sourceLabel || 'venue') + ' ↗</a>' : '') +
    '</section>';
  }

  // ──────────────────────────────────────────────────────────────────────
  // BROADCAST — live video panel for sports markets (soccer / World Cup
  // first). Plays an HLS stream with a built-in 15-second delay buffer so
  // the feed lags the on-chain market just enough that latency-arbitrage
  // bettors can't front-run prices. Falls back to a Tubi link-out when no
  // direct stream URL is configured for the market.
  //
  // Owner provides streams via either:
  //   window.OST_MARKET_STREAMS = { '<marketId|conditionId|slug>': 'https://.../master.m3u8' }
  //   OR per-market field market.streamUrl / market.broadcastUrl
  // ──────────────────────────────────────────────────────────────────────
  var SPORTS_RE = /\b(world\s*cup|fifa|world-?cup|champions\s*league|premier\s*league|la\s*liga|bundesliga|serie\s*a|copa|uefa|nba|nfl|ufc|boxing|f1|formula\s*1|tennis|wimbledon|atp|wta|cricket|ipl)\b|\bvs\.?\b|\b—\b.*\b—\b/i;
  function isSportsMarket(m) {
    var t = String((m && (m.title || m.question || m.detail || '')) || '');
    var topic = String((m && m.topic) || '');
    if (SPORTS_RE.test(t) || SPORTS_RE.test(topic)) return true;
    return false;
  }
  function tubiSearchUrl(m) {
    var q = String((m && (m.title || m.question || '')) || '').replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
    return 'https://tubitv.com/search/' + encodeURIComponent(q || 'fifa world cup');
  }
  function streamForMarket(m) {
    if (!m) return '';
    if (m.streamUrl) return String(m.streamUrl);
    if (m.broadcastUrl) return String(m.broadcastUrl);
    var registry = window.OST_MARKET_STREAMS;
    if (registry && typeof registry === 'object') {
      return String(registry[m.id] || registry[m.conditionId] || registry[m.slug] || '');
    }
    return '';
  }
  function renderBroadcastBlock(m) {
    if (!isSportsMarket(m)) return '';
    var stream = streamForMarket(m);
    var tubi = tubiSearchUrl(m);
    return '<section class="ost-modal__broadcast" data-bind="broadcastSection" style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:12px;margin-top:12px;">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px;">' +
        '<h4 style="margin:0;font-size:14px;letter-spacing:.04em;">📺 Live broadcast' +
          '<span style="margin-left:8px;font-size:10px;font-weight:600;padding:2px 6px;border-radius:4px;background:rgba(244,114,182,.15);color:#f472b6;border:1px solid rgba(244,114,182,.35);">15s DELAY</span>' +
        '</h4>' +
        '<a href="' + escapeHtml(tubi) + '" target="_blank" rel="noopener" style="font-size:12px;color:#fbbf24;text-decoration:none;border:1px solid rgba(251,191,36,.4);padding:4px 10px;border-radius:6px;">Watch on Tubi ↗</a>' +
      '</div>' +
      (stream
        ? '<video data-bind="broadcastVideo" controls playsinline muted preload="none" style="width:100%;max-height:360px;background:#000;border-radius:8px;"></video>' +
          '<div style="display:flex;gap:8px;align-items:center;margin-top:6px;font-size:11px;opacity:.7;">' +
            '<span data-bind="broadcastStatus">Click ▶ to start the 15-second-delayed feed.</span>' +
          '</div>'
        : '<div style="padding:10px;border-radius:6px;background:rgba(251,191,36,.06);border:1px dashed rgba(251,191,36,.3);font-size:12px;opacity:.85;">' +
            'No direct stream wired for this market yet. Open Tubi above to watch the live broadcast (Tubi adds its own ~10–15 s delay), then come back to bet.' +
          '</div>'
      ) +
    '</section>';
  }
  function loadHlsScript() {
    if (window.Hls) return Promise.resolve(window.Hls);
    if (loadHlsScript._p) return loadHlsScript._p;
    loadHlsScript._p = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/hls.js@1.5.13/dist/hls.min.js';
      s.async = true;
      s.onload = function () { resolve(window.Hls); };
      s.onerror = function () { reject(new Error('Failed to load hls.js')); };
      document.head.appendChild(s);
    });
    return loadHlsScript._p;
  }
  function wireBroadcast(bodyEl, market) {
    var video = bodyEl.querySelector('[data-bind="broadcastVideo"]');
    if (!video) return;
    var stream = streamForMarket(market);
    if (!stream) return;
    var DELAY_S = 15;
    function setStatus(msg) {
      var el = bodyEl.querySelector('[data-bind="broadcastStatus"]');
      if (el) el.textContent = msg;
    }
    // Native HLS (Safari / iOS).
    if (video.canPlayType && video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = stream;
      video.addEventListener('loadedmetadata', function () {
        try {
          if (video.seekable && video.seekable.length) {
            var end = video.seekable.end(video.seekable.length - 1);
            video.currentTime = Math.max(0, end - DELAY_S);
          }
        } catch (_) {}
        setStatus('Live · 15s behind real-time (Safari native).');
      });
      return;
    }
    // hls.js for everything else.
    setStatus('Loading player…');
    loadHlsScript().then(function (Hls) {
      if (!Hls || !Hls.isSupported()) {
        setStatus('Browser cannot play HLS. Use the Tubi link instead.');
        return;
      }
      var hls = new Hls({
        lowLatencyMode: false,
        liveSyncDuration: DELAY_S,
        liveMaxLatencyDuration: DELAY_S * 2,
        backBufferLength: 60
      });
      hls.loadSource(stream);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, function () {
        setStatus('Live · 15s behind real-time. Click ▶ to play.');
      });
      hls.on(Hls.Events.ERROR, function (_evt, data) {
        if (data && data.fatal) {
          setStatus('Stream error: ' + (data.details || data.type) + '. Try the Tubi link.');
          try { hls.destroy(); } catch (_) {}
        }
      });
      // Stash for cleanup on close.
      bodyEl.__broadcastHls = hls;
    }).catch(function (e) {
      setStatus('Player unavailable: ' + (e && e.message || 'unknown') + '. Use the Tubi link.');
    });
  }

  function renderSkeleton(m) {
    return '<header class="ost-modal__header">' + renderHeaderBlock(m) + '</header>' +
           '<div class="ost-modal__main">' +
             renderBtcBlock(m) +
             (isFastBtcMarket(m) ? '' : renderPricesBlock(m)) +
             renderOutcomesBlock(m) +
             renderChartBlock() +
             renderBroadcastBlock(m) +
             '<div class="ost-modal__two-col">' +
               renderBookBlock() +
               renderTradesBlock() +
             '</div>' +
             renderBetBlock(m) +
             renderSellBlock() +
             renderSharedBlock() +
           '</div>';
  }

  function setText(scope, key, val) {
    scope.querySelectorAll('[data-bind="' + key + '"]').forEach(function (n) { n.textContent = val; });
  }

  // --------------------------------------------------------------------------
  // OPEN — public entry point
  // --------------------------------------------------------------------------
  function open(marketIdOrObj) {
    var market = (marketIdOrObj && typeof marketIdOrObj === 'object') ? marketIdOrObj : findMarket(marketIdOrObj);
    if (!market) { console.warn('[ost-modal] no market for', marketIdOrObj); return; }
    clearLiveTimers();

    openModal(renderSkeleton(market));
    var modal = ensureModal();
    var bodyEl = modal.querySelector('[data-bind="body"]');

    // ---- Bet wiring ----
    var selectedSide = 'YES';
    var selectedOutcomeKey = (getModalOutcomeContracts(market)[0] && getModalOutcomeContracts(market)[0].key) || '';
    function getActiveContract() {
      return getModalTradeContract(market, selectedSide, selectedOutcomeKey);
    }
    function syncActiveContractUi() {
      var contract = getActiveContract();
      var yesLabelEl = bodyEl.querySelector('[data-bind="yesLabel"]');
      var noLabelEl = bodyEl.querySelector('[data-bind="noLabel"]');
      var yesPctEl = bodyEl.querySelector('[data-bind="yesPct"]');
      var noPctEl = bodyEl.querySelector('[data-bind="noPct"]');
      if (yesLabelEl) yesLabelEl.textContent = contract && contract.label ? contract.label : (market.yesLabel || 'YES');
      if (noLabelEl) noLabelEl.textContent = hasExplicitOutcomeContracts(market) ? 'Field' : (market.noLabel || 'NO');
      if (yesPctEl) yesPctEl.textContent = Number.isFinite(contract && contract.yesPrice) ? (Number(contract.yesPrice) * 100).toFixed(1) + '%' : '—';
      if (noPctEl) noPctEl.textContent = Number.isFinite(contract && contract.noPrice) ? (Number(contract.noPrice) * 100).toFixed(1) + '%' : '—';
    }
    bodyEl.querySelectorAll('.ost-modal__side-btn').forEach(function (b) {
      b.addEventListener('click', function () {
        selectedSide = b.getAttribute('data-side');
        bodyEl.querySelectorAll('.ost-modal__side-btn').forEach(function (x) { x.classList.remove('is-active'); });
        b.classList.add('is-active');
        recalcProjected();
      });
    });
    function getStake() {
      var i = bodyEl.querySelector('[data-bind="stake"]');
      return Math.max(0, parseFloat(i && i.value) || 0);
    }
    function recalcProjected() {
      var s = getStake();
      var contract = getActiveContract();
      var px = contract ? Number(contract.price) : NaN;
      if (!Number.isFinite(px) || px <= 0) px = 0.5;
      var shares = s / px;
      setText(bodyEl, 'projected', 'Win ' + shares.toFixed(2) + ' OST · risk ' + s.toFixed(2) + ' OST · @ ' + fmtCents(px));
    }
    var stakeInput = bodyEl.querySelector('[data-bind="stake"]');
    if (stakeInput) stakeInput.addEventListener('input', recalcProjected);
    syncActiveContractUi();
    recalcProjected();

    bodyEl.__syncNativeQuoteUi = function () {
      syncActiveContractUi();
      recalcProjected();
      try { if (typeof bodyEl.__renderOstNativeBook === 'function') bodyEl.__renderOstNativeBook(); } catch (_) {}
      try { if (typeof bodyEl.__renderTradesTable === 'function') bodyEl.__renderTradesTable(); } catch (_) {}
      try { if (typeof window.__ostChartRedraw === 'function') window.__ostChartRedraw(); } catch (_) {}
      try { if (typeof bodyEl.__refreshSell === 'function') bodyEl.__refreshSell(); } catch (_) {}
    };
    bodyEl.__nativeStateListener = function (event) {
      var detail = event && event.detail || {};
      if (String(detail.marketId || '') !== String(market.id || '')) return;
      if (detail.state && detail.state !== market.marketState) {
        applyNativeMarketState(market, detail.state);
      }
      bodyEl.__syncNativeQuoteUi();
    };
    try { window.addEventListener('ost:native-market-state', bodyEl.__nativeStateListener); } catch (_) {}
    if (market.isOstNative) refreshNativeMarketState(market, bodyEl);

    var placeBetButton = bodyEl.querySelector('[data-act="placebet"]');
    var placeBetPending = false;
    if (placeBetButton) placeBetButton.addEventListener('click', function () {
      if (placeBetPending) return;
      var s = getStake();
      if (!s) { toast('Set a stake first.', 'err'); return; }
      var originalText = placeBetButton.textContent;
      var slowTimer = null;
      placeBetPending = true;
      placeBetButton.disabled = true;
      placeBetButton.classList.add('is-loading');
      placeBetButton.setAttribute('aria-busy', 'true');
      placeBetButton.textContent = 'Submitting...';
      slowTimer = setTimeout(function () {
        if (placeBetPending) toast('Still waiting for wallet approval or share-state confirmation...', 'ok');
      }, 8000);
      function resetPlaceBetButton() {
        if (slowTimer) clearTimeout(slowTimer);
        placeBetPending = false;
        if (!placeBetButton) return;
        placeBetButton.disabled = false;
        placeBetButton.classList.remove('is-loading');
        placeBetButton.removeAttribute('aria-busy');
        placeBetButton.textContent = originalText || 'Place bet';
      }
      toast('Submitting ' + selectedSide + ' ' + s + ' OST…', 'ok');
      placeBet(market, selectedSide, s, selectedOutcomeKey)
        .then(function (rec) {
          toast('✅ Bet recorded' + (rec && rec.sig ? ' (sig ' + String(rec.sig).slice(0, 8) + '…)' : '') + '. Check Open Positions below.', 'ok');
          // Share to global feed so every other OST user sees the tick live.
          shareBetGlobally(market, selectedSide, s, rec, selectedOutcomeKey, bodyEl);
          bodyEl.__syncNativeQuoteUi && bodyEl.__syncNativeQuoteUi();
        })
        .catch(function (err) {
          toast('⚠️ ' + (err && err.message ? err.message : 'Bet failed'), 'err');
        })
        .then(function () {
          resetPlaceBetButton();
        });
    });

    // ---- Chart YES/NO toggle ----
    var chartSide = 'YES';
    bodyEl.querySelectorAll('[data-bind="chartToggle"] button').forEach(function (b) {
      b.addEventListener('click', function () {
        chartSide = b.getAttribute('data-side');
        bodyEl.querySelectorAll('[data-bind="chartToggle"] button').forEach(function (x) { x.classList.remove('is-active'); });
        b.classList.add('is-active');
        if (typeof window.__ostRequestChartHistory === 'function') window.__ostRequestChartHistory(chartSide);
        if (typeof window.__ostChartRedraw === 'function') window.__ostChartRedraw();
      });
    });
    // Expose for the polymarket renderLiveHistory closure further down
    bodyEl.__getChartSide = function () { return chartSide; };

    // ---- Multi-outcome buttons (selectable) ----
    bodyEl.querySelectorAll('.ost-modal__outcome').forEach(function (b) {
      b.addEventListener('click', function () {
        bodyEl.querySelectorAll('.ost-modal__outcome').forEach(function (x) { x.classList.remove('is-active'); });
        b.classList.add('is-active');
        var idx = Number(b.getAttribute('data-outcome-idx'));
        var outs = getModalOutcomeContracts(market);
        var picked = outs[idx];
        if (!picked) return;
        selectedOutcomeKey = picked.key;
        selectedSide = 'YES';
        bodyEl.querySelectorAll('.ost-modal__side-btn').forEach(function (x) { x.classList.toggle('is-active', x.getAttribute('data-side') === 'YES'); });
        syncActiveContractUi();
        recalcProjected();
        if (typeof bodyEl.__ostRefreshSelectedOutcome === 'function') bodyEl.__ostRefreshSelectedOutcome();
      });
    });

    // ---- Shared positions feed (cross-user ticker) ----
    var sharedListEl = bodyEl.querySelector('[data-bind="sharedList"]');
    function applySharedFeed(recentRows) {
      window.__ostSharedFeed = buildSharedFlowIndex(recentRows || [], market);
      if (typeof window.__ostChartRedraw === 'function') {
        try { window.__ostChartRedraw(); } catch (_) {}
      }
      try { if (typeof bodyEl.__renderOstNativeBook === 'function') bodyEl.__renderOstNativeBook(); } catch (_) {}
      try { if (typeof bodyEl.__renderTradesTable === 'function') bodyEl.__renderTradesTable(); } catch (_) {}
      if (!sharedListEl) return;
      var thisMarketBets = getFlowForMarket(market, selectedOutcomeKey).slice(0, 12);
      if (!thisMarketBets.length) {
        sharedListEl.innerHTML = '<div style="opacity:0.55;font-size:11px;">No OST bets on this market yet - be the first.</div>';
        return;
      }
      sharedListEl.innerHTML = thisMarketBets.map(function (r) {
        var sideClass = /YES|BUY/i.test(r.side) ? 'is-yes' : 'is-no';
        var isSell = String(r.flowAction || r.tradeAction || r.action || '').toLowerCase() === 'sell' || isClosedFlowRecord(r);
        var ago = Math.max(0, Math.round((Date.now() - new Date(r.ts).getTime()) / 1000));
        var agoStr = ago < 60 ? (ago + 's ago') : (Math.round(ago / 60) + 'm ago');
        var pxTxt = Number.isFinite(Number(r.price)) ? ' @ ' + (Number(r.price) * 100).toFixed(1) + 'c' : '';
        return '<div class="ost-modal__shared-row ' + sideClass + '">' +
          '<span class="ost-modal__shared-wallet">' + escapeHtml(r.walletShort || (r.wallet || 'anon').slice(0, 4) + '...') + '</span>' +
          '<span class="ost-modal__shared-side">' + escapeHtml((isSell ? 'SELL ' : 'BUY ') + (r.outcomeLabel || r.side)) + '</span>' +
          '<span class="ost-modal__shared-stake">' + Number(r.stake || 0).toFixed(2) + ' OST' + pxTxt + '</span>' +
          '<span class="ost-modal__shared-time">' + agoStr + '</span>' +
        '</div>';
      }).join('');
    }
    function refreshSharedFeed() {
      var base = (window.OST_API_BASE || '').replace(/\/$/, '');
      if (!base) { applySharedFeed([]); return; }
      if (refreshSharedFeed.inFlight) return;
      refreshSharedFeed.inFlight = true;
      var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var timeoutId = controller ? setTimeout(function () { try { controller.abort(); } catch (_) {} }, 3500) : null;
      fetch(base + '/positions/recent?marketId=' + encodeURIComponent(market.id || '') + '&limit=120', {
        cache: 'no-store',
        signal: controller ? controller.signal : undefined
      })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) { applySharedFeed(j && Array.isArray(j.recent) ? j.recent : []); })
        .catch(function () {
          if (!window.__ostSharedFeed || !window.__ostSharedFeed[market.id]) applySharedFeed([]);
        })
        .then(function () {
          if (timeoutId) clearTimeout(timeoutId);
          refreshSharedFeed.inFlight = false;
        });
    }
    refreshSharedFeed();
    liveTimers.push(setInterval(refreshSharedFeed, 1000));

    // ---- Sell open positions on this market (live mark-to-market) ----
    var sellListEl = bodyEl.querySelector('[data-bind="sellList"]');
    function refreshSellList() {
      if (!sellListEl) return;
      var positions = ordersForMarket(market);
      setText(bodyEl, 'sellStatus', positions.length ? (positions.length + ' open') : 'no positions');
      var plBar = bodyEl.querySelector('[data-bind="livePlBar"]');
      if (!positions.length) {
        sellListEl.innerHTML = '<div style="opacity:.55;font-size:12px;padding:8px 0;">No open positions on this market. Buy YES or NO above to open one.</div>';
        if (plBar) plBar.hidden = true;
        return;
      }
      // ---- Aggregate live P/L across all open positions on this market ----
      var totalStake = 0, totalValue = 0;
      positions.forEach(function (o) {
        var side = String(o.side || 'yes').toLowerCase() === 'no' ? 'NO' : 'YES';
        var stake = Number(o.stake || 0) || 0;
        var entryPx = Number(o.price || (side === 'NO' ? o.noPrice : o.yesPrice)) || 0;
        var shares = Number(o.shares) > 0 ? Number(o.shares) : (entryPx > 0 ? stake / entryPx : 0);
        var contract = getModalTradeContract(market, side, o.outcomeKey || '');
        var livePx = side === 'NO' ? Number(contract && contract.noPrice) : Number(contract && contract.yesPrice);
        livePx = getNativeSellQuotePrice(market, side, livePx);
        if (!Number.isFinite(livePx) || livePx <= 0) livePx = entryPx;
        totalStake += stake;
        totalValue += shares > 0 && livePx > 0 ? shares * livePx : stake;
      });
      var totalPnl = totalValue - totalStake;
      if (plBar) {
        plBar.hidden = false;
        plBar.classList.toggle('is-up', totalPnl > 0.0001);
        plBar.classList.toggle('is-down', totalPnl < -0.0001);
        setText(bodyEl, 'livePlStake', totalStake.toFixed(2) + ' OST');
        setText(bodyEl, 'livePlValue', totalValue.toFixed(2) + ' OST');
        var pnlEl = bodyEl.querySelector('[data-bind="livePlPnl"]');
        if (pnlEl) pnlEl.textContent = (totalPnl >= 0 ? '+' : '−') + Math.abs(totalPnl).toFixed(2) + ' OST';
      }
      sellListEl.innerHTML = positions.map(function (o, i) {
        var side = String(o.side || 'yes').toLowerCase() === 'no' ? 'NO' : 'YES';
        var sideColor = side === 'NO' ? '#ff7c8a' : '#7ce6a8';
        var stake = Number(o.stake || 0) || 0;
        var entryPx = Number(o.price || (side === 'NO' ? o.noPrice : o.yesPrice)) || 0;
        var shares = Number(o.shares) > 0 ? Number(o.shares) : (entryPx > 0 ? stake / entryPx : 0);
        var contract = getModalTradeContract(market, side, o.outcomeKey || '');
        var livePx = side === 'NO' ? Number(contract && contract.noPrice) : Number(contract && contract.yesPrice);
        livePx = getNativeSellQuotePrice(market, side, livePx);
        if (!Number.isFinite(livePx) || livePx <= 0) livePx = entryPx;
        var liveValue = shares > 0 && livePx > 0 ? shares * livePx : stake;
        var pnl = liveValue - stake;
        var pnlColor = pnl >= 0 ? '#7ce6a8' : '#ff7c8a';
        var pnlStr = (pnl >= 0 ? '+' : '−') + Math.abs(pnl).toFixed(2);
        var sideLabel = o.outcomeLabel || (contract && contract.label) || side;
        return '<div class="ost-modal__sell-row" data-sell-key="' + escapeHtml(o.signature || o.sig || o.id || ('idx-' + i)) + '" style="display:flex;align-items:center;gap:10px;padding:8px 0;border-top:1px solid rgba(255,255,255,.06);">' +
          '<span style="font-weight:700;color:' + sideColor + ';min-width:34px;">' + escapeHtml(sideLabel) + '</span>' +
          '<span style="opacity:.85;font-size:12px;">' + stake.toFixed(2) + ' OST @ ' + (entryPx > 0 ? (entryPx * 100).toFixed(1) + '¢' : '—') + '</span>' +
          '<span style="opacity:.85;font-size:12px;">live ' + (livePx * 100).toFixed(1) + '¢</span>' +
          '<span style="opacity:.85;font-size:12px;">value <b>' + liveValue.toFixed(2) + '</b></span>' +
          '<span style="font-size:12px;color:' + pnlColor + ';font-weight:700;">' + pnlStr + ' OST</span>' +
          '<button type="button" data-act="sell" data-sell-idx="' + i + '" style="margin-left:auto;padding:5px 12px;border-radius:6px;border:none;background:#22c55e;color:#031;cursor:pointer;font-weight:700;font-size:12px;">Sell ' + liveValue.toFixed(2) + ' OST</button>' +
        '</div>';
      }).join('');
      sellListEl.querySelectorAll('button[data-act="sell"]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var idx = Number(btn.getAttribute('data-sell-idx'));
          var positions = ordersForMarket(market);
          var order = positions[idx];
          if (!order) return;
          var side = String(order.side || 'yes').toLowerCase() === 'no' ? 'NO' : 'YES';
          var entryPx = Number(order.price || (side === 'NO' ? order.noPrice : order.yesPrice)) || 0;
          var shares = Number(order.shares) > 0 ? Number(order.shares) : (entryPx > 0 ? Number(order.stake || 0) / entryPx : 0);
          var contract = getModalTradeContract(market, side, order.outcomeKey || '');
          var livePx = side === 'NO' ? Number(contract && contract.noPrice) : Number(contract && contract.yesPrice);
          livePx = getNativeSellQuotePrice(market, side, livePx);
          if (!Number.isFinite(livePx) || livePx <= 0) livePx = entryPx;
          var payout = Math.max(0, shares * livePx);
          if (!(payout > 0)) { toast('Cannot sell at 0¢', 'err'); return; }
          var orig = btn.textContent;
          btn.disabled = true; btn.textContent = '…';
          sellOrder(order, payout, 'prediction-sell-modal', market, { sellPrice: livePx, sellValue: payout, shares: shares }, bodyEl)
            .then(function (r) {
              toast('✅ Sold ' + (Number(r.ost) || payout).toFixed(2) + ' OST' + (r.sig ? ' (' + String(r.sig).slice(0, 8) + '…)' : ''), 'ok');
              refreshSellList();
            })
            .catch(function (e) {
              btn.disabled = false; btn.textContent = orig;
              toast('Sell failed: ' + (e && e.message || 'unknown'), 'err');
            });
        });
      });
    }
    refreshSellList();
    liveTimers.push(setInterval(refreshSellList, 1000));
    bodyEl.__refreshSell = refreshSellList;
    window.addEventListener('ost:prediction:order-changed', refreshSellList);

    // ---- Broadcast (HLS player with 15s delay for sports markets) ----
    try { wireBroadcast(bodyEl, market); } catch (e) { console.warn('[ost-modal] broadcast wire failed', e); }

    // ---- Live BTC tile ----
    if (market.isOstNative && isFastBtcMarket(market)) {
      market.meta = market.meta || {};
      market.meta.kind = 'btc5m';
      lockBtcFeedForRound(market.meta.openAt);
      // Track last rendered price so we can flash green/red on every real tick
      // — mobile users want to see the money moving every second.
      var lastRenderedPrice = 0;
      var lastNativeQuoteBase = NaN;
      var lastNativeQuoteFetchAt = 0;
      var nativeQuoteRefreshInFlight = false;
      var flashTimer = null;
      function flashPrice(direction) {
        var liveEl = bodyEl.querySelector('[data-bind="btcLive"]');
        var btcSection = bodyEl.querySelector('.ost-modal__btc');
        if (!liveEl) return;
        liveEl.classList.remove('is-up', 'is-down');
        if (btcSection) btcSection.classList.remove('is-up', 'is-down');
        if (direction === 'up' || direction === 'down') {
          liveEl.classList.add('is-' + direction);
          if (btcSection) btcSection.classList.add('is-' + direction);
        }
        if (flashTimer) clearTimeout(flashTimer);
        flashTimer = setTimeout(function () {
          liveEl.classList.remove('is-up', 'is-down');
          if (btcSection) btcSection.classList.remove('is-up', 'is-down');
        }, 700);
      }
      var roundRolloverStarted = false;
      function openCanonicalBtcRound(round) {
        if (!round || !Number(round.openAt) || !Number(round.closeAt)) return false;
        if (Number(round.openAt) === Number(market.meta.openAt)) return false;
        if (Number(round.closeAt) <= Date.now() - 1000) return false;
        var openPrice = Number(round.openPrice);
        var priceToBeat = Number(round.priceToBeat);
        if (!Number.isFinite(priceToBeat) || priceToBeat <= 0) priceToBeat = Number.isFinite(openPrice) && openPrice > 0 ? openPrice : Number(round.priceToBeat || round.openPrice);
        var livePrice = Number(round.livePrice);
        var yes = Number(round.yesPriceNumber);
        var no = Number(round.noPriceNumber);
        var id = round.marketId || round.roundId || ('ost-btc5m-' + Number(round.openAt));
        var next = findMarket(id);
        if (!next || !next.meta || Number(next.meta.openAt) !== Number(round.openAt)) {
          next = {
            id: id,
            source: 'ost',
            isOstNative: true,
            title: 'BTC 5 Minute Up or Down',
            question: 'Will BTC close above ' + (Number.isFinite(openPrice) ? fmtUsd(openPrice) : 'the price to beat') + ' at round close?',
            topic: 'BTC',
            outcomes: ['YES', 'NO'],
            yesPriceNumber: Number.isFinite(yes) ? yes : 0.5,
            noPriceNumber: Number.isFinite(no) ? no : (Number.isFinite(yes) ? 1 - yes : 0.5),
            baseYesPriceNumber: Number.isFinite(yes) ? yes : 0.5,
            baseNoPriceNumber: Number.isFinite(no) ? no : (Number.isFinite(yes) ? 1 - yes : 0.5),
            closeAtMs: Number(round.closeAt),
            meta: {
              kind: 'btc5m',
              openAt: Number(round.openAt),
              closeAt: Number(round.closeAt),
              openPrice: Number.isFinite(openPrice) ? openPrice : 0,
              priceToBeat: Number.isFinite(priceToBeat) ? priceToBeat : 0,
              livePrice: Number.isFinite(livePrice) ? livePrice : 0
            }
          };
        }
        applyCanonicalBtcRoundToMarket(next, round);
        open(next);
        return true;
      }
      var tickBtc = function () {
        var rawMsLeft = Number(market.meta.closeAt) - Date.now();
        if (rawMsLeft <= 0) {
          setText(bodyEl, 'btcCountdown', 'loading next');
          if (!roundRolloverStarted) {
            roundRolloverStarted = true;
            fetchCanonicalBtcRound().then(function (round) {
              if (!openCanonicalBtcRound(round)) {
                setTimeout(function () { roundRolloverStarted = false; }, 1000);
              }
            }).catch(function () { setTimeout(function () { roundRolloverStarted = false; }, 1000); });
          }
          return;
        }
        var msLeft = Math.max(0, rawMsLeft);
        var mm = Math.floor(msLeft / 60000), ss = Math.floor((msLeft % 60000) / 1000);
        setText(bodyEl, 'btcCountdown', mm + ':' + (ss < 10 ? '0' : '') + ss);
        // urgency cue when <30s remain
        var pulseEl = bodyEl.querySelector('[data-bind="btcCountdown"]');
        if (pulseEl) {
          if (msLeft > 0 && msLeft <= 30000) pulseEl.classList.add('is-urgent');
          else pulseEl.classList.remove('is-urgent');
        }
        var cachedRound = cachedCanonicalBtcRound();
        if (canonicalRoundMatchesMarket(market, cachedRound)) applyCanonicalBtcRoundToMarket(market, cachedRound);
        if (!market.meta.openPrice) {
          var rec = (readJson(ROUND_KEY, {})[String(market.meta.openAt)] || {});
          if (rec.openPrice) market.meta.openPrice = rec.openPrice;
        }
        setText(bodyEl, 'btcOpen', market.meta.priceToBeat || market.meta.openPrice ? fmtUsd(market.meta.priceToBeat || market.meta.openPrice) : '—');
      };
      tickBtc();
      liveTimers.push(setInterval(tickBtc, 500));
      var fetchSharedBtcTick = function () {
        var api = window.OST_PREDICTION_API;
        var cachedRound = cachedCanonicalBtcRound();
        var cachedTickPromise = api && typeof api.btcSpot === 'function'
          ? Promise.resolve(api.btcSpot()).catch(function () { return null; })
          : Promise.resolve(null);
        return cachedTickPromise.then(function (cachedTick) {
          var cachedPrice = Number(cachedTick && cachedTick.price);
          var cachedTs = Number(cachedTick && (cachedTick.ts || cachedTick.updatedAt)) || 0;
          var cachedFresh = Number.isFinite(cachedPrice) && cachedPrice > 1000 && (!cachedTs || Date.now() - cachedTs < 1500);
          if (cachedFresh) {
            return { price: cachedPrice, source: cachedTick.source || 'binance-ws', ts: cachedTs || Date.now(), round: cachedRound };
          }
          return fetchCanonicalBtcRound().then(function (round) {
            if (canonicalRoundMatchesMarket(market, round)) {
              applyCanonicalBtcRoundToMarket(market, round);
              var canonicalPrice = Number(round.livePrice);
              if (Number.isFinite(canonicalPrice) && canonicalPrice > 1000 && canonicalBtcRoundIsHot(round)) {
                return { price: canonicalPrice, source: round.livePriceSource || round.source || 'ost-canonical', ts: Number(round.livePriceTs || round.updatedAt) || Date.now(), round: round };
              }
            }
            if (api && typeof api.btcSpot === 'function') {
              return api.btcSpot({ force: true, directOnly: true }).then(function (tick) {
                var p = tick && Number(tick.price);
                if (!Number.isFinite(p)) throw new Error('shared BTC feed empty');
                return { price: p, source: tick.source || '', ts: Number(tick && (tick.ts || tick.updatedAt)) || Date.now(), round: round || cachedRound };
              });
            }
            return fetchBtcRace().then(function (p) { return { price: p, source: BTC_PRICE_FEEDS[BTC_FEED_INDEX].name, ts: Date.now() }; });
          });
        }).catch(function () {
          return fetchBtcRace().then(function (p) { return { price: p, source: BTC_PRICE_FEEDS[BTC_FEED_INDEX].name, ts: Date.now() }; });
        });
      };
      var btcLiveInFlight = false;
      var fetchBtcLive = function () {
        if (btcLiveInFlight) return;
        btcLiveInFlight = true;
        fetchSharedBtcTick()
          .then(function (tick) {
            var p = tick && Number(tick.price);
            if (!Number.isFinite(p)) {
              setText(bodyEl, 'btcLive', 'feed offline');
              return;
            }
          var sharedRound = canonicalRoundMatchesMarket(market, tick && tick.round) ? tick.round : cachedCanonicalBtcRound();
          var sourceName = tick.source || (sharedRound && (sharedRound.livePriceSource || sharedRound.source)) || BTC_PRICE_FEEDS[BTC_FEED_INDEX].name;
          var tickTs = Number(tick && (tick.ts || tick.updatedAt)) || Number(sharedRound && (sharedRound.livePriceTs || sharedRound.updatedAt)) || Date.now();
          var yesProb = syncFastBtcMarketQuote(market, p, sourceName, sharedRound, tickTs);
          // Flash green/red whenever the price actually moves so mobile users
          // see the money moving on every real tick.
          if (lastRenderedPrice && p !== lastRenderedPrice) {
            flashPrice(p > lastRenderedPrice ? 'up' : 'down');
          }
          lastRenderedPrice = p;
          setText(bodyEl, 'btcLive', fmtUsd(p) + '  · ' + sourceName);
          var beatPrice = Number(market.meta.priceToBeat || market.meta.openPrice || 0);
          if (!(beatPrice > 0)) {
            setText(bodyEl, 'btcOpen', 'loading');
            setText(bodyEl, 'btcEquation', 'Loading the canonical Binance price to beat...');
            setText(bodyEl, 'btcLive', fmtUsd(p) + ' - ' + sourceName);
            return;
          }
          setText(bodyEl, 'btcOpen', fmtUsd(beatPrice));
          setText(bodyEl, 'btcEquation', market.meta.equation || ('YES wins if BTC closes above ' + fmtUsd(beatPrice) + '; NO wins if BTC closes at or below ' + fmtUsd(beatPrice) + '.'));
          var d = Number.isFinite(Number(market.meta.priceDelta)) ? Number(market.meta.priceDelta) : (p - beatPrice);
          var pct = Number.isFinite(Number(market.meta.priceDeltaPct)) ? Number(market.meta.priceDeltaPct) : (beatPrice > 0 ? (d / beatPrice) * 100 : 0);
          var n = bodyEl.querySelector('[data-bind="btcDelta"]');
          if (n) {
            n.textContent = (d >= 0 ? '▲ +' : '▼ ') + fmtUsd(Math.abs(d)) + '  (' + pct.toFixed(3) + '%)';
            n.style.color = d >= 0 ? '#7ce6a8' : '#ff7c8a';
          }
          var detailEl = bodyEl.querySelector('.ost-modal__detail');
          if (detailEl) {
            detailEl.textContent = 'Price to beat: ' + fmtUsd(market.meta.priceToBeat || market.meta.openPrice) + '. Live BTC ' + fmtUsd(p) + ' is ' + (d >= 0 ? '+' : '-') + fmtUsd(Math.abs(d)) + ' from the beat via ' + String(sourceName || 'BTC feed').toUpperCase() + '. YES wins if close is above the price to beat; NO wins if close is at or below it.';
          }
          function paintNativeBtcQuote() {
            var liveYes = Number(market.yesPriceNumber);
            if (!Number.isFinite(liveYes)) liveYes = yesProb;
            var liveNo = Number(market.noPriceNumber);
            if (!Number.isFinite(liveNo)) liveNo = 1 - liveYes;
            var yEl = bodyEl.querySelector('[data-bind="yesPct"]');
            var nEl2 = bodyEl.querySelector('[data-bind="noPct"]');
            if (yEl) yEl.textContent = (liveYes * 100).toFixed(1) + '%';
            if (nEl2) nEl2.textContent = (liveNo * 100).toFixed(1) + '%';
            if (typeof window.__ostChartRedraw === 'function') {
              try { window.__ostChartRedraw(); } catch (_) {}
            }
            try { if (typeof bodyEl.__renderOstNativeBook === 'function') bodyEl.__renderOstNativeBook(); } catch (_) {}
            try { if (typeof bodyEl.__renderTradesTable === 'function') bodyEl.__renderTradesTable(); } catch (_) {}
            recalcProjected();
            try { if (typeof bodyEl.__refreshSell === 'function') bodyEl.__refreshSell(); } catch (_) {}
          }
          paintNativeBtcQuote();
          var shouldRefreshNative = Number.isFinite(yesProb)
            && !nativeQuoteRefreshInFlight
            && (!lastNativeQuoteFetchAt
              || Date.now() - lastNativeQuoteFetchAt > NATIVE_STATE_REFRESH_MS
              || !Number.isFinite(lastNativeQuoteBase)
              || Math.abs(yesProb - lastNativeQuoteBase) > NATIVE_STATE_BASE_TOLERANCE);
          if (shouldRefreshNative) {
            lastNativeQuoteBase = yesProb;
            lastNativeQuoteFetchAt = Date.now();
            nativeQuoteRefreshInFlight = true;
            refreshNativeMarketState(market, bodyEl, yesProb).then(function () {
              nativeQuoteRefreshInFlight = false;
              paintNativeBtcQuote();
            });
          }
        })
          .catch(function () {
            setText(bodyEl, 'btcLive', 'feed retrying');
          })
          .then(function () {
            btcLiveInFlight = false;
          });
      };
      hydrateCanonicalBtcTicks(market, bodyEl);
      fetchBtcLive();
      // The WebSocket/shared tick event below paints immediately. This
      // fallback stays sub-second without hammering the canonical Worker on
      // mobile when the event stream is already fresh.
      liveTimers.push(setInterval(fetchBtcLive, 650));
      // Re-render immediately on every fresh BTC tick so the live price and
      // share % follow the WebSocket / canonical feed without waiting for
      // the next poll. Throttled to avoid double-painting on bursty ticks.
      var lastSpotPaintAt = 0;
      var spotListener = function () {
        var now = Date.now();
        if (now - lastSpotPaintAt < 60) return;
        lastSpotPaintAt = now;
        try { fetchBtcLive(); } catch (_) {}
      };
      try { window.addEventListener('ost:btc-spot', spotListener); } catch (_) {}
      var marketUpdateListener = function () {
        try { fetchBtcLive(); } catch (_) {}
      };
      try { window.addEventListener('ost:btc-market-updated', marketUpdateListener); } catch (_) {}
      liveTimers.push({ removeOnClose: function () {
        try { window.removeEventListener('ost:btc-spot', spotListener); } catch (_) {}
        try { window.removeEventListener('ost:btc-market-updated', marketUpdateListener); } catch (_) {}
      } });
    }

    // ---- Polymarket live data ----
    if (looksLikePolymarketId(market)) {
      var tokenIds = [];
      var tokenId = '';
      var gammaMarketId = '';
      // CLOB/data endpoints prefer conditionId; Gamma /markets/:id prefers the numeric Gamma id.
      var rawId = '';
      var liveHistoryBySide = { YES: [], NO: [] };
      var LIVE_HISTORY_MAX = 240;

      function syncSelectedOutcomeContext() {
        var selectedContract = getModalTradeContract(market, selectedSide, selectedOutcomeKey);
        tokenIds = (selectedContract && selectedContract.clobTokenIds && selectedContract.clobTokenIds.length)
          ? selectedContract.clobTokenIds.slice()
          : (findPolymarketTokenIds(market, selectedOutcomeKey) || []);
        tokenId = tokenIds[0] || findPolymarketTokenId(market, selectedOutcomeKey) || '';
        gammaMarketId = (selectedContract && selectedContract.gammaMarketId)
          || (market.raw && market.raw.id)
          || market.gammaMarketId
          || market.id;
        rawId = (selectedContract && selectedContract.conditionId)
             || (market.raw && (market.raw.conditionId || market.raw.condition_id))
             || market.conditionId
             || gammaMarketId
             || market.id;
      }
      syncSelectedOutcomeContext();

      function getOutcomeConsensusYes() {
        var selectedContract = getModalTradeContract(market, selectedSide, selectedOutcomeKey);
        if (selectedContract && Number.isFinite(selectedContract.yesPrice)) return Number(selectedContract.yesPrice);
        var op = market.outcomePrices || (market.raw && market.raw.outcomePrices);
        if (typeof op === 'string') { try { op = JSON.parse(op); } catch (_) { op = null; } }
        var first = Array.isArray(op) ? Number(op[0]) : NaN;
        return Number.isFinite(first) && first >= 0 && first <= 1 ? first : NaN;
      }

      function getTokenForChartSide(side) {
        side = side === 'NO' ? 'NO' : 'YES';
        return side === 'NO' ? (tokenIds[1] || tokenIds[0] || tokenId) : (tokenIds[0] || tokenId);
      }

      function pushHistoryPoint(side, price, ts) {
        side = side === 'NO' ? 'NO' : 'YES';
        if (!Number.isFinite(price) || price < 0 || price > 1) return;
        liveHistoryBySide[side].push({ t: Number(ts) || Date.now(), p: price });
        if (liveHistoryBySide[side].length > LIVE_HISTORY_MAX) liveHistoryBySide[side] = liveHistoryBySide[side].slice(-LIVE_HISTORY_MAX);
      }

      function renderLiveHistory() {
        var canvas = bodyEl.querySelector('[data-bind="chart"]');
        if (!canvas) return;
        var side = (typeof bodyEl.__getChartSide === 'function') ? bodyEl.__getChartSide() : 'YES';
        var history = liveHistoryBySide[side] || [];
        var hasDistinctNoToken = !!(tokenIds[1] && tokenIds[1] !== (tokenIds[0] || tokenId));
        if (history.length < 2 && side === 'NO' && !hasDistinctNoToken && liveHistoryBySide.YES.length > 1) {
          history = liveHistoryBySide.YES.map(function (record) { return { t: record.t, p: 1 - Number(record.p) }; });
        }
        var pts = history.map(function (record) { return Number(record.p); }).filter(Number.isFinite);
        if (pts.length < 2) {
          setText(bodyEl, 'chartStatus', 'waiting for ticks…');
          return;
        }
        canvas.style.width = '100%';
        canvas.style.height = '280px';
        var color = side === 'NO' ? '#ff7c8a' : '#6ce6a4';
        // Build per-side overlay of recent OST bets on THIS market.
        // Critical UX rule: only show ticks matching the currently-displayed
        // side, so YES viewers never see NO bets and vice versa.
        var overlay = [];
        try {
          var feed = (window.__ostSharedFeed && window.__ostSharedFeed[market.id]) || [];
          var firstTs = history[0] && history[0].t || (Date.now() - 60000);
          var lastTs  = history[history.length - 1].t || Date.now();
          var span = Math.max(1, lastTs - firstTs);
          feed.forEach(function (b) {
            var bSide = String(b.side || '').toUpperCase();
            if (bSide !== side) return; // hide contrary side
            var bTs = new Date(b.ts).getTime();
            if (!Number.isFinite(bTs) || bTs < firstTs - 5000) return;
            var frac = Math.max(0, Math.min(1, (bTs - firstTs) / span));
            // Plot at the price recorded on the same side axis.
            var px = Number(b.price);
            if (!Number.isFinite(px)) return;
            overlay.push({ frac: frac, value: px, seed: (b.wallet || '') + ':' + bTs, color: color });
          });
        } catch (_) {}
        drawSeries(canvas, pts, color, overlay);
        var status = 'live 1s · ' + side + ' · ' + pts.length + ' pts';
        if (overlay.length) status += ' · ' + overlay.length + ' OST tick' + (overlay.length === 1 ? '' : 's');
        setText(bodyEl, 'chartStatus', status + ' · ' + fmtTime(Date.now()));
      }
      // Expose so toggle button can force a redraw without new ticks.
      window.__ostChartRedraw = renderLiveHistory;

      window.__ostRequestChartHistory = function requestChartHistoryForSide(side) {
        refreshHistory(side === 'NO' ? 'NO' : 'YES');
      };
      bodyEl.__ostRefreshSelectedOutcome = function () {
        liveHistoryBySide = { YES: [], NO: [] };
        syncSelectedOutcomeContext();
        syncActiveContractUi();
        refreshGamma();
        refreshBook();
        refreshTrades();
        refreshHistory('YES');
        refreshSellList();
      };

      // Apply a fresh YES/NO from any source. We track the last accepted
      // source + timestamp so the CLOB feed cannot fight Gamma every second
      // (the old behaviour caused the chart to visibly flip between 47%/53%
      // every tick when the CLOB mid disagreed with the Gamma consensus).
      var lastApply = { src: '', ts: 0, value: NaN };
      var applyYes = function (yesPx, src) {
        if (!Number.isFinite(yesPx) || yesPx < 0 || yesPx > 1) return;
        var now = Date.now();
        // CLOB is treated as a confirmer, not the source of truth.
        // - If Gamma posted within the last 1.5s, skip a CLOB update unless
        //   the CLOB price is within 1.5¢ of Gamma (then it just smooths).
        // - Always accept Gamma updates.
        if (src === 'clob' && lastApply.src === 'gamma' && (now - lastApply.ts) < 1500) {
          if (Math.abs(yesPx - lastApply.value) > 0.015) return;
        }
        // EMA smoothing — 70% old, 30% new — eliminates one-tick spikes
        // when an order book momentarily widens. Skip on first apply.
        var smoothed = yesPx;
        if (Number.isFinite(lastApply.value)) {
          smoothed = 0.7 * lastApply.value + 0.3 * yesPx;
          // For resolved/binary edges (≥0.985 or ≤0.015) snap straight to
          // the source value so winners don't drift.
          if (yesPx >= 0.985 || yesPx <= 0.015) smoothed = yesPx;
        }
        lastApply = { src: src, ts: now, value: smoothed };
        market.yesPriceNumber = smoothed;
        market.noPriceNumber = 1 - smoothed;
        var activeOutcome = getSelectedOutcomeContract(market, selectedOutcomeKey);
        if (activeOutcome && activeOutcome.raw) activeOutcome.raw.price = smoothed;
        pushHistoryPoint('YES', smoothed, now);
        // Only mirror into NO history when no distinct NO token exists; with
        // a real NO token the refreshBook callback feeds NO from its own
        // best-bid and we must not pollute that with `1 − YES`.
        var __noTok = (Array.isArray(tokenIds) && tokenIds[1]) || null;
        var __yesTok = (Array.isArray(tokenIds) && tokenIds[0]) || tokenId;
        if (!__noTok || __noTok === __yesTok) {
          pushHistoryPoint('NO', 1 - smoothed, now);
        }
        var yEl = bodyEl.querySelector('[data-bind="yesPct"]');
        var n2 = bodyEl.querySelector('[data-bind="noPct"]');
        if (yEl) yEl.textContent = (smoothed * 100).toFixed(1) + '% · ' + src;
        if (n2) n2.textContent = ((1 - smoothed) * 100).toFixed(1) + '%';
        var activeOutcomePriceEl = bodyEl.querySelector('.ost-modal__outcome.is-active .ost-modal__outcome-price');
        if (activeOutcomePriceEl) activeOutcomePriceEl.textContent = (smoothed * 100).toFixed(1) + '¢';
        renderLiveHistory();
        recalcProjected();
      };

      var initialConsensusYes = getOutcomeConsensusYes();
      if (Number.isFinite(initialConsensusYes)) applyYes(initialConsensusYes, 'poly');

      // Gamma-api refresh — works even when CLOB CORS blocks. Gives us
      // bestBid/bestAsk/lastTradePrice. Refreshed every 2s.
      var refreshGamma = function () {
        fetchPolyGammaMarket(gammaMarketId).then(function (g) {
          if (!g) return;
          // Prefer the real market consensus (outcomePrices) — falls back
          // to lastTradePrice, then mid of bid/ask. Avoids the "stuck 50%"
          // artefact you get from averaging a wide bid/ask spread.
          var op = g.outcomePrices;
          if (typeof op === 'string') { try { op = JSON.parse(op); } catch (_) { op = null; } }
          var bb = Number(g.bestBid), ba = Number(g.bestAsk), lt = Number(g.lastTradePrice);
          var consensus = (Array.isArray(op) && Number(op[0]) >= 0 && Number(op[0]) <= 1) ? Number(op[0]) : NaN;
          var yesPx = NaN;
          if (Number.isFinite(consensus) && consensus > 0 && consensus < 1) yesPx = consensus;
          else if (Number.isFinite(lt) && lt > 0 && lt < 1) yesPx = lt;
          else if (Number.isFinite(bb) && Number.isFinite(ba) && (ba - bb) < 0.30) yesPx = (bb + ba) / 2;
          else if (Number.isFinite(bb) && bb > 0) yesPx = bb;
          else if (Number.isFinite(ba) && ba < 1) yesPx = ba;
          applyYes(yesPx, 'gamma');
          // Update header tag with live volume.
          if (Number.isFinite(Number(g.volume24hr))) {
            setText(bodyEl, 'tradesStatus', 'gamma · 24h vol $' + Math.round(Number(g.volume24hr)).toLocaleString());
          }
          // If we didn't have clobTokenIds or conditionId, pull them from gamma now
          // and immediately trigger the dependent fetches with the correct IDs.
          if (!tokenId || rawId === market.id) {
            try {
              var t = g.clobTokenIds; if (typeof t === 'string') t = JSON.parse(t);
              if (Array.isArray(t)) {
                tokenIds = t.map(function (item) {
                  if (item && typeof item === 'object') return String(item.tokenId || item.token_id || item.id || item.asset_id || '').trim();
                  return String(item || '').trim();
                }).filter(Boolean);
                if (tokenIds[0]) tokenId = tokenIds[0];
              }
            } catch (_) {}
            if (g.conditionId || g.condition_id) rawId = g.conditionId || g.condition_id;
            if (tokenId) refreshBook();
          }
        });
      };
      refreshGamma();
      // Gamma is the consensus source — poll a bit slower so we don't fight
      // the CLOB book refresh and double-write the same price every tick.
      liveTimers.push(setInterval(refreshGamma, 1500));

      // Order book — refreshed live. Fetch the YES and NO token books separately
      // so the modal does not mistake YES asks for NO bids or average a huge
      // spread back to 50% on thin markets.
      var refreshBook = function () {
        var yesBookToken = tokenIds[0] || tokenId;
        var noBookToken = tokenIds[1] || null;
        if (!yesBookToken) { renderQuoteDepthFallback(bodyEl, market, selectedOutcomeKey, true); return; }
        setText(bodyEl, 'bookStatus', 'fetching…');
        Promise.all([
          fetchPolyOrderbook(yesBookToken),
          noBookToken ? fetchPolyOrderbook(noBookToken) : Promise.resolve(null)
        ]).then(function (books) {
          var yesBook = books[0];
          var noBook = books[1];
          if (!yesBook) { renderQuoteDepthFallback(bodyEl, market, selectedOutcomeKey, false); return; }
          var yesBids = (yesBook.bids || []).slice(0, 8);
          var yesAsks = (yesBook.asks || []).slice(0, 8);
          var noBids = noBook && Array.isArray(noBook.bids)
            ? noBook.bids.slice(0, 8)
            : yesAsks.map(function(row) {
                var px = 1 - Number(row && row.price);
                return Object.assign({}, row, { price: px });
              }).filter(function(row) { return Number.isFinite(Number(row.price)) && Number(row.price) >= 0 && Number(row.price) <= 1; });
          setText(bodyEl, 'bookStatus', 'live · YES ' + yesBids.length + 'b / NO ' + noBids.length + 'b · ' + fmtTime(Date.now()));
          var fmtRow = function (r) {
            var px = Number(r.price), sz = Number(r.size);
            return '<div class="ost-modal__book-row"><span>' + (Number.isFinite(px) ? (px * 100).toFixed(1) + '¢' : '—') + '</span><span>' + (Number.isFinite(sz) ? sz.toFixed(0) : '—') + '</span></div>';
          };
          var yesEl = bodyEl.querySelector('[data-bind="bookYes"]');
          var noEl  = bodyEl.querySelector('[data-bind="bookNo"]');
          if (yesEl) yesEl.innerHTML = yesBids.length ? yesBids.map(fmtRow).join('') : '<div class="ost-modal__book-empty">No YES bids</div>';
          if (noEl)  noEl.innerHTML  = noBids.length ? noBids.map(fmtRow).join('') : '<div class="ost-modal__book-empty">No NO bids</div>';
          // Re-overlay live OST native bids on top of the freshly-painted
          // upstream rows so the depth panel always reflects what other
          // OST users are doing in this exact market.
          try { if (typeof bodyEl.__renderOstNativeBook === 'function') bodyEl.__renderOstNativeBook(); } catch (_) {}

          var bestBid = yesBids[0] && Number(yesBids[0].price);
          var bestAsk = yesAsks[0] && Number(yesAsks[0].price);
          var bestNoBid = noBids[0] && Number(noBids[0].price);
          // When the upstream exposes a distinct NO token, push that book's
          // best bid into the NO history series so the YES/NO toggle shows
          // genuinely independent curves (not just `1 − YES`).
          if (noBookToken && Number.isFinite(bestNoBid) && bestNoBid > 0 && bestNoBid < 1) {
            try { pushHistoryPoint('NO', bestNoBid, Date.now()); } catch (_) {}
          }
          var currentYes = Number(market.yesPriceNumber);
          var consensusYes = getOutcomeConsensusYes();
          var yesPx = NaN;
          if (Number.isFinite(bestBid) && Number.isFinite(bestNoBid)) yesPx = (bestBid + (1 - bestNoBid)) / 2;
          else if (Number.isFinite(bestBid) && Number.isFinite(bestAsk) && bestAsk >= bestBid && (bestAsk - bestBid) <= 0.18) yesPx = (bestBid + bestAsk) / 2;
          else if (!Number.isFinite(currentYes) && Number.isFinite(bestBid)) yesPx = bestBid;
          if (Number.isFinite(yesPx) && yesPx > 0 && yesPx < 1) {
            // CLOB is now strictly a confirmer — only accept when very close
            // to the published consensus AND the current EMA price. The
            // applyYes guard then refuses if Gamma posted in the last 1.5s.
            var agreesWithConsensus = !Number.isFinite(consensusYes) || Math.abs(yesPx - consensusYes) <= 0.03;
            var agreesWithCurrent = !Number.isFinite(currentYes) || Math.abs(yesPx - currentYes) <= 0.05;
            if (agreesWithConsensus && agreesWithCurrent) applyYes(yesPx, 'clob');
          }
        });
      };
      refreshBook();
      liveTimers.push(setInterval(refreshBook, 2500));

      // ---- Live OST native flow → merged into depth + recent ticks ----
      // Reads the same /positions/recent feed as the shared ticker and
      // surfaces it in the order-depth panel and the recent-trades table
      // so users in the same market always see each other's actions.
      function ostFlowForMarket() {
        try {
          var arr = getFlowForMarket(market, selectedOutcomeKey).slice();
          arr.sort(function (a, b) {
            return (new Date(b.ts).getTime() || 0) - (new Date(a.ts).getTime() || 0);
          });
          return arr;
        } catch (_) { return []; }
      }
      function renderOstNativeBook() {
        var yesEl = bodyEl.querySelector('[data-bind="bookYes"]');
        var noEl  = bodyEl.querySelector('[data-bind="bookNo"]');
        if (!yesEl && !noEl) return;
        var flow = ostFlowForMarket();
        if (!flow.length) { renderQuoteDepthFallback(bodyEl, market, selectedOutcomeKey, false); return; }
        // Aggregate OST stake by side at each ¢ bucket so identical-price
        // bets compress into one row (real-book style).
        var yesAgg = {}, noAgg = {};
        flow.forEach(function (b) {
          var isSell = String(b.flowAction || b.tradeAction || b.action || '').toLowerCase() === 'sell' || isClosedFlowRecord(b);
          if (isSell) return;
          var stake = Number(b.stake) || 0;
          var px = Number(b.price);
          if (!stake || !Number.isFinite(px) || px <= 0 || px >= 1) return;
          var bucket = (Math.round(px * 1000) / 10).toFixed(1); // 0.1¢ buckets
          var sideUp = String(b.side || '').toUpperCase();
          var bag = /YES|BUY|UP/.test(sideUp) ? yesAgg : noAgg;
          bag[bucket] = (bag[bucket] || 0) + stake;
        });
        function renderRows(target, bag, emptyLabel) {
          if (!target) return;
          var entries = Object.keys(bag).map(function (k) { return { p: Number(k) / 100, sz: bag[k] }; });
          if (!entries.length) return; // keep upstream rows
          entries.sort(function (a, b) { return b.p - a.p; });
          var existing = target.innerHTML.indexOf('book-empty') >= 0 ? '' : target.innerHTML;
          var ostRows = entries.slice(0, 6).map(function (r) {
            return '<div class="ost-modal__book-row" style="background:rgba(124,230,168,0.07);">' +
              '<span>' + (r.p * 100).toFixed(1) + '¢ · OST</span>' +
              '<span>' + r.sz.toFixed(2) + '</span>' +
            '</div>';
          }).join('');
          target.innerHTML = ostRows + existing;
          // Update status hint so users know native flow is live.
          var statusKey = target === bodyEl.querySelector('[data-bind="bookYes"]') ? 'bookStatus' : null;
          if (statusKey) setText(bodyEl, statusKey, 'live · ' + entries.length + ' OST bid' + (entries.length === 1 ? '' : 's') + ' · ' + fmtTime(Date.now()));
        }
        renderRows(yesEl, yesAgg, 'No YES OST bids');
        renderRows(noEl, noAgg, 'No NO OST bids');
      }
      // Expose so refreshSharedFeed can call it on every poll.
      bodyEl.__renderOstNativeBook = renderOstNativeBook;

      // Trades — refresh every 2s; merge OST native flow on top so users
      // in the same market see each other's bets, not just upstream prints.
      function buildTradeRow(side, color, ts, px, sz, walletShort) {
        var label = walletShort ? (escapeHtml(side) + ' · ' + escapeHtml(walletShort)) : escapeHtml(side || '—');
        return '<tr>' +
          '<td>' + escapeHtml(fmtTime(ts)) + '</td>' +
          '<td style="color:' + color + ';font-weight:700;">' + label + '</td>' +
          '<td>' + (Number.isFinite(px) ? (px * 100).toFixed(1) + '¢' : '—') + '</td>' +
          '<td>' + (Number.isFinite(sz) ? sz.toFixed(2) : '—') + '</td>' +
        '</tr>';
      }
      var lastUpstreamTrades = [];
      function renderTradesTable() {
        var body = bodyEl.querySelector('[data-bind="tradesBody"]');
        if (!body) return;
        var ostRows = ostFlowForMarket().slice(0, 12).map(function (b) {
          var side = String(b.side || '').toUpperCase();
          var isSell = String(b.flowAction || b.tradeAction || b.action || '').toLowerCase() === 'sell' || isClosedFlowRecord(b);
          var color = /YES|BUY|UP/.test(side) ? '#7ce6a8' : '#ff7c8a';
          var ts = new Date(b.ts).getTime() || Date.now();
          var px = Number(b.price);
          var sz = Number(b.stake);
          var ws = b.walletShort || (b.wallet ? String(b.wallet).slice(0, 4) + '…' : 'OST');
          return buildTradeRow((isSell ? 'SELL ' : 'BUY ') + side + ' · OST', color, ts, px, sz, ws);
        });
        var upstreamRows = (lastUpstreamTrades || []).slice(0, 18 - Math.min(ostRows.length, 12)).map(function (t) {
          var side = (t.side || t.outcome || '').toString().toUpperCase();
          var color = /YES|BUY/i.test(side) ? '#7ce6a8' : '#ff7c8a';
          var px = Number(t.price);
          var sz = Number(t.size || t.amount);
          var rawTs = Number(t.timestamp || t.match_time || t.ts);
          var ts = rawTs > 1e12 ? rawTs : rawTs * 1000;
          return buildTradeRow(side, color, ts, px, sz);
        });
        var combined = ostRows.concat(upstreamRows);
        if (!combined.length) {
          renderQuoteTradesFallback(bodyEl, market, selectedOutcomeKey, 'quote - awaiting venue ticks');
          return;
        }
        body.innerHTML = combined.join('');
        var label = ostRows.length
          ? ('live · ' + ostRows.length + ' OST + ' + (lastUpstreamTrades || []).length + ' venue · ' + fmtTime(Date.now()))
          : ('live · ' + (lastUpstreamTrades || []).length + ' · ' + fmtTime(Date.now()));
        setText(bodyEl, 'tradesStatus', label);
      }
      // Expose so refreshSharedFeed can repaint without a fresh upstream fetch.
      bodyEl.__renderTradesTable = renderTradesTable;
      var refreshTrades = function () {
        setText(bodyEl, 'tradesStatus', 'fetching…');
        fetchPolyTrades(rawId).then(function (trades) {
          lastUpstreamTrades = (trades && Array.isArray(trades)) ? trades : [];
          renderTradesTable();
        });
      };
      refreshTrades();
      liveTimers.push(setInterval(refreshTrades, 2000));

      // Price history baseline — refresh every 10s, then maintain 1s live curve.
      var refreshHistory = function (sideToLoad) {
        sideToLoad = sideToLoad === 'NO' ? 'NO' : ((typeof bodyEl.__getChartSide === 'function') ? bodyEl.__getChartSide() : 'YES');
        var yesToken = tokenIds[0] || tokenId;
        var noToken = tokenIds[1] || null;
        var historyTokenId = sideToLoad === 'NO' ? (noToken || yesToken) : yesToken;
        // If the NO token is missing or identical to YES, the upstream history
        // endpoint returns the same series for both — which is exactly what
        // produced the "YES and NO graph look the same" bug. Mirror YES (1−p)
        // instead so users see a proper inverse curve.
        var mustMirror = sideToLoad === 'NO' && (!noToken || noToken === yesToken);
        setText(bodyEl, 'chartStatus', 'fetching…');
        fetchPolyHistory(historyTokenId, rawId).then(function (h) {
          if (!h) { setText(bodyEl, 'chartStatus', 'history unavailable'); return; }
          var seed = (h.history || h.prices || []).map(function (r) {
            return {
              t: Number(r.t || r.time || Date.now()),
              p: mustMirror ? 1 - Number(r.p || r.price) : Number(r.p || r.price)
            };
          }).filter(function (r) { return Number.isFinite(r.p) && r.p >= 0 && r.p <= 1; });
          if (seed.length >= 2) {
            liveHistoryBySide[sideToLoad] = seed.slice(-LIVE_HISTORY_MAX);
            renderLiveHistory();
          } else {
            setText(bodyEl, 'chartStatus', 'no series');
          }
        });
      };
      refreshHistory();
      // Pre-fetch the NO series too so users see distinct YES vs NO data
      // the instant they toggle, instead of seeing a placeholder mirror.
      refreshHistory('NO');
      // Periodically refresh BOTH sides so the NO curve stays as authentic
      // as YES when the upstream exposes a distinct NO token id.
      liveTimers.push(setInterval(function () {
        refreshHistory('YES');
        refreshHistory('NO');
      }, 10000));
      liveTimers.push(setInterval(function () {
        if (Number.isFinite(market.yesPriceNumber) && market.yesPriceNumber > 0 && market.yesPriceNumber < 1) {
          pushHistoryPoint('YES', market.yesPriceNumber, Date.now());
          // Only push the mirrored NO point if there is no distinct NO token
          // (otherwise we pollute the real NO series with a 1−YES inverse
          // and the YES/NO toggle ends up showing identical-looking curves).
          var noToken = tokenIds[1] || null;
          var yesToken = tokenIds[0] || tokenId;
          if (!noToken || noToken === yesToken) {
            pushHistoryPoint('NO', 1 - market.yesPriceNumber, Date.now());
          }
          renderLiveHistory();
        }
      }, 1000));
    } else {
      // ----- OST native (e.g. BTC 5-min) — wire live OST flow into chart, depth, ticks -----
      // Pull the same shared feed Polymarket markets use so users in this
      // market see each other's bets, depth, and a probability curve that
      // actually toggles between YES (UP) and NO (DOWN/SAME).
      function ostFlowForMarket() {
        try {
          var arr = getFlowForMarket(market, selectedOutcomeKey).slice();
          arr.sort(function (a, b) {
            return (new Date(b.ts).getTime() || 0) - (new Date(a.ts).getTime() || 0);
          });
          return arr;
        } catch (_) { return []; }
      }

      // ---- Order depth (YES + NO) from OST stake aggregated by ¢ bucket ----
      function renderOstNativeBook() {
        var yesEl = bodyEl.querySelector('[data-bind="bookYes"]');
        var noEl  = bodyEl.querySelector('[data-bind="bookNo"]');
        if (!yesEl && !noEl) return;
        var flow = ostFlowForMarket();
        var yesAgg = {}, noAgg = {};
        flow.forEach(function (b) {
          var action = String(b.flowAction || b.tradeAction || b.action || '').toLowerCase() === 'sell' || isClosedFlowRecord(b) ? 'sell' : 'buy';
          var stake = Number(b.stake) || 0;
          var sideUp = String(b.side || '').toUpperCase();
          var isYes = /YES|BUY|UP/.test(sideUp);
          // Each bet exposes both yesPrice and noPrice — bucket each side
          // into its own ladder so we get authentic two-sided depth.
          var yesPx = Number(b.yesPrice != null ? b.yesPrice : (isYes ? b.price : (1 - Number(b.price))));
          var noPx  = Number(b.noPrice  != null ? b.noPrice  : (isYes ? (1 - Number(b.price)) : Number(b.price)));
          if (!stake) return;
          if (isYes && Number.isFinite(yesPx) && yesPx > 0 && yesPx < 1) {
            var yk = (Math.round(yesPx * 1000) / 10).toFixed(1);
            yesAgg[yk] = yesAgg[yk] || { buy: 0, sell: 0 };
            yesAgg[yk][action] += stake;
          } else if (!isYes && Number.isFinite(noPx) && noPx > 0 && noPx < 1) {
            var nk = (Math.round(noPx * 1000) / 10).toFixed(1);
            noAgg[nk] = noAgg[nk] || { buy: 0, sell: 0 };
            noAgg[nk][action] += stake;
          }
        });
        function paint(target, bag, color, sideLabel) {
          if (!target) return;
          var entries = Object.keys(bag).map(function (k) {
            var row = bag[k] || { buy: 0, sell: 0 };
            return { p: Number(k) / 100, buy: Number(row.buy) || 0, sell: Number(row.sell) || 0, sz: (Number(row.buy) || 0) + (Number(row.sell) || 0) };
          });
          var state = market && market.marketState;
          if (state) {
            var q = sideLabel === 'YES' ? Number(market.yesPriceNumber) : Number(market.noPriceNumber);
            var stateStake = sideLabel === 'YES' ? Number(state.openYesStake) : Number(state.openNoStake);
            if (Number.isFinite(q) && q > 0 && q < 1 && Number.isFinite(stateStake) && stateStake > 0) entries.unshift({ p: q, buy: stateStake, sell: 0, sz: stateStake, stateRow: true });
          }
          if (!entries.length) {
            target.innerHTML = '<div class="ost-modal__book-row book-empty" style="opacity:0.55;">' +
              '<span>No live ' + sideLabel + ' depth yet</span><span>—</span></div>';
            return;
          }
          entries.sort(function (a, b) { return b.p - a.p; });
          var maxSz = entries.reduce(function (m, r) { return Math.max(m, r.sz); }, 0) || 1;
          target.innerHTML = entries.slice(0, 8).map(function (r) {
            var pct = Math.max(6, Math.min(100, (r.sz / maxSz) * 100));
            return '<div class="ost-modal__book-row" style="position:relative;background:linear-gradient(90deg,' + color + '22 ' + pct + '%, transparent ' + pct + '%);">' +
              '<span style="position:relative;z-index:1;color:' + color + ';font-weight:700;">' + (r.p * 100).toFixed(1) + '¢' + (r.stateRow ? ' · open' : '') + '</span>' +
              '<span style="position:relative;z-index:1;">' + (r.buy ? ('B ' + r.buy.toLocaleString(undefined, { maximumFractionDigits: 2 })) : '') + (r.sell ? (' / S ' + r.sell.toLocaleString(undefined, { maximumFractionDigits: 2 })) : '') + ' OST</span>' +
            '</div>';
          }).join('');
        }
        paint(yesEl, yesAgg, '#7ce6a8', 'YES');
        paint(noEl,  noAgg,  '#ff7c8a', 'NO');
        var totalRows = Object.keys(yesAgg).length + Object.keys(noAgg).length;
        if (!totalRows) { renderQuoteDepthFallback(bodyEl, market, selectedOutcomeKey, true); return; }
        setText(bodyEl, 'bookStatus', 'live · ' + totalRows + ' OST levels · ' + fmtTime(Date.now()));
      }
      bodyEl.__renderOstNativeBook = renderOstNativeBook;

      // ---- Recent ticks (Time / Side / Price / Size / wallet) ----
      function renderTradesTable() {
        var body = bodyEl.querySelector('[data-bind="tradesBody"]');
        if (!body) return;
        var flow = ostFlowForMarket().slice(0, 24);
        if (!flow.length) {
          renderQuoteTradesFallback(bodyEl, market, selectedOutcomeKey, 'quote - awaiting live OST trade');
          return;
        }
        body.innerHTML = flow.map(function (b) {
          var side = String(b.side || '').toUpperCase();
          var isSell = String(b.flowAction || b.tradeAction || b.action || '').toLowerCase() === 'sell' || isClosedFlowRecord(b);
          var color = /YES|BUY|UP/.test(side) ? '#7ce6a8' : '#ff7c8a';
          var ts = new Date(b.ts).getTime() || Date.now();
          var px = Number(b.price);
          var sz = Number(b.stake);
          var ws = b.walletShort || (b.wallet ? String(b.wallet).slice(0, 4) + '…' + String(b.wallet).slice(-4) : 'OST');
          var sideLabel = (isSell ? 'SELL ' : 'BUY ') + (side || '—') + ' · ' + escapeHtml(ws);
          return '<tr>' +
            '<td>' + escapeHtml(fmtTime(ts)) + '</td>' +
            '<td style="color:' + color + ';font-weight:700;">' + sideLabel + '</td>' +
            '<td>' + (Number.isFinite(px) ? (px * 100).toFixed(1) + '¢' : '—') + '</td>' +
            '<td>' + (Number.isFinite(sz) ? sz.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—') + '</td>' +
          '</tr>';
        }).join('');
        // Distinct trader count for engagement signal.
        var wallets = {};
        flow.forEach(function (b) { if (b.wallet) wallets[b.wallet] = 1; });
        var n = Object.keys(wallets).length;
        setText(bodyEl, 'tradesStatus', 'live · ' + flow.length + ' trades · ' + n + ' trader' + (n === 1 ? '' : 's') + ' · ' + fmtTime(Date.now()));
      }
      bodyEl.__renderTradesTable = renderTradesTable;

      // ---- Probability chart (YES / NO) drawn from OST flow + BTC rounds ----
      var canvas = bodyEl.querySelector('[data-bind="chart"]');
      if (canvas) { canvas.style.width = '100%'; canvas.style.height = '220px'; }
      function drawProbabilityChart(side) {
        if (!canvas) return;
        var flow = ostFlowForMarket().slice(0, 60).slice().reverse(); // chronological
        var pts = flow.map(function (b) {
          var yp = Number(b.yesPrice != null ? b.yesPrice : (/YES|BUY|UP/.test(String(b.side).toUpperCase()) ? b.price : (1 - Number(b.price))));
          if (!Number.isFinite(yp)) return null;
          return Math.max(0, Math.min(1, yp));
        }).filter(function (v) { return v != null; });
        var isBtc5m = market.isOstNative && market.meta && market.meta.kind === 'btc5m';
        if (isBtc5m) {
          var sharedRound = cachedCanonicalBtcRound();
          if (canonicalRoundMatchesMarket(market, sharedRound)) applyCanonicalBtcRoundToMarket(market, sharedRound);
          if (!market.meta.openPrice) {
            var storedRound = (readJson(ROUND_KEY, {})[String(market.meta.openAt)] || {});
            if (Number(storedRound.openPrice) > 0) market.meta.openPrice = Number(storedRound.openPrice);
          }
          market.meta.priceToBeat = Number(market.meta.priceToBeat || market.meta.openPrice || 0);
          var openPx = Number(market.meta.priceToBeat || market.meta.openPrice) || (sharedRound && Number(sharedRound.priceToBeat || sharedRound.openPrice)) || 0;
          var closeAt = Number(market.meta.closeAt || (sharedRound && sharedRound.closeAt) || Date.now());
          var btcPts = [];
          try {
            var rawSeries = window.OST_PREDICTION_API && typeof window.OST_PREDICTION_API.btcSeries === 'function'
              ? window.OST_PREDICTION_API.btcSeries()
              : [];
            var sharedTicks = cachedBtcTicksForRound(market.meta.openAt);
            if (sharedTicks.length >= 2) rawSeries = sharedTicks;
            rawSeries.slice(-160).forEach(function (point) {
              var pp = Number(point && (point.price != null ? point.price : point.p));
              if (!Number.isFinite(pp) || pp <= 1000 || openPx <= 0) return;
              var dPct = ((pp - openPx) / openPx) * 100;
              var ms = Math.max(0, closeAt - (Number(point && (point.ts || point.t)) || Date.now()));
              var rem = Math.max(0.04, ms / FIVE_MIN_MS);
              // Match the worker / pro equation so the historical chart
              // line agrees with the live YES/NO percentage rendered above.
              var scale = 0.10 * Math.sqrt(rem);
              var z = Math.max(-8, Math.min(8, dPct / Math.max(scale, 0.001)));
              var yes = 1 / (1 + Math.exp(-z));
              var elapsed = 1 - rem;
              yes = 0.5 + (yes - 0.5) * (0.65 + 0.32 * elapsed);
              btcPts.push(Math.max(0.02, Math.min(0.98, yes)));
            });
            var liveYes = Number(sharedRound && sharedRound.yesPriceNumber);
            if (Number.isFinite(liveYes) && liveYes > 0 && liveYes < 1) btcPts.push(Math.max(0.02, Math.min(0.98, liveYes)));
            var stateYes = Number(market && market.marketState && market.marketState.yesPriceNumber);
            if (Number.isFinite(stateYes) && stateYes > 0 && stateYes < 1) btcPts.push(Math.max(0.02, Math.min(0.98, stateYes)));
          } catch (_) {}
          if (btcPts.length >= 2) pts = btcPts;
        }
        // Append the rolling consensus from BTC rounds as a probability proxy
        // so we always have something to draw before the first OST bet lands.
        if (pts.length < 2) {
          var rounds = readJson(ROUND_KEY, {});
          var rk = Object.keys(rounds).sort();
          rk.forEach(function (k) {
            var r = rounds[k];
            var op = Number(r.openPrice), cp = Number(r.closePrice);
            if (Number.isFinite(op) && Number.isFinite(cp) && op > 0) {
              // Simple drift → squashed probability YES (UP) finished.
              var drift = (cp - op) / op;
              var p = 1 / (1 + Math.exp(-drift * 800));
              pts.push(Math.max(0.02, Math.min(0.98, p)));
            }
          });
        }
        if (pts.length < 2) {
          var quote = getMarketQuotePrices(market, selectedOutcomeKey);
          var liveYesQuote = Number(quote.yes);
          if (!Number.isFinite(liveYesQuote)) liveYesQuote = 0.5;
          pts = [liveYesQuote, liveYesQuote];
        }
        var series = side === 'NO' ? pts.map(function (p) { return 1 - p; }) : pts;
        // Pad with invisible 0 and 1 anchors so drawSeries shows the
        // full probability range and YES/NO look genuinely different.
        var padded = [0].concat(series).concat([1]);
        var color = side === 'NO' ? '#ff7c8a' : '#7ce6a8';
        // Cheat: draw twice — invisible padded for scale, visible series on top.
        var ctx = canvas.getContext('2d');
        var dpr = window.devicePixelRatio || 1;
        var w = canvas.clientWidth || 600, h = canvas.clientHeight || 220;
        canvas.width = Math.floor(w * dpr); canvas.height = Math.floor(h * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);
        // Y grid + 50% midline
        ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 1;
        for (var i = 1; i < 4; i++) {
          var yy = (i / 4) * h;
          ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(w, yy); ctx.stroke();
        }
        ctx.strokeStyle = 'rgba(255,255,255,0.18)';
        ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke();
        ctx.setLineDash([]);
        // Filled area (locked Y axis 0..1)
        var grad = ctx.createLinearGradient(0, 0, 0, h);
        grad.addColorStop(0, color + '55'); grad.addColorStop(1, color + '00');
        ctx.fillStyle = grad;
        ctx.beginPath();
        series.forEach(function (p, idx) {
          var x = (idx / (series.length - 1)) * w;
          var py = h - p * (h - 8) - 4;
          if (idx === 0) ctx.moveTo(x, py); else ctx.lineTo(x, py);
        });
        ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = color; ctx.lineWidth = 2;
        ctx.beginPath();
        series.forEach(function (p, idx) {
          var x = (idx / (series.length - 1)) * w;
          var py = h - p * (h - 8) - 4;
          if (idx === 0) ctx.moveTo(x, py); else ctx.lineTo(x, py);
        });
        ctx.stroke();
        // Last-tick dot
        var last = series[series.length - 1];
        var lx = w - 4, ly = h - last * (h - 8) - 4;
        ctx.fillStyle = color;
        ctx.beginPath(); ctx.arc(lx, ly, 4, 0, Math.PI * 2); ctx.fill();
        // Labels: 100¢ and 0¢
        ctx.fillStyle = 'rgba(255,255,255,0.45)';
        ctx.font = '10px ui-sans-serif, system-ui';
        ctx.textAlign = 'left';
        ctx.fillText('100¢', 4, 12);
        ctx.fillText('0¢', 4, h - 4);
        ctx.textAlign = 'right';
        ctx.fillText((last * 100).toFixed(1) + '¢ ' + side, w - 6, ly - 8);
        var label = padded.length;
        setText(bodyEl, 'chartStatus', 'live · ' + side + ' · ' + (series.length) + ' ticks · ' + fmtTime(Date.now()));
      }
      var chartSideLocal = (typeof bodyEl.__getChartSide === 'function') ? bodyEl.__getChartSide() : 'YES';
      window.__ostChartRedraw = function () { drawProbabilityChart((typeof bodyEl.__getChartSide === 'function') ? bodyEl.__getChartSide() : chartSideLocal); };
      window.__ostRequestChartHistory = function (side) { chartSideLocal = side; drawProbabilityChart(side); };

      // First paint immediately (some ticks already in the shared bag).
      try { renderOstNativeBook(); } catch (_) {}
      try { renderTradesTable(); } catch (_) {}
      try { drawProbabilityChart(chartSideLocal); } catch (_) {}
      // Repaint chart on a slow tick too so the timestamps stay fresh.
      liveTimers.push(setInterval(function () { try { drawProbabilityChart((typeof bodyEl.__getChartSide === 'function') ? bodyEl.__getChartSide() : chartSideLocal); } catch (_) {} }, 2000));
    }
  }

  // --------------------------------------------------------------------------
  // Auto-wire: ANY click on a market card opens the modal.
  // We use a single delegated capture-phase listener so it works for cards
  // inserted later by app.js's renderer.
  // --------------------------------------------------------------------------
  function onCardClick(ev) {
    // Skip when the modal is already open (otherwise our internal trade-desk
    // selector .click() would re-trigger us and we'd loop).
    var existing = document.getElementById(MODAL_ID);
    if (existing && existing.classList.contains('is-open')) return;
    // Don't hijack links or quick-trade controls inside the wallet venue.
    var explicitOpen = ev.target.closest('[data-prediction-open-modal]');
    var ignore = ev.target.closest('a[href], button, input, select, textarea, [role="button"], .prediction-market-link, .prediction-market-api-link, .prediction-market-quick-btn, [data-prediction-quick-side], [data-prediction-show-more], [data-prediction-show-less], [data-cashout-idx], .prediction-cashout-btn, [data-ost-bet-claim], [data-ost-bet-open], .ost-pred-btn, .ost-bet-row__actions, [data-tt-open], .ost-tt-close');
    var card = ev.target.closest('.prediction-market-card[data-prediction-market-id]');
    if (!card) return;
    if (ignore && !explicitOpen) return;
    ev.preventDefault();
    ev.stopPropagation();
    var id = card.getAttribute('data-prediction-market-id') || '';
    var nativeLiveId = (window.OST_NATIVE_MARKET_IDS && window.OST_NATIVE_MARKET_IDS.eplLeedsBurnley) || 'native-polymarket-epl-lee-bur-2026-05-01';
    if (id === nativeLiveId && window.OSTLiveWatch && typeof window.OSTLiveWatch.open === 'function') {
      window.OSTLiveWatch.open('leeds-burnley', 'Leeds United vs Burnley', { focusTrade: !!explicitOpen });
      return;
    }
    open(id);
  }
  document.addEventListener('click', onCardClick, true);

  // Public API
  window.OST_MARKET_MODAL = {
    open: open,
    close: closeModal
  };

  // Replace the older detail modal trigger (prediction-pro.js) so we don't
  // open two competing dialogs. The old script's `injectDetailButtons` sets
  // text "📊 Details" — when found, intercept its click.
  document.addEventListener('click', function (ev) {
    var t = ev.target.closest('.ost-prodetail-trigger');
    if (!t) return;
    ev.preventDefault();
    ev.stopPropagation();
    ev.stopImmediatePropagation();
    var card = t.closest('[data-prediction-market-id]');
    if (card) open(card.getAttribute('data-prediction-market-id'));
  }, true);
})();

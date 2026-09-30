/* ==========================================================================
 * OST · Parlay 2.0 — combos across EVERY prediction market
 * --------------------------------------------------------------------------
 * v1 was a dock limited to the 5-minute coins. v2 makes parlays a property
 * of the whole board:
 *
 *  · Every binary market card grows an "➕ YES/NO to parlay" chip row
 *    (injected via MutationObserver, market data from __predictionState).
 *  · Legs: fast 5-min rounds (BTC/ETH/SOL) AND any Polymarket/Kalshi/OST
 *    market. Odds multiply: payout = stake × Π(1/entryPrice).
 *  · LIVE repricing: open slips are marked to market every few seconds —
 *    fair value = potential payout × Π(current win probability per leg)
 *    — and can be SOLD any time at fair value minus a 6% spread, exactly
 *    how sportsbook cash-out works. Odds move → value moves → payout
 *    stays aligned with probability.
 *  · Settlement without human hands: fast legs settle on Binance 5-min
 *    candles; venue legs settle when their market resolves (price pinned
 *    ≥98.5¢ / ≤1.5¢ after close); markets that vanish unresolved for 2h
 *    after close are VOIDED and the multiplier collapses (industry rule).
 *  · Every slip is mirrored into ost.prediction.orders.v1, so parlays
 *    appear in the wallet's market history/ledger alongside single bets.
 *
 * Money flows through the canonical pool (window.OST_MONEY). Tickets live
 * in ost.parlays.v1 (schema v2).
 * ========================================================================== */
(function () {
  'use strict';

  var FIVE_MIN = 5 * 60 * 1000;
  var SLIPS_KEY = 'ost.parlays.v1';
  var ORDERS_KEY = 'ost.prediction.orders.v1';
  var MIN_LEGS = 2, MAX_LEGS = 6;
  var MIN_STAKE = 1, MAX_STAKE = 500;
  var MAX_MULT = 500;
  var CASHOUT_SPREAD = 0.06;
  var VOID_AFTER_MS = 2 * 3600 * 1000;

  var FAST_COINS = {
    btc: { symbol: 'BTCUSDT', label: 'BTC', emoji: '₿' },
    eth: { symbol: 'ETHUSDT', label: 'ETH', emoji: 'Ξ' },
    sol: { symbol: 'SOLUSDT', label: 'SOL', emoji: '◎' }
  };

  // ------------------------------------------------------------- helpers
  function clampP(p) { var n = Number(p); if (!Number.isFinite(n)) n = 0.5; if (n > 1) n = n / 100; return Math.max(0.005, Math.min(0.995, n)); }
  var API = String(window.OST_API_BASE || 'https://ost-api.nachogtavl.workers.dev').replace(/\/+$/, '');
  function widgetsLive() { try { document.body.classList.add('ost-widgets-live'); } catch (_) {} }

  function boundaries(now) {
    var t = now || Date.now();
    var openAt = Math.floor(t / FIVE_MIN) * FIVE_MIN;
    return { openAt: openAt, closeAt: openAt + FIVE_MIN };
  }

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

  function fetchKline(symbol, openAt) {
    var q = '?symbol=' + symbol + '&interval=5m&limit=1&startTime=' + openAt;
    var urls = [
      'https://api.binance.com/api/v3/klines' + q,
      'https://data-api.binance.vision/api/v3/klines' + q
    ];
    var i = 0;
    function next() {
      if (i >= urls.length) return Promise.resolve(null);
      return fetchJson(urls[i++], 4000).then(function (rows) {
        var row = Array.isArray(rows) && Array.isArray(rows[0]) ? rows[0] : null;
        if (!row || Number(row[0]) !== openAt) return next();
        return { open: Number(row[1]), close: Number(row[4]) };
      }).catch(next);
    }
    return next();
  }

  function marketLists() {
    var lists = [];
    try { var st = window.__predictionState; if (st && Array.isArray(st.markets)) lists.push(st.markets); } catch (_) {}
    try { if (Array.isArray(window.__ostPredictionMarkets)) lists.push(window.__ostPredictionMarkets); } catch (_) {}
    try { if (typeof window.buildOstNativeMarkets === 'function') lists.push(window.buildOstNativeMarkets() || []); } catch (_) {}
    return lists;
  }
  // The legacy board list (__predictionState) is only one source now: the market
  // page renders from __ostPredictionMarkets, and a ladder leg is its own market.
  function marketById(id) {
    id = String(id);
    var lists = marketLists(), i, j, m;
    for (i = 0; i < lists.length; i++) for (j = 0; j < lists[i].length; j++) { m = lists[i][j]; if (m && String(m.id) === id) return m; }
    for (i = 0; i < lists.length; i++) for (j = 0; j < lists[i].length; j++) {
      m = lists[i][j]; if (!m || !m.isGrouped || !Array.isArray(m.outcomes)) continue;
      for (var k = 0; k < m.outcomes.length; k++) {
        var o = m.outcomes[k];
        if (o && String(o.marketId || o.key || '') === id) return { id: id, title: String(m.title || '') + ' · ' + String(o.label || ''), yesPriceNumber: Number(o.price), closeAtMs: Number(m.closeAtMs || 0), source: m.source || 'polymarket', isLeg: true, parentId: String(m.id) };
      }
    }
    return null;
  }

  function fastYesOdds(coinKey) {
    try {
      if (coinKey === 'btc' && window.OST_PREDICTION_API && typeof window.OST_PREDICTION_API.fiveMinRound === 'function') {
        var rec = window.OST_PREDICTION_API.fiveMinRound() || {};
        if (Number.isFinite(Number(rec.yesPriceNumber))) return clampP(rec.yesPriceNumber);
      }
      if (window.OST_FAST_MARKETS) {
        var live = window.OST_FAST_MARKETS.state(coinKey + '5m');
        if (live) {
          var mk = marketFromFast(coinKey);
          if (mk) return clampP(mk.yesPriceNumber);
        }
      }
    } catch (_) {}
    return 0.5;
  }

  function marketFromFast(coinKey) {
    try {
      var arr = (typeof window.buildOstNativeMarkets === 'function' && window.buildOstNativeMarkets()) || [];
      return arr.find(function (m) { return m && String(m.id || '').indexOf('ost-' + coinKey + '5m-') === 0; }) || null;
    } catch (_) { return null; }
  }

  // Current probability that a leg wins, at this moment.
  function legLiveProb(leg) {
    if (leg.status === 'won') return 1;
    if (leg.status === 'lost') return 0;
    if (leg.status === 'void') return 1; // void legs collapse out of the product elsewhere
    if (leg.kind === 'fast') {
      var yes = fastYesOdds(leg.coin);
      return leg.side === 'up' ? yes : 1 - yes;
    }
    var m = marketById(leg.marketId);
    if (m && Number.isFinite(Number(m.yesPriceNumber))) {
      var y = clampP(m.yesPriceNumber);
      return leg.side === 'yes' ? y : 1 - y;
    }
    // market no longer in feed — assume entry price (no information)
    return clampP(leg.entryPrice);
  }

  // ------------------------------------------------------------- slip math
  // Parlay odds are shown at FAIR value. The house edge is taken as OST_HOUSE's
  // visible cut of the PROFIT at the moment a slip is won or cashed out (see
  // settleScan + sellSlip), so the displayed multiplier is honest and the fee
  // is charged live on realisation — never a hidden vig baked into the odds.
  function slipPayout(slip) {
    var mult = 1;
    slip.legs.forEach(function (l) {
      if (l.status === 'void') return;
      mult *= 1 / clampP(l.entryPrice);
    });
    mult = Math.min(mult, MAX_MULT);
    return slip.stake * mult;
  }

  function slipLiveValue(slip) {
    var payout = slipPayout(slip);
    var prob = 1;
    for (var i = 0; i < slip.legs.length; i++) {
      var l = slip.legs[i];
      if (l.status === 'lost') return 0;
      if (l.status === 'void') continue;
      prob *= legLiveProb(l);
    }
    return payout * prob;
  }

  // The cash-out offer shown to the user is already NET of the house edge on
  // profit, so what they see is exactly what they receive.
  function cashoutOffer(slip) {
    var live = slipLiveValue(slip);
    if (window.OST_HOUSE && typeof window.OST_HOUSE.quote === 'function') {
      return window.OST_HOUSE.quote(live, Number(slip.stake) || 0).net;
    }
    return live * (1 - CASHOUT_SPREAD);
  }

  // ------------------------------------------------------------- stores
  function readSlips() {
    try { return JSON.parse(localStorage.getItem(SLIPS_KEY) || '[]') || []; } catch (_) { return []; }
  }
  function writeSlips(arr) {
    try { localStorage.setItem(SLIPS_KEY, JSON.stringify(arr.slice(-120))); } catch (_) {}
  }

  function readOrders() {
    try { return JSON.parse(localStorage.getItem(ORDERS_KEY) || '[]') || []; } catch (_) { return []; }
  }
  function writeOrders(arr) {
    try { localStorage.setItem(ORDERS_KEY, JSON.stringify(arr.slice(0, 500))); } catch (_) {}
  }

  function legShort(l) {
    if (l.kind === 'fast') return FAST_COINS[l.coin].label + (l.side === 'up' ? '↑' : '↓');
    var t = String(l.title || l.marketId).slice(0, 26);
    return t + (t.length < String(l.title || '').length ? '…' : '') + ' ' + l.side.toUpperCase();
  }

  function slipTitle(slip) {
    var mult = slipPayout(slip) / slip.stake;
    return '⚡ Parlay ×' + mult.toFixed(2) + ': ' + slip.legs.map(legShort).join(' + ');
  }

  // Mirror into the prediction ledger so parlays live in wallet history.
  function ledgerUpsert(slip) {
    var orders = readOrders();
    var id = 'ost-parlay:' + slip.id;
    var idx = orders.findIndex(function (o) { return o && o.marketId === id; });
    var payout = slipPayout(slip);
    var rec = {
      marketId: id,
      signature: 'parlay-' + slip.id, sig: 'parlay-' + slip.id, id: 'parlay-' + slip.id,
      wallet: 'credits', fundedBy: 'credits', kind: 'parlay',
      title: slipTitle(slip),
      source: 'ost-parlay',
      side: 'yes',
      topic: 'parlay',
      price: Math.min(0.97, slip.stake / payout),
      yesPrice: Math.min(0.97, slip.stake / payout),
      stake: slip.stake,
      shares: payout,
      potentialReturn: payout,
      closeAtMs: slip.legs.reduce(function (mx, l) { return Math.max(mx, l.closeAtMs || 0); }, 0),
      ts: slip.placedAt,
      createdAt: slip.placedAt,
      status: slip.status === 'won' ? 'won' : slip.status === 'cashed' ? 'sold' : slip.status === 'lost' ? 'lost' : 'open',
      resolved: slip.status !== 'open'
    };
    if (slip.status === 'won') {
      rec.cashedOut = true; rec.cashoutOst = Number(slip.paidOut != null ? slip.paidOut : payout) || 0; rec.cashoutKind = 'parlay-credit'; rec.cashoutAt = slip.settledAt || Date.now();
    } else if (slip.status === 'cashed') {
      rec.cashedOut = true; rec.cashoutOst = slip.cashoutOst || 0; rec.cashoutKind = 'parlay-cashout'; rec.cashoutAt = slip.settledAt || Date.now();
    }
    if (idx >= 0) orders[idx] = Object.assign({}, orders[idx], rec);
    else orders.unshift(rec);   // app.js keeps newest-first and trims the tail
    writeOrders(orders);
    try { window.dispatchEvent(new CustomEvent('ost:prediction:order-changed')); } catch (_) {}
  }

  // ------------------------------------------------------------- builder state
  var draft = [];        // legs being assembled
  var stake = 10;
  var dockEl = null;
  var collapsed = true;

  function draftMult() {
    var m = 1;
    draft.forEach(function (l) { m *= 1 / clampP(l.entryPrice); });
    return Math.min(m, MAX_MULT);
  }

  function addLeg(leg) {
    if (draft.length >= MAX_LEGS) { toastMini('Max ' + MAX_LEGS + ' legs'); return false; }
    var key = leg.kind === 'fast' ? 'fast:' + leg.coin : 'venue:' + leg.marketId;
    var existing = draft.findIndex(function (l) {
      return (l.kind === 'fast' ? 'fast:' + l.coin : 'venue:' + l.marketId) === key;
    });
    if (existing >= 0) {
      var same = draft[existing].side === leg.side;
      draft.splice(existing, 1);
      if (same) { renderDock(); syncCardChips(); return false; } // toggle off
    }
    if (leg.closeAtMs && leg.closeAtMs - Date.now() < 60000) { toastMini('Closes too soon for a parlay leg'); return false; }
    draft.push(leg);
    widgetsLive();
    if (collapsed) setCollapsed(false);
    renderDock();
    syncCardChips();
    return true;
  }

  function addFastLeg(coin, side) {
    var yes = fastYesOdds(coin);
    var b = boundaries();
    return addLeg({
      kind: 'fast', coin: coin, side: side,
      entryPrice: clampP(side === 'up' ? yes : 1 - yes),
      closeAtMs: b.closeAt, openAt: b.openAt,
      title: FAST_COINS[coin].label + ' 5-min ' + side.toUpperCase()
    });
  }

  function addVenueLeg(marketId, side) {
    var m = marketById(marketId);
    if (m && m.isGrouped) {
      // A ladder is an event, not a bet: the leg is the outcome the user picked on the page.
      var pick = null; try { pick = window.OST_MARKET_CHART && OST_MARKET_CHART.selection(marketId); } catch (_) {}
      if (pick && pick.legId) { marketId = String(pick.legId); m = marketById(marketId) || { id: marketId, title: String(m.title || '') + ' · ' + pick.label, yesPriceNumber: Number(pick.legPrice), closeAtMs: Number(m.closeAtMs || 0), source: m.source }; }
      else { toastMini('Pick an outcome first'); return false; }
    }
    if (!m) { toastMini('Market not loaded yet'); return false; }
    var yes = clampP(m.yesPriceNumber);
    var p = side === 'yes' ? yes : 1 - yes;
    // Extreme odds ARE allowed now (longshot 1c legs => big multipliers,
    // heavy-favorite 99c legs => safe ballast). Only a literal 0/100 with no
    // market is rejected. MAX_MULT still caps the runaway payout.
    // Fast native cards route to the fast engine instead
    var fm = /^ost-(btc|eth|sol)5m-/.exec(String(marketId));
    if (fm) return addFastLeg(fm[1], side === 'yes' ? 'up' : 'down');
    return addLeg({
      kind: 'venue', marketId: marketId, side: side,
      entryPrice: clampP(p),
      closeAtMs: Number(m.closeAtMs || 0),
      title: String(m.title || marketId),
      source: m.source || ''
    });
  }

  // ------------------------------------------------------------- card chips
  function chipHtmlFor(id) {
    var m = marketById(id), legId = id;
    if (m && m.isGrouped) { try { var pk = window.OST_MARKET_CHART && OST_MARKET_CHART.selection(id); if (pk && pk.legId) legId = String(pk.legId); } catch (_) {} }
    var inYes = draft.some(function (l) { return l.kind === 'venue' && l.marketId === legId && l.side === 'yes'; });
    var inNo = draft.some(function (l) { return l.kind === 'venue' && l.marketId === legId && l.side === 'no'; });
    var fm = /^ost-(btc|eth|sol)5m-/.exec(String(id));
    if (fm) {
      inYes = draft.some(function (l) { return l.kind === 'fast' && l.coin === fm[1] && l.side === 'up'; });
      inNo = draft.some(function (l) { return l.kind === 'fast' && l.coin === fm[1] && l.side === 'down'; });
    }
    return '<span class="oplc-label">⚡ Parlay</span>' +
      '<button type="button" class="oplc-btn oplc-yes' + (inYes ? ' is-on' : '') + '" data-parlay-add="yes">YES</button>' +
      '<button type="button" class="oplc-btn oplc-no' + (inNo ? ' is-on' : '') + '" data-parlay-add="no">NO</button>' +
      '<span class="oplc-hint">' + (draft.length ? draft.length + ' leg' + (draft.length === 1 ? '' : 's') + ' · ×' + draftMult().toFixed(2) : 'combine markets, odds multiply') + '</span>';
  }

  function enhanceCard(card) {
    var id = card.getAttribute('data-prediction-market-id');
    if (!id) return;
    var row = card.querySelector('.oplc-row');
    if (!row) {
      row = document.createElement('div');
      row.className = 'oplc-row';
      row.setAttribute('data-parlay-market', id);
      card.appendChild(row);
    }
    row.innerHTML = chipHtmlFor(id);
  }

  function syncCardChips() {
    document.querySelectorAll('.oplc-row').forEach(function (row) {
      var id = row.getAttribute('data-parlay-market');
      if (id) row.innerHTML = chipHtmlFor(id);
    });
  }

  // The market page (ost-predict-mobile.js) is where people actually trade now; the
  // legacy board's cards are hidden under it. Give the page its own Parlay row.
  function enhanceDetail() {
    var det = document.getElementById('opmDetail'); if (!det) return;
    var id = det.getAttribute('data-mid'); var yn = document.getElementById('opmYn');
    if (!id || !yn) return;   // 5-min coin pages get chips too: addVenueLeg routes ost-*5m ids to fast legs
    var row = det.querySelector('.oplc-row');
    if (!row) { row = document.createElement('div'); row.className = 'oplc-row oplc-page'; yn.parentNode.insertBefore(row, yn.nextSibling); }
    row.setAttribute('data-parlay-market', id);
    row.innerHTML = chipHtmlFor(id);
  }
  function observeCards() {
    var scan = function () {
      document.querySelectorAll('#predictionMarketList [data-prediction-market-id]').forEach(enhanceCard);
    };
    scan();
    var mo = new MutationObserver(function () { scan(); });
    var list = document.getElementById('predictionMarketList');
    if (list) mo.observe(list, { childList: true, subtree: false });
    // board re-renders replace the list node's children only, observer holds
    var det = document.getElementById('opmDetail');
    if (det) { new MutationObserver(function () { setTimeout(enhanceDetail, 0); }).observe(det, { childList: true }); setTimeout(enhanceDetail, 0); }
    window.addEventListener('ost:predict:outcome', function () { syncCardChips(); });

    document.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-parlay-add]');
      if (!btn) return;
      var row = btn.closest('.oplc-row');
      if (!row) return;
      e.preventDefault();
      e.stopPropagation();
      addVenueLeg(row.getAttribute('data-parlay-market'), btn.getAttribute('data-parlay-add'));
    }, true);
  }

  // ------------------------------------------------------------- styles
  function injectStyles() {
    if (document.getElementById('ostParlayStyle')) return;
    var st = document.createElement('style');
    st.id = 'ostParlayStyle';
    st.textContent =
      '.oplc-row{display:flex;align-items:center;gap:6px;margin-top:9px;padding-top:8px;border-top:1px dashed rgba(255,255,255,0.08);}' +
      '.oplc-row.oplc-page{margin:-4px 0 12px;padding:8px 10px;border:1px solid rgba(245,196,104,0.22);border-top:1px solid rgba(245,196,104,0.22);border-radius:12px;background:rgba(245,196,104,0.05);}' +
      '.oplc-row.oplc-page .oplc-btn{min-height:0!important;padding:5px 12px!important;font-size:11px!important;border-radius:8px!important;}' +
      '.oplc-row.oplc-page .oplc-hint{margin-left:auto;font-size:10px;color:#64748b;}' +
      '.oplc-label{font-size:10px;font-weight:800;color:#f5c468;letter-spacing:.05em;}' +
      '.oplc-btn{border:1px solid rgba(255,255,255,0.14);background:transparent;color:#94a3b8;border-radius:7px;padding:3px 10px;font-size:10px;font-weight:800;cursor:pointer;}' +
      '.oplc-btn.oplc-yes.is-on{background:rgba(52,211,153,0.22);border-color:#34d399;color:#7ce6a8;}' +
      '.oplc-btn.oplc-no.is-on{background:rgba(255,124,138,0.2);border-color:#ff7c8a;color:#ff9aa5;}' +
      '#ostParlayDock{position:fixed;right:14px;bottom:14px;z-index:9990;width:320px;max-width:calc(100vw - 20px);' +
      'background:linear-gradient(165deg,#101527,#0a0e1c);border:1px solid rgba(109,159,255,0.35);border-radius:16px;' +
      'box-shadow:0 12px 44px rgba(0,0,0,0.55);color:#e2e8f0;font-size:13px;overflow:hidden;}' +
      '#ostParlayDock.is-collapsed{width:auto;border-radius:999px;}' +
      '.opl-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 14px;cursor:pointer;background:rgba(109,159,255,0.10);}' +
      '.opl-head-title{font-weight:800;display:flex;align-items:center;gap:7px;}' +
      '.opl-badge{background:#f5c468;color:#151515;border-radius:999px;padding:1px 8px;font-size:11px;font-weight:800;}' +
      '.opl-body{padding:12px 14px;display:flex;flex-direction:column;gap:10px;max-height:min(66vh,540px);overflow-y:auto;}' +
      '.opl-coins{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;}' +
      '.opl-coin{border:1px solid rgba(255,255,255,0.10);border-radius:12px;padding:7px 6px;text-align:center;background:rgba(255,255,255,0.03);}' +
      '.opl-coin-name{font-weight:800;font-size:11px;margin-bottom:5px;color:#bfdbfe;}' +
      '.opl-side{display:flex;gap:4px;justify-content:center;}' +
      '.opl-side button{flex:1;border:1px solid rgba(255,255,255,0.12);background:transparent;color:#94a3b8;border-radius:8px;padding:4px 0;font-size:11px;font-weight:800;cursor:pointer;}' +
      '.opl-side button.is-up.is-on{background:rgba(52,211,153,0.22);border-color:#34d399;color:#7ce6a8;}' +
      '.opl-side button.is-down.is-on{background:rgba(255,124,138,0.20);border-color:#ff7c8a;color:#ff9aa5;}' +
      '.opl-legs{display:flex;flex-direction:column;gap:5px;}' +
      '.opl-leg{display:flex;justify-content:space-between;align-items:center;gap:6px;background:rgba(255,255,255,0.04);border-radius:8px;padding:6px 8px;font-size:11px;}' +
      '.opl-leg-title{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}' +
      '.opl-leg-x{border:none;background:transparent;color:#64748b;cursor:pointer;font-size:13px;}' +
      '.opl-stake-row{display:flex;align-items:center;gap:6px;flex-wrap:wrap;}' +
      '.opl-stake-row input{width:64px;background:rgba(0,0,0,0.4);border:1px solid rgba(120,180,255,0.3);border-radius:8px;color:#f8fafc;padding:6px 8px;font-size:13px;font-weight:700;}' +
      '.opl-chip{border:1px solid rgba(255,255,255,0.14);background:transparent;color:#cbd5e1;border-radius:999px;padding:4px 9px;font-size:11px;cursor:pointer;font-weight:700;}' +
      '.opl-summary{display:flex;justify-content:space-between;align-items:baseline;background:rgba(245,196,104,0.08);border:1px solid rgba(245,196,104,0.25);border-radius:10px;padding:8px 10px;}' +
      '.opl-mult{font-size:20px;font-weight:900;color:#f5c468;}' +
      '.opl-payout{font-size:12px;font-weight:700;}' +
      '.opl-place{width:100%;padding:11px 0;border:none;border-radius:12px;background:linear-gradient(135deg,#f5c468,#f59e0b);color:#141414;font-weight:900;font-size:14px;cursor:pointer;}' +
      '.opl-place:disabled{opacity:.45;cursor:not-allowed;}' +
      '.opl-open{display:flex;flex-direction:column;gap:6px;}' +
      '.opl-slip{background:rgba(255,255,255,0.04);border-radius:10px;padding:8px 9px;font-size:11px;border-left:3px solid #f5c468;}' +
      '.opl-slip.is-won{border-left-color:#34d399;}' +
      '.opl-slip.is-lost{border-left-color:#ff7c8a;opacity:.7;}' +
      '.opl-slip.is-cashed{border-left-color:#7dd3fc;opacity:.85;}' +
      '.opl-slip-top{display:flex;justify-content:space-between;gap:6px;margin-bottom:4px;}' +
      '.opl-slip-value{color:#7ce6a8;font-weight:800;}' +
      '.opl-sell{border:1px solid rgba(125,211,252,0.5);background:rgba(125,211,252,0.12);color:#7dd3fc;border-radius:8px;padding:4px 10px;font-size:11px;font-weight:800;cursor:pointer;}' +
      '.opl-section-h{font-size:10px;letter-spacing:.08em;color:#64748b;font-weight:800;text-transform:uppercase;}' +
      '.opl-flash{animation:oplFlash 1.2s ease;}' +
      '@keyframes oplFlash{30%{box-shadow:0 0 42px rgba(245,196,104,0.8);}}' +
      '@media (max-width:640px){#ostParlayDock{right:8px;bottom:64px;}}';
    document.head.appendChild(st);
  }

  // ------------------------------------------------------------- dock
  function setCollapsed(v) {
    collapsed = v;
    if (!dockEl) return;
    dockEl.classList.toggle('is-collapsed', collapsed);
    dockEl.querySelector('#oplBody').style.display = collapsed ? 'none' : 'flex';
  }

  function buildDock() {
    if (dockEl) return dockEl;
    injectStyles();
    dockEl = document.createElement('div');
    dockEl.id = 'ostParlayDock';
    dockEl.className = 'is-collapsed';
    dockEl.innerHTML =
      '<div class="opl-head" id="oplHead">' +
        '<span class="opl-head-title">⚡ Parlay <span class="opl-badge" id="oplCount">0</span></span>' +
        '<span id="oplLiveTotal" style="color:#7ce6a8;font-size:11px;font-weight:800;"></span>' +
      '</div>' +
      '<div class="opl-body" id="oplBody" style="display:none;">' +
        '<div class="opl-section-h">Quick 5-min coins · this round</div>' +
        '<div class="opl-coins" id="oplCoins"></div>' +
        '<div class="opl-section-h">Your combo (add more from any market card)</div>' +
        '<div class="opl-legs" id="oplLegs"></div>' +
        '<div class="opl-stake-row">' +
          '<input type="number" id="oplStake" min="1" max="500" step="1" value="10">' +
          '<button class="opl-chip" data-stake="5">5</button>' +
          '<button class="opl-chip" data-stake="10">10</button>' +
          '<button class="opl-chip" data-stake="25">25</button>' +
          '<button class="opl-chip" data-stake="50">50</button>' +
        '</div>' +
        '<div class="opl-summary"><span class="opl-mult" id="oplMult">×1.00</span><span class="opl-payout" id="oplPayout">win 0.00 OST</span></div>' +
        '<button class="opl-place" id="oplPlace" disabled>Pick at least 2 legs</button>' +
        '<div class="opl-section-h">Open combos · live value · sell anytime</div>' +
        '<div class="opl-open" id="oplOpen"></div>' +
      '</div>';
    document.body.appendChild(dockEl);

    var coinsEl = dockEl.querySelector('#oplCoins');
    Object.keys(FAST_COINS).forEach(function (key) {
      var c = FAST_COINS[key];
      var cell = document.createElement('div');
      cell.className = 'opl-coin';
      cell.innerHTML =
        '<div class="opl-coin-name">' + c.emoji + ' ' + c.label + ' <span data-odds="' + key + '" style="color:#64748b;font-weight:600;"></span></div>' +
        '<div class="opl-side">' +
          '<button class="is-up" data-coin="' + key + '" data-side="up">UP</button>' +
          '<button class="is-down" data-coin="' + key + '" data-side="down">DN</button>' +
        '</div>';
      coinsEl.appendChild(cell);
    });

    dockEl.querySelector('#oplHead').addEventListener('click', function () { setCollapsed(!collapsed); });
    coinsEl.addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-coin]');
      if (btn) addFastLeg(btn.dataset.coin, btn.dataset.side);
    });
    dockEl.querySelector('.opl-stake-row').addEventListener('click', function (e) {
      var chip = e.target.closest('[data-stake]');
      if (!chip) return;
      stake = Number(chip.dataset.stake);
      dockEl.querySelector('#oplStake').value = String(stake);
      renderDock();
    });
    dockEl.querySelector('#oplStake').addEventListener('input', function (e) {
      stake = Math.max(MIN_STAKE, Math.min(MAX_STAKE, Math.floor(Number(e.target.value) || 0)));
      renderDock();
    });
    dockEl.querySelector('#oplPlace').addEventListener('click', placeSlip);
    dockEl.querySelector('#oplLegs').addEventListener('click', function (e) {
      var x = e.target.closest('[data-leg-remove]');
      if (!x) return;
      draft.splice(Number(x.dataset.legRemove), 1);
      renderDock(); syncCardChips();
    });
    dockEl.querySelector('#oplOpen').addEventListener('click', function (e) {
      var sell = e.target.closest('[data-sell-slip]');
      if (sell) sellSlip(sell.dataset.sellSlip);
    });
    return dockEl;
  }

  function renderDock() {
    if (!dockEl) return;
    // coin buttons state
    dockEl.querySelectorAll('button[data-coin]').forEach(function (b) {
      b.classList.toggle('is-on', draft.some(function (l) {
        return l.kind === 'fast' && l.coin === b.dataset.coin && l.side === (b.dataset.side === 'up' ? 'up' : 'down');
      }));
    });
    Object.keys(FAST_COINS).forEach(function (key) {
      var el = dockEl.querySelector('[data-odds="' + key + '"]');
      if (el) el.textContent = Math.round(fastYesOdds(key) * 100) + '¢↑';
    });
    // draft legs
    var legsEl = dockEl.querySelector('#oplLegs');
    legsEl.innerHTML = draft.length ? draft.map(function (l, i) {
      return '<div class="opl-leg"><span class="opl-leg-title">' + legShort(l) + '</span>' +
        '<span style="color:#f5c468;font-weight:700;">' + Math.round(clampP(l.entryPrice) * 100) + '¢</span>' +
        '<button class="opl-leg-x" data-leg-remove="' + i + '">×</button></div>';
    }).join('') : '<div style="color:#475569;font-size:11px;">No legs yet — tap ⚡ Parlay YES/NO on any market.</div>';
    // summary
    var n = draft.length;
    var mult = draftMult();
    dockEl.querySelector('#oplCount').textContent = String(n);
    dockEl.querySelector('#oplMult').textContent = '×' + (n ? mult.toFixed(2) : '1.00');
    var grossWin = stake * mult, netWin = grossWin;
    try { if (window.OST_HOUSE && OST_HOUSE.quote) netWin = Number(OST_HOUSE.quote(grossWin, stake).net) || grossWin; } catch (_) {}
    dockEl.querySelector('#oplPayout').textContent = 'win ' + (n ? netWin.toFixed(2) : '0.00') + ' OST';
    var place = dockEl.querySelector('#oplPlace');
    var bal = window.OST_MONEY ? window.OST_MONEY.get() : 0;
    if (n < MIN_LEGS) { place.disabled = true; place.textContent = 'Pick at least ' + MIN_LEGS + ' legs'; }
    else if (stake < MIN_STAKE) { place.disabled = true; place.textContent = 'Enter a stake'; }
    else if (bal < stake) { place.disabled = true; place.textContent = 'Need ' + stake + ' OST (have ' + bal.toFixed(2) + ')'; }
    else { place.disabled = false; place.textContent = '⚡ Place ' + stake + ' OST · win ' + netWin.toFixed(2); }
    renderOpenSlips();
  }

  function renderOpenSlips() {
    if (!dockEl) return;
    var el = dockEl.querySelector('#oplOpen');
    var slips = readSlips().slice().reverse().slice(0, 10);
    var openValue = 0;
    el.innerHTML = slips.length ? slips.map(function (sl) {
      var cls = sl.status === 'won' ? 'is-won' : sl.status === 'lost' ? 'is-lost' : sl.status === 'cashed' ? 'is-cashed' : '';
      var legs = sl.legs.map(function (l) {
        var mark = l.status === 'won' ? '✓' : l.status === 'lost' ? '✗' : l.status === 'void' ? '∅' : '';
        return legShort(l) + mark;
      }).join(' + ');
      var right;
      if (sl.status === 'open') {
        var val = slipLiveValue(sl);
        openValue += val;
        var offer = cashoutOffer(sl);
        right = '<span class="opl-slip-value">' + val.toFixed(2) + ' OST</span> ' +
          (offer >= 0.05 ? '<button class="opl-sell" data-sell-slip="' + sl.id + '">Sell ' + offer.toFixed(2) + '</button>' : '');
      } else if (sl.status === 'won') right = '<span class="opl-slip-value">PAID +' + slipPayout(sl).toFixed(2) + '</span>';
      else if (sl.status === 'cashed') right = '<span style="color:#7dd3fc;font-weight:800;">SOLD +' + (sl.cashoutOst || 0).toFixed(2) + '</span>';
      else right = '<span style="color:#ff9aa5;">−' + sl.stake.toFixed(2) + '</span>';
      return '<div class="opl-slip ' + cls + '"><div class="opl-slip-top"><span>×' + (slipPayout(sl) / sl.stake).toFixed(2) + ' · ' + sl.stake + ' OST</span>' + right + '</div>' +
        '<div style="color:#94a3b8;">' + legs + '</div></div>';
    }).join('') : '<div style="color:#475569;font-size:11px;">No combos yet.</div>';
    var live = dockEl.querySelector('#oplLiveTotal');
    if (live) live.textContent = openValue > 0 ? 'live ' + openValue.toFixed(2) + ' OST' : '';
  }

  function toastMini(text) {
    var el = document.createElement('div');
    el.style.cssText = 'position:fixed;left:50%;bottom:86px;transform:translateX(-50%);z-index:10049;background:rgba(10,14,28,0.95);border:1px solid rgba(245,196,104,0.4);color:#f5c468;font-size:13px;font-weight:800;border-radius:999px;padding:9px 18px;';
    el.textContent = text;
    document.body.appendChild(el);
    setTimeout(function () { el.remove(); }, 2400);
  }

  // ------------------------------------------------------------- place / sell / settle
  function placeSlip() {
    if (draft.length < MIN_LEGS || !window.OST_MONEY) return;
    // A draft built in an earlier 5-min round must not be placed after that round
    // closed (the outcome would already be known). Re-quote fast legs on the current
    // round; drop anything that closed. Never place at stale odds.
    var now = Date.now(), b = boundaries(now), dropped = 0;
    draft = draft.filter(function (l) {
      if (l.kind === 'fast') {
        if (l.openAt !== b.openAt) { var yes = fastYesOdds(l.coin); l.openAt = b.openAt; l.closeAtMs = b.closeAt; l.entryPrice = clampP(l.side === 'up' ? yes : 1 - yes); }
        if (b.closeAt - now < 60000) { dropped++; return false; }
        return true;
      }
      if (l.closeAtMs && l.closeAtMs - now < 60000) { dropped++; return false; }
      var m = marketById(l.marketId); if (m && Number.isFinite(Number(m.yesPriceNumber))) { var y = clampP(m.yesPriceNumber); l.entryPrice = l.side === 'yes' ? y : 1 - y; }
      return true;
    });
    if (dropped) { toastMini(dropped + ' leg' + (dropped > 1 ? 's' : '') + ' closed — removed from the slip'); renderDock(); syncCardChips(); return; }
    if (draft.length < MIN_LEGS) { renderDock(); return; }
    var amount = Math.max(MIN_STAKE, Math.min(MAX_STAKE, Math.floor(stake)));
    if (!window.OST_MONEY.spend(amount, 'parlay')) { renderDock(); return; }
    var slip = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      legs: draft.map(function (l) { return Object.assign({ status: 'open' }, l); }),
      stake: amount,
      status: 'open',
      placedAt: Date.now()
    };
    var slips = readSlips();
    slips.push(slip);
    writeSlips(slips);
    ledgerUpsert(slip);
    draft = [];
    renderDock();
    syncCardChips();
    dockEl.classList.add('opl-flash');
    setTimeout(function () { dockEl.classList.remove('opl-flash'); }, 1300);
  }

  function sellSlip(id) {
    var slips = readSlips();
    var slip = slips.find(function (s) { return s.id === id; });
    if (!slip || slip.status !== 'open' || !window.OST_MONEY) return;
    // Charge the house edge live on the cash-out: rake the profit portion of
    // the fair live value; the user receives the NET (== the offer shown).
    var live = slipLiveValue(slip);
    var net = live;
    if (window.OST_HOUSE && typeof window.OST_HOUSE.rake === 'function') {
      net = window.OST_HOUSE.rake(live, Number(slip.stake) || 0, 'parlay', { kind: 'cashout' }).net;
    } else {
      net = cashoutOffer(slip);
    }
    if (!(net >= 0.01)) return;
    slip.status = 'cashed';
    slip.cashoutOst = Math.round(net * 100) / 100;
    slip.settledAt = Date.now();
    writeSlips(readSlips().map(function (x) { return x.id === slip.id ? slip : x; }));
    window.OST_MONEY.add(slip.cashoutOst, 'parlay-cashout');
    ledgerUpsert(slip);
    toastMini('Sold combo for ' + slip.cashoutOst.toFixed(2) + ' OST');
    renderDock();
  }

  var settling = false;
  var gammaChecked = {};   // legKey -> last check ts (throttle: a still-open market is re-asked every 10 min)
  function gammaStatus(marketId) {
    if (!/^\d+$/.test(String(marketId))) return Promise.resolve(null);   // Kalshi/native legs: no gamma record
    return fetchJson(API + '/gamma/markets/' + encodeURIComponent(marketId), 6500).then(function (j) { return j || null; }).catch(function (e) { return /http 404/.test(String(e && e.message)) ? { missing: true } : null; });
  }
  function pinnedWinner(yes) { if (!Number.isFinite(yes)) return ''; if (yes >= 0.985) return 'yes'; if (yes <= 0.015) return 'no'; return ''; }
  function settleScan() {
    if (settling) return;
    var slips = readSlips();
    var now = Date.now();
    var work = [];
    slips.forEach(function (slip) {
      if (slip.status !== 'open') return;
      slip.legs.forEach(function (leg) {
        if (leg.status !== 'open') return;
        if (leg.kind === 'fast' && leg.openAt + FIVE_MIN + 8000 <= now) {
          work.push({ slip: slip, leg: leg, type: 'fast' });
        } else if (leg.kind === 'venue') {
          var closed = leg.closeAtMs && leg.closeAtMs < now;
          var key = slip.id + ':' + leg.marketId;
          // No close time on record (some feeds omit it): still ask the venue, at most every 10 min.
          if (closed || (!leg.closeAtMs && now - (gammaChecked[key] || 0) > 600000)) { gammaChecked[key] = now; work.push({ slip: slip, leg: leg, type: 'venue' }); }
        }
      });
    });
    if (!work.length) return;
    settling = true;
    var chain = Promise.resolve();
    work.forEach(function (w) {
      chain = chain.then(function () {
        if (w.type === 'fast') {
          return fetchKline(FAST_COINS[w.leg.coin].symbol, w.leg.openAt).then(function (k) {
            if (!k || !(k.open > 0) || !(k.close > 0)) return;
            var up = k.close > k.open;
            w.leg.status = (w.leg.side === 'up') === up ? 'won' : 'lost';
            w.leg.result = k.open + '->' + k.close;
          });
        }
        // venue: the venue's own record first (a resolved market leaves the live feed,
        // which is exactly when the old feed-only check went blind and voided winners).
        return gammaStatus(w.leg.marketId).then(function (g) {
          var winner = '';
          if (g && !g.missing) {
            var prices = g.outcomePrices; if (typeof prices === 'string') { try { prices = JSON.parse(prices); } catch (_) { prices = null; } }
            var yes = Array.isArray(prices) ? Number(prices[0]) : NaN;
            winner = pinnedWinner(yes);
            var closed = g.closed === true || g.resolved === true || g.archived === true;
            if (!winner && closed && w.leg.closeAtMs && now - w.leg.closeAtMs > VOID_AFTER_MS) { w.leg.status = 'void'; return; }
            if (!winner && !closed && !w.leg.closeAtMs) { var end = Date.parse(g.endDate || g.end_date_iso || ''); if (end > 0) w.leg.closeAtMs = end; }
          }
          if (!winner) {
            var m = marketById(w.leg.marketId);
            if (m && Number.isFinite(Number(m.yesPriceNumber))) winner = pinnedWinner(Number(m.yesPriceNumber));
          }
          if (winner) { w.leg.status = w.leg.side === winner ? 'won' : 'lost'; return; }
          if ((!g || g.missing) && w.leg.closeAtMs && now - w.leg.closeAtMs > VOID_AFTER_MS) w.leg.status = 'void';   // vanished unresolved — collapse the leg
        });
      });
    });
    chain.then(function () {
      // Re-read: a slip placed or sold while the venue calls were in flight must not be
      // overwritten by our stale copy (that lost placed stakes and re-opened sold slips).
      var fresh = readSlips();
      var byId = {}; fresh.forEach(function (s) { byId[s.id] = s; });
      slips.forEach(function (stale) {
        var slip = byId[stale.id]; if (!slip || slip.status !== 'open') return;
        stale.legs.forEach(function (l, i) { if (slip.legs[i] && slip.legs[i].status === 'open' && l.status !== 'open') { slip.legs[i].status = l.status; if (l.result) slip.legs[i].result = l.result; } if (slip.legs[i] && !slip.legs[i].closeAtMs && l.closeAtMs) slip.legs[i].closeAtMs = l.closeAtMs; });
        var anyLost = slip.legs.some(function (l) { return l.status === 'lost'; });
        var allDone = slip.legs.every(function (l) { return l.status !== 'open'; });
        if (anyLost) {
          slip.status = 'lost';
          slip.settledAt = Date.now();
          ledgerUpsert(slip);
        } else if (allDone) {
          var liveLegs = slip.legs.filter(function (l) { return l.status === 'won'; });
          slip.status = liveLegs.length ? 'won' : 'cashed'; // all void -> refund
          slip.settledAt = Date.now();
          var payout = slip.status === 'won' ? slipPayout(slip) : slip.stake;
          // Won: charge the house edge live on the profit; a void refund of the
          // user's own stake is never taxed.
          if (slip.status === 'won' && window.OST_HOUSE && typeof window.OST_HOUSE.rake === 'function') {
            payout = window.OST_HOUSE.rake(payout, Number(slip.stake) || 0, 'parlay', { kind: 'win' }).net;
          }
          if (slip.status === 'cashed') slip.cashoutOst = slip.stake;
          slip.paidOut = payout;
          if (window.OST_MONEY) window.OST_MONEY.add(payout, slip.status === 'won' ? 'parlay-win' : 'parlay-void-refund');
          ledgerUpsert(slip);
          if (slip.status === 'won') {
            try { window.dispatchEvent(new CustomEvent('ost:parlay-won', { detail: { payout: payout, legs: slip.legs } })); } catch (_) {}
          }
        }
      });
      writeSlips(fresh);
      renderDock();
    }).finally(function () { settling = false; });
  }

  // ------------------------------------------------------------- boot
  function boot() {
    if (!document.getElementById('walletBtn')) return; // classic app only
    buildDock();
    observeCards();
    renderDock();
    setInterval(settleScan, 15000);
    setTimeout(settleScan, 5000);
    setInterval(function () { if (!collapsed) renderDock(); else renderOpenSlips(); }, 6000); // live repricing
  }

  window.OST_PARLAY = {
    open: function () { buildDock(); widgetsLive(); setCollapsed(false); renderDock(); },
    addLeg: addVenueLeg,
    addFastLeg: addFastLeg,
    slips: readSlips,
    valueOf: slipLiveValue,
    offerOf: cashoutOffer,
    sell: sellSlip,
    settleScan: settleScan
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 1200); });
  else setTimeout(boot, 1200);
})();

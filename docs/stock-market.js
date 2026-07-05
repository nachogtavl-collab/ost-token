/* OST Stock Market Mirror */
(function () {
  'use strict';

  // 42 symbols (3x the original 14) across eight sectors so the mirror reads
  // like a real terminal: tech, semis, finance, consumer, health, energy,
  // crypto-adjacent equities, and index/commodity ETFs.
  var DEFAULT_SYMBOLS = [
    'AAPL', 'MSFT', 'NVDA', 'TSLA', 'AMZN', 'META', 'GOOGL', 'AMD', 'NFLX', 'ORCL', 'CRM', 'PLTR', 'UBER',
    'TSM', 'ASML', 'AVGO',
    'JPM', 'V', 'MA', 'BAC', 'GS',
    'KO', 'PEP', 'MCD', 'NKE', 'WMT', 'DIS',
    'JNJ', 'PFE', 'UNH', 'LLY',
    'XOM', 'CVX', 'BA', 'CAT',
    'COIN', 'MSTR', 'HOOD',
    'SPY', 'QQQ', 'DIA', 'GLD'
  ];
  var STORAGE_WATCHLIST = 'ost.stock.watchlist.v1';
  var STORAGE_ORDERS = 'ost.stock.orders.v1';
  // Sensible default OST/USD price so that conversion math is meaningful even
  // when the topup config is offline. The relay overrides this when reachable.
  var DEFAULT_OST_USD = 1.00;
  var state = {
    symbols: DEFAULT_SYMBOLS.slice(),
    quotes: [],
    selectedSymbol: 'AAPL',
    selectedQuote: null,
    history: [],
    side: 'buy',
    ostStake: 25,
    brokerCurrency: 'USD',
    usdPerOst: DEFAULT_OST_USD,
    solUsd: 0,
    placing: false,
    closingId: '',
    orders: []
  };

  function $(id) { return document.getElementById(id); }
  function apiBase() { return window.OST_API_BASE ? String(window.OST_API_BASE).replace(/\/$/, '') : ''; }
  function esc(value) {
    var element = document.createElement('div');
    element.textContent = value == null ? '' : String(value);
    return element.innerHTML;
  }
  function fmtMoney(value) {
    var number = Number(value);
    if (!Number.isFinite(number)) return '--';
    return '$' + number.toLocaleString(undefined, { minimumFractionDigits: number >= 100 ? 2 : 2, maximumFractionDigits: 2 });
  }
  function fmtNumber(value, digits) {
    var number = Number(value);
    if (!Number.isFinite(number)) return '--';
    return number.toLocaleString(undefined, { maximumFractionDigits: digits == null ? 2 : digits });
  }
  function fmtPct(value) {
    var number = Number(value);
    if (!Number.isFinite(number)) return '--';
    return (number >= 0 ? '+' : '') + number.toFixed(2) + '%';
  }
  function compact(value) {
    var number = Number(value || 0);
    if (number >= 1e9) return (number / 1e9).toFixed(2) + 'B';
    if (number >= 1e6) return (number / 1e6).toFixed(2) + 'M';
    if (number >= 1e3) return (number / 1e3).toFixed(1) + 'K';
    return number.toFixed(0);
  }
  function getWalletAddress() {
    try {
      if (window.OST_WALLET && window.OST_WALLET.address) return window.OST_WALLET.address;
      if (window.OST_WALLET && window.OST_WALLET.session && window.OST_WALLET.session.publicKey) return window.OST_WALLET.session.publicKey.toBase58();
      if (window.OST_WALLET_PUBKEY) return String(window.OST_WALLET_PUBKEY);
    } catch (error) {}
    return '';
  }
  function readOrderBuckets() {
    try {
      var parsed = JSON.parse(localStorage.getItem(STORAGE_ORDERS) || '{}');
      if (Array.isArray(parsed)) return { legacy: parsed };
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (error) {
      return {};
    }
  }
  function writeOrderBuckets(buckets) {
    try { localStorage.setItem(STORAGE_ORDERS, JSON.stringify(buckets || {})); } catch (error) {}
  }
  function orderId(order) {
    if (!order) return '';
    return String(order.id || order.signature || order.sig || [order.wallet || getWalletAddress(), order.symbol, order.side, order.createdAt || order.ts || '', order.price || order.entryPrice || ''].join(':'));
  }
  function normalizeOrder(order, walletOverride) {
    if (!order) return null;
    var copy = Object.assign({}, order);
    var wallet = walletOverride || copy.wallet || getWalletAddress();
    var side = String(copy.side || '').toLowerCase() === 'sell' ? 'sell' : 'buy';
    var entryPrice = Number(copy.entryPrice || copy.openPrice || (side === 'buy' ? copy.price : copy.buyPrice));
    var exitPrice = Number(copy.exitPrice || copy.closePrice || (side === 'sell' ? copy.price : NaN));
    var displayPrice = Number(copy.price);
    if (!Number.isFinite(entryPrice) || entryPrice <= 0) entryPrice = Number.isFinite(displayPrice) && displayPrice > 0 ? displayPrice : 0;
    var shares = Number(copy.shares);
    var notional = Number(copy.notionalUsd);
    if ((!Number.isFinite(shares) || shares <= 0) && entryPrice > 0 && Number.isFinite(notional) && notional > 0) shares = notional / entryPrice;
    if (!Number.isFinite(notional) || notional <= 0) notional = entryPrice > 0 && Number.isFinite(shares) ? entryPrice * shares : 0;
    copy.wallet = wallet;
    copy.side = side;
    copy.entryPrice = entryPrice;
    if (Number.isFinite(exitPrice) && exitPrice > 0) copy.exitPrice = exitPrice;
    copy.price = Number.isFinite(displayPrice) && displayPrice > 0 ? displayPrice : (side === 'sell' && copy.exitPrice ? copy.exitPrice : entryPrice);
    copy.shares = Number.isFinite(shares) ? shares : 0;
    copy.notionalUsd = Number.isFinite(notional) ? notional : 0;
    copy.ostStake = Number(copy.ostStake || copy.stake || copy.amount || 0) || 0;
    copy.createdAt = Number(copy.createdAt || copy.ts || Date.now()) || Date.now();
    copy.id = orderId(copy);
    return copy;
  }
  function localOrdersForWallet(wallet) {
    var buckets = readOrderBuckets();
    var rows = [];
    if (wallet && Array.isArray(buckets[wallet])) rows = rows.concat(buckets[wallet]);
    if (Array.isArray(buckets.legacy)) rows = rows.concat(buckets.legacy.filter(function (order) { return !order.wallet || order.wallet === wallet; }));
    return rows.map(function (order) { return normalizeOrder(order, wallet); }).filter(Boolean);
  }
  function saveLocalOrdersForWallet(wallet, orders) {
    if (!wallet) return;
    var buckets = readOrderBuckets();
    buckets[wallet] = (orders || []).map(function (order) { return normalizeOrder(order, wallet); }).filter(Boolean).slice(0, 200);
    delete buckets.legacy;
    writeOrderBuckets(buckets);
  }
  function mergeOrders(remoteOrders, localOrders, wallet) {
    var map = Object.create(null);
    (remoteOrders || []).forEach(function (order) {
      var normalized = normalizeOrder(order, wallet);
      if (normalized) map[orderId(normalized)] = normalized;
    });
    (localOrders || []).forEach(function (order) {
      var normalized = normalizeOrder(order, wallet);
      if (!normalized) return;
      var key = orderId(normalized);
      map[key] = Object.assign({}, map[key] || {}, normalized);
    });
    return Object.keys(map).map(function (key) { return map[key]; }).sort(function (a, b) {
      return Number(b.closedAt || b.createdAt || 0) - Number(a.closedAt || a.createdAt || 0);
    });
  }
  function persistCurrentOrders() {
    var wallet = getWalletAddress();
    if (wallet) saveLocalOrdersForWallet(wallet, state.orders);
  }
  function upsertLocalOrder(order) {
    var wallet = (order && order.wallet) || getWalletAddress();
    if (!wallet) return null;
    var normalized = normalizeOrder(order, wallet);
    if (!normalized) return null;
    var next = mergeOrders([], localOrdersForWallet(wallet), wallet);
    var key = orderId(normalized);
    var found = false;
    next = next.map(function (entry) {
      if (orderId(entry) !== key) return entry;
      found = true;
      return Object.assign({}, entry, normalized);
    });
    if (!found) next.unshift(normalized);
    saveLocalOrdersForWallet(wallet, next);
    state.orders = mergeOrders(state.orders, next, wallet);
    return normalized;
  }
  function setStatus(text, kind) {
    var status = $('smStatus');
    if (!status) return;
    status.textContent = text;
    status.classList.remove('is-error', 'is-success');
    if (kind) status.classList.add(kind);
  }
  function setOrderStatus(text, kind) {
    var status = $('smOrderStatus');
    if (!status) return;
    status.textContent = text;
    status.classList.remove('is-error', 'is-success');
    if (kind) status.classList.add(kind);
  }
  function calcNotionalUsd() {
    return Math.max(0, Number(state.ostStake || 0)) * Math.max(0, Number(state.usdPerOst || 0));
  }
  function calcShares() {
    var price = Number(state.selectedQuote && state.selectedQuote.price);
    var notional = calcNotionalUsd();
    return price > 0 ? notional / price : 0;
  }

  async function loadTopupQuote() {
    var base = apiBase();
    if (!base) return;
    try {
      var response = await fetch(base + '/topup/config', { cache: 'no-store' });
      var payload = response.ok ? await response.json() : null;
      if (payload && payload.pricing) {
        var nextOst = Number(payload.pricing.usdPerOst);
        if (Number.isFinite(nextOst) && nextOst > 0) state.usdPerOst = nextOst;
        var nextSol = Number(payload.pricing.solUsd);
        if (Number.isFinite(nextSol) && nextSol > 0) state.solUsd = nextSol;
      }
      if (!Number.isFinite(state.usdPerOst) || state.usdPerOst <= 0) state.usdPerOst = DEFAULT_OST_USD;
    } catch (error) {
      if (!Number.isFinite(state.usdPerOst) || state.usdPerOst <= 0) state.usdPerOst = DEFAULT_OST_USD;
    }
  }

  async function loadQuotes() {
    var base = apiBase();
    if (!base) {
      setStatus('Stock relay offline: OST API base missing.', 'is-error');
      return;
    }
    setStatus('Public quotes ready; live feed refreshing');
    try {
      // The worker serves at most 24 symbols per request. Split the 42-symbol
      // universe into the FEWEST chunks (21+21) and fetch them SEQUENTIALLY so
      // a single client never fans out parallel requests into the worker's
      // aggressive per-IP rate limiter (that returned empty quote sets).
      var CHUNK = 21;
      var chunks = [];
      for (var ci = 0; ci < state.symbols.length; ci += CHUNK) chunks.push(state.symbols.slice(ci, ci + CHUNK));
      var merged = [];
      var anyOk = false;
      for (var k = 0; k < chunks.length; k++) {
        try {
          var resp = await fetch(base + '/stocks/quotes?symbols=' + encodeURIComponent(chunks[k].join(',')), { cache: 'no-store' });
          if (resp.ok) {
            var pj = await resp.json();
            if (pj && Array.isArray(pj.quotes)) { merged = merged.concat(pj.quotes); anyOk = true; }
          }
        } catch (_) {}
      }
      // If the relay is rate-limiting, keep whatever we already had rendered
      // rather than blanking the board.
      if (!anyOk && state.quotes && state.quotes.length) { renderQuotes(); renderTicket(); return; }
      var payload = { quotes: merged, source: 'ost edge relay' };
      state.quotes = merged;
      if (state.quotes.length && !state.quotes.some(function(quote) { return quote.symbol === state.selectedSymbol; })) {
        state.selectedSymbol = state.quotes[0].symbol;
      }
      state.selectedQuote = state.quotes.find(function(quote) { return quote.symbol === state.selectedSymbol; }) || state.quotes[0] || null;
      renderQuotes();
      renderTicket();
      setStatus(state.quotes.length ? 'Live public stock quotes online via ' + String(payload && payload.source || 'public feed') + '.' : 'No public quotes returned.', state.quotes.length ? 'is-success' : 'is-error');
      if (state.selectedQuote) loadHistory(state.selectedQuote.symbol);
    } catch (error) {
      setStatus(error && error.message ? error.message : 'Stock relay unavailable.', 'is-error');
    }
  }

  async function loadHistory(symbol) {
    var base = apiBase();
    if (!base || !symbol) return;
    try {
      var response = await fetch(base + '/stocks/' + encodeURIComponent(symbol) + '/history', { cache: 'no-store' });
      var payload = response.ok ? await response.json() : null;
      state.history = payload && Array.isArray(payload.history) ? payload.history : [];
      drawChart();
    } catch (error) {
      state.history = [];
      drawChart();
    }
  }

  async function fetchLatestQuote(symbol) {
    var existing = liveQuoteFor(symbol);
    var base = apiBase();
    if (!base || !symbol) return existing;
    try {
      var response = await fetch(base + '/stocks/' + encodeURIComponent(symbol), { cache: 'no-store' });
      var payload = response.ok ? await response.json() : null;
      var quote = payload && payload.quote;
      if (!quote || !Number.isFinite(Number(quote.price))) return existing;
      var replaced = false;
      state.quotes = state.quotes.map(function (entry) {
        if (entry && entry.symbol === quote.symbol) { replaced = true; return quote; }
        return entry;
      });
      if (!replaced) state.quotes.unshift(quote);
      if (quote.symbol === state.selectedSymbol) state.selectedQuote = quote;
      return quote;
    } catch (error) {
      return existing;
    }
  }

  async function loadOrders() {
    var base = apiBase();
    var wallet = getWalletAddress();
    if (!wallet) {
      state.orders = [];
      renderOrders();
      return;
    }
    var localOrders = localOrdersForWallet(wallet);
    if (!base) {
      state.orders = mergeOrders([], localOrders, wallet);
      renderOrders();
      return;
    }
    try {
      var response = await fetch(base + '/stocks/orders/' + encodeURIComponent(wallet), { cache: 'no-store' });
      var payload = response.ok ? await response.json() : null;
      var remoteOrders = payload && Array.isArray(payload.orders) ? payload.orders : [];
      state.orders = mergeOrders(remoteOrders, localOrders, wallet);
      saveLocalOrdersForWallet(wallet, state.orders);
      renderOrders();
    } catch (error) {
      state.orders = mergeOrders([], localOrders, wallet);
      renderOrders();
    }
  }

  function renderQuotes() {
    var grid = $('smQuoteGrid');
    if (!grid) return;
    if (!state.quotes.length) {
      grid.innerHTML = '<div class="stock-empty">Waiting for public quote relay.</div>';
      return;
    }
    grid.innerHTML = state.quotes.map(function(quote) {
      var up = Number(quote.change || 0) >= 0;
      return '<button type="button" class="stock-symbol-card' + (quote.symbol === state.selectedSymbol ? ' is-active' : '') + '" data-stock-symbol="' + esc(quote.symbol) + '">' +
        '<div class="stock-symbol-top"><strong class="stock-symbol">' + esc(quote.symbol) + '</strong><span class="stock-exchange">' + esc(quote.exchange || 'US') + '</span></div>' +
        '<div class="stock-muted">' + esc(quote.name || quote.symbol) + '</div>' +
        '<strong class="stock-price">' + esc(fmtMoney(quote.price)) + '</strong>' +
        '<div class="' + (up ? 'stock-change-up' : 'stock-change-down') + '">' + esc(fmtMoney(quote.change)) + ' / ' + esc(fmtPct(quote.changePct)) + '</div>' +
      '</button>';
    }).join('');
    grid.querySelectorAll('[data-stock-symbol]').forEach(function(button) {
      button.addEventListener('click', function() {
        state.selectedSymbol = button.getAttribute('data-stock-symbol');
        state.selectedQuote = state.quotes.find(function(quote) { return quote.symbol === state.selectedSymbol; }) || null;
        renderQuotes();
        renderSelected();
        renderTicket();
        loadHistory(state.selectedSymbol);
      });
    });
    renderSelected();
  }

  function renderSelected() {
    var quote = state.selectedQuote;
    if (!quote) return;
    var up = Number(quote.change || 0) >= 0;
    if ($('smSelectedTitle')) $('smSelectedTitle').textContent = quote.symbol + ' - ' + quote.name;
    if ($('smSelectedMeta')) $('smSelectedMeta').textContent = quote.exchange + ' / ' + quote.sector + ' / ' + (quote.asOf || 'public quote') + ' / ' + String(quote.source || 'public').toUpperCase();
    if ($('smSelectedPrice')) $('smSelectedPrice').textContent = fmtMoney(quote.price);
    if ($('smSelectedChange')) {
      $('smSelectedChange').textContent = fmtMoney(quote.change) + ' / ' + fmtPct(quote.changePct);
      $('smSelectedChange').className = up ? 'stock-change-up' : 'stock-change-down';
    }
    if ($('smMetricOpen')) $('smMetricOpen').textContent = fmtMoney(quote.open);
    if ($('smMetricHigh')) $('smMetricHigh').textContent = fmtMoney(quote.high);
    if ($('smMetricLow')) $('smMetricLow').textContent = fmtMoney(quote.low);
    if ($('smMetricVolume')) $('smMetricVolume').textContent = compact(quote.volume);
  }

  function drawChart() {
    var canvas = $('smChart');
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    var rect = canvas.getBoundingClientRect();
    var width = Math.max(420, Math.floor(rect.width || 860));
    var height = 280;
    var ratio = window.devicePixelRatio || 1;
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    canvas.style.height = height + 'px';
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = 'rgba(5,8,14,.96)';
    ctx.fillRect(0, 0, width, height);

    var points = state.history.slice(-120).filter(function(point) { return Number.isFinite(Number(point.close)); });
    if (!points.length) {
      ctx.fillStyle = '#94a3b8';
      ctx.font = '14px Inter, sans-serif';
      ctx.fillText('Waiting for public history data', 18, 32);
      return;
    }
    var prices = points.map(function(point) { return Number(point.close); });
    var min = Math.min.apply(null, prices);
    var max = Math.max.apply(null, prices);
    var range = Math.max(0.01, max - min);
    var pad = 26;
    var plotWidth = width - pad * 2;
    var plotHeight = height - pad * 2;
    function x(index) { return pad + (points.length <= 1 ? 0 : index / (points.length - 1) * plotWidth); }
    function y(price) { return pad + (1 - (price - min) / range) * plotHeight; }

    ctx.strokeStyle = 'rgba(255,255,255,.08)';
    ctx.lineWidth = 1;
    for (var gridIndex = 0; gridIndex < 4; gridIndex++) {
      var gridY = pad + gridIndex / 3 * plotHeight;
      ctx.beginPath();
      ctx.moveTo(pad, gridY);
      ctx.lineTo(width - pad, gridY);
      ctx.stroke();
    }

    var isUp = prices[prices.length - 1] >= prices[0];
    var gradient = ctx.createLinearGradient(0, pad, 0, height - pad);
    gradient.addColorStop(0, isUp ? 'rgba(52,211,153,.32)' : 'rgba(248,113,113,.28)');
    gradient.addColorStop(1, 'rgba(52,211,153,0)');

    ctx.beginPath();
    points.forEach(function(point, index) {
      var px = x(index);
      var py = y(Number(point.close));
      if (index === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.lineTo(x(points.length - 1), height - pad);
    ctx.lineTo(x(0), height - pad);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();

    ctx.beginPath();
    points.forEach(function(point, index) {
      var px = x(index);
      var py = y(Number(point.close));
      if (index === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.strokeStyle = isUp ? '#6ee7b7' : '#fca5a5';
    ctx.lineWidth = 2.4;
    ctx.stroke();

    ctx.fillStyle = '#94a3b8';
    ctx.font = '12px Inter, sans-serif';
    ctx.fillText(fmtMoney(max), pad, 16);
    ctx.fillText(fmtMoney(min), pad, height - 8);
  }

  function openPositionsForSymbol(symbol) {
    if (!symbol) return [];
    return state.orders.filter(function (order) {
      if (!order || !order.symbol) return false;
      var sideOk = String(order.side || '').toLowerCase() === 'buy';
      var statusOk = String(order.status || '').toLowerCase().indexOf('close') === -1;
      return order.symbol === symbol && sideOk && statusOk;
    });
  }

  function totalOpenStakeForSymbol(symbol) {
    return openPositionsForSymbol(symbol).reduce(function (sum, order) {
      return sum + (Number(order.ostStake) || 0);
    }, 0);
  }

  function renderTicket() {
    var quote = state.selectedQuote;
    var stakeInput = $('smOstStake');
    if (stakeInput && document.activeElement !== stakeInput) stakeInput.value = String(state.ostStake);
    if ($('smBrokerCurrency')) $('smBrokerCurrency').value = state.brokerCurrency;
    if ($('smEstNotional')) $('smEstNotional').textContent = fmtMoney(calcNotionalUsd());
    if ($('smEstShares')) $('smEstShares').textContent = fmtNumber(calcShares(), 5);
    if ($('smTicketSymbol')) $('smTicketSymbol').textContent = quote ? quote.symbol : '--';
    if ($('smTicketPrice')) $('smTicketPrice').textContent = quote ? fmtMoney(quote.price) : '--';
    if ($('smRailOstUsd')) $('smRailOstUsd').textContent = '$' + Number(state.usdPerOst || 0).toFixed(4) + ' per OST';
    if ($('smRailSolUsd')) $('smRailSolUsd').textContent = state.solUsd ? fmtMoney(state.solUsd) + ' per SOL' : 'SOL quote pending';
    var orderButton = $('smOrderBtn');
    if (orderButton) {
      var symbol = quote ? quote.symbol : '';
      if (state.side === 'sell') {
        var openCount = openPositionsForSymbol(symbol).length;
        orderButton.textContent = openCount
          ? 'Close ' + openCount + ' open ' + symbol + ' position' + (openCount === 1 ? '' : 's')
          : 'No open ' + (symbol || 'position') + ' to close';
        orderButton.disabled = state.placing || !quote || openCount === 0;
      } else {
        orderButton.textContent = 'Place OST stock ticket';
        orderButton.disabled = state.placing || !quote;
      }
    }
  }

  function liveQuoteFor(symbol) {
    if (!symbol) return null;
    return state.quotes.find(function (quote) { return quote && quote.symbol === symbol; }) || null;
  }

  function estimatePnl(order) {
    var live = liveQuoteFor(order.symbol);
    var entry = Number(order.entryPrice || order.price) || 0;
    var exit = Number(order.exitPrice || order.closePrice) || 0;
    var shares = Number(order.shares) || 0;
    var stake = Number(order.ostStake) || 0;
    if (entry <= 0 || shares <= 0) return { pctText: '--', ostDelta: 0, ostText: '--', usdDelta: 0, exitPrice: exit || entry };
    var nowPrice = exit || (live ? Number(live.price) : entry);
    var move = (nowPrice - entry) / entry;
    var ostDelta = stake * move;
    var usdDelta = shares * (nowPrice - entry);
    var pct = move * 100;
    var sign = pct >= 0 ? '+' : '';
    return {
      pctText: sign + pct.toFixed(2) + '%',
      ostDelta: ostDelta,
      usdDelta: usdDelta,
      exitPrice: nowPrice,
      payoutOst: Math.max(0, stake + ostDelta),
      ostText: (ostDelta >= 0 ? '+' : '') + ostDelta.toFixed(3) + ' OST'
    };
  }

  function renderOrders() {
    var list = $('smPositionsList');
    if (!list) return;
    if (!getWalletAddress()) {
      list.innerHTML = '<div class="stock-empty">Connect a wallet to mirror stock orders across devices.</div>';
      return;
    }
    if (!state.orders.length) {
      list.innerHTML = '<div class="stock-empty">No OST stock mirror orders yet.</div>';
      return;
    }
    var explorerCluster = (window.OST_NETWORK === 'mainnet-beta') ? '' : '?cluster=devnet';
    list.innerHTML = state.orders.slice(0, 60).map(function(order) {
      var sideRaw = String(order.side || '').toLowerCase();
      var status = String(order.status || '').toLowerCase();
      var isClosed = status.indexOf('close') !== -1 || sideRaw === 'sell';
      var explorer = order.signature ? 'https://explorer.solana.com/tx/' + encodeURIComponent(order.signature) + explorerCluster : '';
      var pnl = estimatePnl(order);
      var orderId = order.id || order.signature || (order.symbol + ':' + order.createdAt);
      var closingThis = state.closingId === orderId;
      var entryPrice = Number(order.entryPrice || order.price) || 0;
      var exitPrice = Number(order.exitPrice || order.closePrice) || 0;
      var priceLine = isClosed && exitPrice
        ? esc(fmtNumber(order.shares, 5)) + ' mirror shares entry ' + esc(fmtMoney(entryPrice)) + ' -> exit ' + esc(fmtMoney(exitPrice))
        : esc(fmtNumber(order.shares, 5)) + ' mirror shares @ ' + esc(fmtMoney(entryPrice || order.price));
      var stakeLine = isClosed && Number(order.cashoutOst)
        ? esc(fmtNumber(order.ostStake, 2)) + ' OST stake -> ' + esc(fmtNumber(order.cashoutOst, 3)) + ' OST paid'
        : esc(fmtNumber(order.ostStake, 2)) + ' OST';
      var pnlBlock = pnl && pnl.pctText !== '--'
        ? '<div class="stock-position-meta"><span>' + (isClosed ? 'Realized P/L' : 'P/L now') + '</span><span class="' + (pnl.ostDelta >= 0 ? 'stock-change-up' : 'stock-change-down') + '">' + esc(pnl.pctText) + ' / ' + esc(pnl.ostText) + ' / ' + esc(fmtMoney(pnl.usdDelta)) + '</span></div>'
        : '';
      var actionBlock = '';
      if (!isClosed) {
        actionBlock = '<button type="button" class="stock-order-btn" data-stock-close="' + esc(orderId) + '"' + (closingThis ? ' disabled' : '') + ' style="margin-top:8px;padding:8px 14px;font-size:.82rem;">' + (closingThis ? 'Closing...' : 'Sell / Close position') + '</button>';
      } else {
        actionBlock = '<span class="stock-kicker" style="opacity:.7;">Closed</span>';
      }
      return '<div class="stock-position-row" data-stock-order="' + esc(orderId) + '">' +
        '<div class="stock-position-top"><strong>' + esc((order.side || '').toUpperCase()) + ' ' + esc(order.symbol) + '</strong><span>' + esc(fmtMoney(order.notionalUsd)) + '</span></div>' +
        '<div class="stock-position-meta"><span>' + priceLine + '</span><span>' + stakeLine + '</span></div>' +
        pnlBlock +
        (explorer ? '<a href="' + explorer + '" target="_blank" rel="noopener">View settlement ticket</a>' : '') +
        actionBlock +
      '</div>';
    }).join('');
    list.querySelectorAll('[data-stock-close]').forEach(function (button) {
      button.addEventListener('click', function () {
        closePosition(button.getAttribute('data-stock-close'));
      });
    });
  }

  async function settleClosePayout(order, payoutOst) {
    var payout = Math.max(0, Number(payoutOst) || 0);
    if (payout <= 0) return { ost: 0, sig: 'loss-' + Date.now().toString(36), localOnly: true };
    var cashOut = window.OST_TRADE && window.OST_TRADE.predictionCashOut;
    if (typeof cashOut === 'function') {
      try {
        return await cashOut(Object.assign({}, order, {
          marketId: 'stock:' + order.symbol,
          side: 'sell',
          stake: Number(order.ostStake || 0),
          cashoutKind: 'stock-mirror-sell'
        }), payout);
      } catch (error) {
        throw new Error(error && error.message ? error.message : 'OST stock payout failed.');
      }
    }
    throw new Error('OST settlement vault is still loading. Try again in a moment.');
  }

  async function closePosition(orderId) {
    if (!orderId || state.closingId) return;
    var order = state.orders.find(function (entry) {
      var entryId = entry.id || entry.signature || (entry.symbol + ':' + entry.createdAt);
      return entryId === orderId;
    });
    if (!order) return;
    var wallet = getWalletAddress();
    if (!wallet) {
      setOrderStatus('Connect an OST wallet before closing positions.', 'is-error');
      return;
    }
    state.closingId = orderId;
    renderOrders();
    setOrderStatus('Closing ' + order.symbol + ' mirror position...');
    var live = await fetchLatestQuote(order.symbol);
    var entryPrice = Number(order.entryPrice || order.price) || 0;
    var nowPrice = live ? Number(live.price) : entryPrice;
    var shares = Number(order.shares) || 0;
    var notionalUsd = nowPrice * shares;
    order.exitPrice = nowPrice;
    var pnl = estimatePnl(order);
    var payout;
    try {
      payout = await settleClosePayout(order, pnl.payoutOst);
    } catch (error) {
      state.closingId = '';
      setOrderStatus(error && error.message ? error.message : 'Stock payout failed. Position remains open.', 'is-error');
      renderOrders();
      renderTicket();
      return;
    }
    var closeId = 'stock-close-' + orderId + '-' + Date.now().toString(36);
    var closeRecord = normalizeOrder({
      id: closeId,
      wallet: wallet,
      symbol: order.symbol,
      name: order.name || order.symbol,
      exchange: order.exchange || 'US',
      sector: order.sector || '',
      side: 'sell',
      entryPrice: entryPrice,
      exitPrice: nowPrice,
      price: nowPrice,
      shares: shares,
      notionalUsd: notionalUsd,
      ostStake: Number(order.ostStake) || 0,
      brokerCurrency: order.brokerCurrency || state.brokerCurrency,
      signature: payout && payout.sig || '',
      status: 'ost-mirror-closed',
      linkedOrderId: orderId,
      pnlOst: pnl.ostDelta,
      pnlUsd: pnl.usdDelta,
      pnlPct: pnl.pctText,
      cashoutOst: Number(payout && payout.ost) || pnl.payoutOst,
      cashoutSig: payout && payout.sig || '',
      cashoutAt: Date.now(),
      quoteSource: live && live.source || order.quoteSource || 'public',
      quoteAsOf: live && live.asOf || '',
      createdAt: Date.now()
    }, wallet);
    var base = apiBase();
    var relayError = '';
    try {
      if (base) {
        var response = await fetch(base + '/stocks/orders', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            id: closeRecord.id,
            wallet: wallet,
            symbol: order.symbol,
            name: order.name || order.symbol,
            exchange: order.exchange || 'US',
            sector: order.sector || '',
            side: 'sell',
            price: nowPrice,
            shares: shares,
            notionalUsd: notionalUsd,
            ostStake: Number(order.ostStake) || 0,
            brokerCurrency: order.brokerCurrency || state.brokerCurrency,
            signature: closeRecord.cashoutSig || '',
            status: 'ost-mirror-closed',
            linkedOrderId: orderId,
            entryPrice: entryPrice,
            exitPrice: nowPrice,
            pnlOst: pnl.ostDelta,
            pnlUsd: pnl.usdDelta,
            cashoutOst: closeRecord.cashoutOst,
            createdAt: Date.now()
          })
        });
        if (!response.ok) relayError = 'Relay returned ' + response.status + '. ';
      }
    } catch (error) {
      relayError = ((error && error.message) || 'Relay unavailable') + '. ';
    } finally {
      order.status = 'ost-mirror-closed';
      order.exitPrice = nowPrice;
      order.closedAt = Date.now();
      order.pnlOst = pnl.ostDelta;
      order.pnlUsd = pnl.usdDelta;
      order.pnlPct = pnl.pctText;
      order.cashoutOst = closeRecord.cashoutOst;
      order.cashoutSig = closeRecord.cashoutSig;
      var retained = Math.max(0, Number(order.ostStake || 0) - Number(closeRecord.cashoutOst || 0));
      if (retained > 0 && !order.vaultRetainedAt && typeof window.recordOstVaultRetainedLoss === 'function') {
        order.vaultRetainedAt = Date.now();
        order.vaultRetainedOst = retained;
        try {
          window.recordOstVaultRetainedLoss({
            source: 'stock-mirror',
            subKind: 'stock-close-loss',
            amount: retained,
            retainedOst: retained,
            stake: Number(order.ostStake || 0) || 0,
            payoutOst: Number(closeRecord.cashoutOst || 0) || 0,
            token: order.symbol,
            marketId: 'stock:' + order.symbol,
            title: order.name || order.symbol,
            linkedId: order.id || order.signature || '',
            sig: closeRecord.cashoutSig || ''
          });
        } catch (_) {}
      }
      upsertLocalOrder(order);
      upsertLocalOrder(closeRecord);
      setOrderStatus(relayError + order.symbol + ' sold at ' + fmtMoney(nowPrice) + '. ' + (payout && payout.localOnly ? 'Local close recorded. ' : '') + 'P/L ' + pnl.ostText + ' (' + pnl.pctText + ').', pnl.ostDelta >= 0 ? 'is-success' : 'is-error');
      try { window.dispatchEvent(new CustomEvent('ost:stock-position-closed', { detail: { symbol: order.symbol, pnlOst: pnl.ostDelta, entryPrice: entryPrice, exitPrice: nowPrice } })); } catch (_) {}
      state.closingId = '';
      await loadOrders();
      renderTicket();
    }
  }

  async function placeOrder() {
    var quote = state.selectedQuote;
    var wallet = getWalletAddress();
    if (!quote) return;
    if (!wallet) {
      setOrderStatus('Connect an OST wallet before placing a stock mirror order.', 'is-error');
      return;
    }
    // SELL flow: route to the close-position handler against the user's open
    // positions for this symbol. Selling without holdings is a no-op.
    if (state.side === 'sell') {
      var openOrders = openPositionsForSymbol(quote.symbol);
      if (!openOrders.length) {
        setOrderStatus('No open ' + quote.symbol + ' position to sell. Buy mirror shares first.', 'is-error');
        return;
      }
      var targetStake = Math.max(1, Number(state.ostStake) || 0);
      var remaining = targetStake;
      // Close oldest-first until we cover the requested OST stake.
      var ordered = openOrders.slice().sort(function (a, b) { return (a.createdAt || 0) - (b.createdAt || 0); });
      for (var index = 0; index < ordered.length && remaining > 0; index++) {
        var entry = ordered[index];
        var entryId = entry.id || entry.signature || (entry.symbol + ':' + entry.createdAt);
        await closePosition(entryId);
        remaining -= Number(entry.ostStake) || 0;
      }
      return;
    }
    if (!window.OST_PREDICTION_API || typeof window.OST_PREDICTION_API.placeOrder !== 'function') {
      setOrderStatus('OST settlement vault is still loading. Refresh and try again.', 'is-error');
      return;
    }
    state.placing = true;
    renderTicket();
    setOrderStatus('Routing OST to the mirror settlement vault...');
    var optimisticStake = Number(state.ostStake || 0);
    if (window.OST_OPTIMISTIC) {
      try { window.OST_OPTIMISTIC.toast(state.side.toUpperCase() + ' ' + optimisticStake + ' OST · ' + quote.symbol + ' submitted…', 'pending'); } catch (e) {}
      try { window.OST_OPTIMISTIC.balanceHint({ deltaOst: -optimisticStake, source: 'stock-' + state.side, pending: true, symbol: quote.symbol }); } catch (e) {}
    }
    try {
      var notionalUsd = calcNotionalUsd();
      var shares = calcShares();
      var ticket = await window.OST_PREDICTION_API.placeOrder({
        source: 'stock-mirror',
        marketId: quote.symbol,
        title: quote.name + ' stock mirror',
        side: 'yes',
        topic: 'stocks',
        price: Math.max(0.000001, Number(quote.price || 1)),
        yesPrice: Math.max(0.000001, Number(quote.price || 1)),
        noPrice: 0,
        stake: Number(state.ostStake || 0),
        shares: shares,
        potentialReturn: notionalUsd,
        sourceUrl: 'https://www.nasdaq.com/market-activity/stocks/' + encodeURIComponent(quote.symbol.toLowerCase()),
        reference: 'stock:' + quote.symbol + ':' + Date.now()
      });
      var signature = ticket && (ticket.signature || ticket.sig) || '';
      var createdAt = Date.now();
      var buyOrder = normalizeOrder({
        id: signature || ('stock-buy-' + quote.symbol + '-' + createdAt.toString(36)),
        wallet: wallet,
        symbol: quote.symbol,
        name: quote.name,
        exchange: quote.exchange,
        sector: quote.sector,
        side: 'buy',
        price: quote.price,
        entryPrice: quote.price,
        shares: shares,
        notionalUsd: notionalUsd,
        ostStake: Number(state.ostStake || 0),
        brokerCurrency: state.brokerCurrency,
        signature: signature,
        status: 'ost-mirror-open',
        quoteSource: quote.source || 'public',
        quoteAsOf: quote.asOf || '',
        createdAt: createdAt
      }, wallet);
      upsertLocalOrder(buyOrder);
      renderOrders();
      var base = apiBase();
      if (base) {
        await fetch(base + '/stocks/orders', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            id: buyOrder.id,
            wallet: wallet,
            symbol: quote.symbol,
            name: quote.name,
            exchange: quote.exchange,
            sector: quote.sector,
            side: state.side,
            price: quote.price,
            entryPrice: quote.price,
            shares: shares,
            notionalUsd: notionalUsd,
            ostStake: Number(state.ostStake || 0),
            brokerCurrency: state.brokerCurrency,
            signature: signature,
            status: 'ost-mirror-open',
            quoteSource: quote.source || 'public',
            quoteAsOf: quote.asOf || '',
            createdAt: createdAt
          })
        }).then(function (response) {
          return response && response.ok ? response.json().catch(function () { return null; }) : null;
        }).then(function (payload) {
          if (payload && payload.order) upsertLocalOrder(Object.assign({}, buyOrder, payload.order, { entryPrice: buyOrder.entryPrice }));
        }).catch(function() {});
      }
      setOrderStatus('Stock mirror ticket recorded at ' + fmtMoney(buyOrder.entryPrice) + '. Future sells compare against this entry.', 'is-success');
      await loadOrders();
      try {
        if (typeof window.syncOstWalletEventsFromRemote === 'function') window.syncOstWalletEventsFromRemote();
      } catch (error) {}
    } catch (error) {
      setOrderStatus(error && error.message ? error.message : 'Stock mirror order failed.', 'is-error');
      if (window.OST_OPTIMISTIC) {
        try { window.OST_OPTIMISTIC.balanceHint({ deltaOst: +optimisticStake, source: 'stock-' + state.side, rollback: true, symbol: quote.symbol }); } catch (e) {}
        try { window.OST_OPTIMISTIC.toast(error && error.message ? error.message : 'Stock order failed', 'error'); } catch (e) {}
      }
    } finally {
      state.placing = false;
      renderTicket();
    }
  }

  function bind() {
    var search = $('smSymbolSearch');
    if (search) {
      search.addEventListener('keydown', function(event) {
        if (event.key !== 'Enter') return;
        var next = search.value.toUpperCase().replace(/[^A-Z0-9.,-]/g, '').split(',').filter(Boolean).slice(0, 12);
        if (next.length) {
          state.symbols = Array.from(new Set(next.concat(DEFAULT_SYMBOLS))).slice(0, 18);
          state.selectedSymbol = next[0];
          loadQuotes();
        }
      });
    }
    if ($('smRefresh')) $('smRefresh').addEventListener('click', loadQuotes);
    document.querySelectorAll('[data-stock-sector]').forEach(function(button) {
      button.addEventListener('click', function() {
        document.querySelectorAll('[data-stock-sector]').forEach(function(item) { item.classList.remove('is-active'); });
        button.classList.add('is-active');
        var sector = button.getAttribute('data-stock-sector');
        if (sector === 'tech') state.symbols = ['AAPL', 'MSFT', 'NVDA', 'META', 'GOOGL', 'AMD'];
        else if (sector === 'indexes') state.symbols = ['SPY', 'QQQ', 'DIA'];
        else if (sector === 'value') state.symbols = ['JPM', 'V', 'KO', 'AMZN', 'TSLA'];
        else state.symbols = DEFAULT_SYMBOLS.slice();
        state.selectedSymbol = state.symbols[0];
        loadQuotes();
      });
    });
    document.querySelectorAll('[data-stock-side]').forEach(function(button) {
      button.addEventListener('click', function() {
        state.side = button.getAttribute('data-stock-side') === 'sell' ? 'sell' : 'buy';
        document.querySelectorAll('[data-stock-side]').forEach(function(item) { item.classList.remove('is-active'); });
        button.classList.add('is-active');
        renderTicket();
      });
    });
    document.querySelectorAll('[data-stock-stake]').forEach(function(button) {
      button.addEventListener('click', function() {
        state.ostStake = Number(button.getAttribute('data-stock-stake')) || state.ostStake;
        renderTicket();
      });
    });
    if ($('smOstStake')) $('smOstStake').addEventListener('input', function(event) { state.ostStake = Number(event.target.value) || 0; renderTicket(); });
    if ($('smBrokerCurrency')) $('smBrokerCurrency').addEventListener('change', function(event) { state.brokerCurrency = event.target.value || 'USD'; renderTicket(); });
    if ($('smOrderBtn')) $('smOrderBtn').addEventListener('click', placeOrder);
    window.addEventListener('resize', drawChart);
    window.addEventListener('ost:wallet-changed', function() { renderTicket(); loadOrders(); });
  }

  async function boot() {
    if (!$('stock-market')) return;
    bind();
    renderTicket();
    await loadTopupQuote();
    renderTicket();
    await loadQuotes();
    await loadOrders();
    setInterval(loadQuotes, 60000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();

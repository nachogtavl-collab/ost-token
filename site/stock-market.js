/* OST Stock Market Mirror */
(function () {
  'use strict';

  var DEFAULT_SYMBOLS = ['AAPL', 'MSFT', 'NVDA', 'TSLA', 'AMZN', 'META', 'GOOGL', 'AMD', 'JPM', 'V', 'KO', 'SPY', 'QQQ', 'DIA'];
  var STORAGE_WATCHLIST = 'ost.stock.watchlist.v1';
  var state = {
    symbols: DEFAULT_SYMBOLS.slice(),
    quotes: [],
    selectedSymbol: 'AAPL',
    selectedQuote: null,
    history: [],
    side: 'buy',
    ostStake: 25,
    brokerCurrency: 'USD',
    usdPerOst: 0.01,
    solUsd: 0,
    placing: false,
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
        state.usdPerOst = Number(payload.pricing.usdPerOst || state.usdPerOst) || state.usdPerOst;
        state.solUsd = Number(payload.pricing.solUsd || 0) || 0;
      }
    } catch (error) {}
  }

  async function loadQuotes() {
    var base = apiBase();
    if (!base) {
      setStatus('Stock relay offline: OST API base missing.', 'is-error');
      return;
    }
    setStatus('Loading public stock quotes...');
    try {
      var response = await fetch(base + '/stocks/quotes?symbols=' + encodeURIComponent(state.symbols.join(',')), { cache: 'no-store' });
      var payload = response.ok ? await response.json() : null;
      state.quotes = payload && Array.isArray(payload.quotes) ? payload.quotes : [];
      if (state.quotes.length && !state.quotes.some(function(quote) { return quote.symbol === state.selectedSymbol; })) {
        state.selectedSymbol = state.quotes[0].symbol;
      }
      state.selectedQuote = state.quotes.find(function(quote) { return quote.symbol === state.selectedSymbol; }) || state.quotes[0] || null;
      renderQuotes();
      renderTicket();
      setStatus(state.quotes.length ? 'Live public stock mirror online.' : 'No public quotes returned.', state.quotes.length ? 'is-success' : 'is-error');
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

  async function loadOrders() {
    var base = apiBase();
    var wallet = getWalletAddress();
    if (!base || !wallet) {
      state.orders = [];
      renderOrders();
      return;
    }
    try {
      var response = await fetch(base + '/stocks/orders/' + encodeURIComponent(wallet), { cache: 'no-store' });
      var payload = response.ok ? await response.json() : null;
      state.orders = payload && Array.isArray(payload.orders) ? payload.orders : [];
      renderOrders();
    } catch (error) {}
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
    if ($('smSelectedMeta')) $('smSelectedMeta').textContent = quote.exchange + ' / ' + quote.sector + ' / ' + (quote.asOf || 'public quote');
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
    if (orderButton) orderButton.disabled = state.placing || !quote;
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
    list.innerHTML = state.orders.slice(0, 40).map(function(order) {
      var explorer = order.signature ? 'https://explorer.solana.com/tx/' + encodeURIComponent(order.signature) + '?cluster=devnet' : '';
      return '<div class="stock-position-row">' +
        '<div class="stock-position-top"><strong>' + esc(order.side.toUpperCase()) + ' ' + esc(order.symbol) + '</strong><span>' + esc(fmtMoney(order.notionalUsd)) + '</span></div>' +
        '<div class="stock-position-meta"><span>' + esc(fmtNumber(order.shares, 5)) + ' mirror shares @ ' + esc(fmtMoney(order.price)) + '</span><span>' + esc(fmtNumber(order.ostStake, 2)) + ' OST</span></div>' +
        (explorer ? '<a href="' + explorer + '" target="_blank" rel="noopener">View devnet ticket</a>' : '') +
      '</div>';
    }).join('');
  }

  async function placeOrder() {
    var quote = state.selectedQuote;
    var wallet = getWalletAddress();
    if (!quote) return;
    if (!wallet) {
      setOrderStatus('Connect an OST wallet before placing a stock mirror order.', 'is-error');
      return;
    }
    if (!window.OST_PREDICTION_API || typeof window.OST_PREDICTION_API.placeOrder !== 'function') {
      setOrderStatus('OST settlement vault is still loading. Refresh and try again.', 'is-error');
      return;
    }
    state.placing = true;
    renderTicket();
    setOrderStatus('Routing OST to the mirror settlement vault...');
    try {
      var notionalUsd = calcNotionalUsd();
      var shares = calcShares();
      var ticket = await window.OST_PREDICTION_API.placeOrder({
        source: 'stock-mirror',
        marketId: quote.symbol,
        title: quote.name + ' stock mirror',
        side: state.side === 'sell' ? 'no' : 'yes',
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
      var base = apiBase();
      if (base) {
        await fetch(base + '/stocks/orders', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            wallet: wallet,
            symbol: quote.symbol,
            name: quote.name,
            exchange: quote.exchange,
            sector: quote.sector,
            side: state.side,
            price: quote.price,
            shares: shares,
            notionalUsd: notionalUsd,
            ostStake: Number(state.ostStake || 0),
            brokerCurrency: state.brokerCurrency,
            signature: signature,
            status: 'ost-mirror-open',
            createdAt: Date.now()
          })
        }).catch(function() {});
      }
      setOrderStatus('Stock mirror ticket recorded on OST devnet.', 'is-success');
      await loadOrders();
      try {
        if (typeof window.syncOstWalletEventsFromRemote === 'function') window.syncOstWalletEventsFromRemote();
      } catch (error) {}
    } catch (error) {
      setOrderStatus(error && error.message ? error.message : 'Stock mirror order failed.', 'is-error');
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

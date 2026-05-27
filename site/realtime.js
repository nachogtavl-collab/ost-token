/* OST realtime client: Cloudflare Durable Object WebSocket bridge. */
(function () {
  'use strict';

  var VERSION = '1.0.0';
  var DEFAULT_CHANNELS = ['all', 'price', 'price:btc', 'prediction', 'orderbook', 'faucet', 'game', 'launchpad', 'stock', 'topup'];
  var socket = null;
  var reconnectTimer = null;
  var heartbeatTimer = null;
  var fallbackTimer = null;
  var attempts = 0;
  var lastEventTs = 0;
  var seen = [];
  var currentChannels = [];
  var lastWallet = '';

  function apiBase() {
    return String(window.OST_REALTIME_BASE || window.OST_API_BASE || '').replace(/\/+$/, '');
  }

  function wsEndpoint() {
    var base = String(window.OST_REALTIME_URL || '').trim();
    if (!base) {
      base = apiBase();
      if (!base) return '';
      base = base.replace(/^http:/i, 'ws:').replace(/^https:/i, 'wss:') + '/realtime/v1/ws';
    }
    var url = new URL(base, location.href);
    var wallet = activeWallet();
    if (wallet) url.searchParams.set('wallet', wallet);
    url.searchParams.set('channels', desiredChannels().join(','));
    url.searchParams.set('v', VERSION);
    return url.toString();
  }

  function activeWallet() {
    try {
      if (window.OST_WALLET && window.OST_WALLET.session && window.OST_WALLET.session.publicKey) return window.OST_WALLET.session.publicKey.toBase58();
      if (window.OST_WALLET && window.OST_WALLET.address) return String(window.OST_WALLET.address);
      if (window.OST_CONNECTED_WALLET) return String(window.OST_CONNECTED_WALLET);
      if (window.OST_WALLET_PUBKEY) return String(window.OST_WALLET_PUBKEY);
    } catch (_) {}
    return '';
  }

  function cleanChannel(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9:_./-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  }

  function walletChannel(wallet) {
    return wallet ? 'wallet:' + wallet : '';
  }

  function desiredChannels(extra) {
    var set = Object.create(null);
    DEFAULT_CHANNELS.concat(extra || []).forEach(function (item) {
      var clean = cleanChannel(item);
      if (clean) set[clean] = true;
    });
    var wallet = activeWallet();
    if (wallet) set[walletChannel(wallet)] = true;
    return Object.keys(set).slice(0, 64);
  }

  function dispatch(name, detail) {
    try { window.dispatchEvent(new CustomEvent(name, { detail: detail })); } catch (_) {}
  }

  function remember(id) {
    if (!id) return true;
    if (seen.indexOf(id) >= 0) return false;
    seen.push(id);
    if (seen.length > 260) seen.splice(0, seen.length - 260);
    return true;
  }

  function send(payload) {
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    try { socket.send(JSON.stringify(payload)); return true; } catch (_) { return false; }
  }

  function sendHello() {
    currentChannels = desiredChannels();
    lastWallet = activeWallet();
    send({ type: 'hello', wallet: lastWallet, channels: currentChannels, client: 'ost-site', version: VERSION });
  }

  function scheduleReconnect() {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
    if (reconnectTimer) return;
    var delay = Math.min(30000, 900 + Math.pow(1.7, Math.min(8, attempts)) * 700);
    attempts += 1;
    reconnectTimer = setTimeout(function () {
      reconnectTimer = null;
      connect();
    }, delay);
    startFallback();
  }

  function connect() {
    if (!('WebSocket' in window)) return startFallback();
    var endpoint = wsEndpoint();
    if (!endpoint) return startFallback();
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return socket;
    try {
      socket = new WebSocket(endpoint);
    } catch (_) {
      scheduleReconnect();
      return null;
    }

    socket.addEventListener('open', function () {
      attempts = 0;
      stopFallback();
      sendHello();
      dispatch('ost:realtime-status', { connected: true, channels: currentChannels });
      clearInterval(heartbeatTimer);
      heartbeatTimer = setInterval(function () { send({ type: 'ping', ts: Date.now() }); }, 25000);
    });
    socket.addEventListener('message', function (message) {
      var payload = null;
      try { payload = JSON.parse(message.data); } catch (_) { payload = null; }
      if (!payload) return;
      if (payload.type === 'event' && payload.event) handleEvent(payload.event);
      else if (payload.type === 'realtime.ready' || payload.type === 'subscribed') dispatch('ost:realtime-status', payload);
    });
    socket.addEventListener('close', function () {
      dispatch('ost:realtime-status', { connected: false });
      scheduleReconnect();
    });
    socket.addEventListener('error', function () {
      dispatch('ost:realtime-status', { connected: false, error: true });
      try { socket.close(); } catch (_) {}
    });
    return socket;
  }

  function refreshSubscriptions() {
    var wallet = activeWallet();
    var next = desiredChannels();
    if (wallet === lastWallet && next.join('|') === currentChannels.join('|')) return;
    lastWallet = wallet;
    currentChannels = next;
    if (socket && socket.readyState === WebSocket.OPEN) send({ type: 'hello', wallet: wallet, channels: next });
  }

  function startFallback() {
    if (fallbackTimer || !apiBase()) return;
    fallbackTimer = setInterval(fetchFallbackEvents, 10000);
    fetchFallbackEvents();
  }

  function stopFallback() {
    if (!fallbackTimer) return;
    clearInterval(fallbackTimer);
    fallbackTimer = null;
  }

  function fetchFallbackEvents() {
    var base = apiBase();
    if (!base) return;
    var channel = walletChannel(activeWallet()) || 'all';
    fetch(base + '/realtime/v1/events?limit=80&since=' + encodeURIComponent(lastEventTs || 0) + '&channel=' + encodeURIComponent(channel), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (payload) {
        var events = payload && Array.isArray(payload.events) ? payload.events.slice().reverse() : [];
        if (!events.length && channel !== 'all') {
          return fetch(base + '/realtime/v1/events?limit=40&since=' + encodeURIComponent(lastEventTs || 0) + '&channel=all', { cache: 'no-store' })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (publicPayload) {
              (publicPayload && Array.isArray(publicPayload.events) ? publicPayload.events.slice().reverse() : []).forEach(handleEvent);
            });
        }
        events.forEach(handleEvent);
      })
      .catch(function () {});
  }

  function isOwnWallet(wallet) {
    var own = activeWallet();
    return !!(own && wallet && String(own) === String(wallet));
  }

  function showToast(event) {
    if (!event || event.silent) return;
    if (/^(price|orderbook)\./.test(event.type || '')) return;
    var own = isOwnWallet(event.wallet);
    var publicFaucet = event.type === 'faucet.claim';
    var game = event.type === 'game.result';
    if (!own && !publicFaucet && !game) return;
    var msg = event.message || event.title || event.type || 'OST update';
    try {
      if (window.OST_OPTIMISTIC && typeof window.OST_OPTIMISTIC.toast === 'function') {
        window.OST_OPTIMISTIC.toast(msg, event.severity === 'error' ? 'error' : 'success');
        return;
      }
    } catch (_) {}
    try {
      if (typeof window.toast === 'function') {
        window.toast(own ? 'OK' : 'LIVE', msg);
        return;
      }
    } catch (_) {}
    fallbackToast(msg, event.severity);
  }

  function fallbackToast(message, severity) {
    var host = document.getElementById('ostRealtimeToasts');
    if (!host) {
      host = document.createElement('div');
      host.id = 'ostRealtimeToasts';
      host.style.cssText = 'position:fixed;z-index:2147483000;right:14px;bottom:14px;display:grid;gap:8px;max-width:min(360px,calc(100vw - 28px));pointer-events:none';
      document.body.appendChild(host);
    }
    var item = document.createElement('div');
    item.textContent = String(message || 'OST update');
    item.style.cssText = 'background:rgba(8,12,20,.94);color:#f8fafc;border:1px solid rgba(109,159,255,.35);box-shadow:0 16px 40px rgba(0,0,0,.35);border-radius:8px;padding:10px 12px;font:600 13px/1.35 Inter,system-ui,sans-serif;transform:translateY(8px);opacity:0;transition:opacity .18s ease,transform .18s ease';
    if (severity === 'error') item.style.borderColor = 'rgba(248,113,113,.6)';
    host.appendChild(item);
    requestAnimationFrame(function () { item.style.opacity = '1'; item.style.transform = 'translateY(0)'; });
    setTimeout(function () {
      item.style.opacity = '0';
      item.style.transform = 'translateY(8px)';
      setTimeout(function () { if (item.parentElement) item.remove(); }, 220);
    }, 3600);
  }

  function handlePriceTick(event) {
    var data = event.payload || {};
    var price = Number(event.amount || data.livePrice || data.price);
    var detail = Object.assign({}, data, {
      price: price,
      source: data.livePriceSource || data.source || 'ost-realtime',
      ts: Number(data.livePriceTs || event.ts || Date.now()) || Date.now()
    });
    dispatch('ost:price-tick', detail);
    if (event.token === 'BTC' || (event.marketId && String(event.marketId).indexOf('ost-btc5m-') === 0)) {
      dispatch('ost:btc-spot', detail);
      dispatch('ost:btc-round', data);
    }
  }

  function handleEvent(event) {
    if (!event || !remember(event.id)) return;
    lastEventTs = Math.max(lastEventTs || 0, Number(event.ts || 0) || Date.now());
    dispatch('ost:realtime', event);
    var type = String(event.type || '');
    if (type === 'price.tick') handlePriceTick(event);
    if (type === 'orderbook.update') {
      dispatch('ost:orderbook-update', event);
      if (event.payload && event.payload.marketState) dispatch('ost:native-market-state', { marketId: event.marketId, state: event.payload.marketState });
    }
    if (type.indexOf('prediction.') === 0) {
      dispatch('ost:prediction-update', event);
      dispatch('ost:prediction:order-changed', event);
      try { if (typeof window.syncOstPredictionOrdersFromRemote === 'function') window.syncOstPredictionOrdersFromRemote(); } catch (_) {}
    }
    if (type === 'faucet.claim') {
      dispatch('ost:faucet-claim', event);
      if (event.payload && event.payload.state) dispatch('ost:faucet-state-synced', event.payload.state);
    }
    if (type === 'game.result') dispatch('ost:game-result', event);
    if (/^(wallet|transaction|topup|payout)\./.test(type) || type === 'wallet.event') {
      dispatch('ost:transaction-alert', event);
      dispatch('ost:wallet-changed', event);
      try { if (typeof window.syncOstWalletEventsFromRemote === 'function') window.syncOstWalletEventsFromRemote(); } catch (_) {}
    }
    showToast(event);
  }

  function publish(event) {
    var base = apiBase();
    if (!base || !event) return Promise.resolve(false);
    return fetch(base + '/realtime/v1/publish', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ event: event }),
      cache: 'no-store'
    }).then(function (response) { return response.ok ? response.json() : false; }).catch(function () { return false; });
  }

  window.addEventListener('ost:wallet-changed', refreshSubscriptions);
  window.addEventListener('focus', refreshSubscriptions);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) refreshSubscriptions(); });

  window.addEventListener('ost:fair-game-settled', function (ev) {
    var d = ev.detail || {};
    var own = d.ownWallet || activeWallet();
    var channels = ['all', 'game'];
    if (d.game) channels.push('game:' + cleanChannel(d.game));
    if (own) channels.push(walletChannel(own));
    if (d.peerWallet) channels.push(walletChannel(d.peerWallet));
    publish({
      id: d.id ? 'game:' + d.id + ':' + (d.didWin ? 'win' : 'loss') : undefined,
      type: 'game.result',
      public: true,
      channels: channels,
      wallet: own,
      gameId: d.game || '',
      amount: d.stake && d.stake.amount,
      token: (d.stake && d.stake.asset) || 'OST',
      title: d.gameLabel || 'Fair game result',
      message: (d.didWin ? 'Won ' : 'Lost ') + (d.gameLabel || d.game || 'fair game'),
      payload: d
    });
  });

  window.OST_REALTIME = {
    connect: connect,
    publish: publish,
    subscribe: function (channels) { currentChannels = desiredChannels(channels); send({ type: 'subscribe', channels: currentChannels }); },
    channels: function () { return currentChannels.slice(); },
    connected: function () { return !!(socket && socket.readyState === WebSocket.OPEN); },
    version: VERSION
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', connect, { once: true });
  else connect();
  setInterval(refreshSubscriptions, 5000);
})();
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
  var lastPredictionSyncAt = 0;   // NET-3: own-wallet prediction syncs, ≤ 1 per 30 s
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
      // C1: OST_WALLET.pubkey() is the base58 address (or null).
      if (window.OST_WALLET && typeof window.OST_WALLET.pubkey === 'function') { var pk = window.OST_WALLET.pubkey(); if (pk) return String(pk); }
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

  // ---- own echoes (NET-3 / MK-PHANTOM-RECV) ---------------------------------
  // Every POST /wallet/events and POST /positions this browser makes comes back
  // on the wallet channel as a 'transaction.alert'. Fanning that echo out as
  // ost:wallet-changed + an events re-sync re-read every wallet module (~13
  // worker + 3 RPC requests) for something this browser already knows — and a
  // phantom balance event turned that into a once-a-minute loop. An echo whose
  // record is already in this browser's own store is NOT news: it still
  // reaches the live-feed listeners (ost:realtime / ost:transaction-alert), but
  // triggers no refresh. Echoes of things done elsewhere (another device, the
  // server) still refresh as before.
  function readLocalJson(key) {
    try { var v = JSON.parse(localStorage.getItem(key) || 'null'); return Array.isArray(v) ? v : []; } catch (_) { return []; }
  }
  // An id that carries something: not empty and not just the separators of an
  // empty composite (':::' from a blank row must never match anything).
  function meaningfulId(v) { return !!v && /[^:\s]/.test(String(v)); }
  function snapshotKeys(s) {
    if (!s) return [];
    var out = [s.id, s.eventId, s.sig, s.signature].filter(meaningfulId).map(String);
    // The id a POST /wallet/events gets when the snapshot had none (wallet-extras
    // eventKey) — only for a row that has a kind and a time.
    if (s.kind && s.ts) out.push([s.kind || '', s.ts || '', s.amount || '', s.token || s.game || s.marketId || ''].join(':'));
    return out;
  }
  function isClosedRecord(r) {
    var st = String((r && (r.status || r.outcome)) || '').toLowerCase();
    return !!(r && (r.cashedOut || /^(sold|settled|won|lost|refunded|paid|closed)$/.test(st)));
  }
  function knownEcho(event) {
    try {
      if (!event || !isOwnWallet(event.wallet)) return false;
      var rec = event.payload && event.payload.record;
      if (!rec || typeof rec !== 'object') return false;
      if (rec.kind) {
        // A wallet activity row: the same row is already in this browser's snapshot store.
        var ids = [rec.id, rec.eventId, rec.sig, rec.signature].filter(meaningfulId).map(String);
        if (!ids.length) return false;
        var snaps = readLocalJson('ost.wallet.balanceHistory.v1');
        for (var i = snaps.length - 1; i >= 0 && i >= snaps.length - 400; i--) {
          var ks = snapshotKeys(snaps[i]);
          for (var j = 0; j < ids.length; j++) if (ks.indexOf(ids[j]) >= 0) return true;
        }
        return false;
      }
      if (rec.marketId) {
        // A prediction ticket echo: known when this browser holds the same
        // ticket in the same open/closed state (a sale made on another device
        // is still news and refreshes).
        var key = String(rec.signature || rec.sig || rec.id || '');
        if (!key) return false;
        var orders = readLocalJson('ost.prediction.orders.v1');
        for (var k = 0; k < orders.length; k++) {
          var o = orders[k]; if (!o) continue;
          var ok = [o.signature, o.sig, o.id, o.serverPositionId, o.reference].filter(Boolean).map(String);
          if (ok.indexOf(key) >= 0) return isClosedRecord(o) === isClosedRecord(rec);
        }
      }
    } catch (_) {}
    return false;
  }

  // ---- faucet claim echo (J-12 / one claim = one success notice) ----------
  // The tab that ran the claim reports the result itself (app.js: one card,
  // id faucet-<wallet8>, "100 OST arrived · tx …"), and the echo usually lands
  // ~0.3 s BEFORE that result. So the echo waits 4 s and stays silent when this
  // tab's own claim flow reported a success (its ost:wallet-tx {source:faucet},
  // or the own-money marker app.js sets on success). Otherwise — a claim made
  // in another tab or on another device, or this tab's claim ended "couldn't
  // confirm yet" — it shows ONCE, in that SAME faucet card, so a claim can
  // never stack two success cards.
  var lastOwnFaucetTxAt = 0;
  window.addEventListener('ost:wallet-tx', function (e) {
    var d = e && e.detail;
    if (d && /faucet/i.test(String(d.source || '')) && String(d.status || 'confirmed') === 'confirmed') lastOwnFaucetTxAt = Date.now();
  });
  function faucetEcho(event) {
    var wallet = String(event.wallet || '');
    var mark = Date.now();
    // SRV-A1(b): every tab of this wallet now knows the balance rise that
    // follows is its own claim, not an incoming transfer — the app.js receive
    // detector used to log it as a sig-less 'recv-ost' (+100 OST twice).
    try { if (!(Number(window.__ostLastOwnMoneyTxAt) > mark)) window.__ostLastOwnMoneyTxAt = mark; } catch (_) {}
    // A replayed old event (fallback poll after a reconnect) is not news.
    if (mark - (Number(event.ts) || mark) > 120000) return;
    var msg = event.message || event.title || 'Faucet claim confirmed';
    // The worker names the card its claim belongs to (payload.notifyId =
    // 'faucet-<wallet8>', the same id app.js's claim flow uses). Only a faucet
    // card id is accepted; anything else falls back to the derived one.
    var pid = String((event.payload && event.payload.notifyId) || '');
    var nid = /^faucet-[1-9A-HJ-NP-Za-km-z]{1,16}$/.test(pid) ? pid : 'faucet-' + wallet.slice(0, 8);
    setTimeout(function () {
      var now = Date.now();
      if (now - lastOwnFaucetTxAt < 120000) return;                         // this tab reported its own success
      if ((Number(window.__ostLastOwnMoneyTxAt) || 0) > mark) return;       // app.js success marker, set after this echo
      try {
        if (typeof window.OST_NOTIFY === 'function') {
          window.OST_NOTIFY({ id: nid, kind: 'ok', title: msg, body: 'Free devnet OST is in your wallet.', sig: (event.payload && event.payload.signature) || undefined });
          return;
        }
      } catch (_) {}
      try { if (window.OST_OPTIMISTIC && typeof window.OST_OPTIMISTIC.toast === 'function') window.OST_OPTIMISTIC.toast(msg, 'success'); } catch (_) {}
    }, 4000);
  }

  function showToast(event) {
    if (!event || event.silent) return;
    if (/^(price|orderbook)\./.test(event.type || '')) return;
    var own = isOwnWallet(event.wallet);
    // ONLY the user's own events pop a notification. Other people's public
    // faucet claims / game results still reach the live-feed UI via their
    // ost:* events (dispatched above), but must NOT pop a toast for every
    // user — a room full of testers/bots turned that into a non-stop stream
    // of "LIVE" cards that made the app unusable.
    if (!own) return;
    // ONE NOTIFICATION POLICY. The user's own action already produced feedback in
    // the UI (button state + one notice). The realtime echoes of that same
    // action — faucet.claim, wallet.event, transaction.alert — produced 3 more
    // toasts per action. Only surface things the user did NOT just do
    // themselves (incoming transfers, top-ups, errors). A faucet claim echo is
    // handled by faucetEcho (shown only for a claim made elsewhere, merged into
    // the faucet card).
    var _t = String(event.type || '');
    if (/^faucet\.claim/.test(_t)) return;
    if (event.severity !== 'error' && !/^(topup\.|transfer\.received|payment\.received)/.test(_t)) return;
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

  var fbTimes = [];       // shown timestamps (rolling window)
  var fbLast = {};        // message -> last shown ts (dedup)
  function fallbackToast(message, severity) {
    // Anti-spam guard: dedup identical messages within 4s, cap 4 per 4s.
    var now = Date.now();
    var key = String(message == null ? '' : message).slice(0, 120);
    if (fbLast[key] && now - fbLast[key] < 4000) return;
    fbTimes = fbTimes.filter(function (t) { return now - t < 4000; });
    if (fbTimes.length >= 4) return;
    fbTimes.push(now); fbLast[key] = now;
    if (Object.keys(fbLast).length > 120) fbLast = {};
    var host = document.getElementById('ostRealtimeToasts');
    if (!host) {
      host = document.createElement('div');
      host.id = 'ostRealtimeToasts';
      host.style.cssText = 'position:fixed;z-index:2147483000;right:14px;bottom:14px;display:grid;gap:8px;max-width:min(360px,calc(100vw - 28px));pointer-events:none';
      document.body.appendChild(host);
    }
    // Never let more than 3 stack on screen.
    while (host.children.length >= 3) { try { host.removeChild(host.firstElementChild); } catch (_) { break; } }
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
      // Stamp the SETTLEMENT feed so the browser's own backup feed (Pyth/exchanges,
      // tens of dollars away) stays off 'ost:btc-spot' while this one is live.
      try { window.__ostSettlementTickAt = Date.now(); } catch (_) {}
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
      // 'order-changed' means "MY tickets changed": another wallet's public
      // fill never re-renders every ticket surface and refetches every feed
      // (NET-3). A round resolution can settle my tickets, so it still does.
      if (isOwnWallet(event.wallet) || type === 'prediction.resolved') dispatch('ost:prediction:order-changed', event);
      // NET-3: every public prediction.* event used to make EVERY open tab GET
      // /positions and re-POST its orders (each POST published another public
      // event — an amplifier). Only THIS wallet's own events trigger a sync, and
      // at most once per 30 s (app.js also throttles to 1/60 s unless forced).
      if (isOwnWallet(event.wallet) && Date.now() - lastPredictionSyncAt >= 30000) {
        lastPredictionSyncAt = Date.now();
        try { if (typeof window.syncOstPredictionOrdersFromRemote === 'function') window.syncOstPredictionOrdersFromRemote(); } catch (_) {}
      }
    }
    if (type === 'faucet.claim') {
      dispatch('ost:faucet-claim', event);
      if (event.payload && event.payload.state) dispatch('ost:faucet-state-synced', event.payload.state);
      if (isOwnWallet(event.wallet) && !event.silent) faucetEcho(event);
    }
    if (type === 'game.result') dispatch('ost:game-result', event);
    if (/^(wallet|transaction|topup|payout)\./.test(type) || type === 'wallet.event') {
      dispatch('ost:transaction-alert', event);
      // NET-3: an echo of a record this browser already holds refreshes nothing.
      if (!knownEcho(event)) {
        dispatch('ost:wallet-changed', event);
        try { if (typeof window.syncOstWalletEventsFromRemote === 'function') window.syncOstWalletEventsFromRemote(); } catch (_) {}
      }
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
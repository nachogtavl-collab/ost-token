/* ============================================================
   mesh/mesh-games.js  -  OST Mesh Casual Games Orchestrator
   Adds non-staked, peer-encrypted casual games beside Arena's
   fair-games tab WITHOUT touching fair-games logic.
   - Provides invite / accept handshake over Mesh app payloads.
   - Exposes a registry so each game module is self-contained.
   - Mounts a full-screen overlay surface for the active game.
   - Registers a launcher card inside the Arena Games pane.
   Public API:
     window.OST_MESH_GAMES = {
       open(name?, opts?), close(), invite(name, contact),
       available(), register(name, factory),
       _send, _hostFlag, _seed, _list
     }
   App-payload envelope:
     { app:'ost-mesh-games', type:<event>, gameId, seq, payload }
   ============================================================ */
(function () {
  'use strict';

  var APP_KEY = 'ost-mesh-games';
  var OVERLAY_ID = 'ost-mesh-games-overlay';
  var LAUNCHER_ID = 'ost-mesh-games-launcher';
  var STYLE_ID = 'ost-mesh-games-style';

  var REGISTRY = Object.create(null);   // name -> { factory, label, blurb, icon, requires3D }
  var ORDER = [];

  var session = null;
  // session: { name, gameId, host, seed, peer, instance, overlay, statusEl, contentEl }

  // --------------------------------------------------------- styles
  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var css = ''
      + '#' + LAUNCHER_ID + '{display:grid;gap:8px;margin-top:10px;padding:10px;border:1px solid rgba(255,255,255,.1);border-radius:14px;background:rgba(255,255,255,.04)}'
      + '#' + LAUNCHER_ID + ' .omg-title{display:flex;align-items:center;justify-content:space-between;gap:8px;color:#cdfaff;font-size:12px;font-weight:700}'
      + '#' + LAUNCHER_ID + ' .omg-title small{color:#8db5c8;font-weight:500;font-size:10px}'
      + '#' + LAUNCHER_ID + ' .omg-tiles{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:6px}'
      + '@media(max-width:640px){#' + LAUNCHER_ID + ' .omg-tiles{grid-template-columns:repeat(2,minmax(0,1fr))}}'
      + '#' + LAUNCHER_ID + ' .omg-tile{background:linear-gradient(135deg,rgba(0,212,255,.18),rgba(0,255,159,.12));border:1px solid rgba(94,234,212,.22);color:#e8fbff;border-radius:12px;padding:10px;text-align:left;cursor:pointer;display:grid;gap:4px;font-family:inherit;min-height:78px}'
      + '#' + LAUNCHER_ID + ' .omg-tile strong{font-size:13px;color:#fff}'
      + '#' + LAUNCHER_ID + ' .omg-tile span{font-size:10px;color:#bfe7f5;line-height:1.3}'
      + '#' + LAUNCHER_ID + ' .omg-tile em{font-style:normal;font-size:18px}'
      + '#' + OVERLAY_ID + '{position:fixed;inset:0;z-index:99999;background:rgba(2,8,16,.94);display:none;flex-direction:column;color:#e8fbff;font-family:inherit}'
      + '#' + OVERLAY_ID + '.is-open{display:flex}'
      + '#' + OVERLAY_ID + ' .omg-bar{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 14px;border-bottom:1px solid rgba(255,255,255,.08);background:linear-gradient(180deg,#021726,#020c14)}'
      + '#' + OVERLAY_ID + ' .omg-bar strong{font-size:14px;color:#fff}'
      + '#' + OVERLAY_ID + ' .omg-bar .omg-status{flex:1;color:#9bcbe6;font-size:11px;text-align:center}'
      + '#' + OVERLAY_ID + ' .omg-bar button{background:rgba(255,255,255,.08);color:#e8fbff;border:1px solid rgba(255,255,255,.18);border-radius:10px;padding:7px 12px;cursor:pointer;font-weight:700;font-size:12px}'
      + '#' + OVERLAY_ID + ' .omg-bar button.primary{background:linear-gradient(135deg,#00d4ff,#00ff9f);color:#02111c;border-color:transparent}'
      + '#' + OVERLAY_ID + ' .omg-body{flex:1;overflow:auto;padding:14px;display:flex;align-items:center;justify-content:center}'
      + '#' + OVERLAY_ID + ' .omg-stage{width:100%;max-width:900px;display:grid;gap:10px}'
      + '#' + OVERLAY_ID + ' .omg-invite{display:grid;gap:10px;padding:18px;border:1px solid rgba(94,234,212,.22);border-radius:16px;background:rgba(255,255,255,.04);max-width:480px;margin:auto}'
      + '#' + OVERLAY_ID + ' .omg-invite h3{margin:0;color:#fff;font-size:18px}'
      + '#' + OVERLAY_ID + ' .omg-invite p{margin:0;color:#bfe7f5;font-size:12px;line-height:1.45}'
      + '#' + OVERLAY_ID + ' .omg-invite .omg-row{display:flex;gap:8px;flex-wrap:wrap}'
      + '#' + OVERLAY_ID + ' .omg-invite .omg-row button{flex:1;min-width:120px}';
    var el = document.createElement('style');
    el.id = STYLE_ID;
    el.textContent = css;
    document.head.appendChild(el);
  }

  // --------------------------------------------------------- helpers
  function nowMs() { return Date.now(); }
  function uid() { return 'g' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4); }
  function makeSeed() {
    var out = '';
    for (var i = 0; i < 4; i++) out += Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0');
    return out;
  }
  // Mulberry32 PRNG, deterministic from seed integer.
  function makePRNG(seedHex) {
    var s = 0;
    for (var i = 0; i < seedHex.length; i++) s = (s * 31 + seedHex.charCodeAt(i)) >>> 0;
    return function () {
      s = (s + 0x6D2B79F5) >>> 0;
      var t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function pavilion() {
    try {
      if (window.OST_MESH && window.OST_MESH.pavilion) return window.OST_MESH.pavilion;
    } catch (_) {}
    return null;
  }

  function peerHandle() {
    var p = pavilion();
    if (!p) return null;
    // Pavilion exposes sendAppPayloadReliable + a peer reference. Match pattern from mesh-play.
    return p;
  }

  function sendEnvelope(type, payload) {
    if (!session) return false;
    var p = peerHandle();
    if (!p) return false;
    var env = {
      app: APP_KEY,
      type: String(type || ''),
      gameId: session.gameId,
      seq: ++session.seqOut,
      ts: nowMs(),
      payload: payload || null
    };
    try {
      if (typeof p.sendAppPayloadReliable === 'function') return !!p.sendAppPayloadReliable(env);
      if (typeof p.sendAppPayload === 'function') return !!p.sendAppPayload(env);
      if (typeof p.send === 'function') { p.send(JSON.stringify(env)); return true; }
    } catch (e) {
      console.warn('[OST_MESH_GAMES] send failed', e);
    }
    return false;
  }

  // --------------------------------------------------------- overlay UI
  function buildOverlay() {
    var existing = document.getElementById(OVERLAY_ID);
    if (existing) return existing;
    var ov = document.createElement('div');
    ov.id = OVERLAY_ID;
    ov.innerHTML = ''
      + '<div class="omg-bar">'
      +   '<strong id="omgTitle">Casual Games</strong>'
      +   '<div class="omg-status" id="omgStatus">Pick a game to play with a connected peer.</div>'
      +   '<button type="button" id="omgClose">Close</button>'
      + '</div>'
      + '<div class="omg-body"><div class="omg-stage" id="omgStage"></div></div>';
    document.body.appendChild(ov);
    ov.querySelector('#omgClose').onclick = closeOverlay;
    return ov;
  }

  function setStatus(text) {
    var el = document.getElementById('omgStatus');
    if (el) el.textContent = String(text || '');
  }

  function setTitle(text) {
    var el = document.getElementById('omgTitle');
    if (el) el.textContent = String(text || 'Casual Games');
  }

  function clearStage() {
    var stage = document.getElementById('omgStage');
    if (stage) stage.innerHTML = '';
    return stage;
  }

  function showLauncher() {
    setTitle('Casual Games');
    setStatus('Pick a game to play with a connected peer.');
    var stage = clearStage();
    if (!stage) return;
    var grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px';
    if (window.matchMedia && window.matchMedia('(max-width:640px)').matches) {
      grid.style.gridTemplateColumns = 'repeat(2,minmax(0,1fr))';
    }
    ORDER.forEach(function (name) {
      var meta = REGISTRY[name];
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.style.cssText = 'background:linear-gradient(135deg,rgba(0,212,255,.2),rgba(0,255,159,.14));border:1px solid rgba(94,234,212,.25);color:#e8fbff;border-radius:14px;padding:14px;text-align:left;cursor:pointer;display:grid;gap:6px;font:inherit;min-height:120px';
      btn.innerHTML = '<em style="font-style:normal;font-size:24px">' + (meta.icon || '🎮') + '</em>'
        + '<strong style="color:#fff;font-size:14px">' + meta.label + '</strong>'
        + '<span style="color:#bfe7f5;font-size:11px;line-height:1.3">' + meta.blurb + '</span>';
      btn.onclick = function () { startGame(name); };
      grid.appendChild(btn);
    });
    stage.appendChild(grid);
  }

  function startGame(name) {
    var meta = REGISTRY[name];
    if (!meta) { setStatus('Unknown game: ' + name); return; }
    var p = peerHandle();
    var hasPeer = !!(p && (p.sessionKey || p.connected));
    setTitle(meta.label);
    if (!hasPeer) {
      promptInvite(name);
      return;
    }
    // We are the host: roll a seed and invite peer.
    var gameId = uid();
    var seed = makeSeed();
    closeSession();
    session = {
      name: name,
      gameId: gameId,
      host: true,
      seed: seed,
      seqOut: 0,
      handlers: null,
      meta: meta,
      pendingAccept: true
    };
    setStatus('Inviting peer to ' + meta.label + '...');
    sendEnvelope('invite', { name: name, seed: seed, gameId: gameId, label: meta.label });
    showWaitingScreen('Waiting for peer to accept ' + meta.label + '...');
  }

  function promptInvite(name) {
    var meta = REGISTRY[name];
    var stage = clearStage();
    if (!stage) return;
    var box = document.createElement('div');
    box.className = 'omg-invite';
    box.innerHTML = '<h3>' + (meta.icon || '🎮') + ' ' + meta.label + '</h3>'
      + '<p>You need a connected Mesh peer to play. Open OST Mesh, connect, then come back.</p>'
      + '<div class="omg-row">'
      +   '<button type="button" class="primary" id="omgGotoMesh">Open OST Mesh</button>'
      +   '<button type="button" id="omgBack">Back</button>'
      + '</div>';
    stage.appendChild(box);
    box.querySelector('#omgGotoMesh').onclick = function () {
      try { if (window.OST_MESH && window.OST_MESH.open) window.OST_MESH.open(); } catch (_) {}
    };
    box.querySelector('#omgBack').onclick = showLauncher;
  }

  function showWaitingScreen(text) {
    var stage = clearStage();
    if (!stage) return;
    var box = document.createElement('div');
    box.className = 'omg-invite';
    box.innerHTML = '<h3>Hold tight</h3><p>' + String(text || '') + '</p>'
      + '<div class="omg-row"><button type="button" class="primary" id="omgCancelInvite">Cancel</button></div>';
    stage.appendChild(box);
    box.querySelector('#omgCancelInvite').onclick = function () {
      if (session && session.gameId) sendEnvelope('cancel', null);
      closeSession();
      showLauncher();
    };
  }

  function showAcceptScreen(payload) {
    setTitle(payload.label || 'Casual Game');
    setStatus('Peer invited you to play.');
    var stage = clearStage();
    if (!stage) return;
    var box = document.createElement('div');
    box.className = 'omg-invite';
    box.innerHTML = '<h3>' + (payload.label || 'Casual Game') + ' invite</h3>'
      + '<p>Your peer wants to play. No stakes, just for fun.</p>'
      + '<div class="omg-row">'
      +   '<button type="button" class="primary" id="omgAccept">Accept</button>'
      +   '<button type="button" id="omgDecline">Decline</button>'
      + '</div>';
    stage.appendChild(box);
    box.querySelector('#omgAccept').onclick = function () {
      // Initialise as guest with the host's seed/gameId.
      closeSession();
      var meta = REGISTRY[payload.name];
      if (!meta) { setStatus('Game module not loaded.'); return; }
      session = {
        name: payload.name,
        gameId: payload.gameId,
        host: false,
        seed: payload.seed,
        seqOut: 0,
        handlers: null,
        meta: meta
      };
      sendEnvelope('accept', null);
      mountInstance();
    };
    box.querySelector('#omgDecline').onclick = function () {
      sendEnvelope('decline', null);
      closeSession();
      showLauncher();
    };
  }

  function mountInstance() {
    if (!session) return;
    var meta = session.meta;
    if (!meta) return;
    setTitle(meta.label);
    setStatus(session.host ? 'You are host. ' + meta.label : 'You joined ' + meta.label + '.');
    var stage = clearStage();
    if (!stage) return;
    var rng = makePRNG(session.seed || 'seed');
    var ctx = {
      gameId: session.gameId,
      host: session.host,
      seed: session.seed,
      rng: rng,
      mount: stage,
      send: function (type, payload) { return sendEnvelope('m:' + type, payload); },
      setStatus: setStatus,
      end: function (note) {
        sendEnvelope('end', { note: note || null });
        closeSession();
        showLauncher();
      }
    };
    try {
      var inst = meta.factory(ctx);
      session.handlers = inst || null;
    } catch (err) {
      console.error('[OST_MESH_GAMES] factory error', err);
      stage.innerHTML = '<div class="omg-invite"><h3>Failed to start</h3><p>' + (err && err.message ? err.message : 'Unknown error') + '</p></div>';
    }
  }

  // --------------------------------------------------------- payload routing
  function routeEnvelope(env, fromPeer) {
    if (!env || env.app !== APP_KEY) return;
    if (env.type === 'invite') {
      if (session) {
        // Already in a session — refuse silently.
        sendEnvelopeRaw('decline', env.gameId);
        return;
      }
      ensureOpen();
      showAcceptScreen(env.payload || {});
      return;
    }
    if (!session || env.gameId !== session.gameId) return;
    if (env.type === 'accept') {
      session.pendingAccept = false;
      mountInstance();
      return;
    }
    if (env.type === 'decline' || env.type === 'cancel') {
      setStatus('Peer left the game.');
      closeSession();
      showLauncher();
      return;
    }
    if (env.type === 'end') {
      setStatus('Game ended by peer.');
      closeSession();
      showLauncher();
      return;
    }
    if (env.type && env.type.indexOf('m:') === 0) {
      var sub = env.type.slice(2);
      if (session.handlers && typeof session.handlers.onPayload === 'function') {
        try { session.handlers.onPayload(sub, env.payload, env); }
        catch (e) { console.warn('[OST_MESH_GAMES] handler error', e); }
      }
    }
  }

  function sendEnvelopeRaw(type, gameId) {
    var p = peerHandle(); if (!p) return false;
    var env = { app: APP_KEY, type: type, gameId: gameId, seq: 0, ts: nowMs(), payload: null };
    try {
      if (typeof p.sendAppPayloadReliable === 'function') return !!p.sendAppPayloadReliable(env);
      if (typeof p.sendAppPayload === 'function') return !!p.sendAppPayload(env);
    } catch (_) {}
    return false;
  }

  function closeSession() {
    if (session && session.handlers && typeof session.handlers.dispose === 'function') {
      try { session.handlers.dispose(); } catch (_) {}
    }
    session = null;
  }

  // --------------------------------------------------------- public open/close
  function ensureOpen() {
    injectStyle();
    var ov = buildOverlay();
    ov.classList.add('is-open');
  }

  function open(name, opts) {
    ensureOpen();
    if (name && REGISTRY[name]) { startGame(name); return; }
    showLauncher();
  }

  function closeOverlay() {
    if (session) {
      try { sendEnvelope('end', null); } catch (_) {}
      closeSession();
    }
    var ov = document.getElementById(OVERLAY_ID);
    if (ov) ov.classList.remove('is-open');
  }

  // --------------------------------------------------------- launcher card inside Arena
  function mountLauncherCard() {
    var pane = document.querySelector('[data-oma-pane="games"]');
    if (!pane) {
      window.setTimeout(mountLauncherCard, 600);
      return;
    }
    if (document.getElementById(LAUNCHER_ID)) return;
    injectStyle();
    var card = document.createElement('div');
    card.id = LAUNCHER_ID;
    card.innerHTML = '<div class="omg-title">Casual games <small>No stakes &middot; play with a Mesh peer</small></div><div class="omg-tiles" id="omgTiles"></div>';
    pane.appendChild(card);
    refreshLauncherTiles();
  }

  function refreshLauncherTiles() {
    var tiles = document.getElementById('omgTiles');
    if (!tiles) return;
    tiles.innerHTML = '';
    ORDER.forEach(function (name) {
      var meta = REGISTRY[name];
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'omg-tile';
      btn.innerHTML = '<em>' + (meta.icon || '🎮') + '</em><strong>' + meta.label + '</strong><span>' + meta.blurb + '</span>';
      btn.onclick = function () { open(name); };
      tiles.appendChild(btn);
    });
  }

  // --------------------------------------------------------- registry API
  function register(name, meta) {
    if (!name || !meta || typeof meta.factory !== 'function') return false;
    REGISTRY[name] = {
      factory: meta.factory,
      label: meta.label || name,
      blurb: meta.blurb || '',
      icon: meta.icon || '🎮',
      requires3D: !!meta.requires3D
    };
    if (ORDER.indexOf(name) === -1) ORDER.push(name);
    refreshLauncherTiles();
    return true;
  }

  // --------------------------------------------------------- listen for app payloads
  function listenForPayloads() {
    document.addEventListener('ost:mesh-payload', function (ev) {
      var detail = ev && ev.detail;
      if (!detail) return;
      var env = detail.payload || detail.envelope || detail.body || detail;
      if (env && env.app === APP_KEY) routeEnvelope(env, detail.peer || null);
    }, false);
    window.addEventListener('ost:mesh-payload', function (ev) {
      var detail = ev && ev.detail;
      if (!detail) return;
      var env = detail.payload || detail.envelope || detail.body || detail;
      if (env && env.app === APP_KEY) routeEnvelope(env, detail.peer || null);
    }, false);
    // Also hook directly into pavilion if it exposes onAppPayload (best-effort).
    var tries = 0;
    function hook() {
      tries++;
      var p = pavilion();
      if (p && typeof p.onAppPayload === 'function' && !p.__omgHooked) {
        try {
          p.onAppPayload(function (env) { if (env && env.app === APP_KEY) routeEnvelope(env, null); });
          p.__omgHooked = true;
          return;
        } catch (_) {}
      }
      if (tries < 30) window.setTimeout(hook, 800);
    }
    hook();
  }

  // --------------------------------------------------------- public surface
  window.OST_MESH_GAMES = {
    open: open,
    close: closeOverlay,
    invite: function (name, contact) {
      open(name);
      if (contact && contact.address && window.OST_MESH_ARENA && typeof window.OST_MESH_ARENA.setKnownPeerWallet === 'function') {
        try { window.OST_MESH_ARENA.setKnownPeerWallet(contact.wallet || contact.address); } catch (_) {}
      }
      return true;
    },
    available: function () { return ORDER.slice(); },
    register: register,
    _route: routeEnvelope,
    _send: sendEnvelope
  };

  // --------------------------------------------------------- boot
  function boot() {
    listenForPayloads();
    mountLauncherCard();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();

})();

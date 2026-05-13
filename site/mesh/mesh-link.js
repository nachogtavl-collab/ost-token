/* ============================================================
   mesh/mesh-link.js  -  OST cross-service linker
   Eliminates dead-end navigation between Wallet, Mesh, Arena,
   Ghost, Predictions, Launchpad, Stock, Offline, Shop, Code
   Academy, Nuevo Laredo Gas, and Interchange Live by exposing:
     - hash aliases (#mesh, #arena, #ghost, #predictions, ...)
     - delegated  [data-ost-link="<target>"]  click handler
     - delegated  [data-ost-share="<kind>"]   click handler
     - window.OST_LINK { go, share, available }
   Pure additive layer; never blocks existing handlers.
   Marker: OST_LINK_HUB
   ============================================================ */
(function () {
  'use strict';

  // ----------------------------------------------------------- helpers
  function activateCompartment(id) {
    if (!id) return false;
    if (window.OST_COMPARTMENTS && typeof window.OST_COMPARTMENTS.activate === 'function') {
      try { window.OST_COMPARTMENTS.activate(id, true); return true; }
      catch (_) {}
    }
    try { location.hash = '#' + id; return true; }
    catch (_) { return false; }
  }

  function clickTab(selector, delay) {
    window.setTimeout(function () {
      var node = document.querySelector(selector);
      if (node && typeof node.click === 'function') node.click();
    }, delay || 220);
  }

  function openMesh() {
    if (window.OST_MESH && typeof window.OST_MESH.open === 'function') {
      window.OST_MESH.open();
      return true;
    }
    return false;
  }

  function openArena(tab, game) {
    var arena = window.OST_MESH_ARENA;
    if (arena && typeof arena.open === 'function') {
      arena.open(game || null);
      if (tab && typeof arena.focus === 'function' && (tab === 'games')) arena.focus(game || null);
      // Cross-tab focus is otherwise handled by Arena UI itself.
      return true;
    }
    return openMesh();
  }

  function openGhost() {
    if (window.OST_GHOST && typeof window.OST_GHOST.open === 'function') {
      window.OST_GHOST.open();
      return true;
    }
    return false;
  }

  function openWallet(panel) {
    activateCompartment('wallet');
    if (panel) clickTab('[data-wallet-tab="' + panel + '"], [data-wallet-panel-target="' + panel + '"]', 240);
    return true;
  }

  function openCommerce(tab) {
    activateCompartment('commerce');
    if (tab) clickTab('[data-store-tab="' + tab + '"], [data-tab="' + tab + '"]', 240);
    return true;
  }

  // ----------------------------------------------------------- target table
  // target string -> handler
  var TARGETS = {
    // Mesh family
    'mesh':         function () { return openMesh(); },
    'arena':        function () { return openArena(); },
    'mesh-arena':   function () { return openArena(); },
    'fair-games':   function () { return openArena('games'); },
    // Ghost
    'ghost':        function () { return openGhost(); },
    // Wallet panels
    'wallet':       function () { return openWallet(); },
    'wallet:access':  function () { return openWallet('access'); },
    'wallet:convert': function () { return openWallet('convert'); },
    'wallet:market':  function () { return openWallet('market'); },
    'wallet:portals': function () { return openWallet('portals'); },
    'predictions':   function () { return openWallet('market'); },
    'convert':       function () { return openWallet('convert'); },
    'bridge':        function () { return openWallet('portals'); },
    'stock':         function () { return openWallet('market'); },
    // Standalone compartments
    'launchpad':     function () { return activateCompartment('launchpad'); },
    'offline':       function () { return activateCompartment('offline'); },
    'survival':      function () { return activateCompartment('survival'); },
    'citizens':      function () { return activateCompartment('citizens'); },
    'transparency':  function () { return activateCompartment('transparency'); },
    'home':          function () { return activateCompartment('home'); },
    'new-here':      function () { return activateCompartment('new-here'); },
    // Commerce sub-areas (ids inside #commerce)
    'shop':          function () { return openCommerce('shop'); },
    'giftcards':     function () { return openCommerce('giftcards'); },
    'gas':           function () { return openCommerce('fuel'); },
    'fuel':          function () { return openCommerce('fuel'); },
    'interchange':   function () { return openCommerce('interchange'); },
    // Code Academy (panel injected by code-academy.js)
    'academy':       function () {
      if (typeof window.OST_OPEN_CODE_ACADEMY === 'function') { window.OST_OPEN_CODE_ACADEMY(); return true; }
      return activateCompartment('build');
    }
  };

  // Hash -> target (we intentionally allow synonyms)
  var HASH_ALIASES = {
    'mesh':       'mesh',
    'arena':      'arena',
    'mesh-arena': 'mesh-arena',
    'fair-games': 'fair-games',
    'fairgames':  'fair-games',
    'ghost':      'ghost',
    'predictions':'predictions',
    'prediction': 'predictions',
    'stock':      'stock',
    'shop':       'shop',
    'giftcards':  'giftcards',
    'gas':        'gas',
    'fuel':       'fuel',
    'interchange':'interchange',
    'academy':    'academy',
    'code-academy':'academy',
    'convert':    'convert',
    'bridge':     'bridge'
  };

  function dispatchTarget(target) {
    if (!target) return false;
    var fn = TARGETS[target];
    if (!fn) return false;
    var ok = false;
    try { ok = fn() !== false; } catch (_) { ok = false; }
    try {
      window.dispatchEvent(new CustomEvent('ost:link-go', { detail: { target: target } }));
    } catch (_) {}
    return ok;
  }

  // ----------------------------------------------------------- share dispatch
  // Routed through Mesh Arena; safe to call before Arena mounts.
  function shareKind(kind, opts) {
    opts = opts || {};
    openArena();
    var arena = window.OST_MESH_ARENA;
    window.setTimeout(function () {
      var a = window.OST_MESH_ARENA || arena;
      if (a && typeof a.share === 'function') {
        try { a.share(kind, opts); } catch (_) {}
      }
    }, 280);
    return true;
  }

  // ----------------------------------------------------------- hash routing
  function syncHash() {
    var raw = (location.hash || '').replace(/^#/, '').split('?')[0].split('/')[0].toLowerCase();
    if (!raw) return;
    var target = HASH_ALIASES[raw];
    if (!target) return;
    dispatchTarget(target);
  }

  // ----------------------------------------------------------- delegated clicks
  function delegateClicks() {
    document.addEventListener('click', function (event) {
      var linkEl = event.target.closest && event.target.closest('[data-ost-link]');
      if (linkEl) {
        var target = String(linkEl.getAttribute('data-ost-link') || '').toLowerCase().trim();
        if (target && TARGETS[target]) {
          event.preventDefault();
          dispatchTarget(target);
          return;
        }
      }
      var shareEl = event.target.closest && event.target.closest('[data-ost-share]');
      if (shareEl) {
        var kind = String(shareEl.getAttribute('data-ost-share') || '').toLowerCase().trim();
        if (kind) {
          event.preventDefault();
          shareKind(kind);
        }
      }
    }, false);
  }

  // ----------------------------------------------------------- public API
  window.OST_LINK = {
    go: function (target, opts) {
      target = String(target || '').toLowerCase().trim();
      // Allow "wallet:convert" style
      if (TARGETS[target]) return dispatchTarget(target);
      // Bare ids may map onto compartments
      return activateCompartment(target);
    },
    share: shareKind,
    available: function (target) {
      target = String(target || '').toLowerCase().trim();
      return !!TARGETS[target];
    },
    targets: function () { return Object.keys(TARGETS); }
  };

  // ----------------------------------------------------------- boot
  function boot() {
    delegateClicks();
    window.addEventListener('hashchange', syncHash, false);
    // Defer initial sync so OST_MESH/OST_GHOST/OST_MESH_ARENA have a chance to boot
    window.setTimeout(syncHash, 600);
    window.setTimeout(syncHash, 1800);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();

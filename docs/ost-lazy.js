/* ==========================================================================
 * OST · Idle script loader — makes the app FEEL fast
 * --------------------------------------------------------------------------
 * The problem this solves, measured on production:
 *
 *   Total Blocking Time 2426ms · 22 long tasks · 3.5s of main-thread work
 *
 * 85 script tags ran at boot. Several of the heaviest (code-academy,
 * qrcode-generator, mesh-upgrade, mesh-social-x, mesh-group-markets,
 * mesh-location-pro) had NO `defer`, so they blocked HTML parsing outright —
 * ~290KB of render-blocking JavaScript for sections most users never open.
 * The Mesh pavilion, the mini-games and the quantum demo were all being parsed
 * and executed before anyone could press a button.
 *
 * Nothing here is removed. These modules just stop competing with first paint:
 * they load one at a time while the browser is IDLE, in their original order, so
 * input stays responsive instead of being stuck behind a 500ms script.
 *
 * If the user heads for one of those sections before we get there, flush()
 * loads everything immediately — so a feature is never missing, only late.
 *
 * NAMED GROUPS. A manifest entry with "group":"<name>" is NOT idle-loaded and
 * NOT flushed: it loads only when something asks for it with
 * OST_LAZY.group('<name>') -> Promise (resolves once every script of the group
 * has loaded; ordered async=false injection; idempotent). The legacy mesh
 * pavilion (mesh/mesh.js, veil, mesh-play, mesh-link, mesh-games, games/*,
 * mesh-mobile, mesh-contacts, …) is group "mesh": it used to load for every
 * visitor and announce/poll the hub from an idle home page. Anyone who needs
 * window.OST_MESH / OST_MESH_ARENA / OST_MESH_GAMES must await
 * OST_LAZY.group('mesh') first. mesh-link.js hash aliases (#arena, #chess, …)
 * are kept working by the small stub at the bottom of this file.
 * ========================================================================== */
(function () {
  'use strict';

  var manifestEl = document.getElementById('ost-lazy-manifest');
  if (!manifestEl) return;

  var manifest;
  try { manifest = JSON.parse(manifestEl.textContent || '[]'); } catch (_) { return; }
  if (!Array.isArray(manifest) || !manifest.length) return;
  // Idle queue = entries without a group; grouped entries wait for group().
  var queue = [], groups = {};
  manifest.forEach(function (e) {
    if (!e || !e.src) return;
    if (e.group) (groups[e.group] = groups[e.group] || []).push(e);
    else queue.push(e);
  });

  var total = queue.length;
  var i = 0;
  var flushing = false;
  var started = false;

  var idle = window.requestIdleCallback || function (fn) { return setTimeout(function () {
    fn({ timeRemaining: function () { return 8; } });
  }, 60); };

  // src -> Promise<boolean>, so nothing is ever injected twice. A script that FAILED
  // (offline, 404, server hiccup) is forgotten again, so the next inject() retries it
  // instead of handing back the cached failure forever.
  var injected = {};
  function inject(entry) {
    if (injected[entry.src]) return injected[entry.src];
    return (injected[entry.src] = new Promise(function (resolve) {
      var s = document.createElement('script');
      s.src = entry.src;
      if (entry.module) s.type = 'module';
      // Order matters: these were classic in-order scripts. `async=false` on an
      // injected script preserves execution order relative to other injected
      // scripts — dropping it would let mesh-games run before mesh.js.
      s.async = false;
      s.onload = function () { resolve(true); };
      s.onerror = function () {
        delete injected[entry.src];
        try { s.remove(); } catch (_) {}
        resolve(false);
      };
      document.body.appendChild(s);
    }));
  }

  function pump() {
    if (i >= total) {
      if (!total && !pump._done) { pump._done = true; try { window.dispatchEvent(new CustomEvent('ost:lazy-ready')); } catch (_) {} }
      return;
    }
    var entry = queue[i++];
    inject(entry).then(function () {
      if (i >= total) {
        try { window.dispatchEvent(new CustomEvent('ost:lazy-ready')); } catch (_) {}
        return;
      }
      // While flushing (the user is clearly heading somewhere), keep going
      // promptly. Otherwise wait for a genuinely idle moment so we never steal
      // a frame from someone who is mid-scroll or mid-tap.
      if (flushing) setTimeout(pump, 0);
      else idle(pump, { timeout: 2500 });
    });
  }

  function start() {
    if (started) return;
    started = true;
    idle(pump, { timeout: 3000 });
  }

  // Load everything NOW — the user is interacting, so a section could be needed
  // at any moment. Late is fine; missing is not.
  function flush() {
    flushing = true;
    if (!started) { started = true; setTimeout(pump, 0); }
  }

  // Boot: begin only once the page has actually finished loading, so we add
  // nothing to the critical path.
  if (document.readyState === 'complete') start();
  else window.addEventListener('load', start, { once: true });

  // Navigating to a section is the one signal worth abandoning politeness for.
  //
  // Deliberately NOT hooked to pointerdown/keydown: flushing on the first tap
  // would dump 19 scripts onto the main thread at the exact moment the user is
  // trying to interact — trading a slow load for a janky first click, which is
  // the worse of the two. Idle loading finishes within a few seconds anyway.
  window.addEventListener('hashchange', flush, { once: true });

  // Named group: inject every entry at once with async=false (parallel download,
  // execution in manifest order — mesh-games must run after mesh.js) and resolve
  // when all of them have loaded or failed: true when every script loaded, false when
  // any failed. Same promise while it is pending or after success; after a failure
  // the next call retries only the scripts that failed (the loaded ones are cached).
  var groupPromises = {}, groupOk = {};
  function group(name) {
    if (groupPromises[name]) return groupPromises[name];
    var list = groups[name];
    if (!list || !list.length) return Promise.resolve(false);
    var p = (groupPromises[name] = Promise.all(list.map(inject)).then(function (res) {
      var ok = res.every(Boolean);
      if (ok) groupOk[name] = true;
      else if (groupPromises[name] === p) delete groupPromises[name];
      try { window.dispatchEvent(new CustomEvent('ost:lazy-group', { detail: { name: name, ok: ok } })); } catch (_) {}
      return ok;
    }));
    return p;
  }

  window.OST_LAZY = {
    flush: flush,
    group: group,
    groupLoaded: function (name) { return !!groupOk[name]; },   // every script of the group loaded
    pending: function () { return total - i; },
    total: total
  };

  // mesh-link.js (in the "mesh" group) owns these hash aliases. Keep them working
  // without idle-loading the pavilion: on one of them, load the group — mesh-link
  // then reads the hash itself on boot (and on later hashchanges). Not here: #mesh
  // (the new OST Mesh app handles it), #predictions/#prediction (ost-appbar.js)
  // and #academy (ost-apps-viewer.js). Keep in sync with HASH_ALIASES in mesh-link.js.
  var MESH_LINK_HASHES = ('arena mesh-arena fair-games fairgames casual-games mesh-games chess pool pool8 cuppong ' +
    'tictactoe ttt minigolf golf ghost stock shop giftcards gas fuel interchange code-academy coding-studio ' +
    'codingstudio convert').split(' ');
  function meshLinkHash() {
    var raw = (location.hash || '').replace(/^#/, '').split('?')[0].split('/')[0].toLowerCase();
    // BRG-5: #bridge is the real OST <-> OSTG bridge card (Wallet -> Convert), never
    // Portals and never the Mesh pavilion. ost-bridge-ui.js (deferred) owns open().
    if (raw === 'bridge') { openBridge(0); return; }
    if (groupPromises.mesh || groupOk.mesh) return;
    if (raw && MESH_LINK_HASHES.indexOf(raw) !== -1) group('mesh');
  }
  function openBridge(tries) {
    if (window.OST_BRIDGE_UI && typeof window.OST_BRIDGE_UI.open === 'function') { try { window.OST_BRIDGE_UI.open(); } catch (_) {} return; }
    if (tries > 40) { if (typeof window.OST_OPEN_BRIDGE === 'function') { try { window.OST_OPEN_BRIDGE(); } catch (_) {} } return; }
    setTimeout(function () { openBridge(tries + 1); }, 150);
  }
  window.addEventListener('hashchange', meshLinkHash);
  if (document.readyState === 'complete') meshLinkHash();
  else window.addEventListener('load', meshLinkHash, { once: true });
})();

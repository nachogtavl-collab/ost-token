/* ==========================================================================
 * OST · Games lanes — the five-way split of the Games page
 * --------------------------------------------------------------------------
 * Games used to sit inside "Get OST", which conflated two unrelated jobs:
 * ACQUIRING OST and SPENDING TIME with it. They are separate sections now,
 * and the Games page groups by the only distinction that actually matters to
 * a player - how a game settles, and who they are up against:
 *
 *   fair        server-settled faucet games, commit-reveal verifiable
 *   offline     playable with no connection
 *   multiplayer player vs player, server-settled
 *   mesh        peer-to-peer over OST Mesh
 *   shortcuts   apps already installed on the device
 *
 * Lanes are populated from what is REALLY registered at runtime, not from a
 * hardcoded list. A lane with nothing in it says so instead of showing an
 * empty box - an empty grid reads as a broken page, and a lane that lies
 * about having games is worse.
 * ========================================================================== */
(function () {
  'use strict';
  if (window.OST_GAMES_LANES) return;

  var LANE_KEY = 'ost.games.lane.v1';

  function injectStyle() {
    if (document.getElementById('ost-games-lanes-style')) return;
    var css =
      '.games-lanes{display:flex;gap:9px;overflow-x:auto;overflow-y:hidden;flex-wrap:nowrap;padding:4px 0 12px;' +
        '-webkit-overflow-scrolling:touch;scrollbar-width:thin;}' +
      // flex/min-width re-asserted: mobile-shell.css applies a blanket
      // `body.ost-mobile-shell * { min-width:0 }` that collapses the tabs of
      // any horizontal rail into one character per line.
      '.games-lane{flex:0 0 auto!important;min-width:158px!important;display:grid;gap:2px;justify-items:start;' +
        'padding:10px 13px;border-radius:14px;cursor:pointer;text-align:left;' +
        'background:#0b1b29;border:1px solid rgba(127,216,255,.16);color:#dff8ff;}' +
      '.games-lane:hover{border-color:rgba(127,216,255,.45);}' +
      '.games-lane.is-active{background:#12405c;border-color:rgba(127,216,255,.75);}' +
      '.games-lane .gl-ico{font-size:19px;line-height:1;}' +
      '.games-lane .gl-lbl{font-size:13px;font-weight:600;white-space:nowrap;overflow-wrap:normal;}' +
      '.games-lane .gl-sub{font-size:10.5px;color:#9fbfd8;white-space:nowrap;overflow-wrap:normal;}' +
      '.games-lane-panel[hidden]{display:none;}' +
      '.gl-empty{padding:20px;border-radius:14px;background:#08161f;border:1px dashed rgba(127,216,255,.22);' +
        'color:#9fbfd8;font-size:13px;line-height:1.5;}' +
      '.gl-empty b{color:#dff8ff;display:block;margin-bottom:5px;font-weight:600;}';
    var tag = document.createElement('style');
    tag.id = 'ost-games-lanes-style';
    tag.textContent = css;
    document.head.appendChild(tag);
  }

  function panels() { return document.querySelectorAll('[data-games-panel]'); }

  function show(lane) {
    var found = false;
    panels().forEach(function (p) {
      var match = p.getAttribute('data-games-panel') === lane;
      p.hidden = !match;
      if (match) found = true;
    });
    if (!found) return;
    document.querySelectorAll('[data-games-lane]').forEach(function (b) {
      b.classList.toggle('is-active', b.getAttribute('data-games-lane') === lane);
    });
    try { localStorage.setItem(LANE_KEY, lane); } catch (_) {}
    try {
      window.dispatchEvent(new CustomEvent('ost:games-lane', { detail: { lane: lane } }));
    } catch (_) {}
  }

  function empty(host, title, body) {
    if (!host || host.children.length) return;
    var d = document.createElement('div');
    d.className = 'gl-empty';
    d.innerHTML = '<b>' + title + '</b>' + body;
    host.appendChild(d);
  }

  function fillShortcuts() {
    var host = document.getElementById('ostGamesShortcuts');
    if (!host || host.children.length) return;
    if (window.OST_SHORTCUTS && window.OST_SHORTCUTS.render) {
      window.OST_SHORTCUTS.render(host);
    } else {
      empty(host, 'Shortcuts unavailable',
        'The shortcuts module did not load. Reload the page and try again.');
    }
  }

  // Mesh games live in the mesh layer and only exist once a peer session is
  // possible, so this lane points at Mesh rather than duplicating its UI.
  function fillMesh() {
    var host = document.querySelector('[data-games-panel="mesh"]');
    if (!host || host.children.length) return;
    var wrap = document.createElement('div');
    wrap.className = 'gl-empty';
    wrap.innerHTML =
      '<b>Peer-to-peer games</b>' +
      'Mesh games run directly between two devices — chess, pool, tic-tac-toe and more — ' +
      'with no server holding the board. Open Mesh, connect to a peer, then pick a game there.';
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Open Mesh';
    btn.style.cssText = 'margin-top:11px;border:0;border-radius:10px;padding:8px 15px;background:#12405c;color:#dff8ff;cursor:pointer;';
    btn.addEventListener('click', function () {
      if (window.OST_MESH && typeof window.OST_MESH.open === 'function') window.OST_MESH.open();
      else {
        var t = document.getElementById('ost-mesh-trigger');
        if (t) t.click();
      }
    });
    wrap.appendChild(btn);
    host.appendChild(wrap);
  }

  function fillOffline() {
    var host = document.querySelector('[data-games-panel="offline"]');
    empty(host, 'Offline games',
      'Games that keep working with no connection. None are registered yet — ' +
      'when an offline-capable game ships it appears here automatically.');
  }

  function fillMultiplayer() {
    var host = document.querySelector('[data-games-panel="multiplayer"]');
    empty(host, 'Player vs player',
      'Server-settled multiplayer, so both sides get the same provably fair outcome. ' +
      'None are registered yet — this lane fills itself as they ship.');
  }

  function boot() {
    if (!document.getElementById('gamesLanes')) return;
    injectStyle();

    document.getElementById('gamesLanes').addEventListener('click', function (e) {
      var b = e.target.closest('[data-games-lane]');
      if (b) show(b.getAttribute('data-games-lane'));
    });

    fillShortcuts();
    fillMesh();
    fillOffline();
    fillMultiplayer();

    var saved = 'fair';
    try { saved = localStorage.getItem(LANE_KEY) || 'fair'; } catch (_) {}
    show(saved);
  }

  window.OST_GAMES_LANES = { show: show };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();

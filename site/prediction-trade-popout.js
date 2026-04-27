/* ==========================================================================
   OST Prediction — Trade Desk Pop-out
   --------------------------------------------------------------------------
   Removes the always-on, sticky right-column "Trade with OST" widget that
   was overlapping the markets and our popup. Keeps every existing DOM id
   intact (predictionTradeAction, predictionStakeInput, predictionOutcomeToggle,
   etc.) so the existing trade engine and the unified market modal continue
   to drive it.

   What this module does:
     1. Lifts the existing `<aside id="predictionTradeDesk">` out of the
        wallet portal grid and re-parents it to <body> as a floating panel.
     2. Hides the panel by default. Adds a small launcher button inside the
        prediction header so the user can pop it open / close it.
     3. Adds drag handle on the header so the panel is movable; remembers
        position + open state in localStorage.
     4. Auto-hides while the unified market modal is open (no overlap).
     5. Allows the market list column to span full width because the desk
        is no longer in the grid.
   ========================================================================== */
(function () {
  'use strict';
  if (window.__OST_TRADE_POPOUT_LOADED) return;
  window.__OST_TRADE_POPOUT_LOADED = true;

  var POS_KEY = 'ost.tradeDesk.popout.v1';

  function $(sel, root) { return (root || document).querySelector(sel); }

  function readPos() {
    try { return JSON.parse(localStorage.getItem(POS_KEY) || 'null') || {}; }
    catch (_) { return {}; }
  }
  function writePos(patch) {
    var cur = readPos();
    Object.keys(patch).forEach(function (k) { cur[k] = patch[k]; });
    try { localStorage.setItem(POS_KEY, JSON.stringify(cur)); } catch (_) {}
  }

  function ensurePopout() {
    var desk = document.getElementById('predictionTradeDesk');
    if (!desk) return null;
    if (desk.dataset.popoutReady === '1') return desk;

    // Wrap inside a draggable shell with a header bar.
    var header = document.createElement('div');
    header.className = 'ost-tradepop__header';
    header.innerHTML =
      '<span class="ost-tradepop__grip" aria-hidden="true">⋮⋮</span>' +
      '<span class="ost-tradepop__title">Trade ticket</span>' +
      '<button type="button" class="ost-tradepop__close" aria-label="Close trade ticket">×</button>';
    desk.classList.add('ost-tradepop');
    desk.dataset.popoutReady = '1';
    desk.insertBefore(header, desk.firstChild);

    // Re-parent to body so it escapes any portal stacking context.
    document.body.appendChild(desk);

    // Restore saved position + open state.
    var pos = readPos();
    if (pos.left != null && pos.top != null) {
      desk.style.left = pos.left + 'px';
      desk.style.top = pos.top + 'px';
      desk.style.right = 'auto';
      desk.style.bottom = 'auto';
    }
    if (pos.open) desk.classList.add('is-open');

    // Drag.
    var dragging = false, sx = 0, sy = 0, ox = 0, oy = 0;
    header.addEventListener('mousedown', function (ev) {
      if (ev.target.closest('.ost-tradepop__close')) return;
      dragging = true;
      var rect = desk.getBoundingClientRect();
      sx = ev.clientX; sy = ev.clientY;
      ox = rect.left; oy = rect.top;
      document.body.style.userSelect = 'none';
      ev.preventDefault();
    });
    document.addEventListener('mousemove', function (ev) {
      if (!dragging) return;
      var nx = Math.max(8, Math.min(window.innerWidth - 60, ox + (ev.clientX - sx)));
      var ny = Math.max(8, Math.min(window.innerHeight - 60, oy + (ev.clientY - sy)));
      desk.style.left = nx + 'px';
      desk.style.top = ny + 'px';
      desk.style.right = 'auto';
      desk.style.bottom = 'auto';
    });
    document.addEventListener('mouseup', function () {
      if (!dragging) return;
      dragging = false;
      document.body.style.userSelect = '';
      writePos({ left: parseInt(desk.style.left, 10) || 0, top: parseInt(desk.style.top, 10) || 0 });
    });

    // Close button.
    header.querySelector('.ost-tradepop__close').addEventListener('click', function () { close(); });

    return desk;
  }

  function open() {
    var desk = ensurePopout();
    if (!desk) return;
    if (document.body.classList.contains('ost-modal-open')) return; // don't fight the modal
    desk.classList.add('is-open');
    writePos({ open: true });
    syncLauncher(true);
  }
  function close() {
    var desk = document.getElementById('predictionTradeDesk');
    if (desk) desk.classList.remove('is-open');
    writePos({ open: false });
    syncLauncher(false);
  }
  function toggle() {
    var desk = document.getElementById('predictionTradeDesk');
    if (desk && desk.classList.contains('is-open')) close(); else open();
  }

  // --------------------------------------------------------------------------
  // Launcher button — injected into the prediction section header.
  // --------------------------------------------------------------------------
  function ensureLauncher() {
    if (document.getElementById('ostTradePopLauncher')) return;
    // Look for a sensible anchor near the prediction board.
    var anchor =
      $('#predictionMarketList') ||
      $('.prediction-market-grid') ||
      $('#predictionTradeDesk');
    if (!anchor) return;

    var btn = document.createElement('button');
    btn.id = 'ostTradePopLauncher';
    btn.type = 'button';
    btn.className = 'ost-tradepop__launcher';
    btn.innerHTML = '<span aria-hidden="true">🎯</span> Trade ticket';
    btn.title = 'Open the OST trade ticket as a floating, draggable panel';
    btn.addEventListener('click', toggle);
    document.body.appendChild(btn);
    syncLauncher(false);
  }
  function syncLauncher(open) {
    var btn = document.getElementById('ostTradePopLauncher');
    if (!btn) return;
    btn.classList.toggle('is-active', !!open);
    btn.innerHTML = open
      ? '<span aria-hidden="true">▾</span> Hide ticket'
      : '<span aria-hidden="true">🎯</span> Trade ticket';
  }

  // --------------------------------------------------------------------------
  // Market modal coordination — close the popout while the unified market
  // modal is up so the two UIs never overlap.
  // --------------------------------------------------------------------------
  var prevOpenState = false;
  window.addEventListener('ost-modal:open', function () {
    var desk = document.getElementById('predictionTradeDesk');
    prevOpenState = !!(desk && desk.classList.contains('is-open'));
    if (desk) desk.classList.remove('is-open');
    var btn = document.getElementById('ostTradePopLauncher');
    if (btn) btn.style.display = 'none';
  });
  window.addEventListener('ost-modal:close', function () {
    var btn = document.getElementById('ostTradePopLauncher');
    if (btn) btn.style.display = '';
    if (prevOpenState) open();
  });

  // --------------------------------------------------------------------------
  // Hook the existing "Place order" button success → also flash the launcher
  // so the user knows the ticket fired even if the panel was closed.
  // --------------------------------------------------------------------------
  function watchTradeAction() {
    var act = document.getElementById('predictionTradeAction');
    if (!act || act.dataset.popoutBound === '1') return;
    act.dataset.popoutBound = '1';
    act.addEventListener('click', function () {
      var btn = document.getElementById('ostTradePopLauncher');
      if (!btn) return;
      btn.classList.add('is-fired');
      setTimeout(function () { btn.classList.remove('is-fired'); }, 1200);
    });
  }

  // --------------------------------------------------------------------------
  // Boot
  // --------------------------------------------------------------------------
  function boot() {
    ensurePopout();
    ensureLauncher();
    watchTradeAction();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
  // The prediction board often re-renders. Re-bind when that happens.
  var mo = new MutationObserver(function () { watchTradeAction(); ensureLauncher(); });
  mo.observe(document.body, { childList: true, subtree: true });

  // Public API.
  window.OST_TRADE_POPOUT = { open: open, close: close, toggle: toggle };
})();

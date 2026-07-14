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
 * ========================================================================== */
(function () {
  'use strict';

  var manifestEl = document.getElementById('ost-lazy-manifest');
  if (!manifestEl) return;

  var queue;
  try { queue = JSON.parse(manifestEl.textContent || '[]'); } catch (_) { return; }
  if (!Array.isArray(queue) || !queue.length) return;

  var total = queue.length;
  var i = 0;
  var flushing = false;
  var started = false;

  var idle = window.requestIdleCallback || function (fn) { return setTimeout(function () {
    fn({ timeRemaining: function () { return 8; } });
  }, 60); };

  function inject(entry) {
    return new Promise(function (resolve) {
      var s = document.createElement('script');
      s.src = entry.src;
      if (entry.module) s.type = 'module';
      // Order matters: these were classic in-order scripts. `async=false` on an
      // injected script preserves execution order relative to other injected
      // scripts — dropping it would let mesh-games run before mesh.js.
      s.async = false;
      s.onload = s.onerror = function () { resolve(); };
      document.body.appendChild(s);
    });
  }

  function pump() {
    if (i >= total) return;
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

  window.OST_LAZY = {
    flush: flush,
    pending: function () { return total - i; },
    total: total
  };
})();

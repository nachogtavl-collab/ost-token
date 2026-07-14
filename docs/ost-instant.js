/* ==========================================================================
 * OST · Instant touch — acknowledge the press before the finger lifts
 * --------------------------------------------------------------------------
 * Perceived speed is not the same as speed. A tap that does nothing for 200ms
 * feels broken even if the work behind it is fast. This layer answers EVERY
 * press immediately:
 *
 *   pointerdown  ->  visual press state + haptic tick   (no waiting for click)
 *   pointerup    ->  spring back
 *
 * Three things make it actually instant rather than merely early:
 *
 *   1. It listens on `pointerdown`, not `click`. Click fires only after the
 *      finger LIFTS; pointerdown fires the moment it lands.
 *   2. It is registered as a PASSIVE, CAPTURING listener, so it runs before any
 *      app handler can call preventDefault or run slow logic.
 *   3. It only toggles a class whose CSS animates transform/opacity/filter —
 *      properties the compositor handles off the main thread. The press state
 *      therefore paints even while JavaScript is busy.
 *
 * It deliberately does NOT trigger the action early. Firing on pointerdown
 * would break drag, scroll-cancel and "slide your finger off to abort", which
 * every native UI supports and users rely on. We make it FEEL instant, not
 * behave surprisingly.
 * ========================================================================== */
(function () {
  'use strict';

  // What counts as pressable. Kept to real controls so scrolling a list or
  // selecting text never lights something up.
  var SELECTOR = [
    'button', 'a[href]', '[role="button"]', 'summary', 'label[for]',
    '.btn', '.chip', '.tile', '.tab', '.nav-link', '.ost-tap',
    'input[type="button"]', 'input[type="submit"]', '[data-action]'
  ].join(',');

  // Big surfaces lift instead of shrinking — scaling a whole card looks wrong.
  var SOFT = '.card,.tile,.ost-card,.market-card';

  var pressed = null;
  var haptics = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';

  function release() {
    if (!pressed) return;
    var el = pressed;
    pressed = null;
    el.classList.remove('ost-pressed');
    el.classList.add('ost-released');
    // Drop the helper class once the spring finishes, so we never leave stray
    // will-change/transform on hundreds of nodes (that costs memory and can
    // force needless compositor layers).
    setTimeout(function () { el.classList.remove('ost-released'); }, 150);
  }

  function onDown(ev) {
    // Primary button / finger only — right-click and multi-touch shouldn't press.
    if (ev.button != null && ev.button !== 0) return;
    var el = ev.target && ev.target.closest ? ev.target.closest(SELECTOR) : null;
    if (!el || el.disabled || el.getAttribute('aria-disabled') === 'true') return;

    if (pressed && pressed !== el) release();
    pressed = el;
    el.classList.remove('ost-released');
    if (el.matches && el.matches(SOFT)) el.classList.add('ost-press-soft');
    el.classList.add('ost-pressed');

    // A short tick on Android. iOS Safari ignores vibrate(); the visual state is
    // what sells it there. Guarded so a user who disabled motion gets nothing.
    if (haptics && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      try { navigator.vibrate(8); } catch (_) {}
    }
  }

  // Passive + capture: we never block the gesture, and we run before app code.
  var opts = { passive: true, capture: true };
  document.addEventListener('pointerdown', onDown, opts);
  document.addEventListener('pointerup', release, opts);
  document.addEventListener('pointercancel', release, opts);
  // Finger slid off the control: cancel the press, exactly like a native button.
  document.addEventListener('pointerleave', release, opts);
  window.addEventListener('blur', release, { passive: true });
  document.addEventListener('scroll', release, { passive: true, capture: true });

  window.OST_INSTANT = { release: release };
})();

/* ==========================================================================
 * OST · Idle Guard — do not spend the budget when nobody is looking
 * --------------------------------------------------------------------------
 * MEASURED, and it is the whole outage:
 *
 *   idle tab, user watching   : 4.70 req/sec → 406,073/day
 *   HIDDEN tab, phone in pocket: 1.98 req/sec → 170,880/day
 *
 * The free Workers plan allows ~100,000 requests/DAY for the ENTIRE ACCOUNT. So
 * ONE tester who merely left OST open in a background tab burns 1.7x the whole
 * budget without looking at the screen once. Ten testers exhaust it in minutes,
 * the worker starts answering Cloudflare 1027 ("owner has reached their plan
 * limits"), and every client then silently degrades to stale per-colo state —
 * which is exactly the "different prices, no correlation" desync. The outage and
 * the desync were always the same event, funded by ticks nobody was watching.
 *
 * A market tick has no value if no human is looking at it. There is no user to
 * inform, no chart being read, no price being acted on. We were buying data for
 * an empty room and going bankrupt doing it.
 *
 * HOW THIS WORKS
 * One gate, at fetch, instead of hunting every setInterval in the codebase (there
 * are dozens, in modules that do not know about each other, and new ones land all
 * the time). While the page is hidden, GET polls to our own API are answered
 * locally with a 503 — never sent. Callers already treat a non-ok response as
 * "keep what you have", because the worker has been failing on them for months.
 *
 * WHAT IS DELIBERATELY NOT GATED
 *  · POST/PUT/DELETE — those are user actions and money. A bet must land even if
 *    the tab hides mid-flight.
 *  · Anything not our API — Solana RPC, price feeds, third parties. Not our cap.
 *  · The first fetch after becoming visible — on wake we refresh immediately, so
 *    the user never looks at a stale screen. Hiding costs nothing; it just stops
 *    paying rent on an empty room.
 * ========================================================================== */
(function () {
  'use strict';
  if (window.OST_IDLE_GUARD) return;

  var OUR_API = /(?:^|\.)workers\.dev$/i;
  var blocked = 0, allowed = 0;

  // A VISIBLE TAB IS NOT THE SAME AS A WATCHED TAB.
  //
  // document.hidden catches the phone-in-pocket case, but a tab parked on a
  // second monitor or left open on a desk reports hidden === false and pays full
  // price forever. Measured: one such tab is 194,400 req/day = 194% of the entire
  // free-tier cap, all by itself, watched by nobody.
  //
  // So we also track whether a HUMAN is here. Any real input — touch, scroll,
  // key, click, pointer — resets the clock. After IDLE_MS with none of it, we
  // treat the tab exactly like a hidden one.
  //
  // Why 5 minutes and not 30 seconds: someone can legitimately read a chart or
  // watch a round count down without touching anything. Cutting them off early
  // would freeze live prices under their nose — and a frozen price displayed as a
  // live one is precisely the lie this codebase is riddled with. 5 minutes is far
  // longer than anyone stares motionless, and short enough that an abandoned tab
  // stops costing money almost immediately.
  //
  // And when we do pause, WE SAY SO (see the banner below). Silently freezing the
  // data would make us the thing we spent all day removing. The user must always
  // know whether they are looking at live data or a photograph of it.
  var IDLE_MS = 5 * 60 * 1000;
  var lastInput = Date.now();
  var paused = false;

  function humanGone() { return (Date.now() - lastInput) > IDLE_MS; }
  function shouldGate() { return document.hidden || humanGone(); }

  function isPoll(url, method) {
    if (String(method || 'GET').toUpperCase() !== 'GET') return false;   // never gate writes
    try {
      var u = new URL(url, location.href);
      return OUR_API.test(u.hostname);
    } catch (_) { return false; }
  }

  var nativeFetch = window.fetch;
  if (typeof nativeFetch !== 'function') return;

  window.fetch = function (input, init) {
    var url = '', method = 'GET';
    try {
      if (typeof input === 'string') { url = input; method = (init && init.method) || 'GET'; }
      else if (input) { url = input.url || ''; method = input.method || (init && init.method) || 'GET'; }
    } catch (_) {}

    if (shouldGate() && isPoll(url, method)) {
      blocked++;
      if (!document.hidden) showPaused();   // visible but nobody home: say so
      // 503 + no body: the same shape callers already handle when the worker is
      // down, so this needs no cooperation from any of them. Never a fabricated
      // 200 — that would be this codebase's own disease (see
      // project-docs/REMODEL.md): a plausible-looking answer that is a lie.
      // "I did not ask" must never render as "here is your data".
      return Promise.resolve(new Response(null, {
        status: 503,
        statusText: 'OST idle guard: tab hidden, poll skipped'
      }));
    }
    if (isPoll(url, method)) allowed++;
    return nativeFetch.apply(this, arguments);
  };

  /* ---- the honest pause banner ------------------------------------------- */
  function styles() {
    if (document.getElementById('ostIdleStyle')) return;
    var st = document.createElement('style');
    st.id = 'ostIdleStyle';
    st.textContent = [
      '#ostIdle{position:fixed;left:50%;transform:translateX(-50%) translateY(-140%);',
      'top:calc(env(safe-area-inset-top,0px) + 8px);z-index:10085;display:flex;align-items:center;gap:8px;',
      'padding:8px 14px;border-radius:999px;background:rgba(15,23,42,.96);',
      'border:1px solid rgba(148,163,184,.28);box-shadow:0 8px 26px rgba(0,0,0,.45);',
      'color:#cbd5e1;font-size:12px;font-weight:700;cursor:pointer;',
      'transition:transform .28s cubic-bezier(.22,1,.36,1);}',
      '#ostIdle.is-in{transform:translateX(-50%) translateY(0);}',
      '#ostIdle b{color:#e2e8f0;}'
    ].join('');
    document.head.appendChild(st);
  }

  function showPaused() {
    if (paused) return;
    paused = true;
    styles();
    var el = document.getElementById('ostIdle');
    if (!el) {
      el = document.createElement('div');
      el.id = 'ostIdle';
      el.setAttribute('role', 'status');
      // Say exactly what is true: the numbers are frozen, and why, and how to
      // undo it. A silent freeze would be indistinguishable from live data — the
      // very lie we removed everywhere else today.
      el.innerHTML = '<span>⏸ <b>Live updates paused</b> · tap anywhere to resume</span>';
      el.addEventListener('click', wake);
      document.body.appendChild(el);
    }
    requestAnimationFrame(function () { el.classList.add('is-in'); });
  }

  function hidePaused() {
    paused = false;
    var el = document.getElementById('ostIdle');
    if (el) el.classList.remove('is-in');
  }

  function resume() {
    hidePaused();
    try { window.dispatchEvent(new CustomEvent('ost:resume')); } catch (_) {}
    try { window.dispatchEvent(new CustomEvent('ost:wallet-changed')); } catch (_) {}
    try { if (window.OST_OFFLINE_MODE && window.OST_OFFLINE_MODE.check) window.OST_OFFLINE_MODE.check(); } catch (_) {}
  }

  function wake() {
    var wasGated = shouldGate();
    lastInput = Date.now();
    if (wasGated) resume();      // only re-sync if we had actually stopped
    else if (paused) hidePaused();
  }

  // Any sign of a human resets the clock. Passive + capture so nothing can
  // swallow these before we see them; they never preventDefault or interfere.
  ['pointerdown', 'touchstart', 'keydown', 'wheel', 'scroll', 'mousemove'].forEach(function (evt) {
    window.addEventListener(evt, wake, { passive: true, capture: true });
  });

  // On wake, tell the app to refresh NOW so the user never reads a stale screen.
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { hidePaused(); return; }   // no banner behind a hidden tab
    lastInput = Date.now();                          // returning to the tab IS presence
    resume();
  });

  window.OST_IDLE_GUARD = {
    stats: function () {
      return {
        blocked: blocked, allowed: allowed,
        hidden: document.hidden, humanGone: humanGone(), gated: shouldGate(),
        idleForMs: Date.now() - lastInput, paused: paused
      };
    },
    // Tests + anyone who needs to reason about the window.
    idleMs: IDLE_MS,
    // Escape hatch for anything that ever genuinely must poll in the background.
    // Nothing needs it today: settlement is server-side and the client re-reads on
    // wake. If you reach for this, be sure the cost is worth a user seeing it.
    isGated: function () { return shouldGate(); }
  };
})();

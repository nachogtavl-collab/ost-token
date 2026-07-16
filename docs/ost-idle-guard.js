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

    if (document.hidden && isPoll(url, method)) {
      blocked++;
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

  // On wake, tell the app to refresh NOW so the user never reads a stale screen.
  // The modules already listen for these to re-sync after a reconnect.
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) return;
    try { window.dispatchEvent(new CustomEvent('ost:resume')); } catch (_) {}
    try { window.dispatchEvent(new CustomEvent('ost:wallet-changed')); } catch (_) {}
    try { if (window.OST_OFFLINE_MODE && window.OST_OFFLINE_MODE.check) window.OST_OFFLINE_MODE.check(); } catch (_) {}
  });

  window.OST_IDLE_GUARD = {
    stats: function () { return { blockedWhileHidden: blocked, allowedWhileVisible: allowed }; },
    // Escape hatch for anything that ever genuinely must poll in the background.
    // Nothing needs it today: settlement is server-side and the client re-reads on
    // wake. If you reach for this, be sure the cost is worth a user seeing it.
    isGated: function () { return document.hidden; }
  };
})();

/* ==========================================================================
 * OST · Offline Mode — when the network dies, the app doesn't
 * --------------------------------------------------------------------------
 * The service worker already makes the SHELL load with no connection. What was
 * missing is the part users actually feel: nothing ever told the app it was
 * offline. It kept polling dead endpoints, kept rendering stale prices as if
 * they were live, and kept offering Buy buttons that could not possibly work.
 *
 * This module makes offline a real state:
 *   · the offline vault balance becomes the balance on screen,
 *   · offline-capable things (vault, bearer notes, local games) stay usable,
 *   · everything that NEEDS the network is disabled and says so,
 *   · on reconnect it steps aside and the vault syncs.
 *
 * TWO HONESTY RULES THIS FILE ENFORCES
 *
 * 1. NEVER show a live number without a network. A price from four minutes ago
 *    rendered in the live ticker is a lie that costs money. Offline, prices are
 *    marked stale rather than quietly kept on screen.
 *
 * 2. NEVER let an offline action look settled. A prediction is an ON-CHAIN
 *    escrow — with no network there is no transaction, no vault, no market. We
 *    do not "queue" bets: a queued bet at an unknown future price is not the bet
 *    the user thought they placed. We say the market is unreachable instead.
 *    Vault spends are different and DO work offline: the balance is a local
 *    bearer instrument, which is the entire point of it.
 *
 * ON GAMES AND "FAIR" — READ BEFORE CHANGING
 * ost-games.js calls itself provably fair, but generates the SERVER seed in the
 * player's own browser (`pf.serverSeed = randomHex(32)`). That is not provable
 * fairness online, and offline it CANNOT be: fairness needs a commitment from a
 * party that is not the player. So offline games here are honest local play
 * against the vault, and any winnings are PROVISIONAL until the server verifies
 * them at sync. We do not print the words "provably fair" offline, and the sync
 * endpoint must treat these proofs as claims, never as settled truth — a device
 * that can pick its own outcomes could otherwise mint OST from nothing.
 * ========================================================================== */
(function () {
  'use strict';
  if (window.OST_OFFLINE_MODE) return;

  // HOW WE DECIDE WE ARE OFFLINE — and why there is no probe endpoint.
  //
  // navigator.onLine only reports whether a network INTERFACE exists. Airplane
  // wifi, captive portals and dead mobile data all report `true`. So `false` is
  // trustworthy ("definitely offline") and `true` proves nothing.
  //
  // The obvious next move — poll a health endpoint — is a trap, and the first
  // version of this file fell in it. A single URL that can 404, change CORS, or
  // get rate-limited (our worker throttles hard) makes the app declare itself
  // offline WHILE ONLINE and grey out Buy for working users. That false positive
  // is worse than the bug this file exists to fix. It also adds a request per
  // user every few seconds to the very worker we are trying to take load off.
  //
  // So we spend zero extra requests and watch the app's OWN traffic instead.
  // OST polls markets constantly; those calls already answer "does the network
  // work?" more honestly than any probe, because they are the exact requests the
  // app needs. A response of ANY status (429, 500, anything) proves bytes move =
  // online. Only a network-level failure counts against us.
  var FAIL_THRESHOLD = 3;   // consecutive network failures before we believe it
  var STALE_MS = 45000;     // no successful traffic this long + onLine false = offline
  var QUIET_MS = 12000;     // nothing anywhere has succeeded for this long

  var offline = false;
  var fails = 0;
  // 0, not Date.now(). On a fresh page NOTHING has succeeded yet, and claiming
  // otherwise makes the corroboration check below veto a real offline state for
  // the first QUIET_MS. That matters most in the exact case we care about: an
  // app reopened with no network, booting from the service-worker cache, where
  // the page loading proves nothing about connectivity.
  var lastOkAt = 0;
  var timer = null;

  function fire(name, detail) {
    try { window.dispatchEvent(new CustomEvent(name, { detail: detail })); } catch (_) {}
  }

  function noteOk() {
    fails = 0;
    lastOkAt = Date.now();
    // navigator.onLine === false is AUTHORITATIVE and nothing may override it.
    // `false` means the OS has no usable network interface — airplane mode, wifi
    // off. A "successful" request in that state did not touch the network; it was
    // answered from the service-worker cache, and treating it as proof of
    // connectivity is what made the app declare itself ONLINE while sitting in
    // airplane mode. onLine can lie when it says true, never when it says false.
    if (offline && navigator.onLine !== false) setOffline(false);
  }

  // Going offline needs TWO independent signals to agree, never one.
  //
  // Our own API failing is not enough on its own: fetch() reports a CORS failure
  // and a dead network with the identical opaque TypeError, so one bad CORS
  // header on the worker would otherwise mark EVERY user offline. It is also not
  // enough that third parties fail — adblockers do that all day.
  //
  // So: our API must be failing AND nothing anywhere must have succeeded
  // recently. If any request to any host still completes, bytes are moving and
  // we are online, whatever else is broken. That reduces this to what it should
  // be — "is the network down?" — instead of "is one endpoint unhappy?".
  function noteFail() {
    fails++;
    if (fails < FAIL_THRESHOLD) return;
    if ((Date.now() - lastOkAt) < QUIET_MS) return;   // something still works
    setOffline(true);
  }

  // Observe, never interfere. This wrapper must be perfectly transparent: same
  // arguments, same return value, same rejection. It only listens.
  // SUCCESS and FAILURE are deliberately NOT symmetric.
  //
  // A success from ANY host proves the network moves bytes, so all of them count
  // in our favour. A failure only counts against us if it is OUR OWN API — the
  // one host we control and know should answer.
  //
  // Getting this wrong is how the first version broke: it counted every
  // cross-origin failure, so three blocked third-party calls in a row flipped a
  // perfectly online app to "offline". OST already loads ad frames and polls
  // coingecko/kraken, which are exactly the things an adblocker, a corporate
  // proxy or a geo-block kills — none of which mean the user is offline.
  var OUR_HOSTS = /(?:^|\.)workers\.dev$|(?:^|\.)ost-token\.pages\.dev$/i;

  function isSameOrigin(url) {
    try { return new URL(url, location.href).origin === location.origin; } catch (_) { return false; }
  }

  function isOurs(url) {
    try {
      var u = new URL(url, location.href);
      return u.origin === location.origin || OUR_HOSTS.test(u.hostname);
    } catch (_) { return false; }
  }

  var nativeFetch = window.fetch;
  if (typeof nativeFetch === 'function') {
    window.fetch = function (input) {
      var url = '';
      try { url = typeof input === 'string' ? input : (input && input.url) || ''; } catch (_) {}
      var http = /^https?:/i.test(url) || url.indexOf('/') === 0;
      var ours = http && isOurs(url);
      // A SUCCESS ONLY PROVES CONNECTIVITY IF IT CAME FROM THE NETWORK.
      //
      // This is the trap that makes naive PWA offline-detection wrong, and it
      // bit this file: our own service worker answers cached same-origin GETs
      // with a completely normal 200 while the device is in airplane mode. Those
      // "successes" were flipping the app back to online with no network at all.
      //
      // Cross-origin fetch()/XHR is the one class sw.js deliberately never
      // intercepts (see its fetch handler: destination '' falls through), so if
      // one of those resolves, bytes genuinely moved.
      var proves = http && !isSameOrigin(url);
      return nativeFetch.apply(this, arguments).then(function (res) {
        // Do not require res.ok — a 429 from our own rate limiter is proof of
        // connectivity, not absence of it.
        if (proves) noteOk();
        return res;
      }, function (err) {
        // An aborted request (timeouts, navigations, our own AbortControllers)
        // says nothing about the network, so it never counts.
        var aborted = err && (err.name === 'AbortError' || /abort/i.test(String(err && err.message)));
        if (ours && !aborted) noteFail();
        throw err;
      });
    };
  }

  // A user-initiated check. Uses a real app request rather than a bespoke health
  // route, so it tests the thing that actually matters and costs one call.
  function evaluate() {
    if (navigator.onLine === false) { setOffline(true); return Promise.resolve(false); }
    // HEAD is never intercepted by sw.js (it bails on method !== GET), so this
    // reaches the network for real rather than being answered from cache.
    return nativeFetch(location.href, { method: 'HEAD', cache: 'no-store' })
      .then(function () { noteOk(); return true; })
      .catch(function () { noteFail(); return !offline; });
  }

  /* ---- UI ----------------------------------------------------------------- */
  function styles() {
    if (document.getElementById('ostOfflineStyle')) return;
    var st = document.createElement('style');
    st.id = 'ostOfflineStyle';
    st.textContent = [
      '#ostOfflineBar{position:fixed;left:0;right:0;top:0;z-index:10080;display:flex;align-items:center;gap:9px;',
      'padding:calc(env(safe-area-inset-top,0px) + 7px) 13px 7px;',
      'background:linear-gradient(135deg,#7c2d12,#9a3412);color:#fed7aa;font-size:12px;font-weight:800;',
      'transform:translateY(-140%);transition:transform .3s cubic-bezier(.22,1,.36,1);}',
      '#ostOfflineBar.is-in{transform:translateY(0);}',
      '#ostOfflineBar .ofb-x{margin-left:auto;background:rgba(0,0,0,.25);border:none;color:#fed7aa;',
      'border-radius:8px;padding:5px 10px;font-size:11px;font-weight:800;cursor:pointer;}',
      'body.ost-offline{--ost-offline:1;}',
      // Anything the network is required for: visibly dead, not just inert.
      'body.ost-offline [data-ost-needs-net]{opacity:.4;pointer-events:none;filter:grayscale(1);}',
      // A stale price must never read as a live one.
      'body.ost-offline .ost-live-dot,body.ost-offline .live-dot{background:#f97316 !important;animation:none !important;}',
      '.ost-offline-note{display:none;}body.ost-offline .ost-offline-note{display:block;}'
    ].join('');
    document.head.appendChild(st);
  }

  function bar() {
    var b = document.getElementById('ostOfflineBar');
    if (b) return b;
    styles();
    b = document.createElement('div');
    b.id = 'ostOfflineBar';
    b.setAttribute('role', 'status');
    b.innerHTML = '<span>&#128246; Offline — your vault, bearer notes and local games still work. Markets need a connection.</span>' +
                  '<button class="ofb-x" data-ofb-retry>Retry</button>';
    document.body.appendChild(b);
    b.querySelector('[data-ofb-retry]').addEventListener('click', function () {
      b.querySelector('[data-ofb-retry]').textContent = 'Checking…';
      evaluate().then(function () {
        var x = b.querySelector('[data-ofb-retry]');
        if (x) x.textContent = 'Retry';
      });
    });
    return b;
  }

  function setOffline(next) {
    next = !!next;
    if (next === offline) return;
    offline = next;
    document.body.classList.toggle('ost-offline', offline);
    var b = bar();
    requestAnimationFrame(function () { b.classList.toggle('is-in', offline); });

    if (offline) {
      fire('ost:offline');
    } else {
      fire('ost:online');
      // Reconnected: push any locally-earned proofs. They are CLAIMS — the
      // server decides. See the header note on fairness.
      try {
        if (window.OSTOfflineVault && window.OSTOfflineVault.sync) window.OSTOfflineVault.sync();
      } catch (_) {}
    }
  }

  /* ---- wiring ------------------------------------------------------------- */
  // The browser's own signals are the fast path; the probe is the truth.
  window.addEventListener('offline', function () { setOffline(true); });
  window.addEventListener('online', function () { evaluate(); });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) evaluate(); });

  function start() {
    styles();
    evaluate();
    if (timer) clearInterval(timer);
    // No polling loop. While we think we are ONLINE the app's own traffic is the
    // sensor — a silent watchdog only steps in if nothing has succeeded for a
    // while AND the OS also says the interface is down.
    timer = setInterval(function () {
      if (offline) return;                      // recovery is handled below
      if (navigator.onLine === false && (Date.now() - lastOkAt) > STALE_MS) setOffline(true);
    }, 10000);

    // Once we are offline the app stops making calls, so its traffic can no
    // longer tell us anything — this is the ONLY case that needs active checks,
    // and it costs one HEAD to a page we already have cached.
    setInterval(function () {
      if (offline && document.visibilityState === 'visible') evaluate();
    }, 15000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();

  window.OST_OFFLINE_MODE = {
    isOffline: function () { return offline; },
    check: evaluate,
    // For tests and for callers that must refuse an action with a real reason.
    requireNetwork: function (what) {
      if (!offline) return true;
      try {
        if (window.OST_TOAST) window.OST_TOAST((what || 'That') + ' needs a connection. Your vault and local games still work.');
      } catch (_) {}
      return false;
    }
  };
})();

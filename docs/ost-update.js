/* ==========================================================================
 * OST · Update — the app keeps itself current, like an app should
 * --------------------------------------------------------------------------
 * THE BUG THIS EXISTS TO KILL
 *
 * Before this file, OST registered a service worker and never spoke to it
 * again. There was no `updatefound` listener, no `controllerchange` listener,
 * no `reg.update()` anywhere in the codebase. Consequences, both real:
 *
 *  1. A shipped fix reached nobody. The browser would eventually notice a new
 *     sw.js on its own schedule, but the OPEN page went on running whatever JS
 *     it booted with. Testers sat on builds that were days old and reported bugs
 *     that had already been fixed — the only cure anyone knew was a hard refresh,
 *     which is not a thing you can ask real users to do.
 *  2. sw.js called skipWaiting() on install, so a new worker seized a live page
 *     and served IT new assets while it still ran old code. Version skew.
 *
 * sw.js now only skipWaiting()s on a FIRST install. On an update it waits, and
 * this file is what decides when the swap happens: ask the user, then reload
 * exactly once.
 *
 * WHY WE ASK INSTEAD OF AUTO-RELOADING
 * A reload mid-bet loses the ticket the user is looking at. OST holds money and
 * in-flight state; yanking the page out from under someone to save them one tap
 * is not a trade worth making. We offer, they choose, and we never nag.
 * ========================================================================== */
(function () {
  'use strict';
  if (window.OST_UPDATE) return;
  if (!('serviceWorker' in navigator)) return;

  // How often to ASK the network whether a new build exists. The browser checks
  // on navigation anyway; this covers installed PWAs that stay open for days and
  // would otherwise never navigate.
  var CHECK_MS = 30 * 60 * 1000;

  var reloading = false;
  var reg = null;
  var barShown = false;

  function styles() {
    if (document.getElementById('ostUpdateStyle')) return;
    var st = document.createElement('style');
    st.id = 'ostUpdateStyle';
    st.textContent = [
      '#ostUpdate{position:fixed;left:12px;right:12px;z-index:10070;',
      'bottom:calc(env(safe-area-inset-bottom,0px) + 74px);',   // clear the mobile tab bar
      'display:flex;align-items:center;gap:10px;padding:11px 13px;border-radius:14px;',
      'background:linear-gradient(135deg,rgba(13,22,41,.98),rgba(9,14,28,.98));',
      'border:1px solid rgba(52,211,153,.35);box-shadow:0 10px 34px rgba(0,0,0,.5);',
      'transform:translateY(140%);transition:transform .32s cubic-bezier(.22,1,.36,1);}',
      '#ostUpdate.is-in{transform:translateY(0);}',
      '@media(min-width:900px){#ostUpdate{left:auto;right:18px;bottom:18px;max-width:400px;}}',
      '.ou-dot{width:8px;height:8px;border-radius:50%;background:#34d399;flex:0 0 auto;',
      'box-shadow:0 0 0 0 rgba(52,211,153,.6);animation:ouPulse 2s infinite;}',
      '@keyframes ouPulse{70%{box-shadow:0 0 0 9px rgba(52,211,153,0);}100%{box-shadow:0 0 0 0 rgba(52,211,153,0);}}',
      '.ou-txt{flex:1;min-width:0;color:#e2e8f0;font-size:12.5px;font-weight:700;line-height:1.35;}',
      '.ou-txt b{display:block;font-size:13px;}',
      '.ou-txt span{display:block;color:#94a3b8;font-weight:600;font-size:11px;}',
      '.ou-go{border:none;border-radius:10px;padding:8px 13px;font-size:12px;font-weight:800;cursor:pointer;',
      'background:linear-gradient(135deg,#34d399,#059669);color:#04121a;flex:0 0 auto;}',
      '.ou-x{background:transparent;border:none;color:#64748b;font-size:17px;cursor:pointer;',
      'flex:0 0 auto;padding:0 2px;line-height:1;}'
    ].join('');
    document.head.appendChild(st);
  }

  function apply(waiting) {
    if (!waiting || reloading) return;
    reloading = true;
    // The worker calls skipWaiting(); the browser then fires controllerchange,
    // which is where we reload. Reloading here instead would race the swap and
    // could load the old build one more time.
    try { waiting.postMessage({ type: 'OST_SKIP_WAITING' }); } catch (_) { reloading = false; }
  }

  function showBar(waiting) {
    if (barShown) return;
    barShown = true;
    styles();
    var bar = document.createElement('div');
    bar.id = 'ostUpdate';
    bar.setAttribute('role', 'status');
    bar.innerHTML =
      '<span class="ou-dot"></span>' +
      '<span class="ou-txt"><b>New version of OST is ready</b>' +
      '<span>Reload to get it. Your balance and open bets are safe.</span></span>' +
      '<button class="ou-go" data-ou-go>Reload</button>' +
      '<button class="ou-x" data-ou-x aria-label="Later">×</button>';
    document.body.appendChild(bar);
    requestAnimationFrame(function () { bar.classList.add('is-in'); });

    bar.querySelector('[data-ou-go]').addEventListener('click', function () {
      bar.querySelector('.ou-go').textContent = 'Updating…';
      apply(waiting);
    });
    bar.querySelector('[data-ou-x]').addEventListener('click', function () {
      bar.classList.remove('is-in');
      setTimeout(function () { try { bar.remove(); } catch (_) {} }, 340);
      // Deliberately not re-shown this session. The update still installs on the
      // next natural navigation — declining costs the user nothing but nagging
      // them costs us their patience.
    });
  }

  // A worker sitting in `waiting` means a new build is precached and ready.
  function onWaiting(r) {
    if (!r || !r.waiting) return;
    // No controller = this is the FIRST install, not an update. Nothing to
    // reload for — the page it would refresh is already the newest thing there
    // is. Showing "new version ready" on a first visit is just confusing.
    if (!navigator.serviceWorker.controller) return;
    showBar(r.waiting);
  }

  function watch(r) {
    reg = r;
    onWaiting(r);                       // already waiting from a previous visit
    r.addEventListener('updatefound', function () {
      var sw = r.installing;
      if (!sw) return;
      sw.addEventListener('statechange', function () {
        if (sw.state === 'installed') onWaiting(r);
      });
    });
  }

  function check() {
    if (!reg) return;
    // Can throw if the registration is gone (unregistered / storage cleared).
    try { reg.update(); } catch (_) {}
  }

  navigator.serviceWorker.getRegistration().then(function (r) {
    if (r) watch(r);
    else navigator.serviceWorker.ready.then(watch).catch(function () {});
  }).catch(function () {});

  // Exactly one reload, ever. Without this guard a worker that claims clients
  // can fire controllerchange again and put the page in a reload loop — which
  // looks identical to "the app is broken" and is far worse than a stale build.
  navigator.serviceWorker.addEventListener('controllerchange', function () {
    if (!reloading) return;      // a swap we did not initiate: leave it alone
    reloading = false;
    window.location.reload();
  });

  setInterval(check, CHECK_MS);
  // Coming back to a backgrounded PWA is the moment a stale build is most
  // likely and most visible, so check then too.
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) check();
  });
  window.addEventListener('online', check);

  window.OST_UPDATE = {
    check: check,
    // For manual verification: OST_UPDATE.state() in the console.
    state: function () {
      return {
        controller: !!navigator.serviceWorker.controller,
        waiting: !!(reg && reg.waiting),
        installing: !!(reg && reg.installing),
        barShown: barShown
      };
    }
  };
})();

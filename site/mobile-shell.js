/* OST Mobile Shell runtime */
(function () {
  'use strict';

  var MOBILE_QUERY = '(max-width: 820px), (pointer: coarse) and (max-width: 1024px)';
  var MOBILE_VIEWPORT = 'width=device-width, initial-scale=1.0, viewport-fit=cover';
  var mq = window.matchMedia ? window.matchMedia(MOBILE_QUERY) : { matches: false, addEventListener: null };
  var originalTradeLabel = null;

  function hasMobileSignal() {
    if (window.OST_MOBILE_FASTBOOT) return true;
    try {
      if (window.innerWidth && window.innerWidth <= 820) return true;
      if (window.visualViewport && window.visualViewport.width && window.visualViewport.width <= 820) return true;
      if (window.screen && Math.min(window.screen.width || 9999, window.screen.height || 9999) <= 820) return true;
      if (navigator.maxTouchPoints > 1 && window.screen && Math.min(window.screen.width || 9999, window.screen.height || 9999) <= 1366) return true;
      if (/Android|iPhone|iPad|iPod|IEMobile|Opera Mini|Mobile/i.test(navigator.userAgent || '')) return true;
    } catch (_) {}
    return false;
  }

  function isMobileShell() {
    return !!((mq && mq.matches) || hasMobileSignal());
  }

  function setViewport() {
    var meta = document.querySelector('meta[name="viewport"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.setAttribute('name', 'viewport');
      document.head.appendChild(meta);
    }
    if (isMobileShell()) meta.setAttribute('content', MOBILE_VIEWPORT);
  }

  function unblockInitialMobileAccess() {
    if (!isMobileShell()) return;
    try {
      var prefs = JSON.parse(localStorage.getItem('ost_prefs') || '{}');
      localStorage.setItem('ost_prefs', JSON.stringify({
        lang: prefs.lang || document.documentElement.getAttribute('data-lang') || 'en',
        currency: prefs.currency || window.__ostCurrency || 'USD'
      }));
      sessionStorage.setItem('ost.welcome.seen.session', '1');
      localStorage.setItem('ost.tour.completed', '1');
      localStorage.setItem('ost.compartments.guideSeen.v1', '1');
      localStorage.setItem('ost.compartments.v1', JSON.stringify(Object.assign({}, JSON.parse(localStorage.getItem('ost.compartments.v1') || '{}'), { focusMode: false })));
    } catch (_) {}

    var welcome = document.getElementById('welcomeOverlay');
    if (welcome) {
      welcome.classList.add('hidden');
      welcome.setAttribute('aria-hidden', 'true');
      welcome.style.display = 'none';
      welcome.style.pointerEvents = 'none';
    }

    document.querySelectorAll('.ost-guide-overlay, .ost-tour.is-open').forEach(function (overlay) {
      overlay.classList.remove('is-open');
      overlay.style.display = 'none';
      overlay.setAttribute('aria-hidden', 'true');
    });

    document.querySelectorAll('.ost-section-hidden').forEach(function (section) {
      section.classList.remove('ost-section-hidden');
    });
    if (window.OST_COMPARTMENTS && typeof window.OST_COMPARTMENTS.showAll === 'function') {
      window.OST_COMPARTMENTS.showAll();
    } else if (window.OST_COMPARTMENTS && window.OST_COMPARTMENTS.focusMode && typeof window.OST_COMPARTMENTS.toggleFocus === 'function') {
      window.OST_COMPARTMENTS.toggleFocus();
    }
  }

  function activateSection(id, tab) {
    if (!id) return;
    if (window.OST_COMPARTMENTS && typeof window.OST_COMPARTMENTS.activate === 'function') {
      window.OST_COMPARTMENTS.activate(id, true);
    } else {
      window.location.hash = id;
    }
    if (tab) {
      window.setTimeout(function () {
        var walletTab = document.querySelector('[data-wallet-tab="' + tab + '"]');
        var storeTab = document.querySelector('[data-store-tab="' + tab + '"]');
        var genericTab = walletTab || storeTab || document.querySelector('[data-tab="' + tab + '"]');
        if (genericTab && typeof genericTab.click === 'function') genericTab.click();
      }, 220);
    }
  }

  function mountMobileHome() {
    if (document.getElementById('ostMobileHome')) return;
    var heroCopy = document.querySelector('#home .hero-content');
    if (!heroCopy) return;

    var shell = document.createElement('div');
    shell.id = 'ostMobileHome';
    shell.className = 'ost-mobile-home';
    shell.setAttribute('aria-label', 'OST mobile command center');
    shell.innerHTML = [
      '<div class="ost-mobile-home__top">',
        '<span class="ost-mobile-home__eyebrow">Mobile command center</span>',
        '<strong>Open the real OST rails without hunting through the page.</strong>',
        '<p>Wallet, converter, Mesh, games, commerce, and onboarding now start from one phone-first launcher.</p>',
      '</div>',
      '<div class="ost-mobile-home__grid">',
        '<button type="button" class="ost-mobile-home__action is-primary" data-mobile-route="wallet" data-mobile-tab="access"><span>Wallet</span><small>Create, connect, receive, and back up.</small></button>',
        '<button type="button" class="ost-mobile-home__action" data-mobile-route="wallet" data-mobile-tab="convert"><span>Convert</span><small>SOL to OST, fiat, and transfer rail.</small></button>',
        '<button type="button" class="ost-mobile-home__action" data-mobile-route="commerce"><span>Spend</span><small>Shop, gift cards, gas, and checkout.</small></button>',
        '<button type="button" class="ost-mobile-home__action" data-mobile-route="new-here"><span>Get OST</span><small>Faucet, top-up, and first balance.</small></button>',
        '<button type="button" class="ost-mobile-home__action" data-mobile-mesh><span>Mesh</span><small>Chat, call, map ping, and share.</small></button>',
        '<button type="button" class="ost-mobile-home__action" data-mobile-games><span>Fair Games</span><small>Open Arena inside OST Mesh.</small></button>',
      '</div>',
      '<div class="ost-mobile-home__status"><span>Live devnet app</span><p>Touch targets, popouts, and bottom navigation are managed as one mobile shell.</p></div>'
    ].join('');

    var anchor = heroCopy.querySelector('.hero-free-banner') || heroCopy.querySelector('.hero-sub');
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(shell, anchor.nextSibling);
    else heroCopy.appendChild(shell);

    shell.addEventListener('click', function (event) {
      var route = event.target.closest('[data-mobile-route]');
      if (route) {
        activateSection(route.getAttribute('data-mobile-route'), route.getAttribute('data-mobile-tab'));
        return;
      }
      if (event.target.closest('[data-mobile-mesh]')) {
        if (window.OST_MESH && typeof window.OST_MESH.open === 'function') window.OST_MESH.open();
        else activateSection('wallet');
        return;
      }
      if (event.target.closest('[data-mobile-games]')) {
        if (window.OST_MESH_ARENA && typeof window.OST_MESH_ARENA.open === 'function') window.OST_MESH_ARENA.open();
        else if (window.OST_MESH && typeof window.OST_MESH.open === 'function') window.OST_MESH.open();
        else activateSection('new-here');
      }
    });
  }

  function tuneFloatingControls() {
    var mobile = isMobileShell();
    document.body.classList.toggle('ost-mobile-shell', mobile);
    if (mobile) {
      document.body.classList.remove('ost-force-desktop');
      try {
        if (localStorage.getItem('ost.viewport') === 'desktop') localStorage.setItem('ost.viewport', 'mobile');
      } catch (_) {}
      setViewport();
      unblockInitialMobileAccess();
    }

    var mesh = document.querySelector('#ost-mesh-trigger');
    if (mesh) {
      mesh.classList.toggle('ost-mobile-fab', mobile);
      mesh.classList.toggle('ost-mobile-fab--mesh', mobile);
      if (!mesh.getAttribute('aria-label')) mesh.setAttribute('aria-label', 'Open OST Mesh');
    }

    var ghost = document.querySelector('#ghost-summon-trigger');
    if (ghost) {
      ghost.classList.toggle('ost-mobile-fab', mobile);
      ghost.classList.toggle('ost-mobile-fab--ghost', mobile);
      if (!ghost.getAttribute('aria-label')) ghost.setAttribute('aria-label', 'Open Ghost');
    }

    var trade = document.querySelector('.ost-tradepop__launcher');
    if (trade) {
      trade.classList.toggle('ost-mobile-fab', mobile);
      trade.classList.toggle('ost-mobile-fab--trade', mobile);
      if (!trade.getAttribute('aria-label')) trade.setAttribute('aria-label', 'Open trade ticket');
      if (originalTradeLabel == null) originalTradeLabel = trade.textContent;
      if (mobile) trade.textContent = 'Trade';
      else if (originalTradeLabel) trade.textContent = originalTradeLabel;
    }
  }

  function boot() {
    if (boot._started) {
      unblockInitialMobileAccess();
      tuneFloatingControls();
      return;
    }
    boot._started = true;
    unblockInitialMobileAccess();
    mountMobileHome();
    tuneFloatingControls();
    window.addEventListener('resize', function () {
      window.clearTimeout(boot._resizeTimer);
      boot._resizeTimer = window.setTimeout(tuneFloatingControls, 120);
    });

    if (mq && typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', tuneFloatingControls);
    } else if (mq && typeof mq.addListener === 'function') {
      mq.addListener(tuneFloatingControls);
    }

    var observer = new MutationObserver(function () {
      window.clearTimeout(boot._observerTimer);
      boot._observerTimer = window.setTimeout(tuneFloatingControls, 120);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    window.setTimeout(tuneFloatingControls, 600);
    window.setTimeout(tuneFloatingControls, 1800);
  }

  setViewport();
  if (document.body) boot();
  else if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  window.setTimeout(unblockInitialMobileAccess, 0);
  window.setTimeout(unblockInitialMobileAccess, 500);
})();
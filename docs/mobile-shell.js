/* OST Mobile Shell runtime */
(function () {
  'use strict';

  var mobileUtil = window.OST_MOBILE || null;
  var MOBILE_QUERY = (mobileUtil && mobileUtil.query) || '(max-width: 820px), (pointer: coarse) and (max-width: 1024px)';
  var MOBILE_VIEWPORT = (mobileUtil && mobileUtil.viewportContent) || 'width=device-width, initial-scale=1.0, viewport-fit=cover';
  var mq = window.matchMedia ? window.matchMedia(MOBILE_QUERY) : { matches: false, addEventListener: null };
  var originalTradeLabel = null;
  var tuneScheduled = false;

  function isMobileShell() {
    if (mobileUtil && typeof mobileUtil.isMobile === 'function') return mobileUtil.isMobile();
    return !!(mq && mq.matches);
  }

  function setViewport() {
    if (mobileUtil && typeof mobileUtil.applyViewport === 'function') {
      mobileUtil.applyViewport();
      return;
    }
    var meta = document.querySelector('meta[name="viewport"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.setAttribute('name', 'viewport');
      document.head.appendChild(meta);
    }
    meta.setAttribute('content', MOBILE_VIEWPORT);
  }

  function applyMobileAccessDefaults() {
    if (mobileUtil && typeof mobileUtil.applyAccessDefaults === 'function') {
      mobileUtil.applyAccessDefaults();
      return;
    }
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
  }

  function unblockInitialMobileAccess() {
    if (!isMobileShell()) return;
    applyMobileAccessDefaults();
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
    if (!isMobileShell() || document.getElementById('ostMobileHome')) return;
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
      mountMobileHome();
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

  function scheduleTune() {
    if (tuneScheduled) return;
    tuneScheduled = true;
    window.requestAnimationFrame(function () {
      tuneScheduled = false;
      tuneFloatingControls();
    });
  }

  function boot() {
    if (boot._started) {
      scheduleTune();
      return;
    }
    boot._started = true;
    unblockInitialMobileAccess();
    mountMobileHome();
    tuneFloatingControls();

    window.addEventListener('resize', scheduleTune);
    window.addEventListener('load', scheduleTune, { once: true });
    window.addEventListener('ost:mobile-fastboot', scheduleTune);
    window.addEventListener('ost:wallet-changed', scheduleTune);
    window.addEventListener('ost:mesh-ready', scheduleTune);
    window.addEventListener('ost:ghost-ready', scheduleTune);
    window.addEventListener('ost:tradepop-ready', scheduleTune);
    window.addEventListener('ost:mobile-shell-refresh', scheduleTune);

    if (mq && typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', scheduleTune);
    } else if (mq && typeof mq.addListener === 'function') {
      mq.addListener(scheduleTune);
    }
  }

  setViewport();
  if (document.body) boot();
  else if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();

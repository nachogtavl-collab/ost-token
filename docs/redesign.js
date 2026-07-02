/* ============================================================
   redesign.js — OST Phase 3 runtime polish (loaded last)
   - Replaces remaining childish glyphs in nav (wallet, lang, menu)
     with OST_ICON Lucide icons.
   - Wires the mobile nav drawer toggle.
   - Marks the active nav link based on scroll position.
   - Hides any stale prediction widget that lives outside the
     dedicated Wallet > Predict tab (the prediction board now
     lives at #wallet-panel-predict).
   - Hardens Ghost AI + Mesh by guarding the ost:mesh-payload bus
     so a thrown listener cannot poison sibling modules.
   - Smoke-checks every required section is mounted.
   Safe to load multiple times; idempotent.
   ============================================================ */
(function () {
  'use strict';
  if (window.__OST_REDESIGN_LOADED__) return;
  window.__OST_REDESIGN_LOADED__ = true;

  function ready(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn, { once: true });
    else fn();
  }

  function safeIcon(name, opts) {
    try {
      if (typeof window.OST_ICON !== 'function') return '';
      return window.OST_ICON(name, opts || {});
    } catch (_) { return ''; }
  }

  /* ---------- 1. Modernize nav glyphs ---------- */
  function modernizeNav() {
    var walletBtn = document.getElementById('walletBtn');
    if (walletBtn) {
      var icon = walletBtn.querySelector('.wallet-icon');
      if (icon && icon.dataset.ostModern !== '1') {
        var svg = safeIcon('wallet', { size: 18, label: 'Wallet' });
        if (svg) { icon.innerHTML = svg; icon.dataset.ostModern = '1'; }
      }
    }
    var langGlobe = document.querySelector('.lang-trigger .lang-globe');
    if (langGlobe && langGlobe.dataset.ostModern !== '1') {
      var gsvg = safeIcon('globe', { size: 16, label: 'Language' });
      if (gsvg) { langGlobe.innerHTML = gsvg; langGlobe.dataset.ostModern = '1'; }
    }
    var navToggle = document.getElementById('navToggle');
    if (navToggle && navToggle.dataset.ostModern !== '1') {
      var msvg = safeIcon('menu', { size: 20, label: 'Menu' });
      if (msvg) { navToggle.innerHTML = msvg; navToggle.dataset.ostModern = '1'; }
    }
  }

  /* ---------- 2. Mobile nav drawer ---------- */
  function wireMobileNav() {
    var nav = document.getElementById('nav');
    var toggle = document.getElementById('navToggle');
    if (!nav || !toggle || toggle.dataset.ostNavWired === '1') return;
    toggle.dataset.ostNavWired = '1';
    toggle.addEventListener('click', function (e) {
      e.preventDefault();
      nav.classList.toggle('is-mobile-open');
      toggle.setAttribute('aria-expanded', nav.classList.contains('is-mobile-open') ? 'true' : 'false');
    });
    // Close on link click (mobile)
    var links = document.querySelectorAll('#nav .nav-links a');
    for (var i = 0; i < links.length; i++) {
      links[i].addEventListener('click', function () {
        if (window.innerWidth <= 880) nav.classList.remove('is-mobile-open');
      });
    }
    // Close on Esc
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && nav.classList.contains('is-mobile-open')) {
        nav.classList.remove('is-mobile-open');
        toggle.setAttribute('aria-expanded', 'false');
      }
    });
  }

  /* ---------- 3. Active nav link (scroll spy, mobile + desktop) ---------- */
  function wireScrollSpy() {
    var links = Array.prototype.slice.call(document.querySelectorAll('#nav .nav-links a[href^="#"]'));
    if (!links.length) return;
    var sections = links
      .map(function (a) {
        var id = a.getAttribute('href').slice(1);
        var el = id ? document.getElementById(id) : null;
        return el ? { link: a, el: el } : null;
      })
      .filter(Boolean);
    if (!sections.length) return;

    function update() {
      var scrollY = window.scrollY + 120;
      var current = null;
      for (var i = 0; i < sections.length; i++) {
        var top = sections[i].el.offsetTop;
        if (scrollY >= top) current = sections[i];
        else break;
      }
      links.forEach(function (a) { a.classList.remove('active'); });
      if (current) current.link.classList.add('active');
    }
    var ticking = false;
    window.addEventListener('scroll', function () {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(function () { update(); ticking = false; });
    }, { passive: true });
    update();
  }

  /* ---------- 4. Hide stale prediction widget outside Wallet > Predict tab ---------- */
  function relocatePrediction() {
    var boards = document.querySelectorAll('.prediction-market-board');
    for (var i = 0; i < boards.length; i++) {
      var b = boards[i];
      var inWalletPredict = b.closest('#wallet-panel-predict') ||
                            b.closest('.wallet-tab-panel[id$="predict"]');
      var inWallet = b.closest('#wallet');
      if (!inWalletPredict && !inWallet) {
        b.dataset.stale = 'true';
        b.setAttribute('hidden', 'hidden');
      }
    }
  }

  /* ---------- 5. Harden the mesh payload bus for Ghost + Mesh ---------- */
  function hardenMeshBus() {
    if (window.__OST_MESH_BUS_HARDENED__) return;
    window.__OST_MESH_BUS_HARDENED__ = true;
    var origAdd = window.addEventListener;
    window.addEventListener = function (type, listener, options) {
      if (type === 'ost:mesh-payload' && typeof listener === 'function' && !listener.__ostGuarded) {
        var guarded = function (event) {
          try { return listener.call(this, event); }
          catch (err) {
            try { console.warn('[OST] mesh-payload listener threw:', err && err.message); } catch (_) {}
          }
        };
        guarded.__ostGuarded = true;
        guarded.__ostOriginal = listener;
        return origAdd.call(this, type, guarded, options);
      }
      return origAdd.call(this, type, listener, options);
    };
  }

  /* ---------- 6. Smoke check required sections ---------- */
  var REQUIRED_SECTIONS = [
    'home','new-here','commerce','wallet','stock-market','ai','offline',
    'censorship','spacex','about','story','roadmap','build','launchpad',
    'survival','quantum-realm','legacy','transparency'
  ];
  function smokeCheck() {
    var missing = [];
    for (var i = 0; i < REQUIRED_SECTIONS.length; i++) {
      if (!document.getElementById(REQUIRED_SECTIONS[i])) missing.push(REQUIRED_SECTIONS[i]);
    }
    window.OST_REDESIGN = window.OST_REDESIGN || {};
    window.OST_REDESIGN.missingSections = missing;
    window.OST_REDESIGN.allSectionsPresent = missing.length === 0;
    if (missing.length) {
      try { console.warn('[OST] redesign smoke check: missing sections', missing); } catch (_) {}
    }
  }

  /* ---------- 7. Re-mount icons after dynamic inserts ---------- */
  function refreshIcons() {
    if (typeof window.OST_ICON_MOUNT === 'function') {
      try { window.OST_ICON_MOUNT(document); } catch (_) {}
    }
  }

  /* ---------- Init ---------- */
  // Harden the bus IMMEDIATELY (before any module subscribes); listeners
  // already attached cannot be wrapped, but new ones (Ghost awareness etc.)
  // benefit if this script loads first. We intentionally still run on DOMReady
  // for the rest.
  hardenMeshBus();

  ready(function () {
    try { modernizeNav(); } catch (e) {}
    try { wireMobileNav(); } catch (e) {}
    try { wireScrollSpy(); } catch (e) {}
    try { relocatePrediction(); } catch (e) {}
    try { refreshIcons(); } catch (e) {}
    try { smokeCheck(); } catch (e) {}
    // Re-run a few times to catch late-rendered widgets
    setTimeout(function () {
      try { modernizeNav(); relocatePrediction(); refreshIcons(); } catch (e) {}
    }, 1500);
    setTimeout(function () {
      try { modernizeNav(); relocatePrediction(); refreshIcons(); } catch (e) {}
    }, 4000);
  });

  window.OST_REDESIGN = window.OST_REDESIGN || {};
  window.OST_REDESIGN.refresh = function () {
    try { modernizeNav(); } catch (e) {}
    try { relocatePrediction(); } catch (e) {}
    try { refreshIcons(); } catch (e) {}
    try { smokeCheck(); } catch (e) {}
    return window.OST_REDESIGN.missingSections;
  };
  window.OST_REDESIGN.version = 1;
})();

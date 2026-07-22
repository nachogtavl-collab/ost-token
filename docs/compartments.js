/* ==========================================================================
   OST Compartments — focus-mode runtime
   - Detects all top-level sections (#home, #commerce, #wallet, etc.)
   - Builds a floating Command Dock with one icon per section
   - Toggles focus mode (only the active section is rendered)
   - Hash routing (#wallet, #commerce/giftcards) and keyboard shortcuts (1-9)
   - First-visit guide tour
   - Pure additive layer — does not move or rewrite any existing markup
   ========================================================================== */
(function () {
  'use strict';

  var STORE_KEY = 'ost.compartments.v1';
  var GUIDE_KEY = 'ost.compartments.guideSeen.v1';

  // Section definitions — id, label, icon, optional sub-tabs, default badge
  var SECTIONS = [
    { id: 'home',        label: 'Home',          icon: '🏠', desc: 'Vision · OST origin · the next step after Bitcoin' },
    { id: 'new-here',    label: 'Get OST',       icon: '🎁', desc: 'Faucets, family vaults, buy OSTG — first OST in 60 seconds', badge: 'Start' },
    { id: 'games',       label: 'Games',         icon: '🎮', desc: 'Faucet fair, offline, multiplayer, mesh, and device shortcuts', subs: ['fair','offline','multiplayer','mesh','shortcuts'] },
    { id: 'commerce',    label: 'Spend OST',     icon: '🛒', desc: 'Shop, gift cards, gas station, interchange', subs: ['shop','interchange','giftcards','fuel'] },
    { id: 'wallet',      label: 'Wallet',        icon: '👛', desc: 'Connect, swap, convert, prediction markets, launchpad', subs: ['access','market','convert','portals'], badge: 'Live' },
    { id: 'stock-market', label: 'Stocks',       icon: '📊', desc: 'Tokenized stock mirror — trade OST against equities' },
    { id: 'ai',          label: 'AI Agents',     icon: '🤖', desc: 'Bot connectors and machine intelligence' },
    { id: 'offline',     label: 'Offline',       icon: '📡', desc: 'NFC, QR, Bluetooth — pay without internet' },
    { id: 'citizens',    label: 'Citizens',      icon: '🌍', desc: 'Global map · 15 countries · unbanked rails' },
    { id: 'censorship',  label: 'Free Press',    icon: '📰', desc: 'Live news + censorship awareness' },
    { id: 'spacex',      label: 'SpaceX',        icon: '🚀', desc: 'Journey to space · interplanetary roadmap' },
    { id: 'about',       label: 'Mission',       icon: '🎯', desc: 'OST purpose and three pillars' },
    { id: 'story',       label: 'Story',         icon: '📖', desc: 'The real timeline behind OST' },
    { id: 'roadmap',     label: 'Roadmap',       icon: '🧭', desc: 'Progress, launch checklist, and next milestones' },
    { id: 'build',       label: 'Build',         icon: '🛠️', desc: 'Developers, creators, bounties, and contribution lanes' },
    { id: 'launchpad',   label: 'Launchpad',     icon: '🚀', desc: 'Create and discover OST-native coins' },
    { id: 'survival',    label: 'Survival',      icon: '⚠️', desc: 'Offline and post-disaster bearer cash' },
    { id: 'quantum-realm', label: 'Quantum',     icon: '⚛️', desc: 'Quantum-resistant and future-facing research' },
    { id: 'legacy',      label: 'Legacy',        icon: '🧬', desc: 'Extinction-proof long-term preservation' },
    { id: 'transparency', label: 'Verify',       icon: '🔍', desc: 'Contracts, repo, treasury, and public proof' }
  ];

  function isMobileViewport() {
    if (window.OST_MOBILE && typeof window.OST_MOBILE.isMobile === 'function') return window.OST_MOBILE.isMobile();
    try {
      if (window.matchMedia && window.matchMedia('(max-width: 820px), (pointer: coarse) and (max-width: 1024px)').matches) return true;
    } catch (e) {}
    var widths = [window.innerWidth || 9999];
    if (window.screen && window.screen.width) widths.push(window.screen.width);
    if (window.visualViewport && window.visualViewport.width) widths.push(window.visualViewport.width);
    return Math.min.apply(Math, widths) <= 820;
  }

  function $(s, root) { return (root || document).querySelector(s); }
  function $$(s, root) { return Array.prototype.slice.call((root || document).querySelectorAll(s)); }

  function loadSettings() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY) || '{}'); }
    catch (e) { return {}; }
  }
  function saveSettings(s) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch (e) {}
  }

  var state = {
    active: null,
    focusMode: false,
    settings: loadSettings()
  };
  // Mobile is an APP: always one section at a time (focus mode on), navigated by
  // the bottom app bar. Desktop keeps the classic full-scroll unless the user
  // opted into focus mode via the dock.
  if (isMobileViewport()) state.focusMode = true;
  else if (state.settings.focusMode === true && state.settings.focusModeUserSet === true) state.focusMode = true;

  // -------------------------------------------------------------- Build dock
  var dock, breadcrumb, breadcrumbIcon, breadcrumbLabel, breadcrumbToggle;

  function buildDock() {
    if ($('.ost-dock')) return;
    dock = document.createElement('aside');
    dock.className = 'ost-dock';
    dock.setAttribute('role', 'navigation');
    dock.setAttribute('aria-label', 'OST quick navigation');

    SECTIONS.forEach(function (s, i) {
      if (!document.getElementById(s.id)) return; // skip if section not in DOM
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ost-dock-btn';
      btn.dataset.target = s.id;
      btn.dataset.label = s.label + (i < 9 ? ' · ⌘' + (i + 1) : '');
      btn.setAttribute('aria-label', s.label);
      btn.innerHTML = '<span aria-hidden="true">' + s.icon + '</span>';
      if (s.badge) {
        var badge = document.createElement('span');
        badge.className = 'ost-dock-badge';
        badge.textContent = s.badge;
        btn.appendChild(badge);
      }
      btn.addEventListener('click', function () { activateSection(s.id, true); });
      dock.appendChild(btn);
    });

    // Divider
    var div = document.createElement('div');
    div.className = 'ost-dock-divider';
    dock.appendChild(div);

    // "Show all" toggle button
    var allBtn = document.createElement('button');
    allBtn.type = 'button';
    allBtn.className = 'ost-dock-btn';
    allBtn.dataset.label = state.focusMode ? 'Show everything (Esc)' : 'Focus mode';
    allBtn.innerHTML = '<span aria-hidden="true">' + (state.focusMode ? '👁️' : '🎯') + '</span>';
    allBtn.addEventListener('click', toggleFocusMode);
    allBtn.id = 'ostFocusToggle';
    dock.appendChild(allBtn);

    document.body.appendChild(dock);
  }

  function buildBreadcrumb() {
    if ($('.ost-breadcrumb')) return;
    breadcrumb = document.createElement('div');
    breadcrumb.className = 'ost-breadcrumb';
    breadcrumb.setAttribute('role', 'status');
    breadcrumb.innerHTML =
      '<span class="ost-breadcrumb-icon" aria-hidden="true">🎯</span>' +
      '<span class="ost-breadcrumb-label">Focus</span>' +
      '<button type="button" class="ost-breadcrumb-toggle" aria-label="Show all sections">Show all</button>';
    breadcrumbIcon = breadcrumb.querySelector('.ost-breadcrumb-icon');
    breadcrumbLabel = breadcrumb.querySelector('.ost-breadcrumb-label');
    breadcrumbToggle = breadcrumb.querySelector('.ost-breadcrumb-toggle');
    breadcrumbToggle.addEventListener('click', toggleFocusMode);
    document.body.appendChild(breadcrumb);
  }

  // -------------------------------------------------------------- Activation
  function getSectionEl(id) {
    return id ? document.getElementById(id) : null;
  }

  function applyFocusClasses() {
    // Mobile always stays app-like (one section at a time).
    if (isMobileViewport() && !state.focusMode) {
      state.focusMode = true;
    }
    var present = SECTIONS.map(function (s) { return s.id; });
    SECTIONS.forEach(function (s) {
      var el = getSectionEl(s.id);
      if (!el) return;
      el.classList.remove('ost-section-active', 'ost-section-hidden');
      if (state.focusMode) {
        if (s.id === state.active) el.classList.add('ost-section-active');
        else el.classList.add('ost-section-hidden');
      }
    });
    document.body.classList.toggle('ost-focus-mode', state.focusMode);

    // Update dock highlight
    if (dock) {
      $$('.ost-dock-btn', dock).forEach(function (btn) {
        if (btn.dataset.target === state.active) btn.setAttribute('aria-current', 'true');
        else btn.removeAttribute('aria-current');
      });
    }

    // Update breadcrumb
    if (breadcrumb) {
      var def = SECTIONS.find(function (s) { return s.id === state.active; });
      if (def) {
        breadcrumbIcon.textContent = def.icon;
        breadcrumbLabel.textContent = def.label;
      }
    }
  }

  function activateSection(id, scrollToTop) {
    var def = SECTIONS.find(function (s) { return s.id === id; });
    if (!def) return;
    var el = getSectionEl(id);
    if (!el) return;

    var prev = state.active;
    state.active = id;

    // Brief "leaving" animation on previous active
    if (prev && prev !== id) {
      var prevEl = getSectionEl(prev);
      if (prevEl && state.focusMode) {
        prevEl.classList.add('ost-section-leaving');
        setTimeout(function () { prevEl.classList.remove('ost-section-leaving'); }, 240);
      }
    }

    applyFocusClasses();

    // Update URL hash without triggering scroll jank
    if (history.replaceState) history.replaceState(null, '', '#' + id);

    if (scrollToTop) {
      // Wait one frame so display:block takes effect, then scroll
      requestAnimationFrame(function () {
        var rect = el.getBoundingClientRect();
        var topOffset = window.pageYOffset + rect.top - 64;
        window.scrollTo({ top: Math.max(0, topOffset), behavior: 'smooth' });
      });
    }

    // Tell anything listening (e.g. wallet panels) that we landed
    document.dispatchEvent(new CustomEvent('ost:compartment', { detail: { id: id, prev: prev } }));
  }

  function toggleFocusMode() {
    if (isMobileViewport()) {
      // No "show everything" on mobile — the app model is one section at a time.
      state.focusMode = true;
      applyFocusClasses();
      return;
    }
    state.focusMode = !state.focusMode;
    state.settings.focusMode = state.focusMode;
    state.settings.focusModeUserSet = true;
    saveSettings(state.settings);
    var toggle = document.getElementById('ostFocusToggle');
    if (toggle) {
      toggle.dataset.label = state.focusMode ? 'Show everything (Esc)' : 'Focus mode';
      toggle.innerHTML = '<span aria-hidden="true">' + (state.focusMode ? '👁️' : '🎯') + '</span>';
    }
    if (breadcrumbToggle) breadcrumbToggle.textContent = state.focusMode ? 'Show all' : 'Focus mode';
    applyFocusClasses();
  }

  // -------------------------------------------------------------- Hash + nav routing
  function syncFromHash() {
    var hash = (location.hash || '').replace(/^#/, '').split('?')[0].split('/')[0];
    if (!hash) return;
    var def = SECTIONS.find(function (s) { return s.id === hash; });
    if (def) activateSection(def.id, false);
  }

  function wireExistingNav() {
    // Capture clicks on existing in-page anchors so they trigger compartment switch
    document.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('a[href^="#"]');
      if (!a) return;
      var href = a.getAttribute('href') || '';
      var target = href.replace(/^#/, '').split('?')[0].split('/')[0];
      if (!target) return;
      if (SECTIONS.find(function (s) { return s.id === target; })) {
        e.preventDefault();
        activateSection(target, true);
      }
    }, true);
  }

  function wireKeyboard() {
    document.addEventListener('keydown', function (e) {
      // Number shortcuts 1-9 jump between sections (when not typing)
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      var tag = (e.target && e.target.tagName) || '';
      if (/INPUT|TEXTAREA|SELECT/.test(tag) || (e.target && e.target.isContentEditable)) return;
      if (e.key === 'Escape') {
        if (state.focusMode) toggleFocusMode();
        return;
      }
      var n = parseInt(e.key, 10);
      if (n >= 1 && n <= SECTIONS.length) {
        var def = SECTIONS[n - 1];
        if (def && getSectionEl(def.id)) {
          e.preventDefault();
          activateSection(def.id, true);
        }
      }
    });
  }

  // -------------------------------------------------------------- Section header chips
  function injectSectionChips() {
    SECTIONS.forEach(function (s) {
      var el = getSectionEl(s.id);
      if (!el || el.querySelector(':scope > .ost-section-chip')) return;
      var chip = document.createElement('div');
      chip.className = 'ost-section-chip';
      chip.innerHTML =
        '<span class="ost-section-chip-icon" aria-hidden="true">' + s.icon + '</span>' +
        '<span>' + s.label + '</span>';
      // Insert at top of section
      el.insertBefore(chip, el.firstChild);
    });
  }

  // -------------------------------------------------------------- First-visit guide
  function showGuide() {
    if (!state.focusMode) {
      try { localStorage.setItem(GUIDE_KEY, '1'); } catch (e) {}
      return;
    }
    if (isMobileViewport()) {
      try { localStorage.setItem(GUIDE_KEY, '1'); } catch (e) {}
      return;
    }
    if (localStorage.getItem(GUIDE_KEY)) return;
    var pages = [
      {
        emoji: '🎯',
        title: 'Focus mode is on',
        body: 'We used to show every section at once and that was overwhelming. Now you see one area at a time, switch via the dock on the right (or bottom on mobile).'
      },
      {
        emoji: '⌨️',
        title: 'Quick keys',
        body: 'Press 1-9 to jump between sections. Press <strong>Esc</strong> any time to see everything at once again.'
      },
      {
        emoji: '👛',
        title: 'Where to start?',
        body: 'New here? Tap <strong>Get OST</strong> for a free OST drop. Already have OST? Hit <strong>Wallet</strong> to swap, predict, or launch a memecoin.'
      }
    ];
    var idx = 0;
    var overlay = document.createElement('div');
    overlay.className = 'ost-guide-overlay';
    var card = document.createElement('div');
    card.className = 'ost-guide-card';
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    function render() {
      var p = pages[idx];
      var dots = pages.map(function (_, i) {
        return '<span class="ost-guide-dot' + (i === idx ? ' is-active' : '') + '"></span>';
      }).join('');
      card.innerHTML =
        '<div class="ost-guide-emoji" aria-hidden="true">' + p.emoji + '</div>' +
        '<h3>' + p.title + '</h3>' +
        '<p>' + p.body + '</p>' +
        '<div class="ost-guide-actions">' +
          (idx > 0 ? '<button type="button" class="btn btn-outline" data-guide="back">Back</button>' : '') +
          (idx < pages.length - 1
            ? '<button type="button" class="btn btn-primary" data-guide="next">Next</button>'
            : '<button type="button" class="btn btn-primary" data-guide="done">Got it</button>') +
          ' <button type="button" class="btn btn-ghost" data-guide="skip" style="background:transparent;border-color:transparent;color:#94a3b8;">Skip</button>' +
        '</div>' +
        '<div class="ost-guide-dots">' + dots + '</div>';
    }

    overlay.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-guide]');
      if (!btn) {
        if (e.target === overlay) close();
        return;
      }
      var act = btn.getAttribute('data-guide');
      if (act === 'next') { idx++; render(); }
      else if (act === 'back') { idx = Math.max(0, idx - 1); render(); }
      else if (act === 'skip' || act === 'done') close();
    });

    function close() {
      try { localStorage.setItem(GUIDE_KEY, '1'); } catch (e) {}
      overlay.style.opacity = '0';
      setTimeout(function () { overlay.remove(); }, 280);
    }

    render();
  }

  // -------------------------------------------------------------- Boot
  function boot() {
    if (isMobileViewport()) {
      state.focusMode = true; // app-like: only the active section renders
    }

    // Keep the full page accessible by default, while still tracking the current section.
    var hash = (location.hash || '').replace(/^#/, '').split('?')[0].split('/')[0];
    var def = SECTIONS.find(function (s) { return s.id === hash; });
    if (def) state.active = def.id;
    else state.active = 'home';

    buildDock();
    buildBreadcrumb();
    wireExistingNav();
    wireKeyboard();
    applyFocusClasses();

    // First-time guide
    if (document.readyState === 'complete') showGuide();
    else window.addEventListener('load', showGuide, { once: true });

    // React to manual hash changes (back/forward buttons)
    window.addEventListener('hashchange', syncFromHash);
    window.addEventListener('resize', function () {
      applyFocusClasses();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  // Public surface for other scripts (e.g. polish.js could trigger compartment changes)
  window.OST_COMPARTMENTS = {
    activate: activateSection,
    toggleFocus: toggleFocusMode,
    showAll: function () {
      state.focusMode = false;
      state.settings.focusMode = false;
      state.settings.focusModeUserSet = true;
      saveSettings(state.settings);
      applyFocusClasses();
    },
    sections: SECTIONS,
    get active() { return state.active; },
    get focusMode() { return state.focusMode; }
  };
})();

/* ==========================================================================
 * OST · App Bar — the ONE mobile navigation (replaces ost-mobile-dock.js)
 * --------------------------------------------------------------------------
 * Renders a native-style bottom tab bar on phones:
 *   Home · Markets · Games · Wallet · More
 * Every floating tool the modules used to pin to the screen corners is now
 * reachable from the More sheet — ost-appbar.css hides their launchers on
 * mobile so nothing overlaps. Wallet tab shows the live credits balance;
 * the More tab shows a badge when parlay slips are open.
 * Desktop is untouched (bar is display:none above the mobile breakpoints).
 * ========================================================================== */
(function () {
  'use strict';

  var MOBILE = '(max-width: 820px), (pointer: coarse) and (max-width: 1024px)';
  function isMobile() { return window.matchMedia && window.matchMedia(MOBILE).matches; }
  function byId(id) { return document.getElementById(id); }

  /* ---- helpers ----------------------------------------------------------- */

  function scrollToFirst(selectors) {
    for (var i = 0; i < selectors.length; i++) {
      var el = document.querySelector(selectors[i]);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return true;
      }
    }
    return false;
  }

  function clickFirst(selectors) {
    for (var i = 0; i < selectors.length; i++) {
      var el = document.querySelector(selectors[i]);
      if (el) { el.click(); return true; }
    }
    return false;
  }

  function fmtOst(n) {
    n = Number(n) || 0;
    if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
    if (n >= 1e4) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'k';
    return n.toFixed(n >= 100 ? 0 : 1).replace(/\.0$/, '');
  }

  function credits() {
    try {
      if (window.OST_MONEY && window.OST_MONEY.get) {
        var s = window.OST_MONEY.get();
        return Number(s && s.credits != null ? s.credits : s) || 0;
      }
      var raw = JSON.parse(localStorage.getItem('ost.faucet.hub.v2') || '{}');
      return Number(raw.credits) || 0;
    } catch (_) { return 0; }
  }

  // On-chain OST shown in the wallet dashboard (#wdOstBal). Deposits, faucet
  // claims and swaps land here, so the wallet tab must include it or a deposit
  // "wouldn't reflect on the balance".
  function walletOst() {
    try {
      // Prefer the balance tree: it survives hard refreshes via the persisted
      // last-known on-chain cache (fixes "balance resets after refresh").
      if (window.OST_TREE && window.OST_TREE.chain) {
        var c = window.OST_TREE.chain();
        if (c && Number.isFinite(c.amount)) return Math.max(0, c.amount);
      }
      var el = document.getElementById('wdOstBal');
      if (!el) return 0;
      var n = parseFloat(String(el.textContent).replace(/[^\d.\-]/g, ''));
      return isNaN(n) ? 0 : Math.max(0, n);
    } catch (_) { return 0; }
  }

  // The single "how much OST do I have" number: credits + on-chain, so BOTH
  // game/prediction winnings and on-chain deposits always show here.
  function totalOst() { return credits() + walletOst(); }

  function openParlayCount() {
    try {
      if (!window.OST_PARLAY || !window.OST_PARLAY.slips) return 0;
      var slips = window.OST_PARLAY.slips() || [];
      var n = 0;
      for (var i = 0; i < slips.length; i++) if (slips[i] && slips[i].status === 'open') n++;
      return n;
    } catch (_) { return 0; }
  }

  function widgetsLive(v) {
    document.body.classList.toggle('ost-widgets-live', !!v);
  }

  // Robust navigation: a section may live inside a compartment (and a sub-tab)
  // that is display:none, so a raw scrollIntoView silently no-ops — that was
  // the "dead-end" Markets/Offline buttons. Activate the compartment FIRST (it
  // un-hides the section), optionally click the sub-tab, THEN scroll to the
  // precise element. Falls back to a plain scroll if compartments isn't loaded.
  function navTo(compartmentId, subTab, scrollSel) {
    var didActivate = false;
    try {
      if (window.OST_COMPARTMENTS && typeof window.OST_COMPARTMENTS.activate === 'function') {
        window.OST_COMPARTMENTS.activate(compartmentId, !subTab && !scrollSel);
        didActivate = true;
      }
    } catch (_) {}
    var run = function () {
      if (subTab) {
        var t = document.querySelector('[data-wallet-panel-target="' + subTab + '"], [data-wallet-tab="' + subTab + '"], [data-store-tab="' + subTab + '"], [data-tab="' + subTab + '"]');
        if (t) t.click();
      }
      if (scrollSel) scrollToFirst([].concat(scrollSel));
      else if (!didActivate) scrollToFirst(['#' + compartmentId]);
    };
    // Wait a frame so the just-un-hidden section has layout before we scroll.
    if (subTab || scrollSel) setTimeout(run, didActivate ? 300 : 60);
    else if (!didActivate) scrollToFirst(['#' + compartmentId]);
  }

  /* ---- config ------------------------------------------------------------ */

  var TABS = [
    { key: 'home',    ico: '🏠', lbl: 'Home',    go: function () {
        // Home is the top of the page; activate WITHOUT the compartment's
        // auto-scroll (it would fight our scroll-to-top), then pin to 0.
        try { if (window.OST_COMPARTMENTS && window.OST_COMPARTMENTS.activate) window.OST_COMPARTMENTS.activate('home', false); } catch (_) {}
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } },
    { key: 'markets', ico: '📈', lbl: 'Markets', go: function () { navTo('wallet', 'predict', ['#predictionMarketBoard', '#live-bet']); } },
    { key: 'games',   ico: '🎮', lbl: 'Games',   go: function () { navTo('new-here', null, ['#ostGames', '#ostGamesSection']); } },
    { key: 'wallet',  ico: '👛', lbl: 'Wallet',  go: function () { navTo('wallet', 'access', ['#wallet']); } },
    { key: 'more',    ico: '⊕',  lbl: 'More',    go: null /* sheet toggle */ }
  ];

  // Tools formerly pinned as floating buttons. `need` selectors decide tile
  // visibility at sheet-open time, so tiles for absent modules disappear.
  var TOOLS = [
    { ico: '⚡', lbl: 'Parlay', need: ['#ostParlayDock'], run: function () {
        widgetsLive(true);
        if (window.OST_PARLAY && window.OST_PARLAY.open) window.OST_PARLAY.open();
      } },
    { ico: '👻', lbl: 'Ghost AI', need: ['#ostGhostOrb'], run: function () {
        if (window.OST_GHOST_COMPANION && window.OST_GHOST_COMPANION.open) window.OST_GHOST_COMPANION.open();
      } },
    // need:['body'] because the bubble is created on demand - there is no
    // pre-existing element to gate on, and without a tile here it is
    // unreachable on phones (no corner button is allowed).
    // One system: the bubble IS OST World in its collapsed form. The tile opens
    // whichever face makes sense - the running player if something is queued,
    // otherwise the world itself.
    { ico: '🌐', lbl: 'World', need: ['body'], run: function () {
        var b = window.OST_WORLD_BUBBLE;
        if (b && b.state().queued) { b.show(); return; }
        if (window.OST_WORLD && window.OST_WORLD.open) { window.OST_WORLD.open(); return; }
        if (b) b.show();
      } },
    { ico: '🕸️', lbl: 'Mesh', need: ['#ost-mesh-trigger'], run: function () {
        if (window.OST_MESH && typeof window.OST_MESH.open === 'function') window.OST_MESH.open();
        else clickFirst(['#ost-mesh-trigger']);
      } },
    { ico: '🔥', lbl: 'Streaks', need: ['#ostMetaBadge'], run: function () {
        widgetsLive(true);
        clickFirst(['#ostMetaBadge']);
      } },
    { ico: '💳', lbl: 'OST Card', need: ['#ostCardFloatingBtn'], run: function () {
        if (window.OST_CARD && typeof window.OST_CARD.openFullCard === 'function') window.OST_CARD.openFullCard();
        else clickFirst(['#ostCardFloatingBtn']);
      } },
    { ico: '🎯', lbl: 'Trade ticket', need: ['.ost-tradepop__launcher', '#ost-trade-ticket-fab'], run: function () {
        clickFirst(['.ost-tradepop__launcher', '#ost-trade-ticket-fab']);
      } },
    // The "Transmit to Space" button lives in the home hero and on phones can end
    // up UNDER the fixed bottom app bar, so a tap hits the nav instead — which is
    // why it "did nothing". This gives a guaranteed way to open the console.
    { ico: '𓂇', lbl: 'Transmit', need: ['#transmitBtn'], run: function () {
        clickFirst(['#transmitBtn', '#transmitBtnLg']);
      } },
    // ONE Ghost. The old "realm" was a generic bring-your-own-key chat that could
    // only answer things Google answers better. The Ghost that knows YOUR ledger
    // — balance, edge, claimable wins — and can act on it is the real one, so this
    // opens that. The realm's summoning circle still exists for its own visuals;
    // it just isn't the thing we send people to for answers.
    { ico: '👻', lbl: 'Ghost AI', need: ['#ostGhostOrb', '#ghost-summon-trigger'], run: function () {
        if (window.OST_GHOST_COMPANION && typeof window.OST_GHOST_COMPANION.open === 'function') {
          window.OST_GHOST_COMPANION.open();
          return;
        }
        clickFirst(['#ostGhostOrb', '#ghost-summon-trigger']);
      } },
    { ico: '🔋', lbl: 'Offline vault', need: ['#offline'], run: function () {
        navTo('offline', null, ['#offline']);
      } }
  ];

  // Section list: prefer the compartments navigator (the hidden .ost-dock is
  // the same data) so the sheet is the COMPLETE app drawer; fall back static.
  var FALLBACK_LINKS = [
    { id: 'converter-hub', label: 'Convert' },
    { id: 'commerce', label: 'Shop' },
    { id: 'stock-market', label: 'Stocks' },
    { id: 'launchpad', label: 'Launchpad' },
    { id: 'survival', label: 'Survival' },
    { id: 'story', label: 'Story' },
    { id: 'roadmap', label: 'Roadmap' }
  ];

  function sectionLinks() {
    try {
      var s = window.OST_COMPARTMENTS && window.OST_COMPARTMENTS.sections;
      if (s && s.length) return s;
    } catch (_) {}
    return FALLBACK_LINKS;
  }

  function gotoSection(id) {
    try {
      if (window.OST_COMPARTMENTS && typeof window.OST_COMPARTMENTS.activate === 'function') {
        window.OST_COMPARTMENTS.activate(id, true);
        return;
      }
    } catch (_) {}
    scrollToFirst(['#' + id]);
  }

  /* ---- build ------------------------------------------------------------- */

  var bar = null, sheet = null, backdrop = null;
  var walletSub = null, moreBadge = null, sheetBal = null;
  var sheetOpen = false;

  function setSheet(v) {
    sheetOpen = !!v;
    document.body.classList.toggle('ost-sheet-open', sheetOpen);
    if (sheetOpen) refreshSheet();
  }

  function setActive(key) {
    if (!bar) return;
    var tabs = bar.querySelectorAll('.ost-appbar-tab');
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].classList.toggle('is-active', tabs[i].getAttribute('data-tab') === key);
    }
  }

  function refreshBalance() {
    var txt = fmtOst(totalOst()) + ' OST';
    if (walletSub) walletSub.textContent = txt;
    if (sheetBal) sheetBal.textContent = txt;
  }

  function refreshBadge() {
    if (!moreBadge) return;
    var n = openParlayCount();
    moreBadge.textContent = n > 9 ? '9+' : String(n);
    moreBadge.classList.toggle('is-on', n > 0);
  }

  function refreshSheet() {
    refreshBalance();
    if (!sheet) return;
    var tiles = sheet.querySelectorAll('.oas-tool');
    for (var i = 0; i < tiles.length; i++) {
      var need = TOOLS[i].need;
      var ok = false;
      for (var j = 0; j < need.length; j++) if (document.querySelector(need[j])) { ok = true; break; }
      if (ok) tiles[i].removeAttribute('hidden');
      else tiles[i].setAttribute('hidden', '');
    }
    rebuildLinks();
  }

  var linksHost = null;
  function rebuildLinks() {
    if (!linksHost) return;
    linksHost.innerHTML = '';
    sectionLinks().forEach(function (l) {
      if (!document.getElementById(l.id)) return;
      var chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'oas-link';
      chip.textContent = (l.icon ? l.icon + ' ' : '') + (l.label || l.id);
      chip.addEventListener('click', function () {
        setSheet(false);
        setActive('home');
        setTimeout(function () { gotoSection(l.id); }, 90);
      });
      linksHost.appendChild(chip);
    });
  }

  function build() {
    if (byId('ostAppBar')) return;

    bar = document.createElement('nav');
    bar.id = 'ostAppBar';
    bar.setAttribute('aria-label', 'OST navigation');
    TABS.forEach(function (t) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'ost-appbar-tab';
      b.setAttribute('data-tab', t.key);
      b.innerHTML = '<span class="oab-ico">' + t.ico + '</span><span class="oab-lbl">' + t.lbl + '</span>';
      if (t.key === 'wallet') {
        walletSub = document.createElement('span');
        walletSub.className = 'oab-sub';
        b.appendChild(walletSub);
      }
      if (t.key === 'more') {
        moreBadge = document.createElement('span');
        moreBadge.className = 'oab-badge';
        b.appendChild(moreBadge);
      }
      b.addEventListener('click', function () {
        widgetsLive(false);
        if (t.key === 'more') { setSheet(!sheetOpen); setActive(sheetOpen ? 'more' : 'home'); return; }
        setSheet(false);
        setActive(t.key);
        t.go();
      });
      bar.appendChild(b);
    });
    document.body.appendChild(bar);

    backdrop = document.createElement('div');
    backdrop.id = 'ostAppSheetBackdrop';
    backdrop.addEventListener('click', function () { setSheet(false); setActive('home'); });
    document.body.appendChild(backdrop);

    sheet = document.createElement('div');
    sheet.id = 'ostAppSheet';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-label', 'OST tools');

    var head = document.createElement('div');
    head.innerHTML = '<div class="oas-grab"></div>';
    var row = document.createElement('div');
    row.className = 'oas-head';
    row.innerHTML = '<strong>OST tools</strong>';
    sheetBal = document.createElement('span');
    sheetBal.className = 'oas-bal';
    row.appendChild(sheetBal);
    head.appendChild(row);
    sheet.appendChild(head);

    var grid = document.createElement('div');
    grid.className = 'oas-grid';
    TOOLS.forEach(function (tool) {
      var tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'oas-tool';
      tile.innerHTML = '<span class="oas-ico">' + tool.ico + '</span><span class="oas-lbl">' + tool.lbl + '</span>';
      tile.addEventListener('click', function () {
        setSheet(false);
        setActive('home');
        setTimeout(tool.run, 90);
      });
      grid.appendChild(tile);
    });
    sheet.appendChild(grid);

    var sub = document.createElement('div');
    sub.className = 'oas-sub';
    sub.textContent = 'Jump to';
    sheet.appendChild(sub);

    linksHost = document.createElement('div');
    linksHost.className = 'oas-links';
    sheet.appendChild(linksHost);
    rebuildLinks();
    document.body.appendChild(sheet);

    // Summoned widgets (parlay / streaks) dismiss on any outside tap.
    document.addEventListener('click', function (e) {
      if (!document.body.classList.contains('ost-widgets-live')) return;
      if (!e.target || !e.target.closest) return;
      if (e.target.closest('#ostParlayDock, #ostMetaBadge, #ostMetaPop, #ostAppBar, #ostAppSheet')) return;
      widgetsLive(false);
    }, false);

    // Live numbers.
    refreshBalance();
    refreshBadge();
    window.addEventListener('ost-money-changed', refreshBalance, false);
    window.addEventListener('ost-faucet-hub-award', refreshBalance, false);
    window.addEventListener('ost:wallet-changed', refreshBalance, false);   // on-chain deposits/faucet
    window.addEventListener('ost:prediction-order-recorded', refreshBadge, false);
    window.addEventListener('ost:parlay-won', refreshBadge, false);
    // Poll a bit faster so an on-chain deposit shows within a few seconds even
    // if its change event was missed (devnet RPC lag).
    setInterval(function () { refreshBalance(); refreshBadge(); }, 5000);

    setActive('home');
  }

  window.OST_APPBAR = {
    openSheet: function () { setSheet(true); },
    closeSheet: function () { setSheet(false); },
    isMobile: isMobile
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(build, 1400); });
  else setTimeout(build, 1400);
})();

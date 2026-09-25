/* OST desktop top bar — fits the screen.
 *
 * The bar held 18 links in ~755px: seven sat behind a horizontal scrollbar, and the
 * two main features (Markets, Games) had no link at all. This module (desktop only):
 *   · adds Markets (#markets deep link) and Games right after Home;
 *   · shows as many links as fit, moves the rest into a "More ▾" menu, re-fits on resize;
 *   · tidies desktop floating clutter: hides purely decorative / unsolicited widgets
 *     (Veil status pill, ghost greeting, section pill, streak badge) and moves the
 *     Tap Ticket launcher into the right-side dock column so the bottom-right corner
 *     no longer stacks five buttons on top of each other.
 */
(function () {
  'use strict';
  if (window.__ostDesktopNav) return; window.__ostDesktopNav = true;
  var MQ = window.matchMedia('(min-width: 821px) and (pointer: fine), (min-width: 1025px)');

  function css() {
    if (document.getElementById('ostDeskNavStyle')) return;
    var st = document.createElement('style'); st.id = 'ostDeskNavStyle';
    st.textContent = [
      '@media (min-width: 821px) and (pointer: fine), (min-width: 1025px) {',
      '  #navLinks{overflow:hidden!important;flex-wrap:nowrap!important;scrollbar-width:none;align-items:center}',
      '  #navLinks::-webkit-scrollbar{display:none}',
      '  #navLinks > a{white-space:nowrap;flex:0 0 auto}',
      '  #navLinks > a.ost-nav-hidden{display:none!important}',
      '  .ost-nav-more{position:relative;flex:0 0 auto}',
      '  .ost-nav-more > button{background:none;border:1px solid rgba(148,163,184,.25);color:inherit;border-radius:10px;padding:7px 12px;font:inherit;font-weight:600;cursor:pointer;white-space:nowrap}',
      '  .ost-nav-more > button:focus-visible{outline:2px solid #7fd8ff;outline-offset:2px}',
      '  .ost-nav-menu{position:fixed;min-width:200px;max-height:70vh;overflow:auto;padding:6px;border-radius:14px;background:rgba(10,16,30,.98);border:1px solid rgba(148,163,184,.22);box-shadow:0 18px 50px rgba(0,0,0,.55);z-index:100000;display:none}',
      '  .ost-nav-menu.open{display:block}',
      '  .ost-nav-menu a{display:block;padding:9px 12px;border-radius:9px;color:#dbe7f5;text-decoration:none;white-space:nowrap}',
      '  .ost-nav-menu a:hover,.ost-nav-menu a:focus-visible{background:rgba(127,216,255,.1);outline:none}',
      /* floating clutter */
      '  #ost-veil-status-pill,.og-bubble,.ost-breadcrumb,#ostMetaBadge{display:none!important}',
      /* ONE row of launchers along the bottom-right edge (they used to stack on top of each
         other and on the dock), and the dock ends above that row. */
      '  .ost-dock{bottom:84px!important;max-height:calc(100vh - 124px)!important;overflow-y:auto!important;scrollbar-width:none}',
      '  .ffx-mute{right:14px!important;bottom:22px!important;left:auto!important;top:auto!important}',
      '  #ghost-summon-trigger{right:60px!important;bottom:18px!important;left:auto!important;top:auto!important}',
      '  #ost-mesh-trigger{right:126px!important;bottom:19px!important;left:auto!important;top:auto!important}',
      '  #ostCardFloatingBtn{right:192px!important;bottom:22px!important;left:auto!important;top:auto!important}',
      '  #ostParlayDock.is-collapsed{right:324px!important;bottom:22px!important;left:auto!important;top:auto!important}',
      '}'
    ].join('\n');
    document.head.appendChild(st);
  }

  function ensurePrimaryLinks(nav) {
    var home = nav.querySelector('a[href="#home"]'); if (!home) return;
    if (!nav.querySelector('a[href="#markets"]')) {
      var m = document.createElement('a'); m.href = '#markets'; m.textContent = 'Markets'; m.setAttribute('data-ost-primary', '1');
      home.parentNode.insertBefore(m, home.nextSibling);
    }
    if (!nav.querySelector('a[href="#games"]')) {
      var g = document.createElement('a'); g.href = '#games'; g.textContent = 'Games'; g.setAttribute('data-ost-primary', '1');
      var mk = nav.querySelector('a[href="#markets"]'); mk.parentNode.insertBefore(g, mk.nextSibling);
    }
  }

  var more = null, menu = null;
  function buildMore(nav) {
    if (more) return;
    more = document.createElement('div'); more.className = 'ost-nav-more';
    more.innerHTML = '<button type="button" aria-haspopup="true" aria-expanded="false">More ▾</button>';
    nav.appendChild(more);
    menu = document.createElement('div'); menu.className = 'ost-nav-menu'; menu.setAttribute('role', 'menu');
    document.body.appendChild(menu);
    var btn = more.querySelector('button');
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      var open = !menu.classList.contains('open');
      if (open) { var r = btn.getBoundingClientRect(); menu.style.top = (r.bottom + 6) + 'px'; menu.style.left = Math.max(8, Math.min(innerWidth - 220, r.left)) + 'px'; }
      menu.classList.toggle('open', open); btn.setAttribute('aria-expanded', String(open));
    });
    document.addEventListener('click', function () { menu.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { menu.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); } });
    // A click in the menu behaves exactly like the original link (compartments listen on document).
    menu.addEventListener('click', function (e) {
      var a = e.target.closest('a[data-for]'); if (!a) return;
      e.preventDefault(); e.stopPropagation(); menu.classList.remove('open');
      var orig = nav.querySelector('a[href="' + a.getAttribute('data-for') + '"]');
      if (orig) { orig.classList.remove('ost-nav-hidden'); orig.click(); fit(); }
      else location.href = a.getAttribute('data-for');
    });
  }

  var fitting = false;
  function fit() {
    var nav = document.getElementById('navLinks'); if (!nav || fitting) return;
    fitting = true;
    try {
      var links = [].slice.call(nav.querySelectorAll(':scope > a'));
      links.forEach(function (a) { a.classList.remove('ost-nav-hidden'); });
      if (!MQ.matches) { if (more) more.style.display = 'none'; return; }
      buildMore(nav); more.style.display = '';
      var avail = nav.clientWidth, hidden = [];
      // Hide from the END until links + the More button fit (primary links hide last).
      var order = links.slice().reverse().sort(function (a, b) { return (a.hasAttribute('data-ost-primary') ? 1 : 0) - (b.hasAttribute('data-ost-primary') ? 1 : 0); });
      var i = 0;
      while (nav.scrollWidth > avail + 1 && i < order.length) { order[i].classList.add('ost-nav-hidden'); hidden.push(order[i]); i++; }
      if (!hidden.length) { more.style.display = 'none'; return; }
      hidden.sort(function (a, b) { return links.indexOf(a) - links.indexOf(b); });
      menu.innerHTML = hidden.map(function (a) { return '<a role="menuitem" href="' + a.getAttribute('href') + '" data-for="' + a.getAttribute('href') + '">' + a.textContent.trim() + '</a>'; }).join('');
    } finally { fitting = false; }
  }

  function boot() {
    css();
    var nav = document.getElementById('navLinks'); if (!nav) return;
    ensurePrimaryLinks(nav);
    fit();
    var t = 0; window.addEventListener('resize', function () { clearTimeout(t); t = setTimeout(fit, 150); });
    // Language switches rewrite link text (widths change) - refit once translations land.
    window.addEventListener('ost:langchange', function () { setTimeout(fit, 50); });
    setTimeout(fit, 1500);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();

/* ==========================================================================
 * OST · Mobile Dock — one launcher instead of overlapping floating buttons
 * --------------------------------------------------------------------------
 * On phones the floating widgets (Parlay dock, Games-meta badge, Money badge)
 * all pinned to the bottom corners and overlapped each other and the thumb
 * zone. This adds a single bottom-center "⊕ OST" launcher. Tapping it opens a
 * tidy vertical tray of those tools; each tool opens in place. When the tray
 * is closed the individual widgets are hidden on mobile, so nothing overlaps.
 * Desktop (>640px) is untouched — the widgets sit where they always did.
 * ========================================================================== */
(function () {
  'use strict';

  var MOBILE = '(max-width: 640px)';
  function isMobile() { return window.matchMedia && window.matchMedia(MOBILE).matches; }

  // Widgets we corral on mobile: [id, emoji, label, openFn]
  var TOOLS = [
    { id: 'ostParlayDock', emoji: '⚡', label: 'Parlay', open: function () {
        if (window.OST_PARLAY && window.OST_PARLAY.open) window.OST_PARLAY.open();
      } },
    { id: 'ostMetaBadge', emoji: '🔥', label: 'Streaks & bonus', open: function () {
        var b = document.getElementById('ostMetaBadge'); if (b) b.click();
      } },
    { id: 'ostMoneyBadge', emoji: '◉', label: 'Balance', open: function () {
        var b = document.getElementById('ostMoneyBadge'); if (b) b.click();
      } }
  ];

  function injectStyles() {
    if (document.getElementById('ostMobileDockStyle')) return;
    var st = document.createElement('style');
    st.id = 'ostMobileDockStyle';
    st.textContent =
      '@media (max-width:640px){' +
        /* hide the raw floating widgets unless the tray is open */
        'body:not(.ost-dock-open) #ostParlayDock,' +
        'body:not(.ost-dock-open) #ostMetaBadge,' +
        'body:not(.ost-dock-open) #ostMoneyBadge{display:none!important;}' +
        /* when open, stack them cleanly above the launcher */
        'body.ost-dock-open #ostParlayDock{right:8px;left:8px;bottom:150px;width:auto;}' +
        'body.ost-dock-open #ostMetaBadge{left:50%;transform:translateX(-50%);bottom:112px;}' +
        'body.ost-dock-open #ostMoneyBadge{left:50%;transform:translateX(-50%);top:auto;bottom:74px;right:auto;}' +
      '}' +
      '#ostDockFab{position:fixed;left:50%;transform:translateX(-50%);bottom:16px;z-index:10030;display:none;' +
      'align-items:center;gap:8px;padding:11px 20px;border-radius:999px;border:none;cursor:pointer;' +
      'background:linear-gradient(135deg,#6d9fff,#a78bfa);color:#0a0e1c;font-weight:900;font-size:14px;' +
      'box-shadow:0 8px 30px rgba(109,159,255,0.45);}' +
      '#ostDockFab.is-open{background:linear-gradient(135deg,#f5c468,#f59e0b);}' +
      '#ostDockTray{position:fixed;left:50%;transform:translateX(-50%);bottom:74px;z-index:10029;display:none;' +
      'flex-direction:column;gap:8px;width:min(240px,calc(100vw - 24px));}' +
      '#ostDockTray.is-open{display:flex;}' +
      '.ost-dock-item{display:flex;align-items:center;gap:10px;padding:12px 16px;border-radius:14px;' +
      'background:rgba(12,16,28,0.96);border:1px solid rgba(255,255,255,0.14);color:#e2e8f0;font-weight:800;' +
      'font-size:13px;cursor:pointer;box-shadow:0 6px 24px rgba(0,0,0,0.5);}' +
      '.ost-dock-item .ost-dock-emoji{font-size:18px;}' +
      '@media (max-width:640px){#ostDockFab{display:inline-flex;}}';
    document.head.appendChild(st);
  }

  var open = false;
  var fab = null, tray = null;

  function setOpen(v) {
    open = v;
    document.body.classList.toggle('ost-dock-open', open);
    if (fab) { fab.classList.toggle('is-open', open); fab.firstChild.textContent = open ? '✕' : '⊕'; }
    if (tray) tray.classList.toggle('is-open', open);
  }

  function build() {
    injectStyles();
    fab = document.createElement('button');
    fab.id = 'ostDockFab';
    fab.type = 'button';
    fab.innerHTML = '<span>⊕</span><span>OST</span>';
    fab.addEventListener('click', function () { setOpen(!open); });
    document.body.appendChild(fab);

    tray = document.createElement('div');
    tray.id = 'ostDockTray';
    TOOLS.forEach(function (t) {
      var item = document.createElement('button');
      item.type = 'button';
      item.className = 'ost-dock-item';
      item.innerHTML = '<span class="ost-dock-emoji">' + t.emoji + '</span><span>' + t.label + '</span>';
      item.addEventListener('click', function () {
        setOpen(true);           // reveal the widgets
        setTimeout(t.open, 30);  // then open the chosen one
      });
      tray.appendChild(item);
    });
    document.body.appendChild(tray);

    // tapping outside closes the tray
    document.addEventListener('click', function (e) {
      if (!open) return;
      if (fab.contains(e.target) || tray.contains(e.target)) return;
      if (e.target.closest && (e.target.closest('#ostParlayDock') || e.target.closest('#ostMetaBadge') || e.target.closest('#ostMoneyBadge') || e.target.closest('#ostMetaPop'))) return;
      setOpen(false);
    }, false);

    // if we rotate to desktop, make sure nothing is left hidden
    window.matchMedia(MOBILE).addEventListener && window.matchMedia(MOBILE).addEventListener('change', function (e) {
      if (!e.matches) setOpen(false);
    });
  }

  window.OST_MOBILE_DOCK = { open: function () { setOpen(true); }, close: function () { setOpen(false); }, isMobile: isMobile };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(build, 1600); });
  else setTimeout(build, 1600);
})();

/* ==========================================================================
 * OST Launchpad X — makes the launchpad open like pump.fun: coins first.
 *
 *   · King-of-the-Hill spotlight (the coin furthest up its bonding curve),
 *     newest launches, and board stats — replacing the marketing hero
 *   · the board (Trending) is the default view; the last tab you pick is
 *     remembered; "Create a coin" is one tap away
 * Data: the launchpad registry the page already keeps (OST_LAUNCHPAD.loadCoins,
 * synced from the worker by app.js). Seed coins (creator ost-genesis / id
 * seed-*) are labelled "genesis", never presented as fresh launches.
 * Trading opens the existing coin detail via the board's own View button.
 * ========================================================================== */
(function () {
  'use strict';
  if (window.OST_LAUNCHPAD_X) return;

  var GRAD = 69000;
  var TAB_KEY = 'ost.lp.tab.v1';
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function num(v) { var n = Number(v); return Number.isFinite(n) ? n : 0; }
  function int(n) { n = Math.round(num(n)); return n >= 1e4 ? fmt(n) : n.toLocaleString(); }
  function fmt(n) {
    n = num(n);
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + 'K';
    return n >= 10 ? Math.round(n).toString() : n.toFixed(2);
  }
  function ago(t) {
    t = num(t) || Date.parse(t); if (!t) return '';
    var s = Math.max(0, Math.round((Date.now() - t) / 1000));
    if (s < 60) return s + 's ago'; if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago'; return Math.floor(s / 86400) + 'd ago';
  }
  function isSeed(c) { return /^seed-/.test(String(c.id || '')) || String(c.creator || '') === 'ost-genesis'; }
  function coins() {
    var list = [];
    try { list = (window.OST_LAUNCHPAD && OST_LAUNCHPAD.loadCoins) ? OST_LAUNCHPAD.loadCoins() : JSON.parse(localStorage.getItem('ost_lp_history2') || '[]'); } catch (_) {}
    return (Array.isArray(list) ? list : []).filter(function (c) { return c && (c.mint || c.id) && c.symbol; });
  }
  function curveOf(c) { var v = num(c.curve); if (!v && num(c.mcap)) v = num(c.mcap) / GRAD * 100; return Math.max(0, Math.min(100, v)); }
  function dateOf(c) { return num(c.date) || num(c.createdAt) || Date.parse(c.createdAt) || 0; }
  function avatar(c, cls) {
    return c.img ? '<span class="' + cls + '"><img alt="" loading="lazy" src="' + esc(c.img) + '"></span>'
      : '<span class="' + cls + '">' + esc(String(c.symbol || '?').charAt(0).toUpperCase()) + '</span>';
  }

  /* ---------------------------------------------------------------- spotlight */
  var spot = null;
  function mountSpot() {
    var shell = document.querySelector('#launchpad .lp-hero-shell');
    if (!shell || spot) return !!spot;
    spot = document.createElement('div');
    spot.className = 'lpx-spot';
    spot.id = 'lpxSpot';
    spot.innerHTML =
      '<div class="lpx-card" id="lpxKing"><div class="lpx-empty">Loading the board…</div></div>' +
      '<div class="lpx-card lpx-side">' +
        '<div class="lpx-stats">' +
          '<div class="lpx-stat"><span>Coins</span><b id="lpxStCoins">—</b></div>' +
          '<div class="lpx-stat"><span>Market cap</span><b id="lpxStMcap">—</b></div>' +
          '<div class="lpx-stat"><span>Graduated</span><b id="lpxStGrad">—</b></div>' +
        '</div>' +
        '<div><div class="lpx-h"><span class="d" aria-hidden="true"></span>Newest launches</div><div class="lpx-list" id="lpxNew"></div></div>' +
      '</div>';
    shell.parentNode.insertBefore(spot, shell);
    spot.addEventListener('click', function (e) {
      var b = e.target.closest('[data-lpx]');
      if (b) {
        var act = b.getAttribute('data-lpx');
        if (act === 'create') return tab('create', true);
        if (act === 'board') return tab('board', true);
        if (act === 'trade') return trade(b.getAttribute('data-mint'));
      }
      var row = e.target.closest('[data-mint]'); if (row) trade(row.getAttribute('data-mint'));
    });
    return true;
  }

  function render() {
    if (!spot) return;
    var all = coins();
    var king = null;
    all.forEach(function (c) { if (!king || curveOf(c) > curveOf(king) || (curveOf(c) === curveOf(king) && num(c.mcap) > num(king.mcap))) king = c; });
    var kEl = $('lpxKing');
    if (!king) {
      kEl.innerHTML = '<div class="lpx-empty">No coins yet. Launch the first one — it costs 0 OST and starts on the same bonding curve as everyone else.</div>' +
        '<div class="lpx-actions" style="margin-top:12px"><button class="lpx-btn" data-lpx="create">Create a coin</button></div>';
    } else {
      var cv = curveOf(king), mcap = num(king.mcap);
      kEl.innerHTML =
        '<span class="lpx-crown">👑 King of the hill</span>' +
        '<div class="lpx-king">' + avatar(king, 'lpx-img') +
          '<div><div class="lpx-name">' + esc(king.name || king.symbol) + '</div>' +
            '<div class="lpx-sym">$' + esc(king.symbol) + (isSeed(king) ? '<span class="lpx-tag">genesis</span>' : '') + '</div>' +
            '<div class="lpx-by">by ' + esc(king.creator || 'anon') + (dateOf(king) ? ' · ' + ago(dateOf(king)) : '') + '</div>' +
            (king.desc ? '<div class="lpx-desc">' + esc(king.desc) + '</div>' : '<div style="height:10px"></div>') +
            '<div class="lpx-kv"><div><span>Market cap</span><b>' + fmt(mcap) + ' OST</b></div>' +
              (num(king.holderCount) ? '<div><span>Holders</span><b>' + int(king.holderCount) + '</b></div>' : '') +
              (num(king.trades) ? '<div><span>Trades</span><b>' + int(king.trades) + '</b></div>' : '') + '</div>' +
            '<div class="lpx-curve"><div class="lpx-curve-track"><div class="lpx-curve-fill" id="lpxFill"></div></div>' +
              '<div class="lpx-curve-lbl"><span>Bonding curve <b>' + cv.toFixed(cv < 10 ? 1 : 0) + '%</b></span><span>graduates at <b>' + fmt(GRAD) + ' OST</b></span></div></div>' +
            '<div class="lpx-actions"><button class="lpx-btn" data-lpx="trade" data-mint="' + esc(king.mint || king.id) + '">Trade $' + esc(king.symbol) + '</button>' +
              '<button class="lpx-btn ghost" data-lpx="create">Create a coin</button><button class="lpx-btn ghost" data-lpx="board">Leaderboard</button></div>' +
          '</div></div>';
      requestAnimationFrame(function () { var f = $('lpxFill'); if (f) f.style.width = cv + '%'; });
    }
    var newest = all.slice().sort(function (a, b) { return dateOf(b) - dateOf(a); }).slice(0, 5);
    $('lpxNew').innerHTML = newest.length ? newest.map(function (c) {
      return '<div class="lpx-row" data-mint="' + esc(c.mint || c.id) + '">' + avatar(c, 'i') +
        '<span class="n"><b>' + esc(c.name || c.symbol) + (isSeed(c) ? '<span class="lpx-tag">genesis</span>' : '') + '</b><small>$' + esc(c.symbol) + (dateOf(c) ? ' · ' + ago(dateOf(c)) : '') + '</small></span>' +
        '<span class="m">' + fmt(c.mcap) + '<small>' + curveOf(c).toFixed(0) + '% curve</small></span></div>';
    }).join('') : '<div class="lpx-empty">New coins appear here the moment they launch.</div>';
    var tot = all.reduce(function (a, c) { return a + num(c.mcap); }, 0);
    $('lpxStCoins').textContent = all.length;
    $('lpxStMcap').textContent = fmt(tot);
    $('lpxStGrad').textContent = all.filter(function (c) { return c.graduated || curveOf(c) >= 100; }).length;
  }

  /* ---------------------------------------------------------------- tabs + trading */
  function tab(name, scroll) {
    var t = document.querySelector('#launchpad .lp-tab[data-tab="' + name + '"]');
    if (t) t.click();
    if (scroll) {
      var bar = document.querySelector('#launchpad .lp-topbar');
      if (bar) bar.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
  }
  function trade(mint) {
    if (!mint) return;
    tab('feed', false);
    var tries = 0;
    (function find() {
      var btn = document.querySelector('#lpFeedGrid .lp-card-view[data-mint="' + (window.CSS && CSS.escape ? CSS.escape(mint) : mint) + '"]');
      if (btn) { btn.click(); return; }
      if (++tries < 20) setTimeout(find, 100);
    })();
  }
  function rememberTabs() {
    document.querySelectorAll('#launchpad .lp-tab').forEach(function (t) {
      t.addEventListener('click', function (e) {
        if (!e.isTrusted) return;
        try { localStorage.setItem(TAB_KEY, t.getAttribute('data-tab')); } catch (_) {}
      });
    });
    var saved = null; try { saved = localStorage.getItem(TAB_KEY); } catch (_) {}
    // pump.fun opens on the board. First visit: Trending; afterwards: your last tab.
    tab(saved || 'feed', false);
  }

  /* ---------------------------------------------------------------- boot */
  function boot() {
    if (!mountSpot()) { setTimeout(boot, 400); return; }
    rememberTabs();
    render();
    // The registry updates when app.js syncs from the worker or a trade settles.
    window.addEventListener('storage', function (e) { if (e.key === 'ost_lp_history2') render(); });
    ['ost:realtime', 'ost:launchpad-updated'].forEach(function (n) { window.addEventListener(n, function (e) {
      var d = e.detail; if (n === 'ost:realtime' && !(d && /^launchpad\./.test(d.type || ''))) return; setTimeout(render, 400);
    }); });
    var sec = $('launchpad');
    if (sec && 'IntersectionObserver' in window) {
      new IntersectionObserver(function (en) { if (en.some(function (x) { return x.isIntersecting; })) render(); }).observe(sec);
    }
  }

  window.OST_LAUNCHPAD_X = { render: render, trade: trade, tab: tab };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();

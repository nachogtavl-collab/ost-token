/* ==========================================================================
   OST Prediction — Trade Desk Pop-out
   --------------------------------------------------------------------------
   Removes the always-on, sticky right-column "Trade with OST" widget that
   was overlapping the markets and our popup. Keeps every existing DOM id
   intact (predictionTradeAction, predictionStakeInput, predictionOutcomeToggle,
   etc.) so the existing trade engine and the unified market modal continue
   to drive it.

   What this module does:
     1. Lifts the existing `<aside id="predictionTradeDesk">` out of the
        wallet portal grid and re-parents it to <body> as a floating panel.
     2. Hides the panel by default. Adds a small launcher button inside the
        prediction header so the user can pop it open / close it.
     3. Adds drag handle on the header so the panel is movable; remembers
        position + open state in localStorage.
     4. Auto-hides while the unified market modal is open (no overlap).
     5. Allows the market list column to span full width because the desk
        is no longer in the grid.
   ========================================================================== */
(function () {
  'use strict';
  if (window.__OST_TRADE_POPOUT_LOADED) return;
  window.__OST_TRADE_POPOUT_LOADED = true;

  var POS_KEY = 'ost.tradeDesk.popout.v1';

  function $(sel, root) { return (root || document).querySelector(sel); }

  function readPos() {
    try { return JSON.parse(localStorage.getItem(POS_KEY) || 'null') || {}; }
    catch (_) { return {}; }
  }
  function writePos(patch) {
    var cur = readPos();
    Object.keys(patch).forEach(function (k) { cur[k] = patch[k]; });
    try { localStorage.setItem(POS_KEY, JSON.stringify(cur)); } catch (_) {}
  }

  function rectsOverlap(a, b, pad) {
    if (!a || !b) return false;
    pad = pad || 0;
    return !(a.right + pad < b.left || b.right + pad < a.left || a.bottom + pad < b.top || b.bottom + pad < a.top);
  }

  function placeSafely(desk) {
    if (!desk || !desk.classList.contains('is-open')) return;
    var narrow = false;
    try { narrow = window.matchMedia && window.matchMedia('(max-width: 720px)').matches; } catch (_) {}
    if (narrow) {
      desk.style.left = '';
      desk.style.top = '';
      desk.style.right = '';
      desk.style.bottom = '';
      return;
    }
    var orb = document.getElementById('ghost-summon-trigger');
    if (!orb) return;
    var deskRect = desk.getBoundingClientRect();
    var orbRect = orb.getBoundingClientRect();
    if (rectsOverlap(deskRect, orbRect, 18)) {
      desk.style.left = '24px';
      desk.style.top = 'auto';
      desk.style.right = 'auto';
      desk.style.bottom = '96px';
      writePos({ left: null, top: null });
    }
  }

  function ensurePopout() {
    var desk = document.getElementById('predictionTradeDesk');
    if (!desk) return null;
    if (desk.dataset.popoutReady === '1') return desk;

    // Wrap inside a draggable shell with a header bar.
    var header = document.createElement('div');
    header.className = 'ost-tradepop__header';
    header.innerHTML =
      '<span class="ost-tradepop__grip" aria-hidden="true">⋮⋮</span>' +
      '<span class="ost-tradepop__title">Trade ticket</span>' +
      '<button type="button" class="ost-tradepop__close" aria-label="Close trade ticket">×</button>';
    desk.classList.add('ost-tradepop');
    desk.dataset.popoutReady = '1';
    desk.insertBefore(header, desk.firstChild);

    // Live mini-chart: mirrors the 5-min BTC round (or the selected
    // Polymarket contract) so users have full graph context inside the
    // popout exactly like the unified market modal.
    var chartWrap = document.createElement('div');
    chartWrap.className = 'ost-tradepop__chart-wrap';
    chartWrap.innerHTML =
      '<div class="ost-tradepop__chart-head">' +
        '<span data-bind="popChartLabel">Live chart · select a market</span>' +
        '<span class="ost-tradepop__chart-toggle" data-bind="popChartToggle">' +
          '<button type="button" data-side="YES" class="is-active is-yes">YES</button>' +
          '<button type="button" data-side="NO" class="is-no">NO</button>' +
        '</span>' +
      '</div>' +
      '<canvas class="ost-tradepop__chart-canvas" data-bind="popChartCanvas"></canvas>';
    desk.insertBefore(chartWrap, header.nextSibling);
    desk.__popChartSide = 'YES';
    chartWrap.querySelectorAll('[data-bind="popChartToggle"] button').forEach(function (b) {
      b.addEventListener('click', function () {
        desk.__popChartSide = b.getAttribute('data-side') === 'NO' ? 'NO' : 'YES';
        chartWrap.querySelectorAll('[data-bind="popChartToggle"] button').forEach(function (x) { x.classList.remove('is-active'); });
        b.classList.add('is-active');
        try { renderPopChart(desk); } catch (_) {}
      });
    });

    // Re-parent to body so it escapes any portal stacking context.
    document.body.appendChild(desk);

    // Restore saved position + open state.
    var pos = readPos();
    if (pos.left != null && pos.top != null) {
      desk.style.left = pos.left + 'px';
      desk.style.top = pos.top + 'px';
      desk.style.right = 'auto';
      desk.style.bottom = 'auto';
    }
    if (pos.open) desk.classList.add('is-open');

    // Drag with pointer support, including touch screens.
    var dragging = false, sx = 0, sy = 0, ox = 0, oy = 0;
    header.addEventListener('pointerdown', function (ev) {
      if (ev.target.closest('.ost-tradepop__close')) return;
      if (ev.button != null && ev.button !== 0) return;
      dragging = true;
      var rect = desk.getBoundingClientRect();
      sx = ev.clientX; sy = ev.clientY;
      ox = rect.left; oy = rect.top;
      document.body.style.userSelect = 'none';
      if (header.setPointerCapture && ev.pointerId != null) header.setPointerCapture(ev.pointerId);
      ev.preventDefault();
    });
    document.addEventListener('pointermove', function (ev) {
      if (!dragging) return;
      var rect = desk.getBoundingClientRect();
      var nx = Math.max(8, Math.min(window.innerWidth - Math.min(120, rect.width), ox + (ev.clientX - sx)));
      var ny = Math.max(8, Math.min(window.innerHeight - 80, oy + (ev.clientY - sy)));
      desk.style.left = nx + 'px';
      desk.style.top = ny + 'px';
      desk.style.right = 'auto';
      desk.style.bottom = 'auto';
    });
    document.addEventListener('pointerup', function () {
      if (!dragging) return;
      dragging = false;
      document.body.style.userSelect = '';
      writePos({ left: parseInt(desk.style.left, 10) || 0, top: parseInt(desk.style.top, 10) || 0 });
    });

    // Close button.
    header.querySelector('.ost-tradepop__close').addEventListener('click', function () { close(); });

    return desk;
  }

  function open() {
    var desk = ensurePopout();
    if (!desk) return;
    if (document.body.classList.contains('ost-modal-open')) return; // don't fight the modal
    desk.classList.add('is-open');
    document.body.classList.add('ost-tradepop-open');
    writePos({ open: true });
    syncLauncher(true);
    requestAnimationFrame(function () { placeSafely(desk); });
  }
  function close() {
    var desk = document.getElementById('predictionTradeDesk');
    if (desk) desk.classList.remove('is-open');
    document.body.classList.remove('ost-tradepop-open');
    writePos({ open: false });
    syncLauncher(false);
  }
  function toggle() {
    var desk = document.getElementById('predictionTradeDesk');
    if (desk && desk.classList.contains('is-open')) close(); else open();
  }

  // --------------------------------------------------------------------------
  // Launcher button — fixed in the trade lane, outside page stacking contexts.
  // --------------------------------------------------------------------------
  function ensureLauncher() {
    if (document.getElementById('ostTradePopLauncher')) return;
    // Look for a sensible anchor near the prediction board.
    var anchor =
      $('#predictionMarketList') ||
      $('.prediction-market-grid') ||
      $('#predictionTradeDesk');
    if (!anchor) return;

    var btn = document.createElement('button');
    btn.id = 'ostTradePopLauncher';
    btn.type = 'button';
    btn.className = 'ost-tradepop__launcher';
    btn.innerHTML = '<span class="ost-tradepop__icon" aria-hidden="true">🎯</span><span class="ost-tradepop__text">Trade ticket</span>';
    btn.title = 'Open the OST trade ticket as a floating, draggable panel';
    btn.addEventListener('click', toggle);
    document.body.appendChild(btn);
    syncLauncher(false);
  }
  function syncLauncher(open) {
    var btn = document.getElementById('ostTradePopLauncher');
    if (!btn) return;
    btn.classList.toggle('is-active', !!open);
    btn.innerHTML = open
      ? '<span class="ost-tradepop__icon" aria-hidden="true">▾</span><span class="ost-tradepop__text">Hide ticket</span>'
      : '<span class="ost-tradepop__icon" aria-hidden="true">🎯</span><span class="ost-tradepop__text">Trade ticket</span>';
  }

  // --------------------------------------------------------------------------
  // Market modal coordination — close the popout while the unified market
  // modal is up so the two UIs never overlap.
  // --------------------------------------------------------------------------
  var prevOpenState = false;
  window.addEventListener('ost-modal:open', function () {
    var desk = document.getElementById('predictionTradeDesk');
    prevOpenState = !!(desk && desk.classList.contains('is-open'));
    if (desk) desk.classList.remove('is-open');
    var btn = document.getElementById('ostTradePopLauncher');
    if (btn) btn.style.display = 'none';
  });
  window.addEventListener('ost-modal:close', function () {
    var btn = document.getElementById('ostTradePopLauncher');
    if (btn) btn.style.display = '';
    if (prevOpenState) open();
  });

  window.addEventListener('ghost:open', function () {
    close();
  });

  // --------------------------------------------------------------------------
  // Hook the existing "Place order" button success → also flash the launcher
  // so the user knows the ticket fired even if the panel was closed.
  // --------------------------------------------------------------------------
  function watchTradeAction() {
    var act = document.getElementById('predictionTradeAction');
    if (!act || act.dataset.popoutBound === '1') return;
    act.dataset.popoutBound = '1';
    act.addEventListener('click', function () {
      var btn = document.getElementById('ostTradePopLauncher');
      if (!btn) return;
      btn.classList.add('is-fired');
      setTimeout(function () { btn.classList.remove('is-fired'); }, 1200);
    });
  }

  // --------------------------------------------------------------------------
  // Live mini-chart inside the popout — mirrors the 5-min BTC round when
  // the OST native market is selected, otherwise renders the smoothed YES /
  // NO probability series of the active Polymarket contract.
  // --------------------------------------------------------------------------
  function getSelectedMarket() {
    try {
      var st = window.__predictionState ||
               (window.OST_PREDICTION_API && window.OST_PREDICTION_API._state);
      if (!st || !Array.isArray(st.markets)) return null;
      var id = st.selectedMarketId;
      if (!id) return st.markets[0] || null;
      return st.markets.find(function (m) { return m && m.id === id; }) || null;
    } catch (_) { return null; }
  }
  function btcProbabilityFromPoint(price, round, ts) {
    var beat = Number(round && (round.priceToBeat || round.openPrice));
    var closeAt = Number(round && (round.closeAt || round.closeAtMs));
    if (!Number.isFinite(price) || price <= 1000 || !Number.isFinite(beat) || beat <= 0) return NaN;
    var dPct = ((price - beat) / beat) * 100;
    var msLeft = Math.max(0, Math.min(5 * 60 * 1000, closeAt - (Number(ts) || Date.now())));
    var remRatio = msLeft / (5 * 60 * 1000);
    var elapsedRatio = 1 - remRatio;
    var scale = 0.10 * Math.sqrt(Math.max(remRatio, 0.04));
    var z = Math.max(-8, Math.min(8, dPct / Math.max(scale, 0.001)));
    var yes = 1 / (1 + Math.exp(-z));
    yes = 0.5 + (yes - 0.5) * (0.65 + 0.32 * elapsedRatio);
    return Math.max(0.02, Math.min(0.98, yes));
  }
  function getMarketSeries(market, side) {
    if (!market) return [];
    side = side === 'NO' ? 'NO' : 'YES';
    var isBtc5m = market.isOstNative && /ost-btc5m-/i.test(String(market.id || ''));
    if (isBtc5m && window.OST_PREDICTION_API && typeof window.OST_PREDICTION_API.btcSeries === 'function') {
      var raw = window.OST_PREDICTION_API.btcSeries() || [];
      var round = null;
      try {
        if (typeof window.OST_PREDICTION_API.fiveMinRound === 'function') round = window.OST_PREDICTION_API.fiveMinRound();
      } catch (_) { round = market; }
      round = round || market;
      var pts = raw.slice(-140).map(function (point) {
        return btcProbabilityFromPoint(Number(point && point.price), round, point && (point.ts || point.t));
      }).filter(Number.isFinite);
      var liveYes = Number(round && (round.yesPriceNumber != null ? round.yesPriceNumber : market.yesPriceNumber));
      if (Number.isFinite(liveYes) && liveYes > 0 && liveYes < 1) pts.push(liveYes);
      if (pts.length === 1) pts.unshift(pts[0]);
      if (side === 'NO') pts = pts.map(function (v) { return 1 - v; });
      return pts;
    }
    var yes = Number(market.yesPriceNumber);
    var no = Number(market.noPriceNumber);
    if (!Number.isFinite(yes)) yes = 0.5;
    if (!Number.isFinite(no)) no = 1 - yes;
    var basePrice = side === 'NO' ? no : yes;
    // Light synthetic series so the popout never flat-lines while real
    // history is loading via the unified modal.
    var arr = [];
    for (var i = 0; i < 32; i++) {
      arr.push(Math.max(0.02, Math.min(0.98, basePrice + Math.sin((i + Date.now() / 9000) * 0.6) * 0.02)));
    }
    return arr;
  }
  function renderPopChart(desk) {
    if (!desk) desk = document.getElementById('predictionTradeDesk');
    if (!desk) return;
    var canvas = desk.querySelector('[data-bind="popChartCanvas"]');
    var label = desk.querySelector('[data-bind="popChartLabel"]');
    if (!canvas) return;
    var market = getSelectedMarket();
    var side = desk.__popChartSide || 'YES';
    var pts = getMarketSeries(market, side);
    if (!pts.length) {
      if (label) label.textContent = 'Live chart · select a market';
      var ctx0 = canvas.getContext('2d');
      ctx0.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }
    if (label) {
      var name = market && (market.title || market.question || 'Live market');
      label.textContent = String(name).slice(0, 48) + ' · ' + side;
    }
    var dpr = window.devicePixelRatio || 1;
    var w = canvas.clientWidth || 280;
    var h = canvas.clientHeight || 110;
    canvas.width = Math.floor(w * dpr); canvas.height = Math.floor(h * dpr);
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    var min = Math.min.apply(null, pts);
    var max = Math.max.apply(null, pts);
    var isProbability = min >= 0 && max <= 1;
    if (isProbability) { min = 0; max = 1; }
    var range = Math.max(1e-9, max - min);
    var color = side === 'NO' ? '#ff7c8a' : '#7ce6a8';
    if (isProbability) {
      ctx.strokeStyle = 'rgba(255,255,255,.14)';
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(0, h / 2);
      ctx.lineTo(w, h / 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    var grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, color + '55');
    grad.addColorStop(1, color + '00');
    ctx.fillStyle = grad;
    ctx.beginPath();
    pts.forEach(function (p, i) {
      var x = (i / (pts.length - 1)) * w;
      var y = h - ((p - min) / range) * (h - 6) - 3;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = color; ctx.lineWidth = 1.6;
    ctx.beginPath();
    pts.forEach(function (p, i) {
      var x = (i / (pts.length - 1)) * w;
      var y = h - ((p - min) / range) * (h - 6) - 3;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
    if (isProbability) {
      var last = pts[pts.length - 1];
      ctx.fillStyle = color;
      ctx.font = '10px system-ui, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText((last * 100).toFixed(1) + '% ' + side, w - 6, 12);
    }
  }
  var popChartTimer = null;
  function startPopChartLoop() {
    if (popChartTimer) return;
    popChartTimer = setInterval(function () {
      var desk = document.getElementById('predictionTradeDesk');
      if (!desk || !desk.classList.contains('is-open')) return;
      try { renderPopChart(desk); } catch (_) {}
    }, 1000);
  }

  // --------------------------------------------------------------------------
  // Boot
  // --------------------------------------------------------------------------
  function boot() {
    var desk = ensurePopout();
    ensureLauncher();
    if (desk && desk.classList.contains('is-open')) {
      document.body.classList.add('ost-tradepop-open');
      syncLauncher(true);
      requestAnimationFrame(function () { placeSafely(desk); });
    }
    watchTradeAction();
    startPopChartLoop();
    try { renderPopChart(desk); } catch (_) {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
  // The prediction board often re-renders. Re-bind when that happens.
  var mo = new MutationObserver(function () { watchTradeAction(); ensureLauncher(); });
  mo.observe(document.body, { childList: true, subtree: true });

  // Public API.
  window.OST_TRADE_POPOUT = { open: open, close: close, toggle: toggle };
})();

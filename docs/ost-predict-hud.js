/* ==========================================================================
 * OST · Predict HUD — the redesigned 5-min BTC market hero, on LIVE data
 * --------------------------------------------------------------------------
 * First shipped piece of the prediction-page overhaul (the v4 mockup). It is
 * REAL, not a mock:
 *   · live price  ← the ost:btc-spot ticks prediction-pro already streams
 *   · price-to-beat + round timing ← the worker /btc/round (authoritative)
 * and it renders the signature design: an odometer price that counts THROUGH
 * every value (never jumps), and a graph that glows GREEN when price is above
 * the price-to-beat, RED when below.
 *
 * NON-DESTRUCTIVE ON PURPOSE. It mounts ABOVE the existing prediction board and
 * routes YES/NO to the existing trade desk, so the working order + cash-out
 * paths are untouched while the new look ships. The remaining pieces (grid,
 * market-detail tabs, in-hero buy/sell sheet) replace the old board in later
 * increments once this is proven live.
 *
 * No in-house arb is ever shown. History caps at 12h.
 * ========================================================================== */
(function () {
  'use strict';
  if (window.OST_PREDICT_HUD) return;
  var API = window.OST_API_BASE || 'https://ost-api.nachogtavl.workers.dev';
  var RM = matchMedia('(prefers-reduced-motion:reduce)').matches;

  var round = null;          // {openAt,closeAt,openPrice,priceToBeat,livePrice,id}
  var price = 0;             // freshest live BTC price
  var hist = [];             // rolling price history (<=12h worth of samples)
  var HIST_MAX = 180;

  /* ---- odometer: count through every value, never jump ---- */
  function tween(el, to, fmt, dur) {
    if (!el) return;
    var from = (el._v == null ? to : el._v); el._v = to;
    if (RM || from === to) { el.textContent = fmt(to); return; }
    var t0 = performance.now(); dur = dur || 650;
    function fr(t) { var k = Math.min(1, (t - t0) / dur); el.textContent = fmt(from + (to - from) * k); if (k < 1) requestAnimationFrame(fr); }
    requestAnimationFrame(fr);
  }
  var usd = function (v) { return '$' + Math.round(v).toLocaleString(); };

  function injectStyle() {
    if (document.getElementById('ost-predict-hud-style')) return;
    var css =
      '.oph{border-radius:20px;padding:16px;margin:0 0 16px;position:relative;overflow:hidden;border:1px solid var(--ost-line2,rgba(127,216,255,.24));background:linear-gradient(155deg,#132639,#0e1c2b);transition:border-color .4s,box-shadow .4s}' +
      '.oph.up{border-color:rgba(52,211,153,.5);box-shadow:inset 0 0 70px rgba(52,211,153,.08)}' +
      '.oph.down{border-color:rgba(251,113,133,.5);box-shadow:inset 0 0 70px rgba(251,113,133,.08)}' +
      '.oph-top{display:flex;align-items:center;gap:11px;margin-bottom:12px}' +
      '.oph-ico{width:42px;height:42px;border-radius:12px;display:grid;place-items:center;background:#17304a;border:1px solid rgba(127,216,255,.24);color:#ffc04a;flex:0 0 auto}' +
      '.oph-ico svg{width:23px;height:23px;stroke:currentColor;stroke-width:1.9;fill:none;stroke-linecap:round;stroke-linejoin:round}' +
      '.oph-tt h3{margin:0;font-size:18px;font-weight:800;letter-spacing:-.02em;color:#eef6fc;line-height:1.15}' +
      '.oph-live{display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:700;color:#34d399;margin-top:4px}' +
      '.oph-live .d{width:6px;height:6px;border-radius:50%;background:#34d399;box-shadow:0 0 8px #34d399;animation:oph-pulse 1.5s infinite}' +
      '@keyframes oph-pulse{50%{opacity:.3}}' +
      '.oph-pxrow{display:flex;justify-content:space-between;align-items:flex-end}' +
      '.oph-now{font-family:ui-monospace,Menlo,monospace;font-size:34px;font-weight:800;letter-spacing:-.02em;line-height:1;font-variant-numeric:tabular-nums}' +
      '.oph.up .oph-now{color:#34d399}.oph.down .oph-now{color:#fb7185}' +
      '.oph-delta{font-family:ui-monospace,Menlo,monospace;font-weight:700;font-size:14px;padding:4px 9px;border-radius:8px}' +
      '.oph.up .oph-delta{color:#34d399;background:rgba(52,211,153,.14)}.oph.down .oph-delta{color:#fb7185;background:rgba(251,113,133,.14)}' +
      '.oph-beat{display:flex;align-items:center;gap:7px;font-size:12px;color:#a2b8cb;margin-top:3px}' +
      '.oph-beat .sw{width:16px;border-top:2px dashed #647d92}.oph-beat b{font-family:ui-monospace,Menlo,monospace;color:#eef6fc;font-weight:700}' +
      '.oph canvas{width:100%;height:140px;display:block;margin:12px 0 0}' +
      '.oph-yn{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:14px}' +
      '.oph-yn button{border:1px solid rgba(127,216,255,.24);border-radius:14px;padding:13px;cursor:pointer;display:flex;flex-direction:column;gap:2px;align-items:center;transition:.15s;background:#0e1c2b}' +
      '.oph-yn .lab{font-size:11.5px;font-weight:800;letter-spacing:.05em;text-transform:uppercase}' +
      '.oph-yn .px{font-family:ui-monospace,Menlo,monospace;font-size:22px;font-weight:800;font-variant-numeric:tabular-nums}' +
      '.oph-yn .y{color:#34d399}.oph-yn .y:hover{background:rgba(52,211,153,.14);border-color:#34d399}' +
      '.oph-yn .n{color:#fb7185}.oph-yn .n:hover{background:rgba(251,113,133,.14);border-color:#fb7185}' +
      '@media(max-width:520px){.oph-now{font-size:29px}}';
    var t = document.createElement('style'); t.id = 'ost-predict-hud-style'; t.textContent = css; document.head.appendChild(t);
  }

  function template() {
    return '<div class="oph up" id="ophCard">' +
      '<div class="oph-top">' +
        '<div class="oph-ico"><svg viewBox="0 0 24 24"><path d="M9 8h5a2.5 2.5 0 010 5H9m0 0h5.5a2.5 2.5 0 010 5H9m0-10V5m3 0v3m-3 13v-3m3 3v-3"/></svg></div>' +
        '<div class="oph-tt"><h3>Will BTC be higher in 5 minutes?</h3>' +
          '<span class="oph-live"><span class="d"></span> Live · closes <span id="ophCd">—</span></span></div>' +
      '</div>' +
      '<div class="oph-pxrow"><div class="oph-now" id="ophNow">—</div><div class="oph-delta" id="ophDelta">—</div></div>' +
      '<div class="oph-beat"><span class="sw"></span> Price to beat <b id="ophBeat">—</b></div>' +
      '<canvas id="ophG" width="600" height="140"></canvas>' +
      '<div class="oph-yn">' +
        '<button class="y" data-side="yes"><span class="lab">Yes · higher</span><span class="px" id="ophYes">—</span></button>' +
        '<button class="n" data-side="no"><span class="lab">No · lower</span><span class="px" id="ophNo">—</span></button>' +
      '</div>' +
    '</div>';
  }

  function drawGraph() {
    var cv = document.getElementById('ophG'); if (!cv) return;
    var ctx = cv.getContext('2d'), w = cv.width, h = cv.height, pad = 4;
    var beat = round && Number(round.priceToBeat) || price;
    var pts = hist.length ? hist : [price];
    var lo = Math.min(beat, Math.min.apply(0, pts)), hi = Math.max(beat, Math.max.apply(0, pts));
    var rng = (hi - lo) || 1; lo -= rng * .12; hi += rng * .12; rng = hi - lo;
    var n = pts.length;
    var gx = function (i) { return pad + (n < 2 ? w / 2 : i / (n - 1) * (w - 2 * pad)); };
    var gy = function (p) { return pad + (1 - (p - lo) / rng) * (h - 2 * pad); };
    var up = price >= beat, col = up ? '52,211,153' : '251,113,133';
    ctx.clearRect(0, 0, w, h);
    var by = gy(beat);
    ctx.setLineDash([5, 5]); ctx.beginPath(); ctx.moveTo(pad, by); ctx.lineTo(w - pad, by);
    ctx.strokeStyle = 'rgba(160,184,203,.55)'; ctx.lineWidth = 1.2; ctx.stroke(); ctx.setLineDash([]);
    var g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, 'rgba(' + col + ',.32)'); g.addColorStop(1, 'rgba(' + col + ',0)');
    ctx.beginPath(); ctx.moveTo(gx(0), h - pad); pts.forEach(function (p, i) { ctx.lineTo(gx(i), gy(p)); }); ctx.lineTo(gx(n - 1), h - pad); ctx.closePath(); ctx.fillStyle = g; ctx.fill();
    ctx.beginPath(); pts.forEach(function (p, i) { i ? ctx.lineTo(gx(i), gy(p)) : ctx.moveTo(gx(i), gy(p)); }); ctx.strokeStyle = 'rgb(' + col + ')'; ctx.lineWidth = 2.2; ctx.lineJoin = 'round'; ctx.stroke();
    var lp = pts[n - 1]; ctx.beginPath(); ctx.arc(gx(n - 1), gy(lp), 4, 0, 7); ctx.fillStyle = 'rgb(' + col + ')'; ctx.fill();
  }

  function render() {
    var beat = round && Number(round.priceToBeat) || 0;
    var up = price >= beat && beat > 0;
    var card = document.getElementById('ophCard');
    if (card) { card.classList.toggle('up', up); card.classList.toggle('down', !up); }
    tween(document.getElementById('ophNow'), price || 0, usd);
    tween(document.getElementById('ophBeat'), beat || 0, usd);
    var dEl = document.getElementById('ophDelta');
    if (dEl && beat > 0) { var d = (price - beat) / beat * 100; dEl.textContent = (up ? '▲ ' : '▼ ') + Math.abs(d).toFixed(2) + '%'; }
    // Yes/No implied prices from the live odds if present on the board; else from price vs beat.
    var yes = impliedYes();
    var y = document.getElementById('ophYes'), n = document.getElementById('ophNo');
    if (y) y.textContent = Math.round(yes * 100) + '¢';
    if (n) n.textContent = Math.round((1 - yes) * 100) + '¢';
    drawGraph();
    // countdown
    var cd = document.getElementById('ophCd');
    if (cd && round && round.closeAt) {
      var s = Math.max(0, Math.round((round.closeAt - Date.now()) / 1000));
      cd.textContent = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
    }
  }

  // Prefer the desk's live odds if exposed; otherwise a simple price-vs-beat lean.
  function impliedYes() {
    try {
      var el = document.getElementById('predictionHeroYesPrice');
      if (el) { var v = parseFloat(String(el.textContent).replace(/[^\d.]/g, '')); if (v > 0 && v <= 100) return v / 100; }
    } catch (_) {}
    var beat = round && Number(round.priceToBeat) || 0;
    if (!beat) return 0.5;
    return Math.max(0.02, Math.min(0.98, 0.5 + (price - beat) / beat * 60));
  }

  function pushHist(p) { if (!(p > 0)) return; hist.push(p); if (hist.length > HIST_MAX) hist.shift(); }

  async function loadRound() {
    try {
      var r = await fetch(API + '/btc/round', { cache: 'no-store' }).then(function (x) { return x.json(); });
      if (r && Number(r.priceToBeat) > 0) {
        round = r;
        if (!price) price = Number(r.livePrice) || Number(r.openPrice) || 0;
        if (!hist.length && price) pushHist(price);
        render();
      }
    } catch (_) {}
  }

  function mount() {
    var board = document.getElementById('predictionMarketBoard');
    if (!board || document.getElementById('ophCard')) return;
    injectStyle();
    var host = document.createElement('div');
    host.innerHTML = template();
    board.parentNode.insertBefore(host.firstChild, board);
    // YES/NO route to the existing, working trade desk (no new money path).
    document.querySelectorAll('.oph-yn button').forEach(function (b) {
      b.addEventListener('click', function () {
        var desk = document.getElementById('predictionTradeDesk') || document.getElementById('predictionMarketBoard');
        if (desk) desk.scrollIntoView({ behavior: 'smooth', block: 'center' });
        // pre-select the side on the existing toggle if present
        try {
          var sel = b.getAttribute('data-side');
          var tgl = document.querySelector('#predictionOutcomeToggle [data-outcome="' + sel + '"], #predictionOutcomeToggle .' + sel);
          if (tgl) tgl.click();
        } catch (_) {}
      });
    });
    // RETIRE THE OLD HERO. Now that the new odometer hero is on the page, the
    // legacy per-market hero card + its preamble are redundant and made the page
    // "feel endless". Hide them — but ONLY after the new hero actually mounted,
    // so a failure here can never leave the page with no hero at all (same
    // fail-safe rule the grid uses for the old market list). The search/filter
    // toggles, hidden market list (selection routing), detail panel and trade
    // desk all stay — they are the working machinery the redesign builds on.
    if (document.getElementById('ophCard')) {
      ['predictionMarketHero', 'predictionMarketIntro', 'predictionMarketKicker', 'predictionMarketHeading']
        .forEach(function (id) { var el = document.getElementById(id); if (el) el.style.display = 'none'; });
    }
    loadRound();
    render();
  }

  // live price from the stream prediction-pro already emits
  window.addEventListener('ost:btc-spot', function (e) {
    var p = e && e.detail && Number(e.detail.price);
    if (p > 0) { price = p; pushHist(p); render(); }
  });
  window.addEventListener('ost:btc-market-updated', function (e) {
    try { var m = e.detail && e.detail.tick; if (m && Number(m.price) > 0) { price = Number(m.price); pushHist(price); } } catch (_) {}
    render();
  });

  window.OST_PREDICT_HUD = { refresh: function () { loadRound(); render(); }, mount: mount };

  function boot() {
    mount();
    if (!document.getElementById('ophCard')) { var tries = 0; var iv = setInterval(function () { mount(); if (document.getElementById('ophCard') || ++tries > 20) clearInterval(iv); }, 500); }
    setInterval(loadRound, 20000);   // refresh round + price-to-beat
    setInterval(render, 1000);       // countdown + graph keepalive
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();

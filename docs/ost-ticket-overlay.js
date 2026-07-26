/* ==========================================================================
 * OST · Trade Ticket overlay — opens ANYWHERE, not just the predictions page
 * --------------------------------------------------------------------------
 * A self-contained, body-level bottom sheet listing your prediction tickets
 * (open / won / lost / cashed out) with claim + sell actions. It reads the real
 * ledger (OST_PREDICTION_API.ledger, or the localStorage store as a fallback)
 * so it works from any panel/page. Claims reuse the proven cash-out buttons the
 * prediction desk renders (data-order-sig); if those aren't on the current page
 * it routes into the predictions panel to finish.
 *
 * window.OST_TICKET.open() / .close()
 * ========================================================================== */
(function () {
  'use strict';
  if (window.OST_TICKET) return;
  var ORDERS_KEY = 'ost.prediction.orders.v1';
  var filter = 'all';

  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function el(id) { return document.getElementById(id); }
  function num0(v) { return Math.round(Number(v) || 0).toLocaleString(); }
  function ago(ts) { var n = Number(ts); if (!n) { var d = Date.parse(ts); n = isFinite(d) ? d : 0; } if (!n) return ''; var s = Math.max(0, Math.round((Date.now() - n) / 1000)); if (s < 60) return s + 's'; if (s < 3600) return Math.floor(s / 60) + 'm'; if (s < 86400) return Math.floor(s / 3600) + 'h'; return Math.floor(s / 86400) + 'd'; }
  function orders() {
    try { if (window.OST_PREDICTION_API && OST_PREDICTION_API.ledger) return OST_PREDICTION_API.ledger() || []; } catch (_) {}
    try { return JSON.parse(localStorage.getItem(ORDERS_KEY) || '[]') || []; } catch (_) { return []; }
  }
  function state(o) {
    if (!o) return 'open';
    if (o.cashedOut) return 'paid';
    var st = String(o.status || o.outcome || '').toLowerCase();
    if (st === 'won') return 'claim'; if (st === 'lost') return 'lost';
    if (st === 'sold' || st === 'settled' || st === 'refunded') return 'paid';
    return 'open';
  }
  function cashBtnFor(sig) { if (!sig) return null; try { return document.querySelector('.prediction-cashout-btn[data-order-sig="' + (window.CSS && CSS.escape ? CSS.escape(sig) : sig) + '"]'); } catch (_) { return null; } }

  function injectStyle() {
    if (el('ost-ticket-style')) return;
    var css =
      '#ostTicketScrim{position:fixed;inset:0;z-index:2147483000;background:rgba(2,6,12,.66);opacity:0;pointer-events:none;transition:.22s}' +
      '#ostTicketScrim.on{opacity:1;pointer-events:auto}' +
      '#ostTicketSheet{position:fixed;left:50%;bottom:0;transform:translate(-50%,102%);width:100%;max-width:460px;z-index:2147483001;' +
      'background:linear-gradient(180deg,#132639,#0e1c2b);border-radius:22px 22px 0 0;border-top:1px solid rgba(127,216,255,.42);' +
      'box-shadow:0 -20px 60px rgba(0,0,0,.6);transition:transform .3s cubic-bezier(.2,.8,.2,1);max-height:86vh;display:flex;flex-direction:column;' +
      'font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#eef6fc}' +
      '#ostTicketSheet.on{transform:translate(-50%,0)}' +
      '#ostTicketSheet .tk-grab{width:40px;height:4px;border-radius:3px;background:rgba(127,216,255,.42);margin:8px auto 4px}' +
      '#ostTicketSheet .tk-h{display:flex;align-items:center;gap:8px;padding:6px 16px 12px;border-bottom:1px solid rgba(127,216,255,.12)}' +
      '#ostTicketSheet .tk-h h3{margin:0;font-size:15px;font-weight:800}' +
      '#ostTicketSheet .tk-h .x{margin-left:auto;width:30px;height:30px;border-radius:8px;border:1px solid rgba(127,216,255,.18);background:#0a1420;color:#a2b8cb;cursor:pointer;font-size:16px}' +
      '#ostTicketSheet .tk-sum{display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:8px;padding:12px 16px}' +
      '#ostTicketSheet .tk-s{background:#0e1c2b;border:1px solid rgba(127,216,255,.12);border-radius:11px;padding:9px 8px}' +
      '#ostTicketSheet .tk-s .k{font-size:9px;letter-spacing:.05em;text-transform:uppercase;color:#647d92}' +
      '#ostTicketSheet .tk-s .v{font-family:ui-monospace,Menlo,monospace;font-weight:700;font-size:13px;margin-top:3px}' +
      '#ostTicketSheet .tk-s .v.up{color:#34d399}#ostTicketSheet .tk-s .v.down{color:#fb7185}' +
      '#ostTicketSheet .tk-chips{display:flex;gap:7px;overflow-x:auto;padding:0 16px 8px;scrollbar-width:none}' +
      '#ostTicketSheet .tk-chips::-webkit-scrollbar{display:none}' +
      '#ostTicketSheet .tk-chip{flex:0 0 auto;border:1px solid rgba(127,216,255,.12);background:#0a1420;color:#a2b8cb;font-size:12px;font-weight:700;padding:7px 13px;border-radius:20px;cursor:pointer;white-space:nowrap}' +
      '#ostTicketSheet .tk-chip.on{background:#17304a;color:#eef6fc}' +
      '#ostTicketSheet .tk-list{overflow-y:auto;padding:0 16px 18px}' +
      '#ostTicketSheet .tk-row{display:flex;align-items:center;gap:10px;padding:12px 2px;border-bottom:1px solid rgba(127,216,255,.1)}' +
      '#ostTicketSheet .tk-main{flex:1;min-width:0}' +
      '#ostTicketSheet .tk-title{font-size:12.5px;font-weight:650;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
      '#ostTicketSheet .tk-meta{font-size:10.5px;color:#647d92;font-family:ui-monospace,Menlo,monospace;margin-top:3px}' +
      '#ostTicketSheet .tk-side{font-size:9px;font-weight:800;text-transform:uppercase;padding:1px 6px;border-radius:4px}' +
      '#ostTicketSheet .tk-side.y{color:#34d399;background:rgba(52,211,153,.14)}#ostTicketSheet .tk-side.n{color:#fb7185;background:rgba(251,113,133,.14)}' +
      '#ostTicketSheet .tk-btn{border:0;border-radius:9px;padding:8px 12px;font-size:12px;font-weight:800;cursor:pointer;background:linear-gradient(180deg,#34d399,#10b981);color:#04120c}' +
      '#ostTicketSheet .tk-btn.claim{background:linear-gradient(180deg,#ffc04a,#e0870f);color:#170c02}' +
      '#ostTicketSheet .tk-res{font-family:ui-monospace,Menlo,monospace;font-weight:700;font-size:12px}' +
      '#ostTicketSheet .tk-badge{font-size:9px;font-weight:800;text-transform:uppercase;padding:2px 7px;border-radius:5px;color:#647d92;background:#0a1420}' +
      '#ostTicketSheet .tk-empty{padding:26px;text-align:center;color:#647d92;font-size:13px}';
    var t = document.createElement('style'); t.id = 'ost-ticket-style'; t.textContent = css; document.head.appendChild(t);
  }

  function build() {
    if (el('ostTicketSheet')) return;
    injectStyle();
    var scrim = document.createElement('div'); scrim.id = 'ostTicketScrim';
    var sheet = document.createElement('div'); sheet.id = 'ostTicketSheet';
    sheet.innerHTML =
      '<div class="tk-grab"></div>' +
      '<div class="tk-h"><h3>Your trade tickets</h3><button class="x" id="ostTicketClose">×</button></div>' +
      '<div class="tk-sum">' +
        '<div class="tk-s"><div class="k">Staked</div><div class="v" id="tkStaked">—</div></div>' +
        '<div class="tk-s"><div class="k">Value</div><div class="v" id="tkValue">—</div></div>' +
        '<div class="tk-s"><div class="k">P&amp;L</div><div class="v" id="tkPnl">—</div></div>' +
        '<div class="tk-s"><div class="k">Open / Won</div><div class="v" id="tkCounts">—</div></div>' +
      '</div>' +
      '<div class="tk-chips" id="tkChips">' + [['all', 'All'], ['open', 'Open'], ['claim', 'Claim wins'], ['paid', 'Cashed out'], ['lost', 'Lost']].map(function (c) { return '<button class="tk-chip' + (c[0] === 'all' ? ' on' : '') + '" data-f="' + c[0] + '">' + c[1] + '</button>'; }).join('') + '</div>' +
      '<div class="tk-list" id="tkList"><div class="tk-empty">Loading…</div></div>';
    document.body.appendChild(scrim); document.body.appendChild(sheet);
    scrim.addEventListener('click', close);
    el('ostTicketClose').addEventListener('click', close);
    el('tkChips').addEventListener('click', function (e) { var b = e.target.closest('.tk-chip'); if (!b) return; filter = b.getAttribute('data-f'); el('tkChips').querySelectorAll('.tk-chip').forEach(function (x) { x.classList.toggle('on', x === b); }); render(); });
  }

  function render() {
    if (!el('tkList')) return;
    var list = orders().slice().sort(function (a, b) { return Number(b.ts || 0) - Number(a.ts || 0); });
    var pf = { staked: 0, value: 0, pnl: 0, open: 0, claim: 0 };
    list.forEach(function (o) {
      var stake = Number(o.stake) || 0; pf.staked += stake; var st = state(o);
      if (st === 'paid') { var got = Number(o.cashoutOst) || 0; pf.value += got; pf.pnl += got - stake; }
      else if (st === 'claim') { pf.claim++; var v = Number(o.potentialReturn) || Number(o.shares) || stake; pf.value += v; pf.pnl += v - stake; }
      else if (st === 'lost') { pf.pnl -= stake; }
      else { pf.open++; var val = Number(o.shares) > 0 ? Number(o.shares) * (Number(o.entry || o.price) || 0) : stake; pf.value += (val > 0 ? val : stake); pf.pnl += (val > 0 ? val : stake) - stake; }
    });
    var set = function (id, txt, cls) { var e = el(id); if (e) { e.textContent = txt; if (cls != null) e.className = 'v ' + cls; } };
    set('tkStaked', num0(pf.staked)); set('tkValue', num0(pf.value));
    set('tkPnl', (pf.pnl >= 0 ? '+' : '−') + num0(Math.abs(pf.pnl)), pf.pnl >= 0 ? 'up' : 'down');
    set('tkCounts', pf.open + ' / ' + pf.claim);
    var rows = list.filter(function (o) { return filter === 'all' || state(o) === filter; });
    var host = el('tkList');
    if (!rows.length) { host.innerHTML = '<div class="tk-empty">' + (list.length ? 'No tickets in this filter.' : 'No tickets yet — place a bet to get started.') + '</div>'; return; }
    host.innerHTML = rows.map(function (o) {
      var st = state(o), side = o.side === 'no' ? 'no' : 'yes', stake = Number(o.stake) || 0, shares = Number(o.shares) || 0;
      var sig = o.signature || o.sig || o.id || '', btn = cashBtnFor(sig), action;
      if ((st === 'open' || st === 'claim') && btn) { var net = (btn.textContent.match(/([\d,]+\.?\d*)\s*$/) || [])[1] || ''; var claim = /claim|settle/i.test(btn.textContent); action = '<button class="tk-btn' + (claim ? ' claim' : '') + '" data-sig="' + esc(sig) + '">' + (claim ? 'Claim' : 'Sell') + (net ? ' · ' + esc(net) : '') + '</button>'; }
      else if (st === 'claim') { action = '<span class="tk-badge" style="color:#ffc04a">Won</span>'; }
      else if (st === 'paid') { action = '<span class="tk-res" style="color:#34d399">+' + (Number(o.cashoutOst) || 0).toFixed(2) + '</span>'; }
      else if (st === 'lost') { action = '<span class="tk-res" style="color:#fb7185">−' + stake.toFixed(2) + '</span>'; }
      else { action = '<span class="tk-badge">Open</span>'; }
      return '<div class="tk-row"><div class="tk-main"><div class="tk-title">' + esc(o.title || o.marketId || 'Ticket') + '</div>' +
        '<div class="tk-meta"><span class="tk-side ' + (side === 'yes' ? 'y' : 'n') + '">' + (side === 'yes' ? 'Yes' : 'No') + '</span> ' + stake.toFixed(0) + ' OSTG · ' + (shares > 0 ? shares.toFixed(1) + ' sh · ' : '') + ago(o.ts) + '</div></div>' +
        '<div>' + action + '</div></div>';
    }).join('');
    host.querySelectorAll('.tk-btn').forEach(function (b) {
      b.onclick = function () {
        var real = cashBtnFor(b.getAttribute('data-sig'));
        if (real) { b.disabled = true; b.textContent = '…'; try { real.click(); } catch (_) {} setTimeout(render, 1500); return; }
        // claim engine not on this page — route into the predictions panel to finish
        try { if (window.setWalletPanel) window.setWalletPanel('predict', { scroll: true }); } catch (_) {}
        try { if (window.OST_PREDICT_MOBILE && OST_PREDICT_MOBILE.openPositions) OST_PREDICT_MOBILE.openPositions(); } catch (_) {}
        close();
      };
    });
  }

  function open() { build(); render(); requestAnimationFrame(function () { el('ostTicketScrim').classList.add('on'); el('ostTicketSheet').classList.add('on'); }); }
  function close() { var s = el('ostTicketSheet'), c = el('ostTicketScrim'); if (s) s.classList.remove('on'); if (c) c.classList.remove('on'); }

  window.OST_TICKET = { open: open, close: close, render: render };
  window.addEventListener('ost:prediction-order-recorded', function () { if (el('ostTicketSheet') && el('ostTicketSheet').classList.contains('on')) render(); });
  window.addEventListener('ost:prediction-resolutions-refreshed', function () { if (el('ostTicketSheet') && el('ostTicketSheet').classList.contains('on')) render(); });
})();

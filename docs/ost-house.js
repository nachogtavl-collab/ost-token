/* ==========================================================================
 * OST · House — the ONE house edge, live on every transaction
 * --------------------------------------------------------------------------
 * The protocol takes a small, VISIBLE cut of every WINNING transaction — a
 * prediction claim, a parlay win or cash-out, a position/stock/memecoin sell,
 * or a faucet-game win. This is the real "in-house advantage": it performs on
 * its own, from the root, and the user sees it happen.
 *
 * Model: the fee is charged on PROFIT only — the amount above what the user
 * risked (stake / cost basis). So a loss or a break-even return is never
 * taxed; only winnings share a cut. That is a fair, defensible house edge and
 * it means "cash out the full amount, no fee" can no longer happen on a win.
 *
 *   rake(gross, basis, kind) -> { net, fee, bps }
 *     fee = max(0, gross - basis) * HOUSE_BPS/10000
 *     net = gross - fee           (this is what the user actually receives)
 *
 * Every fee is: recorded to the protocol treasury (ost:house-fee), surfaced
 * as a brief on-screen "House edge -X OST" note, and added to a running total
 * exposed on window.OST_HOUSE.collected() + any #ostHouseEdgeTotal element.
 *
 * Config: OST_FEE_HOUSE_BPS (localStorage, default 200 = 2% of profit).
 * ========================================================================== */
(function () {
  'use strict';

  var TOTAL_KEY = 'ost.house.collected.v1';
  var DEFAULT_BPS = 200; // 2% of profit

  function bps() {
    try {
      var v = parseFloat(localStorage.getItem('OST_FEE_HOUSE_BPS'));
      if (Number.isFinite(v) && v >= 0 && v <= 2000) return v;
    } catch (_) {}
    return DEFAULT_BPS;
  }

  function loadTotal() {
    try { return Number(JSON.parse(localStorage.getItem(TOTAL_KEY) || '0')) || 0; } catch (_) { return 0; }
  }
  function saveTotal(n) { try { localStorage.setItem(TOTAL_KEY, JSON.stringify(n)); } catch (_) {} }

  function renderTotal() {
    var el = document.getElementById('ostHouseEdgeTotal');
    if (el) el.textContent = loadTotal().toFixed(2) + ' OST';
  }

  // ---- visible, throttled fee note ---------------------------------------
  var noteEl = null, noteTimer = null, pendingFee = 0, pendingKind = '';
  function ensureNote() {
    if (noteEl) return noteEl;
    var st = document.getElementById('ostHouseNoteStyle');
    if (!st) {
      st = document.createElement('style');
      st.id = 'ostHouseNoteStyle';
      st.textContent =
        '#ostHouseNote{position:fixed;left:50%;transform:translateX(-50%) translateY(12px);' +
        'bottom:calc(var(--ost-appbar-h,0px) + env(safe-area-inset-bottom) + 18px);z-index:100000;' +
        'display:none;align-items:center;gap:7px;padding:8px 14px;border-radius:999px;' +
        'background:rgba(10,14,26,0.96);border:1px solid rgba(245,196,104,0.45);color:#f5c468;' +
        'font:800 12.5px/1 Inter,system-ui,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,0.5);' +
        'opacity:0;transition:opacity .2s ease,transform .2s ease;pointer-events:none;white-space:nowrap;}' +
        '#ostHouseNote.is-on{display:flex;opacity:1;transform:translateX(-50%) translateY(0);}';
      document.head.appendChild(st);
    }
    noteEl = document.createElement('div');
    noteEl.id = 'ostHouseNote';
    document.body.appendChild(noteEl);
    return noteEl;
  }
  function flashNote(fee, kind) {
    // Coalesce rapid fees (e.g. multi-ball plinko) into one note.
    pendingFee += fee;
    pendingKind = kind || pendingKind;
    var el = ensureNote();
    el.textContent = '🏦 House edge −' + pendingFee.toFixed(2) + ' OST';
    el.classList.add('is-on');
    clearTimeout(noteTimer);
    noteTimer = setTimeout(function () {
      el.classList.remove('is-on');
      pendingFee = 0; pendingKind = '';
    }, 2200);
  }

  // ---- core --------------------------------------------------------------
  function rake(gross, basis, kind, meta) {
    gross = Number(gross) || 0;
    basis = Number(basis) || 0;
    if (gross <= 0) return { net: 0, fee: 0, bps: bps() };
    var profit = Math.max(0, gross - basis);
    var b = bps();
    var fee = profit * b / 10000;
    if (!(fee > 0.0000001)) return { net: gross, fee: 0, bps: b };
    var net = Math.max(0, gross - fee);
    // record
    saveTotal(loadTotal() + fee);
    renderTotal();
    try { window.dispatchEvent(new CustomEvent('ost:house-fee', { detail: { source: kind || 'house', amount: fee, label: 'house edge', meta: meta || null } })); } catch (_) {}
    flashNote(fee, kind);
    return { net: net, fee: fee, bps: b };
  }

  // Convenience: rake a payout and return the NET the user should receive.
  function net(gross, basis, kind, meta) { return rake(gross, basis, kind, meta).net; }

  // Pure preview: what the user WOULD net after the house edge, WITHOUT
  // charging it (for showing cash-out offers / projected payouts up front).
  function quote(gross, basis) {
    gross = Number(gross) || 0; basis = Number(basis) || 0;
    if (gross <= 0) return { net: 0, fee: 0, bps: bps() };
    var fee = Math.max(0, gross - basis) * bps() / 10000;
    return { net: Math.max(0, gross - fee), fee: fee, bps: bps() };
  }

  // Record a fee that was ALREADY charged somewhere else — specifically, by the
  // on-chain betting program, which takes its own 2%-of-profit edge inside
  // claim_payout. Calling rake() for those payouts would book the same OST
  // twice (once on-chain, once here). book() records it exactly once and does
  // not touch the user's payout, because the chain already deducted it.
  function book(fee, kind, meta) {
    fee = Number(fee) || 0;
    if (!(fee > 0.0000001)) return 0;
    saveTotal(loadTotal() + fee);
    renderTotal();
    try { window.dispatchEvent(new CustomEvent('ost:house-fee', { detail: { source: kind || 'house', amount: fee, label: 'house edge', meta: meta || null } })); } catch (_) {}
    flashNote(fee, kind);
    return fee;
  }

  window.OST_HOUSE = {
    rake: rake,
    book: book,
    net: net,
    quote: quote,
    bps: bps,
    collected: loadTotal,
    render: renderTotal
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', renderTotal);
  else renderTotal();
})();

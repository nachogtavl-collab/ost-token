// OST · Optimistic feedback layer
// --------------------------------------------------------------------------
// window.OST_OPTIMISTIC was referenced all over the buy paths (prediction desk,
// modal, stock mirror) but NEVER DEFINED — so every optimistic hint was dead
// code and a buy showed nothing until the whole transaction confirmed. This
// defines it, so the instant a user taps, they get feedback while the real
// settlement runs in the background.
//
//   toast(msg, kind)   — a lightweight, self-contained toast (no dependency on
//                        any other module, so it always fires).
//   balanceHint(opts)  — tracks the pending balance delta of in-flight buys and
//                        broadcasts it, so balance readouts can show the drop
//                        immediately and reconcile when the tx confirms/clears.

(function () {
  'use strict';

  // ---- button flash (kept from the old clean-foundation layer) -------------
  if (!window.OST_CLEAN) {
    window.OST_CLEAN = true;
    document.addEventListener('click', function (e) {
      var btn = e.target && e.target.closest ? e.target.closest('button, [role="button"], .btn') : null;
      if (!btn) return;
      btn.style.transition = 'box-shadow 0.2s ease';
      btn.style.boxShadow = '0 0 0 3px rgba(16, 185, 129, 0.4)';
      setTimeout(function () { btn.style.boxShadow = ''; }, 400);
    }, true);
  }

  if (window.OST_OPTIMISTIC) return;

  // ---- toast ---------------------------------------------------------------
  var host = null;
  function ensureHost() {
    if (host && document.body.contains(host)) return host;
    host = document.createElement('div');
    host.id = 'ost-optimistic-toasts';
    host.setAttribute('aria-live', 'polite');
    host.style.cssText = [
      'position:fixed', 'left:50%', 'transform:translateX(-50%)',
      'bottom:calc(76px + env(safe-area-inset-bottom,0))', 'z-index:2147483000',
      'display:flex', 'flex-direction:column', 'gap:8px', 'align-items:center',
      'pointer-events:none', 'max-width:92vw'
    ].join(';');
    document.body.appendChild(host);
    return host;
  }
  var KIND_BG = {
    pending: 'linear-gradient(180deg,#1f2937,#111827)',
    success: 'linear-gradient(180deg,#065f46,#064e3b)',
    error: 'linear-gradient(180deg,#7f1d1d,#601414)',
    info: 'linear-gradient(180deg,#1e3a5f,#152943)'
  };
  function toast(msg, kind) {
    try {
      var el = document.createElement('div');
      el.textContent = String(msg == null ? '' : msg);
      el.style.cssText = [
        'pointer-events:auto', 'color:#f8fafc', 'font-weight:700',
        'font-size:13.5px', 'line-height:1.3', 'padding:10px 16px',
        'border-radius:14px', 'box-shadow:0 10px 30px -10px rgba(0,0,0,.6)',
        'border:1px solid rgba(255,255,255,.12)', 'max-width:92vw',
        'text-align:center', 'background:' + (KIND_BG[kind] || KIND_BG.info),
        'opacity:0', 'transform:translateY(8px) scale(.98)',
        'transition:opacity .16s ease, transform .16s cubic-bezier(.2,.8,.3,1)'
      ].join(';');
      ensureHost().appendChild(el);
      // next frame → animate in (so it reads as instant, not popped)
      requestAnimationFrame(function () { el.style.opacity = '1'; el.style.transform = 'translateY(0) scale(1)'; });
      var life = kind === 'error' ? 4200 : 2000;
      setTimeout(function () {
        el.style.opacity = '0'; el.style.transform = 'translateY(8px) scale(.98)';
        setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 220);
      }, life);
    } catch (_) {}
  }

  // ---- pending balance hint ------------------------------------------------
  // Tracks the net OST delta of buys that are placed but not yet confirmed, so
  // the visible balance can drop the instant a bet is made and reconcile when
  // the transaction confirms (settle) or fails (rollback).
  var pending = Object.create(null);          // ref -> delta (negative = spent)
  function total() {
    var t = 0;
    for (var k in pending) t += pending[k] || 0;
    return t;
  }
  function broadcast() {
    try { window.dispatchEvent(new CustomEvent('ost:optimistic-balance', { detail: { pendingDelta: total() } })); } catch (_) {}
  }
  function balanceHint(opts) {
    opts = opts || {};
    var ref = opts.ref || ('anon-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
    var delta = Number(opts.deltaOst) || 0;
    if (opts.pending) {
      pending[ref] = (pending[ref] || 0) + delta;   // delta already negative for a spend
    } else if (opts.settle) {
      // The real balance now reflects it — stop counting it as pending.
      delete pending[ref];
    } else if (opts.rollback) {
      // Never happened — drop the pending deduction (money handed back).
      delete pending[ref];
    }
    broadcast();
    return total();
  }

  window.OST_OPTIMISTIC = {
    toast: toast,
    balanceHint: balanceHint,
    pendingDelta: total
  };
})();

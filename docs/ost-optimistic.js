// OST · Notifications + optimistic feedback layer
// --------------------------------------------------------------------------
// ONE notification surface for the whole app (contract C2 in the money plan):
//
//   OST_NOTIFY({ id?, kind:'ok'|'info'|'warn'|'error'|'pending', title, body?,
//                sig?, action?:{label, run}, background? })
//     - A notice the user caused (a tap, a claim, a send, a buy) ALWAYS shows.
//     - Only {background:true} notices are filtered (they show only when they
//       are errors, or when window.OST_ALLOW_POPUP_NOTICES === true).
//     - Same text within 8 s is dropped; at most 3 on screen.
//     - A notice with an `id` updates IN PLACE (pending -> ok/error), so a
//       money action shows one card that changes state, never a stack.
//     - Returns the id (or null when filtered).
//
//   window.toast(icon, msg)      — back-compatible adapter. It was removed in
//                                  commit 6c73cca and ~10 modules silently fell
//                                  back to console.log; every money result was
//                                  invisible. Restored here, over OST_NOTIFY.
//   OST_OPTIMISTIC.toast(msg, kind) — kept, also over OST_NOTIFY.
//   OST_OPTIMISTIC.balanceHint(opts) — pending balance delta of in-flight buys.
//
// Self-contained: no dependency on any other module, so it always fires.

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

  if (window.OST_OPTIMISTIC && typeof window.OST_NOTIFY === 'function') return;

  // ---- host ------------------------------------------------------------------
  // Phones: bottom, above the bottom bar. Desktop: top-centre under the header,
  // so a result is never hidden under the floating dock or a sticky footer.
  var host = null;
  function injectStyle() {
    if (document.getElementById('ost-notify-style')) return;
    var st = document.createElement('style');
    st.id = 'ost-notify-style';
    st.textContent = [
      '#ost-optimistic-toasts{position:fixed;left:50%;transform:translateX(-50%);z-index:2147483000;display:flex;flex-direction:column;gap:8px;align-items:center;pointer-events:none;width:max-content;max-width:min(560px,92vw);bottom:calc(84px + env(safe-area-inset-bottom,0px))}',
      '@media (min-width:821px){#ost-optimistic-toasts{bottom:auto;top:84px}}',
      '.ostn{pointer-events:auto;display:flex;gap:10px;align-items:flex-start;color:#f8fafc;font:600 13.5px/1.35 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;padding:11px 14px;border-radius:14px;box-shadow:0 12px 32px -12px rgba(0,0,0,.7);border:1px solid rgba(255,255,255,.12);max-width:min(560px,92vw);text-align:left;opacity:0;transform:translateY(8px) scale(.98);transition:opacity .16s ease,transform .16s cubic-bezier(.2,.8,.3,1);overflow-wrap:normal;word-break:normal}',
      '.ostn.in{opacity:1;transform:none}',
      '.ostn-ok{background:linear-gradient(180deg,#065f46,#064e3b)}',
      '.ostn-info{background:linear-gradient(180deg,#1e3a5f,#152943)}',
      '.ostn-warn{background:linear-gradient(180deg,#78350f,#5b280b)}',
      '.ostn-error{background:linear-gradient(180deg,#7f1d1d,#601414)}',
      '.ostn-pending{background:linear-gradient(180deg,#1f2937,#111827)}',
      '.ostn-ico{flex:0 0 auto;font-size:15px;line-height:1.3}',
      '.ostn-pending .ostn-ico{display:inline-block;width:14px;height:14px;margin-top:2px;border:2px solid rgba(255,255,255,.35);border-top-color:#fff;border-radius:50%;animation:ostnspin .8s linear infinite;font-size:0}',
      '@keyframes ostnspin{to{transform:rotate(360deg)}}',
      '.ostn-main{flex:1 1 auto;min-width:0}',
      '.ostn-title{font-weight:700}',
      '.ostn-body{font-weight:500;opacity:.88;margin-top:2px}',
      '.ostn-sig{display:inline-block;margin-top:4px;color:#93c5fd;font-weight:600;text-decoration:underline}',
      '.ostn-act{flex:0 0 auto;align-self:center;background:rgba(255,255,255,.14);color:#fff;border:1px solid rgba(255,255,255,.25);border-radius:10px;padding:6px 10px;font:700 12.5px system-ui,sans-serif;cursor:pointer}',
      '.ostn-x{flex:0 0 auto;background:none;border:0;color:rgba(255,255,255,.6);font-size:16px;line-height:1;cursor:pointer;padding:0 0 0 4px}'
    ].join('\n');
    (document.head || document.documentElement).appendChild(st);
  }
  function ensureHost() {
    if (host && document.body && document.body.contains(host)) return host;
    injectStyle();
    host = document.getElementById('ost-optimistic-toasts');
    if (!host) {
      host = document.createElement('div');
      host.id = 'ost-optimistic-toasts';
      host.setAttribute('aria-live', 'polite');
      host.setAttribute('role', 'status');
      document.body.appendChild(host);
    }
    return host;
  }

  var KINDS = { ok: 1, info: 1, warn: 1, error: 1, pending: 1 };
  var ICON = { ok: '✓', info: 'ℹ', warn: '⚠', error: '✕', pending: '' };
  function normKind(k) {
    k = String(k || '').toLowerCase();
    if (KINDS[k]) return k;
    if (k === 'success' || k === 'done' || k === 'confirmed') return 'ok';
    if (k === 'err' || k === 'failed' || k === 'fail') return 'error';
    if (k === 'warning' || k === 'refused') return 'warn';
    if (k === 'confirming' || k === 'submitting' || k === 'signing') return 'pending';
    return 'info';
  }
  function explorerTx(sig) {
    var c = 'devnet';
    try { c = (window.OST_CONFIG && window.OST_CONFIG.network) || 'devnet'; } catch (_) {}
    return 'https://explorer.solana.com/tx/' + encodeURIComponent(sig) + (c === 'mainnet-beta' ? '' : '?cluster=' + c);
  }
  function shortSig(s) { s = String(s || ''); return s.length > 12 ? s.slice(0, 6) + '…' + s.slice(-4) : s; }

  var live = Object.create(null);   // id -> { el, timer }
  var lastAt = Object.create(null); // dedupe key -> ts
  var seq = 0;
  var LIFE = { ok: 4500, info: 4000, warn: 6000, error: 7000, pending: 60000 };

  function fill(el, n) {
    el.className = 'ostn ostn-' + n.kind + (el.classList.contains('in') ? ' in' : '');
    el.innerHTML = '';
    var ico = document.createElement('span'); ico.className = 'ostn-ico'; ico.setAttribute('aria-hidden', 'true');
    ico.textContent = n.icon != null ? n.icon : ICON[n.kind];
    var main = document.createElement('div'); main.className = 'ostn-main';
    var t = document.createElement('div'); t.className = 'ostn-title'; t.textContent = n.title; main.appendChild(t);
    if (n.body) { var b = document.createElement('div'); b.className = 'ostn-body'; b.textContent = n.body; main.appendChild(b); }
    if (n.sig) { var a = document.createElement('a'); a.className = 'ostn-sig'; a.href = explorerTx(n.sig); a.target = '_blank'; a.rel = 'noopener'; a.textContent = 'tx ' + shortSig(n.sig); main.appendChild(a); }
    el.appendChild(ico); el.appendChild(main);
    if (n.action && n.action.label && typeof n.action.run === 'function') {
      var btn = document.createElement('button'); btn.type = 'button'; btn.className = 'ostn-act'; btn.textContent = n.action.label;
      btn.addEventListener('click', function (e) { e.preventDefault(); try { n.action.run(); } catch (_) {} dismiss(el); });
      el.appendChild(btn);
    }
    if (n.kind === 'error' || n.kind === 'warn' || n.kind === 'pending' || n.action) {
      var x = document.createElement('button'); x.type = 'button'; x.className = 'ostn-x'; x.setAttribute('aria-label', 'Dismiss'); x.textContent = '×';
      x.addEventListener('click', function () { dismiss(el); });
      el.appendChild(x);
    }
    el.setAttribute('role', n.kind === 'error' ? 'alert' : 'status');
  }
  function dismiss(el) {
    if (!el) return;
    el.classList.remove('in');
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 200);
    Object.keys(live).forEach(function (k) { if (live[k] && live[k].el === el) { clearTimeout(live[k].timer); delete live[k]; } });
  }
  function arm(id, el, kind, ms) {
    var rec = live[id] || (live[id] = { el: el, timer: 0 });
    rec.el = el;
    clearTimeout(rec.timer);
    rec.timer = setTimeout(function () { dismiss(el); }, ms || LIFE[kind] || 4000);
  }

  function notify(opts) {
    try {
      if (typeof opts === 'string') opts = { title: opts };
      opts = opts || {};
      var n = {
        kind: normKind(opts.kind),
        title: String(opts.title != null ? opts.title : (opts.message != null ? opts.message : '')).trim(),
        body: opts.body != null ? String(opts.body).trim() : '',
        sig: opts.sig ? String(opts.sig) : '',
        action: opts.action || null,
        icon: opts.icon != null ? String(opts.icon) : null
      };
      if (!n.title && n.body) { n.title = n.body; n.body = ''; }
      if (!n.title) return null;
      // Background notices (polls, realtime echoes) are the only thing filtered.
      if (opts.background && n.kind !== 'error' && window.OST_ALLOW_POPUP_NOTICES !== true) return null;
      if (!document.body) { document.addEventListener('DOMContentLoaded', function () { notify(opts); }, { once: true }); return opts.id || null; }
      var h = ensureHost();
      var id = opts.id ? String(opts.id) : '';
      var now = Date.now();
      // Same INCOMING amount + token within 10 s from two modules = one event
      // (e.g. the faucet's "100 OST arrived" and the wallet home's chain echo
      // "Received 100 OST from …"). Only receipt echoes are de-duplicated this
      // way: a user-initiated result ("Sent 5 OST", "Converting 5 OST…") always
      // shows (C2), and a failure is never swallowed by an earlier success.
      var ak = '';
      if (n.kind === 'ok' || n.kind === 'info') {
        var am = /([+\-]?\d[\d,]*(?:\.\d+)?)\s*(OSTG|OSTC|OST|SOL)\b/i.exec(n.title + ' ' + n.body);
        if (am && /\b(received|arrived|incoming)\b/i.test(n.title)) ak = 'amt-in:' + am[1].replace(/[+,]/g, '') + am[2].toUpperCase().replace('OSTC', 'OST');
      }
      // In-place update of a live notice with the same id.
      if (id && live[id] && live[id].el && h.contains(live[id].el)) {
        fill(live[id].el, n);
        arm(id, live[id].el, n.kind, opts.durationMs);
        if (ak) lastAt[ak] = now;
        return id;
      }
      if (!id) {
        var key = (n.kind + '|' + n.title + '|' + n.body).replace(/\s+/g, ' ').slice(0, 200);
        if (now - (lastAt[key] || 0) < 8000) return null;
        lastAt[key] = now;
        if (ak && now - (lastAt[ak] || 0) < 10000) return null;
        id = 'n' + (++seq);
      }
      if (ak) lastAt[ak] = now;
      // Max 3 on screen: drop the oldest non-pending first.
      var kids = Array.prototype.slice.call(h.children);
      while (kids.length >= 3) {
        var victim = kids.filter(function (c) { return !/ostn-pending/.test(c.className); })[0] || kids[0];
        dismiss(victim); if (victim.parentNode) victim.parentNode.removeChild(victim);
        kids = Array.prototype.slice.call(h.children);
      }
      var el = document.createElement('div');
      fill(el, n);
      h.appendChild(el);
      requestAnimationFrame(function () { el.classList.add('in'); });
      arm(id, el, n.kind, opts.durationMs);
      return id;
    } catch (_) { return null; }
  }
  notify.dismiss = function (id) { if (id && live[id]) dismiss(live[id].el); };

  // ---- back-compatible adapters ------------------------------------------
  // window.toast(icon, msg[, opts]) — the shape ~10 modules still call.
  function kindFromIcon(icon, msg) {
    var i = String(icon == null ? '' : icon), m = String(msg == null ? '' : msg);
    if (/❌|✕|✖|💔|^err/i.test(i)) return 'error';
    if (/\b(failed|failure|error|could not|couldn't|cannot|can't|refused|denied|rejected|invalid)\b/i.test(m)) return 'error';
    if (/⚠|^warn/i.test(i)) return 'warn';
    if (/✅|🎉|✓|^ok$|^success$|^done$/i.test(i)) return 'ok';
    return 'info';
  }
  function iconFor(icon) {
    var i = String(icon == null ? '' : icon).trim();
    if (!i || /^(ok|info|live|warn|error|err|success|done|pending)$/i.test(i)) return null;
    if (/^&#?\w+;$/.test(i)) { var d = document.createElement('textarea'); d.innerHTML = i; i = d.value; }
    return i.slice(0, 4);
  }
  function legacyToast(icon, msg, opts) {
    // toast('message') with one argument also happens in the wild.
    if (msg === undefined && typeof icon === 'string' && icon.length > 4) { msg = icon; icon = ''; }
    opts = opts || {};
    return notify({
      id: opts.id, kind: opts.kind || kindFromIcon(icon, msg), title: msg, body: opts.body, sig: opts.sig,
      action: opts.action, background: !!opts.background || /^live$/i.test(String(icon || '')),
      icon: iconFor(icon)
    });
  }

  function toast(msg, kind) {
    return notify({ title: msg, kind: normKind(kind || 'info') });
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

  // ost-notifications.js (PWA push / Mesh alerts) assigns its own OBJECT to
  // window.OST_NOTIFY ({request, mesh, enabled, …}). That used to replace this
  // callable, so every `OST_NOTIFY({...})` money notice silently did nothing.
  // Keep ONE callable: an assigned object's methods are merged onto it, so
  // `OST_NOTIFY({...})` and `OST_NOTIFY.mesh(...)` both keep working whatever
  // the script order.
  function adopt(v) {
    if (!v || v === notify || (typeof v !== 'object' && typeof v !== 'function')) return;
    Object.keys(v).forEach(function (k) { if (k !== 'dismiss') { try { notify[k] = v[k]; } catch (_) {} } });
  }
  try {
    adopt(window.OST_NOTIFY);
    Object.defineProperty(window, 'OST_NOTIFY', {
      configurable: true, enumerable: true,
      get: function () { return notify; },
      set: function (v) { adopt(v); }
    });
  } catch (_) { window.OST_NOTIFY = notify; }
  if (typeof window.toast !== 'function') window.toast = legacyToast;
  window.OST_OPTIMISTIC = {
    toast: toast,
    notify: notify,
    balanceHint: balanceHint,
    pendingDelta: total
  };
})();

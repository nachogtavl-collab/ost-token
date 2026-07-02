/* ==========================================================================
 * OST Money — shared demo balance across every OS app
 * --------------------------------------------------------------------------
 * The OS Desktop (index.html) links out to standalone pages (Visual Studio,
 * Grok, X App, Mesh, Veil, Commerce). Each one used to be an island with no
 * shared state. This gives every page the same OST balance (localStorage),
 * a floating badge to see/spend it, and helpers so any page can pay the
 * user for using it. Pure additive/self-contained — no page needs to change
 * its existing logic, just include this file and call window.OST_MONEY.
 * ========================================================================== */
(function () {
  'use strict';

  var KEY = 'ost.demo.balance.v1';
  var STARTING_BALANCE = 25;

  function read() {
    try {
      var raw = localStorage.getItem(KEY);
      if (raw === null) { localStorage.setItem(KEY, String(STARTING_BALANCE)); return STARTING_BALANCE; }
      var n = parseFloat(raw);
      return isNaN(n) ? 0 : n;
    } catch (_) { return STARTING_BALANCE; }
  }

  function write(n) {
    try { localStorage.setItem(KEY, String(n)); } catch (_) {}
  }

  function add(amount, source) {
    amount = Number(amount) || 0;
    if (amount <= 0) return read();
    var total = read() + amount;
    write(total);
    render();
    bump(amount);
    try { window.dispatchEvent(new CustomEvent('ost-money-changed', { detail: { total: total, delta: amount, source: source || '' } })); } catch (_) {}
    return total;
  }

  function spend(amount, source) {
    amount = Number(amount) || 0;
    var current = read();
    if (amount <= 0 || amount > current) return false;
    var total = current - amount;
    write(total);
    render();
    try { window.dispatchEvent(new CustomEvent('ost-money-changed', { detail: { total: total, delta: -amount, source: source || '' } })); } catch (_) {}
    return true;
  }

  function injectStyles() {
    if (document.getElementById('ostMoneyStyle')) return;
    var st = document.createElement('style');
    st.id = 'ostMoneyStyle';
    st.textContent =
      '#ostMoneyBadge{position:fixed;top:16px;right:16px;z-index:99999;display:inline-flex;align-items:center;gap:6px;' +
      'padding:9px 16px;border-radius:9999px;border:2px solid #34d399;background:rgba(6,20,14,0.92);' +
      'color:#34d399;font-family:inherit;font-weight:800;font-size:14px;cursor:pointer;box-shadow:0 4px 24px rgba(0,0,0,0.4);' +
      'transition:transform .15s;}' +
      '#ostMoneyBadge:hover{transform:translateY(-2px);}' +
      '#ostMoneyBadge.is-bump{animation:ostMoneyBump .5s ease;}' +
      '@keyframes ostMoneyBump{0%{transform:scale(1);}30%{transform:scale(1.15);background:rgba(52,211,153,0.25);}100%{transform:scale(1);}}' +
      '#ostMoneyDelta{position:absolute;top:-20px;left:50%;transform:translateX(-50%);color:#34d399;font-size:13px;' +
      'font-weight:800;opacity:0;transition:opacity .3s,top .3s;pointer-events:none;}' +
      '#ostMoneyDelta.is-visible{opacity:1;top:-28px;}' +
      '@media (max-width:640px){#ostMoneyBadge{top:10px;right:10px;padding:7px 12px;font-size:12px;}}';
    document.head.appendChild(st);
  }

  function ensureBadge() {
    var badge = document.getElementById('ostMoneyBadge');
    if (badge) return badge;
    injectStyles();
    badge = document.createElement('div');
    badge.id = 'ostMoneyBadge';
    badge.title = 'Your OST balance across every OST app. Click to open Commerce.';
    badge.innerHTML = '<span id="ostMoneyDelta"></span><span>&#9673;</span><span id="ostMoneyAmount">0.00</span><span style="opacity:.7;font-weight:600;">OST</span>';
    badge.addEventListener('click', function () {
      var here = (location.pathname.split('/').pop() || '');
      if (here === 'commerce.html') return;
      window.location.href = 'commerce.html';
    });
    document.body.appendChild(badge);
    return badge;
  }

  var bumpTimer = null;
  var deltaTimer = null;

  function bump(amount) {
    var badge = ensureBadge();
    badge.classList.remove('is-bump');
    void badge.offsetWidth;
    badge.classList.add('is-bump');
    clearTimeout(bumpTimer);
    bumpTimer = setTimeout(function () { badge.classList.remove('is-bump'); }, 520);

    var deltaEl = document.getElementById('ostMoneyDelta');
    if (deltaEl) {
      deltaEl.textContent = '+' + amount.toFixed(2);
      deltaEl.classList.add('is-visible');
      clearTimeout(deltaTimer);
      deltaTimer = setTimeout(function () { deltaEl.classList.remove('is-visible'); }, 1200);
    }
  }

  function render() {
    var badge = ensureBadge();
    var amountEl = document.getElementById('ostMoneyAmount');
    if (amountEl) amountEl.textContent = read().toFixed(2);
  }

  function boot() {
    render();
    window.addEventListener('storage', function (e) { if (e.key === KEY) render(); }, false);
  }

  window.OST_MONEY = { get: read, add: add, spend: spend, refresh: render };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();

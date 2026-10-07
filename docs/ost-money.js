/* ==========================================================================
 * OST Money — ONE money API for every OST page
 * --------------------------------------------------------------------------
 * DECISION D1 (money plan C12): legacy credits are RETIRED. They have no
 * cash value: nothing grants new credits (add() is a no-op), nothing spends
 * them (spend() refuses) and they are shown as "Retired legacy credits (not
 * cashable)". Real devnet OST lives on chain only.
 *
 * window.OST_MONEY is the single way to read the user's legacy
 * bonus credits. It is a facade over the SAME canonical pool the faucet
 * hub, games, Code Academy and mesh markets use:
 *
 *     localStorage['ost.faucet.hub.v2']  ->  { credits, lifetime }
 *
 * (The other pool is the real on-chain devnet balance shown in the wallet
 * dashboard — that one only changes through actual token transfers.)
 *
 * v1 of this file mistakenly kept its own store ('ost.demo.balance.v1'),
 * creating a third disconnected balance. v2 folds any remaining v1 value
 * into the canonical pool once, then deletes the old key.
 *
 * Pages without their own balance UI (OS Desktop, Grok, X App, Veil...)
 * get a floating badge; pages with the nav total badge (classic app)
 * get the API only.
 * ========================================================================== */
(function () {
  'use strict';

  var HUB_KEY = 'ost.faucet.hub.v2';
  var LEGACY_KEY = 'ost.demo.balance.v1';

  function loadHub() {
    try { return JSON.parse(localStorage.getItem(HUB_KEY) || '{}') || {}; } catch (_) { return {}; }
  }
  function saveHub(s) {
    try { localStorage.setItem(HUB_KEY, JSON.stringify(s)); } catch (_) {}
  }

  // One-time: fold the old demo balance into the legacy pool. No welcome
  // bonus is granted any more (D1).
  function migrate() {
    var s = loadHub();
    var changed = false;
    try {
      var legacy = localStorage.getItem(LEGACY_KEY);
      if (legacy !== null) {
        var v = parseFloat(legacy);
        if (!isNaN(v) && v > 0) {
          s.credits = Number(s.credits || 0) + v;
          s.lifetime = Number(s.lifetime || 0) + v;
        }
        localStorage.removeItem(LEGACY_KEY);
        s.welcomeBonus = true; // legacy users already had their 25
        changed = true;
      }
    } catch (_) {}
    if (changed) saveHub(s);
  }

  function read() {
    return Number(loadHub().credits || 0);
  }

  function syncSharedUi(total) {
    // Keep the faucet hub counter and any [data-ostg-balance] element in step
    // (same contract code-academy.js and ost-games.js follow).
    var fh = document.getElementById('fhCredits');
    if (fh) fh.textContent = total.toFixed(2);
    document.querySelectorAll('[data-ostg-balance]').forEach(function (e) {
      e.textContent = total.toFixed(2);
    });
  }

  // `silent` suppresses the celebratory award event ONLY (the ghost bubble,
  // confetti, sound). Balances still broadcast via ost-money-changed so every
  // UI updates. Batch payouts (auto-claim settling a backlog of wins) use this
  // and show ONE summary instead of a notification per bet.
  function broadcast(delta, total, source, silent) {
    try { window.dispatchEvent(new CustomEvent('ost-money-changed', { detail: { total: total, delta: delta, source: source || '', silent: !!silent } })); } catch (_) {}
    if (delta > 0 && !silent) {
      try { window.dispatchEvent(new CustomEvent('ost-faucet-hub-award', { detail: { credits: delta, source: source || 'ost-money', total: total } })); } catch (_) {}
    }
  }

  // D1: no new grants. Kept as a no-op so old callers do not throw.
  function add(amount, source, opts) {
    void amount; void source; void opts;
    return read();
  }

  // D1: retired credits cannot be spent.
  function spend(amount, source) {
    void amount; void source;
    return false;
  }
  void bump; void broadcast; void syncSharedUi;

  // ------------------------------------------------------------------ badge
  function pageHasOwnBalanceUi() {
    // The classic app renders its own nav total badge (ost-total-balance.js)
    return !!document.getElementById('walletBtn');
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
    if (pageHasOwnBalanceUi()) return null;
    var badge = document.getElementById('ostMoneyBadge');
    if (badge) return badge;
    injectStyles();
    badge = document.createElement('div');
    badge.id = 'ostMoneyBadge';
    badge.title = 'Retired legacy credits — no cash value, not cashable.';
    badge.innerHTML = '<span id="ostMoneyDelta"></span><span>&#9673;</span><span id="ostMoneyAmount">0.00</span><span style="opacity:.7;font-weight:600;">credits · not cashable</span>';
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
    if (!badge) return;
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
    // Nothing to show when there are no legacy credits.
    if (!(read() > 0)) { var old = document.getElementById('ostMoneyBadge'); if (old) old.remove(); return; }
    var badge = ensureBadge();
    if (!badge) return;
    var amountEl = document.getElementById('ostMoneyAmount');
    if (amountEl) amountEl.textContent = read().toFixed(2);
  }

  function boot() {
    migrate();
    render();
    window.addEventListener('storage', function (e) { if (e.key === HUB_KEY) { render(); } }, false);
    // Other modules award into the same pool — reflect their changes too.
    window.addEventListener('ost-faucet-hub-award', function () { render(); }, false);
  }

  window.OST_MONEY = { get: read, add: add, spend: spend, refresh: render, key: HUB_KEY, retired: true, cashable: false };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();

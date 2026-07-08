/* ==========================================================================
 * OST · Balance Tree — ONE trunk for every OST the user owns
 * --------------------------------------------------------------------------
 * The critical "OST disappears on refresh" bug: the on-chain branch had ZERO
 * persistence. #wdOstBal is only painted after a live devnet RPC read, so any
 * hard refresh showed 0/blank on-chain OST until RPC succeeded (seconds… or
 * never on flaky devnet). The visible total collapsed to bare credits — the
 * "determined balance it always returns to" — and deposits looked stolen.
 *
 * This module is the tree's trunk:
 *
 *          OST_TREE.total()
 *         /        |        \
 *     chain()   credits()   vault()      (+ every branch in breakdown())
 *
 *  - chain():   on-chain SPL balance. Live DOM value when fresh, otherwise a
 *               PERSISTED per-address last-known cache (ost.chain.lastKnown.v1)
 *               written on every successful RPC read via reportChain().
 *               This is a DISPLAY CACHE of pool #1 — NOT a new spendable pool:
 *               spending is still gated by the actual on-chain transfer.
 *  - credits(): the canonical off-chain pool (ost.faucet.hub.v2, via OST_MONEY).
 *  - vault():   offline/survival OST (backed portion), reported by
 *               offline-vault.js via OST_TREE.reportVault(). Shown as locked.
 *
 * On boot it re-paints #wdOstBal from the cache immediately (marked stale via
 * data-ost-stale until a fresh read lands), so a hard refresh NEVER zeroes the
 * user's on-chain money again.
 * ========================================================================== */
(function () {
  'use strict';

  var CACHE_KEY = 'ost.chain.lastKnown.v1';
  var vaultBacked = 0; // reported by offline-vault when it opens

  function readCache() {
    try {
      var c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
      if (c && typeof c.amount === 'number' && Number.isFinite(c.amount) && c.amount >= 0) return c;
    } catch (_) {}
    return null;
  }
  function writeCache(addr, amount) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ addr: String(addr || ''), amount: amount, ts: Date.now() }));
    } catch (_) {}
  }

  function credits() {
    try {
      if (window.OST_MONEY && window.OST_MONEY.get) {
        var s = window.OST_MONEY.get();
        return Number(s && s.credits != null ? s.credits : s) || 0;
      }
      return Number((JSON.parse(localStorage.getItem('ost.faucet.hub.v2') || '{}')).credits) || 0;
    } catch (_) { return 0; }
  }

  function liveDomChain() {
    var el = document.getElementById('wdOstBal');
    if (!el) return null;
    var n = parseFloat(String(el.textContent).replace(/[^\d.\-]/g, ''));
    if (isNaN(n) || n < 0) return null;
    return { amount: n, stale: el.getAttribute('data-ost-stale') === '1' };
  }

  function chain() {
    var dom = liveDomChain();
    if (dom && !dom.stale) return { amount: dom.amount, stale: false, source: 'live' };
    var c = readCache();
    if (c) return { amount: c.amount, stale: true, source: 'cache', ts: c.ts, addr: c.addr };
    if (dom) return { amount: dom.amount, stale: true, source: 'dom' };
    return { amount: 0, stale: true, source: 'none' };
  }

  function vault() { return { amount: Math.max(0, Number(vaultBacked) || 0), locked: true }; }

  function breakdown() {
    var ch = chain(), cr = credits(), va = vault();
    return {
      chain: ch,
      credits: cr,
      vault: va,
      spendable: ch.amount + cr,          // vault OST is locked until redeemed
      total: ch.amount + cr + va.amount
    };
  }

  function emit() {
    try { window.dispatchEvent(new CustomEvent('ost:tree-changed', { detail: breakdown() })); } catch (_) {}
  }

  /* ---- writers ------------------------------------------------------------ */
  // Called by app.js after EVERY successful on-chain balance read.
  function reportChain(addr, amount) {
    var n = Number(amount);
    if (!Number.isFinite(n) || n < 0) return;
    writeCache(addr, n);
    var el = document.getElementById('wdOstBal');
    if (el) el.removeAttribute('data-ost-stale'); // fresh read is now on screen
    emit();
  }
  // Called by offline-vault.js whenever the backed amount is known/changes.
  function reportVault(backed) {
    var n = Number(backed);
    if (!Number.isFinite(n) || n < 0) return;
    vaultBacked = n;
    emit();
  }

  /* ---- boot: heal the refresh hole ---------------------------------------- */
  // If the dashboard's on-chain field is empty/blank at boot but we have a
  // last-known value, paint it immediately (marked stale). The next fresh RPC
  // read overwrites it and clears the mark. This is why funds no longer
  // "disappear on refresh".
  function seed() {
    var c = readCache();
    if (!c || !(c.amount > 0)) return;
    var el = document.getElementById('wdOstBal');
    if (!el) return;
    var cur = parseFloat(String(el.textContent).replace(/[^\d.\-]/g, ''));
    if (Number.isFinite(cur) && cur > 0) return; // a real value is already shown
    el.textContent = c.amount.toFixed(2);
    el.setAttribute('data-ost-stale', '1');
    el.title = 'Last confirmed on-chain balance — syncing with devnet…';
    emit();
    try { window.dispatchEvent(new CustomEvent('ost:wallet-changed', { detail: { source: 'tree-seed' } })); } catch (_) {}
  }
  // The dashboard renders progressively; try a few times, cheap no-ops after.
  var tries = 0;
  var t = setInterval(function () {
    tries++;
    seed();
    if (tries >= 20) clearInterval(t); // covers first ~20s of boot
  }, 1000);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', seed);
  else seed();

  window.OST_TREE = {
    chain: chain,
    credits: credits,
    vault: vault,
    breakdown: breakdown,
    total: function () { return breakdown().total; },
    spendable: function () { return breakdown().spendable; },
    reportChain: reportChain,
    reportVault: reportVault
  };
})();

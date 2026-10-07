/* ==========================================================================
 * OST · Total Balance badge — one number for "how much OST do I have"
 * --------------------------------------------------------------------------
 * Shows the wallet's on-chain OST (devnet) from OST_BALANCE (contract C6) in
 * the header; clicking it opens the wallet. Legacy bonus credits are retired
 * and not cashable (D1), so they are not added. Unknown shows "—", never 0.
 * Read-only: it never changes a balance.
 * ========================================================================== */
(function () {
  'use strict';

  var CREDIT_KEY = 'ost.faucet.hub.v2';

  function getCredits() {
    try {
      var s = JSON.parse(localStorage.getItem(CREDIT_KEY) || '{}');
      return Number(s.credits || 0);
    } catch (_) { return 0; }
  }

  // C6: the ONE balance authority is OST_BALANCE (on-chain OST); the balance
  // tree's persisted last-known amount is the fallback. Unknown -> null (the
  // badge shows "—"), never a 0 scraped off the screen.
  function getWalletOst() {
    try {
      var W = window.OST_WALLET;
      if (!(W && typeof W.pubkey === 'function' && W.pubkey())) return null;
    } catch (_) {}
    try {
      if (window.OST_BALANCE && typeof window.OST_BALANCE.onchainOstc === 'function') {
        var v = window.OST_BALANCE.onchainOstc();
        if (v != null && Number.isFinite(Number(v))) return Math.max(0, Number(v));
      }
    } catch (_) {}
    try {
      if (window.OST_TREE && window.OST_TREE.chain) {
        var c = window.OST_TREE.chain();
        if (c && Number.isFinite(c.amount)) return Math.max(0, c.amount);
      }
    } catch (_) {}
    return null;
  }

  function injectStyles() {
    if (document.getElementById('ostTotalBalStyle')) return;
    var st = document.createElement('style');
    st.id = 'ostTotalBalStyle';
    st.textContent =
      '.ost-total-badge{display:inline-flex;align-items:center;gap:6px;padding:7px 12px;margin-right:8px;' +
      'border-radius:999px;border:1px solid rgba(245,196,104,0.35);background:rgba(245,196,104,0.08);' +
      'color:#f5c468;font-size:13px;font-weight:700;cursor:pointer;white-space:nowrap;line-height:1;}' +
      '.ost-total-badge:hover{background:rgba(245,196,104,0.16);}' +
      '.ost-total-badge .ost-total-sub{color:#94a3b8;font-weight:500;font-size:11px;margin-left:2px;}' +
      '@media (max-width:860px){.ost-total-badge{padding:6px 10px;font-size:12px;}}';
    document.head.appendChild(st);
  }

  function ensureBadge() {
    var existing = document.getElementById('ostTotalBadge');
    if (existing) return existing;
    var walletBtn = document.getElementById('walletBtn');
    if (!walletBtn || !walletBtn.parentNode) return null;
    injectStyles();
    var btn = document.createElement('button');
    btn.id = 'ostTotalBadge';
    btn.type = 'button';
    btn.className = 'ost-total-badge';
    // C6: the token is shown as "OST" everywhere (it used to say "OSTC" here).
    btn.title = 'Your on-chain OST (devnet). Click to open your wallet.';
    btn.innerHTML = '<span>&#9673;</span><span id="ostTotalBadgeAmount">&mdash;</span><span class="ost-total-sub">OST</span>';
    btn.addEventListener('click', function () {
      if (window.OST_LINK && typeof window.OST_LINK.go === 'function') { window.OST_LINK.go('wallet'); return; }
      location.hash = '#wallet';
    });
    walletBtn.parentNode.insertBefore(btn, walletBtn);
    return btn;
  }

  function render() {
    var badge = ensureBadge();
    if (!badge) return;
    var amountEl = document.getElementById('ostTotalBadgeAmount');
    if (!amountEl) return;
    // ONE balance: the on-chain OSTC the Wallet shows. Adding legacy bonus credits made a
    // third number ("25.00 OST") that matched nothing else; credits retired 2026-09-25.
    var w = getWalletOst();
    amountEl.textContent = w == null ? '—' : w.toFixed(2);
  }

  function boot() {
    render();
    window.addEventListener('ost:balance', render, false);
    window.addEventListener('ost-faucet-hub-award', render, false);
    window.addEventListener('ost-money-changed', render, false);
    window.addEventListener('ost:wallet-changed', render, false);
    window.addEventListener('storage', function (e) { if (e.key === CREDIT_KEY) render(); }, false);
    // Safety-net poll: the wallet dashboard's own balance fetch is async
    // and does not always fire ost:wallet-changed after populating #wdOstBal.
    window.setInterval(render, 4000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 900); });
  } else {
    setTimeout(boot, 900);
  }
})();

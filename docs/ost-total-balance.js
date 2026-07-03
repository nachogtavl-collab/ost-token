/* ==========================================================================
 * OST · Total Balance badge — one number for "how much OST do I have"
 * --------------------------------------------------------------------------
 * The site tracks OST in two places that never merge on their own:
 *   1) the real on-chain wallet balance (#wdOstBal, wallet dashboard)
 *   2) off-chain bonus credits earned via faucet-hub / games / academy /
 *      mesh markets, stored at localStorage['ost.faucet.hub.v2'].credits
 * Both are real OST (credits are redeemable via the vault cash-out flow),
 * so this badge shows the combined total in the nav at all times and
 * clicking it jumps to the wallet panel. Pure additive layer — does not
 * touch either underlying balance, only reads and displays them.
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

  function getWalletOst() {
    var el = document.getElementById('wdOstBal');
    if (!el) return 0;
    var n = parseFloat(el.textContent);
    return isNaN(n) ? 0 : n;
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
    btn.title = 'Total OST: wallet balance + bonus credits earned across the site. Click to open your wallet.';
    btn.innerHTML = '<span>&#9673;</span><span id="ostTotalBadgeAmount">0.00</span><span class="ost-total-sub">OST</span>';
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
    var total = getWalletOst() + getCredits();
    amountEl.textContent = total.toFixed(2);
  }

  function boot() {
    render();
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

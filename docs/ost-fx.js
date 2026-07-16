/* ==========================================================================
 * OST · FX — show every OST amount in the user's own currency, everywhere
 * --------------------------------------------------------------------------
 * The app already had the pieces (OST→USD via OST_CONVERT_PRICE.ostUsd(), and
 * USD→fiat via OST_FORMAT_PRIMARY_FIAT with live rates from open.er-api.com),
 * but they were never surfaced on the screens where users actually do the math:
 * wallet balances, the trade ticket, market P&L, games, sending OST. So people
 * had to convert "37 OST" into their money in their head.
 *
 * This module unifies them into ONE helper and auto-decorates the UI:
 *
 *   OST_FX.usdPerOst()      -> live OST→USD price
 *   OST_FX.toFiat(ost)      -> number in the preferred currency
 *   OST_FX.format(ost)      -> "€0.44" (localized, with symbol)
 *   OST_FX.hint(ost)        -> "≈ €0.44"  (for appending next to an OST amount)
 *   OST_FX.currency()/symbol()
 *
 * Auto-decoration: any element carrying `data-ost-fx="<ostAmount>"` gets its
 * fiat hint rendered and kept live as the currency OR the OST price changes.
 * Elements that already print "<n> OST" inside a whitelisted region also get a
 * fiat hint appended automatically, so existing screens light up with no render
 * changes. All of it re-runs on `ost:currencychange` and price ticks.
 * ========================================================================== */
(function () {
  'use strict';
  if (window.OST_FIAT) return;

  // Subtle, muted fiat hint — reads as a secondary "≈ €0.44" next to the OST
  // amount, never competing with it.
  try {
    var st = document.createElement('style');
    // The auto-appended hint is a ::after pseudo-element driven by a CSS custom
    // property, so the host element's real textContent is NEVER modified — code
    // that reads "25 OST" out of the DOM still reads exactly that.
    st.textContent = '.ost-fx-host::after{content:var(--ost-fiat,"");opacity:.62;font-weight:600;font-size:.86em;white-space:nowrap;margin-left:.3em}'
      + '.ost-fx-hint{opacity:.62;font-weight:600;font-size:.86em;white-space:nowrap;margin-left:.3em}';
    (document.head || document.documentElement).appendChild(st);
  } catch (_) {}

  function usdPerOst() {
    try {
      if (window.OST_CONVERT_PRICE && typeof window.OST_CONVERT_PRICE.ostUsd === 'function') {
        var v = Number(window.OST_CONVERT_PRICE.ostUsd());
        if (Number.isFinite(v) && v > 0) return v;
      }
    } catch (_) {}
    try {
      if (window.OST_TOPUP && typeof window.OST_TOPUP.usdPerOst === 'function') {
        var t = Number(window.OST_TOPUP.usdPerOst());
        if (Number.isFinite(t) && t > 0) return t;
      }
    } catch (_) {}
    var p = window.__ostPrices || {};
    if (Number.isFinite(p.ost) && p.ost > 0 && p.ost < 100) return p.ost;
    return 0.0118;   // last-resort default, matches topup.js
  }

  function currency() {
    return String(window.__ostCurrency || 'USD').toUpperCase();
  }

  // Localized fiat string for a USD value — delegate to app.js's formatter,
  // which owns the live rate table + per-currency decimals + symbols.
  function fiatFromUsd(usd) {
    try {
      if (typeof window.OST_FORMAT_PRIMARY_FIAT === 'function') return window.OST_FORMAT_PRIMARY_FIAT(usd);
    } catch (_) {}
    // Fallback: plain USD.
    var n = Number(usd) || 0;
    return '$' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function toFiatUsd(ost) { return (Number(ost) || 0) * usdPerOst(); }
  function format(ost) { return fiatFromUsd(toFiatUsd(ost)); }
  function hint(ost) { return '≈ ' + format(ost); }
  function symbol() {
    // Pull the symbol out of a formatted zero.
    var s = fiatFromUsd(0);
    var m = s.match(/^[^\d\-\s]+/);
    return m ? m[0] : '$';
  }

  // ---- auto-decoration ----------------------------------------------------

  var HINT_CLASS = 'ost-fx-hint';
  // Regions where "<n> OST" text should get a fiat hint appended. Scoped so the
  // scanner never touches unrelated copy elsewhere on the page.
  var SCAN_ROOTS = [
    '.prediction-market-board', '#predictionMarketBoard', '.wallet-command-shell',
    '#wallet', '.ost-modal', '.prediction-trade', '#ostGames', '.ost-games',
    '.stock-market', '#stockMarket', '.ost-bets-panel', '.ost-tt', '.ost-parlay'
  ];
  var OST_TEXT_RE = /(^|[\s(>])(\d[\d,]*(?:\.\d+)?)\s*OST\b/;

  function decorateAttrEls(root) {
    var els = (root || document).querySelectorAll('[data-ost-fx]');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      var amt = Number(el.getAttribute('data-ost-fx'));
      if (!Number.isFinite(amt)) continue;
      el.textContent = hint(amt);
    }
  }

  // Append a live fiat hint to leaf elements that literally show "<n> OST".
  function decorateTextEls(root) {
    for (var r = 0; r < SCAN_ROOTS.length; r++) {
      var scopes = (root && root.querySelectorAll) ? [root] : [];
      if (!scopes.length) scopes = Array.prototype.slice.call(document.querySelectorAll(SCAN_ROOTS[r]));
      else if (!(root.matches && root.matches(SCAN_ROOTS[r]))) {
        scopes = Array.prototype.slice.call(root.querySelectorAll(SCAN_ROOTS[r]));
      }
      for (var s = 0; s < scopes.length; s++) walkScope(scopes[s]);
    }
  }

  function walkScope(scope) {
    if (!scope) return;
    // Only leaf-ish elements (no element children) that match the strict
    // "<n> OST" pattern. The hint is rendered via a ::after custom property, so
    // we never touch the element's textContent.
    var nodes = scope.querySelectorAll('*');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (el.children.length) continue;                    // leaf only
      if (el.getAttribute('data-ost-fx') != null) continue;
      var tag = el.tagName;
      if (tag === 'OPTION' || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') continue;
      var txt = el.textContent || '';
      var m = OST_TEXT_RE.exec(txt);
      if (!m) {
        if (el.classList.contains('ost-fx-host')) { el.classList.remove('ost-fx-host'); el.style.removeProperty('--ost-fiat'); }
        continue;
      }
      var amt = Number(m[2].replace(/,/g, ''));
      if (!Number.isFinite(amt) || amt <= 0) continue;
      // JSON.stringify makes a valid CSS quoted string for `content`.
      el.style.setProperty('--ost-fiat', JSON.stringify(hint(amt)));
      if (!el.classList.contains('ost-fx-host')) el.classList.add('ost-fx-host');
    }
  }

  var scheduled = false;
  function refresh() {
    if (scheduled) return;
    scheduled = true;
    (window.requestAnimationFrame || function (f) { setTimeout(f, 16); })(function () {
      scheduled = false;
      // Don't show a fiat hint when the user's currency IS the OST unit — pointless.
      try { decorateAttrEls(document); } catch (_) {}
      try { decorateTextEls(null); } catch (_) {}
    });
  }

  // Re-decorate on currency change, price ticks, and DOM growth.
  ['ost:currencychange', 'ost:fx-changed', 'ost:price-updated', 'ost:wallet-changed',
   'ost:prediction:order-changed', 'ost:money:change', 'ost-faucet-hub-award']
    .forEach(function (ev) { window.addEventListener(ev, refresh, { passive: true }); });

  var mo = null;
  function startObserver() {
    if (mo || !window.MutationObserver) return;
    mo = new MutationObserver(function () { refresh(); });
    mo.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  // Periodic light refresh so a moving OST price keeps the hints current even
  // without an explicit event.
  setInterval(refresh, 8000);

  window.OST_FIAT = {
    usdPerOst: usdPerOst,
    toFiatUsd: toFiatUsd,     // OST amount -> its value in USD (number)
    format: format,           // OST amount -> localized currency string
    hint: hint,               // OST amount -> "≈ <currency>"
    currency: currency,
    symbol: symbol,
    refresh: refresh
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { startObserver(); refresh(); });
  } else { startObserver(); refresh(); }
})();

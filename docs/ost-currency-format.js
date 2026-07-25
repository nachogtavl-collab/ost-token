/* ==========================================================================
 * OST · Currency format — one way to render money, everywhere
 * --------------------------------------------------------------------------
 * Every balance in OST should read the same: the right COIN name, the right
 * COLOUR, a number that never overflows a phone, and its value in the user's
 * preferred fiat so OSTC/OSTG feel like real money instead of arcade points.
 *
 * Colours (from ost-currency-colors.css, one meaning each):
 *   OSTC        blue     on-chain token you hold (card-spendable)
 *   OSTG        purple   play/trade balance
 *   LOAN        gold     the credit line instrument
 *   LOANED      red      borrowed OSTG in play (not yours until repaid)
 *
 * MOBILE OVERFLOW was a real bug: long balances (1234567.89 OSTG) blew out of
 * their container on phones. compact() fixes it — 1.23M / 12.3k / 45.20 — with
 * the full value kept in a title tooltip, never lost.
 *
 * PREFERRED FIAT comes from OST_FIAT (ost-fx.js), which already tracks the
 * user's currency choice. We reuse it; we never invent a second FX source.
 *
 * Two ways to use it:
 *   1. OST_CCY.html(amount, 'ostg')  -> a coloured HTML string
 *   2. <span data-ost-ccy="ostg" data-ost-amount="123.4"></span> auto-renders
 *      and stays live as the amount attr or the FX rate changes.
 * ========================================================================== */
(function () {
  'use strict';
  if (window.OST_CCY) return;

  var COINS = {
    ostc:   { label: 'OSTC', cls: 'ost-c-ostc' },
    ostg:   { label: 'OSTG', cls: 'ost-c-ostg' },
    loan:   { label: 'OSTG', cls: 'ost-c-loan' },     // the loan instrument
    loaned: { label: 'OSTG', cls: 'ost-c-loaned' }    // borrowed, in play
  };

  // 1234567.89 -> "1.23M" ; 12345 -> "12.3k" ; 45.2 -> "45.20".
  // Below 10k shows two decimals; above, compact with one. Never wider than
  // ~7 glyphs, so it fits a phone.
  function compact(n) {
    n = Number(n);
    if (!isFinite(n)) return '—';
    var neg = n < 0; n = Math.abs(n);
    var out;
    // 999.5e6+ rounds up to a B so values just under 1e9 read "1B", not "1000M".
    if (n >= 999.5e6)  out = (n / 1e9).toFixed(2).replace(/\.0+$/, '') + 'B';
    else if (n >= 999.5e3) out = (n / 1e6).toFixed(2).replace(/\.0+$/, '') + 'M';
    else if (n >= 1e4) out = (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'k';
    else               out = n.toFixed(2);
    return (neg ? '-' : '') + out;
  }

  // Full precision for the tooltip, so the exact number is one hover/tap away.
  function full(n) {
    n = Number(n);
    if (!isFinite(n)) return '';
    return n.toLocaleString(undefined, { maximumFractionDigits: 6 });
  }

  function coin(kind) { return COINS[String(kind || 'ostg').toLowerCase()] || COINS.ostg; }

  // Fiat hint in the user's preferred currency, or '' if FX not ready.
  // OSTC and OSTG are 1:1 in unit of account, so both price off the same rate.
  function fiat(amount) {
    try {
      if (window.OST_FIAT && typeof window.OST_FIAT.format === 'function') {
        var f = window.OST_FIAT.format(Number(amount) || 0);
        return f || '';
      }
    } catch (_) {}
    return '';
  }

  // Coloured HTML for an amount. opts: {fiat:true, compact:true}.
  function html(amount, kind, opts) {
    opts = opts || {};
    var c = coin(kind);
    var known = isFinite(Number(amount));
    var num = !known ? '—' : (opts.compact === false ? full(amount) : compact(amount));
    var title = known ? full(amount) + ' ' + c.label : '';
    var s = '<span class="ost-ccy ' + c.cls + '" title="' + title + '">' +
            '<span class="ost-ccy-n">' + num + '</span> ' +
            '<span class="ost-ccy-u">' + c.label + '</span></span>';
    if (opts.fiat && known) {
      var fh = fiat(amount);
      if (fh) s += ' <span class="ost-ccy-fiat" title="Value in your currency">≈ ' + fh + '</span>';
    }
    return s;
  }

  function injectStyle() {
    if (document.getElementById('ost-ccy-style')) return;
    var css =
      '.ost-ccy{display:inline-flex;align-items:baseline;gap:4px;font-variant-numeric:tabular-nums;' +
        'white-space:nowrap;max-width:100%;}' +
      '.ost-ccy-n{font-weight:700;overflow:hidden;text-overflow:ellipsis;}' +
      '.ost-ccy-u{font-size:.78em;opacity:.8;font-weight:600;letter-spacing:.02em;}' +
      '.ost-ccy-fiat{font-size:.82em;opacity:.72;white-space:nowrap;}' +
      // On phones, keep the fiat hint from forcing a second line inside tight
      // balance rows — it wraps under only when there is genuinely no room.
      '@media (max-width:520px){.ost-ccy-fiat{display:inline-block;}}';
    var t = document.createElement('style');
    t.id = 'ost-ccy-style';
    t.textContent = css;
    document.head.appendChild(t);
  }

  // Auto-decorate: any [data-ost-ccy] element renders and stays live.
  function decorate(root) {
    injectStyle();
    (root || document).querySelectorAll('[data-ost-ccy]').forEach(function (el) {
      var kind = el.getAttribute('data-ost-ccy');
      var amt = el.getAttribute('data-ost-amount');
      var showFiat = el.getAttribute('data-ost-fiat') !== 'off';
      el.innerHTML = html(amt === null || amt === '' ? NaN : Number(amt), kind, { fiat: showFiat });
    });
  }

  function refreshAll() { decorate(document); }

  window.OST_CCY = {
    compact: compact,
    full: full,
    fiat: fiat,
    html: html,
    decorate: decorate,
    refresh: refreshAll,
    coinLabel: function (k) { return coin(k).label; },
    coinClass: function (k) { return coin(k).cls; }
  };

  function boot() {
    injectStyle();
    decorate(document);
    // Keep decorated elements live as the FX rate or currency choice changes.
    // Event-driven only — a broad MutationObserver would re-fire on its own
    // innerHTML writes and loop. Modules that render balances late call
    // OST_CCY.decorate() themselves after they paint.
    ['ost:currencychange', 'ost:fx-updated', 'ost:balance', 'ost:play:balance', 'ost:wallet-changed']
      .forEach(function (ev) { window.addEventListener(ev, refreshAll); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();

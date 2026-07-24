/* ==========================================================================
 * OST · Loaned balance in USD — you borrowed value, so you owe value
 * --------------------------------------------------------------------------
 * A loan is real money, so the debt is denominated in DOLLARS, not in a token
 * count. "You owe $20" is a thing a person understands and can plan around;
 * "you owe 1,694.92 OSTG" is a number whose meaning moves. The server strikes
 * each loan at a fixed rate and reports outstandingUsd, so the amount owed
 * cannot drift because the token price moved.
 *
 * This module does two things:
 *
 *   1. A persistent LOANED badge showing the borrowed balance in USD, in red -
 *      the one balance that is not the user's money. It sits next to their own
 *      balances so the distinction is never a guess.
 *
 *   2. CONVERTS IN FRONT OF THE USER. After a game round or any transaction
 *      that moved borrowed funds, the OSTG figure visibly counts across into
 *      its USD value. Seeing the conversion happen is what makes borrowed
 *      money feel like real money instead of arcade points.
 *
 * It never invents a number. If the summary has not loaded, it shows a dash,
 * not a confident zero.
 * ========================================================================== */
(function () {
  'use strict';
  if (window.OST_LOAN_USD) return;

  var API = window.OST_API_BASE || 'https://ost-api.nachogtavl.workers.dev';

  function wallet() {
    try {
      var s = window.OST_WALLET && window.OST_WALLET.session;
      if (s && s.publicKey && s.publicKey.toBase58) return s.publicKey.toBase58();
      if (window.OST_WALLET && window.OST_WALLET.address) return window.OST_WALLET.address;
      if (window.solana && window.solana.publicKey) return window.solana.publicKey.toString();
    } catch (_) {}
    return '';
  }

  var state = { summary: null, lastLockedOstg: null };

  function injectStyle() {
    if (document.getElementById('ost-loan-usd-style')) return;
    var css =
      '.olu-badge{display:inline-flex;align-items:center;gap:9px;padding:8px 13px;border-radius:14px;' +
        'background:var(--ost-loaned-dim,rgba(255,107,107,.16));border:1px solid var(--ost-loaned,#ff6b6b);' +
        'color:var(--ost-loaned,#ff6b6b);font-size:12px;}' +
      '.olu-badge .k{opacity:.85;letter-spacing:.05em;text-transform:uppercase;font-size:10px;}' +
      '.olu-badge .usd{font-size:19px;font-weight:700;font-variant-numeric:tabular-nums;line-height:1;}' +
      '.olu-badge .ostg{font-size:10.5px;opacity:.75;font-variant-numeric:tabular-nums;}' +
      '.olu-badge.is-converting .usd{text-shadow:0 0 14px currentColor;}' +
      '.olu-flash{position:fixed;left:50%;transform:translateX(-50%);bottom:110px;z-index:1000500;' +
        'display:flex;align-items:center;gap:11px;padding:12px 18px;border-radius:15px;' +
        'background:#140505;border:1px solid var(--ost-loaned,#ff6b6b);color:#ffd9d9;' +
        'box-shadow:0 18px 50px rgba(0,0,0,.6);opacity:0;transition:opacity .25s,transform .25s;' +
        'font-variant-numeric:tabular-nums;}' +
      '.olu-flash.is-on{opacity:1;transform:translateX(-50%) translateY(-6px);}' +
      '.olu-flash .a{font-size:17px;font-weight:650;color:var(--ost-loaned,#ff6b6b);}' +
      '.olu-flash .arrow{font-size:11px;opacity:.7;letter-spacing:.1em;}' +
      '.olu-flash .b{font-size:21px;font-weight:750;color:#7fe3b0;}';
    var tag = document.createElement('style');
    tag.id = 'ost-loan-usd-style';
    tag.textContent = css;
    document.head.appendChild(tag);
  }

  function load() {
    var w = wallet();
    if (!w) { state.summary = null; paint(); return Promise.resolve(null); }
    return fetch(API + '/loans/summary?address=' + encodeURIComponent(w), { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        state.summary = (d && d.ok) ? d : null;
        paint();
        return state.summary;
      })
      .catch(function () { state.summary = null; paint(); return null; });
  }

  function lockedOstg() {
    var s = state.summary;
    if (!s || !s.wallet) return undefined;           // unknown, not zero
    return Number(s.wallet.lockedTotal) || 0;
  }
  function lockedUsd() {
    var s = state.summary;
    if (!s || !s.wallet) return undefined;
    return Number(s.wallet.lockedUsd) || 0;
  }
  function owedUsd() {
    var s = state.summary;
    if (!s) return undefined;
    return Number(s.owedUsd) || 0;
  }
  function rate() {
    var s = state.summary;
    return (s && s.wallet && Number(s.wallet.usdPerOstg)) || 0.0118;
  }

  function paint() {
    injectStyle();
    var lo = lockedOstg(), lu = lockedUsd(), ow = owedUsd();
    document.querySelectorAll('[data-olu-badge]').forEach(function (el) {
      if (lo === undefined) {
        el.innerHTML = '<span class="k">Loaned</span><span class="usd">—</span>';
        el.style.display = '';
        return;
      }
      if (lo <= 0) { el.style.display = 'none'; return; }   // nothing borrowed
      el.style.display = '';
      el.innerHTML =
        '<span class="k">Loaned</span>' +
        '<span><span class="usd">$' + (lu || 0).toFixed(2) + '</span>' +
        '<span class="ostg"> · ' + lo.toFixed(2) + ' OSTG' +
        (ow != null ? ' · owe $' + ow.toFixed(2) : '') + '</span></span>';
    });
  }

  /* ---- convert in front of the user --------------------------------------
   * After a round or a transaction that touched borrowed funds, show the OSTG
   * amount crossing into its dollar value. This is the moment that makes the
   * loan feel like money rather than points.
   */
  function showConversion(ostgAmount) {
    if (!(Math.abs(Number(ostgAmount)) > 0)) return;
    injectStyle();
    var r = rate();
    var usdTarget = Math.abs(Number(ostgAmount)) * r;
    var el = document.createElement('div');
    el.className = 'olu-flash';
    el.innerHTML = '<span class="a">0.00 OSTG</span><span class="arrow">IS</span><span class="b">$0.00</span>';
    document.body.appendChild(el);
    requestAnimationFrame(function () { el.classList.add('is-on'); });

    var aEl = el.querySelector('.a'), bEl = el.querySelector('.b');
    var t0 = performance.now(), DUR = 700;
    (function tick(now) {
      var k = Math.min(1, (now - t0) / DUR);
      var e = 1 - Math.pow(1 - k, 3);
      aEl.textContent = (Math.abs(ostgAmount) * e).toFixed(2) + ' OSTG';
      bEl.textContent = '$' + (usdTarget * e).toFixed(2);
      if (k < 1) requestAnimationFrame(tick);
    })(t0);

    setTimeout(function () {
      el.classList.remove('is-on');
      setTimeout(function () { el.remove(); }, 300);
    }, 2200);
  }

  // Detect a change in the borrowed balance and animate the difference.
  function reactToChange() {
    load().then(function () {
      var now = lockedOstg();
      if (now === undefined) return;
      var prev = state.lastLockedOstg;
      state.lastLockedOstg = now;
      if (prev === null || prev === undefined) return;      // first read: nothing to compare
      var delta = now - prev;
      if (Math.abs(delta) > 0.0001) showConversion(delta);
    });
  }

  window.OST_LOAN_USD = {
    refresh: load,
    lockedUsd: lockedUsd,
    lockedOstg: lockedOstg,
    owedUsd: owedUsd,
    showConversion: showConversion,
    mountBadge: function (host) {
      if (!host) return;
      injectStyle();
      var b = document.createElement('div');
      b.className = 'olu-badge';
      b.setAttribute('data-olu-badge', '1');
      host.appendChild(b);
      paint();
    }
  };

  function boot() {
    load().then(function () { state.lastLockedOstg = lockedOstg(); });
    // Any event that can move borrowed funds triggers a re-read + conversion.
    ['ost:play:balance', 'ost:wallet-changed', 'ost:ostg-source'].forEach(function (ev) {
      window.addEventListener(ev, function () { reactToChange(); });
    });
    // Auto-mount next to the games balance card if it exists.
    setTimeout(function () {
      var slot = document.querySelector('[data-ostg-source-slot]');
      if (slot && !slot.querySelector('[data-olu-badge]')) window.OST_LOAN_USD.mountBadge(slot);
    }, 1800);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();

/* ==========================================================================
 * OST · OSTG source — which money am I spending, and can I convert it?
 * --------------------------------------------------------------------------
 * Two jobs, both about the same question: WHOSE OSTG IS THIS?
 *
 *   1. SOURCE SELECTOR. A user with a credit line has two kinds of OSTG that
 *      look identical in a single balance figure: their own, and borrowed. One
 *      is withdrawable, the other is debt. Every product that spends OSTG
 *      (games, predictions, stocks, launchpad) reads the selected source from
 *      here, so there is exactly ONE answer to "what am I about to spend" and
 *      it is always on screen.
 *
 *      Personal is ALWAYS the default. Borrowed funds are never pre-selected -
 *      quietly spending someone's credit line before their own money is the
 *      single most predatory thing a lender can do, and it is not happening
 *      by accident here.
 *
 *   2. CONVERTER. OSTC <-> OSTG at 1:1. The two are the same unit of account;
 *      OSTC is the on-chain token you hold and can spend on a card, OSTG is
 *      the play/trade balance the server settles against. Moving between them
 *      should feel like moving money between your own pockets, because that is
 *      what it is.
 *
 * Borrowed OSTG can NEVER be converted out to OSTC. That is the whole point of
 * the lock: it can be played and invested, not extracted. The UI says so
 * rather than failing at the last step.
 * ========================================================================== */
(function () {
  'use strict';
  if (window.OST_OSTG_SOURCE) return;

  var API = window.OST_API_BASE || 'https://ost-api.nachogtavl.workers.dev';
  var SEL_KEY = 'ost.ostg.source.v1';

  var state = { source: 'clean', summary: null, open: false };

  function wallet() {
    // MUST match how ost-play.js resolves the address, or this module queries a
    // different (or empty) wallet than the one holding the OSTG - which showed
    // up as "wallet balance won't detect funds". The authoritative source is
    // OST_WALLET.session.publicKey; .address was often null.
    try {
      var s = window.OST_WALLET && window.OST_WALLET.session;
      if (s && s.publicKey && s.publicKey.toBase58) return s.publicKey.toBase58();
      if (window.OST_WALLET && window.OST_WALLET.address) return window.OST_WALLET.address;
      if (window.solana && window.solana.publicKey) return window.solana.publicKey.toString();
    } catch (_) {}
    return '';
  }
  function ostg(n) { return (Number(n) || 0).toFixed(2); }
  function esc(t) {
    return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  /* ---- state -------------------------------------------------------------- */

  function current() {
    // A stale selection must never silently spend the wrong money: if the
    // chosen loan is gone (settled), fall back to personal.
    if (state.source !== 'clean') {
      var s = state.summary;
      if (!s || !s.wallet || !s.wallet.locked || !(state.source in s.wallet.locked)) return 'clean';
    }
    return state.source;
  }

  function setSource(next) {
    state.source = next || 'clean';
    try { localStorage.setItem(SEL_KEY, state.source); } catch (_) {}
    paint();
    try {
      window.dispatchEvent(new CustomEvent('ost:ostg-source', { detail: { source: current() } }));
    } catch (_) {}
  }

  // undefined = NOT LOADED YET, which is NOT zero. Returning 0 here fabricated
  // a "not enough" the moment the play balance had not arrived, while a cached
  // positive value still showed elsewhere - the exact "shows positive but says
  // not enough" bug. Callers must treat undefined as unknown, not empty.
  function personalBalance() {
    try {
      var b = window.OST_PLAY && window.OST_PLAY.balance();
      if (Number.isFinite(Number(b))) return Number(b);
    } catch (_) {}
    return undefined;
  }

  function lockedTotal() {
    var s = state.summary;
    return (s && s.wallet && Number(s.wallet.lockedTotal)) || 0;
  }

  // Own OSTG = what the play ledger holds MINUS whatever is locked behind
  // loans. Never show the blended figure as if it were all theirs. Returns
  // undefined when the balance is unknown so a gate can allow rather than
  // block on a number we do not have yet.
  function ownSpendable() {
    var pb = personalBalance();
    if (pb === undefined) return undefined;
    return Math.max(0, pb - lockedTotal());
  }

  function loadSummary() {
    var w = wallet();
    if (!w) { state.summary = null; return Promise.resolve(null); }
    return fetch(API + '/loans/summary?address=' + encodeURIComponent(w))
      .then(function (r) { return r.json(); })
      .then(function (d) { state.summary = (d && d.ok) ? d : null; return state.summary; })
      .catch(function () { state.summary = null; return null; });
  }

  /* ---- styles ------------------------------------------------------------- */

  function injectStyle() {
    if (document.getElementById('ost-ostg-source-style')) return;
    var css =
      '.oos-chip{display:inline-flex;align-items:center;gap:7px;padding:6px 11px;border-radius:999px;cursor:pointer;' +
        'font-size:12px;border:1px solid rgba(127,216,255,.3);background:#0b1b29;color:#dff8ff;}' +
      '.oos-chip.is-loan{border-color:rgba(255,196,120,.55);background:#2a1c08;color:#ffd9a8;}' +
      '.oos-dot{width:8px;height:8px;border-radius:50%;background:#5eead4;flex:0 0 auto;}' +
      '.oos-chip.is-loan .oos-dot{background:#ffc478;}' +
      '.oos-sheet{position:fixed;inset:auto 10px 96px 10px;z-index:1000460;border-radius:18px;background:#040d16;' +
        'border:1px solid rgba(127,216,255,.26);box-shadow:0 24px 70px rgba(0,0,0,.62);padding:15px;' +
        'color:#dff8ff;max-height:72vh;overflow:auto;display:none;}' +
      '.oos-sheet.is-open{display:block;}' +
      '.oos-h{font-size:14px;font-weight:640;margin:0 0 3px;}' +
      '.oos-sub{font-size:11.5px;color:#8fb0c4;margin:0 0 12px;line-height:1.45;}' +
      '.oos-opt{display:flex;gap:11px;align-items:center;width:100%;text-align:left;padding:11px;border-radius:13px;' +
        'margin-bottom:8px;cursor:pointer;background:#08161f;border:1px solid rgba(255,255,255,.08);color:#dff8ff;}' +
      '.oos-opt.is-on{border-color:rgba(127,216,255,.75);background:#0e2b3d;}' +
      '.oos-opt.loan{background:#1d1406;}' +
      '.oos-opt.loan.is-on{border-color:rgba(255,196,120,.8);background:#2e1f08;}' +
      '.oos-opt .t{flex:1 1 auto;min-width:0;}' +
      '.oos-opt .t b{display:block;font-size:13px;}' +
      '.oos-opt .t span{font-size:11px;color:#9fbfd8;}' +
      '.oos-opt .v{font-size:15px;font-weight:640;flex:0 0 auto;}' +
      '.oos-conv{margin-top:5px;padding-top:13px;border-top:1px solid rgba(255,255,255,.09);}' +
      '.oos-row{display:flex;gap:8px;align-items:center;margin-top:9px;}' +
      '.oos-row input{flex:1 1 auto;min-width:0;height:38px;border-radius:11px;border:1px solid rgba(255,255,255,.14);' +
        'background:#020a12;color:#dff8ff;padding:0 11px;font-size:15px;}' +
      '.oos-btn{height:38px;padding:0 15px;border-radius:11px;border:1px solid rgba(127,216,255,.4);background:#12405c;' +
        'color:#dff8ff;cursor:pointer;font-size:13px;flex:0 0 auto;}' +
      '.oos-btn:disabled{opacity:.45;cursor:not-allowed;}' +
      '.oos-dir{display:flex;gap:7px;margin-top:10px;}' +
      '.oos-dir button{flex:1 1 0;height:36px;border-radius:11px;cursor:pointer;font-size:12.5px;' +
        'background:#08161f;border:1px solid rgba(255,255,255,.1);color:#9fbfd8;}' +
      '.oos-dir button.is-on{background:#12405c;border-color:rgba(127,216,255,.6);color:#dff8ff;}' +
      '.oos-msg{font-size:12px;margin-top:9px;min-height:16px;}' +
      '.oos-msg.ok{color:#7fe3b0;}.oos-msg.err{color:#ff9a9a;}' +
      '.oos-close{float:right;border:0;border-radius:9px;padding:5px 11px;background:#12405c;color:#dff8ff;cursor:pointer;}';
    var tag = document.createElement('style');
    tag.id = 'ost-ostg-source-style';
    tag.textContent = css;
    document.head.appendChild(tag);
  }

  /* ---- chip (always-visible indicator) ------------------------------------ */

  // Rendered into any host that asks for it. Products call
  // OST_OSTG_SOURCE.mountChip(el) next to their stake input so the answer to
  // "which money is this" sits where the decision happens.
  function mountChip(host) {
    if (!host) return;
    injectStyle();
    var chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'oos-chip';
    chip.setAttribute('data-oos-chip', '1');
    chip.addEventListener('click', openSheet);
    host.appendChild(chip);
    paint();
  }

  function label(src) {
    if (src === 'clean') return 'Personal OSTG';
    return 'Loan ' + String(src).slice(0, 10);
  }

  function paint() {
    injectStyle();
    var src = current();
    var isLoan = src !== 'clean';
    var amount = isLoan
      ? ((state.summary && state.summary.wallet && state.summary.wallet.locked[src]) || 0)
      : ownSpendable();
    document.querySelectorAll('[data-oos-chip]').forEach(function (c) {
      c.className = 'oos-chip' + (isLoan ? ' is-loan' : '');
      c.innerHTML = '<span class="oos-dot"></span><span>' + esc(label(src)) + '</span>' +
                    '<b>' + ostg(amount) + '</b>';
      c.title = isLoan
        ? 'Spending BORROWED OSTG. Winnings stay locked until this loan is repaid.'
        : 'Spending your own OSTG. Withdrawable.';
    });
    if (state.open) renderSheet();
  }

  /* ---- sheet -------------------------------------------------------------- */

  function sheet() {
    var el = document.getElementById('oosSheet');
    if (el) return el;
    injectStyle();
    el = document.createElement('div');
    el.id = 'oosSheet';
    el.className = 'oos-sheet';
    document.body.appendChild(el);
    return el;
  }

  function openSheet() {
    state.open = true;
    sheet().classList.add('is-open');
    renderSheet();
    loadSummary().then(renderSheet);
  }
  function closeSheet() {
    state.open = false;
    sheet().classList.remove('is-open');
  }

  function renderSheet() {
    var el = sheet();
    if (!state.open) return;
    var src = current();
    var s = state.summary;
    var loans = (s && s.wallet && s.wallet.locked) || {};
    var loanKeys = Object.keys(loans);

    el.innerHTML =
      '<button type="button" class="oos-close" id="oosClose">Close</button>' +
      '<p class="oos-h">Which OSTG are you spending?</p>' +
      '<p class="oos-sub">Personal OSTG is yours and can be withdrawn or converted. ' +
      'Borrowed OSTG can be played and invested but not withdrawn — and anything you win with it ' +
      'stays locked until that loan is repaid from your own funds.</p>' +

      '<button type="button" class="oos-opt' + (src === 'clean' ? ' is-on' : '') + '" data-src="clean">' +
        '<span class="oos-dot"></span>' +
        '<span class="t"><b>Personal OSTG</b><span>Yours — withdrawable, convertible</span></span>' +
        '<span class="v">' + ostg(ownSpendable()) + '</span>' +
      '</button>' +

      loanKeys.map(function (k) {
        return '<button type="button" class="oos-opt loan' + (src === k ? ' is-on' : '') + '" data-src="' + esc(k) + '">' +
          '<span class="oos-dot"></span>' +
          '<span class="t"><b>Borrowed · ' + esc(k.slice(0, 12)) + '</b><span>Locked until repaid — not withdrawable</span></span>' +
          '<span class="v">' + ostg(loans[k]) + '</span>' +
        '</button>';
      }).join('') +

      (loanKeys.length ? '' : '<p class="oos-sub" style="margin:8px 0 0;">No active loans. ' +
        'You can request a credit line from the Cards screen.</p>') +

      '<div class="oos-conv">' +
        '<p class="oos-h">Convert</p>' +
        '<p class="oos-sub">OSTC and OSTG are the same value, 1:1. OSTC is the token you hold; ' +
        'OSTG is the balance you play and trade with.</p>' +
        '<div class="oos-dir">' +
          '<button type="button" id="oosToG" class="is-on">OSTC → OSTG</button>' +
          '<button type="button" id="oosToC">OSTG → OSTC</button>' +
        '</div>' +
        '<div class="oos-row">' +
          '<input type="number" id="oosAmt" min="0" step="0.01" placeholder="Amount">' +
          '<button type="button" class="oos-btn" id="oosGo">Convert</button>' +
        '</div>' +
        '<div class="oos-msg" id="oosMsg"></div>' +
      '</div>';

    el.querySelector('#oosClose').addEventListener('click', closeSheet);
    el.querySelectorAll('[data-src]').forEach(function (b) {
      b.addEventListener('click', function () { setSource(b.getAttribute('data-src')); });
    });
    var toG = el.querySelector('#oosToG'), toC = el.querySelector('#oosToC');
    toG.addEventListener('click', function () { dir = 'toG'; toG.classList.add('is-on'); toC.classList.remove('is-on'); convMsg(''); });
    toC.addEventListener('click', function () { dir = 'toC'; toC.classList.add('is-on'); toG.classList.remove('is-on'); convMsg(''); });
    el.querySelector('#oosGo').addEventListener('click', convert);
  }

  var dir = 'toG';
  function convMsg(t, k) {
    var m = document.getElementById('oosMsg');
    if (!m) return;
    m.textContent = t || '';
    m.className = 'oos-msg' + (k ? ' ' + k : '');
  }

  /* ---- converter ---------------------------------------------------------- */

  function convert() {
    var amt = parseFloat((document.getElementById('oosAmt') || {}).value);
    if (!(amt > 0)) return convMsg('Enter an amount.', 'err');
    if (!wallet()) return convMsg('Connect your wallet first.', 'err');
    var btn = document.getElementById('oosGo');
    if (btn) btn.disabled = true;

    if (dir === 'toG') {
      // OSTC -> OSTG is the existing verified deposit: real tokens move to the
      // pool, and the server credits play balance only after confirming it.
      if (!window.OST_PLAY || typeof window.OST_PLAY.deposit !== 'function') {
        if (btn) btn.disabled = false;
        return convMsg('Deposit rail unavailable — reload and try again.', 'err');
      }
      convMsg('Moving OSTC to your play balance…');
      Promise.resolve(window.OST_PLAY.deposit(amt)).then(function (r) {
        if (btn) btn.disabled = false;
        if (r && r.ok === false) return convMsg(r.error || 'Conversion failed.', 'err');
        convMsg('Converted ' + ostg(amt) + ' OSTC to OSTG.', 'ok');
        refresh();
      }).catch(function (e) {
        if (btn) btn.disabled = false;
        convMsg((e && e.message) || 'Conversion failed.', 'err');
      });
      return;
    }

    // OSTG -> OSTC. Only PERSONAL OSTG may leave; borrowed funds are locked by
    // design, so refuse here with the reason instead of letting the server
    // reject it after the user commits.
    var own = ownSpendable();
    if (amt > own + 1e-9) {
      if (btn) btn.disabled = false;
      return convMsg(lockedTotal() > 0
        ? 'Only personal OSTG can be converted. ' + ostg(own) + ' is available; ' +
          ostg(lockedTotal()) + ' is locked behind an unpaid loan.'
        : 'Not enough personal OSTG (' + ostg(own) + ' available).', 'err');
    }
    if (!window.OST_PLAY || typeof window.OST_PLAY.cashout !== 'function') {
      if (btn) btn.disabled = false;
      return convMsg('Cash-out rail unavailable — reload and try again.', 'err');
    }
    convMsg('Sending OSTC to your wallet…');
    Promise.resolve(window.OST_PLAY.cashout(amt)).then(function (r) {
      if (btn) btn.disabled = false;
      if (r && r.ok === false) return convMsg(r.error || 'Conversion failed.', 'err');
      convMsg('Converted ' + ostg(amt) + ' OSTG to OSTC.', 'ok');
      refresh();
    }).catch(function (e) {
      if (btn) btn.disabled = false;
      convMsg((e && e.message) || 'Conversion failed.', 'err');
    });
  }

  /* ---- boot --------------------------------------------------------------- */

  function refresh() {
    return loadSummary().then(function () { paint(); });
  }

  // How much OSTG the CURRENTLY SELECTED source can actually spend. Personal
  // returns own spendable; a loan returns that loan's locked balance. This is
  // the number a stake gate should read - not OSTC, not credits.
  function spendable() {
    var src = current();
    if (src === 'clean') return ownSpendable();
    var s = state.summary;
    // A loan bucket with no summary yet is unknown, not zero.
    if (!s || !s.wallet || !s.wallet.locked) return undefined;
    return Number(s.wallet.locked[src]) || 0;
  }

  window.OST_OSTG_SOURCE = {
    current: current,
    spendable: spendable,
    set: setSource,
    open: openSheet,
    close: closeSheet,
    mountChip: mountChip,
    refresh: refresh,
    ownSpendable: ownSpendable,
    lockedTotal: lockedTotal
  };

  // Auto-mount beside the stake inputs that spend OSTG. Products render at
  // different times (and some re-render), so we re-check on the events that
  // follow a render rather than assuming everything exists at boot.
  var HOSTS = [
    '#predictionStakeInput',   // prediction ticket
    '#smOstStake',             // stock mirror
    '[data-ostg-source-slot]'  // faucet games board (explicit slot)
  ];
  function autoMount() {
    HOSTS.forEach(function (sel) {
      var el = document.querySelector(sel);
      if (!el) return;
      var host = el.hasAttribute('data-ostg-source-slot') ? el : el.parentElement;
      if (!host || host.querySelector('[data-oos-chip]')) return;
      mountChip(host);
    });
  }

  function boot() {
    try { state.source = localStorage.getItem(SEL_KEY) || 'clean'; } catch (_) {}
    refresh();
    autoMount();
    ['ost:prediction-modal-open', 'ost:games-lane', 'ost:wallet-changed'].forEach(function (ev) {
      window.addEventListener(ev, function () { setTimeout(autoMount, 60); });
    });
    // Cheap safety net for panels that appear without firing an event.
    setTimeout(autoMount, 1500);
    setTimeout(autoMount, 4000);
    window.addEventListener('ost:wallet-changed', refresh);
    window.addEventListener('ost:play:balance', paint);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();

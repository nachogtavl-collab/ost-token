/* ==========================================================================
 * OST · Swap (OST -> SOL cash-out) v2
 * --------------------------------------------------------------------------
 *   1. swapOstToSol(ostAmount) — the inverse atomic swap (pool pays the fee).
 *   2. One cosign per user action. NO automatic retries that build a new
 *      transaction and NO offline replay queue (SOL-6): money moves are never
 *      repeated without the user asking. An unknown outcome is reported as
 *      "Still confirming — check your balance before retrying" (contract C4).
 *   3. Solana's rent rule (RNT-1): a first cash-out into an empty wallet must
 *      deliver at least 0.00089 SOL, so the minimum is shown and enforced.
 *   4. UI hook: when #transferFrom is 'OST', this module owns the quote line
 *      and the #transferBtn action (cash out to SOL) — contract C7.
 *
 * MUST load AFTER wallet-extras.js + devnet-rescue.js.
 * ========================================================================== */
(function () {
  'use strict';

  if (window.__OST_SWAP_RESILIENT__) return;
  window.__OST_SWAP_RESILIENT__ = true;

  // The old auto-replay queue is retired: drop anything it left behind so it
  // can never be replayed (it is not read anywhere any more).
  try { localStorage.removeItem('ost.swap.queue.v1'); } catch (_) {}

  var RENT_MIN_LAMPORTS = 890880;
  var POOL_SWAP_FEE = 0.005;

  // ────────────────────────────────────────────────────────────────────────
  // Status banner (floating, dismissible) — plain text only
  // ────────────────────────────────────────────────────────────────────────
  var bannerEl = null;
  function ensureBanner() {
    if (bannerEl) return bannerEl;
    bannerEl = document.createElement('div');
    bannerEl.id = 'ostSwapStatusBanner';
    bannerEl.setAttribute('role', 'status');
    bannerEl.setAttribute('aria-live', 'polite');
    bannerEl.style.cssText = [
      'position:fixed','left:50%','transform:translateX(-50%)','bottom:calc(84px + env(safe-area-inset-bottom, 0px))',
      // Below modal sheets (Top-up 9999, Send 9998): a stale cash-out line must
      // never cover a later screen's result.
      'z-index:9990','padding:10px 14px','border-radius:12px',
      'background:rgba(15,23,42,0.94)','color:#e2e8f0','font:600 12px/1.4 system-ui,sans-serif',
      'box-shadow:0 6px 24px rgba(0,0,0,.4)','border:1px solid rgba(99,102,241,.4)',
      'max-width:min(92vw,520px)','display:none','cursor:pointer','backdrop-filter:blur(8px)'
    ].join(';');
    bannerEl.title = 'Tap to dismiss';
    bannerEl.addEventListener('click', function (e) { if (!(e.target && e.target.closest && e.target.closest('button'))) bannerEl.style.display = 'none'; });
    if (document.body) document.body.appendChild(bannerEl);
    else document.addEventListener('DOMContentLoaded', function () { document.body.appendChild(bannerEl); });
    return bannerEl;
  }
  var bannerTimer = null;
  function showBanner(text, tone, extraNode) {
    var el = ensureBanner();
    if (!el) return;
    el.textContent = String(text || '');
    if (extraNode) { el.appendChild(document.createElement('br')); el.appendChild(extraNode); }
    el.style.borderColor = tone === 'error' ? 'rgba(239,68,68,.6)'
                         : tone === 'ok'    ? 'rgba(34,197,94,.6)'
                         : 'rgba(99,102,241,.5)';
    el.style.display = 'block';
    clearTimeout(bannerTimer);
    // Every tone goes away by itself (it used to stay until tapped and float
    // over later screens). Longer messages stay a little longer.
    var ms = tone === 'ok' ? 6000 : (tone === 'error' ? 9000 : 15000);
    ms += Math.min(6000, Math.max(0, String(text || '').length - 80) * 40);
    bannerTimer = setTimeout(function () { el.style.display = 'none'; }, ms);
  }
  // A banner belongs to the Convert screen: leaving it removes the banner.
  window.addEventListener('hashchange', function () { if (bannerEl) { clearTimeout(bannerTimer); bannerEl.style.display = 'none'; } });
  function human(e, stage) {
    try { if (window.OST_MONEY_ERRORS) return window.OST_MONEY_ERRORS.humanize(e, { stage: stage || 'submit' }); } catch (_) {}
    return { state: 'failed', title: 'That didn’t go through', body: 'Try again in a moment.' };
  }

  // ────────────────────────────────────────────────────────────────────────
  // Quote — same prices as SOL -> OST (OST_CONVERT_PRICE, /topup/config)
  // and the same 0.5% pool fee the worker charges.
  // ────────────────────────────────────────────────────────────────────────
  function ostUsd() {
    try { var v = Number(window.OST_CONVERT_PRICE && window.OST_CONVERT_PRICE.ostUsd()); if (Number.isFinite(v) && v > 0) return v; } catch (_) {}
    return 0.0118;
  }
  function solUsd() {
    try { var v = Number(window.OST_CONVERT_PRICE && window.OST_CONVERT_PRICE.solUsd()); if (Number.isFinite(v) && v > 0) return v; } catch (_) {}
    return null;   // unknown: never a made-up constant on a money path
  }

  function quoteOstToSol(ostAmount) {
    var n = Number(ostAmount);
    if (!Number.isFinite(n) || n <= 0) { var e = new Error('Enter an OST amount'); e.code = 'invalid_amount'; throw e; }
    var o = ostUsd(), s = solUsd();
    if (!s) return { ost: n, fee: NaN, netOst: NaN, usd: n * o, sol: NaN, ostUsd: o, solUsd: null, lamports: 0, priceUnknown: true };
    var grossSol = (n * o) / s;
    var feeSol = grossSol * POOL_SWAP_FEE;
    var sol = grossSol - feeSol;
    return {
      ost: n, fee: n * POOL_SWAP_FEE, feeSol: feeSol, netOst: n * (1 - POOL_SWAP_FEE), usd: n * o, sol: sol,
      ostUsd: o, solUsd: s,
      lamports: Math.floor(sol * 1e9)
    };
  }

  // Smallest cash-out that leaves a wallet holding `ownerLamports` rent-exempt.
  function minOstFor(ownerLamports) {
    var have = Number(ownerLamports) || 0;
    if (have >= RENT_MIN_LAMPORTS) return 0;
    var s = solUsd(); if (!s) return null;
    var needSol = (RENT_MIN_LAMPORTS - have) / 1e9;
    var ost = needSol * s / ostUsd() / (1 - POOL_SWAP_FEE);
    // Round UP to 0.1 OST plus 0.1 margin for price drift; integer tenths so
    // the figure never prints as 9.299999999999999.
    return (Math.ceil(ost * 10) + 1) / 10;
  }

  function walletPk() {
    var w = window.OST_WALLET;
    return w && w.session && w.session.publicKey ? w.session.publicKey : null;
  }
  async function solLamports() {
    var pk = walletPk(); if (!pk) return null;
    try {
      var B = window.OST_BALANCE && OST_BALANCE.get ? OST_BALANCE.get() : {};
      if (B.sol != null && B.wallet === pk.toBase58()) return Math.round(Number(B.sol) * 1e9);
    } catch (_) {}
    try { return Number(await window.OST_WALLET.rpcCall(function (c) { return c.getBalance(pk); })); } catch (_) { return null; }
  }
  async function ostHeld() {
    try {
      if (window.OST_BALANCE) {
        var v = OST_BALANCE.onchainOstc();
        if (v == null) { await OST_BALANCE.refresh(true); v = OST_BALANCE.onchainOstc(); }
        if (v != null) return Number(v);
      }
    } catch (_) {}
    try { return Number(await window.OST_WALLET.getOstBalance(walletPk())); } catch (_) { return null; }
  }

  function err(code, message, extra) {
    var e = new Error(message); e.code = code;
    if (extra) Object.keys(extra).forEach(function (k) { e[k] = extra[k]; });
    return e;
  }

  var inflight = null;
  async function swapOstToSolImpl(ostAmount, opts) {
    opts = opts || {};
    var w = window.OST_WALLET;
    if (!walletPk()) throw err('no_wallet', 'Connect a wallet first');
    if (!window.OST_RESCUE || typeof window.OST_RESCUE.cosignSwap !== 'function') throw err('bad_response', 'Swap rail still loading — try again in a moment.');

    var quote = quoteOstToSol(ostAmount);
    var held = await ostHeld();
    if (held != null && held + 1e-9 < quote.ost) throw err('insufficient_balance', 'You have ' + held.toLocaleString(undefined, { maximumFractionDigits: 4 }) + ' OST.', { body: { have: held } });
    var lam = await solLamports();
    if (lam != null && !quote.priceUnknown && lam < RENT_MIN_LAMPORTS && lam + quote.lamports < RENT_MIN_LAMPORTS) {
      var min = minOstFor(lam);
      throw err('below_rent_minimum', 'Your first cash-out must be at least ' + min + ' OST.', { body: { minOst: min } });
    }

    var memo = JSON.stringify({ k: 'ost-to-sol', ost: quote.ost, t: Date.now() });
    // cosignSwap verifies the built transaction takes exactly the typed OST.
    var result = await window.OST_RESCUE.cosignSwap('ost-to-sol', { amount: quote.ost, memo: memo });
    var q = result.quote || {};
    return { ok: true, sig: result.sig, pending: !!result.pending, ost: Number(q.ostAmount) || quote.ost, sol: Number(q.solAmount) || quote.sol, rate: q.rate, fee: q.fee };
  }
  function swapOstToSol(amount, opts) {
    if (inflight) return Promise.reject(err('in_progress', 'A cash-out is already in progress.'));
    var p = swapOstToSolImpl(Number(amount), opts);
    inflight = p;
    var done = function () { if (inflight === p) inflight = null; };
    p.then(done, done);
    return p;
  }

  // ────────────────────────────────────────────────────────────────────────
  // OST_REAL_SWAP: add the inverse; leave the forward swap untouched (no
  // retry wrapper — a retry is always the user's own action).
  // ────────────────────────────────────────────────────────────────────────
  function patchRealSwap() {
    var rs = window.OST_REAL_SWAP;
    if (!rs || rs.__resilient) return;
    rs.swapOstToSol  = swapOstToSol;
    rs.quoteOstToSol = quoteOstToSol;
    rs.minOstFor     = minOstFor;
    rs.queueLength   = function () { return 0; };
    rs.flushQueue    = function () { return Promise.resolve(); };
    rs.__resilient   = true;
  }
  patchRealSwap();
  document.addEventListener('DOMContentLoaded', patchRealSwap);
  var attempts = 0;
  var iv = setInterval(function () {
    patchRealSwap();
    if ((window.OST_REAL_SWAP && window.OST_REAL_SWAP.__resilient) || ++attempts > 40) clearInterval(iv);
  }, 500);

  // ────────────────────────────────────────────────────────────────────────
  // UI: "OST → SOL (cash out)" in #transferFrom; own the quote + action.
  // ────────────────────────────────────────────────────────────────────────
  function fmt(n, dp) { return Number(n).toLocaleString(undefined, { maximumFractionDigits: dp == null ? 6 : dp }); }
  function wireConvertUi() {
    var sel = document.getElementById('transferFrom');
    var btn = document.getElementById('transferBtn');
    var lbl = document.getElementById('transferBtnLabel');
    var amt = document.getElementById('transferAmount');
    var quoteEl = document.getElementById('transferQuote');
    if (!sel || !btn) return false;
    if (btn.__ostCashout) return true;
    btn.__ostCashout = true;

    if (!sel.querySelector('option[value="OST"]')) {
      var opt = document.createElement('option');
      opt.value = 'OST';
      opt.textContent = '◉ OST → SOL (cash out)';
      sel.insertBefore(opt, sel.firstChild ? sel.firstChild.nextSibling : null);
    }

    var lastLam = null;
    function paintQuote() {
      if (sel.value !== 'OST' || !quoteEl) return;
      var v = parseFloat(String(amt && amt.value || '').replace(',', '.'));
      if (!Number.isFinite(v) || v <= 0) {
        var m0 = lastLam != null ? minOstFor(lastLam) : null;
        quoteEl.textContent = m0 ? 'First cash-out to this wallet: at least ' + m0 + ' OST (Solana rent minimum).' : '';
        return;
      }
      var q = quoteOstToSol(v);
      if (q.priceUnknown) { quoteEl.textContent = 'Loading the devnet SOL price…'; return; }
      var min = lastLam != null ? minOstFor(lastLam) : 0;
      var html = '<span style="color:#34d399;font-weight:700">You receive &asymp; ' + fmt(q.sol) + ' SOL</span>' +
        ' &nbsp;&bull;&nbsp; 1 OST = $' + q.ostUsd + ' (fixed, devnet) &nbsp;&bull;&nbsp; 1 SOL = $' + q.solUsd.toFixed(2) +
        ' &nbsp;&bull;&nbsp; pool fee 0.5%' +
        '<br><small style="color:#cbd5e1;font-size:11px">You will sign <b>' + fmt(v, 9) + ' OST</b>. The network fee is paid by OST.</small>';
      if (min && v + 1e-9 < min) html += '<br><small style="color:#f59e0b;font-size:11px">First cash-out to this wallet must be at least ' + min + ' OST (Solana keeps ≥ 0.00089 SOL in a new account).</small>';
      quoteEl.innerHTML = html;
    }
    function syncLabel() {
      var isOut = sel.value === 'OST';
      if (lbl && isOut) lbl.textContent = 'Cash out to SOL';
      else if (lbl && lbl.textContent === 'Cash out to SOL') lbl.textContent = 'Convert to OST';
      // Own attribute name: the Get-OST hub binds [data-direction] (SOL-5).
      btn.setAttribute('data-swap-direction', isOut ? 'ost-to-sol' : 'to-ost');
      if (btn.hasAttribute('data-direction')) btn.removeAttribute('data-direction');
      if (isOut) {
        solLamports().then(function (l) { lastLam = l; paintQuote(); });
        paintQuote();
      }
    }
    sel.addEventListener('change', syncLabel);
    if (amt) amt.addEventListener('input', function () { if (sel.value === 'OST') paintQuote(); });
    window.addEventListener('ost:convert-price', paintQuote);
    window.addEventListener('ost:balance', function () { if (sel.value === 'OST') solLamports().then(function (l) { lastLam = l; paintQuote(); }); });
    syncLabel();

    // Capture-phase so we run BEFORE the forward-direction handler.
    btn.addEventListener('click', function (ev) {
      if (sel.value !== 'OST') return;
      ev.stopImmediatePropagation();
      ev.preventDefault();
      if (inflight) return;
      var v = parseFloat(String(amt && amt.value || '').replace(',', '.'));
      if (!Number.isFinite(v) || v <= 0) { showBanner('Enter an OST amount first.', 'error'); return; }
      if (!walletPk()) {
        var W = window.OST_WALLET;
        if (W && typeof W.requireWallet === 'function') { try { W.requireWallet({ reason: 'Cash out OST to SOL' }); } catch (_) {} }
        else showBanner('Connect a wallet first.', 'error');
        return;
      }
      btn.disabled = true;
      showBanner('Cashing out ' + fmt(v, 4) + ' OST → SOL…', 'info');
      swapOstToSol(v).then(function (r) {
        if (r.pending) showBanner('Still confirming — check your balance before retrying.' + (r.sig ? ' (tx ' + String(r.sig).slice(0, 8) + '…)' : ''), 'info');
        else showBanner('✓ Cashed out ' + fmt(r.ost, 4) + ' OST → ' + (Number.isFinite(r.sol) ? fmt(r.sol) : '?') + ' SOL · tx ' + String(r.sig).slice(0, 8) + '…', 'ok');
        if (amt) {
          amt.value = '';
          // Tell every preview writer (incl. the To box) the amount is gone,
          // so no stale "≈ x SOL" quote stays next to an empty input.
          try { amt.dispatchEvent(new Event('input', { bubbles: true })); } catch (_) {}
        }
        paintQuote();
        try { window.dispatchEvent(new CustomEvent('ost:converter-success', { detail: r })); } catch (_) {}
      }).catch(function (e) {
        if (e && e.code === 'in_progress') return;
        var h = human(e, 'submit');
        // Our own pre-sign refusals carry the exact numbers; an error the rail
        // already worded (e.human) would repeat its title.
        if (e && !e.human && (e.code === 'below_rent_minimum' || e.code === 'insufficient_balance') && e.message) h.body = e.message;
        showBanner(h.title + (h.body ? ' — ' + h.body : ''), h.state === 'pending' ? 'info' : 'error');
      }).finally(function () { btn.disabled = false; });
    }, true);
    return true;
  }
  if (!wireConvertUi()) {
    document.addEventListener('DOMContentLoaded', wireConvertUi);
    var ui = 0;
    var uiv = setInterval(function () {
      if (wireConvertUi() || ++ui > 20) clearInterval(uiv);
    }, 600);
  }

  window.OST_SWAP_RESILIENT = {
    quoteOstToSol: quoteOstToSol,
    swapOstToSol:  swapOstToSol,
    minOstFor:     minOstFor,
    // Retired queue API (kept so old callers do not throw). Nothing is queued.
    queue:         function () { return []; },
    flushQueue:    function () { return Promise.resolve(); },
    clearQueue:    function () { try { localStorage.removeItem('ost.swap.queue.v1'); } catch (_) {} },
    showBanner:    function (html, tone) { showBanner(String(html || '').replace(/<[^>]*>/g, ''), tone); }
  };
})();

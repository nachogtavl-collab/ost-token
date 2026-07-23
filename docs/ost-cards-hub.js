/* ==========================================================================
 * OST · Cards — every card in one place: OSTC debit + the OSTG credit line
 * --------------------------------------------------------------------------
 * Two products, deliberately kept visually and functionally distinct because
 * confusing them is how people get hurt:
 *
 *   OSTC DEBIT   spends a balance you already hold. No debt, nothing to repay.
 *   OSTG CREDIT  borrowed OSTG against a credit line, at interest, repayable.
 *
 * THE ONE RULE THIS UI EXISTS TO MAKE VISIBLE
 * Money won with a loan carries that loan's taint and cannot repay it, and is
 * not withdrawable until the loan is settled. Users must be able to SEE that
 * split at a glance - a single blended "balance" would hide the most important
 * fact about their own money. So `clean` and `locked` are never summed into
 * one figure anywhere in this file.
 *
 * The server (loan-ledger.js) is the authority on every number here. This
 * screen only renders what /loans/summary returns and never computes a balance
 * of its own - a client-side figure that disagrees with the ledger is worse
 * than no figure at all.
 *
 * Credit is gated server-side behind LOANS_LIVE + mainnet, so on devnet this
 * page shows the terms and refuses to draw. It says that plainly rather than
 * presenting a button that will fail.
 * ========================================================================== */
(function () {
  'use strict';
  if (window.OST_CARDS_HUB) return;

  var API = window.OST_API_BASE || 'https://ost-api.nachogtavl.workers.dev';

  function wallet() {
    try {
      return (window.OST_WALLET && window.OST_WALLET.address) ||
             (window.solana && window.solana.publicKey && window.solana.publicKey.toString()) || '';
    } catch (_) { return ''; }
  }

  function esc(t) {
    return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function usd(n) { return '$' + (Number(n) || 0).toFixed(2); }
  function ostg(n) { return (Number(n) || 0).toFixed(2) + ' OSTG'; }

  /* ---- styles ------------------------------------------------------------- */

  function injectStyle() {
    if (document.getElementById('ost-cards-hub-style')) return;
    var css =
      '.och-wrap{display:grid;gap:16px;}' +
      '.och-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(268px,1fr));gap:14px;}' +
      '.och-card{border-radius:17px;padding:17px;color:#fff;position:relative;overflow:hidden;min-height:158px;' +
        'display:flex;flex-direction:column;justify-content:space-between;}' +
      '.och-card.debit{background:linear-gradient(135deg,#0b3a52,#061a26);border:1px solid rgba(127,216,255,.32);}' +
      '.och-card.credit{background:linear-gradient(135deg,#3a2a12,#241505);border:1px solid rgba(255,196,120,.32);}' +
      '.och-kind{font-size:10.5px;letter-spacing:.13em;text-transform:uppercase;opacity:.72;}' +
      '.och-name{font-size:17px;font-weight:650;margin-top:3px;}' +
      '.och-big{font-size:23px;font-weight:680;letter-spacing:.01em;}' +
      '.och-sub{font-size:11.5px;opacity:.76;margin-top:3px;line-height:1.4;}' +
      '.och-tag{position:absolute;top:13px;right:13px;font-size:10px;padding:3px 8px;border-radius:999px;' +
        'background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.18);}' +
      '.och-split{display:flex;gap:14px;margin-top:9px;flex-wrap:wrap;}' +
      '.och-split div{font-size:11.5px;}' +
      '.och-split b{display:block;font-size:15px;font-weight:640;margin-top:1px;}' +
      '.och-locked b{color:#ffc478;}' +
      '.och-panel{border-radius:15px;background:#06111d;border:1px solid rgba(127,216,255,.2);padding:15px;}' +
      '.och-panel h4{margin:0 0 9px;font-size:14px;color:#dff8ff;}' +
      '.och-row{display:flex;gap:9px;align-items:center;flex-wrap:wrap;}' +
      '.och-row input{flex:1 1 130px;min-width:0;height:37px;border-radius:10px;border:1px solid rgba(255,255,255,.14);' +
        'background:#020a12;color:#dff8ff;padding:0 11px;font-size:14px;}' +
      '.och-btn{height:37px;padding:0 16px;border-radius:10px;border:1px solid rgba(127,216,255,.4);' +
        'background:#12405c;color:#dff8ff;cursor:pointer;font-size:13px;}' +
      '.och-btn:disabled{opacity:.45;cursor:not-allowed;}' +
      '.och-btn.warn{background:#4a2c10;border-color:rgba(255,196,120,.45);}' +
      '.och-loan{display:grid;gap:5px;padding:11px;border-radius:12px;background:#08161f;margin-top:9px;font-size:12px;color:#9fbfd8;}' +
      '.och-loan .l-top{display:flex;justify-content:space-between;gap:9px;color:#dff8ff;font-size:13px;}' +
      '.och-note{font-size:11.5px;color:#8fb0c4;line-height:1.5;margin:9px 0 0;}' +
      '.och-warn{font-size:11.5px;line-height:1.5;margin:11px 0 0;padding:11px;border-radius:11px;' +
        'background:rgba(120,70,10,.2);border:1px solid rgba(255,196,120,.3);color:#ffd9a8;}' +
      '.och-msg{font-size:12px;margin-top:9px;min-height:16px;}' +
      '.och-msg.ok{color:#7fe3b0;}.och-msg.err{color:#ff9a9a;}';
    var tag = document.createElement('style');
    tag.id = 'ost-cards-hub-style';
    tag.textContent = css;
    document.head.appendChild(tag);
  }

  /* ---- data --------------------------------------------------------------- */

  var state = { summary: null, busy: false };

  function api(pathname, body) {
    var opts = body
      ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      : {};
    return fetch(API + pathname, opts).then(function (r) {
      return r.json().catch(function () { return { ok: false, error: 'bad_response' }; });
    });
  }

  function loadSummary() {
    var w = wallet();
    if (!w) return Promise.resolve(null);
    return api('/loans/summary?address=' + encodeURIComponent(w)).then(function (d) {
      state.summary = (d && d.ok) ? d : null;
      return state.summary;
    }).catch(function () { state.summary = null; return null; });
  }

  /* ---- render ------------------------------------------------------------- */

  function render(host) {
    if (!host) return;
    injectStyle();
    var w = wallet();
    var s = state.summary;
    var ws = s && s.wallet;

    host.innerHTML =
      '<div class="och-wrap">' +
        '<div class="och-cards">' +

          // ---- OSTC debit ----
          '<div class="och-card debit">' +
            '<span class="och-tag">Debit</span>' +
            '<div><div class="och-kind">OSTC</div>' +
            '<div class="och-name">OST Debit Card</div></div>' +
            '<div>' +
              '<div class="och-big" id="ochDebitBal">—</div>' +
              '<p class="och-sub">Spends OSTC you already hold. No debt, nothing to repay. ' +
              'Bridges 1:1 with OSTG once mainnet is live.</p>' +
            '</div>' +
          '</div>' +

          // ---- OSTG credit ----
          '<div class="och-card credit">' +
            '<span class="och-tag">Credit line</span>' +
            '<div><div class="och-kind">OSTG</div>' +
            '<div class="och-name">OSTG Credit Line</div></div>' +
            '<div>' +
              '<div class="och-big">' + (ws ? usd(s.availableUsd) : '—') + ' <span style="font-size:12px;opacity:.7;">available</span></div>' +
              (ws
                ? '<div class="och-split">' +
                    '<div>Your OSTG<b>' + ostg(ws.clean) + '</b></div>' +
                    '<div class="och-locked">Locked<b>' + ostg(ws.lockedTotal) + '</b></div>' +
                    '<div>Line<b>' + usd(ws.lineUsd) + '</b></div>' +
                  '</div>'
                : '<p class="och-sub">Connect a wallet to see your line.</p>') +
            '</div>' +
          '</div>' +

        '</div>' +

        // ---- borrow ----
        '<div class="och-panel">' +
          '<h4>Request a draw</h4>' +
          (w
            ? '<div class="och-row">' +
                '<input type="number" id="ochAmt" min="1" step="1" placeholder="Amount in USD (e.g. 100)">' +
                '<button type="button" class="och-btn warn" id="ochBorrow">Request</button>' +
              '</div>'
            : '<p class="och-note">Connect a wallet to request a draw.</p>') +
          '<div class="och-msg" id="ochMsg"></div>' +
          '<div class="och-warn">' +
            '<b>Before you borrow.</b> Borrowed OSTG is real debt at ' +
            (s && s.policy ? (s.policy.aprBps / 100) : 12) + '% APR (simple interest, never compounding). ' +
            'You can invest or play with it, but <b>you cannot withdraw it, and you cannot repay a loan using money you won with that same loan</b> — ' +
            'those winnings stay locked until the loan is settled from your own OSTG. ' +
            'Only borrow what you can repay from another source.' +
          '</div>' +
          renderLoans(s) +
          '<p class="och-note">' +
            (s && s.policy
              ? 'Line starts at ' + usd(s.policy.baseLineUsd) + ', grows ' + s.policy.lineMultiplier +
                '× per settled loan up to ' + usd(s.policy.maxLineUsd) + '. Up to ' + s.policy.maxOpenLoans +
                ' open draws; while one is unpaid each further draw must be smaller than it. Repay in parts any time.'
              : 'Credit line terms load once a wallet is connected.') +
          '</p>' +
        '</div>' +
      '</div>';

    var bal = document.getElementById('ochDebitBal');
    if (bal) bal.textContent = debitBalance();

    var btn = document.getElementById('ochBorrow');
    if (btn) btn.addEventListener('click', requestDraw);
    host.querySelectorAll('[data-repay]').forEach(function (b) {
      b.addEventListener('click', function () { repay(b.getAttribute('data-repay')); });
    });
  }

  function renderLoans(s) {
    if (!s || !s.loans || !s.loans.length) return '';
    return s.loans.map(function (l) {
      return '<div class="och-loan">' +
        '<div class="l-top"><span>Draw ' + esc(l.id) + '</span><span>' + ostg(l.outstandingOstg) + ' due</span></div>' +
        '<div>Principal ' + usd(l.principalUsd) + ' · ' + ostg(l.principalOstg) +
          ' · repaid ' + ostg(l.repaidOstg) + ' · interest ' + ostg(l.interestOstg) + '</div>' +
        '<div class="och-row" style="margin-top:5px;">' +
          '<button type="button" class="och-btn" data-repay="' + esc(l.id) + '">Repay from my OSTG</button>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  // Debit balance comes from the existing balance tree - we do not invent a
  // third money store (see CLAUDE.md: never invent a third balance store).
  function debitBalance() {
    try {
      if (window.OST_TREE && window.OST_TREE.chain) {
        var c = window.OST_TREE.chain();
        if (c && Number.isFinite(c.amount)) return c.amount.toFixed(2) + ' OSTC';
      }
      var el = document.getElementById('wdOstBal');
      if (el) {
        var n = parseFloat(String(el.textContent).replace(/[^\d.\-]/g, ''));
        if (!isNaN(n)) return n.toFixed(2) + ' OSTC';
      }
    } catch (_) {}
    return '—';
  }

  function msg(text, kind) {
    var m = document.getElementById('ochMsg');
    if (!m) return;
    m.textContent = text || '';
    m.className = 'och-msg' + (kind ? ' ' + kind : '');
  }

  /* ---- actions ------------------------------------------------------------ */

  function requestDraw() {
    if (state.busy) return;
    var w = wallet();
    var amt = parseFloat((document.getElementById('ochAmt') || {}).value);
    if (!w) return msg('Connect a wallet first.', 'err');
    if (!(amt > 0)) return msg('Enter how much you want to draw, in USD.', 'err');

    // Deliberate friction. A draw is debt; it should take one more beat than a
    // tap. This is the opposite of prompting someone when their balance is low.
    if (!window.confirm('Draw ' + usd(amt) + ' as OSTG?\n\nThis is a loan at interest. You cannot withdraw it, ' +
                        'and winnings from it cannot repay it — they stay locked until you settle from your own OSTG.')) return;

    state.busy = true;
    msg('Requesting…');
    api('/loans/borrow', { address: w, usd: amt, usdPerOstg: rate() }).then(function (d) {
      state.busy = false;
      if (!d || !d.ok) return msg(explain(d), 'err');
      msg('Drawn. ' + ostg(d.loan.principalOstg) + ' is available to play or invest.', 'ok');
      refresh();
    }).catch(function () { state.busy = false; msg('Network error — nothing was drawn.', 'err'); });
  }

  function repay(loanId) {
    if (state.busy) return;
    var w = wallet();
    if (!w) return msg('Connect a wallet first.', 'err');
    var raw = window.prompt('How much OSTG do you want to repay toward ' + loanId + '?');
    if (raw == null) return;
    var amt = parseFloat(raw);
    if (!(amt > 0)) return msg('Enter a repayment amount.', 'err');

    state.busy = true;
    msg('Repaying…');
    // from:'clean' — repayment always comes from the user's own OSTG. The
    // server refuses a loan's own funds anyway; sending 'clean' makes the
    // intent explicit rather than relying on a default.
    api('/loans/repay', { address: w, loanId: loanId, amount: amt, from: 'clean' }).then(function (d) {
      state.busy = false;
      if (!d || !d.ok) return msg(explain(d), 'err');
      var extra = d.releasedToClean > 0
        ? ' Loan settled — ' + ostg(d.releasedToClean) + ' unlocked and is now yours.'
        : '';
      msg('Repaid ' + ostg(d.applied) + '.' + extra, 'ok');
      refresh();
    }).catch(function () { state.busy = false; msg('Network error — nothing was repaid.', 'err'); });
  }

  // Turn server error codes into something a person can act on.
  function explain(d) {
    var e = d && d.error;
    if (e === 'loans_not_live') return 'Credit lines are not open yet — they switch on with mainnet.';
    if (e === 'jurisdiction_not_served') return 'Credit is not offered in your jurisdiction.';
    if (e === 'no_free_slots') return 'You already have the maximum number of open draws. Repay one first.';
    if (e === 'must_be_smaller_than_open_loan') return 'While a draw is unpaid, the next must be smaller — max ' + usd(d.maxAllowedUsd) + '.';
    if (e === 'exceeds_credit_line') return 'That is above your available line (' + usd(d.availableUsd) + ').';
    if (e === 'cannot_repay_loan_with_its_own_funds') return 'You cannot repay a loan with money won using it. Repay from your own OSTG.';
    if (e === 'insufficient_bucket') return 'Not enough OSTG in that balance (' + ostg(d.have) + ').';
    return e ? ('Could not complete: ' + e) : 'Could not complete that request.';
  }

  // USD per OSTG. Uses the same figure the top-up config publishes so the
  // credit line and the shop cannot drift apart.
  function rate() {
    try {
      if (window.OST_TOPUP_RATE && Number(window.OST_TOPUP_RATE) > 0) return Number(window.OST_TOPUP_RATE);
    } catch (_) {}
    return 0.0118;
  }

  /* ---- mount -------------------------------------------------------------- */

  function refresh() {
    var host = document.getElementById('ostCardsHub');
    if (!host) return Promise.resolve();
    return loadSummary().then(function () { render(host); });
  }

  function open() {
    var host = document.getElementById('ostCardsHub');
    if (host) {
      host.scrollIntoView({ behavior: 'smooth', block: 'start' });
      refresh();
      return;
    }
    // No section on this page: render into a modal so the hub is reachable
    // from anywhere.
    var box = document.getElementById('ostCardsHubModal');
    if (box) { box.remove(); return; }
    box = document.createElement('div');
    box.id = 'ostCardsHubModal';
    box.style.cssText = 'position:fixed;inset:auto 8px 88px 8px;z-index:1000440;max-height:74vh;overflow:auto;' +
      'padding:14px;border-radius:17px;background:#040d16;border:1px solid rgba(127,216,255,.26);' +
      'box-shadow:0 22px 66px rgba(0,0,0,.62);';
    var close = document.createElement('button');
    close.type = 'button';
    close.textContent = 'Close';
    close.style.cssText = 'float:right;border:0;border-radius:9px;padding:5px 11px;background:#12405c;color:#dff8ff;cursor:pointer;';
    close.addEventListener('click', function () { box.remove(); });
    box.appendChild(close);
    var inner = document.createElement('div');
    inner.id = 'ostCardsHub';
    box.appendChild(inner);
    document.body.appendChild(box);
    loadSummary().then(function () { render(inner); });
  }

  window.OST_CARDS_HUB = { open: open, refresh: refresh, render: render };

  function boot() {
    var host = document.getElementById('ostCardsHub');
    if (host) loadSummary().then(function () { render(host); });
    window.addEventListener('ost:wallet-changed', function () { refresh(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();

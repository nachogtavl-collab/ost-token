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
 * Credit is gated server-side by LOANS_MODE (off | test | live). On devnet in
 * `test` the mechanism is fully real - real line, real provenance, real
 * interest, real repayment, and the drawn OSTG is genuinely backed by pool
 * tokens - so testers exercise the true system, not a mock.
 *
 * The draw amount is entered in USD and converted to OSTG live, and the screen
 * shows the BINDING limit: the smaller of the remaining credit line and what
 * the pool can actually back. Showing the line alone would promise OSTG that
 * cannot be drawn.
 * ========================================================================== */
(function () {
  'use strict';
  if (window.OST_CARDS_HUB) return;

  var API = window.OST_API_BASE || 'https://ost-api.nachogtavl.workers.dev';

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
      '.och-msg.ok{color:#7fe3b0;}.och-msg.err{color:#ff9a9a;}' +
      '.och-conv{font-size:12.5px;color:#dff8ff;margin:9px 0 0;}' +
      '.och-cap{font-size:11.5px;color:#8fb0c4;margin:5px 0 0;line-height:1.45;}' +
      '.och-draw-modal{position:fixed;inset:0;z-index:1000600;display:flex;align-items:center;justify-content:center;' +
        'padding:16px;background:rgba(2,6,12,.72);opacity:0;transition:opacity .2s;}' +
      '.och-draw-modal.is-open{opacity:1;}' +
      '.och-draw-panel{width:min(360px,94vw);border-radius:20px;padding:22px;text-align:center;' +
        'background:linear-gradient(150deg,#3a2a12,#140a02);border:1px solid rgba(255,196,120,.4);' +
        'box-shadow:0 30px 90px rgba(0,0,0,.7);transform:scale(.94);transition:transform .2s;}' +
      '.och-draw-modal.is-open .och-draw-panel{transform:scale(1);}' +
      '.och-draw-usd{font-size:40px;font-weight:750;color:#7fe3b0;letter-spacing:.01em;font-variant-numeric:tabular-nums;}' +
      '.och-draw-arrow{font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#c9a56a;margin:7px 0;}' +
      '.och-draw-ostg{font-size:27px;font-weight:700;color:#ffd9a8;font-variant-numeric:tabular-nums;}' +
      '.och-draw-terms{font-size:11.5px;color:#e8c99a;line-height:1.5;margin:14px 0 16px;}' +
      '.och-draw-actions{display:flex;gap:9px;}' +
      '.och-draw-actions .och-btn{flex:1 1 0;justify-content:center;}';
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
        // On-chain OSTG + reconciliation, so "wallet vs play" and "is the
        // mirror backed" are answered in the same place cards live.
        '<div id="ostOnchainSync"></div>' +
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
                '<input type="number" id="ochAmt" min="0.01" step="0.01" placeholder="Amount in USD">' +
                '<button type="button" class="och-btn warn" id="ochBorrow">Request</button>' +
              '</div>' +
              // Live USD -> OSTG so the user sees the actual tokens they will
              // receive before committing, not just a dollar figure.
              '<p class="och-conv" id="ochConv">Enter an amount to see the OSTG you receive.</p>' +
              capacityLine(s)
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

    try { if (window.OST_ONCHAIN_SYNC && window.OST_ONCHAIN_SYNC.refresh) window.OST_ONCHAIN_SYNC.refresh(); } catch (_) {}
    var bal = document.getElementById('ochDebitBal');
    if (bal) bal.textContent = debitBalance();

    wireConv(s);
    var btn = document.getElementById('ochBorrow');
    if (btn) btn.addEventListener('click', requestDraw);
    host.querySelectorAll('[data-repay]').forEach(function (b) {
      b.addEventListener('click', function () { repay(b.getAttribute('data-repay')); });
    });
  }


  // The BINDING limit, shown in both units. The credit line is denominated in
  // USD but the pool can only lend its backed surplus, so showing the line
  // alone would promise OSTG that cannot be drawn.
  function capacityLine(s) {
    var c = s && s.capacity;
    if (!c) return '';
    var limited = c.limitedBy === 'pool_buffer';
    return '<p class="och-cap">Available to draw now: <b>' + usd(c.maxDrawUsd) + '</b> ' +
      '(<b>' + ostg(c.maxDrawOstg) + '</b>)' +
      (limited
        ? ' — capped by the lending pool right now, not by your ' + usd(s.wallet.lineUsd) + ' line.'
        : ' — your full remaining credit line.') +
      '</p>';
  }

  function wireConv(s) {
    var input = document.getElementById('ochAmt');
    var out = document.getElementById('ochConv');
    if (!input || !out) return;
    var c = (s && s.capacity) || { usdPerOstg: 0.0118, maxDrawUsd: 0, maxDrawOstg: 0 };
    function upd() {
      var v = parseFloat(input.value);
      if (!(v > 0)) { out.textContent = 'Enter an amount to see the OSTG you receive.'; out.className = 'och-conv'; return; }
      var tokens = v / (c.usdPerOstg || 0.0118);
      var over = v > (c.maxDrawUsd || 0) + 1e-9;
      out.innerHTML = usd(v) + ' → <b>' + ostg(tokens) + ' OSTG</b>' +
        (over ? ' · <span style="color:#ff9a9a;">above what can be drawn right now (' + usd(c.maxDrawUsd) + ')</span>' : '');
      out.className = 'och-conv' + (over ? ' is-over' : '');
    }
    input.addEventListener('input', upd);
    upd();
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
    openDrawModal(w, amt);
  }

  // The draw is where a loan has to FEEL real: you see the dollars first, then
  // watch them convert into the OSTG you receive, then confirm. window.confirm
  // gave none of that.
  function openDrawModal(w, amt) {
    var tokens = amt / rate();
    var apr = (state.summary && state.summary.policy ? state.summary.policy.aprBps / 100 : 12);
    var modal = document.createElement('div');
    modal.className = 'och-draw-modal';
    modal.innerHTML =
      '<div class="och-draw-panel">' +
        '<div class="och-draw-usd" id="ochDrawUsd">$0.00</div>' +
        '<div class="och-draw-arrow">converts to</div>' +
        '<div class="och-draw-ostg" id="ochDrawOstg">0.00 OSTG</div>' +
        '<p class="och-draw-terms">This is a <b>loan at ' + apr + '% APR</b>. You can play and ' +
          'invest it, but you cannot withdraw it, and winnings from it stay locked until you repay from your own OSTG.</p>' +
        '<div class="och-draw-actions">' +
          '<button type="button" class="och-btn" id="ochDrawCancel">Cancel</button>' +
          '<button type="button" class="och-btn warn" id="ochDrawGo">Confirm draw</button>' +
        '</div>' +
        '<div class="och-msg" id="ochDrawMsg"></div>' +
      '</div>';
    document.body.appendChild(modal);
    requestAnimationFrame(function () { modal.classList.add('is-open'); });

    var t0 = performance.now(), DUR = 650;
    var usdEl = modal.querySelector('#ochDrawUsd'), ostgEl = modal.querySelector('#ochDrawOstg');
    (function tick(now) {
      var k = Math.min(1, (now - t0) / DUR);
      var e = 1 - Math.pow(1 - k, 3);
      usdEl.textContent = '$' + (amt * e).toFixed(2);
      ostgEl.textContent = (tokens * e).toFixed(2) + ' OSTG';
      if (k < 1) requestAnimationFrame(tick);
    })(t0);

    function close() { modal.classList.remove('is-open'); setTimeout(function () { modal.remove(); }, 200); }
    modal.querySelector('#ochDrawCancel').addEventListener('click', close);
    modal.addEventListener('click', function (e) { if (e.target === modal) close(); });
    modal.querySelector('#ochDrawGo').addEventListener('click', function () {
      var go = modal.querySelector('#ochDrawGo');
      var dmsg = modal.querySelector('#ochDrawMsg');
      go.disabled = true;
      dmsg.textContent = 'Drawing…'; dmsg.className = 'och-msg';
      state.busy = true;
      api('/loans/draw', { wallet: w, usd: amt, usdPerOstg: rate() }).then(function (d) {
        state.busy = false;
        if (!d || !d.ok) { go.disabled = false; dmsg.textContent = explain(d); dmsg.className = 'och-msg err'; return; }
        dmsg.textContent = 'Done — ' + ostg(d.loan.principalOstg) + ' landed in your play balance.';
        dmsg.className = 'och-msg ok';
        // Announce immediately so no balance looks like it "disappeared" while
        // a poll catches up.
        try { window.dispatchEvent(new CustomEvent('ost:wallet-changed')); } catch (_) {}
        if (window.OST_PLAY && window.OST_PLAY.refresh) window.OST_PLAY.refresh();
        if (window.OST_OSTG_SOURCE && window.OST_OSTG_SOURCE.refresh) window.OST_OSTG_SOURCE.refresh();
        setTimeout(function () { close(); refresh(); msg('Drawn — ' + ostg(d.loan.principalOstg) + ' OSTG is now yours to play.', 'ok'); }, 1100);
      }).catch(function () { state.busy = false; go.disabled = false; dmsg.textContent = 'Network error — nothing was drawn.'; dmsg.className = 'och-msg err'; });
    });
  }

  function repay(loanId) {
    if (state.busy) return;
    var w = wallet();
    if (!w) return msg('Connect a wallet first.', 'err');
    var loan = (state.summary && state.summary.loans || []).filter(function (l) { return l.id === loanId; })[0];
    var owed = loan ? Number(loan.outstandingOstg) : 0;
    // Repayment spends the REAL play balance. Using the loan ledger's `clean`
    // counter (or ownSpendable, which subtracts locked) showed 0 and made
    // repayment look impossible - that was the reported bug.
    var own;
    try { own = window.OST_PLAY && window.OST_PLAY.balance(); } catch (_) { own = undefined; }
    openRepayModal(w, loanId, owed, own);
  }

  // Repay shows what is owed, what you can pay from your OWN OSTG, and a slider
  // so partial repayment is one gesture. Repayment always comes from personal
  // OSTG; the server refuses a loan's own funds and the UI never offers them.
  function openRepayModal(w, loanId, owed, own) {
    // undefined = balance not loaded. Rendering it as 0.00 is the masking bug:
    // the user sees "0" and concludes repayment is broken. Say it plainly.
    var known = Number.isFinite(Number(own));
    var maxPay = known ? Math.max(0, Math.min(owed, Number(own))) : 0;
    var modal = document.createElement('div');
    modal.className = 'och-draw-modal';
    modal.innerHTML =
      '<div class="och-draw-panel" style="background:linear-gradient(150deg,#0b3a52,#061a26);border-color:rgba(127,216,255,.4);">' +
        '<div class="och-draw-arrow">Repay loan ' + esc(loanId.slice(0, 8)) + '</div>' +
        '<div class="och-draw-usd" id="ochRepAmt" style="color:#7fd8ff;">' + ostg(maxPay) + '</div>' +
        '<input type="range" id="ochRepRange" min="0" max="' + maxPay.toFixed(2) + '" step="0.01" value="' + maxPay.toFixed(2) + '" style="width:100%;margin:14px 0;">' +
        '<p class="och-draw-terms" style="color:#bfe4f5;">Owed: <b>' + ostg(owed) + '</b> · your OSTG: <b>' + (known ? ostg(own) : 'loading…') + '</b>. ' +
          'Repaying the full amount unlocks any winnings tied to this loan.</p>' +
        '<div class="och-draw-actions">' +
          '<button type="button" class="och-btn" id="ochRepCancel">Cancel</button>' +
          '<button type="button" class="och-btn" id="ochRepGo" style="background:#12405c;border-color:rgba(127,216,255,.5);">Repay</button>' +
        '</div>' +
        '<div class="och-msg" id="ochRepMsg"></div>' +
      '</div>';
    document.body.appendChild(modal);
    requestAnimationFrame(function () { modal.classList.add('is-open'); });

    var range = modal.querySelector('#ochRepRange');
    var amtEl = modal.querySelector('#ochRepAmt');
    range.addEventListener('input', function () { amtEl.textContent = ostg(parseFloat(range.value)); });

    function close() { modal.classList.remove('is-open'); setTimeout(function () { modal.remove(); }, 200); }
    modal.querySelector('#ochRepCancel').addEventListener('click', close);
    modal.addEventListener('click', function (e) { if (e.target === modal) close(); });
    modal.querySelector('#ochRepGo').addEventListener('click', function () {
      var amt = parseFloat(range.value);
      var go = modal.querySelector('#ochRepGo'), rmsg = modal.querySelector('#ochRepMsg');
      if (!(amt > 0)) { rmsg.textContent = 'Move the slider to choose an amount.'; rmsg.className = 'och-msg err'; return; }
      go.disabled = true; rmsg.textContent = 'Repaying…'; rmsg.className = 'och-msg';
      state.busy = true;
      api('/play/loan-repay', { wallet: w, loanId: loanId, amount: amt }).then(function (d) {
        state.busy = false;
        if (!d || !d.ok) { go.disabled = false; rmsg.textContent = explain(d); rmsg.className = 'och-msg err'; return; }
        var extra = d.releasedToClean > 0 ? ' Loan settled — ' + ostg(d.releasedToClean) + ' unlocked and is now yours.' : '';
        rmsg.textContent = 'Repaid ' + ostg(d.applied) + '.' + extra; rmsg.className = 'och-msg ok';
        try { window.dispatchEvent(new CustomEvent('ost:wallet-changed')); } catch (_) {}
        if (window.OST_PLAY && window.OST_PLAY.refresh) window.OST_PLAY.refresh();
        if (window.OST_OSTG_SOURCE && window.OST_OSTG_SOURCE.refresh) window.OST_OSTG_SOURCE.refresh();
        setTimeout(function () { close(); refresh(); msg('Repaid ' + ostg(d.applied) + '.' + extra, 'ok'); }, 1100);
      }).catch(function () { state.busy = false; go.disabled = false; rmsg.textContent = 'Network error — nothing was repaid.'; rmsg.className = 'och-msg err'; });
    });
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
    if (e === 'insufficient_lending_buffer' || e === 'insufficient_lending_buffer_at_commit')
      return 'The lending pool cannot cover that right now — max ' + ostg(d.availableOstg || 0) + ' OSTG.';
    if (e === 'bankroll_unreadable') return 'Cannot read the lending pool right now. Try again shortly.';
    if (e === 'amount_locked_by_loan') return d.message || 'That amount is locked behind an unpaid loan.';
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

  window.OST_CARDS_HUB = {
    open: open,
    refresh: refresh,
    render: render,
    // Read-only view of the last loan summary. Ghost AI reads this so it can
    // answer loan questions from the SERVER's numbers rather than guessing.
    summary: function () { return state.summary; }
  };

  function boot() {
    var host = document.getElementById('ostCardsHub');
    if (host) loadSummary().then(function () { render(host); });
    window.addEventListener('ost:wallet-changed', function () { refresh(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();

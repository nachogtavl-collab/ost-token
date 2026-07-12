/* ==========================================================================
 * OST · Positions — the trade ticket's HUD, auto-claim, and money reconciler
 * --------------------------------------------------------------------------
 * One source of truth for "what do I have riding, and what am I owed?".
 * Built on OST_PRED_CLAIM (prediction-extras), which merges BOTH bet stores
 * (extras + the main trade desk) and owns the single hardened claim path.
 *
 *   OST_POSITIONS.summary()  -> { open, toClaim, paid, lost, staked, owed, pnl }
 *   OST_POSITIONS.audit()    -> money owed / never paid / suspected duplicates
 *   OST_POSITIONS.claimAll() -> settle every unclaimed win (idempotent)
 *   OST_POSITIONS.autoClaim  -> on/off (default ON, persisted)
 *
 * Auto-claim: a won bet is money the user already earned — leaving it behind a
 * button is how funds go missing. When a bet flips to `won` we claim it
 * automatically (serialised, idempotent, capped retries). Users can turn it off.
 * ========================================================================== */
(function () {
  'use strict';

  var AUTO_KEY = 'ost.autoclaim.v1';
  var HUD_ID = 'ostPosHud';

  function api() { return window.OST_PRED_CLAIM || null; }
  function positions() {
    var a = api();
    if (!a || typeof a.list !== 'function') return [];
    try { return a.list() || []; } catch (_) { return []; }
  }
  function num(n) { var v = Number(n); return Number.isFinite(v) ? v : 0; }
  function fmt(n) { return num(n).toFixed(2); }

  function autoClaimOn() {
    try { return localStorage.getItem(AUTO_KEY) !== '0'; } catch (_) { return true; }
  }
  function setAutoClaim(on) {
    try { localStorage.setItem(AUTO_KEY, on ? '1' : '0'); } catch (_) {}
    render();
    if (on) sweep();
  }

  // Net payout a winning bet is owed (house edge applied on PROFIT only).
  function netOwed(b) {
    var gross = num(b.payoutIfWin);
    if (window.OST_HOUSE && typeof window.OST_HOUSE.quote === 'function') {
      try { return num(window.OST_HOUSE.quote(gross, num(b.stake)).net); } catch (_) {}
    }
    return gross;
  }

  function summary() {
    var list = positions();
    var s = { open: 0, toClaim: 0, paid: 0, lost: 0, staked: 0, owed: 0, paidTotal: 0, pnl: 0, count: list.length };
    list.forEach(function (b) {
      var stake = num(b.stake);
      s.staked += stake;
      if (b.status === 'won') {
        if (b.claimed) { s.paid++; s.paidTotal += num(b.paidOut); }
        else { s.toClaim++; s.owed += netOwed(b); }
      } else if (b.status === 'lost') {
        s.lost++;
      } else {
        s.open++;
      }
    });
    // Realised P&L = what winners actually paid out, minus the stakes of
    // everything already settled (won + lost). Open bets are not counted.
    var settledStake = 0;
    list.forEach(function (b) {
      if (b.status === 'won' || b.status === 'lost') settledStake += num(b.stake);
    });
    s.pnl = (s.paidTotal + s.owed) - settledStake;
    return s;
  }

  /* ---- reconciliation: find money the app owes the user --------------------- */
  function audit() {
    var list = positions();
    var unpaidWins = [];   // won, never claimed -> user is owed this
    var deadClaims = [];   // marked claimed but paid 0 -> the old dead-end bug
    var suspectDupes = []; // paid noticeably more than the win was worth
    list.forEach(function (b) {
      if (b.status !== 'won') return;
      var owed = netOwed(b);
      if (!b.claimed) { unpaidWins.push({ id: b.id, title: b.title, owed: owed }); return; }
      var paid = num(b.paidOut);
      if (paid <= 0) { deadClaims.push({ id: b.id, title: b.title, owed: owed }); return; }
      if (owed > 0 && paid > owed * 1.5 + 0.01) {
        suspectDupes.push({ id: b.id, title: b.title, paid: paid, expected: owed });
      }
    });
    var owedTotal = unpaidWins.reduce(function (t, x) { return t + x.owed; }, 0)
                  + deadClaims.reduce(function (t, x) { return t + x.owed; }, 0);
    return {
      ok: !unpaidWins.length && !deadClaims.length && !suspectDupes.length,
      unpaidWins: unpaidWins,
      deadClaims: deadClaims,
      suspectDupes: suspectDupes,
      owedTotal: owedTotal
    };
  }

  /* ---- claiming ------------------------------------------------------------ */
  var busy = false;
  function claimable() {
    return positions().filter(function (b) {
      return b && b.status === 'won' && !b.claimed && !(api() && api().isClaiming && api().isClaiming(b.id));
    });
  }
  // Serialised so payouts never race each other.
  function claimAll() {
    var a = api();
    if (!a || busy) return Promise.resolve(0);
    busy = true;
    var todo = claimable();
    var done = 0;
    return todo.reduce(function (chain, b) {
      return chain.then(function () {
        try { a.claim(b.id, null); done++; } catch (_) {}
        return new Promise(function (r) { setTimeout(r, 250); });
      });
    }, Promise.resolve()).then(function () {
      busy = false;
      render();
      return done;
    }).catch(function () { busy = false; return done; });
  }

  // Auto-claim sweep: settle wins the moment they resolve.
  function sweep() {
    if (!autoClaimOn()) return;
    var todo = claimable();
    if (!todo.length) return;
    claimAll();
  }

  /* ---- HUD ----------------------------------------------------------------- */
  function hudHost() {
    // Mount above the prediction ticket / bets panel, whichever exists.
    return document.getElementById('predictionTicket')
        || document.getElementById('ost-pred-mybets')
        || document.getElementById('predictionMarketStage')
        || null;
  }

  function ensureHud() {
    if (document.getElementById(HUD_ID)) return document.getElementById(HUD_ID);
    var host = hudHost();
    if (!host) return null;
    var el = document.createElement('section');
    el.id = HUD_ID;
    el.className = 'ost-pos-hud';
    host.parentNode.insertBefore(el, host);
    el.addEventListener('click', function (e) {
      var t = e.target.closest && e.target.closest('[data-pos-act]');
      if (!t) return;
      var act = t.getAttribute('data-pos-act');
      if (act === 'claim-all') { t.disabled = true; t.textContent = 'Claiming…'; claimAll().then(render); }
      if (act === 'toggle-auto') setAutoClaim(!autoClaimOn());
    });
    return el;
  }

  function render() {
    var el = ensureHud();
    if (!el) return;
    var s = summary();
    var a = audit();
    var pnlCls = s.pnl > 0 ? 'is-pos' : s.pnl < 0 ? 'is-neg' : '';
    var pnlTxt = (s.pnl > 0 ? '+' : '') + fmt(s.pnl);
    el.innerHTML = [
      '<div class="ost-pos-hud__row">',
        '<div class="ost-pos-stat"><span>Open</span><strong>' + s.open + '</strong></div>',
        '<div class="ost-pos-stat ' + (s.toClaim ? 'is-live' : '') + '"><span>To claim</span><strong>' + s.toClaim + '</strong></div>',
        '<div class="ost-pos-stat"><span>Paid</span><strong>' + s.paid + '</strong></div>',
        '<div class="ost-pos-stat"><span>Lost</span><strong>' + s.lost + '</strong></div>',
        '<div class="ost-pos-stat"><span>Staked</span><strong>' + fmt(s.staked) + '</strong></div>',
        '<div class="ost-pos-stat ' + pnlCls + '"><span>P&amp;L</span><strong>' + pnlTxt + '</strong></div>',
      '</div>',
      (s.owed > 0
        ? '<div class="ost-pos-hud__claim"><span>You are owed <strong>' + fmt(s.owed) + ' OST</strong> from ' + s.toClaim + ' win' + (s.toClaim === 1 ? '' : 's') + '</span>' +
          '<button type="button" class="ost-pos-btn" data-pos-act="claim-all">Claim all</button></div>'
        : ''),
      (a.deadClaims.length
        ? '<div class="ost-pos-hud__warn">' + a.deadClaims.length + ' win(s) were marked claimed but never paid — worth ' + fmt(a.deadClaims.reduce(function (t, x) { return t + x.owed; }, 0)) + ' OST. Tap “Claim all” to recover.</div>'
        : ''),
      '<label class="ost-pos-hud__auto"><input type="checkbox" data-pos-act="toggle-auto" ' + (autoClaimOn() ? 'checked' : '') + '> Auto-claim wins</label>'
    ].join('');
  }

  function injectCss() {
    if (document.getElementById('ostPosCss')) return;
    var css = ''
      + '.ost-pos-hud{margin:0 0 12px;padding:12px 14px;border:1px solid rgba(52,211,153,.25);border-radius:14px;background:rgba(6,20,16,.5);}'
      + '.ost-pos-hud__row{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:8px;}'
      + '@media(max-width:640px){.ost-pos-hud__row{grid-template-columns:repeat(3,minmax(0,1fr));}}'
      + '.ost-pos-stat{display:flex;flex-direction:column;gap:2px;min-width:0;}'
      + '.ost-pos-stat span{font-size:.66rem;text-transform:uppercase;letter-spacing:.05em;color:#94a3b8;}'
      + '.ost-pos-stat strong{font-size:1.02rem;color:#e5e7eb;}'
      + '.ost-pos-stat.is-live strong{color:#34d399;}'
      + '.ost-pos-stat.is-pos strong{color:#34d399;}.ost-pos-stat.is-neg strong{color:#f87171;}'
      + '.ost-pos-hud__claim{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-top:10px;padding-top:10px;border-top:1px solid rgba(148,163,184,.16);font-size:.85rem;color:#cbd5e1;}'
      + '.ost-pos-btn{background:linear-gradient(135deg,#34d399,#22d3ee);color:#04211a;border:0;border-radius:10px;padding:9px 16px;font-weight:700;font-size:.85rem;min-height:40px;cursor:pointer;}'
      + '.ost-pos-btn[disabled]{opacity:.6;cursor:default;}'
      + '.ost-pos-hud__warn{margin-top:8px;font-size:.78rem;color:#fcd34d;}'
      + '.ost-pos-hud__auto{display:flex;align-items:center;gap:7px;margin-top:9px;font-size:.78rem;color:#94a3b8;cursor:pointer;}';
    var s = document.createElement('style');
    s.id = 'ostPosCss'; s.textContent = css;
    document.head.appendChild(s);
  }

  /* ---- boot ---------------------------------------------------------------- */
  function boot() {
    injectCss();
    render();
    sweep();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 1500); });
  else setTimeout(boot, 1500);

  // Re-render + auto-claim whenever positions could have changed.
  ['ost:prediction:order-changed', 'ost:prediction-order-recorded', 'ost:wallet-changed', 'ost-money-changed']
    .forEach(function (ev) { window.addEventListener(ev, function () { render(); sweep(); }, false); });
  setInterval(function () { render(); sweep(); }, 15000);

  window.OST_POSITIONS = {
    summary: summary,
    audit: audit,
    claimAll: claimAll,
    list: positions,
    render: render,
    get autoClaim() { return autoClaimOn(); },
    set autoClaim(v) { setAutoClaim(!!v); }
  };
})();

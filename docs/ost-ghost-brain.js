/* ==========================================================================
 * OST · Ghost Brain — the part of the Ghost that is actually irreplaceable
 * --------------------------------------------------------------------------
 * WHY THIS EXISTS
 *
 * We had two Ghosts and neither was worth much:
 *   · ost-ghost-companion — knows your data, but can only TALK about it. Every
 *     factual answer was a hand-written regex reply or a round-trip to a 70B
 *     model that has to be TOLD your numbers and can still hallucinate them.
 *   · ghost/ (the "realm") — a generic bring-your-own-key chat. Everything it
 *     can answer, Google answers better. There is no reason for it to exist.
 *
 * The only thing an OST-native AI can do that nothing else on earth can is
 * reason over YOUR ledger and then ACT on it. So this brain does exactly two
 * things a general model cannot:
 *
 *   1. GROUNDED ANSWERS — every number is COMPUTED from your local records
 *      (bets, credits, wallet, streaks), never generated. It cannot hallucinate
 *      a balance because it never guesses one. Works offline and while KV is
 *      exhausted, because it never needs the network.
 *   2. REAL CAPABILITIES — it doesn't describe what you could do, it does it:
 *      claims every unclaimed win, tells you what is claimable, checks whether
 *      you can afford a bet, and reports your true edge.
 *
 * The genuinely new part is the ANALYTICS: your win rate split by side and by
 * topic, your best and worst markets, where your money is actually going. No
 * general model can answer "am I better on YES or NO?" — only your own ledger
 * can, and it lives on your device.
 *
 * Privacy: nothing here leaves the browser. It reads localStorage and computes.
 *
 * API:
 *   OST_GHOST_BRAIN.ask(text) -> { text, handled, did?, data? } | null
 *   OST_GHOST_BRAIN.analytics() -> computed edge report
 *   OST_GHOST_BRAIN.snapshot()  -> the raw grounded facts
 * ========================================================================== */
(function () {
  'use strict';
  if (window.OST_GHOST_BRAIN) return;

  // ---- money formatting (always in the user's chosen currency) -------------
  function fiat(ost) {
    try {
      if (window.OST_FIAT && typeof window.OST_FIAT.format === 'function') return window.OST_FIAT.format(ost);
      if (window.OST_FX && typeof window.OST_FX.format === 'function') return window.OST_FX.format(ost);
    } catch (_) {}
    return '';
  }
  function ost(n) {
    var v = Number(n) || 0;
    var s = v.toFixed(2) + ' OST';
    var f = fiat(v);
    return f ? s + ' (' + f + ')' : s;
  }
  function pct(n) { return (Number(n) || 0).toFixed(0) + '%'; }

  // ---- grounded facts ------------------------------------------------------
  function bets() {
    try {
      if (window.OST_PRED_CLAIM && typeof window.OST_PRED_CLAIM.list === 'function') {
        return window.OST_PRED_CLAIM.list() || [];
      }
    } catch (_) {}
    try {
      if (window.OST_PREDICTION_API && typeof window.OST_PREDICTION_API.readOrders === 'function') {
        return window.OST_PREDICTION_API.readOrders() || [];
      }
    } catch (_) {}
    return [];
  }
  function credits() {
    try { return Number(window.OST_MONEY && window.OST_MONEY.get ? window.OST_MONEY.get() : 0) || 0; } catch (_) { return 0; }
  }
  function walletOst() {
    try {
      var el = document.getElementById('wdOstBal');
      if (el) { var n = parseFloat(String(el.textContent).replace(/[^\d.-]/g, '')); if (Number.isFinite(n)) return n; }
    } catch (_) {}
    return 0;
  }
  function meta() {
    try { return JSON.parse(localStorage.getItem('ost.games.meta.v1') || '{}') || {}; } catch (_) { return {}; }
  }

  function snapshot() {
    var all = bets();
    var open = [], won = [], lost = [], claimable = [];
    all.forEach(function (b) {
      if (!b) return;
      var st = String(b.status || '').toLowerCase();
      // A voided/failed/corrupt ticket is not a live position and must never be
      // counted as money at risk — the store marks these (e.g. 'void-corrupt'
      // from the data validator, or 'failed' from a rolled-back optimistic bet).
      if (b.voided || /void|corrupt|failed|cancel/.test(st)) return;
      var settled = !!(b.claimed || b.cashedOut);
      if (st === 'won') { won.push(b); if (!settled) claimable.push(b); }
      else if (st === 'lost') lost.push(b);
      else if (!settled) open.push(b);
    });
    var m = meta();
    return {
      all: all, open: open, won: won, lost: lost, claimable: claimable,
      credits: credits(), walletOst: walletOst(),
      streak: Number(m.streak || 0) || 0,
      tier: m.tier || 'Bronze'
    };
  }

  // ---- the irreplaceable part: YOUR edge, computed from YOUR ledger --------
  function num(b, k) { var v = Number(b && b[k]); return Number.isFinite(v) ? v : 0; }
  function payoutOf(b) { return num(b, 'paidOut') || num(b, 'cashoutOst') || 0; }
  function stakeOf(b) { return num(b, 'stake'); }

  function analytics() {
    var s = snapshot();
    var settled = s.won.concat(s.lost);
    var bySide = { yes: { w: 0, l: 0, pnl: 0 }, no: { w: 0, l: 0, pnl: 0 } };
    var byTopic = {};
    var totalStaked = 0, totalReturned = 0;

    settled.forEach(function (b) {
      var side = String(b.side || '').toLowerCase() === 'no' ? 'no' : 'yes';
      var isWin = String(b.status || '').toLowerCase() === 'won';
      var st = stakeOf(b), back = isWin ? payoutOf(b) : 0;
      var pnl = back - st;
      totalStaked += st; totalReturned += back;
      bySide[side][isWin ? 'w' : 'l'] += 1;
      bySide[side].pnl += pnl;
      var topic = String(b.topic || b.source || 'other').toLowerCase();
      if (!byTopic[topic]) byTopic[topic] = { w: 0, l: 0, pnl: 0, n: 0 };
      byTopic[topic][isWin ? 'w' : 'l'] += 1;
      byTopic[topic].pnl += pnl;
      byTopic[topic].n += 1;
    });

    var rate = function (o) { var n = o.w + o.l; return n ? (o.w / n) * 100 : 0; };
    var topics = Object.keys(byTopic).map(function (k) {
      return { topic: k, n: byTopic[k].n, pnl: byTopic[k].pnl, winRate: rate(byTopic[k]) };
    }).sort(function (a, b) { return b.pnl - a.pnl; });

    return {
      settledCount: settled.length,
      netPnl: totalReturned - totalStaked,
      totalStaked: totalStaked,
      yes: { winRate: rate(bySide.yes), pnl: bySide.yes.pnl, n: bySide.yes.w + bySide.yes.l },
      no: { winRate: rate(bySide.no), pnl: bySide.no.pnl, n: bySide.no.w + bySide.no.l },
      best: topics[0] || null,
      worst: topics.length > 1 ? topics[topics.length - 1] : null,
      topics: topics
    };
  }

  // ---- skills: grounded answers, and real actions --------------------------
  var SKILLS = [
    {
      id: 'claim',
      // ACTS. Not "you can claim in the bets panel" — it claims.
      test: /\b(claim|collect|cash\s*out)\b.*\b(all|everything|wins?|winnings?)\b|\bclaim all\b|\bcollect my (wins?|winnings?)\b/i,
      run: function () {
        var s = snapshot();
        if (!s.claimable.length) return { text: 'Nothing to claim right now — no unclaimed wins. I checked all ' + s.all.length + ' of your tickets.' };
        var total = s.claimable.reduce(function (t, b) { return t + (num(b, 'payoutIfWin') || payoutOf(b) || stakeOf(b)); }, 0);
        var did = false;
        try {
          if (window.OST_POSITIONS && typeof window.OST_POSITIONS.claimAll === 'function') { window.OST_POSITIONS.claimAll(); did = true; }
        } catch (_) {}
        return {
          text: did
            ? 'Claiming all ' + s.claimable.length + ' win' + (s.claimable.length > 1 ? 's' : '') + ' now — about ' + ost(total) + '. They settle in the background; I\'ll keep the rest of your tickets untouched.'
            : 'You have ' + s.claimable.length + ' unclaimed win' + (s.claimable.length > 1 ? 's' : '') + ' worth about ' + ost(total) + ', but the claim engine isn\'t loaded yet — try again in a second.',
          did: did ? 'claim-all' : null,
          data: { count: s.claimable.length, total: total }
        };
      }
    },
    {
      id: 'claimable',
      test: /\b(what|anything|any).*(claim|collect)\b|\bclaimable\b|\bdo i have.*(win|claim)/i,
      run: function () {
        var s = snapshot();
        if (!s.claimable.length) return { text: 'Nothing claimable. ' + (s.open.length ? s.open.length + ' ticket(s) still open.' : 'No open tickets either.') };
        var total = s.claimable.reduce(function (t, b) { return t + (num(b, 'payoutIfWin') || payoutOf(b) || stakeOf(b)); }, 0);
        var titles = s.claimable.slice(0, 3).map(function (b) { return (b.title || b.marketId || 'ticket'); });
        return {
          text: s.claimable.length + ' win' + (s.claimable.length > 1 ? 's' : '') + ' waiting — about ' + ost(total) + '. ' + titles.join(' · ') +
            '. Say "claim all" and I\'ll take them.',
          data: { count: s.claimable.length, total: total }
        };
      }
    },
    {
      id: 'edge',
      // The answer NO general AI can give: your real edge, from your ledger.
      test: /\b(edge|win rate|winrate|am i better|yes or no|which side|how good|my stats|analy[sz]e|pattern)\b/i,
      run: function () {
        var a = analytics();
        if (!a.settledCount) return { text: 'No settled tickets yet, so I can\'t compute your edge honestly. Place a few and I\'ll tell you exactly where you win.' };
        var lines = [];
        lines.push('Across ' + a.settledCount + ' settled tickets you are net ' + (a.netPnl >= 0 ? 'UP ' : 'DOWN ') + ost(Math.abs(a.netPnl)) + '.');
        if (a.yes.n) lines.push('YES: ' + pct(a.yes.winRate) + ' win rate over ' + a.yes.n + ' (' + (a.yes.pnl >= 0 ? '+' : '') + a.yes.pnl.toFixed(2) + ' OST).');
        if (a.no.n) lines.push('NO: ' + pct(a.no.winRate) + ' win rate over ' + a.no.n + ' (' + (a.no.pnl >= 0 ? '+' : '') + a.no.pnl.toFixed(2) + ' OST).');
        if (a.yes.n && a.no.n) {
          var better = a.yes.winRate >= a.no.winRate ? 'YES' : 'NO';
          lines.push('You are measurably better on ' + better + '.');
        }
        // Only call a lane "best" if it is actually PROFITABLE and there is more
        // than one lane to compare. Labelling a losing lane "best" (because it is
        // the only one) is exactly the kind of flattering nonsense that makes an
        // assistant untrustworthy.
        if (a.topics.length > 1 && a.best && a.best.pnl > 0) {
          lines.push('Best lane: ' + a.best.topic + ' (+' + a.best.pnl.toFixed(2) + ' OST over ' + a.best.n + ').');
        }
        if (a.topics.length > 1 && a.worst && a.worst !== a.best && a.worst.pnl < 0) {
          lines.push('Worst lane: ' + a.worst.topic + ' (' + a.worst.pnl.toFixed(2) + ' OST) — that\'s where your money goes.');
        }
        return { text: lines.join(' '), data: a };
      }
    },
    {
      id: 'afford',
      test: /\b(can i afford|afford|enough (for|to)|do i have enough)\b/i,
      run: function (q) {
        var s = snapshot();
        var m = /(\d+(?:\.\d+)?)/.exec(q);
        var want = m ? Number(m[1]) : NaN;
        var total = s.credits + s.walletOst;
        if (!Number.isFinite(want)) return { text: 'You have ' + ost(total) + ' spendable (' + ost(s.credits) + ' credits' + (s.walletOst ? ' + ' + ost(s.walletOst) + ' on-chain' : '') + '). Tell me an amount and I\'ll check it.' };
        return {
          text: total + 1e-9 >= want
            ? 'Yes — ' + ost(want) + ' is covered. You have ' + ost(total) + ', leaving ' + ost(total - want) + '.'
            : 'No — ' + ost(want) + ' is ' + ost(want - total) + ' more than you have. You hold ' + ost(total) + '. The faucet and the arcade top you up free.',
          data: { want: want, have: total }
        };
      }
    },
    {
      id: 'balance',
      test: /\b(balance|how much (do i have|ost)|my money|credits|worth)\b/i,
      run: function () {
        var s = snapshot();
        var total = s.credits + s.walletOst;
        return {
          text: 'You hold ' + ost(total) + ' total — ' + ost(s.credits) + ' in credits' +
            (s.walletOst ? ' and ' + ost(s.walletOst) + ' on-chain' : '') + '.' +
            (s.open.length ? ' Plus ' + s.open.length + ' ticket(s) still live.' : ''),
          data: { total: total }
        };
      }
    },
    {
      id: 'positions',
      // Plurals matter: a trailing \b after "(bet|ticket|position)" refused to
      // match "open bets", which is how people actually ask.
      test: /\b(open\s+(bet|ticket|position)s?|my\s+(bet|ticket|position)s?|positions?|what am i (in|holding))\b/i,
      run: function () {
        var s = snapshot();
        if (!s.open.length) return { text: 'No open tickets. ' + (s.claimable.length ? s.claimable.length + ' win(s) waiting to be claimed though — say "claim all".' : '') };
        var staked = s.open.reduce(function (t, b) { return t + stakeOf(b); }, 0);
        var titles = s.open.slice(0, 4).map(function (b) { return (b.title || b.marketId || 'ticket') + ' (' + String(b.side || '').toUpperCase() + ' ' + stakeOf(b).toFixed(2) + ')'; });
        return { text: s.open.length + ' open ticket(s), ' + ost(staked) + ' at risk: ' + titles.join(' · '), data: { count: s.open.length, staked: staked } };
      }
    }
  ];

  function ask(text) {
    var q = String(text || '').trim();
    if (!q) return null;
    for (var i = 0; i < SKILLS.length; i++) {
      if (SKILLS[i].test.test(q)) {
        try {
          var r = SKILLS[i].run(q);
          if (r && r.text) return { text: r.text, handled: true, skill: SKILLS[i].id, did: r.did || null, data: r.data || null };
        } catch (e) {
          // A broken skill must never take the Ghost down — fall through to the
          // model rather than showing the user an exception.
          try { console.warn('[ghost-brain] skill ' + SKILLS[i].id + ' failed', e); } catch (_) {}
          return null;
        }
      }
    }
    return null;   // not a grounded question — let the online brain handle it
  }

  window.OST_GHOST_BRAIN = {
    ask: ask,
    analytics: analytics,
    snapshot: snapshot,
    skills: SKILLS.map(function (s) { return s.id; })
  };
})();

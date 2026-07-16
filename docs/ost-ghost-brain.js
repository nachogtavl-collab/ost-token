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

  // ---- deep analysis: habits, mistakes, patterns --------------------------
  // This is the layer a general model physically cannot reach. It reads the
  // ORDER of your decisions, not just the totals — how your stake reacts to a
  // loss, when you play, what you keep repeating. Behaviour, not trivia.
  // The timestamp is NOT always `createdAt`: OST_PRED_CLAIM.list() normalises
  // desk orders and renames it to `placedAt`. Reading only `createdAt` gave 0 for
  // every row, so the sort below was a no-op and the list stayed NEWEST-FIRST —
  // which silently REVERSED the sequence and inverted the tilt maths. It told a
  // chasing player they were "disciplined". Read every shape.
  function whenOf(b) {
    return Number(b && (b.placedAt || b.createdAt || b.ts)) || 0;
  }

  function chron() {
    return snapshot().all
      .filter(function (b) { var s = String(b.status || '').toLowerCase(); return s === 'won' || s === 'lost'; })
      .slice()
      .sort(function (a, b) { return whenOf(a) - whenOf(b); });
  }

  function habits() {
    var seq = chron();
    if (seq.length < 3) return { enough: false, n: seq.length };
    var stakes = seq.map(stakeOf);
    var avg = stakes.reduce(function (t, v) { return t + v; }, 0) / stakes.length;

    // Tilt: how your NEXT stake reacts to a loss vs a win. >1.25 after a loss is
    // chasing — the single most expensive habit in betting.
    var afterLoss = [], afterWin = [];
    for (var i = 1; i < seq.length; i++) {
      var prevLost = String(seq[i - 1].status).toLowerCase() === 'lost';
      (prevLost ? afterLoss : afterWin).push(stakeOf(seq[i]));
    }
    var mean = function (a) { return a.length ? a.reduce(function (t, v) { return t + v; }, 0) / a.length : 0; };
    var mAfterLoss = mean(afterLoss), mAfterWin = mean(afterWin);
    var tilt = mAfterWin > 0 ? mAfterLoss / mAfterWin : 0;

    // Longest losing run — the shape of a bad session.
    var run = 0, worstRun = 0;
    seq.forEach(function (b) {
      if (String(b.status).toLowerCase() === 'lost') { run++; worstRun = Math.max(worstRun, run); }
      else run = 0;
    });

    // When you play (local hour buckets), and how that hour performs.
    var byHour = {};
    seq.forEach(function (b) {
      var h = new Date(whenOf(b) || Date.now()).getHours();
      if (!byHour[h]) byHour[h] = { n: 0, pnl: 0 };
      byHour[h].n += 1;
      byHour[h].pnl += (String(b.status).toLowerCase() === 'won' ? payoutOf(b) : 0) - stakeOf(b);
    });
    var hours = Object.keys(byHour).map(function (h) { return { hour: Number(h), n: byHour[h].n, pnl: byHour[h].pnl }; });
    var busiest = hours.slice().sort(function (a, b) { return b.n - a.n; })[0] || null;
    var worstHour = hours.filter(function (h) { return h.n >= 2; }).sort(function (a, b) { return a.pnl - b.pnl; })[0] || null;

    return {
      enough: true, n: seq.length,
      avgStake: avg, maxStake: Math.max.apply(null, stakes), minStake: Math.min.apply(null, stakes),
      tilt: tilt, stakeAfterLoss: mAfterLoss, stakeAfterWin: mAfterWin,
      worstLosingRun: worstRun, busiest: busiest, worstHour: worstHour
    };
  }

  // Concrete, evidence-backed mistakes — each one names the number behind it.
  function mistakes() {
    var out = [];
    var a = analytics();
    var h = habits();
    var s = snapshot();

    if (h.enough && h.tilt >= 1.25 && h.stakeAfterWin > 0) {
      out.push({
        id: 'tilt',
        text: 'You are chasing. After a loss your next stake averages ' + h.stakeAfterLoss.toFixed(2) +
          ' OST vs ' + h.stakeAfterWin.toFixed(2) + ' after a win — ' + h.tilt.toFixed(1) + 'x bigger. ' +
          'That is the most expensive habit in betting: it sizes up exactly when you are least certain.'
      });
    }
    if (a.yes.n >= 3 && a.no.n >= 3) {
      var weak = a.yes.winRate < a.no.winRate ? a.yes : a.no;
      var weakName = a.yes.winRate < a.no.winRate ? 'YES' : 'NO';
      if (weak.winRate < 45 && weak.pnl < 0) {
        out.push({
          id: 'side-bias',
          text: 'Your ' + weakName + ' side is bleeding: ' + pct(weak.winRate) + ' win rate over ' + weak.n +
            ' tickets for ' + weak.pnl.toFixed(2) + ' OST. You keep taking it anyway.'
        });
      }
    }
    if (s.claimable.length) {
      var owed = s.claimable.reduce(function (t, b) { return t + (num(b, 'payoutIfWin') || payoutOf(b) || stakeOf(b)); }, 0);
      out.push({
        id: 'unclaimed',
        text: 'You have ' + s.claimable.length + ' win(s) sitting unclaimed — ' + ost(owed) + ' you already earned. Say "claim all".'
      });
    }
    if (h.enough && h.worstLosingRun >= 4) {
      out.push({
        id: 'long-run',
        text: 'Your longest losing run is ' + h.worstLosingRun + ' straight. If you are still betting through those, that is where sessions get lost.'
      });
    }
    if (h.enough && h.worstHour && h.worstHour.pnl < 0 && h.worstHour.n >= 2) {
      out.push({
        id: 'bad-hour',
        text: 'Your worst hour is ' + h.worstHour.hour + ':00 — ' + h.worstHour.pnl.toFixed(2) + ' OST across ' + h.worstHour.n + ' tickets.'
      });
    }
    return out;
  }

  // ---- extensibility: anyone can teach the Ghost -------------------------
  // Users, bots, servers and relays register their own skills at runtime. A
  // registered skill is tried BEFORE the built-ins, so you can override anything
  // we ship without forking the file.
  var USER_SKILLS = [];
  var RELAYS = [];

  function register(skill) {
    if (!skill || typeof skill.run !== 'function') throw new Error('a skill needs { test, run }');
    if (!(skill.test instanceof RegExp) && typeof skill.test !== 'function') throw new Error('skill.test must be a RegExp or function');
    var s = {
      id: skill.id || ('user-' + (USER_SKILLS.length + 1)),
      test: skill.test, run: skill.run, source: skill.source || 'user'
    };
    USER_SKILLS.unshift(s);
    try { window.dispatchEvent(new CustomEvent('ost:ghost-skill-registered', { detail: { id: s.id, source: s.source } })); } catch (_) {}
    return s.id;
  }
  function unregister(id) {
    USER_SKILLS = USER_SKILLS.filter(function (s) { return s.id !== id; });
  }

  // Point the Ghost at YOUR bot/server/relay. It gets the question plus the same
  // grounded facts the built-ins use, and whatever it replies is shown. This is
  // how you plug your own model or trading bot into the Ghost without touching
  // our code — pairs with the public bot API (/bot/v1/*).
  function connect(cfg) {
    if (!cfg || !cfg.url) throw new Error('connect({ name, url }) needs a url');
    var r = { name: cfg.name || 'relay', url: String(cfg.url), headers: cfg.headers || {} };
    RELAYS.push(r);
    try { window.dispatchEvent(new CustomEvent('ost:ghost-relay-connected', { detail: { name: r.name, url: r.url } })); } catch (_) {}
    return r.name;
  }
  function askRelays(text) {
    if (!RELAYS.length) return Promise.resolve(null);
    var body = JSON.stringify({ question: text, context: snapshot(), analytics: analytics(), habits: habits() });
    return Promise.all(RELAYS.map(function (r) {
      return fetch(r.url, { method: 'POST', headers: Object.assign({ 'content-type': 'application/json' }, r.headers), body: body })
        .then(function (res) { return res.ok ? res.json() : null; })
        .then(function (j) { return j && (j.reply || j.text) ? { name: r.name, reply: j.reply || j.text } : null; })
        .catch(function () { return null; });
    })).then(function (all) { return all.filter(Boolean)[0] || null; });
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
      id: 'mistakes',
      // "What am I doing wrong?" — answered with evidence, not vibes.
      test: /\b(what am i doing wrong|mistake|wrong|bad habit|tilt|chasing|leak|why am i losing|fix my)\b/i,
      run: function () {
        var m = mistakes();
        if (!m.length) {
          var h = habits();
          return { text: h.enough
            ? 'Nothing obviously broken. No chasing (stake is steady after losses), no dead side, nothing unclaimed. Across ' + h.n + ' settled tickets your average stake is ' + h.avgStake.toFixed(2) + ' OST.'
            : 'Not enough settled tickets yet to call out a habit honestly — I need a few more before I start telling you what you are doing wrong.' };
        }
        return { text: m.map(function (x) { return '• ' + x.text; }).join('\n'), data: m };
      }
    },
    {
      id: 'habits',
      test: /\b(habit|behaviou?r|how do i (bet|play|trade)|my (style|pattern|routine)|when do i)\b/i,
      run: function () {
        var h = habits();
        if (!h.enough) return { text: 'Only ' + h.n + ' settled ticket(s) — too few to describe your habits without making things up. Play a few more.' };
        var lines = [];
        lines.push('Across ' + h.n + ' settled tickets you stake ' + h.avgStake.toFixed(2) + ' OST on average (' + h.minStake.toFixed(2) + '–' + h.maxStake.toFixed(2) + ').');
        if (h.stakeAfterWin > 0) {
          lines.push('After a loss you stake ' + h.stakeAfterLoss.toFixed(2) + ', after a win ' + h.stakeAfterWin.toFixed(2) + ' — ' +
            (h.tilt >= 1.25 ? 'you size UP when losing (' + h.tilt.toFixed(1) + 'x). That is tilt.' :
             h.tilt <= 0.8 ? 'you size DOWN when losing. Disciplined.' : 'steady either way. Disciplined.'));
        }
        if (h.busiest) lines.push('You play most around ' + h.busiest.hour + ':00 (' + h.busiest.n + ' tickets).');
        if (h.worstLosingRun >= 3) lines.push('Longest losing run: ' + h.worstLosingRun + '.');
        return { text: lines.join(' '), data: h };
      }
    },
    {
      id: 'predict',
      // A projection from YOUR numbers, stated as an expectation — never a promise.
      test: /\b(predict|projection|forecast|expect|should i|what.*(my odds|chances)|going to (win|lose))\b/i,
      run: function () {
        var a = analytics();
        var h = habits();
        if (a.settledCount < 5) return { text: 'I would be guessing — only ' + a.settledCount + ' settled ticket(s). Ask me again once there is a real sample; I would rather say nothing than invent a forecast.' };
        var overall = a.settledCount ? ((a.yes.n * a.yes.winRate + a.no.n * a.no.winRate) / a.settledCount) : 0;
        var edgePerTicket = a.netPnl / a.settledCount;
        var lines = [];
        lines.push('On your own record: ' + pct(overall) + ' win rate over ' + a.settledCount + ' tickets, averaging ' +
          (edgePerTicket >= 0 ? '+' : '') + edgePerTicket.toFixed(2) + ' OST per ticket.');
        if (h.enough) {
          var proj = edgePerTicket * 10;
          lines.push('At your current stake, 10 more tickets trend toward ' + (proj >= 0 ? '+' : '') + proj.toFixed(2) + ' OST — that is an expectation from your history, not a promise.');
        }
        if (a.yes.n >= 3 && a.no.n >= 3) {
          var better = a.yes.winRate >= a.no.winRate ? 'YES' : 'NO';
          var bw = Math.max(a.yes.winRate, a.no.winRate);
          lines.push('If you keep taking ' + better + ' you are playing your ' + pct(bw) + ' side.');
        }
        return { text: lines.join(' '), data: { overall: overall, edgePerTicket: edgePerTicket } };
      }
    },
    {
      id: 'integrate',
      // Teach people the Ghost is theirs to extend.
      test: /\b(integrat|plug ?in|my bot|connect.*(bot|server|relay)|api|extend|customi[sz]e|teach you|add.*skill)\b/i,
      run: function () {
        return { text:
          'I am yours to extend — two ways:\n' +
          '• Teach me a skill (runs locally, instantly):\n' +
          '  OST_GHOST_BRAIN.register({ id:"my-skill", test:/my rule/i, run:q => ({ text:"…" }) })\n' +
          '• Plug in your own bot/model/relay — I POST it your question plus your grounded stats and show its reply:\n' +
          '  OST_GHOST_BRAIN.connect({ name:"my-bot", url:"https://my-server/ask" })\n' +
          'Your skills run BEFORE mine, so you can override anything I do. For live market data your bot can use the public API: /bot/v1/markets, /bot/v1/quote/:id, /bot/v1/order, /bot/v1/positions/:wallet.',
          data: { skills: SKILLS.map(function (s) { return s.id; }), relays: RELAYS.map(function (r) { return r.name; }) } };
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

  function matches(skill, q) {
    try {
      return (typeof skill.test === 'function') ? !!skill.test(q) : skill.test.test(q);
    } catch (_) { return false; }
  }

  function ask(text) {
    var q = String(text || '').trim();
    if (!q) return null;
    // YOUR skills first — a user/bot skill can override anything we ship.
    for (var u = 0; u < USER_SKILLS.length; u++) {
      if (matches(USER_SKILLS[u], q)) {
        try {
          var ur = USER_SKILLS[u].run(q);
          if (ur && ur.text) return { text: ur.text, handled: true, skill: USER_SKILLS[u].id, source: USER_SKILLS[u].source, did: ur.did || null, data: ur.data || null };
        } catch (e) {
          try { console.warn('[ghost-brain] user skill ' + USER_SKILLS[u].id + ' failed', e); } catch (_) {}
        }
      }
    }
    var SK = SKILLS;
    for (var i = 0; i < SK.length; i++) {
      if (matches(SK[i], q)) {
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
    ask: ask,                 // grounded answer (or null -> let the model try)
    analytics: analytics,     // your edge, computed
    habits: habits,           // your behaviour, computed
    mistakes: mistakes,       // evidence-backed leaks
    snapshot: snapshot,       // the raw grounded facts
    // --- make it yours -----------------------------------------------------
    register: register,       // teach the Ghost a skill (runs before ours)
    unregister: unregister,
    connect: connect,         // plug in your bot/server/relay
    askRelays: askRelays,     // consult connected relays
    skills: function () {
      return USER_SKILLS.map(function (s) { return { id: s.id, source: s.source }; })
        .concat(SKILLS.map(function (s) { return { id: s.id, source: 'built-in' }; }));
    },
    relays: function () { return RELAYS.map(function (r) { return r.name; }); }
  };
})();

/* ==========================================================================
 * OST · Ghost Companion — a living guide that knows your whole journey
 * --------------------------------------------------------------------------
 * The Ghost is now page-wide and personal:
 *
 *  · It SEES every transaction: credits pool, wallet balance, every bet and
 *    parlay (open/won/lost + live value), game streaks/tier, pending
 *    payouts, treasury revenue — read from the same stores the app uses.
 *  · It FEELS the session: a mood ring (hot/cold/chill) driven by your live
 *    P/L; it celebrates wins, softens losses, and speaks up at the right
 *    moments (throttled, and mutable with one tap).
 *  · It THINKS online: chat runs on Cloudflare Workers AI (Llama 3.3 70B)
 *    through POST /ghost/chat with your live session context — a real bot
 *    living on the internet. When offline it falls back to a local brain
 *    that answers from your data directly, so it is NEVER dead.
 *
 * Privacy: only aggregate session numbers leave the device (balances, P/L,
 * counts, titles of open bets). Never keys, never backups.
 * ========================================================================== */
(function () {
  'use strict';

  var ORDERS_KEY = 'ost.prediction.orders.v1';
  var MUTE_KEY = 'ost.ghost.muted.v1';
  var BUBBLE_COOLDOWN_MS = 45000;

  var sessionPnl = 0;
  var lastBubbleAt = 0;
  var chatLog = [];   // {role, content}
  var orb, panel;

  function apiBase() {
    return (typeof window !== 'undefined' && window.OST_API_BASE)
      ? String(window.OST_API_BASE).replace(/\/$/, '') : '';
  }
  function muted() { try { return localStorage.getItem(MUTE_KEY) === '1'; } catch (_) { return false; } }
  function setMuted(v) { try { localStorage.setItem(MUTE_KEY, v ? '1' : '0'); } catch (_) {} }

  // ------------------------------------------------------------- knowledge
  function readOrders() {
    try { return JSON.parse(localStorage.getItem(ORDERS_KEY) || '[]') || []; } catch (_) { return []; }
  }

  function snapshotContext() {
    var ctx = {};
    try { ctx.credits = Number(((window.OST_MONEY && window.OST_MONEY.get()) || 0).toFixed(2)); } catch (_) {}
    try {
      var wd = document.getElementById('wdOstBal');
      if (wd) ctx.walletOst = parseFloat(wd.textContent) || 0;
    } catch (_) {}
    ctx.sessionPnl = Number(sessionPnl.toFixed(2));
    try {
      var meta = window.OST_GAMES_META && window.OST_GAMES_META.state();
      if (meta) { ctx.streak = meta.streak; ctx.tier = window.OST_GAMES_META.tier().name; ctx.lifetimeWagered = Math.round(meta.lifetimeWagered); }
    } catch (_) {}
    try {
      var orders = readOrders();
      var open = orders.filter(function (o) { return o && (!o.status || o.status === 'open'); });
      var won = orders.filter(function (o) { return o && o.status === 'won'; });
      var lost = orders.filter(function (o) { return o && o.status === 'lost'; });
      ctx.openBets = open.length; ctx.wonBets = won.length; ctx.lostBets = lost.length;
      ctx.openBetTitles = open.slice(-4).map(function (o) { return String(o.title || '').slice(0, 46); });
    } catch (_) {}
    try {
      var slips = (window.OST_PARLAY && window.OST_PARLAY.slips()) || [];
      var openSlips = slips.filter(function (s) { return s.status === 'open'; });
      ctx.openParlays = openSlips.length;
      if (openSlips.length && window.OST_PARLAY.valueOf) {
        ctx.parlayLiveValue = Number(openSlips.reduce(function (s, sl) { return s + window.OST_PARLAY.valueOf(sl); }, 0).toFixed(2));
      }
    } catch (_) {}
    try {
      var rev = window.OST_TREASURY_ENGINE && window.OST_TREASURY_ENGINE.revenue();
      if (rev) ctx.protocolRevenue = Number(rev.total.toFixed(2));
    } catch (_) {}
    try {
      var pend = JSON.parse(localStorage.getItem('ost.payout.pending.v1') || '{}');
      ctx.pendingPayouts = Object.keys(pend || {}).length;
    } catch (_) {}
    return ctx;
  }

  function mood() {
    if (sessionPnl >= 5) return 'hot';
    if (sessionPnl <= -5) return 'cold';
    return 'chill';
  }

  // ------------------------------------------------------------- local brain
  function localAnswer(q) {
    var c = snapshotContext();
    var t = q.toLowerCase();
    if (/balance|how much.*(have|ost)|my money|credits/.test(t)) {
      return 'You have ' + (c.credits || 0).toFixed(2) + ' OST in bonus credits' +
        (c.walletOst ? ' plus ' + c.walletOst.toFixed(2) + ' OST on-chain in your wallet' : '') + '. ' +
        (c.sessionPnl >= 0 ? 'Up ' + c.sessionPnl : 'Down ' + Math.abs(c.sessionPnl)) + ' OST this session.';
    }
    if (/(win|won|los|profit|pnl|doing)/.test(t)) {
      return 'This session you are ' + (c.sessionPnl >= 0 ? 'UP ' + c.sessionPnl : 'DOWN ' + Math.abs(c.sessionPnl)) + ' OST. ' +
        'All-time tickets: ' + (c.wonBets || 0) + ' won, ' + (c.lostBets || 0) + ' lost, ' + (c.openBets || 0) + ' still open.' +
        (c.streak ? ' Current game win streak: x' + c.streak + ' 🔥' : '');
    }
    if (/open bet|my bets|positions|parlay/.test(t)) {
      var lines = 'Open: ' + (c.openBets || 0) + ' bets, ' + (c.openParlays || 0) + ' parlays' +
        (c.parlayLiveValue ? ' (live value ' + c.parlayLiveValue + ' OST — you can sell them in the ⚡ dock)' : '') + '.';
      if (c.openBetTitles && c.openBetTitles.length) lines += ' Latest: ' + c.openBetTitles.join(' · ');
      return lines;
    }
    if (/claim|payout|pending/.test(t)) {
      return (c.pendingPayouts ? 'You have ' + c.pendingPayouts + ' pending payout(s) — big wins settle in stages to keep the shared vault solvent for everyone. They pay as the vault refills. '
        : 'No pending payouts. ') + 'Wins show a Claim button in My OST Bets and in the wallet ledger.';
    }
    if (/streak|tier|rakeback|level/.test(t)) {
      return 'You are a ' + (c.tier || 'Bronze') + ' player, streak x' + (c.streak || 0) + ', lifetime wagered ' + (c.lifetimeWagered || 0) + ' OST. Rakeback pays automatically at 5 OST.';
    }
    if (/what.*(parlay|combo)/.test(t)) {
      return 'A parlay combines 2–6 picks; the odds multiply and every leg must win. Add legs with the ⚡ YES/NO chips on any market card, then sell anytime at live value from the dock.';
    }
    if (/faucet|free ost/.test(t)) {
      return 'The faucet gives free devnet OST daily, and you earn more in the arcade, Code Academy lessons, streak bonuses and the daily gift in the 🔥 badge.';
    }
    return null;
  }

  // ------------------------------------------------------------- online brain
  function askAI(text) {
    var base = apiBase();
    chatLog.push({ role: 'user', content: text });
    if (chatLog.length > 10) chatLog = chatLog.slice(-10);
    if (!base) return Promise.resolve(null);
    return fetch(base + '/ghost/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: chatLog.slice(-6), context: snapshotContext() })
    }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (d && d.ok && d.reply) {
          chatLog.push({ role: 'assistant', content: d.reply });
          return d.reply;
        }
        return null;
      }).catch(function () { return null; });
  }

  // ------------------------------------------------------------- UI
  function injectStyles() {
    if (document.getElementById('ostGhostCompStyle')) return;
    var st = document.createElement('style');
    st.id = 'ostGhostCompStyle';
    st.textContent =
      '#ostGhostOrb{position:fixed;left:14px;bottom:64px;z-index:9991;width:46px;height:46px;border-radius:50%;border:none;' +
      'cursor:pointer;font-size:24px;display:flex;align-items:center;justify-content:center;' +
      'background:radial-gradient(circle at 35% 30%,#2a3352,#12172b);box-shadow:0 6px 24px rgba(0,0,0,0.5),0 0 18px var(--ghost-glow,rgba(148,163,184,0.35));' +
      'animation:ogFloat 3.4s ease-in-out infinite;transition:box-shadow .5s;}' +
      '@keyframes ogFloat{0%,100%{transform:translateY(0);}50%{transform:translateY(-6px);}}' +
      '#ostGhostOrb.mood-hot{--ghost-glow:rgba(52,211,153,0.7);}' +
      '#ostGhostOrb.mood-cold{--ghost-glow:rgba(125,211,252,0.6);}' +
      '#ostGhostOrb.mood-chill{--ghost-glow:rgba(167,139,250,0.5);}' +
      '.og-bubble{position:fixed;left:14px;bottom:118px;z-index:9991;max-width:250px;background:rgba(14,18,32,0.97);' +
      'border:1px solid rgba(167,139,250,0.4);border-radius:14px 14px 14px 4px;padding:10px 13px;color:#e2e8f0;' +
      'font-size:12.5px;line-height:1.45;box-shadow:0 10px 34px rgba(0,0,0,0.55);animation:ogBubbleIn .3s ease;cursor:pointer;}' +
      '@keyframes ogBubbleIn{from{opacity:0;transform:translateY(8px);}to{opacity:1;transform:translateY(0);}}' +
      '#ostGhostPanel{position:fixed;left:12px;bottom:64px;z-index:10040;width:min(340px,calc(100vw - 24px));height:min(480px,70vh);' +
      'background:linear-gradient(170deg,#131a2e,#0a0e1c);border:1px solid rgba(167,139,250,0.4);border-radius:18px;' +
      'box-shadow:0 18px 60px rgba(0,0,0,0.65);display:none;flex-direction:column;overflow:hidden;}' +
      '#ostGhostPanel.is-open{display:flex;}' +
      '.og-head{display:flex;align-items:center;gap:9px;padding:11px 14px;background:rgba(167,139,250,0.10);border-bottom:1px solid rgba(255,255,255,0.07);}' +
      '.og-head-title{font-weight:900;color:#e9d5ff;flex:1;}' +
      '.og-head button{background:transparent;border:none;color:#94a3b8;cursor:pointer;font-size:15px;}' +
      '.og-mood{font-size:10px;font-weight:800;padding:2px 8px;border-radius:999px;}' +
      '.og-mood.hot{background:rgba(52,211,153,0.18);color:#7ce6a8;}' +
      '.og-mood.cold{background:rgba(125,211,252,0.16);color:#7dd3fc;}' +
      '.og-mood.chill{background:rgba(167,139,250,0.16);color:#c4b5fd;}' +
      '.og-msgs{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px;}' +
      '.og-msg{max-width:86%;padding:8px 12px;border-radius:12px;font-size:12.5px;line-height:1.5;white-space:pre-wrap;}' +
      '.og-msg.user{align-self:flex-end;background:rgba(109,159,255,0.18);border:1px solid rgba(109,159,255,0.3);color:#dbeafe;border-radius:12px 12px 4px 12px;}' +
      '.og-msg.ghost{align-self:flex-start;background:rgba(255,255,255,0.05);border:1px solid rgba(167,139,250,0.25);color:#e2e8f0;border-radius:12px 12px 12px 4px;}' +
      '.og-msg.typing{color:#94a3b8;font-style:italic;}' +
      '.og-quick{display:flex;gap:5px;flex-wrap:wrap;padding:0 12px 8px;}' +
      '.og-quick button{border:1px solid rgba(167,139,250,0.35);background:transparent;color:#c4b5fd;border-radius:999px;padding:4px 10px;font-size:10.5px;font-weight:700;cursor:pointer;}' +
      '.og-input{display:flex;gap:7px;padding:10px 12px;border-top:1px solid rgba(255,255,255,0.07);}' +
      '.og-input input{flex:1;background:rgba(0,0,0,0.4);border:1px solid rgba(167,139,250,0.35);border-radius:11px;color:#f8fafc;padding:9px 12px;font-size:13px;}' +
      '.og-input button{background:linear-gradient(135deg,#a78bfa,#7c3aed);color:#fff;border:none;border-radius:11px;padding:0 15px;font-weight:900;cursor:pointer;}' +
      '@media (max-width:640px){#ostGhostOrb{left:auto;right:10px;bottom:16px;width:42px;height:42px;}' +
      '.og-bubble{left:auto;right:10px;bottom:66px;}' +
      '#ostGhostPanel{left:8px;right:8px;width:auto;bottom:8px;height:min(520px,78vh);}}';
    document.head.appendChild(st);
  }

  function setMood() {
    if (!orb) return;
    orb.classList.remove('mood-hot', 'mood-cold', 'mood-chill');
    orb.classList.add('mood-' + mood());
    var badge = panel && panel.querySelector('.og-mood');
    if (badge) {
      badge.className = 'og-mood ' + mood();
      badge.textContent = mood() === 'hot' ? '🔥 running hot' : mood() === 'cold' ? '🧊 rough patch' : '✨ cruising';
    }
  }

  function bubble(text, opts) {
    if (muted() && !(opts && opts.force)) return;
    var now = Date.now();
    if (!(opts && opts.force) && now - lastBubbleAt < BUBBLE_COOLDOWN_MS) return;
    lastBubbleAt = now;
    var old = document.querySelector('.og-bubble');
    if (old) old.remove();
    var b = document.createElement('div');
    b.className = 'og-bubble';
    b.textContent = text;
    b.addEventListener('click', function () { b.remove(); openPanel(); });
    document.body.appendChild(b);
    setTimeout(function () { b.remove(); }, 9000);
  }

  function addMsg(role, text) {
    var box = panel.querySelector('.og-msgs');
    var m = document.createElement('div');
    m.className = 'og-msg ' + role;
    m.textContent = text;
    box.appendChild(m);
    box.scrollTop = box.scrollHeight;
    return m;
  }

  function handleAsk(text) {
    if (!text) return;
    addMsg('user', text);
    var input = panel.querySelector('.og-input input');
    if (input) input.value = '';
    // ---- GROUNDED FIRST -----------------------------------------------------
    // Anything about YOUR ledger is answered by the brain, from your own records,
    // instantly and offline. This used to run the other way round — `if (aiReply)`
    // won over the local answer — so "what's my balance?" waited on a network
    // round-trip to a 70B model that has to be TOLD your numbers and can still
    // hallucinate them. A model must never be allowed to guess a figure we can
    // compute. The brain also ACTS (claim all, affordability), which no model can.
    var grounded = null;
    try {
      if (window.OST_GHOST_BRAIN && typeof window.OST_GHOST_BRAIN.ask === 'function') {
        grounded = window.OST_GHOST_BRAIN.ask(text);
      }
    } catch (_) {}
    if (grounded && grounded.text) {
      addMsg('ghost', grounded.text);
      return;   // authoritative — no network, no guessing
    }

    // ---- otherwise: open-ended chat, model + local fallback ------------------
    var typing = addMsg('ghost typing', '…thinking');
    var local = localAnswer(text);
    askAI(text).then(function (aiReply) {
      typing.remove();
      if (aiReply) addMsg('ghost', aiReply);
      else if (local) addMsg('ghost', local);
      else addMsg('ghost', 'I could not reach my online brain and that one is beyond my local knowledge. Try asking about your balance, bets, edge, or say "claim all".');
    });
  }

  function buildPanel() {
    panel = document.createElement('div');
    panel.id = 'ostGhostPanel';
    panel.innerHTML =
      '<div class="og-head">' +
        '<span style="font-size:19px;">👻</span>' +
        '<span class="og-head-title">OST Ghost</span>' +
        '<span class="og-mood chill">✨ cruising</span>' +
        '<button type="button" data-og-mute title="Mute proactive messages">' + (muted() ? '🔕' : '🔔') + '</button>' +
        '<button type="button" data-og-close>✕</button>' +
      '</div>' +
      '<div class="og-msgs"></div>' +
      '<div class="og-quick">' +
        '<button data-og-q="How am I doing today?">How am I doing?</button>' +
        '<button data-og-q="What are my open bets and parlays?">My open bets</button>' +
        '<button data-og-q="What is my balance?">Balance</button>' +
        '<button data-og-q="Explain how parlays work">Parlays?</button>' +
      '</div>' +
      '<div class="og-input">' +
        '<input type="text" placeholder="Ask me anything about your OST…" maxlength="300">' +
        '<button type="button" data-og-send>➤</button>' +
      '</div>';
    document.body.appendChild(panel);
    panel.querySelector('[data-og-close]').addEventListener('click', function () { panel.classList.remove('is-open'); });
    panel.querySelector('[data-og-mute]').addEventListener('click', function (e) {
      setMuted(!muted());
      e.currentTarget.textContent = muted() ? '🔕' : '🔔';
    });
    panel.querySelector('[data-og-send]').addEventListener('click', function () {
      handleAsk(panel.querySelector('.og-input input').value.trim());
    });
    panel.querySelector('.og-input input').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') handleAsk(e.currentTarget.value.trim());
    });
    panel.querySelector('.og-quick').addEventListener('click', function (e) {
      var q = e.target.closest('[data-og-q]');
      if (q) handleAsk(q.getAttribute('data-og-q'));
    });
  }

  function openPanel() {
    if (!panel) buildPanel();
    panel.classList.add('is-open');
    setMood();
    var box = panel.querySelector('.og-msgs');
    if (!box.children.length) {
      var c = snapshotContext();
      addMsg('ghost', 'Hey, I am your OST Ghost 👻 — I can see your whole journey here: ' +
        (c.credits || 0).toFixed(2) + ' OST credits, ' + (c.openBets || 0) + ' open bets, ' + (c.openParlays || 0) + ' live parlays. ' +
        'Ask me anything, or tap a quick question below.');
    }
  }

  // ------------------------------------------------------------- reactions
  function wireReactions() {
    window.addEventListener('ost-faucet-hub-award', function (e) {
      var d = (e && e.detail) || {};
      var amt = Number(d.credits || 0);
      if (amt <= 0) return;
      sessionPnl += amt;
      setMood();
      if (/parlay-win/.test(String(d.source))) bubble('👻 THAT PARLAY HIT! +' + amt.toFixed(2) + ' OST. I saw every leg land.');
      else if (amt >= 20) bubble('👻 Big one! +' + amt.toFixed(2) + ' OST just landed. Session: ' + (sessionPnl >= 0 ? '+' : '') + sessionPnl.toFixed(1) + ' OST.');
    }, false);
    window.addEventListener('ost:game-wager', function (e) {
      sessionPnl -= Number((e && e.detail && e.detail.amount) || 0);
      setMood();
      if (sessionPnl <= -25) bubble('👻 We are down ' + Math.abs(sessionPnl).toFixed(0) + ' OST this session. No shame in a breather — the 5-min rounds will still be here.', {});
    }, false);
    window.addEventListener('ost-money-changed', function (e) {
      var d = (e && e.detail) || {};
      if (Number(d.delta) < 0 && /parlay|prediction/.test(String(d.source || ''))) { sessionPnl += Number(d.delta); setMood(); }
    }, false);
    window.addEventListener('ost:parlay-won', function () { setMood(); }, false);
    window.addEventListener('ost:data-recovered', function (e) {
      var keys = (e && e.detail && e.detail.keys) || [];
      bubble('👻 Heads up — I restored ' + keys.length + ' of your data stores from backup after finding corruption. Everything is safe.', { force: true });
    }, false);
  }

  // ------------------------------------------------------------- boot
  function boot() {
    injectStyles();
    orb = document.createElement('button');
    orb.id = 'ostGhostOrb';
    orb.type = 'button';
    orb.title = 'OST Ghost — your companion. It knows your journey and answers anything.';
    orb.textContent = '👻';
    orb.className = 'mood-chill';
    orb.addEventListener('click', function () {
      if (panel && panel.classList.contains('is-open')) panel.classList.remove('is-open');
      else openPanel();
    });
    document.body.appendChild(orb);
    wireReactions();
    setMood();
    if (!muted()) setTimeout(function () {
      bubble('👻 I am awake — tap me anytime. I can see your balance, every bet, and I answer questions.');
    }, 6000);
  }

  window.OST_GHOST_COMPANION = {
    open: openPanel,
    ask: handleAsk,
    context: snapshotContext,
    mood: mood
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 2000); });
  else setTimeout(boot, 2000);
})();

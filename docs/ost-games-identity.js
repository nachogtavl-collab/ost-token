/* ==========================================================================
 * OST · Games Identity — every game looks, speaks and feels like ITSELF
 * --------------------------------------------------------------------------
 * The 18 games shared one scaffold: identical controls row, identical grey
 * buttons, "Place bet" everywhere — hence the "copy-paste" complaint.
 * This module gives each game its own personality at the moment it renders:
 *
 *  · THEME    — per-game accent palette + a giant motif watermark, applied
 *               as CSS variables on the game's stage node.
 *  · LANGUAGE — the primary action says what YOU DO in this game
 *               ("⛏ Dig", "🚀 Launch", "🎲 Roll under", "🃏 Deal"…),
 *               not a generic "Place bet".
 *  · HIERARCHY— one hero action button; secondary buttons become quiet
 *               ghosts; the cash-out button only shouts when it's alive.
 *  · JUICE    — stage arms with a pulse when a bet starts, erupts with a
 *               glow + rising payout text when a win lands.
 *
 * Detection is a MutationObserver on `.ostg-game` renders, so it covers
 * every game — including ones added later — with zero edits to the 3,800-
 * line games engine.
 * ========================================================================== */
(function () {
  'use strict';

  var THEMES = {
    mines:      { a: '#34d399', b: '#f59e0b', motif: '💣', verb: '⛏ Start digging',  cash: '💰 Take the gold' },
    crash:      { a: '#f97316', b: '#facc15', motif: '🚀', verb: '🚀 Launch',          cash: '🪂 Eject now' },
    dice:       { a: '#38bdf8', b: '#a78bfa', motif: '🎲', verb: '🎲 Roll it' },
    plinko:     { a: '#a78bfa', b: '#f472b6', motif: '🔻', verb: '🔻 Drop balls' },
    limbo:      { a: '#f472b6', b: '#38bdf8', motif: '🎯', verb: '🎯 Take the shot' },
    hilo:       { a: '#facc15', b: '#34d399', motif: '🃏', verb: '🃏 Deal me in',      cash: '💰 Bank the streak' },
    wheel:      { a: '#22c55e', b: '#f97316', motif: '🎡', verb: '🎡 Spin the wheel' },
    coin:       { a: '#f5c468', b: '#94a3b8', motif: '🪙', verb: '🪙 Flip it' },
    keno:       { a: '#6d9fff', b: '#34d399', motif: '🔢', verb: '🎱 Draw numbers' },
    tower:      { a: '#fb7185', b: '#facc15', motif: '🗼', verb: '🧗 Start the climb', cash: '💰 Descend with loot' },
    dragontower:{ a: '#f97316', b: '#22c55e', motif: '🐉', verb: '🐉 Enter the tower',  cash: '💰 Descend with loot' },
    roulette:   { a: '#ef4444', b: '#22c55e', motif: '🎰', verb: '🎡 Spin the strip' },
    slots:      { a: '#fde047', b: '#f472b6', motif: '🍒', verb: '🍒 Pull the lever' },
    blackjack:  { a: '#22c55e', b: '#f8fafc', motif: '🂡', verb: '🃏 Deal' },
    baccarat:   { a: '#a78bfa', b: '#f5c468', motif: '🎴', verb: '🎴 Deal the coup' },
    videopoker: { a: '#38bdf8', b: '#fde047', motif: '🃏', verb: '🃏 Deal five' },
    scratch:    { a: '#f472b6', b: '#a78bfa', motif: '🎟', verb: '🎟 Buy a ticket' },
    penalty:    { a: '#22c55e', b: '#f8fafc', motif: '⚽', verb: '⚽ Take the kick' },
    world:      { a: '#6d9fff', b: '#34d399', motif: '🌍', verb: '🌍 Play the world' }
  };

  // primary/secondary/cash button ids per game (from the engine's markup)
  var PRIMARY = {
    mines: '#mnStart', crash: '#crStart', dice: '#dcRoll', plinko: '#plDrop',
    limbo: '#lbRoll', hilo: '#hlStart', wheel: '#whSpin', coin: '#cfDisk',
    keno: '#knDraw', tower: '#twStart', roulette: '#rtSpin', slots: '#slSpin',
    blackjack: '#bjDeal', baccarat: '#baDeal', videopoker: '#vpDeal',
    penalty: '#pnBall', dragontower: '#dtStart'
  };
  var CASH = { mines: '#mnCash', crash: '#crCash', hilo: '#hlCash', tower: '#twCash', dragontower: '#dtCash' };

  function injectStyles() {
    if (document.getElementById('ostGamesIdentityStyle')) return;
    var st = document.createElement('style');
    st.id = 'ostGamesIdentityStyle';
    st.textContent =
      /* themed stage */
      '.ostg-game.has-identity{position:relative;border-radius:16px;overflow:hidden;' +
      'background:linear-gradient(168deg,color-mix(in srgb,var(--g-a) 9%,#0a0e1c),#080b15 70%)!important;' +
      'border:1px solid color-mix(in srgb,var(--g-a) 38%,transparent);padding:14px;}' +
      '.ostg-game.has-identity::before{content:var(--g-motif);position:absolute;right:-14px;bottom:-24px;' +
      'font-size:130px;opacity:0.055;pointer-events:none;line-height:1;filter:grayscale(0.2);}' +
      /* one hero action */
      '.ostg-game.has-identity .ostg-btn-primary{' +
      'background:linear-gradient(135deg,var(--g-a),var(--g-b))!important;color:#0c0f18!important;border:none!important;' +
      'font-weight:900!important;font-size:14px!important;padding:12px 20px!important;border-radius:12px!important;' +
      'letter-spacing:.02em;box-shadow:0 6px 24px color-mix(in srgb,var(--g-a) 40%,transparent);' +
      'transition:transform .12s,box-shadow .12s;}' +
      '.ostg-game.has-identity .ostg-btn-primary:hover{transform:translateY(-2px);' +
      'box-shadow:0 10px 32px color-mix(in srgb,var(--g-a) 55%,transparent);}' +
      '.ostg-game.has-identity .ostg-btn-primary:disabled{opacity:.4;transform:none;box-shadow:none;}' +
      /* secondary buttons: quiet ghosts until needed */
      '.ostg-game.has-identity .ostg-btn:not(.ostg-btn-primary):not(.ostg-btn-cash){' +
      'background:transparent!important;border:1px solid rgba(255,255,255,0.13)!important;color:#8ea3c7!important;' +
      'font-size:11.5px!important;padding:8px 12px!important;border-radius:9px!important;}' +
      '.ostg-game.has-identity .ostg-btn:not(.ostg-btn-primary):not(.ostg-btn-cash):hover{' +
      'border-color:color-mix(in srgb,var(--g-a) 60%,transparent)!important;color:var(--g-a)!important;}' +
      /* cash-out: dead quiet when disabled, alive when armed */
      '.ostg-game.has-identity .ostg-btn-cash{border-radius:12px!important;font-weight:900!important;' +
      'padding:12px 18px!important;transition:all .2s;}' +
      '.ostg-game.has-identity .ostg-btn-cash:disabled{background:rgba(255,255,255,0.04)!important;' +
      'border:1px dashed rgba(255,255,255,0.14)!important;color:#475569!important;}' +
      '.ostg-game.has-identity .ostg-btn-cash:not(:disabled){' +
      'background:linear-gradient(135deg,#f5c468,#f59e0b)!important;color:#141414!important;border:none!important;' +
      'animation:ogiCashPulse 1.6s infinite;}' +
      '@keyframes ogiCashPulse{0%,100%{box-shadow:0 0 0 0 rgba(245,196,104,0.5);}50%{box-shadow:0 0 0 9px rgba(245,196,104,0);}}' +
      /* juice */
      '.ostg-game.is-armed{animation:ogiArm .5s ease;}' +
      '@keyframes ogiArm{0%{transform:scale(1);}35%{transform:scale(1.012);box-shadow:inset 0 0 0 2px color-mix(in srgb,var(--g-a) 70%,transparent);}100%{transform:scale(1);}}' +
      '.ostg-game.is-winning{animation:ogiWin 1.1s ease;}' +
      '@keyframes ogiWin{0%{box-shadow:none;}25%{box-shadow:inset 0 0 60px color-mix(in srgb,var(--g-a) 30%,transparent),0 0 44px color-mix(in srgb,var(--g-a) 45%,transparent);}100%{box-shadow:none;}}' +
      '.ogi-float{position:absolute;left:50%;top:38%;transform:translateX(-50%);z-index:60;font-size:26px;font-weight:900;' +
      'color:var(--g-a,#7ce6a8);text-shadow:0 0 22px color-mix(in srgb,var(--g-a,#34d399) 70%,transparent);pointer-events:none;' +
      'animation:ogiFloat 1.5s ease forwards;}' +
      '@keyframes ogiFloat{0%{opacity:0;transform:translate(-50%,12px) scale(.8);}20%{opacity:1;transform:translate(-50%,0) scale(1.06);}80%{opacity:1;}100%{opacity:0;transform:translate(-50%,-34px) scale(1);}}' +
      /* controls row: calmer, aligned */
      '.ostg-game.has-identity .ostg-controls{gap:10px;align-items:end;}' +
      '.ostg-game.has-identity .ostg-controls label{font-size:10.5px;color:#8ea3c7;font-weight:700;letter-spacing:.04em;}' +
      '.ostg-game.has-identity .ostg-controls input{border-radius:10px;border:1px solid color-mix(in srgb,var(--g-a) 35%,transparent);}';
    document.head.appendChild(st);
  }

  var currentGame = null;
  var currentStage = null;

  function gameFromNode(node) {
    var m = /ostg-game\s+ostg-([a-z]+)/.exec(node.className || '');
    return m ? m[1] : null;
  }

  function applyIdentity(node) {
    var game = gameFromNode(node);
    if (!game || node.classList.contains('has-identity')) return;
    var t = THEMES[game] || { a: '#6d9fff', b: '#a78bfa', motif: '🎮' };
    node.classList.add('has-identity');
    node.style.setProperty('--g-a', t.a);
    node.style.setProperty('--g-b', t.b);
    node.style.setProperty('--g-motif', '"' + (t.motif || '🎮') + '"');
    currentGame = game;
    currentStage = node;
    // The game's own verb on the hero button
    if (t.verb && PRIMARY[game]) {
      var btn = node.querySelector(PRIMARY[game]);
      if (btn) btn.textContent = t.verb;
    }
    if (t.cash && CASH[game]) {
      var cash = node.querySelector(CASH[game]);
      if (cash) cash.textContent = t.cash;
    }
  }

  // ------------------------------------------------------------- juice
  var IGNORED = /^(streak-bonus|daily-bonus|rakeback|parlay|prediction|ost-money|academy|faucet)/;

  function onWager() {
    if (!currentStage || !document.body.contains(currentStage)) return;
    currentStage.classList.remove('is-armed');
    void currentStage.offsetWidth;
    currentStage.classList.add('is-armed');
  }

  function onAward(e) {
    var d = e.detail || {};
    if (IGNORED.test(String(d.source || ''))) return;
    var amount = Number(d.credits || 0);
    if (!(amount > 0) || !currentStage || !document.body.contains(currentStage)) return;
    currentStage.classList.remove('is-winning');
    void currentStage.offsetWidth;
    currentStage.classList.add('is-winning');
    var f = document.createElement('div');
    f.className = 'ogi-float';
    f.textContent = '+' + amount.toFixed(2) + ' OST';
    currentStage.appendChild(f);
    setTimeout(function () { f.remove(); }, 1600);
  }

  // ------------------------------------------------------------- boot
  function scan(rootNode) {
    (rootNode.querySelectorAll ? rootNode.querySelectorAll('.ostg-game') : []).forEach ?
      rootNode.querySelectorAll('.ostg-game').forEach(applyIdentity) : null;
    if (rootNode.classList && rootNode.classList.contains('ostg-game')) applyIdentity(rootNode);
  }

  function boot() {
    injectStyles();
    document.querySelectorAll('.ostg-game').forEach(applyIdentity);
    var mo = new MutationObserver(function (muts) {
      muts.forEach(function (m) {
        for (var i = 0; i < m.addedNodes.length; i++) {
          var n = m.addedNodes[i];
          if (n instanceof HTMLElement) scan(n);
        }
      });
    });
    mo.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('ost:game-wager', onWager, false);
    window.addEventListener('ost-faucet-hub-award', onAward, false);
  }

  window.OST_GAMES_IDENTITY = { themes: THEMES, apply: applyIdentity };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();

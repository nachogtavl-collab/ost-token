/* ==========================================================================
 * OST · Rainbet-style provably-fair mini-games
 * --------------------------------------------------------------------------
 * Replaces the old single-mini-game faucet model with a small casino-style
 * suite. All games:
 *   - Use the SAME bonus-credit balance from `ost.faucet.hub.v2` (so they
 *     plug into the existing cash-out → real on-chain OST flow).
 *   - Are provably fair: client seed + server seed (per-session pseudo-random
 *     hashed reveal, so the user can verify the outcome wasn't tampered).
 *   - Visualise risk with multipliers, exactly like Stake/Rainbet.
 *
 * Games shipped:
 *   • Mines      — 5×5 grid, place N mines, reveal safe tiles, cash out
 *   • Crash      — multiplier rises until it crashes, you cash out before
 *   • Dice       — roll 0-100, pick over/under target, multiplier ↑ as risk ↑
 *   • Plinko     — 8/12/16-row pegboard with low/medium/high risk profiles
 *
 * Mounts a card panel inside the existing #ostFaucetHub section.
 * ========================================================================== */
(function () {
  'use strict';

  var STATE_KEY = 'ost.faucet.hub.v2';   // share balance with faucet-hub
  var GAMES_STATE_KEY = 'ost.games.v1';

  function loadBank() { try { return JSON.parse(localStorage.getItem(STATE_KEY) || '{}'); } catch (_) { return {}; } }
  function saveBank(s) { try { localStorage.setItem(STATE_KEY, JSON.stringify(s)); } catch (_) {} }
  function loadGames() { try { return JSON.parse(localStorage.getItem(GAMES_STATE_KEY) || '{}'); } catch (_) { return {}; } }
  function saveGames(s) { try { localStorage.setItem(GAMES_STATE_KEY, JSON.stringify(s)); } catch (_) {} }

  function fmt(n) { return Number(n || 0).toFixed(2); }

  function getBalance() { return Number(loadBank().credits || 0); }
  function debit(amount) {
    var s = loadBank();
    var bal = Number(s.credits || 0);
    if (amount > bal + 1e-9) return false;
    s.credits = Math.max(0, bal - amount);
    saveBank(s);
    fireBalanceChange();
    return true;
  }
  function credit(amount, source) {
    var s = loadBank();
    s.credits = Number(s.credits || 0) + Number(amount || 0);
    s.lifetime = Number(s.lifetime || 0) + Number(amount || 0);
    saveBank(s);
    fireBalanceChange();
    try { window.dispatchEvent(new CustomEvent('ost-faucet-hub-award', { detail: { credits: amount, source: source || 'game', total: s.credits }})); } catch (_) {}
  }
  function fireBalanceChange() {
    document.querySelectorAll('[data-ostg-balance]').forEach(function (el) {
      el.textContent = fmt(getBalance());
    });
    var hub = document.getElementById('fhCredits');
    if (hub) hub.textContent = fmt(getBalance());
  }

  // ────────────────────────────────────────────────────────────────────────
  // Provably-fair RNG  (HMAC-SHA256 chunked into 32-bit values, then mapped)
  // Server seed is generated client-side per session and revealed when the
  // player asks; client seed is editable so the user can prove independence.
  // ────────────────────────────────────────────────────────────────────────
  var pf = {
    serverSeed: null,
    serverSeedHash: null,
    clientSeed: null,
    nonce: 0
  };

  async function sha256Hex(text) {
    var enc = new TextEncoder().encode(text);
    var buf = await crypto.subtle.digest('SHA-256', enc);
    return [].map.call(new Uint8Array(buf), function (b) { return b.toString(16).padStart(2, '0'); }).join('');
  }
  async function hmacSha256Hex(key, message) {
    var k = await crypto.subtle.importKey('raw', new TextEncoder().encode(key),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    var sig = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(message));
    return [].map.call(new Uint8Array(sig), function (b) { return b.toString(16).padStart(2, '0'); }).join('');
  }
  function randomHex(bytes) {
    var b = new Uint8Array(bytes);
    crypto.getRandomValues(b);
    return [].map.call(b, function (x) { return x.toString(16).padStart(2, '0'); }).join('');
  }
  async function rotateServerSeed() {
    pf.serverSeed = randomHex(32);
    pf.serverSeedHash = await sha256Hex(pf.serverSeed);
    pf.nonce = 0;
    var s = loadGames();
    s.serverSeedHash = pf.serverSeedHash;
    saveGames(s);
  }
  async function ensureSeeds() {
    if (!pf.serverSeed) await rotateServerSeed();
    if (!pf.clientSeed) pf.clientSeed = (loadGames().clientSeed || ('ost-' + randomHex(8)));
    var s = loadGames();
    s.clientSeed = pf.clientSeed;
    saveGames(s);
  }
  // Returns an async generator of floats in [0,1) for the current bet.
  async function pfFloats(count) {
    await ensureSeeds();
    pf.nonce += 1;
    var msg = pf.clientSeed + ':' + pf.nonce + ':0';
    var hex = await hmacSha256Hex(pf.serverSeed, msg);
    var floats = [];
    var idx = 0;
    while (floats.length < count && idx + 8 <= hex.length) {
      var slice = hex.substr(idx, 8); idx += 8;
      floats.push(parseInt(slice, 16) / 4294967296);
    }
    // If we need more than 8 floats, hash again with extended message
    var round = 1;
    while (floats.length < count) {
      hex = await hmacSha256Hex(pf.serverSeed, msg + ':' + round); round++;
      idx = 0;
      while (floats.length < count && idx + 8 <= hex.length) {
        floats.push(parseInt(hex.substr(idx, 8), 16) / 4294967296);
        idx += 8;
      }
    }
    return floats;
  }

  // ────────────────────────────────────────────────────────────────────────
  // Mount panel — appended after the existing faucet hub grid
  // ────────────────────────────────────────────────────────────────────────
  var TEMPLATE =
    '<div class="container">' +
      '<div class="ostg-section" id="ostGames">' +
        '<div class="ostg-head">' +
          '<div>' +
            '<h3>🎲 Provably-Fair OST Games</h3>' +
            '<p class="ostg-sub">Bet your earned bonus OST. Every outcome is HMAC-SHA256 of <code>serverSeed</code>+<code>clientSeed</code>+<code>nonce</code>. Verifiable. Same engine model as Stake/Rainbet.</p>' +
          '</div>' +
          '<div class="ostg-balance-card">' +
            '<span class="ostg-balance-label">Bonus balance</span>' +
            '<span class="ostg-balance-amt"><strong data-ostg-balance>0.00</strong> OST</span>' +
            '<div class="ostg-balance-actions">' +
              '<button class="ostg-cash-btn" id="ostgCashBtn" type="button" title="Send earned OST to your real wallet">💸 Cash out</button>' +
              '<button class="ostg-fair-btn" id="ostgFairBtn" type="button">🔐 Fairness</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="ostg-tabs" id="ostgTabs">' +
          '<button class="ostg-tab is-active" data-game="mines">💣 Mines</button>' +
          '<button class="ostg-tab" data-game="crash">🚀 Crash</button>' +
          '<button class="ostg-tab" data-game="dice">🎲 Dice</button>' +
          '<button class="ostg-tab" data-game="plinko">🟡 Plinko</button>' +
          '<button class="ostg-tab" data-game="limbo">🌙 Limbo</button>' +
          '<button class="ostg-tab" data-game="hilo">🃏 Hi-Lo</button>' +
          '<button class="ostg-tab" data-game="wheel">🎡 Wheel</button>' +
          '<button class="ostg-tab" data-game="coinflip">🪙 Coinflip</button>' +
        '</div>' +
        '<div class="ostg-stage" id="ostgStage"></div>' +
        '<div class="ostg-history" id="ostgHistory"><span class="ostg-history-label">Recent multipliers:</span></div>' +
      '</div>' +
    '</div>';

  function mount() {
    if (document.getElementById('ostGames')) return;
    var anchor = document.getElementById('ostFaucetHubSection') || document.getElementById('faucetSection');
    if (!anchor) { setTimeout(mount, 400); return; }
    injectStyles();
    var wrap = document.createElement('section');
    wrap.id = 'ostGamesSection';
    wrap.className = 'section';
    wrap.style.padding = '20px 0 40px';
    wrap.innerHTML = TEMPLATE;
    anchor.parentElement.insertBefore(wrap, anchor.nextSibling);
    fireBalanceChange();
    bindTabs();
    showGame('mines');
    document.getElementById('ostgFairBtn').addEventListener('click', openFairness);
    var cashBtn = document.getElementById('ostgCashBtn');
    if (cashBtn) {
      cashBtn.addEventListener('click', function () {
        // Re-use the faucet-hub cashout flow (same balance, same on-chain vault).
        var hubBtn = document.getElementById('fhCashout');
        if (hubBtn) { hubBtn.click(); return; }
        // Fallback: scroll to faucet vault if hub not loaded yet.
        var vault = document.getElementById('ostFaucetHub');
        if (vault) vault.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      var sync = function () {
        var bal = getBalance();
        cashBtn.disabled = bal < 1;
        cashBtn.title = bal < 1 ? 'Need at least 1 OST to cash out' : 'Cash out ' + fmt(bal) + ' OST to your wallet';
      };
      sync();
      window.addEventListener('storage', sync);
      setInterval(sync, 1500);
    }
  }

  function bindTabs() {
    document.querySelectorAll('#ostgTabs .ostg-tab').forEach(function (b) {
      b.addEventListener('click', function () {
        document.querySelectorAll('#ostgTabs .ostg-tab').forEach(function (x) { x.classList.remove('is-active'); });
        b.classList.add('is-active');
        showGame(b.dataset.game);
      });
    });
  }

  function showGame(game) {
    var stage = document.getElementById('ostgStage');
    if (!stage) return;
    stage.innerHTML = '';
    if (game === 'mines')    return renderMines(stage);
    if (game === 'crash')    return renderCrash(stage);
    if (game === 'dice')     return renderDice(stage);
    if (game === 'plinko')   return renderPlinko(stage);
    if (game === 'limbo')    return renderLimbo(stage);
    if (game === 'hilo')     return renderHiLo(stage);
    if (game === 'wheel')    return renderWheel(stage);
    if (game === 'coinflip') return renderCoinflip(stage);
  }

  function pushHistory(mult) {
    var h = document.getElementById('ostgHistory');
    if (!h) return;
    var pill = document.createElement('span');
    pill.className = 'ostg-mult-pill ' + (mult >= 2 ? 'win' : (mult >= 1 ? 'soft' : 'loss'));
    pill.textContent = mult.toFixed(2) + 'x';
    h.appendChild(pill);
    while (h.children.length > 16) h.removeChild(h.children[1]); // keep label first
  }

  function placeBet(amount) {
    if (!Number.isFinite(amount) || amount <= 0) return { ok: false, msg: 'Enter a positive bet.' };
    if (amount > getBalance() + 1e-9) return { ok: false, msg: 'Not enough balance — earn from the faucet first.' };
    debit(amount);
    return { ok: true };
  }

  // ────────────────────────────────────────────────────────────────────────
  // MINES
  // ────────────────────────────────────────────────────────────────────────
  function minesMultiplier(safeCount, mines) {
    // Standard Stake-style: house edge ~1%
    // Probability of safe N picks = C(25-mines, n) / C(25, n)
    var num = 1, den = 1;
    for (var i = 0; i < safeCount; i++) {
      num *= (25 - mines - i);
      den *= (25 - i);
    }
    var prob = num / den;
    return 0.99 / prob;
  }

  function renderMines(stage) {
    stage.innerHTML =
      '<div class="ostg-game ostg-mines">' +
        '<div class="ostg-controls">' +
          '<label>Bet (OST)<input type="number" id="mnBet" min="0.1" step="0.1" value="1" inputmode="decimal"></label>' +
          '<label>Mines<select id="mnMines">' +
            [1,3,5,8,10,15,24].map(function(n){ return '<option value="'+n+'">'+n+'</option>'; }).join('') +
          '</select></label>' +
          '<button class="ostg-btn ostg-btn-primary" id="mnStart">Place bet</button>' +
          '<button class="ostg-btn ostg-btn-cash" id="mnCash" disabled>Cash out</button>' +
          '<div class="ostg-meta"><span>Next safe pays</span> <strong id="mnNext">—</strong></div>' +
        '</div>' +
        '<div class="ostg-board ostg-board-5x5" id="mnBoard"></div>' +
        '<div class="ostg-status" id="mnStatus">Click "Place bet" to start.</div>' +
      '</div>';

    var bet = document.getElementById('mnBet');
    var mines = document.getElementById('mnMines');
    mines.value = '5';
    var startBtn = document.getElementById('mnStart');
    var cashBtn  = document.getElementById('mnCash');
    var nextEl   = document.getElementById('mnNext');
    var statusEl = document.getElementById('mnStatus');
    var board    = document.getElementById('mnBoard');

    var session = null;

    function buildBoard() {
      board.innerHTML = '';
      for (var i = 0; i < 25; i++) {
        var c = document.createElement('button');
        c.className = 'ostg-tile';
        c.dataset.idx = String(i);
        c.addEventListener('click', onPick);
        board.appendChild(c);
      }
    }

    async function onStart() {
      var amt = parseFloat(bet.value);
      var res = placeBet(amt);
      if (!res.ok) { statusEl.textContent = res.msg; return; }
      var mineCount = parseInt(mines.value, 10);
      var floats = await pfFloats(25);
      // Fisher-Yates shuffle indices via floats
      var idxs = []; for (var i = 0; i < 25; i++) idxs.push(i);
      for (var i = 24; i > 0; i--) {
        var j = Math.floor(floats[i] * (i + 1));
        var t = idxs[i]; idxs[i] = idxs[j]; idxs[j] = t;
      }
      var minePositions = new Set(idxs.slice(0, mineCount));
      session = { bet: amt, mines: mineCount, minePositions: minePositions, safeRevealed: 0 };
      buildBoard();
      cashBtn.disabled = true; // need at least one reveal first
      nextEl.textContent = '×' + minesMultiplier(1, mineCount).toFixed(3);
      statusEl.textContent = 'Pick a tile. Each safe tile boosts your multiplier.';
      startBtn.disabled = true;
      mines.disabled = true;
      bet.disabled = true;
    }

    function onPick(e) {
      if (!session) return;
      var idx = parseInt(e.currentTarget.dataset.idx, 10);
      var tile = e.currentTarget;
      if (tile.disabled) return;
      tile.disabled = true;
      if (session.minePositions.has(idx)) {
        tile.classList.add('mine');
        tile.textContent = '💣';
        revealAll();
        var mult = 0;
        pushHistory(mult);
        statusEl.textContent = '💥 Hit a mine. -' + fmt(session.bet) + ' OST.';
        endRound();
      } else {
        session.safeRevealed += 1;
        tile.classList.add('safe');
        tile.textContent = '💎';
        var mult = minesMultiplier(session.safeRevealed, session.mines);
        cashBtn.disabled = false;
        cashBtn.textContent = 'Cash out · ' + (session.bet * mult).toFixed(2) + ' OST';
        var nextMult = minesMultiplier(session.safeRevealed + 1, session.mines);
        nextEl.textContent = '×' + nextMult.toFixed(3);
        statusEl.textContent = '✅ Safe! Multiplier ×' + mult.toFixed(3);
        if (session.safeRevealed === 25 - session.mines) onCash(); // perfect clear
      }
    }

    function revealAll() {
      board.querySelectorAll('.ostg-tile').forEach(function (t) {
        t.disabled = true;
        var i = parseInt(t.dataset.idx, 10);
        if (session.minePositions.has(i) && !t.classList.contains('mine')) {
          t.classList.add('mine-reveal');
          t.textContent = '💣';
        }
      });
    }

    function onCash() {
      if (!session) return;
      var mult = minesMultiplier(session.safeRevealed, session.mines);
      var payout = session.bet * mult;
      credit(payout, 'mines');
      pushHistory(mult);
      statusEl.textContent = '💰 Cashed out at ×' + mult.toFixed(3) + ' for ' + payout.toFixed(2) + ' OST';
      revealAll();
      endRound();
    }

    function endRound() {
      session = null;
      startBtn.disabled = false;
      cashBtn.disabled = true;
      cashBtn.textContent = 'Cash out';
      mines.disabled = false;
      bet.disabled = false;
    }

    startBtn.addEventListener('click', onStart);
    cashBtn.addEventListener('click', onCash);
    buildBoard();
  }

  // ────────────────────────────────────────────────────────────────────────
  // CRASH
  // ────────────────────────────────────────────────────────────────────────
  function crashPoint(rand) {
    // Same formula as the popular open-source crash games:
    // crash = max(1, floor(100 / (1 - r)) / 100)  with 1% house edge by 99/100 prefix
    var h = Math.floor(99 / (1 - rand));
    return Math.max(1, h / 100);
  }

  function renderCrash(stage) {
    stage.innerHTML =
      '<div class="ostg-game ostg-crash">' +
        '<div class="ostg-controls">' +
          '<label>Bet (OST)<input type="number" id="crBet" min="0.1" step="0.1" value="1" inputmode="decimal"></label>' +
          '<label>Auto cash-out ×<input type="number" id="crAuto" min="1.01" step="0.01" value="2.00" inputmode="decimal"></label>' +
          '<button class="ostg-btn ostg-btn-primary" id="crStart">Place bet</button>' +
          '<button class="ostg-btn ostg-btn-cash" id="crCash" disabled>Cash out</button>' +
        '</div>' +
        '<div class="ostg-crash-stage">' +
          '<canvas id="crCanvas" width="640" height="280"></canvas>' +
          '<div class="ostg-crash-mult" id="crMult">1.00×</div>' +
        '</div>' +
        '<div class="ostg-status" id="crStatus">Set your bet and your auto cash-out target. Watch the rocket — cash out before it crashes.</div>' +
      '</div>';

    var canvas = document.getElementById('crCanvas');
    var ctx = canvas.getContext('2d');
    var betEl = document.getElementById('crBet');
    var autoEl = document.getElementById('crAuto');
    var startBtn = document.getElementById('crStart');
    var cashBtn = document.getElementById('crCash');
    var multEl = document.getElementById('crMult');
    var statusEl = document.getElementById('crStatus');

    var session = null;
    var raf = 0;

    function draw(mult, t, crashed) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      // grid
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      for (var x = 0; x < canvas.width; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke(); }
      for (var y = 0; y < canvas.height; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke(); }
      // curve
      ctx.beginPath();
      var w = canvas.width, h = canvas.height;
      for (var i = 0; i <= 100; i++) {
        var f = i / 100;
        var m = Math.pow(mult, f);
        var px = f * w * 0.95 + 10;
        var py = h - 20 - Math.min(h - 30, (m - 1) * 60);
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.strokeStyle = crashed ? '#dc2626' : '#34d399';
      ctx.lineWidth = 3;
      ctx.stroke();
      // rocket head
      var fx = 0.95 * w + 10;
      var fy = h - 20 - Math.min(h - 30, (mult - 1) * 60);
      ctx.fillStyle = crashed ? '#dc2626' : '#f5c468';
      ctx.font = '28px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(crashed ? '💥' : '🚀', fx, fy);
    }

    async function onStart() {
      var amt = parseFloat(betEl.value);
      var res = placeBet(amt);
      if (!res.ok) { statusEl.textContent = res.msg; return; }
      var floats = await pfFloats(1);
      var crashAt = crashPoint(floats[0]);
      var auto = parseFloat(autoEl.value) || 0;
      session = { bet: amt, crashAt: crashAt, auto: auto, t0: performance.now(), cashed: false };
      startBtn.disabled = true; cashBtn.disabled = false; betEl.disabled = true; autoEl.disabled = true;
      statusEl.textContent = 'Flying… (will crash at ×' + crashAt.toFixed(2) + ' if you don\'t cash out)';
      function tick() {
        if (!session) return;
        var elapsed = (performance.now() - session.t0) / 1000;
        var mult = Math.pow(Math.E, 0.07 * elapsed); // smooth exponential
        if (mult >= session.crashAt) {
          mult = session.crashAt;
          draw(mult, elapsed, true);
          multEl.textContent = mult.toFixed(2) + '× CRASH';
          multEl.style.color = '#fca5a5';
          if (!session.cashed) {
            pushHistory(0);
            statusEl.textContent = '💥 Crashed at ×' + mult.toFixed(2) + ' — lost ' + session.bet.toFixed(2) + ' OST.';
          }
          endRound();
          return;
        }
        if (session.auto && mult >= session.auto && !session.cashed) {
          onCash();
          return;
        }
        multEl.textContent = mult.toFixed(2) + '×';
        multEl.style.color = mult >= 2 ? '#86efac' : '#f8fafc';
        draw(mult, elapsed, false);
        raf = requestAnimationFrame(tick);
      }
      tick();
    }

    function onCash() {
      if (!session || session.cashed) return;
      session.cashed = true;
      var elapsed = (performance.now() - session.t0) / 1000;
      var mult = Math.min(session.crashAt, Math.pow(Math.E, 0.07 * elapsed));
      var payout = session.bet * mult;
      credit(payout, 'crash');
      pushHistory(mult);
      statusEl.textContent = '💰 Cashed out at ×' + mult.toFixed(2) + ' for ' + payout.toFixed(2) + ' OST';
      // Let it keep rendering until crash for honesty
    }

    function endRound() {
      cancelAnimationFrame(raf);
      session = null;
      startBtn.disabled = false;
      cashBtn.disabled = true;
      betEl.disabled = false;
      autoEl.disabled = false;
    }

    startBtn.addEventListener('click', onStart);
    cashBtn.addEventListener('click', onCash);
    draw(1, 0, false);
  }

  // ────────────────────────────────────────────────────────────────────────
  // DICE
  // ────────────────────────────────────────────────────────────────────────
  function renderDice(stage) {
    stage.innerHTML =
      '<div class="ostg-game ostg-dice">' +
        '<div class="ostg-controls">' +
          '<label>Bet (OST)<input type="number" id="dcBet" min="0.1" step="0.1" value="1" inputmode="decimal"></label>' +
          '<label>Direction<select id="dcDir"><option value="under">Roll under</option><option value="over">Roll over</option></select></label>' +
          '<label>Target<input type="number" id="dcTarget" min="2" max="98" step="1" value="50"></label>' +
          '<button class="ostg-btn ostg-btn-primary" id="dcRoll">Roll</button>' +
        '</div>' +
        '<div class="ostg-dice-bar"><div class="ostg-dice-fill" id="dcFill"></div><div class="ostg-dice-marker" id="dcMarker"></div></div>' +
        '<div class="ostg-dice-stats">' +
          '<div><span>Win chance</span><strong id="dcChance">50.00%</strong></div>' +
          '<div><span>Multiplier</span><strong id="dcMult">×1.98</strong></div>' +
          '<div><span>Payout</span><strong id="dcPayout">1.98 OST</strong></div>' +
        '</div>' +
        '<div class="ostg-dice-result" id="dcRoll-out">—</div>' +
        '<div class="ostg-status" id="dcStatus">Pick a target. Higher risk = higher payout.</div>' +
      '</div>';

    var bet    = document.getElementById('dcBet');
    var dir    = document.getElementById('dcDir');
    var target = document.getElementById('dcTarget');
    var fill   = document.getElementById('dcFill');
    var marker = document.getElementById('dcMarker');
    var chance = document.getElementById('dcChance');
    var multEl = document.getElementById('dcMult');
    var payEl  = document.getElementById('dcPayout');
    var rollBtn= document.getElementById('dcRoll');
    var rollEl = document.getElementById('dcRoll-out');
    var statusEl = document.getElementById('dcStatus');

    function recalc() {
      var t = Math.min(98, Math.max(2, parseFloat(target.value) || 50));
      var winPct = dir.value === 'under' ? t : (100 - t);
      var mult = winPct > 0 ? (99 / winPct) : 0;
      var amt  = parseFloat(bet.value) || 0;
      chance.textContent = winPct.toFixed(2) + '%';
      multEl.textContent = '×' + mult.toFixed(2);
      payEl.textContent  = (amt * mult).toFixed(2) + ' OST';
      fill.style.width = (dir.value === 'under' ? t : (100 - t)) + '%';
      fill.style.marginLeft = dir.value === 'under' ? '0' : (t + '%');
      marker.style.left = t + '%';
    }
    [bet, dir, target].forEach(function (e) { e.addEventListener('input', recalc); e.addEventListener('change', recalc); });
    recalc();

    rollBtn.addEventListener('click', async function () {
      var amt = parseFloat(bet.value);
      var res = placeBet(amt); if (!res.ok) { statusEl.textContent = res.msg; return; }
      var t = Math.min(98, Math.max(2, parseFloat(target.value) || 50));
      var floats = await pfFloats(1);
      var roll = floats[0] * 100; // 0..100
      var win = dir.value === 'under' ? (roll < t) : (roll > t);
      rollEl.textContent = roll.toFixed(2);
      rollEl.style.color = win ? '#86efac' : '#fca5a5';
      var mult = win ? (99 / (dir.value === 'under' ? t : (100 - t))) : 0;
      if (win) {
        var payout = amt * mult;
        credit(payout, 'dice');
        statusEl.textContent = '✅ Won ' + payout.toFixed(2) + ' OST (×' + mult.toFixed(2) + ')';
      } else {
        statusEl.textContent = '❌ Lost ' + amt.toFixed(2) + ' OST';
      }
      pushHistory(mult);
    });
  }

  // ────────────────────────────────────────────────────────────────────────
  // PLINKO
  // ────────────────────────────────────────────────────────────────────────
  // Multiplier tables (same shape Stake/Rainbet use, indexed by row count)
  var PLINKO_MULTS = {
    8:  { low: [5.6,2.1,1.1,1,0.5,1,1.1,2.1,5.6],
          medium:[13,3,1.3,0.7,0.4,0.7,1.3,3,13],
          high:  [29,4,1.5,0.3,0.2,0.3,1.5,4,29] },
    12: { low: [10,3,1.6,1.4,1.1,1,0.5,1,1.1,1.4,1.6,3,10],
          medium:[33,11,4,2,1.1,0.6,0.3,0.6,1.1,2,4,11,33],
          high:  [170,24,8.1,2,0.7,0.2,0.2,0.2,0.7,2,8.1,24,170] },
    16: { low: [16,9,2,1.4,1.4,1.2,1.1,1,0.5,1,1.1,1.2,1.4,1.4,2,9,16],
          medium:[110,41,10,5,3,1.5,1,0.5,0.3,0.5,1,1.5,3,5,10,41,110],
          high:  [1000,130,26,9,4,2,0.2,0.2,0.2,0.2,0.2,2,4,9,26,130,1000] }
  };

  function renderPlinko(stage) {
    stage.innerHTML =
      '<div class="ostg-game ostg-plinko">' +
        '<div class="ostg-controls">' +
          '<label>Bet (OST)<input type="number" id="plBet" min="0.1" step="0.1" value="1" inputmode="decimal"></label>' +
          '<label>Risk<select id="plRisk"><option value="low">Low</option><option value="medium" selected>Medium</option><option value="high">High</option></select></label>' +
          '<label>Rows<select id="plRows"><option value="8">8</option><option value="12" selected>12</option><option value="16">16</option></select></label>' +
          '<button class="ostg-btn ostg-btn-primary" id="plDrop">Drop ball</button>' +
        '</div>' +
        '<div class="ostg-plinko-stage">' +
          '<canvas id="plCanvas" width="640" height="380"></canvas>' +
        '</div>' +
        '<div class="ostg-plinko-mults" id="plMults"></div>' +
        '<div class="ostg-status" id="plStatus">Drop a ball — bounces left or right at every peg.</div>' +
      '</div>';

    var bet = document.getElementById('plBet');
    var risk = document.getElementById('plRisk');
    var rows = document.getElementById('plRows');
    var dropBtn = document.getElementById('plDrop');
    var canvas = document.getElementById('plCanvas');
    var ctx = canvas.getContext('2d');
    var multsBar = document.getElementById('plMults');
    var statusEl = document.getElementById('plStatus');

    function paintMults() {
      var n = parseInt(rows.value, 10);
      var arr = PLINKO_MULTS[n][risk.value];
      multsBar.innerHTML = arr.map(function (m) {
        var cls = m >= 5 ? 'big' : m >= 1.2 ? 'mid' : 'small';
        return '<span class="ostg-mult-cell ' + cls + '">' + m + '×</span>';
      }).join('');
    }
    [risk, rows].forEach(function (e) { e.addEventListener('change', function () { paintMults(); paintBoard(); }); });
    paintMults();

    function paintBoard(highlightBucket) {
      var n = parseInt(rows.value, 10);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      var topY = 30;
      var botY = canvas.height - 40;
      var spacingY = (botY - topY) / n;
      for (var r = 0; r < n; r++) {
        var pegs = r + 2;
        var totalW = (pegs - 1) * 28;
        var startX = canvas.width / 2 - totalW / 2;
        for (var p = 0; p < pegs; p++) {
          ctx.beginPath();
          ctx.arc(startX + p * 28, topY + r * spacingY, 3, 0, Math.PI * 2);
          ctx.fillStyle = '#bfdbfe';
          ctx.fill();
        }
      }
      // buckets
      var buckets = n + 1;
      var bw = canvas.width / buckets;
      for (var i = 0; i < buckets; i++) {
        ctx.fillStyle = i === highlightBucket ? 'rgba(245,196,104,0.5)' : 'rgba(255,255,255,0.06)';
        ctx.fillRect(i * bw + 2, botY + 4, bw - 4, 28);
      }
    }
    paintBoard();

    dropBtn.addEventListener('click', async function () {
      var amt = parseFloat(bet.value);
      var res = placeBet(amt); if (!res.ok) { statusEl.textContent = res.msg; return; }
      var n = parseInt(rows.value, 10);
      var floats = await pfFloats(n);
      // Each row: <0.5 left, ≥0.5 right
      var bucket = 0;
      for (var i = 0; i < n; i++) if (floats[i] >= 0.5) bucket++;
      // Animate — ball must visually land in the chosen bucket so the result
      // matches what the user sees. We keep rights = bucket count so the ball
      // ends up at column `bucket` of `n+1` buckets.
      var topY = 30, botY = canvas.height - 40, spacingY = (botY - topY) / n;
      var pegSpacing = 28;
      var startX = canvas.width / 2;
      var x = startX, y = topY;
      var stepIdx = 0;
      var rights = 0;
      function step() {
        paintBoard();
        ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.fillStyle = '#f5c468'; ctx.fill();
        if (stepIdx < n) {
          var goRight = floats[stepIdx] >= 0.5;
          if (goRight) { x += pegSpacing / 2; rights++; } else { x -= pegSpacing / 2; }
          y += spacingY;
          stepIdx++;
          requestAnimationFrame(step);
        } else {
          // Snap ball x to centre of the resolved bucket (visual integrity)
          var buckets = n + 1;
          var bw = canvas.width / buckets;
          var bx = bucket * bw + bw / 2;
          x = bx; y = botY + 18;
          paintBoard(bucket);
          ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.fillStyle = '#f5c468'; ctx.fill();
          var mult = PLINKO_MULTS[n][risk.value][bucket];
          var payout = amt * mult;
          if (payout > 0) credit(payout, 'plinko');
          pushHistory(mult);
          statusEl.textContent = mult >= 1
            ? '🎯 Landed on ' + mult + '× — won ' + payout.toFixed(2) + ' OST'
            : '😬 Landed on ' + mult + '× — got ' + payout.toFixed(2) + ' OST back';
        }
      }
      step();
    });
  }

  // ────────────────────────────────────────────────────────────────────────
  // LIMBO — pick a target multiplier; you win if the random multiplier ≥ target.
  // crash-style formula: m = 99 / (100 * r), clipped to ≥1. House edge 1%.
  // ────────────────────────────────────────────────────────────────────────
  function renderLimbo(stage) {
    stage.innerHTML =
      '<div class="ostg-game ostg-limbo">' +
        '<div class="ostg-controls">' +
          '<label>Bet (OST)<input type="number" id="lbBet" min="0.1" step="0.1" value="1" inputmode="decimal"></label>' +
          '<label>Target ×<input type="number" id="lbTarget" min="1.01" max="1000000" step="0.01" value="2.00" inputmode="decimal"></label>' +
          '<button class="ostg-btn ostg-btn-primary" id="lbRoll">Roll</button>' +
          '<div class="ostg-meta"><span>Win chance</span> <strong id="lbChance">49.50%</strong></div>' +
          '<div class="ostg-meta"><span>Payout</span> <strong id="lbPay">2.00 OST</strong></div>' +
        '</div>' +
        '<div class="ostg-limbo-stage"><div class="ostg-limbo-mult" id="lbMult">1.00×</div></div>' +
        '<div class="ostg-status" id="lbStatus">Pick a target multiplier — higher target, lower chance.</div>' +
      '</div>';
    var bet = document.getElementById('lbBet');
    var tgt = document.getElementById('lbTarget');
    var roll = document.getElementById('lbRoll');
    var multEl = document.getElementById('lbMult');
    var chance = document.getElementById('lbChance');
    var payEl = document.getElementById('lbPay');
    var statusEl = document.getElementById('lbStatus');
    function recalc() {
      var t = Math.max(1.01, parseFloat(tgt.value) || 2);
      var p = 99 / t; // % win
      var amt = parseFloat(bet.value) || 0;
      chance.textContent = p.toFixed(2) + '%';
      payEl.textContent = (amt * t).toFixed(2) + ' OST';
    }
    [bet, tgt].forEach(function (e) { e.addEventListener('input', recalc); });
    recalc();
    roll.addEventListener('click', async function () {
      var amt = parseFloat(bet.value);
      var r = placeBet(amt); if (!r.ok) { statusEl.textContent = r.msg; return; }
      var t = Math.max(1.01, parseFloat(tgt.value) || 2);
      var floats = await pfFloats(1);
      // Limbo result: m = 99 / (100*(1-r)), with very low r → very high m.
      var rolled = Math.max(1.0, 99 / (100 * (1 - floats[0])));
      // Animate count-up
      var t0 = performance.now();
      function tick() {
        var p = Math.min(1, (performance.now() - t0) / 600);
        var m = 1 + (rolled - 1) * (1 - Math.pow(1 - p, 3));
        multEl.textContent = m.toFixed(2) + '×';
        if (p < 1) requestAnimationFrame(tick);
        else {
          var win = rolled >= t;
          multEl.style.color = win ? '#86efac' : '#fca5a5';
          if (win) {
            var pay = amt * t;
            credit(pay, 'limbo');
            statusEl.textContent = '✅ Rolled ×' + rolled.toFixed(2) + ' ≥ ×' + t.toFixed(2) + ' — won ' + pay.toFixed(2) + ' OST';
            pushHistory(t);
          } else {
            statusEl.textContent = '❌ Rolled ×' + rolled.toFixed(2) + ' < ×' + t.toFixed(2);
            pushHistory(0);
          }
          setTimeout(function () { multEl.style.color = ''; }, 2000);
        }
      }
      tick();
    });
  }

  // ────────────────────────────────────────────────────────────────────────
  // HI-LO — guess if next card is higher or lower. Multiplier compounds.
  // ────────────────────────────────────────────────────────────────────────
  function renderHiLo(stage) {
    var DECK_SIZE = 13; // 1..13 (Ace..King)
    function cardLabel(v) { return ['A','2','3','4','5','6','7','8','9','10','J','Q','K'][v - 1]; }
    stage.innerHTML =
      '<div class="ostg-game ostg-hilo">' +
        '<div class="ostg-controls">' +
          '<label>Bet (OST)<input type="number" id="hlBet" min="0.1" step="0.1" value="1" inputmode="decimal"></label>' +
          '<button class="ostg-btn ostg-btn-primary" id="hlStart">Deal</button>' +
          '<button class="ostg-btn ostg-btn-cash" id="hlCash" disabled>Cash out</button>' +
          '<div class="ostg-meta"><span>Multiplier</span> <strong id="hlMult">1.00×</strong></div>' +
        '</div>' +
        '<div class="ostg-hilo-stage">' +
          '<div class="ostg-card" id="hlCard">?</div>' +
          '<div class="ostg-hilo-actions">' +
            '<button class="ostg-btn" id="hlHi" disabled>↑ Higher</button>' +
            '<button class="ostg-btn" id="hlLo" disabled>↓ Lower</button>' +
          '</div>' +
        '</div>' +
        '<div class="ostg-status" id="hlStatus">Press Deal to start. Then guess if the next card is higher or lower.</div>' +
      '</div>';
    var bet = document.getElementById('hlBet');
    var start = document.getElementById('hlStart');
    var cash = document.getElementById('hlCash');
    var multEl = document.getElementById('hlMult');
    var card = document.getElementById('hlCard');
    var hi = document.getElementById('hlHi');
    var lo = document.getElementById('hlLo');
    var statusEl = document.getElementById('hlStatus');
    var session = null;

    async function newCard() {
      var f = await pfFloats(1);
      return Math.floor(f[0] * DECK_SIZE) + 1;
    }
    function probHi(c) { return (DECK_SIZE - c) / (DECK_SIZE - 1); }   // strictly higher
    function probLo(c) { return (c - 1) / (DECK_SIZE - 1); }           // strictly lower
    function multFor(p) { return p > 0 ? 0.99 / p : 0; }

    start.addEventListener('click', async function () {
      var amt = parseFloat(bet.value);
      var r = placeBet(amt); if (!r.ok) { statusEl.textContent = r.msg; return; }
      var c = await newCard();
      session = { bet: amt, current: c, mult: 1 };
      card.textContent = cardLabel(c);
      multEl.textContent = '1.00×';
      hi.disabled = false; lo.disabled = false; start.disabled = true; bet.disabled = true; cash.disabled = true;
      statusEl.textContent = 'Higher or lower than ' + cardLabel(c) + '?';
    });

    async function pick(dir) {
      if (!session) return;
      var p = dir === 'hi' ? probHi(session.current) : probLo(session.current);
      if (p <= 0) { statusEl.textContent = 'Impossible direction — choose the other side.'; return; }
      var step = multFor(p);
      var next = await newCard();
      var win = dir === 'hi' ? (next > session.current) : (next < session.current);
      card.textContent = cardLabel(next);
      session.current = next;
      if (win) {
        session.mult *= step;
        multEl.textContent = session.mult.toFixed(2) + '×';
        cash.disabled = false;
        cash.textContent = 'Cash out · ' + (session.bet * session.mult).toFixed(2) + ' OST';
        statusEl.textContent = '✅ Correct! Multiplier compounded — keep going or cash out.';
      } else {
        statusEl.textContent = '❌ Wrong — lost ' + session.bet.toFixed(2) + ' OST';
        pushHistory(0);
        end();
      }
    }
    hi.addEventListener('click', function () { pick('hi'); });
    lo.addEventListener('click', function () { pick('lo'); });
    cash.addEventListener('click', function () {
      if (!session) return;
      var pay = session.bet * session.mult;
      credit(pay, 'hilo');
      pushHistory(session.mult);
      statusEl.textContent = '💰 Cashed out at ×' + session.mult.toFixed(2) + ' for ' + pay.toFixed(2) + ' OST';
      end();
    });
    function end() {
      session = null;
      hi.disabled = true; lo.disabled = true; cash.disabled = true; start.disabled = false; bet.disabled = false;
      cash.textContent = 'Cash out';
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // WHEEL — 50 segments, configurable risk; spin and land on a multiplier.
  // ────────────────────────────────────────────────────────────────────────
  var WHEEL_SEGMENTS = {
    low:    [1.5,1.2,1.2,0,1.2,1.2,1.5,0,1.2,1.5,1.2,0,1.5,1.2,1.2,0,1.2,1.5,1.2,0],
    medium: [3,1.5,0,2,0,1.5,3,0,2,0,1.5,3,0,2,0,1.5,3,0,2,0],
    high:   [9.9,0,0,0,0,0,0,0,0,0,9.9,0,0,0,0,0,0,0,0,0]
  };
  function renderWheel(stage) {
    stage.innerHTML =
      '<div class="ostg-game ostg-wheel">' +
        '<div class="ostg-controls">' +
          '<label>Bet (OST)<input type="number" id="whBet" min="0.1" step="0.1" value="1" inputmode="decimal"></label>' +
          '<label>Risk<select id="whRisk"><option value="low">Low</option><option value="medium" selected>Medium</option><option value="high">High</option></select></label>' +
          '<button class="ostg-btn ostg-btn-primary" id="whSpin">Spin</button>' +
        '</div>' +
        '<div class="ostg-wheel-stage">' +
          '<div class="ostg-wheel-pin"></div>' +
          '<canvas id="whCanvas" width="360" height="360"></canvas>' +
        '</div>' +
        '<div class="ostg-status" id="whStatus">Spin the wheel — payouts depend on which segment the pointer lands on.</div>' +
      '</div>';
    var canvas = document.getElementById('whCanvas');
    var ctx = canvas.getContext('2d');
    var bet = document.getElementById('whBet');
    var risk = document.getElementById('whRisk');
    var spin = document.getElementById('whSpin');
    var statusEl = document.getElementById('whStatus');
    var rotation = 0;
    function colorFor(m) { return m === 0 ? '#374151' : m < 1.5 ? '#2563eb' : m < 3 ? '#f59e0b' : '#ef4444'; }
    function paint(rot) {
      var segs = WHEEL_SEGMENTS[risk.value];
      var n = segs.length;
      var cx = canvas.width / 2, cy = canvas.height / 2, r = canvas.width / 2 - 8;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(rot);
      for (var i = 0; i < n; i++) {
        var a0 = (i / n) * Math.PI * 2;
        var a1 = ((i + 1) / n) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, r, a0, a1);
        ctx.closePath();
        ctx.fillStyle = colorFor(segs[i]);
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.stroke();
        // label
        ctx.save();
        ctx.rotate((a0 + a1) / 2);
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 12px sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(segs[i] + '×', r - 10, 4);
        ctx.restore();
      }
      ctx.restore();
      // hub
      ctx.beginPath(); ctx.arc(cx, cy, 26, 0, Math.PI * 2); ctx.fillStyle = '#0f131e'; ctx.fill();
      ctx.strokeStyle = '#f5c468'; ctx.lineWidth = 2; ctx.stroke();
    }
    risk.addEventListener('change', function () { paint(rotation); });
    paint(rotation);
    spin.addEventListener('click', async function () {
      var amt = parseFloat(bet.value);
      var r = placeBet(amt); if (!r.ok) { statusEl.textContent = r.msg; return; }
      var f = await pfFloats(1);
      var segs = WHEEL_SEGMENTS[risk.value];
      var landIdx = Math.floor(f[0] * segs.length);
      // The pin sits at the top (angle = -PI/2). We want segment `landIdx`
      // centre to align there → final rot = -PI/2 - (centreAngleOfSeg).
      var centre = ((landIdx + 0.5) / segs.length) * Math.PI * 2;
      var endRot = -Math.PI / 2 - centre + Math.PI * 2 * 6; // 6 full spins
      var startRot = rotation, t0 = performance.now(), dur = 3500;
      spin.disabled = true; bet.disabled = true; risk.disabled = true;
      function tick() {
        var p = Math.min(1, (performance.now() - t0) / dur);
        var ease = 1 - Math.pow(1 - p, 3);
        rotation = startRot + (endRot - startRot) * ease;
        paint(rotation);
        if (p < 1) requestAnimationFrame(tick);
        else {
          rotation = endRot % (Math.PI * 2);
          var mult = segs[landIdx];
          var pay = amt * mult;
          if (pay > 0) credit(pay, 'wheel');
          pushHistory(mult);
          statusEl.textContent = mult > 0
            ? '🎯 Landed on ×' + mult + ' — won ' + pay.toFixed(2) + ' OST'
            : '😬 Landed on ×0 — lost ' + amt.toFixed(2) + ' OST';
          spin.disabled = false; bet.disabled = false; risk.disabled = false;
        }
      }
      tick();
    });
  }

  // ────────────────────────────────────────────────────────────────────────
  // COINFLIP — pick heads/tails, ×1.98 payout.
  // ────────────────────────────────────────────────────────────────────────
  function renderCoinflip(stage) {
    stage.innerHTML =
      '<div class="ostg-game ostg-coin">' +
        '<div class="ostg-controls">' +
          '<label>Bet (OST)<input type="number" id="cfBet" min="0.1" step="0.1" value="1" inputmode="decimal"></label>' +
          '<button class="ostg-btn" id="cfHeads">🔆 Heads ×1.98</button>' +
          '<button class="ostg-btn" id="cfTails">🌙 Tails ×1.98</button>' +
        '</div>' +
        '<div class="ostg-coin-stage"><div class="ostg-coin-disk" id="cfDisk">?</div></div>' +
        '<div class="ostg-status" id="cfStatus">Pick heads or tails — instant 1.98× payout on a win.</div>' +
      '</div>';
    var bet = document.getElementById('cfBet');
    var heads = document.getElementById('cfHeads');
    var tails = document.getElementById('cfTails');
    var disk = document.getElementById('cfDisk');
    var statusEl = document.getElementById('cfStatus');
    async function flip(side) {
      var amt = parseFloat(bet.value);
      var r = placeBet(amt); if (!r.ok) { statusEl.textContent = r.msg; return; }
      heads.disabled = true; tails.disabled = true;
      disk.classList.remove('flip-h', 'flip-t');
      // tiny delay so the animation plays even on rapid clicks
      void disk.offsetWidth;
      var f = await pfFloats(1);
      var result = f[0] < 0.5 ? 'h' : 't';
      disk.classList.add('flip-' + result);
      setTimeout(function () {
        disk.textContent = result === 'h' ? '🔆' : '🌙';
        if (result === side) {
          var pay = amt * 1.98;
          credit(pay, 'coinflip');
          statusEl.textContent = '✅ ' + (result === 'h' ? 'Heads' : 'Tails') + '! Won ' + pay.toFixed(2) + ' OST';
          pushHistory(1.98);
        } else {
          statusEl.textContent = '❌ ' + (result === 'h' ? 'Heads' : 'Tails') + ' — lost ' + amt.toFixed(2) + ' OST';
          pushHistory(0);
        }
        heads.disabled = false; tails.disabled = false;
      }, 700);
    }
    heads.addEventListener('click', function () { flip('h'); });
    tails.addEventListener('click', function () { flip('t'); });
  }

  // ────────────────────────────────────────────────────────────────────────
  // FAIRNESS MODAL
  // ────────────────────────────────────────────────────────────────────────
  async function openFairness() {
    await ensureSeeds();
    var existing = document.getElementById('ostgFairModal');
    if (existing) existing.remove();
    var modal = document.createElement('div');
    modal.id = 'ostgFairModal';
    modal.className = 'ostg-modal';
    modal.innerHTML =
      '<div class="ostg-modal-card">' +
        '<button class="ostg-modal-close" id="ostgFairClose">×</button>' +
        '<h3>🔐 Provably-Fair Verification</h3>' +
        '<p style="opacity:0.78;font-size:13px;">Every outcome is <code>HMAC-SHA256(serverSeed, clientSeed:nonce:0)</code>. Before each round we publish a hash of the server seed; you can verify the seed after rotation matches the hash.</p>' +
        '<label>Server seed (hashed, revealed on rotate)</label>' +
        '<div class="ostg-mono" id="ostgSrvHash"></div>' +
        '<label>Client seed (you can edit)</label>' +
        '<input class="ostg-mono-input" id="ostgClientSeed">' +
        '<label>Nonce</label>' +
        '<div class="ostg-mono"><span id="ostgNonce"></span></div>' +
        '<div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap;">' +
          '<button class="ostg-btn" id="ostgRotate">Reveal & rotate server seed</button>' +
          '<button class="ostg-btn ostg-btn-primary" id="ostgSaveSeed">Save client seed</button>' +
        '</div>' +
        '<div class="ostg-mono" id="ostgRevealed" style="margin-top:10px;display:none;"></div>' +
      '</div>';
    document.body.appendChild(modal);
    document.getElementById('ostgSrvHash').textContent = pf.serverSeedHash;
    document.getElementById('ostgClientSeed').value = pf.clientSeed;
    document.getElementById('ostgNonce').textContent = String(pf.nonce);
    document.getElementById('ostgFairClose').addEventListener('click', function () { modal.remove(); });
    modal.addEventListener('click', function (e) { if (e.target === modal) modal.remove(); });
    document.getElementById('ostgRotate').addEventListener('click', async function () {
      var oldSeed = pf.serverSeed;
      await rotateServerSeed();
      var rev = document.getElementById('ostgRevealed');
      rev.style.display = '';
      rev.innerHTML = '<strong>Previous server seed (revealed):</strong><br>' + oldSeed +
        '<br><br>Verify: SHA-256 of that string should match the hash you saw before this rotation.';
      document.getElementById('ostgSrvHash').textContent = pf.serverSeedHash;
      document.getElementById('ostgNonce').textContent = '0';
    });
    document.getElementById('ostgSaveSeed').addEventListener('click', function () {
      var v = document.getElementById('ostgClientSeed').value.trim();
      if (!v) return;
      pf.clientSeed = v;
      var s = loadGames(); s.clientSeed = v; saveGames(s);
    });
  }

  // ────────────────────────────────────────────────────────────────────────
  // STYLES
  // ────────────────────────────────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('ostgStyle')) return;
    var st = document.createElement('style');
    st.id = 'ostgStyle';
    st.textContent =
      '.ostg-section{padding:24px;border-radius:20px;background:linear-gradient(180deg,rgba(15,18,30,0.92),rgba(8,11,22,0.95));border:1px solid rgba(120,180,255,0.18);box-shadow:0 12px 40px rgba(0,0,0,0.45);}' +
      '.ostg-head{display:flex;justify-content:space-between;align-items:flex-start;gap:14px;flex-wrap:wrap;margin-bottom:16px;}' +
      '.ostg-section h3{margin:0 0 4px;color:#f8fafc;font-size:1.3rem;}' +
      '.ostg-sub{margin:0;color:#94a3b8;font-size:13px;line-height:1.5;}' +
      '.ostg-sub code{background:rgba(120,180,255,0.12);padding:1px 6px;border-radius:4px;color:#bfdbfe;font-size:12px;}' +
      '.ostg-balance-card{display:flex;flex-direction:column;align-items:flex-end;gap:4px;padding:10px 14px;border-radius:12px;background:rgba(245,196,104,0.1);border:1px solid rgba(245,196,104,0.3);}' +
      '.ostg-balance-label{color:#f5c468;font-size:11px;text-transform:uppercase;letter-spacing:.06em;font-weight:700;}' +
      '.ostg-balance-amt{color:#f8fafc;font-size:18px;font-weight:700;}' +
      '.ostg-balance-amt strong{color:#f5c468;}' +
      '.ostg-fair-btn{margin-top:4px;padding:4px 10px;border-radius:6px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.12);color:#cbd5e1;font-size:11px;cursor:pointer;}' +
      '.ostg-tabs{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:18px;border-bottom:1px solid rgba(255,255,255,0.08);padding-bottom:10px;}' +
      '.ostg-tab{padding:10px 18px;border-radius:10px 10px 0 0;background:transparent;border:none;color:#94a3b8;font-weight:600;cursor:pointer;font-size:14px;}' +
      '.ostg-tab.is-active{background:rgba(56,118,252,0.18);color:#bfdbfe;border-bottom:2px solid #38bdf8;}' +
      '.ostg-game{display:flex;flex-direction:column;gap:14px;}' +
      '.ostg-controls{display:flex;flex-wrap:wrap;align-items:flex-end;gap:10px;padding:14px;border-radius:12px;background:rgba(0,0,0,0.25);border:1px solid rgba(255,255,255,0.06);}' +
      '.ostg-controls label{display:flex;flex-direction:column;gap:4px;color:#94a3b8;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;}' +
      '.ostg-controls input,.ostg-controls select{padding:9px 12px;border-radius:8px;border:1px solid rgba(255,255,255,0.12);background:rgba(0,0,0,0.4);color:#f8fafc;font-size:14px;min-width:110px;}' +
      '.ostg-btn{padding:11px 18px;border-radius:10px;border:1px solid rgba(120,180,255,0.35);background:rgba(56,118,252,0.18);color:#bfdbfe;font-weight:700;cursor:pointer;font-size:13px;}' +
      '.ostg-btn:disabled{opacity:0.4;cursor:not-allowed;}' +
      '.ostg-btn-primary{background:linear-gradient(135deg,#3876fc,#1d4ed8);color:#fff;border-color:transparent;}' +
      '.ostg-btn-cash{background:linear-gradient(135deg,#f5c468,#f59e0b);color:#1a1a1a;border-color:transparent;}' +
      '.ostg-meta{display:flex;flex-direction:column;gap:2px;color:#94a3b8;font-size:11px;text-transform:uppercase;}' +
      '.ostg-meta strong{color:#f5c468;font-size:14px;text-transform:none;}' +
      '.ostg-board-5x5{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;max-width:480px;margin:0 auto;}' +
      '.ostg-tile{aspect-ratio:1;background:linear-gradient(135deg,#1e293b,#0f172a);border:1px solid rgba(120,180,255,0.18);border-radius:10px;font-size:24px;cursor:pointer;color:#f8fafc;transition:all .15s;}' +
      '.ostg-tile:hover:not(:disabled){background:linear-gradient(135deg,#334155,#1e293b);transform:scale(1.04);}' +
      '.ostg-tile.safe{background:linear-gradient(135deg,#16a34a,#15803d);border-color:#22c55e;}' +
      '.ostg-tile.mine{background:linear-gradient(135deg,#dc2626,#991b1b);border-color:#ef4444;animation:ostg-shake .4s;}' +
      '.ostg-tile.mine-reveal{background:rgba(220,38,38,0.25);border-color:rgba(220,38,38,0.5);opacity:0.7;}' +
      '@keyframes ostg-shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-4px)}75%{transform:translateX(4px)}}' +
      '.ostg-status{padding:10px 14px;border-radius:10px;background:rgba(0,0,0,0.25);color:#cbd5e1;font-size:13px;text-align:center;min-height:18px;}' +
      '.ostg-history{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:14px;padding:10px;border-radius:10px;background:rgba(0,0,0,0.2);}' +
      '.ostg-history-label{color:#94a3b8;font-size:11px;text-transform:uppercase;letter-spacing:.06em;font-weight:700;margin-right:4px;}' +
      '.ostg-mult-pill{padding:3px 10px;border-radius:999px;font-size:11px;font-weight:700;}' +
      '.ostg-mult-pill.win{background:rgba(34,197,94,0.18);color:#86efac;}' +
      '.ostg-mult-pill.soft{background:rgba(56,118,252,0.18);color:#bfdbfe;}' +
      '.ostg-mult-pill.loss{background:rgba(220,38,38,0.18);color:#fca5a5;}' +
      '.ostg-crash-stage{position:relative;border-radius:12px;overflow:hidden;background:radial-gradient(ellipse at bottom,#1e293b,#020617);border:1px solid rgba(255,255,255,0.06);}' +
      '.ostg-crash-stage canvas{display:block;width:100%;height:auto;max-height:320px;}' +
      '.ostg-crash-mult{position:absolute;top:14px;left:14px;font-size:2.2rem;font-weight:800;color:#f8fafc;text-shadow:0 0 20px rgba(245,196,104,0.5);font-variant-numeric:tabular-nums;}' +
      '.ostg-dice-bar{position:relative;height:24px;border-radius:12px;background:linear-gradient(90deg,#dc2626,#f59e0b,#22c55e);overflow:hidden;}' +
      '.ostg-dice-fill{position:absolute;top:0;bottom:0;background:rgba(56,118,252,0.55);border-right:2px solid #fff;}' +
      '.ostg-dice-marker{position:absolute;top:-4px;bottom:-4px;width:3px;background:#fff;box-shadow:0 0 10px #fff;}' +
      '.ostg-dice-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;padding:12px;border-radius:10px;background:rgba(0,0,0,0.25);text-align:center;}' +
      '.ostg-dice-stats span{display:block;color:#94a3b8;font-size:11px;text-transform:uppercase;}' +
      '.ostg-dice-stats strong{color:#f8fafc;font-size:1.15rem;font-weight:700;}' +
      '.ostg-dice-result{text-align:center;font-size:2.5rem;font-weight:800;color:#f8fafc;font-variant-numeric:tabular-nums;}' +
      '.ostg-plinko-stage canvas{display:block;width:100%;height:auto;max-height:380px;border-radius:12px;background:radial-gradient(ellipse at top,#1e293b,#020617);}' +
      '.ostg-plinko-mults{display:flex;gap:3px;overflow-x:auto;padding:6px 0;-webkit-overflow-scrolling:touch;}' +
      '.ostg-mult-cell{flex:0 0 auto;padding:6px 10px;border-radius:6px;font-size:11px;font-weight:700;background:rgba(0,0,0,0.3);color:#cbd5e1;}' +
      '.ostg-mult-cell.mid{background:rgba(245,196,104,0.18);color:#fde68a;}' +
      '.ostg-mult-cell.big{background:rgba(220,38,38,0.22);color:#fca5a5;}' +
      '.ostg-modal{position:fixed;inset:0;background:rgba(2,6,16,0.85);backdrop-filter:blur(10px);z-index:10000;display:flex;align-items:center;justify-content:center;padding:20px;}' +
      '.ostg-modal-card{background:#0f131e;border:1px solid rgba(120,180,255,0.25);border-radius:18px;padding:22px;max-width:520px;width:100%;max-height:90vh;overflow-y:auto;position:relative;}' +
      '.ostg-modal-close{position:absolute;top:10px;right:14px;background:transparent;border:none;color:#94a3b8;font-size:1.5rem;cursor:pointer;}' +
      '.ostg-modal label{display:block;color:#94a3b8;font-size:11px;text-transform:uppercase;letter-spacing:.04em;margin:10px 0 4px;}' +
      '.ostg-mono{font-family:ui-monospace,Menlo,monospace;font-size:11px;background:rgba(0,0,0,0.4);padding:8px;border-radius:6px;color:#bfdbfe;word-break:break-all;}' +
      '.ostg-mono-input{font-family:ui-monospace,Menlo,monospace;font-size:12px;width:100%;padding:8px;border-radius:6px;background:rgba(0,0,0,0.4);border:1px solid rgba(255,255,255,0.12);color:#bfdbfe;}' +
      '@media (max-width:640px){.ostg-controls label{flex:1 1 100%;}.ostg-controls input,.ostg-controls select{width:100%;}.ostg-balance-card{align-items:flex-start;width:100%;}.ostg-tab{flex:1 1 calc(50% - 4px);text-align:center;}.ostg-crash-mult{font-size:1.6rem;}}' +
      // ── New games shipped 2026-04-28 ────────────────────────────────────
      '.ostg-balance-actions{display:flex;gap:6px;margin-top:6px;flex-wrap:wrap;}' +
      '.ostg-cash-btn{padding:6px 12px;border-radius:8px;background:linear-gradient(135deg,#22c55e,#15803d);border:none;color:#fff;font-weight:700;font-size:12px;cursor:pointer;box-shadow:0 4px 12px rgba(34,197,94,0.35);}' +
      '.ostg-cash-btn:disabled{opacity:0.4;cursor:not-allowed;box-shadow:none;}' +
      '.ostg-tabs{overflow-x:auto;-webkit-overflow-scrolling:touch;flex-wrap:nowrap;}' +
      '.ostg-tab{flex:0 0 auto;white-space:nowrap;}' +
      // Limbo
      '.ostg-limbo-stage{display:flex;align-items:center;justify-content:center;min-height:220px;border-radius:12px;background:radial-gradient(ellipse at center,#1e293b,#020617);border:1px solid rgba(255,255,255,0.06);}' +
      '.ostg-limbo-mult{font-size:4rem;font-weight:800;color:#f8fafc;font-variant-numeric:tabular-nums;text-shadow:0 0 30px rgba(245,196,104,0.45);transition:color .3s;}' +
      // Hi-Lo
      '.ostg-hilo-stage{display:flex;flex-direction:column;align-items:center;gap:14px;padding:16px;border-radius:12px;background:radial-gradient(ellipse at top,#1e293b,#020617);}' +
      '.ostg-card{width:120px;height:170px;border-radius:12px;background:linear-gradient(135deg,#fef3c7,#fde68a);color:#1a1a1a;display:flex;align-items:center;justify-content:center;font-size:3.5rem;font-weight:800;box-shadow:0 8px 24px rgba(0,0,0,0.4);font-family:Georgia,serif;}' +
      '.ostg-hilo-actions{display:flex;gap:10px;}' +
      // Wheel
      '.ostg-wheel-stage{position:relative;display:flex;justify-content:center;}' +
      '.ostg-wheel-stage canvas{display:block;max-width:100%;height:auto;}' +
      '.ostg-wheel-pin{position:absolute;top:-2px;left:50%;transform:translateX(-50%);width:0;height:0;border-left:14px solid transparent;border-right:14px solid transparent;border-top:22px solid #f5c468;z-index:2;filter:drop-shadow(0 2px 4px rgba(0,0,0,0.5));}' +
      // Coinflip
      '.ostg-coin-stage{display:flex;justify-content:center;padding:24px;}' +
      '.ostg-coin-disk{width:120px;height:120px;border-radius:50%;background:linear-gradient(135deg,#f5c468,#b45309);display:flex;align-items:center;justify-content:center;font-size:4rem;color:#1a1a1a;box-shadow:0 12px 32px rgba(245,196,104,0.4),inset 0 -4px 12px rgba(0,0,0,0.3);transform-style:preserve-3d;}' +
      '.ostg-coin-disk.flip-h{animation:ostg-coin-flip-h .7s ease-out;}' +
      '.ostg-coin-disk.flip-t{animation:ostg-coin-flip-t .7s ease-out;}' +
      '@keyframes ostg-coin-flip-h{0%{transform:rotateY(0)}100%{transform:rotateY(1080deg)}}' +
      '@keyframes ostg-coin-flip-t{0%{transform:rotateY(0)}100%{transform:rotateY(900deg)}}';
    document.head.appendChild(st);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    setTimeout(mount, 200);
  }
})();

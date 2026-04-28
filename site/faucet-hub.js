/* ==========================================================================
   OST Faucet Hub v2 — gamified earn zone
   Cards:
     1) Daily Faucet → 60s cooldown 3x3 number-guess game (+1 OST credit on win)
     2) Spin for OST → popup modal with 1–20 OST wheel
     3) Cosmic Jumper → dino/flappy/geo-dash style runner; +0.1 OST per obstacle
     4) Watch Ad → real ad popup, +1 credit per second watched (15s+)
     5) Help Train AI → real survey offerwall (CPX Research / Pollfish / BitLabs)
     6) Streak → daily-return bonus

   Earned credits accumulate in localStorage. Cash out → swap pool sends real
   on-chain OST via window.OST_REAL_SWAP / OST_SWAP_POOL.
   ========================================================================== */
(function () {
  'use strict';

  var STATE_KEY = 'ost.faucet.hub.v2';
  var MIN_PAYOUT = 0.5;              // OST credits required to cash out — low so demos work end-to-end
  var COOLDOWN_GUESS_MS = 60 * 1000; // 60 seconds for the 3x3 game
  var COOLDOWN_SPIN_MS  = 30 * 60 * 1000;
  var COOLDOWN_AD_MS    = 30 * 60 * 1000;
  var COOLDOWN_TASK_MS  = 60 * 60 * 1000;
  var STREAK_WINDOW_MS  = 24 * 3600 * 1000;
  var STREAK_RESET_MS   = 48 * 3600 * 1000;

  function load() { try { return JSON.parse(localStorage.getItem(STATE_KEY) || '{}'); } catch (e) { return {}; } }
  function save(s){ try { localStorage.setItem(STATE_KEY, JSON.stringify(s)); } catch (e) {} }
  function fmt(n) { return Number(n || 0).toFixed(2); }
  function fmtCD(ms) {
    if (ms <= 0) return 'Ready!';
    var s = Math.floor(ms / 1000);
    var h = Math.floor(s / 3600); s -= h * 3600;
    var m = Math.floor(s / 60); s -= m * 60;
    if (h > 0) return (h<10?'0':'')+h+':'+(m<10?'0':'')+m+':'+(s<10?'0':'')+s;
    return (m<10?'0':'')+m+':'+(s<10?'0':'')+s;
  }
  function pop(msg) {
    var el = document.createElement('div');
    el.className = 'fh-pop'; el.textContent = msg;
    document.body.appendChild(el);
    requestAnimationFrame(function(){ el.classList.add('fh-pop-show'); });
    setTimeout(function(){ el.classList.remove('fh-pop-show'); setTimeout(function(){ el.remove(); }, 400); }, 1500);
  }
  function award(credits, source) {
    var s = load();
    s.credits = Number(s.credits || 0) + Number(credits || 0);
    s.lifetime = Number(s.lifetime || 0) + Number(credits || 0);
    save(s);
    pop('+' + Number(credits).toFixed(2) + ' OST');
    vaultDrop();
    refreshUi();
    try { window.dispatchEvent(new CustomEvent('ost-faucet-hub-award', { detail: { credits: credits, source: source, total: s.credits }})); } catch(e) {}
  }
  function vaultDrop() {
    var d = document.createElement('div');
    d.className = 'fh-vault-drop'; d.textContent = '🪙';
    document.body.appendChild(d);
    setTimeout(function(){ d.remove(); }, 1300);
  }

  // -------- Streak ---------
  function tickStreak() {
    var s = load();
    var now = Date.now();
    var last = Number(s.streakLast || 0);
    var streak = Number(s.streak || 0);
    if (!last || (now - last) > STREAK_RESET_MS) streak = 1;
    else if ((now - last) >= STREAK_WINDOW_MS) {
      streak += 1;
      var bonus = Math.min(50, 5 + streak * 2);
      award(bonus, 'streak');
    }
    s.streak = streak; s.streakLast = now; save(s);
  }

  // -------- Section template ---------
  // NOTE: All gambling mini-games (3×3 guess, spin wheel, cosmic jumper, watch-ad)
  // were removed from the Faucet Hub on 2026-04-28. Real provably-fair betting
  // now lives exclusively in the OST Games panel (see ost-games.js), which
  // shares the same `ost.faucet.hub.v2` credit balance and routes cash-outs
  // through the same on-chain rewards vault.
  var TEMPLATE =
    '<div class="container">' +
    '<div class="fh-section" id="ostFaucetHub">' +
      '<h3>🎰 OST Rewards Vault</h3>' +
      '<p class="fh-sub">Earn bonus OST through provably-fair games and the Code Academy. Cash out to your real wallet whenever you hit the minimum.</p>' +
      '<div class="fh-bank">' +
        '<span>Your earned bonus credits · paid from on-chain rewards vault</span>' +
        '<span><strong id="fhCredits">0.00</strong> OST <button class="fh-btn fh-btn-alt" id="fhCashout" style="margin-left:14px;width:auto;padding:8px 14px;">Cash out from vault</button> <a class="fh-vault-link" id="fhVaultLink" target="_blank" rel="noopener">🔗 view rewards vault</a></span>' +
      '</div>' +
      '<div class="fh-grid">' +
        // Code Academy (educational, not gambling — kept)
        '<div class="fh-card">' +
          '<div class="fh-card-title">💻 Learn to Code · earn OST</div>' +
          '<div class="fh-emoji">⌨️🧑‍💻</div>' +
          '<button class="fh-btn" id="fhTaskBtn">Open Code Academy</button>' +
          '<div class="fh-card-meta">1000-step path: typing test → simple → medium → hard → expert. Reward per session.</div>' +
        '</div>' +
        // Streak (display only)
        '<div class="fh-card">' +
          '<div class="fh-card-title">🔥 Current Streak</div>' +
          '<div class="fh-streak-num"><span class="fh-streak-fire">🔥</span> <span id="fhStreakNum">0</span> days</div>' +
          '<div class="fh-card-meta" id="fhStreakMeta">Play any provably-fair game once a day to grow your streak.</div>' +
        '</div>' +
        // Pointer to the games panel
        '<div class="fh-card">' +
          '<div class="fh-card-title">🎲 Provably-Fair Arcade</div>' +
          '<div class="fh-emoji">💣🚀🎰🃏</div>' +
          '<div class="fh-card-meta">16 HMAC-verifiable games: Mines, Crash, Dice, Plinko, table games, Keno, Slots, Scratch, Penalty and more — all paid from this same vault.</div>' +
          '<button class="fh-btn" id="fhGoGames">Open games ↓</button>' +
        '</div>' +
      '</div>' +
    '</div>' +
    '</div>';

  function mount() {
    if (document.getElementById('ostFaucetHub')) return;
    var anchor = document.getElementById('faucetSection');
    if (!anchor) return;
    var wrap = document.createElement('section');
    wrap.id = 'ostFaucetHubSection'; wrap.className = 'section';
    wrap.style.padding = '20px 0 40px';
    wrap.innerHTML = TEMPLATE;
    anchor.closest('.container').parentElement.appendChild(wrap);
    bind();
    refreshUi();
    setInterval(refreshUi, 1000);
  }

  function bind() {
    var on = function (id, ev, fn) { var el = document.getElementById(id); if (el) el.addEventListener(ev, fn); };
    on('fhTaskBtn', 'click', openCodeAcademy);
    on('fhCashout', 'click', onCashout);
    on('fhGoGames', 'click', function () {
      var g = document.getElementById('ostGames') || document.getElementById('ostGamesSection');
      if (g) g.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  function refreshUi() {
    var s = load();
    var creditsEl = document.getElementById('fhCredits');
    if (creditsEl) creditsEl.textContent = fmt(s.credits);
    var streakEl = document.getElementById('fhStreakNum');
    if (streakEl) streakEl.textContent = String(s.streak || 0);
    // Wire vault link to the on-chain rewards ATA on Solana Explorer
    var vlink = document.getElementById('fhVaultLink');
    if (vlink && !vlink.href && window.OST_SWAP_POOL && window.OST_SWAP_POOL.ata) {
      vlink.href = 'https://explorer.solana.com/address/' + window.OST_SWAP_POOL.ata + '?cluster=devnet';
    }
    var task = document.getElementById('fhTaskBtn');
    if (task) {
      var leftT = (Number(s.lastTask || 0) + COOLDOWN_TASK_MS) - Date.now();
      task.disabled = leftT > 0;
      task.textContent = leftT > 0 ? 'Available in ' + fmtCD(leftT) : 'Open Code Academy';
    }
    var cash = document.getElementById('fhCashout');
    if (cash) {
      cash.disabled = !(Number(s.credits || 0) >= MIN_PAYOUT);
      cash.title = cash.disabled ? 'Earn at least ' + MIN_PAYOUT + ' OST in credits to cash out' : 'Send earned OST to your wallet';
    }
  }

  function setCooldown(chipId, btnId, lastMs, windowMs, readyLabel) {
    var left = (Number(lastMs || 0) + windowMs) - Date.now();
    if (chipId) {
      var chip = document.getElementById(chipId);
      if (chip) chip.textContent = left > 0 ? 'Next round in ' + fmtCD(left) : 'Ready!';
    }
    if (btnId) {
      var btn = document.getElementById(btnId);
      if (btn) {
        btn.disabled = left > 0;
        if (left <= 0 && readyLabel) btn.textContent = readyLabel;
        if (left > 0) btn.textContent = 'Resets in ' + fmtCD(left);
      }
    }
  }

  // ============================================================
  // 1) 3x3 GUESS GAME
  // ============================================================
  function bindGuessGrid() {
    var grid = document.getElementById('fhGuessGrid');
    if (!grid) return;
    grid.innerHTML = '';
    for (var i = 1; i <= 9; i++) {
      var btn = document.createElement('button');
      btn.className = 'fh-cell'; btn.type = 'button';
      btn.textContent = String(i); btn.dataset.n = String(i);
      btn.addEventListener('click', onGuessClick);
      grid.appendChild(btn);
    }
  }
  function onGuessClick(e) {
    var s = load();
    var left = (Number(s.lastGuess || 0) + COOLDOWN_GUESS_MS) - Date.now();
    if (left > 0) return;
    var n = parseInt(e.currentTarget.dataset.n, 10);
    // Use crypto RNG so the secret is genuinely unpredictable each round.
    var secret;
    if (window.crypto && window.crypto.getRandomValues) {
      var buf = new Uint32Array(1);
      // rejection sampling to avoid modulo bias on 1..9
      do { window.crypto.getRandomValues(buf); } while (buf[0] >= 4294967286);
      secret = (buf[0] % 9) + 1;
    } else {
      secret = 1 + Math.floor(Math.random() * 9);
    }
    var cells = document.querySelectorAll('#fhGuessGrid .fh-cell');
    cells.forEach(function(c){ c.disabled = true; });
    var picked = e.currentTarget;
    if (n === secret) {
      picked.classList.add('fh-cell-win');
      tickStreak();
      award(1, 'guess');
    } else {
      picked.classList.add('fh-cell-lose');
      cells.forEach(function(c){ if (parseInt(c.dataset.n,10) === secret) c.classList.add('fh-cell-reveal'); });
      pop('Secret was ' + secret + ' · try again in 60s');
    }
    s.lastGuess = Date.now(); save(s);
    refreshUi();
  }

  // ============================================================
  // 2) SPIN MODAL — 1–20 OST wheel
  // ============================================================
  function buildBigWheelGradient() {
    var SEG = 20;
    var deg = 360 / SEG;
    var colors = ['#ff7eb6','#ffd860','#4f8cff','#6ce6a4','#d63a4b','#b27dff','#f5a623','#29a36b','#2253c4','#ffffff'];
    var stops = [];
    for (var i = 0; i < SEG; i++) {
      var c = colors[i % colors.length];
      stops.push(c + ' ' + (i * deg).toFixed(2) + 'deg ' + ((i + 1) * deg).toFixed(2) + 'deg');
    }
    return 'conic-gradient(' + stops.join(', ') + ')';
  }
  function buildBigWheelLabels() {
    var SEG = 20, html = '';
    // Each label sits along the radius of its segment, head pointing outward.
    // We place at top:50%/left:50% then rotate around centre and translate outward.
    for (var i = 0; i < SEG; i++) {
      var midDeg = (i + 0.5) * (360 / SEG); // 0deg = pin (top)
      // CSS rotate is clockwise; pin is at 0deg, so segment 0 centre is at 9deg.
      html += '<div class="fh-bigwheel-label" style="transform: rotate(' + midDeg + 'deg) translate(-50%, -140px) rotate(' + (-midDeg) + 'deg);">' + (i + 1) + '</div>';
    }
    return html;
  }
  function openSpinModal() {
    var s = load();
    var left = (Number(s.lastSpin || 0) + COOLDOWN_SPIN_MS) - Date.now();
    if (left > 0) return;
    var modal = document.createElement('div');
    modal.className = 'fh-modal fh-modal-open';
    modal.innerHTML =
      '<div class="fh-modal-card">' +
        '<button class="fh-modal-close" id="fhSpinClose">×</button>' +
        '<h3>🎡 Spin the OST Wheel</h3>' +
        '<p style="opacity:0.75;margin:0 0 8px;">20 segments · win 1 to 20 OST</p>' +
        '<div class="fh-bigwheel-wrap"><div class="fh-bigwheel-pin"></div>' +
          '<div class="fh-bigwheel" id="fhBigWheel" style="background:' + buildBigWheelGradient() + ';">' +
            buildBigWheelLabels() +
          '</div>' +
        '</div>' +
        '<button class="fh-btn fh-btn-alt" id="fhSpinGo">Spin!</button>' +
        '<div class="fh-card-meta" id="fhSpinResult" style="margin-top:10px;">Click Spin to start</div>' +
      '</div>';
    document.body.appendChild(modal);
    document.getElementById('fhSpinClose').onclick = function(){ modal.remove(); };
    document.getElementById('fhSpinGo').onclick = function() {
      var btn = this; btn.disabled = true; btn.textContent = 'Spinning…';
      var wheel = document.getElementById('fhBigWheel');
      var SEG = 20;
      // Weight low prizes higher
      var weights = []; for (var i = 1; i <= SEG; i++) weights.push(SEG - i + 1);
      var total = weights.reduce(function(a,b){return a+b;}, 0);
      var r = Math.random() * total, idx = 0, acc = 0;
      for (var k = 0; k < weights.length; k++) { acc += weights[k]; if (r <= acc) { idx = k; break; } }
      var prize = idx + 1;
      var degPerSeg = 360 / SEG;
      // pin is at top — segment idx midpoint should land at 0/360deg
      var targetDeg = 360 * 12 + (360 - (idx * degPerSeg + degPerSeg / 2));
      wheel.style.transform = 'rotate(' + targetDeg + 'deg)';
      setTimeout(function() {
        var st = load(); st.lastSpin = Date.now(); save(st);
        award(prize, 'spin');
        document.getElementById('fhSpinResult').textContent = '🎉 You won ' + prize + ' OST!';
        btn.textContent = 'Won ' + prize + ' OST';
        setTimeout(function(){ modal.remove(); }, 2400);
      }, 10100);
    };
  }

  // ============================================================
  // 3) COSMIC JUMPER — modal popup, big canvas, SpaceX Starship
  // ============================================================
  var jumper = { canvas:null, ctx:null, w:0, h:0, running:false, raf:0, modal:null,
                 player:{x:80,y:0,vy:0,w:42,h:60,onGround:true},
                 obstacles:[], speed:5.5, score:0, sessionEarned:0,
                 last:0, spawnAt:0, starfield:[], _kbHandler:null };
  function openJumperModal() {
    if (jumper.modal) return;
    var modal = document.createElement('div');
    modal.className = 'fh-modal fh-modal-open fh-jumper-modal';
    modal.innerHTML =
      '<div class="fh-modal-card">' +
        '<button class="fh-modal-close" id="fhJumperClose">×</button>' +
        '<h3>🚀 Cosmic Jumper · SpaceX Starship</h3>' +
        '<div class="fh-jumper-stage">' +
          '<canvas class="fh-jumper-canvas" id="fhJumperCanvas" width="960" height="360"></canvas>' +
          '<div class="fh-jumper-score-big" id="fhJumperScore">0.00 OST</div>' +
          '<div class="fh-jumper-overlay" id="fhJumperOverlay">' +
            '<h4>Dodge the asteroids · +0.1 OST per pass</h4>' +
            '<div class="fh-jumper-controls">' +
              '<span class="fh-jumper-key">📱 Touch to jump</span>' +
              '<span class="fh-jumper-key">⌨️ Space / ↑ Arrow</span>' +
              '<span class="fh-jumper-key">🖱️ Click canvas</span>' +
            '</div>' +
            '<button class="fh-btn fh-btn-alt" id="fhJumperStart" style="width:auto;padding:12px 28px;">Launch Starship</button>' +
          '</div>' +
        '</div>' +
        '<div class="fh-card-meta" style="margin-top:10px;text-align:center;">Each obstacle cleared = +0.1 OST · earnings auto-bank on crash</div>' +
      '</div>';
    document.body.appendChild(modal);
    jumper.modal = modal;
    jumper.canvas = document.getElementById('fhJumperCanvas');
    jumper.ctx = jumper.canvas.getContext('2d');
    jumper.w = jumper.canvas.width;
    jumper.h = jumper.canvas.height;
    jumper.player.y = jumper.h - 50 - jumper.player.h;
    // starfield
    jumper.starfield = [];
    for (var i = 0; i < 80; i++) {
      jumper.starfield.push({ x: Math.random()*jumper.w, y: Math.random()*(jumper.h-60), s: Math.random()*1.6 + 0.4 });
    }
    drawJumperFrame();
    document.getElementById('fhJumperClose').onclick = closeJumperModal;
    document.getElementById('fhJumperStart').onclick = startJumper;
    jumper._kbHandler = function(e) {
      if ((e.code === 'Space' || e.code === 'ArrowUp')) {
        e.preventDefault();
        if (jumper.running) jumperJump(); else startJumper();
      }
      if (e.code === 'Escape') closeJumperModal();
    };
    document.addEventListener('keydown', jumper._kbHandler);
    jumper.canvas.addEventListener('click', function(){ jumper.running ? jumperJump() : startJumper(); });
    jumper.canvas.addEventListener('touchstart', function(e){ e.preventDefault(); jumper.running ? jumperJump() : startJumper(); }, { passive:false });
  }
  function closeJumperModal() {
    if (jumper.running) endJumper();
    if (jumper._kbHandler) { document.removeEventListener('keydown', jumper._kbHandler); jumper._kbHandler = null; }
    if (jumper.modal) { jumper.modal.remove(); jumper.modal = null; }
    jumper.canvas = null; jumper.ctx = null;
  }
  function startJumper() {
    if (jumper.running) return;
    jumper.running = true;
    jumper.obstacles = [];
    jumper.speed = 4.8;
    jumper.score = 0;
    jumper.sessionEarned = 0;
    jumper.player.vy = 0;
    jumper.player.y = jumper.h - 50 - jumper.player.h;
    jumper.player.onGround = true;
    jumper.last = performance.now();
    jumper.spawnAt = jumper.last + 1400;
    var ov = document.getElementById('fhJumperOverlay');
    if (ov) ov.classList.add('fh-hidden');
    jumperLoop();
  }
  function jumperJump() {
    if (!jumper.player.onGround) return;
    jumper.player.vy = -14;
    jumper.player.onGround = false;
  }
  function jumperLoop() {
    if (!jumper.running) return;
    var now = performance.now();
    jumper.last = now;
    // Physics
    jumper.player.vy += 0.55;
    jumper.player.y += jumper.player.vy;
    var groundY = jumper.h - 50 - jumper.player.h;
    if (jumper.player.y >= groundY) { jumper.player.y = groundY; jumper.player.vy = 0; jumper.player.onGround = true; }
    // Spawn obstacles — require fair gap so the player can ALWAYS land + re-jump.
    // Jump airtime ≈ 2 * |vy| / gravity = 2*14/0.55 ≈ 51 frames ≈ 850ms.
    // Horizontal jump distance ≈ speed * 51 ≈ 245px at speed 4.8.
    // Min gap between obstacles must exceed jumpDist + player width + safety.
    var minGapPx = (2 * 14 / 0.55) * jumper.speed + jumper.player.w + 80;
    var lastObs = jumper.obstacles.length ? jumper.obstacles[jumper.obstacles.length - 1] : null;
    var canSpawn = !lastObs || (jumper.w - (lastObs.x + lastObs.w)) > minGapPx;
    if (now >= jumper.spawnAt && canSpawn) {
      var tall = Math.random() < 0.25;
      jumper.obstacles.push({ x: jumper.w + 10, w: 24 + Math.random()*14, h: tall ? 70 : 48, passed:false });
      // Next spawn gives at least the airtime + buffer in time-units.
      var minMs = (minGapPx / jumper.speed) * (1000 / 60);
      jumper.spawnAt = now + minMs + 350 + Math.random() * 700;
    }
    // Move + score
    for (var i = jumper.obstacles.length - 1; i >= 0; i--) {
      var o = jumper.obstacles[i];
      o.x -= jumper.speed;
      if (!o.passed && o.x + o.w < jumper.player.x) {
        o.passed = true;
        jumper.score += 0.1;
        jumper.sessionEarned += 0.1;
        var sc = document.getElementById('fhJumperScore');
        if (sc) sc.textContent = jumper.score.toFixed(2) + ' OST';
        // gentler speedup so the gap math stays survivable
        jumper.speed = Math.min(9, jumper.speed + 0.04);
      }
      if (o.x + o.w < -10) jumper.obstacles.splice(i, 1);
      var px = jumper.player.x, py = jumper.player.y, pw = jumper.player.w, ph = jumper.player.h;
      var ox = o.x, oy = jumper.h - 50 - o.h;
      if (px + pw > ox && px < ox + o.w && py + ph > oy) { endJumper(); return; }
    }
    drawJumperFrame();
    jumper.raf = requestAnimationFrame(jumperLoop);
  }
  function drawStarship(ctx, x, y, w, h) {
    // SpaceX Starship-style silhouette
    ctx.save();
    // main hull (silver)
    var grad = ctx.createLinearGradient(x, y, x + w, y);
    grad.addColorStop(0, '#9ba6b8'); grad.addColorStop(0.5, '#e8eef7'); grad.addColorStop(1, '#6d7888');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(x + w/2, y);                    // nose
    ctx.lineTo(x + w*0.85, y + h*0.35);
    ctx.lineTo(x + w*0.85, y + h*0.85);
    ctx.lineTo(x + w*0.95, y + h);             // right fin tip
    ctx.lineTo(x + w*0.05, y + h);             // left fin tip
    ctx.lineTo(x + w*0.15, y + h*0.85);
    ctx.lineTo(x + w*0.15, y + h*0.35);
    ctx.closePath();
    ctx.fill();
    // window
    ctx.fillStyle = '#4f8cff';
    ctx.beginPath(); ctx.arc(x + w/2, y + h*0.3, w*0.10, 0, Math.PI*2); ctx.fill();
    // SpaceX X
    ctx.fillStyle = '#0a0a0a';
    ctx.font = 'bold ' + Math.floor(h*0.18) + 'px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('X', x + w/2, y + h*0.62);
    // engine flame when airborne
    if (!jumper.player.onGround) {
      var fg = ctx.createLinearGradient(x, y + h, x, y + h + 22);
      fg.addColorStop(0, '#ffd860'); fg.addColorStop(0.6, '#f5a623'); fg.addColorStop(1, 'rgba(214,58,75,0)');
      ctx.fillStyle = fg;
      ctx.beginPath();
      ctx.moveTo(x + w*0.35, y + h);
      ctx.lineTo(x + w*0.65, y + h);
      ctx.lineTo(x + w*0.5,  y + h + 18 + Math.random()*6);
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }
  function drawJumperFrame() {
    var ctx = jumper.ctx; if (!ctx) return;
    ctx.clearRect(0, 0, jumper.w, jumper.h);
    // starfield (parallax scroll)
    ctx.fillStyle = '#fff';
    var t = jumper.last || 0;
    for (var i = 0; i < jumper.starfield.length; i++) {
      var s = jumper.starfield[i];
      var x = (s.x - (t * 0.04 * s.s)) % jumper.w;
      if (x < 0) x += jumper.w;
      ctx.globalAlpha = 0.4 + s.s * 0.3;
      ctx.fillRect(x, s.y, s.s, s.s);
    }
    ctx.globalAlpha = 1;
    // ground (mars-like)
    var gg = ctx.createLinearGradient(0, jumper.h - 50, 0, jumper.h);
    gg.addColorStop(0, '#5a2a1a'); gg.addColorStop(1, '#1a0a05');
    ctx.fillStyle = gg;
    ctx.fillRect(0, jumper.h - 50, jumper.w, 50);
    ctx.strokeStyle = 'rgba(255,200,140,0.4)';
    ctx.beginPath(); ctx.moveTo(0, jumper.h - 50); ctx.lineTo(jumper.w, jumper.h - 50); ctx.stroke();
    // starship player
    drawStarship(ctx, jumper.player.x, jumper.player.y, jumper.player.w, jumper.player.h);
    // asteroids
    jumper.obstacles.forEach(function(o){
      var oy = jumper.h - 50 - o.h;
      var ag = ctx.createRadialGradient(o.x + o.w/2, oy + o.h/2, 4, o.x + o.w/2, oy + o.h/2, o.w);
      ag.addColorStop(0, '#7a6050'); ag.addColorStop(1, '#2a1810');
      ctx.fillStyle = ag;
      ctx.beginPath();
      ctx.ellipse(o.x + o.w/2, oy + o.h/2, o.w/2, o.h/2, 0, 0, Math.PI*2);
      ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.beginPath(); ctx.arc(o.x + o.w*0.3, oy + o.h*0.4, o.w*0.12, 0, Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.arc(o.x + o.w*0.7, oy + o.h*0.6, o.w*0.10, 0, Math.PI*2); ctx.fill();
    });
  }
  function endJumper() {
    jumper.running = false;
    cancelAnimationFrame(jumper.raf);
    var earned = Math.round(jumper.sessionEarned * 100) / 100;
    if (earned > 0) {
      var s = load();
      s.credits = Number(s.credits || 0) + earned;
      s.lifetime = Number(s.lifetime || 0) + earned;
      save(s);
      pop('+' + earned.toFixed(2) + ' OST');
      try { window.dispatchEvent(new CustomEvent('ost-faucet-hub-award', { detail: { credits: earned, source: 'jumper', total: s.credits }})); } catch(e) {}
    }
    var ov = document.getElementById('fhJumperOverlay');
    if (ov) {
      ov.classList.remove('fh-hidden');
      ov.querySelector('h4').textContent = '💥 Crashed · banked ' + earned.toFixed(2) + ' OST';
      var startBtn = document.getElementById('fhJumperStart');
      if (startBtn) startBtn.textContent = 'Launch again';
    }
    refreshUi();
  }

  // ============================================================
  // 4) WATCH AD — public partner carousel + per-second OST
  // Rotates real public ads (Polymarket, Kalshi, Department of War,
  // FIFA World Cup 2026, Kick, Twitch). User earns +1 OST every
  // second the ad modal stays open, minimum 15s.
  // ============================================================
  var AD_MIN_SECONDS = 15, AD_MAX_SECONDS = 30;
  var PUBLIC_ADS = [
    { id:'polymarket', logo:'📊',
      img:'https://www.google.com/s2/favicons?domain=polymarket.com&sz=256',
      photo:'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c3/Polymarket_logo.svg/640px-Polymarket_logo.svg.png',
      title:'Polymarket',
      tag:'Bet on real-world events with USDC. The largest prediction market on-chain.',
      cta:'Open Polymarket', url:'https://polymarket.com/' },
    { id:'kalshi', logo:'🇺🇸',
      img:'https://www.google.com/s2/favicons?domain=kalshi.com&sz=256',
      photo:'https://upload.wikimedia.org/wikipedia/commons/thumb/9/95/Kalshi_logo.svg/640px-Kalshi_logo.svg.png',
      title:'Kalshi',
      tag:'CFTC-regulated event contracts — trade on news, politics, weather and more.',
      cta:'Open Kalshi', url:'https://kalshi.com/' },
    { id:'dow', logo:'🛡️',
      img:'https://www.google.com/s2/favicons?domain=war.gov&sz=256',
      photo:'https://upload.wikimedia.org/wikipedia/commons/thumb/f/fc/Department_of_War_seal.svg/512px-Department_of_War_seal.svg.png',
      title:'U.S. Department of War',
      tag:'Careers, contracts and recruitment with the Department of War.',
      cta:'Visit war.gov', url:'https://www.war.gov/' },
    { id:'wc26', logo:'⚽',
      img:'https://www.google.com/s2/favicons?domain=fifa.com&sz=256',
      photo:'https://upload.wikimedia.org/wikipedia/en/thumb/d/d4/2026_FIFA_World_Cup.svg/512px-2026_FIFA_World_Cup.svg.png',
      title:'FIFA World Cup 2026',
      tag:'USA · Canada · Mexico · 48 teams · the biggest World Cup ever. Tickets & schedule.',
      cta:'Open FIFA.com', url:'https://www.fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026' },
    { id:'kick', logo:'🟢',
      img:'https://www.google.com/s2/favicons?domain=kick.com&sz=256',
      photo:'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8d/Kick_logo.svg/512px-Kick_logo.svg.png',
      title:'Kick.com',
      tag:'Watch & stream live — 95/5 creator revenue split. The streamer-first platform.',
      cta:'Open Kick', url:'https://kick.com/' },
    { id:'twitch', logo:'🟣',
      img:'https://www.google.com/s2/favicons?domain=twitch.tv&sz=256',
      photo:'https://upload.wikimedia.org/wikipedia/commons/thumb/2/26/Twitch_logo.svg/512px-Twitch_logo.svg.png',
      title:'Twitch',
      tag:'Where millions of people come together to watch, chat and create live streams.',
      cta:'Open Twitch', url:'https://www.twitch.tv/' }
  ];
  function onAd() {
    var s = load();
    if (Number(s.lastAd || 0) + COOLDOWN_AD_MS > Date.now()) return;
    var btn = document.getElementById('fhAdBtn');
    var fillCard = document.getElementById('fhAdFill');
    btn.disabled = true;

    var seconds = AD_MIN_SECONDS, elapsed = 0, earnedSoFar = 0;
    var idx = Math.floor(Math.random() * PUBLIC_ADS.length);

    var modal = document.createElement('div');
    modal.className = 'fh-modal fh-modal-open fh-ad-modal';
    modal.innerHTML =
      '<div class="fh-modal-card">' +
        '<button class="fh-modal-close" id="fhAdCloseX">×</button>' +
        '<h3>📺 Sponsored · earning OST every second</h3>' +
        '<div class="fh-ad-stage" id="fhAdStage"></div>' +
        '<div class="fh-ad-bar"><div class="fh-ad-fill" id="fhAdFillModal" style="width:0%"></div></div>' +
        '<div class="fh-ad-timer" id="fhAdTimerModal" style="text-align:center;margin-top:8px;">Starting…</div>' +
      '</div>';
    document.body.appendChild(modal);
    var stage = document.getElementById('fhAdStage');
    var fillModal = document.getElementById('fhAdFillModal');
    var timer = document.getElementById('fhAdTimerModal');

    function renderSlide(i) {
      var a = PUBLIC_ADS[i % PUBLIC_ADS.length];
      stage.innerHTML =
        '<div class="fh-ad-slide">' +
          '<img class="fh-ad-photo" src="' + a.photo + '" alt="' + a.title + '" ' +
               'onerror="this.onerror=null;this.src=\'' + a.img + '\';this.classList.add(\'fh-ad-photo-fallback\');" />' +
          '<h4 class="fh-ad-title">' + a.logo + ' ' + a.title + '</h4>' +
          '<p class="fh-ad-tag">' + a.tag + '</p>' +
          '<a class="fh-ad-cta" href="' + a.url + '" target="_blank" rel="noopener nofollow">' + a.cta + ' →</a>' +
        '</div>';
    }
    renderSlide(idx);

    var rotate = setInterval(function(){ idx++; renderSlide(idx); }, 5000);

    function finish(skipped) {
      clearInterval(iv); clearInterval(rotate);
      modal.remove();
      if (earnedSoFar > 0) {
        var st = load(); st.lastAd = Date.now(); save(st);
        award(earnedSoFar, 'ad');
      }
      btn.disabled = false;
      btn.textContent = skipped
        ? (earnedSoFar > 0 ? 'Earned ' + earnedSoFar + ' OST · come back later' : 'Watch ad (+1 OST/sec, 15s+)')
        : 'Earned ' + earnedSoFar + ' OST · come back later';
      if (fillCard) fillCard.style.width = '0%';
      refreshUi();
    }

    document.getElementById('fhAdCloseX').onclick = function() { finish(true); };

    var iv = setInterval(function() {
      elapsed += 1; earnedSoFar += 1;
      var pct = Math.min(100, (elapsed / seconds) * 100);
      fillModal.style.width = pct + '%';
      if (fillCard) fillCard.style.width = pct + '%';
      timer.textContent = elapsed < seconds
        ? ('Watching… ' + elapsed + 's / ' + seconds + 's · earned ' + earnedSoFar + ' OST · close anytime')
        : ('Bonus mode · ' + elapsed + 's · earned ' + earnedSoFar + ' OST · close to claim');
      if (elapsed >= AD_MAX_SECONDS) finish(false);
    }, 1000);
  }

  // ============================================================
  // 5) LEARN TO CODE — replaces "Train AI"
  // 1000-step curriculum: typing test → simple → medium → hard → expert.
  // Starts everyone at the typing test for 60 seconds, then unlocks
  // beginner code quizzes (idea → UI → component). Rewards per session.
  // ============================================================
  var CODE_LEVELS = [
    { id:'typing',  label:'Typing 60s' },
    { id:'simple',  label:'Simple code' },
    { id:'medium',  label:'Medium code' },
    { id:'hard',    label:'Hard code' },
    { id:'expert',  label:'Expert code' }
  ];
  var TYPING_PROMPTS = [
    "function hello(name) { return 'hi ' + name; }",
    "const sum = (a, b) => a + b; console.log(sum(2, 3));",
    "for (let i = 0; i < 10; i++) { console.log(i); }",
    "if (user.isLoggedIn) { showDashboard(); } else { showLogin(); }",
    "const users = data.filter(u => u.active).map(u => u.name);"
  ];
  var CODE_QUIZ = {
    simple: [
      { q:'You want a button on a page that says "Click me". Which HTML?',
        opts:['<button>Click me</button>','<click>Click me</click>','<a button>Click me</a>','<input type="button" />'], a:0,
        why:'A `<button>` element with the text inside is the simplest way to render a button.' },
      { q:'How do you store the value 42 in a variable named score in JavaScript?',
        opts:['let score = 42;','score := 42','var: score 42','const 42 = score;'], a:0,
        why:'`let` (or `const`) declares a variable and `=` assigns the value.' },
      { q:'Which CSS makes text red?',
        opts:['color: red;','text: red;','font-color: red;','red: text;'], a:0,
        why:'The `color` property sets the text color in CSS.' }
    ],
    medium: [
      { q:'In React, how do you render the value of `name` inside JSX?',
        opts:['<div>{name}</div>','<div>name</div>','<div>{{name}}</div>','<div>$name</div>'], a:0,
        why:'JSX uses single curly braces to embed JavaScript expressions.' },
      { q:'Which array method returns a NEW array with each item doubled?',
        opts:['arr.map(x => x*2)','arr.forEach(x => x*2)','arr.push(x*2)','arr.filter(x => x*2)'], a:0,
        why:'`.map()` returns a new array of transformed items; `.forEach()` returns nothing.' }
    ],
    hard: [
      { q:'A function returns a Promise that resolves with user data. How do you await it inside an async function?',
        opts:['const data = await getUser();','const data = getUser().then;','const data = sync getUser();','const data = await(getUser);'], a:0,
        why:'`await` pauses an async function until the Promise resolves and returns its value.' }
    ],
    expert: [
      { q:'Which Big-O describes binary search on a sorted array of size n?',
        opts:['O(log n)','O(n)','O(n log n)','O(1)'], a:0,
        why:'Each comparison halves the search space → logarithmic time.' }
    ]
  };
  function openCodeAcademy() {
    var s = load();
    if (Number(s.lastTask || 0) + COOLDOWN_TASK_MS > Date.now()) return;
    var step = Number(s.codeStep || 0); // global progression, climbs to 1000
    var level = pickLevelByStep(step);
    var modal = document.createElement('div');
    modal.className = 'fh-modal fh-modal-open fh-code-modal';
    modal.innerHTML =
      '<div class="fh-modal-card">' +
        '<button class="fh-modal-close" id="fhCodeClose">×</button>' +
        '<h3>💻 Code Academy · session ' + (step + 1) + ' / 1000</h3>' +
        '<p style="opacity:0.78;margin:0 0 4px;">Learn to code, get rewarded. Today\'s level: <b>' + levelLabel(level) + '</b>.</p>' +
        '<div class="fh-code-progress">' +
          CODE_LEVELS.map(function(L){
            return '<span class="fh-code-pill ' + (L.id === level ? 'fh-code-pill-active' : '') + '">' + L.label + '</span>';
          }).join('') +
        '</div>' +
        '<div id="fhCodeBody"></div>' +
      '</div>';
    document.body.appendChild(modal);
    document.getElementById('fhCodeClose').onclick = function(){ modal.remove(); };
    var body = document.getElementById('fhCodeBody');
    if (level === 'typing') renderTypingTest(body, modal);
    else renderQuiz(body, modal, level);
  }
  function pickLevelByStep(step) {
    if (step < 5)   return 'typing';
    if (step < 50)  return 'simple';
    if (step < 200) return 'medium';
    if (step < 600) return 'hard';
    return 'expert';
  }
  function levelLabel(id) {
    for (var i = 0; i < CODE_LEVELS.length; i++) if (CODE_LEVELS[i].id === id) return CODE_LEVELS[i].label;
    return id;
  }
  function renderTypingTest(body, modal) {
    var prompt = TYPING_PROMPTS[Math.floor(Math.random() * TYPING_PROMPTS.length)];
    body.innerHTML =
      '<p style="margin:6px 0;opacity:0.8;">Type the line below as fast and accurately as you can. You have <b>60 seconds</b>. Reward = 0.5 OST per correct word (capped at 60).</p>' +
      '<div class="fh-code-typing" id="fhTypingTarget"></div>' +
      '<input class="fh-code-input" id="fhTypingInput" placeholder="Click here and start typing…" autocomplete="off" spellcheck="false">' +
      '<div class="fh-code-stats">' +
        '<span>⏱ <span id="fhTypingTime">60</span>s</span>' +
        '<span>✅ <span id="fhTypingWPM">0</span> WPM</span>' +
        '<span>🎯 <span id="fhTypingAcc">100</span>% accuracy</span>' +
      '</div>' +
      '<button class="fh-btn fh-btn-alt" id="fhTypingDone" style="margin-top:10px;width:auto;padding:10px 20px;">Finish & claim OST</button>';
    var target = document.getElementById('fhTypingTarget');
    var input  = document.getElementById('fhTypingInput');
    var timeEl = document.getElementById('fhTypingTime');
    var wpmEl  = document.getElementById('fhTypingWPM');
    var accEl  = document.getElementById('fhTypingAcc');
    var doneBtn= document.getElementById('fhTypingDone');
    function paint(typed) {
      var html = '';
      for (var i = 0; i < prompt.length; i++) {
        var ch = prompt[i];
        if (i < typed.length) {
          var ok = typed[i] === ch;
          html += '<span class="' + (ok ? 'ok' : 'bad') + '">' + (ch === ' ' ? '&nbsp;' : escapeHtml(ch)) + '</span>';
        } else if (i === typed.length) {
          html += '<span class="cur">' + (ch === ' ' ? '&nbsp;' : escapeHtml(ch)) + '</span>';
        } else {
          html += escapeHtml(ch);
        }
      }
      target.innerHTML = html;
    }
    paint('');
    var startedAt = 0, finished = false;
    var timeLeft = 60, tv;
    input.addEventListener('input', function() {
      if (!startedAt) {
        startedAt = Date.now();
        tv = setInterval(function() {
          timeLeft -= 1; timeEl.textContent = String(timeLeft);
          if (timeLeft <= 0) finishTyping();
        }, 1000);
      }
      var typed = input.value;
      paint(typed);
      var correctChars = 0;
      for (var i = 0; i < typed.length && i < prompt.length; i++) if (typed[i] === prompt[i]) correctChars++;
      var elapsedMin = Math.max(0.001, (Date.now() - startedAt) / 60000);
      var wpm = Math.round((correctChars / 5) / elapsedMin);
      var acc = typed.length ? Math.round((correctChars / typed.length) * 100) : 100;
      wpmEl.textContent = String(wpm); accEl.textContent = String(acc);
      if (typed === prompt) finishTyping();
    });
    doneBtn.onclick = finishTyping;
    function finishTyping() {
      if (finished) return; finished = true;
      clearInterval(tv);
      var typed = input.value;
      var correctChars = 0;
      for (var i = 0; i < typed.length && i < prompt.length; i++) if (typed[i] === prompt[i]) correctChars++;
      var words = correctChars / 5;
      var reward = Math.min(60, Math.round(words * 0.5 * 100) / 100);
      var st = load();
      st.lastTask = Date.now();
      st.codeStep = Number(st.codeStep || 0) + 1;
      save(st);
      if (reward > 0) award(reward, 'typing');
      modal.remove();
      pop('Typing test +' + reward + ' OST');
    }
    input.focus();
  }
  function renderQuiz(body, modal, level) {
    var pool = CODE_QUIZ[level] || CODE_QUIZ.simple;
    var question = pool[Math.floor(Math.random() * pool.length)];
    body.innerHTML =
      '<div class="fh-code-quiz-q">' + escapeHtml(question.q) + '</div>' +
      '<div class="fh-code-quiz-opts" id="fhQuizOpts"></div>' +
      '<div id="fhQuizExplain" style="margin-top:10px;opacity:0.85;font-size:0.9rem;"></div>';
    var opts = document.getElementById('fhQuizOpts');
    question.opts.forEach(function(text, i) {
      var b = document.createElement('button');
      b.className = 'fh-code-opt'; b.type = 'button';
      b.textContent = String.fromCharCode(65 + i) + '.  ' + text;
      b.onclick = function() {
        var siblings = opts.querySelectorAll('.fh-code-opt');
        siblings.forEach(function(x){ x.disabled = true; });
        if (i === question.a) {
          b.classList.add('ok');
          var reward = level === 'simple' ? 5 : level === 'medium' ? 10 : level === 'hard' ? 20 : 40;
          var st = load();
          st.lastTask = Date.now();
          st.codeStep = Number(st.codeStep || 0) + 1;
          save(st);
          award(reward, 'code-' + level);
          document.getElementById('fhQuizExplain').innerHTML = '✅ Correct! +' + reward + ' OST · ' + question.why;
          setTimeout(function(){ modal.remove(); }, 2200);
        } else {
          b.classList.add('bad');
          siblings[question.a].classList.add('ok');
          document.getElementById('fhQuizExplain').innerHTML = '❌ Not quite. Correct answer: ' + String.fromCharCode(65 + question.a) + '. ' + question.why + '<br><br>Try again in 1 hour.';
          var st = load(); st.lastTask = Date.now(); save(st);
          setTimeout(function(){ modal.remove(); }, 4500);
        }
      };
      opts.appendChild(b);
    });
  }
  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, function(c){
    return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c];
  }); }

  // ============================================================
  // 6) CASH OUT — pool transfers OST → user wallet (real on-chain)
  // ============================================================
  async function onCashout() {
    var s = load();
    var amount = Number(s.credits || 0);
    if (amount < MIN_PAYOUT) { pop('Earn at least ' + MIN_PAYOUT + ' OST first'); return; }
    var w = window.OST_WALLET;
    if (!w || !w.session || !w.session.publicKey) {
      pop('Connect a wallet first');
      try {
        var btnConnect = document.getElementById('connectWalletBtn');
        if (btnConnect) btnConnect.click();
      } catch(e) {}
      return;
    }
    if (!window.OST_SWAP_POOL || !window.OST_SWAP_POOL.secretKey) {
      pop('Rewards vault not loaded — refresh the page');
      return;
    }
    if (!window.solanaWeb3) { pop('Solana SDK still loading — try again'); return; }

    var btn = document.getElementById('fhCashout');
    btn.disabled = true; var prev = btn.textContent; btn.textContent = 'Sending…';
    try {
      // Use the pool-paid payout API: pool covers the SOL fee and (if needed)
      // the user's OST ATA rent. The user's wallet does not need any devnet SOL.
      if (!window.OST_RESCUE || !window.OST_RESCUE.payoutOst) {
        throw new Error('Vault helpers still loading — try again in a second.');
      }
      btn.textContent = 'Sending OST…';
      var memo = JSON.stringify({ k:'faucet-hub-cashout', amt: amount, lifetime: Number(s.lifetime||0), t: Date.now() });
      var result = await window.OST_RESCUE.payoutOst(w.session.publicKey, amount, memo);
      var toSend = result.ost;
      var sig = result.sig;

      // Persist new state — only after the on-chain confirm so failures keep credits
      var s2 = load();
      s2.credits = Math.max(0, Number(s2.credits || 0) - toSend);
      s2.lastCashout = Date.now();
      save(s2);
      pop('+' + toSend.toFixed(2) + ' OST sent!');
      vaultDrop();
      btn.textContent = '✓ Sent · ' + String(sig).slice(0, 8) + '…';
      try { window.dispatchEvent(new CustomEvent('ost:wallet-changed')); } catch(e) {}
      setTimeout(function(){ btn.textContent = prev; refreshUi(); }, 4500);
    } catch (err) {
      console.warn('[fh] cashout failed', err);
      var msg = (err && err.message) ? err.message : 'Cash-out failed';
      // Show the real error so the user knows what to fix
      pop(msg.length > 60 ? msg.slice(0, 60) + '…' : msg);
      try { alert('Cash-out failed:\n\n' + msg); } catch(e) {}
      btn.disabled = false; btn.textContent = prev;
      refreshUi();
    }
  }

  window.OST_FAUCET_HUB = {
    state: load,
    award: award,
    cashout: onCashout,
    refresh: refreshUi
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();

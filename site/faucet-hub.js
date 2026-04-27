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
  var MIN_PAYOUT = 5;                // OST credits required to cash out
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
    refreshUi();
    try { window.dispatchEvent(new CustomEvent('ost-faucet-hub-award', { detail: { credits: credits, source: source, total: s.credits }})); } catch(e) {}
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
  var TEMPLATE =
    '<div class="container">' +
    '<div class="fh-section" id="ostFaucetHub">' +
      '<h3>🎰 OST Faucet Hub</h3>' +
      '<p class="fh-sub">Mini-games, prediction wheels, real ads & surveys. Every 60 seconds you can play the daily guess game for +1 OST.</p>' +
      '<div class="fh-bank">' +
        '<span>Your earned bonus credits</span>' +
        '<span><strong id="fhCredits">0.00</strong> OST <button class="fh-btn fh-btn-alt" id="fhCashout" style="margin-left:14px;width:auto;padding:8px 14px;">Cash out to wallet</button></span>' +
      '</div>' +
      '<div class="fh-grid">' +
        // 3x3 guess game
        '<div class="fh-card">' +
          '<div class="fh-card-title">🎯 Guess the Number (3×3)</div>' +
          '<div class="fh-card-meta" id="fhGuessHint">Pick a tile 1–9. If you match the secret number, +1 OST.</div>' +
          '<div class="fh-grid3" id="fhGuessGrid"></div>' +
          '<div class="fh-chip" id="fhGuessChip">Ready!</div>' +
        '</div>' +
        // Spin
        '<div class="fh-card">' +
          '<div class="fh-card-title">🎡 Spin for OST</div>' +
          '<div class="fh-wheel-wrap"><div class="fh-wheel-pin"></div><div class="fh-wheel" id="fhWheel"></div></div>' +
          '<button class="fh-btn" id="fhSpinBtn">Open spin (1–20 OST)</button>' +
          '<div class="fh-chip" id="fhSpinChip">Ready!</div>' +
        '</div>' +
        // Cosmic Jumper
        '<div class="fh-card">' +
          '<div class="fh-card-title">🦖 Cosmic Jumper</div>' +
          '<div class="fh-game-wrap">' +
            '<canvas class="fh-game-canvas" id="fhGameCanvas" width="600" height="160"></canvas>' +
            '<div class="fh-game-score" id="fhGameScore">0.00 OST</div>' +
            '<div class="fh-game-tip">Space / Tap to jump · each obstacle = +0.1 OST</div>' +
          '</div>' +
          '<button class="fh-btn" id="fhGameBtn">Start run</button>' +
        '</div>' +
        // Ad
        '<div class="fh-card">' +
          '<div class="fh-card-title">▶️ Watch Ad · per-second OST</div>' +
          '<div class="fh-emoji">📺</div>' +
          '<button class="fh-btn" id="fhAdBtn">Watch ad (+1 OST/sec, 15s+)</button>' +
          '<div class="fh-ad-bar"><div class="fh-ad-fill" id="fhAdFill"></div></div>' +
          '<div class="fh-ad-timer" id="fhAdTimer">Ad revenue funds the OST treasury</div>' +
        '</div>' +
        // Surveys
        '<div class="fh-card">' +
          '<div class="fh-card-title">🧠 Help Train AI · real surveys</div>' +
          '<div class="fh-emoji">🛰️🤖</div>' +
          '<button class="fh-btn" id="fhTaskBtn">Open survey wall (+up to 200 OST)</button>' +
          '<div class="fh-card-meta">Real human-data tasks via CPX Research, Pollfish, BitLabs · we earn → you earn</div>' +
        '</div>' +
        // Streak
        '<div class="fh-card">' +
          '<div class="fh-card-title">🔥 Current Streak</div>' +
          '<div class="fh-streak-num"><span class="fh-streak-fire">🔥</span> <span id="fhStreakNum">0</span> days</div>' +
          '<div class="fh-card-meta" id="fhStreakMeta">Play the daily guess game once a day to grow your streak.</div>' +
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
    bindGuessGrid();
    bind();
    initJumper();
    refreshUi();
    setInterval(refreshUi, 1000);
  }

  function bind() {
    document.getElementById('fhSpinBtn').addEventListener('click', openSpinModal);
    document.getElementById('fhGameBtn').addEventListener('click', startJumper);
    document.getElementById('fhAdBtn').addEventListener('click', onAd);
    document.getElementById('fhTaskBtn').addEventListener('click', onSurvey);
    document.getElementById('fhCashout').addEventListener('click', onCashout);
  }

  function refreshUi() {
    var s = load();
    var creditsEl = document.getElementById('fhCredits');
    if (creditsEl) creditsEl.textContent = fmt(s.credits);
    var streakEl = document.getElementById('fhStreakNum');
    if (streakEl) streakEl.textContent = String(s.streak || 0);
    setCooldown('fhGuessChip', null, s.lastGuess, COOLDOWN_GUESS_MS, null);
    setCooldown(null, 'fhSpinBtn', s.lastSpin, COOLDOWN_SPIN_MS, 'Open spin (1–20 OST)');
    var ad = document.getElementById('fhAdBtn');
    if (ad) {
      var leftAd = (Number(s.lastAd || 0) + COOLDOWN_AD_MS) - Date.now();
      ad.disabled = leftAd > 0;
      ad.textContent = leftAd > 0 ? 'Available in ' + fmtCD(leftAd) : 'Watch ad (+1 OST/sec, 15s+)';
    }
    var task = document.getElementById('fhTaskBtn');
    if (task) {
      var leftT = (Number(s.lastTask || 0) + COOLDOWN_TASK_MS) - Date.now();
      task.disabled = leftT > 0;
      task.textContent = leftT > 0 ? 'Available in ' + fmtCD(leftT) : 'Open survey wall (+up to 200 OST)';
    }
    // re-enable guess grid when cooldown done
    var leftG = (Number(s.lastGuess || 0) + COOLDOWN_GUESS_MS) - Date.now();
    var cells = document.querySelectorAll('#fhGuessGrid .fh-cell');
    cells.forEach(function(c){
      if (leftG <= 0) {
        c.disabled = false;
        c.classList.remove('fh-cell-win', 'fh-cell-lose', 'fh-cell-reveal');
      }
    });
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
    var secret = 1 + Math.floor(Math.random() * 9);
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
    for (var i = 0; i < SEG; i++) {
      var midDeg = (i + 0.5) * (360 / SEG);
      html += '<div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%) rotate(' + midDeg + 'deg) translateY(-42%);font-weight:800;color:#0a0a0a;font-size:14px;">' + (i + 1) + '</div>';
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
      var targetDeg = 360 * 8 + (360 - (idx * degPerSeg + degPerSeg / 2));
      wheel.style.transform = 'rotate(' + targetDeg + 'deg)';
      setTimeout(function() {
        var st = load(); st.lastSpin = Date.now(); save(st);
        award(prize, 'spin');
        document.getElementById('fhSpinResult').textContent = '🎉 You won ' + prize + ' OST!';
        btn.textContent = 'Won ' + prize + ' OST';
        setTimeout(function(){ modal.remove(); }, 2200);
      }, 5600);
    };
  }

  // ============================================================
  // 3) COSMIC JUMPER — dino/flappy/geo-dash style runner
  // ============================================================
  var jumper = { canvas:null, ctx:null, w:600, h:160, running:false, raf:0,
                  player:{x:60,y:0,vy:0,size:24,onGround:true},
                  obstacles:[], speed:5, score:0, sessionEarned:0, last:0, spawnAt:0 };
  function initJumper() {
    var c = document.getElementById('fhGameCanvas');
    if (!c) return;
    jumper.canvas = c;
    jumper.ctx = c.getContext('2d');
    jumper.w = c.width; jumper.h = c.height;
    jumper.player.y = jumper.h - 30 - jumper.player.size;
    drawJumperFrame();
    document.addEventListener('keydown', function(e) {
      if ((e.code === 'Space' || e.code === 'ArrowUp') && jumper.running) { e.preventDefault(); jumperJump(); }
    });
    c.addEventListener('click', function(){ if (jumper.running) jumperJump(); });
    c.addEventListener('touchstart', function(e){ if (jumper.running) { e.preventDefault(); jumperJump(); } }, { passive:false });
  }
  function startJumper() {
    if (jumper.running) return;
    jumper.running = true;
    jumper.obstacles = [];
    jumper.speed = 5;
    jumper.score = 0;
    jumper.sessionEarned = 0;
    jumper.player.vy = 0;
    jumper.player.y = jumper.h - 30 - jumper.player.size;
    jumper.player.onGround = true;
    jumper.last = performance.now();
    jumper.spawnAt = jumper.last + 800;
    document.getElementById('fhGameBtn').textContent = 'Running… (Space/Tap to jump)';
    document.getElementById('fhGameBtn').disabled = true;
    jumperLoop();
  }
  function jumperJump() {
    if (!jumper.player.onGround) return;
    jumper.player.vy = -10.5;
    jumper.player.onGround = false;
  }
  function jumperLoop() {
    if (!jumper.running) return;
    var now = performance.now();
    var dt = Math.min(40, now - jumper.last);
    jumper.last = now;
    // Physics
    jumper.player.vy += 0.55;
    jumper.player.y += jumper.player.vy;
    var groundY = jumper.h - 30 - jumper.player.size;
    if (jumper.player.y >= groundY) {
      jumper.player.y = groundY; jumper.player.vy = 0; jumper.player.onGround = true;
    }
    // Spawn obstacles
    if (now >= jumper.spawnAt) {
      var tall = Math.random() < 0.4;
      jumper.obstacles.push({ x: jumper.w + 10, w: 18 + Math.random()*10, h: tall ? 38 : 26, passed:false });
      jumper.spawnAt = now + 700 + Math.random()*900;
    }
    // Move + score
    for (var i = jumper.obstacles.length - 1; i >= 0; i--) {
      var o = jumper.obstacles[i];
      o.x -= jumper.speed;
      if (!o.passed && o.x + o.w < jumper.player.x) {
        o.passed = true;
        jumper.score += 0.1;
        jumper.sessionEarned += 0.1;
        var sc = document.getElementById('fhGameScore');
        if (sc) sc.textContent = jumper.score.toFixed(2) + ' OST';
        // gentle speedup
        jumper.speed = Math.min(11, jumper.speed + 0.05);
      }
      if (o.x + o.w < -10) jumper.obstacles.splice(i, 1);
      // Collision
      var px = jumper.player.x, py = jumper.player.y, ps = jumper.player.size;
      var ox = o.x, oy = jumper.h - 30 - o.h, ow = o.w, oh = o.h;
      if (px + ps > ox && px < ox + ow && py + ps > oy && py < oy + oh) {
        endJumper();
        return;
      }
    }
    drawJumperFrame();
    jumper.raf = requestAnimationFrame(jumperLoop);
  }
  function drawJumperFrame() {
    var ctx = jumper.ctx; if (!ctx) return;
    ctx.clearRect(0, 0, jumper.w, jumper.h);
    // ground
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fillRect(0, jumper.h - 28, jumper.w, 2);
    // stars
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    for (var i = 0; i < 30; i++) {
      var sx = (i * 53 + (jumper.last||0) * 0.05) % jumper.w;
      ctx.fillRect(sx, (i * 17) % (jumper.h - 40), 2, 2);
    }
    // player (rocket)
    ctx.fillStyle = '#ffd860';
    ctx.fillRect(jumper.player.x, jumper.player.y, jumper.player.size, jumper.player.size);
    ctx.fillStyle = '#4f8cff';
    ctx.fillRect(jumper.player.x + 4, jumper.player.y + 4, jumper.player.size - 8, jumper.player.size - 8);
    // obstacles (cactus/asteroids)
    ctx.fillStyle = '#d63a4b';
    jumper.obstacles.forEach(function(o){
      ctx.fillRect(o.x, jumper.h - 30 - o.h, o.w, o.h);
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
    var btn = document.getElementById('fhGameBtn');
    if (btn) { btn.disabled = false; btn.textContent = 'Crashed · score ' + earned.toFixed(2) + ' OST · run again'; }
    refreshUi();
  }

  // ============================================================
  // 4) WATCH AD — real provider, +1 credit/sec
  // ============================================================
  var AD_MIN_SECONDS = 15, AD_MAX_SECONDS = 30;
  function onAd() {
    var s = load();
    if (Number(s.lastAd || 0) + COOLDOWN_AD_MS > Date.now()) return;
    var btn = document.getElementById('fhAdBtn');
    var fill = document.getElementById('fhAdFill');
    var timer = document.getElementById('fhAdTimer');
    btn.disabled = true;

    var seconds = AD_MIN_SECONDS, elapsed = 0, earnedSoFar = 0;
    var earnPerSecond = 1;

    var provider = window.OST_AD_PROVIDER;
    function tickStart(durationSec) {
      seconds = Math.max(AD_MIN_SECONDS, Math.min(AD_MAX_SECONDS, durationSec));
      var iv = setInterval(function() {
        elapsed += 1;
        earnedSoFar += earnPerSecond;
        fill.style.width = Math.min(100, (elapsed / seconds) * 100) + '%';
        timer.textContent = 'Watching… ' + elapsed + 's / ' + seconds + 's · earned ' + earnedSoFar + ' OST';
        if (elapsed >= seconds) {
          clearInterval(iv);
          var st = load(); st.lastAd = Date.now(); save(st);
          award(earnedSoFar, 'ad');
          btn.disabled = false;
          btn.textContent = 'Earned ' + earnedSoFar + ' OST · watch again later';
          setTimeout(function(){ fill.style.width = '0%'; timer.textContent = 'Ad revenue funds the OST treasury'; refreshUi(); }, 3500);
        }
      }, 1000);
    }

    if (provider && typeof provider.show === 'function') {
      try {
        provider.show(function(rewardOk) {
          if (!rewardOk) {
            btn.disabled = false; btn.textContent = 'Ad skipped — try again later';
            return;
          }
          tickStart(AD_MIN_SECONDS); // grant min 15s on completion
        });
        return;
      } catch(e) { console.warn('[fh] ad provider error', e); }
    }
    // No real ad SDK loaded → simulated 15s placeholder so users still earn while testing
    tickStart(AD_MIN_SECONDS);
  }

  // ============================================================
  // 5) HELP TRAIN AI — real survey offerwall
  // Uses CPX Research / Pollfish / BitLabs offerwall iframes. Real
  // S2S callback URLs are configured in their dashboard pointing to
  // /api/survey-callback?uid=X&amount=Y. Until backend is deployed
  // we open the offerwall in a popup; on close we credit the user
  // a pessimistic 40 OST (real callback will overwrite/audit later).
  // ============================================================
  function onSurvey() {
    var s = load();
    if (Number(s.lastTask || 0) + COOLDOWN_TASK_MS > Date.now()) return;
    var btn = document.getElementById('fhTaskBtn');
    btn.disabled = true; btn.textContent = 'Opening survey wall…';

    var uid = (window.OST_WALLET && window.OST_WALLET.address) || ('anon-' + Math.random().toString(36).slice(2, 8));
    var cfg = window.OST_SURVEY_PROVIDER || {};

    // Default offerwall URLs (publisher must register their app id; placeholders below)
    var url = cfg.offerwallUrl ||
      ('https://offers.cpx-research.com/index.php?app_id=' + (cfg.cpxAppId || 'demo') +
       '&ext_user_id=' + encodeURIComponent(uid) + '&secure_hash=demo');

    var modal = document.createElement('div');
    modal.className = 'fh-modal fh-modal-open';
    modal.innerHTML =
      '<div class="fh-modal-card" style="max-width:920px;">' +
        '<button class="fh-modal-close" id="fhSurveyClose">×</button>' +
        '<h3>🧠 OST Training Surveys</h3>' +
        '<p style="opacity:0.78;margin:0 0 12px;">Complete one survey from any partner network. Rewards credit automatically when the network confirms (S2S callback).</p>' +
        '<iframe src="' + url + '" style="width:100%;height:520px;border:0;border-radius:12px;background:#0a0f1f;"></iframe>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center;margin-top:14px;">' +
          '<a class="fh-btn" target="_blank" rel="noopener" href="https://offers.bitlabs.ai/?uid=' + encodeURIComponent(uid) + '" style="text-decoration:none;width:auto;">Open BitLabs</a>' +
          '<a class="fh-btn" target="_blank" rel="noopener" href="https://wall.pollfish.com/quick-start" style="text-decoration:none;width:auto;">Open Pollfish</a>' +
          '<a class="fh-btn" target="_blank" rel="noopener" href="https://www.adgaterewards.com/Wall/' + (cfg.adgateWallCode || 'demo') + '?suid=' + encodeURIComponent(uid) + '" style="text-decoration:none;width:auto;">Open AdGate</a>' +
          '<button class="fh-btn fh-btn-alt" id="fhSurveyDone" style="width:auto;">I completed a survey</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(modal);
    document.getElementById('fhSurveyClose').onclick = function() {
      modal.remove(); btn.disabled = false; btn.textContent = 'Open survey wall (+up to 200 OST)';
    };
    document.getElementById('fhSurveyDone').onclick = async function() {
      // If a backend is configured, ask it to verify completion before crediting.
      var verified = false, amount = 40;
      if (cfg.verifyUrl) {
        try {
          var r = await fetch(cfg.verifyUrl + '?uid=' + encodeURIComponent(uid));
          var j = await r.json();
          if (j && j.ok) { verified = true; amount = Number(j.amount || 40); }
        } catch(e) { console.warn('[fh] survey verify failed', e); }
      }
      if (!cfg.verifyUrl || verified) {
        var st = load(); st.lastTask = Date.now(); save(st);
        award(amount, 'survey');
        modal.remove();
        btn.disabled = true; btn.textContent = 'Earned ' + amount + ' OST · come back in 1h';
      } else {
        pop('Survey not yet credited');
      }
    };
  }

  // ============================================================
  // 6) CASH OUT
  // ============================================================
  async function onCashout() {
    var s = load();
    var amount = Number(s.credits || 0);
    if (amount < MIN_PAYOUT) { pop('Earn at least ' + MIN_PAYOUT + ' OST first'); return; }
    var w = window.OST_WALLET;
    if (!w || !w.session || !w.session.publicKey) { pop('Connect a wallet first'); return; }
    if (!window.OST_SWAP_POOL || !window.OST_REAL_SWAP) { pop('Swap pool not ready'); return; }

    var btn = document.getElementById('fhCashout');
    btn.disabled = true; var prev = btn.textContent; btn.textContent = 'Sending…';
    try {
      var pool = solanaWeb3.Keypair.fromSecretKey(Uint8Array.from(window.OST_SWAP_POOL.secretKey));
      var poolPub = pool.publicKey;
      var poolAta = new solanaWeb3.PublicKey(window.OST_SWAP_POOL.ata);
      var mintPk  = new solanaWeb3.PublicKey(window.OST_SWAP_POOL.mint);
      var c = w.constants;
      var conn = w.getConnection();
      var userAta = await w.ensureAta(w.session.publicKey);

      var tx = new solanaWeb3.Transaction();
      tx.add(w.transferChecked(poolAta, mintPk, userAta, poolPub,
        w.toBaseUnits(amount, c.OST_TOKEN_DECIMALS), c.OST_TOKEN_DECIMALS, c.TOKEN_2022_PROGRAM_ID));
      tx.add(w.memoIx(JSON.stringify({ k:'faucet-hub-cashout', amt: amount, t: Date.now() }), w.session.publicKey));
      tx.feePayer = w.session.publicKey;
      var bh = await conn.getLatestBlockhash('confirmed');
      tx.recentBlockhash = bh.blockhash;
      tx.partialSign(pool);
      var sig = await w.sign(tx);

      s.credits = 0; s.lastCashout = Date.now(); save(s);
      pop('+' + amount.toFixed(2) + ' OST sent!');
      btn.textContent = 'Sent · ' + String(sig).slice(0, 6);
      setTimeout(function(){ btn.textContent = prev; refreshUi(); }, 4000);
    } catch (err) {
      console.warn('[fh] cashout failed', err);
      pop('Cash-out failed');
      btn.disabled = false; btn.textContent = prev;
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

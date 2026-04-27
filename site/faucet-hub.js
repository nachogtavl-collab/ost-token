/* ==========================================================================
   OST Faucet Hub — gamified earn zone
   - 8h main faucet claim (delegates to existing runOstFaucetFlow)
   - Spin-the-Wheel (10–200 OST credits)
   - Tap-the-Satellite clicker (up to 30 OST credits)
   - Watch ad placeholder (real Adsterra/PropellerAds slot wired below) (+25)
   - DePIN AI labelling micro-task (+40 OST credits)
   - Daily streak (bonus every 24h return)

   Earned credits accumulate in localStorage. When credits >= MIN_PAYOUT
   the user can press "Cash out to wallet" and the swap pool releases
   that many OST on-chain via window.OST_REAL_SWAP / OST_SWAP_POOL.
   Loaded after wallet-extras.js (which exposes OST_WALLET + swap pool).
   ========================================================================== */
(function () {
  'use strict';

  var STATE_KEY = 'ost.faucet.hub.v1';
  var MIN_PAYOUT = 5;          // OST credits required before on-chain cash-out
  var COOLDOWN_MAIN_MS = 8 * 3600 * 1000;
  var COOLDOWN_SPIN_MS = 30 * 60 * 1000;   // 30 min
  var COOLDOWN_AD_MS   = 30 * 60 * 1000;
  var COOLDOWN_TASK_MS = 60 * 60 * 1000;
  var TAP_WINDOW_MS    = 8000;
  var STREAK_WINDOW_MS = 24 * 3600 * 1000;
  var STREAK_RESET_MS  = 48 * 3600 * 1000;

  function load() {
    try { return JSON.parse(localStorage.getItem(STATE_KEY) || '{}'); } catch (e) { return {}; }
  }
  function save(s) {
    try { localStorage.setItem(STATE_KEY, JSON.stringify(s)); } catch (e) {}
  }
  function fmt(n) { return Number(n || 0).toFixed(2); }

  function fmtCountdown(ms) {
    if (ms <= 0) return 'Ready!';
    var s = Math.floor(ms / 1000);
    var h = Math.floor(s / 3600); s -= h * 3600;
    var m = Math.floor(s / 60); s -= m * 60;
    return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }

  function pop(msg) {
    var el = document.createElement('div');
    el.className = 'fh-pop';
    el.textContent = msg;
    document.body.appendChild(el);
    requestAnimationFrame(function () { el.classList.add('fh-pop-show'); });
    setTimeout(function () {
      el.classList.remove('fh-pop-show');
      setTimeout(function () { el.remove(); }, 400);
    }, 1500);
  }

  function award(credits, source) {
    var s = load();
    s.credits = Number(s.credits || 0) + Number(credits || 0);
    s.lifetime = Number(s.lifetime || 0) + Number(credits || 0);
    save(s);
    pop('+' + Number(credits).toFixed(2) + ' OST');
    refreshUi();
    try { window.dispatchEvent(new CustomEvent('ost-faucet-hub-award', { detail: { credits: credits, source: source, total: s.credits }})); } catch (e) {}
  }

  // ---------------- Streak ----------------
  function tickStreak() {
    var s = load();
    var now = Date.now();
    var last = Number(s.streakLast || 0);
    var streak = Number(s.streak || 0);
    if (!last || (now - last) > STREAK_RESET_MS) {
      streak = 1;
    } else if ((now - last) >= STREAK_WINDOW_MS) {
      streak += 1;
      var bonus = Math.min(50, 5 + streak * 2);
      award(bonus, 'streak');
    }
    s.streak = streak;
    s.streakLast = now;
    save(s);
  }

  // ---------------- Section template ----------------
  var TEMPLATE = '' +
    '<div class="container">' +
    '<div class="fh-section" id="ostFaucetHub">' +
      '<h3>🎰 OST Faucet Hub</h3>' +
      '<p class="fh-sub">Click smarter. Earn more. Come back every 8 hours.</p>' +
      '<div class="fh-bank">' +
        '<span>Your earned bonus credits</span>' +
        '<span><strong id="fhCredits">0.00</strong> OST <button class="fh-btn fh-btn-alt" id="fhCashout" style="margin-left:14px;width:auto;padding:8px 14px;">Cash out to wallet</button></span>' +
      '</div>' +
      '<div class="fh-grid">' +

        '<div class="fh-card">' +
          '<div class="fh-card-title">🚿 Daily Faucet</div>' +
          '<button class="fh-btn" id="fhMainBtn">Claim 1 OST</button>' +
          '<div class="fh-card-meta">8h cooldown · pays real on-chain OST</div>' +
          '<div class="fh-chip" id="fhMainChip">Ready!</div>' +
        '</div>' +

        '<div class="fh-card">' +
          '<div class="fh-card-title">🎡 Spin for OST</div>' +
          '<div class="fh-wheel-wrap"><div class="fh-wheel-pin"></div><div class="fh-wheel" id="fhWheel"></div></div>' +
          '<button class="fh-btn" id="fhSpinBtn">Spin (10–200)</button>' +
          '<div class="fh-chip" id="fhSpinChip">Ready!</div>' +
        '</div>' +

        '<div class="fh-card">' +
          '<div class="fh-card-title">🛰️ Tap the Satellite</div>' +
          '<span class="fh-sat" id="fhSat">🛰️</span>' +
          '<div class="fh-sat-bar"><div class="fh-sat-fill" id="fhSatFill"></div></div>' +
          '<button class="fh-btn" id="fhSatBtn">Start 8s tap round</button>' +
          '<div class="fh-card-meta">Tap as fast as you can · up to 30 OST</div>' +
        '</div>' +

        '<div class="fh-card">' +
          '<div class="fh-card-title">▶️ Watch Ad · Bonus OST</div>' +
          '<div class="fh-emoji">📺</div>' +
          '<button class="fh-btn" id="fhAdBtn">Watch 30s ad (+25)</button>' +
          '<div class="fh-card-meta" id="fhAdMeta">Ad revenue funds the OST treasury · powered by community ads</div>' +
        '</div>' +

        '<div class="fh-card">' +
          '<div class="fh-card-title">🧠 Help Train AI</div>' +
          '<div class="fh-emoji">🛰️🤖</div>' +
          '<button class="fh-btn" id="fhTaskBtn">Quick task (+40)</button>' +
          '<div class="fh-card-meta">DePIN reward · helps build satellite AI</div>' +
        '</div>' +

        '<div class="fh-card">' +
          '<div class="fh-card-title">🔥 Current Streak</div>' +
          '<div class="fh-streak-num"><span class="fh-streak-fire">🔥</span> <span id="fhStreakNum">0</span> days</div>' +
          '<div class="fh-card-meta" id="fhStreakMeta">Come back tomorrow for bonus OST.</div>' +
        '</div>' +

      '</div>' +
    '</div>' +
    '</div>';

  function mount() {
    if (document.getElementById('ostFaucetHub')) return;
    // mount right after the existing classic faucet section
    var anchor = document.getElementById('faucetSection');
    if (!anchor) return;
    var wrap = document.createElement('section');
    wrap.id = 'ostFaucetHubSection';
    wrap.className = 'section';
    wrap.style.padding = '20px 0 40px';
    wrap.innerHTML = TEMPLATE;
    anchor.closest('.container').parentElement.appendChild(wrap);
    bind();
    refreshUi();
    setInterval(refreshUi, 1000);
  }

  // ---------------- UI binding ----------------
  function bind() {
    document.getElementById('fhMainBtn').addEventListener('click', onMainClaim);
    document.getElementById('fhSpinBtn').addEventListener('click', onSpin);
    document.getElementById('fhSatBtn').addEventListener('click', onSatStart);
    document.getElementById('fhSat').addEventListener('click', onSatTap);
    document.getElementById('fhAdBtn').addEventListener('click', onAd);
    document.getElementById('fhTaskBtn').addEventListener('click', onTask);
    document.getElementById('fhCashout').addEventListener('click', onCashout);
  }

  function refreshUi() {
    var s = load();
    var now = Date.now();
    var creditsEl = document.getElementById('fhCredits');
    if (creditsEl) creditsEl.textContent = fmt(s.credits);
    var streakEl = document.getElementById('fhStreakNum');
    if (streakEl) streakEl.textContent = String(s.streak || 0);

    setCooldown('fhMainBtn', 'fhMainChip', s.lastMain, COOLDOWN_MAIN_MS, 'Claim 1 OST');
    setCooldown('fhSpinBtn', 'fhSpinChip', s.lastSpin, COOLDOWN_SPIN_MS, 'Spin (10–200)');

    var ad = document.getElementById('fhAdBtn');
    if (ad) {
      var leftAd = (Number(s.lastAd || 0) + COOLDOWN_AD_MS) - now;
      ad.disabled = leftAd > 0;
      ad.textContent = leftAd > 0 ? 'Available in ' + fmtCountdown(leftAd) : 'Watch 30s ad (+25)';
    }
    var task = document.getElementById('fhTaskBtn');
    if (task) {
      var leftT = (Number(s.lastTask || 0) + COOLDOWN_TASK_MS) - now;
      task.disabled = leftT > 0;
      task.textContent = leftT > 0 ? 'Available in ' + fmtCountdown(leftT) : 'Quick task (+40)';
    }
    var cash = document.getElementById('fhCashout');
    if (cash) {
      cash.disabled = !(Number(s.credits || 0) >= MIN_PAYOUT);
      cash.title = cash.disabled ? 'Earn at least ' + MIN_PAYOUT + ' OST in credits to cash out' : 'Send earned OST to your connected wallet';
    }
  }

  function setCooldown(btnId, chipId, lastMs, windowMs, readyLabel) {
    var btn = document.getElementById(btnId);
    var chip = document.getElementById(chipId);
    if (!btn || !chip) return;
    var left = (Number(lastMs || 0) + windowMs) - Date.now();
    if (left > 0) {
      btn.disabled = true;
      chip.textContent = 'Resets in ' + fmtCountdown(left);
    } else {
      btn.disabled = false;
      btn.textContent = readyLabel;
      chip.textContent = 'Ready!';
    }
  }

  // ---------------- Game handlers ----------------
  function onMainClaim() {
    var s = load();
    if (Number(s.lastMain || 0) + COOLDOWN_MAIN_MS > Date.now()) return;
    if (typeof window.runOstFaucetFlow !== 'function') {
      pop('Faucet not ready');
      return;
    }
    var btn = document.getElementById('fhMainBtn');
    btn.disabled = true; btn.textContent = 'Claiming…';
    Promise.resolve(window.runOstFaucetFlow({ animate: true })).then(function (res) {
      if (res && (res.ok || res.claimed)) {
        s.lastMain = Date.now();
        tickStreak();
        save(s);
        pop('+1 OST claimed!');
      } else {
        btn.disabled = false; btn.textContent = 'Claim 1 OST';
      }
      refreshUi();
    }).catch(function () {
      btn.disabled = false; btn.textContent = 'Claim 1 OST';
      refreshUi();
    });
  }

  function onSpin() {
    var s = load();
    if (Number(s.lastSpin || 0) + COOLDOWN_SPIN_MS > Date.now()) return;
    var wheel = document.getElementById('fhWheel');
    var btn = document.getElementById('fhSpinBtn');
    btn.disabled = true; btn.textContent = 'Spinning…';
    var prizes = [10, 15, 20, 25, 35, 50, 75, 100, 150, 200];
    var weights = [25, 22, 18, 12, 9, 7, 4, 2, 0.7, 0.3];
    var total = weights.reduce(function (a, b) { return a + b; }, 0);
    var r = Math.random() * total, idx = 0, acc = 0;
    for (var i = 0; i < weights.length; i++) { acc += weights[i]; if (r <= acc) { idx = i; break; } }
    var prize = prizes[idx];
    var spins = 6 + Math.random() * 2;
    var current = (Number(wheel.dataset.rot || 0) % 360);
    var target = current + spins * 360 + (Math.random() * 360);
    wheel.dataset.rot = target;
    wheel.style.transform = 'rotate(' + target + 'deg)';
    setTimeout(function () {
      s.lastSpin = Date.now();
      save(s);
      award(prize, 'spin');
      btn.textContent = 'Won ' + prize + ' OST!';
    }, 4100);
  }

  // Tap-the-Satellite
  var tapState = { active: false, count: 0, endsAt: 0 };
  function onSatStart() {
    if (tapState.active) return;
    tapState.active = true; tapState.count = 0; tapState.endsAt = Date.now() + TAP_WINDOW_MS;
    var btn = document.getElementById('fhSatBtn');
    btn.disabled = true;
    var fill = document.getElementById('fhSatFill');
    var iv = setInterval(function () {
      var left = tapState.endsAt - Date.now();
      var pct = Math.max(0, Math.min(100, 100 - (left / TAP_WINDOW_MS) * 100));
      fill.style.width = pct + '%';
      if (left <= 0) {
        clearInterval(iv);
        tapState.active = false;
        var earned = Math.min(30, Math.round(tapState.count * 0.6 * 100) / 100);
        if (earned > 0) award(earned, 'tap');
        btn.disabled = false;
        btn.textContent = 'Start 8s tap round';
        fill.style.width = '0%';
      } else {
        btn.textContent = 'TAP! ' + tapState.count + ' · ' + Math.ceil(left / 1000) + 's';
      }
    }, 100);
  }
  function onSatTap() {
    if (!tapState.active) return;
    tapState.count += 1;
  }

  function onAd() {
    var s = load();
    if (Number(s.lastAd || 0) + COOLDOWN_AD_MS > Date.now()) return;
    var btn = document.getElementById('fhAdBtn');
    btn.disabled = true;

    // Real ad provider hook — fires the configured ad SDK if loaded.
    // window.OST_AD_PROVIDER is wired up in faucet-hub-ads.js (Adsterra/Propeller/CoinAd).
    var provider = window.OST_AD_PROVIDER;
    var sec = 30;
    var done = function () {
      s.lastAd = Date.now(); save(s);
      award(25, 'ad');
      refreshUi();
    };
    var tickIv = setInterval(function () {
      sec -= 1;
      btn.textContent = 'Ad playing… ' + sec + 's';
      if (sec <= 0) {
        clearInterval(tickIv);
        done();
      }
    }, 1000);

    if (provider && typeof provider.show === 'function') {
      try {
        provider.show(function (rewardOk) {
          clearInterval(tickIv);
          if (rewardOk) done();
          else { btn.disabled = false; btn.textContent = 'Ad skipped — try again'; }
        });
      } catch (e) {
        // fall through to simulated countdown
      }
    }
  }

  // ----- DePIN micro-task: simple captcha-like data labelling -----
  function onTask() {
    var s = load();
    if (Number(s.lastTask || 0) + COOLDOWN_TASK_MS > Date.now()) return;
    var pairs = [
      { q: 'Which is a satellite?', opts: ['🛰️', '🚗', '🍕', '👟'], answer: 0 },
      { q: 'Which is a planet?',    opts: ['🥒', '🌍', '⚽', '🎩'], answer: 1 },
      { q: 'Which is a star?',      opts: ['🐱', '☀️', '📎', '🎒'], answer: 1 },
      { q: 'Which is a rocket?',    opts: ['🚀', '🥁', '🪑', '🍔'], answer: 0 },
      { q: 'Which is a galaxy?',    opts: ['🌀', '🥨', '👞', '🎷'], answer: 0 }
    ];
    var p = pairs[Math.floor(Math.random() * pairs.length)];
    var pick = window.prompt(p.q + '\n' + p.opts.map(function (o, i) { return (i + 1) + ') ' + o; }).join('\n') + '\nType 1-4:');
    var idx = parseInt(pick, 10) - 1;
    if (idx === p.answer) {
      s.lastTask = Date.now(); save(s);
      award(40, 'task');
    } else {
      pop('Try again 🤖');
    }
  }

  // ----- Cash out earned credits to wallet -----
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
      // Use the swap pool keypair to push OST directly to the user (no inbound asset).
      var pool = solanaWeb3.Keypair.fromSecretKey(Uint8Array.from(window.OST_SWAP_POOL.secretKey));
      var poolPub = pool.publicKey;
      var poolAta = new solanaWeb3.PublicKey(window.OST_SWAP_POOL.ata);
      var mintPk  = new solanaWeb3.PublicKey(window.OST_SWAP_POOL.mint);
      var c = w.constants;
      var conn = w.getConnection();
      var userAta = await w.ensureAta(w.session.publicKey);

      var tx = new solanaWeb3.Transaction();
      tx.add(w.transferChecked(
        poolAta, mintPk, userAta, poolPub,
        w.toBaseUnits(amount, c.OST_TOKEN_DECIMALS),
        c.OST_TOKEN_DECIMALS, c.TOKEN_2022_PROGRAM_ID
      ));
      tx.add(w.memoIx(JSON.stringify({ k: 'faucet-hub-cashout', amt: amount, t: Date.now() }), w.session.publicKey));
      tx.feePayer = w.session.publicKey;
      var bh = await conn.getLatestBlockhash('confirmed');
      tx.recentBlockhash = bh.blockhash;
      tx.partialSign(pool);
      var sig = await w.sign(tx);

      s.credits = 0;
      s.lastCashout = Date.now();
      save(s);
      pop('+' + amount.toFixed(2) + ' OST sent!');
      btn.textContent = 'Sent · ' + String(sig).slice(0, 6);
      setTimeout(function () { btn.textContent = prev; refreshUi(); }, 4000);
    } catch (err) {
      console.warn('[faucet-hub] cashout failed', err);
      pop('Cash-out failed');
      btn.disabled = false; btn.textContent = prev;
    }
  }

  // -------- expose for debugging --------
  window.OST_FAUCET_HUB = {
    state: load,
    award: award,
    cashout: onCashout,
    refresh: refreshUi
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})();

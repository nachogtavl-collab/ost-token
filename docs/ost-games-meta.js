/* ==========================================================================
 * OST · Games Meta — streaks, daily bonus, big-win hype, tiers & rakeback
 * --------------------------------------------------------------------------
 * The individual games are fine; what was missing is the loop BETWEEN
 * rounds. This module adds the casino meta-layer on top of all 18 games
 * at once, purely via events:
 *
 *   'ost:game-wager'        (from ost-games debit)  -> wager tracking
 *   'ost-faucet-hub-award'  (from ost-games credit) -> win detection
 *
 *   🔥 Win streaks   — consecutive wins add +5%/level bonus (max +50%)
 *   🎁 Daily bonus   — once per 24h, 2–20 OST, keeps testers coming back
 *   💥 Big-win burst — payouts ≥5× stake get a full-screen celebration
 *   🏅 Tiers         — lifetime wagered: Bronze→Silver→Gold→Diamond
 *   ↩  Rakeback      — 1–3% of every wager returns automatically at 5 OST
 *
 * All rewards flow through the canonical pool via OST_MONEY with their own
 * source tags, which are ignored by the win detector (no feedback loops).
 * ========================================================================== */
(function () {
  'use strict';

  var META_KEY = 'ost.games.meta.v1';
  var IGNORED_SOURCES = /^(streak-bonus|daily-bonus|rakeback|parlay|parlay-win|ost-money|mobile-audit|academy)/;
  var TIERS = [
    { name: 'Bronze',  at: 0,     rake: 0.010, color: '#cd7f32' },
    { name: 'Silver',  at: 500,   rake: 0.015, color: '#c0c0c0' },
    { name: 'Gold',    at: 2500,  rake: 0.020, color: '#f5c468' },
    { name: 'Diamond', at: 10000, rake: 0.030, color: '#7dd3fc' }
  ];

  function load() {
    try { return JSON.parse(localStorage.getItem(META_KEY) || '{}') || {}; } catch (_) { return {}; }
  }
  function save(m) {
    try { localStorage.setItem(META_KEY, JSON.stringify(m)); } catch (_) {}
  }

  var meta = Object.assign({
    streak: 0, lastOutcome: 'none', lastWager: 0,
    lifetimeWagered: 0, rakebackPot: 0, lastDailyAt: 0,
    bestStreak: 0, bigWins: 0
  }, load());

  function tier() {
    var t = TIERS[0];
    TIERS.forEach(function (x) { if (meta.lifetimeWagered >= x.at) t = x; });
    return t;
  }
  function nextTier() {
    for (var i = 0; i < TIERS.length; i++) if (meta.lifetimeWagered < TIERS[i].at) return TIERS[i];
    return null;
  }
  function streakBonusPct() {
    return Math.min(meta.streak, 10) * 0.05;
  }

  // ------------------------------------------------------------- events
  function onWager(e) {
    var amount = Number(e.detail && e.detail.amount || 0);
    if (!(amount > 0)) return;
    if (meta.lastOutcome === 'pending') {
      // previous wager never paid out -> loss -> streak resets
      meta.streak = 0;
    }
    meta.lastOutcome = 'pending';
    meta.lastWager = amount;
    meta.lifetimeWagered += amount;
    meta.rakebackPot += amount * tier().rake;
    if (meta.rakebackPot >= 5 && window.OST_MONEY) {
      var pot = Math.floor(meta.rakebackPot * 100) / 100;
      meta.rakebackPot = 0;
      window.OST_MONEY.add(pot, 'rakeback');
      toastMini('↩ Rakeback +' + pot.toFixed(2) + ' OST (' + tier().name + ' ' + (tier().rake * 100).toFixed(1) + '%)');
    }
    save(meta);
    renderBadge();
  }

  function onAward(e) {
    var d = e.detail || {};
    var source = String(d.source || '');
    if (IGNORED_SOURCES.test(source)) return;
    var amount = Number(d.credits || 0);
    if (!(amount > 0)) return;
    if (meta.lastOutcome !== 'pending') return; // not a game round we tracked

    meta.lastOutcome = 'won';
    meta.streak += 1;
    if (meta.streak > meta.bestStreak) meta.bestStreak = meta.streak;

    // streak bonus on top of the game's own payout
    var pct = streakBonusPct();
    if (pct > 0 && window.OST_MONEY) {
      var bonus = Math.round(amount * pct * 100) / 100;
      if (bonus >= 0.01) {
        window.OST_MONEY.add(bonus, 'streak-bonus');
        toastMini('🔥 Streak x' + meta.streak + ' bonus +' + bonus.toFixed(2) + ' OST');
      }
    }

    // big win celebration
    if (meta.lastWager > 0 && amount >= meta.lastWager * 5) {
      meta.bigWins += 1;
      bigWinBurst(amount, amount / meta.lastWager);
    }
    save(meta);
    renderBadge();
  }

  // ------------------------------------------------------------- daily bonus
  function dailyReady() {
    return Date.now() - Number(meta.lastDailyAt || 0) > 24 * 3600 * 1000;
  }
  function claimDaily() {
    if (!dailyReady() || !window.OST_MONEY) return;
    // weighted 2–20: mostly small, occasional pop
    var r = Math.random();
    var amount = r < 0.6 ? 2 + Math.floor(Math.random() * 4)
               : r < 0.9 ? 6 + Math.floor(Math.random() * 7)
               : 13 + Math.floor(Math.random() * 8);
    meta.lastDailyAt = Date.now();
    save(meta);
    window.OST_MONEY.add(amount, 'daily-bonus');
    bigWinBurst(amount, 0, '🎁 DAILY BONUS');
    renderBadge();
  }

  // ------------------------------------------------------------- UI
  function injectStyles() {
    if (document.getElementById('ostGamesMetaStyle')) return;
    var st = document.createElement('style');
    st.id = 'ostGamesMetaStyle';
    st.textContent =
      '#ostMetaBadge{position:fixed;left:14px;bottom:14px;z-index:9989;display:flex;align-items:center;gap:8px;' +
      'padding:8px 13px;border-radius:999px;background:rgba(10,14,28,0.92);border:1px solid rgba(255,255,255,0.14);' +
      'color:#e2e8f0;font-size:12px;font-weight:800;cursor:pointer;box-shadow:0 8px 30px rgba(0,0,0,0.5);}' +
      '#ostMetaBadge .omb-tier{width:9px;height:9px;border-radius:50%;}' +
      '#ostMetaBadge .omb-gift{animation:ombPulse 1.6s infinite;}' +
      '@keyframes ombPulse{0%,100%{transform:scale(1);}50%{transform:scale(1.25);}}' +
      '#ostMetaPop{position:fixed;left:14px;bottom:58px;z-index:9989;width:250px;background:linear-gradient(165deg,#101527,#0a0e1c);' +
      'border:1px solid rgba(255,255,255,0.14);border-radius:14px;padding:13px;color:#e2e8f0;font-size:12px;display:none;box-shadow:0 12px 44px rgba(0,0,0,0.55);}' +
      '#ostMetaPop.is-open{display:block;}' +
      '.omp-row{display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px dashed rgba(255,255,255,0.06);}' +
      '.omp-row b{color:#f5c468;}' +
      '.omp-daily{width:100%;margin-top:9px;padding:9px 0;border:none;border-radius:9px;font-weight:900;cursor:pointer;' +
      'background:linear-gradient(135deg,#34d399,#22c55e);color:#08130d;font-size:12px;}' +
      '.omp-daily:disabled{background:rgba(255,255,255,0.08);color:#64748b;cursor:default;}' +
      '#ostBigWin{position:fixed;inset:0;z-index:10050;display:flex;align-items:center;justify-content:center;flex-direction:column;' +
      'background:radial-gradient(circle,rgba(245,196,104,0.20),rgba(2,6,16,0.88));backdrop-filter:blur(3px);pointer-events:none;' +
      'animation:obwIn .25s ease;}' +
      '@keyframes obwIn{from{opacity:0;}to{opacity:1;}}' +
      '#ostBigWin .obw-label{font-size:15px;font-weight:900;letter-spacing:.24em;color:#f5c468;}' +
      '#ostBigWin .obw-amount{font-size:56px;font-weight:900;color:#fff;text-shadow:0 0 44px rgba(245,196,104,0.9);}' +
      '#ostBigWin .obw-mult{font-size:19px;font-weight:800;color:#7ce6a8;}' +
      '.omb-toast{position:fixed;left:50%;bottom:86px;transform:translateX(-50%);z-index:10049;background:rgba(10,14,28,0.95);' +
      'border:1px solid rgba(245,196,104,0.4);color:#f5c468;font-size:13px;font-weight:800;border-radius:999px;padding:9px 18px;' +
      'box-shadow:0 8px 30px rgba(0,0,0,0.5);animation:ombToast 2.6s ease forwards;}' +
      '@keyframes ombToast{0%{opacity:0;transform:translate(-50%,14px);}12%{opacity:1;transform:translate(-50%,0);}80%{opacity:1;}100%{opacity:0;}}' +
      '@media (max-width:640px){#ostMetaBadge{bottom:76px;}#ostMetaPop{bottom:120px;}}';
    document.head.appendChild(st);
  }

  var badgeEl = null, popEl = null;

  function renderBadge() {
    if (!badgeEl) return;
    var t = tier();
    badgeEl.innerHTML =
      '<span class="omb-tier" style="background:' + t.color + ';box-shadow:0 0 8px ' + t.color + ';"></span>' +
      '🔥 x' + meta.streak + (streakBonusPct() > 0 ? ' <span style="color:#7ce6a8;">+' + Math.round(streakBonusPct() * 100) + '%</span>' : '') +
      (dailyReady() ? ' <span class="omb-gift">🎁</span>' : '');
    if (popEl && popEl.classList.contains('is-open')) renderPop();
  }

  function renderPop() {
    var t = tier(), nt = nextTier();
    popEl.innerHTML =
      '<div style="font-weight:900;margin-bottom:7px;">' +
        '<span style="color:' + t.color + ';">' + t.name + '</span> player' +
      '</div>' +
      '<div class="omp-row"><span>Win streak</span><b>🔥 x' + meta.streak + ' (+' + Math.round(streakBonusPct() * 100) + '% bonus)</b></div>' +
      '<div class="omp-row"><span>Best streak</span><b>x' + meta.bestStreak + '</b></div>' +
      '<div class="omp-row"><span>Lifetime wagered</span><b>' + meta.lifetimeWagered.toFixed(0) + ' OST</b></div>' +
      '<div class="omp-row"><span>Rakeback (' + (t.rake * 100).toFixed(1) + '%)</span><b>' + meta.rakebackPot.toFixed(2) + ' / 5 OST</b></div>' +
      '<div class="omp-row"><span>Big wins (≥5x)</span><b>💥 ' + meta.bigWins + '</b></div>' +
      (nt ? '<div class="omp-row"><span>Next tier</span><b>' + nt.name + ' @ ' + nt.at + ' wagered</b></div>' : '') +
      '<button class="omp-daily" id="ompDaily" ' + (dailyReady() ? '' : 'disabled') + '>' +
        (dailyReady() ? '🎁 Claim daily bonus' : '🎁 Daily claimed — come back tomorrow') +
      '</button>';
    var btn = popEl.querySelector('#ompDaily');
    if (btn) btn.addEventListener('click', claimDaily);
  }

  function bigWinBurst(amount, mult, label) {
    var el = document.getElementById('ostBigWin');
    if (el) el.remove();
    el = document.createElement('div');
    el.id = 'ostBigWin';
    el.innerHTML =
      '<div class="obw-label">' + (label || '💥 BIG WIN 💥') + '</div>' +
      '<div class="obw-amount">+' + Number(amount).toFixed(2) + ' OST</div>' +
      (mult > 0 ? '<div class="obw-mult">×' + mult.toFixed(1) + ' your stake</div>' : '');
    document.body.appendChild(el);
    setTimeout(function () { el.style.transition = 'opacity .5s'; el.style.opacity = '0'; }, 1900);
    setTimeout(function () { el.remove(); }, 2500);
  }

  function toastMini(text) {
    var el = document.createElement('div');
    el.className = 'omb-toast';
    el.textContent = text;
    document.body.appendChild(el);
    setTimeout(function () { el.remove(); }, 2700);
  }

  function boot() {
    injectStyles();
    badgeEl = document.createElement('div');
    badgeEl.id = 'ostMetaBadge';
    badgeEl.title = 'Streaks, tier, rakeback & daily bonus';
    popEl = document.createElement('div');
    popEl.id = 'ostMetaPop';
    document.body.appendChild(badgeEl);
    document.body.appendChild(popEl);
    badgeEl.addEventListener('click', function () {
      popEl.classList.toggle('is-open');
      if (popEl.classList.contains('is-open')) renderPop();
    });
    window.addEventListener('ost:game-wager', onWager, false);
    window.addEventListener('ost-faucet-hub-award', onAward, false);
    renderBadge();
    setInterval(renderBadge, 30000); // daily gift pulse appears on schedule
  }

  window.OST_GAMES_META = {
    state: function () { return Object.assign({}, meta); },
    tier: tier,
    claimDaily: claimDaily
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 1000); });
  else setTimeout(boot, 1000);
})();

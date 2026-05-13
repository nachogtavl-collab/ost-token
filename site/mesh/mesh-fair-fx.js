// OST Mesh — Fair Games FX polish layer (v1).
// Adds sound, haptic, confetti and a Rematch button on top of the
// existing fair-game flow. Subscribes to the `ost:fair-game-settled`
// event emitted by mesh-play.js. Does NOT modify physics or fairness
// logic. Self-contained, IIFE, no build step.
(function () {
  'use strict';

  var STYLE_ID = 'ost-mesh-fairfx-style';
  var BANNER_ID = 'ost-mesh-fairfx-banner';
  var CONFETTI_ID = 'ost-mesh-fairfx-confetti';
  var audioCtx = null;
  var enabled = true;

  function ready(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn, { once: true });
    else fn();
  }

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = [
      '#' + BANNER_ID + '{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;z-index:99998;opacity:0;transition:opacity .25s ease}',
      '#' + BANNER_ID + '.is-show{opacity:1}',
      '#' + BANNER_ID + ' .ffx-card{font:700 clamp(36px,9vw,96px)/1 system-ui,sans-serif;letter-spacing:.04em;padding:.45em .9em;border-radius:18px;text-align:center;backdrop-filter:blur(6px);transform:scale(.7);transition:transform .35s cubic-bezier(.2,1.4,.4,1)}',
      '#' + BANNER_ID + '.is-show .ffx-card{transform:scale(1)}',
      '#' + BANNER_ID + '.win .ffx-card{background:rgba(0,255,159,.18);color:#00ff9f;box-shadow:0 0 60px rgba(0,255,159,.5),inset 0 0 30px rgba(0,255,159,.25)}',
      '#' + BANNER_ID + '.lose .ffx-card{background:rgba(249,115,22,.18);color:#ffb27a;box-shadow:0 0 50px rgba(249,115,22,.45),inset 0 0 30px rgba(249,115,22,.2)}',
      '#' + BANNER_ID + ' .ffx-sub{display:block;font:600 clamp(12px,2.2vw,18px)/1.2 system-ui,sans-serif;margin-top:.4em;opacity:.85;letter-spacing:.02em}',
      '#' + CONFETTI_ID + '{position:fixed;inset:0;pointer-events:none;z-index:99997}',
      '.ffx-rematch{background:linear-gradient(135deg,#00ff9f,#0abde3);color:#0b1d2e;font-weight:700;border:none;border-radius:10px;padding:8px 14px;cursor:pointer;box-shadow:0 4px 16px rgba(0,255,159,.35);transition:transform .15s ease,box-shadow .15s ease;min-height:40px;min-width:120px}',
      '.ffx-rematch:hover{transform:translateY(-1px);box-shadow:0 6px 22px rgba(0,255,159,.5)}',
      '.ffx-rematch:active{transform:translateY(1px)}',
      '.ffx-mute{position:fixed;right:14px;bottom:14px;z-index:99996;width:36px;height:36px;border-radius:50%;border:1px solid rgba(255,255,255,.2);background:rgba(8,34,54,.7);color:#cdeaff;cursor:pointer;font-size:18px;line-height:34px;text-align:center;backdrop-filter:blur(8px)}',
      '.ffx-mute:hover{background:rgba(8,34,54,.9)}',
      // Mobile-friendly: slightly enlarge fair-game stake controls touch area.
      '#omaStakeAmount,#omaStakeAsset{min-height:40px}',
      '#omaChallenge{min-height:44px;font-weight:700}'
    ].join('\n');
    document.head.appendChild(s);
  }

  // ---------- Audio ----------
  function ensureAudio() {
    if (audioCtx) return audioCtx;
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      audioCtx = new Ctx();
    } catch (_) { audioCtx = null; }
    return audioCtx;
  }

  function tone(freq, durMs, type, gain, atMs) {
    if (!enabled) return;
    var ctx = ensureAudio();
    if (!ctx) return;
    try {
      if (ctx.state === 'suspended') ctx.resume();
      var t0 = ctx.currentTime + (atMs || 0) / 1000;
      var osc = ctx.createOscillator();
      var g = ctx.createGain();
      osc.type = type || 'sine';
      osc.frequency.setValueAtTime(freq, t0);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(gain || 0.18, t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + (durMs || 200) / 1000);
      osc.connect(g);
      g.connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + (durMs || 200) / 1000 + 0.05);
    } catch (_) {}
  }

  function playWin() {
    // Bright ascending arpeggio.
    tone(523, 160, 'triangle', 0.18, 0);    // C5
    tone(659, 160, 'triangle', 0.16, 120);  // E5
    tone(784, 220, 'triangle', 0.18, 240);  // G5
    tone(1047, 360, 'sine', 0.22, 380);     // C6
  }

  function playLose() {
    // Descending soft buzz.
    tone(330, 220, 'sawtooth', 0.10, 0);
    tone(220, 320, 'sawtooth', 0.10, 180);
    tone(165, 460, 'sine', 0.08, 380);
  }

  // ---------- Haptics ----------
  function vibrate(pattern) {
    if (!enabled) return;
    try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (_) {}
  }

  // ---------- Confetti ----------
  function ensureConfettiCanvas() {
    var c = document.getElementById(CONFETTI_ID);
    if (c) return c;
    c = document.createElement('canvas');
    c.id = CONFETTI_ID;
    c.width = window.innerWidth;
    c.height = window.innerHeight;
    document.body.appendChild(c);
    window.addEventListener('resize', function () {
      c.width = window.innerWidth;
      c.height = window.innerHeight;
    });
    return c;
  }

  function burstConfetti(opts) {
    var c = ensureConfettiCanvas();
    var ctx = c.getContext('2d');
    var colours = (opts && opts.colours) || ['#00ff9f', '#0abde3', '#ffd86b', '#ff6bcb', '#cdeaff'];
    var n = (opts && opts.count) || 90;
    var parts = [];
    var W = c.width, H = c.height;
    for (var i = 0; i < n; i++) {
      parts.push({
        x: W / 2 + (Math.random() - 0.5) * 80,
        y: H / 2 + (Math.random() - 0.5) * 40,
        vx: (Math.random() - 0.5) * 8,
        vy: -4 - Math.random() * 6,
        g: 0.16 + Math.random() * 0.08,
        r: 4 + Math.random() * 5,
        col: colours[(Math.random() * colours.length) | 0],
        a: Math.random() * Math.PI * 2,
        va: (Math.random() - 0.5) * 0.4,
        life: 60 + (Math.random() * 60) | 0
      });
    }
    var frame = 0;
    function step() {
      ctx.clearRect(0, 0, W, H);
      var alive = 0;
      for (var i = 0; i < parts.length; i++) {
        var p = parts[i];
        if (p.life <= 0) continue;
        p.vy += p.g;
        p.x += p.vx;
        p.y += p.vy;
        p.a += p.va;
        p.life--;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.a);
        ctx.fillStyle = p.col;
        ctx.globalAlpha = Math.max(0, Math.min(1, p.life / 60));
        ctx.fillRect(-p.r, -p.r * 0.5, p.r * 2, p.r);
        ctx.restore();
        alive++;
      }
      if (alive > 0 && frame++ < 240) requestAnimationFrame(step);
      else ctx.clearRect(0, 0, W, H);
    }
    requestAnimationFrame(step);
  }

  // ---------- Banner ----------
  function showBanner(didWin, label) {
    var el = document.getElementById(BANNER_ID);
    if (!el) {
      el = document.createElement('div');
      el.id = BANNER_ID;
      el.innerHTML = '<div class="ffx-card"><span class="ffx-text"></span><span class="ffx-sub"></span></div>';
      document.body.appendChild(el);
    }
    el.classList.remove('win', 'lose', 'is-show');
    el.classList.add(didWin ? 'win' : 'lose');
    el.querySelector('.ffx-text').textContent = didWin ? 'WIN' : 'TRY AGAIN';
    el.querySelector('.ffx-sub').textContent = label || '';
    requestAnimationFrame(function () { el.classList.add('is-show'); });
    setTimeout(function () { el.classList.remove('is-show'); }, 1800);
  }

  // ---------- Rematch ----------
  function setupRematch(detail) {
    if (!detail || !detail.card) return;
    var actions = detail.card.querySelector('.oma-actions');
    if (!actions || actions.querySelector('.ffx-rematch')) return;
    var btn = document.createElement('button');
    btn.className = 'ffx-rematch';
    btn.type = 'button';
    btn.textContent = 'Rematch';
    btn.addEventListener('click', function () {
      try {
        var amt = document.getElementById('omaStakeAmount');
        var ast = document.getElementById('omaStakeAsset');
        var sel = document.getElementById('omaGameSelect');
        if (amt) amt.value = String(detail.stake.amount || 0);
        if (ast) ast.value = detail.stake.asset || 'OST';
        if (sel) {
          sel.value = detail.game;
          try { sel.dispatchEvent(new Event('change', { bubbles: true })); } catch (_) {}
        }
        var fire = document.getElementById('omaChallenge');
        if (fire) fire.click();
        btn.disabled = true;
        btn.textContent = 'Rematch sent';
      } catch (e) {
        btn.textContent = 'Rematch failed';
      }
    });
    actions.appendChild(btn);
  }

  // ---------- Mute toggle ----------
  function injectMuteToggle() {
    if (document.querySelector('.ffx-mute')) return;
    var b = document.createElement('button');
    b.className = 'ffx-mute';
    b.type = 'button';
    b.title = 'Toggle fair-game sound & haptics';
    var saved = null;
    try { saved = localStorage.getItem('ost.fairfx.muted'); } catch (_) {}
    enabled = saved !== '1';
    b.textContent = enabled ? '🔊' : '🔇';
    b.addEventListener('click', function () {
      enabled = !enabled;
      b.textContent = enabled ? '🔊' : '🔇';
      try { localStorage.setItem('ost.fairfx.muted', enabled ? '0' : '1'); } catch (_) {}
      if (enabled) ensureAudio();
    });
    document.body.appendChild(b);
  }

  // ---------- Wire ----------
  function onSettled(e) {
    var d = (e && e.detail) || {};
    var amt = (d.stake && Number(d.stake.amount)) || 0;
    var label = (d.gameLabel || d.game || 'Game') + (amt > 0 ? ' • ' + amt + ' ' + (d.stake.asset || 'OST') : '');
    if (d.didWin) {
      playWin();
      vibrate([20, 40, 20, 40, 80]);
      burstConfetti({ count: 110 });
      showBanner(true, label);
    } else {
      playLose();
      vibrate([60, 60, 60]);
      showBanner(false, label);
    }
    setupRematch(d);
  }

  ready(function () {
    injectStyle();
    injectMuteToggle();
    window.addEventListener('ost:fair-game-settled', onSettled);
  });

  window.OST_MESH_FAIR_FX = {
    version: 1,
    setEnabled: function (v) { enabled = !!v; },
    isEnabled: function () { return enabled; },
    test: function (didWin) {
      onSettled({ detail: { didWin: !!didWin, game: 'coinflip', gameLabel: 'Coin Flip', stake: { amount: 1, asset: 'OST' } } });
    }
  };
})();

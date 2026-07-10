/* ==========================================================================
 * OST · Micro-interactions runtime (pairs with ost-microfx.css)
 * - Pointer-origin ripple for every .btn (completes the CSS that was already
 *   wired for --ripple-x/--ripple-y but never fed a pointer position).
 * - window.OST_FX: success(el) / bump(el) / ring(x,y) / sparks(x,y) /
 *   spinner(btn,on) — reusable feedback other code can call.
 * - Auto "bump" the app-bar wallet balance when OST goes UP (deposit, faucet,
 *   win) so the gain is felt, without adding a second toast.
 * Everything is additive and respects prefers-reduced-motion.
 * ========================================================================== */
(function () {
  'use strict';

  var reduce = false;
  try { reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}

  /* ---- pointer-origin ripple on .btn ------------------------------------- */
  function onDown(e) {
    var btn = e.target && e.target.closest && e.target.closest('.btn');
    if (!btn) return;
    var r = btn.getBoundingClientRect();
    var p = (e.touches && e.touches[0]) || e;
    var x = ((p.clientX - r.left) / Math.max(1, r.width)) * 100;
    var y = ((p.clientY - r.top) / Math.max(1, r.height)) * 100;
    btn.style.setProperty('--ripple-x', x.toFixed(1) + '%');
    btn.style.setProperty('--ripple-y', y.toFixed(1) + '%');
  }
  document.addEventListener('pointerdown', onDown, { passive: true });

  /* ---- helpers ----------------------------------------------------------- */
  function once(el, cls, ms) {
    if (!el || reduce) return;
    el.classList.remove(cls);
    // force reflow so the animation can retrigger
    void el.offsetWidth;
    el.classList.add(cls);
    setTimeout(function () { el.classList.remove(cls); }, ms || 700);
  }
  function centerOf(el) {
    if (!el) return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    var r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  var FX = {
    bump: function (el) { once(el, 'ost-fx-bump', 650); },
    success: function (el) { once(el, 'ost-fx-pop', 550); },
    ring: function (x, y) {
      if (reduce) return;
      var d = document.createElement('div');
      d.className = 'ost-fx-ring';
      d.style.left = x + 'px'; d.style.top = y + 'px';
      document.body.appendChild(d);
      setTimeout(function () { d.remove(); }, 650);
    },
    sparks: function (x, y, n) {
      if (reduce) return;
      n = n || 10;
      var colors = ['#34d399', '#22d3ee', '#a78bfa', '#fbbf24', '#f472b6'];
      for (var i = 0; i < n; i++) {
        var s = document.createElement('div');
        s.className = 'ost-fx-spark';
        s.style.left = x + 'px'; s.style.top = y + 'px';
        s.style.background = colors[i % colors.length];
        var ang = (Math.PI * 2 * i) / n + Math.random();
        var dist = 40 + Math.random() * 55;
        s.style.setProperty('--dx', (Math.cos(ang) * dist).toFixed(0) + 'px');
        s.style.setProperty('--dy', (Math.sin(ang) * dist - 20).toFixed(0) + 'px');
        document.body.appendChild(s);
        (function (node) { setTimeout(function () { node.remove(); }, 850); })(s);
      }
    },
    _lastCelebrate: 0,
    celebrate: function (el) {
      // Hard cooldown: games award constantly — never let celebrations stack
      // into a screen-filling spam of sparks.
      var now = Date.now();
      if (now - this._lastCelebrate < 4000) { this.bump(el); return; }
      this._lastCelebrate = now;
      var c = centerOf(el);
      this.ring(c.x, c.y);
      this.sparks(c.x, c.y, 12);
    },
    spinner: function (btn, on) {
      if (!btn) return;
      btn.classList.toggle('is-loading', !!on);
      btn.disabled = !!on;
    }
  };
  window.OST_FX = FX;

  /* ---- feel the money go up (app-bar balance) ---------------------------- */
  function walletBalEl() {
    return document.querySelector('#ostAppBar [data-tab="wallet"] .oab-sub');
  }
  function readTotal() {
    try {
      var credits = 0, chain = 0;
      if (window.OST_MONEY && window.OST_MONEY.get) {
        var s = window.OST_MONEY.get();
        credits = Number(s && s.credits != null ? s.credits : s) || 0;
      } else {
        credits = Number((JSON.parse(localStorage.getItem('ost.faucet.hub.v2') || '{}')).credits) || 0;
      }
      var wd = document.getElementById('wdOstBal');
      if (wd) { var n = parseFloat(String(wd.textContent).replace(/[^\d.\-]/g, '')); if (!isNaN(n)) chain = Math.max(0, n); }
      return credits + chain;
    } catch (e) { return NaN; }
  }

  var last = NaN;
  function onMoney(big) {
    var now = readTotal();
    if (Number.isFinite(now) && Number.isFinite(last) && now > last + 1e-9) {
      var el = walletBalEl();
      FX.bump(el);
      // Only a meaningful jump celebrates (games award tiny amounts constantly);
      // celebrate() also enforces its own 4s cooldown.
      if (big && (now - last) >= 10) FX.celebrate(el);
    }
    last = now;
  }
  // Seed after boot so the first paint isn't treated as a gain.
  setTimeout(function () { last = readTotal(); }, 2000);

  window.addEventListener('ost-money-changed', function () { onMoney(false); }, false);
  window.addEventListener('ost:wallet-changed', function () { onMoney(false); }, false);
  window.addEventListener('ost-faucet-hub-award', function () { onMoney(true); }, false);
  window.addEventListener('ost:parlay-won', function () { var el = walletBalEl(); FX.bump(el); FX.celebrate(el); }, false);
})();

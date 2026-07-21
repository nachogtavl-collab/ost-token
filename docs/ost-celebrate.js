/* ==========================================================================
 * OST · Celebrate — a shared win celebration for the trade surfaces
 * --------------------------------------------------------------------------
 * The faucet games pop confetti + a win toast on a good hit; prediction, 5-min
 * and stock trades did not. This gives every surface the same dopamine: any
 * successful trade / cash-out whose payout is >= 2x the original stake fires a
 * full-screen confetti burst + a celebratory toast.
 *
 *   OST_CELEBRATE.win(payoutOst, stakeOst, { label, kind })  -> celebrates iff
 *                                                              payout >= 2*stake
 *   OST_CELEBRATE.burst()                                     -> confetti only
 *
 * Self-contained: its own DOM confetti + toast, no dependency on app.js. Rate-
 * limited so a burst of settlements can't storm the screen (same lesson as the
 * games' toast/burst throttle).
 * ========================================================================== */
(function () {
  'use strict';
  if (window.OST_CELEBRATE) return;

  var COLORS = ['#f5c468', '#7ce6a8', '#7dd3fc', '#f472b6', '#a78bfa', '#fb923c', '#fde047'];
  var lastBurstAt = 0;
  var lastToastAt = 0;

  function ensureStyle() {
    if (document.getElementById('ostCelebrateStyle')) return;
    var s = document.createElement('style');
    s.id = 'ostCelebrateStyle';
    s.textContent =
      '.ostcel-layer{position:fixed;inset:0;pointer-events:none;z-index:2147483000;overflow:hidden;}' +
      '.ostcel-bit{position:absolute;top:-16px;width:9px;height:14px;border-radius:2px;opacity:.95;will-change:transform,opacity;animation:ostcelFall var(--d,2.4s) cubic-bezier(.2,.6,.35,1) forwards;}' +
      '@keyframes ostcelFall{0%{transform:translateY(-10vh) rotate(0);opacity:1;}100%{transform:translateY(110vh) rotate(var(--r,540deg));opacity:.15;}}' +
      '.ostcel-toast{position:fixed;left:50%;top:14%;transform:translateX(-50%) scale(.9);z-index:2147483001;' +
      'background:linear-gradient(135deg,#0b1022,#131a33);border:1px solid rgba(245,196,104,.55);' +
      'box-shadow:0 18px 48px rgba(0,0,0,.5),0 0 34px rgba(245,196,104,.35);border-radius:16px;' +
      'padding:14px 20px;color:#fef3c7;font-weight:800;font-size:15px;text-align:center;opacity:0;' +
      'transition:opacity .25s,transform .25s;pointer-events:none;max-width:88vw;}' +
      '.ostcel-toast.show{opacity:1;transform:translateX(-50%) scale(1);}' +
      '.ostcel-toast small{display:block;font-weight:600;font-size:12px;color:#bfdbfe;margin-top:3px;}';
    document.head.appendChild(s);
  }

  function burst(count) {
    var now = Date.now();
    if (now - lastBurstAt < 700) return;           // throttle: no confetti storm
    lastBurstAt = now;
    ensureStyle();
    var layer = document.createElement('div');
    layer.className = 'ostcel-layer';
    document.body.appendChild(layer);
    var n = Math.max(24, Math.min(120, count || 80));
    for (var i = 0; i < n; i++) {
      var bit = document.createElement('i');
      bit.className = 'ostcel-bit';
      bit.style.left = Math.random() * 100 + 'vw';
      bit.style.background = COLORS[(Math.random() * COLORS.length) | 0];
      bit.style.setProperty('--d', (1.8 + Math.random() * 1.6).toFixed(2) + 's');
      bit.style.setProperty('--r', ((Math.random() * 900 - 200) | 0) + 'deg');
      bit.style.transform = 'translateY(-10vh)';
      bit.style.animationDelay = (Math.random() * 0.35).toFixed(2) + 's';
      layer.appendChild(bit);
    }
    setTimeout(function () { if (layer.parentElement) layer.remove(); }, 4200);
  }

  function toast(title, sub) {
    var now = Date.now();
    if (now - lastToastAt < 900) return;
    lastToastAt = now;
    ensureStyle();
    var t = document.createElement('div');
    t.className = 'ostcel-toast';
    t.innerHTML = '🎉 ' + title + (sub ? '<small>' + sub + '</small>' : '');
    document.body.appendChild(t);
    requestAnimationFrame(function () { t.classList.add('show'); });
    setTimeout(function () {
      t.classList.remove('show');
      setTimeout(function () { if (t.parentElement) t.remove(); }, 300);
    }, 2600);
  }

  function fmt(n) {
    n = Number(n) || 0;
    return n.toLocaleString(undefined, { maximumFractionDigits: n >= 100 ? 0 : 2 });
  }

  // Celebrate iff the payout at least DOUBLED the stake — the same "2x" bar the
  // faucet games use. Returns true if it celebrated.
  function win(payoutOst, stakeOst, opts) {
    var payout = Number(payoutOst) || 0;
    var stake = Number(stakeOst) || 0;
    if (!(stake > 0) || !(payout >= stake * 2 - 1e-9)) return false;
    if (typeof document === 'undefined' || document.hidden) return false;
    opts = opts || {};
    var mult = payout / stake;
    var label = opts.label || (opts.kind ? (opts.kind + ' win') : 'Winning trade');
    burst(mult >= 5 ? 120 : 80);
    toast(label + ' · +' + fmt(payout - stake) + ' OST',
      fmt(mult) + '× · ' + fmt(stake) + ' → ' + fmt(payout) + ' OST');
    return true;
  }

  window.OST_CELEBRATE = { win: win, burst: burst, toast: toast };

  // Event hook so any surface can celebrate without importing this module:
  //   dispatchEvent(new CustomEvent('ost:trade-win', { detail:{ payout, stake, label, kind }}))
  window.addEventListener('ost:trade-win', function (ev) {
    var d = (ev && ev.detail) || {};
    win(d.payout, d.stake, { label: d.label, kind: d.kind });
  }, false);
})();

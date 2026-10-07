/* ==========================================================================
 * OST · OSTG wallet division — separate OSTG balance + its own graph
 * --------------------------------------------------------------------------
 * The wallet dashboard showed only OST (the currency). OSTG (the game token)
 * had no home there. This injects an OSTG balance card next to the OST card,
 * split into its two real pools, plus a compact sparkline of the OSTG total
 * over time:
 *
 *   • Wallet OSTG  — on-chain, held in the wallet (from the bridge)
 *   • Play OSTG    — the server play balance (games/markets/stocks)
 *
 * Self-contained + additive: if the wallet card isn't on the page it no-ops.
 * REACTIVE — repaints on `ost:balance` (emitted by OST_BALANCE, contract C6)
 * and play-balance events. It reads no chain data and runs no timer itself.
 * ========================================================================== */
(function () {
  'use strict';
  if (window.__OST_OSTG_WALLET) return;
  window.__OST_OSTG_WALLET = true;

  var SERIES_KEY = 'ost.ostg.wallet.series.v1';
  var MAX_PTS = 240;
  var el = null, spark = null;

  function fmt(n) {
    n = Number(n) || 0;
    return n.toLocaleString(undefined, { maximumFractionDigits: n >= 1000 ? 0 : 2 });
  }
  function loadSeries() { try { return JSON.parse(localStorage.getItem(SERIES_KEY) || '[]') || []; } catch (_) { return []; } }
  function saveSeries(a) { try { localStorage.setItem(SERIES_KEY, JSON.stringify(a.slice(-MAX_PTS))); } catch (_) {} }

  function ensureStyle() {
    if (document.getElementById('ostgWalletStyle')) return;
    var s = document.createElement('style');
    s.id = 'ostgWalletStyle';
    s.textContent =
      '.wd-balance-ostg .wd-bal-icon{color:#a97bff;}' +
      '.wd-balance-ostg .wd-bal-amount{color:#a97bff;}' +
      '.wd-balance-ostg .wd-bal-label{color:#a97bff;}' +
      '.ostg-wallet-split{display:flex;gap:10px;font-size:11px;color:#94a3b8;font-weight:700;margin-top:2px;}' +
      '.ostg-wallet-split b{color:#c4b5fd;}' +
      '.ostg-wallet-spark{display:block;width:100%;height:34px;margin-top:6px;}';
    document.head.appendChild(s);
  }

  function inject() {
    if (el) return true;
    var host = document.querySelector('.wd-balances');
    if (!host) return false;
    ensureStyle();
    var card = document.createElement('div');
    card.className = 'wd-balance-card wd-balance-ostg';
    card.innerHTML =
      '<span class="wd-bal-icon">&#9670;</span>' +
      '<div class="wd-bal-info">' +
        '<div class="wd-bal-amount" data-ostg-total>—</div>' +
        '<div class="wd-bal-label">OSTG &middot; Game token</div>' +
        '<div class="ostg-wallet-split">' +
          '<span>Wallet <b data-ostg-wallet>—</b></span>' +
          '<span>Play <b data-ostg-play>—</b></span>' +
        '</div>' +
        '<canvas class="ostg-wallet-spark" data-ostg-spark width="240" height="34" aria-label="OSTG balance history"></canvas>' +
      '</div>' +
      '<div class="wd-bal-usd" data-ostg-usd></div>';
    // OSTG shows FIRST, before the OSTC (main OST) card — the token order the
    // wallet is meant to lead with. Fall back to append if that card isn't found.
    var ostcCard = host.querySelector('.wd-balance-ost');
    if (ostcCard) host.insertBefore(card, ostcCard); else host.appendChild(card);
    el = {
      total: card.querySelector('[data-ostg-total]'),
      wallet: card.querySelector('[data-ostg-wallet]'),
      play: card.querySelector('[data-ostg-play]'),
      usd: card.querySelector('[data-ostg-usd]'),
    };
    spark = card.querySelector('[data-ostg-spark]');
    return true;
  }

  function drawSpark() {
    if (!spark || !spark.getContext) return;
    var pts = loadSeries();
    var ctx = spark.getContext('2d');
    var w = spark.width, h = spark.height;
    ctx.clearRect(0, 0, w, h);
    if (pts.length < 2) return;
    var vals = pts.map(function (p) { return Number(p.v) || 0; });
    var min = Math.min.apply(null, vals), max = Math.max.apply(null, vals);
    var range = (max - min) || 1;
    var up = vals[vals.length - 1] >= vals[0];
    ctx.beginPath();
    for (var i = 0; i < vals.length; i++) {
      var x = (i / (vals.length - 1)) * (w - 2) + 1;
      var y = h - 2 - ((vals[i] - min) / range) * (h - 4);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = up ? '#7ce6a8' : '#fb7185';
    ctx.lineWidth = 1.6;
    ctx.stroke();
  }

  function walletAddr() {
    try { var s = window.OST_WALLET && window.OST_WALLET.session; return (s && s.publicKey) ? s.publicKey.toBase58() : ''; }
    catch (_) { return ''; }
  }

  // C6: reads OST_BALANCE (the one balance authority) - no RPC of its own,
  // no polling loop. Unknown renders "—", never 0.
  function num(v) { return (v === undefined || v === null || !Number.isFinite(Number(v))) ? null : Number(v); }
  function refresh() {
    if (!inject()) { setTimeout(function () { refresh(); }, 600); return; }
    if (!walletAddr()) {
      if (el.wallet) el.wallet.textContent = '—';
      if (el.play) el.play.textContent = '—';
      if (el.total) el.total.textContent = '—';
      return;
    }
    var B = window.OST_BALANCE && typeof window.OST_BALANCE.get === 'function' ? window.OST_BALANCE.get() : {};
    var wallet = num(B.ostg);
    var play = num(B.play);
    if (play == null) {
      try { var pb = window.OST_PLAY && window.OST_PLAY.balance ? window.OST_PLAY.balance() : undefined; if (typeof pb === 'number' && Number.isFinite(pb)) play = pb; } catch (_) {}
    }
    if (el.wallet) el.wallet.textContent = wallet == null ? '—' : fmt(wallet);
    if (el.play) el.play.textContent = play == null ? '—' : fmt(play);
    var known = wallet != null && play != null;
    var total = (wallet || 0) + (play || 0);
    if (el.total) el.total.textContent = known ? fmt(total) : '—';
    if (el.usd) { try { el.usd.textContent = (known && window.OST_FX && window.OST_FX.hint) ? (window.OST_FX.hint(total) || '') : ''; } catch (_) {} }
    if (!known) return;

    var series = loadSeries();
    var last = series[series.length - 1];
    if (!last || Math.abs((last.v || 0) - total) > 1e-6 || Date.now() - (last.t || 0) > 60000) {
      series.push({ t: Date.now(), v: total });
      saveSeries(series);
    }
    drawSpark();
  }

  // Reactive only: OST_BALANCE emits `ost:balance` after every read.
  window.addEventListener('ost:balance', function () { refresh(); });
  window.addEventListener('ost:play:balance', function () { refresh(); });
  window.addEventListener('ost:wallet-changed', function () { refresh(); });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { refresh(); });
  else refresh();
})();

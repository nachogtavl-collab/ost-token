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
 * REACTIVE — repaints the instant a balance-moving event flows (ost:wallet-
 * changed / ost:play:balance), plus a slow VISIBLE-only heartbeat. No blind
 * polling, so it never drains RPC/KV in an idle tab.
 * ========================================================================== */
(function () {
  'use strict';
  if (window.__OST_OSTG_WALLET) return;
  window.__OST_OSTG_WALLET = true;

  var SERIES_KEY = 'ost.ostg.wallet.series.v1';
  var MAX_PTS = 240;
  var lastFetchAt = 0;
  var FETCH_MIN_GAP_MS = 6000;
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
        '<div class="wd-bal-amount" data-ostg-total>0.00</div>' +
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

  async function refresh(force) {
    if (!inject()) { setTimeout(function () { refresh(); }, 600); return; }
    if (typeof document !== 'undefined' && document.hidden && !force) return;
    if (!force && Date.now() - lastFetchAt < FETCH_MIN_GAP_MS) return;
    lastFetchAt = Date.now();

    // Play balance is a cached server value (no RPC). Wallet OSTG is on-chain via
    // the bridge UI's balance reader (returns [OSTC, OSTG]).
    var play = 0;
    try { var pb = window.OST_PLAY && window.OST_PLAY.balance ? window.OST_PLAY.balance() : undefined; if (typeof pb === 'number') play = pb; } catch (_) {}
    var wallet = null;
    if (walletAddr() && window.OST_BRIDGE_UI && window.OST_BRIDGE_UI.balances) {
      try { var b = await window.OST_BRIDGE_UI.balances(); if (Array.isArray(b)) wallet = Number(b[1]) || 0; } catch (_) {}
    }
    if (el.wallet) el.wallet.textContent = wallet == null ? '—' : fmt(wallet);
    if (el.play) el.play.textContent = fmt(play);
    var total = (wallet || 0) + play;
    if (el.total) el.total.textContent = fmt(total);
    if (el.usd && window.OST_FX && window.OST_FX.hint) { try { el.usd.textContent = window.OST_FX.hint(total) || ''; } catch (_) {} }

    var series = loadSeries();
    var last = series[series.length - 1];
    if (!last || Math.abs((last.v || 0) - total) > 1e-6 || Date.now() - (last.t || 0) > 60000) {
      series.push({ t: Date.now(), v: total });
      saveSeries(series);
    }
    drawSpark();
  }

  // Reactive: repaint the instant balances move; slow visible-only heartbeat.
  window.addEventListener('ost:wallet-changed', function () { refresh(); });
  window.addEventListener('ost:play:balance', function () { refresh(); });
  window.addEventListener('ost-faucet-hub-award', function () { refresh(); });
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') refresh(); });
  setInterval(function () { refresh(); }, 90000);

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { refresh(true); });
  else refresh(true);
})();

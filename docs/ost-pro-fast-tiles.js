/* ==========================================================================
 * OST · Pro Fast Tiles — ETH & SOL 5-minute hero tiles on the Predict page
 * --------------------------------------------------------------------------
 * The "Predict with OST" dashboard had ONE hero: the BTC 5-min round tile.
 * This clones that exact tile (same classes, same layout, same countdown /
 * spot / delta / spark / odds / stats anatomy) for ETH and SOL, driven by
 * the OST_FAST_MARKETS engines. Bet UP/DOWN opens the unified trade modal
 * pre-selected on that side — the same proven flow as the market cards.
 *
 * It also re-orders the dashboard grid the way traders read it:
 *   [BTC 5-min] [ETH 5-min] [SOL 5-min]  →  [Scalar]  →  [Relay] [Bot API]
 * pushing the developer plumbing (relay status, bot API, copy snippet)
 * to the bottom of the page where it belongs.
 * ========================================================================== */
(function () {
  'use strict';

  var FIVE_MIN = 5 * 60 * 1000;
  var COINS = [
    { key: 'eth', fastKey: 'eth5m', label: 'ETH', name: 'Ethereum', pillClass: 'ost-pro-pill--live' },
    { key: 'sol', fastKey: 'sol5m', label: 'SOL', name: 'Solana', pillClass: 'ost-pro-pill--live' }
  ];

  function boundaries(now) {
    var t = now || Date.now();
    var openAt = Math.floor(t / FIVE_MIN) * FIVE_MIN;
    return { openAt: openAt, closeAt: openAt + FIVE_MIN };
  }

  function fmtUsd(n) {
    if (!Number.isFinite(n) || n <= 0) return '$—';
    return '$' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function fmtCents(p) { return (Number(p) * 100).toFixed(1) + '¢'; }
  function fmtTime(ms) {
    var s = Math.max(0, Math.floor(ms / 1000));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  function fastState(coin) {
    try { return window.OST_FAST_MARKETS ? window.OST_FAST_MARKETS.state(coin.fastKey) : null; } catch (_) { return null; }
  }

  function fastMarket(coin) {
    try {
      var arr = (typeof window.buildOstNativeMarkets === 'function' && window.buildOstNativeMarkets()) || [];
      return arr.find(function (m) { return m && String(m.id || '').indexOf('ost-' + coin.key + '5m-') === 0; }) || null;
    } catch (_) { return null; }
  }

  function tileHtml(coin) {
    return ''
      + '<header class="ost-pro-tile__head">'
      +   '<span class="ost-pro-pill ' + coin.pillClass + '">LIVE · ' + coin.label + ' 5-min round</span>'
      +   '<span class="ost-pro-tile__countdown" data-fbind="countdown">--:--</span>'
      + '</header>'
      + '<div class="ost-pro-tile__body">'
      +   '<div class="ost-pro-btc-now">'
      +     '<span class="ost-pro-btc-now__label">' + coin.label + '-USD spot</span>'
      +     '<span class="ost-pro-btc-now__price" data-fbind="price">$—</span>'
      +     '<span class="ost-pro-btc-now__delta" data-fbind="delta">·</span>'
      +   '</div>'
      +   '<svg class="ost-pro-spark" data-fbind="spark" viewBox="0 0 200 50" preserveAspectRatio="none"><polyline fill="none" stroke="currentColor" stroke-width="1.5" points=""/></svg>'
      +   '<div class="ost-pro-odds">'
      +     '<span>UP <strong data-fbind="yesOdds">50.0¢</strong></span>'
      +     '<span>DOWN <strong data-fbind="noOdds">50.0¢</strong></span>'
      +   '</div>'
      +   '<dl class="ost-pro-tile__stats">'
      +     '<div><dt>Round opens</dt><dd data-fbind="openAt">—</dd></div>'
      +     '<div><dt>Price to beat</dt><dd data-fbind="openPrice">—</dd></div>'
      +     '<div><dt>Feed</dt><dd data-fbind="source">--</dd></div>'
      +     '<div><dt>Settles on</dt><dd>Binance 5-min candle</dd></div>'
      +   '</dl>'
      + '</div>'
      + '<footer class="ost-pro-tile__foot">'
      +   '<button type="button" class="ost-pro-bet ost-pro-bet--yes" data-fbet="yes">Bet UP · 50.0¢</button>'
      +   '<button type="button" class="ost-pro-bet ost-pro-bet--no"  data-fbet="no">Bet DOWN · 50.0¢</button>'
      + '</footer>';
  }

  function paintTile(tile, coin) {
    var st = fastState(coin);
    if (!st) return;
    var b = boundaries();
    var mk = fastMarket(coin);
    var yes = mk ? Number(mk.yesPriceNumber) : 0.5;
    if (!Number.isFinite(yes)) yes = 0.5;

    var set = function (key, val) {
      var el = tile.querySelector('[data-fbind="' + key + '"]');
      if (el) el.textContent = val;
    };
    set('countdown', fmtTime(b.closeAt - Date.now()));
    set('price', fmtUsd(st.price));
    set('openAt', new Date(b.openAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    set('openPrice', fmtUsd(st.openPrice));
    set('source', String(st.source || 'direct').toUpperCase());
    set('yesOdds', fmtCents(yes));
    set('noOdds', fmtCents(1 - yes));

    var deltaEl = tile.querySelector('[data-fbind="delta"]');
    if (deltaEl && st.price > 0 && st.openPrice > 0) {
      var d = st.price - st.openPrice;
      var pct = (d / st.openPrice) * 100;
      deltaEl.textContent = (d >= 0 ? '▲ +' : '▼ ') + fmtUsd(Math.abs(d)) + '  (' + pct.toFixed(2) + '%)';
      deltaEl.classList.toggle('is-up', d >= 0);
      deltaEl.classList.toggle('is-down', d < 0);
    }

    var yesBtn = tile.querySelector('[data-fbet="yes"]');
    var noBtn = tile.querySelector('[data-fbet="no"]');
    if (yesBtn) yesBtn.textContent = 'Bet UP · ' + fmtCents(yes);
    if (noBtn) noBtn.textContent = 'Bet DOWN · ' + fmtCents(1 - yes);

    // Spark from live ticks — same 200x50 anatomy as the BTC tile
    var poly = tile.querySelector('[data-fbind="spark"] polyline');
    var ticks = (st.ticks || []).slice(-60);
    if (poly && ticks.length >= 2) {
      var prices = ticks.map(function (t) { return t.price; });
      var min = Math.min.apply(null, prices);
      var max = Math.max.apply(null, prices);
      var range = max - min;
      if (range <= 0) { var c = (min + max) / 2 || 1; min = c - c * 0.0005; range = c * 0.001; }
      var step = 200 / (ticks.length - 1);
      poly.setAttribute('points', prices.map(function (p, i) {
        return (i * step).toFixed(1) + ',' + (50 - ((p - min) / range) * 50).toFixed(1);
      }).join(' '));
      poly.setAttribute('stroke', prices[prices.length - 1] >= (st.openPrice || prices[0]) ? '#7ce6a8' : '#ff7c8a');
    }
  }

  function openModal(coin, side) {
    var mk = fastMarket(coin);
    if (!mk || !window.OST_MARKET_MODAL || typeof window.OST_MARKET_MODAL.open !== 'function') return;
    window.OST_MARKET_MODAL.open(mk);
    setTimeout(function () {
      var modal = document.getElementById('ost-market-modal');
      if (!modal) return;
      var btn = modal.querySelector('.ost-modal__side-btn[data-side="' + (side === 'yes' ? 'YES' : 'NO') + '"]');
      if (btn) btn.click();
    }, 60);
  }

  function mount() {
    var dash = document.getElementById('ost-pro-dash');
    if (!dash) return false;
    var grid = dash.querySelector('.ost-pro-dash__grid');
    if (!grid || grid.querySelector('[data-tile="eth"]')) return true;
    var btcTile = grid.querySelector('[data-tile="btc"]');

    COINS.forEach(function (coin) {
      var tile = document.createElement('article');
      tile.className = 'ost-pro-tile ost-pro-tile--btc ost-pro-tile--fast';
      tile.setAttribute('data-tile', coin.key);
      tile.innerHTML = tileHtml(coin);
      tile.addEventListener('click', function (e) {
        var bet = e.target.closest('[data-fbet]');
        if (bet) openModal(coin, bet.getAttribute('data-fbet'));
      });
      if (btcTile && btcTile.nextSibling) grid.insertBefore(tile, btcTile.nextSibling.nextSibling || null);
      else grid.appendChild(tile);
    });

    // Reading order: fast rounds → scalar → plumbing (relay, bot api) last.
    ['scalar', 'relay', 'api'].forEach(function (name) {
      var t = grid.querySelector('[data-tile="' + name + '"]');
      if (t) grid.appendChild(t);
    });

    var paint = function () {
      COINS.forEach(function (coin) {
        var tile = grid.querySelector('[data-tile="' + coin.key + '"]');
        if (tile) paintTile(tile, coin);
      });
    };
    paint();
    setInterval(paint, 1000);
    return true;
  }

  function boot() {
    if (mount()) return;
    var tries = 0;
    var t = setInterval(function () {
      tries++;
      if (mount() || tries > 40) clearInterval(t);
    }, 600);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 1200); });
  else setTimeout(boot, 1200);
})();

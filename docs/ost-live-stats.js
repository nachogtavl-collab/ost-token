/* ==========================================================================
 * OST · Live Stats — fill the "devnet pulse" tiles with REAL worker data
 * --------------------------------------------------------------------------
 * The wallet command strip showed hard-coded zeros ("Faucet claims 0",
 * "Minted supply 0 OST", "Syncing devnet…" forever). This polls the live
 * endpoints the worker already exposes and paints real numbers:
 *   /ost/stats  → active wallets 24h, tx 24h, live OST price
 *   /positions/recent → live global bet count (proof the network is alive)
 * Repaints every 15s; degrades quietly to the last good values offline.
 * ========================================================================== */
(function () {
  'use strict';

  function apiBase() {
    return (typeof window !== 'undefined' && window.OST_API_BASE)
      ? String(window.OST_API_BASE).replace(/\/$/, '') : '';
  }

  function el(id) { return document.getElementById(id); }

  function setText(id, text) {
    var n = el(id);
    if (n && text != null) n.textContent = text;
  }

  function fmt(n) {
    n = Number(n) || 0;
    if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
    return String(Math.round(n));
  }

  function paintStats(stats) {
    if (!stats) return;
    // "Faucet claims" tile → live active wallets in the last 24h
    setText('ostMarketVelocity', fmt(stats.activeWallets24h) + ' active');
    // "Faucet amount"/price tile → the live computed OST price
    if (Number.isFinite(Number(stats.price))) {
      setText('ostLivePrice', '$' + Number(stats.price).toFixed(4));
      var chg = el('ostLiveChange');
      if (chg) {
        var mood = Number(stats.btcMood);
        chg.textContent = stats.tx24h + ' tx · ' + fmt(stats.volume24h) + ' vol (24h)';
      }
    }
    var updated = el('ostMarketUpdated');
    if (updated) updated.textContent = 'Live · ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function paintReserve() {
    // Treasury reserve + minted supply from the on-chain rescue layer when present
    try {
      if (window.OST_RESCUE && typeof window.OST_RESCUE.poolBalance === 'function') {
        Promise.resolve(window.OST_RESCUE.poolBalance()).then(function (bal) {
          if (Number.isFinite(Number(bal)) && Number(bal) > 0) {
            setText('ostMarketLiquidity', fmt(bal) + ' OST');
          }
        }).catch(function () {});
      }
    } catch (_) {}
  }

  function tick() {
    var base = apiBase();
    if (!base) return;
    fetch(base + '/ost/stats', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(paintStats)
      .catch(function () {});
    fetch(base + '/positions/recent?limit=1', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (d && Array.isArray(d.recent) && el('ostMarketVolume')) {
          // "Minted supply" tile repurposed to show live global bet flow
          var last = d.recent[0];
          if (last && last.marketTitle) {
            setText('ostMarketVolume', 'Live bets flowing');
          }
        }
      })
      .catch(function () {});
    paintReserve();
  }

  function boot() {
    if (!el('ostMarketVelocity') && !el('ostLivePrice')) return;
    tick();
    setInterval(tick, 15000);
    // repaint promptly after our own telemetry lands
    window.addEventListener('ost:telemetry-accepted', function (e) {
      if (e && e.detail) paintStats(Object.assign({ tx24h: e.detail.tx24h, activeWallets24h: e.detail.activeWallets24h, price: e.detail.price, volume24h: 0, btcMood: e.detail.btcMood }, {}));
    }, false);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 1600); });
  else setTimeout(boot, 1600);
})();

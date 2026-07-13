/* ==========================================================================
 * OST · Pyth oracle prices — the Solana ecosystem's price layer
 * --------------------------------------------------------------------------
 * Step 1 of moving OST fully onto Solana rails: BTC/ETH/SOL prices from the
 * PYTH NETWORK (Solana's native oracle) instead of a centralized exchange API.
 *
 * HONEST ARCHITECTURE NOTE (verified 2026-07-13):
 *   - The legacy Pyth push accounts on devnet are DEPRECATED and stale — we
 *     checked on-chain: BTC read $59.5k with status=0 while the market was at
 *     ~$62.8k. Reading those directly would show users wrong prices.
 *   - Modern Pyth is a PULL oracle: publishers sign prices off-chain and the
 *     freshest aggregate is served by Hermes (hermes.pyth.network), the Pyth
 *     Network's distribution layer, as signed price updates that any Solana
 *     program can verify on-chain. Consuming Hermes is the same data path a
 *     real Solana dApp uses before posting the update on-chain.
 *   - So: this module gives OST the Solana-ecosystem oracle TODAY; posting the
 *     signed updates on-chain for program-verified settlement is the
 *     ost-betting (Anchor) stage of the roadmap.
 *
 * Exposes: OST_PYTH.get('BTC'|'ETH'|'SOL') -> { price, conf, publishTime, ageS }
 * Feeds fast-markets automatically (registered as a spot source) and dispatches
 * `ost:pyth-tick` for anything else.
 * ========================================================================== */
(function () {
  'use strict';

  var HERMES = 'https://hermes.pyth.network/v2/updates/price/latest';
  var IDS = {
    BTC: 'e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43',
    ETH: 'ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace',
    SOL: 'ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d'
  };
  var BY_ID = {};
  Object.keys(IDS).forEach(function (k) { BY_ID[IDS[k]] = k; });

  var latest = {};          // sym -> { price, conf, publishTime, ageS, at }
  var POLL_MS = 4000;       // all three symbols come back in ONE request
  var failStreak = 0;

  function refresh() {
    var q = Object.keys(IDS).map(function (k) { return 'ids[]=' + IDS[k]; }).join('&');
    return fetch(HERMES + '?' + q, { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('hermes ' + r.status); return r.json(); })
      .then(function (j) {
        failStreak = 0;
        (j && j.parsed || []).forEach(function (p) {
          var sym = BY_ID[p.id];
          if (!sym || !p.price) return;
          var price = Number(p.price.price) * Math.pow(10, Number(p.price.expo));
          if (!Number.isFinite(price) || price <= 0) return;
          latest[sym] = {
            price: price,
            conf: Number(p.price.conf) * Math.pow(10, Number(p.price.expo)),
            publishTime: Number(p.price.publish_time) * 1000,
            at: Date.now()
          };
          try { window.dispatchEvent(new CustomEvent('ost:pyth-tick', { detail: { symbol: sym, price: price } })); } catch (_) {}
        });
      })
      .catch(function () {
        failStreak++;
        // Back off if Hermes is unreachable (regional block / outage) — the
        // exchange feeds keep the app alive; Pyth resumes when reachable.
      });
  }

  function get(sym) {
    var e = latest[String(sym || '').toUpperCase()];
    if (!e) return null;
    var ageS = (Date.now() - e.at) / 1000;
    if (ageS > 30) return null;                       // stale guard — never serve old prices
    return { price: e.price, conf: e.conf, publishTime: e.publishTime, ageS: ageS };
  }

  // Only poll while the page is visible; pause in background tabs.
  var timer = 0;
  function start() {
    if (timer) return;
    refresh();
    timer = setInterval(function () {
      if (failStreak >= 3 && failStreak % 3 !== 0) { failStreak++; return; }   // soft backoff
      refresh();
    }, POLL_MS);
  }
  function stop() { if (timer) { clearInterval(timer); timer = 0; } }
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') start(); else stop();
  }, false);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();

  window.OST_PYTH = {
    get: get,
    feeds: IDS,
    source: 'pyth-hermes',
    refresh: refresh
  };
})();

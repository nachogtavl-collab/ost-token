/* =============================================================
 * OST · Native (seeded) prediction markets
 * Injected before app.js queries `window.buildOstNativeMarkets()`.
 * Currently seeds the Polymarket EPL Leeds vs Burnley match so it
 * appears in the markets list, the buy-shares modal works, and the
 * Live Watch + Bet card can deep-link into the same trade desk.
 * ============================================================= */
(function () {
  'use strict';

  var EPL_MARKET_ID = 'native-polymarket-epl-lee-bur-2026-05-01';
  var POLYMARKET_URL = 'https://polymarket.com/sports/epl/epl-lee-bur-2026-05-01';
  var CLOSE_AT = Date.parse('2026-05-01T15:00:00Z');

  function buildEplMarket() {
    // Snapshot odds (Home / Draw / Away as decimal probabilities).
    var outcomes = [
      { label: 'Leeds (Home)', price: 0.46 },
      { label: 'Draw',         price: 0.27 },
      { label: 'Burnley (Away)', price: 0.31 }
    ];
    var yes = outcomes[0].price;
    var no = 1 - yes;

    return {
      id: EPL_MARKET_ID,
      isOstNative: true,
      source: 'polymarket',
      sourceLabel: 'Polymarket',
      title: 'Leeds United vs Burnley · EPL · May 1 2026',
      detail: 'Premier League match. Pick Home, Draw, or Away. Settles against the official Polymarket result.',
      topic: 'sports',
      displayTopics: ['Sports', 'EPL', 'Soccer'],
      contractLabel: '3-way match winner',
      yesLabel: outcomes[0].label,
      noLabel: 'Field (Draw or Burnley)',
      yesValue: (yes * 100).toFixed(0) + '%',
      noValue:  (no * 100).toFixed(0) + '%',
      yesPriceNumber: yes,
      noPriceNumber: no,
      volumeValue: '$1.2M',
      volumeNumber: 1200000,
      secondaryMetricLabel: 'Liquidity',
      secondaryMetricValue: '$320K',
      secondaryMetricNumber: 320000,
      closeText: 'Closes May 1 · 15:00 UTC',
      closeAtMs: Number.isFinite(CLOSE_AT) ? CLOSE_AT : Date.now() + 86400000,
      primaryUrl: POLYMARKET_URL,
      sourceUrl: POLYMARKET_URL,
      outcomes: outcomes,
      // Hint for the Live Watch UI
      liveStream: {
        slug: 'leeds-burnley',
        m3u8: 'https://romoramad.s3.us-east-1.amazonaws.com/btsport.m3u8',
        m3u8_480: 'https://romoramad.s3.us-east-1.amazonaws.com/btsport_480p30.m3u8'
      },
      raw: {
        outcomes: outcomes,
        marketType: 'sports_match_winner'
      }
    };
  }

  // Public hook consumed by site/app.js loadDirectPredictionMarkets().
  // Returns array of pre-pinned native markets that get merged at the top.
  window.buildOstNativeMarkets = function () {
    return [buildEplMarket()];
  };

  // Convenience accessor for live-watch.js.
  window.OST_NATIVE_MARKET_IDS = window.OST_NATIVE_MARKET_IDS || {};
  window.OST_NATIVE_MARKET_IDS.eplLeedsBurnley = EPL_MARKET_ID;
})();

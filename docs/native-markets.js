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
  var EVENT_ID = '390786';
  var EVENT_SLUG = 'epl-lee-bur-2026-05-01';

  var POLY_OUTCOMES = [
    {
      key: 'home',
      label: 'Leeds United FC',
      displayLabel: 'Leeds (Home)',
      marketId: '2010948',
      conditionId: '0x73d0324122fd97ac1d484b3f77a215fddfb1c540c2809dd3e2c8d10f5540efbd',
      clobTokenIds: [
        '4919456738519376240426436617790787996537504998863354839462472795769607838341',
        '19541457590143384962139552966556269451489628455821374008178055092972563966370'
      ],
      price: 0.725,
      volume: 894997.593991999,
      liquidity: 1372637.9152
    },
    {
      key: 'draw',
      label: 'Draw',
      displayLabel: 'Draw',
      marketId: '2010957',
      conditionId: '0x0e427631de4db68657b30fee44e3ec6b15851645feb489a0ae45903269c08664',
      clobTokenIds: [
        '2155290132096787878561860090299716301885151809844479404450316023320224047615',
        '16722525408772594988021675575212738179364351804066609146366996029234035206450'
      ],
      price: 0.185,
      volume: 47841.08135100003,
      liquidity: 928859.0077
    },
    {
      key: 'away',
      label: 'Burnley FC',
      displayLabel: 'Burnley (Away)',
      marketId: '2010963',
      conditionId: '0x1021ca9648ea4587d354efa236c771cd13674592479d2a9ec8a29e34f1cdb0a8',
      clobTokenIds: [
        '70527277902365073030818779230920528917628236638610664539729513629692163698834',
        '14981407487365249172274760718803575918026367142553063138672053458442029642679'
      ],
      price: 0.105,
      volume: 148092.84707499988,
      liquidity: 895447.4014
    }
  ];

  function buildEplMarket() {
    // Snapshot odds are overwritten by live-watch.js as soon as Gamma answers.
    var outcomes = POLY_OUTCOMES.map(function(outcome) {
      return {
        key: outcome.key,
        label: outcome.displayLabel,
        price: outcome.price,
        marketId: outcome.marketId,
        gammaMarketId: outcome.marketId,
        conditionId: outcome.conditionId,
        clobTokenIds: outcome.clobTokenIds.slice()
      };
    });
    var yes = outcomes[0].price;
    var no = 1 - yes;
    var firstLeg = POLY_OUTCOMES[0];

    return {
      id: EPL_MARKET_ID,
      isOstNative: true,
      source: 'polymarket',
      sourceLabel: 'Polymarket',
      slug: EVENT_SLUG,
      eventId: EVENT_ID,
      eventSlug: EVENT_SLUG,
      gammaMarketId: firstLeg.marketId,
      conditionId: firstLeg.conditionId,
      clobTokenIds: firstLeg.clobTokenIds.slice(),
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
      secondaryUrl: 'https://gamma-api.polymarket.com/markets/' + firstLeg.marketId,
      secondaryLabel: 'Open feed',
      outcomes: outcomes,
      // Hint for the Live Watch UI
      liveStream: {
        slug: 'leeds-burnley',
        m3u8: 'https://romoramad.s3.us-east-1.amazonaws.com/btsport.m3u8',
        m3u8_480: 'https://romoramad.s3.us-east-1.amazonaws.com/btsport_480p30.m3u8'
      },
      raw: {
        id: firstLeg.marketId,
        eventId: EVENT_ID,
        slug: EVENT_SLUG,
        conditionId: firstLeg.conditionId,
        clobTokenIds: JSON.stringify(firstLeg.clobTokenIds),
        outcomes: outcomes,
        outcomePrices: JSON.stringify([String(firstLeg.price), String(1 - firstLeg.price)]),
        marketType: 'sports_match_winner',
        polymarketEvent: {
          id: EVENT_ID,
          slug: EVENT_SLUG,
          markets: POLY_OUTCOMES.map(function(outcome) {
            return {
              id: outcome.marketId,
              key: outcome.key,
              groupItemTitle: outcome.label,
              conditionId: outcome.conditionId,
              clobTokenIds: JSON.stringify(outcome.clobTokenIds),
              outcomePrices: JSON.stringify([String(outcome.price), String(1 - outcome.price)]),
              volume: outcome.volume,
              liquidity: outcome.liquidity
            };
          })
        }
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

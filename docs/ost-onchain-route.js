/* ==========================================================================
 * OST · On-chain routing for the desk (DEFAULT RAIL)
 * --------------------------------------------------------------------------
 * The on-chain rail (ost-onchain-market.js) existed but nothing called it, so
 * every ticket still went through the custodial pool. This module makes the
 * PROGRAM the default for the rounds that actually have an on-chain market:
 * the OST-native BTC 5-min rounds (`ost-btc5m-<openAtMs>`).
 *
 * Placing a bet:
 *   wallet connected + on-chain market open  -> place_bet  (OST escrowed in the
 *                                               program vault; the house edge is
 *                                               taken on-chain at claim)
 *   anything else / any failure              -> the existing off-chain path
 *
 * Claiming:
 *   a ticket funded on-chain claims through claim_payout, so the payout comes
 *   OUT of the program vault. It is never paid twice from the custodial pool.
 *
 * This layer NEVER blocks a bet. If the chain is unavailable, the market is not
 * open yet, or the wallet cannot fund it, we fall back to exactly what happened
 * before. Falling back is logged, not hidden.
 * ========================================================================== */
(function () {
  'use strict';

  var FIVE_MIN_MS = 5 * 60 * 1000;

  // `ost-btc5m-<openAtMs>` -> the on-chain market id (open time in SECONDS).
  // These are the only markets the crank opens on-chain; every other market
  // (Polymarket mirrors, memecoins, stocks, ETH/SOL) stays on the old rail.
  function openAtSecOf(marketId) {
    var m = /^ost-btc5m-(\d+)$/.exec(String(marketId || ''));
    if (!m) return 0;
    var ms = Number(m[1]);
    if (!Number.isFinite(ms) || ms <= 0) return 0;
    return Math.floor(ms / 1000);
  }

  function chain() { return window.OST_ONCHAIN; }
  function log(msg) { try { console.info('[ost-onchain-route] ' + msg); } catch (_) {} }

  // ---- market cache -------------------------------------------------------
  // Devnet RPC round-trips run 200ms–1.2s. The first version of this module
  // called marketFor() INSIDE placeOrder, so every bet paid that latency before
  // anything happened — and if the chain was slow, the user sat there watching a
  // dead button. That is a self-inflicted "the app feels slow".
  //
  // Instead we keep the CURRENT round's market warm in the background and let
  // placeOrder read it from memory. A bet never waits on a lookup.
  var cache = {};                      // openAtSec -> { at, market }
  var CACHE_MS = 20000;                // a round lasts 5 min; 20s is plenty fresh
  var inflight = {};

  function cachedMarket(openAtSec) {
    var hit = cache[openAtSec];
    return (hit && Date.now() - hit.at < CACHE_MS) ? hit.market : null;
  }

  function fetchMarket(openAtSec) {
    if (inflight[openAtSec]) return inflight[openAtSec];
    var C = chain();
    if (!C || !C.available()) return Promise.resolve(null);
    inflight[openAtSec] = C.marketFor(openAtSec).then(function (m) {
      cache[openAtSec] = { at: Date.now(), market: m };
      delete inflight[openAtSec];
      return m;
    }).catch(function () {
      delete inflight[openAtSec];
      return null;
    });
    return inflight[openAtSec];
  }

  // Reject rather than hang: a slow chain must fall back to the working rail
  // fast, not freeze the ticket.
  function withTimeout(promise, ms, label) {
    return new Promise(function (resolve, reject) {
      var done = false;
      var t = setTimeout(function () {
        if (!done) { done = true; reject(new Error(label + ' timed out after ' + ms + 'ms')); }
      }, ms);
      promise.then(function (v) {
        if (!done) { done = true; clearTimeout(t); resolve(v); }
      }, function (e) {
        if (!done) { done = true; clearTimeout(t); reject(e); }
      });
    });
  }

  // Keep the round the user is actually looking at warm, so the bet path is a
  // memory read. Cheap: one getAccountInfo per round, not one per bet.
  function currentRound() {
    var C = chain();
    return C ? C.roundOpenAt(Date.now()) : 0;
  }
  function warm() {
    var C = chain();
    if (!C || !C.available()) return;
    var now = currentRound();
    if (!cachedMarket(now)) fetchMarket(now);
    // Keep a blockhash warm too, so the bet tx is ready to sign instantly.
    if (window.OST_WALLET && typeof window.OST_WALLET.warmBlockhash === 'function') {
      window.OST_WALLET.warmBlockhash();
    }
  }

  // ---- placing ------------------------------------------------------------

  function recordOnChainTicket(order, openAtSec, res, quote, ref) {
    var stake = Number(order.stake);
    var openAtMs = openAtSec * 1000;
    var rec = {
      reference: ref || undefined,
      // Empty until the background tx returns a signature. `pending` marks it as
      // still resolving so the UI can show it immediately without lying.
      pending: !res.signature,
      optimistic: !res.signature,
      signature: res.signature, sig: res.signature,
      ts: Date.now(), status: 'open',
      wallet: (window.OST_WALLET && window.OST_WALLET.address) || 'wallet',
      fundedBy: 'onchain',
      // The two flags the claim path keys off. `onChain` says the money is in
      // the program vault, so it must come back out of the program vault.
      onChain: true,
      onChainMarket: res.market,
      onChainOpenAt: openAtSec,
      source: order.source, marketId: order.marketId,
      title: order.title, side: order.side, topic: order.topic,
      price: Number(order.price), yesPrice: Number(order.yesPrice), noPrice: Number(order.noPrice),
      stake: stake,
      // Pari-mutuel: the payout is decided by the pools at settlement, not by a
      // share price. We record the CURRENT net quote so the ticket shows a real
      // number, and mark it indicative so no UI claims it is guaranteed.
      shares: Number(order.shares) || stake,
      potentialReturn: quote ? quote.net : stake,
      payoutIsIndicative: true,
      houseFeeBps: chain().houseFeeBps,
      closeAtMs: openAtMs + FIVE_MIN_MS,
      openAt: openAtMs, closeAt: openAtMs + FIVE_MIN_MS,
      sourceUrl: order.sourceUrl,
      vaultFlow: 'onchain-escrow', createdAt: Date.now()
    };
    try {
      var api = window.OST_PREDICTION_API;
      if (api) {
        // A still-pending ticket is stored LOCALLY only — never publish a bet to
        // the global feed before the chain has actually taken it.
        if (rec.pending && typeof api.recordOrderLocal === 'function') api.recordOrderLocal(rec);
        else if (typeof api.recordOrder === 'function') api.recordOrder(rec);
      }
      window.dispatchEvent(new CustomEvent('ost:prediction-order-recorded', { detail: rec }));
      window.dispatchEvent(new CustomEvent('ost:prediction:order-changed', { detail: rec }));
      if (typeof window.notifyOstTxHistory === 'function') window.notifyOstTxHistory();
    } catch (_) {}
    return rec;
  }

  // A bet is acknowledged at 'processed' commitment for speed, then reconciled to
  // 'confirmed' in the background. On the rare occasion a processed tx is rolled
  // back by a fork, ost-onchain-market fires this — void the optimistic ticket so
  // the user is never shown a bet that didn't actually land. Same-signature key
  // means recordOrder() UPDATES the ticket rather than adding a duplicate.
  window.addEventListener('ost:onchain-bet-reverted', function (ev) {
    var d = ev && ev.detail; if (!d || !d.signature) return;
    try {
      if (window.OST_PREDICTION_API && typeof window.OST_PREDICTION_API.recordOrder === 'function') {
        window.OST_PREDICTION_API.recordOrder({
          signature: d.signature, sig: d.signature,
          status: 'failed', voided: true, voidReason: 'rolled-back',
          ts: Date.now(), createdAt: Date.now()
        });
      }
      if (typeof window.notifyOstTxHistory === 'function') window.notifyOstTxHistory();
      log('bet ' + String(d.signature).slice(0, 10) + '… rolled back — ticket voided');
    } catch (_) {}
  });

  function wrapPlaceOrder() {
    var api = window.OST_PREDICTION_API;
    if (!api || typeof api.placeOrder !== 'function' || api.__onchainRouted) return false;
    var inner = api.placeOrder;

    api.placeOrder = function (order) {
      var openAtSec = order ? openAtSecOf(order.marketId) : 0;
      var C = chain();
      if (!openAtSec || !C || !C.available()) return inner(order);

      var stake = Number(order && order.stake);
      if (!Number.isFinite(stake) || stake <= 0) return inner(order);

      // The warm cache means this is normally a memory read — no RPC on the hot
      // path. If it is cold (first bet of a round), give the lookup a short
      // budget and fall back rather than make the user wait on devnet.
      var cached = cachedMarket(openAtSec);
      var lookup = cached
        ? Promise.resolve(cached)
        : withTimeout(fetchMarket(openAtSec), 1200, 'on-chain market lookup')
            .catch(function () { return null; });

      return lookup.then(function (m) {
        if (!m || !m.exists) { log('no on-chain market for this round yet — off-chain path'); return inner(order); }
        if (m.resolved) { log('market already resolved — off-chain path'); return inner(order); }
        if (Date.now() >= m.lockTs) { log('market locked — off-chain path'); return inner(order); }

        var quote = C.quoteNet(m, order.side, stake);

        // OPTIMISTIC ON-CHAIN BET — the ticket appears the instant the user taps.
        // We used to `await` the Solana tx before recording, so the ticket only
        // showed after the round-trip (signing + send + 'processed'), which is the
        // "buying takes a few seconds" the desk still had. The tx is now sent in
        // the BACKGROUND and the ticket is patched with the real signature when it
        // lands; if it fails, the ticket is removed and nothing is charged (the
        // stake only ever leaves the wallet if the tx itself succeeds).
        var ref = 'oc-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        var rec = recordOnChainTicket(order, openAtSec, { signature: '', market: m.market.toBase58() }, quote, ref);
        delete cache[openAtSec];   // pools are about to move — don't quote stale

        C.placeBet(openAtSec, order.side, stake, m).then(function (res) {
          var api = window.OST_PREDICTION_API;
          if (api && typeof api.patchOrderByRef === 'function') {
            api.patchOrderByRef(ref, { signature: res.signature, sig: res.signature, pending: false, optimistic: false });
          }
          // Now that it is real, publish it to the global feed.
          try { if (api && typeof api.recordOrder === 'function') api.recordOrder(Object.assign({}, rec, { signature: res.signature, sig: res.signature, pending: false, optimistic: false })); } catch (_) {}
          try { window.dispatchEvent(new CustomEvent('ost:prediction:order-changed')); } catch (_) {}
          try { window.dispatchEvent(new CustomEvent('ost:wallet-changed')); } catch (_) {}
          log('ON-CHAIN bet confirmed: ' + stake + ' OST ' + String(order.side).toUpperCase() +
              ' -> program vault (' + String(res.signature).slice(0, 10) + '…)');
        }).catch(function (err) {
          var api = window.OST_PREDICTION_API;
          if (api && typeof api.removeOrderByRef === 'function') api.removeOrderByRef(ref);
          try { window.dispatchEvent(new CustomEvent('ost:prediction:order-changed')); } catch (_) {}
          try { if (window.OST_OPTIMISTIC) window.OST_OPTIMISTIC.toast('Bet could not be placed on-chain — cleared, nothing charged.', 'error'); } catch (_) {}
          log('on-chain bet FAILED — optimistic ticket cleared: ' + (err && err.message));
        });

        return { signature: '', pending: true, optimistic: true, reference: ref, record: rec, onChain: true, fundedBy: 'onchain' };
      }).catch(function (err) {
        // Never block a bet. Fall back to the rail that worked before, and say
        // why in the console rather than silently pretending it was on-chain.
        log('on-chain route failed (' + (err && err.message) + ') — falling back to the off-chain path');
        return inner(order);
      });
    };
    api.__onchainRouted = true;
    return true;
  }

  // ---- claiming -----------------------------------------------------------
  // Handled at the ROOT, inside prediction-extras.js `claimBet`: that function
  // already owns rail selection ("pay through the same rail the ticket was
  // funded on"), and an on-chain ticket is simply a third rail there. Wrapping
  // OST_PRED_CLAIM from out here would have bypassed its re-entrancy latch and
  // its dual-schema write, and could pay a ticket twice. Do not re-add a wrapper.

  // OST_PREDICTION_API is defined by app.js; poll briefly until it exists.
  var tries = 0;
  (function attach() {
    if (wrapPlaceOrder()) {
      log('desk routed: OST-native BTC rounds default to the on-chain program');
      startWarming();
      return;
    }
    if (tries++ < 60) setTimeout(attach, 250);
  })();

  // Warm the cache only once the browser is idle and the tab is visible. Boot is
  // already the busiest moment in the app's life; adding an RPC to it would make
  // the page feel slower to load in exchange for a faster bet, which is a bad
  // trade. A hidden tab warms nothing — no point burning a user's data.
  var warmTimer = null;
  function startWarming() {
    var idle = window.requestIdleCallback || function (fn) { return setTimeout(fn, 1500); };
    idle(function () {
      warm();
      if (warmTimer) clearInterval(warmTimer);
      warmTimer = setInterval(function () {
        if (document.visibilityState === 'visible') warm();
      }, 15000);
    }, { timeout: 4000 });
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') warm();
    });
  }

  window.OST_ONCHAIN_ROUTE = {
    openAtSecOf: openAtSecOf,
    // "Would this ticket go on-chain right now?" — used by the UI to badge it.
    willRoute: function (marketId) {
      var s = openAtSecOf(marketId);
      var C = chain();
      if (!s || !C || !C.available()) return Promise.resolve(false);
      return C.marketFor(s).then(function (m) {
        return !!(m && m.exists && !m.resolved && Date.now() < m.lockTs);
      }).catch(function () { return false; });
    }
  };
})();

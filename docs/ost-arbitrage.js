/* ==========================================================================
 * OST · Arbitrage — the protocol IS the market maker on every buy & sell
 * --------------------------------------------------------------------------
 * OST is the counterparty for every prediction ticket. It quotes a spread
 * around the unified live mid (OST_PRICES):
 *   · BUY  — the user is filled at the ASK (mid marked up). OST effectively
 *            "bought the shares cheap and sold them to the user at live price";
 *            it banks the spread immediately, win or lose.
 *   · SELL — the user is filled at the BID (mid marked down). OST buys the
 *            user's shares below market and banks the spread.
 * The spread is guaranteed OST profit on EVERY transaction (not just wins),
 * recorded to the treasury (ost:house-fee, source 'arbitrage') and shown live.
 *
 * Prices float from a 0.1c floor up. Config: OST_FEE_ARB_BPS (localStorage,
 * default 150 = 1.5% spread each side).
 * ========================================================================== */
(function () {
  'use strict';

  var DEFAULT_BPS = 150;
  var MIN_PRICE = 0.001;   // 0.1 cent
  var MAX_PRICE = 0.999;

  function bps() {
    try {
      var v = parseFloat(localStorage.getItem('OST_FEE_ARB_BPS'));
      if (Number.isFinite(v) && v >= 0 && v <= 1500) return v;
    } catch (_) {}
    return DEFAULT_BPS;
  }
  function frac() { return bps() / 10000; }
  function clampP(p) { p = Number(p); return Number.isFinite(p) ? Math.max(MIN_PRICE, Math.min(MAX_PRICE, p)) : NaN; }

  function record(amount, meta) {
    if (!(amount > 0.0000001)) return;
    try { window.dispatchEvent(new CustomEvent('ost:house-fee', { detail: { source: 'arbitrage', amount: amount, label: 'market-maker spread', meta: meta || null } })); } catch (_) {}
    // reuse the visible house-edge note if present
    try { if (window.OST_HOUSE && typeof window.OST_HOUSE.render === 'function') { /* total tracked via ost:house-fee */ } } catch (_) {}
  }

  // ---- quotes (non-recording preview) ------------------------------------
  // BUY: user stakes `stake` OST at live `mid`. OST skims the spread, the rest
  // buys shares at mid. Returns the shares the user receives + OST's cut + the
  // effective ask price they paid.
  function buyQuote(stake, mid) {
    stake = Math.max(0, Number(stake) || 0);
    mid = clampP(mid);
    if (!(stake > 0) || !Number.isFinite(mid)) return { shares: 0, arb: 0, ask: mid, netStake: 0 };
    var f = frac();
    var arb = stake * f;
    var netStake = stake - arb;
    var shares = netStake / mid;
    var ask = shares > 0 ? stake / shares : mid;   // effective price paid
    return { shares: shares, arb: arb, ask: clampP(ask), netStake: netStake };
  }

  // SELL: user sells `shares` at live `mid`. OST buys them below market (bid),
  // banking the spread. Returns proceeds + OST cut + effective bid.
  function sellQuote(shares, mid) {
    shares = Math.max(0, Number(shares) || 0);
    mid = clampP(mid);
    if (!(shares > 0) || !Number.isFinite(mid)) return { proceeds: 0, arb: 0, bid: mid };
    var f = frac();
    var gross = shares * mid;
    var arb = gross * f;
    var proceeds = gross - arb;
    var bid = mid * (1 - f);
    return { proceeds: proceeds, arb: arb, bid: clampP(bid) };
  }

  // ---- realise (records the OST arbitrage profit) ------------------------
  function bookBuy(stake, mid, meta) {
    var q = buyQuote(stake, mid);
    record(q.arb, Object.assign({ side: 'buy' }, meta || {}));
    return q;
  }
  function bookSell(shares, mid, meta) {
    var q = sellQuote(shares, mid);
    record(q.arb, Object.assign({ side: 'sell' }, meta || {}));
    return q;
  }

  // ---- the OST-maintained order book for a market (OST is the liquidity) --
  function book(marketId, side) {
    var m = (window.OST_PRICES && window.OST_PRICES.mid) ? window.OST_PRICES.mid(marketId, side || 'yes') : NaN;
    if (!Number.isFinite(m)) return null;
    var f = frac();
    return {
      mid: m,
      ask: clampP(m / (1 - f)),   // OST sells to buyers here
      bid: clampP(m * (1 - f)),   // OST buys from sellers here
      spreadBps: bps()
    };
  }

  window.OST_ARB = {
    buyQuote: buyQuote,
    sellQuote: sellQuote,
    bookBuy: bookBuy,
    bookSell: bookSell,
    book: book,
    bps: bps,
    minPrice: MIN_PRICE
  };
})();

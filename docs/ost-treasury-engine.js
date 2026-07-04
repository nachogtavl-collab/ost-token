/* ==========================================================================
 * OST · Protocol Treasury Engine — how OST profits on every transaction
 * --------------------------------------------------------------------------
 * The honest "arbitrage so OST itself is profitable" model is the HOUSE
 * EDGE: the protocol takes a small, transparent cut of every transaction,
 * and those cuts accrue to the treasury that funds the faucet, payouts and
 * buybacks. This is exactly how a solvent casino/exchange survives — it is
 * NOT "every user always wins" (that is a Ponzi).
 *
 * v2: this ledger records only fees that were ACTUALLY withheld from a
 * trade. Charge points dispatch `ost:house-fee` at the moment real OST is
 * kept by the protocol:
 *
 *   · Prediction trades   → 1.5% fee charged in app.js placeOrder (payout
 *     scaled to net stake; the vault keeps the fee slice of every stake).
 *   · Parlay slips        → per-leg vig on the payout multiplier + 6%
 *     cash-out spread, both accrued when realised.
 *   · Faucet-game rounds  → the net of wagers − payouts is the house edge.
 *   · Swaps               → the swap rail's real 0.5% pool fee.
 *   · Mesh group markets  → 2% pot rake at settlement.
 *
 * Every accrual is: stored to ost.treasury.revenue.v1, reported to the
 * live price engine as telemetry (activity moves OST), and surfaced via
 * window.OST_TREASURY_ENGINE + an optional on-page readout.
 *
 * Config (localStorage overrides): OST_FEE_PREDICTION_BPS (default 150),
 * OST_FEE_SWAP_BPS (default 30). bps = basis points (100 = 1%).
 * ========================================================================== */
(function () {
  'use strict';

  var REV_KEY = 'ost.treasury.revenue.v1';

  function numSetting(key, def) {
    try { var v = parseFloat(localStorage.getItem(key)); return Number.isFinite(v) ? v : def; } catch (_) { return def; }
  }
  function feePredictionBps() { return numSetting('OST_FEE_PREDICTION_BPS', 150); } // 1.5%
  function feeSwapBps() { return numSetting('OST_FEE_SWAP_BPS', 30); }              // 0.30%

  function load() {
    try { return JSON.parse(localStorage.getItem(REV_KEY) || 'null') || fresh(); } catch (_) { return fresh(); }
  }
  function fresh() {
    return { total: 0, fromPredictions: 0, fromGames: 0, fromSwaps: 0, fromFees: 0, txCount: 0, since: Date.now() };
  }
  function save(r) { try { localStorage.setItem(REV_KEY, JSON.stringify(r)); } catch (_) {} }

  function accrue(source, amount, label) {
    amount = Number(amount) || 0;
    if (amount <= 0) return load();
    var r = load();
    r.total += amount;
    r.txCount += 1;
    if (source === 'prediction') r.fromPredictions += amount;
    else if (source === 'game') r.fromGames += amount;
    else if (source === 'swap') r.fromSwaps += amount;
    else r.fromFees += amount;
    save(r);
    try { window.dispatchEvent(new CustomEvent('ost:treasury-accrued', { detail: { source: source, amount: amount, label: label || '', total: r.total } })); } catch (_) {}
    // house revenue is real network activity → feed the live price engine
    try { if (window.OST_TELEMETRY && window.OST_TELEMETRY.report) window.OST_TELEMETRY.report('other', amount); } catch (_) {}
    render();
    return r;
  }

  // ---- public: quote a swap WITH the protocol spread applied -------------
  // Returns { out, fee, feeBps } — callers show `out` to the user and the
  // spread stays with the protocol (the pool is the counterparty).
  function quoteSwap(grossOut) {
    var bps = feeSwapBps();
    var fee = (Number(grossOut) || 0) * bps / 10000;
    return { out: (Number(grossOut) || 0) - fee, fee: fee, feeBps: bps };
  }

  // ---- meter faucet-game house edge (wagers in − payouts out) ------------
  var gameFloat = 0; // running net; positive = house ahead since last flush
  function onGameWager(amt) { gameFloat += Number(amt) || 0; }
  function onGameAward(amt, source) {
    if (!/game|plinko|mines|crash|dice|limbo|wheel|coin|tower|slots|keno|hilo|scratch|blackjack|baccarat|penalty|video/i.test(String(source || ''))) return;
    gameFloat -= Number(amt) || 0;
  }
  // Periodically bank whatever edge has accumulated (never negative — a
  // lucky streak just delays the bank, it doesn't create negative revenue).
  function bankGameEdge() {
    if (gameFloat > 0.0001) {
      var take = gameFloat;
      gameFloat = 0;
      accrue('game', take, 'house edge');
    }
  }

  // ---- readout -----------------------------------------------------------
  function fmt(n) {
    n = Number(n) || 0;
    if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
    return n.toFixed(2);
  }
  function render() {
    var el = document.getElementById('ostTreasuryRevenue');
    if (el) el.textContent = fmt(load().total) + ' OST';
    var tx = document.getElementById('ostTreasuryTx');
    if (tx) tx.textContent = String(load().txCount);
  }

  function wire() {
    // v2: the ledger only records fees that were ACTUALLY withheld. Each
    // charge point (app.js placeOrder, parlay vig/cash-out spread, ticket,
    // swap rail, mesh rake) dispatches ost:house-fee with the real amount at
    // the moment the money is withheld. The old listeners that *estimated*
    // 1.5% of stakes without anyone paying it are gone — that was a meter,
    // not revenue.
    window.addEventListener('ost:house-fee', function (e) {
      var d = (e && e.detail) || {};
      var src = String(d.source || 'fee');
      var amt = Number(d.amount) || 0;
      if (amt <= 0) return;
      if (src === 'parlay' || src === 'scalar' || src === 'ticket' || src === 'mesh') src = 'prediction';
      accrue(src === 'prediction' || src === 'game' || src === 'swap' ? src : 'fee', amt, d.label);
    }, false);
    window.addEventListener('ost:game-wager', function (e) { onGameWager((e && e.detail && e.detail.amount) || 0); }, false);
    window.addEventListener('ost-faucet-hub-award', function (e) {
      var d = (e && e.detail) || {};
      onGameAward(Number(d.credits || 0), d.source);
    }, false);
    setInterval(bankGameEdge, 12000);
    render();
  }

  window.OST_TREASURY_ENGINE = {
    revenue: load,
    quoteSwap: quoteSwap,
    accrueFee: function (amt, label) { return accrue('fee', amt, label); },
    accrueSwap: function (amt, label) { return accrue('swap', amt, label); },
    feeBps: { prediction: feePredictionBps, swap: feeSwapBps }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(wire, 1700); });
  else setTimeout(wire, 1700);
})();

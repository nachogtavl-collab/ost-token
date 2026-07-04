/* ==========================================================================
 * OST · Engine Guard — self-reliable, self-fixable engines
 * --------------------------------------------------------------------------
 * Every engine stores state in localStorage and settles on timers. Any of
 * that can rot: interrupted writes leave NaN numbers, markets vanish before
 * settling, scanners die with the tab. This guard runs a repair pass at boot
 * and every 90 seconds:
 *
 *   1. Orders   — unparseable store → restore/reset; NaN prices/stakes are
 *                 recomputed when derivable, quarantined (`void-corrupt`,
 *                 never paid) when not; settled history pruned to 800.
 *   2. Parlays  — corrupt legs voided (settle logic refunds voids); the
 *                 settle scanner is re-kicked so nothing stays stuck.
 *   3. Credits  — NaN credits/lifetime clamped to last-known-good.
 *   4. Treasury — NaN ledger rebuilt (epoch preserved).
 *   5. Engines  — verifies the core APIs booted; re-kicks settle scans.
 *
 * Repairs are quarantines and recomputations only — the guard never invents
 * balances and never deletes open positions. Findings are kept at
 * window.OST_ENGINE_GUARD.report() and broadcast via ost:engine-guard-report.
 * ========================================================================== */
(function () {
  'use strict';

  var ORDERS_KEY = 'ost.prediction.orders.v1';
  var SLIPS_KEY = 'ost.parlay.slips.v1';
  var HUB_KEY = 'ost.faucet.hub.v2';
  var REV_KEY = 'ost.treasury.revenue.v1';
  var MAX_SETTLED_KEPT = 800;

  var lastReport = { at: 0, findings: [], repairs: 0, passes: 0 };

  function note(kind, msg) {
    lastReport.findings.push({ kind: kind, msg: msg, at: Date.now() });
    if (lastReport.findings.length > 60) lastReport.findings.splice(0, lastReport.findings.length - 60);
  }

  function readJson(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      if (raw == null) return { ok: true, value: fallback, missing: true };
      return { ok: true, value: JSON.parse(raw) };
    } catch (_) { return { ok: false, value: fallback }; }
  }
  function writeJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (_) { return false; }
  }
  function bad(n) { return !Number.isFinite(Number(n)); }
  // A money field must be a REAL finite number. null/undefined/'' all coerce
  // to 0 or NaN via Number(), so JSON's NaN→null trap would slip past bad().
  function badMoney(n) { return typeof n !== 'number' || !Number.isFinite(n); }

  // ---- 1 · prediction orders ---------------------------------------------
  function checkOrders() {
    var repairs = 0;
    var r = readJson(ORDERS_KEY, []);
    if (!r.ok) {
      // Store unparseable. Data-guard's recover() restores every corrupt
      // critical key from its rolling backups; re-read after it runs.
      try { if (window.OST_DATA_GUARD && window.OST_DATA_GUARD.recover) window.OST_DATA_GUARD.recover(); } catch (_) {}
      var retry = readJson(ORDERS_KEY, []);
      if (!retry.ok) writeJson(ORDERS_KEY, []);
      note('orders', 'order store was unparseable — ' + (retry.ok ? 'restored from backup' : 'reset'));
      return 1;
    }
    var orders = Array.isArray(r.value) ? r.value : [];
    var changed = false;
    orders.forEach(function (o) {
      if (!o || typeof o !== 'object') return;
      // Recompute what is derivable before quarantining anything.
      if (bad(o.potentialReturn) && !bad(o.stake) && !bad(o.price) && Number(o.price) > 0) {
        var scale = !bad(o.netStake) && Number(o.stake) > 0 ? Number(o.netStake) / Number(o.stake) : 1;
        o.potentialReturn = (Number(o.stake) / Number(o.price)) * scale;
        changed = true; repairs++;
        note('orders', 'recomputed potentialReturn for ' + (o.marketId || o.signature || 'order'));
      }
      if (bad(o.shares) && !bad(o.potentialReturn)) { o.shares = Number(o.potentialReturn); changed = true; }
      // Not derivable → quarantine so the claim engine can never pay NaN.
      if (o.status === 'open' && (bad(o.stake) || Number(o.stake) <= 0 || bad(o.price) || Number(o.price) <= 0)) {
        o.status = 'void-corrupt';
        o.voidedAt = Date.now();
        changed = true; repairs++;
        note('orders', 'quarantined corrupt open order ' + (o.marketId || o.signature || '?'));
      }
    });
    // Prune old settled history so the store can't hit the quota wall.
    var settled = orders.filter(function (o) { return o && o.status && o.status !== 'open'; });
    if (settled.length > MAX_SETTLED_KEPT) {
      var cutoff = settled.length - MAX_SETTLED_KEPT;
      var removed = 0;
      orders = orders.filter(function (o) {
        if (!o || o.status === 'open' || removed >= cutoff) return true;
        removed++;
        return false;
      });
      changed = true; repairs++;
      note('orders', 'pruned ' + removed + ' oldest settled orders');
    }
    if (changed) writeJson(ORDERS_KEY, orders);
    return repairs;
  }

  // ---- 2 · parlay slips ---------------------------------------------------
  function checkSlips() {
    var repairs = 0;
    var r = readJson(SLIPS_KEY, []);
    if (!r.ok) {
      writeJson(SLIPS_KEY, []);
      note('parlay', 'slip store was unparseable — reset');
      return 1;
    }
    var slips = Array.isArray(r.value) ? r.value : [];
    var changed = false;
    slips.forEach(function (s) {
      if (!s || s.status !== 'open' || !Array.isArray(s.legs)) return;
      s.legs.forEach(function (l) {
        if (l && l.status === 'open' && (bad(l.entryPrice) || Number(l.entryPrice) <= 0 || Number(l.entryPrice) >= 1)) {
          l.status = 'void';
          changed = true; repairs++;
          note('parlay', 'voided corrupt leg in slip ' + s.id);
        }
      });
      if (bad(s.stake) || Number(s.stake) <= 0) {
        s.status = 'lost';
        s.settledAt = Date.now();
        changed = true; repairs++;
        note('parlay', 'closed slip with corrupt stake ' + s.id);
      }
    });
    if (changed) writeJson(SLIPS_KEY, slips);
    // Re-kick the settle scanner — a repaired slip must not sit stuck.
    try { if (window.OST_PARLAY && window.OST_PARLAY.settleScan) window.OST_PARLAY.settleScan(); } catch (_) {}
    return repairs;
  }

  // ---- 3 · credits pool ---------------------------------------------------
  function checkCredits() {
    var r = readJson(HUB_KEY, {});
    if (!r.ok) { note('credits', 'credits store unparseable — left for data-guard'); return 0; }
    var s = r.value || {};
    var repairs = 0;
    if (badMoney(s.credits) || s.credits < 0) { s.credits = Math.max(0, Number(s.credits) || 0); repairs++; }
    if (badMoney(s.lifetime) || s.lifetime < 0) { s.lifetime = Math.max(Number(s.credits) || 0, Number(s.lifetime) || 0); repairs++; }
    if (repairs) {
      writeJson(HUB_KEY, s);
      note('credits', 'clamped NaN credit fields');
      try { window.dispatchEvent(new CustomEvent('ost-money-changed', { detail: { delta: 0, source: 'engine-guard-repair', total: s.credits } })); } catch (_) {}
    }
    return repairs;
  }

  // ---- 4 · treasury ledger ------------------------------------------------
  function checkTreasury() {
    var r = readJson(REV_KEY, null);
    if (!r.ok || (r.value && typeof r.value === 'object' && (bad(r.value.total) || bad(r.value.txCount)))) {
      var since = r.value && r.value.since ? r.value.since : Date.now();
      writeJson(REV_KEY, { total: 0, fromPredictions: 0, fromGames: 0, fromSwaps: 0, fromFees: 0, txCount: 0, since: since, rebuiltAt: Date.now() });
      note('treasury', 'rebuilt corrupt revenue ledger');
      return 1;
    }
    return 0;
  }

  // ---- 5 · engine heartbeats ----------------------------------------------
  function checkEngines() {
    var missing = [];
    if (!window.OST_MONEY) missing.push('OST_MONEY');
    if (!window.OST_PREDICTION_API || !window.OST_PREDICTION_API.placeOrder) missing.push('OST_PREDICTION_API');
    if (!window.OST_TREASURY_ENGINE) missing.push('OST_TREASURY_ENGINE');
    if (missing.length) note('engines', 'not booted yet: ' + missing.join(', '));
    return 0;
  }

  function pass() {
    var repairs = 0;
    try { repairs += checkOrders(); } catch (e) { note('guard', 'orders check threw: ' + e.message); }
    try { repairs += checkSlips(); } catch (e) { note('guard', 'slips check threw: ' + e.message); }
    try { repairs += checkCredits(); } catch (e) { note('guard', 'credits check threw: ' + e.message); }
    try { repairs += checkTreasury(); } catch (e) { note('guard', 'treasury check threw: ' + e.message); }
    try { checkEngines(); } catch (_) {}
    lastReport.at = Date.now();
    lastReport.repairs += repairs;
    lastReport.passes += 1;
    if (repairs > 0) {
      try { console.info('[ost-engine-guard] repaired ' + repairs + ' issue(s)'); } catch (_) {}
      try { window.dispatchEvent(new CustomEvent('ost:engine-guard-report', { detail: { repairs: repairs, findings: lastReport.findings.slice(-repairs) } })); } catch (_) {}
    }
  }

  window.OST_ENGINE_GUARD = {
    run: pass,
    report: function () { return JSON.parse(JSON.stringify(lastReport)); }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(pass, 5000); });
  else setTimeout(pass, 5000);
  setInterval(pass, 90000);
})();

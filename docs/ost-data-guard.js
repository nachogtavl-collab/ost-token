/* ==========================================================================
 * OST · Data Guard — never lose or corrupt a user's OST data again
 * --------------------------------------------------------------------------
 * Testers reported logging back in to corrupted or missing data. localStorage
 * writes are not atomic: a tab closed mid-write, a quota hiccup, or two tabs
 * racing can leave a key as truncated/invalid JSON — and every reader then
 * silently resets it to {} / [], wiping balances, bets and history.
 *
 * This guard, running before the app's own scripts touch storage:
 *   1) Keeps a rolling, checksummed BACKUP of every critical key
 *      (ost.dataguard.backup.v1) plus one previous generation.
 *   2) On boot, validates each critical key. If it's missing or unparseable
 *      but a valid backup exists, it RESTORES from the backup.
 *   3) After boot, snapshots on every change (debounced) and on pagehide,
 *      so the backup always trails the live data by seconds.
 *   4) Exposes export()/import() for real cross-device/manual recovery.
 *
 * Pure safety net: it never changes valid data, only rescues broken keys.
 * ========================================================================== */
(function () {
  'use strict';

  var BACKUP_KEY = 'ost.dataguard.backup.v1';
  var PREV_KEY = 'ost.dataguard.backup.prev.v1';
  var META_KEY = 'ost.dataguard.meta.v1';

  // The keys whose loss actually hurts a user. Balances, ledgers, history,
  // identity, progression. (Add new critical stores here as they appear.)
  var CRITICAL = [
    'ost.faucet.hub.v2',            // canonical OST credits pool
    'ost.chain.lastKnown.v1',       // last confirmed on-chain balance (balance tree)
    'ost.prediction.orders.v1',     // market tickets / bets ledger
    'ost.parlays.v1',               // parlay slips
    'ost.games.meta.v1',            // streaks, tier, rakeback, daily
    'ost.academy.v2',               // code academy progress
    'ost.stock.orders.v1',          // stock mirror positions
    'ost.payout.receipts.v1',       // claimed payouts
    'ost.payout.pending.v1',        // pending payouts (claimable later)
    'ost.telemetry.device.v1',      // stable identity
    'ost.xp.v1', 'ost.level.v1',    // progression (if present)
    'ost.wallet.session.v1'         // browser wallet session (if present)
  ];

  function isValidJson(raw) {
    if (raw == null) return false;
    try { JSON.parse(raw); return true; } catch (_) { return false; }
  }

  // Tiny stable checksum (djb2) so we can tell a backup is intact.
  function checksum(str) {
    var h = 5381;
    for (var i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }

  function readBackup(key) {
    try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (_) { return null; }
  }
  function writeBackup(key, obj) {
    try { localStorage.setItem(key, JSON.stringify(obj)); return true; } catch (_) { return false; }
  }

  // Build a snapshot: { key: { v: rawString, c: checksum } } for present keys.
  function snapshot() {
    var snap = {};
    CRITICAL.forEach(function (k) {
      var raw;
      try { raw = localStorage.getItem(k); } catch (_) { raw = null; }
      if (raw != null && isValidJson(raw)) snap[k] = { v: raw, c: checksum(raw) };
    });
    return { ts: Date.now(), keys: snap };
  }

  function backupIsIntact(entry) {
    return entry && typeof entry.v === 'string' && isValidJson(entry.v) && checksum(entry.v) === entry.c;
  }

  // Restore any critical key that is missing/broken from the freshest intact backup.
  function recover() {
    var current = readBackup(BACKUP_KEY);
    var prev = readBackup(PREV_KEY);
    var restored = [];
    CRITICAL.forEach(function (k) {
      var raw;
      try { raw = localStorage.getItem(k); } catch (_) { raw = null; }
      if (raw != null && isValidJson(raw)) return; // live value is fine
      // live value missing or corrupt — try backups newest first
      var cand = (current && current.keys && current.keys[k]) || null;
      var candPrev = (prev && prev.keys && prev.keys[k]) || null;
      var use = backupIsIntact(cand) ? cand : (backupIsIntact(candPrev) ? candPrev : null);
      if (use) {
        try {
          localStorage.setItem(k, use.v);
          restored.push(k);
        } catch (_) {}
      } else if (raw != null && !isValidJson(raw)) {
        // corrupt with no backup: quarantine the bad blob so readers get a
        // clean slate instead of throwing, but we don't silently lose evidence
        try {
          localStorage.setItem('ost.dataguard.corrupt.' + k, raw);
          localStorage.removeItem(k);
        } catch (_) {}
      }
    });
    if (restored.length) {
      try { window.dispatchEvent(new CustomEvent('ost:data-recovered', { detail: { keys: restored } })); } catch (_) {}
      try { console.info('[OST_DATA_GUARD] recovered ' + restored.length + ' key(s):', restored.join(', ')); } catch (_) {}
    }
    return restored;
  }

  var saveTimer = null;
  function scheduleBackup() {
    if (saveTimer) return;
    saveTimer = setTimeout(function () {
      saveTimer = null;
      doBackup();
    }, 1500);
  }

  function doBackup() {
    var snap = snapshot();
    if (!Object.keys(snap.keys).length) return;
    // rotate current -> prev before overwriting
    var current = readBackup(BACKUP_KEY);
    if (current) writeBackup(PREV_KEY, current);
    var ok = writeBackup(BACKUP_KEY, snap);
    if (ok) writeBackup(META_KEY, { ts: snap.ts, count: Object.keys(snap.keys).length });
  }

  function exportAll() {
    return JSON.stringify(snapshot());
  }

  function importAll(json, opts) {
    opts = opts || {};
    var snap;
    try { snap = JSON.parse(json); } catch (_) { return { ok: false, error: 'invalid json' }; }
    if (!snap || !snap.keys) return { ok: false, error: 'not an OST backup' };
    var applied = [];
    Object.keys(snap.keys).forEach(function (k) {
      var entry = snap.keys[k];
      if (!backupIsIntact(entry)) return;
      if (!opts.overwrite) {
        var existing;
        try { existing = localStorage.getItem(k); } catch (_) { existing = null; }
        if (existing != null && isValidJson(existing)) return; // keep local unless overwrite
      }
      try { localStorage.setItem(k, entry.v); applied.push(k); } catch (_) {}
    });
    return { ok: true, applied: applied };
  }

  // ---- boot: recover FIRST, before app scripts read storage --------------
  var recovered = recover();
  doBackup();

  // keep the backup trailing the live data
  window.addEventListener('storage', function (e) {
    if (e && e.key && CRITICAL.indexOf(e.key) >= 0) scheduleBackup();
  }, false);
  ['ost-faucet-hub-award', 'ost-money-changed', 'ost:prediction:order-changed',
   'ost:prediction-order-recorded', 'ost:wallet-changed', 'ost:parlay-won']
    .forEach(function (ev) { window.addEventListener(ev, scheduleBackup, false); });
  window.addEventListener('pagehide', doBackup, false);
  window.addEventListener('beforeunload', doBackup, false);
  setInterval(doBackup, 30000);

  window.OST_DATA_GUARD = {
    backupNow: doBackup,
    recover: recover,
    export: exportAll,
    import: importAll,
    critical: CRITICAL.slice(),
    lastRecovered: recovered,
    status: function () { return readBackup(META_KEY); }
  };
})();

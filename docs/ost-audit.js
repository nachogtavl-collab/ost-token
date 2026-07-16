/* ==========================================================================
 * OST · Forensic Audit — READ ONLY. This file must never move a token.
 * --------------------------------------------------------------------------
 * WHAT WE ARE AUDITING
 *
 * When an on-chain payout failed, app.js caught the error and marked the ticket
 * `cashedOut = true` with a FABRICATED signature ('local-…' / 'credits-…'), then
 * booked the shortfall through recordVaultRetainedLoss() as a normal "retained
 * loss". So the UI said paid, the books looked tidy, and no tokens ever moved.
 * Because `cashedOut` was set, the ticket could never be retried — the OST simply
 * stayed in the pool. That is the loss testers have seen since day one.
 *
 * Verified on-chain: the swap pool still holds ~10.01B OST. Nothing was burned or
 * swept. So this is a REPLAY of owed payouts, not a hunt for missing tokens.
 *
 * THE ONE DISTINCTION THAT MATTERS
 *
 * There are two populations wearing the same fake signature, and paying them the
 * same way would be a second incident:
 *
 *   REAL    — the user's stake really did leave their wallet and reach the pool.
 *             Their BUY signature is a genuine base58 Solana signature and the
 *             transaction exists on-chain. They are genuinely owed a payout.
 *
 *   PHANTOM — the stake NEVER left the wallet. The optimistic wallet buy
 *             "silently converts to a credits buy" when funding fails, so the
 *             ticket carries a 'credits-…' buy sig and no on-chain counterpart.
 *             Nothing is recoverable because nothing moved. Refunding these mints
 *             OST from nothing.
 *
 * So we do not trust the ledger's own story about a ticket. We ask the chain.
 * A ticket only counts as owed if its BUY signature is real AND confirmed
 * on-chain. Everything else is reported, never paid.
 * ========================================================================== */
(function () {
  'use strict';
  // NOT `OST_AUDIT` — mainnet-audit.js already owns that global (it assigns a
  // plain results object to it). Squatting on it meant this module's own
  // `if (window.OST_AUDIT) return;` guard silently no-op'd the entire file
  // whenever that module loaded first: the audit would have appeared to exist
  // while never running. An audit that silently does not exist is exactly the
  // class of bug it was written to find.
  if (window.OST_FORENSIC) return;

  var ORDERS_KEY = 'ost.prediction.orders.v1';
  // A real Solana signature is base58, 64 bytes → ~87-88 chars. Anything shorter,
  // or carrying a '-', was manufactured by us and never touched the network.
  var REAL_SIG = /^[1-9A-HJ-NP-Za-km-z]{80,90}$/;
  var FAKE_SIG = /^(local|credits)-/i;

  function readOrders() {
    try { return JSON.parse(localStorage.getItem(ORDERS_KEY) || '[]') || []; }
    catch (_) { return []; }
  }

  function looksReal(sig) { return !!sig && REAL_SIG.test(String(sig)); }
  function looksFake(sig) { return !!sig && FAKE_SIG.test(String(sig)); }

  // Raw JSON-RPC on purpose. The first version called window.getSolanaConnection(),
  // which is NOT a global — it lives inside app.js's IIFE — so it was always
  // undefined and every ticket silently landed in UNVERIFIED. An audit that
  // depends on another module's internals can be broken by load order, and an
  // audit that quietly verifies nothing is worse than no audit at all. fetch has
  // no such dependency.
  var RPC = (function () {
    try { if (window.OST_RPC_URL) return String(window.OST_RPC_URL); } catch (_) {}
    return 'https://api.devnet.solana.com';
  })();

  async function rpc(method, params) {
    var res = await fetch(RPC, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: method, params: params })
    });
    if (!res.ok) throw new Error('rpc ' + res.status);
    var j = await res.json();
    if (j.error) throw new Error(j.error.message || 'rpc error');
    return j.result;
  }

  // Ask the chain whether a signature actually exists. Never infer this from our
  // own records — our own records are what is under suspicion.
  async function onChain(sigs) {
    var out = {};
    if (!sigs.length) return out;
    for (var i = 0; i < sigs.length; i += 100) {
      var batch = sigs.slice(i, i + 100);
      try {
        // searchTransactionHistory: without it the node only checks its recent
        // cache and old-but-real signatures come back null — which would condemn
        // genuinely-owed tickets as phantom. This audit decides who gets paid, so
        // it must look at the full history.
        var res = await rpc('getSignatureStatuses', [batch, { searchTransactionHistory: true }]);
        var vals = (res && res.value) || [];
        batch.forEach(function (s, j) {
          var v = vals[j];
          out[s] = v ? !v.err : false;
        });
      } catch (_) {
        // Unknown is NOT the same as absent. Leave it undefined so the report can
        // say "could not verify" rather than silently condemning a real ticket.
        batch.forEach(function (s) { out[s] = undefined; });
      }
    }
    return out;
  }

  async function rpcAlive() {
    try { await rpc('getHealth', []); return true; } catch (_) { return false; }
  }

  async function run(opts) {
    opts = opts || {};
    var orders = readOrders();
    var alive = await rpcAlive();

    var suspect = orders.filter(function (o) {
      return looksFake(o && (o.cashoutSig || o.sig)) || looksFake(o && o.signature);
    });

    // Verify the BUY signatures — that is what proves the stake moved.
    var buySigs = [];
    suspect.forEach(function (o) {
      var s = o.signature || o.sig;
      if (looksReal(s) && buySigs.indexOf(s) < 0) buySigs.push(s);
    });
    var confirmed = await onChain(buySigs);

    var real = [], phantom = [], unverified = [];
    suspect.forEach(function (o) {
      var buy = o.signature || o.sig;
      var owed = Number(o.cashoutOst || 0) || 0;
      var row = {
        id: o.id || o.reference || '',
        marketId: o.marketId || '',
        title: o.title || '',
        side: o.side || '',
        stake: Number(o.stake || 0) || 0,
        owedOst: owed,
        fundedBy: o.fundedBy || '',
        buySig: buy || '',
        cashoutSig: o.cashoutSig || '',
        cashoutError: o.cashoutError || '',
        cashoutAt: o.cashoutAt || 0
      };
      if (!looksReal(buy)) { row.why = 'buy signature is not a real Solana signature — the stake never left the wallet'; phantom.push(row); return; }
      if (confirmed[buy] === true) { row.why = 'stake confirmed on-chain; payout was faked'; real.push(row); return; }
      if (confirmed[buy] === false) { row.why = 'buy signature not found on-chain — never landed'; phantom.push(row); return; }
      row.why = 'could not reach an RPC to verify — NOT a verdict';
      unverified.push(row);
    });

    var sum = function (rows) { return rows.reduce(function (a, r) { return a + (Number(r.owedOst) || 0); }, 0); };

    var report = {
      scannedOrders: orders.length,
      suspectTickets: suspect.length,
      real: real,
      phantom: phantom,
      unverified: unverified,
      owedOst: Number(sum(real).toFixed(9)),
      phantomOst: Number(sum(phantom).toFixed(9)),
      unverifiedOst: Number(sum(unverified).toFixed(9)),
      rpcAvailable: alive,
      rpc: RPC,
      wallet: (function () {
        try { return (window.connectedWalletSession && window.connectedWalletSession.publicKey && window.connectedWalletSession.publicKey.toBase58()) || ''; }
        catch (_) { return ''; }
      })(),
      generatedAt: new Date().toISOString(),
      note: 'READ ONLY. owedOst is the only figure that may ever be paid. phantomOst must NOT be paid — those stakes never left the wallet, so paying them mints OST from nothing.'
    };

    if (opts.log !== false) {
      console.log('%c OST FORENSIC AUDIT ', 'background:#7c2d12;color:#fed7aa;font-weight:bold');
      console.log('scanned orders     :', report.scannedOrders);
      console.log('suspect tickets    :', report.suspectTickets);
      console.log('REAL   (owed)      :', real.length, '→', report.owedOst, 'OST  ← recoverable, stake is in the pool');
      console.log('PHANTOM(not owed)  :', phantom.length, '→', report.phantomOst, 'OST  ← stake never moved; paying this mints OST');
      console.log('UNVERIFIED         :', unverified.length, '→', report.unverifiedOst, 'OST  ← no RPC verdict; re-run online');
      if (!alive) console.warn('RPC unreachable (' + RPC + ') — every ticket is UNVERIFIED. Re-run when online; do not treat this as a verdict.');
      console.log('full report        : window.OST_FORENSIC.last');
    }
    window.OST_FORENSIC.last = report;
    return report;
  }

  window.OST_FORENSIC = {
    run: run,
    last: null,
    // Deliberately absent: anything that pays, claims, or mutates an order.
    // This module exists to be trusted, and it can only be trusted if it is
    // incapable of moving money. Recovery belongs in a separate, reviewed file.
    readOnly: true
  };
})();

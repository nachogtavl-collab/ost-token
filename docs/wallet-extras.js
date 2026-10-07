/* ==========================================================================
   OST wallet-extras.js — real send/receive flows + on-chain balance curve
   - Adds a Send OST modal that builds a real Token-2022 transferChecked tx
   - Records every transaction we send as a balance snapshot in localStorage
   - Replaces the synthetic "wallet portfolio curve" with real money in/out
   - Auto-selects SOL in the Convert dropdown when the user clicks "Buy OST"
   Loaded after app.js + polish.js
   ========================================================================== */
(function () {
  'use strict';

  var SNAPSHOT_KEY = 'ost.wallet.balanceHistory.v1';
  var MAX_SNAPSHOTS = 200;

  function $(id) { return document.getElementById(id); }
  function on(el, ev, fn) { if (el) el.addEventListener(ev, fn); }
  function toast(icon, msg) {
    try {
      if (typeof window.toast === 'function') return window.toast(icon, msg);
      if (window.OST_OPTIMISTIC && typeof window.OST_OPTIMISTIC.toast === 'function') return window.OST_OPTIMISTIC.toast(String(msg), /⚠|❌|✖/.test(String(icon)) ? 'error' : 'info');
    } catch (e) {}
  }

  function loadSnapshots() {
    try {
      var raw = localStorage.getItem(SNAPSHOT_KEY);
      if (!raw) return [];
      var parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) { return []; }
  }

  function saveSnapshots(list) {
    try {
      localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(list.slice(-MAX_SNAPSHOTS)));
    } catch (e) {}
  }

  var PLATFORM_LEDGER_KEY = 'ost.wallet.platformLedger.v1';
  function readPlatformLedger() {
    try { return JSON.parse(localStorage.getItem(PLATFORM_LEDGER_KEY) || '{}') || {}; }
    catch (e) { return {}; }
  }
  function writePlatformLedger(ledger) {
    try { localStorage.setItem(PLATFORM_LEDGER_KEY, JSON.stringify(ledger || {})); } catch (e) {}
  }
  function readGameCredits() {
    try {
      var bank = JSON.parse(localStorage.getItem('ost.faucet.hub.v2') || '{}') || {};
      return Number(bank.credits || 0) || 0;
    } catch (e) { return 0; }
  }
  function applyPlatformEventToLedger(event) {
    var ledger = readPlatformLedger();
    var rawGameCredits = event && event.gameCredits;
    var hasGameCredits = rawGameCredits !== null && rawGameCredits !== undefined && rawGameCredits !== '';
    var eventGameCredits = Number(rawGameCredits);
    if (hasGameCredits && Number.isFinite(eventGameCredits)) ledger.gameCredits = eventGameCredits;
    else if (!Number.isFinite(Number(ledger.gameCredits))) ledger.gameCredits = readGameCredits();
    ledger.launchpadExposure = Number(ledger.launchpadExposure || 0) || 0;
    var amount = Number(event && event.amount || 0) || 0;
    var eventLaunchpadExposure = Number(event && event.launchpadExposure);
    if (Number.isFinite(eventLaunchpadExposure)) ledger.launchpadExposure = Math.max(0, eventLaunchpadExposure);
    else if (event && event.kind === 'launchpad-buy') ledger.launchpadExposure += amount;
    else if (event && event.kind === 'launchpad-sell') ledger.launchpadExposure = Math.max(0, ledger.launchpadExposure - amount);
    ledger.updatedAt = Date.now();
    writePlatformLedger(ledger);
    return ledger;
  }
  function enrichSnapshot(rawSnap) {
    var event = rawSnap || {};
    var ledger = applyPlatformEventToLedger(event);
    return Object.assign({}, event, {
      gameCredits: Number(ledger.gameCredits || 0) || 0,
      launchpadExposure: Number(ledger.launchpadExposure || 0) || 0
    });
  }

  function getOstApiBase() {
    return window.OST_API_BASE ? String(window.OST_API_BASE).replace(/\/$/, '') : '';
  }
  function getActiveWalletAddress() {
    try {
      var wallet = window.OST_WALLET;
      if (wallet && wallet.session && wallet.session.publicKey) return wallet.session.publicKey.toBase58();
      if (wallet && wallet.address) return String(wallet.address);
      if (window.OST_WALLET_PUBKEY) return String(window.OST_WALLET_PUBKEY);
    } catch (e) {}
    return '';
  }
  function eventKey(event) {
    if (!event) return '';
    return String(event.id || event.eventId || event.sig || event.signature || [event.kind || '', event.ts || '', event.amount || '', event.token || event.game || event.marketId || ''].join(':'));
  }
  function normalizeEventTs(value) {
    if (!value) return Date.now();
    var number = Number(value);
    if (Number.isFinite(number)) return number < 100000000000 ? number * 1000 : number;
    var parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : Date.now();
  }
  function shareWalletEvent(snapshot) {
    var base = getOstApiBase();
    var wallet = (snapshot && snapshot.wallet) || getActiveWalletAddress();
    if (!base || !wallet || !snapshot || snapshot.syncedFrom === 'ost-api') return;
    if (!snapshot.kind || snapshot.kind === 'tick') return;
    try {
      fetch(base + '/wallet/events', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(Object.assign({}, snapshot, {
          wallet: wallet,
          id: eventKey(snapshot),
          ts: snapshot.ts || Date.now()
        }))
      }).catch(function() {});
    } catch (e) {}
  }
  function mergeWalletEventsIntoSnapshots(events) {
    var byKey = {};
    loadSnapshots().forEach(function(snapshot) {
      var key = eventKey(snapshot);
      if (key) byKey[key] = snapshot;
    });
    (events || []).slice().sort(function(a, b) {
      return normalizeEventTs(a && a.ts) - normalizeEventTs(b && b.ts);
    }).forEach(function(event) {
      if (!event || !event.kind) return;
      var snap = enrichSnapshot(Object.assign({}, event, {
        ts: normalizeEventTs(event.ts),
        syncedFrom: 'ost-api'
      }));
      var key = eventKey(snap);
      if (key) byKey[key] = Object.assign({}, byKey[key] || {}, snap);
    });
    var merged = Object.keys(byKey).map(function(key) { return byKey[key]; }).sort(function(a, b) {
      return Number(a.ts || 0) - Number(b.ts || 0);
    }).slice(-MAX_SNAPSHOTS);
    saveSnapshots(merged);
    return merged;
  }
  window.syncOstWalletEventsFromRemote = function syncOstWalletEventsFromRemote() {
    var base = getOstApiBase();
    var wallet = getActiveWalletAddress();
    if (!base || !wallet || window.syncOstWalletEventsFromRemote.inFlight) return Promise.resolve(false);
    window.syncOstWalletEventsFromRemote.inFlight = true;
    return fetch(base + '/wallet/events/' + encodeURIComponent(wallet) + '?limit=300', { cache: 'no-store', headers: { accept: 'application/json' } })
      .then(function(response) { return response.ok ? response.json() : null; })
      .then(function(payload) {
        var events = payload && Array.isArray(payload.events) ? payload.events : [];
        if (!events.length) return false;
        mergeWalletEventsIntoSnapshots(events);
        refreshChartIfReady();
        notifyTxHistory();
        try { window.dispatchEvent(new CustomEvent('ost:wallet-events-synced')); } catch (e) {}
        return true;
      })
      .catch(function() { return false; })
      .finally(function() { window.syncOstWalletEventsFromRemote.inFlight = false; });
  };

  // ------------------------------------------------------------------
  // 0) Real SOL → OST swap engine (devnet co-signed)
  //    Builds an atomic Transaction:
  //      ix1: SystemProgram.transfer(user → swapPool, lamports)
  //      ix2: token transferChecked(swapPool ATA → user ATA, OST amount)
  //    Both signers (user + swapPool) sign before the network sees it.
  //    The swap pool keypair is published in site/swap-pool.js (devnet ONLY).
  // ------------------------------------------------------------------
  // SOL/USD for CONVERSIONS comes from /topup/config only (contract C7) — the
  // same number the worker quotes with. No hard-coded fallback on a money
  // path: while it is unknown, quotes show "—" and the config is fetched.
  function configSolUsd() {
    try {
      var cfg = typeof topupConfigCache !== 'undefined' && topupConfigCache && topupConfigCache.value;
      var v = Number(cfg && cfg.pricing && cfg.pricing.solUsd);
      if (Number.isFinite(v) && v > 0) return v;
    } catch (e) {}
    try {
      if (window.OST_TOPUP && typeof window.OST_TOPUP.solUsdLive === 'function') {
        var t = Number(window.OST_TOPUP.solUsdLive());
        if (Number.isFinite(t) && t > 0) return t;
      }
    } catch (e) {}
    return null;
  }
  var solPriceKick = 0;
  function getLiveSolUsd() {
    var v = configSolUsd();
    if (v) return v;
    if (Date.now() - solPriceKick > 15000) {
      solPriceKick = Date.now();
      try { loadTopupConfig().then(function () { try { window.dispatchEvent(new CustomEvent('ost:convert-price')); } catch (_) {} }).catch(function () {}); } catch (e) {}
    }
    return null;
  }
  // THE canonical USD price of OST for CONVERSIONS (both swap directions and
  // the fiat tiers): the fixed devnet rate from /topup/config (0.0118). The
  // synthetic market oracle (window.OST.getPrice) is a DISPLAY index for
  // charts and is deliberately NOT used here — two prices 20x apart made a
  // SOL -> OST -> SOL round trip lose most of its value.
  function getLiveOstUsd() {
    try {
      var cfg = typeof topupConfigCache !== 'undefined' && topupConfigCache && topupConfigCache.value;
      var c = Number(cfg && cfg.pricing && cfg.pricing.usdPerOst);
      if (Number.isFinite(c) && c > 0) return c;
    } catch (e) {}
    try {
      if (window.OST_TOPUP && typeof window.OST_TOPUP.usdPerOst === 'function') {
        var liveTop = Number(window.OST_TOPUP.usdPerOst());
        if (Number.isFinite(liveTop) && liveTop > 0) return liveTop;
      }
    } catch (e) {}
    return 0.0118; // the fixed devnet conversion rate (topup.js DEFAULT_USD_PER_OST)
  }
  // One exported source so no module can invent a second conversion price.
  window.OST_CONVERT_PRICE = {
    ostUsd: getLiveOstUsd,
    solUsd: function () { return getLiveSolUsd(); }
  };

  var POOL_SWAP_FEE = 0.005;          // worker POOL_SWAP_FEE (solana-pool.js)
  var RENT_MIN_LAMPORTS = 890880;     // Solana rent-exempt minimum for a plain account

  function quoteSolToOst(solAmount) {
    var solUsd = getLiveSolUsd();
    var ostUsd = getLiveOstUsd();
    if (!solUsd || !ostUsd) return { ost: NaN, grossOst: NaN, fee: NaN, solUsd: null, ostUsd: ostUsd, rate: NaN, priceUnknown: true };
    var grossOst = (Number(solAmount) * solUsd) / ostUsd;
    var fee = grossOst * POOL_SWAP_FEE;
    return {
      ost: Math.max(grossOst - fee, 0),
      grossOst: grossOst,
      fee: fee,
      solUsd: solUsd,
      ostUsd: ostUsd,
      rate: solUsd / ostUsd
    };
  }

  function moneyErr(code, message, extra) {
    var e = new Error(message);
    e.code = code;
    if (extra) Object.keys(extra).forEach(function (k) { e[k] = extra[k]; });
    return e;
  }
  function solLamportsOf(pubkey) {
    var w = window.OST_WALLET;
    return w.rpcCall(function (c) { return c.getBalance(pubkey); });
  }

  // SOL-1: the one way to get devnet SOL is to cash out OST -> SOL. Opens
  // Wallet → Convert with "From: OST" and 10 OST preset (RNT-1: a first
  // cash-out into an empty wallet must cover Solana's rent minimum).
  function openGetSol(presetOst) {
    var amount = Number(presetOst) > 0 ? Number(presetOst) : 10;
    // The preset must clear the rent minimum at today's SOL price.
    try {
      var Bm = window.OST_BALANCE && OST_BALANCE.get ? OST_BALANCE.get() : {};
      var lamNow = Bm.sol != null ? Math.round(Number(Bm.sol) * 1e9) : 0;
      var minNow = window.OST_REAL_SWAP && typeof OST_REAL_SWAP.minOstFor === 'function' ? OST_REAL_SWAP.minOstFor(lamNow) : 0;
      if (minNow && minNow > amount) amount = Math.ceil(minNow);
    } catch (e) {}
    try { closeSendModal(); } catch (e) {}
    try { if (window.OST_COMPARTMENTS && typeof window.OST_COMPARTMENTS.activate === 'function') window.OST_COMPARTMENTS.activate('wallet', true); } catch (e) {}
    try { if (typeof window.setWalletPanel === 'function') window.setWalletPanel('convert', { scroll: true }); } catch (e) {}
    var tries = 0;
    (function fill() {
      var sel = $('transferFrom'), amt = $('transferAmount');
      if (sel && amt && sel.querySelector('option[value="OST"]')) {
        sel.value = 'OST';
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        amt.value = String(amount);
        amt.dispatchEvent(new Event('input', { bubbles: true }));
        try { (sel.closest('.convert-terminal') || sel).scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {}
        return;
      }
      if (tries++ < 20) setTimeout(fill, 200);
    })();
    return true;
  }
  window.OST_GET_SOL = { open: openGetSol };
  // A "Need SOL" message always comes with this button, never as a dead end.
  function getSolButtonHtml() {
    return '<button type="button" class="btn btn-outline btn-sm" data-ost-get-sol="10" style="margin-top:6px;">Get SOL: cash out 10 OST → SOL</button>';
  }
  document.addEventListener('click', function (e) {
    var b = e.target && e.target.closest && e.target.closest('[data-ost-get-sol]');
    if (!b) return;
    e.preventDefault();
    openGetSol(Number(b.getAttribute('data-ost-get-sol')) || 10);
  });

  async function performRealSwap(solAmount, opts) {
    opts = opts || {};
    var w = window.OST_WALLET;
    if (!w || !w.session || !w.session.publicKey) throw moneyErr('no_wallet', 'Connect a wallet first');
    if (!Number.isFinite(solAmount) || solAmount <= 0) throw moneyErr('invalid_amount', 'Enter a SOL amount greater than zero.');
    if (!window.OST_RESCUE || typeof window.OST_RESCUE.cosignSwap !== 'function') throw moneyErr('bad_response', 'Swap rail still loading — try again in a moment.');

    // Client checks are instant feedback only; the worker re-quotes and re-checks.
    var quote = quoteSolToOst(solAmount);
    var needed = Math.round(solAmount * 1e9);
    var have = null;
    try { have = Number(await solLamportsOf(w.session.publicKey)); } catch (e) { have = null; }
    if (have != null && Number.isFinite(have)) {
      if (have < needed) {
        throw moneyErr('insufficient_sol', 'Need ' + (needed / 1e9).toFixed(6) + ' SOL (you have ' + (have / 1e9).toFixed(6) + ').', { needSol: needed / 1e9, haveSol: have / 1e9, getSol: true });
      }
      var rest = have - needed;      // the pool pays the network fee
      if (rest > 0 && rest < RENT_MIN_LAMPORTS) {
        throw moneyErr('keep_rent_reserve', 'Leave at least 0.00089 SOL in your wallet, or swap all of it.', { maxSol: Math.max(0, have - RENT_MIN_LAMPORTS) / 1e9, allSol: have / 1e9 });
      }
    }

    // One cosign per user action. cosignSwap verifies the built transaction
    // debits exactly the typed SOL before anything is signed (SOL-2).
    var result = await window.OST_RESCUE.cosignSwap('sol-to-ost', { amount: solAmount, memo: opts.memo ? String(opts.memo) : '' });
    var sig = result.sig;
    var toSendOst = result.quote && Number(result.quote.ostAmount);
    quote = Object.assign({}, quote, result.quote || {}, { ost: toSendOst });

    // Snapshot for the curve from the shared balance (no extra RPC).
    try {
      var B = window.OST_BALANCE && OST_BALANCE.get ? OST_BALANCE.get() : {};
      recordSnapshot({ ts: Date.now(), ostBalance: B.ost, solBalance: B.sol, kind: 'swap-in', amount: quote.ost, sig: sig, pending: !!result.pending });
      refreshChartIfReady();
    } catch (e) {}

    try { window.dispatchEvent(new CustomEvent('ost:house-fee', { detail: { source: 'swap', amount: Number(quote.fee) || 0, label: 'swap pool fee' } })); } catch (e) {}

    return { ok: true, sig: sig, pending: !!result.pending, ost: quote.ost, solUsd: quote.solUsd, rate: quote.rate, fee: quote.fee };
  }

  // ------------------------------------------------------------------
  // 0a-bis) Universal "any currency → OST" path
  // For SOL we do the real co-signed atomic swap above.
  // For BTC/ETH/USDC/USDT/BNB/fiat we can't receive the actual asset on
  // Solana devnet, so the swap pool releases OST to the user at the live
  // USD rate and we record a TREASURY RESERVE entry — a synthetic IOU that
  // says "the OST treasury is backed by N units of <currency>". The ledger
  // is exposed via window.OST_TREASURY.reserves() for the dashboard.
  // ------------------------------------------------------------------
  var TREASURY_KEY = 'ost.treasury.reserves.v1';
  function readReserves() {
    try { return JSON.parse(localStorage.getItem(TREASURY_KEY) || '[]'); } catch (e) { return []; }
  }
  function writeReserves(list) {
    try { localStorage.setItem(TREASURY_KEY, JSON.stringify(list.slice(0, 500))); } catch (e) {}
  }
  function recordReserve(entry) {
    var list = readReserves(); list.unshift(entry); writeReserves(list);
    try { window.dispatchEvent(new CustomEvent('ost-treasury-changed', { detail: entry })); } catch (e) {}
  }

  // Live USD price per unit for any supported currency
  function priceUsd(currency) {
    var p = window.__ostPrices || {};
    var c = String(currency || '').toUpperCase();
    if (c === 'SOL') return getLiveSolUsd() || NaN;
    if (c === 'BTC') return Number.isFinite(p.bitcoin) && p.bitcoin > 0 ? p.bitcoin : 105000;
    if (c === 'ETH') return Number.isFinite(p.ethereum) && p.ethereum > 0 ? p.ethereum : 3800;
    if (c === 'BNB') return 650;
    if (c === 'USDC' || c === 'USDT' || c === 'USD') return 1;
    // Approximate fiat → USD rates (live overrides via window.__fiatRates if present)
    var fiatRates = window.__fiatRates || {
      EUR: 1.08, GBP: 1.27, JPY: 0.0066, CNY: 0.14, INR: 0.012, BRL: 0.20,
      RUB: 0.011, NGN: 0.0006, MXN: 0.058, CAD: 0.74, AUD: 0.66, CHF: 1.13,
      KRW: 0.00074, TRY: 0.029, ARS: 0.0011, EGP: 0.020, IDR: 0.000063,
      PHP: 0.018, THB: 0.028, VND: 0.000040, PLN: 0.25, SAR: 0.27, COP: 0.00024,
      KES: 0.0078, SEK: 0.094
    };
    return Number(fiatRates[c]) || 1;
  }

  function quoteAnyToOst(currency, amount) {
    var unitUsd = priceUsd(currency);
    var ostUsd = getLiveOstUsd();
    var usd = Number(amount) * unitUsd;
    var grossOst = usd / ostUsd;
    var fee = grossOst * 0.005; // 0.5%
    return {
      ost: Math.max(grossOst - fee, 0),
      grossOst: grossOst,
      fee: fee,
      usd: usd,
      unitUsd: unitUsd,
      ostUsd: ostUsd,
      rate: unitUsd / ostUsd,
      currency: String(currency || '').toUpperCase()
    };
  }

  // Pool sends OST to user (transferChecked only, no inbound asset on devnet).
  // Records a treasury reserve entry so the IOU is visible.
  async function performTreasuryDeposit(currency, amount, opts) {
    opts = opts || {};
    var w = window.OST_WALLET;
    if (!w || !w.session || !w.session.publicKey) throw new Error('Connect a wallet first');
    var amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) throw new Error('Invalid amount');

    // SOL keeps its real atomic on-chain swap path
    if (String(currency || '').toUpperCase() === 'SOL') {
      var r = await performRealSwap(amt, opts);
      recordReserve({
        ts: Date.now(), currency: 'SOL', amount: amt, usd: amt * priceUsd('SOL'),
        ost: r.ost, kind: 'on-chain-swap', sig: r.sig, backed: true
      });
      return Object.assign({}, r, { currency: 'SOL', kind: 'on-chain-swap' });
    }

    var pool = getSwapPool();
    if (!pool) throw new Error('Swap pool not loaded — refresh the page');
    var poolPub = pool.publicKey;
    var poolAta = new solanaWeb3.PublicKey(window.OST_SWAP_POOL.ata);
    var mintPk = new solanaWeb3.PublicKey(window.OST_SWAP_POOL.mint);
    var c = w.constants;
    var conn = w.getConnection();

    var quote = quoteAnyToOst(currency, amt);
    if (quote.ost <= 0) throw new Error('Quote too small (' + quote.ost.toFixed(6) + ' OST)');

    // Non-SOL deposits (BTC/ETH/USDC…) cannot be observed from the browser, so
    // the browser must never ask the vault to pay for them. The worker credits
    // a crypto deposit only after it verifies the on-chain payment
    // (POST /topup/verify-crypto → server-side delivery). Route the user there.
    try { if (window.OST_TOPUP && typeof window.OST_TOPUP.open === 'function') window.OST_TOPUP.open({ method: 'crypto', currency: quote.currency, amount: amt }); } catch (_) {}
    throw new Error(quote.currency + ' deposits are verified by the server — use Top up → Crypto. The vault only pays once the deposit is confirmed.');
    // eslint-disable-next-line no-unreachable
    var pr = { sig: null, ost: 0 };
    var sig = pr.sig;
    var actualOst = pr.ost;
    quote = Object.assign({}, quote, { ost: actualOst });

    var entry = {
      ts: Date.now(), currency: quote.currency, amount: amt, usd: quote.usd,
      ost: quote.ost, kind: 'treasury-iou', sig: sig, backed: true,
      rate: quote.rate, unitUsd: quote.unitUsd, fee: quote.fee
    };
    recordReserve(entry);

    try {
      var ostBal = await w.getOstBalance(w.session.publicKey);
      var solBal = (await conn.getBalance(w.session.publicKey)) / solanaWeb3.LAMPORTS_PER_SOL;
      recordSnapshot({ ts: Date.now(), ostBalance: ostBal, solBalance: solBal, kind: 'treasury-in', amount: quote.ost, sig: sig });
      refreshChartIfReady();
    } catch (e) {}

    // The 0.5% conversion fee is OST the pool kept — real ledger entry.
    try { window.dispatchEvent(new CustomEvent('ost:house-fee', { detail: { source: 'swap', amount: Number(quote.fee) || 0, label: quote.currency + ' conversion fee' } })); } catch (e) {}

    return { sig: sig, ost: quote.ost, currency: quote.currency, usd: quote.usd, rate: quote.rate, kind: 'treasury-iou' };
  }

  function reserveTotals() {
    var list = readReserves();
    var byCurrency = {}, totalUsd = 0, totalOst = 0;
    list.forEach(function (e) {
      byCurrency[e.currency] = (byCurrency[e.currency] || 0) + Number(e.amount || 0);
      totalUsd += Number(e.usd || 0);
      totalOst += Number(e.ost || 0);
    });
    return { byCurrency: byCurrency, totalUsd: totalUsd, totalOst: totalOst, count: list.length };
  }

  window.OST_REAL_SWAP = {
    quote: quoteSolToOst,
    swap: performRealSwap,
    quoteAny: quoteAnyToOst,
    swapAny: performTreasuryDeposit,
    pool: function () { return window.OST_SWAP_POOL ? window.OST_SWAP_POOL.publicKey : null; }
  };

  window.OST_TREASURY = {
    reserves: readReserves,
    totals: reserveTotals,
    record: recordReserve,
    priceUsd: priceUsd
  };

  // ------------------------------------------------------------------
  // 0a-ter) Real top-up client
  // Uses the live /topup API on Pages, settles a treasury payment from the
  // connected wallet on the configured Solana cluster, then releases devnet OST
  // from the published devnet pool and finalizes the intent remotely.
  // ------------------------------------------------------------------
  var TOPUP_PENDING_KEY = 'ost.topup.pending.v1';
  var TOPUP_CLAIMED_KEY = 'ost.topup.claimed.v1';
  var TOPUP_DEVNET_RPC = 'https://api.devnet.solana.com';
  var TOPUP_MAINNET_RPC = 'https://solana-rpc.publicnode.com';
  var TOPUP_LAMPORTS_PER_SOL = 1_000_000_000;
  var USDC_DEVNET_MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
  var USDC_MAINNET_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
  var SPL_TOKEN_PROGRAM_ID = new solanaWeb3.PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
  var topupConnections = {};
  var topupConfigCache = { value: null, loadedAt: 0, promise: null };

  function delay(ms) {
    return new Promise(function(resolve) { setTimeout(resolve, ms); });
  }

  function readPendingTopup() {
    try { return JSON.parse(localStorage.getItem(TOPUP_PENDING_KEY) || 'null'); }
    catch (e) { return null; }
  }

  function writePendingTopup(state) {
    try {
      if (!state) localStorage.removeItem(TOPUP_PENDING_KEY);
      else localStorage.setItem(TOPUP_PENDING_KEY, JSON.stringify(state));
    } catch (e) {}
  }

  // Exported writer for other modules (app.js Convert desk). It MERGES into
  // the record for the same order: a saved payment signature is never wiped
  // by a caller that does not know it yet (SOL-4: no second payment), and the
  // typed SOL amount survives (SOL-2). null still clears.
  function rememberPendingFromCaller(state) {
    var cur = readPendingTopup();
    // Never drop a SENT-but-unverified payment for another (or no) order: its
    // signature is the only way that payment is ever verified and delivered.
    if (cur && cur.id && cur.paymentRef && !cur.claimPending && (!state || state.id !== cur.id)) return false;
    if (!state) return writePendingTopup(null);
    var next = Object.assign({}, state);
    if (cur && cur.id && cur.id === next.id) {
      if (!next.paymentRef && cur.paymentRef) {
        next.paymentRef = cur.paymentRef;
        next.paymentAsset = cur.paymentAsset || next.paymentAsset;
        next.paymentAmount = cur.paymentAmount || next.paymentAmount;
      }
      // Keep the saved payment's blockhash window and signing time: they are
      // what lets a never-landed payment be released later.
      if (next.paymentRef && next.paymentRef === cur.paymentRef) {
        if (!next.paymentLvbh && cur.paymentLvbh) next.paymentLvbh = cur.paymentLvbh;
        if (!next.paidAt && cur.paidAt) next.paidAt = cur.paidAt;
      }
      if (!next.createdAt && cur.createdAt) next.createdAt = cur.createdAt;
      if (!(Number(next.solAmount) > 0) && Number(cur.solAmount) > 0) next.solAmount = Number(cur.solAmount);
    }
    if (!(Number(next.solAmount) > 0) && String(next.sourceCurrency || '').toUpperCase() === 'SOL' && Number(next.sourceAmount) > 0) {
      next.solAmount = Number(next.sourceAmount);
    }
    writePendingTopup(next);
  }

  function readClaimedTopups() {
    try { return JSON.parse(localStorage.getItem(TOPUP_CLAIMED_KEY) || '{}') || {}; }
    catch (e) { return {}; }
  }

  function rememberClaimedTopup(intentId, payload) {
    if (!intentId) return;
    var claimed = readClaimedTopups();
    claimed[intentId] = Object.assign({ claimedAt: Date.now() }, payload || {});
    try { localStorage.setItem(TOPUP_CLAIMED_KEY, JSON.stringify(claimed)); } catch (e) {}
  }

  function clearPendingTopup(intentId) {
    var current = readPendingTopup();
    // A blanket clear (no id) keeps a sent-but-unverified payment: only its own
    // order id (after delivery) or a proven failure releases it.
    if (!intentId && current && current.paymentRef && !current.claimPending) return false;
    if (!intentId || (current && current.id === intentId)) writePendingTopup(null);
  }

  function rememberPendingClaim(intent, signature) {
    var current = readPendingTopup() || {};
    writePendingTopup(Object.assign({}, current, {
      id: (intent && intent.id) || current.id || '',
      wallet: (intent && intent.wallet) || current.wallet || getActiveWalletAddress() || '',
      memo: (intent && intent.memo) || current.memo || '',
      usd: Number((intent && intent.usd) || current.usd || 0),
      ostAmount: Number((intent && intent.ostAmount) || current.ostAmount || 0),
      paymentRef: (intent && intent.paymentRef) || current.paymentRef || '',
      claimPending: true,
      deliverySignature: signature ? String(signature) : (current.deliverySignature || '')
    }));
  }

  function rememberPendingPayment(intent, signature, payment, info) {
    if (!intent || !intent.id || !signature) return;
    var current = readPendingTopup() || {};
    if (current.id !== intent.id) current = {};
    var sameSig = current.paymentRef && String(current.paymentRef) === String(signature);
    writePendingTopup(Object.assign({}, current, {
      id: intent.id,
      wallet: intent.wallet || current.wallet || getActiveWalletAddress() || '',
      memo: intent.memo || current.memo || '',
      usd: Number(intent.usd || current.usd || 0),
      ostAmount: Number(intent.ostAmount || current.ostAmount || 0),
      paymentRef: String(signature),
      paymentAsset: (payment && payment.asset) || current.paymentAsset || 'SOL',
      paymentAmount: Number((payment && payment.amount) || current.paymentAmount || 0),
      // The blockhash window of THIS payment: lets a later check prove that a
      // payment which never landed has expired, so the order can be freed.
      paymentLvbh: Number(info && info.lastValidBlockHeight) || (sameSig ? Number(current.paymentLvbh) || null : null),
      paidAt: (sameSig && current.paidAt) || Number(info && info.signedAt) || Date.now(),
      method: intent.method || current.method || 'crypto',
      createdAt: current.createdAt || Date.now()
    }));
  }

  // Look up a saved top-up payment by signature. { ok:false, !pending } means
  // it failed on chain or provably never landed (blockhash window passed).
  // This code always records paidAt with a payment, so a saved payment without
  // it (written by an older build, or a caller that only knew the signature)
  // was signed before this page loaded: the page-load time is a safe upper
  // bound for its signing time.
  var TOPUP_CODE_LOADED_AT = Date.now();
  function lookUpSavedPayment(rec, timeoutMs) {
    if (!rec || !rec.paymentRef || !window.OST_RESCUE || typeof window.OST_RESCUE.confirmBySig !== 'function') return Promise.resolve(null);
    return window.OST_RESCUE.confirmBySig(String(rec.paymentRef), {
      timeoutMs: timeoutMs || 4000,
      lastValidBlockHeight: Number(rec.paymentLvbh) || undefined,
      signedAt: Number(rec.paidAt) || (Number(rec.createdAt) > 0 && Number(rec.createdAt) < TOPUP_CODE_LOADED_AT ? TOPUP_CODE_LOADED_AT : undefined),
      expiryFirst: true
    }).catch(function () { return null; });
  }
  function releaseSavedPayment(rec) {
    writePendingTopup(Object.assign({}, rec, { paymentRef: '', paymentAsset: '', paymentAmount: 0, paymentLvbh: null, paidAt: null }));
  }
  function hasUnverifiedPayment(rec) { return !!(rec && rec.id && rec.paymentRef && !rec.claimPending); }

  // A payment that was SENT for an order and not yet verified locks new
  // orders: a second order would overwrite its saved signature (nobody would
  // ever verify it again) and invite paying twice. The lock frees itself when
  // the order is delivered, or the payment failed / provably never landed.
  async function guardPendingPayment() {
    var prior = readPendingTopup();
    if (!hasUnverifiedPayment(prior)) return;
    var st = null;
    try { st = await getTopupStatus(prior.id); } catch (e) { st = null; }
    if (st && st.status === 'sent') { clearPendingTopup(prior.id); return; }
    if (!(st && st.status === 'paid')) {
      var look = await lookUpSavedPayment(prior, 6000);
      if (look && look.ok === false && !look.pending) { releaseSavedPayment(prior); return; }
      if (look && look.ok && !look.pending) {
        // It landed: verify and deliver it now, then the slot is free.
        try {
          var v = await verifyTopupSignature(prior.id, prior.paymentRef);
          var vi = v && (v.intent || v);
          if (vi && (vi.status === 'paid' || vi.status === 'sent')) await deliverPaidIntent(vi);
        } catch (e) {}
        if (!hasUnverifiedPayment(readPendingTopup())) return;
      }
    } else {
      try { await deliverPaidIntent(st); } catch (e) {}
      if (!hasUnverifiedPayment(readPendingTopup())) return;
    }
    throw moneyErr('payment_pending', 'An earlier payment is still being verified.', { sig: prior.paymentRef, intentId: prior.id, pendingTopup: { id: prior.id, paymentRef: prior.paymentRef, paymentAsset: prior.paymentAsset || 'SOL' } });
  }

  // "Refresh status" for the saved order: verify + deliver it, or free it when
  // its payment provably never landed. Never pays again.
  async function refreshPendingTopup() {
    var p = readPendingTopup();
    if (!p || !p.id) return { none: true };
    return settleTopupIntent(p.id, p.paymentAsset || p.settlementAsset || 'SOL', { verifyOnly: true });
  }

  function normalizeTopupCluster(cluster) {
    var raw = String(cluster || '').toLowerCase();
    return (raw === 'mainnet-beta' || raw === 'mainnet') ? 'mainnet-beta' : 'devnet';
  }

  function resolveTopupCluster(config) {
    var fromConfig = config && config.cluster;
    var fromWindow = typeof window !== 'undefined' ? window.OST_NETWORK : '';
    return normalizeTopupCluster(fromConfig || fromWindow || 'devnet');
  }

  function topupNetworkLabel(config) {
    return resolveTopupCluster(config) === 'mainnet-beta' ? 'Solana mainnet' : 'Solana devnet';
  }

  function resolveTopupRpc(config) {
    var cfgRpc = config && (config.solanaRpc || config.rpcUrl || (config.rpc && config.rpc.solana));
    if (cfgRpc) return String(cfgRpc);
    return resolveTopupCluster(config) === 'mainnet-beta' ? TOPUP_MAINNET_RPC : TOPUP_DEVNET_RPC;
  }

  // Devnet top-up reads/sends go through the wallet's failover connection
  // (NET-1), not a fixed public endpoint.
  function getTopupConnection(config) {
    if (typeof solanaWeb3 === 'undefined') return null;
    if (resolveTopupCluster(config) === 'devnet' && window.OST_WALLET && typeof window.OST_WALLET.getConnection === 'function') {
      try { var c = window.OST_WALLET.getConnection(); if (c) return c; } catch (e) {}
    }
    var rpcUrl = resolveTopupRpc(config);
    if (!topupConnections[rpcUrl]) {
      topupConnections[rpcUrl] = new solanaWeb3.Connection(rpcUrl, { commitment: 'confirmed', disableRetryOnRateLimit: true });
    }
    return topupConnections[rpcUrl];
  }

  function pickTopupReceiver(config, kind) {
    var receivers = config && config.receivers ? config.receivers : {};
    var isMainnet = resolveTopupCluster(config) === 'mainnet-beta';
    if (kind === 'usdc') {
      return isMainnet
        ? (receivers.usdcMainnet || receivers.usdcDevnet || '')
        : (receivers.usdcDevnet || receivers.usdcMainnet || '');
    }
    return isMainnet
      ? (receivers.solMainnet || receivers.solDevnet || '')
      : (receivers.solDevnet || receivers.solMainnet || '');
  }

  function resolveUsdcMint(config) {
    var configured = config && (
      config.usdcMint ||
      config.usdcMintAddress ||
      (config.mints && (config.mints.usdc || config.mints.USDC))
    );
    if (configured) return String(configured);
    return resolveTopupCluster(config) === 'mainnet-beta' ? USDC_MAINNET_MINT : USDC_DEVNET_MINT;
  }

  function getWalletSession() {
    return window.OST_WALLET && window.OST_WALLET.session ? window.OST_WALLET.session : null;
  }

  async function parseTopupResponse(response) {
    var payload = await response.json().catch(function() { return {}; });
    if (!response.ok) {
      var apiError = payload && payload.error ? String(payload.error) : '';
      if (apiError === 'invalid_usd_amount') {
        var minUsd = Number(payload && payload.minUsd);
        var maxUsd = Number(payload && payload.maxUsd);
        var minText = Number.isFinite(minUsd) ? ('$' + minUsd.toFixed(2)) : '$1.00';
        var maxText = Number.isFinite(maxUsd) ? ('$' + maxUsd.toFixed(2)) : '$5000.00';
        throw new Error('Top-up amount must be between ' + minText + ' and ' + maxText + '.');
      }
      if (apiError === 'transaction_not_found') {
        throw new Error('transaction_not_found');
      }
      if (apiError === 'amount_too_low') {
        throw new Error('amount_too_low');
      }
      if (apiError === 'memo_not_found') {
        throw new Error('memo_not_found');
      }
      var detail = payload && (payload.detail || payload.error || payload.message);
      throw new Error(detail ? String(detail) : 'Top-up API returned ' + response.status);
    }
    return payload;
  }

  async function topupRequest(path, options) {
    var base = getOstApiBase();
    if (!base) throw new Error('OST API base is not configured');
    var settings = options || {};
    var headers = Object.assign({ accept: 'application/json' }, settings.headers || {});
    if (settings.body && !headers['content-type']) headers['content-type'] = 'application/json';
    var response = await fetch(base + path, {
      method: settings.method || 'GET',
      headers: headers,
      body: settings.body,
      cache: settings.cache || 'no-store'
    });
    return parseTopupResponse(response);
  }

  async function loadTopupConfig(options) {
    var force = !!(options && options.force);
    var now = Date.now();
    if (!force && topupConfigCache.value && now - topupConfigCache.loadedAt < 60000) {
      return topupConfigCache.value;
    }
    if (!force && topupConfigCache.promise) return topupConfigCache.promise;
    topupConfigCache.promise = topupRequest('/topup/config').then(function(payload) {
      topupConfigCache.value = payload;
      topupConfigCache.loadedAt = Date.now();
      return payload;
    }).finally(function() {
      topupConfigCache.promise = null;
    });
    return topupConfigCache.promise;
  }

  function quoteTopupSettlement(intent, asset, config) {
    var mode = String(asset || 'SOL').toUpperCase() === 'USDC' ? 'USDC' : 'SOL';
    var currentConfig = config || topupConfigCache.value || {};
    if (mode === 'USDC') {
      var usdcAmount = Math.round(Number(intent && intent.usd || 0) * 1e6) / 1e6;
      return {
        asset: 'USDC',
        amount: usdcAmount,
        amountDisplay: usdcAmount.toFixed(2)
      };
    }
    var solUsd = Number(currentConfig && currentConfig.pricing && currentConfig.pricing.solUsd);
    if (!Number.isFinite(solUsd) || solUsd <= 0) throw new Error('SOL/USD price unavailable for top-up settlement');
    var solAmount = Number(intent && intent.usd || 0) / solUsd;
    return {
      asset: 'SOL',
      amount: solAmount,
      amountDisplay: solAmount.toFixed(6)
    };
  }

  async function createTopupIntent(request) {
    var wallet = String((request && request.wallet) || getActiveWalletAddress() || '').trim();
    if (!wallet) throw moneyErr('no_wallet', 'Connect a wallet first');
    // One unverified payment at a time: a new order would wipe its saved
    // signature and invite paying twice (refused with code payment_pending).
    await guardPendingPayment();
    var config = await loadTopupConfig();
    var minUsd = Number(config && config.pricing && config.pricing.minUsd);
    var maxUsd = Number(config && config.pricing && config.pricing.maxUsd);
    if (!Number.isFinite(minUsd) || minUsd <= 0) minUsd = 1;
    if (!Number.isFinite(maxUsd) || maxUsd <= minUsd) maxUsd = 5000;
    var usd = Number(request && request.usd);
    if (!Number.isFinite(usd) || usd <= 0) {
      throw new Error('Could not price that payment amount right now. Try again in a moment.');
    }
    usd = Math.round(usd * 100) / 100;
    // SOL-2: remember the SOL amount the person TYPED so exactly that is
    // signed. Callers pass it as solAmount; the Convert tab's own form is the
    // fallback when a caller does not.
    var typedSol = Number(request && request.solAmount);
    if (!(typedSol > 0) && !(request && request.method === 'stripe')) {
      try {
        var selEl = $('transferFrom'), amtEl = $('transferAmount');
        if (selEl && amtEl && String(selEl.value || '').toUpperCase() === 'SOL') {
          var typedFromForm = Number(String(amtEl.value || '').replace(',', '.'));
          if (typedFromForm > 0) typedSol = typedFromForm;
        }
      } catch (e) {}
    }
    // C7: a SOL order is priced with the ONE SOL price the worker quotes with
    // (/topup/config). A caller that priced it with another number (a stale
    // feed or a fallback constant) would otherwise make the wallet sign a
    // different SOL amount than typed.
    if (typedSol > 0 && !(request && request.method === 'stripe')) {
      var cfgSolUsd = Number(config && config.pricing && config.pricing.solUsd);
      if (Number.isFinite(cfgSolUsd) && cfgSolUsd > 0) {
        var usdFromTyped = Math.round(typedSol * cfgSolUsd * 100) / 100;
        if (Math.abs(usdFromTyped - usd) > Math.max(0.01, usd * 0.01)) usd = usdFromTyped;
      }
    }
    if (usd < minUsd || usd > maxUsd) {
      throw new Error('Top-up amount must be between $' + minUsd.toFixed(2) + ' and $' + maxUsd.toFixed(2) + '.');
    }
    // SOL-1: check the SOL balance BEFORE any order exists, so a wallet without
    // SOL gets "Need SOL" + the Get-SOL path instead of an order it cannot pay.
    if (typedSol > 0 && !(request && request.method === 'stripe')) {
      var needLam = Math.round(typedSol * TOPUP_LAMPORTS_PER_SOL);
      var haveLam = null;
      try {
        var Bs = window.OST_BALANCE && OST_BALANCE.get ? OST_BALANCE.get() : null;
        if (Bs && Bs.sol != null && (!Bs.wallet || Bs.wallet === wallet)) haveLam = Math.round(Number(Bs.sol) * TOPUP_LAMPORTS_PER_SOL);
        if (haveLam == null && window.OST_WALLET && typeof window.OST_WALLET.rpcCall === 'function') {
          haveLam = Number(await window.OST_WALLET.rpcCall(function (c) { return c.getBalance(new solanaWeb3.PublicKey(wallet)); }));
        }
      } catch (e) { haveLam = null; }
      if (haveLam != null && Number.isFinite(haveLam)) {
        if (haveLam < needLam) {
          throw moneyErr('insufficient_sol', 'Need ' + (needLam / TOPUP_LAMPORTS_PER_SOL).toFixed(6) + ' devnet SOL — you have ' + (haveLam / TOPUP_LAMPORTS_PER_SOL).toFixed(6) + '. Get SOL by cashing out 10 OST → SOL (Convert, From: OST). No order was created.', { needSol: needLam / 1e9, haveSol: haveLam / 1e9, getSol: true });
        }
        var restLam = haveLam - needLam;
        if (restLam > 0 && restLam < RENT_MIN_LAMPORTS) {
          throw moneyErr('keep_rent_reserve', 'Leave at least 0.00089 SOL in your wallet after paying, or pay with all of it. No order was created.', { maxSol: Math.max(0, haveLam - RENT_MIN_LAMPORTS) / 1e9 });
        }
      }
    }
    var payload = await topupRequest('/topup/intent', {
      method: 'POST',
      body: JSON.stringify({
        usd: usd,
        wallet: wallet,
        method: request && request.method === 'stripe' ? 'stripe' : 'crypto'
      })
    });
    writePendingTopup({ id: payload.id, wallet: wallet, method: request && request.method === 'stripe' ? 'stripe' : 'crypto', createdAt: Date.now(), solAmount: Number.isFinite(typedSol) && typedSol > 0 ? typedSol : null });
    return payload;
  }

  async function createTopupCheckout(intentId) {
    return topupRequest('/topup/checkout', {
      method: 'POST',
      body: JSON.stringify({ intentId: intentId })
    });
  }

  async function getTopupStatus(intentId) {
    return topupRequest('/topup/status/' + encodeURIComponent(intentId));
  }

  // Server-side delivery: POST /topup/claim asks the worker to pay the paid intent
  // from the pool (PayoutGate, internal key, idempotent on the intent id), then
  // polls /topup/status until it reports 'sent'. Replaces the old client-originated
  // /wallet/payout, which was capped at 2000 OST/day and needed no paid intent.
  // C5: the OST delivery of a paid order is a settled money move into the wallet.
  function deliveredTx(intent, sig) {
    try { window.dispatchEvent(new CustomEvent('ost:wallet-tx', { detail: { sig: String(sig), asset: 'OST', amount: Number(intent && intent.ostAmount || 0), direction: 'in', status: 'confirmed', source: 'topup-delivery' } })); } catch (e) {}
    return { sig: String(sig), server: true };
  }
  async function serverDeliverTopup(intent) {
    var last = null;
    for (var attempt = 0; attempt < 8; attempt++) {
      try {
        var r = await topupRequest('/topup/claim', { method: 'POST', body: JSON.stringify({ id: intent.id, wallet: getActiveWalletAddress() }) });
        var it = r && r.intent;
        if (it && it.status === 'sent' && it.signature) return deliveredTx(intent, it.signature);
        last = r;
      } catch (e) { last = e; }
      try {
        var st = await topupRequest('/topup/status/' + encodeURIComponent(intent.id), { method: 'GET' });
        if (st && st.status === 'sent' && st.signature) return deliveredTx(intent, st.signature);
      } catch (_) {}
      await new Promise(function (res) { setTimeout(res, 1500 + attempt * 500); });
    }
    throw new Error('Payment is recorded; OST delivery is still processing. It completes automatically — check back in a minute.');
  }

  async function claimTopupIntent(intentId, signature) {
    return topupRequest('/topup/claim', {
      method: 'POST',
      body: JSON.stringify({
        id: intentId,
        wallet: getActiveWalletAddress(),
        signature: signature,
        deliveryKind: 'client-release'
      })
    });
  }

  async function verifyTopupSignature(intentId, signature) {
    var lastError = null;
    for (var attempt = 0; attempt < 6; attempt++) {
      try {
        return await topupRequest('/topup/crypto/verify', {
          method: 'POST',
          body: JSON.stringify({ intentId: intentId, signature: signature })
        });
      } catch (error) {
        lastError = error;
        var message = String(error && error.message || error || '').toLowerCase();
        if (message.indexOf('transaction_not_found') === -1 && message.indexOf('rpc') === -1) break;
        await delay(1500 + (attempt * 350));
      }
    }
    var retryMessage = String(lastError && lastError.message || lastError || '').toLowerCase();
    if (retryMessage.indexOf('transaction_not_found') !== -1) {
      var current = await getTopupStatus(intentId).catch(function() { return { id: intentId, status: 'pending' }; });
      return {
        ok: true,
        status: current && current.status ? current.status : 'pending',
        pendingVerification: true,
        intent: current
      };
    }
    throw lastError || new Error('Could not verify treasury payment');
  }

  function collectTopupInstructions(tx) {
    var out = [];
    try {
      var top = tx && tx.transaction && tx.transaction.message && tx.transaction.message.instructions;
      if (Array.isArray(top)) out = out.concat(top);
      var inner = tx && tx.meta && tx.meta.innerInstructions;
      if (Array.isArray(inner)) {
        inner.forEach(function(group) {
          if (group && Array.isArray(group.instructions)) out = out.concat(group.instructions);
        });
      }
    } catch (e) {}
    return out;
  }

  function topupTransactionHasMemo(tx, memo) {
    var needle = String(memo || '').trim();
    if (!needle) return false;
    var instructions = collectTopupInstructions(tx);
    for (var i = 0; i < instructions.length; i += 1) {
      var instruction = instructions[i] || {};
      var programId = String(instruction.programId || '');
      if (instruction.program !== 'spl-memo' && programId.indexOf('Memo') !== 0) continue;
      var parsed = instruction.parsed;
      if (typeof parsed === 'string' && parsed.indexOf(needle) !== -1) return true;
      if (parsed && typeof parsed === 'object' && String(parsed.memo || parsed.text || '').indexOf(needle) !== -1) return true;
    }
    var logs = Array.isArray(tx && tx.meta && tx.meta.logMessages) ? tx.meta.logMessages.join('\n') : '';
    return logs.indexOf(needle) !== -1;
  }

  function sumTopupSolLamportsTo(tx, receiver) {
    var total = 0;
    collectTopupInstructions(tx).forEach(function(instruction) {
      var parsed = instruction && instruction.parsed;
      var info = parsed && parsed.info || {};
      if (!instruction || instruction.program !== 'system' || !parsed || parsed.type !== 'transfer') return;
      if (String(info.destination || '') === receiver) total += Number(info.lamports || 0);
    });
    return total;
  }

  async function fetchTopupTransaction(conn, signature) {
    for (var attempt = 0; attempt < 18; attempt += 1) {
      var status = null;
      try {
        var statusRes = await conn.getSignatureStatuses([signature], { searchTransactionHistory: true });
        status = statusRes && statusRes.value && statusRes.value[0];
      } catch (e) {}
      if (status && status.err) throw new Error('Payment transaction failed on-chain');
      var tx = null;
      try {
        if (typeof conn.getParsedTransaction === 'function') {
          tx = await conn.getParsedTransaction(signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
        }
      } catch (e1) {
        try { tx = await conn.getTransaction(signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 }); } catch (e2) {}
      }
      if (tx) return tx;
      await delay(700 + attempt * 180);
    }
    return null;
  }

  async function verifySubmittedTopupPayment(intent, payment, config) {
    if (!intent || !intent.id || !payment || !payment.signature) return null;
    var currentConfig = config || await loadTopupConfig({ force: true });
    var asset = String(payment.asset || 'SOL').toUpperCase();
    if (asset !== 'SOL') return null;
    var treasury = pickTopupReceiver(currentConfig, 'sol');
    if (!treasury) throw new Error('Treasury SOL receiver is not configured');
    var conn = getTopupConnection(currentConfig);
    var tx = await fetchTopupTransaction(conn, payment.signature);
    if (!tx) return null;
    if (tx.meta && tx.meta.err) throw new Error('Payment transaction failed on-chain');
    if (!topupTransactionHasMemo(tx, intent.memo)) throw new Error('Payment memo was not found on the submitted transaction');
    var paidLamports = sumTopupSolLamportsTo(tx, treasury);
    var expectedAmount = Number(payment.amount || 0);
    if (!Number.isFinite(expectedAmount) || expectedAmount <= 0) {
      expectedAmount = quoteTopupSettlement(intent, 'SOL', currentConfig).amount;
    }
    var expectedLamports = Math.max(1, Math.ceil(expectedAmount * TOPUP_LAMPORTS_PER_SOL));
    if (paidLamports + 2 < expectedLamports) {
      throw new Error('Submitted SOL payment is below the locked settlement amount');
    }
    return { ok: true, signature: payment.signature, paidLamports: paidLamports, expectedLamports: expectedLamports, tx: tx };
  }

  // Raw RPC / program-log text never reaches the message (C3): it is kept on
  // the error for OST_MONEY_ERRORS to decode into a plain-English code.
  function transactionError(err) {
    var logs = err && Array.isArray(err.logs) ? err.logs : [];
    var raw = String((err && err.message) || err || '') + (logs.length ? ' ' + logs.join(' ') : '');
    var code = (err && (err.code === 4001 || /user rejected|rejected the request|declined|cancell?ed/i.test(raw))) ? 'user_rejected' : '';
    if (!code) { try { code = (window.OST_MONEY_ERRORS && window.OST_MONEY_ERRORS.codeFromText(raw)) || ''; } catch (e) {} }
    var e2 = moneyErr(code || 'transaction_failed', 'The payment was not sent.', { logs: logs, rawMessage: raw.slice(0, 400), serverMessage: 'The payment was not sent.' });
    try { if (window.OST_MONEY_ERRORS) { e2.human = window.OST_MONEY_ERRORS.humanize(e2); e2.message = e2.human.title + (e2.human.body ? ' — ' + e2.human.body : ''); } } catch (e) {}
    return e2;
  }

  // SRV-6: never rebroadcast a rejected simulation with skipPreflight — that
  // lands a doomed transaction on chain and hides the real reason. The only
  // safe exceptions are an RPC node that is behind (no record of a prior
  // credit) or has not seen the blockhash yet.
  async function sendRawWithRetry(conn, serialized) {
    try {
      return await conn.sendRawTransaction(serialized, {
        skipPreflight: false,
        preflightCommitment: 'confirmed'
      });
    } catch (error) {
      var message = String(error && error.message || error || '');
      if (/no record of a prior credit|blockhash not found/i.test(message)) {
        return conn.sendRawTransaction(serialized, { skipPreflight: true });
      }
      throw error;
    }
  }

  // The fee payer's signature IS the transaction id, and it exists the moment
  // the transaction is signed — before anything is sent.
  function signatureOfSigned(tx) {
    try {
      if (window.OST_RESCUE && typeof window.OST_RESCUE.sigOf === 'function') { var s = window.OST_RESCUE.sigOf(tx); if (s) return s; }
      var raw = tx && tx.signature;
      if (raw && raw.length === 64 && window.OST_BASE58 && typeof window.OST_BASE58.encode === 'function') return window.OST_BASE58.encode(Uint8Array.from(raw));
    } catch (e) {}
    return '';
  }
  // A send that the RPC refused during preflight (simulation) never reached the
  // network: that, and only that, is a definite "not sent".
  function isPreflightRejection(error) {
    var m = String((error && error.message) || error || '');
    return !!(error && Array.isArray(error.logs)) || /simulation failed|preflight|insufficient funds|insufficient lamports|invalid transaction|signature verification|custom program error|InstructionError/i.test(m);
  }

  // Sign, SAVE, send, confirm (SOL-4): `onSent(signature, info)` runs as soon
  // as the transaction is signed — BEFORE it is broadcast — so a lost answer
  // can always be resolved by looking the signature up on chain. A failed or
  // lost send is checked by signature (with its blockhash window) before it is
  // ever called "not sent". An unknown outcome returns { pending:true }.
  async function signAndSendOnConnection(conn, transaction, onSent) {
    var session = getWalletSession();
    if (!conn) throw moneyErr('network_error', 'Solana RPC unavailable', { stage: 'build' });
    if (!session || !session.publicKey) throw moneyErr('no_wallet', 'Connect a wallet first', { stage: 'build' });

    var latest = await conn.getLatestBlockhash('confirmed');
    transaction.recentBlockhash = latest.blockhash;
    if (!transaction.feePayer) transaction.feePayer = session.publicKey;
    var info = { lastValidBlockHeight: latest.lastValidBlockHeight, signedAt: Date.now() };
    var saved = '';
    function save(sig) {
      if (!sig || saved === sig) return;
      saved = String(sig);
      if (typeof onSent === 'function') { try { onSent(saved, info); } catch (e) {} }
    }

    var signature = null, signedTx = null;
    try {
      if (session.kind === 'local' && session.keypair) {
        transaction.partialSign(session.keypair);
        signedTx = transaction;
      } else if (session.provider && typeof session.provider.signTransaction === 'function') {
        signedTx = await session.provider.signTransaction(transaction);
      } else if (session.provider && typeof session.provider.signAndSendTransaction === 'function') {
        var result = await session.provider.signAndSendTransaction(transaction);
        signature = typeof result === 'string' ? result : result && result.signature;
      }
    } catch (error) {
      var se = transactionError(error);
      se.stage = 'build';                         // nothing was sent: the wallet did not sign
      throw se;
    }
    if (signedTx) {
      var pre = signatureOfSigned(signedTx);
      save(pre);
      try {
        signature = await sendRawWithRetry(conn, signedTx.serialize());
      } catch (error) {
        if (!pre || isPreflightRejection(error)) {
          // Definitely refused before broadcast: nothing moved.
          var pe = transactionError(error);
          pe.stage = 'build'; pe.notSent = true; pe.sig = pre || undefined;
          throw pe;
        }
        // The answer was lost (timeout / dropped connection): a node may have
        // accepted it. Look it up by signature before saying anything.
        signature = pre;
      }
    }

    if (!signature) throw moneyErr('wallet_cannot_sign', 'Active wallet cannot sign transactions', { stage: 'build' });
    save(signature);
    var c = (window.OST_RESCUE && typeof window.OST_RESCUE.confirmBySig === 'function')
      ? await window.OST_RESCUE.confirmBySig(String(signature), { timeoutMs: 30000, lastValidBlockHeight: latest.lastValidBlockHeight })
      : await conn.confirmTransaction({ signature: signature, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight }, 'confirmed')
          .then(function (r) { return r && r.value && r.value.err ? { ok: false, err: r.value.err } : { ok: true, pending: false }; })
          .catch(function () { return { ok: true, pending: true }; });
    if (c && c.ok === false && !c.pending) {
      throw moneyErr(c.code || 'transaction_failed', c.expired ? 'The payment was never sent and its quote expired. Nothing moved.' : 'The payment did not go through.', { sig: String(signature), onchainErr: c.err || null, expired: !!c.expired, notSent: !!c.expired, stage: c.expired ? 'build' : 'submit' });
    }
    return { signature: String(signature), pending: !!(c && c.pending), lastValidBlockHeight: latest.lastValidBlockHeight };
  }

  // Pay a top-up intent in SOL. The OST pool pays the network fee when the
  // rescue rail is present (C8), so the wallet needs exactly the SOL shown —
  // under Solana's rent rule (RNT-1): whatever is left must be 0 or ≥ 0.00089.
  async function sendIntentWithSol(intent, config, onSent) {
    var wallet = window.OST_WALLET;
    var session = getWalletSession();
    if (!wallet || !session || !session.publicKey) throw moneyErr('no_wallet', 'Connect a wallet first');
    var currentConfig = config || await loadTopupConfig();
    var treasury = pickTopupReceiver(currentConfig, 'sol');
    if (!treasury) throw moneyErr('bad_response', 'Treasury SOL receiver is not configured');

    var settlement = quoteTopupSettlement(intent, 'SOL', currentConfig);
    var lamports = Math.ceil(settlement.amount * TOPUP_LAMPORTS_PER_SOL);
    // SOL-2: when this order came from a typed SOL amount, sign exactly that
    // amount (the USD intent is rounded to cents, which would shift the SOL).
    var pendingOrder = readPendingTopup();
    var typedSol = pendingOrder && pendingOrder.id === intent.id ? Number(pendingOrder.solAmount) : NaN;
    if (Number.isFinite(typedSol) && typedSol > 0) {
      var typedLamports = Math.round(typedSol * TOPUP_LAMPORTS_PER_SOL);
      // The worker accepts ≥ 98.5 % of the order's USD value, so signing the
      // typed amount within this window always verifies.
      if (typedLamports >= Math.floor(lamports * 0.995) && typedLamports <= Math.ceil(lamports * 1.01) + 10) {
        lamports = typedLamports;
        settlement = Object.assign({}, settlement, { amount: typedLamports / TOPUP_LAMPORTS_PER_SOL, amountDisplay: (typedLamports / TOPUP_LAMPORTS_PER_SOL).toFixed(6) });
      } else {
        // The order was priced with a different SOL price than the one shown:
        // never sign an amount the person did not type (SOL-2).
        throw moneyErr('amount_mismatch', 'This order would need ' + (lamports / TOPUP_LAMPORTS_PER_SOL).toFixed(6) + ' SOL, not the ' + typedSol + ' SOL you typed, so nothing was signed. Re-enter the amount and try again.', { typedSol: typedSol, orderSol: lamports / TOPUP_LAMPORTS_PER_SOL });
      }
    }
    var conn = getTopupConnection(currentConfig);
    var poolPaid = !!(window.OST_RESCUE && typeof window.OST_RESCUE.sendPoolFeeOnly === 'function' && resolveTopupCluster(currentConfig) === 'devnet');
    var balance = Number(await conn.getBalance(session.publicKey));
    var feeBuffer = poolPaid ? 0 : 5000;
    if (balance < lamports + feeBuffer) {
      throw moneyErr('insufficient_sol', 'Need ' + (lamports / TOPUP_LAMPORTS_PER_SOL).toFixed(6) + ' SOL on ' + topupNetworkLabel(currentConfig) + ' (you have ' + (balance / TOPUP_LAMPORTS_PER_SOL).toFixed(6) + ').', { needSol: lamports / 1e9, haveSol: balance / 1e9, getSol: true });
    }
    var rest = balance - lamports - feeBuffer;
    if (rest > 0 && rest < RENT_MIN_LAMPORTS) {
      throw moneyErr('keep_rent_reserve', 'Leave at least 0.00089 SOL in your wallet after paying.', { maxSol: Math.max(0, balance - feeBuffer - RENT_MIN_LAMPORTS) / 1e9 });
    }

    var memoIx = wallet.memoIx(intent.memo, session.publicKey);
    var payIx = solanaWeb3.SystemProgram.transfer({
      fromPubkey: session.publicKey,
      toPubkey: wallet.toPublicKey(treasury),
      lamports: lamports
    });
    if (poolPaid) {
      var r = await window.OST_RESCUE.sendPoolFeeOnly([memoIx, payIx], { onSigned: function (sig, built) { if (typeof onSent === 'function') onSent(sig, { lastValidBlockHeight: built && built.lastValidBlockHeight, signedAt: Date.now() }); } });
      try { window.dispatchEvent(new CustomEvent('ost:wallet-tx', { detail: { sig: String(r), asset: 'SOL', amount: settlement.amount, direction: 'out', to: treasury, status: r.pending ? 'pending' : 'confirmed', source: 'topup-sol' } })); } catch (e) {}
      return { asset: 'SOL', amount: settlement.amount, signature: String(r), pending: !!r.pending };
    }
    var tx = new solanaWeb3.Transaction();
    tx.add(memoIx);
    tx.add(payIx);
    var sent = await signAndSendOnConnection(conn, tx, onSent);
    try { window.dispatchEvent(new CustomEvent('ost:wallet-tx', { detail: { sig: sent.signature, asset: 'SOL', amount: settlement.amount, direction: 'out', to: treasury, status: sent.pending ? 'pending' : 'confirmed', source: 'topup-sol' } })); } catch (e) {}
    return { asset: 'SOL', amount: settlement.amount, signature: sent.signature, pending: sent.pending };
  }

  async function sendIntentWithUsdc(intent, config, onSent) {
    var wallet = window.OST_WALLET;
    var session = getWalletSession();
    if (!wallet || !session || !session.publicKey) throw new Error('Connect a wallet first');
    var currentConfig = config || await loadTopupConfig();
    var treasuryOwner = pickTopupReceiver(currentConfig, 'usdc') || pickTopupReceiver(currentConfig, 'sol');
    if (!treasuryOwner) throw new Error('Treasury USDC receiver is not configured');

    var conn = getTopupConnection(currentConfig);
    var mintPk = wallet.toPublicKey(resolveUsdcMint(currentConfig));
    var treasuryOwnerPk = wallet.toPublicKey(treasuryOwner);
    var sourceAta = wallet.associatedAddress(mintPk, session.publicKey, false, SPL_TOKEN_PROGRAM_ID, wallet.constants.ASSOCIATED_TOKEN_PROGRAM_ID);
    var destinationAta = wallet.associatedAddress(mintPk, treasuryOwnerPk, false, SPL_TOKEN_PROGRAM_ID, wallet.constants.ASSOCIATED_TOKEN_PROGRAM_ID);
    var settlement = quoteTopupSettlement(intent, 'USDC', currentConfig);

    var sourceBalance = await conn.getTokenAccountBalance(sourceAta).catch(function() { return null; });
    var available = sourceBalance && sourceBalance.value ? Number(sourceBalance.value.uiAmount || sourceBalance.value.uiAmountString || 0) : 0;
    if (available + 0.000001 < settlement.amount) {
      throw new Error('Need ' + settlement.amount.toFixed(2) + ' USDC on ' + topupNetworkLabel(currentConfig) + ' (have ' + available.toFixed(2) + ')');
    }

    var tx = new solanaWeb3.Transaction();
    var destinationInfo = await conn.getAccountInfo(destinationAta);
    if (!destinationInfo) {
      tx.add(wallet.associatedAccountIx(
        session.publicKey,
        destinationAta,
        treasuryOwnerPk,
        mintPk,
        SPL_TOKEN_PROGRAM_ID,
        wallet.constants.ASSOCIATED_TOKEN_PROGRAM_ID
      ));
    }
    tx.add(wallet.memoIx(intent.memo, session.publicKey));
    tx.add(wallet.transferChecked(
      sourceAta,
      mintPk,
      destinationAta,
      session.publicKey,
      wallet.toBaseUnits(settlement.amount, 6),
      6,
      SPL_TOKEN_PROGRAM_ID
    ));

    var sent = await signAndSendOnConnection(conn, tx, onSent);
    try { window.dispatchEvent(new CustomEvent('ost:wallet-tx', { detail: { sig: sent.signature, asset: 'USDC', amount: settlement.amount, direction: 'out', to: treasuryOwner, status: sent.pending ? 'pending' : 'confirmed', source: 'topup-usdc' } })); } catch (e) {}
    return { asset: 'USDC', amount: settlement.amount, signature: sent.signature, pending: sent.pending };
  }

  async function recordTopupDeliverySnapshot(intent, signature) {
    var wallet = window.OST_WALLET;
    var session = getWalletSession();
    if (!wallet || !session || !session.publicKey) return;
    try {
      var shared = sharedBalances();
      var ostBalance = shared.ost;
      var solBalance = shared.sol;
      recordSnapshot({
        ts: Date.now(),
        ostBalance: ostBalance,
        solBalance: solBalance,
        kind: 'topup-in',
        amount: Number(intent && intent.ostAmount || 0),
        sig: signature,
        topupId: intent && intent.id,
        paymentRef: intent && intent.paymentRef || null,
        rail: intent && intent.method || 'crypto'
      });
      refreshChartIfReady();
      if (typeof notifyTxHistory === 'function') notifyTxHistory();
    } catch (e) {}
  }

  async function deliverPaidIntent(intentLike) {
    var wallet = window.OST_WALLET;
    var session = getWalletSession();
    var intent = intentLike && intentLike.intent ? intentLike.intent : intentLike;
    if (!wallet || !session || !session.publicKey) throw new Error('Connect a wallet first');
    if (!intent || !intent.id) throw new Error('Missing top-up intent');
    var activeWallet = session.publicKey.toBase58();
    if (intent.wallet && intent.wallet !== activeWallet) {
      throw new Error('Connected wallet does not match this top-up intent');
    }
    if (intent.status === 'sent') {
      rememberClaimedTopup(intent.id, {
        signature: intent.signature || null,
        claimedAt: intent.sentAt || Date.now(),
        claimPending: false,
        paymentRef: intent.paymentRef || null
      });
      clearPendingTopup(intent.id);
      return { intent: intent, payout: null, delivered: false };
    }
    var claimed = readClaimedTopups();
    var localClaim = claimed[intent.id];
    if (localClaim && localClaim.signature && localClaim.claimPending) {
      try {
        var reconciled = await claimTopupIntent(intent.id, localClaim.signature);
        var reconciledIntent = reconciled && reconciled.intent ? reconciled.intent : Object.assign({}, intent, { status: 'sent', signature: localClaim.signature });
        await recordTopupDeliverySnapshot(reconciledIntent, localClaim.signature);
        rememberClaimedTopup(intent.id, {
          signature: localClaim.signature,
          claimedAt: Date.now(),
          ostAmount: Number(intent.ostAmount || 0),
          claimPending: false,
          paymentRef: reconciledIntent.paymentRef || intent.paymentRef || null,
          snapshotRecorded: true
        });
        clearPendingTopup(intent.id);
        return {
          intent: reconciledIntent,
          payout: { sig: localClaim.signature },
          delivered: false
        };
      } catch (error) {
        rememberPendingClaim(intent, localClaim.signature);
        throw new Error('OST was already delivered, but final claim sync is still pending. Refresh to retry without paying again.');
      }
    }
    if (localClaim && localClaim.signature) {
      clearPendingTopup(intent.id);
      return {
        intent: Object.assign({}, intent, { status: 'sent', signature: localClaim.signature }),
        payout: { sig: localClaim.signature },
        delivered: false
      };
    }
    if (intent.status !== 'paid') throw new Error('Top-up is still waiting for payment');

    var payoutMemo = JSON.stringify({
      k: 'ost-topup',
      intent: intent.id,
      usd: Number(intent.usd || 0),
      ost: Number(intent.ostAmount || 0),
      wallet: activeWallet,
      t: Date.now()
    });
    var payout = await serverDeliverTopup(intent);   // the SERVER pays from the pool (idempotent) — the client never asserts a purchase payout
    var signature = payout && payout.sig ? String(payout.sig) : '';
    var claimedPayload;
    try {
      claimedPayload = await claimTopupIntent(intent.id, signature);
    } catch (error) {
      rememberClaimedTopup(intent.id, {
        signature: signature,
        claimedAt: Date.now(),
        ostAmount: Number(intent.ostAmount || 0),
        claimPending: true,
        paymentRef: intent.paymentRef || null,
        snapshotRecorded: false
      });
      rememberPendingClaim(intent, signature);
      throw new Error('OST was delivered, but final claim sync is still pending. Refresh to retry without paying again.');
    }

    var finalIntent = claimedPayload && claimedPayload.intent ? claimedPayload.intent : Object.assign({}, intent, { status: 'sent', signature: signature });
    await recordTopupDeliverySnapshot(finalIntent, signature);
    rememberClaimedTopup(intent.id, {
      signature: signature,
      claimedAt: Date.now(),
      ostAmount: Number(intent.ostAmount || 0),
      claimPending: false,
      paymentRef: finalIntent.paymentRef || intent.paymentRef || null,
      snapshotRecorded: true
    });
    clearPendingTopup(intent.id);

    return {
      intent: finalIntent,
      payout: payout,
      delivered: true
    };
  }

  async function deliverLocallyVerifiedPayment(intent, payment) {
    var wallet = window.OST_WALLET;
    var session = getWalletSession();
    if (!wallet || !session || !session.publicKey) throw new Error('Connect a wallet first');
    if (!intent || !intent.id) throw new Error('Missing top-up intent');
    var activeWallet = session.publicKey.toBase58();
    if (intent.wallet && intent.wallet !== activeWallet) {
      throw new Error('Connected wallet does not match this top-up intent');
    }
    var claimed = readClaimedTopups();
    var localClaim = claimed[intent.id];
    if (localClaim && localClaim.signature) {
      clearPendingTopup(intent.id);
      return {
        intent: Object.assign({}, intent, { status: 'sent', signature: localClaim.signature, paymentRef: localClaim.paymentRef || payment.signature }),
        payment: payment,
        payout: { sig: localClaim.signature },
        delivered: false,
        localVerified: true
      };
    }

    var payoutMemo = JSON.stringify({
      k: 'ost-topup-local-verified',
      intent: intent.id,
      payment: payment.signature,
      usd: Number(intent.usd || 0),
      ost: Number(intent.ostAmount || 0),
      wallet: activeWallet,
      t: Date.now()
    });
    var payout = await serverDeliverTopup(intent);   // the SERVER pays from the pool (idempotent) — the client never asserts a purchase payout
    var payoutSig = payout && payout.sig ? String(payout.sig) : '';
    var finalIntent = Object.assign({}, intent, {
      status: 'sent',
      signature: payoutSig,
      paymentRef: payment.signature,
      sentAt: Date.now(),
      deliveryKind: 'client-local-verified'
    });
    try {
      var claimedPayload = await claimTopupIntent(intent.id, payoutSig);
      if (claimedPayload && claimedPayload.intent) finalIntent = claimedPayload.intent;
    } catch (e) {}
    await recordTopupDeliverySnapshot(finalIntent, payoutSig);
    rememberClaimedTopup(intent.id, {
      signature: payoutSig,
      claimedAt: Date.now(),
      ostAmount: Number(intent.ostAmount || 0),
      claimPending: false,
      paymentRef: payment.signature,
      localVerified: true,
      snapshotRecorded: true
    });
    clearPendingTopup(intent.id);
    return { intent: finalIntent, payment: payment, payout: payout, delivered: true, localVerified: true };
  }

  async function deliverIfPaid(intentId) {
    var intent = await getTopupStatus(intentId);
    if (intent.status === 'paid') return deliverPaidIntent(intent);
    if (intent.status === 'pending') {
      var pending = readPendingTopup();
      var pendingSig = '';
      if (pending && pending.id === intentId) {
        pendingSig = String(pending.paymentRef || pending.deliverySignature || '').trim();
      }
      if (pendingSig) {
        var verified = await verifyTopupSignature(intentId, pendingSig).catch(function() { return null; });
        if (verified && !verified.pendingVerification) {
          var verifiedIntent = verified.intent || verified;
          if (verifiedIntent && (verifiedIntent.status === 'paid' || verifiedIntent.status === 'sent')) {
            return deliverPaidIntent(verifiedIntent);
          }
        }
        var config = await loadTopupConfig({ force: true });
        var payment = {
          asset: (pending && pending.paymentAsset) || (pending && pending.settlementAsset) || 'SOL',
          amount: Number((pending && pending.paymentAmount) || 0),
          signature: pendingSig
        };
        var localVerification = await verifySubmittedTopupPayment(intent, payment, config).catch(function() { return null; });
        if (localVerification && localVerification.ok) {
          return deliverLocallyVerifiedPayment(intent, payment);
        }
      }
    }
    if (intent.status === 'sent') {
      rememberClaimedTopup(intent.id, { signature: intent.signature || null, claimedAt: intent.sentAt || Date.now() });
      clearPendingTopup(intent.id);
    }
    return { intent: intent, payout: null, delivered: false };
  }

  async function settleTopupIntent(intentId, asset, settleOpts) {
    settleOpts = settleOpts || {};
    var intent = await getTopupStatus(intentId);
    if (intent.status === 'sent') { clearPendingTopup(intent.id); return { intent: intent, payment: null, payout: null, delivered: false }; }
    if (intent.status === 'paid') return deliverPaidIntent(intent);

    var config = await loadTopupConfig({ force: true });
    var isUsdc = String(asset || 'SOL').toUpperCase() === 'USDC';
    // A payment for this order was already sent: never pay twice — verify it.
    var prior = readPendingTopup();
    if (prior && prior.id === intent.id && prior.paymentRef) {
      // An earlier payment that FAILED on chain, or provably never landed (its
      // blockhash window passed), frees the order for a deliberate retry.
      var look = await lookUpSavedPayment(prior, 4000);
      if (look && look.ok === false && !look.pending) {
        releaseSavedPayment(prior);
        prior = readPendingTopup();
        if (settleOpts.verifyOnly) {
          return { intent: intent, payment: null, payout: null, delivered: false, released: true, expired: !!look.expired,
            verifyNote: look.expired ? 'That payment was never sent — nothing moved. You can pay again.' : 'That payment failed on chain — nothing moved. You can pay again.' };
        }
      }
    }
    if (prior && prior.id === intent.id && prior.paymentRef) {
      var again = await verifyTopupSignature(intent.id, prior.paymentRef).catch(function () { return null; });
      var againIntent = again && (again.intent || again);
      if (againIntent && (againIntent.status === 'paid' || againIntent.status === 'sent')) return deliverPaidIntent(againIntent);
      try {
        var chk0 = await topupRequest('/topup/crypto/check/' + encodeURIComponent(intent.id));
        var chk0Intent = chk0 && (chk0.intent || chk0);
        if (chk0Intent && (chk0Intent.status === 'paid' || chk0Intent.status === 'sent')) return deliverPaidIntent(chk0Intent);
      } catch (e) {}
      return { intent: intent, payment: { asset: prior.paymentAsset || 'SOL', amount: prior.paymentAmount, signature: prior.paymentRef, pending: true }, payout: null, delivered: false, pendingVerification: true };
    }
    // "Refresh status" never pays: it only verifies what was already sent.
    if (settleOpts.verifyOnly) return { intent: intent, payment: null, payout: null, delivered: false, noPayment: true };
    var onSent = function (sig, info) {
      // SOL-4: the signature is saved the moment it exists, before it is sent.
      var q = null; try { q = quoteTopupSettlement(intent, isUsdc ? 'USDC' : 'SOL', config); } catch (e) {}
      rememberPendingPayment(intent, sig, { asset: isUsdc ? 'USDC' : 'SOL', amount: q ? q.amount : 0 }, info);
    };
    var payment;
    try {
      payment = isUsdc
        ? await sendIntentWithUsdc(intent, config, onSent)
        : await sendIntentWithSol(intent, config, onSent);
    } catch (payErr) {
      // A definitive failure (refused, or failed on chain) frees the order for
      // a deliberate retry; an unknown outcome keeps the saved signature.
      var hs = humanOf(payErr, { stage: 'submit' });
      var cur = readPendingTopup();
      var savedRef = cur && cur.id === intent.id && cur.paymentRef ? String(cur.paymentRef) : '';
      if (hs.state !== 'pending') {
        if (savedRef) releaseSavedPayment(cur);
        throw payErr;
      }
      // Outcome unknown after the payment was signed and saved: this is
      // "Payment sent — verifying", never a failure and never an invitation to
      // pay again (C4 / SOL-4). The order stays locked to that signature.
      if (savedRef) {
        return { intent: intent, payment: { asset: cur.paymentAsset || (isUsdc ? 'USDC' : 'SOL'), amount: Number(cur.paymentAmount || 0), signature: savedRef, pending: true }, payout: null, delivered: false, pendingVerification: true, verifyNote: hs.title + (hs.body ? ' — ' + hs.body : '') };
      }
      throw payErr;
    }
    if (payment && payment.signature) {
      rememberPendingPayment(intent, payment.signature, payment);
    }
    var verified = null;
    var verifyError = null;
    try {
      verified = await verifyTopupSignature(intent.id, payment.signature);
    } catch (error) {
      verifyError = error;
    }
    if (verifyError || (verified && verified.pendingVerification)) {
      var localVerification = await verifySubmittedTopupPayment(intent, payment, config).catch(function() { return null; });
      if (localVerification && localVerification.ok) {
        return deliverLocallyVerifiedPayment(intent, payment);
      }
      // SOL-4: the payment was SENT (its signature is saved). A lost or failed
      // verify never reads as a failed payment: ask the server's auto-detect
      // once, else report "Payment sent — verifying" and keep the order locked.
      try {
        var chk = await topupRequest('/topup/crypto/check/' + encodeURIComponent(intent.id));
        var chkIntent = chk && (chk.intent || chk);
        if (chkIntent && (chkIntent.status === 'paid' || chkIntent.status === 'sent')) return deliverPaidIntent(chkIntent);
      } catch (e) {}
      return {
        intent: (verified && verified.intent) || intent,
        payment: payment,
        payout: null,
        delivered: false,
        pendingVerification: true,
        verifyNote: verifyError ? humanText(verifyError, { stage: 'submit' }) : ''
      };
    }
    var delivered = await deliverPaidIntent(verified.intent || verified);
    return {
      intent: delivered.intent,
      payment: payment,
      payout: delivered.payout,
      delivered: delivered.delivered
    };
  }

  window.OST_TOPUP = Object.assign(window.OST_TOPUP || {}, {
    loadConfig: loadTopupConfig,
    quoteSettlement: quoteTopupSettlement,
    createIntent: createTopupIntent,
    createCheckout: createTopupCheckout,
    getStatus: getTopupStatus,
    settleIntent: settleTopupIntent,
    deliverIfPaid: deliverIfPaid,
    rememberPending: rememberPendingFromCaller,
    getPending: readPendingTopup,
    clearPending: clearPendingTopup,
    // Is a SENT payment still waiting for verification? (locks new orders)
    hasUnverifiedPayment: function () { return hasUnverifiedPayment(readPendingTopup()); },
    // "Refresh status": verify/deliver the saved order, never pay again.
    refreshPending: refreshPendingTopup
  });
  try { window.dispatchEvent(new CustomEvent('ost:topup-ready')); } catch (e) {}

  // ------------------------------------------------------------------
  // 0b) OST-native prediction markets (BTC up/down, World Cup, oil, US presidency, world events)
  // Surfaced on top of Polymarket + Kalshi via window.buildOstNativeMarkets()
  // BTC market uses live SOL/BTC price ticks; the rest are curated event lines.
  // ------------------------------------------------------------------
  function pct(n) { return Math.round(n * 100) + '%'; }
  function fmtMoney(n) {
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(n);
  }
  function relTime(ms) {
    if (!Number.isFinite(Number(ms))) return 'Open';   // no close time -> honest label, not "in NaNmo"
    var d = Number(ms) - Date.now();
    var hrs = Math.round(d / 3600000);
    if (hrs < 24) return 'in ' + hrs + 'h';
    var days = Math.round(hrs / 24);
    if (days < 30) return 'in ' + days + 'd';
    return 'in ' + Math.round(days / 30) + 'mo';
  }

  function makeNativeMarket(spec) {
    var yes = Math.max(0.02, Math.min(0.98, spec.yesPrice));
    var no = 1 - yes;
    var vol = spec.volume || 250000;
    // Map our friendly topic names onto the canonical filter pills already in the page
    var topicAliases = {
      'Crypto': ['crypto'],
      'World Cup': ['sports'],
      'Oil': ['economy', 'finance'],
      'US Election': ['politics', 'elections'],
      'World Events': ['tech']
    };
    var aliasTags = topicAliases[spec.topic] || [String(spec.topic || 'OST').toLowerCase()];
    var topicNames = Array.isArray(spec.topicTags) ? spec.topicTags : aliasTags;
    var topicSet = new Set(topicNames);
    return {
      source: 'ost',
      sourceLabel: 'OST Paper',
      id: 'ost-' + spec.id,
      title: spec.title,
      detail: spec.detail,
      yesLabel: 'Yes', yesValue: pct(yes), yesPriceNumber: yes,
      noLabel: 'No', noValue: pct(no), noPriceNumber: no,
      volumeLabel: 'Volume', volumeValue: fmtMoney(vol), volumeNumber: vol,
      secondaryMetricLabel: 'Open interest',
      secondaryMetricValue: fmtMoney(vol * 0.6),
      secondaryMetricNumber: vol * 0.6,
      closeText: relTime(spec.closeAtMs),
      closeLabel: 'Closes',
      topic: spec.topic || 'OST',
      topics: topicSet,
      displayTopics: [spec.topic || 'OST'],
      searchText: (spec.title + ' ' + spec.detail + ' ' + (spec.topic || '') + ' ' + topicNames.join(' ')).toLowerCase(),
      primaryUrl: '#wallet-portal',
      secondaryUrl: '#wallet-portal',
      secondaryLabel: 'Trade with OST',
      primaryLabel: 'Open OST market',
      contractLabel: 'OST native binary',
      sortValue: vol,
      createdAtMs: spec.createdAtMs || Date.now() - 86400000,
      closeAtMs: spec.closeAtMs,
      // Paper markets with curated (not live) odds. isOstNative:false keeps
      // them OUT of the pinned rail — they only surface as placeholders when
      // every real venue feed is down. Real natives (btc5m/eth5m/sol5m/EPL)
      // keep the pin.
      isOstNative: false,
      isBreaking: !!spec.isBreaking,
    };
  }

  var existingNativeMarketBuilder = typeof window.buildOstNativeMarkets === 'function'
    ? window.buildOstNativeMarkets
    : null;

  function pushUniqueNativeMarket(target, seen, market) {
    if (!market || !market.id || seen[market.id]) return;
    seen[market.id] = true;
    target.push(market);
  }

  function buildWalletNativeMarkets() {
    var now = Date.now();
    var DAY = 86400000;
    var prices = window.__ostPrices || {};
    var btc = Number(prices.bitcoin) || 92000;
    var eth = Number(prices.ethereum) || 4200;
    var sol = Number(prices.solana) || 86;

    // Use a small deterministic-ish jitter so the live YES price feels alive
    function jitter(base, range) {
      var t = Math.floor(now / 60000); // changes every minute
      return base + Math.sin(t * 0.31) * range;
    }

    return [
      // Crypto (live-priced)
      makeNativeMarket({
        id: 'btc-up-today', topic: 'Crypto',
        title: 'Will BTC close higher today?',
        detail: 'Resolves YES if Bitcoin closes above its current spot of $' + btc.toFixed(0) + ' at 23:59 UTC.',
        yesPrice: jitter(0.54, 0.04),
        volume: 1_840_000,
        closeAtMs: now + (24 - new Date().getUTCHours()) * 3600000,
      }),
      makeNativeMarket({
        id: 'btc-100k-2026', topic: 'Crypto',
        title: 'BTC above $100,000 by Dec 31, 2026?',
        detail: 'Spot price currently $' + btc.toFixed(0) + '. Resolves on official CoinGecko close.',
        yesPrice: jitter(0.61, 0.03), volume: 4_200_000,
        closeAtMs: new Date('2026-12-31T23:59:00Z').getTime(),
      }),
      makeNativeMarket({
        id: 'eth-flippening', topic: 'Crypto',
        title: 'ETH market cap flips BTC in 2026?',
        detail: 'ETH spot $' + eth.toFixed(0) + '. Long-shot binary settled on year-end CoinGecko data.',
        yesPrice: 0.06, volume: 720_000,
        closeAtMs: new Date('2026-12-31T23:59:00Z').getTime(),
      }),
      makeNativeMarket({
        id: 'sol-150', topic: 'Crypto',
        title: 'SOL above $150 before July 1, 2026?',
        detail: 'SOL spot $' + sol.toFixed(2) + '. OST swap pool settles directly into your wallet.',
        yesPrice: jitter(0.42, 0.05), volume: 980_000,
        closeAtMs: new Date('2026-07-01T00:00:00Z').getTime(),
      }),

      // World Cup 2026 (USA / Canada / Mexico — June 11–July 19, 2026)
      makeNativeMarket({
        id: 'wc26-winner-brazil', topic: 'World Cup',
        title: 'Brazil to win FIFA World Cup 2026?',
        detail: 'Final on July 19, 2026 at MetLife Stadium. Resolves on the official FIFA result.',
        yesPrice: 0.18, volume: 3_400_000,
        closeAtMs: new Date('2026-07-19T22:00:00Z').getTime(),
      }),
      makeNativeMarket({
        id: 'wc26-winner-argentina', topic: 'World Cup',
        title: 'Argentina to defend the World Cup 2026?',
        detail: 'Reigning champion. Resolves on the official FIFA final result.',
        yesPrice: 0.15, volume: 2_900_000,
        closeAtMs: new Date('2026-07-19T22:00:00Z').getTime(),
      }),
      makeNativeMarket({
        id: 'wc26-winner-france', topic: 'World Cup',
        title: 'France to win World Cup 2026?',
        detail: 'Strong squad. Settled on FIFA-confirmed final.',
        yesPrice: 0.12, volume: 1_800_000,
        closeAtMs: new Date('2026-07-19T22:00:00Z').getTime(),
      }),
      makeNativeMarket({
        id: 'wc26-host-quarter', topic: 'World Cup',
        title: 'USA reaches the World Cup 2026 quarter-finals?',
        detail: 'Co-host advantage. Resolves YES if USMNT plays a QF match.',
        yesPrice: 0.34, volume: 1_100_000,
        closeAtMs: new Date('2026-07-11T20:00:00Z').getTime(),
      }),

      // Energy / commodities
      makeNativeMarket({
        id: 'oil-90', topic: 'Oil',
        title: 'WTI crude above $90 a barrel by year-end 2026?',
        detail: 'Settled on EIA spot price for West Texas Intermediate on Dec 31, 2026.',
        yesPrice: 0.38, volume: 1_650_000,
        closeAtMs: new Date('2026-12-31T23:59:00Z').getTime(),
      }),
      makeNativeMarket({
        id: 'opec-cut', topic: 'Oil',
        title: 'OPEC+ announces a production cut at June 2026 meeting?',
        detail: 'Resolves YES if any headline cut > 200kbpd is announced at the next OPEC+ ministerial.',
        yesPrice: 0.46, volume: 540_000,
        closeAtMs: new Date('2026-06-30T23:59:00Z').getTime(),
      }),
      makeNativeMarket({
        id: 'gas-3', topic: 'Oil',
        title: 'US average gas under $3.00/gal on July 4, 2026?',
        detail: 'Settled on AAA national average on July 4. Currently around $3.21.',
        yesPrice: 0.41, volume: 380_000,
        closeAtMs: new Date('2026-07-04T23:59:00Z').getTime(),
      }),

      // US politics / 2028 presidency
      makeNativeMarket({
        id: 'us28-dem', topic: 'US Election',
        title: 'Democratic candidate wins the 2028 US presidency?',
        detail: 'Settled on certified Electoral College result. Lines refresh as primaries unfold.',
        yesPrice: jitter(0.48, 0.03), volume: 6_200_000,
        closeAtMs: new Date('2028-11-07T23:59:00Z').getTime(),
      }),
      makeNativeMarket({
        id: 'us28-gop', topic: 'US Election',
        title: 'Republican candidate wins the 2028 US presidency?',
        detail: 'Settled on certified Electoral College result. Counterpart of the Dem line.',
        yesPrice: jitter(0.47, 0.03), volume: 5_900_000,
        closeAtMs: new Date('2028-11-07T23:59:00Z').getTime(),
      }),
      makeNativeMarket({
        id: 'us28-vance', topic: 'US Election',
        title: 'JD Vance wins the 2028 GOP presidential nomination?',
        detail: 'Resolves on official RNC nomination roll-call.',
        yesPrice: 0.31, volume: 1_700_000,
        closeAtMs: new Date('2028-08-31T23:59:00Z').getTime(),
      }),
      makeNativeMarket({
        id: 'us28-newsom', topic: 'US Election',
        title: 'Gavin Newsom wins the 2028 Democratic presidential nomination?',
        detail: 'Resolves on official DNC nomination roll-call.',
        yesPrice: 0.27, volume: 1_500_000,
        closeAtMs: new Date('2028-08-31T23:59:00Z').getTime(),
      }),
      makeNativeMarket({
        id: 'us-midterm-house', topic: 'US Election',
        title: 'Democrats flip the US House in 2026 midterms?',
        detail: 'Settled on AP race calls for the 435 House seats on Nov 3, 2026.',
        yesPrice: 0.52, volume: 2_200_000,
        closeAtMs: new Date('2026-11-04T05:00:00Z').getTime(),
      }),

      // Other world events
      makeNativeMarket({
        id: 'ai-gpt6', topic: 'World Events',
        title: 'OpenAI ships a public "GPT-6" model in 2026?',
        detail: 'Resolves YES on a generally-available GPT-6-branded launch announced by OpenAI in 2026.',
        yesPrice: 0.34, volume: 920_000,
        closeAtMs: new Date('2026-12-31T23:59:00Z').getTime(),
      }),
      makeNativeMarket({
        id: 'space-starship-orbit', topic: 'World Events',
        title: 'SpaceX Starship reaches orbit with payload deploy in 2026?',
        detail: 'Resolves on FAA + SpaceX confirmation of orbital insertion + payload separation.',
        yesPrice: 0.66, volume: 480_000,
        closeAtMs: new Date('2026-12-31T23:59:00Z').getTime(),
      }),
      makeNativeMarket({
        id: 'climate-1-5', topic: 'World Events',
        title: '2026 ranks as one of the 3 hottest years on record?',
        detail: 'Settled on NOAA + Copernicus annual global temperature ranking.',
        yesPrice: 0.74, volume: 380_000,
        closeAtMs: new Date('2027-01-15T00:00:00Z').getTime(),
      }),
    ];
  }

  window.buildOstNativeMarkets = function () {
    var out = [];
    var seen = Object.create(null);
    if (existingNativeMarketBuilder) {
      try {
        var seeded = existingNativeMarketBuilder();
        if (Array.isArray(seeded)) seeded.forEach(function (market) { pushUniqueNativeMarket(out, seen, market); });
      } catch (error) {
        console.warn('[OST wallet native markets]', error);
      }
    }
    buildWalletNativeMarkets().forEach(function (market) { pushUniqueNativeMarket(out, seen, market); });
    return out;
  };

  // ------------------------------------------------------------------
  // 1) Auto-select SOL when arriving at convert via "Buy OST" button
  // ------------------------------------------------------------------
  function wireBuyOstAutoSelect() {
    document.querySelectorAll('[data-buy-ost="sol"]').forEach(function (link) {
      link.addEventListener('click', function () {
        setTimeout(function () {
          var sel = $('transferFrom');
          if (sel) {
            sel.value = 'SOL';
            sel.dispatchEvent(new Event('change', { bubbles: true }));
            sel.classList.add('ost-pulse');
            setTimeout(function () { sel.classList.remove('ost-pulse'); }, 1800);
          }
          var amt = $('transferAmount');
          if (amt && !amt.value) { amt.value = '0.1'; amt.dispatchEvent(new Event('input', { bubbles: true })); }
          var panel = document.querySelector('#wallet-panel-convert');
          if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 50);
      });
    });
  }

  // ------------------------------------------------------------------
  // 2) Send sheet — OST / OSTG / SOL (TRF-1, TRF-2, TRF-3, RNT-1)
  //    OST and OSTG go through the pool-paid peer-transfer rail: OST pays the
  //    network fee AND creates the recipient's token account, so a brand-new
  //    wallet with 0 SOL can send. SOL is a native transfer (pool pays the fee
  //    when the rail is up) under Solana's rent rule.
  // ------------------------------------------------------------------
  var OSTG_MINT = 'DfgxMbdN49AX2Za9LuvsyixF1jgVh45RbgWYSGonxQos';
  var TOKEN_PROGRAMS = ['TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'];
  var SEND_ASSETS = ['OST', 'OSTG', 'SOL'];
  var sendState = { asset: 'OST', busy: false, balanceBase: null, balanceAsset: '' };

  function shortAddr(a) { a = String(a || ''); return a.length > 12 ? a.slice(0, 4) + '…' + a.slice(-4) : a; }
  function ostMint() { return (window.OST_CONFIG && window.OST_CONFIG.mint) || (window.OST_SWAP_POOL && window.OST_SWAP_POOL.mint) || ''; }
  function knownMints() { return [ostMint(), OSTG_MINT, USDC_DEVNET_MINT, USDC_MAINNET_MINT, 'So11111111111111111111111111111111111111112'].filter(Boolean); }
  function humanText(err, opts) {
    try { if (window.OST_MONEY_ERRORS) return window.OST_MONEY_ERRORS.text(err, opts); } catch (e) {}
    return 'That didn’t go through — try again in a moment.';
  }
  function humanOf(err, opts) {
    try { if (window.OST_MONEY_ERRORS) return window.OST_MONEY_ERRORS.humanize(err, opts); } catch (e) {}
    return { state: 'failed', title: 'That didn’t go through', body: 'Try again in a moment.' };
  }
  function baseToText(base, decimals) {
    var s = BigInt(base).toString();
    while (s.length <= decimals) s = '0' + s;
    var whole = s.slice(0, s.length - decimals), frac = s.slice(s.length - decimals).replace(/0+$/, '');
    return frac ? whole + '.' + frac : whole;
  }
  function textToBase(text, decimals) {
    var s = String(text || '').trim().replace(',', '.');
    if (!/^\d*\.?\d*$/.test(s) || s === '' || s === '.') return null;
    var parts = s.split('.');
    var frac = (parts[1] || '');
    if (frac.length > decimals) return null;            // more precision than the token has
    while (frac.length < decimals) frac += '0';
    return BigInt(parts[0] || '0') * (10n ** BigInt(decimals)) + BigInt(frac || '0');
  }
  function decimalsOf(asset) { return 9; }   // OST, OSTG and SOL all use 9

  // Exact on-chain balance in base units (bigint) — null when unknown.
  async function readBaseBalance(asset) {
    var w = window.OST_WALLET;
    if (!w || !w.session || !w.session.publicKey) return null;
    var owner = w.session.publicKey;
    try {
      if (asset === 'SOL') return BigInt(await w.rpcCall(function (c) { return c.getBalance(owner); }));
      var mint = new solanaWeb3.PublicKey(asset === 'OSTG' ? OSTG_MINT : ostMint());
      var ata = w.associatedAddress(mint, owner, false, w.constants.TOKEN_2022_PROGRAM_ID, w.constants.ASSOCIATED_TOKEN_PROGRAM_ID);
      var r = await w.rpcCall(function (c) { return c.getTokenAccountBalance(ata); });
      return r && r.value && r.value.amount != null ? BigInt(r.value.amount) : null;
    } catch (e) {
      if (/could not find account|invalid param/i.test(String(e && e.message || e))) return 0n;
      // Fall back to the shared balance (rounded down so Max never exceeds it).
      try {
        var B = window.OST_BALANCE && OST_BALANCE.get ? OST_BALANCE.get() : {};
        var v = asset === 'SOL' ? B.sol : asset === 'OSTG' ? B.ostg : B.ost;
        if (v != null && Number.isFinite(Number(v))) return BigInt(Math.floor(Number(v) * 1e9));
      } catch (_) {}
      return null;
    }
  }

  // Parse a pasted / scanned value: a bare address or a solana: URI.
  function parseRecipientInput(raw) {
    var s = String(raw || '').trim();
    var out = { to: '', amount: null, memo: '' };
    var m = s.match(/^solana:([1-9A-HJ-NP-Za-km-z]{32,44})(\?.*)?$/i);
    if (m) {
      out.to = m[1];
      try {
        var q = new URLSearchParams((m[2] || '').replace(/^\?/, ''));
        if (q.get('amount')) out.amount = q.get('amount');
        if (q.get('memo')) out.memo = q.get('memo').slice(0, 80);
        if (q.get('message') && !out.memo) out.memo = q.get('message').slice(0, 80);
      } catch (e) {}
      return out;
    }
    var bare = s.match(/[1-9A-HJ-NP-Za-km-z]{32,44}/);
    out.to = bare ? bare[0] : s;
    return out;
  }

  // TRF-3 guards: refuse self, mints, token accounts, programs and off-curve
  // (program-derived) addresses. Returns { pubkey, lamports } for the rent check.
  async function checkRecipient(toText, asset) {
    var w = window.OST_WALLET;
    var pk;
    try { pk = new solanaWeb3.PublicKey(String(toText || '').trim()); }
    catch (e) { throw moneyErr('invalid_recipient', 'That isn’t a valid Solana wallet address.'); }
    var me = w && w.session && w.session.publicKey ? w.session.publicKey.toBase58() : '';
    var to = pk.toBase58();
    if (me && to === me) throw moneyErr('self_send', 'That’s your own wallet.');
    if (knownMints().indexOf(to) !== -1) throw moneyErr('mint_address', 'That is a token mint address, not a wallet.');
    if (window.OST_SWAP_POOL && (to === window.OST_SWAP_POOL.ata)) throw moneyErr('token_account_address', 'That is a token account, not a wallet.');
    try { if (!solanaWeb3.PublicKey.isOnCurve(pk.toBytes())) throw moneyErr('invalid_recipient', 'That address is a program account and can’t receive here.'); }
    catch (e) { if (e && e.code) throw e; }
    var info = null, known = false;
    try { info = await w.rpcCall(function (c) { return c.getAccountInfo(pk); }); known = true; } catch (e) { known = false; }
    if (info) {
      var owner = info.owner && info.owner.toBase58 ? info.owner.toBase58() : String(info.owner || '');
      if (TOKEN_PROGRAMS.indexOf(owner) !== -1) throw moneyErr('token_account_address', 'That is a token account or mint, not a wallet.');
      if (info.executable) throw moneyErr('invalid_recipient', 'That address is a program and can’t receive here.');
    }
    return { pubkey: pk, lamports: info ? Number(info.lamports || 0) : (known ? 0 : null) };
  }

  // One send for every surface (Send sheet, Mesh pay, tips). Resolves to
  // { ok, sig, pending } (C4) and dispatches ost:wallet-tx (C5).
  async function sendAsset(opts) {
    var w = window.OST_WALLET;
    var asset = SEND_ASSETS.indexOf(String(opts.asset || 'OST').toUpperCase()) !== -1 ? String(opts.asset || 'OST').toUpperCase() : 'OST';
    if (!w || !w.session || !w.session.publicKey) throw moneyErr('no_wallet', 'Connect a wallet first.');
    var base = textToBase(opts.amount, decimalsOf(asset));
    if (base == null || base <= 0n) throw moneyErr('invalid_amount', 'Enter an amount greater than zero.');
    var amountNum = Number(baseToText(base, 9));
    var rcpt = await checkRecipient(opts.to, asset);
    var have = opts.balanceBase != null ? BigInt(opts.balanceBase) : await readBaseBalance(asset);
    if (have != null && base > have) {
      throw moneyErr('insufficient_balance', 'You have ' + baseToText(have, 9) + ' ' + asset + '.', { body: { have: Number(baseToText(have, 9)) }, asset: asset });
    }
    var memo = opts.memo ? String(opts.memo).slice(0, 120) : '';
    var to = rcpt.pubkey.toBase58();

    if (asset === 'OST' || asset === 'OSTG') {
      if (!window.OST_RESCUE || typeof window.OST_RESCUE.sendPeerOst !== 'function') throw moneyErr('bad_response', 'The OST send rail is still loading — try again in a moment.');
      var r = await window.OST_RESCUE.sendPeerOst(to, amountNum, memo, asset === 'OSTG' ? OSTG_MINT : undefined);
      return { ok: true, sig: String(r), pending: !!r.pending, asset: asset, amount: amountNum, to: to };
    }

    // SOL (RNT-1): a new address must receive ≥ 0.00089 SOL; what stays behind
    // must be 0 or ≥ 0.00089 SOL.
    var lamports = base;
    if (rcpt.lamports === 0 && lamports < BigInt(RENT_MIN_LAMPORTS)) {
      throw moneyErr('below_rent_minimum', 'A new Solana address must receive at least 0.00089 SOL.', { asset: 'SOL' });
    }
    var poolPaid = !!(window.OST_RESCUE && typeof window.OST_RESCUE.sendPoolFeeOnly === 'function');
    var feeBuffer = poolPaid ? 0n : 5000n;
    if (have != null) {
      if (lamports + feeBuffer > have) throw moneyErr('insufficient_balance', 'You have ' + baseToText(have, 9) + ' SOL.', { asset: 'SOL', body: { have: Number(baseToText(have, 9)) } });
      var rest = have - lamports - feeBuffer;
      if (rest > 0n && rest < BigInt(RENT_MIN_LAMPORTS)) throw moneyErr('keep_rent_reserve', 'Leave at least 0.00089 SOL, or use Max to send all of it.', { asset: 'SOL' });
    }
    var ixs = [];
    if (memo) ixs.push(w.memoIx(memo, w.session.publicKey));
    ixs.push(solanaWeb3.SystemProgram.transfer({ fromPubkey: w.session.publicKey, toPubkey: rcpt.pubkey, lamports: Number(lamports) }));
    var sig, pending = false;
    if (poolPaid) {
      var rs = await window.OST_RESCUE.sendPoolFeeOnly(ixs);
      sig = String(rs); pending = !!rs.pending;
    } else {
      var tx = new solanaWeb3.Transaction();
      ixs.forEach(function (ix) { tx.add(ix); });
      var sent = await signAndSendOnConnection(w.getConnection(), tx);
      sig = sent.signature; pending = sent.pending;
    }
    try { window.dispatchEvent(new CustomEvent('ost:wallet-tx', { detail: { sig: sig, asset: 'SOL', amount: amountNum, direction: 'out', to: to, status: pending ? 'pending' : 'confirmed', source: opts.source || 'send' } })); } catch (e) {}
    return { ok: true, sig: sig, pending: pending, asset: 'SOL', amount: amountNum, to: to };
  }
  window.OST_SEND = {
    send: sendAsset,
    checkRecipient: checkRecipient,
    balance: readBaseBalance,
    parse: parseRecipientInput,
    open: function (o) { openSendModal(o); }
  };

  function sendIntro(asset) {
    if (asset === 'SOL') return 'Native SOL transfer on Solana devnet. OST pays the network fee. A new address must receive at least 0.00089 SOL (Solana’s rent minimum).';
    return 'Real ' + asset + ' transfer on Solana devnet. OST pays the network fee and creates their account — you don’t need SOL. Devnet tokens have no cash value.';
  }

  function buildSendModal() {
    if ($('ostSendModal')) return;
    var modal = document.createElement('div');
    modal.id = 'ostSendModal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'ostSendTitle');
    modal.style.cssText =
      'position:fixed;inset:0;display:none;align-items:center;justify-content:center;' +
      'background:rgba(2,6,16,0.78);backdrop-filter:blur(8px);z-index:9998;padding:16px;';
    var inputCss = 'padding:11px 12px;border-radius:9px;border:1px solid rgba(255,255,255,0.12);background:rgba(0,0,0,0.3);color:#f1f5f9;';
    modal.innerHTML =
      '<div style="background:#0f131e;border:1px solid rgba(255,255,255,0.08);border-radius:18px;max-width:460px;width:100%;max-height:calc(100vh - 32px);overflow:auto;padding:22px 20px;box-shadow:0 20px 60px rgba(0,0,0,0.55);">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">' +
          '<h3 style="margin:0;font-size:1.15rem;color:#f8fafc;" id="ostSendTitle">Send on Devnet</h3>' +
          '<button type="button" id="ostSendClose" aria-label="Close" style="background:transparent;border:none;color:#94a3b8;font-size:1.4rem;cursor:pointer;line-height:1;">&times;</button>' +
        '</div>' +
        '<p style="color:#94a3b8;font-size:.85rem;margin:0 0 14px;" id="ostSendIntro"></p>' +
        '<div style="display:flex;gap:8px;margin:0 0 14px;" role="tablist" aria-label="Asset to send">' +
          '<button type="button" data-send-asset="OST" class="btn btn-outline btn-sm" id="ostSendAssetOst" style="flex:1;">&#9673; OST</button>' +
          '<button type="button" data-send-asset="OSTG" class="btn btn-outline btn-sm" id="ostSendAssetOstg" style="flex:1;">&#9670; OSTG</button>' +
          '<button type="button" data-send-asset="SOL" class="btn btn-outline btn-sm" id="ostSendAssetSol" style="flex:1;">&#9728; SOL</button>' +
        '</div>' +
        '<div style="display:flex;flex-direction:column;gap:14px;">' +
          '<label style="display:flex;flex-direction:column;gap:6px;color:#cbd5e1;font-size:.85rem;">' +
            'Recipient wallet address' +
            '<input type="text" id="ostSendTo" placeholder="Solana address or solana: link" autocomplete="off" spellcheck="false" style="' + inputCss + 'font-family:monospace;font-size:.82rem;">' +
            '<span style="display:flex;gap:6px;flex-wrap:wrap;">' +
              '<button type="button" id="ostSendPaste" class="btn btn-outline btn-sm">Paste</button>' +
              '<button type="button" id="ostSendScan" class="btn btn-outline btn-sm">Scan QR</button>' +
              '<span id="ostSendToCheck" style="font-size:.78rem;color:#94a3b8;align-self:center;"></span>' +
            '</span>' +
          '</label>' +
          '<label style="display:flex;flex-direction:column;gap:6px;color:#cbd5e1;font-size:.85rem;">' +
            '<span style="display:flex;justify-content:space-between;align-items:baseline;gap:8px;"><span id="ostSendAmountLabel">Amount (OST)</span> <span id="ostSendAvail" style="font-size:.78rem;color:#94a3b8;">You have —</span></span>' +
            '<input type="text" inputmode="decimal" id="ostSendAmount" placeholder="0.00" autocomplete="off" style="' + inputCss + 'font-size:.95rem;">' +
            '<span style="display:flex;gap:6px;flex-wrap:wrap;">' +
              '<button type="button" data-send-quick="1" class="btn btn-outline btn-sm">1</button>' +
              '<button type="button" data-send-quick="5" class="btn btn-outline btn-sm">5</button>' +
              '<button type="button" data-send-quick="10" class="btn btn-outline btn-sm">10</button>' +
              '<button type="button" data-send-quick="max" id="ostSendMax" class="btn btn-outline btn-sm" disabled>Max</button>' +
            '</span>' +
          '</label>' +
          '<label style="display:flex;flex-direction:column;gap:6px;color:#cbd5e1;font-size:.85rem;">' +
            'Memo (optional)' +
            '<input type="text" id="ostSendMemo" maxlength="80" placeholder="e.g. coffee, payback, gift..." style="' + inputCss + 'font-size:.85rem;">' +
          '</label>' +
          '<div id="ostSendStatus" role="status" aria-live="polite" style="font-size:.82rem;color:#94a3b8;min-height:18px;"></div>' +
          '<button type="button" id="ostSendBtn" class="btn btn-primary" style="width:100%;justify-content:center;padding:13px;">Send OST</button>' +
        '</div>' +
        '<div id="ostSendScanBox" hidden style="margin-top:12px;">' +
          '<video id="ostSendVideo" playsinline muted style="width:100%;border-radius:12px;background:#000;max-height:260px;"></video>' +
          '<div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap;">' +
            '<label class="btn btn-outline btn-sm" style="cursor:pointer;margin:0;">Use a photo<input type="file" accept="image/*" id="ostSendScanFile" style="display:none;"></label>' +
            '<button type="button" id="ostSendScanStop" class="btn btn-outline btn-sm">Stop camera</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(modal);

    on($('ostSendClose'), 'click', closeSendModal);
    modal.addEventListener('click', function (e) { if (e.target === modal) closeSendModal(); });
    modal.addEventListener('keydown', function (e) { if (e.key === 'Escape') { e.stopPropagation(); closeSendModal(); } });
    on($('ostSendBtn'), 'click', performSend);
    modal.querySelectorAll('[data-send-asset]').forEach(function (b) {
      b.addEventListener('click', function () { if (!sendState.busy) setSendAsset(b.getAttribute('data-send-asset')); });
    });
    on($('ostSendPaste'), 'click', function () {
      if (!navigator.clipboard || !navigator.clipboard.readText) { setSendStatus('Paste with your keyboard (clipboard access is not available here).', '#f59e0b'); return; }
      navigator.clipboard.readText().then(function (t) { applyRecipientText(t); }).catch(function () { setSendStatus('Clipboard blocked — paste with your keyboard.', '#f59e0b'); });
    });
    on($('ostSendScan'), 'click', startSendScan);
    on($('ostSendScanStop'), 'click', stopSendScan);
    on($('ostSendScanFile'), 'change', function (e) {
      var f = e.target.files && e.target.files[0]; if (!f) return;
      loadQrReader().then(function (Q) { return Q.fromFile(f); }).then(function (raw) {
        if (raw) { setSendStatus(''); applyRecipientText(raw); stopSendScan(); } else setSendStatus('No wallet address found in that image.', '#f59e0b');
      }).catch(function () { setSendStatus('Could not read that image.', '#f59e0b'); });
    });
    var toInput = $('ostSendTo');
    on(toInput, 'blur', function () { if (toInput.value.trim()) applyRecipientText(toInput.value, true); });
    on($('ostSendAmount'), 'keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); if (!sendState.busy) performSend(); } });
    modal.querySelectorAll('[data-send-quick]').forEach(function (b) {
      b.addEventListener('click', function () {
        var v = b.getAttribute('data-send-quick');
        var amtInput = $('ostSendAmount');
        if (!amtInput) return;
        if (v === 'max') {
          if (sendState.balanceBase == null || sendState.balanceAsset !== sendState.asset) return;
          // Exact balance in base units — Max never rounds up past what you hold.
          // SOL: everything (the pool pays the fee, the account may close).
          amtInput.value = baseToText(sendState.balanceBase, 9);
        } else {
          amtInput.value = v;
        }
      });
    });
  }

  function setSendStatus(msg, color) {
    var s = $('ostSendStatus');
    if (s) { s.textContent = msg; s.style.color = color || '#94a3b8'; }
  }
  // C2: a user-initiated result always shows; a pending notice is later
  // updated in place (same id) by the rail's resolution notice.
  function sendNotice(n, icon) {
    try {
      if (typeof window.OST_NOTIFY === 'function') return window.OST_NOTIFY(n);
      toast(icon || 'ℹ️', n.title + (n.body ? ' — ' + n.body : ''));
    } catch (e) {}
  }
  // An unknown outcome is followed to the end: OST_RESCUE keeps looking the
  // signature up and fires ost:wallet-tx {resolved:true}; the Send sheet line
  // then says what really happened instead of "still confirming" forever.
  function watchSendResolution(sig, r, asset) {
    sendState.pendingSig = sig;
    function onTx(ev) {
      var d = ev && ev.detail;
      if (!d || !d.resolved || String(d.sig) !== sig) return;
      window.removeEventListener('ost:wallet-tx', onTx);
      if (sendState.pendingSig !== sig) return;          // a newer send owns the line
      sendState.pendingSig = '';
      if (d.status === 'confirmed') setSendStatus('✓ Sent ' + r.amount + ' ' + asset + ' to ' + shortAddr(r.to) + ' · tx ' + sig.slice(0, 8) + '…', '#34d399');
      else setSendStatus('Didn’t go through — ' + r.amount + ' ' + asset + ' was not sent. Nothing moved; you can try again.', '#ef4444');
      setTimeout(refreshSendBalance, 800);
    }
    window.addEventListener('ost:wallet-tx', onTx);
  }

  function applyRecipientText(raw, quiet) {
    var p = parseRecipientInput(raw);
    var toInput = $('ostSendTo');
    if (toInput) toInput.value = p.to;
    if (p.amount && $('ostSendAmount')) $('ostSendAmount').value = p.amount;
    if (p.memo && $('ostSendMemo')) $('ostSendMemo').value = p.memo;
    var chk = $('ostSendToCheck');
    if (!p.to) { if (chk) chk.textContent = ''; return; }
    if (chk) { chk.textContent = 'Checking…'; chk.style.color = '#94a3b8'; }
    checkRecipient(p.to, sendState.asset).then(function () {
      if (chk) { chk.textContent = 'Wallet ' + shortAddr(p.to) + ' ✓'; chk.style.color = '#34d399'; }
    }).catch(function (e) {
      if (chk) { chk.textContent = humanOf(e).title; chk.style.color = '#f59e0b'; }
      if (!quiet) setSendStatus(humanText(e), '#f59e0b');
    });
  }

  var scanStop = null, scanStream = null;
  function loadQrReader() {
    if (window.OST_QR) return Promise.resolve(window.OST_QR);
    return new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = 'ost-qr-reader.js?v=1'; s.async = true;
      s.onload = function () { window.OST_QR ? res(window.OST_QR) : rej(new Error('qr')); };
      s.onerror = function () { rej(new Error('qr')); };
      document.head.appendChild(s);
    });
  }
  function startSendScan() {
    var box = $('ostSendScanBox'), vid = $('ostSendVideo');
    if (!box || !vid) return;
    box.hidden = false;
    if (!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)) { setSendStatus('Camera unavailable — use a photo of the QR code.', '#f59e0b'); return; }
    loadQrReader().then(function (Q) {
      return navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }).then(function (stream) {
        scanStream = stream; vid.srcObject = stream;
        var p = vid.play(); if (p && p.catch) p.catch(function () {});
        scanStop = Q.scanVideo(vid, function (raw) { setSendStatus(''); applyRecipientText(raw); stopSendScan(); }, function () { setSendStatus('Camera scan failed — use a photo.', '#f59e0b'); });
      });
    }).catch(function () { setSendStatus('Camera blocked — use a photo of the QR code.', '#f59e0b'); });
  }
  function stopSendScan() {
    var box = $('ostSendScanBox'); if (box) box.hidden = true;
    if (scanStop) { try { scanStop(); } catch (e) {} scanStop = null; }
    if (scanStream) { try { scanStream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {} scanStream = null; }
  }

  function openSendModal(opts) {
    opts = opts || {};
    var w = window.OST_WALLET;
    if (!w || !w.session || !w.session.publicKey) {
      if (w && typeof w.requireWallet === 'function') { try { w.requireWallet({ reason: 'Send OST', resume: function () { openSendModal(opts); } }); } catch (e) {} return; }
    }
    buildSendModal();
    var modal = $('ostSendModal');
    if (!modal) return;
    modal.style.display = 'flex';
    setSendStatus('');
    if (opts.to) { $('ostSendTo').value = opts.to; }
    if (opts.amount) { $('ostSendAmount').value = String(opts.amount); }
    setSendAsset(opts.asset || window._ostSendAsset || 'OST');
    if (opts.to) applyRecipientText(opts.to, true);
    setTimeout(function () { try { (opts.to ? $('ostSendAmount') : $('ostSendTo')).focus(); } catch (e) {} }, 60);
  }

  function closeSendModal() {
    stopSendScan();
    var modal = $('ostSendModal');
    if (modal) modal.style.display = 'none';
  }

  function setSendAsset(asset) {
    asset = SEND_ASSETS.indexOf(String(asset || '').toUpperCase()) !== -1 ? String(asset).toUpperCase() : 'OST';
    sendState.asset = asset;
    window._ostSendAsset = asset;
    document.querySelectorAll('#ostSendModal [data-send-asset]').forEach(function (b) {
      var on = b.getAttribute('data-send-asset') === asset;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    var sendBtn = $('ostSendBtn');
    if (sendBtn) sendBtn.textContent = 'Send ' + asset;
    var title = $('ostSendTitle');
    if (title) title.textContent = 'Send ' + asset + ' on Devnet';
    var intro = $('ostSendIntro');
    if (intro) intro.textContent = sendIntro(asset);
    var amountLabel = $('ostSendAmountLabel');
    if (amountLabel) amountLabel.textContent = 'Amount (' + asset + ')';
    refreshSendBalance();
  }

  function refreshSendBalance() {
    var avail = $('ostSendAvail'), maxBtn = $('ostSendMax');
    if (!avail) return;
    var w = window.OST_WALLET;
    var asset = sendState.asset;
    sendState.balanceBase = null; sendState.balanceAsset = asset;
    if (maxBtn) maxBtn.disabled = true;
    if (!w || !w.session || !w.session.publicKey) { avail.textContent = 'Connect a wallet first'; return; }
    avail.textContent = 'You have …';
    readBaseBalance(asset).then(function (base) {
      if (sendState.asset !== asset) return;
      if (base == null) {
        avail.textContent = 'You have — (balance unavailable)';
        sendState.balanceBase = null;
        if (maxBtn) maxBtn.disabled = true;
        return;
      }
      sendState.balanceBase = base;
      avail.textContent = 'You have ' + Number(baseToText(base, 9)).toLocaleString(undefined, { maximumFractionDigits: 9 }) + ' ' + asset;
      if (maxBtn) maxBtn.disabled = base <= 0n;
    });
  }

  async function performSend() {
    if (sendState.busy) return;
    var w = window.OST_WALLET;
    var sendBtn = $('ostSendBtn');
    var asset = sendState.asset;
    if (!w || !w.session || !w.session.publicKey) { setSendStatus('Connect a wallet first.', '#f59e0b'); return; }
    var parsed = parseRecipientInput($('ostSendTo').value);
    var to = parsed.to;
    var amountText = String($('ostSendAmount').value || '').trim().replace(',', '.');
    var memo = ($('ostSendMemo').value || '').trim();
    if (!to) return setSendStatus('Enter a recipient address.', '#f59e0b');
    if (!(Number(amountText) > 0)) return setSendStatus('Enter an amount greater than zero.', '#f59e0b');

    sendState.busy = true;
    sendState.pendingSig = '';
    sendBtn.disabled = true;
    sendBtn.innerHTML = '<span class="ost-spinner"></span> sending…';
    setSendStatus(w.session.kind === 'local' ? 'Submitting…' : 'Approve in your wallet…');
    var t0 = Date.now();
    try {
      var r = await sendAsset({ asset: asset, to: to, amount: amountText, memo: memo, balanceBase: sendState.balanceAsset === asset ? sendState.balanceBase : null, source: 'send-sheet' });
      var secs = ((Date.now() - t0) / 1000).toFixed(1);
      if (r.pending) {
        // Outcome unknown: never "Sent". The rail keeps looking it up and
        // fires ost:wallet-tx {resolved:true} when it confirms or fails.
        setSendStatus('Still confirming ' + r.amount + ' ' + asset + ' to ' + shortAddr(r.to) + ' (tx ' + String(r.sig).slice(0, 8) + '…). Check your balance before retrying — this updates when it settles.', '#7dd3fc');
        watchSendResolution(String(r.sig), r, asset);
        sendNotice({ id: 'cosign-' + String(r.sig), kind: 'pending', title: 'Still confirming', body: r.amount + ' ' + asset + ' to ' + shortAddr(r.to) + '. Check your balance before retrying.' }, '⏳');
      } else {
        sendState.pendingSig = '';
        setSendStatus('✓ Sent ' + r.amount + ' ' + asset + ' to ' + shortAddr(r.to) + ' · ' + secs + ' s · tx ' + String(r.sig).slice(0, 8) + '…', '#34d399');
        sendNotice({ id: 'send-' + String(r.sig), kind: 'ok', title: 'Sent ' + r.amount + ' ' + asset, body: 'To ' + shortAddr(r.to) + '.', sig: String(r.sig) }, '💸');
      }
      $('ostSendAmount').value = '';
      try {
        var B = window.OST_BALANCE && OST_BALANCE.get ? OST_BALANCE.get() : {};
        recordSnapshot({ ts: Date.now(), ostBalance: B.ost, solBalance: B.sol, kind: asset === 'SOL' ? 'send-sol' : (asset === 'OSTG' ? 'send-ostg' : 'send'), asset: asset, amount: r.amount, sig: r.sig, to: r.to, pending: !!r.pending });
        refreshChartIfReady();
      } catch (e) {}
      setTimeout(refreshSendBalance, 1500);
    } catch (err) {
      // The error knows its own stage (a failed quote is "nothing was sent")
      // and asset; `submit` is only the fallback for errors that don't.
      var h = humanOf(err, { stage: 'submit', asset: asset });
      setSendStatus(h.title + (h.body ? ' — ' + h.body : ''), h.state === 'pending' ? '#7dd3fc' : '#ef4444');
    } finally {
      sendState.busy = false;
      sendBtn.disabled = false; sendBtn.innerHTML = 'Send ' + sendState.asset;
    }
  }

  // ------------------------------------------------------------------
  // 3) Balance snapshots → real wallet portfolio curve
  // ------------------------------------------------------------------
  function recordSnapshot(snap) {
    var list = loadSnapshots();
    var enriched = enrichSnapshot(Object.assign({ wallet: getActiveWalletAddress() }, snap || {}));
    list.push(enriched);
    saveSnapshots(list);
    shareWalletEvent(enriched);
  }
  // Expose so external modules (e.g. prediction buys in app.js) can log events.
  window.recordOstSnapshot = recordSnapshot;

  // Balances for snapshots come from OST_BALANCE (contract C6) — this module
  // runs no balance RPC loop of its own (NET-3).
  function sharedBalances() {
    try {
      var B = window.OST_BALANCE && typeof OST_BALANCE.get === 'function' ? OST_BALANCE.get() : null;
      if (B) return { ost: B.ost, sol: B.sol };
    } catch (e) {}
    return { ost: null, sol: null };
  }
  window.recordOstPlatformEvent = async function recordOstPlatformEvent(event) {
    var lastSnapshot = loadSnapshots().slice(-1)[0] || {};
    var b = sharedBalances();
    var ostBalance = b.ost != null ? b.ost : (Number(lastSnapshot.ostBalance || 0) || 0);
    var solBalance = b.sol != null ? b.sol : (Number(lastSnapshot.solBalance || 0) || 0);
    recordSnapshot(Object.assign({ ts: Date.now(), ostBalance: ostBalance, solBalance: solBalance }, event || {}));
    refreshChartIfReady();
    notifyTxHistory();
  };

  window.recordOstVaultRetainedLoss = function recordOstVaultRetainedLoss(event) {
    var amount = Number(event && (event.amount != null ? event.amount : event.retainedOst));
    if (!Number.isFinite(amount) || amount <= 0) return Promise.resolve(false);
    return window.recordOstPlatformEvent(Object.assign({
      kind: 'vault-retained-loss',
      source: 'vault',
      vaultFlow: 'retained-loss',
      vault: 'ost-payout-pool',
      amount: amount,
      retainedOst: amount,
      ts: Date.now()
    }, event || {}, {
      amount: amount,
      retainedOst: amount
    }));
  };

  // Curve points: written when OST_BALANCE reports a changed balance.
  function startSnapshotPoller() {
    window.addEventListener('ost:balance', function () {
      try {
        var addr = getActiveWalletAddress();
        if (!addr) return;
        var b = sharedBalances();
        if (b.ost == null || b.sol == null) return;      // unknown is not zero: no fake points
        var list = loadSnapshots();
        var last = list[list.length - 1];
        var delta = !last || last.address !== addr ||
          Math.abs((last.ostBalance || 0) - b.ost) > 1e-6 ||
          Math.abs((last.solBalance || 0) - b.sol) > 1e-6 ||
          (Date.now() - (last.ts || 0)) > 120000;
        if (delta) {
          recordSnapshot({ ts: Date.now(), ostBalance: b.ost, solBalance: b.sol, kind: 'tick', address: addr });
          refreshChartIfReady();
        }
      } catch (e) {}
    }, false);
  }

  // Replace the synthetic wallet portfolio chart drawing
  function refreshChartIfReady() {
    var canvas = $('wdPortfolioChart');
    if (!canvas || !canvas.getContext) return;
    drawRealCurve(canvas);
  }

  // ── Currency helpers ──────────────────────────────────────────────────
  function getCurrencySymbol() {
    var cur = (window.__ostCurrency || 'USD').toUpperCase();
    return { EUR: '€', GBP: '£', CAD: 'C$', AUD: 'A$', MXN: 'MX$', BRL: 'R$', JPY: '¥', CNY: '¥', RUB: '₽', INR: '₹', KRW: '₩', TRY: '₺', AED: 'د.إ', SAR: 'SAR ', BTC: '₿', ETH: 'Ξ' }[cur] || '$';
  }
  function getCurrencyRate() {
    // priceUsd(cur) returns USD per 1 unit of cur (e.g. EUR→1.09).
    // We want USD→cur conversion: USD * (1/rate).
    var cur = (window.__ostCurrency || 'USD').toUpperCase();
    if (cur === 'USD') return 1;
    var rate = (window.OST_TREASURY && window.OST_TREASURY.priceUsd)
      ? window.OST_TREASURY.priceUsd(cur) : 1;
    return (rate > 0) ? rate : 1;
  }
  // Convert a USD amount to the user's selected display currency.
  function usdToDisplayCurrency(usd) {
    return usd / getCurrencyRate();
  }

  // ── Smart axis tick calculator ────────────────────────────────────────
  function calcTicks(min, max, count) {
    count = count || 5;
    var range = max - min;
    if (range === 0) return [min];
    var raw = range / (count - 1);
    var mag = Math.pow(10, Math.floor(Math.log10(raw)));
    var nice = [1, 2, 2.5, 5, 10];
    var step = mag;
    for (var i = 0; i < nice.length; i++) {
      if (raw <= nice[i] * mag) { step = nice[i] * mag; break; }
    }
    var start = Math.floor(min / step) * step;
    var ticks = [];
    for (var v = start; v <= max + step * 0.01; v += step) {
      if (v >= min - step * 0.01) ticks.push(parseFloat(v.toPrecision(8)));
    }
    return ticks;
  }

  // ── Format a value label depending on mode ────────────────────────────
  function fmtLabel(v, mode) {
    if (mode === 'sol') return v.toFixed(v >= 10 ? 2 : 4) + ' SOL';
    if (mode === 'ost') return v >= 1000 ? (v / 1000).toFixed(1) + 'K OST' : v.toFixed(2) + ' OST';
    // usd / default
    var sym = getCurrencySymbol();
    if (v >= 1e6) return sym + (v / 1e6).toFixed(2) + 'M';
    if (v >= 1000) return sym + (v / 1000).toFixed(1) + 'K';
    return sym + v.toFixed(v >= 1 ? 2 : 4);
  }

  // ── Friendly relative time for X-axis labels ──────────────────────────
  function relTime(ts, nowTs) {
    if (!Number.isFinite(Number(ts)) || !Number.isFinite(Number(nowTs))) return '';  // no timestamp -> no "NaNd ago"
    var diff = Math.max(0, Number(nowTs) - Number(ts));
    if (diff < 60000) return 'now';
    if (diff < 3600000) return Math.round(diff / 60000) + 'm ago';
    if (diff < 86400000) return Math.round(diff / 3600000) + 'h ago';
    return Math.round(diff / 86400000) + 'd ago';
  }

  function drawRealCurve(canvas) {
    var snaps = loadSnapshots();
    // Mark active so app.js skips its synthetic placeholder draw and we
    // own the canvas exclusively (fixes the flat-line overlap artifact).
    try { window.__ostWalletRealCurveActive = true; } catch (_) {}
    if (snaps.length < 2) {
      // Draw a placeholder with a "waiting" message
      var ctx0 = canvas.getContext('2d');
      var dpr0 = Math.min(window.devicePixelRatio || 1, 2);
      var rect0 = canvas.getBoundingClientRect();
      var w0 = Math.max(320, Math.round(rect0.width || 820));
      var h0 = Math.max(180, Math.round(rect0.height || 240));
      canvas.width = Math.round(w0 * dpr0); canvas.height = Math.round(h0 * dpr0);
      ctx0.setTransform(dpr0, 0, 0, dpr0, 0, 0);
      ctx0.fillStyle = 'rgba(5,8,14,0.94)'; ctx0.fillRect(0, 0, w0, h0);
      ctx0.fillStyle = '#475569'; ctx0.font = '500 13px Inter,sans-serif';
      ctx0.textAlign = 'center';
      ctx0.fillText('Connect a wallet and make transactions to see your curve', w0 / 2, h0 / 2);
      return;
    }

    var mode = window.__chartMode || 'ost';
    var prices = window.__ostPrices || { solana: 150, ost: 1 };
    var solUsd = prices.solana || 150;
    var ostUsd = prices.ost || 1;

    var recent = snaps.slice(-80);
    var nowTs = Date.now();

    // Build data points based on mode
    var pts = recent.map(function (s) {
      var sol = Number(s.solBalance) || 0;
      var ost = Number(s.ostBalance) || 0;
      var appOst = (Number(s.gameCredits) || 0) + (Number(s.launchpadExposure) || 0);
      var v;
      if (mode === 'ost') {
        v = ost + appOst;
      } else if (mode === 'sol') {
        v = sol;
      } else { // usd
        v = usdToDisplayCurrency(sol * solUsd + (ost + appOst) * ostUsd);
      }
      return { ts: s.ts, v: v, kind: s.kind, ost: ost, sol: sol, gameCredits: Number(s.gameCredits) || 0, launchpadExposure: Number(s.launchpadExposure) || 0 };
    });

    // OSTG series lives in the OSTG wallet module (wallet pool + play pool), which
    // already tracks it reactively — reuse it so this chart mode costs ZERO extra
    // RPC and always agrees with the OSTG card.
    if (mode === 'ostg') {
      var ostgSeries = [];
      try { ostgSeries = JSON.parse(localStorage.getItem('ost.ostg.wallet.series.v1') || '[]') || []; } catch (_) {}
      pts = ostgSeries.slice(-80).map(function (p) {
        return { ts: Number(p.t) || 0, v: Number(p.v) || 0, kind: 'ostg', ost: 0, sol: 0, gameCredits: 0, launchpadExposure: 0 };
      });
    }

    // ── Canvas setup ──────────────────────────────────────────────────
    var rect = canvas.getBoundingClientRect();
    var width = Math.max(320, Math.round(rect.width || canvas.offsetWidth || 820));
    var height = Math.max(200, Math.round(rect.height || canvas.offsetHeight || 240));
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = 'rgba(5,8,14,0.96)';
    ctx.fillRect(0, 0, width, height);

    // ── Padding (left wider for Y labels) ─────────────────────────────
    var pad = { l: 62, r: 18, t: 28, b: 28 };
    var cw = width - pad.l - pad.r;
    var ch = height - pad.t - pad.b;

    var values = pts.map(function (p) { return p.v; });
    var minV = Math.min.apply(null, values);
    var maxV = Math.max.apply(null, values);
    // Pad the range so the line doesn't hug the edges
    var rangeRaw = maxV - minV;
    var rangePad = Math.max(rangeRaw * 0.12, maxV * 0.04, 0.01);
    var lo = Math.max(0, minV - rangePad);
    var hi = maxV + rangePad;
    var range = hi - lo;

    var first = values[0], last = values[values.length - 1];
    var delta = last - first;
    var pct = first > 0 ? (delta / first) * 100 : 0;
    var trendUp = delta >= 0;
    var lineColor = trendUp ? '#34d399' : '#f87171';

    function xPos(i) { return pad.l + (i / Math.max(pts.length - 1, 1)) * cw; }
    function yPos(v) { return pad.t + ch - ((v - lo) / range) * ch; }

    // ── Y-axis ticks ──────────────────────────────────────────────────
    var yTicks = calcTicks(lo, hi, 5);
    ctx.font = '500 10px Inter,ui-sans-serif,sans-serif';
    ctx.textAlign = 'right';
    yTicks.forEach(function (tick) {
      var py = yPos(tick);
      if (py < pad.t - 4 || py > height - pad.b + 4) return;
      // Grid line
      ctx.strokeStyle = 'rgba(255,255,255,0.05)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 4]);
      ctx.beginPath(); ctx.moveTo(pad.l, py); ctx.lineTo(width - pad.r, py); ctx.stroke();
      ctx.setLineDash([]);
      // Tick label
      ctx.fillStyle = '#64748b';
      ctx.fillText(fmtLabel(tick, mode), pad.l - 5, py + 3.5);
    });

    // ── X-axis time markers ───────────────────────────────────────────
    var xTickCount = Math.min(pts.length, 5);
    var step = Math.max(1, Math.floor((pts.length - 1) / (xTickCount - 1)));
    ctx.font = '500 10px Inter,ui-sans-serif,sans-serif';
    ctx.textAlign = 'center';
    for (var xi = 0; xi < pts.length; xi += step) {
      if (xi >= pts.length) break;
      var xp = xPos(xi);
      ctx.strokeStyle = 'rgba(255,255,255,0.04)';
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 5]);
      ctx.beginPath(); ctx.moveTo(xp, pad.t); ctx.lineTo(xp, height - pad.b); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#475569';
      ctx.fillText(relTime(pts[xi].ts, nowTs), xp, height - pad.b + 14);
    }

    // ── Gradient fill ─────────────────────────────────────────────────
    var grad = ctx.createLinearGradient(0, pad.t, 0, height - pad.b);
    grad.addColorStop(0, trendUp ? 'rgba(52,211,153,0.22)' : 'rgba(248,113,113,0.22)');
    grad.addColorStop(0.7, 'rgba(109,159,255,0.03)');
    grad.addColorStop(1, 'rgba(5,8,14,0)');
    ctx.beginPath();
    pts.forEach(function (p, i) {
      var px = xPos(i), py = yPos(p.v);
      if (!i) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    });
    ctx.lineTo(xPos(pts.length - 1), height - pad.b);
    ctx.lineTo(xPos(0), height - pad.b);
    ctx.closePath();
    ctx.fillStyle = grad; ctx.fill();

    // ── Curve line ────────────────────────────────────────────────────
    ctx.beginPath();
    pts.forEach(function (p, i) {
      var px = xPos(i), py = yPos(p.v);
      if (!i) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    });
    ctx.lineWidth = 2.4; ctx.strokeStyle = lineColor;
    ctx.setLineDash([]); ctx.stroke();

    // ── Event markers (non-tick) ──────────────────────────────────────
    var eventColors = {
      'swap-in': '#60a5fa', 'treasury-in': '#60a5fa',
      'send': '#f87171',
      'prediction-buy': '#fbbf24', 'prediction-cashout': '#34d399',
      'prediction-sell': '#34d399', 'prediction-settlement': '#34d399',
      'game-win': '#34d399', 'game-loss': '#f87171', 'game-push': '#94a3b8',
      'games-deposit': '#fbbf24', 'games-cashout': '#34d399',
      'launchpad-buy': '#a78bfa', 'launchpad-sell': '#34d399'
    };
    var eventSymbols = {
      'swap-in': '↓', 'treasury-in': '↓',
      'send': '↑',
      'prediction-buy': '📈', 'prediction-cashout': '💰',
      'prediction-sell': '↔', 'prediction-settlement': '✓',
      'game-win': '+', 'game-loss': '-', 'game-push': '=',
      'games-deposit': '⇣', 'games-cashout': '⇡',
      'launchpad-buy': 'LP', 'launchpad-sell': 'LP'
    };
    pts.forEach(function (p, i) {
      if (!p.kind || p.kind === 'tick') return;
      var ec = eventColors[p.kind] || '#94a3b8';
      var px = xPos(i), py = yPos(p.v);
      // Outer glow
      ctx.beginPath(); ctx.arc(px, py, 7, 0, Math.PI * 2);
      ctx.fillStyle = ec.replace(')', ',0.22)').replace('rgb', 'rgba'); ctx.fill();
      // Inner dot
      ctx.beginPath(); ctx.arc(px, py, 4, 0, Math.PI * 2);
      ctx.fillStyle = ec; ctx.fill();
      ctx.beginPath(); ctx.arc(px, py, 2, 0, Math.PI * 2);
      ctx.fillStyle = '#fff'; ctx.fill();
      // Event label above marker
      ctx.font = '600 9px Inter,sans-serif';
      ctx.fillStyle = ec;
      ctx.textAlign = 'center';
      var lbl = (eventSymbols[p.kind] || '●');
      ctx.fillText(lbl, px, py - 10);
    });

    // ── Last-value endpoint dot + label ───────────────────────────────
    var lx = xPos(pts.length - 1), ly = yPos(last);
    ctx.beginPath(); ctx.arc(lx, ly, 6, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(248,250,252,0.18)'; ctx.fill();
    ctx.beginPath(); ctx.arc(lx, ly, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#f8fafc'; ctx.fill();
    ctx.beginPath(); ctx.arc(lx, ly, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = lineColor; ctx.fill();

    // Current value label (top right)
    var valStr = fmtLabel(last, mode);
    ctx.font = '700 13px Inter,sans-serif';
    ctx.textAlign = 'right';
    ctx.fillStyle = lineColor;
    ctx.fillText(valStr, width - pad.r, pad.t - 8);

    // ── SOL USD equivalent line (only in SOL mode, small label) ───────
    if (mode === 'sol') {
      var sym = getCurrencySymbol();
      var rate = getCurrencyRate();
      var solEquiv = last * solUsd / rate;
      var eqStr = '≈ ' + sym + solEquiv.toFixed(solEquiv >= 1 ? 2 : 4);
      ctx.font = '500 11px Inter,sans-serif';
      ctx.fillStyle = 'rgba(148,163,184,0.8)';
      ctx.textAlign = 'right';
      ctx.fillText(eqStr, width - pad.r, pad.t + 10);
    }

    // ── Data source badge ─────────────────────────────────────────────
    ctx.font = '500 9px Inter,sans-serif';
    ctx.fillStyle = 'rgba(52,211,153,0.55)';
    ctx.textAlign = 'left';
    ctx.fillText('● on-chain · ' + pts.length + ' pts', pad.l, height - pad.b + 14);

    // ── Update stats bar ──────────────────────────────────────────────
    var statsEl = $('ostChartStats');
    if (statsEl) {
      var sign = delta >= 0 ? '+' : '';
      var deltaStr = fmtLabel(Math.abs(delta), mode);
      var pctStr = (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%';
      var colr = trendUp ? '#34d399' : '#f87171';
      var modeLabel = { ost: 'OST + app balance', sol: 'SOL Balance', usd: 'Portfolio (' + getCurrencySymbol() + ')' }[mode] || mode;
      var extraSol = '';
      if (mode === 'sol') {
        var sym2 = getCurrencySymbol(); var rate2 = getCurrencyRate();
        extraSol = ' <span style="color:#64748b;margin-left:4px;">= ' + sym2 + (last * solUsd / rate2).toFixed(2) + '</span>';
      }
      statsEl.innerHTML =
        '<span style="color:#94a3b8;">' + modeLabel + '</span>' +
        '<span style="color:#e2e8f0;font-weight:700;">' + fmtLabel(last, mode) + extraSol + '</span>' +
        '<span style="color:' + colr + ';font-weight:600;">' + sign + deltaStr + '</span>' +
        '<span style="color:' + colr + ';">' + pctStr + '</span>' +
        '<span style="color:#475569;font-size:10px;">' + pts.length + ' samples · last updated ' + relTime(pts[pts.length-1].ts, nowTs) + '</span>';
    }

    // ── Update axis time labels ───────────────────────────────────────
    var startEl = $('wdPortfolioStart'), midEl = $('wdPortfolioMid'), endEl = $('wdPortfolioEnd');
    if (startEl && pts.length > 0) startEl.textContent = relTime(pts[0].ts, nowTs);
    if (midEl && pts.length > 1) midEl.textContent = relTime(pts[Math.floor(pts.length / 2)].ts, nowTs);
    if (endEl) endEl.textContent = 'Now';
  }

  // ------------------------------------------------------------------
  // 3b) Chart toggle wiring
  // ------------------------------------------------------------------
  function wireChartToggle() {
    var container = $('ostChartToggle');
    if (!container) return;
    window.__chartMode = window.__chartMode || 'ost';
    function setActive(mode) {
      window.__chartMode = mode;
      container.querySelectorAll('.chart-toggle-btn').forEach(function(btn) {
        var active = btn.getAttribute('data-chart-mode') === mode;
        btn.style.background = active ? '#6d9fff33' : 'transparent';
        btn.style.color = active ? '#6d9fff' : '#94a3b8';
        if (mode === 'sol' && active) { btn.style.background = '#a78bfa33'; btn.style.color = '#a78bfa'; }
        if (mode === 'usd' && active) { btn.style.background = '#34d39922'; btn.style.color = '#34d399'; }
      });
      refreshChartIfReady();
    }
    container.querySelectorAll('.chart-toggle-btn').forEach(function(btn) {
      btn.addEventListener('click', function() { setActive(btn.getAttribute('data-chart-mode')); });
    });
    setActive(window.__chartMode);
  }

  // ------------------------------------------------------------------
  // 3c) Transaction history panel — rendered below the portfolio chart
  // ------------------------------------------------------------------
  function wireTransactionHistory() {
    var panel = $('ostTxHistoryPanel');
    if (!panel) return;
    var ICONS = {
      'swap-in': '↓', 'treasury-in': '↓', 'send': '↑',
      'prediction-buy': '📈', 'prediction-cashout': '💰',
      'prediction-sell': '↔', 'prediction-settlement': '✓',
      'game-win': '+', 'game-loss': '-', 'game-push': '=',
      'games-deposit': '⇣', 'games-cashout': '⇡',
      'launchpad-buy': 'LP', 'launchpad-sell': 'LP', 'tick': '·'
    };
    var LABELS = {
      'swap-in': 'Swapped → OST', 'treasury-in': 'Converted → OST',
      'send': 'Sent OST', 'prediction-buy': 'Prediction buy',
      'prediction-cashout': 'Prediction cashout',
      'prediction-sell': 'Prediction sell', 'prediction-settlement': 'Prediction settlement',
      'game-win': 'Game win', 'game-loss': 'Game loss', 'game-push': 'Game push',
      'games-deposit': 'Games deposit', 'games-cashout': 'Games cashout',
      'launchpad-buy': 'Launchpad buy', 'launchpad-sell': 'Launchpad sell',
      'tick': 'Balance tick'
    };
    var COLORS = {
      'swap-in': '#60a5fa', 'treasury-in': '#60a5fa',
      'send': '#f87171', 'prediction-buy': '#fbbf24',
      'prediction-cashout': '#34d399', 'prediction-sell': '#34d399', 'prediction-settlement': '#34d399',
      'game-win': '#34d399', 'game-loss': '#f87171', 'game-push': '#94a3b8',
      'games-deposit': '#fbbf24', 'games-cashout': '#34d399',
      'launchpad-buy': '#a78bfa', 'launchpad-sell': '#34d399', 'tick': '#475569'
    };
    function fmtTs(ts) {
      if (!ts) return '—';
      var d = new Date(ts);
      return d.toLocaleDateString(undefined, {month:'short', day:'numeric'}) + ' ' +
             d.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
    }
    function fmtAmt(item) {
      var n = Number(item.amount);
      if (!Number.isFinite(n) || n <= 0) return '—';
      var kind = String(item.kind || '');
      var isOut = /^(send|send-sol|prediction-buy|game-loss|games-deposit|launchpad-buy|ost-to-sol|pay|spend|stake|loan-repay|perp-open|stock-buy|parlay-stake|interchange-pay)$/.test(kind) || /^(send|pay|spend|stake)-/.test(kind);
      var unit = /(^|-)sol$/.test(kind) && !/ost/.test(kind) ? 'SOL' : 'OST';
      var sign = isOut ? '−' : '+';
      var color = isOut ? '#f87171' : '#34d399';
      return '<span style="color:' + color + ';font-weight:700;">' + sign + n.toFixed(unit === 'SOL' ? 4 : 2) + ' ' + unit + '</span>';
    }
    function render() {
      var snaps = loadSnapshots();
      var orders = [];
      try {
        var storedOrders = JSON.parse(localStorage.getItem('ost.prediction.orders.v1') || '[]');
        orders = Array.isArray(storedOrders) ? storedOrders : [];
      } catch(e){}

      var items = snaps
        .filter(function(s){ return s.kind !== 'tick'; })
        .map(function(s){ return { ts: s.ts, kind: s.kind, amount: s.amount, sig: s.sig }; });

      orders.forEach(function(o) {
        items.push({ ts: o.ts || o.createdAt, kind: 'prediction-buy', amount: o.stake,
          sig: o.sig || o.signature,
          label: (o.side||'?').toUpperCase() + ' · ' + String(o.title||'').substring(0,30),
          price: o.price, potentialReturn: o.potentialReturn });
        if (o.cashedOut) {
          items.push({ ts: o.cashoutAt, kind: o.cashoutKind || 'prediction-cashout', amount: o.cashoutOst,
            sig: o.cashoutSig, label: 'Cashout · ' + String(o.title||'').substring(0,30) });
        }
      });

      var seenItems = {};
      items = items.filter(function(item) {
        var key = item.sig
          ? String(item.kind || '') + ':' + String(item.sig)
          : String(item.kind || '') + ':' + String(item.ts || '') + ':' + String(item.amount || '') + ':' + String(item.label || '');
        if (seenItems[key]) return false;
        seenItems[key] = true;
        return true;
      });

      items.sort(function(a,b){ return (b.ts||0)-(a.ts||0); });

      var openPositions = orders.filter(function(o){ return !o.cashedOut; });

      // ── Summary chips ──────────────────────────────────────────────
      var totalIn = 0, totalOut = 0;
      items.forEach(function(it){
        var n = Number(it.amount) || 0;
        if (it.kind === 'swap-in' || it.kind === 'treasury-in' || it.kind === 'prediction-cashout' || it.kind === 'prediction-sell' || it.kind === 'prediction-settlement' || it.kind === 'game-win' || it.kind === 'games-cashout' || it.kind === 'launchpad-sell') totalIn += n;
        if (it.kind === 'send' || it.kind === 'prediction-buy' || it.kind === 'game-loss' || it.kind === 'games-deposit' || it.kind === 'launchpad-buy') totalOut += n;
      });

      var summaryHtml =
        '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px;">' +
        _chip('Received', totalIn.toFixed(2) + ' OST', '#34d399') +
        _chip('Sent / Bet', totalOut.toFixed(2) + ' OST', '#f87171') +
        _chip('Open positions', openPositions.length, '#fbbf24') +
        _chip('Total events', items.length, '#94a3b8') +
        '</div>';

      if (!items.length) {
        panel.innerHTML = summaryHtml + '<p style="color:#64748b;font-size:12px;text-align:center;padding:10px 0;">No transactions yet — make a swap or prediction to start your history.</p>';
        return;
      }

      // ── Table ──────────────────────────────────────────────────────
      var tableHtml =
        '<div style="overflow-x:auto;">' +
        '<table style="width:100%;border-collapse:collapse;font-size:12px;color:#e2e8f0;min-width:440px;">' +
        '<thead>' +
        '<tr style="color:#64748b;font-size:10px;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid rgba(255,255,255,0.07);">' +
        '<th style="text-align:left;padding:5px 8px;font-weight:600;">Time</th>' +
        '<th style="text-align:left;padding:5px 8px;font-weight:600;">Type</th>' +
        '<th style="text-align:right;padding:5px 8px;font-weight:600;">Amount</th>' +
        '<th style="text-align:right;padding:5px 8px;font-weight:600;">Details</th>' +
        '<th style="text-align:center;padding:5px 8px;font-weight:600;">Tx</th>' +
        '</tr>' +
        '</thead><tbody>';

      // SECURITY: every field here can come from the shared server event log, which
      // other clients write to. Escape everything and only link signatures that
      // look like signatures (stored XSS on the page that holds wallet keys).
      var escH = function (v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (ch) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]; }); };
      var sigOk = function (sg) { return /^[1-9A-HJ-NP-Za-km-z]{43,90}$/.test(String(sg || '')); };
      items.slice(0, 50).forEach(function(item, idx) {
        var c = COLORS[item.kind] || '#94a3b8';
        var icon = ICONS[item.kind] || '●';
        var lbl = escH(LABELS[item.kind] || String(item.kind || '').replace(/[-_]/g, ' '));
        var rowBg = idx % 2 === 0 ? 'rgba(255,255,255,0.015)' : 'transparent';
        var sigLink = (item.sig && sigOk(item.sig))
          ? '<a href="https://explorer.solana.com/tx/' + encodeURIComponent(String(item.sig)) + '?cluster=devnet" target="_blank" rel="noopener" title="View on Solana Explorer (devnet)" style="color:#6d9fff;font-size:13px;text-decoration:none;">↗</a>'
          : '—';
        var detail = '';
        if (item.label) {
          detail = '<div style="color:#64748b;font-size:10px;margin-top:1px;">' + escH(item.label) + '</div>';
        }
        if (item.price && item.potentialReturn) {
          var entryPct = (Number(item.price) * 100).toFixed(1);
          var shares = Number(item.price) > 0 ? (Number(item.amount||0) / Number(item.price)).toFixed(2) : '—';
          detail += '<div style="color:#475569;font-size:10px;">' + entryPct + '¢ · ' + shares + ' shares · max ' + Number(item.potentialReturn).toFixed(2) + ' OST</div>';
        }
        tableHtml +=
          '<tr style="background:' + rowBg + ';border-top:1px solid rgba(255,255,255,0.04);">' +
          '<td style="padding:5px 8px;white-space:nowrap;color:#94a3b8;font-size:10px;">' + fmtTs(item.ts) + '</td>' +
          '<td style="padding:5px 8px;">' +
            '<span style="font-size:13px;margin-right:4px;">' + icon + '</span>' +
            '<span style="color:' + c + ';font-weight:600;">' + lbl + '</span>' +
            detail +
          '</td>' +
          '<td style="text-align:right;padding:5px 8px;">' + fmtAmt(item) + '</td>' +
          '<td style="text-align:right;padding:5px 8px;color:#64748b;font-size:10px;">' +
            (item.sig ? escH(String(item.sig).substring(0,8)) + '…' : '—') + '</td>' +
          '<td style="text-align:center;padding:5px 8px;">' + sigLink + '</td>' +
          '</tr>';
      });

      tableHtml += '</tbody></table></div>';
      if (items.length > 50) {
        tableHtml += '<p style="color:#475569;font-size:10px;text-align:center;margin-top:4px;">Showing latest 50 of ' + items.length + ' records</p>';
      }

      panel.innerHTML = summaryHtml + tableHtml;
    }

    function _chip(label, val, color) {
      return '<div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:7px;padding:4px 10px;display:flex;gap:6px;align-items:baseline;">' +
        '<span style="color:#64748b;font-size:10px;">' + label + '</span>' +
        '<span style="color:' + color + ';font-weight:700;font-size:13px;">' + val + '</span>' +
        '</div>';
    }

    render();
    window.addEventListener('ost-tx-history-update', render);
    setInterval(render, 15000);
    window.__renderOstTxHistory = render;
  }

  // Helper to trigger transaction history refresh from other modules
  function notifyTxHistory() {
    try { window.dispatchEvent(new Event('ost-tx-history-update')); } catch(e){}
    if (typeof window.__renderOstTxHistory === 'function') {
      try { window.__renderOstTxHistory(); } catch(e){}
    }
  }
  window.notifyOstTxHistory = notifyTxHistory;

  // ------------------------------------------------------------------
  // 4) Wire the Send button + Receive button on the wallet card
  // ------------------------------------------------------------------
  function wireWalletButtons() {
    on($('wdSendBtn'), 'click', function () { openSendModal(); });
    // Receive button already wired in app.js — leave it
  }

  // ------------------------------------------------------------------
  // 4b) Live quote under the Convert amount — the ONE preview writer for the
  //     SOL / USDC rail (C7, SOL-2). OST -> SOL belongs to swap-resilient.
  // ------------------------------------------------------------------
  function fmtSol(n) { return Number(n).toLocaleString(undefined, { maximumFractionDigits: 6 }); }
  function fmtOst(n) { return Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 }); }
  function wireConvertQuote() {
    var amt = $('transferAmount');
    var sel = $('transferFrom');
    var out = $('transferQuote');
    if (!amt || !sel || !out) return;
    // SOL-2: below the order minimum the pay button is disabled. A marker
    // makes sure only THIS rule ever re-enables what it disabled (the OST
    // cash-out mode and in-flight states are owned elsewhere).
    function setBelowMin(flag) {
      var btn = $('transferBtn');
      if (!btn) return;
      if (flag) { btn.disabled = true; btn.setAttribute('data-ost-below-min', '1'); btn.title = 'Below the minimum order'; }
      else if (btn.getAttribute('data-ost-below-min') === '1') { btn.removeAttribute('data-ost-below-min'); btn.disabled = false; btn.title = ''; }
    }
    function render() {
      var cur = (sel.value || 'SOL').toUpperCase();
      if (cur === 'OST') { setBelowMin(false); return; }   // swap-resilient writes the cash-out quote
      var v = parseFloat(String(amt.value || '').replace(',', '.'));
      if (!Number.isFinite(v) || v <= 0) { setBelowMin(false); out.textContent = ''; return; }
      var cfg = topupConfigCache.value;
      var ostUsd = getLiveOstUsd();
      var minUsd = Number(cfg && cfg.pricing && cfg.pricing.minUsd) || 1;
      var rateLine = '1 OST = $' + ostUsd + ' (fixed, devnet)';
      if (cur === 'SOL') {
        var solUsd = getLiveSolUsd();
        if (!solUsd) { out.innerHTML = '<span style="color:#94a3b8">Loading the devnet SOL price…</span>'; return; }
        var usd = Math.round(v * solUsd * 100) / 100;
        var ost = usd / ostUsd;
        var minSol = minUsd / solUsd;
        var html =
          '<span style="color:#34d399;font-weight:700">&asymp; ' + fmtOst(ost) + ' OST</span>' +
          ' &nbsp;&bull;&nbsp; 1 SOL = $' + solUsd.toFixed(2) + ' &nbsp;&bull;&nbsp; ' + rateLine +
          '<br><small style="color:#cbd5e1;font-size:11px">You will sign <b>' + fmtSol(v) + ' SOL</b>. The network fee is paid by OST.</small>';
        var belowMinSol = v + 1e-12 < minSol;
        if (belowMinSol) {
          html += '<br><small style="color:#f59e0b;font-size:11px">Minimum ' + fmtSol(Math.ceil(minSol * 1e6) / 1e6) + ' SOL ($' + minUsd.toFixed(2) + ').</small>';
        }
        setBelowMin(belowMinSol);
        var B = window.OST_BALANCE && OST_BALANCE.get ? OST_BALANCE.get() : {};
        if (B.sol != null && B.sol + 1e-12 < v) {
          html += '<br><small style="color:#f59e0b;font-size:11px">Need ' + fmtSol(v) + ' SOL — you have ' + fmtSol(B.sol) + '.</small> ' + getSolButtonHtml();
        }
        out.innerHTML = html;
        return;
      }
      if (cur === 'USDC') {
        setBelowMin(v + 1e-9 < minUsd);
        var ostU = v / ostUsd;
        out.innerHTML =
          '<span style="color:#34d399;font-weight:700">&asymp; ' + fmtOst(ostU) + ' OST</span>' +
          ' &nbsp;&bull;&nbsp; ' + rateLine +
          '<br><small style="color:#cbd5e1;font-size:11px">You will sign <b>' + v.toFixed(2) + ' devnet USDC</b> plus a small SOL network fee.</small>' +
          (v + 1e-9 < minUsd ? '<br><small style="color:#f59e0b;font-size:11px">Minimum ' + minUsd.toFixed(2) + ' USDC.</small>' : '');
        return;
      }
      // Other currencies: quote only (settle in SOL or USDC). No cash value on devnet.
      setBelowMin(false);
      try {
        var q = window.OST_REAL_SWAP && window.OST_REAL_SWAP.quoteAny ? window.OST_REAL_SWAP.quoteAny(cur, v) : null;
        if (!q || !Number.isFinite(q.usd) || !(q.usd > 0)) { out.textContent = ''; return; }
        out.innerHTML =
          '<span style="color:#94a3b8">Quote only &asymp; ' + fmtOst(q.usd / ostUsd) + ' OST (&asymp; $' + q.usd.toFixed(2) + ').</span>' +
          '<br><small style="color:#94a3b8;font-size:11px">Settle in devnet SOL or USDC. ' + rateLine + '.</small>';
      } catch (e) { out.textContent = ''; }
    }
    amt.addEventListener('input', render);
    sel.addEventListener('change', render);
    window.addEventListener('ost:convert-price', render);
    window.addEventListener('ost:balance', render);
    loadTopupConfig().then(render).catch(function () {});
    render();
  }

  // ------------------------------------------------------------------
  // 5) Boot
  // ------------------------------------------------------------------
  function boot() {
    if (!window.solanaWeb3) {
      console.warn('[wallet-extras] solanaWeb3 not loaded');
      return;
    }
    if (!window.OST_WALLET) {
      // Wait for app.js to expose primitives
      return setTimeout(boot, 200);
    }
    try { wireBuyOstAutoSelect(); } catch (e) { console.warn(e); }
    try { wireWalletButtons(); } catch (e) { console.warn(e); }
    try { wireChartToggle(); } catch (e) { console.warn(e); }
    try { wireConvertQuote(); } catch (e) { console.warn(e); }
    try { wireTransactionHistory(); } catch (e) { console.warn(e); }
    try { startSnapshotPoller(); } catch (e) { console.warn(e); }
    try { window.syncOstWalletEventsFromRemote(); } catch (e) { console.warn(e); }
    window.addEventListener('ost:wallet-changed', function() {
      try { window.syncOstWalletEventsFromRemote(); } catch (e) {}
    });
    setInterval(function() {
      if (document.hidden) return;   // NET-3: an idle hidden tab makes no requests
      try { window.syncOstWalletEventsFromRemote(); } catch (e) {}
    }, 120000);
    // Initial chart redraw shortly after load
    setTimeout(refreshChartIfReady, 1500);
    // Also redraw on window resize
    window.addEventListener('resize', function () { setTimeout(refreshChartIfReady, 200); });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    setTimeout(boot, 0);
  }
})();

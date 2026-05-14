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
  function toast(icon, msg) { if (typeof window.toast === 'function') window.toast(icon, msg); }

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
  function getLiveSolUsd() {
    // Source of truth ranking: (1) the live /topup/config price the UI is
    // showing in the quote — guarantees the on-chain swap matches what the
    // user just saw; (2) the global price tracker (`__ostPrices`) which is
    // populated by app.js Binance poll; (3) a safe last-resort default.
    try {
      if (window.OST_TOPUP && typeof window.OST_TOPUP.solUsd === 'function') {
        var liveTop = Number(window.OST_TOPUP.solUsd());
        if (Number.isFinite(liveTop) && liveTop > 0) return liveTop;
      }
    } catch (e) {}
    var p = window.__ostPrices || {};
    if (Number.isFinite(p.solana) && p.solana > 0) return p.solana;
    return 150; // sane fallback for May 2026 — much closer to spot than 86.6
  }
  function getLiveOstUsd() {
    // Same ranking: prefer the topup worker price (which is what the UI
    // quote displays — typically 0.0118). Fall back to `__ostPrices.ost`,
    // and finally to the topup default. NEVER default to 1, which would
    // collapse the SOL→OST rate by ~85x and credit "far less OST".
    try {
      if (window.OST_TOPUP && typeof window.OST_TOPUP.usdPerOst === 'function') {
        var liveTop = Number(window.OST_TOPUP.usdPerOst());
        if (Number.isFinite(liveTop) && liveTop > 0) return liveTop;
      }
    } catch (e) {}
    var p = window.__ostPrices || {};
    if (Number.isFinite(p.ost) && p.ost > 0 && p.ost < 100) return p.ost;
    return 0.0118; // matches topup.js DEFAULT_USD_PER_OST
  }

  function quoteSolToOst(solAmount) {
    var solUsd = getLiveSolUsd();
    var ostUsd = getLiveOstUsd();
    var grossOst = (Number(solAmount) * solUsd) / ostUsd;
    var fee = grossOst * 0.005; // 0.5% pool fee
    return {
      ost: Math.max(grossOst - fee, 0),
      grossOst: grossOst,
      fee: fee,
      solUsd: solUsd,
      ostUsd: ostUsd,
      rate: solUsd / ostUsd
    };
  }

  function getSwapPool() {
    if (!window.OST_SWAP_POOL || !window.OST_SWAP_POOL.secretKey) return null;
    try {
      var sk = Uint8Array.from(window.OST_SWAP_POOL.secretKey);
      return solanaWeb3.Keypair.fromSecretKey(sk);
    } catch (e) { console.warn('[swap-pool] bad secret key', e); return null; }
  }

  async function performRealSwap(solAmount, opts) {
    opts = opts || {};
    var w = window.OST_WALLET;
    if (!w || !w.session || !w.session.publicKey) throw new Error('Connect a wallet first');
    if (!Number.isFinite(solAmount) || solAmount <= 0) throw new Error('Invalid SOL amount');

    var pool = getSwapPool();
    if (!pool) throw new Error('Swap pool not loaded — refresh the page');

    var poolPub = pool.publicKey;
    var poolAta = new solanaWeb3.PublicKey(window.OST_SWAP_POOL.ata);
    var mintPk = new solanaWeb3.PublicKey(window.OST_SWAP_POOL.mint);
    var c = w.constants;
    var conn = w.getConnection();

    var quote = quoteSolToOst(solAmount);
    if (quote.ost <= 0) throw new Error('Quote too small');

    // Make sure the user has enough SOL for the exact swap. The pool pays the
    // transaction fee and any OST ATA rent, so no extra SOL buffer is required.
    var userLamports = await conn.getBalance(w.session.publicKey);
    var needed = Math.round(solAmount * solanaWeb3.LAMPORTS_PER_SOL);
    if (userLamports < needed) {
      try { await w.ensureFee(w.session.publicKey); } catch (e) {}
      userLamports = await conn.getBalance(w.session.publicKey);
      if (userLamports < needed) {
        throw new Error('Need ' + (needed / solanaWeb3.LAMPORTS_PER_SOL).toFixed(6) + ' SOL on devnet (have ' + (userLamports / solanaWeb3.LAMPORTS_PER_SOL).toFixed(6) + ')');
      }
    }

    // Check pool OST. The user must receive the full quoted OST amount or the
    // swap must fail before any local success state is written.
    var poolOst = 0;
    try {
      var poolAcct = await conn.getTokenAccountBalance(poolAta);
      poolOst = Number(poolAcct.value.uiAmount || 0);
    } catch (e) {
      throw new Error('Swap pool not initialised on devnet. Admin must run init-swap-pool.ts first.');
    }
    if (poolOst <= 0) throw new Error('OST vault is empty — admin must run init-swap-pool.ts to top it up.');
    var rescueConfig = window.OST_RESCUE && typeof window.OST_RESCUE.vaultConfig === 'function'
      ? window.OST_RESCUE.vaultConfig()
      : {};
    var minReserve = Number(rescueConfig && rescueConfig.minReserve);
    if (!Number.isFinite(minReserve) || minReserve < 0) minReserve = 100000;
    if (poolOst + 0.000000001 < quote.ost) {
      throw new Error('OST vault needs refill before this swap can deliver the full ' + quote.ost.toFixed(4) + ' OST quote. No partial swap was sent.');
    }
    if (minReserve > 0 && poolOst - quote.ost < minReserve) {
      throw new Error('OST vault is protecting its shared payout reserve. Try a smaller swap or wait for refill.');
    }
    var toSendOst = quote.ost;

    // Pool pays the SOL tx fee; user only signs the SOL-transfer instruction.
    // ATA creation (if missing) is handled by OST_RESCUE with pool paying rent.
    var userAta = (window.OST_RESCUE && window.OST_RESCUE.ensureUserAta)
      ? await window.OST_RESCUE.ensureUserAta(w.session.publicKey)
      : await w.ensureAta(w.session.publicKey);

    // Build: user sends SOL → pool + pool sends OST → user, pool is feePayer.
    var tx = new solanaWeb3.Transaction();
    tx.add(solanaWeb3.SystemProgram.transfer({
      fromPubkey: w.session.publicKey,
      toPubkey: poolPub,
      lamports: Math.round(solAmount * solanaWeb3.LAMPORTS_PER_SOL)
    }));
    tx.add(w.transferChecked(
      poolAta, mintPk, userAta, poolPub,
      w.toBaseUnits(toSendOst, c.OST_TOKEN_DECIMALS),
      c.OST_TOKEN_DECIMALS, c.TOKEN_2022_PROGRAM_ID
    ));
    if (opts.memo) tx.add(w.memoIx(opts.memo, w.session.publicKey));

    // Pool is the feePayer — users do not need extra devnet SOL for gas.
    tx.feePayer = poolPub;
    var bh = await conn.getLatestBlockhash('confirmed');
    tx.recentBlockhash = bh.blockhash;
    // Pool partial-signs as feePayer + OST-source authority.
    tx.partialSign(pool);
    // User partial-signs the SystemProgram.transfer (they're spending SOL).
    var sig = await w.sign(tx);
    quote = Object.assign({}, quote, { ost: toSendOst });

    // Snapshot for the curve
    try {
      var ostBal = await w.getOstBalance(w.session.publicKey);
      var solBal = (await conn.getBalance(w.session.publicKey)) / solanaWeb3.LAMPORTS_PER_SOL;
      recordSnapshot({ ts: Date.now(), ostBalance: ostBal, solBalance: solBal, kind: 'swap-in', amount: quote.ost, sig: sig });
      refreshChartIfReady();
    } catch (e) {}

    return { sig: sig, ost: quote.ost, solUsd: quote.solUsd, rate: quote.rate, fee: quote.fee };
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
    if (c === 'SOL') return getLiveSolUsd();
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

    // Use OST_RESCUE.payoutOst for non-SOL deposits: pool pays all fees,
    // user needs zero devnet SOL. The helper requires a full payout.
    if (!window.OST_RESCUE || !window.OST_RESCUE.payoutOst) {
      throw new Error('Vault helper not loaded — refresh the page.');
    }
    var memo = JSON.stringify({
      k: 'treasury-deposit', cur: quote.currency, amt: amt,
      usd: Number(quote.usd.toFixed(2)), ost: Number(quote.ost.toFixed(4)),
      rate: Number(quote.rate.toFixed(6)), t: Date.now()
    });
    var pr = await window.OST_RESCUE.payoutOst(w.session.publicKey, quote.ost, memo);
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

  function rememberPendingPayment(intent, signature, payment) {
    if (!intent || !intent.id || !signature) return;
    var current = readPendingTopup() || {};
    writePendingTopup(Object.assign({}, current, {
      id: intent.id,
      wallet: intent.wallet || current.wallet || getActiveWalletAddress() || '',
      memo: intent.memo || current.memo || '',
      usd: Number(intent.usd || current.usd || 0),
      ostAmount: Number(intent.ostAmount || current.ostAmount || 0),
      paymentRef: String(signature),
      paymentAsset: (payment && payment.asset) || current.paymentAsset || 'SOL',
      paymentAmount: Number((payment && payment.amount) || current.paymentAmount || 0),
      method: intent.method || current.method || 'crypto',
      createdAt: current.createdAt || Date.now()
    }));
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

  function getTopupConnection(config) {
    if (typeof solanaWeb3 === 'undefined') return null;
    var rpcUrl = resolveTopupRpc(config);
    if (!topupConnections[rpcUrl]) {
      topupConnections[rpcUrl] = new solanaWeb3.Connection(rpcUrl, 'confirmed');
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
    if (!wallet) throw new Error('Connect a wallet first');
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
    if (usd < minUsd || usd > maxUsd) {
      throw new Error('Top-up amount must be between $' + minUsd.toFixed(2) + ' and $' + maxUsd.toFixed(2) + '.');
    }
    var payload = await topupRequest('/topup/intent', {
      method: 'POST',
      body: JSON.stringify({
        usd: usd,
        wallet: wallet,
        method: request && request.method === 'stripe' ? 'stripe' : 'crypto'
      })
    });
    writePendingTopup({ id: payload.id, wallet: wallet, method: request && request.method === 'stripe' ? 'stripe' : 'crypto', createdAt: Date.now() });
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

  function transactionError(err) {
    if (!err) return new Error('Transaction send failed');
    var logs = Array.isArray(err.logs) ? err.logs : [];
    var message = err.message || 'Transaction send failed';
    return logs.length ? new Error(message + '\n\nProgram logs:\n' + logs.join('\n')) : new Error(message);
  }

  async function sendRawWithRetry(conn, serialized) {
    try {
      return await conn.sendRawTransaction(serialized, {
        skipPreflight: false,
        preflightCommitment: 'confirmed'
      });
    } catch (error) {
      var message = String(error && error.message || error || '');
      if (message.indexOf('simulation failed') !== -1 || message.indexOf('Simulation failed') !== -1) {
        return conn.sendRawTransaction(serialized, { skipPreflight: true });
      }
      throw error;
    }
  }

  async function signAndSendOnConnection(conn, transaction) {
    var session = getWalletSession();
    if (!conn) throw new Error('Solana RPC unavailable');
    if (!session || !session.publicKey) throw new Error('Connect a wallet first');

    var latest = await conn.getLatestBlockhash('confirmed');
    transaction.recentBlockhash = latest.blockhash;
    if (!transaction.feePayer) transaction.feePayer = session.publicKey;

    var signature = null;
    try {
      if (session.kind === 'local' && session.keypair) {
        transaction.partialSign(session.keypair);
        signature = await sendRawWithRetry(conn, transaction.serialize());
      } else if (session.provider && typeof session.provider.signTransaction === 'function') {
        var signedTransaction = await session.provider.signTransaction(transaction);
        signature = await sendRawWithRetry(conn, signedTransaction.serialize());
      } else if (session.provider && typeof session.provider.signAndSendTransaction === 'function') {
        var result = await session.provider.signAndSendTransaction(transaction);
        signature = typeof result === 'string' ? result : result && result.signature;
      }
    } catch (error) {
      throw transactionError(error);
    }

    if (!signature) throw new Error('Active wallet cannot sign transactions');
    var confirmation = await conn.confirmTransaction({
      signature: signature,
      blockhash: latest.blockhash,
      lastValidBlockHeight: latest.lastValidBlockHeight
    }, 'confirmed');
    if (confirmation && confirmation.value && confirmation.value.err) {
      var errText;
      try { errText = JSON.stringify(confirmation.value.err); }
      catch (e) { errText = String(confirmation.value.err); }
      throw new Error('Transaction reverted on-chain: ' + errText + ' (sig ' + signature + ')');
    }
    return signature;
  }

  async function sendIntentWithSol(intent, config) {
    var wallet = window.OST_WALLET;
    var session = getWalletSession();
    if (!wallet || !session || !session.publicKey) throw new Error('Connect a wallet first');
    var currentConfig = config || await loadTopupConfig();
    var treasury = pickTopupReceiver(currentConfig, 'sol');
    if (!treasury) throw new Error('Treasury SOL receiver is not configured');

    var settlement = quoteTopupSettlement(intent, 'SOL', currentConfig);
    var lamports = Math.ceil(settlement.amount * TOPUP_LAMPORTS_PER_SOL);
    var conn = getTopupConnection(currentConfig);
    var balance = await conn.getBalance(session.publicKey);
    if (balance < lamports + 5000) {
      throw new Error('Need ' + (lamports / TOPUP_LAMPORTS_PER_SOL).toFixed(6) + ' SOL on ' + topupNetworkLabel(currentConfig) + ' (have ' + (balance / TOPUP_LAMPORTS_PER_SOL).toFixed(6) + ')');
    }

    var tx = new solanaWeb3.Transaction();
    tx.add(wallet.memoIx(intent.memo, session.publicKey));
    tx.add(solanaWeb3.SystemProgram.transfer({
      fromPubkey: session.publicKey,
      toPubkey: wallet.toPublicKey(treasury),
      lamports: lamports
    }));

    var signature = await signAndSendOnConnection(conn, tx);
    return { asset: 'SOL', amount: settlement.amount, signature: signature };
  }

  async function sendIntentWithUsdc(intent, config) {
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

    var signature = await signAndSendOnConnection(conn, tx);
    return { asset: 'USDC', amount: settlement.amount, signature: signature };
  }

  async function recordTopupDeliverySnapshot(intent, signature) {
    var wallet = window.OST_WALLET;
    var session = getWalletSession();
    if (!wallet || !session || !session.publicKey) return;
    try {
      var devnetConn = wallet.getConnection && wallet.getConnection();
      var ostBalance = await wallet.getOstBalance(session.publicKey);
      var solBalance = devnetConn ? (await devnetConn.getBalance(session.publicKey)) / TOPUP_LAMPORTS_PER_SOL : 0;
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
    if (!window.OST_RESCUE || typeof window.OST_RESCUE.payoutOst !== 'function') {
      throw new Error('OST payout vault is still loading. Refresh and try again.');
    }

    var payoutMemo = JSON.stringify({
      k: 'ost-topup',
      intent: intent.id,
      usd: Number(intent.usd || 0),
      ost: Number(intent.ostAmount || 0),
      wallet: activeWallet,
      t: Date.now()
    });
    var payout = await window.OST_RESCUE.payoutOst(session.publicKey, Number(intent.ostAmount || 0), payoutMemo);
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
    if (!window.OST_RESCUE || typeof window.OST_RESCUE.payoutOst !== 'function') {
      throw new Error('OST payout vault is still loading. Refresh and try again.');
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
    var payout = await window.OST_RESCUE.payoutOst(session.publicKey, Number(intent.ostAmount || 0), payoutMemo);
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

  async function settleTopupIntent(intentId, asset) {
    var intent = await getTopupStatus(intentId);
    if (intent.status === 'sent') return { intent: intent, payment: null, payout: null, delivered: false };
    if (intent.status === 'paid') return deliverPaidIntent(intent);

    var config = await loadTopupConfig({ force: true });
    var payment = String(asset || 'SOL').toUpperCase() === 'USDC'
      ? await sendIntentWithUsdc(intent, config)
      : await sendIntentWithSol(intent, config);
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
      if (verifyError) throw verifyError;
    }
    if (verified && verified.pendingVerification) {
      return {
        intent: verified.intent || intent,
        payment: payment,
        payout: null,
        delivered: false,
        pendingVerification: true
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

  window.OST_TOPUP = {
    loadConfig: loadTopupConfig,
    quoteSettlement: quoteTopupSettlement,
    createIntent: createTopupIntent,
    createCheckout: createTopupCheckout,
    getStatus: getTopupStatus,
    settleIntent: settleTopupIntent,
    deliverIfPaid: deliverIfPaid,
    rememberPending: writePendingTopup,
    getPending: readPendingTopup,
    clearPending: clearPendingTopup
  };
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
    var d = ms - Date.now();
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
      sourceLabel: 'OST Native',
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
      isOstNative: true,
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
  // 2) Real Send OST modal
  // ------------------------------------------------------------------
  function buildSendModal() {
    if ($('ostSendModal')) return;
    var modal = document.createElement('div');
    modal.id = 'ostSendModal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.style.cssText =
      'position:fixed;inset:0;display:none;align-items:center;justify-content:center;' +
      'background:rgba(2,6,16,0.78);backdrop-filter:blur(8px);z-index:9998;padding:20px;';
    modal.innerHTML =
      '<div style="background:#0f131e;border:1px solid rgba(255,255,255,0.08);border-radius:18px;max-width:460px;width:100%;padding:26px 24px;box-shadow:0 20px 60px rgba(0,0,0,0.55);">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">' +
          '<h3 style="margin:0;font-size:1.15rem;color:#f8fafc;" id="ostSendTitle">Send on Devnet</h3>' +
          '<button type="button" id="ostSendClose" aria-label="Close" style="background:transparent;border:none;color:#94a3b8;font-size:1.4rem;cursor:pointer;line-height:1;">&times;</button>' +
        '</div>' +
        '<p style="color:#94a3b8;font-size:.85rem;margin:0 0 14px;" id="ostSendIntro">Real Token-2022 transfer on Solana devnet. The recipient\'s OST account is created automatically if it doesn\'t exist (small SOL fee).</p>' +
        '<div style="display:flex;gap:8px;margin:0 0 14px;" role="tablist" aria-label="Asset to send">' +
          '<button type="button" data-send-asset="OST" class="btn btn-outline btn-sm is-active" id="ostSendAssetOst" style="flex:1;">&#9673; OST</button>' +
          '<button type="button" data-send-asset="SOL" class="btn btn-outline btn-sm" id="ostSendAssetSol" style="flex:1;">&#9728; SOL</button>' +
        '</div>' +
        '<div style="display:flex;flex-direction:column;gap:14px;">' +
          '<label style="display:flex;flex-direction:column;gap:6px;color:#cbd5e1;font-size:.85rem;">' +
            'Recipient wallet address' +
            '<input type="text" id="ostSendTo" placeholder="Solana public key" autocomplete="off" spellcheck="false" style="padding:11px 12px;border-radius:9px;border:1px solid rgba(255,255,255,0.12);background:rgba(0,0,0,0.3);color:#f1f5f9;font-family:monospace;font-size:.82rem;">' +
          '</label>' +
          '<label style="display:flex;flex-direction:column;gap:6px;color:#cbd5e1;font-size:.85rem;">' +
            '<span style="display:flex;justify-content:space-between;align-items:baseline;"><span id="ostSendAmountLabel">Amount (OST)</span> <span id="ostSendAvail" style="font-size:.78rem;color:#94a3b8;">balance: --</span></span>' +
            '<input type="number" id="ostSendAmount" placeholder="0.00" min="0" step="any" style="padding:11px 12px;border-radius:9px;border:1px solid rgba(255,255,255,0.12);background:rgba(0,0,0,0.3);color:#f1f5f9;font-size:.95rem;">' +
            '<span style="display:flex;gap:6px;flex-wrap:wrap;">' +
              '<button type="button" data-send-quick="0.1" class="btn btn-outline btn-sm">0.1</button>' +
              '<button type="button" data-send-quick="1" class="btn btn-outline btn-sm">1</button>' +
              '<button type="button" data-send-quick="10" class="btn btn-outline btn-sm">10</button>' +
              '<button type="button" data-send-quick="max" class="btn btn-outline btn-sm">Max</button>' +
            '</span>' +
          '</label>' +
          '<label style="display:flex;flex-direction:column;gap:6px;color:#cbd5e1;font-size:.85rem;">' +
            'Memo (optional)' +
            '<input type="text" id="ostSendMemo" maxlength="80" placeholder="e.g. coffee, payback, gift..." style="padding:10px 12px;border-radius:9px;border:1px solid rgba(255,255,255,0.12);background:rgba(0,0,0,0.3);color:#f1f5f9;font-size:.85rem;">' +
          '</label>' +
          '<div id="ostSendStatus" style="font-size:.82rem;color:#94a3b8;min-height:18px;"></div>' +
          '<button type="button" id="ostSendBtn" class="btn btn-primary" style="width:100%;justify-content:center;padding:13px;">Send OST</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(modal);

    on($('ostSendClose'), 'click', closeSendModal);
    modal.addEventListener('click', function (e) { if (e.target === modal) closeSendModal(); });
    on($('ostSendBtn'), 'click', performSend);
    on($('ostSendAssetOst'), 'click', function () { setSendAsset('OST'); });
    on($('ostSendAssetSol'), 'click', function () { setSendAsset('SOL'); });
    modal.querySelectorAll('[data-send-quick]').forEach(function (b) {
      b.addEventListener('click', function () {
        var v = b.getAttribute('data-send-quick');
        var amtInput = $('ostSendAmount');
        if (!amtInput) return;
        if (v === 'max') {
          var av = parseFloat(($('ostSendAvail').textContent.match(/[\d.]+/) || [0])[0]);
          if (Number.isFinite(av) && av > 0) amtInput.value = av;
        } else {
          amtInput.value = v;
        }
      });
    });
  }

  function openSendModal() {
    buildSendModal();
    var modal = $('ostSendModal');
    if (!modal) return;
    modal.style.display = 'flex';
    var status = $('ostSendStatus');
    if (status) status.textContent = '';
    setSendAsset(window._ostSendAsset || 'OST');
  }

  function closeSendModal() {
    var modal = $('ostSendModal');
    if (modal) modal.style.display = 'none';
  }

  // Asset selector: 'OST' (Token-2022 transfer) or 'SOL' (System transfer).
  function setSendAsset(asset) {
    asset = asset === 'SOL' ? 'SOL' : 'OST';
    window._ostSendAsset = asset;
    var ostBtn = $('ostSendAssetOst');
    var solBtn = $('ostSendAssetSol');
    if (ostBtn) ostBtn.classList.toggle('is-active', asset === 'OST');
    if (solBtn) solBtn.classList.toggle('is-active', asset === 'SOL');
    var sendBtn = $('ostSendBtn');
    if (sendBtn) sendBtn.textContent = 'Send ' + asset;
    var title = $('ostSendTitle');
    if (title) title.textContent = 'Send ' + asset + ' on Devnet';
    var intro = $('ostSendIntro');
    if (intro) {
      intro.textContent = asset === 'SOL'
        ? 'Native SOL transfer on Solana devnet. The recipient receives lamports directly \u2014 no token account needed.'
        : 'Real Token-2022 transfer on Solana devnet. The recipient\'s OST account is created automatically if it doesn\'t exist (small SOL fee).';
    }
    var amountLabel = $('ostSendAmountLabel');
    if (amountLabel) amountLabel.textContent = 'Amount (' + asset + ')';
    refreshSendBalance();
  }

  function refreshSendBalance() {
    var avail = $('ostSendAvail');
    if (!avail) return;
    var w = window.OST_WALLET;
    if (!w || !w.session || !w.address) {
      avail.textContent = 'Connect a wallet first';
      return;
    }
    avail.textContent = 'loading…';
    var asset = window._ostSendAsset || 'OST';
    if (asset === 'SOL') {
      var conn = w.getConnection();
      conn.getBalance(w.session.publicKey).then(function (lamports) {
        var sol = (lamports || 0) / solanaWeb3.LAMPORTS_PER_SOL;
        avail.textContent = 'balance: ' + sol.toFixed(4) + ' SOL';
      }).catch(function () { avail.textContent = 'balance: --'; });
      return;
    }
    w.getOstBalance(w.address).then(function (bal) {
      avail.textContent = 'balance: ' + (Number(bal) || 0).toFixed(4) + ' OST';
    }).catch(function () { avail.textContent = 'balance: --'; });
  }

  async function performSend() {
    var w = window.OST_WALLET;
    var statusEl = $('ostSendStatus');
    var sendBtn = $('ostSendBtn');
    var asset = window._ostSendAsset || 'OST';
    var setStatus = function (msg, color) {
      if (statusEl) { statusEl.textContent = msg; statusEl.style.color = color || '#94a3b8'; }
    };

    if (!w || !w.session || !w.session.publicKey) {
      setStatus('Connect a wallet first.', '#f59e0b');
      return;
    }
    var to = ($('ostSendTo').value || '').trim();
    var amount = parseFloat($('ostSendAmount').value);
    var memo = ($('ostSendMemo').value || '').trim();

    if (!to) return setStatus('Enter a recipient address.', '#f59e0b');
    var recipient;
    try { recipient = w.toPublicKey(to); }
    catch (e) { return setStatus('Invalid Solana address.', '#ef4444'); }
    if (!Number.isFinite(amount) || amount <= 0) return setStatus('Enter a positive amount.', '#f59e0b');

    sendBtn.disabled = true;
    sendBtn.innerHTML = '<span class="ost-spinner"></span> sending…';
    try {
      // -----------------------------------------------------------------
      // SOL native transfer path (System Program).
      // -----------------------------------------------------------------
      if (asset === 'SOL') {
        var conn0 = w.getConnection();
        var lamportsToSend = Math.round(amount * solanaWeb3.LAMPORTS_PER_SOL);
        var senderLamports = await conn0.getBalance(w.session.publicKey);
        var feeBuffer = 5000;
        if (senderLamports < lamportsToSend + feeBuffer) {
          setStatus('Not enough SOL. Have ' + (senderLamports / solanaWeb3.LAMPORTS_PER_SOL).toFixed(4) + ' SOL.', '#ef4444');
          sendBtn.disabled = false; sendBtn.innerHTML = 'Send SOL';
          return;
        }
        setStatus('Building transaction…');
        var solTx = new solanaWeb3.Transaction();
        if (memo) solTx.add(w.memoIx(memo, w.session.publicKey));
        solTx.add(solanaWeb3.SystemProgram.transfer({
          fromPubkey: w.session.publicKey,
          toPubkey: recipient,
          lamports: lamportsToSend,
        }));
        setStatus('Awaiting wallet signature…');
        var solSig = await w.sign(solTx);
        setStatus('✓ Sent! Signature: ' + solSig.slice(0, 14) + '…', '#34d399');
        toast('💸', 'Sent ' + amount + ' SOL · ' + solSig.slice(0, 8));

        try {
          var newSol = (await conn0.getBalance(w.session.publicKey)) / solanaWeb3.LAMPORTS_PER_SOL;
          var ostBal2 = await w.getOstBalance(w.session.publicKey).catch(function () { return 0; });
          recordSnapshot({ ts: Date.now(), ostBalance: ostBal2, solBalance: newSol, kind: 'send-sol', amount: amount, sig: solSig, to: to });
          refreshChartIfReady();
        } catch (e) {}

        refreshSendBalance();
        setTimeout(closeSendModal, 2500);
        return;
      }

      // -----------------------------------------------------------------
      // OST Token-2022 transfer path (default).
      // -----------------------------------------------------------------
      var conn = w.getConnection();
      var c = w.constants;
      var mintPk = new solanaWeb3.PublicKey(window.OST_CONFIG.mint);
      var sourceAta = w.associatedAddress(mintPk, w.session.publicKey, false, c.TOKEN_2022_PROGRAM_ID, c.ASSOCIATED_TOKEN_PROGRAM_ID);
      var destAta = w.associatedAddress(mintPk, recipient, false, c.TOKEN_2022_PROGRAM_ID, c.ASSOCIATED_TOKEN_PROGRAM_ID);

      // Make sure sender has SOL for fee; airdrop a tiny bit if not
      try { await w.ensureFee(w.session.publicKey); } catch (e) {
        setStatus('Need a little devnet SOL for fees. Open faucet.solana.com and try again.', '#f59e0b');
        sendBtn.disabled = false; sendBtn.textContent = 'Send OST';
        return;
      }

      setStatus('Building transaction…');
      var tx = new solanaWeb3.Transaction();
      var destInfo = await conn.getAccountInfo(destAta);
      if (!destInfo) {
        setStatus('Recipient has no OST account yet — creating it…');
        tx.add(w.associatedAccountIx(
          w.session.publicKey, destAta, recipient, mintPk,
          c.TOKEN_2022_PROGRAM_ID, c.ASSOCIATED_TOKEN_PROGRAM_ID
        ));
      }
      if (memo) tx.add(w.memoIx(memo, w.session.publicKey));
      tx.add(w.transferChecked(
        sourceAta, mintPk, destAta, w.session.publicKey,
        w.toBaseUnits(amount, c.OST_TOKEN_DECIMALS),
        c.OST_TOKEN_DECIMALS, c.TOKEN_2022_PROGRAM_ID
      ));

      setStatus('Awaiting wallet signature…');
      var sig = await w.sign(tx);
      setStatus('✓ Sent! Signature: ' + sig.slice(0, 14) + '…', '#34d399');
      toast('💸', 'Sent ' + amount + ' OST · ' + sig.slice(0, 8));

      // Snapshot the new balance for the curve
      try {
        var newBal = await w.getOstBalance(w.session.publicKey);
        var sol = (await conn.getBalance(w.session.publicKey)) / solanaWeb3.LAMPORTS_PER_SOL;
        recordSnapshot({ ts: Date.now(), ostBalance: newBal, solBalance: sol, kind: 'send', amount: amount, sig: sig, to: to });
        refreshChartIfReady();
      } catch (e) {}

      refreshSendBalance();
      setTimeout(closeSendModal, 2500);
    } catch (err) {
      console.warn('[OST send] failed', err);
      setStatus('Send failed: ' + (err.message || err), '#ef4444');
    } finally {
      sendBtn.disabled = false; sendBtn.innerHTML = 'Send ' + (window._ostSendAsset || 'OST');
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

  window.recordOstPlatformEvent = async function recordOstPlatformEvent(event) {
    var lastSnapshot = loadSnapshots().slice(-1)[0] || {};
    var ostBalance = Number(lastSnapshot.ostBalance || 0) || 0;
    var solBalance = Number(lastSnapshot.solBalance || 0) || 0;
    try {
      var wallet = window.OST_WALLET;
      if (wallet && wallet.session && wallet.session.publicKey) {
        var connection = wallet.getConnection && wallet.getConnection();
        ostBalance = await wallet.getOstBalance(wallet.session.publicKey);
        if (connection) {
          solBalance = (await connection.getBalance(wallet.session.publicKey)) / solanaWeb3.LAMPORTS_PER_SOL;
        }
      }
    } catch (e) {}
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

  // Periodic background snapshot so the curve fills in even without txs
  function startSnapshotPoller() {
    var w = window.OST_WALLET;
    var lastAddr = null;
    setInterval(async function () {
      try {
        if (!w || !w.session || !w.address) return;
        var conn = w.getConnection();
        if (!conn) return;
        var addr = w.address;
        var ost = await w.getOstBalance(addr);
        var lamports = await conn.getBalance(w.session.publicKey);
        var sol = lamports / solanaWeb3.LAMPORTS_PER_SOL;
        var list = loadSnapshots();
        var last = list[list.length - 1];
        // Only snapshot if address changed or balance moved or 60s elapsed
        var delta = !last || last.address !== addr ||
          Math.abs((last.ostBalance || 0) - ost) > 1e-6 ||
          Math.abs((last.solBalance || 0) - sol) > 1e-6 ||
          (Date.now() - (last.ts || 0)) > 60000;
        if (delta) {
          recordSnapshot({ ts: Date.now(), ostBalance: ost, solBalance: sol, kind: 'tick', address: addr });
          refreshChartIfReady();
        }
        lastAddr = addr;
      } catch (e) {}
    }, 30000);
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
    var diff = Math.max(0, nowTs - ts);
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
      var isOut = item.kind === 'send' || item.kind === 'prediction-buy' || item.kind === 'game-loss' || item.kind === 'games-deposit' || item.kind === 'launchpad-buy';
      var sign = isOut ? '−' : '+';
      var color = isOut ? '#f87171' : '#34d399';
      return '<span style="color:' + color + ';font-weight:700;">' + sign + n.toFixed(2) + ' OST</span>';
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

      items.slice(0, 50).forEach(function(item, idx) {
        var c = COLORS[item.kind] || '#94a3b8';
        var icon = ICONS[item.kind] || '●';
        var lbl = LABELS[item.kind] || item.kind;
        var rowBg = idx % 2 === 0 ? 'rgba(255,255,255,0.015)' : 'transparent';
        var sigLink = item.sig
          ? '<a href="https://explorer.solana.com/tx/' + item.sig + '?cluster=devnet" target="_blank" rel="noopener" title="View on Solscan" style="color:#6d9fff;font-size:13px;text-decoration:none;">↗</a>'
          : '—';
        var detail = '';
        if (item.label) {
          detail = '<div style="color:#64748b;font-size:10px;margin-top:1px;">' + String(item.label) + '</div>';
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
            (item.sig ? item.sig.substring(0,8) + '…' : '—') + '</td>' +
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
    on($('wdSendBtn'), 'click', openSendModal);
    // Receive button already wired in app.js — leave it
  }

  // ------------------------------------------------------------------
  // 4b) Live quote under Convert amount input
  // ------------------------------------------------------------------
  function wireConvertQuote() {
    var amt = $('transferAmount');
    var sel = $('transferFrom');
    var out = $('transferQuote');
    if (!amt || !sel || !out) return;
    function refresh() {
      var v = parseFloat(amt.value);
      var cur = (sel.value || 'SOL').toUpperCase();
      if (!Number.isFinite(v) || v <= 0) { out.textContent = ''; return; }
      if (!window.OST_REAL_SWAP) { out.textContent = ''; return; }
      try {
        var q = window.OST_REAL_SWAP.quoteAny(cur, v);
        if (!q || !Number.isFinite(q.ost) || q.ost <= 0) { out.textContent = ''; return; }
        var unitLabel = cur === 'SOL' ? '$' + q.unitUsd.toFixed(2) + '/SOL'
          : '$' + q.unitUsd.toFixed(cur === 'BTC' ? 0 : 2) + '/' + cur;
        var solEquiv = q.usd / (priceUsd('SOL') || 86.6);
        out.innerHTML =
          '<span style="color:#34d399;font-weight:700">&asymp; ' + q.ost.toFixed(2) + ' OST</span>' +
          ' &nbsp;&bull;&nbsp; ' + unitLabel +
          (cur !== 'SOL' ? ' &nbsp;&bull;&nbsp; &asymp; ' + solEquiv.toFixed(4) + ' SOL equiv' : '') +
          ' &nbsp;&bull;&nbsp; fee ' + q.fee.toFixed(2) + ' OST' +
          '<br><small style="color:#94a3b8;font-size:10px">Pool pays network fee &mdash; no devnet SOL needed</small>';
      } catch(e) { out.textContent = ''; }
    }
    amt.addEventListener('input', refresh);
    sel.addEventListener('change', refresh);
    setInterval(refresh, 8000);
    refresh();
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
      try { window.syncOstWalletEventsFromRemote(); } catch (e) {}
    }, 60000);
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

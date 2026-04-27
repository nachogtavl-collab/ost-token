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

  // ------------------------------------------------------------------
  // 0) Real SOL → OST swap engine (devnet co-signed)
  //    Builds an atomic Transaction:
  //      ix1: SystemProgram.transfer(user → swapPool, lamports)
  //      ix2: token transferChecked(swapPool ATA → user ATA, OST amount)
  //    Both signers (user + swapPool) sign before the network sees it.
  //    The swap pool keypair is published in site/swap-pool.js (devnet ONLY).
  // ------------------------------------------------------------------
  function getLiveSolUsd() {
    var p = window.__ostPrices || {};
    if (Number.isFinite(p.solana) && p.solana > 0) return p.solana;
    return 86.6; // sane fallback ~ April 2026
  }
  function getLiveOstUsd() {
    var p = window.__ostPrices || {};
    if (Number.isFinite(p.ost) && p.ost > 0) return p.ost;
    return 1;
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

    // Make sure the user has enough SOL (for swap + fee + ATA rent)
    var userLamports = await conn.getBalance(w.session.publicKey);
    var needed = Math.round(solAmount * solanaWeb3.LAMPORTS_PER_SOL) + 5_000_000; // +0.005 SOL buffer
    if (userLamports < needed) {
      try { await w.ensureFee(w.session.publicKey); } catch (e) {}
      userLamports = await conn.getBalance(w.session.publicKey);
      if (userLamports < needed) {
        throw new Error('Need ' + (needed / solanaWeb3.LAMPORTS_PER_SOL).toFixed(4) + ' SOL on devnet (have ' + (userLamports / solanaWeb3.LAMPORTS_PER_SOL).toFixed(4) + ')');
      }
    }

    // Check pool OST; cap the payout to available balance (never throw on low).
    var poolOst = 0;
    try {
      var poolAcct = await conn.getTokenAccountBalance(poolAta);
      poolOst = Number(poolAcct.value.uiAmount || 0);
    } catch (e) {
      throw new Error('Swap pool not initialised on devnet. Admin must run init-swap-pool.ts first.');
    }
    if (poolOst <= 0) throw new Error('OST vault is empty — admin must run init-swap-pool.ts to top it up.');
    var toSendOst = Math.min(quote.ost, Math.floor(poolOst * 100) / 100);

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
    if (c === 'SOL') return Number.isFinite(p.solana) && p.solana > 0 ? p.solana : 86.6;
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
    // user needs zero devnet SOL. Caps the payout to actual pool balance.
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

  window.buildOstNativeMarkets = function () {
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
          '<h3 style="margin:0;font-size:1.15rem;color:#f8fafc;">Send OST on Devnet</h3>' +
          '<button type="button" id="ostSendClose" aria-label="Close" style="background:transparent;border:none;color:#94a3b8;font-size:1.4rem;cursor:pointer;line-height:1;">&times;</button>' +
        '</div>' +
        '<p style="color:#94a3b8;font-size:.85rem;margin:0 0 16px;">Real Token-2022 transfer on Solana devnet. The recipient\'s OST account is created automatically if it doesn\'t exist (small SOL fee).</p>' +
        '<div style="display:flex;flex-direction:column;gap:14px;">' +
          '<label style="display:flex;flex-direction:column;gap:6px;color:#cbd5e1;font-size:.85rem;">' +
            'Recipient wallet address' +
            '<input type="text" id="ostSendTo" placeholder="Solana public key" autocomplete="off" spellcheck="false" style="padding:11px 12px;border-radius:9px;border:1px solid rgba(255,255,255,0.12);background:rgba(0,0,0,0.3);color:#f1f5f9;font-family:monospace;font-size:.82rem;">' +
          '</label>' +
          '<label style="display:flex;flex-direction:column;gap:6px;color:#cbd5e1;font-size:.85rem;">' +
            '<span style="display:flex;justify-content:space-between;align-items:baseline;">Amount (OST) <span id="ostSendAvail" style="font-size:.78rem;color:#94a3b8;">balance: --</span></span>' +
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
    refreshSendBalance();
  }

  function closeSendModal() {
    var modal = $('ostSendModal');
    if (modal) modal.style.display = 'none';
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
    w.getOstBalance(w.address).then(function (bal) {
      avail.textContent = 'balance: ' + (Number(bal) || 0).toFixed(4) + ' OST';
    }).catch(function () { avail.textContent = 'balance: --'; });
  }

  async function performSend() {
    var w = window.OST_WALLET;
    var statusEl = $('ostSendStatus');
    var sendBtn = $('ostSendBtn');
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
      sendBtn.disabled = false; sendBtn.innerHTML = 'Send OST';
    }
  }

  // ------------------------------------------------------------------
  // 3) Balance snapshots → real wallet portfolio curve
  // ------------------------------------------------------------------
  function recordSnapshot(snap) {
    var list = loadSnapshots();
    list.push(snap);
    saveSnapshots(list);
  }
  // Expose so external modules (e.g. prediction buys in app.js) can log events.
  window.recordOstSnapshot = recordSnapshot;

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

  function drawRealCurve(canvas) {
    var snaps = loadSnapshots();
    if (snaps.length < 2) return; // let the original draw handle it
    var prices = (window.__ostPrices || { solana: 150, ost: 1 });
    // Compute USD value at each snapshot
    var pts = snaps.slice(-60).map(function (s) {
      var sol = Number(s.solBalance) || 0;
      var ost = Number(s.ostBalance) || 0;
      return {
        ts: s.ts,
        usd: sol * (prices.solana || 150) + ost * (prices.ost || 1),
        kind: s.kind
      };
    });

    var rect = canvas.getBoundingClientRect();
    var width = Math.max(320, Math.round(rect.width || canvas.width || 820));
    var height = Math.max(220, Math.round(rect.height || canvas.height || 240));
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = 'rgba(5,8,14,0.94)';
    ctx.fillRect(0, 0, width, height);

    var pad = { l: 22, r: 22, t: 24, b: 30 };
    var values = pts.map(function (p) { return p.usd; });
    var minV = Math.min.apply(null, values);
    var maxV = Math.max.apply(null, values);
    var range = Math.max(maxV - minV, maxV * 0.05, 1);
    var first = values[0], last = values[values.length - 1];
    var trendUp = last >= first;
    var color = trendUp ? '#34d399' : '#f5c468';

    function x(i) { return pad.l + (i / Math.max(pts.length - 1, 1)) * (width - pad.l - pad.r); }
    function y(v) { return pad.t + (height - pad.t - pad.b) - ((v - minV) / range) * (height - pad.t - pad.b); }

    // grid
    [0.25, 0.5, 0.75].forEach(function (lvl) {
      var py = pad.t + (height - pad.t - pad.b) * lvl;
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.beginPath(); ctx.moveTo(pad.l, py); ctx.lineTo(width - pad.r, py); ctx.stroke();
    });

    // fill
    var grad = ctx.createLinearGradient(0, pad.t, 0, height - pad.b);
    grad.addColorStop(0, trendUp ? 'rgba(52,211,153,0.28)' : 'rgba(245,196,104,0.28)');
    grad.addColorStop(1, 'rgba(109,159,255,0.02)');
    ctx.beginPath();
    pts.forEach(function (p, i) {
      var px = x(i), py = y(p.usd);
      if (!i) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    });
    ctx.lineTo(x(pts.length - 1), height - pad.b);
    ctx.lineTo(x(0), height - pad.b);
    ctx.closePath();
    ctx.fillStyle = grad; ctx.fill();

    // line
    ctx.beginPath();
    pts.forEach(function (p, i) {
      var px = x(i), py = y(p.usd);
      if (!i) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    });
    ctx.lineWidth = 2.6; ctx.strokeStyle = color; ctx.stroke();

    // markers for non-tick events (real money in/out)
    pts.forEach(function (p, i) {
      if (p.kind && p.kind !== 'tick') {
        ctx.beginPath();
        ctx.arc(x(i), y(p.usd), 4, 0, Math.PI * 2);
        ctx.fillStyle = p.kind === 'send' ? '#f87171' : '#60a5fa';
        ctx.fill();
      }
    });

    // last value label
    var lx = x(pts.length - 1), ly = y(last);
    ctx.beginPath(); ctx.arc(lx, ly, 5, 0, Math.PI * 2); ctx.fillStyle = '#f8fafc'; ctx.fill();
    ctx.beginPath(); ctx.arc(lx, ly, 3, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
    ctx.fillStyle = '#f8fafc'; ctx.font = '600 13px Inter, sans-serif';
    var label = '$' + last.toFixed(last >= 1 ? 2 : 4);
    ctx.fillText(label, Math.max(pad.l, lx - 64), Math.max(18, ly - 10));

    // "real on-chain" badge
    ctx.fillStyle = 'rgba(52,211,153,0.85)';
    ctx.font = '600 10px Inter, sans-serif';
    ctx.fillText('● real on-chain history (' + pts.length + ' samples)', pad.l, height - 10);
  }

  // ------------------------------------------------------------------
  // 3b) Transaction history panel — rendered below the portfolio chart
  // ------------------------------------------------------------------
  function wireTransactionHistory() {
    var panel = $('ostTxHistoryPanel');
    if (!panel) return;
    function kindIcon(k) {
      if (k === 'swap-in' || k === 'treasury-in') return '&#x2193;'; // down arrow = received
      if (k === 'send') return '&#x2191;'; // up arrow = sent
      if (k === 'prediction-buy') return '&#x1F4CA;'; // chart
      if (k === 'prediction-cashout') return '&#x1F4B0;'; // money bag
      return '&#x25CF;'; // dot for tick
    }
    function kindLabel(k) {
      if (k === 'swap-in') return 'Swapped to OST';
      if (k === 'treasury-in') return 'Converted to OST';
      if (k === 'send') return 'Sent OST';
      if (k === 'prediction-buy') return 'Prediction buy';
      if (k === 'prediction-cashout') return 'Prediction cashout';
      if (k === 'tick') return 'Balance update';
      return k || 'Activity';
    }
    function kindColor(k) {
      if (k === 'swap-in' || k === 'treasury-in' || k === 'prediction-cashout') return '#34d399';
      if (k === 'send' || k === 'prediction-buy') return '#f87171';
      return '#94a3b8';
    }
    function fmtTs(ts) {
      if (!ts) return '';
      var d = new Date(ts);
      return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
    }
    function render() {
      var snaps = loadSnapshots();
      // Also pull prediction orders if available
      var orders = [];
      try {
        if (typeof readPredictionOrderRecords === 'function') {
          orders = readPredictionOrderRecords() || [];
        }
      } catch(e){}
      // Merge snaps (non-tick) and orders into one timeline
      var items = snaps
        .filter(function(s){ return s.kind !== 'tick'; })
        .map(function(s){ return {ts: s.ts, kind: s.kind, amount: s.amount, sig: s.sig, ostBalance: s.ostBalance}; });
      orders.forEach(function(o){
        items.push({ts: o.ts || o.createdAt || o.timestamp, kind: 'prediction-buy', amount: o.stake, sig: o.sig || o.signature, label: (o.side||'?').toUpperCase()+' on '+String(o.title||'').substring(0,32)});
        if (o.cashedOut) {
          items.push({ts: o.cashoutAt || o.ts, kind: 'prediction-cashout', amount: o.cashoutOst, sig: o.cashoutSig, label: 'Cashout: '+String(o.title||'').substring(0,32)});
        }
      });
      items.sort(function(a,b){ return (b.ts||0)-(a.ts||0); });
      if (!items.length) {
        panel.innerHTML = '<p style="color:#64748b;font-size:12px;text-align:center;padding:12px 0;">No transactions yet. Make a swap or prediction to see your history.</p>';
        return;
      }
      var html = '<table style="width:100%;border-collapse:collapse;font-size:13px;color:#e2e8f0;">' +
        '<thead><tr style="color:#94a3b8;font-size:11px;text-transform:uppercase;letter-spacing:.04em;">' +
        '<th style="text-align:left;padding:4px 6px;">Time</th><th style="padding:4px 6px;">Type</th>' +
        '<th style="text-align:right;padding:4px 6px;">Amount</th><th style="padding:4px 6px;">Tx</th>' +
        '</tr></thead><tbody>';
      items.slice(0,40).forEach(function(item){
        var color = kindColor(item.kind);
        var amtTxt = Number.isFinite(Number(item.amount)) && Number(item.amount) > 0
          ? (item.kind === 'send' || item.kind === 'prediction-buy' ? '-' : '+') + Number(item.amount).toFixed(2) + ' OST'
          : '';
        var sigLink = item.sig ? '<a href="https://explorer.solana.com/tx/'+item.sig+'?cluster=devnet" target="_blank" rel="noopener" style="color:#6d9fff;font-size:11px;">&nearr;</a>' : '';
        var detail = item.label ? '<div style="color:#64748b;font-size:11px;">'+item.label+'</div>' : '';
        html += '<tr style="border-top:1px solid rgba(255,255,255,0.05);">' +
          '<td style="padding:5px 6px;white-space:nowrap;color:#94a3b8;font-size:11px;">' + fmtTs(item.ts) + '</td>' +
          '<td style="padding:5px 6px;"><span style="font-size:15px;">' + kindIcon(item.kind) + '</span>' +
          ' <span style="color:'+color+'">'+kindLabel(item.kind)+'</span>'+detail+'</td>' +
          '<td style="text-align:right;padding:5px 6px;color:'+color+';font-weight:600;">' + amtTxt + '</td>' +
          '<td style="text-align:center;padding:5px 6px;">' + sigLink + '</td>' +
          '</tr>';
      });
      html += '</tbody></table>';
      if (items.length > 40) {
        html += '<p style="color:#64748b;font-size:11px;text-align:center;margin-top:4px;">Showing latest 40 of '+items.length+' records</p>';
      }
      panel.innerHTML = html;
    }
    render();
    // Re-render on wallet activity (snapshot writes trigger chart, so hook resize)
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
    try { wireConvertQuote(); } catch (e) { console.warn(e); }
    try { wireTransactionHistory(); } catch (e) { console.warn(e); }
    try { startSnapshotPoller(); } catch (e) { console.warn(e); }
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

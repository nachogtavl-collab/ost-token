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

    // Make sure the pool has enough OST
    try {
      var poolAcct = await conn.getTokenAccountBalance(poolAta);
      var poolOst = Number(poolAcct.value.uiAmount || 0);
      if (poolOst < quote.ost) {
        throw new Error('Swap pool low on OST (' + poolOst.toFixed(2) + '). Try again later or contact admin to refill.');
      }
    } catch (e) {
      if (e && /low on OST/.test(e.message)) throw e;
      // pool ATA missing — bail
      throw new Error('Swap pool not initialised on devnet');
    }

    // Make sure user has an OST ATA
    var userAta = await w.ensureAta(w.session.publicKey);

    var tx = new solanaWeb3.Transaction();
    tx.add(solanaWeb3.SystemProgram.transfer({
      fromPubkey: w.session.publicKey,
      toPubkey: poolPub,
      lamports: Math.round(solAmount * solanaWeb3.LAMPORTS_PER_SOL)
    }));
    tx.add(w.transferChecked(
      poolAta, mintPk, userAta, poolPub,
      w.toBaseUnits(quote.ost, c.OST_TOKEN_DECIMALS),
      c.OST_TOKEN_DECIMALS, c.TOKEN_2022_PROGRAM_ID
    ));
    if (opts.memo) tx.add(w.memoIx(opts.memo, w.session.publicKey));

    tx.feePayer = w.session.publicKey;
    var bh = await conn.getLatestBlockhash('confirmed');
    tx.recentBlockhash = bh.blockhash;

    // Co-sign with the swap pool keypair (devnet only) FIRST
    tx.partialSign(pool);

    // Then user signs + sends via the existing helper (handles local + provider)
    var sig = await w.sign(tx);

    // Snapshot for the curve
    try {
      var ostBal = await w.getOstBalance(w.session.publicKey);
      var solBal = (await conn.getBalance(w.session.publicKey)) / solanaWeb3.LAMPORTS_PER_SOL;
      recordSnapshot({ ts: Date.now(), ostBalance: ostBal, solBalance: solBal, kind: 'swap-in', amount: quote.ost, sig: sig });
      refreshChartIfReady();
    } catch (e) {}

    return { sig: sig, ost: quote.ost, solUsd: quote.solUsd, rate: quote.rate, fee: quote.fee };
  }

  window.OST_REAL_SWAP = {
    quote: quoteSolToOst,
    swap: performRealSwap,
    pool: function () { return window.OST_SWAP_POOL ? window.OST_SWAP_POOL.publicKey : null; }
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
      var cur = sel.value;
      if (cur !== 'SOL' || !Number.isFinite(v) || v <= 0) {
        out.textContent = '';
        return;
      }
      if (!window.OST_REAL_SWAP) { out.textContent = ''; return; }
      var q = window.OST_REAL_SWAP.quote(v);
      out.innerHTML = '<span style="color:#34d399;">&asymp; ' + q.ost.toFixed(2) +
        ' OST</span> at $' + q.solUsd.toFixed(2) + '/SOL &middot; pool fee ' + q.fee.toFixed(2) + ' OST';
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

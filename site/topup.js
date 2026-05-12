/* ============================================================
 * OST Converter Hub - flexible value-based OST refill
 * ============================================================
 * Renders one command center for:
 *   - Buy OST by exact USD value (card or crypto)
 *   - Convert SOL <-> OST quotes
 *   - Prepare transfers for SOL, USDC, and OST
 *
 * The payment modal still talks to the ost-api worker:
 *   GET  /topup/config
 *   POST /topup/intent
 *   POST /topup/checkout
 *   POST /topup/crypto/verify
 *   GET  /topup/status/:id
 * ============================================================ */
(function () {
  'use strict';

  const DEFAULT_USD_PER_OST = 0.0118;
  const DEFAULT_SOL_USD = 150;
  const DEFAULT_MIN_USD = 1;
  const DEFAULT_MAX_USD = 5000;
  const SUGGESTED_USD = [5, 10, 25, 50];

  const API_BASE = () => (window.OST_TOPUP_API || window.OST_API_BASE || '').replace(/\/+$/, '');

  let configCache = null;
  let pollTimer = null;
  let activeCryptoIntent = null;

  function normalizeClusterName(cluster) {
    const raw = String(cluster || '').toLowerCase();
    return (raw === 'mainnet-beta' || raw === 'mainnet') ? 'mainnet' : 'devnet';
  }

  function clusterLabel(cfg) {
    return normalizeClusterName(cfg && cfg.cluster) === 'mainnet' ? 'Solana mainnet' : 'Solana devnet';
  }
  let currentQuote = quoteFromUsd(10);
  let activeConverterTab = 'buy';
  let conversionDirection = 'solToOst';

  const $ = (id) => document.getElementById(id);

  function numberFrom(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function usdPerOst() {
    return numberFrom(configCache?.pricing?.usdPerOst || configCache?.usdPerOst, DEFAULT_USD_PER_OST);
  }

  function solUsd() {
    return numberFrom(configCache?.pricing?.solUsd || configCache?.solUsd, DEFAULT_SOL_USD);
  }

  function minUsd() {
    return numberFrom(configCache?.pricing?.minUsd, DEFAULT_MIN_USD);
  }

  function maxUsd() {
    return numberFrom(configCache?.pricing?.maxUsd, DEFAULT_MAX_USD);
  }

  function fmtUsd(n) {
    return '$' + Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function fmtOst(n) {
    return Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + ' OST';
  }

  function fmtSol(n) {
    return Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 6 }) + ' SOL';
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function waitForSwapRail() {
    for (let attempt = 0; attempt < 24; attempt += 1) {
      if (window.OST_REAL_SWAP && typeof window.OST_REAL_SWAP.swapAny === 'function' &&
          window.OST_RESCUE && typeof window.OST_RESCUE.ensureUserAta === 'function') {
        return window.OST_REAL_SWAP;
      }
      await sleep(150);
    }
    return window.OST_REAL_SWAP || null;
  }

  function clampUsd(usd) {
    const clean = Math.round(numberFrom(usd, 0) * 100) / 100;
    if (!Number.isFinite(clean)) return 0;
    return Math.min(Math.max(clean, 0), maxUsd());
  }

  function quoteFromUsd(usd) {
    const cleanUsd = clampUsd(usd);
    const rate = usdPerOst();
    const ostAmount = rate > 0 ? Math.floor((cleanUsd / rate) * 100) / 100 : 0;
    return { usd: cleanUsd, ostAmount, usdPerOst: rate };
  }

  function isLikelySolanaAddress(s) {
    return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(s || '').trim());
  }

  function getConnectedWallet() {
    if (window.OST_CONNECTED_WALLET) return window.OST_CONNECTED_WALLET;
    try {
      const btn = document.getElementById('walletBtn') || document.getElementById('walletButton');
      const txt = btn && btn.textContent ? btn.textContent.trim() : '';
      const m = txt.match(/[1-9A-HJ-NP-Za-km-z]{32,44}/);
      if (m) return m[0];
    } catch (_) {}
    return '';
  }

  function shortWallet(wallet) {
    return wallet ? wallet.slice(0, 5) + '...' + wallet.slice(-5) : 'Connect wallet';
  }

  function setStatus(elId, kind, msg) {
    const el = $(elId);
    if (!el) return;
    el.className = 'topup-status show ' + kind;
    el.innerHTML = msg;
  }

  function clearStatus(elId) {
    const el = $(elId);
    if (el) { el.className = 'topup-status'; el.textContent = ''; }
  }

  async function loadConfig() {
    if (configCache) return configCache;
    const base = API_BASE();
    if (!base) {
      configCache = { stripeEnabled: false, receivers: {}, pricing: { usdPerOst: DEFAULT_USD_PER_OST, solUsd: DEFAULT_SOL_USD } };
      return configCache;
    }
    try {
      const r = await fetch(`${base}/topup/config`);
      if (!r.ok) throw new Error('config_http_' + r.status);
      configCache = await r.json();
    } catch (_) {
      configCache = { stripeEnabled: false, receivers: {}, pricing: { usdPerOst: DEFAULT_USD_PER_OST, solUsd: DEFAULT_SOL_USD } };
    }
    return configCache;
  }

  function renderSection(host) {
    if (!host || host.dataset.topupRendered === '1') return;
    host.dataset.topupRendered = '1';
    host.innerHTML = `
      <div class="converter-shell">
        <div class="converter-head">
          <div>
            <p class="converter-kicker">Central command center</p>
            <h3>OST Converter Hub</h3>
            <p class="topup-sub">Buy, convert, transfer, and fill OST by exact value from one clean wallet rail.</p>
          </div>
          <div class="converter-wallet-card" aria-label="Wallet area and balance graph">
            <div class="converter-wallet-top">
              <span>Wallet</span>
              <strong id="converterWalletText">Connect wallet</strong>
            </div>
            <div class="converter-wallet-metric">
              <span>Exact quote</span>
              <strong id="converterWalletQuote">${fmtOst(currentQuote.ostAmount)}</strong>
            </div>
            <canvas class="converter-graph" id="converterWalletCurve" width="440" height="120" aria-label="OST wallet curve mirror" hidden style="display:none"></canvas>
          </div>
        </div>

        <div class="converter-tabs" role="tablist" aria-label="OST converter actions">
          <button type="button" class="converter-tab active" data-converter-tab="buy" id="converterTabBuy">Buy with Fiat</button>
          <button type="button" class="converter-tab" data-converter-tab="convert" id="converterTabConvert">Convert SOL</button>
          <button type="button" class="converter-tab" data-converter-tab="transfer" id="converterTabTransfer">Transfer</button>
        </div>

        <div class="converter-panel active" data-converter-panel="buy" id="converterPanelBuy">
          <div class="converter-quote-card">
            <label class="converter-amount-field" for="fiat-amount">
              <span>You Pay (USD)</span>
              <input type="number" id="fiat-amount" value="10" min="1" step="0.01" inputmode="decimal" autocomplete="off">
            </label>
            <div class="converter-receive-box">
              <span>You Receive</span>
              <strong id="ost-receive">${fmtOst(currentQuote.ostAmount)}</strong>
            </div>
          </div>
          <div class="converter-rate-row">
            <span>Rate: <strong id="ost-rate">1 OST = ${fmtUsd(currentQuote.usdPerOst)}</strong></span>
            <span id="converterLiveStatus">Live pricing loading...</span>
          </div>
          <div class="converter-suggested" id="converterSuggested"></div>
          <label class="converter-wallet-input" for="converterWalletInput">
            <span>Wallet to receive OST</span>
            <input type="text" id="converterWalletInput" placeholder="Paste your Solana wallet..." spellcheck="false" autocomplete="off">
          </label>
          <div class="converter-actions">
            <button type="button" class="converter-btn primary" id="converterCardBtn">Pay with Card</button>
            <button type="button" class="converter-btn secondary" id="converterCryptoBtn">Pay with Crypto</button>
          </div>
          <p class="topup-mission">100% of proceeds go directly to the <strong>OST Treasury</strong> (developer main holding) to build uncensored internet, satellite coverage, and zero-fee infrastructure. <strong>Thank you for supporting the mission!</strong></p>
          <div class="topup-status" id="converterBuyStatus"></div>
        </div>

        <div class="converter-panel" data-converter-panel="convert" id="converterPanelConvert">
          <div class="converter-direction" role="group" aria-label="Conversion direction">
            <button type="button" class="converter-pill active" data-direction="solToOst">SOL to OST</button>
            <button type="button" class="converter-pill" data-direction="ostToSol">OST to SOL</button>
          </div>
          <div class="converter-swap-card">
            <label for="sol-amount">
              <span id="converterSendLabel">You Send</span>
              <input type="number" id="sol-amount" value="0.5" min="0" step="0.01" inputmode="decimal" autocomplete="off">
              <em id="converterSendSymbol">SOL</em>
            </label>
            <div class="converter-arrow" aria-hidden="true">&rarr;</div>
            <div class="converter-output">
              <span>You Receive</span>
              <strong id="converted-ost">${fmtOst((0.5 * solUsd()) / currentQuote.usdPerOst)}</strong>
              <em id="converterReceiveSymbol">OST</em>
            </div>
          </div>
          <button type="button" class="converter-btn primary wide" id="converterSwapBtn">Prepare Conversion</button>
          <div class="topup-status" id="converterSwapStatus"></div>
        </div>

        <div class="converter-panel" data-converter-panel="transfer" id="converterPanelTransfer">
          <div class="converter-transfer-grid">
            <label for="converterTransferCurrency">
              <span>Currency</span>
              <select id="converterTransferCurrency">
                <option value="OST">OST</option>
                <option value="SOL">SOL</option>
                <option value="USDC">USDC</option>
              </select>
            </label>
            <label for="converterTransferAmount">
              <span>Amount</span>
              <input type="number" id="converterTransferAmount" min="0" step="0.01" inputmode="decimal" placeholder="0.00">
            </label>
          </div>
          <label class="converter-wallet-input" for="converterTransferRecipient">
            <span>Recipient wallet</span>
            <input type="text" id="converterTransferRecipient" placeholder="Paste recipient Solana address..." spellcheck="false" autocomplete="off">
          </label>
          <button type="button" class="converter-btn primary wide" id="converterTransferBtn">Prepare Transfer</button>
          <div class="topup-status" id="converterTransferStatus"></div>
        </div>
      </div>
    `;

    renderSuggestedButtons();
    bindSection();
    syncWalletUi();
    updateQuote();
    updateConversion();
    loadConfig().then(() => {
      updateQuote();
      updateConversion();
      setConverterLiveStatus();
    });
  }

  function renderSuggestedButtons() {
    const host = $('converterSuggested');
    if (!host) return;
    host.innerHTML = SUGGESTED_USD.map((usd) => `<button type="button" data-usd="${usd}">${fmtUsd(usd)}</button>`).join('');
  }

  function bindSection() {
    const fiat = $('fiat-amount');
    if (fiat) fiat.addEventListener('input', calculateOST);

    const sol = $('sol-amount');
    if (sol) sol.addEventListener('input', calculateConversion);

    document.querySelectorAll('[data-usd]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (fiat) fiat.value = btn.dataset.usd;
        calculateOST();
      });
    });

    document.querySelectorAll('[data-converter-tab]').forEach((btn) => {
      btn.addEventListener('click', () => switchConverterTab(btn.dataset.converterTab));
    });

    document.querySelectorAll('[data-direction]').forEach((btn) => {
      btn.addEventListener('click', () => {
        conversionDirection = btn.dataset.direction || 'solToOst';
        document.querySelectorAll('[data-direction]').forEach((el) => el.classList.toggle('active', el === btn));
        calculateConversion();
      });
    });

    const walletInput = $('converterWalletInput');
    if (walletInput) walletInput.addEventListener('input', () => { walletInput.dataset.userEdited = '1'; });

    const cardBtn = $('converterCardBtn');
    if (cardBtn) cardBtn.addEventListener('click', buyWithCard);
    const cryptoBtn = $('converterCryptoBtn');
    if (cryptoBtn) cryptoBtn.addEventListener('click', buyWithCrypto);
    const swapBtn = $('converterSwapBtn');
    if (swapBtn) swapBtn.addEventListener('click', convertSOLtoOST);
    const transferBtn = $('converterTransferBtn');
    if (transferBtn) transferBtn.addEventListener('click', prepareTransfer);
  }

  function setConverterLiveStatus() {
    const el = $('converterLiveStatus');
    if (!el) return;
    const pricing = configCache?.pricing || {};
    el.textContent = pricing.solUsd ? 'Live pricing from OST API' : 'Fallback price active';
  }

  function syncWalletUi() {
    const wallet = getConnectedWallet();
    const walletText = $('converterWalletText');
    if (walletText) walletText.textContent = shortWallet(wallet);
    const input = $('converterWalletInput');
    if (input && wallet && !input.dataset.userEdited) input.value = wallet;
    const modalWallet = $('topupWalletInput');
    if (modalWallet && wallet && !modalWallet.dataset.userEdited) modalWallet.value = wallet;
    const modalCryptoWallet = $('topupWalletInputCrypto');
    if (modalCryptoWallet && wallet && !modalCryptoWallet.dataset.userEdited) modalCryptoWallet.value = wallet;
  }

  function updateQuote() {
    const input = $('fiat-amount');
    const usd = input ? input.value : currentQuote.usd;
    currentQuote = quoteFromUsd(usd);
    const receive = $('ost-receive');
    const rate = $('ost-rate');
    const walletQuote = $('converterWalletQuote');
    if (receive) receive.textContent = fmtOst(currentQuote.ostAmount);
    if (rate) rate.textContent = `1 OST = ${fmtUsd(currentQuote.usdPerOst)}`;
    if (walletQuote) walletQuote.textContent = fmtOst(currentQuote.ostAmount);
    // Graph removed per product direction; keep stub call to preserve any external listeners.
    // drawGraph(currentQuote.ostAmount);
    updateModalSummary();
    return currentQuote;
  }

  function drawGraph(value) {
    var canvas = document.getElementById('converterWalletCurve');
    if (!canvas || !canvas.getContext) return;

    // Read the same snapshots that power the wallet curve in #wallet.
    var snapshots = [];
    try {
      var raw = localStorage.getItem('ost.wallet.balanceHistory.v1');
      if (raw) {
        var parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) snapshots = parsed;
      }
    } catch (_) { snapshots = []; }

    var prices = window.OST_PRICES || {};
    var ostUsd = Number(prices.ost) || Number(window.OST_PRICE_USD) || 0.0118;
    var solUsdLocal = Number(prices.solana) || 150;

    var points = snapshots
      .map(function (s) {
        if (!s) return null;
        var ost = Number(s.ostBalance || 0) || 0;
        var sol = Number(s.solBalance || 0) || 0;
        var v = ost * ostUsd + sol * solUsdLocal;
        return { ts: Number(s.ts) || 0, v: v, kind: s.kind || 'tick' };
      })
      .filter(function (p) { return p && Number.isFinite(p.v); });

    var ctx = canvas.getContext('2d');
    var rect = canvas.getBoundingClientRect();
    var width = Math.max(220, Math.round(rect.width || canvas.width || 440));
    var height = Math.max(80, Math.round(rect.height || canvas.height || 120));
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = 'rgba(5, 8, 14, 0.55)';
    ctx.fillRect(0, 0, width, height);

    var pad = { left: 10, right: 10, top: 10, bottom: 14 };

    if (!points.length) {
      // Synthetic wave that hints at the live curve experience.
      var base = Math.max(Number(value) || 1, 1);
      var synth = [];
      for (var i = 0; i < 18; i += 1) {
        var x = i / 17;
        var wave = Math.sin(i * 0.85) * 0.08;
        var slope = x * 0.18;
        synth.push(0.45 + slope + wave + Math.log10(base) * 0.02);
      }
      drawCurve(ctx, synth.map(function (v, idx) { return { ts: idx, v: v, kind: 'tick' }; }), width, height, pad, true);
      ctx.fillStyle = 'rgba(226,232,240,0.7)';
      ctx.font = '600 11px Inter, sans-serif';
      ctx.fillText('Connect a wallet for live ticks & transactions', pad.left + 4, height - 4);
      return;
    }

    drawCurve(ctx, points, width, height, pad, false);
  }

  function drawCurve(ctx, points, width, height, pad, isSynthetic) {
    var values = points.map(function (p) { return p.v; });
    var minVal = Math.min.apply(null, values);
    var maxVal = Math.max.apply(null, values);
    var range = Math.max(maxVal - minVal, Math.abs(maxVal) || 1, 0.0001);
    var first = values[0];
    var last = values[values.length - 1];
    var changePos = last >= first;
    var lineColor = changePos ? '#34d399' : '#f5c468';

    function xAt(i) { return pad.left + (i / Math.max(points.length - 1, 1)) * (width - pad.left - pad.right); }
    function yAt(v) { return pad.top + (height - pad.top - pad.bottom) - ((v - minVal) / range) * (height - pad.top - pad.bottom); }

    // Gridlines
    [0.25, 0.5, 0.75].forEach(function (level) {
      var yLine = pad.top + (height - pad.top - pad.bottom) * level;
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(pad.left, yLine);
      ctx.lineTo(width - pad.right, yLine);
      ctx.stroke();
    });

    // Fill
    var fill = ctx.createLinearGradient(0, pad.top, 0, height - pad.bottom);
    fill.addColorStop(0, changePos ? 'rgba(52,211,153,0.32)' : 'rgba(245,196,104,0.32)');
    fill.addColorStop(1, 'rgba(109,159,255,0.02)');
    ctx.beginPath();
    points.forEach(function (p, i) {
      var x = xAt(i), y = yAt(p.v);
      if (!i) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.lineTo(xAt(points.length - 1), height - pad.bottom);
    ctx.lineTo(xAt(0), height - pad.bottom);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();

    // Line
    ctx.beginPath();
    points.forEach(function (p, i) {
      var x = xAt(i), y = yAt(p.v);
      if (!i) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.lineWidth = 2;
    ctx.strokeStyle = lineColor;
    ctx.stroke();

    if (isSynthetic) return;

    // Tick + transaction dots
    points.forEach(function (p, i) {
      var x = xAt(i), y = yAt(p.v);
      if (p.kind && p.kind !== 'tick') {
        ctx.beginPath();
        ctx.arc(x, y, 3.5, 0, Math.PI * 2);
        ctx.fillStyle = '#f8fafc';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(x, y, 2, 0, Math.PI * 2);
        ctx.fillStyle = lineColor;
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.arc(x, y, 1.2, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(248,250,252,0.55)';
        ctx.fill();
      }
    });

    // End marker
    var lx = xAt(points.length - 1), ly = yAt(last);
    ctx.beginPath();
    ctx.arc(lx, ly, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#f8fafc';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(lx, ly, 2.4, 0, Math.PI * 2);
    ctx.fillStyle = lineColor;
    ctx.fill();
  }

  // Re-draw the converter wallet curve whenever wallet activity updates.
  if (typeof window !== 'undefined' && !window.__ostConverterCurveBound) {
    window.__ostConverterCurveBound = true;
    window.addEventListener('ost-tx-history-update', function () {
      try { drawGraph(currentQuote && currentQuote.ostAmount); } catch (_) {}
    });
  }

  function calculateOST() {
    updateQuote();
    clearStatus('converterBuyStatus');
  }

  function calculateConversion() {
    updateConversion();
    clearStatus('converterSwapStatus');
  }

  function updateConversion() {
    const input = $('sol-amount');
    const amount = numberFrom(input && input.value, 0);
    const rate = usdPerOst();
    const solPrice = solUsd();
    const sendSymbol = $('converterSendSymbol');
    const receiveSymbol = $('converterReceiveSymbol');
    const out = $('converted-ost');
    if (!out) return;
    if (conversionDirection === 'ostToSol') {
      const solOut = solPrice > 0 ? (amount * rate) / solPrice : 0;
      if (sendSymbol) sendSymbol.textContent = 'OST';
      if (receiveSymbol) receiveSymbol.textContent = 'SOL';
      out.textContent = fmtSol(solOut);
    } else {
      const liveQuote = window.OST_REAL_SWAP && typeof window.OST_REAL_SWAP.quote === 'function'
        ? window.OST_REAL_SWAP.quote(amount)
        : null;
      const ostOut = liveQuote && Number.isFinite(liveQuote.ost) ? liveQuote.ost : (rate > 0 ? (amount * solPrice) / rate : 0);
      if (sendSymbol) sendSymbol.textContent = 'SOL';
      if (receiveSymbol) receiveSymbol.textContent = 'OST';
      out.textContent = fmtOst(ostOut);
    }
  }

  function switchConverterTab(tabName) {
    activeConverterTab = typeof tabName === 'number'
      ? ['buy', 'convert', 'transfer'][tabName] || 'buy'
      : (tabName || 'buy');
    document.querySelectorAll('[data-converter-panel]').forEach((panel) => {
      panel.classList.toggle('active', panel.dataset.converterPanel === activeConverterTab);
    });
    document.querySelectorAll('[data-converter-tab]').forEach((tab) => {
      tab.classList.toggle('active', tab.dataset.converterTab === activeConverterTab);
    });
  }

  function ensureMinUsd() {
    const q = updateQuote();
    if (q.usd < minUsd()) {
      setStatus('converterBuyStatus', 'warn', `Minimum purchase is ${fmtUsd(minUsd())}.`);
      return false;
    }
    if (q.usd > maxUsd()) {
      setStatus('converterBuyStatus', 'warn', `Maximum purchase is ${fmtUsd(maxUsd())}.`);
      return false;
    }
    return true;
  }

  function buyWithCard() {
    if (!ensureMinUsd()) return;
    openModal('card');
  }

  function buyWithCrypto() {
    if (!ensureMinUsd()) return;
    openModal('crypto');
  }

  async function convertSOLtoOST() {
    const amount = numberFrom($('sol-amount')?.value, 0);
    const btn = $('converterSwapBtn');
    if (amount <= 0) {
      setStatus('converterSwapStatus', 'error', 'Enter an amount to convert first.');
      return;
    }
    if (conversionDirection !== 'solToOst') {
      setStatus('converterSwapStatus', 'warn', 'OST to SOL cash-out is not available in the devnet converter yet. Use the transfer rail or sell routes for exits.');
      return;
    }
    if (!window.OST_WALLET || !window.OST_WALLET.session || !window.OST_WALLET.session.publicKey) {
      setStatus('converterSwapStatus', 'error', 'Create or connect a wallet before converting devnet SOL to OST.');
      return;
    }
    const originalText = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = 'Converting...'; }
    try {
      const swapRail = await waitForSwapRail();
      if (!swapRail || typeof swapRail.swapAny !== 'function') throw new Error('OST devnet swap rail is still loading. Refresh and try again.');
      if (!window.OST_RESCUE || typeof window.OST_RESCUE.ensureUserAta !== 'function') throw new Error('OST fee vault is still loading. Please wait a moment and try again.');
      const quote = typeof swapRail.quote === 'function' ? swapRail.quote(amount) : null;
      setStatus('converterSwapStatus', 'info', 'Converting ' + fmtSol(amount) + ' into ' + fmtOst(quote && quote.ost) + ' on devnet...');
      const memo = JSON.stringify({ k: 'converter-sol-to-ost', sol: amount, t: Date.now() });
      const result = await swapRail.swapAny('SOL', amount, { memo });
      const sig = result && result.sig ? String(result.sig) : '';
      setStatus('converterSwapStatus', 'ok', 'Converted ' + fmtSol(amount) + ' into ' + fmtOst(result && result.ost) + '. ' +
        (sig ? '<a href="https://solscan.io/tx/' + encodeURIComponent(sig) + '?cluster=devnet" target="_blank" rel="noopener">View tx</a>' : ''));
      try { window.dispatchEvent(new CustomEvent('ost:wallet-changed')); } catch (_) {}
      try { window.dispatchEvent(new CustomEvent('ost:converter-swap-complete', { detail: result || {} })); } catch (_) {}
      if (typeof window.syncOstWalletEventsFromRemote === 'function') window.syncOstWalletEventsFromRemote();
      updateConversion();
    } catch (error) {
      setStatus('converterSwapStatus', 'error', String(error && error.message || error || 'SOL to OST conversion failed.'));
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = originalText || 'Prepare Conversion'; }
    }
  }

  function prepareTransfer() {
    const currency = $('converterTransferCurrency')?.value || 'OST';
    const amount = numberFrom($('converterTransferAmount')?.value, 0);
    const recipient = ($('converterTransferRecipient')?.value || '').trim();
    if (amount <= 0) {
      setStatus('converterTransferStatus', 'error', 'Enter an amount to send first.');
      return;
    }
    if (!isLikelySolanaAddress(recipient)) {
      setStatus('converterTransferStatus', 'error', 'Paste a valid Solana recipient address.');
      return;
    }
    window.dispatchEvent(new CustomEvent('ost:converter-transfer-prepared', { detail: { currency, amount, recipient } }));
    setStatus('converterTransferStatus', 'ok', `${currency} transfer prepared for ${shortWallet(recipient)}.`);
  }

  window.calculateOST = calculateOST;
  window.calculateConversion = calculateConversion;
  window.switchConverterTab = switchConverterTab;
  window.buyWithCard = buyWithCard;
  window.buyWithCrypto = buyWithCrypto;
  window.convertSOLtoOST = convertSOLtoOST;
  window.selectTopUp = (usd) => {
    const input = $('fiat-amount');
    if (input) input.value = Number(usd || 10).toFixed(2);
    calculateOST();
    openModal('card');
  };
  window.openTopUpModal = () => openModal('card');

  function ensureModal() {
    if ($('topupModalOverlay')) return;
    const overlay = document.createElement('div');
    overlay.className = 'topup-modal-overlay';
    overlay.id = 'topupModalOverlay';
    overlay.innerHTML = `
      <div class="topup-modal" role="dialog" aria-modal="true" aria-labelledby="topupModalTitle">
        <button class="topup-modal-close" id="topupModalClose" aria-label="Close">&times;</button>
        <h4 id="topupModalTitle">OST Converter Hub</h4>
        <p class="topup-modal-sub" id="topupModalSub">Exact-value refill. Real funds go to the OST Treasury; devnet OST is delivered to your wallet.</p>
        <div class="topup-summary" id="topupSummary"></div>
        <div class="topup-tabs">
          <button class="topup-tab active" data-pane="card" id="topupTabCard">Card</button>
          <button class="topup-tab" data-pane="crypto" id="topupTabCrypto">Crypto</button>
        </div>
        <div class="topup-pane active" data-pane="card">
          <div class="topup-field">
            <label for="topupWalletInput">Devnet wallet to receive OST</label>
            <input type="text" id="topupWalletInput" placeholder="Paste your Solana address..." spellcheck="false" autocomplete="off">
            <div class="topup-hint">Auto-filled from your connected wallet. Edit to deliver to a different address.</div>
          </div>
          <button class="topup-action" id="topupCardBtn">Pay with Card via Stripe</button>
          <div class="topup-status" id="topupCardStatus"></div>
        </div>
        <div class="topup-pane" data-pane="crypto">
          <div class="topup-field">
            <label for="topupWalletInputCrypto">Devnet wallet to receive OST</label>
            <input type="text" id="topupWalletInputCrypto" placeholder="Paste your Solana address..." spellcheck="false" autocomplete="off">
          </div>
          <button class="topup-action secondary" id="topupCryptoStartBtn">Show Treasury Address &amp; Memo</button>
          <div id="topupCryptoCards" style="display:none; margin-top:14px;">
            <div class="topup-crypto-card">
              <div class="topup-crypto-row">
                <div>
                  <div class="topup-crypto-label">USDC - Solana network</div>
                  <div class="topup-crypto-value" id="topupUsdcAddr">&mdash;</div>
                </div>
                <button class="topup-copy-btn" data-copy="topupUsdcAddr">Copy</button>
              </div>
              <div class="topup-crypto-row">
                <div>
                  <div class="topup-crypto-label">SOL - Solana network</div>
                  <div class="topup-crypto-value" id="topupSolAddr">&mdash;</div>
                </div>
                <button class="topup-copy-btn" data-copy="topupSolAddr">Copy</button>
              </div>
              <div class="topup-crypto-row">
                <div>
                  <div class="topup-crypto-label">Required memo</div>
                  <div class="topup-crypto-value" id="topupMemo">&mdash;</div>
                </div>
                <button class="topup-copy-btn" data-copy="topupMemo">Copy</button>
              </div>
            </div>
            <div class="topup-status info show" id="topupCryptoNote"></div>
            <div class="topup-field topup-signature-field">
              <label for="topupPaymentSigInput">Payment transaction signature</label>
              <input type="text" id="topupPaymentSigInput" placeholder="Paste Solana payment signature..." spellcheck="false" autocomplete="off">
              <div class="topup-hint">The Worker verifies the signature, treasury receiver, memo, and amount before dispatch.</div>
            </div>
            <button class="topup-action" id="topupVerifyPaymentBtn" disabled>Verify Payment &amp; Queue OST</button>
          </div>
          <div class="topup-status" id="topupCryptoStatus"></div>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
    $('topupModalClose').addEventListener('click', closeModal);
    overlay.querySelectorAll('.topup-tab').forEach((tab) => tab.addEventListener('click', () => switchPane(tab.dataset.pane)));
    overlay.querySelectorAll('input[type="text"]').forEach((inp) => inp.addEventListener('input', () => { inp.dataset.userEdited = '1'; }));
    overlay.querySelectorAll('[data-copy]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const target = $(btn.dataset.copy);
        const txt = target ? target.textContent.trim() : '';
        if (!txt || txt === '-') return;
        try { navigator.clipboard.writeText(txt); } catch (_) {}
        const orig = btn.textContent;
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = orig; }, 1200);
      });
    });
    $('topupCardBtn').addEventListener('click', startStripeCheckout);
    $('topupCryptoStartBtn').addEventListener('click', startCryptoIntent);
    $('topupVerifyPaymentBtn').addEventListener('click', verifyCryptoPayment);
  }

  function switchPane(name) {
    document.querySelectorAll('#topupModalOverlay .topup-tab').forEach((t) => t.classList.toggle('active', t.dataset.pane === name));
    document.querySelectorAll('#topupModalOverlay .topup-pane').forEach((p) => p.classList.toggle('active', p.dataset.pane === name));
  }

  async function openModal(preferredPane) {
    if (!ensureMinUsd()) return;
    ensureModal();
    syncWalletUi();
    const wallet = ($('converterWalletInput')?.value || getConnectedWallet() || '').trim();
    const w1 = $('topupWalletInput');
    const w2 = $('topupWalletInputCrypto');
    if (w1 && !w1.dataset.userEdited) w1.value = wallet;
    if (w2 && !w2.dataset.userEdited) w2.value = wallet;
    $('topupCryptoCards').style.display = 'none';
    activeCryptoIntent = null;
    const sigInput = $('topupPaymentSigInput');
    const verifyBtn = $('topupVerifyPaymentBtn');
    if (sigInput) sigInput.value = '';
    if (verifyBtn) { verifyBtn.disabled = true; delete verifyBtn.dataset.intentId; }
    clearStatus('topupCardStatus');
    clearStatus('topupCryptoStatus');
    updateModalSummary();

    const cfg = await loadConfig();
    const cardBtn = $('topupCardBtn');
    if (!cfg.stripeEnabled) {
      cardBtn.disabled = true;
      setStatus('topupCardStatus', 'warn', 'Card payments open soon. Use the <strong>Crypto</strong> tab for instant top-up today.');
      switchPane('crypto');
    } else {
      cardBtn.disabled = false;
      switchPane(preferredPane || 'card');
    }
    if (preferredPane === 'crypto') switchPane('crypto');
    $('topupModalOverlay').classList.add('open');
  }

  function updateModalSummary() {
    const summary = $('topupSummary');
    if (!summary) return;
    const q = updateQuoteSilently();
    summary.innerHTML = `
      <div class="topup-summary-row"><span>You pay</span><span>${fmtUsd(q.usd)}</span></div>
      <div class="topup-summary-row"><span>Rate</span><span>1 OST = ${fmtUsd(q.usdPerOst)}</span></div>
      <div class="topup-summary-row total"><span>You receive</span><span>${fmtOst(q.ostAmount)}</span></div>`;
    const note = $('topupCryptoNote');
    if (note) note.textContent = `Send ${fmtUsd(q.usd)} in USDC, or the live SOL equivalent, and include the memo. Devnet OST dispatch starts after verification.`;
  }

  function updateQuoteSilently() {
    const input = $('fiat-amount');
    currentQuote = quoteFromUsd(input ? input.value : currentQuote.usd);
    return currentQuote;
  }

  function closeModal() {
    const o = $('topupModalOverlay');
    if (o) o.classList.remove('open');
    activeCryptoIntent = null;
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }
  window.closeTopUpModal = closeModal;

  async function createIntent(method, wallet) {
    const base = API_BASE();
    if (!base) throw new Error('API base not configured');
    const q = updateQuoteSilently();
    const r = await fetch(`${base}/topup/intent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ usd: q.usd, ostAmount: q.ostAmount, wallet, method })
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      throw new Error('intent_failed: ' + (txt || r.status));
    }
    return r.json();
  }

  async function startStripeCheckout() {
    const wallet = ($('topupWalletInput').value || '').trim();
    if (!isLikelySolanaAddress(wallet)) {
      setStatus('topupCardStatus', 'error', 'Enter a valid Solana wallet address first.');
      return;
    }
    const btn = $('topupCardBtn');
    btn.disabled = true;
    setStatus('topupCardStatus', 'info', 'Creating secure Stripe session...');
    try {
      const intent = await createIntent('stripe', wallet);
      const base = API_BASE();
      const r = await fetch(`${base}/topup/checkout`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ intentId: intent.id })
      });
      if (!r.ok) {
        const txt = await r.text().catch(() => '');
        throw new Error('checkout_failed: ' + (txt || r.status));
      }
      const { url } = await r.json();
      if (!url) throw new Error('no_checkout_url');
      try { sessionStorage.setItem('ostTopupIntent', intent.id); } catch (_) {}
      window.location.href = url;
    } catch (e) {
      setStatus('topupCardStatus', 'error', String(e && e.message || e));
      btn.disabled = false;
    }
  }

  async function startCryptoIntent() {
    const wallet = ($('topupWalletInputCrypto').value || '').trim();
    if (!isLikelySolanaAddress(wallet)) {
      setStatus('topupCryptoStatus', 'error', 'Enter a valid Solana wallet address first.');
      return;
    }
    const btn = $('topupCryptoStartBtn');
    btn.disabled = true;
    clearStatus('topupCryptoStatus');
    try {
      const cfg = await loadConfig();
      const intent = await createIntent('crypto', wallet);
      const useMainnet = normalizeClusterName(cfg && cfg.cluster) === 'mainnet';
      const usdc = useMainnet
        ? ((cfg.receivers && (cfg.receivers.usdcMainnet || cfg.receivers.usdcDevnet)) || 'Treasury address not configured')
        : ((cfg.receivers && (cfg.receivers.usdcDevnet || cfg.receivers.usdcMainnet)) || 'Treasury address not configured');
      const sol = useMainnet
        ? ((cfg.receivers && (cfg.receivers.solMainnet || cfg.receivers.solDevnet)) || 'Treasury address not configured')
        : ((cfg.receivers && (cfg.receivers.solDevnet || cfg.receivers.solMainnet)) || 'Treasury address not configured');
      $('topupUsdcAddr').textContent = usdc;
      $('topupSolAddr').textContent = sol;
      $('topupMemo').textContent = intent.memo || intent.id;
      $('topupCryptoCards').style.display = 'block';
      activeCryptoIntent = intent.id;
      const verifyBtn = $('topupVerifyPaymentBtn');
      if (verifyBtn) { verifyBtn.disabled = false; verifyBtn.dataset.intentId = intent.id; }
      try { sessionStorage.setItem('ostTopupIntent', intent.id); } catch (_) {}
      setStatus('topupCryptoStatus', 'info', `Payment lane open for ${fmtUsd(intent.usd || currentQuote.usd)}. Send SOL or USDC with the memo; OST dispatch starts after verification.`);
      pollIntent(intent.id, 'topupCryptoStatus', { crypto: true });
    } catch (e) {
      setStatus('topupCryptoStatus', 'error', String(e && e.message || e));
    } finally {
      btn.disabled = false;
    }
  }

  async function verifyCryptoPayment() {
    const btn = $('topupVerifyPaymentBtn');
    const input = $('topupPaymentSigInput');
    const intentId = (btn && btn.dataset.intentId) || activeCryptoIntent || '';
    const signature = (input && input.value || '').trim();
    if (!intentId) {
      setStatus('topupCryptoStatus', 'error', 'Create a crypto payment lane first.');
      return;
    }
    if (!signature) {
      setStatus('topupCryptoStatus', 'error', 'Paste the Solana payment signature first.');
      return;
    }
    const base = API_BASE();
    if (!base) {
      setStatus('topupCryptoStatus', 'error', 'API base not configured.');
      return;
    }
    btn.disabled = true;
    let cfg = null;
    try { cfg = await loadConfig(); } catch (_) { cfg = null; }
    setStatus('topupCryptoStatus', 'info', 'Verifying payment on ' + clusterLabel(cfg) + '...');
    try {
      const r = await fetch(`${base}/topup/crypto/verify`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ intentId, signature })
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.error) throw new Error(j.error || ('verify_http_' + r.status));
      setStatus('topupCryptoStatus', 'ok', 'Payment verified! Devnet OST dispatch is queued.');
      pollIntent(intentId, 'topupCryptoStatus', { crypto: true });
    } catch (e) {
      setStatus('topupCryptoStatus', 'error', String(e && e.message || e));
      btn.disabled = false;
    }
  }

  function pollIntent(id, statusElId, opts) {
    opts = opts || {};
    const base = API_BASE();
    if (!base) return;
    if (pollTimer) clearInterval(pollTimer);
    let tries = 0;
    pollTimer = setInterval(async () => {
      tries++;
      if (tries > 360) { clearInterval(pollTimer); pollTimer = null; return; }
      try {
        if (opts.crypto && tries % 3 === 1) {
          await fetch(`${base}/topup/crypto/check/${encodeURIComponent(id)}`).catch(() => null);
        }
        const r = await fetch(`${base}/topup/status/${encodeURIComponent(id)}`);
        if (!r.ok) return;
        const j = await r.json();
        if (j.status === 'sent') {
          clearInterval(pollTimer);
          pollTimer = null;
          setStatus(statusElId, 'ok', `Delivered ${fmtOst(j.ostAmount || currentQuote.ostAmount)}! ` +
            (j.signature ? `<a href="https://solscan.io/tx/${j.signature}?cluster=devnet" target="_blank" rel="noopener">View tx</a>` : ''));
          window.dispatchEvent(new CustomEvent('ost:topup-delivered', { detail: j }));
        } else if (j.status === 'paid') {
          setStatus(statusElId, 'info', 'Payment received! Sending devnet OST...');
        }
      } catch (_) {}
    }, 5000);
  }

  function handleSuccessRedirect() {
    try {
      const u = new URL(window.location.href);
      const status = u.searchParams.get('topup');
      const intent = u.searchParams.get('intent') || (sessionStorage.getItem('ostTopupIntent') || '');
      if (!status) return;
      if (status === 'success' && intent) {
        try { if (typeof window.toast === 'function') window.toast('OK', 'Returned from checkout. Verifying payment before OST delivery.'); } catch (_) {}
        ensureModal();
        $('topupModalOverlay').classList.add('open');
        switchPane('card');
        setStatus('topupCardStatus', 'info', 'Returned from checkout. Waiting for verified payment confirmation...');
        pollIntent(intent, 'topupCardStatus');
      }
      u.searchParams.delete('topup');
      u.searchParams.delete('intent');
      window.history.replaceState({}, '', u.toString());
    } catch (_) {}
  }

  function mount() {
    const host = document.getElementById('converter-hub') || document.getElementById('topup-section');
    if (host) renderSection(host);
    handleSuccessRedirect();
  }

  window.addEventListener('ost:wallet-changed', syncWalletUi);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})();
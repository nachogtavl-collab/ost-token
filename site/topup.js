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
            <svg class="converter-graph" id="converterGraph" viewBox="0 0 220 64" role="img" aria-label="OST wallet graph">
              <path class="converter-graph-fill" id="converterGraphFill" d=""></path>
              <polyline class="converter-graph-line" id="converterGraphLine" points=""></polyline>
            </svg>
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
    drawGraph(currentQuote.ostAmount);
    updateModalSummary();
    return currentQuote;
  }

  function drawGraph(value) {
    const line = $('converterGraphLine');
    const fill = $('converterGraphFill');
    if (!line || !fill) return;
    const base = Math.max(Number(value) || 1, 1);
    const points = Array.from({ length: 12 }, (_, i) => {
      const x = (i / 11) * 220;
      const wave = Math.sin(i * 0.85) * 6;
      const slope = (i / 11) * 18;
      const y = 54 - Math.min(42, 10 + slope + wave + Math.log10(base) * 4);
      return [x.toFixed(1), Math.max(8, y).toFixed(1)];
    });
    const pointString = points.map((p) => p.join(',')).join(' ');
    line.setAttribute('points', pointString);
    fill.setAttribute('d', 'M ' + pointString.replace(/ /g, ' L ') + ' L 220 64 L 0 64 Z');
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
      const ostOut = rate > 0 ? (amount * solPrice) / rate : 0;
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

  function convertSOLtoOST() {
    const amount = numberFrom($('sol-amount')?.value, 0);
    if (amount <= 0) {
      setStatus('converterSwapStatus', 'error', 'Enter an amount to convert first.');
      return;
    }
    setStatus('converterSwapStatus', 'info', 'Conversion quote prepared. Use the connected wallet rail or Jupiter route to execute the swap.');
    try {
      document.querySelector('[data-wallet-tab="convert"]')?.click();
    } catch (_) {}
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
                  <div class="topup-crypto-label">USDC - Solana mainnet</div>
                  <div class="topup-crypto-value" id="topupUsdcAddr">&mdash;</div>
                </div>
                <button class="topup-copy-btn" data-copy="topupUsdcAddr">Copy</button>
              </div>
              <div class="topup-crypto-row">
                <div>
                  <div class="topup-crypto-label">SOL - Solana mainnet</div>
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
      const usdc = (cfg.receivers && cfg.receivers.usdcMainnet) || 'Treasury address not configured';
      const sol = (cfg.receivers && cfg.receivers.solMainnet) || 'Treasury address not configured';
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
    setStatus('topupCryptoStatus', 'info', 'Verifying payment on Solana mainnet...');
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
        try { if (typeof window.toast === 'function') window.toast('OK', 'Payment received! Devnet OST is on its way.'); } catch (_) {}
        ensureModal();
        $('topupModalOverlay').classList.add('open');
        switchPane('card');
        setStatus('topupCardStatus', 'info', 'Payment received! Waiting for devnet OST delivery...');
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
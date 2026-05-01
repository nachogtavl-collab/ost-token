/* ============================================================
 * OST Top-Up — front-end controller
 * ============================================================
 * Renders tier cards + modal, talks to the ost-api worker:
 *   GET  /topup/config              tiers + receivers + stripeEnabled
 *   POST /topup/intent              create intent {tier, wallet, method}
 *   POST /topup/checkout            create Stripe Checkout session for intent
 *   GET  /topup/status/:id          poll until status === 'sent'
 *
 * The Stripe path is feature-flagged by the worker. If Stripe is not
 * configured the modal automatically falls back to the crypto pane
 * (USDC / SOL on mainnet -> treasury wallet, with a unique memo).
 * ============================================================ */
(function () {
  'use strict';

  const TIERS = [
    { id: 5,  usd: 5,  base: 1000,  bonus: 200,  total: 1200 },
    { id: 10, usd: 10, base: 2500,  bonus: 500,  total: 3000, recommended: true },
    { id: 25, usd: 25, base: 7000,  bonus: 2000, total: 9000 },
    { id: 50, usd: 50, base: 15000, bonus: 5000, total: 20000 }
  ];

  const API_BASE = () => (window.OST_TOPUP_API || window.OST_API_BASE || '').replace(/\/+$/, '');

  let selectedTier = null;
  let configCache  = null;
  let pollTimer    = null;

  // ---------- DOM helpers ----------
  const $ = (id) => document.getElementById(id);

  function fmtOst(n) {
    return Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 }) + ' OST';
  }

  function getConnectedWallet() {
    // Best-effort: the main app keeps `connectedWallet` in closure scope.
    // We expose a hook on the wallet-changed event below; otherwise read
    // the wallet button label which always shows the address when connected.
    if (window.OST_CONNECTED_WALLET) return window.OST_CONNECTED_WALLET;
    try {
      const btn = document.getElementById('walletBtn') || document.getElementById('walletButton');
      const txt = btn && btn.textContent ? btn.textContent.trim() : '';
      const m = txt.match(/[1-9A-HJ-NP-Za-km-z]{32,44}/);
      if (m) return m[0];
    } catch (_) {}
    return '';
  }

  window.addEventListener('ost:wallet-changed', () => {
    // Keep the modal's wallet field in sync.
    const input = $('topupWalletInput');
    if (input && !input.dataset.userEdited) input.value = getConnectedWallet();
  });

  // ---------- Render the section ----------
  function renderSection(host) {
    if (!host || host.dataset.topupRendered === '1') return;
    host.dataset.topupRendered = '1';
    host.innerHTML = `
      <h3>&#128176; Keep Playing &mdash; Top Up Real OST</h3>
      <p class="topup-sub">
        Out of free faucet OST? Refill instantly with a card or crypto.
        Devnet OST lands in your wallet within seconds &mdash; ready for predictions, games and on-chain experiments.
      </p>
      <div class="topup-tier-grid" id="topupTierGrid"></div>
      <button class="topup-cta" id="topupCtaBtn" disabled>
        <span>&#10004;</span> <span>Pay &amp; Receive OST Instantly</span>
      </button>
      <p class="topup-mission">
        100% of proceeds go directly to the <strong>OST Treasury</strong> (developer main holding) to build
        uncensored internet, satellite coverage and zero-fee infrastructure.
        <strong>Thank you for supporting the mission!</strong>
      </p>
    `;

    const grid = $('topupTierGrid');
    grid.innerHTML = TIERS.map(t => `
      <div class="topup-tier${t.recommended ? ' recommended' : ''}" data-tier="${t.id}">
        <div class="topup-tier-price">$${t.usd}</div>
        <div class="topup-tier-base">${t.base.toLocaleString()} OST</div>
        <div class="topup-tier-bonus">+ ${t.bonus.toLocaleString()} bonus</div>
        <div class="topup-tier-total">${fmtOst(t.total)} <small>total</small></div>
      </div>
    `).join('');

    grid.querySelectorAll('.topup-tier').forEach(card => {
      card.addEventListener('click', () => {
        const tierId = Number(card.dataset.tier);
        selectTier(tierId);
      });
    });

    $('topupCtaBtn').addEventListener('click', () => {
      if (selectedTier) openModal();
    });
  }

  function selectTier(id) {
    selectedTier = TIERS.find(t => t.id === id) || null;
    document.querySelectorAll('.topup-tier').forEach(el => {
      el.classList.toggle('selected', Number(el.dataset.tier) === id);
    });
    const cta = $('topupCtaBtn');
    if (cta) {
      cta.disabled = !selectedTier;
      if (selectedTier) {
        cta.querySelector('span:last-child').textContent =
          `Pay $${selectedTier.usd} → Receive ${fmtOst(selectedTier.total)}`;
      }
    }
  }

  // Public alias matching the user's original spec
  window.selectTopUp = (usd /*, total */) => {
    const tier = TIERS.find(t => t.usd === Number(usd));
    if (tier) { selectTier(tier.id); openModal(); }
  };
  window.openTopUpModal = openModal;

  // ---------- Modal ----------
  function ensureModal() {
    if ($('topupModalOverlay')) return;
    const overlay = document.createElement('div');
    overlay.className = 'topup-modal-overlay';
    overlay.id = 'topupModalOverlay';
    overlay.innerHTML = `
      <div class="topup-modal" role="dialog" aria-modal="true" aria-labelledby="topupModalTitle">
        <button class="topup-modal-close" id="topupModalClose" aria-label="Close">&times;</button>
        <h4 id="topupModalTitle">Top Up OST</h4>
        <p class="topup-modal-sub" id="topupModalSub">Real funds go to the OST Treasury &middot; devnet OST is delivered to your wallet.</p>

        <div class="topup-summary" id="topupSummary"></div>

        <div class="topup-tabs">
          <button class="topup-tab active" data-pane="card" id="topupTabCard">&#128179; Card</button>
          <button class="topup-tab" data-pane="crypto" id="topupTabCrypto">&#128184; Crypto</button>
        </div>

        <!-- Card pane -->
        <div class="topup-pane active" data-pane="card">
          <div class="topup-field">
            <label for="topupWalletInput">Devnet wallet to receive OST</label>
            <input type="text" id="topupWalletInput" placeholder="Paste your Solana address..." spellcheck="false" autocomplete="off">
            <div class="topup-hint">Auto-filled from your connected wallet. Edit to deliver to a different address.</div>
          </div>
          <button class="topup-action" id="topupCardBtn">Pay with Card &rarr; Stripe</button>
          <div class="topup-status" id="topupCardStatus"></div>
        </div>

        <!-- Crypto pane -->
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
                  <div class="topup-crypto-label">USDC &middot; Solana mainnet</div>
                  <div class="topup-crypto-value" id="topupUsdcAddr">&mdash;</div>
                </div>
                <button class="topup-copy-btn" data-copy="topupUsdcAddr">Copy</button>
              </div>
              <div class="topup-crypto-row">
                <div>
                  <div class="topup-crypto-label">SOL &middot; Solana mainnet</div>
                  <div class="topup-crypto-value" id="topupSolAddr">&mdash;</div>
                </div>
                <button class="topup-copy-btn" data-copy="topupSolAddr">Copy</button>
              </div>
              <div class="topup-crypto-row">
                <div>
                  <div class="topup-crypto-label">Required memo (links payment to your wallet)</div>
                  <div class="topup-crypto-value" id="topupMemo">&mdash;</div>
                </div>
                <button class="topup-copy-btn" data-copy="topupMemo">Copy</button>
              </div>
            </div>
            <div class="topup-status info show" id="topupCryptoNote">
              Send the exact USD-equivalent amount and include the memo. Devnet OST is released after the on-chain payment is confirmed.
            </div>
          </div>
          <div class="topup-status" id="topupCryptoStatus"></div>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
    $('topupModalClose').addEventListener('click', closeModal);

    overlay.querySelectorAll('.topup-tab').forEach(tab => {
      tab.addEventListener('click', () => switchPane(tab.dataset.pane));
    });

    overlay.querySelectorAll('input[type="text"]').forEach(inp => {
      inp.addEventListener('input', () => { inp.dataset.userEdited = '1'; });
    });

    overlay.querySelectorAll('[data-copy]').forEach(btn => {
      btn.addEventListener('click', () => {
        const target = $(btn.dataset.copy);
        if (!target) return;
        const txt = target.textContent.trim();
        if (!txt || txt === '—') return;
        try { navigator.clipboard.writeText(txt); } catch (_) {}
        const orig = btn.textContent;
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = orig; }, 1200);
      });
    });

    $('topupCardBtn').addEventListener('click', startStripeCheckout);
    $('topupCryptoStartBtn').addEventListener('click', startCryptoIntent);
  }

  function switchPane(name) {
    document.querySelectorAll('#topupModalOverlay .topup-tab').forEach(t =>
      t.classList.toggle('active', t.dataset.pane === name));
    document.querySelectorAll('#topupModalOverlay .topup-pane').forEach(p =>
      p.classList.toggle('active', p.dataset.pane === name));
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
    if (!base) return (configCache = { stripeEnabled: false, receivers: {}, mission: '' });
    try {
      const r = await fetch(`${base}/topup/config`);
      if (!r.ok) throw new Error('config_http_' + r.status);
      configCache = await r.json();
    } catch (_) {
      configCache = { stripeEnabled: false, receivers: {}, mission: '' };
    }
    return configCache;
  }

  async function openModal() {
    if (!selectedTier) return;
    ensureModal();
    const wallet = getConnectedWallet();
    const w1 = $('topupWalletInput'); const w2 = $('topupWalletInputCrypto');
    if (w1) { w1.value = wallet; delete w1.dataset.userEdited; }
    if (w2) { w2.value = wallet; delete w2.dataset.userEdited; }
    $('topupSummary').innerHTML = `
      <div class="topup-summary-row"><span>Tier</span><span>$${selectedTier.usd}</span></div>
      <div class="topup-summary-row"><span>Base OST</span><span>${selectedTier.base.toLocaleString()}</span></div>
      <div class="topup-summary-row"><span>Bonus OST</span><span>+ ${selectedTier.bonus.toLocaleString()}</span></div>
      <div class="topup-summary-row total"><span>You receive</span><span>${fmtOst(selectedTier.total)}</span></div>`;
    $('topupCryptoCards').style.display = 'none';
    clearStatus('topupCardStatus'); clearStatus('topupCryptoStatus');

    const cfg = await loadConfig();
    const cardBtn = $('topupCardBtn');
    if (!cfg.stripeEnabled) {
      cardBtn.disabled = true;
      setStatus('topupCardStatus', 'warn',
        'Card payments open soon. Use the <strong>Crypto</strong> tab for instant top-up today.');
      switchPane('crypto');
    } else {
      cardBtn.disabled = false;
    }

    $('topupModalOverlay').classList.add('open');
  }

  function closeModal() {
    const o = $('topupModalOverlay');
    if (o) o.classList.remove('open');
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }
  window.closeTopUpModal = closeModal;

  function isLikelySolanaAddress(s) {
    return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(s || '').trim());
  }

  async function createIntent(method, wallet) {
    const base = API_BASE();
    if (!base) throw new Error('API base not configured');
    const r = await fetch(`${base}/topup/intent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tier: selectedTier.id,
        usd: selectedTier.usd,
        ostAmount: selectedTier.total,
        wallet, method
      })
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
    btn.disabled = true; setStatus('topupCardStatus', 'info', 'Creating secure Stripe session…');
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
    btn.disabled = true; clearStatus('topupCryptoStatus');
    try {
      const cfg = await loadConfig();
      const intent = await createIntent('crypto', wallet);
      const usdc = (cfg.receivers && cfg.receivers.usdcMainnet) || 'Treasury address not configured';
      const sol  = (cfg.receivers && cfg.receivers.solMainnet)  || 'Treasury address not configured';
      $('topupUsdcAddr').textContent = usdc;
      $('topupSolAddr').textContent  = sol;
      $('topupMemo').textContent     = intent.memo || intent.id;
      $('topupCryptoCards').style.display = 'block';
      try { sessionStorage.setItem('ostTopupIntent', intent.id); } catch (_) {}
      pollIntent(intent.id, 'topupCryptoStatus');
    } catch (e) {
      setStatus('topupCryptoStatus', 'error', String(e && e.message || e));
    } finally {
      btn.disabled = false;
    }
  }

  function pollIntent(id, statusElId) {
    const base = API_BASE();
    if (!base) return;
    if (pollTimer) clearInterval(pollTimer);
    let tries = 0;
    pollTimer = setInterval(async () => {
      tries++;
      if (tries > 360) { clearInterval(pollTimer); pollTimer = null; return; } // ~30 min
      try {
        const r = await fetch(`${base}/topup/status/${encodeURIComponent(id)}`);
        if (!r.ok) return;
        const j = await r.json();
        if (j.status === 'sent') {
          clearInterval(pollTimer); pollTimer = null;
          setStatus(statusElId, 'ok',
            `Delivered ${fmtOst(j.ostAmount || (selectedTier && selectedTier.total))}! ` +
            (j.signature ? `<a href="https://solscan.io/tx/${j.signature}?cluster=devnet" target="_blank" rel="noopener">View tx</a>` : ''));
          window.dispatchEvent(new CustomEvent('ost:topup-delivered', { detail: j }));
        } else if (j.status === 'paid') {
          setStatus(statusElId, 'info', 'Payment received! Sending devnet OST…');
        }
      } catch (_) {}
    }, 5000);
  }

  // ---------- Stripe success-redirect handling ----------
  function handleSuccessRedirect() {
    try {
      const u = new URL(window.location.href);
      const status = u.searchParams.get('topup');
      const intent = u.searchParams.get('intent') || (sessionStorage.getItem('ostTopupIntent') || '');
      if (!status) return;
      if (status === 'success' && intent) {
        // Toast (best effort).
        try {
          if (typeof window.toast === 'function') {
            window.toast('💰', 'Payment received! Devnet OST is on its way.');
          }
        } catch (_) {}
        // Reopen modal in a polling state so the user sees delivery.
        ensureModal();
        $('topupModalOverlay').classList.add('open');
        switchPane('card');
        setStatus('topupCardStatus', 'info', 'Payment received! Waiting for devnet OST delivery…');
        pollIntent(intent, 'topupCardStatus');
      }
      u.searchParams.delete('topup'); u.searchParams.delete('intent');
      window.history.replaceState({}, '', u.toString());
    } catch (_) {}
  }

  // ---------- Mount ----------
  function mount() {
    const host = document.getElementById('topup-section');
    if (host) renderSection(host);
    handleSuccessRedirect();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})();

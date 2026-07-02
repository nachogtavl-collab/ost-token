/* ==========================================================================
   OST polish.js — adds loading states, real on-chain launchpad mint,
   live-tick animations, satellite orbit boot, and ripple effects.
   Loaded AFTER app.js so all handlers are already wired.
   ========================================================================== */
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }
  function on(el, ev, fn, opts) { if (el) el.addEventListener(ev, fn, opts || false); }

  // ---------- Tap ripple on every primary/outline button ----------
  function attachRipples() {
    var selector = '.btn, .lp-create-btn, .ct-convert-btn, .gc2-btn, .fuel2-btn, .transmit-launch';
    document.querySelectorAll(selector).forEach(function (btn) {
      if (btn.__ostRipple) return;
      btn.__ostRipple = true;
      btn.classList.add('ost-ripple-host');
      btn.addEventListener('click', function (event) {
        var rect = btn.getBoundingClientRect();
        var size = Math.max(rect.width, rect.height);
        var ripple = document.createElement('span');
        ripple.className = 'ost-ripple';
        ripple.style.width = ripple.style.height = size + 'px';
        ripple.style.left = (event.clientX - rect.left - size / 2) + 'px';
        ripple.style.top  = (event.clientY - rect.top  - size / 2) + 'px';
        btn.appendChild(ripple);
        setTimeout(function () { if (ripple.parentNode) ripple.parentNode.removeChild(ripple); }, 600);
      });
    });
  }

  // ---------- Wrap a button with a loading spinner during async work ----------
  function withLoading(btn, label) {
    if (!btn) return function () {};
    var original = btn.innerHTML;
    btn.classList.add('ost-loading');
    btn.disabled = true;
    btn.innerHTML = '<span class="ost-spinner"></span>' + (label || 'Working...');
    return function (successHtml) {
      btn.classList.remove('ost-loading');
      btn.disabled = false;
      btn.innerHTML = successHtml || original;
    };
  }

  // ---------- Animated number tick (live feel) ----------
  function tickValue(el, newText) {
    if (!el) return;
    var prev = el.textContent;
    if (prev === newText) return;
    el.textContent = newText;
    var prevNum = parseFloat(prev.replace(/[^0-9.\-]/g, ''));
    var newNum  = parseFloat(newText.replace(/[^0-9.\-]/g, ''));
    if (!isNaN(prevNum) && !isNaN(newNum) && prevNum !== newNum) {
      el.classList.remove('ost-tick-up', 'ost-tick-down');
      void el.offsetWidth; // restart animation
      el.classList.add(newNum > prevNum ? 'ost-tick-up' : 'ost-tick-down');
    }
  }

  // ---------- Periodically pulse the gift-card brand rates so they feel live ----------
  function startGiftCardLivePulse() {
    if (!window.__ostGCBrands) return;
    setInterval(function () {
      var rateLabels = document.querySelectorAll('.gc2-brand-opt-rate, #gc2SelRate');
      if (!rateLabels.length) return;
      var brands = window.__ostGCBrands;
      // Tiny ±0.3% jitter on a random brand to simulate market movement
      var i = Math.floor(Math.random() * brands.length);
      var b = brands[i];
      var jitter = (Math.random() - 0.5) * 0.6;
      b.rate = Math.max(70, Math.min(98, +(b.rate + jitter).toFixed(1)));
      // Refresh the visible rate for that brand
      rateLabels.forEach(function (lbl) {
        if (lbl.previousSibling && lbl.previousSibling.textContent === b.name) {
          tickValue(lbl, b.rate + '%');
        }
      });
      var sel = window.__ostSelectedGCBrand;
      var selRate = $('gc2SelRate');
      if (sel && selRate && sel === b) tickValue(selRate, b.rate + '%');
    }, 3500);
  }

  // ---------- Gas station: animated rewards fill + price pulse ----------
  function startFuelLivePulse() {
    setInterval(function () {
      var prices = document.querySelectorAll('.fuel2-price, .fuel2-price-val, [data-fuel-price]');
      prices.forEach(function (el) {
        var num = parseFloat(el.textContent.replace(/[^0-9.]/g, ''));
        if (!isNaN(num)) {
          var jitter = (Math.random() - 0.5) * 0.04;
          var next = Math.max(0.5, num + jitter).toFixed(2);
          var prefix = el.textContent.match(/^[^0-9]*/)[0];
          tickValue(el, prefix + next);
        }
      });
    }, 4500);

    // Auto-fill the rewards bar based on the user's gas tx history (or a friendly demo target)
    var bar = document.querySelector('.fuel2-rewards-bar-fill, [data-rewards-fill]');
    if (bar) {
      bar.classList.add('ost-rewards-bar-fill');
      var stored = parseInt(localStorage.getItem('ost_fuel_rewards_pct') || '0', 10);
      bar.style.width = (stored || 18) + '%';
    }
  }

  // ---------- SpaceX section: kick the orbital satellites into motion ----------
  function bootSatelliteOrbit() {
    var layer = $('satelliteLayer');
    if (!layer) return;
    layer.querySelectorAll('.satellite').forEach(function (s) {
      // Force a layout recalc so the CSS animation starts smoothly
      void s.offsetWidth;
      s.style.willChange = 'transform';
    });
  }

  // ---------- Real on-chain Token-2022 mint for the launchpad ----------
  // Hooks into the existing lpLaunchBtn click. When a browser-local wallet
  // (with secretKey in memory) is connected on devnet, we issue a real
  // createMint transaction and overwrite the demo address with the real one.
  function wireRealLaunchpadMint() {
    var btn = $('lpLaunchBtn');
    if (!btn) return;
    btn.addEventListener('click', function () {
      // Defer until the existing handler has populated #lpSuccessMint with a fake addr
      setTimeout(async function () {
        try {
          var session = window.connectedWalletSession || null;
          // Re-read from the source if module-scoped
          if (!session && typeof window.getLocalWalletSession === 'function') {
            session = window.getLocalWalletSession();
          }
          if (!session || session.kind !== 'local' || !session.keypair) return;
          if (!window.solanaWeb3 || !window.splToken) return;

          var statusEl = $('lpSuccessMint');
          if (!statusEl) return;
          var nameEl = $('lpSuccessName');
          var symbolEl = $('lpSuccessSymbol');
          var coinName = nameEl ? nameEl.textContent : 'OST Coin';
          var coinSymbol = symbolEl ? symbolEl.textContent : '$NEW';

          var prevMint = statusEl.textContent;
          statusEl.innerHTML = '<span class="ost-spinner"></span> minting on devnet...';

          var connection = new solanaWeb3.Connection(
            (window.OST_CONFIG && window.OST_CONFIG.rpcUrl) || 'https://api.devnet.solana.com',
            'confirmed'
          );

          var balance = await connection.getBalance(session.publicKey);
          if (balance < 5_000_000) {
            statusEl.textContent = prevMint + ' (demo — fund wallet with devnet SOL to mint for real)';
            return;
          }

          var mintKeypair = solanaWeb3.Keypair.generate();
          var mintAddress = await window.splToken.createMint(
            connection,
            session.keypair,           // payer
            session.publicKey,         // mint authority
            session.publicKey,         // freeze authority
            6,                         // decimals (memecoin standard)
            mintKeypair,
            { commitment: 'confirmed' },
            window.splToken.TOKEN_2022_PROGRAM_ID || window.splToken.TOKEN_PROGRAM_ID
          );

          var realAddr = mintAddress.toBase58();
          statusEl.innerHTML = '<span class="ost-success-check">✓</span> ' + realAddr;
          statusEl.title = 'Real on-chain mint';

          // Update history record with the real mint
          try {
            var hist = JSON.parse(localStorage.getItem('ost_lp_history2') || '[]');
            for (var i = hist.length - 1; i >= 0; i--) {
              if (hist[i].name === coinName) { hist[i].mint = realAddr; hist[i].onChain = true; break; }
            }
            localStorage.setItem('ost_lp_history2', JSON.stringify(hist));
          } catch (e) {}

          if (typeof window.toast === 'function') {
            window.toast('🪙', coinSymbol + ' minted on devnet: ' + realAddr.slice(0, 6) + '...' + realAddr.slice(-4));
          }
        } catch (err) {
          console.warn('[OST polish] launchpad real mint failed', err);
          var statusEl2 = $('lpSuccessMint');
          if (statusEl2) statusEl2.textContent += ' (demo — on-chain mint failed: ' + (err.message || err) + ')';
        }
      }, 600); // wait for the existing flow animation to write the placeholder mint
    });
  }

  // ---------- Wrap the gift card "Get Offer" + "Accept" buttons with success burst ----------
  function decorateGiftCardFlow() {
    var offerBtn  = $('gc2GetOffer');
    var acceptBtn = $('gc2Accept');
    if (offerBtn) {
      on(offerBtn, 'click', function () {
        if (offerBtn.disabled) return;
        var done = withLoading(offerBtn, 'Calculating offer...');
        setTimeout(function () { done('<span class="ost-success-check">✓</span> Offer ready'); }, 700);
      });
    }
    if (acceptBtn) {
      on(acceptBtn, 'click', function () {
        var done = withLoading(acceptBtn, 'Settling on Solana...');
        setTimeout(function () { done('<span class="ost-success-check">✓</span> Settled'); }, 1300);
      });
    }
  }

  // ---------- Wrap the gas station "Find Stations" + "Pay" buttons ----------
  function decorateFuelFlow() {
    var findBtn = $('fuel2FindBtn');
    var payBtn  = $('fuel2DetPayBtn');
    if (findBtn) {
      on(findBtn, 'click', function () {
        var done = withLoading(findBtn, 'Scanning nearby stations...');
        setTimeout(function () { done('<span class="ost-success-check">✓</span> Stations updated'); }, 900);
      });
    }
    if (payBtn) {
      on(payBtn, 'click', function () {
        if (payBtn.disabled) return;
        var done = withLoading(payBtn, 'Authorizing pump...');
        setTimeout(function () {
          done('<span class="ost-success-check">✓</span> Pump authorized');
          // Bump the rewards bar
          var current = parseInt(localStorage.getItem('ost_fuel_rewards_pct') || '18', 10);
          var next = Math.min(100, current + 7);
          localStorage.setItem('ost_fuel_rewards_pct', String(next));
          var bar = document.querySelector('.fuel2-rewards-bar-fill, [data-rewards-fill]');
          if (bar) bar.style.width = next + '%';
        }, 1200);
      });
    }
  }

  // ---------- Live badges for status pills that exist on the page ----------
  function decorateLiveBadges() {
    document.querySelectorAll('[data-ost-live], .ct-status-dot, .gc2-step-pill.gc2-step-active .gc2-step-dot').forEach(function (el) {
      el.classList.add('ost-pulse');
    });
  }

  // ---------- Boot ----------
  function boot() {
    try { attachRipples(); } catch (e) { console.warn('[polish] ripples', e); }
    try { decorateGiftCardFlow(); } catch (e) { console.warn('[polish] giftcard', e); }
    try { decorateFuelFlow(); } catch (e) { console.warn('[polish] fuel', e); }
    try { decorateLiveBadges(); } catch (e) { console.warn('[polish] badges', e); }
    try { bootSatelliteOrbit(); } catch (e) { console.warn('[polish] satellites', e); }
    try { wireRealLaunchpadMint(); } catch (e) { console.warn('[polish] launchpad', e); }
    try { startGiftCardLivePulse(); } catch (e) {}
    try { startFuelLivePulse(); } catch (e) {}

    // Re-run ripple attachment when new buttons enter the DOM (gas station list, etc.)
    var mo = new MutationObserver(function () { attachRipples(); decorateLiveBadges(); });
    mo.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    setTimeout(boot, 0);
  }
})();

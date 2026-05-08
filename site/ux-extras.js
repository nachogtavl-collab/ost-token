/* OST UX Extras — request-desktop toggle, deep tutorial, runtime i18n fallback */
(function () {
  'use strict';

  function isPhoneLike() {
    try {
      if (window.matchMedia && window.matchMedia('(max-width: 820px), (pointer: coarse) and (max-width: 1024px)').matches) return true;
    } catch (e) {}
    var widths = [window.innerWidth || 9999];
    if (window.screen && window.screen.width) widths.push(window.screen.width);
    if (window.visualViewport && window.visualViewport.width) widths.push(window.visualViewport.width);
    return Math.min.apply(Math, widths) <= 820;
  }

  // ------------------ Mobile request-desktop toggle ------------------------
  function mountMobileBar() {
    if (document.getElementById('ost-mobile-bar')) return;
    var mobileViewportContent = 'width=device-width, initial-scale=1.0, viewport-fit=cover';
    var bar = document.createElement('div');
    bar.id = 'ost-mobile-bar';
    bar.className = 'ost-mobile-bar';
    bar.innerHTML =
      '<button type="button" data-mode="mobile">📱 Mobile</button>' +
      '<button type="button" data-mode="desktop">🖥 Desktop</button>' +
      '<button type="button" data-tour-restart title="Restart guide">❓</button>';
    document.body.appendChild(bar);
    var saved = localStorage.getItem('ost.viewport') || 'mobile';
    if (isPhoneLike() && saved === 'desktop') saved = 'mobile';
    apply(saved);
    bar.addEventListener('click', function (ev) {
      var btn = ev.target.closest('button[data-mode]');
      if (btn) { apply(btn.getAttribute('data-mode')); return; }
      var t = ev.target.closest('[data-tour-restart]');
      if (t) { localStorage.removeItem('ost.tour.completed'); startTour(); }
    });
    function apply(mode) {
      if (isPhoneLike() && mode === 'desktop') mode = 'mobile';
      localStorage.setItem('ost.viewport', mode);
      var meta = document.querySelector('meta[name="viewport"]');
      if (mode === 'desktop') {
        document.body.classList.add('ost-force-desktop');
        if (meta) meta.setAttribute('content', mobileViewportContent);
      } else {
        document.body.classList.remove('ost-force-desktop');
        if (meta) meta.setAttribute('content', mobileViewportContent);
      }
      bar.querySelectorAll('button[data-mode]').forEach(function (b) {
        b.classList.toggle('is-active', b.getAttribute('data-mode') === mode);
      });
    }
  }

  // ------------------ Deep guided tour --------------------------------------
  var TOUR_STEPS = [
    {
      title: '👋 Welcome to OST',
      body: 'OST is a live Solana devnet wallet. This 6-step tour shows you how to create a wallet, claim free OST, buy products, use gift cards, the gas station, mint a memecoin and bet on prediction markets. Press <strong>→</strong> to continue.',
      target: null
    },
    {
      title: '1. Create your wallet',
      body: 'Open the <strong>Wallet</strong> compartment and click <em>Create wallet</em>. A new Solana keypair is generated locally — you can back it up at any time. Your address appears in the header.',
      target: '[data-section="wallet"], #wallet-portal, [href*="wallet"]'
    },
    {
      title: '2. Claim faucet OST',
      body: 'Inside the wallet, click <strong>Claim faucet</strong> to receive your first OST tokens (1 OST per claim). The transfer is a real Token-2022 transaction on Solana devnet.',
      target: '[data-faucet], [data-action="faucet"], button[id*="faucet" i]'
    },
    {
      title: '3. Buy products in Commerce',
      body: 'Open <strong>Commerce</strong>. Browse the shop, pick an item, then pay in OST. The merchant address receives your tokens directly on-chain.',
      target: '[data-section="commerce"], [href*="commerce"], #commerce'
    },
    {
      title: '4. Gift Cards & Gas Station',
      body: 'In Commerce → <strong>Gift Cards</strong> you can buy a real branded gift card with OST. In <strong>Gas Station</strong>, top up fuel and earn cashback in OST.',
      target: '[href*="gift"], [data-tab="giftcards"], #giftcards'
    },
    {
      title: '5. Memecoins (Launchpad)',
      body: 'Open the <strong>Wallet → Launchpad</strong>. Pick a name, ticker and supply, then mint a real Token-2022 memecoin in one click — the mint address is yours.',
      target: '[data-tab="launchpad"], [href*="launchpad"], #launchpad'
    },
    {
      title: '6. Prediction Markets — bet & claim',
      body: 'Open the <strong>Markets</strong> board. Each card has <em>ℹ Info</em>, <em>📈 Graph</em>, <strong>Bet YES</strong> and <strong>Bet NO</strong>. Pick a stake and confirm — the OST is sent to the prediction vault. When the market resolves, click <strong>Claim</strong> in <em>My OST bets</em> to receive your payout.',
      target: '.prediction-market-board, [data-section="prediction"], [href*="prediction"]'
    },
    {
      title: '✅ You are ready',
      body: 'Use the floating compartments dock on the right to jump between sections. Use the bottom bar to switch between mobile and desktop view. Tap <strong>❓</strong> any time to replay this tour.',
      target: null
    }
  ];

  var tourEl = null;
  var tourIdx = 0;

  function ensureTour() {
    if (tourEl) return tourEl;
    tourEl = document.createElement('div');
    tourEl.className = 'ost-tour';
    tourEl.setAttribute('aria-hidden', 'true');
    tourEl.innerHTML =
      '<div class="ost-tour__veil"></div>' +
      '<div class="ost-tour__pulse" style="display:none"></div>' +
      '<div class="ost-tour__card">' +
        '<button type="button" class="ost-tour__close" aria-label="Close tour" style="position:absolute;top:10px;right:10px;width:34px;height:34px;border-radius:999px;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.08);color:#f8fbff;font-size:20px;line-height:1;cursor:pointer;">&times;</button>' +
        '<div class="ost-tour__step"></div>' +
        '<h2 class="ost-tour__title"></h2>' +
        '<div class="ost-tour__body"></div>' +
        '<div class="ost-tour__cta">' +
          '<button type="button" class="ost-tour__skip">Skip tour</button>' +
          '<button type="button" class="ost-tour__next">Next →</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(tourEl);
    tourEl.querySelector('.ost-tour__skip').addEventListener('click', closeTour);
    tourEl.querySelector('.ost-tour__close').addEventListener('click', closeTour);
    tourEl.querySelector('.ost-tour__veil').addEventListener('click', function () { /* keep open, force interaction */ });
    tourEl.querySelector('.ost-tour__next').addEventListener('click', function () {
      tourIdx++;
      if (tourIdx >= TOUR_STEPS.length) { closeTour(); return; }
      renderStep();
    });
    document.addEventListener('keydown', function (ev) {
      if (!tourEl.classList.contains('is-open')) return;
      if (ev.key === 'ArrowRight' || ev.key === 'Enter') tourEl.querySelector('.ost-tour__next').click();
      if (ev.key === 'Escape') closeTour();
    });
    return tourEl;
  }

  function renderStep() {
    var s = TOUR_STEPS[tourIdx];
    var el = ensureTour();
    el.querySelector('.ost-tour__step').textContent = 'Step ' + (tourIdx + 1) + ' of ' + TOUR_STEPS.length;
    el.querySelector('.ost-tour__title').innerHTML = s.title;
    el.querySelector('.ost-tour__body').innerHTML = s.body;
    el.querySelector('.ost-tour__next').textContent = (tourIdx === TOUR_STEPS.length - 1) ? 'Done ✓' : 'Next →';
    var pulse = el.querySelector('.ost-tour__pulse');
    if (s.target) {
      var t = document.querySelector(s.target);
      if (t && t.getBoundingClientRect) {
        var r = t.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          t.scrollIntoView({ block: 'center', behavior: 'smooth' });
          setTimeout(function () {
            var rr = t.getBoundingClientRect();
            pulse.style.display = 'block';
            pulse.style.top = (rr.top - 8) + 'px';
            pulse.style.left = (rr.left - 8) + 'px';
            pulse.style.width = (rr.width + 16) + 'px';
            pulse.style.height = (rr.height + 16) + 'px';
          }, 350);
          return;
        }
      }
    }
    pulse.style.display = 'none';
  }

  function startTour() {
    tourIdx = 0;
    ensureTour().classList.add('is-open');
    ensureTour().setAttribute('aria-hidden', 'false');
    renderStep();
  }
  function closeTour() {
    if (!tourEl) return;
    tourEl.classList.remove('is-open');
    tourEl.setAttribute('aria-hidden', 'true');
    localStorage.setItem('ost.tour.completed', '1');
  }

  // ------------------ Treasury Reserves panel ------------------------------
  function fmtUsd(n) { return '$' + Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function fmtNum(n, d) { d = d == null ? 4 : d; return Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: d }); }
  function renderTreasury(host) {
    if (!host || !window.OST_TREASURY) return;
    var totals = window.OST_TREASURY.totals();
    var list = window.OST_TREASURY.reserves().slice(0, 30);
    if (!list.length) {
      host.innerHTML = '<div class="ost-treasury-empty">No reserves yet. Convert any currency from the <strong>Convert</strong> panel — the OST treasury will hold it as backing.</div>';
      return;
    }
    var byCur = totals.byCurrency;
    var chips = Object.keys(byCur).sort().map(function (cur) {
      return '<span class="ost-treasury-chip"><strong>' + escapeHtml(cur) + '</strong> ' + fmtNum(byCur[cur], 6) + '</span>';
    }).join('');
    host.innerHTML = [
      '<div class="ost-treasury-summary">',
        '<div><span class="ost-treasury-label">Total backing</span><strong>' + fmtUsd(totals.totalUsd) + '</strong></div>',
        '<div><span class="ost-treasury-label">OST issued</span><strong>' + fmtNum(totals.totalOst, 2) + ' OST</strong></div>',
        '<div><span class="ost-treasury-label">Entries</span><strong>' + totals.count + '</strong></div>',
      '</div>',
      '<div class="ost-treasury-chips">' + chips + '</div>',
      '<table class="ost-treasury-table"><thead><tr><th>When</th><th>Currency</th><th>Amount</th><th>USD</th><th>OST out</th><th>Path</th></tr></thead><tbody>',
      list.map(function (e) {
        var when = new Date(e.ts).toLocaleString();
        return '<tr>' +
          '<td>' + escapeHtml(when) + '</td>' +
          '<td><strong>' + escapeHtml(e.currency) + '</strong></td>' +
          '<td>' + fmtNum(e.amount, 6) + '</td>' +
          '<td>' + fmtUsd(e.usd) + '</td>' +
          '<td>' + fmtNum(e.ost, 4) + '</td>' +
          '<td>' + (e.kind === 'on-chain-swap' ? 'on-chain' : 'IOU') + '</td>' +
          '</tr>';
      }).join(''),
      '</tbody></table>'
    ].join('');
  }
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]);
    });
  }
  function mountTreasuryPanel() {
    if (document.getElementById('ost-treasury-panel')) return;
    // Place under the convert widget if found, otherwise under the wallet portal
    var anchor = document.querySelector('#convertWalletBackupBar') || document.querySelector('#wallet-portal') || document.body;
    var host = document.createElement('section');
    host.id = 'ost-treasury-panel';
    host.className = 'ost-treasury-panel';
    host.innerHTML = '<header><h3>🏦 OST Treasury reserves</h3><button type="button" id="ost-treasury-refresh">Refresh</button></header><div id="ost-treasury-body"></div>';
    anchor.parentNode.insertBefore(host, anchor.nextSibling);
    var body = host.querySelector('#ost-treasury-body');
    host.querySelector('#ost-treasury-refresh').addEventListener('click', function () { renderTreasury(body); });
    renderTreasury(body);
    window.addEventListener('ost-treasury-changed', function () { renderTreasury(body); });
  }

  function maybeAutoStart() {
    try { localStorage.setItem('ost.tour.completed', '1'); } catch (e) {}
  }

  // ------------------ Runtime i18n fallback for missing keys ----------------
  // Small Spanish dictionary that fills in any common UI string the main i18n
  // table forgot. Anything not covered falls through to the English source.
  var ES_FALLBACK = {
    // Common nav / actions
    'Wallet': 'Billetera', 'Markets': 'Mercados', 'Commerce': 'Comercio',
    'Shop': 'Tienda', 'Gift Cards': 'Tarjetas de regalo', 'Gas Station': 'Estación de servicio',
    'Launchpad': 'Lanzamiento', 'Send': 'Enviar', 'Receive': 'Recibir', 'Convert': 'Convertir',
    'Connect wallet': 'Conectar billetera', 'Create wallet': 'Crear billetera',
    'Claim faucet': 'Reclamar OST gratis', 'Refresh': 'Actualizar',
    'Buy YES with OST': 'Apostar SÍ con OST', 'Buy NO with OST': 'Apostar NO con OST',
    'Bet YES': 'Apostar SÍ', 'Bet NO': 'Apostar NO',
    'Yes': 'Sí', 'No': 'No', 'Cancel': 'Cancelar', 'Confirm bet': 'Confirmar apuesta',
    'Open venue': 'Abrir mercado', 'Open feed': 'Abrir feed', 'Trade with OST': 'Operar con OST',
    'My OST bets': 'Mis apuestas OST', 'Claim': 'Reclamar', 'Stake': 'Monto',
    'Status': 'Estado', 'open': 'abierta', 'won': 'ganada', 'lost': 'perdida',
    'Side': 'Lado', 'Payout if win': 'Pago si gana', 'Closes': 'Cierra',
    'No bets yet. Click Bet YES or Bet NO on any market.': 'Aún no hay apuestas. Pulsa Bet SÍ o Bet NO en cualquier mercado.',
    'Loading market pulse...': 'Cargando pulso de mercado...',
    'Select a live market': 'Selecciona un mercado en vivo',
    'Flat': 'Sin cambio', 'All venues': 'Todos los mercados', 'OST Native': 'Nativos OST',
    'All markets': 'Todos los mercados', 'Politics': 'Política', 'Sports': 'Deportes',
    'Crypto': 'Cripto', 'Esports': 'Esports', 'Iran': 'Irán', 'Finance': 'Finanzas',
    'Geopolitics': 'Geopolítica', 'Tech': 'Tecnología', 'Culture': 'Cultura',
    'Economy': 'Economía', 'Weather': 'Clima', 'Mentions': 'Menciones', 'Elections': 'Elecciones',
    'Skip tour': 'Saltar tutorial', 'Next →': 'Siguiente →', 'Done ✓': 'Listo ✓',
    'Mobile': 'Móvil', 'Desktop': 'Escritorio',
    'How it works': 'Cómo funciona', 'Settlement': 'Liquidación',
    'OST native vault': 'Bóveda nativa OST', 'External venue (Polymarket / Kalshi)': 'Mercado externo (Polymarket / Kalshi)'
  };

  // Walk the DOM and translate any visible text node when the active language is es.
  function autoTranslate() {
    var lang = (localStorage.getItem('ost.lang') || document.documentElement.lang || 'en').toLowerCase();
    if (!lang.startsWith('es')) return;
    var dict = ES_FALLBACK;
    var skip = { SCRIPT: 1, STYLE: 1, CODE: 1, PRE: 1, NOSCRIPT: 1, INPUT: 1, TEXTAREA: 1 };
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        if (!node.parentNode || skip[node.parentNode.tagName]) return NodeFilter.FILTER_REJECT;
        if (node.parentNode.closest('[data-no-i18n]')) return NodeFilter.FILTER_REJECT;
        var raw = node.nodeValue.trim();
        if (!raw || raw.length > 80) return NodeFilter.FILTER_REJECT;
        return dict[raw] ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }
    });
    var nodes = [], n;
    while ((n = walker.nextNode())) nodes.push(n);
    nodes.forEach(function (node) { node.nodeValue = node.nodeValue.replace(node.nodeValue.trim(), dict[node.nodeValue.trim()]); });
  }
  // Re-run when the language changes via app's selector
  function watchLangChanges() {
    document.addEventListener('change', function (ev) {
      var t = ev.target;
      if (t && (t.id === 'lang-select' || t.matches('[data-i18n-select]') || t.matches('select[name*="lang" i]'))) {
        var v = String(t.value || '').toLowerCase();
        if (v) localStorage.setItem('ost.lang', v);
        setTimeout(autoTranslate, 200);
      }
    });
  }

  // ------------------ Boot --------------------------------------------------
  function boot() {
    // Suppress the older 3-step compartments guide so users only see the new deep tour.
    try { localStorage.setItem('ost.compartments.guideSeen.v1', '1'); } catch (e) {}
    mountMobileBar();
    mountTreasuryPanel();
    watchLangChanges();
    setTimeout(autoTranslate, 1500);
    setInterval(autoTranslate, 5000); // pick up dynamically rendered strings
    maybeAutoStart();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.OST_UX = {
    startTour: startTour,
    setViewport: function (mode) {
      var b = document.querySelector('#ost-mobile-bar [data-mode="' + mode + '"]');
      if (b) b.click();
    }
  };
})();

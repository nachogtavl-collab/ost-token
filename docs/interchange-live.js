/* ==========================================================================
 * OST · Interchange live merchant pulse + URL parser popup
 * Adds:
 *   - A sample merchant route ticker across the top of the Interchange tab.
 *   - A "Paste a checkout URL" quick-popup that parses the URL, extracts the
 *     merchant + product hint, and pipes it into the existing #deskStatus.
 *   - A handful of one-click sample carts (Apple, Marriott, Tesla, Uber)
 *     so visitors instantly experience the rail without needing real URLs.
 * ========================================================================== */
(function () {
  'use strict';

  var SAMPLE_MERCHANTS = [
    { merchant: 'Apple Store', city: 'Cupertino, US', amount: 1299, currency: 'USD', kind: 'order' },
    { merchant: 'Marriott',    city: 'New York, US',   amount: 624,  currency: 'USD', kind: 'hotel' },
    { merchant: 'Aeromexico',  city: 'CDMX, MX',       amount: 412,  currency: 'USD', kind: 'flight' },
    { merchant: 'Pemex',       city: 'Nuevo Laredo',   amount: 980,  currency: 'MXN', kind: 'fuel' },
    { merchant: 'Uber',        city: 'São Paulo, BR',  amount: 28,   currency: 'BRL', kind: 'ride' },
    { merchant: 'Amazon',      city: 'Seattle, US',    amount: 84.5, currency: 'USD', kind: 'order' },
    { merchant: 'Spotify',     city: 'Stockholm, SE',  amount: 9.99, currency: 'EUR', kind: 'sub'   },
    { merchant: 'OXXO',        city: 'Monterrey, MX',  amount: 312,  currency: 'MXN', kind: 'order' },
    { merchant: 'Booking.com', city: 'Tulum, MX',      amount: 845,  currency: 'USD', kind: 'hotel' },
    { merchant: 'Doordash',    city: 'Austin, US',     amount: 38,   currency: 'USD', kind: 'food'  }
  ];

  var SAMPLE_CARTS = [
    { label: '🍎 Apple · iPhone 16 Pro',     url: 'https://www.apple.com/shop/buy-iphone/iphone-16-pro' },
    { label: '🏨 Marriott · NYC 2 nights',    url: 'https://www.marriott.com/en-us/hotels/nycmq-new-york-marriott-marquis/overview/' },
    { label: '🚗 Tesla · Model Y',            url: 'https://www.tesla.com/modely' },
    { label: '✈️ Aeromexico · CDMX→NYC',      url: 'https://www.aeromexico.com/' },
    { label: '⛽ Pemex · 40L Premium',        url: 'https://www.pemex.com/' },
    { label: '🛒 Amazon · MX cart',          url: 'https://www.amazon.com.mx/' }
  ];

  function init() {
    var section = document.getElementById('payAnywhere');
    if (!section) return;
    injectStyles();
    injectTicker(section);
    injectQuickActions(section);
  }

  function injectStyles() {
    if (document.getElementById('ixLiveStyle')) return;
    var st = document.createElement('style');
    st.id = 'ixLiveStyle';
    st.textContent =
      '.ix-live-ticker{margin:14px 0;padding:8px 0;border:1px solid rgba(120,180,255,0.18);border-radius:12px;background:linear-gradient(90deg,rgba(15,18,30,0.6),rgba(8,11,22,0.85));overflow:hidden;position:relative;}' +
      '.ix-live-ticker::before{content:"SAMPLE";position:absolute;left:10px;top:50%;transform:translateY(-50%);background:#334155;color:#fff;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:700;letter-spacing:.06em;z-index:2;box-shadow:0 0 12px rgba(51,65,85,0.5);}' +
      '.ix-live-track{display:flex;gap:28px;padding-left:60px;animation:ix-scroll 38s linear infinite;white-space:nowrap;}' +
      '.ix-live-item{color:#cbd5e1;font-size:13px;}' +
      '.ix-live-item strong{color:#f5c468;}' +
      '.ix-live-item .ix-arrow{color:#34d399;margin:0 4px;}' +
      '@keyframes ix-blink{0%,100%{opacity:1}50%{opacity:.5}}' +
      '@keyframes ix-scroll{0%{transform:translateX(0)}100%{transform:translateX(-50%)}}' +
      '.ix-quick-actions{margin:10px 0 18px;display:flex;gap:8px;flex-wrap:wrap;}' +
      '.ix-quick-btn{padding:8px 12px;border-radius:999px;border:1px solid rgba(120,180,255,0.35);background:rgba(56,118,252,0.12);color:#bfdbfe;font-size:12px;cursor:pointer;font-weight:600;transition:all .15s;}' +
      '.ix-quick-btn:hover{transform:translateY(-1px);background:rgba(56,118,252,0.22);}' +
      '.ix-url-popup{position:fixed;inset:0;display:none;background:rgba(2,6,16,0.78);backdrop-filter:blur(8px);z-index:9985;align-items:center;justify-content:center;padding:20px;}' +
      '.ix-url-card{background:#0f131e;border:1px solid rgba(120,180,255,0.25);border-radius:18px;padding:22px;max-width:480px;width:100%;}';
    document.head.appendChild(st);
  }

  function injectTicker(section) {
    if (section.querySelector('.ix-live-ticker')) return;
    var ticker = document.createElement('div');
    ticker.className = 'ix-live-ticker';
    var track = document.createElement('div');
    track.className = 'ix-live-track';

    function buildItem(s) {
      var sym = ({USD:'$',EUR:'€',GBP:'£',MXN:'MX$',BRL:'R$',JPY:'¥'})[s.currency] || (s.currency + ' ');
      var ostUnitUsd = (window.OST_TREASURY && window.OST_TREASURY.priceUsd) ? (window.OST_TREASURY.priceUsd(s.currency) || 0.05) : 0.05;
      var amtUsd = s.currency === 'USD' ? s.amount : s.amount * (ostUnitUsd || 1);
      var ost = (s.amount / ((window.OST_TREASURY && window.OST_TREASURY.priceUsd && window.OST_TREASURY.priceUsd('USD')) || 0.05)).toFixed(1);
      return '<span class="ix-live-item">' +
        '<strong>' + s.merchant + '</strong> · ' + s.city +
        ' <span class="ix-arrow">→</span> ' + sym + s.amount.toLocaleString() +
        ' · sample quote ' + ost + ' OST</span>';
    }

    // Render twice for seamless scroll
    var html = SAMPLE_MERCHANTS.concat(SAMPLE_MERCHANTS).map(buildItem).join('');
    track.innerHTML = html;
    ticker.appendChild(track);

    // Insert at the top of the interchange panel content
    var hero = section.querySelector('.pa-hero');
    if (hero && hero.parentNode) {
      hero.parentNode.insertBefore(ticker, hero.nextSibling);
    } else {
      section.insertBefore(ticker, section.firstChild);
    }

    // Periodically rotate sample entries in.
    setInterval(function () {
      var next = SAMPLE_MERCHANTS[Math.floor(Math.random() * SAMPLE_MERCHANTS.length)];
      var fresh = Object.assign({}, next, { amount: +(next.amount * (0.85 + Math.random() * 0.3)).toFixed(2) });
      track.insertAdjacentHTML('beforeend', buildItem(fresh));
    }, 6000);
  }

  function injectQuickActions(section) {
    if (section.querySelector('.ix-quick-actions')) return;
    var bar = document.createElement('div');
    bar.className = 'ix-quick-actions';
    bar.innerHTML =
      '<button type="button" class="ix-quick-btn" id="ixUrlBtn">⚡ Paste checkout URL</button>' +
      SAMPLE_CARTS.map(function (c) {
        return '<button type="button" class="ix-quick-btn" data-url="' + esc(c.url) + '">' + esc(c.label) + '</button>';
      }).join('');

    var desk = section.querySelector('.interchange-desk') || section;
    desk.parentNode.insertBefore(bar, desk);

    bar.addEventListener('click', function (e) {
      var btn = e.target.closest('.ix-quick-btn');
      if (!btn) return;
      if (btn.id === 'ixUrlBtn') return openUrlPopup();
      if (btn.dataset.url) loadCheckout(btn.dataset.url, btn.textContent);
    });

    buildUrlPopup();
  }

  function buildUrlPopup() {
    if (document.getElementById('ixUrlPopup')) return;
    var p = document.createElement('div');
    p.id = 'ixUrlPopup';
    p.className = 'ix-url-popup';
    p.innerHTML =
      '<div class="ix-url-card">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">' +
          '<h3 style="margin:0;color:#f8fafc;font-size:1.1rem;">⚡ Paste checkout URL</h3>' +
          '<button id="ixUrlClose" style="background:transparent;border:none;color:#94a3b8;font-size:1.4rem;cursor:pointer;">×</button>' +
        '</div>' +
        '<p style="color:#94a3b8;font-size:13px;margin:0 0 10px;">We parse the URL, extract the merchant, and route it into the OST desk.</p>' +
        '<input id="ixUrlInput" type="url" placeholder="https://store.example.com/cart/abc" style="width:100%;padding:11px;border-radius:8px;border:1px solid rgba(255,255,255,0.12);background:rgba(0,0,0,0.3);color:#f8fafc;font-size:14px;margin-bottom:12px;">' +
        '<button id="ixUrlGo" style="width:100%;padding:12px;border-radius:10px;border:none;background:linear-gradient(135deg,#f5c468,#f59e0b);color:#1a1a1a;font-weight:700;cursor:pointer;">Send to Interchange Desk</button>' +
        '<div id="ixUrlStatus" style="text-align:center;color:#94a3b8;font-size:12px;margin-top:10px;min-height:16px;"></div>' +
      '</div>';
    document.body.appendChild(p);

    document.getElementById('ixUrlClose').addEventListener('click', closeUrlPopup);
    p.addEventListener('click', function (e) { if (e.target === p) closeUrlPopup(); });
    document.getElementById('ixUrlGo').addEventListener('click', function () {
      var v = document.getElementById('ixUrlInput').value.trim();
      if (!v) return;
      try { new URL(v); } catch (_) {
        document.getElementById('ixUrlStatus').style.color = '#fca5a5';
        document.getElementById('ixUrlStatus').textContent = 'That doesn\'t look like a valid URL.';
        return;
      }
      loadCheckout(v);
      closeUrlPopup();
    });
  }

  function openUrlPopup() {
    buildUrlPopup();
    document.getElementById('ixUrlPopup').style.display = 'flex';
    setTimeout(function () { document.getElementById('ixUrlInput').focus(); }, 50);
  }
  function closeUrlPopup() {
    var p = document.getElementById('ixUrlPopup');
    if (p) p.style.display = 'none';
  }

  function loadCheckout(url, label) {
    var deskStatus = document.getElementById('deskStatus');
    var deskMerchant = document.getElementById('deskMerchant');
    var deskSource = document.getElementById('deskSource');
    var merchant = label || merchantFromUrl(url);
    if (deskMerchant) deskMerchant.textContent = merchant;
    if (deskSource)   deskSource.textContent = domain(url);
    if (deskStatus)   deskStatus.textContent = 'Loaded ' + merchant + ' · ready to authorize on devnet.';
    if (typeof window.toast === 'function') {
      try { window.toast('🌐', 'Loaded ' + merchant + ' into desk'); } catch (_) {}
    }
    // Scroll the desk into view
    var desk = document.getElementById('interchangeDesk');
    if (desk && desk.scrollIntoView) desk.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function merchantFromUrl(url) {
    try {
      var host = new URL(url).host.replace(/^www\./, '');
      var seg = host.split('.')[0];
      return seg.charAt(0).toUpperCase() + seg.slice(1);
    } catch (_) { return 'Merchant'; }
  }
  function domain(url) { try { return new URL(url).host.replace(/^www\./, ''); } catch (_) { return url; } }
  function esc(v) { return String(v || '').replace(/[&<>"']/g, function (c) { return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]; }); }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    setTimeout(init, 0);
  }
})();

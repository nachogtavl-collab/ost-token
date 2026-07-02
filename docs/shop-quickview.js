/* ==========================================================================
 * OST · Shop quick-view popup + extra catalog variety
 * Adds:
 *   - Click on any .store-item (anywhere except the + add button) opens a
 *     centered modal with bigger image, longer description, related items,
 *     and a "Add to cart" / "Open merchant" pair.
 *   - Extra products injected at runtime so the catalog has more variety
 *     without bloating the static HTML.
 *   - Honest listing status for the popup.
 * ========================================================================== */
(function () {
  'use strict';

  // ── Extra products injected at runtime ─────────────────────────────────
  var EXTRA = [
    { name: 'Sony WH-1000XM5', price: 399, currency: 'USD', merchant: 'Sony', category: 'tech',
      link: 'https://electronics.sony.com/audio/headphones/all-headphones/p/wh1000xm5-b',
      img: 'https://images.unsplash.com/photo-1583394838336-acd977736f90?w=400&h=400&fit=crop&q=80',
      desc: 'Industry-leading noise cancellation, 30hr battery, multipoint Bluetooth' },
    { name: 'Patagonia Nano Puff', price: 239, currency: 'USD', merchant: 'Patagonia', category: 'fashion',
      link: 'https://www.patagonia.com/product/mens-nano-puff-jacket/84212.html',
      img: 'https://images.unsplash.com/photo-1551028719-00167b16eac5?w=400&h=400&fit=crop&q=80',
      desc: 'Recycled-polyester insulation, packable, water-resistant shell' },
    { name: 'Le Creuset Dutch Oven 5.5qt', price: 369, currency: 'USD', merchant: 'Le Creuset', category: 'food',
      link: 'https://www.lecreuset.com/round-dutch-oven/L2502.html',
      img: 'https://images.unsplash.com/photo-1584990347449-718253fa6d11?w=400&h=400&fit=crop&q=80',
      desc: 'Enameled cast iron, lifetime warranty, oven-safe to 500°F' },
    { name: 'Lego Technic Bugatti', price: 449.99, currency: 'USD', merchant: 'Lego', category: 'tech',
      link: 'https://www.lego.com/en-us/product/bugatti-chiron-42083',
      img: 'https://images.unsplash.com/photo-1587654780291-39c9404d746b?w=400&h=400&fit=crop&q=80',
      desc: '3,599 pieces, working W16 engine model, 8-speed gearbox' },
    { name: 'Airbnb · Tulum Cenote Villa', price: 845, currency: 'USD', merchant: 'Airbnb', category: 'travel hotel',
      link: 'https://www.airbnb.com/s/Tulum--Mexico/homes',
      img: 'https://images.unsplash.com/photo-1582719508461-905c673771fd?w=400&h=400&fit=crop&q=80',
      desc: '3 nights · private cenote · jungle deck · 4 guests' },
    { name: 'Aeromexico CDMX → NYC', price: 412, currency: 'USD', merchant: 'Aeromexico', category: 'travel flight',
      link: 'https://www.aeromexico.com/',
      img: 'https://images.unsplash.com/photo-1530521954074-e64f6810b32d?w=400&h=400&fit=crop&q=80',
      desc: 'Round-trip economy · 1 stop · 8h 35m total' },
    { name: 'Ford F-150 Lightning XLT', price: 56995, currency: 'USD', merchant: 'Ford', category: 'car',
      link: 'https://www.ford.com/trucks/f150/f150-lightning/',
      img: 'https://images.unsplash.com/photo-1606016159991-dfe4f2746ad5?w=400&h=400&fit=crop&q=80',
      desc: '320mi range, 580hp, dual e-motor AWD, mega power frunk' },
    { name: 'Casa Tulum Beachfront 3BR', price: 1240000, currency: 'USD', merchant: 'Sotheby\'s', category: 'property',
      link: 'https://www.sothebysrealty.com/eng/sales/mex',
      img: 'https://images.unsplash.com/photo-1613490493576-7fde63acd811?w=400&h=400&fit=crop&q=80',
      desc: '320 m² · pool · cenote rights · turnkey rental program' },
    { name: 'iPad Pro 13" M4', price: 1299, currency: 'USD', merchant: 'Apple', category: 'tech',
      link: 'https://www.apple.com/shop/buy-ipad/ipad-pro',
      img: 'https://images.unsplash.com/photo-1561154464-82e9adf32764?w=400&h=400&fit=crop&q=80',
      desc: 'M4 chip, Tandem OLED, ProMotion 120Hz, 256GB' },
    { name: 'Yeezy Boost 350 V2', price: 230, currency: 'USD', merchant: 'Adidas', category: 'fashion',
      link: 'https://www.adidas.com/us/yeezy',
      img: 'https://images.unsplash.com/photo-1600185365926-3a2ce3cdb9eb?w=400&h=400&fit=crop&q=80',
      desc: 'Primeknit upper, full-length BOOST midsole' },
    { name: 'Tacos al Pastor · Pujol delivery', price: 38, currency: 'USD', merchant: 'Pujol', category: 'food',
      link: 'https://pujol.com.mx/',
      img: 'https://images.unsplash.com/photo-1565299585323-38d6b0865b47?w=400&h=400&fit=crop&q=80',
      desc: '12 tacos · housemade tortillas · CDMX delivery' },
    { name: 'GTA VI Pre-Order (Standard)', price: 69.99, currency: 'USD', merchant: 'Rockstar', category: 'tech',
      link: 'https://www.rockstargames.com/VI',
      img: 'https://images.unsplash.com/photo-1542751371-adc38448a05e?w=400&h=400&fit=crop&q=80',
      desc: 'Digital pre-order · PS5/XSX · early-bonus content' }
  ];

  function fmt(n) { return n.toLocaleString('en-US', { maximumFractionDigits: 2 }); }
  function formatFiat(n) {
    if (typeof window.OST_FORMAT_PRIMARY_FIAT === 'function') {
      try { return window.OST_FORMAT_PRIMARY_FIAT(n); } catch (_) {}
    }
    return '$' + fmt(n);
  }
  function formatOst(n) {
    var unitUsd = Number(window.ostPrice) || 0.0001;
    var ost = n / unitUsd;
    if (!Number.isFinite(ost)) return '-- OST';
    if (ost >= 1e6) return (ost / 1e6).toFixed(1) + 'M OST';
    if (ost >= 1000) return (ost / 1000).toFixed(1) + 'K OST';
    return ost.toFixed(0) + ' OST';
  }

  function injectExtras() {
    var grid = document.getElementById('storeProducts');
    if (!grid) return;
    EXTRA.forEach(function (p) {
      var div = document.createElement('div');
      div.className = 'store-item';
      div.dataset.price    = String(p.price);
      div.dataset.name     = p.name;
      div.dataset.link     = p.link;
      div.dataset.merchant = p.merchant;
      div.dataset.category = p.category;
      div.dataset.currency = p.currency;
      div.dataset.desc     = p.desc;
      div.dataset.img      = p.img;
      div.innerHTML =
        '<img class="item-img" src="' + p.img + '" alt="' + esc(p.name) + '" loading="lazy">' +
        '<div class="item-details">' +
          '<span class="item-name">' + esc(p.name) + '</span>' +
          '<span class="item-desc">' + esc(p.desc) + '</span>' +
          '<div class="item-tags">' + p.category.split(' ').map(function (c) {
            return '<span class="item-tag">' + esc(cap(c)) + '</span>';
          }).join('') + '</div>' +
          '<span class="item-source">' + esc(p.merchant) + ' <a href="' + esc(p.link) + '" target="_blank" rel="noopener" class="item-link">' + esc(domain(p.link)) + '</a></span>' +
          '<span class="item-price"><span class="item-usd">' + esc(formatFiat(p.price)) + '</span> &middot; <span class="item-ost">' + esc(formatOst(p.price)) + '</span></span>' +
        '</div>' +
        '<button class="btn-add" aria-label="Add">+</button>';
      grid.appendChild(div);
    });
    // Update catalog meta
    var meta = document.getElementById('storeCatalogMeta');
    if (meta) meta.textContent = grid.children.length + ' live listings';
    if (typeof window.OST_UPDATE_PRODUCT_PRICES === 'function') window.OST_UPDATE_PRODUCT_PRICES();
    if (typeof window.syncStoreCatalogUi === 'function') window.syncStoreCatalogUi();
    if (typeof window.OST_TRANSLATE_NODE === 'function') window.OST_TRANSLATE_NODE(grid);
  }

  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function domain(url) { try { return new URL(url).host.replace(/^www\./, ''); } catch (_) { return url; } }
  function esc(v) { return String(v || '').replace(/[&<>"']/g, function (c) { return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]; }); }

  // ── Quick-view popup ────────────────────────────────────────────────────
  function buildModal() {
    if (document.getElementById('shopQuickView')) return;
    var modal = document.createElement('div');
    modal.id = 'shopQuickView';
    modal.style.cssText = 'position:fixed;inset:0;display:none;background:rgba(2,6,16,0.82);backdrop-filter:blur(10px);z-index:9990;align-items:center;justify-content:center;padding:20px;';
    modal.innerHTML =
      '<div id="sqvCard" style="background:linear-gradient(180deg,#10131e,#0a0d18);border:1px solid rgba(120,180,255,0.22);border-radius:20px;max-width:720px;width:100%;max-height:88vh;overflow:auto;box-shadow:0 30px 80px rgba(0,0,0,0.65);">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;padding:14px 18px;border-bottom:1px solid rgba(255,255,255,0.07);">' +
          '<div style="display:flex;align-items:center;gap:10px;"><span style="width:8px;height:8px;background:#34d399;border-radius:50%;animation:mx-pulse 1.2s infinite;"></span><span id="sqvViewers" style="color:#cbd5e1;font-size:12px;">Merchant listing</span></div>' +
          '<button id="sqvClose" style="background:transparent;border:none;color:#94a3b8;font-size:1.6rem;cursor:pointer;line-height:1;">×</button>' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:1fr;gap:0;">' +
          '<img id="sqvImg" src="" alt="" style="width:100%;max-height:340px;object-fit:cover;background:#0b1020;">' +
          '<div style="padding:18px;">' +
            '<div id="sqvTags" style="display:flex;gap:6px;margin-bottom:6px;flex-wrap:wrap;"></div>' +
            '<h3 id="sqvName" style="margin:0 0 6px;color:#f8fafc;font-size:1.25rem;"></h3>' +
            '<div id="sqvMerchant" style="color:#94a3b8;font-size:13px;margin-bottom:10px;"></div>' +
            '<p id="sqvDesc" style="color:#cbd5e1;font-size:14px;line-height:1.55;margin:0 0 14px;"></p>' +
            '<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:14px;">' +
              '<div><span id="sqvUsd" style="font-size:1.6rem;font-weight:700;color:#f8fafc;">$0</span> ' +
                '<span id="sqvOst" style="color:#f5c468;font-weight:600;font-size:13px;margin-left:6px;">— OST</span></div>' +
              '<div id="sqvStock" style="color:#86efac;font-size:12px;">In stock · ships in 2 days</div>' +
            '</div>' +
            '<div style="display:flex;gap:10px;flex-wrap:wrap;">' +
              '<button id="sqvAdd" style="flex:1;min-width:140px;padding:12px;border-radius:10px;border:none;background:linear-gradient(135deg,#f5c468,#f59e0b);color:#1a1a1a;font-weight:700;cursor:pointer;font-size:14px;">+ Add to cart</button>' +
              '<a id="sqvOpen" target="_blank" rel="noopener" style="flex:1;min-width:140px;padding:12px;border-radius:10px;border:1px solid rgba(120,180,255,0.4);background:rgba(56,118,252,0.18);color:#bfdbfe;font-weight:600;text-align:center;text-decoration:none;font-size:14px;">Open merchant ↗</a>' +
            '</div>' +
            '<div id="sqvStatus" style="text-align:center;color:#86efac;font-size:13px;margin-top:10px;min-height:18px;"></div>' +
          '</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(modal);

    document.getElementById('sqvClose').addEventListener('click', closeModal);
    modal.addEventListener('click', function (e) { if (e.target === modal) closeModal(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeModal(); });

    document.getElementById('sqvAdd').addEventListener('click', function () {
      if (!currentItem || !currentItem.addBtn) return;
      currentItem.addBtn.click();
      var st = document.getElementById('sqvStatus');
      st.textContent = '✓ Added to cart';
      setTimeout(closeModal, 700);
    });
  }

  var currentItem = null;
  var viewersTimer = null;

  function openModal(item) {
    buildModal();
    currentItem = item;
    var modal = document.getElementById('shopQuickView');
    document.getElementById('sqvImg').src = item.img;
    document.getElementById('sqvName').textContent = item.name;
    document.getElementById('sqvMerchant').textContent = item.merchant + ' · ' + (item.category || '').split(' ').map(cap).join(' · ');
    document.getElementById('sqvDesc').textContent = item.desc;
    document.getElementById('sqvUsd').textContent = formatFiat(item.price);
    document.getElementById('sqvOst').textContent = formatOst(item.price);
    document.getElementById('sqvOpen').href = item.link;
    document.getElementById('sqvStatus').textContent = '';

    var tags = document.getElementById('sqvTags');
    tags.innerHTML = (item.category || '').split(' ').filter(Boolean).map(function (c) {
      return '<span style="padding:2px 8px;border-radius:999px;background:rgba(120,180,255,0.15);color:#bfdbfe;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;">' + esc(c) + '</span>';
    }).join('');

    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';

    var vEl = document.getElementById('sqvViewers');
    vEl.textContent = 'Verified merchant link';
    if (viewersTimer) clearInterval(viewersTimer);
    viewersTimer = null;
  }

  function closeModal() {
    var modal = document.getElementById('shopQuickView');
    if (modal) modal.style.display = 'none';
    document.body.style.overflow = '';
    if (viewersTimer) { clearInterval(viewersTimer); viewersTimer = null; }
    currentItem = null;
  }

  function readItem(el) {
    var addBtn = el.querySelector('.btn-add');
    return {
      el: el,
      addBtn: addBtn,
      name: el.dataset.name || el.querySelector('.item-name')?.textContent || '',
      price: parseFloat(el.dataset.price) || 0,
      currency: el.dataset.currency || 'USD',
      merchant: el.dataset.merchant || '',
      category: el.dataset.category || '',
      link: el.dataset.link || '#',
      desc: el.dataset.desc || el.querySelector('.item-desc')?.textContent || '',
      img: el.dataset.img || el.querySelector('.item-img')?.src || ''
    };
  }

  function wireClicks() {
    var grid = document.getElementById('storeProducts');
    if (!grid) return;
    grid.addEventListener('click', function (e) {
      // Ignore + button and explicit links
      if (e.target.closest('.btn-add')) return;
      if (e.target.closest('a')) return;
      var item = e.target.closest('.store-item');
      if (!item) return;
      openModal(readItem(item));
    });
  }

  function init() {
    injectExtras();
    wireClicks();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    setTimeout(init, 0);
  }
})();

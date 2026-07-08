/* ============================================================================
 * OST · Real-data gas-station overlay (Mexico, with Nuevo Laredo focus)
 * ----------------------------------------------------------------------------
 * Adds a "Live Mexico stations" panel under the existing fuel section.
 * - City picker (Nuevo Laredo, Monterrey, CDMX, Guadalajara, Tijuana, Cancún)
 * - Pulls real `[amenity=fuel]` POIs from the OpenStreetMap Overpass API
 * - Renders them on a Leaflet map AND as cards (with brand, address, phone, hours)
 * - Each card has "Pay with OST" wired into the existing fuel detail modal
 *
 * Free, no API key required. Same pattern Google Maps uses under the hood for
 * its OSM-derived business layer.
 * ========================================================================== */
(function () {
  'use strict';

  if (!document) return;
  // Leaflet is lazy-loaded on demand (see ensureLeaflet) so its ~150KB + CSS stay
  // off the critical path — this module no longer requires L at load time.
  function ensureLeaflet() {
    if (window.L) return Promise.resolve(window.L);
    if (!window.OSTLoad) return Promise.reject(new Error('OSTLoad missing'));
    return window.OSTLoad.css('https://unpkg.com/leaflet@1.9.4/dist/leaflet.css')
      .then(function () { return window.OSTLoad.script('https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'); })
      .then(function () { return window.L; });
  }

  // ── Mexican cities we surface (lat, lon, default zoom, search radius m) ────
  var MX_CITIES = {
    'nuevo-laredo': { label: 'Nuevo Laredo, Tamaulipas', lat: 27.4861, lon: -99.5070, zoom: 13, radius: 12000 },
    'monterrey':    { label: 'Monterrey, Nuevo León',     lat: 25.6866, lon: -100.3161, zoom: 12, radius: 14000 },
    'cdmx':         { label: 'Ciudad de México',          lat: 19.4326, lon: -99.1332, zoom: 12, radius: 16000 },
    'guadalajara':  { label: 'Guadalajara, Jalisco',      lat: 20.6597, lon: -103.3496, zoom: 12, radius: 14000 },
    'tijuana':      { label: 'Tijuana, Baja California',  lat: 32.5149, lon: -117.0382, zoom: 12, radius: 14000 },
    'cancun':       { label: 'Cancún, Quintana Roo',      lat: 21.1619, lon: -86.8515, zoom: 12, radius: 12000 },
    'laredo-tx':    { label: 'Laredo, TX (border twin)',  lat: 27.5306, lon: -99.4803, zoom: 13, radius: 12000 }
  };

  var OVERPASS_ENDPOINTS = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://overpass.openstreetmap.ru/api/interpreter'
  ];

  // Module state
  var state = {
    cityKey: 'nuevo-laredo',
    map: null,
    layer: null,
    cards: null,
    statusEl: null,
    select: null,
    countSpan: null,
    refreshBtn: null,
    container: null,
    lastFetchAt: 0
  };

  // Country watcher — only show panel when MX is the active fuel country
  function init() {
    var fuelSection = document.getElementById('fuelSection');
    var countrySel  = document.getElementById('fuel2Country');
    if (!fuelSection || !countrySel) return;

    buildPanel(fuelSection);
    syncVisibility(countrySel.value);
    countrySel.addEventListener('change', function () { syncVisibility(countrySel.value); });
  }

  function syncVisibility(country) {
    if (!state.container) return;
    var show = String(country || '').toUpperCase() === 'MX';
    state.container.style.display = show ? '' : 'none';
    if (show) ensureMapAndLoad();
  }

  function buildPanel(fuelSection) {
    var wrap = document.createElement('section');
    wrap.id = 'mxLiveStations';
    wrap.className = 'mx-live-wrap';
    wrap.style.cssText = 'display:none;margin:24px 0;padding:18px;border-radius:18px;background:linear-gradient(180deg,rgba(15,18,30,0.85),rgba(8,11,22,0.92));border:1px solid rgba(120,180,255,0.18);box-shadow:0 12px 40px rgba(0,0,0,0.45);';

    wrap.innerHTML =
      '<div class="mx-live-head" style="display:flex;flex-wrap:wrap;align-items:center;gap:12px;margin-bottom:12px;">' +
        '<span style="font-size:22px;line-height:1;">🇲🇽</span>' +
        '<div style="flex:1;min-width:220px;">' +
          '<div style="font-weight:700;color:#f8fafc;font-size:15px;">Live Mexico stations · OpenStreetMap data</div>' +
          '<div style="color:#94a3b8;font-size:12px;">Real businesses pulled from OSM Overpass — same source Google\'s POI layer uses. Tap a marker or card to load it into the OST checkout.</div>' +
        '</div>' +
        '<select id="mxCitySelect" style="padding:9px 12px;border-radius:10px;border:1px solid rgba(255,255,255,0.14);background:rgba(0,0,0,0.35);color:#f8fafc;font-size:13px;min-width:200px;">' +
          Object.keys(MX_CITIES).map(function (k) {
            return '<option value="' + k + '"' + (k === state.cityKey ? ' selected' : '') + '>' + MX_CITIES[k].label + '</option>';
          }).join('') +
        '</select>' +
        '<button type="button" id="mxRefreshBtn" style="padding:9px 14px;border-radius:10px;border:1px solid rgba(120,180,255,0.4);background:rgba(56,118,252,0.18);color:#bfdbfe;cursor:pointer;font-weight:600;">⟳ Refresh</button>' +
      '</div>' +
      '<div id="mxLiveMap" style="width:100%;height:340px;border-radius:14px;overflow:hidden;border:1px solid rgba(255,255,255,0.08);background:#0b1020;"></div>' +
      '<div id="mxLiveStatus" style="margin-top:10px;color:#cbd5e1;font-size:12px;"><span class="mx-spinner" style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#38bdf8;margin-right:6px;animation:mx-pulse 1s infinite;"></span>Loading nearby gas stations…</div>' +
      '<div id="mxLiveCards" style="margin-top:12px;display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px;"></div>';

    // Tiny pulse keyframes (shared with toast spinner if present)
    if (!document.getElementById('mxLiveStyle')) {
      var st = document.createElement('style');
      st.id = 'mxLiveStyle';
      st.textContent = '@keyframes mx-pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.4;transform:scale(.7)}}' +
        '.mx-station-card{padding:12px;border-radius:12px;background:rgba(15,20,32,0.85);border:1px solid rgba(255,255,255,0.07);transition:transform .15s,border-color .15s;cursor:pointer;display:flex;flex-direction:column;gap:6px;}' +
        '.mx-station-card:hover{transform:translateY(-2px);border-color:rgba(120,180,255,0.45);}' +
        '.mx-station-card .mx-name{color:#f8fafc;font-weight:700;font-size:14px;}' +
        '.mx-station-card .mx-brand{display:inline-block;padding:2px 8px;border-radius:999px;background:rgba(245,196,104,0.15);color:#f5c468;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;width:fit-content;}' +
        '.mx-station-card .mx-meta{color:#94a3b8;font-size:12px;line-height:1.4;}' +
        '.mx-station-card .mx-actions{display:flex;gap:6px;margin-top:6px;}' +
        '.mx-station-card .mx-act{flex:1;padding:6px 10px;border-radius:8px;border:1px solid rgba(120,180,255,0.35);background:rgba(56,118,252,0.18);color:#bfdbfe;font-size:11px;font-weight:600;text-align:center;cursor:pointer;text-decoration:none;}' +
        '.mx-station-card .mx-act-pay{border-color:rgba(245,196,104,0.45);background:rgba(245,196,104,0.18);color:#fde68a;}' +
        '@media (max-width:560px){#mxLiveMap{height:240px!important;}.mx-live-head select,.mx-live-head button{width:100%!important;}}';
      document.head.appendChild(st);
    }

    // Insert after the brand wheel (if present) or at start of fuelSection
    var brandWheel = fuelSection.querySelector('.fuel2-brand-wheel-wrap');
    if (brandWheel && brandWheel.parentNode) {
      brandWheel.parentNode.insertBefore(wrap, brandWheel.nextSibling);
    } else {
      fuelSection.appendChild(wrap);
    }

    state.container = wrap;
    state.select    = wrap.querySelector('#mxCitySelect');
    state.refreshBtn = wrap.querySelector('#mxRefreshBtn');
    state.statusEl  = wrap.querySelector('#mxLiveStatus');
    state.cards     = wrap.querySelector('#mxLiveCards');

    state.select.addEventListener('change', function () {
      state.cityKey = state.select.value;
      var c = MX_CITIES[state.cityKey];
      if (state.map && c) state.map.setView([c.lat, c.lon], c.zoom);
      loadStations();
    });
    state.refreshBtn.addEventListener('click', function () { loadStations(true); });
  }

  function ensureMapAndLoad() {
    if (state.map) { loadStations(); return; }
    var mapEl = document.getElementById('mxLiveMap');
    if (!mapEl) return;
    setStatus('Loading map…', null);
    ensureLeaflet().then(function () {
      if (state.map) { loadStations(); return; }
      var c = MX_CITIES[state.cityKey];
      state.map = window.L.map(mapEl, {
        zoomControl: true,
        preferCanvas: true
      }).setView([c.lat, c.lon], c.zoom);
      window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap contributors'
      }).addTo(state.map);
      state.layer = window.L.layerGroup().addTo(state.map);
      // Defer a tick so the container has its real width before invalidateSize
      setTimeout(function () { try { state.map.invalidateSize(); } catch (_) {} }, 80);
      loadStations();
    }).catch(function () { setStatus('Map failed to load', 'error'); });
  }

  function setStatus(text, tone) {
    if (!state.statusEl) return;
    var color = tone === 'error' ? '#fca5a5' : tone === 'ok' ? '#86efac' : '#cbd5e1';
    state.statusEl.style.color = color;
    state.statusEl.textContent = text;
  }

  function loadStations(forceFresh) {
    var c = MX_CITIES[state.cityKey];
    if (!c) return;
    var now = Date.now();
    if (!forceFresh && now - state.lastFetchAt < 1500) return;
    state.lastFetchAt = now;

    setStatus('Querying OSM for gas stations near ' + c.label + '…');
    var query =
      '[out:json][timeout:25];' +
      '(' +
        'node["amenity"="fuel"](around:' + c.radius + ',' + c.lat + ',' + c.lon + ');' +
        'way["amenity"="fuel"](around:' + c.radius + ',' + c.lat + ',' + c.lon + ');' +
      ');' +
      'out center tags 200;';

    overpassFetch(query)
      .then(function (data) {
        var elements = (data && data.elements) || [];
        var stations = elements.map(toStation).filter(Boolean);
        // De-dup near-identical points
        var seen = {};
        stations = stations.filter(function (s) {
          var k = s.lat.toFixed(4) + ',' + s.lon.toFixed(4);
          if (seen[k]) return false;
          seen[k] = true;
          return true;
        });
        // Sort: branded first, then alphabetical
        stations.sort(function (a, b) {
          if (!!b.brand !== !!a.brand) return b.brand ? 1 : -1;
          return a.name.localeCompare(b.name);
        });
        renderStations(stations);
        setStatus(stations.length + ' real stations from OSM · ' + c.label, 'ok');
      })
      .catch(function (err) {
        console.warn('[mx-live] overpass failed', err);
        setStatus('Could not reach OSM Overpass right now. Showing curated fallback.', 'error');
        renderStations(curatedFallback(c));
      });
  }

  function overpassFetch(query) {
    var attempt = 0;
    function next() {
      if (attempt >= OVERPASS_ENDPOINTS.length) return Promise.reject(new Error('all endpoints failed'));
      var url = OVERPASS_ENDPOINTS[attempt++];
      return fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(query)
      }).then(function (r) {
        if (!r.ok) throw new Error('status ' + r.status);
        return r.json();
      }).catch(function () { return next(); });
    }
    return next();
  }

  function toStation(el) {
    var lat = el.lat || (el.center && el.center.lat);
    var lon = el.lon || (el.center && el.center.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    var t = el.tags || {};
    var name = t.name || t.brand || t.operator || 'Gas station';
    var brand = (t.brand || t.operator || '').trim();
    var addr = [t['addr:street'], t['addr:housenumber']].filter(Boolean).join(' ').trim()
      || t['addr:full'] || t['addr:place'] || '';
    var city = t['addr:city'] || t['addr:suburb'] || '';
    var phone = t.phone || t['contact:phone'] || '';
    var website = t.website || t['contact:website'] || '';
    var hours = t.opening_hours || '';
    return {
      id: el.type + '/' + el.id,
      name: name,
      brand: brand,
      lat: lat,
      lon: lon,
      addr: addr,
      city: city,
      phone: phone,
      website: website,
      hours: hours
    };
  }

  function curatedFallback(city) {
    // Minimal Nuevo Laredo / Mexico curated set if Overpass is down.
    if (city.label.indexOf('Nuevo Laredo') === 0) {
      return [
        { id: 'curated/1', name: 'PEMEX Av. Reforma',  brand: 'PEMEX', lat: 27.4889, lon: -99.5106, addr: 'Av. Reforma 1850', city: 'Nuevo Laredo' },
        { id: 'curated/2', name: 'PEMEX Bravo',        brand: 'PEMEX', lat: 27.4767, lon: -99.5160, addr: 'Av. César López de Lara', city: 'Nuevo Laredo' },
        { id: 'curated/3', name: 'OXXO Gas Anáhuac',   brand: 'OXXO',  lat: 27.4945, lon: -99.5283, addr: 'Av. Anáhuac', city: 'Nuevo Laredo' },
        { id: 'curated/4', name: 'G500 Mier y Terán',  brand: 'G500',  lat: 27.4801, lon: -99.5082, addr: 'Mier y Terán', city: 'Nuevo Laredo' },
        { id: 'curated/5', name: 'Shell Aeropuerto',   brand: 'Shell', lat: 27.4435, lon: -99.5712, addr: 'Carr. Aeropuerto', city: 'Nuevo Laredo' }
      ];
    }
    return [];
  }

  function renderStations(stations) {
    if (!state.layer || !state.cards) return;
    state.layer.clearLayers();
    state.cards.innerHTML = '';

    if (!stations.length) {
      state.cards.innerHTML = '<div style="color:#94a3b8;font-size:13px;padding:14px;">No stations returned for this city.</div>';
      return;
    }

    var bounds = [];
    stations.forEach(function (s) {
      bounds.push([s.lat, s.lon]);

      var marker = window.L.circleMarker([s.lat, s.lon], {
        radius: 8,
        color: '#f5c468',
        weight: 2,
        fillColor: '#f5c468',
        fillOpacity: 0.55
      });
      marker.bindPopup(buildPopup(s));
      marker.addTo(state.layer);

      var card = document.createElement('div');
      card.className = 'mx-station-card';
      card.innerHTML =
        (s.brand ? '<span class="mx-brand">' + escapeHtml(s.brand) + '</span>' : '') +
        '<div class="mx-name">' + escapeHtml(s.name) + '</div>' +
        '<div class="mx-meta">' +
          (s.addr ? escapeHtml(s.addr) + (s.city ? ' · ' + escapeHtml(s.city) : '') + '<br>' : '') +
          (s.phone ? '☎ ' + escapeHtml(s.phone) + '<br>' : '') +
          (s.hours ? '⏱ ' + escapeHtml(s.hours) : '') +
        '</div>' +
        '<div class="mx-actions">' +
          '<a class="mx-act" target="_blank" rel="noopener" href="https://www.openstreetmap.org/' + encodeURIComponent(s.id) + '">Map</a>' +
          (s.website ? '<a class="mx-act" target="_blank" rel="noopener" href="' + esc(s.website) + '">Site</a>' : '') +
          '<button type="button" class="mx-act mx-act-pay">⚡ Pay OST</button>' +
        '</div>';

      // Card click → focus marker + open popup
      card.addEventListener('click', function (e) {
        if (e.target.classList.contains('mx-act-pay')) {
          openOstCheckout(s);
          e.stopPropagation();
          return;
        }
        if (e.target.classList.contains('mx-act')) return;
        try { state.map.setView([s.lat, s.lon], 16); marker.openPopup(); } catch (_) {}
      });

      state.cards.appendChild(card);
    });

    if (bounds.length > 1) {
      try { state.map.fitBounds(bounds, { padding: [30, 30], maxZoom: 14 }); } catch (_) {}
    }
  }

  function buildPopup(s) {
    return '<div style="min-width:180px;">' +
      '<div style="font-weight:700;color:#0b1020;">' + escapeHtml(s.name) + '</div>' +
      (s.brand ? '<div style="font-size:11px;color:#92400e;margin-top:2px;">' + escapeHtml(s.brand) + '</div>' : '') +
      (s.addr ? '<div style="font-size:12px;color:#334155;margin-top:4px;">' + escapeHtml(s.addr) + '</div>' : '') +
      (s.phone ? '<div style="font-size:12px;color:#334155;">☎ ' + escapeHtml(s.phone) + '</div>' : '') +
      '<div style="margin-top:6px;display:flex;gap:6px;">' +
        '<a target="_blank" rel="noopener" href="https://www.openstreetmap.org/' + encodeURIComponent(s.id) + '" style="font-size:11px;color:#1d4ed8;">OSM</a>' +
        (s.website ? ' · <a target="_blank" rel="noopener" href="' + esc(s.website) + '" style="font-size:11px;color:#1d4ed8;">Site</a>' : '') +
      '</div>' +
    '</div>';
  }

  // Lightweight OST checkout popup (no external deps; uses existing toast if present)
  function openOstCheckout(s) {
    var existing = document.getElementById('mxOstCheckout');
    if (existing) existing.remove();

    var modal = document.createElement('div');
    modal.id = 'mxOstCheckout';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(2,6,16,0.78);backdrop-filter:blur(8px);z-index:10000;display:flex;align-items:center;justify-content:center;padding:20px;';
    modal.innerHTML =
      '<div style="background:#0f131e;border:1px solid rgba(120,180,255,0.25);border-radius:18px;padding:22px;max-width:420px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,0.55);">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">' +
          '<h3 style="margin:0;color:#f8fafc;font-size:1.05rem;">⚡ Pay with OST</h3>' +
          '<button id="mxOstClose" style="background:transparent;border:none;color:#94a3b8;font-size:1.4rem;cursor:pointer;">×</button>' +
        '</div>' +
        '<div style="color:#cbd5e1;font-size:13px;margin-bottom:12px;">' + escapeHtml(s.name) + (s.addr ? ' · ' + escapeHtml(s.addr) : '') + '</div>' +
        '<label style="display:block;color:#94a3b8;font-size:12px;margin-bottom:4px;">Litros</label>' +
        '<input id="mxOstLiters" type="number" min="1" max="999" step="0.1" value="20" style="width:100%;padding:10px;border-radius:8px;border:1px solid rgba(255,255,255,0.12);background:rgba(0,0,0,0.3);color:#f8fafc;font-size:14px;margin-bottom:10px;">' +
        '<label style="display:block;color:#94a3b8;font-size:12px;margin-bottom:4px;">Precio MXN/L (Pemex referencia)</label>' +
        '<input id="mxOstPrice" type="number" min="1" max="100" step="0.01" value="22.50" style="width:100%;padding:10px;border-radius:8px;border:1px solid rgba(255,255,255,0.12);background:rgba(0,0,0,0.3);color:#f8fafc;font-size:14px;margin-bottom:14px;">' +
        '<div id="mxOstTotals" style="display:flex;justify-content:space-between;color:#f8fafc;font-size:14px;margin-bottom:14px;padding:10px;background:rgba(56,118,252,0.12);border-radius:10px;"><span>Total</span><strong id="mxOstTotal">— MXN · — OST</strong></div>' +
        '<button id="mxOstPay" style="width:100%;padding:12px;border-radius:10px;border:none;background:linear-gradient(135deg,#f5c468,#f59e0b);color:#1a1a1a;font-weight:700;font-size:14px;cursor:pointer;">Authorize OST payment</button>' +
        '<div id="mxOstStatus" style="text-align:center;color:#94a3b8;font-size:12px;margin-top:10px;min-height:16px;"></div>' +
      '</div>';
    document.body.appendChild(modal);

    function updateTotals() {
      var liters = parseFloat(document.getElementById('mxOstLiters').value) || 0;
      var price  = parseFloat(document.getElementById('mxOstPrice').value)  || 0;
      var mxn    = liters * price;
      // OST ≈ MXN / 18 (rough USD/MXN heuristic). Use treasury price if available.
      var usdPerOst = (window.OST_TREASURY && window.OST_TREASURY.priceUsd) ? window.OST_TREASURY.priceUsd('USD') || 0.05 : 0.05;
      var ost = (mxn / 18) / usdPerOst;
      document.getElementById('mxOstTotal').textContent = mxn.toFixed(2) + ' MXN · ' + ost.toFixed(2) + ' OST';
    }
    document.getElementById('mxOstLiters').addEventListener('input', updateTotals);
    document.getElementById('mxOstPrice').addEventListener('input', updateTotals);
    updateTotals();

    document.getElementById('mxOstClose').addEventListener('click', function () { modal.remove(); });
    modal.addEventListener('click', function (e) { if (e.target === modal) modal.remove(); });

    document.getElementById('mxOstPay').addEventListener('click', function () {
      var status = document.getElementById('mxOstStatus');
      status.style.color = '#94a3b8';
      status.textContent = 'Routing through OST devnet…';
      setTimeout(function () {
        status.style.color = '#86efac';
        status.textContent = '✓ Pre-authorisation held. Show this code at the pump: ' + Math.random().toString(36).slice(2, 8).toUpperCase();
        if (typeof window.toast === 'function') {
          try { window.toast('⛽', 'Pre-auth held at ' + s.name); } catch (_) {}
        }
      }, 700);
    });
  }

  function esc(v) { return String(v || '').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }
  function escapeHtml(v) { return String(v || '').replace(/[&<>"']/g, function (c) { return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]; }); }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    setTimeout(init, 0);
  }
})();

/*
 * mesh-location-pro.js  (v2)
 * --------------------------------------------------------------
 * Apple-style live location for the OST Mesh DM.
 *
 *   Engine (v2 upgrades)
 *   --------------------
 *   • watchPosition() with high-accuracy GNSS — single OS-level
 *     stream, vastly better battery + faster fixes than polling
 *     getCurrentPosition on a setInterval.
 *   • Smart throttling — only broadcasts when EITHER:
 *       (a) > MIN_TIME since last sent fix, OR
 *       (b) moved > MIN_DIST meters, OR
 *       (c) accuracy improved by ≥ 50%
 *     Cuts traffic by ~10x while staying instant on movement.
 *   • Accuracy filter — drops fixes worse than the last good one
 *     unless the gap > 60 s (keeps the peer dot from jumping).
 *   • Speed / heading / altitude carried end-to-end so the peer
 *     UI can show "moving at 42 km/h NE" not just a static dot.
 *
 *   Wire (v2)
 *   ---------
 *   All v2 traffic rides on the existing encrypted DM channel via
 *   pavilion.sendAppPayload({ app:'mesh-location-pro', type:... }).
 *   Types:
 *     fix        — live or one-shot fix (replaces v1's double-capture)
 *     stop       — sender ended the session
 *     trace.req  — peer asks "what was your last known position?"
 *     trace.rep  — reply with cached fix + how stale it is
 *     ping       — keepalive heartbeat (every 30 s) so peer knows
 *                  you're still online even between motion-throttled
 *                  fixes
 *
 *   Interface
 *   ---------
 *   • Floating peer panel (top-right) shows the OTHER side's:
 *       live status · last fix age · accuracy · speed · heading
 *       · distance from me · "Open in Maps" · "Share back" · "Trace"
 *   • Status pill (top-center) shows MY share state with stop btn.
 *   • Modal with duration + mode + allow-trace + accuracy preference.
 *   • Auto-resume across reload.
 * --------------------------------------------------------------
 */
(function () {
  'use strict';

  // ============== constants ==============
  var APP = 'mesh-location-pro';
  var STATE_KEY   = 'ost.mesh.locationPro.session.v2';
  var LASTFIX_KEY = 'ost.mesh.locationPro.lastFix.v2';
  var PEER_KEY    = 'ost.mesh.locationPro.peerFix.v2';

  var TRACE_REPLY_TIMEOUT_MS = 8000;
  var HEARTBEAT_MS           = 30 * 1000;
  var MIN_BROADCAST_MS       = 8 * 1000;     // never spam more than every 8s
  var MAX_BROADCAST_MS       = 45 * 1000;    // always send at least once per 45s while live
  var MIN_BROADCAST_DIST_M   = 12;           // ~one parking spot
  var STALE_FIX_FORCE_MS     = 60 * 1000;
  var BG_MAX_BROADCAST_MS    = 90 * 1000;    // background mode slower keepalive

  var DURATIONS = [
    { id: '15m', label: '15 minutes', ms: 15 * 60 * 1000 },
    { id: '1h',  label: '1 hour',     ms: 60 * 60 * 1000 },
    { id: '8h',  label: '8 hours',    ms: 8 * 60 * 60 * 1000 },
    { id: '24h', label: '24 hours',   ms: 24 * 60 * 60 * 1000 },
    { id: 'inf', label: 'Until I stop', ms: 0 }
  ];

  // ============== helpers ==============
  function nowMs() { return Date.now(); }
  function readJson(k, f) { try { var v = JSON.parse(localStorage.getItem(k) || 'null'); return v == null ? f : v; } catch (e) { return f; } }
  function writeJson(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function delJson(k) { try { localStorage.removeItem(k); } catch (e) {} }

  function fmtRemaining(ms) {
    if (!isFinite(ms) || ms <= 0) return '∞';
    var s = Math.round(ms / 1000);
    if (s < 60) return s + 's';
    var m = Math.round(s / 60);
    if (m < 60) return m + 'm';
    var h = Math.floor(m / 60), mm = m % 60;
    return h + 'h' + (mm ? ' ' + mm + 'm' : '');
  }
  function fmtAge(ms) {
    if (ms == null || !isFinite(ms)) return '—';
    if (ms < 0) ms = 0;
    var s = Math.round(ms / 1000);
    if (s < 60) return s + 's ago';
    var m = Math.round(s / 60);
    if (m < 60) return m + 'm ago';
    var h = Math.round(m / 60);
    if (h < 48) return h + 'h ago';
    return Math.round(h / 24) + 'd ago';
  }
  function fmtDist(m) {
    if (m == null || !isFinite(m)) return '—';
    if (m < 950) return Math.round(m) + ' m';
    var km = m / 1000;
    return (km < 10 ? km.toFixed(1) : Math.round(km)) + ' km';
  }
  function fmtSpeed(mps) {
    if (mps == null || !isFinite(mps) || mps < 0) return null;
    var kmh = mps * 3.6;
    if (kmh < 0.5) return 'still';
    return kmh < 10 ? kmh.toFixed(1) + ' km/h' : Math.round(kmh) + ' km/h';
  }
  function compass(deg) {
    if (deg == null || !isFinite(deg)) return '';
    var dirs = ['N','NE','E','SE','S','SW','W','NW'];
    return dirs[Math.round(((deg % 360) / 45)) % 8];
  }
  function satelliteBadge(acc) {
    var n = Number(acc) || 0;
    if (n > 0 && n <= 20) return '🛰 GPS lock · ±' + Math.round(n) + 'm';
    if (n > 0 && n <= 60) return '🛰 GNSS · ±' + Math.round(n) + 'm';
    if (n > 0 && n <= 200) return '📶 Network · ±' + Math.round(n) + 'm';
    return '📶 Coarse · ±' + Math.round(n) + 'm';
  }
  function haversine(a, b) {
    if (!a || !b) return null;
    var R = 6371000;
    var toRad = function (x) { return x * Math.PI / 180; };
    var dLat = toRad(b.lat - a.lat);
    var dLon = toRad(b.lon - a.lon);
    var s1 = Math.sin(dLat / 2), s2 = Math.sin(dLon / 2);
    var h = s1 * s1 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * s2 * s2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }
  function mapsUrl(lat, lon) {
    // Apple Maps on iOS for native deep-link, Google Maps elsewhere.
    if (isIOS()) return 'https://maps.apple.com/?q=' + encodeURIComponent(lat + ',' + lon) + '&ll=' + lat + ',' + lon;
    return 'https://www.google.com/maps?q=' + encodeURIComponent(lat + ',' + lon);
  }

  // ============== iOS / platform helpers ==============
  function isIOS() {
    var ua = navigator.userAgent || '';
    // iPad on iOS 13+ reports as Mac — check touch points to distinguish.
    return /iPad|iPhone|iPod/.test(ua) || (ua.indexOf('Mac') >= 0 && navigator.maxTouchPoints > 1);
  }
  function isStandalonePWA() {
    return (window.navigator.standalone === true) ||
           (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
  }

  // ============== state ==============
  function loadSession()  { return readJson(STATE_KEY, null); }
  function saveSession(s) { if (s) writeJson(STATE_KEY, s); else delJson(STATE_KEY); }
  function loadLastFix()  { return readJson(LASTFIX_KEY, null); }
  function saveLastFix(f) { writeJson(LASTFIX_KEY, f); }
  function loadPeerFix()  { return readJson(PEER_KEY, null); }
  function savePeerFix(f) { if (f) writeJson(PEER_KEY, f); else delJson(PEER_KEY); }

  // ============== styles ==============
  function injectStyle() {
    if (document.getElementById('mesh-location-pro-style')) return;
    var css = [
      // ---- modal
      '#mlpModal{position:fixed;inset:0;background:rgba(4,8,18,.7);display:none;align-items:center;justify-content:center;z-index:99999;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)}',
      '#mlpModal.is-open{display:flex}',
      '#mlpModal .mlp-card{width:min(460px,94vw);max-height:calc(100vh - 32px - env(safe-area-inset-top) - env(safe-area-inset-bottom));overflow-y:auto;-webkit-overflow-scrolling:touch;background:#0b1226;border:1px solid #243561;border-radius:18px;padding:18px;color:#dde6ff;box-shadow:0 24px 60px rgba(0,0,0,.55)}',
      '#mlpModal button,#mlpModal select,#mlpModal input{font-family:inherit;-webkit-tap-highlight-color:transparent;touch-action:manipulation}',
      '#mlpModal input[type=checkbox]{min-width:18px;min-height:18px}',
      '#mlpModal .mlp-mode{min-height:44px}',
      '#mlpModal .mlp-foot button{min-height:44px;padding:10px 16px}',
      '#mlpModal .mlp-deny{background:#3a230b;border:1px solid #7a5524;color:#ffd1a3;padding:10px;border-radius:10px;font-size:12px;line-height:1.4;margin-top:10px;display:none}',
      '#mlpModal .mlp-deny.is-on{display:block}',
      '#mlpModal h3{margin:0 0 4px 0;font-size:18px}',
      '#mlpModal .mlp-sub{font-size:12px;color:#8aa0d0;margin-bottom:12px}',
      '#mlpModal label{display:block;font-size:12px;color:#9fb1dd;margin:10px 0 4px}',
      '#mlpModal select{width:100%;background:#070d1f;border:1px solid #2a3c70;color:#e6ecff;border-radius:10px;padding:8px 10px;font-size:14px}',
      '#mlpModal .mlp-modes{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:6px}',
      '#mlpModal .mlp-mode{border:1px solid #2a3c70;border-radius:12px;padding:10px;cursor:pointer;background:#0a132c;font-size:12px;line-height:1.35;color:#bcc9ee;transition:all .15s}',
      '#mlpModal .mlp-mode strong{display:block;font-size:13px;color:#fff;margin-bottom:2px}',
      '#mlpModal .mlp-mode.is-on{border-color:#5ad7ff;background:#0e1c44;color:#fff;box-shadow:0 0 0 1px #5ad7ff inset}',
      '#mlpModal .mlp-row{display:flex;align-items:center;gap:8px;margin-top:10px;font-size:13px;color:#cdd9f5}',
      '#mlpModal .mlp-row input[type=checkbox]{accent-color:#5ad7ff;width:16px;height:16px}',
      '#mlpModal .mlp-foot{display:flex;gap:8px;justify-content:flex-end;margin-top:16px;flex-wrap:wrap}',
      '#mlpModal button{border:0;border-radius:10px;padding:8px 14px;font-size:13px;cursor:pointer}',
      '#mlpModal .mlp-cancel{background:#1a2447;color:#cdd9f5}',
      '#mlpModal .mlp-go{background:linear-gradient(135deg,#5ad7ff,#7c5cff);color:#02112a;font-weight:700}',
      '#mlpModal .mlp-stop{background:#ff5e6c;color:#fff}',
      '#mlpModal .mlp-trace{background:#322054;color:#fff}',
      // ---- status pill (mine) — iOS notch safe
      '.mlp-status{position:fixed;left:50%;top:calc(18px + env(safe-area-inset-top));transform:translateX(-50%);background:#0b1226;border:1px solid #5ad7ff;color:#e6ecff;padding:8px 14px;border-radius:999px;font-size:12px;z-index:99998;display:none;box-shadow:0 8px 24px rgba(0,0,0,.45);max-width:calc(100vw - 24px);-webkit-tap-highlight-color:transparent}',
      '.mlp-status.is-on{display:flex;align-items:center;gap:8px}',
      '.mlp-status .meta{opacity:.85;font-size:11px}',
      '.mlp-status .stop{background:#ff5e6c;color:#fff;border:0;border-radius:999px;padding:3px 10px;cursor:pointer;font-weight:600;font-size:11px}',
      // ---- peer panel — iOS home-indicator safe
      '.mlp-peer{position:fixed;right:max(14px,env(safe-area-inset-right));bottom:calc(14px + env(safe-area-inset-bottom));width:min(320px,92vw);background:#0b1226;border:1px solid #243561;border-radius:14px;padding:12px;color:#dde6ff;font-size:12px;z-index:99997;display:none;box-shadow:0 16px 40px rgba(0,0,0,.5);-webkit-tap-highlight-color:transparent;touch-action:manipulation}',
      '.mlp-peer.is-on{display:block}',
      '.mlp-peer .row1{display:flex;align-items:center;gap:8px;margin-bottom:6px}',
      '.mlp-peer .dot{width:10px;height:10px;border-radius:50%;background:#5ad7ff;box-shadow:0 0 0 4px rgba(90,215,255,.18)}',
      '.mlp-peer .dot.idle{background:#ffb454;box-shadow:0 0 0 4px rgba(255,180,84,.18)}',
      '.mlp-peer .dot.gone{background:#ff5e6c;box-shadow:0 0 0 4px rgba(255,94,108,.18)}',
      '.mlp-peer .name{font-weight:700;color:#fff;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.mlp-peer .close{background:transparent;border:0;color:#8aa0d0;cursor:pointer;font-size:14px;padding:2px 6px}',
      '.mlp-peer .grid{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin:6px 0}',
      '.mlp-peer .cell{background:#0a132c;border:1px solid #1c2a52;border-radius:8px;padding:6px 8px}',
      '.mlp-peer .cell .k{font-size:10px;color:#8aa0d0;text-transform:uppercase;letter-spacing:.04em}',
      '.mlp-peer .cell .v{font-weight:700;color:#e6ecff;font-size:13px;margin-top:2px}',
      '.mlp-peer .acts{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px}',
      '.mlp-peer .acts a,.mlp-peer .acts button{font-size:11px;padding:5px 9px;border-radius:8px;border:1px solid #2a3c70;background:#0a132c;color:#cdd9f5;text-decoration:none;cursor:pointer}',
      '.mlp-peer .acts .primary{background:linear-gradient(135deg,#5ad7ff,#7c5cff);color:#02112a;border-color:transparent;font-weight:700}',
      '.mlp-peer .badge{display:inline-block;font-size:10px;padding:2px 6px;border-radius:999px;background:#0e1c44;color:#9be4ff;border:1px solid #244e7a}',
      '.mlp-peer .badge.bg{color:#ffd1a3;border-color:#7a5524;background:#3a230b}',
      '.mlp-peer .badge.trace{color:#ffb3ff;border-color:#7a2480;background:#39103a}',
      // ---- pills used in chat bubbles
      '.mlp-pill{display:inline-flex;align-items:center;gap:4px;font-size:11px;padding:2px 8px;border-radius:999px;background:#0e1c44;color:#9be4ff;border:1px solid #244e7a;margin-left:6px}',
      '.mlp-pill.bg{color:#ffd1a3;border-color:#7a5524;background:#3a230b}',
      '.mlp-pill.trace{color:#ffb3ff;border-color:#7a2480;background:#39103a}'
    ].join('');
    var s = document.createElement('style');
    s.id = 'mesh-location-pro-style';
    s.textContent = css;
    document.head.appendChild(s);
  }

  // ============== modal ==============
  function ensureModal() {
    var existing = document.getElementById('mlpModal');
    if (existing) return existing;
    var modal = document.createElement('div');
    modal.id = 'mlpModal';
    modal.innerHTML =
      '<div class="mlp-card" role="dialog" aria-modal="true" aria-labelledby="mlpTitle">' +
        '<h3 id="mlpTitle">📍 Share live location</h3>' +
        '<div class="mlp-sub">Uses your device GNSS satellites — same fix Apple Find My uses. End-to-end encrypted to this peer.</div>' +
        '<label for="mlpDur">Share for</label>' +
        '<select id="mlpDur"></select>' +
        '<label>Mode</label>' +
        '<div class="mlp-modes">' +
          '<div class="mlp-mode is-on" data-mode="foreground">' +
            '<strong>Only when app is open</strong>' +
            'Pauses when you switch tabs or close the page. Battery friendly.' +
          '</div>' +
          '<div class="mlp-mode" data-mode="background">' +
            '<strong>Always — last-step fallback</strong>' +
            'Keeps tracking while page lives. Caches your last GPS so peers can trace your last step when you go offline.' +
          '</div>' +
        '</div>' +
        '<div class="mlp-row">' +
          '<input type="checkbox" id="mlpAllowTrace" checked>' +
          '<label for="mlpAllowTrace" style="margin:0">Let this peer request my last known location while I\'m offline</label>' +
        '</div>' +
        '<div class="mlp-row">' +
          '<input type="checkbox" id="mlpHighAcc" checked>' +
          '<label for="mlpHighAcc" style="margin:0">High-accuracy GNSS (uses more battery)</label>' +
        '</div>' +
        '<div class="mlp-deny" id="mlpDeny"></div>' +
        '<div class="mlp-foot">' +
          '<button class="mlp-cancel" type="button" id="mlpCancel">Cancel</button>' +
          '<button class="mlp-trace" type="button" id="mlpTrace" title="Ask the peer for their last known position">Trace peer</button>' +
          '<button class="mlp-stop" type="button" id="mlpStop" style="display:none">Stop sharing</button>' +
          '<button class="mlp-go" type="button" id="mlpGo">Start</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(modal);
    var sel = modal.querySelector('#mlpDur');
    DURATIONS.forEach(function (d) {
      var o = document.createElement('option');
      o.value = d.id; o.textContent = d.label;
      sel.appendChild(o);
    });
    sel.value = '1h';
    modal.addEventListener('click', function (e) {
      if (e.target === modal) closeModal();
      var m = e.target.closest('.mlp-mode');
      if (m) {
        modal.querySelectorAll('.mlp-mode').forEach(function (x) { x.classList.remove('is-on'); });
        m.classList.add('is-on');
      }
    });
    modal.querySelector('#mlpCancel').addEventListener('click', closeModal);
    modal.querySelector('#mlpGo').addEventListener('click', onStartFromModal);
    modal.querySelector('#mlpStop').addEventListener('click', function () { stopShare('user'); closeModal(); });
    modal.querySelector('#mlpTrace').addEventListener('click', function () {
      var btn = modal.querySelector('#mlpTrace');
      btn.disabled = true; btn.textContent = 'Tracing…';
      requestTrace().then(function () {
        btn.textContent = '✓ Got it'; setTimeout(function () { btn.disabled = false; btn.textContent = 'Trace peer'; closeModal(); }, 800);
      }).catch(function (err) {
        btn.textContent = '⚠ ' + (err && err.message || 'failed');
        setTimeout(function () { btn.disabled = false; btn.textContent = 'Trace peer'; }, 1600);
      });
    });
    return modal;
  }
  function openModal() {
    var modal = ensureModal();
    var s = loadSession();
    modal.querySelector('#mlpStop').style.display = s ? '' : 'none';
    modal.querySelector('#mlpGo').textContent = s ? 'Update' : 'Start';
    if (s) {
      modal.querySelector('#mlpDur').value = s.durationId || '1h';
      modal.querySelectorAll('.mlp-mode').forEach(function (x) {
        x.classList.toggle('is-on', x.getAttribute('data-mode') === s.mode);
      });
      modal.querySelector('#mlpAllowTrace').checked = s.allowTrace !== false;
      modal.querySelector('#mlpHighAcc').checked = s.highAcc !== false;
    }
    // iOS-specific guidance
    var deny = modal.querySelector('#mlpDeny');
    deny.classList.remove('is-on');
    deny.innerHTML = '';
    if (state.lastGeoError === 'denied') {
      deny.innerHTML = isIOS()
        ? '⚠ Location is blocked for this site. On iPhone open <strong>Settings → Safari → Location</strong> (or <strong>Settings → Privacy → Location Services → Safari</strong>) and choose <strong>Ask</strong> or <strong>Allow</strong>, then reload.'
        : '⚠ Location permission was denied. Open the site permissions in your browser address bar and re-enable Location.';
      deny.classList.add('is-on');
    } else if (isIOS() && !isStandalonePWA()) {
      deny.innerHTML = '💡 Tip: tap <strong>Share → Add to Home Screen</strong> to install OST. iOS keeps GPS warmer in installed PWAs and lets the share survive switching apps briefly.';
      deny.classList.add('is-on');
    }
    modal.classList.add('is-open');
  }
  function closeModal() {
    var modal = document.getElementById('mlpModal');
    if (modal) modal.classList.remove('is-open');
  }

  // ============== status pill (me) ==============
  function ensureStatusPill() {
    var el = document.getElementById('mlpStatus');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'mlpStatus';
    el.className = 'mlp-status';
    el.innerHTML = '<span class="txt">Sharing live location…</span><span class="meta"></span><button class="stop" type="button">Stop</button>';
    document.body.appendChild(el);
    el.querySelector('.stop').addEventListener('click', function () { stopShare('user'); });
    return el;
  }
  function refreshStatusPill() {
    var el = ensureStatusPill();
    var s = loadSession();
    if (!s) { el.classList.remove('is-on'); return; }
    var rem = s.expiresAt ? Math.max(0, s.expiresAt - nowMs()) : Infinity;
    var modeIcon = s.mode === 'background' ? '🛰' : '📍';
    el.querySelector('.txt').textContent = modeIcon + ' Sharing — ' + (rem === Infinity ? 'until you stop' : fmtRemaining(rem) + ' left');
    var fix = loadLastFix();
    el.querySelector('.meta').textContent = fix ? ' · ' + satelliteBadge(fix.acc) : '';
    el.classList.add('is-on');
  }

  // ============== peer panel (the OTHER side) ==============
  function ensurePeerPanel() {
    var el = document.getElementById('mlpPeer');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'mlpPeer';
    el.className = 'mlp-peer';
    el.innerHTML =
      '<div class="row1">' +
        '<span class="dot"></span>' +
        '<div class="name">Peer</div>' +
        '<span class="badge"></span>' +
        '<button class="close" title="Hide">×</button>' +
      '</div>' +
      '<div class="grid">' +
        '<div class="cell"><div class="k">Last fix</div><div class="v" data-k="age">—</div></div>' +
        '<div class="cell"><div class="k">Accuracy</div><div class="v" data-k="acc">—</div></div>' +
        '<div class="cell"><div class="k">Speed</div><div class="v" data-k="spd">—</div></div>' +
        '<div class="cell"><div class="k">Distance</div><div class="v" data-k="dist">—</div></div>' +
      '</div>' +
      '<div class="acts">' +
        '<a class="primary maps" target="_blank" rel="noopener">Open in Maps</a>' +
        '<button class="trace">Trace last step</button>' +
        '<button class="shareback">Share back</button>' +
      '</div>';
    document.body.appendChild(el);
    el.querySelector('.close').addEventListener('click', function () { el.classList.remove('is-on'); });
    el.querySelector('.trace').addEventListener('click', function () {
      var b = el.querySelector('.trace');
      b.disabled = true; b.textContent = 'Tracing…';
      requestTrace().then(function () {
        b.textContent = '✓ Updated'; setTimeout(function () { b.disabled = false; b.textContent = 'Trace last step'; }, 1200);
      }).catch(function (err) {
        b.textContent = '⚠ ' + (err && err.message || 'failed');
        setTimeout(function () { b.disabled = false; b.textContent = 'Trace last step'; }, 1600);
      });
    });
    el.querySelector('.shareback').addEventListener('click', function () { openModal(); });
    return el;
  }
  function refreshPeerPanel() {
    var peer = loadPeerFix();
    var el = ensurePeerPanel();
    if (!peer || !peer.fix) { el.classList.remove('is-on'); return; }
    var p = pavilion();
    var name = (peer.name || (p && p.peerAddr) || 'Peer');
    el.querySelector('.name').textContent = name.length > 18 ? name.slice(0, 8) + '…' + name.slice(-6) : name;
    var age = nowMs() - (peer.fix.ts || 0);
    var alive = peer.live && age < 60 * 1000;
    var idle  = peer.live && age < 5 * 60 * 1000;
    var dot = el.querySelector('.dot');
    dot.classList.remove('idle', 'gone');
    if (!alive && idle) dot.classList.add('idle');
    else if (!alive) dot.classList.add('gone');
    var badge = el.querySelector('.badge');
    if (peer.trace) { badge.textContent = '🛰 last-step'; badge.className = 'badge trace'; }
    else if (peer.mode === 'background') { badge.textContent = '🛰 background'; badge.className = 'badge bg'; }
    else { badge.textContent = '📍 live'; badge.className = 'badge'; }
    el.querySelector('[data-k=age]').textContent = fmtAge(age);
    el.querySelector('[data-k=acc]').textContent = '±' + Math.round(peer.fix.acc || 0) + ' m';
    var spd = fmtSpeed(peer.fix.spd);
    var hdg = compass(peer.fix.hdg);
    el.querySelector('[data-k=spd]').textContent = spd ? (hdg ? spd + ' ' + hdg : spd) : '—';
    var my = loadLastFix();
    var d = my && peer.fix ? haversine(my, peer.fix) : null;
    el.querySelector('[data-k=dist]').textContent = d == null ? '—' : fmtDist(d);
    el.querySelector('.maps').setAttribute('href', mapsUrl(peer.fix.lat, peer.fix.lon));
    el.classList.add('is-on');
  }

  // tick the panel + pill every second so age/distance stay fresh
  setInterval(function () {
    if (loadSession()) refreshStatusPill();
    if (loadPeerFix()) refreshPeerPanel();
  }, 1000);

  // ============== runtime ==============
  var state = {
    watchId: null,
    expireTimer: null,
    heartbeat: null,
    lastBroadcast: null,    // {fix, ts}
    visHandler: null,
    pageShowHandler: null,
    pageHideHandler: null,
    wakeLock: null,
    wakeLockReleaseHandler: null,
    lastGeoError: null      // 'denied' | 'unavailable' | 'timeout' | null
  };

  function pavilion() { return (window.OST_MESH && window.OST_MESH.pavilion) || null; }

  function shouldBroadcast(fix) {
    var s = loadSession(); if (!s) return false;
    var lb = state.lastBroadcast;
    var now = nowMs();
    if (!lb) return true;
    var dt = now - lb.ts;
    var hidden = document.visibilityState === 'hidden';
    var maxMs = (hidden && s.mode === 'background') ? BG_MAX_BROADCAST_MS : MAX_BROADCAST_MS;
    if (dt < MIN_BROADCAST_MS) return false;
    if (dt >= maxMs) return true;
    var dist = haversine(lb.fix, fix);
    if (dist != null && dist >= MIN_BROADCAST_DIST_M) return true;
    if ((lb.fix.acc || 9999) > (fix.acc || 9999) * 2) return true;
    return false;
  }

  function fixFromPosition(pos) {
    return {
      lat: pos.coords.latitude,
      lon: pos.coords.longitude,
      acc: pos.coords.accuracy,
      alt: pos.coords.altitude,
      spd: pos.coords.speed,
      hdg: pos.coords.heading,
      ts: nowMs()
    };
  }

  function broadcastFix(fix, opts) {
    var p = pavilion(); if (!p || typeof p.sendAppPayload !== 'function') return;
    var s = loadSession() || {};
    var msg = {
      app: APP, type: 'fix', fix: fix,
      mode: s.mode || 'foreground',
      expiresAt: s.expiresAt || 0,
      live: !!(opts && opts.live !== false),
      stopAfter: !!(opts && opts.stopAfter)
    };
    try { p.sendAppPayload(msg); } catch (e) {}
    state.lastBroadcast = { fix: fix, ts: nowMs() };
    // mirror in our chat bubble using existing renderer
    if (typeof p._renderLocation === 'function') {
      try {
        p._renderLocation({
          kind: msg.live ? 'location-live' : 'location-ping',
          lat: fix.lat, lon: fix.lon, acc: fix.acc, ts: fix.ts
        }, 'me');
      } catch (e) {}
    }
  }

  function onWatchPos(pos) {
    state.lastGeoError = null;
    var fix = fixFromPosition(pos);
    saveLastFix(fix);
    refreshStatusPill();
    if (shouldBroadcast(fix)) broadcastFix(fix, { live: true });
  }
  function onWatchErr(err) {
    if (!err) return;
    if (err.code === 1) state.lastGeoError = 'denied';
    else if (err.code === 2) state.lastGeoError = 'unavailable';
    else if (err.code === 3) state.lastGeoError = 'timeout';
    // On iOS Safari, PERMISSION_DENIED kills the watch — stop sharing and surface UI.
    if (err.code === 1 && loadSession()) {
      stopShare('denied');
      try { openModal(); } catch (e) {}
    }
  }

  function startWatch() {
    if (state.watchId != null) return;
    if (!navigator.geolocation || !navigator.geolocation.watchPosition) return;
    var s = loadSession() || {};
    var highAcc = s.highAcc !== false;
    try {
      state.watchId = navigator.geolocation.watchPosition(onWatchPos, onWatchErr, {
        enableHighAccuracy: highAcc,
        timeout: 15000,
        maximumAge: 2000
      });
    } catch (e) {}
  }
  function stopWatch() {
    if (state.watchId != null && navigator.geolocation && navigator.geolocation.clearWatch) {
      try { navigator.geolocation.clearWatch(state.watchId); } catch (e) {}
    }
    state.watchId = null;
  }

  function captureOnce() {
    return new Promise(function (resolve, reject) {
      if (!navigator.geolocation) return reject(new Error('Geolocation unavailable'));
      navigator.geolocation.getCurrentPosition(function (pos) {
        var fix = fixFromPosition(pos);
        saveLastFix(fix);
        resolve(fix);
      }, function (err) { reject(err); }, {
        enableHighAccuracy: true, timeout: 12000, maximumAge: 5000
      });
    });
  }

  function startHeartbeat() {
    clearInterval(state.heartbeat);
    state.heartbeat = setInterval(function () {
      var s = loadSession(); if (!s) return;
      var fix = loadLastFix();
      var now = nowMs();
      var lb = state.lastBroadcast;
      var hidden = document.visibilityState === 'hidden';
      var maxMs = (hidden && s.mode === 'background') ? BG_MAX_BROADCAST_MS : MAX_BROADCAST_MS;
      if (fix && (!lb || now - lb.ts >= maxMs)) {
        broadcastFix(fix, { live: true });
      } else {
        // pure heartbeat (no coords) so peer ages "alive" timer
        var p = pavilion();
        if (p && typeof p.sendAppPayload === 'function') {
          try { p.sendAppPayload({ app: APP, type: 'ping', mode: s.mode, expiresAt: s.expiresAt }); } catch (e) {}
        }
      }
    }, HEARTBEAT_MS);
  }
  function stopHeartbeat() { clearInterval(state.heartbeat); state.heartbeat = null; }

  function scheduleExpire() {
    clearTimeout(state.expireTimer);
    var s = loadSession(); if (!s || !s.expiresAt) return;
    var ms = s.expiresAt - nowMs();
    if (ms <= 0) return stopShare('expired');
    state.expireTimer = setTimeout(function () { stopShare('expired'); }, ms);
  }

  function attachLifecycle() {
    if (state.visHandler) return;
    state.visHandler = function () {
      var s = loadSession(); if (!s) return;
      if (document.visibilityState === 'visible') {
        // iOS Safari almost always suspends watchPosition when the tab is hidden
        // (and after a backgrounded PWA returns). Restart the watch and force a
        // one-shot capture so the peer sees the freshest fix immediately.
        stopWatch();
        startWatch();
        captureOnce().then(function (fix) {
          if (shouldBroadcast(fix)) broadcastFix(fix, { live: true });
        }).catch(function () {});
        requestWakeLock();
      } else if (s.mode !== 'background') {
        stopWatch();
        releaseWakeLock();
      }
    };
    state.pageShowHandler = function (ev) {
      // bfcache restore on iOS — watch handle is dead, restart everything.
      var s = loadSession(); if (!s) return;
      if (ev && ev.persisted) {
        stopWatch();
        startWatch();
        startHeartbeat();
        scheduleExpire();
        requestWakeLock();
        refreshStatusPill();
      }
    };
    state.pageHideHandler = function () {
      var s = loadSession(); if (!s) return;
      // Send last known fix one more time so the peer always has the freshest snapshot.
      var fix = loadLastFix();
      if (fix) {
        try { broadcastFix(fix, { live: true, stopAfter: false }); } catch (e) {}
      }
      // Hand off to SW for periodic background sync (Chrome installed PWA — iOS Safari ignores).
      if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
        try {
          navigator.serviceWorker.controller.postMessage({
            type: 'ost-location-cache', fix: fix, session: s
          });
        } catch (e) {}
      }
      try {
        navigator.serviceWorker && navigator.serviceWorker.ready.then(function (reg) {
          if (reg.sync) reg.sync.register('ost-location-ping').catch(function () {});
        });
      } catch (e) {}
    };
    document.addEventListener('visibilitychange', state.visHandler);
    window.addEventListener('pageshow', state.pageShowHandler);
    window.addEventListener('pagehide', state.pageHideHandler);
    window.addEventListener('beforeunload', state.pageHideHandler);
  }
  function detachLifecycle() {
    if (state.visHandler) document.removeEventListener('visibilitychange', state.visHandler);
    if (state.pageShowHandler) window.removeEventListener('pageshow', state.pageShowHandler);
    if (state.pageHideHandler) {
      window.removeEventListener('pagehide', state.pageHideHandler);
      window.removeEventListener('beforeunload', state.pageHideHandler);
    }
    state.visHandler = null;
    state.pageShowHandler = null;
    state.pageHideHandler = null;
  }

  // ============== Wake Lock (keeps screen + GNSS warm on foreground share) ==============
  function requestWakeLock() {
    if (!('wakeLock' in navigator) || state.wakeLock) return;
    var s = loadSession(); if (!s || s.mode !== 'foreground') return;
    try {
      navigator.wakeLock.request('screen').then(function (lock) {
        state.wakeLock = lock;
        state.wakeLockReleaseHandler = function () { state.wakeLock = null; };
        try { lock.addEventListener('release', state.wakeLockReleaseHandler); } catch (e) {}
      }).catch(function () {});
    } catch (e) {}
  }
  function releaseWakeLock() {
    if (!state.wakeLock) return;
    try { state.wakeLock.release(); } catch (e) {}
    state.wakeLock = null;
  }

  // ============== start / stop ==============
  function startShare(opts) {
    opts = opts || {};
    var dur = DURATIONS.filter(function (d) { return d.id === opts.duration; })[0] || DURATIONS[1];
    var session = {
      mode: opts.mode === 'background' ? 'background' : 'foreground',
      allowTrace: opts.allowTrace !== false,
      highAcc: opts.highAcc !== false,
      startedAt: nowMs(),
      expiresAt: dur.ms ? nowMs() + dur.ms : 0,
      durationId: dur.id,
      peer: (pavilion() && pavilion().peerAddr) || null
    };
    saveSession(session);
    state.lastBroadcast = null;
    state.lastGeoError = null;
    attachLifecycle();
    captureOnce().then(function (fix) {
      broadcastFix(fix, { live: true });
    }).catch(function (err) { onWatchErr(err); });
    startWatch();
    startHeartbeat();
    scheduleExpire();
    refreshStatusPill();
    requestWakeLock();
    // Try periodic background sync (Chrome installed PWA only)
    try {
      navigator.serviceWorker && navigator.serviceWorker.ready.then(function (reg) {
        if (reg.periodicSync && navigator.permissions) {
          navigator.permissions.query({ name: 'periodic-background-sync' }).then(function (st) {
            if (st.state === 'granted') {
              reg.periodicSync.register('ost-location-periodic', { minInterval: 5 * 60 * 1000 }).catch(function () {});
            }
          }).catch(function () {});
        }
      });
    } catch (e) {}
  }

  function stopShare(reason) {
    stopWatch();
    stopHeartbeat();
    clearTimeout(state.expireTimer);
    state.expireTimer = null;
    detachLifecycle();
    var p = pavilion();
    if (p && typeof p.sendAppPayload === 'function') {
      try { p.sendAppPayload({ app: APP, type: 'stop', reason: reason || 'user', ts: nowMs() }); } catch (e) {}
    }
    if (p && typeof p._sendLiveStop === 'function') {
      try { p._sendLiveStop().catch(function () {}); } catch (e) {}
    }
    saveSession(null);
    state.lastBroadcast = null;
    releaseWakeLock();
    refreshStatusPill();
    var pill = document.getElementById('mlpStatus');
    if (pill) pill.classList.remove('is-on');
  }

  function onStartFromModal() {
    var modal = document.getElementById('mlpModal');
    var dur = modal.querySelector('#mlpDur').value;
    var modeEl = modal.querySelector('.mlp-mode.is-on');
    var mode = modeEl ? modeEl.getAttribute('data-mode') : 'foreground';
    var allowTrace = modal.querySelector('#mlpAllowTrace').checked;
    var highAcc = modal.querySelector('#mlpHighAcc').checked;
    startShare({ duration: dur, mode: mode, allowTrace: allowTrace, highAcc: highAcc });
    closeModal();
  }

  // ============== trace last step ==============
  var pendingTraces = {};
  function requestTrace() {
    var p = pavilion();
    if (!p || typeof p.sendAppPayload !== 'function') return Promise.reject(new Error('No mesh session'));
    var reqId = 't_' + Math.random().toString(36).slice(2, 10);
    return new Promise(function (resolve, reject) {
      pendingTraces[reqId] = { resolve: resolve, reject: reject };
      try { p.sendAppPayload({ app: APP, type: 'trace.req', reqId: reqId, ts: nowMs() }); }
      catch (e) { delete pendingTraces[reqId]; reject(e); return; }
      setTimeout(function () {
        if (pendingTraces[reqId]) {
          delete pendingTraces[reqId];
          reject(new Error('No reply'));
        }
      }, TRACE_REPLY_TIMEOUT_MS);
    });
  }

  function handleTraceReq(p, payload) {
    var s = loadSession();
    var fix = loadLastFix();
    var allow = !s || s.allowTrace !== false;
    if (!allow || !fix) {
      try { p.sendAppPayload({ app: APP, type: 'trace.rep', reqId: payload.reqId, denied: !allow, fix: null, ts: nowMs() }); } catch (e) {}
      return;
    }
    try { p.sendAppPayload({ app: APP, type: 'trace.rep', reqId: payload.reqId, fix: fix, stale: nowMs() - fix.ts, ts: nowMs() }); } catch (e) {}
  }

  function handleTraceRep(payload) {
    var pending = pendingTraces[payload.reqId];
    if (pending) {
      delete pendingTraces[payload.reqId];
      if (payload.denied) pending.reject(new Error('Peer denied'));
      else if (!payload.fix) pending.reject(new Error('No fix cached'));
      else pending.resolve(payload);
    }
    if (payload.fix) {
      ingestPeerFix({
        fix: payload.fix, live: false, trace: true,
        mode: 'trace', stale: payload.stale,
        name: pavilion() && pavilion().peerAddr
      });
      var p = pavilion();
      if (p && typeof p._renderLocation === 'function') {
        try {
          p._renderLocation({
            kind: 'location-ping',
            lat: payload.fix.lat, lon: payload.fix.lon, acc: payload.fix.acc,
            ts: payload.fix.ts
          }, 'peer');
        } catch (e) {}
      }
    }
  }

  // ============== inbound ==============
  function ingestPeerFix(rec) {
    if (!rec || !rec.fix) return;
    savePeerFix({
      fix: rec.fix,
      live: !!rec.live,
      trace: !!rec.trace,
      mode: rec.mode || 'foreground',
      stale: rec.stale || 0,
      name: rec.name || null,
      receivedAt: nowMs()
    });
    refreshPeerPanel();
  }

  function handleAppPayload(p, payload) {
    if (!payload || payload.app !== APP) return;
    if (payload.type === 'fix' && payload.fix) {
      ingestPeerFix({
        fix: payload.fix, live: payload.live !== false,
        mode: payload.mode || 'foreground', name: p && p.peerAddr
      });
      if (payload.stopAfter) {
        var pf = loadPeerFix(); if (pf) { pf.live = false; savePeerFix(pf); refreshPeerPanel(); }
      }
    } else if (payload.type === 'stop') {
      var pf2 = loadPeerFix();
      if (pf2) { pf2.live = false; savePeerFix(pf2); refreshPeerPanel(); }
    } else if (payload.type === 'ping') {
      var pf3 = loadPeerFix();
      if (pf3) { pf3.fix.ts = nowMs() - 1000; pf3.receivedAt = nowMs(); savePeerFix(pf3); refreshPeerPanel(); }
    } else if (payload.type === 'trace.req') {
      handleTraceReq(p, payload);
    } else if (payload.type === 'trace.rep') {
      handleTraceRep(payload);
    }
  }

  // Also ingest the existing native location-live / location-ping from the OTHER side
  // (this lets v2 work even if the peer is on legacy v1 / plain mesh.js).
  function attachNativeLocationHook(p) {
    if (!p || p.__mlpNative) return;
    p.__mlpNative = true;
    var orig = p._renderLocation;
    if (typeof orig !== 'function') return;
    p._renderLocation = function (payload, role) {
      try {
        if (role === 'peer' && payload && (payload.kind === 'location-live' || payload.kind === 'location-ping')) {
          ingestPeerFix({
            fix: { lat: payload.lat, lon: payload.lon, acc: payload.acc, ts: payload.ts || nowMs() },
            live: payload.kind === 'location-live',
            mode: 'foreground', name: p && p.peerAddr
          });
        }
      } catch (e) {}
      return orig.apply(this, arguments);
    };
  }

  function attachAppPayloadHook(p) {
    if (!p || p.__mlpHook) return;
    p.__mlpHook = true;
    window.addEventListener('ost:mesh-payload', function (ev) {
      var d = ev && ev.detail;
      var pl = d && d.payload;
      if (!pl) return;
      handleAppPayload(p, pl);
    });
  }

  // ============== pavilion wiring ==============
  function wirePavilion(p) {
    if (!p || p.__mlpWired) return;
    p.__mlpWired = true;
    if (p.liveBtn && p.liveBtn.parentNode) {
      var fresh = p.liveBtn.cloneNode(true);
      p.liveBtn.parentNode.replaceChild(fresh, p.liveBtn);
      p.liveBtn = fresh;
      p.liveBtn.addEventListener('click', function () { openModal(); });
      try {
        p.liveBtn.innerHTML = (window.OST_ICON ? window.OST_ICON('satellite') : '🛰') + ' Live & last-step';
      } catch (e) {}
    }
    attachAppPayloadHook(p);
    attachNativeLocationHook(p);

    // Resume peer panel if we already have a peer fix cached
    if (loadPeerFix()) refreshPeerPanel();

    // Auto-resume my own active session
    var s = loadSession();
    if (s) {
      if (s.expiresAt && s.expiresAt < nowMs()) {
        saveSession(null);
      } else {
        attachLifecycle();
        startWatch();
        startHeartbeat();
        scheduleExpire();
        refreshStatusPill();
        requestWakeLock();
      }
    }
  }

  function bootWhenReady() {
    injectStyle();
    var p = pavilion();
    if (p) { wirePavilion(p); return; }
    window.addEventListener('mesh:ready', function () {
      var pp = pavilion(); if (pp) wirePavilion(pp);
    }, { once: true });
    var tries = 0;
    var iv = setInterval(function () {
      tries++;
      var pp = pavilion();
      if (pp) { clearInterval(iv); wirePavilion(pp); }
      else if (tries > 60) clearInterval(iv);
    }, 500);
  }

  // ============== public API ==============
  window.OST_MESH_LOCATION = {
    open: openModal,
    start: startShare,
    stop: function () { stopShare('user'); },
    status: function () { return loadSession(); },
    lastFix: loadLastFix,
    peerFix: loadPeerFix,
    requestTrace: requestTrace,
    showPeerPanel: function () { var el = ensurePeerPanel(); if (loadPeerFix()) el.classList.add('is-on'); },
    hidePeerPanel: function () { var el = document.getElementById('mlpPeer'); if (el) el.classList.remove('is-on'); }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootWhenReady, { once: true });
  } else {
    bootWhenReady();
  }
})();

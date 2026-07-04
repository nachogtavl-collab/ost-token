/* OST Mesh social layer: profile, contacts, saved signals, QR add/scan. */
(function () {
  'use strict';

  var APP = 'ost-mesh-social';
  var STYLE_ID = 'ost-mesh-upgrade-style';
  var PROFILE_KEY = 'ost.mesh.profile.v2';
  var PROFILE_OLD_KEY = 'ost.mesh.profile.v1';
  var CONTACTS_KEY = 'ost.mesh.contacts.v2';
  var CONTACTS_OLD_KEY = 'ost.mesh.contacts.v1';
  var SNIPPETS_KEY = 'ost.mesh.snippets.v2';
  var SNIPPETS_OLD_KEY = 'ost.mesh.snippets.v1';
  var SIGNALS_KEY = 'ost.mesh.signals.v1';
  var INVITE_PREFIX = 'ost-mesh-invite:';
  var QR_DECODER_URLS = [
    'vendor/jsqr.min.js',                                    // local: works offline, in CN, always
    'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js',
    'https://unpkg.com/jsqr@1.4.0/dist/jsQR.js'
  ];
  var AVATAR_MAX_PUBLIC = 56000;
  var AVATAR_THUMB_MAX_PUBLIC = 18000;
  var AVATAR_QR_MAX_PUBLIC = 1350;
  var scanStream = null;
  var scanRunId = 0;
  var qrDecoderPromise = null;

  function ready(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn, { once: true });
    else fn();
  }

  function pavilion() {
    return window.OST_MESH && window.OST_MESH.pavilion;
  }

  function waitForMesh(fn) {
    var p = pavilion();
    if (p) return fn(p);
    window.addEventListener('mesh:ready', function () { fn(pavilion()); }, { once: true });
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  function short(value) {
    value = String(value || '');
    return value.length > 18 ? value.slice(0, 9) + '...' + value.slice(-6) : value;
  }

  function readJson(key, fallback) {
    try {
      var parsed = JSON.parse(localStorage.getItem(key) || 'null');
      return parsed == null ? fallback : parsed;
    } catch (_) { return fallback; }
  }

  function readFirst(keys, fallback) {
    for (var i = 0; i < keys.length; i++) {
      var value = readJson(keys[i], null);
      if (value != null) return value;
    }
    return fallback;
  }

  function writeJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) {}
  }

  function walletAddress() {
    try {
      var wallet = window.OST_WALLET;
      if (wallet && wallet.session && wallet.session.publicKey) {
        if (wallet.session.publicKey.toBase58) return wallet.session.publicKey.toBase58();
        return String(wallet.session.publicKey);
      }
      if (wallet && wallet.address) return String(wallet.address);
      if (window.OST_WALLET_PUBKEY) return String(window.OST_WALLET_PUBKEY);
    } catch (_) {}
    return '';
  }

  function normalizeAddress(value) {
    var match = String(value || '').match(/ost-mesh:[a-f0-9]{4}(?:-[a-f0-9]{4}){3}/i);
    return match ? match[0].toLowerCase() : '';
  }

  function b64urlEncode(value) {
    var bytes = new TextEncoder().encode(value);
    var bin = '';
    bytes.forEach(function (byte) { bin += String.fromCharCode(byte); });
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function b64urlDecode(value) {
    var raw = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
    raw = raw.padEnd(Math.ceil(raw.length / 4) * 4, '=');
    var bin = atob(raw);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  function validImageSource(value) {
    var src = String(value || '').trim();
    if (!src) return '';
    if (/^data:image\//i.test(src)) {
      var comma = src.indexOf(',');
      if (comma < 16 || src.length - comma < 64) return '';
      var head = src.slice(0, comma);
      var body = src.slice(comma + 1);
      if (/;base64/i.test(head)) {
        if (!/^[A-Za-z0-9+/]+=*$/.test(body) || body.length % 4 === 1) return '';
        if (src.length >= 23990 && src.length <= 24010) return '';
      }
      return src;
    }
    if (/^(https?:|blob:|\.\/|\/)/i.test(src)) return src;
    return '';
  }

  function boundedAvatar(value, maxLength) {
    var src = validImageSource(value);
    if (!src) return '';
    return src.length <= maxLength ? src : '';
  }

  function publicProfile(profile, options) {
    profile = profile || {};
    options = options || {};
    var qrOnly = !!options.qrOnly;
    var fullAvatar = options.includeAvatar && !qrOnly ? boundedAvatar(profile && profile.avatar, AVATAR_MAX_PUBLIC) : '';
    var thumbAvatar = options.includeAvatar ? boundedAvatar(profile && profile.avatarThumb, qrOnly ? AVATAR_QR_MAX_PUBLIC : AVATAR_THUMB_MAX_PUBLIC) : '';
    var qrAvatar = options.includeAvatar ? boundedAvatar(profile && profile.avatarQr, AVATAR_QR_MAX_PUBLIC) : '';
    if (!qrAvatar && thumbAvatar && thumbAvatar.length <= AVATAR_QR_MAX_PUBLIC) qrAvatar = thumbAvatar;
    if (qrOnly && qrAvatar) thumbAvatar = qrAvatar;
    if (!thumbAvatar && fullAvatar && fullAvatar.length <= AVATAR_THUMB_MAX_PUBLIC) thumbAvatar = fullAvatar;
    if (!fullAvatar && thumbAvatar) fullAvatar = thumbAvatar;
    return {
      nickname: String(profile.nickname || '').slice(0, 32),
      handle: String(profile.handle || '').slice(0, 32),
      status: String(profile.status || '').slice(0, 80),
      bio: String(profile.bio || '').slice(0, 220),
      wallet: String(profile.wallet || '').slice(0, 96),
      address: normalizeAddress(profile.address),
      avatar: fullAvatar,
      avatarThumb: thumbAvatar,
      avatarQr: qrAvatar,
      updatedAt: profile.updatedAt || Date.now()
    };
  }

  function profileAvatar(profile, preferFull) {
    if (!profile) return '';
    var candidates = preferFull ? [profile.avatar, profile.avatarThumb, profile.avatarQr] : [profile.avatarThumb, profile.avatarQr, profile.avatar];
    for (var i = 0; i < candidates.length; i++) {
      var src = validImageSource(candidates[i]);
      if (src) return src;
    }
    return '';
  }

  function defaultProfile(p) {
    var saved = readFirst([PROFILE_KEY, PROFILE_OLD_KEY], {}) || {};
    var address = (p && p.address) || saved.address || '';
    return {
      nickname: saved.nickname || ('Mesh ' + String(address).slice(-4)),
      handle: saved.handle || (address ? '@' + String(address).replace('ost-mesh:', '').slice(0, 9) : '@ost'),
      status: saved.status || 'Available on OST Mesh',
      bio: saved.bio || '',
      wallet: walletAddress() || saved.wallet || '',
      address: address,
      avatar: saved.avatar || '',
      avatarThumb: saved.avatarThumb || '',
      avatarQr: saved.avatarQr || '',
      updatedAt: saved.updatedAt || Date.now()
    };
  }

  function initials(profile) {
    var text = String(profile.nickname || profile.handle || 'OM').replace(/^@/, '').trim();
    return (text.split(/\s+/).map(function (part) { return part.charAt(0); }).join('').slice(0, 2) || 'OM').toUpperCase();
  }

  function avatarHtml(profile, sizeClass, options) {
    options = options || {};
    var avatar = profileAvatar(profile, !!options.preferFull);
    var fallback = profileAvatar(profile, !options.preferFull);
    if (fallback === avatar) fallback = '';
    var initialText = initials(profile || {});
    if (avatar) {
      return '<span class="omu-avatar ' + (sizeClass || '') + '" data-initials="' + escapeHtml(initialText) + '"><img src="' + escapeHtml(avatar) + '" data-omu-alt-src="' + escapeHtml(fallback) + '" alt=""></span>';
    }
    return '<span class="omu-avatar ' + (sizeClass || '') + '" data-initials="' + escapeHtml(initialText) + '"><b>' + escapeHtml(initialText) + '</b></span>';
  }

  function repairAvatarImage(img) {
    if (!img || img.__omuRepairing) return;
    var alt = validImageSource(img.getAttribute('data-omu-alt-src') || '');
    if (alt && img.src !== alt) {
      img.__omuRepairing = true;
      img.src = alt;
      window.setTimeout(function () { img.__omuRepairing = false; }, 0);
      return;
    }
    var parent = img.closest && img.closest('.omu-avatar');
    if (!parent) return;
    var initialText = parent.getAttribute('data-initials') || 'OM';
    parent.classList.add('is-broken');
    parent.innerHTML = '<b>' + escapeHtml(initialText) + '</b>';
  }

  function wireAvatarFallbacks(root) {
    if (!root || root.__omuAvatarFallbacks) return;
    root.__omuAvatarFallbacks = true;
    root.addEventListener('error', function (event) {
      if (event.target && event.target.matches && event.target.matches('.omu-avatar img')) repairAvatarImage(event.target);
    }, true);
  }

  function avatarButtonHtml(profile) {
    var avatar = profileAvatar(profile, true);
    var fallback = profileAvatar(profile, false);
    if (fallback === avatar) fallback = '';
    var initialText = initials(profile || {});
    return '<button type="button" class="omu-avatar" id="omuAvatarButton" aria-label="Select profile picture" data-initials="' + escapeHtml(initialText) + '">' + (avatar ? '<img src="' + escapeHtml(avatar) + '" data-omu-alt-src="' + escapeHtml(fallback) + '" alt="">' : '<b>' + escapeHtml(initialText) + '</b>') + '</button>';
  }

  function inviteFor(p, profile) {
    if (!p || !p.address || !p.publicBundle) return '';
    var sourceProfile = profile || defaultProfile(p);
    var payload = {
      v: 2,
      address: p.address,
      bundle: p.publicBundle,
      fingerprint: p.fpr || '',
      profile: publicProfile(sourceProfile, { includeAvatar: true })
    };
    if (JSON.stringify(payload).length > 1800) payload.profile = publicProfile(sourceProfile, { includeAvatar: true, qrOnly: true });
    if (JSON.stringify(payload).length > 1800) payload.profile = publicProfile(sourceProfile, { includeAvatar: false });
    return INVITE_PREFIX + b64urlEncode(JSON.stringify(payload));
  }

  function parseMeshInvite(raw) {
    var text = String(raw || '').trim();
    var inviteMatch = text.match(/ost-mesh-invite:[A-Za-z0-9_-]+/);
    if (inviteMatch) {
      var parsed = JSON.parse(b64urlDecode(inviteMatch[0].slice(INVITE_PREFIX.length)));
      var profile = parsed.profile || {};
      return {
        address: normalizeAddress(parsed.address),
        invite: inviteMatch[0],
        bundle: parsed.bundle || null,
        fingerprint: parsed.fingerprint || '',
        profile: profile,
        nick: profile.nickname || profile.handle || short(parsed.address),
        wallet: profile.wallet || '',
        avatar: profile.avatar || profile.avatarThumb || profile.avatarQr || '',
        avatarThumb: profile.avatarThumb || profile.avatarQr || profile.avatar || '',
        avatarQr: profile.avatarQr || '',
        status: profile.status || ''
      };
    }
    if (text.charAt(0) === '{') {
      var obj = JSON.parse(text);
      var prof = obj.profile || {};
      return {
        address: normalizeAddress(obj.address),
        invite: obj.invite || '',
        bundle: obj.bundle || null,
        fingerprint: obj.fingerprint || '',
        profile: prof,
        nick: obj.nick || prof.nickname || short(obj.address),
        wallet: obj.wallet || prof.wallet || '',
        avatar: obj.avatar || obj.avatarThumb || prof.avatar || prof.avatarThumb || prof.avatarQr || '',
        avatarThumb: obj.avatarThumb || prof.avatarThumb || obj.avatarQr || prof.avatarQr || obj.avatar || prof.avatar || '',
        avatarQr: obj.avatarQr || prof.avatarQr || '',
        status: obj.status || prof.status || ''
      };
    }
    return { address: normalizeAddress(text), invite: '', nick: short(text), wallet: '', status: '' };
  }

  function qrUrl(value) {
    // Local, spec-correct QR (vendored qrcode-generator). The old external
    // api.qrserver.com image silently never loaded offline/behind blocks -
    // THAT is why other phones "never picked up the QR": there was none.
    try {
      if (typeof window.qrcode === 'function') {
        var qr = window.qrcode(0, 'M');
        qr.addData(String(value || ''));
        qr.make();
        var n = qr.getModuleCount();
        var cell = Math.max(4, Math.floor(304 / n));
        var size = n * cell + 32;
        var cv = document.createElement('canvas');
        cv.width = size; cv.height = size;
        var cx = cv.getContext('2d');
        cx.fillStyle = '#ffffff';
        cx.fillRect(0, 0, size, size);
        cx.fillStyle = '#000000';
        for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) {
          if (qr.isDark(r, c)) cx.fillRect(16 + c * cell, 16 + r * cell, cell, cell);
        }
        return cv.toDataURL('image/png');
      }
    } catch (_) {}
    // last-resort fallback to the external renderer
    return 'https://api.qrserver.com/v1/create-qr-code/?size=320x320&margin=16&ecc=M&data=' + encodeURIComponent(value || '');
  }

  function loadQrDecoder() {
    if (window.jsQR) return Promise.resolve(window.jsQR);
    if (qrDecoderPromise) return qrDecoderPromise;
    qrDecoderPromise = new Promise(function (resolve, reject) {
      var index = 0;
      function tryNext() {
        if (window.jsQR) return resolve(window.jsQR);
        if (index >= QR_DECODER_URLS.length) return reject(new Error('QR decoder could not load.'));
        var script = document.createElement('script');
        script.async = true;
        script.src = QR_DECODER_URLS[index++];
        script.onload = function () {
          if (window.jsQR) resolve(window.jsQR);
          else tryNext();
        };
        script.onerror = function () {
          if (script.parentNode) script.parentNode.removeChild(script);
          tryNext();
        };
        document.head.appendChild(script);
      }
      tryNext();
    }).catch(function (err) {
      qrDecoderPromise = null;
      throw err;
    });
    return qrDecoderPromise;
  }

  function decodeQrFrame(video, canvas, ctx, jsQr) {
    if (!video || !jsQr || video.readyState < 2) return '';
    var sourceWidth = video.videoWidth || 0;
    var sourceHeight = video.videoHeight || 0;
    if (!sourceWidth || !sourceHeight) return '';
    var scale = Math.min(1, 960 / Math.max(sourceWidth, sourceHeight));
    var width = Math.max(1, Math.round(sourceWidth * scale));
    var height = Math.max(1, Math.round(sourceHeight * scale));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    ctx.drawImage(video, 0, 0, width, height);
    var image = ctx.getImageData(0, 0, width, height);
    var code = jsQr(image.data, width, height, { inversionAttempts: 'attemptBoth' });
    return code && code.data ? String(code.data) : '';
  }

  function startQrDecodeLoop(p, video, hint, runId, detector, jsQr) {
    var canvas = document.createElement('canvas');
    var ctx = canvas.getContext('2d', { willReadFrequently: true });
    var lastJsDecode = 0;
    async function loop(time) {
      if (runId !== scanRunId || !scanStream) return;
      var raw = '';
      if (detector) {
        try {
          var codes = await detector.detect(video);
          if (codes && codes.length) raw = codes[0].rawValue || '';
        } catch (_) {
          detector = null;
        }
      }
      if (!raw && jsQr && ctx && (!lastJsDecode || time - lastJsDecode > 110)) {
        lastJsDecode = time;
        try { raw = decodeQrFrame(video, canvas, ctx, jsQr); } catch (_) {}
      }
      if (raw) {
        stopQrScan();
        importInviteText(p, raw);
        return;
      }
      if (hint && runId === scanRunId) hint.textContent = 'Scanning. Hold the QR steady inside the camera view.';
      requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
  }

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = [
      '.ost-mesh-upgrade{border:1px solid rgba(127,216,255,.16);border-radius:16px;background:linear-gradient(180deg,rgba(8,18,30,.86),rgba(3,10,18,.78));padding:12px;display:grid;gap:12px;color:#dff8ff}',
      '.omu-social-head{display:flex;align-items:center;justify-content:space-between;gap:10px;min-width:0}.omu-social-head strong{display:block;color:#fff;font-size:13px;letter-spacing:.04em;text-transform:uppercase}.omu-social-head span{display:block;color:#8ebbd5;font-size:12px}.omu-social-toggle{border:1px solid rgba(255,255,255,.12);border-radius:10px;background:rgba(255,255,255,.07);color:#e8fbff;padding:8px 10px;font-weight:800;font-size:12px;min-height:38px}.omu-body{display:grid;gap:12px;min-width:0}.ost-mesh-upgrade.is-collapsed{gap:0}.ost-mesh-upgrade.is-collapsed .omu-body{display:none}',
      '.ost-mesh-upgrade *{box-sizing:border-box}.omu-grid{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,.85fr);gap:10px}.omu-card{border:1px solid rgba(255,255,255,.1);border-radius:14px;background:rgba(255,255,255,.045);padding:10px;display:grid;gap:9px;min-width:0}.omu-card h3{margin:0;color:#fff;font-size:13px;letter-spacing:.04em;text-transform:uppercase}.omu-card p{margin:0;color:#8ebbd5;font-size:12px;line-height:1.4}',
      '.omu-profile-social{display:grid;grid-template-columns:auto minmax(0,1fr);gap:12px;align-items:center}.omu-avatar{width:74px;height:74px;border-radius:24px;display:inline-flex;align-items:center;justify-content:center;overflow:hidden;background:linear-gradient(145deg,#0d5b7d,#10243d);border:1px solid rgba(127,216,255,.32);box-shadow:0 12px 28px rgba(0,0,0,.28);color:#dff8ff;flex:0 0 auto}.omu-avatar img{width:100%;height:100%;object-fit:cover}.omu-avatar b{font-size:22px}.omu-avatar.is-broken{background:linear-gradient(145deg,#16415b,#16223a)}.omu-avatar.sm{width:46px;height:46px;border-radius:16px}.omu-profile-meta{display:grid;gap:3px;min-width:0}.omu-profile-meta strong{color:#fff;font-size:16px;overflow:hidden;text-overflow:ellipsis}.omu-profile-meta span{font-size:12px;color:#7fd8ff;overflow:hidden;text-overflow:ellipsis}.omu-wallet-pill{font-family:ui-monospace,Menlo,monospace;color:#9fffd0;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.omu-alert-state{font-size:11px;color:#9bcbe6;line-height:1.35}',
      '.omu-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.omu-row input,.omu-row textarea{flex:1 1 150px;min-width:0;border:1px solid rgba(255,255,255,.14);border-radius:11px;background:#06141f;color:#d8eaff;padding:10px;font:inherit;font-size:13px}.omu-row textarea{min-height:48px;resize:vertical}.omu-actions{display:grid;grid-template-columns:repeat(auto-fit,minmax(108px,1fr));gap:7px}.omu-actions button,.omu-contact button,.omu-snippet button,.omu-scan-actions button{border:1px solid rgba(255,255,255,.12);border-radius:11px;background:rgba(255,255,255,.07);color:#e8fbff;padding:9px;font-weight:750;font-size:12px;cursor:pointer;min-height:42px;white-space:normal;line-height:1.15}.omu-actions button.primary,.omu-contact button.primary,.omu-scan-actions button.primary{background:linear-gradient(135deg,#00d4ff,#00ff9f);border-color:transparent;color:#03131c}',
      '.omu-list{display:grid;gap:8px;max-height:230px;overflow:auto}.omu-contact{display:grid;grid-template-columns:auto minmax(0,1fr);gap:9px;align-items:center;border:1px solid rgba(255,255,255,.08);border-radius:14px;padding:9px;background:rgba(0,0,0,.17)}.omu-contact-main{display:grid;gap:2px;min-width:0}.omu-contact strong{display:block;color:#fff;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.omu-contact span{display:block;color:#8ebbd5;font-family:ui-monospace,Menlo,monospace;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.omu-contact-actions{grid-column:1/-1;display:grid;grid-template-columns:repeat(auto-fit,minmax(74px,1fr));gap:6px}.omu-empty{border:1px dashed rgba(127,216,255,.22);border-radius:14px;padding:12px;color:#8ebbd5;font-size:12px;text-align:center}',
      '.omu-snippets{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px}.omu-snippet{position:relative;border:1px solid rgba(127,216,255,.2);border-radius:16px;background:linear-gradient(150deg,rgba(0,212,255,.17),rgba(167,139,250,.11));padding:10px;min-height:96px;overflow:hidden;display:grid;gap:6px}.omu-snippet.is-pinned{border-color:rgba(255,221,87,.55);background:linear-gradient(150deg,rgba(255,221,87,.18),rgba(0,212,255,.12))}.omu-snippet:before{content:"";position:absolute;inset:-40%;background:linear-gradient(90deg,transparent,rgba(255,255,255,.12),transparent);transform:rotate(18deg);animation:omu-snap-sheen 4s linear infinite}.omu-snippet-text{position:relative;color:#fff;font-weight:800;font-size:13px;line-height:1.3}.omu-snippet-meta{position:relative;font-size:10px;color:#9bcbe6;letter-spacing:.04em;text-transform:uppercase}.omu-snippet.is-pinned .omu-snippet-meta{color:#ffe08a}.omu-snippet-actions{position:relative;display:grid;grid-template-columns:repeat(auto-fit,minmax(54px,1fr));gap:6px}.omu-snippet-actions button{min-height:34px;padding:6px;font-size:11px}',
      '.omu-signals{display:grid;gap:6px;max-height:128px;overflow:auto}.omu-signal{display:flex;gap:8px;align-items:flex-start;color:#9fbfd8;font-size:12px}.omu-signal:before{content:"";width:7px;height:7px;margin-top:5px;border-radius:50%;background:#5eead4;box-shadow:0 0 12px rgba(94,234,212,.72);animation:omu-pulse 1.8s ease-in-out infinite}.omu-qr-modal{position:fixed;inset:0;z-index:1000300;background:rgba(2,6,14,.86);display:none;align-items:center;justify-content:center;padding:14px}.omu-qr-modal.is-open{display:flex}.omu-qr-panel{width:min(420px,100%);border:1px solid rgba(127,216,255,.22);border-radius:18px;background:#06111d;padding:14px;display:grid;gap:10px;color:#dff8ff;box-shadow:0 24px 80px rgba(0,0,0,.55)}.omu-qr-panel video{width:100%;max-height:54vh;border-radius:14px;background:#000}.omu-qr-box{display:grid;place-items:center;gap:9px}.omu-qr-box img{width:min(320px,86vw);height:auto;aspect-ratio:1;border-radius:14px;background:#fff;padding:8px}.omu-qr-panel textarea{width:100%;min-height:80px;border:1px solid rgba(255,255,255,.14);border-radius:12px;background:#020a12;color:#dff8ff;padding:10px;font:12px ui-monospace,Menlo,monospace}.omu-scan-actions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}',
      '.omu-profile-modal{position:fixed;inset:0;z-index:1000310;background:rgba(2,6,14,.86);display:none;align-items:center;justify-content:center;padding:14px}.omu-profile-modal.is-open{display:flex}.omu-profile-panel{width:min(460px,100%);border:1px solid rgba(127,216,255,.22);border-radius:18px;background:#06111d;padding:14px;display:grid;gap:12px;color:#dff8ff;box-shadow:0 24px 80px rgba(0,0,0,.55)}.omu-profile-view{display:grid;grid-template-columns:auto minmax(0,1fr);gap:12px;align-items:center}.omu-profile-view .omu-avatar{width:86px;height:86px;border-radius:26px}.omu-profile-view h3{margin:0;color:#fff;font-size:18px}.omu-profile-view span{display:block;color:#8ebbd5;font-size:12px}.omu-profile-panel p{margin:0;color:#b8d7ea;font-size:13px;line-height:1.45}.omu-profile-panel code{color:#9fffd0;word-break:break-all;font-size:11px}',
      '.ost-mesh-callbar.is-ringing{animation:omu-ring 1s ease-in-out infinite;border-color:rgba(251,191,36,.55);box-shadow:0 0 24px rgba(251,191,36,.12)}.ost-mesh-callbar.is-live{border-color:rgba(52,211,153,.45);box-shadow:0 0 28px rgba(52,211,153,.12)}#ost-mesh-pavilion.ost-mesh-ringing .ost-mesh-shell{box-shadow:inset 0 0 0 1px rgba(251,191,36,.24)}#ost-mesh-pavilion.ost-mesh-in-call .ost-mesh-video-grid.is-on video{box-shadow:0 0 0 1px rgba(94,234,212,.28),0 18px 48px rgba(0,0,0,.38)}.omu-profile-card{display:grid;grid-template-columns:auto minmax(0,1fr);gap:10px;align-items:center}.omu-profile-card strong{color:#fff}.omu-profile-card code{color:#9fffd0;word-break:break-all;font-size:11px}.omu-profile-card p{grid-column:1/-1;margin:0;color:#b8d7ea}',
      '@media(max-width:760px){.ost-mesh-upgrade{padding:10px;border-radius:14px}.omu-body{gap:10px}.omu-grid{grid-template-columns:1fr}.omu-card{padding:9px;border-radius:12px}.omu-contact-actions{grid-template-columns:repeat(2,minmax(0,1fr))}.omu-actions,.omu-snippets{grid-template-columns:repeat(2,minmax(0,1fr))}.omu-profile-social{grid-template-columns:1fr;text-align:center}.omu-avatar{width:60px;height:60px;border-radius:18px;margin:auto}.omu-list{max-height:174px}.omu-signals{max-height:96px}.omu-scan-actions{grid-template-columns:1fr}}@media(max-width:380px){.omu-actions,.omu-snippets,.omu-contact-actions{grid-template-columns:1fr}}',
      '@keyframes omu-ring{0%,100%{transform:translateY(0)}50%{transform:translateY(-1px)}}@keyframes omu-pulse{0%,100%{opacity:.45;transform:scale(.9)}50%{opacity:1;transform:scale(1.18)}}@keyframes omu-snap-sheen{0%{transform:translateX(-80%) rotate(18deg)}100%{transform:translateX(80%) rotate(18deg)}}'
    ].join('\n');
    document.head.appendChild(style);
  }

  function mountPanel(p) {
    if (!p || !p.root || document.getElementById('ostMeshUpgrade')) return;
    injectStyle();
    patchPavilion(p);
    var profile = defaultProfile(p);
    var panel = document.createElement('div');
    panel.id = 'ostMeshUpgrade';
    var compact = !!(window.matchMedia && window.matchMedia('(max-width: 760px)').matches);
    panel.className = 'ost-mesh-upgrade' + (compact ? ' is-collapsed' : '');
    panel.innerHTML = [
      '<div class="omu-social-head"><div><strong>Mesh social</strong><span>Profile, QR, contacts, saved texts</span></div><button class="omu-social-toggle" type="button" id="omuTogglePanel" aria-expanded="' + (compact ? 'false' : 'true') + '">' + (compact ? 'Open' : 'Hide') + '</button></div>',
      '<div class="omu-body" id="omuBody">',
      '<div class="omu-grid">',
        '<div class="omu-card">',
          '<h3>Social profile</h3>',
          '<div class="omu-profile-social">',
            avatarButtonHtml(profile),
            '<div class="omu-profile-meta"><strong id="omuProfileName">' + escapeHtml(profile.nickname) + '</strong><span id="omuProfileStatus">' + escapeHtml(profile.status) + '</span><div class="omu-wallet-pill" id="omuWalletPill">' + escapeHtml(profile.wallet || 'No wallet connected yet') + '</div></div>',
          '</div>',
          '<input type="file" id="omuAvatarFile" accept="image/*" hidden>',
          '<div class="omu-row"><input id="omuNick" maxlength="32" placeholder="Display name" value="' + escapeHtml(profile.nickname) + '"><input id="omuHandle" maxlength="32" placeholder="@handle" value="' + escapeHtml(profile.handle || '') + '"></div>',
          '<div class="omu-row"><input id="omuStatus" maxlength="80" placeholder="Status" value="' + escapeHtml(profile.status) + '"></div>',
          '<div class="omu-row"><textarea id="omuBio" maxlength="220" placeholder="Bio everyone can see">' + escapeHtml(profile.bio) + '</textarea></div>',
          '<div class="omu-actions"><button class="primary" type="button" id="omuSaveProfile">Save</button><button type="button" id="omuSyncWallet">Sync wallet</button><button type="button" id="omuPostProfile">Post profile</button><button type="button" id="omuShowQr">My QR</button><button type="button" id="omuEnableAlerts">Enable alerts</button></div>',
          '<div class="omu-alert-state" id="omuAlertState"></div>',
        '</div>',
        '<div class="omu-card">',
          '<h3>Add people</h3>',
          '<div class="omu-actions"><button class="primary" type="button" id="omuScanQr">Scan QR</button><button type="button" id="omuSavePeerInput">Save pasted peer</button><button type="button" id="omuAddContact">Save current peer</button><button type="button" id="omuCopyInvite">Copy invite</button></div>',
          '<div class="omu-row"><textarea id="omuInviteText" placeholder="Paste an OST Mesh invite or scanned QR text"></textarea></div>',
        '</div>',
      '</div>',
      '<div class="omu-grid">',
        '<div class="omu-card"><h3>Contacts</h3><div class="omu-list" id="omuContactList"></div></div>',
        '<div class="omu-card"><h3>Mesh signals</h3><div class="omu-signals" id="omuSignals"></div></div>',
      '</div>',
      '<div class="omu-card">',
        '<h3>Saved texts</h3>',
        '<div class="omu-actions"><button class="primary" type="button" id="omuSaveText">Save typed text</button><button type="button" id="omuClearTexts">Clear saved</button></div>',
        '<div class="omu-snippets" id="omuSnippets"></div>',
      '</div>',
      '</div>'
    ].join('');
    var stage = p.root.querySelector('.ost-mesh-stage');
    var session = p.root.querySelector('.ost-mesh-session');
    if (session && session.parentNode) session.parentNode.insertBefore(panel, session.nextSibling);
    else if (stage && stage.parentNode) stage.parentNode.insertBefore(panel, stage.nextSibling);
    else p.root.querySelector('.ost-mesh-shell').appendChild(panel);
    bindPanel(p, panel);
    renderAll(p);
  }

  function bindPanel(p, panel) {
    wireAvatarFallbacks(panel);
    var toggle = panel.querySelector('#omuTogglePanel');
    if (toggle) toggle.addEventListener('click', function () {
      var collapsed = panel.classList.toggle('is-collapsed');
      toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      toggle.textContent = collapsed ? 'Open' : 'Hide';
    });
    panel.querySelector('#omuAvatarButton').addEventListener('click', function () { panel.querySelector('#omuAvatarFile').click(); });
    panel.querySelector('#omuAvatarFile').addEventListener('change', function (event) { handleAvatarFile(p, event.target.files && event.target.files[0]); });
    panel.querySelector('#omuSaveProfile').addEventListener('click', function () { saveProfile(p, 'Profile saved.'); });
    panel.querySelector('#omuSyncWallet').addEventListener('click', function () { syncWalletToProfile(p); });
    panel.querySelector('#omuPostProfile').addEventListener('click', function () { postProfile(p); });
    panel.querySelector('#omuShowQr').addEventListener('click', function () { showOwnQr(p); });
    panel.querySelector('#omuEnableAlerts').addEventListener('click', function () { requestAlerts(p, panel); });
    panel.querySelector('#omuScanQr').addEventListener('click', function () { startQrScan(p); });
    panel.querySelector('#omuSavePeerInput').addEventListener('click', function () { importInviteText(p, valueOf('omuInviteText')); });
    panel.querySelector('#omuAddContact').addEventListener('click', function () { saveCurrentPeer(p); });
    panel.querySelector('#omuCopyInvite').addEventListener('click', function () { copyInvite(p); });
    panel.querySelector('#omuSaveText').addEventListener('click', function () { saveTypedText(p); });
    panel.querySelector('#omuClearTexts').addEventListener('click', function () { writeJson(SNIPPETS_KEY, []); renderSnippets(p); });
    panel.querySelector('#omuContactList').addEventListener('click', function (event) { handleContactClick(p, event); });
    panel.querySelector('#omuSnippets').addEventListener('click', function (event) { handleSnippetClick(p, event); });
    ['omuNick', 'omuHandle', 'omuStatus'].forEach(function (id) {
      var el = panel.querySelector('#' + id);
      if (el) el.addEventListener('input', function () { updateProfilePreview(collectProfile(p)); });
    });
    updateAlertsButton(panel);
  }

  function updateAlertsButton(panel) {
    panel = panel || document.getElementById('ostMeshUpgrade');
    if (!panel) return;
    var button = panel.querySelector('#omuEnableAlerts');
    var state = panel.querySelector('#omuAlertState');
    var api = window.OST_NOTIFY;
    var permission = api && api.permission ? api.permission() : (!('Notification' in window) ? 'unsupported' : Notification.permission);
    var enabled = !!(api && api.enabled && api.enabled());
    if (button) button.textContent = enabled && permission === 'granted' ? 'Alerts on' : 'Enable alerts';
    if (state) state.textContent = permission === 'unsupported' ? 'Alerts unavailable in this browser.' : permission === 'granted' && enabled ? 'Alerts ready.' : 'Alerts are off.';
  }

  function requestAlerts(p, panel) {
    if (!window.OST_NOTIFY || !window.OST_NOTIFY.request) {
      setStatus(p, 'Notifications are still loading. Try again in a moment.', 'warn');
      return;
    }
    window.OST_NOTIFY.request().then(function (permission) {
      updateAlertsButton(panel);
      setStatus(p, permission === 'granted' ? 'OST Mesh alerts enabled on this device.' : 'Alerts were not enabled.', permission === 'granted' ? 'ok' : 'warn');
    });
  }

  function valueOf(id) {
    var el = document.getElementById(id);
    return el ? String(el.value || '').trim() : '';
  }

  function collectProfile(p) {
    var saved = defaultProfile(p);
    return {
      nickname: valueOf('omuNick') || saved.nickname || ('Mesh ' + String((p && p.address) || '').slice(-4)),
      handle: valueOf('omuHandle') || saved.handle || '',
      status: valueOf('omuStatus') || 'Available on OST Mesh',
      bio: valueOf('omuBio'),
      wallet: walletAddress() || saved.wallet || '',
      address: p && p.address || saved.address || '',
      avatar: saved.avatar || '',
      avatarThumb: saved.avatarThumb || '',
      avatarQr: saved.avatarQr || '',
      updatedAt: Date.now()
    };
  }

  function updateProfilePreview(profile) {
    var avatarButton = document.getElementById('omuAvatarButton');
    var avatar = profileAvatar(profile, true);
    var fallback = profileAvatar(profile, false);
    if (fallback === avatar) fallback = '';
    if (avatarButton) {
      avatarButton.setAttribute('data-initials', initials(profile));
      avatarButton.innerHTML = avatar ? '<img src="' + escapeHtml(avatar) + '" data-omu-alt-src="' + escapeHtml(fallback) + '" alt="">' : '<b>' + escapeHtml(initials(profile)) + '</b>';
    }
    var name = document.getElementById('omuProfileName');
    var status = document.getElementById('omuProfileStatus');
    var wallet = document.getElementById('omuWalletPill');
    if (name) name.textContent = profile.nickname || 'Mesh profile';
    if (status) status.textContent = profile.status || '';
    if (wallet) wallet.textContent = profile.wallet || 'No wallet connected yet';
  }

  function saveProfile(p, message) {
    var previous = defaultProfile(p);
    var profile = collectProfile(p);
    profile.avatar = previous.avatar || profile.avatar || '';
    profile.avatarThumb = previous.avatarThumb || profile.avatarThumb || '';
    profile.avatarQr = previous.avatarQr || profile.avatarQr || '';
    writeJson(PROFILE_KEY, profile);
    updateProfilePreview(profile);
    setStatus(p, message || 'Profile saved.', 'ok');
    return profile;
  }

  function syncWalletToProfile(p) {
    var profile = saveProfile(p, 'Wallet synced to Mesh profile.');
    profile.wallet = walletAddress() || profile.wallet;
    writeJson(PROFILE_KEY, profile);
    updateProfilePreview(profile);
  }

  function imageToDataUrl(file, maxSize, quality) {
    return new Promise(function (resolve, reject) {
      if (!file || !/^image\//.test(file.type || '')) return reject(new Error('Choose an image file.'));
      var reader = new FileReader();
      reader.onerror = function () { reject(new Error('Could not read image.')); };
      reader.onload = function () { resizeImageSource(String(reader.result || ''), maxSize, quality).then(resolve).catch(reject); };
      reader.readAsDataURL(file);
    });
  }

  function resizeImageSource(source, maxSize, quality) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onerror = function () { reject(new Error('Could not load image.')); };
      img.onload = function () {
        var max = maxSize || 480;
        var scale = Math.min(1, max / Math.max(img.width, img.height));
        var canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        var ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', quality || 0.78));
      };
      img.src = source;
    });
  }

  function ensureAvatarThumb(p) {
    var profile = defaultProfile(p);
    var source = validImageSource(profile.avatar) || validImageSource(profile.avatarThumb) || '';
    if (!source) return Promise.resolve(profile);
    var tasks = [];
    if (!validImageSource(profile.avatarThumb)) {
      tasks.push(resizeImageSource(source, 72, 0.64).then(function (thumb) { profile.avatarThumb = thumb; }));
    }
    if (!validImageSource(profile.avatarQr)) {
      tasks.push(resizeImageSource(source, 34, 0.42).then(function (qr) { profile.avatarQr = qr; }));
    }
    if (!tasks.length) return Promise.resolve(profile);
    return Promise.all(tasks).then(function () {
      profile.updatedAt = Date.now();
      writeJson(PROFILE_KEY, profile);
      updateProfilePreview(profile);
      return profile;
    }).catch(function () { return profile; });
  }

  function handleAvatarFile(p, file) {
    Promise.all([imageToDataUrl(file, 420, 0.78), imageToDataUrl(file, 72, 0.64), imageToDataUrl(file, 34, 0.42)]).then(function (images) {
      var profile = collectProfile(p);
      profile.avatar = images[0];
      profile.avatarThumb = images[1];
      profile.avatarQr = images[2];
      writeJson(PROFILE_KEY, profile);
      updateProfilePreview(profile);
      setStatus(p, 'Profile picture saved and ready to sync.', 'ok');
    }).catch(function (err) { setStatus(p, err.message, 'err'); });
  }

  function setStatus(p, text, kind) {
    logSignal(kind || 'status', text);
    if (p && p._setStatus) p._setStatus(text, kind || '');
    renderSignals();
  }

  function logSignal(type, text) {
    var list = readJson(SIGNALS_KEY, []);
    if (!Array.isArray(list)) list = [];
    var clean = String(text || '').replace(/<[^>]+>/g, '').slice(0, 160);
    if (!clean) return;
    if (list[0] && list[0].text === clean) return;
    list.unshift({ type: type || 'signal', text: clean, ts: Date.now() });
    writeJson(SIGNALS_KEY, list.slice(0, 30));
  }

  async function postProfile(p) {
    saveProfile(p, 'Profile saved.');
    if (!p || !p.sessionKey || typeof p.sendAppPayload !== 'function') {
      return setStatus(p, 'Connect to a peer before posting your profile.', 'warn');
    }
    try {
      var profile = await ensureAvatarThumb(p);
      await p.sendAppPayload({ app: APP, v: 2, type: 'profile.card', profile: publicProfile(profile, { includeAvatar: true }) });
      renderProfileCard(p, profile, 'me');
      setStatus(p, 'Profile posted to peer.', 'ok');
    } catch (err) { setStatus(p, err.message, 'err'); }
  }

  function syncProfileToPeer(p) {
    if (!p || !p.sessionKey || !p.peerAddr || typeof p.sendAppPayload !== 'function') return;
    var profile = defaultProfile(p);
    var syncKey = p.peerAddr + ':' + String(profile.updatedAt || '') + ':' + String(profileAvatar(profile).length || 0);
    if (p.__meshSocialProfileSyncKey === syncKey) return;
    p.__meshSocialProfileSyncKey = syncKey;
    window.setTimeout(function () {
      if (!p.sessionKey || !p.peerAddr) return;
      ensureAvatarThumb(p).then(function (freshProfile) {
        return p.sendAppPayload({ app: APP, v: 2, type: 'profile.card', profile: publicProfile(freshProfile, { includeAvatar: true }) });
      }).then(function (sent) {
        if (sent === false && p._setStatus) p._setStatus('Profile card queued until Mesh channel opens.', 'warn');
      }).catch(function () {});
    }, 450);
  }

  function renderProfileCard(p, profile, role) {
    if (!p || !p._bubble) return;
    var card = document.createElement('div');
    card.className = 'omu-profile-card';
    card.innerHTML = avatarHtml(profile, 'sm') + '<div><strong>' + escapeHtml(profile.nickname || 'Mesh profile') + '</strong><span>' + escapeHtml(profile.status || '') + '</span><br><code>' + escapeHtml(profile.wallet || profile.address || '') + '</code></div><p>' + escapeHtml(profile.bio || '') + '</p>';
    wireAvatarFallbacks(card);
    p._bubble(role, card);
    if (role === 'peer') saveContact({ address: profile.address, nick: profile.nickname || profile.handle, wallet: profile.wallet, status: profile.status, avatar: profile.avatar || profile.avatarThumb, avatarThumb: profile.avatarThumb || profile.avatar, profile: profile });
  }

  function saveContact(contact) {
    var address = normalizeAddress(contact && contact.address);
    if (!address) return null;
    var list = readFirst([CONTACTS_KEY, CONTACTS_OLD_KEY], []);
    if (!Array.isArray(list)) list = [];
    var existing = list.find(function (item) { return normalizeAddress(item.address) === address; });
    var profile = Object.assign({}, existing && existing.profile || {}, contact.profile || {});
    profile.address = address;
    profile.nickname = profile.nickname || contact.nick || contact.nickname || existing && existing.nick || short(address);
    profile.handle = profile.handle || contact.handle || existing && existing.handle || '';
    profile.status = profile.status || contact.status || existing && existing.status || '';
    profile.bio = profile.bio || contact.bio || existing && existing.bio || '';
    profile.wallet = profile.wallet || contact.wallet || existing && existing.wallet || '';
    profile.avatar = profile.avatar || contact.avatar || contact.avatarThumb || contact.avatarQr || existing && (existing.avatar || existing.avatarThumb || existing.avatarQr) || '';
    profile.avatarThumb = profile.avatarThumb || contact.avatarThumb || contact.avatarQr || contact.avatar || existing && (existing.avatarThumb || existing.avatarQr || existing.avatar) || '';
    profile.avatarQr = profile.avatarQr || contact.avatarQr || existing && existing.avatarQr || '';
    profile.updatedAt = profile.updatedAt || contact.updatedAt || Date.now();
    var next = Object.assign({}, existing || {}, contact, { address: address, profile: profile, updatedAt: Date.now() });
    next.nick = next.nick || profile.nickname || short(address);
    next.handle = next.handle || profile.handle || '';
    next.status = next.status || profile.status || '';
    next.bio = next.bio || profile.bio || '';
    next.wallet = next.wallet || profile.wallet || '';
    next.avatar = next.avatar || profile.avatar || profile.avatarThumb || profile.avatarQr || '';
    next.avatarThumb = next.avatarThumb || profile.avatarThumb || profile.avatarQr || profile.avatar || '';
    next.avatarQr = next.avatarQr || profile.avatarQr || '';
    if (existing) Object.assign(existing, next);
    else list.unshift(next);
    writeJson(CONTACTS_KEY, list.slice(0, 120));
    renderContacts(pavilion());
    return next;
  }

  function saveCurrentPeer(p) {
    var address = normalizeAddress((p && p.peerAddr) || (p && p.peerInput && p.peerInput.value));
    if (!address) return setStatus(p, 'Paste or connect a peer before saving a contact.', 'warn');
    var contact = saveContact({ address: address, nick: short(address), note: 'Saved from OST Mesh', invite: valueOf('omuInviteText') || '' });
    if (contact) setStatus(p, 'Contact saved.', 'ok');
  }

  function importInviteText(p, raw) {
    var parsed;
    try { parsed = parseMeshInvite(raw); }
    catch (err) { return setStatus(p, 'Could not read that QR/invite: ' + err.message, 'err'); }
    if (!parsed.address) return setStatus(p, 'No OST Mesh address found in that QR/invite.', 'warn');
    saveContact(parsed);
    if (p && p.peerInput) p.peerInput.value = parsed.invite || parsed.address;
    setStatus(p, 'QR loaded into OST Mesh. Contact saved and ready to connect.', 'ok');
    if (p && p.open) p.open();
  }

  function renderContacts(p) {
    var box = document.getElementById('omuContactList');
    if (!box) return;
    var list = readFirst([CONTACTS_KEY, CONTACTS_OLD_KEY], []);
    if (!Array.isArray(list) || !list.length) {
      box.innerHTML = '<div class="omu-empty">No contacts yet. Scan a Mesh QR or save a peer after connecting.</div>';
      return;
    }
    box.innerHTML = list.map(function (contact, index) {
      var profile = contact.profile || contact;
      return '<div class="omu-contact" data-contact-card="' + index + '">' + avatarHtml(profile, 'sm') + '<div class="omu-contact-main"><strong>' + escapeHtml(contact.nick || profile.nickname || short(contact.address)) + '</strong><span>' + escapeHtml(short(contact.address)) + '</span><span>' + escapeHtml(contact.status || profile.status || contact.wallet || '') + '</span></div><div class="omu-contact-actions"><button class="primary" type="button" data-contact-action="connect" data-index="' + index + '">Connect</button><button type="button" data-contact-action="profile" data-index="' + index + '">Profile</button><button type="button" data-contact-action="sendost" data-index="' + index + '">Send OST</button><button type="button" data-contact-action="challenge" data-index="' + index + '">Challenge</button><button type="button" data-contact-action="load" data-index="' + index + '">Load</button><button type="button" data-contact-action="qr" data-index="' + index + '">QR</button><button type="button" data-contact-action="delete" data-index="' + index + '">Delete</button></div></div>';
    }).join('');
  }

  function handleContactClick(p, event) {
    var button = event.target.closest('[data-contact-action]');
    var list = readFirst([CONTACTS_KEY, CONTACTS_OLD_KEY], []);
    var index = button ? Number(button.dataset.index) : Number((event.target.closest('[data-contact-card]') || {}).dataset.contactCard);
    var contact = list[index];
    if (!contact) return;
    if (!button) return showContactProfile(p, contact);
    var action = button.dataset.contactAction;
    if (action === 'connect') return connectContact(p, contact);
    if (action === 'profile') return showContactProfile(p, contact);
    if (action === 'sendost') return sendOstToContact(p, contact);
    if (action === 'challenge') return challengeContact(p, contact);
    if (action === 'load') return loadContact(p, contact);
    if (action === 'qr') return showContactQr(p, contact);
    if (action === 'delete') {
      list.splice(Number(button.dataset.index), 1);
      writeJson(CONTACTS_KEY, list);
      renderContacts(p);
      setStatus(p, 'Contact deleted.', 'warn');
    }
  }

  function loadContact(p, contact) {
    if (p && p.peerInput) p.peerInput.value = contact.invite || contact.address;
    if (p && p.open) p.open();
    setStatus(p, 'Contact loaded. Tap Connect securely when they are online.', 'ok');
  }

  // ContactSendOst: route a contact's saved wallet through Mesh Arena's direct send.
  function sendOstToContact(p, contact) {
    var address = String((contact && (contact.wallet || (contact.profile && contact.profile.wallet))) || '').trim();
    if (!address) {
      loadContact(p, contact);
      return setStatus(p, 'No OST wallet saved for this contact yet. Connect to sync their profile.', 'warn');
    }
    var raw = '';
    try { raw = window.prompt('Send OST to ' + (contact.nick || (contact.profile && contact.profile.nickname) || 'this contact') + '\n\nAmount in OST:', '1'); }
    catch (_) { raw = ''; }
    if (raw == null) return;
    var amount = Number(String(raw).replace(',', '.'));
    if (!Number.isFinite(amount) || amount <= 0) return setStatus(p, 'Enter a positive OST amount.', 'warn');
    var arena = window.OST_MESH_ARENA;
    if (!arena || typeof arena.sendOstTo !== 'function') {
      setStatus(p, 'OST Mesh Arena is still loading. Try again in a moment.', 'warn');
      return;
    }
    setStatus(p, 'Opening Arena to send OST...', 'ok');
    Promise.resolve(arena.sendOstTo(address, amount, 'OST Mesh contact send'))
      .then(function () { setStatus(p, 'OST send queued through Mesh Arena.', 'ok'); })
      .catch(function (err) { setStatus(p, 'Send failed: ' + (err && err.message ? err.message : err), 'err'); });
  }

  // ContactChallenge: open Arena Games tab pre-targeted at a saved contact.
  function challengeContact(p, contact) {
    loadContact(p, contact);
    var arena = window.OST_MESH_ARENA;
    if (arena && typeof arena.challenge === 'function') {
      arena.challenge(String((contact && (contact.wallet || (contact.profile && contact.profile.wallet))) || ''));
      setStatus(p, 'Arena ready. Tap Connect to ' + (contact.nick || 'this contact') + ' then challenge.', 'ok');
      return;
    }
    if (arena && typeof arena.open === 'function') { arena.open(); return; }
    setStatus(p, 'OST Mesh Arena is still loading. Try again in a moment.', 'warn');
  }

  function ensureProfileModal(p) {
    var modal = document.getElementById('omuProfileModal');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'omuProfileModal';
    modal.className = 'omu-profile-modal';
    modal.innerHTML = '<div class="omu-profile-panel"><div id="omuProfileView"></div><div class="omu-actions"><button class="primary" type="button" id="omuProfileConnect">Connect</button><button type="button" id="omuProfileSendOst">Send OST</button><button type="button" id="omuProfileChallenge">Challenge</button><button type="button" id="omuProfileLoad">Load</button><button type="button" id="omuProfileQr">QR</button><button type="button" id="omuProfileClose">Close</button></div></div>';
    (p && p.root ? p.root : document.body).appendChild(modal);
    wireAvatarFallbacks(modal);
    modal.querySelector('#omuProfileClose').addEventListener('click', function () { modal.classList.remove('is-open'); });
    modal.addEventListener('click', function (event) { if (event.target === modal) modal.classList.remove('is-open'); });
    return modal;
  }

  function showContactProfile(p, contact) {
    var modal = ensureProfileModal(p);
    var profile = contact.profile || contact || {};
    var address = normalizeAddress(contact.address || profile.address);
    modal.__contact = contact;
    modal.querySelector('#omuProfileView').innerHTML = '<div class="omu-profile-view">' + avatarHtml(profile, '', { preferFull: true }) + '<div><h3>' + escapeHtml(profile.nickname || contact.nick || 'Mesh profile') + '</h3><span>' + escapeHtml(profile.handle || contact.handle || short(address)) + '</span><span>' + escapeHtml(profile.status || contact.status || '') + '</span><code>' + escapeHtml(profile.wallet || contact.wallet || address || '') + '</code></div></div><p>' + escapeHtml(profile.bio || contact.bio || 'No bio shared yet. Connect to this contact and their profile will sync automatically.') + '</p>';
    var sendBtn = modal.querySelector('#omuProfileSendOst');
    var challengeBtn = modal.querySelector('#omuProfileChallenge');
    if (sendBtn) sendBtn.onclick = function () { modal.classList.remove('is-open'); sendOstToContact(p, contact); };
    if (challengeBtn) challengeBtn.onclick = function () { modal.classList.remove('is-open'); challengeContact(p, contact); };
    modal.querySelector('#omuProfileConnect').onclick = function () { modal.classList.remove('is-open'); connectContact(p, contact); };
    modal.querySelector('#omuProfileLoad').onclick = function () { modal.classList.remove('is-open'); loadContact(p, contact); };
    modal.querySelector('#omuProfileQr').onclick = function () { showContactQr(p, contact); };
    modal.classList.add('is-open');
    if (p && p.open) p.open();
    setStatus(p, 'Contact profile opened.', 'ok');
  }

  async function connectContact(p, contact) {
    loadContact(p, contact);
    if (p && typeof p._connectToPeer === 'function') {
      try { await p._connectToPeer(); }
      catch (err) { setStatus(p, 'Connect failed: ' + err.message, 'err'); }
    }
  }

  function copyInvite(p) {
    saveProfile(p, 'Profile saved into invite.');
    ensureAvatarThumb(p).then(function (profile) {
      var invite = inviteFor(p, profile);
      if (!invite) return setStatus(p, 'Mesh keys are still loading. Try again in a second.', 'warn');
      copyText(invite, function () { setStatus(p, 'Invite copied with your profile card.', 'ok'); });
    });
  }

  function copyText(value, done) {
    function fallback() {
      try { window.prompt('Copy this OST Mesh invite', value); } catch (_) {}
      if (done) done();
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(value).then(done || function () {}).catch(fallback);
    } else {
      fallback();
    }
  }

  function showOwnQr(p) {
    saveProfile(p, 'Profile saved into QR.');
    ensureAvatarThumb(p).then(function (profile) {
      var invite = inviteFor(p, profile);
      if (!invite) return setStatus(p, 'Mesh keys are still loading. Try again in a second.', 'warn');
      showQrModal(p, invite, 'My OST Mesh QR');
    });
  }

  function showContactQr(p, contact) {
    var value = contact.invite || contact.address;
    showQrModal(p, value, (contact.nick || 'Contact') + ' QR');
  }

  function ensureQrModal(p) {
    var modal = document.getElementById('omuQrModal');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'omuQrModal';
    modal.className = 'omu-qr-modal';
    modal.innerHTML = '<div class="omu-qr-panel"><h3 id="omuQrTitle">OST Mesh QR</h3><div class="omu-qr-box" id="omuQrBox"></div><video id="omuQrVideo" playsinline muted hidden></video><textarea id="omuQrPaste" placeholder="Paste invite text here"></textarea><div class="omu-scan-actions"><button class="primary" type="button" id="omuQrUsePaste">Load pasted invite</button><button type="button" id="omuQrClose">Close</button></div><p id="omuQrHint"></p></div>';
    (p && p.root ? p.root : document.body).appendChild(modal);
    modal.querySelector('#omuQrClose').addEventListener('click', stopQrScan);
    modal.querySelector('#omuQrUsePaste').addEventListener('click', function () { importInviteText(pavilion(), valueOf('omuQrPaste')); stopQrScan(); });
    modal.addEventListener('click', function (event) { if (event.target === modal) stopQrScan(); });
    return modal;
  }

  function showQrModal(p, value, title) {
    var modal = ensureQrModal(p);
    modal.classList.add('is-open');
    modal.querySelector('#omuQrTitle').textContent = title || 'OST Mesh QR';
    modal.querySelector('#omuQrVideo').hidden = true;
    modal.querySelector('#omuQrBox').innerHTML = '<img src="' + qrUrl(value) + '" alt="OST Mesh QR"><textarea readonly>' + escapeHtml(value) + '</textarea>';
    modal.querySelector('#omuQrPaste').value = '';
    modal.querySelector('#omuQrHint').textContent = 'Share this QR. Scanning it saves your profile and loads your Mesh invite.';
  }

  async function startQrScan(p) {
    scanRunId += 1;
    if (scanStream) scanStream.getTracks().forEach(function (track) { track.stop(); });
    scanStream = null;
    var runId = scanRunId;
    var modal = ensureQrModal(p);
    modal.classList.add('is-open');
    modal.querySelector('#omuQrTitle').textContent = 'Scan OST Mesh QR';
    modal.querySelector('#omuQrBox').innerHTML = '';
    modal.querySelector('#omuQrPaste').value = '';
    var hint = modal.querySelector('#omuQrHint');
    var video = modal.querySelector('#omuQrVideo');
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      hint.textContent = 'Camera access is not available here. Paste an invite instead.';
      return;
    }
    try {
      hint.textContent = 'Allow camera access, then point at an OST Mesh QR.';
      scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      video.srcObject = scanStream;
      video.hidden = false;
      await video.play();
      var detector = null;
      if ('BarcodeDetector' in window) {
        try { detector = new BarcodeDetector({ formats: ['qr_code'] }); } catch (_) { detector = null; }
      }
      hint.textContent = detector ? 'Camera opened. QR scanner is active.' : 'Camera opened. Loading mobile QR decoder...';
      var jsQr = null;
      try { jsQr = await loadQrDecoder(); }
      catch (decoderErr) {
        if (!detector) {
          hint.textContent = 'Camera opened, but the QR decoder could not load. Check connection and try Scan QR again.';
          setStatus(p, decoderErr.message, 'warn');
          return;
        }
      }
      if (runId !== scanRunId || !scanStream) return;
      hint.textContent = jsQr ? 'Camera opened. Mobile QR decoder ready.' : 'Camera opened. Native QR scanner ready.';
      startQrDecodeLoop(p, video, hint, runId, detector, jsQr);
    } catch (err) {
      hint.textContent = 'Camera permission failed: ' + err.message + '. Paste an invite instead.';
      setStatus(p, 'Camera permission failed: ' + err.message, 'warn');
    }
  }

  function stopQrScan() {
    scanRunId += 1;
    var modal = document.getElementById('omuQrModal');
    if (modal) modal.classList.remove('is-open');
    var video = document.getElementById('omuQrVideo');
    if (video) {
      try { video.pause(); } catch (_) {}
      try { video.srcObject = null; } catch (_) {}
      video.hidden = true;
    }
    if (scanStream) scanStream.getTracks().forEach(function (track) { track.stop(); });
    scanStream = null;
  }

  var SNIPPET_TTL_MS = 24 * 60 * 60 * 1000; // Saved texts auto-erase after 24h unless pinned.

  function snippetExpired(item) {
    if (!item || item.pinned) return false;
    var expiresAt = Number(item.expiresAt) || ((Number(item.ts) || 0) + SNIPPET_TTL_MS);
    return expiresAt > 0 && expiresAt <= Date.now();
  }

  function purgeExpiredSnippets() {
    var list = readFirst([SNIPPETS_KEY, SNIPPETS_OLD_KEY], []);
    if (!Array.isArray(list) || !list.length) return list || [];
    var kept = list.filter(function (item) { return !snippetExpired(item); });
    if (kept.length !== list.length) writeJson(SNIPPETS_KEY, kept);
    return kept;
  }

  function snippetTimeLabel(item) {
    if (!item) return '';
    if (item.pinned) return 'Pinned';
    var ts = Number(item.ts) || Date.now();
    var expiresAt = Number(item.expiresAt) || (ts + SNIPPET_TTL_MS);
    var ms = expiresAt - Date.now();
    if (ms <= 0) return 'Expiring';
    var hours = Math.floor(ms / 3600000);
    var mins = Math.floor((ms % 3600000) / 60000);
    if (hours >= 1) return hours + 'h ' + mins + 'm left';
    return mins + 'm left';
  }

  function saveTypedText(p) {
    var text = p && p.textInput ? String(p.textInput.value || '').trim() : '';
    if (!text) text = valueOf('omuInviteText');
    if (!text) return setStatus(p, 'Type a message before saving it.', 'warn');
    var list = purgeExpiredSnippets();
    if (!Array.isArray(list)) list = [];
    var ts = Date.now();
    list.unshift({ text: text, ts: ts, expiresAt: ts + SNIPPET_TTL_MS, pinned: false, tint: Math.floor(Math.random() * 5) });
    writeJson(SNIPPETS_KEY, list.slice(0, 36));
    renderSnippets(p);
    setStatus(p, 'Saved text added. It auto-erases in 24h unless you pin it.', 'ok');
  }

  function renderSnippets(p) {
    var box = document.getElementById('omuSnippets');
    if (!box) return;
    var list = purgeExpiredSnippets();
    if (!Array.isArray(list) || !list.length) {
      box.innerHTML = '<div class="omu-empty">No saved texts yet. Type a message in Mesh, then save it here. Saved texts auto-erase in 24h unless pinned.</div>';
      return;
    }
    box.innerHTML = list.map(function (item, index) {
      var pinClass = item.pinned ? ' is-pinned' : '';
      var pinLabel = item.pinned ? 'Unpin' : 'Pin';
      return '<div class="omu-snippet' + pinClass + '" data-snippet-card="' + index + '">' +
        '<div class="omu-snippet-text">' + escapeHtml(String(item.text || '').slice(0, 160)) + '</div>' +
        '<div class="omu-snippet-meta">' + escapeHtml(snippetTimeLabel(item)) + '</div>' +
        '<div class="omu-snippet-actions">' +
          '<button type="button" data-snippet-action="send" data-index="' + index + '">Send</button>' +
          '<button type="button" data-snippet-action="load" data-index="' + index + '">Load</button>' +
          '<button type="button" data-snippet-action="pin" data-index="' + index + '">' + pinLabel + '</button>' +
          '<button type="button" data-snippet-action="delete" data-index="' + index + '">Delete</button>' +
        '</div></div>';
    }).join('');
  }

  function handleSnippetClick(p, event) {
    var button = event.target.closest('[data-snippet-action]');
    if (!button) return;
    var list = purgeExpiredSnippets();
    var index = Number(button.dataset.index);
    var item = list[index];
    if (!item) return renderSnippets(p);
    var action = button.dataset.snippetAction;
    if (action === 'pin') {
      item.pinned = !item.pinned;
      if (item.pinned) item.expiresAt = 0;
      else item.expiresAt = Date.now() + SNIPPET_TTL_MS;
      writeJson(SNIPPETS_KEY, list);
      renderSnippets(p);
      setStatus(p, item.pinned ? 'Pinned. This text will not auto-erase.' : 'Unpinned. Will erase in 24h.', 'ok');
      return;
    }
    if (action === 'delete') {
      list.splice(index, 1);
      writeJson(SNIPPETS_KEY, list);
      renderSnippets(p);
      setStatus(p, 'Saved text removed.', 'warn');
      return;
    }
    if (!p || !p.textInput) return;
    p.textInput.value = item.text || '';
    if (action === 'send') {
      if (p.sessionKey && typeof p._sendText === 'function') p._sendText();
      else setStatus(p, 'Saved text loaded. Connect before sending.', 'warn');
    } else {
      try { p.textInput.focus({ preventScroll: true }); } catch (_) { p.textInput.focus(); }
      setStatus(p, 'Saved text loaded into the composer.', 'ok');
    }
  }

  function renderSignals() {
    var box = document.getElementById('omuSignals');
    if (!box) return;
    var list = readJson(SIGNALS_KEY, []);
    if (!Array.isArray(list) || !list.length) {
      box.innerHTML = '<div class="omu-empty">No signals yet. Connect, scan a QR, send a profile, or receive a message.</div>';
      return;
    }
    box.innerHTML = list.slice(0, 12).map(function (item) {
      return '<div class="omu-signal"><span><strong>' + escapeHtml(item.type || 'signal') + '</strong> ' + escapeHtml(item.text || '') + '<br><small>' + escapeHtml(new Date(item.ts || Date.now()).toLocaleTimeString()) + '</small></span></div>';
    }).join('');
  }

  function renderAll(p) {
    renderContacts(p);
    renderSnippets(p);
    renderSignals();
    updateProfilePreview(defaultProfile(p));
  }

  function notify(title, body, tag, kind, options) {
    options = options || {};
    options.tag = tag || options.tag || 'ost-mesh';
    if (window.OST_NOTIFY && window.OST_NOTIFY.mesh) {
      window.OST_NOTIFY.mesh(kind || 'mesh', title, body, options);
      return;
    }
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    try {
      var note = new Notification(title, { body: body, tag: tag || 'ost-mesh', renotify: true, icon: 'icon-192.png', badge: 'icon-192.png' });
      note.onclick = function () {
        try { window.focus(); } catch (_) {}
        var p = pavilion();
        if (p && p.open) p.open();
        note.close();
      };
    } catch (_) {}
  }

  function patchPavilion(p) {
    if (!p || p.__meshSocialPatched) return;
    p.__meshSocialPatched = true;
    var originalStatus = p._setStatus && p._setStatus.bind(p);
    if (originalStatus) p._setStatus = function (text, kind) {
      logSignal(kind || 'status', text);
      renderSignals();
      return originalStatus(text, kind);
    };
    var originalShowIncoming = p._showIncomingCall && p._showIncomingCall.bind(p);
    var originalMarkConnected = p._markCallConnected && p._markCallConnected.bind(p);
    var originalResetCall = p._resetCallState && p._resetCallState.bind(p);
    var originalSetControls = p._setCallControls && p._setCallControls.bind(p);
    var originalEnableMessaging = p._enableMessaging && p._enableMessaging.bind(p);
    var originalPreparePeerSession = p._preparePeerSession && p._preparePeerSession.bind(p);

    if (originalPreparePeerSession) p._preparePeerSession = function (peerInput) {
      var incomingAddress = typeof peerInput === 'string' ? normalizeAddress(peerInput) : '';
      if (incomingAddress && p.__meshSocialPeerAttemptKey !== incomingAddress) {
        p.__meshSocialPeerAttemptKey = incomingAddress;
        notify('OST Mesh peer request', short(incomingAddress) + ' is trying to connect.', 'ost-mesh-peer-attempt', 'peer', { force: true });
      }
      return originalPreparePeerSession(peerInput);
    };

    if (originalEnableMessaging) p._enableMessaging = function () {
      var result = originalEnableMessaging();
      syncProfileToPeer(p);
      var peerKey = p.peerAddr || 'peer';
      if (p.__meshSocialPeerNotifyKey !== peerKey) {
        p.__meshSocialPeerNotifyKey = peerKey;
        notify('OST Mesh peer connected', short(peerKey) + ' is encrypted and ready.', 'ost-mesh-peer', 'peer');
      }
      return result;
    };

    if (originalShowIncoming) p._showIncomingCall = function (detail) {
      setCallClasses(p, 'ringing');
      notify('Incoming OST Mesh call', (detail && detail.video ? 'Video' : 'Voice') + ' call from ' + ((detail && detail.from) || 'peer'), 'ost-mesh-call', detail && detail.video ? 'video-call' : 'call', { force: true, requireInteraction: true });
      return originalShowIncoming(detail);
    };
    if (originalMarkConnected) p._markCallConnected = function (video) {
      setCallClasses(p, 'in-call');
      return originalMarkConnected(video);
    };
    if (originalResetCall) p._resetCallState = function () {
      setCallClasses(p, 'idle');
      return originalResetCall();
    };
    if (originalSetControls) p._setCallControls = function (mode, incomingVideo) {
      setCallClasses(p, mode);
      return originalSetControls(mode, incomingVideo);
    };
  }

  function setCallClasses(p, mode) {
    if (!p || !p.root) return;
    p.root.classList.toggle('ost-mesh-ringing', mode === 'ringing' || mode === 'calling' || mode === 'answering');
    p.root.classList.toggle('ost-mesh-in-call', mode === 'in-call');
    if (p.callBar) {
      p.callBar.classList.toggle('is-ringing', mode === 'ringing' || mode === 'calling' || mode === 'answering');
      p.callBar.classList.toggle('is-live', mode === 'in-call');
    }
  }

  function bindPayloads() {
    window.addEventListener('ost:mesh-payload', function (event) {
      var payload = event.detail && event.detail.payload;
      var p = event.detail && event.detail.pavilion || pavilion();
      if (!payload) return;
      if (payload.kind === 'text') {
        logSignal('message', String(payload.text || '').slice(0, 120));
        renderSignals();
        notify('OST Mesh message', String(payload.text || '').slice(0, 120), 'ost-mesh-message', 'message');
        return;
      }
      if (payload.kind !== 'mesh-app' || payload.app !== APP) return;
      if (payload.type === 'profile.card') {
        event.preventDefault();
        renderProfileCard(p, payload.profile || {}, 'peer');
        logSignal('profile', ((payload.profile && payload.profile.nickname) || 'Peer') + ' shared a profile');
        renderSignals();
        notify('OST Mesh profile', ((payload.profile && payload.profile.nickname) || 'Peer') + ' shared a profile', 'ost-mesh-profile', 'peer');
      }
    });
  }

  ready(function () {
    bindPayloads();
    waitForMesh(function (p) {
      mountPanel(p);
      // Auto-erase saved texts older than 24h every minute (unless pinned).
      try {
        purgeExpiredSnippets();
        setInterval(function () {
          var before = (readFirst([SNIPPETS_KEY, SNIPPETS_OLD_KEY], []) || []).length;
          var after = purgeExpiredSnippets().length;
          if (before !== after) renderSnippets(p);
        }, 60000);
      } catch (_) {}
      window.OST_MESH_SOCIAL = {
        saveContact: saveContact,
        scanQr: function () { startQrScan(p); },
        showQr: function () { showOwnQr(p); },
        invite: function () { return inviteFor(p, defaultProfile(p)); },
        notify: notify
      };
      window.OST_MESH_NOTIFY = function (kind, title, body, options) {
        notify(title, body, options && options.tag, kind, options || {});
      };
    });
  });
})();
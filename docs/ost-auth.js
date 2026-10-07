/* ==========================================================================
 * OST · Wallet Auth (client) — prove who is calling, once, at the fetch layer
 * --------------------------------------------------------------------------
 * Every wallet-scoped mutation (/play/*, /loans/*, /faucet/v1/*, /wallet/payout|
 * cosign|ata-rent) now carries an ed25519 signature by the wallet's own key over
 *   OST-AUTH|v1|wallet|METHOD|path|sha256hex(body)|ts|nonce
 * The server verifies it (workers/ost-api/src/wallet-auth.js). One wrapper at
 * fetch() means no per-caller edits and nothing can forget to sign.
 *
 * - Seedless "OST Browser Wallet": the keypair is local -> signs silently.
 * - Extension wallets (Phantom/Solflare): signMessage prompts, so we sign ONE
 *   challenge, get a 12h session token, and send that instead (still with a
 *   fresh ts + nonce per request, so nothing can be replayed).
 * - No wallet connected: the request goes out unsigned; the server decides.
 * Signing uses WebCrypto Ed25519; on browsers without it, the vendored
 * tweetnacl (vendor/nacl-fast.min.js, local) is loaded lazily. Never a CDN.
 * ========================================================================== */
(function () {
  'use strict';
  if (window.OST_AUTH) return;

  var API = ((window.OST_API_BASE) || 'https://ost-api.nachogtavl.workers.dev').replace(/\/+$/, '');
  var SESSION_KEY = 'ost.auth.session.v1';
  var enc = new TextEncoder();

  function isProtected(url, method) {
    if (!/^(POST|PUT|DELETE)$/i.test(method || 'GET')) return false;
    var u; try { u = new URL(url, location.href); } catch (_) { return false; }
    if ((u.origin + '') !== new URL(API).origin) return false;
    var p = u.pathname;
    // SRV-3: the worker requires wallet auth on POST /positions (ticket sync).
    return /^\/play\//.test(p) || /^\/loans\//.test(p) || /^\/faucet\/v1\/(reserve|commit|cancel)$/.test(p) ||
      p === '/wallet/payout' || p === '/wallet/ata-rent' || /^\/wallet\/cosign/.test(p) || p === '/wallet/events' ||
      p === '/positions';
  }
  function hex(bytes) { return Array.from(bytes).map(function (b) { return b.toString(16).padStart(2, '0'); }).join(''); }
  function b64(bytes) { var s = ''; for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]); return btoa(s); }
  function nonce() { return hex(crypto.getRandomValues(new Uint8Array(12))); }
  async function sha256Hex(text) { return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(String(text || ''))))); }

  // ── C11 / AUTH-1: device clock offset ──
  // The server accepts a signature only within ±5 min of ITS clock. A phone whose
  // clock is off by more than that failed every signed rail, and the app called it
  // "service offline". We learn offset = serverTime − deviceTime (from a 401 body's
  // serverTime, a readable Date header, or /health's ts), sign with the corrected
  // time, and retry a stale_timestamp refusal once.
  var OFFSET_KEY = 'ost.auth.clockOffset.v1';
  var clockOffset = 0;
  try { var _o = JSON.parse(localStorage.getItem(OFFSET_KEY) || 'null'); if (_o && Date.now() - _o.at < 6 * 3600000 && isFinite(_o.ms)) clockOffset = Number(_o.ms); } catch (_) {}
  function nowMs() { return Date.now() + clockOffset; }
  function setOffset(serverMs, sentAt, recvAt) {
    if (!isFinite(serverMs) || serverMs <= 0) return false;
    var mid = sentAt && recvAt ? (sentAt + recvAt) / 2 : Date.now();
    var next = Math.round(serverMs - mid);
    // Ignore sub-2s jitter; it never trips the ±5 min window.
    clockOffset = Math.abs(next) < 2000 ? 0 : next;
    try { localStorage.setItem(OFFSET_KEY, JSON.stringify({ ms: clockOffset, at: Date.now() })); } catch (_) {}
    try { window.dispatchEvent(new CustomEvent('ost:clock-offset', { detail: { offsetMs: clockOffset } })); } catch (_) {}
    return true;
  }
  function serverMsFrom(body, res) {
    var t = body && (body.serverTime || body.server_time || body.now);
    if (t != null) { var n = typeof t === 'number' ? t : Date.parse(t); if (isFinite(n) && n > 0) return n; }
    try { var x = res && res.headers && res.headers.get('x-ost-server-time'); if (x) { var xn = Number(x); if (isFinite(xn) && xn > 0) return xn; } } catch (_) {}
    try { var d = res && res.headers && res.headers.get('date'); if (d) { var dn = Date.parse(d); if (isFinite(dn)) return dn; } } catch (_) {}
    return NaN;
  }
  // Passive learning (C11): every API response carries x-ost-server-time (and a
  // Date header). Adopt a new offset only when it differs from the current one
  // by more than 30 s, so a skewed device is corrected before its FIRST signed
  // call fails, and jitter never rewrites storage. Header-only (no body read).
  function learnFromResponse(res, sentAt, recvAt) {
    try {
      if (!res || !res.headers) return false;
      var ms = serverMsFrom(null, res);
      if (!isFinite(ms)) return false;
      var mid = sentAt && recvAt ? (sentAt + recvAt) / 2 : Date.now();
      var next = Math.round(ms - mid);
      if (Math.abs(next - clockOffset) <= 30000) return false;
      return setOffset(ms, sentAt, recvAt);
    } catch (_) { return false; }
  }
  function learnOffsetFromHealth() {
    var sent = Date.now();
    return nativeFetch.call(window, API + '/health', { cache: 'no-store' })
      .then(function (r) { var recv = Date.now(); return r.json().then(function (j) { var ms = serverMsFrom({ serverTime: j && (j.serverTime || j.ts) }, r); return setOffset(ms, sent, recv); }); })
      .catch(function () { return false; });
  }

  function session() { try { return window.OST_WALLET && window.OST_WALLET.session; } catch (_) { return null; } }
  function walletStr() { var s = session(); try { return s && s.publicKey ? s.publicKey.toBase58() : ''; } catch (_) { return ''; } }
  function localSecret() { var s = session(); var kp = s && s.keypair; return kp && kp.secretKey ? kp.secretKey : null; }

  // ── ed25519 signing: WebCrypto first, vendored tweetnacl as the floor ──
  var naclLoading = null;
  function loadNacl() {
    if (window.nacl && window.nacl.sign) return Promise.resolve(window.nacl);
    if (naclLoading) return naclLoading;
    naclLoading = new Promise(function (res, rej) {
      var s = document.createElement('script'); s.src = 'vendor/nacl-fast.min.js'; s.async = true;
      s.onload = function () { window.nacl && window.nacl.sign ? res(window.nacl) : rej(new Error('nacl missing')); };
      s.onerror = function () { naclLoading = null; rej(new Error('nacl failed to load')); };
      document.head.appendChild(s);
    });
    return naclLoading;
  }
  var PKCS8_PREFIX = new Uint8Array([0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20]);
  async function signLocal(msg, secretKey) {
    var seed = secretKey.slice(0, 32), bytes = enc.encode(msg);
    try {
      var der = new Uint8Array(PKCS8_PREFIX.length + 32); der.set(PKCS8_PREFIX, 0); der.set(seed, PKCS8_PREFIX.length);
      var key = await crypto.subtle.importKey('pkcs8', der, { name: 'Ed25519' }, false, ['sign']);
      return new Uint8Array(await crypto.subtle.sign('Ed25519', key, bytes));
    } catch (_) {
      var nacl = await loadNacl();
      return nacl.sign.detached(bytes, secretKey);
    }
  }
  async function signWithProvider(msg) {
    var s = session(); var p = s && s.provider;
    if (!p || typeof p.signMessage !== 'function') throw new Error('wallet cannot sign messages');
    var r = await p.signMessage(enc.encode(msg), 'utf8');
    var sig = (r && r.signature) ? r.signature : r;
    return sig instanceof Uint8Array ? sig : new Uint8Array(sig);
  }

  // ── session token for extension wallets (one prompt per 12h) ──
  function loadSession(w) { try { var j = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); return (j && j.wallet === w && Number(j.exp) > Date.now() + 60000) ? j.token : null; } catch (_) { return null; } }
  var sessionInflight = null;
  async function getSessionToken(w) {
    var cached = loadSession(w); if (cached) return cached;
    if (sessionInflight) return sessionInflight;
    sessionInflight = (async function () {
      var j = null, r = null;
      for (var attempt = 0; attempt < 2; attempt++) {
        var ts = nowMs(), n = nonce();
        var sig = await signWithProvider('OST-SESSION|v1|' + w + '|' + ts + '|' + n);
        var sentAt = Date.now();
        r = await fetch(API + '/auth/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ wallet: w, ts: ts, nonce: n, sig: b64(sig) }) });
        j = await r.json().catch(function () { return null; });
        // C11: a skewed device clock — learn the server's time and sign once more.
        var stale = j && !j.ok && (j.reason === 'stale_timestamp' || j.error === 'stale_timestamp');
        if (!stale || attempt > 0) break;
        if (!setOffset(serverMsFrom(j, r), sentAt, Date.now()) && !(await learnOffsetFromHealth())) break;
      }
      if (!j || !j.ok || !j.token) throw new Error((j && (j.message || j.error)) || 'session_failed');
      try { localStorage.setItem(SESSION_KEY, JSON.stringify({ wallet: w, token: j.token, exp: j.exp })); } catch (_) {}
      return j.token;
    })().finally(function () { sessionInflight = null; });
    return sessionInflight;
  }

  /** Build auth headers for a request, or null if no wallet can sign. */
  async function authHeaders(method, url, bodyText) {
    var w = walletStr(); if (!w) return null;
    var path = new URL(url, location.href).pathname;
    var ts = nowMs(), n = nonce();
    var h = { 'x-ost-wallet': w, 'x-ost-ts': String(ts), 'x-ost-nonce': n };
    var secret = localSecret();
    if (secret) {
      var msg = 'OST-AUTH|v1|' + w + '|' + String(method).toUpperCase() + '|' + path + '|' + (await sha256Hex(bodyText)) + '|' + ts + '|' + n;
      h['x-ost-sig'] = b64(await signLocal(msg, secret));
    } else {
      h['x-ost-session'] = await getSessionToken(w);
    }
    return h;
  }

  // ── the one choke point ──
  // Other modules also wrap window.fetch and capture whatever was current when
  // THEY installed — if that was before us, protected calls bypass the signer.
  // So we install on top of whatever is current, and re-assert for a while.
  var nativeFetch = window.fetch;
  var T = (window.__ostAuthTrace = window.__ostAuthTrace || []); var _push = T.push.bind(T); T.push = function (x) { if (T.length > 60) T.splice(0, 30); return _push(x); };
  var _shared = {}, SHARE_RE = /workers\.dev\/(topup\/config|markets(\?|$)|launchpad\/coins|positions\/recent|health(\/peg)?$|ost\/stats|ost\/price|rpc-config|stocks\/quotes)/;
  var wrapped = function (input, init) {
    try {
      var url = typeof input === 'string' ? input : (input && input.url) || '';
      var method = (init && init.method) || (input && input.method) || 'GET';
      var prot = isProtected(url, method); if (/workers\.dev/.test(url)) T.push('call ' + method + ' ' + url.slice(-40) + ' prot=' + prot);
      // Any write to the API invalidates shared reads, so nobody reads pre-write data.
      if (method !== 'GET' && /workers\.dev/.test(url)) _shared = {};
      if (!prot) {
        // SHARED READS. Several modules each fetch the same read-only endpoint at boot
        // (/topup/config x4, /markets x3, /launchpad/coins x2 - measured). Identical GETs
        // within 15s share ONE network request; each caller gets its own clone. Not a
        // stale-data mask: same URL, same moment, and any write clears it (above).
        if (method === 'GET' && SHARE_RE.test(url) && !(init && init.signal)) {
          var hit = _shared[url], nowS = Date.now();
          if (!hit || nowS - hit.at > 15000) {
            hit = _shared[url] = { at: nowS, p: nativeFetch.apply(this, arguments) };
            hit.p.catch(function () { if (_shared[url] === hit) delete _shared[url]; });
          } else T.push('shared ' + url.slice(-32));
          return hit.p.then(function (r) { return r.clone(); });
        }
        if (url && url.indexOf(API) === 0) {
          var sentP = Date.now();
          return nativeFetch.apply(this, arguments).then(function (r) { learnFromResponse(r, sentP, Date.now()); return r; });
        }
        return nativeFetch.apply(this, arguments);
      }
      var self = this, args = arguments;
      var bodyText = (init && typeof init.body === 'string') ? init.body : '';
      var sendSigned = function (h) {
        var headers = new Headers((init && init.headers) || (input && input.headers) || {});
        Object.keys(h).forEach(function (k) { headers.set(k, h[k]); });
        var next = Object.assign({}, init || {}, { headers: headers });
        // A failed SIGNED request must surface as-is — never silently re-sent unsigned
        // (that masked a CORS preflight rejection and would guarantee a 401 under enforce).
        return nativeFetch.call(self, typeof input === 'string' ? input : input.url, next);
      };
      return authHeaders(method, url, bodyText).catch(function (e) {
        // Could not SIGN (no key, wallet refused): send unsigned; the server decides.
        T.push('sign failed: ' + (e && e.message)); return null;
      }).then(function (h) {
        if (!h) { T.push('no wallet -> unsigned'); return nativeFetch.apply(self, args); }
        T.push('signed ' + Object.keys(h).join(','));
        var sentAt = Date.now();
        return sendSigned(h).then(function (res) {
          if (res && res.status !== 401) learnFromResponse(res, sentAt, Date.now());
          if (!res || res.status !== 401) return res;
          // C11: a stale_timestamp refusal means THIS device's clock is off. Learn the
          // server's time, re-sign with the corrected clock and retry ONCE (new nonce,
          // so it is not a replay). Anything else surfaces unchanged.
          var recvAt = Date.now();
          return res.clone().json().catch(function () { return null; }).then(function (body) {
            var reason = body && (body.reason || (body.error === 'stale_timestamp' ? 'stale_timestamp' : ''));
            if (reason !== 'stale_timestamp') return res;
            var learned = setOffset(serverMsFrom(body, res), sentAt, recvAt);
            var ready = learned ? Promise.resolve(true) : learnOffsetFromHealth();
            return ready.then(function (ok) {
              T.push('stale_timestamp -> offset ' + clockOffset + 'ms, retry=' + !!ok);
              if (!ok) return res;
              return authHeaders(method, url, bodyText).then(sendSigned, function () { return res; });
            });
          });
        });
      });
    } catch (_) { return nativeFetch.apply(this, arguments); }
  };
  // Install EXACTLY once. Re-asserting later would capture a wrapper that itself
  // captured us -> an infinite fetch cycle (this happened; the page hung).
  wrapped.__ostAuth = true;
  if (!window.fetch.__ostAuth) { nativeFetch = window.fetch; window.fetch = wrapped; T.push('installed over ' + String(nativeFetch).slice(0, 30)); } else T.push('already installed');

  // Sign arbitrary text with the connected wallet (ed25519): local browser wallet
  // signs silently, extension wallets show their signMessage prompt. Returns base64.
  async function signText(msg) { var secret = localSecret(); var sig = secret ? await signLocal(String(msg), secret) : await signWithProvider(String(msg)); return b64(sig); }
  window.OST_AUTH = {
    headers: authHeaders, isProtected: isProtected, sessionToken: getSessionToken, signText: signText, wallet: walletStr,
    forget: function () { try { localStorage.removeItem(SESSION_KEY); } catch (_) {} },
    // C11: corrected clock + what we learned (ms; + means the device is BEHIND the server).
    now: nowMs,
    clockOffset: function () { return clockOffset; },
    learnClock: learnOffsetFromHealth,
    // Mesh / other signers: learn from a refused response's headers (true when
    // the offset changed, so a retry with OST_AUTH.now() can succeed).
    learnFrom: learnFromResponse
  };
})();

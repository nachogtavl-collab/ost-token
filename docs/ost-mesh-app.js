/* ==========================================================================
 * OST · Mesh app — one place to add people, chat and share files (all devices)
 * --------------------------------------------------------------------------
 * Replaces the five overlapping mesh surfaces with a single sheet:
 *   Chats · Add (QR / link / scan / paste) · Me
 * Identity: the SAME keys and address the legacy pavilion uses
 *   (localStorage ost_mesh_identity_v1 / ost_mesh_addr_v1), so nobody loses
 *   their contacts. ECDH P-384 → AES-256-GCM per pair (mesh/mesh-crypto.js).
 * Delivery: every message goes through the hub's durable mailbox
 *   (7-day store-and-forward) and is pushed instantly over a WebSocket when
 *   the other side is online. Files/images are encrypted on the device and
 *   relayed as ciphertext blobs (≤ 6 MB). The hub never sees plaintext.
 * Adding a person: an invite LINK (also drawn as a QR) that the phone's own
 *   camera opens — no in-app scanner required. In-app scanning works too.
 * Outbox: every outgoing message is kept (with its payload) until the hub
 *   accepts it and is retried on reconnect / 'online' / tab focus / boot.
 * One network gate: a single WebSocket chain with jittered backoff and a
 *   circuit breaker that honours HTTP 429/503 + Retry-After for every call.
 * History: core.back.push(fn)/pop(token) — app and chat each own one entry,
 *   so the browser/system Back closes the chat, then the app.
 * window.OST_MESH_APP.{ open, close, openChat, addFromText, unread, sync, state, core }
 *   events: 'ost:mesh-app:unread' {total}, 'ost:mesh-app:message', 'ost:mesh-app:profile'
 * ========================================================================== */
import {
  generateIdentity, exportPublicBundle, importPeerBundle, deriveSessionKey,
  sealPayload, openPayload, sealBytes, openBytes, fingerprint as fpOf
} from './mesh/mesh-crypto.js?v=1';

if (!window.OST_MESH_APP) {
  const API = String(window.OST_MESH_API_BASE || window.OST_API_BASE || 'https://ost-api.nachogtavl.workers.dev').replace(/\/+$/, '');
  const K = {
    id: 'ost_mesh_identity_v1', addr: 'ost_mesh_addr_v1',
    profile: 'ost.mesh.app.profile.v1', contacts: 'ost.mesh.app.contacts.v1', msgs: 'ost.mesh.app.msgs.v1.', seen: 'ost.mesh.app.seen.v1'
  };
  const MSG_CAP = 500, BLOB_MAX = 6 * 1024 * 1024, IMG_MAX_EDGE = 1600, AUTO_FETCH_IMG = 3 * 1024 * 1024;
  const EMOJIS = ['🦊', '🐼', '🐸', '🦁', '🐙', '🦄', '🐯', '🐳', '🦉', '🐝', '🌵', '🍀', '⚡', '🔥', '🌙', '🎧', '🛰️', '🎲'];

  /* ---------- utils ---------- */
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const hex = (buf) => Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
  const b64 = (buf) => { let s = ''; const u = new Uint8Array(buf); for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s); };
  const b64u = (str) => btoa(unescape(encodeURIComponent(str))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const unb64u = (v) => { const p = String(v).replace(/-/g, '+').replace(/_/g, '/'); return decodeURIComponent(escape(atob(p + '='.repeat((4 - p.length % 4) % 4)))); };
  const validAddr = (a) => typeof a === 'string' && a.length <= 80 && /^ost-mesh:[0-9a-f]{2,}(?:-[0-9a-f]{1,4})*$/i.test(a);
  const shortA = (a) => { a = String(a || ''); const m = a.match(/([0-9a-f]{4})$/i); return 'mesh·' + (m ? m[1] : a.slice(-4)); };
  const fmtSize = (n) => n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(0) + ' KB' : (n / 1048576).toFixed(1) + ' MB';
  const tTime = (ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const tDay = (ts) => { const d = new Date(ts), n = new Date(); return d.toDateString() === n.toDateString() ? 'Today' : d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }); };
  const ago = (ts) => { const s = Math.max(0, (Date.now() - ts) / 1000); return s < 60 ? 'now' : s < 3600 ? Math.floor(s / 60) + 'm' : s < 86400 ? Math.floor(s / 3600) + 'h' : Math.floor(s / 86400) + 'd'; };
  const agoText = (ts) => { const a = ago(ts); return a === 'now' ? 'just now' : a + ' ago'; };
  const uid = () => hex(crypto.getRandomValues(new Uint8Array(8)));
  const hue = (a) => { let h = 0; for (let i = 0; i < a.length; i++) h = (h * 31 + a.charCodeAt(i)) >>> 0; return h % 360; };
  const avStyle = (a) => `background:linear-gradient(135deg,hsl(${hue(a)},70%,52%),hsl(${(hue(a) + 60) % 360},75%,42%))`;
  const lsGet = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v == null ? d : v; } catch (_) { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} };
  const ssGet = (k, d) => { try { const v = JSON.parse(sessionStorage.getItem(k) || 'null'); return v == null ? d : v; } catch (_) { return d; } };
  const ssSet = (k, v) => { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch (_) {} };
  const clipName = (s) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 40);   // peer-supplied names
  const clipEmoji = (s) => String(s == null ? '' : s).slice(0, 8);
  const isPhone = () => !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
  // Toasts live above every overlay of the app family (z 13500). Message toasts
  // are tappable and open that chat (opts.onTap).
  let toastHost;
  function toast(msg, kind, opts) {
    try {
      opts = opts || {};
      if (!toastHost || !toastHost.isConnected) {
        toastHost = document.querySelector('.omx-toasts');
        if (!toastHost) { toastHost = document.createElement('div'); toastHost.className = 'omx-toasts'; document.body.appendChild(toastHost); }
        toastHost.setAttribute('role', 'status'); toastHost.setAttribute('aria-live', 'polite');
      }
      if (kind === 'err') S.lastErr = msg;
      const t = document.createElement('div'); t.className = 'omx-toast' + (kind ? ' ' + kind : ''); t.textContent = msg;
      const kill = () => { t.classList.add('out'); setTimeout(() => t.remove(), 300); };
      if (typeof opts.onTap === 'function') {
        t.classList.add('tap'); t.setAttribute('role', 'button'); t.tabIndex = 0;
        const go = () => { kill(); try { closeSheet(-1); opts.onTap(); } catch (_) {} };   // the tap navigates: an open sheet is left behind, not kept on top
        t.addEventListener('click', go);
        t.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
      }
      while (toastHost.children.length >= 4) toastHost.firstChild.remove();
      placeToasts();
      toastHost.appendChild(t);
      setTimeout(kill, opts.ms || (kind === 'err' ? 4500 : 3200));
    } catch (_) {}
  }
  // Wide screens: while the app's side drawer is open, toasts are centred over the
  // drawer instead of straddling its edge (the page behind is blurred out).
  function placeToasts() {
    if (!toastHost) return;
    let left = '', width = '';
    try {
      const sh = appIsOpen() && root ? root.querySelector('.omx-shell') : null, r = sh && sh.getBoundingClientRect();
      if (r && r.width > 0 && r.width < window.innerWidth - 40) { left = Math.round(r.left + r.width / 2) + 'px'; width = Math.round(Math.min(420, r.width - 24)) + 'px'; }
    } catch (_) {}
    if (toastHost.style.left !== left) toastHost.style.left = left;
    if (toastHost.style.width !== width) toastHost.style.width = width;
  }

  /* ---------- state ---------- */
  const S = {
    identity: null, address: '', bundle: null, fp: '', profile: lsGet(K.profile, null),
    contacts: lsGet(K.contacts, {}), seen: new Set(lsGet(K.seen, [])), presence: {},
    view: 'chats', peer: null, keys: {}, blobs: {}, ws: null, wsOk: false, wsTries: 0, announced: false, announceErr: '',
    typingFrom: {}, scanStream: null, scanTimer: null, pendingAdd: null, ready: false,
    backApp: 0, backChat: 0, opener: null, hubOkAt: 0, pollOkAt: 0, netErrAt: 0, bootAt: Date.now(), newBelow: 0, friendsAt: 0,
    dir: {}, hubDown: false, viewIsDefault: false, msgTop: 0
  };
  if (!S.profile) { const old = lsGet('ost.mesh.profile.v2', null); S.profile = { name: (old && (old.nickname || old.handle)) || '', emoji: (old && old.avatar && old.avatar.length <= 4 ? old.avatar : '') || EMOJIS[Math.floor(Math.random() * EMOJIS.length)] }; lsSet(K.profile, S.profile); }
  const myName = () => (S.profile && S.profile.name) || shortA(S.address);
  const contact = (a) => S.contacts[a];
  const nameOf = (a) => { const c = contact(a); return (c && c.name) || shortA(a); };
  const emojiOf = (a) => { const c = contact(a); return (c && c.emoji) || ''; };
  const saveContacts = () => { lsSet(K.contacts, S.contacts); syncUnread(); };
  const msgsOf = (a) => lsGet(K.msgs + a, []);
  const saveMsgs = (a, list) => lsSet(K.msgs + a, list.slice(-MSG_CAP));
  function rememberSeen(id) { if (S.seen.has(id)) return false; S.seen.add(id); if (S.seen.size > 3000) S.seen = new Set([...S.seen].slice(-2000)); lsSet(K.seen, [...S.seen]); return true; }
  function upsertContact(a, patch) { const c = S.contacts[a] || { addr: a, state: 'friend', ts: Date.now(), unread: 0 }; Object.assign(c, patch || {}); S.contacts[a] = c; saveContacts(); return c; }
  // Blocked people never count (their mail is dropped anyway); people you have not
  // accepted yet ('request' = wrote first, 'pending-in' = asked to connect) show as
  // requests (Add tab), not as unread mail.
  const isReqState = (st) => st === 'request' || st === 'pending-in';
  function totalUnread() { return Object.values(S.contacts).reduce((n, c) => n + (c && c.state !== 'blocked' && !isReqState(c.state) ? (c.unread || 0) : 0), 0); }

  /* ---------- unread: one event for every launcher + "(n) " in the tab title ---------- */
  let unreadLast = -1, titleObs = null;
  const TITLE_RE = /^\(\d+\+?\) /;
  function applyTitle() {
    try {
      const want = unreadLast > 0 ? '(' + (unreadLast > 99 ? '99+' : unreadLast) + ') ' : '';
      const base = document.title.replace(TITLE_RE, '');
      if (document.title !== want + base) document.title = want + base;
    } catch (_) {}
  }
  function syncUnread(force) {
    const n = totalUnread();
    if (n === unreadLast && !force) return n;
    unreadLast = n; applyTitle();
    // Other code may rewrite <title> while mail is waiting: keep the prefix on it.
    try {
      if (n > 0 && !titleObs && window.MutationObserver) { const el = document.querySelector('head > title'); if (el) { titleObs = new MutationObserver(applyTitle); titleObs.observe(el, { childList: true, characterData: true, subtree: true }); } }
      else if (n === 0 && titleObs) { titleObs.disconnect(); titleObs = null; }
    } catch (_) {}
    try { window.dispatchEvent(new CustomEvent('ost:mesh-app:unread', { detail: { total: n, count: n } })); } catch (_) {}
    return n;
  }

  /* ---------- plugin surface (ost-social.js, ost-mesh-call.js) ----------
   * views:     name -> { tab?: {ico, lbl, order}, render(ctx) }   extra tabs/views
   * headBtns:  [(peer) -> html]                                    chat header buttons
   * attach:    [{ ico, lbl, run(peer) }]                           chat "+" menu items
   * actions:   name -> fn(el, event)                               data-act handlers
   * ws:        [fn(m)]                                             every socket message
   * badges:    name -> () => number                                tab badges
   * menu:      [(peer) -> [{ label, sub?, danger?, run() }]]       extra rows in the chat ⋯ sheet */
  const X = { views: {}, headBtns: [], attach: [], actions: {}, ws: [], badges: {}, menu: [] };

  /* ---------- identity (shared with legacy mesh.js) ---------- */
  async function loadIdentity() {
    const saved = lsGet(K.id, null);
    if (saved && saved.kex && saved.sig) {
      try {
        const imp = (jwk, alg, usages) => crypto.subtle.importKey('jwk', jwk, alg, true, usages);
        S.identity = {
          kex: { privateKey: await imp(saved.kex.priv, { name: 'ECDH', namedCurve: 'P-384' }, ['deriveKey', 'deriveBits']), publicKey: await imp(saved.kex.pub, { name: 'ECDH', namedCurve: 'P-384' }, []) },
          sig: { privateKey: await imp(saved.sig.priv, { name: 'ECDSA', namedCurve: 'P-384' }, ['sign']), publicKey: await imp(saved.sig.pub, { name: 'ECDSA', namedCurve: 'P-384' }, ['verify']) }
        };
      } catch (_) { S.identity = null; }
    }
    if (!S.identity) {
      const id = await generateIdentity();
      const ex = (k) => crypto.subtle.exportKey('jwk', k);
      lsSet(K.id, { kex: { priv: await ex(id.kex.privateKey), pub: await ex(id.kex.publicKey) }, sig: { priv: await ex(id.sig.privateKey), pub: await ex(id.sig.publicKey) } });
      S.identity = id;
    }
    let a = null; try { a = localStorage.getItem(K.addr); } catch (_) {}
    if (!a) { a = 'ost-mesh:' + hex(crypto.getRandomValues(new Uint8Array(8))).match(/.{1,4}/g).join('-'); try { localStorage.setItem(K.addr, a); } catch (_) {} }
    S.address = a;
    S.bundle = await exportPublicBundle(S.identity);
    S.fp = await fpOf(S.bundle);
  }
  async function resetIdentity() {
    try { localStorage.removeItem(K.id); localStorage.removeItem(K.addr); } catch (_) {}
    S.keys = {}; await loadIdentity(); S.announced = false; await announce(); connectWs(true);
  }

  /* ---------- one network gate: circuit breaker shared by every hub call ----------
   * Hub-wide trouble (HTTP 502 / 503 / 504, or a 429 about the hub as a whole)
   * opens the breaker for Retry-After (or a jittered exponential backoff, capped)
   * — signed(), announce, lookup, presence, the inbox poll, the socket and the
   * outbox all wait for it instead of hammering. A 429 about ONE recipient or ONE
   * action (a full mailbox, the daily upload quota, a per-route social limit, the
   * file limit) fails only that request: the hub carries `scope` on every 429. */
  const NET = { until: 0, fails: 0, tick: 0 };
  const hubBusy = () => Date.now() < NET.until;
  const busySecs = () => Math.max(1, Math.ceil((NET.until - Date.now()) / 1000));
  const HUB_SCOPES = /^(announce|identity|signal|signal-inbox|signal-from|signal-inbox-to|presence|msg)$/;
  const SCOPED_ERR = /^(mailbox_full|daily_upload_quota|blob_rate_limited|tip_in_flight)$/;
  function scoped429(status, body) {
    if (status !== 429 || !body || typeof body !== 'object') return false;
    if (SCOPED_ERR.test(String(body.error || ''))) return true;
    return typeof body.scope === 'string' && body.scope !== '' && !HUB_SCOPES.test(body.scope);
  }
  // Newer hubs refuse per-action quotas / per-recipient states with 403 / 409 +
  // { error, retryAfter, scope } (no Retry-After header): same handling, no breaker.
  function scopedErr(status, body) {
    if (scoped429(status, body)) return true;
    return (status === 403 || status === 409) && !!body && typeof body === 'object' && Number(body.retryAfter) > 0 && typeof body.scope === 'string' && body.scope !== '';
  }
  function retryAfterOf(headers, body) {
    let s = 0; try { s = Number(headers && headers.get && headers.get('Retry-After')) || 0; } catch (_) {}
    if (!(s > 0) && body && Number(body.retryAfter) > 0) s = Number(body.retryAfter);
    return s > 0 ? s : 0;
  }
  function noteHub(status, headers, body) {
    if (scoped429(status, body)) return false;                      // that one request fails; everything else carries on
    if (status === 429 || status === 502 || status === 503 || status === 504) {
      const s = retryAfterOf(headers, body);
      NET.fails++; S.hubDown = true;
      const backoff = Math.min(60, 2 * Math.pow(2, Math.min(5, NET.fails - 1)));
      const wait = Math.min(300, Math.max(s, backoff)) * 1000 * (0.9 + Math.random() * 0.2);
      NET.until = Math.max(NET.until, Date.now() + wait);
      if (!NET.tick) NET.tick = setInterval(() => { if (hubBusy()) { paintStatus(); return; } clearInterval(NET.tick); NET.tick = 0; paintStatus(); wsKick(); syncInbox(); flushOutbox(true); }, 1000);
      paintStatus();
      return true;
    }
    if (status >= 200 && status < 500) NET.fails = 0;
    return false;
  }
  // The hub answered after failing: the socket's pending backoff (up to a minute) is
  // pointless now — reconnect at once.
  function hubUp() { S.hubOkAt = Date.now(); if (S.hubDown) { S.hubDown = false; setTimeout(wsKick, 0); } }
  function hubDownNow() { S.netErrAt = Date.now(); S.hubDown = true; }
  const fmtWait = (s) => s < 90 ? Math.ceil(s) + ' s' : s < 5400 ? Math.ceil(s / 60) + ' min' : Math.ceil(s / 3600) + ' h';
  const TRANSIENT = /^(network|hub_busy|rate_limited|http_429|http_5\d\d|mesh_identity_unknown|unavailable|timeout|mailbox_full|hourly_message_limit|blob_rate_limited)$/;
  function netErr(code, status, extra) {
    const e = new Error(explain(code, extra)); e.code = code; e.status = status || 0;
    e.transient = TRANSIENT.test(code) || status === 429 || status >= 500;
    if (extra) { e.scoped = !!extra.scoped; e.retryAfter = extra.retryAfter || 0; e.scope = extra.scope || ''; }
    return e;
  }

  /* ---------- signed requests (OST-MESH|v1 canonical, verified by the hub) ---------- */
  async function signHeaders(method, pathq, bodyHash) {
    const ts = Date.now(), nonce = hex(crypto.getRandomValues(new Uint8Array(12)));
    const msg = `OST-MESH|v1|${S.address}|${method}|${pathq}|${bodyHash}|${ts}|${nonce}`;
    const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-384' }, S.identity.sig.privateKey, new TextEncoder().encode(msg));
    return { addr: S.address, ts, nonce, sig: b64(sig) };
  }
  async function signed(method, pathq, body) {
    if (hubBusy()) throw netErr('hub_busy');
    const isBin = body instanceof Uint8Array || body instanceof ArrayBuffer;
    const bodyText = body && !isBin ? JSON.stringify(body) : '';
    const hashSrc = isBin ? body : new TextEncoder().encode(bodyText);
    const h = await signHeaders(method, pathq, hex(await crypto.subtle.digest('SHA-256', hashSrc)));
    const headers = { 'x-mesh-addr': h.addr, 'x-mesh-ts': String(h.ts), 'x-mesh-nonce': h.nonce, 'x-mesh-sig': h.sig };
    if (bodyText) headers['Content-Type'] = 'application/json';
    if (isBin) headers['Content-Type'] = 'application/octet-stream';
    let r;
    try { r = await fetch(API + pathq, { method, headers, body: isBin ? body : (bodyText || undefined), cache: 'no-store' }); }
    catch (_) { hubDownNow(); paintStatus(); throw netErr('network'); }
    const j = await r.json().catch(() => null);
    if (!noteHub(r.status, r.headers, j) && r.status < 500) hubUp();   // the hub itself answered
    if (r.ok && j && j.ok !== false) return j;
    const code = (r.status === 429 && (!j || !j.error || j.error === 'rate_limited')) ? 'rate_limited' : ((j && j.error) || ('http_' + r.status));
    if (code === 'mesh_identity_unknown') { S.announced = false; announce().catch(() => {}); }
    throw netErr(code, r.status, scopedErr(r.status, j) ? { scoped: true, retryAfter: retryAfterOf(r.headers, j), scope: String(j.scope || '') } : null);
  }
  // Human sentences for hub / network failures (never raw "Failed to fetch").
  function explain(code, extra) {
    code = String(code || '');
    const wait = extra && extra.retryAfter > 0 ? fmtWait(extra.retryAfter) : '';
    if (code === 'mailbox_full') return 'Their mailbox is full' + (wait ? ' — retrying in ' + wait : ' — try again later') + '.';
    if (code === 'daily_upload_quota') return 'You reached today\'s upload limit' + (wait ? ' — try again in ' + wait : ' — try again tomorrow') + '.';
    if (code === 'blob_rate_limited' || (extra && extra.scoped && extra.scope === 'blob')) return 'Too many files this hour' + (wait ? ' — try again in ' + wait : ' — try again later') + '.';
    if (code === 'hourly_message_limit') return 'You sent a lot of messages this hour' + (wait ? ' — it goes out in ' + wait : ' — it goes out later') + '.';
    if (code === 'friend_requests_too_fast' || code === 'friend_responses_too_fast') return 'Too many requests for now' + (wait ? ' — try again in ' + wait : ' — try again later') + '.';
    if (code === 'social_hourly_limit' || code === 'uploading_too_fast') return 'You are posting very fast' + (wait ? ' — try again in ' + wait : ' — try again later') + '.';
    if (code === 'tip_in_flight') return 'A tip is still being checked' + (wait ? ' — try again in ' + wait : ' — try again shortly') + '.';
    if ((code === 'rate_limited' || /^http_4/.test(code)) && extra && extra.scoped) return 'You are doing that too often — try again in ' + (wait || 'a moment') + '.';
    if (code === 'no_pending_request') return 'That request is no longer pending — send them a request instead.';
    if (code === 'hub_busy' || code === 'rate_limited' || /rate.?limit|^http_429$|too.?many/i.test(code)) return hubBusy() ? 'The hub is busy — retrying in ' + busySecs() + ' s.' : 'The hub is busy — try again in a moment.';
    if (code === 'network' || /failed to fetch|networkerror|load failed|network request failed/i.test(code)) return navigator.onLine === false ? 'You are offline.' : 'Cannot reach the OST hub — check your connection.';
    if (code === 'timeout') return 'The hub took too long to answer.';
    if (code === 'mesh_identity_unknown') return 'Registering your mesh identity — try again in a few seconds.';
    if (code === 'mesh_auth_stale') return 'Your device clock looks wrong — fix the time and retry.';
    if (/^identity_locked/.test(code)) return 'This address is registered with different keys on the hub. Reset identity in Settings to get a fresh address.';
    if (/^http_5|unavailable/.test(code)) return 'The mesh hub is unavailable right now — try again shortly.';
    if (code === 'blob_too_large' || code === 'http_413') return 'That file is over the 6 MB relay limit.';
    if (code === 'blocked') return 'This person is not accepting your messages.';
    if (code === 'http_401' || code === 'http_403' || /^mesh_auth|signature/.test(code)) return 'The hub did not accept this device\'s signature — reload and try again.';
    if (code === 'http_404' || /not.?found/.test(code)) return 'The hub could not find that.';
    if (/^http_4\d\d$/.test(code)) return 'The hub refused this request (HTTP ' + code.slice(5) + ').';
    return code.replace(/_/g, ' ');
  }
  // Profiles change only through the signed social route (an unsigned announce
  // can no longer overwrite them — the public bundle would let anyone do that).
  async function saveProfile(patch) {
    if (!S.announced) await announce();
    const r = await signed('POST', '/mesh/v1/social/profile', { from: S.address, ...patch });
    if (r && r.profile) { S.profile = Object.assign(S.profile || {}, { name: r.profile.name, emoji: r.profile.emoji, bio: r.profile.bio, avatar: r.profile.avatar, wallet: r.profile.wallet }); lsSet(K.profile, S.profile); }
    try { window.dispatchEvent(new CustomEvent('ost:mesh-app:profile', { detail: r && r.profile })); } catch (_) {}
    return r && r.profile;
  }
  // Single-flight: concurrent callers share one request.
  let announcing = null;
  function announce() {
    if (!S.identity) return Promise.resolve(false);
    if (announcing) return announcing;
    if (hubBusy()) { S.announceErr = 'rate_limited'; paintStatus(); return Promise.resolve(false); }
    announcing = (async () => {
      try {
        const r = await fetch(API + '/mesh/v1/identity/announce', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ address: S.address, bundle: S.bundle, fingerprint: S.fp, profile: { name: S.profile.name || '', emoji: S.profile.emoji || '' } }) });
        const j = await r.json().catch(() => null);
        if (!noteHub(r.status, r.headers, j) && r.status < 500) hubUp();
        if (r.ok && j && j.ok) { S.announced = true; S.announceErr = ''; paintStatus(); return true; }
        S.announceErr = r.status === 429 ? 'rate_limited' : ((j && j.error) || ('http_' + r.status));
      } catch (e) { S.announceErr = 'offline'; hubDownNow(); }
      S.announced = false; paintStatus(); return false;
    })().finally(() => { announcing = null; });
    return announcing;
  }
  // null = the hub does not know this address; throws (e.transient) when the hub could not answer.
  async function lookup(addr) {
    if (hubBusy()) throw netErr('hub_busy');
    let r; try { r = await fetch(API + '/mesh/v1/identity/lookup?address=' + encodeURIComponent(addr), { cache: 'no-store' }); } catch (_) { hubDownNow(); throw netErr('network'); }
    if (r.status === 404 || r.status === 400) { hubUp(); return null; }
    const j = await r.json().catch(() => null);
    if (!noteHub(r.status, r.headers, j) && r.status < 500) hubUp();
    if (!r.ok) throw netErr(r.status === 429 ? 'rate_limited' : 'http_' + r.status, r.status);
    return j && j.bundle ? j : null;
  }
  // Keys for a peer. A contact's directory record is saved on the contact; someone
  // who is NOT a contact is only cached in memory (S.dir) — this never adds them:
  // the caller decides what they are (a stranger's first message is a 'request').
  async function keyFor(addr) {
    if (S.keys[addr]) return S.keys[addr];
    let c = contact(addr), bundle = c && c.bundle;
    if (!bundle) {
      const rec = S.dir[addr] || await lookup(addr);
      if (!rec) { const e = new Error('This person has not been seen by the hub yet. Ask them to open OST Mesh once.'); e.code = 'unknown_peer'; throw e; }
      c = contact(addr);
      if (c) upsertContact(addr, { bundle: rec.bundle, fp: rec.fingerprint || '', name: c.name || clipName(rec.profile && rec.profile.name), emoji: c.emoji || clipEmoji(rec.profile && rec.profile.emoji) });
      else S.dir[addr] = rec;
      bundle = rec.bundle;
    }
    const peer = await importPeerBundle(bundle);
    S.keys[addr] = await deriveSessionKey(S.identity, peer.kexPub);
    return S.keys[addr];
  }

  /* ---------- realtime socket + mailbox ---------- */
  /* Single-flight socket: ONE live socket or ONE pending reconnect timer at any
   * time. onclose of a superseded socket is ignored; keepalive / online /
   * visibilitychange / open() calls collapse into the same chain. */
  function wsUrl() { return API.replace(/^http/, 'ws') + '/mesh/v1/ws'; }
  let wsTimer = 0, wsGen = 0, wsBusy = 0;
  async function connectWs(force) {
    if (!S.identity) return;
    if (!force) {
      if (wsBusy) return;                                                   // a connect is already in flight
      if (S.ws && (S.ws.readyState === 0 || S.ws.readyState === 1)) return; // live or opening
      if (wsTimer) return;                                                  // a reconnect is already scheduled
    }
    clearTimeout(wsTimer); wsTimer = 0;
    if (hubBusy()) { scheduleWs(NET.until - Date.now()); return; }
    const gen = ++wsGen; wsBusy = gen;                                      // claimed before any await
    const old = S.ws; S.ws = null;
    if (old) { old.onclose = old.onerror = old.onmessage = old.onopen = null; try { old.close(); } catch (_) {} }
    let h; try { h = await signHeaders('GET', '/mesh/v1/ws', hex(await crypto.subtle.digest('SHA-256', new Uint8Array()))); } catch (_) { if (wsBusy === gen) wsBusy = 0; return; }
    if (gen !== wsGen) return;                                              // superseded while signing
    const url = wsUrl() + '?maddr=' + encodeURIComponent(h.addr) + '&mts=' + h.ts + '&mnonce=' + h.nonce + '&msig=' + encodeURIComponent(h.sig);
    let ws; try { ws = new WebSocket(url); } catch (_) { wsBusy = 0; scheduleWs(); return; }
    S.ws = ws; wsBusy = 0;
    // The backoff only resets once a socket has stayed up for a while: a hub that
    // accepts and drops at once must not turn into a reconnect every second.
    ws.onopen = () => { if (S.ws !== ws) return; S.wsOk = true; S.wsOpenAt = Date.now(); S.hubOkAt = Date.now(); paintStatus(); syncInbox(); askPresence(); flushOutbox(true); };
    ws.onmessage = (e) => { if (S.ws !== ws) return; let m; try { m = JSON.parse(e.data); } catch (_) { return; } onWs(m); };
    ws.onclose = () => { if (S.ws !== ws) return; S.ws = null; S.wsOk = false; if (S.wsOpenAt && Date.now() - S.wsOpenAt > 20000) S.wsTries = 0; S.wsOpenAt = 0; paintStatus(); scheduleWs(); };
    ws.onerror = () => { try { ws.close(); } catch (_) {} };
  }
  // Jittered exponential backoff (1 s … 60 s); never more than one timer.
  function scheduleWs(minDelay) {
    if (wsTimer || document.hidden) return;                                 // hidden tabs resume on visibilitychange
    const base = Math.min(60000, 1000 * Math.pow(2, Math.min(6, S.wsTries++)));
    const d = Math.max(minDelay || 0, Math.round(base * (0.5 + Math.random() * 0.5)));
    wsTimer = setTimeout(() => { wsTimer = 0; connectWs(); }, d);
  }
  // The network / hub just came back: drop the pending backoff and reconnect now
  // (never touches a socket that is up or opening).
  function wsKick() {
    if (!S.identity || wsBusy || (S.ws && (S.ws.readyState === 0 || S.ws.readyState === 1))) return;
    clearTimeout(wsTimer); wsTimer = 0; S.wsTries = 0;
    connectWs();
  }
  function wsSend(obj) { try { if (S.ws && S.ws.readyState === 1) { S.ws.send(JSON.stringify(obj)); return true; } } catch (_) {} return false; }
  function onWs(m) {
    if (!m || typeof m !== 'object') return;
    X.ws.forEach((fn) => { try { fn(m); } catch (_) {} });
    if (m.t === 'msg' && m.item) { handleIncoming(m.item).then((ok) => { if (ok !== false) wsSend({ t: 'ack', items: [{ id: m.item.id, ts: m.item.ts }] }); else retryInboxSoon(); }); }
    else if (m.t === 'typing' && m.from) { S.typingFrom[m.from] = Date.now(); if (S.view === 'chat' && S.peer === m.from) paintTyping(); }
    else if (m.t === 'presence' && m.presence) { Object.assign(S.presence, m.presence); if (S.view === 'chats') paintChats(); if (S.view === 'chat') paintChatHead(); }
    else if (m.t === 'hello') { /* authenticated */ }
  }
  // Mailbox poll — single-flight, skipped while the breaker is open. Items whose
  // processing failed transiently are NOT acked and are retried a little later.
  // The hub pages the mailbox (`more: true`): a backlog drains in one sync, page
  // after page (each page acked over HTTP first, so the next one is new mail).
  let inboxP = null, inboxRetryT = 0;
  function syncInbox() {
    if (inboxP) return inboxP;
    if (!S.identity || hubBusy()) return Promise.resolve();
    inboxP = (async () => {
      try {
        for (let page = 0; page < 8; page++) {
          const j = await signed('GET', '/mesh/v1/msg/inbox?to=' + encodeURIComponent(S.address) + '&drain=0');
          S.pollOkAt = Date.now();
          const items = (j && j.messages) || [], more = !!(j && j.more);
          const acks = []; let retry = false;
          for (const it of items) { const ok = await handleIncoming(it); if (ok !== false) acks.push({ id: it.id, ts: it.ts }); else retry = true; }
          if (acks.length) {
            if (more) await signed('POST', '/mesh/v1/msg/ack', { to: S.address, items: acks });
            else if (!wsSend({ t: 'ack', items: acks })) await signed('POST', '/mesh/v1/msg/ack', { to: S.address, items: acks }).catch(() => {});
          }
          if (retry) retryInboxSoon();
          if (!more || retry || !acks.length || hubBusy()) break;
        }
      } catch (_) {}
      paintStatus();
    })().finally(() => { inboxP = null; });
    return inboxP;
  }
  function retryInboxSoon() { if (inboxRetryT) return; inboxRetryT = setTimeout(() => { inboxRetryT = 0; syncInbox(); }, 20000 + Math.random() * 10000); }
  function askPresence() {
    const addrs = Object.keys(S.contacts).filter((a) => S.contacts[a].state !== 'blocked').slice(0, 60); if (!addrs.length) return;
    if (wsSend({ t: 'presence', addrs })) return;
    if (hubBusy()) return;
    fetch(API + '/mesh/v1/presence?addrs=' + encodeURIComponent(addrs.join(',')), { cache: 'no-store' })
      .then((r) => r.json().catch(() => null).then((j) => { noteHub(r.status, r.headers, j); return j; }))
      .then((j) => { if (j && j.presence) { Object.assign(S.presence, j.presence); if (S.view === 'chats') paintChats(); if (S.view === 'chat') paintChatHead(); } }).catch(() => {});
  }
  const online = (a) => !!(S.presence[a] && S.presence[a].online);

  /* ---------- incoming ---------- */
  /* Returns true when the item is done with (stored, or dropped on purpose) — the
   * caller acks it and the hub deletes it. Returns false when processing failed
   * for a reason that may go away (hub busy, network, key lookup) — the item is
   * NOT acked, stays in the mailbox and is retried on the next sync. */
  const isBlocked = (a) => { const c = contact(a); return !!(c && c.state === 'blocked'); };
  const appIsOpen = () => !!(root && root.classList.contains('open'));
  async function handleIncoming(item) {
    if (!item || !item.id || !validAddr(item.from)) return true;
    if (S.seen.has(item.id)) return true;                     // processed before (ack was lost)
    const from = item.from, p = item.payload || {};
    if (isBlocked(from)) { rememberSeen(item.id); return true; }   // blocked: dropped silently, never toasts or counts
    if (p.t === 'friend-request') {
      const c = contact(from), pn = clipName(p.profile && p.profile.name), pe = clipEmoji(p.profile && p.profile.emoji);
      if (!c || c.state !== 'friend') upsertContact(from, { state: 'pending-in', name: (c && c.name) || pn, emoji: (c && c.emoji) || pe, ts: item.ts });
      rememberSeen(item.id);
      toast((pn || shortA(from)) + ' wants to connect', '', { onTap: () => { open('chats'); } });
      if (S.view === 'chats' || S.view === 'add') render(); else paintBadge();
      return true;
    }
    if (p.t === 'friend-accepted') {
      const c = contact(from);
      upsertContact(from, { state: 'friend', name: (c && c.name) || clipName(p.profile && p.profile.name), emoji: (c && c.emoji) || clipEmoji(p.profile && p.profile.emoji) });
      rememberSeen(item.id);
      try { await keyFor(from); } catch (_) {}
      toast(nameOf(from) + ' accepted — you are connected', '', { onTap: () => openChat(from) });
      if (S.view === 'chat' && S.peer === from) { paintChatHead(); paintMsgs(); } else render();
      return true;
    }
    if (p.t === 'dm' && p.sealed) {
      let inner;
      try { inner = await openSealed(from, p.sealed); }
      catch (e) {
        if (e && e.transient) return false;                   // hub/network could not answer: try again on the next sync
        rememberSeen(item.id);
        appendMsg(from, { id: item.id, dir: 'sys', text: 'A message arrived that could not be decrypted (' + ((e && e.message) || 'key mismatch') + ').', ts: item.ts });
        if (S.view === 'chat' && S.peer === from) paintMsgs();
        return true;
      }
      rememberSeen(item.id);
      if (!inner || typeof inner !== 'object') return true;
      // Someone who is not a contact yet is a 'request' (Add tab: "messaged you ·
      // Accept"): no message text in toasts or OS alerts, no unread count, no calls.
      const c = contact(from); if (!c) upsertContact(from, { state: 'request', ts: item.ts });
      if (inner.profile && inner.profile.name && (!c || !c.name)) upsertContact(from, { name: clipName(inner.profile.name), emoji: clipEmoji(inner.profile.emoji) });
      const unaccepted = isReqState((contact(from) || {}).state);
      const msg = innerToMsg(inner, item);
      if (!msg) return true;
      if (S.typingFrom[from]) { delete S.typingFrom[from]; if (S.view === 'chat' && S.peer === from) paintTyping(); }   // their message landed: no lingering 'typing…'
      const visible = S.view === 'chat' && S.peer === from && !document.hidden && appIsOpen();
      // Live location: one bubble per sharing session, updated in place. A session
      // never restarts once ended, and an older fix never overwrites a newer one.
      if (msg.kind === 'loc' && msg.lid) {
        const list = msgsOf(from); const old = list.find((x) => x.lid === msg.lid);
        if (old) {
          if (!msg.ended && (old.ended || (msg.ts || 0) < (old.upd || 0))) return true;
          Object.assign(old, { lat: msg.lat, lng: msg.lng, acc: msg.acc, upd: Math.max(msg.ts || 0, old.upd || 0), ended: !!(old.ended || msg.ended), until: msg.until || old.until });
          saveMsgs(from, list); if (visible) paintMsgs(); return true;
        }
      }
      if (!appendMsg(from, msg)) return true;                 // same message again (a sender retry)
      upsertContact(from, { last: { text: previewOf(msg), ts: msg.ts }, unread: visible ? 0 : ((contact(from) || {}).unread || 0) + 1 });
      if (S.view === 'chat' && S.peer === from && appIsOpen()) {
        const pinned = isPinned(); paintMsgs();
        if (!pinned) { S.newBelow++; paintNewPill(); }
      }
      if (!visible) {
        const pv = previewOf(msg);
        if (unaccepted) { if (!c) toast(nameOf(from) + ' wants to message you', '', { onTap: () => open('chats') }); }   // once, without the text
        else {
          if (!(S.view === 'chat' && S.peer === from && appIsOpen())) toast(nameOf(from) + ': ' + pv.slice(0, 60), 'msg', { onTap: () => openChat(from), ms: 5000 });
          if (!appIsOpen() || document.hidden) notifyMsg(from, pv);
        }
        if (S.view === 'chats') paintChats();
      }
      paintBadge();
      try { window.dispatchEvent(new CustomEvent('ost:mesh-app:message', { detail: { from, kind: msg.kind } })); } catch (_) {}
      return true;
    }
    rememberSeen(item.id);
    return true;
  }
  // keyFor() may need a directory lookup: when the hub cannot answer it throws with
  // e.transient and the item is retried later. A decrypt failure with a known key is
  // final (keys are never swapped silently for an existing contact).
  async function openSealed(from, sealed) {
    const key = await keyFor(from);
    return openPayload(key, sealed);
  }
  // OS-level alert while the app is closed or the tab is hidden: ost-notifications.js
  // decides (it needs the user's opt-in); else the Notification API, only if already granted.
  const notifiedAt = {};
  function notifyMsg(from, text) {
    try {
      const title = nameOf(from), body = String(text || '').slice(0, 140);
      const url = location.origin + location.pathname + location.search.replace(/([?&])openMesh=1&?/, '$1').replace(/[?&]$/, '') + '#chat=' + from;
      if (window.OST_NOTIFY && typeof window.OST_NOTIFY.mesh === 'function') { window.OST_NOTIFY.mesh('message', title, body, { tag: 'ost-mesh-dm-' + from, url, addr: from }); return; }
      if (!document.hidden || !('Notification' in window) || Notification.permission !== 'granted') return;
      if (Date.now() - (notifiedAt[from] || 0) < 30000) return; notifiedAt[from] = Date.now();
      const n = new Notification(title, { body, tag: 'ost-mesh-dm-' + from, icon: 'icon-192.png' });
      n.onclick = () => { try { window.focus(); } catch (_) {} openChat(from); n.close(); };
    } catch (_) {}
  }
  function appendMsg(a, m) { const list = msgsOf(a); if (m.id && list.some((x) => x.id === m.id)) return false; list.push(m); saveMsgs(a, list); return true; }
  function updateMsg(a, id, patch) { const list = msgsOf(a); const m = list.find((x) => x.id === id); if (m) { Object.assign(m, patch); saveMsgs(a, list); } return m; }
  const num = (v, lo, hi) => { const n = Number(v); return Number.isFinite(n) && n >= lo && n <= hi ? n : null; };
  function innerToMsg(inner, item) {
    const base = { id: String(inner.id || item.id).slice(0, 64), dir: 'them', ts: Number(inner.ts) || item.ts };
    switch (inner.k) {
      case 'file': return { ...base, kind: 'file', name: String(inner.name || 'file').slice(0, 120), mime: String(inner.mime || '').slice(0, 80), size: Number(inner.size) || 0, blob: String(inner.blob || ''), thumb: typeof inner.thumb === 'string' && inner.thumb.length < 12000 && /^data:image\//.test(inner.thumb) ? inner.thumb : '' };
      case 'loc': { const lat = num(inner.lat, -90, 90), lng = num(inner.lng, -180, 180); if (lat == null || lng == null) return null; return { ...base, kind: 'loc', lat, lng, acc: num(inner.acc, 0, 1e6) || 0, lid: inner.lid ? String(inner.lid).slice(0, 40) : '', live: !!inner.live, until: Number(inner.until) || 0, ended: !!inner.ended, upd: base.ts }; }
      case 'pay': { const amount = num(inner.amount, 0, 1e12); if (!amount || !/^[1-9A-HJ-NP-Za-km-z]{64,100}$/.test(String(inner.sig || ''))) return null; return { ...base, kind: 'pay', ccy: ['OST', 'OSTG', 'SOL'].includes(inner.ccy) ? inner.ccy : 'OST', amount, sig: String(inner.sig), note: String(inner.note || '').slice(0, 140) }; }
      case 'call': { const cst = ['missed', 'declined', 'ended', 'busy'].includes(inner.status) ? inner.status : 'ended'; return { ...base, kind: 'call', status: cst, cst, video: !!inner.video, dur: num(inner.dur, 0, 86400) || 0 }; }
      case 'text': case undefined: case null: case '': return { ...base, kind: 'text', text: String(inner.text || '').slice(0, 8000) };
      default: return { ...base, kind: 'unsupported', k: String(inner.k).slice(0, 24) };   // a newer OST sent something this build cannot show
    }
  }
  // Call outcome lives in `cst`; `status` on own messages is the delivery state.
  const callSt = (m) => m.cst || (['missed', 'declined', 'ended', 'busy'].includes(m.status) ? m.status : 'ended');
  function previewOf(m) {
    if (m.kind === 'file') return '📎 ' + m.name;
    if (m.kind === 'loc') return m.live ? '📡 Live location' : '📍 Location';
    if (m.kind === 'pay') return '💸 ' + m.amount + ' ' + m.ccy;
    if (m.kind === 'call') { const s = callSt(m); return (m.video ? '🎥 ' : '📞 ') + (s === 'missed' ? (m.dir === 'me' ? 'No answer' : 'Missed call') : s === 'declined' ? 'Declined call' : s === 'busy' ? 'Busy' : 'Call'); }
    if (m.kind === 'unsupported') return 'Unsupported message';
    return m.text || '';
  }

  /* ---------- outbox ----------
   * Every outgoing message keeps its payload (`out`) and stays listed in
   * K.outbox until the hub accepts it. Failed / interrupted sends are retried
   * on socket open, 'online', tab focus and boot with backoff; a tap retries now.
   * File bytes are kept in memory and in IndexedDB until the upload succeeds. */
  const OUTBOX_KEY = 'ost.mesh.app.outbox.v1';
  const INFLIGHT = new Set(), OUTFILES = {};
  const outboxList = () => lsGet(OUTBOX_KEY, []);
  function outboxAdd(a, id) { const l = outboxList(); if (!l.some((x) => x.id === id)) { l.push({ a, id }); lsSet(OUTBOX_KEY, l.slice(-300)); } }
  function outboxDel(id) { const l = outboxList(); const n = l.filter((x) => x.id !== id); if (n.length !== l.length) lsSet(OUTBOX_KEY, n); }
  let idbP = null;
  function idb() {
    if (idbP) return idbP;
    idbP = new Promise((res) => { try { const rq = indexedDB.open('ost-mesh-outbox', 1); rq.onupgradeneeded = () => { try { rq.result.createObjectStore('files'); } catch (_) {} }; rq.onsuccess = () => res(rq.result); rq.onerror = () => res(null); } catch (_) { res(null); } });
    return idbP;
  }
  async function idbDo(mode, fn) { const db = await idb(); if (!db) return null; return new Promise((res) => { try { const tx = db.transaction('files', mode); const rq = fn(tx.objectStore('files')); tx.oncomplete = () => res(rq && rq.result); tx.onerror = tx.onabort = () => res(null); } catch (_) { res(null); } }); }
  function outFilePut(id, file) { OUTFILES[id] = file; idbDo('readwrite', (st) => st.put({ blob: file, name: file.name, type: file.type }, id)).catch(() => {}); }
  async function outFileGet(id) { if (OUTFILES[id]) return OUTFILES[id]; const r = await idbDo('readonly', (st) => st.get(id)).catch(() => null); if (r && r.blob) { const f = new File([r.blob], r.name || 'file', { type: r.type || r.blob.type || '' }); OUTFILES[id] = f; return f; } return null; }
  function outFileDel(id) { delete OUTFILES[id]; idbDo('readwrite', (st) => st.delete(id)).catch(() => {}); }
  const findMsg = (a, id) => msgsOf(a).find((x) => x.id === id);
  const retryIn = (tries) => Math.min(300000, 4000 * Math.pow(2, Math.min(6, tries - 1))) * (0.8 + Math.random() * 0.4);
  // Create the local bubble + outbox entry, then try to deliver it now.
  function queueOut(to, rec, out, file) {
    const m = Object.assign({}, rec, { dir: 'me', status: 'sending', out, tries: 0 });
    if (m.kind === 'call') m.cst = rec.cst || rec.status || 'ended';
    appendMsg(to, m); outboxAdd(to, m.id);
    if (file) outFilePut(m.id, file);
    upsertContact(to, { last: { text: previewOf(m), ts: m.ts, id: m.id } });
    if (S.view === 'chat' && S.peer === to) paintMsgs(true);   // own send always jumps to the newest
    return deliver(to, m.id);
  }
  async function deliver(to, id) {
    if (INFLIGHT.has(id)) return null;
    const m0 = findMsg(to, id);
    if (!m0 || !m0.out || m0.dir !== 'me') { outboxDel(id); return null; }
    INFLIGHT.add(id);
    if (m0.status !== 'sending') setStatus(to, id, 'sending');
    try {
      const key = await keyFor(to);
      const inner = Object.assign({}, m0.out);
      // Live location sent late (outbox): carry the session's CURRENT state — the
      // newest fix, and 'ended' once sharing stopped or ran out — never a stale "live".
      if (m0.kind === 'loc' && m0.lid) {
        if (num(m0.lat, -90, 90) != null && num(m0.lng, -180, 180) != null) Object.assign(inner, { lat: m0.lat, lng: m0.lng, acc: m0.acc || 0 });
        if (m0.ended || (Number(m0.until) > 0 && Number(m0.until) <= Date.now())) inner.ended = true;
      }
      if (m0.kind === 'file') {
        let blobId = m0.blob, file = null;
        if (!blobId) {
          file = await outFileGet(id);
          if (!file) { const e = new Error('The file is no longer on this device — send it again.'); e.code = 'file_gone'; throw e; }
          const sealedBytes = await sealBytes(key, new Uint8Array(await file.arrayBuffer()));
          const up = await signed('POST', '/mesh/v1/blob?to=' + encodeURIComponent(to) + '&mime=' + encodeURIComponent(m0.mime || 'application/octet-stream') + '&name=' + encodeURIComponent(String(m0.name || 'file').slice(0, 120)), sealedBytes);
          blobId = up.id; updateMsg(to, id, { blob: blobId });
        } else file = OUTFILES[id] || null;
        inner.blob = blobId; inner.thumb = file ? await thumbOf(file) : '';
      }
      const sealed = await sealPayload(key, { ...inner, id, ts: m0.ts, profile: { name: S.profile.name || '', emoji: S.profile.emoji || '' } });
      const r = await signed('POST', '/mesh/v1/msg/send', { from: S.address, to, payload: { t: 'dm', sealed } });
      updateMsg(to, id, { status: r && r.delivered ? 'delivered' : 'sent', out: null, tries: 0, nextAt: 0, hold: 0, err: '', perm: false });
      outboxDel(id); outFileDel(id); markLast(to, id, false);
      return r;
    } catch (e) {
      const tries = (m0.tries || 0) + 1;
      // Auto-retry only what can heal by itself (network, hub busy, 5xx, a full
      // mailbox) and only for a week; a tap always retries. When the hub says when
      // that ONE action has room again (retryAfter on a scoped refusal), nothing —
      // not even "the network is back" — resends it earlier.
      const perm = !(e && e.transient) || Date.now() - (Number(m0.ts) || 0) > 7 * 86400000;
      const hold = e && e.scoped && e.retryAfter > 0 ? Date.now() + e.retryAfter * 1000 : 0;
      updateMsg(to, id, { status: 'failed', tries, nextAt: Math.max(Date.now() + retryIn(tries), hold), hold, perm, err: (e && e.message) || 'Send failed' });
      markLast(to, id, true);
      throw e;
    } finally {
      INFLIGHT.delete(id);
      if (S.view === 'chat' && S.peer === to) paintMsgs();
    }
  }
  // force = "the network just came back" (socket open, 'online', tab focus, boot): ignore the backoff timer.
  let flushing = false;
  async function flushOutbox(force) {
    if (flushing || !S.identity || hubBusy() || navigator.onLine === false) return;
    flushing = true;
    try {
      for (const { a, id } of outboxList()) {
        if (hubBusy() || navigator.onLine === false) break;
        if (INFLIGHT.has(id)) continue;
        if (isBlocked(a)) continue;
        const m = findMsg(a, id);
        if (!m || !m.out) { outboxDel(id); continue; }
        if (m.perm || (m.hold && m.hold > Date.now()) || (!force && m.nextAt && m.nextAt > Date.now())) continue;
        await deliver(a, id).catch(() => {});
      }
    } finally { flushing = false; }
  }
  // Manual retry (tap on a failed bubble) — any kind.
  function retryMsg(to, id) {
    const m = findMsg(to, id); if (!m || m.dir !== 'me') return;
    if (!m.out) {
      if (m.kind === 'text') m.out = { k: 'text', text: m.text };                       // bubbles from before the outbox existed
      else if (m.kind === 'file' && m.blob) m.out = { k: 'file', name: m.name, mime: m.mime, size: m.size };
      else { toast('This message can no longer be resent — send it again.', 'err'); return; }
      updateMsg(to, id, { out: m.out });
    }
    outboxAdd(to, id); updateMsg(to, id, { perm: false, nextAt: 0, hold: 0 });
    deliver(to, id).catch((e) => toast(sendErrText(e), 'err'));
  }
  // The Chats row shows when the newest message of a chat did not go out.
  function markLast(a, id, fail) { const c = contact(a); if (c && c.last && c.last.id === id && !!c.last.fail !== fail) upsertContact(a, { last: Object.assign({}, c.last, { fail }) }); if (S.view === 'chats') paintChats(); }
  const sendErrText = (e) => (e && e.scoped && e.message) ? e.message : (e && e.transient && navigator.onLine === false) ? 'You are offline — it will send when you are back.' : (e && e.transient) ? 'Not delivered yet — retrying automatically.' : ((e && e.message) || 'Send failed');
  // Generic sealed send for plugin / rich message kinds (pay, call log, location).
  // With localMsg the message goes through the outbox; without it, it is fire-and-forget.
  async function sendInner(to, inner, localMsg) {
    const id = inner.id || uid(), ts = inner.ts || Date.now();
    if (localMsg) return queueOut(to, Object.assign({}, localMsg, { id, ts }), Object.assign({}, inner, { id: undefined, ts: undefined }));
    const key = await keyFor(to);
    const sealed = await sealPayload(key, { ...inner, id, ts, profile: { name: S.profile.name || '', emoji: S.profile.emoji || '' } });
    return signed('POST', '/mesh/v1/msg/send', { from: S.address, to, payload: { t: 'dm', sealed } });
  }
  // Signaling for calls: socket when connected, HTTP relay otherwise.
  async function signal(to, payload) {
    if (wsSend({ t: 'signal', to, payload })) return true;
    try { const r = await fetch(API + '/mesh/v1/signal/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ from: S.address, to, payload }) }); return r.ok; } catch (_) { return false; }
  }

  /* ---------- location: one-shot + live ---------- */
  const LIVE = {};   // peer -> { lid, until, watch, last, sentAt, timer }
  function geo(opts) { return new Promise((res, rej) => { if (!navigator.geolocation) return rej(new Error('This browser has no location access.')); navigator.geolocation.getCurrentPosition(res, (e) => rej(new Error(e && e.code === 1 ? 'Location permission denied — allow it in your browser settings.' : 'Could not get your location.')), Object.assign({ enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 }, opts || {})); }); }
  async function shareLocation(peer) {
    try {
      toast('Getting your location…');
      const p = await geo();
      const c = p.coords;
      await sendInner(peer, { k: 'loc', lat: +c.latitude.toFixed(6), lng: +c.longitude.toFixed(6), acc: Math.round(c.accuracy || 0) }, { kind: 'loc', lat: c.latitude, lng: c.longitude, acc: Math.round(c.accuracy || 0) });
    } catch (e) { toast(sendErrText(e) || 'Location failed', 'err'); }
  }
  function distM(a, b) { const R = 6371000, r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r; const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); }
  async function startLive(peer, minutes) {
    if (LIVE[peer]) stopLive(peer, true);
    if (!navigator.geolocation) { toast('This browser has no location access.', 'err'); return; }
    const lid = 'L' + uid(), until = Date.now() + minutes * 60000;
    const st = LIVE[peer] = { lid, until, watch: null, last: null, sentAt: 0 };
    const push = (pos, force) => {
      const c = pos.coords, cur = { lat: +c.latitude.toFixed(6), lng: +c.longitude.toFixed(6), acc: Math.round(c.accuracy || 0) };
      const now = Date.now();
      if (!force && st.last && (now - st.sentAt < 15000 || (distM(st.last, cur) < 20 && now - st.sentAt < 60000))) return;
      const first = !st.last; st.last = cur; st.sentAt = now;
      const inner = { k: 'loc', id: first ? lid : uid(), lid, live: true, until, ...cur };
      if (first) sendInner(peer, inner, { kind: 'loc', lid, live: true, until, ...cur, upd: now }).catch((e) => toast(sendErrText(e), 'err'));
      else { updateMsg(peer, lid, { lat: cur.lat, lng: cur.lng, acc: cur.acc, upd: now }); if (S.view === 'chat' && S.peer === peer) paintMsgs(); sendInner(peer, inner).catch(() => {}); }
    };
    st.watch = navigator.geolocation.watchPosition((p) => push(p, false), (e) => { toast(e && e.code === 1 ? 'Location permission denied.' : 'Live location paused — no GPS fix.', 'err'); if (e && e.code === 1) stopLive(peer); }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 });
    st.timer = setInterval(() => { if (Date.now() >= st.until) stopLive(peer); else if (S.view === 'chat' && S.peer === peer) paintLiveBar(); }, 30000);
    toast('Sharing live location for ' + (minutes >= 60 ? minutes / 60 + ' h' : minutes + ' min') + ' — keep OST open');
    if (S.view === 'chat' && S.peer === peer) paintLiveBar();
  }
  function stopLive(peer, silent) {
    const st = LIVE[peer]; if (!st) return;
    try { navigator.geolocation.clearWatch(st.watch); } catch (_) {}
    clearInterval(st.timer); delete LIVE[peer];
    updateMsg(peer, st.lid, { ended: true });
    if (st.last) sendInner(peer, { k: 'loc', id: uid(), lid: st.lid, live: true, ended: true, until: st.until, ...st.last }).catch(() => {});
    if (!silent) toast('Stopped sharing live location');
    if (S.view === 'chat' && S.peer === peer) { paintLiveBar(); paintMsgs(); }
  }
  function paintLiveBar() {
    const el = $('omxLive'); if (!el) return;
    const st = LIVE[S.peer];
    if (!st) { el.hidden = true; el.innerHTML = ''; return; }
    const left = Math.max(0, Math.round((st.until - Date.now()) / 60000));
    el.hidden = false; el.innerHTML = `<span>📡 Sharing live location · ${left >= 60 ? Math.floor(left / 60) + ' h ' + (left % 60) + ' min' : left + ' min'} left</span><button data-act="live-stop">Stop</button>`;
  }
  function lon2x(lng, z) { return (lng + 180) / 360 * Math.pow(2, z); }
  function lat2y(lat, z) { const r = lat * Math.PI / 180; return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * Math.pow(2, z); }
  function mapHtml(lat, lng) {
    const z = 15, x = lon2x(lng, z), y = lat2y(lat, z), tx = Math.floor(x), ty = Math.floor(y), px = (x - tx) * 256, py = (y - ty) * 256;
    const W = 260, Hh = 150, left = Math.round(W / 2 - 256 - px), top = Math.round(Hh / 2 - 256 - py);
    let tiles = '';
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) tiles += `<img alt="" loading="lazy" src="https://tile.openstreetmap.org/${z}/${tx + dx}/${ty + dy}.png" style="left:${(dx + 1) * 256}px;top:${(dy + 1) * 256}px">`;
    return `<div class="omx-map"><div class="omx-tiles" style="left:${left}px;top:${top}px">${tiles}</div><b class="omx-pin">📍</b><small>© OpenStreetMap</small></div>`;
  }
  async function verifyPay(a, m) {
    if (m.verified || !m.sig || !window.OST_WALLET || !OST_WALLET.rpcCall) return;
    m.verified = 'checking';
    try {
      const r = await OST_WALLET.rpcCall((c) => c.getSignatureStatuses([m.sig], { searchTransactionHistory: true }));
      const st = r && r.value && r.value[0];
      updateMsg(a, m.id, { verified: st ? (st.err ? 'failed' : 'confirmed') : 'pending' });
    } catch (_) { updateMsg(a, m.id, { verified: '' }); }
    if (S.view === 'chat' && S.peer === a) paintMsgs();
  }

  /* ---------- outgoing ---------- */
  async function sendText(to, text) {
    const id = uid(), ts = Date.now();
    try { await queueOut(to, { id, kind: 'text', text, ts }, { k: 'text', text }); }
    catch (e) { toast(sendErrText(e), 'err'); }
  }
  function setStatus(a, id, st) { const list = msgsOf(a); const m = list.find((x) => x.id === id); if (m) { m.status = st; saveMsgs(a, list); } if (S.view === 'chat' && S.peer === a) paintMsgs(); }
  async function shrinkImage(file) {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < 700 * 1024) return file;
    try {
      const bmp = await createImageBitmap(file); const sc = Math.min(1, IMG_MAX_EDGE / Math.max(bmp.width, bmp.height));
      if (sc === 1 && file.size <= BLOB_MAX) return file;
      const cv = document.createElement('canvas'); cv.width = Math.round(bmp.width * sc); cv.height = Math.round(bmp.height * sc);
      cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
      const blob = await new Promise((res) => cv.toBlob(res, 'image/jpeg', 0.84));
      return blob ? new File([blob], file.name.replace(/\.[a-z0-9]+$/i, '') + '.jpg', { type: 'image/jpeg' }) : file;
    } catch (_) { return file; }
  }
  async function thumbOf(file) {
    if (!/^image\//.test(file.type)) return '';
    try { const bmp = await createImageBitmap(file); const sc = Math.min(1, 96 / Math.max(bmp.width, bmp.height)); const cv = document.createElement('canvas'); cv.width = Math.max(1, Math.round(bmp.width * sc)); cv.height = Math.max(1, Math.round(bmp.height * sc)); cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height); const d = cv.toDataURL('image/jpeg', 0.6); return d.length < 12000 ? d : ''; } catch (_) { return ''; }
  }
  async function sendFile(to, file0) {
    if (!file0) return;
    const file = await shrinkImage(file0);
    if (file.size > BLOB_MAX) { toast('Files up to 6 MB only (images are shrunk automatically).', 'err'); return; }
    const id = uid(), ts = Date.now(), mime = file.type || 'application/octet-stream';
    S.blobs['local:' + id] = { url: URL.createObjectURL(file), mime };
    try { await queueOut(to, { id, kind: 'file', name: file.name, mime, size: file.size, ts }, { k: 'file', name: file.name, mime, size: file.size }, file); }
    catch (e) { toast(sendErrText(e), 'err'); }
  }
  async function fetchBlob(from, m) {
    const ck = m.blob; if (!ck) return null;
    if (S.blobs[ck]) return S.blobs[ck];
    if (S.blobs['local:' + m.id]) return S.blobs['local:' + m.id];
    if (S.blobs['pending:' + ck]) return S.blobs['pending:' + ck];
    S.blobs['pending:' + ck] = (async () => {
      const key = await keyFor(from === S.address ? S.peer : from);
      const r = await fetch(API + '/mesh/v1/blob/' + encodeURIComponent(ck), { cache: 'force-cache' });
      if (!r.ok) throw new Error('This file has expired on the relay (files are kept 7 days).');
      const bytes = await openBytes(key, new Uint8Array(await r.arrayBuffer()));
      const blob = new Blob([bytes], { type: m.mime || 'application/octet-stream' });
      const rec = { url: URL.createObjectURL(blob), mime: m.mime, size: blob.size };
      S.blobs[ck] = rec; delete S.blobs['pending:' + ck]; return rec;
    })();
    return S.blobs['pending:' + ck].catch((e) => { delete S.blobs['pending:' + ck]; throw e; });
  }

  /* ---------- contacts: add / accept ---------- */
  function inviteLink() {
    const payload = b64u(JSON.stringify({ v: 2, a: S.address, n: S.profile.name || '', e: S.profile.emoji || '', f: S.fp }));
    return location.origin + location.pathname.replace(/[^/]*$/, '') + '#mesh-add=' + payload;
  }
  function parseAddText(text) {
    const t = String(text || '').trim(); if (!t) return null;
    const hash = t.match(/#mesh-add=([A-Za-z0-9_-]+)/); if (hash) { try { const j = JSON.parse(unb64u(hash[1])); if (validAddr(j.a)) return { addr: j.a.toLowerCase(), name: String(j.n || '').slice(0, 32), emoji: String(j.e || '').slice(0, 8), fp: String(j.f || '') }; } catch (_) {} }
    const inv = t.match(/ost-mesh-invite:([A-Za-z0-9_-]+)/); if (inv) { try { const j = JSON.parse(unb64u(inv[1])); if (validAddr(j.address)) return { addr: j.address.toLowerCase(), bundle: j.bundle || null, fp: j.fingerprint || '', name: (j.profile && (j.profile.nickname || j.profile.name)) || '' }; } catch (_) {} }
    const a = t.match(/ost-mesh:[0-9a-f]{4}(?:-[0-9a-f]{4}){3}/i); if (a) return { addr: a[0].toLowerCase() };
    return null;
  }
  async function addPerson(info) {
    if (!info || !validAddr(info.addr)) { toast('That is not an OST Mesh link or address.', 'err'); return false; }
    if (info.addr === S.address) { toast('That is your own address.'); return false; }
    const existing = contact(info.addr);
    if (existing && existing.state === 'friend') { openChat(info.addr); return true; }
    try {
      const rec = await lookup(info.addr);
      if (!rec && !info.bundle) throw new Error('This person has not opened OST Mesh yet — ask them to open it once, then try again.');
      const bundle = (rec && rec.bundle) || info.bundle;
      const fp = (rec && rec.fingerprint) || info.fp || '';
      if (info.fp && fp && info.fp !== fp) throw new Error('Safety code mismatch — the link does not match the keys on the hub. Do not add this contact.');
      upsertContact(info.addr, { bundle, fp, name: clipName(info.name || (rec && rec.profile && rec.profile.name) || (existing && existing.name) || ''), emoji: clipEmoji(info.emoji || (rec && rec.profile && rec.profile.emoji) || ''), state: existing && existing.state === 'pending-in' ? 'pending-in' : 'pending-out', ts: Date.now() });
      if (existing && existing.state === 'pending-in') return acceptPerson(info.addr);
      const r = await signed('POST', '/mesh/v1/friend/request', { from: S.address, to: info.addr, profile: { name: S.profile.name || '', emoji: S.profile.emoji || '' } });
      if (r && r.state === 'accepted') upsertContact(info.addr, { state: 'friend' });
      // The hub just told us whether they are online — the chat header shows the same thing.
      if (r && typeof r.online === 'boolean') S.presence[info.addr] = Object.assign({}, S.presence[info.addr], { online: r.online });
      toast((r && r.state === 'accepted') ? 'Connected with ' + nameOf(info.addr) : 'Request sent to ' + nameOf(info.addr) + (r && r.online ? ' (online now)' : ' — they get it when they open OST'));
      openChat(info.addr);
      askPresence();
      return true;
    } catch (e) { toast(e && e.message || 'Could not add', 'err'); return false; }
  }
  // Accept a request row. "wants to connect" has a pending request on the hub;
  // "messaged you" may not (mail alone, or their request expired / they removed
  // you): the hub then turns the accept into a request of yours (state 'sent'),
  // or an older hub answers 409 no_pending_request — asked with friend/request then.
  // Either way YOU said yes: they become a contact here; the hub link completes
  // when they accept (or at once, if they had asked you).
  async function acceptPerson(addr) {
    const profile = { name: S.profile.name || '', emoji: S.profile.emoji || '' };
    try {
      let r;
      try { r = await signed('POST', '/mesh/v1/friend/respond', { wallet: S.address, other: addr, action: 'accept', profile }); }
      catch (e) { if (!e || e.code !== 'no_pending_request') throw e; r = await signed('POST', '/mesh/v1/friend/request', { from: S.address, to: addr, profile }); }
      const linked = !r || !r.state || r.state === 'accepted';
      upsertContact(addr, { state: 'friend', unread: 0 }); await keyFor(addr).catch(() => {});
      toast(linked ? 'Connected with ' + nameOf(addr) : 'Accepted — you can chat with ' + nameOf(addr) + ' now'); openChat(addr); askPresence(); return true;
    } catch (e) { toast(e && e.message || 'Could not accept', 'err'); return false; }
  }
  // The hub is told first; the local list changes only when that worked.
  async function declinePerson(addr, block) {
    try { await signed('POST', '/mesh/v1/friend/respond', { wallet: S.address, other: addr, action: block ? 'block' : 'decline' }); }
    catch (e) { toast((e && e.message) || 'Could not reach the hub — try again.', 'err'); return false; }
    if (block) upsertContact(addr, { state: 'blocked', unread: 0 }); else { delete S.contacts[addr]; saveContacts(); }
    render();
    return true;
  }
  let friendsP = null;
  function syncFriends(force) {
    if (friendsP) return friendsP;
    if (!S.identity || hubBusy() || (!force && Date.now() - S.friendsAt < 60000)) return Promise.resolve();
    S.friendsAt = Date.now();                                        // attempts count too: an unreachable hub is not asked on every open
    friendsP = (async () => {
      try {
        const j = await signed('GET', '/mesh/v1/friend/list?wallet=' + encodeURIComponent(S.address));
        S.friendsAt = Date.now();
        (j.friends || []).forEach((f) => { const c = contact(f.addr); if (!c || c.state !== 'blocked') upsertContact(f.addr, { state: 'friend' }); });
        (j.pendingIn || []).forEach((f) => { const c = contact(f.addr); if (!c || (c.state !== 'friend' && c.state !== 'blocked')) upsertContact(f.addr, { state: 'pending-in', ts: f.ts }); });
        (j.pendingOut || []).forEach((f) => { const c = contact(f.addr); if (!c || (c.state !== 'friend' && c.state !== 'blocked')) upsertContact(f.addr, { state: 'pending-out', ts: f.ts }); });
        (j.blocked || []).forEach((f) => upsertContact(f.addr, { state: 'blocked' }));
        // Names for contacts that only exist on the hub side (a few per run, spaced).
        let n = 0;
        for (const a of Object.keys(S.contacts)) {
          const c = S.contacts[a]; if (c.name && c.bundle) continue;
          if (++n > 8 || hubBusy()) break;
          const rec = await lookup(a).catch(() => null);
          if (rec) upsertContact(a, { bundle: rec.bundle, fp: rec.fingerprint || c.fp || '', name: c.name || clipName(rec.profile && rec.profile.name), emoji: c.emoji || clipEmoji(rec.profile && rec.profile.emoji) });
          await new Promise((res) => setTimeout(res, 400));
        }
        if (S.view === 'chats' || S.view === 'add') render(); else paintBadge();
      } catch (_) {}
    })().finally(() => { friendsP = null; });
    return friendsP;
  }

  /* ---------- QR (draw + scan) ---------- */
  function loadScript(src) { return new Promise((res) => { const s = document.createElement('script'); s.src = src; s.onload = () => res(true); s.onerror = () => res(false); document.head.appendChild(s); }); }
  async function drawQr(canvas, text) {
    if (typeof window.qrcode !== 'function') await loadScript('vendor/qrcode-generator.js');
    if (typeof window.qrcode !== 'function') return false;
    try {
      const qr = window.qrcode(0, 'M'); qr.addData(text); qr.make();
      const n = qr.getModuleCount(), px = Math.max(2, Math.floor(260 / n)), pad = 14, dim = n * px + pad * 2;
      canvas.width = dim; canvas.height = dim; const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, dim, dim); ctx.fillStyle = '#0b1020';
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) ctx.fillRect(pad + c * px, pad + r * px, px, px);
      return true;
    } catch (_) { return false; }
  }
  async function startScan(video, onResult, onStatus) {
    stopScan();
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { onStatus('This browser has no camera access. Use your phone\'s camera app on the QR instead — it opens the link.'); return; }
    let stream; try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false }); } catch (e) { onStatus('Camera blocked (' + (e && e.name || 'error') + '). Allow camera access, or paste the link below.'); return; }
    S.scanStream = stream; video.srcObject = stream; video.setAttribute('playsinline', ''); video.muted = true; try { await video.play(); } catch (_) {}
    let detector = null; try { if ('BarcodeDetector' in window) detector = new window.BarcodeDetector({ formats: ['qr_code'] }); } catch (_) { detector = null; }
    if (!detector && typeof window.jsQR !== 'function') { await loadScript('vendor/jsqr.min.js'); }
    if (!detector && typeof window.jsQR !== 'function') { onStatus('QR decoder unavailable — paste the link below.'); return; }
    onStatus('Point at your friend\'s QR…');
    const cv = document.createElement('canvas'); const ctx = cv.getContext('2d', { willReadFrequently: true });
    const tick = async () => {
      if (!S.scanStream) return;
      try {
        if (video.readyState >= 2 && video.videoWidth) {
          let text = '';
          if (detector) { const codes = await detector.detect(video); if (codes && codes[0]) text = codes[0].rawValue || ''; }
          else { const w = Math.min(640, video.videoWidth), h = Math.round(video.videoHeight * (w / video.videoWidth)); cv.width = w; cv.height = h; ctx.drawImage(video, 0, 0, w, h); const code = window.jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'dontInvert' }); if (code && code.data) text = code.data; }
          if (text) { const info = parseAddText(text); if (info) { stopScan(); onResult(info); return; } onStatus('That QR is not an OST Mesh invite.'); }
        }
      } catch (_) {}
      S.scanTimer = setTimeout(tick, 140);
    };
    tick();
  }
  function stopScan() { if (S.scanTimer) clearTimeout(S.scanTimer); S.scanTimer = null; if (S.scanStream) { try { S.scanStream.getTracks().forEach((t) => t.stop()); } catch (_) {} } S.scanStream = null; }

  /* ---------- history: core.back (contract C3) ----------
   * push(fn, kind) adds one browser-history entry (history.pushState) and returns
   * a token; a browser/system Back runs the newest fn. pop(token) removes that
   * entry (and any above it) and silently unwinds history when nothing else has
   * navigated since. Entries carry { omx: token, omxStack } so Back can tell
   * which of ours it left, and a reload can re-adopt them. */
  // pend: pops of this tick, unwound together (two pops = one history.go(-2));
  // ahead: tokens whose entries now sit FORWARD of the current one (left by Back or
  // by an unwind) — browser Forward onto one of them opens that view again.
  const BK = { stack: [], seq: 0, unwinding: false, settleT: 0, pend: null, ahead: new Set() };
  const bkNext = () => (BK.seq = Math.max(Date.now(), BK.seq + 1));
  function bkStateFor(e) { const upto = BK.stack.slice(0, BK.stack.indexOf(e) + 1).filter((x) => x.written || x === e); return { omx: e.token, omxStack: upto.map((x) => x.meta ? [x.token, x.kind, x.meta] : [x.token, x.kind]) }; }
  function bkAhead(toks) { toks.forEach((t) => BK.ahead.add(t)); if (BK.ahead.size > 40) BK.ahead = new Set([...BK.ahead].slice(-20)); }
  function bkWrite(e, replace) {
    e.written = true;
    const st = bkStateFor(e);
    try { if (replace) history.replaceState(Object.assign({}, history.state && typeof history.state === 'object' ? history.state : {}, st), '', location.href); else history.pushState(st, '', location.href); } catch (_) {}
  }
  function bkSettle() { if (!BK.unwinding) return; BK.unwinding = false; clearTimeout(BK.settleT); BK.stack.forEach((e) => { if (!e.written) bkWrite(e); }); }
  function bkUnwind(top, n, toks) {
    const st = history.state;
    if (BK.unwinding || !st || Number(st.omx) !== top) return;     // something else navigated since: leave history alone
    BK.unwinding = true; clearTimeout(BK.settleT); BK.settleT = setTimeout(bkSettle, 900);
    bkAhead(toks || []);
    try { history.go(-n); } catch (_) { bkSettle(); }
  }
  function bkFlush() { const p = BK.pend; if (!p) return; BK.pend = null; clearTimeout(p.t); bkUnwind(p.top, p.n, p.toks); }
  const back = {
    // opts.adoptToken: an entry that already exists (re-adopted after a reload);
    // opts.adopt: take over the CURRENT entry (it was created by a hash link);
    // opts.meta: a short string kept in the entry (the chat's peer, for Forward).
    push(fn, kind, opts) {
      opts = opts || {};
      bkFlush();                                                     // close() + open() in one tick: unwind first, then write
      const token = opts.adoptToken ? Number(opts.adoptToken) : bkNext();
      if (opts.adoptToken) BK.seq = Math.max(BK.seq, token);
      const e = { token, fn, kind: kind || 'x', written: !!opts.adoptToken, meta: typeof opts.meta === 'string' ? opts.meta.slice(0, 80) : '' };
      BK.stack.push(e); BK.ahead.delete(token);
      if (opts.adopt) bkWrite(e, true);
      else if (!e.written && !BK.unwinding) bkWrite(e);
      return token;
    },
    pop(token) {
      const i = BK.stack.findIndex((e) => e.token === token); if (i < 0) return false;
      const gone = BK.stack.splice(i).filter((e) => e.written);
      if (gone.length) {
        if (BK.pend) { BK.pend.n += gone.length; BK.pend.toks.push(...gone.map((e) => e.token)); }   // the entries below the pending ones
        else BK.pend = { top: gone[gone.length - 1].token, n: gone.length, toks: gone.map((e) => e.token), t: setTimeout(bkFlush, 0) };
      }
      return true;
    },
    size: () => BK.stack.length
  };
  window.addEventListener('popstate', (ev) => {
    if (BK.unwinding) { bkSettle(); return; }                      // our own silent unwind landed
    // An in-page link to a social route while the app is open fires this (state null) before
    // hashchange; it is a forward fragment navigation that social turns into a Back step.
    if (!ev.state && appIsOpen() && /^#(social|feed|post=|u=)/i.test(location.hash || '')) return;
    const st = ev.state, landed = st && st.omx ? Number(st.omx) : 0;
    const run = [];
    while (BK.stack.length && BK.stack[BK.stack.length - 1].token > landed) run.push(BK.stack.pop());
    bkAhead(run.map((e) => e.token));
    run.forEach((e) => { try { e.fn(); } catch (err) { console.warn('[mesh-app] back handler failed', err); } });
    // Forward onto an entry the app had left (Back / ✕): open that view again
    // instead of leaving a dead entry that the next Back has to step over.
    if (!run.length && landed && BK.ahead.has(landed) && !BK.stack.some((e) => e.token === landed) && Array.isArray(st.omxStack)) bkReenter(st.omxStack, landed);
  });
  function bkReenter(list, landed) {
    const ent = (k) => list.find((x) => Array.isArray(x) && x[1] === k);
    const app = ent('app'), chat = ent('chat');
    if (!app) return;
    BK.ahead.delete(landed);
    const chatOk = chat && Number(chat[0]) === landed && validAddr(String(chat[2] || '')) && contact(chat[2]);
    whenReady(() => {
      if (!appIsOpen()) { if (chatOk) openChat(chat[2], { app: { adoptToken: Number(app[0]) }, chatToken: landed }); else open(undefined, { adoptToken: Number(app[0]) }); }
      else if (chatOk && !S.backChat) openChat(chat[2], { chatToken: landed });
    });
  }

  /* ---------- action sheet + confirm (contract C6), rendered in #omxSheet ---------- */
  let sheetEl = null, sheetDone = null, sheetOpener = null;
  function sheetMount() {
    if (sheetEl && sheetEl.isConnected) return sheetEl;
    sheetEl = document.createElement('div'); sheetEl.id = 'omxSheet';
    sheetEl.setAttribute('role', 'dialog'); sheetEl.setAttribute('aria-modal', 'true'); sheetEl.setAttribute('aria-labelledby', 'omxSheetT'); sheetEl.tabIndex = -1;
    sheetEl.innerHTML = '<div class="omxs-box"><div class="omxs-grab" aria-hidden="true"></div><h3 id="omxSheetT"></h3><p id="omxSheetB"></p><div class="omxs-items" id="omxSheetI"></div><button type="button" class="omxs-cancel" data-v="-1">Cancel</button></div>';
    document.body.appendChild(sheetEl);
    sheetEl.addEventListener('click', (e) => { if (e.target === sheetEl) { closeSheet(-1); return; } const b = e.target.closest('[data-v]'); if (b) closeSheet(Number(b.getAttribute('data-v'))); });
    sheetEl.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeSheet(-1); return; }
      if (e.key === 'Tab') {                                         // keep focus inside the sheet
        const f = Array.from(sheetEl.querySelectorAll('button')); if (!f.length) return;
        const i = f.indexOf(document.activeElement);
        if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
      }
    });
    return sheetEl;
  }
  function showSheet(title, text, items, cancelLabel) {
    closeSheet(-1);                                                  // one sheet at a time
    const el = sheetMount();
    return new Promise((resolve) => {
      const ae = document.activeElement; sheetOpener = ae && ae !== document.body && !el.contains(ae) ? ae : null;
      const t = $('omxSheetT'), b = $('omxSheetB');
      t.textContent = title || ''; t.hidden = !title;
      b.textContent = text || ''; b.hidden = !text;
      $('omxSheetI').innerHTML = items.map((it, i) => `<button type="button" class="omxs-item${it.danger ? ' danger' : ''}${it.primary ? ' primary' : ''}" data-v="${i}"><span>${esc(it.label)}</span>${it.sub ? `<small>${esc(it.sub)}</small>` : ''}</button>`).join('');
      el.querySelector('.omxs-cancel').textContent = cancelLabel || 'Cancel';
      sheetDone = (i) => resolve(i >= 0 && items[i] ? items[i] : null);
      el.classList.add('on'); document.documentElement.classList.add('omx-sheeton');   // phones: toasts move off the sheet's rows
      setTimeout(() => { try { (el.querySelector('.omxs-item') || el).focus({ preventScroll: true }); } catch (_) {} }, 40);
    });
  }
  function closeSheet(i) {
    if (!sheetEl || !sheetEl.classList.contains('on')) return;
    sheetEl.classList.remove('on'); document.documentElement.classList.remove('omx-sheeton');
    const done = sheetDone; sheetDone = null;
    if (sheetOpener && sheetOpener.isConnected) { try { sheetOpener.focus({ preventScroll: true }); } catch (_) {} }
    sheetOpener = null;
    if (done) done(i);
  }
  // actionSheet({title, items:[{label, sub?, danger?, value}]}) -> Promise<value|null>
  function actionSheet(o) { o = o || {}; const items = (o.items || []).filter(Boolean); return showSheet(o.title, o.body, items, o.cancel).then((it) => (it ? (it.value !== undefined ? it.value : it.label) : null)); }
  // confirm({title, body, ok, danger}) -> Promise<boolean>
  function confirmSheet(o) { o = o || {}; return showSheet(o.title, o.body, [{ label: o.ok || 'OK', danger: !!o.danger, primary: !o.danger }], o.cancel).then((it) => !!it); }

  /* ---------- UI ---------- */
  let root, body, headEl, tabsEl;
  const CORE_VIEWS = ['chats', 'add', 'me', 'settings', 'chat'];
  const SESSION_KEY = 'omx.session.v1', DRAFT_KEY = 'omx.drafts.v1';
  function homeView() { const k = Object.keys(X.views).find((v) => X.views[v].tab && X.views[v].tab.home); return k || 'chats'; }
  function saveSession() { ssSet(SESSION_KEY, { open: appIsOpen(), view: S.view, peer: S.view === 'chat' ? S.peer : null, path: location.pathname, at: Date.now() }); }
  function mount() {
    if ($('ostMeshApp')) return;
    root = document.createElement('div'); root.id = 'ostMeshApp';
    root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-labelledby', 'omxTitle'); root.setAttribute('aria-label', 'OST Mesh'); root.tabIndex = -1;
    root.innerHTML = '<div class="omx-shell"><div class="omx-head" id="omxHead"></div><div class="omx-body" id="omxBody"></div><div class="omx-tabs" id="omxTabs" role="navigation" aria-label="OST Mesh sections"></div></div>';
    document.body.appendChild(root);
    body = $('omxBody'); headEl = $('omxHead'); tabsEl = $('omxTabs');
    root.addEventListener('click', (e) => { if (e.target === root) close(); });
    root.addEventListener('click', onClick);
    root.addEventListener('change', onChange);
    // Failed bubbles are role=button: Enter / Space retry like a tap.
    root.addEventListener('keydown', (e) => { const t = e.target; if ((e.key === 'Enter' || e.key === ' ') && t && t.classList && t.classList.contains('omx-b') && t.hasAttribute('data-act')) { e.preventDefault(); t.click(); } });
  }
  // The app family (contract C1) and the site's own dialogs (which sit above the app and own their keys).
  const FAMILY = '#ostMeshApp, #oslSheet, #oslLight, #oslStory, #omxSheet, #omxCall, .omx-toasts';
  const SITE_DIALOG = '[aria-modal="true"], [role="dialog"], [role="alertdialog"], dialog[open]';
  const overlayUp = () => !!document.querySelector('#oslSheet.on, #oslLight.on, #oslStory.on, #omxSheet.on, #omxCall');
  const inSiteDialog = (t) => !!(t && t.nodeType === 1 && t.closest && !t.closest(FAMILY) && t.closest(SITE_DIALOG));
  // Escape (contract C3): document level, capture phase, so it works wherever focus
  // is; overlays of the app family (sheets, lightbox, story, call) handle their own.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.defaultPrevented || e.isComposing) return;
    // #omxSheet handles its own Escape; this covers focus having left the sheet (it is the top overlay only
    // while no social overlay / call screen sits above it).
    if (sheetEl && sheetEl.classList.contains('on') && !sheetEl.contains(e.target) && !document.querySelector('#oslSheet.on, #oslLight.on, #oslStory.on, #omxCall')) { e.preventDefault(); closeSheet(-1); return; }
    if (!appIsOpen() || overlayUp()) return;
    if (inSiteDialog(e.target)) return;                              // a site dialog opened above the app
    e.preventDefault();
    const sxBack = S.view !== 'chat' && headEl && headEl.querySelector('[data-act="sx-back"]');
    if (S.view === 'chat') leaveChat(); else if (sxBack) sxBack.click(); else close();
  }, true);
  // Focus containment for the modal app (aria-modal): Tab / Shift+Tab wrap inside
  // it (tappable toasts included), and focus that reaches the page behind (a click
  // on the backdrop, a site script) is brought back. Overlays above handle their own.
  function tabbables() {
    const list = Array.from(root.querySelectorAll('a[href], button, input, textarea, select, video[controls], audio[controls], [tabindex]'))
      .concat(Array.from(document.querySelectorAll('.omx-toasts .omx-toast.tap:not(.out)')));
    return list.filter((el) => el.tabIndex >= 0 && !el.disabled && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden');
  }
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab' || e.defaultPrevented || !appIsOpen() || overlayUp() || inSiteDialog(e.target)) return;
    const f = tabbables(); if (!f.length) { e.preventDefault(); try { root.focus({ preventScroll: true }); } catch (_) {} return; }
    const i = f.indexOf(document.activeElement);
    let to = null;
    if (i < 0) to = e.shiftKey ? f[f.length - 1] : f[0];          // on the dialog root, or outside the app
    else if (e.shiftKey && i === 0) to = f[f.length - 1];
    else if (!e.shiftKey && i === f.length - 1) to = f[0];
    if (to) { e.preventDefault(); try { to.focus(); } catch (_) {} }
  }, true);
  let refocusT = 0;
  document.addEventListener('focusin', (e) => {
    if (!appIsOpen()) return;
    const t = e.target;
    if (!t || t.nodeType !== 1 || (t.closest && t.closest(FAMILY)) || inSiteDialog(t)) return;
    // Deferred: a copy-to-clipboard helper focuses a hidden textarea for one tick.
    clearTimeout(refocusT);
    refocusT = setTimeout(() => {
      const a = document.activeElement;
      if (!appIsOpen() || overlayUp() || a !== t || !t.isConnected || inSiteDialog(t)) return;
      try { root.focus({ preventScroll: true }); } catch (_) {}
    }, 0);
  });
  const appBackFn = () => { S.backApp = 0; close(true); };
  const chatBackFn = () => { S.backChat = 0; if (S.view === 'chat') leaveChat(true); };
  // open() with no view always lands on the home tab (Feed when OST Social is loaded).
  function open(view, opts) {
    opts = opts || {};
    mount();
    const wasOpen = appIsOpen();
    if (!wasOpen) { const ae = document.activeElement; S.opener = ae && ae !== document.body && !root.contains(ae) ? ae : null; }
    S.opened = true;
    // No view asked for = the home tab. Remembered as a default, so a plugin that
    // registers the real home tab a moment later (Feed, at a cold #mesh) takes over.
    S.view = view || homeView(); S.viewIsDefault = !view;
    if (S.view !== 'chat') S.peer = null;
    root.classList.add('open'); document.documentElement.classList.add('omx-lock');
    if (!wasOpen && !S.backApp) S.backApp = back.push(appBackFn, 'app', opts);
    render();
    if (!wasOpen) {
      setTimeout(() => { try { if (appIsOpen() && !root.contains(document.activeElement)) root.focus({ preventScroll: true }); } catch (_) {} }, 30);
      syncFriends();
    }
    connectWs(); askPresence(); flushOutbox();
  }
  // close() always resets to the home tab; focus returns to whatever opened the app.
  function close(fromBack) {
    const wasOpen = appIsOpen();
    stopScan(); closeSheet(-1);
    if (root) root.classList.remove('open');
    document.documentElement.classList.remove('omx-lock');
    const t = S.backApp; S.backApp = 0; S.backChat = 0;
    if (t && !fromBack) back.pop(t);                                 // also drops the chat entry above it
    S.view = homeView(); S.viewIsDefault = true; S.peer = null; S.newBelow = 0;
    if (msgRO) { msgRO.disconnect(); msgRO = null; }
    saveSession(); placeToasts();
    if (wasOpen && S.opener && S.opener.isConnected) { try { S.opener.focus({ preventScroll: true }); } catch (_) {} }
    S.opener = null;
  }
  function leaveChat(fromBack) {
    const t = S.backChat; S.backChat = 0;
    if (t && !fromBack) back.pop(t);
    closeSheet(-1);                                                  // a chat ⋯ sheet must not outlive its chat
    S.view = S.backTo && S.backTo !== 'chat' ? S.backTo : 'chats'; S.backTo = null; S.peer = null; S.newBelow = 0; S.viewIsDefault = false;
    if (body) body.style.padding = '';
    if (msgRO) { msgRO.disconnect(); msgRO = null; }
    render();
  }
  function tabsHtml() {
    const u = totalUnread(), req = Object.values(S.contacts).filter((c) => c.state === 'pending-in' || c.state === 'request').length;
    const tabs = [
      { v: 'chats', ico: '💬', lbl: 'Chats', order: 20, badge: u },
      { v: 'add', ico: '➕', lbl: 'Add', order: 30, badge: req },
      { v: 'me', ico: '🙂', lbl: 'Me', order: 40, badge: 0 }
    ];
    Object.keys(X.views).forEach((k) => { const t = X.views[k].tab; if (!t) return; const i = tabs.findIndex((x) => x.v === k); const row = { v: k, ico: t.ico, lbl: t.lbl, order: t.order, badge: X.badges[k] ? X.badges[k]() : 0 }; if (i >= 0) tabs[i] = row; else tabs.push(row); });
    tabs.sort((a, b) => a.order - b.order);
    const active = (v) => S.view === v || (v === 'chats' && S.view === 'chat') || (X.views[S.view] && X.views[S.view].parent === v) || (v === 'me' && S.view === 'settings');
    return tabs.map((t) => `<button type="button" data-tab="${t.v}" class="${active(t.v) ? 'on' : ''}"${active(t.v) ? ' aria-current="page"' : ''}><b aria-hidden="true">${t.ico}</b><span>${esc(t.lbl)}</span>${t.badge ? `<span class="omx-badge" aria-label="${t.badge} new">${t.badge > 99 ? '99+' : t.badge}</span>` : ''}</button>`).join('');
  }
  // What the connection really is (dot + one line). "Offline — will send…" only
  // when the browser says so; "Connected (polling)" when the mailbox poll works
  // without a socket; never "Connecting…" past the first seconds.
  function netState() {
    if (navigator.onLine === false) return { cls: 'off', txt: 'Offline — will send when you are back' };
    if (hubBusy()) return { cls: 'warn', txt: 'Hub busy — retrying in ' + busySecs() + ' s' };
    if (S.wsOk) return { cls: 'on', txt: 'Connected · end-to-end encrypted' };
    // Polling counts only while it is the newest news: a failed hub call since the last good poll means trouble.
    if (S.pollOkAt && S.pollOkAt > (S.netErrAt || 0) && Date.now() - S.pollOkAt < 60000) return { cls: 'on', txt: 'Connected (polling) · end-to-end encrypted' };
    if (S.announceErr && !/^(offline|rate_limited)$/.test(S.announceErr) && !/^http_5/.test(S.announceErr)) return { cls: 'off', txt: explain(S.announceErr) };
    if (Date.now() - S.bootAt < 12000 && !S.netErrAt) return { cls: '', txt: 'Connecting…' };
    return { cls: 'off', txt: 'Can\'t reach the hub — retrying' };
  }
  function statusHtml() { const n = netState(); return `<div class="omx-status ${n.cls}" id="omxStatus" role="status"><i aria-hidden="true"></i><span>${esc(n.txt)}</span></div>`; }
  function paintStatus() { const el = $('omxStatus'); if (el) { const n = netState(); if (el.className !== 'omx-status ' + n.cls) el.className = 'omx-status ' + n.cls; const sp = el.querySelector('span'); if (sp && sp.textContent !== n.txt) sp.textContent = n.txt; } }
  function paintBadge() { if (tabsEl && S.view !== 'chat' && !tabsEl.hidden) tabsEl.innerHTML = tabsHtml(); syncUnread(); }
  // Every header gets an h2#omxTitle (the dialog's accessible name).
  function labelHead() { try { const h = headEl && headEl.querySelector('h2'); if (h && !h.id) h.id = 'omxTitle'; } catch (_) {} }
  const coreSub = { chats: 'Chats', add: 'Add', me: 'Me', settings: 'Settings' };
  function render() {
    if (!root) return;
    if (S.view !== 'add') stopScan();
    if (S.view === 'chat' && !S.peer) S.view = 'chats';
    if (S.view !== 'chat' && S.backChat) { const t = S.backChat; S.backChat = 0; back.pop(t); }   // left the chat some other way
    if (!X.views[S.view] && !CORE_VIEWS.includes(S.view)) { const h = homeView(); S.view = X.views[h] || h === 'chats' ? h : 'chats'; }
    saveSession();
    if (S.view === 'chat') { renderChat(); labelHead(); return; }
    if (msgRO) { msgRO.disconnect(); msgRO = null; }
    root.setAttribute('data-view', S.view);
    body.style.padding = '';
    if (X.views[S.view]) {
      tabsEl.hidden = false; tabsEl.innerHTML = tabsHtml();
      body.className = 'omx-body omx-v-' + S.view;
      const tb = X.views[S.view].tab || (X.views[X.views[S.view].parent] && X.views[X.views[S.view].parent].tab);
      headEl.innerHTML = `<h2 id="omxTitle">OST Mesh<small>${esc(tb ? tb.lbl : '')}</small></h2><button class="omx-ib" data-act="close" aria-label="Close">✕</button>`;
      try { X.views[S.view].render({ head: headEl, body, tabs: tabsEl }); } catch (e) { console.warn('[mesh-app] view failed', S.view, e); body.innerHTML = '<div class="omx-empty">This view failed to load. <button class="omx-ghost" data-tab="chats">Open chats</button></div>'; }
      labelHead();
      return;
    }
    headEl.innerHTML = `${S.view === 'settings' && X.actions['sx-back'] ? '<button class="omx-ib" data-act="sx-back" aria-label="Back">‹</button>' : ''}<h2 id="omxTitle">OST Mesh<small>${coreSub[S.view] || ''}</small></h2><button class="omx-ib" data-act="close" aria-label="Close">✕</button>`;
    tabsEl.hidden = false; tabsEl.innerHTML = tabsHtml();
    body.className = 'omx-body';
    if (S.view === 'chats') body.innerHTML = statusHtml() + '<div id="omxChats"></div>', paintChats();
    else if (S.view === 'add') renderAdd();
    else { if (S.view !== 'settings') S.view = 'me'; renderMe(); }
  }
  function requestsHtml() {
    const reqs = Object.values(S.contacts).filter((c) => c.state === 'pending-in' || c.state === 'request').sort((a, b) => (b.ts || 0) - (a.ts || 0));
    if (!reqs.length) return '';
    return reqs.map((c) => `<div class="omx-req"><div class="omx-av" style="${avStyle(c.addr)}">${esc(c.emoji || (c.name || 'm')[0].toUpperCase())}</div><div class="omx-main"><b>${esc(c.name || shortA(c.addr))}</b> ${c.state === 'request' ? 'messaged you' : 'wants to connect'}<br><small>${esc(c.addr)}</small></div><button class="acc" data-act="accept" data-a="${esc(c.addr)}">Accept</button><button class="dec" data-act="decline" data-a="${esc(c.addr)}">✕</button></div>`).join('');
  }
  function paintChats() {
    const el = $('omxChats'); if (!el) return;
    const list = Object.values(S.contacts).filter((c) => c.state !== 'blocked' && c.state !== 'pending-in' && c.state !== 'request').sort((a, b) => ((b.last && b.last.ts) || b.ts || 0) - ((a.last && a.last.ts) || a.ts || 0));
    let h = requestsHtml();
    if (!list.length && !h) {
      h += `<div class="omx-empty"><b>👋</b>No chats yet.<br>Add a real person with your link or QR — it takes one tap on their side.</div><button class="omx-primary" data-tab="add">➕ Add a person</button>`;
    } else {
      h += '<div class="omx-list">' + list.map((c) => `<button class="omx-item" data-act="chat" data-a="${esc(c.addr)}"><div class="omx-av ${online(c.addr) ? 'on' : ''}" style="${avStyle(c.addr)}">${esc(c.emoji || (c.name || 'm')[0].toUpperCase())}<i></i></div><div class="omx-main"><b>${esc(c.name || shortA(c.addr))}${c.state === 'pending-out' ? ' <small style="opacity:.7">· request sent</small>' : ''}</b><span>${c.last && c.last.fail ? '<i class="omx-lfail">! Not delivered</i> · ' : ''}${esc((c.last && c.last.text) || (c.state === 'pending-out' ? 'Waiting for them to accept — you can already write' : 'Say hi 👋'))}</span></div><div class="omx-meta"><span>${c.last && c.last.ts ? ago(c.last.ts) : ''}</span>${c.unread ? `<span class="omx-unread">${c.unread}</span>` : ''}</div></button>`).join('') + '</div>';
      h += `<button class="omx-ghost" style="margin-top:12px" data-tab="add">➕ Add another person</button>`;
    }
    el.innerHTML = h;
  }
  function renderAdd() {
    const link = inviteLink();
    body.innerHTML = requestsHtml() +
      (S.pendingAdd ? `<div class="omx-card"><h3>Add ${esc(S.pendingAdd.name || shortA(S.pendingAdd.addr))}?</h3><p>${esc(S.pendingAdd.addr)}${S.pendingAdd.fp ? '<br>Safety code ' + esc(S.pendingAdd.fp) : ''}</p><div class="omx-row2"><button class="omx-primary" data-act="add-confirm">Add &amp; open chat</button><button class="omx-ghost" data-act="add-cancel">Cancel</button></div></div>` : '') +
      `<div class="omx-card"><h3>Your invite</h3><p>Let them scan this with their phone camera, or send the link. One tap and you are connected.</p>
        <div class="omx-qr"><canvas id="omxQr" width="288" height="288"></canvas></div>
        <div class="omx-link">${esc(link)}</div>
        <div class="omx-row2"><button class="omx-primary" data-act="copy-link">Copy link</button>${navigator.share ? '<button class="omx-ghost" data-act="share-link">Share…</button>' : '<button class="omx-ghost" data-act="copy-addr">Copy address</button>'}</div></div>
      <div class="omx-card"><h3>Add someone</h3>
        <div class="omx-steps"><div><b>1</b>Ask for their invite link or QR (Add person → Your invite on their side).</div><div><b>2</b>Scan it here, or paste the link or ost-mesh address.</div><div><b>3</b>They accept once; after that you both chat and share files any time, even when one of you is offline.</div></div>
        <div id="omxScanWrap" hidden><div class="omx-scan"><video id="omxVideo" playsinline muted></video></div><div class="omx-note" id="omxScanStatus"></div></div>
        <div class="omx-row2"><button class="omx-ghost" data-act="scan" id="omxScanBtn">📷 Scan QR</button><button class="omx-ghost" data-act="paste">📋 Paste from clipboard</button></div>
        <input class="omx-input" id="omxAddInput" style="margin-top:8px" placeholder="Paste invite link or ost-mesh:… address" autocomplete="off" spellcheck="false">
        <button class="omx-primary" style="margin-top:8px" data-act="add-go">Add person</button>
        <div class="omx-note">No camera? Their phone camera app can scan <em>your</em> QR instead — it opens OST and adds you automatically.</div></div>`;
    drawQr($('omxQr'), link).then((ok) => { if (!ok) { const c = $('omxQr'); if (c) c.replaceWith(Object.assign(document.createElement('div'), { className: 'omx-note', textContent: 'QR unavailable — share the link instead.' })); } });
  }
  function renderMe() {
    body.innerHTML = statusHtml() +
      `<div class="omx-card"><div class="omx-me"><div class="omx-av" style="${avStyle(S.address)}">${esc(S.profile.emoji || 'M')}</div><div><b>${esc(myName())}</b><span>${esc(S.address)}</span><span>safety code ${esc(S.fp)}</span></div></div>
        <label class="omx-note" for="omxName">Display name (what friends see)</label>
        <input class="omx-input" id="omxName" maxlength="32" value="${esc(S.profile.name || '')}" placeholder="e.g. Nacho">
        <div class="omx-emojis">${EMOJIS.map((e) => `<button data-act="emoji" data-e="${e}" class="${S.profile.emoji === e ? 'on' : ''}">${e}</button>`).join('')}</div>
        <button class="omx-primary" data-act="save-profile">Save</button></div>
      <div class="omx-card"><h3>Notifications</h3>${notifRowHtml()}</div>
      <div class="omx-card"><h3>How it works</h3><p>Messages are encrypted on your device for one contact (ECDH P-384 + AES-256-GCM) and relayed by the OST hub, which stores only ciphertext for up to 7 days until your friend is online. Files up to 6 MB travel the same way. Your identity lives in this browser — clearing site data loses it.</p>
        <button class="omx-ghost omx-wide" data-act="open-legacy">Classic mesh (calls · games · location)</button>
        <button class="omx-ghost omx-wide omx-danger" data-act="reset-id">Reset identity…</button>
        <div class="omx-note">Wallet: ${esc(window.OST_WALLET_PUBKEY ? window.OST_WALLET_PUBKEY.slice(0, 4) + '…' + window.OST_WALLET_PUBKEY.slice(-4) : 'not connected')} · hub ${esc(API.replace(/^https?:\/\//, ''))}</div></div>`;
  }
  // "Turn on notifications": asks the browser only when tapped.
  function notifRowHtml() {
    if (!('Notification' in window)) return '<div class="omx-note">This browser cannot show notifications.</div>';
    const p = Notification.permission;
    const on = p === 'granted' && (!(window.OST_NOTIFY && typeof window.OST_NOTIFY.enabled === 'function') || window.OST_NOTIFY.enabled());
    if (on) return '<div class="omx-setrow"><span><b>Notifications are on</b><small>New messages alert this device while OST is open in the background.</small></span><i aria-hidden="true">✓</i></div>';
    if (p === 'denied') return '<div class="omx-setrow"><span><b>Notifications are blocked</b><small>Allow notifications for this site in your browser settings.</small></span></div>';
    return '<button type="button" class="omx-setrow" data-act="notif-on"><span><b>Turn on notifications</b><small>Get an alert for new messages while OST is open in the background.</small></span><i aria-hidden="true">›</i></button>';
  }
  // opts.app = options for open() (history adoption); opts.chatToken = re-adopted chat entry.
  function openChat(a, opts) {
    if (!validAddr(a)) return;
    opts = opts || {};
    closeSheet(-1);                                                  // a sheet (e.g. "Reset identity?", another chat's ⋯) never stays over a new chat
    S.peer = a; S.view = 'chat'; S.newBelow = 0; S.viewIsDefault = false;
    if (contact(a) && contact(a).unread) upsertContact(a, { unread: 0 });
    paintBadge();
    if (appIsOpen()) render(); else open('chat', opts.app || {});
    if (!S.backChat) S.backChat = back.push(chatBackFn, 'chat', Object.assign({ meta: a }, opts.chatToken ? { adoptToken: opts.chatToken } : {}));
    keyFor(a).catch(() => {});
  }
  function paintChatHead() {
    const a = S.peer, c = contact(a) || { addr: a };
    const sub = (online(a) ? 'online' : (S.presence[a] && S.presence[a].lastSeen ? 'last seen ' + agoText(S.presence[a].lastSeen) : 'offline — they get your messages later')) + ' · ' + (c.state === 'friend' ? 'encrypted' : c.state === 'pending-out' ? 'request sent' : c.state === 'blocked' ? 'blocked' : 'not accepted yet');
    const nm = esc(c.name || shortA(a));
    // The name opens their profile (when OST Social is loaded): a real button, so keyboards reach it too.
    const title = X.views.profile ? `<h2 id="omxTitle"><button type="button" class="omx-peerbtn" data-act="peer-profile" title="View profile"><span>${nm}</span><small>${esc(sub)}</small></button></h2>` : `<h2 id="omxTitle" title="${nm}">${nm}<small>${esc(sub)}</small></h2>`;
    // Keep keyboard focus on the same header control across a repaint (presence updates repaint the header).
    const ae = document.activeElement, keep = ae && headEl.contains(ae) ? ae.getAttribute('data-act') : '';
    headEl.innerHTML = `<button class="omx-ib" data-act="back" aria-label="Back">‹</button><div class="omx-av omx-av-sm ${online(a) ? 'on' : ''}" style="${avStyle(a)}" aria-hidden="true">${esc(c.emoji || (c.name || 'm')[0].toUpperCase())}<i></i></div>${title}${X.headBtns.map((fn) => { try { return fn(a) || ''; } catch (_) { return ''; } }).join('')}<button class="omx-ib" data-act="peer-menu" aria-label="Chat options">⋯</button>`;
    if (keep) { const b = headEl.querySelector('[data-act="' + keep + '"]'); if (b) { try { b.focus({ preventScroll: true }); } catch (_) {} } }
  }
  // Keep the newest message in view while the reader is at the bottom.
  let msgRO = null;
  const isPinned = () => S.pinnedChat !== false;
  function pinBottom() { const el = $('omxMsgs'); if (el) { el.scrollTop = el.scrollHeight; S.msgTop = el.scrollTop; } }
  // Only the reader moving UP unpins the thread. Content growing under a pinned
  // reader (a thumbnail or photo decoding, the keyboard, the attach tray) leaves
  // scrollTop where it was — and the async scroll event of our own jump can land
  // after that growth: in both cases follow the newest message down.
  function onMsgsScroll() {
    const el = $('omxMsgs'); if (!el) return;
    const top = el.scrollTop, gap = el.scrollHeight - top - el.clientHeight, prev = S.msgTop || 0;
    S.msgTop = top;
    if (gap < 80) { S.pinnedChat = true; if (S.newBelow) { S.newBelow = 0; paintNewPill(); } return; }
    if (top < prev - 1) S.pinnedChat = false;
    else if (S.pinnedChat !== false) pinBottom();
  }
  function paintNewPill() { const b = $('omxNew'); if (!b) return; if (S.newBelow > 0) { b.hidden = false; b.textContent = S.newBelow + (S.newBelow > 1 ? ' new messages ↓' : ' new message ↓'); } else b.hidden = true; }
  const drafts = () => ssGet(DRAFT_KEY, {});
  function saveDraft(a, text) { const d = drafts(); if (text && text.trim()) d[a] = String(text).slice(0, 4000); else delete d[a]; ssSet(DRAFT_KEY, d); }
  function autoGrow(ta) { ta.style.height = 'auto'; ta.style.height = Math.min(120, ta.scrollHeight) + 'px'; }
  function renderChat() {
    const a = S.peer; const c = contact(a);
    paintChatHead();
    tabsEl.hidden = true;
    root.setAttribute('data-view', 'chat');
    body.className = 'omx-body omx-chat'; body.style.padding = '0';
    const attach = [
      { act: 'att-media', ico: '🖼️', lbl: 'Photo / video' },
      { act: 'att-file', ico: '📄', lbl: 'File' },
      { act: 'att-loc', ico: '📍', lbl: 'Location' },
      { act: 'att-live', ico: '📡', lbl: 'Live location' }
    ].concat(X.attach.map((x, i) => ({ act: 'att-x', i, ico: x.ico, lbl: x.lbl })));
    body.innerHTML = `<div class="omx-livebar" id="omxLive" hidden></div><div class="omx-msgwrap"><div class="omx-msgs" id="omxMsgs"></div><button type="button" class="omx-newpill" id="omxNew" data-act="jump-new" hidden></button></div><div class="omx-typing" id="omxTyping" aria-live="polite"></div>` +
      (c && c.state === 'blocked' ? `<div class="omx-card omx-blocked">You blocked this contact. <button class="omx-ghost" data-act="unblock">Unblock</button></div>` :
      `<div class="omx-attach" id="omxAttach" hidden>${attach.map((x) => `<button type="button" data-act="${x.act}"${x.i != null ? ` data-i="${x.i}"` : ''}><b aria-hidden="true">${x.ico}</b>${esc(x.lbl)}</button>`).join('')}<div class="omx-livepick" id="omxLivePick" hidden><span>Share live location for</span><button type="button" data-act="live-go" data-m="15">15 min</button><button type="button" data-act="live-go" data-m="60">1 hour</button><button type="button" data-act="live-go" data-m="480">8 hours</button></div></div>` +
      `<div class="omx-compose"><button type="button" class="omx-ib" data-act="attach" aria-label="Attach" aria-expanded="false">＋</button><input type="file" id="omxFile" hidden multiple accept="image/*,video/*"><input type="file" id="omxFileAny" hidden multiple><textarea id="omxText" rows="1" placeholder="Message…" enterkeyhint="send" aria-label="Message"></textarea><button type="button" class="omx-ib omx-send" data-act="send" id="omxSend" aria-label="Send">➤</button></div>`);
    const ta = $('omxText');
    if (ta) {
      const d = drafts()[a]; if (d) { ta.value = d; autoGrow(ta); }
      ta.addEventListener('input', () => { autoGrow(ta); throttleTyping(); saveDraft(a, ta.value); });
      ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !isPhone()) { e.preventDefault(); doSend(); } });
      // Desktop only: focusing on phones pops the keyboard over the thread.
      if (!isPhone()) setTimeout(() => { try { if (S.view === 'chat' && S.peer === a) ta.focus({ preventScroll: true }); } catch (_) {} }, 50);
    }
    const ml = $('omxMsgs');
    S.pinnedChat = true;
    ml.addEventListener('scroll', onMsgsScroll, { passive: true });
    ml.addEventListener('load', () => { if (isPinned()) pinBottom(); }, true);         // images growing the thread
    if (msgRO) msgRO.disconnect();
    msgRO = window.ResizeObserver ? new ResizeObserver(() => { if (isPinned()) pinBottom(); }) : null;   // keyboard, attach tray, live bar
    if (msgRO) msgRO.observe(ml);
    paintMsgs(true); paintLiveBar(); paintNewPill();
  }
  let typingAt = 0; function throttleTyping() { const n = Date.now(); if (n - typingAt > 2500) { typingAt = n; wsSend({ t: 'typing', to: S.peer }); } }
  function paintTyping() { const el = $('omxTyping'); if (!el) return; const t = S.typingFrom[S.peer] || 0; el.textContent = Date.now() - t < 4000 ? nameOf(S.peer) + ' is typing…' : ''; if (Date.now() - t < 4000) setTimeout(paintTyping, 4200); }
  function msgHtml(m, from) {
    if (m.dir === 'sys') return `<div class="omx-b sys">${esc(m.text)}</div>`;
    const failed = m.dir === 'me' && m.status === 'failed';
    const st = m.dir === 'me' ? (failed ? '' : m.status === 'delivered' ? ' ✓✓' : m.status === 'sent' ? ' ✓' : m.status === 'sending' ? ' · sending…' : '') : '';
    let inner = '';
    if (m.kind === 'loc') {
      const live = m.live && !m.ended && (!m.until || m.until > Date.now());
      inner = `<a class="omx-locc" href="https://www.openstreetmap.org/?mlat=${m.lat}&mlon=${m.lng}#map=16/${m.lat}/${m.lng}" target="_blank" rel="noopener">${mapHtml(m.lat, m.lng)}</a><div class="omx-loct"><b>${m.live ? (live ? '📡 Live location' : '📡 Live location ended') : '📍 Location'}</b><span>±${m.acc || '?'} m${m.live && m.upd ? ' · updated ' + agoText(m.upd) : ''}${live && m.until ? ' · until ' + tTime(m.until) : ''}</span><a href="https://www.google.com/maps/search/?api=1&query=${m.lat},${m.lng}" target="_blank" rel="noopener">Open in Maps ↗</a></div>`;
    } else if (m.kind === 'pay') {
      if (!m.verified) setTimeout(() => verifyPay(from, m), 0);
      const cl = (window.OST_CONFIG && OST_CONFIG.network) || 'devnet';
      inner = `<div class="omx-payc"><b>💸 ${esc(m.amount)} ${esc(m.ccy)}</b><span>${m.dir === 'me' ? 'You sent' : 'You received'} · devnet${m.note ? ' · ' + esc(m.note) : ''}</span><span>${m.verified === 'confirmed' ? '✅ confirmed on-chain' : m.verified === 'failed' ? '❌ transaction failed' : m.verified === 'pending' ? '⏳ not confirmed yet' : '…checking chain'}</span><a href="https://explorer.solana.com/tx/${esc(m.sig)}${cl === 'mainnet-beta' ? '' : '?cluster=' + esc(cl)}" target="_blank" rel="noopener">View transaction ↗</a></div>`;
    } else if (m.kind === 'call') {
      const cs = callSt(m);
      const lbl = cs === 'missed' ? (m.dir === 'me' ? 'No answer' : 'Missed call') : cs === 'declined' ? 'Declined' : cs === 'busy' ? 'Busy' : 'Call';
      inner = `<div class="omx-callc"><b>${m.video ? '🎥' : '📞'} ${m.video ? 'Video' : 'Voice'} call · ${lbl}${m.dur ? ' · ' + Math.floor(m.dur / 60) + ':' + String(m.dur % 60).padStart(2, '0') : ''}</b>${X.actions['call-back'] ? `<button data-act="call-back" data-video="${m.video ? 1 : 0}">Call back</button>` : ''}</div>`;
    } else if (m.kind === 'file') {
      const cached = S.blobs[m.blob] || S.blobs['local:' + m.id];
      const isImg = /^image\//.test(m.mime || ''), isVid = /^video\//.test(m.mime || ''), isAud = /^audio\//.test(m.mime || '');
      if (cached && isImg) inner += `<img src="${cached.url}" alt="${esc(m.name)}" loading="lazy">`;
      else if (cached && isVid) inner += `<video src="${cached.url}" controls playsinline></video>`;
      else if (cached && isAud) inner += `<audio src="${cached.url}" controls style="width:100%"></audio>`;
      // Own file not on the relay yet (sending / failed): nothing to download — the
      // whole failed bubble is one "tap to retry" target, with no competing hint.
      const unsent = m.dir === 'me' && (failed || m.status === 'sending');
      const dlAttr = unsent ? '' : ` data-act="dl" data-id="${esc(m.id)}"`;
      if (!(cached && (isImg || isVid || isAud)) && m.thumb && isImg) inner += `<img src="${esc(m.thumb)}" alt="" style="filter:blur(2px);opacity:.8"${dlAttr}>`;
      const ico = `<b>${isImg ? '🖼️' : isVid ? '🎬' : isAud ? '🎵' : /pdf/.test(m.mime || '') ? '📄' : '📎'}</b>`;
      const hint = failed ? '' : unsent && !m.blob ? ' · encrypting & uploading…' : cached ? ' · tap to save' : unsent ? '' : ' · tap to download';
      const row = `${ico}<div style="min-width:0"><span>${esc(m.name)}</span><small>${fmtSize(m.size || 0)}${hint}</small></div>`;
      inner += failed ? `<div class="omx-file">${row}</div>` : cached ? `<a class="omx-file" href="${cached.url}" download="${esc(m.name)}">${row}</a>` : unsent ? `<div class="omx-file">${row}</div>` : `<a class="omx-file" href="#"${dlAttr}>${row}</a>`;
      if (m.status === 'sending') inner += '<div class="omx-prog ind" role="progressbar" aria-label="Uploading"><i></i></div>';   // honest: no fake percentage
    } else if (m.kind === 'unsupported' || (m.kind && m.kind !== 'text')) inner = '<i class="omx-unsup">Unsupported message — update OST</i>';
    else inner = esc(m.text).replace(/(https?:\/\/[^\s<]+)/g, (u) => `<a href="${u}" target="_blank" rel="noopener" class="omx-a">${u}</a>`);
    const tail = failed ? `<span class="omx-t omx-tfail"><b class="omx-fail" aria-hidden="true">!</b>Not delivered · tap to retry</span>` : `<span class="omx-t">${tTime(m.ts)}${st}</span>`;
    return `<div class="omx-b ${m.dir}${failed ? ' failed' : ''}" data-id="${esc(m.id)}"${failed ? ' data-act="retry" role="button" tabindex="0" title="' + esc(m.err || 'Not delivered') + '"' : ''}>${inner}${tail}</div>`;
  }
  function paintMsgs(jump) {
    const el = $('omxMsgs'); if (!el) return;
    const a = S.peer; const list = msgsOf(a);
    const stick = jump || isPinned(), keep = el.scrollTop;
    let h = '', day = '';
    if (!list.length) h = `<div class="omx-b sys">Messages are end-to-end encrypted. ${contact(a) && contact(a).state === 'pending-out' ? 'You can write now; ' + esc(nameOf(a)) + ' sees it as soon as they open OST.' : 'Say hi 👋'}</div>`;
    for (const m of list) { const d = tDay(m.ts); if (d !== day) { day = d; h += `<div class="omx-day">${d}</div>`; } h += msgHtml(m, a); }
    // Media that is already on screen is carried over, not rebuilt: a rebuilt <img>
    // is 0 px tall until it decodes again, which collapses the thread for a frame
    // (the scroll position clamps — a reader scrolled up got pulled to the bottom)
    // and restarts playing videos.
    const reuse = new Map();
    el.querySelectorAll('img, video, audio').forEach((x) => { const k = x.outerHTML; if (!reuse.has(k)) reuse.set(k, x); });
    el.innerHTML = h;
    if (reuse.size) el.querySelectorAll('img, video, audio').forEach((n) => { const k = n.outerHTML, o = reuse.get(k); if (o) { reuse.delete(k); n.replaceWith(o); } });
    if (stick) { el.scrollTop = el.scrollHeight; S.pinnedChat = true; if (S.newBelow) { S.newBelow = 0; paintNewPill(); } }
    else el.scrollTop = keep;
    S.msgTop = el.scrollTop;
    // Auto-fetch small images so the chat feels alive.
    list.filter((m) => m.kind === 'file' && m.blob && /^image\//.test(m.mime || '') && (m.size || 0) <= AUTO_FETCH_IMG && !S.blobs[m.blob] && !S.blobs['local:' + m.id] && !S.blobs['pending:' + m.blob]).slice(-6).forEach((m) => { fetchBlob(m.dir === 'me' ? S.address : a, m).then(() => paintMsgs()).catch(() => {}); });
  }
  function doSend() { const ta = $('omxText'); if (!ta) return; const text = ta.value.trim(); if (!text) return; ta.value = ''; ta.style.height = 'auto'; saveDraft(S.peer, ''); sendText(S.peer, text); }

  /* ---------- events ---------- */
  function onChange(e) {
    const t = e.target;
    if (t && (t.id === 'omxFile' || t.id === 'omxFileAny') && t.files && t.files.length) { Array.from(t.files).slice(0, 6).forEach((f) => sendFile(S.peer, f)); t.value = ''; const am = $('omxAttach'); if (am) am.hidden = true; }
  }
  async function onClick(e) {
    // A tap anywhere on a failed bubble retries it (its file row / map / links included); its own buttons keep their action.
    const fb = e.target.closest('.omx-b.failed[data-act="retry"]');
    const t = fb && !e.target.closest('button') ? fb : e.target.closest('[data-act],[data-tab]'); if (!t) return;
    if (t.hasAttribute('data-tab')) {
      const v = t.getAttribute('data-tab'); S.view = v; S.viewIsDefault = false; render();
      // The tab bar was redrawn: keep keyboard focus on the tab instead of dropping it to <body>.
      const ae = document.activeElement;
      if (!ae || ae === document.body || !ae.isConnected) { const b = tabsEl.querySelector('[data-tab="' + v + '"]'); if (b && !tabsEl.hidden) { try { b.focus({ preventScroll: true }); } catch (_) {} } }
      return;
    }
    const act = t.getAttribute('data-act'), a = t.getAttribute('data-a');
    if (X.actions[act]) { try { await X.actions[act](t, e); } catch (err) { toast((err && err.message) || 'Action failed', 'err'); } return; }
    switch (act) {
      case 'attach': { const m = $('omxAttach'); if (m) { const pin = isPinned(); m.hidden = !m.hidden; t.setAttribute('aria-expanded', m.hidden ? 'false' : 'true'); const lp = $('omxLivePick'); if (lp) lp.hidden = true; if (pin) pinBottom(); } break; }
      case 'att-media': { const f = $('omxFile'); if (f) f.click(); break; }
      case 'att-file': { const f = $('omxFileAny'); if (f) f.click(); break; }
      case 'att-loc': { const m = $('omxAttach'); if (m) m.hidden = true; shareLocation(S.peer); break; }
      case 'att-live': { const lp = $('omxLivePick'); if (lp) lp.hidden = !lp.hidden; break; }
      case 'live-go': { const m = $('omxAttach'); if (m) m.hidden = true; startLive(S.peer, Number(t.getAttribute('data-m')) || 15); break; }
      case 'live-stop': stopLive(S.peer); break;
      case 'att-x': { const m = $('omxAttach'); if (m) m.hidden = true; const x = X.attach[Number(t.getAttribute('data-i'))]; if (x) { try { await x.run(S.peer); } catch (err) { toast(err.message || 'Failed', 'err'); } } break; }
      case 'peer-profile': if (X.views.profile) { const p = S.peer; S.profileOf = p; S.view = 'profile'; S.viewIsDefault = false; render(); } break;
      case 'close': close(); break;
      case 'back': leaveChat(); break;
      case 'jump-new': S.newBelow = 0; S.pinnedChat = true; pinBottom(); paintNewPill(); break;
      case 'chat': openChat(a); break;
      case 'accept': acceptPerson(a); break;
      case 'decline': declinePerson(a, false); break;
      case 'send': doSend(); break;
      case 'retry': e.preventDefault(); retryMsg(S.peer, t.getAttribute('data-id')); break;   // a tap anywhere on a failed bubble (map / file links included) retries
      case 'dl': { e.preventDefault(); const id = t.getAttribute('data-id'); const m = msgsOf(S.peer).find((x) => x.id === id); if (!m) return; t.style.opacity = '.6'; try { await fetchBlob(m.dir === 'me' ? S.address : S.peer, m); paintMsgs(); } catch (err) { toast(err && err.message || 'Download failed', 'err'); t.style.opacity = ''; } break; }
      case 'copy-link': copyText(inviteLink(), 'Invite link copied — send it to your friend'); break;
      case 'copy-addr': copyText(S.address, 'Address copied'); break;
      case 'share-link': try { await navigator.share({ title: 'Chat with me on OST Mesh', text: 'Add me on OST Mesh: ' + inviteLink() }); } catch (_) {} break;
      case 'scan': { const w = $('omxScanWrap'); if (!w) return; if (!w.hidden && S.scanStream) { stopScan(); w.hidden = true; t.textContent = '📷 Scan QR'; return; } w.hidden = false; t.textContent = '■ Stop camera'; startScan($('omxVideo'), (info) => { S.pendingAdd = info; render(); }, (s) => { const st = $('omxScanStatus'); if (st) st.textContent = s; }); break; }
      case 'paste': try { const txt = await navigator.clipboard.readText(); const info = parseAddText(txt); if (!info) { toast('Clipboard has no OST Mesh link.', 'err'); return; } S.pendingAdd = info; render(); } catch (_) { toast('Clipboard not available — paste into the box.', 'err'); } break;
      case 'add-go': { const info = parseAddText(($('omxAddInput') || {}).value); if (!info) { toast('Paste an invite link or an ost-mesh: address.', 'err'); return; } t.disabled = true; t.textContent = 'Adding…'; await addPerson(info); break; }
      case 'add-confirm': { const info = S.pendingAdd; S.pendingAdd = null; t.disabled = true; t.textContent = 'Adding…'; await addPerson(info); if (S.view === 'add') render(); break; }
      case 'add-cancel': S.pendingAdd = null; render(); break;
      case 'emoji': {   // toggled in place: re-rendering would wipe a name being typed
        S.profile.emoji = t.getAttribute('data-e'); lsSet(K.profile, S.profile);
        t.parentNode.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === t));
        const av = body.querySelector('.omx-me .omx-av'); if (av) av.textContent = S.profile.emoji;
        saveProfile({ emoji: S.profile.emoji }).catch((err) => toast(err.message, 'err')); break;
      }
      case 'save-profile': {
        const n = ($('omxName') || {}).value || ''; S.profile.name = n.trim().slice(0, 32); lsSet(K.profile, S.profile);
        t.disabled = true;
        try { await saveProfile({ name: S.profile.name, emoji: S.profile.emoji || '' }); toast('Saved — friends see “' + (S.profile.name || shortA(S.address)) + '”'); renderMe(); }
        catch (err) { toast(err.message, 'err'); t.disabled = false; }
        break;
      }
      case 'notif-on': {
        let perm = '';
        try { perm = window.OST_NOTIFY && typeof window.OST_NOTIFY.request === 'function' ? await window.OST_NOTIFY.request() : ('Notification' in window ? await Notification.requestPermission() : 'unsupported'); } catch (_) { perm = 'unsupported'; }
        toast(perm === 'granted' ? 'Notifications are on for this device' : perm === 'denied' ? 'Notifications are blocked — allow them in your browser settings.' : perm === 'unsupported' ? 'This browser cannot show notifications.' : 'Notifications were not turned on.', perm === 'granted' ? '' : 'err');
        if (S.view === 'settings' || S.view === 'me') render();
        break;
      }
      case 'open-legacy': openLegacy(); break;
      case 'reset-id': {
        const ok = await confirmSheet({ title: 'Reset your mesh identity?', body: 'You get a new address and new keys; friends must add you again. Chats stay on this device.', ok: 'Reset identity', danger: true });
        if (!ok) break;
        try { await resetIdentity(); toast('New identity: ' + shortA(S.address)); } catch (err) { toast((err && err.message) || 'Reset failed', 'err'); }
        render(); break;
      }
      case 'peer-menu': await peerMenu(S.peer); break;
      case 'unblock': try { await signed('POST', '/mesh/v1/friend/respond', { wallet: S.address, other: S.peer, action: 'unblock' }); upsertContact(S.peer, { state: 'friend' }); render(); } catch (err) { toast(err.message, 'err'); } break;
    }
  }
  function copyText(text, msg) { const done = () => toast(msg || 'Copied'); try { if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(text).then(done, fallback); return; } } catch (_) {} fallback(); function fallback() { try { const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); done(); } catch (_) { toast('Copy failed — long-press the link to copy it.', 'err'); } } }
  // Chat ⋯ sheet: Block / Remove contact / Clear chat… (+ plugin rows, e.g. calls on narrow phones).
  async function peerMenu(p) {
    if (!p) return;
    const c = contact(p) || {}, name = nameOf(p);
    const extra = [];
    X.menu.forEach((fn) => { try { (fn(p) || []).forEach((x) => { if (x && x.label && typeof x.run === 'function') extra.push(x); }); } catch (_) {} });
    const items = extra.map((x, i) => ({ label: x.label, sub: x.sub, danger: !!x.danger, value: 'x' + i }));
    items.push(c.state === 'blocked' ? { label: 'Unblock', sub: 'They can message and call you again', value: 'unblock' } : { label: 'Block', sub: 'They can no longer message or call you', danger: true, value: 'block' });
    items.push({ label: 'Remove contact', sub: 'Also deletes this chat on this device', danger: true, value: 'remove' });
    items.push({ label: 'Clear chat…', sub: 'Deletes the messages on this device only', danger: true, value: 'clear' });
    const v = await actionSheet({ title: name, items });
    if (!v || S.peer !== p) return;
    if (v[0] === 'x') { const x = extra[Number(v.slice(1))]; if (x) { try { await x.run(p); } catch (err) { toast((err && err.message) || 'Failed', 'err'); } } return; }
    if (v === 'unblock') { try { await signed('POST', '/mesh/v1/friend/respond', { wallet: S.address, other: p, action: 'unblock' }); upsertContact(p, { state: 'friend' }); render(); } catch (err) { toast(err.message, 'err'); } return; }
    if (v === 'block') {
      if (!(await confirmSheet({ title: 'Block ' + name + '?', body: 'They can no longer message or call you. Their messages are dropped without a notification.', ok: 'Block', danger: true }))) return;
      if (await declinePerson(p, true)) { toast(name + ' is blocked'); if (S.peer === p) leaveChat(); }
      return;
    }
    if (v === 'remove') {
      if (!(await confirmSheet({ title: 'Remove ' + name + '?', body: 'They leave your contacts and this chat is deleted on this device. You can add them again later.', ok: 'Remove contact', danger: true }))) return;
      if (await declinePerson(p, false)) { try { localStorage.removeItem(K.msgs + p); } catch (_) {} lsSet(OUTBOX_KEY, outboxList().filter((x) => x.a !== p)); toast(name + ' removed'); if (S.peer === p) leaveChat(); }
      return;
    }
    if (v === 'clear') {
      if (!(await confirmSheet({ title: 'Clear this chat?', body: 'Deletes every message with ' + name + ' on this device. ' + name + ' keeps their copy.', ok: 'Clear chat', danger: true }))) return;
      try { localStorage.removeItem(K.msgs + p); } catch (_) {}
      lsSet(OUTBOX_KEY, outboxList().filter((x) => x.a !== p));
      upsertContact(p, { last: null, unread: 0 }); saveDraft(p, '');
      if (S.view === 'chat' && S.peer === p) paintMsgs(true);
      toast('Chat cleared');
    }
  }
  // Classic mesh: the legacy scripts load on demand (contract C4: OST_LAZY.group('mesh')).
  async function openLegacy() {
    toast('Opening classic mesh…');
    const ready = () => !!(window.OST_MESH && typeof window.OST_MESH.open === 'function');
    if (!ready() && window.OST_LAZY && typeof window.OST_LAZY.group === 'function') {
      try { await Promise.race([window.OST_LAZY.group('mesh'), new Promise((res) => setTimeout(res, 20000))]); } catch (_) {}
      if (ready()) { close(); window.OST_MESH.open(); return; }
    }
    if (ready()) { close(); window.OST_MESH.open(); return; }
    try { if (window.OST_LAZY && OST_LAZY.flush) OST_LAZY.flush(); } catch (_) {}
    let n = 0; const iv = setInterval(() => { if (ready()) { clearInterval(iv); close(); window.OST_MESH.open(); } else if (++n > 60) { clearInterval(iv); toast('Classic mesh did not load — reload and try again.', 'err'); } }, 250);
  }

  /* ---------- deep links: #mesh, #chat, #chat=<addr>, #mesh-add=… ----------
   * At boot the hash is cleared from the first entry and the app pushes its own
   * entry, so Back closes the app instead of leaving the site. When a hash link
   * is followed in-page, that new entry is taken over (adopted) — Back returns
   * to where the user was. */
  function handleHash(ev) {
    const h = location.hash || '';
    const atBoot = !ev;
    const strip = () => { try { history.replaceState(history.state, '', location.pathname + location.search); } catch (_) {} };
    const how = atBoot ? {} : { adopt: true };
    let m;
    if (/^#mesh-add=/.test(h)) {
      const info = parseAddText(h); strip();
      if (info) { S.pendingAdd = info; whenReady(() => open('add', how)); }
      return true;
    }
    if ((m = h.match(/^#chat=(ost-mesh(?::|%3A)[0-9a-f-]{8,40})$/i))) {
      const a = decodeURIComponent(m[1]).toLowerCase(); if (atBoot) strip();
      whenReady(() => { if (contact(a) && validAddr(a)) openChat(a, { app: how }); else open('chats', how); });
      return true;
    }
    if (h === '#mesh' || h === '#mesh-app' || h === '#chat') { if (atBoot) strip(); whenReady(() => open(h === '#chat' ? 'chats' : undefined, how)); return true; }
    if (/^#mesh=/.test(h)) { const info = parseAddText(decodeURIComponent(h.slice(6))); strip(); if (info) { S.pendingAdd = info; whenReady(() => open('add', how)); } return true; }
    return false;
  }
  const readyQ = []; function whenReady(fn) { if (S.ready) fn(); else readyQ.push(fn); }
  // Reload mid-chat: come back to the same view / peer (the draft is restored by renderChat),
  // re-adopting the history entries the app had pushed before the reload.
  function restoreSession() {
    const st = ssGet(SESSION_KEY, null);
    if (!st || !st.open || Date.now() - (Number(st.at) || 0) > 12 * 3600 * 1000) return false;
    if (appIsOpen() || /^#(social|post=|u=)/.test(location.hash || '')) return false;   // a deep link decides instead
    // Only a reload (or Back/Forward) of the same page brings the app back — not a fresh visit to another page.
    if (st.path && st.path !== location.pathname) return false;
    try { const nav = performance.getEntriesByType && performance.getEntriesByType('navigation')[0]; if (nav && nav.type && nav.type !== 'reload' && nav.type !== 'back_forward') return false; } catch (_) {}
    const hs = history.state && Array.isArray(history.state.omxStack) ? history.state.omxStack : [];
    const tok = (kind) => { const e = hs.find((x) => Array.isArray(x) && x[1] === kind); return e ? Number(e[0]) || 0 : 0; };
    const appOpts = tok('app') ? { adoptToken: tok('app') } : {};
    if (st.view === 'chat' && validAddr(st.peer || '') && contact(st.peer)) { openChat(st.peer, { app: appOpts, chatToken: tok('chat') }); return true; }
    const v = st.view && ((CORE_VIEWS.includes(st.view) && st.view !== 'chat') || (X.views[st.view] && X.views[st.view].tab)) ? st.view : undefined;
    open(v, appOpts);
    return true;
  }

  /* ---------- boot ---------- */
  async function boot() {
    mount();
    try { await loadIdentity(); } catch (e) { console.warn('[mesh-app] identity failed', e); return; }
    S.ready = true; readyQ.splice(0).forEach((fn) => { try { fn(); } catch (_) {} });
    // One inbox sync: the socket's onopen does it; only if the socket is not up
    // after a few seconds does the mailbox poll run instead.
    announce().then(() => {
      connectWs(); syncFriends(true); flushOutbox(true);
      setTimeout(() => { if (!S.wsOk) syncInbox(); }, 4000);
      if (!lsGet(K.profile + '.synced', false) && (S.profile.name || S.profile.emoji)) saveProfile({ name: S.profile.name || '', emoji: S.profile.emoji || '' }).then(() => lsSet(K.profile + '.synced', true)).catch(() => {});
    });
    // Keepalive every 25 s (never starts a second socket chain); without a socket
    // (strict proxies, corporate Wi-Fi) the mailbox is polled — every 6 s while
    // the app is open. Everything is skipped while the hub's breaker is open.
    setInterval(() => { if (document.hidden) return; if (S.wsOk) wsSend({ t: 'ping' }); else { connectWs(); syncInbox(); } askPresence(); flushOutbox(); }, 25000);
    setInterval(() => { if (document.hidden || S.wsOk || !appIsOpen()) return; syncInbox(); }, 6000);
    setInterval(() => { if (!document.hidden) syncFriends(); }, 4 * 60000);
    setInterval(() => { if (!document.hidden) announce(); }, 6 * 3600 * 1000);
    setInterval(() => { if (appIsOpen()) paintStatus(); }, 5000);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) return;
      connectWs(); syncInbox(); askPresence(); flushOutbox(true);
      if (appIsOpen() && S.view === 'chat' && S.peer && contact(S.peer) && contact(S.peer).unread) { upsertContact(S.peer, { unread: 0 }); paintBadge(); }
    });
    // Back online: the socket's pending backoff (up to a minute) is pointless now — reconnect at once.
    window.addEventListener('online', () => { paintStatus(); wsKick(); syncInbox(); flushOutbox(true); });
    window.addEventListener('offline', () => paintStatus());
    window.addEventListener('hashchange', (e) => handleHash(e || true));
    // Phones: the keyboard shrinks the visual viewport — keep the newest message in view.
    try { if (window.visualViewport) window.visualViewport.addEventListener('resize', () => { if (S.view === 'chat' && appIsOpen() && isPinned()) pinBottom(); }); } catch (_) {}
    if (!handleHash()) setTimeout(() => { try { restoreSession(); } catch (e) { console.warn('[mesh-app] restore failed', e); } }, 0);
    syncUnread(true); paintBadge();
  }
  const core = {
    S, X, API, K, signed, signHeaders, announce, saveProfile, lookup, keyFor, sealPayload, sendInner, signal, wsSend,
    toast, esc, shortA, ago, tTime, avStyle, nameOf, emojiOf, contact, upsertContact, myName, fmtSize, uid, lsGet, lsSet,
    appendMsg, updateMsg, msgsOf, paintMsgs, paintChatHead, render, open, close: () => close(), openChat, addPerson, copyText, loadScript, inviteLink,
    back, actionSheet, confirm: confirmSheet, whenReady, hubBusy, noteHub, explain, flushOutbox, unread: totalUnread,
    isOpen: () => appIsOpen(),
    // A home tab that registers after the app opened on the DEFAULT view (a cold
    // #mesh link runs before the plugins load) takes over — never a view the user chose.
    register(name, def) { X.views[name] = def; if (def.tab && def.tab.home && (!S.opened || (S.viewIsDefault && S.view !== 'chat'))) S.view = name; if (appIsOpen() && !S.peer) render(); else paintBadge(); },
    go(view, extra) { Object.assign(S, extra || {}); S.viewIsDefault = false; if (appIsOpen()) { S.view = view; render(); } else open(view); }
  };
  window.OST_MESH_APP = {
    core,
    open: (view) => open(typeof view === 'string' ? view : undefined), close: () => close(), openChat: (a) => openChat(a),
    addFromText: (text) => { const info = parseAddText(text); if (info) { S.pendingAdd = info; open('add'); } return !!info; },
    inviteLink, unread: totalUnread, sync: () => { connectWs(); syncInbox(); askPresence(); flushOutbox(); },
    state: () => ({ address: S.address, connected: S.wsOk, announced: S.announced, announceErr: S.announceErr, lastErr: S.lastErr || '', contacts: Object.keys(S.contacts).length, view: S.view, unread: totalUnread(), hubBusy: hubBusy(), outbox: outboxList().length })
  };
  try { window.dispatchEvent(new CustomEvent('ost:mesh-app:core', { detail: core })); } catch (_) {}
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true }); else boot();
}

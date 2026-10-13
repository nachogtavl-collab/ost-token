/* ==========================================================================
 * OST · Mesh app — one place to add people, chat and share files (all devices)
 * --------------------------------------------------------------------------
 * Replaces the five overlapping mesh surfaces with a single app:
 *   Home (OST Social) · Chats · Add (QR / link / scan / paste) · Me / Settings
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
 * History: core.back.push(fn)/pop(token)/retag(token, meta) — app and chat each
 *   own one entry, so the browser/system Back closes the chat, then the app.
 * Layout (phase 2): three bands written on #ostMeshApp as data-layout / data-band
 *   (phone < 600 · drawer 600-1099 · desk >= 1100, compact 1100-1279 / full), one DOM
 *   (#omxRail · #omxPane · main#omxMain > #omxHead + #omxBody · #omxAside · #omxInfo ·
 *   #omxTabs); icons from ost-mesh-icons.js (one zero-size #omxSprite); the chat
 *   surfaces' markup from ost-mesh-chat-ui.js (pure HTML builders).
 * window.OST_MESH_APP.{ open, close, openChat, addFromText, unread, sync, state, core }
 *   events: 'ost:mesh-app:unread' {total}, 'ost:mesh-app:message', 'ost:mesh-app:profile'
 * ========================================================================== */
import {
  generateIdentity, exportPublicBundle, importPeerBundle, deriveSessionKey,
  sealPayload, openPayload, sealBytes, openBytes, fingerprint as fpOf
} from './mesh/mesh-crypto.js?v=1';
import { SPRITE, icon as iconHtml, hasIcon } from './ost-mesh-icons.js?v=1';
import * as CUI from './ost-mesh-chat-ui.js?v=1';

if (!window.OST_MESH_APP) {
  const API = String(window.OST_MESH_API_BASE || window.OST_API_BASE || 'https://ost-api.nachogtavl.workers.dev').replace(/\/+$/, '');
  const K = {
    id: 'ost_mesh_identity_v1', addr: 'ost_mesh_addr_v1',
    profile: 'ost.mesh.app.profile.v1', contacts: 'ost.mesh.app.contacts.v1', msgs: 'ost.mesh.app.msgs.v1.', seen: 'ost.mesh.app.seen.v1'
  };
  const MSG_CAP = 500, BLOB_MAX = 6 * 1024 * 1024, IMG_MAX_EDGE = 1600, AUTO_FETCH_IMG = 3 * 1024 * 1024;
  // ONE shared set of 20 avatar emoji (core.EMOJIS; OST Social uses the same list).
  const EMOJIS = ['🦊', '🐼', '🐸', '🦁', '🐙', '🦄', '🐯', '🐳', '🦉', '🐝', '🌵', '🍀', '⚡', '🔥', '🌙', '🎧', '🛰️', '🎲', '🚀', '💎'];

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
  const dayStart = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const daysAgo = (ts) => Math.round((dayStart(new Date()) - dayStart(new Date(ts))) / 86400000);
  // Day pills: "Today" · "Yesterday" · a weekday within 6 days · "Mon, Sep 28" (+ the year when not this year).
  const tDay = (ts) => {
    const d = new Date(ts), n = daysAgo(ts);
    if (n === 0) return 'Today';
    if (n === 1) return 'Yesterday';
    if (n > 1 && n < 7) return d.toLocaleDateString(undefined, { weekday: 'long' });
    const o = { weekday: 'short', month: 'short', day: 'numeric' }; if (d.getFullYear() !== new Date().getFullYear()) o.year = 'numeric';
    return d.toLocaleDateString(undefined, o);
  };
  // List rows: the time today, the weekday this week, "Oct 2" older (+ the year when not this year).
  const tShort = (ts) => {
    if (!ts) return '';
    const d = new Date(ts), n = daysAgo(ts);
    if (n <= 0) return tTime(ts);
    if (n < 7) return d.toLocaleDateString(undefined, { weekday: 'short' });
    const o = { month: 'short', day: 'numeric' }; if (d.getFullYear() !== new Date().getFullYear()) o.year = 'numeric';
    return d.toLocaleDateString(undefined, o);
  };
  const ago = (ts) => { const s = Math.max(0, (Date.now() - ts) / 1000); return s < 60 ? 'now' : s < 3600 ? Math.floor(s / 60) + 'm' : s < 86400 ? Math.floor(s / 3600) + 'h' : Math.floor(s / 86400) + 'd'; };
  const agoText = (ts) => { const a = ago(ts); return a === 'now' ? 'just now' : a + ' ago'; };
  const uid = () => hex(crypto.getRandomValues(new Uint8Array(8)));
  const hue = (a) => { a = String(a || ''); let h = 0; for (let i = 0; i < a.length; i++) h = (h * 31 + a.charCodeAt(i)) >>> 0; return h % 360; };
  // One identity colour per person (12 hues, white initials >= 4.74:1): callers keep style="${avStyle(a)}".
  const avStyle = (a) => `--av:var(--omx-id-${hue(a) % 12})`;
  const lsGet = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v == null ? d : v; } catch (_) { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} };
  const ssGet = (k, d) => { try { const v = JSON.parse(sessionStorage.getItem(k) || 'null'); return v == null ? d : v; } catch (_) { return d; } };
  const ssSet = (k, v) => { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch (_) {} };
  const clipName = (s) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 40);   // peer-supplied names
  const clipEmoji = (s) => String(s == null ? '' : s).slice(0, 8);
  const isPhone = () => !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
  const mq = (q) => { try { return !!(window.matchMedia && window.matchMedia(q).matches); } catch (_) { return false; } };
  const reducedMotion = () => mq('(prefers-reduced-motion: reduce)');
  // Popovers need a precise pointer and room; touch screens and narrow windows get bottom sheets.
  const deskPointer = () => window.innerWidth >= 700 && mq('(pointer: fine)');
  const netName = () => { try { return String((window.OST_CONFIG && window.OST_CONFIG.network) || 'devnet'); } catch (_) { return 'devnet'; } };
  const isDevnet = () => !/^mainnet/i.test(netName());
  const devnetChip = () => isDevnet() ? `<span class="omx-devnet">${esc(netName())}</span>` : '';
  // Icons (contract C9): core.icon(id, cls) -> <svg class="omx-i"><use href="#i-id"/></svg>; '' for an unknown id.
  // A plugin's old emoji "icon" still renders, as aria-hidden text.
  const icon = (id, cls) => iconHtml(id, cls);
  const icoOrText = (ico, cls) => hasIcon(ico) ? iconHtml(ico, cls) : (ico ? `<b aria-hidden="true">${esc(ico)}</b>` : '');

  /* ---------- toasts: above every overlay of the app family (z 13500) ----------
   * toast(msg, kind, opts): kind 'ok' (check-circle) · 'err' (alert, role=alert) · 'msg' (an avatar) · '';
   * opts.avatar (address) + opts.sub (a second line); opts.action = {label, run} = ONE real text button
   * (6 s instead of 4 s); opts.onTap = the whole toast opens something (message toasts). At most 2 at once. */
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
      const t = document.createElement('div'); t.className = 'omx-toast' + (kind ? ' ' + kind : '');
      if (kind === 'err') t.setAttribute('role', 'alert');
      const act = opts.action && opts.action.label && typeof opts.action.run === 'function' ? opts.action : null;
      const tap = !act && typeof opts.onTap === 'function' ? opts.onTap : null;
      const lead = opts.avatar ? avHtml(opts.avatar, 'sm') : kind === 'ok' ? icon('check-circle', 'is-on') : kind === 'err' ? icon('alert', 'is-on') : (opts.ico ? icon(opts.ico) : '');
      const txt = opts.sub ? `<span class="t"><b>${esc(msg)}</b><small>${esc(opts.sub)}</small></span>` : `<span class="t">${esc(msg)}</span>`;
      t.innerHTML = lead + txt + (act ? `<button type="button" class="omx-textbtn">${esc(act.label)}</button>` : tap ? `<span class="omx-textbtn" aria-hidden="true">${esc(opts.tapLabel || 'Open')}</span>` : '');
      const kill = () => { if (t.classList.contains('out')) return; t.classList.add('out'); setTimeout(() => t.remove(), 200); };
      if (act) t.querySelector('button').addEventListener('click', (e) => { e.stopPropagation(); kill(); try { act.run(); } catch (_) {} });
      if (tap) {
        t.classList.add('tap'); t.setAttribute('role', 'button'); t.tabIndex = 0;
        if (opts.sub) t.setAttribute('aria-label', msg + ': ' + opts.sub + ' (open)');
        const go = () => { kill(); try { closeSheet(-1); tap(); } catch (_) {} };   // the tap navigates: an open sheet is left behind, not kept on top
        t.addEventListener('click', go);
        t.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
      }
      const live = Array.from(toastHost.children).filter((x) => !x.classList.contains('out'));
      while (live.length >= 2) { const o = live.shift(); o.classList.add('out'); setTimeout(() => o.remove(), 200); }
      placeToasts();
      toastHost.appendChild(t);
      setTimeout(kill, opts.ms || (act || tap ? 6000 : 4000));
    } catch (_) {}
  }
  // Desk: bottom centre. Phone / drawer with the app open: 12 px above the tab bar (.phone); the
  // drawer band centres them over the 600 px panel. Phone with the app closed: above the site's bar.
  function placeToasts() {
    if (!toastHost) return;
    const open = appIsOpen(), L = open ? layout() : '';
    toastHost.classList.toggle('phone', open && L !== 'desk');
    toastHost.classList.toggle('site', !open && window.innerWidth < 600);
    let left = '', maxW = '';
    try {
      const r = open && L === 'drawer' && shellEl ? shellEl.getBoundingClientRect() : null;
      if (r && r.width > 0 && r.width < window.innerWidth - 40) { left = Math.round(r.left + r.width / 2) + 'px'; maxW = Math.round(r.width - 32) + 'px'; }
    } catch (_) {}
    if (toastHost.style.left !== left) toastHost.style.left = left;
    if (toastHost.style.maxWidth !== maxW) toastHost.style.maxWidth = maxW;
  }

  /* ---------- avatar: ONE component (core.av) ----------
   * av(addr, size) or av({addr, emoji, name, img, online, pending}, size); size xs · sm · (md) · lg · xl · xxl.
   * Identity colour by address hash; the emoji / initial is drawn by CSS from data-g (so an avatar never adds
   * text to a button's label); a photo falls back to data-fb when it fails. The presence dot is for friends
   * only, never for yourself; a contact who has not accepted yet gets the pending ring. */
  function avHtml(x, size) {
    const o = (x && typeof x === 'object') ? x : { addr: x || '' };
    const a = String(o.addr || ''), self = !!a && a === S.address, c = !self && a ? contact(a) : null;
    const name = o.name != null ? String(o.name) : self ? ((S.profile && S.profile.name) || '') : ((c && c.name) || '');
    const emoji = o.emoji != null ? String(o.emoji) : self ? ((S.profile && S.profile.emoji) || '') : ((c && c.emoji) || '');
    let img = o.img || '';
    if (!img && self && S.profile && S.profile.avatar && o.img !== '') img = API + '/mesh/v1/social/media/' + encodeURIComponent(S.profile.avatar);
    const dot = !self && (o.online != null ? !!o.online : !!(c && c.state === 'friend' && online(a)));
    const pend = o.pending != null ? !!o.pending : !!(c && c.state === 'pending-out');
    const glyph = emoji ? clipEmoji(emoji) : name.trim() ? Array.from(name.trim())[0].toUpperCase() : '';
    const cls = 'omx-av' + (size && size !== 'md' ? ' ' + String(size).replace(/[^\w -]/g, '') : '') + (emoji && !img ? ' emoji' : '') + (pend ? ' pending' : '');
    const inner = img ? `<img src="${esc(img)}" alt="" loading="lazy">` : glyph ? '' : icon('user');
    return `<span class="${cls}" style="--av:var(--omx-id-${hue(a || name || 'x') % 12})"${!img && glyph ? ` data-g="${esc(glyph)}"` : ''}${img ? ` data-fb="${esc(glyph)}"` : ''} aria-hidden="true">${inner}${dot ? '<i class="on"></i>' : ''}</span>`;
  }
  // A photo avatar that fails to load shows the emoji / initial instead (never the broken-image glyph).
  document.addEventListener('error', (e) => {
    const t = e.target; if (!t || t.tagName !== 'IMG') return;
    const p = t.parentElement; if (!p || !p.classList || !p.classList.contains('omx-av')) return;
    const g = p.getAttribute('data-fb') || ''; t.remove(); if (g) p.setAttribute('data-g', g); else p.insertAdjacentHTML('afterbegin', icon('user'));
  }, true);

  /* ---------- state ---------- */
  const S = {
    identity: null, address: '', bundle: null, fp: '', profile: lsGet(K.profile, null),
    contacts: lsGet(K.contacts, {}), seen: new Set(lsGet(K.seen, [])), presence: {},
    view: 'chats', peer: null, keys: {}, blobs: {}, ws: null, wsOk: false, wsTries: 0, announced: false, announceErr: '',
    typingFrom: {}, scanStream: null, scanTimer: null, pendingAdd: null, ready: false,
    backApp: 0, backChat: 0, opener: null, hubOkAt: 0, pollOkAt: 0, netErrAt: 0, bootAt: Date.now(), newBelow: 0, friendsAt: 0,
    dir: {}, hubDown: false, viewIsDefault: false, msgTop: 0,
    chatFilter: 'all', chatQuery: '', chatSearching: false, addTab: 'invite', unreadFrom: null
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

  /* ---------- plugin surface (ost-social.js, ost-mesh-call.js) — phase 2 additions are backwards compatible ----------
   * views:     name -> { tab?: {ico, lbl, order, home?, railLbl?, avatar?}, rail?: {ico, lbl, order},
   *                      parent?, hideHead?, noTabs?, render(ctx) }    ctx = { head, body, tabs, layout, band, icon, av }
   *            ico = a sprite id (an unknown value, e.g. an old plugin's emoji, renders as text)
   * headBtns:  [(peer) -> html]                                    chat header buttons
   * attach:    [{ ico, lbl, sub?, tile?, run(peer) }]              chat "+" tray tiles / popover rows
   * actions:   name -> fn(el, event)                               data-act handlers
   * ws:        [fn(m)]                                             every socket message
   * badges:    name -> () => number                                nav badges (rail / tab bar)
   * menu:      [(peer) -> [{ label, sub?, danger?, ico?, run() }]] extra rows in the chat ⋯ menu
   * aside:     [{ id, order, views: string[] | (v) => bool, render(ctx) -> html }]   desk right-column modules
   * info:      [(peer) -> [{ ico, lbl, act }]]                     contact-info pane actions (desk)
   * viewer:    ({ src, alt, from, ts, download }) => void          image viewer for chat photos
   * compose:   () => void                                          rail Post / phone header compose */
  const X = { views: {}, headBtns: [], attach: [], actions: {}, ws: [], badges: {}, menu: [], aside: [], info: [], viewer: null, compose: null };

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
  // C11: sign with the server-corrected clock (OST_AUTH learns the offset), so a
  // phone whose clock is minutes off is not refused as mesh_auth_stale.
  function meshNow() { try { if (window.OST_AUTH && typeof OST_AUTH.now === 'function') { const n = Number(OST_AUTH.now()); if (Number.isFinite(n) && n > 0) return n; } } catch (_) {} return Date.now(); }
  async function signHeaders(method, pathq, bodyHash) {
    const ts = meshNow(), nonce = hex(crypto.getRandomValues(new Uint8Array(12)));
    const msg = `OST-MESH|v1|${S.address}|${method}|${pathq}|${bodyHash}|${ts}|${nonce}`;
    const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-384' }, S.identity.sig.privateKey, new TextEncoder().encode(msg));
    return { addr: S.address, ts, nonce, sig: b64(sig) };
  }
  async function signed(method, pathq, body, _retried) {
    if (hubBusy()) throw netErr('hub_busy');
    const isBin = body instanceof Uint8Array || body instanceof ArrayBuffer;
    const bodyText = body && !isBin ? JSON.stringify(body) : '';
    const hashSrc = isBin ? body : new TextEncoder().encode(bodyText);
    const h = await signHeaders(method, pathq, hex(await crypto.subtle.digest('SHA-256', hashSrc)));
    const headers = { 'x-mesh-addr': h.addr, 'x-mesh-ts': String(h.ts), 'x-mesh-nonce': h.nonce, 'x-mesh-sig': h.sig };
    if (bodyText) headers['Content-Type'] = 'application/json';
    if (isBin) headers['Content-Type'] = 'application/octet-stream';
    let r;
    const sentAt = Date.now();
    try { r = await fetch(API + pathq, { method, headers, body: isBin ? body : (bodyText || undefined), cache: 'no-store' }); }
    catch (_) { hubDownNow(); paintStatus(); throw netErr('network'); }
    const j = await r.json().catch(() => null);
    // C11: a skewed device clock — learn the server time once and re-sign.
    if (!_retried && r.status === 401 && j && j.error === 'mesh_auth_stale' && window.OST_AUTH) {
      // (The fetch layer may already have learned the offset from this response.)
      const usedOffset = h.ts - sentAt;
      const moved = () => { try { return Math.abs(Number(OST_AUTH.clockOffset()) - usedOffset) > 30000; } catch (_) { return false; } };
      try { if (!moved() && typeof OST_AUTH.learnFrom === 'function') OST_AUTH.learnFrom(r, sentAt, Date.now()); } catch (_) {}
      try { if (!moved() && typeof OST_AUTH.learnClock === 'function') await OST_AUTH.learnClock(); } catch (_) {}
      if (moved()) return signed(method, pathq, body, true);
    }
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
    else if (m.t === 'typing' && m.from) { S.typingFrom[m.from] = Date.now(); onTypingChange(m.from); }
    else if (m.t === 'presence' && m.presence) { Object.assign(S.presence, m.presence); onPresence(); }
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
      .then((j) => { if (j && j.presence) { Object.assign(S.presence, j.presence); onPresence(); } }).catch(() => {});
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
      toast((pn || shortA(from)) + ' wants to connect', '', { avatar: from, onTap: () => { S.chatFilter = 'requests'; open('chats'); } });
      refreshLists();
      return true;
    }
    if (p.t === 'friend-accepted') {
      const c = contact(from);
      upsertContact(from, { state: 'friend', name: (c && c.name) || clipName(p.profile && p.profile.name), emoji: (c && c.emoji) || clipEmoji(p.profile && p.profile.emoji) });
      rememberSeen(item.id);
      try { await keyFor(from); } catch (_) {}
      toast(nameOf(from) + ' accepted — you are connected', '', { avatar: from, onTap: () => openChat(from) });
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
      upsertContact(from, { last: { text: previewOf(msg), ts: msg.ts, id: msg.id, kind: msg.kind }, unread: visible ? 0 : ((contact(from) || {}).unread || 0) + 1 });
      if (S.view === 'chat' && S.peer === from && appIsOpen()) {
        const pinned = isPinned(); paintMsgs();
        if (!pinned) { S.newBelow++; paintNewPill(); }
      }
      if (!visible) {
        const pv = previewOf(msg);
        if (unaccepted) { if (!c) toast(nameOf(from) + ' wants to message you', '', { avatar: from, onTap: () => { S.chatFilter = 'requests'; open('chats'); } }); }   // once, without the text
        else {
          if (!(S.view === 'chat' && S.peer === from && appIsOpen())) toast(nameOf(from), 'msg', { avatar: from, sub: pv.slice(0, 80), onTap: () => openChat(from) });
          if (!appIsOpen() || document.hidden) notifyMsg(from, pv);
        }
      }
      if (listShown()) paintChats();
      if (asideShown()) paintAside('friends');
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
    if (m.kind === 'file') return /^image\//.test(m.mime || '') ? 'Photo' : /^video\//.test(m.mime || '') ? 'Video' : (m.name || 'File');
    if (m.kind === 'loc') return m.live ? 'Live location' : 'Location';
    if (m.kind === 'pay') return (m.dir === 'me' ? 'Sent ' : 'Received ') + m.amount + ' ' + m.ccy + (m.note ? ' · ' + m.note : '');
    if (m.kind === 'call') { const s = callSt(m), k = m.video ? 'video' : 'voice'; return s === 'missed' ? (m.dir === 'me' ? 'No answer · ' + k + ' call' : 'Missed ' + k + ' call') : s === 'declined' ? 'Declined ' + k + ' call' : s === 'busy' ? 'Busy · ' + k + ' call' : (m.video ? 'Video' : 'Voice') + ' call'; }
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
    upsertContact(to, { last: { text: previewOf(m), ts: m.ts, id: m.id, kind: m.kind } });
    if (S.view === 'chat' && S.peer === to) paintMsgs(true);   // own send always jumps to the newest
    if (listShown()) paintChats();
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
  function markLast(a, id, fail) { const c = contact(a); if (c && c.last && c.last.id === id && !!c.last.fail !== fail) upsertContact(a, { last: Object.assign({}, c.last, { fail }) }); if (listShown()) paintChats(); }
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
    el.hidden = false; el.innerHTML = `${icon('live')}<span>Sharing live location · ${left >= 60 ? Math.floor(left / 60) + ' h ' + (left % 60) + ' min' : left + ' min'} left</span><button type="button" class="omx-textbtn" data-act="live-stop">Stop</button>`;
  }
  function lon2x(lng, z) { return (lng + 180) / 360 * Math.pow(2, z); }
  function lat2y(lat, z) { const r = lat * Math.PI / 180; return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * Math.pow(2, z); }
  function mapHtml(lat, lng) {
    const z = 15, x = lon2x(lng, z), y = lat2y(lat, z), tx = Math.floor(x), ty = Math.floor(y), px = (x - tx) * 256, py = (y - ty) * 256;
    const W = 260, Hh = 150, left = Math.round(W / 2 - 256 - px), top = Math.round(Hh / 2 - 256 - py);
    let tiles = '';
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) tiles += `<img alt="" loading="lazy" src="https://tile.openstreetmap.org/${z}/${tx + dx}/${ty + dy}.png" style="left:${(dx + 1) * 256}px;top:${(dy + 1) * 256}px">`;
    return `<div class="omx-map"><div class="omx-tiles" style="left:${left}px;top:${top}px">${tiles}</div><b class="omx-pin" aria-hidden="true">${icon('pin', 'is-on')}</b><small>© OpenStreetMap</small></div>`;
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
      toast((r && r.state === 'accepted') ? 'Connected with ' + nameOf(info.addr) : 'Request sent to ' + nameOf(info.addr) + (r && r.online ? ' (online now)' : ' — they get it when they open OST'), 'ok');
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
      toast(linked ? 'Connected with ' + nameOf(addr) : 'Accepted — you can chat with ' + nameOf(addr) + ' now', 'ok'); openChat(addr); askPresence(); return true;
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
        refreshLists();
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
    // retag(token, meta): a new meta for an entry; when it is the newest written entry and the current
    // history state, the state is rewritten in place (replaceState) — no new Back step.
    retag(token, meta) {
      const e = BK.stack.find((x) => x.token === token); if (!e) return false;
      e.meta = typeof meta === 'string' ? meta.slice(0, 80) : '';
      const top = BK.stack.filter((x) => x.written).pop();
      try { if (e.written && top === e && history.state && Number(history.state.omx) === token) bkWrite(e, true); } catch (_) {}
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

  /* ---------- sheets: ONE component, three presentations (contract C6), rendered in #omxSheet ----------
   * .pop   anchored popover — an anchor and a viewport >= 700 px (menus); no scrim, flips to stay on screen
   * .sheet bottom sheet     — viewports < 700 px; scrim, grabber, a separate Cancel row
   * .dlg   dialog           — no anchor, >= 700 px (confirms and forms); 10 vh from the top
   * .over  raises it above the lightbox / story viewer (12900, contract C5).
   * actionSheet(o) and confirm(o) keep their phase-1 signatures; o.anchor is optional. The placement
   * (placePop) and the mode rule (sheetMode) are exported so OST Social's #oslSheet uses the same rules. */
  let sheetEl = null, sheetDone = null, sheetOpener = null, sheetOff = null, sheetExitT = 0;
  const sheetMode = (anchor, kind) => window.innerWidth >= 700 ? (anchor && kind !== 'confirm' ? 'pop' : 'dlg') : 'sheet';
  // Below-end of the anchor with an 8 px gap (or the place asked for), flipped when it does not fit,
  // clamped 8 px inside the viewport, transform-origin toward the anchor. Layout sizes (offsetWidth),
  // so the enter animation's scale does not skew the measurement.
  function placePop(box, anchor, place) {
    if (!box || !anchor || !anchor.getBoundingClientRect) return;
    place = place || 'below-end';
    const r = anchor.getBoundingClientRect(), vw = window.innerWidth, vh = window.innerHeight, g = 8;
    box.style.left = '0px'; box.style.top = '0px'; box.style.right = 'auto'; box.style.bottom = 'auto';
    const w = box.offsetWidth, h = box.offsetHeight, start = /start/.test(place), above = /^above/.test(place);
    let left = start ? r.left : r.right - w;
    left = Math.max(8, Math.min(vw - w - 8, left));
    let top = above ? r.top - g - h : r.bottom + g;
    if (!above && top + h > vh - 8 && r.top - g - h >= 8) top = r.top - g - h;
    else if (above && top < 8 && r.bottom + g + h <= vh - 8) top = r.bottom + g;
    top = Math.max(8, Math.min(vh - h - 8, top));
    box.style.left = Math.round(left) + 'px'; box.style.top = Math.round(top) + 'px';
    box.style.setProperty('--omx-pop-origin', (top < r.top ? 'bottom ' : 'top ') + (start ? 'left' : 'right'));
  }
  // Arrow keys / Home / End move between the menu items of a box (role=menu semantics).
  function menuKeys(e, box) {
    if (!box || !/^(ArrowDown|ArrowUp|Home|End)$/.test(e.key)) return false;
    const items = Array.from(box.querySelectorAll('[role="menuitem"], .omx-mi')).filter((b) => !b.disabled && b.getClientRects().length);
    if (!items.length) return false;
    const i = items.indexOf(document.activeElement);
    const n = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : e.key === 'ArrowDown' ? (i + 1) % items.length : (i <= 0 ? items.length - 1 : i - 1);
    e.preventDefault(); try { items[n].focus({ preventScroll: true }); } catch (_) {}
    return true;
  }
  // The sheet's keys: Escape closes (returns true), arrows / Home / End move between items, Tab stays inside.
  function sheetKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); closeSheet(-1); return true; }
    const box = sheetEl.querySelector('.omx-box');
    if (menuKeys(e, box)) return false;
    if (e.key === 'Tab') {                                           // keep focus inside the sheet
      const f = Array.from(sheetEl.querySelectorAll('button, input, a[href]')).filter((b) => !b.disabled && b.getClientRects().length); if (!f.length) return false;
      const i = f.indexOf(document.activeElement);
      if (i < 0) { e.preventDefault(); (e.shiftKey ? f[f.length - 1] : f[0]).focus(); }
      else if (e.shiftKey && i === 0) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
    }
    return false;
  }
  // A sheet raised above the lightbox / story viewer (.over) is the top layer: it takes Escape, Tab and the
  // navigation keys before OST Social's overlay handler (window, capture phase) can hand them to the viewer
  // underneath (Escape closed the lightbox and left the sheet up). Registered when this module loads, so it
  // runs before social's listener. The call screen above everything keeps its own keys.
  window.addEventListener('keydown', (e) => {
    if (!sheetUp() || !sheetEl.classList.contains('over') || document.querySelector('#omxCall')) return;
    if (e.key === 'Escape' && e.isComposing) return;
    if (e.key === 'Escape' || e.key === 'Tab' || /^(ArrowUp|ArrowDown|ArrowLeft|ArrowRight|Home|End| )$/.test(e.key) || sheetEl.contains(e.target)) { e.stopImmediatePropagation(); sheetKey(e); }
  }, true);
  function sheetMount() {
    if (sheetEl && sheetEl.isConnected) return sheetEl;
    sheetEl = $('omxSheet') || document.createElement('div'); sheetEl.id = 'omxSheet';
    if (!sheetEl.isConnected) document.body.appendChild(sheetEl);
    sheetEl.addEventListener('click', (e) => { if (e.target === sheetEl) { closeSheet(-1); return; } const b = e.target.closest('[data-v]'); if (b && sheetEl.contains(b)) closeSheet(Number(b.getAttribute('data-v'))); });
    sheetEl.addEventListener('keydown', (e) => { if (sheetKey(e)) e.stopPropagation(); });
    // a popover has no scrim: scrolling the page under it closes it (the layer would otherwise swallow the wheel)
    sheetEl.addEventListener('wheel', () => { if (sheetEl.classList.contains('pop')) closeSheet(-1); }, { passive: true });
    return sheetEl;
  }
  const sheetUp = () => !!(sheetEl && sheetEl.classList.contains('on') && !sheetEl.classList.contains('closing'));
  // items: [{label, sub?, danger?, ico?, tile?, value?}]; opts: {anchor, place, cls, note, noteIco, kind:'confirm', mode}
  function showSheet(title, text, items, cancelLabel, opts) {
    opts = opts || {}; items = items || [];
    closeSheet(-1, true);                                            // one sheet at a time
    const el = sheetMount();
    clearTimeout(sheetExitT);
    return new Promise((resolve) => {
      const ae = document.activeElement;
      sheetOpener = ae && ae !== document.body && !el.contains(ae) ? ae : (opts.anchor || null);
      const confirmKind = opts.kind === 'confirm';
      const anchor = opts.anchor && opts.anchor.isConnected && opts.anchor.getClientRects().length ? opts.anchor : null;
      const mode = opts.mode || sheetMode(anchor, opts.kind);
      const over = !!document.querySelector('#oslLight.on, #oslStory.on');
      let h = '';
      if (mode === 'sheet') h += '<div class="grab" aria-hidden="true"></div>';
      if (title) h += `<h3 id="omxSheetT">${esc(title)}</h3>`;
      if (text) h += `<p id="omxSheetB">${esc(text)}</p>`;
      if (confirmKind) {
        const it = items[0] || { label: 'OK' };
        h += `<div class="omx-askrow"><button type="button" class="omx-ghost" data-v="-1">${esc(cancelLabel || 'Cancel')}</button><button type="button" class="omx-primary${it.danger ? ' omx-danger' : ''}" data-v="0">${esc(it.label)}</button></div>`;
      } else {
        let rows = '', sawDanger = false;
        items.forEach((it, i) => {
          if (it.danger && !sawDanger && i > 0 && mode === 'pop') rows += '<hr>';
          if (it.danger) sawDanger = true;
          const lead = it.tile != null ? `<span class="tile" style="--tile:${/^\d+$/.test(String(it.tile)) ? 'var(--omx-id-' + (Number(it.tile) % 12) + ')' : esc(it.tile)}" aria-hidden="true">${icon(it.ico) || ''}</span>` : (it.ico ? icoOrText(it.ico) : '');
          rows += `<button type="button" class="omx-mi${it.danger ? ' danger' : ''}" role="menuitem" data-v="${i}">${lead}<span>${esc(it.label)}${it.sub ? `<small>${esc(it.sub)}</small>` : ''}</span></button>`;
        });
        h += `<div class="grp"${mode === 'pop' ? '' : ' role="menu"'}>${rows}</div>`;
        if (opts.note) h += `<div class="omx-boxnote">${icon(opts.noteIco || 'lock')}<span>${esc(opts.note)}</span></div>`;
        if (mode === 'sheet') h += `<button type="button" class="omx-cancel" data-v="-1">${esc(cancelLabel || 'Cancel')}</button>`;
      }
      const role = mode === 'pop' ? `role="menu" aria-label="${esc(title || 'Options')}"` : `role="${confirmKind ? 'alertdialog' : 'dialog'}" aria-modal="true"${title ? ' aria-labelledby="omxSheetT"' : ` aria-label="Options"`}${text ? ' aria-describedby="omxSheetB"' : ''}`;
      el.className = 'on ' + mode + (over ? ' over' : '');
      el.innerHTML = `<div class="omx-box${opts.cls ? ' ' + esc(opts.cls) : ''}" ${role} tabindex="-1">${h}</div>`;
      const box = el.firstElementChild;
      if (mode === 'pop') {
        placePop(box, anchor, opts.place);
        const off = () => closeSheet(-1), sc = scroller();
        if (sc) sc.addEventListener('scroll', off, { passive: true });
        window.addEventListener('resize', off);
        sheetOff = () => { if (sc) sc.removeEventListener('scroll', off); window.removeEventListener('resize', off); };
      }
      if (mode === 'sheet') document.documentElement.classList.add('omx-sheeton');   // phones: toasts move off the sheet's rows
      sheetDone = (i) => resolve(i >= 0 && items[i] ? items[i] : null);
      setTimeout(() => {
        try {
          if (!sheetUp() || el.firstElementChild !== box) return;
          const first = confirmKind ? box.querySelector(items[0] && items[0].danger ? '.omx-askrow .omx-ghost' : '.omx-askrow .omx-primary') : box.querySelector('.omx-mi');
          (first || box).focus({ preventScroll: true });
        } catch (_) {}
      }, 30);
    });
  }
  function closeSheet(i, immediate) {
    if (!sheetEl || !sheetEl.classList.contains('on')) return;
    clearTimeout(sheetExitT);
    if (sheetEl.classList.contains('closing')) { sheetEl.classList.remove('on', 'closing'); return; }   // already resolved; finish the exit now
    if (sheetOff) { sheetOff(); sheetOff = null; }
    document.documentElement.classList.remove('omx-sheeton');
    const done = sheetDone; sheetDone = null;
    const box = sheetEl.querySelector('.omx-box');
    if (!immediate && sheetEl.classList.contains('pop') && box && !reducedMotion()) {
      sheetEl.classList.add('closing'); box.classList.add('closing');
      sheetExitT = setTimeout(() => { sheetEl.classList.remove('on', 'closing'); }, 160);
    } else sheetEl.classList.remove('on', 'closing');
    if (sheetOpener && sheetOpener.isConnected) { try { sheetOpener.focus({ preventScroll: true }); } catch (_) {} }
    sheetOpener = null;
    if (done) done(i);
  }
  // actionSheet({title, body, items:[{label, sub?, danger?, ico?, tile?, value}], anchor?, cls?, note?, place?}) -> Promise<value|null>
  function actionSheet(o) { o = o || {}; const items = (o.items || []).filter(Boolean); return showSheet(o.title, o.body, items, o.cancel, { anchor: o.anchor, place: o.place, cls: o.cls, note: o.note, noteIco: o.noteIco, mode: o.mode }).then((it) => (it ? (it.value !== undefined ? it.value : it.label) : null)); }
  // confirm({title, body, ok, danger, cancel?}) -> Promise<boolean>: a dialog >= 700 px (Cancel left, action right), a sheet below
  function confirmSheet(o) { o = o || {}; return showSheet(o.title, o.body, [{ label: o.ok || 'OK', danger: !!o.danger }], o.cancel, { kind: 'confirm', mode: o.mode }).then((it) => !!it); }

  /* ---------- the app shell (one DOM, three bands) ---------- */
  let root, shellEl, railEl, paneEl, mainEl, headEl, body, asideEl, infoEl, tabsEl;
  const CORE_VIEWS = ['chats', 'add', 'me', 'settings', 'chat'];
  const SESSION_KEY = 'omx.session.v1', DRAFT_KEY = 'omx.drafts.v1';
  function homeView() { const k = Object.keys(X.views).find((v) => X.views[v].tab && X.views[v].tab.home); return k || 'chats'; }
  function saveSession() { ssSet(SESSION_KEY, { open: appIsOpen(), view: S.view, peer: S.view === 'chat' ? S.peer : null, path: location.pathname, at: Date.now() }); }
  // Bands (contract C8): computed from three media queries, written as data-layout / data-band on the root;
  // JS and CSS read the same attribute. render() runs only when the band value changes, never per resize.
  const MQ = {};
  function bandNow() {
    const phone = mq('(max-width: 599.98px)'), desk = mq('(min-width: 1100px)');
    const L = phone ? 'phone' : desk ? 'desk' : 'drawer';
    return { layout: L, band: L === 'desk' ? (mq('(min-width: 1280px)') ? 'full' : 'compact') : '' };
  }
  function applyBand() {
    if (!root) return false;
    const b = bandNow(), changed = root.getAttribute('data-layout') !== b.layout || (root.getAttribute('data-band') || '') !== b.band;
    if (changed) { root.setAttribute('data-layout', b.layout); if (b.band) root.setAttribute('data-band', b.band); else root.removeAttribute('data-band'); }
    return changed;
  }
  const layout = () => (root && root.getAttribute('data-layout')) || bandNow().layout;
  const band = () => (root && root.getAttribute('data-band')) || '';
  const chatLayout = () => !!(root && root.classList.contains('omx-chatlayout'));
  // The element that scrolls the current main view: the full-width shell on desk outside Chats, else #omxBody.
  const scroller = () => (root && layout() === 'desk' && !chatLayout() ? shellEl : body) || null;
  const listShown = () => !!$('omxChats');
  const asideShown = () => !!(root && appIsOpen() && layout() === 'desk' && !chatLayout());
  function onBand() {
    const changed = applyBand();
    if (changed) { if (appIsOpen()) { closeSheet(-1, true); render(); } else placeToasts(); }
  }
  function mount() {
    if ($('ostMeshApp')) return;
    root = document.createElement('div'); root.id = 'ostMeshApp';
    root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-labelledby', 'omxTitle'); root.setAttribute('aria-label', 'OST Mesh'); root.tabIndex = -1;
    root.innerHTML = '<div class="omx-shell"><nav id="omxRail" class="omx-rail" aria-label="OST Mesh"></nav><section id="omxPane" class="omx-pane" aria-label="Chats"></section>' +
      '<main id="omxMain" class="omx-view"><div class="omx-head" id="omxHead"></div><div class="omx-body" id="omxBody"></div></main>' +
      '<aside id="omxAside" class="omx-aside" aria-label="Highlights"></aside><aside id="omxInfo" class="omx-info" aria-label="Contact info"></aside>' +
      '<nav id="omxTabs" class="omx-tabs" aria-label="OST Mesh sections"></nav></div>';
    document.body.appendChild(root);
    shellEl = root.firstElementChild; railEl = $('omxRail'); paneEl = $('omxPane'); mainEl = $('omxMain');
    headEl = $('omxHead'); body = $('omxBody'); asideEl = $('omxAside'); infoEl = $('omxInfo'); tabsEl = $('omxTabs');
    // The icon sprite, once, zero-size (NOT display:none, so <use> resolves in every family root).
    if (!$('omxSprite')) document.body.insertAdjacentHTML('beforeend', SPRITE);
    try { if (navigator.deviceMemory && navigator.deviceMemory <= 4) document.documentElement.classList.add('omx-lowfx'); } catch (_) {}
    applyBand();
    ['(max-width: 599.98px)', '(min-width: 1100px)', '(min-width: 1280px)'].forEach((q) => {
      try { const m = window.matchMedia(q); MQ[q] = m; if (m.addEventListener) m.addEventListener('change', onBand); else if (m.addListener) m.addListener(onBand); } catch (_) {}
    });
    // The backdrop closes the app only in the drawer band (the desk shell covers the whole screen).
    root.addEventListener('click', (e) => { if (e.target === root && root.getAttribute('data-layout') === 'drawer') close(); });
    root.addEventListener('click', onClick);
    root.addEventListener('change', onChange);
    root.addEventListener('input', onInput);
    root.addEventListener('keydown', onRootKey);
    root.addEventListener('animationend', (e) => { if (e.target === root || e.target === shellEl) root.classList.remove('entering'); });
    body.addEventListener('scroll', onBodyScroll, { passive: true });
    try { if (window.ResizeObserver) new ResizeObserver(setAsideTop).observe(asideEl); } catch (_) {}
    window.addEventListener('resize', () => { setAsideTop(); placeToasts(); }, { passive: true });
  }
  // Sticky right column: it scrolls with the page until its bottom shows, then sticks.
  function setAsideTop() {
    if (!root || !asideEl) return;
    const v = Math.min(0, window.innerHeight - (asideEl.offsetHeight || 0)) + 'px';
    if (root.style.getPropertyValue('--omx-aside-top') !== v) root.style.setProperty('--omx-aside-top', v);
  }
  // Phone feed (views registered with hideHead): the 56 px header slides away on scroll-down and back on
  // scroll-up. Never on desk, never under reduced motion.
  let hhTop = 0;
  function onBodyScroll() {
    const top = body.scrollTop;
    if (!mainEl.classList.contains('hide-head') || layout() !== 'phone' || reducedMotion()) { hhTop = top; if (mainEl.classList.contains('head-away')) mainEl.classList.remove('head-away'); return; }
    const d = top - hhTop;
    if (top <= 56) { mainEl.classList.remove('head-away'); hhTop = top; return; }
    if (Math.abs(d) <= 8) return;
    mainEl.classList.toggle('head-away', d > 0);
    hhTop = top;
  }
  // The app family (contract C1) and the site's own dialogs (which sit above the app and own their keys).
  const FAMILY = '#ostMeshApp, #oslSheet, #oslLight, #oslStory, #omxSheet, #omxCall, .omx-toasts';
  const SITE_DIALOG = '[aria-modal="true"], [role="dialog"], [role="alertdialog"], dialog[open]';
  const overlayUp = () => !!document.querySelector('#oslSheet.on, #oslLight.on, #oslStory.on, #omxSheet.on:not(.closing), #omxCall');
  const inSiteDialog = (t) => !!(t && t.nodeType === 1 && t.closest && !t.closest(FAMILY) && t.closest(SITE_DIALOG));
  // Escape (contract C3): document level, capture phase, so it works wherever focus is; overlays of the
  // app family (sheets, lightbox, story, call) handle their own. Order: popover / sheet → contact-info
  // pane → chat → inner view → app.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.defaultPrevented || e.isComposing) return;
    // #omxSheet handles its own Escape; this covers focus having left the sheet (it is the top overlay only
    // while no social overlay / call screen sits above it).
    if (sheetUp() && !sheetEl.contains(e.target) && !document.querySelector('#oslSheet.on, #oslLight.on, #oslStory.on, #omxCall')) { e.preventDefault(); closeSheet(-1); return; }
    if (!appIsOpen() || overlayUp()) return;
    if (inSiteDialog(e.target)) return;                              // a site dialog opened above the app
    e.preventDefault();
    const q = $('omxChatQ');
    if (q && (S.chatQuery || (e.target === q && q.value))) { S.chatSearching = false; S.chatQuery = ''; q.value = ''; paintChatRows(); return; }   // the search first
    if (root.classList.contains('info-open')) { toggleInfo(false); const b = headEl.querySelector('[data-act="peer-info"]'); if (b) { try { b.focus({ preventScroll: true }); } catch (_) {} } return; }
    const sxBack = S.view !== 'chat' && headEl && headEl.querySelector('[data-act="sx-back"]');
    if (S.view === 'chat') leaveChat(); else if (sxBack) sxBack.click(); else close();
  }, true);
  // Focus containment for the modal app (aria-modal): Tab / Shift+Tab wrap inside it (rail, pane and aside
  // included; tappable toasts too), and focus that reaches the page behind is brought back.
  function tabbables() {
    const list = Array.from(root.querySelectorAll('a[href], button, input, textarea, select, video[controls], audio[controls], [tabindex]'))
      .concat(Array.from(document.querySelectorAll('.omx-toasts .omx-toast.tap:not(.out), .omx-toasts .omx-toast:not(.out) button')));
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
    applyBand();                                                     // the band first, then the first render
    root.classList.add('open'); document.documentElement.classList.add('omx-lock');
    if (!wasOpen) {
      // drawer: 260 ms slide-in; desk: 200 ms fade (removed on animationend; a timer covers reduced motion)
      root.classList.add('entering'); setTimeout(() => { if (root) root.classList.remove('entering'); }, 400);
    }
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
    stopScan(); closeSheet(-1, true);
    if (root) { root.classList.remove('open', 'entering', 'info-open'); if (mainEl) mainEl.classList.remove('head-away'); if (infoEl) infoEl.innerHTML = ''; }
    document.documentElement.classList.remove('omx-lock');
    const t = S.backApp; S.backApp = 0; S.backChat = 0;
    if (t && !fromBack) back.pop(t);                                 // also drops the chat entry above it
    S.view = homeView(); S.viewIsDefault = true; S.peer = null; S.newBelow = 0; S.unreadFrom = null; S.chatSearching = false; S.chatQuery = '';
    lastKey = '';
    if (msgRO) { msgRO.disconnect(); msgRO = null; }
    saveSession(); placeToasts();
    if (wasOpen && S.opener && S.opener.isConnected) { try { S.opener.focus({ preventScroll: true }); } catch (_) {} }
    S.opener = null;
  }
  // Desk: leaving a chat lands on the Chats pick state (same code path as phones).
  function leaveChat(fromBack) {
    const t = S.backChat; S.backChat = 0;
    if (t && !fromBack) back.pop(t);
    closeSheet(-1, true);                                            // a chat ⋯ sheet must not outlive its chat
    S.view = S.backTo && S.backTo !== 'chat' ? S.backTo : 'chats'; S.backTo = null; S.peer = null; S.newBelow = 0; S.viewIsDefault = false; S.unreadFrom = null;
    if (root) root.classList.remove('info-open');
    if (body) body.style.padding = '';
    if (msgRO) { msgRO.disconnect(); msgRO = null; }
    render();
  }

  /* ---------- navigation: rail (desk) and tab bar (phone / drawer) from ONE model ----------
   * core items: chats 20, add 30, me 40, settings 60 (rail only) + plugin views with tab {ico, lbl, order,
   * home?, railLbl?, avatar?} or rail {ico, lbl, order} (rail-only, e.g. Alerts). An unknown ico (an old
   * plugin's emoji) renders as text. Active = aria-current="page" + solid icon + bold label. */
  const reqCount = () => Object.values(S.contacts).filter((c) => c && (c.state === 'pending-in' || c.state === 'request')).length;
  function navModel() {
    const items = [
      { v: 'chats', ico: 'chat', lbl: 'Chats', railLbl: 'Chats', tabOrder: 20, railOrder: 20, tab: true, rail: true },
      { v: 'add', ico: 'user-plus', lbl: 'Add', railLbl: 'Add people', tabOrder: 30, railOrder: 30, tab: true, rail: true },
      { v: 'me', ico: 'user', lbl: 'Me', railLbl: 'Profile', tabOrder: 40, railOrder: 40, tab: true, rail: true, avatar: true },
      { v: 'settings', ico: 'settings', lbl: 'Settings', railLbl: 'Settings', tabOrder: 60, railOrder: 60, tab: false, rail: true }
    ];
    Object.keys(X.views).forEach((k) => {
      const d = X.views[k] || {}, t = d.tab, r = d.rail; if (!t && !r) return;
      const i = items.findIndex((x) => x.v === k), base = i >= 0 ? items[i] : null, src = t || r;
      const row = {
        v: k, ico: src.ico || (base && base.ico) || '', lbl: (t && t.lbl) || (base && base.lbl) || src.lbl || k,
        railLbl: (t && t.railLbl) || (r && r.lbl) || (base && base.railLbl) || src.lbl || k,
        tabOrder: Number(t && t.order) || (base ? base.tabOrder : 50), railOrder: Number((r && r.order) || (t && t.order)) || (base ? base.railOrder : 50),
        tab: !!t || !!(base && base.tab && !r), rail: true, home: !!(t && t.home),
        avatar: src.avatar != null ? !!src.avatar : !!(base && base.avatar)
      };
      if (i >= 0) items[i] = row; else items.push(row);
    });
    items.forEach((it) => { it.badge = navBadge(it.v); });
    return items;
  }
  function navBadge(v) {
    if (v === 'chats') return totalUnread() + reqCount();
    try { return X.badges[v] ? Math.max(0, Number(X.badges[v]()) || 0) : 0; } catch (_) { return 0; }
  }
  // The item that is "where you are" in a given nav (a rail-only item wins on the rail; parents otherwise).
  function activeIn(items) {
    const has = (v) => items.some((x) => x.v === v);
    if (has(S.view)) return S.view;
    if (S.view === 'chat') return 'chats';
    let p = X.views[S.view] && X.views[S.view].parent, n = 0;
    while (p && n++ < 5) { if (has(p)) return p; p = X.views[p] && X.views[p].parent; }
    if (S.view === 'settings' || S.view === 'edit') return has('me') ? 'me' : '';
    return '';
  }
  const navLabel = (lbl, n) => lbl + (n ? ', ' + n + ' new' : '');
  const badgeHtml = (n) => n ? `<span class="omx-badge" aria-hidden="true">${n > 99 ? '99+' : n}</span>` : '';
  function navItemHtml(it, host, act) {
    const on = it.v === act, lbl = host === 'rail' ? it.railLbl : it.lbl;
    const ic = it.avatar ? avHtml(S.address) : icoOrText(it.ico, on ? 'is-on' : '');
    return `<button type="button" data-tab="${esc(it.v)}"${on ? ' aria-current="page"' : ''} aria-label="${esc(navLabel(lbl, it.badge))}"${host === 'rail' ? ` title="${esc(lbl)}"` : ''}>${ic}<span>${esc(lbl)}</span>${badgeHtml(it.badge)}</button>`;
  }
  const navSig = {};
  function railHtml(items, act) {
    const rail = items.filter((x) => x.rail).sort((a, b) => a.railOrder - b.railOrder);
    const canPost = typeof X.compose === 'function' || !!X.views.compose;
    const nm = (S.profile && S.profile.name) || '';
    return `<div class="omx-brand"><span class="omx-brandmark" aria-hidden="true">${icon('logo')}</span><b>Mesh</b>${devnetChip()}<button type="button" class="omx-ib md" data-act="close" aria-label="Close Mesh (Esc)" title="Close Mesh (Esc)">${icon('close')}</button></div>` +
      rail.map((it) => navItemHtml(it, 'rail', act)).join('') +
      (canPost ? `<button type="button" class="omx-primary omx-lg omx-rail-post" data-act="nav-post" aria-label="New post" title="New post">${icon('pen')}<span>Post</span></button>` : '') +
      `<div class="omx-rail-sp"></div><button type="button" class="omx-rail-me" data-act="account-menu" aria-label="Account menu" aria-haspopup="menu" title="${esc(nm || 'Account')}">${avHtml(S.address)}<span class="t"><b>${esc(nm || 'Set your name')}</b><small>${esc(shortA(S.address))}</small></span>${icon('more')}</button>`;
  }
  function tabsHtml(items, act) {
    return items.filter((x) => x.tab).sort((a, b) => a.tabOrder - b.tabOrder).map((it) => navItemHtml(it, 'tabs', act)).join('');
  }
  // Rebuild a nav only when its items change; otherwise update the active state and badges in place
  // (no innerHTML of the nav, so focus and transitions survive).
  function paintNavHost(host, kind, items) {
    if (!host) return;
    const act = activeIn(items.filter((x) => kind === 'rail' ? x.rail : x.tab));
    const sig = JSON.stringify(items.map((x) => [x.v, x.ico, x.lbl, x.railLbl, x.tab, x.rail, x.avatar, x.tabOrder, x.railOrder])) + '|' + (kind === 'rail' ? [typeof X.compose === 'function' || !!X.views.compose, S.profile && S.profile.name, S.profile && S.profile.emoji, S.profile && S.profile.avatar, S.address, netName()].join('|') : (S.profile && S.profile.emoji) + '|' + (S.profile && S.profile.avatar) + '|' + S.address);
    if (navSig[kind] !== sig || !host.firstElementChild) { navSig[kind] = sig; host.innerHTML = kind === 'rail' ? railHtml(items, act) : tabsHtml(items, act); return; }
    host.querySelectorAll('button[data-tab]').forEach((b) => {
      const v = b.getAttribute('data-tab'), it = items.find((x) => x.v === v); if (!it) return;
      const on = v === act, lbl = kind === 'rail' ? it.railLbl : it.lbl;
      if (on) { if (b.getAttribute('aria-current') !== 'page') b.setAttribute('aria-current', 'page'); } else if (b.hasAttribute('aria-current')) b.removeAttribute('aria-current');
      const ic = b.querySelector(':scope > svg.omx-i'); if (ic) ic.classList.toggle('is-on', on);
      let bd = b.querySelector(':scope > .omx-badge');
      if (it.badge) { const tx = it.badge > 99 ? '99+' : String(it.badge); if (!bd) { b.insertAdjacentHTML('beforeend', badgeHtml(it.badge)); } else if (bd.textContent !== tx) bd.textContent = tx; }
      else if (bd) bd.remove();
      const al = navLabel(lbl, it.badge); if (b.getAttribute('aria-label') !== al) b.setAttribute('aria-label', al);
    });
  }
  // core.paintNav(): badges (and the active item) in both navs, in place; then the unread event (C2).
  function paintNav() {
    if (root) {
      const items = navModel();
      if (layout() === 'desk') paintNavHost(railEl, 'rail', items); else paintNavHost(tabsEl, 'tabs', items);
    }
    syncUnread();
  }
  const paintBadge = paintNav;

  /* ---------- connection: a dot next to the Chats title; a banner ONLY when something is wrong ---------- */
  // What the connection really is. "Offline" only when the browser says so; "Connected (polling)" when the
  // mailbox poll works without a socket; never "Connecting…" past the first seconds.
  function netState() {
    if (navigator.onLine === false) return { cls: 'off', txt: 'Offline — will send when you are back' };
    if (hubBusy()) return { cls: 'warn', txt: 'Hub busy — retrying in ' + busySecs() + ' s' };
    if (S.wsOk) return { cls: 'on', txt: 'Connected · end-to-end encrypted' };
    // Polling counts only while it is the newest news: a failed hub call since the last good poll means trouble.
    if (S.pollOkAt && S.pollOkAt > (S.netErrAt || 0) && Date.now() - S.pollOkAt < 60000) return { cls: 'on', txt: 'Connected (polling) · end-to-end encrypted' };
    if (S.announceErr && !/^(offline|rate_limited)$/.test(S.announceErr) && !/^http_5/.test(S.announceErr)) return { cls: 'off', txt: explain(S.announceErr), refused: true };
    if (Date.now() - S.bootAt < 12000 && !S.netErrAt) return { cls: '', txt: 'Connecting…' };
    return { cls: 'off', txt: 'Can\'t reach the hub — retrying' };
  }
  const connCls = (n) => 'omx-conn' + (n.cls === 'on' ? '' : n.cls === 'off' ? ' off' : ' warn');
  function connDot() { const n = netState(); return `<span class="${connCls(n)}" role="img" aria-label="${esc(n.txt)}" title="${esc(n.txt)}"></span>`; }
  function netTrouble() {
    if (navigator.onLine === false) return { k: 'off', ico: 'wifi-off', txt: 'You’re offline · messages send when you’re back', retry: false };
    if (hubBusy()) return { k: 'busy', ico: 'clock', txt: 'Hub busy · retrying in ' + busySecs() + ' s', retry: true };
    const n = netState();
    if (n.cls === 'off') return n.refused ? { k: 'refused', ico: 'alert', txt: n.txt, retry: true } : { k: 'down', ico: 'alert', txt: 'Can’t reach the hub · retrying', retry: true };
    return null;
  }
  const netBarHtml = (n) => { n = n === undefined ? netTrouble() : n; return n ? `<div class="omx-netbar" role="status" data-k="${n.k}">${icon(n.ico)}<span>${esc(n.txt)}</span>${n.retry ? '<button type="button" class="omx-textbtn" data-act="net-retry">Retry now</button>' : ''}</div>` : ''; };
  // Where a banner belongs right now: the chats list (pane or body); a thread on phones; any other view only offline.
  function netSlots(n) {
    const out = [], list = $('omxChats');
    if (list) out.push(list);
    if (n && body && appIsOpen() && !list) {
      if (S.view === 'chat' && layout() !== 'desk') out.push(body);
      else if (n.k === 'off' && S.view !== 'chat' && !chatLayout()) out.push(body);
    }
    return out;
  }
  function paintStatus() {
    if (!root) return;
    const n0 = netState(), cc = connCls(n0);
    root.querySelectorAll('.omx-conn').forEach((d) => { if (d.getAttribute('class') !== cc) d.setAttribute('class', cc); if (d.getAttribute('aria-label') !== n0.txt) { d.setAttribute('aria-label', n0.txt); d.title = n0.txt; } });
    const n = netTrouble(), slots = netSlots(n);
    root.querySelectorAll('.omx-netbar').forEach((b) => { if (!n || !slots.includes(b.parentElement)) b.remove(); });
    if (!n) return;
    slots.forEach((slot) => {
      const b = slot.querySelector(':scope > .omx-netbar');
      if (b && b.getAttribute('data-k') === n.k) { const sp = b.querySelector('span'); if (sp && sp.textContent !== n.txt) sp.textContent = n.txt; return; }
      if (b) b.remove();
      const lh = slot.querySelector(':scope > .omx-lhead');
      if (lh) lh.insertAdjacentHTML('afterend', netBarHtml(n)); else slot.insertAdjacentHTML('afterbegin', netBarHtml(n));
    });
  }
  // "Retry now": one real attempt at once, even while the breaker waits (it re-opens if the hub is still busy).
  function netRetry() {
    NET.until = 0; S.netErrAt = 0;
    if (!S.announced) announce().catch(() => {});
    wsKick(); syncInbox(); flushOutbox(true); askPresence();
    paintStatus();
  }

  /* ---------- render orchestration ---------- */
  // Every header has an h2#omxTitle (the dialog's accessible name), on every render, in every band.
  function labelHead() {
    try {
      if (!headEl) return;
      const t = $('omxTitle'), h = headEl.querySelector('h2');
      if (h) { if (h.id !== 'omxTitle') { if (t && t !== h) t.removeAttribute('id'); h.id = 'omxTitle'; } return; }
      const text = (t && headEl.contains(t) ? t.textContent : '') || viewLabel(S.view);
      if (t) t.removeAttribute('id');
      headEl.insertAdjacentHTML('afterbegin', `<h2 id="omxTitle" class="omx-sr">${esc(text)}</h2>`);
    } catch (_) {}
  }
  function viewLabel(v) {
    if (v === 'chat') return nameOf(S.peer);
    const core = { chats: 'Chats', add: 'Add people', me: 'Me', settings: 'Settings' };
    const d = X.views[v]; const t = d && (d.tab || d.rail || (X.views[d.parent] && (X.views[d.parent].tab || X.views[d.parent].rail)));
    return (t && (t.railLbl || t.lbl)) || core[v] || 'OST Mesh';
  }
  const closeBtn = () => `<button type="button" class="omx-ib" data-act="close" aria-label="Close Mesh">${icon('close')}</button>`;
  let lastKey = '', renderCount = 0;
  function render() {
    if (!root) return;
    renderCount++;
    applyBand();
    if (S.view !== 'add') stopScan();
    if (S.view === 'chat' && !S.peer) S.view = 'chats';
    if (S.view !== 'chat' && S.backChat) { const t = S.backChat; S.backChat = 0; back.pop(t); }   // left the chat some other way
    if (!X.views[S.view] && !CORE_VIEWS.includes(S.view)) { const h = homeView(); S.view = X.views[h] || h === 'chats' ? h : 'chats'; }
    if (S.view !== 'chat') { S.unreadFrom = null; if (S.view !== 'chats') { S.chatSearching = false; S.chatQuery = ''; } }
    saveSession();
    const L = layout(), desk = L === 'desk', cl = desk && (S.view === 'chats' || S.view === 'chat');
    const v = X.views[S.view];
    root.setAttribute('data-view', S.view);
    root.classList.toggle('omx-chatlayout', cl);
    if (!cl || S.view !== 'chat') { root.classList.remove('info-open'); if (infoEl.firstChild) infoEl.innerHTML = ''; }
    const key = S.view + '|' + (S.view === 'chat' ? S.peer : '') + '|' + (S.profileOf || '');
    const changed = key !== lastKey; lastKey = key;
    mainEl.classList.toggle('hide-head', L === 'phone' && !!(v && v.hideHead));
    if (changed) { mainEl.classList.remove('head-away'); hhTop = 0; }
    if (msgRO && S.view !== 'chat') { msgRO.disconnect(); msgRO = null; }
    // nav: the rail on desk, the tab bar on phones and in the drawer (hidden in a chat and in the composer)
    const items = navModel();
    if (desk) paintNavHost(railEl, 'rail', items); else { paintNavHost(tabsEl, 'tabs', items); if (railEl.firstChild) { railEl.innerHTML = ''; navSig.rail = ''; } }
    tabsEl.hidden = !desk && (S.view === 'chat' || S.view === 'compose' || !!(v && v.noTabs));
    if (!cl && paneEl.firstChild) paneEl.innerHTML = '';
    if (changed) { const sc = scroller(); if (sc) sc.scrollTop = 0; if (cl && shellEl) shellEl.scrollTop = 0; }
    body.style.padding = '';
    headEl.className = 'omx-head';
    if (cl) paintPane();
    if (S.view === 'chat') renderChat();
    else if (cl) renderPick();
    else if (v) renderPlugin(v);
    else if (S.view === 'chats') renderChatsView();
    else if (S.view === 'add') renderAdd();
    else if (S.view === 'settings') renderSettings(false);
    else renderSettings(true);                                      // 'me' without OST Social: identity + the name / emoji editor
    labelHead();
    if (changed) { body.classList.remove('omx-enter'); void body.offsetWidth; body.classList.add('omx-enter'); }
    if (desk && !cl) paintAside(); else if (asideEl.firstChild) asideEl.innerHTML = '';
    placeToasts();
    paintStatus();
  }
  function renderPlugin(v) {
    body.className = 'omx-body omx-v-' + S.view;
    headEl.innerHTML = `<h2 id="omxTitle">${esc(viewLabel(S.view))}</h2>${layout() === 'desk' ? '' : closeBtn()}`;
    try { v.render({ head: headEl, body, tabs: tabsEl, layout: layout(), band: band(), icon, av: avHtml }); }
    catch (e) {
      console.warn('[mesh-app] view failed', S.view, e);
      body.innerHTML = `<div class="omx-empty err" role="alert"><span class="ic">${icon('alert')}</span><h3>This view failed to load</h3><p>Something went wrong while showing this screen. Your chats are not affected.</p><button type="button" class="omx-ghost" data-tab="chats">${icon('chat')}Open chats</button></div>`;
    }
  }

  /* ---------- right column (desk feed layout): plugin modules ----------
   * X.aside.push({ id, order, views: string[] | (v) => bool, render: (ctx) => html }); a module returns ''
   * to hide itself. The core adds the search pill (first), Friends' activity (order 20) and the footer (last). */
  const CORE_ASIDE = [{ id: 'friends', order: 20, views: (v) => v !== 'profile' && v !== 'edit', render: () => friendsModHtml() }];
  const asideMods = () => CORE_ASIDE.concat(X.aside.filter((m) => m && typeof m.render === 'function')).filter((m) => {
    try { return !m.views ? true : typeof m.views === 'function' ? !!m.views(S.view) : Array.isArray(m.views) ? m.views.includes(S.view) : true; } catch (_) { return false; }
  }).sort((a, b) => (Number(a.order) || 50) - (Number(b.order) || 50));
  const asideCtx = () => ({ view: S.view, layout: layout(), band: band(), icon, av: avHtml, esc, profileOf: S.profileOf || null });
  function modHtml(m) { let h = ''; try { h = String(m.render(asideCtx()) || ''); } catch (e) { console.warn('[mesh-app] aside module failed', m.id, e); } return `<div class="omx-modhost" data-mod="${esc(m.id || '')}">${h}</div>`; }
  // core.paintAside(id?): repaint the whole column, or one module in place.
  function paintAside(id) {
    if (!asideEl || !asideShown()) return;
    if (id) {
      const host = asideEl.querySelector(`.omx-modhost[data-mod="${CSS && CSS.escape ? CSS.escape(String(id)) : String(id)}"]`);
      const m = asideMods().find((x) => x.id === id);
      if (host && m) { const tmp = document.createElement('div'); tmp.innerHTML = modHtml(m); host.replaceWith(tmp.firstElementChild); setAsideTop(); return; }
      if (!host && !m) return;
    }
    const search = (X.actions['sx-search'] || X.views.search) ? `<button type="button" class="omx-search" data-act="sx-search" aria-label="Search people">${icon('search')}Search people</button>` : '';
    const foot = `<p class="omx-foot">${isDevnet() ? `<span class="omx-devnet">${esc(netName())}</span>OST Mesh runs on ${esc(netName())}. ` : ''}Posts are public and signed with your key; chats are end-to-end encrypted.</p>`;
    asideEl.innerHTML = search + asideMods().map(modHtml).join('') + foot;
    setAsideTop();
  }
  const isTyping = (a) => !!a && Date.now() - (S.typingFrom[a] || 0) < 4000;
  // Friends' activity: Active now (presence, typing) and Recent (local chats only; nothing leaves the device).
  function friendsModHtml() {
    const fr = Object.values(S.contacts).filter((c) => c && c.state === 'friend');
    if (!fr.length) return '';
    const byTs = (a, b) => (((b.last && b.last.ts) || 0) - ((a.last && a.last.ts) || 0));
    const act = fr.filter((c) => online(c.addr) || isTyping(c.addr)).sort(byTs).slice(0, 3);
    const rec = fr.filter((c) => !act.includes(c) && c.last && c.last.ts).sort(byTs).slice(0, 3);
    if (!act.length && !rec.length) return '';
    const row = (c) => {
      const typing = isTyping(c.addr), list = typing ? null : msgsOf(c.addr), lm = list && list[list.length - 1];
      const pv = typing ? 'typing…' : lm ? (lm.dir === 'me' ? 'You: ' : '') + previewOf(lm) : ((c.last && c.last.text) || '');
      return `<button type="button" class="omx-row" data-act="chat" data-a="${esc(c.addr)}">${avHtml(c.addr, 'sm')}<span class="t"><b>${esc(c.name || shortA(c.addr))}</b><span class="${typing ? 'typing' : c.unread ? 'unr' : ''}">${esc(pv)}</span></span>${c.unread ? `<span class="omx-unread" aria-label="${c.unread} unread">${c.unread > 99 ? '99+' : c.unread}</span>` : ''}</button>`;
    };
    return `<section class="omx-mod" aria-labelledby="omxAsFr"><header><h3 id="omxAsFr">Friends’ activity</h3><button type="button" data-tab="chats">Open chats</button></header>` +
      (act.length ? `<div class="omx-sub">Active now</div>${act.map(row).join('')}` : '') + (rec.length ? `<div class="omx-sub">Recent</div>${rec.map(row).join('')}` : '') + '</section>';
  }

  /* ---------- chats list (CUI.chatsListHtml): in #omxPane on desk, in #omxBody on phones / the drawer ---------- */
  const byLast = (a, b) => (((b.last && b.last.ts) || b.ts || 0) - ((a.last && a.last.ts) || a.ts || 0));
  // The data the chat-ui builders read (BUILD-SPEC §5.2; every field optional on their side).
  function cuiCtx(extra) {
    const a = S.view === 'chat' ? S.peer : null, c = a ? contact(a) : null;
    const seen = (x) => { const p = S.presence[x]; return p && p.lastSeen ? 'Last seen ' + agoText(p.lastSeen) : ''; };
    const lastMsg = (k) => { if (!k || !k.addr) return null; const list = msgsOf(k.addr); return (k.last && k.last.id && list.find((m) => m.id === k.last.id)) || (k.last ? list[list.length - 1] : null) || null; };
    let notifText = 'Message alerts are off — turn them on in Settings.';
    try { if ('Notification' in window && Notification.permission === 'granted') notifText = 'On for this chat while OST is open in the background.'; else if (!('Notification' in window)) notifText = 'This browser cannot show notifications.'; } catch (_) {}
    return Object.assign({
      esc, icon, av: avHtml, tTime, tDay, tShort, ago, agoText, shortA, fmtSize, nameOf, emojiOf, contact, online, typing: isTyping, seen,
      presence: (x) => S.presence[x] || null, lastMsg, findMsg, msgsOf, me: S.address, myName: myName(), peer: a, selected: S.peer || null, now: Date.now(),
      filter: S.chatFilter || 'all', query: S.chatQuery || '', searching: !!S.chatSearching,
      network: netName(), devnet: isDevnet(), blobs: S.blobs, mapHtml, payStatus, callSt, previewOf,
      headBtns: a ? X.headBtns.map((fn) => { try { return fn(a) || ''; } catch (_) { return ''; } }) : [],
      info: a ? infoItems(a) : [], attach: attachItems(), unreadFrom: S.unreadFrom || null,
      layout: layout(), band: band(), infoOpen: !!(root && root.classList.contains('info-open')), canProfile: !!X.views.profile,
      canCallBack: !!X.actions['call-back'], conn: connDot(), netbar: '', reqCount: reqCount(), unreadCount: totalUnread(),
      draft: a ? (drafts()[a] || '') : '', blocked: !!(c && c.state === 'blocked'), notifText
    }, extra || {});
  }
  function cui(name, args, fb) {
    try { if (typeof CUI[name] === 'function') return String(CUI[name].apply(null, args)); } catch (e) { console.warn('[mesh-app] chat-ui ' + name + ' failed', e); }
    return fb.apply(null, args);
  }
  function renderChatsView() {
    body.className = 'omx-body omx-v-chats';
    headEl.innerHTML = `<h2 id="omxTitle">Chats${devnetChip()}${connDot()}</h2><button type="button" class="omx-ib" data-act="new-chat" aria-label="New chat" aria-haspopup="menu">${icon('edit')}</button>${closeBtn()}`;
    body.innerHTML = '<div id="omxChats" class="omx-chats"></div>';
    paintChats();
  }
  function paintPane() {
    if (!$('omxChats') || !paneEl.contains($('omxChats'))) paneEl.innerHTML = '<div id="omxChats" class="omx-chats"></div>';
    paintChats();
  }
  function renderPick() {
    headEl.className = 'omx-head is-root';
    headEl.innerHTML = '<h2 id="omxTitle">Chats</h2>';
    body.className = 'omx-body omx-chat';
    body.innerHTML = cui('pickHtml', [cuiCtx()], () => `<div class="omx-pick"><div class="omx-empty"><span class="ic">${icon('chat')}</span><h3>Your messages</h3><p>Pick a chat on the left, or add someone with their invite link or QR code.</p><button type="button" class="omx-primary" data-tab="add" data-addtab="someone">${icon('user-plus')}Add a person</button></div></div>`);
  }
  function paintChats() {
    const el = $('omxChats'); if (!el) return;
    const fs = focusSnap(el);
    const list = Object.values(S.contacts).filter((c) => c && c.state !== 'blocked').sort(byLast);
    const ctx = cuiCtx();
    el.innerHTML = cui('chatsListHtml', [list, ctx], (l, x) => fbChatsList(filterQ(l), x));
    if (layout() === 'desk' && !el.querySelector('.omx-lhead')) el.insertAdjacentHTML('afterbegin', fbLhead());
    const lh = el.querySelector('.omx-lhead h2'); if (lh && !lh.querySelector('.omx-conn')) lh.insertAdjacentHTML('beforeend', connDot());
    if (S.chatSearching || S.chatQuery) mountChatSearch(el);
    paintStatus();
    focusRestore(el, fs);
  }
  // local name filter (the fallback list; chat-ui filters by ctx.query itself)
  function filterQ(list) {
    const q = String(S.chatQuery || '').trim().toLowerCase();
    return q ? list.filter((c) => (c.name || '').toLowerCase().includes(q) || String(c.addr || '').toLowerCase().includes(q)) : list;
  }
  // Typing in the search field repaints only the rows (#omxChatList) when chat-ui offers chatRowsHtml, so the field keeps focus.
  function paintChatRows() {
    const host = $('omxChatList');
    if (!host || typeof CUI.chatRowsHtml !== 'function') { paintChats(); return; }
    const list = Object.values(S.contacts).filter((c) => c && c.state !== 'blocked').sort(byLast);
    try { host.innerHTML = String(CUI.chatRowsHtml(list, cuiCtx())); } catch (e) { console.warn('[mesh-app] chat-ui chatRowsHtml failed', e); paintChats(); }
  }
  // Keep the focused control (a search field, a chip, a row) focused across an innerHTML repaint.
  function focusSnap(el) {
    const a = document.activeElement; if (!a || !el.contains(a)) return null;
    return { id: a.id, act: a.getAttribute('data-act'), da: a.getAttribute('data-a') || a.getAttribute('data-f') || a.getAttribute('data-t') || '', v: a.value, s: a.selectionStart, e: a.selectionEnd };
  }
  function focusRestore(el, f) {
    if (!f) return;
    let n = f.id ? $(f.id) : null;
    if (!n && f.act) n = Array.from(el.querySelectorAll(`[data-act="${f.act}"]`)).find((x) => (x.getAttribute('data-a') || x.getAttribute('data-f') || x.getAttribute('data-t') || '') === f.da) || null;
    if (!n || !el.contains(n)) return;
    try { n.focus({ preventScroll: true }); if (f.v != null && 'value' in n && n.value !== f.v) n.value = f.v; if (f.s != null && n.setSelectionRange) n.setSelectionRange(f.s, f.e); } catch (_) {}
  }
  // The search pill turns into a field in place (local name filter; nothing is sent anywhere).
  function mountChatSearch(el) {
    if ($('omxChatQ')) return;
    const pill = el.querySelector('[data-act="chat-search"]') || el.querySelector('.omx-search');
    const html = `<label class="omx-search omx-searchbox">${icon('search')}<input id="omxChatQ" type="search" placeholder="Search chats" aria-label="Search chats" autocomplete="off" spellcheck="false" enterkeyhint="search" value="${esc(S.chatQuery || '')}"></label>`;
    if (pill && pill.tagName !== 'INPUT') pill.outerHTML = html;
    else if (!pill) el.insertAdjacentHTML(el.querySelector('.omx-lhead') ? 'beforeend' : 'afterbegin', `<div class="omx-lsearch">${html}</div>`);
  }

  /* ---------- Add people (V1): requests first, then Your invite | Add someone ---------- */
  function reqCardsHtml() {
    const reqs = Object.values(S.contacts).filter((c) => c && (c.state === 'pending-in' || c.state === 'request')).sort((a, b) => (b.ts || 0) - (a.ts || 0));
    if (!reqs.length) return '';
    return `<h3 class="omx-sec">Requests · ${reqs.length}</h3>` + reqs.map((c) => { const nm = c.name || shortA(c.addr); return `<div class="omx-req">${avHtml(c.addr)}<span class="t"><b>${esc(nm)}</b><small>${c.state === 'request' ? 'Messaged you' : 'Wants to connect'} · ${esc(shortA(c.addr))}</small></span><span class="acts"><button type="button" class="omx-ib outline" data-act="decline" data-a="${esc(c.addr)}" aria-label="Decline ${esc(nm)}" title="Decline">${icon('close')}</button><button type="button" class="omx-primary omx-sm omx-hit" data-act="accept" data-a="${esc(c.addr)}" aria-label="Accept ${esc(nm)}">Accept</button></span></div>`; }).join('');
  }
  function renderAdd() {
    const L = layout(), link = inviteLink(), tab = S.addTab === 'someone' ? 'someone' : 'invite';
    body.className = 'omx-body omx-v-add';
    headEl.innerHTML = `<h2 id="omxTitle">Add people${L === 'desk' ? '' : devnetChip()}</h2>${L === 'desk' ? '' : closeBtn()}`;
    const seg = `<div class="omx-seg" role="tablist" aria-label="Add people" data-omx-tabs>${[['invite', 'Your invite'], ['someone', 'Add someone']].map(([k, l]) => `<button type="button" role="tab" id="omxAddTab-${k}" aria-controls="omxAddPanel" aria-selected="${tab === k}" tabindex="${tab === k ? 0 : -1}" data-act="add-tab" data-t="${k}">${l}</button>`).join('')}</div>`;
    const pend = S.pendingAdd ? `<section class="omx-card" aria-labelledby="omxPendT"><h3 id="omxPendT">Add ${esc(S.pendingAdd.name || shortA(S.pendingAdd.addr))}?</h3><p>${esc(S.pendingAdd.addr)}${S.pendingAdd.fp ? '<br>Safety code ' + esc(S.pendingAdd.fp) : ''}</p><div class="omx-row2"><button type="button" class="omx-ghost" data-act="add-cancel">Cancel</button><button type="button" class="omx-primary" data-act="add-confirm">Add &amp; open chat</button></div></section>` : '';
    const share = !!navigator.share;
    const invite = `<section class="omx-card" id="omxAddPanel" role="tabpanel" aria-labelledby="omxAddTab-invite"><div class="omx-invme">${avHtml(S.address, 'lg')}<span class="t"><b>${esc(myName())}</b><small>${esc(shortA(S.address))} · your invite</small></span></div>
        <div class="omx-qr"><canvas id="omxQr" width="288" height="288" role="img" aria-label="QR code of your invite link"></canvas></div>
        <p>Let them scan this with their phone camera, or send the link. One tap on their side and you are connected.</p>
        <div class="omx-linkrow"><span class="omx-code" title="${esc(link)}">${esc(link.replace(/^https?:\/\//, ''))}</span><button type="button" class="omx-ib" data-act="copy-link" aria-label="Copy invite link" title="Copy invite link">${icon('copy')}</button></div>
        <div class="omx-row2">${share ? `<button type="button" class="omx-primary" data-act="share-link">${icon('share')}Share link</button><button type="button" class="omx-ghost" data-act="copy-link">${icon('copy')}Copy link</button>` : `<button type="button" class="omx-primary" data-act="copy-link">${icon('copy')}Copy link</button><button type="button" class="omx-ghost" data-act="copy-addr">${icon('key')}Copy address</button>`}</div></section>`;
    const someone = `<section class="omx-card" id="omxAddPanel" role="tabpanel" aria-labelledby="omxAddTab-someone"><h3>Add someone</h3>
        <ol class="omx-steps"><li><span>Ask for their invite link or QR (Add → Your invite on their side).</span></li><li><span>Scan it here, or paste the link or ost-mesh address.</span></li><li><span>They accept once; after that you both chat and share files any time, even when one of you is offline.</span></li></ol>
        <div id="omxScanWrap" hidden><div class="omx-scan"><video id="omxVideo" playsinline muted></video></div><p class="omx-note" id="omxScanStatus" role="status"></p></div>
        <div class="omx-row2"><button type="button" class="omx-ghost" data-act="scan" id="omxScanBtn">${icon('scan')}<span>Scan QR</span></button><button type="button" class="omx-ghost" data-act="paste">${icon('clipboard')}Paste</button></div>
        <label class="omx-field"><span>Invite link or address</span><input class="omx-input" id="omxAddInput" placeholder="Paste invite link or ost-mesh:… address" autocomplete="off" spellcheck="false" enterkeyhint="go"></label>
        <button type="button" class="omx-primary omx-block" data-act="add-go">${icon('user-plus')}Add person</button>
        <p class="omx-note">No camera? Their phone camera app can scan <em>your</em> QR instead — it opens OST and adds you automatically.</p></section>`;
    body.innerHTML = reqCardsHtml() + pend + seg + (tab === 'someone' ? someone : invite);
    const qr = $('omxQr');
    if (qr) drawQr(qr, link).then((ok) => { if (!ok) { const c = $('omxQr'); if (c) c.replaceWith(Object.assign(document.createElement('p'), { className: 'omx-note', textContent: 'QR unavailable — share the link instead.' })); } });
  }

  /* ---------- Settings (V2): identity and security; the profile editor lives in Edit profile ---------- */
  function setRow(ico, b, s, rt, o) {
    o = o || {};
    const tag = o.act ? 'button' : 'div';
    return `<${tag}${tag === 'button' ? ` type="button" data-act="${o.act}"` : ''} class="omx-setrow${o.cls ? ' ' + o.cls : ''}"${o.label ? ` aria-label="${esc(o.label)}"` : ''}>${ico}<span class="t"><b>${esc(b)}</b>${s ? `<small>${s}</small>` : ''}</span><span class="rt">${rt || ''}</span></${tag}>`;
  }
  function renderSettings(asMe) {
    const L = layout(), chev = icon('chevron-right'), editor = !!X.views.edit, back = L !== 'desk' && !asMe;
    body.className = 'omx-body omx-v-settings';
    headEl.className = 'omx-head' + (back ? ' has-back' : '');
    headEl.innerHTML = (back ? (X.actions['sx-back'] ? `<button type="button" class="omx-ib" data-act="sx-back" aria-label="Back to your profile">${icon('back')}</button>` : `<button type="button" class="omx-ib" data-tab="me" aria-label="Back to your profile">${icon('back')}</button>`) : '') + `<h2 id="omxTitle">${asMe ? 'Me' : 'Settings'}</h2>${asMe && L !== 'desk' ? closeBtn() : ''}`;
    const a = S.address, short = a.replace(/^(ost-mesh:)([0-9a-f]{4})[0-9a-f-]*([0-9a-f]{4})$/i, '$1$2…$3');
    const prof = editor ? setRow(avHtml(a), myName(), 'Edit name, picture, bio and wallet', chev, { act: 'edit-profile' })
      : `<div class="omx-setrow omx-meedit">${avHtml(a)}<span class="t"><b>${esc(myName())}</b><small>Display name and picture (what friends see)</small></span><span class="rt"></span></div>` +
        `<div class="omx-meform"><label class="omx-field"><span>Display name</span><input class="omx-input" id="omxName" maxlength="32" value="${esc(S.profile.name || '')}" placeholder="e.g. Sam Rivera"></label>` +
        `<div class="omx-emojis" role="radiogroup" aria-label="Avatar emoji">${EMOJIS.map((e) => `<button type="button" role="radio" aria-checked="${S.profile.emoji === e}" data-act="emoji" data-e="${e}" aria-label="Emoji ${e}">${e}</button>`).join('')}</div>` +
        `<button type="button" class="omx-primary" data-act="save-profile">Save</button></div>`;
    body.innerHTML = `<div class="omx-setgrp"><h3>Profile</h3><div>${prof}</div></div>
      <div class="omx-setgrp"><h3>Identity</h3><div>${setRow(icon('key'), 'Your address', `<span class="omx-code">${esc(short)}</span>`, icon('copy'), { act: 'copy-addr', label: 'Copy your address ' + a })}${setRow(icon('shield'), 'Safety code', `<span class="omx-code">${esc(S.fp || '…')}</span><br>Compare it with a friend to be sure nobody is in the middle`, '')}</div></div>
      <div class="omx-setgrp"><h3>Notifications</h3><div>${notifRowHtml()}</div></div>
      <div class="omx-setgrp"><h3>More</h3><div>${setRow(icon('exit'), 'Classic mesh', 'Games, calls and location tools from the older mesh', icon('external'), { act: 'open-legacy' })}${setRow(icon('trash'), 'Reset identity…', 'A new address and keys; friends must add you again', '', { act: 'reset-id', cls: 'danger' })}</div></div>
      <p class="omx-note omx-setnote">Messages are encrypted on this device for one contact and relayed by the OST hub, which keeps only ciphertext, for up to 7 days. Your identity lives in this browser: clearing site data loses it.<br>Wallet: ${esc(window.OST_WALLET_PUBKEY ? window.OST_WALLET_PUBKEY.slice(0, 4) + '…' + window.OST_WALLET_PUBKEY.slice(-4) : 'not connected')} · hub ${esc(API.replace(/^https?:\/\//, ''))}</p>`;
  }
  // "Turn on notifications": asks the browser only when tapped; when blocked the row explains how to allow them.
  function notifRowHtml() {
    if (!('Notification' in window)) return setRow(icon('bell-off'), 'Notifications are not available', 'This browser cannot show notifications.', '');
    const p = Notification.permission;
    const on = p === 'granted' && (!(window.OST_NOTIFY && typeof window.OST_NOTIFY.enabled === 'function') || window.OST_NOTIFY.enabled());
    if (on) return setRow(icon('bell'), 'Notifications are on', 'New messages alert this device while OST is open in the background.', icon('check-circle', 'is-on'));
    if (p === 'denied') return setRow(icon('bell-off'), 'Notifications are blocked', 'Allow notifications for this site in your browser settings, then tap here.', icon('chevron-right'), { act: 'notif-on' });
    return setRow(icon('bell'), 'Turn on notifications', 'An alert for new messages while OST is open in the background', icon('chevron-right'), { act: 'notif-on' });
  }

  /* ---------- a chat ---------- */
  // opts.app = options for open() (history adoption); opts.chatToken = re-adopted chat entry.
  function openChat(a, opts) {
    if (!validAddr(a)) return;
    opts = opts || {};
    closeSheet(-1, true);                                            // a sheet (e.g. "Reset identity?", another chat's ⋯) never stays over a new chat
    const prev = S.view === 'chat' ? S.peer : null, c = contact(a);
    // the unread divider sits above the first message that arrived while the chat was closed
    S.unreadFrom = null;
    if (c && c.unread) { const ins = msgsOf(a).filter((m) => m.dir === 'them'); const f = ins[ins.length - c.unread]; S.unreadFrom = f ? f.id : null; }
    S.peer = a; S.view = 'chat'; S.newBelow = 0; S.viewIsDefault = false;
    if (c && c.unread) upsertContact(a, { unread: 0 });
    paintNav();
    if (appIsOpen()) render(); else open('chat', opts.app || {});
    // Desk: switching chats replaces the chat's history entry (no new Back step) and retags it.
    if (!S.backChat) S.backChat = back.push(chatBackFn, 'chat', Object.assign({ meta: a }, opts.chatToken ? { adoptToken: opts.chatToken } : {}));
    else if (prev && prev !== a) back.retag(S.backChat, a);
    keyFor(a).catch(() => {});
  }
  function paintChatHead() {
    const a = S.peer; if (!a || !headEl) return;
    // Keep keyboard focus on the same header control across a repaint (presence updates repaint the header).
    const ae = document.activeElement, keep = ae && headEl.contains(ae) ? ae.getAttribute('data-act') : '';
    headEl.className = 'omx-head omx-thead';
    headEl.innerHTML = cui('threadHeadHtml', [a, cuiCtx()], fbThreadHead);
    labelHead();
    if (keep) { const b = headEl.querySelector('[data-act="' + keep + '"]'); if (b) { try { b.focus({ preventScroll: true }); } catch (_) {} } }
  }
  // Keep the newest message in view while the reader is at the bottom.
  let msgRO = null, scrollingT = 0;
  const isPinned = () => S.pinnedChat !== false;
  function pinBottom() { const el = $('omxMsgs'); if (el) { el.scrollTop = el.scrollHeight; S.msgTop = el.scrollTop; } }
  // Only the reader moving UP unpins the thread. Content growing under a pinned
  // reader (a thumbnail or photo decoding, the keyboard, the attach tray) leaves
  // scrollTop where it was — and the async scroll event of our own jump can land
  // after that growth: in both cases follow the newest message down.
  function onMsgsScroll() {
    const el = $('omxMsgs'); if (!el) return;
    // day pills are sticky only WHILE the reader scrolls
    el.classList.add('scrolling'); clearTimeout(scrollingT); scrollingT = setTimeout(() => { const m = $('omxMsgs'); if (m) m.classList.remove('scrolling'); }, 1200);
    const top = el.scrollTop, gap = el.scrollHeight - top - el.clientHeight, prev = S.msgTop || 0;
    S.msgTop = top;
    if (gap < 80) { S.pinnedChat = true; if (S.newBelow) { S.newBelow = 0; paintNewPill(); } return; }
    if (top < prev - 1) S.pinnedChat = false;
    else if (S.pinnedChat !== false) pinBottom();
  }
  function paintNewPill() { const b = $('omxNew'); if (!b) return; if (S.newBelow > 0) { b.hidden = false; b.innerHTML = `<span>${S.newBelow} new message${S.newBelow > 1 ? 's' : ''}</span>${icon('arrow-down')}`; } else b.hidden = true; }
  const drafts = () => ssGet(DRAFT_KEY, {});
  function saveDraft(a, text) { const d = drafts(); if (text && text.trim()) d[a] = String(text).slice(0, 4000); else delete d[a]; ssSet(DRAFT_KEY, d); }
  function autoGrow(ta) { ta.style.height = 'auto'; ta.style.height = Math.min(140, ta.scrollHeight) + 'px'; }
  // The attach items (tray tiles on phones, popover rows on desk): core kinds + X.attach.
  function attachItems() {
    return [
      { act: 'att-media', ico: 'image', lbl: 'Photo or video', sub: 'Up to 6 MB, encrypted', tile: 7 },
      { act: 'att-file', ico: 'file', lbl: 'File', sub: 'Any document, up to 6 MB', tile: 9 },
      { act: 'att-loc', ico: 'pin', lbl: 'Location', sub: 'Your position once', tile: 4 },
      { act: 'att-live', ico: 'live', lbl: 'Live location', sub: '15 min, 1 hour or 8 hours', tile: 5 }
    ].concat(X.attach.map((x, i) => ({ act: 'att-x', i, ico: x.ico, lbl: x.lbl, sub: x.sub || '', tile: x.tile != null ? x.tile : 1 })));
  }
  // contact-info actions (desk pane) from plugins (X.info: calls); the pane adds Profile itself (ctx.canProfile).
  function infoItems(a) {
    const out = [];
    X.info.forEach((fn) => { try { (typeof fn === 'function' ? fn(a) || [] : []).forEach((x) => { if (x && x.lbl && x.act) out.push(x); }); } catch (_) {} });
    return out;
  }
  function renderChat() {
    const a = S.peer, c = contact(a);
    paintChatHead();
    body.className = 'omx-body omx-chat'; body.style.padding = '0';
    const ctx = cuiCtx(), items = ctx.attach;
    const comp = (ctx.blocked ? '' : cui('attachTrayHtml', [items, ctx], fbTray)) + cui('composerHtml', [ctx], fbComposer);
    body.innerHTML = `<div class="omx-livebar" id="omxLive" hidden></div><div class="omx-msgwrap"><div class="omx-msgs" id="omxMsgs" role="log" aria-label="Messages with ${esc(nameOf(a))}"><div class="omx-msgcol"></div></div><button type="button" class="omx-newpill" id="omxNew" data-act="jump-new" hidden></button></div>${comp}`;
    if (!$('omxFile')) body.insertAdjacentHTML('beforeend', '<input type="file" id="omxFile" hidden multiple accept="image/*,video/*">');
    if (!$('omxFileAny')) body.insertAdjacentHTML('beforeend', '<input type="file" id="omxFileAny" hidden multiple>');
    const tray = body.querySelector('.omx-attach'); if (tray) { tray.id = 'omxAttach'; tray.hidden = true; }
    const ta = $('omxText');
    if (ta) {
      const d = drafts()[a]; if (d) { ta.value = d; autoGrow(ta); }
      ta.addEventListener('input', () => { autoGrow(ta); throttleTyping(); saveDraft(a, ta.value); syncSendBtn(); });
      ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !isPhone()) { e.preventDefault(); doSend(); } });
      // Desktop only: focusing on phones pops the keyboard over the thread.
      if (!isPhone()) setTimeout(() => { try { if (S.view === 'chat' && S.peer === a && !sheetUp()) ta.focus({ preventScroll: true }); } catch (_) {} }, 50);
    }
    syncSendBtn();
    const ml = $('omxMsgs');
    S.pinnedChat = true;
    ml.addEventListener('scroll', onMsgsScroll, { passive: true });
    ml.addEventListener('load', () => { if (isPinned()) pinBottom(); }, true);         // images growing the thread
    if (msgRO) msgRO.disconnect();
    msgRO = window.ResizeObserver ? new ResizeObserver(() => { if (isPinned()) pinBottom(); }) : null;   // keyboard, attach tray, live bar
    if (msgRO) msgRO.observe(ml);
    paintMsgs(true); paintLiveBar(); paintNewPill();
    if (root.classList.contains('info-open')) paintInfo();
  }
  // The right composer button: a photo button while the field is empty, Send once there is text.
  function syncSendBtn() {
    const b = $('omxSend'), ta = $('omxText'); if (!b) return;
    const empty = !(ta && ta.value.trim());
    b.classList.toggle('photo', empty);
    const lbl = empty ? 'Send a photo or video' : 'Send';
    if (b.getAttribute('aria-label') !== lbl) b.setAttribute('aria-label', lbl);
    b.title = lbl;
    // one icon: swap it; two icons (photo + send, the stylesheet shows one per state): leave them
    const uses = b.querySelectorAll('use'), want = empty ? '#i-image' : '#i-send';
    if (uses.length === 1 && uses[0].getAttribute('href') !== want) uses[0].setAttribute('href', want);
    else if (!uses.length && !b.textContent.trim()) b.innerHTML = icon(empty ? 'image' : 'send');
  }
  let typingAt = 0; function throttleTyping() { const n = Date.now(); if (n - typingAt > 2500) { typingAt = n; wsSend({ t: 'typing', to: S.peer }); } }
  // Typing is a them-bubble at the end of the column, present only while they type (no reserved strip).
  let typingT = 0;
  function paintTyping() {
    const el = $('omxMsgs'); if (!el) return;
    const col = el.querySelector('.omx-msgcol') || el, on = isTyping(S.peer);
    const cur = col.querySelector(':scope > .omx-typing');
    if (on && !cur) { col.insertAdjacentHTML('beforeend', cui('typingHtml', [nameOf(S.peer)], fbTyping)); if (isPinned()) pinBottom(); }
    else if (!on && cur) cur.remove();
    clearTimeout(typingT);
    if (on) typingT = setTimeout(() => { paintTyping(); if (S.view === 'chat') paintChatHead(); if (listShown()) paintChats(); }, Math.max(100, 4000 - (Date.now() - (S.typingFrom[S.peer] || 0)) + 60));
  }
  // The pay card only RE-PRESENTS the verdict of verifyPay() (money team): state + their words.
  function payStatus(m) {
    const v = m && m.verified;
    if (v === 'confirmed') return { state: 'confirmed', text: 'Confirmed on-chain' };
    if (v === 'failed') return { state: 'failed', text: 'Transaction failed' };
    if (v === 'pending') return { state: 'pending', text: 'Not confirmed yet' };
    if (v === 'unverified') return { state: 'unverified', text: 'Not verified — ' + String(m.vReason || 'the transfer could not be matched') };
    return { state: '', text: 'Checking the chain…' };
  }
  function paintMsgs(jump) {
    const el = $('omxMsgs'); if (!el) return;
    const col = el.querySelector('.omx-msgcol') || el;
    const a = S.peer; const list = msgsOf(a);
    const stick = jump || isPinned(), keep = el.scrollTop;
    // Payment verification is the money team's verifyPay(): run it for pay messages that are not final yet,
    // BEFORE the markup is built (the markup module never calls it).
    list.forEach((m) => { if (m.kind === 'pay' && !m.verified) setTimeout(() => verifyPay(a, m), 0); });
    const h = cui('threadHtml', [list, cuiCtx()], fbThread);
    // Media that is already on screen is carried over, not rebuilt: a rebuilt <img>
    // is 0 px tall until it decodes again, which collapses the thread for a frame
    // (the scroll position clamps — a reader scrolled up got pulled to the bottom)
    // and restarts playing videos.
    const reuse = new Map();
    col.querySelectorAll('img, video, audio').forEach((x) => { const k = x.outerHTML; if (!reuse.has(k)) reuse.set(k, x); });
    col.innerHTML = h;
    if (reuse.size) col.querySelectorAll('img, video, audio').forEach((n) => { const k = n.outerHTML, o = reuse.get(k); if (o) { reuse.delete(k); n.replaceWith(o); } });
    if (isTyping(a)) col.insertAdjacentHTML('beforeend', cui('typingHtml', [nameOf(a)], fbTyping));
    if (stick) { el.scrollTop = el.scrollHeight; S.pinnedChat = true; if (S.newBelow) { S.newBelow = 0; paintNewPill(); } }
    else el.scrollTop = keep;
    S.msgTop = el.scrollTop;
    // Auto-fetch small images so the chat feels alive.
    list.filter((m) => m.kind === 'file' && m.blob && /^image\//.test(m.mime || '') && (m.size || 0) <= AUTO_FETCH_IMG && !S.blobs[m.blob] && !S.blobs['local:' + m.id] && !S.blobs['pending:' + m.blob]).slice(-6).forEach((m) => { fetchBlob(m.dir === 'me' ? S.address : a, m).then(() => paintMsgs()).catch(() => {}); });
  }
  function doSend() { const ta = $('omxText'); if (!ta) return; const text = ta.value.trim(); if (!text) return; ta.value = ''; ta.style.height = 'auto'; saveDraft(S.peer, ''); syncSendBtn(); sendText(S.peer, text); }

  /* ---------- contact info pane (desk chat, from (i)); phones use the ⋯ sheet ---------- */
  function paintInfo() { if (!infoEl || !S.peer) return; infoEl.innerHTML = cui('infoPaneHtml', [S.peer, cuiCtx()], fbInfo); }
  function toggleInfo(force) {
    const on = force != null ? !!force : !root.classList.contains('info-open');
    if (on && !(layout() === 'desk' && S.view === 'chat' && S.peer)) return;
    root.classList.toggle('info-open', on);
    if (on) paintInfo(); else infoEl.innerHTML = '';
    const b = headEl.querySelector('[data-act="peer-info"]'); if (b) b.setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  /* ---------- chat-ui fallbacks: used only when ost-mesh-chat-ui.js lacks a builder (same classes, plainer) ---------- */
  const tickIco = (m) => m.status === 'delivered' ? icon('check-double') : m.status === 'sent' ? icon('check') : icon('clock');
  const tickWord = (m) => m.status === 'delivered' ? 'delivered' : m.status === 'sent' ? 'sent' : 'sending';
  function fbLhead() { return `<div class="omx-lhead"><h2>Chats</h2><button type="button" class="omx-ib md" data-act="new-chat" aria-label="New chat" aria-haspopup="menu">${icon('edit')}</button></div>`; }
  function fbRow(c, ctx) {
    const a = c.addr, typing = isTyping(a), last = c.last || null, sel = ctx.selected === a;
    let pv;
    if (typing) pv = '<span class="pv typing"><span>typing…</span></span>';
    else if (last && last.fail) pv = `<span class="pv fail">${icon('alert')}<span>Not delivered · ${esc(last.text || '')}</span></span>`;
    else if (c.state === 'pending-out') pv = `<span class="pv">${icon('clock')}<span>Request sent · you can already write</span></span>`;
    else if (last) {
      const list = msgsOf(a), lm = list.find((m) => m.id === last.id) || list[list.length - 1];
      pv = lm && lm.dir === 'me' ? `<span class="pv"><span class="you">You:</span>${tickIco(lm)}<span>${esc(last.text || previewOf(lm))}</span></span>` : `<span class="pv"><span>${esc(last.text || '')}</span></span>`;
    } else pv = '<span class="pv"><span>Say hi</span></span>';
    return `<button type="button" class="omx-item${c.unread ? ' unread' : ''}" data-act="chat" data-a="${esc(a)}"${sel ? ' aria-current="true"' : ''}>${avHtml(a, 'lg')}<span class="omx-main"><span class="nm">${esc(c.name || shortA(a))}</span><span class="tm">${esc(tShort((last && last.ts) || c.ts))}</span>${pv}<span class="rt">${c.unread ? `<span class="omx-unread" aria-label="${c.unread} unread">${c.unread}</span>` : ''}</span></span></button>`;
  }
  function fbChatsList(list, ctx) {
    const reqs = list.filter((c) => c.state === 'pending-in' || c.state === 'request'), chats = list.filter((c) => !reqs.includes(c));
    const unread = chats.filter((c) => c.unread).length, f = ctx.filter || 'all';
    if (!list.length && !ctx.query) return `<div class="omx-empty"><span class="ic">${icon('chat')}</span><h3>No chats yet</h3><p>Chats are end-to-end encrypted. Share your invite so a friend can add you in one tap.</p><button type="button" class="omx-primary" data-act="add-tab" data-t="invite">${icon('share')}Share your invite</button><button type="button" class="omx-textbtn" data-act="add-tab" data-t="someone">I have a link or code</button></div>`;
    const chip = (k, l, n) => `<button type="button" class="omx-chip omx-hit" role="tab" aria-selected="${f === k}" tabindex="${f === k ? 0 : -1}" data-act="chat-filter" data-f="${k}">${l}${n ? ` <b>${n}</b>` : ''}</button>`;
    let h = (ctx.layout === 'desk' ? fbLhead() : '') + `<div class="omx-lsearch"><button type="button" class="omx-search" data-act="chat-search" aria-label="Search chats">${icon('search')}Search chats</button></div>`;
    h += `<div class="omx-chips" role="tablist" aria-label="Filter chats">${chip('all', 'All')}${chip('unread', 'Unread', unread)}${chip('requests', 'Requests', reqs.length)}</div>`;
    if (f === 'requests') return h + (reqs.length ? reqs.map((c) => { const nm = c.name || shortA(c.addr); return `<div class="omx-req">${avHtml(c.addr)}<span class="t"><b>${esc(nm)}</b><small>${c.state === 'request' ? 'Messaged you' : 'Wants to connect'} · ${esc(shortA(c.addr))}</small></span><span class="acts"><button type="button" class="omx-ib outline" data-act="decline" data-a="${esc(c.addr)}" aria-label="Decline ${esc(nm)}">${icon('close')}</button><button type="button" class="omx-primary omx-sm omx-hit" data-act="accept" data-a="${esc(c.addr)}">Accept</button></span></div>`; }).join('') : `<div class="omx-empty"><span class="ic">${icon('user-plus')}</span><h3>No requests</h3><p>People who want to connect show up here.</p></div>`);
    if (reqs.length) h += `<button type="button" class="omx-reqrow" data-act="chat-filter" data-f="requests"><span class="ic">${icon('user-plus')}</span><span><b>Message requests</b><small>${esc(reqs.slice(0, 2).map((c) => c.name || shortA(c.addr)).join(' and '))} ${reqs.length > 1 ? 'want' : 'wants'} to connect</small></span><span class="rt"><span class="omx-unread">${reqs.length}</span>${icon('chevron-right')}</span></button>`;
    const rows = (f === 'unread' ? chats.filter((c) => c.unread) : chats);
    return h + (rows.length ? `<div class="omx-list" role="list">${rows.map((c) => fbRow(c, ctx)).join('')}</div>` : `<div class="omx-empty"><span class="ic">${icon(ctx.query ? 'search' : 'check-circle')}</span><h3>${ctx.query ? 'No chats match' : 'All caught up'}</h3><p>${ctx.query ? 'Try another name.' : 'No unread messages.'}</p></div>`);
  }
  function fbThreadHead(a, ctx) {
    const c = contact(a) || { addr: a }, phone = ctx.layout !== 'desk', nm = c.name || shortA(a);
    const pres = isTyping(a) ? '<span class="typing">typing…</span>' : online(a) ? '<span class="on">Online</span>' : esc(S.presence[a] && S.presence[a].lastSeen ? 'Last seen ' + agoText(S.presence[a].lastSeen) : 'Offline');
    const st = c.state === 'friend' ? `${icon('lock')}encrypted` : c.state === 'pending-out' ? 'request sent' : c.state === 'blocked' ? 'blocked' : 'not accepted yet';
    return `${phone ? `<button type="button" class="omx-ib" data-act="back" aria-label="Back to chats">${icon('back')}</button>` : ''}<button type="button" class="omx-peerbtn" data-act="peer-profile" aria-label="${esc(nm)}${ctx.hasProfile ? ', open profile' : ''}">${avHtml(a, phone ? 'sm' : '')}<span class="t"><b>${esc(nm)}</b><small>${pres} · ${st}</small></span></button>${ctx.headBtns.join('')}${phone ? '' : `<button type="button" class="omx-ib md" data-act="peer-info" aria-label="Contact info" aria-pressed="${ctx.infoOpen}">${icon('info')}</button>`}<button type="button" class="omx-ib${phone ? '' : ' md'}" data-act="peer-menu" aria-label="Chat options" aria-haspopup="menu">${icon('more')}</button>`;
  }
  function fbComposer(ctx) { if (ctx && ctx.blocked) return `<div class="omx-blocked"><span>${icon('ban')}You blocked this contact.</span><button type="button" class="omx-ghost" data-act="unblock">Unblock</button></div>`; return `<div class="omx-compose"><div class="omx-compose-in"><button type="button" class="omx-ib filled attach" data-act="attach" aria-label="Attach" aria-expanded="false">${icon('plus')}</button><div class="omx-fieldpill"><textarea id="omxText" rows="1" placeholder="Message" enterkeyhint="send" aria-label="Message"></textarea></div><button type="button" class="omx-send photo" data-act="send" id="omxSend" aria-label="Send a photo or video">${icon('image')}</button></div></div>`; }
  function fbTray(items) { return `<div class="omx-attach" role="group" aria-label="Attach">${items.map((x) => `<button type="button" data-act="${x.act}"${x.i != null ? ` data-i="${x.i}"` : ''}><span class="tile" style="--tile:var(--omx-id-${Number(x.tile) % 12 || 0})" aria-hidden="true">${icoOrText(x.ico)}</span>${esc(x.lbl)}</button>`).join('')}<p class="omx-traynote">${icon('lock')}Encrypted on this device before it leaves</p></div>`; }
  function fbTyping(name) { return `<div class="omx-typing" role="status" aria-label="${esc(name)} is typing"><i></i><i></i><i></i></div>`; }
  function fbInfo(a, ctx) {
    const c = contact(a) || { addr: a }, nm = c.name || shortA(a), blocked = c.state === 'blocked';
    const acts = (ctx.canProfile ? [{ ico: 'user', lbl: 'Profile', act: 'peer-profile' }] : []).concat(ctx.info || []);
    return `<div class="ih"><h2>Contact info</h2><button type="button" class="omx-ib md" data-act="info-close" aria-label="Close contact info">${icon('close')}</button></div>` +
      `<div class="who">${avHtml(a, 'xl')}<b>${esc(nm)}</b><small>${esc(shortA(a))}${online(a) ? ' · Online' : ''}</small></div>` +
      (acts.length ? `<div class="acts">${acts.map((x) => `<button type="button" data-act="${esc(x.act)}">${icoOrText(x.ico)}${esc(x.lbl)}</button>`).join('')}</div>` : '') +
      `<div class="sec"><h3>Safety code</h3><div class="code">${esc(c.fp || 'Not known yet')}</div><p>Compare it with ${esc(nm)} in person or on a call. If it matches, nobody is in the middle.</p></div>` +
      `<div class="sec"><h3>Notifications</h3><p>New messages alert this device while OST is open in the background (Settings).</p></div>` +
      `<div class="sec danger">${blocked ? `<button type="button" data-act="unblock">${icon('ban')}Unblock ${esc(nm)}</button>` : `<button type="button" data-act="peer-block">${icon('ban')}Block ${esc(nm)}</button>`}<button type="button" data-act="peer-remove">${icon('user-x')}Remove contact</button><button type="button" data-act="peer-clear">${icon('trash')}Clear chat on this device</button></div>`;
  }
  function fbBubble(m, a) {
    if (m.dir === 'sys') return `<div class="omx-b sys">${esc(m.text)}</div>`;
    const failed = m.dir === 'me' && m.status === 'failed';
    let inner = '', cls = '';
    if (m.kind === 'loc') {
      const live = m.live && !m.ended && (!m.until || m.until > Date.now());
      cls = ' loc';
      inner = `<a class="omx-locc" href="https://www.openstreetmap.org/?mlat=${m.lat}&mlon=${m.lng}#map=16/${m.lat}/${m.lng}" target="_blank" rel="noopener">${mapHtml(m.lat, m.lng)}</a><div class="omx-loct"><b>${m.live ? (live ? 'Live location' : 'Live location ended') : 'Location'}</b><span>±${m.acc || '?'} m${m.live && m.upd ? ' · updated ' + agoText(m.upd) : ''}${live && m.until ? ' · until ' + tTime(m.until) : ''}</span><a href="https://www.google.com/maps/search/?api=1&query=${m.lat},${m.lng}" target="_blank" rel="noopener">Open in Maps</a></div>`;
    } else if (m.kind === 'pay') {
      const cl = netName(), st = payStatus(m);
      cls = ' pay';
      inner = `<div class="omx-payc"><span class="top">${icon('coin')}Payment<span class="omx-devnet">${esc(cl.toUpperCase())}</span></span><span class="amt">${esc(m.amount)} ${esc(m.ccy)}</span><span class="note">${m.dir === 'me' ? 'You sent' : 'You received'}${m.note ? ' · ' + esc(m.note) : ''}</span><span class="st">${icon(st.state === 'confirmed' ? 'check-circle' : st.state === 'failed' ? 'x-circle' : st.state ? (st.state === 'pending' ? 'clock' : 'alert') : 'loader')}${esc(st.text)}</span><a class="tx" href="https://explorer.solana.com/tx/${esc(m.sig)}${/^mainnet/.test(cl) ? '' : '?cluster=' + esc(cl)}" target="_blank" rel="noopener"><span>View transaction</span>${icon('external')}</a></div>`;
    } else if (m.kind === 'call') {
      const cs = callSt(m), lbl = cs === 'missed' ? (m.dir === 'me' ? 'No answer' : 'Missed') : cs === 'declined' ? 'Declined' : cs === 'busy' ? 'Busy' : 'Ended';
      cls = ' call';
      inner = `<span class="tile">${icon(m.video ? 'video' : 'phone')}</span><span><b>${m.video ? 'Video' : 'Voice'} call · ${lbl}</b><small>${tTime(m.ts)}${m.dur ? ' · ' + Math.floor(m.dur / 60) + ':' + String(m.dur % 60).padStart(2, '0') : ''}</small></span>${X.actions['call-back'] ? `<button type="button" class="omx-ghost omx-sm" data-act="call-back" data-video="${m.video ? 1 : 0}">${icon(m.video ? 'video' : 'phone')}Call back</button>` : ''}`;
    } else if (m.kind === 'file') {
      const cached = S.blobs[m.blob] || S.blobs['local:' + m.id];
      const isImg = /^image\//.test(m.mime || ''), isVid = /^video\//.test(m.mime || ''), isAud = /^audio\//.test(m.mime || '');
      const unsent = m.dir === 'me' && (failed || m.status === 'sending');
      if (cached && (isImg || isVid)) { cls = ' media'; inner = isImg ? `<img src="${cached.url}" alt="${esc(m.name)}" loading="lazy">` : `<video src="${cached.url}" controls playsinline></video>`; }
      else {
        if (cached && isAud) inner += `<audio src="${cached.url}" controls></audio>`;
        const hint = failed ? '' : unsent && !m.blob ? ' · encrypting & uploading…' : cached ? ' · tap to save' : unsent ? '' : ' · tap to download';
        const row = `<span class="tile">${icon(isImg ? 'image' : isVid ? 'film' : isAud ? 'music' : /pdf/.test(m.mime || '') ? 'file-text' : 'file')}</span><span class="t"><b>${esc(m.name)}</b><small>${fmtSize(m.size || 0)}${hint}</small></span>`;
        inner += failed || unsent ? `<div class="omx-file">${row}</div>` : cached ? `<a class="omx-file" href="${cached.url}" download="${esc(m.name)}">${row}</a>` : `<a class="omx-file" href="#" data-act="dl" data-id="${esc(m.id)}">${row}</a>`;
      }
      if (m.status === 'sending') inner += '<div class="omx-prog ind" role="progressbar" aria-label="Uploading"><i></i></div>';
    } else if (m.kind === 'unsupported' || (m.kind && m.kind !== 'text')) inner = '<i class="omx-unsup">Unsupported message — update OST</i>';
    else inner = esc(m.text).replace(/(https?:\/\/[^\s<]+)/g, (u) => `<a href="${u}" target="_blank" rel="noopener" class="omx-a">${u}</a>`);
    const who = m.dir === 'me' ? 'You' : nameOf(a);
    if (failed) return `<div class="omx-brow"><button type="button" class="omx-failbtn" data-act="fail-menu" data-id="${esc(m.id)}" aria-label="Not delivered: options">${icon('alert', 'is-on')}</button><div class="omx-b me failed g-solo${cls}" data-id="${esc(m.id)}" data-act="retry" role="button" tabindex="0" aria-label="Not delivered: ${esc(m.text || previewOf(m))}. Tap to retry" title="${esc(m.err || 'Not delivered')}">${inner}</div></div><span class="omx-fcap">Not delivered · Tap to retry</span>`;
    const meta = `<span class="omx-t">${tTime(m.ts)}${m.dir === 'me' ? ' ' + tickIco(m) : ''}</span>`;
    return `<div class="omx-b ${m.dir} g-solo${cls}" data-id="${esc(m.id)}" aria-label="${esc(who + ', ' + tTime(m.ts) + (m.dir === 'me' ? ', ' + tickWord(m) : ''))}">${inner}${meta}</div>`;
  }
  function fbThread(list, ctx) {
    const a = S.peer, c = contact(a);
    let h = `<div class="omx-b sys e2e">${icon('lock')}<span>Messages with ${esc(nameOf(a))} are end-to-end encrypted.${c && c.state === 'pending-out' ? ' You can write now; they see it as soon as they accept.' : ''}</span></div>`;
    let day = '', open = false;
    list.forEach((m) => {
      const d = tDay(m.ts);
      if (d !== day) { if (open) h += '</section>'; day = d; open = true; h += `<section class="omx-dayblock" aria-label="${esc(d)}"><h3 class="omx-day">${esc(d)}</h3>`; }
      if (ctx.unreadFrom && m.id === ctx.unreadFrom) h += '<div class="omx-unreaddiv" role="separator">New messages</div>';
      h += fbBubble(m, a);
    });
    if (open) h += '</section>';
    return h;
  }

  /* ---------- live repaints (presence, typing, new mail): in place, never a view change ---------- */
  function onPresence() {
    if (!root || !appIsOpen()) return;
    if (listShown()) paintChats();
    if (S.view === 'chat') paintChatHead();
    if (asideShown()) paintAside('friends');
    if (root.classList.contains('info-open')) paintInfo();
  }
  let typingListT = 0;
  function onTypingChange(from) {
    if (!root || !appIsOpen()) return;
    if (S.view === 'chat' && S.peer === from) { paintTyping(); paintChatHead(); }
    if (listShown()) paintChats();
    if (asideShown()) paintAside('friends');
    clearTimeout(typingListT);
    typingListT = setTimeout(() => { if (!appIsOpen()) return; if (listShown()) paintChats(); if (asideShown()) paintAside('friends'); }, 4100);
  }
  // Contacts changed (a request, an accept, the friend list): the views that list people repaint.
  function refreshLists() {
    if (!root || !appIsOpen()) { paintNav(); return; }
    if (S.view === 'chats' || S.view === 'add') render();
    else { paintNav(); if (listShown()) paintChats(); if (asideShown()) paintAside('friends'); }
  }

  /* ---------- events ---------- */
  function onChange(e) {
    const t = e.target;
    if (t && (t.id === 'omxFile' || t.id === 'omxFileAny') && t.files && t.files.length) { Array.from(t.files).slice(0, 6).forEach((f) => sendFile(S.peer, f)); t.value = ''; closeTray(); }
  }
  function onInput(e) {
    const t = e.target;
    if (t && t.id === 'omxChatQ') { S.chatQuery = t.value.slice(0, 60); S.chatSearching = true; paintChatRows(); }
  }
  // Failed bubbles are role=button (Enter / Space retry like a tap); core tablists move with the arrow keys.
  function onRootKey(e) {
    const t = e.target; if (!t || !t.getAttribute) return;
    if ((e.key === 'Enter' || e.key === ' ') && t.classList && t.classList.contains('omx-b') && t.hasAttribute('data-act')) { e.preventDefault(); t.click(); return; }
    if (t.getAttribute('role') === 'tab' && /^(ArrowRight|ArrowLeft|ArrowDown|ArrowUp|Home|End)$/.test(e.key)) {
      const list = t.closest('[role="tablist"]');
      if (!list || !(list.hasAttribute('data-omx-tabs') || list.classList.contains('omx-chips'))) return;
      const tabs = Array.from(list.querySelectorAll('[role="tab"]')), i = tabs.indexOf(t); if (i < 0) return;
      const n = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : /Right|Down/.test(e.key) ? (i + 1) % tabs.length : (i - 1 + tabs.length) % tabs.length;
      e.preventDefault();
      const nt = tabs[n], act = nt.getAttribute('data-act'), k = nt.getAttribute('data-t') || nt.getAttribute('data-f') || '';
      nt.click();
      setTimeout(() => { const m = Array.from(root.querySelectorAll(`[role="tab"][data-act="${act}"]`)).find((x) => (x.getAttribute('data-t') || x.getAttribute('data-f') || '') === k) || nt; try { m.focus({ preventScroll: true }); } catch (_) {} }, 0);
    }
  }
  function closeTray() { const m = $('omxAttach'); if (m) m.hidden = true; const b = body && body.querySelector('[data-act="attach"]'); if (b) b.setAttribute('aria-expanded', 'false'); }
  const ALIAS = { 'remove-contact': 'peer-remove', 'clear-chat': 'peer-clear', 'contact-info': 'peer-info', 'close-info': 'info-close', 'view-media': 'media-open', 'open-media': 'media-open', 'search-chats': 'chat-search', 'retry-now': 'net-retry' };
  function navTo(v, el) {
    const sub = el && (el.getAttribute('data-addtab') || el.getAttribute('data-t'));
    if (v === 'add' && sub) S.addTab = /some|code|link|paste|add/i.test(sub) ? 'someone' : 'invite';
    if (v !== 'chat') S.peer = null;
    S.view = v; S.viewIsDefault = false; render();
    // The nav may have been redrawn: keep keyboard focus on the item instead of dropping it to <body>.
    const ae = document.activeElement, host = el && el.closest ? el.closest('#omxRail, #omxTabs') : null;
    if (host && (!ae || ae === document.body || !ae.isConnected)) { const b = host.querySelector('[data-tab="' + v + '"]'); if (b && b.getClientRects().length) { try { b.focus({ preventScroll: true }); } catch (_) {} } }
  }
  function msgIdOf(t) {
    if (!t) return '';
    const own = t.getAttribute('data-id'); if (own) return own;
    const row = t.closest('.omx-brow'), b = row && row.querySelector('.omx-b[data-id]'); if (b) return b.getAttribute('data-id');
    const p = t.closest('.omx-b[data-id]'); return p ? p.getAttribute('data-id') : '';
  }
  async function onClick(e) {
    // A tap anywhere on a failed bubble retries it (its file row / map / links included); its own buttons keep their action.
    const fb = e.target.closest('.omx-b.failed[data-act="retry"]');
    const t = fb && !e.target.closest('button') ? fb : e.target.closest('[data-act],[data-tab]'); if (!t) return;
    if (t.hasAttribute('data-tab') && !t.hasAttribute('data-act')) { navTo(t.getAttribute('data-tab'), t); return; }
    let act = t.getAttribute('data-act'); const a = t.getAttribute('data-a');
    if (X.actions[act]) { try { await X.actions[act](t, e); } catch (err) { toast((err && err.message) || 'Action failed', 'err'); } return; }
    if (t.hasAttribute('data-tab') && !/^(add-tab|chat-filter)$/.test(act)) { navTo(t.getAttribute('data-tab'), t); return; }
    act = ALIAS[act] || act;
    switch (act) {
      case 'attach': {
        if (deskPointer()) {
          closeTray();
          const items = attachItems();
          let rows = null; try { if (typeof CUI.attachSheetItems === 'function') rows = CUI.attachSheetItems(items); } catch (_) { rows = null; }
          if (!Array.isArray(rows) || !rows.length) rows = items.map((x) => ({ label: x.lbl, sub: x.sub, ico: x.ico, tile: x.tile, value: x.act === 'att-x' ? 'att-x:' + x.i : x.act }));
          t.setAttribute('aria-expanded', 'true');
          const v = await actionSheet({ title: 'Attach', items: rows, anchor: t, place: 'above-start', cls: 'attach', note: (typeof CUI.ATTACH_NOTE === 'string' && CUI.ATTACH_NOTE) || 'Encrypted on this device before it leaves' });
          if (t.isConnected) t.setAttribute('aria-expanded', 'false');
          if (typeof v === 'string' && v) { const m = v.match(/^att-x:(\d+)$/); runAttach(m ? { act: 'att-x', i: m[1] } : { act: v }, t); }
          break;
        }
        const m = $('omxAttach'); if (m) { const pin = isPinned(); m.hidden = !m.hidden; t.setAttribute('aria-expanded', m.hidden ? 'false' : 'true'); if (pin) pinBottom(); }
        break;
      }
      case 'att-live': {   // the tray's own duration picker (second step) when it has one; else a small menu
        const lp = $('omxLivePick'), tr = $('omxAttach');
        if (lp && tr && !tr.hidden && tr.contains(t)) { lp.hidden = !lp.hidden; if (isPinned()) pinBottom(); break; }
        closeTray(); runAttach({ act }, t); break;
      }
      case 'att-media': case 'att-file': case 'att-loc': case 'att-x': closeTray(); runAttach({ act, i: t.getAttribute('data-i') }, t); break;
      case 'peer-act': { const pv = t.getAttribute('data-v'); if (pv === 'block') await doBlock(S.peer); else if (pv === 'unblock') await doUnblock(S.peer); else if (pv === 'remove') await doRemove(S.peer); else if (pv === 'clear') await doClear(S.peer); break; }
      case 'live-go': closeTray(); startLive(S.peer, Number(t.getAttribute('data-m')) || 15); break;
      case 'live-stop': stopLive(S.peer); break;
      case 'peer-profile': if (X.views.profile) { const p = S.peer; S.profileOf = p; S.view = 'profile'; S.viewIsDefault = false; render(); } break;
      case 'peer-info': toggleInfo(); break;
      case 'info-close': toggleInfo(false); { const b = headEl.querySelector('[data-act="peer-info"]'); if (b) { try { b.focus({ preventScroll: true }); } catch (_) {} } } break;
      case 'close': close(); break;
      case 'back': leaveChat(); break;
      case 'jump-new': S.newBelow = 0; S.pinnedChat = true; pinBottom(); paintNewPill(); break;
      case 'chat': openChat(a); break;
      case 'accept': acceptPerson(a); break;
      case 'decline': declinePerson(a, false); break;
      case 'send': if (t.classList.contains('photo') || !(($('omxText') || {}).value || '').trim()) { const f = $('omxFile'); if (f) f.click(); } else doSend(); break;
      case 'retry': e.preventDefault(); retryMsg(S.peer, t.getAttribute('data-id')); break;   // a tap anywhere on a failed bubble (map / file links included) retries
      case 'fail-menu': await failMenu(msgIdOf(t), t); break;
      case 'dl': case 'media-open': { e.preventDefault(); const id = t.getAttribute('data-id') || msgIdOf(t); await openMedia(id, t, act === 'media-open'); break; }
      case 'chat-filter': { const f = t.getAttribute('data-f') || t.getAttribute('data-filter') || t.getAttribute('data-v') || t.getAttribute('data-t') || 'all'; S.chatFilter = /req/i.test(f) ? 'requests' : /unr/i.test(f) ? 'unread' : 'all'; if (!listShown()) { S.view = 'chats'; render(); } else paintChats(); break; }
      case 'chat-search': if (t.tagName !== 'INPUT') { S.chatSearching = true; paintChats(); const q = $('omxChatQ'); if (q) { try { q.focus(); } catch (_) {} } } break;
      case 'add-tab': { const k = t.getAttribute('data-t') || t.getAttribute('data-tab') || t.getAttribute('data-v') || t.getAttribute('data-addtab') || 'invite'; S.addTab = /some|code|link|paste|add/i.test(k) ? 'someone' : 'invite'; if (S.view !== 'add') { S.peer = null; S.view = 'add'; S.viewIsDefault = false; } render(); break; }
      case 'nav-post': if (typeof X.compose === 'function') { try { await X.compose(); } catch (err) { toast((err && err.message) || 'Could not open the composer', 'err'); } } else if (X.views.compose) { S.view = 'compose'; S.viewIsDefault = false; render(); } break;
      case 'account-menu': await accountMenu(t); break;
      case 'net-retry': netRetry(); break;
      case 'new-chat': await newChatMenu(t); break;
      case 'edit-profile': if (X.views.edit) { S.view = 'edit'; S.viewIsDefault = false; render(); } else { const n = $('omxName'); if (n) n.focus(); } break;
      case 'peer-block': await doBlock(S.peer); break;
      case 'peer-remove': await doRemove(S.peer); break;
      case 'peer-clear': await doClear(S.peer); break;
      case 'copy-link': copyText(inviteLink(), 'Invite link copied — send it to your friend'); break;
      case 'copy-addr': copyText(S.address, 'Address copied'); break;
      case 'share-link': if (navigator.share) { try { await navigator.share({ title: 'Chat with me on OST Mesh', text: 'Add me on OST Mesh: ' + inviteLink() }); } catch (_) {} } else copyText(inviteLink(), 'Invite link copied — send it to your friend'); break;
      case 'scan': {
        const w = $('omxScanWrap'); if (!w) return;
        const lbl = (s) => { const sp = t.querySelector('span'); if (sp) sp.textContent = s; else t.textContent = s; const u = t.querySelector('use'); if (u) u.setAttribute('href', s === 'Scan QR' ? '#i-scan' : '#i-stop'); };
        if (!w.hidden && S.scanStream) { stopScan(); w.hidden = true; lbl('Scan QR'); return; }
        w.hidden = false; lbl('Stop camera');
        startScan($('omxVideo'), (info) => { S.pendingAdd = info; render(); }, (s) => { const st = $('omxScanStatus'); if (st) st.textContent = s; }); break;
      }
      case 'paste': try { const txt = await navigator.clipboard.readText(); const info = parseAddText(txt); if (!info) { toast('Clipboard has no OST Mesh link.', 'err'); return; } S.pendingAdd = info; render(); } catch (_) { toast('Clipboard not available — paste into the box.', 'err'); } break;
      case 'add-go': { const info = parseAddText(($('omxAddInput') || {}).value); if (!info) { const inp = $('omxAddInput'); if (inp) { inp.setAttribute('aria-invalid', 'true'); inp.focus(); } toast('Paste an invite link or an ost-mesh: address.', 'err'); return; } t.disabled = true; t.textContent = 'Adding…'; await addPerson(info); if (S.view === 'add') render(); break; }
      case 'add-confirm': { const info = S.pendingAdd; S.pendingAdd = null; t.disabled = true; t.textContent = 'Adding…'; await addPerson(info); if (S.view === 'add') render(); break; }
      case 'add-cancel': S.pendingAdd = null; render(); break;
      case 'emoji': {   // toggled in place: re-rendering would wipe a name being typed
        S.profile.emoji = t.getAttribute('data-e'); lsSet(K.profile, S.profile);
        t.parentNode.querySelectorAll('button').forEach((b) => b.setAttribute('aria-checked', b === t ? 'true' : 'false'));
        const av = body.querySelector('.omx-meedit .omx-av'); if (av) av.setAttribute('data-g', S.profile.emoji);
        saveProfile({ emoji: S.profile.emoji }).catch((err) => toast(err.message, 'err')); break;
      }
      case 'save-profile': {
        const n = ($('omxName') || {}).value || ''; S.profile.name = n.trim().slice(0, 32); lsSet(K.profile, S.profile);
        t.disabled = true;
        try { await saveProfile({ name: S.profile.name, emoji: S.profile.emoji || '' }); toast('Saved — friends see “' + (S.profile.name || shortA(S.address)) + '”', 'ok'); render(); }
        catch (err) { toast(err.message, 'err'); t.disabled = false; }
        break;
      }
      case 'notif-on': {
        let perm = '';
        try { perm = window.OST_NOTIFY && typeof window.OST_NOTIFY.request === 'function' ? await window.OST_NOTIFY.request() : ('Notification' in window ? await Notification.requestPermission() : 'unsupported'); } catch (_) { perm = 'unsupported'; }
        toast(perm === 'granted' ? 'Notifications are on for this device' : perm === 'denied' ? 'Notifications are blocked — allow them in your browser settings.' : perm === 'unsupported' ? 'This browser cannot show notifications.' : 'Notifications were not turned on.', perm === 'granted' ? 'ok' : 'err');
        if (S.view === 'settings' || S.view === 'me') render();
        break;
      }
      case 'open-legacy': openLegacy(); break;
      case 'reset-id': {
        const ok = await confirmSheet({ title: 'Reset your mesh identity?', body: 'You get a new address and new keys; friends must add you again. Chats stay on this device.', ok: 'Reset identity', danger: true });
        if (!ok) break;
        try { await resetIdentity(); toast('New identity: ' + shortA(S.address), 'ok'); } catch (err) { toast((err && err.message) || 'Reset failed', 'err'); }
        render(); break;
      }
      case 'peer-menu': await peerMenu(S.peer, t); break;
      case 'unblock': await doUnblock(S.peer); break;
    }
  }
  // An attach choice (tray tile, desk popover row or a plugin's tile).
  async function runAttach(x, anchor) {
    const act = x.act;
    if (act === 'att-media') { const f = $('omxFile'); if (f) f.click(); }
    else if (act === 'att-file') { const f = $('omxFileAny'); if (f) f.click(); }
    else if (act === 'att-loc') shareLocation(S.peer);
    else if (act === 'att-live') {
      const p = S.peer;
      const m = await actionSheet({ title: 'Share live location for', items: [{ label: '15 minutes', value: 15, ico: 'live' }, { label: '1 hour', value: 60, ico: 'live' }, { label: '8 hours', value: 480, ico: 'live' }], anchor: deskPointer() ? anchor : null, place: 'above-start' });
      if (m && S.peer === p) startLive(p, m);
    } else if (act === 'att-x') {
      const it = X.attach[Number(x.i)];
      if (it) { try { await it.run(S.peer); } catch (err) { toast((err && err.message) || 'Failed', 'err'); } }
    }
  }
  // A tap on a chat photo opens the viewer (OST Social's X.viewer) when there is one; other files are saved.
  async function openMedia(id, el, view) {
    const m = msgsOf(S.peer).find((x) => x.id === id); if (!m) return;
    let rec = S.blobs[m.blob] || S.blobs['local:' + m.id];
    const media = /^(image|video)\//.test(m.mime || '');
    if (!rec) {
      if (el) el.style.opacity = '.6';
      try { rec = await fetchBlob(m.dir === 'me' ? S.address : S.peer, m); paintMsgs(); }
      catch (err) { toast((err && err.message) || 'Download failed', 'err'); if (el) el.style.opacity = ''; return; }
      if (!view) return;                                             // first tap downloads; the picture now shows in the bubble
    }
    if (media && typeof X.viewer === 'function') { try { X.viewer({ src: rec.url, alt: m.name || (m.mime && /^video/.test(m.mime) ? 'Video' : 'Photo'), from: m.dir === 'me' ? myName() : nameOf(S.peer), ts: m.ts, download: rec.url, name: m.name || '', mime: m.mime || '' }); return; } catch (_) {} }
    const d = document.createElement('a'); d.href = rec.url; d.download = m.name || 'file'; d.rel = 'noopener'; document.body.appendChild(d); d.click(); d.remove();
  }
  // The failed (!) sheet: Try again now · Copy text · Delete from this device.
  async function failMenu(id, anchor) {
    const p = S.peer, m = id && findMsg(p, id); if (!m) return;
    const quote = m.text ? '“' + (m.text.length > 60 ? m.text.slice(0, 58) + '…' : m.text) + '”' : 'This ' + (m.kind === 'file' ? 'file' : 'message');
    let spec = null; try { if (typeof CUI.failedSheet === 'function') spec = CUI.failedSheet(m, nameOf(p)); } catch (_) { spec = null; }
    if (!spec || !Array.isArray(spec.items)) {
      const items = [{ label: 'Try again now', ico: 'refresh', value: 'retry' }];
      if (m.text) items.push({ label: 'Copy text', ico: 'copy', value: 'copy' });
      items.push({ label: 'Delete from this device', sub: 'It was never delivered, so ' + nameOf(p) + ' never sees it', ico: 'trash', danger: true, value: 'delete' });
      spec = { title: 'Not delivered', body: quote + ' is saved on this device and retries automatically when the hub can be reached.', items };
    }
    // honest: a message that will NOT retry by itself (a permanent refusal, or older than a week) says so
    if (m.perm) spec.body = quote + ' was not delivered' + (m.err ? ' (' + String(m.err).replace(/\.$/, '') + ')' : '') + '. It stays on this device until you try again or delete it.';
    const v = await actionSheet({ title: spec.title || 'Not delivered', body: spec.body, items: spec.items, anchor: deskPointer() ? anchor : null });
    if (!v || S.peer !== p) return;
    if (v === 'retry') retryMsg(p, id);
    else if (v === 'copy') copyText(m.text, 'Copied');
    else if (v === 'delete' || v === 'del') {
      INFLIGHT.delete(id); outboxDel(id); outFileDel(id);
      const list = msgsOf(p).filter((x) => x.id !== id); saveMsgs(p, list);
      const c = contact(p), lm = list[list.length - 1];
      if (c && c.last && c.last.id === id) upsertContact(p, { last: lm ? { text: previewOf(lm), ts: lm.ts, id: lm.id, kind: lm.kind, fail: lm.dir === 'me' && lm.status === 'failed' } : null });
      if (S.view === 'chat' && S.peer === p) paintMsgs();
      if (listShown()) paintChats();
      toast('Deleted from this device', 'ok');
    }
  }
  async function accountMenu(anchor) {
    const v = await actionSheet({ title: 'Account', items: [{ label: 'Edit profile', ico: 'pen', value: 'edit' }, { label: 'Copy my address', ico: 'copy', value: 'addr' }, { label: 'Settings', ico: 'settings', value: 'settings' }], anchor });
    if (v === 'edit') { S.view = X.views.edit ? 'edit' : 'settings'; S.viewIsDefault = false; S.peer = null; render(); }
    else if (v === 'addr') copyText(S.address, 'Address copied');
    else if (v === 'settings') { S.view = 'settings'; S.viewIsDefault = false; S.peer = null; render(); }
  }
  async function newChatMenu(anchor) {
    const fr = Object.values(S.contacts).filter((c) => c && (c.state === 'friend' || c.state === 'pending-out')).sort((a, b) => (a.name || shortA(a.addr)).localeCompare(b.name || shortA(b.addr))).slice(0, 12);
    const items = fr.map((c) => ({ label: c.name || shortA(c.addr), sub: shortA(c.addr) + (online(c.addr) ? ' · Online' : ''), ico: 'chat', value: c.addr }));
    items.push({ label: 'Add someone new', sub: 'With their invite link or QR code', ico: 'user-plus', value: '__add' });
    const v = await actionSheet({ title: 'New chat', items, anchor: deskPointer() ? anchor : null });
    if (v === '__add') { S.addTab = 'someone'; S.peer = null; S.view = 'add'; S.viewIsDefault = false; render(); }
    else if (v) openChat(v);
  }
  function copyText(text, msg) { const done = () => toast(msg || 'Copied', 'ok'); try { if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(text).then(done, fallback); return; } } catch (_) {} fallback(); function fallback() { try { const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); done(); } catch (_) { toast('Copy failed — long-press the link to copy it.', 'err'); } } }
  // Block / Remove / Clear / Unblock: the same confirms from the ⋯ menu and the contact-info pane.
  async function doUnblock(p) { if (!p) return; try { await signed('POST', '/mesh/v1/friend/respond', { wallet: S.address, other: p, action: 'unblock' }); upsertContact(p, { state: 'friend' }); render(); } catch (err) { toast(err.message, 'err'); } }
  async function doBlock(p) {
    if (!p) return; const name = nameOf(p);
    if (!(await confirmSheet({ title: 'Block ' + name + '?', body: 'They can no longer message or call you. Their messages are dropped without a notification.', ok: 'Block', danger: true }))) return;
    if (await declinePerson(p, true)) { toast(name + ' is blocked', 'ok'); if (S.peer === p) leaveChat(); }
  }
  async function doRemove(p) {
    if (!p) return; const name = nameOf(p);
    if (!(await confirmSheet({ title: 'Remove ' + name + '?', body: 'They leave your contacts and this chat is deleted on this device. You can add them again later.', ok: 'Remove contact', danger: true }))) return;
    if (await declinePerson(p, false)) { try { localStorage.removeItem(K.msgs + p); } catch (_) {} lsSet(OUTBOX_KEY, outboxList().filter((x) => x.a !== p)); toast(name + ' removed', 'ok'); if (S.peer === p) leaveChat(); }
  }
  async function doClear(p) {
    if (!p) return; const name = nameOf(p);
    if (!(await confirmSheet({ title: 'Clear this chat?', body: 'Deletes every message with ' + name + ' on this device. ' + name + ' keeps their copy.', ok: 'Clear chat', danger: true }))) return;
    try { localStorage.removeItem(K.msgs + p); } catch (_) {}
    lsSet(OUTBOX_KEY, outboxList().filter((x) => x.a !== p));
    upsertContact(p, { last: null, unread: 0 }); saveDraft(p, '');
    if (S.view === 'chat' && S.peer === p) paintMsgs(true);
    toast('Chat cleared', 'ok');
  }
  // Chat ⋯ menu: plugin rows (e.g. calls on narrow phones) + Block / Remove contact / Clear chat…;
  // an anchored popover on desk, a sheet on phones.
  async function peerMenu(p, anchor) {
    if (!p) return;
    const c = contact(p) || {}, name = nameOf(p);
    const extra = [];
    X.menu.forEach((fn) => { try { (fn(p) || []).forEach((x) => { if (x && x.label && typeof x.run === 'function') extra.push(x); }); } catch (_) {} });
    const items = extra.map((x, i) => ({ label: x.label, sub: x.sub, danger: !!x.danger, ico: x.ico, value: 'x' + i }));
    if (X.views.profile) items.unshift({ label: 'View profile', ico: 'user', value: 'profile' });
    items.push(c.state === 'blocked' ? { label: 'Unblock', sub: 'They can message and call you again', ico: 'ban', value: 'unblock' } : { label: 'Block', sub: 'They can no longer message or call you', ico: 'ban', danger: true, value: 'block' });
    items.push({ label: 'Remove contact', sub: 'Also deletes this chat on this device', ico: 'user-x', danger: true, value: 'remove' });
    items.push({ label: 'Clear chat…', sub: 'Deletes the messages on this device only', ico: 'trash', danger: true, value: 'clear' });
    const v = await actionSheet({ title: name, items, anchor: deskPointer() ? anchor : null });
    if (!v || S.peer !== p) return;
    if (v[0] === 'x') { const x = extra[Number(v.slice(1))]; if (x) { try { await x.run(p); } catch (err) { toast((err && err.message) || 'Failed', 'err'); } } return; }
    if (v === 'profile') { S.profileOf = p; S.view = 'profile'; S.viewIsDefault = false; render(); return; }
    if (v === 'unblock') return doUnblock(p);
    if (v === 'block') return doBlock(p);
    if (v === 'remove') return doRemove(p);
    if (v === 'clear') return doClear(p);
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
    toast, esc, shortA, ago, tTime, tDay, tShort, avStyle, nameOf, emojiOf, contact, upsertContact, myName, fmtSize, uid, lsGet, lsSet,
    appendMsg, updateMsg, msgsOf, paintMsgs, paintChatHead, render, open, close: () => close(), openChat, addPerson, copyText, loadScript, inviteLink,
    back, actionSheet, confirm: confirmSheet, whenReady, hubBusy, noteHub, explain, flushOutbox, unread: totalUnread,
    isOpen: () => appIsOpen(),
    // phase 2 (BUILD-SPEC §5.6): icons, the avatar component, bands, the scroller, in-place repaints
    icon, hasIcon, av: avHtml, EMOJIS, layout, band, scroller, paintNav, paintBadge, paintAside,
    sheetMode, placePop, menuKeys, renderCount: () => renderCount,
    // A home tab that registers after the app opened on the DEFAULT view (a cold
    // #mesh link runs before the plugins load) takes over — never a view the user chose.
    register(name, def) { X.views[name] = def; if (def.tab && def.tab.home && (!S.opened || (S.viewIsDefault && S.view !== 'chat'))) S.view = name; if (appIsOpen() && !S.peer) render(); else paintNav(); },
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

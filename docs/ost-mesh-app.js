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
 * window.OST_MESH_APP.{ open, close, addFromText, state }
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
  const uid = () => hex(crypto.getRandomValues(new Uint8Array(8)));
  const hue = (a) => { let h = 0; for (let i = 0; i < a.length; i++) h = (h * 31 + a.charCodeAt(i)) >>> 0; return h % 360; };
  const avStyle = (a) => `background:linear-gradient(135deg,hsl(${hue(a)},70%,52%),hsl(${(hue(a) + 60) % 360},75%,42%))`;
  const lsGet = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v == null ? d : v; } catch (_) { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} };
  let toastHost;
  function toast(msg, kind) {
    try {
      if (!toastHost) { toastHost = document.createElement('div'); toastHost.className = 'omx-toasts'; document.body.appendChild(toastHost); }
      if (kind === 'err') S.lastErr = msg;
      const t = document.createElement('div'); t.className = 'omx-toast' + (kind ? ' ' + kind : ''); t.textContent = msg; toastHost.appendChild(t);
      setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, 3200);
    } catch (_) {}
  }

  /* ---------- state ---------- */
  const S = {
    identity: null, address: '', bundle: null, fp: '', profile: lsGet(K.profile, null),
    contacts: lsGet(K.contacts, {}), seen: new Set(lsGet(K.seen, [])), presence: {},
    view: 'chats', peer: null, keys: {}, blobs: {}, ws: null, wsOk: false, wsTries: 0, announced: false, announceErr: '',
    typingFrom: {}, scanStream: null, scanTimer: null, pendingAdd: null, ready: false
  };
  if (!S.profile) { const old = lsGet('ost.mesh.profile.v2', null); S.profile = { name: (old && (old.nickname || old.handle)) || '', emoji: (old && old.avatar && old.avatar.length <= 4 ? old.avatar : '') || EMOJIS[Math.floor(Math.random() * EMOJIS.length)] }; lsSet(K.profile, S.profile); }
  const myName = () => (S.profile && S.profile.name) || shortA(S.address);
  const contact = (a) => S.contacts[a];
  const nameOf = (a) => { const c = contact(a); return (c && c.name) || shortA(a); };
  const emojiOf = (a) => { const c = contact(a); return (c && c.emoji) || ''; };
  const saveContacts = () => lsSet(K.contacts, S.contacts);
  const msgsOf = (a) => lsGet(K.msgs + a, []);
  const saveMsgs = (a, list) => lsSet(K.msgs + a, list.slice(-MSG_CAP));
  function rememberSeen(id) { if (S.seen.has(id)) return false; S.seen.add(id); if (S.seen.size > 3000) S.seen = new Set([...S.seen].slice(-2000)); lsSet(K.seen, [...S.seen]); return true; }
  function upsertContact(a, patch) { const c = S.contacts[a] || { addr: a, state: 'friend', ts: Date.now(), unread: 0 }; Object.assign(c, patch || {}); S.contacts[a] = c; saveContacts(); return c; }
  function totalUnread() { return Object.values(S.contacts).reduce((n, c) => n + (c.unread || 0), 0); }

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

  /* ---------- signed requests (OST-MESH|v1 canonical, verified by the hub) ---------- */
  async function signHeaders(method, pathq, bodyHash) {
    const ts = Date.now(), nonce = hex(crypto.getRandomValues(new Uint8Array(12)));
    const msg = `OST-MESH|v1|${S.address}|${method}|${pathq}|${bodyHash}|${ts}|${nonce}`;
    const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-384' }, S.identity.sig.privateKey, new TextEncoder().encode(msg));
    return { addr: S.address, ts, nonce, sig: b64(sig) };
  }
  async function signed(method, pathq, body) {
    const isBin = body instanceof Uint8Array || body instanceof ArrayBuffer;
    const bodyText = body && !isBin ? JSON.stringify(body) : '';
    const hashSrc = isBin ? body : new TextEncoder().encode(bodyText);
    const h = await signHeaders(method, pathq, hex(await crypto.subtle.digest('SHA-256', hashSrc)));
    const headers = { 'x-mesh-addr': h.addr, 'x-mesh-ts': String(h.ts), 'x-mesh-nonce': h.nonce, 'x-mesh-sig': h.sig };
    if (bodyText) headers['Content-Type'] = 'application/json';
    if (isBin) headers['Content-Type'] = 'application/octet-stream';
    const r = await fetch(API + pathq, { method, headers, body: isBin ? body : (bodyText || undefined), cache: 'no-store' });
    const j = await r.json().catch(() => null);
    if (r.ok && j && j.ok !== false) return j;
    const code = (j && j.error) || ('http_' + r.status);
    if (code === 'mesh_identity_unknown') { S.announced = false; announce().catch(() => {}); }
    const e = new Error(explain(code)); e.code = code; throw e;
  }
  function explain(code) {
    if (code === 'mesh_identity_unknown') return 'Registering your mesh identity — try again in a few seconds.';
    if (code === 'mesh_auth_stale') return 'Your device clock looks wrong — fix the time and retry.';
    if (/^identity_locked/.test(code)) return 'This address is registered with different keys on the hub. Reset identity in Me to get a fresh address.';
    if (/^http_5|unavailable/.test(code)) return 'The mesh hub is unavailable right now.';
    if (code === 'blob_too_large') return 'That file is over the 6 MB relay limit.';
    if (code === 'blob_rate_limited') return 'Too many files this hour — try again later.';
    return code.replace(/_/g, ' ');
  }
  async function announce() {
    if (!S.identity) return false;
    try {
      const r = await fetch(API + '/mesh/v1/identity/announce', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ address: S.address, bundle: S.bundle, fingerprint: S.fp, profile: { name: S.profile.name || '', emoji: S.profile.emoji || '' } }) });
      const j = await r.json().catch(() => null);
      if (r.ok && j && j.ok) { S.announced = true; S.announceErr = ''; return true; }
      S.announceErr = (j && j.error) || ('http_' + r.status);
    } catch (e) { S.announceErr = 'offline'; }
    S.announced = false; paintStatus(); return false;
  }
  async function lookup(addr) {
    const r = await fetch(API + '/mesh/v1/identity/lookup?address=' + encodeURIComponent(addr), { cache: 'no-store' });
    if (!r.ok) return null;
    const j = await r.json().catch(() => null);
    return j && j.bundle ? j : null;
  }
  async function keyFor(addr) {
    if (S.keys[addr]) return S.keys[addr];
    let c = contact(addr);
    if (!c || !c.bundle) {
      const rec = await lookup(addr);
      if (!rec) throw new Error('This person has not been seen by the hub yet. Ask them to open OST Mesh once.');
      c = upsertContact(addr, { bundle: rec.bundle, fp: rec.fingerprint || '', name: (c && c.name) || (rec.profile && rec.profile.name) || '', emoji: (c && c.emoji) || (rec.profile && rec.profile.emoji) || '' });
    }
    const peer = await importPeerBundle(c.bundle);
    S.keys[addr] = await deriveSessionKey(S.identity, peer.kexPub);
    return S.keys[addr];
  }

  /* ---------- realtime socket + mailbox ---------- */
  function wsUrl() { return API.replace(/^http/, 'ws') + '/mesh/v1/ws'; }
  async function connectWs(force) {
    if (!S.identity) return;
    if (S.ws && (S.ws.readyState === 0 || S.ws.readyState === 1) && !force) return;
    try { if (S.ws) S.ws.close(); } catch (_) {}
    S.ws = null;
    let h; try { h = await signHeaders('GET', '/mesh/v1/ws', hex(await crypto.subtle.digest('SHA-256', new Uint8Array()))); } catch (_) { return; }
    const url = wsUrl() + '?maddr=' + encodeURIComponent(h.addr) + '&mts=' + h.ts + '&mnonce=' + h.nonce + '&msig=' + encodeURIComponent(h.sig);
    let ws; try { ws = new WebSocket(url); } catch (_) { scheduleWs(); return; }
    S.ws = ws;
    ws.onopen = () => { S.wsOk = true; S.wsTries = 0; paintStatus(); syncInbox(); askPresence(); };
    ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch (_) { return; } onWs(m); };
    ws.onclose = () => { if (S.ws === ws) { S.ws = null; } S.wsOk = false; paintStatus(); scheduleWs(); };
    ws.onerror = () => { try { ws.close(); } catch (_) {} };
  }
  function scheduleWs() { if (document.hidden) return; const d = Math.min(30000, 1000 * Math.pow(2, Math.min(5, S.wsTries++))); setTimeout(() => connectWs(), d); }
  function wsSend(obj) { try { if (S.ws && S.ws.readyState === 1) { S.ws.send(JSON.stringify(obj)); return true; } } catch (_) {} return false; }
  function onWs(m) {
    if (!m || typeof m !== 'object') return;
    if (m.t === 'msg' && m.item) { handleIncoming(m.item).then((ok) => { if (ok !== false) wsSend({ t: 'ack', items: [{ id: m.item.id, ts: m.item.ts }] }); }); }
    else if (m.t === 'typing' && m.from) { S.typingFrom[m.from] = Date.now(); if (S.view === 'chat' && S.peer === m.from) paintTyping(); }
    else if (m.t === 'presence' && m.presence) { Object.assign(S.presence, m.presence); if (S.view === 'chats') paintChats(); if (S.view === 'chat') paintChatHead(); }
    else if (m.t === 'hello') { /* authenticated */ }
  }
  async function syncInbox() {
    try {
      const j = await signed('GET', '/mesh/v1/msg/inbox?to=' + encodeURIComponent(S.address) + '&drain=0');
      const items = (j && j.messages) || [];
      const acks = [];
      for (const it of items) { const ok = await handleIncoming(it); if (ok !== false) acks.push({ id: it.id, ts: it.ts }); }
      if (acks.length) { if (!wsSend({ t: 'ack', items: acks })) await signed('POST', '/mesh/v1/msg/ack', { to: S.address, items: acks }).catch(() => {}); }
    } catch (_) {}
  }
  function askPresence() { const addrs = Object.keys(S.contacts).slice(0, 60); if (!addrs.length) return; if (!wsSend({ t: 'presence', addrs })) fetch(API + '/mesh/v1/presence?addrs=' + encodeURIComponent(addrs.join(',')), { cache: 'no-store' }).then((r) => r.json()).then((j) => { if (j && j.presence) { Object.assign(S.presence, j.presence); if (S.view === 'chats') paintChats(); } }).catch(() => {}); }
  const online = (a) => !!(S.presence[a] && S.presence[a].online);

  /* ---------- incoming ---------- */
  async function handleIncoming(item) {
    if (!item || !item.id || !validAddr(item.from)) return true;
    if (!rememberSeen(item.id)) return true;
    const from = item.from, p = item.payload || {};
    if (p.t === 'friend-request') {
      const c = contact(from);
      if (!c || c.state !== 'friend') upsertContact(from, { state: 'pending-in', name: (c && c.name) || (p.profile && p.profile.name) || '', emoji: (c && c.emoji) || (p.profile && p.profile.emoji) || '', ts: item.ts });
      toast((p.profile && p.profile.name ? p.profile.name : shortA(from)) + ' wants to connect');
      if (S.view === 'chats' || S.view === 'add') render();
      return true;
    }
    if (p.t === 'friend-accepted') {
      upsertContact(from, { state: 'friend', name: (contact(from) && contact(from).name) || (p.profile && p.profile.name) || '', emoji: (contact(from) && contact(from).emoji) || (p.profile && p.profile.emoji) || '' });
      try { await keyFor(from); } catch (_) {}
      toast(nameOf(from) + ' accepted — you are connected');
      if (S.view === 'chat' && S.peer === from) { paintChatHead(); paintMsgs(); } else render();
      return true;
    }
    if (p.t === 'dm' && p.sealed) {
      let inner;
      try { const key = await keyFor(from); inner = await openPayload(key, p.sealed); } catch (e) { appendMsg(from, { id: item.id, dir: 'sys', text: 'A message arrived that could not be decrypted (' + (e && e.message || 'key mismatch') + ').', ts: item.ts }); return true; }
      if (!inner || typeof inner !== 'object') return true;
      const c = contact(from); if (!c) upsertContact(from, { state: 'request', ts: item.ts });
      if (inner.profile && inner.profile.name && (!c || !c.name)) upsertContact(from, { name: inner.profile.name, emoji: inner.profile.emoji || '' });
      const msg = { id: inner.id || item.id, dir: 'them', ts: inner.ts || item.ts, kind: inner.k === 'file' ? 'file' : 'text' };
      if (msg.kind === 'text') msg.text = String(inner.text || '').slice(0, 8000);
      else { msg.name = String(inner.name || 'file').slice(0, 120); msg.mime = String(inner.mime || '').slice(0, 80); msg.size = Number(inner.size) || 0; msg.blob = String(inner.blob || ''); msg.thumb = typeof inner.thumb === 'string' && inner.thumb.length < 12000 && /^data:image\//.test(inner.thumb) ? inner.thumb : ''; }
      appendMsg(from, msg);
      const open = S.view === 'chat' && S.peer === from && !document.hidden;
      upsertContact(from, { last: { text: msg.kind === 'file' ? '📎 ' + msg.name : msg.text, ts: msg.ts }, unread: open ? 0 : ((contact(from) || {}).unread || 0) + 1 });
      if (open) { paintMsgs(); } else { toast(nameOf(from) + ': ' + (msg.kind === 'file' ? '📎 ' + msg.name : msg.text.slice(0, 60))); if (S.view === 'chats') paintChats(); }
      paintBadge();
      try { window.dispatchEvent(new CustomEvent('ost:mesh-app:message', { detail: { from, kind: msg.kind } })); } catch (_) {}
      return true;
    }
    return true;
  }
  function appendMsg(a, m) { const list = msgsOf(a); if (m.id && list.some((x) => x.id === m.id)) return; list.push(m); saveMsgs(a, list); }

  /* ---------- outgoing ---------- */
  async function sendText(to, text) {
    const id = uid(), ts = Date.now();
    const msg = { id, dir: 'me', kind: 'text', text, ts, status: 'sending' };
    appendMsg(to, msg); upsertContact(to, { last: { text, ts } }); paintMsgs();
    try {
      const key = await keyFor(to);
      const sealed = await sealPayload(key, { k: 'text', id, text, ts, profile: { name: S.profile.name || '', emoji: S.profile.emoji || '' } });
      const r = await signed('POST', '/mesh/v1/msg/send', { from: S.address, to, payload: { t: 'dm', sealed } });
      setStatus(to, id, r && r.delivered ? 'delivered' : 'sent');
    } catch (e) { setStatus(to, id, 'failed'); toast(e && e.message || 'Send failed', 'err'); }
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
    const id = uid(), ts = Date.now();
    const msg = { id, dir: 'me', kind: 'file', name: file.name, mime: file.type || 'application/octet-stream', size: file.size, ts, status: 'sending', progress: 0 };
    appendMsg(to, msg); upsertContact(to, { last: { text: '📎 ' + file.name, ts } }); paintMsgs();
    try {
      const key = await keyFor(to);
      const bytes = new Uint8Array(await file.arrayBuffer());
      S.blobs['local:' + id] = { url: URL.createObjectURL(file), mime: msg.mime };
      const sealed = await sealBytes(key, bytes);
      const up = await signed('POST', '/mesh/v1/blob?to=' + encodeURIComponent(to) + '&mime=' + encodeURIComponent(msg.mime) + '&name=' + encodeURIComponent(file.name.slice(0, 120)), sealed);
      const thumb = await thumbOf(file);
      const payload = await sealPayload(key, { k: 'file', id, name: file.name, mime: msg.mime, size: file.size, blob: up.id, thumb, ts, profile: { name: S.profile.name || '', emoji: S.profile.emoji || '' } });
      const r = await signed('POST', '/mesh/v1/msg/send', { from: S.address, to, payload: { t: 'dm', sealed: payload } });
      const list = msgsOf(to); const m = list.find((x) => x.id === id); if (m) { m.blob = up.id; m.status = r && r.delivered ? 'delivered' : 'sent'; saveMsgs(to, list); }
      paintMsgs();
    } catch (e) { setStatus(to, id, 'failed'); toast(e && e.message || 'File send failed', 'err'); }
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
      upsertContact(info.addr, { bundle, fp, name: info.name || (rec && rec.profile && rec.profile.name) || (existing && existing.name) || '', emoji: info.emoji || (rec && rec.profile && rec.profile.emoji) || '', state: existing && existing.state === 'pending-in' ? 'pending-in' : 'pending-out', ts: Date.now() });
      if (existing && existing.state === 'pending-in') return acceptPerson(info.addr);
      const r = await signed('POST', '/mesh/v1/friend/request', { from: S.address, to: info.addr, profile: { name: S.profile.name || '', emoji: S.profile.emoji || '' } });
      if (r && r.state === 'accepted') upsertContact(info.addr, { state: 'friend' });
      toast((r && r.state === 'accepted') ? 'Connected with ' + nameOf(info.addr) : 'Request sent to ' + nameOf(info.addr) + (r && r.online ? ' (online now)' : ' — they get it when they open OST'));
      openChat(info.addr);
      return true;
    } catch (e) { toast(e && e.message || 'Could not add', 'err'); return false; }
  }
  async function acceptPerson(addr) {
    try {
      await signed('POST', '/mesh/v1/friend/respond', { wallet: S.address, other: addr, action: 'accept', profile: { name: S.profile.name || '', emoji: S.profile.emoji || '' } });
      upsertContact(addr, { state: 'friend' }); await keyFor(addr).catch(() => {});
      toast('Connected with ' + nameOf(addr)); openChat(addr); return true;
    } catch (e) { toast(e && e.message || 'Could not accept', 'err'); return false; }
  }
  async function declinePerson(addr, block) {
    try { await signed('POST', '/mesh/v1/friend/respond', { wallet: S.address, other: addr, action: block ? 'block' : 'decline' }); } catch (_) {}
    if (block) upsertContact(addr, { state: 'blocked' }); else { delete S.contacts[addr]; saveContacts(); }
    render();
  }
  async function syncFriends() {
    try {
      const j = await signed('GET', '/mesh/v1/friend/list?wallet=' + encodeURIComponent(S.address));
      (j.friends || []).forEach((f) => upsertContact(f.addr, { state: 'friend' }));
      (j.pendingIn || []).forEach((f) => { const c = contact(f.addr); if (!c || c.state !== 'friend') upsertContact(f.addr, { state: 'pending-in', ts: f.ts }); });
      (j.pendingOut || []).forEach((f) => { const c = contact(f.addr); if (!c || c.state !== 'friend') upsertContact(f.addr, { state: 'pending-out', ts: f.ts }); });
      (j.blocked || []).forEach((f) => upsertContact(f.addr, { state: 'blocked' }));
      // Names for contacts that only exist on the hub side.
      for (const a of Object.keys(S.contacts)) { const c = S.contacts[a]; if (!c.name || !c.bundle) { const rec = await lookup(a).catch(() => null); if (rec) upsertContact(a, { bundle: rec.bundle, fp: rec.fingerprint || c.fp || '', name: c.name || (rec.profile && rec.profile.name) || '', emoji: c.emoji || (rec.profile && rec.profile.emoji) || '' }); } }
      if (S.view === 'chats' || S.view === 'add') render();
    } catch (_) {}
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

  /* ---------- UI ---------- */
  let root, body, headEl, tabsEl;
  function mount() {
    if ($('ostMeshApp')) return;
    root = document.createElement('div'); root.id = 'ostMeshApp'; root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true');
    root.innerHTML = '<div class="omx-shell"><div class="omx-head" id="omxHead"></div><div class="omx-body" id="omxBody"></div><div class="omx-tabs" id="omxTabs"></div></div>';
    document.body.appendChild(root);
    body = $('omxBody'); headEl = $('omxHead'); tabsEl = $('omxTabs');
    root.addEventListener('click', (e) => { if (e.target === root) close(); });
    root.addEventListener('click', onClick);
    root.addEventListener('change', onChange);
    root.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  }
  function open(view) {
    mount(); root.classList.add('open'); document.documentElement.classList.add('omx-lock');
    if (view) S.view = view;
    render(); connectWs(); askPresence();
  }
  function close() { stopScan(); if (root) root.classList.remove('open'); document.documentElement.classList.remove('omx-lock'); S.view = S.view === 'chat' ? 'chats' : S.view; }
  function tabsHtml() {
    const u = totalUnread(), req = Object.values(S.contacts).filter((c) => c.state === 'pending-in' || c.state === 'request').length;
    return ['chats', 'add', 'me'].map((v) => `<button data-tab="${v}" class="${S.view === v || (v === 'chats' && S.view === 'chat') ? 'on' : ''}"><b>${v === 'chats' ? '💬' : v === 'add' ? '➕' : '🙂'}</b>${v === 'chats' ? 'Chats' : v === 'add' ? 'Add person' : 'Me'}${v === 'chats' && u ? `<span class="omx-badge">${u > 99 ? '99+' : u}</span>` : ''}${v === 'add' && req ? `<span class="omx-badge">${req}</span>` : ''}</button>`).join('');
  }
  function statusHtml() {
    const cls = S.wsOk ? 'on' : (S.announceErr ? 'off' : '');
    const txt = S.wsOk ? 'Connected · encrypted · messages wait up to 7 days for offline friends' : S.announceErr === 'offline' ? 'Offline — messages send when you are back online' : S.announceErr ? explain(S.announceErr) : 'Connecting…';
    return `<div class="omx-status ${cls}" id="omxStatus"><i></i><span>${esc(txt)}</span></div>`;
  }
  function paintStatus() { const el = $('omxStatus'); if (el) el.outerHTML = statusHtml(); }
  function paintBadge() { if (tabsEl && S.view !== 'chat') tabsEl.innerHTML = tabsHtml(); try { window.dispatchEvent(new CustomEvent('ost:mesh-app:unread', { detail: { count: totalUnread() } })); } catch (_) {} }
  function render() {
    if (!root) return;
    if (S.view !== 'add') stopScan();
    if (S.view === 'chat' && S.peer) { renderChat(); return; }
    headEl.innerHTML = `<h2>OST Mesh<small>${S.view === 'chats' ? 'Private, end-to-end encrypted chat' : S.view === 'add' ? 'Add a real person' : 'Your mesh identity'}</small></h2><button class="omx-ib" data-act="close" aria-label="Close">✕</button>`;
    tabsEl.hidden = false; tabsEl.innerHTML = tabsHtml();
    body.className = 'omx-body';
    if (S.view === 'chats') body.innerHTML = statusHtml() + '<div id="omxChats"></div>', paintChats();
    else if (S.view === 'add') renderAdd();
    else renderMe();
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
      h += '<div class="omx-list">' + list.map((c) => `<button class="omx-item" data-act="chat" data-a="${esc(c.addr)}"><div class="omx-av ${online(c.addr) ? 'on' : ''}" style="${avStyle(c.addr)}">${esc(c.emoji || (c.name || 'm')[0].toUpperCase())}<i></i></div><div class="omx-main"><b>${esc(c.name || shortA(c.addr))}${c.state === 'pending-out' ? ' <small style="opacity:.7">· request sent</small>' : ''}</b><span>${esc((c.last && c.last.text) || (c.state === 'pending-out' ? 'Waiting for them to accept — you can already write' : 'Say hi 👋'))}</span></div><div class="omx-meta"><span>${c.last && c.last.ts ? ago(c.last.ts) : ''}</span>${c.unread ? `<span class="omx-unread">${c.unread}</span>` : ''}</div></button>`).join('') + '</div>';
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
        <div class="omx-steps"><div><b>1</b>Ask for their invite link or QR (Add person → Your invite on their side).</div><div><b>2</b>Scan it here, or paste the link / <code>ost-mesh:</code> address.</div><div><b>3</b>They accept once; after that you both chat and share files any time, even when one of you is offline.</div></div>
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
      <div class="omx-card"><h3>How it works</h3><p>Messages are encrypted on your device for one contact (ECDH P-384 + AES-256-GCM) and relayed by the OST hub, which stores only ciphertext for up to 7 days until your friend is online. Files up to 6 MB travel the same way. Your identity lives in this browser — clearing site data loses it.</p>
        <div class="omx-row2"><button class="omx-ghost" data-act="open-legacy">Classic mesh (calls · games · location)</button><button class="omx-ghost omx-danger" data-act="reset-id">Reset identity</button></div>
        <div class="omx-note">Wallet: ${esc(window.OST_WALLET_PUBKEY ? window.OST_WALLET_PUBKEY.slice(0, 4) + '…' + window.OST_WALLET_PUBKEY.slice(-4) : 'not connected')} · hub ${esc(API.replace(/^https?:\/\//, ''))}</div></div>`;
  }
  function openChat(a) { S.peer = a; S.view = 'chat'; upsertContact(a, { unread: 0 }); paintBadge(); if (root && root.classList.contains('open')) render(); else open(); keyFor(a).catch(() => {}); }
  function paintChatHead() {
    const a = S.peer, c = contact(a) || { addr: a };
    headEl.innerHTML = `<button class="omx-ib" data-act="back" aria-label="Back">‹</button><div class="omx-av ${online(a) ? 'on' : ''}" style="${avStyle(a)};width:38px;height:38px;border-radius:12px;font-size:1.1rem">${esc(c.emoji || (c.name || 'm')[0].toUpperCase())}<i></i></div><h2>${esc(c.name || shortA(a))}<small>${online(a) ? 'online' : (S.presence[a] && S.presence[a].lastSeen ? 'last seen ' + ago(S.presence[a].lastSeen) + ' ago' : 'offline — they get your messages later')} · ${c.state === 'friend' ? 'encrypted' : c.state === 'pending-out' ? 'request sent' : 'not accepted yet'}</small></h2><button class="omx-ib" data-act="peer-menu" aria-label="Options">⋯</button>`;
  }
  function renderChat() {
    const a = S.peer; const c = contact(a);
    paintChatHead();
    tabsEl.hidden = true;
    body.className = 'omx-body omx-chat'; body.style.padding = '0';
    body.innerHTML = `<div class="omx-msgs" id="omxMsgs"></div><div class="omx-typing" id="omxTyping"></div>` +
      (c && c.state === 'blocked' ? `<div class="omx-card" style="margin:10px">You blocked this contact. <button class="omx-ghost" data-act="unblock">Unblock</button></div>` :
      `<div class="omx-compose"><label class="omx-ib" title="Send a photo or file"><input type="file" id="omxFile" hidden multiple>📎</label><textarea id="omxText" rows="1" placeholder="Message…" enterkeyhint="send"></textarea><button class="omx-ib omx-send" data-act="send" id="omxSend" aria-label="Send">➤</button></div>`);
    const ta = $('omxText');
    if (ta) {
      ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = Math.min(120, ta.scrollHeight) + 'px'; throttleTyping(); });
      ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !(window.matchMedia && window.matchMedia('(pointer: coarse)').matches)) { e.preventDefault(); doSend(); } });
      setTimeout(() => { try { ta.focus({ preventScroll: true }); } catch (_) {} }, 50);
    }
    paintMsgs(true);
  }
  let typingAt = 0; function throttleTyping() { const n = Date.now(); if (n - typingAt > 2500) { typingAt = n; wsSend({ t: 'typing', to: S.peer }); } }
  function paintTyping() { const el = $('omxTyping'); if (!el) return; const t = S.typingFrom[S.peer] || 0; el.textContent = Date.now() - t < 4000 ? nameOf(S.peer) + ' is typing…' : ''; if (Date.now() - t < 4000) setTimeout(paintTyping, 4200); }
  function msgHtml(m, from) {
    if (m.dir === 'sys') return `<div class="omx-b sys">${esc(m.text)}</div>`;
    const st = m.dir === 'me' ? (m.status === 'failed' ? ' · failed, tap to retry' : m.status === 'delivered' ? ' ✓✓' : m.status === 'sent' ? ' ✓' : m.status === 'sending' ? ' …' : '') : '';
    let inner = '';
    if (m.kind === 'file') {
      const cached = S.blobs[m.blob] || S.blobs['local:' + m.id];
      const isImg = /^image\//.test(m.mime || ''), isVid = /^video\//.test(m.mime || ''), isAud = /^audio\//.test(m.mime || '');
      if (cached && isImg) inner += `<img src="${cached.url}" alt="${esc(m.name)}" loading="lazy">`;
      else if (cached && isVid) inner += `<video src="${cached.url}" controls playsinline></video>`;
      else if (cached && isAud) inner += `<audio src="${cached.url}" controls style="width:100%"></audio>`;
      else if (m.thumb && isImg) inner += `<img src="${esc(m.thumb)}" alt="" style="filter:blur(2px);opacity:.8" data-act="dl" data-id="${esc(m.id)}">`;
      inner += `<a class="omx-file" ${cached ? `href="${cached.url}" download="${esc(m.name)}"` : `href="#" data-act="dl" data-id="${esc(m.id)}"`}><b>${isImg ? '🖼️' : isVid ? '🎬' : isAud ? '🎵' : /pdf/.test(m.mime || '') ? '📄' : '📎'}</b><div style="min-width:0"><span>${esc(m.name)}</span><small>${fmtSize(m.size || 0)}${cached ? ' · tap to save' : m.status === 'sending' ? ' · encrypting & uploading…' : ' · tap to download'}</small></div></a>`;
      if (m.status === 'sending') inner += '<div class="omx-prog"><i style="width:60%"></i></div>';
    } else inner = esc(m.text).replace(/(https?:\/\/[^\s<]+)/g, (u) => `<a href="${u}" target="_blank" rel="noopener" style="color:inherit;text-decoration:underline">${u}</a>`);
    return `<div class="omx-b ${m.dir}" data-id="${esc(m.id)}" ${m.status === 'failed' ? `data-act="retry"` : ''}>${inner}<span class="omx-t">${tTime(m.ts)}${st}</span></div>`;
  }
  function paintMsgs(jump) {
    const el = $('omxMsgs'); if (!el) return;
    const a = S.peer; const list = msgsOf(a);
    const atBottom = jump || (el.scrollHeight - el.scrollTop - el.clientHeight < 80);
    let h = '', day = '';
    if (!list.length) h = `<div class="omx-b sys">Messages are end-to-end encrypted. ${contact(a) && contact(a).state === 'pending-out' ? 'You can write now; ' + esc(nameOf(a)) + ' sees it as soon as they open OST.' : 'Say hi 👋'}</div>`;
    for (const m of list) { const d = tDay(m.ts); if (d !== day) { day = d; h += `<div class="omx-day">${d}</div>`; } h += msgHtml(m, a); }
    el.innerHTML = h;
    if (atBottom) el.scrollTop = el.scrollHeight;
    // Auto-fetch small images so the chat feels alive.
    list.filter((m) => m.kind === 'file' && m.blob && /^image\//.test(m.mime || '') && (m.size || 0) <= AUTO_FETCH_IMG && !S.blobs[m.blob] && !S.blobs['local:' + m.id] && !S.blobs['pending:' + m.blob]).slice(-6).forEach((m) => { fetchBlob(m.dir === 'me' ? S.address : a, m).then(() => paintMsgs()).catch(() => {}); });
  }
  function doSend() { const ta = $('omxText'); if (!ta) return; const text = ta.value.trim(); if (!text) return; ta.value = ''; ta.style.height = 'auto'; sendText(S.peer, text); }

  /* ---------- events ---------- */
  function onChange(e) {
    const t = e.target;
    if (t && t.id === 'omxFile' && t.files && t.files.length) { Array.from(t.files).slice(0, 6).forEach((f) => sendFile(S.peer, f)); t.value = ''; }
  }
  async function onClick(e) {
    const t = e.target.closest('[data-act],[data-tab]'); if (!t) return;
    if (t.hasAttribute('data-tab')) { S.view = t.getAttribute('data-tab'); render(); return; }
    const act = t.getAttribute('data-act'), a = t.getAttribute('data-a');
    switch (act) {
      case 'close': close(); break;
      case 'back': S.view = 'chats'; S.peer = null; body.style.padding = ''; render(); break;
      case 'chat': openChat(a); break;
      case 'accept': acceptPerson(a); break;
      case 'decline': declinePerson(a, false); break;
      case 'send': doSend(); break;
      case 'retry': { const id = t.getAttribute('data-id'); const list = msgsOf(S.peer); const m = list.find((x) => x.id === id); if (m && m.kind === 'text') { const idx = list.indexOf(m); list.splice(idx, 1); saveMsgs(S.peer, list); sendText(S.peer, m.text); } break; }
      case 'dl': { e.preventDefault(); const id = t.getAttribute('data-id'); const m = msgsOf(S.peer).find((x) => x.id === id); if (!m) return; t.style.opacity = '.6'; try { await fetchBlob(m.dir === 'me' ? S.address : S.peer, m); paintMsgs(); } catch (err) { toast(err && err.message || 'Download failed', 'err'); t.style.opacity = ''; } break; }
      case 'copy-link': copyText(inviteLink(), 'Invite link copied — send it to your friend'); break;
      case 'copy-addr': copyText(S.address, 'Address copied'); break;
      case 'share-link': try { await navigator.share({ title: 'Chat with me on OST Mesh', text: 'Add me on OST Mesh: ' + inviteLink() }); } catch (_) {} break;
      case 'scan': { const w = $('omxScanWrap'); if (!w) return; if (!w.hidden && S.scanStream) { stopScan(); w.hidden = true; t.textContent = '📷 Scan QR'; return; } w.hidden = false; t.textContent = '■ Stop camera'; startScan($('omxVideo'), (info) => { S.pendingAdd = info; render(); }, (s) => { const st = $('omxScanStatus'); if (st) st.textContent = s; }); break; }
      case 'paste': try { const txt = await navigator.clipboard.readText(); const info = parseAddText(txt); if (!info) { toast('Clipboard has no OST Mesh link.', 'err'); return; } S.pendingAdd = info; render(); } catch (_) { toast('Clipboard not available — paste into the box.', 'err'); } break;
      case 'add-go': { const info = parseAddText(($('omxAddInput') || {}).value); if (!info) { toast('Paste an invite link or an ost-mesh: address.', 'err'); return; } t.disabled = true; t.textContent = 'Adding…'; await addPerson(info); break; }
      case 'add-confirm': { const info = S.pendingAdd; S.pendingAdd = null; t.disabled = true; t.textContent = 'Adding…'; await addPerson(info); if (S.view === 'add') render(); break; }
      case 'add-cancel': S.pendingAdd = null; render(); break;
      case 'emoji': S.profile.emoji = t.getAttribute('data-e'); lsSet(K.profile, S.profile); S.announced = false; renderMe(); announce().catch(() => {}); break;
      case 'save-profile': { const n = ($('omxName') || {}).value || ''; S.profile.name = n.trim().slice(0, 32); lsSet(K.profile, S.profile); S.announced = false; toast('Saved — friends see “' + (S.profile.name || shortA(S.address)) + '”'); renderMe(); await announce(); if (S.view === 'me') paintStatus(); break; }
      case 'open-legacy': openLegacy(); break;
      case 'reset-id': if (confirm('Reset your mesh identity? You get a new address and keys; friends must add you again. Chats stay on this device.')) { await resetIdentity(); toast('New identity: ' + shortA(S.address)); render(); } break;
      case 'peer-menu': { const c = contact(S.peer); const choice = prompt('Type: block, remove, or cancel', 'cancel'); if (choice === 'block') { await declinePerson(S.peer, true); S.view = 'chats'; render(); } else if (choice === 'remove') { await declinePerson(S.peer, false); try { localStorage.removeItem(K.msgs + S.peer); } catch (_) {} S.view = 'chats'; S.peer = null; render(); } else if (c) { /* no-op */ } break; }
      case 'unblock': try { await signed('POST', '/mesh/v1/friend/respond', { wallet: S.address, other: S.peer, action: 'unblock' }); upsertContact(S.peer, { state: 'friend' }); render(); } catch (err) { toast(err.message, 'err'); } break;
    }
  }
  function copyText(text, msg) { const done = () => toast(msg || 'Copied'); try { if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(text).then(done, fallback); return; } } catch (_) {} fallback(); function fallback() { try { const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); done(); } catch (_) { toast('Copy failed — long-press the link to copy it.', 'err'); } } }
  function openLegacy() {
    toast('Opening classic mesh…');
    try { if (window.OST_LAZY && OST_LAZY.flush) OST_LAZY.flush(); } catch (_) {}
    let n = 0; const iv = setInterval(() => { if (window.OST_MESH && typeof OST_MESH.open === 'function') { clearInterval(iv); close(); OST_MESH.open(); } else if (++n > 60) { clearInterval(iv); toast('Classic mesh did not load — reload and try again.', 'err'); } }, 250);
  }

  /* ---------- deep links: #mesh, #mesh-add=… ---------- */
  function handleHash() {
    const h = location.hash || '';
    if (/^#mesh-add=/.test(h)) {
      const info = parseAddText(h);
      try { history.replaceState(null, '', location.pathname + location.search); } catch (_) {}
      if (info) { S.pendingAdd = info; whenReady(() => open('add')); }
      return true;
    }
    if (h === '#mesh' || h === '#mesh-app' || h === '#chat') { try { history.replaceState(null, '', location.pathname + location.search); } catch (_) {} whenReady(() => open('chats')); return true; }
    if (/^#mesh=/.test(h)) { const info = parseAddText(decodeURIComponent(h.slice(6))); try { history.replaceState(null, '', location.pathname + location.search); } catch (_) {} if (info) { S.pendingAdd = info; whenReady(() => open('add')); } return true; }
    return false;
  }
  const readyQ = []; function whenReady(fn) { if (S.ready) fn(); else readyQ.push(fn); }

  /* ---------- boot ---------- */
  async function boot() {
    mount();
    try { await loadIdentity(); } catch (e) { console.warn('[mesh-app] identity failed', e); return; }
    S.ready = true; readyQ.splice(0).forEach((fn) => { try { fn(); } catch (_) {} });
    announce().then(() => { connectWs(); syncFriends(); syncInbox(); });
    // Socket keepalive every 25s; when the socket cannot connect (strict proxies,
    // some corporate Wi-Fi) fall back to polling the mailbox every 6s while the
    // sheet is open so chat still feels live.
    setInterval(() => { if (document.hidden) return; if (!S.wsOk) { connectWs(); syncInbox(); } else wsSend({ t: 'ping' }); askPresence(); }, 25000);
    setInterval(() => { if (document.hidden || S.wsOk || !root || !root.classList.contains('open')) return; syncInbox(); }, 6000);
    setInterval(() => { if (!document.hidden) announce(); }, 6 * 3600 * 1000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { connectWs(); syncInbox(); askPresence(); } });
    window.addEventListener('online', () => { connectWs(); syncInbox(); });
    window.addEventListener('hashchange', handleHash);
    handleHash();
    paintBadge();
  }
  window.OST_MESH_APP = {
    open, close, openChat,
    addFromText: (text) => { const info = parseAddText(text); if (info) { S.pendingAdd = info; open('add'); } return !!info; },
    inviteLink, unread: totalUnread, sync: () => { connectWs(); syncInbox(); askPresence(); },
    state: () => ({ address: S.address, connected: S.wsOk, announced: S.announced, announceErr: S.announceErr, lastErr: S.lastErr || '', contacts: Object.keys(S.contacts).length, view: S.view })
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true }); else boot();
}

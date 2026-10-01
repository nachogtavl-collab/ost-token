/* workers/ost-api/src/mesh/hub.js
  Durable Object-backed OST Mesh directory and signaling hub.
  Keeps active WebRTC signaling off KV so daily KV write limits cannot break P2P.
*/

const ID_PREFIX = 'id:';
const FEED_PREFIX = 'feed:';
const FEED_TTL_MS = 60 * 60 * 24 * 3 * 1000;   // shared feed posts live 3 days
const FEED_MAX = 200;
const ID_TTL_MS = 60 * 60 * 24 * 7 * 1000;
const SIGNAL_TTL_MS = 60 * 5 * 1000;
const MAX_PER_INBOX = 128;
// These were USED by the msg-mailbox + presence code but never defined — every
// call to /mesh/v1/msg/send, /msg/inbox and /presence threw ReferenceError, so
// server-relayed (offline) contact silently never worked. Defining them turns
// the mailbox on. Messages persist a week so an offline peer still receives them.
const MSG_PREFIX = 'msg:';
const MSG_TTL_MS = 60 * 60 * 24 * 7 * 1000;   // 7-day offline delivery window
const SEEN_PREFIX = 'seen:';
const SEEN_TTL_MS = 2 * 60 * 1000;            // "online" if seen within 2 min
const MAX_INBOX = 128;
// Friend graph: friend:<owner>:<other> -> { state, ts }. DO storage (not KV) so
// contacts survive KV exhaustion.
const FRIEND_PREFIX = 'friend:';
// Encrypted blob relay (files / images between contacts). Bytes are sealed by
// the sender with the pairwise key before upload, so the hub only ever stores
// ciphertext. Chunked so each stored value stays well under the DO value cap.
const BLOB_META_PREFIX = 'blobmeta:';
const BLOB_CHUNK_PREFIX = 'blob:';
const BLOB_CHUNK_BYTES = 512 * 1024;
const BLOB_MAX_BYTES = 6 * 1024 * 1024;
const BLOB_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const BLOB_PER_HOUR = 80;
const MSG_PAYLOAD_MAX = 64_000;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-ost-wallet, x-ost-ts, x-ost-nonce, x-ost-sig, x-ost-session, x-ost-internal, x-mesh-addr, x-mesh-ts, x-mesh-nonce, x-mesh-sig',
  'Access-Control-Max-Age': '86400'
};

function cors(extra = {}) {
  return { ...CORS_HEADERS, ...extra };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: cors({ 'Content-Type': 'application/json' })
  });
}

function fail(error, status = 400) {
  return json({ ok: false, error }, status);
}

function validAddr(value) {
  // Addresses are 'ost-mesh:' + hex groups joined by '-' (mesh.js:234). Anything
  // else is rejected — a prefix-only check let arbitrary text reach innerHTML.
  return typeof value === 'string' && value.length <= 80 && /^ost-mesh:[0-9a-f]{2,}(?:-[0-9a-f]{1,4})*$/i.test(value);
}

function messageId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function isExpired(record, now = Date.now()) {
  return !record || Number(record.expiresAt || 0) <= now;
}


// ── MESH REQUEST AUTH ───────────────────────────────────────────────────────
// A mesh address is a random label; what PROVES ownership is the ECDSA P-384 signing
// key registered for it in the directory (trust-on-first-use, see announce()). The
// friend graph and mailbox used to accept any caller: anyone could accept a friend
// request AS you, send messages AS you, or drain (delete) your mailbox. Every such
// request must now be signed by the address's own key:
//   OST-MESH|v1|<addr>|<METHOD>|<path+query>|<sha256hex(body)>|<ts>|<nonce>
// headers: x-mesh-addr, x-mesh-ts, x-mesh-nonce, x-mesh-sig (base64, IEEE-P1363).
const MESH_AUTH_WINDOW_MS = 5 * 60 * 1000;
function b64ToBytes(b64) { const bin = atob(String(b64 || '')); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; }
async function sha256Hex(text) { const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text || '')); return Array.from(new Uint8Array(d)).map(b => b.toString(16).padStart(2, '0')).join(''); }
async function sha256HexBytes(bytes) { const d = await crypto.subtle.digest('SHA-256', bytes); return Array.from(new Uint8Array(d)).map(b => b.toString(16).padStart(2, '0')).join(''); }
function pad14(ts) { return String(ts).padStart(14, '0'); }
function cleanProfile(p) {
  if (!p || typeof p !== 'object') return null;
  const name = String(p.name || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 32);
  const emoji = String(p.emoji || '').trim().slice(0, 8);
  if (!name && !emoji) return null;
  return { name, emoji };
}
export function meshCanonical({ addr, method, pathq, bodyHash, ts, nonce }) { return `OST-MESH|v1|${addr}|${String(method).toUpperCase()}|${pathq}|${bodyHash}|${ts}|${nonce}`; }

export class MeshHub {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.ids = new Map();
    this.inboxes = new Map();
  }


  // Returns { ok:true, addr } or { ok:false, error, status }. Never throws.
  async verifyMeshAuth(request, url, bodyText, actor, opts = {}) {
    try {
      // Browsers cannot set headers on a WebSocket upgrade, so /ws carries the
      // same four fields as query params (stripped from the signed path+query).
      const q = opts.fromQuery ? url.searchParams : null;
      const h = (n) => (q ? (q.get(n.replace(/^x-mesh-/, 'm')) || '') : (request.headers.get(n) || ''));
      const addr = h('x-mesh-addr'), ts = Number(h('x-mesh-ts')), nonce = h('x-mesh-nonce'), sig = h('x-mesh-sig');
      if (!addr || !sig || !nonce || !Number.isFinite(ts)) return { ok: false, error: 'mesh_auth_required', status: 401 };
      if (!validAddr(addr) || addr !== actor) return { ok: false, error: 'mesh_auth_wrong_actor', status: 403 };
      if (Math.abs(Date.now() - ts) > MESH_AUTH_WINDOW_MS) return { ok: false, error: 'mesh_auth_stale', status: 401 };
      if (!/^[0-9a-f]{16,64}$/i.test(nonce)) return { ok: false, error: 'mesh_auth_bad_nonce', status: 401 };
      let rec = this.ids.get(addr);
      if (!rec) rec = await this.state.storage.get(ID_PREFIX + addr).catch(() => null);
      const jwk = rec && rec.bundle && rec.bundle.sig;
      if (!jwk || isExpired(rec)) return { ok: false, error: 'mesh_identity_unknown', status: 401 };   // announce first
      const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-384' }, false, ['verify']);
      let pathq = url.pathname.replace(/\/$/, '') + url.search;
      if (q) { const u2 = new URL(url.toString()); ['maddr', 'mts', 'mnonce', 'msig'].forEach((k) => u2.searchParams.delete(k)); pathq = u2.pathname.replace(/\/$/, '') + u2.search; }
      const bodyHash = opts.bodyHash || await sha256Hex(bodyText);
      const msg = meshCanonical({ addr, method: request.method, pathq, bodyHash, ts, nonce });
      const good = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-384' }, key, b64ToBytes(sig), new TextEncoder().encode(msg));
      if (!good) return { ok: false, error: 'mesh_auth_bad_signature', status: 401 };
      // Replay guard (durable: survives DO eviction). Keys self-expire via sweep below.
      const nk = 'meshnonce:' + addr + ':' + nonce;
      if (await this.state.storage.get(nk).catch(() => null)) return { ok: false, error: 'mesh_auth_replay', status: 401 };
      await this.state.storage.put(nk, Date.now() + 2 * MESH_AUTH_WINDOW_MS);
      if (Math.random() < 0.02) this.sweepMeshNonces().catch(() => {});
      return { ok: true, addr };
    } catch (e) { return { ok: false, error: 'mesh_auth_error', status: 401 }; }
  }
  async sweepMeshNonces() {
    const now = Date.now(), listed = await this.state.storage.list({ prefix: 'meshnonce:', limit: 512 }), del = [];
    for (const [k, exp] of listed) if (Number(exp) <= now) del.push(k);
    if (del.length) await this.state.storage.delete(del.slice(0, 128));
  }

  async fetch(request) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors() });

    try {
      const url = new URL(request.url);
      const path = url.pathname.replace(/\/$/, '') || '/';
      const method = request.method;

      if (path === '/mesh/v1/health') {
        return json({ ok: true, mesh: 'v1', hub: 'durable-object', ws: true, blobs: true, ts: new Date().toISOString() });
      }

      // ── Realtime socket: pushes mailbox messages + signaling instantly ──────
      if (path === '/mesh/v1/ws') {
        if ((request.headers.get('Upgrade') || '').toLowerCase() !== 'websocket') return fail('expected websocket upgrade', 426);
        const actor = url.searchParams.get('maddr') || '';
        const auth = await this.verifyMeshAuth(request, url, '', actor, { fromQuery: true });
        if (!auth.ok) return fail(auth.error, auth.status);
        const pair = new WebSocketPair();
        const client = pair[0], server = pair[1];
        this.state.acceptWebSocket(server, [auth.addr]);
        try { server.serializeAttachment({ addr: auth.addr, at: Date.now() }); } catch (_) {}
        await this.state.storage.put(SEEN_PREFIX + auth.addr, Date.now()).catch(() => {});
        try { server.send(JSON.stringify({ t: 'hello', addr: auth.addr, ts: Date.now() })); } catch (_) {}
        return new Response(null, { status: 101, webSocket: client });
      }

      // ── Encrypted blob relay ────────────────────────────────────────────────
      if (method === 'POST' && path === '/mesh/v1/blob') {
        const bytes = new Uint8Array(await request.arrayBuffer());
        if (!bytes.length) return fail('empty_blob');
        if (bytes.length > BLOB_MAX_BYTES) return fail('blob_too_large', 413);
        const actor = request.headers.get('x-mesh-addr') || '';
        const auth = await this.verifyMeshAuth(request, url, '', actor, { bodyHash: await sha256HexBytes(bytes) });
        if (!auth.ok) return fail(auth.error, auth.status);
        return this.blobPut(auth.addr, url, bytes);
      }
      if (method === 'GET' && path.startsWith('/mesh/v1/blob/')) {
        return this.blobGet(path.slice('/mesh/v1/blob/'.length));
      }
      if (method === 'POST' && path === '/mesh/v1/msg/ack') {
        const bodyText = await request.text();
        let body = {}; try { body = JSON.parse(bodyText) || {}; } catch (_) {}
        const auth = await this.verifyMeshAuth(request, url, bodyText, body && body.to);
        if (!auth.ok) return fail(auth.error, auth.status);
        return this.msgAck(auth.addr, body.items);
      }

      if (method === 'GET' && path === '/mesh/v1/directory') {
        return this.directory();
      }

      if (method === 'POST' && path === '/mesh/v1/identity/announce') {
        const body = await request.json().catch(() => ({}));
        return this.announce(body);
      }

      if (method === 'GET' && path === '/mesh/v1/identity/lookup') {
        return this.lookup(url.searchParams.get('address'));
      }

      if (method === 'POST' && path === '/mesh/v1/signal/send') {
        const body = await request.json().catch(() => ({}));
        return this.signal(body);
      }

      if (method === 'GET' && path === '/mesh/v1/signal/inbox') {
        return this.inbox({
          to: url.searchParams.get('to'),
          from: url.searchParams.get('from'),
          since: Number(url.searchParams.get('since') || 0)
        });
      }

      if (method === 'POST' && path === '/mesh/v1/msg/send') {
        const bodyText = await request.text();
        let body = {}; try { body = JSON.parse(bodyText) || {}; } catch (_) {}
        const auth = await this.verifyMeshAuth(request, url, bodyText, body && body.from);
        if (!auth.ok) return fail(auth.error, auth.status);
        return this.msgSend(body);
      }
      if (method === 'GET' && path === '/mesh/v1/msg/inbox') {
        { const auth = await this.verifyMeshAuth(request, url, '', url.searchParams.get('to')); if (!auth.ok) return fail(auth.error, auth.status); }
        return this.msgInbox(url.searchParams.get('to'), url.searchParams.get('drain'));
      }
      // ── Friend graph (contact WITHOUT P2P) ──────────────────────────────
      if (method === 'POST' && path === '/mesh/v1/friend/request') {
        const bodyText = await request.text();
        let body = {}; try { body = JSON.parse(bodyText) || {}; } catch (_) {}
        const auth = await this.verifyMeshAuth(request, url, bodyText, body && body.from);
        if (!auth.ok) return fail(auth.error, auth.status);
        return this.friendRequest(body);
      }
      if (method === 'POST' && path === '/mesh/v1/friend/respond') {
        const bodyText = await request.text();
        let body = {}; try { body = JSON.parse(bodyText) || {}; } catch (_) {}
        const auth = await this.verifyMeshAuth(request, url, bodyText, body && body.wallet);
        if (!auth.ok) return fail(auth.error, auth.status);
        return this.friendRespond(body);
      }
      if (method === 'GET' && path === '/mesh/v1/friend/list') {
        { const auth = await this.verifyMeshAuth(request, url, '', url.searchParams.get('wallet')); if (!auth.ok) return fail(auth.error, auth.status); }
        return this.friendList(url.searchParams.get('wallet'));
      }
      if (method === 'POST' && path === '/mesh/v1/presence') {
        const body = await request.json().catch(() => ({}));
        return this.presencePing(body && body.addr);
      }
      if (method === 'GET' && path === '/mesh/v1/presence') {
        return this.presenceQuery(url.searchParams.get('addrs'));
      }
      // Shared social feed — a lightweight relayed timeline so all mesh users see
      // one social stream (P2P has no global timeline on its own). Off KV, on the DO.
      if (method === 'POST' && path === '/mesh/v1/feed/post') {
        const body = await request.json().catch(() => ({}));
        return this.feedPost(body);
      }
      if (method === 'GET' && path === '/mesh/v1/feed/recent') {
        return this.feedRecent(url.searchParams.get('limit'));
      }
      if (method === 'POST' && path === '/mesh/v1/feed/react') {
        const body = await request.json().catch(() => ({}));
        return this.feedReact(body);
      }
      if (method === 'POST' && path === '/mesh/v1/feed/reply') {
        const body = await request.json().catch(() => ({}));
        return this.feedReply(body);
      }
      if (method === 'POST' && path === '/mesh/v1/feed/donate') {
        const body = await request.json().catch(() => ({}));
        return this.feedDonate(body);
      }
      // Admin moderation: clear the whole feed, or delete one post. Gated by a
      // secret so only the operator can wipe test/spam data — keeps the feed real.
      if (method === 'POST' && path === '/mesh/v1/feed/clear') {
        const body = await request.json().catch(() => ({}));
        if (!this.env || !this.env.MESH_ADMIN_KEY || body.key !== this.env.MESH_ADMIN_KEY) return fail('unauthorized', 403);
        return this.feedClear(body.postId);
      }

      return fail('mesh route not found: ' + method + ' ' + path, 404);
    } catch (error) {
      return fail('mesh hub error: ' + String(error?.message || error), 500);
    }
  }

  /* ---- realtime push ---- */
  _pushTo(addr, obj) {
    let n = 0;
    try {
      const text = JSON.stringify(obj);
      for (const ws of this.state.getWebSockets(addr)) { try { ws.send(text); n++; } catch (_) {} }
    } catch (_) {}
    return n;
  }
  _online(addr) { try { return this.state.getWebSockets(addr).length > 0; } catch (_) { return false; } }
  _wsAddr(ws) { try { const a = ws.deserializeAttachment(); return a && a.addr; } catch (_) { return null; } }
  async webSocketMessage(ws, raw) {
    const addr = this._wsAddr(ws); if (!addr) return;
    let m = null; try { m = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw)); } catch (_) { return; }
    if (!m || typeof m !== 'object') return;
    const now = Date.now();
    if (m.t === 'ping') {
      await this.state.storage.put(SEEN_PREFIX + addr, now).catch(() => {});
      try { ws.send(JSON.stringify({ t: 'pong', ts: now })); } catch (_) {}
      return;
    }
    if (m.t === 'signal' && validAddr(m.to) && m.payload && typeof m.payload === 'object') {
      if (JSON.stringify(m.payload).length > 32_000) return;
      const record = { id: messageId(), from: addr, to: m.to, ts: now, payload: m.payload };
      if (!this._pushTo(m.to, { t: 'signal', item: record })) {
        // Peer not on a socket right now: park it in the poll inbox too.
        const inbox = this.inboxes.get(m.to) || []; inbox.push(record); this.inboxes.set(m.to, inbox.slice(-MAX_PER_INBOX));
      }
      return;
    }
    if (m.t === 'typing' && validAddr(m.to)) { this._pushTo(m.to, { t: 'typing', from: addr, ts: now }); return; }
    if (m.t === 'ack' && Array.isArray(m.items)) { await this.msgAck(addr, m.items); return; }
    if (m.t === 'presence' && Array.isArray(m.addrs)) {
      const out = {};
      for (const a of m.addrs.filter(validAddr).slice(0, 60)) { const ts = Number(await this.state.storage.get(SEEN_PREFIX + a).catch(() => 0)) || 0; out[a] = { online: this._online(a) || (ts > 0 && now - ts < SEEN_TTL_MS), lastSeen: ts || null }; }
      try { ws.send(JSON.stringify({ t: 'presence', presence: out, ts: now })); } catch (_) {}
    }
  }
  async webSocketClose(ws) { const addr = this._wsAddr(ws); if (addr) await this.state.storage.put(SEEN_PREFIX + addr, Date.now()).catch(() => {}); try { ws.close(); } catch (_) {} }
  async webSocketError(ws) { try { ws.close(); } catch (_) {} }

  async msgAck(addr, items) {
    if (!validAddr(addr) || !Array.isArray(items)) return json({ ok: true, removed: 0 });
    const del = [];
    for (const it of items.slice(0, 200)) {
      if (!it || !it.id || !Number.isFinite(Number(it.ts))) continue;
      del.push(MSG_PREFIX + addr + ':' + pad14(Number(it.ts)) + ':' + String(it.id).slice(0, 64));
    }
    if (del.length) await this.state.storage.delete(del).catch(() => {});
    return json({ ok: true, removed: del.length });
  }

  /* ---- encrypted blob relay ---- */
  async blobPut(from, url, bytes) {
    const to = url.searchParams.get('to') || '';
    if (!validAddr(to)) return fail('bad to');
    const now = Date.now();
    this._blobRate = this._blobRate || new Map();
    const win = this._blobRate.get(from) || { at: now, n: 0 };
    if (now - win.at > 3600_000) { win.at = now; win.n = 0; }
    if (++win.n > BLOB_PER_HOUR) return fail('blob_rate_limited', 429);
    this._blobRate.set(from, win);
    const id = messageId().replace(/-/g, '') + Array.from(crypto.getRandomValues(new Uint8Array(8))).map((b) => b.toString(16).padStart(2, '0')).join('');
    const n = Math.ceil(bytes.length / BLOB_CHUNK_BYTES);
    for (let i = 0; i < n; i++) {
      const part = bytes.slice(i * BLOB_CHUNK_BYTES, (i + 1) * BLOB_CHUNK_BYTES);
      await this.state.storage.put(BLOB_CHUNK_PREFIX + id + ':' + String(i).padStart(3, '0'), part.buffer.slice(part.byteOffset, part.byteOffset + part.byteLength));
    }
    const meta = { id, from, to, size: bytes.length, n, mime: String(url.searchParams.get('mime') || '').slice(0, 80), name: String(url.searchParams.get('name') || '').slice(0, 120), ts: now, expiresAt: now + BLOB_TTL_MS };
    await this.state.storage.put(BLOB_META_PREFIX + id, meta);
    if (Math.random() < 0.05) this.sweepBlobs().catch(() => {});
    return json({ ok: true, id, size: bytes.length, expiresAt: meta.expiresAt });
  }
  async blobGet(id) {
    if (!/^[0-9a-f]{24,80}$/i.test(id)) return fail('bad blob id');
    const meta = await this.state.storage.get(BLOB_META_PREFIX + id).catch(() => null);
    if (!meta || Number(meta.expiresAt || 0) <= Date.now()) return fail('blob_not_found', 404);
    const parts = [];
    for (let i = 0; i < meta.n; i++) { const c = await this.state.storage.get(BLOB_CHUNK_PREFIX + id + ':' + String(i).padStart(3, '0')); if (!c) return fail('blob_incomplete', 410); parts.push(new Uint8Array(c)); }
    const out = new Uint8Array(meta.size); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
    return new Response(out, { status: 200, headers: cors({ 'Content-Type': 'application/octet-stream', 'Cache-Control': 'private, max-age=86400', 'X-Blob-Size': String(meta.size) }) });
  }
  async sweepBlobs() {
    const now = Date.now();
    const listed = await this.state.storage.list({ prefix: BLOB_META_PREFIX, limit: 200 });
    for (const [k, meta] of listed) {
      if (!meta || Number(meta.expiresAt || 0) > now) continue;
      const del = [k]; for (let i = 0; i < (meta.n || 0); i++) del.push(BLOB_CHUNK_PREFIX + meta.id + ':' + String(i).padStart(3, '0'));
      await this.state.storage.delete(del).catch(() => {});
    }
  }

  /* ---- shared social feed ---- */
  async feedPost(body) {
    const wallet = String((body && body.wallet) || '').slice(0, 64);
    const text = String((body && body.text) || '').slice(0, 500).trim();
    const name = String((body && body.name) || '').slice(0, 40);
    // Optional inline image: a small client-resized data URL (cap ~160KB so the
    // DO stays lean). Only accept image data URLs.
    let img = String((body && body.img) || '');
    if (!(/^data:image\/(png|jpeg|webp|gif);base64,/.test(img) && img.length <= 160000)) img = '';
    if (!text && !img) return fail('empty_post');
    const now = Date.now();
    const id = 'f' + now + '-' + messageId().slice(0, 6);
    const rec = { id, wallet, name, text, img, ts: now, expiresAt: now + FEED_TTL_MS };
    // reverse-time, zero-padded key so storage.list() returns newest-first.
    await this.state.storage.put(FEED_PREFIX + String(1e15 - now).padStart(16, '0') + ':' + id, rec);
    try {
      const all = await this.state.storage.list({ prefix: FEED_PREFIX });
      if (all.size > FEED_MAX) { const keys = [...all.keys()]; const del = keys.slice(FEED_MAX); if (del.length) await this.state.storage.delete(del).catch(() => {}); }
    } catch (_) {}
    return json({ ok: true, post: { id, wallet, name, text, img, ts: now } });
  }
  async feedRecent(limit) {
    const n = Math.max(1, Math.min(100, Number(limit) || 50));
    const now = Date.now();
    const listed = await this.state.storage.list({ prefix: FEED_PREFIX, limit: n });
    const posts = [];
    for (const [, v] of listed) {
      if (v && Number(v.expiresAt || 0) > now) posts.push({
        id: v.id, wallet: v.wallet, name: v.name, text: v.text, img: v.img || '', ts: v.ts,
        likeCount: v.likes ? Object.keys(v.likes).length : 0,
        likedBy: v.likes ? Object.keys(v.likes) : [],
        dislikeCount: v.dislikes ? Object.keys(v.dislikes).length : 0,
        dislikedBy: v.dislikes ? Object.keys(v.dislikes) : [],
        donated: v.donated || 0,             // public donations total
        donateCcy: v.donateCcy || 'OST',
        replies: Array.isArray(v.replies) ? v.replies.slice(-20) : []
      });
    }
    return json({ ok: true, posts });
  }
  async _findFeedEntry(postId) {
    const listed = await this.state.storage.list({ prefix: FEED_PREFIX });
    for (const [k, v] of listed) { if (v && v.id === postId) return { key: k, rec: v }; }
    return null;
  }
  async feedReact(body) {
    const postId = String((body && body.postId) || '');
    const wallet = String((body && body.wallet) || '').slice(0, 64);
    const kind = (body && body.kind) === 'dislike' ? 'dislike' : 'like';
    if (!postId || !wallet) return fail('bad_react');
    const found = await this._findFeedEntry(postId);
    if (!found) return fail('post_not_found', 404);
    const v = found.rec; v.likes = v.likes || {}; v.dislikes = v.dislikes || {};
    if (kind === 'like') { if (v.likes[wallet]) delete v.likes[wallet]; else { v.likes[wallet] = 1; delete v.dislikes[wallet]; } }
    else { if (v.dislikes[wallet]) delete v.dislikes[wallet]; else { v.dislikes[wallet] = 1; delete v.likes[wallet]; } }
    await this.state.storage.put(found.key, v);
    return json({ ok: true, likeCount: Object.keys(v.likes).length, liked: !!v.likes[wallet], dislikeCount: Object.keys(v.dislikes).length, disliked: !!v.dislikes[wallet] });
  }
  // Record a PUBLIC donation total on a post (private donations are never recorded
  // here — they stay only between donor and author as the on-chain transfer).
  async feedDonate(body) {
    const postId = String((body && body.postId) || '');
    const amount = Math.max(0, Number(body && body.amount) || 0);
    const ccy = String((body && body.ccy) || 'OST').slice(0, 8);
    if (!postId || !(amount > 0)) return fail('bad_donate');
    const found = await this._findFeedEntry(postId);
    if (!found) return fail('post_not_found', 404);
    const v = found.rec; v.donated = Math.round(((Number(v.donated) || 0) + amount) * 1e6) / 1e6; v.donateCcy = ccy;
    await this.state.storage.put(found.key, v);
    return json({ ok: true, donated: v.donated, ccy: ccy });
  }
  async feedReply(body) {
    const postId = String((body && body.postId) || '');
    const wallet = String((body && body.wallet) || '').slice(0, 64);
    const name = String((body && body.name) || '').slice(0, 40);
    const text = String((body && body.text) || '').slice(0, 300).trim();
    if (!postId || !text) return fail('bad_reply');
    const found = await this._findFeedEntry(postId);
    if (!found) return fail('post_not_found', 404);
    const v = found.rec; v.replies = Array.isArray(v.replies) ? v.replies : [];
    v.replies.push({ wallet, name, text, ts: Date.now() });
    if (v.replies.length > 50) v.replies = v.replies.slice(-50);
    await this.state.storage.put(found.key, v);
    return json({ ok: true, replyCount: v.replies.length, replies: v.replies.slice(-20) });
  }

  async feedClear(postId) {
    const listed = await this.state.storage.list({ prefix: FEED_PREFIX });
    const del = [];
    for (const [k, v] of listed) { if (!postId || (v && v.id === postId)) del.push(k); }
    if (del.length) await this.state.storage.delete(del).catch(() => {});
    return json({ ok: true, cleared: del.length });
  }

  async announce(body) {
    const { address, bundle, fingerprint } = body || {};
    const profile = cleanProfile(body && body.profile);
    if (!validAddr(address)) return fail('bad address');
    if (!bundle || bundle.v !== 1) return fail('bad bundle');
    if (!bundle.kex || !bundle.sig) return fail('missing keys');

    const now = Date.now();

    // TRUST ON FIRST USE (red-team HIGH: directory poisoning). The ost-mesh
    // address is a random label, NOT derived from the keys, so a looker-up
    // cannot cryptographically verify a bundle belongs to an address. Without
    // this, announce was last-write-wins: anyone could overwrite a victim's
    // directory entry with their OWN keys and MITM the "E2E" channel and the
    // Send-OST-to-contact flow.
    //
    // Fix: once an address holds a bundle, a DIFFERENT bundle is refused. The
    // real owner re-announcing with the SAME keys just refreshes the TTL; an
    // attacker with different keys is rejected. (Genuine key rotation will need
    // a signed-by-old-key path — noted for later; blocked here for now, which
    // is the safe direction.)
    let existing = this.ids.get(address);
    if (!existing) {
      existing = await this.state.storage.get(ID_PREFIX + address).catch(() => 'UNREADABLE');
      // Fail CLOSED: an unreadable directory must not let a new bundle overwrite a
      // possibly-existing identity (that would defeat trust-on-first-use).
      if (existing === 'UNREADABLE') return fail('directory_unavailable', 503);
    }
    if (existing && !isExpired(existing, now) && existing.bundle) {
      // Compare by VALUE, not reference. kex/sig are JWK objects — `===` on two
      // deserialized objects is always false, so the same identity re-announcing
      // was wrongly rejected as identity_locked (409), which knocked the whole
      // directory "offline" after the very first announce. Compare the canonical
      // JSON so a genuine re-announce of the SAME keys succeeds.
      const j = (o) => { try { return JSON.stringify(o); } catch (_) { return ''; } };
      const same = j(existing.bundle.kex) === j(bundle.kex) && j(existing.bundle.sig) === j(bundle.sig);
      if (!same) {
        return fail('identity_locked: this address already has a different key bundle; it cannot be overwritten', 409);
      }
    }

    const record = {
      address,
      bundle,
      fingerprint: fingerprint || null,
      profile: profile || (existing && existing.profile) || null,
      ts: now,
      expiresAt: now + ID_TTL_MS
    };
    this.ids.set(address, record);

    let stored = true;
    try {
      await this.state.storage.put(ID_PREFIX + address, record);
    } catch {
      stored = false;
    }

    return json({ ok: true, address, ts: record.ts, hub: 'durable-object', stored });
  }

  async lookup(address) {
    if (!validAddr(address)) return fail('bad address');
    const now = Date.now();
    let record = this.ids.get(address);

    if (!record) {
      record = await this.state.storage.get(ID_PREFIX + address).catch(() => null);
      if (record) this.ids.set(address, record);
    }

    if (isExpired(record, now)) {
      this.ids.delete(address);
      this.state.storage.delete(ID_PREFIX + address).catch(() => {});
      return fail('not found', 404);
    }

    return json(record);
  }

  async directory() {
    const now = Date.now();
    const records = [];
    try {
      const stored = await this.state.storage.list({ prefix: ID_PREFIX, limit: 100 });
      for (const [key, record] of stored) {
        if (isExpired(record, now)) {
          this.state.storage.delete(key).catch(() => {});
          continue;
        }
        records.push({
          address: record.address,
          profile: record.profile || null,
          fingerprint: record.fingerprint || null,
          ts: record.ts || 0,
          expiresAt: record.expiresAt || 0
        });
      }
    } catch (_) {}
    records.sort((left, right) => Number(right.ts || 0) - Number(left.ts || 0));
    return json({ ok: true, identities: records, count: records.length, hub: 'durable-object', ts: new Date().toISOString() });
  }

  signal(body) {
    const { from, to, payload } = body || {};
    if (!validAddr(from) || !validAddr(to)) return fail('bad addresses');
    if (!payload || typeof payload !== 'object') return fail('bad payload');
    if (JSON.stringify(payload).length > 32_000) return fail('payload too large');

    const ts = Date.now();
    const record = { id: messageId(), from, to, ts, payload };
    const pushed = this._pushTo(to, { t: 'signal', item: record });
    const inbox = this.inboxes.get(to) || [];
    inbox.push(record);
    this.inboxes.set(to, inbox.slice(-MAX_PER_INBOX));
    this.pruneInbox(to, ts);
    return json({ ok: true, id: record.id, ts, pushed: pushed > 0, hub: 'durable-object' });
  }

  inbox({ to, from, since }) {
    if (!validAddr(to)) return fail('bad to');
    if (from && !validAddr(from)) return fail('bad from');

    const now = Date.now();
    const minTs = Number(since || 0);
    const inbox = this.inboxes.get(to) || [];
    const messages = [];
    const keep = [];

    for (const record of inbox) {
      if (!record || now - Number(record.ts || 0) > SIGNAL_TTL_MS) continue;
      const matches = record.ts > minTs && (!from || record.from === from);
      if (matches) messages.push({ id: record.id, from: record.from, ts: record.ts, payload: record.payload });
      else keep.push(record);
    }

    if (keep.length) this.inboxes.set(to, keep.slice(-MAX_PER_INBOX));
    else this.inboxes.delete(to);

    messages.sort((a, b) => (a.ts || 0) - (b.ts || 0));
    return json({ messages: messages.slice(-MAX_PER_INBOX), hub: 'durable-object' });
  }

  pruneInbox(to, now = Date.now()) {
    const inbox = this.inboxes.get(to) || [];
    const keep = inbox.filter((record) => record && now - Number(record.ts || 0) <= SIGNAL_TTL_MS);
    if (keep.length) this.inboxes.set(to, keep.slice(-MAX_PER_INBOX));
    else this.inboxes.delete(to);

  }

  async msgSend(body) {
    const { from, to, payload } = body || {};
    if (!validAddr(from) || !validAddr(to)) return fail('bad addresses');
    if (!payload || typeof payload !== 'object') return fail('bad payload');
    if (JSON.stringify(payload).length > MSG_PAYLOAD_MAX) return fail('payload too large', 413);
    // Block enforcement: if the recipient has blocked the sender, drop silently
    // (report ok so a blocker isn't revealed) — the message is simply not stored.
    const block = await this.state.storage.get(FRIEND_PREFIX + to + ':' + from).catch(() => null);
    if (block && block.state === 'blocked') return json({ ok: true, blocked: true, ts: Date.now() });
    const now = Date.now();
    const id = messageId();
    const key = MSG_PREFIX + to + ':' + pad14(now) + ':' + id;
    await this.state.storage.put(key, { id, from, to, ts: now, payload, expiresAt: now + MSG_TTL_MS });
    await this.state.storage.put(SEEN_PREFIX + from, now);
    const pushed = this._pushTo(to, { t: 'msg', item: { id, from, to, ts: now, payload } });
    return json({ ok: true, id, ts: now, delivered: pushed > 0, online: this._online(to), hub: 'durable-object' });
  }

  // ── Friend graph — contact WITHOUT establishing P2P first ────────────────
  async friendRequest(body) {
    const from = body && body.from, to = body && body.to;
    if (!validAddr(from) || !validAddr(to) || from === to) return fail('bad addresses');
    const now = Date.now();
    const rev = await this.state.storage.get(FRIEND_PREFIX + to + ':' + from).catch(() => null);
    if (rev && rev.state === 'blocked') return json({ ok: true, state: 'sent' });   // don't reveal block
    const mine = await this.state.storage.get(FRIEND_PREFIX + from + ':' + to).catch(() => null);
    if (mine && mine.state === 'accepted') return json({ ok: true, state: 'accepted' });
    // Symmetric pending edges. Also drop a mailbox notice so the recipient sees it
    // even if they never open the mesh while the requester is online.
    await this.state.storage.put(FRIEND_PREFIX + to + ':' + from, { state: 'pending-in', ts: now });
    await this.state.storage.put(FRIEND_PREFIX + from + ':' + to, { state: 'pending-out', ts: now });
    const nid = messageId();
    const notice = { id: nid, from, to, ts: now, payload: { t: 'friend-request', from, profile: cleanProfile(body && body.profile) } };
    await this.state.storage.put(MSG_PREFIX + to + ':' + pad14(now) + ':' + nid, { ...notice, expiresAt: now + MSG_TTL_MS });
    this._pushTo(to, { t: 'msg', item: notice });
    return json({ ok: true, state: 'sent', ts: now, online: this._online(to) });
  }
  async friendRespond(body) {
    const me = body && body.wallet, other = body && body.other, action = body && body.action;
    if (!validAddr(me) || !validAddr(other)) return fail('bad addresses');
    const now = Date.now();
    if (action === 'accept') {
      await this.state.storage.put(FRIEND_PREFIX + me + ':' + other, { state: 'accepted', ts: now });
      await this.state.storage.put(FRIEND_PREFIX + other + ':' + me, { state: 'accepted', ts: now });
      const nid = messageId();
      const notice = { id: nid, from: me, to: other, ts: now, payload: { t: 'friend-accepted', from: me, profile: cleanProfile(body && body.profile) } };
      await this.state.storage.put(MSG_PREFIX + other + ':' + pad14(now) + ':' + nid, { ...notice, expiresAt: now + MSG_TTL_MS });
      this._pushTo(other, { t: 'msg', item: notice });
      return json({ ok: true, state: 'accepted' });
    }
    if (action === 'decline' || action === 'remove') {
      await this.state.storage.delete(FRIEND_PREFIX + me + ':' + other).catch(() => {});
      await this.state.storage.delete(FRIEND_PREFIX + other + ':' + me).catch(() => {});
      return json({ ok: true, state: 'none' });
    }
    if (action === 'block') {
      await this.state.storage.put(FRIEND_PREFIX + me + ':' + other, { state: 'blocked', ts: now });
      await this.state.storage.delete(FRIEND_PREFIX + other + ':' + me).catch(() => {});   // they lose their edge to me
      return json({ ok: true, state: 'blocked' });
    }
    if (action === 'unblock') {
      const cur = await this.state.storage.get(FRIEND_PREFIX + me + ':' + other).catch(() => null);
      if (cur && cur.state === 'blocked') await this.state.storage.delete(FRIEND_PREFIX + me + ':' + other).catch(() => {});
      return json({ ok: true, state: 'none' });
    }
    return fail('bad action');
  }
  async friendList(wallet) {
    if (!validAddr(wallet)) return fail('bad wallet');
    const base = FRIEND_PREFIX + wallet + ':';
    const listed = await this.state.storage.list({ prefix: base, limit: 1000 });
    const friends = [], pendingIn = [], pendingOut = [], blocked = [];
    for (const [key, rec] of listed) {
      if (!rec) continue;
      const other = key.slice(base.length);
      if (rec.state === 'accepted') friends.push({ addr: other, ts: rec.ts });
      else if (rec.state === 'pending-in') pendingIn.push({ addr: other, ts: rec.ts });
      else if (rec.state === 'pending-out') pendingOut.push({ addr: other, ts: rec.ts });
      else if (rec.state === 'blocked') blocked.push({ addr: other, ts: rec.ts });
    }
    return json({ ok: true, friends, pendingIn, pendingOut, blocked, ts: Date.now() });
  }

  async msgInbox(to, drain) {
    if (!validAddr(to)) return fail('bad to');
    const now = Date.now();
    const listed = await this.state.storage.list({ prefix: MSG_PREFIX + to + ':', limit: MAX_INBOX });
    const messages = [];
    const del = [];
    for (const [key, rec] of listed) {
      if (!rec || (rec.expiresAt && rec.expiresAt <= now)) { del.push(key); continue; }
      messages.push({ id: rec.id, from: rec.from, to: rec.to, ts: rec.ts, payload: rec.payload });
      if (drain !== '0') del.push(key);
    }
    if (del.length) await this.state.storage.delete(del).catch(() => {});
    await this.state.storage.put(SEEN_PREFIX + to, now);
    messages.sort((a, b) => a.ts - b.ts);
    return json({ ok: true, messages, count: messages.length, ts: now });
  }

  async presencePing(addr) {
    if (!validAddr(addr)) return fail('bad addr');
    await this.state.storage.put(SEEN_PREFIX + addr, Date.now());
    return json({ ok: true, ts: Date.now() });
  }

  async presenceQuery(addrsCsv) {
    const addrs = String(addrsCsv || '').split(',').map((a) => a.trim()).filter(validAddr).slice(0, 40);
    if (!addrs.length) return fail('no valid addrs');
    const now = Date.now();
    const presence = {};
    await Promise.all(addrs.map(async (a) => {
      const ts = Number(await this.state.storage.get(SEEN_PREFIX + a).catch(() => 0)) || 0;
      presence[a] = { lastSeen: ts || null, online: this._online(a) || (ts > 0 && (now - ts) < SEEN_TTL_MS) };
    }));
    return json({ ok: true, presence, ts: now });
  }
}
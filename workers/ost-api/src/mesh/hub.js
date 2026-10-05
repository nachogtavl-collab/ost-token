/* workers/ost-api/src/mesh/hub.js
  MeshHub — the single Durable Object ("mesh-v1") behind every /mesh/v1/* route.
  Everything lives in DO storage (not KV) so daily KV write limits cannot break it.

  Routes (auth in brackets; "signed" = OST-MESH|v1 headers, see verifyMeshAuth):
    GET  /health                               [open]
    POST /identity/announce                    [open, trust-on-first-use + permanent key pin]
    GET  /identity/lookup, GET /directory      [open]
    GET  /ws                                   [signed, query params]  realtime push
    POST /msg/send, GET /msg/inbox, POST /msg/ack   [signed]  7-day encrypted mailbox
    POST /blob, GET /blob/:id                  [signed PUT / capability-id GET]  ciphertext relay
    POST /friend/request, /friend/respond, GET /friend/list   [signed]
    GET|POST /presence                         [open]
    POST /signal/send, GET /signal/inbox       [open, rate-limited]  call signalling fallback
    POST /feed/post|react|reply|donate, GET /feed/recent      [open, legacy pavilion feed]
    *    /social/*                             [see social.js]

  Storage keys
    id:<addr>                 directory record { address, bundle, fingerprint, profile, ts, expiresAt }
    idpin:<addr>              PERMANENT key pin { fp, ts } — an address can never be re-bound to other keys
    meshnonce:<addr>:<nonce>  replay guard
    msg:<to>:<ts14>:<id>      mailbox item from a contact (accepted / asked-by-recipient) or a hub notice
    msq:<to>:<ts14>:q<id>     mailbox item from anyone else (id starts with "q"); listed after msg:
    mbox:<to>                 pending counter { n, bytes } over both mailbox tiers
    fnote:<to>:<from>         { ts, id } of the one stored friend-request notice from <from>
    dmin:<to>:<from>          ts of the last mail from a non-contact (counts as their contact request)
    seen:<addr>               last-seen ts, or { ts, left:true } once the last socket closed
    friend:<owner>:<other>    { state, ts }
    blobmeta:<id> / blob:<id>:<nnn>   encrypted blob relay
    feed:<rev16>:<id>         legacy shared feed
*/

import { installSocial } from './social.js';

const ID_PREFIX = 'id:';
const PIN_PREFIX = 'idpin:';
const FEED_PREFIX = 'feed:';
const FEED_TTL_MS = 60 * 60 * 24 * 3 * 1000;   // shared feed posts live 3 days
const FEED_MAX = 200;
const ID_TTL_MS = 60 * 60 * 24 * 7 * 1000;
const ID_REFRESH_MS = 60 * 60 * 1000;          // a same-key re-announce rewrites the record at most hourly
const ID_CACHE_MAX = 5000;                     // in-memory directory cache entries
const SIGNAL_TTL_MS = 60 * 5 * 1000;
const MAX_PER_INBOX = 128;
// Signalling relay (in memory only). Bounded per inbox and in total so an
// unauthenticated flood cannot grow the Durable Object's heap without limit.
const SIGNAL_PAYLOAD_MAX = 32_000;
const SIGNAL_INBOX_BYTES = 512 * 1024;
const SIGNAL_TOTAL_BYTES = 24 * 1024 * 1024;
const SIGNAL_MAX_INBOXES = 4000;
// Durable mailbox: every chat message is stored for the recipient (and pushed
// over the socket when they are online). Items persist a week so an offline
// peer still receives them; the recipient deletes them with msg/ack.
const MSG_PREFIX = 'msg:';
// Mail from people who are not the recipient's contacts lives in its own key
// range, listed after the contacts' range, so a flood of it can never push a
// real contact's message (or a friend notice) out of the inbox page.
const MSQ_PREFIX = 'msq:';
const MSG_TTL_MS = 60 * 60 * 24 * 7 * 1000;   // 7-day offline delivery window
const SEEN_PREFIX = 'seen:';
const SEEN_TTL_MS = 2 * 60 * 1000;            // "online" if seen within 2 min (and the socket was not closed since)
const MAX_INBOX = 128;                        // mailbox items per inbox page
// Mailbox abuse limits. mbox:<to> counts what is pending for a recipient.
const MBOX_PREFIX = 'mbox:';
const MAILBOX_MAX_ITEMS = 2000;
const MAILBOX_MAX_BYTES = 64 * 1024 * 1024;
// People who are not accepted friends of the recipient stop earlier, so a flood
// from strangers can never use up the room a real contact needs.
const MAILBOX_STRANGER_ITEMS = 1500;
const MAILBOX_STRANGER_BYTES = 48 * 1024 * 1024;
const MAILBOX_FULL_RETRY_S = 300;
const DMIN_PREFIX = 'dmin:';
const FNOTE_PREFIX = 'fnote:';

// ── Rate limits (fixed windows, in memory: they reset when the DO is evicted) ──
// Generous on purpose: a normal active person must never see one of these.
// Over a window the answer is either limited() (429, the client backs off from
// the whole hub) or refused() (403, only that action) — see the helpers below.
const MIN = 60 * 1000, HOUR = 60 * MIN;
const RL = {
  announceIp: [600, HOUR],      // every announce call, per IP (before any storage read)
  announce: [12, HOUR],         // directory WRITES per address+IP
  identityNew: [300, HOUR],     // brand-new addresses per IP
  // Mailbox sends per sender. Live location alone sends up to 240/hour per peer
  // while moving (every 15 s), so the hourly budget leaves room for several.
  msgMin: [60, MIN], msgHour: [2000, HOUR],
  friendRequest: [30, HOUR], friendRespond: [120, HOUR],
  blob: [80, HOUR],
  signalFrom: [240, MIN], signalIp: [600, MIN],     // POST /signal/send per from+IP / per IP
  signalInbox: [240, MIN], signalInboxIp: [600, MIN],
  wsSignal: [300, MIN], wsTyping: [120, MIN], wsPresence: [30, MIN], wsPing: [12, MIN],
  presencePost: [60, MIN],
  feedPost: [30, HOUR], feedReact: [600, HOUR], feedReply: [120, HOUR], feedDonate: [60, HOUR]   // legacy feed, per IP
};
const RL_MAX_KEYS = 20000;
// Friend graph: friend:<owner>:<other> -> { state, ts }. DO storage (not KV) so
// contacts survive KV exhaustion.
const FRIEND_PREFIX = 'friend:';
const FRIEND_RENOTICE_MS = HOUR;               // a repeated request within this window adds no second notice
// Encrypted blob relay (files / images between contacts). Bytes are sealed by
// the sender with the pairwise key before upload, so the hub only ever stores
// ciphertext. Chunked so each stored value stays well under the DO value cap.
const BLOB_META_PREFIX = 'blobmeta:';
const BLOB_CHUNK_PREFIX = 'blob:';
const BLOB_CHUNK_BYTES = 512 * 1024;
const BLOB_MAX_BYTES = 6 * 1024 * 1024;
const BLOB_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MSG_PAYLOAD_MAX = 64_000;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Range, If-None-Match, If-Range, x-ost-wallet, x-ost-ts, x-ost-nonce, x-ost-sig, x-ost-session, x-ost-internal, x-mesh-addr, x-mesh-ts, x-mesh-nonce, x-mesh-sig',
  'Access-Control-Expose-Headers': 'Content-Range, Accept-Ranges, Content-Length, ETag, Retry-After, X-Blob-Size',
  'Access-Control-Max-Age': '86400'
};

function cors(extra = {}) {
  return { ...CORS_HEADERS, ...extra };
}

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: cors({ 'Content-Type': 'application/json', ...headers })
  });
}

function fail(error, status = 400) {
  return json({ ok: false, error }, status);
}

// Two kinds of "not now" on /mesh/*, both with { ok:false, error, retryAfter, scope }:
//  · limited(): HTTP 429 + a Retry-After header. Only for limits that protect
//    the hub from one client calling too much (announce, identity, signal,
//    signal-inbox, presence, the per-minute msg burst, the legacy feed). The
//    app's breaker pauses EVERY hub call for that long — that is the intent.
//  · refused(): HTTP 403 (or 409 for a state of the target) WITHOUT Retry-After,
//    and a specific `error`. For per-action quotas and per-recipient conditions
//    (friend requests, files, posts, the hourly message budget, a full mailbox,
//    the daily upload quota, a tip being checked): only that action is refused,
//    the client keeps working and must not retry it in a loop. `retryAfter`
//    in the body only says when that action has room again.
function limited(retryAfter, scope = '', error = 'rate_limited') {
  const s = Math.max(1, Math.ceil(Number(retryAfter) || 1));
  return json({ ok: false, error, retryAfter: s, scope }, 429, { 'Retry-After': String(s) });
}
function refused(retryAfter, scope, error, status = 403) {
  const s = Math.max(1, Math.ceil(Number(retryAfter) || 1));
  return json({ ok: false, error, retryAfter: s, scope }, status);
}

function ipOf(request) {
  return (request.headers.get('CF-Connecting-IP') || request.headers.get('x-real-ip') || 'noip').slice(0, 64);
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
function hasProfile(p) { return !!(p && (p.name || p.emoji || p.bio || p.avatar || p.wallet)); }
// Fingerprint of the KEY MATERIAL of a public bundle (not of its JSON text, so
// property order or extra JWK fields cannot change it). '' when the bundle is not
// two P-384 public JWKs — a private key ("d") is never accepted.
function ecPub(k) {
  if (!k || typeof k !== 'object' || k.kty !== 'EC' || k.crv !== 'P-384' || k.d !== undefined) return '';
  const ok = (v) => typeof v === 'string' && /^[A-Za-z0-9_-]{40,90}$/.test(v);
  return ok(k.x) && ok(k.y) ? k.x + '.' + k.y : '';
}
async function bundleKeyFp(bundle) {
  const kex = ecPub(bundle && bundle.kex), sig = ecPub(bundle && bundle.sig);
  if (!kex || !sig) return '';
  return sha256Hex('OST-MESH-PIN|v1|' + kex + '|' + sig);
}
function sameBundleText(a, b) {
  const j = (o) => { try { return JSON.stringify(o); } catch (_) { return ''; } };
  return !!(a && b) && j(a.kex) === j(b.kex) && j(a.sig) === j(b.sig);
}
function mboxOf(v) { return { n: Math.max(0, Number(v && v.n) || 0), bytes: Math.max(0, Number(v && v.bytes) || 0) }; }
// seen:<addr> holds a number (last activity) or { ts, left:true } (the last
// socket closed at ts). Older records are plain numbers.
function seenOf(v) { return v && typeof v === 'object' ? { ts: Number(v.ts) || 0, left: !!v.left } : { ts: Number(v) || 0, left: false }; }
function msgSize(rec) { if (rec && Number(rec.sz) > 0) return Number(rec.sz); try { return JSON.stringify((rec && rec.payload) || '').length; } catch (_) { return 0; } }
// Storage key of a mailbox item. The tier is encoded in the id ("q…" = not a
// contact), so msg/ack can find an item from the { id, ts } the client echoes.
function mboxKey(to, ts, id) { id = String(id).slice(0, 64); return (id.charAt(0) === 'q' ? MSQ_PREFIX : MSG_PREFIX) + to + ':' + pad14(ts) + ':' + id; }
export function meshCanonical({ addr, method, pathq, bodyHash, ts, nonce }) { return `OST-MESH|v1|${addr}|${String(method).toUpperCase()}|${pathq}|${bodyHash}|${ts}|${nonce}`; }

export class MeshHub {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.ids = new Map();
    this.inboxes = new Map();
    this._sigBytes = 0;          // bytes parked in this.inboxes
    this._rl = new Map();        // limiter windows
  }

  // Fixed-window limiter. specs = [[bucket, key, [max, windowMs]], …]. Returns
  // { wait: 0 } when every window has room (and counts the hit in each), otherwise
  // { wait, bucket }: the seconds until the first full window reopens and that
  // window's bucket (nothing is counted, and no later window is created — list
  // per-IP windows first). _limits() returns only the wait.
  _limitHit(specs) {
    const now = Date.now(), m = this._rl, wins = [];
    for (const [bucket, key, [max, windowMs]] of specs) {
      const k = bucket + '|' + key;
      let w = m.get(k);
      if (w && now - w.at >= windowMs) w = null;
      if (w && w.n >= max) return { wait: Math.max(1, Math.ceil((w.at + windowMs - now) / 1000)), bucket };
      wins.push([k, w, windowMs]);
    }
    for (const [k, w, windowMs] of wins) { if (w) w.n++; else m.set(k, { at: now, n: 1, ms: windowMs }); }
    if (m.size > RL_MAX_KEYS) {
      for (const [k, w] of m) if (now - w.at >= w.ms) m.delete(k);
      // Still too many live windows: drop the oldest half rather than grow without bound.
      if (m.size > RL_MAX_KEYS) { let drop = m.size >> 1; for (const k of m.keys()) { if (drop-- <= 0) break; m.delete(k); } }
    }
    return { wait: 0, bucket: '' };
  }
  _limits(specs) { return this._limitHit(specs).wait; }
  _limit(bucket, key, spec) { return this._limits([[bucket, key, spec]]); }


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

      // ── OST Social (posts, stories, media, follows, tips) — social.js ──────
      if (path.startsWith('/mesh/v1/social/')) {
        const sr = await this.routeSocial(request, url, path, method);
        if (sr) return sr;
        return fail('social route not found: ' + method + ' ' + path, 404);
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
        if (Number(request.headers.get('Content-Length') || 0) > BLOB_MAX_BYTES) return fail('blob_too_large', 413);
        const bytes = new Uint8Array(await request.arrayBuffer());
        if (!bytes.length) return fail('empty_blob');
        if (bytes.length > BLOB_MAX_BYTES) return fail('blob_too_large', 413);
        const actor = request.headers.get('x-mesh-addr') || '';
        const auth = await this.verifyMeshAuth(request, url, '', actor, { bodyHash: await sha256HexBytes(bytes) });
        if (!auth.ok) return fail(auth.error, auth.status);
        return this.blobPut(auth.addr, url, bytes);
      }
      if (method === 'GET' && path.startsWith('/mesh/v1/blob/')) {
        return this.blobGet(path.slice('/mesh/v1/blob/'.length), request);
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
        const ip = ipOf(request);
        const wait = this._limit('announce-ip', ip, RL.announceIp);
        if (wait) return limited(wait, 'announce');
        const bodyText = await request.text();
        if (bodyText.length > 8192) return fail('announce_too_large', 413);
        let body = {}; try { body = JSON.parse(bodyText) || {}; } catch (_) {}
        return this.announce(body, ip);
      }

      if (method === 'GET' && path === '/mesh/v1/identity/lookup') {
        return this.lookup(url.searchParams.get('address'));
      }

      // ── Call signalling relay (HTTP fallback for the socket) ────────────────
      // NOT signature-gated yet: the legacy pavilion (docs/mesh/mesh.js,
      // mesh-rtc.js) still posts and polls here unsigned, so requiring OST-MESH
      // headers would break it. Until that client is retired these two routes
      // are only rate-limited (per address+IP and per IP) and size-capped; the
      // payloads themselves are opaque to the hub.
      if (method === 'POST' && path === '/mesh/v1/signal/send') {
        const ip = ipOf(request);
        const bodyText = await request.text();
        if (bodyText.length > SIGNAL_PAYLOAD_MAX + 2000) return fail('payload too large', 413);
        let body = {}; try { body = JSON.parse(bodyText) || {}; } catch (_) {}
        return this.signal(body, ip);
      }

      if (method === 'GET' && path === '/mesh/v1/signal/inbox') {
        return this.inbox({
          to: url.searchParams.get('to'),
          from: url.searchParams.get('from'),
          since: Number(url.searchParams.get('since') || 0)
        }, ipOf(request));
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
        return this.msgInbox(url.searchParams.get('to'), url.searchParams.get('drain'), url.searchParams.get('order'));
      }
      // ── Friend graph (contact WITHOUT P2P) ──────────────────────────────
      if (method === 'POST' && path === '/mesh/v1/friend/request') {
        const bodyText = await request.text();
        let body = {}; try { body = JSON.parse(bodyText) || {}; } catch (_) {}
        const auth = await this.verifyMeshAuth(request, url, bodyText, body && body.from);
        if (!auth.ok) return fail(auth.error, auth.status);
        const wait = this._limit('friend-request', auth.addr, RL.friendRequest);
        if (wait) return refused(wait, 'friend-request', 'friend_requests_too_fast');
        return this.friendRequest(body);
      }
      if (method === 'POST' && path === '/mesh/v1/friend/respond') {
        const bodyText = await request.text();
        let body = {}; try { body = JSON.parse(bodyText) || {}; } catch (_) {}
        const auth = await this.verifyMeshAuth(request, url, bodyText, body && body.wallet);
        if (!auth.ok) return fail(auth.error, auth.status);
        const wait = this._limit('friend-respond', auth.addr, RL.friendRespond);
        if (wait) return refused(wait, 'friend-respond', 'friend_responses_too_fast');
        return this.friendRespond(body);
      }
      if (method === 'GET' && path === '/mesh/v1/friend/list') {
        { const auth = await this.verifyMeshAuth(request, url, '', url.searchParams.get('wallet')); if (!auth.ok) return fail(auth.error, auth.status); }
        return this.friendList(url.searchParams.get('wallet'));
      }
      if (method === 'POST' && path === '/mesh/v1/presence') {
        const wait = this._limit('presence-post', ipOf(request), RL.presencePost);
        if (wait) return limited(wait, 'presence');
        const body = await request.json().catch(() => ({}));
        return this.presencePing(body && body.addr);
      }
      if (method === 'GET' && path === '/mesh/v1/presence') {
        return this.presenceQuery(url.searchParams.get('addrs'));
      }
      // Legacy shared feed of the old mesh pavilion (docs/mesh/mesh-mobile.js).
      // Unsigned by design of that client; OST Social (/social/*, signed) replaced
      // it. Writes are rate-limited per IP until the pavilion is retired.
      if (method === 'POST' && path.startsWith('/mesh/v1/feed/') && path !== '/mesh/v1/feed/clear') {
        const kind = path.slice('/mesh/v1/feed/'.length);
        const spec = { post: RL.feedPost, react: RL.feedReact, reply: RL.feedReply, donate: RL.feedDonate }[kind];
        if (spec) { const wait = this._limit('feed-' + kind, ipOf(request), spec); if (wait) return limited(wait, 'feed-' + kind); }
      }
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
  // The one definition of "online" used by GET /presence, the socket's presence
  // frame, msg/send, friend/request and social/user: a live socket, or activity within
  // SEEN_TTL_MS (clients without a socket that poll) unless the socket has
  // closed since. `seen` is the stored seen:<addr> value.
  _presenceOf(addr, seen, now = Date.now()) {
    const s = seenOf(seen);
    return { online: this._online(addr) || (!s.left && s.ts > 0 && now - s.ts < SEEN_TTL_MS), lastSeen: s.ts || null };
  }
  _wsAddr(ws) { try { const a = ws.deserializeAttachment(); return a && a.addr; } catch (_) { return null; } }
  async webSocketMessage(ws, raw) {
    const addr = this._wsAddr(ws); if (!addr) return;
    if (raw && (raw.length || raw.byteLength || 0) > 96_000) return;   // nothing a client sends is this large
    let m = null; try { m = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw)); } catch (_) { return; }
    if (!m || typeof m !== 'object') return;
    const now = Date.now();
    // Over a limit the frame is dropped and the sender is told once per frame.
    const over = (scope, spec) => {
      const wait = this._limit('ws-' + scope, addr, spec);
      if (wait) { try { ws.send(JSON.stringify({ t: 'error', error: 'rate_limited', scope, retryAfter: wait })); } catch (_) {} }
      return wait;
    };
    if (m.t === 'ping') {
      // Keepalives come every ~25 s; anything faster still gets its pong but no storage write.
      if (!this._limit('ws-ping', addr, RL.wsPing)) await this.state.storage.put(SEEN_PREFIX + addr, now).catch(() => {});
      try { ws.send(JSON.stringify({ t: 'pong', ts: now })); } catch (_) {}
      return;
    }
    if (m.t === 'signal' && validAddr(m.to) && m.payload && typeof m.payload === 'object') {
      const sz = JSON.stringify(m.payload).length;
      if (sz > SIGNAL_PAYLOAD_MAX) return;
      if (over('signal', RL.wsSignal)) return;
      const record = { id: messageId(), from: addr, to: m.to, ts: now, payload: m.payload, sz };
      if (!this._pushTo(m.to, { t: 'signal', item: { id: record.id, from: addr, to: m.to, ts: now, payload: m.payload } })) {
        // Peer not on a socket right now: park it in the poll inbox too.
        this._parkSignal(record);
      }
      return;
    }
    if (m.t === 'typing' && validAddr(m.to)) { if (!this._limit('ws-typing', addr, RL.wsTyping)) this._pushTo(m.to, { t: 'typing', from: addr, ts: now }); return; }
    if (m.t === 'ack' && Array.isArray(m.items)) { await this.msgAck(addr, m.items); return; }
    if (m.t === 'presence' && Array.isArray(m.addrs)) {
      if (over('presence', RL.wsPresence)) return;
      const out = {};
      for (const a of m.addrs.filter(validAddr).slice(0, 60)) out[a] = this._presenceOf(a, await this.state.storage.get(SEEN_PREFIX + a).catch(() => 0), now);
      try { ws.send(JSON.stringify({ t: 'presence', presence: out, ts: now })); } catch (_) {}
    }
  }
  // The socket is gone: remember when, and that the person left (so presence
  // does not keep saying "online" for SEEN_TTL_MS after they closed the app).
  // Another open socket of the same address keeps them online through _online().
  async _wsGone(ws) {
    const addr = this._wsAddr(ws);
    if (addr) await this.state.storage.put(SEEN_PREFIX + addr, { ts: Date.now(), left: true }).catch(() => {});
    try { ws.close(); } catch (_) {}
  }
  async webSocketClose(ws) { await this._wsGone(ws); }
  async webSocketError(ws) { await this._wsGone(ws); }

  async msgAck(addr, items) {
    if (!validAddr(addr) || !Array.isArray(items)) return json({ ok: true, removed: 0 });
    const del = [];
    for (const it of items.slice(0, 200)) {
      if (!it || !it.id || !Number.isFinite(Number(it.ts))) continue;
      del.push(mboxKey(addr, Number(it.ts), it.id));
    }
    // storage.delete() takes at most 128 keys per call and reports how many existed.
    let removed = 0;
    for (let i = 0; i < del.length; i += 128) removed += Number(await this.state.storage.delete(del.slice(i, i + 128)).catch(() => 0)) || 0;
    if (removed) await this._mboxAdjust(addr, -removed).catch(() => {});
    return json({ ok: true, removed });
  }

  /* ---- mailbox accounting (W5) ---- */
  // mbox:<to> = { n, bytes } of what is pending. Exact while messages are added
  // here and removed through msgInbox; an ack only knows how many keys it removed,
  // so bytes shrink proportionally and msgInbox re-counts exactly whenever it
  // sees the whole mailbox. Mailboxes written before this counter existed start
  // at 0 and heal the same way.
  async _mboxAdjust(to, dn, dbytes) {
    const k = MBOX_PREFIX + to;
    const cur = mboxOf(await this.state.storage.get(k).catch(() => null));
    const n = Math.max(0, cur.n + dn);
    const bytes = !n ? 0 : Math.max(0, dbytes !== undefined ? cur.bytes + dbytes : (cur.n ? Math.round(cur.bytes * n / cur.n) : 0));
    if (n) await this.state.storage.put(k, { n, bytes }); else await this.state.storage.delete(k);
  }
  // Store one mailbox item and count it. `box` is the counter the caller already read.
  async _mboxPut(item, sz, box, extra) {
    const now = item.ts;
    const puts = Object.assign({}, extra || {});
    puts[mboxKey(item.to, now, item.id)] = { ...item, sz, expiresAt: now + MSG_TTL_MS };
    puts[MBOX_PREFIX + item.to] = { n: box.n + 1, bytes: box.bytes + sz };
    await this.state.storage.put(puts);
  }
  // A full mailbox may only be full of expired items (the owner never came back):
  // expired items are always the oldest of their tier, so drop those before
  // refusing a sender.
  async _mboxSweep(to, now) {
    const k = MBOX_PREFIX + to;
    let whole = true, live = 0, bytes = 0, removed = 0, removedBytes = 0;
    for (const pre of [MSG_PREFIX, MSQ_PREFIX]) {
      const listed = await this.state.storage.list({ prefix: pre + to + ':', limit: MAX_INBOX });
      if (listed.size >= MAX_INBOX) whole = false;
      const del = []; let delBytes = 0;
      for (const [key, rec] of listed) {
        if (!rec || (rec.expiresAt && rec.expiresAt <= now)) { del.push(key); delBytes += msgSize(rec); }
        else { live++; bytes += msgSize(rec); }
      }
      if (del.length) { removed += Number(await this.state.storage.delete(del).catch(() => 0)) || 0; removedBytes += delBytes; }
    }
    if (whole) {   // that was the whole mailbox: count it exactly
      if (live) await this.state.storage.put(k, { n: live, bytes }); else await this.state.storage.delete(k);
      return { n: live, bytes };
    }
    if (removed) await this._mboxAdjust(to, -removed, -removedBytes);
    return mboxOf(await this.state.storage.get(k).catch(() => null));
  }
  // Notices written by the hub itself (friend request / accepted) use the same
  // mailbox. A 'friend-accepted' notice goes to someone who asked first, so it
  // is contact mail (`contact`). A 'friend-request' comes from someone the
  // recipient has not accepted: it is stranger mail — "q" id, stranger tier,
  // stranger caps — and at most one is stored per (from, to) until the
  // recipient fetches it, however often the sender removes and re-asks. When
  // there is no room (or one is already waiting) the notice is only pushed
  // live; the friend graph still records the request, so friend/list shows it.
  async _mboxNotice(notice, contact) {
    try {
      const st = this.state.storage, sz = JSON.stringify(notice.payload).length;
      if (!contact) notice.id = 'q' + notice.id;
      const fk = FNOTE_PREFIX + notice.to + ':' + notice.from;
      const got = await st.get([MBOX_PREFIX + notice.to, fk]);
      let box = mboxOf(got.get(MBOX_PREFIX + notice.to));
      const prev = contact ? null : got.get(fk);
      let waiting = false;
      if (prev && prev.id && Number.isFinite(Number(prev.ts))) {
        const rec = await st.get(mboxKey(notice.to, Number(prev.ts), prev.id)).catch(() => null);
        waiting = !!(rec && !(rec.expiresAt && rec.expiresAt <= notice.ts));
      }
      if (!waiting) {
        const maxN = contact ? MAILBOX_MAX_ITEMS : MAILBOX_STRANGER_ITEMS, maxB = contact ? MAILBOX_MAX_BYTES : MAILBOX_STRANGER_BYTES;
        if (box.n + 1 > maxN || box.bytes + sz > maxB) box = await this._mboxSweep(notice.to, notice.ts).catch(() => box);
        if (box.n + 1 <= maxN && box.bytes + sz <= maxB) await this._mboxPut(notice, sz, box, contact ? null : { [fk]: { ts: notice.ts, id: notice.id } });
      }
    } catch (_) {}
    this._pushTo(notice.to, { t: 'msg', item: notice });
  }

  /* ---- encrypted blob relay ---- */
  async blobPut(from, url, bytes) {
    const to = url.searchParams.get('to') || '';
    if (!validAddr(to)) return fail('bad to');
    const now = Date.now();
    const wait = this._limit('blob', from, RL.blob);
    if (wait) return refused(wait, 'blob', 'blob_rate_limited');
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
  async blobGet(id, request) {
    if (!/^[0-9a-f]{24,80}$/i.test(id)) return fail('bad blob id');
    const meta = await this.state.storage.get(BLOB_META_PREFIX + id).catch(() => null);
    if (!meta || Number(meta.expiresAt || 0) <= Date.now()) return fail('blob_not_found', 404);
    // A blob never changes under its id, so the id is a strong validator.
    const etag = '"' + String(meta.id || id).toLowerCase() + '"';
    const base = { 'Content-Type': 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, max-age=86400', 'ETag': etag, 'Accept-Ranges': 'bytes', 'X-Blob-Size': String(meta.size) };
    const hdr = (n) => (request && request.headers.get(n)) || '';
    const inm = hdr('If-None-Match');
    if (inm && inm.split(',').some((t) => t.trim().replace(/^W\//, '') === etag)) return new Response(null, { status: 304, headers: cors(base) });
    let start = 0, end = meta.size - 1, partial = false;
    const m = /^bytes=(\d*)-(\d*)$/.exec(hdr('Range').trim());
    const ifRange = hdr('If-Range');
    if (m && (m[1] || m[2]) && (!ifRange || ifRange.trim() === etag)) {
      if (m[1]) { start = Number(m[1]); end = m[2] ? Math.min(Number(m[2]), meta.size - 1) : meta.size - 1; }
      else { start = Math.max(0, meta.size - Number(m[2])); end = meta.size - 1; }
      if (start > end || start >= meta.size) return new Response(null, { status: 416, headers: cors({ ...base, 'Content-Range': 'bytes */' + meta.size }) });
      partial = true;
    }
    const c0 = Math.floor(start / BLOB_CHUNK_BYTES), c1 = Math.floor(end / BLOB_CHUNK_BYTES);
    const out = new Uint8Array(end - start + 1); let o = 0;
    for (let i = c0; i <= c1; i++) {
      const c = await this.state.storage.get(BLOB_CHUNK_PREFIX + id + ':' + String(i).padStart(3, '0'));
      if (!c) return fail('blob_incomplete', 410);
      const u = new Uint8Array(c);
      const from = i === c0 ? start - i * BLOB_CHUNK_BYTES : 0;
      const to = i === c1 ? end - i * BLOB_CHUNK_BYTES + 1 : u.length;
      out.set(u.subarray(from, to), o); o += to - from;
    }
    const headers = cors({ ...base, 'Content-Length': String(out.length) });
    if (partial) headers['Content-Range'] = 'bytes ' + start + '-' + end + '/' + meta.size;
    return new Response(out, { status: partial ? 206 : 200, headers });
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

  async announce(body, ip = 'noip') {
    const { address, bundle, fingerprint } = body || {};
    const profile = cleanProfile(body && body.profile);
    if (!validAddr(address)) return fail('bad address');
    if (!bundle || bundle.v !== 1) return fail('bad bundle');
    if (!bundle.kex || !bundle.sig) return fail('missing keys');
    const fp = await bundleKeyFp(bundle);
    if (!fp) return fail('bad keys');            // must be two P-384 PUBLIC JWKs

    const now = Date.now();

    // TRUST ON FIRST USE, PINNED FOREVER. The ost-mesh address is a random
    // label, NOT derived from the keys, so a looker-up cannot cryptographically
    // verify that a bundle belongs to an address. The first keys announced for
    // an address therefore own it permanently:
    //   · idpin:<addr> stores the fingerprint of those keys and never expires;
    //   · the SAME keys re-announcing refresh the 7-day directory record;
    //   · DIFFERENT keys are refused with 409 — also after the directory record
    //     has expired or been cleaned up. (Before the pin existed, an address
    //     dormant for 7 days could be re-announced by anyone, who then inherited
    //     its name, avatar, bio and linked tip wallet.)
    // Records written before the pin existed are pinned from their stored
    // bundle the next time they are announced, looked up or listed. Key
    // rotation would need a signed-by-old-key route; there is none yet, so a
    // lost key means a new address (the safe direction).
    let pin = null, existing = this.ids.get(address) || null;
    try {
      const got = await this.state.storage.get([PIN_PREFIX + address, ID_PREFIX + address]);
      pin = got.get(PIN_PREFIX + address) || null;
      if (!existing) existing = got.get(ID_PREFIX + address) || null;
    } catch (_) {
      // Fail CLOSED: an unreadable directory must not let a new bundle bind a
      // possibly-existing address.
      return fail('directory_unavailable', 503);
    }
    let mismatch = false;
    if (pin && pin.fp) mismatch = pin.fp !== fp;
    else if (existing && existing.bundle) {
      // Not pinned yet: the stored bundle is the binding, expired or not.
      const efp = await bundleKeyFp(existing.bundle);
      mismatch = efp ? efp !== fp : !sameBundleText(existing.bundle, bundle);
    }
    if (mismatch) {
      const wait = this._limit('announce', address + '|' + ip, RL.announce);
      if (wait) return limited(wait, 'announce');
      // `error` keeps its historic "identity_locked" prefix (clients match on it).
      return json({ ok: false, error: 'identity_locked: key_mismatch — this address is bound to a different key bundle and cannot be re-bound', code: 'key_mismatch' }, 409);
    }

    // Same keys (or a brand-new address). An unsigned announce may only refresh
    // the TTL — and, the first time, set a display name. If nothing would change
    // and the record was refreshed within the hour, answer without a write.
    const live = !!(existing && existing.bundle && !isExpired(existing, now));
    const unchanged = { ok: true, address, ts: existing ? existing.ts : now, hub: 'durable-object', stored: true };
    if (live && pin && now - Number(existing.ts || 0) < ID_REFRESH_MS && (existing.profile || !profile) && sameBundleText(existing.bundle, bundle)) return json(unchanged);
    const wait = this._limit('announce', address + '|' + ip, RL.announce);
    if (wait) {
      // Already registered with these keys: still a success for the caller.
      if (live && pin) return json(unchanged);
      return limited(wait, 'announce');
    }
    if (!existing && !pin) {
      const w2 = this._limit('identity-new', ip, RL.identityNew);
      if (w2) return limited(w2, 'identity');
    }

    const record = {
      address,
      bundle,
      fingerprint: typeof fingerprint === 'string' ? fingerprint.slice(0, 80) : null,
      // The bundle is public, so an unsigned announce must never change an
      // existing profile (that would let anyone rename a user or swap the wallet
      // tips go to). Profiles change only through the signed /social/profile.
      profile: (existing && existing.profile) || profile || null,
      ts: now,
      expiresAt: now + ID_TTL_MS
    };
    if (this.ids.size >= ID_CACHE_MAX) this.ids.clear();   // it is only a cache
    this.ids.set(address, record);

    let stored = true;
    try {
      const puts = { [ID_PREFIX + address]: record };
      if (!pin) puts[PIN_PREFIX + address] = { fp, ts: now };
      await this.state.storage.put(puts);
    } catch {
      stored = false;
    }

    return json({ ok: true, address, ts: record.ts, hub: 'durable-object', stored });
  }

  // An expired directory record: make sure its keys stay pinned, then drop it —
  // unless it carries a profile, which its owner gets back on the next announce.
  async _retireId(address, record) {
    try {
      if (record && record.bundle) {
        const pk = PIN_PREFIX + address;
        if (!(await this.state.storage.get(pk))) {
          const fp = await bundleKeyFp(record.bundle);
          if (!fp) return;                       // cannot pin it: the record itself stays as the binding
          await this.state.storage.put(pk, { fp, ts: Date.now() });
        }
      }
      if (!hasProfile(record && record.profile)) await this.state.storage.delete(ID_PREFIX + address);
    } catch (_) {}
  }

  async lookup(address) {
    if (!validAddr(address)) return fail('bad address');
    const now = Date.now();
    let record = this.ids.get(address);

    if (!record) {
      record = await this.state.storage.get(ID_PREFIX + address).catch(() => null);
      if (record && !isExpired(record, now)) { if (this.ids.size >= ID_CACHE_MAX) this.ids.clear(); this.ids.set(address, record); }
    }

    if (isExpired(record, now)) {
      this.ids.delete(address);
      if (record) await this._retireId(address, record);
      return fail('not found', 404);
    }

    return json(record);
  }

  async directory() {
    const now = Date.now();
    const records = [];
    try {
      const stored = await this.state.storage.list({ prefix: ID_PREFIX, limit: 400 });
      for (const [key, record] of stored) {
        if (isExpired(record, now)) {
          this._retireId(key.slice(ID_PREFIX.length), record).catch(() => {});
          continue;
        }
        if (records.length >= 100) continue;
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

  // POST /signal/send. Unsigned (see the note in fetch()); limited per sender
  // address+IP and per IP, payload capped at SIGNAL_PAYLOAD_MAX.
  signal(body, ip = 'noip') {
    const { from, to, payload } = body || {};
    if (!validAddr(from) || !validAddr(to)) return fail('bad addresses');
    if (!payload || typeof payload !== 'object') return fail('bad payload');
    const sz = JSON.stringify(payload).length;
    if (sz > SIGNAL_PAYLOAD_MAX) return fail('payload too large', 413);
    const wait = this._limits([['signal-ip', ip, RL.signalIp], ['signal-from', from + '|' + ip, RL.signalFrom]]);
    if (wait) return limited(wait, 'signal');

    const ts = Date.now();
    const record = { id: messageId(), from, to, ts, payload, sz };
    const pushed = this._pushTo(to, { t: 'signal', item: { id: record.id, from, to, ts, payload } });
    // Parked even when pushed: the legacy pavilion only ever polls.
    this._parkSignal(record);
    return json({ ok: true, id: record.id, ts, pushed: pushed > 0, hub: 'durable-object' });
  }

  /* ---- in-memory signal inboxes, bounded per inbox and in total ---- */
  _inboxBytes(list) { let b = 0; for (const r of list || []) b += Number(r && r.sz) || 0; return b; }
  _setInbox(to, list) {
    const old = this.inboxes.get(to);
    if (old) this._sigBytes -= this._inboxBytes(old);
    if (list && list.length) { this.inboxes.set(to, list); this._sigBytes += this._inboxBytes(list); }
    else this.inboxes.delete(to);
    if (this._sigBytes < 0) this._sigBytes = 0;
  }
  _pruneSignals(now = Date.now()) {
    for (const [to, list] of this.inboxes) {
      const keep = list.filter((r) => r && now - Number(r.ts || 0) <= SIGNAL_TTL_MS);
      if (keep.length !== list.length) this._setInbox(to, keep);
    }
  }
  // Returns false when the relay is full (the signal is then only pushed live).
  _parkSignal(record) {
    const now = record.ts, to = record.to;
    if (!this.inboxes.has(to) && this.inboxes.size >= SIGNAL_MAX_INBOXES) this._pruneSignals(now);
    if (!this.inboxes.has(to) && this.inboxes.size >= SIGNAL_MAX_INBOXES) return false;
    if (this._sigBytes + record.sz > SIGNAL_TOTAL_BYTES) this._pruneSignals(now);
    if (this._sigBytes + record.sz > SIGNAL_TOTAL_BYTES) return false;
    const list = (this.inboxes.get(to) || []).filter((r) => r && now - Number(r.ts || 0) <= SIGNAL_TTL_MS);
    list.push(record);
    // Over the per-inbox caps the OLDEST signals go first.
    let bytes = this._inboxBytes(list);
    while (list.length > 1 && (list.length > MAX_PER_INBOX || bytes > SIGNAL_INBOX_BYTES)) bytes -= Number(list.shift().sz) || 0;
    this._setInbox(to, list);
    return true;
  }

  // GET /signal/inbox. Unsigned like signal(); limited per inbox+IP and per IP.
  inbox({ to, from, since }, ip = 'noip') {
    if (!validAddr(to)) return fail('bad to');
    if (from && !validAddr(from)) return fail('bad from');
    const wait = this._limits([['signal-inbox-ip', ip, RL.signalInboxIp], ['signal-inbox', to + '|' + ip, RL.signalInbox]]);
    if (wait) return limited(wait, 'signal-inbox');

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

    this._setInbox(to, keep.slice(-MAX_PER_INBOX));

    messages.sort((a, b) => (a.ts || 0) - (b.ts || 0));
    return json({ messages: messages.slice(-MAX_PER_INBOX), hub: 'durable-object' });
  }

  // `from` is the verified signer (the router checked it).
  async msgSend(body) {
    const { from, to, payload } = body || {};
    if (!validAddr(from) || !validAddr(to)) return fail('bad addresses');
    if (!payload || typeof payload !== 'object') return fail('bad payload');
    const sz = JSON.stringify(payload).length;
    if (sz > MSG_PAYLOAD_MAX) return fail('payload too large', 413);
    // Per-sender rate (W5). The per-minute burst is a flood: the client backs off
    // from the hub (429). The hourly budget is only about sending: 403, so the
    // rest of the app keeps working.
    const hit = this._limitHit([['msg-min', from, RL.msgMin], ['msg-hour', from, RL.msgHour]]);
    if (hit.wait) return hit.bucket === 'msg-hour' ? refused(hit.wait, 'msg-hour', 'hourly_message_limit') : limited(hit.wait, 'msg');
    const now = Date.now();
    let rel = null, box = mboxOf(null), seen = 0;
    try {
      const got = await this.state.storage.get([FRIEND_PREFIX + to + ':' + from, MBOX_PREFIX + to, SEEN_PREFIX + to]);
      rel = got.get(FRIEND_PREFIX + to + ':' + from) || null;
      box = mboxOf(got.get(MBOX_PREFIX + to));
      seen = got.get(SEEN_PREFIX + to) || 0;
    } catch (_) {}
    // Block enforcement: if the recipient has blocked the sender, drop silently
    // (report ok so a blocker isn't revealed) — the message is simply not stored.
    if (rel && rel.state === 'blocked') return json({ ok: true, blocked: true, ts: now });
    // Per-recipient cap (W5). Someone the recipient accepted, or asked to
    // connect with, may use the whole mailbox; anyone else stops earlier, so the
    // last MAILBOX_MAX - MAILBOX_STRANGER items are always free for contacts.
    const known = !!(rel && (rel.state === 'accepted' || rel.state === 'pending-out'));
    const maxN = known ? MAILBOX_MAX_ITEMS : MAILBOX_STRANGER_ITEMS, maxB = known ? MAILBOX_MAX_BYTES : MAILBOX_STRANGER_BYTES;
    if (box.n + 1 > maxN || box.bytes + sz > maxB) {
      box = await this._mboxSweep(to, now).catch(() => box);
      // A state of the recipient, not the sender's rate: 409 without Retry-After,
      // so the sender's client neither pauses the hub nor resends it in a loop.
      if (box.n + 1 > maxN || box.bytes + sz > maxB) return refused(MAILBOX_FULL_RETRY_S, 'mailbox', 'mailbox_full', 409);
    }
    const id = (known ? '' : 'q') + messageId();
    const extra = { [SEEN_PREFIX + from]: now };
    // Mail from a non-contact is their way of asking to connect: the recipient's
    // "messaged you → Accept" may accept it for a week (friendRespond).
    if (!known) extra[DMIN_PREFIX + to + ':' + from] = now;
    await this._mboxPut({ id, from, to, ts: now, payload }, sz, box, extra);
    const pushed = this._pushTo(to, { t: 'msg', item: { id, from, to, ts: now, payload } });
    return json({ ok: true, id, ts: now, delivered: pushed > 0, online: this._presenceOf(to, seen, now).online, hub: 'durable-object' });
  }

  // ── Friend graph — contact WITHOUT establishing P2P first ────────────────
  async friendRequest(body) {
    const from = body && body.from, to = body && body.to;
    if (!validAddr(from) || !validAddr(to) || from === to) return fail('bad addresses');
    const now = Date.now();
    const got = await this.state.storage.get([FRIEND_PREFIX + to + ':' + from, FRIEND_PREFIX + from + ':' + to, SEEN_PREFIX + to]).catch(() => new Map());
    const rev = got.get(FRIEND_PREFIX + to + ':' + from) || null, mine = got.get(FRIEND_PREFIX + from + ':' + to) || null;
    const online = this._presenceOf(to, got.get(SEEN_PREFIX + to), now).online;
    if (rev && rev.state === 'blocked') return json({ ok: true, state: 'sent' });   // don't reveal block
    if (mine && mine.state === 'accepted') return json({ ok: true, state: 'accepted' });
    // They already asked me: asking them back is an acceptance.
    if (mine && mine.state === 'pending-in') return this._friendAccept(from, to, body && body.profile, now);
    // Asked again within the hour: nothing new to tell them (no second notice).
    if (rev && rev.state === 'pending-in' && mine && mine.state === 'pending-out' && now - Number(rev.ts || 0) < FRIEND_RENOTICE_MS) {
      return json({ ok: true, state: 'sent', ts: Number(rev.ts) || now, online });
    }
    // Symmetric pending edges. Also drop a mailbox notice so the recipient sees it
    // even if they never open the mesh while the requester is online.
    await this.state.storage.put({ [FRIEND_PREFIX + to + ':' + from]: { state: 'pending-in', ts: now }, [FRIEND_PREFIX + from + ':' + to]: { state: 'pending-out', ts: now } });
    await this._mboxNotice({ id: messageId(), from, to, ts: now, payload: { t: 'friend-request', from, profile: cleanProfile(body && body.profile) } }, false);
    return json({ ok: true, state: 'sent', ts: now, online });
  }
  // Both edges accepted + a notice to the other side. Callers have checked that
  // `other` asked `me` first (friend:<me>:<other> is pending-in, or `other`
  // mailed `me` as a non-contact within the week — see friendRespond).
  async _friendAccept(me, other, profile, now) {
    await this.state.storage.put({ [FRIEND_PREFIX + me + ':' + other]: { state: 'accepted', ts: now }, [FRIEND_PREFIX + other + ':' + me]: { state: 'accepted', ts: now } });
    await this.state.storage.delete([DMIN_PREFIX + me + ':' + other, DMIN_PREFIX + other + ':' + me]).catch(() => {});
    await this._mboxNotice({ id: messageId(), from: me, to: other, ts: now, payload: { t: 'friend-accepted', from: me, profile: cleanProfile(profile) } }, true);
    return json({ ok: true, state: 'accepted' });
  }
  async friendRespond(body) {
    const me = body && body.wallet, other = body && body.other, action = body && body.action;
    if (!validAddr(me) || !validAddr(other) || me === other) return fail('bad addresses');
    const now = Date.now();
    if (action === 'accept') {
      // W2: only someone who actually asked can be accepted — otherwise anyone
      // could make themselves your accepted friend. Asking is a pending friend
      // request from `other`, or mail `other` sent `me` as a non-contact in the
      // last week (the app's "messaged you → Accept").
      const kMine = FRIEND_PREFIX + me + ':' + other, kRev = FRIEND_PREFIX + other + ':' + me, kDm = DMIN_PREFIX + me + ':' + other;
      const got = await this.state.storage.get([kMine, kRev, kDm]).catch(() => new Map());
      const mine = got.get(kMine) || null, rev = got.get(kRev) || null, dm = Number(got.get(kDm)) || 0;
      if (mine && mine.state === 'accepted') return json({ ok: true, state: 'accepted' });
      if (mine && mine.state === 'pending-in') return this._friendAccept(me, other, body && body.profile, now);
      if (dm && now - dm < MSG_TTL_MS && !(rev && rev.state === 'blocked')) return this._friendAccept(me, other, body && body.profile, now);
      // Nobody asked (the request was withdrawn, or this is my own outgoing
      // request): nothing is written. The apps answer this code by sending a
      // request of their own (ost-social.js) or by saying so (ost-mesh-app.js);
      // an accept that silently became a request would make them say
      // "connected" when it is not.
      return json({ ok: false, error: 'no_pending_request', state: (mine && mine.state) || 'none' }, 409);
    }
    if (action === 'decline' || action === 'remove') {
      await this.state.storage.delete([FRIEND_PREFIX + me + ':' + other, FRIEND_PREFIX + other + ':' + me, DMIN_PREFIX + me + ':' + other, DMIN_PREFIX + other + ':' + me]).catch(() => {});
      return json({ ok: true, state: 'none' });
    }
    if (action === 'block') {
      await this.state.storage.put(FRIEND_PREFIX + me + ':' + other, { state: 'blocked', ts: now });
      // They lose their edge to me, and their mail no longer counts as asking.
      await this.state.storage.delete([FRIEND_PREFIX + other + ':' + me, DMIN_PREFIX + me + ':' + other, DMIN_PREFIX + other + ':' + me]).catch(() => {});
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

  // One page (≤ MAX_INBOX) of pending mail, oldest first in the response.
  // Contacts' mail and hub notices fill the page before anyone else's, so a
  // flood from strangers cannot hide them. `order=newest` takes the newest
  // items of each tier instead of the oldest. `more` says whether anything is
  // left after this page (ack or drain what you got, then ask again).
  async msgInbox(to, drain, order) {
    if (!validAddr(to)) return fail('bad to');
    const now = Date.now();
    const reverse = order === 'newest', draining = drain !== '0';
    const messages = [], del = [];
    let whole = true, live = 0, liveBytes = 0, gone = 0, goneBytes = 0;
    for (const pre of [MSG_PREFIX, MSQ_PREFIX]) {
      const room = MAX_INBOX - messages.length;
      if (room <= 0) { whole = false; break; }
      const listed = await this.state.storage.list({ prefix: pre + to + ':', limit: room, reverse });
      if (listed.size >= room) whole = false;
      for (const [key, rec] of listed) {
        const sz = msgSize(rec);
        if (!rec || (rec.expiresAt && rec.expiresAt <= now)) { del.push(key); gone++; goneBytes += sz; continue; }
        messages.push({ id: rec.id, from: rec.from, to: rec.to, ts: rec.ts, payload: rec.payload });
        if (draining) { del.push(key); gone++; goneBytes += sz; } else { live++; liveBytes += sz; }
      }
    }
    // storage.delete() takes at most 128 keys per call.
    for (let i = 0; i < del.length; i += 128) await this.state.storage.delete(del.slice(i, i + 128)).catch(() => {});
    const puts = { [SEEN_PREFIX + to]: now };
    if (whole) {
      // This page was the whole mailbox: what is left is exactly what we kept.
      if (live) puts[MBOX_PREFIX + to] = { n: live, bytes: liveBytes };
      else await this.state.storage.delete(MBOX_PREFIX + to).catch(() => {});
    } else if (gone) await this._mboxAdjust(to, -gone, -goneBytes).catch(() => {});
    await this.state.storage.put(puts);
    messages.sort((a, b) => a.ts - b.ts);
    return json({ ok: true, messages, count: messages.length, more: !whole, ts: now });
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
      presence[a] = this._presenceOf(a, await this.state.storage.get(SEEN_PREFIX + a).catch(() => 0), now);
    }));
    return json({ ok: true, presence, ts: now });
  }
}

installSocial(MeshHub, { json, fail, cors, validAddr, ID_PREFIX, sha256HexBytes, limited, refused });

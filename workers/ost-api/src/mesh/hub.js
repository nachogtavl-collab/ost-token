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

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
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
  return typeof value === 'string' && value.startsWith('ost-mesh:') && value.length <= 80;
}

function messageId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function isExpired(record, now = Date.now()) {
  return !record || Number(record.expiresAt || 0) <= now;
}

export class MeshHub {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.ids = new Map();
    this.inboxes = new Map();
  }

  async fetch(request) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors() });

    try {
      const url = new URL(request.url);
      const path = url.pathname.replace(/\/$/, '') || '/';
      const method = request.method;

      if (path === '/mesh/v1/health') {
        return json({ ok: true, mesh: 'v1', hub: 'durable-object', ts: new Date().toISOString() });
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
        const body = await request.json().catch(() => ({}));
        return this.msgSend(body);
      }
      if (method === 'GET' && path === '/mesh/v1/msg/inbox') {
        return this.msgInbox(url.searchParams.get('to'), url.searchParams.get('drain'));
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
      existing = await this.state.storage.get(ID_PREFIX + address).catch(() => null);
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
    const inbox = this.inboxes.get(to) || [];
    inbox.push(record);
    this.inboxes.set(to, inbox.slice(-MAX_PER_INBOX));
    this.pruneInbox(to, ts);
    return json({ ok: true, id: record.id, ts, hub: 'durable-object' });
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
    if (JSON.stringify(payload).length > 16000) return fail('payload too large');
    const now = Date.now();
    const id = messageId();
    const key = MSG_PREFIX + to + ':' + String(now).padStart(14, '0') + ':' + id;
    await this.state.storage.put(key, { id, from, to, ts: now, payload, expiresAt: now + MSG_TTL_MS });
    await this.state.storage.put(SEEN_PREFIX + from, now);
    return json({ ok: true, id, ts: now, hub: 'durable-object' });
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
      presence[a] = { lastSeen: ts || null, online: ts > 0 && (now - ts) < SEEN_TTL_MS };
    }));
    return json({ ok: true, presence, ts: now });
  }
}
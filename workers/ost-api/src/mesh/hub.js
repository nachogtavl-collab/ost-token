/* workers/ost-api/src/mesh/hub.js
  Durable Object-backed OST Mesh directory and signaling hub.
  Keeps active WebRTC signaling off KV so daily KV write limits cannot break P2P.
*/

const ID_PREFIX = 'id:';
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

      return fail('mesh route not found: ' + method + ' ' + path, 404);
    } catch (error) {
      return fail('mesh hub error: ' + String(error?.message || error), 500);
    }
  }

  async announce(body) {
    const { address, bundle, fingerprint } = body || {};
    if (!validAddr(address)) return fail('bad address');
    if (!bundle || bundle.v !== 1) return fail('bad bundle');
    if (!bundle.kex || !bundle.sig) return fail('missing keys');

    const now = Date.now();
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
}
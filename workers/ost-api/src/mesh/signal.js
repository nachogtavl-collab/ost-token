/* workers/ost-api/src/mesh/signal.js
  Lightweight WebRTC signaling inbox.
  Each signal is stored under its own KV key so concurrent ICE/SDP writes
  cannot overwrite each other. Inbox reads drain delivered messages.
*/

const LEGACY_PREFIX = 'mesh:sig:';
const PREFIX = 'mesh:sig:v2:';
const TTL_SECONDS = 60 * 5;
const MAX_PER_INBOX = 64;

function validAddr(a) {
  return typeof a === 'string' && a.startsWith('ost-mesh:') && a.length <= 80;
}

function inboxPrefix(to) {
  return PREFIX + to + ':';
}

function messageId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function legacyKey(to) {
  return LEGACY_PREFIX + to;
}

export async function signalSend(env, body, ok, err) {
  const { from, to, payload } = body || {};
  if (!validAddr(from) || !validAddr(to)) return err('bad addresses');
  if (!payload || typeof payload !== 'object') return err('bad payload');
  if (JSON.stringify(payload).length > 32_000) return err('payload too large');

  const ts = Date.now();
  const id = messageId();
  const key = inboxPrefix(to) + ts + ':' + id;
  await env.OST_KV.put(key, JSON.stringify({ id, from, to, ts, payload }), { expirationTtl: TTL_SECONDS });
  return ok({ ok: true, id, ts });
}

export async function signalInbox(env, { to, from, since }, ok, err) {
  if (!validAddr(to))   return err('bad to');
  if (from && !validAddr(from)) return err('bad from');
  const minTs = Number(since || 0);
  const messages = [];
  const deleteKeys = [];

  const listed = await env.OST_KV.list({ prefix: inboxPrefix(to), limit: MAX_PER_INBOX });
  const records = await Promise.all((listed.keys || []).map(async (entry) => {
    try {
      const raw = await env.OST_KV.get(entry.name);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return { key: entry.name, record: parsed };
    } catch {
      deleteKeys.push(entry.name);
      return null;
    }
  }));

  for (const item of records) {
    if (!item?.record) continue;
    const record = item.record;
    if (record.ts <= minTs) {
      deleteKeys.push(item.key);
      continue;
    }
    if (from && record.from !== from) continue;
    messages.push({ id: record.id, from: record.from, ts: record.ts, payload: record.payload });
    deleteKeys.push(item.key);
  }

  const legacyRaw = await env.OST_KV.get(legacyKey(to));
  if (legacyRaw) {
    try {
      const legacy = JSON.parse(legacyRaw);
      for (const record of Array.isArray(legacy) ? legacy : []) {
        if (record.ts > minTs && (!from || record.from === from)) messages.push(record);
      }
    } catch {}
    deleteKeys.push(legacyKey(to));
  }

  if (deleteKeys.length) {
    await Promise.all([...new Set(deleteKeys)].map((key) => env.OST_KV.delete(key).catch(() => {})));
  }

  messages.sort((a, b) => (a.ts || 0) - (b.ts || 0));
  return ok({ messages: messages.slice(-MAX_PER_INBOX) });
}

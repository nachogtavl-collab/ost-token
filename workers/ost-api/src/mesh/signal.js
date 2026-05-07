/* workers/ost-api/src/mesh/signal.js
   Lightweight WebRTC signaling inbox.
   Each "to" address holds a rolling list of envelopes (max 64, TTL 5 min).
*/

const PREFIX = 'mesh:sig:';
const TTL_SECONDS = 60 * 5;
const MAX_PER_INBOX = 64;

function validAddr(a) {
  return typeof a === 'string' && a.startsWith('ost-mesh:') && a.length <= 80;
}

export async function signalSend(env, body, ok, err) {
  const { from, to, payload } = body || {};
  if (!validAddr(from) || !validAddr(to)) return err('bad addresses');
  if (!payload || typeof payload !== 'object') return err('bad payload');
  if (JSON.stringify(payload).length > 32_000) return err('payload too large');

  const key = PREFIX + to;
  const raw = await env.OST_KV.get(key);
  let list = [];
  if (raw) { try { list = JSON.parse(raw); } catch {} }
  list.push({ from, ts: Date.now(), payload });
  if (list.length > MAX_PER_INBOX) list = list.slice(-MAX_PER_INBOX);

  await env.OST_KV.put(key, JSON.stringify(list), { expirationTtl: TTL_SECONDS });
  return ok({ ok: true, queued: list.length });
}

export async function signalInbox(env, { to, from, since }, ok, err) {
  if (!validAddr(to))   return err('bad to');
  if (from && !validAddr(from)) return err('bad from');
  const raw = await env.OST_KV.get(PREFIX + to);
  if (!raw) return ok({ messages: [] });
  let list = [];
  try { list = JSON.parse(raw); } catch { return ok({ messages: [] }); }

  const filtered = list
    .filter((m) => m.ts > (since || 0))
    .filter((m) => !from || m.from === from);

  return ok({ messages: filtered });
}

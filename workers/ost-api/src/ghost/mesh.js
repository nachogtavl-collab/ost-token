/* ============================================================
   workers/ost-api/src/ghost/mesh.js
   Stub mesh signaling. Stores ephemeral peer ids in KV with TTL.
   ============================================================ */

const PEER_TTL_SEC = 90;
const KEY_PREFIX = 'ghost:peer:';

function rid() {
  return 'p_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export async function meshAnnounce(env, body, request) {
  const id = rid();
  const cf = (request && request.cf) || {};
  const peer = {
    id,
    ts: Date.now(),
    colo: cf.colo || null,
    country: cf.country || null
  };
  if (env && env.OST_KV) {
    try {
      await env.OST_KV.put(KEY_PREFIX + id, JSON.stringify(peer), { expirationTtl: PEER_TTL_SEC });
    } catch {}
  }
  return { ok: true, id, ttl: PEER_TTL_SEC };
}

export async function meshPeers(env) {
  if (!env || !env.OST_KV) return { peers: [] };
  try {
    const list = await env.OST_KV.list({ prefix: KEY_PREFIX, limit: 100 });
    const peers = [];
    for (const k of list.keys || []) {
      try {
        const v = await env.OST_KV.get(k.name);
        if (v) peers.push(JSON.parse(v));
      } catch {}
    }
    return { peers };
  } catch {
    return { peers: [] };
  }
}

export async function meshBroadcast(_env, body) {
  // Phase-2 stub: real fanout requires Durable Objects or pub/sub.
  return { ok: true, fanout: 0, note: 'broadcast stub; durable-object fanout lands later', echo: body && body.payload };
}

/* ============================================================
   workers/ost-api/src/mesh/index.js
   Router for /mesh/v1/*
     • Identity directory (announce / lookup) — KV
     • Signaling inbox (send / inbox) — KV with TTL
   No message body inspection — payloads are encrypted by the client.
   We only relay envelopes addressed by mesh address.
   ============================================================ */

import { identityAnnounce, identityLookup }   from './identity.js';
import { signalSend, signalInbox }            from './signal.js';

function meshHub(env) {
  if (!env.MESH_HUB) return null;
  return env.MESH_HUB.get(env.MESH_HUB.idFromName('mesh-v1'));
}

const ok   = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: cors({ 'Content-Type': 'application/json' })
  });

const err  = (msg, status = 400) =>
  new Response(JSON.stringify({ ok: false, error: msg }), {
    status,
    headers: cors({ 'Content-Type': 'application/json' })
  });

function cors(extra = {}) {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, x-ost-wallet, x-ost-ts, x-ost-nonce, x-ost-sig, x-ost-session, x-ost-internal, x-mesh-addr, x-mesh-ts, x-mesh-nonce, x-mesh-sig',
    ...extra
  };
}

// ── ICE servers (STUN + Cloudflare TURN) ─────────────────────────────────
// Peers on different networks (phone on LTE ↔ laptop on Wi-Fi) almost never
// connect with STUN alone; TURN relays the data channel when NAT traversal
// fails. Credentials are minted from the account's TURN key (secrets
// TURN_KEY_ID / TURN_KEY_SECRET) and cached briefly; without the secrets we
// fall back to public STUN so the mesh still works on the same network.
const PUBLIC_STUN = [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }];
let iceCache = { at: 0, servers: null };
async function iceServers(env) {
  if (iceCache.servers && Date.now() - iceCache.at < 10 * 60 * 1000) return { iceServers: iceCache.servers, turn: true, cached: true };
  const id = env && env.TURN_KEY_ID, secret = env && env.TURN_KEY_SECRET;
  if (!id || !secret) return { iceServers: PUBLIC_STUN, turn: false };
  try {
    const r = await fetch('https://rtc.live.cloudflare.com/v1/turn/keys/' + encodeURIComponent(id) + '/credentials/generate-ice-servers', {
      method: 'POST', headers: { Authorization: 'Bearer ' + secret, 'Content-Type': 'application/json' }, body: JSON.stringify({ ttl: 2 * 60 * 60 })
    });
    const d = await r.json().catch(() => null);
    const servers = d && (Array.isArray(d.iceServers) ? d.iceServers : (d.iceServers ? [d.iceServers] : null));
    if (!r.ok || !servers || !servers.length) return { iceServers: PUBLIC_STUN, turn: false, error: 'turn_mint_failed' };
    iceCache = { at: Date.now(), servers };
    return { iceServers: servers, turn: true };
  } catch (e) { return { iceServers: PUBLIC_STUN, turn: false, error: String(e && e.message || e) }; }
}

export async function handleMeshRequest(request, env, { path, method }) {
  if (method === 'OPTIONS') return new Response(null, { status: 204, headers: cors() });

  if (method === 'GET' && path === '/mesh/v1/ice') {
    const ice = await iceServers(env);
    return ok({ ok: true, ...ice, ttl: 7200, ts: Date.now() });
  }

  const hub = meshHub(env);
  if (hub) {
    try {
      return await hub.fetch(request);
    } catch (error) {
      return err('mesh hub unavailable: ' + String(error?.message || error), 503);
    }
  }

  if (path === '/mesh/v1/health') {
    return ok({ ok: true, mesh: 'v1', ts: new Date().toISOString() });
  }

  if (method === 'GET' && path === '/mesh/v1/directory') {
    return ok({ ok: true, identities: [], count: 0, note: 'directory requires durable-object hub', ts: new Date().toISOString() });
  }

  if (method === 'POST' && path === '/mesh/v1/identity/announce') {
    const body = await request.json().catch(() => ({}));
    return identityAnnounce(env, body, ok, err);
  }
  if (method === 'GET'  && path === '/mesh/v1/identity/lookup') {
    const url = new URL(request.url);
    return identityLookup(env, url.searchParams.get('address'), ok, err);
  }

  if (method === 'POST' && path === '/mesh/v1/signal/send') {
    const body = await request.json().catch(() => ({}));
    return signalSend(env, body, ok, err);
  }
  if (method === 'GET'  && path === '/mesh/v1/signal/inbox') {
    const url = new URL(request.url);
    return signalInbox(env, {
      to:    url.searchParams.get('to'),
      from:  url.searchParams.get('from'),
      since: Number(url.searchParams.get('since') || 0)
    }, ok, err);
  }

  return err('mesh route not found: ' + method + ' ' + path, 404);
}

/* ============================================================
   workers/ost-api/src/mesh/index.js
   Router for /mesh/v1/*
     • GET /mesh/v1/ice — STUN + Cloudflare TURN credentials (below).
     • Every other route goes to the MeshHub Durable Object (hub.js, which
       installs social.js): identity directory, realtime socket, mailbox, blob
       relay, friend graph, presence, call signalling, the legacy pavilion
       feed and OST Social. The route list with auth rules is at the top of
       hub.js. Production always binds MESH_HUB (wrangler.toml).
     • Only when that binding is missing (a misconfigured deploy) does a
       minimal KV fallback answer: identity announce/lookup (identity.js) and
       call signalling (signal.js), rate-limited in this isolate's memory.
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
    'Access-Control-Allow-Headers': 'Content-Type, Range, If-None-Match, If-Range, x-ost-wallet, x-ost-ts, x-ost-nonce, x-ost-sig, x-ost-session, x-ost-internal, x-mesh-addr, x-mesh-ts, x-mesh-nonce, x-mesh-sig',
    'Access-Control-Expose-Headers': 'Content-Range, Accept-Ranges, Content-Length, ETag, Retry-After, X-Blob-Size',
    ...extra
  };
}

// Fallback-only limiter (fixed windows in this isolate's memory). Same 429
// shape as the hub: Retry-After header + { ok:false, error:'rate_limited', retryAfter, scope }.
const fallbackWindows = new Map();
function fallbackLimit(scope, key, max, windowMs) {
  const now = Date.now(), k = scope + '|' + key;
  let w = fallbackWindows.get(k);
  if (!w || now - w.at >= windowMs) { w = { at: now, n: 0 }; fallbackWindows.set(k, w); }
  if (w.n >= max) {
    const s = Math.max(1, Math.ceil((w.at + windowMs - now) / 1000));
    return new Response(JSON.stringify({ ok: false, error: 'rate_limited', retryAfter: s, scope }), { status: 429, headers: cors({ 'Content-Type': 'application/json', 'Retry-After': String(s) }) });
  }
  w.n++;
  if (fallbackWindows.size > 10000) fallbackWindows.clear();
  return null;
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

  const ip = (request.headers.get('CF-Connecting-IP') || 'noip').slice(0, 64);
  const bodyOf = async (max) => {
    const text = await request.text().catch(() => '');
    if (text.length > max) return null;
    try { return JSON.parse(text) || {}; } catch (_) { return {}; }
  };

  if (method === 'POST' && path === '/mesh/v1/identity/announce') {
    const lim = fallbackLimit('announce', ip, 120, 60 * 60 * 1000);
    if (lim) return lim;
    const body = await bodyOf(8192);
    if (!body) return err('announce_too_large', 413);
    return identityAnnounce(env, body, ok, err);
  }
  if (method === 'GET'  && path === '/mesh/v1/identity/lookup') {
    const url = new URL(request.url);
    return identityLookup(env, url.searchParams.get('address'), ok, err);
  }

  // Unsigned for the legacy pavilion's sake (see signal.js); limited + capped.
  if (method === 'POST' && path === '/mesh/v1/signal/send') {
    const body = await bodyOf(34_000);
    if (!body) return err('payload too large', 413);
    const lim = fallbackLimit('signal', ip, 600, 60 * 1000) || fallbackLimit('signal-from', String(body.from || '') + '|' + ip, 240, 60 * 1000);
    if (lim) return lim;
    return signalSend(env, body, ok, err);
  }
  if (method === 'GET'  && path === '/mesh/v1/signal/inbox') {
    const url = new URL(request.url);
    const lim = fallbackLimit('signal-inbox', ip, 600, 60 * 1000) || fallbackLimit('signal-inbox-to', String(url.searchParams.get('to') || '') + '|' + ip, 240, 60 * 1000);
    if (lim) return lim;
    return signalInbox(env, {
      to:    url.searchParams.get('to'),
      from:  url.searchParams.get('from'),
      since: Number(url.searchParams.get('since') || 0)
    }, ok, err);
  }

  return err('mesh route not found: ' + method + ' ' + path, 404);
}

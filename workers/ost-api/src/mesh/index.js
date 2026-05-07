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
    'Access-Control-Allow-Headers': 'Content-Type',
    ...extra
  };
}

export async function handleMeshRequest(request, env, { path, method }) {
  if (method === 'OPTIONS') return new Response(null, { status: 204, headers: cors() });

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

/* ============================================================
   workers/ost-api/src/ghost/index.js
   Ghost AI v2 router. Mounts /ghost/v2/*:
     POST /ghost/v2/chat               (free relay rotation)
     POST /ghost/v2/proxy/anthropic    (CORS bypass for user keys)
     POST /ghost/v2/mesh/announce
     GET  /ghost/v2/mesh/peers
     POST /ghost/v2/mesh/broadcast
     POST /ghost/v2/memory/save
     GET  /ghost/v2/memory/recent
   ============================================================ */

import { freeRelayChat } from './relay.js';
import { meshAnnounce, meshPeers, meshBroadcast } from './mesh.js';
import { memorySave, memoryRecent } from './memory.js';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-OST-Key'
};

function json(body, init = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...CORS_HEADERS,
      ...(init.headers || {})
    }
  });
}

export async function handleGhostV2Request(request, env, { path, method }) {
  if (!path.startsWith('/ghost/v2/')) return null;
  if (method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });

  try {
    if (path === '/ghost/v2/health') {
      return json({ ok: true, ghost: 'v2', ts: new Date().toISOString() });
    }

    if (path === '/ghost/v2/chat' && method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const result = await freeRelayChat(env, body);
      return json(result);
    }

    if (path === '/ghost/v2/proxy/anthropic' && method === 'POST') {
      const body = await request.json().catch(() => ({}));
      if (!body.key) return json({ error: 'key required' }, { status: 400 });
      const messages = [
        ...(body.history || []).slice(-10).map((h) => ({
          role: h.role === 'assistant' ? 'assistant' : 'user',
          content: h.text
        })),
        { role: 'user', content: String(body.prompt || '') }
      ];
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': body.key,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: body.model || 'claude-3-5-haiku-latest',
          max_tokens: 512,
          system: 'You are OST Ghost. Be concise and curious.',
          messages
        })
      });
      const data = await r.json().catch(() => ({}));
      const text = (data.content || []).map((c) => c.text || '').join('');
      return json({ text, source: 'anthropic', raw: data }, { status: r.status });
    }

    if (path === '/ghost/v2/mesh/announce' && method === 'POST') {
      const body = await request.json().catch(() => ({}));
      return json(await meshAnnounce(env, body, request));
    }
    if (path === '/ghost/v2/mesh/peers' && method === 'GET') {
      return json(await meshPeers(env));
    }
    if (path === '/ghost/v2/mesh/broadcast' && method === 'POST') {
      const body = await request.json().catch(() => ({}));
      return json(await meshBroadcast(env, body));
    }

    if (path === '/ghost/v2/memory/save' && method === 'POST') {
      const body = await request.json().catch(() => ({}));
      return json(await memorySave(env, body));
    }
    if (path === '/ghost/v2/memory/recent' && method === 'GET') {
      return json(await memoryRecent(env));
    }

    return json({ error: 'unknown ghost v2 endpoint', path }, { status: 404 });
  } catch (err) {
    return json({ error: String((err && err.message) || err) }, { status: 500 });
  }
}

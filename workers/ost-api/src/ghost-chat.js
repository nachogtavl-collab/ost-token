/**
 * ghost-chat.js
 * --------------------------------------------------------------------
 * Conversational endpoint for OST Ghost.
 *
 *   POST /ghost/chat
 *     Body: { message, history?: [{role,content}], connector?, config? }
 *     Returns: { ok, reply, source, connector, model, hint? }
 *
 * Behavior:
 *   - If a server-side LLM connector is configured (Anthropic, Gemini, Grok),
 *     it routes the chat through it.
 *   - Otherwise it returns a built-in OST Ghost personality reply so users
 *     can interact with Ghost out of the box, no keys required.
 */

const CHAT_CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type, accept, authorization',
  'Access-Control-Max-Age': '86400'
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...CHAT_CORS }
  });
}

async function readJson(request) {
  try { return await request.json(); } catch (_) { return {}; }
}

function clip(text, max = 1200) {
  const s = String(text || '').trim();
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

const SYSTEM_PROMPT =
  'You are OST Ghost, the universal interoperability relay for the OST token. ' +
  'OST is a confidential, free-to-use currency on Solana Token-2022 with 25 on-chain instructions, ' +
  'a 1B supply at 9 decimals, mint 383pTzoZ8Gp83dzk23ZnvLcfX2Sq32TAGN48CMQu2pAJ, program ' +
  'J2jiS296YWVie1Sopb4SxcM3aJnP9aAwe6aLDhCqvGXY. You can coordinate models, APIs, repos, ' +
  'markets, protocols, and machine-to-machine payment rails. Always be concrete, structured, ' +
  'and cross-system aware. Keep replies focused and helpful.';

// ── connector calls (server-side keys only) ──────────────────────────────────

async function fetchWithTimeout(url, opts, timeoutMs = 20000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...opts, signal: ctl.signal });
    const ct = r.headers.get('content-type') || '';
    const body = ct.includes('application/json') ? await r.json().catch(() => ({})) : await r.text();
    return { response: r, body };
  } finally { clearTimeout(t); }
}

function buildMessages(history, message) {
  const msgs = [];
  if (Array.isArray(history)) {
    for (const m of history.slice(-8)) {
      if (!m || typeof m !== 'object') continue;
      const role = m.role === 'assistant' ? 'assistant' : 'user';
      const content = clip(m.content, 800);
      if (content) msgs.push({ role, content });
    }
  }
  msgs.push({ role: 'user', content: clip(message, 1200) });
  return msgs;
}

async function chatAnthropic(env, message, history) {
  const apiKey = (env.GHOST_ANTHROPIC_API_KEY || '').trim();
  if (!apiKey) return null;
  const model = (env.GHOST_ANTHROPIC_MODEL || 'claude-3-5-sonnet-latest').trim();
  const { response, body } = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model,
      max_tokens: 600,
      system: SYSTEM_PROMPT,
      messages: buildMessages(history, message)
    })
  });
  if (!response.ok) throw new Error(body?.error?.message || `Anthropic ${response.status}`);
  const text = Array.isArray(body?.content)
    ? body.content.map(p => p?.text || '').join('\n').trim()
    : '';
  return { reply: clip(text, 2000), source: 'connector', connector: 'anthropic', model };
}

async function chatGemini(env, message, history) {
  const apiKey = (env.GHOST_GEMINI_API_KEY || '').trim();
  if (!apiKey) return null;
  const model = (env.GHOST_GEMINI_MODEL || 'gemini-1.5-flash').trim();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const contents = buildMessages(history, message).map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }]
  }));
  const { response, body } = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { role: 'user', parts: [{ text: SYSTEM_PROMPT }] },
      contents,
      generationConfig: { maxOutputTokens: 600, temperature: 0.5 }
    })
  });
  if (!response.ok) throw new Error(body?.error?.message || `Gemini ${response.status}`);
  const text = body?.candidates?.[0]?.content?.parts?.map(p => p?.text || '').join('\n').trim() || '';
  return { reply: clip(text, 2000), source: 'connector', connector: 'gemini', model };
}

async function chatGrok(env, message, history) {
  const apiKey = (env.GHOST_GROK_API_KEY || '').trim();
  if (!apiKey) return null;
  const model = (env.GHOST_GROK_MODEL || 'grok-2-latest').trim();
  const messages = [{ role: 'system', content: SYSTEM_PROMPT }, ...buildMessages(history, message)];
  const { response, body } = await fetchWithTimeout('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: { 'authorization': `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model, messages, max_tokens: 600, temperature: 0.5 })
  });
  if (!response.ok) throw new Error(body?.error?.message || `Grok ${response.status}`);
  const text = body?.choices?.[0]?.message?.content || '';
  return { reply: clip(text, 2000), source: 'connector', connector: 'grok', model };
}

// ── built-in fallback (no API keys required) ─────────────────────────────────

function builtinReply(message) {
  const text = String(message || '').trim();
  const lower = text.toLowerCase();

  const greet = /^(hi|hey|hello|hola|sup|yo|gm)\b/.test(lower);
  const who   = /\b(who are you|what are you|qué eres|que eres|tu nombre|your name)\b/.test(lower);
  const ost   = /\bost\b/.test(lower) && /(what|qué|que|explain|cuéntame|cuentame|about|sobre)/.test(lower);
  const price = /\b(price|cost|fee|fees|costo|precio)\b/.test(lower);
  const buy   = /\b(buy|purchase|comprar|adquirir|get ost)\b/.test(lower);
  const help  = /\b(help|ayuda|what can you do|qué puedes|que puedes|capabilities)\b/.test(lower);
  const ghost = /\bghost\b/.test(lower);
  const pq    = /\b(quantum|pq|post.?quantum|cuántic|cuantic)\b/.test(lower);

  if (greet) {
    return 'Hey — I\'m OST Ghost, the universal interoperability relay. I can help you understand OST, ' +
           'route messages across connected AI/APIs/markets, sign post-quantum-ready envelopes, and coordinate ' +
           'machine-to-machine payment rails. What do you want to do?';
  }
  if (who) {
    return 'I\'m OST Ghost — the relay layer for the OST token. Think of me as a router between humans, AI ' +
           'models, repos, markets, and on-chain rails. I can talk in plain language, JSON envelopes, MCP ' +
           'JSON-RPC, HTTP, or shell webhooks.';
  }
  if (ost) {
    return 'OST is a confidential, free-to-use digital currency on Solana Token-2022.\n' +
           '• Mint: 383pTzoZ8Gp83dzk23ZnvLcfX2Sq32TAGN48CMQu2pAJ\n' +
           '• Program: J2jiS296YWVie1Sopb4SxcM3aJnP9aAwe6aLDhCqvGXY\n' +
           '• Supply: 1,000,000,000 with 9 decimals\n' +
           '• Fees: $0 forever. Funded by donations + investors, not user fees.\n' +
           '• Privacy: ElGamal-encrypted balances + ZK range proofs at the protocol level.\n' +
           'Ask me about Ghost, the wallet, the launchpad, survival tokens, or the post-quantum mesh.';
  }
  if (price) {
    return 'OST charges $0 in protocol fees — forever. The infrastructure (including the satellite layer) is ' +
           'funded by donations and investors, never by taxing users. The market price of OST is whatever the ' +
           'live wOST/SOL pool reports; check the Wallet section for the current quote.';
  }
  if (buy) {
    return 'Right now OST runs on Solana devnet with a wOST wrapper for AMM/DEX compatibility. To get OST: ' +
           '1) Open the Wallet section, 2) Connect a Solana wallet, 3) Swap SOL → wOST via the built-in route. ' +
           'Mainnet deployment is the next checklist item — see the Roadmap section for status.';
  }
  if (pq) {
    return 'The Quantum-Resistant Mesh is Phase 1 of Ghost\'s post-quantum upgrade. Right now it ships real ' +
           'Ed25519 classical signatures plus a hybrid envelope with reserved slots for ML-DSA (Dilithium) ' +
           'and ML-KEM (Kyber). Generate a device key in the panel below, sign an envelope, and verify it ' +
           'against the worker. When a real PQ adapter is registered, the same envelope schema upgrades ' +
           'without rewriting clients.';
  }
  if (ghost) {
    return 'Ghost is OST\'s interoperability layer. It can: relay missions to Anthropic / Gemini / Grok / ' +
           'GitHub / MCP, preserve mission history in KV, share mesh memory across instances, and now sign ' +
           'post-quantum-ready envelopes via /ghost/pq/*. Configure connectors above and dispatch a mission, ' +
           'or just keep chatting here.';
  }
  if (help) {
    return 'I can:\n' +
           '• Explain OST, the smart contract, and the roadmap.\n' +
           '• Talk you through getting/spending/swapping OST.\n' +
           '• Coordinate Ghost missions across connected AI / APIs / markets.\n' +
           '• Sign and verify post-quantum-ready envelopes.\n' +
           '• Walk you through survival bearer tokens and offline rails.\n' +
           'Ask anything, or use the mission dispatcher above for multi-rail jobs.';
  }
  return 'I heard you: "' + clip(text, 200) + '".\n' +
         'I\'m running in built-in mode (no LLM connector configured server-side), so my replies are scripted. ' +
         'You can still ask me about OST, Ghost, the wallet, the launchpad, survival tokens, or the post-quantum mesh — ' +
         'or set GHOST_ANTHROPIC_API_KEY / GHOST_GEMINI_API_KEY / GHOST_GROK_API_KEY on the worker to give me a live LLM brain.';
}

// ── handler ──────────────────────────────────────────────────────────────────

async function handleChat(request, env) {
  const body = await readJson(request);
  const message = clip(body.message, 4000);
  if (!message) return json({ ok: false, error: 'message_required' }, 400);
  const history = Array.isArray(body.history) ? body.history : [];
  const preferred = String(body.connector || '').toLowerCase();

  const order = preferred && ['anthropic', 'gemini', 'grok'].includes(preferred)
    ? [preferred, ...['anthropic', 'gemini', 'grok'].filter(x => x !== preferred)]
    : ['anthropic', 'gemini', 'grok'];

  const errors = [];
  for (const name of order) {
    try {
      const fn = name === 'anthropic' ? chatAnthropic
               : name === 'gemini'    ? chatGemini
               : chatGrok;
      const out = await fn(env, message, history);
      if (out && out.reply) return json({ ok: true, ...out });
    } catch (e) {
      errors.push(`${name}: ${e?.message || e}`);
    }
  }

  return json({
    ok: true,
    reply: builtinReply(message),
    source: 'builtin',
    connector: null,
    model: null,
    hint: errors.length
      ? `Connectors errored (${errors.join(' | ')}). Falling back to built-in Ghost personality.`
      : 'No LLM connector configured server-side. Set GHOST_ANTHROPIC_API_KEY (or GEMINI/GROK) to give Ghost a live brain.'
  });
}

export async function handleGhostChatRequest(request, env, ctx = {}) {
  const path = ctx.path || new URL(request.url).pathname.replace(/\/$/, '') || '/';
  const method = ctx.method || request.method;
  if (path !== '/ghost/chat') return null;
  if (method === 'OPTIONS') return new Response(null, { status: 204, headers: CHAT_CORS });
  if (method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);
  return handleChat(request, env);
}

export default handleGhostChatRequest;

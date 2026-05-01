const GHOST_CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type, accept, x-ost-wallet',
  'Access-Control-Max-Age': '86400'
};

const GHOST_CONNECTOR_META = {
  anthropic: { label: 'Anthropic', protocols: ['Messages API', 'JSON'] },
  gemini: { label: 'Gemini', protocols: ['GenerateContent', 'JSON'] },
  grok: { label: 'Grok', protocols: ['Chat Completions', 'JSON'] },
  github: { label: 'GitHub', protocols: ['REST', 'Repository'] },
  mcp: { label: 'MCP', protocols: ['JSON-RPC', 'SSE', 'Streamable HTTP'] }
};

const DEFAULT_MODELS = {
  anthropic: 'claude-3-5-sonnet-latest',
  gemini: 'gemini-2.0-flash',
  grok: 'grok-beta'
};

const MISSION_TTL_SECONDS = 60 * 60 * 24 * 30;
const HISTORY_LIMIT = 100;
const MESH_LIMIT = 60;
const CONNECTOR_TIMEOUT_MS = 30000;

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...GHOST_CORS_HEADERS,
      ...extra
    }
  });
}

async function readJson(request) {
  try { return await request.json(); }
  catch (_) { return {}; }
}

function clipText(value, max = 1200) {
  return String(value == null ? '' : value).replace(/\u0000/g, '').slice(0, max);
}

function cleanText(value, max = 400) {
  return clipText(value, max).replace(/[\r\n]+/g, ' ').trim();
}

function cleanNumber(value, fallback = null, min = null, max = null) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  if (Number.isFinite(min) && number < min) return fallback;
  if (Number.isFinite(max) && number > max) return fallback;
  return number;
}

function toIso(ts = Date.now()) {
  return new Date(ts).toISOString();
}

function missionId() {
  return `ghost-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
}

async function kvGet(env, key, fallback = null) {
  if (!env.OST_KV) return fallback;
  try {
    const value = await env.OST_KV.get(key, { type: 'json' });
    return value ?? fallback;
  } catch (_) {
    return fallback;
  }
}

async function kvPut(env, key, value, expirationTtl = null) {
  if (!env.OST_KV) return false;
  try {
    const options = Number.isFinite(Number(expirationTtl)) && Number(expirationTtl) > 0
      ? { expirationTtl: Number(expirationTtl) }
      : undefined;
    await env.OST_KV.put(key, JSON.stringify(value), options);
    return true;
  } catch (_) {
    return false;
  }
}

function normalizeConnectorName(value) {
  const connector = String(value || '').trim().toLowerCase();
  return connector === 'claude' ? 'anthropic' : connector;
}

function connectorLabel(value) {
  const connector = normalizeConnectorName(value);
  return GHOST_CONNECTOR_META[connector]?.label || cleanText(value || 'Unknown connector', 80);
}

function connectorProtocols(value) {
  const connector = normalizeConnectorName(value);
  return Array.isArray(GHOST_CONNECTOR_META[connector]?.protocols)
    ? GHOST_CONNECTOR_META[connector].protocols
    : [];
}

function isPrivateHostname(hostname) {
  const host = String(hostname || '').trim().toLowerCase();
  if (!host) return true;
  if (host === 'localhost' || host === '0.0.0.0' || host === '::1' || host === '[::1]') return true;
  if (host.endsWith('.local') || host.endsWith('.internal')) return true;
  if (/^127\./.test(host) || /^10\./.test(host)) return true;
  if (/^192\.168\./.test(host)) return true;
  const octets = host.split('.').map(part => Number(part));
  if (octets.length === 4 && octets.every(part => Number.isInteger(part) && part >= 0 && part <= 255)) {
    if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) return true;
  }
  return false;
}

function sanitizeUrl(value, env) {
  try {
    const url = new URL(String(value || '').trim());
    if (!/^https?:$/.test(url.protocol)) return null;
    const allowPrivate = String(env.GHOST_ALLOW_PRIVATE_HOSTS || '').toLowerCase() === 'true';
    if (!allowPrivate && isPrivateHostname(url.hostname)) return null;
    return url.toString();
  } catch (_) {
    return null;
  }
}

function summariseUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch (_) {
    return '';
  }
}

function uniqueStrings(values, limit = 12) {
  return Array.from(new Set((Array.isArray(values) ? values : [])
    .map(value => cleanText(value, 240))
    .filter(Boolean))).slice(0, limit);
}

function extractPromptUrls(text) {
  const matches = String(text || '').match(/https?:\/\/[^\s)"'<>]+/gi) || [];
  return uniqueStrings(matches, 4);
}

function detectGhostIntents(prompt) {
  const text = String(prompt || '').toLowerCase();
  const intents = [];
  if (/repo|code|commit|pull request|debug|build|deploy|sdk|typescript|python|rust/.test(text)) intents.push('code');
  if (/protocol|api|http|webhook|mcp|json|binary|socket|signal/.test(text)) intents.push('protocol');
  if (/search|current|latest|research|internet|crawl|summarize/.test(text)) intents.push('research');
  if (/market|trade|orderbook|prediction|price|signal|polymarket|kalshi/.test(text)) intents.push('markets');
  if (/github|repository|repo/.test(text)) intents.push('github');
  if (/satellite|radio|mesh|relay|uplink|lora/.test(text)) intents.push('signals');
  return intents.length ? intents : ['general'];
}

function publicConnectorConfigs(env, connectorConfigs = {}) {
  const next = {};
  for (const key of Object.keys(connectorConfigs || {})) {
    const connector = normalizeConnectorName(key);
    const config = connectorConfigs[key] || {};
    next[connector] = {
      model: cleanText(config.model, 120),
      repo: cleanText(config.repo, 120),
      transport: cleanText(config.transport, 40),
      method: cleanText(config.method, 80),
      url: summariseUrl(config.url)
    };
  }
  return next;
}

function connectorConfigValue(env, connector, connectorConfigs = {}) {
  const config = connectorConfigs[connector] || connectorConfigs[normalizeConnectorName(connector)] || {};
  if (connector === 'anthropic') {
    return {
      apiKey: cleanText(config.apiKey || env.GHOST_ANTHROPIC_API_KEY, 300),
      model: cleanText(config.model || env.GHOST_ANTHROPIC_MODEL || DEFAULT_MODELS.anthropic, 120)
    };
  }
  if (connector === 'gemini') {
    return {
      apiKey: cleanText(config.apiKey || env.GHOST_GEMINI_API_KEY, 300),
      model: cleanText(config.model || env.GHOST_GEMINI_MODEL || DEFAULT_MODELS.gemini, 120)
    };
  }
  if (connector === 'grok') {
    return {
      apiKey: cleanText(config.apiKey || env.GHOST_GROK_API_KEY, 300),
      model: cleanText(config.model || env.GHOST_GROK_MODEL || DEFAULT_MODELS.grok, 120)
    };
  }
  if (connector === 'github') {
    return {
      token: cleanText(config.token || env.GHOST_GITHUB_TOKEN, 300),
      repo: cleanText(config.repo || env.GHOST_GITHUB_REPO, 120)
    };
  }
  if (connector === 'mcp') {
    return {
      url: sanitizeUrl(config.url || env.GHOST_MCP_BASE_URL, env),
      transport: cleanText(config.transport || env.GHOST_MCP_TRANSPORT || 'streamable-http', 40),
      method: cleanText(config.method || env.GHOST_MCP_METHOD || 'ghost.interop', 80),
      auth: cleanText(config.auth || env.GHOST_MCP_AUTH_TOKEN, 300)
    };
  }
  return {};
}

function connectorAvailable(env, connector, connectorConfigs = {}) {
  const config = connectorConfigValue(env, connector, connectorConfigs);
  if (connector === 'anthropic' || connector === 'gemini' || connector === 'grok') return !!config.apiKey;
  if (connector === 'github') return !!config.token;
  if (connector === 'mcp') return !!config.url;
  return false;
}

function configuredConnectorKeys(env, connectorConfigs = {}) {
  return Object.keys(GHOST_CONNECTOR_META).filter(connector => connectorAvailable(env, connector, connectorConfigs));
}

function chooseAutonomousConnectors(intents, mode, availableConnectors) {
  const available = uniqueStrings((availableConnectors || []).map(normalizeConnectorName), 10);
  const priority = [];
  if (intents.includes('code')) priority.push('github', 'mcp', 'anthropic', 'gemini', 'grok');
  if (intents.includes('protocol')) priority.push('mcp', 'github', 'anthropic', 'gemini', 'grok');
  if (intents.includes('research')) priority.push('gemini', 'grok', 'anthropic', 'github');
  if (intents.includes('markets')) priority.push('github', 'gemini', 'grok', 'anthropic');
  if (intents.includes('signals')) priority.push('mcp', 'github', 'gemini');
  available.forEach(connector => priority.push(connector));
  const ordered = Array.from(new Set(priority)).filter(connector => available.includes(connector));
  if (mode === 'simple') return ordered.slice(0, 1);
  if (mode === 'complex') return ordered.slice(0, 3);
  if (mode === 'mesh') return ordered;
  if (mode === 'autonomous') return ordered.slice(0, Math.min(ordered.length, 4));
  return ordered.slice(0, 2);
}

function buildMissionPacket(mission) {
  const envelope = {
    ghost: 'OST Ghost',
    id: mission.id,
    mode: mission.mode,
    protocol: mission.protocol,
    intents: mission.intents,
    selectedConnectors: mission.selectedConnectors,
    prompt: mission.prompt,
    createdAt: mission.createdAt
  };
  if (mission.protocol === 'natural') {
    return [
      `OST Ghost mission ${mission.id}`,
      `Mode: ${mission.mode}`,
      `Intents: ${mission.intents.join(', ')}`,
      `Connectors: ${mission.selectedConnectors.join(', ') || 'none'}`,
      `Task: ${mission.prompt}`
    ].join('\n');
  }
  if (mission.protocol === 'http') {
    return 'POST /ghost/missions HTTP/1.1\nContent-Type: application/json\nX-OST-Ghost-Id: ' + mission.id + '\n\n' + JSON.stringify(envelope, null, 2);
  }
  if (mission.protocol === 'mcp') {
    return JSON.stringify({ jsonrpc: '2.0', id: mission.id, method: 'ghost.interop', params: envelope }, null, 2);
  }
  if (mission.protocol === 'shell') {
    return [
      'curl -X POST "https://ost-api-pages.pages.dev/ghost/missions" \\',
      '  -H "Content-Type: application/json" \\',
      '  -d ' + JSON.stringify(JSON.stringify(envelope))
    ].join('\n');
  }
  if (mission.protocol === 'binary') {
    return Array.from(JSON.stringify(envelope)).map(char => char.charCodeAt(0).toString(2).padStart(8, '0')).join(' ');
  }
  return JSON.stringify(envelope, null, 2);
}

async function loadMeshFeed(env, limit = 8) {
  const feed = await kvGet(env, 'ghost:mesh:feed', []);
  return Array.isArray(feed) ? feed.slice(0, limit) : [];
}

async function loadConnectorKnowledge(env) {
  const knowledge = await kvGet(env, 'ghost:mesh:connectors', {});
  return knowledge && typeof knowledge === 'object' ? knowledge : {};
}

async function shareMeshMemory(env, entry) {
  const feed = await kvGet(env, 'ghost:mesh:feed', []);
  const next = Array.isArray(feed) ? feed : [];
  const record = {
    id: cleanText(entry.id || crypto.randomUUID(), 120),
    kind: cleanText(entry.kind || 'mission', 40),
    missionId: cleanText(entry.missionId || '', 120),
    connector: cleanText(entry.connector || '', 40),
    summary: clipText(entry.summary || '', 500),
    packet: clipText(entry.packet || '', 1500),
    status: cleanText(entry.status || 'shared', 40),
    createdAt: entry.createdAt || toIso()
  };
  const filtered = next.filter(item => item?.id !== record.id);
  filtered.unshift(record);
  await kvPut(env, 'ghost:mesh:feed', filtered.slice(0, MESH_LIMIT), MISSION_TTL_SECONDS);
  return record;
}

async function updateConnectorKnowledge(env, connector, attempt) {
  const knowledge = await loadConnectorKnowledge(env);
  const key = normalizeConnectorName(connector);
  const current = knowledge[key] || {
    label: connectorLabel(key),
    protocols: connectorProtocols(key),
    successes: 0,
    failures: 0,
    retries: 0,
    lastStatus: 'idle',
    lastLatencyMs: null,
    lastError: '',
    lastSeenAt: null,
    lastMissionId: ''
  };
  if (attempt.ok) current.successes += 1;
  else current.failures += 1;
  if ((attempt.attempt || 1) > 1) current.retries += 1;
  current.lastStatus = attempt.ok ? 'success' : 'error';
  current.lastLatencyMs = cleanNumber(attempt.latencyMs, null, 0, 600000);
  current.lastError = attempt.ok ? '' : clipText(attempt.error || '', 240);
  current.lastSeenAt = attempt.finishedAt || toIso();
  current.lastMissionId = cleanText(attempt.missionId || '', 120);
  knowledge[key] = current;
  await kvPut(env, 'ghost:mesh:connectors', knowledge, MISSION_TTL_SECONDS);
  return current;
}

async function saveMission(env, mission) {
  const stored = {
    id: mission.id,
    prompt: clipText(mission.prompt, 2000),
    mode: cleanText(mission.mode, 40),
    protocol: cleanText(mission.protocol, 40),
    intents: uniqueStrings(mission.intents, 10),
    requestedConnectors: uniqueStrings(mission.requestedConnectors, 10),
    selectedConnectors: uniqueStrings(mission.selectedConnectors, 10),
    status: cleanText(mission.status, 40),
    createdAt: mission.createdAt || toIso(),
    updatedAt: mission.updatedAt || toIso(),
    retryBudget: cleanNumber(mission.retryBudget, 1, 0, 4),
    retriesUsed: cleanNumber(mission.retriesUsed, 0, 0, 50),
    packet: clipText(mission.packet || '', 4000),
    packetPreview: clipText(mission.packet || '', 500),
    summary: clipText(mission.summary || '', 2400),
    crawlTargets: uniqueStrings(mission.crawlTargets, 6),
    crawlSnapshots: Array.isArray(mission.crawlSnapshots) ? mission.crawlSnapshots.slice(0, 6) : [],
    attempts: Array.isArray(mission.attempts) ? mission.attempts.slice(-24) : [],
    connectorConfigs: publicConnectorConfigs(env, mission.connectorConfigs || {}),
    navigation: mission.navigation || {}
  };

  await kvPut(env, `ghost:mission:${stored.id}`, stored, MISSION_TTL_SECONDS);
  const index = await kvGet(env, 'ghost:missions:index', []);
  const nextIndex = (Array.isArray(index) ? index : []).filter(item => item?.id !== stored.id);
  nextIndex.unshift({
    id: stored.id,
    prompt: clipText(stored.prompt, 140),
    status: stored.status,
    mode: stored.mode,
    selectedConnectors: stored.selectedConnectors,
    createdAt: stored.createdAt,
    updatedAt: stored.updatedAt
  });
  await kvPut(env, 'ghost:missions:index', nextIndex.slice(0, HISTORY_LIMIT), MISSION_TTL_SECONDS);
  return stored;
}

async function loadMission(env, missionIdValue) {
  const mission = await kvGet(env, `ghost:mission:${cleanText(missionIdValue, 120)}`, null);
  return mission && typeof mission === 'object' ? mission : null;
}

async function loadMissionIndex(env, limit = 20) {
  const index = await kvGet(env, 'ghost:missions:index', []);
  return Array.isArray(index) ? index.slice(0, limit) : [];
}

function repoFromPrompt(prompt) {
  const match = String(prompt || '').match(/\b([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\b/);
  return match ? cleanText(match[1], 120) : '';
}

function collectCrawlTargets(env, prompt, body, connectorConfigs = {}) {
  const targets = [];
  (Array.isArray(body.crawlTargets) ? body.crawlTargets : []).forEach(value => targets.push(value));
  extractPromptUrls(prompt).forEach(value => targets.push(value));
  const repo = cleanText(connectorConfigs.github?.repo || repoFromPrompt(prompt), 120);
  if (repo) targets.push(`https://api.github.com/repos/${repo}`);
  return uniqueStrings(targets.map(value => sanitizeUrl(value, env)).filter(Boolean), 4);
}

async function crawlTarget(env, target, connectorConfigs = {}) {
  const url = sanitizeUrl(target, env);
  if (!url) return { url: cleanText(target, 240), ok: false, status: 0, snippet: 'URL blocked by Ghost crawler policy.' };
  const headers = { accept: 'application/json, text/plain;q=0.9, text/html;q=0.8', 'user-agent': 'OST-Ghost/1.0' };
  if (new URL(url).hostname === 'api.github.com') {
    const githubConfig = connectorConfigValue(env, 'github', connectorConfigs);
    if (githubConfig.token) headers.authorization = `Bearer ${githubConfig.token}`;
  }
  try {
    const response = await fetch(url, { headers, cf: { cacheTtl: 20, cacheEverything: false } });
    const contentType = response.headers.get('content-type') || 'text/plain';
    const body = await response.text();
    const snippet = contentType.includes('application/json')
      ? clipText(body, 1200)
      : clipText(body.replace(/<[^>]+>/g, ' '), 1200);
    return {
      url,
      ok: response.ok,
      status: response.status,
      contentType: cleanText(contentType, 120),
      snippet
    };
  } catch (error) {
    return {
      url,
      ok: false,
      status: 0,
      contentType: 'text/plain',
      snippet: cleanText(error?.message || error, 240)
    };
  }
}

async function crawlTargets(env, targets, connectorConfigs = {}) {
  const crawled = [];
  for (const target of targets || []) {
    crawled.push(await crawlTarget(env, target, connectorConfigs));
  }
  return crawled;
}

function buildRelayPrompt(mission, context) {
  const crawlSummary = (context.crawlSnapshots || []).map(snapshot => {
    const label = `${snapshot.url} (${snapshot.status || 0})`;
    return `${label}\n${clipText(snapshot.snippet || '', 500)}`;
  }).join('\n\n');
  const memorySummary = (context.meshFeed || []).map(entry => {
    return `${entry.kind || 'memory'} ${entry.missionId || entry.id}: ${clipText(entry.summary || '', 180)}`;
  }).join('\n');
  return [
    'You are OST Ghost, a universal interoperability relay.',
    `Mission ID: ${mission.id}`,
    `Mode: ${mission.mode}`,
    `Protocol: ${mission.protocol}`,
    `Intents: ${mission.intents.join(', ')}`,
    `Selected connectors: ${mission.selectedConnectors.join(', ') || 'none'}`,
    '',
    'User mission:',
    mission.prompt,
    crawlSummary ? `\nCrawled context:\n${crawlSummary}` : '',
    memorySummary ? `\nRecent mesh memory:\n${memorySummary}` : '',
    '\nRespond with concise, actionable interoperability guidance and concrete next hops.'
  ].filter(Boolean).join('\n');
}

async function fetchJsonWithTimeout(url, options = {}, timeoutMs = CONNECTOR_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort('ghost_timeout'), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const body = await response.json().catch(() => ({}));
    return { response, body };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchTextWithTimeout(url, options = {}, timeoutMs = CONNECTOR_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort('ghost_timeout'), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const body = await response.text();
    return { response, body };
  } finally {
    clearTimeout(timeout);
  }
}

async function testAnthropicRelay(env, connectorConfigs = {}) {
  const config = connectorConfigValue(env, 'anthropic', connectorConfigs);
  if (!config.apiKey) throw new Error('Anthropic API key is not configured.');
  const { response, body } = await fetchJsonWithTimeout('https://api.anthropic.com/v1/models', {
    headers: {
      'x-api-key': config.apiKey,
      'anthropic-version': '2023-06-01',
      accept: 'application/json'
    }
  });
  if (!response.ok) throw new Error(body?.error?.message || `Anthropic API returned ${response.status}`);
  return {
    connector: 'anthropic',
    ok: true,
    configured: true,
    detail: `Anthropic relay reachable. ${Array.isArray(body?.data) ? body.data.length : 0} models reported.`
  };
}

async function relayAnthropic(env, mission, context, connectorConfigs = {}) {
  const config = connectorConfigValue(env, 'anthropic', connectorConfigs);
  if (!config.apiKey) throw new Error('Anthropic API key is not configured.');
  const { response, body } = await fetchJsonWithTimeout('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': config.apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: 350,
      system: 'You are OST Ghost, a universal interoperability relay. Stay concrete, structured, and cross-system aware.',
      messages: [{ role: 'user', content: buildRelayPrompt(mission, context) }]
    })
  });
  if (!response.ok) throw new Error(body?.error?.message || `Anthropic API returned ${response.status}`);
  const content = Array.isArray(body?.content)
    ? body.content.map(item => item?.text || '').join('\n').trim()
    : '';
  return {
    connector: 'anthropic',
    model: config.model,
    responseText: clipText(content || JSON.stringify(body), 1800)
  };
}

async function testGeminiRelay(env, connectorConfigs = {}) {
  const config = connectorConfigValue(env, 'gemini', connectorConfigs);
  if (!config.apiKey) throw new Error('Gemini API key is not configured.');
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(config.apiKey)}`;
  const { response, body } = await fetchJsonWithTimeout(endpoint, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(body?.error?.message || `Gemini API returned ${response.status}`);
  return {
    connector: 'gemini',
    ok: true,
    configured: true,
    detail: `Gemini relay reachable. ${Array.isArray(body?.models) ? body.models.length : 0} models reported.`
  };
}

async function relayGemini(env, mission, context, connectorConfigs = {}) {
  const config = connectorConfigValue(env, 'gemini', connectorConfigs);
  if (!config.apiKey) throw new Error('Gemini API key is not configured.');
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}:generateContent?key=${encodeURIComponent(config.apiKey)}`;
  const { response, body } = await fetchJsonWithTimeout(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: 'You are OST Ghost, a universal interoperability relay. Stay concrete, structured, and cross-system aware.' }] },
      contents: [{ role: 'user', parts: [{ text: buildRelayPrompt(mission, context) }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 350 }
    })
  });
  if (!response.ok) throw new Error(body?.error?.message || `Gemini API returned ${response.status}`);
  const content = Array.isArray(body?.candidates)
    ? body.candidates.map(candidate => (candidate?.content?.parts || []).map(part => part?.text || '').join('')).join('\n').trim()
    : '';
  return {
    connector: 'gemini',
    model: config.model,
    responseText: clipText(content || JSON.stringify(body), 1800)
  };
}

async function testGrokRelay(env, connectorConfigs = {}) {
  const config = connectorConfigValue(env, 'grok', connectorConfigs);
  if (!config.apiKey) throw new Error('Grok API key is not configured.');
  const { response, body } = await fetchJsonWithTimeout('https://api.x.ai/v1/models', {
    headers: {
      authorization: `Bearer ${config.apiKey}`,
      accept: 'application/json'
    }
  });
  if (!response.ok) throw new Error(body?.error?.message || `Grok API returned ${response.status}`);
  return {
    connector: 'grok',
    ok: true,
    configured: true,
    detail: `Grok relay reachable. ${Array.isArray(body?.data) ? body.data.length : 0} models reported.`
  };
}

async function relayGrok(env, mission, context, connectorConfigs = {}) {
  const config = connectorConfigValue(env, 'grok', connectorConfigs);
  if (!config.apiKey) throw new Error('Grok API key is not configured.');
  const { response, body } = await fetchJsonWithTimeout('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${config.apiKey}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: config.model,
      temperature: 0.2,
      messages: [
        { role: 'system', content: 'You are OST Ghost, a universal interoperability relay. Stay concrete, structured, and cross-system aware.' },
        { role: 'user', content: buildRelayPrompt(mission, context) }
      ]
    })
  });
  if (!response.ok) throw new Error(body?.error?.message || `Grok API returned ${response.status}`);
  return {
    connector: 'grok',
    model: config.model,
    responseText: clipText(body?.choices?.[0]?.message?.content || JSON.stringify(body), 1800)
  };
}

async function testGitHubRelay(env, connectorConfigs = {}) {
  const config = connectorConfigValue(env, 'github', connectorConfigs);
  if (!config.token) throw new Error('GitHub token is not configured.');
  const { response, body } = await fetchJsonWithTimeout('https://api.github.com/user', {
    headers: {
      authorization: `Bearer ${config.token}`,
      accept: 'application/vnd.github+json',
      'user-agent': 'OST-Ghost/1.0'
    }
  });
  if (!response.ok) throw new Error(body?.message || `GitHub API returned ${response.status}`);
  return {
    connector: 'github',
    ok: true,
    configured: true,
    detail: `GitHub relay reachable as @${cleanText(body?.login || 'unknown', 80)}.`
  };
}

async function relayGitHub(env, mission, context, connectorConfigs = {}) {
  const config = connectorConfigValue(env, 'github', connectorConfigs);
  if (!config.token) throw new Error('GitHub token is not configured.');
  const repo = config.repo || repoFromPrompt(mission.prompt);
  const headers = {
    authorization: `Bearer ${config.token}`,
    accept: 'application/vnd.github+json',
    'user-agent': 'OST-Ghost/1.0'
  };
  if (repo) {
    const { response, body } = await fetchJsonWithTimeout(`https://api.github.com/repos/${encodeURIComponent(repo).replace('%2F', '/')}`, { headers });
    if (!response.ok) throw new Error(body?.message || `GitHub repo API returned ${response.status}`);
    let readmeSnippet = '';
    try {
      const readme = await fetchJsonWithTimeout(`https://api.github.com/repos/${encodeURIComponent(repo).replace('%2F', '/')}/readme`, { headers });
      const encoded = readme.body?.content || '';
      const decoded = encoded ? atob(encoded.replace(/\n/g, '')) : '';
      readmeSnippet = clipText(decoded, 800);
    } catch (_) {}
    const summary = [
      `Repository: ${body.full_name}`,
      `Description: ${clipText(body.description || 'No description', 180)}`,
      `Stars: ${body.stargazers_count || 0}`,
      `Open issues: ${body.open_issues_count || 0}`,
      readmeSnippet ? `README:\n${readmeSnippet}` : ''
    ].filter(Boolean).join('\n');
    return {
      connector: 'github',
      repo: body.full_name,
      responseText: clipText(summary, 1800)
    };
  }

  const query = encodeURIComponent(mission.prompt.split(/\s+/).slice(0, 6).join(' '));
  const { response, body } = await fetchJsonWithTimeout(`https://api.github.com/search/repositories?q=${query}&per_page=3`, { headers });
  if (!response.ok) throw new Error(body?.message || `GitHub search API returned ${response.status}`);
  const items = Array.isArray(body?.items) ? body.items.slice(0, 3) : [];
  const summary = items.length
    ? items.map(item => `${item.full_name}: ${clipText(item.description || 'No description', 160)}`).join('\n')
    : 'GitHub relay reached the API but found no matching repositories.';
  return {
    connector: 'github',
    repo: '',
    responseText: clipText(summary, 1800)
  };
}

async function testMcpRelay(env, connectorConfigs = {}) {
  const config = connectorConfigValue(env, 'mcp', connectorConfigs);
  if (!config.url) throw new Error('MCP relay URL is not configured or allowed.');
  try {
    const postResult = await fetchTextWithTimeout(config.url, {
      method: 'POST',
      headers: {
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
        ...(config.auth ? { authorization: config.auth } : {})
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 'ghost-test', method: 'tools/list', params: {} })
    });
    if (postResult.response.status < 500) {
      return {
        connector: 'mcp',
        ok: true,
        configured: true,
        detail: `MCP relay reachable at ${summariseUrl(config.url)} (${config.transport}).`
      };
    }
  } catch (_) {}
  const getResult = await fetchTextWithTimeout(config.url, {
    headers: {
      accept: 'application/json, text/event-stream',
      ...(config.auth ? { authorization: config.auth } : {})
    }
  });
  if (getResult.response.status >= 500) throw new Error(`MCP server returned ${getResult.response.status}`);
  return {
    connector: 'mcp',
    ok: true,
    configured: true,
    detail: `MCP relay reachable at ${summariseUrl(config.url)} (${config.transport}).`
  };
}

async function relayMcp(env, mission, context, connectorConfigs = {}) {
  const config = connectorConfigValue(env, 'mcp', connectorConfigs);
  if (!config.url) throw new Error('MCP relay URL is not configured or allowed.');
  const packet = {
    jsonrpc: '2.0',
    id: mission.id,
    method: config.method || 'ghost.interop',
    params: {
      mission: {
        id: mission.id,
        mode: mission.mode,
        protocol: mission.protocol,
        intents: mission.intents,
        prompt: mission.prompt
      },
      context: {
        crawlSnapshots: context.crawlSnapshots || [],
        meshFeed: (context.meshFeed || []).slice(0, 4)
      }
    }
  };

  try {
    const postResult = await fetchTextWithTimeout(config.url, {
      method: 'POST',
      headers: {
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
        ...(config.auth ? { authorization: config.auth } : {})
      },
      body: JSON.stringify(packet)
    });
    if (postResult.response.ok || postResult.response.status < 500) {
      return {
        connector: 'mcp',
        transport: config.transport,
        responseText: clipText(postResult.body || 'MCP relay accepted the Ghost packet.', 1800)
      };
    }
  } catch (_) {}

  if (config.transport === 'sse') {
    const getResult = await fetchTextWithTimeout(config.url, {
      headers: {
        accept: 'text/event-stream',
        ...(config.auth ? { authorization: config.auth } : {})
      }
    });
    if (getResult.response.status >= 500) throw new Error(`MCP SSE relay returned ${getResult.response.status}`);
    return {
      connector: 'mcp',
      transport: 'sse',
      responseText: clipText(getResult.body || 'MCP SSE relay reachable. Ghost packet prepared for stream consumer.', 1800)
    };
  }

  throw new Error('MCP relay did not accept the Ghost packet.');
}

async function testRelay(env, connector, connectorConfigs = {}) {
  const key = normalizeConnectorName(connector);
  if (key === 'anthropic') return testAnthropicRelay(env, connectorConfigs);
  if (key === 'gemini') return testGeminiRelay(env, connectorConfigs);
  if (key === 'grok') return testGrokRelay(env, connectorConfigs);
  if (key === 'github') return testGitHubRelay(env, connectorConfigs);
  if (key === 'mcp') return testMcpRelay(env, connectorConfigs);
  throw new Error(`Unsupported Ghost relay: ${connector}`);
}

async function dispatchRelay(env, connector, mission, context, connectorConfigs = {}) {
  const key = normalizeConnectorName(connector);
  if (key === 'anthropic') return relayAnthropic(env, mission, context, connectorConfigs);
  if (key === 'gemini') return relayGemini(env, mission, context, connectorConfigs);
  if (key === 'grok') return relayGrok(env, mission, context, connectorConfigs);
  if (key === 'github') return relayGitHub(env, mission, context, connectorConfigs);
  if (key === 'mcp') return relayMcp(env, mission, context, connectorConfigs);
  throw new Error(`Unsupported Ghost relay: ${connector}`);
}

function missionSummary(mission) {
  const successful = (mission.attempts || []).filter(attempt => attempt.ok);
  const failed = (mission.attempts || []).filter(attempt => !attempt.ok);
  const lines = [];
  lines.push(`Ghost mission ${mission.id} -> ${mission.status}`);
  lines.push(`Mode: ${mission.mode}. Connectors tried: ${mission.selectedConnectors.join(', ') || 'none'}.`);
  if (Array.isArray(mission.crawlSnapshots) && mission.crawlSnapshots.length) {
    lines.push(`Crawled ${mission.crawlSnapshots.length} target(s) before dispatch.`);
  }
  if (successful.length) {
    lines.push('Successful relays:');
    successful.slice(0, 5).forEach(attempt => {
      lines.push(`- ${connectorLabel(attempt.connector)}: ${clipText(attempt.responseText || attempt.summary || 'ok', 220)}`);
    });
  }
  if (failed.length) {
    lines.push('Failed relays:');
    failed.slice(0, 5).forEach(attempt => {
      lines.push(`- ${connectorLabel(attempt.connector)}: ${clipText(attempt.error || 'unknown error', 220)}`);
    });
  }
  return lines.join('\n');
}

async function executeMission(env, mission, connectorConfigs = {}, options = {}) {
  const retryOnlyFailed = !!options.retryOnlyFailed;
  const meshFeed = await loadMeshFeed(env, 6);
  const crawlTargetsList = retryOnlyFailed && Array.isArray(mission.crawlTargets)
    ? mission.crawlTargets
    : collectCrawlTargets(env, mission.prompt, mission, connectorConfigs);
  const crawlSnapshots = retryOnlyFailed && Array.isArray(mission.crawlSnapshots) && mission.crawlSnapshots.length
    ? mission.crawlSnapshots
    : await crawlTargets(env, crawlTargetsList, connectorConfigs);

  mission.crawlTargets = crawlTargetsList;
  mission.crawlSnapshots = crawlSnapshots;
  mission.packet = mission.packet || buildMissionPacket(mission);
  mission.status = 'running';
  mission.updatedAt = toIso();

  const context = { crawlSnapshots, meshFeed };
  const connectorsToRun = retryOnlyFailed
    ? mission.selectedConnectors.filter(connector => !(mission.attempts || []).some(attempt => attempt.connector === connector && attempt.ok))
    : mission.selectedConnectors.slice();
  const maxAttemptsPerConnector = mission.mode === 'autonomous'
    ? Math.max(1, cleanNumber(mission.retryBudget, 1, 0, 4) + 1)
    : 1;

  for (const connector of connectorsToRun) {
    let attemptCount = 0;
    while (attemptCount < maxAttemptsPerConnector) {
      attemptCount += 1;
      const started = Date.now();
      try {
        const relay = await dispatchRelay(env, connector, mission, context, connectorConfigs);
        const attempt = {
          connector,
          ok: true,
          attempt: attemptCount,
          missionId: mission.id,
          startedAt: toIso(started),
          finishedAt: toIso(),
          latencyMs: Date.now() - started,
          responseText: clipText(relay.responseText || relay.summary || JSON.stringify(relay), 1800),
          model: cleanText(relay.model || '', 120),
          transport: cleanText(relay.transport || '', 80),
          repo: cleanText(relay.repo || '', 120)
        };
        mission.attempts.push(attempt);
        mission.retriesUsed = (mission.retriesUsed || 0) + (attemptCount > 1 ? 1 : 0);
        await updateConnectorKnowledge(env, connector, attempt);
        break;
      } catch (error) {
        const attempt = {
          connector,
          ok: false,
          attempt: attemptCount,
          missionId: mission.id,
          startedAt: toIso(started),
          finishedAt: toIso(),
          latencyMs: Date.now() - started,
          error: clipText(error?.message || error, 400)
        };
        mission.attempts.push(attempt);
        mission.retriesUsed = (mission.retriesUsed || 0) + (attemptCount > 1 ? 1 : 0);
        await updateConnectorKnowledge(env, connector, attempt);
        if (attemptCount >= maxAttemptsPerConnector) break;
      }
    }
  }

  const successes = mission.attempts.filter(attempt => attempt.ok);
  if (!mission.selectedConnectors.length && crawlSnapshots.length) mission.status = 'completed';
  else if (!mission.selectedConnectors.length) mission.status = 'failed';
  else if (successes.length === mission.selectedConnectors.length) mission.status = 'completed';
  else if (successes.length > 0) mission.status = 'partial';
  else mission.status = 'failed';

  mission.summary = missionSummary(mission);
  mission.updatedAt = toIso();
  const storedMission = await saveMission(env, mission);
  await shareMeshMemory(env, {
    id: `${storedMission.id}:mission`,
    kind: 'mission',
    missionId: storedMission.id,
    summary: storedMission.summary,
    packet: storedMission.packetPreview,
    status: storedMission.status,
    createdAt: storedMission.updatedAt
  });
  return storedMission;
}

function createMissionRecord(env, body) {
  const prompt = clipText(body.prompt || body.question || '', 2000);
  if (!prompt) throw new Error('Ghost mission prompt is required.');
  const mode = cleanText(body.mode || 'simple', 40) || 'simple';
  const protocol = cleanText(body.protocol || 'json', 40) || 'json';
  const intents = detectGhostIntents(prompt);
  const connectorConfigs = body.connectorConfigs && typeof body.connectorConfigs === 'object' ? body.connectorConfigs : {};
  const available = configuredConnectorKeys(env, connectorConfigs);
  const requested = uniqueStrings(Array.isArray(body.connectors) ? body.connectors : [], 10).map(normalizeConnectorName);
  const selectedConnectors = requested.length
    ? requested.filter(connector => available.includes(connector))
    : chooseAutonomousConnectors(intents, mode, available);

  return {
    id: cleanText(body.id || missionId(), 120),
    prompt,
    mode,
    protocol,
    intents,
    requestedConnectors: requested,
    selectedConnectors,
    status: 'queued',
    createdAt: toIso(),
    updatedAt: toIso(),
    retryBudget: cleanNumber(body.retryBudget, mode === 'autonomous' ? 1 : 0, 0, 4),
    retriesUsed: 0,
    packet: '',
    summary: '',
    crawlTargets: [],
    crawlSnapshots: [],
    attempts: [],
    connectorConfigs,
    navigation: {
      autonomous: mode === 'autonomous',
      availableConnectors: available,
      requestedTargets: uniqueStrings((Array.isArray(body.crawlTargets) ? body.crawlTargets : []).map(value => sanitizeUrl(value, env)).filter(Boolean), 4)
    }
  };
}

async function buildMeshSnapshot(env, limit = 12) {
  return {
    feed: await loadMeshFeed(env, limit),
    connectors: await loadConnectorKnowledge(env),
    history: await loadMissionIndex(env, limit)
  };
}

function missionCanRetry(mission) {
  if (!mission) return false;
  if (!Array.isArray(mission.selectedConnectors) || !mission.selectedConnectors.length) return false;
  const successful = mission.selectedConnectors.filter(connector => (mission.attempts || []).some(attempt => attempt.connector === connector && attempt.ok));
  return successful.length < mission.selectedConnectors.length;
}

export async function handleGhostRequest(request, env, context = {}) {
  const url = new URL(request.url);
  const path = (context.path || url.pathname || '/').replace(/\/$/, '') || '/';
  const method = context.method || request.method;
  if (!path.startsWith('/ghost')) return null;

  if (path === '/ghost/config' && method === 'GET') {
    const connectors = Object.keys(GHOST_CONNECTOR_META).reduce((acc, connector) => {
      acc[connector] = {
        label: connectorLabel(connector),
        protocols: connectorProtocols(connector),
        configured: connectorAvailable(env, connector, {})
      };
      return acc;
    }, {});
    return json({
      ok: true,
      relayBase: `${url.origin}/ghost`,
      connectors,
      memory: { kv: !!env.OST_KV },
      endpoints: [
        'GET  /ghost/config',
        'POST /ghost/relay/test',
        'GET  /ghost/missions',
        'POST /ghost/missions',
        'GET  /ghost/missions/:id',
        'POST /ghost/missions/:id/retry',
        'GET  /ghost/mesh',
        'POST /ghost/mesh/share'
      ]
    });
  }

  if (path === '/ghost/relay/test' && method === 'POST') {
    const body = await readJson(request);
    try {
      const connector = normalizeConnectorName(body.connector);
      const result = await testRelay(env, connector, body.connectorConfigs || { [connector]: body.config || {} });
      return json({ ok: true, connector, ...result });
    } catch (error) {
      return json({ ok: false, error: cleanText(error?.message || error, 240) }, 400);
    }
  }

  if (path === '/ghost/missions' && method === 'GET') {
    const limit = cleanNumber(url.searchParams.get('limit'), 20, 1, 50);
    return json({ ok: true, missions: await loadMissionIndex(env, limit) });
  }

  if (path === '/ghost/missions' && method === 'POST') {
    const body = await readJson(request);
    try {
      const mission = createMissionRecord(env, body);
      mission.packet = buildMissionPacket(mission);
      await saveMission(env, mission);
      const executedMission = body.autoDispatch === false
        ? await saveMission(env, { ...mission, status: 'queued', updatedAt: toIso() })
        : await executeMission(env, mission, mission.connectorConfigs);
      return json({ ok: true, mission: executedMission, mesh: await buildMeshSnapshot(env, 10) });
    } catch (error) {
      return json({ ok: false, error: cleanText(error?.message || error, 240) }, 400);
    }
  }

  const retryMatch = path.match(/^\/ghost\/missions\/([^/]+)\/retry$/);
  if (retryMatch && method === 'POST') {
    const mission = await loadMission(env, retryMatch[1]);
    if (!mission) return json({ ok: false, error: 'mission_not_found' }, 404);
    if (!missionCanRetry(mission)) return json({ ok: false, error: 'mission_not_retryable' }, 409);
    const body = await readJson(request);
    mission.connectorConfigs = body.connectorConfigs && typeof body.connectorConfigs === 'object'
      ? body.connectorConfigs
      : mission.connectorConfigs || {};
    mission.updatedAt = toIso();
    const retried = await executeMission(env, mission, mission.connectorConfigs, { retryOnlyFailed: true });
    return json({ ok: true, mission: retried, mesh: await buildMeshSnapshot(env, 10) });
  }

  const missionMatch = path.match(/^\/ghost\/missions\/([^/]+)$/);
  if (missionMatch && method === 'GET') {
    const mission = await loadMission(env, missionMatch[1]);
    if (!mission) return json({ ok: false, error: 'mission_not_found' }, 404);
    if (url.searchParams.get('retry') === '1' && missionCanRetry(mission)) {
      const retried = await executeMission(env, mission, mission.connectorConfigs || {}, { retryOnlyFailed: true });
      return json({ ok: true, mission: retried, mesh: await buildMeshSnapshot(env, 10) });
    }
    return json({ ok: true, mission });
  }

  if (path === '/ghost/mesh' && method === 'GET') {
    const limit = cleanNumber(url.searchParams.get('limit'), 12, 1, 50);
    return json({ ok: true, ...(await buildMeshSnapshot(env, limit)) });
  }

  if (path === '/ghost/mesh/share' && method === 'POST') {
    const body = await readJson(request);
    const entry = await shareMeshMemory(env, {
      id: cleanText(body.id || crypto.randomUUID(), 120),
      kind: cleanText(body.kind || 'note', 40),
      missionId: cleanText(body.missionId || '', 120),
      connector: cleanText(body.connector || '', 40),
      summary: clipText(body.summary || body.note || '', 500),
      packet: clipText(body.packet || '', 1500),
      status: cleanText(body.status || 'shared', 40),
      createdAt: toIso()
    });
    return json({ ok: true, entry, mesh: await buildMeshSnapshot(env, 10) });
  }

  return json({ ok: false, error: 'ghost_route_not_found' }, 404);
}
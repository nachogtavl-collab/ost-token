/* workers/ost-api/src/studio/hub.js
  OST Studio backend — the StudioHub Durable Object (one instance, idFromName('studio-v1')).
  Contract: project-docs/ost-studio.md §4. Routes live under /studio/v1/*:
    • projects: files + a per-project change log, so edits made by coding agents through
      this API show up live in an open Studio tab (and the tab's edits reach the agent);
    • agent tokens ('ostk_…', only sha256(token) is stored; scopes read/write/deploy);
    • static app deploys + serving (/serve/:slug/… is fronted by the ost-apps worker);
    • the AI chat proxy (Groq → Groq small → Workers AI, OpenAI tool-call shape).
  Auth = the OST Mesh request signature (signer key looked up in the MeshHub directory)
  or an agent token. Honest scope: nothing here ever executes user code.

  Storage (DO SQLite, KV API; every value stays far below the 2 MB cap):
    proj:<pid>                     project meta {id, owner, name, template, createdAt, updatedAt, version, files, bytes}
    oproj:<owner>:<pid>            owner → project index
    fm:<pid>:<path>                file meta {path, hash, size, binary, mtime, by, fid, n, len}
    fc:<fid>:<iii>                 file content, UTF-8 bytes in 512 KB chunks (fid changes on every write)
    chg:<pid>:<v 12 digits>        change log {v, path, deleted?, hash, by, ts} — last 600 per project
    tokh:<sha256(token)>           token {id, owner, label, scopes, ts, lastUsed}
    tokid:<id> / otok:<owner>:<id> token lookups (value = token hash)
    app:<slug>                     app meta (published apps only)
    slugown:<slug>                 slug ownership (first deployer owns it; survives unpublish)
    oapp:<owner>:<slug>            owner → published app index
    gal:<rev ts>:<slug>            gallery index, newest first
    df:<slug>:<ver>:<path>         deployed file meta {path, size, mime, n, h}
    dc:<slug>:<ver>:<path>:<iii>   deployed file bytes, 512 KB chunks
    nonce:<addr>:<nonce>           mesh-signature replay guard for state-changing requests
    airl:<owner> / aiday:<date>    AI rate-limit counters
*/

import { AGENTS_MD } from './agents-md.js';

const HUB_NAME = 'studio-v1';
const APPS_BASE = 'https://ost-apps.nachogtavl.workers.dev';
const MB = 1024 * 1024;
const CHUNK = 512 * 1024;

export const LIMITS = {
  projectsPerOwner: 50,
  filesPerProject: 400,
  projectBytes: 25 * MB,
  fileBytes: 1.5 * MB,
  appsPerOwner: 20,
  deployFiles: 300,
  deployBytes: 25 * MB,
  deployFileBytes: 5 * MB,
  tokensPerOwner: 20,
  changeLog: 600,
  inlineChange: 200 * 1024,
  inlineChangesTotal: 4 * MB,
  keepVersions: 3,             // current + the previous 2
  bodyBytes: 40 * MB,
  aiPerWindow: 40,
  aiWindowMs: 10 * 60 * 1000,
  aiPerDay: 400,
  aiMessages: 60,
  aiMsgChars: 24000,
  aiTotalChars: 120000,
  aiTools: 16,
  // Per-owner request budgets (in memory; they protect the one DO's row-write quota).
  // Studio itself polls /changes every 4 s and pushes at most every 1.5 s per open tab.
  readsPerWindow: 4000,
  writesPerWindow: 1500,
  reqWindowMs: 10 * 60 * 1000,
  deploysPerHour: 60
};

export const RESERVED_SLUGS = new Set(['api', 'www', 'admin', 'ost', 'studio', 'app', 'apps', 'assets']);
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;
const PID_RE = /^p[0-9a-f]{16}$/;
const TOKEN_RE = /^ostk_[0-9a-f]{48}$/;
const TOKEN_ID_RE = /^tok_[0-9a-f]{12}$/;
const SCOPES = ['read', 'write', 'deploy'];

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODELS = ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'];
const WORKERS_AI_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const SERVER_SYSTEM = [
  'You are the OST Studio coding agent. OST Studio is a VS Code-style IDE inside the OST web app (Solana devnet — test tokens, never real money).',
  'You help the user build, fix and explain code in their current project, using the tools you are given to read and change files; keep edits small, complete and working, and briefly say what you changed.',
  'Apps built in OST Studio are static web apps (HTML, CSS, JavaScript, bundled React/TypeScript, assets) served from ost-apps.nachogtavl.workers.dev. There is no server-side code execution: code runs only in browser sandboxes, so never promise a backend, database or server process.',
  'Never ask for, request, store or output private keys, secret keys, seed phrases, recovery phrases, API secrets or wallet secrets. If a user offers one, tell them not to share it. Do not put secrets in project files: deployed apps are public.',
  'Be honest: do not claim to have run, tested or deployed something unless a tool result says so.'
].join(' ');

/* ======================================================================
 * HTTP helpers (house style: see mesh/hub.js)
 * ==================================================================== */
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-mesh-addr, x-mesh-ts, x-mesh-nonce, x-mesh-sig, If-None-Match',
  'Access-Control-Expose-Headers': 'ETag, Content-Length',
  'Access-Control-Max-Age': '86400'
};
function cors(extra = {}) { return { ...CORS_HEADERS, ...extra }; }
function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), { status, headers: cors({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra }) });
}
function fail(error, status = 400, extra = {}) { return json({ ok: false, error, ...extra }, status); }

const enc = new TextEncoder();
const hex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
const rhex = (n) => hex(crypto.getRandomValues(new Uint8Array(n)));
export async function sha256Hex(v) { return hex(await crypto.subtle.digest('SHA-256', typeof v === 'string' ? enc.encode(v) : v)); }
function b64ToBytes(b64) { const bin = atob(String(b64 || '')); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; }
function utf8Decode(bytes) { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
const pad12 = (n) => String(n).padStart(12, '0');
const pad3 = (n) => String(n).padStart(3, '0');
const rev16 = (ts) => String(1e15 - ts).padStart(16, '0');
function clip(s, n) { return String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n); }
function validAddr(v) { return typeof v === 'string' && v.length <= 80 && /^ost-mesh:[0-9a-f]{2,}(?:-[0-9a-f]{1,4})*$/i.test(v); }

/* ======================================================================
 * pure helpers (exported for tests)
 * ==================================================================== */
const MIME = { html: 'text/html', htm: 'text/html', css: 'text/css', js: 'text/javascript', mjs: 'text/javascript', cjs: 'text/javascript', jsx: 'text/javascript', ts: 'text/plain', tsx: 'text/plain', json: 'application/json', map: 'application/json', webmanifest: 'application/manifest+json', md: 'text/markdown', txt: 'text/plain', py: 'text/plain', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', ico: 'image/x-icon', bmp: 'image/bmp', woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4', mp4: 'video/mp4', webm: 'video/webm', pdf: 'application/pdf', wasm: 'application/wasm', xml: 'application/xml', csv: 'text/csv', yml: 'text/yaml', yaml: 'text/yaml', toml: 'text/plain', glb: 'model/gltf-binary', gltf: 'model/gltf+json', zip: 'application/zip' };
const TEXT_EXT = new Set(['html', 'htm', 'css', 'scss', 'less', 'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'mts', 'json', 'map', 'md', 'markdown', 'txt', 'py', 'svg', 'xml', 'yml', 'yaml', 'toml', 'ini', 'sh', 'bash', 'csv', 'sql', 'rs', 'go', 'java', 'c', 'h', 'cpp', 'rb', 'php', 'sol', 'graphql', 'vue', 'svelte', 'env', 'gitignore', 'lock', 'cfg', 'conf', 'webmanifest']);
const baseOf = (p) => { const s = String(p); const i = s.lastIndexOf('/'); return i < 0 ? s : s.slice(i + 1); };
export const extOf = (p) => { const b = baseOf(p); const i = b.lastIndexOf('.'); return i > 0 ? b.slice(i + 1).toLowerCase() : ''; };
export function isTextPath(p) { const e = extOf(p); return !e || TEXT_EXT.has(e) || /^(readme|license|makefile|dockerfile|procfile)$/i.test(baseOf(p)); }
export function mimeOf(p) {
  const m = MIME[extOf(p)] || 'application/octet-stream';
  return /^text\/|json|xml|javascript|svg/.test(m) ? m + '; charset=utf-8' : m;
}
const DATA_URL_RE = /^data:[^,]*;base64,/;
/** Same rule as Studio core: a base64 data URL on a non-text path is a binary file. */
export function isBinaryContent(path, content) { return DATA_URL_RE.test(content) && !isTextPath(path); }
/** Size the way Studio core counts it: decoded bytes for binary, UTF-8 bytes for text. */
export function contentSize(content, binary, utf8Len) {
  if (binary) { const i = content.indexOf(','); const b64 = content.slice(i + 1); const padN = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0; return Math.max(0, Math.floor(b64.length * 3 / 4) - padN); }
  return utf8Len != null ? utf8Len : enc.encode(content).length;
}

/**
 * Project file path → canonical relative path, or '' when unacceptable.
 * Mirrors Studio core's normPath (backslashes → '/', drops '' and '.' segments, ≤ 240 chars,
 * no control chars or <>:"|?*) but REJECTS '..' instead of resolving it.
 */
export function normPath(p) {
  if (typeof p !== 'string') return '';
  const out = [];
  for (const seg of p.replace(/\\/g, '/').split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') return '';
    out.push(seg);
  }
  const r = out.join('/');
  if (!r || r.length > 240 || /[\u0000-\u001f\u007f<>:"|?*]/.test(r)) return '';
  return r;
}

export function validSlug(s) { return typeof s === 'string' && SLUG_RE.test(s) && !RESERVED_SLUGS.has(s); }

/**
 * The part of a /serve/:slug/<rest> URL after the slug → { path } (file to look up),
 * or { error }. Each segment is percent-decoded once; '..'/'.' segments, NUL/control
 * chars and backslashes are refused. '' or a trailing '/' → '<dir>/index.html'.
 */
export function decodeServePath(rest) {
  rest = String(rest || '');
  const dirLike = rest === '' || rest.endsWith('/');
  const segs = [];
  for (const raw of rest.split('/')) {
    if (!raw) continue;
    let seg;
    try { seg = decodeURIComponent(raw); } catch (_) { return { error: 'bad_path' }; }
    if (seg === '.' || seg === '..' || /[\u0000-\u001f\u007f\\/]/.test(seg)) return { error: 'bad_path' };
    segs.push(seg);
  }
  let path = segs.join('/');
  if (dirLike) path = path ? path + '/index.html' : 'index.html';
  if (path.length > 300) return { error: 'bad_path' };
  return { path, dirLike };
}

/** Keep only entries with v > since, the latest per path, in version order. */
export function dedupeChanges(entries, since) {
  const latest = new Map();
  for (const e of entries || []) {
    if (!e || !(Number(e.v) > Number(since || 0))) continue;
    const prev = latest.get(e.path);
    if (!prev || Number(e.v) > Number(prev.v)) latest.set(e.path, e);
  }
  return [...latest.values()].sort((a, b) => a.v - b.v);
}

export async function hashToken(token) { return sha256Hex(String(token || '')); }
export function newToken() { return 'ostk_' + rhex(24); }
export function newTokenId() { return 'tok_' + rhex(6); }

export function cleanScopes(list) {
  if (!Array.isArray(list)) return [];
  const set = new Set(list.map((s) => String(s || '').toLowerCase()).filter((s) => SCOPES.includes(s)));
  return SCOPES.filter((s) => set.has(s));
}

const TOOL_NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/;
function cleanToolCalls(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const tc of list.slice(0, 16)) {
    const fn = tc && (tc.function || tc);
    const name = fn && String(fn.name || '');
    if (!TOOL_NAME_RE.test(name)) continue;
    let args = fn.arguments;
    if (args == null) args = '{}';
    if (typeof args !== 'string') { try { args = JSON.stringify(args); } catch (_) { args = '{}'; } }
    const id = String((tc && tc.id) || '').replace(/[^\w.:-]/g, '').slice(0, 64) || ('call_' + rhex(6));
    out.push({ id, type: 'function', function: { name, arguments: args.slice(0, LIMITS.aiMsgChars) } });
  }
  return out;
}
const contentText = (c) => {
  if (c == null) return '';
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map((p) => (p && typeof p === 'object' ? (p.text || '') : String(p || ''))).join('');
  return String(c);
};
/**
 * Sanitize an OpenAI-style message list: roles system|user|assistant|tool, content strings
 * ≤ 24k chars, assistant tool_calls and tool tool_call_id/name passed through, at most 60
 * messages and 120k chars (oldest non-system messages are dropped first), and never a
 * leading 'tool' message orphaned from the assistant call it answers.
 */
export function sanitizeMessages(input) {
  if (!Array.isArray(input)) return [];
  let msgs = [];
  for (const m of input.slice(-400)) {
    if (!m || typeof m !== 'object') continue;
    const role = m.role;
    if (!['system', 'user', 'assistant', 'tool'].includes(role)) continue;
    const content = contentText(m.content).slice(0, LIMITS.aiMsgChars);
    if (role === 'assistant') {
      const tcs = cleanToolCalls(m.tool_calls);
      if (!content && !tcs.length) continue;
      const out = { role, content: content || (tcs.length ? null : '') };
      if (tcs.length) out.tool_calls = tcs;
      msgs.push(out);
    } else if (role === 'tool') {
      const id = String(m.tool_call_id || '').replace(/[^\w.:-]/g, '').slice(0, 64);
      if (!id) continue;
      const out = { role, content, tool_call_id: id };
      if (m.name && TOOL_NAME_RE.test(String(m.name))) out.name = String(m.name);
      msgs.push(out);
    } else {
      if (!content) continue;
      msgs.push({ role, content });
    }
  }
  const size = (m) => (m.content ? m.content.length : 0) + (m.tool_calls ? JSON.stringify(m.tool_calls).length : 0);
  const dropOldest = () => { const i = msgs.findIndex((m) => m.role !== 'system'); if (i < 0 || i === msgs.length - 1) return false; msgs.splice(i, 1); return true; };
  while (msgs.length > LIMITS.aiMessages && dropOldest()) { /* trim count */ }
  if (msgs.length > LIMITS.aiMessages) msgs = msgs.slice(-LIMITS.aiMessages);
  let total = msgs.reduce((n, m) => n + size(m), 0);
  while (total > LIMITS.aiTotalChars) { const i = msgs.findIndex((m) => m.role !== 'system'); if (i < 0 || i === msgs.length - 1) break; total -= size(msgs[i]); msgs.splice(i, 1); }
  // A 'tool' message must follow the assistant message whose tool_calls it answers.
  const known = new Set();
  msgs = msgs.filter((m) => {
    if (m.role === 'assistant' && m.tool_calls) { m.tool_calls.forEach((t) => known.add(t.id)); return true; }
    if (m.role === 'tool') return known.has(m.tool_call_id);
    return true;
  });
  return msgs;
}

/** OpenAI function tools only, ≤ 16, names ^[a-zA-Z0-9_-]{1,64}$, small JSON-schema parameters. */
export function sanitizeTools(input) {
  if (!Array.isArray(input)) return [];
  const out = [], seen = new Set();
  for (const t of input) {
    if (out.length >= LIMITS.aiTools) break;
    const fn = t && t.type === 'function' && t.function;
    if (!fn || typeof fn !== 'object') continue;
    const name = String(fn.name || '');
    if (!TOOL_NAME_RE.test(name) || seen.has(name)) continue;
    let params = fn.parameters && typeof fn.parameters === 'object' && !Array.isArray(fn.parameters) ? fn.parameters : { type: 'object', properties: {} };
    let pj = '';
    try { pj = JSON.stringify(params); } catch (_) { continue; }
    if (pj.length > 8000) continue;
    params = JSON.parse(pj);
    seen.add(name);
    out.push({ type: 'function', function: { name, description: String(fn.description || '').slice(0, 1024), parameters: params } });
  }
  return out;
}

/**
 * Normalize any provider's reply (OpenAI choices, Workers AI response/tool_calls) to an OpenAI
 * assistant message. toolNames (optional): when the model wrote its tool call as text
 * ('{"name":…,"parameters":…}' or '<function=name>{…}</function>'), turn it into a real call.
 */
export function normalizeAiMessage(raw, toolNames) {
  let r = raw;
  if (r && Array.isArray(r.choices) && r.choices[0]) r = r.choices[0].message || r.choices[0];
  else if (r && r.result && typeof r.result === 'object' && !Array.isArray(r.result)) r = r.result;
  let content = '';
  if (r && typeof r.content === 'string') content = r.content;
  else if (r && typeof r.response === 'string') content = r.response;
  else if (r && r.response && typeof r.response === 'object') {
    // Some Workers AI models answer a tool call as a JSON object in `response`.
    const o = r.response;
    if (o.name && (o.arguments || o.parameters)) r = { tool_calls: [{ name: o.name, arguments: o.arguments || o.parameters }] };
    else content = JSON.stringify(o);
  } else if (typeof r === 'string') content = r;
  let tcs = cleanToolCalls(r && r.tool_calls);
  if (!tcs.length && content && toolNames && toolNames.length) {
    const names = new Set(toolNames), found = [];
    const t = content.trim();
    if (/^\{[\s\S]*\}$/.test(t)) {
      try { const o = JSON.parse(t); const list = Array.isArray(o) ? o : [o]; for (const c of list) if (c && names.has(c.name)) found.push({ name: c.name, arguments: c.arguments || c.parameters || {} }); } catch (_) {}
    }
    const re = /<function=([a-zA-Z0-9_-]{1,64})>\s*(\{[\s\S]*?\})\s*<\/function>/g;
    let mm; while ((mm = re.exec(content))) if (names.has(mm[1])) found.push({ name: mm[1], arguments: mm[2] });
    if (found.length) { tcs = cleanToolCalls(found); content = found.length && /^\{[\s\S]*\}$/.test(t) ? '' : content.replace(re, '').trim(); }
  }
  const msg = { role: 'assistant', content: content || '' };
  if (tcs.length) msg.tool_calls = tcs;
  return msg;
}

/** Workers AI does not reliably accept role:'tool' / assistant tool_calls — fold them into text. */
function toWorkersAiMessages(msgs) {
  return msgs.map((m) => {
    if (m.role === 'tool') return { role: 'user', content: '[tool result' + (m.name ? ' ' + m.name : '') + ' for call ' + m.tool_call_id + ']\n' + (m.content || '') };
    if (m.role === 'assistant' && m.tool_calls) return { role: 'assistant', content: ((m.content || '') + '\n' + m.tool_calls.map((t) => '[called tool ' + t.function.name + ' ' + t.function.arguments + ' (id ' + t.id + ')]').join('\n')).trim() };
    return { role: m.role, content: m.content || '' };
  });
}

/* ======================================================================
 * mesh signature (OST-MESH|v1, same canonical as mesh/hub.js)
 * ==================================================================== */
const MESH_AUTH_WINDOW_MS = 5 * 60 * 1000;
const KEY_CACHE_MS = 5 * 60 * 1000;
export function meshCanonical({ addr, method, pathq, bodyHash, ts, nonce }) { return `OST-MESH|v1|${addr}|${String(method).toUpperCase()}|${pathq}|${bodyHash}|${ts}|${nonce}`; }

/* ======================================================================
 * entry point used by src/index.js
 * ==================================================================== */
export async function handleStudioRequest(request, env) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors() });
  if (!env || !env.STUDIO_HUB) return fail('studio_unavailable', 503);
  try {
    const stub = env.STUDIO_HUB.get(env.STUDIO_HUB.idFromName(HUB_NAME));
    return await stub.fetch(request);
  } catch (e) {
    return fail('studio_hub_unavailable', 503, { message: String((e && e.message) || e).slice(0, 160) });
  }
}

/* ======================================================================
 * the Durable Object
 * ==================================================================== */
export class StudioHub {
  constructor(state, env) {
    this.state = state;
    this.st = state.storage;
    this.env = env || {};
    this.keyCache = new Map();     // addr → {at, key, profile}
    this.tokCache = new Map();     // token hash → record
    this.memNonces = new Map();    // GET replay guard (in memory)
    this.appCache = new Map();     // slug → {meta}
    this.idxCache = new Map();     // slug:ver → Map(path → df)
    this.byteCache = new Map();    // slug:ver:path → Uint8Array (LRU)
    this.byteCacheSize = 0;
    this.viewBuf = new Map();      // slug → pending views
    this.alarmAt = 0;
    this._lock = Promise.resolve();
    this.rl = new Map();           // kind:owner → {at, n}
  }

  /** In-memory fixed-window limiter → 0 when allowed, else seconds until the window resets. */
  rate(kind, owner, limit, windowMs) {
    const k = kind + ':' + owner, now = Date.now();
    let e = this.rl.get(k);
    if (!e || now - e.at > windowMs) { if (this.rl.size > 20000) this.rl.clear(); e = { at: now, n: 0 }; this.rl.set(k, e); }
    return ++e.n > limit ? Math.max(1, Math.ceil((e.at + windowMs - now) / 1000)) : 0;
  }

  /** Serialize state-changing work (reads → validation → writes) so two requests never interleave. */
  locked(fn) {
    const run = this._lock.then(fn, fn);
    this._lock = run.catch(() => {});
    return run;
  }

  /* ---------- storage helpers (DO limits: 128 keys per batch op) ---------- */
  async getMany(keys) {
    const out = new Map();
    for (let i = 0; i < keys.length; i += 128) { const m = await this.st.get(keys.slice(i, i + 128)); for (const [k, v] of m) out.set(k, v); }
    return out;
  }
  async putMany(obj) {
    const ents = Object.entries(obj);
    for (let i = 0; i < ents.length; i += 128) await this.st.put(Object.fromEntries(ents.slice(i, i + 128)));
  }
  async delMany(keys) {
    for (let i = 0; i < keys.length; i += 128) await this.st.delete(keys.slice(i, i + 128));
  }
  async listAll(prefix, opts = {}) { return this.st.list({ prefix, ...opts }); }
  chunkKeys(fid, n) { const k = []; for (let i = 0; i < n; i++) k.push('fc:' + fid + ':' + pad3(i)); return k; }
  async writeChunks(prefixFn, bytes) {
    const n = Math.ceil(bytes.length / CHUNK), obj = {};
    for (let i = 0; i < n; i++) { const part = bytes.slice(i * CHUNK, (i + 1) * CHUNK); obj[prefixFn(i)] = part.buffer; }
    await this.putMany(obj);
    return n;
  }
  async readChunks(keys, total) {
    if (!keys.length) return new Uint8Array(0);
    const got = await this.getMany(keys);
    const out = new Uint8Array(total); let o = 0;
    for (const k of keys) { const c = got.get(k); if (!c) throw new Error('chunk_missing'); const u = new Uint8Array(c); out.set(u, o); o += u.length; }
    return o === total ? out : out.slice(0, o);
  }
  async fileContent(fm) { return utf8Decode(await this.readChunks(this.chunkKeys(fm.fid, fm.n), fm.len)); }

  /* ---------- auth ---------- */
  async meshKey(addr, fresh) {
    const now = Date.now();
    const c = this.keyCache.get(addr);
    if (c && !fresh && now - c.at < KEY_CACHE_MS) return c;
    if (!this.env.MESH_HUB) throw new Error('directory_unavailable');
    const hub = this.env.MESH_HUB.get(this.env.MESH_HUB.idFromName('mesh-v1'));
    const r = await hub.fetch('https://mesh-hub/mesh/v1/identity/lookup?address=' + encodeURIComponent(addr));
    if (r.status === 404) { this.keyCache.delete(addr); return null; }
    if (!r.ok) throw new Error('directory_unavailable');
    const rec = await r.json().catch(() => null);
    const jwk = rec && rec.bundle && rec.bundle.sig;
    if (!jwk) return null;
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-384' }, false, ['verify']);
    const thumb = await sha256Hex(JSON.stringify([jwk.kty, jwk.crv, jwk.x, jwk.y]));
    const v = { at: now, key, thumb, profile: (rec && rec.profile) || null };
    if (this.keyCache.size > 3000) this.keyCache.clear();
    this.keyCache.set(addr, v);
    return v;
  }

  // Returns { ok:true, addr } or { ok:false, error, status }. Never throws.
  async verifyMesh(request, url, bodyBytes) {
    try {
      const h = (n) => request.headers.get(n) || '';
      const addr = h('x-mesh-addr'), ts = Number(h('x-mesh-ts')), nonce = h('x-mesh-nonce'), sig = h('x-mesh-sig');
      if (!addr || !sig || !nonce || !Number.isFinite(ts)) return { ok: false, error: 'auth_required', status: 401 };
      if (!validAddr(addr)) return { ok: false, error: 'mesh_auth_bad_addr', status: 401 };
      if (Math.abs(Date.now() - ts) > MESH_AUTH_WINDOW_MS) return { ok: false, error: 'mesh_auth_stale', status: 401 };
      if (!/^[0-9a-f]{16,64}$/i.test(nonce)) return { ok: false, error: 'mesh_auth_bad_nonce', status: 401 };
      let rec;
      try { rec = await this.meshKey(addr); } catch (_) { return { ok: false, error: 'directory_unavailable', status: 503 }; }
      if (!rec) return { ok: false, error: 'mesh_identity_unknown', status: 401 };   // client announces + retries
      const bodyHash = await sha256Hex(bodyBytes || new Uint8Array(0));
      const pathq = url.pathname.replace(/\/$/, '') + url.search;
      // The URL serializer percent-encodes ' in queries (encodeURIComponent leaves it bare),
      // so also accept the signature over the un-encoded form.
      const candidates = [pathq]; if (/%27/i.test(pathq)) candidates.push(pathq.replace(/%27/gi, "'"));
      let sigBytes; try { sigBytes = b64ToBytes(sig); } catch (_) { return { ok: false, error: 'mesh_auth_bad_signature', status: 401 }; }
      const check = async (key) => { for (const p of candidates) { if (await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-384' }, key, sigBytes, enc.encode(meshCanonical({ addr, method: request.method, pathq: p, bodyHash, ts, nonce })))) return true; } return false; };
      let good = await check(rec.key);
      if (!good && Date.now() - rec.at > 30_000) {         // cached key may be stale
        try { const fresh = await this.meshKey(addr, true); if (fresh && await check(fresh.key)) { good = true; rec = fresh; } } catch (_) {}
      }
      if (!good) return { ok: false, error: 'mesh_auth_bad_signature', status: 401 };
      // Key pinning (trust on first use, per Studio owner). The mesh directory forgets an identity
      // after 7 days without a re-announce, after which anyone could announce NEW keys for a known
      // address and take over its projects, tokens and apps. Studio remembers the first key that
      // signed for an address and refuses any other.
      if (rec.pinned !== true) {
        const pk = 'okey:' + addr, pinned = await this.st.get(pk);
        if (!pinned) await this.st.put(pk, rec.thumb);
        else if (pinned !== rec.thumb) return { ok: false, error: 'identity_key_changed', status: 403 };
        rec.pinned = true;
      }
      // Replay guard. State-changing requests: durable (survives eviction). Reads: in memory —
      // Studio polls /changes every few seconds per open tab, and a durable row per poll would
      // burn the Durable Object row-write quota; a replayed read only returns what the signer saw.
      const nk = 'nonce:' + addr + ':' + nonce;
      const exp = Date.now() + 2 * MESH_AUTH_WINDOW_MS;
      if (request.method === 'GET' || request.method === 'HEAD') {
        if (this.memNonces.has(nk)) return { ok: false, error: 'mesh_auth_replay', status: 401 };
        this.memNonces.set(nk, exp);
        if (this.memNonces.size > 20000) { const now = Date.now(); for (const [k, e] of this.memNonces) if (e <= now) this.memNonces.delete(k); if (this.memNonces.size > 20000) this.memNonces.clear(); }
      } else {
        if (this.memNonces.has(nk) || await this.st.get(nk)) return { ok: false, error: 'mesh_auth_replay', status: 401 };
        this.memNonces.set(nk, exp);
        await this.st.put(nk, exp);
        if (Math.random() < 0.03) this.sweepNonces().catch(() => {});
      }
      return { ok: true, addr };
    } catch (e) { return { ok: false, error: 'mesh_auth_error', status: 401 }; }
  }
  async sweepNonces() {
    const now = Date.now(), listed = await this.st.list({ prefix: 'nonce:', limit: 1000 }), del = [];
    for (const [k, exp] of listed) if (Number(exp) <= now) del.push(k);
    if (del.length) await this.delMany(del.slice(0, 512));
  }

  async tokenRecord(token) {
    const h = await hashToken(token);
    let rec = this.tokCache.get(h);
    if (!rec) {
      rec = await this.st.get('tokh:' + h);
      if (!rec) return null;
      if (this.tokCache.size > 2000) this.tokCache.clear();
      this.tokCache.set(h, rec);
    }
    return { h, rec };
  }

  /**
   * Resolve the caller. need: 'read'|'write'|'deploy' (token scope) or 'mesh' (mesh signature only).
   * → { ok:true, owner, by, kind:'mesh'|'token', scopes } | { ok:false, error, status }
   */
  async auth(request, url, bodyBytes, need) {
    const authz = request.headers.get('Authorization') || '';
    if (authz) {
      const m = /^Bearer\s+(\S+)\s*$/i.exec(authz);
      if (!m) return { ok: false, error: 'bad_authorization', status: 401 };
      if (need === 'mesh') return { ok: false, error: 'mesh_auth_only', status: 403, message: 'Tokens cannot manage tokens — use OST Studio.' };
      if (!TOKEN_RE.test(m[1])) return { ok: false, error: 'invalid_token', status: 401 };
      const t = await this.tokenRecord(m[1]);
      if (!t) return { ok: false, error: 'invalid_token', status: 401 };
      if (!t.rec.scopes.includes(need)) return { ok: false, error: 'insufficient_scope', status: 403, need };
      const now = Date.now();
      if (now - (t.rec.lastUsed || 0) > 5 * 60 * 1000) { t.rec.lastUsed = now; await this.st.put('tokh:' + t.h, t.rec); }
      return { ok: true, owner: t.rec.owner, by: t.rec.id, kind: 'token', scopes: t.rec.scopes.slice() };
    }
    const v = await this.verifyMesh(request, url, bodyBytes);
    if (!v.ok) return v;
    return { ok: true, owner: v.addr, by: v.addr, kind: 'mesh', scopes: SCOPES.slice() };
  }

  /* ---------- router ---------- */
  async fetch(request) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors() });
    try {
      return await this.route(request, new URL(request.url));
    } catch (e) {
      return fail('studio_error', 500, { message: String((e && e.message) || e).slice(0, 200) });
    }
  }

  async route(request, url) {
    const method = request.method;
    const raw = url.pathname;
    if (!raw.startsWith('/studio/v1/')) return fail('not_found', 404);
    {
      // Public static serving keeps the raw path (a trailing '/' matters there).
      if (raw.startsWith('/studio/v1/serve/') && (method === 'GET' || method === 'HEAD')) {
        const rest = raw.slice('/studio/v1/serve/'.length);
        const i = rest.indexOf('/');
        return this.serve(request, i < 0 ? rest : rest.slice(0, i), i < 0 ? null : rest.slice(i + 1));
      }
      const path = raw.replace(/\/+$/, '') || '/';
      const seg = path.split('/').slice(3);          // after '', 'studio', 'v1'
      const s0 = seg[0] || '';

      if (method === 'GET' && s0 === 'health' && seg.length === 1) return json({ ok: true, studio: 'v1', ts: Date.now(), ai: !!(this.env.GROQ_API_KEY || this.env.AI) });
      if (method === 'GET' && s0 === 'agents.md' && seg.length === 1) {
        return new Response(AGENTS_MD, { status: 200, headers: cors({ 'Content-Type': 'text/markdown; charset=utf-8', 'Cache-Control': 'public, max-age=300' }) });
      }
      if (method === 'GET' && s0 === 'apps' && seg.length === 1) return this.appsList(url);
      if (method === 'GET' && s0 === 'apps' && seg.length === 2) return this.appGet(seg[1]);

      // Everything below is authenticated: read the body once (bytes are what was signed).
      let bytes = new Uint8Array(0);
      if (method !== 'GET' && method !== 'HEAD') {
        const cl = Number(request.headers.get('Content-Length') || 0);
        if (cl > LIMITS.bodyBytes) return fail('too_large', 413, { message: 'Request body is over ' + (LIMITS.bodyBytes / MB) + ' MB.' });
        bytes = new Uint8Array(await request.arrayBuffer());
        if (bytes.length > LIMITS.bodyBytes) return fail('too_large', 413);
      }
      const body = () => { if (!bytes.length) return {}; try { const v = JSON.parse(utf8Decode(bytes)); return v && typeof v === 'object' ? v : null; } catch (_) { return null; } };
      const need = async (scope) => {
        const a = await this.auth(request, url, bytes, scope);
        if (!a.ok) return a;
        const read = method === 'GET';
        let wait = this.rate(read ? 'r' : 'w', a.owner, read ? LIMITS.readsPerWindow : LIMITS.writesPerWindow, LIMITS.reqWindowMs);
        if (!wait && scope === 'deploy') wait = this.rate('d', a.owner, LIMITS.deploysPerHour, 3600_000);
        return wait ? { ok: false, error: 'rate_limited', status: 429, retryAfter: wait } : a;
      };
      const denied = (a) => fail(a.error, a.status || 401, a.need ? { need: a.need } : a.retryAfter ? { retryAfter: a.retryAfter } : (a.message ? { message: a.message } : {}));

      // ── tokens (mesh only) ──
      if (s0 === 'tokens') {
        const a = await need('mesh'); if (!a.ok) return denied(a);
        if (method === 'POST' && seg.length === 1) { const b = body(); if (!b) return fail('bad_json'); return this.locked(() => this.tokenCreate(a, b)); }
        if (method === 'GET' && seg.length === 1) return this.tokenList(a);
        if (method === 'DELETE' && seg.length === 2) return this.locked(() => this.tokenDelete(a, seg[1]));
        return fail('not_found', 404);
      }

      // ── AI proxy ──
      if (s0 === 'ai' && seg[1] === 'chat' && seg.length === 2 && method === 'POST') {
        if (bytes.length > 1.5 * MB) return fail('too_large', 413);
        const a = await need('read'); if (!a.ok) return denied(a);
        const b = body(); if (!b) return fail('bad_json');
        return this.aiChat(a, b);
      }

      // ── reports (anyone; rate limited per IP) — feeds operator moderation ──
      if (s0 === 'apps' && seg.length === 3 && seg[2] === 'report' && method === 'POST') {
        const slug = seg[1];
        if (!SLUG_RE.test(String(slug))) return fail('app_not_found', 404);
        const ip = request.headers.get('CF-Connecting-IP') || 'anon';
        const wait = this.rate('rep', ip, 10, 3600_000);
        if (wait) return fail('rate_limited', 429, { retryAfter: wait });
        if (!(await this.st.get('app:' + slug))) return fail('app_not_found', 404);
        const b = body() || {};
        const reason = ['scam', 'impersonation', 'malware', 'abuse', 'other'].includes(b.reason) ? b.reason : 'other';
        const ts = Date.now();
        const by = /^ost-mesh:[0-9a-f-]{8,40}$/i.test(request.headers.get('x-mesh-addr') || '') ? request.headers.get('x-mesh-addr') : '';
        await this.st.put('report:' + String(1e15 - ts).padStart(16, '0') + ':' + slug, { slug, reason, note: String(b.note || '').slice(0, 300), ts, by, ipHash: (await sha256Hex(ip)).slice(0, 16) });
        return json({ ok: true, reported: slug });
      }
      // ── operator moderation (worker secret SOCIAL_ADMIN_KEY or MESH_ADMIN_KEY) ──
      if (s0 === 'admin' && seg.length === 1 && method === 'POST') {
        const b = body() || {};
        const keys = [this.env.SOCIAL_ADMIN_KEY, this.env.MESH_ADMIN_KEY].filter(Boolean);
        if (!keys.length || !keys.includes(b.key)) return fail('unauthorized', 403);
        if (b.action === 'reports') {
          const listed = await this.st.list({ prefix: 'report:', limit: Math.min(200, Number(b.limit) || 100) });
          return json({ ok: true, reports: [...listed.values()] });
        }
        if (b.action === 'unpublish') {
          const m = await this.st.get('app:' + String(b.slug || ''));
          if (!m) return fail('app_not_found', 404);
          return this.locked(() => this.appUnpublish({ owner: m.owner }, m.slug || b.slug));
        }
        return fail('bad_action');
      }

      // ── apps ──
      if (s0 === 'apps' && seg.length === 3 && seg[2] === 'unpublish' && method === 'POST') {
        const a = await need('deploy'); if (!a.ok) return denied(a);
        return this.locked(() => this.appUnpublish(a, seg[1]));
      }

      // ── projects ──
      if (s0 === 'projects') {
        if (seg.length === 1) {
          if (method === 'GET') { const a = await need('read'); if (!a.ok) return denied(a); return this.projectList(a); }
          if (method === 'POST') { const a = await need('write'); if (!a.ok) return denied(a); const b = body(); if (!b) return fail('bad_json'); return this.locked(() => this.projectCreate(a, b)); }
          return fail('method_not_allowed', 405);
        }
        const pid = seg[1], sub = seg[2] || '';
        if (seg.length > 3 || (sub && !['file', 'sync', 'deploy', 'export', 'changes'].includes(sub))) return fail('not_found', 404);
        const scope = method === 'GET' ? 'read' : sub === 'deploy' ? 'deploy' : 'write';
        const a = await need(scope); if (!a.ok) return denied(a);
        const qpath = url.searchParams.get('path');
        const loadPm = async () => { const pm = PID_RE.test(pid) ? await this.st.get('proj:' + pid) : null; return pm && pm.owner === a.owner ? pm : null; };
        if (method === 'GET') {
          const pm = await loadPm(); if (!pm) return fail('project_not_found', 404);
          if (!sub) return this.projectGet(pm);
          if (sub === 'export') return this.projectExport(pm);
          if (sub === 'changes') return this.projectChanges(pm, url.searchParams.get('since'));
          if (sub === 'file') return this.fileGet(pm, qpath);
          return fail('not_found', 404);
        }
        let b = null;
        if (method === 'POST' || method === 'PATCH') { b = body(); if (!b) return fail('bad_json'); }
        if (sub === 'deploy' && method === 'POST') return this.deploy(a, pid, b, loadPm);   // locks after its directory lookup
        return this.locked(async () => {
          const pm = await loadPm(); if (!pm) return fail('project_not_found', 404);
          if (!sub && method === 'PATCH') return this.projectPatch(a, pm, b);
          if (!sub && method === 'DELETE') return this.projectDelete(pm);
          if (sub === 'file' && method === 'PUT') return this.filePut(a, pm, qpath, bytes);
          if (sub === 'file' && method === 'DELETE') return this.fileDelete(a, pm, qpath);
          if (sub === 'sync' && method === 'POST') return this.projectSync(a, pm, b);
          return fail('method_not_allowed', 405);
        });
      }
      return fail('not_found', 404);
    }
  }

  /* ======================================================================
   * projects
   * ==================================================================== */
  pub(pm) {
    return { id: pm.id, name: pm.name, template: pm.template, owner: pm.owner, createdAt: pm.createdAt, updatedAt: pm.updatedAt, version: pm.version, files: pm.files, bytes: pm.bytes, updatedBy: pm.updatedBy || pm.owner };
  }

  async projectList(a) {
    const idx = await this.listAll('oproj:' + a.owner + ':');
    const keys = [...idx.keys()].map((k) => 'proj:' + k.slice(('oproj:' + a.owner + ':').length));
    const got = await this.getMany(keys);
    const projects = [];
    for (const k of keys) { const pm = got.get(k); if (pm && pm.owner === a.owner) projects.push(this.pub(pm)); }
    projects.sort((x, y) => (y.updatedAt || 0) - (x.updatedAt || 0));
    return json({ ok: true, projects });
  }

  async projectCreate(a, b) {
    const name = clip(b.name, 60) || 'my-project';
    const template = /^[a-z0-9-]{1,24}$/.test(String(b.template || '')) ? String(b.template) : 'custom';
    const files = b.files == null ? {} : b.files;
    if (typeof files !== 'object' || Array.isArray(files)) return fail('bad_files');
    const entries = Object.entries(files);
    if (entries.length > LIMITS.filesPerProject) return fail('too_large', 413, { message: 'Projects are limited to ' + LIMITS.filesPerProject + ' files.' });

    let pid = PID_RE.test(String(b.id || '')) ? String(b.id) : '';
    let pm = pid ? await this.st.get('proj:' + pid) : null;
    if (pm && pm.owner !== a.owner) { pid = ''; pm = null; }             // id taken by someone else → fresh id
    let created = false, renamed = false;
    if (!pm) {
      const mine = await this.listAll('oproj:' + a.owner + ':');
      if (mine.size >= LIMITS.projectsPerOwner) return fail('project_limit', 403, { message: 'You can keep ' + LIMITS.projectsPerOwner + ' cloud projects — delete one first.' });
      if (!pid) { do { pid = 'p' + rhex(8); } while (await this.st.get('proj:' + pid)); }
      const now = Date.now();
      pm = { id: pid, owner: a.owner, name, template, createdAt: now, updatedAt: now, version: 0, files: 0, bytes: 0, updatedBy: a.by };
      created = true;
    } else if (b.name != null && name !== pm.name) { pm.name = name; pm.updatedAt = Date.now(); renamed = true; }

    const ops = [];
    for (const [p, c] of entries) ops.push({ op: 'put', path: p, content: c });
    const plan = await this.plan(pm, ops);
    if (plan.error) return fail(plan.error, plan.status || 400, plan.message ? { message: plan.message } : {});
    if (created) await this.st.put({ ['proj:' + pid]: pm, ['oproj:' + a.owner + ':' + pid]: 1 });
    const n = await this.apply(pm, plan, a.by);
    if (!n && !created && renamed) await this.st.put('proj:' + pid, pm);
    return json({ ok: true, project: this.pub(pm), version: pm.version, created });
  }

  async projectGet(pm) {
    const listed = await this.listAll('fm:' + pm.id + ':');
    const files = [...listed.values()].map((f) => ({ path: f.path, size: f.size, hash: f.hash, mtime: f.mtime, binary: !!f.binary, by: f.by }));
    files.sort((x, y) => (x.path < y.path ? -1 : 1));
    return json({ ok: true, project: this.pub(pm), files });
  }

  async projectPatch(a, pm, b) {
    const name = clip(b.name, 60);
    if (!name) return fail('bad_name');
    pm.name = name; pm.updatedAt = Date.now(); pm.updatedBy = a.by;
    await this.st.put('proj:' + pm.id, pm);
    return json({ ok: true, project: this.pub(pm) });
  }

  async projectDelete(pm) {
    const fms = await this.listAll('fm:' + pm.id + ':');
    const del = [];
    for (const [k, f] of fms) { del.push(k); del.push(...this.chunkKeys(f.fid, f.n)); }
    for (;;) {
      const chg = await this.st.list({ prefix: 'chg:' + pm.id + ':', limit: 1000 });
      if (!chg.size) break;
      await this.delMany([...chg.keys()]);
      if (chg.size < 1000) break;
    }
    del.push('proj:' + pm.id, 'oproj:' + pm.owner + ':' + pm.id);
    await this.delMany(del);
    return json({ ok: true, deleted: pm.id });
  }

  async projectExport(pm) {
    const listed = await this.listAll('fm:' + pm.id + ':');
    const metas = [...listed.values()];
    const keys = []; for (const f of metas) keys.push(...this.chunkKeys(f.fid, f.n));
    const got = await this.getMany(keys);
    const files = [];
    for (const f of metas) {
      const parts = this.chunkKeys(f.fid, f.n).map((k) => got.get(k));
      if (parts.some((p) => !p)) continue;
      const u = new Uint8Array(f.len); let o = 0; for (const p of parts) { const x = new Uint8Array(p); u.set(x, o); o += x.length; }
      files.push({ path: f.path, content: utf8Decode(u), hash: f.hash, binary: !!f.binary, mtime: f.mtime, size: f.size });
    }
    files.sort((x, y) => (x.path < y.path ? -1 : 1));
    return json({ ok: true, project: this.pub(pm), version: pm.version, files });
  }

  async fileGet(pm, qpath) {
    const p = normPath(qpath || '');
    if (!p) return fail('bad_path');
    const f = await this.st.get('fm:' + pm.id + ':' + p);
    if (!f) return fail('file_not_found', 404);
    return json({ ok: true, path: f.path, content: await this.fileContent(f), hash: f.hash, binary: !!f.binary, mtime: f.mtime, size: f.size, by: f.by });
  }

  async filePut(a, pm, qpath, bytes) {
    if (bytes.length > LIMITS.fileBytes * 4 / 3 + 1024) return fail('too_large', 413, { message: 'Files are limited to ' + (LIMITS.fileBytes / MB) + ' MB.' });
    let content;
    try { content = utf8Decode(bytes); } catch (_) { return fail('bad_encoding', 400, { message: 'Send UTF-8 text; binary files go as a data: URL.' }); }
    const plan = await this.plan(pm, [{ op: 'put', path: qpath, content }]);
    if (plan.error) return fail(plan.error, plan.status || 400, plan.message ? { message: plan.message } : {});
    await this.apply(pm, plan, a.by);
    const put = plan.actions[0];
    return json({ ok: true, version: pm.version, hash: put ? put.hash : await sha256Hex(bytes), path: put ? put.path : normPath(qpath) });
  }

  async fileDelete(a, pm, qpath) {
    const plan = await this.plan(pm, [{ op: 'del', path: qpath }]);
    if (plan.error) return fail(plan.error, plan.status || 400, plan.message ? { message: plan.message } : {});
    if (!plan.actions.length) return fail('file_not_found', 404);
    await this.apply(pm, plan, a.by);
    return json({ ok: true, version: pm.version, deleted: plan.actions.length });
  }

  async projectSync(a, pm, b) {
    const ops = [];
    if (b.rename != null) {
      if (!Array.isArray(b.rename)) return fail('bad_rename');
      for (const r of b.rename) { if (!Array.isArray(r) || r.length !== 2) return fail('bad_rename'); ops.push({ op: 'ren', from: r[0], to: r[1] }); }
    }
    if (b.del != null) {
      if (!Array.isArray(b.del)) return fail('bad_del');
      for (const p of b.del) ops.push({ op: 'del', path: p, soft: true });
    }
    if (b.put != null) {
      if (typeof b.put !== 'object' || Array.isArray(b.put)) return fail('bad_put');
      for (const [p, c] of Object.entries(b.put)) ops.push({ op: 'put', path: p, content: c });
    }
    if (ops.length > 2000) return fail('too_large', 413, { message: 'Too many operations in one sync.' });
    const plan = await this.plan(pm, ops);
    if (plan.error) return fail(plan.error, plan.status || 400, plan.message ? { message: plan.message } : {});
    const applied = await this.apply(pm, plan, a.by);
    return json({ ok: true, version: pm.version, applied });
  }

  /**
   * Validate a list of ops against the project (sequentially, on an overlay) without writing.
   * ops: {op:'put', path, content} | {op:'del', path, soft?} | {op:'ren', from, to}
   * → { actions:[...] } | { error, status, message }
   * Deletes of missing paths are ignored when soft (sync) and produce no action otherwise.
   */
  async plan(pm, ops) {
    const pid = pm.id;
    const overlay = new Map();                       // path → fm | null
    const cur = async (p) => { if (overlay.has(p)) return overlay.get(p); const f = (await this.st.get('fm:' + pid + ':' + p)) || null; overlay.set(p, f); return f; };
    const under = async (prefix) => {                // existing paths strictly under prefix/
      const listed = await this.listAll('fm:' + pid + ':' + prefix + '/');
      const set = new Set();
      for (const f of listed.values()) if (!overlay.has(f.path)) set.add(f.path);
      for (const [p, f] of overlay) if (p.startsWith(prefix + '/') && f) set.add(p);
      return [...set].sort();
    };
    let files = pm.files || 0, bytes = pm.bytes || 0;
    const actions = [];
    const err = (error, message, status = 400) => ({ error, message, status });
    for (const o of ops) {
      if (o.op === 'put') {
        const p = normPath(o.path);
        if (!p) return err('bad_path', 'Invalid file path: ' + String(o.path).slice(0, 120));
        if (typeof o.content !== 'string') return err('bad_content', p + ': content must be a string (binary files as a data: URL).');
        const encd = enc.encode(o.content);
        const binary = isBinaryContent(p, o.content);
        const size = contentSize(o.content, binary, encd.length);
        if (size > LIMITS.fileBytes) return err('too_large', p + ' is over the ' + (LIMITS.fileBytes / MB) + ' MB file limit.', 413);
        const old = await cur(p);
        const hash = await sha256Hex(encd);
        if (old && old.hash === hash && !!old.binary === binary) continue;      // identical → no-op
        if (!old) files++;
        bytes += size - (old ? old.size : 0);
        if (files > LIMITS.filesPerProject) return err('too_large', 'Projects are limited to ' + LIMITS.filesPerProject + ' files.', 413);
        if (bytes > LIMITS.projectBytes) return err('too_large', 'Projects are limited to ' + (LIMITS.projectBytes / MB) + ' MB.', 413);
        const meta = { path: p, hash, size, binary, len: encd.length };
        overlay.set(p, meta);
        actions.push({ kind: 'put', path: p, hash, size, binary, encd, old });
      } else if (o.op === 'del') {
        const p = normPath(o.path);
        if (!p) return err('bad_path', 'Invalid file path: ' + String(o.path).slice(0, 120));
        const old = await cur(p);
        const targets = old ? [p] : await under(p);
        for (const t of targets) {
          const f = await cur(t); if (!f) continue;
          files--; bytes -= f.size || 0; overlay.set(t, null);
          actions.push({ kind: 'del', path: t, old: f });
        }
      } else if (o.op === 'ren') {
        const from = normPath(o.from), to = normPath(o.to);
        if (!from || !to) return err('bad_path', 'Invalid rename: ' + String(o.from).slice(0, 80) + ' → ' + String(o.to).slice(0, 80));
        if (from === to) continue;
        if (to.startsWith(from + '/')) return err('bad_rename', 'Cannot move a folder into itself.');
        const old = await cur(from);
        const moves = old ? [[from, to]] : (await under(from)).map((p) => [p, to + p.slice(from.length)]);
        if (!moves.length) return err('file_not_found', from + ' does not exist.', 404);
        for (const [, n] of moves) { if (!normPath(n)) return err('bad_path', 'Invalid target path: ' + n.slice(0, 120)); if (await cur(n)) return err('exists', n + ' already exists.', 409); }
        for (const [s, n] of moves) {
          const f = await cur(s);
          overlay.set(s, null); overlay.set(n, { ...f, path: n });
          actions.push({ kind: 'mv', from: s, to: n, old: f });
        }
      }
    }
    return { actions, files, bytes };
  }

  /** Write a validated plan: file metas, content chunks, change-log entries, project meta. → number of changes */
  async apply(pm, plan, by) {
    const pid = pm.id, now = Date.now(), DEL = Symbol('del');   // w: storage key → value | DEL (last write wins)
    const w = new Map();
    const firstV = pm.version + 1;
    let v = pm.version;
    const live = new Map();                          // path → fm as of this point in the plan
    const dropChunks = (fm) => { if (fm && fm.fid && !this._fidStillUsed(fm.fid, live)) for (const k of this.chunkKeys(fm.fid, fm.n)) w.set(k, DEL); };
    const fmKey = (p) => 'fm:' + pid + ':' + p;
    const chgKey = (x) => 'chg:' + pid + ':' + pad12(x);
    for (const act of plan.actions) {
      v++;
      if (act.kind === 'put') {
        const fid = rhex(8);
        const n = Math.ceil(act.encd.length / CHUNK);
        for (let i = 0; i < n; i++) w.set('fc:' + fid + ':' + pad3(i), act.encd.slice(i * CHUNK, (i + 1) * CHUNK).buffer);
        const fm = { path: act.path, hash: act.hash, size: act.size, binary: act.binary, mtime: now, by, fid, n, len: act.encd.length };
        const prior = live.has(act.path) ? live.get(act.path) : act.old;
        live.set(act.path, fm);
        dropChunks(prior);
        w.set(fmKey(act.path), fm);
        w.set(chgKey(v), { v, path: act.path, hash: act.hash, by, ts: now, binary: act.binary });
      } else if (act.kind === 'del') {
        const prior = live.has(act.path) ? live.get(act.path) : act.old;
        live.set(act.path, null);
        dropChunks(prior);
        w.set(fmKey(act.path), DEL);
        w.set(chgKey(v), { v, path: act.path, deleted: true, hash: null, by, ts: now });
      } else if (act.kind === 'mv') {
        const prior = live.has(act.from) ? live.get(act.from) : act.old;
        const fm = { ...prior, path: act.to, mtime: now, by };
        live.set(act.from, null); live.set(act.to, fm);
        w.set(fmKey(act.from), DEL);
        w.set(fmKey(act.to), fm);
        w.set(chgKey(v), { v, path: act.from, deleted: true, hash: null, by, ts: now });
        v++;
        w.set(chgKey(v), { v, path: act.to, hash: fm.hash, by, ts: now, binary: !!fm.binary });
      }
    }
    const count = v - pm.version;
    if (!count) return 0;
    // Keep only the last LIMITS.changeLog entries.
    for (let x = Math.max(1, firstV - LIMITS.changeLog); x <= v - LIMITS.changeLog; x++) w.set(chgKey(x), DEL);
    pm.version = v; pm.files = plan.files; pm.bytes = plan.bytes; pm.updatedAt = now; pm.updatedBy = by;
    w.set('proj:' + pid, pm);
    const dels = [], puts = {};
    for (const [k, val] of w) { if (val === DEL) dels.push(k); else puts[k] = val; }
    await this.delMany(dels);
    await this.putMany(puts);
    return count;
  }
  _fidStillUsed(fid, live) { for (const f of live.values()) if (f && f.fid === fid) return true; return false; }

  async projectChanges(pm, sinceRaw) {
    const since = Math.max(0, Math.floor(Number(sinceRaw) || 0));
    const version = pm.version || 0;
    if (since <= 0 || since >= version) return json({ ok: true, version, changes: [] });
    let entries, full = false;
    if (since < version - LIMITS.changeLog) {
      // The log no longer reaches back to `since`: send every current file.
      full = true;
      const listed = await this.listAll('fm:' + pm.id + ':');
      entries = [...listed.values()].map((f) => ({ path: f.path, hash: f.hash, by: f.by, binary: !!f.binary, _fm: f }));
      entries.forEach((e) => { e.v = version; });
    } else {
      const listed = await this.st.list({ prefix: 'chg:' + pm.id + ':', start: 'chg:' + pm.id + ':' + pad12(since + 1), limit: LIMITS.changeLog + 10 });
      entries = dedupeChanges([...listed.values()], since);
    }
    // Content comes from the CURRENT file: the latest entry per path is its current state.
    const live = entries.filter((e) => !e.deleted);
    const fmGot = full ? null : await this.getMany(live.map((e) => 'fm:' + pm.id + ':' + e.path));
    let budget = LIMITS.inlineChangesTotal;
    const inline = [];
    const out = [];
    for (const e of entries) {
      if (e.deleted) { out.push({ v: e.v, path: e.path, deleted: true, hash: null, by: e.by }); continue; }
      const f = full ? e._fm : fmGot.get('fm:' + pm.id + ':' + e.path);
      if (!f) { out.push({ v: e.v, path: e.path, deleted: true, hash: null, by: e.by }); continue; }
      const item = { v: e.v, path: e.path, hash: f.hash, by: e.by || f.by, binary: !!f.binary, size: f.size };
      if (f.len <= LIMITS.inlineChange && f.len <= budget) { budget -= f.len; inline.push([item, f]); } else item.large = true;
      out.push(item);
    }
    if (inline.length) {
      const keys = []; for (const [, f] of inline) keys.push(...this.chunkKeys(f.fid, f.n));
      const got = await this.getMany(keys);
      for (const [item, f] of inline) {
        const parts = this.chunkKeys(f.fid, f.n).map((k) => got.get(k));
        if (parts.some((p) => !p)) { item.large = true; continue; }
        const u = new Uint8Array(f.len); let o = 0; for (const p of parts) { const x = new Uint8Array(p); u.set(x, o); o += x.length; }
        item.content = utf8Decode(u);
      }
    }
    return json({ ok: true, version, changes: out, ...(full ? { full: true } : {}) });
  }

  /* ======================================================================
   * tokens
   * ==================================================================== */
  async tokenCreate(a, b) {
    const label = clip(b.label, 60) || 'agent';
    const scopes = cleanScopes(b.scopes);
    if (!scopes.length) return fail('bad_scopes', 400, { message: 'Pick at least one scope: read, write, deploy.' });
    const mine = await this.listAll('otok:' + a.owner + ':');
    if (mine.size >= LIMITS.tokensPerOwner) return fail('token_limit', 403, { message: 'You can have ' + LIMITS.tokensPerOwner + ' tokens — revoke one first.' });
    const token = newToken(), h = await hashToken(token);
    let id = newTokenId(); while (await this.st.get('tokid:' + id)) id = newTokenId();
    const rec = { id, owner: a.owner, label, scopes, ts: Date.now(), lastUsed: 0 };
    await this.st.put({ ['tokh:' + h]: rec, ['tokid:' + id]: h, ['otok:' + a.owner + ':' + id]: h });
    this.tokCache.set(h, rec);
    return json({ ok: true, token, id, label, scopes, ts: rec.ts });
  }
  async tokenList(a) {
    const idx = await this.listAll('otok:' + a.owner + ':');
    const got = await this.getMany([...idx.values()].map((h) => 'tokh:' + h));
    const tokens = [];
    for (const rec of got.values()) if (rec && rec.owner === a.owner) tokens.push({ id: rec.id, label: rec.label, scopes: rec.scopes, ts: rec.ts, lastUsed: rec.lastUsed || null });
    tokens.sort((x, y) => y.ts - x.ts);
    return json({ ok: true, tokens });
  }
  async tokenDelete(a, id) {
    if (!TOKEN_ID_RE.test(String(id))) return fail('token_not_found', 404);
    const h = await this.st.get('tokid:' + id);
    const rec = h ? await this.st.get('tokh:' + h) : null;
    if (!rec || rec.owner !== a.owner) return fail('token_not_found', 404);
    await this.st.delete(['tokh:' + h, 'tokid:' + id, 'otok:' + a.owner + ':' + id]);
    this.tokCache.delete(h);
    return json({ ok: true, revoked: id });
  }

  /* ======================================================================
   * deploys + app gallery
   * ==================================================================== */
  appUrl(slug) { return (this.env.STUDIO_APPS_BASE || APPS_BASE).replace(/\/+$/, '') + '/' + slug + '/'; }
  pubApp(m) {
    return { slug: m.slug, name: m.name, description: m.description, owner: m.owner, profile: m.profile || null, url: this.appUrl(m.slug), ts: m.ts, createdAt: m.createdAt, version: m.version, files: m.files, bytes: m.bytes, views: (m.views || 0) + (this.viewBuf.get(m.slug) || 0), projectId: m.projectId };
  }
  async appMeta(slug) {
    const c = this.appCache.get(slug);
    if (c) return c.meta;
    const meta = (await this.st.get('app:' + slug)) || null;
    if (this.appCache.size > 2000) this.appCache.clear();
    this.appCache.set(slug, { meta });
    return meta;
  }
  dropAppCache(slug) {
    this.appCache.delete(slug);
    for (const k of [...this.idxCache.keys()]) if (k.startsWith(slug + ':')) this.idxCache.delete(k);
    for (const [k, u] of [...this.byteCache]) if (k.startsWith(slug + ':')) { this.byteCache.delete(k); this.byteCacheSize -= u.length; }
  }

  async deploy(a, pid, b, loadPm) {
    const slug = String(b.slug || '').trim().toLowerCase();
    if (!SLUG_RE.test(slug)) return fail('bad_slug', 400, { message: 'Use 3–40 lowercase letters, digits and dashes (not at the ends).' });
    if (RESERVED_SLUGS.has(slug)) return fail('slug_reserved', 400, { message: '“' + slug + '” is reserved.' });
    // Best-effort owner profile from the directory — external I/O, so before taking the lock.
    let profile = null;
    try { const k = await this.meshKey(a.owner); if (k && k.profile) profile = { name: clip(k.profile.name, 32), emoji: clip(k.profile.emoji, 8) }; } catch (_) {}
    return this.locked(async () => {
      const pm = await loadPm(); if (!pm) return fail('project_not_found', 404);
      return this.deployLocked(a, pm, b, slug, profile);
    });
  }

  async deployLocked(a, pm, b, slug, profile) {
    const owner = await this.st.get('slugown:' + slug);
    if (owner && owner !== a.owner) return fail('slug_taken', 409);
    const app = await this.st.get('app:' + slug);
    if (app && app.owner !== a.owner) return fail('slug_taken', 409);
    if (!app) {
      const mine = await this.listAll('oapp:' + a.owner + ':');
      if (mine.size >= LIMITS.appsPerOwner) return fail('app_limit', 403, { message: 'You can publish ' + LIMITS.appsPerOwner + ' apps — unpublish one first.' });
    }

    // Collect files: explicit build output, or the project's files as they are.
    const files = [];                                // {path, bytes, mime}
    let total = 0;
    const addFile = (path, u8) => { files.push({ path, bytes: u8, mime: mimeOf(path) }); total += u8.length; };
    if (b.files != null) {
      if (typeof b.files !== 'object' || Array.isArray(b.files)) return fail('bad_files');
      const ents = Object.entries(b.files);
      if (ents.length > LIMITS.deployFiles) return fail('too_large', 413, { message: 'Deploys are limited to ' + LIMITS.deployFiles + ' files.' });
      const seen = new Set();
      for (const [p0, c] of ents) {
        const p = normPath(p0);
        if (!p) return fail('bad_path', 400, { message: 'Invalid file path: ' + String(p0).slice(0, 120) });
        if (seen.has(p)) return fail('bad_path', 400, { message: 'Duplicate path: ' + p });
        seen.add(p);
        if (typeof c !== 'string') return fail('bad_content', 400, { message: p + ': content must be a string (binary files as a data: URL).' });
        let u8;
        if (isBinaryContent(p, c)) { try { u8 = b64ToBytes(c.slice(c.indexOf(',') + 1).replace(/\s+/g, '')); } catch (_) { return fail('bad_content', 400, { message: p + ': invalid base64 data URL.' }); } }
        else u8 = enc.encode(c);
        if (u8.length > LIMITS.deployFileBytes) return fail('too_large', 413, { message: p + ' is over the ' + (LIMITS.deployFileBytes / MB) + ' MB per-file limit.' });
        addFile(p, u8);
        if (total > LIMITS.deployBytes) return fail('too_large', 413, { message: 'Deploys are limited to ' + (LIMITS.deployBytes / MB) + ' MB.' });
      }
    } else {
      const listed = await this.listAll('fm:' + pm.id + ':');
      const metas = [...listed.values()];
      if (metas.length > LIMITS.deployFiles) return fail('too_large', 413, { message: 'Deploys are limited to ' + LIMITS.deployFiles + ' files.' });
      for (const f of metas) {
        const c = await this.fileContent(f);
        let u8;
        if (f.binary) { try { u8 = b64ToBytes(c.slice(c.indexOf(',') + 1).replace(/\s+/g, '')); } catch (_) { u8 = enc.encode(c); } }
        else u8 = enc.encode(c);
        if (u8.length > LIMITS.deployFileBytes) return fail('too_large', 413, { message: f.path + ' is over the ' + (LIMITS.deployFileBytes / MB) + ' MB per-file limit.' });
        addFile(f.path, u8);
        if (total > LIMITS.deployBytes) return fail('too_large', 413, { message: 'Deploys are limited to ' + (LIMITS.deployBytes / MB) + ' MB.' });
      }
    }
    if (!files.some((f) => f.path === 'index.html')) return fail('no_index_html', 400, { message: 'An app needs an index.html at the project root.' });

    const now = Date.now();
    const ver = ((app && app.version) || 0) + 1;
    const vp = 'df:' + slug + ':' + ver + ':';
    await this.dropVersion(slug, ver);               // leftovers of an interrupted earlier attempt
    const written = [];
    try {
      for (const f of files) {
        const n = await this.writeChunks((i) => 'dc:' + slug + ':' + ver + ':' + f.path + ':' + pad3(i), f.bytes);
        const h = (await sha256Hex(f.bytes)).slice(0, 20);
        await this.st.put(vp + f.path, { path: f.path, size: f.bytes.length, mime: f.mime, n, h });
        written.push({ path: f.path, n });
      }
    } catch (e) {
      const del = []; for (const w of written) { del.push(vp + w.path); for (let i = 0; i < w.n; i++) del.push('dc:' + slug + ':' + ver + ':' + w.path + ':' + pad3(i)); }
      await this.delMany(del).catch(() => {});
      throw e;
    }

    const versions = [...((app && app.versions) || []), ver];
    const drop = versions.slice(0, Math.max(0, versions.length - LIMITS.keepVersions));
    const meta = {
      slug, owner: a.owner, by: a.by, projectId: pm.id,
      name: clip(b.name, 60) || (app && app.name) || pm.name || slug,
      description: b.description != null ? clip(b.description, 280) : ((app && app.description) || ''),
      profile: profile || (app && app.profile) || null,
      version: ver, versions: versions.slice(-LIMITS.keepVersions), files: files.length, bytes: total,
      ts: now, createdAt: (app && app.createdAt) || now, views: (app && app.views) || 0,
      galKey: 'gal:' + rev16(now) + ':' + slug
    };
    const puts = { ['app:' + slug]: meta, ['slugown:' + slug]: a.owner, ['oapp:' + a.owner + ':' + slug]: 1, [meta.galKey]: slug };
    if (app && app.galKey && app.galKey !== meta.galKey) await this.st.delete(app.galKey);
    await this.st.put(puts);
    this.dropAppCache(slug);
    for (const old of drop) await this.dropVersion(slug, old);
    return json({ ok: true, app: { slug, url: this.appUrl(slug), version: ver, files: files.length, bytes: total, name: meta.name } });
  }

  async dropVersion(slug, ver) {
    const listed = await this.listAll('df:' + slug + ':' + ver + ':');
    const del = [];
    for (const [k, f] of listed) { del.push(k); for (let i = 0; i < (f.n || 0); i++) del.push('dc:' + slug + ':' + ver + ':' + f.path + ':' + pad3(i)); }
    await this.delMany(del);
  }

  async appsList(url) {
    const ownerQ = url.searchParams.get('owner');
    if (ownerQ) {
      if (!validAddr(ownerQ)) return fail('bad_owner');
      const idx = await this.listAll('oapp:' + ownerQ + ':');
      const got = await this.getMany([...idx.keys()].map((k) => 'app:' + k.slice(('oapp:' + ownerQ + ':').length)));
      const apps = [...got.values()].filter((m) => m && m.owner === ownerQ).map((m) => this.pubApp(m)).sort((x, y) => y.ts - x.ts);
      return json({ ok: true, apps, cursor: null });
    }
    const limit = Math.max(1, Math.min(60, Math.floor(Number(url.searchParams.get('limit')) || 24)));
    const cursor = String(url.searchParams.get('cursor') || '');
    const opts = { prefix: 'gal:', limit: limit + 1 };
    if (/^gal:\d{16}:[a-z0-9-]{3,40}$/.test(cursor)) opts.startAfter = cursor;
    const listed = await this.st.list(opts);
    const keys = [...listed.keys()];
    const more = keys.length > limit;
    const page = keys.slice(0, limit);
    const metas = await this.getMany(page.map((k) => 'app:' + listed.get(k)));
    const apps = [];
    for (const k of page) { const m = metas.get('app:' + listed.get(k)); if (m && m.galKey === k) apps.push(this.pubApp(m)); }
    return json({ ok: true, apps, cursor: more ? page[page.length - 1] : null });
  }

  async appGet(slug) {
    if (!SLUG_RE.test(String(slug))) return fail('app_not_found', 404);
    const m = await this.appMeta(slug);
    if (!m) return fail('app_not_found', 404);
    const idx = await this.versionIndex(slug, m.version);
    const files = [...idx.values()].map((f) => ({ path: f.path, size: f.size, mime: f.mime })).sort((x, y) => (x.path < y.path ? -1 : 1));
    return json({ ok: true, app: { ...this.pubApp(m), files } });
  }

  async appUnpublish(a, slug) {
    if (!SLUG_RE.test(String(slug))) return fail('app_not_found', 404);
    const m = await this.st.get('app:' + slug);
    if (!m) return fail('app_not_found', 404);
    if (m.owner !== a.owner) return fail('not_your_app', 403);
    await this.flushViews().catch(() => {});
    await this.st.delete(['app:' + slug, 'oapp:' + a.owner + ':' + slug, m.galKey].filter(Boolean));
    this.dropAppCache(slug);
    this.viewBuf.delete(slug);
    for (const v of m.versions || [m.version]) await this.dropVersion(slug, v);
    return json({ ok: true, unpublished: slug });
  }

  /* ---------- serving ---------- */
  async versionIndex(slug, ver) {
    const key = slug + ':' + ver;
    let idx = this.idxCache.get(key);
    if (idx) return idx;
    const listed = await this.listAll('df:' + slug + ':' + ver + ':');
    idx = new Map(); for (const f of listed.values()) idx.set(f.path, f);
    if (this.idxCache.size > 500) this.idxCache.clear();
    this.idxCache.set(key, idx);
    return idx;
  }
  async fileBytes(slug, ver, f) {
    const key = slug + ':' + ver + ':' + f.path;
    const hit = this.byteCache.get(key);
    if (hit) { this.byteCache.delete(key); this.byteCache.set(key, hit); return hit; }
    const keys = []; for (let i = 0; i < f.n; i++) keys.push('dc:' + slug + ':' + ver + ':' + f.path + ':' + pad3(i));
    const u8 = await this.readChunks(keys, f.size);
    if (u8.length <= 512 * 1024) {
      this.byteCache.set(key, u8); this.byteCacheSize += u8.length;
      while (this.byteCacheSize > 24 * MB && this.byteCache.size) { const [k0, v0] = this.byteCache.entries().next().value; this.byteCache.delete(k0); this.byteCacheSize -= v0.length; }
    }
    return u8;
  }

  async serve(request, slug, rest) {
    const textRes = (status, text, extra = {}) => new Response(request.method === 'HEAD' ? null : text, { status, headers: this.serveHeaders({ 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...extra }) });
    if (!SLUG_RE.test(String(slug))) return textRes(404, 'App not found.');
    const m = await this.appMeta(slug);
    if (!m) return textRes(404, 'App not found.');
    if (rest == null) return new Response(null, { status: 301, headers: this.serveHeaders({ Location: './' + slug + '/' + new URL(request.url).search, 'Cache-Control': 'public, max-age=60' }) });
    const d = decodeServePath(rest == null ? '' : rest);
    if (d.error) return textRes(400, 'Bad path.');
    const idx = await this.versionIndex(slug, m.version);
    let f = idx.get(d.path);
    if (!f && !d.dirLike) {
      const last = d.path.split('/').pop();
      if (idx.has(d.path + '/index.html')) {
        // A folder without the trailing slash: redirect so relative URLs resolve inside it.
        const q = new URL(request.url).search;
        return new Response(null, { status: 301, headers: this.serveHeaders({ Location: './' + encodeURIComponent(last) + '/' + q, 'Cache-Control': 'public, max-age=60' }) });
      }
      if (!/\.[A-Za-z0-9]{1,8}$/.test(last)) f = idx.get('index.html');      // SPA fallback
    }
    if (!f) return textRes(404, 'Not found: /' + slug + '/' + d.path);
    const etag = '"' + m.version + '-' + f.h + '"';
    const headers = this.serveHeaders({ 'Content-Type': f.mime || mimeOf(f.path), 'Cache-Control': 'public, max-age=60', ETag: etag });
    if (f.path === 'index.html' && request.method === 'GET') this.countView(slug);
    const inm = request.headers.get('If-None-Match') || '';
    if (inm && inm.split(',').map((s) => s.trim().replace(/^W\//, '')).includes(etag)) return new Response(null, { status: 304, headers });
    if (request.method === 'HEAD') { headers['Content-Length'] = String(f.size); return new Response(null, { status: 200, headers }); }
    const u8 = await this.fileBytes(slug, m.version, f);
    return new Response(u8, { status: 200, headers });
  }
  serveHeaders(extra) {
    return {
      'Access-Control-Allow-Origin': '*',
      'X-Content-Type-Options': 'nosniff',
      // Always: an app served straight from the API origin must never run as that origin.
      // The ost-apps worker strips this and serves apps from their own origin.
      'Content-Security-Policy': 'sandbox allow-scripts allow-forms allow-popups allow-modals',
      ...extra
    };
  }

  /* ---------- view counter (batched, flushed by alarm) ---------- */
  countView(slug) {
    this.viewBuf.set(slug, (this.viewBuf.get(slug) || 0) + 1);
    const now = Date.now();
    if (this.alarmAt > now) return;
    this.alarmAt = now + 30_000;
    this.st.setAlarm(this.alarmAt).catch(() => { this.alarmAt = 0; });
  }
  async flushViews() {
    if (!this.viewBuf.size) return;
    const buf = this.viewBuf; this.viewBuf = new Map();
    const got = await this.getMany([...buf.keys()].map((s) => 'app:' + s));
    const puts = {};
    for (const [slug, n] of buf) { const m = got.get('app:' + slug); if (!m) continue; m.views = (m.views || 0) + n; puts['app:' + slug] = m; }
    if (Object.keys(puts).length) await this.putMany(puts);
    for (const slug of buf.keys()) { const c = this.appCache.get(slug); if (c && puts['app:' + slug]) c.meta = puts['app:' + slug]; }
  }
  async alarm() {
    this.alarmAt = 0;
    await this.flushViews();
    if (Math.random() < 0.5) await this.sweepNonces().catch(() => {});
  }

  /* ======================================================================
   * AI proxy
   * ==================================================================== */
  async aiChat(a, b) {
    const messages = sanitizeMessages(b.messages);
    if (!messages.some((m) => m.role === 'user')) return fail('no_messages');
    const tools = sanitizeTools(b.tools);

    // Rate limits: per owner (40 / 10 min) and a global daily cap — durable counters.
    const now = Date.now();
    const rk = 'airl:' + a.owner;
    let rl = (await this.st.get(rk)) || { at: now, n: 0 };
    if (now - rl.at > LIMITS.aiWindowMs) rl = { at: now, n: 0 };
    if (rl.n >= LIMITS.aiPerWindow) return fail('rate_limited', 429, { retryAfter: Math.ceil((rl.at + LIMITS.aiWindowMs - now) / 1000), message: 'AI limit reached (' + LIMITS.aiPerWindow + ' requests / 10 min). Try again shortly.' });
    const dk = 'aiday:' + new Date(now).toISOString().slice(0, 10);
    const day = Number(await this.st.get(dk)) || 0;
    if (day >= LIMITS.aiPerDay) return fail('ai_daily_limit', 429, { message: 'The shared AI budget for today is used up. It resets at 00:00 UTC.' });
    rl.n++;
    await this.st.put({ [rk]: rl, [dk]: day + 1 });

    const full = [{ role: 'system', content: SERVER_SYSTEM }, ...messages];
    const errors = [];
    if (this.env.GROQ_API_KEY) {
      for (const model of GROQ_MODELS) {
        try {
          const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 55_000);
          let r;
          try {
            r = await fetch(GROQ_URL, {
              method: 'POST', signal: ctl.signal,
              headers: { Authorization: 'Bearer ' + this.env.GROQ_API_KEY, 'Content-Type': 'application/json' },
              body: JSON.stringify({ model, messages: full, ...(tools.length ? { tools, tool_choice: 'auto' } : {}), temperature: 0.2, max_tokens: 4096 })
            });
          } finally { clearTimeout(timer); }
          const j = await r.json().catch(() => null);
          if (!r.ok || !j || !Array.isArray(j.choices) || !j.choices[0]) { errors.push(model + ': ' + ((j && j.error && (j.error.code || j.error.message)) || ('http_' + r.status))); continue; }
          return json({ ok: true, message: normalizeAiMessage(j), model, usage: j.usage || null });
        } catch (e) { errors.push(model + ': ' + String((e && e.message) || e).slice(0, 120)); }
      }
    } else errors.push('groq: not configured');
    if (this.env.AI && typeof this.env.AI.run === 'function') {
      try {
        const out = await this.env.AI.run(WORKERS_AI_MODEL, { messages: toWorkersAiMessages(full), ...(tools.length ? { tools } : {}), temperature: 0.2, max_tokens: 4096 });
        const message = normalizeAiMessage(out, tools.map((t) => t.function.name));
        if (message.content || message.tool_calls) return json({ ok: true, message, model: WORKERS_AI_MODEL });
        errors.push('workers-ai: empty reply');
      } catch (e) { errors.push('workers-ai: ' + String((e && e.message) || e).slice(0, 120)); }
    } else errors.push('workers-ai: not bound');
    return fail('ai_unavailable', 502, { message: 'The AI providers did not answer. Try again in a minute.', detail: errors.join(' | ').slice(0, 400) });
  }
}

/* Tiny test hook: the pure pieces, for node tests (no Durable Object runtime needed). */
export const __test = { LIMITS, RESERVED_SLUGS, validSlug, normPath, decodeServePath, dedupeChanges, sanitizeMessages, sanitizeTools, normalizeAiMessage, toWorkersAiMessages, hashToken, newToken, newTokenId, cleanScopes, isBinaryContent, contentSize, mimeOf, isTextPath, meshCanonical, sha256Hex };

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
    app:<slug>                     app meta (published apps only; vbytes = bytes per kept version)
    slugown:<slug>                 slug ownership: owner (published) or {o, until} — held for the owner
                                   for 30 days after unpublish, then anyone may claim it
    oslug:<owner>:<slug>           owner → held (unpublished) slug index, value = until
    oapp:<owner>:<slug>            owner → published app index
    gal:<rev ts>:<slug>            gallery index, newest first
    df:<slug>:<ver>:<path>         deployed file meta {path, size, mime, n, h}
    dc:<slug>:<ver>:<path>:<iii>   deployed file bytes, 512 KB chunks
    blocked:<slug> / banned:<owner> operator takedowns (no deploys; serving answers 451)
    usage:<owner> / usage:*        stored bytes (project files + kept deploy versions), per owner / total
    okey:<addr>                    pinned signing key {t: thumbprint, at} (legacy rows: the thumbprint)
    nx:<ts bucket>:<addr>:<nonce>  mesh-signature replay guard for state-changing requests (swept by range)
    report:<rev ts>:<slug> / repn  abuse reports (oldest dropped past LIMITS.reportsMax) / their count
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
  // Request bodies: every one is buffered in this single DO (128 MB isolate), so each route has
  // its own cap, bodies are read through a bounded reader, and all bodies in flight share a budget.
  bodyBytes: 16 * MB,          // POST /projects, /sync, /deploy
  fileBodyBytes: Math.ceil(1.5 * MB * 4 / 3) + 1024,   // PUT /file (a 1.5 MB file as a data URL)
  aiBodyBytes: 1.5 * MB,
  smallBodyBytes: 16 * 1024,   // tokens, PATCH, unpublish, report, admin
  bodyInflight: 32 * MB,       // all request bodies being read or handled at once
  bodyReadMs: 60 * 1000,
  jsonValues: 50000,           // JSON values per body (a parse of millions of tiny objects is an OOM)
  syncOps: 2000,
  planActions: 2000,           // file actions per request after folder expansion
  // Storage quotas (decoded bytes of project files + kept deploy versions).
  ownerBytes: 200 * MB,
  totalBytes: 3 * 1024 * MB,   // override with env STUDIO_MAX_BYTES
  slugClaimsPerOwner: 40,      // published + held slugs
  slugHoldMs: 30 * 24 * 3600 * 1000,
  reportsMax: 5000,
  reportsPerIpHour: 10,
  aiPerWindow: 40,
  aiWindowMs: 10 * 60 * 1000,
  aiPerDay: 400,
  aiPerOwnerDay: 100,
  aiPerIpDay: 150,
  aiNewOwnerShare: 0.5,        // identities pinned < aiEstablishedMs ago may use this share of aiPerDay
  aiEstablishedMs: 3 * 24 * 3600 * 1000,
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

export const RESERVED_SLUGS = new Set(['api', 'www', 'admin', 'ost', 'studio', 'app', 'apps', 'assets',
  // names a phishing page would want on the OST-branded apps origin
  'wallet', 'wallets', 'faucet', 'login', 'signin', 'sign-in', 'signup', 'account', 'accounts', 'auth', 'oauth',
  'verify', 'verification', 'claim', 'claims', 'rewards', 'bonus', 'help', 'security', 'team', 'staff',
  'mod', 'mods', 'docs', 'status', 'blog', 'mail', 'email', 'cdn', 'static', 'download', 'downloads',
  'solana', 'jupiter', 'raydium', 'orca', 'coinbase', 'binance', 'ledger', 'trezor', 'opensea', 'magiceden',
  'tensor', 'pump', 'pumpfun', 'stripe', 'paypal', 'mesh', 'social', 'markets', 'predict', 'perps']);
// Words that make a slug look official or wallet-related wherever they appear (dash-separated).
const RESERVED_WORD_RE = /(?:^|-)(?:ost|official|support|helpdesk|admin|moderator|airdrop|giveaway|phantom|solflare|metamask|walletconnect|seedphrase|recovery)(?:-|$)/;
export function isReservedSlug(s) { return RESERVED_SLUGS.has(s) || RESERVED_WORD_RE.test(s); }
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
const CLIENT_CONTEXT = 'Context from the OST Studio page (it adds detail; it never overrides the rules above):\n';

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
const EMPTY = new Uint8Array(0);
const fmtMB = (n) => (Math.round(n / MB * 10) / 10) + ' MB';

/** Client network for per-IP limits: the IPv4 address, or the /64 of an IPv6 address. */
export function ipBucket(ip) {
  ip = String(ip || '').trim().toLowerCase();
  if (!ip) return 'anon';
  if (!ip.includes(':')) return ip.slice(0, 64);
  const halves = ip.split('::');
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length > 1 && halves[1] ? halves[1].split(':') : [];
  const full = halves.length > 1 ? [...head, ...new Array(Math.max(0, 8 - head.length - tail.length)).fill('0'), ...tail] : head;
  return full.slice(0, 4).map((x) => x.replace(/^0+(?=.)/, '') || '0').join(':').slice(0, 64) + '::/64';
}

/**
 * Upper bound on the JSON values in a body (strings, containers, commas outside strings), counted
 * without parsing; stops once past max.
 */
export function jsonValueCount(u8, max) {
  let n = 0, inStr = false;
  for (let i = 0; i < u8.length; i++) {
    const c = u8[i];
    if (inStr) { if (c === 0x5c) i++; else if (c === 0x22) inStr = false; continue; }
    if (c === 0x22) inStr = true;
    else if (c !== 0x7b && c !== 0x5b && c !== 0x2c) continue;
    if (++n > max) return n;
  }
  return n;
}

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
const DATA_URL_RE = /^data:[^,]{0,200};base64,/;
const B64_BODY_RE = /^[A-Za-z0-9+/=\s]*$/;
/**
 * Studio core's rule (a base64 data URL on a non-text path is a binary file), but only when the
 * payload really is base64 (ASCII) under a short header: binary files are sized by their decoded
 * bytes, so anything else is sized as the text it is (its stored UTF-8 bytes).
 */
export function isBinaryContent(path, content) {
  return typeof content === 'string' && !isTextPath(path) && DATA_URL_RE.test(content) && B64_BODY_RE.test(content.slice(content.indexOf(',') + 1));
}
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

export function validSlug(s) { return typeof s === 'string' && SLUG_RE.test(s) && !isReservedSlug(s); }

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
const NONCE_BUCKET_MS = 60 * 1000;      // nx: rows are keyed by the signed ts's minute, so expired ones sort first
const MEM_NONCES_MAX = 20000;
const RATE_KEYS_MAX = 20000;
const nonceKey = (addr, ts, nonce) => 'nx:' + String(Math.floor(ts / NONCE_BUCKET_MS)).padStart(10, '0') + ':' + addr + ':' + nonce;

/** Mesh signature headers → { ok, addr, ts, nonce, sig } | { ok:false, error, status }. Shape checks only. */
function meshHeaders(request) {
  const h = (n) => request.headers.get(n) || '';
  const addr = h('x-mesh-addr'), ts = Number(h('x-mesh-ts')), nonce = h('x-mesh-nonce'), sig = h('x-mesh-sig');
  if (!addr || !sig || !nonce || !Number.isFinite(ts)) return { ok: false, error: 'auth_required', status: 401 };
  if (!validAddr(addr)) return { ok: false, error: 'mesh_auth_bad_addr', status: 401 };
  if (Math.abs(Date.now() - ts) > MESH_AUTH_WINDOW_MS) return { ok: false, error: 'mesh_auth_stale', status: 401 };
  if (!/^[0-9a-f]{16,64}$/i.test(nonce)) return { ok: false, error: 'mesh_auth_bad_nonce', status: 401 };
  return { ok: true, addr, ts, nonce, sig };
}
function denied(a) { return fail(a.error, a.status || 401, a.need ? { need: a.need } : a.retryAfter ? { retryAfter: a.retryAfter } : (a.message ? { message: a.message } : {})); }

/** Token scope a body-carrying route needs (checked before its body is read); '' = no such route. */
function scopeFor(method, seg) {
  const s0 = seg[0] || '';
  if (s0 === 'tokens') return 'mesh';
  if (s0 === 'ai') return seg[1] === 'chat' && seg.length === 2 && method === 'POST' ? 'read' : '';
  if (s0 === 'apps') return seg.length === 3 && seg[2] === 'unpublish' && method === 'POST' ? 'deploy' : '';
  if (s0 === 'projects') return seg[2] === 'deploy' ? 'deploy' : 'write';
  return '';
}
/** Largest body each route accepts. */
function bodyCap(method, seg) {
  const s0 = seg[0] || '';
  if (s0 === 'ai') return LIMITS.aiBodyBytes;
  if (s0 === 'projects') {
    if (seg.length === 1 || seg[2] === 'sync' || seg[2] === 'deploy') return LIMITS.bodyBytes;
    if (seg[2] === 'file' && method === 'PUT') return LIMITS.fileBodyBytes;
  }
  return LIMITS.smallBodyBytes;
}
/** Bytes an app's kept versions hold (vbytes per version; older metas: current size × versions). */
function appStoredBytes(m) {
  if (!m) return 0;
  const vs = Array.isArray(m.versions) && m.versions.length ? m.versions : [m.version];
  let n = 0;
  for (const v of vs) n += Number((m.vbytes && m.vbytes[v]) != null ? m.vbytes[v] : m.bytes) || 0;
  return n;
}
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
    console.error('studio_hub_unavailable', (e && e.stack) || e);
    return fail('studio_hub_unavailable', 503);
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
    this.rl = new Map();           // kind:owner → {at, n, w}   (verified owners only)
    this.iprl = new Map();         // kind:network → {at, n, w} (anonymous callers; never evicts owner budgets)
    this.bodyInflight = 0;         // request-body bytes buffered right now
    this.blockCache = new Map();   // slug → blocked?
    this.galCache = new Map();     // gallery first page by limit → {at, body}
    this.repN = null;              // report row count (lazy)
  }

  /** In-memory fixed-window limiter → 0 when allowed, else seconds until the window resets. */
  rate(kind, owner, limit, windowMs) { return this._hit(this.rl, kind + ':' + owner, limit, windowMs); }
  /** Same, keyed by client network (ipBucket) in its own table. */
  ipRate(kind, key, limit, windowMs) { return this._hit(this.iprl, kind + ':' + key, limit, windowMs); }
  _hit(map, k, limit, windowMs) {
    const now = Date.now();
    let e = map.get(k);
    if (!e || now - e.at > windowMs) {
      if (map.size >= RATE_KEYS_MAX) {
        // Full: drop finished windows, then the oldest ones (insertion order = window start) — never all.
        for (const [key, x] of map) if (now - x.at > x.w) map.delete(key);
        for (const key of map.keys()) { if (map.size < RATE_KEYS_MAX * 0.75) break; map.delete(key); }
      }
      e = { at: now, n: 0, w: windowMs }; map.delete(k); map.set(k, e);
    }
    return ++e.n > limit ? Math.max(1, Math.ceil((e.at + windowMs - now) / 1000)) : 0;
  }

  /**
   * Read a request body of at most `cap` bytes (Content-Length is checked first, the stream is
   * counted as it arrives — chunked bodies included), within LIMITS.bodyReadMs, and only while
   * all bodies in flight stay under LIMITS.bodyInflight. → { bytes, held } | { error, status }.
   * The caller gives `held` back (this.bodyInflight -= held) once the request is answered.
   */
  async readBody(request, cap) {
    const declared = request.headers.get('Content-Length');
    if (declared && Number(declared) > cap) return { error: 'too_large', status: 413 };
    if (!request.body) return { bytes: EMPTY, held: 0 };
    const reader = request.body.getReader();
    const parts = [], deadline = Date.now() + LIMITS.bodyReadMs;
    let got = 0, timer = null;
    const stop = (code) => { const e = new Error(code); e.code = code; return e; };
    try {
      for (;;) {
        const left = deadline - Date.now();
        if (left <= 0) throw stop('body_timeout');
        const step = await Promise.race([reader.read(), new Promise((_, rej) => { timer = setTimeout(() => rej(stop('body_timeout')), left); })]);
        clearTimeout(timer);
        if (step.done) break;
        const u = step.value instanceof Uint8Array ? step.value : new Uint8Array(step.value);
        got += u.length; this.bodyInflight += u.length;
        if (got > cap) throw stop('too_large');
        if (this.bodyInflight > LIMITS.bodyInflight) throw stop('busy');
        parts.push(u);
      }
    } catch (e) {
      clearTimeout(timer);
      try { reader.cancel().catch(() => {}); } catch (_) {}
      this.bodyInflight -= got;
      const code = e && e.code;
      if (code === 'too_large') return { error: 'too_large', status: 413 };
      if (code === 'busy') return { error: 'busy', status: 503 };
      if (code === 'body_timeout') return { error: 'body_timeout', status: 408 };
      return { error: 'bad_body', status: 400 };
    }
    if (parts.length === 1) return { bytes: parts[0], held: got };
    const bytes = new Uint8Array(got); let o = 0;
    for (const p of parts) { bytes.set(p, o); o += p.length; }
    return { bytes, held: got };
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

  /**
   * Returns { ok:true, addr, pinnedAt } or { ok:false, error, status }. Never throws.
   * gate(addr) (optional) runs once the signature is good and the request is not a replay, BEFORE
   * the replay row is written: → 0, or seconds to wait (the request is then refused as rate_limited),
   * so an over-budget caller costs no durable write.
   */
  async verifyMesh(request, url, bodyBytes, gate) {
    try {
      const hd = meshHeaders(request);
      if (!hd.ok) return hd;
      const { addr, ts, nonce, sig } = hd;
      let rec;
      try { rec = await this.meshKey(addr); } catch (_) { return { ok: false, error: 'directory_unavailable', status: 503 }; }
      if (!rec) return { ok: false, error: 'mesh_identity_unknown', status: 401 };   // client announces + retries
      const bodyHash = await sha256Hex(bodyBytes || EMPTY);
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
      // signed for an address and refuses any other. The pin time tells new identities apart.
      if (rec.pinned !== true) {
        const pk = 'okey:' + addr, pinned = await this.st.get(pk);
        if (!pinned) { rec.pinnedAt = Date.now(); await this.st.put(pk, { t: rec.thumb, at: rec.pinnedAt }); }
        else if ((typeof pinned === 'string' ? pinned : pinned.t) !== rec.thumb) return { ok: false, error: 'identity_key_changed', status: 403 };
        else rec.pinnedAt = typeof pinned === 'string' ? 0 : Number(pinned.at) || 0;   // 0 = pinned before pin times were kept
        rec.pinned = true;
      }
      // Replay guard. State-changing requests: durable (survives eviction). Reads: in memory —
      // Studio polls /changes every few seconds per open tab, and a durable row per poll would
      // burn the Durable Object row-write quota; a replayed read only returns what the signer saw.
      const nk = nonceKey(addr, ts, nonce);
      const read = request.method === 'GET' || request.method === 'HEAD';
      const replay = { ok: false, error: 'mesh_auth_replay', status: 401 };
      if (this.memNonces.has(nk)) return replay;
      if (!read && await this.st.get(nk)) return replay;
      if (this.memNonces.has(nk)) return replay;          // a concurrent copy got here first
      const wait = gate ? gate(addr) : 0;
      if (wait) return { ok: false, error: 'rate_limited', status: 429, retryAfter: wait };
      this.rememberNonce(nk);
      if (!read) {
        await this.st.put(nk, 1);
        if (Math.random() < 0.03) this.sweepNonces().catch(() => {});
      }
      return { ok: true, addr, pinnedAt: rec.pinnedAt || 0 };
    } catch (e) { return { ok: false, error: 'mesh_auth_error', status: 401 }; }
  }
  rememberNonce(nk) {
    const now = Date.now();
    this.memNonces.set(nk, now + 2 * MESH_AUTH_WINDOW_MS);
    if (this.memNonces.size <= MEM_NONCES_MAX) return;
    // Insertion order = expiry order: drop the expired head, then (still full) the oldest live
    // entries — never everything at once.
    for (const [k, exp] of this.memNonces) { if (exp > now) break; this.memNonces.delete(k); }
    for (const k of this.memNonces.keys()) { if (this.memNonces.size <= MEM_NONCES_MAX) break; this.memNonces.delete(k); }
  }
  async sweepNonces() {
    // nx: rows sort by the signed ts's minute, so every row before the cutoff has expired
    // (a ts is accepted for MESH_AUTH_WINDOW_MS after it).
    const cutoff = Math.floor((Date.now() - MESH_AUTH_WINDOW_MS) / NONCE_BUCKET_MS) - 1;
    const listed = await this.st.list({ start: 'nx:', end: 'nx:' + String(cutoff).padStart(10, '0'), limit: 1000 });
    if (listed.size) await this.delMany([...listed.keys()]);
    // Rows from before the bucketed keys ('nonce:<addr>:<nonce>' → exp) are no longer written: drain them.
    const now = Date.now(), old = await this.st.list({ prefix: 'nonce:', limit: 256 }), del = [];
    for (const [k, exp] of old) if (Number(exp) <= now) del.push(k);
    if (del.length) await this.delMany(del);
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
  /** Bearer header → { ok:true, t } | { ok:false, error, status } (no writes). */
  async bearer(authz, need) {
    const m = /^Bearer\s+(\S+)\s*$/i.exec(authz);
    if (!m) return { ok: false, error: 'bad_authorization', status: 401 };
    if (need === 'mesh') return { ok: false, error: 'mesh_auth_only', status: 403, message: 'Tokens cannot manage tokens — use OST Studio.' };
    if (!TOKEN_RE.test(m[1])) return { ok: false, error: 'invalid_token', status: 401 };
    const t = await this.tokenRecord(m[1]);
    if (!t) return { ok: false, error: 'invalid_token', status: 401 };
    if (!t.rec.scopes.includes(need)) return { ok: false, error: 'insufficient_scope', status: 403, need };
    return { ok: true, t };
  }

  /**
   * Resolve the caller. need: 'read'|'write'|'deploy' (token scope) or 'mesh' (mesh signature only).
   * gate: see verifyMesh (token callers are gated by the router after this returns).
   * → { ok:true, owner, by, kind:'mesh'|'token', scopes, pinnedAt? } | { ok:false, error, status }
   */
  async auth(request, url, bodyBytes, need, gate) {
    const authz = request.headers.get('Authorization') || '';
    if (authz) {
      const b = await this.bearer(authz, need);
      if (!b.ok) return b;
      const t = b.t, now = Date.now();
      if (now - (t.rec.lastUsed || 0) > 5 * 60 * 1000) { t.rec.lastUsed = now; await this.st.put('tokh:' + t.h, t.rec); }
      return { ok: true, owner: t.rec.owner, by: t.rec.id, kind: 'token', scopes: t.rec.scopes.slice() };
    }
    const v = await this.verifyMesh(request, url, bodyBytes, gate);
    if (!v.ok) return v;
    return { ok: true, owner: v.addr, by: v.addr, kind: 'mesh', scopes: SCOPES.slice(), pinnedAt: v.pinnedAt };
  }

  /**
   * The checks that do not need the body, run before a body is read: a valid token with the
   * scope, or well-formed, fresh mesh headers from an address the directory knows.
   */
  async preAuth(request, need) {
    const authz = request.headers.get('Authorization') || '';
    if (authz) { const b = await this.bearer(authz, need); return b.ok ? { ok: true } : b; }
    const hd = meshHeaders(request);
    if (!hd.ok) return hd;
    let rec;
    try { rec = await this.meshKey(hd.addr); } catch (_) { return { ok: false, error: 'directory_unavailable', status: 503 }; }
    return rec ? { ok: true } : { ok: false, error: 'mesh_identity_unknown', status: 401 };
  }

  /* ---------- router ---------- */
  async fetch(request) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors() });
    try {
      return await this.route(request, new URL(request.url));
    } catch (e) {
      const requestId = rhex(6);
      console.error('studio_error', requestId, (e && e.stack) || e);
      return fail('studio_error', 500, { requestId });
    }
  }

  async route(request, url) {
    const method = request.method;
    const raw = url.pathname;
    if (!raw.startsWith('/studio/v1/')) return fail('not_found', 404);
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
    if (method === 'GET' || method === 'HEAD') return this.routeAuthed(request, url, seg, EMPTY);

    // A body comes next. Refuse whatever can be refused without it, then read it bounded
    // (bytes are what was signed).
    if (s0 === 'apps' && seg.length === 3 && seg[2] === 'report' && method === 'POST') {
      if (!SLUG_RE.test(String(seg[1]))) return fail('app_not_found', 404);
      const wait = this.ipRate('rep', ipBucket(request.headers.get('CF-Connecting-IP')), LIMITS.reportsPerIpHour, 3600_000);
      if (wait) return fail('rate_limited', 429, { retryAfter: wait });
    } else if (!(s0 === 'admin' && seg.length === 1 && method === 'POST')) {
      const scope = scopeFor(method, seg);
      if (!scope) return fail('not_found', 404);
      const pre = await this.preAuth(request, scope);
      if (!pre.ok) return denied(pre);
    }
    const cap = bodyCap(method, seg);
    const got = await this.readBody(request, cap);
    if (got.error) {
      if (got.error === 'too_large') return fail('too_large', 413, { message: 'Request body is over ' + fmtMB(cap) + '.' });
      if (got.error === 'busy') return fail('busy', 503, { retryAfter: 5, message: 'OST Studio is busy — try again in a few seconds.' });
      return fail(got.error, got.status);
    }
    try {
      return await this.routeAuthed(request, url, seg, got.bytes);
    } finally {
      this.bodyInflight -= got.held;
    }
  }

  async routeAuthed(request, url, seg, bytes) {
    const method = request.method;
    const s0 = seg[0] || '';
    const ip = ipBucket(request.headers.get('CF-Connecting-IP'));
    let parsed;
    const body = () => {
      if (parsed !== undefined) return parsed;
      parsed = null;
      if (!bytes.length) parsed = {};
      else if (bytes.length <= 256 * 1024 || jsonValueCount(bytes, LIMITS.jsonValues) <= LIMITS.jsonValues) {
        try { const v = JSON.parse(utf8Decode(bytes)); parsed = v && typeof v === 'object' ? v : null; } catch (_) { parsed = null; }
      }
      bytes = EMPTY;                                 // auth already hashed it; only the parsed copy is needed now
      return parsed;
    };
    const need = async (scope) => {
      const read = method === 'GET';
      // Per-owner request budgets — checked before the replay row is written.
      const gate = (owner) => {
        let wait = this.rate(read ? 'r' : 'w', owner, read ? LIMITS.readsPerWindow : LIMITS.writesPerWindow, LIMITS.reqWindowMs);
        if (!wait && scope === 'deploy') wait = this.rate('d', owner, LIMITS.deploysPerHour, 3600_000);
        return wait;
      };
      const a = await this.auth(request, url, bytes, scope, gate);
      if (!a.ok) return a;
      if (a.kind === 'token') { const wait = gate(a.owner); if (wait) return { ok: false, error: 'rate_limited', status: 429, retryAfter: wait }; }
      a.ip = ip;
      return a;
    };

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
      const a = await need('read'); if (!a.ok) return denied(a);
      const b = body(); if (!b) return fail('bad_json');
      return this.aiChat(a, b);
    }

    // ── reports (anyone; rate limited per network before the body was read) — feeds operator moderation ──
    if (s0 === 'apps' && seg.length === 3 && seg[2] === 'report' && method === 'POST') {
      const slug = seg[1];
      if (!(await this.appMeta(slug))) return fail('app_not_found', 404);
      // One row per app per network per day.
      if (this.ipRate('repd', slug + '|' + ip, 1, 24 * 3600_000)) return json({ ok: true, reported: slug });
      // The reporter is named only when the request carries a valid mesh signature.
      let by = '';
      if (request.headers.get('x-mesh-addr')) {
        const v = await this.verifyMesh(request, url, bytes, (o) => this.rate('w', o, LIMITS.writesPerWindow, LIMITS.reqWindowMs));
        if (v.ok) by = v.addr;
      }
      const b = body() || {};
      const reason = ['scam', 'impersonation', 'malware', 'abuse', 'other'].includes(b.reason) ? b.reason : 'other';
      const ts = Date.now();
      if (this.repN == null) this.repN = Number(await this.st.get('repn')) || 0;
      this.repN++;
      await this.st.put({ ['report:' + rev16(ts) + ':' + slug]: { slug, reason, note: String(b.note || '').slice(0, 300), ts, by, ipHash: (await sha256Hex(ip)).slice(0, 16) }, repn: this.repN });
      if (this.repN > LIMITS.reportsMax) {                 // keep the newest reportsMax: drop the oldest
        const old = await this.st.list({ prefix: 'report:', reverse: true, limit: 64 });
        if (old.size) { await this.delMany([...old.keys()]); this.repN = Math.max(0, this.repN - old.size); await this.st.put('repn', this.repN); }
      }
      return json({ ok: true, reported: slug });
    }
    // ── operator moderation (worker secret SOCIAL_ADMIN_KEY or MESH_ADMIN_KEY) ──
    if (s0 === 'admin' && seg.length === 1 && method === 'POST') {
      const b = body() || {};
      const keys = [this.env.SOCIAL_ADMIN_KEY, this.env.MESH_ADMIN_KEY].filter(Boolean);
      if (!keys.length || !keys.includes(b.key)) return fail('unauthorized', 403);
      return this.admin(b);
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

  /* ---------- operator moderation ---------- */
  async admin(b) {
    const slug = String(b.slug || '');
    const action = String(b.action || '');
    if (action === 'reports') {
      const listed = await this.st.list({ prefix: 'report:', limit: Math.min(200, Number(b.limit) || 100) });
      return json({ ok: true, reports: [...listed.values()] });
    }
    if (action === 'unpublish' || action === 'block') {
      // A takedown also blocks the slug (no redeploy by anyone; serving answers 451) unless block:false.
      if (!SLUG_RE.test(slug)) return fail('bad_slug');
      const block = action === 'block' || b.block !== false;
      return this.locked(async () => {
        const m = await this.st.get('app:' + slug);
        if (!m && action === 'unpublish') return fail('app_not_found', 404);
        if (block) { await this.st.put('blocked:' + slug, { ts: Date.now(), note: String(b.note || '').slice(0, 300) }); this.blockCache.delete(slug); }
        if (m) await this.takeDown(m, slug);
        return json({ ok: true, unpublished: m ? slug : null, blocked: block ? slug : null });
      });
    }
    if (action === 'unblock') {
      if (!SLUG_RE.test(slug)) return fail('bad_slug');
      await this.st.delete('blocked:' + slug); this.blockCache.delete(slug);
      return json({ ok: true, unblocked: slug });
    }
    if (action === 'release') {
      // Free a held or squatted slug (it must not be published).
      if (!SLUG_RE.test(slug)) return fail('bad_slug');
      return this.locked(async () => {
        if (await this.st.get('app:' + slug)) return fail('app_published', 409, { message: 'Unpublish the app first.' });
        const so = await this.st.get('slugown:' + slug);
        const holder = typeof so === 'string' ? so : so && so.o;
        await this.st.delete(['slugown:' + slug, ...(holder ? ['oslug:' + holder + ':' + slug] : [])]);
        return json({ ok: true, released: slug, holder: holder || null });
      });
    }
    if (action === 'ban' || action === 'unban') {
      // A banned owner cannot deploy (existing apps: unpublish/block them separately).
      const owner = String(b.owner || '');
      if (!validAddr(owner)) return fail('bad_owner');
      if (action === 'ban') await this.st.put('banned:' + owner, { ts: Date.now(), note: String(b.note || '').slice(0, 300) });
      else await this.st.delete('banned:' + owner);
      return json({ ok: true, owner, banned: action === 'ban' });
    }
    return fail('bad_action');
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
    if (b.files != null && (typeof b.files !== 'object' || Array.isArray(b.files))) return fail('bad_files');
    const ops = [];
    for (const [p, c] of Object.entries(b.files || {})) ops.push({ op: 'put', path: p, content: c });
    b.files = null;                                  // plan() drops each string once encoded
    if (ops.length > LIMITS.filesPerProject) return fail('too_large', 413, { message: 'Projects are limited to ' + LIMITS.filesPerProject + ' files.' });

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

    const plan = await this.plan(pm, ops);
    if (plan.error) return fail(plan.error, plan.status || 400, plan.message ? { message: plan.message } : {});
    const q = await this.quota(a.owner, plan.bytes - (pm.bytes || 0));
    if (q.error) return q.error;
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
    const u = await this.usage(pm.owner);
    const fms = await this.listAll('fm:' + pm.id + ':');
    const del = [];
    for (const [k, f] of fms) { del.push(k); del.push(...this.chunkKeys(f.fid, f.n)); }
    for (;;) {
      const chg = await this.st.list({ prefix: 'chg:' + pm.id + ':', limit: 1000 });
      if (!chg.size) break;
      await this.delMany([...chg.keys()]);
      if (chg.size < 1000) break;
    }
    await this.delMany(del);
    // One atomic batch (no await in between): the project rows go and the owner's usage drops.
    const p1 = this.st.delete(['proj:' + pm.id, 'oproj:' + pm.owner + ':' + pm.id]);
    const p2 = this.st.put(this.usageEntries(pm.owner, u, -(pm.bytes || 0)));
    await Promise.all([p1, p2]);
    return json({ ok: true, deleted: pm.id });
  }

  /**
   * Every file with its content, streamed one file at a time so a 25 MB project never sits in
   * memory as a whole. A file rewritten while the export runs is sent as it is now (its newer
   * change also reaches the client through /changes); one deleted meanwhile is left out.
   */
  async projectExport(pm) {
    const listed = await this.listAll('fm:' + pm.id + ':');
    const metas = [...listed.values()].sort((x, y) => (x.path < y.path ? -1 : 1));
    const head = JSON.stringify({ ok: true, project: this.pub(pm), version: pm.version });
    let i = -1, sent = 0;
    const stream = new ReadableStream({
      pull: async (ctl) => {
        try {
          if (i < 0) { i = 0; ctl.enqueue(enc.encode(head.slice(0, -1) + ',"files":[')); return; }
          while (i < metas.length) {
            let f = metas[i++], u = null;
            try { u = await this.readChunks(this.chunkKeys(f.fid, f.n), f.len); }
            catch (_) {
              f = await this.st.get('fm:' + pm.id + ':' + f.path);
              if (f) { try { u = await this.readChunks(this.chunkKeys(f.fid, f.n), f.len); } catch (_) { u = null; } }
            }
            if (!u) continue;
            const item = { path: f.path, content: utf8Decode(u), hash: f.hash, binary: !!f.binary, mtime: f.mtime, size: f.size };
            ctl.enqueue(enc.encode((sent++ ? ',' : '') + JSON.stringify(item)));
            return;
          }
          ctl.enqueue(enc.encode(']}'));
          ctl.close();
        } catch (e) { ctl.error(e); }
      }
    });
    return new Response(stream, { status: 200, headers: cors({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }) });
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
    const q = await this.quota(a.owner, plan.bytes - (pm.bytes || 0));
    if (q.error) return q.error;
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
    // Count before building anything (an op list can be huge for its byte size).
    const nPut = b.put != null && typeof b.put === 'object' && !Array.isArray(b.put) ? Object.keys(b.put).length : 0;
    if ((Array.isArray(b.rename) ? b.rename.length : 0) + (Array.isArray(b.del) ? b.del.length : 0) + nPut > LIMITS.syncOps) return fail('too_large', 413, { message: 'Too many operations in one sync.' });
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
      b.put = null;                                  // plan() drops each string once encoded
    }
    const plan = await this.plan(pm, ops);
    if (plan.error) return fail(plan.error, plan.status || 400, plan.message ? { message: plan.message } : {});
    const q = await this.quota(a.owner, plan.bytes - (pm.bytes || 0));
    if (q.error) return q.error;
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
    let stored = null;                               // every stored path, listed once per plan
    const under = async (prefix) => {                // existing paths strictly under prefix/
      if (!stored) { stored = []; for (const f of (await this.listAll('fm:' + pid + ':')).values()) stored.push(f.path); }
      const pre = prefix + '/', set = new Set();
      for (const p of stored) if (p.startsWith(pre) && !overlay.has(p)) set.add(p);
      for (const [p, f] of overlay) if (f && p.startsWith(pre)) set.add(p);
      return [...set].sort();
    };
    let files = pm.files || 0, bytes = pm.bytes || 0;
    const actions = [];
    const err = (error, message, status = 400) => ({ error, message, status });
    // Folder deletes/renames expand to one action per file: bound the expanded total.
    const tooMany = (n) => actions.length + n > LIMITS.planActions;
    const tooManyErr = () => err('too_large', 'Too many file changes in one request (at most ' + LIMITS.planActions + ').', 413);
    for (const o of ops) {
      if (o.op === 'put') {
        const p = normPath(o.path);
        if (!p) return err('bad_path', 'Invalid file path: ' + String(o.path).slice(0, 120));
        if (typeof o.content !== 'string') return err('bad_content', p + ': content must be a string (binary files as a data: URL).');
        if (tooMany(1)) return tooManyErr();
        const encd = enc.encode(o.content);
        const binary = isBinaryContent(p, o.content);
        const size = contentSize(o.content, binary, encd.length);
        o.content = null;                            // only the encoded bytes are kept
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
        if (tooMany(targets.length)) return tooManyErr();
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
        if (tooMany(moves.length)) return tooManyErr();
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
        const fid = rhex(8), e = act.encd;
        const n = Math.ceil(e.length / CHUNK);
        if (n === 1 && e.byteOffset === 0 && e.byteLength === e.buffer.byteLength) w.set('fc:' + fid + ':000', e.buffer);   // no copy
        else for (let i = 0; i < n; i++) w.set('fc:' + fid + ':' + pad3(i), e.slice(i * CHUNK, (i + 1) * CHUNK).buffer);
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
    const delta = plan.bytes - (pm.bytes || 0);
    const u = delta ? await this.usage(pm.owner) : null;
    pm.version = v; pm.files = plan.files; pm.bytes = plan.bytes; pm.updatedAt = now; pm.updatedBy = by;
    const dels = [], puts = {};
    for (const [k, val] of w) { if (val === DEL) dels.push(k); else puts[k] = val; }
    await this.delMany(dels);
    await this.putMany(puts);
    // The project meta last, in one put with the owner's usage counter.
    await this.st.put({ ['proj:' + pid]: pm, ...(u ? this.usageEntries(pm.owner, u, delta) : {}) });
    return count;
  }
  _fidStillUsed(fid, live) { for (const f of live.values()) if (f && f.fid === fid) return true; return false; }

  /* ---------- storage quotas: usage:<owner> and usage:* (decoded bytes) ----------
   * Kept up to date in the same atomic put as the rows they count (project meta, app meta);
   * called under this.locked(). An owner's row is built from its projects/apps on first use. */
  maxTotal() { const v = Number(this.env.STUDIO_MAX_BYTES); return v > 0 ? v : LIMITS.totalBytes; }
  async usage(owner) {
    const got = await this.st.get(['usage:' + owner, 'usage:*']);
    const total = Number(got.get('usage:*')) || 0;
    if (got.has('usage:' + owner)) return { mine: Number(got.get('usage:' + owner)) || 0, total };
    const mine = await this.recountOwner(owner);
    const u = { mine, total: total + mine };
    await this.st.put({ ['usage:' + owner]: u.mine, 'usage:*': u.total });
    return u;
  }
  usageEntries(owner, u, delta) {
    u.mine = Math.max(0, u.mine + delta); u.total = Math.max(0, u.total + delta);
    return { ['usage:' + owner]: u.mine, 'usage:*': u.total };
  }
  async recountOwner(owner) {
    let n = 0;
    const pfx = 'oproj:' + owner + ':', apfx = 'oapp:' + owner + ':';
    const projs = await this.getMany([...(await this.listAll(pfx)).keys()].map((k) => 'proj:' + k.slice(pfx.length)));
    for (const m of projs.values()) if (m && m.owner === owner) n += Number(m.bytes) || 0;
    const apps = await this.getMany([...(await this.listAll(apfx)).keys()].map((k) => 'app:' + k.slice(apfx.length)));
    for (const m of apps.values()) if (m && m.owner === owner) n += appStoredBytes(m);
    return n;
  }
  /** May `owner` store `delta` more bytes? → { u } | { error: Response }. */
  async quota(owner, delta) {
    if (!(delta > 0)) return {};
    let u = await this.usage(owner);
    if (u.mine + delta > LIMITS.ownerBytes) {
      // The counter can drift after an interrupted write — recount before refusing.
      const exact = await this.recountOwner(owner);
      if (exact !== u.mine) { u = { mine: exact, total: Math.max(0, u.total + exact - u.mine) }; await this.st.put({ ['usage:' + owner]: u.mine, 'usage:*': u.total }); }
      if (u.mine + delta > LIMITS.ownerBytes) return { error: fail('storage_quota', 413, { message: 'Your OST Studio storage is full (' + fmtMB(LIMITS.ownerBytes) + ' across cloud projects and published apps) — delete a project or unpublish an app.' }) };
    }
    if (u.total + delta > this.maxTotal()) return { error: fail('storage_full', 507, { message: 'OST Studio storage is full right now — try again later.' }) };
    return { u };
  }

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
  async isBlocked(slug) {
    let v = this.blockCache.get(slug);
    if (v === undefined) {
      v = !!(await this.st.get('blocked:' + slug));
      if (this.blockCache.size > 2000) this.blockCache.clear();
      this.blockCache.set(slug, v);
    }
    return v;
  }
  dropAppCache(slug) {
    this.appCache.delete(slug);
    for (const k of [...this.idxCache.keys()]) if (k.startsWith(slug + ':')) this.idxCache.delete(k);
    for (const [k, u] of [...this.byteCache]) if (k.startsWith(slug + ':')) { this.byteCache.delete(k); this.byteCacheSize -= u.length; }
  }

  async deploy(a, pid, b, loadPm) {
    const slug = String(b.slug || '').trim().toLowerCase();
    if (!SLUG_RE.test(slug)) return fail('bad_slug', 400, { message: 'Use 3–40 lowercase letters, digits and dashes (not at the ends).' });
    if (isReservedSlug(slug)) return fail('slug_reserved', 400, { message: '“' + slug + '” is reserved — pick another name.' });
    // Best-effort owner profile from the directory — external I/O, so before taking the lock.
    let profile = null;
    try { const k = await this.meshKey(a.owner); if (k && k.profile) profile = { name: clip(k.profile.name, 32), emoji: clip(k.profile.emoji, 8) }; } catch (_) {}
    return this.locked(async () => {
      const pm = await loadPm(); if (!pm) return fail('project_not_found', 404);
      return this.deployLocked(a, pm, b, slug, profile);
    });
  }

  async deployLocked(a, pm, b, slug, profile) {
    const g = await this.st.get(['blocked:' + slug, 'banned:' + a.owner, 'slugown:' + slug, 'app:' + slug]);
    if (g.get('banned:' + a.owner)) return fail('account_suspended', 403, { message: 'Publishing apps is suspended for this account.' });
    if (g.get('blocked:' + slug)) return fail('slug_blocked', 451, { message: '“' + slug + '” was taken down by the OST moderators.' });
    // Published: the owner. Unpublished: {o, until} — the owner's until `until` (legacy bare rows never lapse).
    const so = g.get('slugown:' + slug);
    const holder = typeof so === 'string' ? so : (so && so.o && Number(so.until) > Date.now() ? so.o : null);
    if (holder && holder !== a.owner) return fail('slug_taken', 409);
    const app = g.get('app:' + slug) || null;
    if (app && app.owner !== a.owner) return fail('slug_taken', 409);
    if (!app) {
      const mine = await this.listAll('oapp:' + a.owner + ':');
      if (mine.size >= LIMITS.appsPerOwner) return fail('app_limit', 403, { message: 'You can publish ' + LIMITS.appsPerOwner + ' apps — unpublish one first.' });
      if (holder !== a.owner) {                       // a new claim: published + held names are capped
        const now = Date.now(), stale = [];
        let n = mine.size;
        for (const [k, until] of await this.listAll('oslug:' + a.owner + ':')) { if (Number(until) > now) n++; else stale.push(k); }
        if (stale.length) await this.delMany(stale);
        if (n >= LIMITS.slugClaimsPerOwner) return fail('slug_limit', 403, { message: 'You hold ' + n + ' app names (published or unpublished in the last 30 days) — reuse one of them.' });
      }
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
    // Storage: this version comes in, the ones past keepVersions go out.
    const versions = [...((app && app.versions) || []), ver];
    const kept = versions.slice(-LIMITS.keepVersions);
    const drop = versions.slice(0, Math.max(0, versions.length - LIMITS.keepVersions));
    const vbytes = {};
    for (const v of kept) vbytes[v] = v === ver ? total : Number((app.vbytes && app.vbytes[v]) != null ? app.vbytes[v] : app.bytes) || 0;
    const delta = Object.values(vbytes).reduce((x, y) => x + y, 0) - appStoredBytes(app);
    const q = await this.quota(a.owner, delta);
    if (q.error) return q.error;
    const u = q.u || (delta ? await this.usage(a.owner) : null);
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

    const meta = {
      slug, owner: a.owner, by: a.by, projectId: pm.id,
      name: clip(b.name, 60) || (app && app.name) || pm.name || slug,
      description: b.description != null ? clip(b.description, 280) : ((app && app.description) || ''),
      profile: profile || (app && app.profile) || null,
      version: ver, versions: kept, vbytes, files: files.length, bytes: total,
      ts: now, createdAt: (app && app.createdAt) || now, views: (app && app.views) || 0,
      galKey: 'gal:' + rev16(now) + ':' + slug
    };
    const puts = { ['app:' + slug]: meta, ['slugown:' + slug]: a.owner, ['oapp:' + a.owner + ':' + slug]: 1, [meta.galKey]: slug, ...(u ? this.usageEntries(a.owner, u, delta) : {}) };
    const dels = ['oslug:' + a.owner + ':' + slug];
    if (app && app.galKey && app.galKey !== meta.galKey) dels.push(app.galKey);
    if (so && typeof so === 'object' && so.o && so.o !== a.owner) dels.push('oslug:' + so.o + ':' + slug);   // someone's lapsed hold
    // One atomic batch (no await in between).
    const p1 = this.st.delete(dels), p2 = this.st.put(puts);
    await Promise.all([p1, p2]);
    this.dropAppCache(slug);
    this.galCache.clear();
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
    // The first page is what every gallery visit asks for: answer it from memory for 30 s.
    const ck = opts.startAfter ? '' : String(limit);
    const jsonBody = (text) => new Response(text, { status: 200, headers: cors({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }) });
    const hit = ck && this.galCache.get(ck);
    if (hit && Date.now() - hit.at < 30_000) return jsonBody(hit.body);
    const listed = await this.st.list(opts);
    const keys = [...listed.keys()];
    const more = keys.length > limit;
    const page = keys.slice(0, limit);
    const metas = await this.getMany(page.map((k) => 'app:' + listed.get(k)));
    const apps = [];
    for (const k of page) { const m = metas.get('app:' + listed.get(k)); if (m && m.galKey === k) apps.push(this.pubApp(m)); }
    const text = JSON.stringify({ ok: true, apps, cursor: more ? page[page.length - 1] : null });
    if (ck) { if (this.galCache.size > 100) this.galCache.clear(); this.galCache.set(ck, { at: Date.now(), body: text }); }
    return jsonBody(text);
  }

  async appGet(slug) {
    if (!SLUG_RE.test(String(slug))) return fail('app_not_found', 404);
    const m = await this.appMeta(slug);
    if (!m) return (await this.isBlocked(slug)) ? fail('app_blocked', 451) : fail('app_not_found', 404);
    const idx = await this.versionIndex(slug, m.version);
    const files = [...idx.values()].map((f) => ({ path: f.path, size: f.size, mime: f.mime })).sort((x, y) => (x.path < y.path ? -1 : 1));
    return json({ ok: true, app: { ...this.pubApp(m), files } });
  }

  async appUnpublish(a, slug) {
    if (!SLUG_RE.test(String(slug))) return fail('app_not_found', 404);
    const m = await this.st.get('app:' + slug);
    if (!m) return fail('app_not_found', 404);
    if (m.owner !== a.owner) return fail('not_your_app', 403);
    await this.takeDown(m, slug);
    return json({ ok: true, unpublished: slug });
  }
  /** Unpublish (under the lock): the slug stays held for its owner for LIMITS.slugHoldMs. */
  async takeDown(m, slug) {
    await this.flushViews().catch(() => {});
    const u = await this.usage(m.owner);
    const until = Date.now() + LIMITS.slugHoldMs;
    // One atomic batch (no await in between): the app leaves, the hold is written, usage drops.
    const p1 = this.st.delete(['app:' + slug, 'oapp:' + m.owner + ':' + slug, m.galKey].filter(Boolean));
    const p2 = this.st.put({ ['slugown:' + slug]: { o: m.owner, until }, ['oslug:' + m.owner + ':' + slug]: until, ...this.usageEntries(m.owner, u, -appStoredBytes(m)) });
    await Promise.all([p1, p2]);
    this.dropAppCache(slug);
    this.viewBuf.delete(slug);
    this.galCache.clear();
    for (const v of m.versions || [m.version]) await this.dropVersion(slug, v);
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
    if (!m) return (await this.isBlocked(slug)) ? textRes(451, 'This app was taken down.') : textRes(404, 'App not found.');
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
    if (f.n > 1) {
      // Larger files go out one 512 KB chunk at a time, so a slow reader never pins a whole file.
      let i = 0;
      const stream = new ReadableStream({
        pull: async (ctl) => {
          try {
            if (i >= f.n) { ctl.close(); return; }
            const c = await this.st.get('dc:' + slug + ':' + m.version + ':' + f.path + ':' + pad3(i++));
            if (!c) throw new Error('chunk_missing');
            ctl.enqueue(new Uint8Array(c));
          } catch (e) { ctl.error(e); }
        }
      });
      if (typeof FixedLengthStream === 'function') {     // Workers: keeps Content-Length on a streamed body
        const fixed = new FixedLengthStream(f.size);
        stream.pipeTo(fixed.writable).catch(() => {});
        return new Response(fixed.readable, { status: 200, headers });
      }
      return new Response(stream, { status: 200, headers });
    }
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

    // Rate limits: per owner (40 / 10 min and a daily cap), per network per day, and the shared daily
    // budget — of which identities first seen in the last few days may only use a share, so a burst of
    // fresh identities cannot spend it for everyone.
    const now = Date.now(), today = new Date(now).toISOString().slice(0, 10);
    const rk = 'airl:' + a.owner;
    let rl = (await this.st.get(rk)) || { at: now, n: 0 };
    if (now - rl.at > LIMITS.aiWindowMs) rl = { at: now, n: 0, day: rl.day, dn: rl.dn };
    if (rl.day !== today) { rl.day = today; rl.dn = 0; }
    if (rl.n >= LIMITS.aiPerWindow) return fail('rate_limited', 429, { retryAfter: Math.ceil((rl.at + LIMITS.aiWindowMs - now) / 1000), message: 'AI limit reached (' + LIMITS.aiPerWindow + ' requests / 10 min). Try again shortly.' });
    if (rl.dn >= LIMITS.aiPerOwnerDay) return fail('ai_daily_limit', 429, { message: 'You have used today’s ' + LIMITS.aiPerOwnerDay + ' AI requests. They reset at 00:00 UTC.' });
    const dk = 'aiday:' + today;
    const day = Number(await this.st.get(dk)) || 0;
    const cap = (await this.ownerEstablished(a, now)) ? LIMITS.aiPerDay : Math.floor(LIMITS.aiPerDay * LIMITS.aiNewOwnerShare);
    if (day >= cap) return fail('ai_daily_limit', 429, { message: 'The shared AI budget for today is used up. It resets at 00:00 UTC.' });
    const ipWait = this.ipRate('ai', a.ip || 'anon', LIMITS.aiPerIpDay, 24 * 3600_000);
    if (ipWait) return fail('rate_limited', 429, { retryAfter: ipWait, message: 'AI limit reached for your network today.' });
    rl.n++; rl.dn = (rl.dn || 0) + 1;
    await this.st.put({ [rk]: rl, [dk]: day + 1 });

    // SERVER_SYSTEM stays first and authoritative; the page's own system messages (its tool guide,
    // the open file) are labelled as context.
    const full = [{ role: 'system', content: SERVER_SYSTEM }, ...messages.map((m) => (m.role === 'system' ? { role: 'system', content: CLIENT_CONTEXT + m.content } : m))];
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
    console.error('studio ai_unavailable', errors.join(' | ').slice(0, 1000));
    return fail('ai_unavailable', 502, { message: 'The AI providers did not answer. Try again in a minute.' });
  }
  /** Was this owner's signing key pinned more than LIMITS.aiEstablishedMs ago? (pins older than pin times count) */
  async ownerEstablished(a, now) {
    let at = a.pinnedAt;
    if (at == null) {
      const pinned = await this.st.get('okey:' + a.owner);
      if (!pinned) return false;
      at = typeof pinned === 'string' ? 0 : Number(pinned.at) || 0;
    }
    return !at || now - at > LIMITS.aiEstablishedMs;
  }
}

/* Tiny test hook: the pure pieces, for node tests (no Durable Object runtime needed). */
export const __test = { LIMITS, RESERVED_SLUGS, validSlug, normPath, decodeServePath, dedupeChanges, sanitizeMessages, sanitizeTools, normalizeAiMessage, toWorkersAiMessages, hashToken, newToken, newTokenId, cleanScopes, isBinaryContent, contentSize, mimeOf, isTextPath, meshCanonical, sha256Hex, ipBucket, jsonValueCount, isReservedSlug, appStoredBytes, nonceKey };

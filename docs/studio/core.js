/* ==========================================================================
 * OST Studio · core — the contract every studio module builds on
 * --------------------------------------------------------------------------
 * window.STUDIO: event bus, mesh identity + signed API client, projects with
 * an IndexedDB file system that syncs both ways with the cloud (so coding
 * agents editing through the API show up live), templates, settings, and the
 * VS Code–style shell (activity bar, side panels, bottom panels, preview pane,
 * command palette, dialogs, toasts, status bar).
 * Contract: project-docs/ost-studio.md
 * Never runs user code — the runtime module does that inside sandboxed iframes.
 * ========================================================================== */
(function () {
  'use strict';
  if (window.STUDIO) return;

  const API = 'https://ost-api.nachogtavl.workers.dev';
  const APPS = 'https://ost-apps.nachogtavl.workers.dev';
  const enc = new TextEncoder();
  const $ = (s, r) => (r || document).querySelector(s);

  /* ======================================================================
   * util
   * ==================================================================== */
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const hex = (buf) => Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
  const uid = (n) => hex(crypto.getRandomValues(new Uint8Array(n || 8)));
  function bytesToB64(u8) { let s = ''; const C = 0x8000; for (let i = 0; i < u8.length; i += C) s += String.fromCharCode.apply(null, u8.subarray(i, i + C)); return btoa(s); }
  function b64ToBytes(b64) { const bin = atob(String(b64 || '')); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }
  async function sha256Hex(v) { const data = typeof v === 'string' ? enc.encode(v) : v; return hex(await crypto.subtle.digest('SHA-256', data)); }
  function normPath(p) {
    p = String(p == null ? '' : p).replace(/\\/g, '/');
    const out = [];
    for (const seg of p.split('/')) { if (!seg || seg === '.') continue; if (seg === '..') { out.pop(); continue; } out.push(seg); }
    const r = out.join('/');
    if (!r || r.length > 240 || /[\u0000-\u001f\u007f<>:"|?*]/.test(r)) return '';
    return r;
  }
  const extOf = (p) => { const b = baseOf(p); const i = b.lastIndexOf('.'); return i > 0 ? b.slice(i + 1).toLowerCase() : ''; };
  const dirOf = (p) => { const i = String(p).lastIndexOf('/'); return i < 0 ? '' : String(p).slice(0, i); };
  const baseOf = (p) => { const s = String(p); const i = s.lastIndexOf('/'); return i < 0 ? s : s.slice(i + 1); };
  const LANG = { js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript', mts: 'typescript', json: 'json', html: 'html', htm: 'html', css: 'css', scss: 'scss', less: 'less', md: 'markdown', markdown: 'markdown', py: 'python', svg: 'xml', xml: 'xml', yml: 'yaml', yaml: 'yaml', sh: 'shell', bash: 'shell', toml: 'ini', ini: 'ini', txt: 'plaintext', sql: 'sql', rs: 'rust', go: 'go', java: 'java', c: 'c', h: 'c', cpp: 'cpp', rb: 'ruby', php: 'php', sol: 'sol', graphql: 'graphql', vue: 'html', svelte: 'html' };
  const MIME = { html: 'text/html', htm: 'text/html', css: 'text/css', js: 'text/javascript', mjs: 'text/javascript', cjs: 'text/javascript', jsx: 'text/javascript', ts: 'text/plain', tsx: 'text/plain', json: 'application/json', map: 'application/json', md: 'text/markdown', txt: 'text/plain', py: 'text/x-python', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', ico: 'image/x-icon', woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', mp4: 'video/mp4', webm: 'video/webm', pdf: 'application/pdf', wasm: 'application/wasm', webmanifest: 'application/manifest+json', xml: 'application/xml', csv: 'text/csv', yml: 'text/yaml', yaml: 'text/yaml', toml: 'text/plain' };
  const TEXT_EXT = new Set(['html', 'htm', 'css', 'scss', 'less', 'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'mts', 'json', 'webmanifest', 'map', 'md', 'markdown', 'txt', 'py', 'svg', 'xml', 'yml', 'yaml', 'toml', 'ini', 'sh', 'bash', 'csv', 'sql', 'rs', 'go', 'java', 'c', 'h', 'cpp', 'rb', 'php', 'sol', 'graphql', 'vue', 'svelte', 'env', 'gitignore', 'lock', 'cfg', 'conf']);
  const langOf = (p) => LANG[extOf(p)] || 'plaintext';
  const mimeOf = (p) => MIME[extOf(p)] || 'application/octet-stream';
  const isTextPath = (p) => { const e = extOf(p); return !e || TEXT_EXT.has(e) || /^(readme|license|makefile|dockerfile|procfile)$/i.test(baseOf(p)); };
  const fmtBytes = (n) => { n = Number(n) || 0; return n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(1) + ' MB'; };
  function projectKind() {
    const has = (p) => FS.exists(p);
    let pkg = null; try { pkg = JSON.parse(FS.read('package.json') || 'null'); } catch (_) {}
    const deps = Object.assign({}, pkg && pkg.dependencies, pkg && pkg.devDependencies);
    if (has('index.html') && (deps.react || deps.preact || FS.list().some((f) => /\.(jsx|tsx)$/.test(f.path)))) return 'react';
    if (has('index.html')) return FS.list().some((f) => /\.(js|mjs|ts|jsx|tsx)$/.test(f.path)) ? 'web' : 'static';
    if (has('main.py') || (!FS.list().some((f) => /\.(js|ts)$/.test(f.path)) && FS.list().some((f) => /\.py$/.test(f.path)))) return 'python';
    if (FS.list().some((f) => /\.(js|mjs|ts)$/.test(f.path))) return 'node';
    return 'static';
  }
  function entryFor(kind) {
    kind = kind || projectKind();
    if (kind === 'web' || kind === 'react' || kind === 'static') return 'index.html';
    if (kind === 'python') return FS.exists('main.py') ? 'main.py' : ((FS.list().find((f) => /\.py$/.test(f.path)) || {}).path || 'main.py');
    for (const c of ['index.ts', 'index.js', 'main.ts', 'main.js', 'src/index.ts', 'src/index.js', 'src/main.ts', 'src/main.js']) if (FS.exists(c)) return c;
    return (FS.list().find((f) => /\.(js|mjs|ts)$/.test(f.path)) || {}).path || 'index.js';
  }

  /* ======================================================================
   * bus + settings
   * ==================================================================== */
  const subs = new Map();
  const bus = {
    on(evt, fn) { if (!subs.has(evt)) subs.set(evt, new Set()); subs.get(evt).add(fn); return () => bus.off(evt, fn); },
    off(evt, fn) { const s = subs.get(evt); if (s) s.delete(fn); },
    emit(evt, data) { const s = subs.get(evt); if (!s) return; [...s].forEach((fn) => { try { fn(data); } catch (e) { console.error('[studio] handler for ' + evt + ' failed', e); } }); }
  };
  const SET_KEY = 'ost.studio.settings.v1';
  let settingsCache = null;
  const settings = {
    get(k, d) { if (!settingsCache) { try { settingsCache = JSON.parse(localStorage.getItem(SET_KEY) || '{}') || {}; } catch (_) { settingsCache = {}; } } return k in settingsCache ? settingsCache[k] : d; },
    set(k, v) { settings.get(k); settingsCache[k] = v; try { localStorage.setItem(SET_KEY, JSON.stringify(settingsCache)); } catch (_) {} }
  };

  /* ======================================================================
   * identity — shared with OST Mesh / Social (same localStorage keys)
   * ==================================================================== */
  const ID_KEY = 'ost_mesh_identity_v1', ADDR_KEY = 'ost_mesh_addr_v1';
  const ID = { address: '', name: '', keys: null, bundle: null, fp: '', announced: false };
  async function loadIdentity() {
    let saved = null; try { saved = JSON.parse(localStorage.getItem(ID_KEY) || 'null'); } catch (_) {}
    const imp = (jwk, alg, use) => crypto.subtle.importKey('jwk', jwk, alg, true, use);
    if (saved && saved.kex && saved.sig) {
      try {
        ID.keys = {
          kex: { privateKey: await imp(saved.kex.priv, { name: 'ECDH', namedCurve: 'P-384' }, ['deriveKey', 'deriveBits']), publicKey: await imp(saved.kex.pub, { name: 'ECDH', namedCurve: 'P-384' }, []) },
          sig: { privateKey: await imp(saved.sig.priv, { name: 'ECDSA', namedCurve: 'P-384' }, ['sign']), publicKey: await imp(saved.sig.pub, { name: 'ECDSA', namedCurve: 'P-384' }, ['verify']) }
        };
      } catch (_) { ID.keys = null; }
    }
    if (!ID.keys) {
      const kex = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-384' }, true, ['deriveKey', 'deriveBits']);
      const sig = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-384' }, true, ['sign', 'verify']);
      const ex = (k) => crypto.subtle.exportKey('jwk', k);
      try { localStorage.setItem(ID_KEY, JSON.stringify({ kex: { priv: await ex(kex.privateKey), pub: await ex(kex.publicKey) }, sig: { priv: await ex(sig.privateKey), pub: await ex(sig.publicKey) } })); } catch (_) {}
      ID.keys = { kex, sig };
    }
    let a = null; try { a = localStorage.getItem(ADDR_KEY); } catch (_) {}
    if (!a) { a = 'ost-mesh:' + uid(8).match(/.{1,4}/g).join('-'); try { localStorage.setItem(ADDR_KEY, a); } catch (_) {} }
    ID.address = a;
    const kexPub = await crypto.subtle.exportKey('jwk', ID.keys.kex.publicKey), sigPub = await crypto.subtle.exportKey('jwk', ID.keys.sig.publicKey);
    ID.bundle = { v: 1, suite: 'ECDH-P384+ECDSA-P384+AES-256-GCM', pq: 'phase1-hybrid-ready', kex: kexPub, sig: sigPub, ts: Date.now() };
    const fpHex = await sha256Hex(JSON.stringify(kexPub) + JSON.stringify(sigPub));
    ID.fp = fpHex.slice(0, 16).match(/.{1,4}/g).join('-');
    try { const p = JSON.parse(localStorage.getItem('ost.mesh.app.profile.v1') || 'null'); if (p && p.name) ID.name = String(p.name).slice(0, 32); } catch (_) {}
  }
  async function announce() {
    try {
      const r = await fetch(API + '/mesh/v1/identity/announce', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ address: ID.address, bundle: ID.bundle, fingerprint: ID.fp }) });
      const j = await r.json().catch(() => null);
      ID.announced = !!(r.ok && j && j.ok);
      if (j && j.error && /identity_locked/.test(j.error)) ID.lockError = true;
    } catch (_) { ID.announced = false; }
    if (ID.announced && !ID.name) {
      try { const r = await fetch(API + '/mesh/v1/identity/lookup?address=' + encodeURIComponent(ID.address), { cache: 'no-store' }); const j = await r.json(); if (j && j.profile && j.profile.name) ID.name = String(j.profile.name).slice(0, 32); } catch (_) {}
    }
    renderIdentity();
    return ID.announced;
  }
  async function sign(method, pathq, bodyBytes) {
    const ts = Date.now(), nonce = uid(12);
    const msg = `OST-MESH|v1|${ID.address}|${String(method).toUpperCase()}|${pathq}|${await sha256Hex(bodyBytes || new Uint8Array())}|${ts}|${nonce}`;
    const s = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-384' }, ID.keys.sig.privateKey, enc.encode(msg));
    return { 'x-mesh-addr': ID.address, 'x-mesh-ts': String(ts), 'x-mesh-nonce': nonce, 'x-mesh-sig': bytesToB64(new Uint8Array(s)) };
  }
  async function api(method, path, body, opts) {
    opts = opts || {};
    method = String(method || 'GET').toUpperCase();
    let bytes = null, ctype = '';
    if (body instanceof Uint8Array) { bytes = body; ctype = 'application/octet-stream'; }
    else if (typeof body === 'string') { bytes = enc.encode(body); ctype = 'text/plain;charset=utf-8'; }
    else if (body != null) { bytes = enc.encode(JSON.stringify(body)); ctype = 'application/json'; }
    const headers = Object.assign({}, opts.headers || {});
    if (ctype) headers['Content-Type'] = ctype;
    if (opts.auth !== false) { await STUDIO.ready0; const u = new URL(API + path); Object.assign(headers, await sign(method, u.pathname + u.search, bytes)); }
    let r;
    try { r = await fetch(API + path, { method, headers, body: bytes || undefined, cache: 'no-store', signal: opts.signal }); }
    catch (e) { const err = new Error('Network error — check your connection.'); err.code = 'network'; err.status = 0; throw err; }
    const ct = r.headers.get('content-type') || '';
    const data = /json/.test(ct) ? await r.json().catch(() => null) : await r.text();
    if (r.ok && !(data && typeof data === 'object' && data.ok === false)) return data;
    const code = (data && typeof data === 'object' && data.error) || ('http_' + r.status);
    if (code === 'mesh_identity_unknown' && opts.auth !== false && !opts._retried) { await announce(); return api(method, path, body, Object.assign({}, opts, { _retried: true })); }
    const err = new Error(explain(code, data)); err.code = code; err.status = r.status; err.data = data; throw err;
  }
  function explain(code, data) {
    if (data && typeof data === 'object' && data.message && code !== 'mesh_identity_unknown') return String(data.message).slice(0, 300);
    const m = { identity_key_changed: 'This OST identity is bound to a different key in OST Studio. Use the browser where you created it, or reset your identity.', mesh_identity_unknown: 'Your studio identity is still registering — try again in a moment.', mesh_auth_stale: 'Your device clock is off — fix the time and retry.', rate_limited: 'Too many requests — wait a minute.', not_found: 'Not found.', project_not_found: 'Project not found in the cloud.', slug_taken: 'That app name is taken — pick another.', too_large: 'Too large for OST Studio limits.' };
    return m[code] || (data && data.message) || String(code).replace(/_/g, ' ');
  }

  /* ======================================================================
   * IndexedDB (memory fallback for private mode)
   * ==================================================================== */
  let dbP = null, memDb = null;
  function db() {
    if (dbP) return dbP;
    dbP = new Promise((res) => {
      try {
        const r = indexedDB.open('ost-studio', 1);
        r.onupgradeneeded = () => { const d = r.result; if (!d.objectStoreNames.contains('projects')) d.createObjectStore('projects', { keyPath: 'id' }); if (!d.objectStoreNames.contains('files')) { const s = d.createObjectStore('files', { keyPath: 'k' }); s.createIndex('byProject', 'projectId'); } };
        r.onsuccess = () => res(r.result);
        r.onerror = () => { memDb = { projects: new Map(), files: new Map() }; res(null); };
      } catch (_) { memDb = { projects: new Map(), files: new Map() }; res(null); }
    });
    return dbP;
  }
  function idb(store, mode, fn) {
    return db().then((d) => new Promise((res, rej) => {
      if (!d) { try { res(fn(null, memDb[store])); } catch (e) { rej(e); } return; }
      const t = d.transaction(store, mode); const s = t.objectStore(store); let out;
      try { out = fn(s); } catch (e) { rej(e); return; }
      t.oncomplete = () => res(out && out.__req ? out.__req.result : out);
      t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
    }));
  }
  const req = (r) => ({ __req: r });
  const fileKey = (pid, path) => pid + '\u0001' + path;
  const store = {
    putProject: (m) => idb('projects', 'readwrite', (s, mem) => { if (mem) mem.set(m.id, JSON.parse(JSON.stringify(m))); else s.put(m); }),
    getProject: (id) => idb('projects', 'readonly', (s, mem) => mem ? mem.get(id) : req(s.get(id))),
    allProjects: () => idb('projects', 'readonly', (s, mem) => mem ? [...mem.values()] : req(s.getAll())),
    delProject: (id) => idb('projects', 'readwrite', (s, mem) => { if (mem) mem.delete(id); else s.delete(id); }),
    putFile: (pid, path, rec) => idb('files', 'readwrite', (s, mem) => { const v = Object.assign({ k: fileKey(pid, path), projectId: pid, path }, rec); if (mem) mem.set(v.k, v); else s.put(v); }),
    delFile: (pid, path) => idb('files', 'readwrite', (s, mem) => { if (mem) mem.delete(fileKey(pid, path)); else s.delete(fileKey(pid, path)); }),
    filesOf: (pid) => idb('files', 'readonly', (s, mem) => mem ? [...mem.values()].filter((f) => f.projectId === pid) : req(s.index('byProject').getAll(pid))),
    delFilesOf: async (pid) => { const all = await store.filesOf(pid); await idb('files', 'readwrite', (s, mem) => { all.forEach((f) => { if (mem) mem.delete(f.k); else s.delete(f.k); }); }); }
  };

  /* ======================================================================
   * file system of the current project
   * ==================================================================== */
  // dirty: path → {op, gen} not yet in the cloud (persisted in the project meta as `pending`)
  // blocked: path → {gen, message} the server refused (too big, bad name) — skipped until edited again
  const P = { cur: null, files: new Map(), dirty: new Map(), blocked: new Map(), gen: 0, state: 'local', pushing: false, pulling: false, lastPulled: 0, detail: '', isolate: false, attachBlocked: '' };
  const LIMITS = { fileBytes: 1.5 * 1024 * 1024, projectBytes: 25 * 1024 * 1024, files: 400 };
  const REFUSED = new Set(['too_large', 'bad_path', 'bad_content']);       // retrying the same bytes cannot succeed
  function savePending() { if (P.cur) P.cur.pending = [...P.dirty.entries()].map(([p, d]) => [p, d.op]); }
  function touchProject() { if (!P.cur) return; P.cur.updatedAt = Date.now(); savePending(); store.putProject(P.cur).catch(() => {}); }
  function markDirty(path, op) {
    if (!P.cur) return;
    P.dirty.set(path, { op, gen: ++P.gen }); P.attachBlocked = '';
    if (P.cur.fromLink) { delete P.cur.fromLink; settings.set('lastProject', P.cur.id); setTimeout(() => attachCloud().catch(() => {}), 0); }   // the user is working on it now
    if (P.cur.cloud) setSync('syncing');
  }
  const isBlocked = (path, d) => { const b = P.blocked.get(path); return !!(b && d && b.gen === d.gen); };
  function pushable() { let n = 0; for (const [p, d] of P.dirty) if (!isBlocked(p, d)) n++; return n; }
  function projectBytes() { let n = 0; for (const f of P.files.values()) n += f.size || 0; return n; }
  function settledState() {
    if (P.blocked.size) { const [p, b] = P.blocked.entries().next().value; return ['error', 'Not synced: ' + p + ' — ' + b.message + (P.blocked.size > 1 ? ' (+' + (P.blocked.size - 1) + ' more)' : '')]; }
    return [pushable() ? 'syncing' : 'synced', ''];
  }
  const FS = {
    list() { return [...P.files.entries()].map(([path, f]) => ({ path, size: f.size, binary: !!f.binary, mtime: f.mtime })).sort((a, b) => a.path.localeCompare(b.path)); },
    read(path) { const f = P.files.get(normPath(path)); return f ? f.content : null; },
    exists(path) { return P.files.has(normPath(path)); },
    isBinary(path) { const f = P.files.get(normPath(path)); return !!(f && f.binary); },
    folders() { const s = new Set(); for (const p of P.files.keys()) { let d = dirOf(p); while (d) { s.add(d); d = dirOf(d); } } return [...s].sort(); },
    snapshot() { const o = {}; for (const [p, f] of P.files) o[p] = f.content; return o; },
    async write(path, content, opts) {
      opts = opts || {};
      if (!P.cur) throw new Error('No project is open.');
      const p = normPath(path); if (!p) throw new Error('Invalid file path: ' + path);
      content = content == null ? '' : String(content);
      const binary = opts.binary != null ? !!opts.binary : /^data:[^,]*;base64,/.test(content) && !isTextPath(p);
      const size = binary ? Math.floor((content.length - content.indexOf(',') - 1) * 0.75) : enc.encode(content).length;
      if (size > LIMITS.fileBytes) throw new Error(p + ' is ' + fmtBytes(size) + ' — files are limited to ' + fmtBytes(LIMITS.fileBytes) + '.');
      const prev = P.files.get(p);
      if (!prev && P.files.size >= LIMITS.files) throw new Error('Projects are limited to ' + LIMITS.files + ' files.');
      if (prev && prev.content === content && !!prev.binary === binary) return;
      if (opts.source !== 'cloud' && size > (prev ? prev.size || 0 : 0) && projectBytes() - (prev ? prev.size || 0 : 0) + size > LIMITS.projectBytes) throw new Error('Projects are limited to ' + fmtBytes(LIMITS.projectBytes) + ' — ' + p + ' would go over. Delete something first.');
      const rec = { content, binary, size, mtime: Date.now() };
      P.files.set(p, rec);
      if (opts.source !== 'cloud') markDirty(p, 'put');
      await store.putFile(P.cur.id, p, rec).catch(() => {});
      touchProject();
      bus.emit('fs:change', { path: p, kind: 'write', source: opts.source || 'user', created: !prev });
    },
    async remove(path, opts) {
      opts = opts || {};
      const p = normPath(path); if (!p || !P.cur) return;
      const targets = [...P.files.keys()].filter((k) => k === p || k.startsWith(p + '/'));
      for (const k of targets) { P.files.delete(k); await store.delFile(P.cur.id, k).catch(() => {}); if (opts.source !== 'cloud') markDirty(k, 'del'); bus.emit('fs:change', { path: k, kind: 'remove', source: opts.source || 'user' }); }
      if (targets.length) touchProject();
    },
    async rename(from, to, opts) {
      opts = opts || {};
      const a = normPath(from), b = normPath(to); if (!a || !b || a === b || !P.cur) return;
      const moves = [...P.files.keys()].filter((k) => k === a || k.startsWith(a + '/')).map((k) => [k, b + k.slice(a.length)]);
      if (!moves.length) throw new Error(a + ' does not exist.');
      for (const [, n] of moves) if (P.files.has(n)) throw new Error(n + ' already exists.');
      for (const [o, n] of moves) {
        const f = P.files.get(o); P.files.delete(o); P.files.set(n, Object.assign({}, f, { mtime: Date.now() }));
        await store.delFile(P.cur.id, o).catch(() => {}); await store.putFile(P.cur.id, n, P.files.get(n)).catch(() => {});
        if (opts.source !== 'cloud') { markDirty(o, 'del'); markDirty(n, 'put'); }
        bus.emit('fs:change', { path: n, from: o, kind: 'rename', source: opts.source || 'user' });
      }
      touchProject();
    }
  };

  /* ======================================================================
   * projects + cloud sync
   * ==================================================================== */
  function setSync(state, detail) { if (P.state === state && P.detail === (detail || '')) return; P.state = state; P.detail = detail || ''; bus.emit('sync:state', { state, detail: P.detail }); paintSync(); }
  const newId = () => 'p' + uid(8);
  async function loadInto(meta, files) {
    P.cur = meta; P.files = new Map(); P.dirty = new Map(); P.blocked = new Map(); P.isolate = false; P.attachBlocked = ''; P.lastPulled = meta.pulled || 0;
    for (const f of files) P.files.set(f.path, { content: f.content, binary: !!f.binary, size: f.size || (f.content || '').length, mtime: f.mtime || Date.now() });
    // Edits that never reached the cloud (tab closed, offline) are still in IndexedDB — queue them again.
    for (const [p, op] of Array.isArray(meta.pending) ? meta.pending : []) if (typeof p === 'string' && (op === 'put' || op === 'del')) P.dirty.set(p, { op, gen: ++P.gen });
    if (!meta.fromLink) settings.set('lastProject', meta.id);
    document.title = meta.name + ' · OST Studio';
    paintProjectName();
    setSync(meta.cloud ? (P.dirty.size ? 'syncing' : 'synced') : 'local');
    hideWelcome();
    bus.emit('project:open', { project: meta });
    bus.emit('fs:bulk', { source: 'open' });
  }
  const projects = {
    current: () => P.cur,
    syncState: () => P.state,
    async list() {
      const local = (await store.allProjects().catch(() => [])) || [];
      const map = new Map(local.map((m) => [m.id, Object.assign({}, m, { local: true })]));
      try {
        const j = await api('GET', '/studio/v1/projects');
        for (const r of (j && j.projects) || []) { const m = map.get(r.id); if (m) { m.cloud = true; m.remoteVersion = r.version; if (r.updatedAt > (m.updatedAt || 0)) m.updatedAt = r.updatedAt; } else map.set(r.id, Object.assign({}, r, { cloud: true, local: false })); }
      } catch (_) {}
      return [...map.values()].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    },
    async create(o) {
      o = o || {};
      const name = String(o.name || 'my-project').trim().slice(0, 60) || 'my-project';
      const files = o.files || TEMPLATES.files(o.template || 'web');
      const meta = { id: newId(), name, template: o.template || 'custom', createdAt: Date.now(), updatedAt: Date.now(), version: 0, pulled: 0, cloud: false };
      if (o.fromLink) meta.fromLink = true;           // imported from a link: stays local until the user works on it
      const recs = [];
      for (const [p0, c] of Object.entries(files)) { const p = normPath(p0); if (!p) continue; const content = String(c); const binary = /^data:[^,]*;base64,/.test(content) && !isTextPath(p); recs.push({ path: p, content, binary, size: content.length, mtime: Date.now() }); }
      await store.putProject(meta);
      for (const r of recs) await store.putFile(meta.id, r.path, r);
      await loadInto(meta, recs);
      bus.emit('fs:bulk', { source: 'template' });
      if (!meta.fromLink) attachCloud().catch(() => {});
      return meta;
    },
    async open(id) {
      let meta = await store.getProject(id).catch(() => null);
      if (meta) {
        if (meta.fromLink) { delete meta.fromLink; store.putProject(meta).catch(() => {}); }     // opened on purpose: a normal project now
        await loadInto(meta, (await store.filesOf(id).catch(() => [])) || []);
        if (meta.cloud) { pull().catch(() => {}); push().catch(() => {}); } else attachCloud().catch(() => {});
        return meta;
      }
      // Cloud-only project (another device, or created by an agent through the API).
      setSync('syncing', 'downloading');
      const j = await api('GET', '/studio/v1/projects/' + encodeURIComponent(id) + '/export');
      meta = { id, name: j.project.name, template: j.project.template || 'custom', createdAt: j.project.createdAt || Date.now(), updatedAt: j.project.updatedAt || Date.now(), version: j.version, pulled: j.version, cloud: true };
      const recs = (j.files || []).map((f) => ({ path: f.path, content: f.content, binary: !!f.binary, size: (f.content || '').length, mtime: f.mtime || Date.now() }));
      await store.putProject(meta); for (const r of recs) await store.putFile(id, r.path, r);
      await loadInto(meta, recs);
      return meta;
    },
    async rename(name) {
      if (!P.cur) return; name = String(name || '').trim().slice(0, 60); if (!name) return;
      P.cur.name = name; touchProject(); paintProjectName(); document.title = name + ' · OST Studio';
      if (P.cur.cloud) api('PATCH', '/studio/v1/projects/' + P.cur.id, { name }).catch(() => {});
      bus.emit('project:open', { project: P.cur });
    },
    async remove(id) {
      const meta = await store.getProject(id).catch(() => null);
      await store.delFilesOf(id).catch(() => {}); await store.delProject(id).catch(() => {});
      try { await api('DELETE', '/studio/v1/projects/' + encodeURIComponent(id)); } catch (e) { if (e.code !== 'project_not_found' && e.status !== 404 && meta && meta.cloud) throw e; }
      if (P.cur && P.cur.id === id) { P.cur = null; P.files = new Map(); P.dirty = new Map(); P.blocked = new Map(); settings.set('lastProject', ''); bus.emit('project:close', {}); showWelcome(); }
    },
    async importFiles(map, opts) {
      opts = opts || {};
      for (const [p, c] of Object.entries(map || {})) { try { await FS.write(p, c, { source: opts.source || 'user' }); } catch (e) { UI.toast(e.message, 'err'); } }
      bus.emit('fs:bulk', { source: opts.source || 'import' });
    },
    async exportZip() {
      if (!P.cur) return;
      if (!window.JSZip) await loadScript('https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js');
      const zip = new window.JSZip();
      for (const [p, f] of P.files) { if (f.binary) zip.file(p, f.content.slice(f.content.indexOf(',') + 1), { base64: true }); else zip.file(p, f.content); }
      const blob = await zip.generateAsync({ type: 'blob' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = (P.cur.name || 'project').replace(/[^\w.-]+/g, '-') + '.zip'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    },
    async syncNow() {
      if (!P.cur) return;
      if (P.cur.fromLink) { delete P.cur.fromLink; settings.set('lastProject', P.cur.id); }
      P.attachBlocked = ''; P.blocked = new Map();                       // an explicit sync retries refused files too
      if (!P.cur.cloud) return attachCloud();
      for (let i = 0; i < 20 && P.pushing; i++) await new Promise((r) => setTimeout(r, 100));
      await push(); await pull();
    }
  };
  async function attachCloud() {
    if (!P.cur || P.cur.cloud) return;
    await STUDIO.ready0;
    if (!ID.announced) await announce();
    if (!ID.announced) { setSync('offline', 'identity not registered'); return; }
    if (P.cur.fromLink || P.attaching) return;                            // link imports stay local until the user opts in
    const pid = P.cur.id;
    P.attaching = true;
    setSync('syncing', 'uploading');
    const snapGen = P.gen;                                                // edits after this point are not in the upload
    const files = {}; for (const [p, f] of P.files) files[p] = f.content;
    try {
      const j = await api('POST', '/studio/v1/projects', { id: pid, name: P.cur.name, template: P.cur.template, files });
      if (!P.cur || P.cur.id !== pid) return;
      let moved = false;
      if (j.project && j.project.id && j.project.id !== pid) {          // server re-assigned the id
        const oldId = pid; P.cur.id = j.project.id; moved = true;
        for (const [p, f] of P.files) await store.putFile(P.cur.id, p, f).catch(() => {});
        await store.delFilesOf(oldId).catch(() => {}); await store.delProject(oldId).catch(() => {});
        settings.set('lastProject', P.cur.id);
      }
      P.cur.cloud = true; P.cur.version = j.version || 0; P.cur.pulled = 0; P.lastPulled = 0;
      for (const [p, d] of [...P.dirty]) if (d.gen <= snapGen) P.dirty.delete(p);
      P.blocked = new Map(); savePending();
      await store.putProject(P.cur);
      if (moved) bus.emit('project:open', { project: P.cur });          // same meta object, new id: modules re-key their state
      setSync(...settledState());
      await pull();
    } catch (e) {
      if (REFUSED.has(e.code)) P.attachBlocked = e.message;               // do not re-upload the same refused files every few seconds
      setSync(e.code === 'network' ? 'offline' : 'error', e.message);
    } finally { P.attaching = false; }
  }
  async function push() {
    if (!P.cur || !P.cur.cloud || P.pushing || !pushable()) return;
    P.pushing = true;
    const pid = P.cur.id;
    const put = {}, del = [], taken = new Map(); let bytes = 0, again = false;
    for (const [path, d] of P.dirty) {
      if (isBlocked(path, d)) continue;
      if (P.isolate && taken.size) break;                                // finding the file the server refuses: one at a time
      if (d.op === 'del') del.push(path);
      else { const f = P.files.get(path); if (!f) { del.push(path); } else { if (bytes && bytes + f.content.length > 1200000) continue; put[path] = f.content; bytes += f.content.length; } }
      taken.set(path, d.gen);
    }
    for (const p of [...P.blocked.keys()]) if (!P.dirty.has(p) || P.dirty.get(p).gen !== P.blocked.get(p).gen) P.blocked.delete(p);
    setSync('syncing');
    try {
      const j = await api('POST', '/studio/v1/projects/' + pid + '/sync', { put, del });
      if (P.cur && P.cur.id === pid) {
        for (const [path, gen] of taken) { const d = P.dirty.get(path); if (d && d.gen === gen) P.dirty.delete(path); }
        P.cur.version = j.version; savePending(); store.putProject(P.cur).catch(() => {});
        if (P.isolate && !pushable()) P.isolate = false;
        again = pushable() > 0;
        setSync(...settledState());
      }
    } catch (e) {
      if (e.code === 'project_not_found' && P.cur) { P.cur.cloud = false; attachCloud().catch(() => {}); }
      else if (REFUSED.has(e.code) && P.cur && P.cur.id === pid) {
        if (taken.size > 1) { P.isolate = true; again = true; }          // which file? retry them one by one
        else {
          const [path, gen] = taken.entries().next().value || [];
          if (path) { P.blocked.set(path, { gen, message: e.message }); UI.toast(path + ' was not synced: ' + e.message, 'err'); again = pushable() > 0; }
        }
        setSync(...settledState());
      }
      else setSync(e.code === 'network' ? 'offline' : 'error', e.message);
    } finally { P.pushing = false; }
    if (again) setTimeout(() => push().catch(() => {}), 60);
  }
  async function pull() {
    if (!P.cur || !P.cur.cloud || P.pulling) return;
    P.pulling = true;
    const pid = P.cur.id;
    try {
      const j = await api('GET', '/studio/v1/projects/' + pid + '/changes?since=' + (P.lastPulled || 0));
      if (!P.cur || P.cur.id !== pid) return;
      let applied = 0;
      if (j.full) {                                       // fell behind the server change log: the list is every current file
        const keep = new Set((j.changes || []).filter((c) => !c.deleted).map((c) => c.path));
        for (const p of [...P.files.keys()]) if (!keep.has(p) && !P.dirty.has(p)) { await FS.remove(p, { source: 'cloud' }); applied++; }
      }
      for (const c of (j.changes || [])) {
        if (P.dirty.has(c.path)) continue;                 // a local edit is pending: local wins, it will push
        if (c.deleted) { if (P.files.has(c.path)) { await FS.remove(c.path, { source: 'cloud' }); applied++; } continue; }
        let content = c.content;
        if (c.large || content == null) { try { content = (await api('GET', '/studio/v1/projects/' + pid + '/file?path=' + encodeURIComponent(c.path))).content; } catch (_) { continue; } }
        const local = P.files.get(c.path);
        if (local && local.content === content) continue;
        await FS.write(c.path, content, { source: 'cloud', binary: !!c.binary }); applied++;
      }
      P.lastPulled = j.version || P.lastPulled; P.cur.pulled = P.lastPulled; store.putProject(P.cur).catch(() => {});
      P.idlePulls = (j.changes && j.changes.length) ? 0 : (P.idlePulls || 0) + 1;
      if (applied) UI.toast(applied + ' change' + (applied > 1 ? 's' : '') + ' synced from the cloud' + (j.changes.some((c) => c.by && /^tok_/.test(c.by)) ? ' (agent)' : ''), 'ok');
      if (P.state === 'offline' || P.state === 'error') setSync(...settledState());
    } catch (e) {
      if (e.code === 'project_not_found' && P.cur) { P.cur.cloud = false; attachCloud().catch(() => {}); }
      else if (e.code === 'network') setSync('offline');
    } finally { P.pulling = false; }
  }
  setInterval(() => { if (!document.hidden) push(); }, 1500);
  // Pull every 4 s while changes are flowing (an agent is editing), backing off to
  // 12 s when idle — each pull is a Durable Object request on a shared quota.
  let pullTick = 0;
  setInterval(() => {
    if (document.hidden || !P.cur) return;
    if (!P.cur.cloud) { if ((P.state === 'offline' || P.state === 'error') && !P.attachBlocked && ++pullTick % 8 === 0) attachCloud().catch(() => {}); return; }
    pullTick++;
    const every = (P.idlePulls || 0) >= 3 ? 3 : 1;
    if (!pushable() && pullTick % every === 0) pull();
  }, 4000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) pull(); else push(); });
  window.addEventListener('beforeunload', (e) => { if (P.cur && P.cur.cloud && pushable()) { push(); e.preventDefault(); e.returnValue = ''; } });

  /* ======================================================================
   * templates
   * ==================================================================== */
  const T = {};
  T.web = {
    name: 'Web app', icon: '🌐', desc: 'HTML, CSS and JavaScript — the fastest way to build and deploy a site.',
    files: () => ({
      'index.html': '<!doctype html>\n<html lang="en">\n<head>\n  <meta charset="utf-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1">\n  <title>My OST app</title>\n  <link rel="stylesheet" href="style.css">\n</head>\n<body>\n  <main>\n    <h1>Hello, OST 👋</h1>\n    <p>Edit <code>index.html</code>, <code>style.css</code> and <code>main.js</code> — the preview updates as you type.</p>\n    <button id="btn">Clicked 0 times</button>\n  </main>\n  <script type="module" src="main.js"></script>\n</body>\n</html>\n',
      'style.css': ':root { color-scheme: dark; font-family: system-ui, sans-serif; }\nbody { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0b1020; color: #e4e7f1; }\nmain { text-align: center; padding: 24px; }\nh1 { font-size: 2.4rem; margin: 0 0 8px; }\nbutton { margin-top: 16px; padding: 12px 20px; border: 0; border-radius: 12px; background: #6d9fff; color: #fff; font-size: 1rem; font-weight: 700; cursor: pointer; }\n',
      'main.js': "let clicks = 0;\nconst btn = document.getElementById('btn');\nbtn.addEventListener('click', () => {\n  clicks++;\n  btn.textContent = `Clicked ${clicks} time${clicks === 1 ? '' : 's'}`;\n  console.log('clicked', clicks);\n});\n"
    })
  };
  T.react = {
    name: 'React + JSX', icon: '⚛️', desc: 'React 18 with JSX, bundled in the browser by esbuild. npm packages load from esm.sh.',
    files: () => ({
      'index.html': '<!doctype html>\n<html lang="en">\n<head>\n  <meta charset="utf-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1">\n  <title>React on OST</title>\n</head>\n<body>\n  <div id="root"></div>\n  <script type="module" src="src/main.jsx"></script>\n</body>\n</html>\n',
      'package.json': '{\n  "name": "react-on-ost",\n  "private": true,\n  "dependencies": {\n    "react": "18.3.1",\n    "react-dom": "18.3.1"\n  }\n}\n',
      'src/main.jsx': "import { createRoot } from 'react-dom/client';\nimport App from './App.jsx';\nimport './styles.css';\n\ncreateRoot(document.getElementById('root')).render(<App />);\n",
      'src/App.jsx': "import { useState } from 'react';\n\nexport default function App() {\n  const [count, setCount] = useState(0);\n  return (\n    <main className=\"app\">\n      <h1>React on OST ⚛️</h1>\n      <p>Bundled in your browser — deploy it with one click.</p>\n      <button onClick={() => setCount((c) => c + 1)}>count is {count}</button>\n    </main>\n  );\n}\n",
      'src/styles.css': 'body { margin: 0; font-family: system-ui, sans-serif; background: #0b1020; color: #e4e7f1; }\n.app { min-height: 100vh; display: grid; place-content: center; text-align: center; gap: 8px; }\nbutton { padding: 12px 20px; border: 0; border-radius: 12px; background: #a78bfa; color: #fff; font-weight: 700; font-size: 1rem; cursor: pointer; }\n'
    })
  };
  T.python = {
    name: 'Python', icon: '🐍', desc: 'Python 3.12 via Pyodide (WebAssembly). numpy, pandas and pure-Python packages install on import.',
    files: () => ({
      'main.py': "import math\nfrom statistics import mean\n\nprint('Hello from Python on OST 🐍')\nprices = [101.2, 99.8, 103.5, 104.1, 102.9]\nprint('average:', round(mean(prices), 2))\nprint('volatility:', round(math.sqrt(sum((p - mean(prices)) ** 2 for p in prices) / len(prices)), 3))\n",
      'README.md': '# Python project\n\nPress **Run** (or `Ctrl/Cmd+Enter`). Code runs in a sandboxed WebAssembly Python in your browser.\n'
    })
  };
  T.node = {
    name: 'JavaScript script', icon: '🟨', desc: 'Run JS/TypeScript in a sandboxed worker — great for scripts, data and APIs.',
    files: () => ({
      'index.ts': "type Market = { title?: string; question?: string };\n\nconst res = await fetch('https://ost-api.nachogtavl.workers.dev/markets?limit=5');\nconst data = await res.json();\nconst markets: Market[] = data.markets || data || [];\nconsole.log(`Top ${markets.length} OST prediction markets:`);\nfor (const m of markets) console.log('•', m.title || m.question);\n",
      'README.md': '# Script project\n\n`index.ts` runs in a sandboxed Web Worker. Top-level `await`, `fetch` and TypeScript are supported.\n'
    })
  };
  T.dapp = {
    name: 'OST dApp', icon: '🔮', desc: 'A web app that reads live OST prediction markets and connects a Solana wallet on devnet.',
    files: () => ({
      'index.html': '<!doctype html>\n<html lang="en">\n<head>\n  <meta charset="utf-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1">\n  <title>OST Markets dApp</title>\n  <link rel="stylesheet" href="style.css">\n</head>\n<body>\n  <header><h1>🔮 OST Markets</h1><button id="connect">Connect wallet</button></header>\n  <p id="who" class="muted">Devnet · not connected</p>\n  <ul id="markets"><li class="muted">Loading markets…</li></ul>\n  <script type="module" src="app.js"></script>\n</body>\n</html>\n',
      'style.css': 'body { margin: 0; padding: 20px; font-family: system-ui, sans-serif; background: #0b1020; color: #e4e7f1; }\nheader { display: flex; align-items: center; justify-content: space-between; gap: 12px; }\nh1 { margin: 0; font-size: 1.6rem; }\nbutton { padding: 10px 16px; border: 0; border-radius: 10px; background: #6d9fff; color: #fff; font-weight: 700; cursor: pointer; }\nul { list-style: none; padding: 0; display: grid; gap: 8px; }\nli { padding: 12px 14px; border-radius: 12px; background: #141a2e; border: 1px solid #263055; display: flex; justify-content: space-between; gap: 10px; }\n.muted { color: #8b92ad; }\n.yes { color: #34d399; font-weight: 800; white-space: nowrap; }\n',
      'app.js': "const API = 'https://ost-api.nachogtavl.workers.dev';\nconst list = document.getElementById('markets');\n\nasync function loadMarkets() {\n  try {\n    const r = await fetch(API + '/markets?limit=12');\n    const j = await r.json();\n    const markets = j.markets || j || [];\n    list.innerHTML = '';\n    for (const m of markets.slice(0, 12)) {\n      const li = document.createElement('li');\n      const t = document.createElement('span');\n      t.textContent = m.title || m.question || 'Market';\n      const p = document.createElement('span');\n      p.className = 'yes';\n      const yes = Number(m.yesPrice ?? m.probability ?? NaN);\n      p.textContent = Number.isFinite(yes) ? 'Yes ' + Math.round(yes <= 1 ? yes * 100 : yes) + '¢' : '';\n      li.append(t, p);\n      list.append(li);\n    }\n  } catch (e) {\n    list.innerHTML = '<li class=\"muted\">Could not load markets: ' + e.message + '</li>';\n  }\n}\n\ndocument.getElementById('connect').addEventListener('click', async () => {\n  const provider = window.phantom?.solana || window.solana || window.solflare;\n  if (!provider) { alert('Install Phantom or Solflare (works when the app is opened in its own tab).'); return; }\n  const res = await provider.connect();\n  const key = (res.publicKey || provider.publicKey).toString();\n  document.getElementById('who').textContent = 'Devnet · ' + key.slice(0, 4) + '…' + key.slice(-4);\n});\n\nloadMarkets();\n"
    })
  };
  T.game = {
    name: 'Canvas game', icon: '🎮', desc: 'A tiny 2D game loop on <canvas> — arrow keys / touch to move.',
    files: () => ({
      'index.html': '<!doctype html>\n<html lang="en">\n<head>\n  <meta charset="utf-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1">\n  <title>Coin Catcher</title>\n  <style>html,body{margin:0;height:100%;background:#05070d;overflow:hidden}canvas{display:block;width:100vw;height:100vh;touch-action:none}</style>\n</head>\n<body>\n  <canvas id="c"></canvas>\n  <script type="module" src="game.js"></script>\n</body>\n</html>\n',
      'game.js': "const c = document.getElementById('c');\nconst ctx = c.getContext('2d');\nconst keys = new Set();\nlet W = 0, H = 0, score = 0;\nconst player = { x: 0, y: 0, r: 18, v: 6 };\nconst coins = [];\nfunction resize() { W = c.width = innerWidth; H = c.height = innerHeight; player.x = W / 2; player.y = H - 60; }\naddEventListener('resize', resize); resize();\naddEventListener('keydown', (e) => keys.add(e.key));\naddEventListener('keyup', (e) => keys.delete(e.key));\nc.addEventListener('pointermove', (e) => { player.x = e.clientX; });\nfunction spawn() { coins.push({ x: Math.random() * W, y: -20, s: 2 + Math.random() * 3 }); }\nfunction loop() {\n  if (keys.has('ArrowLeft')) player.x -= player.v;\n  if (keys.has('ArrowRight')) player.x += player.v;\n  if (Math.random() < 0.04) spawn();\n  ctx.fillStyle = '#05070d'; ctx.fillRect(0, 0, W, H);\n  for (let i = coins.length - 1; i >= 0; i--) {\n    const k = coins[i]; k.y += k.s;\n    if (Math.hypot(k.x - player.x, k.y - player.y) < player.r + 10) { coins.splice(i, 1); score++; continue; }\n    if (k.y > H + 20) coins.splice(i, 1);\n    ctx.fillStyle = '#f5c468'; ctx.beginPath(); ctx.arc(k.x, k.y, 10, 0, 7); ctx.fill();\n  }\n  ctx.fillStyle = '#6d9fff'; ctx.beginPath(); ctx.arc(player.x, player.y, player.r, 0, 7); ctx.fill();\n  ctx.fillStyle = '#fff'; ctx.font = '700 22px system-ui'; ctx.fillText('OST ' + score, 16, 34);\n  requestAnimationFrame(loop);\n}\nloop();\n"
    })
  };
  T.blank = { name: 'Empty', icon: '📄', desc: 'Start from nothing.', files: () => ({ 'README.md': '# New project\n' }) };
  const TEMPLATES = {
    list: () => Object.keys(T).map((id) => ({ id, name: T[id].name, desc: T[id].desc, icon: T[id].icon })),
    files: (id) => (T[id] || T.web).files()
  };

  /* ======================================================================
   * shell UI
   * ==================================================================== */
  const isMobile = () => window.matchMedia('(max-width: 760px)').matches;
  const ACT = new Map(), PANELS = new Map(), ACTIONS = [], COMMANDS = new Map(), STATUS = new Map();
  let curAct = '', curPanel = '';
  function el(tag, attrs, html) { const e = document.createElement(tag); if (attrs) for (const k of Object.keys(attrs)) { if (k === 'class') e.className = attrs[k]; else e.setAttribute(k, attrs[k]); } if (html != null) e.innerHTML = html; return e; }
  function shell() {
    const app = $('#stApp');
    app.addEventListener('click', (e) => {
      if (e.target.closest('[data-st-side-close]')) { setActivity('', !isMobile()); return; }
      const b = e.target.closest('[data-st-act]'); if (!b) return;
      const id = b.getAttribute('data-st-act');
      setActivity(id === curAct ? '' : id, !(isMobile() && id === curAct));   // tapping the open drawer's icon closes it (phones too)
    });
    $('#stPanelTabs').addEventListener('click', (e) => { const b = e.target.closest('[data-st-panel]'); if (b) showPanel(b.getAttribute('data-st-panel')); if (e.target.closest('[data-st-panel-close]')) togglePanel(false); });
    $('#stProjName').addEventListener('click', async () => {
      if (!P.cur) { showWelcome(); return; }
      if (document.body.classList.contains('st-welcome-on')) { hideWelcome(); return; }
      const n = await UI.prompt('Rename project', P.cur.name); if (n) projects.rename(n);
    });
    $('#stHome').addEventListener('click', () => showWelcome());
    // resizers
    drag($('#stSideResize'), 'x', (dx, start) => { const w = Math.max(180, Math.min(window.innerWidth * 0.6, start.side + dx)); document.documentElement.style.setProperty('--st-side-w', w + 'px'); settings.set('sideW', w); }, () => ({ side: $('#stSide').getBoundingClientRect().width }));
    drag($('#stPanelResize'), 'y', (dy, start) => { const h = Math.max(90, Math.min(window.innerHeight * 0.75, start.h - dy)); document.documentElement.style.setProperty('--st-panel-h', h + 'px'); settings.set('panelH', h); }, () => ({ h: $('#stPanel').getBoundingClientRect().height }));
    drag($('#stPreviewResize'), 'x', (dx, start) => { const w = Math.max(220, Math.min(window.innerWidth * 0.75, start.w - dx)); document.documentElement.style.setProperty('--st-preview-w', w + 'px'); settings.set('previewW', w); }, () => ({ w: $('#stPreview').getBoundingClientRect().width }));
    const sw = settings.get('sideW'), ph = settings.get('panelH'), pw = settings.get('previewW');
    if (sw) document.documentElement.style.setProperty('--st-side-w', sw + 'px');
    if (ph) document.documentElement.style.setProperty('--st-panel-h', ph + 'px');
    if (pw) document.documentElement.style.setProperty('--st-preview-w', pw + 'px');
    // keyboard
    document.addEventListener('keydown', (e) => {
      const key = keyName(e); if (!key) return;
      for (const c of COMMANDS.values()) if (c.key && normKey(c.key) === key) { e.preventDefault(); e.stopPropagation(); runCommand(c.id); return; }
      if (e.key === 'Escape') closeDialog(null);
    }, true);
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented || $('#stOverlay').classList.contains('on')) return;
      if (document.body.classList.contains('st-welcome-on') && P.cur) { hideWelcome(); e.preventDefault(); }
      else if (isMobile() && curAct) { setActivity(''); e.preventDefault(); }
    });
    window.addEventListener('resize', () => bus.emit('layout', {}));
    $('#stOverlay').addEventListener('mousedown', (e) => { if (e.target.id === 'stOverlay') closeDialog(null); });
  }
  function drag(handle, axis, onMove, startFn) {
    if (!handle) return;
    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault(); const s = startFn(); const x0 = e.clientX, y0 = e.clientY;
      handle.setPointerCapture(e.pointerId); document.body.classList.add('st-dragging');
      const mv = (ev) => { onMove(axis === 'x' ? ev.clientX - x0 : ev.clientY - y0, s); bus.emit('layout', {}); };
      const up = () => { handle.removeEventListener('pointermove', mv); handle.removeEventListener('pointerup', up); document.body.classList.remove('st-dragging'); bus.emit('layout', {}); };
      handle.addEventListener('pointermove', mv); handle.addEventListener('pointerup', up);
    });
  }
  const normKey = (k) => String(k).split('+').map((x) => x.trim()).map((x) => /^(mod|cmd|ctrl|meta)$/i.test(x) ? 'Mod' : x.length === 1 ? x.toUpperCase() : x).sort((a, b) => (a === 'Mod' ? -2 : a === 'Shift' ? -1 : a === 'Alt' ? 0 : 1) - (b === 'Mod' ? -2 : b === 'Shift' ? -1 : b === 'Alt' ? 0 : 1)).join('+');
  function keyName(e) {
    const mod = e.ctrlKey || e.metaKey; if (!mod && !/^F\d+$/.test(e.key)) return '';
    const parts = []; if (mod) parts.push('Mod'); if (e.shiftKey) parts.push('Shift'); if (e.altKey) parts.push('Alt');
    let k = e.key;
    if (e.altKey && e.code) { const m = /^(?:Key([A-Z])|Digit(\d))$/.exec(e.code); if (m) k = m[1] || m[2]; else if (e.code === 'Backquote') k = '`'; }
    if (k.length === 1) k = k.toUpperCase(); if (k === ' ') k = 'Space';
    if (['Control', 'Meta', 'Shift', 'Alt'].includes(k)) return '';
    parts.push(k); return parts.join('+');
  }
  function registerActivity(o) {
    const sec = el('section', { class: 'st-side-sec', 'data-sec': o.id, hidden: '' });
    sec.innerHTML = `<header class="st-side-title">${esc(o.title)}<button type="button" class="st-side-x" data-st-side-close title="Close" aria-label="Close ${esc(o.title)}">✕</button></header>`;
    const body = el('div', { class: 'st-side-body' }); sec.appendChild(body);
    $('#stSide').appendChild(sec);
    ACT.set(o.id, Object.assign({ order: 50 }, o, { sec, body }));
    paintActivityBar();
    if (!curAct && !isMobile() && settings.get('activity', 'explorer') === o.id) setActivity(o.id);
    return body;
  }
  function paintActivityBar() {
    const items = [...ACT.values()].sort((a, b) => a.order - b.order);
    $('#stActivity').innerHTML = items.map((a) => `<button class="st-act ${a.id === curAct ? 'on' : ''}" data-st-act="${esc(a.id)}" title="${esc(a.title)}" aria-label="${esc(a.title)}">${a.icon}${a.badge ? `<i class="st-badge">${esc(a.badge)}</i>` : ''}</button>`).join('');
  }
  function setActivity(id, user) {
    curAct = id || '';
    for (const a of ACT.values()) a.sec.hidden = a.id !== curAct;
    document.body.classList.toggle('st-side-open', !!curAct);
    if (user) settings.set('activity', curAct);
    paintActivityBar();
    bus.emit('activity', { id: curAct });
    bus.emit('layout', {});
  }
  function setBadge(id, text) { const a = ACT.get(id); if (a) { a.badge = text || ''; paintActivityBar(); } }
  function registerPanel(o) {
    const body = el('div', { class: 'st-panel-body', 'data-panel': o.id, hidden: '' });
    $('#stPanelBody').appendChild(body);
    PANELS.set(o.id, Object.assign({ order: 50 }, o, { body }));
    paintPanelTabs();
    if (!curPanel) showPanel(o.id, true);
    return body;
  }
  function paintPanelTabs() {
    const items = [...PANELS.values()].sort((a, b) => a.order - b.order);
    $('#stPanelTabs').innerHTML = items.map((p) => `<button class="${p.id === curPanel ? 'on' : ''}" data-st-panel="${esc(p.id)}">${esc(p.title)}${p.badge ? `<i class="st-badge">${esc(p.badge)}</i>` : ''}</button>`).join('') + '<span class="st-sp"></span><button class="st-ib" data-st-panel-close title="Hide panel" aria-label="Hide panel">✕</button>';
  }
  function showPanel(id, quiet) { if (!PANELS.has(id)) return; curPanel = id; for (const p of PANELS.values()) p.body.hidden = p.id !== id; paintPanelTabs(); if (!quiet) { togglePanel(true); closeDrawer(); } bus.emit('panel', { id }); }
  function closeDrawer() { if (isMobile() && curAct) setActivity(''); }     // phones: the side drawer covers the work area
  function togglePanel(force) { const on = force == null ? document.body.classList.contains('st-panel-hidden') : !!force; document.body.classList.toggle('st-panel-hidden', !on); settings.set('panelOpen', on); bus.emit('layout', {}); }
  function setPanelBadge(id, text) { const p = PANELS.get(id); if (p) { p.badge = text || ''; paintPanelTabs(); } }
  function registerAction(o) {
    ACTIONS.push(Object.assign({ order: 50 }, o)); ACTIONS.sort((a, b) => a.order - b.order);
    $('#stActions').innerHTML = ACTIONS.map((a, i) => `<button class="st-action ${a.primary ? 'primary' : ''}" data-i="${i}" title="${esc(a.title)}">${a.icon || ''}<span>${esc(a.label || a.title)}</span></button>`).join('');
    $('#stActions').onclick = (e) => { const b = e.target.closest('[data-i]'); if (b) { const a = ACTIONS[Number(b.getAttribute('data-i'))]; if (a) { closeDrawer(); Promise.resolve().then(() => a.run()).catch((err) => UI.toast(err.message || String(err), 'err')); } } };
  }
  function registerCommand(c) { COMMANDS.set(c.id, c); bus.emit('commands', {}); }
  function runCommand(id) { const c = COMMANDS.get(id); if (!c) return; try { const r = c.run(); if (r && r.catch) r.catch((e) => UI.toast(e.message || String(e), 'err')); } catch (e) { UI.toast(e.message || String(e), 'err'); } }
  function setStatus(key, text, o) {
    o = o || {}; STATUS.set(key, { text, side: o.side || 'left', title: o.title || '', onClick: o.onClick, order: o.order || 50 });
    const paint = (side) => { const box = $('#stStatus .' + (side === 'left' ? 'l' : 'r')); box.innerHTML = ''; [...STATUS.entries()].filter(([, s]) => s.side === side && s.text).sort((a, b) => a[1].order - b[1].order).forEach(([k, s]) => { const b = el('button', { class: 'st-stat', title: s.title }); b.textContent = s.text; if (s.onClick) b.onclick = s.onClick; else b.disabled = true; box.appendChild(b); }); };
    paint('left'); paint('right');
  }
  // ---- toasts + dialogs ----
  function toast(text, kind) {
    const host = $('#stToasts'); const t = el('div', { class: 'st-toast ' + (kind || '') }); t.textContent = text; host.appendChild(t);
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, kind === 'err' ? 6000 : 3200);
  }
  let dialogResolve = null;
  function openDialog(html, onReady) { const o = $('#stOverlay'); o.innerHTML = `<div class="st-dialog" role="dialog" aria-modal="true">${html}</div>`; o.classList.add('on'); return new Promise((res) => { dialogResolve = res; if (onReady) onReady(o.firstElementChild); }); }
  function closeDialog(v) { const o = $('#stOverlay'); if (!o.classList.contains('on')) return; o.classList.remove('on'); o.innerHTML = ''; const r = dialogResolve; dialogResolve = null; if (r) r(v); }
  function promptDlg(title, value, o) {
    o = o || {};
    return openDialog(`<h3>${esc(title)}</h3><input class="st-input" id="stDlgIn" value="${esc(value || '')}" placeholder="${esc(o.placeholder || '')}" spellcheck="false" autocomplete="off"><div class="st-dlg-btns"><button class="st-btn" data-v="0">Cancel</button><button class="st-btn primary" data-v="1">${esc(o.okText || 'OK')}</button></div>`, (d) => {
      const i = d.querySelector('#stDlgIn'); setTimeout(() => { i.focus(); if (Array.isArray(o.select)) i.setSelectionRange(o.select[0], o.select[1]); else i.select(); }, 20);
      i.addEventListener('keydown', (e) => { if (e.key === 'Enter') closeDialog(i.value.trim() || null); });
      d.querySelector('.st-dlg-btns').onclick = (e) => { const b = e.target.closest('[data-v]'); if (b) closeDialog(b.getAttribute('data-v') === '1' ? (i.value.trim() || null) : null); };
    });
  }
  function confirmDlg(text, o) {
    o = o || {};
    return openDialog(`<p>${esc(text)}</p><div class="st-dlg-btns"><button class="st-btn" data-v="0">Cancel</button><button class="st-btn ${o.danger ? 'danger' : 'primary'}" data-v="1">${esc(o.okText || 'OK')}</button></div>`, (d) => {
      d.querySelector('.st-dlg-btns').onclick = (e) => { const b = e.target.closest('[data-v]'); if (b) closeDialog(b.getAttribute('data-v') === '1'); };
      setTimeout(() => { const b = d.querySelector('[data-v="1"]'); if (b) b.focus(); }, 20);
    }).then((v) => !!v);
  }
  function selectDlg(title, options) {
    let items = options.slice(); let q = '';
    return openDialog(`<h3>${esc(title)}</h3><input class="st-input" id="stDlgQ" placeholder="Type to filter…" autocomplete="off"><div class="st-pick" id="stDlgList"></div>`, (d) => {
      const list = d.querySelector('#stDlgList'), inp = d.querySelector('#stDlgQ'); let sel = 0;
      const score = (o) => { if (!q) return 1; const s = (o.label + ' ' + (o.desc || '')).toLowerCase(); let i = 0; for (const ch of q) { i = s.indexOf(ch, i); if (i < 0) return 0; i++; } return s.includes(q) ? 3 : 1; };
      const paint = () => { items = options.map((o) => [o, score(o)]).filter((x) => x[1] > 0).sort((a, b) => b[1] - a[1]).map((x) => x[0]).slice(0, 80); sel = Math.min(sel, Math.max(0, items.length - 1)); list.innerHTML = items.map((o, i) => `<button class="${i === sel ? 'on' : ''}" data-i="${i}"><b>${esc(o.label)}</b>${o.desc ? `<small>${esc(o.desc)}</small>` : ''}</button>`).join('') || '<div class="st-empty">No matches</div>'; };
      inp.addEventListener('input', () => { q = inp.value.toLowerCase(); sel = 0; paint(); });
      inp.addEventListener('keydown', (e) => { if (e.key === 'ArrowDown') { sel = Math.min(items.length - 1, sel + 1); paint(); e.preventDefault(); } else if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); paint(); e.preventDefault(); } else if (e.key === 'Enter') { const o = items[sel]; closeDialog(o ? o.value : null); } });
      list.onclick = (e) => { const b = e.target.closest('[data-i]'); if (b) { const o = items[Number(b.getAttribute('data-i'))]; closeDialog(o ? o.value : null); } };
      paint(); setTimeout(() => inp.focus(), 20);
    });
  }
  async function palette() {
    const opts = [...COMMANDS.values()].filter((c) => c.title).map((c) => ({ value: c.id, label: c.title, desc: (c.key || c.hint) ? (c.key || c.hint).replace('Mod', /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl') : '' }));
    const id = await selectDlg('Command palette', opts); if (id) runCommand(id);
  }
  function togglePreview(force) { const on = force == null ? !document.body.classList.contains('st-preview-on') : !!force; if (on) closeDrawer(); document.body.classList.toggle('st-preview-on', on); bus.emit('preview:toggle', { on }); bus.emit('layout', {}); return on; }
  // ---- welcome (no project open) ----
  async function showWelcome() {
    const w = $('#stWelcome'); w.hidden = false; document.body.classList.add('st-welcome-on'); closeDrawer();
    const back = P.cur ? `<button class="st-btn st-welcome-back" data-back>← Back to ${esc(P.cur.name)}</button>` : '';
    const tpl = TEMPLATES.list().map((t) => `<button class="st-tpl" data-tpl="${esc(t.id)}"><b>${t.icon}</b><span><strong>${esc(t.name)}</strong><small>${esc(t.desc)}</small></span></button>`).join('');
    w.innerHTML = `<div class="st-welcome">${back}<h1>OST Studio</h1><p class="st-muted">A real code editor in your browser. Build web apps, React, Python and scripts, run them in a sandbox, let an AI agent help — and deploy to OST with one click.</p>
      <h2>Start something new</h2><div class="st-tpls">${tpl}</div>
      <h2>Your projects</h2><div id="stWelcomeProjects" class="st-projects"><div class="st-muted">Loading…</div></div>
      <p class="st-note">Projects save in this browser and sync to your OST cloud space, which belongs to this browser's OST Mesh identity — another phone or computer has its own identity and will not see these projects. To move a project, export it as a .zip and import it on the other device (Account &amp; Projects panel). Code runs only in sandboxes — never with access to your wallet. OST hosts static web apps; there is no server-side code execution.</p></div>`;
    w.onclick = async (e) => {
      if (e.target.closest('[data-back]')) { hideWelcome(); return; }
      const t = e.target.closest('[data-tpl]');
      if (t) { const id = t.getAttribute('data-tpl'); const name = await UI.prompt('Project name', TEMPLATES.list().find((x) => x.id === id).name.toLowerCase().replace(/[^a-z0-9]+/g, '-')); if (name) { await projects.create({ name, template: id }); } return; }
      const o = e.target.closest('[data-open]'); if (o) { try { await projects.open(o.getAttribute('data-open')); } catch (err) { UI.toast(err.message, 'err'); } return; }
      const d = e.target.closest('[data-del]'); if (d) { const id = d.getAttribute('data-del'); if (await UI.confirm('Delete this project from this browser and the cloud? This cannot be undone.', { danger: true, okText: 'Delete' })) { try { await projects.remove(id); } catch (err) { UI.toast(err.message, 'err'); } showWelcome(); } }
    };
    const list = await projects.list();
    const box = $('#stWelcomeProjects'); if (!box) return;
    box.innerHTML = list.length ? list.map((p) => `<div class="st-proj"><button data-open="${esc(p.id)}"><strong>${esc(p.name)}</strong><small>${esc(p.template || '')} · ${p.cloud ? '☁ synced' : 'this browser'}${p.local ? '' : ' (cloud)'} · ${new Date(p.updatedAt || Date.now()).toLocaleString()}</small></button><button class="st-ib" data-del="${esc(p.id)}" title="Delete project" aria-label="Delete project">🗑</button></div>`).join('') : '<div class="st-muted">No projects yet — pick a template above.</div>';
  }
  function hideWelcome() { const w = $('#stWelcome'); if (w) { w.hidden = true; w.innerHTML = ''; } document.body.classList.remove('st-welcome-on'); }
  function paintProjectName() { const b = $('#stProjName'); if (b) b.textContent = P.cur ? P.cur.name : 'No project'; }
  function paintSync() {
    const label = { local: '⬤ local only', synced: '☁ synced', syncing: '⟳ syncing…', offline: '⚠ offline — will retry', error: '⚠ sync error' }[P.state] || P.state;
    setStatus('sync', P.cur ? label : '', { side: 'left', order: 10, title: P.detail || 'Cloud sync with your OST space', onClick: () => projects.syncNow() });
  }
  function renderIdentity() {
    setStatus('id', ID.address ? '👤 ' + (ID.name || ID.address.replace('ost-mesh:', 'mesh·').slice(0, 14)) : '', { side: 'right', order: 90, title: ID.address + (ID.announced ? '' : ' (not registered yet)') });
  }
  function loadScript(src) { return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = () => res(); s.onerror = () => rej(new Error('Could not load ' + src)); document.head.appendChild(s); }); }

  const UI = {
    registerActivity, setActivity, activity: () => curAct, setBadge,
    registerPanel, showPanel, togglePanel, setPanelBadge, panel: () => curPanel,
    registerAction, registerCommand, runCommand, commands: () => [...COMMANDS.values()], palette,
    setStatus, toast, prompt: promptDlg, confirm: confirmDlg, select: selectDlg, dialog: openDialog, closeDialog,
    togglePreview, previewEl: () => $('#stPreviewHost'), previewBar: () => $('#stPreviewBar'), editorHost: () => $('#stEditorHost'),
    isMobile, showWelcome, hideWelcome
  };

  /* ======================================================================
   * boot
   * ==================================================================== */
  let resolveReady0, resolveReady;
  const STUDIO = window.STUDIO = {
    version: '1.0.0', API, APPS, bus, settings, api, ui: UI, fs: FS, projects, templates: TEMPLATES, limits: LIMITS,
    id: { get address() { return ID.address; }, get name() { return ID.name; }, get announced() { return ID.announced; }, get fingerprint() { return ID.fp; }, sign: (m, p, b) => sign(m, p, b), announce },
    util: { esc, uid, langOf, mimeOf, isTextPath, extOf, dirOf, baseOf, normPath, projectKind, entryFor, fmtBytes, b64ToBytes, bytesToB64, sha256Hex, loadScript },
    ready0: new Promise((r) => { resolveReady0 = r; }),
    ready: new Promise((r) => { resolveReady = r; })
  };
  function decodeNew(h) { try { const p = h.replace(/-/g, '+').replace(/_/g, '/'); const json = decodeURIComponent(escape(atob(p + '='.repeat((4 - p.length % 4) % 4)))); return JSON.parse(json); } catch (_) { return null; } }
  async function handleHash() {
    const h = location.hash || '';
    let m;
    if ((m = h.match(/^#new=([A-Za-z0-9_-]+)/))) {
      const d = decodeNew(m[1]); history.replaceState(null, '', location.pathname);
      if (d && d.files && typeof d.files === 'object' && !Array.isArray(d.files)) {
        const name = String(d.name || 'lesson').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 60) || 'lesson';
        const files = {}; let bytes = 0;
        for (const [p0, c] of Object.entries(d.files)) { const p = normPath(p0); if (p && typeof c === 'string') { files[p] = c; bytes += c.length; } }
        const paths = Object.keys(files);
        if (!paths.length) return false;
        // Re-opening the same lesson link opens the existing copy instead of piling up duplicates.
        const local = ((await store.allProjects().catch(() => [])) || []).filter((p) => p.name === name).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
        for (const p of local) {
          const have = (await store.filesOf(p.id).catch(() => [])) || [];
          const same = have.length === paths.length && have.every((f) => files[f.path] === f.content);
          if (same) { await projects.open(p.id); return true; }
        }
        // Anyone can make a link like this, so nothing is created, synced or run until the user says so.
        const list = paths.slice(0, 6).join(', ') + (paths.length > 6 ? ', …' : '');
        const ok = await confirmDlg('Import the project “' + name + '” from a link? ' + paths.length + ' file' + (paths.length === 1 ? '' : 's') + ', ' + fmtBytes(bytes) + ' (' + list + '). Only import code from people you trust — it stays in this browser and does not run until you press Run.', { okText: 'Import' });
        if (!ok) return false;
        await projects.create({ name, template: 'custom', files, fromLink: true }); return true;
      }
    }
    if ((m = h.match(/^#report=([a-z0-9-]{3,40})/))) {
      history.replaceState(null, '', location.pathname);
      const slug = m[1];
      const reason = await selectDlg('Report the app “' + slug + '”', [
        { value: 'scam', label: 'Scam or phishing', desc: 'asks for keys, seed phrases or money' },
        { value: 'impersonation', label: 'Impersonates OST or someone else' },
        { value: 'malware', label: 'Malware or harmful code' },
        { value: 'abuse', label: 'Harassment, hate or illegal content' },
        { value: 'other', label: 'Something else' }
      ]);
      if (reason) {
        try { await api('POST', '/studio/v1/apps/' + slug + '/report', { reason }); toast('Thanks — the report was sent to the OST moderators.', 'ok'); }
        catch (e) { toast('Could not send the report: ' + e.message, 'err'); }
      }
      return false;
    }
    if ((m = h.match(/^#template=([a-z]+)/))) { history.replaceState(null, '', location.pathname); if (T[m[1]]) { await projects.create({ name: T[m[1]].name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), template: m[1] }); return true; } }
    if ((m = h.match(/^#open=(p[0-9a-f]{16})/))) { history.replaceState(null, '', location.pathname); try { await projects.open(m[1]); return true; } catch (e) { UI.toast(e.message, 'err'); } }
    return false;
  }
  async function boot() {
    // Studio holds first-party storage (projects, identity): it never runs inside another page's frame.
    let framed = true; try { framed = window.top !== window.self; } catch (_) {}
    if (framed) {
      document.body.innerHTML = '<p style="font:15px system-ui;padding:24px;color:#e4e7f1;background:#0b1020">OST Studio cannot run inside another page. <a style="color:#8ab4ff" href="https://ost-token.pages.dev/studio.html" target="_blank" rel="noopener">Open OST Studio</a></p>';
      return;
    }
    shell();
    if (!settings.get('panelOpen', true)) document.body.classList.add('st-panel-hidden');
    registerCommand({ id: 'palette', title: 'Show all commands', key: 'Mod+Shift+P', run: palette });
    registerCommand({ id: 'palette.f1', key: 'F1', run: palette });
    registerCommand({ id: 'panel.toggle', title: 'Toggle bottom panel', key: 'Mod+J', run: () => togglePanel() });
    registerCommand({ id: 'preview.toggle', title: 'Toggle preview pane', run: () => togglePreview() });
    registerCommand({ id: 'project.new', title: 'New project…', run: () => showWelcome() });
    registerCommand({ id: 'project.open', title: 'Open project…', run: async () => { const list = await projects.list(); const id = await selectDlg('Open project', list.map((p) => ({ value: p.id, label: p.name, desc: (p.cloud ? 'cloud' : 'local') + ' · ' + (p.template || '') }))); if (id) await projects.open(id); } });
    registerCommand({ id: 'project.rename', title: 'Rename project…', run: async () => { if (!P.cur) return; const n = await promptDlg('Rename project', P.cur.name); if (n) projects.rename(n); } });
    registerCommand({ id: 'project.zip', title: 'Download project as .zip', run: () => projects.exportZip() });
    registerCommand({ id: 'sync.now', title: 'Sync with cloud now', run: () => projects.syncNow() });
    paintProjectName(); renderIdentity();
    try { await loadIdentity(); } catch (e) { toast('Identity unavailable: ' + e.message, 'err'); }
    resolveReady0();
    renderIdentity();
    announce().then(() => { if (P.cur && !P.cur.cloud) attachCloud(); });
    const opened = await handleHash().catch(() => false);
    if (!opened) {
      const last = settings.get('lastProject');
      let ok = false;
      if (last) { try { await projects.open(last); ok = true; } catch (_) {} }
      if (!ok) showWelcome();
    }
    window.addEventListener('hashchange', () => handleHash());
    resolveReady();
    bus.emit('ready', {});
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true }); else boot();
})();

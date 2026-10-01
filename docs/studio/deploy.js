/* ==========================================================================
 * OST Studio · deploy — Run & Deploy, OST Apps gallery, Account & Projects
 * --------------------------------------------------------------------------
 * STUDIO.deploy = {
 *   deploy({slug, name, description}) -> Promise<app>   build → limits → cloud → publish
 *   apps() -> Promise<[app]>          public gallery (first page)
 *   myApps(force?) -> Promise<[app]>  apps owned by this identity
 *   unpublish(slug) -> Promise         (owner only, asks for confirmation in the UI paths)
 *   remix(slug) -> Promise<meta>       copy a deployed app's files into a new project
 *   info() -> {slug, url, version, …} | null   the current project's live app
 *   open()                             show the Run & Deploy panel
 * }
 * Activities: 🚀 Run & Deploy (30) · 🧩 OST Apps (35) · 👤 Account & Projects (90).
 * Top-bar action "Deploy", commands 'deploy' (Mod+Shift+D) and 'apps.gallery',
 * status bar item 'app' (the current project's live URL).
 * Contract: project-docs/ost-studio.md (module "deploy", §4 deploy/apps/serve).
 * Honest scope: OST hosts STATIC web apps only (no server code); apps share one
 * origin; OST is on Solana devnet. This module never runs user code.
 * ========================================================================== */
(function () {
  'use strict';
  const S = window.STUDIO;
  if (!S || S.deploy) return;
  const U = S.util, esc = U.esc, bus = S.bus;

  /* ======================================================================
   * constants
   * ==================================================================== */
  const V1 = '/studio/v1';
  const MB = 1024 * 1024;
  const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;
  const RESERVED = new Set(['api', 'www', 'admin', 'ost', 'studio', 'app', 'apps', 'assets']);
  const DEPLOY_LIMITS = { files: 300, bytes: 25 * MB, fileBytes: 5 * MB };
  const PROJ_LIMITS = Object.assign({ fileBytes: 1.5 * MB, projectBytes: 25 * MB, files: 400 }, S.limits || {});
  const NAME_MAX = 60, DESC_MAX = 200;
  const CLOUD_WAIT_MS = 10000;
  const MEM_KEY = 'deploy.mem';
  const JSZIP_URL = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js';
  const QR_SRC = 'vendor/qrcode-generator.js';
  const DATA_URL_RE = /^data:[^,]*;base64,/;
  const enc = new TextEncoder();
  const KIND = {
    web: { label: 'Web app', note: 'HTML + JavaScript. Deploy bundles your scripts with esbuild and ships every asset as a static site.' },
    react: { label: 'React app', note: 'React / JSX / TypeScript. Deploy bundles it with esbuild (npm packages come from esm.sh) into static files.' },
    static: { label: 'Static site', note: 'Plain HTML and CSS. Deploy ships your files exactly as they are.' },
    python: { label: 'Python', note: 'Python runs in your browser (Pyodide sandbox) when you press Run. OST Apps host static web apps, so a Python script can’t be published by itself — add an index.html page to deploy a site.' },
    node: { label: 'Script', note: 'JavaScript / TypeScript that runs in a sandboxed worker when you press Run. OST Apps host static web apps — add an index.html page to deploy a site.' }
  };
  const SYNC_LABEL = { local: '⬤ This browser only', synced: '☁ Synced', syncing: '⟳ Syncing…', offline: '⚠ Offline — will retry', error: '⚠ Sync error' };

  /* ======================================================================
   * helpers
   * ==================================================================== */
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const curPid = () => { const p = S.projects.current(); return p ? p.id : ''; };
  const appUrl = (slug) => S.APPS + '/' + slug + '/';
  const hostOf = (u) => String(u).replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
  const isNum = (n) => typeof n === 'number' && isFinite(n);
  function clean(s, n) { return String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n); }
  function ago(ts) {
    ts = Number(ts) || 0; if (!ts) return '';
    const s = Math.round((Date.now() - ts) / 1000);
    if (s < 45) return 'just now';
    if (s < 3600) return Math.max(1, Math.round(s / 60)) + ' min ago';
    if (s < 86400) return Math.round(s / 3600) + ' h ago';
    if (s < 86400 * 30) return Math.round(s / 86400) + ' d ago';
    return new Date(ts).toLocaleDateString();
  }
  function fmtWait(sec) { sec = Math.max(1, Math.round(Number(sec) || 60)); return sec < 90 ? sec + ' s' : Math.ceil(sec / 60) + ' min'; }
  function shortAddr(a) { a = String(a || '').replace(/^ost-mesh:/, ''); return a ? a.slice(0, 9) + '…' : 'unknown'; }
  function authorOf(a) {
    if (a && a.owner && a.owner === S.id.address) return 'you';
    const n = a && a.profile && a.profile.name ? clean(a.profile.name, 32) : '';
    return n || 'mesh·' + shortAddr(a && a.owner);
  }
  function avatarOf(a) {
    const e = a && a.profile && a.profile.emoji ? clean(a.profile.emoji, 8) : '';
    if (e) return e;
    const ch = Array.from(clean((a && (a.name || a.slug)) || '', 60).replace(/[^\p{L}\p{N}]/gu, ''))[0];
    return ch ? ch.toUpperCase() : '•';
  }
  function slugError(s) {
    s = String(s == null ? '' : s);
    if (!s) return 'Pick a name for your app’s address.';
    if (s.length < 3) return 'Use at least 3 characters.';
    if (s.length > 40) return 'Use at most 40 characters.';
    if (/[^a-z0-9-]/.test(s)) return 'Use only lowercase letters, digits and dashes.';
    if (s[0] === '-' || s[s.length - 1] === '-') return 'It can’t start or end with a dash.';
    if (!SLUG_RE.test(s)) return 'Use 3–40 lowercase letters, digits and dashes.';
    if (RESERVED.has(s)) return '“' + s + '” is reserved — pick another name.';
    return '';
  }
  function slugify(name) {
    let s = String(name || '').toLowerCase();
    try { s = s.normalize('NFKD').replace(/[̀-ͯ]/g, ''); } catch (_) {}
    s = s.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/g, '');
    if (s.length < 3) s = s ? s + '-app' : 'my-app';
    if (RESERVED.has(s)) s += '-app';
    return s;
  }
  function suggestions(slug) {
    const base = slug.replace(/-\d+$/, '').slice(0, 34).replace(/-+$/, '') || 'my-app';
    const tag = (S.id.address || '').replace(/[^0-9a-f]/g, '').slice(0, 4) || U.uid(2);
    const out = [base + '-' + tag, base + '-2', base + '-app', base + '-' + U.uid(2)].filter((s) => s !== slug && !slugError(s));
    return [...new Set(out)].slice(0, 3);
  }
  /** Bytes the way the server counts them: decoded bytes for binary data URLs, UTF-8 bytes for text. */
  function contentBytes(path, c) {
    c = c == null ? '' : String(c);
    if (DATA_URL_RE.test(c) && !U.isTextPath(path)) {
      const b64 = c.slice(c.indexOf(',') + 1).replace(/\s+/g, '');
      const pad = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
      return Math.max(0, Math.floor(b64.length * 3 / 4) - pad);
    }
    return enc.encode(c).length;
  }
  async function copyText(text) {
    try { if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; } } catch (_) {}
    const ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
    document.body.appendChild(ta); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch (_) {}
    ta.remove(); return ok;
  }
  async function copyLink(url) { const ok = await copyText(url); S.ui.toast(ok ? 'Link copied: ' + hostOf(url) : 'Couldn’t copy — select the link and copy it yourself.', ok ? 'ok' : 'warn'); return ok; }
  function openUrl(url) { const w = window.open(url, '_blank', 'noopener'); if (!w) S.ui.toast('Your browser blocked the new tab — allow pop-ups, or use the link.', 'warn'); }
  const pub = (path) => S.api('GET', V1 + path, null, { auth: false });
  function mkErr(code, message, extra) { const e = new Error(message); e.code = code; if (extra) Object.assign(e, extra); return e; }

  function explainError(e, ctx) {
    const code = (e && e.code) || '';
    const d = e && e.data && typeof e.data === 'object' ? e.data : {};
    const msg = d.message ? clean(d.message, 300) : '';
    const slug = ctx && ctx.slug;
    switch (code) {
      case 'network': return navigator.onLine === false ? 'You’re offline — connect to the internet and try again.' : 'Couldn’t reach the OST server. Check your connection and try again.';
      case 'slug_taken': return '“' + (slug || 'That name') + '” belongs to another creator — pick a different name.';
      case 'slug_reserved': case 'bad_slug': return msg || slugError(slug) || 'That name can’t be used.';
      case 'too_large': return (msg || 'Too large for OST limits.') + ' (Limits: 300 files, 25 MB per deploy, 5 MB per file.)';
      case 'app_limit': return msg || 'You can publish 20 apps — unpublish one in OST Apps first.';
      case 'rate_limited': case 'http_429': return 'Too many requests right now — try again in ' + fmtWait(d.retryAfter) + '.';
      case 'no_index_html': return msg || 'An app needs an index.html at the project root.';
      case 'project_not_found': return 'This project isn’t in your OST cloud space yet. Wait for “☁ synced” in the status bar, then try again.';
      case 'mesh_identity_unknown': return 'Your Studio identity is still registering with OST — try again in a moment.';
      case 'mesh_auth_stale': return 'Your device clock is off — fix the date and time, then try again.';
      case 'app_not_found': return 'That app isn’t published (anymore).';
      case 'not_your_app': return 'Only the creator of an app can unpublish it.';
      case 'not_found': return 'The OST Studio server didn’t recognise this request (HTTP 404) — it may be updating. Try again in a few minutes.';
      default:
        if (e && e.status >= 500) return 'The OST server had a problem (HTTP ' + e.status + '). Nothing changed on your side — try again.';
        return (e && e.message) || String(e || 'Unknown error');
    }
  }
  function isPhone() { return S.ui.isMobile(); }
  /** After an action that changes what the editor shows, reveal it on phones (the side panel covers it). */
  function revealWork() { if (isPhone()) S.ui.setActivity(''); }

  /* ======================================================================
   * per-project memory (STUDIO.settings): form draft, live app, history
   * ==================================================================== */
  const BLANK = () => ({ slug: '', name: '', description: '', live: null, history: [] });
  function memAll() { const m = S.settings.get(MEM_KEY, null); return m && typeof m === 'object' && !Array.isArray(m) ? m : {}; }
  function mem(pid) {
    pid = pid || curPid(); const m = pid ? memAll()[pid] : null;
    const out = Object.assign(BLANK(), m && typeof m === 'object' ? m : {});
    if (!Array.isArray(out.history)) out.history = [];
    if (out.live && !(out.live.slug && SLUG_RE.test(out.live.slug))) out.live = null;
    return out;
  }
  function saveMem(pid, patch) {
    if (!pid) return BLANK();
    const all = Object.assign({}, memAll());
    const cur = Object.assign(mem(pid), patch || {}, { at: Date.now() });
    if (cur.history.length > 25) cur.history = cur.history.slice(-25);
    all[pid] = cur;
    const ids = Object.keys(all);
    if (ids.length > 80) ids.sort((a, b) => ((all[a] && all[a].at) || 0) - ((all[b] && all[b].at) || 0)).slice(0, ids.length - 80).forEach((k) => { delete all[k]; });
    S.settings.set(MEM_KEY, all);
    return cur;
  }
  const liveOf = (pid) => mem(pid).live;

  /* ======================================================================
   * apps API (public reads + owner actions)
   * ==================================================================== */
  const MINE = { list: null, at: 0, p: null, error: null };
  async function myApps(force) {
    await (S.ready0 || S.ready);
    if (!S.id.address) return [];
    if (!force && MINE.list && Date.now() - MINE.at < 30000) return MINE.list;
    if (MINE.p) return MINE.p;
    MINE.p = pub('/apps?owner=' + encodeURIComponent(S.id.address))
      .then((j) => { MINE.list = ((j && j.apps) || []).filter((a) => a && SLUG_RE.test(a.slug)); MINE.at = Date.now(); MINE.error = null; return MINE.list; })
      .catch((e) => { MINE.error = e; throw e; })
      .finally(() => { MINE.p = null; });
    return MINE.p;
  }
  const GAL = { list: [], cursor: null, loading: false, error: null, loaded: false, at: 0, q: '', p: null };
  function loadGallery(more) {
    if (GAL.p) return GAL.p;
    GAL.p = loadGallery0(more).finally(() => { GAL.p = null; });
    return GAL.p;
  }
  async function loadGallery0(more) {
    GAL.loading = true; GAL.error = null; paintApps();
    try {
      const j = await pub('/apps?limit=48' + (more && GAL.cursor ? '&cursor=' + encodeURIComponent(GAL.cursor) : ''));
      const apps = ((j && j.apps) || []).filter((a) => a && SLUG_RE.test(a.slug));
      if (more) { const seen = new Set(GAL.list.map((a) => a.slug)); GAL.list = GAL.list.concat(apps.filter((a) => !seen.has(a.slug))); }
      else GAL.list = apps;
      GAL.cursor = (j && j.cursor) || null; GAL.loaded = true; GAL.at = Date.now();
    } catch (e) { GAL.error = e; }
    finally { GAL.loading = false; paintApps(); }
  }
  async function apps() { await loadGallery(false); if (GAL.error) throw mkErr(GAL.error.code || 'error', explainError(GAL.error)); return GAL.list.slice(); }

  async function unpublish(slug) {
    if (!SLUG_RE.test(String(slug))) throw mkErr('bad_slug', 'Not a valid app name.');
    try { await S.api('POST', V1 + '/apps/' + slug + '/unpublish', {}); }
    catch (e) { if (e.code !== 'app_not_found') throw mkErr(e.code, explainError(e, { slug }), { status: e.status }); }
    // forget it everywhere it is remembered
    const all = memAll();
    for (const pid of Object.keys(all)) if (all[pid] && all[pid].live && all[pid].live.slug === slug) saveMem(pid, { live: null });
    if (MINE.list) MINE.list = MINE.list.filter((a) => a.slug !== slug);
    GAL.list = GAL.list.filter((a) => a.slug !== slug);
    CHECK.set(slug, { state: 'mine', app: null, at: Date.now(), unpublished: true });
    if (ST.fresh === slug) ST.fresh = '';
    bus.emit('deploy:unpublished', { slug });
    paintEverything();
    return { ok: true, slug };
  }
  async function confirmUnpublish(slug, name) {
    const ok = await S.ui.confirm('Unpublish “' + (name || slug) + '”? It goes offline at ' + hostOf(appUrl(slug)) + ' and leaves the OST Apps gallery. The name stays yours, so you can deploy it again later.', { danger: true, okText: 'Unpublish' });
    if (!ok) return false;
    try { await unpublish(slug); S.ui.toast('Unpublished ' + slug + '.', 'ok'); return true; }
    catch (e) { S.ui.toast(e.message, 'err'); return false; }
  }

  /* ---- remix: deployed files → a new project ---- */
  const REMIX = new Map();          // slug → status text
  async function fetchServed(slug, path, mime) {
    const url = S.API + V1 + '/serve/' + slug + '/' + path.split('/').map(encodeURIComponent).join('/');
    let r;
    try { r = await fetch(url, { cache: 'no-store' }); } catch (_) { throw mkErr('network', 'network error'); }
    if (!r.ok) throw mkErr('http_' + r.status, 'HTTP ' + r.status);
    if (U.isTextPath(path)) return r.text();
    const u8 = new Uint8Array(await r.arrayBuffer());
    const m = String(mime || r.headers.get('content-type') || U.mimeOf(path)).split(';')[0].trim() || 'application/octet-stream';
    return 'data:' + m + ';base64,' + U.bytesToB64(u8);
  }
  async function remix(slug) {
    slug = String(slug || '');
    if (!SLUG_RE.test(slug)) throw mkErr('bad_slug', 'Not a valid app name.');
    if (REMIX.has(slug)) throw mkErr('busy', 'Already remixing ' + slug + '.');
    const status = (t) => { REMIX.set(slug, t); paintApps(); };
    try {
      status('Reading the file list…');
      let j;
      try { j = await pub('/apps/' + slug); } catch (e) { throw mkErr(e.code, explainError(e, { slug })); }
      const app = (j && j.app) || {};
      const list = Array.isArray(app.files) ? app.files : [];
      const todo = [], skipped = [];
      for (const f of list) {
        const p = f && U.normPath(f.path); if (!p) continue;
        if (todo.length >= PROJ_LIMITS.files) { skipped.push(p); continue; }
        if (isNum(f.size) && f.size > PROJ_LIMITS.fileBytes) { skipped.push(p + ' (' + U.fmtBytes(f.size) + ')'); continue; }
        todo.push({ p, mime: f.mime });
      }
      if (!todo.length) throw mkErr('empty', skipped.length ? 'Every file in this app is over the ' + U.fmtBytes(PROJ_LIMITS.fileBytes) + ' project file limit.' : 'This app has no files to copy.');
      const files = {}, failed = [], total = todo.length; let done = 0;
      status('Downloading 0/' + total + '…');
      const queue = todo.slice();
      const worker = async () => {
        while (queue.length) {
          const t = queue.shift();
          let ok = false;
          for (let attempt = 0; attempt < 2 && !ok; attempt++) {
            try { files[t.p] = await fetchServed(slug, t.p, t.mime); ok = true; } catch (_) { if (attempt === 0) await sleep(600); }
          }
          if (!ok) failed.push(t.p);
          done++; status('Downloading ' + done + '/' + total + '…');
        }
      };
      await Promise.all([worker(), worker(), worker(), worker()]);
      if (failed.length) throw mkErr('download_failed', 'Couldn’t download ' + plural(failed.length, 'file') + ' (' + failed.slice(0, 3).join(', ') + (failed.length > 3 ? ', …' : '') + '). Check your connection and try again.');
      status('Creating your project…');
      const meta = await S.projects.create({ name: (slug + '-remix').slice(0, 60), template: 'custom', files });
      S.ui.toast('Remixed “' + (app.name || slug) + '” into ' + meta.name + ' — ' + plural(Object.keys(files).length, 'file') + (skipped.length ? ' (' + skipped.length + ' over the size limit skipped)' : '') + '. You got the deployed build, not the original source.', 'ok');
      bus.emit('deploy:remixed', { slug, project: meta });
      return meta;
    } finally { REMIX.delete(slug); paintApps(); }
  }

  /* ======================================================================
   * deploy
   * ==================================================================== */
  const ST = { busy: false, pid: '', steps: [], error: null, fresh: '', warnings: [] };
  const CHECK = new Map();          // slug → {state:'free'|'mine'|'taken'|'unknown', app?, at}
  const REFUSED = new Set();        // names the server refused with slug_taken (kept after an unpublish, so GET says 404)
  let lastSyncDetail = '';
  const STEP_DEFS = [['build', 'Build'], ['check', 'Check limits'], ['cloud', 'Save project to the cloud'], ['upload', 'Publish']];
  function resetSteps() { ST.steps = STEP_DEFS.map(([id, label]) => ({ id, label, state: 'wait', note: '' })); ST.error = null; ST.warnings = []; }
  function step(id, state, note) { const s = ST.steps.find((x) => x.id === id); if (s) { s.state = state; if (note != null) s.note = note; } paintProgress(); }
  function failStep(errInfo) {
    const s = ST.steps.find((x) => x.state === 'run'); if (s) s.state = 'err';
    ST.error = errInfo; paintProgress(); paintError();
    const e = mkErr(errInfo.code || 'error', errInfo.title + (errInfo.detail ? ' — ' + errInfo.detail : ''));
    e.info = errInfo; return e;
  }

  function rawFiles() {
    const snap = S.fs.snapshot(), out = {};
    for (const p of Object.keys(snap).sort()) {
      if (p.split('/').some((seg) => seg.charAt(0) === '.')) continue;      // .env, .git, .vscode…
      if (/^node_modules\//.test(p)) continue;
      out[p] = snap[p];
    }
    return out;
  }

  async function ensureCloud(p0) {
    const t0 = Date.now(), deadline = t0 + CLOUD_WAIT_MS;
    let target = p0, kicked = false;
    const cur = () => S.projects.current();
    const same = () => { const c = cur(); return !!c && (c === target || c.id === target.id); };
    if (cur() && cur().cloud) return cur();
    if (navigator.onLine === false) throw mkErr('offline', 'You’re offline — Studio can’t save the project to the OST cloud. Connect and try again.');
    try { const r = S.projects.syncNow(); if (r && r.catch) r.catch(() => {}); } catch (_) {}
    while (Date.now() < deadline) {
      if (!same()) throw mkErr('project_changed', 'You switched projects while deploying — deploy again.');
      const c = cur(); if (c.cloud) return c;
      // Cloud attach normally starts on its own when a project opens. If it isn't running
      // (identity not registered, offline at open time, earlier error), start it again.
      if (!kicked && Date.now() - t0 > 2500 && S.projects.syncState() !== 'syncing') {
        kicked = true;
        if (!S.id.announced) { try { await S.id.announce(); } catch (_) {} }
        if (S.id.announced && same() && !cur().cloud) {
          try { const m = await S.projects.open(c.id); if (m) target = m; } catch (_) {}
        }
      }
      await sleep(250);
    }
    const st = S.projects.syncState();
    if (!S.id.announced) throw mkErr('identity', 'Your Studio identity couldn’t register with the OST directory, so the project can’t be saved to the cloud yet. Check your connection and try again.');
    if (st === 'offline') throw mkErr('offline', 'Studio can’t reach the OST cloud right now' + (lastSyncDetail ? ' (' + lastSyncDetail + ')' : '') + '. Check your connection and try again.');
    if (st === 'error') throw mkErr('sync_error', 'Saving the project to the cloud failed' + (lastSyncDetail ? ': ' + lastSyncDetail : '') + '. Fix that (see the status bar), then deploy again.');
    throw mkErr('cloud_slow', 'Saving the project to the cloud is taking longer than ' + (CLOUD_WAIT_MS / 1000) + ' s. Wait for “☁ synced” in the status bar, then deploy again.');
  }

  let DEPLOYING = null;
  async function deploy(o) {
    o = o || {};
    if (DEPLOYING) throw mkErr('busy', 'A deploy is already running — wait for it to finish.');
    const p = S.projects.current();
    if (!p) throw mkErr('no_project', 'Open a project first.');
    const m = mem(p.id);
    const slug = String(o.slug != null ? o.slug : (m.slug || (m.live && m.live.slug) || slugify(p.name))).trim().toLowerCase();
    const name = clean(o.name != null && String(o.name).trim() ? o.name : (m.name || (m.live && m.live.name) || p.name), NAME_MAX) || slug;
    const description = clean(o.description != null ? o.description : m.description, DESC_MAX);
    DEPLOYING = runDeploy(p, slug, name, description);
    try { return await DEPLOYING; } finally { DEPLOYING = null; }
  }

  async function runDeploy(p, slug, name, description) {
    const pid0 = p.id;
    ST.busy = true; ST.pid = pid0; ST.fresh = ''; resetSteps();
    saveMem(pid0, { slug, name, description });
    if (DP.pid === pid0) syncFormFromMem();
    paintDeploy(); paintStatus();
    const t0 = performance.now();
    try {
      const se = slugError(slug);
      if (se) { step('build', 'run'); throw failStep({ code: 'bad_slug', title: 'Invalid app name', detail: se, field: 'slug' }); }
      if (CHECK.get(slug) && CHECK.get(slug).state === 'taken') { step('build', 'run'); throw failStep({ code: 'slug_taken', title: 'Name taken', detail: explainError({ code: 'slug_taken' }, { slug }), field: 'slug', suggest: suggestions(slug) }); }
      if (navigator.onLine === false) { step('build', 'run'); throw failStep({ code: 'offline', title: 'You’re offline', detail: 'Connect to the internet, then deploy again. Your project is saved in this browser.' }); }

      /* 1 · build */
      const kind = U.projectKind();
      step('build', 'run', kind === 'static' ? 'Collecting files…' : 'Bundling with esbuild…');
      if (S.editor && typeof S.editor.flush === 'function') { try { await S.editor.flush(); } catch (_) {} }
      if (!S.fs.exists('index.html')) throw failStep({ code: 'no_index_html', title: 'Nothing to deploy yet', detail: 'OST deploys static web apps — add an index.html at the project root. Python and script projects run only inside the Studio sandbox.' });
      let files, warnings = [];
      const useRuntime = !!(S.runtime && typeof S.runtime.build === 'function');   // static sites too: root-absolute URLs + inline module imports need the same build as the preview
      if (!useRuntime) files = rawFiles();
      else {
        let r;
        try { r = await S.runtime.build({ mode: 'deploy' }); }
        catch (e) { throw failStep({ code: 'build_failed', title: 'The build crashed', detail: String(e && e.message || e) }); }
        if (!r || !r.ok) {
          const errs = ((r && r.errors) || []).slice(0, 30);
          if (!isPhone()) { try { S.ui.showPanel('problems'); } catch (_) {} }
          throw failStep({ code: 'build_failed', title: 'Build failed', detail: errs.length ? plural(errs.length, 'error') + ' — fix them and deploy again.' : 'The bundler reported a problem.', errors: errs });
        }
        files = r.files || {}; warnings = (r.warnings || []).slice(0, 10);
      }
      const cp = S.projects.current();
      if (!cp || cp.id !== pid0) throw failStep({ code: 'project_changed', title: 'Project changed', detail: 'You switched projects during the build — deploy again.' });
      const paths = Object.keys(files);
      step('build', 'ok', (useRuntime ? 'Bundled' : 'Collected') + ' · ' + Math.round(performance.now() - t0) + ' ms');
      ST.warnings = warnings;

      /* 2 · limits */
      step('check', 'run');
      const errs = []; let total = 0;
      if (!paths.includes('index.html')) errs.push({ path: '', text: 'The build has no index.html at its root.' });
      if (paths.length > DEPLOY_LIMITS.files) errs.push({ path: '', text: 'Deploys are limited to ' + DEPLOY_LIMITS.files + ' files — this one has ' + paths.length + '.' });
      for (const fp of paths) {
        const n = contentBytes(fp, files[fp]); total += n;
        if (n > DEPLOY_LIMITS.fileBytes) errs.push({ path: fp, text: fp + ' is ' + U.fmtBytes(n) + ' — deployed files are limited to 5 MB.' });
      }
      if (total > DEPLOY_LIMITS.bytes) errs.push({ path: '', text: 'Deploys are limited to 25 MB — this one is ' + U.fmtBytes(total) + '.' });
      if (errs.length) throw failStep({ code: 'too_large', title: 'Over OST Apps limits', detail: 'Limits: 300 files, 25 MB per deploy, 5 MB per file.', errors: errs });
      step('check', 'ok', plural(paths.length, 'file') + ' · ' + U.fmtBytes(total));

      /* 3 · cloud copy (the server checks ownership against it) */
      step('cloud', 'run', p.cloud ? '' : 'Uploading your project…');
      let proj;
      try { proj = await ensureCloud(p); }
      catch (e) { throw failStep({ code: e.code || 'cloud', title: 'Couldn’t save the project to the cloud', detail: e.message }); }
      step('cloud', 'ok', '☁ ' + (proj.id || ''));

      /* 4 · publish */
      step('upload', 'run', 'Uploading ' + U.fmtBytes(total) + '…');
      let res;
      try { res = await S.api('POST', V1 + '/projects/' + encodeURIComponent(proj.id) + '/deploy', { slug, name, description, files }); }
      catch (e) {
        if (e.code === 'slug_taken') { REFUSED.add(slug); CHECK.set(slug, { state: 'taken', app: null, at: Date.now() }); throw failStep({ code: e.code, title: 'Name taken', detail: explainError(e, { slug }), field: 'slug', suggest: suggestions(slug) }); }
        if (e.code === 'slug_reserved' || e.code === 'bad_slug') throw failStep({ code: e.code, title: 'Invalid app name', detail: explainError(e, { slug }), field: 'slug' });
        throw failStep({ code: e.code || 'error', title: e.code === 'network' ? 'Connection problem' : e.code === 'rate_limited' || e.code === 'http_429' ? 'Slow down' : e.code === 'too_large' ? 'Too large' : 'Deploy failed', detail: explainError(e, { slug }), retry: true });
      }
      const app = res && res.app;
      if (!app || !app.slug || !SLUG_RE.test(app.slug)) throw failStep({ code: 'bad_response', title: 'Unclear result', detail: 'The server answered without app details — open OST Apps to check whether it went live.' });
      const out = { slug: app.slug, url: appUrl(app.slug), version: Number(app.version) || 1, files: Number(app.files) || paths.length, bytes: Number(app.bytes) || total, name: app.name || name, description, ts: Date.now(), projectId: proj.id };
      step('upload', 'ok', 'v' + out.version + ' live');

      const pid = proj.id;
      if (pid !== pid0) {                               // the server gave the project a new id: carry its memory over
        const old = memAll()[pid0];
        if (old) { saveMem(pid, old); const all = Object.assign({}, memAll()); delete all[pid0]; S.settings.set(MEM_KEY, all); }
      }
      const mm = mem(pid);
      const hist = mm.history.filter((x) => !(x.slug === out.slug && x.v === out.version));
      hist.push({ v: out.version, ts: out.ts, files: out.files, bytes: out.bytes, slug: out.slug });
      saveMem(pid, { slug: out.slug, name, description, live: { slug: out.slug, url: out.url, version: out.version, ts: out.ts, files: out.files, bytes: out.bytes, views: (mm.live && mm.live.slug === out.slug && mm.live.views) || 0, name: out.name, description }, history: hist });
      CHECK.set(out.slug, { state: 'mine', app: Object.assign({ owner: S.id.address }, out), at: Date.now() });
      MINE.at = 0; GAL.at = 0;
      ST.fresh = out.slug; ST.pid = pid;
      REMOTE.at = Date.now(); REMOTE.pid = pid;
      S.ui.toast('🚀 Live: ' + hostOf(out.url) + '/ (v' + out.version + ')', 'ok');
      bus.emit('deploy:done', { app: out, projectId: pid });
      return out;
    } finally {
      ST.busy = false;
      paintDeploy(); paintStatus();
      if (S.ui.activity() === 'apps') paintApps();
    }
  }

  /* ---- what the server says about this project's app ---- */
  const REMOTE = { pid: '', at: 0, loading: false, error: null };
  function adoptRemote(pid, a) {
    const m = mem(pid);
    const hist = m.history.slice();
    if (!hist.some((x) => x.slug === a.slug && x.v === a.version)) hist.push({ v: a.version, ts: a.ts, files: a.files, bytes: a.bytes, slug: a.slug, elsewhere: true });
    hist.sort((x, y) => (x.ts || 0) - (y.ts || 0));
    saveMem(pid, {
      live: { slug: a.slug, url: appUrl(a.slug), version: Number(a.version) || 1, ts: a.ts, files: a.files, bytes: a.bytes, views: Number(a.views) || 0, name: a.name || '', description: a.description || '' },
      history: hist, slug: m.slug || a.slug, name: m.name || a.name || '', description: m.description || a.description || ''
    });
  }
  async function refreshRemote(force) {
    const p = S.projects.current(); if (!p || ST.busy) return;
    if (!force && REMOTE.pid === p.id && Date.now() - REMOTE.at < 20000) return;
    if (REMOTE.loading) return;
    const pid = p.id;
    REMOTE.loading = true; REMOTE.pid = pid;
    try {
      await (S.ready0 || S.ready);
      const live = liveOf(pid);
      if (live) {
        let a = null;
        try { const j = await pub('/apps/' + live.slug); a = j && j.app; }
        catch (e) { if (e.code === 'app_not_found' || e.status === 404) a = null; else throw e; }
        if (a && a.owner === S.id.address && (!a.projectId || a.projectId === pid)) { adoptRemote(pid, a); CHECK.set(a.slug, { state: 'mine', app: a, at: Date.now() }); }
        else saveMem(pid, { live: null });      // unpublished elsewhere, or now published from another project
      } else {
        const list = await myApps(force);
        const a = list.filter((x) => x.projectId === pid).sort((x, y) => (y.ts || 0) - (x.ts || 0))[0];
        if (a) adoptRemote(pid, a);
      }
      REMOTE.error = null;
    } catch (e) { REMOTE.error = e; }
    finally {
      REMOTE.loading = false; REMOTE.at = Date.now();
      if (curPid() === pid) { if (DP.pid === pid) syncFormFromMem(true); paintDeploy(); }
      paintStatus();
    }
  }

  /* ---- slug availability (public GET /apps/:slug) ---- */
  let checkTimer = 0, checkSeq = 0;
  function scheduleCheck() {
    clearTimeout(checkTimer);
    const slug = slugVal();
    if (slugError(slug)) return;
    const c = CHECK.get(slug);
    if (c && Date.now() - c.at < 30000) return;
    CHECK.set(slug, { state: 'checking', at: 0 });
    checkTimer = setTimeout(() => checkSlug(slug), 450);
  }
  async function checkSlug(slug) {
    const seq = ++checkSeq;
    let res;
    try { const j = await pub('/apps/' + slug); const a = j && j.app; res = { state: a && a.owner === S.id.address ? 'mine' : 'taken', app: a || null }; }
    catch (e) { res = (e.code === 'app_not_found' || e.status === 404) ? { state: 'free', app: null } : { state: 'unknown', app: null }; }
    res.at = Date.now();
    if (REFUSED.has(slug) && res.state !== 'mine') res.state = 'taken';          // the server already refused it
    CHECK.set(slug, res);
    if (seq === checkSeq || slugVal() === slug) { paintFormState(); }
  }

  /* ======================================================================
   * QR code (vendored qrcode-generator, drawn as SVG — no user HTML)
   * ==================================================================== */
  const QR_CACHE = new Map();
  async function qrSvg(text) {
    if (QR_CACHE.has(text)) return QR_CACHE.get(text);
    if (typeof window.qrcode !== 'function') await U.loadScript(QR_SRC);
    if (typeof window.qrcode !== 'function') throw new Error('The QR code library didn’t load.');
    const q = window.qrcode(0, 'M'); q.addData(String(text)); q.make();
    const n = q.getModuleCount(), m = 3, size = n + m * 2; let d = '';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += 'M' + (c + m) + ' ' + (r + m) + 'h1v1h-1z';
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + size + ' ' + size + '" shape-rendering="crispEdges" role="img" aria-label="QR code for ' + esc(text) + '"><rect width="' + size + '" height="' + size + '" fill="#fff"/><path d="' + d + '" fill="#000"/></svg>';
    QR_CACHE.set(text, svg);
    return svg;
  }

  /* ======================================================================
   * Run & Deploy panel
   * ==================================================================== */
  const DP = { root: null, pid: '', qrOpen: false, draftT: 0 };
  function slugVal() { return DP.slug ? DP.slug.value.trim() : ''; }
  function mountDeploy() {
    const body = S.ui.registerActivity({ id: 'deploy', icon: '🚀', title: 'Run & Deploy', order: 30 });
    body.classList.add('st-deploy-host');
    body.innerHTML = '<div class="st-deploy-scroll"><div class="st-deploy" data-panel="deploy">'
      + '<div class="st-deploy-none" data-d="none" hidden></div>'
      + '<div data-d="main">'
      + '<div data-d="proj"></div>'
      + '<div data-d="live"></div>'
      + '<section class="st-deploy-card st-deploy-form">'
      + '<h4 class="st-deploy-h">Deploy to OST Apps</h4>'
      + '<div data-d="formnote"></div>'
      + '<label class="st-label" for="stDeploySlug">App name (its web address)</label>'
      + '<input id="stDeploySlug" class="st-input st-deploy-in st-mono" data-f="slug" maxlength="40" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="go" placeholder="my-app" aria-describedby="stDeploySlugHint">'
      + '<div class="st-deploy-hint" id="stDeploySlugHint" data-d="slughint" aria-live="polite"></div>'
      + '<div class="st-deploy-url" data-d="url"></div>'
      + '<label class="st-label" for="stDeployName">Display name</label>'
      + '<input id="stDeployName" class="st-input st-deploy-in" data-f="name" maxlength="' + NAME_MAX + '" autocomplete="off" placeholder="My app">'
      + '<label class="st-label st-deploy-lblrow" for="stDeployDesc"><span>Description</span><span class="st-deploy-count" data-d="desccount"></span></label>'
      + '<textarea id="stDeployDesc" class="st-input st-deploy-in st-deploy-desc" data-f="description" maxlength="' + DESC_MAX + '" rows="3" placeholder="What does it do? Shown in the OST Apps gallery."></textarea>'
      + '<button type="button" class="st-btn primary block st-deploy-go" data-a="deploy">🚀 Deploy</button>'
      + '<div data-d="progress"></div>'
      + '<div data-d="error"></div>'
      + '</section>'
      + '<div data-d="history"></div>'
      + '<section class="st-deploy-notes"><h4 class="st-deploy-h">Good to know</h4><ul>'
      + '<li><b>Static web apps only.</b> OST Apps host HTML, CSS, JavaScript and assets (React and TypeScript are bundled first). There is no server-side code, database or secret storage — code runs in visitors’ browsers.</li>'
      + '<li><b>One shared origin.</b> Every app is served from ' + esc(hostOf(S.APPS)) + ', so never keep secrets, keys or tokens in browser storage — other apps could read them.</li>'
      + '<li><b>Public.</b> Anyone with the link can open your app, and the gallery lets people remix its deployed files.</li>'
      + '<li><b>Devnet.</b> OST runs on Solana devnet — apps that use wallets or tokens work with test assets, not real money.</li>'
      + '</ul></section>'
      + '</div></div></div>';
    DP.root = body.querySelector('.st-deploy');
    const q = (k) => DP.root.querySelector('[data-d="' + k + '"]');
    Object.assign(DP, { none: q('none'), main: q('main'), proj: q('proj'), live: q('live'), formnote: q('formnote'), hint: q('slughint'), url: q('url'), count: q('desccount'), progress: q('progress'), error: q('error'), history: q('history') });
    DP.slug = DP.root.querySelector('[data-f="slug"]');
    DP.name = DP.root.querySelector('[data-f="name"]');
    DP.desc = DP.root.querySelector('[data-f="description"]');
    DP.go = DP.root.querySelector('[data-a="deploy"]');

    DP.slug.addEventListener('input', () => {
      const v = DP.slug.value, v2 = v.toLowerCase().replace(/[\s_.]/g, '-');
      if (v2 !== v) { const pos = DP.slug.selectionStart; DP.slug.value = v2; try { DP.slug.setSelectionRange(pos, pos); } catch (_) {} }
      if (ST.error && ST.error.field === 'slug' && !ST.busy) { ST.error = null; paintError(); }
      scheduleCheck(); paintFormState(); saveDraft();
    });
    DP.slug.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); deployFromForm(); } });
    DP.name.addEventListener('input', () => saveDraft());
    DP.name.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); deployFromForm(); } });
    DP.desc.addEventListener('input', () => { paintCount(); saveDraft(); });
    DP.root.addEventListener('click', onDeployClick);
    paintDeploy();
  }
  function saveDraft() {
    clearTimeout(DP.draftT);
    const pid = DP.pid; if (!pid) return;
    const v = { slug: slugVal(), name: clean(DP.name.value, NAME_MAX), description: String(DP.desc.value || '').slice(0, DESC_MAX) };
    DP.draftT = setTimeout(() => { if (DP.pid === pid) saveMem(pid, v); }, 300);
  }
  function syncFormFromMem(onlyEmpty) {
    const p = S.projects.current(); if (!p || !DP.slug) return;
    const m = mem(p.id);
    const slug = m.slug || (m.live && m.live.slug) || slugify(p.name);
    const name = m.name || (m.live && m.live.name) || p.name;
    const desc = m.description || '';
    const set = (el, v) => { if (document.activeElement === el) return; if (onlyEmpty && el.value) return; el.value = v; };
    set(DP.slug, slug); set(DP.name, name); set(DP.desc, desc);
  }
  function paintEverything() { paintDeploy(); paintStatus(); paintApps(); if (S.ui.activity() === 'account') paintAccount(); }
  function paintDeploy() {
    if (!DP.root) return;
    const p = S.projects.current();
    DP.none.hidden = !!p; DP.main.hidden = !p;
    if (!p) {
      DP.pid = '';
      DP.none.innerHTML = '<div class="st-deploy-empty"><div class="st-deploy-hero">🚀</div><p>Open or create a project to run it and deploy it to OST Apps.</p>'
        + '<div class="st-deploy-btns center"><button type="button" class="st-btn primary" data-a="new">New project</button><button type="button" class="st-btn" data-a="openproj">Open project…</button></div></div>';
      return;
    }
    if (DP.pid !== p.id) {
      DP.pid = p.id; DP.qrOpen = false;
      if (!ST.busy) { ST.steps = []; ST.error = null; ST.warnings = []; if (ST.pid !== p.id) ST.fresh = ''; }
      DP.slug.value = ''; DP.name.value = ''; DP.desc.value = '';
      syncFormFromMem();
      scheduleCheck();
    }
    paintProj(); paintLive(); paintFormState(); paintProgress(); paintError(); paintHistory();
  }
  function paintProj() {
    const p = S.projects.current(); if (!p || !DP.proj) return;
    const kind = U.projectKind(), k = KIND[kind] || KIND.static;
    const list = S.fs.list(); const bytes = list.reduce((n, f) => n + (f.size || 0), 0);
    const entry = U.entryFor(kind);
    const sync = SYNC_LABEL[S.projects.syncState()] || S.projects.syncState();
    const rt = !!(S.runtime && typeof S.runtime.run === 'function');
    const canPreview = kind === 'web' || kind === 'react' || kind === 'static';
    DP.proj.innerHTML = '<section class="st-deploy-card st-deploy-proj">'
      + '<div class="st-deploy-proj-top"><b class="st-deploy-pname">' + esc(p.name) + '</b><span class="st-deploy-kind k-' + esc(kind) + '">' + esc(k.label) + '</span></div>'
      + '<div class="st-deploy-meta">' + (S.fs.exists(entry) ? 'Entry <code>' + esc(entry) + '</code> · ' : '') + esc(plural(list.length, 'file')) + ' · ' + esc(U.fmtBytes(bytes)) + ' · <span title="' + esc(lastSyncDetail || 'Cloud sync with your OST space') + '">' + esc(sync) + '</span></div>'
      + '<div class="st-deploy-btns"><button type="button" class="st-btn" data-a="run"' + (rt ? '' : ' disabled') + ' title="Run (Ctrl/Cmd+Enter)">▶ Run</button>'
      + (canPreview ? '<button type="button" class="st-btn" data-a="preview"' + (rt ? '' : ' disabled') + '>👁 Preview</button>' : '')
      + (rt ? '' : '<span class="st-muted">Runtime is loading…</span>') + '</div>'
      + '<p class="st-note">' + esc(k.note) + '</p></section>';
  }
  function paintLive() {
    const p = S.projects.current(); if (!p || !DP.live) return;
    const live = liveOf(p.id);
    if (!live) { DP.live.innerHTML = ''; return; }
    const url = appUrl(live.slug);
    const fresh = ST.fresh === live.slug;
    const bits = ['v' + (live.version || 1)];
    if (live.ts) bits.push('updated ' + ago(live.ts));
    if (isNum(live.views)) bits.push(plural(live.views, 'view'));
    DP.live.innerHTML = '<section class="st-deploy-card st-deploy-live' + (fresh ? ' is-new' : '') + '">'
      + (fresh ? '<div class="st-deploy-done">✓ Deployed — your app is live</div>' : '')
      + '<div class="st-deploy-live-top"><span class="st-deploy-dot" aria-hidden="true"></span><b>Live</b><span class="st-muted">' + esc(bits.join(' · ')) + '</span></div>'
      + '<a class="st-deploy-link" href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + esc(hostOf(S.APPS)) + '/<b>' + esc(live.slug) + '</b>/</a>'
      + '<div class="st-deploy-btns">'
      + '<a class="st-btn sm primary" href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">Open ↗</a>'
      + '<button type="button" class="st-btn sm" data-a="copy">Copy link</button>'
      + '<button type="button" class="st-btn sm" data-a="qr" aria-expanded="' + (DP.qrOpen ? 'true' : 'false') + '">QR code</button></div>'
      + '<div class="st-deploy-btns">'
      + '<a class="st-btn sm" href="index.html#app=' + esc(live.slug) + '" target="_blank" rel="noopener">Open inside OST</a>'
      + '<a class="st-btn sm" href="index.html#share-app=' + esc(live.slug) + '" target="_blank" rel="noopener">Share on OST Social</a></div>'
      + '<div class="st-deploy-qr" data-d="qr"' + (DP.qrOpen ? '' : ' hidden') + '></div>'
      + '<div class="st-deploy-live-foot">' + (REMOTE.error && REMOTE.pid === p.id ? '<span class="st-muted">Couldn’t refresh live stats.</span>' : '<span></span>')
      + '<button type="button" class="st-deploy-linkbtn danger" data-a="unpublish">Unpublish…</button></div>'
      + '</section>';
    if (DP.qrOpen) paintQr();
  }
  async function paintQr() {
    const box = DP.live && DP.live.querySelector('[data-d="qr"]'); if (!box) return;
    const live = liveOf(curPid()); if (!live) return;
    const url = appUrl(live.slug);
    box.innerHTML = '<div class="st-muted">Drawing QR code…</div>';
    try {
      const svg = await qrSvg(url);
      const b2 = DP.live && DP.live.querySelector('[data-d="qr"]'); if (!b2 || !DP.qrOpen) return;
      b2.innerHTML = '<div class="st-deploy-qrimg">' + svg + '</div><p class="st-note">Scan with a phone camera to open ' + esc(hostOf(url)) + '/</p>';
    } catch (e) { box.innerHTML = '<div class="st-deploy-err-inline">' + esc(e.message || 'QR code unavailable.') + '</div>'; }
  }
  function paintCount() { if (DP.count) DP.count.textContent = (DP.desc.value || '').length + '/' + DESC_MAX; }
  function paintFormState() {
    const p = S.projects.current(); if (!p || !DP.slug) return;
    const slug = slugVal(), err = slugError(slug);
    const live = liveOf(p.id);
    const hasIndex = S.fs.exists('index.html');
    const c = CHECK.get(slug);
    // form note
    let note = '';
    if (!hasIndex) note = '<div class="st-deploy-warn">OST deploys static web apps — this project has no <code>index.html</code> yet. ' + (U.projectKind() === 'python' ? 'Python runs only inside the Studio sandbox; add an index.html page to publish a site.' : 'Add one at the project root to publish it.') + '</div>';
    else if (live && slug && !err && slug !== live.slug) note = '<div class="st-deploy-info">This publishes a separate app at <b>/' + esc(slug) + '/</b>. Your current app <b>/' + esc(live.slug) + '/</b> stays online until you unpublish it.</div>';
    DP.formnote.innerHTML = note;
    // slug hint
    let hint = '', cls = '';
    if (err) { hint = slug ? '✕ ' + esc(err) : esc(err); cls = slug ? 'err' : ''; }
    else if (!c || c.state === 'checking') { hint = '… Checking availability'; cls = 'muted'; }
    else if (c.state === 'free') { hint = '✓ Available — your first deploy makes this name yours.'; cls = 'ok'; }
    else if (c.state === 'mine') {
      const v = live && live.slug === slug ? live.version : c.app && c.app.version;
      hint = c.unpublished || !v ? '✓ This name is yours.' : '✓ Your app — deploying publishes v' + ((Number(v) || 0) + 1) + '.';
      cls = 'ok';
    } else if (c.state === 'taken') {
      const who = c.app ? authorOf(c.app) : 'another creator';
      hint = '✕ Taken by ' + esc(who) + ' — try: ' + suggestions(slug).map((s) => '<button type="button" class="st-deploy-chip" data-a="suggest" data-slug="' + esc(s) + '">' + esc(s) + '</button>').join(' ');
      cls = 'err';
    } else { hint = 'Couldn’t check availability right now — it’s checked again when you deploy.'; cls = 'muted'; }
    DP.hint.className = 'st-deploy-hint ' + cls; DP.hint.innerHTML = hint;
    DP.slug.classList.toggle('is-bad', !!(slug && err) || (c && c.state === 'taken'));
    DP.slug.setAttribute('aria-invalid', (slug && err) || (c && c.state === 'taken') ? 'true' : 'false');
    // URL preview
    DP.url.innerHTML = '<span class="st-muted">Your app’s address</span><code>' + esc(hostOf(S.APPS)) + '/<b>' + esc(slug && !err ? slug : '<name>') + '</b>/</code>';
    paintCount();
    // button
    const busy = ST.busy && ST.pid === p.id;
    let label = '🚀 Deploy';
    const mineV = live && live.slug === slug ? live.version : (c && c.state === 'mine' && c.app && !c.unpublished ? c.app.version : 0);
    if (busy) label = '⏳ Deploying…';
    else if (mineV) label = '🚀 Deploy update (v' + ((Number(mineV) || 0) + 1) + ')';
    DP.go.textContent = label;
    DP.go.disabled = busy || ST.busy || !hasIndex || !!err || !!(c && c.state === 'taken');
    for (const el of [DP.slug, DP.name, DP.desc]) el.disabled = busy;
  }
  function paintProgress() {
    if (!DP.progress) return;
    const p = S.projects.current();
    if (!ST.steps.length || !p || ST.pid !== p.id) { DP.progress.innerHTML = ''; return; }
    const icon = { wait: '○', run: '', ok: '✓', err: '✕', skip: '–' };
    DP.progress.innerHTML = '<ol class="st-deploy-steps" aria-label="Deploy progress">' + ST.steps.map((s) => '<li class="is-' + s.state + '"><i aria-hidden="true">' + icon[s.state] + '</i><span>' + esc(s.label) + '</span>' + (s.note ? '<small>' + esc(s.note) + '</small>' : '') + '</li>').join('') + '</ol>'
      + (ST.warnings.length && !ST.error ? '<details class="st-deploy-warns"><summary>' + esc(plural(ST.warnings.length, 'build warning')) + '</summary><ul>' + ST.warnings.map((w) => '<li>' + esc((w.path ? w.path + (w.line ? ':' + w.line : '') + ' — ' : '') + (w.text || '')) + '</li>').join('') + '</ul></details>' : '');
  }
  function paintError() {
    if (!DP.error) return;
    const p = S.projects.current();
    const e = ST.error;
    if (!e || !p || ST.pid !== p.id) { DP.error.innerHTML = ''; return; }
    const list = (e.errors || []).slice(0, 30).map((x) => {
      const loc = x.path ? x.path + (x.line ? ':' + x.line + (x.col ? ':' + x.col : '') : '') : '';
      const txt = esc(x.text || '');
      return '<li>' + (loc && S.fs.exists(x.path) ? '<button type="button" class="st-deploy-loc" data-a="reveal" data-path="' + esc(x.path) + '" data-line="' + esc(x.line || 1) + '" data-col="' + esc(x.col || 1) + '">' + esc(loc) + '</button> ' : (loc ? '<code>' + esc(loc) + '</code> ' : '')) + txt + '</li>';
    }).join('');
    const sugg = (e.suggest || []).map((s) => '<button type="button" class="st-deploy-chip" data-a="suggest" data-slug="' + esc(s) + '">' + esc(s) + '</button>').join(' ');
    DP.error.innerHTML = '<div class="st-deploy-err" role="alert"><b>' + esc(e.title) + '</b>' + (e.detail ? '<p>' + esc(e.detail) + '</p>' : '')
      + (list ? '<ul>' + list + '</ul>' : '') + (sugg ? '<div class="st-deploy-sugg">Try: ' + sugg + '</div>' : '')
      + (e.retry ? '<button type="button" class="st-btn" data-a="deploy">Try again</button>' : '')
      + (e.code === 'app_limit' ? '<button type="button" class="st-btn" data-a="gallery">Manage my apps</button>' : '') + '</div>';
  }
  function paintHistory() {
    const p = S.projects.current(); if (!p || !DP.history) return;
    const m = mem(p.id), live = m.live;
    const hist = m.history.slice().sort((a, b) => (b.ts || 0) - (a.ts || 0));
    if (!hist.length) { DP.history.innerHTML = ''; return; }
    DP.history.innerHTML = '<section class="st-deploy-card"><div class="st-deploy-hrow"><h4 class="st-deploy-h">Deploy history</h4><button type="button" class="st-ib" data-a="refresh" title="Refresh from the server" aria-label="Refresh deploy info">⟳</button></div>'
      + '<ol class="st-deploy-hist">' + hist.slice(0, 15).map((x) => {
        const isLive = live && live.slug === x.slug && live.version === x.v;
        const showSlug = !live || x.slug !== live.slug;
        return '<li' + (isLive ? ' class="is-live"' : '') + '><b>v' + esc(x.v) + '</b>' + (showSlug ? ' <code>/' + esc(x.slug) + '/</code>' : '')
          + ' <span class="st-muted">' + esc(ago(x.ts)) + (isNum(x.files) ? ' · ' + esc(plural(x.files, 'file')) : '') + (isNum(x.bytes) ? ' · ' + esc(U.fmtBytes(x.bytes)) : '') + (x.elsewhere ? ' · via the API or another device' : '') + '</span>'
          + (isLive ? ' <em>live</em>' : '') + '</li>';
      }).join('') + '</ol><p class="st-note">Only the latest version of an app is served. Redeploying replaces it in place; the link stays the same.</p></section>';
  }
  async function onDeployClick(e) {
    const b = e.target.closest('[data-a]'); if (!b || !DP.root.contains(b)) return;
    const a = b.getAttribute('data-a');
    const live = liveOf(curPid());
    if (a === 'deploy') deployFromForm();
    else if (a === 'run') { if (S.runtime) { revealWork(); S.runtime.run(); } }
    else if (a === 'preview') { if (S.runtime) { revealWork(); S.runtime.preview(); } }
    else if (a === 'copy' && live) copyLink(appUrl(live.slug));
    else if (a === 'qr') { DP.qrOpen = !DP.qrOpen; paintLive(); }
    else if (a === 'unpublish' && live) confirmUnpublish(live.slug, live.name);
    else if (a === 'suggest') { DP.slug.value = b.getAttribute('data-slug') || ''; if (ST.error && ST.error.field === 'slug') ST.error = null; scheduleCheck(); paintFormState(); paintError(); saveDraft(); if (!isPhone()) DP.slug.focus(); }
    else if (a === 'reveal') { const path = b.getAttribute('data-path'); if (S.editor && S.editor.reveal) { revealWork(); S.editor.reveal(path, Number(b.getAttribute('data-line')) || 1, Number(b.getAttribute('data-col')) || 1); } }
    else if (a === 'refresh') refreshRemote(true);
    else if (a === 'gallery') S.ui.setActivity('apps');
    else if (a === 'new') { revealWork(); S.ui.showWelcome(); }
    else if (a === 'openproj') S.ui.runCommand('project.open');
  }
  function deployFromForm() {
    const p = S.projects.current(); if (!p || ST.busy) return;
    const slug = slugVal(), err = slugError(slug);
    if (err) { paintFormState(); if (!isPhone()) DP.slug.focus(); S.ui.toast(err, 'warn'); return; }
    deploy({ slug, name: DP.name.value, description: DP.desc.value }).catch((e) => {
      if (!e.info && !(ST.error)) S.ui.toast(e.message, 'err');            // errors before the progress UI started
      else if (S.ui.activity() !== 'deploy') S.ui.toast(e.message, 'err');
    });
  }
  function openPanel() { S.ui.setActivity('deploy'); paintDeploy(); refreshRemote(); }
  function deployCommand() {
    const p = S.projects.current();
    if (!p) { S.ui.toast('Open a project first.', 'warn'); S.ui.showWelcome(); return; }
    openPanel();
    if (ST.busy) return;
    const live = liveOf(p.id), slug = slugVal();
    // A redeploy of the same app is one click; a first deploy lets you confirm the name first.
    if (live && slug === live.slug && !slugError(slug)) { deployFromForm(); return; }
    if (!isPhone()) setTimeout(() => { DP.slug.focus(); DP.slug.select(); }, 30);
  }

  /* ---- status bar: the current project's live app ---- */
  function paintStatus() {
    const live = liveOf(curPid());
    if (!S.projects.current() || !live) { S.ui.setStatus('app', ''); return; }
    const url = appUrl(live.slug);
    S.ui.setStatus('app', '🚀 ' + live.slug, { side: 'left', order: 60, title: 'Live at ' + url + ' (v' + live.version + ') — click to open or copy', onClick: () => appMenu(live) });
  }
  async function appMenu(live) {
    const url = appUrl(live.slug);
    const v = await S.ui.select(live.slug + ' · v' + live.version, [
      { value: 'open', label: 'Open the app in a new tab', desc: hostOf(url) },
      { value: 'copy', label: 'Copy link' },
      { value: 'ost', label: 'Open inside OST' },
      { value: 'panel', label: 'Show Run & Deploy' }
    ]);
    if (v === 'open') openUrl(url);
    else if (v === 'copy') copyLink(url);
    else if (v === 'ost') openUrl('index.html#app=' + live.slug);
    else if (v === 'panel') openPanel();
  }

  /* ======================================================================
   * OST Apps gallery
   * ==================================================================== */
  const AP = { root: null, q: '', paintT: 0 };
  function mountApps() {
    const body = S.ui.registerActivity({ id: 'apps', icon: '🧩', title: 'OST Apps', order: 35 });
    body.classList.add('st-deploy-host');
    body.innerHTML = '<div class="st-deploy-scroll"><div class="st-deploy st-deploy-apps" data-panel="apps">'
      + '<div class="st-deploy-search"><input class="st-input st-deploy-in" type="search" data-g="q" placeholder="Search apps" aria-label="Search apps" autocomplete="off" spellcheck="false"><button type="button" class="st-ib" data-a="reload" title="Refresh" aria-label="Refresh apps">⟳</button></div>'
      + '<div data-g="mine"></div>'
      + '<div data-g="list"></div>'
      + '<p class="st-note st-deploy-apps-note">OST Apps are static web apps made in OST Studio. They run on ' + esc(hostOf(S.APPS)) + ' — never on the OST site, so they can’t touch your wallet — but they share that one origin with each other: don’t type secrets into apps you don’t trust. <b>Remix</b> copies an app’s deployed files into a new project of yours.</p>'
      + '</div></div>';
    AP.root = body.querySelector('.st-deploy-apps');
    AP.mine = AP.root.querySelector('[data-g="mine"]');
    AP.list = AP.root.querySelector('[data-g="list"]');
    const qi = AP.root.querySelector('[data-g="q"]');
    qi.addEventListener('input', () => { AP.q = qi.value.trim().toLowerCase(); paintApps(); });
    AP.root.addEventListener('click', onAppsClick);
    paintApps();
  }
  function matches(a, q) {
    if (!q) return true;
    return [a.name, a.slug, a.description, authorOf(a)].some((s) => String(s || '').toLowerCase().includes(q));
  }
  function appCard(a, mine) {
    const slug = String(a.slug || ''); if (!SLUG_RE.test(slug)) return '';
    const busy = REMIX.get(slug);
    const meta = ['by ' + authorOf(a)];
    if (a.ts) meta.push(ago(a.ts));
    if (isNum(a.views)) meta.push(plural(a.views, 'view'));
    const cur = S.projects.current();
    const projBtn = mine && a.projectId && /^p[0-9a-f]{16}$/.test(a.projectId) && !(cur && cur.id === a.projectId) ? '<button type="button" class="st-btn sm" data-a="openproj" data-pid="' + esc(a.projectId) + '">Open project</button>' : '';
    return '<article class="st-deploy-app" data-slug="' + esc(slug) + '">'
      + '<div class="st-deploy-app-top"><span class="st-deploy-av" aria-hidden="true">' + esc(avatarOf(a)) + '</span><div class="st-deploy-app-t"><b>' + esc(clean(a.name, NAME_MAX) || slug) + '</b><small>/' + esc(slug) + '/' + (a.version ? ' · v' + esc(a.version) : '') + '</small></div></div>'
      + (a.description ? '<p class="st-deploy-app-desc">' + esc(clean(a.description, 280)) + '</p>' : '')
      + '<div class="st-deploy-app-meta">' + esc(meta.join(' · ')) + '</div>'
      + '<div class="st-deploy-btns">'
      + '<a class="st-btn sm" href="' + esc(appUrl(slug)) + '" target="_blank" rel="noopener noreferrer">Open ↗</a>'
      + '<a class="st-btn sm" href="index.html#app=' + esc(slug) + '" target="_blank" rel="noopener">Open in OST</a>'
      + (mine ? '<button type="button" class="st-btn sm" data-a="copy">Copy link</button>' + projBtn + '<button type="button" class="st-btn sm danger-ghost" data-a="unpublish">Unpublish</button>'
        : '<button type="button" class="st-btn sm" data-a="remix"' + (busy ? ' disabled' : '') + '>' + (busy ? 'Remixing…' : 'Remix') + '</button>')
      + '</div>'
      + (busy ? '<div class="st-deploy-app-busy" role="status">' + esc(busy) + '</div>' : '')
      + '</article>';
  }
  function paintApps() {
    if (!AP.root) return;
    const q = AP.q;
    // mine
    const mine = MINE.list ? MINE.list.filter((a) => matches(a, q)) : null;
    let mh = '';
    if (MINE.list === null && MINE.p) mh = '<div class="st-muted st-deploy-pad">Loading your apps…</div>';
    else if (MINE.error && !MINE.list) mh = '';
    else if (mine && mine.length) mh = '<h4 class="st-deploy-h">Your apps <span class="st-muted">' + MINE.list.length + '/20</span></h4><div class="st-deploy-grid">' + mine.map((a) => appCard(a, true)).join('') + '</div>';
    AP.mine.innerHTML = mh;
    // gallery
    let gh = '<h4 class="st-deploy-h">Gallery</h4>';
    const mySet = new Set((MINE.list || []).map((a) => a.slug));
    const list = GAL.list.filter((a) => !mySet.has(a.slug) && matches(a, q));
    if (!GAL.loaded && GAL.loading) gh += '<div class="st-deploy-grid">' + '<div class="st-deploy-app is-skel"></div>'.repeat(3) + '</div>';
    else if (GAL.error && !GAL.list.length) gh += '<div class="st-deploy-err"><b>Couldn’t load OST Apps</b><p>' + esc(explainError(GAL.error)) + '</p><button type="button" class="st-btn" data-a="reload">Retry</button></div>';
    else if (!list.length) gh += '<div class="st-empty">' + (q ? 'No apps match “' + esc(q) + '”' + (GAL.cursor ? ' in the apps loaded so far.' : '.') : GAL.loaded ? (mySet.size ? 'No apps from other creators yet.' : 'No apps yet — deploy yours and be the first!') : 'Open this panel to load the gallery.') + '</div>';
    else gh += '<div class="st-deploy-grid">' + list.map((a) => appCard(a, false)).join('') + '</div>';
    if (GAL.cursor && !GAL.error) gh += '<button type="button" class="st-btn block st-deploy-more" data-a="more"' + (GAL.loading ? ' disabled' : '') + '>' + (GAL.loading ? 'Loading…' : 'Load more') + '</button>';
    if (GAL.error && GAL.list.length) gh += '<div class="st-deploy-warn">Couldn’t load more: ' + esc(explainError(GAL.error)) + ' <button type="button" class="st-deploy-linkbtn" data-a="more">Retry</button></div>';
    AP.list.innerHTML = gh;
  }
  function refreshApps(force) {
    if (force || !GAL.loaded || Date.now() - GAL.at > 60000) loadGallery(false);
    if (force || !MINE.list || Date.now() - MINE.at > 30000) { const p = myApps(true).catch(() => {}).finally(() => paintApps()); paintApps(); return p; }
    return Promise.resolve();
  }
  async function onAppsClick(e) {
    const b = e.target.closest('[data-a]'); if (!b || !AP.root.contains(b)) return;
    const a = b.getAttribute('data-a');
    const card = b.closest('[data-slug]'); const slug = card ? card.getAttribute('data-slug') : '';
    const app = slug ? (MINE.list || []).concat(GAL.list).find((x) => x.slug === slug) : null;
    if (a === 'reload') refreshApps(true);
    else if (a === 'more') loadGallery(true);
    else if (a === 'copy' && slug) copyLink(appUrl(slug));
    else if (a === 'unpublish' && slug) confirmUnpublish(slug, app && app.name);
    else if (a === 'openproj') { const pid = b.getAttribute('data-pid'); try { await S.projects.open(pid); revealWork(); } catch (err) { S.ui.toast('Couldn’t open that project: ' + explainError(err), 'err'); } }
    else if (a === 'remix' && slug) {
      try { await remix(slug); if (isPhone()) S.ui.setActivity(''); else if (S.editor) S.ui.setActivity('explorer'); }
      catch (err) { S.ui.toast('Remix failed: ' + err.message, 'err'); }
    }
  }

  /* ======================================================================
   * Account & Projects
   * ==================================================================== */
  const AC = { root: null, list: null, loading: false, again: false, importNote: '', busy: '' };
  function mountAccount() {
    const body = S.ui.registerActivity({ id: 'account', icon: '👤', title: 'Account & Projects', order: 90 });
    body.classList.add('st-deploy-host');
    body.innerHTML = '<div class="st-deploy-scroll"><div class="st-deploy st-deploy-acct" data-panel="account">'
      + '<section class="st-deploy-card" data-c="id"></section>'
      + '<section class="st-deploy-card" data-c="sync"></section>'
      + '<section class="st-deploy-card"><div class="st-deploy-hrow"><h4 class="st-deploy-h">Projects</h4><button type="button" class="st-ib" data-a="reload" title="Refresh" aria-label="Refresh projects">⟳</button></div>'
      + '<div class="st-deploy-btns"><button type="button" class="st-btn primary sm" data-a="new">＋ New</button>'
      // <label for> opens the picker natively everywhere (iOS ignores .click() on hidden inputs)
      + '<label class="st-btn sm" for="stDeployZipNew" role="button" tabindex="0">⬆ Import .zip</label>'
      + '<label class="st-btn sm" for="stDeployZipHere" role="button" tabindex="0" data-c="herelbl">⬆ Add .zip to this project</label>'
      + '<button type="button" class="st-btn sm" data-a="export">⬇ Export .zip</button></div>'
      + '<input type="file" id="stDeployZipNew" class="st-deploy-file" accept=".zip,application/zip,application/x-zip-compressed" data-c="zipnew" tabindex="-1" aria-hidden="true">'
      + '<input type="file" id="stDeployZipHere" class="st-deploy-file" accept=".zip,application/zip,application/x-zip-compressed" data-c="ziphere" tabindex="-1" aria-hidden="true">'
      + '<div data-c="busy"></div><div data-c="importnote"></div>'
      + '<div class="st-deploy-plist" data-c="projects"></div></section>'
      + '<section class="st-deploy-card" data-c="storage"></section>'
      + '<section class="st-deploy-card"><h4 class="st-deploy-h">OST</h4><div class="st-deploy-links">'
      + '<a href="index.html" target="_blank" rel="noopener">◉ OST home ↗</a>'
      + '<a href="index.html#social" target="_blank" rel="noopener">💬 OST Social ↗</a>'
      + '<a href="index.html#academy" target="_blank" rel="noopener">🎓 Code Academy ↗</a>'
      + '<a href="' + esc(S.APPS + '/') + '" target="_blank" rel="noopener noreferrer">🧩 OST Apps site ↗</a></div></section>'
      + '<section class="st-deploy-notes"><h4 class="st-deploy-h">Where your data lives</h4><ul>'
      + '<li><b>Projects</b> are stored in this browser (IndexedDB) and synced to your OST cloud space, so they open on any tab and coding agents with your token can edit them.</li>'
      + '<li><b>Your identity</b> is the OST Mesh key pair kept in this browser — the same one OST Mesh and OST Social use. Clearing site data or switching browsers gives you a new identity and an empty cloud space, so export a .zip of anything you care about.</li>'
      + '<li><b>Deployed apps are public.</b> Agent tokens (🔑 Agent API) act as you within their scopes — revoke them when you’re done.</li>'
      + '<li><b>Your code runs only in sandboxes</b>, never with access to your OST wallet. There is no server-side execution.</li>'
      + '</ul></section>'
      + '</div></div>';
    AC.root = body.querySelector('.st-deploy-acct');
    const q = (k) => AC.root.querySelector('[data-c="' + k + '"]');
    Object.assign(AC, { id: q('id'), sync: q('sync'), projects: q('projects'), storage: q('storage'), zipnew: q('zipnew'), ziphere: q('ziphere'), herelbl: q('herelbl'), note: q('importnote'), busyEl: q('busy') });
    const onPick = (input, mode) => input.addEventListener('change', () => { const f = input.files && input.files[0]; input.value = ''; if (f) importZipFile(f, mode); });
    onPick(AC.zipnew, 'new'); onPick(AC.ziphere, 'here');
    AC.root.addEventListener('keydown', (e) => { const l = e.target.closest && e.target.closest('label[for]'); if (l && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); l.click(); } });
    AC.herelbl.addEventListener('click', (e) => { if (!S.projects.current() || AC.busy) { e.preventDefault(); S.ui.toast(AC.busy ? 'Wait for the current import to finish.' : 'Open a project first.', 'warn'); } });
    AC.root.addEventListener('click', onAccountClick);
    paintIdentity(); paintSyncCard();
  }
  function profileEmoji() { try { const p = JSON.parse(localStorage.getItem('ost.mesh.app.profile.v1') || 'null'); return p && p.emoji ? clean(p.emoji, 8) : ''; } catch (_) { return ''; } }
  function paintIdentity() {
    if (!AC.id) return;
    const addr = S.id.address, name = S.id.name;
    const av = profileEmoji() || (name ? Array.from(name)[0].toUpperCase() : '👤');
    AC.id.innerHTML = '<h4 class="st-deploy-h">Identity</h4>'
      + '<div class="st-deploy-idrow"><span class="st-deploy-av lg" aria-hidden="true">' + esc(av) + '</span><div class="st-deploy-idt"><b>' + (name ? esc(name) : '<span class="st-muted">No display name</span>') + '</b><code title="' + esc(addr) + '">' + esc(addr || 'loading…') + '</code></div></div>'
      + '<dl class="st-deploy-dl"><dt>Fingerprint</dt><dd><code>' + esc(S.id.fingerprint || '—') + '</code></dd>'
      + '<dt>Directory</dt><dd>' + (S.id.announced ? '<span class="ok">✓ Registered with OST</span>' : '<span class="warn">⚠ Not registered yet</span> <button type="button" class="st-deploy-linkbtn" data-a="announce">Retry</button>') + '</dd></dl>'
      + '<div class="st-deploy-btns"><button type="button" class="st-btn sm" data-a="copyaddr"' + (addr ? '' : ' disabled') + '>Copy address</button><a class="st-btn sm" href="index.html#social" target="_blank" rel="noopener">Edit profile in OST Social ↗</a></div>'
      + '<p class="st-note">Your Studio identity is your OST Mesh identity on this browser. The name and avatar you set in OST Social show as the author of your apps.</p>';
  }
  function paintSyncCard() {
    if (!AC.sync) return;
    const p = S.projects.current(); const st = S.projects.syncState();
    AC.sync.innerHTML = '<h4 class="st-deploy-h">Cloud sync</h4>'
      + (p ? '<div class="st-deploy-sync s-' + esc(st) + '"><b>' + esc(SYNC_LABEL[st] || st) + '</b><span class="st-muted"> — “' + esc(p.name) + '”' + (lastSyncDetail ? ' · ' + esc(lastSyncDetail) : '') + '</span></div>'
        + '<div class="st-deploy-btns"><button type="button" class="st-btn sm" data-a="syncnow">⟳ Sync now</button></div>'
        : '<p class="st-muted">No project open.</p>')
      + '<p class="st-note">Edits save in this browser instantly and sync to the cloud about every 2 s while the tab is open. Changes made by coding agents through the API show up here within seconds.</p>';
  }
  async function paintAccount() {
    if (!AC.root) return;
    paintIdentity(); paintSyncCard();
    paintStorage();
    if (AC.loading) { AC.again = true; return; }
    AC.loading = true;
    if (!AC.list) paintProjects();
    try { AC.list = await S.projects.list(); } catch (_) { AC.list = AC.list || []; }
    finally { AC.loading = false; }
    paintProjects();
    if (AC.again) { AC.again = false; paintAccount(); }
  }
  function paintProjects() {
    if (!AC.projects) return;
    AC.busyEl.innerHTML = AC.busy ? '<div class="st-deploy-info" role="status">' + esc(AC.busy) + '</div>' : '';
    AC.note.innerHTML = AC.importNote;
    const exp = AC.root.querySelector('[data-a="export"]');
    const cur = S.projects.current();
    if (AC.herelbl) { const off = !cur || !!AC.busy; AC.herelbl.classList.toggle('is-disabled', off); AC.herelbl.setAttribute('aria-disabled', off ? 'true' : 'false'); }
    if (exp) exp.disabled = !cur;
    if (!AC.list) { AC.projects.innerHTML = '<div class="st-muted st-deploy-pad">Loading projects…</div>'; return; }
    const list = AC.list;
    if (!list.length) { AC.projects.innerHTML = '<div class="st-empty">No projects yet — create one or import a .zip.</div>'; return; }
    AC.projects.innerHTML = list.map((p) => {
      const isCur = cur && cur.id === p.id;
      const where = [p.local === false ? 'cloud only' : 'this browser'];
      if (p.cloud && p.local !== false) where.push('☁ synced');
      const live = liveOf(p.id);
      return '<div class="st-deploy-prow' + (isCur ? ' is-cur' : '') + '" data-id="' + esc(p.id) + '">'
        + '<button type="button" class="st-deploy-pmain" data-a="open" title="' + (isCur ? 'Open now' : 'Open') + '"><b>' + esc(p.name) + (isCur ? ' <em>open</em>' : '') + '</b>'
        + '<small>' + esc([p.template || 'custom'].concat(where).join(' · ')) + (p.updatedAt ? ' · ' + esc(ago(p.updatedAt)) : '') + (live ? ' · 🚀 ' + esc(live.slug) : '') + '</small></button>'
        + '<div class="st-deploy-pacts">'
        + '<button type="button" class="st-ib" data-a="rename" title="Rename" aria-label="Rename ' + esc(p.name) + '">✎</button>'
        + '<button type="button" class="st-ib" data-a="dup" title="Duplicate" aria-label="Duplicate ' + esc(p.name) + '">⧉</button>'
        + '<button type="button" class="st-ib" data-a="del" title="Delete" aria-label="Delete ' + esc(p.name) + '">🗑</button>'
        + '</div></div>';
    }).join('') + '<p class="st-note">' + esc(plural(list.length, 'project')) + ' · up to 50 in your cloud space, ' + PROJ_LIMITS.files + ' files and ' + U.fmtBytes(PROJ_LIMITS.projectBytes) + ' each.</p>';
  }
  async function paintStorage() {
    if (!AC.storage) return;
    const cur = S.projects.current();
    const files = cur ? S.fs.list() : [];
    const bytes = files.reduce((n, f) => n + (f.size || 0), 0);
    let est = null, persisted = null;
    try { if (navigator.storage && navigator.storage.estimate) est = await navigator.storage.estimate(); } catch (_) {}
    try { if (navigator.storage && navigator.storage.persisted) persisted = await navigator.storage.persisted(); } catch (_) {}
    const pct = (a, b) => Math.max(0, Math.min(100, b ? (a / b) * 100 : 0));
    AC.storage.innerHTML = '<h4 class="st-deploy-h">Storage</h4>'
      + (cur ? '<div class="st-deploy-meter"><div class="st-deploy-mrow"><span>“' + esc(cur.name) + '”</span><span>' + esc(U.fmtBytes(bytes)) + ' / ' + esc(U.fmtBytes(PROJ_LIMITS.projectBytes)) + ' · ' + files.length + '/' + PROJ_LIMITS.files + ' files</span></div><div class="st-deploy-bar"><i style="width:' + pct(bytes, PROJ_LIMITS.projectBytes).toFixed(1) + '%"></i></div></div>' : '')
      + (est && est.quota ? '<div class="st-deploy-meter"><div class="st-deploy-mrow"><span>This browser (all OST data)</span><span>' + esc(U.fmtBytes(est.usage || 0)) + ' of ~' + esc(U.fmtBytes(est.quota)) + '</span></div><div class="st-deploy-bar"><i style="width:' + pct(est.usage || 0, est.quota).toFixed(1) + '%"></i></div></div>' : '<p class="st-muted">This browser doesn’t report its storage use.</p>')
      + (persisted === true ? '<p class="st-note">✓ Persistent storage is on — the browser won’t clear Studio data to free space.</p>'
        : persisted === false ? '<p class="st-note">The browser may clear site data when the device runs low on space. <button type="button" class="st-deploy-linkbtn" data-a="persist">Ask to keep my data</button></p>' : '');
  }
  async function onAccountClick(e) {
    const b = e.target.closest('[data-a]'); if (!b || !AC.root.contains(b)) return;
    const a = b.getAttribute('data-a');
    const row = b.closest('[data-id]'); const id = row ? row.getAttribute('data-id') : '';
    const proj = id ? (AC.list || []).find((p) => p.id === id) : null;
    const cur = S.projects.current();
    try {
      if (a === 'reload') { AC.list = null; await paintAccount(); }
      else if (a === 'new') { revealWork(); S.ui.showWelcome(); }
      else if (a === 'export') { if (!cur) return; await S.projects.exportZip(); S.ui.toast('Downloading ' + cur.name + '.zip', 'ok'); }
      else if (a === 'copyaddr') { const ok = await copyText(S.id.address); S.ui.toast(ok ? 'Address copied.' : 'Couldn’t copy.', ok ? 'ok' : 'warn'); }
      else if (a === 'announce') { b.disabled = true; const ok = await S.id.announce(); S.ui.toast(ok ? 'Registered with OST.' : 'Still not registered — check your connection.', ok ? 'ok' : 'warn'); paintIdentity(); }
      else if (a === 'syncnow') { await S.projects.syncNow(); paintSyncCard(); }
      else if (a === 'persist') { let ok = false; try { ok = await navigator.storage.persist(); } catch (_) {} S.ui.toast(ok ? 'Persistent storage is on.' : 'The browser declined — it decides based on how you use the site (installing it as an app helps).', ok ? 'ok' : 'warn'); paintStorage(); }
      else if (a === 'open' && id) {
        if (cur && cur.id === id) { revealWork(); return; }
        await S.projects.open(id); revealWork();
      } else if (a === 'rename' && proj) {
        const n = await S.ui.prompt('Rename project', proj.name);
        if (!n) return;
        if (!cur || cur.id !== id) await S.projects.open(id);
        await S.projects.rename(n);
        S.ui.toast('Renamed to “' + clean(n, 60) + '”.', 'ok');
        await paintAccount();
      } else if (a === 'dup' && proj) await duplicate(id);
      else if (a === 'del' && proj) {
        const live = liveOf(id);
        const ok = await S.ui.confirm('Delete “' + proj.name + '” from this browser and the OST cloud? This can’t be undone.' + (live ? ' Its deployed app (' + live.slug + ') stays online — unpublish it in OST Apps if you want it gone.' : ''), { danger: true, okText: 'Delete' });
        if (!ok) return;
        await S.projects.remove(id);
        S.ui.toast('Deleted “' + proj.name + '”.', 'ok');
        AC.list = (AC.list || []).filter((p) => p.id !== id); paintProjects();
        paintAccount();
      }
    } catch (err) { S.ui.toast(explainError(err), 'err'); }
  }
  async function duplicate(id) {
    let cur = S.projects.current();
    if (!cur || cur.id !== id) cur = await S.projects.open(id);
    if (S.editor && S.editor.flush) { try { await S.editor.flush(); } catch (_) {} }
    const p = S.projects.current(); if (!p) return;
    const files = S.fs.snapshot();
    const meta = await S.projects.create({ name: (p.name + '-copy').slice(0, 60), template: p.template || 'custom', files });
    S.ui.toast('Duplicated into “' + meta.name + '” (' + plural(Object.keys(files).length, 'file') + ').', 'ok');
    paintAccount();
    return meta;
  }

  /* ---- .zip import ---- */
  async function loadJSZip() {
    if (!window.JSZip) await U.loadScript(JSZIP_URL);
    if (!window.JSZip) throw new Error('Couldn’t load the zip library (JSZip) — check your connection.');
    return window.JSZip;
  }
  async function readZip(file, keepRoot) {
    if (file.size > 80 * MB) throw new Error('That .zip is ' + U.fmtBytes(file.size) + ' — projects are limited to ' + U.fmtBytes(PROJ_LIMITS.projectBytes) + '.');
    const JSZip = await loadJSZip();
    let zip;
    try { zip = await JSZip.loadAsync(file); } catch (e) { throw new Error('That isn’t a readable .zip file (' + (e && e.message || e) + ').'); }
    let ents = [];
    zip.forEach((rel, ent) => { if (!ent.dir) ents.push(ent); });
    if (ents.length > 5000) throw new Error('That .zip has ' + ents.length + ' files — projects are limited to ' + PROJ_LIMITS.files + '.');
    const declared = ents.reduce((n, ent) => n + (ent._data && isNum(ent._data.uncompressedSize) ? ent._data.uncompressedSize : 0), 0);
    if (declared > 200 * MB) throw new Error('That .zip unpacks to ' + U.fmtBytes(declared) + ' — far over the ' + U.fmtBytes(PROJ_LIMITS.projectBytes) + ' project limit.');
    let items = ents.map((ent) => ({ ent, p: U.normPath(ent.name) }))
      .filter((x) => x.p && !/(^|\/)(__MACOSX|\.git|node_modules)(\/|$)/.test(x.p) && !/(^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini)$/i.test(x.p));
    // GitHub-style archives wrap everything in one top folder: strip it.
    const top = items.length ? items[0].p.split('/')[0] : '';
    if (!keepRoot && top && items.length && items.every((x) => x.p.indexOf('/') > 0 && x.p.split('/')[0] === top)) items = items.map((x) => ({ ent: x.ent, p: x.p.slice(top.length + 1) }));
    items.sort((a, b) => a.p.localeCompare(b.p));
    const files = {}, skipped = []; let total = 0, count = 0;
    for (const { ent, p } of items) {
      if (count >= PROJ_LIMITS.files) { skipped.push(p + ' — over the ' + PROJ_LIMITS.files + '-file limit'); continue; }
      const raw = ent._data && isNum(ent._data.uncompressedSize) ? ent._data.uncompressedSize : -1;
      if (raw > PROJ_LIMITS.fileBytes) { skipped.push(p + ' — ' + U.fmtBytes(raw) + ', over ' + U.fmtBytes(PROJ_LIMITS.fileBytes)); continue; }
      let content;
      try { content = U.isTextPath(p) ? await ent.async('string') : 'data:' + U.mimeOf(p) + ';base64,' + await ent.async('base64'); }
      catch (e) { skipped.push(p + ' — couldn’t be read'); continue; }
      const n = contentBytes(p, content);
      if (n > PROJ_LIMITS.fileBytes) { skipped.push(p + ' — ' + U.fmtBytes(n) + ', over ' + U.fmtBytes(PROJ_LIMITS.fileBytes)); continue; }
      if (total + n > PROJ_LIMITS.projectBytes) { skipped.push(p + ' — the project would pass ' + U.fmtBytes(PROJ_LIMITS.projectBytes)); continue; }
      files[p] = content; total += n; count++;
    }
    return { files, skipped, total };
  }
  async function importZipFile(file, mode) {
    if (AC.busy) return;
    AC.busy = 'Reading ' + file.name + '…'; AC.importNote = ''; paintProjects();
    try {
      const r = await readZip(file, mode === 'here');
      const n = Object.keys(r.files).length;
      if (!n) throw new Error('No usable files in ' + file.name + '.');
      if (mode === 'here' && S.projects.current()) {
        AC.busy = 'Adding ' + plural(n, 'file') + '…'; paintProjects();
        await S.projects.importFiles(r.files, { source: 'import' });
        S.ui.toast('Added ' + plural(n, 'file') + ' from ' + file.name + ' to “' + S.projects.current().name + '”.', 'ok');
      } else {
        const name = clean(file.name.replace(/\.zip$/i, ''), 60) || 'imported-project';
        AC.busy = 'Creating “' + name + '”…'; paintProjects();
        const meta = await S.projects.create({ name, template: 'custom', files: r.files });
        S.ui.toast('Imported “' + meta.name + '” — ' + plural(n, 'file') + ', ' + U.fmtBytes(r.total) + '.', 'ok');
        bus.emit('deploy:imported', { project: meta, files: n });
      }
      AC.importNote = r.skipped.length ? '<details class="st-deploy-warns" open><summary>' + esc(plural(r.skipped.length, 'file')) + ' skipped</summary><ul>' + r.skipped.slice(0, 40).map((s) => '<li>' + esc(s) + '</li>').join('') + (r.skipped.length > 40 ? '<li>…</li>' : '') + '</ul></details>' : '';
      AC.busy = ''; await paintAccount();
      return r;
    } catch (e) {
      AC.busy = ''; AC.importNote = '<div class="st-deploy-err" role="alert"><b>Import failed</b><p>' + esc(e.message || String(e)) + '</p></div>'; paintProjects();
      S.ui.toast('Import failed: ' + (e.message || e), 'err');
      return null;
    }
  }

  /* ======================================================================
   * wiring
   * ==================================================================== */
  mountDeploy();
  mountApps();
  mountAccount();

  S.ui.registerAction({ id: 'deploy', icon: '🚀', label: 'Deploy', title: 'Deploy to OST Apps (Ctrl/Cmd+Shift+D)', order: 30, run: () => deployCommand() });
  S.ui.registerCommand({ id: 'deploy', title: 'Deploy to OST Apps', key: 'Mod+Shift+D', run: () => deployCommand() });
  S.ui.registerCommand({ id: 'deploy.panel', title: 'Show Run & Deploy', run: () => openPanel() });
  S.ui.registerCommand({ id: 'apps.gallery', title: 'OST Apps: Browse the gallery', run: () => { S.ui.setActivity('apps'); refreshApps(); } });
  S.ui.registerCommand({ id: 'deploy.open', title: 'Open the deployed app', run: () => { const l = liveOf(curPid()); if (!l) { S.ui.toast('This project isn’t deployed yet.', 'warn'); return; } openUrl(appUrl(l.slug)); } });
  S.ui.registerCommand({ id: 'deploy.copy', title: 'Copy the deployed app’s link', run: () => { const l = liveOf(curPid()); if (!l) { S.ui.toast('This project isn’t deployed yet.', 'warn'); return; } return copyLink(appUrl(l.slug)); } });
  S.ui.registerCommand({ id: 'deploy.unpublish', title: 'Unpublish this project’s app…', run: () => { const l = liveOf(curPid()); if (!l) { S.ui.toast('This project has no live app.', 'warn'); return; } return confirmUnpublish(l.slug, l.name); } });
  S.ui.registerCommand({ id: 'account.open', title: 'Account & projects', run: () => S.ui.setActivity('account') });
  S.ui.registerCommand({ id: 'project.importZip', title: 'Import project from .zip…', run: () => AC.zipnew.click() });
  S.ui.registerCommand({ id: 'project.duplicate', title: 'Duplicate project', run: () => { const p = S.projects.current(); if (!p) { S.ui.toast('Open a project first.', 'warn'); return; } return duplicate(p.id); } });

  bus.on('activity', (e) => {
    const id = e && e.id;
    if (id === 'deploy') { paintDeploy(); refreshRemote(); }
    else if (id === 'apps') refreshApps();
    else if (id === 'account') paintAccount();
  });
  bus.on('project:open', () => {
    REMOTE.at = 0;
    paintDeploy(); paintStatus();
    if (S.ui.activity() === 'deploy') refreshRemote();
    else setTimeout(() => refreshRemote(), 1500);        // keeps the status bar's live link honest
    if (S.ui.activity() === 'account') paintAccount();
    if (S.ui.activity() === 'apps') paintApps();
  });
  bus.on('project:close', () => { paintDeploy(); paintStatus(); if (S.ui.activity() === 'account') paintAccount(); });
  bus.on('sync:state', (e) => {
    lastSyncDetail = (e && e.detail) || '';
    if (S.ui.activity() === 'deploy') paintProj();
    if (S.ui.activity() === 'account') paintSyncCard();
  });
  let fsT = 0;
  const onFs = () => { if (fsT) return; fsT = setTimeout(() => { fsT = 0; if (S.ui.activity() === 'deploy' && !ST.busy) { paintProj(); paintFormState(); } }, 300); };
  bus.on('fs:change', onFs);
  bus.on('fs:bulk', onFs);
  if (S.ready && S.ready.then) S.ready.then(() => { paintIdentity(); paintDeploy(); paintStatus(); if (S.projects.current()) setTimeout(() => refreshRemote(), 1200); if (S.ui.activity() === 'account') paintAccount(); if (S.ui.activity() === 'apps') refreshApps(); });
  setInterval(() => { if (document.hidden) return; const a = S.ui.activity(); if (a === 'deploy') { paintLive(); paintHistory(); } else if (a === 'apps') paintApps(); }, 60000);

  S.deploy = {
    deploy, apps, myApps, unpublish, remix,
    info: () => { const l = liveOf(curPid()); return l ? Object.assign({ url: appUrl(l.slug) }, l) : null; },
    open: () => openPanel(),
    busy: () => ST.busy,
    validateSlug: slugError, slugify,
    importZip: (file, opts) => importZipFile(file, opts && opts.into === 'current' ? 'here' : 'new'),
    duplicate: (id) => duplicate(id || curPid())
  };
  bus.emit('deploy:ready', {});
})();

/* ==========================================================================
 * OST Studio · agent — AI coding agent + Agent API (tokens) panels
 * --------------------------------------------------------------------------
 * STUDIO.agent = { ask(prompt, opts?) -> Promise<result>, stop(), busy(), open(), clear() }
 *  - "AI Agent" activity: a chat with a tool-using model behind
 *    POST /studio/v1/ai/chat (OpenAI tool-call shape). The agent LOOP runs here:
 *    the model asks for tools, they run against STUDIO.fs / STUDIO.runtime, the
 *    results go back as role:'tool' messages — up to 14 model steps a request.
 *  - Each request gets a "Changes" card (added / modified / deleted files with
 *    +/- line counts) with Undo all / Redo, built from a snapshot taken before
 *    the agent's first write to each file it touches.
 *  - The conversation is kept per project in IndexedDB (last 40 messages) and
 *    the context sent to the model is bounded (old tool output is trimmed first).
 *  - "Agent API" activity: tokens for external coding agents (Claude Code,
 *    Cursor, scripts), copyable curl examples and an agent brief.
 * Contract: project-docs/ost-studio.md (module "agent"; §4 /ai/chat, /tokens).
 * SECURITY: never executes code itself (run/build go through the runtime's
 * sandboxes); model output is escaped before the tiny Markdown renderer adds
 * tags; only project files and the user's messages are sent — never wallet,
 * identity or other localStorage data.
 * ========================================================================== */
(function () {
  'use strict';
  const S = window.STUDIO;
  if (!S || S.agent) return;
  const U = S.util, esc = U.esc, bus = S.bus;

  /* ======================================================================
   * constants
   * ==================================================================== */
  const MAX_STEPS = 14;                    // model requests per user request
  const TOOL_OUT_MAX = 12000;              // chars of one tool result sent to the model
  const RUN_TIMEOUT = 15000;               // agent runs (contract §3)
  const KEEP_ITEMS = 40;                   // messages persisted per project
  const MEM_ITEMS = 400;                   // messages kept in memory
  const CONTEXT_CHARS = 48000;             // whole request budget, ~12k tokens (server cap is 120k chars / 60 msgs; Groq TPM is the tighter limit)
  const SYS_MAX = 23000;                   // server slices every message at 24k
  const ACTIVE_MAX = 20000;                // include the open file when ≤ 20 KB
  const MAX_API_MSGS = 54;
  const SEL_MAX = 8000;
  const SNAP_BUDGET = 3 * 1024 * 1024;     // chars of undo snapshots kept on disk per project
  const AI_LIMIT = 40, AI_WINDOW = 10 * 60 * 1000;
  const REQ_KEY = 'ost.studio.agent.reqs.v1';
  const API_BASE = S.API + '/studio/v1';
  const AGENTS_MD = API_BASE + '/agents.md';
  const STOP = { stopped: true };

  /* ======================================================================
   * small helpers
   * ==================================================================== */
  function h(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  const clip = (s, n) => { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n) + '\n…[' + (s.length - n) + ' more chars]' : s; };
  function clipLines(s, maxLines, maxChars) {
    s = String(s == null ? '' : s);
    const a = s.split('\n'); let out = a.length > maxLines ? a.slice(0, maxLines).join('\n') + '\n…(' + (a.length - maxLines) + ' more lines)' : s;
    if (out.length > maxChars) out = out.slice(0, maxChars) + '\n…';
    return out;
  }
  function splitLines(s) { if (!s) return []; const a = String(s).split('\n'); if (a[a.length - 1] === '') a.pop(); return a; }
  const lineCount = (s) => splitLines(s).length;
  const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
  const cssEsc = (s) => (window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/["\\]/g, '\\$&'));
  const coarse = () => { try { return window.matchMedia('(pointer: coarse)').matches; } catch (_) { return false; } };
  const fenceLang = (p) => { const l = U.langOf(p); return l === 'plaintext' ? '' : l; };
  function fmtAgo(ts) {
    if (!ts) return 'never';
    const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (s < 60) return 'just now'; if (s < 3600) return Math.round(s / 60) + ' min ago'; if (s < 86400) return Math.round(s / 3600) + ' h ago';
    return Math.round(s / 86400) + ' d ago';
  }
  function fmtWait(sec) { sec = Math.max(1, Math.round(Number(sec) || 0)); return sec < 90 ? sec + ' s' : Math.ceil(sec / 60) + ' min'; }
  function safe(fn, d) { try { return fn(); } catch (_) { return d; } }

  /** Line-level +/- counts: LCS on the changed middle, multiset fallback for huge files. */
  function lineDiff(a, b) {
    const A = splitLines(a), B = splitLines(b);
    let s = 0; while (s < A.length && s < B.length && A[s] === B[s]) s++;
    let ea = A.length, eb = B.length; while (ea > s && eb > s && A[ea - 1] === B[eb - 1]) { ea--; eb--; }
    const n = ea - s, m = eb - s;
    if (!n || !m) return { add: m, del: n };
    let lcs = 0;
    if (n * m <= 4000000) {
      let prev = new Uint32Array(m + 1), cur = new Uint32Array(m + 1);
      for (let i = 1; i <= n; i++) {
        const ai = A[s + i - 1];
        for (let j = 1; j <= m; j++) cur[j] = ai === B[s + j - 1] ? prev[j - 1] + 1 : (prev[j] > cur[j - 1] ? prev[j] : cur[j - 1]);
        const t = prev; prev = cur; cur = t;
      }
      lcs = prev[m];
    } else {
      const cnt = new Map(); for (let i = s; i < ea; i++) cnt.set(A[i], (cnt.get(A[i]) || 0) + 1);
      for (let j = s; j < eb; j++) { const c = cnt.get(B[j]); if (c) { cnt.set(B[j], c - 1); lcs++; } }
    }
    return { add: m - lcs, del: n - lcs };
  }

  async function copyText(text, btn) {
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; } catch (_) {
      try {
        const ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
        document.body.appendChild(ta); ta.select(); ok = document.execCommand('copy'); ta.remove();
      } catch (_) { ok = false; }
    }
    if (btn) {
      if (!btn.dataset.label) btn.dataset.label = btn.textContent;
      btn.textContent = ok ? 'Copied ✓' : 'Copy failed';
      clearTimeout(btn._t); btn._t = setTimeout(() => { btn.textContent = btn.dataset.label; }, 1500);
    }
    if (!ok) S.ui.toast('Could not copy — select the text and copy it manually.', 'warn');
    return ok;
  }

  /* ======================================================================
   * safe Markdown (escape first, then add a small set of tags)
   * ==================================================================== */
  function safeUrl(u) { return /^(https?:\/\/|mailto:)/i.test(u) && u.indexOf('\u0000') < 0; }
  function codeSpan(c) {
    const m = String(c).match(/^([^\s:]+?)(?::(\d+))?$/);
    const p = m ? U.normPath(m[1]) : '';
    if (p && /[./]/.test(p) && safe(() => S.fs.exists(p), false)) return `<button type="button" class="st-agent-fileref" data-open="${esc(p)}"${m[2] ? ` data-line="${esc(m[2])}"` : ''} title="Open ${esc(p)}">${esc(c)}</button>`;
    return `<code>${esc(c)}</code>`;
  }
  // Links are tokenized out of the RAW text (like code spans) and rebuilt from escaped parts, so no
  // regex ever runs over generated HTML (a URL inside an href can't be re-linked into a quote breakout).
  function fmt(x) {
    x = x.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>').replace(/(^|[^\w])__([^_\n]+)__(?!\w)/g, '$1<strong>$2</strong>');
    x = x.replace(/(^|[^\w*])\*([^*\s][^*\n]*?)\*(?![\w*])/g, '$1<em>$2</em>');
    return x.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');
  }
  function anchor(u, textHtml) { return `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${textHtml}</a>`; }
  function inline(s) {
    const codes = [], links = [];
    s = String(s).replace(/[\u0000\u0001]/g, '');
    s = s.replace(/`([^`\n]+)`/g, (_, c) => { codes.push(c); return '\u0000' + (codes.length - 1) + '\u0000'; });
    const keep = (html) => { links.push(html); return '\u0001' + (links.length - 1) + '\u0001'; };
    s = s.replace(/\[([^\]\n]+)\]\(([^()\s"'<>]+)\)/g, (m, t, u) => (safeUrl(u) ? keep(anchor(u, fmt(esc(t)))) : t));
    s = s.replace(/(^|[\s(])(https?:\/\/[^\s<>"'\u0000\u0001]+[^\s<>"'\u0000\u0001.,;:!?)])/g, (m, pre, u) => pre + keep(anchor(u, esc(u))));
    const x = fmt(esc(s)).replace(/\u0001(\d+)\u0001/g, (_, n) => links[Number(n)]);
    return x.replace(/\u0000(\d+)\u0000/g, (_, n) => codeSpan(codes[Number(n)]));
  }
  function codeBlock(code, lang) {
    return `<div class="st-agent-code"><div class="st-agent-codebar"><span>${esc(lang || 'code')}</span><button type="button" class="st-agent-copy">Copy</button></div><pre><code>${esc(code)}</code></pre></div>`;
  }
  function md(src) {
    const lines = String(src == null ? '' : src).replace(/\u0000/g, '').replace(/\r\n?/g, '\n').split('\n');
    const html = []; let para = [], list = null, quote = [];
    const flushPara = () => { if (para.length) { html.push('<p>' + para.map(inline).join('<br>') + '</p>'); para = []; } };
    const flushList = () => { if (list) { html.push('<' + list.type + '>' + list.items.map((t) => '<li>' + inline(t) + '</li>').join('') + '</' + list.type + '>'); list = null; } };
    const flushQuote = () => { if (quote.length) { html.push('<blockquote>' + quote.map(inline).join('<br>') + '</blockquote>'); quote = []; } };
    const flushAll = () => { flushPara(); flushList(); flushQuote(); };
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i];
      const fence = ln.match(/^\s*(`{3,}|~{3,})\s*([\w+#.-]*)[^`]*$/);
      if (fence) {
        flushAll();
        const mark = fence[1][0], len = fence[1].length, code = [];
        i++;
        while (i < lines.length) { const t = lines[i].trim(); if (t.length >= len && t[0] === mark && new RegExp('^\\' + mark + '{' + len + ',}\\s*$').test(t)) break; code.push(lines[i]); i++; }
        html.push(codeBlock(code.join('\n'), fence[2]));
        continue;
      }
      if (/^\s*$/.test(ln)) { flushAll(); continue; }
      const hd = ln.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
      if (hd) { flushAll(); html.push((hd[1].length <= 2 ? '<h4>' : '<h5>') + inline(hd[2]) + (hd[1].length <= 2 ? '</h4>' : '</h5>')); continue; }
      if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(ln)) { flushAll(); html.push('<hr>'); continue; }
      const q = ln.match(/^\s*>\s?(.*)$/);
      if (q) { flushPara(); flushList(); quote.push(q[1]); continue; }
      flushQuote();
      const li = ln.match(/^\s*([-*+]|\d{1,3}[.)])\s+(.*)$/);
      if (li) { flushPara(); const type = /\d/.test(li[1]) ? 'ol' : 'ul'; if (!list || list.type !== type) { flushList(); list = { type, items: [] }; } list.items.push(li[2]); continue; }
      if (list && /^\s{2,}\S/.test(ln)) { list.items[list.items.length - 1] += ' ' + ln.trim(); continue; }
      flushList(); para.push(ln);
    }
    flushAll();
    return html.join('');
  }

  /* ======================================================================
   * conversation storage — IndexedDB per project (memory fallback)
   * ==================================================================== */
  const IDB = (() => {
    let dbp = null; const mem = new Map();
    function open() {
      if (dbp) return dbp;
      dbp = new Promise((res) => {
        try {
          const r = indexedDB.open('ost-studio-agent', 1);
          r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains('convos')) r.result.createObjectStore('convos', { keyPath: 'pid' }); };
          r.onsuccess = () => res(r.result); r.onerror = () => res(null); r.onblocked = () => res(null);
        } catch (_) { res(null); }
      });
      return dbp;
    }
    function tx(mode, fn) {
      return open().then((d) => new Promise((res) => {
        if (!d) { const q = fn(null); res(q && typeof q === 'object' && 'result' in q ? q.result : q); return; }
        try { const t = d.transaction('convos', mode); const q = fn(t.objectStore('convos')); t.oncomplete = () => res(q && 'result' in q ? q.result : undefined); t.onerror = () => res(null); t.onabort = () => res(null); } catch (_) { res(null); }
      }));
    }
    return {
      get: (pid) => tx('readonly', (s) => (s ? s.get(pid) : { result: mem.get(pid) || null })).then((v) => v || null),
      put: (rec) => tx('readwrite', (s) => { if (s) return s.put(rec); mem.set(rec.pid, rec); return null; }),
      del: (pid) => tx('readwrite', (s) => { if (s) return s.delete(pid); mem.delete(pid); return null; })
    };
  })();

  /* ======================================================================
   * state
   * ==================================================================== */
  const C = {
    pid: '', proj: null, items: [], results: new Map(), calls: new Map(), turns: new Map(), model: '',
    loaded: Promise.resolve(), loading: false, busy: false, stopFlag: false, ctl: null, stopR: null, stopP: null,
    running: '', working: '', cur: null, sel: null, saveT: 0, loopP: null
  };
  const A = {};     // agent panel DOM refs

  /* ======================================================================
   * tools (OpenAI function schemas) + local execution
   * ==================================================================== */
  // Optional non-string params are left untyped on purpose: Groq validates generated calls against the
  // schema and rejects e.g. "10" for an integer — values are coerced here instead (argInt / regex === 'true').
  const P = (description, type) => (type === 'any' ? { description } : { type: type || 'string', description });
  const fn = (name, description, properties, required) => {
    const parameters = { type: 'object', properties: properties || {} };
    if (required && required.length) parameters.required = required;
    return { type: 'function', function: { name, description, parameters } };
  };
  const TOOLS = [
    fn('list_files', 'List every file in the project with its size.', {}),
    fn('read_file', 'Read a text file. Optionally a line range (1-based, inclusive). Long files are cut at about 12,000 characters — read the rest with start_line.', {
      path: P('File path relative to the project root, e.g. "src/App.jsx"'), start_line: P('First line to return (1-based integer)', 'any'), end_line: P('Last line to return (inclusive integer)', 'any')
    }, ['path']),
    fn('write_file', 'Create a file or replace a WHOLE file. Always pass the complete new content — never placeholders such as "rest unchanged".', {
      path: P('File path relative to the project root'), content: P('The complete file content')
    }, ['path', 'content']),
    fn('edit_file', 'Replace one exact snippet in a file. old_string must match the current file exactly (whitespace and indentation included) and occur exactly once — include 2-3 surrounding lines to make it unique.', {
      path: P('File path relative to the project root'), old_string: P('Exact text to find (must be unique in the file)'), new_string: P('Replacement text')
    }, ['path', 'old_string', 'new_string']),
    fn('delete_file', 'Delete a file, or a folder and everything in it.', { path: P('File or folder path') }, ['path']),
    fn('rename_file', 'Rename or move a file or folder.', { from: P('Current path'), to: P('New path') }, ['from', 'to']),
    fn('search', 'Search all text files. A plain query is a case-insensitive substring match; with regex=true it is a JavaScript regular expression (case-sensitive). Returns path:line: text for each match.', {
      query: P('Text or regular expression to find'), regex: P('true to treat query as a regular expression', 'any')
    }, ['query']),
    fn('run', 'Run the project (or one file) in the browser sandbox and return console output and errors. index.html loads the page headlessly; .js/.ts run in a Web Worker; .py runs in Pyodide. 15 s timeout.', {
      path: P('Optional file to run (e.g. "main.py", "index.html"). Defaults to the project entry.')
    }),
    fn('build', 'Bundle the web preview with esbuild and return build errors and warnings. Only for projects with an index.html.', {}),
    fn('get_problems', 'List current problems: build/run errors, editor diagnostics and recent console errors.', {})
  ];
  const TOOL_NAMES = new Set(TOOLS.map((t) => t.function.name));
  const TOOL_ICON = { list_files: '📂', read_file: '📄', write_file: '✏️', edit_file: '🩹', delete_file: '🗑', rename_file: '↔', search: '🔍', run: '▶', build: '🔨', get_problems: '⚠' };
  const TOOL_LABEL = { list_files: 'List files', read_file: 'Read', write_file: 'Write', edit_file: 'Edit', delete_file: 'Delete', rename_file: 'Rename', search: 'Search', run: 'Run', build: 'Build', get_problems: 'Problems' };
  function workingLabel(name, target) {
    switch (name) {
      case 'list_files': return 'Listing files…';
      case 'read_file': return 'Reading ' + (target || 'a file') + '…';
      case 'write_file': return 'Writing ' + (target || 'a file') + '…';
      case 'edit_file': return 'Editing ' + (target || 'a file') + '…';
      case 'delete_file': return 'Deleting ' + (target || 'a file') + '…';
      case 'rename_file': return 'Renaming ' + target + '…';
      case 'search': return 'Searching ' + target + '…';
      case 'run': return 'Running ' + (target || 'the project') + ' in the sandbox (up to 15 s)…';
      case 'build': return 'Building the preview…';
      case 'get_problems': return 'Checking problems…';
      default: return 'Running ' + name + '…';
    }
  }

  const ok = (out, extra) => Object.assign({ ok: true, out: String(out) }, extra || {});
  const err = (out, extra) => Object.assign({ ok: false, out: 'ERROR: ' + String(out) }, extra || {});
  const argStr = (v) => (v == null ? '' : typeof v === 'string' ? v : typeof v === 'object' ? JSON.stringify(v, null, 2) : String(v));
  const argInt = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : null; };
  const stateOf = (p) => (S.fs.exists(p) ? { c: S.fs.read(p), b: S.fs.isBinary(p) } : null);
  const same = (x, y) => (!x && !y) || (!!x && !!y && x.c === y.c && !!x.b === !!y.b);
  function touch(turn, paths) { for (const p of paths) if (!turn.before.has(p)) turn.before.set(p, stateOf(p)); }
  function settle(turn, paths) { for (const p of paths) turn.after.set(p, stateOf(p)); }
  function needPath(v, label) { const raw = argStr(v).trim(); if (!raw) return { e: (label || 'path') + ' is required.' }; const p = U.normPath(raw); if (!p) return { e: 'Invalid ' + (label || 'path') + ': "' + raw.slice(0, 120) + '". Use a relative path like "src/app.js" (no "..", no < > : " | ? *).' }; return { p }; }
  function notFound(p) {
    if (S.fs.folders().includes(p)) { const kids = S.fs.list().filter((f) => f.path.startsWith(p + '/')).slice(0, 30).map((f) => f.path); return p + ' is a folder. Files in it: ' + kids.join(', '); }
    const base = U.baseOf(p).toLowerCase();
    const near = S.fs.list().filter((f) => U.baseOf(f.path).toLowerCase() === base || f.path.toLowerCase().includes(base.replace(/\.[^.]+$/, ''))).slice(0, 6).map((f) => f.path);
    return 'File not found: ' + p + '.' + (near.length ? ' Did you mean: ' + near.join(', ') + '?' : ' Call list_files to see the project.');
  }
  const PLACEHOLDER_RE = /(\.\.\.|…)\s*(rest|existing|remaining|unchanged|previous|other|same)\b|\b(rest of (the )?(code|file|content)|existing code (here|remains|unchanged)|remains? (the )?same|code unchanged)\b/i;

  async function execTool(name, a, turn) {
    const cur = S.projects.current();
    if (!cur || cur.id !== turn.pid) return err('The project was closed or switched — no changes were made.');
    switch (name) {
      case 'list_files': {
        const files = S.fs.list();
        if (!files.length) return ok('The project is empty.');
        const total = files.reduce((n, f) => n + (f.size || 0), 0);
        const rows = files.slice(0, 500).map((f) => f.path + '  ' + U.fmtBytes(f.size) + (f.binary ? '  [binary]' : ''));
        return ok(plural(files.length, 'file') + ', ' + U.fmtBytes(total) + ':\n' + rows.join('\n') + (files.length > 500 ? '\n… ' + (files.length - 500) + ' more' : ''));
      }
      case 'read_file': {
        const q = needPath(a.path); if (q.e) return err(q.e); const p = q.p;
        if (!S.fs.exists(p)) return err(notFound(p));
        if (S.fs.isBinary(p)) return err(p + ' is a binary file (' + U.mimeOf(p) + ') and cannot be read as text.');
        const text = S.fs.read(p) || '';
        const all = text.split('\n'); const n = all.length;
        let s = argInt(a.start_line), e = argInt(a.end_line);
        const ranged = s != null || e != null;
        s = Math.max(1, s || 1); e = Math.min(n, e == null ? n : Math.max(s, e));
        if (s > n) return err('start_line ' + s + ' is past the end of ' + p + ' (' + n + ' lines).');
        let body = '', last = s - 1;
        for (let i = s - 1; i < e; i++) { const add = all[i] + (i < n - 1 ? '\n' : ''); if (body.length + add.length > TOOL_OUT_MAX - 400 && i > s - 1) break; body += add; last = i + 1; }
        if (body.length > TOOL_OUT_MAX - 400) body = body.slice(0, TOOL_OUT_MAX - 400);
        const head = p + ' — ' + plural(lineCount(text), 'line') + ', ' + U.fmtBytes(text.length) + (ranged || last < n ? ' (showing lines ' + s + '-' + last + ')' : '') + ':\n';
        const tail = last < e ? '\n…[cut at line ' + last + ' — call read_file with start_line=' + (last + 1) + ' to continue]' : '';
        return ok(head + body + tail, { path: p });
      }
      case 'write_file': {
        const q = needPath(a.path); if (q.e) return err(q.e); const p = q.p;
        if (a.content == null) return err('content is required (the complete file).');
        const content = argStr(a.content);
        if (S.fs.isBinary(p)) return err(p + ' is a binary file; the agent can only write text files.');
        const before = S.fs.read(p);
        if (before === content) return ok('No change — ' + p + ' already has exactly this content.', { path: p });
        touch(turn, [p]);
        try { await S.fs.write(p, content, { source: 'agent' }); } catch (e) { return err(e.message || String(e)); }
        settle(turn, [p]);
        const d = lineDiff(before || '', content);
        let msg = (before == null ? 'Created ' : 'Rewrote ') + p + ' (' + plural(lineCount(content), 'line') + ', +' + d.add + ' −' + d.del + ').';
        if (before && content.length < before.length * 0.6 && PLACEHOLDER_RE.test(content)) msg += ' WARNING: the new content is much shorter and contains a placeholder comment. write_file replaces the WHOLE file — if code was lost, write the complete file again (or use edit_file).';
        return ok(msg, { path: p });
      }
      case 'edit_file': {
        const q = needPath(a.path); if (q.e) return err(q.e); const p = q.p;
        if (!S.fs.exists(p)) return err(notFound(p) + ' Use write_file to create a new file.');
        if (S.fs.isBinary(p)) return err(p + ' is a binary file and cannot be edited.');
        const text = S.fs.read(p) || '';
        let oldS = argStr(a.old_string), newS = argStr(a.new_string);
        if (!oldS) return err('old_string is empty. Use write_file to create or replace a whole file.');
        if (oldS === newS) return err('old_string and new_string are identical — nothing to change.');
        let count = countOf(text, oldS);
        if (!count && text.includes('\r\n') && !oldS.includes('\r')) { const o2 = oldS.replace(/\n/g, '\r\n'); if (countOf(text, o2)) { oldS = o2; newS = newS.replace(/\r?\n/g, '\r\n'); count = countOf(text, oldS); } }
        if (!count) return err('old_string was not found in ' + p + '. ' + missHint(text, oldS));
        if (count > 1) return err('old_string matches ' + count + ' places in ' + p + ' (lines ' + linesOf(text, oldS).slice(0, 8).join(', ') + '). Include more surrounding lines so it matches exactly once.');
        const idx = text.indexOf(oldS);
        const next = text.slice(0, idx) + newS + text.slice(idx + oldS.length);
        touch(turn, [p]);
        try { await S.fs.write(p, next, { source: 'agent' }); } catch (e) { return err(e.message || String(e)); }
        settle(turn, [p]);
        const d = lineDiff(oldS, newS);
        return ok('Edited ' + p + ' at line ' + text.slice(0, idx).split('\n').length + ' (+' + d.add + ' −' + d.del + ').', { path: p });
      }
      case 'delete_file': {
        const q = needPath(a.path); if (q.e) return err(q.e); const p = q.p;
        const targets = S.fs.list().filter((f) => f.path === p || f.path.startsWith(p + '/')).map((f) => f.path);
        if (!targets.length) return err('Nothing to delete: ' + p + ' does not exist.');
        touch(turn, targets);
        try { await S.fs.remove(p, { source: 'agent' }); } catch (e) { return err(e.message || String(e)); }
        settle(turn, targets);
        return ok(targets.length === 1 && targets[0] === p ? 'Deleted ' + p + '.' : 'Deleted ' + plural(targets.length, 'file') + ' under ' + p + '/.', { path: p });
      }
      case 'rename_file': {
        const qa = needPath(a.from, 'from'); if (qa.e) return err(qa.e);
        const qb = needPath(a.to, 'to'); if (qb.e) return err(qb.e);
        const from = qa.p, to = qb.p;
        if (from === to) return err('from and to are the same path.');
        if (to.startsWith(from + '/')) return err('Cannot move a folder into itself.');
        const moves = S.fs.list().filter((f) => f.path === from || f.path.startsWith(from + '/')).map((f) => [f.path, to + f.path.slice(from.length)]);
        if (!moves.length) return err(notFound(from));
        const clash = moves.find(([, n]) => S.fs.exists(n));
        if (clash) return err(clash[1] + ' already exists — delete it first or pick another name.');
        const paths = moves.flat();
        touch(turn, paths);
        try { await S.fs.rename(from, to, { source: 'agent' }); } catch (e) { return err(e.message || String(e)); }
        settle(turn, paths);
        return ok('Renamed ' + from + ' → ' + to + (moves.length > 1 ? ' (' + plural(moves.length, 'file') + ')' : '') + '.', { path: to });
      }
      case 'search': {
        const query = argStr(a.query);
        if (!query) return err('query is required.');
        const isRe = a.regex === true || a.regex === 'true';
        let re = null;
        if (isRe) { try { re = new RegExp(query); } catch (e) { return err('Invalid regular expression: ' + e.message); } }
        const ql = query.toLowerCase();
        const hits = []; let total = 0; const files = new Set();
        for (const f of S.fs.list()) {
          if (f.binary) continue;
          const lines = (S.fs.read(f.path) || '').split('\n');
          for (let i = 0; i < lines.length; i++) {
            const ln = lines[i].length > 2000 ? lines[i].slice(0, 2000) : lines[i];
            if (re ? re.test(ln) : ln.toLowerCase().includes(ql)) { total++; files.add(f.path); if (hits.length < 80) hits.push(f.path + ':' + (i + 1) + ': ' + ln.trim().slice(0, 200)); }
          }
        }
        if (!total) return ok('No matches for ' + (isRe ? '/' + query + '/' : '"' + query + '"') + '.');
        return ok(total + (total === 1 ? ' match' : ' matches') + ' in ' + plural(files.size, 'file') + (total > hits.length ? ' (first ' + hits.length + ' shown)' : '') + ':\n' + hits.join('\n'));
      }
      case 'run': {
        if (!S.runtime || typeof S.runtime.runCapture !== 'function') return err('The runtime is not loaded, so code cannot be run right now.');
        let path = '';
        if (a.path != null && argStr(a.path).trim()) { const q = needPath(a.path); if (q.e) return err(q.e); path = q.p; if (!S.fs.exists(path)) return err(notFound(path)); }
        const r = await raceStop(S.runtime.runCapture(path || undefined, { timeoutMs: RUN_TIMEOUT }));
        if (r === STOP) return { ok: false, cancelled: true, out: 'Cancelled — the user stopped the agent while the code was running.' };
        const label = path || safe(() => U.entryFor(), '') || 'project';
        const out = String((r && r.output) || '');
        const body = out.length > 9500 ? out.slice(0, 2000) + '\n…[' + (out.length - 9000) + ' chars cut]…\n' + out.slice(-7000) : out;
        const head = (r && r.ok ? 'Run OK' : 'Run FAILED') + ' — ' + label + ' (' + (((r && r.ms) || 0) / 1000).toFixed(1) + ' s)';
        return { ok: !!(r && r.ok), out: head + '\n' + (body ? 'Console output:\n' + body : '(no console output)') + (r && r.error ? '\nError: ' + r.error : ''), path };
      }
      case 'build': {
        if (!S.runtime || typeof S.runtime.build !== 'function') return err('The runtime is not loaded, so the project cannot be built right now.');
        if (!S.fs.exists('index.html')) return err('build only applies to web projects with an index.html — use run for scripts and Python.');
        const r = await raceStop(S.runtime.build({ mode: 'preview' }));
        if (r === STOP) return { ok: false, cancelled: true, out: 'Cancelled — the user stopped the agent during the build.' };
        const fmt = (x) => (x.path ? x.path + (x.line ? ':' + x.line + (x.col ? ':' + x.col : '') : '') + ' — ' : '') + String(x.text || x.message || '').split('\n')[0].slice(0, 300);
        const errs = (r && r.errors) || [], warns = (r && r.warnings) || [];
        const ms = ' (' + (((r && r.ms) || 0) / 1000).toFixed(1) + ' s)';
        if (r && r.ok) return ok('Build OK' + ms + (warns.length ? '\n' + plural(warns.length, 'warning') + ':\n' + warns.slice(0, 30).map(fmt).join('\n') : '') + '\n(The build only bundles the code; call run to see runtime errors.)');
        return { ok: false, out: 'Build FAILED' + ms + ' with ' + plural(errs.length, 'error') + ':\n' + errs.slice(0, 40).map(fmt).join('\n') + (warns.length ? '\nWarnings:\n' + warns.slice(0, 20).map(fmt).join('\n') : '') };
      }
      case 'get_problems': return ok(problemsText());
      default: return err('Unknown tool "' + name + '". Available tools: ' + [...TOOL_NAMES].join(', ') + '.');
    }
  }
  function countOf(text, s) { let n = 0, i = 0; while ((i = text.indexOf(s, i)) >= 0) { n++; i += s.length || 1; if (n > 999) break; } return n; }
  function linesOf(text, s) { const out = []; let i = 0; while ((i = text.indexOf(s, i)) >= 0 && out.length < 20) { out.push(text.slice(0, i).split('\n').length); i += s.length || 1; } return out; }
  function missHint(text, oldS) {
    const first = oldS.split('\n').map((l) => l.trim()).find((l) => l.length >= 3);
    if (first) {
      const lines = text.split('\n'); const at = [];
      for (let i = 0; i < lines.length && at.length < 6; i++) if (lines[i].trim() === first || (first.length > 12 && lines[i].includes(first))) at.push(i + 1);
      if (at.length) return 'Its first line appears (ignoring indentation) at line ' + at.join(', ') + ' — read_file those lines and copy the snippet exactly, including whitespace.';
    }
    return 'Read the file again with read_file and copy the snippet exactly (whitespace and indentation included).';
  }

  // Recent console errors (for get_problems) — the runtime's Problems list is not exposed.
  const RECENT = [];
  bus.on('console', (e) => { if (e && e.level === 'error') { RECENT.push({ text: String(e.text || '').slice(0, 400), source: e.source || '', ts: Date.now() }); if (RECENT.length > 30) RECENT.shift(); } });
  bus.on('run:start', () => { RECENT.length = 0; });
  bus.on('project:open', () => { RECENT.length = 0; });
  function problemsText() {
    const out = [], seen = new Set();
    const add = (sev, path, line, col, text, src) => {
      const t = String(text || '').split('\n')[0].slice(0, 300); if (!t) return;
      const key = sev + '|' + (path || '') + '|' + (line || 0) + '|' + t; if (seen.has(key)) return; seen.add(key);
      out.push('[' + sev + '] ' + (path ? path + (line ? ':' + line + (col ? ':' + col : '') : '') + ' — ' : '') + t + (src ? ' (' + src + ')' : ''));
    };
    let list = null;
    if (S.runtime && typeof S.runtime.problems === 'function') { try { list = S.runtime.problems(); } catch (_) { list = null; } }
    let buildNote = '';
    if (Array.isArray(list)) { for (const p of list) add(p.severity === 'warning' ? 'warning' : 'error', p.path, p.line, p.col, p.text || p.message, p.source); }
    else {
      const lb = safe(() => S.runtime && S.runtime.lastBuild && S.runtime.lastBuild(), null);
      if (lb) {
        for (const p of lb.errors || []) add('error', p.path, p.line, p.col, p.text, 'build');
        for (const p of lb.warnings || []) add('warning', p.path, p.line, p.col, p.text, 'build');
        buildNote = 'Last ' + (lb.mode || '') + ' build: ' + (lb.ok ? 'OK' : 'failed') + ', ' + fmtAgo(lb.at) + '.';
      }
    }
    try { for (const m of (S.editor && S.editor.markers && S.editor.markers()) || []) if (m.severity === 'error' || m.severity === 'warning') add(m.severity, m.path, m.line, m.col, m.message || m.text, m.source || m.owner); } catch (_) {}
    for (const e of RECENT) if (Date.now() - e.ts < 5 * 60 * 1000) add('error', '', 0, 0, e.text, 'console' + (e.source ? ' · ' + e.source : ''));
    const tail = (buildNote ? buildNote + ' ' : '') + 'Problems come from the last build/run, the editor diagnostics and recent console errors — call build or run to refresh them.';
    if (!out.length) return 'No problems found. ' + tail;
    return plural(out.length, 'problem') + ':\n' + out.slice(0, 60).join('\n') + (out.length > 60 ? '\n… ' + (out.length - 60) + ' more' : '') + '\n' + tail;
  }
  function raceStop(p) { return C.stopP ? Promise.race([p, C.stopP]) : p; }

  /* ======================================================================
   * context: system prompt + bounded message history
   * ==================================================================== */
  const KIND_DESC = {
    web: 'web app — HTML + CSS + JavaScript modules, bundled by esbuild in the browser',
    react: 'React app — JSX/TSX bundled by esbuild in the browser, react/react-dom from esm.sh',
    python: 'Python program — runs in Pyodide (CPython on WebAssembly)',
    node: 'JavaScript/TypeScript script — runs in a sandboxed Web Worker',
    static: 'static site — HTML/CSS/assets'
  };
  function systemMessages() {
    const proj = S.projects.current() || { name: '' };
    const kind = safe(() => U.projectKind(), 'static');
    const entry = safe(() => U.entryFor(kind), '');
    const files = S.fs.list();
    const total = files.reduce((n, f) => n + (f.size || 0), 0);
    let list = '', shown = 0;
    for (const f of files) { const ln = '- ' + f.path + ' (' + U.fmtBytes(f.size) + (f.binary ? ', binary' : '') + ')\n'; if (list.length + ln.length > 6000) break; list += ln; shown++; }
    if (shown < files.length) list += '- … ' + (files.length - shown) + ' more (call list_files)\n';
    const active = safe(() => S.editor && S.editor.active && S.editor.active(), null);
    const text = [
      'You are OST Agent, the AI coding agent built into OST Studio — a VS Code-style IDE that runs entirely in the user\'s web browser, inside the OST web app.',
      'You change the user\'s current project by calling the tools you are given. Your edits apply immediately (the user sees them live and can undo each request).',
      '',
      '## Project',
      'Name: ' + proj.name,
      'Kind: ' + kind + ' (' + (KIND_DESC[kind] || kind) + ')',
      'Entry: ' + (entry || '(none)'),
      active ? 'Open in the editor: ' + active : 'No file is open in the editor.',
      'Files (' + files.length + ', ' + U.fmtBytes(total) + '):',
      (list || '(the project is empty)\n').trimEnd(),
      '',
      '## Runtime — be accurate about it',
      '- Code never runs on a server. It runs in browser sandboxes in the user\'s tab, with no access to their wallet, cookies or OST account:',
      '  - web/react/static: index.html is bundled with esbuild-wasm (JSX/TS supported) and shown in a sandboxed iframe preview. Load scripts with <script type="module" src="…">.',
      '  - npm packages: import them by bare name (e.g. import confetti from "canvas-confetti"); they load from https://esm.sh at the version in package.json "dependencies" (or latest). There is no npm install, no node_modules, no Node.js built-ins (fs, path, http, process, child_process) and no require().',
      '  - .js/.ts scripts run in a sandboxed Web Worker: top-level await and fetch work; there is no DOM.',
      '  - Python runs in Pyodide (CPython 3.12 on WebAssembly); numpy, pandas and pure-Python packages install on import; input() returns an empty string; no sockets or threads.',
      '- Hosting is static only: the user deploys with the Deploy button to https://ost-apps.nachogtavl.workers.dev/<slug>/ (you cannot deploy). No backend, database or server-side secrets — use localStorage or public APIs. Never put private keys, seed phrases or API secrets in files: deployed apps are public.',
      '- OST runs on Solana devnet (test tokens, never real money).',
      '',
      '## How to work',
      '1. Look before you change: read the files you will edit (the open file is included below). Never guess what a file contains.',
      '2. Prefer edit_file for focused changes: copy old_string exactly from the current file (same whitespace) and make it unique with 2-3 surrounding lines.',
      '3. Use write_file for new files or full rewrites of small files, always with the COMPLETE content — never "..." or "rest unchanged" placeholders.',
      '4. Keep changes small and in the existing style; do not reformat or rename unrelated code.',
      '5. After changing code, verify: call run (for web projects it loads the page and reports console errors) or build, then fix what fails — at most 2-3 fix attempts.',
      '6. If the user asks a question or wants an explanation, answer without editing files.',
      '7. Finish with a short Markdown reply: what you changed (file + one line each) and how to see it (e.g. "press Run"). Do not paste whole files into the reply. Be honest: only say something works if a tool result showed it.'
    ].join('\n');
    const msgs = [{ role: 'system', content: text.slice(0, SYS_MAX) }];
    if (active && S.fs.exists(active) && !S.fs.isBinary(active)) {
      const c = S.fs.read(active) || '';
      if (c.length <= ACTIVE_MAX) msgs.push({ role: 'system', content: 'Current content of the open file `' + active + '` (' + plural(lineCount(c), 'line') + '):\n```' + fenceLang(active) + '\n' + c + '\n```' });
      else msgs.push({ role: 'system', content: 'The open file `' + active + '` is ' + U.fmtBytes(c.length) + ' — too large to include here; use read_file with start_line / end_line.' });
    }
    return msgs;
  }
  function compactArgs(str, n) {
    str = String(str || '');
    if (str.length <= n) return str;
    try {
      const o = JSON.parse(str);
      if (o && typeof o === 'object') { for (const k of Object.keys(o)) if (typeof o[k] === 'string' && o[k].length > 160) o[k] = '[' + o[k].length + ' chars omitted to save context]'; return JSON.stringify(o); }
    } catch (_) {}
    return '{}';
  }
  // The hub slices any tool_call arguments over 24k chars (invalid JSON) — keep every call under that.
  const ARG_MAX = 20000;
  function buildMessages() {
    const sys = systemMessages();
    const sysSize = sys.reduce((n, m) => n + m.content.length, 0);
    const msgs = [];
    for (const it of C.items) {
      if (it.role === 'user') msgs.push({ role: 'user', content: it.content });
      else if (it.role === 'assistant') {
        const calls = (it.tool_calls || []).filter((tc) => tc && tc.id && tc.function);
        if (!it.content && !calls.length) continue;
        const m = { role: 'assistant', content: it.content || '' };
        if (calls.length) m.tool_calls = calls.map((tc) => ({ id: tc.id, type: 'function', function: { name: tc.function.name, arguments: compactArgs(tc.function.arguments || '{}', ARG_MAX) } }));
        msgs.push(m);
        // Every call gets exactly one tool message, right after the assistant message.
        for (const tc of calls) {
          const r = C.results.get(tc.id);
          msgs.push({ role: 'tool', tool_call_id: tc.id, name: tc.function.name, content: r ? String(r.content || '') : 'Not run — the request was stopped or interrupted before this tool ran.' });
        }
      }
    }
    const size = (m) => (m.content ? m.content.length : 0) + (m.tool_calls ? JSON.stringify(m.tool_calls).length : 0) + 16;
    const total = () => msgs.reduce((n, m) => n + size(m), 0);
    const budget = CONTEXT_CHARS - sysSize;
    const maxCount = MAX_API_MSGS - sys.length;
    const lastUser = () => { for (let i = msgs.length - 1; i >= 0; i--) if (msgs[i].role === 'user') return i; return 0; };
    const shrink = (m, toolMax, argMax) => {
      if (m.role === 'tool' && m.content.length > toolMax) m.content = m.content.slice(0, toolMax) + '\n…[older output trimmed to save context]';
      if (m.role === 'assistant' && m.tool_calls) for (const tc of m.tool_calls) tc.function.arguments = compactArgs(tc.function.arguments, argMax);
    };
    // 1) earlier requests: short tool outputs and tool arguments
    if (total() > budget) { const lu = lastUser(); for (let i = 0; i < lu; i++) shrink(msgs[i], 500, 300); }
    // 2) drop whole earlier requests, oldest first
    while ((total() > budget || msgs.length > maxCount)) {
      const next = msgs.findIndex((m, i) => i > 0 && m.role === 'user');
      if (next <= 0) break;
      msgs.splice(0, next);
    }
    // 3) inside the current request: trim older tool outputs, keep the two newest whole
    if (total() > budget) {
      const toolIdx = msgs.map((m, i) => (m.role === 'tool' ? i : -1)).filter((i) => i >= 0);
      for (const i of toolIdx.slice(0, -2)) shrink(msgs[i], 1200, 600);
      const asst = msgs.map((m, i) => (m.role === 'assistant' ? i : -1)).filter((i) => i >= 0);
      for (const i of asst.slice(0, -1)) shrink(msgs[i], 1200, 600);
    }
    if (total() > budget) { for (let i = 0; i < msgs.length - 1; i++) shrink(msgs[i], 400, 300); }
    // 4) too many messages in one long request: drop the oldest assistant+tool groups after the user message
    while (msgs.length > maxCount) {
      const u = lastUser(); const a = msgs.findIndex((m, i) => i > u && m.role === 'assistant');
      if (a < 0 || a >= msgs.length - 2) break;
      let end = a + 1; while (end < msgs.length && msgs[end].role === 'tool') end++;
      if (end >= msgs.length - 1) break;
      msgs.splice(a, end - a);
    }
    return sys.concat(msgs);
  }

  /* ======================================================================
   * the agent loop
   * ==================================================================== */
  function parseArgs(s) {
    if (s && typeof s === 'object') return s;
    s = String(s == null ? '' : s).trim();
    if (!s) return {};
    const v = JSON.parse(s);
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('arguments must be a JSON object');
    return v;
  }
  function parseArgsSafe(s) { try { return parseArgs(s); } catch (_) { return {}; } }
  function normalizeCalls(list) {
    const out = [];
    for (const tc of Array.isArray(list) ? list.slice(0, 16) : []) {
      const f = tc && (tc.function || tc); const name = f && String(f.name || '');
      if (!name) continue;
      let id = String((tc && tc.id) || '').replace(/[^\w.:-]/g, '').slice(0, 60) || 'call_' + U.uid(4);
      while (C.calls.has(id) || out.some((x) => x.id === id)) id = id.slice(0, 50) + '_' + U.uid(2);
      let args = f.arguments; if (args == null) args = '{}'; if (typeof args !== 'string') { try { args = JSON.stringify(args); } catch (_) { args = '{}'; } }
      out.push({ id, type: 'function', function: { name: name.slice(0, 64), arguments: args } });
    }
    return out;
  }
  function friendlyError(e) {
    const d = (e && e.data) || {};
    switch (e && e.code) {
      case 'rate_limited': return 'AI limit reached — OST Studio allows ' + AI_LIMIT + ' AI requests per 10 minutes.' + (d.retryAfter ? ' Try again in about ' + fmtWait(d.retryAfter) + '.' : ' Try again in a few minutes.');
      case 'ai_daily_limit': return 'The shared AI budget for today is used up. It resets at 00:00 UTC.';
      case 'ai_unavailable': return 'The AI service didn\'t answer (the model providers may be busy). Nothing was changed by this step — retry in a minute.';
      case 'network': return 'Couldn\'t reach the OST Studio server. Check your connection and retry.';
      case 'too_large': return 'This conversation is too large to send. Clear it (🗑) and ask again.';
      case 'studio_unavailable': case 'studio_hub_unavailable': case 'studio_error': return 'OST Studio\'s server is unavailable right now. Retry in a minute.';
      case 'not_found': case 'http_404': return 'The AI endpoint isn\'t available on the server yet.';
      case 'mesh_auth_stale': return 'Your device clock is off — fix the time and retry.';
      case 'no_messages': return 'Nothing to send — type a request.';
      default: return 'The AI request failed: ' + ((e && e.message) || 'unknown error') + '.';
    }
  }
  function modelLabel(m) {
    m = String(m || '');
    if (!m) return 'Llama 3.3 70B';
    if (/llama-3\.3-70b-versatile/.test(m)) return 'Llama 3.3 70B · Groq';
    if (/llama-3\.1-8b/.test(m)) return 'Llama 3.1 8B · Groq';
    if (/^@cf\//.test(m)) return m.replace(/^@cf\/[^/]+\//, '').replace(/-instruct.*$/, '').replace(/^llama-/, 'Llama ').replace(/-/g, ' ') + ' · Workers AI';
    return m.slice(0, 40);
  }
  function reqTimes() { try { const a = JSON.parse(localStorage.getItem(REQ_KEY) || '[]'); return Array.isArray(a) ? a.filter((t) => typeof t === 'number' && Date.now() - t < AI_WINDOW) : []; } catch (_) { return []; } }
  function countRequest() { const a = reqTimes(); a.push(Date.now()); try { localStorage.setItem(REQ_KEY, JSON.stringify(a.slice(-100))); } catch (_) {} paintHead(); }

  async function ask(prompt, opts) {
    opts = opts || {};
    prompt = String(prompt == null ? '' : prompt).trim();
    if (!prompt) throw new Error('Type a request for the agent.');
    if (C.busy) throw new Error('The agent is already working — stop it or wait.');
    if (!S.projects.current()) throw new Error('Open or create a project first.');
    await C.loaded;
    if (C.busy) throw new Error('The agent is already working — stop it or wait.');
    if (!S.projects.current() || S.projects.current().id !== C.pid) throw new Error('The project changed — try again.');
    const sel = opts.selection !== undefined ? opts.selection : C.sel;
    if (opts.selection === undefined && C.sel) { C.sel = null; paintCtx(); }
    let content = prompt, ctxLabel = '';
    if (sel && sel.text) {
      content += '\n\nSelected code in `' + sel.path + '` (lines ' + sel.from + '-' + sel.to + '):\n```' + fenceLang(sel.path) + '\n' + sel.text + '\n```';
      ctxLabel = '✂ ' + sel.path + ':' + sel.from + (sel.to !== sel.from ? '-' + sel.to : '');
    }
    const turn = { id: 't' + U.uid(6), pid: C.pid, before: new Map(), after: new Map(), stats: null, steps: 0, undone: false, lost: false, ts: Date.now() };
    C.turns.set(turn.id, turn);
    pushItem({ role: 'user', content, display: prompt, ctxLabel, turn: turn.id });
    return (C.loopP = loop(turn));
  }

  async function loop(turn) {
    C.busy = true; C.stopFlag = false; C.cur = turn;
    C.ctl = new AbortController();
    C.stopP = new Promise((r) => { C.stopR = r; });
    const alive = () => !C.stopFlag && C.pid === turn.pid;   // turn.pid follows a cloud id re-assignment
    const result = { ok: false, text: '', stopped: false, error: '', steps: 0, changes: [] };
    paintBusy();
    try {
      while (turn.steps < MAX_STEPS) {
        if (!alive()) break;
        if (S.editor && typeof S.editor.flush === 'function') { try { await S.editor.flush(); } catch (_) {} }
        if (!alive()) break;
        setWorking('Thinking… · step ' + (turn.steps + 1) + '/' + MAX_STEPS);
        let res;
        try {
          res = await S.api('POST', '/studio/v1/ai/chat', { messages: buildMessages(), tools: TOOLS }, { signal: C.ctl.signal });
        } catch (e) {
          if (!alive() || (C.ctl && C.ctl.signal.aborted)) break;
          if (e && e.code === 'ai_unavailable') countRequest();
          result.error = friendlyError(e);
          pushItem({ role: 'ui', kind: 'error', text: result.error, code: (e && e.code) || '', turn: turn.id });
          return result;
        }
        if (!alive()) break;
        countRequest();
        turn.steps++; result.steps = turn.steps;
        if (res && res.model) { C.model = String(res.model); paintHead(); }
        const m = (res && res.message) || {};
        const calls = normalizeCalls(m.tool_calls);
        const content = typeof m.content === 'string' ? m.content : '';
        if (!content.trim() && !calls.length) {
          result.error = 'The AI returned an empty reply.';
          pushItem({ role: 'ui', kind: 'error', text: 'The AI returned an empty reply — retry, or rephrase your request.', code: 'empty', turn: turn.id });
          return result;
        }
        pushItem({ role: 'assistant', content, tool_calls: calls.length ? calls : undefined, model: (res && res.model) || '', turn: turn.id });
        if (!calls.length) { result.ok = true; result.text = content; break; }
        for (const tc of calls) {
          if (!alive()) break;
          await runCall(tc, turn);
        }
        if (!alive()) break;
        if (turn.steps >= MAX_STEPS) {
          result.text = content;
          pushItem({ role: 'ui', kind: 'note', text: 'Paused after ' + MAX_STEPS + ' steps. Reply “continue” to let the agent keep going.', turn: turn.id });
        }
      }
      if (C.stopFlag && C.pid === turn.pid) { closeDangling(); pushItem({ role: 'ui', kind: 'note', text: 'Stopped.', turn: turn.id }); result.stopped = true; }
      return result;
    } finally {
      if (C.cur === turn) {
        C.busy = false; C.cur = null; C.ctl = null; C.stopR = null; C.stopP = null; C.running = ''; C.working = '';
        if (C.pid === turn.pid) { finalizeTurn(turn); result.changes = (turn.stats || []).slice(); saveSoon(0); }
        paintBusy();
        if (C.pid === turn.pid && S.ui.activity() !== 'agent') S.ui.setBadge('agent', '1');
      }
    }
  }
  async function runCall(tc, turn) {
    const name = tc.function.name;
    C.running = tc.id; repaintTool(tc.id);
    let res = null, args = null;
    try { args = parseArgs(tc.function.arguments); } catch (e) { res = err('The arguments are not valid JSON (' + e.message + '). Call ' + name + ' again with a JSON object.'); }
    if (!res && !TOOL_NAMES.has(name)) res = err('Unknown tool "' + name + '". Available tools: ' + [...TOOL_NAMES].join(', ') + '.');
    if (!res) {
      setWorking(workingLabel(name, toolTarget(name, args)));
      try { res = await execTool(name, args, turn); } catch (e) { res = err((e && e.message) || String(e)); }
    }
    if (!res || typeof res.out !== 'string') res = err('The tool returned nothing.');
    C.running = '';
    if (C.pid !== turn.pid) return;                     // the project was switched meanwhile
    pushItem({ role: 'tool', tool_call_id: tc.id, name, content: clip(res.out, TOOL_OUT_MAX), ok: !!res.ok, cancelled: !!res.cancelled, turn: turn.id });
  }
  function closeDangling() {
    for (let i = C.items.length - 1; i >= 0; i--) {
      const it = C.items[i];
      if (it.role === 'user') break;
      if (it.role !== 'assistant' || !it.tool_calls) continue;
      for (const tc of it.tool_calls) if (!C.results.has(tc.id)) pushItem({ role: 'tool', tool_call_id: tc.id, name: tc.function.name, content: 'Cancelled — the user stopped the agent before this tool ran.', ok: false, cancelled: true, turn: it.turn });
      break;
    }
  }
  function stop() {
    if (!C.busy) return false;
    C.stopFlag = true;
    try { if (C.ctl) C.ctl.abort(); } catch (_) {}
    if (C.stopR) C.stopR(STOP);
    setWorking('Stopping…');
    return true;
  }

  /* ======================================================================
   * changes: per-request snapshot → card, undo / redo
   * ==================================================================== */
  function finalizeTurn(turn) {
    if (!turn || turn.pid !== C.pid) return;
    const stats = [];
    for (const [p, b] of turn.before) {
      const a = turn.after.has(p) ? turn.after.get(p) : b;
      if (same(a, b)) continue;
      const binary = !!((a && a.b) || (b && b.b));
      const d = binary ? { add: 0, del: 0 } : lineDiff(b ? b.c : '', a ? a.c : '');
      stats.push({ path: p, status: !b ? 'A' : !a ? 'D' : 'M', add: d.add, del: d.del, binary });
    }
    stats.sort((x, y) => x.path.localeCompare(y.path));
    turn.stats = stats;
    const i = C.items.findIndex((x) => x.role === 'ui' && x.kind === 'changes' && x.turn === turn.id);
    if (i >= 0) { const [old] = C.items.splice(i, 1); const el = A.log && A.log.querySelector('[data-k="' + cssEsc(old.k) + '"]'); if (el) el.remove(); }
    if (stats.length) pushItem({ role: 'ui', kind: 'changes', turn: turn.id });
  }
  async function undoRedo(turnId, redo) {
    const t = C.turns.get(turnId);
    if (!t || !t.stats || t.lost) { S.ui.toast('Undo is not available for this request any more.', 'warn'); return; }
    if (C.busy) { S.ui.toast('Wait for the agent to finish (or stop it) first.', 'warn'); return; }
    if (!S.projects.current() || S.projects.current().id !== t.pid) return;
    if (S.editor && typeof S.editor.flush === 'function') { try { await S.editor.flush(); } catch (_) {} }
    const from = redo ? t.before : t.after, to = redo ? t.after : t.before;
    const paths = t.stats.map((s) => s.path);
    const drift = paths.filter((p) => !same(stateOf(p), from.has(p) ? from.get(p) : to.get(p)));
    if (drift.length) {
      const okGo = await S.ui.confirm(plural(drift.length, 'file') + ' changed after the agent edited ' + (drift.length === 1 ? 'it' : 'them') + ' (' + drift.slice(0, 3).join(', ') + (drift.length > 3 ? ', …' : '') + '). ' + (redo ? 'Redo' : 'Undo') + ' anyway? Those later edits will be overwritten.', { danger: true, okText: redo ? 'Redo anyway' : 'Undo anyway' });
      if (!okGo) return;
    }
    const failed = [];
    for (const p of paths) {
      const target = to.get(p);
      try {
        if (!target) { if (S.fs.exists(p)) await S.fs.remove(p, { source: 'agent' }); }
        else await S.fs.write(p, target.c, { source: 'agent', binary: !!target.b });
      } catch (e) { failed.push(p + ': ' + ((e && e.message) || e)); }
    }
    t.undone = !redo;
    repaintCard(t.id);
    saveSoon(0);
    if (failed.length) S.ui.toast('Some files could not be restored — ' + failed.join('; '), 'err');
    else S.ui.toast((redo ? 'Re-applied ' : 'Undid ') + plural(paths.length, 'file') + ' changed by the agent.', 'ok');
  }

  /* ======================================================================
   * conversation: items, rendering, persistence
   * ==================================================================== */
  function indexItems() {
    C.results = new Map(); C.calls = new Map();
    for (const it of C.items) {
      if (it.role === 'tool' && it.tool_call_id) C.results.set(it.tool_call_id, it);
      if (it.role === 'assistant') for (const tc of it.tool_calls || []) if (tc && tc.id) C.calls.set(tc.id, tc);
    }
  }
  /** An error can be retried while nothing but UI notes/cards came after it. */
  function retryable(it) { const i = C.items.indexOf(it); if (i < 0) return false; for (let j = i + 1; j < C.items.length; j++) if (C.items[j].role !== 'ui' || C.items[j].kind === 'error') return false; return true; }
  function pushItem(it) {
    it.k = it.k || 'i' + U.uid(5);
    it.ts = it.ts || Date.now();
    C.items.push(it);
    if (C.items.length > MEM_ITEMS) { C.items.splice(0, C.items.length - MEM_ITEMS); while (C.items.length && C.items[0].role !== 'user') C.items.shift(); indexItems(); renderAll(); }
    else if (it.role === 'tool') { C.results.set(it.tool_call_id, it); repaintTool(it.tool_call_id); }
    else {
      if (it.role === 'assistant') for (const tc of it.tool_calls || []) C.calls.set(tc.id, tc);
      if (A.log) {
        if (it.role !== 'ui' || it.kind === 'error') A.log.querySelectorAll('[data-a="retry"]').forEach((b) => b.remove());
        const empty = A.log.querySelector('.st-agent-empty'); if (empty) empty.remove();
        const el = renderItem(it);
        if (el) { const stick = nearBottom(); if (A.work.parentNode !== A.log) A.log.appendChild(A.work); A.log.insertBefore(el, A.work); if (stick || it.role === 'user') scrollBottom(); }
      }
    }
    saveSoon();
  }
  function nearBottom() { return !A.log || A.log.scrollHeight - A.log.scrollTop - A.log.clientHeight < 90; }
  function scrollBottom() { if (A.log) requestAnimationFrame(() => { A.log.scrollTop = A.log.scrollHeight; }); }

  function toolTarget(name, a) {
    a = a || {};
    if (name === 'rename_file') return (a.from ? argStr(a.from) : '?') + ' → ' + (a.to ? argStr(a.to) : '?');
    if (name === 'search') return a.query ? '“' + argStr(a.query).slice(0, 40) + '”' : '';
    if (name === 'run') return a.path ? argStr(a.path) : '';
    return a.path ? argStr(a.path) : '';
  }
  function diffPre(a, b) {
    const L = (s, sign, cls) => clipLines(argStr(s), 30, 3000).split('\n').map((l) => '<span class="' + cls + '">' + sign + ' ' + esc(l) + '</span>').join('\n');
    return '<pre class="st-agent-pre st-agent-diff">' + L(a, '-', 'd') + '\n' + L(b, '+', 'a') + '</pre>';
  }
  function toolRow(tc) {
    const name = tc.function.name, args = parseArgsSafe(tc.function.arguments);
    const r = C.results.get(tc.id);
    const state = r ? (r.cancelled ? 'cancel' : r.ok ? 'ok' : 'err') : C.running === tc.id ? 'run' : C.busy ? 'wait' : 'cancel';
    const icon = { run: '<i class="st-agent-spin" aria-label="running"></i>', wait: '<span aria-label="queued">…</span>', ok: '<span aria-label="done">✓</span>', err: '<span aria-label="failed">✕</span>', cancel: '<span aria-label="cancelled">⊘</span>' }[state];
    const d = h('details', 'st-agent-tool is-' + state);
    d.setAttribute('data-call', tc.id);
    let body = '';
    if (name === 'edit_file') body += diffPre(args.old_string, args.new_string);
    else if (name === 'write_file') body += '<pre class="st-agent-pre st-agent-diff">' + clipLines(argStr(args.content), 40, 4000).split('\n').map((l) => '<span class="a">+ ' + esc(l) + '</span>').join('\n') + '</pre>';
    else if (Object.keys(args).length) body += '<pre class="st-agent-pre">' + esc(clip(JSON.stringify(args, null, 1), 1500)) + '</pre>';
    if (r) body += '<div class="st-agent-tlabel">' + (r.cancelled ? 'Cancelled' : r.ok ? 'Result' : 'Error') + '</div><pre class="st-agent-pre' + (r.ok ? '' : ' is-err') + '">' + esc(clip(r.content, 4000)) + '</pre>';
    const p = U.normPath(argStr(args.to || args.path));
    if (p && safe(() => S.fs.exists(p), false)) body += '<button type="button" class="st-agent-link" data-open="' + esc(p) + '">Open ' + esc(p) + '</button>';
    const target = toolTarget(name, args);
    d.innerHTML = '<summary><span class="st-agent-ti" aria-hidden="true">' + (TOOL_ICON[name] || '🔧') + '</span><span class="st-agent-tn">' + esc(TOOL_LABEL[name] || name) + '</span><span class="st-agent-tp" title="' + esc(target) + '">' + esc(target) + '</span><span class="st-agent-ts">' + icon + '</span></summary><div class="st-agent-tb">' + (body || '<span class="st-muted">No arguments.</span>') + '</div>';
    return d;
  }
  function repaintTool(id) {
    if (!A.log) return;
    const old = A.log.querySelector('details[data-call="' + cssEsc(id) + '"]');
    const tc = C.calls.get(id);
    if (!old || !tc) return;
    const n = toolRow(tc); n.open = old.open; old.replaceWith(n);
  }
  function repaintAllTools() { if (A.log) A.log.querySelectorAll('details[data-call]').forEach((d) => repaintTool(d.getAttribute('data-call'))); }
  function changesCard(it) {
    const t = C.turns.get(it.turn);
    const e = h('div', 'st-agent-changes');
    if (!t || !t.stats || !t.stats.length) return null;
    const add = t.stats.reduce((n, s) => n + s.add, 0), del = t.stats.reduce((n, s) => n + s.del, 0);
    const label = { A: 'added', M: 'modified', D: 'deleted' };
    const rows = t.stats.map((s) => '<button type="button" class="st-agent-crow" data-open="' + esc(s.path) + '" title="' + esc(label[s.status] + ' · ' + s.path) + '"><span class="st-agent-cbadge is-' + s.status + '">' + s.status + '</span><span class="st-agent-cpath">' + esc(s.path) + '</span>' + (s.binary ? '<span class="st-muted">binary</span>' : '<span class="st-agent-plus">+' + s.add + '</span><span class="st-agent-minus">−' + s.del + '</span>') + '</button>').join('');
    const foot = t.lost
      ? '<span class="st-note">Undo isn\'t available for this request any more (its snapshot was too large to keep after a reload).</span>'
      : t.undone ? '<span class="st-note">Changes undone.</span><button type="button" class="st-btn" data-a="redo">↷ Redo</button>'
        : '<button type="button" class="st-btn" data-a="undo">↶ Undo all</button>';
    e.innerHTML = '<div class="st-agent-chead"><b>' + (t.undone ? 'Changes (undone)' : 'Changes') + '</b><span>' + plural(t.stats.length, 'file') + '</span><span class="st-agent-plus">+' + add + '</span><span class="st-agent-minus">−' + del + '</span></div><div class="st-agent-crows">' + rows + '</div><div class="st-agent-cfoot">' + foot + '</div>';
    e.setAttribute('data-turn', t.id);
    if (t.undone) e.classList.add('is-undone');
    return e;
  }
  function repaintCard(turnId) {
    if (!A.log) return;
    const it = C.items.find((x) => x.role === 'ui' && x.kind === 'changes' && x.turn === turnId); if (!it) return;
    const old = A.log.querySelector('[data-k="' + cssEsc(it.k) + '"]'); const n = renderItem(it);
    if (old && n) old.replaceWith(n);
  }
  function renderItem(it) {
    let e = null;
    if (it.role === 'user') {
      e = h('div', 'st-agent-msg is-user');
      e.innerHTML = '<div class="st-agent-bubble">' + esc(it.display != null ? it.display : it.content) + '</div>' + (it.ctxLabel ? '<div class="st-agent-ctxtag">' + esc(it.ctxLabel) + '</div>' : '');
    } else if (it.role === 'assistant') {
      e = h('div', 'st-agent-msg is-bot');
      if (it.content) e.appendChild(h('div', 'st-agent-md', md(it.content)));
      for (const tc of it.tool_calls || []) if (tc && tc.function) e.appendChild(toolRow(tc));
    } else if (it.role === 'ui' && it.kind === 'changes') e = changesCard(it);
    else if (it.role === 'ui' && it.kind === 'error') {
      e = h('div', 'st-agent-err');
      e.innerHTML = '<span>⚠ ' + esc(it.text) + '</span>' + (retryable(it) ? '<button type="button" class="st-btn" data-a="retry">Retry</button>' : '');
    } else if (it.role === 'ui' && it.kind === 'note') e = h('div', 'st-agent-note', esc(it.text));
    if (e) e.setAttribute('data-k', it.k);
    return e;
  }
  function emptyState() {
    const e = h('div', 'st-agent-empty');
    e.innerHTML = '<div class="st-agent-hero" aria-hidden="true">🤖</div><h3>AI coding agent</h3>'
      + '<p>Ask for a change and the agent reads your files, edits them, runs the code in the sandbox and fixes errors. Every request can be undone.</p>'
      + '<div class="st-agent-chips"><button type="button" data-sug="explain">Explain this project</button><button type="button" data-sug="feature">Add a feature…</button><button type="button" data-sug="bugs">Find and fix bugs</button><button type="button" data-sug="tests">Write tests</button></div>'
      + '<p class="st-note">Powered by open Llama models (Groq, with a Cloudflare Workers AI fallback) through OST — ' + AI_LIMIT + ' requests per 10 minutes. Only this project\'s files and your messages are sent, never your wallet. AI makes mistakes: review the changes.</p>';
    return e;
  }
  function renderAll() {
    if (!A.log) return;
    A.log.textContent = '';
    if (!S.projects.current()) { A.log.appendChild(h('div', 'st-empty', 'Open or create a project to work with the AI agent.')); }
    else if (C.loading) { A.log.appendChild(h('div', 'st-empty', 'Loading conversation…')); }
    else {
      if (!C.items.length) A.log.appendChild(emptyState());
      for (const it of C.items) { const e = renderItem(it); if (e) A.log.appendChild(e); }
    }
    A.log.appendChild(A.work);
    paintBusy(); paintHead(); paintCtx();
    scrollBottom();
  }

  function compactItem(it) {
    const o = Object.assign({}, it);
    if (o.role === 'tool' && o.content && o.content.length > 3000) o.content = o.content.slice(0, 3000) + '\n…[trimmed]';
    if (o.role === 'assistant' && o.tool_calls) o.tool_calls = o.tool_calls.map((tc) => ({ id: tc.id, type: 'function', function: { name: tc.function.name, arguments: compactArgs(tc.function.arguments, 3000) } }));
    if (o.role === 'user' && o.content && o.content.length > 20000) o.content = o.content.slice(0, 20000);
    return o;
  }
  function serialize() {
    const n = C.items.length;
    let start = Math.max(0, n - KEEP_ITEMS);
    while (start < n && C.items[start].role !== 'user') start++;
    if (start >= n) { start = n; for (let i = n - 1; i >= 0; i--) if (C.items[i].role === 'user') { start = i; break; } }
    const items = C.items.slice(start).map(compactItem);
    const keep = new Set(items.map((i) => i.turn).filter(Boolean));
    const mapSize = (m) => { let s = 0; for (const v of m.values()) if (v && v.c) s += v.c.length; return s; };
    let budget = SNAP_BUDGET; const turns = [];
    for (const t of [...C.turns.values()].reverse()) {
      if (!keep.has(t.id)) continue;
      const size = mapSize(t.before) + mapSize(t.after);
      const data = !t.lost && size <= budget;
      if (data) budget -= size;
      turns.push({ id: t.id, pid: t.pid, ts: t.ts, steps: t.steps, undone: !!t.undone, stats: t.stats, lost: !data, before: data ? [...t.before] : null, after: data ? [...t.after] : null });
    }
    return { pid: C.pid, v: 1, ts: Date.now(), model: C.model, items, turns: turns.reverse() };
  }
  function saveSoon(ms) {
    clearTimeout(C.saveT);
    C.saveT = setTimeout(saveNow, ms == null ? 500 : ms);
  }
  function saveNow() {
    clearTimeout(C.saveT);
    const cur = S.projects.current();
    if (cur && C.proj === cur && cur.id !== C.pid) {             // the cloud re-assigned the project id
      const old = C.pid; C.pid = cur.id;
      for (const t of C.turns.values()) if (t.pid === old) t.pid = cur.id;
      IDB.del(old).catch(() => {});
    }
    if (!C.pid) return Promise.resolve();
    if (!C.items.length) return IDB.del(C.pid).catch(() => {});
    return IDB.put(serialize()).catch(() => {});
  }
  function loadConvo() {
    const cur = S.projects.current();
    if (cur && C.proj === cur && cur.id !== C.pid) { saveNow(); return C.loaded; }   // same project, id re-assigned by the cloud
    if (C.busy) { stop(); if (C.cur) finalizeTurn(C.cur); }
    if (!cur) { if (C.pid) saveNow(); C.pid = ''; C.proj = null; C.items = []; C.turns = new Map(); indexItems(); C.loading = false; C.loaded = Promise.resolve(); renderAll(); return C.loaded; }
    if (cur.id === C.pid && C.proj === cur) return C.loaded;
    if (C.pid) saveNow();
    const pid = cur.id;
    C.pid = pid; C.proj = cur; C.items = []; C.turns = new Map(); C.sel = null; C.model = ''; indexItems();
    C.loading = true; renderAll();
    C.loaded = IDB.get(pid).then((rec) => {
      if (C.pid !== pid) return;
      const items = rec && Array.isArray(rec.items) ? rec.items.filter((i) => i && typeof i === 'object' && typeof i.role === 'string') : [];
      C.items = items.map((i) => Object.assign({}, i, { k: typeof i.k === 'string' && /^[\w-]{1,24}$/.test(i.k) ? i.k : 'i' + U.uid(5) }));
      C.turns = new Map();
      for (const t of (rec && Array.isArray(rec.turns) ? rec.turns : [])) {
        if (!t || typeof t.id !== 'string') continue;
        C.turns.set(t.id, { id: t.id, pid, ts: t.ts || 0, steps: Number(t.steps) || 0, undone: !!t.undone, lost: !!t.lost || !Array.isArray(t.before), stats: Array.isArray(t.stats) ? t.stats : null, before: new Map(Array.isArray(t.before) ? t.before : []), after: new Map(Array.isArray(t.after) ? t.after : []) });
      }
      C.model = (rec && typeof rec.model === 'string' && rec.model) || '';
      indexItems();
    }).catch(() => {}).then(() => { if (C.pid === pid) { C.loading = false; renderAll(); } });
    return C.loaded;
  }
  async function clear() {
    if (C.busy) { stop(); try { await C.loopP; } catch (_) {} }
    C.items = []; C.turns = new Map(); indexItems();
    if (C.pid) await IDB.del(C.pid).catch(() => {});
    renderAll();
  }

  /* ======================================================================
   * Agent panel UI
   * ==================================================================== */
  function setWorking(t) { C.working = t || ''; paintBusy(); }
  function paintBusy() {
    if (!A.root) return;
    A.send.hidden = C.busy; A.stopBtn.hidden = !C.busy;
    A.work.hidden = !C.busy;
    A.work.innerHTML = C.busy ? '<i class="st-agent-spin" aria-hidden="true"></i><span>' + esc(C.working || 'Working…') + '</span>' : '';
    S.ui.setStatus('agent', C.busy ? '🤖 ' + (C.working || 'Agent working…') : '', { side: 'right', order: 40, title: 'AI agent — click to open', onClick: () => open() });
    paintComposer();
  }
  function paintHead() {
    if (!A.model) return;
    const n = reqTimes().length;
    A.model.textContent = modelLabel(C.model) + ' · ' + n + '/' + AI_LIMIT + ' requests (10 min)';
    A.model.title = 'Model: ' + (C.model || 'not used yet in this project') + '. AI requests sent from this browser in the last 10 minutes — OST Studio allows ' + AI_LIMIT + ' per 10 minutes per user.';
    A.model.classList.toggle('is-warn', n >= AI_LIMIT - 5);
  }
  function paintComposer() {
    if (!A.input) return;
    const has = !!S.projects.current();
    A.input.disabled = !has;
    A.send.disabled = !has;
    A.input.placeholder = !has ? 'Open a project to chat with the agent' : C.busy ? 'The agent is working… you can type your next message' : 'Ask the agent to build, fix or explain…';
    A.hint.textContent = coarse() ? 'Edits apply directly · Undo per request' : 'Enter to send · Shift+Enter for a new line';
  }
  function paintCtx() {
    if (!A.ctx) return;
    const act = safe(() => S.editor && S.editor.active && S.editor.active(), null);
    let html = '';
    if (C.sel) html += '<span class="st-agent-chip is-sel" title="This selection is sent with your next message">✂ ' + esc(C.sel.path + ':' + C.sel.from + (C.sel.to !== C.sel.from ? '-' + C.sel.to : '')) + '<button type="button" data-a="unsel" aria-label="Remove the selection">×</button></span>';
    if (act && safe(() => S.fs.exists(act), false)) html += '<span class="st-agent-chip" title="The agent can see the file open in the editor">📄 ' + esc(act) + '</span>';
    A.ctx.innerHTML = html; A.ctx.hidden = !html;
  }
  function autosize() { if (!A.input) return; A.input.style.height = 'auto'; A.input.style.height = Math.min(A.input.scrollHeight + 2, 220) + 'px'; }
  function submit() {
    const v = A.input.value.trim(); if (!v) { A.input.focus(); return; }
    if (C.busy) { S.ui.toast('The agent is still working — press Stop or wait.', 'warn'); return; }
    if (!S.projects.current()) { S.ui.toast('Open or create a project first.', 'warn'); return; }
    A.input.value = ''; autosize();
    ask(v).catch((e) => {
      if (!A.input.value) { A.input.value = v; autosize(); }      // don't lose what was typed
      S.ui.toast((e && e.message) || String(e), 'err');
    });
  }
  const SUGGEST = {
    explain: 'Explain this project: what it does, how the files fit together and how to run it. Don\'t change any files.',
    bugs: 'Find and fix bugs in this project: read the code, run it, check get_problems, fix what is broken, then run it again to confirm.',
    tests: 'Write tests for the main logic of this project that can run here (plain JavaScript with a tiny assert helper, or Python unittest for Python code). Put them in a new test file, run them and report the results.'
  };
  function suggestion(id) {
    if (id === 'feature') { A.input.value = 'Add a feature: '; autosize(); A.input.focus(); try { A.input.setSelectionRange(A.input.value.length, A.input.value.length); } catch (_) {} return; }
    if (SUGGEST[id] && !C.busy) ask(SUGGEST[id]).catch((e) => S.ui.toast(e.message, 'err'));
  }
  function openFile(p, line) {
    p = U.normPath(p);
    if (!p || !S.fs.exists(p)) { S.ui.toast((p || 'That file') + ' no longer exists.', 'warn'); return; }
    if (!S.editor || typeof S.editor.open !== 'function') { S.ui.toast('The editor is not loaded.', 'warn'); return; }
    Promise.resolve(S.editor.open(p)).then(() => { const n = parseInt(line, 10); if (n > 0 && S.editor.reveal) S.editor.reveal(p, n, 1); }).catch(() => {});
    if (S.ui.isMobile()) S.ui.setActivity('');
  }
  async function retry(errEl) {
    if (C.busy) return;
    const k = errEl && errEl.getAttribute('data-k');
    const i = C.items.findIndex((x) => x.k === k);
    if (i < 0 || !retryable(C.items[i])) { S.ui.toast('Send a new message instead.', 'warn'); return; }
    const it = C.items[i];
    C.items.splice(i, 1); errEl.remove();
    let turn = C.turns.get(it.turn);
    if (!turn) { turn = { id: it.turn || 't' + U.uid(6), pid: C.pid, before: new Map(), after: new Map(), stats: null, steps: 0, undone: false, lost: false, ts: Date.now() }; C.turns.set(turn.id, turn); }
    if (turn.lost) { turn.lost = false; turn.before = new Map(); turn.after = new Map(); }
    if (turn.steps >= MAX_STEPS) turn.steps = MAX_STEPS - 4;
    (C.loopP = loop(turn)).catch((e) => S.ui.toast(e.message, 'err'));
  }
  function captureSelection() {
    const path = safe(() => S.editor && S.editor.active && S.editor.active(), null);
    if (!path) return null;
    try {
      const ed = S.editor.instance && S.editor.instance();
      const m = ed && ed.getModel && ed.getModel();
      const sel = ed && ed.getSelection && ed.getSelection();
      if (m && sel && !sel.isEmpty()) {
        const text = m.getValueInRange(sel);
        if (text.trim()) return { path, text: text.length > SEL_MAX ? text.slice(0, SEL_MAX) + '\n…(selection truncated)' : text, from: sel.startLineNumber, to: sel.endLineNumber };
      }
    } catch (_) {}
    const ae = document.activeElement;
    if (ae && ae.tagName === 'TEXTAREA' && S.ui.editorHost() && S.ui.editorHost().contains(ae) && ae.selectionEnd > ae.selectionStart) {
      const v = ae.value, text = v.slice(ae.selectionStart, ae.selectionEnd);
      const from = v.slice(0, ae.selectionStart).split('\n').length;
      if (text.trim()) return { path, text: text.slice(0, SEL_MAX), from, to: from + text.split('\n').length - 1 };
    }
    return null;
  }
  function open(focus) {
    if (S.ui.activity() !== 'agent') S.ui.setActivity('agent', true);
    S.ui.setBadge('agent', '');
    if (focus !== false) setTimeout(() => { if (A.input && !A.input.disabled) A.input.focus(); }, 40);
  }
  function focusAsk() {
    const sel = captureSelection();
    if (sel) C.sel = sel;
    paintCtx(); open();
  }
  function explainActive() {
    const p = safe(() => S.editor && S.editor.active && S.editor.active(), null);
    if (!p || !S.fs.exists(p)) { S.ui.toast('Open a file first.', 'warn'); return; }
    if (C.busy) { S.ui.toast('The agent is still working — press Stop or wait.', 'warn'); return; }
    open(false);
    return ask('Explain `' + p + '`: what it does, how it fits into the project, and anything that looks wrong or could be improved. Don\'t change any files.', { selection: null });
  }

  function mountAgent() {
    const body = S.ui.registerActivity({ id: 'agent', icon: '🤖', title: 'AI Agent', order: 40 });
    body.classList.add('st-agent-host');
    body.innerHTML = '<div class="st-agent">'
      + '<div class="st-agent-head"><span class="st-agent-model"></span><button type="button" class="st-ib" data-a="clear" title="Clear conversation" aria-label="Clear conversation">🗑</button></div>'
      + '<div class="st-agent-log" role="log" aria-live="polite" aria-relevant="additions"></div>'
      + '<div class="st-agent-dock"><div class="st-agent-ctx" hidden></div>'
      + '<div class="st-agent-box"><textarea class="st-agent-input" rows="2" aria-label="Message the AI agent" spellcheck="true"></textarea>'
      + '<div class="st-agent-bar"><span class="st-agent-hint"></span><button type="button" class="st-btn st-agent-stopbtn" data-a="stop" hidden>■ Stop</button><button type="button" class="st-btn primary st-agent-sendbtn" data-a="send">Send</button></div></div></div>'
      + '</div>';
    A.root = body.querySelector('.st-agent');
    A.log = body.querySelector('.st-agent-log');
    A.model = body.querySelector('.st-agent-model');
    A.ctx = body.querySelector('.st-agent-ctx');
    A.input = body.querySelector('.st-agent-input');
    A.send = body.querySelector('.st-agent-sendbtn');
    A.stopBtn = body.querySelector('.st-agent-stopbtn');
    A.hint = body.querySelector('.st-agent-hint');
    A.work = h('div', 'st-agent-working'); A.work.hidden = true;
    body.addEventListener('click', (e) => {
      const b = e.target.closest('button, a'); if (!b || !body.contains(b)) return;
      if (b.classList.contains('st-agent-copy')) { const c = b.closest('.st-agent-code'); if (c) copyText(c.querySelector('code').textContent, b); return; }
      const op = b.getAttribute('data-open'); if (op != null) { e.preventDefault(); openFile(op, b.getAttribute('data-line')); return; }
      const sg = b.getAttribute('data-sug'); if (sg) { suggestion(sg); return; }
      const a = b.getAttribute('data-a');
      if (a === 'send') submit();
      else if (a === 'stop') stop();
      else if (a === 'retry') retry(b.closest('[data-k]'));
      else if (a === 'undo' || a === 'redo') { const c = b.closest('[data-turn]'); if (c) undoRedo(c.getAttribute('data-turn'), a === 'redo'); }
      else if (a === 'unsel') { C.sel = null; paintCtx(); }
      else if (a === 'clear') {
        if (!C.items.length) return;
        S.ui.confirm('Clear this conversation? Your files stay as they are, but the Undo buttons for earlier requests go away.', { okText: 'Clear' }).then((y) => { if (y) clear(); });
      }
    });
    A.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey && !e.isComposing && !coarse()) { e.preventDefault(); submit(); }
    });
    A.input.addEventListener('input', autosize);
    renderAll();
  }

  /* ======================================================================
   * Agent API panel (tokens for external coding agents)
   * ==================================================================== */
  const K = { tokens: null, loading: false, error: '', secret: null, creating: false, loadedAt: 0, root: null };
  function tokenError(e) {
    switch (e && e.code) {
      case 'network': return 'Couldn\'t reach the OST Studio server — check your connection.';
      case 'token_limit': return (e.data && e.data.message) || 'You have the maximum number of tokens — revoke one first.';
      case 'bad_scopes': return 'Pick at least one scope.';
      case 'rate_limited': return 'Too many requests — wait a minute and try again.';
      case 'not_found': case 'http_404': return 'The token service isn\'t available on the server yet.';
      default: return (e && e.message) || 'Request failed.';
    }
  }
  function slugify(s) { const v = String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, ''); return /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/.test(v) && !['api', 'www', 'admin', 'ost', 'studio', 'app', 'apps', 'assets'].includes(v) ? v : 'my-app'; }
  function examples() {
    const p = S.projects.current();
    const pid = p ? p.id : 'pYOUR_PROJECT_ID';
    const files = p ? S.fs.list().filter((f) => !f.binary) : [];
    const entry = safe(() => U.entryFor(), '');
    const file = (files.find((f) => f.path === entry) || files.find((f) => f.path === 'index.html') || files[0] || { path: 'index.html' }).path;
    const q = encodeURIComponent(file).replace(/%2F/g, '/');
    const auth = '-H "Authorization: Bearer $OST_TOKEN"';
    const name = String((p && p.name) || 'My app').replace(/['"\\]/g, '').slice(0, 60);
    return [
      ['1 · Set your token (once per terminal)', 'export OST_TOKEN="ostk_paste_your_token_here"'],
      ['List files', 'curl -s "' + API_BASE + '/projects/' + pid + '" ' + auth],
      ['Read a file', 'curl -s "' + API_BASE + '/projects/' + pid + '/file?path=' + q + '" ' + auth],
      ['Write a file (create or replace)', 'curl -s -X PUT "' + API_BASE + '/projects/' + pid + '/file?path=' + q + '" ' + auth + ' \\\n  -H "Content-Type: text/plain; charset=utf-8" --data-binary "@' + file.replace(/"/g, '') + '"'],
      ['Several changes in one request (sync batch)', 'curl -s -X POST "' + API_BASE + '/projects/' + pid + '/sync" ' + auth + ' \\\n  -H "Content-Type: application/json" \\\n  -d \'{"put":{"notes.md":"# Notes\\n"},"del":["old.js"],"rename":[["a.js","src/a.js"]]}\''],
      ['Deploy as a static app', 'curl -s -X POST "' + API_BASE + '/projects/' + pid + '/deploy" ' + auth + ' \\\n  -H "Content-Type: application/json" \\\n  -d \'{"slug":"' + slugify(p && p.name) + '","name":' + JSON.stringify(name) + '}\'']
    ];
  }
  function brief() {
    const p = S.projects.current();
    const pid = p ? p.id : '<PROJECT_ID>';
    return [
      'You can edit my OST Studio project' + (p ? ' "' + String(p.name).replace(/"/g, '') + '" (id ' + p.id + ')' : '') + ' over HTTP.',
      'First read the API guide: ' + AGENTS_MD + ' .',
      'Base URL: ' + API_BASE + ' — send the header "Authorization: Bearer $OST_TOKEN" on every request; the token is in the OST_TOKEN environment variable (never print it, write it into files or commit it).',
      'Read every file with GET /projects/' + pid + '/export; change files with PUT /projects/' + pid + '/file?path=<path> (raw body) or POST /projects/' + pid + '/sync {"put":{…},"del":[…],"rename":[[from,to]]}; publish with POST /projects/' + pid + '/deploy {"slug":"…"} (needs the deploy scope).',
      'There is no server-side execution: apps are static (HTML/CSS/JS; React/TypeScript must be bundled), npm packages load from https://esm.sh, and I run and preview the code in OST Studio. Everything is on Solana devnet.',
      'Re-read a file before rewriting it (I may be editing too), keep changes small and complete, never put secrets in files (deployed apps are public), and tell me what you changed.'
    ].join(' ');
  }
  function apiCode(title, code) { return codeBlock(code, title).replace('<div class="st-agent-code">', '<div class="st-agent-code is-shell">'); }
  function paintApi() {
    if (!K.root) return;
    const p = S.projects.current();
    const st = S.projects.syncState();
    const projBox = K.root.querySelector('[data-k="proj"]');
    if (!p) projBox.innerHTML = '<div class="st-note">Open a project to see its id and ready-to-run examples.</div>';
    else {
      const inCloud = !!p.cloud;
      projBox.innerHTML = '<div class="st-agent-api-pid"><div><b>' + esc(p.name) + '</b><code>' + esc(p.id) + '</code></div><button type="button" class="st-btn" data-k="copyid">Copy id</button></div>'
        + (inCloud ? '<div class="st-agent-api-ok">☁ In your OST cloud space — agents with a token can see it' + (st === 'syncing' ? ' (syncing…)' : st === 'offline' || st === 'error' ? ' (sync paused: ' + esc(st) + ')' : '') + '.</div>'
          : '<div class="st-agent-api-warn">⚠ This project hasn\'t reached the cloud yet (' + esc(st) + '). Agents can\'t see it until it syncs — it uploads automatically when you\'re online.</div>');
    }
    K.root.querySelector('[data-k="examples"]').innerHTML = examples().map(([t, c]) => apiCode(t, c)).join('');
    K.root.querySelector('[data-k="brief"]').innerHTML = codeBlock(brief(), 'agent brief').replace('<div class="st-agent-code">', '<div class="st-agent-code is-brief">');
    paintSecret(); paintTokens();
  }
  function paintSecret() {
    const box = K.root && K.root.querySelector('[data-k="secret"]'); if (!box) return;
    if (!K.secret) { box.hidden = true; box.innerHTML = ''; return; }
    box.hidden = false;
    box.innerHTML = '<div class="st-agent-api-warn">⚠ Copy this token now — it is shown only once. Anyone who has it can ' + esc(K.secret.scopes.join(' / ')) + ' your Studio projects as you. Don\'t paste it anywhere public or commit it to git; revoke it below if it leaks.</div>'
      + '<div class="st-agent-api-tok"><code>' + esc(K.secret.token) + '</code><button type="button" class="st-btn primary" data-k="copysecret">Copy</button></div>'
      + '<button type="button" class="st-btn block" data-k="hidesecret">I\'ve saved it — hide the token</button>';
  }
  function paintTokens() {
    const box = K.root && K.root.querySelector('[data-k="list"]'); if (!box) return;
    if (K.loading && !K.tokens) { box.innerHTML = '<div class="st-note">Loading tokens…</div>'; return; }
    if (K.error) { box.innerHTML = '<div class="st-agent-api-warn">' + esc(K.error) + '</div><button type="button" class="st-btn" data-k="reload">Retry</button>'; return; }
    if (!K.tokens) { box.innerHTML = ''; return; }
    if (!K.tokens.length) { box.innerHTML = '<div class="st-note">No tokens yet. Create one above for each agent or machine, so you can revoke them one by one.</div>'; return; }
    box.innerHTML = K.tokens.map((t) => '<div class="st-agent-api-row"><div class="st-agent-api-rowmain"><b>' + esc(t.label || 'agent') + '</b><div class="st-agent-api-scopes">' + (Array.isArray(t.scopes) ? t.scopes : []).map((s) => '<span>' + esc(s) + '</span>').join('') + '</div><small>created ' + esc(t.ts ? new Date(t.ts).toLocaleDateString() : '?') + ' · ' + (t.lastUsed ? 'last used ' + esc(fmtAgo(t.lastUsed)) : 'never used') + '</small></div><button type="button" class="st-btn" data-revoke="' + esc(t.id) + '" data-label="' + esc(t.label || 'agent') + '">Revoke</button></div>').join('');
  }
  async function loadTokens() {
    if (K.loading) return;
    K.loading = true; K.error = ''; paintTokens();
    try { const j = await S.api('GET', '/studio/v1/tokens'); K.tokens = Array.isArray(j && j.tokens) ? j.tokens : []; K.loadedAt = Date.now(); }
    catch (e) { K.error = 'Couldn\'t load your tokens: ' + tokenError(e); }
    finally { K.loading = false; paintTokens(); }
  }
  async function createToken() {
    if (K.creating) return;
    const label = K.root.querySelector('[data-k="label"]').value.trim().slice(0, 60) || 'agent';
    const scopes = [...K.root.querySelectorAll('[data-k="scopes"] input:checked')].map((i) => i.value);
    if (!scopes.length) { S.ui.toast('Pick at least one scope.', 'warn'); return; }
    const btn = K.root.querySelector('[data-k="create"]');
    K.creating = true; btn.disabled = true; btn.textContent = 'Creating…';
    try {
      const j = await S.api('POST', '/studio/v1/tokens', { label, scopes });
      if (!j || typeof j.token !== 'string' || !j.token) throw new Error('The server did not return a token.');
      K.secret = { token: j.token, label: j.label || label, scopes: Array.isArray(j.scopes) ? j.scopes : scopes };
      K.root.querySelector('[data-k="label"]').value = '';
      paintSecret();
      S.ui.toast('Token created — copy it now.', 'ok');
      loadTokens();
    } catch (e) { S.ui.toast(tokenError(e), 'err'); }
    finally { K.creating = false; btn.disabled = false; btn.textContent = 'Create token'; }
  }
  async function revokeToken(id, label) {
    const y = await S.ui.confirm('Revoke the token "' + label + '"? Any agent using it stops working immediately.', { danger: true, okText: 'Revoke' });
    if (!y) return;
    try {
      await S.api('DELETE', '/studio/v1/tokens/' + encodeURIComponent(id));
      S.ui.toast('Token revoked.', 'ok');
    } catch (e) {
      if (e && e.code === 'token_not_found') S.ui.toast('That token was already revoked.', 'warn');
      else { S.ui.toast(tokenError(e), 'err'); return; }
    }
    if (K.tokens) K.tokens = K.tokens.filter((t) => t.id !== id);
    paintTokens(); loadTokens();
  }
  function mountApi() {
    const body = S.ui.registerActivity({ id: 'agent-api', icon: '🔑', title: 'Agent API', order: 45 });
    body.classList.add('st-agent-api-host');
    body.innerHTML = '<div class="st-agent-api">'
      + '<p class="st-agent-api-lead">Let other coding agents — Claude Code, Cursor, Codex, your own scripts — read, edit and deploy your Studio projects over HTTP with a token.</p>'
      + '<ul class="st-agent-api-facts"><li>Their edits show up live in this tab: Studio pulls cloud changes every few seconds and marks them “(agent)”. If you have an unsaved edit to the same file, yours wins.</li>'
      + '<li>Nothing runs on the server. Agents change files; code runs in your browser sandbox when you press Run, and deploys are static web apps.</li>'
      + '<li>A token acts as you, limited to its scopes. Make one per agent and revoke it here any time.</li></ul>'
      + '<span class="st-label">This project</span><div data-k="proj"></div>'
      + '<span class="st-label">Create a token</span>'
      + '<div class="st-agent-api-create"><input class="st-input" data-k="label" maxlength="60" placeholder="Label, e.g. Claude Code on my laptop" autocomplete="off" spellcheck="false">'
      + '<div class="st-agent-api-scopebox" data-k="scopes">'
      + '<label><input type="checkbox" value="read" checked><span><b>read</b><small>list projects, read files, poll changes, AI proxy</small></span></label>'
      + '<label><input type="checkbox" value="write" checked><span><b>write</b><small>create, edit, rename and delete files and projects</small></span></label>'
      + '<label><input type="checkbox" value="deploy"><span><b>deploy</b><small>publish and unpublish apps</small></span></label></div>'
      + '<button type="button" class="st-btn primary block" data-k="create">Create token</button></div>'
      + '<div class="st-agent-api-secret" data-k="secret" hidden></div>'
      + '<div class="st-agent-api-h"><span class="st-label">Your tokens</span><button type="button" class="st-ib" data-k="reload" title="Refresh" aria-label="Refresh tokens">⟳</button></div>'
      + '<div data-k="list"></div>'
      + '<span class="st-label">Use it</span><p class="st-note">Ready to paste into a terminal. Replace the token placeholder with yours.</p><div data-k="examples"></div>'
      + '<p><a href="' + esc(AGENTS_MD) + '" target="_blank" rel="noopener noreferrer">Full API guide for agents (agents.md) ↗</a></p>'
      + '<span class="st-label">Agent brief</span><p class="st-note">Paste this into another AI agent so it knows how to work on this project.</p><div data-k="brief"></div>'
      + '</div>';
    K.root = body.querySelector('.st-agent-api');
    K.root.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b || !K.root.contains(b)) return;
      if (b.classList.contains('st-agent-copy')) { const c = b.closest('.st-agent-code'); if (c) copyText(c.querySelector('code').textContent, b); return; }
      const rv = b.getAttribute('data-revoke'); if (rv) { revokeToken(rv, b.getAttribute('data-label') || rv); return; }
      const k = b.getAttribute('data-k');
      if (k === 'create') createToken();
      else if (k === 'reload') loadTokens();
      else if (k === 'copysecret' && K.secret) copyText(K.secret.token, b);
      else if (k === 'hidesecret') { K.secret = null; paintSecret(); }
      else if (k === 'copyid' && S.projects.current()) copyText(S.projects.current().id, b);
    });
    K.root.querySelector('[data-k="label"]').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); createToken(); } });
    paintApi();
  }

  /* ======================================================================
   * wiring
   * ==================================================================== */
  mountAgent();
  mountApi();

  // Agent panel a little wider than the default sidebar, unless the user picked a width.
  let widened = false;
  function fitSide(id) {
    const want = (id === 'agent' || id === 'agent-api') && !S.ui.isMobile() && window.innerWidth >= 1100 && !S.settings.get('sideW');
    if (want && !widened) { document.documentElement.style.setProperty('--st-side-w', '360px'); widened = true; bus.emit('layout', {}); }
    else if (!want && widened) { if (!S.settings.get('sideW')) document.documentElement.style.removeProperty('--st-side-w'); widened = false; bus.emit('layout', {}); }
  }
  bus.on('activity', (e) => {
    const id = e && e.id;
    fitSide(id);
    if (id === 'agent') { S.ui.setBadge('agent', ''); paintHead(); paintCtx(); scrollBottom(); if (!S.ui.isMobile()) setTimeout(() => { if (A.input && !A.input.disabled && S.ui.activity() === 'agent') A.input.focus(); }, 40); }
    if (id === 'agent-api') { paintApi(); if (!K.loading && (!K.tokens || Date.now() - K.loadedAt > 60000 || K.error)) loadTokens(); }
    if (id !== 'agent-api' && K.secret) { /* keep the one-time secret until the user hides it */ }
  });
  bus.on('project:open', () => { loadConvo(); paintApi(); });
  bus.on('project:close', () => { loadConvo(); paintApi(); });
  bus.on('sync:state', () => { if (S.ui.activity() === 'agent-api') paintApi(); });
  bus.on('active:file', () => paintCtx());
  bus.on('fs:change', (e) => { if (e && e.kind !== 'write') paintCtx(); });
  bus.on('fs:bulk', () => { paintCtx(); repaintAllTools(); });
  setInterval(() => { if (!document.hidden && S.ui.activity() === 'agent') paintHead(); }, 30000);
  window.addEventListener('pagehide', () => { if (C.pid && C.items.length) saveNow(); });

  S.ui.registerCommand({ id: 'agent.ask', title: 'AI Agent: Ask about the selection or file', key: 'Mod+I', run: () => focusAsk() });
  S.ui.registerCommand({ id: 'agent.explain', title: 'AI Agent: Explain the active file', run: () => explainActive() });
  S.ui.registerCommand({ id: 'agent.stop', title: 'AI Agent: Stop', run: () => { if (!stop()) S.ui.toast('The agent is not running.'); } });
  S.ui.registerCommand({ id: 'agent.clear', title: 'AI Agent: Clear conversation', run: () => clear() });
  S.ui.registerCommand({ id: 'agent.tokens', title: 'Agent API: Tokens for external coding agents', run: () => S.ui.setActivity('agent-api', true) });

  S.agent = {
    ask: (prompt, opts) => { open(false); return ask(prompt, opts); },
    stop,
    busy: () => C.busy,
    open,
    clear,
    tools: () => TOOLS.map((t) => JSON.parse(JSON.stringify(t))),
    _debug: { state: C, buildMessages, md, lineDiff, problemsText }
  };
  if (S.projects.current()) loadConvo();
  fitSide(S.ui.activity());           // the shell may have restored the agent activity before our listener existed
  bus.emit('agent:ready', {});
})();

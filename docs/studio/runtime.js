/* ==========================================================================
 * OST Studio · runtime — sandboxed execution, live preview, builds
 * --------------------------------------------------------------------------
 * STUDIO.runtime = { run, stop, preview, refresh, build, runCapture, lastBuild, … }
 *  - Bundler: esbuild-wasm (lazy) over the project FS; npm packages → esm.sh.
 *  - Preview: ONE srcdoc HTML in an <iframe sandbox> WITHOUT allow-same-origin
 *    (opaque origin). A bridge script forwards console/errors via postMessage,
 *    serves project files to fetch()/XHR/<img>, shims storage, handles links.
 *  - Run JS/TS: classic Worker created INSIDE a hidden sandboxed runner iframe;
 *    the worker import()s the bundle from a blob URL it mints itself.
 *  - Run Python: Pyodide in a Worker in the same runner iframe (kept warm).
 *  - Console + Problems panels, Run/Preview actions, deploy build.
 * Contract: project-docs/ost-studio.md §3.
 * SECURITY: user code never runs in this page. Everything coming back is
 * postMessage data from a frame we created (checked by event.source), rendered
 * with textContent; images must be validated base64 PNG/JPEG data: URLs.
 * ========================================================================== */
(function () {
  'use strict';
  const S = window.STUDIO;
  if (!S || S.runtime) return;
  const U = S.util;

  /* ======================================================================
   * constants
   * ==================================================================== */
  // The bundler is the one piece of third-party code that runs on this (wallet) origin, so both files are
  // fetched with Subresource Integrity — a changed or mis-served file is refused, never executed.
  const ESBUILD_JS = 'https://cdn.jsdelivr.net/npm/esbuild-wasm@0.24.2/esm/browser.min.js';
  const ESBUILD_JS_SRI = 'sha384-+UaSOohZWH+IiwjLGInmdtI6NftnhQ415TUrpJklfVI96nHlQZFkcp20p2xhA4YH';
  const ESBUILD_WASM = 'https://cdn.jsdelivr.net/npm/esbuild-wasm@0.24.2/esbuild.wasm';
  const ESBUILD_WASM_SRI = 'sha384-UzF1OduPYrrYA5nS5XKdlrPBLjrRVRoudQRwv6Ixa17gTNPa2sXJzKpRTBgCEhzR';
  const PYODIDE_BASE = 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/';
  const ESM_SH = 'https://esm.sh/';
  const JSDELIVR_NPM = 'https://cdn.jsdelivr.net/npm/';
  const FAKE = 'https://preview.ost-studio.invalid';           // base URL of preview pages (never resolves)
  const PREVIEW_SANDBOX = 'allow-scripts allow-forms allow-modals allow-popups allow-pointer-lock allow-downloads';
  const CAPTURE_SANDBOX = 'allow-scripts allow-forms';          // hidden agent-check frames: no dialogs, no popups
  const PV_ARM_KEY = 'ost.studio.pv.armed';                     // crash sentinel: a preview that froze the tab is not auto-run again
  const INLINE_MAX = 1024 * 1024;                               // static assets inlined into the preview HTML
  const FILES_BUDGET = 4 * 1024 * 1024;                         // project files fetch()-able inside the preview
  const RUN_FILES_BUDGET = 20 * 1024 * 1024;                    // project files visible to fs / Python
  const MAX_LINES = 2000;
  const UI_TIMEOUT = 30000, AGENT_TIMEOUT = 15000, PY_LOAD_TIMEOUT = 240000;
  const REACT_DEFAULT = '18.3.1';
  const VIEWPORTS = { responsive: null, phone: [390, 844], tablet: [768, 1024] };
  const LEVELS = new Set(['log', 'info', 'warn', 'error', 'debug', 'system']);
  const ASSET_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'ico', 'bmp', 'svg', 'woff', 'woff2', 'ttf', 'otf', 'eot', 'mp3', 'wav', 'ogg', 'm4a', 'flac', 'mp4', 'webm', 'mov', 'wasm', 'pdf', 'glb', 'gltf', 'bin', 'zip']);
  const LOADER = { js: 'js', mjs: 'js', cjs: 'js', jsx: 'jsx', ts: 'ts', mts: 'ts', cts: 'ts', tsx: 'tsx', json: 'json', css: 'css', txt: 'text', md: 'text', markdown: 'text', html: 'text', htm: 'text', csv: 'text', tsv: 'text', xml: 'text', yml: 'text', yaml: 'text', glsl: 'text', frag: 'text', vert: 'text', wgsl: 'text', py: 'text', toml: 'text' };
  const RESOLVE_EXT = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.json', '.css', '.mts', '.cjs'];
  const NODE_BUILTIN = new Set(['assert', 'async_hooks', 'buffer', 'child_process', 'cluster', 'console', 'constants', 'crypto', 'dgram', 'diagnostics_channel', 'dns', 'domain', 'events', 'fs', 'http', 'http2', 'https', 'inspector', 'module', 'net', 'os', 'path', 'perf_hooks', 'process', 'punycode', 'querystring', 'readline', 'repl', 'stream', 'string_decoder', 'sys', 'timers', 'tls', 'trace_events', 'tty', 'url', 'util', 'v8', 'vm', 'wasi', 'worker_threads', 'zlib', 'test']);
  const NODE_POLY = { buffer: 'buffer@6.0.3', events: 'events@3.3.0', util: 'util@0.12.5', assert: 'assert@2.1.0', querystring: 'querystring-es3@0.2.1', string_decoder: 'string_decoder@1.3.0', punycode: 'punycode@2.3.1', stream: 'stream-browserify@3.0.0' };
  const PY_ALIAS = { bs4: 'beautifulsoup4', yaml: 'pyyaml', PIL: 'pillow', sklearn: 'scikit-learn', cv2: 'opencv-python', dateutil: 'python-dateutil', dotenv: 'python-dotenv', jwt: 'pyjwt', Crypto: 'pycryptodome', attr: 'attrs', skimage: 'scikit-image', docx: 'python-docx', pptx: 'python-pptx', serial: 'pyserial', websocket: 'websocket-client', OpenSSL: 'pyopenssl', google: 'protobuf' };

  /* ======================================================================
   * small helpers
   * ==================================================================== */
  const now = () => performance.now();
  const fmtMs = (ms) => ms < 1000 ? Math.round(ms) + ' ms' : (ms / 1000).toFixed(ms < 10000 ? 2 : 1) + ' s';
  const isLocalRef = (u) => { u = String(u == null ? '' : u).trim(); return !!u && !/^(?:[a-z][a-z0-9+.-]*:|\/\/|#|\{\{|\$\{|<%)/i.test(u); };
  const encodePath = (p) => String(p).split('/').map(encodeURIComponent).join('/');
  function splitQuery(spec) { const m = /^([^?#]*)([?#][\s\S]*)?$/.exec(String(spec)); return [m ? m[1] : String(spec), m && m[2] ? m[2] : '']; }
  function resolveRef(fromDir, ref) {
    let p = splitQuery(String(ref).trim())[0];
    try { p = decodeURIComponent(p); } catch (_) {}
    return U.normPath(p.charAt(0) === '/' ? p : (fromDir ? fromDir + '/' : '') + p);
  }
  function readJson(path) { try { return JSON.parse(S.fs.read(path) || 'null'); } catch (_) { return null; } }
  function readJsonc(path) {
    const raw = S.fs.read(path); if (!raw) return null;
    try { return JSON.parse(raw.replace(/\/\*[\s\S]*?\*\/|(^|[^:"'\\])\/\/.*$/gm, '$1').replace(/,\s*([}\]])/g, '$1')); } catch (_) { return null; }
  }
  function cleanVer(v) {
    v = String(v == null ? '' : v).trim();
    if (!v || v === '*' || v === 'latest' || /^(file|link|workspace|git|github|https?|npm|portal):/i.test(v) || /\s|\|\|/.test(v)) return '';
    return v.replace(/^=/, '');
  }
  function sizeOf(path) { const c = S.fs.read(path); if (c == null) return 0; if (S.fs.isBinary(path)) return Math.floor((c.length - c.indexOf(',') - 1) * 0.75); return c.length; }
  function dataUrlOf(path) {
    const c = S.fs.read(path); if (c == null) return null;
    if (S.fs.isBinary(path) || (/^data:[^,]*;base64,/.test(c) && !U.isTextPath(path))) return c;
    return 'data:' + U.mimeOf(path) + ';base64,' + U.bytesToB64(new TextEncoder().encode(c));
  }
  function lineOf(text, needle) { text = String(text || ''); const i = text.indexOf(needle); if (i < 0) return 1; let n = 1; for (let k = 0; k < i; k++) if (text.charCodeAt(k) === 10) n++; return n; }
  function jsonForScript(v) { return JSON.stringify(v).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029'); }
  // Text placed inside <script>/<style>: the only sequences that can end the element early.
  const safeScript = (code) => String(code).replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');
  const safeStyle = (css) => String(css).replace(/<\/(style)/gi, '<\\/$1');
  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  const isPreviewVisible = () => document.body.classList.contains('st-preview-on');
  const projectId = () => { const p = S.projects.current(); return p ? p.id : ''; };
  let ACTIVE = '';
  S.bus.on('active:file', (e) => { ACTIVE = (e && e.path) || ''; });
  function activeFile() {
    try { const a = S.editor && typeof S.editor.active === 'function' ? S.editor.active() : null; if (typeof a === 'string') return a; if (a && typeof a.path === 'string') return a.path; } catch (_) {}
    return ACTIVE;
  }
  function reveal(loc) {
    if (!loc || !loc.path) return;
    const ed = S.editor;
    if (!S.fs.exists(loc.path)) { S.ui.toast(loc.path + ' is not in this project.', 'warn'); return; }
    try {
      if (ed && typeof ed.reveal === 'function') ed.reveal(loc.path, loc.line || 1, loc.col || 1);
      else if (ed && typeof ed.open === 'function') ed.open(loc.path);
      else S.bus.emit('open:file', { path: loc.path, line: loc.line, col: loc.col });
    } catch (e) { S.ui.toast(e.message || String(e), 'err'); }
    if (S.ui.isMobile() && isPreviewVisible()) S.ui.togglePreview(false);
  }

  /* ======================================================================
   * code that runs INSIDE the sandboxes (serialized with Function#toString)
   * These functions must be self-contained: no references to outer scope
   * except each other (they are concatenated into the same injected script).
   * ==================================================================== */
  function ostShow(v, depth, seen, quote) {
    depth = depth || 0; seen = seen || [];
    var t = typeof v;
    if (v === null) return 'null';
    if (t === 'undefined') return 'undefined';
    if (t === 'string') { var s0 = v.length > 4000 ? v.slice(0, 4000) + '…' : v; return (depth || quote) ? JSON.stringify(s0) : s0; }
    if (t === 'number') return Object.is(v, -0) ? '-0' : String(v);
    if (t === 'boolean') return String(v);
    if (t === 'bigint') return String(v) + 'n';
    if (t === 'symbol') return v.toString();
    if (t === 'function') { var src = ''; try { src = Function.prototype.toString.call(v); } catch (e) {} return /^class[\s{]/.test(src) ? '[class ' + (v.name || 'anonymous') + ']' : '[Function: ' + (v.name || 'anonymous') + ']'; }
    try {
      if (v instanceof Error || (typeof v.message === 'string' && typeof v.stack === 'string' && typeof v.name === 'string')) {
        var head = (v.name || 'Error') + (v.message ? ': ' + v.message : '');
        if (depth) return '[' + head + ']';
        var st = String(v.stack || '');
        if (st && st.indexOf(head) === 0) return st;
        return st ? head + '\n' + st : head;
      }
      if (seen.indexOf(v) >= 0) return '[Circular]';
      if (typeof Node === 'function' && v instanceof Node) {
        if (v.nodeType === 1) { var cls = v.getAttribute && v.getAttribute('class'); return '<' + v.tagName.toLowerCase() + (v.id ? ' id="' + v.id + '"' : '') + (cls ? ' class="' + String(cls).slice(0, 80) + '"' : '') + '>'; }
        if (v.nodeType === 3) return '#text ' + JSON.stringify(String(v.nodeValue).slice(0, 80));
        if (v.nodeType === 9) return '#document';
        return '[' + (v.nodeName || 'Node') + ']';
      }
      if (typeof Window === 'function' && v instanceof Window) return '[Window]';
      if (v instanceof Date) return isNaN(v.getTime()) ? 'Invalid Date' : v.toISOString();
      if (v instanceof RegExp) return String(v);
      if (typeof Promise === 'function' && v instanceof Promise) return 'Promise { … }';
      if (typeof WeakMap === 'function' && (v instanceof WeakMap || v instanceof WeakSet)) return (v instanceof WeakMap ? 'WeakMap' : 'WeakSet') + ' { <items unknown> }';
      if (depth > 2) return Array.isArray(v) ? '[Array(' + v.length + ')]' : '[Object]';
      seen.push(v);
      var out, i, n, parts = [];
      if (Array.isArray(v)) {
        n = Math.min(v.length, 100);
        for (i = 0; i < n; i++) parts.push(i in v ? ostShow(v[i], depth + 1, seen) : '<empty>');
        if (v.length > n) parts.push('… ' + (v.length - n) + ' more items');
        out = parts.length ? '[ ' + parts.join(', ') + ' ]' : '[]';
      } else if (typeof Map === 'function' && v instanceof Map) {
        i = 0; v.forEach(function (val, key) { if (i++ < 50) parts.push(ostShow(key, depth + 1, seen) + ' => ' + ostShow(val, depth + 1, seen)); });
        if (v.size > 50) parts.push('…');
        out = 'Map(' + v.size + ') {' + (parts.length ? ' ' + parts.join(', ') + ' ' : '') + '}';
      } else if (typeof Set === 'function' && v instanceof Set) {
        i = 0; v.forEach(function (val) { if (i++ < 50) parts.push(ostShow(val, depth + 1, seen)); });
        if (v.size > 50) parts.push('…');
        out = 'Set(' + v.size + ') {' + (parts.length ? ' ' + parts.join(', ') + ' ' : '') + '}';
      } else if (typeof ArrayBuffer === 'function' && ArrayBuffer.isView(v) && !(v instanceof DataView)) {
        n = Math.min(v.length, 50);
        for (i = 0; i < n; i++) parts.push(String(v[i]));
        if (v.length > n) parts.push('… ' + (v.length - n) + ' more');
        out = (v.constructor && v.constructor.name || 'TypedArray') + '(' + v.length + ') [ ' + parts.join(', ') + ' ]';
      } else if (typeof ArrayBuffer === 'function' && v instanceof ArrayBuffer) {
        out = 'ArrayBuffer { byteLength: ' + v.byteLength + ' }';
      } else {
        var keys = Object.keys(v), ctor = '';
        try { var pr = Object.getPrototypeOf(v); ctor = pr === null ? '[Object: null prototype]' : (pr && pr.constructor && pr.constructor.name) || ''; } catch (e) {}
        n = Math.min(keys.length, 50);
        for (i = 0; i < n; i++) {
          var k = keys[i], val;
          try { val = ostShow(v[k], depth + 1, seen); } catch (e) { val = '[Getter threw]'; }
          parts.push((/^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k)) + ': ' + val);
        }
        if (keys.length > n) parts.push('… ' + (keys.length - n) + ' more keys');
        out = (ctor && ctor !== 'Object' ? ctor + ' ' : '') + (parts.length ? '{ ' + parts.join(', ') + ' }' : '{}');
      }
      seen.pop();
      if (out.length > 8000) out = out.slice(0, 8000) + '…';
      return out;
    } catch (e) { return '[' + t + ']'; }
  }

  function ostFmt(args) {
    var a = Array.prototype.slice.call(args), out = [], i = 0;
    if (typeof a[0] === 'string' && a.length > 1 && /%[sdifoOjc%]/.test(a[0])) {
      i = 1;
      out.push(a[0].replace(/%([sdifoOjc%])/g, function (m, c) {
        if (c === '%') return '%';
        if (i >= a.length) return m;
        var v = a[i++];
        if (c === 'c') return '';
        if (c === 's') return typeof v === 'string' ? v : ostShow(v, 1);
        if (c === 'd' || c === 'i') return typeof v === 'object' ? 'NaN' : String(parseInt(v, 10));
        if (c === 'f') return String(parseFloat(v));
        return ostShow(v, 0, [], true);
      }));
    }
    for (; i < a.length; i++) out.push(typeof a[i] === 'string' ? a[i] : ostShow(a[i], 0, [], true));
    return out.join(' ');
  }

  function ostTable(data, cols) {
    if (data === null || typeof data !== 'object') return ostShow(data);
    var rows = Array.isArray(data) ? data.map(function (v, i) { return [i, v]; }) : Object.keys(data).map(function (k) { return [k, data[k]]; });
    rows = rows.slice(0, 100);
    var keys = [], hasVal = false;
    rows.forEach(function (r) {
      var v = r[1];
      if (v && typeof v === 'object') Object.keys(v).forEach(function (k) { if (keys.indexOf(k) < 0 && keys.length < 12) keys.push(k); });
      else hasVal = true;
    });
    if (Array.isArray(cols)) keys = cols.map(String);
    var head = ['(index)'].concat(keys); if (hasVal) head.push('Values');
    var body = rows.map(function (r) {
      var v = r[1], line = [String(r[0])];
      keys.forEach(function (k) { line.push(v && typeof v === 'object' && k in v ? ostShow(v[k], 1) : ''); });
      if (hasVal) line.push(v && typeof v === 'object' ? '' : ostShow(v, 1));
      return line;
    });
    var w = head.map(function (h, i) { var m = String(h).length; body.forEach(function (l) { m = Math.max(m, l[i].length); }); return Math.min(40, m); });
    function row(l) { return '│ ' + l.map(function (c, i) { c = String(c); if (c.length > w[i]) c = c.slice(0, w[i] - 1) + '…'; return c + new Array(w[i] - c.length + 1).join(' '); }).join(' │ ') + ' │'; }
    function sep(a, b, c) { return a + w.map(function (n) { return new Array(n + 3).join('─'); }).join(b) + c; }
    return [sep('┌', '┬', '┐'), row(head), sep('├', '┼', '┤')].concat(body.map(row), [sep('└', '┴', '┘')]).join('\n');
  }

  function ostPatchConsole(con, out, forward, onClear) {
    var indent = '', counts = {}, times = {};
    function emit(level, text) { text = String(text); out(level, indent ? indent + text.replace(/\n/g, '\n' + indent) : text); }
    function wrap(name, fn) {
      var orig = con[name];
      try { con[name] = function () { try { fn.apply(null, arguments); } catch (e) {} if (forward && typeof orig === 'function') { try { return orig.apply(con, arguments); } catch (e) {} } }; } catch (e) {}
    }
    var lbl = function (l) { return l === undefined ? 'default' : String(l); };
    var ms = function (v) { return v < 1000 ? v.toFixed(3) + ' ms' : (v / 1000).toFixed(3) + ' s'; };
    ['log', 'info', 'warn', 'error', 'debug'].forEach(function (lv) { wrap(lv, function () { emit(lv, ostFmt(arguments)); }); });
    wrap('dir', function (v) { emit('log', ostShow(v, 0, [], true)); });
    wrap('dirxml', function (v) { emit('log', ostShow(v, 0, [], true)); });
    wrap('table', function (d, c) { emit('log', ostTable(d, c)); });
    wrap('trace', function () { var st = String(new Error().stack || '').split('\n').slice(3).join('\n'); emit('log', 'Trace' + (arguments.length ? ': ' + ostFmt(arguments) : '') + (st ? '\n' + st : '')); });
    wrap('assert', function (c) { if (!c) { var a = Array.prototype.slice.call(arguments, 1); emit('error', 'Assertion failed' + (a.length ? ': ' + ostFmt(a) : '')); } });
    wrap('count', function (l) { l = lbl(l); counts[l] = (counts[l] || 0) + 1; emit('log', l + ': ' + counts[l]); });
    wrap('countReset', function (l) { counts[lbl(l)] = 0; });
    wrap('time', function (l) { times[lbl(l)] = performance.now(); });
    wrap('timeLog', function (l) { l = lbl(l); if (l in times) emit('log', l + ': ' + ms(performance.now() - times[l]) + (arguments.length > 1 ? ' ' + ostFmt(Array.prototype.slice.call(arguments, 1)) : '')); else emit('warn', "Timer '" + l + "' does not exist"); });
    wrap('timeEnd', function (l) { l = lbl(l); if (l in times) { emit('log', l + ': ' + ms(performance.now() - times[l])); delete times[l]; } else emit('warn', "Timer '" + l + "' does not exist"); });
    wrap('group', function () { if (arguments.length) emit('log', ostFmt(arguments)); indent += '  '; });
    wrap('groupCollapsed', function () { if (arguments.length) emit('log', ostFmt(arguments)); indent += '  '; });
    wrap('groupEnd', function () { indent = indent.slice(2); });
    wrap('clear', function () { if (onClear) onClear(); });
  }

  /* ---- preview bridge: first script of every preview page ---- */
  function OST_BRIDGE(C) {
    'use strict';
    var W = window, D = document, P = W.parent, FAKE = C.fake, F = C.files || {};
    var _st = W.setTimeout.bind(W), _ct = W.clearTimeout.bind(W);
    function send(m) { m.gen = C.gen; try { P.postMessage(m, '*'); } catch (e) {} }
    var q = [], qt = 0, win = 0, sent = 0, dropped = 0;
    function flush() { if (qt) { _ct(qt); qt = 0; } if (q.length) { var b = q; q = []; send({ __ost: 'lines', lines: b }); } }
    function out(level, text, extra) {
      var t = Date.now();
      if (t - win >= 1000) { if (dropped) q.push({ level: 'warn', text: '… ' + dropped + ' console lines dropped (preview limit: 500 per second)' }); dropped = 0; win = t; sent = 0; }
      if (sent >= 500) { dropped++; return; }
      sent++;
      text = String(text); if (text.length > 20000) text = text.slice(0, 20000) + '… (' + text.length + ' chars)';
      var l = { level: level, text: text };
      if (extra) for (var k in extra) l[k] = extra[k];
      q.push(l);
      if (q.length >= 100) flush(); else if (!qt) qt = _st(flush, 30);
    }
    ostPatchConsole(W.console, out, true, function () { flush(); send({ __ost: 'clear' }); });

    // ---- project files served to fetch / XHR / <img> / <audio> / Worker ----
    function rel(u) {
      try { var x = new URL(String(u), D.baseURI); if (x.origin !== FAKE) return null; var p = decodeURIComponent(x.pathname).replace(/^\/+/, ''); if (!p || /\/$/.test(p)) p += 'index.html'; return p; } catch (e) { return null; }
    }
    function bytes(d) { var b = atob(d.slice(d.indexOf(',') + 1)), u = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
    function blobOf(p) { var f = F[p]; return new Blob([f.d ? bytes(f.d) : f.c], { type: f.t }); }
    var blobs = {}, made = {}, warned = {};
    function urlOf(p) { if (!blobs[p]) { blobs[p] = URL.createObjectURL(blobOf(p)); made[blobs[p]] = 1; } return blobs[p]; }
    function missing(p) { if (warned[p]) return; warned[p] = 1; out('warn', '"' + p + '" is not in the project (or is too large to serve in the preview).'); }
    function mapUrl(v) { if (v == null) return v; var p = rel(v); if (p == null) return v; if (!F[p]) { missing(p); return v; } return urlOf(p); }
    var _fetch = W.fetch;
    if (_fetch) W.fetch = function (input, init) {
      try {
        var url = typeof input === 'string' ? input : input && (input.href || input.url);
        var p = url != null ? rel(url) : null;
        if (p != null) {
          var m = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
          if (!F[p]) { missing(p); return Promise.resolve(new Response('Not found: ' + p, { status: 404, statusText: 'Not Found', headers: { 'Content-Type': 'text/plain' } })); }
          if (m !== 'GET' && m !== 'HEAD') { out('warn', m + ' ' + p + ' — the preview has no server; project files are read-only. Call your API with a full https:// URL.'); return Promise.resolve(new Response('Method Not Allowed', { status: 405, statusText: 'Method Not Allowed' })); }
          return Promise.resolve(new Response(m === 'HEAD' ? null : blobOf(p), { status: 200, statusText: 'OK', headers: { 'Content-Type': F[p].t } }));
        }
      } catch (e) {}
      return _fetch.apply(this, arguments);
    };
    var XO = W.XMLHttpRequest && W.XMLHttpRequest.prototype.open;
    if (XO) W.XMLHttpRequest.prototype.open = function (method, url) {
      var a = Array.prototype.slice.call(arguments);
      try { var p = rel(url); if (p != null) { if (F[p]) a[1] = urlOf(p); else missing(p); } } catch (e) {}
      return XO.apply(this, a);
    };
    function patchProp(proto, prop, when) {
      if (!proto) return; var d = Object.getOwnPropertyDescriptor(proto, prop); if (!d || !d.set) return;
      try { Object.defineProperty(proto, prop, { configurable: true, enumerable: d.enumerable, get: d.get, set: function (v) { d.set.call(this, !when || when(this) ? mapUrl(v) : v); } }); } catch (e) {}
    }
    var linkish = function (l) { return /stylesheet|icon|preload|prefetch/i.test(l.rel || ''); };
    patchProp(W.HTMLImageElement && HTMLImageElement.prototype, 'src');
    patchProp(W.HTMLMediaElement && HTMLMediaElement.prototype, 'src');
    patchProp(W.HTMLSourceElement && HTMLSourceElement.prototype, 'src');
    patchProp(W.HTMLScriptElement && HTMLScriptElement.prototype, 'src');
    patchProp(W.HTMLTrackElement && HTMLTrackElement.prototype, 'src');
    patchProp(W.HTMLVideoElement && HTMLVideoElement.prototype, 'poster');
    patchProp(W.HTMLLinkElement && HTMLLinkElement.prototype, 'href', linkish);
    var TAGS = { IMG: 1, AUDIO: 1, VIDEO: 1, SOURCE: 1, SCRIPT: 1, TRACK: 1, INPUT: 1, EMBED: 1 };
    var SA = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function (n, v) {
      try { var ln = String(n).toLowerCase(); if (((ln === 'src' || ln === 'poster') && TAGS[this.tagName]) || (ln === 'href' && this.tagName === 'LINK' && linkish(this))) v = mapUrl(v); } catch (e) {}
      return SA.call(this, n, v);
    };
    if (W.Audio) { var A0 = W.Audio; var A1 = function Audio(src) { var a = new A0(); if (src !== undefined) a.src = src; return a; }; A1.prototype = A0.prototype; W.Audio = A1; }
    if (W.Worker) {
      var WK = W.Worker;
      var WK1 = function Worker(u, o) {
        var p = rel(u && u.href ? u.href : u);
        if (p != null && F[p]) { if (o && o.type === 'module') { var f = F[p]; u = 'data:text/javascript;base64,' + (f.d ? f.d.slice(f.d.indexOf(',') + 1) : btoa(unescape(encodeURIComponent(f.c)))); } else u = urlOf(p); }
        return new WK(u, o);
      };
      WK1.prototype = WK.prototype; W.Worker = WK1;
    }
    function fix(n) {
      if (!n || n.nodeType !== 1) return;
      var t = n.tagName, v, p;
      if (TAGS[t] || (t === 'LINK' && linkish(n))) {
        ['src', 'poster', 'href'].forEach(function (a) { if (a === 'href' && t !== 'LINK') return; v = n.getAttribute(a); if (v && (p = rel(v)) != null && F[p]) SA.call(n, a, urlOf(p)); });
      }
      if ((t === 'IMG' || t === 'SOURCE') && (v = n.getAttribute('srcset')) && v.indexOf('data:') < 0 && v.indexOf('blob:') < 0) {
        var nv = v.split(',').map(function (part) { var m = /^(\s*)(\S+)(.*)$/.exec(part); if (!m) return part; var q2 = rel(m[2]); return q2 != null && F[q2] ? m[1] + urlOf(q2) + m[3] : part; }).join(',');
        if (nv !== v) SA.call(n, 'srcset', nv);
      }
    }
    try {
      new MutationObserver(function (recs) {
        recs.forEach(function (r) {
          if (r.type === 'attributes') fix(r.target);
          else for (var i = 0; i < r.addedNodes.length; i++) { var n = r.addedNodes[i]; if (n.nodeType === 1) { fix(n); if (n.querySelectorAll) { var l = n.querySelectorAll('img,audio,video,source,track,link,input,embed,script'); for (var j = 0; j < l.length; j++) fix(l[j]); } } }
        });
      }).observe(D.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['src', 'poster', 'href', 'srcset'] });
    } catch (e) {}

    // ---- errors ----
    W.addEventListener('error', function (e) {
      var t = e.target;
      if (t && t !== W && t.nodeType === 1) {
        var u = t.currentSrc || t.src || t.href || '';
        if (!u || made[u]) return;
        var p = rel(u);
        out('warn', 'Failed to load <' + t.tagName.toLowerCase() + '> ' + (p != null ? p + (F[p] ? '' : ' — not in the project') : String(u).slice(0, 200)));
        return;
      }
      var er = e.error;
      out('error', er && er.stack ? 'Uncaught ' + ostShow(er) : (e.message || 'Script error'), { file: e.filename || '', line: e.lineno || 0, col: e.colno || 0 });
      flush();
    }, true);
    W.addEventListener('unhandledrejection', function (e) { out('error', 'Uncaught (in promise) ' + ostShow(e.reason, 0, [], true)); flush(); });

    // ---- storage + cookies (opaque origin has none): in-memory, persisted by the studio per project ----
    function mkStore(init, onChange) {
      var m = Object.create(null), k;
      if (init) for (k in init) m[k] = String(init[k]);
      var ch = function () { if (onChange) onChange(m); };
      var api = {
        getItem: function (k) { k = String(k); return k in m ? m[k] : null; },
        setItem: function (k, v) { m[String(k)] = String(v); ch(); },
        removeItem: function (k) { delete m[String(k)]; ch(); },
        clear: function () { for (var x in m) delete m[x]; ch(); },
        key: function (i) { var ks = Object.keys(m); return i >= 0 && i < ks.length ? ks[i] : null; }
      };
      Object.defineProperty(api, 'length', { configurable: true, enumerable: false, get: function () { return Object.keys(m).length; } });
      return new Proxy(api, {
        get: function (t, p) { if (p in t) return t[p]; return typeof p === 'string' && p in m ? m[p] : undefined; },
        set: function (t, p, v) { if (typeof p !== 'string' || p in t) return true; m[p] = String(v); ch(); return true; },
        has: function (t, p) { return p in t || p in m; },
        deleteProperty: function (t, p) { if (p in m) { delete m[p]; ch(); } return true; },
        ownKeys: function () { return Object.keys(m); },
        getOwnPropertyDescriptor: function (t, p) { if (typeof p === 'string' && p in m) return { value: m[p], writable: true, enumerable: true, configurable: true }; return undefined; }
      });
    }
    function shim(name, init, persist) {
      try { var s = W[name]; if (s && typeof s.getItem === 'function') { s.length; return; } } catch (e) {}
      var tm = 0;
      var st = mkStore(init, persist ? function (m) { if (tm) _ct(tm); tm = _st(function () { tm = 0; var o = {}; for (var k in m) o[k] = m[k]; send({ __ost: 'storage', data: o }); }, 300); } : null);
      try { Object.defineProperty(W, name, { configurable: true, enumerable: true, get: function () { return st; } }); } catch (e) {}
    }
    shim('localStorage', C.storage, true);
    shim('sessionStorage', null, false);
    try { void D.cookie; } catch (e) {
      var jar = {};
      try {
        Object.defineProperty(D, 'cookie', { configurable: true, get: function () { return Object.keys(jar).map(function (k) { return k + '=' + jar[k]; }).join('; '); }, set: function (v) { var kv = String(v).split(';')[0], i = kv.indexOf('='); if (i > 0) { var k = kv.slice(0, i).trim(); if (/max-age=0|expires=thu, 01 jan 1970/i.test(v)) delete jar[k]; else jar[k] = kv.slice(i + 1).trim(); } } });
      } catch (er) {}
    }
    // pushState to a real path cannot work on about:srcdoc — keep the app alive and explain once.
    ['pushState', 'replaceState'].forEach(function (k) {
      var o = W.history && W.history[k]; if (!o) return;
      W.history[k] = function (s, t, u) {
        try { return o.apply(W.history, arguments); } catch (e) {
          if (u == null) throw e;
          try { o.call(W.history, s, t); } catch (e2) {}
          if (!warned['h:' + k]) { warned['h:' + k] = 1; out('warn', 'history.' + k + '("' + u + '") — URL-path routing cannot change the address of the sandboxed preview (about:srcdoc). Use hash routes (#/page, e.g. HashRouter): they work in the preview and after deploy. Path routing on OST Apps also needs the app’s base path (/<name>/) as the router basename.'); }
        }
      };
    });

    // ---- links + forms ----
    function goHash(h) {
      if (!h || h === '#') { try { W.scrollTo(0, 0); } catch (e) {} return; }
      try { location.hash = h; } catch (e) {}
      var id = h.slice(1); try { id = decodeURIComponent(id); } catch (e) {}
      var t = D.getElementById(id) || D.getElementsByName(id)[0];
      if (t && t.scrollIntoView) t.scrollIntoView();
    }
    D.addEventListener('click', function (e) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      var a = e.target && e.target.closest ? e.target.closest('a[href], area[href]') : null;
      if (!a) return;
      var raw = a.getAttribute('href') || '';
      if (/^\s*javascript:/i.test(raw) || a.hasAttribute('download')) return;
      if (raw.charAt(0) === '#') { e.preventDefault(); goHash(raw); return; }
      var x; try { x = new URL(raw, D.baseURI); } catch (er) { return; }
      if (x.origin === FAKE) {
        e.preventDefault();
        var p = rel(x.href);
        if (p === C.page && x.hash) { goHash(x.hash); return; }
        flush(); send({ __ost: 'nav', path: p, hash: x.hash || '' });
        return;
      }
      if (/^https?:$/.test(x.protocol) && (a.getAttribute('target') || '').toLowerCase() !== '_blank') { e.preventDefault(); W.open(x.href, '_blank', 'noopener'); }
    }, false);
    var WO = W.open;
    W.open = function (u) { var p = u != null && String(u) ? rel(u) : null; if (p != null) { flush(); send({ __ost: 'nav', path: p, hash: '' }); return null; } return WO.apply(W, arguments); };
    W.addEventListener('submit', function (e) {
      if (e.defaultPrevented) return;
      var f = e.target, act = f && f.getAttribute ? f.getAttribute('action') : '', x = null;
      try { x = new URL(act || '', D.baseURI); } catch (er) {}
      if (act && x && /^https?:$/.test(x.protocol) && x.origin !== FAKE) return;
      e.preventDefault();
      out('info', 'Form submitted' + (f && f.id ? ' (#' + f.id + ')' : '') + ' — the preview has no server, so nothing was sent. Handle the "submit" event in JavaScript (event.preventDefault()) or post to a full https:// URL.');
    }, false);

    // ---- studio → page: REPL eval + CSS hot swap ----
    W.addEventListener('message', function (e) {
      if (e.source !== P) return;
      var d = e.data; if (!d || typeof d !== 'object') return;
      if (d.__ost === 'eval') {
        var r;
        try { r = (0, eval)(String(d.code)); } catch (er) { flush(); send({ __ost: 'eval', id: d.id, ok: false, text: 'Uncaught ' + ostShow(er, 0, [], true) }); return; }
        Promise.resolve(r).then(function (v) { flush(); send({ __ost: 'eval', id: d.id, ok: true, text: ostShow(v, 0, [], true) }); }, function (er) { flush(); send({ __ost: 'eval', id: d.id, ok: false, text: 'Uncaught (in promise) ' + ostShow(er, 0, [], true) }); });
      } else if (d.__ost === 'css' && typeof d.path === 'string') {
        var els = D.querySelectorAll('style[data-ost-css]');
        for (var i = 0; i < els.length; i++) if (els[i].getAttribute('data-ost-css') === d.path) els[i].textContent = String(d.text);
      }
    });
    W.addEventListener('load', function () { flush(); send({ __ost: 'ready' }); if (C.hash) goHash(C.hash); });
    W.addEventListener('pagehide', flush);
    try { if (D.currentScript) D.currentScript.remove(); } catch (e) {}
  }

  /* ---- JS run worker (classic worker inside the runner iframe) ---- */
  function OST_JS_WORKER() {
    'use strict';
    var post = self.postMessage.bind(self);
    var _st = self.setTimeout.bind(self), _ct = self.clearTimeout.bind(self), _si = self.setInterval.bind(self), _ci = self.clearInterval.bind(self);
    var q = [], qt = 0, win = 0, sent = 0, dropped = 0, total = 0, lastFlush = 0;
    var started = false, evaluated = false, finished = false, pending = 0, grace = 0, timers = new Map(), EXIT = { ostExit: true };
    var RATE = 1000, TOTAL = 20000;
    function flush() { if (qt) { _ct(qt); qt = 0; } lastFlush = Date.now(); if (q.length) { var b = q; q = []; post({ type: 'lines', lines: b }); } }
    function out(level, text) {
      if (finished) return;
      var t = Date.now();
      if (t - win >= 1000) { if (dropped) q.push({ level: 'warn', text: '… ' + dropped + ' lines dropped (output limit: ' + RATE + ' lines per second)' }); dropped = 0; win = t; sent = 0; }
      if (total >= TOTAL) { if (total++ === TOTAL) q.push({ level: 'warn', text: 'Output limit reached (' + TOTAL + ' lines) — further output is hidden.' }); return; }
      if (sent >= RATE) { dropped++; return; }
      sent++; total++;
      text = String(text); if (text.length > 20000) text = text.slice(0, 20000) + '… (' + text.length + ' chars)';
      q.push({ level: level, text: text });
      if (q.length >= 200 || t - lastFlush >= 100) flush(); else if (!qt) qt = _st(flush, 25);
    }
    ostPatchConsole(self.console, out, false, function () { flush(); post({ type: 'clear' }); });

    // node-like lifetime: finish when the module evaluated and nothing is pending
    function busy() { return pending > 0 || timers.size > 0; }
    function check() {
      if (finished || !evaluated || busy() || grace) return;
      grace = _st(function () { grace = 0; if (!finished && evaluated && !busy()) finish(true, ''); }, 60);
    }
    self.setTimeout = function (fn, ms) {
      var args = Array.prototype.slice.call(arguments, 2);
      var id = _st(function () { timers.delete(id); try { if (typeof fn === 'function') fn.apply(self, args); } finally { check(); } }, ms);
      timers.set(id, 1); return id;
    };
    self.clearTimeout = function (id) { _ct(id); if (timers.delete(id)) check(); };
    self.setInterval = function (fn, ms) {
      var args = Array.prototype.slice.call(arguments, 2);
      var id = _si(function () { if (typeof fn === 'function') fn.apply(self, args); }, ms);
      timers.set(id, 2); return id;
    };
    self.clearInterval = function (id) { _ci(id); if (timers.delete(id)) check(); };
    self.setImmediate = function (fn) { var a = Array.prototype.slice.call(arguments, 1); return self.setTimeout(function () { fn.apply(self, a); }, 0); };
    self.clearImmediate = self.clearTimeout;
    function track(p) { if (!p || typeof p.then !== 'function') return p; pending++; var d = false; var done = function () { if (!d) { d = true; pending--; check(); } }; p.then(done, done); return p; }
    function wrap(proto, names) { if (!proto) return; names.forEach(function (n) { var f = proto[n]; if (typeof f !== 'function') return; proto[n] = function () { return track(f.apply(this, arguments)); }; }); }
    if (self.fetch) { var _fetch = self.fetch; self.fetch = function () { return track(_fetch.apply(self, arguments)); }; }
    if (self.XMLHttpRequest) {                         // axios & co. use XHR inside a worker
      var XS = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.send = function () {
        var x = this, d = false;
        var done = function () { if (!d) { d = true; pending--; x.removeEventListener('loadend', done); check(); } };
        pending++; x.addEventListener('loadend', done);
        try { return XS.apply(x, arguments); } catch (e) { done(); throw e; }
      };
    }
    wrap(self.Response && Response.prototype, ['json', 'text', 'arrayBuffer', 'blob', 'formData']);
    wrap(self.Blob && Blob.prototype, ['text', 'arrayBuffer']);
    wrap(self.SubtleCrypto && SubtleCrypto.prototype, ['digest', 'encrypt', 'decrypt', 'sign', 'verify', 'generateKey', 'deriveKey', 'deriveBits', 'importKey', 'exportKey', 'wrapKey', 'unwrapKey']);
    if (self.WebSocket) {
      var WS = self.WebSocket;
      var WS1 = function WebSocket(u, p) { var ws = p === undefined ? new WS(u) : new WS(u, p); pending++; var r = false; ws.addEventListener('close', function () { if (!r) { r = true; pending--; check(); } }); return ws; };
      WS1.prototype = WS.prototype; ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'].forEach(function (k) { WS1[k] = WS[k]; }); self.WebSocket = WS1;
    }

    // process shim (stdout.write keeps partial lines like a terminal)
    var partial = { log: '', error: '' };
    function writer(level) { return function (s) { var parts = (partial[level] + String(s)).split('\n'); partial[level] = parts.pop(); parts.forEach(function (l) { out(level, l); }); return true; }; }
    function hr(prev) { var t = performance.now() * 1e6, s = Math.floor(t / 1e9), n = Math.floor(t % 1e9); if (prev) { s -= prev[0]; n -= prev[1]; if (n < 0) { s--; n += 1e9; } } return [s, n]; }
    hr.bigint = function () { return BigInt(Math.round(performance.now() * 1e6)); };
    var listeners = {};
    var proc = {
      env: { NODE_ENV: 'development' }, argv: ['node', '/index.js'], argv0: 'node', execArgv: [], platform: 'browser', arch: 'wasm', version: 'v20.0.0', versions: { node: '20.0.0' }, pid: 1, ppid: 0, title: 'ost-studio', exitCode: undefined, release: { name: 'node' },
      cwd: function () { return '/'; }, chdir: function () {}, uptime: function () { return performance.now() / 1000; }, hrtime: hr, memoryUsage: function () { return { rss: 0, heapTotal: 0, heapUsed: 0, external: 0, arrayBuffers: 0 }; },
      nextTick: function (fn) { var a = Array.prototype.slice.call(arguments, 1); queueMicrotask(function () { fn.apply(null, a); }); },
      exit: function (code) { code = code == null ? (proc.exitCode | 0) : code | 0; finish(code === 0, code ? 'process.exit(' + code + ')' : '', code); throw EXIT; },
      on: function (ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); return proc; }, once: function (ev, fn) { return proc.on(ev, fn); }, off: function () { return proc; }, removeListener: function () { return proc; }, removeAllListeners: function () { return proc; }, emit: function () { return false; }, listeners: function (ev) { return listeners[ev] || []; },
      stdout: { write: writer('log'), isTTY: false, columns: 100, rows: 30, on: function () {} }, stderr: { write: writer('error'), isTTY: false, on: function () {} }, stdin: { isTTY: false, on: function () {}, setEncoding: function () {}, resume: function () {}, pause: function () {} }
    };
    self.process = proc; self.global = self;

    function show(err) { return ostShow(err, 0, [], true); }
    function finish(ok, error, code) {
      if (finished) return;
      ['log', 'error'].forEach(function (l) { if (partial[l]) { out(l, partial[l]); partial[l] = ''; } });
      if (dropped) { q.push({ level: 'warn', text: '… ' + dropped + ' lines dropped (output limit: ' + RATE + ' lines per second)' }); dropped = 0; }
      flush(); finished = true;
      var fsw = self.__ostFS && self.__ostFS.writes;
      post({ type: 'done', ok: !!ok, error: error || '', exitCode: code == null ? (ok ? 0 : 1) : code, writes: fsw && Object.keys(fsw).length ? fsw : null });
    }
    function uncaught(err, prefix) {
      if (finished || err === EXIT) return;
      var text = (prefix || 'Uncaught ') + show(err);
      out('error', text);
      (listeners.exit || []).forEach(function (f) { try { f(1); } catch (e) {} });
      finish(false, String(text).split('\n')[0].slice(0, 300), 1);
    }
    self.addEventListener('error', function (e) { e.preventDefault(); uncaught(e.error !== undefined && e.error !== null ? e.error : e.message); });
    self.addEventListener('unhandledrejection', function (e) { e.preventDefault(); if (e.reason === EXIT) return; uncaught(e.reason, 'Uncaught (in promise) '); });

    self.onmessage = function (e) {
      var d = e.data || {};
      if (d.type !== 'start' || started) return;
      started = true;
      var path = String(d.path || 'index.js');
      self.__ostFS = { files: d.files || {}, bin: d.bin || {}, writes: {}, dirs: {} };
      proc.argv[1] = '/' + path;
      self.__filename = '/' + path; self.__dirname = '/' + path.split('/').slice(0, -1).join('/');
      var code = String(d.code || '');
      if (d.repl) {
        var t = code.trim().replace(/;+\s*$/, '');
        var stmt = /^(const|let|var|function|async\s+function|class|if|for|while|do|switch|try|import|export|return|throw|\{)\b/.test(t) || /;\s*\S/.test(t) || /\n/.test(t);
        if (!stmt && t) code = 'const __ostV = await (' + t + '\n);\nif (__ostV !== undefined) console.log(__ostV);';
      }
      if (d.name) code += '\n//# sourceURL=' + String(d.name).replace(/[^\w.-]/g, '');
      var url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
      post({ type: 'exec-start' });
      import(url).then(function () {
        evaluated = true;
        if ((listeners.beforeExit || listeners.exit) && !busy()) { (listeners.exit || []).forEach(function (f) { try { f(0); } catch (er) {} }); }
        check();
      }, function (err) { uncaught(err); });
    };
  }

  /* ---- Python worker (classic worker inside the runner iframe) ---- */
  function OST_PY_WORKER(C) {
    'use strict';
    var post = self.postMessage.bind(self);
    var _st = self.setTimeout.bind(self), _ct = self.clearTimeout.bind(self);
    var py = null, booting = null, lastG = null, cur = '', cancelled = Object.create(null), mpl = false;
    var q = [], qt = 0, win = 0, sent = 0, dropped = 0, total = 0, lastFlush = 0;
    function flush() { if (qt) { _ct(qt); qt = 0; } lastFlush = Date.now(); if (q.length) { var b = q; q = []; post({ type: 'lines', id: cur, lines: b }); } }
    function out(level, text) {
      var t = Date.now();
      if (t - win >= 1000) { if (dropped) q.push({ level: 'warn', text: '… ' + dropped + ' lines dropped (output limit: 1000 lines per second)' }); dropped = 0; win = t; sent = 0; }
      if (total >= 20000) { if (total++ === 20000) q.push({ level: 'warn', text: 'Output limit reached (20000 lines) — further output is hidden.' }); return; }
      if (sent >= 1000) { dropped++; return; }
      sent++; total++;
      text = String(text); if (text.length > 20000) text = text.slice(0, 20000) + '… (' + text.length + ' chars)';
      q.push({ level: level, text: text });
      if (q.length >= 200 || t - lastFlush >= 100) flush(); else if (!qt) qt = _st(flush, 25);
    }
    function status(text) { flush(); post({ type: 'status', id: cur, text: text }); }
    function ensure() {
      if (booting) return booting;
      booting = (async function () {
        var t0 = Date.now();
        status('Loading Python 3.12 (Pyodide)… the first run downloads about 6 MB, then your browser caches it.');
        importScripts(C.base + 'pyodide.js');
        var p = await self.loadPyodide({ indexURL: C.base });
        p.setStdout({ batched: function (s) { out('log', s); } });
        p.setStderr({ batched: function (s) { out('error', s); } });
        try { p.setStdin({ stdin: function () { return null; } }); } catch (e) {}
        self.ostImage = function (b64) { flush(); post({ type: 'image', id: cur, data: 'data:image/png;base64,' + String(b64) }); };
        self.ostNote = function (t) { out('system', String(t)); };
        await p.runPythonAsync(C.setup);
        py = p;
        var pv = ''; try { pv = p.runPython('import sys\nsys.version.split()[0]'); } catch (e) {}
        status('Python ' + (pv || '3') + ' ready (Pyodide ' + p.version + ', ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s)');
      })();
      booting.catch(function () { booting = null; });
      return booting;
    }
    function b64bytes(d) { d = String(d); var s = atob(d.slice(d.indexOf(',') + 1)), u = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; }
    function toJs(proxy) { try { var v = proxy.toJs(); if (proxy.destroy) proxy.destroy(); return v || []; } catch (e) { return []; } }
    function cleanTb(msg, path) {
      var lines = String(msg).split('\n'), res = [], skip = false;
      for (var i = 0; i < lines.length; i++) {
        var l = lines[i], m = /^\s*File "([^"]+)", line \d+/.exec(l);
        if (m) { skip = /^\/lib\/python\d|\/_pyodide\/|\/site-packages\/pyodide\/|^<frozen /.test(m[1]); if (skip) continue; }
        else if (skip && /^\s{4,}\S/.test(l)) continue;
        else skip = false;
        res.push(l.split('"/project/').join('"').split('"<exec>"').join('"' + path + '"'));
      }
      return res.join('\n').trim();
    }
    function lastLine(s) { var l = String(s).split('\n').filter(function (x) { return x.trim(); }); return (l[l.length - 1] || 'Error').trim().slice(0, 300); }
    function flushStd() { try { if (py) py.runPython('import sys\nsys.stdout.flush()\nsys.stderr.flush()'); } catch (e) {} }
    function fail(d, e, path) {
      flushStd();
      var msg = cleanTb(String(e && e.message || e), path), last = lastLine(msg);
      var se = /^SystemExit(?::\s*([\s\S]*))?$/.exec(last);
      if (se) {                                        // sys.exit(): like the python CLI — no traceback
        var v = (se[1] || '').trim();
        if (!v || v === '0' || v === 'None') { flush(); post({ type: 'done', id: d.id, ok: true }); return; }
        if (!/^-?\d+$/.test(v)) out('error', v.replace(/^(['"])([\s\S]*)\1$/, '$2'));
        flush(); post({ type: 'done', id: d.id, ok: false, error: /^-?\d+$/.test(v) ? 'exit code ' + v : 'exit code 1' }); return;
      }
      out('error', py ? msg : 'Python could not start: ' + msg + '\nCheck your connection — Pyodide loads from cdn.jsdelivr.net.');
      flush();
      post({ type: 'done', id: d.id, ok: false, error: last });
      // out of memory / stack overflow leave Pyodide permanently broken — ask the runner for a fresh interpreter
      if (py) { var dead = false; try { py.runPython('None'); } catch (er) { dead = true; } if (dead) post({ type: 'fatal' }); }
    }
    async function prepare(d) {
      var DIR = '/project', files = d.files || {}, bin = d.bin || {};
      py.globals.get('_ost_reset')(DIR);
      Object.keys(files).forEach(function (p) {
        if (!p || p.indexOf('\0') >= 0 || /(^|\/)\.\.(\/|$)/.test(p)) return;
        var full = DIR + '/' + p, k = full.lastIndexOf('/');
        try { py.FS.mkdirTree(full.slice(0, k)); py.FS.writeFile(full, bin[p] ? b64bytes(files[p]) : String(files[p])); } catch (e) {}
      });
      py.globals.get('_ost_enter')(DIR);
      var src = Object.keys(files).filter(function (p) { return /\.py$/.test(p); }).map(function (p) { return String(files[p]); }).concat([String(d.code || '')]).join('\n');
      var names = toJs(py.globals.get('_ost_imports')(src));
      if (!names.length) return;
      await py.loadPackagesFromImports(src, { messageCallback: function (m) { if (/^Load(ing|ed) /.test(m)) status(m); }, errorCallback: function (m) { out('warn', m); } });
      var missing = toJs(py.globals.get('_ost_missing')(names));
      if (missing.length) {
        status('Installing ' + missing.join(', ') + ' from PyPI (micropip)…');
        await py.loadPackage('micropip');
        var mp = py.pyimport('micropip');
        for (var i = 0; i < missing.length; i++) {
          var name = C.alias[missing[i]] || missing[i];
          try { await mp.install(name); status('Installed ' + name); }
          catch (e) { out('warn', 'Could not install "' + name + '": ' + lastLine(String(e && e.message || e)) + ' — only pure-Python packages and Pyodide’s built-in packages work in the browser.'); }
        }
        try { mp.destroy(); } catch (e) {}
      }
      if (names.indexOf('requests') >= 0) { try { await py.loadPackage('pyodide-http'); py.runPython('import pyodide_http\npyodide_http.patch_all()'); } catch (e) {} }
      if (names.indexOf('matplotlib') >= 0 || names.indexOf('seaborn') >= 0 || names.indexOf('pandas') >= 0) {
        try { var ok = py.globals.get('_ost_mpl')(); mpl = mpl || !!ok; } catch (e) {}
      }
    }
    async function run(d) {
      cur = d.id; total = 0; win = 0; sent = 0; dropped = 0;
      var path = String(d.path || 'main.py');
      if (cancelled[d.id]) { post({ type: 'done', id: d.id, ok: false, error: 'cancelled' }); return; }
      try {
        if (!py && booting) status('Waiting for Python to finish loading…');
        await ensure();
        if (cancelled[d.id]) { post({ type: 'done', id: d.id, ok: false, error: 'cancelled' }); return; }
        await prepare(d);
        if (cancelled[d.id]) { post({ type: 'done', id: d.id, ok: false, error: 'cancelled' }); return; }
        post({ type: 'exec-start', id: d.id });
        var g = py.globals.get('dict')();
        g.set('__name__', '__main__'); g.set('__file__', '/project/' + path);
        if (lastG) { try { lastG.destroy(); } catch (e) {} }
        lastG = g;
        await py.runPythonAsync(String(d.code || ''), { globals: g, filename: '/project/' + path });
        if (mpl) { try { py.globals.get('_ost_mpl_flush')(); } catch (e) {} }
        flushStd(); flush();
        post({ type: 'done', id: d.id, ok: true });
      } catch (e) { fail(d, e, path); }
    }
    async function repl(d) {
      cur = d.id; total = 0;
      try {
        await ensure();
        if (!lastG) { lastG = py.globals.get('dict')(); lastG.set('__name__', '__main__'); }
        try { await py.loadPackagesFromImports(String(d.code || '')); } catch (e) {}
        post({ type: 'exec-start', id: d.id });
        await py.globals.get('_ost_repl')(String(d.code || ''), lastG);
        if (mpl) { try { py.globals.get('_ost_mpl_flush')(); } catch (e) {} }
        flushStd(); flush();
        post({ type: 'done', id: d.id, ok: true });
      } catch (e) { fail(d, e, '<console>'); }
    }
    // BaseExceptions (sys.exit, KeyboardInterrupt) escape Pyodide's asyncio loop as worker errors even
    // after run() handled them — swallow those so the warm interpreter is not torn down.
    self.addEventListener('error', function (e) { if (/\b(SystemExit|KeyboardInterrupt|GeneratorExit)\b/.test(String(e.message || ''))) e.preventDefault(); });
    var chain = Promise.resolve();
    self.onmessage = function (e) {
      var d = e.data || {};
      if (d.type === 'cancel') { cancelled[d.id] = 1; return; }
      if (d.type === 'run') chain = chain.catch(function () {}).then(function () { return run(d); });
      else if (d.type === 'repl') chain = chain.catch(function () {}).then(function () { return repl(d); });
    };
  }

  /* ---- runner host: the hidden sandboxed iframe that owns the workers ---- */
  function OST_RUNNER(C) {
    'use strict';
    var P = window.parent, jobs = Object.create(null), py = null, urls = {}, cancelled = Object.create(null);
    function post(m) { try { P.postMessage(m, '*'); } catch (e) {} }
    function blobUrl(k) { return urls[k] || (urls[k] = URL.createObjectURL(new Blob([C[k]], { type: 'text/javascript' }))); }   // one URL per worker kind, reused
    function end(id) { var j = jobs[id]; if (!j) return; delete jobs[id]; if (j.kind === 'js') { try { j.w.terminate(); } catch (e) {} } }
    function runJs(m) {
      var id = m.id, w;
      try { w = new Worker(blobUrl('js'), { name: 'ost-run' }); }
      catch (err) { post({ type: 'done', id: id, ok: false, error: 'Could not start a sandboxed worker: ' + (err && err.message || err) }); return; }
      jobs[id] = { kind: 'js', w: w };
      w.onmessage = function (ev) { var d = ev.data; if (!d || typeof d !== 'object' || !jobs[id]) return; var o = {}; for (var k in d) o[k] = d[k]; o.id = id; post(o); if (o.type === 'done') end(id); };
      w.onerror = function (ev) { ev.preventDefault(); if (!jobs[id]) return; var msg = ev.message || 'The worker crashed.'; post({ type: 'lines', id: id, lines: [{ level: 'error', text: msg }] }); post({ type: 'done', id: id, ok: false, error: msg }); end(id); };
      w.postMessage({ type: 'start', code: m.code, name: m.name, path: m.path, files: m.files, bin: m.bin, repl: !!m.repl });
    }
    function killPy(reason) {
      if (!py) return;
      try { py.w.terminate(); } catch (e) {}
      var ids = Object.keys(py.ids); py = null;
      ids.forEach(function (id) { delete jobs[id]; post({ type: 'done', id: id, ok: false, error: reason }); });
    }
    function ensurePy() {
      if (py) return py;
      var w = new Worker(blobUrl('py'), { name: 'ost-python' });
      var me = py = { w: w, ids: Object.create(null) };
      w.onmessage = function (ev) {
        var d = ev.data; if (!d || typeof d !== 'object' || py !== me) return;
        if (d.type === 'fatal') { killPy('Python crashed (out of memory or too deep recursion) and was restarted — run it again.'); return; }
        var id = String(d.id || ''); if (!me.ids[id]) return;
        if (d.type === 'exec-start' && cancelled[id]) { killPy('stopped'); return; }   // cancelled while it was starting
        var o = {}; for (var k in d) o[k] = d[k]; post(o);
        if (o.type === 'done') { delete me.ids[id]; delete jobs[id]; }
      };
      w.onerror = function (ev) { ev.preventDefault(); if (py === me) killPy('Python stopped unexpectedly: ' + (ev.message || 'worker error')); };
      return me;
    }
    function runPy(m, type) {
      var p;
      try { p = ensurePy(); } catch (err) { post({ type: 'done', id: m.id, ok: false, error: 'Could not start Python: ' + (err && err.message || err) }); return; }
      p.ids[m.id] = 1; jobs[m.id] = { kind: 'py' };
      p.w.postMessage({ type: type, id: m.id, code: m.code, path: m.path, files: m.files, bin: m.bin });
    }
    addEventListener('message', function (e) {
      if (e.source !== P) return;
      var m = e.data; if (!m || typeof m !== 'object') return;
      var id = String(m.id || '');
      if (m.type === 'run-js') runJs(m);
      else if (m.type === 'run-py') runPy(m, 'run');
      else if (m.type === 'repl-py') runPy(m, 'repl');
      else if (m.type === 'cancel') { if (py && py.ids[id]) { cancelled[id] = 1; py.w.postMessage({ type: 'cancel', id: id }); } }
      else if (m.type === 'stop') {
        if (id === '*') { Object.keys(jobs).forEach(function (k) { if (jobs[k] && jobs[k].kind === 'js') { end(k); post({ type: 'done', id: k, ok: false, error: 'stopped' }); } }); killPy('stopped'); return; }
        var j = jobs[id]; if (!j) return;
        if (j.kind === 'js') { end(id); post({ type: 'done', id: id, ok: false, error: 'stopped' }); } else killPy('stopped');
      }
    });
    post({ type: 'runner-ready' });
  }

  const PY_SETUP = [
    'import sys, os, builtins, shutil, importlib, warnings',
    'import js',
    'warnings.filterwarnings("ignore", module="micropip")',
    'def _ost_reset(d):',
    '    for name, m in list(sys.modules.items()):',
    '        f = getattr(m, "__file__", None) or ""',
    '        if isinstance(f, str) and f.startswith(d + "/"):',
    '            del sys.modules[name]',
    '    try:',
    '        os.chdir("/")',
    '    except Exception:',
    '        pass',
    '    shutil.rmtree(d, ignore_errors=True)',
    '    os.makedirs(d, exist_ok=True)',
    'def _ost_enter(d):',
    '    os.chdir(d)',
    '    if d not in sys.path:',
    '        sys.path.insert(0, d)',
    '    importlib.invalidate_caches()',
    'def _ost_imports(src):',
    '    try:',
    '        from pyodide.code import find_imports',
    '        return [n for n in find_imports(src) if n]',
    '    except Exception:',
    '        return []',
    'def _ost_missing(names):',
    '    import importlib.util',
    '    out = []',
    '    for n in names:',
    '        if n in sys.builtin_module_names or n in out:',
    '            continue',
    '        try:',
    '            if importlib.util.find_spec(n) is None:',
    '                out.append(n)',
    '        except Exception:',
    '            out.append(n)',
    '    return out',
    '_ost_noted = [False]',
    'def _ost_input(prompt=""):',
    '    if prompt:',
    '        print(prompt)',
    '    if not _ost_noted[0]:',
    '        _ost_noted[0] = True',
    '        js.ostNote("input() cannot read the keyboard in OST Studio — it returned an empty string. Put test values in your code or read them from a file.")',
    '    return ""',
    'builtins.input = _ost_input',
    'def _ost_mpl():',
    '    os.environ["MPLBACKEND"] = "Agg"',
    '    try:',
    '        import matplotlib',
    '    except Exception:',
    '        return False',
    '    matplotlib.use("Agg")',
    '    import matplotlib.pyplot as plt',
    '    def show(*a, **k):',
    '        _ost_mpl_flush()',
    '    plt.show = show',
    '    return True',
    'def _ost_mpl_flush():',
    '    import io, base64',
    '    import matplotlib.pyplot as plt',
    '    for num in plt.get_fignums():',
    '        fig = plt.figure(num)',
    '        buf = io.BytesIO()',
    '        fig.savefig(buf, format="png", dpi=100, bbox_inches="tight")',
    '        js.ostImage(base64.b64encode(buf.getvalue()).decode("ascii"))',
    '    plt.close("all")',
    'async def _ost_repl(src, g):',
    '    from pyodide.code import eval_code_async',
    '    r = await eval_code_async(src, g)',
    '    if r is not None:',
    '        print(repr(r))',
    ''
  ].join('\n');

  /* ---- Node built-ins available to runs (fs reads/writes the project snapshot) ---- */
  const NODE_SHIM = {
    path: [
      "function A(p) { if (typeof p !== 'string') throw new TypeError('The \"path\" argument must be of type string. Received ' + typeof p); }",
      "function norm(parts, up) { const r = []; for (const p of parts) { if (!p || p === '.') continue; if (p === '..') { if (r.length && r[r.length - 1] !== '..') r.pop(); else if (up) r.push('..'); } else r.push(p); } return r; }",
      "export const sep = '/', delimiter = ':';",
      "export function normalize(p) { A(p); if (!p) return '.'; const abs = p[0] === '/', trail = p[p.length - 1] === '/'; let r = norm(p.split('/'), !abs).join('/'); if (!r && !abs) r = '.'; if (r && trail) r += '/'; return (abs ? '/' : '') + r; }",
      "export function join(...a) { a.forEach(A); const j = a.filter(Boolean).join('/'); return j ? normalize(j) : '.'; }",
      "export function resolve(...a) { let r = '', abs = false; for (let i = a.length - 1; i >= -1 && !abs; i--) { const p = i >= 0 ? a[i] : '/'; A(p); if (!p) continue; r = p + '/' + r; abs = p[0] === '/'; } r = norm(r.split('/'), !abs).join('/'); return ((abs ? '/' : '') + r) || '.'; }",
      "export function isAbsolute(p) { A(p); return p[0] === '/'; }",
      "export function dirname(p) { A(p); if (!p) return '.'; let e = p.length; while (e > 1 && p[e - 1] === '/') e--; const i = p.lastIndexOf('/', e - 1); if (i < 0) return '.'; if (i === 0) return '/'; return p.slice(0, i); }",
      "export function basename(p, ext) { A(p); let e = p.length; while (e > 1 && p[e - 1] === '/') e--; let b = p.slice(0, e); b = b.slice(b.lastIndexOf('/') + 1); if (ext && b !== ext && b.endsWith(ext)) b = b.slice(0, -ext.length); return b; }",
      "export function extname(p) { A(p); const b = basename(p), i = b.lastIndexOf('.'); return i <= 0 ? '' : b.slice(i); }",
      "export function relative(f, t) { const a = resolve(f).split('/').filter(Boolean), b = resolve(t).split('/').filter(Boolean); let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++; return a.slice(i).map(() => '..').concat(b.slice(i)).join('/'); }",
      "export function parse(p) { A(p); const root = p[0] === '/' ? '/' : '', base = basename(p), ext = extname(p); let dir = dirname(p); if (dir === '.' && p.indexOf('/') < 0) dir = ''; return { root, dir, base, ext, name: ext ? base.slice(0, -ext.length) : base }; }",
      "export function format(o) { const dir = o.dir || o.root || '', base = o.base || ((o.name || '') + (o.ext || '')); return dir ? (dir === o.root ? dir + base : dir + '/' + base) : base; }",
      "export function toNamespacedPath(p) { return p; }",
      "const path = { sep, delimiter, normalize, join, resolve, isAbsolute, dirname, basename, extname, relative, parse, format, toNamespacedPath };",
      "path.posix = path; path.win32 = path;",
      "export const posix = path, win32 = path;",
      "export default path;"
    ].join('\n'),
    url: [
      "const U = globalThis.URL, Q = globalThis.URLSearchParams;",
      "export { U as URL, Q as URLSearchParams };",
      "export function fileURLToPath(u) { const x = typeof u === 'string' ? new U(u) : u; if (x.protocol !== 'file:') throw new TypeError('The URL must be of scheme file'); return decodeURIComponent(x.pathname); }",
      "export function pathToFileURL(p) { p = String(p); return new U('file://' + encodeURI(p[0] === '/' ? p : '/' + p)); }",
      "export function parse(s) { try { const x = new U(s); return { href: x.href, protocol: x.protocol, host: x.host, hostname: x.hostname, port: x.port, pathname: x.pathname, search: x.search, query: x.search.slice(1), hash: x.hash, path: x.pathname + x.search, auth: null, slashes: true }; } catch (e) { return { href: s, pathname: s, path: s, search: '', query: '', hash: '' }; } }",
      "export function format(o) { if (typeof o === 'string') return o; if (o instanceof U) return o.href; return (o.protocol ? o.protocol + '//' : '') + (o.host || o.hostname || '') + (o.pathname || '') + (o.search || '') + (o.hash || ''); }",
      "export function resolve(from, to) { try { return new U(to, from).href; } catch (e) { return to; } }",
      "export default { URL: U, URLSearchParams: Q, fileURLToPath, pathToFileURL, parse, format, resolve };"
    ].join('\n'),
    process: [
      "const p = globalThis.process || { env: { NODE_ENV: 'development' }, argv: ['node'], platform: 'browser', version: 'v20.0.0', versions: {}, cwd: () => '/', nextTick: (f, ...a) => queueMicrotask(() => f(...a)), on() { return p; }, exit() {} };",
      "export default p;",
      "export const env = p.env, argv = p.argv, platform = p.platform, version = p.version, versions = p.versions, stdout = p.stdout, stderr = p.stderr, stdin = p.stdin;",
      "export const cwd = (...a) => p.cwd(...a), nextTick = (...a) => p.nextTick(...a), exit = (...a) => p.exit(...a), on = (...a) => p.on(...a), hrtime = (...a) => p.hrtime(...a), memoryUsage = (...a) => p.memoryUsage(...a), uptime = (...a) => p.uptime(...a);"
    ].join('\n'),
    os: [
      "export const EOL = '\\n';",
      "export function platform() { return 'browser'; } export function type() { return 'Browser'; } export function arch() { return 'wasm'; } export function release() { return '1.0.0'; }",
      "export function hostname() { return 'ost-studio'; } export function homedir() { return '/'; } export function tmpdir() { return '/tmp'; } export function endianness() { return 'LE'; }",
      "export function cpus() { const n = (globalThis.navigator && navigator.hardwareConcurrency) || 1; return Array.from({ length: n }, () => ({ model: 'browser', speed: 0, times: {} })); }",
      "export function totalmem() { return ((globalThis.navigator && navigator.deviceMemory) || 4) * 1073741824; } export function freemem() { return totalmem() / 2; }",
      "export function uptime() { return Math.round(performance.now() / 1000); } export function loadavg() { return [0, 0, 0]; } export function networkInterfaces() { return {}; }",
      "export function userInfo() { return { username: 'ost', homedir: '/', shell: null, uid: -1, gid: -1 }; }",
      "export default { EOL, platform, type, arch, release, hostname, homedir, tmpdir, endianness, cpus, totalmem, freemem, uptime, loadavg, networkInterfaces, userInfo };"
    ].join('\n'),
    timers: [
      "const g = globalThis;",
      "export const setTimeout = (...a) => g.setTimeout(...a), clearTimeout = (i) => g.clearTimeout(i), setInterval = (...a) => g.setInterval(...a), clearInterval = (i) => g.clearInterval(i);",
      "export const setImmediate = (f, ...a) => g.setTimeout(f, 0, ...a), clearImmediate = (i) => g.clearTimeout(i);",
      "export default { setTimeout, clearTimeout, setInterval, clearInterval, setImmediate, clearImmediate };"
    ].join('\n'),
    'timers/promises': [
      "export function setTimeout(ms, v) { return new Promise((r) => globalThis.setTimeout(() => r(v), ms)); }",
      "export function setImmediate(v) { return setTimeout(0, v); }",
      "export async function* setInterval(ms, v) { while (true) { await setTimeout(ms); yield v; } }",
      "export const scheduler = { wait: (ms) => setTimeout(ms) };",
      "export default { setTimeout, setImmediate, setInterval, scheduler };"
    ].join('\n'),
    readline: [
      "let noted = false;",
      "function note() { if (!noted) { noted = true; console.info('readline: there is no keyboard input in the OST Studio sandbox — questions are answered with an empty string.'); } }",
      "export function createInterface() {",
      "  const ev = {}; let closed = false;",
      "  const fire = (n, ...a) => (ev[n] || []).forEach((f) => { try { f(...a); } catch (e) { console.error(e); } });",
      "  const rl = {",
      "    question(q, o, cb) { if (typeof o === 'function') cb = o; note(); if (q) process.stdout.write(String(q) + '\\n'); if (cb) setTimeout(() => cb(''), 0); return Promise.resolve(''); },",
      "    on(n, f) { (ev[n] = ev[n] || []).push(f); return rl; }, once(n, f) { return rl.on(n, f); }, off() { return rl; }, removeListener() { return rl; },",
      "    close() { if (!closed) { closed = true; fire('close'); } }, setPrompt() {}, prompt() { note(); }, write() {}, pause() { return rl; }, resume() { return rl; },",
      "    [Symbol.asyncIterator]() { return { next: async () => ({ done: true, value: undefined }) }; }",
      "  };",
      "  setTimeout(() => rl.close(), 0);",
      "  return rl;",
      "}",
      "export default { createInterface };"
    ].join('\n'),
    crypto: [
      "const c = globalThis.crypto;",
      "export const webcrypto = c, subtle = c && c.subtle;",
      "export function randomUUID() { return c.randomUUID(); }",
      "export function getRandomValues(a) { return c.getRandomValues(a); }",
      "export function randomBytes(n, cb) { const b = new Uint8Array(n); c.getRandomValues(b); b.toString = function (enc) { if (enc === 'hex') return Array.from(this, (x) => x.toString(16).padStart(2, '0')).join(''); if (enc === 'base64') { let s = ''; for (const x of this) s += String.fromCharCode(x); return btoa(s); } return new TextDecoder().decode(this); }; if (cb) { setTimeout(() => cb(null, b), 0); return; } return b; }",
      "export function randomInt(min, max) { if (max === undefined) { max = min; min = 0; } const r = new Uint32Array(1); c.getRandomValues(r); return min + (r[0] % (max - min)); }",
      "function no(n) { return function () { throw new Error('crypto.' + n + '() is not available in the browser sandbox — use Web Crypto, e.g. await crypto.subtle.digest(\"SHA-256\", data).'); }; }",
      "export const createHash = no('createHash'), createHmac = no('createHmac'), createCipheriv = no('createCipheriv'), createDecipheriv = no('createDecipheriv'), pbkdf2Sync = no('pbkdf2Sync'), scryptSync = no('scryptSync');",
      "export default { webcrypto, subtle, randomUUID, getRandomValues, randomBytes, randomInt, createHash, createHmac, createCipheriv, createDecipheriv, pbkdf2Sync, scryptSync };"
    ].join('\n'),
    perf_hooks: "export const performance = globalThis.performance; export default { performance };",
    console: "const c = globalThis.console; export default c; export const log = (...a) => c.log(...a), info = (...a) => c.info(...a), warn = (...a) => c.warn(...a), error = (...a) => c.error(...a), table = (...a) => c.table(...a);",
    fs: [
      "const S = globalThis.__ostFS || (globalThis.__ostFS = { files: {}, bin: {}, writes: {}, dirs: {} });",
      "const te = new TextEncoder(), td = new TextDecoder();",
      "class OstBuffer extends Uint8Array { toString(enc) { if (enc === 'base64') { let s = ''; for (let i = 0; i < this.length; i++) s += String.fromCharCode(this[i]); return btoa(s); } if (enc === 'hex') return Array.from(this, (b) => b.toString(16).padStart(2, '0')).join(''); return td.decode(this); } toJSON() { return { type: 'Buffer', data: Array.from(this) }; } }",
      "function key(p) { if (p && typeof p === 'object' && 'pathname' in p) p = decodeURIComponent(p.pathname); p = String(p).replace(/\\\\/g, '/'); const r = []; for (const s of p.split('/')) { if (!s || s === '.') continue; if (s === '..') r.pop(); else r.push(s); } return r.join('/'); }",
      "function err(code, op, p) { const m = { ENOENT: 'no such file or directory', EISDIR: 'illegal operation on a directory', ENOTDIR: 'not a directory' }; const e = new Error(code + ': ' + (m[code] || code) + ', ' + op + \" '\" + p + \"'\"); e.code = code; e.syscall = op; e.path = String(p); e.errno = code === 'ENOENT' ? -2 : -21; return e; }",
      "function isDir(k) { if (k === '') return true; const pre = k + '/'; for (const f in S.files) if (f.startsWith(pre)) return true; return !!S.dirs[k]; }",
      "function raw(k) { const v = S.files[k]; if (S.bin[k]) { const b = atob(v.slice(v.indexOf(',') + 1)); const u = new OstBuffer(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; } return OstBuffer.from(te.encode(v)); }",
      "function record(k, text, bin) { if (!(k in S.writes) && Object.keys(S.writes).length >= 50) { if (!S.capWarned) { S.capWarned = true; console.warn('fs: more than 50 files written — later writes stay in memory only.'); } return; } S.writes[k] = { content: text, binary: bin }; }",
      "export function readFileSync(p, o) { const k = key(p); if (!(k in S.files)) { if (isDir(k)) throw err('EISDIR', 'read', p); throw err('ENOENT', 'open', p); } const enc = typeof o === 'string' ? o : o && o.encoding; if (!enc) return raw(k); if (/^utf-?8$/i.test(enc)) return S.bin[k] ? td.decode(raw(k)) : S.files[k]; return raw(k).toString(enc); }",
      "export function writeFileSync(p, data, o) { const k = key(p); if (!k || isDir(k) && !(k in S.files)) throw err('EISDIR', 'open', p); let text, bin = false; if (typeof data === 'string') text = data; else if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) { const u = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength); try { text = new TextDecoder('utf-8', { fatal: true }).decode(u); } catch (e) { let s = ''; for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); text = 'data:application/octet-stream;base64,' + btoa(s); bin = true; } } else text = String(data); if (o && o.flag === 'a' && k in S.files && !S.bin[k] && !bin) text = S.files[k] + text; S.files[k] = text; S.bin[k] = bin; record(k, text, bin); }",
      "export function appendFileSync(p, d) { writeFileSync(p, d, { flag: 'a' }); }",
      "export function existsSync(p) { const k = key(p); return k in S.files || isDir(k); }",
      "export function readdirSync(p, o) { const k = key(p); if (k in S.files) throw err('ENOTDIR', 'scandir', p); if (!isDir(k)) throw err('ENOENT', 'scandir', p); const pre = k ? k + '/' : '', names = new Set(); for (const f in S.files) if (f.startsWith(pre)) names.add(f.slice(pre.length).split('/')[0]); for (const d in S.dirs) if (d.startsWith(pre) && d !== k) names.add(d.slice(pre.length).split('/')[0]); const list = Array.from(names).sort(); if (o && o.withFileTypes) return list.map((n) => { const d = !(pre + n in S.files); return { name: n, isFile: () => !d, isDirectory: () => d, isSymbolicLink: () => false }; }); return list; }",
      "export function statSync(p, o) { const k = key(p), f = k in S.files; if (!f && !isDir(k)) { if (o && o.throwIfNoEntry === false) return undefined; throw err('ENOENT', 'stat', p); } const t = new Date(), size = f ? raw(k).length : 0; return { size, isFile: () => f, isDirectory: () => !f, isSymbolicLink: () => false, mtime: t, ctime: t, atime: t, birthtime: t, mtimeMs: +t, mode: f ? 33188 : 16877 }; }",
      "export const lstatSync = statSync;",
      "export function mkdirSync(p) { S.dirs[key(p)] = 1; }",
      "export function unlinkSync(p) { const k = key(p); if (!(k in S.files)) throw err('ENOENT', 'unlink', p); delete S.files[k]; delete S.writes[k]; }",
      "export function rmSync(p, o) { const k = key(p); let hit = false; for (const f of Object.keys(S.files)) if (f === k || f.startsWith(k + '/')) { delete S.files[f]; delete S.writes[f]; hit = true; } if (!hit && !(o && o.force)) throw err('ENOENT', 'rm', p); }",
      "export const rmdirSync = rmSync;",
      "export function renameSync(a, b) { const d = readFileSync(a); writeFileSync(b, d); unlinkSync(a); }",
      "export function copyFileSync(a, b) { writeFileSync(b, readFileSync(a)); }",
      "export function accessSync(p) { if (!existsSync(p)) throw err('ENOENT', 'access', p); }",
      "function cbify(fn) { return function (...a) { const cb = typeof a[a.length - 1] === 'function' ? a.pop() : null; setTimeout(() => { let r, e = null; try { r = fn(...a); } catch (x) { e = x; } if (cb) cb(e, r); }, 0); }; }",
      "function pify(fn) { return (...a) => new Promise((res, rej) => { try { res(fn(...a)); } catch (e) { rej(e); } }); }",
      "export const readFile = cbify(readFileSync), writeFile = cbify(writeFileSync), appendFile = cbify(appendFileSync), readdir = cbify(readdirSync), stat = cbify(statSync), lstat = cbify(statSync), mkdir = cbify(mkdirSync), unlink = cbify(unlinkSync), rm = cbify(rmSync), rename = cbify(renameSync), copyFile = cbify(copyFileSync), access = cbify(accessSync);",
      "export function exists(p, cb) { setTimeout(() => cb(existsSync(p)), 0); }",
      "export const promises = { readFile: pify(readFileSync), writeFile: pify(writeFileSync), appendFile: pify(appendFileSync), readdir: pify(readdirSync), stat: pify(statSync), lstat: pify(statSync), mkdir: pify(mkdirSync), unlink: pify(unlinkSync), rm: pify(rmSync), rename: pify(renameSync), copyFile: pify(copyFileSync), access: pify(accessSync) };",
      "export const constants = { F_OK: 0, R_OK: 4, W_OK: 2, X_OK: 1 };",
      "export default { readFileSync, writeFileSync, appendFileSync, existsSync, readdirSync, statSync, lstatSync, mkdirSync, unlinkSync, rmSync, rmdirSync, renameSync, copyFileSync, accessSync, readFile, writeFile, appendFile, readdir, stat, lstat, mkdir, unlink, rm, rename, copyFile, access, exists, promises, constants };"
    ].join('\n'),
    'fs/promises': "import fs from 'fs'; const p = fs.promises; export const readFile = p.readFile, writeFile = p.writeFile, appendFile = p.appendFile, readdir = p.readdir, stat = p.stat, lstat = p.lstat, mkdir = p.mkdir, unlink = p.unlink, rm = p.rm, rename = p.rename, copyFile = p.copyFile, access = p.access; export default p;"
  };
  NODE_SHIM['path/posix'] = NODE_SHIM.path;
  NODE_SHIM['readline/promises'] = NODE_SHIM.readline;
  const RUN_ONLY_SHIMS = new Set(['fs', 'fs/promises']);

  /* ======================================================================
   * source maps (map sandbox stack traces back to project files)
   * ==================================================================== */
  const SRCMAPS = new Map(); let mapSeq = 0;
  function regMap(map, identityPath, kind) {
    const name = 'ost' + (kind || (identityPath ? 'file' : 'bundle')) + '-' + (++mapSeq) + '.js';
    SRCMAPS.set(name, map ? { map, lines: null } : { path: identityPath });
    while (SRCMAPS.size > 300) SRCMAPS.delete(SRCMAPS.keys().next().value);
    return name;
  }
  const B64C = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  function decodeMappings(str) {
    const lines = []; let si = 0, sl = 0, sc = 0;
    for (const ln of String(str).split(';')) {
      const segs = []; let gc = 0;
      if (ln) for (const seg of ln.split(',')) {
        const v = []; let shift = 0, val = 0;
        for (let i = 0; i < seg.length; i++) {
          let d = B64C.indexOf(seg[i]); if (d < 0) break;
          const cont = d & 32; d &= 31; val += d * Math.pow(2, shift);
          if (cont) shift += 5; else { v.push(val & 1 ? -Math.floor(val / 2) : Math.floor(val / 2)); val = 0; shift = 0; }
        }
        if (!v.length) continue;
        gc += v[0];
        if (v.length >= 4) { si += v[1]; sl += v[2]; sc += v[3]; segs.push([gc, si, sl, sc]); }
      }
      lines.push(segs);
    }
    return lines;
  }
  function cleanSource(s) {
    s = String(s || '');
    if (/^https?:/i.test(s)) return '';
    s = s.replace(/^(?:\.\.\/)+/, '').replace(/^(?:vfs|ost-[a-z]+):/, '').replace(/^\/+/, '');
    return s;
  }
  function mapLoc(name, line, col) {
    const e = SRCMAPS.get(name); if (!e) return null;
    if (e.path) return { path: e.path, line, col };
    if (!e.lines) { try { e.lines = decodeMappings(e.map.mappings || ''); } catch (_) { e.lines = []; } }
    const segs = e.lines[line - 1]; if (!segs || !segs.length) return null;
    let best = segs[0];
    for (const s of segs) { if (s[0] <= col - 1) best = s; else break; }
    const src = cleanSource((e.map.sources || [])[best[1]]);
    if (!src || !S.fs.exists(src)) return null;
    return { path: src, line: best[2] + 1, col: best[3] + 1 };
  }
  function mapText(text, hint) {
    let loc = null;
    const out = String(text).replace(/\b(ost(?:bundle|file|run)-\d+\.js):(\d+)(?::(\d+))?/g, (m, name, ln, cl) => {
      const r = mapLoc(name, +ln, +(cl || 1)); if (!r) return m;
      if (!loc) loc = r;
      return r.path + ':' + r.line + ':' + r.col;
    });
    if (!loc && hint && typeof hint.file === 'string' && /^ost(bundle|file|run)-\d+\.js$/.test(hint.file) && hint.line) loc = mapLoc(hint.file, +hint.line, +hint.col || 1);
    let t = collapseFrames(out);
    if (loc && hint && hint.file && out.indexOf(loc.path + ':') < 0) t += '  (' + loc.path + ':' + loc.line + ':' + loc.col + ')';
    return { text: t, loc };
  }
  // Keep the user's own frames; fold runs of library frames (esm.sh, CDN code) into one line.
  function collapseFrames(text) {
    const ls = String(text).split('\n');
    if (ls.length < 4) return text;
    const res = []; let run = [];
    const lib = (l) => /^\s+at\s/.test(l) && /\(?(https?:\/\/|blob:|<anonymous>|node:)/.test(l) && !/\bost(bundle|file|run)-\d+\.js/.test(l);
    const host = (l) => { const m = /https?:\/\/([^/]+)\/(@?[^/@]+)/.exec(l); return m ? m[1] + '/' + m[2] : 'library code'; };
    const flush = () => { if (!run.length) return; if (run.length <= 2) res.push(...run); else res.push('    … ' + run.length + ' frames in ' + [...new Set(run.map(host))].slice(0, 2).join(', ')); run = []; };
    for (const l of ls) { if (lib(l)) run.push(l); else { flush(); res.push(l); } }
    flush();
    return res.join('\n');
  }

  /* ======================================================================
   * esbuild (lazy) + the project virtual-FS plugin
   * ==================================================================== */
  let esbP = null, esbReady = false;
  // fetch() checks the integrity hash; the verified text is imported from a fresh blob: URL, so a failed
  // attempt never poisons the module map (a retry really retries).
  async function importEsbuild() {
    const res = await fetch(ESBUILD_JS, { integrity: ESBUILD_JS_SRI, mode: 'cors', credentials: 'omit' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const url = URL.createObjectURL(new Blob([await res.text()], { type: 'text/javascript' }));
    try { return await import(url); } finally { URL.revokeObjectURL(url); }
  }
  async function esbuildWasm() {
    const res = await fetch(ESBUILD_WASM, { integrity: ESBUILD_WASM_SRI, mode: 'cors', credentials: 'omit' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return WebAssembly.compile(await res.arrayBuffer());
  }
  function loadEsbuild() {
    if (esbP) return esbP;
    const t0 = now();
    line('system', 'Loading the bundler (esbuild-wasm, about 3 MB) — first use only, then your browser caches it…', 'build');
    esbP = (async () => {
      const [mod, wasmModule] = await Promise.all([importEsbuild(), esbuildWasm()]);
      const esb = mod && typeof mod.build === 'function' ? mod : mod.default;
      await esb.initialize({ wasmModule, worker: true });
      esbReady = true;
      line('system', 'Bundler ready (' + fmtMs(now() - t0) + ').', 'build');
      return esb;
    })();
    esbP.catch((e) => { esbP = null; line('error', 'Could not load the bundler from cdn.jsdelivr.net (' + (e && e.message || e) + '). Check your connection and try again.', 'build'); });
    return esbP;
  }
  function mkCtx(mode, extra) {
    const pkg = readJson('package.json') || {};
    const deps = Object.assign({}, pkg.devDependencies || {}, pkg.peerDependencies || {}, pkg.dependencies || {});
    const files = S.fs.list();
    const hasJsx = files.some((f) => /\.(jsx|tsx)$/.test(f.path));
    const preact = !!deps.preact && !deps.react;
    const ts = readJsonc('tsconfig.json') || readJsonc('jsconfig.json');
    const co = (ts && ts.compilerOptions) || {};
    return Object.assign({
      mode, deps,
      useReact: !preact && (!!deps.react || !!deps['react-dom'] || hasJsx),
      reactVer: cleanVer(deps.react) || REACT_DEFAULT,
      reactDomVer: cleanVer(deps['react-dom']) || cleanVer(deps.react) || REACT_DEFAULT,
      preactVer: preact ? cleanVer(deps.preact) : '',
      jsxSource: co.jsxImportSource || (preact ? 'preact' : 'react'),
      jsxInJs: U.projectKind() === 'react',
      tsconfig: ts ? { compilerOptions: co } : null,
      paths: co.paths && typeof co.paths === 'object' ? { base: U.normPath(co.baseUrl || '.'), map: co.paths } : null,
      importMap: null, requires: new Set(), bundled: new Set(), assets: new Set(), warnings: [], virtual: null, prelude: ''
    }, extra || {});
  }
  function parseSpec(spec) { const m = /^(@[^/@]+\/[^/@]+|[^/@][^/@]*)(?:@([^/]+))?(\/.*)?$/.exec(spec); return m ? { name: m[1], ver: m[2] || '', sub: m[3] || '' } : null; }
  function verFor(name, ctx) { if (name === 'react') return ctx.reactVer; if (name === 'react-dom') return ctx.reactDomVer; if (name === 'preact' && ctx.preactVer) return ctx.preactVer; return cleanVer(ctx.deps[name]); }
  function esmUrl(spec, ctx) {
    const s = parseSpec(spec); if (!s) return ESM_SH + spec;
    const ver = s.ver || verFor(s.name, ctx);
    const deps = [];
    if (ctx.useReact && s.name !== 'react') { deps.push('react@' + ctx.reactVer); if (s.name !== 'react-dom') deps.push('react-dom@' + ctx.reactDomVer); }
    if (ctx.preactVer && s.name !== 'preact') deps.push('preact@' + ctx.preactVer);
    return ESM_SH + s.name + (ver ? '@' + ver : '') + s.sub + (deps.length ? '?deps=' + deps.join(',') : '');
  }
  function npmFileUrl(spec, ctx) { const s = parseSpec(spec.replace(/^~/, '')); if (!s) return JSDELIVR_NPM + spec; const ver = s.ver || verFor(s.name, ctx); return JSDELIVR_NPM + s.name + (ver ? '@' + ver : '') + s.sub; }
  function resolveLocal(dir, spec) {
    const base = spec.charAt(0) === '/' ? U.normPath(spec) : U.normPath((dir ? dir + '/' : '') + spec);
    const cands = [];
    if (base) cands.push(base);
    const m = /^(.*)\.(m?js|cjs|jsx)$/.exec(base); if (m) cands.push(m[1] + '.ts', m[1] + '.tsx', m[1] + '.mts');
    for (const e of RESOLVE_EXT) if (base) cands.push(base + e);
    for (const e of RESOLVE_EXT) cands.push((base ? base + '/' : '') + 'index' + e);
    for (const c of cands) if (c && S.fs.exists(c)) return c;
    return null;
  }
  function aliasOf(spec, ctx) {
    if (ctx.paths) {
      for (const k of Object.keys(ctx.paths.map)) {
        const targets = [].concat(ctx.paths.map[k] || []);
        const star = k.indexOf('*');
        let mid = null;
        if (star < 0) { if (spec === k) mid = ''; }
        else { const pre = k.slice(0, star), post = k.slice(star + 1); if (spec.startsWith(pre) && spec.endsWith(post) && spec.length >= pre.length + post.length) mid = spec.slice(pre.length, spec.length - post.length); }
        if (mid == null) continue;
        for (const t of targets) { const r = resolveLocal(ctx.paths.base, String(t).replace('*', mid)); if (r) return r; }
      }
    }
    if (/^[@~]\//.test(spec)) return resolveLocal('', (S.fs.folders().includes('src') ? 'src/' : '') + spec.slice(2)) || resolveLocal('', spec.slice(2));
    return null;
  }
  function inImportMap(spec, map) {
    if (!map) return false;
    for (const k of Object.keys(map)) if (k === spec || (k.endsWith('/') && spec.startsWith(k))) return true;
    return false;
  }
  function nodeMsg(name, mode) {
    if (name === 'fs' || name === 'fs/promises') return '"' + name + '" works when you Run a script (▶ Run). Web pages cannot read files directly — load project files with fetch("./data.json").';
    if (/^(https?|http2|net|tls|dgram|dns)$/.test(name)) return '"' + name + '" (Node.js) is not available: code runs in a browser sandbox with no server sockets. Use fetch() for HTTP requests. OST deploys static web apps only.';
    return '"' + name + '" is a Node.js built-in that does not exist in the browser sandbox' + (mode === 'run' ? '' : ' or in web pages') + '.';
  }
  function asLocal(path, a, query, ctx) {
    const ext = U.extOf(path);
    if (/(^|[?&])raw\b/.test(query.replace(/^\?/, ''))) return { path, namespace: 'ost-raw' };
    const isUrlTok = a.kind === 'url-token';
    if (/(^|[?&])url\b/.test(query.replace(/^\?/, '')) || isUrlTok || (ASSET_EXT.has(ext) && a.kind !== 'import-rule') || S.fs.isBinary(path)) {
      if (isUrlTok && ctx.mode === 'deploy') { ctx.assets.add(path); return { path: '../' + encodePath(path), external: true }; }
      if (isUrlTok && ctx.mode === 'preview' && sizeOf(path) > INLINE_MAX) {
        ctx.warnings.push({ path, line: 0, col: 0, text: path + ' is larger than 1 MB, so the preview does not inline it into CSS (it works after deploy).', severity: 'warning', source: 'build' });
        return { path: FAKE + '/' + encodePath(path), external: true };
      }
      return { path, namespace: 'ost-asset' };
    }
    return { path, namespace: 'vfs' };
  }
  function resolveBare(spec, a, ctx) {
    spec = spec.replace(/^npm:/, '');
    const node = spec.replace(/^node:/, '');
    const top = node.split('/')[0];
    if (spec.startsWith('node:') || NODE_BUILTIN.has(top)) {
      if (NODE_SHIM[node] && (!RUN_ONLY_SHIMS.has(node) || ctx.mode === 'run')) return { path: node, namespace: 'ost-node' };
      if (NODE_POLY[node]) return { path: esmUrl(NODE_POLY[node], ctx), external: true };
      return { errors: [{ text: nodeMsg(node, ctx.mode) }] };
    }
    if (inImportMap(spec, ctx.importMap)) return { path: spec, external: true };
    if (/\.css$/i.test(spec)) {
      const url = npmFileUrl(spec, ctx);
      return a.kind === 'import-rule' || a.kind === 'url-token' ? { path: url, external: true } : { path: url, namespace: 'ost-ext-css' };
    }
    if (a.kind === 'require-call' || a.kind === 'require-resolve') { ctx.requires.add(spec); return { path: spec, namespace: 'ost-req' }; }
    return { path: esmUrl(spec, ctx), external: true };
  }
  function importerDir(a, ctx) {
    if (a.namespace === 'vfs' || a.namespace === 'ost-raw' || a.namespace === 'ost-asset') return U.dirOf(a.importer);
    if (a.namespace === 'ost-virtual') return ctx.virtual ? ctx.virtual.dir || '' : '';
    if (a.resolveDir) return String(a.resolveDir).replace(/^\/+/, '');
    return '';
  }
  function vfsPlugin(ctx) {
    return {
      name: 'ost-studio-vfs',
      setup(b) {
        b.onResolve({ filter: /.*/ }, (a) => {
          const spec = a.path;
          if (a.kind === 'entry-point') return spec.startsWith('ost-virtual:') ? { path: spec.slice(12), namespace: 'ost-virtual' } : { path: spec, namespace: 'vfs' };
          if (a.namespace === 'ost-prelude-ns') { if (spec === 'ost:prelude') return { path: 'prelude', namespace: 'ost-prelude' }; if (spec === 'ost:main') return ctx.virtual ? { path: ctx.virtual.name, namespace: 'ost-virtual' } : { path: ctx.entry, namespace: 'vfs' }; }
          if (/^(?:https?:)?\/\//i.test(spec)) return { path: spec.startsWith('//') ? 'https:' + spec : spec, external: true };
          if (/^(data|blob):/i.test(spec) || spec.charAt(0) === '#') return { path: spec, external: true };
          const css = a.kind === 'url-token' || a.kind === 'import-rule';
          const dir = importerDir(a, ctx);
          const [bare, query] = splitQuery(spec);
          const rel = /^\.{1,2}(\/|$)/.test(bare) || bare.charAt(0) === '/';
          if (rel || css) {
            const target = resolveLocal(dir, bare.replace(/^~(?=\.|\/)/, ''));
            if (target) return asLocal(target, a, query, ctx);
            if (a.kind === 'import-rule' && !rel) return resolveBare(bare.replace(/^~/, ''), a, ctx);   // @import "pkg/x.css"
            if (a.kind === 'url-token' && /^~[^./]/.test(bare)) return { path: npmFileUrl(bare, ctx), external: true };   // webpack-style ~pkg/asset
            if (a.kind === 'url-token') { ctx.warnings.push({ path: a.importer && a.namespace === 'vfs' ? a.importer : '', line: 0, col: 0, text: 'url(' + spec + ') — file not found in the project', severity: 'warning', source: 'build' }); return { path: spec, external: true }; }
            return { errors: [{ text: 'Cannot find "' + spec + '" — no file ' + (U.normPath((bare.charAt(0) === '/' ? '' : (dir ? dir + '/' : '')) + bare) || bare) + ' (also tried .ts .tsx .js .jsx .mjs .json .css and /index.*)' }] };
          }
          const ali = aliasOf(bare, ctx);
          if (ali) return asLocal(ali, a, query, ctx);
          return resolveBare(bare, a, ctx);
        });
        b.onLoad({ filter: /.*/, namespace: 'vfs' }, (a) => {
          const p = a.path, c = S.fs.read(p);
          if (c == null) return { errors: [{ text: 'File not found: ' + p }] };
          if (S.fs.isBinary(p)) return loadAsset(p, ctx);
          const ext = U.extOf(p);
          if (/^(scss|sass|less|styl|stylus)$/.test(ext)) return { errors: [{ text: p + ': .' + ext + ' stylesheets are not supported (there is no Sass/Less compiler in OST Studio) — use plain .css (CSS variables and nesting work in modern browsers).' }] };
          let loader = /\.module\.css$/i.test(p) ? 'local-css' : (LOADER[ext] || 'text');   // CSS Modules: import s from './x.module.css' → s.className
          if (loader === 'js' && ctx.jsxInJs && /<\/?[A-Za-z>]/.test(c)) loader = 'jsx';
          ctx.bundled.add(p);
          return { contents: /^(js|jsx|ts|tsx)$/.test(loader) ? metaUrlRefs(c, U.dirOf(p), ctx) : c, loader, resolveDir: '/' + U.dirOf(p) };
        });
        b.onLoad({ filter: /.*/, namespace: 'ost-asset' }, (a) => loadAsset(a.path, ctx));
        b.onLoad({ filter: /.*/, namespace: 'ost-raw' }, (a) => ({ contents: S.fs.read(a.path) || '', loader: 'text' }));
        b.onLoad({ filter: /.*/, namespace: 'ost-virtual' }, () => ({ contents: metaUrlRefs(ctx.virtual.contents, ctx.virtual.dir || '', ctx), loader: ctx.virtual.loader || 'js', resolveDir: '/' + (ctx.virtual.dir || '') }));
        b.onLoad({ filter: /.*/, namespace: 'ost-node' }, (a) => ({ contents: NODE_SHIM[a.path] || 'export default {};', loader: 'js', resolveDir: '/' }));
        b.onLoad({ filter: /.*/, namespace: 'ost-req' }, (a) => ({ contents: 'var R = globalThis.__ostReq || {};\nif (!(' + JSON.stringify(a.path) + ' in R)) throw new Error(' + JSON.stringify('require("' + a.path + '") could not be loaded from esm.sh') + ');\nmodule.exports = R[' + JSON.stringify(a.path) + '];', loader: 'js' }));
        b.onLoad({ filter: /.*/, namespace: 'ost-ext-css' }, (a) => ({ contents: '@import url(' + JSON.stringify(a.path) + ');', loader: 'css' }));
        b.onLoad({ filter: /.*/, namespace: 'ost-prelude' }, () => ({ contents: ctx.prelude, loader: 'js' }));
        b.onLoad({ filter: /.*/, namespace: 'ost-prelude-ns' }, () => ({ contents: 'import "ost:prelude";\nimport "ost:main";\n', loader: 'js' }));
      }
    };
  }
  // new URL('./worker.js', import.meta.url) — the Vite/webpack-5 pattern for workers and assets. esbuild leaves
  // it alone, but import.meta.url is about:srcdoc in the preview and /<slug>/assets/… after deploy, so point
  // it at the project file explicitly (the preview bridge serves FAKE URLs; deploy ships the file).
  function metaUrlRefs(code, dir, ctx) {
    if (ctx.mode === 'run' || code.indexOf('import.meta.url') < 0) return code;
    return code.replace(/new\s+URL\(\s*(['"])(\.{1,2}\/[^'"\n]*)\1\s*,\s*import\.meta\.url\s*\)/g, (m, q, spec) => {
      const [bare, query] = splitQuery(spec);
      const target = resolveRef(dir, bare);
      if (!target || !S.fs.exists(target)) return m;
      if (ctx.mode === 'deploy') { ctx.assets.add(target); return 'new URL(' + JSON.stringify('../' + encodePath(target) + query) + ', import.meta.url)'; }
      return 'new URL(' + JSON.stringify(FAKE + '/' + encodePath(target) + query) + ')';
    });
  }
  function loadAsset(p, ctx) {
    const c = S.fs.read(p); if (c == null) return { errors: [{ text: 'File not found: ' + p }] };
    if (ctx.mode === 'deploy') { ctx.assets.add(p); return { contents: 'export default new URL(' + JSON.stringify('../' + encodePath(p)) + ', import.meta.url).href;', loader: 'js' }; }
    if (ctx.mode === 'preview' && sizeOf(p) > INLINE_MAX) return { contents: 'export default ' + JSON.stringify(FAKE + '/' + encodePath(p)) + ';', loader: 'js' };
    return { contents: S.fs.isBinary(p) ? U.b64ToBytes(c.slice(c.indexOf(',') + 1)) : c, loader: 'dataurl' };
  }
  function esbMessages(list, severity) {
    return (list || []).map((m) => {
      const loc = m.location || {};
      let text = m.text || 'Build error';
      const note = m.notes && m.notes[0] && m.notes[0].text;
      if (note && note.length < 200 && !/^The (file|original)/.test(note)) text += ' — ' + note;
      return { path: cleanSource(loc.file || ''), line: loc.line || 0, col: (loc.column || 0) + 1, text, severity, source: 'esbuild' };
    });
  }
  function defines(mode) {
    const prod = mode === 'deploy';
    return { 'process.env.NODE_ENV': prod ? '"production"' : '"development"', 'import.meta.env': JSON.stringify({ MODE: prod ? 'production' : 'development', DEV: !prod, PROD: prod, SSR: false, BASE_URL: './' }) };
  }
  // o: { entry?: path, virtual?: {contents, dir, name, loader}, mode, format, importMap? }
  async function bundle(o) {
    const esb = await loadEsbuild();
    const ctx = mkCtx(o.mode, { importMap: o.importMap || null, virtual: o.virtual || null, entry: o.entry || '' });
    const opts = {
      entryPoints: [o.virtual ? 'ost-virtual:' + o.virtual.name : o.entry],
      bundle: true, write: false, outdir: '/ost-out', entryNames: 'app', format: o.format || 'esm', platform: 'browser',
      target: o.mode === 'deploy' ? 'es2022' : 'esnext',
      minify: o.mode === 'deploy', sourcemap: o.mode === 'deploy' ? false : 'external', sourcesContent: false,
      jsx: 'automatic', jsxImportSource: ctx.jsxSource, define: defines(o.mode), logLevel: 'silent', charset: 'utf8',
      legalComments: o.mode === 'deploy' ? 'none' : 'inline', metafile: true, plugins: [vfsPlugin(ctx)]
    };
    if (ctx.tsconfig) opts.tsconfigRaw = ctx.tsconfig;
    let res;
    try { res = await esb.build(opts); }
    catch (e) {
      if (!e || !Array.isArray(e.errors)) return { ok: false, errors: [{ path: o.entry || '', line: 0, col: 0, text: String(e && e.message || e), severity: 'error', source: 'esbuild' }], warnings: [] };
      return { ok: false, errors: esbMessages(e.errors, 'error'), warnings: esbMessages(e.warnings, 'warning').concat(ctx.warnings) };
    }
    // what the entry file itself contains (ESM syntax? CommonJS? which imports?) — decides how a classic <script> runs
    const entryKey = o.virtual ? 'ost-virtual:' + o.virtual.name : 'vfs:' + o.entry;
    const entryInfo = (res.metafile && res.metafile.inputs && res.metafile.inputs[entryKey]) || null;
    const jsOut = () => (res.outputFiles || []).find((f) => /\.js$/.test(f.path));
    const needBuffer = o.mode === 'run' && jsOut() && /\bBuffer\s*\.\s*(from|alloc|isBuffer|concat|byteLength)\b/.test(jsOut().text);
    if (ctx.requires.size || needBuffer) {
      // second pass: a prelude imports required packages from esm.sh before the program runs
      const reqs = [...ctx.requires];
      ctx.prelude = (needBuffer ? 'import { Buffer as __B } from ' + JSON.stringify(esmUrl(NODE_POLY.buffer, ctx)) + ';\nglobalThis.Buffer = globalThis.Buffer || __B;\n' : '') +
        reqs.map((r, i) => 'import * as __r' + i + ' from ' + JSON.stringify(esmUrl(r, ctx)) + ';').join('\n') + '\nconst __R = globalThis.__ostReq || (globalThis.__ostReq = {});\n' +
        reqs.map((r, i) => '__R[' + JSON.stringify(r) + '] = (__r' + i + '.default !== undefined ? __r' + i + '.default : __r' + i + ');').join('\n') + '\n';
      ctx.bundled = new Set(); ctx.assets = new Set(); ctx.warnings = [];
      try { res = await esb.build(Object.assign({}, opts, { entryPoints: ['ost-prelude-entry'], plugins: [preludeEntry(ctx), vfsPlugin(ctx)] })); }
      catch (e) { return { ok: false, errors: esbMessages(e.errors, 'error'), warnings: esbMessages(e.warnings, 'warning') }; }
    }
    const outs = res.outputFiles || [];
    const js = outs.find((f) => /\.js$/.test(f.path)), css = outs.find((f) => /\.css$/.test(f.path)), map = outs.find((f) => /\.js\.map$/.test(f.path));
    const strip = (t) => String(t || '').replace(/\n?\/[/*]# sourceMappingURL=[^\n]*\s*$/, '\n');
    let mapObj = null; if (map) { try { mapObj = JSON.parse(map.text); } catch (_) {} }
    // static imports of external URLs (esm.sh packages, the require() prelude) — only an ES module can load them
    const externalImports = Object.entries((res.metafile && res.metafile.outputs) || {}).some(([k, out]) => /\.js$/.test(k) && (out.imports || []).some((i) => i.external && (i.kind === 'import-statement' || i.kind === 'require-call') && !/^<define:/.test(i.path)));
    return { ok: true, code: js ? strip(js.text) : '', css: css ? strip(css.text) : '', map: mapObj, errors: [], warnings: esbMessages(res.warnings, 'warning').concat(ctx.warnings), inputs: ctx.bundled, assets: ctx.assets, entryInfo, externalImports };
  }
  function preludeEntry() {
    return { name: 'ost-prelude-entry', setup(b) { b.onResolve({ filter: /^ost-prelude-entry$/ }, () => ({ path: 'entry', namespace: 'ost-prelude-ns' })); } };
  }
  const RE_NEEDS_BUNDLE = /(^|[\s;})])import\s*[\w{*'"(]|(^|[\s;})])export\s+[\w{*]|\bimport\.meta\b|\brequire\s*\(/m;
  const needsBundler = (path, text) => /^(ts|tsx|jsx|mts|cts)$/.test(U.extOf(path)) || RE_NEEDS_BUNDLE.test(String(text || ''));
  // A classic <script> whose entry really is a plain script: the regex hit was a comment/string, or it is a
  // UMD/CommonJS-guarded file. Those run exactly as written — bundling would hide their globals.
  function isPlainScript(info, text) {
    if (!info || info.format === 'esm') return false;
    if (info.format === 'cjs') return /\btypeof\s+(module|exports|define)\b/.test(text);
    return (info.imports || []).every((i) => /^<define:/.test(i.path) || (i.kind === 'dynamic-import' && i.external && text.indexOf(i.path) >= 0));   // <define:…> = our import.meta.env define
  }
  // One decision for classic <script src> in BOTH the preview and the deploy build:
  //   { ok, raw:true }  → ship/inline the file as written
  //   bundle result     → iife; or { module:true } esm when it needs import statements / import.meta / top-level await
  async function bundleClassic(p, mode, importMap) {
    const text = S.fs.read(p) || '';
    const transpile = /^(ts|tsx|jsx|mts|cts)$/i.test(U.extOf(p));
    if (!transpile && !RE_NEEDS_BUNDLE.test(text)) return { ok: true, raw: true };
    const r = await bundle({ entry: p, mode, format: 'iife', importMap });
    if (r.ok && !transpile && isPlainScript(r.entryInfo, text)) return { ok: true, raw: true };
    const esm = r.ok ? r.externalImports || r.warnings.some((w) => /import\.meta/.test(w.text)) : r.errors.some((e) => /top-level await/i.test(e.text));
    if (!esm) return r;
    const r2 = await bundle({ entry: p, mode, format: 'esm', importMap });
    if (r2.ok) r2.module = true;
    return r2;
  }

  /* ======================================================================
   * HTML pages → one srcdoc (preview) / real files (deploy)
   * ==================================================================== */
  function doctypeOf(doc) {
    const d = doc.doctype; if (!d) return '';
    return '<!DOCTYPE ' + d.name + (d.publicId ? ' PUBLIC "' + d.publicId + '"' : '') + (d.systemId ? (d.publicId ? '' : ' SYSTEM') + ' "' + d.systemId + '"' : '') + '>\n';
  }
  const serialize = (doc) => doctypeOf(doc) + doc.documentElement.outerHTML;
  function readImportMap(doc) {
    let map = null;
    for (const s of doc.querySelectorAll('script[type="importmap"]')) { try { const j = JSON.parse(s.textContent || '{}'); if (j && j.imports) map = Object.assign(map || {}, j.imports); } catch (_) {} }
    return map;
  }
  function inlineData(p, warnings, from, seen) {
    if (sizeOf(p) > INLINE_MAX) {
      if (!seen || !seen.has(p)) { if (seen) seen.add(p); warnings.push({ path: from, line: 0, col: 0, text: p + ' is larger than 1 MB and is not inlined into the preview HTML (the app can still fetch() it; it works normally after deploy).', severity: 'warning', source: 'build' }); }
      return null;
    }
    return dataUrlOf(p);
  }
  function cssUrls(css, dir, warnings, from, seen) {
    return String(css).replace(/url\(\s*(['"]?)([^'")]+?)\1\s*\)/gi, (m, q, ref) => {
      if (!isLocalRef(ref)) return m;
      const p = resolveRef(dir, ref);
      if (!p || !S.fs.exists(p)) { warnings.push({ path: from, line: lineOf(S.fs.read(from) || '', ref), col: 1, text: 'url(' + ref + ') — file not found in the project', severity: 'warning', source: 'css' }); return m; }
      const d = inlineData(p, warnings, from, seen);
      return d ? 'url("' + d + '")' : m;
    });
  }
  function processCss(p, warnings, inc, depth, seen, ctxForPkg, external) {
    inc.add(p);
    const src = S.fs.read(p) || '';
    const dir = U.dirOf(p);
    external = external || [];                      // shared by the whole @import tree; hoisted at depth 0 (@import must come first)
    let css = src.replace(/@import\s+(?:url\(\s*)?(?:"([^"]*)"|'([^']*)'|([^"')\s;]+))\s*\)?\s*([^;]*);/gi, (m, d1, d2, d3, media) => {
      const ref = d1 != null ? d1 : d2 != null ? d2 : d3;
      if (!isLocalRef(ref)) { external.push(m); return ''; }
      const t = resolveRef(dir, ref);
      if (!t || !S.fs.exists(t)) {
        if (!/^\.{0,2}\//.test(ref)) { external.push('@import url(' + JSON.stringify(npmFileUrl(ref, ctxForPkg)) + ')' + (media.trim() ? ' ' + media.trim() : '') + ';'); return ''; }
        warnings.push({ path: p, line: lineOf(src, ref), col: 1, text: '@import "' + ref + '" — file not found', severity: 'warning', source: 'css' });
        return '';
      }
      if (inc.has(t) || depth > 8) return '';
      const inner = processCss(t, warnings, inc, depth + 1, seen, ctxForPkg, external);
      media = media.trim();
      return media && !/^(layer|supports)\b/i.test(media) ? '@media ' + media + ' {\n' + inner + '\n}' : inner;
    });
    css = cssUrls(css.replace(/@charset\s+[^;]+;/gi, ''), dir, warnings, p, seen);
    return depth ? css : external.join('\n') + (external.length ? '\n' : '') + css;
  }
  function previewFiles(skip) {
    const F = {}; let total = 0;
    const list = S.fs.list().filter((f) => !skip.has(f.path)).sort((a, b) => a.size - b.size);
    for (const f of list) {
      if (total + f.size > FILES_BUDGET) break;
      const c = S.fs.read(f.path); if (c == null) continue;
      let t = U.mimeOf(f.path);
      if (f.binary) F[f.path] = { t, d: c };
      else { if (/^text\/|json|javascript|xml|svg|csv|yaml/.test(t) && !/charset/.test(t)) t += ';charset=utf-8'; F[f.path] = { t, c }; }
      total += f.size;
    }
    return F;
  }
  async function scriptFor(entry, format, mode, shared) {
    const isVirt = typeof entry === 'object';
    const text = isVirt ? entry.contents : S.fs.read(entry);
    const asIs = () => { shared.inputs.add(entry); return { ok: true, code: text, css: '', name: regMap(null, entry), errors: [], warnings: [] }; };
    if (!isVirt && !needsBundler(entry, text)) return asIs();
    let r;
    try {
      if (!isVirt && format === 'iife') { r = await bundleClassic(entry, mode, shared.importMap); if (r.raw) return asIs(); }
      else r = await bundle({ entry: isVirt ? '' : entry, virtual: isVirt ? entry : null, mode, format, importMap: shared.importMap });
    }
    catch (e) { return { ok: false, errors: [{ path: isVirt ? shared.page : entry, line: 0, col: 0, text: 'Bundler unavailable: ' + (e && e.message || e), severity: 'error', source: 'esbuild' }], warnings: [] }; }
    if (!r.ok) return r;
    r.inputs.forEach((p) => shared.inputs.add(p));
    r.name = regMap(r.map, null);
    return r;
  }
  function storageFor(pid) { const s = PV.storage.get(pid || projectId()); return s && typeof s === 'object' ? s : {}; }
  // Build one page of a web project into a single self-contained HTML string for the sandboxed preview.
  async function buildPreviewHtml(page, o) {
    o = o || {};
    const t0 = now();
    const errors = [], warnings = [], seen = new Set();
    const src = S.fs.read(page);
    if (src == null) return { ok: false, html: '', errors: [{ path: page, line: 0, col: 0, text: page + ' was not found', severity: 'error', source: 'html' }], warnings, ms: 0 };
    const doc = new DOMParser().parseFromString(src, 'text/html');
    for (const s of doc.querySelectorAll('script[data-ost-base]')) s.remove();   // deploy-only helper (remixed apps)
    const dir = U.dirOf(page);
    const shared = { importMap: readImportMap(doc), inputs: new Set(), page };
    const cssLinked = new Map();
    const pkgCtx = mkCtx('preview');
    // relative URLs resolve against a fake origin, never against the studio page
    const ub = doc.querySelector('base[href]');
    if (ub) { const h = ub.getAttribute('href'); if (isLocalRef(h)) ub.setAttribute('href', FAKE + '/' + (resolveRef(dir, h) ? encodePath(resolveRef(dir, h)) + '/' : '')); }
    else { const b = doc.createElement('base'); b.setAttribute('href', FAKE + '/' + (dir ? encodePath(dir) + '/' : '')); doc.head.insertBefore(b, doc.head.firstChild); }
    const tail = [];
    for (const s of [...doc.querySelectorAll('script')]) {
      const type = (s.getAttribute('type') || '').trim().toLowerCase();
      const isModule = type === 'module';
      const isClassic = !type || /^(text|application)\/(x-)?(java|ecma)script$/.test(type);
      if (!isModule && !isClassic) continue;
      if (s.hasAttribute('nomodule')) { s.remove(); continue; }
      const ref = s.getAttribute('src');
      let r = null, from = '';
      if (ref != null) {
        if (!isLocalRef(ref)) continue;
        const p = resolveRef(dir, ref);
        if (!p || !S.fs.exists(p)) { errors.push({ path: page, line: lineOf(src, ref), col: 1, text: 'Script "' + ref + '" was not found' + (p ? ' (no file ' + p + ')' : ''), severity: 'error', source: 'html' }); s.remove(); continue; }
        from = p;
        r = await scriptFor(p, isModule ? 'esm' : 'iife', 'preview', shared);
      } else if (isModule && RE_NEEDS_BUNDLE.test(s.textContent || '')) {
        from = page;
        r = await scriptFor({ contents: s.textContent, dir, name: page + '#inline-module', loader: 'js' }, 'esm', 'preview', shared);
      } else continue;
      errors.push(...r.errors); warnings.push(...r.warnings);
      if (!r.ok) { s.remove(); continue; }
      ['src', 'integrity', 'crossorigin', 'referrerpolicy', 'fetchpriority'].forEach((x) => s.removeAttribute(x));
      if (r.module) s.setAttribute('type', 'module');     // a classic script that needs import statements (same as the deploy build)
      s.textContent = safeScript(r.code) + '\n//# sourceURL=' + r.name;
      if (r.css && r.css.trim()) { const st = doc.createElement('style'); st.setAttribute('data-ost-bundle', from); st.textContent = safeStyle(cssUrls(r.css, dir, warnings, from, seen)); doc.head.appendChild(st); }
      if (!isModule && !r.module && (s.hasAttribute('defer') || s.hasAttribute('async'))) { s.removeAttribute('defer'); s.removeAttribute('async'); s.remove(); tail.push(s); }
    }
    tail.forEach((s) => doc.body.appendChild(s));
    for (const l of [...doc.querySelectorAll('link[href]')]) {
      const rel = (l.getAttribute('rel') || '').toLowerCase(), href = l.getAttribute('href');
      if (!isLocalRef(href)) continue;
      const p = resolveRef(dir, href);
      if (/\bstylesheet\b/.test(rel)) {
        if (!p || !S.fs.exists(p)) { errors.push({ path: page, line: lineOf(src, href), col: 1, text: 'Stylesheet "' + href + '" was not found', severity: 'error', source: 'html' }); l.remove(); continue; }
        const inc = new Set();
        const st = doc.createElement('style');
        if (l.getAttribute('media')) st.setAttribute('media', l.getAttribute('media'));
        st.setAttribute('data-ost-css', p);
        st.textContent = safeStyle(processCss(p, warnings, inc, 0, seen, pkgCtx));
        l.replaceWith(st);
        cssLinked.set(p, inc);
      } else if (/\b(icon|apple-touch-icon)\b/.test(rel)) { const d = p && S.fs.exists(p) ? inlineData(p, warnings, page, seen) : null; if (d) l.setAttribute('href', d); }
      else if (/\b(modulepreload|preload|prefetch|manifest)\b/.test(rel)) l.remove();
    }
    for (const st of doc.querySelectorAll('style:not([data-ost-css]):not([data-ost-bundle])')) st.textContent = safeStyle(cssUrls(st.textContent, dir, warnings, page, seen));
    for (const e of doc.querySelectorAll('[style]')) e.setAttribute('style', cssUrls(e.getAttribute('style'), dir, warnings, page, seen));
    const attrs = [['img', 'src'], ['source', 'src'], ['video', 'src'], ['video', 'poster'], ['audio', 'src'], ['track', 'src'], ['embed', 'src'], ['input', 'src'], ['object', 'data'], ['image', 'href'], ['image', 'xlink:href']];
    for (const [tag, at] of attrs) {
      for (const e of doc.querySelectorAll(tag)) {
        const v = e.getAttribute(at); if (!v || !isLocalRef(v)) continue;
        const p = resolveRef(dir, v);
        if (!p || !S.fs.exists(p)) { warnings.push({ path: page, line: lineOf(src, v), col: 1, text: '<' + tag + ' ' + at + '="' + v + '"> — file not found in the project', severity: 'warning', source: 'html' }); continue; }
        const d = inlineData(p, warnings, page, seen); if (d) e.setAttribute(at, d);
      }
    }
    for (const e of doc.querySelectorAll('img[srcset], source[srcset]')) {
      const v = e.getAttribute('srcset'); if (!v || /data:|blob:/.test(v)) continue;
      e.setAttribute('srcset', v.split(',').map((part) => { const m = /^(\s*)(\S+)(.*)$/.exec(part); if (!m || !isLocalRef(m[2])) return part; const p = resolveRef(dir, m[2]); const d = p && S.fs.exists(p) ? inlineData(p, warnings, page, seen) : null; return d ? m[1] + d + m[3] : part; }).join(','));
    }
    const cfg = { gen: o.gen == null ? -1 : o.gen, page, fake: FAKE, files: previewFiles(shared.inputs), storage: o.storage || storageFor(), hash: o.hash || '' };
    const bs = doc.createElement('script');
    bs.textContent = '(function(){' + ostShow + '\n' + ostFmt + '\n' + ostTable + '\n' + ostPatchConsole + '\n(' + OST_BRIDGE + ')(' + jsonForScript(cfg) + ');})();';
    doc.head.insertBefore(bs, doc.head.firstChild);
    const html = serialize(doc);
    return { ok: !errors.length, html, errors, warnings, cssLinked, inputs: shared.inputs, ms: Math.round(now() - t0) };
  }

  /* ---- deploy build: real files ---- */
  function deployable(p) {
    if (p.split('/').some((seg) => seg.charAt(0) === '.')) return false;            // .env, .git, .vscode…
    if (/^node_modules\//.test(p)) return false;
    return true;
  }
  const NOT_SHIPPED = /^(package(-lock)?\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|tsconfig(\.[\w-]+)?\.json|jsconfig\.json|vite\.config\.[cm]?[jt]s|readme(\.[\w]+)?)$/i;
  // Apps are served under https://<apps host>/<name>/ — a root-absolute "/style.css" would leave the app.
  // The deploy build rewrites those to relative URLs (the preview resolves them against the project root).
  const isRootAbs = (u) => /^\s*\/(?![/\\])/.test(String(u == null ? '' : u));
  const toRootOf = (p) => { const d = String(p).split('/').length - 1; return d ? '../'.repeat(d) : './'; };
  function rootRel(ref, toRoot) {
    const [bare, query] = splitQuery(String(ref).trim());
    let p = resolveRef('', bare), tail;
    if (!p) tail = bare.replace(/^\/+/, '');                           // "/" = the app root (or a path we leave as written)
    else {
      if (/\/$/.test(bare) || (!S.fs.exists(p) && S.fs.exists(p + '/index.html'))) p += '/';
      else if (!S.fs.exists(p) && S.fs.exists(p + '.html')) p += '.html';  // same page lookup as the preview's links
      tail = encodePath(p);
    }
    return toRoot + tail + query;
  }
  // url(/x) and @import "/x" → relative; with pkgCtx, a bare @import "pkg/x.css" → jsDelivr (as the preview does)
  function deployCssText(css, dir, toRoot, pkgCtx) {
    let out = String(css).replace(/@import\s+(?:url\(\s*)?(?:"([^"]*)"|'([^']*)'|([^"')\s;]+))\s*\)?/gi, (m, d1, d2, d3) => {
      const ref = d1 != null ? d1 : d2 != null ? d2 : d3;
      if (!isLocalRef(ref)) return m;
      if (isRootAbs(ref)) return '@import url(' + JSON.stringify(rootRel(ref, toRoot)) + ') ';
      const t = resolveRef(dir, ref);
      if (pkgCtx && !(t && S.fs.exists(t)) && !/^\.{0,2}\//.test(ref)) return '@import url(' + JSON.stringify(npmFileUrl(ref, pkgCtx)) + ') ';
      return m;
    });
    out = out.replace(/url\(\s*(['"]?)([^'")]+?)\1\s*\)/gi, (m, q, ref) => isLocalRef(ref) && isRootAbs(ref) ? 'url(' + JSON.stringify(rootRel(ref, toRoot)) + ')' : m);
    return out;
  }
  // JS can't be rewritten safely — point out string literals like fetch("/data.json") that name a project file.
  function warnRootAbs(code, from, warnings, ctx) {
    const re = /(['"`])\/(?![/\\])([^'"`\s?#*<>]{1,200})(?:[?#][^'"`\s]*)?\1/g;
    let m;
    while ((m = re.exec(String(code))) && ctx.absWarned.size < 8) {
      const p = resolveRef('', m[2]);
      if (!p || ctx.absWarned.has(p) || !S.fs.exists(p)) continue;
      ctx.absWarned.add(p);
      warnings.push({ path: from, line: 0, col: 0, text: '"/' + m[2] + '" is a root-absolute URL — deployed apps live under /<name>/ on the apps host, so it would load from outside your app. Use a relative URL ("./' + p + '").', severity: 'warning', source: 'deploy' });
    }
  }
  // Root page of a deployed app: the host answers unknown extension-less paths (/<name>/users/42) with index.html.
  // Its relative URLs would then resolve under /users/, so on those deep routes we pin <base href="/<name>/">.
  const APPS_HOST = (() => { try { return new URL(S.APPS).host; } catch (_) { return ''; } })();
  function withSpaBase(html) {
    if (!APPS_HOST) return html;
    const tag = '<script data-ost-base>(function(){try{var l=location,m=/^\\/[^\\/]+\\//.exec(l.pathname);' +
      'if(l.host===' + JSON.stringify(APPS_HOST) + '&&m&&l.pathname!==m[0]&&l.pathname!==m[0]+"index.html"&&!document.querySelector("base")){var b=document.createElement("base");b.href=m[0];document.head.appendChild(b);}}catch(e){}})();<\/script>';
    const at = /<head(?:\s[^>]*)?>/i.exec(html) || /<html(?:\s[^>]*)?>/i.exec(html) || /<!doctype[^>]*>/i.exec(html);
    return at ? html.slice(0, at.index + at[0].length) + tag + html.slice(at.index + at[0].length) : tag + html;
  }
  async function buildDeploy() {
    const t0 = now();
    const errors = [], warnings = [], files = {};
    const finish = (extra) => {
      const ms = Math.round(now() - t0);
      const ok = !errors.length;
      const r = Object.assign({ ok, errors, warnings, files: ok ? files : {}, entry: 'index.html', ms }, extra || {});
      LAST_BUILD = { mode: 'deploy', ok, errors, warnings, ms, at: Date.now(), files: Object.keys(r.files).length, bytes: Object.values(r.files).reduce((n, c) => n + String(c).length, 0) };
      setProblems('deploy', errors.concat(warnings));
      S.bus.emit('build:done', { ok, errors, ms, mode: 'deploy' });
      return r;
    };
    if (!S.projects.current()) { errors.push({ path: '', line: 0, col: 0, text: 'No project is open.', severity: 'error', source: 'deploy' }); return finish(); }
    if (!S.fs.exists('index.html')) { errors.push({ path: '', line: 0, col: 0, text: 'Add an index.html — OST deploys static web apps (HTML/CSS/JS). Python and Node-style scripts run only inside the Studio sandbox.', severity: 'error', source: 'deploy' }); return finish(); }
    const snap = S.fs.snapshot();
    const all = Object.keys(snap).sort();
    const kind = U.projectKind();
    const ctx = { cache: new Map(), referenced: new Set(), bundled: new Set(), absWarned: new Set() };
    const pkgCtx = mkCtx('deploy');
    const pages = all.filter((p) => /\.html?$/i.test(p) && deployable(p));
    // static sites ship every file as written; pages still get what the preview gives them (inline modules that
    // import packages are bundled, root-absolute URLs made relative)
    if (kind === 'static') for (const p of all) if (deployable(p)) files[p] = snap[p];
    for (const page of pages) {
      try { files[page] = await deployPage(page, ctx, files, errors, warnings); }
      catch (e) { errors.push({ path: page, line: 0, col: 0, text: String(e && e.message || e), severity: 'error', source: 'deploy' }); }
    }
    if (kind !== 'static') {
      for (const p of all) {
        if (p in files || /\.html?$/i.test(p) || !deployable(p)) continue;
        if (NOT_SHIPPED.test(U.baseOf(p))) continue;
        if (ctx.referenced.has(p)) { files[p] = snap[p]; continue; }
        if (/\.(tsx?|jsx|mts|cts)$/i.test(p)) continue;                                 // browsers can't run these raw
        if (ctx.bundled.has(p) && !/\.json$/i.test(p)) continue;                         // already inside a bundle
        files[p] = snap[p];
      }
    }
    for (const p of Object.keys(files)) {
      if (/\.css$/i.test(p) && p in snap && !S.fs.isBinary(p)) files[p] = deployCssText(files[p], U.dirOf(p), toRootOf(p), pkgCtx);
    }
    limits(files, errors);
    return finish();
  }
  function limits(files, errors) {
    const paths = Object.keys(files);
    if (paths.length > 300) errors.push({ path: '', line: 0, col: 0, text: 'Deploys are limited to 300 files (this build has ' + paths.length + ').', severity: 'error', source: 'deploy' });
    let total = 0;
    for (const p of paths) { const n = String(files[p]).length; total += n; if (n > 5 * 1024 * 1024) errors.push({ path: p, line: 0, col: 0, text: p + ' is ' + U.fmtBytes(n) + ' — deployed files are limited to 5 MB.', severity: 'error', source: 'deploy' }); }
    if (total > 25 * 1024 * 1024) errors.push({ path: '', line: 0, col: 0, text: 'Deploys are limited to 25 MB (this build is ' + U.fmtBytes(total) + ').', severity: 'error', source: 'deploy' });
    return null;
  }
  // classic: a classic <script src> — decided by bundleClassic, exactly like the preview
  async function deployBundle(entry, format, importMap, ctx, files, errors, warnings, page, classic) {
    const isVirt = typeof entry === 'object';
    // inline modules resolve relative imports from their page's folder, and every page may have its own import map
    const key = (isVirt ? 'virtual:' + (entry.dir || '') + '\n' + entry.contents : entry) + '|' + (classic ? 'classic' : format) + '|' + JSON.stringify(importMap || null);
    if (ctx.cache.has(key)) return ctx.cache.get(key);
    const keep = () => { ctx.referenced.add(entry); warnRootAbs(S.fs.read(entry) || '', entry, warnings, ctx); const out = { keep: true }; ctx.cache.set(key, out); return out; };
    let r;
    try { r = classic ? await bundleClassic(entry, 'deploy', importMap) : await bundle({ entry: isVirt ? '' : entry, virtual: isVirt ? entry : null, mode: 'deploy', format, importMap }); }
    catch (e) {
      // bundler unreachable: a plain script that needs no transpiling still ships as-is
      if (!isVirt && (classic ? !/^(ts|tsx|jsx|mts|cts)$/i.test(U.extOf(entry)) : !needsBundler(entry, S.fs.read(entry)))) { warnings.push({ path: entry, line: 0, col: 0, text: 'Bundler unavailable — ' + entry + ' ships as written, unminified.', severity: 'warning', source: 'deploy' }); return keep(); }
      errors.push({ path: isVirt ? page : entry, line: 0, col: 0, text: 'Bundler unavailable: ' + (e && e.message || e), severity: 'error', source: 'deploy' });
      ctx.cache.set(key, null); return null;
    }
    if (r.raw) return keep();
    if (!r.ok) { errors.push(...r.errors); warnings.push(...r.warnings); ctx.cache.set(key, null); return null; }
    warnings.push(...r.warnings);
    warnRootAbs(r.code, isVirt ? page : entry, warnings, ctx);
    r.inputs.forEach((p) => ctx.bundled.add(p));
    r.assets.forEach((p) => ctx.referenced.add(p));
    const js = 'assets/app-' + (await U.sha256Hex(r.code)).slice(0, 10) + '.js';
    files[js] = r.code;
    let css = '';
    if (r.css && r.css.trim()) { css = 'assets/app-' + (await U.sha256Hex(r.css)).slice(0, 10) + '.css'; files[css] = r.css; }
    const out = { js, css, module: !!r.module };
    ctx.cache.set(key, out);
    return out;
  }
  const DEPLOY_REFS = [['link', 'href'], ['script', 'src'], ['img', 'src'], ['source', 'src'], ['video', 'src'], ['video', 'poster'], ['audio', 'src'], ['track', 'src'], ['embed', 'src'], ['input', 'src'], ['iframe', 'src'], ['object', 'data'], ['a', 'href'], ['area', 'href'], ['form', 'action'], ['base', 'href'], ['image', 'href'], ['image', 'xlink:href'], ['use', 'href'], ['use', 'xlink:href']];
  async function deployPage(page, ctx, files, errors, warnings) {
    const src = S.fs.read(page) || '';
    const doc = new DOMParser().parseFromString(src, 'text/html');
    const dir = U.dirOf(page);
    const pre = toRootOf(page);
    const importMap = readImportMap(doc);
    let changed = false;                                   // untouched pages ship byte-for-byte
    const addCss = (href) => { if (doc.head.querySelector('link[rel="stylesheet"][href="' + href + '"]')) return; const l = doc.createElement('link'); l.setAttribute('rel', 'stylesheet'); l.setAttribute('href', href); doc.head.appendChild(l); };
    for (const s of doc.querySelectorAll('script[data-ost-base]')) { s.remove(); changed = true; }   // from a remixed deploy; re-added below
    for (const s of [...doc.querySelectorAll('script')]) {
      const type = (s.getAttribute('type') || '').trim().toLowerCase();
      const isModule = type === 'module';
      const isClassic = !type || /^(text|application)\/(x-)?(java|ecma)script$/.test(type);
      if (!isModule && !isClassic) continue;
      const ref = s.getAttribute('src');
      if (ref != null) {
        if (!isLocalRef(ref)) continue;
        const p = resolveRef(dir, ref);
        if (!p || !S.fs.exists(p)) { errors.push({ path: page, line: lineOf(src, ref), col: 1, text: 'Script "' + ref + '" was not found', severity: 'error', source: 'deploy' }); continue; }
        const b = await deployBundle(p, isModule ? 'esm' : 'iife', importMap, ctx, files, errors, warnings, page, !isModule);
        if (!b || b.keep) continue;                        // shipped as written (a root-absolute src is fixed below)
        s.setAttribute('src', pre + b.js); s.removeAttribute('integrity'); changed = true;
        if (b.module) s.setAttribute('type', 'module');
        if (b.css) addCss(pre + b.css);
      } else if (isModule && RE_NEEDS_BUNDLE.test(s.textContent || '')) {
        const b = await deployBundle({ contents: s.textContent, dir, name: page + '#inline-module', loader: 'js' }, 'esm', importMap, ctx, files, errors, warnings, page);
        if (!b || b.keep) continue;
        s.textContent = ''; s.setAttribute('src', pre + b.js); changed = true;
        if (b.css) addCss(pre + b.css);
      } else warnRootAbs(s.textContent || '', page, warnings, ctx);
    }
    for (const [tag, at] of DEPLOY_REFS) {
      for (const e of doc.querySelectorAll(tag)) {
        const v = e.getAttribute(at); if (!v || !isLocalRef(v)) continue;
        const p = resolveRef(dir, v); if (p) ctx.referenced.add(p);
        if (isRootAbs(v)) { e.setAttribute(at, rootRel(v, pre)); changed = true; }
      }
    }
    for (const e of doc.querySelectorAll('img[srcset], source[srcset]')) {
      const v = e.getAttribute('srcset') || '';
      const nv = v.split(',').map((part) => { const m = /^(\s*)(\S+)(.*)$/.exec(part); if (!m || !isLocalRef(m[2])) return part; const p = resolveRef(dir, m[2]); if (p) ctx.referenced.add(p); return isRootAbs(m[2]) ? m[1] + rootRel(m[2], pre) + m[3] : part; }).join(',');
      if (nv !== v) { e.setAttribute('srcset', nv); changed = true; }
    }
    for (const e of doc.querySelectorAll('[style]')) { const v = e.getAttribute('style'), nv = deployCssText(v, dir, pre, null); if (nv !== v) { e.setAttribute('style', nv); changed = true; } }
    for (const st of doc.querySelectorAll('style')) { const v = st.textContent, nv = deployCssText(v, dir, pre, null); if (nv !== v) { st.textContent = nv; changed = true; } }
    const html = changed ? serialize(doc) : src;
    return page === 'index.html' && !doc.querySelector('base[href]') ? withSpaBase(html) : html;
  }

  /* ======================================================================
   * runner (hidden sandboxed iframe that owns JS + Python workers)
   * ==================================================================== */
  const R = { frame: null, ready: null, onReady: null };
  const RUNS = new Map();
  let CUR_UI = null, LAST_KIND = '', LAST_BUILD = null;
  function runnerHtml() {
    const shared = ostShow + '\n' + ostFmt + '\n' + ostTable + '\n' + ostPatchConsole + '\n';
    const js = shared + '(' + OST_JS_WORKER + ')();';
    const py = shared + '(' + OST_PY_WORKER + ')(' + JSON.stringify({ base: PYODIDE_BASE, setup: PY_SETUP, alias: PY_ALIAS }) + ');';
    return '<!doctype html><meta charset="utf-8"><title>OST runner</title><script>(' + OST_RUNNER + ')(' + jsonForScript({ js, py }) + ');<\/script>';
  }
  function runner() {
    if (R.ready) return R.ready;
    R.ready = new Promise((res, rej) => {
      const f = document.createElement('iframe');
      f.setAttribute('sandbox', 'allow-scripts');
      f.setAttribute('aria-hidden', 'true');
      f.setAttribute('tabindex', '-1');
      f.setAttribute('title', 'OST Studio code runner');
      f.className = 'st-runtime-runner';
      const t = setTimeout(() => { if (R.frame === f) { killRunner('The sandbox did not start.'); rej(new Error('The code sandbox did not start — reload the page and try again.')); } }, 15000);
      R.frame = f;
      R.onReady = () => { clearTimeout(t); res(); };
      f.srcdoc = runnerHtml();
      document.body.appendChild(f);
    });
    R.ready.catch(() => {});
    return R.ready;
  }
  function killRunner(reason) {
    if (R.frame) R.frame.remove();
    R.frame = null; R.ready = null; R.onReady = null;
    for (const j of [...RUNS.values()]) finishJob(j, false, reason || 'Stopped');
  }
  function postRunner(m) { if (R.frame && R.frame.contentWindow) R.frame.contentWindow.postMessage(m, '*'); }
  function onRunnerMsg(d) {
    if (!d || typeof d !== 'object') return;
    if (d.type === 'runner-ready') { if (R.onReady) R.onReady(); return; }
    const job = RUNS.get(String(d.id || '')); if (!job) return;
    switch (d.type) {
      case 'lines': if (Array.isArray(d.lines)) for (const l of d.lines.slice(0, admit(job.id, Math.min(500, d.lines.length)))) if (l && typeof l === 'object') jobOut(job, l.level, l.text); break;
      case 'status': jobLine(job, 'system', String(d.text || '').slice(0, 500)); break;
      case 'clear': clearConsole(); break;
      case 'exec-start': if (!job.execStarted) { job.execStarted = true; armTimer(job); } break;
      case 'image': if (typeof d.data === 'string' && d.data.length < 12e6 && /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(d.data)) jobLine(job, 'log', '', { image: d.data }); break;
      case 'done': {
        if (d.writes && typeof d.writes === 'object') job.writes = sanitizeWrites(d.writes);
        const err = typeof d.error === 'string' ? d.error.slice(0, 500) : '';
        if (err === 'stopped' || err === 'cancelled') finishJob(job, false, job.stopReason || 'Stopped');
        else finishJob(job, !!d.ok, err);
        break;
      }
    }
  }
  function sanitizeWrites(w) {
    const out = {}; let n = 0;
    for (const k of Object.keys(w)) {
      if (n >= 50) break;
      const p = U.normPath(k), v = w[k];
      if (!p || !v || typeof v.content !== 'string' || v.content.length > S.limits.fileBytes * 1.4) continue;
      out[p] = { content: v.content, binary: !!v.binary }; n++;
    }
    return n ? out : null;
  }
  function snapshotForRun() {
    const files = {}, bin = {}; let total = 0, skipped = 0;
    for (const f of S.fs.list()) {
      if (total + f.size > RUN_FILES_BUDGET) { skipped++; continue; }
      const c = S.fs.read(f.path); if (c == null) continue;
      files[f.path] = c; if (f.binary) bin[f.path] = true; total += f.size;
    }
    return { files, bin, skipped };
  }

  /* ---- jobs ---- */
  function jobSource(job) { return job.kind === 'python' ? 'python' : 'run'; }
  // Output kept for the run's result (the agent reads it): the first OUT_HEAD chars + a rolling OUT_TAIL-char tail.
  const OUT_HEAD = 60000, OUT_TAIL = 20000;
  function outBuf() {
    const head = [], tail = []; let headLen = 0, tailLen = 0, ti = 0, omitted = 0;
    return {
      push(s) {
        s = String(s);
        if (!tail.length && headLen + s.length <= OUT_HEAD) { head.push(s); headLen += s.length + 1; return; }
        tail.push(s); tailLen += s.length + 1;
        while (tailLen > OUT_TAIL && tail.length - ti > 1) { const x = tail[ti]; tail[ti++] = ''; tailLen -= x.length + 1; omitted += x.length + 1; }
        if (ti > 512 && ti * 2 > tail.length) { tail.splice(0, ti); ti = 0; }
      },
      text() {
        const t = tail.slice(ti);
        return head.join('\n') + (omitted ? '\n… (' + omitted + ' characters omitted) …\n' : t.length && head.length ? '\n' : '') + t.join('\n');
      }
    };
  }
  function jobLine(job, level, text, extra) {
    if (!LEVELS.has(level)) level = 'log';
    if (level !== 'system' && !(extra && extra.image)) job.out.push((level === 'error' ? '[error] ' : level === 'warn' ? '[warn] ' : '') + text);
    if (job.quiet && level !== 'error') return;
    line(level, text, jobSource(job), extra);
  }
  function jobOut(job, level, text) {
    level = LEVELS.has(level) ? level : 'log';
    text = typeof text === 'string' ? text : String(text);
    if (text.length > 20000) text = text.slice(0, 20000) + '…';
    let loc = null;
    if (job.kind === 'js') { const m = mapText(text); text = m.text; loc = m.loc; }
    else if (level === 'error' && /File "[^"]+", line \d+/.test(text)) {
      const all = [...text.matchAll(/File "([^"]+)", line (\d+)/g)].filter((m) => S.fs.exists(m[1]));
      const last = all[all.length - 1];
      if (last) {
        loc = { path: last[1], line: +last[2], col: 1 };
        const msg = text.split('\n').filter((x) => x.trim()).pop() || 'Error';
        setProblems('python', [{ path: last[1], line: +last[2], col: 1, text: msg.trim(), severity: 'error', source: 'python' }]);
      }
    }
    if (level === 'error' && !job.firstError) {
      const ls = text.split('\n').filter((x) => x.trim());
      job.firstError = (job.kind === 'python' && /^Traceback/.test(ls[0] || '') ? ls[ls.length - 1] : ls[0] || text).trim().slice(0, 300);
    }
    jobLine(job, level, text, loc ? { loc } : null);
  }
  function armTimer(job) {
    clearTimeout(job.timer);
    let ms = job.timeoutMs;
    if (job.deadline) ms = Math.min(ms, job.deadline - now());
    if (ms <= 0) { stopJob(job, 'timeout'); return; }
    job.timer = setTimeout(() => stopJob(job, 'timeout'), ms);
  }
  function stopJob(job, reason) {
    if (job.done) return;
    job.stopReason = reason === 'timeout' ? 'Timed out after ' + fmtMs(job.deadline ? Math.max(0, now() - job.t0) : job.timeoutMs) : 'Stopped';
    if (reason === 'timeout') jobLine(job, 'warn', '⏱ Stopped after ' + fmtMs(now() - job.t0) + ' (time limit ' + fmtMs(job.timeoutMs) + '). Scripts that never finish — servers, setInterval loops, infinite loops — are stopped automatically.');
    // A Python job still waiting for the interpreter (loading, or queued behind another program) is just
    // dequeued — killing the shared worker would throw away the boot and any other job queued in it.
    postRunner({ type: job.kind === 'python' && !job.execStarted ? 'cancel' : 'stop', id: job.id });
    finishJob(job, false, job.stopReason);
  }
  function finishJob(job, ok, error) {
    if (job.done) return;
    job.done = true;
    clearTimeout(job.timer); clearTimeout(job.loadTimer); clearTimeout(job.hardTimer);
    RUNS.delete(job.id); FLOOD.delete(job.id);
    if (CUR_UI === job) CUR_UI = null;
    const ms = Math.round(now() - job.t0);
    if (ok) jobLine(job, 'system', '✓ Finished in ' + fmtMs(ms));
    else if (/^(Stopped|Timed out)/.test(error || '')) jobLine(job, 'system', '■ ' + error);
    else jobLine(job, 'system', '✕ Exited with an error after ' + fmtMs(ms));
    if (job.writes && !job.capture) offerWrites(job.writes);
    S.bus.emit('run:end', { kind: job.kind === 'python' ? 'python' : 'js', path: job.path, ok: !!ok, ms });
    paintRunning();
    const output = job.out.text();
    job.resolve({ ok: !!ok, output, error: ok ? '' : (job.firstError && !/^(Stopped|Timed out)/.test(error || '') ? job.firstError : (error || job.firstError || 'Failed')), ms, files: job.writes || undefined });
  }
  function offerWrites(w) {
    const paths = Object.keys(w);
    line('system', 'The script wrote ' + paths.length + ' file' + (paths.length > 1 ? 's' : '') + ' (' + paths.slice(0, 6).join(', ') + (paths.length > 6 ? ', …' : '') + ') in its sandbox copy of the project.', 'run', {
      action: { label: 'Save to project', run: async () => { let n = 0; for (const p of paths) { try { await S.fs.write(p, w[p].content, { source: 'user', binary: w[p].binary }); n++; } catch (e) { S.ui.toast(e.message, 'err'); } } if (n) S.ui.toast('Saved ' + n + ' file' + (n > 1 ? 's' : '') + ' to the project', 'ok'); } }
    });
  }
  async function startRun(kind, path, o) {
    o = o || {};
    const id = 'r' + U.uid(6);
    const job = { id, kind, path, ui: !!o.ui, capture: !!o.capture, quiet: false, t0: now(), out: outBuf(), firstError: '', writes: null, done: false, execStarted: false, timeoutMs: o.timeoutMs || UI_TIMEOUT, deadline: o.deadline || 0 };
    job.promise = new Promise((r) => { job.resolve = r; });
    if (o.ui) { if (CUR_UI && !CUR_UI.done) stopJob(CUR_UI, 'restart'); CUR_UI = job; }
    RUNS.set(id, job);
    LAST_KIND = kind;
    S.bus.emit('run:start', { kind: kind === 'python' ? 'python' : 'js', path });
    paintRunning();
    if (o.ui) { S.ui.showPanel('console'); }
    jobLine(job, 'system', '▶ ' + (o.capture ? 'Agent run · ' : '') + (o.repl ? (kind === 'python' ? 'python › ' : 'js › ') + String(o.code).split('\n')[0].slice(0, 120) : (kind === 'python' ? 'python ' : 'node ') + path));
    if (job.deadline) job.hardTimer = setTimeout(() => {
      if (job.done) return;
      if (kind === 'python' && !job.execStarted) {
        const busy = [...RUNS.values()].some((j) => j !== job && j.kind === 'python' && j.execStarted && !j.done);
        postRunner({ type: 'cancel', id });
        finishJob(job, false, busy ? 'Python is busy running another program — stop it or wait, then try again.' : 'Python is still loading (the first run downloads about 6 MB) — try again in a few seconds.');
      }
      else stopJob(job, 'timeout');
    }, Math.max(0, job.deadline - now()));
    try {
      await runner();
      if (job.done) return job.promise;
      if (kind === 'python') {
        if (!o.repl) setProblems('python', []);
        const snap = snapshotForRun();
        if (snap.skipped) jobLine(job, 'warn', snap.skipped + ' large file(s) were not copied into the Python sandbox (20 MB limit).');
        const code = o.repl ? String(o.code) : S.fs.read(path);
        if (code == null) throw new Error(path + ' does not exist.');
        postRunner({ type: o.repl ? 'repl-py' : 'run-py', id, code, path: o.repl ? '<console>' : path, files: snap.files, bin: snap.bin });
        job.loadTimer = setTimeout(() => { if (!job.execStarted && !job.done) { postRunner({ type: 'stop', id }); finishJob(job, false, 'Python did not finish loading in ' + fmtMs(PY_LOAD_TIMEOUT) + ' — check your connection and try again.'); } }, PY_LOAD_TIMEOUT);
      } else {
        let code, name;
        if (o.repl) { code = String(o.code); name = 'ostconsole-' + id + '.js'; }
        else {
          const text = S.fs.read(path);
          if (text == null) throw new Error(path + ' does not exist.');
          if (!needsBundler(path, text)) { code = text; name = regMap(null, path, 'run'); setProblems('run', []); }
          else {
            const b = await bundle({ entry: path, mode: 'run', format: 'esm' });
            if (job.done) return job.promise;
            setProblems('run', b.errors.concat(b.warnings || []));
            if (!b.ok) {
              for (const e of b.errors) jobLine(job, 'error', (e.path ? e.path + ':' + e.line + ':' + e.col + ' — ' : '') + e.text, e.path ? { loc: { path: e.path, line: e.line, col: e.col } } : null);
              job.firstError = b.errors[0] ? b.errors[0].text : 'Build failed';
              finishJob(job, false, 'Build failed');
              return job.promise;
            }
            code = b.code; name = regMap(b.map, null, 'run');
          }
        }
        const snap = snapshotForRun();
        postRunner({ type: 'run-js', id, code, name, path, files: snap.files, bin: snap.bin, repl: !!o.repl });
      }
    } catch (e) {
      jobLine(job, 'error', String(e && e.message || e));
      job.firstError = String(e && e.message || e);
      finishJob(job, false, job.firstError);
    }
    return job.promise;
  }
  function pickRunTarget(path) {
    const has = (p) => !!p && S.fs.exists(p);
    if (path) {
      const ext = U.extOf(path);
      if (ext === 'py') return { kind: 'python', path };
      if (/^(js|mjs|cjs|ts|mts|cts)$/.test(ext)) return { kind: 'js', path };
      if (/^html?$/.test(ext)) return { kind: 'preview', path };
      if (/^(jsx|tsx|css)$/.test(ext) && has('index.html')) return { kind: 'preview', path: 'index.html' };
      if (/^(jsx|tsx)$/.test(ext)) return { kind: 'js', path };
    }
    const kind = U.projectKind(), active = activeFile();
    if (kind === 'web' || kind === 'react' || kind === 'static') return { kind: 'preview', path: /\.html?$/i.test(active) && has(active) ? active : 'index.html' };
    if (has(active) && /\.py$/.test(active)) return { kind: 'python', path: active };
    if (has(active) && /\.(m?[jt]s|c[jt]s)$/.test(active)) return { kind: 'js', path: active };
    if (kind === 'python') return { kind: 'python', path: U.entryFor('python') };
    if (kind === 'node') return { kind: 'js', path: U.entryFor('node') };
    if (has('index.html')) return { kind: 'preview', path: 'index.html' };
    return { kind: 'none' };
  }
  async function run(path) {
    if (!S.projects.current()) { S.ui.toast('Open or create a project first.', 'warn'); return null; }
    const t = pickRunTarget(path ? U.normPath(path) : '');
    if (t.kind === 'none') { S.ui.toast('Nothing to run — add an index.html, a .py file or a .js/.ts file.', 'warn'); return null; }
    if (t.kind === 'preview') { await preview(true, t.path); return null; }
    if (!S.fs.exists(t.path)) { S.ui.toast(t.path + ' does not exist.', 'err'); return null; }
    return startRun(t.kind, t.path, { ui: true, timeoutMs: Number(S.settings.get('run.timeoutMs', UI_TIMEOUT)) || UI_TIMEOUT });
  }
  function stop() {
    let any = false;
    for (const j of [...RUNS.values()]) { stopJob(j, 'stopped'); any = true; }
    if (!any && PV.frame) { unmountPreview(); pvMessage('Preview stopped. Press ⟳ to run it again.'); PV.stale = true; any = true; }
    if (!any) S.ui.toast('Nothing is running.');
    return any;
  }
  async function runCapture(path, o) {
    o = o || {};
    const timeoutMs = Math.max(1000, Math.min(Number(o.timeoutMs) || AGENT_TIMEOUT, 300000));
    const t0 = now();
    if (!S.projects.current()) return { ok: false, output: '', error: 'No project is open.', ms: 0 };
    const t = pickRunTarget(path ? U.normPath(path) : '');
    if (t.kind === 'none') return { ok: false, output: '', error: 'Nothing to run — add an index.html, a .py file or a .js/.ts file.', ms: 0 };
    if (t.path && !S.fs.exists(t.path)) return { ok: false, output: '', error: t.path + ' does not exist.', ms: 0 };
    if (t.kind === 'preview') return capturePage(t.path, timeoutMs);
    const r = await startRun(t.kind, t.path, { capture: true, timeoutMs, deadline: t0 + timeoutMs });
    return Object.assign(r, { ms: Math.round(now() - t0) });
  }
  const CAPTURES = new Set();
  // Studio-side flood guard: sandboxed code can bypass our bridge and postMessage directly.
  const FLOOD = new Map();
  function admit(key, n) {
    const t = Date.now(); let f = FLOOD.get(key);
    if (!f || t - f.t >= 1000) { if (f && f.dropped) line('warn', '… ' + f.dropped + ' lines dropped (more than 2000 per second)', key === 'preview' || key === 'capture' ? 'preview' : (RUNS.get(key) || {}).kind === 'python' ? 'python' : 'run'); f = { t, n: 0, dropped: 0 }; FLOOD.set(key, f); }
    const room = Math.max(0, 2000 - f.n), take = Math.min(room, n);
    f.n += take; f.dropped += n - take;
    return take;
  }
  async function capturePage(page, timeoutMs) {
    const t0 = now();
    const deadline = t0 + timeoutMs;
    line('system', '▶ Agent check · ' + page, 'preview');
    let bt = 0;
    const b = await Promise.race([buildPreviewHtml(page, { gen: -2 }), new Promise((r) => { bt = setTimeout(() => r(null), timeoutMs); })]);
    clearTimeout(bt);
    if (!b) return { ok: false, output: '', error: 'Build timed out after ' + fmtMs(timeoutMs) + ' (the bundler or a package download did not answer).', ms: Math.round(now() - t0) };
    const out = outBuf();
    let firstErr = '';
    for (const e of b.errors) { out.push('[error] ' + (e.path ? e.path + ':' + e.line + ' — ' : '') + e.text); if (!firstErr) firstErr = e.text; }
    for (const w of b.warnings) out.push('[warn] ' + (w.path ? w.path + ': ' : '') + w.text);
    if (!b.html) return { ok: false, output: out.text(), error: firstErr || 'Build failed', ms: Math.round(now() - t0) };
    if (now() >= deadline) return { ok: false, output: out.text(), error: 'Build took longer than ' + fmtMs(timeoutMs) + '.', ms: Math.round(now() - t0) };
    const frame = document.createElement('iframe');
    frame.setAttribute('sandbox', CAPTURE_SANDBOX);
    frame.setAttribute('aria-hidden', 'true');
    frame.setAttribute('tabindex', '-1');
    frame.className = 'st-runtime-capture';
    const cap = { frame, done: null, last: now(), loaded: false };
    let finish;
    const done = new Promise((r) => { finish = r; });
    cap.onMsg = (d) => {
      if (!d || typeof d !== 'object') return;
      cap.last = now();
      if (d.__ost === 'ready') cap.loaded = true;
      if (d.__ost === 'lines' && Array.isArray(d.lines)) for (const l of d.lines.slice(0, admit('capture', Math.min(500, d.lines.length)))) {
        if (!l || typeof l !== 'object') continue;
        const level = LEVELS.has(l.level) ? l.level : 'log';
        const m = mapText(String(l.text).slice(0, 20000), l);
        out.push((level === 'error' ? '[error] ' : level === 'warn' ? '[warn] ' : '') + m.text);
        if (level === 'error' && !firstErr) firstErr = m.text.split('\n')[0];
        line(level, m.text, 'preview', m.loc ? { loc: m.loc } : null);
      }
    };
    CAPTURES.add(cap);
    pvArm(cap);                                        // a page that freezes the tab is not auto-previewed after the reload
    frame.srcdoc = b.html;
    document.body.appendChild(frame);
    const iv = setInterval(() => { const n = now(); if (n >= deadline || (cap.loaded && n - cap.last > 1500 && n - t0 > 2000)) finish(); }, 200);
    await done;
    clearInterval(iv);
    CAPTURES.delete(cap);
    pvDisarm(cap);
    frame.remove();
    if (!cap.loaded && !firstErr) firstErr = 'The page did not finish loading within ' + fmtMs(timeoutMs) + '.';
    return { ok: b.ok && !firstErr, output: out.text(), error: firstErr, ms: Math.round(now() - t0) };
  }

  /* ======================================================================
   * Console panel
   * ==================================================================== */
  const CON = { lines: [], root: null, list: null, filter: '', level: 'all', ts: !!S.settings.get('console.ts', false), preserve: !!S.settings.get('console.preserve', false), unseen: 0, pending: [], raf: 0, mode: 'auto', hist: [], hidx: -1, evals: new Map() };
  function line(level, text, source, extra) { S.bus.emit('console', Object.assign({ level, text: String(text == null ? '' : text), source: source || 'run', ts: Date.now() }, extra || {})); }
  function fmtClock(ts) { const d = new Date(ts); const p = (n, w) => String(n).padStart(w || 2, '0'); return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()) + '.' + p(d.getMilliseconds(), 3); }
  function matches(l) {
    if (CON.level === 'error' && l.level !== 'error') return false;
    if (CON.level === 'warn' && l.level !== 'error' && l.level !== 'warn') return false;
    if (CON.level === 'log' && (l.level === 'error' || l.level === 'warn')) return false;
    if (CON.filter && String(l.text).toLowerCase().indexOf(CON.filter) < 0 && String(l.source).toLowerCase().indexOf(CON.filter) < 0) return false;
    return true;
  }
  function lineNode(l) {
    const d = el('div', 'st-runtime-ln lv-' + l.level);
    if (CON.ts) d.appendChild(el('span', 'st-runtime-ts', fmtClock(l.ts)));
    d.appendChild(el('span', 'st-runtime-src src-' + String(l.source).replace(/[^a-z-]/gi, ''), l.source));
    const m = el('span', 'st-runtime-msg', l.text);
    if (l.image) {
      const img = new Image(); img.className = 'st-runtime-img'; img.alt = 'Figure';
      img.onload = () => { const L = CON.list; if (L && L.scrollHeight - L.scrollTop - L.clientHeight < img.height + 60) L.scrollTop = L.scrollHeight; };
      img.src = l.image; m.appendChild(img);
    }
    d.appendChild(m);
    if (l.action && l.action.label) { const b = el('button', 'st-runtime-act', l.action.label); b.type = 'button'; b.onclick = () => { b.disabled = true; Promise.resolve().then(() => l.action.run()).catch((e) => S.ui.toast(e.message || String(e), 'err')); }; d.appendChild(b); }
    if (l.loc && l.loc.path) { const b = el('button', 'st-runtime-loc', l.loc.path + ':' + (l.loc.line || 1)); b.type = 'button'; b.title = 'Open ' + l.loc.path + ' at line ' + (l.loc.line || 1); b.onclick = () => reveal(l.loc); d.appendChild(b); }
    const c = el('span', 'st-runtime-cnt', l.count > 1 ? String(l.count) : ''); if (l.count < 2) c.hidden = true; d.appendChild(c);
    l.node = d;
    return d;
  }
  function addLine(e) {
    if (!e || typeof e !== 'object') return;
    const level = LEVELS.has(e.level) ? e.level : 'log';
    const l = { level, text: String(e.text == null ? '' : e.text), source: String(e.source || 'run').slice(0, 24), ts: e.ts || Date.now(), loc: e.loc && typeof e.loc.path === 'string' ? e.loc : null, image: typeof e.image === 'string' && /^data:image\/(png|jpeg);base64,/.test(e.image) ? e.image : '', action: e.action && typeof e.action.run === 'function' ? e.action : null, count: 1 };
    const last = CON.lines[CON.lines.length - 1];
    if (last && !l.image && !l.action && !last.image && !last.action && last.level === l.level && last.text === l.text && last.source === l.source) {
      last.count++; last.ts = l.ts;
      if (last.node) { const c = last.node.querySelector('.st-runtime-cnt'); if (c) { c.textContent = String(last.count); c.hidden = false; } }
    } else {
      CON.lines.push(l);
      if (CON.lines.length > MAX_LINES) { const old = CON.lines.splice(0, CON.lines.length - MAX_LINES); for (const o of old) { o.dead = true; if (o.node) o.node.remove(); } }
      CON.pending.push(l);
      if (!CON.raf) CON.raf = requestAnimationFrame(flushLines);
    }
    if (level === 'error' && !(S.ui.panel() === 'console' && !document.body.classList.contains('st-panel-hidden'))) { CON.unseen++; S.ui.setPanelBadge('console', String(CON.unseen)); }
  }
  function flushLines() {
    CON.raf = 0;
    if (!CON.list) { CON.pending = []; return; }
    const atBottom = CON.list.scrollHeight - CON.list.scrollTop - CON.list.clientHeight < 40;
    const frag = document.createDocumentFragment();
    for (const l of CON.pending) if (!l.dead && matches(l)) frag.appendChild(lineNode(l));
    CON.pending = [];
    CON.list.appendChild(frag);
    paintEmpty();
    if (atBottom) CON.list.scrollTop = CON.list.scrollHeight;
  }
  function rerender() {
    if (!CON.list) return;
    CON.list.textContent = '';
    const frag = document.createDocumentFragment();
    for (const l of CON.lines) { l.node = null; if (matches(l)) frag.appendChild(lineNode(l)); }
    CON.list.appendChild(frag);
    CON.pending = [];
    paintEmpty();
    CON.list.scrollTop = CON.list.scrollHeight;
  }
  function paintEmpty() {
    if (!CON.root) return;
    const empty = CON.root.querySelector('.st-runtime-conempty');
    if (empty) empty.hidden = CON.lines.length > 0;
  }
  function clearConsole(sources) {
    if (Array.isArray(sources)) CON.lines = CON.lines.filter((l) => { if (sources.includes(l.source)) { l.dead = true; if (l.node) l.node.remove(); return false; } return true; });
    else { for (const l of CON.lines) l.dead = true; CON.lines = []; if (CON.list) CON.list.textContent = ''; }
    CON.unseen = 0; S.ui.setPanelBadge('console', '');
    paintEmpty();
  }
  function replTarget() {
    if (CON.mode !== 'auto') return CON.mode;
    if (PV.frame && isPreviewVisible()) return 'preview';
    if (LAST_KIND === 'python') return 'python';
    return 'js';
  }
  function paintRepl() {
    if (!CON.root) return;
    const inp = CON.root.querySelector('.st-runtime-replin');
    const t = replTarget();
    if (!inp) return;
    inp.placeholder = t === 'preview' ? 'JavaScript in the preview page…' : t === 'python' ? 'Python expression or statement…' : 'JavaScript expression…';
    inp.title = t === 'preview' ? 'Evaluated inside the running preview (sandboxed)' : t === 'python' ? 'Runs in the namespace of the last Python program' : 'Runs in a fresh sandboxed worker';
  }
  async function evaluate(code, target) {
    code = String(code || '').trim(); if (!code) return;
    if (!S.projects.current()) { S.ui.toast('Open a project first.', 'warn'); return; }
    target = target || replTarget();
    if (target === 'preview') {
      if (!PV.frame || !PV.frame.contentWindow) { line('warn', 'The preview is not running — open it first (👁 Preview).', 'preview'); return; }
      line('system', '› ' + code, 'preview');
      const id = 'e' + U.uid(4);
      CON.evals.set(id, true);
      PV.frame.contentWindow.postMessage({ __ost: 'eval', id, code }, '*');
      setTimeout(() => { if (CON.evals.delete(id)) line('warn', 'No answer from the preview (is it busy or still loading?).', 'preview'); }, 5000);
      return;
    }
    return startRun(target === 'python' ? 'python' : 'js', '<console>', { repl: true, code, timeoutMs: UI_TIMEOUT, ui: false });
  }
  function buildConsole(body) {
    body.classList.add('st-runtime-conpanel');
    body.innerHTML =
      '<div class="st-runtime-con">' +
      '<div class="st-runtime-conbar">' +
      '<input class="st-input st-runtime-filter" type="search" placeholder="Filter" aria-label="Filter console output" spellcheck="false">' +
      '<select class="st-runtime-sel st-runtime-level" aria-label="Log levels"><option value="all">All levels</option><option value="error">Errors</option><option value="warn">Warnings + errors</option><option value="log">Logs only</option></select>' +
      '<label class="st-runtime-chk" title="Show timestamps"><input type="checkbox" class="st-runtime-tsbox"> Time</label>' +
      '<label class="st-runtime-chk" title="Keep preview output when the preview reloads"><input type="checkbox" class="st-runtime-preserve"> Preserve</label>' +
      '<span class="st-sp"></span>' +
      '<button class="st-btn st-runtime-stop" type="button" hidden title="Stop running code">■ Stop</button>' +
      '<button class="st-ib st-runtime-clear" type="button" title="Clear console" aria-label="Clear console">⌫</button>' +
      '</div>' +
      '<div class="st-runtime-conlist" role="log" aria-live="off"></div>' +
      '<div class="st-runtime-conempty st-empty">Console output from the preview and from <b>▶ Run</b> appears here. Code runs in a sandbox in your browser — there is no server-side execution.</div>' +
      '<form class="st-runtime-repl" autocomplete="off"><select class="st-runtime-sel st-runtime-mode" aria-label="Evaluate in"><option value="auto">Auto</option><option value="preview">Preview</option><option value="js">JS</option><option value="python">Python</option></select><span class="st-runtime-prompt">›</span><input class="st-runtime-replin" spellcheck="false" autocapitalize="off" aria-label="Evaluate"></form>' +
      '</div>';
    CON.root = body.firstElementChild;
    CON.list = body.querySelector('.st-runtime-conlist');
    const $ = (s) => body.querySelector(s);
    const f = $('.st-runtime-filter');
    let ft = 0;
    f.addEventListener('input', () => { clearTimeout(ft); ft = setTimeout(() => { CON.filter = f.value.trim().toLowerCase(); rerender(); }, 120); });
    $('.st-runtime-level').addEventListener('change', (e) => { CON.level = e.target.value; rerender(); });
    const ts = $('.st-runtime-tsbox'); ts.checked = CON.ts; ts.addEventListener('change', () => { CON.ts = ts.checked; S.settings.set('console.ts', CON.ts); rerender(); });
    const pr = $('.st-runtime-preserve'); pr.checked = CON.preserve; pr.addEventListener('change', () => { CON.preserve = pr.checked; S.settings.set('console.preserve', CON.preserve); });
    $('.st-runtime-clear').addEventListener('click', () => clearConsole());
    $('.st-runtime-stop').addEventListener('click', () => stop());
    const mode = $('.st-runtime-mode'); mode.addEventListener('change', () => { CON.mode = mode.value; paintRepl(); });
    const inp = $('.st-runtime-replin');
    $('.st-runtime-repl').addEventListener('submit', (e) => {
      e.preventDefault();
      const code = inp.value; if (!code.trim()) return;
      CON.hist.push(code); if (CON.hist.length > 100) CON.hist.shift(); CON.hidx = CON.hist.length;
      inp.value = '';
      evaluate(code).catch((err) => line('error', err.message || String(err), 'run'));
    });
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowUp' && CON.hist.length) { CON.hidx = Math.max(0, CON.hidx - 1); inp.value = CON.hist[CON.hidx] || ''; e.preventDefault(); }
      else if (e.key === 'ArrowDown' && CON.hist.length) { CON.hidx = Math.min(CON.hist.length, CON.hidx + 1); inp.value = CON.hist[CON.hidx] || ''; e.preventDefault(); }
    });
    inp.addEventListener('focus', paintRepl);
    paintRepl();
    rerender();
  }

  /* ======================================================================
   * Problems panel
   * ==================================================================== */
  const PROB = new Map(); let PROB_EL = null; let marked = new Set();
  function allProblems() { const out = []; for (const l of PROB.values()) out.push(...l); return out; }
  function setProblems(source, list) {
    const clean = (list || []).filter(Boolean).map((p) => ({ path: p.path || '', line: p.line || 0, col: p.col || 0, text: String(p.text || ''), severity: p.severity === 'warning' ? 'warning' : 'error', source: p.source || source }));
    const prev = JSON.stringify(PROB.get(source) || []);
    if (!clean.length) PROB.delete(source); else PROB.set(source, clean);
    if (prev === JSON.stringify(clean)) return;
    renderProblems(); applyMarkers();
  }
  function applyMarkers() {
    const ed = S.editor; if (!ed || typeof ed.setMarkers !== 'function') return;
    const by = new Map();
    for (const p of allProblems()) {
      if (!p.path || !S.fs.exists(p.path)) continue;
      if (!by.has(p.path)) by.set(p.path, []);
      const ln = Math.max(1, p.line || 1), col = Math.max(1, p.col || 1);
      by.get(p.path).push({ line: ln, col, text: p.text, message: p.text, severity: p.severity, source: p.source });
    }
    for (const p of marked) if (!by.has(p)) { try { ed.setMarkers(p, [], 'runtime'); } catch (_) {} }
    for (const [p, ms] of by) { try { ed.setMarkers(p, ms, 'runtime'); } catch (_) {} }
    marked = new Set(by.keys());
  }
  function renderProblems() {
    const list = allProblems();
    const errs = list.filter((p) => p.severity === 'error').length;
    S.ui.setPanelBadge('problems', list.length ? String(list.length) : '');
    if (!PROB_EL) return;
    PROB_EL.textContent = '';
    if (!list.length) { PROB_EL.appendChild(el('div', 'st-empty', 'No problems detected in the last build or run.')); return; }
    PROB_EL.appendChild(el('div', 'st-runtime-probsum', errs + ' error' + (errs === 1 ? '' : 's') + ', ' + (list.length - errs) + ' warning' + (list.length - errs === 1 ? '' : 's')));
    const groups = new Map();
    for (const p of list) { const k = p.path || '(project)'; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(p); }
    for (const [path, items] of groups) {
      const g = el('div', 'st-runtime-probgrp');
      const h = el('div', 'st-runtime-probfile'); h.appendChild(el('b', '', path)); h.appendChild(el('span', 'st-runtime-probn', String(items.length)));
      g.appendChild(h);
      for (const p of items) {
        const b = el('button', 'st-runtime-prob ' + (p.severity === 'error' ? 'is-err' : 'is-warn'));
        b.type = 'button';
        b.appendChild(el('span', 'st-runtime-probico', p.severity === 'error' ? '✕' : '⚠'));
        b.appendChild(el('span', 'st-runtime-probtxt', p.text));
        b.appendChild(el('span', 'st-runtime-probloc', (p.line ? '[' + p.line + (p.col ? ':' + p.col : '') + '] ' : '') + p.source));
        if (p.path && S.fs.exists(p.path)) b.onclick = () => reveal({ path: p.path, line: p.line || 1, col: p.col || 1 });
        else b.disabled = true;
        g.appendChild(b);
      }
      PROB_EL.appendChild(g);
    }
  }

  /* ======================================================================
   * Preview pane
   * ==================================================================== */
  const PV = { frame: null, gen: 0, page: 'index.html', history: [], stale: true, auto: S.settings.get('preview.auto', true) !== false, vp: VIEWPORTS[S.settings.get('preview.viewport', 'responsive')] !== undefined ? S.settings.get('preview.viewport', 'responsive') : 'responsive', storage: new Map(), stage: null, dev: null, msg: null, overlay: null, stat: null, pageBtn: null, backBtn: null, cssLinked: new Map(), pid: '', building: null, again: false, lastErrors: [], loaded: false };
  // ---- crash sentinel ----
  // Sandboxed srcdoc frames share the Studio's main thread on Safari/iOS, Firefox and Android, so an infinite
  // loop in the preview freezes the whole tab. A key is set while a preview/agent-check page is starting
  // (until ~3 s after it loaded); if the tab dies in that window, the next visit does not auto-run that preview.
  const PV_SESSION = U.uid(4), ARMED = new Set();
  function writeArm() { try { localStorage.setItem(PV_ARM_KEY, JSON.stringify({ pid: projectId(), at: Date.now(), s: PV_SESSION })); } catch (_) {} }
  function pvArm(holder) { ARMED.add(holder); writeArm(); }
  function pvDisarm(holder) {
    if (holder === undefined) ARMED.clear(); else ARMED.delete(holder);
    if (!ARMED.size) { try { const v = JSON.parse(localStorage.getItem(PV_ARM_KEY) || 'null'); if (v && v.s === PV_SESSION) localStorage.removeItem(PV_ARM_KEY); } catch (_) {} }
  }
  function pvFroze(pid) {                              // set by an earlier visit that never got to disarm it
    try { const v = JSON.parse(localStorage.getItem(PV_ARM_KEY) || 'null'); return !!(v && v.s !== PV_SESSION && v.pid === pid && Date.now() - v.at < 7 * 864e5); } catch (_) { return false; }
  }
  function pvForgetFreeze() { try { localStorage.removeItem(PV_ARM_KEY); } catch (_) {} if (ARMED.size) writeArm(); }
  window.addEventListener('pagehide', () => pvDisarm());
  function buildPreviewUi() {
    const bar = S.ui.previewBar(), host = S.ui.previewEl();
    if (!bar || !host) return;
    bar.innerHTML =
      '<div class="st-runtime-pvbar">' +
      '<button class="st-ib" type="button" data-pv="back" title="Back" aria-label="Back" hidden>←</button>' +
      '<button class="st-ib" type="button" data-pv="refresh" title="Refresh preview (Ctrl/Cmd+Alt+R)" aria-label="Refresh preview">⟳</button>' +
      '<button class="st-runtime-page" type="button" data-pv="page" title="Choose page">/index.html</button>' +
      '<span class="st-runtime-pvstat" data-pv="stat" role="status"></span>' +
      '<span class="st-sp"></span>' +
      '<label class="st-runtime-chk" title="Rebuild automatically 0.6 s after you edit a file"><input type="checkbox" data-pv="auto"> Auto</label>' +
      '<select class="st-runtime-sel" data-pv="vp" aria-label="Viewport"><option value="responsive">Responsive</option><option value="phone">Phone 390×844</option><option value="tablet">Tablet 768×1024</option></select>' +
      '<button class="st-ib" type="button" data-pv="newtab" title="Open preview in a new tab (sandboxed)" aria-label="Open in new tab">↗</button>' +
      '<button class="st-ib" type="button" data-pv="close" title="Close preview" aria-label="Close preview">✕</button>' +
      '</div>';
    host.innerHTML = '<div class="st-runtime-stage"><div class="st-runtime-dev"></div><div class="st-runtime-pvmsg" hidden></div><div class="st-runtime-overlay" hidden></div></div>';
    PV.stage = host.firstElementChild;
    PV.dev = PV.stage.querySelector('.st-runtime-dev');
    PV.msg = PV.stage.querySelector('.st-runtime-pvmsg');
    PV.overlay = PV.stage.querySelector('.st-runtime-overlay');
    const q = (k) => bar.querySelector('[data-pv="' + k + '"]');
    PV.stat = q('stat'); PV.pageBtn = q('page'); PV.backBtn = q('back');
    q('refresh').onclick = () => { PV.manual = true; if (!isPreviewVisible()) S.ui.togglePreview(true); refresh(true); };
    q('back').onclick = () => { const p = PV.history.pop(); if (p) { PV.page = p; PV.stale = true; refresh(true); } };
    q('page').onclick = async () => {
      const pages = S.fs.list().map((f) => f.path).filter((p) => /\.html?$/i.test(p));
      if (!pages.length) return;
      const v = await S.ui.select('Preview page', pages.map((p) => ({ value: p, label: '/' + p })));
      if (v) { PV.history.push(PV.page); PV.page = v; PV.stale = true; refresh(true); }
    };
    const auto = q('auto'); auto.checked = PV.auto; auto.onchange = () => { PV.auto = auto.checked; S.settings.set('preview.auto', PV.auto); if (PV.auto && PV.stale) schedule(); };
    const vp = q('vp'); vp.value = PV.vp; vp.onchange = () => { PV.vp = vp.value; S.settings.set('preview.viewport', PV.vp); fitDevice(); };
    q('newtab').onclick = () => openInNewTab().catch((e) => S.ui.toast(e.message || String(e), 'err'));
    q('close').onclick = () => S.ui.togglePreview(false);
    PV.stat.onclick = () => { if (PV.lastErrors.length) S.ui.showPanel('problems'); };
    if (window.ResizeObserver) new ResizeObserver(() => fitDevice()).observe(host);
    fitDevice();
    pvMessage(S.projects.current() ? '' : 'Open a project to preview it.');
  }
  function pvStatus(state, text, title) {
    if (!PV.stat) return;
    PV.stat.className = 'st-runtime-pvstat is-' + state;
    PV.stat.textContent = text || '';
    PV.stat.title = title || text || '';
  }
  function pvMessage(text) {
    if (!PV.msg) return;
    PV.msg.hidden = !text;
    PV.msg.textContent = text || '';
  }
  function paintPageBtn(none) {
    if (PV.pageBtn) { PV.pageBtn.hidden = !!none; PV.pageBtn.textContent = '/' + (PV.page || 'index.html'); PV.pageBtn.title = 'Page: /' + PV.page + ' — click to choose another'; }
    if (PV.backBtn) PV.backBtn.hidden = !PV.history.length;
  }
  function fitDevice() {
    if (!PV.stage || !PV.dev) return;
    const size = S.ui.isMobile() ? null : VIEWPORTS[PV.vp];   // on a phone the screen is the device
    PV.stage.classList.toggle('is-device', !!size);
    if (!size) { PV.dev.style.width = PV.dev.style.height = PV.dev.style.transform = ''; return; }
    const W = PV.stage.clientWidth || 1, H = PV.stage.clientHeight || 1;
    const scale = Math.min(1, (W - 24) / size[0], (H - 24) / size[1]);
    PV.dev.style.width = size[0] + 'px'; PV.dev.style.height = size[1] + 'px';
    PV.dev.style.transform = 'translateX(-50%) scale(' + Math.max(0.1, scale).toFixed(4) + ')';
  }
  function showOverlay(errors) {
    if (!PV.overlay) return;
    PV.overlay.textContent = '';
    PV.overlay.hidden = !errors.length;
    if (!errors.length) return;
    const head = el('div', 'st-runtime-ovhead');
    head.appendChild(el('b', '', 'Build failed — ' + errors.length + ' error' + (errors.length > 1 ? 's' : '')));
    const x = el('button', 'st-ib', '✕'); x.type = 'button'; x.title = 'Dismiss'; x.onclick = () => { PV.overlay.hidden = true; };
    head.appendChild(x);
    PV.overlay.appendChild(head);
    for (const e of errors.slice(0, 8)) {
      const b = el('button', 'st-runtime-overr'); b.type = 'button';
      b.appendChild(el('span', 'st-runtime-overloc', e.path ? e.path + (e.line ? ':' + e.line + ':' + e.col : '') : ''));
      b.appendChild(el('span', '', e.text));
      if (e.path && S.fs.exists(e.path)) b.onclick = () => reveal({ path: e.path, line: e.line || 1, col: e.col || 1 }); else b.disabled = true;
      PV.overlay.appendChild(b);
    }
  }
  function unmountPreview() {
    if (PV.frame) { PV.frame.remove(); PV.frame = null; }
    PV.loaded = false;
    clearTimeout(PV.armT); pvDisarm('pv');
    paintRepl();
  }
  function mount(html, gen) {
    unmountPreview();
    const f = document.createElement('iframe');
    f.setAttribute('sandbox', PREVIEW_SANDBOX);
    f.setAttribute('allow', 'clipboard-write');
    f.setAttribute('referrerpolicy', 'no-referrer');
    f.setAttribute('title', 'Preview of /' + PV.page);
    f.className = 'st-runtime-frame';
    f.srcdoc = html;
    PV.frame = f; PV.frameGen = gen;
    pvArm('pv');                                       // disarmed ~3 s after the page reports 'ready'
    PV.dev.appendChild(f);
    pvMessage('');
    paintRepl();
  }
  // manual = the user (or the agent) asked for this run — it may start a preview that froze the tab last time
  function refresh(manual) {
    if (manual) PV.manual = true;
    if (PV.building) { if (PV.stale || (manual && (pvFroze(projectId()) || (S.projects.current() || {}).fromLink))) PV.again = true; return PV.building; }   // nothing changed since this build began → reuse it
    PV.building = (async () => {
      try { do { PV.again = false; await doRefresh(); } while (PV.again); }
      catch (e) { pvStatus('err', '✕ ' + (e.message || e)); line('error', 'Preview failed: ' + (e && e.message || e), 'build'); }
      finally { PV.building = null; }
    })();
    return PV.building;
  }
  async function doRefresh() {
    if (!PV.stage) buildPreviewUi();
    const proj = S.projects.current();
    if (!proj) { unmountPreview(); pvMessage('Open a project to preview it.'); pvStatus('idle', ''); return; }
    if (!isPreviewVisible()) { PV.stale = true; return; }
    const htmls = S.fs.list().map((f) => f.path).filter((p) => /\.html?$/i.test(p));
    let page = PV.page && S.fs.exists(PV.page) ? PV.page : (S.fs.exists('index.html') ? 'index.html' : htmls[0]);
    if (!page) {
      unmountPreview(); showOverlay([]); setProblems('preview', []); paintPageBtn(true);
      const k = U.projectKind();
      pvMessage(k === 'python' || k === 'node' ? 'This project has no index.html. Press ▶ Run to execute ' + U.entryFor(k) + ' — its output appears in the Console.' : 'Add an index.html to preview a web page.');
      pvStatus('idle', '');
      PV.stale = false;
      return;
    }
    PV.page = page; paintPageBtn();
    const manual = PV.manual; PV.manual = false;
    if (manual) PV.linkOk = proj;                       // the user chose to run this project's code
    if (proj.fromLink && PV.linkOk !== proj) {          // imported from a #new= link and not run or edited yet
      unmountPreview(); showOverlay([]);
      pvMessage('This project was opened from a link, so its code has not run yet. Look through the files first, then press ⟳ (or ▶ Run) to start the preview.');
      pvStatus('idle', '⏸ Not run yet', 'Press ⟳ to run the preview');
      PV.stale = true;
      return;
    }
    if (pvFroze(proj.id)) {
      if (!manual) {
        unmountPreview(); showOverlay([]);
        pvMessage('Preview paused — the last time this project’s preview ran, the tab froze or crashed (an endless loop?), so it was not started again automatically. Fix the code, then press ⟳ to run it.');
        pvStatus('err', '⏸ Paused', 'Press ⟳ to run the preview');
        PV.stale = true;
        return;
      }
      pvForgetFreeze();
    }
    PV.stale = false;                                   // edits from here on mark it stale again → one more build
    const gen = ++PV.gen;
    pvStatus('busy', esbReady || !esbP ? '⟳ Building…' : '⟳ Loading bundler…');
    const hash = PV.pendingHash || ''; PV.pendingHash = '';
    const r = await buildPreviewHtml(page, { gen, hash });
    if (gen !== PV.gen) return;
    PV.cssLinked = r.cssLinked || new Map();
    PV.lastErrors = r.errors;
    setProblems('preview', r.errors.concat(r.warnings));
    if (r.ok) setProblems('deploy', []);
    LAST_BUILD = { mode: 'preview', ok: r.ok, errors: r.errors, warnings: r.warnings, ms: r.ms, at: Date.now(), bytes: r.html ? r.html.length : 0, page };
    S.bus.emit('build:done', { ok: r.ok, errors: r.errors, ms: r.ms, mode: 'preview' });
    if (!CON.preserve) clearConsole(['preview']);
    if (r.html && isPreviewVisible()) mount(r.html, gen);
    showOverlay(r.errors);
    if (r.ok) pvStatus('ok', '✓ ' + fmtMs(r.ms), 'Built /' + page + ' in ' + fmtMs(r.ms) + ' · ' + U.fmtBytes(r.html.length) + (r.warnings.length ? ' · ' + r.warnings.length + ' warning(s)' : ''));
    else pvStatus('err', '✕ ' + r.errors.length + ' error' + (r.errors.length > 1 ? 's' : ''), 'Click to open Problems');
  }
  let autoT = 0;
  function schedule() { clearTimeout(autoT); autoT = setTimeout(() => { autoT = 0; refresh(); }, 600); }
  function onFsChange(e) {
    PV.stale = true;
    if (!PV.auto || !isPreviewVisible() || !S.projects.current()) return;
    if (e && e.kind === 'write' && /\.css$/i.test(e.path || '') && PV.frame && !autoT && !PV.building) {
      const hits = [...PV.cssLinked.entries()].filter(([, inc]) => inc.has(e.path));
      if (hits.length) {
        for (const [p] of hits) { const inc = new Set(); const css = processCss(p, [], inc, 0, new Set(), mkCtx('preview')); PV.cssLinked.set(p, inc); PV.frame.contentWindow.postMessage({ __ost: 'css', path: p, text: css }, '*'); }
        return;                                      // CSS hot-swapped; page state kept (next full build happens on demand)
      }
    }
    schedule();
  }
  function navigate(path, hash) {
    let p = U.normPath(path || '') || 'index.html';
    if (!S.fs.exists(p)) {
      if (S.fs.exists(p + '/index.html')) p += '/index.html';
      else if (S.fs.exists(p + '.html')) p += '.html';
      else if (p.endsWith('/index.html') && S.fs.exists(p.slice(0, -11) + '.html')) p = p.slice(0, -11) + '.html';
      else { line('warn', 'Link to "/' + p + '" — there is no such page in the project.', 'preview'); return; }
    }
    if (!/\.html?$/i.test(p)) { line('info', 'Link to /' + p + ' — non-HTML files open normally once the app is deployed.', 'preview'); return; }
    PV.history.push(PV.page); PV.page = p; PV.pendingHash = hash || ''; PV.stale = true;
    refresh();
  }
  function onPreviewMsg(d) {
    if (!d || typeof d !== 'object' || d.gen !== PV.frameGen) return;
    switch (d.__ost) {
      case 'lines':
        if (!Array.isArray(d.lines)) return;
        for (const l of d.lines.slice(0, admit('preview', Math.min(500, d.lines.length)))) {
          if (!l || typeof l !== 'object') continue;
          const m = mapText(String(l.text == null ? '' : l.text).slice(0, 20000), l);
          line(LEVELS.has(l.level) ? l.level : 'log', m.text, 'preview', m.loc ? { loc: m.loc } : null);
        }
        break;
      case 'clear': clearConsole(); break;
      case 'nav': if (typeof d.path === 'string') navigate(d.path, typeof d.hash === 'string' ? d.hash.slice(0, 200) : ''); break;
      case 'storage': {
        if (!d.data || typeof d.data !== 'object') return;
        let size = 0; const o = {};
        for (const k of Object.keys(d.data)) { const v = String(d.data[k]); size += k.length + v.length; o[String(k)] = v; }
        if (size > 2 * 1024 * 1024) { line('warn', 'The preview’s localStorage is over 2 MB — it is not kept between reloads.', 'preview'); return; }
        PV.storage.set(projectId(), o);
        break;
      }
      case 'eval': if (CON.evals.delete(String(d.id))) line(d.ok ? 'log' : 'error', '← ' + String(d.text == null ? '' : d.text).slice(0, 20000), 'preview'); break;
      case 'ready': PV.loaded = true; clearTimeout(PV.armT); PV.armT = setTimeout(() => { if (PV.frame) pvDisarm('pv'); }, 3000); break;
    }
  }
  async function preview(force, page) {
    if (!S.projects.current()) { S.ui.toast('Open a project first.', 'warn'); return; }
    PV.manual = true;                                   // an explicit request (Run, 👁, commands, the agent)
    try {
      if (page && S.fs.exists(page) && page !== PV.page) { PV.history.push(PV.page); PV.page = page; PV.stale = true; force = true; }
      if (!isPreviewVisible()) {
        S.ui.togglePreview(true);                       // → 'preview:toggle' starts a fresh build
        if (PV.building) { await PV.building; return; }
      }
      if (force || !PV.frame || PV.stale) await refresh(true);
      else if (PV.building) await PV.building;
    } finally { PV.manual = false; }
  }
  async function openInNewTab() {
    if (!S.projects.current()) { S.ui.toast('Open a project first.', 'warn'); return; }
    const start = PV.page && S.fs.exists(PV.page) ? PV.page : 'index.html';
    if (!S.fs.exists(start)) { S.ui.toast('Add an index.html to open a preview.', 'warn'); return; }
    // Open the tab NOW, while the click still counts as a user gesture — after the (possibly first-time,
    // bundler-loading) build the popup blocker would drop it silently.
    let w = null;
    try { w = window.open('', '_blank'); if (w) { w.opener = null; w.document.title = 'Building preview…'; if (w.document.body) w.document.body.textContent = 'Building the preview…'; } } catch (_) {}
    const pages = S.fs.list().map((f) => f.path).filter((p) => /\.html?$/i.test(p)).slice(0, 20);
    if (!pages.includes(start)) pages.unshift(start);
    const built = {};
    let failed = 0;
    try { for (const p of pages) { const r = await buildPreviewHtml(p, { gen: -3 }); if (r.html) built[p] = r.html; if (!r.ok && p === start) failed = r.errors.length; } }
    catch (e) { if (w) try { w.close(); } catch (_) {} throw e; }
    if (!built[start]) { if (w) try { w.close(); } catch (_) {} S.ui.toast('Build failed — see Problems.', 'err'); return; }
    if (failed) S.ui.toast('Opened with ' + failed + ' build error(s) — see Problems.', 'warn');
    const name = (S.projects.current().name || 'app');
    // This wrapper runs on the studio origin (blob:), so it contains ONLY our code: a sandboxed iframe
    // whose srcdoc is the built page, plus link navigation between the project's pages.
    const wrapper = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + U.esc(name) + ' · OST Studio preview</title>' +
      '<style>html,body{margin:0;height:100%;background:#fff}iframe{display:block;border:0;width:100%;height:100%}</style></head><body>' +
      '<iframe sandbox="' + PREVIEW_SANDBOX + '" allow="clipboard-write" referrerpolicy="no-referrer" title="Preview"></iframe>' +
      '<script>(function(){var P=' + jsonForScript(built) + ',f=document.querySelector("iframe");' +
      'function has(k){return Object.prototype.hasOwnProperty.call(P,k)&&typeof P[k]==="string";}' +
      'addEventListener("message",function(e){if(e.source!==f.contentWindow)return;var d=e.data;if(!d||d.__ost!=="nav"||typeof d.path!=="string")return;var p=d.path;if(!has(p)&&has(p+"/index.html"))p+="/index.html";if(!has(p)&&has(p+".html"))p+=".html";if(has(p))f.srcdoc=P[p];});' +
      'f.srcdoc=P[' + jsonForScript(start) + '];})();<\/script></body></html>';
    const url = URL.createObjectURL(new Blob([wrapper], { type: 'text/html' }));
    let opened = false;
    try { if (w && !w.closed) { w.location.replace(url); opened = true; } } catch (_) {}
    if (!opened) { try { const w2 = window.open(url, '_blank'); if (w2) { w2.opener = null; opened = true; } } catch (_) {} }
    if (!opened) S.ui.toast('Your browser blocked the new tab — allow pop-ups for this site, then try again.', 'warn');
    setTimeout(() => URL.revokeObjectURL(url), 120000);
  }

  /* ======================================================================
   * build() API
   * ==================================================================== */
  async function build(o) {
    const mode = (o && o.mode) || 'preview';
    if (mode === 'deploy') return buildDeploy();
    const page = (o && o.page) || 'index.html';
    if (!S.projects.current() || !S.fs.exists(page)) return { ok: false, errors: [{ path: '', line: 0, col: 0, text: 'No ' + page + ' in this project.', severity: 'error' }], warnings: [], files: {}, entry: page, ms: 0 };
    const r = await buildPreviewHtml(page, { gen: -4 });
    LAST_BUILD = { mode: 'preview', ok: r.ok, errors: r.errors, warnings: r.warnings, ms: r.ms, at: Date.now(), bytes: r.html ? r.html.length : 0, page };
    S.bus.emit('build:done', { ok: r.ok, errors: r.errors, ms: r.ms, mode: 'preview' });
    return { ok: r.ok, errors: r.errors, warnings: r.warnings, files: r.html ? { [page]: r.html } : {}, entry: page, ms: r.ms };
  }

  /* ======================================================================
   * running indicator
   * ==================================================================== */
  function paintRunning() {
    const j = CUR_UI && !CUR_UI.done ? CUR_UI : [...RUNS.values()][0];
    S.ui.setStatus('run', j ? '◼ Stop ' + (j.path === '<console>' ? 'console' : U.baseOf(j.path)) : '', { side: 'left', order: 30, title: j ? 'Running ' + j.path + ' — click to stop' : '', onClick: j ? () => stop() : undefined });
    if (CON.root) { const b = CON.root.querySelector('.st-runtime-stop'); if (b) b.hidden = !RUNS.size; }
    paintRepl();
  }

  /* ======================================================================
   * wiring
   * ==================================================================== */
  window.addEventListener('message', (e) => {
    const src = e.source; if (!src) return;
    if (R.frame && src === R.frame.contentWindow) { onRunnerMsg(e.data); return; }
    if (PV.frame && src === PV.frame.contentWindow) { onPreviewMsg(e.data); return; }
    for (const c of CAPTURES) if (c.frame.contentWindow === src) { c.onMsg(e.data); return; }
  });
  S.bus.on('console', addLine);
  S.bus.on('fs:change', onFsChange);
  S.bus.on('fs:bulk', (e) => { if (e && (e.source === 'open' || e.source === 'template')) return; onFsChange(null); });   // project:open already marked + rebuilt it
  S.bus.on('layout', fitDevice);
  S.bus.on('panel', (e) => { if (e && e.id === 'console') { CON.unseen = 0; S.ui.setPanelBadge('console', ''); } });
  S.bus.on('preview:toggle', (e) => {
    if (!PV.autoToggle && !S.ui.isMobile() && S.projects.current()) S.settings.set('preview.visible', !!(e && e.on));   // the user's desktop preference
    if (e && e.on) { if (!PV.stage) buildPreviewUi(); fitDevice(); if (!PV.frame || PV.stale) refresh(); }
    else { unmountPreview(); PV.stale = true; }
  });
  S.bus.on('project:open', (e) => {
    const proj = e && e.project, id = proj && proj.id;
    if (id && id === PV.pid) return;                  // rename re-emits project:open
    if (proj && proj === PV.meta && PV.pid) {          // same project, id re-assigned by the cloud: re-key, keep the preview
      const st = PV.storage.get(PV.pid); if (st) { PV.storage.delete(PV.pid); PV.storage.set(id, st); }
      PV.pid = id; if (ARMED.size) writeArm();
      return;
    }
    PV.meta = proj || null; PV.linkOk = null;
    PV.pid = id || '';
    PV.page = 'index.html'; PV.history = []; PV.cssLinked = new Map(); paintPageBtn();
    PROB.clear(); renderProblems(); applyMarkers();
    for (const j of [...RUNS.values()]) if (!j.capture) stopJob(j, 'stopped');
    PV.stale = true;
    const k = U.projectKind();
    const web = k === 'web' || k === 'react' || k === 'static';
    const autoToggle = (on) => { PV.autoToggle = true; try { S.ui.togglePreview(on); } finally { PV.autoToggle = false; } };
    // a project imported from a link never starts its own preview — the user presses Run/Preview first
    if (web && !(proj && proj.fromLink) && !isPreviewVisible() && !S.ui.isMobile() && S.settings.get('preview.visible', true) !== false) { autoToggle(true); return; }   // → toggle handler builds
    if (!web && isPreviewVisible() && !S.ui.isMobile()) { autoToggle(false); return; }                                                   // nothing to preview
    if (isPreviewVisible()) refresh(); else unmountPreview();
  });
  S.bus.on('project:close', () => { PV.pid = ''; PV.meta = null; PV.linkOk = null; unmountPreview(); pvMessage('Open a project to preview it.'); pvStatus('idle', ''); showOverlay([]); PROB.clear(); renderProblems(); applyMarkers(); for (const j of [...RUNS.values()]) stopJob(j, 'stopped'); });

  buildConsole(S.ui.registerPanel({ id: 'console', title: 'Console', order: 20 }));
  PROB_EL = S.ui.registerPanel({ id: 'problems', title: 'Problems', order: 30 });
  PROB_EL.classList.add('st-runtime-problems');
  renderProblems();
  buildPreviewUi();
  S.ui.registerAction({ id: 'run', icon: '▶', label: 'Run', title: 'Run (Ctrl/Cmd+Enter)', order: 10, primary: true, run: () => run() });
  S.ui.registerAction({ id: 'preview', icon: '👁', label: 'Preview', title: 'Show or hide the live preview', order: 20, run: () => (isPreviewVisible() ? S.ui.togglePreview(false) : preview()) });
  S.ui.registerCommand({ id: 'run', title: 'Run', key: 'Mod+Enter', run: () => run() });
  S.ui.registerCommand({ id: 'run.file', title: 'Run active file', run: () => { const a = activeFile(); if (!a) { S.ui.toast('Open a file first.', 'warn'); return; } return run(a); } });
  S.ui.registerCommand({ id: 'run.stop', title: 'Stop running code', key: 'Mod+Shift+X', run: () => stop() });
  S.ui.registerCommand({ id: 'preview.refresh', title: 'Refresh preview', key: 'Mod+Alt+R', run: () => preview(true) });
  S.ui.registerCommand({ id: 'preview.open', title: 'Show preview', run: () => preview() });
  S.ui.registerCommand({ id: 'preview.newtab', title: 'Open preview in new tab', run: () => openInNewTab() });
  S.ui.registerCommand({ id: 'console.show', title: 'Show console', run: () => S.ui.showPanel('console') });
  S.ui.registerCommand({ id: 'console.clear', title: 'Clear console', run: () => clearConsole() });
  S.ui.registerCommand({ id: 'problems.show', title: 'Show problems', run: () => S.ui.showPanel('problems') });
  S.ui.registerCommand({ id: 'build.check', title: 'Check deploy build (dry run)', run: async () => {
    const r = await buildDeploy();
    if (!r.ok) { S.ui.showPanel('problems'); S.ui.toast('Deploy build failed — ' + r.errors.length + ' error(s).', 'err'); return; }
    const names = Object.keys(r.files);
    line('system', 'Deploy build OK in ' + fmtMs(r.ms) + ' — ' + names.length + ' files, ' + U.fmtBytes(names.reduce((n, p) => n + String(r.files[p]).length, 0)) + ':\n' + names.map((p) => '  ' + p + '  ' + U.fmtBytes(String(r.files[p]).length)).join('\n'), 'build');
    S.ui.showPanel('console');
  } });
  S.ui.registerCommand({ id: 'preview.clearStorage', title: 'Clear preview localStorage', run: () => { PV.storage.delete(projectId()); S.ui.toast('Preview storage cleared', 'ok'); if (PV.frame) refresh(); } });

  S.runtime = {
    run, stop, preview, refresh: () => preview(true), build, runCapture,
    lastBuild: () => LAST_BUILD, isRunning: () => RUNS.size > 0, openInNewTab, clearConsole: () => clearConsole(), evaluate,
    previewPage: () => PV.page
  };
  S.bus.emit('runtime:ready', {});
})();

/* ==========================================================================
 * OST Studio · terminal — a real line-editing shell over the project files
 * --------------------------------------------------------------------------
 * Bottom panel "Terminal": xterm.js 5.5 (+ fit addon) themed like the shell,
 * with a DOM fallback when the CDN is unreachable and an input row for phones.
 * The shell ("ost-sh") is built in: virtual cwd, history per project, line
 * editing, tab completion, quoting, globs, pipes (|), redirection (> >> <),
 * ; && ||, and project commands (ls, cat, grep, mv, npm i, git clone, run,
 * build, deploy …). There is NO operating-system shell: commands work on the
 * project's virtual files, and code only runs in the runtime's sandboxes.
 * API: STUDIO.terminal = { exec(line) → Promise<{code, output}>, write(text),
 *      writeln(text), focus(), clear(), cwd(), commands() }
 * Contract: project-docs/ost-studio.md (module "terminal").
 * SECURITY: never executes user code; every user-derived string written to the
 * terminal goes through clean() (only SGR colours survive, other escape and C1
 * control sequences are neutralised), DOM fallback renders with textContent.
 * ========================================================================== */
(function () {
  'use strict';
  const S = window.STUDIO;
  if (!S || S.terminal) return;
  const U = S.util, bus = S.bus;

  /* ======================================================================
   * constants
   * ==================================================================== */
  const XTERM_JS = 'https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/lib/xterm.min.js';
  const XTERM_CSS = 'https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/css/xterm.min.css';
  const FIT_JS = 'https://cdn.jsdelivr.net/npm/@xterm/addon-fit@0.10.0/lib/addon-fit.min.js';
  const NPM_REGISTRY = 'https://registry.npmjs.org/';
  const GH_API = 'https://api.github.com';
  const GH_RAW = 'https://raw.githubusercontent.com';
  const HIST_KEY = 'ost.studio.term.hist.v1.';
  const HIST_MAX = 200;
  const OUT_CAP = 200000;
  const CLONE_MAX_FILES = 300, CLONE_MAX_BYTES = 10 * 1024 * 1024, CLONE_IMG_MAX = 512 * 1024;
  const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;
  const LOAD_TIMEOUT = 15000;

  /* ======================================================================
   * ANSI + text helpers
   * ==================================================================== */
  const A = {
    reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m', red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', blue: '\x1b[34m',
    magenta: '\x1b[35m', cyan: '\x1b[36m', gray: '\x1b[90m', bred: '\x1b[91m', bgreen: '\x1b[92m', byellow: '\x1b[93m',
    bblue: '\x1b[94m', bmagenta: '\x1b[95m', bcyan: '\x1b[96m'
  };
  const ANSI_RE = /\x1b\[[0-9;?]*[ -\/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?|\x1b[PX^_][^\x1b]*(?:\x1b\\)?|\x1b[()*+][A-Za-z0-9]|\x1b[ -~]/g;
  const stripAnsi = (s) => String(s == null ? '' : s).replace(ANSI_RE, '');
  // Untrusted text → safe for the terminal: SGR colours survive, every other escape/control is made visible.
  function clean(s) {
    return String(s == null ? '' : s).replace(/\r\n/g, '\n').replace(/\x1b\[[0-9;]{0,40}m|[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/g, (m) => {
      if (m.length > 1) return m;
      const k = m.charCodeAt(0);
      if (k === 0x1b) return '␛';
      if (k < 0x20) return String.fromCharCode(0x2400 + k);
      if (k === 0x7f) return '␡';
      return '�';
    });
  }
  const oneLine = (s) => clean(s).replace(/[\r\n]+/g, ' ');
  const plural = (n, w, pl) => n + ' ' + (n === 1 ? w : (pl || w + 's'));
  const fmtMs = (ms) => ms < 1000 ? Math.round(ms) + ' ms' : (ms / 1000).toFixed(ms < 10000 ? 1 : 0) + ' s';
  const enc = new TextEncoder();
  function byteSize(content) {
    const s = String(content == null ? '' : content);
    const m = /^data:[^,]*;base64,/.exec(s);
    if (m) return Math.floor((s.length - m[0].length) * 0.75);
    return enc.encode(s).length;
  }
  function lev(a, b) {
    if (Math.abs(a.length - b.length) > 3) return 9;
    const d = []; for (let i = 0; i <= a.length; i++) d[i] = [i];
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[a.length][b.length];
  }

  // Cell width of a code point (matches xterm's default Unicode 6 tables closely enough for line editing).
  function cpWidth(cp) {
    if (cp < 32 || (cp >= 0x7f && cp < 0xa0)) return 0;
    if ((cp >= 0x300 && cp <= 0x36f) || (cp >= 0x483 && cp <= 0x489) || (cp >= 0x591 && cp <= 0x5bd) || (cp >= 0x1ab0 && cp <= 0x1aff) || (cp >= 0x1dc0 && cp <= 0x1dff) ||
        (cp >= 0x200b && cp <= 0x200f) || (cp >= 0x20d0 && cp <= 0x20ff) || (cp >= 0xfe00 && cp <= 0xfe0f) || (cp >= 0xfe20 && cp <= 0xfe2f) || cp === 0xfeff) return 0;
    if (cp >= 0x1100 && (cp <= 0x115f || cp === 0x2329 || cp === 0x232a || (cp >= 0x2e80 && cp <= 0xa4cf && cp !== 0x303f) || (cp >= 0xac00 && cp <= 0xd7a3) ||
        (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xfe10 && cp <= 0xfe19) || (cp >= 0xfe30 && cp <= 0xfe6f) || (cp >= 0xff00 && cp <= 0xff60) || (cp >= 0xffe0 && cp <= 0xffe6) ||
        (cp >= 0x20000 && cp <= 0x2fffd) || (cp >= 0x30000 && cp <= 0x3fffd))) return 2;
    return 1;
  }
  function charWidth(ch) {
    const cp = ch.codePointAt(0);
    try { const us = T.term && T.term._core && T.term._core.unicodeService; if (us && typeof us.wcwidth === 'function') return us.wcwidth(cp); } catch (_) {}
    return cpWidth(cp);
  }
  function strWidth(s) { let w = 0; for (const ch of stripAnsi(s)) w += charWidth(ch); return w; }
  function padEnd(s, w) { const n = w - strWidth(s); return n > 0 ? s + ' '.repeat(n) : s; }
  function padStart(s, w) { const n = w - strWidth(s); return n > 0 ? ' '.repeat(n) + s : s; }
  function truncW(s, w) { if (strWidth(s) <= w) return s; let out = '', n = 0; for (const ch of s) { const k = charWidth(ch); if (n + k > w - 1) break; out += ch; n += k; } return out + '…'; }

  /* ======================================================================
   * virtual paths over STUDIO.fs (folders are implicit: a/b exists if a file is under it)
   * ==================================================================== */
  function resolvePath(p, cwd) {
    p = String(p == null ? '' : p).replace(/\\/g, '/');
    let base = cwd || '';
    if (p === '~' || p.indexOf('~/') === 0) { base = ''; p = p.slice(1); }
    if (p.charAt(0) === '/') base = '';
    const out = base ? base.split('/') : [];
    for (const seg of p.split('/')) { if (!seg || seg === '.') continue; if (seg === '..') { out.pop(); continue; } out.push(seg); }
    return out.join('/');
  }
  function fsIndex() {
    const files = S.projects.current() ? S.fs.list() : [];
    const dirs = new Set(['']);
    for (const f of files) { let d = U.dirOf(f.path); while (d && !dirs.has(d)) { dirs.add(d); d = U.dirOf(d); } }
    const fileMap = new Map(files.map((f) => [f.path, f]));
    return { files, dirs, fileMap, isDir: (p) => dirs.has(p), isFile: (p) => fileMap.has(p), exists: (p) => dirs.has(p) || fileMap.has(p) };
  }
  function children(ix, dir) {
    const pre = dir ? dir + '/' : '';
    const map = new Map();
    for (const f of ix.files) {
      if (pre && f.path.indexOf(pre) !== 0) continue;
      const rest = f.path.slice(pre.length), i = rest.indexOf('/');
      if (i < 0) { if (!map.has(rest)) map.set(rest, { name: rest, path: f.path, dir: false, size: f.size || 0, mtime: f.mtime || 0, binary: !!f.binary }); continue; }
      const n = rest.slice(0, i);
      let e = map.get(n);
      if (!e || !e.dir) { e = { name: n, path: pre + n, dir: true, size: 0, mtime: 0, count: 0 }; map.set(n, e); }
      e.size += f.size || 0; e.count++; e.mtime = Math.max(e.mtime, f.mtime || 0);
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }
  function filesUnder(ix, dir) { const pre = dir ? dir + '/' : ''; return ix.files.filter((f) => !pre || f.path.indexOf(pre) === 0); }
  function globRe(seg) {
    let r = '^';
    for (let i = 0; i < seg.length; i++) {
      const ch = seg[i];
      if (ch === '*') r += '[^/]*';
      else if (ch === '?') r += '[^/]';
      else if (ch === '[') { const j = seg.indexOf(']', i + 1); if (j > i + 1) { let cls = seg.slice(i + 1, j).replace(/\\/g, '\\\\'); if (cls[0] === '!') cls = '^' + cls.slice(1); r += '[' + cls + ']'; i = j; } else r += '\\['; }
      else r += ch.replace(/[.+^${}()|\\\]]/g, '\\$&');
    }
    try { return new RegExp(r + '$'); } catch (_) { return null; }
  }
  // Expand an unquoted word containing * ? [..] against the project files (bash: no match → literal).
  function expandGlob(word, ix, cwd) {
    const pat = word;
    const abs = pat.charAt(0) === '/';
    const segs = pat.split('/').filter((s) => s !== '');
    let bases = [{ path: abs ? '' : cwd, parts: [] }];
    for (let k = 0; k < segs.length; k++) {
      const seg = segs[k], last = k === segs.length - 1, next = [];
      for (const b of bases) {
        if (!/[*?[]/.test(seg)) { const p = resolvePath(seg, b.path); if (last ? ix.exists(p) : ix.isDir(p)) next.push({ path: p, parts: b.parts.concat(seg) }); continue; }
        const re = globRe(seg); if (!re) continue;
        for (const e of children(ix, b.path)) {
          if (e.name.charAt(0) === '.' && seg.charAt(0) !== '.') continue;
          if (!last && !e.dir) continue;
          if (re.test(e.name)) next.push({ path: e.path, parts: b.parts.concat(e.name) });
        }
      }
      bases = next;
      if (!bases.length) break;
    }
    const out = bases.map((b) => (abs ? '/' : '') + b.parts.join('/')).sort();
    return out.length ? out : [word];
  }
  const dispDir = (p) => '/' + (p || '');

  /* ======================================================================
   * state
   * ==================================================================== */
  const T = {
    panel: null, host: null, row: null, rowIn: null, rowPs: null,
    term: null, fit: null, mode: 'none',            // 'none' (not mounted yet) | 'xterm' | 'dom'
    started: false, loaded: false, failed: '', booted: false, welcomed: false,
    pending: '', atBol: true,
    cwd: '', oldCwd: '', lastCode: 0, lastPid: null,
    busy: false, job: null, queue: [], typeahead: '', draft: '',
    hist: [], histPid: '', rowHIdx: -1, rowDraft: '',
    ed: { active: false, kind: 'cmd', prompt: '', pw: 0, buf: [], cur: 0, row: 0, hIdx: -1, draft: null, resolve: null },
    kill: '', light: false, fitRaf: 0, rowPref: S.settings.get('terminal.inputRow', 'auto')
  };

  /* ======================================================================
   * output: xterm, DOM fallback, or a buffer until the panel is first shown
   * ==================================================================== */
  function termWrite(s) {
    s = String(s == null ? '' : s);
    if (!s) return;
    const v = stripAnsi(s).replace(/[\b]+$/, '');
    if (v) T.atBol = /[\n\r]$/.test(v);
    if (T.mode === 'xterm') T.term.write(s);
    else if (T.mode === 'dom') domWrite(s);
    else { T.pending += s; if (T.pending.length > 400000) T.pending = T.pending.slice(-300000); }
  }
  // Async output while the user edits a line: erase the input, print, redraw it (like readline).
  function printAbove(s) {
    s = String(s == null ? '' : s);
    if (!/\n$/.test(stripAnsi(s))) s += '\n';
    const ed = T.ed;
    if (T.mode !== 'xterm' || !ed.active) { if (!T.atBol) termWrite('\n'); termWrite(s); return; }
    termWrite((ed.row > 0 ? '\x1b[' + ed.row + 'A' : '') + '\r\x1b[J' + s);
    ed.row = 0;
    drawLine();
  }

  // ---- DOM fallback renderer (xterm unavailable): SGR colours, \r overwrite, clear ----
  const D = { line: null, cr: false, cls: '' };
  function domEnsureLine() { if (!D.line) { D.line = document.createElement('div'); D.line.className = 'st-terminal-ln'; T.log.appendChild(D.line); } return D.line; }
  function domWrite(s) {
    if (!T.log) return;
    const stick = T.log.scrollTop + T.log.clientHeight >= T.log.scrollHeight - 30;
    const re = /\x1b\[([0-9;?]*)([A-Za-z@`])|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?|\x1b[\s\S]?|\r|\n|\x08|[^\x1b\r\n\x08]+/g;
    let m;
    while ((m = re.exec(s))) {
      const t = m[0];
      if (t === '\n') { domEnsureLine(); D.line = null; D.cr = false; continue; }
      if (t === '\r') { D.cr = true; continue; }
      if (t === '\x08') continue;
      if (t.charCodeAt(0) === 0x1b) {
        if (m[2] === 'm') domSgr(m[1]);
        else if (m[2] === 'K') { if (D.line) D.line.textContent = ''; D.cr = false; }
        else if (m[2] === 'J' && /^[23]$/.test(m[1])) { T.log.textContent = ''; D.line = null; D.cr = false; }
        continue;
      }
      const ln = domEnsureLine();
      if (D.cr) { ln.textContent = ''; D.cr = false; }
      const sp = document.createElement('span');
      if (D.cls) sp.className = D.cls;
      sp.textContent = t;
      ln.appendChild(sp);
    }
    while (T.log.childElementCount > 3000) T.log.removeChild(T.log.firstChild);
    if (stick) T.log.scrollTop = T.log.scrollHeight;
  }
  function domSgr(params) {
    const ps = String(params || '0').split(';').map((x) => Number(x) || 0);
    const st = { fg: (/st-terminal-f(\d+)/.exec(D.cls) || [])[1] || '', b: /\bst-terminal-b\b/.test(D.cls), d: /\bst-terminal-d\b/.test(D.cls) };
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      if (p === 0) { st.fg = ''; st.b = false; st.d = false; }
      else if (p === 1) st.b = true;
      else if (p === 2) st.d = true;
      else if (p === 22) { st.b = false; st.d = false; }
      else if ((p >= 30 && p <= 37) || (p >= 90 && p <= 97)) st.fg = String(p);
      else if (p === 39) st.fg = '';
      else if (p === 38 || p === 48) i += ps[i + 1] === 5 ? 2 : ps[i + 1] === 2 ? 4 : 0;
    }
    D.cls = [st.fg ? 'st-terminal-f' + st.fg : '', st.b ? 'st-terminal-b' : '', st.d ? 'st-terminal-d' : ''].filter(Boolean).join(' ');
  }

  /* ======================================================================
   * prompt + history
   * ==================================================================== */
  function projName() { const p = S.projects.current(); return p ? oneLine(p.name).replace(/\s+/g, '-') : ''; }
  function shortCwd() { const c = oneLine(T.cwd); if (c.length <= 36) return c; const parts = c.split('/'); return '…/' + parts.slice(-2).join('/'); }
  function promptPlain() { const n = projName(); return 'ost:' + (n || '~') + (n && T.cwd ? '/' + shortCwd() : '') + '$ '; }
  function promptStr() { const n = projName(); return A.bold + A.bgreen + 'ost' + A.reset + ':' + A.bold + A.bblue + (n || '~') + (n && T.cwd ? '/' + shortCwd() : '') + A.reset + '$ '; }
  function histKey() { const p = S.projects.current(); return HIST_KEY + (p ? p.id : 'none'); }
  function loadHist() {
    const k = histKey(); if (T.histPid === k) return;
    T.histPid = k; T.hist = [];
    try { const h = JSON.parse(localStorage.getItem(k) || '[]'); if (Array.isArray(h)) T.hist = h.filter((x) => typeof x === 'string').slice(-HIST_MAX); } catch (_) {}
  }
  function saveHist() { try { localStorage.setItem(T.histPid || histKey(), JSON.stringify(T.hist.slice(-HIST_MAX))); } catch (_) {} }
  function pushHist(line) {
    loadHist();
    line = String(line || '');
    if (!line.trim() || line.length > 4000) return;
    if (T.hist[T.hist.length - 1] !== line) T.hist.push(line);
    if (T.hist.length > HIST_MAX) T.hist.splice(0, T.hist.length - HIST_MAX);
    saveHist();
  }
  function paintRowPrompt() {
    if (!T.rowPs) return;
    const q = T.ed.active && T.ed.kind === 'ask';
    T.rowPs.textContent = q ? stripAnsi(T.ed.prompt).trim() : promptPlain().trim();
    T.row.classList.toggle('ask', !!q);
    const small = S.ui.isMobile();
    T.rowIn.placeholder = q ? 'Answer, then Run' : T.busy ? (small ? 'Running…' : 'Running… (commands you send now run next)') : (small ? 'Command (try help)' : 'Type a command — try help');
  }

  /* ======================================================================
   * line editor (xterm mode) — wrap-aware redraw
   * ==================================================================== */
  const cols = () => (T.term && T.term.cols) || 80;
  function widthOf(arr, a, b) { let w = 0; for (let i = a; i < b; i++) w += charWidth(arr[i]); return w; }
  const offsetAt = (i) => T.ed.pw + widthOf(T.ed.buf, 0, i);
  function drawLine() {
    if (T.mode !== 'xterm') return;
    const ed = T.ed, C = cols();
    let s = (ed.row > 0 ? '\x1b[' + ed.row + 'A' : '') + '\r\x1b[J' + ed.prompt + ed.buf.join('');
    const end = offsetAt(ed.buf.length);
    if (end > 0 && end % C === 0) s += ' \b';                 // leave the pending-wrap state so the cursor maths hold
    const endRow = Math.floor(end / C);
    const tgt = offsetAt(ed.cur), tRow = Math.floor(tgt / C), tCol = tgt % C;
    if (endRow > tRow) s += '\x1b[' + (endRow - tRow) + 'A';
    s += '\x1b[' + (tCol + 1) + 'G';
    ed.row = tRow;
    termWrite(s);
  }
  function setBuf(text, cur) { const ed = T.ed; ed.buf = Array.from(String(text || '')); ed.cur = cur == null ? ed.buf.length : Math.max(0, Math.min(ed.buf.length, cur)); }
  const isWordCh = (ch) => /[\p{L}\p{N}_]/u.test(ch);
  function wordLeft(buf, i) { while (i > 0 && !isWordCh(buf[i - 1])) i--; while (i > 0 && isWordCh(buf[i - 1])) i--; return i; }
  function wordRight(buf, i) { while (i < buf.length && !isWordCh(buf[i])) i++; while (i < buf.length && isWordCh(buf[i])) i++; return i; }
  function shellWordLeft(buf, i) { while (i > 0 && buf[i - 1] === ' ') i--; while (i > 0 && buf[i - 1] !== ' ') i--; return i; }

  function onData(data) {
    data = String(data || '').replace(/\r\n|\n/g, '\r');
    if (!T.ed.active) {
      if (data.indexOf('\x03') >= 0) { interrupt(); data = data.split('\x03').pop(); }
      if (data && T.busy) T.typeahead = (T.typeahead + data).slice(-4096);
      return;
    }
    feed(data);
  }
  function feed(data) {
    const ed = T.ed;
    let i = 0, dirty = false;
    while (i < data.length) {
      if (!ed.active) { T.typeahead = (data.slice(i) + T.typeahead).slice(0, 4096); break; }
      const ch = data[i];
      if (ch === '\x1b') {
        const rest = data.slice(i);
        let m = /^\x1b\[([0-9;?]*)([A-Za-z~])/.exec(rest) || /^\x1bO([A-Za-z])/.exec(rest);
        if (m) {
          i += m[0].length;
          const fin = m[2] || m[1], p = m[2] ? m[1] : '';
          const mod = /;([0-9])$/.exec(p); const word = mod && /[35]/.test(mod[1]);
          if (fin === 'A') { histMove(-1); dirty = true; }
          else if (fin === 'B') { histMove(1); dirty = true; }
          else if (fin === 'C') { ed.cur = word ? wordRight(ed.buf, ed.cur) : Math.min(ed.buf.length, ed.cur + 1); dirty = true; }
          else if (fin === 'D') { ed.cur = word ? wordLeft(ed.buf, ed.cur) : Math.max(0, ed.cur - 1); dirty = true; }
          else if (fin === 'H' || (fin === '~' && /^[17]$/.test(p))) { ed.cur = 0; dirty = true; }
          else if (fin === 'F' || (fin === '~' && /^[48]$/.test(p))) { ed.cur = ed.buf.length; dirty = true; }
          else if (fin === '~' && /^3(;|$)/.test(p)) { if (ed.cur < ed.buf.length) { ed.buf.splice(ed.cur, 1); dirty = true; } }
          continue;                                            // anything else (including terminal replies) is ignored
        }
        const n = rest.charAt(1);
        if (n === 'b' || n === 'B') { ed.cur = wordLeft(ed.buf, ed.cur); dirty = true; i += 2; continue; }
        if (n === 'f' || n === 'F') { ed.cur = wordRight(ed.buf, ed.cur); dirty = true; i += 2; continue; }
        if (n === 'd') { const e = wordRight(ed.buf, ed.cur); T.kill = ed.buf.splice(ed.cur, e - ed.cur).join(''); dirty = true; i += 2; continue; }
        if (n === '\x7f' || n === '\b') { const s0 = wordLeft(ed.buf, ed.cur); T.kill = ed.buf.splice(s0, ed.cur - s0).join(''); ed.cur = s0; dirty = true; i += 2; continue; }
        i += n ? 2 : 1;
        continue;
      }
      i++;
      if (ch === '\r') { if (dirty) { drawLine(); dirty = false; } acceptLine(); continue; }
      if (ch === '\x7f' || ch === '\b') { if (ed.cur > 0) { ed.buf.splice(ed.cur - 1, 1); ed.cur--; dirty = true; } continue; }
      if (ch === '\t') { if (ed.kind === 'cmd') { if (dirty) { drawLine(); dirty = false; } tabComplete(); } continue; }
      if (ch === '\x01') { ed.cur = 0; dirty = true; continue; }                                   // Ctrl+A
      if (ch === '\x05') { ed.cur = ed.buf.length; dirty = true; continue; }                       // Ctrl+E
      if (ch === '\x02') { ed.cur = Math.max(0, ed.cur - 1); dirty = true; continue; }            // Ctrl+B
      if (ch === '\x06') { ed.cur = Math.min(ed.buf.length, ed.cur + 1); dirty = true; continue; } // Ctrl+F
      if (ch === '\x15') { T.kill = ed.buf.splice(0, ed.cur).join(''); ed.cur = 0; dirty = true; continue; }        // Ctrl+U
      if (ch === '\x0b') { T.kill = ed.buf.splice(ed.cur).join(''); dirty = true; continue; }                      // Ctrl+K
      if (ch === '\x17') { const s0 = shellWordLeft(ed.buf, ed.cur); T.kill = ed.buf.splice(s0, ed.cur - s0).join(''); ed.cur = s0; dirty = true; continue; } // Ctrl+W
      if (ch === '\x19') { if (T.kill) { const k = Array.from(T.kill); ed.buf.splice(ed.cur, 0, ...k); ed.cur += k.length; dirty = true; } continue; } // Ctrl+Y
      if (ch === '\x10') { histMove(-1); dirty = true; continue; }                                 // Ctrl+P
      if (ch === '\x0e') { histMove(1); dirty = true; continue; }                                  // Ctrl+N
      if (ch === '\x04') { if (ed.cur < ed.buf.length) { ed.buf.splice(ed.cur, 1); dirty = true; } continue; } // Ctrl+D
      if (ch === '\x0c') { termWrite('\x1b[H\x1b[2J'); ed.row = 0; dirty = true; continue; }      // Ctrl+L
      if (ch === '\x03') { cancelLine(); dirty = false; continue; }                                // Ctrl+C
      if (ch < ' ') continue;
      // printable run (fast path for pastes)
      let j = i; while (j < data.length && data[j] >= ' ' && data[j] !== '\x7f') j++;
      const chunk = Array.from(data.slice(i - 1, j).replace(/[\x80-\x9f]/g, ''));
      ed.buf.splice(ed.cur, 0, ...chunk); ed.cur += chunk.length; dirty = true;
      i = j;
    }
    if (dirty && ed.active) drawLine();
  }
  function histMove(d) {
    const ed = T.ed; if (ed.kind !== 'cmd') return;
    loadHist();
    if (!T.hist.length) return;
    if (ed.hIdx === -1) { if (d > 0) return; ed.draft = ed.buf.join(''); ed.hIdx = T.hist.length - 1; }
    else { ed.hIdx += d; if (ed.hIdx < 0) ed.hIdx = 0; }
    if (ed.hIdx >= T.hist.length) { ed.hIdx = -1; setBuf(ed.draft || ''); return; }
    setBuf(T.hist[ed.hIdx]);
  }
  function cancelLine() {
    const ed = T.ed;
    ed.cur = ed.buf.length; drawLine();
    termWrite('^C\r\n');
    ed.active = false;
    if (ed.kind === 'ask') { const r = ed.resolve; ed.resolve = null; ed.kind = 'cmd'; if (r) r(null); if (T.job) interrupt(true); return; }
    T.lastCode = 130;
    showPrompt();
  }
  function acceptLine() {
    const ed = T.ed;
    const line = ed.buf.join('');
    ed.cur = ed.buf.length; drawLine();
    termWrite('\r\n');
    ed.active = false; ed.row = 0;
    if (ed.kind === 'ask') { const r = ed.resolve; ed.resolve = null; ed.kind = 'cmd'; paintRowPrompt(); if (r) r(line); return; }
    startJob(line, { interactive: true, history: true });
  }
  function showPrompt() {
    if (T.busy || T.mode === 'none') { paintRowPrompt(); return; }
    paintRowPrompt();
    if (T.mode !== 'xterm') return;
    if (!T.atBol) termWrite('\r\n');
    const ed = T.ed;
    ed.active = true; ed.kind = 'cmd'; ed.prompt = promptStr(); ed.pw = strWidth(ed.prompt); ed.row = 0; ed.hIdx = -1; ed.draft = null;
    setBuf(T.draft || ''); T.draft = '';
    drawLine();
    const ta = T.typeahead; T.typeahead = '';
    if (ta) feed(ta);
  }
  function refreshPrompt() {
    paintRowPrompt();
    const ed = T.ed;
    if (T.mode !== 'xterm' || !ed.active || ed.kind !== 'cmd') return;
    ed.prompt = promptStr(); ed.pw = strWidth(ed.prompt);
    drawLine();
  }

  /* ======================================================================
   * tab completion (shared by xterm and the input row)
   * ==================================================================== */
  const escWord = (s) => String(s).replace(/([\s'"\\|;&<>$*?()#`!])/g, '\\$1');
  function commonPrefix(list) { if (!list.length) return ''; let p = list[0]; for (const s of list) { let i = 0; while (i < p.length && i < s.length && p[i] === s[i]) i++; p = p.slice(0, i); if (!p) break; } return p; }
  function completeText(line, pos) {
    const before = line.slice(0, pos), after = line.slice(pos);
    let ws = before.length;
    while (ws > 0) { const ch = before[ws - 1]; if (/[\s|;&<>]/.test(ch) && before[ws - 2] !== '\\') break; ws--; }
    const word = before.slice(ws), head = before.slice(0, ws);
    const unq = word.replace(/^['"]/, '').replace(/\\(.)/g, '$1');
    const segStart = Math.max(head.lastIndexOf('|'), head.lastIndexOf(';'), head.lastIndexOf('&'));
    const words = head.slice(segStart + 1).trim().split(/\s+/).filter(Boolean).filter((w) => !/^[<>]/.test(w));
    const cmdPos = !words.length && !/[<>]\s*$/.test(head);
    let cands = [];
    if (cmdPos) cands = commandNames().filter((n) => n.indexOf(unq) === 0).map((n) => ({ text: n, show: n, final: true }));
    else {
      const cmd = ALIAS[words[0]] || words[0];
      const def = CMDS.get(cmd);
      const sub = def && def.subs && words.length === 1 ? def.subs : null;
      if (sub) cands = sub.filter((n) => n.indexOf(unq) === 0).map((n) => ({ text: n, show: n, final: true }));
      else if (cmd === 'help' && words.length === 1) cands = commandNames().filter((n) => n.indexOf(unq) === 0).map((n) => ({ text: n, show: n, final: true }));
      else if (cmd === 'npm' && /^(uninstall|remove|rm|un|r)$/.test(words[1] || '')) cands = depNames().filter((n) => n.indexOf(unq) === 0).map((n) => ({ text: n, show: n, final: true }));
      else if (cmd === 'npm' && words[1] === 'run' && words.length === 2) cands = scriptNames().filter((n) => n.indexOf(unq) === 0).map((n) => ({ text: n, show: n, final: true }));
      else if (S.projects.current() && !(def && def.noPaths)) {
        const ix = fsIndex();
        const slash = unq.lastIndexOf('/');
        const dirPart = slash >= 0 ? unq.slice(0, slash + 1) : '', base = slash >= 0 ? unq.slice(slash + 1) : unq;
        const dir = dirPart ? resolvePath(dirPart, T.cwd) : T.cwd;
        if (ix.isDir(dir)) {
          const dirsOnly = cmd === 'cd' || cmd === 'mkdir';
          cands = children(ix, dir).filter((e) => e.name.indexOf(base) === 0 && (base.charAt(0) === '.' || e.name.charAt(0) !== '.') && (!dirsOnly || e.dir))
            .map((e) => ({ text: dirPart + e.name + (e.dir ? '/' : ''), show: e.name + (e.dir ? '/' : ''), final: !e.dir, dir: e.dir }));
        }
      }
    }
    if (!cands.length) return { line, pos, list: null };
    if (cands.length === 1) {
      const nb = head + escWord(cands[0].text) + (cands[0].final && !/^\s/.test(after) ? ' ' : '');
      return { line: nb + after, pos: nb.length, list: null };
    }
    const pre = commonPrefix(cands.map((c) => c.text));
    if (pre.length > unq.length) { const nb = head + escWord(pre); return { line: nb + after, pos: nb.length, list: null }; }
    return { line, pos, list: cands.map((c) => c) };
  }
  function columns(items, width, colorFn) {
    if (!items.length) return '';
    const w = Math.max(...items.map((x) => strWidth(x))) + 2;
    const per = Math.max(1, Math.floor(Math.max(10, width) / w));
    const rows = Math.ceil(items.length / per);
    let out = '';
    for (let r = 0; r < rows; r++) {
      let ln = '';
      for (let k = 0; k < per; k++) { const i = k * rows + r; if (i >= items.length) break; const last = (k + 1) * rows + r >= items.length; const shown = colorFn ? colorFn(items[i], i) : items[i]; ln += last ? shown : shown + ' '.repeat(w - strWidth(items[i])); }
      out += ln + '\n';
    }
    return out;
  }
  function listCompletions(list) {
    const max = 120, shown = list.slice(0, max);
    let s = columns(shown.map((c) => oneLine(c.show)), cols() - 1, (x, i) => shown[i].dir ? A.bold + A.bblue + x + A.reset : x);
    if (list.length > max) s += A.gray + '… ' + (list.length - max) + ' more' + A.reset + '\n';
    return s;
  }
  function tabComplete() {
    const ed = T.ed;
    const line = ed.buf.join(''), pos = ed.buf.slice(0, ed.cur).join('').length;
    const r = completeText(line, pos);
    if (r.list) { printAbove(listCompletions(r.list)); return; }
    if (r.line === line) { termWrite('\x07'); return; }
    ed.buf = Array.from(r.line); ed.cur = Array.from(r.line.slice(0, r.pos)).length;
    drawLine();
  }

  /* ======================================================================
   * jobs: one command line at a time; exec() calls and row input queue up
   * ==================================================================== */
  function jobWrite(job, s) {
    if (!job || !job.alive) return;
    s = String(s == null ? '' : s);
    termWrite(s);
    if (job.out.length < OUT_CAP) job.out += stripAnsi(s).replace(/\r/g, '');
  }
  function startJob(line, o) {
    o = o || {};
    if (o.history) pushHist(line);
    const job = { line, interactive: !!o.interactive, ac: new AbortController(), alive: true, done: false, out: '', onInt: [], resolve: o.resolve || null, t0: Date.now() };
    T.busy = true; T.job = job; T.typeahead = T.typeahead || '';
    paintRowPrompt(); paintRowBusy();
    Promise.resolve().then(() => runLine(line, job)).then((code) => finishJob(job, typeof code === 'number' ? code : 0), (e) => {
      if (job.alive) jobWrite(job, A.red + 'ost: ' + oneLine(e && e.message || e) + A.reset + '\n');
      finishJob(job, 1);
    });
    return job;
  }
  function finishJob(job, code) {
    if (job.done) return;
    job.done = true; job.alive = false;
    T.lastCode = code;
    if (T.job === job) { T.job = null; T.busy = false; }
    if (job.resolve) { try { job.resolve({ code, output: job.out.length >= OUT_CAP ? job.out.slice(0, OUT_CAP) + '\n… (output truncated)' : job.out }); } catch (_) {} }
    paintRowBusy();
    if (T.ed.kind === 'ask') { T.ed.kind = 'cmd'; T.ed.resolve = null; }
    if (!pump()) showPrompt();
  }
  function pump() {
    if (T.busy || !T.queue.length) return false;
    const q = T.queue.shift();
    const ed = T.ed;
    if (T.mode === 'xterm' && ed.active && ed.kind === 'cmd') {           // keep what the user was typing
      T.draft = ed.buf.join('');
      termWrite((ed.row > 0 ? '\x1b[' + ed.row + 'A' : '') + '\r\x1b[J');
      ed.active = false; ed.row = 0;
    } else if (!T.atBol) termWrite('\r\n');
    termWrite(promptStr() + clean(q.line) + '\n');
    startJob(q.line, { interactive: !!q.interactive, history: !!q.history, resolve: q.resolve });
    return true;
  }
  function enqueue(line, o) {
    o = o || {};
    return new Promise((resolve) => { T.queue.push({ line: String(line == null ? '' : line), interactive: !!o.interactive, history: !!o.history, resolve }); if (!T.busy) pump(); });
  }
  function interrupt(quiet) {
    const job = T.job;
    if (!job || job.interrupted) return;
    job.interrupted = true;
    if (!quiet) { termWrite('^C\n'); }
    try { job.ac.abort(); } catch (_) {}
    for (const fn of job.onInt) { try { fn(); } catch (_) {} }
    if (T.ed.active && T.ed.kind === 'ask') { const r = T.ed.resolve; T.ed.resolve = null; T.ed.active = false; T.ed.kind = 'cmd'; if (r) r(null); }
    setTimeout(() => { if (!job.done) { job.alive = false; finishJob(job, 130); } }, 1500);   // a command that ignores the signal is detached
  }
  // y/n question inside a command. Non-interactive runs (exec() API) take the default.
  function ask(job, question, dflt) {
    if (!job.alive) return Promise.resolve(false);
    const q = question + (dflt ? '[Y/n] ' : '[y/N] ');
    if (!job.interactive) { jobWrite(job, q + A.gray + '(non-interactive: ' + (dflt ? 'yes' : 'no') + ')' + A.reset + '\n'); return Promise.resolve(!!dflt); }
    return new Promise((resolve) => {
      const done = (ans) => { if (ans == null) { resolve(false); return; } const a = String(ans).trim(); resolve(a ? /^y(es)?$/i.test(a) : !!dflt); };
      const ed = T.ed;
      ed.kind = 'ask'; ed.resolve = done;
      job.out += q;
      if (T.mode === 'xterm') {
        if (!T.atBol) termWrite('\r\n');
        ed.active = true; ed.prompt = A.byellow + q + A.reset; ed.pw = strWidth(q); ed.row = 0; setBuf('');
        drawLine();
        const ta = T.typeahead; T.typeahead = ''; if (ta) feed(ta);
      } else { termWrite(A.byellow + q + A.reset + '\n'); ed.active = true; ed.prompt = q; if (T.rowIn) { try { T.rowIn.focus(); } catch (_) {} } }
      paintRowPrompt();
    });
  }

  /* ======================================================================
   * lexer + parser: words, quotes, $VARS, globs, | > >> < ; && ||
   * ==================================================================== */
  function envVars() {
    const p = S.projects.current();
    return { PWD: dispDir(T.cwd), OLDPWD: dispDir(T.oldCwd), HOME: '/', USER: S.id.name || 'ost', LOGNAME: S.id.name || 'ost', SHELL: 'ost-sh', TERM: T.mode === 'xterm' ? 'xterm-256color' : 'dumb', PROJECT: p ? p.name : '', PROJECT_ID: p ? p.id : '', OST_STUDIO: S.version || '1' };
  }
  function lex(line) {
    const toks = [], n = line.length, env = envVars();
    let i = 0;
    const varAt = (k) => {
      const r = line.slice(k + 1);
      let m;
      if (r.charAt(0) === '?') return { v: String(T.lastCode), k: k + 2 };
      if ((m = /^\{([A-Za-z_][A-Za-z0-9_]*)\}/.exec(r))) return { v: env[m[1]] != null ? String(env[m[1]]) : '', k: k + 1 + m[0].length };
      if ((m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(r))) return { v: env[m[0]] != null ? String(env[m[0]]) : '', k: k + 1 + m[0].length };
      return { v: '$', k: k + 1 };
    };
    while (i < n) {
      const ch = line[i];
      if (ch === ' ' || ch === '\t') { i++; continue; }
      if (ch === '#') break;
      const two = line.substr(i, 2);
      if (two === '&&' || two === '||' || two === '>>') { toks.push({ t: 'op', v: two }); i += 2; continue; }
      if (two === '2>') return { error: "stderr redirection (2>) isn't supported" };
      if (ch === '|' || ch === ';' || ch === '>' || ch === '<') { toks.push({ t: 'op', v: ch }); i++; continue; }
      if (ch === '&') return { error: "background jobs (&) aren't supported — commands run one at a time" };
      let v = '', glob = false;
      while (i < n) {
        const d = line[i];
        if (d === ' ' || d === '\t' || '|;&<>'.indexOf(d) >= 0) break;
        if (d === '\\') { if (i + 1 < n) v += line[i + 1]; i += 2; continue; }
        if (d === "'") { const j = line.indexOf("'", i + 1); if (j < 0) return { error: 'unterminated quote (\')' }; v += line.slice(i + 1, j); i = j + 1; continue; }
        if (d === '"') {
          i++; let closed = false;
          while (i < n) {
            const e = line[i];
            if (e === '"') { closed = true; i++; break; }
            if (e === '\\' && i + 1 < n && '"\\$`'.indexOf(line[i + 1]) >= 0) { v += line[i + 1]; i += 2; continue; }
            if (e === '$') { const r = varAt(i); v += r.v; i = r.k; continue; }
            v += e; i++;
          }
          if (!closed) return { error: 'unterminated quote (")' };
          continue;
        }
        if (d === '$') { const r = varAt(i); v += r.v; i = r.k; continue; }
        if (d === '*' || d === '?' || d === '[') glob = true;
        v += d; i++;
      }
      toks.push({ t: 'w', v, glob });
    }
    return { toks };
  }
  function parse(toks) {
    const seq = [];
    let pipe = [], cmd = { words: [], out: null, inFile: null };
    const fresh = () => ({ words: [], out: null, inFile: null });
    const has = (c) => c.words.length || c.out || c.inFile;
    for (let k = 0; k < toks.length; k++) {
      const t = toks[k];
      if (t.t === 'w') { cmd.words.push(t); continue; }
      if (t.v === '>' || t.v === '>>' || t.v === '<') {
        const f = toks[k + 1];
        if (!f || f.t !== 'w') return { error: "syntax error near '" + t.v + "'" };
        if (t.v === '<') cmd.inFile = f.v; else cmd.out = { path: f.v, append: t.v === '>>' };
        k++; continue;
      }
      if (t.v === '|') { if (!cmd.words.length) return { error: "syntax error near '|'" }; pipe.push(cmd); cmd = fresh(); continue; }
      if (!has(cmd)) { if (t.v === ';' && !pipe.length && !seq.length) continue; return { error: "syntax error near '" + t.v + "'" }; }
      if (!cmd.words.length) return { error: 'missing command before ' + t.v };
      pipe.push(cmd); seq.push({ pipe, op: t.v }); pipe = []; cmd = fresh();
    }
    if (has(cmd)) { if (!cmd.words.length) return { error: 'missing command' }; pipe.push(cmd); }
    else if (pipe.length) return { error: "syntax error: nothing after '|'" };
    if (pipe.length) seq.push({ pipe, op: '' });
    else if (seq.length && (seq[seq.length - 1].op === '&&' || seq[seq.length - 1].op === '||')) return { error: "syntax error: nothing after '" + seq[seq.length - 1].op + "'" };
    return { seq };
  }
  async function runLine(line, job) {
    if (!line.trim()) return T.lastCode;
    const lx = lex(line);
    if (lx.error) { jobWrite(job, A.red + 'ost: ' + lx.error + A.reset + '\n'); return 2; }
    const ps = parse(lx.toks);
    if (ps.error) { jobWrite(job, A.red + 'ost: ' + ps.error + A.reset + '\n'); return 2; }
    let code = 0, prevOp = '';
    for (const item of ps.seq) {
      if (!job.alive || job.interrupted) return 130;
      const skip = (prevOp === '&&' && code !== 0) || (prevOp === '||' && code === 0);
      if (!skip) { code = await runPipeline(item.pipe, job); T.lastCode = code; }
      prevOp = item.op;
    }
    return code;
  }
  async function runPipeline(cmds, job) {
    let stdin = null, code = 0;
    for (let k = 0; k < cmds.length; k++) {
      if (!job.alive || job.interrupted) return 130;
      const cmd = cmds[k], last = k === cmds.length - 1;
      const ix = fsIndex();
      const argv = [];
      for (const w of cmd.words) { if (w.glob && S.projects.current()) argv.push(...expandGlob(w.v, ix, T.cwd)); else argv.push(w.v); }
      if (cmd.inFile != null) {
        const p = resolvePath(cmd.inFile, T.cwd);
        const txt = ix.isFile(p) ? S.fs.read(p) : null;
        if (txt == null || S.fs.isBinary(p)) { jobWrite(job, A.red + 'ost: ' + oneLine(cmd.inFile) + ': ' + (ix.isDir(p) ? 'Is a directory' : txt == null ? 'No such file' : 'binary file') + A.reset + '\n'); code = 1; stdin = ''; continue; }
        stdin = txt;
      }
      const sink = { tty: last && !cmd.out, buf: '' };
      code = await runCommand(argv, { stdin, sink, job });
      if (cmd.out && job.alive) {
        const p = resolvePath(cmd.out.path, T.cwd);
        const ix2 = fsIndex();
        if (!S.projects.current()) { jobWrite(job, A.red + 'ost: no project is open' + A.reset + '\n'); return 1; }
        if (!p || !U.normPath(p)) { jobWrite(job, A.red + 'ost: ' + oneLine(cmd.out.path) + ': invalid file name' + A.reset + '\n'); return 1; }
        if (ix2.isDir(p)) { jobWrite(job, A.red + 'ost: ' + oneLine(cmd.out.path) + ': Is a directory' + A.reset + '\n'); return 1; }
        if (cmd.out.append && S.fs.isBinary(p)) { jobWrite(job, A.red + 'ost: ' + oneLine(cmd.out.path) + ': cannot append to a binary file' + A.reset + '\n'); return 1; }
        const prev = cmd.out.append ? (S.fs.read(p) || '') : '';
        try { await S.fs.write(p, prev + sink.buf, { source: 'terminal' }); }
        catch (e) { jobWrite(job, A.red + 'ost: ' + oneLine(e.message) + A.reset + '\n'); return 1; }
      }
      stdin = sink.buf;
    }
    return code;
  }
  function usageErr(msg) { const e = new Error(msg); e.usage = true; return e; }
  // getopt: short flags may combine (-rin), valued flags take the rest or the next arg (-n5 / -n 5), long options map to keys.
  function getopt(args, short, long, valued) {
    const o = {}, rest = [];
    long = long || {}; valued = valued || '';
    let end = false;
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (end || a === '-' || a.charAt(0) !== '-' || a.length === 1) { rest.push(a); continue; }
      if (a === '--') { end = true; continue; }
      if (a.indexOf('--') === 0) {
        const eq = a.indexOf('='), k = eq > 0 ? a.slice(2, eq) : a.slice(2), key = long[k];
        if (!key) throw usageErr("unrecognized option '" + a + "'");
        if (valued.indexOf(key) >= 0) { const v = eq > 0 ? a.slice(eq + 1) : args[++i]; if (v == null) throw usageErr("option '--" + k + "' requires a value"); o[key] = v; }
        else o[key] = true;
        continue;
      }
      if (/^-\d+$/.test(a) && short.indexOf('#') >= 0) { o['#'] = a.slice(1); continue; }
      for (let j = 1; j < a.length; j++) {
        const f = a[j];
        if (short.indexOf(f) < 0 || f === '#') throw usageErr("invalid option -- '" + f + "'");
        if (valued.indexOf(f) >= 0) { const v = a.slice(j + 1) || args[++i]; if (v == null) throw usageErr("option requires an argument -- '" + f + "'"); o[f] = v; break; }
        o[f] = true;
      }
    }
    return { o, rest };
  }
  async function runCommand(argv, io) {
    const job = io.job;
    const name = argv[0];
    if (name == null || name === '') return 0;
    const id = ALIAS[name] || name;
    const def = CMDS.get(id);
    const tty = io.sink.tty;
    const ctx = {
      name, id, args: argv.slice(1), stdin: io.stdin, tty, job, signal: job.ac.signal, interactive: job.interactive,
      out(s) { if (!job.alive) return; if (io.sink.tty) jobWrite(job, s); else io.sink.buf += String(s); },
      line(s) { ctx.out((s == null ? '' : s) + '\n'); },
      err(s) { jobWrite(job, A.red + String(s).replace(/\n$/, '') + A.reset + '\n'); },
      warn(s) { jobWrite(job, A.yellow + String(s).replace(/\n$/, '') + A.reset + '\n'); },
      note(s) { jobWrite(job, A.gray + String(s).replace(/\n$/, '') + A.reset + '\n'); },
      tty_(s) { jobWrite(job, s); },
      t: (s) => tty ? clean(s) : String(s == null ? '' : s),
      col: (code, s) => tty ? code + s + A.reset : String(s),
      resolve: (p) => resolvePath(p, T.cwd),
      ask: (q, d) => ask(job, q, d),
      onInterrupt: (fn) => job.onInt.push(fn),
      cols: () => cols()
    };
    if (!def) {
      const hint = OS_HINTS[name];
      if (hint) { ctx.err(oneLine(name) + ': ' + hint); return 127; }
      const near = commandNames().map((n) => [n, lev(name, n)]).filter((x) => x[1] <= 2).sort((a, b) => a[1] - b[1])[0];
      ctx.err('ost: command not found: ' + oneLine(name) + (near ? " — did you mean '" + near[0] + "'?" : ''));
      ctx.note("Type 'help' for the list. This is OST Studio's built-in shell: it works on your project files; there is no operating-system shell.");
      return 127;
    }
    if (ctx.args.indexOf('--help') >= 0 && !def.ownHelp) { ctx.out(helpFor(id, tty)); return 0; }
    if (def.project && !S.projects.current()) { ctx.err(name + ': no project is open — create or open one from ☰ (Projects & templates)'); return 1; }
    try {
      const r = await def.run(ctx);
      return typeof r === 'number' ? r : 0;
    } catch (e) {
      if (e && e.usage) { ctx.err(name + ': ' + e.message); ctx.note("Try '" + name + " --help'."); return 2; }
      if (e && e.name === 'AbortError') return 130;
      ctx.err(name + ': ' + oneLine(e && e.message || e));
      return 1;
    }
  }

  /* ======================================================================
   * command registry + help
   * ==================================================================== */
  const CMDS = new Map();
  const ALIAS = { ll: 'ls', dir: 'ls', cls: 'clear', code: 'open', edit: 'open', py: 'python', python3: 'python', copy: 'cp', move: 'mv', del: 'rm', md: 'mkdir', type: 'cat' };
  const GROUPS = [
    ['Files', ['ls', 'cd', 'pwd', 'tree', 'cat', 'head', 'tail', 'touch', 'mkdir', 'rm', 'mv', 'cp', 'grep', 'find', 'wc', 'echo', 'open']],
    ['Run & ship', ['run', 'node', 'python', 'stop', 'preview', 'build', 'deploy']],
    ['Packages & code', ['npm', 'git', 'agent']],
    ['Project & shell', ['sync', 'zip', 'whoami', 'env', 'date', 'history', 'clear', 'help', 'exit']]
  ];
  const OS_HINTS = {
    sudo: 'there is no operating system here — every command already has full access to your project files.',
    apt: 'no system packages here. JavaScript packages: npm i <pkg>. Python packages install on import (Pyodide).', 'apt-get': 'no system packages here — try npm i <pkg>.', brew: 'no system packages here — try npm i <pkg>.',
    pip: 'Python packages install automatically when you import them (Pyodide + micropip) — just `import requests` and run.', pip3: 'Python packages install automatically when you import them — just import and run.',
    yarn: 'use `npm i <pkg>` — packages are pinned in package.json and load from esm.sh.', pnpm: 'use `npm i <pkg>` — packages are pinned in package.json and load from esm.sh.', bun: 'use `npm i <pkg>` / `run <file>`.', npx: 'no Node.js processes here. Install with `npm i <pkg>` and import it; run files with `run <file>`.', deno: 'run TypeScript with `run <file.ts>` (sandboxed worker).',
    curl: 'no network tools here — use fetch() in a script and `run` it.', wget: 'no network tools here — use fetch() in a script and `run` it.', ssh: 'no SSH — OST Studio runs entirely in your browser.',
    vim: 'use the editor: open <file>', vi: 'use the editor: open <file>', nano: 'use the editor: open <file>', emacs: 'use the editor: open <file>',
    ps: 'no processes here — `stop` stops running code.', kill: 'no processes here — press Ctrl+C or run `stop`.', top: 'no processes here.', chmod: 'files have no permissions here.', chown: 'files have no owners here.', ln: 'symbolic links are not supported.',
    serve: 'use `preview` — your app is served from the sandbox.', 'http-server': 'use `preview` — your app is served from the sandbox.', vite: 'use `preview` (dev) and `build` / `deploy` (production) — bundling is built in.', tsc: 'TypeScript compiles automatically when you run, preview or build.', make: 'no build tools here — use `build`.', docker: 'no containers here — OST hosts static web apps.', ruby: 'only JavaScript/TypeScript and Python run here.', go: 'only JavaScript/TypeScript and Python run here.', cargo: 'only JavaScript/TypeScript and Python run here.', java: 'only JavaScript/TypeScript and Python run here.', gcc: 'only JavaScript/TypeScript and Python run here.'
  };
  function def(name, o) { CMDS.set(name, Object.assign({ name }, o)); }
  function commandNames() { return [...CMDS.keys()].concat(Object.keys(ALIAS)).sort(); }
  function helpFor(id, tty) {
    const d = CMDS.get(id); if (!d) return '';
    const b = (s) => tty ? A.bold + s + A.reset : s, g = (s) => tty ? A.gray + s + A.reset : s;
    let s = b('Usage: ') + d.usage + '\n' + d.desc + '\n';
    if (d.opts && d.opts.length) { s += '\n'; const w = Math.max(...d.opts.map((x) => x[0].length)) + 2; for (const [k, v] of d.opts) s += '  ' + padEnd(k, w) + v + '\n'; }
    if (d.more) s += '\n' + d.more.split('\n').map((x) => g(x)).join('\n') + '\n';
    const al = Object.keys(ALIAS).filter((a) => ALIAS[a] === id);
    if (al.length) s += g('Aliases: ' + al.join(', ')) + '\n';
    return s;
  }
  function colorEntry(e, ctx) {
    const name = ctx.t(e.name);
    if (!ctx.tty) return name;
    if (e.dir) return A.bold + A.bblue + name + A.reset;
    const x = U.extOf(e.name);
    if (/^(png|jpe?g|gif|webp|avif|ico|bmp|svg|mp3|wav|ogg|mp4|webm|woff2?|ttf|otf|pdf)$/.test(x)) return A.bmagenta + name + A.reset;
    if (/^(js|mjs|cjs|jsx|ts|tsx|mts|cts)$/.test(x)) return A.byellow + name + A.reset;
    if (x === 'py') return A.bgreen + name + A.reset;
    if (/^(html?|css|scss|less)$/.test(x)) return A.bcyan + name + A.reset;
    if (e.name.charAt(0) === '.') return A.gray + name + A.reset;
    return name;
  }
  function fmtDate(ts) { if (!ts) return '                '; const d = new Date(ts); const p = (n) => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()); }
  function readText(ctx, arg) {          // → {text} | {code}
    const p = ctx.resolve(arg), ix = fsIndex();
    if (ix.isDir(p)) { ctx.err(ctx.name + ': ' + oneLine(arg) + ': Is a directory'); return { code: 1 }; }
    if (!ix.isFile(p)) { ctx.err(ctx.name + ': ' + oneLine(arg) + ': No such file or directory'); return { code: 1 }; }
    if (S.fs.isBinary(p)) { ctx.err(ctx.name + ': ' + oneLine(arg) + ': binary file (' + U.fmtBytes(byteSize(S.fs.read(p))) + ') — open it in the editor to view it'); return { code: 1 }; }
    return { text: S.fs.read(p) || '', path: p };
  }
  async function fsWrite(ctx, p, content, binary) {
    if (!U.normPath(p)) throw new Error('invalid file name: ' + oneLine(p));
    await S.fs.write(p, content, binary == null ? { source: 'terminal' } : { source: 'terminal', binary: !!binary });
  }

  /* ======================================================================
   * shell + file commands
   * ==================================================================== */
  def('help', {
    usage: 'help [command]', desc: 'List the commands, or show help for one command.', noPaths: true,
    run(ctx) {
      const id = ctx.args[0] && (ALIAS[ctx.args[0]] || ctx.args[0]);
      if (id) { if (!CMDS.has(id)) { ctx.err('help: no such command: ' + oneLine(ctx.args[0])); return 1; } ctx.out(helpFor(id, ctx.tty)); return 0; }
      const b = (s) => ctx.col(A.bold, s);
      let s = b('OST Studio terminal') + ' — commands work on your project files; code runs in browser sandboxes.\n';
      const w = Math.max(...[...CMDS.keys()].map((k) => k.length)) + 2;
      for (const [title, names] of GROUPS) {
        s += '\n' + ctx.col(A.bcyan, title) + '\n';
        for (const n of names) { const d = CMDS.get(n); if (d) s += '  ' + ctx.col(A.bold, padEnd(n, w)) + d.desc.split('\n')[0].replace(/\.$/, '') + '\n'; }
      }
      s += '\n' + ctx.col(A.gray, 'Shell: quotes, $VARS, globs (*.js), pipes (|), > >> < redirection, ; && ||. `cmd --help` for details.') + '\n';
      s += ctx.col(A.gray, 'Keys: Tab completes · ↑/↓ history · Ctrl+A/E start/end · Ctrl+U/K delete to start/end · Alt+Backspace (or Ctrl+W) delete word · Ctrl+L clear · Ctrl+C stop.') + '\n';
      ctx.out(s); return 0;
    }
  });
  def('clear', { usage: 'clear', desc: 'Clear the terminal screen and scrollback.', noPaths: true, run(ctx) { if (ctx.tty) ctx.tty_('\x1b[H\x1b[2J\x1b[3J'); return 0; } });
  def('pwd', { usage: 'pwd', desc: 'Print the current folder (/ is the project root).', noPaths: true, run(ctx) { ctx.line(ctx.t(dispDir(T.cwd))); return 0; } });
  def('cd', {
    usage: 'cd [folder]', desc: 'Change the current folder. No argument (or ~ or /) goes to the project root; - goes back.', project: true,
    run(ctx) {
      let a = ctx.args[0];
      if (a === '-') { a = dispDir(T.oldCwd); ctx.line(ctx.t(a)); }
      const p = a == null ? '' : ctx.resolve(a), ix = fsIndex();
      if (!ix.isDir(p)) { ctx.err('cd: ' + oneLine(a) + ': ' + (ix.isFile(p) ? 'Not a directory' : 'No such directory')); return 1; }
      T.oldCwd = T.cwd; T.cwd = p;
      return 0;
    }
  });
  def('ls', {
    usage: 'ls [-la1] [path…]', desc: 'List files and folders.', project: true,
    opts: [['-l', 'long format: type, size, modified time'], ['-a', 'show hidden files (names starting with .)'], ['-1', 'one entry per line']],
    run(ctx) {
      const { o, rest } = getopt(ctx.args, 'la1hAF', { all: 'a', long: 'l' });
      if (ctx.name === 'll') { o.l = true; o.a = true; }
      const ix = fsIndex();
      const targets = rest.length ? rest : ['.'];
      let code = 0, first = true;
      const show = (e) => o.a || o.A || e.name.charAt(0) !== '.';
      const fmtList = (entries) => {
        if (o.l) return entries.map((e) => (e.dir ? ctx.col(A.bblue, 'd') + 'rwxr-xr-x' : '-rw-r--r--') + '  ' + padStart(e.dir ? plural(e.count, 'file') : U.fmtBytes(e.size), 9) + '  ' + ctx.col(A.gray, fmtDate(e.mtime)) + '  ' + colorEntry(e, ctx) + (e.dir ? '/' : '') + '\n').join('');
        if (!ctx.tty || o['1']) return entries.map((e) => colorEntry(e, ctx) + '\n').join('');
        return columns(entries.map((e) => oneLine(e.name)), ctx.cols() - 1, (x, i) => colorEntry(entries[i], ctx));
      };
      const files = [], dirs = [];
      for (const a of targets) {
        const p = ctx.resolve(a);
        if (ix.isFile(p)) { const f = ix.fileMap.get(p); files.push({ name: a, path: p, dir: false, size: f.size, mtime: f.mtime }); }
        else if (ix.isDir(p)) dirs.push([a, p]);
        else { ctx.err("ls: cannot access '" + oneLine(a) + "': No such file or directory"); code = 2; }
      }
      let s = files.length ? fmtList(files) : '';
      for (const [a, p] of dirs) {
        const entries = children(ix, p).filter(show);
        if (targets.length > 1) s += (first && !files.length ? '' : '\n') + ctx.t(a) + ':\n';
        first = false;
        s += fmtList(entries);
      }
      ctx.out(s);
      return code;
    }
  });
  def('tree', {
    usage: 'tree [-a] [-L depth] [path]', desc: 'Show the folder tree.', project: true,
    opts: [['-L n', 'limit the depth'], ['-a', 'include hidden files']],
    run(ctx) {
      const { o, rest } = getopt(ctx.args, 'aL', { all: 'a' }, 'L');
      const depth = o.L ? Math.max(1, parseInt(o.L, 10) || 1) : 99;
      const ix = fsIndex(), a = rest[0] || '.', p = ctx.resolve(a);
      if (!ix.isDir(p)) { ctx.err('tree: ' + oneLine(a) + ': ' + (ix.isFile(p) ? 'Not a directory' : 'No such directory')); return 1; }
      let nd = 0, nf = 0;
      let s = ctx.col(A.bold + A.bblue, ctx.t(a === '.' ? '.' : a)) + '\n';
      const walk = (dir, pre, lvl) => {
        const es = children(ix, dir).filter((e) => o.a || e.name.charAt(0) !== '.');
        es.forEach((e, i) => {
          const last = i === es.length - 1;
          s += ctx.col(A.gray, pre + (last ? '└── ' : '├── ')) + colorEntry(e, ctx) + '\n';
          if (e.dir) { nd++; if (lvl < depth) walk(e.path, pre + (last ? '    ' : '│   '), lvl + 1); } else nf++;
        });
      };
      walk(p, '', 1);
      s += '\n' + plural(nd, 'directory', 'directories') + ', ' + plural(nf, 'file') + '\n';
      ctx.out(s); return 0;
    }
  });
  def('cat', {
    usage: 'cat [-n] [file…]', desc: 'Print files (or standard input).', project: true, opts: [['-n', 'number the lines']],
    run(ctx) {
      const { o, rest } = getopt(ctx.args, 'n', { number: 'n' });
      const srcs = rest.length ? rest : ['-'];
      let code = 0, n = 0;
      for (const a of srcs) {
        let text;
        if (a === '-') { if (ctx.stdin == null) { ctx.err('cat: no input — give a file name, e.g. cat index.html'); return 1; } text = ctx.stdin; }
        else { const r = readText(ctx, a); if (r.code) { code = r.code; continue; } text = r.text; }
        if (o.n) text = text.split('\n').map((l, i, arr) => (i === arr.length - 1 && l === '' ? '' : padStart(String(++n), 6) + '  ' + l)).join('\n');
        ctx.out(ctx.t(text));
      }
      return code;
    }
  });
  function headTail(tail) {
    return {
      usage: (tail ? 'tail' : 'head') + ' [-n N] [file…]', desc: 'Print the ' + (tail ? 'last' : 'first') + ' lines of files (default 10).', project: true,
      opts: [['-n N', 'number of lines' + (tail ? ' (+N starts at line N)' : '')], ['-N', 'same as -n N']],
      run(ctx) {
        const { o, rest } = getopt(ctx.args, 'n#q', { lines: 'n', quiet: 'q' }, 'n');
        const spec = String(o.n != null ? o.n : o['#'] != null ? o['#'] : '10');
        const fromStart = tail && spec.charAt(0) === '+';
        const n = parseInt(spec.replace(/^[+-]/, ''), 10);
        if (!Number.isFinite(n) || n < 0) throw usageErr("invalid number of lines: '" + spec + "'");
        const srcs = rest.length ? rest : ['-'];
        let code = 0;
        srcs.forEach((a, k) => {
          let text;
          if (a === '-') { if (ctx.stdin == null) { ctx.err(ctx.name + ': no input — give a file name'); code = 1; return; } text = ctx.stdin; }
          else { const r = readText(ctx, a); if (r.code) { code = r.code; return; } text = r.text; }
          let lines = text.split('\n'); const endNl = lines[lines.length - 1] === ''; if (endNl) lines.pop();
          lines = !tail ? lines.slice(0, n) : fromStart ? lines.slice(Math.max(0, n - 1)) : n ? lines.slice(-n) : [];
          if (srcs.length > 1 && !o.q) ctx.out((k ? '\n' : '') + ctx.col(A.bold, '==> ' + ctx.t(a) + ' <==') + '\n');
          if (lines.length) ctx.out(ctx.t(lines.join('\n')) + '\n');
        });
        return code;
      }
    };
  }
  def('head', headTail(false));
  def('tail', headTail(true));
  def('echo', {
    usage: 'echo [-n] [-e] [text…] [> file | >> file]', desc: 'Print text. With > or >> it writes or appends to a file.', ownHelp: false,
    opts: [['-n', 'no trailing newline'], ['-e', 'interpret \\n, \\t and \\\\']],
    more: 'Examples:  echo "hello" > notes.txt   ·   echo more >> notes.txt   ·   echo $PWD',
    run(ctx) {
      let i = 0, nl = true, esc = false;
      while (i < ctx.args.length && /^-[ne]+$/.test(ctx.args[i])) { if (ctx.args[i].indexOf('n') >= 0) nl = false; if (ctx.args[i].indexOf('e') >= 0) esc = true; i++; }
      let s = ctx.args.slice(i).join(' ');
      if (esc) s = s.replace(/\\(n|t|\\)/g, (m, k) => (k === 'n' ? '\n' : k === 't' ? '\t' : '\\'));
      ctx.out(ctx.t(s) + (nl ? '\n' : ''));
      return 0;
    }
  });
  def('touch', {
    usage: 'touch file…', desc: 'Create empty files (existing files are left unchanged).', project: true,
    async run(ctx) {
      if (!ctx.args.length) throw usageErr('missing file operand');
      const ix = fsIndex(); let code = 0;
      for (const a of ctx.args) {
        const p = ctx.resolve(a);
        if (ix.exists(p)) continue;
        if (!p) { ctx.err('touch: ' + oneLine(a) + ': invalid file name'); code = 1; continue; }
        try { await fsWrite(ctx, p, ''); } catch (e) { ctx.err('touch: ' + oneLine(e.message)); code = 1; }
      }
      return code;
    }
  });
  def('mkdir', {
    usage: 'mkdir [-p] folder…', desc: 'Create folders. Folders only exist while they hold a file, so mkdir adds folder/.gitkeep.', project: true,
    opts: [['-p', 'no error if the folder already exists']],
    async run(ctx) {
      const { o, rest } = getopt(ctx.args, 'pv', { parents: 'p' });
      if (!rest.length) throw usageErr('missing operand');
      let code = 0;
      for (const a of rest) {
        const ix = fsIndex(), p = ctx.resolve(a);
        if (!p) { if (!o.p) { ctx.err("mkdir: cannot create directory '" + oneLine(a) + "': File exists"); code = 1; } continue; }
        if (ix.isFile(p)) { ctx.err("mkdir: cannot create directory '" + oneLine(a) + "': a file with that name exists"); code = 1; continue; }
        if (ix.isDir(p)) { if (!o.p) { ctx.err("mkdir: cannot create directory '" + oneLine(a) + "': File exists"); code = 1; } continue; }
        try { await fsWrite(ctx, p + '/.gitkeep', ''); } catch (e) { ctx.err('mkdir: ' + oneLine(e.message)); code = 1; }
      }
      return code;
    }
  });
  def('rm', {
    usage: 'rm [-rf] path…', desc: 'Delete files, or folders with -r. There is no trash — deletions sync to your cloud copy.', project: true,
    opts: [['-r, -R', 'delete folders and everything in them'], ['-f', 'ignore missing files'], ['-v', 'list what was removed']],
    async run(ctx) {
      const { o, rest } = getopt(ctx.args, 'rRfvd', { recursive: 'r', force: 'f', verbose: 'v' });
      if (!rest.length) { if (o.f) return 0; throw usageErr('missing operand'); }
      let code = 0;
      for (const a of rest) {
        const ix = fsIndex(), p = ctx.resolve(a);
        if (!p) { ctx.err("rm: refusing to remove the project root '" + oneLine(a) + "' — delete the project from ☰ instead"); code = 1; continue; }
        if (ix.isDir(p)) {
          if (!o.r && !o.R) { ctx.err("rm: cannot remove '" + oneLine(a) + "': Is a directory (use rm -r)"); code = 1; continue; }
          const n = filesUnder(ix, p).length;
          await S.fs.remove(p, { source: 'terminal' });
          if (o.v) ctx.line("removed directory '" + ctx.t(a) + "' (" + plural(n, 'file') + ')');
        } else if (ix.isFile(p)) {
          await S.fs.remove(p, { source: 'terminal' });
          if (o.v) ctx.line("removed '" + ctx.t(a) + "'");
        } else if (!o.f) { ctx.err("rm: cannot remove '" + oneLine(a) + "': No such file or directory"); code = 1; }
      }
      return code;
    }
  });
  // shared by mv and cp: resolve [src…] dst → [[src, target, isDir]]
  function planMoves(ctx, rest, verb) {
    if (rest.length < 2) throw usageErr(rest.length ? "missing destination after '" + oneLine(rest[0]) + "'" : 'missing file operand');
    const ix = fsIndex(), dstArg = rest[rest.length - 1], dst = ctx.resolve(dstArg), srcs = rest.slice(0, -1);
    const dstIsDir = ix.isDir(dst) || (srcs.length > 1) || /\/$/.test(dstArg);
    if (srcs.length > 1 && !ix.isDir(dst)) { ctx.err(verb + ": target '" + oneLine(dstArg) + "' is not a directory"); return null; }
    const plan = [];
    for (const a of srcs) {
      const p = ctx.resolve(a);
      if (!p) { ctx.err(verb + ': cannot ' + verb + ' the project root'); return null; }
      if (!ix.exists(p)) { ctx.err(verb + ": cannot stat '" + oneLine(a) + "': No such file or directory"); return null; }
      const target = dstIsDir ? (dst ? dst + '/' : '') + U.baseOf(p) : dst;
      if (!target) { ctx.err(verb + ': invalid destination'); return null; }
      if (target === p) { ctx.err(verb + ": '" + oneLine(a) + "' and '" + oneLine(dstArg) + "' are the same file"); return null; }
      if (ix.isDir(p) && (target + '/').indexOf(p + '/') === 0) { ctx.err(verb + ": cannot " + verb + " '" + oneLine(a) + "' into itself"); return null; }
      plan.push([p, target, ix.isDir(p), a]);
    }
    return plan;
  }
  def('mv', {
    usage: 'mv [-n] source… destination', desc: 'Move or rename files and folders (an existing file at the destination is replaced).', project: true,
    opts: [['-n', 'never replace an existing file'], ['-v', 'explain what is being done']],
    async run(ctx) {
      const { o, rest } = getopt(ctx.args, 'nfiv', { 'no-clobber': 'n', force: 'f', verbose: 'v' });
      const plan = planMoves(ctx, rest, 'mv'); if (!plan) return 1;
      let code = 0;
      for (const [p, target, isDir, a] of plan) {
        const ix = fsIndex();
        if (ix.isDir(target)) { ctx.err("mv: cannot move '" + oneLine(a) + "': '" + oneLine(dispDir(target)) + "' is a folder that already exists"); code = 1; continue; }
        if (ix.isFile(target)) {
          if (o.n) continue;
          if (isDir) { ctx.err("mv: cannot overwrite file '" + oneLine(dispDir(target)) + "' with a folder"); code = 1; continue; }
          await S.fs.remove(target, { source: 'terminal' });
        }
        try { await S.fs.rename(p, target, { source: 'terminal' }); } catch (e) { ctx.err('mv: ' + oneLine(e.message)); code = 1; continue; }
        if (isDir && T.cwd && (T.cwd === p || T.cwd.indexOf(p + '/') === 0)) T.cwd = target + T.cwd.slice(p.length);
        if (o.v) ctx.line("renamed '" + ctx.t(a) + "' -> '" + ctx.t(dispDir(target)) + "'");
      }
      return code;
    }
  });
  def('cp', {
    usage: 'cp [-r] source… destination', desc: 'Copy files, or folders with -r.', project: true,
    opts: [['-r, -R', 'copy folders recursively'], ['-n', 'never replace an existing file'], ['-v', 'explain what is being done']],
    async run(ctx) {
      const { o, rest } = getopt(ctx.args, 'rRnfiva', { recursive: 'r', 'no-clobber': 'n', verbose: 'v' });
      const plan = planMoves(ctx, rest, 'cp'); if (!plan) return 1;
      let code = 0;
      for (const [p, target, isDir, a] of plan) {
        const ix = fsIndex();
        if (isDir && !o.r && !o.R && !o.a) { ctx.err("cp: -r not specified; omitting directory '" + oneLine(a) + "'"); code = 1; continue; }
        const pairs = isDir ? filesUnder(ix, p).map((f) => [f.path, target + f.path.slice(p.length)]) : [[p, target]];
        let n = 0;
        for (const [from, to] of pairs) {
          if (ix.isDir(to)) { ctx.err("cp: cannot overwrite folder '" + oneLine(dispDir(to)) + "' with a file"); code = 1; continue; }
          if (o.n && ix.isFile(to)) continue;
          try { await fsWrite(ctx, to, S.fs.read(from), S.fs.isBinary(from)); n++; } catch (e) { ctx.err('cp: ' + oneLine(e.message)); code = 1; break; }
        }
        if (o.v) ctx.line("'" + ctx.t(a) + "' -> '" + ctx.t(dispDir(target)) + "'" + (isDir ? ' (' + plural(n, 'file') + ')' : ''));
      }
      return code;
    }
  });
  def('grep', {
    usage: 'grep [-rinlcvwFh] pattern [path…]', desc: 'Search files (or standard input) for a regular expression (JavaScript syntax).', project: true,
    opts: [['-r, -R', 'search folders recursively (default path: .)'], ['-i', 'ignore case'], ['-n', 'show line numbers'], ['-l', 'only list matching files'], ['-c', 'count matching lines per file'], ['-v', 'show lines that do NOT match'], ['-w', 'match whole words'], ['-F', 'pattern is a fixed string, not a regex'], ['-h / -H', 'hide / show file names']],
    more: 'Examples:  grep -rn useState src   ·   grep -i todo *.js   ·   ls | grep css',
    run(ctx) {
      const { o, rest } = getopt(ctx.args, 'rRinlcvwFhHEsI', { recursive: 'r', 'ignore-case': 'i', 'line-number': 'n', 'files-with-matches': 'l', count: 'c', 'invert-match': 'v', 'word-regexp': 'w', 'fixed-strings': 'F' });
      if (!rest.length) throw usageErr('missing pattern');
      const pat = rest[0];
      let src = o.F ? pat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : pat;
      if (o.w) src = '(?<![\\p{L}\\p{N}_])(?:' + src + ')(?![\\p{L}\\p{N}_])';
      let re, reG;
      try { re = new RegExp(src, 'u' + (o.i ? 'i' : '')); reG = new RegExp(src, 'gu' + (o.i ? 'i' : '')); }
      catch (e) { try { re = new RegExp(src, o.i ? 'i' : ''); reG = new RegExp(src, 'g' + (o.i ? 'i' : '')); } catch (e2) { ctx.err('grep: invalid regular expression: ' + oneLine(e2.message)); ctx.note('Use -F to search for the text literally.'); return 2; } }
      const rec = o.r || o.R;
      const ix = fsIndex();
      const sources = [];
      let paths = rest.slice(1), code = 1, errs = false, sawDir = false;
      if (!paths.length) { if (rec) paths = ['.']; else if (ctx.stdin != null) sources.push({ name: '(standard input)', text: ctx.stdin }); else { ctx.err('grep: no input — give a file, or use -r to search folders (grep -r "' + oneLine(pat) + '" .)'); return 2; } }
      for (const a of paths) {
        const p = ctx.resolve(a);
        if (ix.isDir(p)) {
          if (!rec) { ctx.err('grep: ' + oneLine(a) + ': Is a directory (use -r)'); errs = true; continue; }
          sawDir = true;
          const base = a.replace(/\/+$/, '') || '/';
          for (const f of filesUnder(ix, p)) {
            if (f.binary || !U.isTextPath(f.path)) continue;
            const rel = p ? f.path.slice(p.length + 1) : f.path;
            sources.push({ name: base === '/' ? '/' + rel : base + '/' + rel, path: f.path });
          }
        } else if (ix.isFile(p)) { if (!S.fs.isBinary(p)) sources.push({ name: a, path: p }); }
        else { ctx.err('grep: ' + oneLine(a) + ': No such file or directory'); errs = true; }
      }
      const showName = o.H || (!o.h && (sawDir || sources.length > 1));
      const hl = (line) => {
        if (!ctx.tty || o.v) return ctx.t(line);
        let out = '', last = 0; reG.lastIndex = 0; let m, guard = 0;
        while ((m = reG.exec(line)) && guard++ < 200) { if (!m[0].length) { reG.lastIndex++; continue; } out += clean(line.slice(last, m.index)) + A.bold + A.bred + clean(m[0]) + A.reset; last = m.index + m[0].length; }
        return out + clean(line.slice(last));
      };
      let shown = 0;
      const MAX = 3000;
      for (const s of sources) {
        const text = s.text != null ? s.text : (S.fs.read(s.path) || '');
        const lines = text.split('\n');
        let cnt = 0;
        const nm = ctx.col(A.magenta, ctx.t(s.name)) + ctx.col(A.cyan, ':');
        for (let i = 0; i < lines.length; i++) {
          let ln = lines[i]; if (i === lines.length - 1 && ln === '') break;
          if (re.test(ln) === !!o.v) continue;
          cnt++; code = 0;
          if (o.l || o.c) { if (o.l) break; continue; }
          if (shown++ >= MAX) continue;
          if (ln.length > 400) { const mi = Math.max(0, ln.search(re) - 120); ln = (mi ? '…' : '') + ln.slice(mi, mi + 300) + '…'; }
          ctx.out((showName ? nm : '') + (o.n ? ctx.col(A.green, String(i + 1)) + ctx.col(A.cyan, ':') : '') + hl(ln) + '\n');
        }
        if (o.l && cnt) ctx.out(ctx.col(A.magenta, ctx.t(s.name)) + '\n');
        else if (o.c) ctx.out((showName ? nm : '') + cnt + '\n');
      }
      if (shown > MAX) ctx.note('… ' + (shown - MAX) + ' more matching lines not shown');
      return errs && code !== 0 ? 2 : code;
    }
  });
  def('find', {
    usage: 'find [path] [-name pattern] [-iname pattern] [-type f|d]', desc: 'List files and folders under a path, optionally filtered by name.', project: true,
    more: 'Examples:  find . -name "*.css"   ·   find src -type d',
    run(ctx) {
      const args = ctx.args.slice(); let start = '.';
      if (args.length && args[0].charAt(0) !== '-') start = args.shift();
      let nameRe = null, type = '';
      for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a === '-name' || a === '-iname') { const v = args[++i]; if (v == null) throw usageErr(a + ' needs a pattern'); const r = globRe(v); nameRe = r && new RegExp(r.source, a === '-iname' ? 'i' : ''); }
        else if (a === '-type') { type = args[++i]; if (type !== 'f' && type !== 'd') throw usageErr('-type must be f or d'); }
        else throw usageErr("unknown predicate '" + a + "'");
      }
      const ix = fsIndex(), p = ctx.resolve(start);
      if (!ix.exists(p)) { ctx.err("find: '" + oneLine(start) + "': No such file or directory"); return 1; }
      const base = start.replace(/\/+$/, '') || '/';
      const shownPath = (q) => q === p ? start : (base === '/' ? '/' : base + '/') + (p ? q.slice(p.length + 1) : q);
      const out = [];
      if (ix.isFile(p)) out.push([p, false]);
      else {
        if (!type || type === 'd') out.push([p, true]);
        for (const d of [...ix.dirs].sort()) if (d && (!p || d.indexOf(p + '/') === 0) && (!type || type === 'd')) out.push([d, true]);
        if (!type || type === 'f') for (const f of filesUnder(ix, p)) out.push([f.path, false]);
      }
      out.sort((x, y) => x[0].localeCompare(y[0]));
      let s = '';
      for (const [q, isDir] of out) { if (nameRe && !nameRe.test(U.baseOf(q) || '/')) continue; s += (isDir ? ctx.col(A.bblue, ctx.t(shownPath(q))) : ctx.t(shownPath(q))) + '\n'; }
      ctx.out(s); return 0;
    }
  });
  def('wc', {
    usage: 'wc [-lwc] [file…]', desc: 'Count lines, words and bytes.', project: true,
    opts: [['-l', 'lines'], ['-w', 'words'], ['-c', 'bytes']],
    run(ctx) {
      const { o, rest } = getopt(ctx.args, 'lwcm', { lines: 'l', words: 'w', bytes: 'c', chars: 'm' });
      const all = !o.l && !o.w && !o.c && !o.m;
      const srcs = rest.length ? rest : ['-'];
      const rows = []; let code = 0; const tot = [0, 0, 0];
      for (const a of srcs) {
        let text;
        if (a === '-') { if (ctx.stdin == null) { ctx.err('wc: no input — give a file name'); return 1; } text = ctx.stdin; }
        else { const r = readText(ctx, a); if (r.code) { code = r.code; continue; } text = r.text; }
        const v = [(text.match(/\n/g) || []).length, (text.match(/\S+/g) || []).length, o.m ? [...text].length : enc.encode(text).length];
        v.forEach((x, i) => { tot[i] += x; });
        rows.push([v, a === '-' ? '' : a]);
      }
      if (rows.length > 1) rows.push([tot, 'total']);
      const pick = (v) => [all || o.l ? v[0] : null, all || o.w ? v[1] : null, all || o.c || o.m ? v[2] : null].filter((x) => x != null);
      const w = Math.max(1, ...rows.map((r) => Math.max(...pick(r[0]).map((x) => String(x).length))));
      ctx.out(rows.map((r) => pick(r[0]).map((x) => padStart(String(x), w)).join(' ') + (r[1] ? ' ' + ctx.t(r[1]) : '')).join('\n') + (rows.length ? '\n' : ''));
      return code;
    }
  });
  def('open', {
    usage: 'open file[:line[:col]]…', desc: 'Open files in the editor.', project: true,
    run(ctx) {
      if (!ctx.args.length) throw usageErr('missing file operand');
      if (!S.editor || typeof S.editor.open !== 'function') { ctx.err('open: the editor is not available'); return 1; }
      const ix = fsIndex(); let code = 0;
      for (const a of ctx.args) {
        let p = ctx.resolve(a), line = 0, col = 0;
        if (!ix.isFile(p)) { const m = /^(.*?):(\d+)(?::(\d+))?$/.exec(a); if (m && ix.isFile(ctx.resolve(m[1]))) { p = ctx.resolve(m[1]); line = +m[2]; col = +(m[3] || 1); } }
        if (ix.isDir(p)) { ctx.err('open: ' + oneLine(a) + ': Is a directory'); code = 1; continue; }
        if (!ix.isFile(p)) { ctx.err('open: ' + oneLine(a) + ': No such file — create it first with: touch ' + oneLine(a)); code = 1; continue; }
        const ok = line && typeof S.editor.reveal === 'function' ? S.editor.reveal(p, line, col || 1) : S.editor.open(p);
        if (ok === false) { ctx.err('open: could not open ' + oneLine(a)); code = 1; }
      }
      return code;
    }
  });

  /* ======================================================================
   * run / build / deploy — through STUDIO.runtime and STUDIO.deploy
   * ==================================================================== */
  const RUN_SOURCES = ['run', 'python', 'build'];
  // Stream runtime console lines into this command's output while it runs.
  function streamConsole(ctx, sources) {
    return bus.on('console', (e) => {
      if (!e || sources.indexOf(e.source) < 0 || !ctx.job.alive) return;
      const lvl = e.level;
      let text = clean(e.text);
      if (e.image) text = (text ? text + ' ' : '') + '[image output — open the Console panel to see it]';
      if (e.action && e.action.label) text += '  (' + oneLine(e.action.label) + ': use the Console panel)';
      if (lvl === 'system') { ctx.tty_(A.gray + text + A.reset + '\n'); return; }
      const col = lvl === 'error' ? A.red : lvl === 'warn' ? A.yellow : lvl === 'info' ? A.cyan : '';
      if (lvl === 'error' || lvl === 'warn') { if (!ctx.tty) ctx.tty_(col + text + A.reset + '\n'); else ctx.out(col + text + A.reset + '\n'); return; }
      ctx.out(ctx.tty && col ? col + text + A.reset + '\n' : (ctx.tty ? text : stripAnsi(e.text)) + '\n');
    });
  }
  function needRuntime(ctx) { if (S.runtime && typeof S.runtime.run === 'function') return true; ctx.err(ctx.name + ': the runtime is not loaded in this build'); return false; }
  function keepTerminalTab(wasTerm) { if (wasTerm && S.ui.panel && S.ui.panel() !== 'terminal') S.ui.showPanel('terminal'); }
  async function runStreamed(ctx, start) {
    const off = streamConsole(ctx, RUN_SOURCES);
    const wasTerm = typeof S.ui.panel === 'function' && S.ui.panel() === 'terminal';
    ctx.onInterrupt(() => { if (typeof S.runtime.isRunning !== 'function' || S.runtime.isRunning()) S.runtime.stop(); });
    try {
      const p = start();
      keepTerminalTab(wasTerm);                         // the runtime switches to Console; the output is mirrored here
      const r = await p;
      keepTerminalTab(wasTerm);
      return r;
    } finally { off(); }
  }
  function runKind(path) {
    const x = U.extOf(path);
    if (x === 'py') return 'python';
    if (/^(js|mjs|cjs|ts|mts|cts|jsx|tsx)$/.test(x)) return 'js';
    if (/^html?$/.test(x)) return 'preview';
    return '';
  }
  async function runFile(ctx, arg, want) {
    if (!needRuntime(ctx)) return 1;
    let path = '';
    if (arg != null) {
      const ix = fsIndex(); path = ctx.resolve(arg);
      if (ix.isDir(path)) { ctx.err(ctx.name + ': ' + oneLine(arg) + ': Is a directory'); return 1; }
      if (!ix.isFile(path)) { ctx.err(ctx.name + ': ' + oneLine(arg) + ': No such file'); return 1; }
      const k = runKind(path);
      if (want && k !== want) { ctx.err(ctx.name + ': ' + oneLine(arg) + (want === 'python' ? ' is not a .py file' : ' is not a JavaScript/TypeScript file') + (k ? ' — try: ' + (k === 'python' ? 'python ' : k === 'js' ? 'node ' : 'preview ') + oneLine(arg) : '')); return 1; }
      if (!k) { ctx.err(ctx.name + ": don't know how to run " + oneLine(arg) + ' (runs .js .ts .jsx .tsx .py, previews .html)'); return 1; }
      if (k === 'preview') { await S.runtime.preview(true, path); ctx.note('Preview opened for ' + oneLine(path) + ' — it updates as you edit.'); return 0; }
    } else {
      const kind = U.projectKind();
      if (kind === 'web' || kind === 'react' || kind === 'static') {
        await S.runtime.run();
        ctx.note('Opened the live preview of index.html (web project) — it updates as you edit. Run a script with: node <file> / python <file>.');
        return 0;
      }
    }
    const r = await runStreamed(ctx, () => S.runtime.run(path || undefined));
    if (r == null) { if (!path) ctx.note('Nothing ran — add an index.html, a .py file or a .js/.ts file.'); return path ? 1 : 0; }
    return r.ok ? 0 : 1;
  }
  async function evalCode(ctx, code, target) {
    if (!needRuntime(ctx)) return 1;
    if (typeof S.runtime.evaluate !== 'function') { ctx.err(ctx.name + ': inline code is not supported by this runtime — put it in a file and run it'); return 1; }
    const r = await runStreamed(ctx, () => S.runtime.evaluate(code, target));
    return r && r.ok === false ? 1 : 0;
  }
  def('run', {
    usage: 'run [file]', desc: 'Run a file (or the project) in its sandbox — .js/.ts/.jsx in a worker, .py with Python, .html as a preview.', project: true,
    more: 'Output streams here and in the Console panel. Ctrl+C stops it; scripts stop after 30 s.\nWithout a file: web projects open the preview; script projects run their entry file.',
    run(ctx) { return runFile(ctx, ctx.args[0]); }
  });
  def('node', {
    usage: 'node <file> | node -e "code"', desc: 'Run JavaScript/TypeScript in a sandboxed worker (fetch, top-level await, TS supported).', project: true,
    more: 'There is no Node.js process: fs is a sandbox copy of your files, and http servers can\'t listen.',
    run(ctx) {
      const a = ctx.args;
      if (a[0] === '-e' || a[0] === '-p' || a[0] === '--eval') { if (a[1] == null) throw usageErr(a[0] + ' needs code'); return evalCode(ctx, a[0] === '-p' ? 'console.log(' + a.slice(1).join(' ') + ')' : a.slice(1).join(' '), 'js'); }
      if (!a.length) { ctx.note('node: no interactive REPL here — use node -e "code", node <file>, or the input at the bottom of the Console panel.'); return 0; }
      return runFile(ctx, a[0], 'js');
    }
  });
  def('python', {
    usage: 'python <file> | python -c "code"', desc: 'Run Python 3.12 (Pyodide) in a sandboxed worker. Packages install on import.', project: true,
    more: 'The first run downloads Python (~6 MB). input() returns an empty string.',
    run(ctx) {
      const a = ctx.args;
      if (a[0] === '-c') { if (a[1] == null) throw usageErr('-c needs code'); return evalCode(ctx, a.slice(1).join(' '), 'python'); }
      if (a[0] === '-m' && a[1] === 'pip') { ctx.note('pip: packages install automatically when you import them (micropip) — just import and run.'); return 0; }
      if (a[0] === '--version' || a[0] === '-V') { ctx.line('Python 3.12 (Pyodide 0.26.4, WebAssembly sandbox)'); return 0; }
      if (!a.length) { ctx.note('python: no interactive REPL here — use python -c "code", python <file>, or the Console panel input.'); return 0; }
      return runFile(ctx, a[0], 'python');
    }
  });
  def('stop', {
    usage: 'stop', desc: 'Stop running code (same as Ctrl+C while a command runs).', noPaths: true,
    run(ctx) {
      if (!needRuntime(ctx)) return 1;
      if (typeof S.runtime.isRunning === 'function' && !S.runtime.isRunning()) { ctx.note('Nothing is running.'); return 0; }
      S.runtime.stop(); ctx.note('Stopped.'); return 0;
    }
  });
  def('preview', {
    usage: 'preview [page.html]', desc: 'Show the live preview (rebuilds as you edit). Optionally pick an HTML page.', project: true,
    async run(ctx) {
      if (!needRuntime(ctx)) return 1;
      let page;
      if (ctx.args[0]) {
        page = ctx.resolve(ctx.args[0]);
        if (!fsIndex().isFile(page)) { ctx.err('preview: ' + oneLine(ctx.args[0]) + ': No such file'); return 1; }
        if (!/\.html?$/i.test(page)) { ctx.err('preview: ' + oneLine(ctx.args[0]) + ' is not an .html page'); return 1; }
      } else if (!S.fs.exists('index.html')) { ctx.err('preview: this project has no index.html — scripts run with: run <file>'); return 1; }
      await S.runtime.preview(true, page);
      ctx.note('Preview opened' + (page ? ' for ' + oneLine(page) : '') + '. It runs sandboxed in your browser and updates as you edit.');
      return 0;
    }
  });
  def('build', {
    usage: 'build', desc: 'Make the production (deploy) build: bundle JS/TS, inline nothing, list the files and sizes.', project: true,
    more: 'OST hosts static web apps (HTML/CSS/JS/assets). Python and Node-style scripts run only in the Studio sandbox.',
    async run(ctx) {
      if (!S.runtime || typeof S.runtime.build !== 'function') { ctx.err('build: the runtime is not loaded in this build'); return 1; }
      ctx.note('Building for deploy…');
      const slow = setTimeout(() => { if (ctx.job.alive) ctx.note('(the first build downloads the esbuild compiler — about 10 MB)'); }, 3000);
      const off = streamConsole(ctx, ['build']);
      let r;
      try { r = await S.runtime.build({ mode: 'deploy' }); } finally { clearTimeout(slow); off(); }
      if (!r) { ctx.err('build: no result'); return 1; }
      for (const e of (r.errors || [])) ctx.err('✕ ' + (e.path ? oneLine(e.path) + (e.line ? ':' + e.line + (e.col ? ':' + e.col : '') : '') + '  ' : '') + oneLine(e.text));
      for (const w of (r.warnings || []).slice(0, 30)) ctx.warn('⚠ ' + (w.path ? oneLine(w.path) + (w.line ? ':' + w.line : '') + '  ' : '') + oneLine(w.text));
      if (!r.ok) { ctx.err('Build failed — ' + plural((r.errors || []).length, 'error') + ' (see Problems).'); return 1; }
      const names = Object.keys(r.files || {}).sort();
      let total = 0;
      const w = Math.min(48, Math.max(10, ...names.map((n) => strWidth(oneLine(n)))));
      let s = '';
      for (const n of names) { const b = byteSize(r.files[n]); total += b; s += '  ' + padEnd(ctx.t(truncW(oneLine(n), 48)), w) + '  ' + ctx.col(A.gray, padStart(U.fmtBytes(b), 9)) + '\n'; }
      ctx.out(s);
      ctx.out(ctx.col(A.bgreen, '✓ Build OK') + ' in ' + fmtMs(r.ms || 0) + ' — ' + plural(names.length, 'file') + ', ' + U.fmtBytes(total) + '. Publish it with: deploy <name>\n');
      return 0;
    }
  });
  def('deploy', {
    usage: 'deploy [name] [--title "App title"] [--desc "description"]', desc: 'Build and publish the project as a static web app at ' + S.APPS.replace(/^https?:\/\//, '') + '/<name>/.', project: true,
    more: 'name: 3–40 characters, lowercase letters, digits and dashes. The first person to deploy a name owns it.\nApps share one origin — never keep secrets in browser storage. There is no server-side code.',
    async run(ctx) {
      const { o, rest } = getopt(ctx.args, 'y', { title: 'title', name: 'title', desc: 'desc', description: 'desc', yes: 'y' }, ['title', 'desc']);
      if (!S.deploy || typeof S.deploy.deploy !== 'function') { ctx.err('deploy: the Deploy module is not loaded in this build — use the 🚀 Deploy activity on the left.'); return 1; }
      let slug = rest[0];
      if (slug != null) {
        slug = String(slug).toLowerCase();
        if (!SLUG_RE.test(slug)) { ctx.err("deploy: '" + oneLine(rest[0]) + "' is not a valid app name — use 3–40 lowercase letters, digits and dashes (e.g. my-app)"); return 1; }
      }
      ctx.note('Deploying ' + oneLine(S.projects.current().name) + (slug ? ' → ' + S.APPS + '/' + slug + '/' : '') + ' …');
      const args = {}; if (slug) args.slug = slug; if (o.title) args.name = o.title; if (o.desc) args.description = o.desc;
      const r = await S.deploy.deploy(args);
      if (!r) { ctx.warn('Deploy cancelled.'); return 1; }
      const app = r.app || r;
      const url = app.url || (app.slug || slug ? S.APPS + '/' + (app.slug || slug) + '/' : '');
      ctx.out(ctx.col(A.bgreen, '✓ Deployed') + (app.version ? ' v' + app.version : '') + (app.files ? ' · ' + plural(Array.isArray(app.files) ? app.files.length : Number(app.files) || 0, 'file') : '') + (app.bytes ? ' · ' + U.fmtBytes(app.bytes) : '') + '\n');
      if (url) ctx.out('  ' + ctx.col(A.bcyan + '\x1b[4m', ctx.t(url)) + '\n');
      return 0;
    }
  });

  /* ======================================================================
   * npm — package.json only; packages load from esm.sh at build time
   * ==================================================================== */
  const NPM_NAME = /^(?:@[a-z0-9~-][a-z0-9._~-]*\/)?[a-z0-9~-][a-z0-9._~-]*$/;
  function readPkg() {
    const raw = S.fs.read('package.json');
    if (raw == null) return null;
    try { const j = JSON.parse(raw); if (!j || typeof j !== 'object' || Array.isArray(j)) throw new Error('not an object'); return j; }
    catch (e) { throw new Error('package.json is not valid JSON (' + e.message + ') — fix it in the editor first'); }
  }
  async function writePkg(pkg) {
    for (const k of ['dependencies', 'devDependencies']) if (pkg[k]) { const o = {}; for (const n of Object.keys(pkg[k]).sort()) o[n] = pkg[k][n]; pkg[k] = o; }
    await S.fs.write('package.json', JSON.stringify(pkg, null, 2) + '\n', { source: 'terminal' });
  }
  function newPkg() { const p = S.projects.current(); return { name: String(p ? p.name : 'app').toLowerCase().replace(/[^a-z0-9._~-]+/g, '-').replace(/^[-._]+|-+$/g, '').slice(0, 60) || 'app', version: '1.0.0', private: true, type: 'module', dependencies: {} }; }
  function depNames() { try { const p = readPkg(); return p ? Object.keys(Object.assign({}, p.dependencies, p.devDependencies)).sort() : []; } catch (_) { return []; } }
  function scriptNames() { try { const p = readPkg(); return p && p.scripts ? Object.keys(p.scripts).sort() : []; } catch (_) { return []; } }
  function parseSpec(s) {
    s = String(s || '').trim();
    if (/^(https?:|git(\+|:)|github:|file:|link:|npm:|\.{0,2}\/)/.test(s)) return { error: 'only packages from the npm registry are supported (' + s + ')' };
    let name = s, ver = '';
    const at = s.lastIndexOf('@'); if (at > 0) { name = s.slice(0, at); ver = s.slice(at + 1); }
    if (!NPM_NAME.test(name) || name.length > 214) return { error: "invalid package name '" + s + "'" };
    return { name, ver };
  }
  const encPkg = (n) => n.replace('/', '%2f');
  async function resolvePkg(name, ver, signal) {
    const exact = /^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(ver);
    const tag = !ver || /^[A-Za-z][\w.-]*$/.test(ver);
    if (!exact && !tag) return { version: ver, range: true };
    const r = await fetch(NPM_REGISTRY + encPkg(name) + '/' + encodeURIComponent((ver || 'latest').replace(/^v/, '')), { signal, cache: 'no-store' });
    if (r.status === 404) { const t = await r.text().catch(() => ''); throw new Error(/version not found/i.test(t) ? "no version '" + (ver || 'latest') + "' of " + name : 'package ' + name + ' not found in the npm registry'); }
    if (!r.ok) throw new Error('npm registry error (HTTP ' + r.status + ') for ' + name);
    const j = await r.json();
    return { version: j.version, description: j.description || '', peer: j.peerDependencies || {}, deprecated: j.deprecated };
  }
  async function npmInstall(ctx, args) {
    const { o, rest } = getopt(args, 'DSEgPOf', { 'save-dev': 'D', dev: 'D', save: 'S', 'save-exact': 'E', exact: 'E', global: 'g', 'save-prod': 'P', 'save-optional': 'O', force: 'f', 'legacy-peer-deps': 'L', 'no-save': 'N' });
    if (o.g) { ctx.err('npm: global installs are not possible — packages are per project (npm i <pkg>)'); return 1; }
    let pkg = readPkg();
    if (!rest.length) {
      const deps = Object.assign({}, pkg && pkg.dependencies, pkg && pkg.devDependencies);
      const n = Object.keys(deps).length;
      ctx.note(n ? 'Nothing to install: these ' + plural(n, 'dependency', 'dependencies') + ' load from esm.sh when you preview, run or build — there is no node_modules folder.' : 'No dependencies yet — add one with: npm i <package>');
      return 0;
    }
    const specs = [];
    for (const a of rest) { const s = parseSpec(a); if (s.error) { ctx.err('npm: ' + s.error); return 1; } specs.push(s); }
    ctx.note('Resolving ' + specs.map((s) => s.name + (s.ver ? '@' + s.ver : '')).join(', ') + ' from registry.npmjs.org…');
    let results;
    try { results = await Promise.all(specs.map((s) => resolvePkg(s.name, s.ver, ctx.signal))); }
    catch (e) { if (e && e.name === 'AbortError') throw e; ctx.err('npm: ' + (e && e.code === undefined && /fetch/i.test(e.message) ? 'could not reach the npm registry — check your connection' : oneLine(e.message))); return 1; }
    pkg = readPkg() || newPkg();
    const field = o.D ? 'devDependencies' : 'dependencies', other = o.D ? 'dependencies' : 'devDependencies';
    pkg[field] = Object.assign({}, pkg[field]);
    let s = '';
    specs.forEach((sp, i) => {
      const r = results[i];
      if (pkg[other] && pkg[other][sp.name]) delete pkg[other][sp.name];
      pkg[field][sp.name] = r.version;
      s += ctx.col(A.bgreen, '  + ') + ctx.t(sp.name) + '@' + ctx.col(A.bold, ctx.t(r.version)) + (r.range ? ctx.col(A.gray, '  (range — esm.sh picks the newest match)') : '') + (r.description ? ctx.col(A.gray, '  ' + truncW(oneLine(r.description), 60)) : '') + '\n';
      if (r.deprecated) s += ctx.col(A.yellow, '    deprecated: ' + truncW(oneLine(r.deprecated), 90)) + '\n';
    });
    if (!Object.keys(pkg[other] || {}).length && pkg[other]) delete pkg[other];
    await writePkg(pkg);
    ctx.out(s);
    const all = Object.assign({}, pkg.dependencies, pkg.devDependencies);
    const peers = [];
    results.forEach((r) => { for (const p of Object.keys(r.peer || {})) if (!all[p] && peers.indexOf(p) < 0 && !/^@types\//.test(p)) peers.push(p); });
    ctx.out('Saved ' + plural(specs.length, 'package') + ' to package.json "' + field + '". ' + ctx.col(A.gray, 'They load from esm.sh when you preview, run or build — no node_modules, nothing is downloaded now.') + '\n');
    if (peers.length) ctx.warn('Peer dependencies not installed: ' + peers.join(', ') + ' — add them with: npm i ' + peers.join(' '));
    ctx.out(ctx.col(A.gray, "Use it:  import … from '" + specs[0].name + "'") + '\n');
    return 0;
  }
  async function npmUninstall(ctx, args) {
    const { rest } = getopt(args, 'DSg', { 'save-dev': 'D', save: 'S', global: 'g' });
    if (!rest.length) throw usageErr('npm uninstall needs a package name');
    const pkg = readPkg();
    if (!pkg) { ctx.err('npm: no package.json in this project'); return 1; }
    let n = 0, s = '';
    for (const a of rest) {
      const name = parseSpec(a).name || a;
      let hit = false;
      for (const k of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) if (pkg[k] && pkg[k][name] != null) { delete pkg[k][name]; hit = true; }
      if (hit) { n++; s += ctx.col(A.red, '  - ') + ctx.t(name) + '\n'; } else ctx.warn('npm: ' + oneLine(name) + ' is not a dependency');
    }
    if (n) { await writePkg(pkg); ctx.out(s + 'Removed ' + plural(n, 'package') + ' from package.json.\n'); }
    return n ? 0 : 1;
  }
  function npmLs(ctx) {
    const pkg = readPkg();
    if (!pkg) { ctx.line(ctx.t(projName() || 'project') + ' /'); ctx.line('└── (empty — no package.json; add packages with npm i <pkg>)'); return 0; }
    const rows = [];
    for (const [k, tag] of [['dependencies', ''], ['devDependencies', ' (dev)'], ['peerDependencies', ' (peer)']]) for (const n of Object.keys(pkg[k] || {}).sort()) rows.push(ctx.t(n) + '@' + ctx.t(String(pkg[k][n])) + (tag ? ctx.col(A.gray, tag) : ''));
    let s = ctx.t((pkg.name || projName() || 'project') + (pkg.version ? '@' + pkg.version : '')) + ' ' + ctx.col(A.gray, '/package.json') + '\n';
    if (!rows.length) s += '└── (empty)\n';
    rows.forEach((r, i) => { s += ctx.col(A.gray, i === rows.length - 1 ? '└── ' : '├── ') + r + '\n'; });
    ctx.out(s); return 0;
  }
  async function npmRun(ctx, args) {
    const pkg = readPkg() || {};
    const scripts = pkg.scripts || {};
    const name = args[0];
    if (!name) { const ks = Object.keys(scripts); ctx.out(ks.length ? 'Scripts in package.json:\n' + ks.map((k) => '  ' + ctx.col(A.bold, ctx.t(k)) + '\n    ' + ctx.col(A.gray, ctx.t(scripts[k]))).join('\n') + '\n' : 'No scripts in package.json.\n'); return 0; }
    const cmd = String(scripts[name] != null ? scripts[name] : '');
    let m;
    if ((m = /^(?:node|tsx|ts-node|bun(?: run)?|deno run(?: -A)?)\s+([^\s&|;]+)\s*$/.exec(cmd))) { ctx.note('> ' + oneLine(cmd) + '  (running ' + oneLine(m[1]) + ' in the sandbox)'); return runFile(ctx, m[1]); }
    if ((m = /^python3?\s+([^\s&|;]+)\s*$/.exec(cmd))) { ctx.note('> ' + oneLine(cmd)); return runFile(ctx, m[1], 'python'); }
    if (/^(vite build|next build|tsc\b|esbuild\b|webpack\b|parcel build|rollup\b)/.test(cmd) || (!cmd && name === 'build')) { ctx.note('> ' + (cmd ? oneLine(cmd) + '  (using the built-in build)' : 'build')); return runCommand(['build'], { stdin: null, sink: { tty: ctx.tty, buf: '' }, job: ctx.job }); }
    if (/^(vite|next dev|next start|parcel|serve|http-server|live-server|react-scripts start|webpack serve)\b/.test(cmd) || (!cmd && /^(dev|start|serve|preview)$/.test(name))) { ctx.note('> ' + (cmd ? oneLine(cmd) + '  (using the built-in live preview)' : 'preview')); return runCommand(['preview'], { stdin: null, sink: { tty: ctx.tty, buf: '' }, job: ctx.job }); }
    if (!cmd) { ctx.err('npm: missing script: ' + oneLine(name)); return 1; }
    ctx.err("npm: can't run \"" + oneLine(cmd) + '" — there is no Node.js process here. Use run <file>, preview or build.');
    return 1;
  }
  def('npm', {
    usage: 'npm <install|uninstall|ls|init|run|view> …', desc: 'Manage package.json dependencies (pinned versions; packages load from esm.sh).', project: true, ownHelp: false,
    subs: ['install', 'i', 'add', 'uninstall', 'remove', 'rm', 'ls', 'list', 'init', 'run', 'start', 'view', 'info'],
    opts: [['install|i <pkg>[@ver]…', 'add packages (latest version is resolved and pinned); -D for devDependencies'], ['uninstall <pkg>…', 'remove packages'], ['ls', 'list dependencies'], ['init [-y]', 'create package.json'], ['run [script]', 'run a package.json script via the built-in run/preview/build'], ['view <pkg>', 'show the latest version and description']],
    more: 'There is no node_modules: when you preview, run or build, imports like `import confetti from "canvas-confetti"` load from https://esm.sh/<pkg>@<version>.',
    async run(ctx) {
      const sub = ctx.args[0], rest = ctx.args.slice(1);
      switch (sub) {
        case 'install': case 'i': case 'add': case 'in': case 'isntall': return npmInstall(ctx, rest);
        case 'uninstall': case 'remove': case 'rm': case 'un': case 'r': case 'unlink': return npmUninstall(ctx, rest);
        case 'ls': case 'list': case 'la': case 'll': return npmLs(ctx);
        case 'init': {
          if (S.fs.exists('package.json')) { ctx.err('npm: package.json already exists'); return 1; }
          const p = newPkg(); await writePkg(p); ctx.out('Wrote /package.json:\n' + ctx.t(JSON.stringify(p, null, 2)) + '\n'); return 0;
        }
        case 'run': case 'run-script': return npmRun(ctx, rest);
        case 'start': case 'test': return npmRun(ctx, [sub]);
        case 'view': case 'info': case 'show': case 'v': {
          const sp = parseSpec(rest[0]); if (!rest[0] || sp.error) throw usageErr(sp.error || 'npm view needs a package name');
          const r = await resolvePkg(sp.name, sp.ver, ctx.signal);
          ctx.out(ctx.col(A.bold, ctx.t(sp.name) + '@' + ctx.t(r.version)) + (r.description ? '\n' + ctx.t(r.description) : '') + '\n' + ctx.col(A.gray, 'https://www.npmjs.com/package/' + sp.name) + '\n');
          return 0;
        }
        case undefined: case 'help': case '-h': ctx.out(helpFor('npm', ctx.tty)); return 0;
        case '-v': case '--version': ctx.line('ost-npm (package.json manager · packages from esm.sh)'); return 0;
        case 'update': case 'up': case 'upgrade': case 'outdated': case 'audit': case 'ci': case 'publish': case 'link': case 'exec': case 'x':
          ctx.err('npm ' + oneLine(sub) + ": isn't available here. Pin a new version with npm i <pkg>@latest."); return 1;
        default: ctx.err("npm: unknown command '" + oneLine(sub) + "' — try npm --help"); return 1;
      }
    }
  });

  /* ======================================================================
   * git clone — public GitHub repositories, as a snapshot of files
   * ==================================================================== */
  const SKIP_SEGS = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.nuxt', '.svelte-kit', '.cache', '.parcel-cache', '.turbo', '.vercel', 'coverage', '__pycache__', '.venv', 'venv', 'bower_components']);
  const LOCKFILES = /^(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|composer\.lock|Gemfile\.lock|Cargo\.lock|poetry\.lock|Pipfile\.lock|.*\.lock)$/i;
  const IMG_EXT = /^(png|jpe?g|gif|webp|avif|ico|bmp)$/;
  function parseRepo(u) {
    let s = String(u || '').trim().replace(/^git\+/, '').replace(/^git@github\.com:/i, 'https://github.com/');
    if (/^[\w.-]+\/[\w.-]+$/.test(s)) s = 'https://github.com/' + s;
    if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
    let url; try { url = new URL(s); } catch (_) { return null; }
    if (!/^(www\.)?github\.com$/i.test(url.hostname)) return null;
    const segs = url.pathname.split('/').filter(Boolean).map((x) => { try { return decodeURIComponent(x); } catch (_) { return x; } });
    if (segs.length < 2) return null;
    const owner = segs[0], repo = segs[1].replace(/\.git$/i, '');
    if (!/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repo)) return null;
    const tree = (segs[2] === 'tree' || segs[2] === 'blob') && segs.length > 3 ? segs.slice(3) : null;
    return { owner, repo, tree };
  }
  async function ghJson(path, signal) {
    let r;
    for (let attempt = 0; ; attempt++) {
      try { r = await fetch(GH_API + path, { signal, headers: { Accept: 'application/vnd.github+json' }, cache: 'no-store' }); break; }
      catch (e) { if ((e && e.name === 'AbortError') || attempt >= 2) { if (e && e.name === 'AbortError') throw e; throw new Error('could not reach api.github.com — check your connection'); } }
      await new Promise((res) => setTimeout(res, 500 * (attempt + 1)));
    }
    if (r.status === 404) { const e = new Error('not found'); e.status = 404; throw e; }
    if (r.status === 403 || r.status === 429) {
      const rem = r.headers.get('x-ratelimit-remaining'), reset = Number(r.headers.get('x-ratelimit-reset')) * 1000;
      if (rem === '0' || r.status === 429) throw new Error('GitHub API rate limit reached (60 requests/hour per network without sign-in)' + (reset ? ' — try again after ' + new Date(reset).toLocaleTimeString() : ''));
      throw new Error('GitHub refused the request (HTTP 403)');
    }
    if (!r.ok) throw new Error('GitHub API error (HTTP ' + r.status + ')');
    return r.json();
  }
  const rawUrl = (o, r, branch, path) => GH_RAW + '/' + encodeURIComponent(o) + '/' + encodeURIComponent(r) + '/' + branch.split('/').map(encodeURIComponent).join('/') + '/' + path.split('/').map(encodeURIComponent).join('/');
  function projectIsEmpty(ix) { return ix.files.every((f) => U.baseOf(f.path) === '.gitkeep' || (f.path === 'README.md' && /^#\s*New project\s*$/.test(String(S.fs.read('README.md') || '').trim()))); }
  async function gitClone(ctx, args) {
    const { o, rest } = getopt(args, 'bq', { branch: 'b', quiet: 'q', depth: 'depth', 'single-branch': 'sb', recursive: 'rec' }, ['b', 'depth']);
    if (!rest.length) throw usageErr('you must specify a repository to clone');
    const m = parseRepo(rest[0]);
    if (!m) { ctx.err('git clone: only public GitHub repositories are supported — e.g. git clone https://github.com/owner/repo'); return 1; }
    const { owner, repo } = m;
    const repoPath = '/repos/' + encodeURIComponent(owner) + '/' + encodeURIComponent(repo);
    let branch = o.b || '', sub = '', tree = null;
    const progress = (s) => { if (ctx.tty && ctx.job.alive) termWrite('\r\x1b[K' + s); };
    progress(A.gray + 'Contacting GitHub…' + A.reset);
    try {
      if (!branch && m.tree) {
        for (let k = 1; k <= m.tree.length && !tree; k++) {
          const cand = m.tree.slice(0, k).join('/');
          try { tree = await ghJson(repoPath + '/git/trees/' + encodeURIComponent(cand) + '?recursive=1', ctx.signal); branch = cand; sub = m.tree.slice(k).join('/'); }
          catch (e) { if (e.status !== 404) throw e; }
        }
        if (!tree) { const e = new Error('not found'); e.status = 404; throw e; }
      } else {
        if (!branch) branch = (await ghJson(repoPath, ctx.signal)).default_branch || 'main';
        tree = await ghJson(repoPath + '/git/trees/' + encodeURIComponent(branch) + '?recursive=1', ctx.signal);
      }
    } catch (e) {
      progress('');
      if (e && e.name === 'AbortError') throw e;
      ctx.err('git clone: ' + (e.status === 404 ? 'repository ' + owner + '/' + repo + (branch && o.b ? ' (branch ' + branch + ')' : '') + ' not found — only public GitHub repositories can be cloned' : oneLine(e.message)));
      return 1;
    }
    progress('');
    const ix = fsIndex();
    // destination
    let destArg = rest[1], dest;
    const defName = (sub ? U.baseOf(sub) : repo).replace(/[^\w.-]+/g, '-');
    if (destArg != null) dest = ctx.resolve(destArg);
    else {
      dest = resolvePath(defName, T.cwd);
      if (!T.cwd && projectIsEmpty(ix) && await ctx.ask('This project is empty — clone ' + owner + '/' + repo + ' into the project root instead of ' + defName + '/? ', true)) dest = '';
      if (!ctx.job.alive || ctx.signal.aborted) return 130;
    }
    if (ix.isFile(dest)) { ctx.err("git clone: destination '" + oneLine(destArg || defName) + "' is a file"); return 1; }
    if (dest && ix.isDir(dest) && filesUnder(ix, dest).some((f) => U.baseOf(f.path) !== '.gitkeep')) { progress(''); ctx.err("fatal: destination path '" + oneLine(destArg || defName) + "' already exists and is not an empty directory — try: git clone " + oneLine(rest[0]) + ' another-name'); return 1; }
    if (!dest && !projectIsEmpty(ix)) { progress(''); ctx.err('git clone: the project root is not empty — clone into a folder instead: git clone ' + oneLine(rest[0]) + ' ' + defName); return 1; }
    // pick files
    const pre = sub ? sub + '/' : '';
    const skipped = { binary: 0, big: 0, ignored: 0, limit: 0 };
    const picks = [];
    let bytes = 0;
    const room = Math.max(0, S.limits.files - ix.files.length);
    const maxFiles = Math.min(CLONE_MAX_FILES, room);
    for (const e of (tree.tree || [])) {
      if (e.type !== 'blob' || (pre && e.path.indexOf(pre) !== 0)) continue;
      const rel = e.path.slice(pre.length);
      if (!rel || rel.split('/').some((seg) => SKIP_SEGS.has(seg)) || LOCKFILES.test(U.baseOf(rel)) || U.baseOf(rel) === '.DS_Store') { skipped.ignored++; continue; }
      if (!U.normPath(rel)) { skipped.ignored++; continue; }
      const x = U.extOf(rel), size = Number(e.size) || 0;
      const img = IMG_EXT.test(x);
      if (!img && !U.isTextPath(rel)) { skipped.binary++; continue; }
      if (size > S.limits.fileBytes || (img && size > CLONE_IMG_MAX)) { skipped.big++; continue; }
      if (picks.length >= maxFiles || bytes + size > CLONE_MAX_BYTES) { skipped.limit++; continue; }
      picks.push({ path: e.path, rel, size, img }); bytes += size;
    }
    const where = dest ? dest + '/' : '';
    ctx.tty_('Cloning into ' + A.bold + (dest ? "'" + oneLine(dest) + "'" : 'the project root') + A.reset + ' from github.com/' + oneLine(owner + '/' + repo) + ' (' + oneLine(branch) + (sub ? ', ' + oneLine(sub) : '') + ')…\n');
    if (tree.truncated) ctx.warn('warning: this repository is very large — GitHub returned only part of its file list.');
    if (!picks.length) { ctx.err('git clone: nothing to clone (no text files or small images' + (skipped.limit ? ', or the project is full' : '') + ').'); return 1; }
    // download (6 at a time)
    const got = new Array(picks.length);
    let done = 0, recv = 0, next = 0, last = 0, failed = 0;
    const tick = (force) => { const now = Date.now(); if (!force && now - last < 120) return; last = now; progress('Receiving files: ' + Math.floor((done / picks.length) * 100) + '% (' + done + '/' + picks.length + '), ' + U.fmtBytes(recv)); };
    const worker = async () => {
      while (next < picks.length) {
        const i = next++, f = picks[i];
        if (ctx.signal.aborted) return;
        try {
          let r;
          for (let attempt = 0; ; attempt++) {
            try { r = await fetch(rawUrl(owner, repo, branch, f.path), { signal: ctx.signal }); if (r.ok || r.status === 404 || attempt >= 2) break; }
            catch (e) { if ((e && e.name === 'AbortError') || attempt >= 2) throw e; }
            await new Promise((res) => setTimeout(res, 400 * (attempt + 1)));
          }
          if (!r.ok) throw new Error('HTTP ' + r.status);
          if (f.img) { const b = new Uint8Array(await r.arrayBuffer()); got[i] = { content: 'data:' + U.mimeOf(f.rel) + ';base64,' + U.bytesToB64(b), binary: true }; recv += b.length; }
          else { const t = await r.text(); if (t.indexOf('\u0000') >= 0) { skipped.binary++; got[i] = null; } else { got[i] = { content: t, binary: false }; recv += f.size || t.length; } }
        } catch (e) { if (e && e.name === 'AbortError') return; failed++; got[i] = null; }
        done++; tick();
      }
    };
    await Promise.all(Array.from({ length: Math.min(6, picks.length) }, worker));
    if (ctx.signal.aborted || !ctx.job.alive) { progress(''); ctx.tty_('Clone interrupted — nothing was written.\n'); return 130; }
    progress(''); ctx.tty_('Receiving files: 100% (' + done + '/' + picks.length + '), ' + U.fmtBytes(recv) + ', done.\n');
    // write
    let written = 0, wbytes = 0; const errs = [];
    for (let i = 0; i < picks.length; i++) {
      const g = got[i]; if (!g) continue;
      try { await S.fs.write(where + picks[i].rel, g.content, { source: 'terminal', binary: g.binary }); written++; wbytes += picks[i].size; }
      catch (e) { errs.push(oneLine(e.message)); if (/limited to \d+ files/.test(e.message)) break; }
    }
    if (written) bus.emit('fs:bulk', { source: 'terminal' });
    if (!written) { ctx.err('git clone: no files could be ' + (errs.length ? 'saved' : 'downloaded from raw.githubusercontent.com') + ' — check your connection and try again.'); for (const e of errs.slice(0, 3)) ctx.err('  ' + e); return 1; }
    ctx.out(ctx.col(A.bgreen, '✓ Cloned ') + plural(written, 'file') + ' (' + U.fmtBytes(wbytes) + ') into ' + ctx.t(dest ? dest + '/' : 'the project root') + '\n');
    const sk = [skipped.ignored && skipped.ignored + ' ignored (node_modules, build output, lockfiles…)', skipped.binary && skipped.binary + ' binary', skipped.big && skipped.big + ' too large', skipped.limit && skipped.limit + ' over the ' + CLONE_MAX_FILES + '-file / ' + U.fmtBytes(CLONE_MAX_BYTES) + ' clone limit', failed && failed + ' failed to download'].filter(Boolean);
    if (sk.length) ctx.note('Skipped: ' + sk.join(', ') + '.');
    for (const e of errs.slice(0, 3)) ctx.err('  ' + e);
    const hasPkg = S.fs.exists(where + 'package.json');
    if (hasPkg) ctx.note('package.json dependencies load from esm.sh when you preview or build — no npm install needed.');
    if (S.fs.exists(where + 'index.html')) ctx.note('Preview it with: preview ' + (where ? where + 'index.html' : ''));
    ctx.note('This is a snapshot of the files — there is no git history here, and changes sync to your OST cloud copy, not to GitHub.');
    return failed || errs.length ? 1 : 0;
  }
  def('git', {
    usage: 'git clone <https://github.com/owner/repo[/tree/branch/folder]> [folder] [-b branch]', desc: 'Copy a public GitHub repository (text files + small images) into the project.', project: true, noPaths: true, subs: ['clone'],
    more: 'Skips node_modules, .git, dist, build and lockfiles; at most ' + CLONE_MAX_FILES + ' files / ' + U.fmtBytes(CLONE_MAX_BYTES) + '.\nOnly git clone exists here: projects sync to your OST cloud automatically (see `sync`); there is no commit/push.',
    run(ctx) {
      const sub = ctx.args[0];
      if (sub === 'clone') return gitClone(ctx, ctx.args.slice(1));
      if (!sub || sub === 'help') { ctx.out(helpFor('git', ctx.tty)); return 0; }
      if (sub === '--version' || sub === 'version') { ctx.line('ost git-clone (GitHub snapshots over HTTPS)'); return 0; }
      ctx.err("git: '" + oneLine(sub) + "' is not available — only git clone works here. Your project already syncs to the OST cloud (run `sync`); to download it run `zip`.");
      return 1;
    }
  });

  /* ======================================================================
   * project, identity, misc
   * ==================================================================== */
  def('agent', {
    usage: 'agent "<what to do>"', desc: 'Ask the AI coding agent to change the project (it works in the Agent panel).', project: true, noPaths: true,
    async run(ctx) {
      const prompt = ctx.args.join(' ').trim();
      if (!prompt) throw usageErr('tell the agent what to do, e.g. agent "add a dark mode toggle"');
      if (!S.agent || typeof S.agent.ask !== 'function') { ctx.err('agent: the AI Agent module is not loaded in this build'); return 1; }
      ctx.onInterrupt(() => { try { if (typeof S.agent.stop === 'function') S.agent.stop(); } catch (_) {} });
      ctx.note('Asked the agent — follow its work in the AI Agent panel. Ctrl+C stops it.');
      const r = await S.agent.ask(prompt);
      if (!ctx.job.alive) return 130;
      const text = typeof r === 'string' ? r : r && (r.text || r.content || r.message && (r.message.content || r.message) || r.reply || r.answer);
      if (text && typeof text === 'string') ctx.out(ctx.t(text.replace(/\n+$/, '')) + '\n');
      const ch = r && Array.isArray(r.changes) ? r.changes : [];
      if (ch.length) {
        const col = { A: A.bgreen, D: A.red, M: A.byellow };
        ctx.out(ctx.col(A.bold, 'Changed ' + plural(ch.length, 'file') + ':') + '\n' + ch.slice(0, 40).map((c) => '  ' + ctx.col(col[c.status] || '', (c.status || '•') + ' ' + ctx.t(c.path || '')) + (c.add || c.del ? ctx.col(A.gray, '  +' + (c.add || 0) + ' −' + (c.del || 0)) : '')).join('\n') + '\n' + (ch.length > 40 ? ctx.col(A.gray, '  … ' + (ch.length - 40) + ' more') + '\n' : ''));
      }
      if (r && r.stopped) { ctx.note('Stopped.'); return 130; }
      if (r && r.error) { ctx.err('agent: ' + oneLine(r.error)); return 1; }
      return r && r.ok === false ? 1 : 0;
    }
  });
  def('sync', {
    usage: 'sync', desc: 'Sync the project with your OST cloud space now.', project: true, noPaths: true,
    async run(ctx) {
      try { await S.projects.syncNow(); } catch (e) { ctx.err('sync: ' + oneLine(e.message)); return 1; }
      const st = S.projects.syncState();
      const msg = { synced: ctx.col(A.bgreen, '✓ synced') + ' — your files are saved in your OST cloud space.', syncing: 'syncing… changes are uploading.', local: ctx.col(A.yellow, 'local only') + ' — this project uploads once your studio identity is registered.', offline: ctx.col(A.yellow, 'offline') + ' — changes are kept in this browser and upload when you reconnect.', error: ctx.col(A.red, 'sync error') + ' — your files are safe in this browser; see the sync status in the status bar.' }[st] || st;
      ctx.out(msg + '\n');
      return st === 'error' ? 1 : 0;
    }
  });
  def('zip', { usage: 'zip', desc: 'Download the project as a .zip file.', project: true, noPaths: true, async run(ctx) { await S.projects.exportZip(); ctx.note('Downloading ' + oneLine(S.projects.current().name) + '.zip'); return 0; } });
  def('whoami', {
    usage: 'whoami', desc: 'Show your OST identity (shared with OST Mesh and Social).', noPaths: true,
    run(ctx) {
      ctx.out((S.id.name ? ctx.col(A.bold, ctx.t(S.id.name)) : ctx.col(A.gray, '(no display name — set one in OST Social)')) + '\n' +
        '  address      ' + ctx.t(S.id.address || '(not ready)') + '\n' + '  fingerprint  ' + ctx.t(S.id.fingerprint || '—') + '\n' +
        '  registered   ' + (S.id.announced ? ctx.col(A.bgreen, 'yes') : ctx.col(A.yellow, 'not yet (cloud sync starts once it is)')) + '\n');
      return 0;
    }
  });
  def('date', {
    usage: 'date [-u] [-I]', desc: 'Print the date and time.', noPaths: true,
    run(ctx) { const { o } = getopt(ctx.args, 'uIR', { utc: 'u', iso: 'I' }); const d = new Date(); ctx.line(o.I ? d.toISOString() : o.u ? d.toUTCString() : d.toString()); return 0; }
  });
  def('env', {
    usage: 'env', desc: 'Show the shell variables and information about this Studio session.', noPaths: true,
    run(ctx) {
      const p = S.projects.current(), v = envVars();
      const rows = Object.entries(v);
      if (p) {
        const files = S.fs.list();
        rows.push(['PROJECT_TEMPLATE', p.template || ''], ['PROJECT_KIND', U.projectKind()], ['ENTRY', U.entryFor()], ['FILES', String(files.length)], ['PROJECT_SIZE', U.fmtBytes(files.reduce((n, f) => n + (f.size || 0), 0))], ['SYNC', S.projects.syncState()]);
      }
      rows.push(['STUDIO_ID', S.id.address || ''], ['STUDIO_API', S.API], ['APPS_HOST', S.APPS], ['TERMINAL', T.mode === 'xterm' ? 'xterm.js 5.5.0' : 'basic (xterm.js unavailable)'],
        ['RUNTIMES', 'JS/TS: sandboxed worker · Python: Pyodide 0.26.4 · bundler: esbuild-wasm 0.24.2'], ['NOTE', 'no OS shell; code runs only in browser sandboxes; OST hosts static web apps']);
      ctx.out(rows.map(([k, val]) => ctx.col(A.bcyan, k) + '=' + ctx.t(val)).join('\n') + '\n');
      return 0;
    }
  });
  def('history', {
    usage: 'history [-c] [n]', desc: 'Show the command history of this project (↑/↓ walk through it). -c clears it.', noPaths: true,
    run(ctx) {
      loadHist();
      if (ctx.args[0] === '-c') { T.hist = []; saveHist(); return 0; }
      const n = ctx.args[0] ? Math.max(1, parseInt(ctx.args[0], 10) || 10) : T.hist.length;
      const start = Math.max(0, T.hist.length - n);
      ctx.out(T.hist.slice(start).map((h, i) => ctx.col(A.gray, padStart(String(start + i + 1), 5)) + '  ' + ctx.t(h)).join('\n') + (T.hist.length ? '\n' : ''));
      return 0;
    }
  });
  def('exit', { usage: 'exit', desc: 'Hide the terminal panel (Ctrl/Cmd+J brings it back).', noPaths: true, run() { setTimeout(() => S.ui.togglePanel(false), 0); return 0; } });

  /* ======================================================================
   * UI: panel, xterm (lazy), DOM fallback, input row for touch devices
   * ==================================================================== */
  function welcome() {
    if (T.welcomed) return; T.welcomed = true;
    const b = (s) => A.bold + s + A.reset, g = (s) => A.gray + s + A.reset, k = (s) => A.bcyan + s + A.reset;
    termWrite(b('OST Studio terminal') + g(' · built-in shell for your project') + '\n' +
      '  ' + k('help') + '  commands   ' + k('ls') + ' ' + k('cat') + ' ' + k('grep') + ' ' + k('mv') + ' ' + k('rm') + '  files\n' +
      '  ' + k('run') + ' ' + k('node') + ' ' + k('python') + '  run code in a sandbox\n' +
      '  ' + k('npm i') + ' <pkg>   ' + k('git clone') + ' <github url>\n' +
      '  ' + k('build') + ' · ' + k('deploy') + ' <name>  publish a static web app\n' +
      g('Not an OS shell: code runs in browser sandboxes,') + '\n' +
      g('and OST hosts static web apps (HTML/CSS/JS).') + '\n');
  }
  function themeObj() {
    const cs = getComputedStyle(document.documentElement);
    const v = (n, d) => (cs.getPropertyValue(n) || '').trim() || d;
    if (T.light) return { background: v('--st-bg', '#ffffff'), foreground: v('--st-text', '#1f2328'), cursor: v('--st-accent', '#0969da'), cursorAccent: '#ffffff', selectionBackground: 'rgba(9,105,218,0.25)', black: '#24292f', red: '#cf222e', green: '#116329', yellow: '#9a6700', blue: '#0969da', magenta: '#8250df', cyan: '#1b7c83', white: '#6e7781', brightBlack: '#57606a', brightRed: '#a40e26', brightGreen: '#1a7f37', brightYellow: '#7d4e00', brightBlue: '#218bff', brightMagenta: '#a475f9', brightCyan: '#3192aa', brightWhite: '#8c959f' };
    return { background: v('--st-bg', '#0d1117'), foreground: v('--st-text', '#d6dde7'), cursor: v('--st-accent', '#4c8dff'), cursorAccent: v('--st-bg', '#0d1117'), selectionBackground: 'rgba(76,141,255,0.35)', black: '#484f58', red: '#ff7b72', green: '#3fb950', yellow: '#d29922', blue: '#58a6ff', magenta: '#bc8cff', cyan: '#39c5cf', white: '#b1bac4', brightBlack: '#6e7681', brightRed: '#ffa198', brightGreen: '#56d364', brightYellow: '#e3b341', brightBlue: '#79c0ff', brightMagenta: '#d2a8ff', brightCyan: '#56d4dd', brightWhite: '#f0f6fc' };
  }
  function monoFont() { return (getComputedStyle(document.documentElement).getPropertyValue('--st-mono') || '').trim() || 'ui-monospace, Menlo, Consolas, monospace'; }
  const touchDevice = () => { try { return window.matchMedia('(pointer: coarse)').matches || S.ui.isMobile(); } catch (_) { return S.ui.isMobile(); } };
  function visible() { return !!(T.panel && !T.panel.hidden && !document.body.classList.contains('st-panel-hidden')); }
  function loadScript(src, tries) {
    tries = tries == null ? 2 : tries;
    return loadScriptOnce(src).catch((e) => (tries > 1 ? new Promise((r) => setTimeout(r, 600)).then(() => loadScript(src, tries - 1)) : Promise.reject(e)));
  }
  function loadScriptOnce(src) {
    return new Promise((res, rej) => {
      const s = document.createElement('script'); s.src = src; s.async = true; s.crossOrigin = 'anonymous';
      const t = setTimeout(() => rej(new Error('timed out loading ' + src)), LOAD_TIMEOUT);
      s.onload = () => { clearTimeout(t); res(); }; s.onerror = () => { clearTimeout(t); s.remove(); rej(new Error('could not load ' + src)); };
      document.head.appendChild(s);
    });
  }
  // xterm's stylesheet is optional: terminal.css carries its critical rules, so a failed load only retries once.
  function loadCss(href, tries) {
    tries = tries == null ? 2 : tries;
    return new Promise((res) => {
      const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href; l.crossOrigin = 'anonymous'; l.setAttribute('data-st-terminal', '');
      const t = setTimeout(res, 6000);
      l.onload = () => { clearTimeout(t); res(); };
      l.onerror = () => { clearTimeout(t); l.remove(); if (tries > 1) setTimeout(() => loadCss(href, tries - 1).then(res), 600); else res(); };
      document.head.appendChild(l);
    });
  }
  function buildPanel(body) {
    T.panel = body;
    body.classList.add('st-terminal-panel');
    body.innerHTML = '<div class="st-terminal-host" aria-label="Terminal"><div class="st-terminal-loading">Starting terminal…</div></div>' +
      '<form class="st-terminal-row" autocomplete="off" hidden>' +
      '<label class="st-terminal-ps" for="stTermIn"></label>' +
      '<input id="stTermIn" class="st-terminal-in" type="text" autocapitalize="off" autocomplete="off" autocorrect="off" spellcheck="false" enterkeyhint="send" aria-label="Terminal command">' +
      '<button type="button" class="st-terminal-key" data-k="tab" title="Complete (Tab)" aria-label="Complete">⇥</button>' +
      '<button type="button" class="st-terminal-key" data-k="up" title="Previous command" aria-label="Previous command">↑</button>' +
      '<button type="button" class="st-terminal-key" data-k="int" title="Stop (Ctrl+C)" aria-label="Stop running command">^C</button>' +
      '<button type="submit" class="st-terminal-run">Run</button></form>';
    T.host = body.querySelector('.st-terminal-host');
    T.row = body.querySelector('.st-terminal-row');
    T.rowIn = body.querySelector('.st-terminal-in');
    T.rowPs = body.querySelector('.st-terminal-ps');
    T.row.addEventListener('submit', (e) => { e.preventDefault(); rowSubmit(); });
    T.row.addEventListener('pointerdown', (e) => { if (e.target.closest('button')) e.preventDefault(); });   // keep the keyboard open
    T.row.addEventListener('click', (e) => {
      const b = e.target.closest('[data-k]'); if (!b) return;
      const k = b.getAttribute('data-k');
      if (k === 'int') { if (T.busy) interrupt(); else { T.rowIn.value = ''; T.rowHIdx = -1; } }
      else if (k === 'up') rowHist(-1);
      else if (k === 'tab') rowTab();
      try { T.rowIn.focus(); } catch (_) {}
    });
    T.rowIn.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowUp') { e.preventDefault(); rowHist(-1); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); rowHist(1); }
      else if (e.key === 'Tab') { e.preventDefault(); rowTab(); }
      else if (e.key === 'Escape') { T.rowIn.value = ''; T.rowHIdx = -1; }
      else if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C') && T.rowIn.selectionStart === T.rowIn.selectionEnd && T.busy) { e.preventDefault(); interrupt(); }
      else if (e.ctrlKey && (e.key === 'l' || e.key === 'L')) { e.preventDefault(); clearScreen(); }
    });
    // tap anywhere on the terminal → focus it (opens the phone keyboard)
    let down = null;
    T.host.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: Date.now() }; });
    T.host.addEventListener('pointerup', (e) => {
      if (!down) return; const moved = Math.abs(e.clientX - down.x) + Math.abs(e.clientY - down.y); down = null;
      if (moved > 12) return;
      const sel = window.getSelection && String(window.getSelection());
      if (T.term && T.term.hasSelection()) return;
      if (sel && T.mode === 'dom') return;
      focusTerm();
    });
    paintRow(); paintRowPrompt();
  }
  function paintRow() {
    if (!T.row) return;
    const on = T.mode === 'dom' || T.rowPref === 'on' || (T.rowPref === 'auto' && touchDevice());
    if (T.row.hidden === !on) return;
    T.row.hidden = !on;
    scheduleFit();
  }
  function paintRowBusy() { if (T.row) T.row.classList.toggle('busy', !!T.busy); paintRowPrompt(); }
  function rowSubmit() {
    const v = T.rowIn.value;
    T.rowIn.value = ''; T.rowHIdx = -1; T.rowDraft = '';
    const ed = T.ed;
    if (ed.active && ed.kind === 'ask') {
      if (T.mode === 'xterm') { setBuf(v); acceptLine(); }
      else { termWrite(clean(v) + '\n'); ed.active = false; const r = ed.resolve; ed.resolve = null; ed.kind = 'cmd'; paintRowPrompt(); if (r) r(v); }
      return;
    }
    if (T.mode === 'xterm' && ed.active && !T.busy) { setBuf(v); drawLine(); acceptLine(); return; }
    enqueue(v, { interactive: true, history: true });
  }
  function rowHist(d) {
    loadHist();
    if (!T.hist.length) return;
    if (T.rowHIdx === -1) { if (d > 0) return; T.rowDraft = T.rowIn.value; T.rowHIdx = T.hist.length - 1; }
    else T.rowHIdx = Math.max(0, T.rowHIdx + d);
    if (T.rowHIdx >= T.hist.length) { T.rowHIdx = -1; T.rowIn.value = T.rowDraft; }
    else T.rowIn.value = T.hist[T.rowHIdx];
    const n = T.rowIn.value.length; try { T.rowIn.setSelectionRange(n, n); } catch (_) {}
  }
  function rowTab() {
    const r = completeText(T.rowIn.value, T.rowIn.selectionStart == null ? T.rowIn.value.length : T.rowIn.selectionStart);
    if (r.list) { printAbove(listCompletions(r.list)); return; }
    T.rowIn.value = r.line; try { T.rowIn.setSelectionRange(r.pos, r.pos); } catch (_) {}
  }
  function scheduleFit() { if (T.fitRaf) return; T.fitRaf = requestAnimationFrame(() => { T.fitRaf = 0; fitNow(); }); }
  function fitNow() {
    if (!T.booted) return;
    paintRow();
    if (!visible()) return;
    if (!T.started) { start(); return; }
    if (T.loaded && T.mode === 'none') { mountXterm(); return; }
    if (T.mode !== 'xterm' || !T.fit) return;
    const r = T.host.getBoundingClientRect();
    if (r.width < 40 || r.height < 30) return;
    try { T.fit.fit(); } catch (_) {}
  }
  function start() {
    if (T.started) return; T.started = true;
    loadCss(XTERM_CSS);
    Promise.resolve(window.Terminal ? null : loadScript(XTERM_JS))
      .then(() => (window.FitAddon ? null : loadScript(FIT_JS).catch(() => null)))
      .then(() => { if (typeof window.Terminal !== 'function') throw new Error('xterm.js did not initialise'); T.loaded = true; if (visible()) mountXterm(); })
      .catch((e) => { T.failed = e && e.message || 'xterm.js unavailable'; mountDom(); });
  }
  function afterMount() {
    welcome();
    if (T.pending) { const p = T.pending; T.pending = ''; termWrite(p); }
    paintRow();
    if (!T.busy && !pump()) showPrompt();
  }
  function mountXterm() {
    if (T.mode !== 'none' || !visible()) return;
    const r = T.host.getBoundingClientRect();
    if (r.width < 40 || r.height < 30) return;
    T.host.textContent = '';
    let term;
    try {
      term = new window.Terminal({
        cursorBlink: true, convertEol: true, scrollback: 5000, fontFamily: monoFont(), fontSize: S.ui.isMobile() ? 12 : 13, lineHeight: 1.2,
        theme: themeObj(), macOptionIsMeta: true, allowProposedApi: false, drawBoldTextInBrightColors: false, smoothScrollDuration: 0, altClickMovesCursor: false
      });
      if (window.FitAddon && typeof window.FitAddon.FitAddon === 'function') { T.fit = new window.FitAddon.FitAddon(); term.loadAddon(T.fit); }
      term.open(T.host);
    } catch (e) { T.failed = e && e.message || 'xterm.js failed'; try { if (term) term.dispose(); } catch (_) {} T.term = null; T.fit = null; mountDom(); return; }
    T.term = term; T.mode = 'xterm';
    term.onData(onData);
    term.onResize(() => { const ed = T.ed; if (ed.active) ed.row = Math.floor(offsetAt(ed.cur) / cols()); });
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true;
      const mod = e.ctrlKey || e.metaKey, k = e.key && e.key.toLowerCase();
      if (mod && k === 'c' && (e.shiftKey || term.hasSelection())) return false;   // copy the selection (browser copy event)
      if (mod && k === 'v') return false;                                          // paste through the browser paste event
      if (e.shiftKey && e.key === 'Insert') return false;
      return true;
    });
    try { T.fit && T.fit.fit(); } catch (_) {}
    afterMount();
  }
  function mountDom() {
    if (T.mode !== 'none') return;
    T.mode = 'dom';
    T.host.innerHTML = '<div class="st-terminal-log" role="log" aria-live="polite"></div>';
    T.log = T.host.firstChild;
    T.ed.active = false;
    termWrite(A.yellow + 'The full terminal (xterm.js) could not load' + (T.failed ? ' (' + oneLine(T.failed) + ')' : '') + ' — using the basic terminal. Type commands in the box below.' + A.reset + '\n');
    afterMount();
  }
  function focusTerm() {
    if (T.mode === 'xterm' && T.term) { try { T.term.focus(); } catch (_) {} }
    else if (T.rowIn && !T.row.hidden) { try { T.rowIn.focus(); } catch (_) {} }
  }
  function clearScreen() {
    if (T.mode === 'xterm') { T.term.clear(); termWrite('\x1b[H\x1b[2J'); T.ed.row = 0; if (T.ed.active) drawLine(); }
    else if (T.mode === 'dom') { T.log.textContent = ''; D.line = null; }
    else T.pending = '';
  }

  /* ======================================================================
   * public API
   * ==================================================================== */
  function writeExternal(text, nl) {
    let s = clean(text) + (nl ? '\n' : '');
    if (T.busy || T.mode === 'none' || !T.ed.active) termWrite(s);
    else printAbove(s);
  }
  S.terminal = {
    exec(line, opts) { return enqueue(line, { interactive: !!(opts && opts.interactive), history: !!(opts && opts.history) }); },
    write(text) { writeExternal(text, false); },
    writeln(text) { writeExternal(text, true); },
    focus() { S.ui.showPanel('terminal'); setTimeout(() => { fitNow(); focusTerm(); }, 30); },
    clear: clearScreen,
    cwd: () => T.cwd,
    commands: () => [...CMDS.keys()],
    isBusy: () => T.busy
  };

  /* ======================================================================
   * wiring
   * ==================================================================== */
  buildPanel(S.ui.registerPanel({ id: 'terminal', title: 'Terminal', order: 10 }));
  if (S.settings.get('terminal.lastPanel', 'terminal') === 'terminal') S.ui.showPanel('terminal', true);
  S.ui.registerCommand({ id: 'terminal.focus', title: 'Terminal: Focus terminal', key: 'Mod+Alt+T', run: () => S.terminal.focus() });
  S.ui.registerCommand({ id: 'terminal.toggle', title: 'Terminal: Toggle terminal', key: 'Mod+`', run: () => { if (visible()) S.ui.togglePanel(false); else S.terminal.focus(); } });
  function newSession() {
    if (T.busy) interrupt(true);
    T.cwd = ''; T.oldCwd = ''; T.typeahead = ''; T.draft = ''; T.ed.active = false; T.ed.row = 0;
    if (T.mode === 'xterm') { T.term.clear(); T.term.write('\x1b[H\x1b[2J'); }
    else if (T.mode === 'dom') { T.log.textContent = ''; D.line = null; }
    else T.pending = '';
    T.atBol = true; T.welcomed = false;
    if (T.mode !== 'none') { welcome(); if (!T.busy) showPrompt(); }
    S.terminal.focus();
  }
  S.ui.registerCommand({ id: 'terminal.new', title: 'Terminal: New session (clear, back to project root)', run: newSession });
  S.ui.registerCommand({ id: 'terminal.clear', title: 'Terminal: Clear', run: () => clearScreen() });
  S.ui.registerCommand({ id: 'terminal.inputRow', title: 'Terminal: Toggle the command input row (touch typing)', run: () => { const on = T.row && !T.row.hidden; T.rowPref = on ? 'off' : 'on'; S.settings.set('terminal.inputRow', T.rowPref); paintRow(); } });

  bus.on('panel', (e) => { if (e && e.id) S.settings.set('terminal.lastPanel', e.id); scheduleFit(); });
  // Focus only when the user clicks the Terminal tab (agents' exec() switching tabs must not steal focus from the editor).
  document.addEventListener('click', (e) => { const b = e.target && e.target.closest && e.target.closest('[data-st-panel="terminal"]'); if (b && !touchDevice()) setTimeout(focusTerm, 0); });
  bus.on('layout', scheduleFit);
  bus.on('theme', (e) => { T.light = !!(e && e.dark === false); if (T.term) T.term.options.theme = themeObj(); if (T.panel) T.panel.classList.toggle('light', T.light); });
  bus.on('project:open', (e) => {
    const p = e && e.project; if (!p) return;
    const switched = T.lastPid !== null && T.lastPid !== p.id;
    const renamed = T.lastPid === p.id;
    if (!renamed) { T.cwd = ''; T.oldCwd = ''; T.histPid = ''; loadHist(); }
    T.lastPid = p.id;
    if (switched && T.mode !== 'none' && !T.busy) printAbove(A.gray + '— opened project ' + oneLine(p.name) + ' —' + A.reset);
    refreshPrompt();
  });
  bus.on('project:close', () => { T.cwd = ''; T.oldCwd = ''; T.lastPid = ''; T.histPid = ''; loadHist(); refreshPrompt(); });
  bus.on('fs:change', (e) => {
    if (!e || e.kind !== 'rename' || !e.from || !T.cwd) return;
    const rest = e.from.slice(T.cwd.length);
    if (e.from.indexOf(T.cwd + '/') !== 0 || !e.path.endsWith(rest)) return;
    if (fsIndex().isDir(T.cwd)) return;
    T.cwd = e.path.slice(0, e.path.length - rest.length);
    if (!T.busy) refreshPrompt();
  });
  if (window.ResizeObserver) { try { new ResizeObserver(() => scheduleFit()).observe(T.panel); } catch (_) {} }
  window.addEventListener('orientationchange', () => setTimeout(scheduleFit, 250));
  const boot = () => { T.booted = true; if (S.projects.current()) { T.lastPid = S.projects.current().id; loadHist(); } scheduleFit(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(boot, 0), { once: true }); else setTimeout(boot, 0);
  S.ready.then(() => { if (T.lastPid === null) T.lastPid = S.projects.current() ? S.projects.current().id : ''; refreshPrompt(); scheduleFit(); }).catch(() => {});
  bus.emit('terminal:ready', {});
})();

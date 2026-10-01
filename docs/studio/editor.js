/* ==========================================================================
 * OST Studio · editor — tabs, Monaco, Explorer, Search, quick open
 * --------------------------------------------------------------------------
 * Monaco 0.52.2 (AMD build from jsDelivr) with one model per file, a tab bar,
 * breadcrumbs, autosave into STUDIO.fs, live updates when agents / the cloud /
 * the terminal change files, TypeScript + JavaScript IntelliSense across the
 * project (project files as extra libs + npm type acquisition from jsDelivr),
 * an Explorer and a Search activity, quick open, a media viewer for binary
 * files, and a plain <textarea> fallback when Monaco can't load.
 * Contract: project-docs/ost-studio.md (module "editor").
 * Never executes user code: Monaco's workers only run Monaco's own scripts.
 * ========================================================================== */
(function () {
  'use strict';
  const S = window.STUDIO;
  if (!S || S.editor) return;
  const U = S.util, esc = U.esc, bus = S.bus;

  const MONACO_ROOT = 'https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/';
  const MONACO_VS = MONACO_ROOT + 'vs';
  const NPM = 'https://cdn.jsdelivr.net/npm/';
  const LOAD_TIMEOUT_MS = 15000;
  const SAVE_DELAY_MS = 350;
  const MAX_RESULTS = 3000;
  const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform || '') || /Mac OS X/.test(navigator.userAgent || '');
  const CODE_RE = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/i;
  const PATH_MIME = 'application/x-ost-path';
  const AMBIENT_PATH = 'file:///node_modules/@ost-studio/ambient/index.d.ts';
  const toast = (t, k) => S.ui.toast(t, k);
  const mobile = () => S.ui.isMobile();
  const finePointer = () => window.matchMedia('(pointer: fine)').matches;
  const kbdLabel = (k) => String(k || '').replace(/Mod/g, isMac ? '⌘' : 'Ctrl').replace(/Alt/g, isMac ? '⌥' : 'Alt');
  function h(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function requireProject() { if (S.projects.current()) return true; toast('Open or create a project first.', 'warn'); if (S.ui.showWelcome) S.ui.showWelcome(); return false; }
  const isFolder = (p) => !!p && !S.fs.exists(p) && S.fs.folders().includes(p);

  /* ======================================================================
   * icons
   * ==================================================================== */
  const svg = (d) => `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="${d}"/></svg>`;
  const IC = {
    newFile: svg('M9.5 1.5H4.2a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h4M9.5 1.5l3.3 3.3v3.7M9.5 1.5v3.3h3.3M12 10v5M9.5 12.5h5'),
    newFolder: svg('M1.5 12.5v-9a1 1 0 0 1 1-1h3.4l1.5 1.6h6.1a1 1 0 0 1 1 1v3M1.5 12.5a1 1 0 0 0 1 1h6M12 9.5v5M9.5 12h5'),
    upload: svg('M8 10.5V2.2M4.7 5.4 8 2.2l3.3 3.2M2.5 10v2.8a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V10'),
    refresh: svg('M13.3 8.2A5.3 5.3 0 1 1 11.6 4M13.4 1.8v3.4H10'),
    collapse: svg('M3 2.5h10a.5.5 0 0 1 .5.5v10a.5.5 0 0 1-.5.5H3a.5.5 0 0 1-.5-.5V3a.5.5 0 0 1 .5-.5zM5.5 8h5'),
    clear: svg('M3.5 3.5l9 9M12.5 3.5l-9 9'),
    replace: svg('M2.5 6h8.5L8.5 3.5M13.5 10H5l2.5 2.5'),
    replaceAll: svg('M2 4.5h7.5L7.5 2.5M2 8h7.5L7.5 6M14 11.5H6.5l2 2'),
    more: svg('M3.5 8h.01M8 8h.01M12.5 8h.01')
  };
  const FOLDER = (open) => `<svg class="st-editor-fold" viewBox="0 0 16 16" aria-hidden="true"><path d="${open
    ? 'M1.5 12.6V3.5a1 1 0 0 1 1-1h3.3l1.5 1.5h5.2a1 1 0 0 1 1 1v1.6M1.5 12.6l1.9-5.3a1 1 0 0 1 .9-.7h9.8a.6.6 0 0 1 .6.8l-1.8 5a1 1 0 0 1-.9.6H2.4a.9.9 0 0 1-.9-.4z'
    : 'M1.5 4a1 1 0 0 1 1-1h3.3l1.5 1.5h6.2a1 1 0 0 1 1 1v6.9a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z'}"/></svg>`;
  const FI = {
    js: ['JS', '#e8d44d'], mjs: ['JS', '#e8d44d'], cjs: ['JS', '#e8d44d'],
    ts: ['TS', '#4d9bf0'], mts: ['TS', '#4d9bf0'], cts: ['TS', '#4d9bf0'],
    jsx: ['⚛', '#61dafb'], tsx: ['⚛', '#4d9bf0'],
    html: ['<>', '#e8663d'], htm: ['<>', '#e8663d'], vue: ['V', '#41b883'], svelte: ['S', '#ff5d2a'],
    css: ['#', '#4fa3f7'], scss: ['#', '#e06c9f'], less: ['#', '#6b8fd6'],
    json: ['{}', '#d7c44b'], map: ['{}', '#8b96a8'], md: ['M↓', '#5aa5d6'], markdown: ['M↓', '#5aa5d6'],
    py: ['py', '#5b9bd5'], svg: ['◆', '#f0a33a'], txt: ['≡', '#9aa5b5'], csv: ['≡', '#7cc36e'], pdf: ['pdf', '#e05252'],
    png: ['▣', '#b180d7'], jpg: ['▣', '#b180d7'], jpeg: ['▣', '#b180d7'], gif: ['▣', '#b180d7'], webp: ['▣', '#b180d7'], avif: ['▣', '#b180d7'], ico: ['▣', '#b180d7'], bmp: ['▣', '#b180d7'],
    woff: ['Aa', '#e57373'], woff2: ['Aa', '#e57373'], ttf: ['Aa', '#e57373'], otf: ['Aa', '#e57373'],
    mp3: ['♪', '#7cc36e'], wav: ['♪', '#7cc36e'], ogg: ['♪', '#7cc36e'], m4a: ['♪', '#7cc36e'], mp4: ['▶', '#ef6b6b'], webm: ['▶', '#ef6b6b'], mov: ['▶', '#ef6b6b'],
    yml: ['≣', '#d16d6d'], yaml: ['≣', '#d16d6d'], toml: ['⚙', '#9aa5b5'], ini: ['⚙', '#9aa5b5'], cfg: ['⚙', '#9aa5b5'], conf: ['⚙', '#9aa5b5'], env: ['⚙', '#d7c44b'],
    sh: ['$', '#7cc36e'], bash: ['$', '#7cc36e'], sql: ['db', '#d7c44b'], rs: ['rs', '#dea584'], go: ['go', '#38bdd6'], java: ['J', '#e76f00'],
    c: ['C', '#6d9be0'], h: ['h', '#a074c4'], cpp: ['C+', '#6d9be0'], rb: ['rb', '#e0514f'], php: ['php', '#8b8fd6'], sol: ['◈', '#9aa5b5'], graphql: ['◈', '#e535ab'], wasm: ['wa', '#8f7cf0'], lock: ['≡', '#8b96a8']
  };
  const FI_NAMES = { 'package.json': ['{}', '#e8663d'], 'readme.md': ['i', '#5aa5d6'], license: ['©', '#d7c44b'], '.gitignore': ['git', '#e2583e'], '.gitkeep': ['·', '#5f6b7d'], 'tsconfig.json': ['TS', '#4d9bf0'], 'jsconfig.json': ['JS', '#e8d44d'] };
  function fileIcon(p) {
    const b = U.baseOf(p).toLowerCase();
    const k = FI_NAMES[b] || FI[U.extOf(p)] || (b.startsWith('.env') ? FI.env : null) || ['•', '#5f6b7d'];
    return `<span class="st-editor-fi" style="color:${k[1]}" aria-hidden="true">${esc(k[0])}</span>`;
  }
  const LANG_NAMES = { javascript: 'JavaScript', typescript: 'TypeScript', json: 'JSON', html: 'HTML', css: 'CSS', scss: 'SCSS', less: 'Less', markdown: 'Markdown', python: 'Python', xml: 'XML', yaml: 'YAML', shell: 'Shell', ini: 'INI', plaintext: 'Plain Text', sql: 'SQL', rust: 'Rust', go: 'Go', java: 'Java', c: 'C', cpp: 'C++', ruby: 'Ruby', php: 'PHP', sol: 'Solidity', graphql: 'GraphQL' };
  function langLabel(p, lang) { const e = U.extOf(p); if (lang === 'javascript' && e === 'jsx') return 'JavaScript JSX'; if (lang === 'typescript' && e === 'tsx') return 'TypeScript JSX'; return LANG_NAMES[lang] || lang; }

  /* ======================================================================
   * state + DOM
   * ==================================================================== */
  const st = {
    pid: '', proj: null, tabs: [], active: null, mode: 'loading', textReason: '', shown: '',
    pending: new Map(), failed: new Set(), lastSaved: new Map(), mru: [], view: new Map(),
    markers: new Map(), svgPreview: new Set(), applying: false, pendingReveal: null, wasMobile: mobile(),
    monacoP: null, monacoOk: false, dragTab: null
  };
  let be = null;            // active backend: MB (Monaco) or TB (textarea)
  let monaco = null, editor = null;

  const hostEl = S.ui.editorHost();
  const rootEl = h('div', 'st-editor-root');
  rootEl.innerHTML = `
    <div class="st-editor-bar">
      <div class="st-editor-tabs" role="tablist" aria-label="Open editors"></div>
      <button class="st-editor-more" type="button" title="Editor actions" aria-label="Editor actions">${IC.more}</button>
    </div>
    <div class="st-editor-crumbs" aria-label="Breadcrumbs" hidden></div>
    <div class="st-editor-note" hidden></div>
    <div class="st-editor-stage">
      <div class="st-editor-monaco" hidden></div>
      <div class="st-editor-text" hidden><pre class="st-editor-gutter" aria-hidden="true"></pre><textarea class="st-textarea st-editor-ta" spellcheck="false" autocapitalize="off" autocomplete="off" autocorrect="off" wrap="off" aria-label="Code editor"></textarea></div>
      <div class="st-editor-media" hidden></div>
      <div class="st-editor-empty" hidden></div>
      <div class="st-editor-loading" hidden></div>
      <div class="st-editor-dropcue" hidden>Drop to add files to the project</div>
    </div>
    <div class="st-editor-mk" hidden></div>`;
  hostEl.appendChild(rootEl);
  const $r = (s) => rootEl.querySelector(s);
  const tabsEl = $r('.st-editor-tabs'), moreBtn = $r('.st-editor-more'), crumbsEl = $r('.st-editor-crumbs'), noteEl = $r('.st-editor-note');
  const stageEl = $r('.st-editor-stage'), monacoEl = $r('.st-editor-monaco'), textWrap = $r('.st-editor-text'), gutterEl = $r('.st-editor-gutter'), taEl = $r('.st-editor-ta');
  const mediaEl = $r('.st-editor-media'), emptyEl = $r('.st-editor-empty'), loadingEl = $r('.st-editor-loading'), dropCue = $r('.st-editor-dropcue'), mkEl = $r('.st-editor-mk');

  function stageShow(which) {
    monacoEl.hidden = which !== 'monaco'; textWrap.hidden = which !== 'text'; mediaEl.hidden = which !== 'media';
    emptyEl.hidden = which !== 'empty'; loadingEl.hidden = which !== 'loading';
    st.shown = which;
    if (which !== 'media') { mediaEl.innerHTML = ''; }
    if (which === 'monaco' || which === 'text') layoutSoon();
    paintMarkerStrip();
  }

  /* ======================================================================
   * saving
   * ==================================================================== */
  function scheduleSave(p) {
    clearTimeout(st.pending.get(p));
    st.pending.set(p, setTimeout(() => { save(p); }, SAVE_DELAY_MS));
  }
  function cancelPending(p) { if (st.pending.has(p)) { clearTimeout(st.pending.get(p)); st.pending.delete(p); } }
  // Starts the write synchronously (STUDIO.fs updates its in-memory copy before awaiting
  // IndexedDB), so anything that reads STUDIO.fs right after a flush sees the new text.
  function save(p) {
    cancelPending(p);
    const v = be ? be.value(p) : null, cur = S.projects.current();
    if (v == null || !cur || cur.id !== st.pid) return Promise.resolve();
    st.lastSaved.set(p, v);
    return S.fs.write(p, v, { source: 'editor' }).then(() => {
      if (st.failed.delete(p)) renderTabs();
    }, (e) => {
      const first = !st.failed.has(p);
      st.failed.add(p); renderTabs();
      if (first) toast('Not saved — ' + (e && e.message ? e.message : String(e)), 'err');
    });
  }
  function flush() { return Promise.all([...st.pending.keys()].map((p) => save(p))); }
  // Save before anything else can read the files: shortcuts (Run is Mod+Enter), clicks
  // outside the editor (Run / Deploy buttons, terminal), tab switches and page hide.
  document.addEventListener('keydown', (e) => { if (st.pending.size && (e.ctrlKey || e.metaKey || /^F\d+$/.test(e.key))) flush(); }, true);
  document.addEventListener('pointerdown', (e) => { if (st.pending.size && !stageEl.contains(e.target)) flush(); }, true);
  document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });
  // Monaco cancels in-flight work when models switch or close; VS Code ignores these
  // CancellationErrors, but standalone Monaco leaves them as unhandled rejections.
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason;
    if (r && (r.name === 'Canceled' || r.message === 'Canceled') && String(r.stack || '').indexOf(MONACO_ROOT) >= 0) e.preventDefault();
  });
  window.addEventListener('pagehide', () => { flush(); });

  /* ======================================================================
   * Monaco backend
   * ==================================================================== */
  const models = new Map();            // path -> ITextModel
  const modelPath = new WeakMap();     // ITextModel -> path
  const uriOf = (p) => monaco.Uri.file('/' + p);
  function pathFromUri(uri) {
    if (!uri || uri.scheme !== 'file') return null;
    const p = U.normPath(uri.path || '');
    return p && S.fs.exists(p) ? p : null;
  }
  function langFor(p) {
    const l = U.langOf(p);
    if (!monaco) return l;
    return monaco.languages.getLanguages().some((x) => x.id === l) ? l : 'plaintext';
  }
  function wrapFor(p) {
    const pref = S.settings.get('editor.wrap', 'auto');
    if (pref === 'on' || pref === 'off') return pref;
    return /^(markdown|plaintext)$/.test(U.langOf(p)) ? 'on' : 'off';
  }
  function diffRange(a, b) {
    const la = a.length, lb = b.length, max = Math.min(la, lb);
    let s = 0; while (s < max && a.charCodeAt(s) === b.charCodeAt(s)) s++;
    if (s > 0 && s < la && a.charCodeAt(s - 1) >= 0xd800 && a.charCodeAt(s - 1) <= 0xdbff) s--;
    let e = 0; while (e < max - s && a.charCodeAt(la - 1 - e) === b.charCodeAt(lb - 1 - e)) e++;
    if (e > 0 && la - e < la && a.charCodeAt(la - e) >= 0xdc00 && a.charCodeAt(la - e) <= 0xdfff) e--;
    return [s, la - e, lb - e];   // changed region: a[s, la-e) -> b[s, lb-e)
  }
  // Replace a model's text with the smallest single edit, as its own undo step, so
  // cursors / scroll outside the changed region stay where the user left them.
  function applyText(m, text, asUser) {
    const old = m.getValue();
    if (old === text) return false;
    const [s, eo, en] = diffRange(old, text);
    const a = m.getPositionAt(s), b = m.getPositionAt(eo);
    const op = { range: new monaco.Range(a.lineNumber, a.column, b.lineNumber, b.column), text: text.slice(s, en) };
    const sel = editor && editor.getModel() === m ? editor.getSelections() : [];
    if (!asUser) st.applying = true;
    try { m.pushStackElement(); m.pushEditOperations(sel || [], [op], () => null); m.pushStackElement(); }
    finally { st.applying = false; }
    return true;
  }
  function adoptModel(p, m) {
    models.set(p, m); modelPath.set(m, p);
    m.onDidChangeContent(() => { if (st.applying) return; const q = modelPath.get(m); if (q && models.get(q) === m) scheduleSave(q); });
    applyMarkers(p);
  }
  const MB = {
    name: 'monaco',
    has: (p) => models.has(p),
    value: (p) => { const m = models.get(p); return m && !m.isDisposed() ? m.getValue() : null; },
    model(p) {
      let m = models.get(p);
      if (m && !m.isDisposed()) return m;
      const uri = uriOf(p), content = S.fs.read(p) || '';
      m = monaco.editor.getModel(uri);   // e.g. created by "go to definition" from the extra lib
      if (m) { if (m.getLanguageId() !== langFor(p)) monaco.editor.setModelLanguage(m, langFor(p)); if (m.getValue() !== content) { st.applying = true; try { m.setValue(content); } finally { st.applying = false; } } }
      else m = monaco.editor.createModel(content, langFor(p), uri);
      adoptModel(p, m);
      return m;
    },
    show(p) {
      const m = MB.model(p);
      if (editor.getModel() !== m) {
        const cur = editor.getModel(), cp = cur && modelPath.get(cur);
        if (cp) st.view.set(cp, editor.saveViewState());
        editor.setModel(m);
        const vs = st.view.get(p); if (vs) editor.restoreViewState(vs);
      }
      editor.updateOptions({ wordWrap: wrapFor(p) });
      stageShow('monaco');
      paintCursor(); paintLang(p);
    },
    saveView(p) { const m = models.get(p); if (m && editor && editor.getModel() === m) st.view.set(p, editor.saveViewState()); },
    external(p, text) { const m = models.get(p); if (m && !m.isDisposed()) applyText(m, text, false); },
    setText(p, text) { applyText(MB.model(p), text, true); },
    drop(p) { const m = models.get(p); if (!m) return; models.delete(p); if (editor && editor.getModel() === m) editor.setModel(null); if (!m.isDisposed()) m.dispose(); },
    rename(from, to) {
      const m = models.get(from); if (!m) return;
      const shown = editor && editor.getModel() === m;
      const text = m.getValue(), vs = shown ? editor.saveViewState() : st.view.get(from);
      models.delete(from);
      const n = MB.model(to);
      if (n.getValue() !== text) n.setValue(text);   // unsaved keystrokes follow the file (autosave picks them up)
      if (shown) { editor.setModel(n); if (vs) editor.restoreViewState(vs); }
      if (vs) st.view.set(to, vs);
      if (!m.isDisposed()) m.dispose();
    },
    reset() {
      if (editor) editor.setModel(null);
      for (const m of models.values()) if (!m.isDisposed()) m.dispose();
      models.clear();
      // models Monaco made itself (peek / go to definition) for project files must not leak into the next project
      if (monaco) for (const m of monaco.editor.getModels()) if (m.uri.scheme === 'file' && m.uri.path.indexOf('/node_modules/') !== 0 && !m.isDisposed()) m.dispose();
    },
    focus() { if (editor) editor.focus(); },
    reveal(line, col, len, focus) {
      const m = editor.getModel(); if (!m) return;
      const ln = Math.min(Math.max(1, line), m.getLineCount()), max = m.getLineMaxColumn(ln), c = Math.min(Math.max(1, col), max);
      editor.setSelection(new monaco.Selection(ln, c, ln, Math.min(max, c + (len || 0))));
      editor.revealLineInCenterIfOutsideViewport(ln);
      if (focus) editor.focus();
      paintCursor();
    },
    cursor() {
      const s = editor && editor.getSelection(), m = editor && editor.getModel();
      if (!s || !m) return null;
      return { line: s.positionLineNumber, col: s.positionColumn, sel: s.isEmpty() ? 0 : m.getValueLengthInRange(s) };
    }
  };

  /* ======================================================================
   * textarea backend (fallback / "simple editor")
   * ==================================================================== */
  const bufs = new Map(); let taCur = null, taTabTrap = true, gutterLines = 0;
  function offsetOf(text, line, col) {
    let off = 0;
    for (let i = 1; i < line; i++) { const n = text.indexOf('\n', off); if (n < 0) return text.length; off = n + 1; }
    const eol = text.indexOf('\n', off), end = eol < 0 ? text.length : eol;
    return Math.min(end, off + Math.max(0, col - 1));
  }
  function lineHeightPx() { return parseFloat(getComputedStyle(taEl).lineHeight) || 19; }
  function taSet(text) {
    const old = taEl.value, ss = taEl.selectionStart, se = taEl.selectionEnd, top = taEl.scrollTop, left = taEl.scrollLeft;
    const [s, eo, en] = diffRange(old, text);
    const map = (pos) => pos <= s ? pos : pos >= eo ? pos + (en - eo) : en;
    taEl.value = text;
    try { taEl.setSelectionRange(map(ss), map(se)); } catch (_) {}
    taEl.scrollTop = top; taEl.scrollLeft = left;
    paintGutter(); paintCursorSoon();
  }
  const TB = {
    name: 'text',
    has: (p) => bufs.has(p),
    value: (p) => { const b = bufs.get(p); return b ? b.value : null; },
    buf(p) { let b = bufs.get(p); if (!b) { b = { value: S.fs.read(p) || '', ss: 0, se: 0, top: 0, left: 0 }; bufs.set(p, b); } return b; },
    show(p) {
      if (taCur && taCur !== p) TB.saveView(taCur);
      const b = TB.buf(p); taCur = p;
      if (taEl.value !== b.value) taEl.value = b.value;
      taEl.setAttribute('wrap', wrapFor(p) === 'on' ? 'soft' : 'off');
      stageShow('text');
      try { taEl.setSelectionRange(b.ss, b.se); } catch (_) {}
      taEl.scrollTop = b.top; taEl.scrollLeft = b.left;
      paintGutter(true); paintCursor(); paintLang(p);
    },
    saveView(p) { if (taCur !== p) return; const b = bufs.get(p); if (!b) return; b.value = taEl.value; b.ss = taEl.selectionStart; b.se = taEl.selectionEnd; b.top = taEl.scrollTop; b.left = taEl.scrollLeft; },
    external(p, text) { const b = bufs.get(p); if (!b) return; if (taCur === p) taSet(text); b.value = text; },
    setText(p, text) { const b = TB.buf(p); if (taCur === p) taSet(text); b.value = text; scheduleSave(p); },
    drop(p) { bufs.delete(p); if (taCur === p) { taCur = null; taEl.value = ''; } },
    rename(from, to) { const b = bufs.get(from); if (!b) return; bufs.delete(from); bufs.set(to, b); if (taCur === from) taCur = to; },
    reset() { bufs.clear(); taCur = null; taEl.value = ''; },
    focus() { taEl.focus(); },
    reveal(line, col, len, focus) {
      const off = offsetOf(taEl.value, line, col);
      if (focus) taEl.focus({ preventScroll: true });
      try { taEl.setSelectionRange(off, Math.min(taEl.value.length, off + (len || 0))); } catch (_) {}
      taEl.scrollTop = Math.max(0, (line - 1) * lineHeightPx() - taEl.clientHeight / 3);
      paintGutter(); paintCursor();
    },
    cursor() {
      const v = taEl.value, pos = taEl.selectionEnd;
      let line = 1; for (let i = v.indexOf('\n'); i >= 0 && i < pos; i = v.indexOf('\n', i + 1)) line++;
      return { line, col: pos - (v.lastIndexOf('\n', pos - 1) + 1) + 1, sel: Math.abs(taEl.selectionEnd - taEl.selectionStart) };
    }
  };
  function paintGutter(force) {
    if (textWrap.hidden) return;
    const wrap = taEl.getAttribute('wrap') !== 'off';
    gutterEl.hidden = wrap;
    if (wrap) return;
    const v = taEl.value; let n = 1; for (let i = v.indexOf('\n'); i >= 0; i = v.indexOf('\n', i + 1)) n++;
    if (n !== gutterLines || force) {
      gutterLines = n; const parts = new Array(n); for (let i = 0; i < n; i++) parts[i] = i + 1;
      gutterEl.textContent = parts.join('\n') + '\n\n';
      gutterEl.style.width = (String(n).length + 2.2) + 'ch';
    }
    gutterEl.scrollTop = taEl.scrollTop;
  }
  function taInsert(t) {
    taEl.focus();
    let ok = false; try { ok = document.execCommand('insertText', false, t); } catch (_) {}
    if (!ok) { taEl.setRangeText(t, taEl.selectionStart, taEl.selectionEnd, 'end'); taEl.dispatchEvent(new Event('input', { bubbles: true })); }
  }
  taEl.addEventListener('input', () => { if (!taCur) return; st.textEdited = true; const b = bufs.get(taCur); if (b) b.value = taEl.value; scheduleSave(taCur); paintGutter(); paintCursorSoon(); });
  taEl.addEventListener('scroll', () => { gutterEl.scrollTop = taEl.scrollTop; });
  ['keyup', 'click', 'select'].forEach((ev) => taEl.addEventListener(ev, paintCursorSoon));
  taEl.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { taTabTrap = false; return; }
    const unit = taCur && U.langOf(taCur) === 'python' ? '    ' : '  ';
    if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (!taTabTrap) { taTabTrap = true; return; }       // Esc then Tab moves focus out (keyboard users)
      e.preventDefault();
      const v = taEl.value, ss = taEl.selectionStart, se = taEl.selectionEnd;
      if (e.shiftKey || (ss !== se && v.slice(ss, se).includes('\n'))) {
        const ls = v.lastIndexOf('\n', ss - 1) + 1, block = v.slice(ls, se);
        const out = e.shiftKey ? block.replace(new RegExp('^(?: {1,' + unit.length + '}|\\t)', 'gm'), '') : block.replace(/^/gm, unit);
        taEl.setSelectionRange(ls, se); taInsert(out); taEl.setSelectionRange(ls, ls + out.length);
      } else taInsert(unit);
      return;
    }
    taTabTrap = true;
    if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && !e.isComposing) {
      const v = taEl.value, ss = taEl.selectionStart, ls = v.lastIndexOf('\n', ss - 1) + 1;
      const ind = /^[ \t]*/.exec(v.slice(ls, ss))[0], prev = v.slice(ls, ss).trimEnd().slice(-1);
      e.preventDefault(); taInsert('\n' + ind + (/[{[(:]/.test(prev) ? unit : ''));
    }
  });

  /* ======================================================================
   * tabs, breadcrumbs, open / close
   * ==================================================================== */
  function renderTabs() {
    const count = new Map(); for (const p of st.tabs) { const b = U.baseOf(p); count.set(b, (count.get(b) || 0) + 1); }
    const drag = finePointer() ? ' draggable="true"' : '';
    tabsEl.innerHTML = st.tabs.map((p) => {
      const b = U.baseOf(p), d = U.dirOf(p), on = p === st.active;
      return `<div class="st-editor-tab${on ? ' on' : ''}${st.failed.has(p) ? ' err' : ''}" role="tab" aria-selected="${on}" data-path="${esc(p)}" title="${esc(p)}${st.failed.has(p) ? ' — not saved' : ''}"${drag}>${fileIcon(p)}<span class="st-editor-tabname">${esc(b)}</span>${count.get(b) > 1 && d ? `<span class="st-editor-tabdir">${esc(U.baseOf(d))}</span>` : ''}<button class="st-editor-tabx" type="button" data-close tabindex="-1" aria-label="Close ${esc(b)}" title="Close">×</button></div>`;
    }).join('');
    const on = tabsEl.querySelector('.st-editor-tab.on');
    if (on) { const l = on.offsetLeft, r = l + on.offsetWidth; if (l < tabsEl.scrollLeft) tabsEl.scrollLeft = l - 8; else if (r > tabsEl.scrollLeft + tabsEl.clientWidth) tabsEl.scrollLeft = r - tabsEl.clientWidth + 8; }
  }
  function renderCrumbs() {
    const p = st.active;
    if (!p) { crumbsEl.hidden = true; crumbsEl.innerHTML = ''; return; }
    const parts = p.split('/');
    let html = parts.map((seg, i) => {
      const sub = parts.slice(0, i + 1).join('/'), last = i === parts.length - 1;
      return `<button type="button" class="st-editor-crumb${last ? ' last' : ''}" data-crumb="${esc(sub)}" title="Reveal in Explorer">${last ? fileIcon(p) : ''}<span>${esc(seg)}</span></button>`;
    }).join('<span class="st-editor-sep" aria-hidden="true">›</span>');
    if (U.extOf(p) === 'svg' && !S.fs.isBinary(p)) html += `<span class="st-sp"></span><button type="button" class="st-editor-cbtn" data-svg>${st.svgPreview.has(p) ? 'Edit source' : 'Preview image'}</button>`;
    crumbsEl.innerHTML = html; crumbsEl.hidden = false;
  }
  function persistTabs() {
    if (!st.pid) return;
    const all = Object.assign({}, S.settings.get('editor.tabs', null) || {});
    all[st.pid] = { tabs: st.tabs.slice(0, 40), active: st.active, ts: Date.now() };
    const keys = Object.keys(all);
    if (keys.length > 30) keys.sort((a, b) => (all[a].ts || 0) - (all[b].ts || 0)).slice(0, keys.length - 30).forEach((k) => delete all[k]);
    S.settings.set('editor.tabs', all);
  }
  function activate(p, opts) {
    opts = opts || {};
    if (st.active && st.active !== p && be) be.saveView(st.active);
    const changed = st.active !== p;
    st.active = p || null;
    if (p) st.mru = [p].concat(st.mru.filter((x) => x !== p)).slice(0, 60);
    renderTabs(); renderCrumbs(); show(st.active); persistTabs();
    if (p) expandTo(p);
    scheduleTree();
    if (changed) bus.emit('active:file', { path: st.active });
    if (opts.focus && !mobile()) setTimeout(() => { if (be && st.active === p) be.focus(); }, 0);
  }
  function show(p) {
    if (!p) { stageShow('empty'); paintEmpty(); S.ui.setStatus('cursor', ''); S.ui.setStatus('lang', ''); return; }
    if (S.fs.isBinary(p) || st.svgPreview.has(p)) { showMedia(p); return; }
    if (st.mode === 'loading' || !be) { stageShow('loading'); paintLoading(); paintLang(p); return; }
    be.show(p);
  }
  // open(path, {focus, fromSide}) — fromSide = opened from Explorer/Search/quick open: on
  // phones the side drawer closes so the file is visible.
  function open(path, opts) {
    opts = opts || {};
    const p = U.normPath(path);
    if (!p || !S.fs.exists(p)) return false;
    if (!st.tabs.includes(p)) {
      const i = st.active ? st.tabs.indexOf(st.active) + 1 : st.tabs.length;
      st.tabs.splice(i > 0 ? i : st.tabs.length, 0, p);
    }
    activate(p, opts);
    if (opts.fromSide && mobile() && S.ui.activity()) S.ui.setActivity('');
    return true;
  }
  function dropTab(p) {
    cancelPending(p);
    if (be) be.drop(p);
    st.view.delete(p); st.failed.delete(p); st.svgPreview.delete(p); st.lastSaved.delete(p);
    const i = st.tabs.indexOf(p); if (i < 0) return;
    st.tabs.splice(i, 1);
    if (st.active === p) activate(st.tabs[Math.min(i, st.tabs.length - 1)] || null);
    else { renderTabs(); persistTabs(); }
  }
  async function closeTab(p) {
    if (!p || !st.tabs.includes(p)) return;
    if (st.pending.has(p)) await save(p);
    if (st.failed.has(p) && be && be.has(p)) {
      const ok = await S.ui.confirm(`${U.baseOf(p)} has changes that could not be saved. Close it anyway and lose them?`, { danger: true, okText: 'Close' });
      if (!ok) return;
    }
    dropTab(p);
  }
  async function closeMany(list) { for (const p of list.slice()) await closeTab(p); }
  const closeAll = () => closeMany(st.tabs);

  tabsEl.addEventListener('click', (e) => {
    const t = e.target.closest('.st-editor-tab'); if (!t) return;
    const p = t.getAttribute('data-path');
    if (e.target.closest('[data-close]')) { closeTab(p); return; }
    activate(p, { focus: true });
  });
  tabsEl.addEventListener('mousedown', (e) => { if (e.button === 1) e.preventDefault(); });
  tabsEl.addEventListener('auxclick', (e) => { if (e.button !== 1) return; const t = e.target.closest('.st-editor-tab'); if (t) { e.preventDefault(); closeTab(t.getAttribute('data-path')); } });
  tabsEl.addEventListener('wheel', (e) => { if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && tabsEl.scrollWidth > tabsEl.clientWidth) { tabsEl.scrollLeft += e.deltaY; e.preventDefault(); } }, { passive: false });
  tabsEl.addEventListener('contextmenu', (e) => {
    const t = e.target.closest('.st-editor-tab'); if (!t) return;
    e.preventDefault();
    const p = t.getAttribute('data-path'), i = st.tabs.indexOf(p);
    openMenu(e.clientX, e.clientY, [
      { label: 'Close', run: () => closeTab(p) },
      { label: 'Close others', run: () => closeMany(st.tabs.filter((x) => x !== p)) },
      { label: 'Close to the right', run: () => closeMany(st.tabs.slice(i + 1)) },
      { label: 'Close all', run: closeAll },
      '-',
      { label: 'Reveal in Explorer', run: () => revealInExplorer(p) },
      { label: 'Copy path', run: () => copyPath(p) },
      { label: 'Rename…', run: () => renamePath(p) }
    ]);
  });
  tabsEl.addEventListener('dragstart', (e) => { const t = e.target.closest('.st-editor-tab'); if (!t) return; st.dragTab = t.getAttribute('data-path'); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', st.dragTab); } catch (_) {} });
  const tabDropMark = (t, after) => { tabsEl.querySelectorAll('.drop-before,.drop-after').forEach((x) => x.classList.remove('drop-before', 'drop-after')); if (t) t.classList.add(after ? 'drop-after' : 'drop-before'); };
  tabsEl.addEventListener('dragover', (e) => {
    if (!st.dragTab) return; e.preventDefault();
    const t = e.target.closest('.st-editor-tab'); if (!t) { tabDropMark(null); return; }
    const r = t.getBoundingClientRect(); tabDropMark(t, e.clientX > r.left + r.width / 2);
  });
  tabsEl.addEventListener('drop', (e) => {
    if (!st.dragTab) return; e.preventDefault();
    const t = e.target.closest('.st-editor-tab'), from = st.dragTab; st.dragTab = null; tabDropMark(null);
    const fi = st.tabs.indexOf(from); if (fi < 0) return;
    st.tabs.splice(fi, 1);
    let to = st.tabs.length;
    if (t && t.getAttribute('data-path') !== from) { const r = t.getBoundingClientRect(); to = st.tabs.indexOf(t.getAttribute('data-path')) + (e.clientX > r.left + r.width / 2 ? 1 : 0); }
    else if (t) to = fi;
    st.tabs.splice(Math.max(0, to), 0, from);
    renderTabs(); persistTabs();
  });
  tabsEl.addEventListener('dragend', () => { st.dragTab = null; tabDropMark(null); });
  crumbsEl.addEventListener('click', (e) => {
    if (e.target.closest('[data-svg]')) { const p = st.active; if (!p) return; if (st.svgPreview.has(p)) st.svgPreview.delete(p); else { flush(); st.svgPreview.add(p); } renderCrumbs(); show(p); return; }
    const b = e.target.closest('[data-crumb]'); if (b) revealInExplorer(b.getAttribute('data-crumb'));
  });
  moreBtn.addEventListener('click', () => {
    const r = moreBtn.getBoundingClientRect();
    const hasFile = !!st.active, text = hasFile && !S.fs.isBinary(st.active);
    openMenu(r.right, r.bottom + 2, [
      { label: 'Go to file…', kbd: 'Mod+P', run: quickOpen },
      { label: 'New file…', kbd: 'Mod+Alt+N', run: () => newFile(contextDir()) },
      { label: 'Search in files', kbd: 'Mod+Shift+F', run: focusSearch },
      '-',
      { label: 'Save and sync now', kbd: 'Mod+S', run: saveCommand, disabled: !S.projects.current() },
      { label: 'Format document', kbd: 'Shift+Alt+F', run: formatDoc, disabled: !text },
      { label: 'Go to line…', run: gotoLine, disabled: !text },
      { label: 'Toggle word wrap', kbd: 'Alt+Z', run: toggleWrap },
      '-',
      { label: 'Close all editors', run: closeAll, disabled: !st.tabs.length },
      { label: st.mode === 'text' ? 'Use the full code editor' : 'Use the simple editor (plain text)', run: toggleSimple }
    ], { alignRight: true });
  });

  /* ======================================================================
   * empty state, loading, notes, media viewer
   * ==================================================================== */
  function defaultFile() {
    const cands = ['src/App.jsx', 'src/App.tsx', 'src/App.js', 'src/main.jsx', 'src/main.tsx'];
    try { cands.push(U.entryFor()); } catch (_) {}
    cands.push('index.html', 'main.py', 'index.ts', 'index.js', 'README.md');
    for (const c of cands) if (c && S.fs.exists(c) && !S.fs.isBinary(c)) return c;
    const f = S.fs.list().find((x) => !x.binary && U.baseOf(x.path) !== '.gitkeep');
    return f ? f.path : null;
  }
  function cmdKey(id) { const c = S.ui.commands().find((x) => x.id === id); return c && c.key ? `<span class="st-kbd">${esc(kbdLabel(c.key))}</span>` : ''; }
  function paintEmpty() {
    if (!S.projects.current()) {
      emptyEl.innerHTML = '<div class="st-editor-hello"><div class="st-editor-mark">◉</div><p class="st-muted">No project is open.</p><button type="button" class="st-btn primary" data-x="welcome">Projects &amp; templates</button></div>';
      return;
    }
    const entry = defaultFile();
    const row = (id, label) => `<button type="button" data-cmd="${id}"><span>${label}</span>${mobile() ? '' : cmdKey(id)}</button>`;
    emptyEl.innerHTML = `<div class="st-editor-hello"><div class="st-editor-mark">◉</div><p class="st-muted">No file is open.</p>
      <div class="st-editor-keys">${row('quickOpen', 'Go to file')}${row('file.new', 'New file')}${row('search.focus', 'Search in files')}${row('palette', 'Show all commands')}</div>
      ${entry ? `<button type="button" class="st-btn primary" data-open="${esc(entry)}">Open ${esc(entry)}</button>` : ''}</div>`;
  }
  emptyEl.addEventListener('click', (e) => {
    const c = e.target.closest('[data-cmd]'); if (c) { S.ui.runCommand(c.getAttribute('data-cmd')); return; }
    const o = e.target.closest('[data-open]'); if (o) { open(o.getAttribute('data-open'), { focus: true }); return; }
    if (e.target.closest('[data-x="welcome"]') && S.ui.showWelcome) S.ui.showWelcome();
  });
  let loadingTimer = 0;
  function paintLoading() {
    if (loadingEl.firstChild) return;
    loadingEl.innerHTML = '<div class="st-editor-hello"><div class="st-editor-spin" aria-hidden="true"></div><p class="st-muted">Loading the code editor…</p><button type="button" class="st-btn" data-x="simple" hidden>Use the simple editor instead</button></div>';
    clearTimeout(loadingTimer);
    loadingTimer = setTimeout(() => { const b = loadingEl.querySelector('[data-x="simple"]'); if (b) b.hidden = false; }, 6000);
  }
  loadingEl.addEventListener('click', (e) => { if (e.target.closest('[data-x="simple"]')) useText('slow'); });
  function paintNote() {
    let html = '';
    if (st.mode === 'text') {
      if (st.textReason === 'failed') html = `<span>⚠ The full code editor couldn't load (offline, or the CDN is blocked). You're in the simple editor — files still save and sync.</span><button type="button" class="st-btn" data-x="${window.monaco && window.monaco.editor ? 'monaco' : 'retry'}">${window.monaco && window.monaco.editor ? 'Switch to the full editor' : 'Try again'}</button>`;
      else if (st.textReason === 'late') html = '<span>The full code editor finished loading.</span><button type="button" class="st-btn" data-x="monaco">Switch to it</button>';
      else html = `<span>Simple editor (plain text, no IntelliSense).</span><button type="button" class="st-btn" data-x="${window.monaco && window.monaco.editor ? 'monaco' : 'retry'}">Use the full editor</button>`;
    }
    noteEl.innerHTML = html; noteEl.hidden = !html;
    layoutSoon();
  }
  noteEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-x]'); if (!b) return;
    const x = b.getAttribute('data-x');
    if (x === 'monaco') { S.settings.set('editor.simple', false); switchToMonaco(); }
    else if (x === 'retry') {
      S.settings.set('editor.simple', false);
      // a failed AMD module stays failed inside Monaco's loader: only a reload retries it
      if (st.textReason === 'failed' && window.require && typeof window.require.config === 'function') flush().then(() => location.reload());
      else startMonaco();
    }
  });

  function dataUrlParts(url) {
    const m = /^data:([^;,]*)((?:;[^;,]*)*?)(;base64)?,/.exec(url || '');
    if (!m) return null;
    return { mime: (m[1] || '').toLowerCase(), base64: !!m[3], body: url.slice(m[0].length) };
  }
  function bytesOf(url) {
    const d = dataUrlParts(url); if (!d) return new TextEncoder().encode(String(url || ''));
    if (d.base64) { try { return U.b64ToBytes(d.body); } catch (_) { return new Uint8Array(0); } }
    try { return new TextEncoder().encode(decodeURIComponent(d.body)); } catch (_) { return new TextEncoder().encode(d.body); }
  }
  function downloadPath(p) {
    const content = getText(p); if (content == null) return;
    const bin = S.fs.isBinary(p);
    const blob = bin ? new Blob([bytesOf(content)], { type: (dataUrlParts(content) || {}).mime || U.mimeOf(p) }) : new Blob([content], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = U.baseOf(p);
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  function showMedia(p) {
    stageShow('media');
    const raw = S.fs.read(p) || '';
    const svgText = st.svgPreview.has(p) && !S.fs.isBinary(p);
    const url = svgText ? 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(getText(p) || '') : raw;
    const d = dataUrlParts(url), ext = U.extOf(p);
    const mime = (d && d.mime) || U.mimeOf(p);
    const size = svgText ? new TextEncoder().encode(getText(p) || '').length : ((S.fs.list().find((f) => f.path === p) || {}).size || 0);
    let kind = 'other';
    if (/^image\//.test(mime) || /^(png|jpe?g|gif|webp|avif|ico|bmp|svg)$/.test(ext)) kind = 'image';
    else if (/^audio\//.test(mime) || /^(mp3|wav|ogg|m4a|aac|flac)$/.test(ext)) kind = 'audio';
    else if (/^video\//.test(mime) || /^(mp4|webm|mov|m4v)$/.test(ext)) kind = 'video';
    else if (/^font\//.test(mime) || /^(woff2?|ttf|otf)$/.test(ext)) kind = 'font';
    mediaEl.innerHTML = `<div class="st-editor-mhead"><span>${fileIcon(p)} <b>${esc(U.baseOf(p))}</b></span><span class="st-muted">${esc(mime)} · ${esc(U.fmtBytes(size))}<span data-dim></span></span><span class="st-sp"></span>${kind === 'image' ? '<button type="button" class="st-btn" data-x="zoom">Actual size</button>' : ''}<button type="button" class="st-btn" data-x="dl">Download</button></div><div class="st-editor-mbody ${kind}"></div>`;
    const body = mediaEl.querySelector('.st-editor-mbody');
    if (!d) { body.innerHTML = '<div class="st-empty">This file has no readable content.</div>'; }
    else if (kind === 'image') {
      const img = new Image(); img.alt = U.baseOf(p); img.decoding = 'async';
      img.onload = () => { const s = mediaEl.querySelector('[data-dim]'); if (s && img.naturalWidth) s.textContent = ` · ${img.naturalWidth}×${img.naturalHeight}`; };
      img.onerror = () => { body.innerHTML = '<div class="st-empty">This image could not be displayed (unsupported or damaged file).</div>'; };
      img.src = url; body.appendChild(img);
    } else if (kind === 'audio' || kind === 'video') {
      const m = document.createElement(kind); m.controls = true; m.preload = 'metadata'; if (kind === 'video') m.playsInline = true;
      m.src = url; body.appendChild(m);
    } else if (kind === 'font' && window.FontFace) {
      const fam = 'ostprev' + U.uid(4);
      body.innerHTML = '<div class="st-muted">Loading font…</div>';
      try {
        const ff = new FontFace(fam, bytesOf(url).buffer);
        ff.load().then((f) => { document.fonts.add(f); body.innerHTML = `<div class="st-editor-font" style="font-family:'${fam}'"><div style="font-size:42px">Aa Bb Cc 0123</div><div style="font-size:22px">The quick brown fox jumps over the lazy dog.</div><div style="font-size:15px">ABCDEFGHIJKLMNOPQRSTUVWXYZ abcdefghijklmnopqrstuvwxyz !?&amp;@#</div></div>`; }, () => { body.innerHTML = '<div class="st-empty">This font could not be loaded.</div>'; });
      } catch (_) { body.innerHTML = '<div class="st-empty">This font could not be loaded.</div>'; }
    } else {
      body.innerHTML = `<div class="st-empty">Binary file — no preview for ${esc(mime)}.<br>It is still part of your project and gets deployed as-is.</div>`;
    }
    mediaEl.onclick = (e) => {
      const b = e.target.closest('[data-x]'); if (!b) return;
      if (b.getAttribute('data-x') === 'dl') downloadPath(p);
      else { body.classList.toggle('actual'); b.textContent = body.classList.contains('actual') ? 'Fit to view' : 'Actual size'; }
    };
    S.ui.setStatus('cursor', '');
    S.ui.setStatus('lang', svgText ? 'SVG preview' : (kind === 'other' ? 'Binary' : kind[0].toUpperCase() + kind.slice(1)), { side: 'right', order: 30 });
  }

  /* ======================================================================
   * status bar
   * ==================================================================== */
  let curRaf = 0;
  function paintCursorSoon() { if (curRaf) return; curRaf = requestAnimationFrame(() => { curRaf = 0; paintCursor(); }); }
  function paintCursor() {
    if (!st.active || (st.shown !== 'monaco' && st.shown !== 'text') || !be) { S.ui.setStatus('cursor', ''); return; }
    const c = be.cursor(); if (!c) { S.ui.setStatus('cursor', ''); return; }
    S.ui.setStatus('cursor', `Ln ${c.line}, Col ${c.col}` + (c.sel ? ` (${c.sel} selected)` : ''), { side: 'right', order: 20, title: 'Go to line', onClick: gotoLine });
  }
  function paintLang(p) {
    if (!p) { S.ui.setStatus('lang', ''); return; }
    const m = st.mode === 'monaco' && models.get(p);
    const lang = m && !m.isDisposed() ? m.getLanguageId() : U.langOf(p);
    S.ui.setStatus('lang', langLabel(p, lang), { side: 'right', order: 30, title: m ? 'Select language mode' : 'Language', onClick: m ? pickLanguage : undefined });
  }
  async function gotoLine() {
    const p = st.active; if (!p || S.fs.isBinary(p) || st.svgPreview.has(p)) return;
    const v = await S.ui.prompt('Go to line', '', { placeholder: 'line, or line:column — e.g. 42 or 42:7', okText: 'Go' });
    if (!v) return;
    const m = /^(\d+)(?:\s*[:,]\s*(\d+))?$/.exec(v.trim());
    if (!m) { toast('Type a line number, e.g. 42 or 42:7', 'warn'); return; }
    reveal(p, +m[1], +(m[2] || 1));
  }
  async function pickLanguage() {
    const m = models.get(st.active); if (!m || !monaco) return;
    const langs = monaco.languages.getLanguages().map((l) => ({ value: l.id, label: (l.aliases && l.aliases[0]) || l.id, desc: (l.extensions || []).slice(0, 4).join(' ') }));
    const id = await S.ui.select('Select language mode (this session)', langs);
    if (id && !m.isDisposed()) { monaco.editor.setModelLanguage(m, id); paintLang(st.active); }
  }

  /* ======================================================================
   * layout
   * ==================================================================== */
  let layRaf = 0;
  function layoutSoon() {
    if (layRaf) return;
    layRaf = requestAnimationFrame(() => {
      layRaf = 0;
      const mob = mobile();
      if (mob !== st.wasMobile) { st.wasMobile = mob; if (editor) editor.updateOptions(deviceOptions()); renderTree(); }
      if (editor && st.shown === 'monaco') { const r = monacoEl.getBoundingClientRect(); if (r.width > 0 && r.height > 0) editor.layout({ width: Math.floor(r.width), height: Math.floor(r.height) }); }
      if (st.shown === 'text') paintGutter();
    });
  }
  bus.on('layout', layoutSoon);
  if (window.ResizeObserver) new ResizeObserver(layoutSoon).observe(stageEl);

  /* ======================================================================
   * markers
   * ==================================================================== */
  const SEV = { error: 8, warning: 4, info: 2, hint: 1 };
  function normMarker(m) {
    if (!m || typeof m !== 'object') return null;
    const line = Math.max(1, Math.floor(Number(m.line) || 1)), col = Math.max(1, Math.floor(Number(m.col) || 0)) || 0;
    const sev = /^(error|warning|info|hint)$/.test(m.severity) ? m.severity : 'error';
    return { line, col, endLine: m.endLine ? Math.max(line, Math.floor(Number(m.endLine))) : 0, endCol: m.endCol ? Math.floor(Number(m.endCol)) : 0, message: String(m.message == null ? '' : m.message).slice(0, 2000), severity: sev, source: m.source ? String(m.source) : '' };
  }
  function applyMarkers(p) {
    if (!monaco) return;
    const m = models.get(p); if (!m || m.isDisposed()) return;
    for (const [owner, byPath] of st.markers) {
      const list = byPath.get(p) || [];
      monaco.editor.setModelMarkers(m, owner, list.map((x) => {
        const ln = Math.min(x.line, m.getLineCount());
        let c = x.col || 1, el = x.endLine ? Math.min(x.endLine, m.getLineCount()) : ln, ec = x.endCol || 0;
        if (!ec) { const w = x.col ? m.getWordAtPosition({ lineNumber: ln, column: c }) : null; ec = w ? w.endColumn : m.getLineMaxColumn(el); if (!x.col) c = m.getLineFirstNonWhitespaceColumn(ln) || 1; }
        if (el === ln && ec <= c) ec = Math.min(m.getLineMaxColumn(ln), c + 1);
        return { startLineNumber: ln, startColumn: c, endLineNumber: el, endColumn: ec, message: x.message, severity: SEV[x.severity] || 8, source: x.source || owner };
      }));
    }
  }
  let mkTimer = 0;
  let sevSig = '';
  function markersChanged() {
    clearTimeout(mkTimer);
    mkTimer = setTimeout(() => {
      const paths = new Set([...[...st.markers.values()].flatMap((m) => [...m.keys()]), ...models.keys()]);
      const sig = [...paths].map((p) => p + ':' + sevOfPath(p)).filter((x) => !/:[0-3]$/.test(x)).sort().join('|');
      if (sig !== sevSig) { sevSig = sig; scheduleTree(); }
      paintMarkerStrip(); bus.emit('editor:markers', {});
    }, 150);
  }
  function setMarkers(path, list, owner) {
    owner = String(owner || 'ost');
    const p = U.normPath(path); if (!p) return;
    if (!st.markers.has(owner)) st.markers.set(owner, new Map());
    const arr = (Array.isArray(list) ? list : []).map(normMarker).filter(Boolean);
    const byPath = st.markers.get(owner);
    if (arr.length) byPath.set(p, arr); else byPath.delete(p);
    applyMarkers(p);
    markersChanged();
  }
  function clearMarkers(owner) {
    const owners = owner ? [String(owner)] : [...st.markers.keys()];
    for (const o of owners) {
      const byPath = st.markers.get(o); if (!byPath) continue;
      const paths = [...byPath.keys()]; byPath.clear();
      if (monaco) for (const p of paths) { const m = models.get(p); if (m && !m.isDisposed()) monaco.editor.setModelMarkers(m, o, []); }
      st.markers.delete(o);
    }
    markersChanged();
  }
  // All diagnostics for a file (or every file): ours + Monaco's (TypeScript, CSS, JSON…).
  function markersOf(path) {
    const out = [];
    const paths = path ? [U.normPath(path)] : [...new Set([...[...st.markers.values()].flatMap((m) => [...m.keys()]), ...models.keys()])];
    for (const p of paths) {
      const m = monaco && models.get(p);
      if (m && !m.isDisposed()) {
        for (const x of monaco.editor.getModelMarkers({ resource: m.uri })) out.push({ path: p, line: x.startLineNumber, col: x.startColumn, endLine: x.endLineNumber, endCol: x.endColumn, message: x.message, severity: x.severity >= 8 ? 'error' : x.severity >= 4 ? 'warning' : x.severity >= 2 ? 'info' : 'hint', owner: x.owner, source: x.source || x.owner, code: x.code && typeof x.code === 'object' ? String(x.code.value) : x.code != null ? String(x.code) : '' });
      } else {
        for (const [owner, byPath] of st.markers) for (const x of byPath.get(p) || []) out.push(Object.assign({ path: p, owner }, x));
      }
    }
    return out;
  }
  function sevOfPath(p) { let s = 0; for (const m of markersOf(p)) { const v = SEV[m.severity] || 0; if (v > s) s = v; } return s; }
  let mkList = [];
  function paintMarkerStrip() {
    if (st.mode !== 'text' || st.shown !== 'text' || !st.active) { mkEl.hidden = true; return; }
    mkList = markersOf(st.active).sort((a, b) => (SEV[b.severity] || 0) - (SEV[a.severity] || 0) || a.line - b.line);
    if (!mkList.length) { mkEl.hidden = true; mkEl.innerHTML = ''; return; }
    mkEl.hidden = false;
    mkEl.innerHTML = mkList.slice(0, 6).map((m, i) => `<button type="button" class="${esc(m.severity)}" data-i="${i}"><b>${m.severity === 'error' ? '✕' : m.severity === 'warning' ? '⚠' : 'ℹ'}</b> Ln ${m.line}: ${esc(m.message)}</button>`).join('') + (mkList.length > 6 ? `<span class="st-muted">+${mkList.length - 6} more</span>` : '');
    layoutSoon();
  }
  mkEl.addEventListener('click', (e) => { const b = e.target.closest('[data-i]'); if (!b) return; const m = mkList[+b.getAttribute('data-i')]; if (m) reveal(m.path, m.line, m.col || 1); });

  /* ======================================================================
   * reacting to the file system
   * ==================================================================== */
  function getText(p) { const v = be && be.has(p) ? be.value(p) : null; return v != null ? v : S.fs.read(p); }
  function onExternalWrite(p, source) {
    if (!st.tabs.includes(p) && !(be && be.has(p))) { syncForeignModel(p); return; }
    const content = S.fs.read(p);
    if (content == null) return;
    if (S.fs.isBinary(p)) { if (be && be.has(p)) be.drop(p); if (st.active === p) show(p); return; }
    // Our own save echoing back from the cloud while newer keystrokes wait to be saved.
    if (source === 'cloud' && st.pending.has(p) && content === st.lastSaved.get(p)) return;
    if (be && be.has(p)) { cancelPending(p); be.external(p, content); }
    if (st.active === p && (st.shown === 'media' || st.shown === 'loading') && !st.svgPreview.has(p)) show(p);
    else if (st.active === p && st.svgPreview.has(p)) showMedia(p);
  }
  function disposeForeignModel(p) {
    if (!monaco) return;
    const m = monaco.editor.getModel(uriOf(p)); if (m && models.get(p) !== m && !m.isDisposed()) m.dispose();
  }
  // A model Monaco itself created for a project file (peek / go to definition) must not go stale.
  function syncForeignModel(p) {
    if (!monaco) return;
    const m = monaco.editor.getModel(uriOf(p)); if (!m || models.get(p) === m) return;
    const c = S.fs.read(p); if (c != null && !S.fs.isBinary(p) && m.getValue() !== c) m.setValue(c);
  }
  function onRename(from, to) {
    const wasPending = st.pending.has(from);
    cancelPending(from);
    if (be && be.has(from)) be.rename(from, to);
    if (st.view.has(from)) { st.view.set(to, st.view.get(from)); st.view.delete(from); }
    if (st.failed.delete(from)) st.failed.add(to);
    if (st.svgPreview.delete(from)) st.svgPreview.add(to);
    if (st.lastSaved.has(from)) { st.lastSaved.set(to, st.lastSaved.get(from)); st.lastSaved.delete(from); }
    st.mru = st.mru.map((x) => (x === from ? to : x));
    for (const byPath of st.markers.values()) if (byPath.has(from)) { byPath.set(to, byPath.get(from)); byPath.delete(from); }
    if (ex.focus === from) ex.focus = to;
    if (ex.expanded.has(U.dirOf(from))) expandTo(to);
    const i = st.tabs.indexOf(from);
    if (i >= 0) {
      if (st.tabs.includes(to)) st.tabs.splice(i, 1); else st.tabs[i] = to;
      if (st.active === from) { st.active = to; renderCrumbs(); show(to); bus.emit('active:file', { path: to }); }
      renderTabs(); persistTabs();
    }
    if (wasPending && be && be.has(to)) scheduleSave(to);
    applyMarkers(to);
  }
  bus.on('fs:change', (e) => {
    if (!e || !e.path) return;
    const p = e.path;
    if (e.kind === 'write') { if (e.source !== 'editor') onExternalWrite(p, e.source); libs.touch(p); }
    else if (e.kind === 'remove') { if (st.tabs.includes(p) || (be && be.has(p))) dropTab(p); disposeForeignModel(p); libs.touch(p); }
    else if (e.kind === 'rename') { if (e.from) { onRename(e.from, p); disposeForeignModel(e.from); libs.touch(e.from); } libs.touch(p); }
    scheduleTree(); searchStale();
  });
  bus.on('fs:bulk', () => { rebuild(); });
  bus.on('project:open', (e) => {
    const cur = (e && e.project) || S.projects.current();
    if (cur && cur === st.proj && cur.id !== st.pid) { migrateProjectId(st.pid, cur.id); st.pid = cur.id; }
    if (!cur || cur.id !== st.pid) rebuild(); else scheduleTree();
  });
  bus.on('project:close', () => { resetAll(); st.pid = ''; st.proj = null; renderTree(); runSearch(); });
  bus.on('theme', (e) => { if (monaco) monaco.editor.setTheme(e && e.dark === false ? 'vs' : 'ost-dark'); });
  bus.on('commands', () => syncKeys());
  bus.on('activity', (e) => {
    if (e && e.id === 'search') { if (sr.stale) runSearch(); if (!mobile()) setTimeout(() => { const q = sr.q$; if (q && document.activeElement !== q) q.focus(); }, 30); }
    if (e && e.id === 'explorer') { renderTree(); revealRow(st.active); }
  });

  function migrateProjectId(oldId, newId) {
    const all = S.settings.get('editor.tabs', null);
    if (all && all[oldId]) { const c = Object.assign({}, all); c[newId] = c[oldId]; delete c[oldId]; S.settings.set('editor.tabs', c); }
    const ex2 = S.settings.get('editor.expanded', null);
    if (ex2 && ex2[oldId]) { const c = Object.assign({}, ex2); c[newId] = c[oldId]; delete c[oldId]; S.settings.set('editor.expanded', c); }
  }
  function resetAll() {
    for (const p of [...st.pending.keys()]) cancelPending(p);
    if (be) be.reset();
    const had = st.active;
    st.tabs = []; st.active = null; st.view.clear(); st.failed.clear(); st.svgPreview.clear(); st.lastSaved.clear(); st.mru = [];
    renderTabs(); renderCrumbs(); show(null);
    if (had) bus.emit('active:file', { path: null });
  }
  // A project was opened (or many files were replaced): rebuild tabs, tree, models, libs.
  function rebuild() {
    const cur = S.projects.current();
    const pid = cur ? cur.id : '';
    if (pid !== st.pid || cur !== st.proj) {
      // STUDIO.fs already points at the new project: never write old edits into it.
      resetAll();
      st.pid = pid; st.proj = cur;
      const saved = cur && (S.settings.get('editor.expanded', null) || {})[pid];
      ex.expanded = new Set(saved && Array.isArray(saved.list) ? saved.list : []);
      ex.focus = ''; ex.rootPicked = false;
      if (cur) {
        const t = (S.settings.get('editor.tabs', null) || {})[pid];
        let tabs = (t && Array.isArray(t.tabs) ? t.tabs : []).filter((p) => typeof p === 'string' && S.fs.exists(p));
        let act = t && tabs.includes(t.active) ? t.active : tabs[0];
        if (!tabs.length && !t) { const d = defaultFile(); if (d) { tabs = [d]; act = d; } }
        st.tabs = tabs;
        if (act) activate(act); else { renderTabs(); show(null); }
      }
    } else {
      for (const p of st.tabs.slice()) if (!S.fs.exists(p)) dropTab(p);
      if (be) for (const p of st.tabs) if (be.has(p) && !st.pending.has(p)) { const c = S.fs.read(p); if (c != null && !S.fs.isBinary(p) && be.value(p) !== c) be.external(p, c); }
      if (st.active) show(st.active); else show(null);
      renderTabs(); renderCrumbs();
    }
    renderTree(); libs.syncProject(); ata.schedule(); searchStale();
    if (sr.$) paintSearchHead();
  }

  /* ======================================================================
   * Explorer activity
   * ==================================================================== */
  const ex = { body: null, tree: null, expanded: new Set(), focus: '', rows: [], timer: 0, menuAt: 0, lp: 0, suppressUntil: 0, uploadDir: '' };
  function persistExpanded() {
    if (!st.pid) return;
    const all = Object.assign({}, S.settings.get('editor.expanded', null) || {});
    all[st.pid] = { list: [...ex.expanded].slice(0, 300), ts: Date.now() };
    const keys = Object.keys(all);
    if (keys.length > 30) keys.sort((a, b) => (all[a].ts || 0) - (all[b].ts || 0)).slice(0, keys.length - 30).forEach((k) => delete all[k]);
    S.settings.set('editor.expanded', all);
  }
  function expandTo(p) {
    let d = U.dirOf(p), changed = false;
    while (d) { if (!ex.expanded.has(d)) { ex.expanded.add(d); changed = true; } d = U.dirOf(d); }
    if (changed) { persistExpanded(); scheduleTree(); }
  }
  function scheduleTree() { if (!ex.timer) ex.timer = setTimeout(renderTree, 30); }
  function buildTree(files) {
    const root = { dirs: new Map(), files: [] };
    for (const f of files) {
      const parts = f.path.split('/'); let n = root;
      for (let i = 0; i < parts.length - 1; i++) {
        if (!n.dirs.has(parts[i])) n.dirs.set(parts[i], { name: parts[i], path: parts.slice(0, i + 1).join('/'), dirs: new Map(), files: [] });
        n = n.dirs.get(parts[i]);
      }
      n.files.push(f);
    }
    return root;
  }
  const byName = (a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });
  function renderTree() {
    clearTimeout(ex.timer); ex.timer = 0;
    if (!ex.tree) return;
    const cur = S.projects.current();
    if (!cur) {
      ex.rows = [];
      ex.tree.innerHTML = '<div class="st-empty">No project is open.<div class="st-editor-ebtns"><button type="button" class="st-btn primary" data-x="welcome">Open or create a project</button></div></div>';
      return;
    }
    const files = S.fs.list();
    const sev = new Map();
    for (const p of new Set([...[...st.markers.values()].flatMap((m) => [...m.keys()]), ...models.keys()])) {
      const s = sevOfPath(p); if (s < 4) continue;
      for (let d = p; d; d = U.dirOf(d)) if ((sev.get(d) || 0) < s) sev.set(d, s);
    }
    const rows = [];
    const walk = (n, depth) => {
      const dirs = [...n.dirs.values()].sort((a, b) => byName(a.name, b.name));
      for (const c of dirs) { const openD = ex.expanded.has(c.path); rows.push({ path: c.path, name: c.name, dir: true, depth, open: openD }); if (openD) walk(c, depth + 1); }
      for (const f of n.files.slice().sort((a, b) => byName(U.baseOf(a.path), U.baseOf(b.path)))) rows.push({ path: f.path, name: U.baseOf(f.path), dir: false, depth, size: f.size });
    };
    walk(buildTree(files), 0);
    ex.rows = rows;
    const drag = finePointer() ? ' draggable="true"' : '';
    let html = `<div class="st-editor-xproj${!ex.focus && ex.rootPicked ? ' focus' : ''}" data-path="" data-dir="1" title="${esc(cur.name)}"><span>${esc(cur.name)}</span><small>${files.length} file${files.length === 1 ? '' : 's'}</small></div>`;
    if (!files.length) html += '<div class="st-empty">This project has no files yet.<div class="st-editor-ebtns"><button type="button" class="st-btn" data-x="new">New file</button><button type="button" class="st-btn" data-x="upload">Upload</button></div></div>';
    html += rows.map((r, i) => {
      const on = r.path === st.active, s = sev.get(r.path) || 0;
      return `<div id="st-ex-${i}" class="st-editor-row${r.dir ? ' dir' : ''}${on ? ' on' : ''}${r.path === ex.focus ? ' focus' : ''}${s >= 8 ? ' err' : s >= 4 ? ' warn' : ''}" role="treeitem" aria-level="${r.depth + 1}"${r.dir ? ` aria-expanded="${r.open}"` : ''} aria-selected="${on}" data-path="${esc(r.path)}" data-dir="${r.dir ? 1 : 0}" style="--d:${r.depth}"${drag} title="${esc(r.path)}${r.dir ? '' : ' · ' + esc(U.fmtBytes(r.size))}"><i class="st-editor-tw${r.dir ? (r.open ? ' open' : ' closed') : ''}"></i>${r.dir ? FOLDER(r.open) : fileIcon(r.path)}<span class="st-editor-nm">${esc(r.name)}</span></div>`;
    }).join('');
    const top = ex.body.scrollTop;
    ex.tree.innerHTML = html;
    ex.body.scrollTop = top;
    paintFocusAttr();
  }
  function paintFocusAttr() {
    const i = ex.rows.findIndex((r) => r.path === ex.focus);
    if (i >= 0) ex.tree.setAttribute('aria-activedescendant', 'st-ex-' + i); else ex.tree.removeAttribute('aria-activedescendant');
  }
  function rowEl(p) { return ex.tree ? ex.tree.querySelector(`.st-editor-row[data-path="${CSS.escape(p)}"]`) : null; }
  function paintFocus() {
    if (!ex.tree) return;
    ex.tree.querySelectorAll('.st-editor-row.focus').forEach((x) => x.classList.remove('focus'));
    const hd = ex.tree.querySelector('.st-editor-xproj'); if (hd) hd.classList.toggle('focus', !ex.focus && !!ex.rootPicked);
    const r = ex.focus && rowEl(ex.focus); if (r) { r.classList.add('focus'); r.scrollIntoView({ block: 'nearest' }); }
    paintFocusAttr();
  }
  function revealRow(p) { if (!p) return; expandTo(p); renderTree(); const r = rowEl(p); if (r) r.scrollIntoView({ block: 'nearest' }); }
  function revealInExplorer(p) {
    S.ui.setActivity('explorer');
    if (isFolder(p)) ex.expanded.add(p);
    ex.focus = p; revealRow(p);
    if (!mobile()) ex.tree.focus({ preventScroll: true });
    paintFocus();
  }
  function toggleDir(p) { if (ex.expanded.has(p)) ex.expanded.delete(p); else ex.expanded.add(p); persistExpanded(); renderTree(); }
  function contextDir() {
    if (S.ui.activity() === 'explorer') {
      if (!ex.focus && ex.rootPicked) return '';
      const r = ex.focus && ex.rows.find((x) => x.path === ex.focus); if (r) return r.dir ? r.path : U.dirOf(r.path);
    }
    return st.active ? U.dirOf(st.active) : '';
  }
  const fileInput = h('input'); fileInput.type = 'file'; fileInput.multiple = true; fileInput.hidden = true;
  const dirInput = h('input'); dirInput.type = 'file'; dirInput.multiple = true; dirInput.hidden = true; dirInput.setAttribute('webkitdirectory', '');
  const dirUpload = 'webkitdirectory' in dirInput && !/iPhone|iPad|iPod/i.test(navigator.userAgent || '');
  fileInput.addEventListener('change', () => { const list = [...(fileInput.files || [])].map((f) => ({ file: f, rel: f.name })); fileInput.value = ''; uploadEntries(list, ex.uploadDir, 0); });
  dirInput.addEventListener('change', () => { const list = [...(dirInput.files || [])].map((f) => ({ file: f, rel: f.webkitRelativePath || f.name })); dirInput.value = ''; uploadEntries(list, ex.uploadDir, 0); });
  function pickUpload(folder, dir) {
    if (!requireProject()) return;
    ex.uploadDir = dir || '';
    (folder && dirUpload ? dirInput : fileInput).click();
  }
  function uploadMenu(x, y, dir) {
    if (!dirUpload) { pickUpload(false, dir); return; }
    openMenu(x, y, [{ label: 'Upload files…', run: () => pickUpload(false, dir) }, { label: 'Upload a folder…', run: () => pickUpload(true, dir) }], { alignRight: true });
  }
  function mountExplorer() {
    ex.body = S.ui.registerActivity({ id: 'explorer', icon: '📁', title: 'Explorer', order: 10 });
    ex.body.classList.add('st-editor-xbody');
    const head = ex.body.parentElement && ex.body.parentElement.querySelector('.st-side-title');
    const tools = h('div', 'st-editor-tools',
      `<button type="button" class="st-editor-tool" data-t="new" title="New file" aria-label="New file">${IC.newFile}</button>` +
      `<button type="button" class="st-editor-tool" data-t="folder" title="New folder" aria-label="New folder">${IC.newFolder}</button>` +
      `<button type="button" class="st-editor-tool" data-t="upload" title="Upload files${dirUpload ? ' or a folder' : ''}" aria-label="Upload">${IC.upload}</button>` +
      `<button type="button" class="st-editor-tool" data-t="refresh" title="Refresh (and pull cloud changes)" aria-label="Refresh">${IC.refresh}</button>` +
      `<button type="button" class="st-editor-tool" data-t="collapse" title="Collapse all folders" aria-label="Collapse all folders">${IC.collapse}</button>`);
    ex.body.innerHTML = '<div class="st-editor-tree" role="tree" tabindex="0" aria-label="Project files"></div>';
    if (head) head.appendChild(tools); else ex.body.insertBefore(tools, ex.body.firstChild);
    ex.tree = ex.body.querySelector('.st-editor-tree');
    ex.body.appendChild(fileInput); ex.body.appendChild(dirInput);
    tools.addEventListener('click', (e) => {
      const b = e.target.closest('[data-t]'); if (!b) return;
      const t = b.getAttribute('data-t'), dir = contextDir();
      if (t === 'new') newFile(dir);
      else if (t === 'folder') newFolder(dir);
      else if (t === 'upload') { const r = b.getBoundingClientRect(); uploadMenu(r.right, r.bottom + 2, dir); }
      else if (t === 'refresh') refreshExplorer();
      else if (t === 'collapse') collapseAll();
    });
    ex.tree.addEventListener('click', (e) => {
      if (Date.now() < ex.suppressUntil) return;
      const x = e.target.closest('[data-x]');
      if (x) { const a = x.getAttribute('data-x'); if (a === 'welcome' && S.ui.showWelcome) S.ui.showWelcome(); else if (a === 'new') newFile(''); else if (a === 'upload') { const r = x.getBoundingClientRect(); uploadMenu(r.right, r.bottom, ''); } return; }
      const row = e.target.closest('.st-editor-row');
      if (!row) { if (e.target === ex.tree || e.target.closest('.st-editor-xproj')) { ex.focus = ''; ex.rootPicked = true; paintFocus(); } return; }
      const p = row.getAttribute('data-path'); ex.focus = p; ex.rootPicked = false;
      if (row.getAttribute('data-dir') === '1') toggleDir(p);
      else { open(p, { fromSide: true }); paintFocus(); }
    });
    ex.tree.addEventListener('dblclick', (e) => { const row = e.target.closest('.st-editor-row'); if (row && row.getAttribute('data-dir') !== '1' && be) be.focus(); });
    ex.tree.addEventListener('focus', () => { if (!ex.focus || !ex.rows.some((r) => r.path === ex.focus)) { ex.focus = st.active && ex.rows.some((r) => r.path === st.active) ? st.active : (ex.rows[0] ? ex.rows[0].path : ''); paintFocus(); } });
    ex.tree.addEventListener('keydown', treeKeys);
    ex.tree.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (Date.now() - ex.menuAt < 700) return;
      const row = e.target.closest('[data-path]');
      rowMenu(row ? row.getAttribute('data-path') : '', row ? row.getAttribute('data-dir') === '1' : true, e.clientX, e.clientY);
    });
    // long-press = context menu on touch screens (iOS has no contextmenu event)
    ex.tree.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse') return;
      const row = e.target.closest('[data-path]'), x0 = e.clientX, y0 = e.clientY;
      let fired = false;
      clearTimeout(ex.lp);
      ex.lp = setTimeout(() => {
        fired = true;
        if (Date.now() - ex.menuAt < 700) return;
        rowMenu(row ? row.getAttribute('data-path') : '', row ? row.getAttribute('data-dir') === '1' : true, x0, y0);
        try { if (navigator.vibrate) navigator.vibrate(8); } catch (_) {}
      }, 520);
      const end = () => { clearTimeout(ex.lp); if (fired) ex.suppressUntil = Date.now() + 450; ex.tree.removeEventListener('pointerup', end); ex.tree.removeEventListener('pointercancel', end); ex.tree.removeEventListener('pointermove', mv); };
      const mv = (ev) => { if (Math.abs(ev.clientX - x0) > 8 || Math.abs(ev.clientY - y0) > 8) end(); };
      ex.tree.addEventListener('pointerup', end); ex.tree.addEventListener('pointercancel', end); ex.tree.addEventListener('pointermove', mv);
    });
    // drag & drop: move inside the tree, or upload files / folders from the OS
    ex.tree.addEventListener('dragstart', (e) => {
      const row = e.target.closest('.st-editor-row'); if (!row) return;
      const p = row.getAttribute('data-path');
      e.dataTransfer.setData(PATH_MIME, p); try { e.dataTransfer.setData('text/plain', p); } catch (_) {}
      e.dataTransfer.effectAllowed = 'copyMove';
    });
    ex.body.addEventListener('dragover', (e) => {
      const types = [...((e.dataTransfer && e.dataTransfer.types) || [])];
      const internal = types.includes(PATH_MIME), files = types.includes('Files');
      if (!internal && !files) return;
      if (!S.projects.current()) return;
      e.preventDefault(); e.dataTransfer.dropEffect = internal ? 'move' : 'copy';
      markDrop(dropDir(e.target));
    });
    ex.body.addEventListener('dragleave', (e) => { if (!e.relatedTarget || !ex.body.contains(e.relatedTarget)) markDrop(null); });
    ex.body.addEventListener('drop', (e) => {
      const types = [...((e.dataTransfer && e.dataTransfer.types) || [])];
      const dir = dropDir(e.target); markDrop(null);
      if (types.includes(PATH_MIME)) { e.preventDefault(); moveInto(e.dataTransfer.getData(PATH_MIME), dir); return; }
      if (types.includes('Files') && S.projects.current()) { e.preventDefault(); collectDrop(e.dataTransfer).then((r) => uploadEntries(r.list, dir, r.junk)); }
    });
    renderTree();
  }
  function dropDir(target) { const row = target && target.closest && target.closest('[data-path]'); if (!row) return ''; const p = row.getAttribute('data-path'); return row.getAttribute('data-dir') === '1' ? p : U.dirOf(p); }
  function markDrop(dir) {
    if (!ex.tree) return;
    ex.tree.querySelectorAll('.drop').forEach((x) => x.classList.remove('drop'));
    ex.tree.classList.toggle('drop-root', dir === '');
    if (dir) { const r = rowEl(dir); if (r) r.classList.add('drop'); }
  }
  function treeKeys(e) {
    const rows = ex.rows; if (!rows.length) return;
    const i = rows.findIndex((r) => r.path === ex.focus), r = rows[i];
    const go = (j) => { j = Math.max(0, Math.min(rows.length - 1, j)); ex.focus = rows[j].path; ex.rootPicked = false; paintFocus(); };
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); go(i + 1); break;
      case 'ArrowUp': e.preventDefault(); go(i < 0 ? 0 : i - 1); break;
      case 'Home': e.preventDefault(); go(0); break;
      case 'End': e.preventDefault(); go(rows.length - 1); break;
      case 'ArrowRight': e.preventDefault(); if (r && r.dir) { if (!r.open) toggleDir(r.path); else go(i + 1); } break;
      case 'ArrowLeft': e.preventDefault(); if (r) { if (r.dir && r.open) toggleDir(r.path); else if (U.dirOf(r.path)) { ex.focus = U.dirOf(r.path); paintFocus(); } } break;
      case 'Enter': case ' ':
        e.preventDefault(); if (!r) break;
        if (r.dir) toggleDir(r.path); else open(r.path, { fromSide: true, focus: e.key === 'Enter' });
        break;
      case 'F2': e.preventDefault(); if (r) renamePath(r.path); break;
      case 'Delete': e.preventDefault(); if (r) deletePath(r.path); break;
      case 'Backspace': if (e.metaKey && r) { e.preventDefault(); deletePath(r.path); } break;
      default: break;
    }
  }
  function rowMenu(p, dir, x, y) {
    let items;
    if (!p) items = [{ label: 'New file…', run: () => newFile('') }, { label: 'New folder…', run: () => newFolder('') }, '-', { label: 'Upload files…', run: () => pickUpload(false, '') }].concat(dirUpload ? [{ label: 'Upload a folder…', run: () => pickUpload(true, '') }] : []).concat(['-', { label: 'Collapse all folders', run: collapseAll }, { label: 'Refresh', run: refreshExplorer }]);
    else if (dir) items = [{ label: 'New file here…', run: () => newFile(p) }, { label: 'New folder here…', run: () => newFolder(p) }, { label: 'Upload files here…', run: () => pickUpload(false, p) }, '-', { label: 'Rename…', kbd: 'F2', run: () => renamePath(p) }, { label: 'Duplicate', run: () => duplicatePath(p) }, { label: 'Copy path', run: () => copyPath(p) }, '-', { label: 'Delete', kbd: 'Del', danger: true, run: () => deletePath(p) }];
    else items = [{ label: 'Open', run: () => open(p, { fromSide: true, focus: true }) }, { label: 'New file here…', run: () => newFile(U.dirOf(p)) }, '-', { label: 'Rename…', kbd: 'F2', run: () => renamePath(p) }, { label: 'Duplicate', run: () => duplicatePath(p) }, { label: 'Copy path', run: () => copyPath(p) }, { label: 'Download', run: () => downloadPath(p) }, '-', { label: 'Delete', kbd: 'Del', danger: true, run: () => deletePath(p) }];
    if (p) { ex.focus = p; ex.rootPicked = false; } else { ex.focus = ''; ex.rootPicked = true; }
    paintFocus();
    ex.menuAt = Date.now();
    openMenu(x, y, items);
  }
  function collapseAll() { ex.expanded.clear(); persistExpanded(); renderTree(); }
  function refreshExplorer() {
    renderTree();
    const cur = S.projects.current();
    if (cur && cur.cloud) S.projects.syncNow().then(() => renderTree(), () => {});
  }

  /* ---------- file operations ---------- */
  async function newFile(dir) {
    if (!requireProject()) return;
    const name = await S.ui.prompt(dir ? `New file in ${dir}/` : 'New file', '', { placeholder: 'name.js — use / to create folders', okText: 'Create' });
    if (!name) return;
    const p = U.normPath((dir ? dir + '/' : '') + name.replace(/^\/+/, ''));
    if (!p || /\/\s*$/.test(name)) { toast('That is not a valid file name.', 'err'); return; }
    if (S.fs.exists(p)) { open(p, { fromSide: true, focus: true }); toast(p + ' already exists — opened it.', 'warn'); return; }
    if (S.fs.folders().includes(p)) { toast('A folder named ' + p + ' already exists.', 'err'); return; }
    try { await S.fs.write(p, '', { source: 'user' }); } catch (e) { toast(e.message, 'err'); return; }
    expandTo(p); ex.focus = p;
    open(p, { fromSide: true, focus: true });
  }
  async function newFolder(dir) {
    if (!requireProject()) return;
    const name = await S.ui.prompt(dir ? `New folder in ${dir}/` : 'New folder', '', { placeholder: 'folder name', okText: 'Create' });
    if (!name) return;
    const p = U.normPath((dir ? dir + '/' : '') + name.replace(/^\/+/, ''));
    if (!p) { toast('That is not a valid folder name.', 'err'); return; }
    if (S.fs.exists(p)) { toast('A file named ' + p + ' already exists.', 'err'); return; }
    if (S.fs.folders().includes(p)) { revealInExplorer(p); return; }
    try { await S.fs.write(p + '/.gitkeep', '', { source: 'user' }); } catch (e) { toast(e.message, 'err'); return; }
    ex.expanded.add(p); expandTo(p + '/.gitkeep'); ex.focus = p; persistExpanded(); renderTree(); paintFocus();
  }
  function pendingUnder(p) { return [...st.pending.keys()].filter((k) => k === p || k.startsWith(p + '/')); }
  async function renamePath(p) {
    if (!p) return;
    const dirMode = isFolder(p);
    if (!dirMode && !S.fs.exists(p)) return;
    const name = await S.ui.prompt(`Rename ${dirMode ? 'folder' : 'file'} — ${p}`, U.baseOf(p), { okText: 'Rename', placeholder: 'new name (use / to move)' });
    if (!name || name === U.baseOf(p)) return;
    const dir = U.dirOf(p);
    const to = U.normPath(name.startsWith('/') ? name : (dir ? dir + '/' : '') + name);
    if (!to) { toast('That is not a valid name.', 'err'); return; }
    if (to === p) return;
    if (dirMode && (to + '/').startsWith(p + '/')) { toast("A folder can't be moved into itself.", 'err'); return; }
    if (S.fs.exists(to) || S.fs.folders().includes(to)) { toast(to + ' already exists.', 'err'); return; }
    await Promise.all(pendingUnder(p).map((k) => save(k)));
    try { await S.fs.rename(p, to); } catch (e) { toast(e.message, 'err'); return; }
    if (dirMode) { ex.expanded = new Set([...ex.expanded].map((d) => (d === p ? to : d.startsWith(p + '/') ? to + d.slice(p.length) : d))); persistExpanded(); }
    expandTo(to); ex.focus = to; renderTree(); paintFocus();
  }
  async function deletePath(p) {
    if (!p) return;
    const dirMode = isFolder(p);
    if (!dirMode && !S.fs.exists(p)) return;
    const n = dirMode ? S.fs.list().filter((f) => f.path.startsWith(p + '/')).length : 1;
    const ok = await S.ui.confirm(dirMode ? `Delete the folder “${p}” and the ${n} file${n === 1 ? '' : 's'} in it? This can't be undone.` : `Delete “${p}”? This can't be undone.`, { danger: true, okText: 'Delete' });
    if (!ok) return;
    pendingUnder(p).forEach(cancelPending);
    try { await S.fs.remove(p); } catch (e) { toast(e.message, 'err'); return; }
    if (dirMode) { ex.expanded = new Set([...ex.expanded].filter((d) => d !== p && !d.startsWith(p + '/'))); persistExpanded(); }
    if (ex.focus === p) ex.focus = U.dirOf(p);
    renderTree();
  }
  function uniqueCopy(p, dirMode) {
    const dir = U.dirOf(p), base = U.baseOf(p), i = dirMode ? -1 : base.lastIndexOf('.');
    const stem = i > 0 ? base.slice(0, i) : base, ext = i > 0 ? base.slice(i) : '';
    for (let n = 1; n < 1000; n++) {
      const cand = (dir ? dir + '/' : '') + stem + (n === 1 ? ' copy' : ' copy ' + n) + ext;
      if (!S.fs.exists(cand) && !S.fs.folders().includes(cand)) return cand;
    }
    return '';
  }
  async function duplicatePath(p) {
    const dirMode = isFolder(p);
    const target = uniqueCopy(p, dirMode); if (!target) return;
    try {
      if (dirMode) {
        const files = S.fs.list().filter((f) => f.path.startsWith(p + '/'));
        if (S.fs.list().length + files.length > S.limits.files) { toast(`That would exceed the ${S.limits.files}-file project limit.`, 'err'); return; }
        for (const f of files) await S.fs.write(target + f.path.slice(p.length), getText(f.path), { source: 'user', binary: f.binary });
        ex.expanded.add(target); persistExpanded();
      } else {
        await S.fs.write(target, getText(p), { source: 'user', binary: S.fs.isBinary(p) });
        open(target, { fromSide: true });
      }
      expandTo(target); ex.focus = target; renderTree(); paintFocus();
    } catch (e) { toast(e.message, 'err'); }
  }
  async function copyPath(p) {
    let ok = false;
    try { if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(p); ok = true; } } catch (_) {}
    if (!ok) { const t = h('textarea'); t.value = p; t.style.cssText = 'position:fixed;opacity:0;left:-9999px'; document.body.appendChild(t); t.select(); try { ok = document.execCommand('copy'); } catch (_) {} t.remove(); }
    toast(ok ? 'Copied ' + p : 'Could not copy — your browser blocked the clipboard.', ok ? 'ok' : 'warn');
  }
  async function moveInto(src, dir) {
    if (!src) return;
    const to = U.normPath((dir ? dir + '/' : '') + U.baseOf(src));
    if (!to || to === src) return;
    if (dir && (dir + '/').startsWith(src + '/')) { toast("A folder can't be moved into itself.", 'warn'); return; }
    if (S.fs.exists(to) || S.fs.folders().includes(to)) { toast(to + ' already exists there.', 'err'); return; }
    const dirMode = isFolder(src);
    await Promise.all(pendingUnder(src).map((k) => save(k)));
    try { await S.fs.rename(src, to); } catch (e) { toast(e.message, 'err'); return; }
    if (dirMode && ex.expanded.has(src)) { ex.expanded = new Set([...ex.expanded].map((d) => (d === src ? to : d.startsWith(src + '/') ? to + d.slice(src.length) : d))); persistExpanded(); }
    expandTo(to); ex.focus = to; renderTree();
  }

  /* ---------- uploads ---------- */
  const JUNK_DIR = /(^|\/)(node_modules|\.git|\.next|\.cache|__pycache__|\.venv)(\/|$)/;
  const JUNK_FILE = /(^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini)$/i;
  async function readUpload(file, path) {
    let binary = !U.isTextPath(path);
    if (!binary) { try { const head = new Uint8Array(await file.slice(0, 8192).arrayBuffer()); if (head.includes(0)) binary = true; } catch (_) {} }
    if (!binary) { let t = await file.text(); if (t.charCodeAt(0) === 0xfeff) t = t.slice(1); return { content: t, binary: false }; }
    const url = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result || '')); r.onerror = () => rej(r.error || new Error('read failed')); r.readAsDataURL(file); });
    const mime = (file.type && /^[\w.+-]+\/[\w.+-]+$/.test(file.type) ? file.type : '') || U.mimeOf(path);
    const i = url.indexOf(';base64,');
    return { content: 'data:' + mime + ';base64,' + (i >= 0 ? url.slice(i + 8) : ''), binary: true };
  }
  async function collectDrop(dt) {
    const entries = [], loose = []; let junk = 0;
    // Must run synchronously inside the drop event: DataTransfer items expire afterwards.
    for (const it of [...(dt.items || [])]) { if (it.kind !== 'file') continue; const en = it.webkitGetAsEntry ? it.webkitGetAsEntry() : null; if (en) entries.push(en); else { const f = it.getAsFile(); if (f) loose.push(f); } }
    if (!entries.length && !loose.length) for (const f of [...(dt.files || [])]) loose.push(f);
    const list = loose.map((f) => ({ file: f, rel: f.name }));
    const walk = async (en, prefix) => {
      if (list.length > 3000) return;
      if (en.isFile) { const f = await new Promise((res) => en.file(res, () => res(null))); if (f) list.push({ file: f, rel: prefix + en.name }); return; }
      if (!en.isDirectory) return;
      if (JUNK_DIR.test(en.name)) { junk++; return; }
      const rd = en.createReader();
      for (;;) { const batch = await new Promise((res) => rd.readEntries(res, () => res([]))); if (!batch.length) break; for (const c of batch) await walk(c, prefix + en.name + '/'); }
    };
    for (const en of entries) await walk(en, '');
    return { list, junk };
  }
  async function uploadEntries(list, dir, junk) {
    if (!list || !list.length) { if (junk) toast('Nothing to upload — node_modules / .git folders are skipped (npm packages load from esm.sh).', 'warn'); return; }
    if (!requireProject()) return;
    const L = S.limits, cur = S.fs.list();
    let count = cur.length, total = cur.reduce((a, f) => a + (f.size || 0), 0);
    const sizeOf = new Map(cur.map((f) => [f.path, f.size || 0]));
    const plan = [], skipped = []; junk = junk || 0;
    for (const { file, rel } of list) {
      const r = U.normPath(rel);
      if (!r) { skipped.push(rel + ' (invalid name)'); continue; }
      if (JUNK_DIR.test(r) || JUNK_FILE.test(r)) { junk++; continue; }
      const p = U.normPath((dir ? dir + '/' : '') + r);
      if (!p) { skipped.push(r + ' (path too long)'); continue; }
      if (file.size > L.fileBytes) { skipped.push(`${r} (${U.fmtBytes(file.size)}; limit ${U.fmtBytes(L.fileBytes)})`); continue; }
      plan.push({ file, path: p });
    }
    const clash = plan.filter((x) => S.fs.exists(x.path));
    if (clash.length) {
      const ok = await S.ui.confirm(`${clash.length} file${clash.length > 1 ? 's' : ''} already exist${clash.length > 1 ? '' : 's'} (${clash.slice(0, 3).map((x) => x.path).join(', ')}${clash.length > 3 ? ', …' : ''}). Replace ${clash.length > 1 ? 'them' : 'it'}?`, { okText: 'Replace' });
      if (!ok) for (const c of clash) plan.splice(plan.indexOf(c), 1);
    }
    let done = 0; const added = [];
    for (const { file, path } of plan) {
      const prev = sizeOf.get(path);
      if (prev == null && count >= L.files) { skipped.push(`${path} (project limit: ${L.files} files)`); continue; }
      if (total - (prev || 0) + file.size > L.projectBytes) { skipped.push(`${path} (project limit: ${U.fmtBytes(L.projectBytes)})`); continue; }
      let r;
      try { r = await readUpload(file, path); } catch (_) { skipped.push(path + ' (could not be read)'); continue; }
      try { await S.fs.write(path, r.content, { source: 'user', binary: r.binary }); } catch (e) { skipped.push(`${path} (${e.message})`); continue; }
      if (prev == null) count++;
      total += file.size - (prev || 0); sizeOf.set(path, file.size);
      done++; added.push(path);
      if (plan.length > 8 && done % 10 === 0) S.ui.setStatus('upload', `⬆ uploading ${done}/${plan.length}`, { side: 'left', order: 40 });
    }
    S.ui.setStatus('upload', '');
    for (const p of added) expandTo(p);
    if (added.length) { ex.focus = added[0]; renderTree(); paintFocus(); }
    const extra = [];
    if (skipped.length) extra.push(`skipped ${skipped.length}: ${skipped.slice(0, 3).join('; ')}${skipped.length > 3 ? '; …' : ''}`);
    if (junk) extra.push(`ignored ${junk} node_modules/.git/system item${junk === 1 ? '' : 's'}`);
    if (done || skipped.length) toast((done ? `Uploaded ${done} file${done === 1 ? '' : 's'}` : 'Nothing uploaded') + (extra.length ? ' · ' + extra.join(' · ') : ''), skipped.length ? (done ? 'warn' : 'err') : 'ok');
    if (done === 1 && !S.fs.isBinary(added[0])) open(added[0], { fromSide: true });
    return { uploaded: added, skipped };
  }
  // Files dropped on the editor area join the project next to the open file.
  stageEl.addEventListener('dragover', (e) => {
    const types = [...((e.dataTransfer && e.dataTransfer.types) || [])];
    if (!types.includes('Files') || !S.projects.current()) return;
    e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'copy'; dropCue.hidden = false;
  }, true);
  stageEl.addEventListener('dragleave', (e) => { if (!e.relatedTarget || !stageEl.contains(e.relatedTarget)) dropCue.hidden = true; }, true);
  stageEl.addEventListener('drop', (e) => {
    const types = [...((e.dataTransfer && e.dataTransfer.types) || [])];
    dropCue.hidden = true;
    if (!types.includes('Files') || !S.projects.current()) return;
    e.preventDefault(); e.stopPropagation();
    const dir = st.active ? U.dirOf(st.active) : '';
    collectDrop(e.dataTransfer).then((r) => uploadEntries(r.list, dir, r.junk));
  }, true);
  // A file dropped anywhere else must not navigate the tab away from the studio.
  window.addEventListener('dragover', (e) => { if (!e.defaultPrevented && e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { e.preventDefault(); e.dataTransfer.dropEffect = 'none'; } });
  window.addEventListener('drop', (e) => { if (!e.defaultPrevented && e.dataTransfer && [...e.dataTransfer.types].includes('Files')) e.preventDefault(); });

  /* ======================================================================
   * context menu
   * ==================================================================== */
  let menuEl = null, menuItems = [];
  function closeMenu() { if (!menuEl) return; menuEl.remove(); menuEl = null; document.removeEventListener('pointerdown', menuOutside, true); window.removeEventListener('blur', closeMenu); window.removeEventListener('resize', closeMenu); }
  function menuOutside(e) { if (menuEl && !menuEl.contains(e.target)) closeMenu(); }
  function openMenu(x, y, items, o) {
    o = o || {};
    closeMenu();
    menuItems = items;
    menuEl = h('div', 'st-editor-menu');
    menuEl.setAttribute('role', 'menu');
    menuEl.innerHTML = items.map((it, i) => (it === '-' ? '<hr>' : `<button type="button" role="menuitem" data-i="${i}" class="${it.danger ? 'danger' : ''}"${it.disabled ? ' disabled' : ''}><span>${esc(it.label)}</span>${it.kbd && !mobile() ? `<kbd>${esc(kbdLabel(it.kbd))}</kbd>` : ''}</button>`)).join('');
    document.body.appendChild(menuEl);
    const r = menuEl.getBoundingClientRect(), vw = window.innerWidth, vh = window.innerHeight;
    let left = o.alignRight ? x - r.width : x, top = y;
    left = Math.max(6, Math.min(left, vw - r.width - 6)); top = Math.max(6, Math.min(top, vh - r.height - 6));
    menuEl.style.left = left + 'px'; menuEl.style.top = top + 'px';
    menuEl.addEventListener('click', (e) => {
      const b = e.target.closest('[data-i]'); if (!b || b.disabled) return;
      const it = menuItems[+b.getAttribute('data-i')]; closeMenu();
      // run synchronously: file pickers need the click's user activation
      try { const res = it.run(); if (res && res.catch) res.catch((err) => toast(err.message || String(err), 'err')); } catch (err) { toast(err.message || String(err), 'err'); }
    });
    menuEl.addEventListener('keydown', (e) => {
      const btns = [...menuEl.querySelectorAll('button:not([disabled])')], i = btns.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); (btns[i + 1] || btns[0]).focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); (btns[i - 1] || btns[btns.length - 1]).focus(); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMenu(); }
      else if (e.key === 'Tab') { e.preventDefault(); }
    });
    setTimeout(() => { if (!menuEl) return; document.addEventListener('pointerdown', menuOutside, true); window.addEventListener('blur', closeMenu); window.addEventListener('resize', closeMenu); const f = menuEl.querySelector('button:not([disabled])'); if (f && finePointer()) f.focus(); }, 0);
  }

  /* ======================================================================
   * Search activity
   * ==================================================================== */
  const sr = { $: null, q$: null, q: '', rep: '', inc: '', opt: { case: false, word: false, regex: false }, showRep: false, results: [], total: 0, capped: false, collapsed: new Set(), timer: 0, stale: false };
  let lookbehind = true; try { new RegExp('(?<!a)b'); } catch (_) { lookbehind = false; }
  function compileQuery(q, o, extraFlags) {
    let src = o.regex ? q : q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (o.word) src = lookbehind ? '(?<![\\w$])(?:' + src + ')(?![\\w$])' : '\\b(?:' + src + ')\\b';
    return new RegExp(src, 'g' + (o.case ? '' : 'i') + (extraFlags || ''));
  }
  function includeFilter(s) {
    const parts = String(s || '').split(',').map((x) => x.trim()).filter(Boolean);
    if (!parts.length) return () => true;
    const tests = parts.map((g0) => {
      let g = g0; const neg = g.startsWith('!'); if (neg) g = g.slice(1);
      let t;
      if (/[*?]/.test(g)) {
        const body = g.replace(/^\.?\//, '').replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*\//g, '\u0000').replace(/\*\*/g, '\u0001').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]').replace(/\u0000/g, '(?:.*/)?').replace(/\u0001/g, '.*');
        const re = new RegExp('(^|/)' + body + '$', 'i'); t = (p) => re.test(p);
      } else { const low = g.replace(/^\.?\//, '').toLowerCase(); t = (p) => p.toLowerCase().includes(low); }
      return { neg, t };
    });
    const pos = tests.filter((x) => !x.neg), negs = tests.filter((x) => x.neg);
    return (p) => (!pos.length || pos.some((x) => x.t(p))) && !negs.some((x) => x.t(p));
  }
  function expandRep(rep, m) {
    return rep.replace(/\$(\$|&|\d{1,2}|<([^>]*)>)/g, (all, g, name) => {
      if (g === '$') return '$';
      if (g === '&') return m[0];
      if (name != null) return m.groups && name in m.groups ? (m.groups[name] == null ? '' : m.groups[name]) : all;
      const n = +g; return n > 0 && n < m.length ? (m[n] == null ? '' : m[n]) : all;
    }).replace(/\\n/g, '\n').replace(/\\t/g, '\t');
  }
  const replacementFor = (m) => (sr.opt.regex ? expandRep(sr.rep, m.m) : sr.rep);
  function searchStale() {
    if (!sr.q) return;
    if (S.ui.activity() === 'search') { clearTimeout(sr.timer); sr.timer = setTimeout(runSearch, 450); }
    else sr.stale = true;
  }
  function mountSearch() {
    sr.$ = S.ui.registerActivity({ id: 'search', icon: '🔍', title: 'Search', order: 20 });
    sr.$.classList.add('st-editor-sbody');
    const saved = S.settings.get('editor.search', null);
    if (saved && typeof saved === 'object') { sr.opt.case = !!saved.case; sr.opt.word = !!saved.word; sr.opt.regex = !!saved.regex; sr.inc = String(saved.inc || ''); }
    const head = sr.$.parentElement && sr.$.parentElement.querySelector('.st-side-title');
    const tools = h('div', 'st-editor-tools',
      `<button type="button" class="st-editor-tool" data-t="refresh" title="Search again" aria-label="Search again">${IC.refresh}</button>` +
      `<button type="button" class="st-editor-tool" data-t="clear" title="Clear search" aria-label="Clear search">${IC.clear}</button>` +
      `<button type="button" class="st-editor-tool" data-t="collapse" title="Collapse all results" aria-label="Collapse all results">${IC.collapse}</button>`);
    sr.$.innerHTML = `
      <div class="st-editor-sform">
        <button type="button" class="st-editor-rtoggle" data-s="toggle" title="Toggle replace" aria-label="Toggle replace" aria-expanded="false"><i class="st-editor-tw closed"></i></button>
        <div class="st-editor-sfields">
          <div class="st-editor-sfield"><input class="st-input" data-s="q" placeholder="Search" spellcheck="false" autocomplete="off" autocapitalize="off" aria-label="Search">
            <span class="st-editor-sopts"><button type="button" data-o="case" title="Match case" aria-pressed="false">Aa</button><button type="button" data-o="word" title="Match whole word" aria-pressed="false"><u>ab</u></button><button type="button" data-o="regex" title="Use regular expression" aria-pressed="false">.*</button></span></div>
          <div class="st-editor-sfield" data-s="repwrap" hidden><input class="st-input" data-s="r" placeholder="Replace" spellcheck="false" autocomplete="off" autocapitalize="off" aria-label="Replace">
            <span class="st-editor-sopts"><button type="button" data-s="repall" title="Replace all" aria-label="Replace all">${IC.replaceAll}</button></span></div>
        </div>
      </div>
      <input class="st-input st-editor-sinc" data-s="inc" placeholder="files to include — e.g. src/, *.css, !*.md" spellcheck="false" autocomplete="off" autocapitalize="off" aria-label="Files to include">
      <div class="st-editor-smeta" aria-live="polite"></div>
      <div class="st-editor-sres"></div>`;
    if (head) head.appendChild(tools); else sr.$.insertBefore(tools, sr.$.firstChild);
    sr.q$ = sr.$.querySelector('[data-s="q"]');
    const r$ = sr.$.querySelector('[data-s="r"]'), inc$ = sr.$.querySelector('[data-s="inc"]');
    inc$.value = sr.inc;
    const later = () => { clearTimeout(sr.timer); sr.timer = setTimeout(runSearch, 220); };
    const saveOpts = () => S.settings.set('editor.search', { case: sr.opt.case, word: sr.opt.word, regex: sr.opt.regex, inc: sr.inc });
    sr.q$.addEventListener('input', () => { sr.q = sr.q$.value; later(); });
    sr.q$.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); sr.q = sr.q$.value; runSearch(); } });
    r$.addEventListener('input', () => { sr.rep = r$.value; paintResults(); });
    r$.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); replaceAll(); } });
    inc$.addEventListener('input', () => { sr.inc = inc$.value; saveOpts(); later(); });
    sr.$.addEventListener('click', (e) => {
      const o = e.target.closest('[data-o]');
      if (o) { const k = o.getAttribute('data-o'); sr.opt[k] = !sr.opt[k]; saveOpts(); paintSearchHead(); runSearch(); return; }
      const s = e.target.closest('[data-s]');
      if (s && s.getAttribute('data-s') === 'toggle') { sr.showRep = !sr.showRep; paintSearchHead(); paintResults(); if (sr.showRep && !mobile()) r$.focus(); return; }
      if (s && s.getAttribute('data-s') === 'repall') { replaceAll(); return; }
      const rf = e.target.closest('[data-rf]'); if (rf) { e.stopPropagation(); replaceInFile(sr.results[+rf.getAttribute('data-rf')].path, null).then((n) => { if (n) toast(`Replaced ${n} in ${U.baseOf(sr.results[+rf.getAttribute('data-rf')] ? sr.results[+rf.getAttribute('data-rf')].path : '')}`.trim(), 'ok'); runSearch(); }); return; }
      const rm = e.target.closest('[data-rm]'); if (rm) { e.stopPropagation(); const [fi, mi] = rm.getAttribute('data-rm').split(':').map(Number); const r = sr.results[fi]; if (r) replaceInFile(r.path, mi).then(() => runSearch()); return; }
      const f = e.target.closest('.st-editor-sfile'); if (f) { const r = sr.results[+f.getAttribute('data-f')]; if (r) { if (sr.collapsed.has(r.path)) sr.collapsed.delete(r.path); else sr.collapsed.add(r.path); paintResults(); } return; }
      const l = e.target.closest('.st-editor-sline'); if (l) { const r = sr.results[+l.getAttribute('data-f')], m = r && r.ms[+l.getAttribute('data-m')]; if (m) reveal(r.path, m.line, m.col, { len: m.len, fromSide: true, focus: !mobile() }); }
    });
    tools.addEventListener('click', (e) => {
      const b = e.target.closest('[data-t]'); if (!b) return;
      const t = b.getAttribute('data-t');
      if (t === 'refresh') runSearch();
      else if (t === 'clear') { sr.q = ''; sr.q$.value = ''; sr.rep = ''; r$.value = ''; runSearch(); sr.q$.focus(); }
      else if (t === 'collapse') { const all = sr.results.every((r) => sr.collapsed.has(r.path)); sr.collapsed = all ? new Set() : new Set(sr.results.map((r) => r.path)); paintResults(); }
    });
    paintSearchHead();
  }
  function paintSearchHead() {
    if (!sr.$) return;
    for (const k of ['case', 'word', 'regex']) { const b = sr.$.querySelector(`[data-o="${k}"]`); b.classList.toggle('on', sr.opt[k]); b.setAttribute('aria-pressed', String(sr.opt[k])); }
    sr.$.querySelector('[data-s="repwrap"]').hidden = !sr.showRep;
    const t = sr.$.querySelector('[data-s="toggle"]'); t.setAttribute('aria-expanded', String(sr.showRep)); t.firstElementChild.className = 'st-editor-tw ' + (sr.showRep ? 'open' : 'closed');
  }
  function runSearch() {
    clearTimeout(sr.timer); sr.timer = 0; sr.stale = false;
    if (!sr.$) return;
    const meta = sr.$.querySelector('.st-editor-smeta');
    if (!S.projects.current() || !sr.q) { sr.results = []; sr.total = 0; meta.textContent = S.projects.current() || !sr.q ? '' : 'Open a project to search it.'; paintResults(); return; }
    let re, quick;
    try { re = compileQuery(sr.q, sr.opt); quick = compileQuery(sr.q, sr.opt, 'm'); }
    catch (e) { sr.results = []; meta.innerHTML = `<span class="st-editor-serr">${esc(e.message)}</span>`; sr.$.querySelector('.st-editor-sres').innerHTML = ''; return; }
    let incl; try { incl = includeFilter(sr.inc); } catch (_) { incl = () => true; }
    const out = []; let total = 0, capped = false;
    for (const f of S.fs.list()) {
      if (f.binary || !incl(f.path)) continue;
      const text = getText(f.path); if (!text) continue;
      quick.lastIndex = 0; if (!quick.test(text)) continue;
      const ms = [], lines = text.split('\n');
      for (let i = 0; i < lines.length && !capped; i++) {
        const line = lines[i].endsWith('\r') ? lines[i].slice(0, -1) : lines[i];
        re.lastIndex = 0; let m;
        while ((m = re.exec(line))) {
          if (!m[0].length) { re.lastIndex++; if (re.lastIndex > line.length) break; continue; }
          ms.push({ line: i + 1, col: m.index + 1, len: m[0].length, text: line, m });
          if (++total >= MAX_RESULTS) { capped = true; break; }
        }
      }
      if (ms.length) out.push({ path: f.path, ms });
      if (capped) break;
    }
    sr.results = out; sr.total = total; sr.capped = capped;
    const nf = out.length;
    meta.textContent = total ? `${total}${capped ? '+' : ''} result${total === 1 ? '' : 's'} in ${nf} file${nf === 1 ? '' : 's'}${capped ? ` (showing the first ${MAX_RESULTS})` : ''}` : 'No results.';
    paintResults();
  }
  function previewHtml(m) {
    const t = m.text, s = m.col - 1, e = s + m.len, lead = Math.max(0, s - 32);
    let pre = t.slice(lead, s); if (!lead) pre = pre.replace(/^\s+/, '');
    const mid = t.slice(s, e), post = t.slice(e, e + 160);
    const rep = sr.showRep ? replacementFor(m) : null;
    return `<span class="st-editor-sln">${m.line}</span><span class="st-editor-stx">${lead ? '…' : ''}${esc(pre)}${rep == null ? `<mark>${esc(mid)}</mark>` : `<del>${esc(mid)}</del><ins>${esc(rep)}</ins>`}${esc(post)}</span>`;
  }
  function paintResults() {
    if (!sr.$) return;
    const box = sr.$.querySelector('.st-editor-sres');
    box.innerHTML = sr.results.map((r, fi) => {
      const col = sr.collapsed.has(r.path);
      const head = `<div class="st-editor-sfile" data-f="${fi}" title="${esc(r.path)}"><i class="st-editor-tw ${col ? 'closed' : 'open'}"></i>${fileIcon(r.path)}<span class="st-editor-nm">${esc(U.baseOf(r.path))}</span><span class="st-editor-sdir">${esc(U.dirOf(r.path))}</span><span class="st-editor-scount">${r.ms.length}</span>${sr.showRep ? `<button type="button" class="st-editor-sact" data-rf="${fi}" title="Replace all in this file" aria-label="Replace all in this file">${IC.replaceAll}</button>` : ''}</div>`;
      if (col) return head;
      const shown = r.ms.slice(0, 400);
      return head + shown.map((m, mi) => `<div class="st-editor-sline" data-f="${fi}" data-m="${mi}" title="${esc(r.path)}:${m.line}:${m.col}">${previewHtml(m)}${sr.showRep ? `<button type="button" class="st-editor-sact" data-rm="${fi}:${mi}" title="Replace" aria-label="Replace">${IC.replace}</button>` : ''}</div>`).join('') + (r.ms.length > shown.length ? `<div class="st-editor-smore">+${r.ms.length - shown.length} more in this file</div>` : '');
    }).join('');
  }
  function matchFromArgs(args) {
    const hasGroups = args.length && typeof args[args.length - 1] === 'object' && args[args.length - 1] !== null;
    const arr = args.slice(0, args.length - (hasGroups ? 3 : 2));
    arr.groups = hasGroups ? args[args.length - 1] : undefined;
    return arr;
  }
  async function writeUserText(p, text) {
    if (be && be.has(p)) { be.setText(p, text); await save(p); }
    else await S.fs.write(p, text, { source: 'editor' });
  }
  function replaceText(text) {
    const re = compileQuery(sr.q, sr.opt); let n = 0;
    const lines = text.split('\n').map((line) => {
      const cr = line.endsWith('\r'), body = cr ? line.slice(0, -1) : line;
      const out = body.replace(re, (...args) => { const m = matchFromArgs(args); if (!m[0].length) return m[0]; n++; return sr.opt.regex ? expandRep(sr.rep, m) : sr.rep; });
      return cr ? out + '\r' : out;
    });
    return { text: lines.join('\n'), n };
  }
  async function replaceInFile(path, onlyIndex) {
    const text = getText(path); if (text == null) return 0;
    if (onlyIndex != null) {
      const r = sr.results.find((x) => x.path === path), m = r && r.ms[onlyIndex]; if (!m) return 0;
      const lines = text.split('\n'), raw = lines[m.line - 1];
      if (raw == null || raw.substr(m.col - 1, m.len) !== m.m[0]) { toast('That file changed — results refreshed.', 'warn'); return 0; }
      lines[m.line - 1] = raw.slice(0, m.col - 1) + replacementFor(m) + raw.slice(m.col - 1 + m.len);
      try { await writeUserText(path, lines.join('\n')); } catch (e) { toast(e.message, 'err'); return 0; }
      return 1;
    }
    const r = replaceText(text); if (!r.n) return 0;
    try { await writeUserText(path, r.text); } catch (e) { toast(e.message, 'err'); return 0; }
    return r.n;
  }
  async function replaceAll() {
    if (!sr.q || !sr.results.length) { toast('Nothing to replace — search first.', 'warn'); return; }
    let incl; try { incl = includeFilter(sr.inc); } catch (_) { incl = () => true; }
    const targets = S.fs.list().filter((f) => !f.binary && incl(f.path));
    const ok = await S.ui.confirm(`Replace ${sr.capped ? 'at least ' : ''}${sr.total} occurrence${sr.total === 1 ? '' : 's'} in ${sr.capped ? 'at least ' : ''}${sr.results.length} file${sr.results.length === 1 ? '' : 's'} with “${sr.rep}”? Files that are not open can't be undone with Ctrl+Z.`, { okText: 'Replace all' });
    if (!ok) return;
    let n = 0, files = 0;
    for (const f of targets) { let c = 0; try { const text = getText(f.path); if (text == null) continue; const r = replaceText(text); if (!r.n) continue; await writeUserText(f.path, r.text); c = r.n; } catch (e) { toast(f.path + ': ' + e.message, 'err'); } if (c) { n += c; files++; } }
    toast(`Replaced ${n} occurrence${n === 1 ? '' : 's'} in ${files} file${files === 1 ? '' : 's'}.`, n ? 'ok' : 'warn');
    runSearch();
  }
  function focusSearch() {
    S.ui.setActivity('search');
    let sel = '';
    if (st.mode === 'monaco' && editor && st.shown === 'monaco') { const s = editor.getSelection(), m = editor.getModel(); if (s && m && !s.isEmpty() && s.startLineNumber === s.endLineNumber) sel = m.getValueInRange(s); }
    else if (st.mode === 'text' && document.activeElement === taEl) { const v = taEl.value.slice(taEl.selectionStart, taEl.selectionEnd); if (v && !v.includes('\n')) sel = v; }
    if (sel && sr.q$) { sr.q$.value = sel; sr.q = sel; runSearch(); }
    setTimeout(() => { if (sr.q$) { sr.q$.focus(); sr.q$.select(); } }, 30);
  }
  function focusExplorer() { S.ui.setActivity('explorer'); revealRow(st.active); if (st.active) ex.focus = st.active; paintFocus(); setTimeout(() => ex.tree && ex.tree.focus({ preventScroll: true }), 20); }

  /* ======================================================================
   * commands
   * ==================================================================== */
  async function quickOpen() {
    if (!requireProject()) return;
    const files = S.fs.list().filter((f) => U.baseOf(f.path) !== '.gitkeep'), have = new Set(files.map((f) => f.path));
    const order = st.mru.filter((p) => have.has(p) && p !== st.active).concat(files.map((f) => f.path).filter((p) => !st.mru.includes(p) || p === st.active));
    const p = await S.ui.select('Go to file', order.map((x) => ({ value: x, label: U.baseOf(x), desc: x })));
    if (p) open(p, { fromSide: true, focus: true });
  }
  let lastSaveToast = 0;
  async function saveCommand() {
    if (!requireProject()) return;
    await flush();
    if (st.failed.size) { toast(`${st.failed.size} file${st.failed.size === 1 ? '' : 's'} could not be saved — see the red tab${st.failed.size === 1 ? '' : 's'}.`, 'err'); return; }
    try { await S.projects.syncNow(); } catch (_) {}
    // a push that was already in flight leaves the newest edit for the next round — send it now
    if (S.projects.syncState() === 'syncing') { await new Promise((r) => setTimeout(r, 700)); try { await S.projects.syncNow(); } catch (_) {} }
    const s = S.projects.syncState();
    if ((s === 'local' || s === 'offline' || s === 'error') && Date.now() - lastSaveToast > 30000) {
      lastSaveToast = Date.now();
      toast(s === 'local' ? 'Saved in this browser (cloud sync is not connected yet).' : 'Saved in this browser — cloud sync will retry.', 'warn');
    }
  }
  async function formatDoc() {
    const p = st.active;
    if (!p || S.fs.isBinary(p) || st.svgPreview.has(p)) return;
    if (st.mode !== 'monaco' || !editor) { toast('Formatting needs the full code editor.', 'warn'); return; }
    const a = editor.getAction('editor.action.formatDocument');
    if (!a || !a.isSupported()) { toast(`No formatter for ${langLabel(p, U.langOf(p))} files.`, 'warn'); return; }
    await a.run();
  }
  function toggleWrap() {
    const cur = st.active ? wrapFor(st.active) : 'off';
    S.settings.set('editor.wrap', cur === 'on' ? 'off' : 'on');
    if (st.mode === 'monaco' && editor && st.active) editor.updateOptions({ wordWrap: wrapFor(st.active) });
    if (st.mode === 'text' && st.active) { taEl.setAttribute('wrap', wrapFor(st.active) === 'on' ? 'soft' : 'off'); paintGutter(true); }
    toast('Word wrap ' + (S.settings.get('editor.wrap') === 'on' ? 'on' : 'off'), 'ok');
  }
  function toggleSimple() {
    if (st.mode === 'text') { S.settings.set('editor.simple', false); if (window.monaco && window.monaco.editor) switchToMonaco(); else startMonaco(); }
    else { S.settings.set('editor.simple', true); useText('simple'); }
  }
  function registerCommands() {
    const c = (o) => S.ui.registerCommand(o);
    c({ id: 'quickOpen', title: 'Go to file…', key: 'Mod+P', run: quickOpen });
    c({ id: 'file.new', title: 'New file…', key: 'Mod+Alt+N', run: () => newFile(contextDir()) });
    c({ id: 'file.newFolder', title: 'New folder…', run: () => newFolder(contextDir()) });
    c({ id: 'file.upload', title: 'Upload files…', run: () => pickUpload(false, contextDir()) });
    if (dirUpload) c({ id: 'file.uploadFolder', title: 'Upload a folder…', run: () => pickUpload(true, '') });
    c({ id: 'file.save', title: 'Save and sync now', key: 'Mod+S', run: saveCommand });
    // Mod+W is only bound inside the editor (Monaco addCommand) — globally it would fight the browser.
    c({ id: 'file.close', title: 'Close editor', run: () => st.active && closeTab(st.active) });
    c({ id: 'file.closeAll', title: 'Close all editors', run: closeAll });
    c({ id: 'file.rename', title: 'Rename active file…', run: () => st.active && renamePath(st.active) });
    c({ id: 'file.delete', title: 'Delete active file…', run: () => st.active && deletePath(st.active) });
    c({ id: 'file.duplicate', title: 'Duplicate active file', run: () => st.active && duplicatePath(st.active) });
    c({ id: 'file.copyPath', title: 'Copy path of active file', run: () => st.active && copyPath(st.active) });
    c({ id: 'file.download', title: 'Download active file', run: () => st.active && downloadPath(st.active) });
    c({ id: 'editor.format', title: 'Format document', key: 'Shift+Alt+F', run: formatDoc });
    c({ id: 'editor.gotoLine', title: 'Go to line…', run: gotoLine });
    c({ id: 'editor.wordWrap', title: 'Toggle word wrap', key: 'Alt+Z', run: toggleWrap });
    c({ id: 'editor.simple', title: 'Toggle simple text editor (no Monaco)', run: toggleSimple });
    c({ id: 'search.focus', title: 'Search in files', key: 'Mod+Shift+F', run: focusSearch });
    c({ id: 'explorer.focus', title: 'Show Explorer', key: 'Mod+Shift+E', run: focusExplorer });
    c({ id: 'explorer.reveal', title: 'Reveal active file in Explorer', run: () => st.active && revealInExplorer(st.active) });
  }

  // Monaco swallows keystrokes: every STUDIO command with a key is forwarded with addCommand.
  const boundKeys = new Set();
  function monacoKey(key) {
    const KM = monaco.KeyMod, KC = monaco.KeyCode; let code = 0, base = 0;
    for (const raw of String(key).split('+')) {
      const k = raw.trim(), l = k.toLowerCase();
      if (/^(mod|cmd|ctrl|meta)$/.test(l)) code |= KM.CtrlCmd;
      else if (l === 'shift') code |= KM.Shift;
      else if (l === 'alt' || l === 'option') code |= KM.Alt;
      else {
        if (/^[a-z]$/i.test(k)) base = KC['Key' + k.toUpperCase()];
        else if (/^[0-9]$/.test(k)) base = KC['Digit' + k];
        else if (/^f([1-9]|1[0-9])$/i.test(k)) base = KC[k.toUpperCase()];
        else base = { enter: KC.Enter, escape: KC.Escape, esc: KC.Escape, space: KC.Space, tab: KC.Tab, backspace: KC.Backspace, delete: KC.Delete, arrowup: KC.UpArrow, up: KC.UpArrow, arrowdown: KC.DownArrow, down: KC.DownArrow, arrowleft: KC.LeftArrow, left: KC.LeftArrow, arrowright: KC.RightArrow, right: KC.RightArrow, home: KC.Home, end: KC.End, pageup: KC.PageUp, pagedown: KC.PageDown, '/': KC.Slash, '.': KC.Period, ',': KC.Comma, ';': KC.Semicolon, '`': KC.Backquote, '[': KC.BracketLeft, ']': KC.BracketRight, '\\': KC.Backslash, "'": KC.Quote, '-': KC.Minus, '=': KC.Equal }[l] || 0;
        if (!base) return 0;
      }
    }
    return base ? (code | base) : 0;
  }
  function syncKeys() {
    if (!editor || !monaco) return;
    for (const c of S.ui.commands()) {
      if (!c.key) continue;
      const kb = monacoKey(c.key); if (!kb) continue;
      const sig = c.id + '|' + kb; if (boundKeys.has(sig)) continue;
      boundKeys.add(sig);
      const id = c.id;
      editor.addCommand(kb, () => S.ui.runCommand(id));
    }
  }

  /* ======================================================================
   * Monaco loading + configuration
   * ==================================================================== */
  // Monaco's AMD loader defines a global `define.amd`; UMD libraries loaded later (xterm,
  // JSZip…) would then register as anonymous AMD modules instead of setting their globals,
  // and break Monaco's loader ("one anonymous define per script"). Keep `define.amd` visible
  // only while one of Monaco's own scripts is executing. editor.main.js swaps `define` for a
  // wrapper, so the guard is re-applied right after every Monaco script runs (same task,
  // before any other script can execute).
  function guardAmd() {
    const fn = window.define; if (typeof fn !== 'function') return;
    const d = Object.getOwnPropertyDescriptor(fn, 'amd');
    if (d && d.get && d.get.ostGuard) return;
    let amd = d ? (d.get ? d.get.call(fn) : d.value) : undefined;
    const get = function () { const cs = document.currentScript; return cs && typeof cs.src === 'string' && cs.src.indexOf(MONACO_ROOT) === 0 ? amd : undefined; };
    get.ostGuard = true;
    try { Object.defineProperty(fn, 'amd', { configurable: true, enumerable: true, get, set(v) { amd = v; } }); } catch (_) {}
  }
  let amdObserver = null;
  function watchMonacoScripts() {
    if (amdObserver || !window.MutationObserver) return;
    amdObserver = new MutationObserver((recs) => {
      for (const r of recs) for (const n of r.addedNodes) {
        if (n.nodeName === 'SCRIPT' && typeof n.src === 'string' && n.src.indexOf(MONACO_ROOT) === 0) n.addEventListener('load', guardAmd);
      }
    });
    amdObserver.observe(document.head, { childList: true });
    amdObserver.observe(document.body || document.documentElement, { childList: true });
  }
  function loadMonaco() {
    if (window.monaco && window.monaco.editor) return Promise.resolve(window.monaco);
    if (st.monacoP) return st.monacoP;
    st.monacoP = new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => done(new Error('The code editor took too long to load.')), LOAD_TIMEOUT_MS);
      function done(err, m) { if (settled) return; settled = true; clearTimeout(timer); if (err) { st.monacoP = null; reject(err); } else resolve(m); }
      window.MonacoEnvironment = Object.assign({}, window.MonacoEnvironment || {}, {
        globalAPI: true,
        getWorkerUrl() {
          return 'data:text/javascript;charset=utf-8,' + encodeURIComponent(`self.MonacoEnvironment={baseUrl:'${MONACO_ROOT}'};importScripts('${MONACO_VS}/base/worker/workerMain.js');`);
        }
      });
      const afterLoader = () => {
        const req = window.require;
        if (!req || typeof req.config !== 'function') { done(new Error('Monaco loader unavailable.')); return; }
        guardAmd(); watchMonacoScripts();
        req.config({ paths: { vs: MONACO_VS } });
        try {
          req(['vs/editor/editor.main'], () => {
            guardAmd();
            if (!settled) done(null, window.monaco);
            else if (st.mode === 'text' && st.textReason === 'failed') {
              // Slow network, not a dead one: switch in place unless the user already typed in the fallback.
              if (!st.textEdited) switchToMonaco(); else { st.textReason = 'late'; paintNote(); }
            }
          }, (err) => done(err instanceof Error ? err : new Error('Monaco failed to load.')));
        } catch (e) { done(e); }
      };
      if (window.require && typeof window.require.config === 'function' && window.define) { afterLoader(); return; }
      const s = document.createElement('script');
      s.src = MONACO_VS + '/loader.js'; s.async = true;
      s.onload = afterLoader;
      s.onerror = () => { s.remove(); done(new Error('Could not download the code editor (offline, or the CDN is blocked).')); };
      document.head.appendChild(s);
    });
    return st.monacoP;
  }
  function startMonaco() {
    if (be === TB) { flush(); if (st.active) TB.saveView(st.active); TB.reset(); }
    st.mode = 'loading'; be = null; paintNote();
    if (st.active) show(st.active);
    loadMonaco().then((m) => {
      if (st.mode === 'text') { paintNote(); return; }
      initMonaco(m);
    }, (err) => {
      if (st.mode === 'text') return;
      console.warn('[studio/editor] Monaco unavailable, using the simple editor:', err && err.message);
      useText('failed');
    });
  }
  function deviceOptions() {
    const m = mobile();
    return { fontSize: m ? 14 : 13, lineHeight: m ? 21 : 19, minimap: { enabled: !m, renderCharacters: false, maxColumn: 100 }, lineNumbersMinChars: m ? 3 : 4, folding: !m, lineDecorationsWidth: m ? 4 : 10, scrollbar: { verticalScrollbarSize: m ? 6 : 12, horizontalScrollbarSize: m ? 6 : 12, alwaysConsumeMouseWheel: false, useShadows: false }, stickyScroll: { enabled: true, maxLineCount: m ? 2 : 5 } };
  }
  function defineTheme() {
    monaco.editor.defineTheme('ost-dark', {
      base: 'vs-dark', inherit: true,
      rules: [{ token: 'comment', foreground: '7d8799', fontStyle: 'italic' }],
      colors: {
        'editor.background': '#0d1117', 'editor.foreground': '#d6dde7', 'editorGutter.background': '#0d1117',
        'editor.lineHighlightBackground': '#161b22', 'editor.lineHighlightBorder': '#161b22',
        'editorLineNumber.foreground': '#4b5565', 'editorLineNumber.activeForeground': '#c4cbd6',
        'editorIndentGuide.background1': '#21262d', 'editorIndentGuide.activeBackground1': '#3a4555',
        'editor.selectionBackground': '#264f78', 'editor.inactiveSelectionBackground': '#3a3d4166',
        'editorCursor.foreground': '#6ea2ff', 'editorWhitespace.foreground': '#3a4555',
        'editorWidget.background': '#161b22', 'editorWidget.border': '#2b3441',
        'editorSuggestWidget.background': '#161b22', 'editorSuggestWidget.border': '#2b3441', 'editorSuggestWidget.selectedBackground': '#04395e',
        'editorHoverWidget.background': '#161b22', 'editorHoverWidget.border': '#2b3441',
        'editorStickyScroll.background': '#0d1117', 'editorStickyScrollHover.background': '#161b22',
        'minimap.background': '#0d1117', 'scrollbarSlider.background': '#8b96a833', 'scrollbarSlider.hoverBackground': '#8b96a855', 'scrollbarSlider.activeBackground': '#8b96a877',
        'editorBracketMatch.background': '#4c8dff22', 'editorBracketMatch.border': '#4c8dff99',
        focusBorder: '#4c8dff80', 'input.background': '#0d1117', 'input.border': '#3a4555', 'list.hoverBackground': '#1f2630', 'list.activeSelectionBackground': '#04395e'
      }
    });
  }
  function compilerOptions() {
    const ts = monaco.languages.typescript;
    const o = {
      target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, moduleResolution: 100 /* Bundler */, moduleDetection: 3 /* Force */,
      jsx: ts.JsxEmit.ReactJSX, jsxImportSource: 'react', allowJs: true, checkJs: false, noEmit: true, allowNonTsExtensions: true,
      esModuleInterop: true, allowSyntheticDefaultImports: true, resolveJsonModule: true, allowImportingTsExtensions: true, skipLibCheck: true, strict: false
    };
    let deps = {}; try { const pkg = JSON.parse(S.fs.read('package.json') || 'null'); deps = Object.assign({}, pkg && pkg.devDependencies, pkg && pkg.dependencies); } catch (_) {}
    if (deps.preact && !deps.react) o.jsxImportSource = 'preact';
    // honour a few common tsconfig/jsconfig compiler options
    for (const f of ['tsconfig.json', 'jsconfig.json']) {
      const raw = S.fs.read(f); if (!raw) continue;
      let cfg = null; try { cfg = JSON.parse(raw.replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, '').replace(/,(\s*[}\]])/g, '$1')); } catch (_) { continue; }
      const co = cfg && cfg.compilerOptions; if (!co || typeof co !== 'object') continue;
      for (const k of ['strict', 'noImplicitAny', 'strictNullChecks', 'noUnusedLocals', 'noUnusedParameters', 'noImplicitReturns', 'noFallthroughCasesInSwitch', 'exactOptionalPropertyTypes', 'noUncheckedIndexedAccess', 'experimentalDecorators', 'checkJs', 'allowJs', 'useDefineForClassFields']) if (typeof co[k] === 'boolean') o[k] = co[k];
      if (typeof co.jsxImportSource === 'string') o.jsxImportSource = co.jsxImportSource;
      const jsx = { preserve: 1, react: 2, 'react-native': 3, 'react-jsx': 4, 'react-jsxdev': 5 }[String(co.jsx || '').toLowerCase()]; if (jsx) o.jsx = jsx;
      break;
    }
    return o;
  }
  function applyCompilerOptions() {
    if (!monaco) return;
    const ts = monaco.languages.typescript, o = compilerOptions();
    const sig = JSON.stringify(o); if (sig === st.tsSig) return; st.tsSig = sig;
    ts.typescriptDefaults.setCompilerOptions(o); ts.javascriptDefaults.setCompilerOptions(o);
  }
  function configureLanguages() {
    const ts = monaco.languages.typescript;
    for (const d of [ts.typescriptDefaults, ts.javascriptDefaults]) {
      d.setEagerModelSync(true);
      d.setDiagnosticsOptions({ noSemanticValidation: false, noSyntaxValidation: false, noSuggestionDiagnostics: false, diagnosticCodesToIgnore: [2792] });
    }
    applyCompilerOptions();
    try { monaco.languages.json.jsonDefaults.setDiagnosticsOptions({ validate: true, allowComments: true, trailingCommas: 'ignore', schemas: [], enableSchemaRequest: false }); } catch (_) {}
    try { monaco.languages.html.htmlDefaults.setOptions({ format: { tabSize: 2, insertSpaces: true, wrapLineLength: 120, unformatted: 'code,pre,em,strong,span', indentInnerHtml: false, preserveNewLines: true, maxPreserveNewLines: 2, indentHandlebars: false, endWithNewline: true, extraLiners: '', wrapAttributes: 'auto' }, suggest: { html5: true } }); } catch (_) {}
  }
  function initMonaco(m) {
    if (editor) { switchToMonaco(); return; }
    monaco = m;
    defineTheme();
    configureLanguages();
    editor = monaco.editor.create(monacoEl, Object.assign({
      model: null, theme: 'ost-dark', automaticLayout: false,
      fontFamily: "ui-monospace, 'SF Mono', 'Cascadia Code', 'JetBrains Mono', Menlo, Consolas, monospace", fontLigatures: false,
      wordWrap: 'off', bracketPairColorization: { enabled: true }, guides: { bracketPairs: 'active', indentation: true },
      formatOnPaste: false, formatOnType: false, tabSize: 2, insertSpaces: true, detectIndentation: true,
      scrollBeyondLastLine: false, smoothScrolling: true, cursorBlinking: 'smooth', renderWhitespace: 'selection', renderLineHighlight: 'all',
      padding: { top: 8, bottom: 8 }, fixedOverflowWidgets: true, linkedEditing: true, 'semanticHighlighting.enabled': true, glyphMargin: false,
      dropIntoEditor: { enabled: false }, contextmenu: true, ariaLabel: 'Code editor', occurrencesHighlight: 'singleFile'
    }, deviceOptions()));
    editor.onDidChangeCursorSelection(paintCursorSoon);
    editor.onDidChangeModelLanguage(() => paintLang(st.active));
    monaco.editor.onDidChangeMarkers(() => markersChanged());
    // Mod+W closes the tab only while typing in the editor (never a global shortcut).
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyW, () => { if (st.active) closeTab(st.active); });
    // Ctrl/Cmd+click and F12 across project files open the file in a tab.
    if (monaco.editor.registerEditorOpener) {
      monaco.editor.registerEditorOpener({
        openCodeEditor(source, resource, selOrPos) {
          const p = pathFromUri(resource); if (!p) return false;
          open(p, { focus: true });
          if (selOrPos) { const line = selOrPos.startLineNumber || selOrPos.lineNumber || 1, col = selOrPos.startColumn || selOrPos.column || 1; setTimeout(() => reveal(p, line, col), 0); }
          return true;
        }
      });
    }
    syncKeys();
    st.monacoOk = true;
    be = MB; st.mode = 'monaco'; st.textReason = '';
    loadingEl.innerHTML = ''; clearTimeout(loadingTimer);
    paintNote();
    libs.syncProject(); ata.schedule(300);
    show(st.active);
    if (st.pendingReveal) { const r = st.pendingReveal; st.pendingReveal = null; if (st.active === r.path) be.reveal(r.line, r.col, r.len, r.focus); }
    layoutSoon();
    bus.emit('editor:ready', { mode: 'monaco' });
  }
  function useText(reason) {
    flush();
    if (be === MB) { if (st.active) MB.saveView(st.active); MB.reset(); }
    be = TB; st.mode = 'text'; st.textReason = reason; st.textEdited = false;
    loadingEl.innerHTML = ''; clearTimeout(loadingTimer);
    paintNote();
    show(st.active);
    if (st.pendingReveal) { const r = st.pendingReveal; st.pendingReveal = null; if (st.active === r.path) be.reveal(r.line, r.col, r.len, r.focus); }
    bus.emit('editor:ready', { mode: 'text' });
  }
  function switchToMonaco() {
    if (!editor) { if (window.monaco && window.monaco.editor) initMonaco(window.monaco); else startMonaco(); return; }
    flush();
    if (st.active && be === TB) TB.saveView(st.active);
    TB.reset();
    be = MB; st.mode = 'monaco'; st.textReason = '';
    paintNote(); libs.syncProject(); ata.schedule(300);
    show(st.active);
  }

  /* ======================================================================
   * TypeScript extra libs: every project code file + acquired npm types
   * ==================================================================== */
  const libs = {
    map: new Map(), proj: new Set(), dirty: new Set(), timer: 0,
    put(fp, content) {
      const cur = this.map.get(fp); if (cur && cur.content === content) return;
      const ts = monaco.languages.typescript;
      this.map.set(fp, { content, d: [ts.typescriptDefaults.addExtraLib(content, fp), ts.javascriptDefaults.addExtraLib(content, fp)] });
    },
    del(fp) { const cur = this.map.get(fp); if (!cur) return; cur.d.forEach((x) => x.dispose()); this.map.delete(fp); },
    touch(p) {
      if (!monaco) return;
      if (CODE_RE.test(p)) { this.dirty.add(p); clearTimeout(this.timer); this.timer = setTimeout(() => this.flush(), 700); }
      if (/^(tsconfig|jsconfig|package)\.json$/.test(p)) applyCompilerOptions();
      if (p === 'package.json' || CODE_RE.test(p)) ata.schedule();
    },
    flush() {
      for (const p of this.dirty) {
        const fp = uriOf(p).toString();
        if (S.fs.exists(p) && !S.fs.isBinary(p)) { this.put(fp, S.fs.read(p) || ''); this.proj.add(fp); }
        else { this.del(fp); this.proj.delete(fp); }
      }
      this.dirty.clear();
    },
    syncProject() {
      if (!monaco) return;
      clearTimeout(this.timer); this.dirty.clear();
      const want = new Map();
      for (const f of S.fs.list()) if (!f.binary && CODE_RE.test(f.path)) want.set(uriOf(f.path).toString(), S.fs.read(f.path) || '');
      for (const fp of [...this.proj]) if (!want.has(fp)) { this.del(fp); this.proj.delete(fp); }
      for (const [fp, c] of want) { this.put(fp, c); this.proj.add(fp); }
      applyCompilerOptions();
    }
  };

  // Automatic type acquisition: real .d.ts files from npm (jsDelivr) for bare imports, so
  // React & co. get IntelliSense. Anything without types becomes an `any` module instead of
  // a red "Cannot find module" squiggle.
  const NODE_BUILTINS = new Set(['assert', 'buffer', 'child_process', 'cluster', 'crypto', 'dgram', 'dns', 'events', 'fs', 'http', 'http2', 'https', 'module', 'net', 'os', 'path', 'perf_hooks', 'process', 'querystring', 'readline', 'stream', 'string_decoder', 'timers', 'tls', 'tty', 'url', 'util', 'v8', 'vm', 'worker_threads', 'zlib']);
  const ATA_MAX = { pkgs: 40, filesPerPkg: 160, fileBytes: 1500000, total: 12000000, depth: 4 };
  const AMBIENT_BASE = [
    "declare module '*.css';", "declare module '*.scss';", "declare module '*.sass';", "declare module '*.less';",
    ...['svg', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'ico', 'bmp', 'mp3', 'wav', 'ogg', 'mp4', 'webm', 'woff', 'woff2', 'ttf', 'otf', 'txt', 'md', 'wasm', 'csv'].map((e) => `declare module '*.${e}' { const src: string; export default src; }`),
    "declare module '*.json' { const value: any; export default value; }",
    "declare module 'https://*';", "declare module 'http://*';", "declare module 'node:*';"
  ].join('\n');
  const isBareSpec = (s) => !!s && !/^[./]/.test(s) && !/^[a-z][a-z0-9+.-]*:/i.test(s);
  const pkgRoot = (s) => (s[0] === '@' ? s.split('/').slice(0, 2).join('/') : s.split('/')[0]);
  const validPkg = (n) => /^(?:@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/i.test(n) && n.length < 120;
  function scanSpecs(text, out) {
    const re = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*|<reference\s+types\s*=\s*)(['"])([^'"\n]{1,200})\1/g;
    let m; while ((m = re.exec(text))) out.add(m[2]);
  }
  function cleanRange(r) {
    r = String(r || '').trim();
    return /^(?:[\^~]?\d+(?:\.(?:\d+|x|\*))*(?:-[\w.]+)?|latest|next)$/i.test(r) ? r : 'latest';
  }
  async function fetchText(url, ms) {
    const ac = window.AbortController ? new AbortController() : null;
    const t = setTimeout(() => { if (ac) ac.abort(); }, ms || 20000);
    try { const r = await fetch(url, { signal: ac ? ac.signal : undefined, credentials: 'omit' }); return r.ok ? await r.text() : null; }
    catch (_) { return null; } finally { clearTimeout(t); }
  }
  async function fetchJson(url) { const t = await fetchText(url); if (t == null) return null; try { return JSON.parse(t); } catch (_) { return null; } }
  async function flatList(name, ver) {
    const j = await fetchJson(`https://data.jsdelivr.com/v1/packages/npm/${name}@${encodeURIComponent(ver)}?structure=flat`);
    return j && Array.isArray(j.files) ? j.files : null;
  }
  function typesEntry(pkg) {
    let t = pkg.types || pkg.typings;
    if (!t && pkg.exports && typeof pkg.exports === 'object') {
      const e = pkg.exports['.'] !== undefined ? pkg.exports['.'] : (Object.keys(pkg.exports).some((k) => k[0] === '.') ? null : pkg.exports);
      const find = (x, depth) => {
        if (!x || depth > 5) return null;
        if (typeof x === 'string') return /\.d\.[mc]?ts$/.test(x) ? x : null;
        if (Array.isArray(x)) { for (const y of x) { const r = find(y, depth + 1); if (r) return r; } return null; }
        if (typeof x === 'object') { if (typeof x.types === 'string') return x.types; for (const k of ['types', 'import', 'browser', 'default', 'require']) { const r = find(x[k], depth + 1); if (r) return r; } }
        return null;
      };
      t = find(e, 0);
    }
    if (!t || typeof t !== 'string') return null;
    t = t.replace(/^\.?\//, '');
    if (!/\.d\.[mc]?ts$/.test(t)) t = t.replace(/\.[mc]?js$/, '') + '.d.ts';
    return t;
  }
  async function mapLimit(items, n, fn) {
    const out = new Array(items.length); let i = 0;
    await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } }));
    return out;
  }
  const ata = {
    status: new Map(), roots: new Map(), exportsOf: new Map(), bytes: 0, timer: 0, active: 0, queue: [], specs: [],
    schedule(ms) { clearTimeout(this.timer); this.timer = setTimeout(() => this.run(), ms == null ? 1500 : ms); },
    run() {
      if (!monaco || st.mode !== 'monaco' || !S.projects.current()) return;
      let deps = {}; try { const pkg = JSON.parse(S.fs.read('package.json') || 'null'); deps = Object.assign({}, pkg && pkg.devDependencies, pkg && pkg.peerDependencies, pkg && pkg.dependencies); } catch (_) {}
      const specs = new Set();
      const files = S.fs.list().filter((f) => !f.binary && CODE_RE.test(f.path) && !/\.d\.[mc]?ts$/.test(f.path));
      for (const f of files) scanSpecs(getText(f.path) || '', specs);
      this.specs = [...specs].filter(isBareSpec);
      const roots = new Set(this.specs.map(pkgRoot).filter((r) => !NODE_BUILTINS.has(r) && !/^node:/.test(r)));
      if (files.some((f) => /\.(jsx|tsx)$/.test(f.path))) roots.add(deps.preact && !deps.react ? 'preact' : 'react');
      for (const r of roots) if (!this.status.has(r)) this.enqueue(r, deps[r], 0);
      updateAmbient();
    },
    enqueue(name, range, depth) {
      if (this.status.has(name) || !validPkg(name) || this.status.size >= ATA_MAX.pkgs || depth > ATA_MAX.depth) return;
      this.status.set(name, 'loading');
      this.queue.push({ name, range: cleanRange(range), depth });
      this.pump();
    },
    pump() {
      while (this.active < 3 && this.queue.length) {
        const job = this.queue.shift(); this.active++; paintTypes();
        this.fetchPkg(job).catch(() => { this.status.set(job.name, 'none'); }).then(() => { this.active--; paintTypes(); this.pump(); if (!this.active && !this.queue.length) updateAmbient(); });
      }
    },
    async fetchPkg({ name, range, depth }) {
      const own = await fetchJson(`${NPM}${name}@${encodeURIComponent(range)}/package.json`);
      if (!own || !own.version) { this.status.set(name, 'none'); return; }
      let pkgName = name, pkg = own, entry = typesEntry(own), list = null;
      if (!entry) { list = await flatList(name, own.version); if (list && list.some((f) => f.name === '/index.d.ts')) entry = 'index.d.ts'; }
      if (!entry) {
        const tn = '@types/' + (name[0] === '@' ? name.slice(1).replace('/', '__') : name);
        const major = String(own.version).split('.')[0];
        const tp = (await fetchJson(`${NPM}${tn}@${encodeURIComponent(major)}/package.json`)) || (await fetchJson(`${NPM}${tn}@latest/package.json`));
        if (!tp || !tp.version) { this.status.set(name, 'none'); return; }
        pkgName = tn; pkg = tp; entry = typesEntry(tp) || 'index.d.ts'; list = null;
      }
      if (!list) list = await flatList(pkgName, pkg.version);
      if (!list) { this.status.set(name, 'none'); return; }
      const entryAbs = '/' + entry;
      const dts = list.filter((f) => typeof f.name === 'string' && /\.d\.[mc]?ts$/.test(f.name) && !/^\/(?:ts\d|node_modules\/)/.test(f.name) && (f.size || 0) <= ATA_MAX.fileBytes)
        .sort((a, b) => (a.name === entryAbs ? -1 : b.name === entryAbs ? 1 : a.name.split('/').length - b.name.split('/').length || a.name.localeCompare(b.name)));
      const pick = [];
      for (const f of dts) { if (pick.length >= ATA_MAX.filesPerPkg || this.bytes + (f.size || 0) > ATA_MAX.total) break; pick.push(f); this.bytes += f.size || 0; }
      if (!pick.length) { this.status.set(name, 'none'); return; }
      const texts = await mapLimit(pick, 6, (f) => fetchText(`${NPM}${pkgName}@${encodeURIComponent(pkg.version)}${f.name}`));
      if (!monaco) return;
      const root = 'node_modules/' + pkgName, found = new Set();
      pick.forEach((f, i) => { const t = texts[i]; if (t == null) return; libs.put('file:///' + root + f.name, t); scanSpecs(t, found); });
      // package.json lets TypeScript follow "types"/"exports" (subpaths like react-dom/client)
      libs.put('file:///' + root + '/package.json', JSON.stringify({ name: pkg.name, version: pkg.version, types: entry, typings: entry, exports: pkg.exports, typesVersions: undefined }));
      if (entryAbs !== '/index.d.ts' && !list.some((f) => f.name === '/index.d.ts')) {
        const base = '.' + entryAbs.replace(/\.d\.[mc]?ts$/, '');
        libs.put('file:///' + root + '/index.d.ts', `export * from '${base}';\n`);
      }
      this.roots.set(name, root); this.exportsOf.set(name, pkg.exports && typeof pkg.exports === 'object' ? Object.keys(pkg.exports) : []);
      if (pkgName !== name) { this.roots.set(pkgName, root); this.status.set(pkgName, 'ok'); }
      this.status.set(name, 'ok');
      const deps = Object.assign({}, pkg.peerDependencies, pkg.dependencies);
      for (const s of found) {
        if (!isBareSpec(s)) continue;
        const r = pkgRoot(s); if (r === name || r === pkgName || NODE_BUILTINS.has(r) || /^node:/.test(r)) continue;
        this.enqueue(r, deps[r], depth + 1);
      }
      updateAmbientSoon();
    }
  };
  function coveredByTypes(spec) {
    const r = pkgRoot(spec); if (ata.status.get(r) !== 'ok') return false;
    if (spec === r) return true;
    const root = ata.roots.get(r), sub = spec.slice(r.length);
    if ((ata.exportsOf.get(r) || []).some((k) => k === '.' + sub || k === '.' + sub + '.js')) return true;
    return libs.map.has('file:///' + root + sub + '.d.ts') || libs.map.has('file:///' + root + sub + '/index.d.ts');
  }
  let ambT = 0;
  function updateAmbientSoon() { clearTimeout(ambT); ambT = setTimeout(updateAmbient, 250); }
  function updateAmbient() {
    if (!monaco) return;
    const lines = [AMBIENT_BASE];
    for (const s of ata.specs) if (ata.status.get(pkgRoot(s)) !== 'loading' && !coveredByTypes(s)) lines.push(`declare module ${JSON.stringify(s)};`);
    // while types are still downloading, keep imports quiet instead of flashing red squiggles
    for (const s of ata.specs) if (ata.status.get(pkgRoot(s)) === 'loading') lines.push(`declare module ${JSON.stringify(s)};`);
    libs.put(AMBIENT_PATH, lines.join('\n') + '\n');
  }
  function paintTypes() {
    const n = ata.active + ata.queue.length;
    S.ui.setStatus('types', n ? '⟳ types' : '', { side: 'left', order: 45, title: 'Downloading TypeScript types for your imports (IntelliSense)' });
  }

  /* ======================================================================
   * public API
   * ==================================================================== */
  function reveal(path, line, col, opts) {
    opts = opts || {};
    const p = U.normPath(path);
    if (!open(p, { fromSide: !!opts.fromSide })) return false;
    line = Math.max(1, Math.floor(Number(line) || 1)); col = Math.max(1, Math.floor(Number(col) || 1));
    const focus = opts.focus != null ? !!opts.focus : !mobile();
    if (S.fs.isBinary(p) || st.svgPreview.has(p)) return true;
    if (st.mode === 'loading' || !be) { st.pendingReveal = { path: p, line, col, len: opts.len || 0, focus }; return true; }
    be.reveal(line, col, opts.len || 0, focus);
    return true;
  }
  S.editor = {
    open(path, opts) { return open(path, Object.assign({}, opts || {})); },
    active: () => st.active,
    tabs: () => st.tabs.slice(),
    close: (path) => closeTab(U.normPath(path)),
    focus() { if (be && st.active && (st.shown === 'monaco' || st.shown === 'text')) be.focus(); },
    reveal,
    setMarkers,
    clearMarkers,
    markers: (path) => markersOf(path),
    monaco: () => monaco,
    instance: () => editor,
    mode: () => st.mode,
    getModelValue(path) { const p = U.normPath(path); const v = be && be.has(p) ? be.value(p) : null; return v != null ? v : S.fs.read(p); },
    flush,
    quickOpen,
    upload: (files, dir) => uploadEntries([...(files || [])].map((f) => ({ file: f, rel: f.webkitRelativePath || f.name })), dir || '', 0)
  };

  /* ======================================================================
   * boot
   * ==================================================================== */
  mountExplorer();
  mountSearch();
  registerCommands();
  if (S.projects.current()) rebuild(); else show(null);
  if (S.settings.get('editor.simple', false)) useText('simple'); else startMonaco();
  S.ready.then(() => { if (!S.projects.current()) { renderTree(); show(null); } }).catch(() => {});
})();

/* ==========================================================================
 * OST · Ghost Terminal — a real coding terminal that runs ON THE USER'S DEVICE
 * --------------------------------------------------------------------------
 * Ghost AI gains a terminal you can actually code in, on a phone or a PC.
 *
 * ENDPOINT-ONLY BY DESIGN. Nothing is sent anywhere to execute — no OST worker,
 * no KV, no server round-trip. Your code runs in YOUR browser, using YOUR
 * device's CPU:
 *   • JavaScript  → a Web Worker (isolated thread, native JIT speed, cannot
 *                   freeze the page, killable if you write an infinite loop)
 *   • Python      → Pyodide (real CPython compiled to WebAssembly), fetched
 *                   on first use only. WASM runs on iOS Safari, so an iPhone
 *                   executes genuine Python locally.
 * The virtual filesystem lives in localStorage on the device, so files survive
 * reloads and never leave it.
 *
 * WHY A WORKER (and not eval on the page): iOS Safari has no JIT for injected
 * frames and a runaway loop on the main thread hard-locks the tab. A worker gets
 * its own thread we can terminate, which is what makes "run untrusted code on a
 * phone" actually safe.
 *
 * Public API:  OST_GHOST_TERMINAL.open() / .close() / .run(code, lang)
 * ========================================================================== */
(function () {
  'use strict';
  if (window.OST_GHOST_TERMINAL) return;

  var FS_KEY   = 'ost.ghost.term.fs.v1';
  var HIST_KEY = 'ost.ghost.term.hist.v1';
  var PYODIDE  = 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.js';
  var RUN_TIMEOUT_MS = 15000;          // runaway-code guard (kill + report)

  /* ---------------------------------------------------------------- files */
  function loadFS() { try { return JSON.parse(localStorage.getItem(FS_KEY) || '{}') || {}; } catch (_) { return {}; } }
  function saveFS(fs) { try { localStorage.setItem(FS_KEY, JSON.stringify(fs)); } catch (_) {} }
  function loadHist() { try { return JSON.parse(localStorage.getItem(HIST_KEY) || '[]') || []; } catch (_) { return []; } }
  function saveHist(h) { try { localStorage.setItem(HIST_KEY, JSON.stringify(h.slice(-200))); } catch (_) {} }

  /* ------------------------------------------------------- JS worker runtime */
  // Runs in its own thread. Streams every console line back as it happens so
  // long loops print progressively instead of dumping at the end.
  var WORKER_SRC = [
    'function fmt(v){',
    '  if (typeof v === "string") return v;',
    '  if (v instanceof Error) return v.stack || String(v);',
    '  try { return JSON.stringify(v, null, 2); } catch(_) { return String(v); }',
    '}',
    'function send(type, line){ self.postMessage({ type: type, line: line }); }',
    'var _log = function(){ send("out", Array.prototype.map.call(arguments, fmt).join(" ")); };',
    'self.console = { log:_log, info:_log, warn:function(){ send("warn", Array.prototype.map.call(arguments, fmt).join(" ")); },',
    '  error:function(){ send("err", Array.prototype.map.call(arguments, fmt).join(" ")); }, debug:_log };',
    'self.print = _log;',
    'self.onmessage = function(e){',
    '  var code = e.data && e.data.code;',
    '  (async function(){',
    '    try {',
    '      var AsyncFn = Object.getPrototypeOf(async function(){}).constructor;',
    '      var fn = new AsyncFn(code);',
    '      var out = await fn();',
    '      if (out !== undefined) send("val", fmt(out));',
    '      send("done", "");',
    '    } catch (err) { send("err", (err && (err.stack || err.message)) || String(err)); send("done", ""); }',
    '  })();',
    '};'
  ].join('\n');

  var workerUrl = null;
  function makeWorker() {
    if (!workerUrl) workerUrl = URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' }));
    return new Worker(workerUrl);
  }

  /* ------------------------------------------------------------- terminal UI */
  var el = {}, hist = [], histIdx = -1, running = null, pyodide = null, pyLoading = null;

  function style() {
    if (document.getElementById('ghostTermStyle')) return;
    var s = document.createElement('style');
    s.id = 'ghostTermStyle';
    s.textContent = [
      '#ghost-term{position:fixed;inset:0;z-index:2147483200;display:none;flex-direction:column;',
      'background:linear-gradient(180deg,#070b16,#04060d);color:#d8e3f5;',
      "font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;}",
      '#ghost-term.is-open{display:flex;}',
      '#ghost-term .gt-bar{display:flex;align-items:center;gap:8px;padding:10px 12px;',
      'border-bottom:1px solid rgba(109,159,255,.18);background:rgba(10,15,28,.9);flex:0 0 auto;}',
      '#ghost-term .gt-title{font-weight:800;font-size:13px;color:#8ab4ff;letter-spacing:.04em;}',
      '#ghost-term .gt-badge{font-size:10px;font-weight:700;color:#7ce6a8;border:1px solid rgba(124,230,168,.35);',
      'border-radius:999px;padding:2px 8px;}',
      '#ghost-term .gt-spacer{flex:1;}',
      '#ghost-term button{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);color:#cbd5e1;',
      'border-radius:8px;padding:6px 10px;font-size:12px;font-weight:700;cursor:pointer;}',
      '#ghost-term button:hover{border-color:#6d9fff;color:#fff;}',
      '#ghost-term .gt-out{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:12px;',
      'font-size:13px;line-height:1.5;white-space:pre-wrap;word-break:break-word;}',
      '#ghost-term .gt-line{margin:0 0 2px;}',
      '#ghost-term .gt-cmd{color:#8ab4ff;}',
      '#ghost-term .gt-err{color:#ff9aa5;}',
      '#ghost-term .gt-warn{color:#fbbf24;}',
      '#ghost-term .gt-val{color:#7ce6a8;}',
      '#ghost-term .gt-sys{color:#94a3b8;}',
      '#ghost-term .gt-form{display:flex;gap:8px;padding:10px;border-top:1px solid rgba(109,159,255,.18);',
      'background:rgba(10,15,28,.95);flex:0 0 auto;padding-bottom:calc(10px + env(safe-area-inset-bottom));}',
      // 16px min prevents iOS Safari auto-zoom on focus
      '#ghost-term .gt-in{flex:1;background:rgba(255,255,255,.05);border:1px solid rgba(109,159,255,.25);',
      'border-radius:10px;color:#e6edf8;padding:10px 12px;font-size:16px;',
      "font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;outline:none;}",
      '#ghost-term .gt-in:focus{border-color:#6d9fff;}',
      '@media(max-width:700px){#ghost-term .gt-out{font-size:12.5px;}}'
    ].join('');
    document.head.appendChild(s);
  }

  function build() {
    if (el.root) return;
    style();
    var root = document.createElement('div');
    root.id = 'ghost-term';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', 'Ghost Terminal');
    root.innerHTML =
      '<div class="gt-bar">' +
        '<span class="gt-title">⌨ Ghost Terminal</span>' +
        '<span class="gt-badge" data-gt-badge>on-device</span>' +
        '<span class="gt-spacer"></span>' +
        '<button type="button" data-gt-kill>Stop</button>' +
        '<button type="button" data-gt-clear>Clear</button>' +
        '<button type="button" data-gt-close>Close</button>' +
      '</div>' +
      '<div class="gt-out" data-gt-out></div>' +
      '<form class="gt-form" data-gt-form>' +
        '<input class="gt-in" data-gt-in type="text" placeholder="type a command — start with: help" ' +
        'autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" inputmode="text" />' +
      '</form>';
    document.body.appendChild(root);
    el.root = root;
    el.out = root.querySelector('[data-gt-out]');
    el.in = root.querySelector('[data-gt-in]');
    el.badge = root.querySelector('[data-gt-badge]');
    root.querySelector('[data-gt-close]').addEventListener('click', close);
    root.querySelector('[data-gt-clear]').addEventListener('click', function () { el.out.innerHTML = ''; });
    root.querySelector('[data-gt-kill]').addEventListener('click', kill);
    root.querySelector('[data-gt-form]').addEventListener('submit', function (e) {
      e.preventDefault();
      var v = el.in.value;
      el.in.value = '';
      submit(v);
    });
    el.in.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowUp') { e.preventDefault(); if (hist.length) { histIdx = Math.max(0, (histIdx < 0 ? hist.length : histIdx) - 1); el.in.value = hist[histIdx] || ''; } }
      else if (e.key === 'ArrowDown') { e.preventDefault(); if (histIdx >= 0) { histIdx = Math.min(hist.length, histIdx + 1); el.in.value = hist[histIdx] || ''; } }
    });
    hist = loadHist();
  }

  function write(text, cls) {
    if (!el.out) return;
    var d = document.createElement('div');
    d.className = 'gt-line ' + (cls || 'gt-sys');
    d.textContent = text;
    el.out.appendChild(d);
    el.out.scrollTop = el.out.scrollHeight;
  }

  function banner() {
    write('Ghost Terminal — your code runs on THIS device. Nothing is uploaded.', 'gt-sys');
    write('JavaScript runs instantly in a worker thread. Type `help` for commands.', 'gt-sys');
  }

  /* ------------------------------------------------------------- execution */
  function kill() {
    if (running) { try { running.terminate(); } catch (_) {} running = null; write('^C  killed the running program.', 'gt-warn'); setBadge('on-device'); }
    else write('nothing is running.', 'gt-sys');
  }
  function setBadge(t) { if (el.badge) el.badge.textContent = t; }

  function runJS(code) {
    return new Promise(function (resolve) {
      if (running) { write('already running — press Stop first.', 'gt-warn'); return resolve(); }
      var w;
      try { w = makeWorker(); }
      catch (err) { write('worker unavailable: ' + err, 'gt-err'); return resolve(); }
      running = w;
      setBadge('running…');
      var timer = setTimeout(function () {
        if (running === w) { try { w.terminate(); } catch (_) {} running = null; setBadge('on-device');
          write('timed out after ' + (RUN_TIMEOUT_MS / 1000) + 's (possible infinite loop) — terminated.', 'gt-err'); resolve(); }
      }, RUN_TIMEOUT_MS);
      w.onmessage = function (e) {
        var m = e.data || {};
        if (m.type === 'out') write(m.line, '');
        else if (m.type === 'warn') write(m.line, 'gt-warn');
        else if (m.type === 'err') write(m.line, 'gt-err');
        else if (m.type === 'val') write('⇒ ' + m.line, 'gt-val');
        else if (m.type === 'done') {
          clearTimeout(timer);
          if (running === w) { try { w.terminate(); } catch (_) {} running = null; }
          setBadge('on-device');
          resolve();
        }
      };
      w.onerror = function (err) {
        clearTimeout(timer);
        write('worker error: ' + (err && err.message || err), 'gt-err');
        if (running === w) { try { w.terminate(); } catch (_) {} running = null; }
        setBadge('on-device');
        resolve();
      };
      w.postMessage({ code: code });
    });
  }

  // Pyodide = real CPython in WebAssembly, running locally. ~10MB on first use
  // only; cached by the browser afterwards. Works on iOS Safari (WASM, no JIT
  // needed), which is what makes Python-on-iPhone possible here.
  function loadPy() {
    if (pyodide) return Promise.resolve(pyodide);
    if (pyLoading) return pyLoading;
    write('fetching the Python runtime (CPython → WebAssembly, one-time ~10MB)…', 'gt-sys');
    setBadge('loading python…');
    pyLoading = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = PYODIDE;
      s.onload = function () {
        window.loadPyodide({ indexURL: PYODIDE.replace(/pyodide\.js$/, '') })
          .then(function (py) {
            pyodide = py;
            try {
              py.setStdout({ batched: function (t) { write(t, ''); } });
              py.setStderr({ batched: function (t) { write(t, 'gt-err'); } });
            } catch (_) {}
            setBadge('on-device');
            write('Python ready — running locally on your device.', 'gt-sys');
            resolve(py);
          }).catch(reject);
      };
      s.onerror = function () { reject(new Error('could not fetch the Python runtime (offline?)')); };
      document.head.appendChild(s);
    }).catch(function (err) {
      pyLoading = null; setBadge('on-device');
      write(String(err && err.message || err), 'gt-err');
      throw err;
    });
    return pyLoading;
  }

  function runPy(code) {
    return loadPy().then(function (py) {
      setBadge('running…');
      try {
        var r = py.runPython(code);
        if (r !== undefined && r !== null) write('⇒ ' + String(r), 'gt-val');
      } catch (err) { write(String(err && err.message || err), 'gt-err'); }
      setBadge('on-device');
    }).catch(function () {});
  }

  /* -------------------------------------------------------------- commands */
  var HELP = [
    'COMMANDS — everything executes on this device',
    '  help                 this list',
    '  ls                   list saved files',
    '  cat <file>           print a file',
    '  write <file>         start multi-line input; end with a single "."',
    '  rm <file>            delete a file',
    '  run <file>           run a saved file (.py runs as Python, else JS)',
    '  py <code>            run one line of Python (CPython via WebAssembly)',
    '  clear                clear the screen',
    '  stop                 kill a running program',
    '',
    'Anything else is treated as JavaScript and runs immediately.',
    '  e.g.  [1,2,3].map(n => n*n)',
    '        for (let i=0;i<3;i++) console.log("hi", i)',
    'Multi-line: use  write app.js  then paste, end with "."'
  ].join('\n');

  var pendingWrite = null;   // { name, lines }

  function submit(raw) {
    var line = String(raw == null ? '' : raw);
    // multi-line capture mode
    if (pendingWrite) {
      if (line.trim() === '.') {
        var fs = loadFS();
        fs[pendingWrite.name] = pendingWrite.lines.join('\n');
        saveFS(fs);
        write('saved ' + pendingWrite.name + ' (' + pendingWrite.lines.length + ' lines)', 'gt-sys');
        pendingWrite = null;
        el.in.placeholder = 'type a command — start with: help';
      } else { pendingWrite.lines.push(line); }
      return;
    }
    if (!line.trim()) return;
    write('› ' + line, 'gt-cmd');
    hist.push(line); saveHist(hist); histIdx = -1;

    var parts = line.trim().split(/\s+/);
    var cmd = parts[0], arg = line.trim().slice(cmd.length).trim();
    var fs = loadFS();

    if (cmd === 'help') return write(HELP, 'gt-sys');
    if (cmd === 'clear') { el.out.innerHTML = ''; return; }
    if (cmd === 'stop') return kill();
    if (cmd === 'ls') {
      var names = Object.keys(fs);
      return write(names.length ? names.map(function (n) { return '  ' + n + '  (' + fs[n].length + ' bytes)'; }).join('\n') : '  (no files yet — try: write hello.js)', 'gt-sys');
    }
    if (cmd === 'cat') return write(fs[arg] != null ? fs[arg] : 'no such file: ' + arg, fs[arg] != null ? '' : 'gt-err');
    if (cmd === 'rm') {
      if (fs[arg] == null) return write('no such file: ' + arg, 'gt-err');
      delete fs[arg]; saveFS(fs); return write('deleted ' + arg, 'gt-sys');
    }
    if (cmd === 'write') {
      if (!arg) return write('usage: write <file>', 'gt-err');
      pendingWrite = { name: arg, lines: [] };
      el.in.placeholder = 'writing ' + arg + ' — end with a single "."';
      return write('writing ' + arg + ' … type lines, then "." on its own line to save.', 'gt-sys');
    }
    if (cmd === 'run') {
      var src = fs[arg];
      if (src == null) return write('no such file: ' + arg, 'gt-err');
      return /\.py$/i.test(arg) ? runPy(src) : runJS(src);
    }
    if (cmd === 'py') {
      if (!arg) return write('usage: py <code>', 'gt-err');
      return runPy(arg);
    }
    // default: JavaScript. Bare expressions get their value printed.
    var code = arg === '' && parts.length === 1 ? line : line;
    if (!/[;{}]|\b(var|let|const|function|return|for|while|if|class|await)\b/.test(code)) {
      code = 'return (' + code + ')';
    }
    return runJS(code);
  }

  /* ------------------------------------------------------------------ open */
  function open() {
    build();
    el.root.classList.add('is-open');
    if (!el.out.childNodes.length) banner();
    setTimeout(function () { try { el.in.focus(); } catch (_) {} }, 60);
    try { if (window.OST_GHOST && window.OST_GHOST.close) window.OST_GHOST.close(); } catch (_) {}
  }
  function close() { if (el.root) el.root.classList.remove('is-open'); }

  window.OST_GHOST_TERMINAL = {
    open: open, close: close,
    run: function (code, lang) { build(); open(); return lang === 'py' ? runPy(code) : runJS(code); },
    files: function () { return loadFS(); }
  };

  // Add a Terminal button INSIDE the Ghost circle (not a floating corner button —
  // per the app's nav rules) once Ghost has booted.
  function attachGhostButton() {
    var circle = document.getElementById('ghost-summoning-circle');
    if (!circle || circle.querySelector('[data-gt-launch]')) return;
    var b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('data-gt-launch', '');
    b.textContent = '⌨ Terminal';
    b.style.cssText = 'position:absolute;top:14px;left:14px;z-index:5;background:rgba(109,159,255,.14);' +
      'border:1px solid rgba(109,159,255,.4);color:#8ab4ff;border-radius:10px;padding:7px 12px;' +
      'font-size:12px;font-weight:800;cursor:pointer;';
    b.addEventListener('click', open);
    circle.appendChild(b);
  }
  window.addEventListener('ghost:ready', attachGhostButton);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', attachGhostButton);
  else attachGhostButton();
})();

/* ==========================================================================
   OST API Console — in-page interactive API playground
   Opened by the "Open in console" button on the Pro Dashboard.
   ========================================================================== */
(function () {
  'use strict';
  if (window.__OST_CONSOLE_LOADED) return;
  window.__OST_CONSOLE_LOADED = true;

  var CONSOLE_ID = 'ost-api-console';
  var API_BASE_KEY = 'ost.api.base.url';

  var EXAMPLES = [
    {
      label: 'Server health',
      code: 'await OST_API.get("/health")'
    },
    {
      label: 'Live BTC price',
      code: 'await OST_API.get("/btc/price")'
    },
    {
      label: 'Current 5-min round',
      code: 'await OST_API.get("/rounds/current")'
    },
    {
      label: 'List markets (top 10)',
      code: 'await OST_API.get("/markets?limit=10")'
    },
    {
      label: 'Local market state',
      code: 'window.__predictionState && window.__predictionState.markets\n  ? window.__predictionState.markets.slice(0,3)\n  : "State not loaded yet"'
    },
    {
      label: 'My open positions',
      code: 'JSON.parse(localStorage.getItem("ost.prediction.orders.v1") || "[]")'
    },
    {
      label: 'Current round (local)',
      code: '(function(){\n  var FIVE = 5*60*1000;\n  var now = Date.now();\n  var openAt = Math.floor(now/FIVE)*FIVE;\n  return { id: "ost-btc5m-"+openAt, openAt, closeAt: openAt+FIVE,\n           msLeft: Math.round((openAt+FIVE-now)/1000)+"s" };\n})()'
    }
  ];

  // ── Build DOM ─────────────────────────────────────────────────────────────

  function buildConsole() {
    var el = document.createElement('div');
    el.id = CONSOLE_ID;
    el.className = 'ost-console';
    el.setAttribute('aria-label', 'OST API console');
    el.innerHTML = [
      '<div class="ost-console__backdrop" data-act="close"></div>',
      '<div class="ost-console__panel" role="dialog" aria-modal="true">',
        '<div class="ost-console__header">',
          '<span class="ost-console__title">⌨ OST API Console</span>',
          '<span class="ost-console__url" id="ostConsoleUrl">connecting…</span>',
          '<button class="ost-console__close" data-act="close" aria-label="Close">×</button>',
        '</div>',
        '<div class="ost-console__body">',
          '<div class="ost-console__left">',
            '<div class="ost-console__server-row">',
              '<label class="ost-console__label">API server</label>',
              '<input type="url" class="ost-console__url-input" id="ostConsoleApiUrl" placeholder="https://ost-api.account.workers.dev" spellcheck="false">',
              '<button type="button" class="ost-console__btn ost-console__btn--save" id="ostConsoleSaveUrl">Save</button>',
            '</div>',
            '<div class="ost-console__examples">',
              '<label class="ost-console__label">Quick examples</label>',
              '<div class="ost-console__example-list" id="ostConsoleExamples"></div>',
            '</div>',
            '<div class="ost-console__editor-wrap">',
              '<label class="ost-console__label">Expression (async context, returns JSON)</label>',
              '<textarea class="ost-console__editor" id="ostConsoleInput" rows="6" spellcheck="false"></textarea>',
            '</div>',
            '<div class="ost-console__run-row">',
              '<button type="button" class="ost-console__btn ost-console__btn--run" id="ostConsoleRun">▶ Run</button>',
              '<button type="button" class="ost-console__btn" id="ostConsoleClear">Clear</button>',
              '<span class="ost-console__hint" id="ostConsoleHint"></span>',
            '</div>',
          '</div>',
          '<div class="ost-console__right">',
            '<div class="ost-console__output-head">',
              '<span class="ost-console__label">Output</span>',
              '<button type="button" class="ost-console__btn ost-console__btn--sm" id="ostConsoleCopyOut">Copy</button>',
            '</div>',
            '<pre class="ost-console__output" id="ostConsoleOutput">// Run an expression to see the result here.\n// OST_API.get(path) calls your configured server.\n// OST_API.post(path, body) sends a POST.</pre>',
          '</div>',
        '</div>',
        // Server status strip
        '<div class="ost-console__status-bar" id="ostConsoleStatus">',
          '<span data-bind="edge">—</span>',
          '<span data-bind="btc">—</span>',
          '<span data-bind="kv">—</span>',
          '<span data-bind="ts">—</span>',
        '</div>',
      '</div>'
    ].join('');
    document.body.appendChild(el);
    return el;
  }

  // ── OST_API helper exposed globally ──────────────────────────────────────

  function makeApi(base) {
    return {
      base: base,
      get: function (path) {
        var url = base + path;
        return fetch(url, { headers: { accept: 'application/json' } })
          .then(function (r) { return r.json().then(function (j) { return j; }); });
      },
      post: function (path, body) {
        var url = base + path;
        return fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify(body || {})
        }).then(function (r) { return r.json(); });
      }
    };
  }

  // ── Eval helper (async, captured in a real function) ─────────────────────

  function evalExpr(code) {
    /* jshint evil:true */
    try {
      // Wrap in an async function so top-level await works.
      var fn = new Function(  // eslint-disable-line no-new-func
        'OST_API', 'OST_PREDICTION_API', 'OST_MARKET_MODAL', 'OST_TRADE_POPOUT',
        '__predictionState', 'localStorage', 'fetch',
        '"use strict"; return (async function() { return (' + code + '); })();'
      );
      return fn(
        window.OST_API || null,
        window.OST_PREDICTION_API || null,
        window.OST_MARKET_MODAL || null,
        window.OST_TRADE_POPOUT || null,
        window.__predictionState || null,
        window.localStorage,
        window.fetch.bind(window)
      );
    } catch (e) {
      return Promise.reject(e);
    }
  }

  // ── Console logic ─────────────────────────────────────────────────────────

  function open() {
    var el = document.getElementById(CONSOLE_ID) || buildConsole();
    wire(el);
    el.classList.add('is-open');
    document.body.style.overflow = 'hidden';
    var inp = document.getElementById('ostConsoleApiUrl');
    var saved = localStorage.getItem(API_BASE_KEY) || window.OST_API_BASE || '';
    if (inp) inp.value = saved;
    applyApiBase(saved || '', el);
    pingServer(el);
    populateExamples();
  }

  function close() {
    var el = document.getElementById(CONSOLE_ID);
    if (el) el.classList.remove('is-open');
    document.body.style.overflow = '';
  }

  function applyApiBase(base, el) {
    base = (base || '').replace(/\/$/, '');
    window.OST_API_BASE = base || null;
    window.OST_API = base ? makeApi(base) : null;
    var urlEl = document.getElementById('ostConsoleUrl');
    if (urlEl) urlEl.textContent = base ? base : '(no server configured)';
    if (base) localStorage.setItem(API_BASE_KEY, base);
  }

  function pingServer(el) {
    var base = (window.OST_API_BASE || '').replace(/\/$/, '');
    var statusBar = document.getElementById('ostConsoleStatus');
    if (!statusBar) return;
    var set = function (key, val) {
      var s = statusBar.querySelector('[data-bind="' + key + '"]');
      if (s) s.textContent = val;
    };
    if (!base) { set('edge', 'no server'); set('btc', ''); set('kv', ''); set('ts', ''); return; }
    fetch(base + '/health', { headers: { accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (!j) { set('edge', '⚠ server error'); return; }
        set('edge', '✓ edge: ' + (j.edge || '?'));
        set('btc', 'BTC $' + (j.btcPrice ? Number(j.btcPrice).toLocaleString(undefined, { maximumFractionDigits: 0 }) : '—') + ' · ' + (j.btcSource || '?'));
        set('kv', j.kv ? '✓ KV storage' : '⚠ KV not bound');
        set('ts', j.ts ? new Date(j.ts).toLocaleTimeString() : '');
      })
      .catch(function (e) { set('edge', '✗ ' + (e && e.message || 'unreachable')); });
  }

  function populateExamples() {
    var list = document.getElementById('ostConsoleExamples');
    if (!list || list.dataset.built) return;
    list.dataset.built = '1';
    EXAMPLES.forEach(function (ex) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ost-console__example-btn';
      btn.textContent = ex.label;
      btn.addEventListener('click', function () {
        var inp = document.getElementById('ostConsoleInput');
        if (inp) { inp.value = ex.code; inp.focus(); }
      });
      list.appendChild(btn);
    });
  }

  var wired = false;
  function wire(el) {
    if (wired) return; wired = true;

    // Close on backdrop / close btn
    el.addEventListener('click', function (ev) {
      if (ev.target.closest('[data-act="close"]')) close();
    });
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && el.classList.contains('is-open')) close();
    });

    // Save API URL
    var saveBtn = document.getElementById('ostConsoleSaveUrl');
    if (saveBtn) saveBtn.addEventListener('click', function () {
      var inp = document.getElementById('ostConsoleApiUrl');
      applyApiBase(inp ? inp.value.trim() : '', el);
      pingServer(el);
    });

    // Run
    var runBtn = document.getElementById('ostConsoleRun');
    if (runBtn) runBtn.addEventListener('click', runExpr);
    var inputEl = document.getElementById('ostConsoleInput');
    if (inputEl) {
      inputEl.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) runExpr();
      });
    }

    // Copy output
    var copyOut = document.getElementById('ostConsoleCopyOut');
    if (copyOut) copyOut.addEventListener('click', function () {
      var out = document.getElementById('ostConsoleOutput');
      if (!out) return;
      if (navigator.clipboard) navigator.clipboard.writeText(out.textContent);
    });

    // Clear
    var clearBtn = document.getElementById('ostConsoleClear');
    if (clearBtn) clearBtn.addEventListener('click', function () {
      var inp = document.getElementById('ostConsoleInput');
      var out = document.getElementById('ostConsoleOutput');
      if (inp) inp.value = '';
      if (out) out.textContent = '';
    });
  }

  function runExpr() {
    var inp = document.getElementById('ostConsoleInput');
    var out = document.getElementById('ostConsoleOutput');
    var hint = document.getElementById('ostConsoleHint');
    if (!inp || !out) return;
    var code = inp.value.trim();
    if (!code) return;
    out.textContent = '// running…';
    if (hint) hint.textContent = '';
    var t0 = Date.now();
    evalExpr(code)
      .then(function (result) {
        var ms = Date.now() - t0;
        out.textContent = JSON.stringify(result, null, 2);
        if (hint) { hint.textContent = '✓ ' + ms + 'ms'; hint.className = 'ost-console__hint ost-console__hint--ok'; }
      })
      .catch(function (e) {
        var ms = Date.now() - t0;
        out.textContent = '// ERROR: ' + (e && e.message || String(e));
        if (hint) { hint.textContent = '✗ ' + ms + 'ms'; hint.className = 'ost-console__hint ost-console__hint--err'; }
      });
  }

  // ── Public API ────────────────────────────────────────────────────────────

  window.OST_CONSOLE = { open: open, close: close };

  // Boot: read saved API base on page load
  (function () {
    // Default edge API endpoint (used when localStorage and inline config are absent).
    var fallbackBase = 'https://ost-api-pages.pages.dev';
    if (!window.OST_API_BASE) window.OST_API_BASE = fallbackBase;
    var saved = localStorage.getItem(API_BASE_KEY) || '';
    if (saved) {
      window.OST_API_BASE = saved;
      window.OST_API = makeApi(saved);
    } else if (window.OST_API_BASE) {
      window.OST_API = makeApi(String(window.OST_API_BASE).replace(/\/$/, ''));
    }
  })();
})();

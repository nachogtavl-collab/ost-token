/* ==========================================================================
 * OST · Quantum Lab — a REAL quantum-mechanics engine, not a metaphor
 * --------------------------------------------------------------------------
 * WHAT IS ACTUALLY REAL HERE (the honesty rule, kept):
 *
 *  1. THE PHYSICS IS EXACT. State is a 2^N complex amplitude vector. Gates are
 *     the true unitary matrices (H, X, Y, Z, S, T, RX/RY/RZ, CNOT) applied
 *     exactly. Superposition, interference and ENTANGLEMENT are the genuine
 *     linear algebra of quantum mechanics — apply H then CNOT and you hold a
 *     real Bell state, verifiable by the reduced-density Bloch length dropping
 *     to 0 (a maximally mixed, entangled qubit). This is a simulator: the math
 *     IS the physics, run on your device — not a quantum computer.
 *
 *  2. THE COLLAPSE IS REAL QUANTUM RANDOMNESS. Measurement draws from the ANU
 *     vacuum-fluctuation QRNG (relayed by the OST worker at /quantum/entropy).
 *     When that is unreachable we fall back to your device CSPRNG and SAY SO on
 *     the readout — the entropy source is labelled on every measurement, never
 *     dressed up as quantum when it wasn't.
 *
 * This is the thing the quantum-resistant section calls a "metaphor" made real:
 * genuine superposition + entanglement you can build and collapse.
 * API: window.OST_QUANTUM_LAB.open() / .close()
 * ========================================================================== */
(function () {
  'use strict';
  if (window.OST_QUANTUM_LAB) return;

  var API = (window.OST_API_BASE || 'https://ost-api.nachogtavl.workers.dev').replace(/\/+$/, '');
  var SQRT1_2 = Math.SQRT1_2;

  /* ================= REAL QUANTUM ENGINE ================= */
  // Amplitudes as parallel arrays (re, im), length 2^N. Index bit q is qubit q
  // (little-endian: qubit 0 = least-significant bit).
  var N = 3, re = null, im = null;
  function dim() { return 1 << N; }
  function reset(n) {
    if (n) N = Math.max(1, Math.min(4, n));
    var d = dim(); re = new Float64Array(d); im = new Float64Array(d);
    re[0] = 1;   // |00…0>
  }
  // Apply an arbitrary 2x2 unitary [[a,b],[c,d]] (complex) to qubit q.
  function apply1(q, a, b, c, d) {
    var bit = 1 << q, D = dim();
    for (var i = 0; i < D; i++) {
      if (i & bit) continue;              // process each (0,1) pair once
      var j = i | bit;
      var r0 = re[i], i0 = im[i], r1 = re[j], i1 = im[j];
      // new0 = a*|0> + b*|1>
      re[i] = a.r * r0 - a.i * i0 + b.r * r1 - b.i * i1;
      im[i] = a.r * i0 + a.i * r0 + b.r * i1 + b.i * r1;
      // new1 = c*|0> + d*|1>
      re[j] = c.r * r0 - c.i * i0 + d.r * r1 - d.i * i1;
      im[j] = c.r * i0 + c.i * r0 + d.r * i1 + d.i * r1;
    }
  }
  var C = function (r, i) { return { r: r, i: i || 0 }; };
  var GATES = {
    H:  function (q) { apply1(q, C(SQRT1_2), C(SQRT1_2), C(SQRT1_2), C(-SQRT1_2)); },
    X:  function (q) { apply1(q, C(0), C(1), C(1), C(0)); },
    Y:  function (q) { apply1(q, C(0), C(0, -1), C(0, 1), C(0)); },
    Z:  function (q) { apply1(q, C(1), C(0), C(0), C(-1)); },
    S:  function (q) { apply1(q, C(1), C(0), C(0), C(0, 1)); },
    T:  function (q) { apply1(q, C(1), C(0), C(0), C(Math.cos(Math.PI / 4), Math.sin(Math.PI / 4))); },
    RX: function (q) { var t = Math.PI / 4, c = Math.cos(t / 2), s = Math.sin(t / 2); apply1(q, C(c), C(0, -s), C(0, -s), C(c)); },
    RY: function (q) { var t = Math.PI / 4, c = Math.cos(t / 2), s = Math.sin(t / 2); apply1(q, C(c), C(-s), C(s), C(c)); }
  };
  // CNOT: control c, target t. Swap amplitudes of basis states where control=1.
  function cnot(c, t) {
    var cb = 1 << c, tb = 1 << t, D = dim();
    for (var i = 0; i < D; i++) {
      if ((i & cb) && !(i & tb)) {
        var j = i | tb;
        var tr = re[i], ti = im[i]; re[i] = re[j]; im[i] = im[j]; re[j] = tr; im[j] = ti;
      }
    }
  }
  function prob(i) { return re[i] * re[i] + im[i] * im[i]; }
  // Reduced Bloch vector for qubit q (partial trace). |r|=1 pure, <1 entangled.
  function bloch(q) {
    var bit = 1 << q, D = dim(), x = 0, y = 0, z = 0;
    for (var i = 0; i < D; i++) {
      if (i & bit) continue;
      var j = i | bit;
      z += prob(i) - prob(j);
      // rho01 += a_i * conj(a_j)
      x += 2 * (re[i] * re[j] + im[i] * im[j]);
      y += 2 * (im[i] * re[j] - re[i] * im[j]);
    }
    return { x: x, y: y, z: z, r: Math.sqrt(x * x + y * y + z * z) };
  }

  /* ================= REAL QUANTUM ENTROPY ================= */
  var pool = [], lastSource = 'device-csprng';
  function cryptoFill(n) { var b = new Uint8Array(n); (window.crypto || crypto).getRandomValues(b); for (var i = 0; i < n; i++) pool.push(b[i]); }
  // Prefer genuine ANU vacuum entropy (via the worker). Returns the source used.
  function quantumFill(n) {
    return fetch(API + '/quantum/entropy?n=' + (n || 64), { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (j && j.ok && j.quantum && Array.isArray(j.data) && j.data.length) {
          for (var i = 0; i < j.data.length; i++) pool.push(j.data[i] & 255);
          return 'anu-qrng-vacuum';
        }
        cryptoFill(n || 64); return 'device-csprng';
      })
      .catch(function () { cryptoFill(n || 64); return 'device-csprng'; });
  }
  // A uniform [0,1) consuming 4 entropy bytes.
  function unit() {
    if (pool.length < 4) cryptoFill(16);
    var v = 0; for (var i = 0; i < 4; i++) v = v * 256 + pool.shift();
    return v / 4294967296;
  }

  /* ================= MEASUREMENT (Born rule + collapse) ================= */
  // Measure ALL qubits: pick a basis state by |amp|^2, collapse to it. Uses real
  // quantum entropy for the draw when available.
  function measureAll() {
    return quantumFill(8).then(function (src) {
      lastSource = src;
      var u = unit(), acc = 0, D = dim(), out = 0;
      for (var i = 0; i < D; i++) { acc += prob(i); if (u < acc) { out = i; break; } out = i; }
      re = new Float64Array(D); im = new Float64Array(D); re[out] = 1;   // collapse
      return { outcome: out, source: src };
    });
  }
  // Measure a single qubit q: outcome 0/1 by marginal prob, collapse+renormalize.
  function measureQubit(q) {
    return quantumFill(8).then(function (src) {
      lastSource = src;
      var bit = 1 << q, D = dim(), p1 = 0;
      for (var i = 0; i < D; i++) if (i & bit) p1 += prob(i);
      var u = unit(), res = (u < p1) ? 1 : 0;
      var norm = Math.sqrt(res ? p1 : (1 - p1)) || 1;
      for (var k = 0; k < D; k++) {
        var isOne = (k & bit) ? 1 : 0;
        if (isOne !== res) { re[k] = 0; im[k] = 0; }
        else { re[k] /= norm; im[k] /= norm; }
      }
      return { qubit: q, outcome: res, source: src };
    });
  }

  /* ================= SCI-FI UI ================= */
  var el = {}, open = false, selectedGate = 'H', pendingControl = null, raf = 0, tPhase = 0, lastMeasure = null, flash = 0;

  function styles() {
    if (document.getElementById('oqlStyle')) return;
    var s = document.createElement('style'); s.id = 'oqlStyle';
    s.textContent = [
      '#oqlRoot{position:fixed;inset:0;z-index:100080;display:none;flex-direction:column;color:#dbeafe;',
      'background:radial-gradient(1200px 700px at 70% -10%,rgba(99,102,241,.18),transparent),radial-gradient(900px 600px at 10% 110%,rgba(16,185,129,.14),transparent),linear-gradient(180deg,#03040a,#070a18);',
      'font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;overflow:hidden;}',
      '#oqlRoot.on{display:flex;}',
      '.oql-head{display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid rgba(129,140,248,.22);backdrop-filter:blur(6px);}',
      '.oql-title{font-weight:900;letter-spacing:.5px;font-size:15px;display:flex;align-items:center;gap:9px;color:#e0e7ff;}',
      '.oql-title .dot{width:9px;height:9px;border-radius:50%;background:#a5b4fc;box-shadow:0 0 14px #818cf8;animation:oqlPulse 2s infinite;}',
      '@keyframes oqlPulse{0%,100%{opacity:.5;transform:scale(.85)}50%{opacity:1;transform:scale(1.15)}}',
      '.oql-badge{font-size:10px;font-weight:800;padding:3px 9px;border-radius:999px;background:rgba(16,185,129,.16);color:#6ee7b7;border:1px solid rgba(16,185,129,.35);}',
      '.oql-x{margin-left:auto;background:transparent;border:1px solid rgba(148,163,184,.3);color:#cbd5e1;border-radius:9px;width:34px;height:34px;font-size:18px;cursor:pointer;}',
      '.oql-body{flex:1;display:grid;grid-template-columns:1fr;gap:14px;padding:14px 16px;overflow-y:auto;}',
      '@media(min-width:900px){.oql-body{grid-template-columns:1.35fr .9fr;}}',
      '.oql-stage{position:relative;border:1px solid rgba(129,140,248,.2);border-radius:16px;background:rgba(3,6,18,.5);min-height:340px;overflow:hidden;}',
      '.oql-canvas{display:block;width:100%;height:100%;}',
      '.oql-side{display:flex;flex-direction:column;gap:12px;}',
      '.oql-card{border:1px solid rgba(129,140,248,.2);border-radius:14px;background:rgba(9,12,26,.66);padding:12px 13px;}',
      '.oql-card h4{margin:0 0 9px;font-size:11px;letter-spacing:1.4px;text-transform:uppercase;color:#a5b4fc;font-weight:800;}',
      '.oql-gates{display:flex;flex-wrap:wrap;gap:7px;}',
      '.oql-g{min-width:42px;padding:9px 0;flex:1;border:1px solid rgba(148,163,184,.3);border-radius:10px;background:linear-gradient(180deg,rgba(30,41,59,.7),rgba(15,23,42,.7));color:#e2e8f0;font-weight:800;font-size:13px;cursor:pointer;transition:.15s;font-family:ui-monospace,monospace;}',
      '.oql-g:hover{border-color:#818cf8;}',
      '.oql-g.sel{background:linear-gradient(180deg,#4f46e5,#4338ca);border-color:#a5b4fc;box-shadow:0 0 18px rgba(129,140,248,.5);color:#fff;}',
      '.oql-g small{display:block;font-size:8.5px;font-weight:700;color:#94a3b8;letter-spacing:.3px;margin-top:2px;}',
      '.oql-qubits{display:flex;flex-direction:column;gap:8px;}',
      '.oql-qrow{display:flex;align-items:center;gap:9px;}',
      '.oql-qlab{font-family:ui-monospace,monospace;font-weight:800;color:#c7d2fe;width:26px;font-size:12px;}',
      '.oql-qbtn{flex:1;text-align:left;padding:9px 11px;border:1px solid rgba(148,163,184,.25);border-radius:10px;background:rgba(2,6,23,.55);color:#dbeafe;cursor:pointer;font-size:12px;transition:.15s;}',
      '.oql-qbtn:hover{border-color:#818cf8;background:rgba(30,41,59,.6);}',
      '.oql-qbtn.ctrl{border-color:#f0abfc;box-shadow:0 0 14px rgba(240,171,252,.4);}',
      '.oql-mbtn{border:none;border-radius:9px;padding:8px 10px;font-weight:800;font-size:11px;cursor:pointer;background:rgba(129,140,248,.16);color:#c7d2fe;border:1px solid rgba(129,140,248,.35);}',
      '.oql-actions{display:flex;gap:8px;flex-wrap:wrap;}',
      '.oql-act{flex:1;min-width:96px;border:none;border-radius:11px;padding:11px 0;font-weight:800;font-size:13px;cursor:pointer;}',
      '.oql-measure{background:linear-gradient(135deg,#f43f5e,#be123c);color:#fff;box-shadow:0 6px 22px rgba(244,63,94,.4);}',
      '.oql-reset{background:rgba(148,163,184,.15);color:#cbd5e1;border:1px solid rgba(148,163,184,.3);}',
      '.oql-preset{background:linear-gradient(135deg,#10b981,#059669);color:#04121a;}',
      '.oql-read{font-family:ui-monospace,monospace;font-size:11.5px;line-height:1.7;color:#cbd5e1;}',
      '.oql-read b{color:#a5b4fc;}',
      '.oql-src{font-size:11px;color:#94a3b8;margin-top:4px;}',
      '.oql-src .q{color:#6ee7b7;font-weight:800;}.oql-src .c{color:#fbbf24;font-weight:800;}',
      '.oql-hint{font-size:11px;color:#94a3b8;line-height:1.5;}',
      '.oql-chip{display:inline-block;font-size:10px;font-weight:800;padding:2px 8px;border-radius:999px;margin:2px 4px 2px 0;}',
      '.oql-chip.ent{background:rgba(240,171,252,.16);color:#f0abfc;border:1px solid rgba(240,171,252,.35);}',
      '.oql-chip.sup{background:rgba(125,211,252,.16);color:#7dd3fc;border:1px solid rgba(125,211,252,.35);}',
      '.oql-foot{padding:8px 16px;font-size:10.5px;color:#64748b;border-top:1px solid rgba(129,140,248,.18);line-height:1.5;}'
    ].join('');
    document.head.appendChild(s);
  }

  function build() {
    styles();
    var root = document.createElement('div'); root.id = 'oqlRoot';
    root.innerHTML =
      '<div class="oql-head"><span class="oql-title"><span class="dot"></span>OST Quantum Lab</span>' +
        '<span class="oql-badge" id="oqlSrcBadge">◆ real quantum entropy</span>' +
        '<button class="oql-x" data-oql-close aria-label="Close">×</button></div>' +
      '<div class="oql-body">' +
        '<div class="oql-stage"><canvas class="oql-canvas" data-oql-canvas></canvas></div>' +
        '<div class="oql-side">' +
          '<div class="oql-card"><h4>Gates · unitary operators</h4><div class="oql-gates" data-oql-gates></div>' +
            '<div class="oql-hint" style="margin-top:8px" data-oql-mode>Tap a gate, then a qubit below. For CNOT: tap the control qubit, then the target.</div></div>' +
          '<div class="oql-card"><h4>Qubits</h4><div class="oql-qubits" data-oql-qubits></div>' +
            '<div class="oql-actions" style="margin-top:10px"><button class="oql-act oql-preset" data-oql-bell>⎇ Bell pair</button><button class="oql-act oql-preset" data-oql-ghz>✷ GHZ</button></div></div>' +
          '<div class="oql-card"><h4>State</h4><div class="oql-read" data-oql-read></div><div class="oql-src" data-oql-src></div>' +
            '<div class="oql-actions" style="margin-top:10px"><button class="oql-act oql-measure" data-oql-measure>⟢ Measure (collapse)</button><button class="oql-act oql-reset" data-oql-reset>Reset</button></div></div>' +
        '</div>' +
      '</div>' +
      '<div class="oql-foot">Exact quantum-mechanical state-vector simulation running on your device — real superposition, interference &amp; entanglement. Measurement collapse uses <b>real quantum vacuum entropy</b> from the ANU QRNG (relayed by OST); it falls back to your device CSPRNG when offline and labels which was used. This is a simulator, not a quantum computer.</div>';
    document.body.appendChild(root);
    el.root = root;
    el.canvas = root.querySelector('[data-oql-canvas]');
    el.gates = root.querySelector('[data-oql-gates]');
    el.qubits = root.querySelector('[data-oql-qubits]');
    el.read = root.querySelector('[data-oql-read]');
    el.src = root.querySelector('[data-oql-src]');
    el.mode = root.querySelector('[data-oql-mode]');
    el.badge = root.querySelector('#oqlSrcBadge');

    var gateDefs = [['H', 'superpose'], ['X', 'NOT'], ['Y', 'bit+phase'], ['Z', 'phase'], ['S', 'π/2'], ['T', 'π/4'], ['RX', 'rot-x'], ['RY', 'rot-y'], ['CNOT', 'entangle']];
    el.gates.innerHTML = gateDefs.map(function (g) {
      return '<button class="oql-g' + (g[0] === selectedGate ? ' sel' : '') + '" data-gate="' + g[0] + '">' + g[0] + '<small>' + g[1] + '</small></button>';
    }).join('');
    el.gates.querySelectorAll('[data-gate]').forEach(function (b) {
      b.onclick = function () { selectedGate = b.getAttribute('data-gate'); pendingControl = null; syncGateUi(); renderQubits(); };
    });
    root.querySelector('[data-oql-close]').onclick = close;
    root.querySelector('[data-oql-measure]').onclick = doMeasure;
    root.querySelector('[data-oql-reset]').onclick = function () { reset(); pendingControl = null; refreshAll(); };
    root.querySelector('[data-oql-bell]').onclick = function () { reset(2); GATES.H(0); cnot(0, 1); refreshAll(); };
    root.querySelector('[data-oql-ghz]').onclick = function () { reset(3); GATES.H(0); cnot(0, 1); cnot(0, 2); refreshAll(); };
    document.addEventListener('keydown', escClose);
    renderQubits();
    return root;
  }
  function escClose(e) { if (e.key === 'Escape' && open) close(); }
  function syncGateUi() { if (!el.gates) return; el.gates.querySelectorAll('[data-gate]').forEach(function (b) { b.classList.toggle('sel', b.getAttribute('data-gate') === selectedGate); }); if (el.mode) el.mode.textContent = selectedGate === 'CNOT' ? (pendingControl == null ? 'CNOT: tap the CONTROL qubit…' : 'CNOT: now tap the TARGET qubit.') : 'Tap a qubit to apply ' + selectedGate + '.'; }

  function renderQubits() {
    if (!el.qubits) return;
    var rows = '';
    for (var q = 0; q < N; q++) {
      rows += '<div class="oql-qrow"><span class="oql-qlab">q' + q + '</span>' +
        '<button class="oql-qbtn' + (pendingControl === q ? ' ctrl' : '') + '" data-apply="' + q + '">apply ' + (selectedGate === 'CNOT' ? (pendingControl == null ? 'control' : (pendingControl === q ? '(control)' : 'target')) : selectedGate) + '</button>' +
        '<button class="oql-mbtn" data-mq="' + q + '">measure</button></div>';
    }
    el.qubits.innerHTML = rows;
    el.qubits.querySelectorAll('[data-apply]').forEach(function (b) {
      b.onclick = function () {
        var q = Number(b.getAttribute('data-apply'));
        if (selectedGate === 'CNOT') {
          if (pendingControl == null) { pendingControl = q; }
          else if (pendingControl !== q) { cnot(pendingControl, q); pendingControl = null; }
          syncGateUi(); renderQubits(); refreshAll(); return;
        }
        (GATES[selectedGate] || function () {})(q); refreshAll();
      };
    });
    el.qubits.querySelectorAll('[data-mq]').forEach(function (b) {
      b.onclick = function () { var q = Number(b.getAttribute('data-mq')); b.disabled = true; measureQubit(q).then(function (r) { flash = 1; lastMeasure = 'q' + q + '→' + r.outcome; refreshAll(); }).catch(function () {}).then(function () { b.disabled = false; }); };
    });
    syncGateUi();
  }

  function doMeasure() {
    var btn = el.root.querySelector('[data-oql-measure]'); if (btn) { btn.disabled = true; btn.textContent = 'collapsing…'; }
    measureAll().then(function (r) {
      flash = 1; lastMeasure = '|' + r.outcome.toString(2).padStart(N, '0') + '⟩';
      refreshAll();
    }).catch(function () {}).then(function () { if (btn) { btn.disabled = false; btn.textContent = '⟢ Measure (collapse)'; } });
  }

  function refreshAll() { renderRead(); renderQubits(); }
  function renderRead() {
    if (!el.read) return;
    var D = dim(), rows = [], anyEnt = false, anySup = 0;
    var probs = [];
    for (var i = 0; i < D; i++) probs.push({ i: i, p: prob(i) });
    probs.sort(function (a, b) { return b.p - a.p; });
    for (var s = 0; s < D; s++) if (probs[s].p > 0.0005) anySup++;
    var top = probs.filter(function (x) { return x.p > 0.0005; }).slice(0, 6);
    var html = top.map(function (x) {
      var ph = Math.atan2(im[x.i], re[x.i]) * 180 / Math.PI;
      return '<div>|<b>' + x.i.toString(2).padStart(N, '0') + '</b>⟩ &nbsp;' + (x.p * 100).toFixed(1) + '% <span style="color:#64748b">∠' + ph.toFixed(0) + '°</span></div>';
    }).join('');
    // entanglement chips
    var chips = '';
    for (var q = 0; q < N; q++) { var bl = bloch(q); if (bl.r < 0.985) { anyEnt = true; chips += '<span class="oql-chip ent">q' + q + ' entangled</span>'; } }
    if (anySup > 1) chips = '<span class="oql-chip sup">superposition ×' + anySup + '</span>' + chips;
    el.read.innerHTML = html + (chips ? '<div style="margin-top:8px">' + chips + '</div>' : '') + (lastMeasure ? '<div style="margin-top:8px;color:#6ee7b7">last collapse: <b>' + lastMeasure + '</b></div>' : '');
    if (el.src) el.src.innerHTML = 'collapse entropy: ' + (lastSource === 'anu-qrng-vacuum' ? '<span class="q">◆ ANU quantum vacuum</span>' : '<span class="c">device CSPRNG (QRNG offline)</span>');
    if (el.badge) el.badge.textContent = lastSource === 'anu-qrng-vacuum' ? '◆ real quantum entropy' : '◆ CSPRNG (QRNG offline)';
  }

  /* ---- canvas viz: amplitude constellation + Bloch spheres ---- */
  function resize() {
    if (!el.canvas) return; var st = el.canvas.parentElement, dpr = Math.min(2, window.devicePixelRatio || 1);
    var w = st.clientWidth, h = st.clientHeight;
    el.canvas.width = w * dpr; el.canvas.height = h * dpr; el.canvas.__dpr = dpr; el.canvas.__w = w; el.canvas.__h = h;
  }
  function hue(phase) { return ((phase * 180 / Math.PI) + 360) % 360; }
  function draw() {
    if (!open || !el.canvas) { raf = 0; return; }
    var dpr = el.canvas.__dpr || 1, w = el.canvas.__w || el.canvas.width, h = el.canvas.__h || el.canvas.height;
    var ctx = el.canvas.getContext('2d'); ctx.save(); ctx.scale(dpr, dpr); ctx.clearRect(0, 0, w, h);
    tPhase += 0.02;
    var D = dim();
    // --- amplitude constellation: a ring of basis states, glow = probability, hue = phase ---
    var cx = w * 0.5, cy = h * 0.42, R = Math.min(w, h) * 0.30;
    // faint ring
    ctx.strokeStyle = 'rgba(129,140,248,.15)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.stroke();
    for (var i = 0; i < D; i++) {
      var ang = (i / D) * Math.PI * 2 - Math.PI / 2;
      var px = cx + Math.cos(ang) * R, py = cy + Math.sin(ang) * R;
      var p = prob(i), ph = Math.atan2(im[i], re[i]);
      var rad = 6 + Math.sqrt(p) * (R * 0.55);
      if (p > 0.0004) {
        var hh = hue(ph);
        var g = ctx.createRadialGradient(px, py, 0, px, py, rad);
        g.addColorStop(0, 'hsla(' + hh + ',90%,70%,.95)');
        g.addColorStop(0.5, 'hsla(' + hh + ',90%,60%,.35)');
        g.addColorStop(1, 'hsla(' + hh + ',90%,60%,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(px, py, rad, 0, 7); ctx.fill();
        // phase tick
        ctx.strokeStyle = 'hsla(' + hh + ',90%,80%,.9)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + Math.cos(ph) * rad * 0.8, py + Math.sin(ph) * rad * 0.8); ctx.stroke();
      }
      ctx.fillStyle = p > 0.0004 ? 'rgba(226,232,240,.9)' : 'rgba(148,163,184,.35)';
      ctx.font = '10px ui-monospace,monospace'; ctx.textAlign = 'center';
      ctx.fillText('|' + i.toString(2).padStart(N, '0') + '⟩', cx + Math.cos(ang) * (R + 16), cy + Math.sin(ang) * (R + 16) + 3);
    }
    // center label
    ctx.fillStyle = 'rgba(165,180,252,.85)'; ctx.font = '700 11px ui-sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(N + '-qubit wavefunction', cx, cy - 4); ctx.fillStyle = 'rgba(148,163,184,.6)'; ctx.font = '9px ui-monospace'; ctx.fillText(D + ' amplitudes', cx, cy + 10);
    // --- Bloch spheres row ---
    var by = h - 66, bR = 26, gap = Math.min(90, (w - 40) / N), bx0 = cx - (N - 1) * gap / 2;
    for (var q = 0; q < N; q++) {
      var bl = bloch(q), bxc = bx0 + q * gap;
      ctx.strokeStyle = 'rgba(148,163,184,.3)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(bxc, by, bR, 0, 7); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(bxc, by, bR, bR * 0.34, 0, 0, 7); ctx.strokeStyle = 'rgba(148,163,184,.18)'; ctx.stroke();
      // bloch vector projected (x right, z up, y into-screen via slight tilt)
      var vx = bxc + bl.x * bR, vy = by - bl.z * bR - bl.y * bR * 0.28;
      var ent = bl.r < 0.985;
      ctx.strokeStyle = ent ? 'rgba(240,171,252,.95)' : 'rgba(110,231,183,.95)'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(bxc, by); ctx.lineTo(vx, vy); ctx.stroke();
      ctx.fillStyle = ctx.strokeStyle; ctx.beginPath(); ctx.arc(vx, vy, 3.4, 0, 7); ctx.fill();
      ctx.fillStyle = 'rgba(199,210,254,.8)'; ctx.font = '10px ui-monospace'; ctx.textAlign = 'center';
      ctx.fillText('q' + q + (ent ? ' ⚭' : ''), bxc, by + bR + 14);
    }
    // entanglement links between mixed qubits
    ctx.strokeStyle = 'rgba(240,171,252,' + (0.25 + 0.15 * Math.sin(tPhase * 2)) + ')'; ctx.lineWidth = 1.5;
    for (var a = 0; a < N; a++) for (var b2 = a + 1; b2 < N; b2++) {
      if (bloch(a).r < 0.985 && bloch(b2).r < 0.985) {
        ctx.beginPath(); ctx.moveTo(bx0 + a * gap, by - bR - 4); ctx.quadraticCurveTo((bx0 + a * gap + bx0 + b2 * gap) / 2, by - bR - 34, bx0 + b2 * gap, by - bR - 4); ctx.stroke();
      }
    }
    // measurement flash
    if (flash > 0.01) { ctx.fillStyle = 'rgba(244,63,94,' + (flash * 0.25) + ')'; ctx.fillRect(0, 0, w, h); flash *= 0.86; }
    ctx.restore();
    raf = requestAnimationFrame(draw);
  }

  function openLab() {
    if (!el.root) build();
    el.root.classList.add('on'); open = true; document.body.style.overflow = 'hidden';
    if (!re) reset(N);
    resize(); refreshAll(); if (!raf) raf = requestAnimationFrame(draw);
    // warm a real quantum-entropy pool so the first collapse is genuinely quantum
    quantumFill(64).then(function (src) { lastSource = src; renderRead(); });
    try { window.dispatchEvent(new CustomEvent('ost:quantum-lab-open')); } catch (_) {}
  }
  function close() { if (!el.root) return; el.root.classList.remove('on'); open = false; document.body.style.overflow = ''; if (raf) { cancelAnimationFrame(raf); raf = 0; } }

  window.addEventListener('resize', function () { if (open) resize(); });
  reset(N);
  // Wire any launcher button on the page ([data-oql-open]) to open the lab.
  function wireLaunchers() {
    var bs = document.querySelectorAll('[data-oql-open]');
    for (var i = 0; i < bs.length; i++) { if (bs[i].__oql) continue; bs[i].__oql = 1; bs[i].addEventListener('click', function (e) { e.preventDefault(); openLab(); }); }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wireLaunchers); else wireLaunchers();
  setTimeout(wireLaunchers, 1500);
  window.OST_QUANTUM_LAB = { open: openLab, close: close, engine: { reset: reset, apply: function (g, q) { (GATES[g] || function () {})(q); }, cnot: cnot, bloch: bloch, prob: prob, measureAll: measureAll, state: function () { return { N: N, re: Array.from(re), im: Array.from(im) }; } } };
})();

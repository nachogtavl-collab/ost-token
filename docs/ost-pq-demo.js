/* ==========================================================================
 * OST · Post-Quantum signature demo — REAL Lamport one-time signatures
 * --------------------------------------------------------------------------
 * This is not a mock. It generates a genuine Lamport keypair, signs the
 * SHA-256 of your message, and verifies it — all in the browser via Web
 * Crypto. Lamport signatures are post-quantum secure: their only assumption
 * is that SHA-256 is preimage-resistant (Grover only halves that to ~2^128).
 * It is a *demonstration* of the scheme OST is researching; it does NOT sign
 * live OST transactions (those still use Solana ed25519).
 * ========================================================================== */
(function () {
  'use strict';

  if (!window.crypto || !window.crypto.subtle) return; // needs Web Crypto

  var enc = new TextEncoder();
  var N = 256;               // one secret pair per bit of the SHA-256 digest
  var made = 0;              // how many signatures the visitor has produced
  var cur = null;            // { msg, sig:[Uint8Array x256], pk:[[h0,h1] x256] }

  function sha256(bytes) {
    return crypto.subtle.digest('SHA-256', bytes).then(function (b) { return new Uint8Array(b); });
  }
  function rand(n) { var a = new Uint8Array(n); crypto.getRandomValues(a); return a; }
  function hex(u8, max) {
    var s = '', lim = max ? Math.min(max, u8.length) : u8.length;
    for (var i = 0; i < lim; i++) s += ('0' + u8[i].toString(16)).slice(-2);
    return s + (max && u8.length > max ? '…' : '');
  }
  function ctEq(a, b) {
    if (a.length !== b.length) return false;
    var d = 0; for (var i = 0; i < a.length; i++) d |= a[i] ^ b[i];
    return d === 0;
  }
  function bitsOf(u8) { // 256 bits, MSB-first
    var out = new Array(u8.length * 8), k = 0;
    for (var i = 0; i < u8.length; i++) for (var b = 7; b >= 0; b--) out[k++] = (u8[i] >> b) & 1;
    return out;
  }

  // Fresh Lamport keypair: N pairs of 32-byte secrets; public = their hashes.
  function keygen() {
    var sk = new Array(N), hashJobs = [];
    for (var i = 0; i < N; i++) {
      var s0 = rand(32), s1 = rand(32);
      sk[i] = [s0, s1];
      hashJobs.push(sha256(s0), sha256(s1));
    }
    return Promise.all(hashJobs).then(function (hs) {
      var pk = new Array(N);
      for (var i = 0; i < N; i++) pk[i] = [hs[2 * i], hs[2 * i + 1]];
      return { sk: sk, pk: pk };
    });
  }
  function sign(msg, kp) {
    return sha256(enc.encode(msg)).then(function (mh) {
      var mb = bitsOf(mh), sig = new Array(N);
      for (var i = 0; i < N; i++) sig[i] = kp.sk[i][mb[i]]; // reveal one secret per bit
      return { sig: sig, digest: mh };
    });
  }
  function verify(msg, sig, pk) {
    return sha256(enc.encode(msg)).then(function (mh) {
      var mb = bitsOf(mh);
      var jobs = [];
      for (var i = 0; i < N; i++) jobs.push(sha256(sig[i]));
      return Promise.all(jobs).then(function (hs) {
        for (var i = 0; i < N; i++) if (!ctEq(hs[i], pk[i][mb[i]])) return false;
        return true;
      });
    });
  }

  /* ---- scoped styles ------------------------------------------------------ */
  function injectCss() {
    if (document.getElementById('ostPqDemoCss')) return;
    var css = '' +
      '.qr-tag{display:inline-block;font-size:.6em;font-weight:700;letter-spacing:.04em;text-transform:uppercase;padding:.18em .5em;border-radius:999px;vertical-align:middle;margin-left:.5em;}' +
      '.qr-tag-live{background:rgba(52,211,153,.16);color:#34d399;border:1px solid rgba(52,211,153,.4);}' +
      '.qr-tag-concept{background:rgba(148,163,184,.14);color:#94a3b8;border:1px solid rgba(148,163,184,.35);}' +
      '.qr-pqdemo{margin-top:14px;padding:14px;border:1px solid rgba(52,211,153,.28);border-radius:14px;background:rgba(6,20,16,.55);}' +
      '.qr-pqdemo-head{font-weight:700;font-size:.9rem;color:#34d399;margin-bottom:10px;}' +
      '.qr-pqdemo-label{display:block;font-size:.72rem;text-transform:uppercase;letter-spacing:.05em;color:#94a3b8;margin-bottom:5px;}' +
      '.qr-pqdemo-input{width:100%;box-sizing:border-box;padding:10px 12px;border-radius:10px;border:1px solid rgba(148,163,184,.3);background:rgba(2,6,12,.6);color:#e5e7eb;font-size:.95rem;}' +
      '.qr-pqdemo-actions{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0;}' +
      '.qr-pqdemo-actions .btn{flex:1 1 auto;min-height:40px;font-size:.85rem;padding:8px 10px;}' +
      '.qr-pqdemo-out{font-size:.82rem;line-height:1.5;color:#cbd5e1;background:rgba(2,6,12,.5);border-radius:10px;padding:10px 12px;word-break:break-word;}' +
      '.qr-pqdemo-out code{color:#67e8f9;font-size:.9em;}' +
      '.qr-pqdemo-out.is-ok{color:#d1fae5;border:1px solid rgba(52,211,153,.35);}' +
      '.qr-pqdemo-out.is-bad{color:#fecaca;border:1px solid rgba(248,113,113,.4);}';
    var s = document.createElement('style');
    s.id = 'ostPqDemoCss'; s.textContent = css;
    document.head.appendChild(s);
  }

  /* ---- UI wiring ---------------------------------------------------------- */
  function boot() {
    var demo = document.getElementById('qrPqDemo');
    if (!demo || demo.__wired) return;
    injectCss();
    demo.__wired = true;
    var msgEl = document.getElementById('qrPqMsg');
    var signBtn = document.getElementById('qrPqSign');
    var verifyBtn = document.getElementById('qrPqVerify');
    var tamperBtn = document.getElementById('qrPqTamper');
    var out = document.getElementById('qrPqOut');
    var statEl = document.getElementById('qrStatSigs');
    if (!msgEl || !signBtn || !out) return;

    function setOut(html, tone) {
      out.innerHTML = html;
      out.className = 'qr-pqdemo-out' + (tone ? ' is-' + tone : '');
    }
    function busy(b) { signBtn.disabled = b; if (b) { verifyBtn.disabled = tamperBtn.disabled = true; } }

    signBtn.addEventListener('click', function () {
      var msg = (msgEl.value || '').trim() || 'OST message';
      busy(true);
      setOut('Generating a fresh 256-pair Lamport keypair and signing… (one-time key)');
      var t0 = performance.now();
      keygen().then(function (kp) {
        return sign(msg, kp).then(function (r) {
          cur = { msg: msg, sig: r.sig, pk: kp.pk };
          made++;
          if (statEl) statEl.textContent = String(made);
          var ms = Math.round(performance.now() - t0);
          var sigBytes = N * 32;
          setOut(
            '<strong>&#10003; Signed with a real Lamport OTS.</strong><br>' +
            'msg SHA-256: <code>' + hex(r.digest, 8) + '</code><br>' +
            'signature: <code>' + hex(cur.sig[0], 6) + '</code> … (' + N + ' revealed secrets, ' + (sigBytes / 1024).toFixed(0) + ' KB) &middot; ' + ms + ' ms<br>' +
            'Now hit <strong>Verify</strong>, then <strong>Tamper</strong> to see forgery fail.', 'ok');
          verifyBtn.disabled = false; tamperBtn.disabled = false;
          busy(false);
        });
      }).catch(function (e) { setOut('Demo error: ' + (e && e.message || e), 'bad'); busy(false); });
    });

    verifyBtn.addEventListener('click', function () {
      if (!cur) return;
      setOut('Verifying signature against the message…');
      verify(cur.msg, cur.sig, cur.pk).then(function (ok) {
        setOut(ok
          ? '<strong>&#10003; VALID.</strong> Every one of the ' + N + ' revealed secrets hashes to the matching public value for &ldquo;' + escapeHtml(cur.msg) + '&rdquo;. This holds even against a quantum adversary.'
          : '<strong>&#10007; Invalid.</strong> (unexpected)', ok ? 'ok' : 'bad');
      });
    });

    tamperBtn.addEventListener('click', function () {
      if (!cur) return;
      var forged = cur.msg + '00'; // change the message, keep the old signature
      setOut('Trying to reuse the signature for a <em>changed</em> message: &ldquo;' + escapeHtml(forged) + '&rdquo;…');
      verify(forged, cur.sig, cur.pk).then(function (ok) {
        setOut(ok
          ? '<strong>&#10007; unexpectedly valid</strong>'
          : '<strong>&#10007; FORGERY REJECTED.</strong> The altered message hashes to different bits, so the old signature reveals the wrong secrets — verification fails. That&rsquo;s the post-quantum guarantee, live in your browser.', ok ? 'bad' : 'ok');
      });
    });

    function escapeHtml(s) { return String(s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
  }

  // The quantum section may mount lazily; wire on load and when it activates.
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
  document.addEventListener('ost:compartment', function (e) { if (e.detail && e.detail.id === 'quantum-realm') boot(); });
  window.OST_PQ_DEMO = { boot: boot };
})();

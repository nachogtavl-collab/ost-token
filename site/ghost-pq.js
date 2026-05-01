/* ghost-pq.js — OST Ghost post-quantum-ready device client (browser).
 *
 * Mirrors workers/ost-api/src/ghost-crypto.js so the browser can:
 *   - Generate a per-device Ed25519 keypair (WebCrypto, real PQ-hybrid-ready slot).
 *   - Persist it locally (IndexedDB-backed via localStorage fallback).
 *   - Build canonical signed envelopes bound to the device.
 *   - Enroll the device with the OST worker (requires operator token).
 *   - Verify envelopes via the worker.
 *
 * Exposed on window as `OST_GHOST_PQ`.
 */
(function () {
  'use strict';

  const ENVELOPE_VERSION = 1;
  const STORAGE_KEY = 'ost.ghost.pq.device.v1';
  const TEXT = new TextEncoder();

  function apiBase() {
    return (typeof window !== 'undefined' && window.OST_API_BASE) || '';
  }

  function b64uEncode(bytes) {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    let s = '';
    for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function b64uDecode(str) {
    const s = String(str || '').replace(/-/g, '+').replace(/_/g, '/');
    const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
    const bin = atob(s + pad);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function canonicalize(value) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return '[' + value.map(canonicalize).join(',') + ']';
    const keys = Object.keys(value).sort();
    return '{' + keys.map(k => JSON.stringify(k) + ':' + canonicalize(value[k])).join(',') + '}';
  }

  async function sha384(bytes) {
    const buf = bytes instanceof Uint8Array ? bytes : TEXT.encode(String(bytes));
    return new Uint8Array(await crypto.subtle.digest('SHA-384', buf));
  }

  async function payloadDigest(payload) {
    return 'sha384:' + b64uEncode(await sha384(TEXT.encode(canonicalize(payload))));
  }

  // ── device persistence ────────────────────────────────────────────────────

  function loadDevice() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (_) { return null; }
  }

  function saveDevice(record) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(record)); } catch (_) {}
  }

  function clearDevice() {
    try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
  }

  function makeDeviceId() {
    const rand = b64uEncode(crypto.getRandomValues(new Uint8Array(8))).slice(0, 10).toLowerCase();
    return `web-${rand}`;
  }

  async function generateDevice(label) {
    const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
    const pub = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
    const priv = await crypto.subtle.exportKey('jwk', pair.privateKey);
    const record = {
      deviceId: makeDeviceId(),
      label: String(label || 'OST Ghost browser device').slice(0, 120),
      classicalAlg: 'Ed25519',
      classicalPub: b64uEncode(pub),
      classicalPrivJwk: priv,
      pqAlg: 'placeholder',   // upgradeable when an ML-DSA backend ships
      pqPub: null,
      createdAt: new Date().toISOString()
    };
    saveDevice(record);
    return record;
  }

  async function ensureDevice(label) {
    return loadDevice() || generateDevice(label);
  }

  // ── classical signing ─────────────────────────────────────────────────────

  async function classicalSign(privJwk, dataBytes) {
    const key = await crypto.subtle.importKey('jwk', privJwk, { name: 'Ed25519' }, false, ['sign']);
    const sig = await crypto.subtle.sign({ name: 'Ed25519' }, key, dataBytes);
    return b64uEncode(new Uint8Array(sig));
  }

  // ── envelopes ─────────────────────────────────────────────────────────────

  async function buildEnvelope(payload, opts = {}) {
    const device = await ensureDevice(opts.label);
    const ttl = Number(opts.ttlSeconds) > 0 ? Number(opts.ttlSeconds) : 300;
    const now = Date.now();
    const header = {
      v: ENVELOPE_VERSION,
      algSet: {
        classicalSig: 'Ed25519',
        classicalKex: 'X25519',
        symmetric: 'AES-256-GCM',
        hash: 'SHA-384',
        pqSig: device.pqAlg,
        pqKex: device.pqAlg
      },
      issuer: {
        deviceId: device.deviceId,
        classicalPub: device.classicalPub,
        pqPub: device.pqPub,
        pqAlg: device.pqAlg
      },
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + ttl * 1000).toISOString(),
      nonce: b64uEncode(crypto.getRandomValues(new Uint8Array(16))),
      payloadHash: await payloadDigest(payload),
      payload
    };
    const signed = TEXT.encode(canonicalize(header));
    const classicalSig = await classicalSign(device.classicalPrivJwk, signed);
    return {
      ...header,
      sig: { classical: classicalSig, pq: null, pqAlg: device.pqAlg, pqIsReal: false }
    };
  }

  // ── worker calls ──────────────────────────────────────────────────────────

  async function fetchPolicy() {
    const base = apiBase();
    if (!base) throw new Error('OST_API_BASE is not configured.');
    const r = await fetch(base.replace(/\/$/, '') + '/ghost/pq/policy', { headers: { accept: 'application/json' } });
    return r.json();
  }

  async function enroll({ token, label } = {}) {
    const base = apiBase();
    if (!base) throw new Error('OST_API_BASE is not configured.');
    if (!token) throw new Error('Operator enrollment token required.');
    const device = await ensureDevice(label);
    const r = await fetch(base.replace(/\/$/, '') + '/ghost/pq/enroll', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': 'Bearer ' + String(token).trim()
      },
      body: JSON.stringify({
        deviceId: device.deviceId,
        label: device.label,
        classicalPub: device.classicalPub,
        pqPub: device.pqPub,
        pqAlg: device.pqAlg
      })
    });
    return r.json();
  }

  async function verifyEnvelope(envelope) {
    const base = apiBase();
    if (!base) throw new Error('OST_API_BASE is not configured.');
    const r = await fetch(base.replace(/\/$/, '') + '/ghost/pq/envelope/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ envelope })
    });
    return r.json();
  }

  // ── tiny UI ───────────────────────────────────────────────────────────────

  function el(id) { return document.getElementById(id); }

  function renderStatus(text, tone) {
    const status = el('ghostPqStatus');
    if (!status) return;
    status.textContent = text || '';
    status.style.color = tone === 'success' ? '#86efac' :
                         tone === 'error'   ? '#fca5a5' :
                         tone === 'warning' ? '#fde68a' : '#cbd5e1';
  }

  function renderDevice(record) {
    const out = el('ghostPqDevice');
    if (!out) return;
    if (!record) { out.textContent = 'No device generated yet.'; return; }
    out.textContent = JSON.stringify({
      deviceId: record.deviceId,
      label: record.label,
      classicalAlg: record.classicalAlg,
      classicalPub: record.classicalPub,
      pqAlg: record.pqAlg,
      pqPub: record.pqPub,
      createdAt: record.createdAt
    }, null, 2);
  }

  function renderEnvelope(envelope) {
    const out = el('ghostPqEnvelope');
    if (out) out.textContent = envelope ? JSON.stringify(envelope, null, 2) : '';
  }

  function renderVerify(result) {
    const out = el('ghostPqVerify');
    if (out) out.textContent = result ? JSON.stringify(result, null, 2) : '';
  }

  function bindUi() {
    const generateBtn = el('ghostPqGenerateBtn');
    const enrollBtn = el('ghostPqEnrollBtn');
    const signBtn = el('ghostPqSignBtn');
    const verifyBtn = el('ghostPqVerifyBtn');
    const policyBtn = el('ghostPqPolicyBtn');
    const resetBtn = el('ghostPqResetBtn');
    if (!generateBtn) return;

    renderDevice(loadDevice());

    generateBtn.addEventListener('click', async () => {
      try {
        const label = (el('ghostPqLabel')?.value || '').trim() || 'OST Ghost browser device';
        const record = await generateDevice(label);
        renderDevice(record);
        renderStatus('Device key generated. Persisted locally only.', 'success');
      } catch (e) {
        renderStatus('Generate failed: ' + (e?.message || e), 'error');
      }
    });

    enrollBtn.addEventListener('click', async () => {
      const token = (el('ghostPqToken')?.value || '').trim();
      if (!token) { renderStatus('Enter the operator GHOST_ENROLL_TOKEN first.', 'warning'); return; }
      try {
        renderStatus('Enrolling device with the worker...', 'warning');
        const result = await enroll({ token });
        renderVerify(result);
        renderStatus(result.ok ? 'Device enrolled.' : 'Enrollment rejected.', result.ok ? 'success' : 'error');
      } catch (e) {
        renderStatus('Enroll failed: ' + (e?.message || e), 'error');
      }
    });

    signBtn.addEventListener('click', async () => {
      const message = (el('ghostPqMessage')?.value || '').trim() || 'Hello from the Ghost mesh.';
      try {
        const envelope = await buildEnvelope({ kind: 'ghost.message', message });
        renderEnvelope(envelope);
        renderStatus('Envelope signed locally with Ed25519 (PQ slot reserved).', 'success');
      } catch (e) {
        renderStatus('Sign failed: ' + (e?.message || e), 'error');
      }
    });

    verifyBtn.addEventListener('click', async () => {
      const text = (el('ghostPqEnvelope')?.textContent || '').trim();
      if (!text) { renderStatus('Sign an envelope first.', 'warning'); return; }
      try {
        const envelope = JSON.parse(text);
        const result = await verifyEnvelope(envelope);
        renderVerify(result);
        renderStatus(result.ok ? 'Envelope verified by worker.' : 'Worker rejected envelope.', result.ok ? 'success' : 'error');
      } catch (e) {
        renderStatus('Verify failed: ' + (e?.message || e), 'error');
      }
    });

    policyBtn.addEventListener('click', async () => {
      try {
        const policy = await fetchPolicy();
        renderVerify(policy);
        renderStatus('Loaded current PQ policy from worker.', 'success');
      } catch (e) {
        renderStatus('Policy fetch failed: ' + (e?.message || e), 'error');
      }
    });

    resetBtn.addEventListener('click', () => {
      clearDevice();
      renderDevice(null);
      renderEnvelope(null);
      renderVerify(null);
      renderStatus('Local device wiped. Generate a new one to enroll again.', 'warning');
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindUi);
  } else {
    bindUi();
  }

  window.OST_GHOST_PQ = {
    ENVELOPE_VERSION,
    loadDevice,
    generateDevice,
    ensureDevice,
    clearDevice,
    buildEnvelope,
    enroll,
    verifyEnvelope,
    fetchPolicy,
    canonicalize,
    payloadDigest
  };
})();

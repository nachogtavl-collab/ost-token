/**
 * ghost-crypto.js
 * --------------------------------------------------------------------
 * Crypto-agile primitives and envelope schema for the OST Ghost mesh.
 *
 * Goals:
 *   1. Hybrid-ready: every envelope carries a classical signature plus a
 *      post-quantum signature slot. During Phase 1 the PQ slot may be
 *      a structural placeholder; a real ML-DSA / SLH-DSA backend can be
 *      registered later via `registerPqAdapter()` without changing the
 *      envelope schema or any caller.
 *   2. Versioned: envelopes carry { v, algSet } so we can rotate
 *      algorithms without breaking older mesh peers.
 *   3. Deterministic canonical hashing so signatures are reproducible
 *      across Workers, browsers, and any future native client.
 *
 * Classical primitives use WebCrypto (Ed25519, X25519, AES-256-GCM,
 * SHA-384). All raw key material is base64url so the envelope is JSON-safe.
 */

const ENVELOPE_VERSION = 1;

const DEFAULT_ALG_SET = {
  classicalSig: 'Ed25519',
  classicalKex: 'X25519',
  symmetric: 'AES-256-GCM',
  hash: 'SHA-384',
  pqSig: 'placeholder',   // upgradeable to 'ML-DSA-65' when a backend is registered
  pqKex: 'placeholder'    // upgradeable to 'ML-KEM-768'
};

// ── base64url helpers ────────────────────────────────────────────────────────

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

// ── canonical JSON (stable key order, no whitespace) ─────────────────────────

function canonicalize(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalize).join(',') + ']';
  }
  const keys = Object.keys(value).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + canonicalize(value[k])).join(',') + '}';
}

const textEncoder = new TextEncoder();

async function sha384(bytes) {
  const buf = bytes instanceof Uint8Array ? bytes : textEncoder.encode(String(bytes));
  const digest = await crypto.subtle.digest('SHA-384', buf);
  return new Uint8Array(digest);
}

async function payloadDigest(payload) {
  const canonical = canonicalize(payload);
  const digest = await sha384(textEncoder.encode(canonical));
  return 'sha384:' + b64uEncode(digest);
}

// ── classical (Ed25519 + X25519) ─────────────────────────────────────────────

async function generateClassicalSigKey() {
  const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const priv = await crypto.subtle.exportKey('jwk', pair.privateKey);
  return {
    alg: 'Ed25519',
    publicKey: b64uEncode(pub),
    privateKeyJwk: priv
  };
}

async function importClassicalPublicKey(b64u) {
  return crypto.subtle.importKey(
    'raw',
    b64uDecode(b64u),
    { name: 'Ed25519' },
    true,
    ['verify']
  );
}

async function importClassicalPrivateKey(jwk) {
  return crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'Ed25519' },
    true,
    ['sign']
  );
}

async function classicalSign(privJwk, dataBytes) {
  const key = await importClassicalPrivateKey(privJwk);
  const sig = await crypto.subtle.sign({ name: 'Ed25519' }, key, dataBytes);
  return b64uEncode(new Uint8Array(sig));
}

async function classicalVerify(pubKeyB64u, dataBytes, sigB64u) {
  try {
    const key = await importClassicalPublicKey(pubKeyB64u);
    return await crypto.subtle.verify(
      { name: 'Ed25519' },
      key,
      b64uDecode(sigB64u),
      dataBytes
    );
  } catch (_) {
    return false;
  }
}

// ── pluggable PQ adapter ─────────────────────────────────────────────────────
//
// Default adapter is a STRUCTURAL PLACEHOLDER. It produces a deterministic
// SHA-384 tag binding the device's pq public key and the payload digest.
// This is NOT post-quantum security — it only keeps the envelope schema
// stable so callers can ship today and a real ML-DSA / SLH-DSA backend can
// be plugged in later via `registerPqAdapter()` without changing any code
// that touches envelopes.
//
// A real adapter must implement:
//   { alg, generateKey(): {alg, publicKey, privateKey},
//     sign(privateKey, dataBytes): string,
//     verify(publicKey, dataBytes, sig): boolean,
//     isReal: true }

let pqAdapter = {
  alg: 'placeholder',
  isReal: false,
  async generateKey() {
    const seed = crypto.getRandomValues(new Uint8Array(32));
    return {
      alg: 'placeholder',
      publicKey: b64uEncode(seed),
      privateKey: b64uEncode(seed)
    };
  },
  async sign(privateKey, dataBytes) {
    const tag = await sha384(concat(b64uDecode(privateKey), dataBytes));
    return b64uEncode(tag);
  },
  async verify(publicKey, dataBytes, sig) {
    // Placeholder cannot verify cross-device since pub == priv-seed locally.
    // Returns false on purpose so policy code knows the envelope is
    // classical-only until a real PQ backend is registered.
    return false;
  }
};

function registerPqAdapter(adapter) {
  if (!adapter || typeof adapter.sign !== 'function' || typeof adapter.verify !== 'function') {
    throw new Error('invalid pq adapter');
  }
  pqAdapter = adapter;
  return pqAdapter.alg;
}

function getPqAdapter() {
  return pqAdapter;
}

function concat(a, b) {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

// ── envelope ─────────────────────────────────────────────────────────────────
//
// Envelope shape:
// {
//   v: 1,
//   algSet: {...},
//   issuer: { deviceId, classicalPub, pqPub, pqAlg },
//   createdAt, expiresAt,
//   nonce,
//   payloadHash: "sha384:...",
//   payload: <user JSON>,
//   sig: { classical: "...", pq: "...", pqAlg: "..." }
// }

async function buildEnvelope({
  payload,
  issuer,                  // { deviceId, classicalPub, pqPub, pqAlg }
  classicalPrivateJwk,
  pqPrivateKey,
  ttlSeconds = 300
}) {
  if (!issuer || !issuer.deviceId || !issuer.classicalPub) {
    throw new Error('issuer.deviceId and issuer.classicalPub are required');
  }
  const now = Date.now();
  const algSet = { ...DEFAULT_ALG_SET, pqSig: pqAdapter.alg };
  const header = {
    v: ENVELOPE_VERSION,
    algSet,
    issuer: {
      deviceId: String(issuer.deviceId),
      classicalPub: issuer.classicalPub,
      pqPub: issuer.pqPub || null,
      pqAlg: issuer.pqAlg || pqAdapter.alg
    },
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + ttlSeconds * 1000).toISOString(),
    nonce: b64uEncode(crypto.getRandomValues(new Uint8Array(16))),
    payloadHash: await payloadDigest(payload),
    payload
  };
  const signedBytes = textEncoder.encode(canonicalize(header));
  const classicalSig = classicalPrivateJwk
    ? await classicalSign(classicalPrivateJwk, signedBytes)
    : null;
  const pqSig = pqPrivateKey
    ? await pqAdapter.sign(pqPrivateKey, signedBytes)
    : null;
  return {
    ...header,
    sig: {
      classical: classicalSig,
      pq: pqSig,
      pqAlg: pqAdapter.alg,
      pqIsReal: !!pqAdapter.isReal
    }
  };
}

async function verifyEnvelope(envelope, opts = {}) {
  const result = {
    ok: false,
    classicalOk: false,
    pqOk: false,
    pqIsReal: false,
    expired: false,
    payloadHashOk: false,
    reasons: []
  };
  if (!envelope || typeof envelope !== 'object') {
    result.reasons.push('envelope_missing');
    return result;
  }
  if (envelope.v !== ENVELOPE_VERSION) {
    result.reasons.push('unsupported_version');
    return result;
  }
  const expiresAt = Date.parse(envelope.expiresAt || '');
  if (Number.isFinite(expiresAt) && Date.now() > expiresAt) {
    result.expired = true;
    result.reasons.push('expired');
  }
  // Recompute payload hash
  const recomputed = await payloadDigest(envelope.payload);
  result.payloadHashOk = recomputed === envelope.payloadHash;
  if (!result.payloadHashOk) result.reasons.push('payload_hash_mismatch');

  const { sig, ...header } = envelope;
  const signedBytes = textEncoder.encode(canonicalize(header));

  if (sig && sig.classical && envelope.issuer && envelope.issuer.classicalPub) {
    result.classicalOk = await classicalVerify(envelope.issuer.classicalPub, signedBytes, sig.classical);
    if (!result.classicalOk) result.reasons.push('classical_signature_invalid');
  } else {
    result.reasons.push('classical_signature_missing');
  }

  if (sig && sig.pq && envelope.issuer && envelope.issuer.pqPub) {
    try {
      result.pqOk = await pqAdapter.verify(envelope.issuer.pqPub, signedBytes, sig.pq);
    } catch (_) {
      result.pqOk = false;
    }
    result.pqIsReal = !!pqAdapter.isReal;
    if (!result.pqOk && pqAdapter.isReal) result.reasons.push('pq_signature_invalid');
  }

  // Policy: in transitional mode (placeholder pq), classical+payloadHash is sufficient.
  // Once a real PQ adapter is registered, both must pass unless caller opts in
  // to classical-only via opts.allowClassicalOnly.
  if (pqAdapter.isReal && !opts.allowClassicalOnly) {
    result.ok = result.classicalOk && result.pqOk && result.payloadHashOk && !result.expired;
  } else {
    result.ok = result.classicalOk && result.payloadHashOk && !result.expired;
  }
  return result;
}

function describePolicy() {
  return {
    envelopeVersion: ENVELOPE_VERSION,
    algSet: { ...DEFAULT_ALG_SET, pqSig: pqAdapter.alg, pqKex: pqAdapter.alg },
    pqBackend: {
      alg: pqAdapter.alg,
      isReal: !!pqAdapter.isReal
    },
    notes: [
      'Phase 1: hybrid-ready envelope with real Ed25519 classical signatures.',
      'PQ slot is a structural placeholder until an ML-DSA / SLH-DSA adapter is registered.',
      'Verification accepts classical-only while the placeholder is active and requires both signatures once a real PQ adapter is loaded.'
    ]
  };
}

export {
  ENVELOPE_VERSION,
  DEFAULT_ALG_SET,
  b64uEncode,
  b64uDecode,
  canonicalize,
  payloadDigest,
  generateClassicalSigKey,
  classicalSign,
  classicalVerify,
  registerPqAdapter,
  getPqAdapter,
  buildEnvelope,
  verifyEnvelope,
  describePolicy
};

/* ============================================================
   mesh/mesh-crypto.js — Hybrid PQ-ready crypto for OST Mesh
   ----
   Phase 1 (today, browser-native, no extra deps):
     • Key agreement: ECDH P-384 (≈192-bit classical / quantum-vulnerable)
     • Symmetric:      AES-256-GCM (Grover-resistant at 128-bit PQ level)
     • Signatures:     ECDSA P-384 + SHA-384
   Phase 2 (when Kyber/Dilithium WASM lands on the CDN):
     • Wrap shared secret in Kyber-768 KEM (true PQ KEX)
     • Add Dilithium-3 signature alongside ECDSA
   We DO NOT lie about PQ today — the API is hybrid-shaped so the
   Kyber/Dilithium upgrade is a drop-in later.
   ============================================================ */

const SUBTLE = (globalThis.crypto && globalThis.crypto.subtle) || null;
const enc = new TextEncoder();
const dec = new TextDecoder();

function b64(buf) {
  const u = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
  return btoa(s);
}
function unb64(str) {
  const bin = atob(str);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}

export async function generateIdentity() {
  if (!SUBTLE) throw new Error('WebCrypto unavailable');
  const kex = await SUBTLE.generateKey(
    { name: 'ECDH', namedCurve: 'P-384' },
    true,
    ['deriveKey', 'deriveBits']
  );
  const sig = await SUBTLE.generateKey(
    { name: 'ECDSA', namedCurve: 'P-384' },
    true,
    ['sign', 'verify']
  );
  return { kex, sig };
}

export async function exportPublicBundle(identity) {
  const kexPub = await SUBTLE.exportKey('jwk', identity.kex.publicKey);
  const sigPub = await SUBTLE.exportKey('jwk', identity.sig.publicKey);
  return {
    v: 1,
    suite: 'ECDH-P384+ECDSA-P384+AES-256-GCM',
    pq: 'phase1-hybrid-ready',
    kex: kexPub,
    sig: sigPub,
    ts: Date.now()
  };
}

export async function importPeerBundle(bundle) {
  if (!bundle || bundle.v !== 1) throw new Error('bad bundle');
  const kexPub = await SUBTLE.importKey(
    'jwk', bundle.kex,
    { name: 'ECDH', namedCurve: 'P-384' },
    true, []
  );
  const sigPub = await SUBTLE.importKey(
    'jwk', bundle.sig,
    { name: 'ECDSA', namedCurve: 'P-384' },
    true, ['verify']
  );
  return { kexPub, sigPub, suite: bundle.suite };
}

/** Derive a 256-bit AES-GCM session key from local private + remote public. */
export async function deriveSessionKey(myIdentity, peerKexPub) {
  const aes = await SUBTLE.deriveKey(
    { name: 'ECDH', public: peerKexPub },
    myIdentity.kex.privateKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
  return aes;
}

export async function signBytes(identity, bytes) {
  const sig = await SUBTLE.sign(
    { name: 'ECDSA', hash: 'SHA-384' },
    identity.sig.privateKey,
    bytes
  );
  return new Uint8Array(sig);
}

export async function verifyBytes(peerSigPub, bytes, signature) {
  return SUBTLE.verify(
    { name: 'ECDSA', hash: 'SHA-384' },
    peerSigPub,
    signature,
    bytes
  );
}

/** Encrypt a JSON-serializable payload with the session key. */
export async function sealPayload(sessionKey, payload) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = enc.encode(JSON.stringify(payload));
  const ct = await SUBTLE.encrypt({ name: 'AES-GCM', iv }, sessionKey, data);
  return {
    v: 1,
    iv: b64(iv),
    ct: b64(ct)
  };
}

export async function openPayload(sessionKey, sealed) {
  const iv = unb64(sealed.iv);
  const ct = unb64(sealed.ct);
  const pt = await SUBTLE.decrypt({ name: 'AES-GCM', iv }, sessionKey, ct);
  return JSON.parse(dec.decode(pt));
}

/** Encrypt arbitrary binary (for media chunks). */
export async function sealBytes(sessionKey, bytes) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await SUBTLE.encrypt({ name: 'AES-GCM', iv }, sessionKey, bytes);
  const out = new Uint8Array(12 + ct.byteLength);
  out.set(iv, 0);
  out.set(new Uint8Array(ct), 12);
  return out;
}

export async function openBytes(sessionKey, sealed) {
  const iv = sealed.slice(0, 12);
  const ct = sealed.slice(12);
  const pt = await SUBTLE.decrypt({ name: 'AES-GCM', iv }, sessionKey, ct);
  return new Uint8Array(pt);
}

/** Stable short fingerprint (16 chars) for a public bundle — for safety codes. */
export async function fingerprint(bundle) {
  const buf = enc.encode(JSON.stringify(bundle.kex) + JSON.stringify(bundle.sig));
  const hash = await SUBTLE.digest('SHA-256', buf);
  const hex = Array.from(new Uint8Array(hash))
    .slice(0, 8)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return hex.match(/.{1,4}/g).join('-');
}

export const __crypto_test_helpers = { b64, unb64 };

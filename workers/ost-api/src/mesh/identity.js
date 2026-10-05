/* workers/ost-api/src/mesh/identity.js
  KV FALLBACK for /mesh/v1/identity/announce + lookup — used only when the
  MESH_HUB Durable Object is not bound (never in production; see
  mesh/index.js). The live directory is MeshHub.announce()/lookup() in hub.js.

  Same binding rule as the hub: the first keys announced for an address own it
  for good. mesh:idpin:<addr> (no TTL) keeps the key fingerprint after the
  7-day record expires; the same keys refresh the record, different keys get
  409 identity_locked: key_mismatch.
*/

const KEY_PREFIX = 'mesh:id:';
const PIN_PREFIX = 'mesh:idpin:';
const TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

function isAddress(addr) {
  // Same shape the hub accepts: 'ost-mesh:' + hex groups joined by '-'.
  return typeof addr === 'string'
      && addr.length <= 80
      && /^ost-mesh:[0-9a-f]{2,}(?:-[0-9a-f]{1,4})*$/i.test(addr);
}

// Fingerprint of the key material (x/y of both P-384 public JWKs); '' if the
// bundle is not two public EC keys.
async function keyFp(bundle) {
  const pub = (k) => (k && typeof k === 'object' && k.kty === 'EC' && k.crv === 'P-384' && k.d === undefined
    && typeof k.x === 'string' && typeof k.y === 'string' && /^[A-Za-z0-9_-]{40,90}$/.test(k.x) && /^[A-Za-z0-9_-]{40,90}$/.test(k.y)) ? k.x + '.' + k.y : '';
  const kex = pub(bundle && bundle.kex), sig = pub(bundle && bundle.sig);
  if (!kex || !sig) return '';
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('OST-MESH-PIN|v1|' + kex + '|' + sig));
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function identityAnnounce(env, body, ok, err) {
  const { address, bundle, fingerprint } = body || {};
  if (!isAddress(address))     return err('bad address');
  if (!bundle || bundle.v !== 1) return err('bad bundle');
  if (!bundle.kex || !bundle.sig) return err('missing keys');
  const fp = await keyFp(bundle);
  if (!fp) return err('bad keys');
  let pinned = null;
  try { pinned = await env.OST_KV.get(PIN_PREFIX + address); } catch { return err('directory_unavailable', 503); }
  if (!pinned) {
    // Records written before the pin existed are the binding until pinned.
    let prev = null;
    try { const raw = await env.OST_KV.get(KEY_PREFIX + address); prev = raw ? JSON.parse(raw) : null; } catch { prev = null; }
    const prevFp = prev && prev.bundle ? await keyFp(prev.bundle) : '';
    if (prevFp && prevFp !== fp) pinned = prevFp;
  }
  if (pinned && pinned !== fp) {
    return err('identity_locked: key_mismatch — this address is bound to a different key bundle and cannot be re-bound', 409);
  }
  const record = {
    address,
    bundle,
    fingerprint: typeof fingerprint === 'string' ? fingerprint.slice(0, 80) : null,
    ts: Date.now()
  };
  if (!pinned) await env.OST_KV.put(PIN_PREFIX + address, fp);   // permanent: no expirationTtl
  await env.OST_KV.put(KEY_PREFIX + address, JSON.stringify(record), {
    expirationTtl: TTL_SECONDS
  });
  return ok({ ok: true, address, ts: record.ts });
}

export async function identityLookup(env, address, ok, err) {
  if (!isAddress(address)) return err('bad address');
  const raw = await env.OST_KV.get(KEY_PREFIX + address);
  if (!raw) return err('not found', 404);
  try {
    const record = JSON.parse(raw);
    return ok(record);
  } catch {
    return err('corrupt record', 500);
  }
}

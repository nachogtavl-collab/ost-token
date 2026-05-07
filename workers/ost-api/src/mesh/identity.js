/* workers/ost-api/src/mesh/identity.js */

const KEY_PREFIX = 'mesh:id:';
const TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

function isAddress(addr) {
  return typeof addr === 'string'
      && addr.startsWith('ost-mesh:')
      && addr.length <= 80;
}

export async function identityAnnounce(env, body, ok, err) {
  const { address, bundle, fingerprint } = body || {};
  if (!isAddress(address))     return err('bad address');
  if (!bundle || bundle.v !== 1) return err('bad bundle');
  if (!bundle.kex || !bundle.sig) return err('missing keys');
  const record = {
    address,
    bundle,
    fingerprint: fingerprint || null,
    ts: Date.now()
  };
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

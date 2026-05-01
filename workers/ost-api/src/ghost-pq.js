/**
 * ghost-pq.js
 * --------------------------------------------------------------------
 * Post-quantum-ready control plane for the Ghost mesh.
 *
 * Endpoints (all under /ghost/pq/*):
 *
 *   GET  /ghost/pq/policy
 *     Returns the active crypto policy: envelope version, algorithm set,
 *     and whether a real PQ backend is registered.
 *
 *   POST /ghost/pq/enroll
 *     Authorized device enrollment. Requires header
 *       Authorization: Bearer <env.GHOST_ENROLL_TOKEN>
 *     Body: { deviceId, label?, classicalPub, pqPub?, pqAlg? }
 *
 *   GET  /ghost/pq/devices
 *     Lists enrolled devices (public keys + metadata, no secrets).
 *     Requires the same bearer token.
 *
 *   GET  /ghost/pq/devices/:id
 *     Single device record.
 *
 *   POST /ghost/pq/envelope/verify
 *     Body: { envelope }. Verifies the envelope against the issuer's
 *     enrolled keys and returns a structured verdict.
 *
 * Storage uses the existing OST_KV namespace (keys: pq:device:<id>,
 * pq:devices:index).
 */

import {
  describePolicy,
  verifyEnvelope
} from './ghost-crypto.js';

const PQ_CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type, accept, authorization, x-ost-wallet',
  'Access-Control-Max-Age': '86400'
};

const DEVICE_TTL_SECONDS = 60 * 60 * 24 * 365; // 1 year, callers can re-enroll
const DEVICE_INDEX_KEY = 'pq:devices:index';
const MAX_DEVICES = 200;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...PQ_CORS_HEADERS
    }
  });
}

async function readJson(request) {
  try { return await request.json(); }
  catch (_) { return {}; }
}

async function kvGet(env, key, fallback = null) {
  if (!env || !env.OST_KV) return fallback;
  try {
    const value = await env.OST_KV.get(key, { type: 'json' });
    return value ?? fallback;
  } catch (_) { return fallback; }
}

async function kvPut(env, key, value, ttl = null) {
  if (!env || !env.OST_KV) return false;
  try {
    const opts = Number.isFinite(Number(ttl)) && Number(ttl) > 0
      ? { expirationTtl: Number(ttl) }
      : undefined;
    await env.OST_KV.put(key, JSON.stringify(value), opts);
    return true;
  } catch (_) { return false; }
}

function authorized(request, env) {
  const expected = String(env && env.GHOST_ENROLL_TOKEN || '').trim();
  if (!expected) return false; // refuse to enroll if no token configured
  const got = String(request.headers.get('authorization') || '').trim();
  return got === `Bearer ${expected}`;
}

function cleanId(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 64);
}

function cleanLabel(value) {
  return String(value || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 120);
}

function cleanB64u(value, max = 4096) {
  const s = String(value || '').trim();
  if (!s) return '';
  if (!/^[-_A-Za-z0-9]+$/.test(s)) return '';
  if (s.length > max) return '';
  return s;
}

async function listDeviceIndex(env) {
  const index = await kvGet(env, DEVICE_INDEX_KEY, []);
  return Array.isArray(index) ? index : [];
}

async function saveDeviceIndex(env, index) {
  const trimmed = index.slice(-MAX_DEVICES);
  await kvPut(env, DEVICE_INDEX_KEY, trimmed, DEVICE_TTL_SECONDS);
}

async function recordDevice(env, device) {
  await kvPut(env, `pq:device:${device.deviceId}`, device, DEVICE_TTL_SECONDS);
  const index = await listDeviceIndex(env);
  const filtered = index.filter(entry => entry && entry.deviceId !== device.deviceId);
  filtered.push({
    deviceId: device.deviceId,
    label: device.label,
    enrolledAt: device.enrolledAt,
    pqAlg: device.pqAlg
  });
  await saveDeviceIndex(env, filtered);
}

async function getDevice(env, deviceId) {
  return kvGet(env, `pq:device:${cleanId(deviceId)}`, null);
}

// ── handlers ─────────────────────────────────────────────────────────────────

async function handlePolicy() {
  return json({
    ok: true,
    policy: describePolicy(),
    capabilities: {
      enroll: true,
      verifyEnvelope: true,
      hybridSignatures: true,
      crossDeviceMesh: true
    }
  });
}

async function handleEnroll(request, env) {
  if (!authorized(request, env)) {
    return json({
      ok: false,
      error: 'unauthorized',
      hint: 'Set GHOST_ENROLL_TOKEN secret on the worker, then send Authorization: Bearer <token>.'
    }, 401);
  }
  const body = await readJson(request);
  const deviceId = cleanId(body.deviceId);
  const classicalPub = cleanB64u(body.classicalPub, 256);
  const pqPub = cleanB64u(body.pqPub, 4096);
  const pqAlg = String(body.pqAlg || 'placeholder').slice(0, 32);
  const label = cleanLabel(body.label || deviceId);

  if (!deviceId) return json({ ok: false, error: 'invalid_device_id' }, 400);
  if (!classicalPub) return json({ ok: false, error: 'invalid_classical_pub' }, 400);

  const device = {
    deviceId,
    label,
    classicalPub,
    classicalAlg: 'Ed25519',
    pqPub: pqPub || null,
    pqAlg,
    enrolledAt: new Date().toISOString()
  };
  await recordDevice(env, device);
  return json({ ok: true, device });
}

async function handleListDevices(request, env) {
  if (!authorized(request, env)) {
    return json({ ok: false, error: 'unauthorized' }, 401);
  }
  const index = await listDeviceIndex(env);
  return json({ ok: true, count: index.length, devices: index });
}

async function handleGetDevice(env, deviceId) {
  const device = await getDevice(env, deviceId);
  if (!device) return json({ ok: false, error: 'not_found' }, 404);
  return json({ ok: true, device });
}

async function handleVerify(request, env) {
  const body = await readJson(request);
  const envelope = body && body.envelope;
  if (!envelope || typeof envelope !== 'object') {
    return json({ ok: false, error: 'envelope_required' }, 400);
  }
  const issuerId = envelope.issuer && cleanId(envelope.issuer.deviceId);
  if (!issuerId) {
    return json({ ok: false, error: 'envelope_missing_issuer' }, 400);
  }
  const device = await getDevice(env, issuerId);
  if (!device) {
    return json({ ok: false, error: 'issuer_not_enrolled', issuerId }, 404);
  }
  // Pin issuer keys to the enrolled record (defense against envelope-supplied keys).
  if (envelope.issuer.classicalPub !== device.classicalPub) {
    return json({
      ok: false,
      error: 'issuer_classical_key_mismatch',
      expected: device.classicalPub
    }, 400);
  }
  if (device.pqPub && envelope.issuer.pqPub && envelope.issuer.pqPub !== device.pqPub) {
    return json({
      ok: false,
      error: 'issuer_pq_key_mismatch',
      expected: device.pqPub
    }, 400);
  }
  const verdict = await verifyEnvelope(envelope, { allowClassicalOnly: !!body.allowClassicalOnly });
  return json({
    ok: verdict.ok,
    verdict,
    issuer: {
      deviceId: device.deviceId,
      label: device.label,
      pqAlg: device.pqAlg
    }
  });
}

// ── router entry ─────────────────────────────────────────────────────────────

export async function handleGhostPqRequest(request, env, ctx = {}) {
  const path = ctx.path || new URL(request.url).pathname.replace(/\/$/, '') || '/';
  const method = ctx.method || request.method;

  if (!path.startsWith('/ghost/pq')) return null;

  if (method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: PQ_CORS_HEADERS });
  }

  if (path === '/ghost/pq/policy' && method === 'GET') return handlePolicy();
  if (path === '/ghost/pq/enroll' && method === 'POST') return handleEnroll(request, env);
  if (path === '/ghost/pq/devices' && method === 'GET') return handleListDevices(request, env);
  if (path === '/ghost/pq/envelope/verify' && method === 'POST') return handleVerify(request, env);

  const deviceMatch = path.match(/^\/ghost\/pq\/devices\/([A-Za-z0-9._-]{1,64})$/);
  if (deviceMatch && method === 'GET') return handleGetDevice(env, deviceMatch[1]);

  return json({
    ok: false,
    error: 'unknown_pq_route',
    path,
    endpoints: [
      'GET  /ghost/pq/policy',
      'POST /ghost/pq/enroll        (Bearer GHOST_ENROLL_TOKEN)',
      'GET  /ghost/pq/devices       (Bearer GHOST_ENROLL_TOKEN)',
      'GET  /ghost/pq/devices/:id',
      'POST /ghost/pq/envelope/verify'
    ]
  }, 404);
}

export default handleGhostPqRequest;

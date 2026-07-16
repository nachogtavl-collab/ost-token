/* ==========================================================================
 * OST · Web Push — real device notifications
 * --------------------------------------------------------------------------
 * Before this, OST could not send a single notification to a closed app. There
 * was no VAPID key, so the client's pushReady() was permanently false, no
 * subscription could ever be created, and the `push` handler in sw.js was dead
 * code that had never fired once. The only notifications that worked were local
 * ones, which require the app to already be open — i.e. exactly when you do not
 * need a notification.
 *
 * WHY THERE IS NO ENCRYPTED PAYLOAD HERE
 * The Web Push spec lets you ship an encrypted body (ECDH → HKDF → aes128gcm).
 * We deliberately do not. That code is intricate, and when it is subtly wrong it
 * does not throw — the push just silently never arrives, which is the worst
 * possible failure mode for an alert system. A bare VAPID-authenticated push is
 * fully standard, and sw.js fetches the content when it wakes. That is simpler,
 * has no crypto to get wrong, and is strictly more correct: the notification
 * shows what is true NOW, not what was true when it was queued.
 *
 * WHY D1 AND NOT KV
 * KV on the free tier allows ~1,000 writes PER DAY PER ACCOUNT — shared with
 * everything else OST does. Subscriptions churn (every reinstall, every browser
 * data clear, every token refresh writes a row), so putting them in KV would burn
 * the entire account budget on bookkeeping. D1 has no such write ceiling.
 * ========================================================================== */

let PUSH_READY = false;

export async function pushEnsure(env) {
  if (PUSH_READY || !env.DB) return PUSH_READY;
  try {
    await env.DB.prepare(
      'CREATE TABLE IF NOT EXISTS push_subs (' +
      ' endpoint TEXT PRIMARY KEY,' +
      ' p256dh TEXT, auth TEXT,' +
      ' wallet TEXT,' +
      ' created_at INTEGER,' +
      ' fails INTEGER DEFAULT 0' +
      ')'
    ).run();
    await env.DB.prepare('CREATE INDEX IF NOT EXISTS push_subs_wallet ON push_subs (wallet)').run();
    // What a bare push means. The push itself carries no body (see header), so
    // the SW wakes and reads the newest row for its own endpoint. One row per
    // endpoint: a device that missed three alerts wants the CURRENT truth, not a
    // backlog of stale ones.
    await env.DB.prepare(
      'CREATE TABLE IF NOT EXISTS push_msgs (' +
      ' endpoint TEXT PRIMARY KEY, title TEXT, body TEXT, url TEXT, type TEXT, ts INTEGER' +
      ')'
    ).run();
    PUSH_READY = true;
  } catch (_) { /* caller degrades gracefully */ }
  return PUSH_READY;
}

/* ---- base64url ----------------------------------------------------------- */
function b64uToBytes(s) {
  const pad = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(pad + '==='.slice((pad.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64u(bytes) {
  let bin = '';
  const b = new Uint8Array(bytes);
  for (let i = 0; i < b.length; i++) bin += String.fromCharCode(b[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/* ---- VAPID --------------------------------------------------------------- */
// The signing key is rebuilt from two halves that live in different places on
// purpose: VAPID_PUBLIC is a plain var (it is published to every browser anyway)
// and VAPID_PRIVATE_D is a secret. A raw P-256 public key is 0x04 || x || y, so
// x and y are recoverable from the public half and only `d` must ever be secret.
async function signingKey(env) {
  const pub = b64uToBytes(String(env.VAPID_PUBLIC || ''));
  const d = String(env.VAPID_PRIVATE_D || '');
  if (pub.length !== 65 || pub[0] !== 0x04 || !d) return null;
  const jwk = {
    kty: 'EC',
    crv: 'P-256',
    x: bytesToB64u(pub.slice(1, 33)),
    y: bytesToB64u(pub.slice(33, 65)),
    d,
    ext: true
  };
  try {
    return await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  } catch (_) { return null; }
}

async function vapidAuth(env, endpoint) {
  const key = await signingKey(env);
  if (!key) return null;
  const aud = new URL(endpoint).origin;
  const header = bytesToB64u(new TextEncoder().encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const body = bytesToB64u(new TextEncoder().encode(JSON.stringify({
    aud,
    // 12h. The spec caps this at 24h; short-lived tokens limit the blast radius
    // if one is ever captured off the wire.
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: String(env.VAPID_SUBJECT || 'mailto:ost@ost-token.pages.dev')
  })));
  const signed = header + '.' + body;
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(signed)
  );
  // WebCrypto returns the raw r||s that JWS ES256 wants — no DER unwrapping.
  return 'vapid t=' + signed + '.' + bytesToB64u(sig) + ', k=' + String(env.VAPID_PUBLIC);
}

/* ---- send ---------------------------------------------------------------- */
// Returns { ok, status, gone } — `gone` means the subscription is permanently
// dead (uninstalled app, cleared data) and must be deleted, not retried.
export async function sendOne(env, endpoint) {
  const auth = await vapidAuth(env, endpoint);
  if (!auth) return { ok: false, status: 0, gone: false, error: 'vapid_unconfigured' };
  let res;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: auth,
        TTL: '600',                 // if undelivered in 10 min it is stale news
        'Content-Length': '0'       // bare push: no encrypted payload, by design
      }
    });
  } catch (e) {
    return { ok: false, status: 0, gone: false, error: String(e && e.message) };
  }
  // 404/410 are the push service telling us this endpoint is dead forever.
  const gone = res.status === 404 || res.status === 410;
  return { ok: res.status >= 200 && res.status < 300, status: res.status, gone };
}

export async function enqueue(env, endpoint, msg) {
  try {
    await env.DB.prepare(
      'INSERT INTO push_msgs (endpoint, title, body, url, type, ts) VALUES (?, ?, ?, ?, ?, ?) ' +
      'ON CONFLICT(endpoint) DO UPDATE SET title=excluded.title, body=excluded.body, url=excluded.url, type=excluded.type, ts=excluded.ts'
    ).bind(endpoint, String(msg.title || 'OST'), String(msg.body || ''), String(msg.url || './'), String(msg.type || 'system'), Date.now()).run();
  } catch (_) {}
}

export async function sendToWallet(env, wallet, msg = {}, limit = 200) {
  if (!(await pushEnsure(env))) return { sent: 0, error: 'db_unavailable' };
  const rows = await env.DB.prepare(
    'SELECT endpoint FROM push_subs WHERE wallet = ? LIMIT ?'
  ).bind(String(wallet), limit).all();
  const subs = (rows && rows.results) || [];
  let sent = 0;
  const dead = [];
  for (const s of subs) {
    await enqueue(env, s.endpoint, msg);
    const r = await sendOne(env, s.endpoint);
    if (r.ok) sent++;
    if (r.gone) dead.push(s.endpoint);
  }
  // Reap dead endpoints so the table cannot grow into a graveyard we re-POST to
  // forever on every send.
  for (const e of dead) {
    try { await env.DB.prepare('DELETE FROM push_subs WHERE endpoint = ?').bind(e).run(); } catch (_) {}
    try { await env.DB.prepare('DELETE FROM push_msgs WHERE endpoint = ?').bind(e).run(); } catch (_) {}
  }
  return { sent, dead: dead.length, total: subs.length };
}

/* ---- routes -------------------------------------------------------------- */
export async function handlePush(request, env, path, method, json) {
  if (path === '/push/key' && method === 'GET') {
    // Lets the client discover the key instead of us hardcoding it in two places
    // and eventually letting them drift apart.
    return json({ key: String(env.VAPID_PUBLIC || ''), ready: !!(env.VAPID_PUBLIC && env.VAPID_PRIVATE_D) });
  }

  if (path === '/push/subscribe' && method === 'POST') {
    if (!(await pushEnsure(env))) return json({ error: 'db_unavailable' }, 503);
    let body = {};
    try { body = await request.json(); } catch (_) {}
    const sub = body && body.subscription;
    const endpoint = sub && typeof sub.endpoint === 'string' ? sub.endpoint : '';
    // Only real push services. Without this the table becomes an open redirect
    // list: anyone could register any URL and make our worker POST to it on
    // every send — a free SSRF/DDoS amplifier signed with our own VAPID key.
    let host = '';
    try { host = new URL(endpoint).hostname; } catch (_) {}
    const allowed = /(^|\.)push\.services\.mozilla\.com$|(^|\.)fcm\.googleapis\.com$|(^|\.)android\.googleapis\.com$|(^|\.)notify\.windows\.com$|(^|\.)push\.apple\.com$|(^|\.)web\.push\.apple\.com$/i.test(host);
    if (!endpoint || !allowed) return json({ error: 'bad_endpoint' }, 400);

    const keys = (sub && sub.keys) || {};
    const wallet = typeof body.wallet === 'string' ? body.wallet.slice(0, 64) : '';
    try {
      await env.DB.prepare(
        'INSERT INTO push_subs (endpoint, p256dh, auth, wallet, created_at, fails) VALUES (?, ?, ?, ?, ?, 0) ' +
        'ON CONFLICT(endpoint) DO UPDATE SET wallet = excluded.wallet, p256dh = excluded.p256dh, auth = excluded.auth, fails = 0'
      ).bind(endpoint, String(keys.p256dh || ''), String(keys.auth || ''), wallet, Date.now()).run();
    } catch (e) {
      return json({ error: 'store_failed', detail: String(e && e.message).slice(0, 120) }, 500);
    }
    return json({ ok: true });
  }

  if (path === '/push/unsubscribe' && method === 'POST') {
    if (!(await pushEnsure(env))) return json({ error: 'db_unavailable' }, 503);
    let body = {};
    try { body = await request.json(); } catch (_) {}
    const endpoint = body && typeof body.endpoint === 'string' ? body.endpoint : '';
    if (!endpoint) return json({ error: 'no_endpoint' }, 400);
    try { await env.DB.prepare('DELETE FROM push_subs WHERE endpoint = ?').bind(endpoint).run(); } catch (_) {}
    return json({ ok: true });
  }

  if (path === '/push/pending' && method === 'GET') {
    // The SW calls this when it wakes from a bare push. An endpoint is an
    // unguessable capability URL, so holding one is the authorisation to read
    // its own message — no session needed, and nobody can read another device's.
    if (!(await pushEnsure(env))) return json({ error: 'db_unavailable' }, 503);
    const endpoint = new URL(request.url).searchParams.get('endpoint') || '';
    if (!endpoint) return json({ error: 'no_endpoint' }, 400);
    let row = null;
    try { row = await env.DB.prepare('SELECT title, body, url, type FROM push_msgs WHERE endpoint = ?').bind(endpoint).first(); } catch (_) {}
    return json(row || {});
  }

  if (path === '/push/test' && method === 'POST') {
    // Deliberately restricted to the caller's OWN endpoint. An endpoint is an
    // unguessable capability URL, so proving you hold one is proof enough to
    // ring that device — and it means this route can never be used to notify
    // somebody else, which an open "send to wallet X" route would allow.
    let body = {};
    try { body = await request.json(); } catch (_) {}
    const endpoint = body && typeof body.endpoint === 'string' ? body.endpoint : '';
    if (!endpoint) return json({ error: 'no_endpoint' }, 400);
    if (!(await pushEnsure(env))) return json({ error: 'db_unavailable' }, 503);
    const row = await env.DB.prepare('SELECT endpoint FROM push_subs WHERE endpoint = ?').bind(endpoint).first();
    if (!row) return json({ error: 'unknown_endpoint' }, 404);
    await enqueue(env, endpoint, { title: 'OST', body: 'Notifications are working on this device.', url: './', type: 'system' });
    const r = await sendOne(env, endpoint);
    if (r.gone) { try { await env.DB.prepare('DELETE FROM push_subs WHERE endpoint = ?').bind(endpoint).run(); } catch (_) {} }
    return json(r, r.ok ? 200 : 502);
  }

  return null;   // not a push route
}

/* ==========================================================================
   OST Wallet Auth — ONE primitive that proves who is calling (Phase 1)
   ----------------------------------------------------------------------------
   Every wallet-scoped mutation used to name its wallet in the body with no
   proof of ownership: anyone could bet, borrow, cash out or claim for anyone.
   This module verifies an ed25519 signature made by the wallet's own key over a
   canonical string that binds the request to the wallet, method, path, body,
   a timestamp (5-minute window) and a nonce (replay-guarded in PlayLedger):

     OST-AUTH|v1|<wallet>|<METHOD>|<path>|<sha256hex(body)>|<ts>|<nonce>

   Extension wallets (Phantom/Solflare) prompt on every signMessage, so they
   sign ONE challenge and receive a 12h SESSION TOKEN (HMAC) instead; session
   requests still carry ts + nonce so an identical POST cannot be replayed.

   Rollout: env.WALLET_AUTH_MODE = 'log' (verify, tag the response, never block)
   until the client ships; then 'enforce' (401 on missing/bad auth).
   Server-originated calls carrying x-ost-internal bypass this entirely.
   ========================================================================== */
import { PublicKey } from '@solana/web3.js';

const WINDOW_MS = 5 * 60 * 1000;
const SESSION_MS = 12 * 60 * 60 * 1000;

const enc = new TextEncoder();
async function sha256Hex(text) {
  const d = await crypto.subtle.digest('SHA-256', enc.encode(String(text || '')));
  return Array.from(new Uint8Array(d)).map(b => b.toString(16).padStart(2, '0')).join('');
}
function b64ToBytes(b64) {
  const s = String(b64 || '').replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function bytesToB64url(bytes) {
  let s = ''; for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

// Which requests must prove wallet ownership. Reads are open; mutations are not.
export function isProtectedPath(path, method) {
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return false;
  if (/^\/play\//.test(path)) return true;
  if (/^\/loans\//.test(path)) return true;
  if (/^\/faucet\/v1\/(reserve|commit|cancel)$/.test(path)) return true;
  if (path === '/wallet/payout' || path === '/wallet/ata-rent' || /^\/wallet\/cosign/.test(path)) return true;
  return false;
}

export function canonicalMessage({ wallet, method, path, bodyHash, ts, nonce }) {
  return `OST-AUTH|v1|${wallet}|${String(method).toUpperCase()}|${path}|${bodyHash}|${ts}|${nonce}`;
}
export function sessionChallenge({ wallet, ts, nonce }) {
  return `OST-SESSION|v1|${wallet}|${ts}|${nonce}`;
}

async function verifyEd25519(walletStr, message, sigB64) {
  let pub;
  try { pub = new PublicKey(walletStr).toBytes(); } catch (_) { return false; }
  let sig;
  try { sig = b64ToBytes(sigB64); } catch (_) { return false; }
  if (sig.length !== 64) return false;
  try {
    const key = await crypto.subtle.importKey('raw', pub, { name: 'Ed25519' }, false, ['verify']);
    return await crypto.subtle.verify('Ed25519', key, sig, enc.encode(message));
  } catch (_) { return false; }
}

async function hmacHex(secret, text) {
  const key = await crypto.subtle.importKey('raw', enc.encode(String(secret)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(text));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ── Session tokens (extension wallets sign once) ─────────────────────────
export async function issueSession(env, body) {
  const secret = env && env.INTERNAL_MUTATION_KEY;
  if (!secret) return { ok: false, error: 'auth_not_configured' };
  const wallet = String((body && body.wallet) || '').slice(0, 64);
  const ts = Number(body && body.ts), nonce = String((body && body.nonce) || '').slice(0, 64), sig = String((body && body.sig) || '');
  if (!wallet || !nonce || !Number.isFinite(ts)) return { ok: false, error: 'missing_fields' };
  if (Math.abs(Date.now() - ts) > WINDOW_MS) return { ok: false, error: 'stale_timestamp' };
  if (!(await verifyEd25519(wallet, sessionChallenge({ wallet, ts, nonce }), sig))) return { ok: false, error: 'bad_signature' };
  const exp = Date.now() + SESSION_MS;
  const payload = bytesToB64url(enc.encode(JSON.stringify({ w: wallet, exp, n: nonce.slice(0, 16) })));
  const mac = await hmacHex(secret, payload);
  return { ok: true, token: payload + '.' + mac, wallet, exp };
}
async function verifySession(env, token) {
  const secret = env && env.INTERNAL_MUTATION_KEY;
  if (!secret || !token) return null;
  const i = token.indexOf('.'); if (i < 0) return null;
  const payload = token.slice(0, i), mac = token.slice(i + 1);
  const expect = await hmacHex(secret, payload);
  if (!timingSafeEqual(expect, mac)) return null;
  let obj; try { obj = JSON.parse(new TextDecoder().decode(b64ToBytes(payload))); } catch (_) { return null; }
  if (!obj || !obj.w || !(Number(obj.exp) > Date.now())) return null;
  return obj.w;
}

// Replay guard lives in the PlayLedger DO (one global instance, its own storage).
async function nonceFresh(env, wallet, nonce, ts) {
  if (!env || !env.PLAY_LEDGER || !env.INTERNAL_MUTATION_KEY) return true;   // no guard available: allow (logged as via:*-noreplay)
  try {
    const pl = env.PLAY_LEDGER.get(env.PLAY_LEDGER.idFromName('global'));
    const r = await pl.fetch('https://play-ledger/play/auth-nonce', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-ost-internal': env.INTERNAL_MUTATION_KEY },
      body: JSON.stringify({ wallet, nonce, ts })
    });
    const j = await r.json().catch(() => null);
    return !!(j && j.ok);
  } catch (_) { return false; }
}

// Body must name the same wallet the caller proved (no acting on someone else's wallet).
function bodyWalletMatches(bodyText, wallet) {
  if (!bodyText) return true;
  let b; try { b = JSON.parse(bodyText); } catch (_) { return true; }   // non-JSON bodies: nothing to compare
  const named = [b.wallet, b.address, b.owner, b.trader].filter(x => typeof x === 'string' && x.length > 20);
  return named.every(x => x === wallet);
}

/** Verify a request. Returns { ok, wallet, via:'sig'|'session', reason }. Never throws. */
export async function verifyWalletAuth(request, env, bodyText, path, method) {
  const h = (n) => request.headers.get(n) || '';
  const wallet = h('x-ost-wallet'), ts = Number(h('x-ost-ts')), nonce = h('x-ost-nonce'), sig = h('x-ost-sig'), session = h('x-ost-session');
  if (!wallet) return { ok: false, reason: 'missing' };
  if (!nonce || !Number.isFinite(ts)) return { ok: false, reason: 'missing_ts_nonce' };
  if (Math.abs(Date.now() - ts) > WINDOW_MS) return { ok: false, reason: 'stale_timestamp' };
  if (!bodyWalletMatches(bodyText, wallet)) return { ok: false, reason: 'wallet_mismatch' };
  let via = '';
  if (session) {
    const w = await verifySession(env, session);
    if (!w || w !== wallet) return { ok: false, reason: 'bad_session' };
    via = 'session';
  } else {
    if (!sig) return { ok: false, reason: 'missing_sig' };
    const bodyHash = await sha256Hex(bodyText);
    const msg = canonicalMessage({ wallet, method, path, bodyHash, ts, nonce });
    if (!(await verifyEd25519(wallet, msg, sig))) return { ok: false, reason: 'bad_signature' };
    via = 'sig';
  }
  if (!(await nonceFresh(env, wallet, nonce, ts))) return { ok: false, reason: 'replay' };
  return { ok: true, wallet, via };
}

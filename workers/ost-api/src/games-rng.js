/* ==========================================================================
   OST Games — server-side commit-reveal RNG seed (Phase 0)
   ----------------------------------------------------------------------------
   docs/ost-games.js used to generate its "server" seed with
   crypto.getRandomValues() IN THE BROWSER, so a modified client could read
   pf.serverSeed before betting and predict every outcome. This module holds
   the seed server-side: it publishes only serverSeedHash before a round,
   computes the HMAC digest games need on request, and reveals the plaintext
   seed only after rotating to a new one.

   Game outcome logic (pfFloats' bit-slicing, every game's own math) is
   UNCHANGED and stays client-side — only the seed source moves here. See
   docs/ost-games.js pfFloats() for the consumer side.

   One GameSeedHub Durable Object instance per anonymous player id (see
   docs/ost-games.js deviceId — games have no wallet requirement).
   ========================================================================== */

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'content-type'
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: Object.assign({ 'content-type': 'application/json' }, CORS_HEADERS) });
}

function cleanText(value, max = 200) {
  return String(value == null ? '' : value).slice(0, max);
}
function cleanInt(value, fallback, min, max) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function bytesToHex(bytes) {
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}
function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}
function randomSeedHex() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}
async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return bytesToHex(new Uint8Array(digest));
}
async function hmacSha256Hex(keyHex, message) {
  const key = await crypto.subtle.importKey('raw', hexToBytes(keyHex), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return bytesToHex(new Uint8Array(sig));
}

const MAX_REVEALED_SEEDS = 20;
const MAX_ROUNDS_PER_DIGEST = 16; // largest game (Blackjack/Video Poker, 52 floats) needs 7

export class GameSeedHub {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    return this.state.blockConcurrencyWhile(() => this.handle(request));
  }

  async loadOrCreate() {
    let record = await this.state.storage.get('record');
    if (!record) {
      record = await this.freshEpoch(null);
      await this.state.storage.put('record', record);
    }
    return record;
  }

  async freshEpoch(prior) {
    const seed = randomSeedHex();
    const hash = await sha256Hex(seed);
    const revealedSeeds = (prior && prior.revealedSeeds) || [];
    return {
      epoch: prior ? prior.epoch + 1 : 1,
      serverSeed: seed,
      serverSeedHash: hash,
      lastNonce: 0,
      revealedSeeds
    };
  }

  async handle(request) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, '') || '/';
    const method = request.method;
    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });

    if (path === '/games/seed' && method === 'GET') {
      const record = await this.loadOrCreate();
      return json({ ok: true, serverSeedHash: record.serverSeedHash, epoch: record.epoch, nonce: record.lastNonce });
    }

    if (path === '/games/rotate' && method === 'POST') {
      const record = await this.loadOrCreate();
      const revealedSeed = record.serverSeed;
      const revealedHash = record.serverSeedHash;
      const next = await this.freshEpoch(record);
      next.revealedSeeds = [{ epoch: record.epoch, seed: revealedSeed, hash: revealedHash, revealedAt: Date.now() }]
        .concat(record.revealedSeeds)
        .slice(0, MAX_REVEALED_SEEDS);
      await this.state.storage.put('record', next);
      return json({ ok: true, revealedSeed, revealedHash, newServerSeedHash: next.serverSeedHash, epoch: next.epoch });
    }

    if (path === '/games/digest' && method === 'POST') {
      let body; try { body = await request.json(); } catch (_) { return json({ error: 'invalid_json' }, 400); }
      const clientSeed = cleanText(body && body.clientSeed, 128);
      const rounds = cleanInt(body && body.rounds, 1, 1, MAX_ROUNDS_PER_DIGEST);
      if (!clientSeed) return json({ error: 'missing_client_seed' }, 400);

      const record = await this.loadOrCreate();
      // Server-assigned, monotonic — the client's own nonce guess is never
      // trusted or even read. This is the whole replay defense: a modified
      // client cannot reuse or predict a future nonce, and every consumer
      // (pfFloats, the fairness verifier) must key off the nonce THIS
      // response returns, not a locally-tracked copy.
      const nonce = record.lastNonce + 1;
      record.lastNonce = nonce;
      await this.state.storage.put('record', record);

      const hex = [];
      for (let round = 0; round < rounds; round++) {
        hex.push(await hmacSha256Hex(record.serverSeed, clientSeed + ':' + nonce + ':' + round));
      }
      return json({ ok: true, nonce, epoch: record.epoch, hex });
    }

    return json({ error: 'unknown_games_endpoint', path }, 404);
  }
}

export function handleGamesRngRequest(request, env) {
  if (!env.GAME_SEED_HUB) return json({ error: 'game_seed_hub_not_configured' }, 503);
  const url = new URL(request.url);
  const player = cleanText(url.searchParams.get('player') || '', 80);
  // player also arrives in the POST body for /rotate and /digest — peek it
  // there without consuming the body twice by cloning the request.
  return resolvePlayerId(request, player).then(playerId => {
    if (!playerId) return json({ error: 'missing_player' }, 400);
    const id = env.GAME_SEED_HUB.idFromName(playerId);
    return env.GAME_SEED_HUB.get(id).fetch(request);
  });
}

async function resolvePlayerId(request, fromQuery) {
  if (fromQuery) return fromQuery;
  if (request.method !== 'POST') return '';
  try {
    const clone = request.clone();
    const body = await clone.json();
    return cleanText(body && body.player, 80);
  } catch (_) { return ''; }
}

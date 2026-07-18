/* ==========================================================================
 * OST · Play Games — SERVER-AUTHORITATIVE outcome functions
 * --------------------------------------------------------------------------
 * project-docs/PLAY-BALANCE.md, Phase 2 increment 3.
 *
 * The server computes every bet's outcome from its SECRET seed, AFTER the bet's
 * params are bound to a nonce — so a client can never choose params for an
 * outcome it already knows (the hole that killed the "batched validate" model),
 * and can never skip the house edge (it lives in the payout math here).
 *
 * The float derivation MUST match docs/ost-games.js pfFloats() byte-for-byte, or
 * the server would credit different outcomes than the client animates:
 *   hex   = HMAC-SHA256(serverSeed, clientSeed:nonce:round)   (hex string)
 *   float = parseInt(hex.substr(i, 8), 16) / 2^32             (8 hex chars each)
 * so the same seed+nonce is publicly re-derivable after the seed is revealed —
 * that is the provable-fairness half.
 * ========================================================================== */

function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}
function bytesToHex(bytes) {
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}
export async function hmacSha256Hex(keyHex, message) {
  const key = await crypto.subtle.importKey('raw', hexToBytes(keyHex), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return bytesToHex(new Uint8Array(sig));
}
export async function sha256Hex(text) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return bytesToHex(new Uint8Array(d));
}
export function randomSeedHex() {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return bytesToHex(b);
}

// Exactly docs/ost-games.js pfFloats(): concat per-round hex, slice 8 chars each.
function floatsFromHexes(hexes, count) {
  const floats = [];
  for (const hex of hexes) {
    let i = 0;
    while (floats.length < count && i + 8 <= hex.length) {
      floats.push(parseInt(hex.substr(i, 8), 16) / 4294967296);
      i += 8;
    }
  }
  return floats;
}
function round9(n) { return Math.round(Number(n) * 1e9) / 1e9; }

/* ---- the game registry -------------------------------------------------- *
 * Each game: floatsNeeded, validateParams(params)->err|null, and
 * outcome(params, floats) -> { detail..., payoutMult } where the payout is
 * wager * payoutMult (0 on a loss). The edge is baked into payoutMult.
 * Port one game at a time; limbo first.
 */
export const GAMES = {
  limbo: {
    floatsNeeded: 1,
    validateParams(params) {
      const target = Number(params && params.target);
      // 1% edge lives in the 99/(100*(1-f)) roll below; target is the player's
      // chosen win threshold. Bound it so payoutMult can't be absurd.
      if (!(target >= 1.01 && target <= 1000)) return 'target must be between 1.01 and 1000';
      return null;
    },
    outcome(params, floats) {
      const target = Number(params.target);
      // Matches docs/ost-games.js renderLimbo: rolled = max(1, 99/(100*(1-f))).
      const rolled = Math.max(1, 99 / (100 * (1 - floats[0])));
      const win = rolled >= target;
      return { rolled: round9(rolled), win, payoutMult: win ? target : 0 };
    },
  },

  // Matches docs/ost-games.js renderDice: roll = f*100; win under/over target;
  // multiplier = 99 / winChance (the 99 vs 100 is the 1% edge).
  dice: {
    floatsNeeded: 1,
    validateParams(params) {
      const target = Number(params && params.target);
      const dir = params && params.dir;
      if (!(target >= 2 && target <= 98)) return 'target must be between 2 and 98';
      if (dir !== 'under' && dir !== 'over') return "dir must be 'under' or 'over'";
      return null;
    },
    outcome(params, floats) {
      const target = Number(params.target);
      const dir = params.dir;
      const roll = floats[0] * 100;
      const win = dir === 'under' ? roll < target : roll > target;
      const chance = dir === 'under' ? target : (100 - target);
      const mult = chance > 0 ? 99 / chance : 0;
      return { roll: round9(roll), win, payoutMult: win ? mult : 0 };
    },
  },

  // Matches docs/ost-games.js coinflip: result = f<0.5 ? 'h':'t'; 1.98x on a hit
  // (the 1.98 vs 2.0 is the 1% edge).
  coinflip: {
    floatsNeeded: 1,
    validateParams(params) {
      const side = params && params.side;
      if (side !== 'h' && side !== 't') return "side must be 'h' or 't'";
      return null;
    },
    outcome(params, floats) {
      const result = floats[0] < 0.5 ? 'h' : 't';
      const win = result === params.side;
      return { result, win, payoutMult: win ? 1.98 : 0 };
    },
  },

  // Matches docs/ost-games.js "double": color from f thresholds (red<0.475,
  // black<0.95, else green). green=14x, red/black=2x. The client's lanes[] strip
  // is COSMETIC (which cell to highlight) — payout is purely `color`.
  double: {
    floatsNeeded: 1,
    validateParams(params) {
      const pick = params && params.pick;
      if (pick !== 'red' && pick !== 'black' && pick !== 'green') return "pick must be 'red', 'black' or 'green'";
      return null;
    },
    outcome(params, floats) {
      const f = floats[0];
      const color = f < 0.475 ? 'red' : f < 0.95 ? 'black' : 'green';
      const win = params.pick === color;
      return { color, win, payoutMult: win ? (color === 'green' ? 14 : 2) : 0 };
    },
  },

  // Matches docs/ost-games.js "slide": result = min(100, floor((0.99/f)*100)/100);
  // win if result >= target; payout target×.
  slide: {
    floatsNeeded: 1,
    validateParams(params) {
      const target = Number(params && params.target);
      if (!(target >= 1.01 && target <= 100)) return 'target must be between 1.01 and 100';
      return null;
    },
    outcome(params, floats) {
      const target = Number(params.target);
      const value = Math.max(0.000001, floats[0]);
      const result = Math.min(100, Math.floor((0.99 / value) * 100) / 100);
      const win = result >= target;
      return { result: round9(result), win, payoutMult: win ? target : 0 };
    },
  },
};

// Compute one bet's outcome from the secret seed. Pure + deterministic given
// (serverSeed, clientSeed, nonce, params). Returns the outcome detail + payout.
export async function computeBet(game, serverSeed, clientSeed, nonce, params, wager) {
  const g = GAMES[game];
  if (!g) throw new Error('unknown_game');
  const rounds = Math.max(1, Math.ceil(g.floatsNeeded / 8));
  const hexes = [];
  for (let r = 0; r < rounds; r++) hexes.push(await hmacSha256Hex(serverSeed, clientSeed + ':' + nonce + ':' + r));
  const floats = floatsFromHexes(hexes, g.floatsNeeded);
  const o = g.outcome(params, floats);
  const payout = round9(wager * o.payoutMult);
  return Object.assign({ nonce, payout }, o);
}

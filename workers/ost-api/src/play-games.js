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

// Exactly docs/ost-games.js KENO_TABLES (payout mult by picks -> hits).
const KENO_TABLES = {
  1: { 1: 3.8 },
  2: { 1: 1.2, 2: 10 },
  3: { 2: 2.2, 3: 45 },
  4: { 2: 1.5, 3: 6, 4: 110 },
  5: { 3: 3, 4: 18, 5: 450 },
  6: { 3: 1.6, 4: 8, 5: 90, 6: 1200 },
  7: { 3: 1.2, 4: 4, 5: 30, 6: 400, 7: 3000 },
  8: { 4: 3, 5: 12, 6: 150, 7: 1500, 8: 8000 },
  9: { 4: 2, 5: 8, 6: 70, 7: 600, 8: 4000, 9: 12000 },
  10: { 4: 1.4, 5: 5, 6: 40, 7: 400, 8: 2500, 9: 10000, 10: 25000 },
};

// Exactly docs/ost-games.js PLINKO_MULTS (bucket multipliers by rows -> risk).
const PLINKO_MULTS = {
  8: {
    low: [5.6, 2.1, 1.1, 1, 0.5, 1, 1.1, 2.1, 5.6],
    medium: [13, 3, 1.3, 0.7, 0.4, 0.7, 1.3, 3, 13],
    high: [29, 4, 1.5, 0.3, 0.2, 0.3, 1.5, 4, 29],
  },
  12: {
    low: [10, 3, 1.6, 1.4, 1.1, 1, 0.5, 1, 1.1, 1.4, 1.6, 3, 10],
    medium: [33, 11, 4, 2, 1.1, 0.6, 0.3, 0.6, 1.1, 2, 4, 11, 33],
    high: [170, 24, 8.1, 2, 0.7, 0.2, 0.2, 0.2, 0.7, 2, 8.1, 24, 170],
  },
  16: {
    low: [16, 9, 2, 1.4, 1.4, 1.2, 1.1, 1, 0.5, 1, 1.1, 1.2, 1.4, 1.4, 2, 9, 16],
    medium: [110, 41, 10, 5, 3, 1.5, 1, 0.5, 0.3, 0.5, 1, 1.5, 3, 5, 10, 41, 110],
    high: [1000, 130, 26, 9, 4, 2, 0.2, 0.2, 0.2, 0.2, 0.2, 2, 4, 9, 26, 130, 1000],
  },
};

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

  // Matches docs/ost-games.js WHEEL_SEGMENTS: landIdx = floor(f*30); mult = table.
  wheel: {
    floatsNeeded: 1,
    SEGMENTS: {
      low: [0, 1.2, 1.2, 1.5, 1.2, 0, 1.2, 2, 1.2, 0, 1.5, 1.2, 1.2, 0, 1.2, 1.5, 0, 1.2, 2, 1.2, 0, 1.2, 1.5, 1.2, 0, 1.2, 1.2, 1.5, 0, 1.2],
      medium: [0, 1.5, 0, 2, 0, 1.5, 0, 3, 0, 1.5, 0, 2, 0, 5, 0, 1.5, 0, 2, 0, 3, 0, 1.5, 0, 2, 0, 1.5, 0, 3, 0, 1.5],
      high: [0, 0, 0, 0, 4, 0, 0, 0, 0, 9, 0, 0, 0, 0, 4, 0, 0, 0, 0, 12, 0, 0, 0, 0, 4, 0, 0, 0, 0, 9],
    },
    validateParams(params) {
      const risk = params && params.risk;
      if (risk !== 'low' && risk !== 'medium' && risk !== 'high') return "risk must be 'low', 'medium' or 'high'";
      return null;
    },
    outcome(params, floats) {
      const segs = this.SEGMENTS[params.risk];
      const idx = Math.floor(floats[0] * segs.length);
      const mult = segs[Math.min(idx, segs.length - 1)];
      return { landIdx: idx, mult, win: mult > 0, payoutMult: mult };
    },
  },

  // Matches docs/ost-games.js "scarab": 9 floats -> 3x3 grid of 6 symbols; count
  // scarabs(idx0) + diamonds(idx3); multiplier by cluster; 'wild' pick ×1.35.
  scarab: {
    floatsNeeded: 9,
    validateParams(params) {
      const pick = params && params.pick;
      if (pick !== 'normal' && pick !== 'wild') return "pick must be 'normal' or 'wild'";
      return null;
    },
    outcome(params, floats) {
      // symbols = ['🪲','☀','🔺','💎','🌙','⚱'] → indices 0 = scarab, 3 = diamond.
      let scarabs = 0, diamonds = 0;
      for (let i = 0; i < 9; i++) {
        const s = Math.floor(floats[i] * 6);
        if (s === 0) scarabs++;
        else if (s === 3) diamonds++;
      }
      let mult = scarabs >= 6 ? 30 : scarabs >= 5 ? 12 : scarabs >= 4 ? 5 : scarabs >= 3 ? 2 : diamonds >= 4 ? 1.5 : 0;
      if (params.pick === 'wild' && mult > 0) mult = round9(mult * 1.35);
      return { scarabs, diamonds, mult, win: mult > 0, payoutMult: mult };
    },
  },

  // Matches docs/ost-games.js "diamonds": 5 gems from a 7-symbol set; group sizes
  // (desc) map to a multiplier. No pick.
  diamonds: {
    floatsNeeded: 5,
    validateParams() { return null; },
    outcome(_params, floats) {
      const counts = {};
      for (let i = 0; i < 5; i++) { const g = Math.floor(floats[i] * 7); counts[g] = (counts[g] || 0) + 1; }
      const groups = Object.values(counts).sort((a, b) => b - a);
      const g0 = groups[0], g1 = groups[1] || 0;
      const mult = g0 === 5 ? 50 : g0 === 4 ? 10 : (g0 === 3 && g1 === 2 ? 5 : g0 === 3 ? 2 : (g0 === 2 && g1 === 2 ? 1.2 : 0));
      return { groups, mult, win: mult > 0, payoutMult: mult };
    },
  },

  // Matches docs/ost-games.js "cases": 6 draws (3 player, 3 dealer) from a value
  // table by rarity thresholds; higher total wins 1.98x, tie 1x, else 0.
  cases: {
    floatsNeeded: 6,
    TABLES: {
      low: [1, 2, 5, 12],
      standard: [0.5, 3, 8, 25],
      high: [0.2, 4, 15, 60],
    },
    validateParams(params) {
      const pick = params && params.pick;
      if (pick !== 'low' && pick !== 'standard' && pick !== 'high') return "pick must be 'low', 'standard' or 'high'";
      return null;
    },
    outcome(params, floats) {
      const table = this.TABLES[params.pick];
      const draw = (v) => table[v < 0.56 ? 0 : v < 0.84 ? 1 : v < 0.97 ? 2 : 3];
      const playerTotal = draw(floats[0]) + draw(floats[1]) + draw(floats[2]);
      const dealerTotal = draw(floats[3]) + draw(floats[4]) + draw(floats[5]);
      const mult = playerTotal > dealerTotal ? 1.98 : (playerTotal === dealerTotal ? 1 : 0);
      return { playerTotal: round9(playerTotal), dealerTotal: round9(dealerTotal), mult, win: mult > 0, payoutMult: mult };
    },
  },

  // Matches docs/ost-games.js keno: Fisher-Yates shuffle 1..40 with 40 floats,
  // draw 10, count hits against the player's picks, KENO_TABLES[picks][hits].
  keno: {
    floatsNeeded: 40,
    validateParams(params) {
      const nums = params && params.numbers;
      if (!Array.isArray(nums) || nums.length < 1 || nums.length > 10) return 'numbers must be 1..10 picks';
      const seen = new Set();
      for (const n of nums) {
        if (!Number.isInteger(n) || n < 1 || n > 40) return 'each number must be an integer 1..40';
        if (seen.has(n)) return 'numbers must be distinct';
        seen.add(n);
      }
      if (!KENO_TABLES[nums.length]) return 'no payout table for that pick count';
      return null;
    },
    outcome(params, floats) {
      const selected = new Set(params.numbers);
      const arr = [];
      for (let i = 1; i <= 40; i++) arr.push(i);
      // Fisher-Yates exactly as shuffleWithFloats: floatIndex counts UP from 0 as
      // index counts DOWN; swap = floor(float * (index+1)).
      for (let index = arr.length - 1; index > 0; index--) {
        const floatIndex = arr.length - 1 - index;
        const swapIndex = Math.floor((floats[floatIndex] || 0) * (index + 1));
        const t = arr[index]; arr[index] = arr[swapIndex]; arr[swapIndex] = t;
      }
      const drawn = arr.slice(0, 10);
      let hits = 0;
      for (const d of drawn) if (selected.has(d)) hits++;
      const mult = KENO_TABLES[params.numbers.length][hits] || 0;
      return { hits, picks: params.numbers.length, mult, win: mult > 0, payoutMult: mult };
    },
  },

  // Matches docs/ost-games.js plinko: `rows` deflections, each float >= 0.5 goes
  // right; bucket = count of rights (0..rows); PLINKO_MULTS[rows][risk][bucket].
  // One ball = one bet/nonce; multi-ball is count>1.
  plinko: {
    floatsNeeded: (params) => Math.floor(Number(params && params.rows) || 0),
    validateParams(params) {
      const rows = Number(params && params.rows);
      const risk = params && params.risk;
      if (rows !== 8 && rows !== 12 && rows !== 16) return 'rows must be 8, 12 or 16';
      if (risk !== 'low' && risk !== 'medium' && risk !== 'high') return "risk must be 'low', 'medium' or 'high'";
      return null;
    },
    outcome(params, floats) {
      const rows = Number(params.rows);
      let bucket = 0;
      for (let s = 0; s < rows; s++) if (floats[s] >= 0.5) bucket++;
      const mult = PLINKO_MULTS[rows][params.risk][bucket];
      return { bucket, mult, win: mult >= 1, payoutMult: mult };
    },
  },

  // Matches docs/ost-games.js "tome": open `pages` rune pages; any page < 0.14 is
  // a curse that busts the run; survive all -> 0.99/0.86^pages, else 0.
  tome: {
    floatsNeeded: (params) => Math.max(2, Math.min(8, Math.floor(Number(params && params.pages) || 2))),
    validateParams(params) {
      const pages = Number(params && params.pages);
      if (!(pages >= 2 && pages <= 8 && Number.isInteger(pages))) return 'pages must be an integer 2..8';
      return null;
    },
    outcome(params, floats) {
      const pages = Math.max(2, Math.min(8, Math.floor(Number(params.pages))));
      let cursed = -1;
      for (let i = 0; i < pages; i++) if (floats[i] < 0.14) { cursed = i; break; }
      const survived = cursed < 0;
      const mult = survived ? round9(0.99 / Math.pow(0.86, pages)) : 0;
      return { pages, cursed, survived, mult, win: survived, payoutMult: mult };
    },
  },
};

/* ---- MULTI-STEP games (session model) ----------------------------------- *
 * These are interactive: the player acts DURING the game (reveal a tile, climb a
 * row, cash out live). The whole hidden LAYOUT is fixed by the seed at session
 * start — before the player sees anything — so a modified client cannot "reveal a
 * safe tile it wasn't dealt". The server reveals each step from that committed
 * layout; provable-fair holds because the layout is re-derivable once the seed is
 * revealed. Port one at a time; mines first.
 */
export const MULTI = {
  mines: {
    layoutFloats: 25,
    validateParams(p) {
      const m = Number(p && p.mines);
      if (!Number.isInteger(m) || m < 1 || m > 24) return 'mines must be an integer 1..24';
      return null;
    },
    // Matches docs/ost-games.js: Fisher-Yates shuffle of 0..24 with 25 floats
    // (i from 24 down to 1, j = floor(floats[i]*(i+1))), first `mines` are bombs.
    buildLayout(params, floats) {
      const idxs = [];
      for (let i = 0; i < 25; i++) idxs.push(i);
      for (let i = 24; i > 0; i--) {
        const j = Math.floor((floats[i] || 0) * (i + 1));
        const t = idxs[i]; idxs[i] = idxs[j]; idxs[j] = t;
      }
      return { minePositions: idxs.slice(0, Number(params.mines)) };
    },
    // minesMultiplier(safe, mines) = 0.99 / (C(25-mines, safe)/C(25, safe)).
    multiplier(params, safe) {
      if (safe < 1) return 0;
      const mines = Number(params.mines);
      let num = 1, den = 1;
      for (let i = 0; i < safe; i++) { num *= (25 - mines - i); den *= (25 - i); }
      return round9(0.99 / (num / den));
    },
    config(params) { return { grid: 25, mines: Number(params.mines) }; },
    // Apply one reveal. Returns { error } | { ended, won, boom?/safe?, ... }.
    step(params, layout, state, action) {
      const tile = Number(action && action.tile);
      if (!Number.isInteger(tile) || tile < 0 || tile > 24) return { error: 'tile must be 0..24' };
      if ((state.revealed || []).includes(tile)) return { error: 'tile already revealed' };
      if (layout.minePositions.includes(tile)) {
        return { ended: true, won: false, boom: true, tile, minePositions: layout.minePositions };
      }
      state.revealed = (state.revealed || []).concat(tile);
      state.safeRevealed = (state.safeRevealed || 0) + 1;
      const maxSafe = 25 - Number(params.mines);
      const done = state.safeRevealed >= maxSafe;   // revealed every safe tile
      return { ended: done, won: done, safe: true, tile, safeRevealed: state.safeRevealed, multiplier: this.multiplier(params, state.safeRevealed) };
    },
    // Multiplier bankable right now (0 before the first safe reveal).
    currentMultiplier(params, state) { return this.multiplier(params, state.safeRevealed || 0); },
  },
};

// Compute one bet's outcome from the secret seed. Pure + deterministic given
// (serverSeed, clientSeed, nonce, params). Returns the outcome detail + payout.
export async function computeBet(game, serverSeed, clientSeed, nonce, params, wager) {
  const g = GAMES[game];
  if (!g) throw new Error('unknown_game');
  // floatsNeeded may be a fixed number or a function of params (e.g. tome needs
  // `pages` floats). validateParams must bound it so it can't be unbounded.
  const need = typeof g.floatsNeeded === 'function' ? g.floatsNeeded(params) : g.floatsNeeded;
  const rounds = Math.max(1, Math.ceil(need / 8));
  const hexes = [];
  for (let r = 0; r < rounds; r++) hexes.push(await hmacSha256Hex(serverSeed, clientSeed + ':' + nonce + ':' + r));
  const floats = floatsFromHexes(hexes, need);
  const o = g.outcome(params, floats);
  const payout = round9(wager * o.payoutMult);
  return Object.assign({ nonce, payout }, o);
}

// Build a MULTI-step game's hidden layout from the secret seed at a nonce. Pure +
// deterministic, so it is re-derivable for verification once the seed is revealed.
export async function layoutFor(game, serverSeed, clientSeed, nonce, params) {
  const g = MULTI[game];
  if (!g) throw new Error('unknown_multi_game');
  const need = g.layoutFloats;
  const rounds = Math.max(1, Math.ceil(need / 8));
  const hexes = [];
  for (let r = 0; r < rounds; r++) hexes.push(await hmacSha256Hex(serverSeed, clientSeed + ':' + nonce + ':' + r));
  return g.buildLayout(params, floatsFromHexes(hexes, need));
}

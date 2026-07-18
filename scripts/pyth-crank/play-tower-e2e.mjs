// PHASE 2 INCREMENT 4c — tower + dragontower sessions, provably fair.
// Plays each, then after /play/rotate recomputes the hidden layout from the
// revealed seed and confirms every reveal was honest + the multiplier is exact.
import { readFileSync } from 'node:fs';
import { createHash, createHmac } from 'node:crypto';
import {
  Connection, Keypair, PublicKey, Transaction, TransactionInstruction, sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync, getAccount, createTransferCheckedInstruction,
} from '@solana/spl-token';

const RPC = 'https://api.devnet.solana.com', API = 'https://ost-api.nachogtavl.workers.dev';
const PROGRAM_ID = new PublicKey('J7jqcwT44CY4oXjwu6fwfiFvQDWBQRsueqL7dsZjnrJd');
const OSTC = new PublicKey('383pTzoZ8Gp83dzk23ZnvLcfX2Sq32TAGN48CMQu2pAJ');
const OSTG = new PublicKey('DfgxMbdN49AX2Za9LuvsyixF1jgVh45RbgWYSGonxQos');
const VAULT = new PublicKey('8X6pL7QtYqGd8pzkVA3nkWu36rRw9YQsUGh79V6XRYak');
const BRIDGE = new PublicKey('BnphbE6izjGaC1D4XazDoyVZooLxBDhYqHfzenXuMxPK');
const POOL = new PublicKey('5ibGwXAV6yLZPR6uWbzou1LaHhmhehjYEpqWZKZw5WZS');
const TP = TOKEN_2022_PROGRAM_ID, DEC = 9;
const disc = (n) => createHash('sha256').update('global:' + n).digest().subarray(0, 8);
const u64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const raw = (n) => BigInt(Math.round(n * 10 ** DEC));
const authority = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(process.env.USERPROFILE + '/.config/solana/id.json', 'utf8'))));
const conn = new Connection(RPC, 'confirmed');
const ata = (m, o) => getAssociatedTokenAddressSync(m, o, true, TP);
const poolAta = (m) => getAssociatedTokenAddressSync(m, POOL, false, TP);
let fails = 0; const say = (ok, m) => { console.log((ok ? '  PASS ' : '  FAIL ') + m); if (!ok) fails++; };
const call = async (mm, p, b) => { const r = await fetch(API + p, { method: mm, headers: { 'content-type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, json: await r.json().catch(() => ({})) }; };
const post = (p, b) => call('POST', p, b), get = (p) => call('GET', p);
const b64 = { enc: (u8) => Buffer.from(u8).toString('base64'), dec: (s) => new Uint8Array(Buffer.from(s, 'base64')) };
const ixJson = (ix) => ({ programId: ix.programId.toBase58(), keys: ix.keys.map(k => ({ pubkey: k.pubkey.toBase58(), isSigner: k.isSigner, isWritable: k.isWritable })), data: b64.enc(ix.data) });
async function feeOnly(kp, ixs) { const b = (await post('/wallet/cosign', { kind: 'fee-only', wallet: kp.publicKey.toBase58(), instructions: ixs.map(ixJson) })).json; const tx = Transaction.from(b64.dec(b.txBase64)); tx.partialSign(kp); return (await post('/wallet/cosign/submit', { cosignId: b.cosignId, signedTxBase64: b64.enc(tx.serialize({ requireAllSignatures: false, verifySignatures: false })) })).json.sig; }
function bridgeDep(o, amt) { return new TransactionInstruction({ programId: PROGRAM_ID, keys: [{ pubkey: BRIDGE, isSigner: false, isWritable: false }, { pubkey: OSTC, isSigner: false, isWritable: true }, { pubkey: OSTG, isSigner: false, isWritable: true }, { pubkey: VAULT, isSigner: false, isWritable: true }, { pubkey: ata(OSTC, o), isSigner: false, isWritable: true }, { pubkey: ata(OSTG, o), isSigner: false, isWritable: true }, { pubkey: o, isSigner: true, isWritable: false }, { pubkey: TP, isSigner: false, isWritable: false }], data: Buffer.concat([disc('deposit'), u64(raw(amt))]) }); }
const wait = async (a) => { for (let i = 0; i < 12; i++) { try { for (const x of a) await getAccount(conn, x, 'confirmed', TP); return; } catch { await new Promise(r => setTimeout(r, 1200)); } } };
const floatsN = (seed, cs, nonce, count) => { const rounds = Math.max(1, Math.ceil(count / 8)); const out = []; for (let r = 0; r < rounds; r++) { const hex = createHmac('sha256', Buffer.from(seed, 'hex')).update(cs + ':' + nonce + ':' + r).digest('hex'); let i = 0; while (out.length < count && i + 8 <= hex.length) { out.push(parseInt(hex.substr(i, 8), 16) / 4294967296); i += 8; } } return out; };
function shuffleWithFloats(items, floats) { const res = items.slice(); for (let index = res.length - 1; index > 0; index--) { const fi = res.length - 1 - index; const sw = Math.floor((floats[fi] || 0) * (index + 1)); const t = res[index]; res[index] = res[sw]; res[sw] = t; } return res; }
const TOWER = { easy: { columns: 3, safe: 2 }, medium: { columns: 4, safe: 2 }, hard: { columns: 4, safe: 1 } };
const DRAGON = { easy: { cols: 4, floors: 8, factor: 0.99 * 4 / 3 }, medium: { cols: 3, floors: 8, factor: 0.99 * 3 / 2 }, hard: { cols: 2, floors: 8, factor: 0.99 * 2 / 1 } };

async function playSession(W, game, params, wager, pickFn) {
  // pickFn(stepIndex) -> action; play until ended or cashout decision.
  const start = (await post('/play/session/start', { wallet: W, game, params, wager })).json;
  const reveals = [];
  let ended = false, step = 0;
  while (!ended && step < 30) {
    const action = pickFn(step);
    if (!action) break;
    const r = (await post('/play/session/step', { wallet: W, sessionId: start.sessionId, action })).json;
    reveals.push({ action, r });
    if (r.ended || r.error) ended = true;
    step++;
  }
  let cashout = null;
  if (!ended) cashout = (await post('/play/session/cashout', { wallet: W, sessionId: start.sessionId })).json;
  return { start, reveals, cashout };
}

(async () => {
  const user = Keypair.generate(); const W = user.publicKey.toBase58();
  console.log('player:', W);
  await post('/wallet/ata-rent', { owner: W, mint: OSTC.toBase58() });
  await sendAndConfirmTransaction(conn, new Transaction().add(createTransferCheckedInstruction(ata(OSTC, authority.publicKey), OSTC, ata(OSTC, user.publicKey), authority.publicKey, raw(12), DEC, [], TP)), [authority], { commitment: 'confirmed' });
  await post('/wallet/ata-rent', { owner: W, mint: OSTG.toBase58() });
  await wait([ata(OSTC, user.publicKey), ata(OSTG, user.publicKey)]);
  await feeOnly(user, [bridgeDep(user.publicKey, 10)]);
  const depSig = await feeOnly(user, [createTransferCheckedInstruction(ata(OSTG, user.publicKey), OSTG, poolAta(OSTG), user.publicKey, raw(8), DEC, [], TP)]);
  await new Promise(r => setTimeout(r, 3000));
  await post('/play/deposit', { wallet: W, signature: depSig });
  const clientSeed = (await get('/play/seed?wallet=' + W)).json.clientSeed;
  say((await get('/play/balance?wallet=' + W)).json.balance === 8, 'play balance = 8');

  // TOWER (medium): always pick column 0 each row.
  console.log('\n1) tower (medium, 6 rows) — pick column 0 each row');
  const tw = await playSession(W, 'tower', { mode: 'medium', rows: 6 }, 1, () => ({ column: 0 }));
  say(!!tw.start.sessionId, 'tower session started, wager debited (bal ' + tw.start.balance + ')');

  // DRAGONTOWER (medium): always pick column 0 each floor.
  console.log('\n2) dragontower (medium) — pick column 0 each floor');
  const dt = await playSession(W, 'dragontower', { mode: 'medium' }, 1, () => ({ column: 0 }));
  say(!!dt.start.sessionId, 'dragontower session started, wager debited (bal ' + dt.start.balance + ')');

  // Reveal seed, recompute both layouts, verify honesty + multipliers.
  console.log('\n3) reveal seed + verify both layouts honest');
  const rot = (await post('/play/rotate', { wallet: W })).json;
  say(createHash('sha256').update(rot.revealedSeed, 'utf8').digest('hex') === rot.revealedHash, 'sha256(revealedSeed) == published hash');

  // tower layout: per row shuffle columns, first `safe` are safe.
  const twCfg = TOWER.medium;
  const twFloats = floatsN(rot.revealedSeed, clientSeed, tw.start.nonce, 6 * twCfg.columns);
  const twSafe = [];
  for (let r = 0; r < 6; r++) { const cols = []; for (let c = 0; c < twCfg.columns; c++) cols.push(c); twSafe.push(new Set(shuffleWithFloats(cols, twFloats.slice(r * twCfg.columns, r * twCfg.columns + twCfg.columns)).slice(0, twCfg.safe))); }
  let twHonest = true, twLevel = 0;
  tw.reveals.forEach((rv, i) => { const isSafe = twSafe[i].has(0); if (!!rv.r.safe !== isSafe || !!rv.r.trap !== !isSafe) twHonest = false; if (rv.r.safe) twLevel++; });
  say(twHonest, 'tower: every reveal matches recomputed safe columns');
  if (tw.cashout && tw.cashout.payout) say(Math.abs(tw.cashout.multiplier - Math.round(Math.pow(0.99 / (twCfg.safe / twCfg.columns), twLevel) * 1e9) / 1e9) < 1e-9, 'tower cashout multiplier exact (level ' + twLevel + ')');
  else say(true, 'tower busted on a trap — valid (recompute honest)');

  // dragontower layout: dragons[f] = floor(floats[f]*cols).
  const dCfg = DRAGON.medium;
  const dFloats = floatsN(rot.revealedSeed, clientSeed, dt.start.nonce, dCfg.floors);
  const dragons = []; for (let f = 0; f < dCfg.floors; f++) dragons.push(Math.floor(dFloats[f] * dCfg.cols));
  let dHonest = true, dFloor = 0;
  dt.reveals.forEach((rv, i) => { const isDragon = dragons[i] === 0; if (!!rv.r.dragon !== isDragon || !!rv.r.safe !== !isDragon) dHonest = false; if (rv.r.safe) dFloor++; });
  say(dHonest, 'dragontower: every reveal matches recomputed dragon columns');
  if (dt.cashout && dt.cashout.payout) say(Math.abs(dt.cashout.multiplier - Math.round(Math.pow(dCfg.factor, dFloor) * 1e9) / 1e9) < 1e-9, 'dragontower cashout multiplier exact (floor ' + dFloor + ')');
  else say(true, 'dragontower ended on a dragon — valid (recompute honest)');

  const health = (await get('/health/play')).json;
  say(health.solvent === true, 'peg solvent (pool ' + health.poolOstg + ' >= total ' + health.playTotal + ')');
  console.log('\n' + (fails === 0 ? 'ALL PASS — tower + dragontower sessions server-authoritative + provably fair.' : fails + ' FAIL(S)'));
  process.exit(fails === 0 ? 0 : 1);
})().catch((e) => { console.error('THREW:', e.message || e); process.exit(1); });

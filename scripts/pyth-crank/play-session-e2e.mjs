// PHASE 2 INCREMENT 4c — multi-step game sessions (mines), provably fair.
//
// Proves: start debits the wager and pins a HIDDEN mine layout from the secret
// seed; each reveal is server-authoritative; cash-out credits wager × the mines
// multiplier; and — the fairness proof — after /play/rotate the mine layout is
// recomputed from the revealed seed and EVERY server reveal is confirmed honest
// (a "safe" tile is not a mine; a "boom" tile is), and the multiplier is exact.
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

// Recompute the mine layout exactly as the server (matches ost-games.js placement).
function minePositions(seed, cs, nonce, mines) {
  const rounds = Math.ceil(25 / 8), floats = [];
  for (let r = 0; r < rounds; r++) { const hex = createHmac('sha256', Buffer.from(seed, 'hex')).update(cs + ':' + nonce + ':' + r).digest('hex'); let i = 0; while (floats.length < 25 && i + 8 <= hex.length) { floats.push(parseInt(hex.substr(i, 8), 16) / 4294967296); i += 8; } }
  const idx = []; for (let i = 0; i < 25; i++) idx.push(i);
  for (let i = 24; i > 0; i--) { const j = Math.floor((floats[i] || 0) * (i + 1)); const t = idx[i]; idx[i] = idx[j]; idx[j] = t; }
  return new Set(idx.slice(0, mines));
}
function minesMult(safe, mines) { if (safe < 1) return 0; let num = 1, den = 1; for (let i = 0; i < safe; i++) { num *= (25 - mines - i); den *= (25 - i); } return Math.round((0.99 / (num / den)) * 1e9) / 1e9; }

(async () => {
  const user = Keypair.generate();
  console.log('player:', user.publicKey.toBase58());
  await post('/wallet/ata-rent', { owner: user.publicKey.toBase58(), mint: OSTC.toBase58() });
  await sendAndConfirmTransaction(conn, new Transaction().add(createTransferCheckedInstruction(ata(OSTC, authority.publicKey), OSTC, ata(OSTC, user.publicKey), authority.publicKey, raw(12), DEC, [], TP)), [authority], { commitment: 'confirmed' });
  await post('/wallet/ata-rent', { owner: user.publicKey.toBase58(), mint: OSTG.toBase58() });
  await wait([ata(OSTC, user.publicKey), ata(OSTG, user.publicKey)]);
  await feeOnly(user, [bridgeDep(user.publicKey, 10)]);
  const depSig = await feeOnly(user, [createTransferCheckedInstruction(ata(OSTG, user.publicKey), OSTG, poolAta(OSTG), user.publicKey, raw(8), DEC, [], TP)]);
  await new Promise(r => setTimeout(r, 3000));
  await post('/play/deposit', { wallet: user.publicKey.toBase58(), signature: depSig });
  const W = user.publicKey.toBase58();
  const seed0 = (await get('/play/seed?wallet=' + W)).json;
  const clientSeed = seed0.clientSeed;
  const balBefore = (await get('/play/balance?wallet=' + W)).json.balance;
  say(balBefore === 8, 'play balance = 8');

  const MINES = 3, WAGER = 1;
  console.log('\n1) start mines session (3 mines, wager 1)');
  const start = (await post('/play/session/start', { wallet: W, game: 'mines', params: { mines: MINES }, wager: WAGER })).json;
  say(!!start.sessionId && start.config.grid === 25 && start.config.mines === 3, 'session started, 25 tiles / 3 mines');
  say(start.balance === balBefore - WAGER, 'wager debited at start (balance ' + start.balance + ')');
  const nonce = start.nonce, sid = start.sessionId;

  // Reveal tiles 0,1,2,3,4 until boom or 3 safe reveals; record each.
  console.log('\n2) reveal tiles (server-authoritative)');
  const reveals = [];
  let safe = 0, busted = false;
  for (let tile = 0; tile < 5 && !busted && safe < 3; tile++) {
    const r = (await post('/play/session/step', { wallet: W, sessionId: sid, action: { tile } })).json;
    reveals.push({ tile, boom: !!r.boom, safe: !!r.safe, mult: r.currentMultiplier });
    if (r.boom) { busted = true; console.log('   tile', tile, '-> BOOM'); }
    else { safe++; console.log('   tile', tile, '-> safe, mult', r.currentMultiplier); }
  }

  let cashout = null;
  if (!busted && safe >= 1) {
    console.log('\n3) cash out after ' + safe + ' safe reveals');
    cashout = (await post('/play/session/cashout', { wallet: W, sessionId: sid })).json;
    say(!!cashout.payout, 'cashed out ' + cashout.payout + ' OSTG at ' + cashout.multiplier + '×');
    say(Math.abs(cashout.multiplier - minesMult(safe, MINES)) < 1e-9, 'multiplier == minesMultiplier(' + safe + ',3) exactly');
    say(Math.abs(cashout.balance - (start.balance + cashout.payout)) < 1e-9, 'balance credited by payout');
  } else {
    say(busted, 'session busted on a mine (wager lost) — valid path');
  }

  // FAIRNESS: reveal seed, recompute mine layout, verify every server reveal.
  console.log('\n4) reveal seed + verify the hidden layout was honest');
  const rot = (await post('/play/rotate', { wallet: W })).json;
  say(createHash('sha256').update(rot.revealedSeed, 'utf8').digest('hex') === rot.revealedHash, 'sha256(revealedSeed) == published hash');
  const mines = minePositions(rot.revealedSeed, clientSeed, nonce, MINES);
  let honest = true;
  for (const rv of reveals) {
    const isMine = mines.has(rv.tile);
    if (rv.boom !== isMine || rv.safe === isMine) { honest = false; console.log('   DISHONEST reveal', rv.tile, 'server boom=' + rv.boom + ' but recomputed mine=' + isMine); }
  }
  say(honest, 'every server reveal matches the recomputed layout (safe=not-mine, boom=mine)');
  if (cashout) say(Math.abs(cashout.multiplier - minesMult(safe, MINES)) < 1e-9, 'cashout multiplier reproduces from the layout');

  // Can't act on an ended session.
  const after = (await post('/play/session/step', { wallet: W, sessionId: sid, action: { tile: 20 } })).json;
  say(after.error === 'session_ended' || after.error === 'unknown_session', 'ended session rejects further steps');

  const health = (await get('/health/play')).json;
  say(health.solvent === true, 'peg solvent (pool ' + health.poolOstg + ' >= total ' + health.playTotal + ')');

  console.log('\n' + (fails === 0 ? 'ALL PASS — mines sessions are server-authoritative and provably fair.' : fails + ' FAIL(S)'));
  process.exit(fails === 0 ? 0 : 1);
})().catch((e) => { console.error('THREW:', e.message || e); process.exit(1); });

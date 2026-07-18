// PHASE 2 INCREMENT 4c — hilo (Hi-Lo card streak) session, provably fair.
// Plays a streak always guessing the higher-probability side, then after
// /play/rotate recomputes the card SEQUENCE from the revealed seed and confirms
// every reveal (card + push/win/lose) was honest and the compounded multiplier
// is exact — including the < 1 house-edge case on a near-certain guess.
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
const round9 = (n) => Math.round(n * 1e9) / 1e9;

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

  const WAGER = 1;
  console.log('\n1) start hilo — first card revealed');
  const start = (await post('/play/session/start', { wallet: W, game: 'hilo', params: {}, wager: WAGER })).json;
  say(!!start.sessionId && start.config.deckSize === 13, 'session started, deck 13');
  say(start.reveal && start.reveal.card >= 1 && start.reveal.card <= 13, 'starting card revealed (' + (start.reveal && start.reveal.card) + ')');
  say(start.balance === 7, 'wager debited at start (bal ' + start.balance + ')');
  const nonce = start.nonce, sid = start.sessionId;

  // Recompute the full card SEQUENCE from... we don't know the seed yet. Strategy:
  // always guess the side with the higher probability given the CURRENT card, and
  // stop after a fixed number of steps or when the session ends. Track the reveals.
  console.log('\n2) play a streak (always guess the higher-probability side)');
  let current = start.reveal.card, ended = false, step = 0, lastMult = 1;
  const reveals = [];
  while (!ended && step < 8) {
    const pHi = (13 - current) / 12, pLo = (current - 1) / 12;
    const dir = pHi >= pLo ? 'hi' : 'lo';           // higher-probability side
    if (Math.max(pHi, pLo) <= 0) break;             // impossible either way (never for 1..13)
    const r = (await post('/play/session/step', { wallet: W, sessionId: sid, action: { dir } })).json;
    reveals.push({ dir, prevAtGuess: current, r });
    console.log('   guess ' + dir + ' from ' + current + ' -> card ' + r.card + (r.push ? ' (push)' : r.safe ? ' (win, mult ' + r.multiplier + ')' : ' (bust)'));
    if (r.error) { console.log('   step error:', r.error); ended = true; break; }
    if (typeof r.multiplier === 'number') lastMult = r.multiplier;
    current = r.card;
    if (r.ended) ended = true;
    step++;
  }

  let cashout = null;
  if (!ended) {
    console.log('\n3) cash out the streak');
    cashout = (await post('/play/session/cashout', { wallet: W, sessionId: sid })).json;
    say(cashout.payout !== undefined, 'cashed out ' + cashout.payout + ' OSTG at ' + cashout.multiplier + '×');
    say(Math.abs(cashout.multiplier - lastMult) < 1e-9, 'cashout multiplier == last streak multiplier');
  } else {
    say(true, 'streak busted on a wrong guess — valid path (verified below)');
  }

  // FAIRNESS: reveal seed, recompute the card sequence, verify every reveal.
  console.log('\n4) reveal seed + verify the card sequence was honest');
  const rot = (await post('/play/rotate', { wallet: W })).json;
  say(createHash('sha256').update(rot.revealedSeed, 'utf8').digest('hex') === rot.revealedHash, 'sha256(revealedSeed) == published hash');
  const floats = floatsN(rot.revealedSeed, clientSeed, nonce, 52);
  const cards = floats.map(f => Math.floor(f * 13) + 1);
  say(cards[0] === start.reveal.card, 'recomputed card[0] == revealed starting card');

  // Replay the exact guesses against the recomputed sequence and confirm the
  // server's card, push/win/lose classification and compounded multiplier match.
  let honest = true, pos = 0, mult = 1;
  for (const rv of reveals) {
    const cur = cards[pos];
    const nxt = cards[pos + 1];
    const p = rv.dir === 'hi' ? (13 - cur) / 12 : (cur - 1) / 12;
    pos += 1;
    if (rv.r.card !== nxt) { honest = false; console.log('   card mismatch at pos ' + pos + ': server ' + rv.r.card + ' vs recomputed ' + nxt); }
    if (nxt === cur) {
      if (!rv.r.push) { honest = false; console.log('   expected push at pos ' + pos); }
    } else {
      const win = rv.dir === 'hi' ? nxt > cur : nxt < cur;
      if (win) { mult = round9(mult * (0.99 / p)); if (!rv.r.safe || Math.abs(rv.r.multiplier - mult) > 1e-9) { honest = false; console.log('   win/mult mismatch at pos ' + pos + ': server mult ' + rv.r.multiplier + ' vs recomputed ' + mult); } }
      else if (!(rv.r.ended && !rv.r.won)) { honest = false; console.log('   expected bust at pos ' + pos); }
    }
  }
  say(honest, 'every reveal (card + push/win/lose + compounded multiplier) matches the recomputed sequence');
  if (cashout && cashout.payout !== undefined) say(Math.abs(cashout.multiplier - mult) < 1e-9, 'cashout multiplier reproduces from the sequence (' + mult + '×)');

  const after = (await post('/play/session/step', { wallet: W, sessionId: sid, action: { dir: 'hi' } })).json;
  say(after.error === 'session_ended' || after.error === 'unknown_session', 'ended session rejects further steps');

  const health = (await get('/health/play')).json;
  say(health.solvent === true, 'peg solvent (pool ' + health.poolOstg + ' >= total ' + health.playTotal + ')');

  console.log('\n' + (fails === 0 ? 'ALL PASS — hilo sessions are server-authoritative and provably fair.' : fails + ' FAIL(S)'));
  process.exit(fails === 0 ? 0 : 1);
})().catch((e) => { console.error('THREW:', e.message || e); process.exit(1); });

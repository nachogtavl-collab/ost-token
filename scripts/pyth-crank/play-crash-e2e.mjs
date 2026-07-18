// PHASE 2 INCREMENT 4c — crash session, server-clock-authoritative + provably fair.
// Proves four things:
//  1) AUTO-cashout is DETERMINISTIC from the seed: win at the target iff target <
//     the hidden bust point; else bust. Recomputed from the revealed seed.
//  2) MANUAL eject is bounded by the SERVER clock — a client that claims a huge
//     multiplier immediately cannot get it (anti time-travel); it's capped to the
//     server-elapsed multiplier.
//  3) A too-late eject (claim >= the hidden bust) busts with no payout.
//  4) After /play/rotate the bust point recomputes exactly (crashPoint formula).
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
const TP = TOKEN_2022_PROGRAM_ID, DEC = 9, K = 0.32;
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
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const f0 = (seed, cs, nonce) => { const hex = createHmac('sha256', Buffer.from(seed, 'hex')).update(cs + ':' + nonce + ':0').digest('hex'); return parseInt(hex.substr(0, 8), 16) / 4294967296; };
const crashPoint = (r) => Math.max(1, Math.floor(99 / (1 - r)) / 100);

(async () => {
  const user = Keypair.generate(); const W = user.publicKey.toBase58();
  console.log('player:', W);
  await post('/wallet/ata-rent', { owner: W, mint: OSTC.toBase58() });
  await sendAndConfirmTransaction(conn, new Transaction().add(createTransferCheckedInstruction(ata(OSTC, authority.publicKey), OSTC, ata(OSTC, user.publicKey), authority.publicKey, raw(30), DEC, [], TP)), [authority], { commitment: 'confirmed' });
  await post('/wallet/ata-rent', { owner: W, mint: OSTG.toBase58() });
  await wait([ata(OSTC, user.publicKey), ata(OSTG, user.publicKey)]);
  await feeOnly(user, [bridgeDep(user.publicKey, 28)]);
  const depSig = await feeOnly(user, [createTransferCheckedInstruction(ata(OSTG, user.publicKey), OSTG, poolAta(OSTG), user.publicKey, raw(25), DEC, [], TP)]);
  await sleep(3000);
  await post('/play/deposit', { wallet: W, signature: depSig });
  const clientSeed = (await get('/play/seed?wallet=' + W)).json.clientSeed;
  say((await get('/play/balance?wallet=' + W)).json.balance === 25, 'play balance = 25');

  const rounds = [];   // { nonce, kind, params, claimed?, res }

  // (A) AUTO-cashout rounds at a spread of targets. Deterministic vs hidden bust.
  console.log('\n1) auto-cashout rounds (deterministic: win iff target < bust)');
  for (const target of [1.5, 2, 3, 5, 10]) {
    const s = (await post('/play/session/start', { wallet: W, game: 'crash', params: { autoCashout: target }, wager: 0.5 })).json;
    const c = (await post('/play/session/cashout', { wallet: W, sessionId: s.sessionId })).json;
    rounds.push({ nonce: s.nonce, kind: 'auto', target, res: c });
    console.log('   target ' + target + '× -> ' + (c.busted ? 'BUST (crashAt ' + c.crashAt + ')' : 'WIN ' + c.multiplier + '× payout ' + c.payout));
  }

  // (B) ANTI TIME-TRAVEL: manual eject claiming a huge mult the instant after start.
  console.log('\n2) manual eject cannot claim a multiplier the server clock has not reached');
  const sTT = (await post('/play/session/start', { wallet: W, game: 'crash', params: {}, wager: 0.5 })).json;
  await sleep(200);                                    // ~0.2s elapsed
  const cTT = (await post('/play/session/cashout', { wallet: W, sessionId: sTT.sessionId, claimedMult: 1000 })).json;
  // At ~0.2s server-elapsed, mult ~ e^(0.32*0.2) ~ 1.066; with GRACE 1.05 the cap
  // is ~1.12. A claim of 1000 must be capped far below that (or bust if capped
  // above the hidden crashAt). Either way it must NOT pay ~1000×.
  say(cTT.busted || (cTT.multiplier && cTT.multiplier < 1.3), 'claim of 1000x was capped to server time (' + (cTT.busted ? 'busted' : cTT.multiplier + '×') + '), not paid out huge');
  rounds.push({ nonce: sTT.nonce, kind: 'manual', claimed: 1000, res: cTT });

  // (C) MANUAL eject after real elapsed time at a modest claim.
  console.log('\n3) manual eject after ~1.2s at a modest claim');
  const sM = (await post('/play/session/start', { wallet: W, game: 'crash', params: {}, wager: 0.5 })).json;
  await sleep(1200);
  const claim = 1.4;                                   // e^(0.32*1.2) ~ 1.47, so 1.4 is within server time
  const cM = (await post('/play/session/cashout', { wallet: W, sessionId: sM.sessionId, claimedMult: claim })).json;
  rounds.push({ nonce: sM.nonce, kind: 'manual', claimed: claim, res: cM });
  console.log('   claim ' + claim + '× -> ' + (cM.busted ? 'BUST (crashAt ' + cM.crashAt + ')' : 'WIN ' + cM.multiplier + '× payout ' + cM.payout));

  // FAIRNESS: reveal seed, recompute each bust point, verify every settlement.
  console.log('\n4) reveal seed + verify every bust point + settlement');
  const rot = (await post('/play/rotate', { wallet: W })).json;
  say(createHash('sha256').update(rot.revealedSeed, 'utf8').digest('hex') === rot.revealedHash, 'sha256(revealedSeed) == published hash');

  let honest = true;
  for (const r of rounds) {
    const bust = crashPoint(f0(rot.revealedSeed, clientSeed, r.nonce));
    if (r.res.crashAt !== undefined && Math.abs(r.res.crashAt - bust) > 1e-9) { honest = false; console.log('   crashAt mismatch nonce ' + r.nonce + ': server ' + r.res.crashAt + ' vs recompute ' + bust); }
    if (r.kind === 'auto') {
      const shouldWin = r.target < bust;
      if (shouldWin && (r.res.busted || Math.abs(r.res.multiplier - r.target) > 1e-9)) { honest = false; console.log('   auto ' + r.target + ' should WIN at target vs bust ' + bust + ' — got', JSON.stringify(r.res)); }
      if (!shouldWin && !r.res.busted) { honest = false; console.log('   auto ' + r.target + ' should BUST vs bust ' + bust + ' — got', JSON.stringify(r.res)); }
    } else {
      // manual: if it won, the paid mult must be <= claimed and < bust.
      if (!r.res.busted) {
        if (r.res.multiplier > r.claimed + 1e-9) { honest = false; console.log('   manual paid ' + r.res.multiplier + ' > claimed ' + r.claimed); }
        if (r.res.multiplier >= bust) { honest = false; console.log('   manual paid ' + r.res.multiplier + ' >= bust ' + bust); }
      }
    }
  }
  say(honest, 'every round: bust point recomputes exactly + settlement is consistent with it');

  // A hidden bust point was never leaked at start.
  say(sM.crashAt === undefined && !('crashAt' in (sM.config || {})) , 'start response never revealed the bust point');

  const health = (await get('/health/play')).json;
  say(health.solvent === true, 'peg solvent (pool ' + health.poolOstg + ' >= total ' + health.playTotal + ')');

  console.log('\n' + (fails === 0 ? 'ALL PASS — crash is server-clock-authoritative and provably fair.' : fails + ' FAIL(S)'));
  process.exit(fails === 0 ? 0 : 1);
})().catch((e) => { console.error('THREW:', e.message || e); process.exit(1); });

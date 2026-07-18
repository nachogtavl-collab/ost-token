// PHASE 2 INCREMENT 4a — verify each ported single-shot game server-side matches
// its client math exactly, by independent recompute from the revealed seed.
// Covers limbo, dice, coinflip. Same seed per wallet; nonces accumulate across
// games; one /play/rotate reveals the seed to check them all.
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

// Independent recompute — the client's exact math for each game.
const f0 = (seed, cs, nonce) => parseInt(createHmac('sha256', Buffer.from(seed, 'hex')).update(cs + ':' + nonce + ':0').digest('hex').substr(0, 8), 16) / 4294967296;
const recompute = {
  limbo: (seed, cs, n, p, w) => { const rolled = Math.max(1, 99 / (100 * (1 - f0(seed, cs, n)))); const win = rolled >= p.target; return win ? w * p.target : 0; },
  dice: (seed, cs, n, p, w) => { const roll = f0(seed, cs, n) * 100; const win = p.dir === 'under' ? roll < p.target : roll > p.target; const c = p.dir === 'under' ? p.target : 100 - p.target; return win ? w * (99 / c) : 0; },
  coinflip: (seed, cs, n, p, w) => { const res = f0(seed, cs, n) < 0.5 ? 'h' : 't'; return res === p.side ? w * 1.98 : 0; },
};

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
  const clientSeed = (await get('/play/seed?wallet=' + user.publicKey.toBase58())).json.clientSeed;
  say((await get('/play/balance?wallet=' + user.publicKey.toBase58())).json.balance === 8, 'play balance = 8');

  // Play 4 bets of each game, recording (game, params, nonce, wager, serverPayout).
  const plays = [];
  const cases = [
    ['limbo', { target: 2 }], ['dice', { target: 50, dir: 'under' }], ['dice', { target: 30, dir: 'over' }], ['coinflip', { side: 'h' }],
  ];
  console.log('\n1) play a spread of single-shot bets (server computes each)');
  for (const [game, params] of cases) {
    const r = await post('/play/bet', { wallet: user.publicKey.toBase58(), game, wager: 0.25, params, count: 3 });
    say(r.json.played === 3, game + ' ' + JSON.stringify(params) + ' × 3 played');
    for (const res of r.json.results) plays.push({ game, params, nonce: res.nonce, wager: 0.25, serverPayout: res.payout });
  }

  // Reveal + independently recompute EVERY bet with its game's exact math.
  console.log('\n2) reveal seed + recompute every outcome per game');
  const rot = (await post('/play/rotate', { wallet: user.publicKey.toBase58() })).json;
  say(createHash('sha256').update(rot.revealedSeed, 'utf8').digest('hex') === rot.revealedHash, 'sha256(revealedSeed) == published hash');
  const byGame = {};
  let allMatch = true;
  for (const pl of plays) {
    const expect = Math.round(recompute[pl.game](rot.revealedSeed, clientSeed, pl.nonce, pl.params, pl.wager) * 1e9) / 1e9;
    byGame[pl.game] = byGame[pl.game] || { ok: 0, bad: 0 };
    if (Math.abs(expect - pl.serverPayout) < 1e-9) byGame[pl.game].ok++;
    else { byGame[pl.game].bad++; allMatch = false; console.log('   MISMATCH', pl.game, 'nonce', pl.nonce, 'server', pl.serverPayout, 'recompute', expect); }
  }
  for (const g of Object.keys(byGame)) say(byGame[g].bad === 0, g + ': ' + byGame[g].ok + '/' + (byGame[g].ok + byGame[g].bad) + ' outcomes reproduce exactly');
  say(allMatch, 'ALL games: server payouts == independent recompute');

  console.log('\n' + (fails === 0 ? 'ALL PASS — limbo, dice, coinflip are server-authoritative and provably fair.' : fails + ' FAIL(S)'));
  process.exit(fails === 0 ? 0 : 1);
})().catch((e) => { console.error('THREW:', e.message || e); process.exit(1); });

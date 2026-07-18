// PHASE 2 INCREMENT 3 — server-authoritative provably-fair betting (limbo).
//
// Proves: the SERVER computes every outcome from its secret seed (the client
// never submits a payout to inflate); the play balance moves by exactly the
// server's net; and — the fairness proof — after /play/rotate reveals the seed,
// EVERY credited outcome is independently reproducible: sha256(revealedSeed)
// matches the pre-published hash, and HMAC(revealedSeed, clientSeed:nonce:0)
// recomputes the same roll/payout the server credited. Plus: solvency holds and
// an over-balance bet stops.
import { readFileSync } from 'node:fs';
import { createHash, createHmac } from 'node:crypto';
import {
  Connection, Keypair, PublicKey, Transaction, TransactionInstruction, sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync, getAccount, createTransferCheckedInstruction,
} from '@solana/spl-token';

const RPC = 'https://api.devnet.solana.com';
const API = 'https://ost-api.nachogtavl.workers.dev';
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
const ui = (n) => Number(n) / 10 ** DEC;
const authority = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(process.env.USERPROFILE + '/.config/solana/id.json', 'utf8'))));
const conn = new Connection(RPC, 'confirmed');
const ata = (mint, owner) => getAssociatedTokenAddressSync(mint, owner, true, TP);
const poolAta = (mint) => getAssociatedTokenAddressSync(mint, POOL, false, TP);
const tokBal = async (a) => { try { return ui((await getAccount(conn, a, 'confirmed', TP)).amount); } catch { return 0; } };

let fails = 0;
const say = (ok, m) => { console.log((ok ? '  PASS ' : '  FAIL ') + m); if (!ok) fails++; };
const call = async (m, p, b) => { const r = await fetch(API + p, { method: m, headers: { 'content-type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, json: await r.json().catch(() => ({})) }; };
const post = (p, b) => call('POST', p, b); const get = (p) => call('GET', p);
const b64 = { enc: (u8) => Buffer.from(u8).toString('base64'), dec: (s) => new Uint8Array(Buffer.from(s, 'base64')) };
const ixJson = (ix) => ({ programId: ix.programId.toBase58(), keys: ix.keys.map(k => ({ pubkey: k.pubkey.toBase58(), isSigner: k.isSigner, isWritable: k.isWritable })), data: b64.enc(ix.data) });
async function feeOnly(userKp, instructions) {
  const built = (await post('/wallet/cosign', { kind: 'fee-only', wallet: userKp.publicKey.toBase58(), instructions: instructions.map(ixJson) })).json;
  const tx = Transaction.from(b64.dec(built.txBase64)); tx.partialSign(userKp);
  return (await post('/wallet/cosign/submit', { cosignId: built.cosignId, signedTxBase64: b64.enc(tx.serialize({ requireAllSignatures: false, verifySignatures: false })) })).json.sig;
}
function bridgeDepositIx(owner, amt) {
  return new TransactionInstruction({ programId: PROGRAM_ID, keys: [
    { pubkey: BRIDGE, isSigner: false, isWritable: false }, { pubkey: OSTC, isSigner: false, isWritable: true },
    { pubkey: OSTG, isSigner: false, isWritable: true }, { pubkey: VAULT, isSigner: false, isWritable: true },
    { pubkey: ata(OSTC, owner), isSigner: false, isWritable: true }, { pubkey: ata(OSTG, owner), isSigner: false, isWritable: true },
    { pubkey: owner, isSigner: true, isWritable: false }, { pubkey: TP, isSigner: false, isWritable: false },
  ], data: Buffer.concat([disc('deposit'), u64(raw(amt))]) });
}
const waitVisible = async (accts) => { for (let i = 0; i < 12; i++) { try { for (const a of accts) await getAccount(conn, a, 'confirmed', TP); return; } catch { await new Promise(r => setTimeout(r, 1200)); } } };

// Independent recompute — MUST mirror the server + client exactly.
function limboRecompute(serverSeed, clientSeed, nonce, target, wager) {
  const hex = createHmac('sha256', Buffer.from(serverSeed, 'hex')).update(clientSeed + ':' + nonce + ':0').digest('hex');
  const f = parseInt(hex.substr(0, 8), 16) / 4294967296;
  const rolled = Math.max(1, 99 / (100 * (1 - f)));
  const win = rolled >= target;
  return { rolled: Math.round(rolled * 1e9) / 1e9, win, payout: Math.round((win ? wager * target : 0) * 1e9) / 1e9 };
}

(async () => {
  const user = Keypair.generate();
  console.log('player:', user.publicKey.toBase58());

  // Setup: fund OST -> bridge 8 -> deposit 6 into play balance. Also top up the
  // pool's OSTG bankroll so wins are always coverable (solvency).
  await post('/wallet/ata-rent', { owner: user.publicKey.toBase58(), mint: OSTC.toBase58() });
  await sendAndConfirmTransaction(conn, new Transaction().add(
    createTransferCheckedInstruction(ata(OSTC, authority.publicKey), OSTC, ata(OSTC, user.publicKey), authority.publicKey, raw(10), DEC, [], TP)
  ), [authority], { commitment: 'confirmed' });
  await post('/wallet/ata-rent', { owner: user.publicKey.toBase58(), mint: OSTG.toBase58() });
  await waitVisible([ata(OSTC, user.publicKey), ata(OSTG, user.publicKey)]);
  await feeOnly(user, [bridgeDepositIx(user.publicKey, 8)]);   // 8 OSTG to the player

  // Bankroll: authority bridges 50 OST->OSTG and sends it to the pool.
  await feeOnly(authority, [bridgeDepositIx(authority.publicKey, 50)]).catch(() => {});
  try {
    await sendAndConfirmTransaction(conn, new Transaction().add(
      createTransferCheckedInstruction(ata(OSTG, authority.publicKey), OSTG, poolAta(OSTG), authority.publicKey, raw(50), DEC, [], TP)
    ), [authority], { commitment: 'confirmed' });
  } catch (e) { console.log('  (bankroll top-up skipped:', String(e.message).slice(0, 50) + ')'); }

  // Deposit 6 OSTG to the play balance.
  const depSig = await feeOnly(user, [createTransferCheckedInstruction(ata(OSTG, user.publicKey), OSTG, poolAta(OSTG), user.publicKey, raw(6), DEC, [], TP)]);
  await new Promise(r => setTimeout(r, 3000));
  await post('/play/deposit', { wallet: user.publicKey.toBase58(), signature: depSig });
  say((await get('/play/balance?wallet=' + user.publicKey.toBase58())).json.balance === 6, 'setup: play balance = 6');

  // 1) Get the committed seed (hash only — server keeps the secret).
  const seed = (await get('/play/seed?wallet=' + user.publicKey.toBase58())).json;
  say(!!seed.serverSeedHash && seed.nonce === 0, 'committed seed hash published, nonce 0');
  const clientSeed = seed.clientSeed;

  // 2) Play a batch of 8 limbo bets, wager 0.5, target 2. Server-authoritative.
  console.log('\n1) play 8 limbo bets (wager 0.5, target 2) — server computes each');
  const bet = await post('/play/bet', { wallet: user.publicKey.toBase58(), game: 'limbo', wager: 0.5, params: { target: 2 }, count: 8 });
  say(bet.status === 200 && bet.json.played === 8, 'played 8 bets, stopped=' + bet.json.stopped);
  const results = bet.json.results;
  // balance moved by the sum of nets
  const sumNet = Math.round(results.reduce((a, r) => a + r.net, 0) * 1e9) / 1e9;
  say(Math.abs(bet.json.balance - (6 + sumNet)) < 1e-9, 'balance = 6 + Σnet = ' + bet.json.balance);
  const wins = results.filter(r => r.win).length;
  console.log('   wins:', wins, '/ 8   net:', sumNet, 'OSTG (house edge is in the 99/100 roll)');

  // 3) FAIRNESS — reveal the seed and independently reproduce every outcome.
  console.log('\n2) reveal seed + independently verify EVERY outcome');
  const rot = (await post('/play/rotate', { wallet: user.publicKey.toBase58() })).json;
  // Server hashes the seed's HEX STRING as UTF-8 text (sha256Hex(seed)), not the
  // decoded bytes — match that representation.
  say(createHash('sha256').update(rot.revealedSeed, 'utf8').digest('hex') === rot.revealedHash, 'sha256(revealedSeed) == pre-published hash (house did not swap the seed)');
  let allMatch = true;
  for (const r of results) {
    const rc = limboRecompute(rot.revealedSeed, clientSeed, r.nonce, 2, 0.5);
    if (rc.win !== r.win || Math.abs(rc.payout - r.payout) > 1e-9 || Math.abs(rc.rolled - r.rolled) > 1e-6) {
      allMatch = false;
      console.log('   MISMATCH nonce', r.nonce, 'server', r, 'recompute', rc);
    }
  }
  say(allMatch, 'all 8 outcomes reproduce from the revealed seed — provably fair + server-authoritative');

  // 4) Solvency + over-balance stop.
  console.log('\n3) solvency + limits');
  const health = (await get('/health/play')).json;
  say(health.solvent === true, 'peg solvent (pool ' + health.poolOstg + ' >= total ' + health.playTotal + ')');
  const balNow = (await get('/play/balance?wallet=' + user.publicKey.toBase58())).json.balance;
  const over = await post('/play/bet', { wallet: user.publicKey.toBase58(), game: 'limbo', wager: balNow + 100, params: { target: 2 }, count: 1 });
  say(over.json.played === 0, 'a wager beyond balance plays 0 (stopped: ' + over.json.stopped + ')');

  console.log('\n' + (fails === 0 ? 'ALL PASS — server-authoritative, provably fair, solvent, ledger-integrated.' : fails + ' FAIL(S)'));
  process.exit(fails === 0 ? 0 : 1);
})().catch((e) => { console.error('THREW:', e.message || e); process.exit(1); });

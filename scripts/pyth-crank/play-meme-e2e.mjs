// PHASE 2 INCREMENT 5 — memecoins on the OSTG play balance, server-authoritative.
// Buys and sells a coin through /play/meme/*, then INDEPENDENTLY recomputes the
// bonding-curve math and confirms the server's tokens-out, OSTG-out, 2%-profit
// fee, holdings and play balance all match exactly. Also checks the guards
// (insufficient balance, can't sell more than held) and solvency.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
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

// Independent recompute of the server's bonding curve (must match play-ledger.js).
const BASE = 0.00003, STEEP = 199, SUPPLY = 1e9, EDGE = 0.02;
const r9 = (n) => Math.round(n * 1e9) / 1e9;
const cost = (s0, s1) => BASE * (s1 - s0) + (BASE * STEEP / (2 * SUPPLY)) * (s1 * s1 - s0 * s0);
const tokensForOst = (ostIn, s0) => { const A = BASE * STEEP / (2 * SUPPLY), B = BASE * (1 + STEEP * s0 / SUPPLY); return (-B + Math.sqrt(B * B + 4 * A * ostIn)) / (2 * A); };

(async () => {
  const user = Keypair.generate(); const W = user.publicKey.toBase58();
  console.log('player:', W);
  await post('/wallet/ata-rent', { owner: W, mint: OSTC.toBase58() });
  await sendAndConfirmTransaction(conn, new Transaction().add(createTransferCheckedInstruction(ata(OSTC, authority.publicKey), OSTC, ata(OSTC, user.publicKey), authority.publicKey, raw(30), DEC, [], TP)), [authority], { commitment: 'confirmed' });
  await post('/wallet/ata-rent', { owner: W, mint: OSTG.toBase58() });
  await wait([ata(OSTC, user.publicKey), ata(OSTG, user.publicKey)]);
  await feeOnly(user, [bridgeDep(user.publicKey, 28)]);
  const depSig = await feeOnly(user, [createTransferCheckedInstruction(ata(OSTG, user.publicKey), OSTG, poolAta(OSTG), user.publicKey, raw(25), DEC, [], TP)]);
  await new Promise(r => setTimeout(r, 3000));
  await post('/play/deposit', { wallet: W, signature: depSig });
  say((await get('/play/balance?wallet=' + W)).json.balance === 25, 'play balance = 25');

  const mint = 'MEME' + Date.now().toString(36);   // fresh coin, starts at sold=0

  // BUY 5 OSTG worth.
  console.log('\n1) buy 5 OSTG of a fresh coin');
  const buy = (await post('/play/meme/buy', { wallet: W, mint, symbol: 'PEPE', ostIn: 5 })).json;
  const expTokens = r9(tokensForOst(5, 0));
  say(!!buy.ok, 'buy accepted');
  say(Math.abs(buy.tokens - expTokens) < 1e-6, 'tokens-out == recomputed curve (' + buy.tokens + ' ~ ' + expTokens + ')');
  say(Math.abs(buy.balance - 20) < 1e-9, 'play balance debited to 20 (' + buy.balance + ')');
  say(Math.abs(buy.coin.sold - buy.tokens) < 1e-6, 'coin.sold advanced by tokens minted');

  // SELL half the position.
  console.log('\n2) sell half the position');
  const held = buy.position.tokens;
  const sellTokens = r9(held / 2);
  const s1 = buy.coin.sold, s0 = Math.max(0, s1 - sellTokens);
  let expOut = cost(s0, s1);
  const basis = buy.position.costOst * (sellTokens / held);
  const expFee = r9(Math.max(0, expOut - basis) * EDGE);
  expOut = r9(expOut - expFee);
  const sell = (await post('/play/meme/sell', { wallet: W, mint, tokensIn: sellTokens })).json;
  say(!!sell.ok, 'sell accepted');
  say(Math.abs(sell.ostOut - expOut) < 1e-6, 'OSTG-out == recomputed curve minus 2% profit fee (' + sell.ostOut + ' ~ ' + expOut + ')');
  say(Math.abs(sell.fee - expFee) < 1e-6, 'house fee == 2% of profit (' + sell.fee + ')');
  say(Math.abs(sell.position.tokens - r9(held - sellTokens)) < 1e-6, 'remaining position halved');
  say(Math.abs(sell.balance - r9(20 + sell.ostOut)) < 1e-6, 'play balance credited by proceeds');

  // GUARD: cannot sell more than held.
  console.log('\n3) guards');
  const over = (await post('/play/meme/sell', { wallet: W, mint, tokensIn: held * 100 })).json;
  say(over.error === 'insufficient_tokens', 'cannot sell more tokens than held');
  // GUARD: cannot buy beyond the play balance.
  const broke = (await post('/play/meme/buy', { wallet: W, mint, ostIn: 999999 })).json;
  say(broke.error === 'insufficient_balance', 'cannot buy beyond the play balance');

  // Holdings endpoint reflects server truth.
  const hold = (await get('/play/meme/holdings?wallet=' + W)).json;
  say(hold.holdings && hold.holdings[mint] && Math.abs(hold.holdings[mint].tokens - sell.position.tokens) < 1e-6, 'holdings endpoint matches server position');

  const health = (await get('/health/play')).json;
  say(health.solvent === true, 'peg solvent (pool ' + health.poolOstg + ' >= total ' + health.playTotal + ')');

  console.log('\n' + (fails === 0 ? 'ALL PASS — memecoins are server-authoritative on the OSTG play balance.' : fails + ' FAIL(S)'));
  process.exit(fails === 0 ? 0 : 1);
})().catch((e) => { console.error('THREW:', e.message || e); process.exit(1); });

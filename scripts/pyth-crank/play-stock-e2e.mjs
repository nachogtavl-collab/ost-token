// PHASE 2 INCREMENT 5d — mirror stocks on the OSTG play balance, server-priced.
// Opens a position (server fetches the LIVE entry price), closes it (server
// fetches the exit price), and confirms the stake was debited, the payout =
// stake*(1±move) minus a 2%-of-profit fee, and the play balance moved correctly.
// The client never supplies a price — a fabricated price is impossible.
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
const r9 = (n) => Math.round(n * 1e9) / 1e9;

(async () => {
  const user = Keypair.generate(); const W = user.publicKey.toBase58();
  console.log('player:', W);
  await post('/wallet/ata-rent', { owner: W, mint: OSTC.toBase58() });
  await sendAndConfirmTransaction(conn, new Transaction().add(createTransferCheckedInstruction(ata(OSTC, authority.publicKey), OSTC, ata(OSTC, user.publicKey), authority.publicKey, raw(20), DEC, [], TP)), [authority], { commitment: 'confirmed' });
  await post('/wallet/ata-rent', { owner: W, mint: OSTG.toBase58() });
  await wait([ata(OSTC, user.publicKey), ata(OSTG, user.publicKey)]);
  await feeOnly(user, [bridgeDep(user.publicKey, 18)]);
  const depSig = await feeOnly(user, [createTransferCheckedInstruction(ata(OSTG, user.publicKey), OSTG, poolAta(OSTG), user.publicKey, raw(15), DEC, [], TP)]);
  await new Promise(r => setTimeout(r, 3000));
  await post('/play/deposit', { wallet: W, signature: depSig });
  say((await get('/play/balance?wallet=' + W)).json.balance === 15, 'play balance = 15');

  // OPEN a long AAPL position with 5 OSTG — server fetches the live entry price.
  console.log('\n1) open a 5 OSTG long on AAPL (server-priced)');
  const open = (await post('/play/stock/open', { wallet: W, symbol: 'AAPL', side: 'long', stake: 5 })).json;
  say(!!open.ok && open.position && open.position.entryPrice > 0, 'open accepted, server set entryPrice=' + (open.position && open.position.entryPrice));
  say(Math.abs(open.balance - 10) < 1e-9, 'stake debited: play balance 15 -> ' + open.balance);
  const posId = open.position.id;

  // Position shows up in the list.
  const posList = (await get('/play/stock/positions?wallet=' + W)).json;
  say(posList.positions && posList.positions.some(p => p.id === posId && p.open), 'open position listed');

  // CLOSE it — server fetches the exit price and computes P&L 1x on the stake.
  console.log('\n2) close the position (server-priced exit + 2% profit fee)');
  const close = (await post('/play/stock/close', { wallet: W, positionId: posId })).json;
  say(!!close.ok && close.exitPrice > 0, 'close accepted, server set exitPrice=' + close.exitPrice);
  const expPayoutGross = Math.max(0, 5 * (1 + (close.exitPrice - open.position.entryPrice) / open.position.entryPrice));
  const expFee = r9(Math.max(0, expPayoutGross - 5) * 0.02);
  const expPayout = r9(expPayoutGross - expFee);
  say(Math.abs(close.payout - expPayout) < 1e-6, 'payout == stake*(1+move) minus 2% profit fee (' + close.payout + ' ~ ' + expPayout + ')');
  say(Math.abs(close.fee - expFee) < 1e-9, 'house fee == 2% of profit (' + close.fee + ')');
  say(Math.abs(close.balance - r9(open.balance + close.payout)) < 1e-6, 'play balance credited by payout');

  // GUARDS
  console.log('\n3) guards');
  const gone = (await post('/play/stock/close', { wallet: W, positionId: posId })).json;
  say(gone.error === 'already_closed' || gone.error === 'unknown_position', 'cannot close the same position twice');
  const broke = (await post('/play/stock/open', { wallet: W, symbol: 'AAPL', side: 'long', stake: 999999 })).json;
  say(broke.error === 'insufficient_balance', 'cannot open beyond the play balance');
  const badSym = (await post('/play/stock/open', { wallet: W, symbol: 'NOTAREALTICKERXYZ', side: 'long', stake: 1 })).json;
  say(badSym.error === 'invalid_symbol' || badSym.error === 'quote_unavailable', 'bad symbol rejected (no fabricated price)');

  const health = (await get('/health/play')).json;
  say(health.solvent === true, 'peg solvent (pool ' + health.poolOstg + ' >= total ' + health.playTotal + ')');

  console.log('\n' + (fails === 0 ? 'ALL PASS — mirror stocks are server-priced on the OSTG play balance.' : fails + ' FAIL(S)'));
  process.exit(fails === 0 ? 0 : 1);
})().catch((e) => { console.error('THREW:', e.message || e); process.exit(1); });

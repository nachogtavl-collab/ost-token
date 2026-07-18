// PHASE 2 INCREMENT 2b — /play/cashout: ledger-gated pool->user OSTG send.
//
// The drain-sensitive half. Proves: a cash-out pays the user real OSTG, debits
// the play balance by exactly that, is gas-free, holds the peg, and — the parts
// that matter most — is IDEMPOTENT (a retry with the same key does NOT double-pay)
// and REJECTS an over-balance cash-out with no debit and no send.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
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
const call = async (method, path, body) => {
  const r = await fetch(API + path, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => ({})) };
};
const post = (p, b) => call('POST', p, b);
const get = (p) => call('GET', p);
const b64 = { enc: (u8) => Buffer.from(u8).toString('base64'), dec: (s) => new Uint8Array(Buffer.from(s, 'base64')) };
const ixJson = (ix) => ({ programId: ix.programId.toBase58(), keys: ix.keys.map(k => ({ pubkey: k.pubkey.toBase58(), isSigner: k.isSigner, isWritable: k.isWritable })), data: b64.enc(ix.data) });
async function feeOnly(userKp, instructions) {
  const built = (await post('/wallet/cosign', { kind: 'fee-only', wallet: userKp.publicKey.toBase58(), instructions: instructions.map(ixJson) })).json;
  const tx = Transaction.from(b64.dec(built.txBase64));
  tx.partialSign(userKp);
  return (await post('/wallet/cosign/submit', { cosignId: built.cosignId, signedTxBase64: b64.enc(tx.serialize({ requireAllSignatures: false, verifySignatures: false })) })).json.sig;
}
function bridgeDepositIx(owner) {
  return new TransactionInstruction({ programId: PROGRAM_ID, keys: [
    { pubkey: BRIDGE, isSigner: false, isWritable: false }, { pubkey: OSTC, isSigner: false, isWritable: true },
    { pubkey: OSTG, isSigner: false, isWritable: true }, { pubkey: VAULT, isSigner: false, isWritable: true },
    { pubkey: ata(OSTC, owner), isSigner: false, isWritable: true }, { pubkey: ata(OSTG, owner), isSigner: false, isWritable: true },
    { pubkey: owner, isSigner: true, isWritable: false }, { pubkey: TP, isSigner: false, isWritable: false },
  ], data: Buffer.concat([disc('deposit'), u64(raw(4))]) });
}
const waitVisible = async (accts) => { for (let i = 0; i < 12; i++) { try { for (const a of accts) await getAccount(conn, a, 'confirmed', TP); return; } catch { await new Promise(r => setTimeout(r, 1200)); } } };

(async () => {
  const user = Keypair.generate();
  console.log('player:', user.publicKey.toBase58());

  // Setup: fund OST -> bridge to OSTG -> deposit 3 to play balance.
  await post('/wallet/ata-rent', { owner: user.publicKey.toBase58(), mint: OSTC.toBase58() });
  await sendAndConfirmTransaction(conn, new Transaction().add(
    createTransferCheckedInstruction(ata(OSTC, authority.publicKey), OSTC, ata(OSTC, user.publicKey), authority.publicKey, raw(5), DEC, [], TP)
  ), [authority], { commitment: 'confirmed' });
  await post('/wallet/ata-rent', { owner: user.publicKey.toBase58(), mint: OSTG.toBase58() });
  await waitVisible([ata(OSTC, user.publicKey), ata(OSTG, user.publicKey)]);
  await feeOnly(user, [bridgeDepositIx(user.publicKey)]);
  const depSig = await feeOnly(user, [createTransferCheckedInstruction(ata(OSTG, user.publicKey), OSTG, poolAta(OSTG), user.publicKey, raw(3), DEC, [], TP)]);
  await new Promise(r => setTimeout(r, 3000));
  await post('/play/deposit', { wallet: user.publicKey.toBase58(), signature: depSig });
  say((await get('/play/balance?wallet=' + user.publicKey.toBase58())).json.balance === 3, 'setup: play balance = 3');
  const walletOstgBefore = await tokBal(ata(OSTG, user.publicKey));  // 1 (bridged 4, deposited 3)
  say(walletOstgBefore === 1, 'setup: wallet holds 1 OSTG');

  // 1) Cash out 2 OSTG.
  console.log('\n1) cash out 2 OSTG (pool -> user, gas-free)');
  const key1 = 'co-' + Date.now();
  const co = await post('/play/cashout', { wallet: user.publicKey.toBase58(), amount: 2, idempotencyKey: key1 });
  say(co.status === 200 && !!co.json.sig, 'cashout confirmed: ' + String(co.json.sig || co.json.error).slice(0, 16) + '…');
  say(co.json.balance === 1, 'play balance 3 -> 1 (debited exactly 2)');
  await new Promise(r => setTimeout(r, 2500));
  say(Math.abs((await tokBal(ata(OSTG, user.publicKey))) - (walletOstgBefore + 2)) < 1e-9, 'user wallet OSTG +2 (received the payout)');
  say((await conn.getBalance(user.publicKey)) === 0, 'user STILL has 0 SOL — cashout gas-sponsored');

  // 2) IDEMPOTENCY — the same key must NOT pay again.
  console.log('\n2) idempotency: retry same key must NOT double-pay');
  const walletAfter1 = await tokBal(ata(OSTG, user.publicKey));
  const co2 = await post('/play/cashout', { wallet: user.publicKey.toBase58(), amount: 2, idempotencyKey: key1 });
  say(co2.json.idempotent === true && co2.json.sig === co.json.sig, 'same sig returned, idempotent flag set');
  say((await get('/play/balance?wallet=' + user.publicKey.toBase58())).json.balance === 1, 'balance still 1 (not debited twice)');
  await new Promise(r => setTimeout(r, 2000));
  say(Math.abs((await tokBal(ata(OSTG, user.publicKey))) - walletAfter1) < 1e-9, 'wallet OSTG unchanged — NO double payout');

  // 3) INSUFFICIENT — cash out more than balance must reject with no debit.
  console.log('\n3) over-balance cash-out must reject, no debit');
  const co3 = await post('/play/cashout', { wallet: user.publicKey.toBase58(), amount: 99, idempotencyKey: 'co-over-' + Date.now() });
  say(co3.status >= 400 && co3.json.error === 'insufficient_balance', 'rejected: ' + JSON.stringify(co3.json.error));
  say((await get('/play/balance?wallet=' + user.publicKey.toBase58())).json.balance === 1, 'balance untouched (still 1)');

  // 4) Peg still solvent.
  const health = (await get('/health/play')).json;
  say(health.solvent === true, 'peg solvent after cashouts (pool ' + health.poolOstg + ' >= total ' + health.playTotal + ')');

  console.log('\n' + (fails === 0 ? 'ALL PASS — cashout pays real OSTG, ledger-gated, idempotent, no double-pay, peg holds.' : fails + ' FAIL(S)'));
  process.exit(fails === 0 ? 0 : 1);
})().catch((e) => { console.error('THREW:', e.message || e); process.exit(1); });

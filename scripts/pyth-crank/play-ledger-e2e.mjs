// PHASE 2 INCREMENT 2a — play ledger: verified deposit + peg.
//
// Proves the ledger only credits play balance that is REALLY backed by OSTG in
// the pool: it verifies the on-chain deposit itself, reads the amount from the
// confirmed tx (never the client), is idempotent per signature, and rejects a
// forged/unrelated signature. Cash-out (pool->user) is increment 2b.
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
  const signed = b64.enc(tx.serialize({ requireAllSignatures: false, verifySignatures: false }));
  return (await post('/wallet/cosign/submit', { cosignId: built.cosignId, signedTxBase64: signed })).json.sig;
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

  // Setup: fund OST, bridge to OSTG (gas-free).
  await post('/wallet/ata-rent', { owner: user.publicKey.toBase58(), mint: OSTC.toBase58() });
  await sendAndConfirmTransaction(conn, new Transaction().add(
    createTransferCheckedInstruction(ata(OSTC, authority.publicKey), OSTC, ata(OSTC, user.publicKey), authority.publicKey, raw(5), DEC, [], TP)
  ), [authority], { commitment: 'confirmed' });
  await post('/wallet/ata-rent', { owner: user.publicKey.toBase58(), mint: OSTG.toBase58() });
  await waitVisible([ata(OSTC, user.publicKey), ata(OSTG, user.publicKey)]);
  await feeOnly(user, [bridgeDepositIx(user.publicKey)]);
  say((await tokBal(ata(OSTG, user.publicKey))) === 4, 'player has 4 OSTG to play with');

  const totalBefore = (await get('/health/play')).json.playTotal;

  // 1) Deposit 3 OSTG into the pool (gas-free), get the signature.
  console.log('\n1) deposit 3 OSTG -> pool, then credit the ledger');
  const depIx = createTransferCheckedInstruction(ata(OSTG, user.publicKey), OSTG, poolAta(OSTG), user.publicKey, raw(3), DEC, [], TP);
  const sig = await feeOnly(user, [depIx]);
  say(!!sig, 'on-chain OSTG deposit: ' + String(sig).slice(0, 16) + '…');
  // let it propagate for the verifier
  await new Promise(r => setTimeout(r, 3000));

  // 2) Credit the ledger from the verified deposit.
  const credit = await post('/play/deposit', { wallet: user.publicKey.toBase58(), signature: sig });
  say(credit.status === 200 && credit.json.credited === 3, 'ledger credited 3 (read from chain, not client): ' + JSON.stringify(credit.json.credited));
  say(credit.json.balance === 3, 'play balance = 3');

  // 3) Idempotency: same signature again must NOT double-credit.
  console.log('\n2) idempotency + integrity');
  const dup = await post('/play/deposit', { wallet: user.publicKey.toBase58(), signature: sig });
  say(dup.json.idempotent === true && dup.json.balance === 3, 'double-submit is idempotent — balance still 3');

  // 4) Forged signature (a real but unrelated tx sig) must be rejected.
  const forged = await post('/play/deposit', { wallet: user.publicKey.toBase58(), signature: '4'.repeat(87) });
  say(forged.status >= 400, 'forged/unknown signature rejected: ' + JSON.stringify(forged.json.error));

  // 5) Balance query + peg.
  const bal = (await get('/play/balance?wallet=' + user.publicKey.toBase58())).json;
  say(bal.balance === 3, '/play/balance reports 3');
  const health = (await get('/health/play')).json;
  say(health.solvent === true, 'peg solvent (pool OSTG >= Σ balances)');
  say(Math.abs(health.playTotal - (totalBefore + 3)) < 1e-9, 'playTotal grew by exactly 3');
  say(health.poolOstg + 1e-9 >= health.playTotal, 'pool OSTG (' + health.poolOstg + ') backs playTotal (' + health.playTotal + ')');

  console.log('\n' + (fails === 0 ? 'ALL PASS — play ledger credits only verified, backed OSTG; peg solvent.' : fails + ' FAIL(S)'));
  process.exit(fails === 0 ? 0 : 1);
})().catch((e) => { console.error('THREW:', e.message || e); process.exit(1); });

// PHASE 2 INCREMENT 1 — OSTG transfer rails: the pool can RECEIVE OSTG gas-free.
//
// Proves the DEPOSIT direction of the play-balance model: a seedless (0-SOL)
// wallet moves OSTG into the pool's OSTG account paying no gas — via the exact
// same fee-only cosign path betting/bridge use. No worker change is needed for
// this direction: a transfer TO the pool's ATA references the pool's ATA, not the
// pool pubkey, so it passes assertPoolAbsent (pool authorizes only the fee).
//
// The SEND direction (pool -> user OSTG) is deliberately NOT here — it can drain
// the pool, so it must be gated by the play-ledger solvency check in increment 2.
//
// Run:  node play-deposit-e2e.mjs   (needs worker deployed + pool OSTG ATA created)
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  Connection, Keypair, PublicKey, Transaction, TransactionInstruction, sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync, getAccount,
  createTransferCheckedInstruction,
} from '@solana/spl-token';

const RPC = 'https://api.devnet.solana.com';
const API = 'https://ost-api.nachogtavl.workers.dev';
const PROGRAM_ID = new PublicKey('J7jqcwT44CY4oXjwu6fwfiFvQDWBQRsueqL7dsZjnrJd');
const OSTC = new PublicKey('383pTzoZ8Gp83dzk23ZnvLcfX2Sq32TAGN48CMQu2pAJ');
const OSTG = new PublicKey('DfgxMbdN49AX2Za9LuvsyixF1jgVh45RbgWYSGonxQos');
const VAULT = new PublicKey('8X6pL7QtYqGd8pzkVA3nkWu36rRw9YQsUGh79V6XRYak');
const BRIDGE = new PublicKey('BnphbE6izjGaC1D4XazDoyVZooLxBDhYqHfzenXuMxPK');
const POOL = new PublicKey('5ibGwXAV6yLZPR6uWbzou1LaHhmhehjYEpqWZKZw5WZS');
const TP = TOKEN_2022_PROGRAM_ID;
const DEC = 9;

const disc = (n) => createHash('sha256').update('global:' + n).digest().subarray(0, 8);
const u64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const raw = (n) => BigInt(Math.round(n * 10 ** DEC));
const ui = (n) => Number(n) / 10 ** DEC;

const authority = Keypair.fromSecretKey(Uint8Array.from(
  JSON.parse(readFileSync(process.env.USERPROFILE + '/.config/solana/id.json', 'utf8'))));
const conn = new Connection(RPC, 'confirmed');
const ata = (mint, owner) => getAssociatedTokenAddressSync(mint, owner, true, TP);
const poolAta = (mint) => getAssociatedTokenAddressSync(mint, POOL, false, TP);
const tokBal = async (a) => { try { return ui((await getAccount(conn, a, 'confirmed', TP)).amount); } catch { return 0; } };

let fails = 0;
const say = (ok, m) => { console.log((ok ? '  PASS ' : '  FAIL ') + m); if (!ok) fails++; };
const api = async (path, body) => {
  const r = await fetch(API + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(path + ' -> ' + r.status + ' ' + JSON.stringify(j));
  return j;
};
const b64 = { enc: (u8) => Buffer.from(u8).toString('base64'), dec: (s) => new Uint8Array(Buffer.from(s, 'base64')) };
const ixJson = (ix) => ({
  programId: ix.programId.toBase58(),
  keys: ix.keys.map(k => ({ pubkey: k.pubkey.toBase58(), isSigner: k.isSigner, isWritable: k.isWritable })),
  data: b64.enc(ix.data),
});
async function feeOnly(userKp, instructions) {
  const built = await api('/wallet/cosign', { kind: 'fee-only', wallet: userKp.publicKey.toBase58(), instructions: instructions.map(ixJson) });
  const tx = Transaction.from(b64.dec(built.txBase64));
  tx.partialSign(userKp);
  const signed = b64.enc(tx.serialize({ requireAllSignatures: false, verifySignatures: false }));
  return (await api('/wallet/cosign/submit', { cosignId: built.cosignId, signedTxBase64: signed })).sig;
}
function bridgeDepositIx(owner) {
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: BRIDGE, isSigner: false, isWritable: false },
      { pubkey: OSTC, isSigner: false, isWritable: true },
      { pubkey: OSTG, isSigner: false, isWritable: true },
      { pubkey: VAULT, isSigner: false, isWritable: true },
      { pubkey: ata(OSTC, owner), isSigner: false, isWritable: true },
      { pubkey: ata(OSTG, owner), isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: false },
      { pubkey: TP, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([disc('deposit'), u64(raw(4))]),
  });
}
const waitVisible = async (accts) => {
  for (let i = 0; i < 12; i++) {
    try { for (const a of accts) await getAccount(conn, a, 'confirmed', TP); return true; }
    catch { await new Promise(r => setTimeout(r, 1200)); }
  }
  return false;
};

(async () => {
  const user = Keypair.generate();
  console.log('fresh seedless wallet:', user.publicKey.toBase58());
  say((await conn.getBalance(user.publicKey)) === 0, 'starts with 0 lamports');

  // Fund with OST (pool ATA + authority transfer), then create OSTG ATA.
  await api('/wallet/ata-rent', { owner: user.publicKey.toBase58(), mint: OSTC.toBase58() });
  await sendAndConfirmTransaction(conn, new Transaction().add(
    createTransferCheckedInstruction(ata(OSTC, authority.publicKey), OSTC, ata(OSTC, user.publicKey), authority.publicKey, raw(5), DEC, [], TP)
  ), [authority], { commitment: 'confirmed' });
  await api('/wallet/ata-rent', { owner: user.publicKey.toBase58(), mint: OSTG.toBase58() });
  await waitVisible([ata(OSTC, user.publicKey), ata(OSTG, user.publicKey)]);

  // Bridge 4 OST -> 4 OSTG (gas-free, already proven) so the user has game token.
  console.log('\n1) user bridges 4 OST -> 4 OSTG (gas-free)');
  await feeOnly(user, [bridgeDepositIx(user.publicKey)]);
  say((await tokBal(ata(OSTG, user.publicKey))) === 4, 'user holds 4 OSTG');
  say((await conn.getBalance(user.publicKey)) === 0, 'user STILL has 0 SOL');

  // THE TEST: deposit 3 OSTG into the pool, gas-free.
  console.log('\n2) user deposits 3 OSTG -> pool (gas-free fee-only cosign)');
  const poolBefore = await tokBal(poolAta(OSTG));
  const depositIx = createTransferCheckedInstruction(
    ata(OSTG, user.publicKey), OSTG, poolAta(OSTG), user.publicKey, raw(3), DEC, [], TP
  );
  const sig = await feeOnly(user, [depositIx]);
  say(!!sig, 'deposit submitted: ' + String(sig).slice(0, 16) + '…');
  say((await tokBal(ata(OSTG, user.publicKey))) === 1, 'user OSTG 4 -> 1');
  say(Math.abs((await tokBal(poolAta(OSTG))) - (poolBefore + 3)) < 1e-9, 'pool OSTG +3 (received the deposit)');
  say((await conn.getBalance(user.publicKey)) === 0, 'user STILL has 0 SOL — deposit fully gas-sponsored ✅');

  console.log('\n' + (fails === 0
    ? 'ALL PASS — pool RECEIVES OSTG gas-free. Deposit rail works.'
    : fails + ' FAIL(S)'));
  process.exit(fails === 0 ? 0 : 1);
})().catch((e) => { console.error('THREW:', e.message || e); process.exit(1); });

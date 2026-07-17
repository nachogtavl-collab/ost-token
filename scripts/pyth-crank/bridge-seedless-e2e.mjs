// GAS-FREE SEEDLESS BRIDGE — the proof that matters.
//
// A brand-new wallet with ZERO SOL, that has never been airdropped, must be able
// to bridge OST <-> OSTG paying NO gas — the fee account (pool) sponsors both the
// network fee and the token-account rent, exactly as it does for OST. And the
// SAME wallet holds both tokens (one keypair, an ATA per mint).
//
// Replicates the browser flow verbatim: /wallet/ata-rent (pool-paid ATA) then the
// two-step fee-only /wallet/cosign (pool pays gas, user signs their own leg).
//
// Run:  node bridge-seedless-e2e.mjs   (needs the worker deployed with the
//       mint-aware /wallet/ata-rent change)
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  Connection, Keypair, PublicKey, Transaction, TransactionInstruction, sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync, getMint, getAccount,
  createTransferCheckedInstruction,
} from '@solana/spl-token';

const RPC = 'https://api.devnet.solana.com';
const API = 'https://ost-api.nachogtavl.workers.dev';
const PROGRAM_ID = new PublicKey('J7jqcwT44CY4oXjwu6fwfiFvQDWBQRsueqL7dsZjnrJd');
const OSTC = new PublicKey('383pTzoZ8Gp83dzk23ZnvLcfX2Sq32TAGN48CMQu2pAJ');
const OSTG = new PublicKey('DfgxMbdN49AX2Za9LuvsyixF1jgVh45RbgWYSGonxQos');
const VAULT = new PublicKey('8X6pL7QtYqGd8pzkVA3nkWu36rRw9YQsUGh79V6XRYak');
const BRIDGE = new PublicKey('BnphbE6izjGaC1D4XazDoyVZooLxBDhYqHfzenXuMxPK');
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
const tokBal = async (a) => { try { return ui((await getAccount(conn, a, 'confirmed', TP)).amount); } catch { return 0; } };
const supply = async (m) => ui((await getMint(conn, m, 'confirmed', TP)).supply);

let fails = 0;
const say = (ok, m) => { console.log((ok ? '  PASS ' : '  FAIL ') + m); if (!ok) fails++; };
const api = async (path, body) => {
  const r = await fetch(API + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(path + ' -> ' + r.status + ' ' + JSON.stringify(j));
  return j;
};
const b64 = { enc: (u8) => Buffer.from(u8).toString('base64'), dec: (s) => new Uint8Array(Buffer.from(s, 'base64')) };

function bridgeIx(name, owner) {
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
    data: Buffer.concat([disc(name), u64(raw(3))]),
  });
}
const ixJson = (ix) => ({
  programId: ix.programId.toBase58(),
  keys: ix.keys.map(k => ({ pubkey: k.pubkey.toBase58(), isSigner: k.isSigner, isWritable: k.isWritable })),
  data: b64.enc(ix.data),
});

// The browser's cosignSwap('fee-only'), in Node, signing with a raw keypair.
async function feeOnly(userKp, instructions) {
  const built = await api('/wallet/cosign', {
    kind: 'fee-only', wallet: userKp.publicKey.toBase58(), instructions: instructions.map(ixJson),
  });
  const tx = Transaction.from(b64.dec(built.txBase64));
  tx.partialSign(userKp);
  const signed = b64.enc(tx.serialize({ requireAllSignatures: false, verifySignatures: false }));
  const res = await api('/wallet/cosign/submit', { cosignId: built.cosignId, signedTxBase64: signed });
  return res.sig;
}

(async () => {
  // A fresh wallet that has NEVER touched SOL.
  const user = Keypair.generate();
  console.log('fresh seedless wallet:', user.publicKey.toBase58());
  const sol0 = await conn.getBalance(user.publicKey);
  say(sol0 === 0, 'starts with 0 lamports (truly seedless)');

  // 1) Pool creates the user's OST account (pool-paid), then authority funds it
  //    with 5 OST so the user has something to bridge — but still no SOL.
  console.log('\n1) fund the seedless wallet with OST (pool creates the ATA, no user SOL)');
  await api('/wallet/ata-rent', { owner: user.publicKey.toBase58(), mint: OSTC.toBase58() });
  say(true, 'pool created user OST account');
  await sendAndConfirmTransaction(conn, new Transaction().add(
    createTransferCheckedInstruction(ata(OSTC, authority.publicKey), OSTC, ata(OSTC, user.publicKey), authority.publicKey, raw(5), DEC, [], TP)
  ), [authority], { commitment: 'confirmed' });
  say((await tokBal(ata(OSTC, user.publicKey))) === 5, 'user holds 5 OST');
  say((await conn.getBalance(user.publicKey)) === 0, 'user STILL has 0 SOL');

  // 2) Pool creates the user's OSTG account (mint-aware ata-rent).
  console.log('\n2) pool creates the user OSTG account (mint-aware ata-rent)');
  const r = await api('/wallet/ata-rent', { owner: user.publicKey.toBase58(), mint: OSTG.toBase58() });
  say(!!r.ata, 'pool created user OSTG account: ' + r.ata);
  say((await conn.getBalance(user.publicKey)) === 0, 'user STILL has 0 SOL (pool paid the rent)');
  // Confirm BOTH ATAs are visible on our own connection before depositing.
  let seen = false;
  for (let i = 0; i < 10 && !seen; i++) {
    try { await getAccount(conn, ata(OSTG, user.publicKey), 'confirmed', TP); await getAccount(conn, ata(OSTC, user.publicKey), 'confirmed', TP); seen = true; }
    catch { await new Promise(r => setTimeout(r, 1500)); }
  }
  say(seen, 'both user ATAs visible on-chain before deposit');

  const pegBefore = { s: await supply(OSTG), v: await tokBal(VAULT) };

  // 3) GAS-FREE deposit 3 OST -> 3 OSTG via fee-only cosign.
  console.log('\n3) gas-free deposit: 3 OST -> 3 OSTG (pool pays gas, user signs)');
  let depSig, tries = 0;
  while (true) {
    try { depSig = await feeOnly(user, [bridgeIx('deposit', user.publicKey)]); break; }
    catch (e) {
      if (++tries >= 4) throw e;
      console.log('    retry deposit after transient:', String(e.message).slice(0, 70));
      await new Promise(r => setTimeout(r, 2500));
    }
  }
  say(!!depSig, 'deposit submitted: ' + String(depSig).slice(0, 16) + '…');
  say((await tokBal(ata(OSTC, user.publicKey))) === 2, 'user OST 5 -> 2');
  say((await tokBal(ata(OSTG, user.publicKey))) === 3, 'user OSTG 0 -> 3 (minted 1:1)');
  say((await conn.getBalance(user.publicKey)) === 0, 'user STILL has 0 SOL — gas fully sponsored ✅');

  // 4) GAS-FREE withdraw 3 OSTG -> 3 OST, back to start.
  console.log('\n4) gas-free withdraw: 3 OSTG -> 3 OST');
  const wSig = await feeOnly(user, [bridgeIx('withdraw', user.publicKey)]);
  say(!!wSig, 'withdraw submitted: ' + String(wSig).slice(0, 16) + '…');
  say((await tokBal(ata(OSTG, user.publicKey))) === 0, 'user OSTG 3 -> 0 (burned)');
  say((await tokBal(ata(OSTC, user.publicKey))) === 5, 'user OST 2 -> 5 (released)');
  say((await conn.getBalance(user.publicKey)) === 0, 'user STILL has 0 SOL after two bridges');

  // 5) Peg unchanged overall (deposit then withdraw nets to zero).
  const pegAfter = { s: await supply(OSTG), v: await tokBal(VAULT) };
  say(Math.abs(pegAfter.s - pegAfter.v) < 1e-9, `PEG holds: supply(OSTG)=${pegAfter.s} == vault(OSTC)=${pegAfter.v}`);
  say(Math.abs(pegAfter.s - pegBefore.s) < 1e-9, 'net peg change zero across the round trip');

  console.log('\n' + (fails === 0
    ? 'ALL PASS — a 0-SOL wallet bridged both ways, paid NOTHING, holds both tokens.'
    : fails + ' FAIL(S)'));
  process.exit(fails === 0 ? 0 : 1);
})().catch((e) => { console.error('THREW:', e.message || e); process.exit(1); });

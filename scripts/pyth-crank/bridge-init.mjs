// OST BRIDGE — REAL initialization + proof with the LIVE OST mint.
//
// This pins the production bridge: OSTC = the real OST mint (383pTz...), OSTG =
// the canonical new mint (keys/ostg-mint.json, authority = bridge PDA). Unlike
// bridge-e2e.mjs (throwaway mint), this touches REAL OST — but only a tiny
// round-trip that returns to zero, so the vault starts clean.
//
// Idempotent: re-running skips the OSTG-mint create and the initialize if they
// already exist, so it is safe to run again.
//
// Run:  node bridge-init.mjs
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  TOKEN_2022_PROGRAM_ID, createMint, getMint, getAccount, getOrCreateAssociatedTokenAccount,
} from '@solana/spl-token';

const RPC = 'https://api.devnet.solana.com';
const PROGRAM_ID = new PublicKey('J7jqcwT44CY4oXjwu6fwfiFvQDWBQRsueqL7dsZjnrJd');
const OSTC = new PublicKey('383pTzoZ8Gp83dzk23ZnvLcfX2Sq32TAGN48CMQu2pAJ'); // the REAL OST mint
const DEC = 9;
const TP = TOKEN_2022_PROGRAM_ID;

const disc = (n) => createHash('sha256').update('global:' + n).digest().subarray(0, 8);
const u64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const raw = (n) => BigInt(Math.round(n * 10 ** DEC));
const ui = (n) => Number(n) / 10 ** DEC;
const link = (s) => `https://explorer.solana.com/tx/${s}?cluster=devnet`;

const kp = (p) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(p, 'utf8'))));
const authority = kp(process.env.USERPROFILE + '/.config/solana/id.json');
const ostgKeypair = kp('../../keys/ostg-mint.json');
const conn = new Connection(RPC, 'confirmed');

let fails = 0;
const say = (ok, m) => { console.log((ok ? '  PASS ' : '  FAIL ') + m); if (!ok) fails++; };
const tokBal = async (a) => { try { return ui((await getAccount(conn, a, 'confirmed', TP)).amount); } catch { return 0; } };
const supply = async (m) => ui((await getMint(conn, m, 'confirmed', TP)).supply);
const send = (ix, s = [authority]) => sendAndConfirmTransaction(conn, new Transaction().add(ix), s, { commitment: 'confirmed' });

const [bridge] = PublicKey.findProgramAddressSync([Buffer.from('bridge'), OSTC.toBuffer()], PROGRAM_ID);
const [vault] = PublicKey.findProgramAddressSync([Buffer.from('vault'), bridge.toBuffer()], PROGRAM_ID);
const OSTG = ostgKeypair.publicKey;

(async () => {
  console.log('PRODUCTION BRIDGE');
  console.log('  program :', PROGRAM_ID.toBase58());
  console.log('  OSTC    :', OSTC.toBase58(), '(real OST)');
  console.log('  OSTG    :', OSTG.toBase58());
  console.log('  bridge  :', bridge.toBase58());
  console.log('  vault   :', vault.toBase58());

  // 1) Create the canonical OSTG mint if it does not exist yet: authority = the
  //    bridge PDA, freeze authority = None, 9 decimals (matches OST).
  console.log('\n1) OSTG mint');
  if (await conn.getAccountInfo(OSTG)) {
    say(true, 'OSTG mint already exists — skipping create');
  } else {
    const created = await createMint(conn, authority, bridge, null, DEC, ostgKeypair, undefined, TP);
    say(created.equals(OSTG), 'created OSTG mint (auth = bridge PDA, freeze = None)');
  }
  const mintInfo = await getMint(conn, OSTG, 'confirmed', TP);
  say(mintInfo.mintAuthority?.equals(bridge) === true, 'OSTG mint authority IS the bridge PDA');
  say(mintInfo.freezeAuthority === null, 'OSTG freeze authority is None');
  say(mintInfo.decimals === DEC, 'OSTG decimals = 9 (matches OST)');

  // 2) initialize (skip if already done)
  console.log('\n2) initialize');
  if (await conn.getAccountInfo(bridge)) {
    say(true, 'bridge already initialized — skipping');
  } else {
    const sig = await send(new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: bridge, isSigner: false, isWritable: true },
        { pubkey: OSTC, isSigner: false, isWritable: false },
        { pubkey: OSTG, isSigner: false, isWritable: false },
        { pubkey: vault, isSigner: false, isWritable: true },
        { pubkey: authority.publicKey, isSigner: true, isWritable: true },
        { pubkey: TP, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: new PublicKey('SysvarRent111111111111111111111111111111111'), isSigner: false, isWritable: false },
      ],
      data: disc('initialize'),
    }));
    say(true, 'initialized  ' + link(sig));
  }

  // 3) Real round-trip with actual OST: deposit 10, withdraw 10, back to zero.
  console.log('\n3) real OST round-trip (deposit 10, withdraw 10 -> vault back to 0)');
  const userOstc = (await getOrCreateAssociatedTokenAccount(conn, authority, OSTC, authority.publicKey, false, 'confirmed', undefined, TP)).address;
  const userOstg = (await getOrCreateAssociatedTokenAccount(conn, authority, OSTG, authority.publicKey, false, 'confirmed', undefined, TP)).address;

  const ix = (name, amount) => new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: bridge, isSigner: false, isWritable: false },
      { pubkey: OSTC, isSigner: false, isWritable: true },
      { pubkey: OSTG, isSigner: false, isWritable: true },
      { pubkey: vault, isSigner: false, isWritable: true },
      { pubkey: userOstc, isSigner: false, isWritable: true },
      { pubkey: userOstg, isSigner: false, isWritable: true },
      { pubkey: authority.publicKey, isSigner: true, isWritable: false },
      { pubkey: TP, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([disc(name), u64(amount)]),
  });
  const peg = async (label) => {
    const s = await supply(OSTG), v = await tokBal(vault);
    say(Math.abs(s - v) < 1e-9, `PEG ${label}: supply(OSTG)=${s} == vault(OSTC)=${v}`);
  };

  const ostcBefore = await tokBal(userOstc);
  const ostgBefore = await tokBal(userOstg);

  let sig = await send(ix('deposit', raw(10)));
  console.log('   deposit', link(sig));
  say(Math.abs((await tokBal(userOstc)) - (ostcBefore - 10)) < 1e-6, 'real OST -10 from wallet');
  say(Math.abs((await tokBal(userOstg)) - (ostgBefore + 10)) < 1e-6, 'OSTG +10 minted 1:1');
  await peg('after real deposit');

  sig = await send(ix('withdraw', raw(10)));
  console.log('   withdraw', link(sig));
  say(Math.abs((await tokBal(userOstc)) - ostcBefore) < 1e-6, 'real OST returned to wallet');
  say(Math.abs((await tokBal(userOstg)) - ostgBefore) < 1e-6, 'OSTG burned back');
  say((await tokBal(vault)) === 0, 'vault back to 0 — bridge starts clean');
  await peg('final');

  console.log('\n' + (fails === 0
    ? 'PRODUCTION BRIDGE LIVE — OSTG=' + OSTG.toBase58() + '  bridge=' + bridge.toBase58()
    : fails + ' FAIL(S)'));
  process.exit(fails === 0 ? 0 : 1);
})().catch((e) => { console.error('THREW:', e.message || e); process.exit(1); });

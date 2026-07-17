// OST BRIDGE — end-to-end proof on devnet.
//
// Proves the ONE thing the whole architecture rests on: the peg holds by
// construction. deposit mints exactly what it escrows; withdraw burns exactly
// what it releases; at every step  supply(OSTG) == vault(OSTC).
//
// Uses a THROWAWAY OSTC test mint (mint authority = us) so we can fund a wallet
// freely and never touch the real OST supply. The bridge logic is identical
// whichever mint is pinned as OSTC; real initialize() will pin the live OST mint.
//
// Run:  node bridge-e2e.mjs
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  Connection, Keypair, PublicKey, SystemProgram, Transaction,
  TransactionInstruction, sendAndConfirmTransaction, LAMPORTS_PER_SOL
} from '@solana/web3.js';
import {
  TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync,
  createMint, mintTo, getMint, getAccount, getOrCreateAssociatedTokenAccount
} from '@solana/spl-token';

const RPC = 'https://api.devnet.solana.com';
const PROGRAM_ID = new PublicKey('J7jqcwT44CY4oXjwu6fwfiFvQDWBQRsueqL7dsZjnrJd');
const DEC = 9;
const TP = TOKEN_2022_PROGRAM_ID;

const disc = (n) => createHash('sha256').update('global:' + n).digest().subarray(0, 8);
const u64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const raw = (n) => BigInt(Math.round(n * 10 ** DEC));
const ui = (n) => Number(n) / 10 ** DEC;
const link = (s) => `https://explorer.solana.com/tx/${s}?cluster=devnet`;

const authority = Keypair.fromSecretKey(Uint8Array.from(
  JSON.parse(readFileSync(process.env.USERPROFILE + '/.config/solana/id.json', 'utf8'))));
const conn = new Connection(RPC, 'confirmed');

let fails = 0;
const say = (ok, m) => { console.log((ok ? '  PASS ' : '  FAIL ') + m); if (!ok) fails++; };
const tokBal = async (a) => { try { return ui((await getAccount(conn, a, 'confirmed', TP)).amount); } catch { return 0; } };
const supply = async (m) => ui((await getMint(conn, m, 'confirmed', TP)).supply);

// PDAs
const [bridge] = PublicKey.findProgramAddressSync([Buffer.from('bridge')], PROGRAM_ID);
const [vault] = PublicKey.findProgramAddressSync([Buffer.from('vault'), bridge.toBuffer()], PROGRAM_ID);

async function send(ix, signers = [authority]) {
  return sendAndConfirmTransaction(conn, new Transaction().add(ix), signers, { commitment: 'confirmed' });
}

(async () => {
  console.log('bridge PDA :', bridge.toBase58());
  console.log('vault  PDA :', vault.toBase58());

  // 1) Throwaway OSTC test mint (we hold mint authority so we can fund freely).
  console.log('\n1) create test OSTC mint + OSTG mint (authority = bridge PDA)');
  const ostcMint = await createMint(conn, authority, authority.publicKey, null, DEC, undefined, undefined, TP);
  say(true, 'OSTC test mint ' + ostcMint.toBase58());

  // 2) OSTG mint — authority = the bridge PDA, freeze authority = None. This is
  //    the exact requirement flagged in the program: mint authority must be the
  //    PDA (so only the program can mint) and NO freeze authority (so nobody can
  //    lock user OSTG).
  const ostgMint = await createMint(conn, authority, bridge, null, DEC, undefined, undefined, TP);
  say(true, 'OSTG mint      ' + ostgMint.toBase58() + '  (mint auth = bridge PDA, freeze = None)');

  // 3) initialize the bridge
  console.log('\n2) initialize');
  let sig = await send(new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: bridge, isSigner: false, isWritable: true },
      { pubkey: ostcMint, isSigner: false, isWritable: false },
      { pubkey: ostgMint, isSigner: false, isWritable: false },
      { pubkey: vault, isSigner: false, isWritable: true },
      { pubkey: authority.publicKey, isSigner: true, isWritable: true },
      { pubkey: TP, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: new PublicKey('SysvarRent111111111111111111111111111111111'), isSigner: false, isWritable: false },
    ],
    data: disc('initialize'),
  }));
  console.log('   ', link(sig));
  say((await tokBal(vault)) === 0, 'vault created, empty');
  say((await supply(ostgMint)) === 0, 'OSTG supply starts at 0');

  // 4) user accounts + fund the user with test OSTC
  const userOstc = (await getOrCreateAssociatedTokenAccount(conn, authority, ostcMint, authority.publicKey, false, 'confirmed', undefined, TP)).address;
  const userOstg = (await getOrCreateAssociatedTokenAccount(conn, authority, ostgMint, authority.publicKey, false, 'confirmed', undefined, TP)).address;
  await mintTo(conn, authority, ostcMint, userOstc, authority, raw(100), [], undefined, TP);
  say((await tokBal(userOstc)) === 100, 'user funded with 100 test OSTC');

  const depositIx = (amount) => new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: bridge, isSigner: false, isWritable: false },
      { pubkey: ostcMint, isSigner: false, isWritable: true },
      { pubkey: ostgMint, isSigner: false, isWritable: true },
      { pubkey: vault, isSigner: false, isWritable: true },
      { pubkey: userOstc, isSigner: false, isWritable: true },
      { pubkey: userOstg, isSigner: false, isWritable: true },
      { pubkey: authority.publicKey, isSigner: true, isWritable: false },
      { pubkey: TP, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([disc('deposit'), u64(amount)]),
  });
  const withdrawIx = (amount) => new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: bridge, isSigner: false, isWritable: false },
      { pubkey: ostcMint, isSigner: false, isWritable: true },
      { pubkey: ostgMint, isSigner: false, isWritable: true },
      { pubkey: vault, isSigner: false, isWritable: true },
      { pubkey: userOstc, isSigner: false, isWritable: true },
      { pubkey: userOstg, isSigner: false, isWritable: true },
      { pubkey: authority.publicKey, isSigner: true, isWritable: false },
      { pubkey: TP, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([disc('withdraw'), u64(amount)]),
  });

  const peg = async (label) => {
    const s = await supply(ostgMint), v = await tokBal(vault);
    say(Math.abs(s - v) < 1e-9, `PEG ${label}: supply(OSTG)=${s} == vault(OSTC)=${v}`);
  };

  // 5) DEPOSIT 40
  console.log('\n3) deposit 40 OSTC -> 40 OSTG');
  sig = await send(depositIx(raw(40)));
  console.log('   ', link(sig));
  say((await tokBal(userOstc)) === 60, 'user OSTC 100 -> 60');
  say((await tokBal(userOstg)) === 40, 'user OSTG 0 -> 40 (minted 1:1)');
  say((await tokBal(vault)) === 40, 'vault 0 -> 40 (escrowed)');
  await peg('after deposit');

  // 6) WITHDRAW 15
  console.log('\n4) withdraw 15 OSTG -> 15 OSTC');
  sig = await send(withdrawIx(raw(15)));
  console.log('   ', link(sig));
  say((await tokBal(userOstg)) === 25, 'user OSTG 40 -> 25 (burned)');
  say((await tokBal(userOstc)) === 75, 'user OSTC 60 -> 75 (released)');
  say((await tokBal(vault)) === 25, 'vault 40 -> 25');
  await peg('after withdraw');

  // 7) ADVERSARIAL — withdraw more OSTG than we hold must FAIL (burn underflows).
  console.log('\n5) adversarial: withdraw 999 (more OSTG than held) must be rejected');
  let rejected = false;
  try { await send(withdrawIx(raw(999))); } catch { rejected = true; }
  say(rejected, 'over-withdraw rejected (cannot release OSTC against OSTG you do not have)');
  await peg('after rejected over-withdraw (unchanged)');

  // 8) ADVERSARIAL — deposit 0 must FAIL (ZeroAmount).
  console.log('\n6) adversarial: deposit 0 must be rejected');
  rejected = false;
  try { await send(depositIx(0)); } catch { rejected = true; }
  say(rejected, 'zero deposit rejected');

  // 9) round-trip everything out, peg must return to a clean state.
  console.log('\n7) withdraw remaining 25 -> peg returns to 0/0');
  sig = await send(withdrawIx(raw(25)));
  say((await tokBal(userOstg)) === 0, 'user OSTG back to 0');
  say((await supply(ostgMint)) === 0, 'OSTG supply back to 0 (all burned)');
  say((await tokBal(vault)) === 0, 'vault back to 0 (all released)');
  await peg('final');

  console.log('\n' + (fails === 0 ? 'ALL PASS — bridge peg holds by construction' : fails + ' FAIL(S)'));
  process.exit(fails === 0 ? 0 : 1);
})().catch((e) => { console.error('THREW:', e.message || e); process.exit(1); });

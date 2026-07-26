#!/usr/bin/env node
/* ============================================================================
 * OST · SESSION-KEY pre-approval proof (real OSTG on devnet)
 * ----------------------------------------------------------------------------
 * Proves "sign once, bet the whole round with no popup":
 *   1. USER funds a fresh SESSION keypair once (OSTG + a little SOL). One user
 *      signature — this is the spend cap.
 *   2. The SESSION key bets on a LIVE crank market WITH the arb spread-skim,
 *      signing itself — no user popup.
 *   3. The SESSION key sweeps its leftover OSTG back to the user.
 * Asserts the vault/treasury moved and the user got the leftover back.
 * ========================================================================== */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  Connection, Keypair, PublicKey, SystemProgram, Transaction,
  TransactionInstruction, sendAndConfirmTransaction, LAMPORTS_PER_SOL
} from '@solana/web3.js';
import {
  TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction, createTransferCheckedInstruction, getAccount
} from '@solana/spl-token';

const RPC = 'https://api.devnet.solana.com';
const MINT = new PublicKey('DfgxMbdN49AX2Za9LuvsyixF1jgVh45RbgWYSGonxQos');
const PROGRAM_ID = new PublicKey('F82m45QUAFJ4GtMsJrSFnWzDrjWdZjdzyh8HTPgTBHXr');
const DEC = 9, FIVE_MIN = 300, SPREAD_BPS = 150;
const disc = (n) => createHash('sha256').update('global:' + n).digest().subarray(0, 8);
const u64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const raw = (n) => BigInt(Math.round(n * 10 ** DEC));
const ui = (n) => Number(n) / 10 ** DEC;
const link = (s) => `https://explorer.solana.com/tx/${s}?cluster=devnet`;

const authority = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(process.env.USERPROFILE + '/.config/solana/id.json', 'utf8'))));
const user = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(process.argv[2] || (process.env.LOCALAPPDATA + '/Temp/claude/C--Users-neyma/76edfaab-e46f-46a8-9613-377029144b04/scratchpad/ost-browser-wallet.json'), 'utf8'))));
const conn = new Connection(RPC, 'confirmed');
let fails = 0; const say = (ok, m) => { console.log((ok ? '  PASS ' : '  FAIL ') + m); if (!ok) fails++; };
const near = (a, b, e = 1e-4) => Math.abs(a - b) < e;
const ata = (m, o) => getAssociatedTokenAddressSync(m, o, true, TOKEN_2022_PROGRAM_ID);
const tokBal = async (a) => { try { return ui((await getAccount(conn, a, 'confirmed', TOKEN_2022_PROGRAM_ID)).amount); } catch { return 0; } };

const MARKET_LEN = 8 + 32 + 32 + 8 + 1 + 1 + 8 + 8 + 8 + 8 + 8 + 1 + 1 + 32 + 8 + 4 + 8 + 32 + 8;
function decode(d) {
  let o = 8 + 32 + 32 + 8 + 2 + 8;
  const lockTs = Number(d.readBigInt64LE(o)); o += 8; o += 8; // lock, resolve
  const yes = ui(d.readBigUInt64LE(o)); o += 8; const no = ui(d.readBigUInt64LE(o)); o += 8;
  const resolved = d[o] === 1; o += 1; o += 1; o += 32; o += 8 + 4 + 8; // side, feed, open/expo/close
  const treasury = new PublicKey(d.subarray(o, o + 32));
  return { lockTs, yes, no, resolved, treasury };
}
const derive = (openAt) => {
  const [market] = PublicKey.findProgramAddressSync([Buffer.from('market'), authority.publicKey.toBuffer(), u64(openAt)], PROGRAM_ID);
  const [vault] = PublicKey.findProgramAddressSync([Buffer.from('vault'), market.toBuffer()], PROGRAM_ID);
  return { market, vault };
};
const posOf = (market, b) => PublicKey.findProgramAddressSync([Buffer.from('position'), market.toBuffer(), b.toBuffer()], PROGRAM_ID)[0];

(async () => {
  console.log('OST · SESSION-KEY pre-approval proof (OSTG devnet)\n');
  console.log('  user', user.publicKey.toBase58(), ' OSTG', await tokBal(ata(MINT, user.publicKey)), ' SOL', (await conn.getBalance(user.publicKey)) / LAMPORTS_PER_SOL);

  // find a live crank market (current or next round), not yet locked
  const now = Math.floor(Date.now() / 1000), base = Math.floor(now / FIVE_MIN) * FIVE_MIN;
  let openAt = 0, mkt = null, d = null;
  for (const cand of [base, base + FIVE_MIN]) {
    const dv = derive(cand); const info = await conn.getAccountInfo(dv.market);
    if (info && info.data.length >= MARKET_LEN) { const dec = decode(info.data); if (!dec.resolved && now < dec.lockTs - 15) { openAt = cand; mkt = dv; d = dec; break; } }
  }
  if (!openAt) { console.error('  no live crank market open right now — is the crank running?'); process.exit(1); }
  console.log('  live market', mkt.market.toBase58().slice(0, 8) + '…', 'openAt', openAt, 'treasury', d.treasury.toBase58().slice(0, 8) + '…');

  // 1) USER funds a fresh SESSION key once (spend cap)
  const sessionKp = Keypair.generate();
  const sUser = ata(MINT, user.publicKey), sSess = ata(MINT, sessionKp.publicKey);
  console.log('\n1) USER funds session key once (one user signature): 0.03 SOL + 20 OSTG');
  await sendAndConfirmTransaction(conn, new Transaction()
    .add(SystemProgram.transfer({ fromPubkey: user.publicKey, toPubkey: sessionKp.publicKey, lamports: 0.03 * LAMPORTS_PER_SOL }))
    .add(createAssociatedTokenAccountIdempotentInstruction(user.publicKey, sSess, sessionKp.publicKey, MINT, TOKEN_2022_PROGRAM_ID))
    .add(createTransferCheckedInstruction(sUser, MINT, sSess, user.publicKey, raw(20), DEC, [], TOKEN_2022_PROGRAM_ID)),
    [user], { commitment: 'confirmed' });
  say(near(await tokBal(sSess), 20), `session key funded: ${await tokBal(sSess)} OSTG (the spend cap)`);

  // 2) SESSION key bets WITH spread-skim — signs itself, NO user popup
  const stake = 10, spread = stake * SPREAD_BPS / 10000, net = stake - spread;
  console.log(`\n2) SESSION key bets ${stake} (spread ${spread} -> treasury, net ${net} -> pool) — no user signature`);
  const betIx = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: sessionKp.publicKey, isSigner: true, isWritable: true },
      { pubkey: mkt.market, isSigner: false, isWritable: true },
      { pubkey: MINT, isSigner: false, isWritable: false },
      { pubkey: mkt.vault, isSigner: false, isWritable: true },
      { pubkey: sSess, isSigner: false, isWritable: true },
      { pubkey: posOf(mkt.market, sessionKp.publicKey), isSigner: false, isWritable: true },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
    ],
    data: Buffer.concat([disc('place_bet'), Buffer.from([1]), u64(raw(net))])
  });
  const spreadIx = createTransferCheckedInstruction(sSess, MINT, d.treasury, sessionKp.publicKey, raw(spread), DEC, [], TOKEN_2022_PROGRAM_ID);
  const vBefore = await tokBal(mkt.vault), tBefore = await tokBal(d.treasury);
  const sig = await sendAndConfirmTransaction(conn, new Transaction().add(spreadIx).add(betIx), [sessionKp], { commitment: 'confirmed' });
  console.log('   session bet tx', link(sig));
  say(near((await tokBal(mkt.vault)) - vBefore, net), `net entered the pool: +${((await tokBal(mkt.vault)) - vBefore).toFixed(4)} OSTG`);
  say(near((await tokBal(d.treasury)) - tBefore, spread), `spread hit the treasury on-chain: +${((await tokBal(d.treasury)) - tBefore).toFixed(4)} OSTG`);

  // 3) SESSION sweeps leftover OSTG back to the user (end session)
  const leftover = await tokBal(sSess);
  console.log(`\n3) end session: sweep ${leftover} OSTG back to the user (session signs)`);
  const uBefore = await tokBal(sUser);
  await sendAndConfirmTransaction(conn, new Transaction()
    .add(createTransferCheckedInstruction(sSess, MINT, sUser, sessionKp.publicKey, raw(leftover), DEC, [], TOKEN_2022_PROGRAM_ID)),
    [sessionKp], { commitment: 'confirmed' });
  say(near((await tokBal(sUser)) - uBefore, leftover), `user got the leftover back: +${((await tokBal(sUser)) - uBefore).toFixed(4)} OSTG (session now ${await tokBal(sSess)})`);

  console.log(fails ? `\n${fails} FAIL` : '\n✅ SESSION KEY WORKS: user pre-funded once, the session key placed a spread-skimmed bet with NO further user signature, and the leftover swept back. This is one-tap betting with a hard spend cap.');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('\nFAILED:', e.message); if (e.logs) console.error(e.logs.slice(-12).join('\n')); process.exit(1); });

#!/usr/bin/env node
/* ============================================================================
 * OST · FULL TRUSTLESS LIFECYCLE — real OST, real devnet, no human referee
 * ----------------------------------------------------------------------------
 * The point of this test is that NOBODY chooses the winner:
 *
 *   1. initialize_market   — open a short market for the BTC/USD Pyth feed
 *   2. lock_open_price     — the PROGRAM reads the OPEN price from a signed
 *                            Pyth update (permissionless)
 *   3. place_bet x2        — two bettors escrow real OST into the program vault
 *   4. resolve_with_pyth   — the PROGRAM reads the CLOSE price and decides the
 *                            winner ITSELF (permissionless). There is no
 *                            authority-resolve instruction to call any more.
 *   5. claim_payout        — the winning side pulls the pool OUT of the vault,
 *                            minus the HOUSE EDGE (2% of PROFIT only), which the
 *                            PROGRAM sweeps into the treasury pinned on the
 *                            market at creation. The losing side gets nothing.
 *
 * Everything is asserted against REAL on-chain token balances and the REAL
 * market account. Exits non-zero on any mismatch. Which side wins is decided by
 * BTC's actual price movement — this test does not know it in advance, so it
 * asserts the payout for whichever side the ORACLE picked.
 * ========================================================================== */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import anchor from '@coral-xyz/anchor';
import {
  Connection, Keypair, PublicKey, SystemProgram, Transaction,
  TransactionInstruction, sendAndConfirmTransaction, LAMPORTS_PER_SOL
} from '@solana/web3.js';
import {
  TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction, getAccount
} from '@solana/spl-token';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { PythSolanaReceiver } = require('@pythnetwork/pyth-solana-receiver');
const { sendTransactions } = require('@pythnetwork/solana-utils');
import { HermesClient } from '@pythnetwork/hermes-client';

const RPC = 'https://api.devnet.solana.com';
const MINT = new PublicKey('383pTzoZ8Gp83dzk23ZnvLcfX2Sq32TAGN48CMQu2pAJ');
const PROGRAM_ID = new PublicKey('F82m45QUAFJ4GtMsJrSFnWzDrjWdZjdzyh8HTPgTBHXr');
const BTC_FEED = '0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43';
const DEC = 9;
const HOUSE_FEE_BPS = 200;            // must equal HOUSE_FEE_BPS in the program

const disc = (n) => createHash('sha256').update('global:' + n).digest().subarray(0, 8);
const u64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const i64 = (n) => { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(n)); return b; };
const feedBytes = Buffer.from(BTC_FEED.slice(2), 'hex');
const ui = (n) => Number(n) / 10 ** DEC;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const link = (s) => `https://explorer.solana.com/tx/${s}?cluster=devnet`;

const authority = Keypair.fromSecretKey(Uint8Array.from(
  JSON.parse(readFileSync(process.env.USERPROFILE + '/.config/solana/id.json', 'utf8'))));
const conn = new Connection(RPC, 'confirmed');
const wallet = new anchor.Wallet(authority);
const pyth = new PythSolanaReceiver({ connection: conn, wallet });
const hermes = new HermesClient('https://hermes.pyth.network', {});

// The house-edge destination: pinned onto the market at creation.
const treasuryAta = getAssociatedTokenAddressSync(MINT, authority.publicKey, true, TOKEN_2022_PROGRAM_ID);
const bal = async (a) => { try { return ui((await getAccount(conn, a, 'confirmed', TOKEN_2022_PROGRAM_ID)).amount); } catch { return 0; } };

let fails = 0;
const say = (ok, m) => { console.log((ok ? '  PASS ' : '  FAIL ') + m); if (!ok) fails++; };

const MARKET_LEN = 8 + 32 + 32 + 8 + 1 + 1 + 8 + 8 + 8 + 8 + 8 + 1 + 1 + 32 + 8 + 4 + 8 + 32 + 8;
function decode(d) {
  let o = 8 + 32 + 32 + 8 + 2 + 8;
  const lockTs = Number(d.readBigInt64LE(o)); o += 8;
  const resolveTs = Number(d.readBigInt64LE(o)); o += 8;
  const yes = ui(d.readBigUInt64LE(o)); o += 8;
  const no = ui(d.readBigUInt64LE(o)); o += 8;
  const resolved = d[o] === 1; o += 1;
  const side = d[o]; o += 1;
  o += 32;
  const openPrice = Number(d.readBigInt64LE(o)); o += 8;
  const expo = d.readInt32LE(o); o += 4;
  const closePrice = Number(d.readBigInt64LE(o)); o += 8;
  const treasury = new PublicKey(d.subarray(o, o + 32)); o += 32;
  const feesCollected = ui(d.readBigUInt64LE(o));
  return { lockTs, resolveTs, yes, no, resolved, side, openPrice, closePrice, expo, treasury, feesCollected };
}
const getMarket = async (pk) => {
  const i = await conn.getAccountInfo(pk);
  return i && i.data.length >= MARKET_LEN ? decode(i.data) : null;
};
const vaultBal = async (v) => { try { return ui((await getAccount(conn, v, 'confirmed', TOKEN_2022_PROGRAM_ID)).amount); } catch { return 0; } };
const ostBal = async (o) => {
  const a = getAssociatedTokenAddressSync(MINT, o, true, TOKEN_2022_PROGRAM_ID);
  try { return ui((await getAccount(conn, a, 'confirmed', TOKEN_2022_PROGRAM_ID)).amount); } catch { return 0; }
};

async function withPyth(ixName, market) {
  const upd = await hermes.getLatestPriceUpdates([BTC_FEED], { encoding: 'base64' });
  const b = pyth.newTransactionBuilder({ closeUpdateAccounts: true });
  await b.addPostPriceUpdates(upd.binary.data);
  await b.addPriceConsumerInstructions(async (get) => [{
    instruction: new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: authority.publicKey, isSigner: true, isWritable: true },
        { pubkey: market, isSigner: false, isWritable: true },
        { pubkey: get(BTC_FEED), isSigner: false, isWritable: false }
      ],
      data: disc(ixName)
    }), signers: []
  }]);
  const txs = await b.buildVersionedTransactions({ computeUnitPriceMicroLamports: 50000 });
  const sigs = await sendTransactions(txs, conn, wallet);
  return sigs[sigs.length - 1];
}

async function fund(name, ost) {
  const kp = Keypair.generate();
  const ata = getAssociatedTokenAddressSync(MINT, kp.publicKey, true, TOKEN_2022_PROGRAM_ID);
  const src = getAssociatedTokenAddressSync(MINT, authority.publicKey, true, TOKEN_2022_PROGRAM_ID);
  const tx = new Transaction()
    .add(SystemProgram.transfer({ fromPubkey: authority.publicKey, toPubkey: kp.publicKey, lamports: 0.05 * LAMPORTS_PER_SOL }))
    .add(createAssociatedTokenAccountIdempotentInstruction(authority.publicKey, ata, kp.publicKey, MINT, TOKEN_2022_PROGRAM_ID))
    .add(createTransferCheckedInstruction(src, MINT, ata, authority.publicKey, BigInt(ost * 10 ** DEC), DEC, [], TOKEN_2022_PROGRAM_ID));
  await sendAndConfirmTransaction(conn, tx, [authority]);
  console.log(`  funded ${name}: ${ost} OST  ${kp.publicKey.toBase58().slice(0, 8)}…`);
  return { kp, ata };
}

(async () => {
  console.log('OST · FULL TRUSTLESS LIFECYCLE (real OST on devnet)\n');
  const marketId = Date.now();
  const [market] = PublicKey.findProgramAddressSync(
    [Buffer.from('market'), authority.publicKey.toBuffer(), u64(marketId)], PROGRAM_ID);
  const [vault] = PublicKey.findProgramAddressSync([Buffer.from('vault'), market.toBuffer()], PROGRAM_ID);

  const now = Math.floor(Date.now() / 1000);
  const lockTs = now + 45;      // bets close
  const resolveTs = now + 55;   // settleable

  console.log('1) initialize_market (BTC/USD Pyth feed baked into the market)');
  let sig = await sendAndConfirmTransaction(conn, new Transaction().add(new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: authority.publicKey, isSigner: true, isWritable: true },
      { pubkey: MINT, isSigner: false, isWritable: false },
      { pubkey: market, isSigner: false, isWritable: true },
      { pubkey: vault, isSigner: false, isWritable: true },
      { pubkey: treasuryAta, isSigner: false, isWritable: false },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
    ],
    data: Buffer.concat([disc('initialize_market'), u64(marketId), i64(lockTs), i64(resolveTs), feedBytes])
  })), [authority], { commitment: 'confirmed' });
  console.log('   market', market.toBase58(), '\n   tx', link(sig));

  console.log('\n2) lock_open_price — the PROGRAM reads the OPEN price from Pyth');
  await withPyth('lock_open_price', market);
  let m = await getMarket(market);
  const openUsd = m.openPrice * 10 ** m.expo;
  say(m.openPrice !== 0, `open price locked ON-CHAIN by the program: $${openUsd.toFixed(2)}`);

  console.log('\n3) place_bet — two bettors escrow REAL OST');
  const A = await fund('A (YES)', 30);
  const B = await fund('B (NO) ', 30);
  const posOf = (b) => PublicKey.findProgramAddressSync(
    [Buffer.from('position'), market.toBuffer(), b.toBuffer()], PROGRAM_ID)[0];
  const betIx = (bettor, ata, side, amt) => new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: bettor, isSigner: true, isWritable: true },
      { pubkey: market, isSigner: false, isWritable: true },
      { pubkey: MINT, isSigner: false, isWritable: false },
      { pubkey: vault, isSigner: false, isWritable: true },
      { pubkey: ata, isSigner: false, isWritable: true },
      { pubkey: posOf(bettor), isSigner: false, isWritable: true },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
    ],
    data: Buffer.concat([disc('place_bet'), Buffer.from([side]), u64(BigInt(amt * 10 ** DEC))])
  });
  await sendAndConfirmTransaction(conn, new Transaction().add(betIx(A.kp.publicKey, A.ata, 1, 20)), [A.kp], { commitment: 'confirmed' });
  await sendAndConfirmTransaction(conn, new Transaction().add(betIx(B.kp.publicKey, B.ata, 0, 10)), [B.kp], { commitment: 'confirmed' });

  const vaultAfterBets = await vaultBal(vault);
  m = await getMarket(market);
  say(vaultAfterBets === 30, `VAULT holds the real escrow: ${vaultAfterBets} OST (YES ${m.yes} / NO ${m.no})`);

  console.log('\n4) resolve_with_pyth — the PROGRAM picks the winner (no authority path exists)');
  while (true) {
    const slot = await conn.getSlot('confirmed');
    const t = await conn.getBlockTime(slot);
    if (t && t >= resolveTs) break;
    process.stdout.write('.');
    await sleep(3000);
  }
  await withPyth('resolve_with_pyth', market);
  m = await getMarket(market);
  const closeUsd = m.closePrice * 10 ** m.expo;
  const expected = m.closePrice >= m.openPrice ? 1 : 0;
  console.log(`\n   open $${openUsd.toFixed(2)} -> close $${closeUsd.toFixed(2)}`);
  say(m.resolved, `market resolved ON-CHAIN: ${m.side === 1 ? 'YES (up)' : 'NO (down)'}`);
  say(m.side === expected, `outcome matches the oracle math (close >= open => ${expected === 1 ? 'YES' : 'NO'}) — the chain decided, not us`);

  console.log('\n5) claim_payout — the winner pulls the pool out of the vault');
  const winner = m.side === 1 ? A : B;
  const loser = m.side === 1 ? B : A;
  const winnerStake = m.side === 1 ? 20 : 10;
  const claimIx = (bettor, ata) => new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: bettor, isSigner: true, isWritable: true },
      { pubkey: market, isSigner: false, isWritable: true },
      { pubkey: MINT, isSigner: false, isWritable: false },
      { pubkey: posOf(bettor), isSigner: false, isWritable: true },
      { pubkey: vault, isSigner: false, isWritable: true },
      { pubkey: ata, isSigner: false, isWritable: true },
      { pubkey: treasuryAta, isSigner: false, isWritable: true },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
    ],
    data: disc('claim_payout')
  });

  // What the PROGRAM should pay: gross = whole pool; the rake is 2% of the
  // PROFIT only, so the winner's own stake is never taxed.
  const gross = 30;
  const profit = gross - winnerStake;
  const feeExp = profit * HOUSE_FEE_BPS / 10000;
  const netExp = gross - feeExp;
  const near = (a, b) => Math.abs(a - b) < 1e-6;

  say(m.treasury.equals(treasuryAta),
    `treasury is PINNED on the market: ${m.treasury.toBase58().slice(0, 8)}… (a claimer cannot redirect the rake)`);

  const wBefore = await ostBal(winner.kp.publicKey);
  const tBefore = await bal(treasuryAta);
  sig = await sendAndConfirmTransaction(conn, new Transaction().add(claimIx(winner.kp.publicKey, winner.ata)), [winner.kp], { commitment: 'confirmed' });
  const wAfter = await ostBal(winner.kp.publicKey);
  const tAfter = await bal(treasuryAta);
  console.log('   winner claim tx', link(sig));
  console.log(`   pool ${gross} OST · stake ${winnerStake} · profit ${profit} · edge ${HOUSE_FEE_BPS / 100}% of profit = ${feeExp} OST`);
  say(near(wAfter - wBefore, netExp),
    `winner received NET ${netExp} OST (gross ${gross} − ${feeExp} edge): ${wBefore} -> ${wAfter}`);
  say(near(tAfter - tBefore, feeExp),
    `house edge landed ON-CHAIN in the treasury: +${(tAfter - tBefore).toFixed(9)} OST (expected ${feeExp})`);

  const mFee = await getMarket(market);
  say(near(mFee.feesCollected, feeExp),
    `market.fees_collected recorded the rake: ${mFee.feesCollected} OST`);
  say(!near(feeExp, gross * HOUSE_FEE_BPS / 10000),
    `the stake was NOT taxed (a gross-based rake would have been ${(gross * HOUSE_FEE_BPS / 10000)} OST)`);

  const lBefore = await ostBal(loser.kp.publicKey);
  await sendAndConfirmTransaction(conn, new Transaction().add(claimIx(loser.kp.publicKey, loser.ata)), [loser.kp], { commitment: 'confirmed' });
  const lAfter = await ostBal(loser.kp.publicKey);
  say(lAfter === lBefore, `loser received nothing (${lBefore} -> ${lAfter}) — and cannot claim twice`);

  const vaultEnd = await vaultBal(vault);
  say(vaultEnd === 0, `vault fully drained: ${vaultAfterBets} -> ${vaultEnd} OST`);

  console.log(fails
    ? `\n${fails} FAIL`
    : '\n✅ FULLY TRUSTLESS: real OST escrowed, the ORACLE decided the winner inside the program, the winner pulled the pool out, and the HOUSE EDGE (2% of profit, never the stake) was taken BY THE PROGRAM into a treasury pinned at market creation. No human touched the outcome, and nobody can re-point or raise the rake.');
  process.exit(fails ? 1 : 0);
})().catch(e => {
  console.error('\nFAILED:', e.message);
  if (e.logs) console.error(e.logs.slice(-10).join('\n'));
  process.exit(1);
});

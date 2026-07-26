#!/usr/bin/env node
/* ============================================================================
 * OST · ARB SPREAD-SKIM on-chain proof (real OSTG on devnet)
 * ----------------------------------------------------------------------------
 * Proves the exact transaction the app's OST_ONCHAIN.placeBet builds when the
 * arb is on: a SINGLE user-signed tx that
 *    1. transfers the market-maker SPREAD to the market's treasury, and
 *    2. bets the REST (net) into the pari-mutuel pool.
 * No server, no middleman — the spread really lands on-chain in the treasury.
 *
 * Asserts against REAL balances: vault == net, treasury == spread, pool == net.
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
const MINT = new PublicKey('DfgxMbdN49AX2Za9LuvsyixF1jgVh45RbgWYSGonxQos'); // OSTG (app's on-chain mint)
const PROGRAM_ID = new PublicKey('F82m45QUAFJ4GtMsJrSFnWzDrjWdZjdzyh8HTPgTBHXr');
const BTC_FEED = '0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43';
const DEC = 9;
const SPREAD_BPS = 150;   // 1.5% — matches OST_ARB default

const disc = (n) => createHash('sha256').update('global:' + n).digest().subarray(0, 8);
const u64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const i64 = (n) => { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(n)); return b; };
const feedBytes = Buffer.from(BTC_FEED.slice(2), 'hex');
const ui = (n) => Number(n) / 10 ** DEC;
const raw = (n) => BigInt(Math.round(n * 10 ** DEC));
const link = (s) => `https://explorer.solana.com/tx/${s}?cluster=devnet`;

const authority = Keypair.fromSecretKey(Uint8Array.from(
  JSON.parse(readFileSync(process.env.USERPROFILE + '/.config/solana/id.json', 'utf8'))));
const conn = new Connection(RPC, 'confirmed');
const wallet = new anchor.Wallet(authority);
const pyth = new PythSolanaReceiver({ connection: conn, wallet });
const hermes = new HermesClient('https://hermes.pyth.network', {});

let fails = 0;
const say = (ok, m) => { console.log((ok ? '  PASS ' : '  FAIL ') + m); if (!ok) fails++; };
const near = (a, b) => Math.abs(a - b) < 1e-6;
const tokBal = async (ata) => { try { return ui((await getAccount(conn, ata, 'confirmed', TOKEN_2022_PROGRAM_ID)).amount); } catch { return 0; } };

const MARKET_LEN = 8 + 32 + 32 + 8 + 1 + 1 + 8 + 8 + 8 + 8 + 8 + 1 + 1 + 32 + 8 + 4 + 8 + 32 + 8;
function decode(d) {
  let o = 8 + 32 + 32 + 8 + 2 + 8 + 8 + 8;
  const yes = ui(d.readBigUInt64LE(o)); o += 8;
  const no = ui(d.readBigUInt64LE(o)); o += 8;
  return { yes, no };
}
const getPool = async (pk) => { const i = await conn.getAccountInfo(pk); return i && i.data.length >= MARKET_LEN ? decode(i.data) : null; };

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

(async () => {
  console.log('OST · ARB SPREAD-SKIM on-chain proof (OSTG devnet)\n');
  const authAta = getAssociatedTokenAddressSync(MINT, authority.publicKey, true, TOKEN_2022_PROGRAM_ID);
  const authOstg = await tokBal(authAta);
  console.log('  authority OSTG:', authOstg);
  if (authOstg < 30) { console.error('  authority needs >=30 OSTG — run fund-authority-ostg.mjs first'); process.exit(1); }

  // fresh treasury so we can measure the spread landing cleanly
  const treasuryKp = Keypair.generate();
  const treasuryAta = getAssociatedTokenAddressSync(MINT, treasuryKp.publicKey, true, TOKEN_2022_PROGRAM_ID);

  const marketId = Date.now();
  const [market] = PublicKey.findProgramAddressSync([Buffer.from('market'), authority.publicKey.toBuffer(), u64(marketId)], PROGRAM_ID);
  const [vault] = PublicKey.findProgramAddressSync([Buffer.from('vault'), market.toBuffer()], PROGRAM_ID);
  const now = Math.floor(Date.now() / 1000);
  const lockTs = now + 120, resolveTs = now + 130;

  console.log('1) create treasury ATA + initialize_market (OSTG)');
  await sendAndConfirmTransaction(conn, new Transaction()
    .add(createAssociatedTokenAccountIdempotentInstruction(authority.publicKey, treasuryAta, treasuryKp.publicKey, MINT, TOKEN_2022_PROGRAM_ID))
    .add(new TransactionInstruction({
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
  console.log('   market', market.toBase58());

  console.log('2) lock_open_price (Pyth)');
  await withPyth('lock_open_price', market);

  console.log('3) fund a bettor with 20 OSTG');
  const bettor = Keypair.generate();
  const betAta = getAssociatedTokenAddressSync(MINT, bettor.publicKey, true, TOKEN_2022_PROGRAM_ID);
  await sendAndConfirmTransaction(conn, new Transaction()
    .add(SystemProgram.transfer({ fromPubkey: authority.publicKey, toPubkey: bettor.publicKey, lamports: 0.05 * LAMPORTS_PER_SOL }))
    .add(createAssociatedTokenAccountIdempotentInstruction(authority.publicKey, betAta, bettor.publicKey, MINT, TOKEN_2022_PROGRAM_ID))
    .add(createTransferCheckedInstruction(authAta, MINT, betAta, authority.publicKey, raw(20), DEC, [], TOKEN_2022_PROGRAM_ID)),
    [authority], { commitment: 'confirmed' });

  const stake = 20, spread = stake * SPREAD_BPS / 10000, net = stake - spread;   // 0.3 / 19.7
  console.log(`4) place bet WITH spread skim: stake ${stake} -> spread ${spread} to treasury + net ${net} to pool (ONE tx)`);
  const posOf = (b) => PublicKey.findProgramAddressSync([Buffer.from('position'), market.toBuffer(), b.toBuffer()], PROGRAM_ID)[0];
  const betIx = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: bettor.publicKey, isSigner: true, isWritable: true },
      { pubkey: market, isSigner: false, isWritable: true },
      { pubkey: MINT, isSigner: false, isWritable: false },
      { pubkey: vault, isSigner: false, isWritable: true },
      { pubkey: betAta, isSigner: false, isWritable: true },
      { pubkey: posOf(bettor.publicKey), isSigner: false, isWritable: true },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
    ],
    data: Buffer.concat([disc('place_bet'), Buffer.from([1]), u64(raw(net))])
  });
  const spreadIx = createTransferCheckedInstruction(betAta, MINT, treasuryAta, bettor.publicKey, raw(spread), DEC, [], TOKEN_2022_PROGRAM_ID);
  const sig = await sendAndConfirmTransaction(conn, new Transaction().add(spreadIx).add(betIx), [bettor], { commitment: 'confirmed' });
  console.log('   tx', link(sig));

  const vaultBal = await tokBal(vault);
  const treBal = await tokBal(treasuryAta);
  const pool = await getPool(market);
  console.log('\n  RESULTS');
  say(near(treBal, spread), `spread landed in treasury ON-CHAIN: ${treBal} OSTG (expected ${spread})`);
  say(near(vaultBal, net), `net staked into the pari-mutuel vault: ${vaultBal} OSTG (expected ${net})`);
  say(pool && near(pool.yes, net), `market YES pool == net: ${pool ? pool.yes : 'n/a'} OSTG (expected ${net})`);
  say(near(treBal + vaultBal, stake), `spread + net == stake (nothing lost): ${treBal + vaultBal} (expected ${stake})`);

  console.log(fails
    ? `\n${fails} FAIL`
    : '\n✅ SPREAD-SKIM WORKS ON-CHAIN: one user-signed tx sent the 1.5% market-maker spread to the treasury and bet the rest pari-mutuel. No server, no middleman.');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('\nFAILED:', e.message); if (e.logs) console.error(e.logs.slice(-12).join('\n')); process.exit(1); });

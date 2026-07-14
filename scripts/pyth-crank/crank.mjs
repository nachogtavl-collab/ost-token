#!/usr/bin/env node
/* ============================================================================
 * OST · On-chain market crank — PYTH-VERIFIED, TRUSTLESS SETTLEMENT
 * ----------------------------------------------------------------------------
 * The crank no longer decides anything. It only pushes markets forward:
 *
 *   1. initialize_market  — opens the shared market for a BTC 5-min round
 *   2. lock_open_price    — posts a signed Pyth update; the PROGRAM reads the
 *                           OPEN price from it and stores it
 *   3. resolve_with_pyth  — posts a fresh Pyth update; the PROGRAM reads the
 *                           CLOSE price and decides the winner ITSELF
 *                           (close >= open => YES)
 *
 * Steps 2 and 3 are PERMISSIONLESS — anyone can call them. The crank holds no
 * power over the outcome: there is no authority-resolve instruction in the
 * program any more. If this crank disappears, anyone can settle the markets.
 *
 * Usage: node scripts/market-crank.mjs [--watch]
 * ========================================================================== */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import anchor from '@coral-xyz/anchor';
import {
  Connection, Keypair, PublicKey, SystemProgram, Transaction,
  TransactionInstruction, sendAndConfirmTransaction
} from '@solana/web3.js';
import {
  TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction
} from '@solana/spl-token';
// The Pyth receiver SDK is CommonJS and imports jito-ts with an extensionless
// path, which Node's ESM resolver rejects. Load it through CJS resolution.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { PythSolanaReceiver } = require('@pythnetwork/pyth-solana-receiver');
const { sendTransactions } = require('@pythnetwork/solana-utils');
import { HermesClient } from '@pythnetwork/hermes-client';

const RPC = process.env.OST_RPC || 'https://api.devnet.solana.com';
const MINT = new PublicKey('383pTzoZ8Gp83dzk23ZnvLcfX2Sq32TAGN48CMQu2pAJ');
const PROGRAM_ID = new PublicKey('F82m45QUAFJ4GtMsJrSFnWzDrjWdZjdzyh8HTPgTBHXr');
// Pyth BTC/USD feed — the same feed the program stores and verifies against.
const BTC_FEED = '0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43';
const FIVE_MIN = 300;
const WATCH = process.argv.includes('--watch');

const disc = (n) => createHash('sha256').update('global:' + n).digest().subarray(0, 8);
const u64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const i64 = (n) => { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(n)); return b; };
const feedBytes = Buffer.from(BTC_FEED.replace(/^0x/, ''), 'hex');   // [u8;32]

const authority = Keypair.fromSecretKey(Uint8Array.from(
  JSON.parse(readFileSync(process.env.USERPROFILE + '/.config/solana/id.json', 'utf8'))));
const conn = new Connection(RPC, 'confirmed');
const wallet = new anchor.Wallet(authority);
const pythReceiver = new PythSolanaReceiver({ connection: conn, wallet });
const hermes = new HermesClient('https://hermes.pyth.network', {});

const roundOpenAt = (t = Date.now()) => Math.floor(t / 1000 / FIVE_MIN) * FIVE_MIN;

function pdas(marketId) {
  const [market] = PublicKey.findProgramAddressSync(
    [Buffer.from('market'), authority.publicKey.toBuffer(), u64(marketId)], PROGRAM_ID);
  const [vault] = PublicKey.findProgramAddressSync(
    [Buffer.from('vault'), market.toBuffer()], PROGRAM_ID);
  return { market, vault };
}

// Market layout after the 8-byte discriminator.
// LEGACY: markets created BEFORE the Pyth upgrade have the short layout (no
// feed_id/open_price). They can no longer be resolved — the authority-resolve
// instruction was deliberately removed — so we skip them instead of crashing.
// (Only test markets are affected; no user funds were ever in them.)
const MARKET_LEN = 8 + 32 + 32 + 8 + 1 + 1 + 8 + 8 + 8 + 8 + 8 + 1 + 1 + 32 + 8 + 4 + 8;
function decodeMarket(data) {
  if (data.length < MARKET_LEN) return { legacy: true };
  let o = 8 + 32 + 32;                       // authority, mint
  const marketId = data.readBigUInt64LE(o); o += 8;
  o += 2;                                     // bump, vault_bump
  o += 8;                                     // created_at
  const lockTs = data.readBigInt64LE(o); o += 8;
  const resolveTs = data.readBigInt64LE(o); o += 8;
  const yesPool = data.readBigUInt64LE(o); o += 8;
  const noPool = data.readBigUInt64LE(o); o += 8;
  const resolved = data[o] === 1; o += 1;
  const winningSide = data[o]; o += 1;
  o += 32;                                    // feed_id
  const openPrice = data.readBigInt64LE(o); o += 8;
  const openExpo = data.readInt32LE(o); o += 4;
  const closePrice = data.readBigInt64LE(o);
  return {
    marketId: Number(marketId), lockTs: Number(lockTs), resolveTs: Number(resolveTs),
    yes: Number(yesPool) / 1e9, no: Number(noPool) / 1e9,
    resolved, winningSide,
    openPrice: Number(openPrice), openExpo, closePrice: Number(closePrice)
  };
}

async function getMarket(pk) {
  const info = await conn.getAccountInfo(pk);
  return info ? decodeMarket(info.data) : null;
}

async function openMarket(openAt) {
  const { market, vault } = pdas(openAt);
  if (await getMarket(market)) return { skipped: true, market };
  const closeAt = openAt + FIVE_MIN;
  const ix = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: authority.publicKey, isSigner: true, isWritable: true },
      { pubkey: MINT, isSigner: false, isWritable: false },
      { pubkey: market, isSigner: false, isWritable: true },
      { pubkey: vault, isSigner: false, isWritable: true },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
    ],
    // lock 15s before close so late bets cannot front-run the outcome
    data: Buffer.concat([disc('initialize_market'), u64(openAt), i64(closeAt - 15), i64(closeAt), feedBytes])
  });
  const sig = await sendAndConfirmTransaction(conn, new Transaction().add(ix), [authority], { commitment: 'confirmed' });
  return { market, vault, sig };
}

/**
 * Post a fresh signed Pyth update on-chain and, in the SAME transaction, call
 * our program with it. The program verifies the update belongs to its feed and
 * is fresh — the crank cannot substitute a price of its choosing.
 */
async function withPythUpdate(ixName, market) {
  const upd = await hermes.getLatestPriceUpdates([BTC_FEED], { encoding: 'base64' });
  const builder = pythReceiver.newTransactionBuilder({ closeUpdateAccounts: true });
  await builder.addPostPriceUpdates(upd.binary.data);
  await builder.addPriceConsumerInstructions(async (getPriceUpdateAccount) => {
    const priceUpdate = getPriceUpdateAccount(BTC_FEED);
    return [{
      instruction: new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
          { pubkey: authority.publicKey, isSigner: true, isWritable: true },
          { pubkey: market, isSigner: false, isWritable: true },
          { pubkey: priceUpdate, isSigner: false, isWritable: false }
        ],
        data: disc(ixName)
      }),
      signers: []
    }];
  });
  // Build the versioned txs (post the VAA + our consumer ix) and send them.
  const txs = await builder.buildVersionedTransactions({ computeUnitPriceMicroLamports: 50000 });
  const sigs = await sendTransactions(txs, conn, wallet);
  return sigs[sigs.length - 1];
}

async function pass() {
  const now = roundOpenAt();

  const ata = getAssociatedTokenAddressSync(MINT, authority.publicKey, true, TOKEN_2022_PROGRAM_ID);
  if (!(await conn.getAccountInfo(ata))) {
    await sendAndConfirmTransaction(conn, new Transaction().add(
      createAssociatedTokenAccountIdempotentInstruction(
        authority.publicKey, ata, authority.publicKey, MINT, TOKEN_2022_PROGRAM_ID)), [authority]);
  }

  // 1) open current + next round, and lock each OPEN price from Pyth
  for (const openAt of [now, now + FIVE_MIN]) {
    const r = await openMarket(openAt);
    console.log(r.skipped
      ? `  market ${openAt} already open`
      : `  OPENED ${openAt} -> ${r.market.toBase58().slice(0, 8)}…`);

    const { market } = pdas(openAt);
    const m = await getMarket(market);
    if (m && m.legacy) { console.log('  ' + openAt + ': legacy (pre-Pyth) market — skipped'); continue; }
    if (m && m.openPrice === 0 && openAt <= now) {
      const sig = await withPythUpdate('lock_open_price', market);
      const after = await getMarket(market);
      console.log(`  LOCKED open price (Pyth): $${(after.openPrice * 10 ** after.openExpo).toFixed(2)}  ${String(sig).slice(0, 10)}…`);
    }
  }

  // 2) resolve finished rounds — the PROGRAM decides, from the oracle
  for (const openAt of [now - FIVE_MIN, now - 2 * FIVE_MIN]) {
    const { market } = pdas(openAt);
    const m = await getMarket(market);
    if (!m) { console.log(`  ${openAt}: no market`); continue; }
    if (m.legacy) { console.log(`  ${openAt}: legacy (pre-Pyth) market — cannot settle, skipped`); continue; }
    if (m.resolved) {
      const o = m.openPrice * 10 ** m.openExpo, c = m.closePrice * 10 ** m.openExpo;
      console.log(`  ${openAt}: already resolved ${m.winningSide === 1 ? 'YES' : 'NO'} (open $${o.toFixed(2)} -> close $${c.toFixed(2)})`);
      continue;
    }
    if (m.openPrice === 0) { console.log(`  ${openAt}: no open price locked — cannot settle`); continue; }
    if (Math.floor(Date.now() / 1000) < m.resolveTs) { console.log(`  ${openAt}: not closed yet`); continue; }

    const sig = await withPythUpdate('resolve_with_pyth', market);
    const after = await getMarket(market);
    const o = after.openPrice * 10 ** after.openExpo, c = after.closePrice * 10 ** after.openExpo;
    console.log(`  RESOLVED ${openAt}: ${after.winningSide === 1 ? 'YES (up)' : 'NO (down)'}  open $${o.toFixed(2)} -> close $${c.toFixed(2)}  ${String(sig).slice(0, 10)}…`);
  }
}

console.log('OST market crank — Pyth-verified, trustless settlement');
console.log('  program  ', PROGRAM_ID.toBase58());
console.log('  feed     ', BTC_FEED.slice(0, 18) + '… (BTC/USD)');
console.log('  crank key', authority.publicKey.toBase58(), '(cannot choose outcomes)');
await pass();
if (WATCH) setInterval(() => pass().catch(e => console.error('pass failed:', e.message)), 60_000);
else process.exit(0);

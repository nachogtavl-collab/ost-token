#!/usr/bin/env node
/* ============================================================================
 * OST · On-chain market crank
 * ----------------------------------------------------------------------------
 * The browser cannot create a SHARED market: `initialize_market` must be signed
 * by the market authority, and the market PDA is seeded by that authority — so
 * if each user created their own, every bettor would sit in a different pool
 * and pari-mutuel odds would be meaningless. One authority must open the market
 * that everyone bets into. That is this crank.
 *
 * For each BTC 5-min round it:
 *   1. opens the on-chain market (market_id = round openAt in seconds)
 *   2. after the round closes, resolves it from the round's real open/close
 *      price (up = YES) and lets winners claim on-chain.
 *
 * Usage:
 *   node scripts/market-crank.mjs           # one pass (open current, resolve due)
 *   node scripts/market-crank.mjs --watch   # keep running
 *
 * HONEST NOTE: resolution is authority-signed here, i.e. still trusted. Making
 * it trustless means verifying a Pyth price update inside `resolve_market` —
 * that is the next program change, not something a crank can fake.
 * ========================================================================== */
import { readFileSync } from 'node:fs';
import {
  Connection, Keypair, PublicKey, SystemProgram, Transaction,
  TransactionInstruction, sendAndConfirmTransaction
} from '@solana/web3.js';
import {
  TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction
} from '@solana/spl-token';
import { createHash } from 'node:crypto';

const RPC = 'https://api.devnet.solana.com';
const MINT = new PublicKey('383pTzoZ8Gp83dzk23ZnvLcfX2Sq32TAGN48CMQu2pAJ');
const PROGRAM_ID = new PublicKey('F82m45QUAFJ4GtMsJrSFnWzDrjWdZjdzyh8HTPgTBHXr');
const FIVE_MIN = 5 * 60;
const WATCH = process.argv.includes('--watch');

const disc = (name) => createHash('sha256').update('global:' + name).digest().subarray(0, 8);
const u64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const i64 = (n) => { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(n)); return b; };

const authority = Keypair.fromSecretKey(Uint8Array.from(
  JSON.parse(readFileSync(process.env.USERPROFILE + '/.config/solana/id.json', 'utf8'))));
const conn = new Connection(RPC, 'confirmed');

function pdas(marketId) {
  const [market] = PublicKey.findProgramAddressSync(
    [Buffer.from('market'), authority.publicKey.toBuffer(), u64(marketId)], PROGRAM_ID);
  const [vault] = PublicKey.findProgramAddressSync(
    [Buffer.from('vault'), market.toBuffer()], PROGRAM_ID);
  return { market, vault };
}

const roundOpenAt = (t = Date.now()) => Math.floor(t / 1000 / FIVE_MIN) * FIVE_MIN;

async function marketExists(pk) { return !!(await conn.getAccountInfo(pk)); }

async function openMarket(openAt) {
  const { market, vault } = pdas(openAt);
  if (await marketExists(market)) return { skipped: true, market };
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
    // lock 15s before close so late bets can't front-run the outcome
    data: Buffer.concat([disc('initialize_market'), u64(openAt), i64(closeAt - 15), i64(closeAt)])
  });
  const sig = await sendAndConfirmTransaction(conn, new Transaction().add(ix), [authority], { commitment: 'confirmed' });
  return { market, vault, sig };
}

// Round outcome from the OST worker's server-authoritative BTC round history.
async function outcomeFor(openAt) {
  try {
    const r = await fetch('https://ost-api.nachogtavl.workers.dev/btc/history?limit=12');
    const j = await r.json();
    const rounds = j.rounds || j.history || (Array.isArray(j) ? j : []);
    const hit = rounds.find(x => Math.floor(Number(x.openAt) / 1000) === openAt || Number(x.openAt) === openAt);
    if (!hit) return null;
    const open = Number(hit.openPrice), close = Number(hit.closePrice ?? hit.settlePrice);
    if (!Number.isFinite(open) || !Number.isFinite(close)) return null;
    return close >= open ? 1 : 0;   // YES = price up
  } catch { return null; }
}

async function resolveMarket(openAt, winningSide) {
  const { market } = pdas(openAt);
  const info = await conn.getAccountInfo(market);
  if (!info) return { skipped: 'no market' };
  // Market layout: 8 disc + 32 authority + 32 mint + 8 id + 1 bump + 1 vault_bump
  //                + 8 created + 8 lock + 8 resolve + 8 yes + 8 no + 1 resolved
  const resolvedOffset = 8 + 32 + 32 + 8 + 1 + 1 + 8 + 8 + 8 + 8 + 8;
  if (info.data[resolvedOffset] === 1) return { skipped: 'already resolved' };

  const ix = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: authority.publicKey, isSigner: true, isWritable: false },
      { pubkey: market, isSigner: false, isWritable: true }
    ],
    data: Buffer.concat([disc('resolve_market'), Buffer.from([winningSide])])
  });
  const sig = await sendAndConfirmTransaction(conn, new Transaction().add(ix), [authority], { commitment: 'confirmed' });
  return { sig };
}

async function pass() {
  const now = roundOpenAt();
  // Make sure the authority has an OST ATA (harmless if it exists).
  const ata = getAssociatedTokenAddressSync(MINT, authority.publicKey, true, TOKEN_2022_PROGRAM_ID);
  if (!(await conn.getAccountInfo(ata))) {
    await sendAndConfirmTransaction(conn, new Transaction().add(
      createAssociatedTokenAccountIdempotentInstruction(
        authority.publicKey, ata, authority.publicKey, MINT, TOKEN_2022_PROGRAM_ID)), [authority]);
  }

  // 1) open the CURRENT and NEXT round so a bettor always has a live market.
  for (const openAt of [now, now + FIVE_MIN]) {
    const r = await openMarket(openAt);
    console.log(r.skipped
      ? `  market ${openAt} already open (${r.market.toBase58().slice(0, 8)}…)`
      : `  OPENED market ${openAt} -> ${r.market.toBase58().slice(0, 8)}…  ${r.sig.slice(0, 12)}…`);
  }

  // 2) resolve the previous round(s) whose outcome is known.
  for (const openAt of [now - FIVE_MIN, now - 2 * FIVE_MIN]) {
    const side = await outcomeFor(openAt);
    if (side === null) { console.log(`  round ${openAt}: no outcome yet`); continue; }
    const r = await resolveMarket(openAt, side);
    console.log(r.sig
      ? `  RESOLVED ${openAt} -> ${side === 1 ? 'YES (up)' : 'NO (down)'}  ${r.sig.slice(0, 12)}…`
      : `  round ${openAt}: ${r.skipped}`);
  }
}

console.log('OST market crank — program', PROGRAM_ID.toBase58());
console.log('authority', authority.publicKey.toBase58());
await pass();
if (WATCH) {
  setInterval(() => pass().catch(e => console.error('pass failed:', e.message)), 60_000);
} else {
  process.exit(0);
}

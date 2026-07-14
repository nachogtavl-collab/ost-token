#!/usr/bin/env node
/* ============================================================================
 * OST · Refund stakes stranded in LEGACY markets
 * ----------------------------------------------------------------------------
 * Markets created before the Pyth upgrade use a shorter layout and carry no
 * feed_id. They can no longer be resolved (the authority-resolve instruction was
 * deliberately removed) and no longer deserialize into the current `Market`, so
 * the OST escrowed in them was UNRECOVERABLE by any existing code path.
 *
 * `refund_legacy_position` (added to the program for exactly this) hands every
 * bettor their ORIGINAL STAKE back. It is not a payout and it is not raked —
 * those markets never produced an outcome, so nobody won and nobody is charged.
 *
 * Run with --execute to actually send; default is a dry run.
 * ========================================================================== */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  Connection, Keypair, PublicKey, SystemProgram, Transaction,
  TransactionInstruction, sendAndConfirmTransaction
} from '@solana/web3.js';
import {
  TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction, getAccount
} from '@solana/spl-token';

const RPC = process.env.OST_RPC || 'https://api.devnet.solana.com';
const MINT = new PublicKey('383pTzoZ8Gp83dzk23ZnvLcfX2Sq32TAGN48CMQu2pAJ');
const PROGRAM_ID = new PublicKey('F82m45QUAFJ4GtMsJrSFnWzDrjWdZjdzyh8HTPgTBHXr');
const DEC = 9;
const EXECUTE = process.argv.includes('--execute');

// 8 + Market::SIZE for the CURRENT layout. Anything smaller is legacy.
const CURRENT_MARKET_LEN = 8 + (32 + 32 + 8 + 1 + 1 + 8 + 8 + 8 + 8 + 8 + 1 + 1) + (32 + 8 + 4 + 8) + (32 + 8);
const POSITION_LEN = 8 + 32 + 32 + 1 + 8 + 1;   // market, bettor, side, stake, claimed

const disc = (n) => createHash('sha256').update('global:' + n).digest().subarray(0, 8);
const ui = (n) => Number(n) / 10 ** DEC;

const payer = Keypair.fromSecretKey(Uint8Array.from(
  JSON.parse(readFileSync(process.env.USERPROFILE + '/.config/solana/id.json', 'utf8'))));
const conn = new Connection(RPC, 'confirmed');

const vaultOf = (market) =>
  PublicKey.findProgramAddressSync([Buffer.from('vault'), market.toBuffer()], PROGRAM_ID)[0];
const vaultBal = async (v) => {
  try { return ui((await getAccount(conn, v, 'confirmed', TOKEN_2022_PROGRAM_ID)).amount); } catch { return 0; }
};

(async () => {
  console.log(EXECUTE ? 'REFUNDING stranded legacy stakes\n' : 'DRY RUN (pass --execute to send)\n');

  const accts = await conn.getProgramAccounts(PROGRAM_ID, { commitment: 'confirmed' });

  // Legacy markets = our discriminator, but smaller than the current Market.
  const legacy = new Map();
  for (const { pubkey, account } of accts) {
    const len = account.data.length;
    if (len >= CURRENT_MARKET_LEN || len < 8 + 116 || len === POSITION_LEN) continue;
    const bal = await vaultBal(vaultOf(pubkey));
    if (bal > 0) legacy.set(pubkey.toBase58(), { pubkey, len, bal });
  }
  if (!legacy.size) { console.log('No legacy market still holds OST — nothing to refund.'); return; }

  for (const m of legacy.values()) {
    console.log(`legacy market ${m.pubkey.toBase58().slice(0, 8)}…  len=${m.len}  vault=${m.bal} OST`);
  }

  // Positions belonging to those markets, still unclaimed.
  const positions = accts.filter((a) => a.account.data.length === POSITION_LEN)
    .map(({ pubkey, account }) => {
      const d = account.data;
      return {
        pubkey,
        market: new PublicKey(d.subarray(8, 40)),
        bettor: new PublicKey(d.subarray(40, 72)),
        stake: ui(d.readBigUInt64LE(73)),
        claimed: d[81] === 1
      };
    })
    .filter((p) => legacy.has(p.market.toBase58()) && !p.claimed && p.stake > 0);

  const total = positions.reduce((t, p) => t + p.stake, 0);
  console.log(`\n${positions.length} unclaimed position(s), ${total} OST to return to bettors:`);
  for (const p of positions) {
    console.log(`  ${p.bettor.toBase58().slice(0, 8)}…  ${p.stake} OST`);
  }
  if (!EXECUTE) { console.log('\n(dry run — nothing sent)'); return; }

  let refunded = 0;
  for (const p of positions) {
    const ata = getAssociatedTokenAddressSync(MINT, p.bettor, true, TOKEN_2022_PROGRAM_ID);
    const vault = vaultOf(p.market);
    const tx = new Transaction()
      // The bettor may never have had an ATA (or closed it) — make one; we pay.
      .add(createAssociatedTokenAccountIdempotentInstruction(
        payer.publicKey, ata, p.bettor, MINT, TOKEN_2022_PROGRAM_ID))
      .add(new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
          { pubkey: payer.publicKey, isSigner: true, isWritable: true },
          { pubkey: p.market, isSigner: false, isWritable: true },
          { pubkey: MINT, isSigner: false, isWritable: false },
          { pubkey: p.pubkey, isSigner: false, isWritable: true },
          { pubkey: vault, isSigner: false, isWritable: true },
          { pubkey: ata, isSigner: false, isWritable: true },
          { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
        ],
        data: disc('refund_legacy_position')
      }));
    try {
      const sig = await sendAndConfirmTransaction(conn, tx, [payer], { commitment: 'confirmed' });
      refunded += p.stake;
      console.log(`  REFUNDED ${p.stake} OST -> ${p.bettor.toBase58().slice(0, 8)}…  ${sig.slice(0, 12)}…`);
    } catch (e) {
      console.error(`  FAILED ${p.bettor.toBase58().slice(0, 8)}…: ${e.message}`);
      if (e.logs) console.error('   ' + e.logs.slice(-4).join('\n   '));
    }
  }

  console.log(`\nrefunded ${refunded} OST`);
  for (const m of legacy.values()) {
    console.log(`  vault ${m.pubkey.toBase58().slice(0, 8)}… now ${await vaultBal(vaultOf(m.pubkey))} OST`);
  }
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });

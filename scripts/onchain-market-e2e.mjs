#!/usr/bin/env node
/* ============================================================================
 * OST · On-chain prediction market — REAL devnet end-to-end proof
 * ----------------------------------------------------------------------------
 * Proves the ost-betting program actually escrows and pays OST on Solana:
 *
 *   1. initialize_market  — creates the market PDA + a program-owned OST vault
 *   2. place_bet (YES)    — bettor A's OST moves INTO the vault (real transfer)
 *   3. place_bet (NO)     — bettor B's OST moves in too
 *   4. resolve_market     — authority sets the winning side
 *   5. claim_payout       — winner's OST comes BACK OUT of the vault, pari-mutuel
 *
 * Every step is a real devnet transaction and we assert on REAL token balances,
 * not on local state. Prints explorer links so you can verify independently.
 *
 * Run:  node scripts/onchain-market-e2e.mjs
 * ========================================================================== */
import anchor from '@coral-xyz/anchor';
import { readFileSync } from 'node:fs';
import {
  Connection, Keypair, PublicKey, SystemProgram, LAMPORTS_PER_SOL
} from '@solana/web3.js';
import {
  TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction, createTransferCheckedInstruction,
  getAccount
} from '@solana/spl-token';

const { AnchorProvider, Program, Wallet, BN } = anchor;

const RPC = 'https://api.devnet.solana.com';
const MINT = new PublicKey('383pTzoZ8Gp83dzk23ZnvLcfX2Sq32TAGN48CMQu2pAJ');
const DECIMALS = 9;
const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

const idl = JSON.parse(readFileSync(ROOT + '/target/idl/ost_betting.json', 'utf8'));
const PROGRAM_ID = new PublicKey(idl.address);

// The funded authority (also the OST source for the test bettors).
const authority = Keypair.fromSecretKey(Uint8Array.from(
  JSON.parse(readFileSync(process.env.USERPROFILE + '/.config/solana/id.json', 'utf8'))
));

const conn = new Connection(RPC, 'confirmed');
const provider = new AnchorProvider(conn, new Wallet(authority), { commitment: 'confirmed' });
const program = new Program(idl, provider);

const ui = (n) => Number(n) / 10 ** DECIMALS;
const link = (sig) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function ostBalance(owner) {
  const ata = getAssociatedTokenAddressSync(MINT, owner, true, TOKEN_2022_PROGRAM_ID);
  try { return ui((await getAccount(conn, ata, 'confirmed', TOKEN_2022_PROGRAM_ID)).amount); }
  catch { return 0; }
}

// Fund a fresh bettor with SOL (fees/rent) + OST (the stake).
async function makeBettor(name, ostAmount) {
  const kp = Keypair.generate();
  const tx = new anchor.web3.Transaction();
  tx.add(SystemProgram.transfer({
    fromPubkey: authority.publicKey, toPubkey: kp.publicKey, lamports: 0.05 * LAMPORTS_PER_SOL
  }));
  const ata = getAssociatedTokenAddressSync(MINT, kp.publicKey, true, TOKEN_2022_PROGRAM_ID);
  const srcAta = getAssociatedTokenAddressSync(MINT, authority.publicKey, true, TOKEN_2022_PROGRAM_ID);
  tx.add(createAssociatedTokenAccountIdempotentInstruction(
    authority.publicKey, ata, kp.publicKey, MINT, TOKEN_2022_PROGRAM_ID));
  tx.add(createTransferCheckedInstruction(
    srcAta, MINT, ata, authority.publicKey,
    BigInt(Math.round(ostAmount * 10 ** DECIMALS)), DECIMALS, [], TOKEN_2022_PROGRAM_ID));
  const sig = await provider.sendAndConfirm(tx, [authority]);
  console.log(`  funded ${name}: ${ostAmount} OST + 0.05 SOL  ${kp.publicKey.toBase58().slice(0, 8)}…`);
  return { kp, ata };
}

(async () => {
  console.log('OST on-chain market — REAL devnet E2E');
  console.log('  program:', PROGRAM_ID.toBase58());
  console.log('  mint   :', MINT.toBase58(), '(Token-2022)');
  console.log('  authority:', authority.publicKey.toBase58(), `(${await ostBalance(authority.publicKey)} OST)`);

  const marketId = new BN(Date.now());
  const [market] = PublicKey.findProgramAddressSync(
    [Buffer.from('market'), authority.publicKey.toBuffer(), marketId.toArrayLike(Buffer, 'le', 8)],
    PROGRAM_ID);
  const [vault] = PublicKey.findProgramAddressSync(
    [Buffer.from('vault'), market.toBuffer()], PROGRAM_ID);

  // Short window so the test can actually resolve.
  const now = Math.floor(Date.now() / 1000);
  const lockTs = new BN(now + 25);
  const resolveTs = new BN(now + 30);

  console.log('\n1) initialize_market');
  let sig = await program.methods
    .initializeMarket(marketId, lockTs, resolveTs)
    .accounts({
      authority: authority.publicKey, mint: MINT, market, vault,
      tokenProgram: TOKEN_2022_PROGRAM_ID, systemProgram: SystemProgram.programId
    })
    .rpc();
  console.log('   market:', market.toBase58());
  console.log('   vault :', vault.toBase58(), '(program-owned OST account)');
  console.log('   tx    :', link(sig));

  console.log('\n2) fund two bettors');
  const A = await makeBettor('A (YES)', 30);
  const B = await makeBettor('B (NO) ', 10);

  const vaultBefore = ui((await getAccount(conn, vault, 'confirmed', TOKEN_2022_PROGRAM_ID)).amount);
  const aBefore = await ostBalance(A.kp.publicKey);
  const bBefore = await ostBalance(B.kp.publicKey);
  console.log(`   vault=${vaultBefore} OST  A=${aBefore} OST  B=${bBefore} OST`);

  console.log('\n3) place_bet — A bets 20 OST on YES, B bets 10 OST on NO');
  const posOf = (bettor) => PublicKey.findProgramAddressSync(
    [Buffer.from('position'), market.toBuffer(), bettor.toBuffer()], PROGRAM_ID)[0];

  sig = await program.methods.placeBet(1, new BN(20 * 10 ** DECIMALS))
    .accounts({
      bettor: A.kp.publicKey, market, mint: MINT, vault, bettorToken: A.ata,
      position: posOf(A.kp.publicKey),
      tokenProgram: TOKEN_2022_PROGRAM_ID, systemProgram: SystemProgram.programId
    }).signers([A.kp]).rpc();
  console.log('   A YES 20 OST:', link(sig));

  sig = await program.methods.placeBet(0, new BN(10 * 10 ** DECIMALS))
    .accounts({
      bettor: B.kp.publicKey, market, mint: MINT, vault, bettorToken: B.ata,
      position: posOf(B.kp.publicKey),
      tokenProgram: TOKEN_2022_PROGRAM_ID, systemProgram: SystemProgram.programId
    }).signers([B.kp]).rpc();
  console.log('   B NO  10 OST:', link(sig));

  const vaultAfterBets = ui((await getAccount(conn, vault, 'confirmed', TOKEN_2022_PROGRAM_ID)).amount);
  const aAfterBet = await ostBalance(A.kp.publicKey);
  console.log(`   VAULT NOW HOLDS ${vaultAfterBets} OST  (A: ${aBefore} -> ${aAfterBet})`);
  if (vaultAfterBets !== 30) throw new Error('vault should hold 30 OST of real escrow, has ' + vaultAfterBets);

  const mkt = await program.account.market.fetch(market);
  console.log(`   on-chain pools: YES=${ui(mkt.yesPool)} NO=${ui(mkt.noPool)}`);

  console.log('\n4) resolve_market (waiting for resolve_ts…)');
  while (Math.floor(Date.now() / 1000) < resolveTs.toNumber()) { await sleep(2000); process.stdout.write('.'); }
  sig = await program.methods.resolveMarket(1)   // YES wins
    .accounts({ authority: authority.publicKey, market }).rpc();
  console.log('\n   resolved YES:', link(sig));

  console.log('\n5) claim_payout — winner A pulls the whole pool out of the vault');
  sig = await program.methods.claimPayout()
    .accounts({
      bettor: A.kp.publicKey, market, mint: MINT, position: posOf(A.kp.publicKey),
      vault, bettorToken: A.ata,
      tokenProgram: TOKEN_2022_PROGRAM_ID, systemProgram: SystemProgram.programId
    }).signers([A.kp]).rpc();
  console.log('   claim:', link(sig));

  const aFinal = await ostBalance(A.kp.publicKey);
  const vaultFinal = ui((await getAccount(conn, vault, 'confirmed', TOKEN_2022_PROGRAM_ID)).amount);
  // pari-mutuel: A staked 20 of a 20 YES pool; total pool 30 -> A gets all 30.
  const gained = aFinal - aAfterBet;
  console.log(`\n   A received ${gained} OST from the vault (staked 20, pool 30)`);
  console.log(`   vault: ${vaultAfterBets} -> ${vaultFinal} OST`);

  const ok = gained === 30 && vaultFinal === 0;
  console.log(ok
    ? '\n✅ ON-CHAIN MARKET PROVEN: OST escrowed in a program vault, resolved, and paid out — all on Solana devnet.'
    : `\n❌ MISMATCH: expected A +30 OST and empty vault; got +${gained} / ${vaultFinal}`);
  process.exit(ok ? 0 : 1);
})().catch(e => {
  console.error('\nFAILED:', e.message);
  if (e.logs) console.error(e.logs.slice(-12).join('\n'));
  process.exit(1);
});

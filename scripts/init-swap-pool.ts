// =============================================================================
// OST Token — Swap Pool Initialiser (DEVNET ONLY)
// =============================================================================
// Creates / refills a "swap pool" devnet keypair that the Cloudflare Worker
// (workers/ost-api/) signs payouts and atomic SOL<->OST swaps with.
//
// Phase 0 (project-docs/TOKEN-ARCHITECTURE.md): this used to publish the
// keypair's raw secret key into the site bundle so the BROWSER could sign on
// the user's behalf — that shipped a private key to every visitor. The
// secret now goes ONLY to the worker as a Wrangler secret; docs/swap-pool.js
// gets public metadata only (publicKey/ata/mint/decimals). Never write the
// secret key into anything under docs/ again.
//
// Usage:
//   npx ts-node scripts/init-swap-pool.ts                 # 50,000 OST + 0.5 SOL
//   npx ts-node scripts/init-swap-pool.ts --ost 100000    # custom OST refill
//   npx ts-node scripts/init-swap-pool.ts --sol 1         # custom SOL refill
// =============================================================================

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  clusterApiUrl,
  sendAndConfirmTransaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import * as fs from 'fs';
import * as path from 'path';

const PROGRAM_ID = new PublicKey('J2jiS296YWVie1Sopb4SxcM3aJnP9aAwe6aLDhCqvGXY');
const DECIMALS = 9;
// Devnet pool is pre-funded with a HUGE OST stash so it never runs out.
// We hold 1B+ OST in the admin ATA — ship 100M to the pool by default.
// The pool also acts as the SOL fee-payer for every user-facing flow,
// so users never need devnet SOL of their own.
const DEFAULT_OST = 100_000_000;
const DEFAULT_SOL = 5;

const cluster = 'devnet';
const rpcUrl = clusterApiUrl('devnet');

const ostArg = process.argv.includes('--ost')
  ? parseInt(process.argv[process.argv.indexOf('--ost') + 1], 10)
  : DEFAULT_OST;

const solArg = process.argv.includes('--sol')
  ? parseFloat(process.argv[process.argv.indexOf('--sol') + 1])
  : DEFAULT_SOL;

function loadAdminKeypair(): Keypair {
  const keypairPath = process.env.ANCHOR_WALLET || path.join(
    process.env.USERPROFILE || process.env.HOME || '.',
    '.config',
    'solana',
    'id.json'
  );
  if (!fs.existsSync(keypairPath)) {
    throw new Error(`Admin keypair not found at ${keypairPath}`);
  }
  const rawKey = JSON.parse(fs.readFileSync(keypairPath, 'utf-8'));
  return Keypair.fromSecretKey(Uint8Array.from(rawKey));
}

async function main() {
  console.log('============================================');
  console.log('  OST Swap Pool Initialiser (devnet)');
  console.log('============================================');

  const admin = loadAdminKeypair();
  const conn = new Connection(rpcUrl, 'confirmed');

  // Load mint info
  const mintInfoPath = path.join(__dirname, '..', 'mint-info.json');
  if (!fs.existsSync(mintInfoPath)) throw new Error('mint-info.json missing — run init-program.ts first');
  const mintInfo = JSON.parse(fs.readFileSync(mintInfoPath, 'utf-8'));
  const mint = new PublicKey(mintInfo.mint);

  // Load or create swap-pool keypair
  const poolPath = path.join(__dirname, '..', 'swap-pool.json');
  let pool: Keypair;
  if (fs.existsSync(poolPath)) {
    const raw = JSON.parse(fs.readFileSync(poolPath, 'utf-8'));
    pool = Keypair.fromSecretKey(Uint8Array.from(raw));
    console.log(`Reusing existing swap pool: ${pool.publicKey.toBase58()}`);
  } else {
    pool = Keypair.generate();
    fs.writeFileSync(poolPath, JSON.stringify(Array.from(pool.secretKey)));
    console.log(`Generated new swap pool: ${pool.publicKey.toBase58()}`);
  }

  console.log(`Admin: ${admin.publicKey.toBase58()}`);

  // 1) Top up SOL balance on the swap pool
  const currentSol = await conn.getBalance(pool.publicKey);
  console.log(`Pool SOL: ${(currentSol / LAMPORTS_PER_SOL).toFixed(4)}`);
  const targetLamports = Math.round(solArg * LAMPORTS_PER_SOL);
  if (currentSol < targetLamports) {
    const needed = targetLamports - currentSol;
    console.log(`Topping up ${(needed / LAMPORTS_PER_SOL).toFixed(4)} SOL from admin...`);
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: admin.publicKey,
        toPubkey: pool.publicKey,
        lamports: needed,
      })
    );
    const sig = await sendAndConfirmTransaction(conn, tx, [admin]);
    console.log(`  SOL top-up sig: ${sig}`);
  }

  // 2) Make sure the pool has an OST ATA
  const poolAta = getAssociatedTokenAddressSync(
    mint, pool.publicKey, false, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID
  );
  let poolAtaInfo = await conn.getAccountInfo(poolAta);
  if (!poolAtaInfo) {
    console.log('Creating pool OST associated token account...');
    const tx = new Transaction().add(
      createAssociatedTokenAccountInstruction(
        admin.publicKey, poolAta, pool.publicKey, mint,
        TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID
      )
    );
    const sig = await sendAndConfirmTransaction(conn, tx, [admin]);
    console.log(`  ATA sig: ${sig}`);
  }

  // 3) Transfer OST from admin's ATA to the pool
  const adminAta = getAssociatedTokenAddressSync(
    mint, admin.publicKey, false, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID
  );
  const adminAcct = await getAccount(conn, adminAta, 'confirmed', TOKEN_2022_PROGRAM_ID);
  const adminBal = Number(adminAcct.amount) / 10 ** DECIMALS;
  console.log(`Admin OST balance: ${adminBal.toLocaleString()}`);

  const desired = BigInt(ostArg) * BigInt(10 ** DECIMALS);
  if (adminAcct.amount < desired) {
    throw new Error(`Admin only holds ${adminBal} OST, need ${ostArg} for pool refill`);
  }
  console.log(`Transferring ${ostArg.toLocaleString()} OST to pool...`);
  const tx2 = new Transaction().add(
    createTransferCheckedInstruction(
      adminAta, mint, poolAta, admin.publicKey,
      desired, DECIMALS, [], TOKEN_2022_PROGRAM_ID
    )
  );
  const sig2 = await sendAndConfirmTransaction(conn, tx2, [admin]);
  console.log(`  OST transfer sig: ${sig2}`);

  const poolFinal = await getAccount(conn, poolAta, 'confirmed', TOKEN_2022_PROGRAM_ID);
  console.log(`Pool OST balance now: ${(Number(poolFinal.amount) / 10 ** DECIMALS).toLocaleString()}`);

  // 4) Write docs/swap-pool.js — PUBLIC METADATA ONLY. No secretKey field.
  //    The worker never reads this file; it's just so the browser can show
  //    the pool's address / derive ATAs for read-only display purposes.
  const docsPath = path.join(__dirname, '..', 'docs', 'swap-pool.js');
  const banner = '/* AUTO-GENERATED by scripts/init-swap-pool.ts — public metadata only. The secret key is a Wrangler secret on the worker, never written here. */\n';
  const body =
    'window.OST_SWAP_POOL = ' + JSON.stringify({
      cluster: 'devnet',
      publicKey: pool.publicKey.toBase58(),
      ata: poolAta.toBase58(),
      mint: mint.toBase58(),
      decimals: DECIMALS,
    }, null, 2) + ';\n';
  fs.writeFileSync(docsPath, banner + body);
  console.log(`Wrote ${docsPath} (public metadata only)`);

  // 5) Print the secret for the operator to push to the worker — never to a file under docs/.
  console.log('\n============================================');
  console.log('  Pool secret key — push this to the worker, do not commit it:');
  console.log('============================================');
  console.log(JSON.stringify(Array.from(pool.secretKey)));
  console.log('\nRun from workers/ost-api/:');
  console.log('  npx wrangler secret put OST_POOL_SECRET_KEY');
  console.log('  (paste the array printed above when prompted)');

  console.log('\nDone. Refresh the site to pick up the new swap pool metadata.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

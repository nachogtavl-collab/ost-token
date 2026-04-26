// =============================================================================
// OST Token — Fund Faucet Treasury
// =============================================================================
// Moves OST from the admin ATA into the treasury ATA so the website faucet can
// actually serve devnet claims.
//
// Usage:
//   npx ts-node scripts/fund-faucet-treasury.ts                    # 1,000,000 OST
//   npx ts-node scripts/fund-faucet-treasury.ts --amount 250000    # custom amount
// =============================================================================

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  clusterApiUrl,
  sendAndConfirmTransaction,
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
const DEFAULT_AMOUNT = 1_000_000;

const cluster = process.argv.includes('--cluster')
  ? process.argv[process.argv.indexOf('--cluster') + 1]
  : 'devnet';

const amountArg = process.argv.includes('--amount')
  ? parseInt(process.argv[process.argv.indexOf('--amount') + 1], 10)
  : DEFAULT_AMOUNT;

const rpcUrl = cluster === 'mainnet'
  ? clusterApiUrl('mainnet-beta')
  : cluster === 'localnet'
    ? 'http://localhost:8899'
    : clusterApiUrl('devnet');

function getTreasuryAuthorityPda() {
  return PublicKey.findProgramAddressSync([Buffer.from('treasury-authority')], PROGRAM_ID);
}

function loadAdminKeypair() {
  const keypairPath = process.env.ANCHOR_WALLET || path.join(
    process.env.USERPROFILE || process.env.HOME || '.',
    '.config',
    'solana',
    'id.json'
  );

  if (!fs.existsSync(keypairPath)) {
    throw new Error(`Keypair not found at ${keypairPath}`);
  }

  const rawKey = JSON.parse(fs.readFileSync(keypairPath, 'utf-8'));
  return Keypair.fromSecretKey(Uint8Array.from(rawKey));
}

async function main() {
  if (!Number.isFinite(amountArg) || amountArg <= 0) {
    throw new Error('Amount must be a positive integer');
  }

  const mintInfoPath = path.join(__dirname, '..', 'mint-info.json');
  if (!fs.existsSync(mintInfoPath)) {
    throw new Error('mint-info.json not found. Run init-program.ts first.');
  }

  const mintInfo = JSON.parse(fs.readFileSync(mintInfoPath, 'utf-8'));
  const admin = loadAdminKeypair();
  const adminAddress = admin.publicKey.toBase58();
  if (mintInfo.admin && mintInfo.admin !== adminAddress) {
    throw new Error(`Loaded wallet ${adminAddress} does not match mint admin ${mintInfo.admin}`);
  }

  const mint = new PublicKey(mintInfo.mint);
  const connection = new Connection(rpcUrl, 'confirmed');
  const [treasuryAuthority] = getTreasuryAuthorityPda();

  const adminAta = getAssociatedTokenAddressSync(
    mint,
    admin.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  const treasuryAta = getAssociatedTokenAddressSync(
    mint,
    treasuryAuthority,
    true,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  const rawAmount = BigInt(amountArg) * BigInt(10 ** DECIMALS);
  const transaction = new Transaction();

  const treasuryAtaInfo = await connection.getAccountInfo(treasuryAta);
  if (!treasuryAtaInfo) {
    transaction.add(
      createAssociatedTokenAccountInstruction(
        admin.publicKey,
        treasuryAta,
        treasuryAuthority,
        mint,
        TOKEN_2022_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
    );
  }

  transaction.add(
    createTransferCheckedInstruction(adminAta, mint, treasuryAta, admin.publicKey, rawAmount, DECIMALS, [], TOKEN_2022_PROGRAM_ID)
  );

  console.log('============================================');
  console.log('  OST Token — Fund Faucet Treasury');
  console.log(`  Cluster:         ${cluster}`);
  console.log(`  Admin:           ${adminAddress}`);
  console.log(`  Mint:            ${mint.toBase58()}`);
  console.log(`  Admin ATA:       ${adminAta.toBase58()}`);
  console.log(`  Treasury ATA:    ${treasuryAta.toBase58()}`);
  console.log(`  Transfer amount: ${amountArg.toLocaleString()} OST`);
  console.log('============================================\n');

  const signature = await sendAndConfirmTransaction(connection, transaction, [admin], {
    commitment: 'confirmed',
  });

  const [adminAccount, treasuryAccount] = await Promise.all([
    getAccount(connection, adminAta, 'confirmed', TOKEN_2022_PROGRAM_ID),
    getAccount(connection, treasuryAta, 'confirmed', TOKEN_2022_PROGRAM_ID),
  ]);

  console.log(`✅ Treasury funded: ${signature}`);
  console.log(`Admin balance:    ${(Number(adminAccount.amount) / 10 ** DECIMALS).toLocaleString()} OST`);
  console.log(`Treasury balance: ${(Number(treasuryAccount.amount) / 10 ** DECIMALS).toLocaleString()} OST`);
}

main().catch((error) => {
  console.error('ERROR:', error instanceof Error ? error.message : error);
  process.exit(1);
});



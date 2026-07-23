// Fund the PLAY POOL's OSTG headroom, which is what backs both play balances
// and the lending reserve.
//
// OSTG's mint authority is the BRIDGE PDA, not the deployer - by design: OSTG
// may only exist when OSTC is locked behind it. So we do NOT mint OSTG. We
// bridge (locking real OSTC in the vault) and then move the OSTG to the pool.
// That keeps the 1:1 backing true; minting OSTG directly would silently break
// the peg every other balance depends on.
//
//   node fund-pool-ostg.mjs <amount>
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction, sendAndConfirmTransaction } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync, getAccount, getOrCreateAssociatedTokenAccount, createTransferCheckedInstruction } from '@solana/spl-token';

const RPC = 'https://api.devnet.solana.com';
const PROGRAM_ID = new PublicKey('J7jqcwT44CY4oXjwu6fwfiFvQDWBQRsueqL7dsZjnrJd');
const OSTC = new PublicKey('383pTzoZ8Gp83dzk23ZnvLcfX2Sq32TAGN48CMQu2pAJ');
const OSTG = new PublicKey('DfgxMbdN49AX2Za9LuvsyixF1jgVh45RbgWYSGonxQos');
const BRIDGE = new PublicKey('BnphbE6izjGaC1D4XazDoyVZooLxBDhYqHfzenXuMxPK');
const VAULT = new PublicKey('8X6pL7QtYqGd8pzkVA3nkWu36rRw9YQsUGh79V6XRYak');
const POOL = new PublicKey('5ibGwXAV6yLZPR6uWbzou1LaHhmhehjYEpqWZKZw5WZS');
const TP = TOKEN_2022_PROGRAM_ID, DEC = 9;
const disc = (n) => createHash('sha256').update('global:' + n).digest().subarray(0, 8);
const u64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const raw = (n) => BigInt(Math.round(n * 10 ** DEC));
const ui = (n) => Number(n) / 10 ** DEC;
const authority = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(process.env.USERPROFILE + '/.config/solana/id.json', 'utf8'))));
const conn = new Connection(RPC, 'confirmed');
const ata = (m, o) => getAssociatedTokenAddressSync(m, o, true, TP);
const bal = async (a) => { try { return ui((await getAccount(conn, a, 'confirmed', TP)).amount); } catch { return 0; } };

const AMOUNT = Number(process.argv[2] || 100000);

(async () => {
  const o = authority.publicKey;
  const poolOstg = ata(OSTG, POOL);
  console.log('pool OSTG before  :', await bal(poolOstg));
  console.log('authority OSTC    :', await bal(ata(OSTC, o)));

  await getOrCreateAssociatedTokenAccount(conn, authority, OSTG, o, false, 'confirmed', undefined, TP);

  // 1) bridge OSTC -> OSTG (locks OSTC in the vault, mints matching OSTG)
  const depositIx = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: BRIDGE, isSigner: false, isWritable: false },
      { pubkey: OSTC, isSigner: false, isWritable: true },
      { pubkey: OSTG, isSigner: false, isWritable: true },
      { pubkey: VAULT, isSigner: false, isWritable: true },
      { pubkey: ata(OSTC, o), isSigner: false, isWritable: true },
      { pubkey: ata(OSTG, o), isSigner: false, isWritable: true },
      { pubkey: o, isSigner: true, isWritable: false },
      { pubkey: TP, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([disc('deposit'), u64(raw(AMOUNT))]),
  });
  const sig1 = await sendAndConfirmTransaction(conn, new Transaction().add(depositIx), [authority], { commitment: 'confirmed' });
  console.log('bridged', AMOUNT, 'OSTC -> OSTG  tx', sig1);

  // 2) move it into the pool so it backs play balances + the lending reserve
  const xfer = createTransferCheckedInstruction(ata(OSTG, o), OSTG, poolOstg, o, raw(AMOUNT), DEC, [], TP);
  const sig2 = await sendAndConfirmTransaction(conn, new Transaction().add(xfer), [authority], { commitment: 'confirmed' });
  console.log('transferred to pool  tx', sig2);
  console.log('pool OSTG after   :', await bal(poolOstg));
})().catch((e) => { console.error('THREW:', e.message || e); process.exit(1); });

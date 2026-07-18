// One-off: bridge the authority's OSTC -> OSTG so the on-chain OSTG prediction
// e2e (predict-ostg-e2e.mjs) has OSTG to escrow. Authority signs + pays its own gas.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction, sendAndConfirmTransaction } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync, getAccount, getOrCreateAssociatedTokenAccount } from '@solana/spl-token';

const RPC = 'https://api.devnet.solana.com';
const PROGRAM_ID = new PublicKey('J7jqcwT44CY4oXjwu6fwfiFvQDWBQRsueqL7dsZjnrJd');
const OSTC = new PublicKey('383pTzoZ8Gp83dzk23ZnvLcfX2Sq32TAGN48CMQu2pAJ');
const OSTG = new PublicKey('DfgxMbdN49AX2Za9LuvsyixF1jgVh45RbgWYSGonxQos');
const BRIDGE = new PublicKey('BnphbE6izjGaC1D4XazDoyVZooLxBDhYqHfzenXuMxPK');
const VAULT = new PublicKey('8X6pL7QtYqGd8pzkVA3nkWu36rRw9YQsUGh79V6XRYak');
const TP = TOKEN_2022_PROGRAM_ID, DEC = 9;
const disc = (n) => createHash('sha256').update('global:' + n).digest().subarray(0, 8);
const u64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const raw = (n) => BigInt(Math.round(n * 10 ** DEC));
const ui = (n) => Number(n) / 10 ** DEC;
const authority = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(process.env.USERPROFILE + '/.config/solana/id.json', 'utf8'))));
const conn = new Connection(RPC, 'confirmed');
const ata = (m, o) => getAssociatedTokenAddressSync(m, o, true, TP);
const bal = async (a) => { try { return ui((await getAccount(conn, a, 'confirmed', TP)).amount); } catch { return 0; } };

const AMOUNT = Number(process.argv[2] || 100);

(async () => {
  const o = authority.publicKey;
  console.log('authority', o.toBase58());
  console.log('OSTC before', await bal(ata(OSTC, o)), ' OSTG before', await bal(ata(OSTG, o)));
  await getOrCreateAssociatedTokenAccount(conn, authority, OSTG, o, false, 'confirmed', undefined, TP);
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
  const sig = await sendAndConfirmTransaction(conn, new Transaction().add(depositIx), [authority], { commitment: 'confirmed' });
  console.log('deposited', AMOUNT, 'OSTC -> OSTG   https://explorer.solana.com/tx/' + sig + '?cluster=devnet');
  console.log('OSTC after ', await bal(ata(OSTC, o)), ' OSTG after ', await bal(ata(OSTG, o)));
})().catch((e) => { console.error('THREW:', e.message || e); process.exit(1); });

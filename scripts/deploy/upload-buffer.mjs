#!/usr/bin/env node
/* ============================================================================
 * OST · Paced, self-verifying program-buffer uploader
 * ----------------------------------------------------------------------------
 * WHY: `solana program deploy` / `write-buffer` blast every chunk-write at the
 * RPC as fast as they can. Public devnet rate-limits per IP AND per method, so
 * the CLI 429s ITSELF into a stall — it then retries, which makes the throttling
 * worse, and the upload never finishes (observed: 55 minutes, zero progress, and
 * even a plain `getHealth` from the same IP started returning 429).
 *
 * Two things make this one finish:
 *   1. PACING + backoff, so we stay under the limit instead of fighting it.
 *   2. VERIFY-AND-REPAIR: after writing, we read the buffer back and re-write
 *      only the chunks whose bytes don't match, looping until it converges.
 *      A dropped or throttled write is therefore harmless — correctness does not
 *      depend on every send succeeding, which is what made the CLI so brittle.
 *
 * It writes a BUFFER only. The (small, single-tx) upgrade is then done with:
 *   solana program deploy --buffer <BUFFER> --program-id <KEYPAIR> --url devnet
 *
 * Usage: node upload-buffer.mjs <program.so> [--rate 4] [--resume <BUFFER>]
 * ========================================================================== */
import { readFileSync } from 'node:fs';
import {
  Connection, Keypair, PublicKey, SystemProgram, Transaction,
  TransactionInstruction, sendAndConfirmTransaction
} from '@solana/web3.js';

// web3.js can reject from inside its own confirmation retry loop, outside any
// await we control. Without this the process dies mid-upload on a single 429.
process.on('unhandledRejection', (e) => {
  console.warn('\n  [warn] background rejection ignored:', String((e && e.message) || e).slice(0, 90));
});

const BPF_LOADER_UPGRADEABLE = new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');
const RPC = process.env.OST_RPC || 'https://api.devnet.solana.com';

const args = process.argv.slice(2);
const soPath = args.find((a) => !a.startsWith('--') && a.endsWith('.so'));
const rate = Number(args[args.indexOf('--rate') + 1]) || 4;        // writes per second
const resume = args.includes('--resume') ? new PublicKey(args[args.indexOf('--resume') + 1]) : null;
if (!soPath) { console.error('usage: node upload-buffer.mjs <program.so> [--rate N] [--resume BUFFER]'); process.exit(1); }

const payer = Keypair.fromSecretKey(Uint8Array.from(
  JSON.parse(readFileSync(process.env.USERPROFILE + '/.config/solana/id.json', 'utf8'))));
const conn = new Connection(RPC, 'confirmed');
const code = readFileSync(soPath);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// UpgradeableLoaderState::Buffer = 4 (enum) + 1 (Option tag) + 32 (authority) = 37
const BUFFER_METADATA = 37;
// Keep each write tx comfortably under the 1232-byte packet limit.
const CHUNK = 900;

const is429 = (e) => /429|Too Many Requests|rate limit/i.test(String((e && e.message) || e));

async function retry(fn, tries = 10) {
  let delay = 700;
  for (let i = 1; ; i++) {
    try { return await fn(); } catch (e) {
      if (i >= tries) throw e;
      await sleep(is429(e) ? delay * 2 : delay);
      delay = Math.min(delay * 1.7, 20000);
    }
  }
}

function ixInitBuffer(buffer, authority) {
  const data = Buffer.alloc(4);
  data.writeUInt32LE(0, 0);                       // InitializeBuffer
  return new TransactionInstruction({
    programId: BPF_LOADER_UPGRADEABLE,
    keys: [
      { pubkey: buffer, isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: false, isWritable: false }
    ],
    data
  });
}

function ixWrite(buffer, authority, offset, bytes) {
  // Write { offset: u32, bytes: Vec<u8> }  -> tag 1; Vec length is u64 LE.
  const data = Buffer.alloc(4 + 4 + 8 + bytes.length);
  data.writeUInt32LE(1, 0);
  data.writeUInt32LE(offset, 4);
  data.writeUInt32LE(bytes.length, 8);
  data.writeUInt32LE(0, 12);
  bytes.copy(data, 16);
  return new TransactionInstruction({
    programId: BPF_LOADER_UPGRADEABLE,
    keys: [
      { pubkey: buffer, isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: false }
    ],
    data
  });
}

const writeChunk = (buffer, i) => retry(() => sendAndConfirmTransaction(
  conn,
  new Transaction().add(ixWrite(buffer, payer.publicKey, i * CHUNK,
    code.subarray(i * CHUNK, Math.min((i + 1) * CHUNK, code.length)))),
  [payer],
  { commitment: 'confirmed', maxRetries: 3, skipPreflight: true }
));

/** Which chunks on-chain do NOT match the local .so? */
async function missingChunks(buffer, total) {
  const info = await retry(() => conn.getAccountInfo(buffer, 'confirmed'));
  if (!info) throw new Error('buffer account is gone');
  const onChain = info.data.subarray(BUFFER_METADATA);
  const missing = [];
  for (let i = 0; i < total; i++) {
    const a = code.subarray(i * CHUNK, Math.min((i + 1) * CHUNK, code.length));
    const b = onChain.subarray(i * CHUNK, Math.min((i + 1) * CHUNK, code.length));
    if (!a.equals(b)) missing.push(i);
  }
  return missing;
}

(async () => {
  console.log(`paced buffer upload — ${code.length} bytes, ${rate}/s, rpc ${RPC}`);
  const total = Math.ceil(code.length / CHUNK);

  let buffer = resume;
  if (!buffer) {
    const kp = Keypair.generate();
    buffer = kp.publicKey;
    const space = BUFFER_METADATA + code.length;
    const lamports = await retry(() => conn.getMinimumBalanceForRentExemption(space));
    await retry(() => sendAndConfirmTransaction(conn, new Transaction()
      .add(SystemProgram.createAccount({
        fromPubkey: payer.publicKey, newAccountPubkey: buffer,
        lamports, space, programId: BPF_LOADER_UPGRADEABLE
      }))
      .add(ixInitBuffer(buffer, payer.publicKey)),
      [payer, kp], { commitment: 'confirmed' }));
    console.log(`buffer created ${buffer.toBase58()}  (${(lamports / 1e9).toFixed(3)} SOL rent)`);
  } else {
    console.log('resuming into buffer', buffer.toBase58());
  }

  const gap = 1000 / rate;
  // Pass 1..N: write whatever is still missing, then verify. Converges even if
  // individual sends get throttled or dropped.
  for (let pass = 1; pass <= 8; pass++) {
    const todo = pass === 1 && !resume
      ? Array.from({ length: total }, (_, i) => i)
      : await missingChunks(buffer, total);

    if (!todo.length) {
      console.log(`\nverified: all ${total} chunks match the local binary.`);
      console.log(`\nBUFFER READY: ${buffer.toBase58()}`);
      console.log('now run:');
      console.log(`  solana program deploy --buffer ${buffer.toBase58()} \\`);
      console.log('    --program-id target/deploy/<program>-keypair.json --url devnet');
      return;
    }

    console.log(`\npass ${pass}: writing ${todo.length} chunk(s)`);
    const t0 = Date.now();
    let done = 0;
    for (const i of todo) {
      try { await writeChunk(buffer, i); } catch (e) {
        process.stdout.write('x');            // will be caught by the verify pass
      }
      done++;
      if (done % 25 === 0 || done === todo.length) {
        const el = ((Date.now() - t0) / 1000).toFixed(0);
        process.stdout.write(`\r  ${((done / todo.length) * 100).toFixed(1)}%  ${done}/${todo.length}  ${el}s   `);
      }
      await sleep(gap);
    }
  }
  throw new Error('buffer did not converge after 8 passes');
})().catch((e) => { console.error('\nFAILED:', e.message); process.exit(1); });

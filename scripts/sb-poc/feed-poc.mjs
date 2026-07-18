// Switchboard On-Demand devnet PoC: create a deterministic pull feed (valueTask
// -> constant), post an update on-chain, and read the value back. Proves the feed
// data path the ost-betting resolve_with_switchboard instruction depends on.
import { readFileSync } from 'node:fs';
import { Connection, Keypair, VersionedTransaction, TransactionMessage, ComputeBudgetProgram } from '@solana/web3.js';
import { PullFeed, getDefaultDevnetQueue, AnchorUtils } from '@switchboard-xyz/on-demand';
import { OracleJob } from '@switchboard-xyz/common';

const RPC = 'https://api.devnet.solana.com';
const conn = new Connection(RPC, 'confirmed');
const authority = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(process.env.USERPROFILE + '/.config/solana/id.json', 'utf8'))));
const VALUE = Number(process.argv[2] ?? 1);   // 1 = YES, 0 = NO

async function sendV(vtx, extraSigners = []) {
  const { blockhash } = await conn.getLatestBlockhash('confirmed');
  vtx.message.recentBlockhash = blockhash;
  vtx.sign([authority, ...extraSigners]);
  const sig = await conn.sendTransaction(vtx, { skipPreflight: false, maxRetries: 5 });
  await conn.confirmTransaction(sig, 'confirmed');
  return sig;
}

(async () => {
  console.log('authority', authority.publicKey.toBase58());
  const [wallet] = AnchorUtils.initWalletFromFile(process.env.USERPROFILE + '/.config/solana/id.json');
  const program = await AnchorUtils.loadProgramFromConnection(conn, wallet);  // wallet provider -> payer
  const queue = await getDefaultDevnetQueue(RPC);
  console.log('devnet queue', queue.pubkey.toBase58());

  const jobs = [OracleJob.fromObject({ tasks: [{ valueTask: { value: VALUE } }] })];
  console.log('creating feed with a constant valueTask =', VALUE, '…');
  // NB: PullFeed.initTx forgets to forward the payer to the tx builder (SDK bug),
  // so build the init tx ourselves from generate() + initIx().
  const [feed, feedKp] = PullFeed.generate(program);
  const initIx = await feed.initIx({
    name: 'OST-EVENT-TEST',
    queue: queue.pubkey,
    maxVariance: 1.0,
    minResponses: 1,
    minSampleSize: 1,
    maxStaleness: 300,
    payer: authority.publicKey,
    jobs,
  });
  const initMsg = new TransactionMessage({
    payerKey: authority.publicKey,
    recentBlockhash: (await conn.getLatestBlockhash('confirmed')).blockhash,
    instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: 400000 }), initIx],
  }).compileToV0Message();
  const initVtx = new VersionedTransaction(initMsg);
  const initSig = await sendV(initVtx, [feedKp]);
  console.log('  feed', feed.pubkey.toBase58(), '  init', initSig.slice(0, 12) + '…');

  console.log('fetching a signed oracle update (crossbar/gateway → oracles)…');
  const [updateIxs, responses, numSuccess, luts] = await feed.fetchUpdateIx({ numSignatures: 1 });
  console.log('  oracle successes:', numSuccess, ' ixs:', updateIxs ? updateIxs.length : 0);
  if (!updateIxs || !updateIxs.length) throw new Error('no update instructions returned');

  // The Ed25519 verify ix MUST stay at index 0 (the update ix references it by
  // position), so update ixs go FIRST; the compute-budget ix goes after.
  const msg = new TransactionMessage({
    payerKey: authority.publicKey,
    recentBlockhash: (await conn.getLatestBlockhash('confirmed')).blockhash,
    instructions: [...updateIxs, ComputeBudgetProgram.setComputeUnitLimit({ units: 400000 })],
  }).compileToV0Message(luts || []);
  const updVtx = new VersionedTransaction(msg);
  const updSig = await sendV(updVtx);
  console.log('  posted update', updSig.slice(0, 12) + '…');

  const data = await feed.loadData();
  // The current value lives in the feed's result; read it via the SDK helper.
  let val = null;
  try { val = feed.decimalValue ? feed.decimalValue() : null; } catch (_) {}
  console.log('  feed result (raw):', JSON.stringify({ result: data && data.result && data.result.value ? String(data.result.value) : data && data.result, }).slice(0, 200));
  console.log('DONE — feed', feed.pubkey.toBase58(), 'is live on devnet with value ≈', VALUE);
})().catch((e) => { console.error('THREW:', e.message || e); process.exit(1); });

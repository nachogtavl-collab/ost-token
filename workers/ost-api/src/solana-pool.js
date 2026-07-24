/* ==========================================================================
   OST Server-Side Pool Signer (Phase 0 — project-docs/TOKEN-ARCHITECTURE.md)
   ----------------------------------------------------------------------------
   The pool keypair used to live in docs/swap-pool.js and sign payouts in the
   browser. That shipped the private key to every visitor. This module holds
   the same keypair server-side (env.OST_POOL_SECRET_KEY, a Wrangler secret)
   and is the ONLY place that ever reconstructs it.

   Every transaction the pool signs is built ENTIRELY by this module from
   validated scalar inputs (wallet address, amount, memo) — it never parses
   or co-signs a transaction the client assembled. That removes the "parse
   untrusted instructions" attack surface by construction: there is nothing
   external to decode, so there is nothing to smuggle into it.
   ========================================================================== */
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  SystemProgram,
  TransactionInstruction,
  LAMPORTS_PER_SOL
} from '@solana/web3.js';
import {
  createTransferCheckedInstruction,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID
} from '@solana/spl-token';

export const OST_TOKEN_DECIMALS = 9;
const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');

// Fallbacks only — every one of these turned out unusable for real RPC calls
// from Cloudflare's egress when tested directly against the deployed worker:
// api.devnet.solana.com 403s Cloudflare's shared IPs outright ("Your IP or
// provider is blocked from this endpoint"); Helius' "?api-key=public" only
// permits trivial health-checks (401s on real methods); Alchemy's demo key
// is rate-limited into uselessness (429). None of this showed up in local
// `wrangler dev` testing because that runs from a normal residential IP.
// env.SOLANA_DEVNET_RPC (a real Helius/QuickNode/etc. key, set via
// `wrangler secret put`) is prepended at request time by ensureRpcConfigured
// and is the only endpoint actually expected to work in production — these
// three are last-resort fallbacks if that secret is ever missing.
const RPC_ENDPOINTS = [
  'https://devnet.helius-rpc.com/?api-key=public',
  'https://solana-devnet.g.alchemy.com/v2/demo',
  'https://api.devnet.solana.com'
];

let rpcConfigured = false;
// Cheap and idempotent — safe to call at the top of every exported function
// that receives env. env bindings don't vary per-request, so this only does
// real work once per warm isolate.
export function ensureRpcConfigured(env) {
  if (rpcConfigured) return;
  rpcConfigured = true;
  const override = env && env.SOLANA_DEVNET_RPC;
  if (override && !RPC_ENDPOINTS.includes(override)) RPC_ENDPOINTS.unshift(override);
}

let rpcIndex = 0;
const rpcConnections = {};
function makeConn(url) {
  if (!rpcConnections[url]) {
    try { rpcConnections[url] = new Connection(url, 'confirmed'); }
    catch (_) { return null; }
  }
  return rpcConnections[url];
}
export function getConnection() {
  return makeConn(RPC_ENDPOINTS[rpcIndex % RPC_ENDPOINTS.length]);
}
function rotateRpc() {
  rpcIndex = (rpcIndex + 1) % RPC_ENDPOINTS.length;
  return getConnection();
}
export async function withRpc(label, fn) {
  let lastErr = null;
  for (let attempt = 0; attempt < RPC_ENDPOINTS.length * 2; attempt++) {
    const conn = getConnection();
    try { return await fn(conn); }
    catch (e) {
      lastErr = e;
      rotateRpc();
      await new Promise(r => setTimeout(r, 250 * (attempt + 1)));
    }
  }
  throw lastErr || new Error(label + ' failed on every RPC');
}

let cachedPool = null;
export function getPoolKeypair(env) {
  ensureRpcConfigured(env);
  if (cachedPool) return cachedPool;
  const raw = env && env.OST_POOL_SECRET_KEY;
  if (!raw) throw new Error('OST_POOL_SECRET_KEY not configured');
  let arr;
  try { arr = JSON.parse(raw); }
  catch (_) { throw new Error('OST_POOL_SECRET_KEY is not valid JSON'); }
  cachedPool = Keypair.fromSecretKey(Uint8Array.from(arr));
  return cachedPool;
}

export function getMint(env) {
  const raw = env && env.OST_MINT;
  if (!raw) throw new Error('OST_MINT not configured');
  return new PublicKey(raw);
}

// OSTG — the game token (the bridge program's minted side). The pool sponsors gas
// for BOTH tokens, so the ATA-rent and fee-only paths must accept this mint too.
export const OSTG_MINT = 'DfgxMbdN49AX2Za9LuvsyixF1jgVh45RbgWYSGonxQos';
// OSTC (the on-chain token users hold and spend on the card). Exported so
// balance-truth reads it from ONE place instead of hard-coding the mint in a
// second file - two copies of an address is how they eventually disagree.
export const OSTC_MINT = '383pTzoZ8Gp83dzk23ZnvLcfX2Sq32TAGN48CMQu2pAJ';

// Resolve a caller-supplied mint to a PublicKey, ALLOWLISTED to the two tokens
// we sponsor. Anything else is rejected — we will not pool-pay rent for an
// arbitrary mint a client names (that would let anyone spend our SOL creating
// junk accounts). Empty/absent defaults to OST for backward compatibility.
export function resolveSponsoredMint(env, mintStr) {
  const ost = getMint(env);
  if (!mintStr || mintStr === ost.toBase58()) return ost;
  if (mintStr === OSTG_MINT) return new PublicKey(OSTG_MINT);
  throw new Error('mint_not_sponsored');
}

export function ataForMint(owner, mintPk) {
  const ownerPk = owner instanceof PublicKey ? owner : new PublicKey(owner);
  return getAssociatedTokenAddressSync(mintPk, ownerPk, true, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
}

export function poolAta(env) {
  const pool = getPoolKeypair(env);
  return getAssociatedTokenAddressSync(getMint(env), pool.publicKey, false, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
}

// Pool's ATA for a specific (sponsored) mint. Used by the play-balance rails so
// the pool can hold and move OSTG as well as OST. allowOwnerOffCurve=false: the
// pool is a plain keypair, on-curve.
export function poolAtaForMint(env, mintPk) {
  const pool = getPoolKeypair(env);
  return getAssociatedTokenAddressSync(mintPk, pool.publicKey, false, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
}

// allowOwnerOffCurve=true: some destinations are PDA-owned vault accounts
// (e.g. the interchange desk's treasury ATA), not plain wallets. The ATA
// derivation is deterministic either way; whether a PDA can actually move
// funds back out is the program's concern, not this derivation's.
export function userAta(env, owner) {
  const ownerPk = owner instanceof PublicKey ? owner : new PublicKey(owner);
  return getAssociatedTokenAddressSync(getMint(env), ownerPk, true, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
}

// -----------------------------------------------------------------------
// BigInt <-> decimal helpers (ported from docs/devnet-rescue.js so amounts
// round identically to what the client already displays).
// -----------------------------------------------------------------------
export function decimalToRawAmount(value, decimals) {
  const places = Math.max(0, Number(decimals) || 0);
  let text = String(value || '0');
  if (/e/i.test(text)) text = Number(value || 0).toFixed(places);
  const parts = text.split('.');
  const whole = String(parts[0] || '0').replace(/[^0-9]/g, '') || '0';
  let fraction = String(parts[1] || '').replace(/[^0-9]/g, '').slice(0, places);
  while (fraction.length < places) fraction += '0';
  const scale = 10n ** BigInt(places);
  return BigInt(whole) * scale + BigInt(fraction || '0');
}

export function rawToOstText(raw, decimals) {
  const places = Math.max(0, Number(decimals) || 0);
  const scale = 10n ** BigInt(places);
  const value = BigInt(raw || 0);
  const whole = value / scale;
  const fraction = (value % scale).toString().padStart(places, '0').replace(/0+$/, '');
  return whole.toString() + (fraction ? ('.' + fraction) : '');
}

export function rawToOstNumber(raw, decimals) {
  return Number(rawToOstText(raw, decimals));
}

// -----------------------------------------------------------------------
// Instruction builders — thin wrappers so callers never touch raw bytes.
// -----------------------------------------------------------------------
export function ixTransferChecked(source, mint, destination, ownerPk, amountBaseUnits, decimals) {
  return createTransferCheckedInstruction(source, mint, destination, ownerPk, amountBaseUnits, decimals, [], TOKEN_2022_PROGRAM_ID);
}

export function ixCreateAta(payerPk, ataPk, ownerPk, mintPk) {
  return createAssociatedTokenAccountInstruction(payerPk, ataPk, ownerPk, mintPk, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
}

export function ixMemo(text, signerPk) {
  return new TransactionInstruction({
    programId: MEMO_PROGRAM_ID,
    keys: signerPk ? [{ pubkey: signerPk, isSigner: true, isWritable: false }] : [],
    data: new TextEncoder().encode(String(text || ''))
  });
}

export function ixSolTransfer(fromPk, toPk, lamports) {
  return SystemProgram.transfer({ fromPubkey: fromPk, toPubkey: toPk, lamports });
}

// -----------------------------------------------------------------------
// 'fee-only' cosign: some flows (docs/ost-onchain-market.js betting — stake/
// claim_payout against the deployed ost-betting program) need the pool to
// pay the transaction fee for instructions the WORKER has no business
// understanding (arbitrary program, PDAs, discriminators it doesn't know).
// Building-from-scalars doesn't work here — there's nothing to build. The
// safety property that makes accepting client-supplied instructions okay
// ANYWAY for this one kind: the pool is verified to be a complete bystander,
// referenced in NO instruction's account list at all. It can only ever be
// the transaction-level fee payer. If that check passes, the pool's
// signature authorizes nothing but the fee — regardless of which program is
// being called or what the instruction data says.
export function ixFromJson(entry) {
  const programId = new PublicKey(String(entry.programId));
  const keys = (Array.isArray(entry.keys) ? entry.keys : []).map(k => ({
    pubkey: new PublicKey(String(k.pubkey)),
    isSigner: !!k.isSigner,
    isWritable: !!k.isWritable
  }));
  const data = entry.data ? Buffer.from(String(entry.data), 'base64') : Buffer.alloc(0);
  return new TransactionInstruction({ programId, keys, data });
}

export function assertPoolAbsent(instructions, poolPubkey) {
  const poolStr = poolPubkey.toBase58();
  for (const ix of instructions) {
    if (ix.programId.toBase58() === poolStr) throw new Error('fee-only cosign: pool cannot be the target program');
    for (const k of ix.keys) {
      if (k.pubkey.toBase58() === poolStr) throw new Error('fee-only cosign: pool referenced inside an instruction — only allowed as fee payer');
    }
  }
}

// -----------------------------------------------------------------------
// Balances
// -----------------------------------------------------------------------
// Deliberately does NOT catch-and-return-0 on failure. This reads the
// POOL'S OWN ATA, which is an invariant of a healthy deployment (created at
// init time, never expected to disappear) — any error here means the read
// failed, not that the balance is zero. Swallowing it into 0n used to make
// a transient RPC hiccup indistinguishable from "the vault is empty," which
// (a) produced a false insufficient_pool rejection on a real, well-funded
// pool, and (b) silently defeated withRpc's multi-endpoint retry, since the
// error never propagated far enough to trigger it. Let it throw; withRpc
// retries across endpoints, and a genuine failure surfaces honestly instead
// of masquerading as a business rejection.
export async function getTokenRawBalance(conn, ata) {
  const bal = await conn.getTokenAccountBalance(ata);
  return BigInt((bal && bal.value && bal.value.amount) || '0');
}

export async function getPoolOstBalance(env) {
  return withRpc('pool-ost', async conn => rawToOstNumber(await getTokenRawBalance(conn, poolAta(env)), OST_TOKEN_DECIMALS));
}

export async function getPoolSolBalance(env) {
  const pool = getPoolKeypair(env);
  return withRpc('pool-sol', async conn => {
    const lam = await conn.getBalance(pool.publicKey);
    return lam / LAMPORTS_PER_SOL;
  });
}

export async function ataExists(conn, ata) {
  const info = await conn.getAccountInfo(ata).catch(() => null);
  return !!info;
}

// -----------------------------------------------------------------------
// Send + confirm — ported from docs/devnet-rescue.js sendPoolOnlyTx /
// confirmSentTransaction. Workers have no websocket confirmTransaction, so
// this polls getSignatureStatuses across every RPC endpoint.
// -----------------------------------------------------------------------
async function unpackSendError(err) {
  if (!err) return new Error('Transaction failed');
  let logs = [];
  if (typeof err.getLogs === 'function') { try { logs = await err.getLogs(); } catch (_) {} }
  else if (Array.isArray(err.logs)) { logs = err.logs; }
  const base = err.message || 'Send failed';
  if (logs && logs.length) return new Error(base + '\n\nProgram logs:\n' + logs.join('\n'));
  return err;
}

async function sendRawSafe(conn, serialized) {
  try {
    return await conn.sendRawTransaction(serialized, { skipPreflight: false, preflightCommitment: 'confirmed' });
  } catch (e) {
    const msg = (e && e.message) || '';
    if (msg.includes('no record of a prior credit') || /simulation failed/i.test(msg)) {
      return conn.sendRawTransaction(serialized, { skipPreflight: true });
    }
    throw await unpackSendError(e);
  }
}

export class BlockhashExpiredError extends Error {
  constructor(message) { super(message); this.name = 'BlockhashExpiredError'; this.code = 'blockhash_expired'; }
}

export async function confirmSignature(sig, blockhashInfo, label) {
  // Deliberately skips @solana/web3.js's Connection.confirmTransaction() —
  // without a WebSocket subscription (which this runtime doesn't give it),
  // it falls back to slow internal long-polling that was observed to hang
  // for 45-60s+ against a live deployment even though the RPC endpoint
  // itself responds in well under a second. Goes straight to the manual
  // getSignatureStatuses polling loop below, which was built for exactly
  // this reason and is what actually gets used regardless.
  let lastStatus = null;
  for (let attempt = 0; attempt < 8; attempt++) {
    for (let i = 0; i < RPC_ENDPOINTS.length; i++) {
      const conn = makeConn(RPC_ENDPOINTS[i]);
      if (!conn) continue;
      try {
        const sres = await conn.getSignatureStatuses([sig], { searchTransactionHistory: true });
        const entry = sres && sres.value && sres.value[0];
        if (entry) {
          lastStatus = entry;
          if (entry.err) throw new Error('On-chain failure: ' + JSON.stringify(entry.err));
          if (entry.confirmationStatus === 'confirmed' || entry.confirmationStatus === 'finalized') return sig;
        }
      } catch (statusErr) {
        if (statusErr && /On-chain failure/i.test(statusErr.message || '')) throw statusErr;
      }
    }
    // A pool tx usually reaches 'confirmed' in well under a second — poll TIGHT
    // for the first few attempts so payouts/sells/sends return the instant the
    // chain confirms, then back off. (Still requires a real confirmation; this
    // only shortens detection latency, it never returns before the tx lands.)
    await new Promise(r => setTimeout(r, attempt < 3 ? 250 : 600 + attempt * 200));
  }
  const summary = lastStatus ? 'last status=' + (lastStatus.confirmationStatus || 'unknown') : 'no status from any RPC';
  throw new Error((label || 'Transaction') + ' could not be confirmed on-chain (' + summary + ')');
}

// Builds a fresh Transaction with the given instructions, pool as fee payer,
// a live blockhash, signs with `signers` (pool always included), and sends
// (does NOT confirm — see confirmSignature). Splitting send from confirm lets
// callers persist the signature durably the instant broadcast succeeds, so a
// crash between broadcast and confirmation can be recovered by polling the
// known signature instead of building and sending a second transaction.
// Throws BlockhashExpiredError if the blockhash goes stale before send —
// callers should surface that as "quote expired, please retry".
export async function buildSignSend(env, instructions, extraSigners, label) {
  const pool = getPoolKeypair(env);
  const conn = getConnection();
  const tx = new Transaction();
  instructions.forEach(ix => { if (ix) tx.add(ix); });
  tx.feePayer = pool.publicKey;
  const bh = await conn.getLatestBlockhash('confirmed');
  tx.recentBlockhash = bh.blockhash;
  tx.lastValidBlockHeight = bh.lastValidBlockHeight;
  tx.sign(pool, ...(extraSigners || []));

  let sig;
  try {
    sig = await sendRawSafe(conn, tx.serialize());
  } catch (e) {
    const msg = (e && e.message) || '';
    if (/block height exceeded|blockhash not found|expired/i.test(msg)) {
      throw new BlockhashExpiredError(label + ': blockhash expired before send, please retry');
    }
    throw await unpackSendError(e);
  }
  return { sig, blockhashInfo: bh };
}

export async function buildSignSendConfirm(env, instructions, extraSigners, label) {
  const { sig, blockhashInfo } = await buildSignSend(env, instructions, extraSigners, label);
  await confirmSignature(sig, blockhashInfo, label);
  return sig;
}

// Builds a transaction the pool partial-signs (fee payer + its own leg, if
// any) but does NOT send — the caller (the user's wallet) still needs to add
// their signature before this can be submitted. Returns the still-incomplete
// transaction as base64 so it can be handed back to the client unchanged.
// A client cannot alter the instruction list after this point without
// invalidating the pool's signature (it covers the whole message), so the
// submit step below only needs to check liveness (blockhash), not re-parse
// the transaction for tampering — Solana's own signature verification does
// that for free.
export async function buildAndPartialSignByPool(env, instructions) {
  const pool = getPoolKeypair(env);
  const conn = getConnection();
  const tx = new Transaction();
  instructions.forEach(ix => { if (ix) tx.add(ix); });
  tx.feePayer = pool.publicKey;
  const bh = await conn.getLatestBlockhash('confirmed');
  tx.recentBlockhash = bh.blockhash;
  tx.lastValidBlockHeight = bh.lastValidBlockHeight;
  tx.partialSign(pool);
  return { tx, blockhashInfo: bh };
}

export function txToBase64(tx) {
  return Buffer.from(tx.serialize({ requireAllSignatures: false, verifySignatures: false })).toString('base64');
}

export function txFromBase64(base64) {
  return Transaction.from(Buffer.from(base64, 'base64'));
}

// Submits a transaction that already carries every required signature
// (pool's, added earlier via partialSignAsPool, plus the user's, added
// client-side). Does not rebuild or re-derive anything from it.
export async function sendSignedAndConfirm(tx, blockhashInfo, label) {
  const conn = getConnection();
  let sig;
  try {
    sig = await sendRawSafe(conn, tx.serialize());
  } catch (e) {
    const msg = (e && e.message) || '';
    if (/block height exceeded|blockhash not found|expired/i.test(msg)) {
      throw new BlockhashExpiredError(label + ': blockhash expired before submit, please re-quote');
    }
    throw await unpackSendError(e);
  }
  await confirmSignature(sig, blockhashInfo, label);
  return sig;
}

// -----------------------------------------------------------------------
// Price quotes — mirrors docs/wallet-extras.js quoteSolToOst (0.5% pool fee)
// so the on-chain amount matches what the UI already showed the user.
// -----------------------------------------------------------------------
const SOL_USD_FEEDS = [
  { url: 'https://api.coinbase.com/v2/prices/SOL-USD/spot', pick: b => b?.data?.amount && Number(b.data.amount) },
  { url: 'https://api.binance.com/api/v3/ticker/price?symbol=SOLUSDT', pick: b => b?.price && Number(b.price) },
  { url: 'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd', pick: b => b?.solana?.usd && Number(b.solana.usd) }
];
export async function fetchSolUsd() {
  for (const feed of SOL_USD_FEEDS) {
    try {
      const res = await fetch(feed.url, { headers: { accept: 'application/json' }, cf: { cacheTtl: 10, cacheEverything: true } });
      if (!res.ok) continue;
      const body = await res.json();
      const price = feed.pick(body);
      if (Number.isFinite(price) && price > 1) return price;
    } catch (_) {}
  }
  return 150; // last-resort fallback, matches docs/wallet-extras.js
}

export function ostUsd(env) {
  const configured = Number(env && env.TOPUP_USD_PER_OST);
  return Number.isFinite(configured) && configured > 0 ? configured : 0.0118;
}

const POOL_SWAP_FEE = 0.005; // 0.5%, matches docs/wallet-extras.js quoteSolToOst

export async function quoteSolToOst(env, solAmount) {
  const [solUsdPrice, ostUsdPrice] = [await fetchSolUsd(), ostUsd(env)];
  const grossOst = (Number(solAmount) * solUsdPrice) / ostUsdPrice;
  const fee = grossOst * POOL_SWAP_FEE;
  return { ost: grossOst - fee, fee, solUsd: solUsdPrice, ostUsd: ostUsdPrice };
}

export async function quoteOstToSol(env, ostAmount) {
  const [solUsdPrice, ostUsdPrice] = [await fetchSolUsd(), ostUsd(env)];
  const grossSol = (Number(ostAmount) * ostUsdPrice) / solUsdPrice;
  const fee = grossSol * POOL_SWAP_FEE;
  return { sol: grossSol - fee, fee, solUsd: solUsdPrice, ostUsd: ostUsdPrice };
}

// -----------------------------------------------------------------------
// Authoritative vault config — deploy-time Wrangler vars, NOT client input.
// -----------------------------------------------------------------------
export function vaultConfig(env) {
  function num(name, fallback) {
    const v = Number(env && env[name]);
    return Number.isFinite(v) && v >= 0 ? v : fallback;
  }
  return {
    maxSinglePayout: num('OST_MAX_SINGLE_PAYOUT', 1000000000),
    minReserve: num('OST_VAULT_MIN_RESERVE', 0),
    maxPayoutFraction: num('OST_VAULT_MAX_PAYOUT_FRACTION', 0.02),
    lowWater: num('OST_VAULT_LOW_WATER', 1000000000)
  };
}

export function formatOstAmount(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '0';
  return number.toLocaleString(undefined, { maximumFractionDigits: number >= 100 ? 2 : 6 });
}

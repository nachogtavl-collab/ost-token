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
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID
} from '@solana/spl-token';
import bs58 from 'bs58';

export const OST_TOKEN_DECIMALS = 9;
const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
const SYSTEM_PROGRAM_STR = '11111111111111111111111111111111';
const TOKEN_PROGRAM_STRS = new Set([TOKEN_2022_PROGRAM_ID.toBase58(), 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA']);

// Solana's rent-exempt minimum for a plain (0-data) system account. A wallet
// that ends a transaction holding 1..890,879 lamports makes the WHOLE tx fail
// with InsufficientFundsForRent (RNT-1). Exactly 0 is allowed (the account closes).
export const RENT_EXEMPT_MIN_LAMPORTS = 890880;
// Rent the pool pays when it creates a Token-2022 associated token account
// (170 bytes with the ImmutableOwner extension): (170 + 128) * 6960 lamports.
// Used only to budget pool-sponsored account creation (SRV-8).
export const SPONSORED_ATA_LAMPORTS = 2074080;

// ── RPC endpoints (SRV-4) ─────────────────────────────────────────────────
// The server send/confirm list is ONLY the dedicated keys from env
// (SOLANA_DEVNET_RPC, _2, _3, _4 — Wrangler secrets). The hard-coded fallbacks
// this list used to carry were all dead from Cloudflare's egress (measured
// against the deployed worker in the 2026-10-06 money audit):
//   devnet.helius-rpc.com/?api-key=public  401 on every real method
//   solana-devnet.g.alchemy.com/v2/demo    429 on every call — and web3.js' default
//                                          429 retry (500+1000+2000+4000 ms) turned
//                                          it into a ~7.5 s stall inside EVERY
//                                          pool transaction's confirm loop
//   api.devnet.solana.com                  403 for Cloudflare's shared egress IPs
// LAST_RESORT_RPC is used ONLY when no key is configured at all (local
// `wrangler dev` from a residential IP, where api.devnet does answer).
const LAST_RESORT_RPC = ['https://api.devnet.solana.com'];
const RPC_ENDPOINTS = [];
const RPC_URL_RE = /^(https:\/\/|http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/)/i;

let rpcConfigured = false;
// Cheap and idempotent — called at the top of every Durable Object fetch and
// every exported entry point that receives env. env bindings don't vary per
// request, so this only does real work once per warm isolate.
export function ensureRpcConfigured(env) {
  if (rpcConfigured) return;
  const keys = [
    env && env.SOLANA_DEVNET_RPC, env && env.SOLANA_DEVNET_RPC_2,
    env && env.SOLANA_DEVNET_RPC_3, env && env.SOLANA_DEVNET_RPC_4
  ].map(u => (typeof u === 'string' ? u.trim() : '')).filter(u => RPC_URL_RE.test(u));
  const merged = [];
  (keys.length ? keys : LAST_RESORT_RPC).forEach(u => { if (!merged.includes(u)) merged.push(u); });
  RPC_ENDPOINTS.length = 0;
  Array.prototype.push.apply(RPC_ENDPOINTS, merged);
  rpcConfigured = true;
}
// The configured server list (index.js topup verification reuses it so there
// is one list, not two that drift).
export function rpcEndpointList() { return RPC_ENDPOINTS.slice(); }
// Unit tests only: forget the isolate-level RPC state.
export function __resetRpcForTests() {
  rpcConfigured = false; RPC_ENDPOINTS.length = 0; rpcIndex = 0;
  for (const k of Object.keys(rpcConnections)) delete rpcConnections[k];
  for (const k of Object.keys(cooldownUntil)) delete cooldownUntil[k];
  cachedPool = null;
}

let rpcIndex = 0;
const rpcConnections = {};
// Per-endpoint cooldown: an RPC that returns a rate-limit/quota error (or times
// out) is parked and SKIPPED during selection — so we never keep hammering an
// exhausted key. Healthy endpoints absorb the traffic while it recovers.
const cooldownUntil = {};
const COOLDOWN_MS = 20000;
const TIMEOUT_COOLDOWN_MS = 8000;
// Hard per-request timeout. A hung RPC must cost seconds, not the whole budget.
// (A healthy devnet RPC answers in well under 1 s.)
const RPC_TIMEOUT_MS = 6000;
// buildSignSend runs inside Durable Object locks (blockConcurrencyWhile, which
// itself RESETS the object after 30 s). No new RPC attempt starts past these
// budgets, so even with every endpoint hanging the locked section ends in
// about blockhash 9+6 s, send 18+6 s — well inside the platform limit.
const BLOCKHASH_BUDGET_MS = 9000;
const SEND_BUDGET_MS = 18000;
// How long a pool tx confirm waits before answering "sent, still confirming"
// (202 pending). Devnet confirms in ~0.5-1.5 s; the client's own abort is 20 s.
export const CONFIRM_BUDGET_MS = 12000;

function isRateLimit(e) {
  const m = String((e && (e.message || e)) || '');
  return /\b429\b|\b401\b|\b403\b|too many requests|rate.?limit|unauthorized|forbidden|invalid api key|quota|exceeded/i.test(m);
}
function isTimeoutish(e) {
  const m = String((e && (e.name + ' ' + (e.message || e))) || '');
  return /abort|timed? ?out|timeout|network|fetch failed|connection|ECONN|socket|reset/i.test(m);
}
function timeoutFetch(input, init) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => { try { ctrl.abort(); } catch (_) {} }, RPC_TIMEOUT_MS);
  return fetch(input, Object.assign({}, init || {}, { signal: ctrl.signal }))
    .finally(() => clearTimeout(timer));
}
function makeConn(url) {
  if (!rpcConnections[url]) {
    try {
      // disableRetryOnRateLimit: web3.js otherwise sleeps 0.5+1+2+4 s on a 429
      // before giving up — the SRV-4 stall. We rotate endpoints ourselves.
      rpcConnections[url] = new Connection(url, { commitment: 'confirmed', disableRetryOnRateLimit: true, fetch: timeoutFetch });
    } catch (_) { return null; }
  }
  return rpcConnections[url];
}
function notConfiguredError() {
  const e = new Error('rpc_not_configured: ensureRpcConfigured(env) must run before any Solana call');
  e.code = 'rpc_not_configured';
  return e;
}
// Healthy endpoints first (starting at the last-good index so load spreads),
// then any in cooldown ordered by soonest recovery as a last resort.
function candidateOrder() {
  const n = RPC_ENDPOINTS.length;
  const order = [];
  for (let k = 0; k < n; k++) order.push((rpcIndex + k) % n);
  const now = Date.now();
  const healthy = order.filter(i => !(cooldownUntil[RPC_ENDPOINTS[i]] > now));
  const cooling = order.filter(i => cooldownUntil[RPC_ENDPOINTS[i]] > now)
    .sort((a, b) => (cooldownUntil[RPC_ENDPOINTS[a]] || 0) - (cooldownUntil[RPC_ENDPOINTS[b]] || 0));
  return healthy.concat(cooling);
}
function noteFailure(url, e) {
  if (isRateLimit(e)) cooldownUntil[url] = Date.now() + COOLDOWN_MS;
  else if (isTimeoutish(e)) cooldownUntil[url] = Date.now() + TIMEOUT_COOLDOWN_MS;
}
// SRV-5: throws when the RPC list was never configured, instead of silently
// handing back a connection to a dead public endpoint (which made existing
// token accounts look missing on a cold isolate -> IllegalOwner creates).
export function getConnection() {
  if (!rpcConfigured || !RPC_ENDPOINTS.length) throw notConfiguredError();
  const order = candidateOrder();
  return makeConn(RPC_ENDPOINTS[order.length ? order[0] : 0]);
}
// opts.deadline (epoch ms): no NEW endpoint attempt starts after it.
export async function withRpc(label, fn, opts) {
  if (!rpcConfigured || !RPC_ENDPOINTS.length) throw notConfiguredError();
  const seq = candidateOrder();
  const deadline = Number(opts && opts.deadline) || 0;
  let lastErr = null;
  for (let attempt = 0; attempt < seq.length; attempt++) {
    if (attempt > 0 && deadline && Date.now() >= deadline) break;
    const i = seq[attempt];
    const url = RPC_ENDPOINTS[i];
    const conn = makeConn(url);
    if (!conn) continue;
    try {
      const res = await fn(conn);
      rpcIndex = i;                 // stick to the endpoint that just worked
      delete cooldownUntil[url];    // proven healthy — clear any cooldown
      return res;
    } catch (e) {
      lastErr = e;
      noteFailure(url, e);
      if (attempt < seq.length - 1) await new Promise(r => setTimeout(r, 60));
    }
  }
  throw lastErr || new Error(label + ' failed on every RPC');
}
// Raw JSON-RPC through the rotating list. A JSON-RPC *error object* is returned
// to the caller (it is an answer, not an endpoint failure); transport failures
// (429/timeout) rotate to the next endpoint.
export async function rpcCall(label, method, params) {
  return withRpc(label, async (conn) => {
    const res = await conn._rpcRequest(method, params);
    return res || {};
  });
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

// SRV-5: the IDEMPOTENT create (ATA program instruction 1). If the account
// already exists it is a no-op that succeeds, so a false "missing" answer from a
// lagging RPC can no longer fail the whole transaction with IllegalOwner.
export function ixCreateAta(payerPk, ataPk, ownerPk, mintPk) {
  return createAssociatedTokenAccountIdempotentInstruction(payerPk, ataPk, ownerPk, mintPk, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
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

// ComputeBudget instructions name no accounts (so assertPoolAbsent cannot see
// them) but they set the PRIORITY FEE the fee payer pays. For a pool-paid
// fee-only cosign the client may set at most a modest unit limit and price.
//   0 RequestUnits (deprecated)  refused
//   1 RequestHeapFrame           allowed (costs nothing extra)
//   2 SetComputeUnitLimit u32    <= maxUnitLimit
//   3 SetComputeUnitPrice u64    <= maxUnitPrice micro-lamports
//   4 SetLoadedAccountsDataSize  allowed
export const COMPUTE_BUDGET_PROGRAM_ID = 'ComputeBudget111111111111111111111111111111';
export function checkComputeBudget(instructions, limits = {}) {
  const maxLimit = Number(limits.maxUnitLimit) || 400000;
  const maxPrice = Number(limits.maxUnitPrice) || 10000;
  const seen = {};
  for (const ix of instructions) {
    if (ix.programId.toBase58() !== COMPUTE_BUDGET_PROGRAM_ID) continue;
    const d = Buffer.from(ix.data || []);
    const tag = d.length ? d[0] : -1;
    if (seen[tag]) return { ok: false, reason: 'compute_budget_duplicate', message: 'Repeated compute-budget instruction.' };
    seen[tag] = true;
    if (tag === 1 || tag === 4) continue;
    if (tag === 2) {
      if (d.length < 5) return { ok: false, reason: 'compute_budget_invalid', message: 'Malformed compute-unit limit.' };
      const units = d.readUInt32LE(1);
      if (units > maxLimit) return { ok: false, reason: 'compute_limit_too_high', message: 'Compute-unit limit ' + units + ' is above the ' + maxLimit + ' the OST fee payer allows.' };
      continue;
    }
    if (tag === 3) {
      if (d.length < 9) return { ok: false, reason: 'compute_budget_invalid', message: 'Malformed compute-unit price.' };
      const price = d.readBigUInt64LE(1);
      if (price > BigInt(maxPrice)) return { ok: false, reason: 'priority_fee_too_high', message: 'A priority fee of ' + price.toString() + ' micro-lamports per unit is above the ' + maxPrice + ' the OST fee payer allows.' };
      continue;
    }
    return { ok: false, reason: 'compute_budget_unsupported', message: 'That compute-budget instruction is not allowed when OST pays the fee.' };
  }
  return { ok: true };
}

// The fee a (partially) signed legacy Transaction will cost its fee payer:
// 5000 lamports per required signature + compute-unit price x limit.
export function estimateFeeLamports(tx) {
  let signers = 1;
  try { signers = tx.compileMessage().header.numRequiredSignatures; } catch (_) { signers = (tx.signatures || []).length || 1; }
  let price = 0n, limit = null, nonCb = 0;
  for (const ix of tx.instructions || []) {
    if (ix.programId.toBase58() !== COMPUTE_BUDGET_PROGRAM_ID) { nonCb++; continue; }
    const d = Buffer.from(ix.data || []);
    if (d[0] === 2 && d.length >= 5) limit = d.readUInt32LE(1);
    if (d[0] === 3 && d.length >= 9) price = d.readBigUInt64LE(1);
  }
  const units = BigInt(limit != null ? limit : Math.min(1400000, 200000 * Math.max(1, nonCb)));
  const priority = (price * units + 999999n) / 1000000n;
  return { signers, lamports: Number(BigInt(5000 * signers) + priority) };
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

// SRV-5: goes through the rotating RPC list (the `conn` argument is kept only
// for call-site compatibility and ignored). Returns false ONLY on a definite
// "no account" answer; if every endpoint fails it THROWS — callers must not
// read an unknown as "missing". (With the idempotent create, a caller that
// does treat unknown as missing is still safe: the create is a no-op.)
export async function ataExists(_conn, ata) {
  const addr = (ata && ata.toBase58) ? ata.toBase58() : String(ata);
  const res = await rpcCall('ata-exists', 'getAccountInfo', [addr, { encoding: 'base64', dataSlice: { offset: 0, length: 0 }, commitment: 'confirmed' }]);
  if (res.error) throw new Error('getAccountInfo failed: ' + String(res.error.message || '').slice(0, 160));
  return !!(res.result && res.result.value);
}

// Owner program / existence of an arbitrary address (one cheap RPC).
// -> { exists, owner, executable, lamports }. Throws if every endpoint fails.
export async function accountMeta(pubkey) {
  const addr = (pubkey && pubkey.toBase58) ? pubkey.toBase58() : String(pubkey);
  const res = await rpcCall('account-meta', 'getAccountInfo', [addr, { encoding: 'base64', dataSlice: { offset: 0, length: 0 }, commitment: 'confirmed' }]);
  if (res.error) throw new Error('getAccountInfo failed: ' + String(res.error.message || '').slice(0, 160));
  const v = res.result && res.result.value;
  return v ? { exists: true, owner: String(v.owner || ''), executable: !!v.executable, lamports: Number(v.lamports || 0) }
           : { exists: false, owner: '', executable: false, lamports: 0 };
}

// A token account's raw balance. -> { exists:false } for a definite "no account",
// { exists:true, raw:BigInt, mint, owner } otherwise. Throws if unknown.
export async function readTokenAccount(ata) {
  const addr = (ata && ata.toBase58) ? ata.toBase58() : String(ata);
  const res = await rpcCall('token-account', 'getAccountInfo', [addr, { encoding: 'jsonParsed', commitment: 'confirmed' }]);
  if (res.error) throw new Error('getAccountInfo failed: ' + String(res.error.message || '').slice(0, 160));
  const v = res.result && res.result.value;
  if (!v) return { exists: false, raw: 0n };
  const info = v.data && v.data.parsed && v.data.parsed.info;
  const amount = info && info.tokenAmount && info.tokenAmount.amount;
  return { exists: true, raw: BigInt(amount || '0'), mint: info ? String(info.mint || '') : '', owner: info ? String(info.owner || '') : '', program: String(v.owner || '') };
}

export async function getLamports(pubkey) {
  const pk = pubkey instanceof PublicKey ? pubkey : new PublicKey(String(pubkey));
  return withRpc('lamports', conn => conn.getBalance(pk, 'confirmed'));
}

// -----------------------------------------------------------------------
// Errors that a money handler must tell apart (contract C4):
//   preBroadcast === true   nothing was sent; safe to refuse with a 4xx
//   OnChainFailureError     the tx landed but failed: nothing moved
//   ConfirmTimeoutError     sent, not yet confirmed: answer 202 {pending, sig}
// -----------------------------------------------------------------------
export class BlockhashExpiredError extends Error {
  constructor(message) { super(message); this.name = 'BlockhashExpiredError'; this.code = 'blockhash_expired'; this.preBroadcast = true; }
}
export class SimulationFailedError extends Error {
  constructor(decoded) {
    super((decoded && decoded.message) || 'The network rejected this transaction before it was sent.');
    this.name = 'SimulationFailedError';
    this.code = 'simulation_failed';
    this.reason = (decoded && decoded.code) || 'simulation_failed';
    this.txErr = decoded ? decoded.err : null;
    this.logs = decoded ? decoded.logs : [];
    this.asset = decoded ? decoded.asset : undefined;
    this.preBroadcast = true;
  }
}
export class OnChainFailureError extends Error {
  constructor(sig, txErr, decoded) {
    super('On-chain failure: ' + JSON.stringify(txErr));
    this.name = 'OnChainFailureError';
    this.code = 'tx_failed';
    this.reason = (decoded && decoded.code) || 'tx_failed';
    this.humanMessage = decoded && decoded.message;
    this.sig = sig;
    this.txErr = txErr;
  }
}
export class ConfirmTimeoutError extends Error {
  constructor(sig, label, lastStatus) {
    super((label || 'Transaction') + ' was sent but is not confirmed yet (' + (lastStatus ? 'last status=' + (lastStatus.confirmationStatus || 'unknown') : 'no status yet') + ')');
    this.name = 'ConfirmTimeoutError';
    this.code = 'confirm_timeout';
    this.sig = sig;
    this.lastStatus = lastStatus || null;
  }
}

function programFromLogs(logs) {
  const list = Array.isArray(logs) ? logs : [];
  for (let i = list.length - 1; i >= 0; i--) {
    const m = String(list[i]).match(/^Program (\w{32,44}) failed/);
    if (m) return m[1];
  }
  return '';
}

// Turn a Solana TransactionError (+ logs) into a plain-English, contract-C3 code.
// programIds[i] is the program of instruction i when the caller knows it.
export function decodeTxError(err, logs, programIds, asset) {
  const tokenName = asset || 'OST';
  const L = (Array.isArray(logs) ? logs : []).join('\n');
  const base = { err: err || null, logs: (Array.isArray(logs) ? logs : []).slice(-8), asset: tokenName };
  if (!err) return Object.assign(base, { code: 'simulation_failed', message: 'The network rejected this transaction.' });
  if (err === 'BlockhashNotFound') return Object.assign(base, { code: 'blockhash_expired', message: 'This quote expired before it was sent. Please try again.' });
  if (err === 'AlreadyProcessed') return Object.assign(base, { code: 'already_processed', message: 'This transaction was already processed.' });
  // AccountNotFound at the transaction level = the fee payer (the OST pool) has
  // no SOL account at all: the same outage as InsufficientFundsForFee.
  if (err === 'InsufficientFundsForFee' || err === 'AccountNotFound') return Object.assign(base, { code: 'insufficient_pool_sol', message: 'The OST fee payer is out of devnet SOL right now. Nothing was sent — try again later.' });
  if (typeof err === 'object' && err.InsufficientFundsForRent) {
    return Object.assign(base, { code: 'below_rent_minimum', message: 'Solana requires at least 0.00089 SOL to stay in a wallet. Send or keep a bit more, or empty the wallet completely.' });
  }
  if (typeof err === 'object' && Array.isArray(err.InstructionError)) {
    const idx = Number(err.InstructionError[0]);
    const ie = err.InstructionError[1];
    const prog = (Array.isArray(programIds) && programIds[idx]) || programFromLogs(logs);
    const custom = (ie && typeof ie === 'object' && 'Custom' in ie) ? Number(ie.Custom) : null;
    const isToken = TOKEN_PROGRAM_STRS.has(prog) || /Program log: Error: insufficient funds/i.test(L);
    const isSystem = prog === SYSTEM_PROGRAM_STR;
    if (isSystem && custom === 1) return Object.assign(base, { code: 'insufficient_balance', asset: 'SOL', message: 'Not enough SOL in this wallet for that amount.' });
    if (/Transfer: insufficient lamports/i.test(L)) return Object.assign(base, { code: 'insufficient_balance', asset: 'SOL', message: 'Not enough SOL in this wallet for that amount.' });
    if (isToken && custom === 1) return Object.assign(base, { code: 'insufficient_balance', message: 'Not enough ' + tokenName + ' in this wallet for that amount.' });
    if (isToken && (custom === 9 || ie === 'IncorrectProgramId' || ie === 'UninitializedAccount' || ie === 'InvalidAccountData')) {
      return Object.assign(base, { code: 'no_token_account', message: 'This wallet has no ' + tokenName + ' yet.' });
    }
    if (isToken && custom === 4) return Object.assign(base, { code: 'owner_mismatch', message: 'That token account does not belong to this wallet.' });
    if (isToken && custom === 3) return Object.assign(base, { code: 'mint_mismatch', message: 'That token account holds a different token.' });
    return Object.assign(base, { code: 'simulation_failed', message: 'The network rejected this transaction (instruction ' + idx + ': ' + JSON.stringify(ie) + ').' });
  }
  return Object.assign(base, { code: 'simulation_failed', message: 'The network rejected this transaction (' + JSON.stringify(err).slice(0, 120) + ').' });
}

// Simulate a (possibly partially-signed) transaction without verifying
// signatures. -> { ok:true } | { ok:false, code, message, err, logs } |
// { ok:null } when no RPC could answer (the caller must not block on that).
export async function simulateTx(tx, ctx = {}) {
  const b64 = Buffer.from(tx.serialize({ requireAllSignatures: false, verifySignatures: false })).toString('base64');
  const programIds = tx.instructions.map(ix => ix.programId.toBase58());
  let res;
  try {
    res = await rpcCall('simulate', 'simulateTransaction', [b64, { encoding: 'base64', sigVerify: false, replaceRecentBlockhash: false, commitment: 'confirmed' }]);
  } catch (_) { return { ok: null }; }
  if (res.error) return { ok: null, rpcError: String(res.error.message || '').slice(0, 160) };
  const v = res.result && res.result.value;
  if (!v) return { ok: null };
  if (!v.err) return { ok: true, unitsConsumed: v.unitsConsumed };
  // A lagging RPC that has not seen the blockhash yet is not a verdict on the tx.
  if (v.err === 'BlockhashNotFound') return { ok: null };
  return Object.assign({ ok: false }, decodeTxError(v.err, v.logs, programIds, ctx.asset));
}

export function signatureOf(tx) {
  const s = tx && tx.signatures && tx.signatures[0] && tx.signatures[0].signature;
  if (!s) return '';
  return bs58.encode(Uint8Array.from(s));
}

// -----------------------------------------------------------------------
// Broadcast an ALREADY-SIGNED transaction (never builds or signs anything).
//   returns { sig, uncertain:false }    an RPC node accepted it
//   returns { sig, uncertain:true }     some attempt timed out / lost the
//                                       connection: it MAY have been forwarded,
//                                       so the caller must confirm by sig
//   throws  error.preBroadcast === true preflight/RPC refused it: nothing sent
// Re-sending identical signed bytes to a second endpoint is safe: the network
// dedupes by signature. Once any attempt was uncertain, a later preflight
// failure is NOT treated as definitive (the first copy may already have landed
// and changed the balances the second simulation saw).
// -----------------------------------------------------------------------
export async function sendSerialized(serialized, sig, ctx = {}) {
  if (!rpcConfigured || !RPC_ENDPOINTS.length) throw notConfiguredError();
  const b64 = Buffer.from(serialized).toString('base64');
  const order = candidateOrder().slice(0, 3);
  const deadline = Number(ctx.deadline) || 0;
  let uncertain = false;
  let lastErr = null;
  for (let n = 0; n < order.length; n++) {
    if (n > 0 && deadline && Date.now() >= deadline) break;
    const i = order[n];
    const url = RPC_ENDPOINTS[i];
    const conn = makeConn(url);
    if (!conn) continue;
    let skipPreflight = !!ctx.skipPreflight;
    for (let pass = 0; pass < 2; pass++) {
      let res;
      try {
        res = await conn._rpcRequest('sendTransaction', [b64, { encoding: 'base64', skipPreflight, preflightCommitment: 'confirmed', maxRetries: 5 }]);
      } catch (e) {
        lastErr = e;
        noteFailure(url, e);
        if (!isRateLimit(e)) uncertain = true;   // timeout / reset: may have gone out
        break;                                    // next endpoint
      }
      if (res && res.error) {
        const msg = String(res.error.message || '');
        const data = res.error.data || {};
        if (data.err === 'AlreadyProcessed' || /already been processed/i.test(msg)) {
          rpcIndex = i; return { sig, uncertain: false, endpoint: url, alreadyProcessed: true };
        }
        // "No record of a prior credit" from a LAGGING node is retried without
        // preflight — but if the fee payer really holds no SOL the tx can never
        // land, so check first and refuse instead of broadcasting a doomed tx.
        if (!skipPreflight && !uncertain && ctx.feePayer && /no record of a prior credit/i.test(msg)) {
          let lamports = null;
          try { lamports = await withRpc('fee-payer-balance', c => c.getBalance(ctx.feePayer, 'confirmed')); } catch (_) {}
          if (lamports === 0) throw new SimulationFailedError(decodeTxError('InsufficientFundsForFee', data.logs, ctx.programIds, ctx.asset));
        }
        // A lagging RPC has not seen the blockhash / fee payer yet: let the
        // leader decide (the ONLY skipPreflight fallback left — SRV-6).
        if (!skipPreflight && (data.err === 'BlockhashNotFound' || /blockhash not found|no record of a prior credit/i.test(msg))) { skipPreflight = true; continue; }
        if (uncertain) return { sig, uncertain: true };
        if (/block height exceeded|blockhash not found/i.test(msg)) throw new BlockhashExpiredError((ctx.label || 'Transaction') + ': blockhash expired before send, please retry');
        if (data.err || /simulation failed/i.test(msg)) {
          throw new SimulationFailedError(decodeTxError(data.err || null, data.logs, ctx.programIds, ctx.asset));
        }
        const e = new Error('The RPC refused this transaction: ' + msg.slice(0, 200));
        e.code = 'rpc_refused'; e.preBroadcast = true;
        throw e;
      }
      rpcIndex = i;
      delete cooldownUntil[url];
      return { sig: (res && res.result) || sig, uncertain: false, endpoint: url };
    }
  }
  if (uncertain) return { sig, uncertain: true };
  const e = new Error('Every Solana RPC refused the transaction (' + String((lastErr && lastErr.message) || 'unavailable').slice(0, 160) + ') — nothing was sent.');
  e.code = 'rpc_unavailable'; e.preBroadcast = true;
  throw e;
}

// One status read, raced across up to two healthy endpoints (Promise.any): the
// first endpoint that ANSWERS wins, a slow or throttled one is not waited for.
async function statusRace(sig, searchHistory) {
  const urls = candidateOrder().slice(0, 2).map(i => RPC_ENDPOINTS[i]);
  if (!urls.length) throw notConfiguredError();
  const attempts = urls.map(url => {
    const conn = makeConn(url);
    if (!conn) return Promise.reject(new Error('no connection'));
    return conn.getSignatureStatuses([sig], { searchTransactionHistory: !!searchHistory })
      .then(r => { delete cooldownUntil[url]; return { entry: (r && r.value && r.value[0]) || null }; })
      .catch(e => { noteFailure(url, e); throw e; });
  });
  return (await Promise.any(attempts)).entry;
}

async function blockHeightNow() {
  return withRpc('block-height', conn => conn.getBlockHeight('confirmed'));
}

function stateFromEntry(entry) {
  if (entry.err) return { state: 'failed', seen: true, err: entry.err, confirmationStatus: entry.confirmationStatus || null };
  if (entry.confirmationStatus === 'confirmed' || entry.confirmationStatus === 'finalized') return { state: 'confirmed', seen: true, confirmationStatus: entry.confirmationStatus };
  return { state: 'pending', seen: true, confirmationStatus: entry.confirmationStatus || 'processed' };
}

// Where is this signature? Never throws.
//   { state: 'confirmed' | 'failed' | 'pending' | 'expired' | 'unknown', err? }
// 'expired' = not found AND the blockhash it was built on can no longer land:
// definitive proof the tx never executed, which AUTHORISES A NEW TRANSACTION
// (a fresh payout, a refund). So it is only ever answered after proveExpired.
export async function checkSignature(sig, blockhashInfo) {
  if (!sig) return { state: 'unknown' };
  let entry;
  try { entry = await statusRace(sig, true); }
  catch (_) { return { state: 'unknown' }; }
  if (entry) return stateFromEntry(entry);
  // Not seen by the fastest node.
  const lvbh = Number(blockhashInfo && blockhashInfo.lastValidBlockHeight);
  if (!(lvbh > 0)) return { state: 'pending', seen: false };
  let height;
  try { height = await blockHeightNow(); } catch (_) { return { state: 'unknown', seen: false }; }
  if (!(height > lvbh)) return { state: 'pending', seen: false, blocksLeft: lvbh - height };
  return proveExpired(sig, lvbh);
}

// "Expired" must be proven, not raced (review: Promise.any took the first
// endpoint's null — a lagging or history-less node — as proof, and a landed
// payout was paid a second time). EVERY configured endpoint must answer, each
// must report a block height past lastValidBlockHeight, and each must say it has
// no status for the signature with searchTransactionHistory. Any endpoint that
// knows the tx wins; any endpoint that cannot answer makes it 'unknown'. A
// getTransaction lookup on every endpoint is a last extra check.
async function proveExpired(sig, lvbh) {
  const urls = RPC_ENDPOINTS.slice();
  if (!urls.length) return { state: 'unknown', seen: false };
  const per = await Promise.allSettled(urls.map(async (url) => {
    const conn = makeConn(url);
    if (!conn) throw new Error('no connection');
    try {
      const [st, h] = await Promise.all([
        conn._rpcRequest('getSignatureStatuses', [[sig], { searchTransactionHistory: true }]),
        conn._rpcRequest('getBlockHeight', [{ commitment: 'confirmed' }])
      ]);
      if (!st || st.error || !st.result || !Array.isArray(st.result.value)) throw new Error('status unavailable: ' + String((st && st.error && st.error.message) || '').slice(0, 80));
      const height = Number(h && h.result);
      if (!h || h.error || !(height > 0)) throw new Error('block height unavailable');
      return { url, entry: st.result.value[0] || null, height };
    } catch (e) { noteFailure(url, e); throw e; }
  }));
  for (const p of per) {
    if (p.status === 'fulfilled' && p.value.entry) return stateFromEntry(p.value.entry);
  }
  const txs = await Promise.allSettled(urls.map(async (url) => {
    const conn = makeConn(url);
    if (!conn) return null;
    const r = await conn._rpcRequest('getTransaction', [sig, { encoding: 'json', commitment: 'confirmed', maxSupportedTransactionVersion: 0 }]);
    return (r && !r.error && r.result) ? r.result : null;
  }));
  for (const t of txs) {
    if (t.status === 'fulfilled' && t.value) {
      const err = t.value.meta && t.value.meta.err;
      return err ? { state: 'failed', seen: true, err } : { state: 'confirmed', seen: true, confirmationStatus: 'confirmed' };
    }
  }
  const answered = per.filter(p => p.status === 'fulfilled').map(p => p.value);
  if (answered.length === urls.length && answered.every(a => a.height > lvbh)) return { state: 'expired', seen: false };
  // Some endpoint is behind (it could still land there) or did not answer.
  return { state: answered.length === urls.length ? 'pending' : 'unknown', seen: false };
}

// Legacy reconcile: records written by the OLD code as 'building' were broadcast
// before the signature was saved, so the only trace is the on-chain memo
// ("payoutId:<id> ..."). Scan the pool's history back to `fromMs` for it.
//   { found:true, sig, err }       the memo is on chain
//   { found:false, complete:true } scanned past fromMs: it never landed
//   { found:false, complete:false, cursor } ran out of pages: still unknown;
//                                  pass `cursor` back as startBefore to resume
export async function findPoolTxByMemo(env, needle, fromMs, maxPages = 4, startBefore) {
  const pool = getPoolKeypair(env);
  let before = startBefore || undefined;
  for (let page = 0; page < maxPages; page++) {
    const opts = { limit: 1000 };
    if (before) opts.before = before;
    const list = await withRpc('pool-sigs', conn => conn.getSignaturesForAddress(pool.publicKey, opts, 'confirmed'));
    if (!list || !list.length) return { found: false, complete: true };
    for (const s of list) {
      if (s && s.memo && String(s.memo).indexOf(needle) >= 0) return { found: true, sig: s.signature, err: s.err || null, blockTime: s.blockTime || null };
    }
    const oldest = list[list.length - 1];
    if (oldest.blockTime && oldest.blockTime * 1000 < fromMs) return { found: false, complete: true };
    if (list.length < 1000) return { found: false, complete: true };
    if (oldest.signature === before) return { found: false, complete: false, cursor: before };   // node ignored `before`
    before = oldest.signature;
  }
  return { found: false, complete: false, cursor: before || null };
}

// `labelOrOpts` is the legacy label string, or { label, timeoutMs }.
export async function confirmSignature(sig, blockhashInfo, labelOrOpts) {
  // Deliberately skips @solana/web3.js's Connection.confirmTransaction() —
  // without a WebSocket subscription (which this runtime doesn't give it),
  // it falls back to slow internal long-polling that was observed to hang
  // for 45-60s+ against a live deployment even though the RPC endpoint
  // itself responds in well under a second. Goes straight to the manual
  // getSignatureStatuses polling loop below, which was built for exactly
  // this reason and is what actually gets used regardless.
  //
  // SRV-4: each poll RACES the two healthiest endpoints (Promise.any) instead
  // of walking every endpoint in sequence (which used to include the 429-ing
  // Alchemy demo key and its 7.5 s of built-in retries). Cooled-down endpoints
  // are skipped. Resolves with sig on 'confirmed'; throws OnChainFailureError
  // if the tx landed with an error; throws ConfirmTimeoutError (carrying the
  // sig) after the budget — the caller answers 202 pending, never "failed".
  const opts = (labelOrOpts && typeof labelOrOpts === 'object') ? labelOrOpts : null;
  const timeoutMs = Number(opts && opts.timeoutMs) || CONFIRM_BUDGET_MS;
  const name = opts ? (opts.label || 'Transaction') : (labelOrOpts || 'Transaction');
  const deadline = Date.now() + timeoutMs;
  let lastStatus = null;
  for (let attempt = 0; ; attempt++) {
    let entry = null;
    try { entry = await statusRace(sig, attempt >= 6); } catch (_) { entry = null; }
    if (entry) {
      lastStatus = entry;
      if (entry.err) throw new OnChainFailureError(sig, entry.err, decodeTxError(entry.err, null, null));
      if (entry.confirmationStatus === 'confirmed' || entry.confirmationStatus === 'finalized') return sig;
    }
    if (Date.now() >= deadline) break;
    // A pool tx usually reaches 'confirmed' in well under a second — poll TIGHT
    // first, then back off. (Still requires a real confirmation; this only
    // shortens detection latency, it never returns before the tx lands.)
    const wait = attempt < 4 ? 250 : Math.min(1200, 300 + attempt * 100);
    await new Promise(r => setTimeout(r, Math.max(0, Math.min(wait, deadline - Date.now()))));
  }
  throw new ConfirmTimeoutError(sig, name, lastStatus);
}

// Builds a fresh Transaction with the given instructions, pool as fee payer,
// a live blockhash, signs with `signers` (pool always included), and sends
// (does NOT confirm — see confirmSignature). Splitting send from confirm lets
// callers persist the signature durably the instant broadcast succeeds, so a
// crash between broadcast and confirmation can be recovered by polling the
// known signature instead of building and sending a second transaction.
// Throws BlockhashExpiredError if the blockhash goes stale before send —
// callers should surface that as "quote expired, please retry".
//
// SRV-2: the signature is KNOWN before broadcast (the pool is the fee payer, so
// tx.signatures[0] is the pool's own signature = the txid). opts.onSigned(sig,
// blockhashInfo) is awaited BEFORE anything is sent, so a caller can durably
// record "sending <sig>"; if that write throws, nothing was broadcast.
// Errors with .preBroadcast === true mean nothing left this worker. A broadcast
// whose outcome is unknown (timeout mid-send) does NOT throw: it returns
// { uncertain: true } and the caller confirms by sig.
export async function buildSignSend(env, instructions, extraSigners, label, opts = {}) {
  const pool = getPoolKeypair(env);
  const tx = new Transaction();
  instructions.forEach(ix => { if (ix) tx.add(ix); });
  tx.feePayer = pool.publicKey;
  const t0 = Date.now();
  let bh;
  try { bh = await withRpc('blockhash', conn => conn.getLatestBlockhash('confirmed'), { deadline: t0 + BLOCKHASH_BUDGET_MS }); }
  catch (e) {
    const err = new Error('Could not reach Solana to build the transaction (' + String((e && e.message) || e).slice(0, 120) + ') — nothing was sent.');
    err.code = 'rpc_unavailable'; err.preBroadcast = true;
    throw err;
  }
  tx.recentBlockhash = bh.blockhash;
  tx.lastValidBlockHeight = bh.lastValidBlockHeight;
  tx.sign(pool, ...(extraSigners || []));
  const sig = signatureOf(tx);
  const blockhashInfo = { blockhash: bh.blockhash, lastValidBlockHeight: bh.lastValidBlockHeight };
  const serialized = tx.serialize();
  if (typeof opts.onSigned === 'function') {
    // Third arg: the exact signed bytes (base64). Re-broadcasting identical
    // bytes is always safe (same signature) — a resume can use it.
    try { await opts.onSigned(sig, blockhashInfo, Buffer.from(serialized).toString('base64')); }
    catch (e) { if (e && typeof e === 'object') e.preBroadcast = true; throw e; }
  }
  const sent = await sendSerialized(serialized, sig, {
    label, asset: opts.asset, deadline: t0 + SEND_BUDGET_MS, feePayer: pool.publicKey,
    programIds: tx.instructions.map(ix => ix.programId.toBase58())
  });
  return { sig, blockhashInfo, uncertain: !!sent.uncertain };
}

export async function buildSignSendConfirm(env, instructions, extraSigners, label, opts = {}) {
  const { sig, blockhashInfo } = await buildSignSend(env, instructions, extraSigners, label, opts);
  await confirmSignature(sig, blockhashInfo, { label, timeoutMs: opts.timeoutMs });
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
  const tx = new Transaction();
  instructions.forEach(ix => { if (ix) tx.add(ix); });
  tx.feePayer = pool.publicKey;
  const bh = await withRpc('blockhash', conn => conn.getLatestBlockhash('confirmed'));
  tx.recentBlockhash = bh.blockhash;
  tx.lastValidBlockHeight = bh.lastValidBlockHeight;
  tx.partialSign(pool);
  // The pool is the fee payer, so its signature is signatures[0] = the txid the
  // user's fully-signed copy will land under. Known now, before the user signs.
  return { tx, blockhashInfo: { blockhash: bh.blockhash, lastValidBlockHeight: bh.lastValidBlockHeight }, sig: signatureOf(tx) };
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
  const sig = signatureOf(tx);
  await sendSerialized(tx.serialize(), sig, { label, programIds: tx.instructions.map(ix => ix.programId.toBase58()) });
  await confirmSignature(sig, blockhashInfo, { label });
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
  // REFUSE, never fabricate: a made-up $150 used to price real pool swaps.
  const e = new Error('sol_price_unavailable: no price feed answered — swap quotes are paused until one does');
  e.code = 'sol_price_unavailable';
  throw e;
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

/* ==========================================================================
   OST /wallet/payout · /wallet/ata-rent · /wallet/cosign(/submit)
   ----------------------------------------------------------------------------
   Server-side replacement for docs/devnet-rescue.js's browser-side pool
   signing (Phase 0 — project-docs/TOKEN-ARCHITECTURE.md). The PayoutGate
   Durable Object is the single authoritative checker of solvency/reserve/
   cap limits and payout idempotency — client-side copies of these checks
   are UX hints only and are never trusted here.

   Every transaction is built ENTIRELY by this module (see solana-pool.js's
   header comment) from validated scalars, never from client-supplied
   instructions — EXCEPT kind:'fee-only' (see solana-pool.js assertPoolAbsent
   for why that one case is safe). /wallet/cosign is a two-step flow because
   the user still has to add their own signature for their leg:
     1. POST /wallet/cosign        → worker builds + partial-signs, returns
                                      the still-incomplete tx for the user's
                                      wallet to sign.
     2. POST /wallet/cosign/submit → client posts back the now fully-signed
                                      tx; worker submits + confirms it.
   ========================================================================== */
import { PublicKey } from '@solana/web3.js';
import * as Pool from './solana-pool.js';

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'content-type'
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: Object.assign({ 'content-type': 'application/json' }, CORS_HEADERS) });
}

function cleanText(value, max = 200) {
  return String(value == null ? '' : value).slice(0, max);
}
function cleanNumber(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
function isValidPubkey(text) {
  try { new PublicKey(String(text || '')); return true; }
  catch (_) { return false; }
}
function stableHash(text) {
  let hash = 2166136261;
  const s = String(text || '');
  for (let i = 0; i < s.length; i++) { hash ^= s.charCodeAt(i); hash = Math.imul(hash, 16777619); }
  return ('00000000' + (hash >>> 0).toString(16)).slice(-8);
}
function cleanId(value, prefix) {
  const text = String(value || '').replace(/[^a-z0-9_.:-]/gi, '-').slice(0, 72);
  return text || (prefix + '-' + Date.now().toString(36) + '-' + stableHash(Math.random()));
}

export class PayoutGate {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  // NOTE: unlike FaucetGate, this DO does real network I/O (Solana RPC calls
  // that can take 10s+ to confirm, especially across the multi-endpoint poll
  // in solana-pool.js). Wrapping the ENTIRE request in blockConcurrencyWhile
  // (the FaucetGate pattern) blocks every other request to this DO for that
  // whole duration and can itself hit Miniflare/CF's blockConcurrencyWhile
  // timeout (observed directly while testing this). Each handler below locks
  // only the short state-mutating section (check + solvency decision + send)
  // via this.state.blockConcurrencyWhile, then confirms OUTSIDE the lock.
  async fetch(request) {
    return this.handle(request);
  }

  async rateLimited(wallet, limit, windowMs) {
    const key = 'rate:' + wallet;
    const now = Date.now();
    const rec = (await this.state.storage.get(key)) || { windowStart: now, count: 0 };
    if (now - rec.windowStart > windowMs) { rec.windowStart = now; rec.count = 0; }
    rec.count += 1;
    await this.state.storage.put(key, rec);
    return rec.count > limit;
  }

  async handle(request) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, '') || '/';
    const method = request.method;
    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });

    try {
      if (path === '/wallet/payout' && method === 'POST') return await this.handlePayout(request);
      if (path === '/wallet/ata-rent' && method === 'POST') return await this.handleAtaRent(request);
      if (path === '/wallet/cosign' && method === 'POST') return await this.handleCosignBuild(request);
      if (path === '/wallet/cosign/submit' && method === 'POST') return await this.handleCosignSubmit(request);
    } catch (err) {
      if (err && err.code === 'blockhash_expired') return json({ error: 'blockhash_expired', message: err.message }, 409);
      return json({ error: 'internal_error', message: String((err && err.message) || err).slice(0, 300) }, 500);
    }
    return json({ error: 'unknown_wallet_endpoint', path }, 404);
  }

  // -----------------------------------------------------------------------
  // POST /wallet/payout  { wallet, amountOst, memo, payoutId }
  // Pool → user transferChecked. Worker builds the entire tx alone.
  // -----------------------------------------------------------------------
  async handlePayout(request) {
    let body; try { body = await request.json(); } catch (_) { return json({ error: 'invalid_json' }, 400); }
    const walletStr = cleanText(body && body.wallet, 64);
    const amt = cleanNumber(body && body.amountOst, null);
    const memo = cleanText(body && body.memo, 200);
    if (!isValidPubkey(walletStr)) return json({ error: 'invalid_wallet' }, 400);
    if (!(amt > 0)) return json({ error: 'invalid_amount' }, 400);
    const payoutId = cleanId(body && body.payoutId, 'pay') || cleanId('pay-' + stableHash([walletStr, amt.toFixed(9), memo].join('|')), 'pay');

    // Locked section: idempotency check, solvency decision, build + BROADCAST
    // (a single fast RPC call), and durably persisting the resulting
    // signature. Kept short on purpose — see the note on fetch() above.
    // Confirmation (slow, can take 10s+ of multi-endpoint polling) happens
    // AFTER this returns, unlocked, so it never blocks other requests.
    const outcome = await this.state.blockConcurrencyWhile(async () => {
      const existing = await this.state.storage.get('payout:' + payoutId);
      if (existing && existing.status === 'confirmed' && existing.wallet === walletStr && Math.abs(existing.ost - amt) < 1e-9) {
        return { done: true, response: json({ ok: true, sig: existing.sig, ost: existing.ost, idempotent: true }) };
      }
      if (existing && existing.status === 'sent' && existing.sig) {
        // Crash/retry between broadcast and confirmation — recover by
        // confirming the signature we already have, not sending again.
        return { done: false, resume: existing };
      }
      if (existing && existing.status === 'building') {
        // We were mid-send when this record was last written and never got
        // to persist a signature. We cannot tell whether buildSignSend's
        // broadcast actually landed on-chain before whatever interrupted us
        // (observed directly during Phase 0 testing: a Miniflare
        // blockConcurrencyWhile timeout killed the request AFTER a real
        // devnet broadcast succeeded but BEFORE the 'sent' write — a retry
        // that just rebuilt and resent paid out twice). Blindly retrying
        // here is unsafe in exactly the same way; this needs a human to
        // check the pool's recent transaction history for a payoutId-tagged
        // memo before deciding whether to resend.
        return { done: true, response: json({ error: 'payout_unknown_state', message: 'A previous attempt for this payout did not finish cleanly and may or may not have landed on-chain. Support must reconcile before retrying — do not resend automatically.', payoutId }, 409) };
      }

      const cfg = Pool.vaultConfig(this.env);
      if (cfg.maxSinglePayout > 0 && amt > cfg.maxSinglePayout) {
        return { done: true, response: json({ error: 'cap_exceeded', message: 'Payout ' + Pool.formatOstAmount(amt) + ' OST exceeds the vault limit of ' + Pool.formatOstAmount(cfg.maxSinglePayout) + ' OST.' }, 409) };
      }
      const poolBal = await Pool.getPoolOstBalance(this.env);
      if (poolBal + 1e-9 < amt) {
        return { done: true, response: json({ error: 'insufficient_pool', message: 'OST payout vault needs refill before paying ' + Pool.formatOstAmount(amt) + ' OST.' }, 409) };
      }
      if (cfg.maxPayoutFraction > 0 && cfg.maxPayoutFraction < 1) {
        const dynamicCap = poolBal * cfg.maxPayoutFraction;
        if (amt > dynamicCap) {
          return { done: true, response: json({ error: 'solvency_cap', message: 'This payout of ' + Pool.formatOstAmount(amt) + ' OST exceeds the live vault solvency cap of ' + Pool.formatOstAmount(dynamicCap) + ' OST.' }, 409) };
        }
      }
      if (cfg.minReserve > 0 && poolBal - amt < cfg.minReserve) {
        return { done: true, response: json({ error: 'reserve_protected', message: 'OST payout vault is protecting its shared reserve.' }, 409) };
      }

      const conn = Pool.getConnection();
      const owner = new PublicKey(walletStr);
      const mint = Pool.getMint(this.env);
      const pool = Pool.getPoolKeypair(this.env);
      const fromAta = Pool.poolAta(this.env);
      const toAta = Pool.userAta(this.env, owner);

      const instructions = [];
      if (!(await Pool.ataExists(conn, toAta))) {
        instructions.push(Pool.ixCreateAta(pool.publicKey, toAta, owner, mint));
      }
      const rawAmount = Pool.decimalToRawAmount(amt, Pool.OST_TOKEN_DECIMALS);
      instructions.push(Pool.ixTransferChecked(fromAta, mint, toAta, pool.publicKey, rawAmount, Pool.OST_TOKEN_DECIMALS));
      // payoutId always goes on-chain in the memo (prefixed, ahead of any
      // caller-supplied memo text) so a stuck 'building' record above can
      // actually be reconciled by searching the pool's recent signatures for
      // this id, instead of reconciliation being purely aspirational.
      instructions.push(Pool.ixMemo('payoutId:' + payoutId + (memo ? ' ' + memo : ''), pool.publicKey));

      // In-flight record BEFORE broadcasting — a crash/eviction after send
      // but before this write is what turns a retry into a double-pay.
      await this.state.storage.put('payout:' + payoutId, { status: 'building', wallet: walletStr, ost: amt, memo, createdAt: Date.now() });

      let sent;
      try {
        sent = await Pool.buildSignSend(this.env, instructions, [], 'OST payout');
      } catch (e) {
        await this.state.storage.put('payout:' + payoutId, { status: 'failed', wallet: walletStr, ost: amt, memo, error: String(e && e.message || e).slice(0, 300), createdAt: Date.now() });
        throw e;
      }
      const record = { status: 'sent', wallet: walletStr, ost: amt, memo, sig: sent.sig, blockhashInfo: sent.blockhashInfo, createdAt: Date.now() };
      await this.state.storage.put('payout:' + payoutId, record);
      return { done: false, resume: record };
    });

    if (outcome.done) return outcome.response;

    // Unlocked: poll for confirmation. Other requests to this DO (including
    // a retry of THIS payoutId) can proceed while this waits.
    const rec = outcome.resume;
    try {
      await Pool.confirmSignature(rec.sig, rec.blockhashInfo, 'OST payout');
    } catch (e) {
      return json({ error: 'payout_unconfirmed', message: String(e && e.message || e).slice(0, 300), sig: rec.sig }, 409);
    }
    await this.state.blockConcurrencyWhile(async () => {
      await this.state.storage.put('payout:' + payoutId, Object.assign({}, rec, { status: 'confirmed' }));
    });
    return json({ ok: true, sig: rec.sig, ost: rec.ost, auditId: payoutId });
  }

  // -----------------------------------------------------------------------
  // POST /wallet/ata-rent  { owner }
  // Pool-paid ATA creation only. Naturally idempotent (creating an existing
  // ATA just fails harmlessly on-chain), so no in-flight bookkeeping needed.
  // -----------------------------------------------------------------------
  async handleAtaRent(request) {
    let body; try { body = await request.json(); } catch (_) { return json({ error: 'invalid_json' }, 400); }
    const ownerStr = cleanText(body && body.owner, 64);
    if (!isValidPubkey(ownerStr)) return json({ error: 'invalid_owner' }, 400);
    const owner = new PublicKey(ownerStr);
    const conn = Pool.getConnection();
    const mint = Pool.getMint(this.env);
    const ata = Pool.userAta(this.env, owner);
    if (await Pool.ataExists(conn, ata)) return json({ ok: true, created: false, ata: ata.toBase58() });
    const pool = Pool.getPoolKeypair(this.env);
    const sig = await Pool.buildSignSendConfirm(this.env, [Pool.ixCreateAta(pool.publicKey, ata, owner, mint)], [], 'ATA rent');
    return json({ ok: true, created: true, ata: ata.toBase58(), sig });
  }

  // -----------------------------------------------------------------------
  // POST /wallet/cosign  { kind, wallet, amount, memo }
  // kind: 'sol-to-ost' | 'ost-to-sol' | 'peer-transfer'
  // -----------------------------------------------------------------------
  async handleCosignBuild(request) {
    let body; try { body = await request.json(); } catch (_) { return json({ error: 'invalid_json' }, 400); }
    const kind = cleanText(body && body.kind, 32);
    const walletStr = cleanText(body && body.wallet, 64);
    const amt = cleanNumber(body && body.amount, null);
    const memo = cleanText(body && body.memo, 200);
    const toStr = cleanText(body && body.to, 64);
    if (!isValidPubkey(walletStr)) return json({ error: 'invalid_wallet' }, 400);
    if (kind !== 'fee-only' && !(amt > 0)) return json({ error: 'invalid_amount' }, 400);
    if (await this.rateLimited(walletStr, 30, 10 * 60 * 1000)) return json({ error: 'rate_limited' }, 429);

    const conn = Pool.getConnection();
    const owner = new PublicKey(walletStr);
    const mint = Pool.getMint(this.env);
    const pool = Pool.getPoolKeypair(this.env);
    const poolAta = Pool.poolAta(this.env);
    const ownerAta = Pool.userAta(this.env, owner);

    let instructions = [];
    let quote = null;

    if (kind === 'fee-only') {
      const rawList = Array.isArray(body && body.instructions) ? body.instructions : null;
      if (!rawList || !rawList.length || rawList.length > 10) return json({ error: 'invalid_instructions' }, 400);
      try {
        instructions = rawList.map(Pool.ixFromJson);
        Pool.assertPoolAbsent(instructions, pool.publicKey);
      } catch (e) {
        return json({ error: 'invalid_instructions', message: String(e && e.message || e).slice(0, 200) }, 400);
      }
      quote = null;
    } else if (kind === 'sol-to-ost') {
      const q = await Pool.quoteSolToOst(this.env, amt);
      if (!(q.ost > 0)) return json({ error: 'quote_too_small' }, 400);
      const cfg = Pool.vaultConfig(this.env);
      const poolBal = await Pool.getPoolOstBalance(this.env);
      const dynamicCap = cfg.maxPayoutFraction > 0 ? poolBal * cfg.maxPayoutFraction : Infinity;
      if (q.ost > dynamicCap || (cfg.maxSinglePayout > 0 && q.ost > cfg.maxSinglePayout)) return json({ error: 'solvency_cap' }, 409);
      if (poolBal + 1e-9 < q.ost) return json({ error: 'insufficient_pool' }, 409);
      quote = { solAmount: amt, ostAmount: q.ost, fee: q.fee, rate: q.solUsd / q.ostUsd, solUsd: q.solUsd, ostUsd: q.ostUsd };
      if (!(await Pool.ataExists(conn, ownerAta))) instructions.push(Pool.ixCreateAta(pool.publicKey, ownerAta, owner, mint));
      instructions.push(Pool.ixSolTransfer(owner, pool.publicKey, Math.round(amt * 1e9)));
      instructions.push(Pool.ixTransferChecked(poolAta, mint, ownerAta, pool.publicKey, Pool.decimalToRawAmount(q.ost, Pool.OST_TOKEN_DECIMALS), Pool.OST_TOKEN_DECIMALS));
      if (memo) instructions.push(Pool.ixMemo(memo, owner));
    } else if (kind === 'ost-to-sol') {
      const q = await Pool.quoteOstToSol(this.env, amt);
      if (!(q.sol > 0)) return json({ error: 'quote_too_small' }, 400);
      const poolSol = await Pool.getPoolSolBalance(this.env);
      const solReserve = 0.05; // keep enough SOL to keep paying fees
      if (poolSol - q.sol < solReserve) return json({ error: 'insufficient_pool_sol' }, 409);
      quote = { ostAmount: amt, solAmount: q.sol, fee: q.fee, rate: q.solUsd / q.ostUsd, solUsd: q.solUsd, ostUsd: q.ostUsd };
      instructions.push(Pool.ixTransferChecked(ownerAta, mint, poolAta, owner, Pool.decimalToRawAmount(amt, Pool.OST_TOKEN_DECIMALS), Pool.OST_TOKEN_DECIMALS));
      instructions.push(Pool.ixSolTransfer(pool.publicKey, owner, Math.round(q.sol * 1e9)));
      if (memo) instructions.push(Pool.ixMemo(memo, owner));
    } else if (kind === 'peer-transfer') {
      if (!isValidPubkey(toStr)) return json({ error: 'invalid_destination' }, 400);
      const dest = new PublicKey(toStr);
      const destAta = Pool.userAta(this.env, dest);
      quote = { ostAmount: amt };
      if (!(await Pool.ataExists(conn, destAta))) instructions.push(Pool.ixCreateAta(pool.publicKey, destAta, dest, mint));
      instructions.push(Pool.ixTransferChecked(ownerAta, mint, destAta, owner, Pool.decimalToRawAmount(amt, Pool.OST_TOKEN_DECIMALS), Pool.OST_TOKEN_DECIMALS));
      if (memo) instructions.push(Pool.ixMemo(memo, owner));
    } else {
      return json({ error: 'unknown_kind' }, 400);
    }

    const { tx, blockhashInfo } = await Pool.buildAndPartialSignByPool(this.env, instructions);
    const cosignId = cleanId(crypto.randomUUID(), 'cosign');
    const record = {
      kind, wallet: walletStr, quote,
      blockhash: blockhashInfo.blockhash,
      lastValidBlockHeight: blockhashInfo.lastValidBlockHeight,
      createdAt: Date.now(),
      status: 'built'
    };
    await this.state.storage.put('cosign:' + cosignId, record);
    return json({ ok: true, cosignId, kind, quote, txBase64: Pool.txToBase64(tx), blockhash: blockhashInfo.blockhash, lastValidBlockHeight: blockhashInfo.lastValidBlockHeight });
  }

  // -----------------------------------------------------------------------
  // POST /wallet/cosign/submit  { cosignId, signedTxBase64 }
  // -----------------------------------------------------------------------
  async handleCosignSubmit(request) {
    let body; try { body = await request.json(); } catch (_) { return json({ error: 'invalid_json' }, 400); }
    const cosignId = cleanText(body && body.cosignId, 80);
    const signedTxBase64 = cleanText(body && body.signedTxBase64, 4000);
    if (!cosignId || !signedTxBase64) return json({ error: 'missing_fields' }, 400);

    const record = await this.state.storage.get('cosign:' + cosignId);
    if (!record) return json({ error: 'cosign_not_found' }, 404);
    if (record.status === 'confirmed' && record.sig) return json({ ok: true, sig: record.sig, idempotent: true });
    if (record.status === 'sent' && record.sig) {
      try {
        await Pool.confirmSignature(record.sig, { blockhash: record.blockhash, lastValidBlockHeight: record.lastValidBlockHeight }, 'Cosigned swap');
        record.status = 'confirmed';
        await this.state.storage.put('cosign:' + cosignId, record);
        return json({ ok: true, sig: record.sig, idempotent: true });
      } catch (e) {
        return json({ error: 'submit_unconfirmed', message: String(e && e.message || e).slice(0, 300), sig: record.sig }, 409);
      }
    }

    let tx;
    try { tx = Pool.txFromBase64(signedTxBase64); }
    catch (_) { return json({ error: 'invalid_transaction' }, 400); }
    if (tx.recentBlockhash !== record.blockhash) {
      return json({ error: 'blockhash_expired', message: 'This quote is stale, request a new one.' }, 409);
    }

    let sig;
    try {
      sig = await Pool.sendSignedAndConfirm(tx, { blockhash: record.blockhash, lastValidBlockHeight: record.lastValidBlockHeight }, 'Cosigned swap');
    } catch (e) {
      if (e && e.code === 'blockhash_expired') return json({ error: 'blockhash_expired', message: e.message }, 409);
      return json({ error: 'submit_failed', message: String(e && e.message || e).slice(0, 300) }, 502);
    }
    record.status = 'confirmed';
    record.sig = sig;
    await this.state.storage.put('cosign:' + cosignId, record);
    return json({ ok: true, sig });
  }
}

export function walletPayoutsDoId(env) {
  return env.PAYOUT_GATE.idFromName('global');
}

export function handleWalletPayoutsRequest(request, env) {
  if (!env.PAYOUT_GATE) return json({ error: 'payout_gate_not_configured' }, 503);
  const id = walletPayoutsDoId(env);
  return env.PAYOUT_GATE.get(id).fetch(request);
}

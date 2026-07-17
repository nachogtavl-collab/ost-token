/* ==========================================================================
   OST Devnet Rescue v3 — Server-signed, pool-paid UX
   ----------------------------------------------------------------------------
   Phase 0 (project-docs/TOKEN-ARCHITECTURE.md): the pool keypair used to be
   shipped to every browser (docs/swap-pool.js .secretKey) and signed payouts
   client-side. It never signs anything here anymore — every payout, ATA
   rental, and atomic swap is built and signed by the Cloudflare Worker
   (workers/ost-api/src/wallet-payouts.js), which is the only place that ever
   holds the key now. This file's job is now: call the worker, handle the
   "user still has to add their own signature" step for swaps, and keep the
   exact same window.OST_RESCUE API so callers didn't need to change.
   ========================================================================== */
(function () {
  'use strict';

  if (typeof solanaWeb3 === 'undefined') return;

  var PAYOUT_RECEIPTS_KEY = 'ost.payout.receipts.v1';
  var PAYOUT_PENDING_KEY = 'ost.payout.pending.v1';
  var payoutLocks = {};

  function readStorageJson(key, fallback) {
    try {
      var parsed = JSON.parse(localStorage.getItem(key) || 'null');
      return parsed == null ? fallback : parsed;
    } catch (_) { return fallback; }
  }
  function writeStorageJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) {}
  }
  function stableHash(value) {
    var text = String(value || '');
    var hash = 2166136261;
    for (var index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return ('00000000' + (hash >>> 0).toString(16)).slice(-8);
  }
  function cleanPayoutId(value) {
    var text = String(value || '').replace(/[^a-z0-9_.:-]/gi, '-').slice(0, 72);
    return text || ('payout-' + Date.now().toString(36));
  }
  function payoutRefFromMemo(memoText) {
    var raw = String(memoText || '');
    try {
      var parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        return [
          parsed.k || parsed.kind || '',
          parsed.intent || parsed.reservation || parsed.id || parsed.market || parsed.payment || '',
          parsed.game || parsed.token || parsed.cur || '',
          parsed.side || parsed.role || ''
        ].join('|');
      }
    } catch (_) {}
    return raw.slice(0, 180);
  }
  function buildPayoutId(wallet, amount, memoText, options) {
    if (options && options.idempotencyKey) return cleanPayoutId(options.idempotencyKey);
    var ref = payoutRefFromMemo(memoText);
    return cleanPayoutId('pay-' + stableHash([wallet, Number(amount || 0).toFixed(9), ref].join('|')));
  }
  function getPayoutReceipt(id, wallet, amount) {
    var receipts = readStorageJson(PAYOUT_RECEIPTS_KEY, {});
    var receipt = receipts && receipts[id];
    if (!receipt || !receipt.sig) return null;
    if (receipt.verified !== true) return null;
    if (receipt.wallet && wallet && receipt.wallet !== wallet) return null;
    if (Math.abs(Number(receipt.ost || 0) - Number(amount || 0)) > 0.000000001) return null;
    return receipt;
  }
  function rememberPayoutReceipt(id, receipt) {
    var receipts = readStorageJson(PAYOUT_RECEIPTS_KEY, {});
    receipts[id] = Object.assign({ at: Date.now() }, receipt || {});
    var keys = Object.keys(receipts).sort(function (a, b) { return Number(receipts[b].at || 0) - Number(receipts[a].at || 0); });
    if (keys.length > 200) keys.slice(200).forEach(function (key) { delete receipts[key]; });
    writeStorageJson(PAYOUT_RECEIPTS_KEY, receipts);
  }
  function rememberPendingPayout(id, payload) {
    var pending = readStorageJson(PAYOUT_PENDING_KEY, {});
    pending[id] = Object.assign({ id: id, at: Date.now() }, payload || {});
    writeStorageJson(PAYOUT_PENDING_KEY, pending);
  }
  function clearPendingPayout(id) {
    var pending = readStorageJson(PAYOUT_PENDING_KEY, {});
    if (pending && pending[id]) { delete pending[id]; writeStorageJson(PAYOUT_PENDING_KEY, pending); }
  }
  function pendingPayouts() { return readStorageJson(PAYOUT_PENDING_KEY, {}); }

  // -----------------------------------------------------------------------
  // Multi-RPC connection — still needed client-side for read-only balance
  // checks and ATA existence caching. No signing happens over these.
  // -----------------------------------------------------------------------
  var RPC_ENDPOINTS = [
    'https://api.devnet.solana.com',
    'https://devnet.helius-rpc.com/?api-key=public',
    'https://rpc.ankr.com/solana_devnet'
  ];
  var rpcIndex = 0;
  var rpcConnections = {};
  function makeConn(url) {
    if (!rpcConnections[url]) { try { rpcConnections[url] = new solanaWeb3.Connection(url, 'confirmed'); } catch (e) { return null; } }
    return rpcConnections[url];
  }
  function getRpc() { return makeConn(RPC_ENDPOINTS[rpcIndex % RPC_ENDPOINTS.length]); }
  function rotateRpc() { rpcIndex = (rpcIndex + 1) % RPC_ENDPOINTS.length; return getRpc(); }
  async function withRpc(label, fn) {
    var lastErr = null;
    for (var attempt = 0; attempt < RPC_ENDPOINTS.length * 2; attempt++) {
      var conn = getRpc();
      try { return await fn(conn); }
      catch (e) { lastErr = e; rotateRpc(); await new Promise(function (r) { setTimeout(r, 250 * (attempt + 1)); }); }
    }
    throw lastErr || new Error(label + ' failed on every RPC');
  }

  async function getPoolOstBalance() {
    if (!window.OST_SWAP_POOL) return 0;
    return withRpc('pool-ost', async function (conn) {
      var ata = new solanaWeb3.PublicKey(window.OST_SWAP_POOL.ata);
      var bal = await conn.getTokenAccountBalance(ata);
      return Number(bal && bal.value && bal.value.uiAmount || 0);
    }).catch(function () { return 0; });
  }
  async function getPoolSolBalance() {
    if (!window.OST_SWAP_POOL) return 0;
    return withRpc('pool-sol', async function (conn) {
      var pk = new solanaWeb3.PublicKey(window.OST_SWAP_POOL.publicKey);
      var lam = await conn.getBalance(pk);
      return lam / solanaWeb3.LAMPORTS_PER_SOL;
    }).catch(function () { return 0; });
  }

  // Client-side copies of the vault knobs are DISPLAY HINTS only now — the
  // worker (workers/ost-api/src/solana-pool.js vaultConfig()) re-checks
  // every cap/reserve/solvency rule itself from its own deploy-time config
  // and never trusts anything the client sends or reads from window.*.
  function numberSetting(name, fallback) {
    var value = Number(window[name]);
    return Number.isFinite(value) && value >= 0 ? value : fallback;
  }
  function vaultConfig() {
    return {
      minReserve: numberSetting('OST_VAULT_MIN_RESERVE', 0),
      lowWater: numberSetting('OST_VAULT_LOW_WATER', 1000000000),
      targetReserve: numberSetting('OST_VAULT_TARGET_RESERVE', 10000000000),
      maxSinglePayout: numberSetting('OST_MAX_SINGLE_PAYOUT', 1000000000)
    };
  }

  function ostApiBaseSafe() {
    try { return (window.OST_API_BASE || '').replace(/\/+$/, ''); } catch (_) { return ''; }
  }

  async function apiPost(path, body) {
    var base = ostApiBaseSafe();
    if (!base) throw new Error('OST API not configured');
    var res, resJson;
    try {
      res = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      resJson = await res.json();
    } catch (_) {
      var err = new Error('Could not reach the OST payout service. Try again shortly.');
      err.code = 'network_error';
      throw err;
    }
    if (!res.ok || !resJson.ok) {
      var apiErr = new Error(resJson && (resJson.message || resJson.error) || ('Request failed (' + res.status + ')'));
      apiErr.code = resJson && resJson.error;
      apiErr.body = resJson;
      throw apiErr;
    }
    return resJson;
  }

  function logPayoutAudit(payload) {
    try {
      var base = ostApiBaseSafe();
      if (!base) return;
      var body = JSON.stringify(payload);
      if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
        try { navigator.sendBeacon(base + '/wallet/payouts', new Blob([body], { type: 'application/json' })); return; } catch (_) {}
      }
      fetch(base + '/wallet/payouts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: body, keepalive: true }).catch(function () {});
    } catch (_) {}
  }

  // -----------------------------------------------------------------------
  // PAYOUT OST (pool → user) — was a local sign+send, now one worker call.
  // -----------------------------------------------------------------------
  async function payoutOst(toPubkeyInput, amountOst, memoText, options) {
    var to = (toPubkeyInput && toPubkeyInput.toBase58) ? toPubkeyInput : new solanaWeb3.PublicKey(toPubkeyInput);
    var walletStr = to.toBase58();
    var amt = Number(amountOst);
    if (!Number.isFinite(amt) || amt <= 0) throw new Error('Invalid payout amount');
    var memoSummary = String(memoText || '').slice(0, 200);
    var payoutId = buildPayoutId(walletStr, amt, memoText, options || {});

    var prior = getPayoutReceipt(payoutId, walletStr, amt);
    if (prior) return { sig: prior.sig, ost: Number(prior.ost || amt), auditId: payoutId, idempotent: true };
    if (payoutLocks[payoutId]) return payoutLocks[payoutId];

    payoutLocks[payoutId] = (async function () {
      logPayoutAudit({ id: payoutId, stage: 'intent', wallet: walletStr, kind: 'payout', ostAmount: amt, memo: memoSummary, ref: payoutRefFromMemo(memoText) });
      try {
        var resJson = await apiPost('/wallet/payout', { wallet: walletStr, amountOst: amt, memo: memoText ? String(memoText) : '', payoutId: payoutId });
        clearPendingPayout(payoutId);
        rememberPayoutReceipt(payoutId, { wallet: walletStr, ost: resJson.ost || amt, sig: resJson.sig, memo: memoSummary, ref: payoutRefFromMemo(memoText), verified: true });
        logPayoutAudit({ id: payoutId, stage: 'result', wallet: walletStr, kind: 'payout', ostAmount: amt, memo: memoSummary, sig: resJson.sig, ref: payoutRefFromMemo(memoText) });
        return { sig: resJson.sig, ost: resJson.ost || amt, auditId: payoutId };
      } catch (err) {
        var message = (err && err.message) || 'Payout failed';
        rememberPendingPayout(payoutId, { wallet: walletStr, ostAmount: amt, memo: memoSummary, error: message.slice(0, 240), stage: (err && err.code) || 'send-failed' });
        logPayoutAudit({ id: payoutId, stage: 'failure', wallet: walletStr, kind: 'payout', ostAmount: amt, memo: memoSummary, error: message.slice(0, 240), ref: payoutRefFromMemo(memoText) });
        throw err;
      }
    })();

    try { return await payoutLocks[payoutId]; }
    finally { delete payoutLocks[payoutId]; }
  }

  // -----------------------------------------------------------------------
  // POOL-PAID USER OST ATA CREATION — same one-RPC-ever memoization, now the
  // creation itself (when needed) is a single worker call instead of a local
  // sign+send.
  // -----------------------------------------------------------------------
  var ATA_EXISTS_POOL = Object.create(null);
  function localUserAta(userPubkey) {
    var w = window.OST_WALLET; if (!w) return null;
    var c = w.constants;
    var owner = (userPubkey && userPubkey.toBase58) ? userPubkey : new solanaWeb3.PublicKey(userPubkey);
    var mintPk = new solanaWeb3.PublicKey(window.OST_SWAP_POOL.mint);
    return w.associatedAddress(mintPk, owner, false, c.TOKEN_2022_PROGRAM_ID);
  }
  async function ensureUserOstAtaPoolPaid(userPubkey) {
    var owner = (userPubkey && userPubkey.toBase58) ? userPubkey : new solanaWeb3.PublicKey(userPubkey);
    var ownerKey = owner.toBase58();
    if (ATA_EXISTS_POOL[ownerKey]) return localUserAta(owner);
    var resJson = await apiPost('/wallet/ata-rent', { owner: ownerKey });
    ATA_EXISTS_POOL[ownerKey] = true;
    return new solanaWeb3.PublicKey(resJson.ata);
  }

  // Pool-paid ATA creation for ANY sponsored mint (OST or OSTG). The bridge uses
  // this so a seedless user with zero SOL can hold the game token — the pool pays
  // the rent, exactly as it does for OST. The worker allowlists the mint.
  var ATA_EXISTS_MINT = {};
  async function ensureUserAtaForMint(userPubkey, mint) {
    var owner = (userPubkey && userPubkey.toBase58) ? userPubkey : new solanaWeb3.PublicKey(userPubkey);
    var ownerKey = owner.toBase58();
    var mintKey = (mint && mint.toBase58) ? mint.toBase58() : String(mint);
    var cacheKey = ownerKey + ':' + mintKey;
    if (ATA_EXISTS_MINT[cacheKey]) return;
    var resJson = await apiPost('/wallet/ata-rent', { owner: ownerKey, mint: mintKey });
    ATA_EXISTS_MINT[cacheKey] = true;
    return resJson && resJson.ata ? new solanaWeb3.PublicKey(resJson.ata) : null;
  }

  // -----------------------------------------------------------------------
  // COSIGN SWAP — the two-step atomic-swap flow. Worker builds + partial-
  // signs the whole transaction from validated scalars (see
  // workers/ost-api/src/wallet-payouts.js); this only adds the user's own
  // signature and hands the fully-signed tx back for the worker to submit.
  // Used for SOL<->OST swaps and any peer-to-peer OST send.
  // -----------------------------------------------------------------------
  function base64ToUint8(base64) {
    var binary = atob(base64);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
  function uint8ToBase64(bytes) {
    var binary = '';
    for (var i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }

  async function cosignSwap(kind, params) {
    var w = window.OST_WALLET;
    if (!w || !w.session || !w.session.publicKey) throw new Error('Connect a wallet first');
    var body = Object.assign({ kind: kind, wallet: w.session.publicKey.toBase58() }, params);
    var built = await apiPost('/wallet/cosign', body);

    var tx = solanaWeb3.Transaction.from(base64ToUint8(built.txBase64));
    var session = w.session;
    if (session.kind === 'local' && session.keypair) {
      tx.partialSign(session.keypair);
    } else if (session.provider && typeof session.provider.signTransaction === 'function') {
      tx = await session.provider.signTransaction(tx);
    } else if (session.provider && typeof session.provider.signAndSendTransaction === 'function') {
      // This provider signs AND submits in one call — it never hands the
      // signed bytes back, so there's nothing to post to /cosign/submit.
      // The transaction already carries the pool's earlier signature (still
      // present since the message wasn't modified), so it still lands as a
      // proper cosigned swap; we just skip our own submit/confirm step.
      var res = await session.provider.signAndSendTransaction(tx);
      var providerSig = typeof res === 'string' ? res : (res && res.signature);
      if (!providerSig) throw new Error('Wallet did not return a signature');
      return { sig: providerSig, quote: built.quote };
    } else {
      throw new Error('Wallet cannot sign transactions');
    }
    var signedTxBase64 = uint8ToBase64(tx.serialize({ requireAllSignatures: false, verifySignatures: false }));

    try {
      var submitted = await apiPost('/wallet/cosign/submit', { cosignId: built.cosignId, signedTxBase64: signedTxBase64 });
      return { sig: submitted.sig, quote: built.quote };
    } catch (err) {
      if (err && err.code === 'blockhash_expired') err.message = 'This quote expired before it could be submitted — please try again.';
      throw err;
    }
  }

  async function userSendsOstToPool(amountOst, memoText) {
    var amt = Number(amountOst);
    if (!Number.isFinite(amt) || amt <= 0) throw new Error('Enter a valid OST amount');
    var result = await cosignSwap('peer-transfer', { to: window.OST_SWAP_POOL.publicKey, amount: amt, memo: memoText ? String(memoText) : '' });
    return { sig: result.sig, ost: amt };
  }

  async function sendPeerOst(toAddress, amountOst, memoText) {
    var amt = Number(amountOst);
    if (!Number.isFinite(amt) || amt <= 0) throw new Error('Enter a valid OST amount.');
    var result = await cosignSwap('peer-transfer', { to: String(toAddress), amount: amt, memo: memoText ? String(memoText) : '' });
    return result.sig;
  }

  // Pool pays the fee only — used for arbitrary program instructions the
  // worker has no business understanding (e.g. the ost-betting program's
  // stake/claim_payout calls in docs/ost-onchain-market.js). The worker's
  // ONLY safety check for this kind is that the pool is referenced nowhere
  // inside the instructions (see solana-pool.js assertPoolAbsent) — it never
  // moves pool funds or acts as any instruction's authority, only pays the
  // transaction fee, so what the instructions actually do is not this
  // module's concern.
  async function sendPoolFeeOnly(instructions) {
    var list = (instructions || []).filter(Boolean).map(function (ix) {
      return {
        programId: ix.programId.toBase58(),
        keys: ix.keys.map(function (k) { return { pubkey: k.pubkey.toBase58(), isSigner: !!k.isSigner, isWritable: !!k.isWritable }; }),
        data: uint8ToBase64(ix.data instanceof Uint8Array ? ix.data : new Uint8Array(ix.data || []))
      };
    });
    var result = await cosignSwap('fee-only', { instructions: list });
    return result.sig;
  }

  // -----------------------------------------------------------------------
  // MEMECOIN BUY / SELL
  // -----------------------------------------------------------------------
  async function memecoinBuy(token, ostAmount) {
    return userSendsOstToPool(ostAmount,
      JSON.stringify({ k: 'memecoin-buy', token: String(token || ''), ost: Number(ostAmount), t: Date.now() })
    ).then(function (r) { return Object.assign({ side: 'buy', token: token }, r); });
  }
  async function memecoinSell(token, ostAmount) {
    var w = window.OST_WALLET;
    if (!w || !w.session || !w.session.publicKey) throw new Error('Connect a wallet first');
    return payoutOst(w.session.publicKey, ostAmount,
      JSON.stringify({ k: 'memecoin-sell', token: String(token || ''), ost: Number(ostAmount), t: Date.now() })
    ).then(function (r) { return Object.assign({ side: 'sell', token: token }, r); });
  }

  // -----------------------------------------------------------------------
  // PREDICTION CASH-OUT
  // -----------------------------------------------------------------------
  async function predictionCashOut(orderRecord, payoutAmount) {
    var w = window.OST_WALLET;
    if (!w || !w.session || !w.session.publicKey) throw new Error('Connect a wallet first');
    var orderId = orderRecord && (orderRecord.signature || orderRecord.sig || orderRecord.remoteId || orderRecord.id || '');
    return payoutOst(w.session.publicKey, payoutAmount,
      JSON.stringify({
        k: orderRecord && orderRecord.cashoutKind === 'prediction-sell' ? 'prediction-sell' : 'prediction-settlement',
        id: orderId,
        market: orderRecord && orderRecord.marketId,
        side: orderRecord && orderRecord.side,
        stake: orderRecord && Number(orderRecord.stake || 0),
        payout: Number(payoutAmount),
        t: Date.now()
      }),
      { idempotencyKey: 'prediction-cashout:' + (orderId || stableHash(JSON.stringify(orderRecord || {}))) + ':' + Number(payoutAmount || 0).toFixed(9) }
    );
  }

  // -----------------------------------------------------------------------
  // PATCH OST_WALLET.ensureFee → no-op (pool pays)
  // -----------------------------------------------------------------------
  function patchEnsureFee() {
    var w = window.OST_WALLET;
    if (!w || w.__rescuePatched) return;
    w.__rescuePatched = true;
    var origEnsure = w.ensureFee;
    w.ensureFee = async function (pubkeyInput) {
      try {
        var pk = (pubkeyInput && pubkeyInput.toBase58) ? pubkeyInput : new solanaWeb3.PublicKey(pubkeyInput);
        var conn = getRpc();
        var lam = await conn.getBalance(pk).catch(function () { return 0; });
        return { funded: false, balance: lam / solanaWeb3.LAMPORTS_PER_SOL, source: 'pool-paid' };
      } catch (e) {
        return { funded: false, balance: 0, source: 'pool-paid' };
      }
    };
    w.ensureFeeOriginal = origEnsure;
  }

  // -----------------------------------------------------------------------
  // PUBLIC API — same shape callers already use, bodies now worker-backed.
  // -----------------------------------------------------------------------
  window.OST_RESCUE = {
    rpc: { get: getRpc, rotate: rotateRpc, endpoints: RPC_ENDPOINTS, withRpc: withRpc },
    poolBalance: getPoolOstBalance,
    poolSolBalance: getPoolSolBalance,
    pendingPayouts: pendingPayouts,
    vaultConfig: vaultConfig,
    ensureUserAta: ensureUserOstAtaPoolPaid,
    ensureUserAtaForMint: ensureUserAtaForMint,
    payoutOst: payoutOst,
    userSendsOstToPool: userSendsOstToPool,
    sendPeerOst: sendPeerOst,
    sendPoolFeeOnly: sendPoolFeeOnly,
    cosignSwap: cosignSwap
  };
  window.OST_TRADE = window.OST_TRADE || {};
  window.OST_TRADE.memecoinBuy = memecoinBuy;
  window.OST_TRADE.memecoinSell = memecoinSell;
  window.OST_TRADE.predictionCashOut = predictionCashOut;
  window.OST_TRADE.payoutOst = payoutOst;

  function bootstrap() {
    if (!window.OST_WALLET) { return setTimeout(bootstrap, 250); }
    patchEnsureFee();
    console.log('[rescue v3] server-signed pool-paid OST flows active.');
    Promise.all([getPoolOstBalance(), getPoolSolBalance()]).then(function (r) {
      var cfg = vaultConfig();
      console.log('[rescue v3] pool: ' + r[0].toLocaleString() + ' OST · ' + r[1].toFixed(3) + ' SOL');
      if (r[0] < cfg.lowWater) console.warn('[rescue v3] POOL LOW — admin must run: npm run vault:refill');
    }).catch(function () {});
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }
})();

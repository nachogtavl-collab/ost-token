/* ==========================================================================
   OST Devnet Rescue v2 — Pool-paid, OST-native UX
   ----------------------------------------------------------------------------
   Architecture:
     • The OST swap pool keypair (devnet only) is pre-funded with 100M OST and
       5 SOL by scripts/init-swap-pool.ts. That gives us a virtually infinite
       reserve INSIDE the OST ecosystem — no per-user SOL faucet calls needed.
     • The pool is the SOL FEE PAYER for every user-facing flow (cash-out,
       sell, ATA creation, etc.) so the user never needs devnet SOL.
     • Multi-RPC fallback so a single Solana endpoint outage doesn't kill us.
   ========================================================================== */
(function () {
  'use strict';

  if (typeof solanaWeb3 === 'undefined') return;

  // -----------------------------------------------------------------------
  // 1) MULTI-RPC CONNECTION
  // -----------------------------------------------------------------------
  var DEFAULT_RPC_ENDPOINTS = [
    'https://api.devnet.solana.com'
  ];
  var RPC_ENDPOINTS = (Array.isArray(window.OST_RPC_ENDPOINTS) && window.OST_RPC_ENDPOINTS.length)
    ? window.OST_RPC_ENDPOINTS.slice()
    : DEFAULT_RPC_ENDPOINTS.slice();
  RPC_ENDPOINTS = RPC_ENDPOINTS.filter(function (endpoint) {
    return typeof endpoint === 'string' && endpoint &&
      endpoint.indexOf('api-key=public') === -1 &&
      endpoint.indexOf('rpc.ankr.com/solana_devnet') === -1 &&
      endpoint.indexOf('devnet.genesysgo.net') === -1;
  });
  if (!RPC_ENDPOINTS.length) RPC_ENDPOINTS = DEFAULT_RPC_ENDPOINTS.slice();
  var rpcIndex = 0;
  var rpcConnections = {};
  var PAYOUT_RECEIPTS_KEY = 'ost.payout.receipts.v1';
  var PAYOUT_PENDING_KEY = 'ost.payout.pending.v1';
  var payoutLocks = {};

  function numberSetting(name, fallback) {
    var value = Number(window[name]);
    return Number.isFinite(value) && value >= 0 ? value : fallback;
  }

  function fastLane() { try { return window.OST_SOLANA_FAST || null; } catch (_) { return null; } }
  function fastSendOptions(extra) {
    var fast = fastLane();
    if (fast && typeof fast.sendOptions === 'function') return fast.sendOptions(extra || {});
    return Object.assign({ skipPreflight: true, preflightCommitment: 'processed', maxRetries: 3 }, extra || {});
  }
  function applyFastLane(tx) {
    var fast = fastLane();
    if (fast && typeof fast.applyPriorityFees === 'function') fast.applyPriorityFees(tx);
    return tx;
  }
  async function fastBlockhash(conn) {
    var fast = fastLane();
    if (fast && typeof fast.getLatestBlockhash === 'function') return fast.getLatestBlockhash(conn);
    return conn.getLatestBlockhash('processed');
  }
  async function fastConfirm(conn, signature, latest) {
    var fast = fastLane();
    if (fast && typeof fast.confirm === 'function') return fast.confirm(conn, signature, latest);
    return conn.confirmTransaction(latest && latest.blockhash ? {
      signature: signature,
      blockhash: latest.blockhash,
      lastValidBlockHeight: latest.lastValidBlockHeight
    } : signature, 'processed');
  }

  function waitForWalletApproval(promise, label) {
    var timeoutMs = Math.max(15000, numberSetting('OST_WALLET_PROMPT_TIMEOUT_MS', 90000));
    var timeoutId = null;
    var timedOut = false;
    var timer = new Promise(function (_, reject) {
      timeoutId = setTimeout(function () {
        timedOut = true;
        reject(new Error((label || 'Wallet approval') + ' timed out. Reopen the wallet prompt and try again; no OST was recorded locally.'));
      }, timeoutMs);
    });
    return Promise.race([Promise.resolve(promise), timer]).then(function (value) {
      if (timeoutId && !timedOut) clearTimeout(timeoutId);
      return value;
    }, function (error) {
      if (timeoutId && !timedOut) clearTimeout(timeoutId);
      throw error;
    });
  }

  function withRescueTimeout(promise, timeoutMs, message) {
    var timeoutId = null;
    var timedOut = false;
    var timer = new Promise(function (_, reject) {
      timeoutId = setTimeout(function () {
        timedOut = true;
        reject(new Error(message || 'OST request timed out'));
      }, timeoutMs || 10000);
    });
    return Promise.race([Promise.resolve(promise), timer]).then(function (value) {
      if (timeoutId && !timedOut) clearTimeout(timeoutId);
      return value;
    }, function (error) {
      if (timeoutId && !timedOut) clearTimeout(timeoutId);
      throw error;
    });
  }

  function walletAddressString(pubkeyInput) {
    try {
      if (pubkeyInput && typeof pubkeyInput.toBase58 === 'function') return pubkeyInput.toBase58();
      return String(pubkeyInput || '');
    } catch (_) {
      return '';
    }
  }

  function cachedSpendBalance(pubkeyInput) {
    var wallet = walletAddressString(pubkeyInput);
    if (!wallet) return null;
    try {
      var cache = window.__ostPredictionBalanceCache && window.__ostPredictionBalanceCache[wallet];
      var balance = Number(cache && cache.balance);
      if (cache && Number.isFinite(balance) && balance >= 0 && (!cache.ts || Date.now() - Number(cache.ts) < 10 * 60 * 1000)) {
        return balance;
      }
    } catch (_) {}
    return null;
  }

  async function resolveSpendBalance(w, pubkeyInput) {
    var cached = cachedSpendBalance(pubkeyInput);
    try {
      var fetched = await withRescueTimeout(
        w.getOstBalance(pubkeyInput),
        numberSetting('OST_SPEND_BALANCE_TIMEOUT_MS', 7000),
        'OST balance refresh timed out'
      );
      var balance = Number(fetched);
      if (Number.isFinite(balance) && balance > 0) return { balance: balance, source: 'rpc' };
      if (Number.isFinite(balance) && balance === 0 && cached !== null && cached > 0) return { balance: cached, source: 'cache' };
      if (Number.isFinite(balance) && balance === 0) return { balance: 0, source: 'untrusted-zero' };
    } catch (_) {
      if (cached !== null) return { balance: cached, source: 'cache' };
    }
    return { balance: null, source: 'unknown' };
  }

  function vaultConfig() {
    return {
      minReserve: numberSetting('OST_VAULT_MIN_RESERVE', 0),
      lowWater: numberSetting('OST_VAULT_LOW_WATER', 1000000000),
      targetReserve: numberSetting('OST_VAULT_TARGET_RESERVE', 10000000000),
      maxSinglePayout: numberSetting('OST_MAX_SINGLE_PAYOUT', 1000000000)
    };
  }

  function formatOstAmount(value) {
    var number = Number(value);
    if (!Number.isFinite(number)) return '0';
    return number.toLocaleString(undefined, { maximumFractionDigits: number >= 100 ? 2 : 6 });
  }

  function readStorageJson(key, fallback) {
    try {
      var parsed = JSON.parse(localStorage.getItem(key) || 'null');
      return parsed == null ? fallback : parsed;
    } catch (_) {
      return fallback;
    }
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
    if (keys.length > 200) {
      keys.slice(200).forEach(function (key) { delete receipts[key]; });
    }
    writeStorageJson(PAYOUT_RECEIPTS_KEY, receipts);
  }

  function rememberPendingPayout(id, payload) {
    var pending = readStorageJson(PAYOUT_PENDING_KEY, {});
    pending[id] = Object.assign({ id: id, at: Date.now() }, payload || {});
    writeStorageJson(PAYOUT_PENDING_KEY, pending);
  }

  function clearPendingPayout(id) {
    var pending = readStorageJson(PAYOUT_PENDING_KEY, {});
    if (pending && pending[id]) {
      delete pending[id];
      writeStorageJson(PAYOUT_PENDING_KEY, pending);
    }
  }

  function pendingPayouts() {
    return readStorageJson(PAYOUT_PENDING_KEY, {});
  }

  function makeConn(url) {
    if (!rpcConnections[url]) {
      try { rpcConnections[url] = new solanaWeb3.Connection(url, 'processed'); }
      catch (e) { return null; }
    }
    return rpcConnections[url];
  }
  function getRpc() {
    return makeConn(RPC_ENDPOINTS[rpcIndex % RPC_ENDPOINTS.length]);
  }
  function rotateRpc() {
    rpcIndex = (rpcIndex + 1) % RPC_ENDPOINTS.length;
    return getRpc();
  }
  async function withRpc(label, fn) {
    var lastErr = null;
    for (var attempt = 0; attempt < RPC_ENDPOINTS.length * 2; attempt++) {
      var conn = getRpc();
      try { return await fn(conn); }
      catch (e) {
        lastErr = e;
        console.warn('[rescue] ' + label + ' failed on RPC ' + rpcIndex + ':', e && e.message);
        rotateRpc();
        await new Promise(function (r) { setTimeout(r, 250 * (attempt + 1)); });
      }
    }
    throw lastErr || new Error(label + ' failed on every RPC');
  }

  // -----------------------------------------------------------------------
  // 2) POOL HELPERS
  // -----------------------------------------------------------------------
  function loadPoolKeypair() {
    if (!window.OST_SWAP_POOL || !window.OST_SWAP_POOL.secretKey) return null;
    try { return solanaWeb3.Keypair.fromSecretKey(Uint8Array.from(window.OST_SWAP_POOL.secretKey)); }
    catch (e) { return null; }
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

  function decimalToRawAmount(value, decimals) {
    var places = Math.max(0, Number(decimals) || 0);
    var text = String(value || '0');
    if (/e/i.test(text)) text = Number(value || 0).toFixed(places);
    var parts = text.split('.');
    var whole = String(parts[0] || '0').replace(/[^0-9]/g, '') || '0';
    var fraction = String(parts[1] || '').replace(/[^0-9]/g, '').slice(0, places);
    while (fraction.length < places) fraction += '0';
    var scale = BigInt(10) ** BigInt(places);
    return BigInt(whole) * scale + BigInt(fraction || '0');
  }

  function rawToOstText(raw, decimals) {
    var places = Math.max(0, Number(decimals) || 0);
    var scale = BigInt(10) ** BigInt(places);
    var value = BigInt(raw || 0);
    var whole = value / scale;
    var fraction = (value % scale).toString().padStart(places, '0').replace(/0+$/, '');
    return whole.toString() + (fraction ? ('.' + fraction) : '');
  }

  async function getTokenRawBalance(ataInput) {
    var ata = (ataInput && ataInput.toBase58) ? ataInput : new solanaWeb3.PublicKey(ataInput);
    return withRpc('token-raw-balance', async function (conn) {
      var bal = await conn.getTokenAccountBalance(ata);
      return BigInt(bal && bal.value && bal.value.amount || '0');
    }).catch(function () { return BigInt(0); });
  }

  async function verifyTokenBalanceDelta(ata, beforeRaw, expectedRaw, decimals, label, attempts) {
    var lastRaw = beforeRaw;
    var maxAttempts = Math.max(1, Number(attempts) || 10);
    for (var attempt = 0; attempt < maxAttempts; attempt += 1) {
      lastRaw = await getTokenRawBalance(ata);
      if (lastRaw - beforeRaw >= expectedRaw) {
        return { beforeRaw: beforeRaw, afterRaw: lastRaw, deltaRaw: lastRaw - beforeRaw };
      }
      await new Promise(function (resolve) { setTimeout(resolve, 650 + attempt * 300); });
    }
    var received = lastRaw > beforeRaw ? lastRaw - beforeRaw : BigInt(0);
    throw new Error((label || 'Payout') + ' signature confirmed, but recipient balance increased by only ' + rawToOstText(received, decimals) + ' OST of ' + rawToOstText(expectedRaw, decimals) + ' OST owed. Keeping payout pending.');
  }

  // -----------------------------------------------------------------------
  // 3) POOL-PAID TRANSACTION BUILDER
  //    Pool signs as feePayer (always) and optionally as a source authority.
  // -----------------------------------------------------------------------
  async function buildPoolPaidTx(instructions) {
    var pool = loadPoolKeypair();
    if (!pool) throw new Error('Vault keypair not loaded');
    var conn = getRpc();
    var tx = new solanaWeb3.Transaction();
    instructions.forEach(function (ix) { if (ix) tx.add(ix); });
    tx.feePayer = pool.publicKey;
    applyFastLane(tx);
    var bh = await fastBlockhash(conn);
    tx.recentBlockhash = bh.blockhash;
    tx.lastValidBlockHeight = bh.lastValidBlockHeight;
    return { tx: tx, pool: pool, conn: conn, blockhash: bh };
  }

  // Unpack SendTransactionError: call getLogs() so error messages contain real
  // program logs instead of the useless "Logs: []" placeholder.
  async function unpackSendError(err) {
    if (!err) return new Error('Transaction failed');
    var logs = [];
    if (typeof err.getLogs === 'function') {
      try { logs = await err.getLogs(); } catch (_) {}
    } else if (Array.isArray(err.logs)) {
      logs = err.logs;
    }
    var base = err.message || 'Send failed';
    if (logs && logs.length) {
      return new Error(base + '\n\nProgram logs:\n' + logs.join('\n'));
    }
    return err;
  }

  // Send raw bytes with confirmed preflight; retries without preflight on stale-
  // simulation false-positives ("no record of a prior credit").
  async function sendRawSafe(conn, serialized) {
    try {
      return await conn.sendRawTransaction(serialized, fastSendOptions());
    } catch (e) {
      var msg = (e && e.message) || '';
      if (msg.includes('no record of a prior credit') ||
          msg.includes('simulation failed') ||
          msg.includes('Simulation failed')) {
        // Balance was verified before this call — safe to skip stale simulation.
        return conn.sendRawTransaction(serialized, fastSendOptions({ skipPreflight: true }));
      }
      throw await unpackSendError(e);
    }
  }

  async function confirmSentTransaction(sig, built, label) {
    var primaryErr = null;
    try {
      var res = await fastConfirm(built.conn, sig, built.blockhash);
      if (res && res.value && res.value.err) {
        throw new Error('On-chain failure: ' + JSON.stringify(res.value.err));
      }
      return sig;
    } catch (e) {
      primaryErr = e;
    }
    var lastStatus = null;
    for (var attempt = 0; attempt < 8; attempt++) {
      for (var i = 0; i < RPC_ENDPOINTS.length; i++) {
        var conn = makeConn(RPC_ENDPOINTS[i]);
        if (!conn) continue;
        try {
          var sres = await conn.getSignatureStatuses([sig], { searchTransactionHistory: true });
          var entry = sres && sres.value && sres.value[0];
          if (entry) {
            lastStatus = entry;
            if (entry.err) throw new Error('On-chain failure: ' + JSON.stringify(entry.err));
            if (entry.confirmationStatus === 'processed' || entry.confirmationStatus === 'confirmed' || entry.confirmationStatus === 'finalized') return sig;
          }
        } catch (statusErr) {
          if (statusErr && /On-chain failure/i.test(statusErr.message || '')) throw statusErr;
        }
      }
      await new Promise(function (r) { setTimeout(r, 600 + attempt * 250); });
    }
    var summary = lastStatus ? 'last status=' + (lastStatus.confirmationStatus || 'unknown') : 'no status from any RPC';
    throw new Error((label || 'Transaction') + ' could not be confirmed on-chain (' + summary + '): ' + (primaryErr && primaryErr.message ? primaryErr.message : primaryErr));
  }

  function emitRescueTxEvent(name, detail) {
    try { window.dispatchEvent(new CustomEvent('ost:rescue-tx-' + name, { detail: detail || {} })); } catch (_) {}
  }

  function watchTxConfirmation(sig, built, label) {
    var confirmation = confirmSentTransaction(sig, built, label);
    confirmation.then(function () {
      emitRescueTxEvent('confirmed', { sig: sig, label: label || 'Transaction' });
    }).catch(function (error) {
      var message = error && error.message ? error.message : String(error || 'confirmation failed');
      console.warn('[rescue v2] background confirmation failed', sig, message);
      emitRescueTxEvent('failed', { sig: sig, label: label || 'Transaction', error: message });
    });
    return confirmation;
  }

  async function returnAfterFastConfirmation(sig, built, label, options) {
    if (options && options.waitForConfirmation === true) {
      await confirmSentTransaction(sig, built, label);
      return sig;
    }
    var confirmation = watchTxConfirmation(sig, built, label);
    try {
      await withRescueTimeout(
        confirmation,
        Math.max(750, numberSetting('OST_FAST_CONFIRM_MS', 2400)),
        'OST transaction submitted; confirmation is still syncing in the background.'
      );
    } catch (error) {
      var message = error && error.message ? String(error.message) : String(error || '');
      if (!/confirmation is still syncing/i.test(message)) throw error;
      emitRescueTxEvent('submitted', { sig: sig, label: label || 'Transaction' });
    }
    return sig;
  }

  async function sendPoolOnlyTxSubmitted(instructions, label) {
    var built = await buildPoolPaidTx(instructions);
    built.tx.sign(built.pool);
    var sig;
    try {
      sig = await sendRawSafe(built.conn, built.tx.serialize());
    } catch (e) {
      throw await unpackSendError(e);
    }
    watchTxConfirmation(sig, built, label || 'Pool-paid transaction');
    emitRescueTxEvent('submitted', { sig: sig, label: label || 'Pool-paid transaction' });
    return { sig: sig, built: built };
  }

  // Pool-only tx: pool is the only signer.
  async function sendPoolOnlyTx(instructions, label) {
    var txLabel = label || 'Pool-paid transaction';
    var built = await buildPoolPaidTx(instructions);
    built.tx.sign(built.pool);
    var sig;
    try {
      sig = await sendRawSafe(built.conn, built.tx.serialize());
    } catch (e) {
      throw await unpackSendError(e);
    }
    // CRITICAL — DO NOT silently swallow confirmation errors.
    // The previous version did `.catch(function () {})` here, which made
    // every caller (faucet cash-out, prediction sell, top-up claim, stock
    // sell, fair-game wins) believe the payout succeeded even when the
    // transaction never landed on-chain. Users had their credits debited
    // and the OST never arrived in their wallet ("lost to unknown").
    var primaryErr = null;
    try {
      var res = await fastConfirm(built.conn, sig, built.blockhash);
      if (res && res.value && res.value.err) {
        throw new Error('On-chain failure: ' + JSON.stringify(res.value.err));
      }
      return sig;
    } catch (e) {
      primaryErr = e;
    }
    // Confirmation failed (timeout, RPC drop, websocket loss). Cross-check
    // by polling getSignatureStatuses across all RPCs — the tx may actually
    // have landed even though the websocket subscription died.
    var lastStatus = null;
    for (var attempt = 0; attempt < 8; attempt++) {
      for (var i = 0; i < RPC_ENDPOINTS.length; i++) {
        var conn = makeConn(RPC_ENDPOINTS[i]);
        if (!conn) continue;
        try {
          var sres = await conn.getSignatureStatuses([sig], { searchTransactionHistory: true });
          var entry = sres && sres.value && sres.value[0];
          if (entry) {
            lastStatus = entry;
            if (entry.err) throw new Error('On-chain failure: ' + JSON.stringify(entry.err));
            if (entry.confirmationStatus === 'processed' || entry.confirmationStatus === 'confirmed' || entry.confirmationStatus === 'finalized') {
              return sig;
            }
          }
        } catch (statusErr) {
          if (statusErr && /On-chain failure/i.test(statusErr.message || '')) throw statusErr;
        }
      }
      // small back-off between sweeps so a slow leader doesn't false-negative
      await new Promise(function (r) { setTimeout(r, 600 + attempt * 250); });
    }
    var summary = lastStatus
      ? 'last status=' + (lastStatus.confirmationStatus || 'unknown')
      : 'no status from any RPC';
    throw new Error(txLabel + ' could not be confirmed on-chain (' + summary + '): ' + (primaryErr && primaryErr.message ? primaryErr.message : primaryErr));
  }

  // Pool pays SOL fee + partial-signs first; user wallet signs to authorise
  // their OST transfer. Used when user is spending their own OST.
  async function sendUserSignedPoolPaidTx(instructions, options) {
    var w = window.OST_WALLET;
    if (!w || !w.sign) throw new Error('Wallet helpers not loaded');
    var built = await buildPoolPaidTx(instructions);
    built.tx.partialSign(built.pool);

    // w.sign calls signAndSendTransaction which already uses _sendRaw internally,
    // but we need to hand it the partly-signed tx directly.
    var session = w.session;
    if (!session || !session.publicKey) throw new Error('Connect a wallet first');
    var serialized;
    if (session.kind === 'local' && session.keypair) {
      built.tx.partialSign(session.keypair);
      serialized = built.tx.serialize();
    } else if (session.provider && typeof session.provider.signTransaction === 'function') {
      var signed = await waitForWalletApproval(session.provider.signTransaction(built.tx), 'Wallet signature');
      serialized = signed.serialize();
    } else if (session.provider && typeof session.provider.signAndSendTransaction === 'function') {
      // Provider handles send; just return the signature.
      var res = await waitForWalletApproval(session.provider.signAndSendTransaction(built.tx, fastSendOptions()), 'Wallet signature');
      var providerSig = typeof res === 'string' ? res : (res && res.signature);
      if (providerSig) await returnAfterFastConfirmation(providerSig, built, 'Wallet-signed transaction', options || {});
      return providerSig;
    } else {
      throw new Error('Wallet cannot sign transactions');
    }
    try {
      var sig = await sendRawSafe(built.conn, serialized);
      await returnAfterFastConfirmation(sig, built, 'Wallet-signed transaction', options || {});
      return sig;
    } catch (e) {
      throw await unpackSendError(e);
    }
  }

  // -----------------------------------------------------------------------
  // 4) POOL-PAID USER OST ATA CREATION
  // -----------------------------------------------------------------------
  async function ensureUserOstAtaPoolPaid(userPubkey) {
    var w = window.OST_WALLET; if (!w) throw new Error('Wallet helpers not loaded');
    var c = w.constants;
    var owner = (userPubkey && userPubkey.toBase58) ? userPubkey : new solanaWeb3.PublicKey(userPubkey);
    var mintPk = new solanaWeb3.PublicKey(window.OST_SWAP_POOL.mint);
    var ata = w.associatedAddress(mintPk, owner, false, c.TOKEN_2022_PROGRAM_ID);
    var conn = getRpc();
    var info = await conn.getAccountInfo(ata).catch(function () { return null; });
    if (info) return ata;
    var pool = loadPoolKeypair();
    var ix = w.associatedAccountIx(pool.publicKey, ata, owner, mintPk, c.TOKEN_2022_PROGRAM_ID);
    try {
      await withRescueTimeout(
        sendPoolOnlyTx([ix], 'OST account preparation'),
        Math.max(12000, numberSetting('OST_ATA_CONFIRM_TIMEOUT_MS', 18000)),
        'OST account preparation is still syncing on devnet. Wait a few seconds and try again.'
      );
    } catch (error) {
      var latestInfo = await conn.getAccountInfo(ata).catch(function () { return null; });
      if (latestInfo) return ata;
      throw error;
    }
    return ata;
  }

  // -----------------------------------------------------------------------
  // 5) PAYOUT OST  (pool → user, zero-SOL UX)
  // -----------------------------------------------------------------------
  // Best-effort audit log → Cloudflare worker. Posts an "intent" before the
  // on-chain transfer and a "result"/"failure" after, so support / scripts
  // can reconcile any OST that disappears mid-flight.
  function ostApiBaseSafe() {
    try { return (window.OST_API_BASE || '').replace(/\/+$/, ''); } catch (_) { return ''; }
  }
  function logPayoutAudit(payload) {
    try {
      var base = ostApiBaseSafe();
      if (!base) return;
      // navigator.sendBeacon survives page unload — use it when available so
      // intents written right before navigation still arrive.
      var body = JSON.stringify(payload);
      if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
        try { navigator.sendBeacon(base + '/wallet/payouts', new Blob([body], { type: 'application/json' })); return; } catch (_) {}
      }
      fetch(base + '/wallet/payouts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: body, keepalive: true }).catch(function () {});
    } catch (_) {}
  }

  function verifyPayoutInBackground(payoutId, walletStr, amt, memoSummary, memoText, sig, userAta, beforeUserRaw, expectedRaw, decimals) {
    setTimeout(function () {
      verifyTokenBalanceDelta(userAta, beforeUserRaw, expectedRaw, decimals, 'OST payout', 24).then(function () {
        clearPendingPayout(payoutId);
        rememberPayoutReceipt(payoutId, { wallet: walletStr, ost: amt, sig: sig, memo: memoSummary, ref: payoutRefFromMemo(memoText), verified: true });
        logPayoutAudit({ id: payoutId, stage: 'result', wallet: walletStr, kind: 'payout', ostAmount: amt, memo: memoSummary, sig: sig, ref: payoutRefFromMemo(memoText) });
        emitRescueTxEvent('payout-verified', { sig: sig, wallet: walletStr, ostAmount: amt, id: payoutId });
      }).catch(function (err) {
        var message = err && err.message ? String(err.message).slice(0, 240) : 'verification still pending';
        rememberPendingPayout(payoutId, { wallet: walletStr, ostAmount: amt, memo: memoSummary, sig: sig, error: message, stage: /On-chain failure/i.test(message) ? 'send-failed' : 'verification-pending' });
        if (/On-chain failure/i.test(message)) {
          logPayoutAudit({ id: payoutId, stage: 'failure', wallet: walletStr, kind: 'payout', ostAmount: amt, memo: memoSummary, sig: sig, error: message, ref: payoutRefFromMemo(memoText) });
        }
        emitRescueTxEvent('payout-pending', { sig: sig, wallet: walletStr, ostAmount: amt, id: payoutId, error: message });
      });
    }, 0);
  }

  async function payoutOst(toPubkeyInput, amountOst, memoText, options) {
    var w = window.OST_WALLET; if (!w) throw new Error('Wallet helpers not loaded');
    var c = w.constants;
    var amt = Number(amountOst);
    if (!Number.isFinite(amt) || amt <= 0) throw new Error('Invalid payout amount');

    var to = (toPubkeyInput && toPubkeyInput.toBase58) ? toPubkeyInput : new solanaWeb3.PublicKey(toPubkeyInput);
    var walletStr = '';
    try { walletStr = to.toBase58(); } catch (_) {}
    var memoSummary = '';
    try { memoSummary = String(memoText || '').slice(0, 200); } catch (_) {}
    var payoutId = buildPayoutId(walletStr, amt, memoText, options || {});
    var prior = getPayoutReceipt(payoutId, walletStr, amt);
    if (prior) return { sig: prior.sig, ost: Number(prior.ost || amt), auditId: payoutId, idempotent: true };
    if (payoutLocks[payoutId]) return payoutLocks[payoutId];

    payoutLocks[payoutId] = (async function () {
      var cfg = vaultConfig();
      if (cfg.maxSinglePayout > 0 && amt > cfg.maxSinglePayout) {
        var capError = 'Payout ' + formatOstAmount(amt) + ' OST exceeds the automatic vault limit of ' + formatOstAmount(cfg.maxSinglePayout) + ' OST. No balance was changed; support must approve or split this settlement.';
        rememberPendingPayout(payoutId, { wallet: walletStr, ostAmount: amt, memo: memoSummary, error: capError, stage: 'manual-review' });
        logPayoutAudit({ id: payoutId, stage: 'failure', wallet: walletStr, kind: 'payout', ostAmount: amt, memo: memoSummary, error: capError, ref: payoutRefFromMemo(memoText) });
        throw new Error(capError);
      }

      var poolBal = await getPoolOstBalance();
      if (poolBal + 0.000000001 < amt) {
        var emptyError = 'OST payout vault needs refill before paying ' + formatOstAmount(amt) + ' OST. No partial payout was sent or recorded; try again shortly.';
        rememberPendingPayout(payoutId, { wallet: walletStr, ostAmount: amt, poolBalance: poolBal, memo: memoSummary, error: emptyError, stage: 'awaiting-refill' });
        logPayoutAudit({ id: payoutId, stage: 'failure', wallet: walletStr, kind: 'payout', ostAmount: amt, memo: memoSummary, error: emptyError, ref: payoutRefFromMemo(memoText) });
        throw new Error(emptyError);
      }
      if (cfg.minReserve > 0 && poolBal - amt < cfg.minReserve) {
        var reserveError = 'OST payout vault is protecting its shared reserve. Needs ' + formatOstAmount(amt) + ' OST with ' + formatOstAmount(cfg.minReserve) + ' OST kept online; current vault is ' + formatOstAmount(poolBal) + ' OST. No partial payout was sent.';
        rememberPendingPayout(payoutId, { wallet: walletStr, ostAmount: amt, poolBalance: poolBal, memo: memoSummary, error: reserveError, stage: 'reserve-protected' });
        logPayoutAudit({ id: payoutId, stage: 'failure', wallet: walletStr, kind: 'payout', ostAmount: amt, memo: memoSummary, error: reserveError, ref: payoutRefFromMemo(memoText) });
        throw new Error(reserveError);
      }

      var pool = loadPoolKeypair();
      var mintPk = new solanaWeb3.PublicKey(window.OST_SWAP_POOL.mint);
      var poolAta = new solanaWeb3.PublicKey(window.OST_SWAP_POOL.ata);

      // Pool pays for the user's ATA rent if missing.
      var userAta = await ensureUserOstAtaPoolPaid(to);
      var expectedRaw = decimalToRawAmount(amt, c.OST_TOKEN_DECIMALS);
      var beforeUserRaw = await getTokenRawBalance(userAta);

      var ixs = [
        w.transferChecked(poolAta, mintPk, userAta, pool.publicKey,
          expectedRaw, c.OST_TOKEN_DECIMALS, c.TOKEN_2022_PROGRAM_ID)
      ];
      if (memoText) ixs.push(w.memoIx(String(memoText), pool.publicKey));

      logPayoutAudit({ id: payoutId, stage: 'intent', wallet: walletStr, kind: 'payout', ostAmount: amt, memo: memoSummary, ref: payoutRefFromMemo(memoText) });

      var sig;
      try {
        if (options && options.fastReturn) {
          var submitted = await sendPoolOnlyTxSubmitted(ixs, 'OST payout');
          sig = submitted.sig;
          rememberPendingPayout(payoutId, { wallet: walletStr, ostAmount: amt, memo: memoSummary, sig: sig, stage: 'verifying' });
          verifyPayoutInBackground(payoutId, walletStr, amt, memoSummary, memoText, sig, userAta, beforeUserRaw, expectedRaw, c.OST_TOKEN_DECIMALS);
          return { sig: sig, ost: amt, auditId: payoutId, pending: true, verified: false };
        }
        sig = await sendPoolOnlyTx(ixs);
        await verifyTokenBalanceDelta(userAta, beforeUserRaw, expectedRaw, c.OST_TOKEN_DECIMALS, 'OST payout');
      } catch (err) {
        rememberPendingPayout(payoutId, { wallet: walletStr, ostAmount: amt, memo: memoSummary, error: (err && err.message) ? String(err.message).slice(0, 240) : 'unknown', stage: 'send-failed' });
        logPayoutAudit({ id: payoutId, stage: 'failure', wallet: walletStr, kind: 'payout', ostAmount: amt, memo: memoSummary, error: (err && err.message) ? String(err.message).slice(0, 240) : 'unknown', ref: payoutRefFromMemo(memoText) });
        throw err;
      }
      clearPendingPayout(payoutId);
      rememberPayoutReceipt(payoutId, { wallet: walletStr, ost: amt, sig: sig, memo: memoSummary, ref: payoutRefFromMemo(memoText), verified: true });
      logPayoutAudit({ id: payoutId, stage: 'result', wallet: walletStr, kind: 'payout', ostAmount: amt, memo: memoSummary, sig: sig, ref: payoutRefFromMemo(memoText) });
      return { sig: sig, ost: amt, auditId: payoutId };
    })();

    try { return await payoutLocks[payoutId]; }
    finally { delete payoutLocks[payoutId]; }
  }

  // -----------------------------------------------------------------------
  // 6) USER → POOL  (BUY-side; pool pays the SOL fee)
  // -----------------------------------------------------------------------
  async function userSendsOstToPool(amountOst, memoText) {
    var w = window.OST_WALLET; if (!w || !w.session || !w.session.publicKey) throw new Error('Connect a wallet first');
    var c = w.constants;
    var amt = Number(amountOst);
    if (!Number.isFinite(amt) || amt <= 0) throw new Error('Enter a valid OST amount');

    var balanceCheck = await resolveSpendBalance(w, w.session.publicKey);
    if (balanceCheck && balanceCheck.source === 'rpc' && balanceCheck.balance + 1e-9 < amt) {
      throw new Error('Not enough OST in wallet');
    }

    var mintPk = new solanaWeb3.PublicKey(window.OST_SWAP_POOL.mint);
    var poolAta = new solanaWeb3.PublicKey(window.OST_SWAP_POOL.ata);
    var userAta = await ensureUserOstAtaPoolPaid(w.session.publicKey);

    var ixs = [
      w.transferChecked(userAta, mintPk, poolAta, w.session.publicKey,
        w.toBaseUnits(amt, c.OST_TOKEN_DECIMALS), c.OST_TOKEN_DECIMALS, c.TOKEN_2022_PROGRAM_ID)
    ];
    if (memoText) ixs.push(w.memoIx(String(memoText), w.session.publicKey));

    var sig = await sendUserSignedPoolPaidTx(ixs);
    return { sig: sig, ost: amt };
  }

  // -----------------------------------------------------------------------
  // 7) MEMECOIN BUY / SELL
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
  // 8) PREDICTION CASH-OUT
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
      { idempotencyKey: 'prediction-cashout:' + (orderId || stableHash(JSON.stringify(orderRecord || {}))) + ':' + Number(payoutAmount || 0).toFixed(9), fastReturn: true }
    );
  }

  // -----------------------------------------------------------------------
  // 9) PATCH OST_WALLET.ensureFee  →  no-op (pool pays)
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
  // 10) PUBLIC API
  // -----------------------------------------------------------------------
  window.OST_RESCUE = {
    rpc: { get: getRpc, rotate: rotateRpc, endpoints: RPC_ENDPOINTS, withRpc: withRpc },
    poolBalance: getPoolOstBalance,
    poolSolBalance: getPoolSolBalance,
    pendingPayouts: pendingPayouts,
    vaultConfig: vaultConfig,
    ensureUserAta: ensureUserOstAtaPoolPaid,
    buildPoolPaidTx: buildPoolPaidTx,
    sendPoolOnlyTx: sendPoolOnlyTx,
    sendUserSignedPoolPaidTx: sendUserSignedPoolPaidTx,
    payoutOst: payoutOst,
    userSendsOstToPool: userSendsOstToPool
  };
  window.OST_TRADE = window.OST_TRADE || {};
  window.OST_TRADE.memecoinBuy = memecoinBuy;
  window.OST_TRADE.memecoinSell = memecoinSell;
  window.OST_TRADE.predictionCashOut = predictionCashOut;
  window.OST_TRADE.payoutOst = payoutOst;

  function bootstrap() {
    if (!window.OST_WALLET) { return setTimeout(bootstrap, 250); }
    patchEnsureFee();
    console.log('[rescue v2] pool-paid OST flows active. Endpoints:', RPC_ENDPOINTS.length);
    Promise.all([getPoolOstBalance(), getPoolSolBalance()]).then(function (r) {
      var cfg = vaultConfig();
      console.log('[rescue v2] pool: ' + r[0].toLocaleString() + ' OST · ' + r[1].toFixed(3) + ' SOL');
      if (r[0] < cfg.lowWater) {
        console.warn('[rescue v2] POOL LOW — admin must run: npm run vault:refill');
      }
    }).catch(function () {});
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }
})();

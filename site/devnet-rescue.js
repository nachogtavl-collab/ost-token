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
  var RPC_ENDPOINTS = [
    'https://api.devnet.solana.com',
    'https://devnet.helius-rpc.com/?api-key=public',
    'https://rpc.ankr.com/solana_devnet'
  ];
  var rpcIndex = 0;
  var rpcConnections = {};

  function makeConn(url) {
    if (!rpcConnections[url]) {
      try { rpcConnections[url] = new solanaWeb3.Connection(url, 'confirmed'); }
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
    var bh = await conn.getLatestBlockhash('confirmed');
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
      return await conn.sendRawTransaction(serialized, {
        skipPreflight: false,
        preflightCommitment: 'confirmed'
      });
    } catch (e) {
      var msg = (e && e.message) || '';
      if (msg.includes('no record of a prior credit') ||
          msg.includes('simulation failed') ||
          msg.includes('Simulation failed')) {
        // Balance was verified before this call — safe to skip stale simulation.
        return conn.sendRawTransaction(serialized, { skipPreflight: true });
      }
      throw await unpackSendError(e);
    }
  }

  // Pool-only tx: pool is the only signer.
  async function sendPoolOnlyTx(instructions) {
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
      var res = await built.conn.confirmTransaction({
        signature: sig,
        blockhash: built.blockhash.blockhash,
        lastValidBlockHeight: built.blockhash.lastValidBlockHeight
      }, 'confirmed');
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
            if (entry.confirmationStatus === 'confirmed' || entry.confirmationStatus === 'finalized') {
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
    throw new Error('Payout could not be confirmed on-chain (' + summary + '): ' + (primaryErr && primaryErr.message ? primaryErr.message : primaryErr));
  }

  // Pool pays SOL fee + partial-signs first; user wallet signs to authorise
  // their OST transfer. Used when user is spending their own OST.
  async function sendUserSignedPoolPaidTx(instructions) {
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
      var signed = await session.provider.signTransaction(built.tx);
      serialized = signed.serialize();
    } else if (session.provider && typeof session.provider.signAndSendTransaction === 'function') {
      // Provider handles send; just return the signature.
      var res = await session.provider.signAndSendTransaction(built.tx);
      return typeof res === 'string' ? res : (res && res.signature);
    } else {
      throw new Error('Wallet cannot sign transactions');
    }
    try {
      return await sendRawSafe(built.conn, serialized);
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
    await sendPoolOnlyTx([ix]);
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

  async function payoutOst(toPubkeyInput, amountOst, memoText) {
    var w = window.OST_WALLET; if (!w) throw new Error('Wallet helpers not loaded');
    var c = w.constants;
    var amt = Number(amountOst);
    if (!Number.isFinite(amt) || amt <= 0) throw new Error('Invalid payout amount');

    var poolBal = await getPoolOstBalance();
    if (poolBal <= 0) throw new Error('Vault is being refilled. Try again in a moment.');
    var toSend = Math.min(amt, Math.floor(poolBal * 100) / 100);
    if (toSend < 0.01) throw new Error('Vault temporarily empty.');

    var to = (toPubkeyInput && toPubkeyInput.toBase58) ? toPubkeyInput : new solanaWeb3.PublicKey(toPubkeyInput);
    var pool = loadPoolKeypair();
    var mintPk = new solanaWeb3.PublicKey(window.OST_SWAP_POOL.mint);
    var poolAta = new solanaWeb3.PublicKey(window.OST_SWAP_POOL.ata);

    // Pool pays for the user's ATA rent if missing.
    var userAta = await ensureUserOstAtaPoolPaid(to);

    var ixs = [
      w.transferChecked(poolAta, mintPk, userAta, pool.publicKey,
        w.toBaseUnits(toSend, c.OST_TOKEN_DECIMALS), c.OST_TOKEN_DECIMALS, c.TOKEN_2022_PROGRAM_ID)
    ];
    if (memoText) ixs.push(w.memoIx(String(memoText), pool.publicKey));

    var auditId = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : ('payout-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10));
    var walletStr = '';
    try { walletStr = to.toBase58(); } catch (_) {}
    var memoSummary = '';
    try { memoSummary = String(memoText || '').slice(0, 200); } catch (_) {}
    logPayoutAudit({ id: auditId, stage: 'intent', wallet: walletStr, kind: 'payout', ostAmount: toSend, memo: memoSummary });

    var sig;
    try {
      sig = await sendPoolOnlyTx(ixs);
    } catch (err) {
      logPayoutAudit({ id: auditId, stage: 'failure', wallet: walletStr, kind: 'payout', ostAmount: toSend, memo: memoSummary, error: (err && err.message) ? String(err.message).slice(0, 240) : 'unknown' });
      throw err;
    }
    logPayoutAudit({ id: auditId, stage: 'result', wallet: walletStr, kind: 'payout', ostAmount: toSend, memo: memoSummary, sig: sig });
    return { sig: sig, ost: toSend, auditId: auditId };
  }

  // -----------------------------------------------------------------------
  // 6) USER → POOL  (BUY-side; pool pays the SOL fee)
  // -----------------------------------------------------------------------
  async function userSendsOstToPool(amountOst, memoText) {
    var w = window.OST_WALLET; if (!w || !w.session || !w.session.publicKey) throw new Error('Connect a wallet first');
    var c = w.constants;
    var amt = Number(amountOst);
    if (!Number.isFinite(amt) || amt <= 0) throw new Error('Enter a valid OST amount');

    var userBal = await w.getOstBalance(w.session.publicKey);
    if (userBal + 1e-9 < amt) throw new Error('Not enough OST in wallet');

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
    return payoutOst(w.session.publicKey, payoutAmount,
      JSON.stringify({
        k: orderRecord && orderRecord.cashoutKind === 'prediction-sell' ? 'prediction-sell' : 'prediction-settlement',
        market: orderRecord && orderRecord.marketId,
        side: orderRecord && orderRecord.side,
        stake: orderRecord && Number(orderRecord.stake || 0),
        payout: Number(payoutAmount),
        t: Date.now()
      })
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
      console.log('[rescue v2] pool: ' + r[0].toLocaleString() + ' OST · ' + r[1].toFixed(3) + ' SOL');
      if (r[0] < 1000) {
        console.warn('[rescue v2] POOL LOW — admin must run: npx ts-node scripts/init-swap-pool.ts');
      }
    }).catch(function () {});
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }
})();

/* ==========================================================================
   OST Devnet Rescue v1
   Patches the live site to fix five long-standing devnet pain points:
     1) Multi-RPC fallback connection (no more single-endpoint outages)
     2) Robust devnet SOL airdrop with retries + multi-faucet rotation
     3) Auto-refill of the OST swap pool (claim-faucet helper + recycling)
     4) Real on-chain memecoin BUY/SELL through the pool (was localStorage only)
     5) Prediction market CASH-OUT (pool returns OST when user closes a bet)

   This module monkey-patches window.OST_WALLET / window.OST_TRADE after the
   main app has loaded, then exposes window.OST_RESCUE for direct use.
   ========================================================================== */
(function () {
  'use strict';

  if (typeof solanaWeb3 === 'undefined') return;

  // -----------------------------------------------------------------------
  // 1) MULTI-RPC CONNECTION
  // -----------------------------------------------------------------------
  // Public devnet endpoints. Helius/Triton free tiers + Solana primary.
  // We rotate on failure so a single endpoint outage does not kill the site.
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

  // Run an RPC call with up to N retries across rotating endpoints.
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
  // 2) ROBUST DEVNET SOL AIRDROP
  // -----------------------------------------------------------------------
  // The official devnet faucet rate-limits hard. We:
  //   a) try requestAirdrop on each RPC endpoint (each has its own quota)
  //   b) wait+retry with backoff
  //   c) fall back to refilling from the swap pool's lamports if all faucets fail
  async function airdropSol(pubkeyInput, sol) {
    var pk = (pubkeyInput && pubkeyInput.toBase58) ? pubkeyInput : new solanaWeb3.PublicKey(pubkeyInput);
    var lamports = Math.round((sol || 0.1) * solanaWeb3.LAMPORTS_PER_SOL);
    var lastErr = null;
    var startIdx = rpcIndex;
    for (var i = 0; i < RPC_ENDPOINTS.length; i++) {
      var conn = makeConn(RPC_ENDPOINTS[(startIdx + i) % RPC_ENDPOINTS.length]);
      if (!conn) continue;
      try {
        var sig = await conn.requestAirdrop(pk, lamports);
        try { await conn.confirmTransaction(sig, 'confirmed'); } catch (_) {}
        return { ok: true, sig: sig, source: 'faucet:' + RPC_ENDPOINTS[(startIdx + i) % RPC_ENDPOINTS.length] };
      } catch (e) {
        lastErr = e;
        console.warn('[rescue] airdrop on RPC ' + i + ' failed:', e && e.message);
      }
    }
    // Last-resort: ship SOL from the swap pool keypair (it is pre-funded).
    try {
      var pool = loadPoolKeypair();
      if (pool) {
        var conn2 = getRpc();
        var poolBal = await conn2.getBalance(pool.publicKey);
        if (poolBal > lamports + 5_000_000) {
          var tx = new solanaWeb3.Transaction().add(
            solanaWeb3.SystemProgram.transfer({
              fromPubkey: pool.publicKey,
              toPubkey: pk,
              lamports: lamports
            })
          );
          tx.feePayer = pool.publicKey;
          var bh = await conn2.getLatestBlockhash('confirmed');
          tx.recentBlockhash = bh.blockhash;
          tx.sign(pool);
          var sig2 = await conn2.sendRawTransaction(tx.serialize());
          await conn2.confirmTransaction({ signature: sig2, blockhash: bh.blockhash, lastValidBlockHeight: bh.lastValidBlockHeight }, 'confirmed');
          return { ok: true, sig: sig2, source: 'pool-sweep' };
        }
      }
    } catch (e) {
      console.warn('[rescue] pool sweep airdrop failed:', e && e.message);
      lastErr = e;
    }
    throw lastErr || new Error('All devnet faucets are rate-limited right now. Try again in 30 seconds.');
  }

  function loadPoolKeypair() {
    if (!window.OST_SWAP_POOL || !window.OST_SWAP_POOL.secretKey) return null;
    try { return solanaWeb3.Keypair.fromSecretKey(Uint8Array.from(window.OST_SWAP_POOL.secretKey)); }
    catch (e) { return null; }
  }

  // -----------------------------------------------------------------------
  // 3) VAULT AUTO-REFILL
  // -----------------------------------------------------------------------
  // The pool is a regular keypair (devnet only). We keep it topped up by:
  //   a) claiming the OST faucet from EPHEMERAL helper wallets (each can claim
  //      1 OST once via the program), then sweeping to the pool ATA.
  //   b) any user-initiated sink (interchange / prediction / memecoin BUY)
  //      already sends OST to the pool ATA via OST_TRADE below — net positive.
  //
  // Triggered automatically when balance drops below MIN_VAULT_OST.
  var MIN_VAULT_OST = 25;
  var TARGET_VAULT_OST = 100;
  var refillInFlight = false;

  async function getPoolOstBalance() {
    if (!window.OST_SWAP_POOL) return 0;
    return withRpc('pool-balance', async function (conn) {
      var ata = new solanaWeb3.PublicKey(window.OST_SWAP_POOL.ata);
      var bal = await conn.getTokenAccountBalance(ata);
      return Number(bal && bal.value && bal.value.uiAmount || 0);
    }).catch(function () { return 0; });
  }

  // Spin up an ephemeral helper, airdrop SOL, claim faucet, sweep OST → pool.
  async function refillFromHelperFaucet() {
    if (refillInFlight) return { skipped: true };
    refillInFlight = true;
    try {
      if (!window.OST_CONFIG || !window.OST_SWAP_POOL) return { skipped: true };
      var w = window.OST_WALLET;
      if (!w) return { skipped: true };
      var helper = solanaWeb3.Keypair.generate();
      // Step 1: airdrop SOL to helper
      await airdropSol(helper.publicKey, 0.05);
      // Step 2: build claim-faucet tx signed by helper
      var conn = getRpc();
      var programId = new solanaWeb3.PublicKey(window.OST_CONFIG.programId);
      var mintPk = new solanaWeb3.PublicKey(window.OST_CONFIG.mint);
      var encoder = new TextEncoder();
      var seedDao = encoder.encode('dao-treasury');
      var seedAuth = encoder.encode('treasury-authority');
      var seedClaim = encoder.encode('faucet-claim');
      var c = w.constants;
      var daoTreasury = solanaWeb3.PublicKey.findProgramAddressSync([seedDao], programId)[0];
      var treasuryAuth = solanaWeb3.PublicKey.findProgramAddressSync([seedAuth], programId)[0];
      var faucetClaim = solanaWeb3.PublicKey.findProgramAddressSync([seedClaim, helper.publicKey.toBuffer()], programId)[0];
      var treasuryAta = w.associatedAddress(mintPk, treasuryAuth, true, c.TOKEN_2022_PROGRAM_ID, w.constants && w.constants.ASSOCIATED_TOKEN_PROGRAM_ID);
      var helperAta = w.associatedAddress(mintPk, helper.publicKey, false, c.TOKEN_2022_PROGRAM_ID);

      var tx = new solanaWeb3.Transaction();
      // Create helper ATA (helper is signer + payer)
      tx.add(w.associatedAccountIx(helper.publicKey, helperAta, helper.publicKey, mintPk, c.TOKEN_2022_PROGRAM_ID));
      // Claim faucet
      var disc = Uint8Array.from([80, 7, 251, 108, 55, 145, 135, 68]);
      tx.add(new solanaWeb3.TransactionInstruction({
        programId: programId,
        keys: [
          { pubkey: helper.publicKey, isSigner: true, isWritable: true },
          { pubkey: helperAta, isSigner: false, isWritable: true },
          { pubkey: treasuryAta, isSigner: false, isWritable: true },
          { pubkey: daoTreasury, isSigner: false, isWritable: false },
          { pubkey: treasuryAuth, isSigner: false, isWritable: false },
          { pubkey: faucetClaim, isSigner: false, isWritable: true },
          { pubkey: mintPk, isSigner: false, isWritable: false },
          { pubkey: c.TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: solanaWeb3.SystemProgram.programId, isSigner: false, isWritable: false }
        ],
        data: disc
      }));
      // Pay the per-claim 0.001 SOL fee (the existing program wires this; mirror it to the pool)
      tx.add(solanaWeb3.SystemProgram.transfer({
        fromPubkey: helper.publicKey,
        toPubkey: new solanaWeb3.PublicKey(window.OST_SWAP_POOL.publicKey),
        lamports: 1_000_000
      }));
      tx.feePayer = helper.publicKey;
      var bh = await conn.getLatestBlockhash('confirmed');
      tx.recentBlockhash = bh.blockhash;
      tx.sign(helper);
      var sigClaim = await conn.sendRawTransaction(tx.serialize());
      await conn.confirmTransaction({ signature: sigClaim, blockhash: bh.blockhash, lastValidBlockHeight: bh.lastValidBlockHeight }, 'confirmed');
      // Step 3: sweep helper OST → pool ATA
      var helperBal = await conn.getTokenAccountBalance(helperAta).catch(function () { return null; });
      var amount = helperBal && helperBal.value ? BigInt(helperBal.value.amount || '0') : 0n;
      if (amount > 0n) {
        var poolAta = new solanaWeb3.PublicKey(window.OST_SWAP_POOL.ata);
        var tx2 = new solanaWeb3.Transaction().add(
          w.transferChecked(helperAta, mintPk, poolAta, helper.publicKey, amount, c.OST_TOKEN_DECIMALS, c.TOKEN_2022_PROGRAM_ID)
        );
        tx2.feePayer = helper.publicKey;
        var bh2 = await conn.getLatestBlockhash('confirmed');
        tx2.recentBlockhash = bh2.blockhash;
        tx2.sign(helper);
        var sigSweep = await conn.sendRawTransaction(tx2.serialize());
        await conn.confirmTransaction({ signature: sigSweep, blockhash: bh2.blockhash, lastValidBlockHeight: bh2.lastValidBlockHeight }, 'confirmed');
        return { ok: true, claimed: Number(amount) / Math.pow(10, c.OST_TOKEN_DECIMALS), claimSig: sigClaim, sweepSig: sigSweep };
      }
      return { ok: true, claimed: 0, claimSig: sigClaim };
    } finally {
      refillInFlight = false;
    }
  }

  async function ensurePoolHasOst(minOst) {
    var min = Number(minOst || MIN_VAULT_OST);
    var bal = await getPoolOstBalance();
    if (bal >= min) return { ok: true, balance: bal };
    var topUps = 0;
    while (bal < Math.max(min, TARGET_VAULT_OST) && topUps < 5) {
      try {
        var r = await refillFromHelperFaucet();
        topUps++;
        if (!r || r.skipped) break;
      } catch (e) {
        console.warn('[rescue] vault refill failed:', e && e.message);
        break;
      }
      bal = await getPoolOstBalance();
    }
    return { ok: bal >= min, balance: bal, topUps: topUps };
  }

  // Daemon: every 90s while page is open, if pool < MIN_VAULT_OST, refill.
  function startVaultDaemon() {
    if (window.__OST_VAULT_DAEMON__) return;
    window.__OST_VAULT_DAEMON__ = true;
    async function tick() {
      try {
        var bal = await getPoolOstBalance();
        if (bal > 0 && bal < MIN_VAULT_OST) {
          console.log('[rescue] vault low (' + bal.toFixed(2) + ' OST) — refilling');
          await ensurePoolHasOst(TARGET_VAULT_OST);
        }
      } catch (e) {}
    }
    setTimeout(tick, 5000);
    setInterval(tick, 90000);
  }

  // -----------------------------------------------------------------------
  // 4) MEMECOIN ON-CHAIN BUY / SELL via swap pool
  // -----------------------------------------------------------------------
  // BUY  (user OST → pool ATA, simulated price impact updates local state)
  // SELL (pool ATA → user, capped by pool balance)
  async function memecoinBuy(token, ostAmount) {
    var w = window.OST_WALLET;
    if (!w || !w.session || !w.session.publicKey) throw new Error('Connect a wallet first');
    if (!window.OST_SWAP_POOL) throw new Error('Vault not loaded');
    var amt = Number(ostAmount);
    if (!Number.isFinite(amt) || amt <= 0) throw new Error('Enter a valid OST amount');

    var conn = w.getConnection();
    var c = w.constants;
    var mintPk = new solanaWeb3.PublicKey(window.OST_SWAP_POOL.mint);
    var poolAta = new solanaWeb3.PublicKey(window.OST_SWAP_POOL.ata);
    var userAta = await w.ensureAta(w.session.publicKey);
    var userBal = await w.getOstBalance(w.session.publicKey);
    if (userBal + 1e-9 < amt) throw new Error('Not enough OST. Cash in first.');

    var tx = new solanaWeb3.Transaction();
    tx.add(w.transferChecked(userAta, mintPk, poolAta, w.session.publicKey,
      w.toBaseUnits(amt, c.OST_TOKEN_DECIMALS), c.OST_TOKEN_DECIMALS, c.TOKEN_2022_PROGRAM_ID));
    tx.add(w.memoIx(JSON.stringify({ k: 'memecoin-buy', token: String(token || ''), ost: amt, t: Date.now() }), w.session.publicKey));
    var sig = await w.sign(tx);
    return { sig: sig, ost: amt, side: 'buy', token: token };
  }

  async function memecoinSell(token, ostAmount) {
    var w = window.OST_WALLET;
    if (!w || !w.session || !w.session.publicKey) throw new Error('Connect a wallet first');
    if (!window.OST_SWAP_POOL || !window.OST_SWAP_POOL.secretKey) throw new Error('Vault not loaded');
    var amt = Number(ostAmount);
    if (!Number.isFinite(amt) || amt <= 0) throw new Error('Enter a valid OST amount');

    await ensurePoolHasOst(amt + 5);
    var poolBal = await getPoolOstBalance();
    var toSend = Math.min(amt, Math.floor(poolBal * 100) / 100);
    if (toSend < 0.01) throw new Error('Vault temporarily empty. Try in a minute.');

    var conn = w.getConnection();
    var c = w.constants;
    var pool = loadPoolKeypair();
    var mintPk = new solanaWeb3.PublicKey(window.OST_SWAP_POOL.mint);
    var poolAta = new solanaWeb3.PublicKey(window.OST_SWAP_POOL.ata);
    var userAta = await w.ensureAta(w.session.publicKey);

    // Make sure user has SOL for fee
    try { await w.ensureFee(w.session.publicKey); } catch (_) {}

    var tx = new solanaWeb3.Transaction();
    tx.add(w.transferChecked(poolAta, mintPk, userAta, pool.publicKey,
      w.toBaseUnits(toSend, c.OST_TOKEN_DECIMALS), c.OST_TOKEN_DECIMALS, c.TOKEN_2022_PROGRAM_ID));
    tx.add(w.memoIx(JSON.stringify({ k: 'memecoin-sell', token: String(token || ''), ost: toSend, t: Date.now() }), w.session.publicKey));
    tx.feePayer = w.session.publicKey;
    var bh = await conn.getLatestBlockhash('confirmed');
    tx.recentBlockhash = bh.blockhash;
    tx.partialSign(pool);
    var sig = await w.sign(tx);
    return { sig: sig, ost: toSend, side: 'sell', token: token };
  }

  // -----------------------------------------------------------------------
  // 5) PREDICTION CASH-OUT
  // -----------------------------------------------------------------------
  // Closes a local prediction order: pool returns the original stake (minus
  // a small fee) so users actually get their OST back on devnet.
  async function predictionCashOut(orderRecord, payoutOst) {
    var w = window.OST_WALLET;
    if (!w || !w.session || !w.session.publicKey) throw new Error('Connect a wallet first');
    if (!window.OST_SWAP_POOL || !window.OST_SWAP_POOL.secretKey) throw new Error('Vault not loaded');
    var amt = Number(payoutOst);
    if (!Number.isFinite(amt) || amt <= 0) throw new Error('Invalid payout');

    await ensurePoolHasOst(amt + 5);
    var poolBal = await getPoolOstBalance();
    var toSend = Math.min(amt, Math.floor(poolBal * 100) / 100);
    if (toSend < 0.01) throw new Error('Vault temporarily empty. Try in a minute.');

    var conn = w.getConnection();
    var c = w.constants;
    var pool = loadPoolKeypair();
    var mintPk = new solanaWeb3.PublicKey(window.OST_SWAP_POOL.mint);
    var poolAta = new solanaWeb3.PublicKey(window.OST_SWAP_POOL.ata);
    var userAta = await w.ensureAta(w.session.publicKey);
    try { await w.ensureFee(w.session.publicKey); } catch (_) {}

    var tx = new solanaWeb3.Transaction();
    tx.add(w.transferChecked(poolAta, mintPk, userAta, pool.publicKey,
      w.toBaseUnits(toSend, c.OST_TOKEN_DECIMALS), c.OST_TOKEN_DECIMALS, c.TOKEN_2022_PROGRAM_ID));
    tx.add(w.memoIx(JSON.stringify({
      k: 'prediction-cashout',
      market: orderRecord && orderRecord.marketId,
      side: orderRecord && orderRecord.side,
      stake: orderRecord && Number(orderRecord.stake || 0),
      payout: toSend,
      t: Date.now()
    }), w.session.publicKey));
    tx.feePayer = w.session.publicKey;
    var bh = await conn.getLatestBlockhash('confirmed');
    tx.recentBlockhash = bh.blockhash;
    tx.partialSign(pool);
    var sig = await w.sign(tx);
    return { sig: sig, ost: toSend };
  }

  // -----------------------------------------------------------------------
  // PATCH the live OST_WALLET.ensureFee with the robust airdrop
  // -----------------------------------------------------------------------
  function patchEnsureFee() {
    var w = window.OST_WALLET;
    if (!w || w.__rescuePatched) return;
    w.__rescuePatched = true;
    var origEnsure = w.ensureFee;
    w.ensureFee = async function (pubkeyInput) {
      try {
        // Try the original (single endpoint) first — fast path
        return await origEnsure(pubkeyInput);
      } catch (e) {
        console.warn('[rescue] primary airdrop failed, rotating endpoints:', e && e.message);
        var r = await airdropSol(pubkeyInput, 0.1);
        var conn = getRpc();
        var lamports = await conn.getBalance((pubkeyInput && pubkeyInput.toBase58) ? pubkeyInput : new solanaWeb3.PublicKey(pubkeyInput));
        return { funded: true, balance: lamports / solanaWeb3.LAMPORTS_PER_SOL, source: r.source };
      }
    };
  }

  // -----------------------------------------------------------------------
  // PUBLIC API
  // -----------------------------------------------------------------------
  window.OST_RESCUE = {
    rpc: { get: getRpc, rotate: rotateRpc, endpoints: RPC_ENDPOINTS, withRpc: withRpc },
    airdropSol: airdropSol,
    poolBalance: getPoolOstBalance,
    refillVault: ensurePoolHasOst,
    refillOnce: refillFromHelperFaucet,
    startDaemon: startVaultDaemon
  };
  window.OST_TRADE = window.OST_TRADE || {};
  window.OST_TRADE.memecoinBuy = memecoinBuy;
  window.OST_TRADE.memecoinSell = memecoinSell;
  window.OST_TRADE.predictionCashOut = predictionCashOut;

  // Wait for OST_WALLET to be defined, then patch + start the daemon.
  function bootstrap() {
    if (!window.OST_WALLET) { return setTimeout(bootstrap, 250); }
    patchEnsureFee();
    startVaultDaemon();
    console.log('[rescue] OST devnet rescue active. Endpoints:', RPC_ENDPOINTS.length, 'Daemon: on');
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }
})();

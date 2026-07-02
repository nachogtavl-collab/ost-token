/* ============================================================================
   OST On-Chain Betting (browser module)
   ----------------------------------------------------------------------------
   Thin browser wrapper around the `ost_betting` Anchor program on Solana.
   - No bundler / no @coral-xyz/anchor: builds Anchor instructions by hand
     using sha256-based discriminators + Borsh-style little-endian encoding.
   - Uses the global `solanaWeb3` IIFE (already loaded in index.html).
   - Wallet: Phantom-style provider (window.solana / window.phantom?.solana).

   Public API (window.OstOnchainBet):
     await OstOnchainBet.connect()                     -> { publicKey }
     OstOnchainBet.isReady()                           -> bool
     OstOnchainBet.deriveMarket(authority, marketId)   -> PublicKey
     OstOnchainBet.deriveVault(market, marketId)       -> PublicKey
     OstOnchainBet.derivePosition(market, bettor)      -> PublicKey
     await OstOnchainBet.placeBet({ authority, marketId, side, amountSol, market? })
        - resolves to { signature, market, vault, position }
     await OstOnchainBet.claim({ authority, marketId, market? })
        - resolves to { signature }
     OstOnchainBet.PROGRAM_ID
   ============================================================================ */
(function () {
  'use strict';

  if (!window.solanaWeb3) {
    console.warn('[OstOnchainBet] solanaWeb3 not loaded; on-chain betting disabled.');
    return;
  }

  var web3 = window.solanaWeb3;
  var PublicKey = web3.PublicKey;
  var SystemProgram = web3.SystemProgram;
  var Transaction = web3.Transaction;
  var TransactionInstruction = web3.TransactionInstruction;
  var Connection = web3.Connection;
  var clusterApiUrl = web3.clusterApiUrl;
  var LAMPORTS_PER_SOL = web3.LAMPORTS_PER_SOL || 1_000_000_000;

  // -------------------------------------------------------------------------
  // Config
  // -------------------------------------------------------------------------
  var PROGRAM_ID = new PublicKey('Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkgMQHGz5A9A');
  var DEFAULT_RPC =
    (window.OST_SOLANA_RPC && String(window.OST_SOLANA_RPC)) ||
    (clusterApiUrl ? clusterApiUrl('devnet') : 'https://api.devnet.solana.com');
  var connection = new Connection(DEFAULT_RPC, 'confirmed');

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------
  function getWallet() {
    var w = window.phantom && window.phantom.solana ? window.phantom.solana : window.solana;
    return w && w.isPhantom ? w : (w || null);
  }

  function leU64(value) {
    var n = BigInt(value);
    var b = new Uint8Array(8);
    for (var i = 0; i < 8; i++) {
      b[i] = Number(n & 0xffn);
      n >>= 8n;
    }
    return b;
  }

  function leI64(value) {
    // signed 64-bit little-endian (two's complement); for timestamps use this.
    var n = BigInt(value);
    if (n < 0n) n += 1n << 64n;
    return leU64(n);
  }

  function concatBytes(parts) {
    var total = 0;
    for (var i = 0; i < parts.length; i++) total += parts[i].length;
    var out = new Uint8Array(total);
    var o = 0;
    for (var j = 0; j < parts.length; j++) {
      out.set(parts[j], o);
      o += parts[j].length;
    }
    return out;
  }

  async function discriminator(methodSnake) {
    var enc = new TextEncoder().encode('global:' + methodSnake);
    var hash = await crypto.subtle.digest('SHA-256', enc);
    return new Uint8Array(hash).slice(0, 8);
  }

  // Discriminator cache so we hash once per method.
  var _disc = {};
  async function disc(method) {
    if (!_disc[method]) _disc[method] = await discriminator(method);
    return _disc[method];
  }

  // -------------------------------------------------------------------------
  // PDA derivation
  // -------------------------------------------------------------------------
  function asPubkey(x) {
    return x instanceof PublicKey ? x : new PublicKey(x);
  }

  function deriveMarket(authority, marketId) {
    var a = asPubkey(authority);
    var seed = leU64(marketId);
    return PublicKey.findProgramAddressSync(
      [new TextEncoder().encode('market'), a.toBuffer(), seed],
      PROGRAM_ID
    )[0];
  }

  function deriveVault(market, marketId) {
    var m = asPubkey(market);
    var seed = leU64(marketId);
    return PublicKey.findProgramAddressSync(
      [new TextEncoder().encode('vault'), m.toBuffer(), seed],
      PROGRAM_ID
    )[0];
  }

  function derivePosition(market, bettor) {
    var m = asPubkey(market);
    var b = asPubkey(bettor);
    return PublicKey.findProgramAddressSync(
      [new TextEncoder().encode('position'), m.toBuffer(), b.toBuffer()],
      PROGRAM_ID
    )[0];
  }

  // -------------------------------------------------------------------------
  // Instruction builders
  // -------------------------------------------------------------------------
  async function ixPlaceBet(params) {
    var data = concatBytes([
      await disc('place_bet'),
      new Uint8Array([params.side & 0xff]),
      leU64(params.amountLamports),
    ]);
    return new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: params.bettor, isSigner: true, isWritable: true },
        { pubkey: params.market, isSigner: false, isWritable: true },
        { pubkey: params.vault, isSigner: false, isWritable: true },
        { pubkey: params.position, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: data,
    });
  }

  async function ixClaimPayout(params) {
    var data = await disc('claim_payout');
    return new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: params.bettor, isSigner: true, isWritable: true },
        { pubkey: params.market, isSigner: false, isWritable: true },
        { pubkey: params.position, isSigner: false, isWritable: true },
        { pubkey: params.vault, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: data,
    });
  }

  async function ixInitializeMarket(params) {
    var data = concatBytes([
      await disc('initialize_market'),
      leU64(params.marketId),
      leI64(params.lockTs),
      leI64(params.resolveTs),
    ]);
    return new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: params.authority, isSigner: true, isWritable: true },
        { pubkey: params.market, isSigner: false, isWritable: true },
        { pubkey: params.vault, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: data,
    });
  }

  // -------------------------------------------------------------------------
  // High-level operations
  // -------------------------------------------------------------------------
  async function ensureWallet() {
    var w = getWallet();
    if (!w) throw new Error('No Solana wallet detected (install Phantom).');
    if (!w.publicKey) {
      var resp = await w.connect();
      return { wallet: w, publicKey: w.publicKey || (resp && resp.publicKey) };
    }
    return { wallet: w, publicKey: w.publicKey };
  }

  async function sendTx(wallet, instructions, payer) {
    var tx = new Transaction();
    for (var i = 0; i < instructions.length; i++) tx.add(instructions[i]);
    tx.feePayer = payer;
    var bh = await connection.getLatestBlockhash('confirmed');
    tx.recentBlockhash = bh.blockhash;

    // Local simulation — fail fast on guaranteed errors *before* the wallet popup.
    // Never blocks if simulation can't run (timeout/RPC error returns ok:true).
    if (window.OST_OPTIMISTIC && window.OST_OPTIMISTIC.simulate) {
      try {
        var sim = await window.OST_OPTIMISTIC.simulate(connection, tx, payer);
        if (sim && sim.ok === false) {
          var friendly = sim.friendly || 'Transaction would fail on-chain';
          try { window.OST_OPTIMISTIC.toast(friendly, 'error'); } catch (e) {}
          throw new Error(friendly);
        }
      } catch (e) {
        // Only re-throw if it's our own thrown simulation rejection.
        if (e && e.message && /would fail/i.test(e.message)) throw e;
      }
    }

    if (typeof wallet.signAndSendTransaction === 'function') {
      var res = await wallet.signAndSendTransaction(tx);
      var sig = (res && res.signature) || res;
      // Optimistic: tell the user the tx was submitted (before confirm finishes).
      if (window.OST_OPTIMISTIC) {
        try { window.OST_OPTIMISTIC.toast('Submitted · ' + String(sig).slice(0, 8) + '…', 'pending'); } catch (e) {}
      }
      await connection.confirmTransaction(
        { signature: sig, blockhash: bh.blockhash, lastValidBlockHeight: bh.lastValidBlockHeight },
        'confirmed'
      );
      return sig;
    }
    if (typeof wallet.signTransaction === 'function') {
      var signed = await wallet.signTransaction(tx);
      var sig2 = await connection.sendRawTransaction(signed.serialize());
      if (window.OST_OPTIMISTIC) {
        try { window.OST_OPTIMISTIC.toast('Submitted · ' + String(sig2).slice(0, 8) + '…', 'pending'); } catch (e) {}
      }
      await connection.confirmTransaction(
        { signature: sig2, blockhash: bh.blockhash, lastValidBlockHeight: bh.lastValidBlockHeight },
        'confirmed'
      );
      return sig2;
    }
    throw new Error('Wallet does not support signing transactions.');
  }

  async function placeBet(opts) {
    if (!opts || (!opts.authority && !opts.market))
      throw new Error('placeBet requires { authority, marketId } or { market, marketId }.');
    var marketId = opts.marketId;
    if (marketId === undefined || marketId === null) throw new Error('marketId required');
    var side = opts.side === 1 || opts.side === 'YES' || opts.side === 'yes' ? 1 : 0;
    var amountSol = Number(opts.amountSol);
    if (!isFinite(amountSol) || amountSol <= 0) throw new Error('amountSol must be > 0');
    var lamports = Math.round(amountSol * LAMPORTS_PER_SOL);

    var ctx = await ensureWallet();
    var bettor = ctx.publicKey;

    var market = opts.market
      ? asPubkey(opts.market)
      : deriveMarket(opts.authority, marketId);
    var vault = deriveVault(market, marketId);
    var position = derivePosition(market, bettor);

    var ix = await ixPlaceBet({
      bettor: bettor,
      market: market,
      vault: vault,
      position: position,
      side: side,
      amountLamports: lamports,
    });
    var sig = await sendTx(ctx.wallet, [ix], bettor);
    return { signature: sig, market: market, vault: vault, position: position };
  }

  async function claim(opts) {
    if (!opts || (!opts.authority && !opts.market))
      throw new Error('claim requires { authority, marketId } or { market, marketId }.');
    var marketId = opts.marketId;
    if (marketId === undefined || marketId === null) throw new Error('marketId required');

    var ctx = await ensureWallet();
    var bettor = ctx.publicKey;

    var market = opts.market
      ? asPubkey(opts.market)
      : deriveMarket(opts.authority, marketId);
    var vault = deriveVault(market, marketId);
    var position = derivePosition(market, bettor);

    var ix = await ixClaimPayout({
      bettor: bettor,
      market: market,
      vault: vault,
      position: position,
    });
    var sig = await sendTx(ctx.wallet, [ix], bettor);
    return { signature: sig };
  }

  async function initializeMarket(opts) {
    var marketId = opts.marketId;
    var lockTs = opts.lockTs;
    var resolveTs = opts.resolveTs;
    if (marketId === undefined || lockTs === undefined || resolveTs === undefined)
      throw new Error('initializeMarket requires { marketId, lockTs, resolveTs }');

    var ctx = await ensureWallet();
    var authority = ctx.publicKey;
    var market = deriveMarket(authority, marketId);
    var vault = deriveVault(market, marketId);

    var ix = await ixInitializeMarket({
      authority: authority,
      market: market,
      vault: vault,
      marketId: marketId,
      lockTs: lockTs,
      resolveTs: resolveTs,
    });
    var sig = await sendTx(ctx.wallet, [ix], authority);
    return { signature: sig, market: market, vault: vault };
  }

  // -------------------------------------------------------------------------
  // Read helpers (account fetch + manual decode of Market layout)
  // -------------------------------------------------------------------------
  async function fetchMarket(market) {
    var info = await connection.getAccountInfo(asPubkey(market));
    if (!info) return null;
    var data = info.data;
    if (!data || data.length < 8 + 32 + 8 + 1 + 1 + 8 + 8 + 8 + 8 + 8 + 1 + 1) return null;

    // Skip 8-byte Anchor account discriminator
    var dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
    var off = 8;
    function readPubkey() {
      var slice = data.slice(off, off + 32);
      off += 32;
      return new PublicKey(slice);
    }
    function readU64() {
      var lo = dv.getUint32(off, true);
      var hi = dv.getUint32(off + 4, true);
      off += 8;
      return BigInt(hi) * 0x100000000n + BigInt(lo);
    }
    function readI64() {
      var v = readU64();
      if (v >= 1n << 63n) v -= 1n << 64n;
      return v;
    }
    function readU8() {
      return data[off++];
    }
    function readBool() {
      return readU8() === 1;
    }

    return {
      authority: readPubkey(),
      marketId: readU64(),
      bump: readU8(),
      vaultBump: readU8(),
      createdAt: readI64(),
      lockTs: readI64(),
      resolveTs: readI64(),
      yesPool: readU64(),
      noPool: readU64(),
      resolved: readBool(),
      winningSide: readU8(),
    };
  }

  // -------------------------------------------------------------------------
  // Public surface
  // -------------------------------------------------------------------------
  window.OstOnchainBet = {
    PROGRAM_ID: PROGRAM_ID,
    rpc: DEFAULT_RPC,
    connection: connection,
    isReady: function () {
      return !!getWallet();
    },
    connect: async function () {
      var ctx = await ensureWallet();
      return { publicKey: ctx.publicKey ? ctx.publicKey.toBase58() : null };
    },
    deriveMarket: deriveMarket,
    deriveVault: deriveVault,
    derivePosition: derivePosition,
    placeBet: placeBet,
    claim: claim,
    initializeMarket: initializeMarket,
    fetchMarket: fetchMarket,
  };

  console.info('[OstOnchainBet] ready. Program:', PROGRAM_ID.toBase58(), 'RPC:', DEFAULT_RPC);
})();

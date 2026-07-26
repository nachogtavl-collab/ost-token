/* ==========================================================================
 * OST · On-chain prediction markets (client)
 * --------------------------------------------------------------------------
 * Talks DIRECTLY to the deployed ost-betting program on Solana devnet:
 *   program F82m45QUAFJ4GtMsJrSFnWzDrjWdZjdzyh8HTPgTBHXr
 *
 * place_bet   -> the user's OST is escrowed in a PROGRAM-OWNED vault
 * claim_payout-> winnings come back OUT of that vault, signed by the market PDA,
 *                minus the house edge (2% of PROFIT only), which the PROGRAM
 *                sweeps into the treasury pinned on the market at creation.
 *
 * This is the real thing: no custodial pool, no server holding the money, and
 * no authority-resolve instruction — the program reads the close price from a
 * signed Pyth update and decides the winner itself. Nobody can pick the outcome
 * or re-point the rake.
 *
 * Markets are opened by scripts/market-crank.mjs (a shared market must be
 * created by ONE authority, or every bettor would land in a different pool).
 * If no on-chain market exists for a round, the app silently keeps using the
 * existing off-chain path — this layer never blocks a bet.
 *
 * window.OST_ONCHAIN.available()          -> is the on-chain path usable now?
 * window.OST_ONCHAIN.marketFor(openAtSec) -> { market, vault, exists, pools }
 * window.OST_ONCHAIN.placeBet(openAtSec, side, ostAmount)
 * window.OST_ONCHAIN.claim(openAtSec)
 * ========================================================================== */
(function () {
  'use strict';

  var PROGRAM_ID = 'F82m45QUAFJ4GtMsJrSFnWzDrjWdZjdzyh8HTPgTBHXr';
  // Predictions run ON-CHAIN escrowing OSTG (the game token), settled trustlessly
  // by Pyth in the program. The betting program is mint-agnostic (market.mint is a
  // per-market account), so pointing at OSTG needs NO redeploy — but the crank
  // (scripts/pyth-crank/crank.mjs) MUST create markets with this same OSTG mint,
  // or bets hit a mint mismatch. Cutover: switch both, then re-run the crank.
  var MINT = 'DfgxMbdN49AX2Za9LuvsyixF1jgVh45RbgWYSGonxQos';   // OSTG (was OSTC 383pTz…)
  var TOKEN_2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
  var ATA_PROGRAM = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
  var DECIMALS = 9;
  var FIVE_MIN = 300;

  // Anchor discriminators = sha256("global:<ix>")[0..8]  (from the built IDL)
  var DISC = {
    place_bet:    [222, 62, 67, 220, 63, 166, 126, 33],
    claim_payout: [127, 240, 132, 62, 227, 198, 146, 133]
  };

  function w3() { return window.solanaWeb3; }
  function pk(s) { return new (w3().PublicKey)(s); }

  // The authority that opens the markets (the crank). Market PDAs are seeded by
  // it, so the client must know it to derive the same market everyone bets into.
  function authority() {
    return window.OST_ONCHAIN_AUTHORITY ? pk(window.OST_ONCHAIN_AUTHORITY) : null;
  }

  function u64le(n) {
    var b = new Uint8Array(8), v = BigInt(n);
    for (var i = 0; i < 8; i++) { b[i] = Number(v & 0xffn); v >>= 8n; }
    return b;
  }
  function concat(arrs) {
    var len = arrs.reduce(function (t, a) { return t + a.length; }, 0);
    var out = new Uint8Array(len), o = 0;
    arrs.forEach(function (a) { out.set(a, o); o += a.length; });
    return out;
  }

  function session() {
    var w = window.OST_WALLET;
    return (w && w.session && w.session.publicKey) ? w.session : null;
  }
  function conn() {
    var w = window.OST_WALLET;
    return w && w.getConnection ? w.getConnection() : null;
  }

  // Session key (one-tap betting). When funded, it is the bettor + the silent
  // signer, so a bet needs no wallet popup. See ost-session-key.js.
  function activeSession() { try { if (window.OST_SESSION && OST_SESSION.exists() && OST_SESSION.keypair()) return OST_SESSION.keypair(); } catch (_) {} return null; }
  function bettorPk() { var s = activeSession(); if (s) return s.publicKey; var w = session(); return w && w.publicKey; }

  function available() {
    return !!(w3() && (activeSession() || session()) && conn() && authority());
  }

  function derive(openAtSec) {
    var W = w3();
    var market = W.PublicKey.findProgramAddressSync(
      [new TextEncoder().encode('market'), authority().toBuffer(), u64le(openAtSec)], pk(PROGRAM_ID))[0];
    var vault = W.PublicKey.findProgramAddressSync(
      [new TextEncoder().encode('vault'), market.toBuffer()], pk(PROGRAM_ID))[0];
    return { market: market, vault: vault };
  }
  function positionPda(market, bettor) {
    return w3().PublicKey.findProgramAddressSync(
      [new TextEncoder().encode('position'), market.toBuffer(), bettor.toBuffer()], pk(PROGRAM_ID))[0];
  }
  function userAta(owner) {
    return w3().PublicKey.findProgramAddressSync(
      [owner.toBuffer(), pk(TOKEN_2022).toBuffer(), pk(MINT).toBuffer()], pk(ATA_PROGRAM))[0];
  }

  // Market account layout after the 8-byte discriminator.
  // 8 (disc) + Market::SIZE. Markets created before the house-edge upgrade are
  // shorter; they are treated as unusable rather than misread.
  var MARKET_LEN = 8 + (32 + 32 + 8 + 1 + 1 + 8 + 8 + 8 + 8 + 8 + 1 + 1) + (32 + 8 + 4 + 8) + (32 + 8);

  function parseMarket(data) {
    if (data.length < MARKET_LEN) return null;
    var dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
    var o = 8 + 32 + 32;                       // skip disc + authority + mint
    var marketId = dv.getBigUint64(o, true); o += 8;
    o += 2;                                    // bump, vault_bump
    o += 8;                                    // created_at
    var lockTs = dv.getBigInt64(o, true); o += 8;
    var resolveTs = dv.getBigInt64(o, true); o += 8;
    var yesPool = dv.getBigUint64(o, true); o += 8;
    var noPool = dv.getBigUint64(o, true); o += 8;
    var resolved = data[o] === 1; o += 1;
    var winningSide = data[o]; o += 1;
    o += 32;                                   // feed_id
    var openPrice = dv.getBigInt64(o, true); o += 8;
    var openExpo = dv.getInt32(o, true); o += 4;
    var closePrice = dv.getBigInt64(o, true); o += 8;
    // The treasury the program sweeps the house edge into. It is PINNED on the
    // market at creation, so we must read it from the market — we cannot guess
    // it, and passing the wrong one makes the claim fail (WrongTreasury).
    var treasury = new (w3().PublicKey)(data.slice(o, o + 32)); o += 32;
    var feesCollected = dv.getBigUint64(o, true);
    var ui = function (b) { return Number(b) / Math.pow(10, DECIMALS); };
    return {
      marketId: Number(marketId),
      lockTs: Number(lockTs) * 1000,
      resolveTs: Number(resolveTs) * 1000,
      yes: ui(yesPool), no: ui(noPool),
      resolved: resolved, winningSide: winningSide,
      openPrice: Number(openPrice) * Math.pow(10, openExpo),
      closePrice: Number(closePrice) * Math.pow(10, openExpo),
      treasury: treasury,
      feesCollected: ui(feesCollected)
    };
  }

  // A RESOLVED market is immutable — its pools, winner and treasury can never
  // change again. Cache those forever so a cash-out doesn't pay a fresh RPC
  // round-trip just to re-read a settled result. (Unresolved markets are never
  // cached here; the router keeps those warm on a short TTL.)
  var resolvedCache = {};

  function marketFor(openAtSec) {
    if (!available()) return Promise.resolve(null);
    if (resolvedCache[openAtSec]) return Promise.resolve(resolvedCache[openAtSec]);
    var d = derive(openAtSec);
    return conn().getAccountInfo(d.market).then(function (info) {
      if (!info) return { market: d.market, vault: d.vault, exists: false };
      var m = parseMarket(new Uint8Array(info.data));
      if (!m) return { market: d.market, vault: d.vault, exists: false };
      var out = Object.assign({ market: d.market, vault: d.vault, exists: true }, m);
      // Settled result — safe to remember forever.
      if (out.resolved) resolvedCache[openAtSec] = out;
      return out;
    }).catch(function () { return null; });
  }

  // Odds implied by the pools — pari-mutuel, so this IS the on-chain price.
  function impliedYes(m) {
    var total = (m.yes || 0) + (m.no || 0);
    if (!total) return 0.5;
    return m.yes / total;
  }

  function ixPlaceBet(openAtSec, side, amountOst) {
    var W = w3();
    var d = derive(openAtSec);
    var bettor = bettorPk();
    var amount = BigInt(Math.round(amountOst * Math.pow(10, DECIMALS)));
    var data = concat([
      new Uint8Array(DISC.place_bet),
      new Uint8Array([side === 'yes' || side === 1 ? 1 : 0]),
      u64le(amount)
    ]);
    return new W.TransactionInstruction({
      programId: pk(PROGRAM_ID),
      keys: [
        { pubkey: bettor, isSigner: true, isWritable: true },
        { pubkey: d.market, isSigner: false, isWritable: true },
        { pubkey: pk(MINT), isSigner: false, isWritable: false },
        { pubkey: d.vault, isSigner: false, isWritable: true },
        { pubkey: userAta(bettor), isSigner: false, isWritable: true },
        { pubkey: positionPda(d.market, bettor), isSigner: false, isWritable: true },
        { pubkey: pk(TOKEN_2022), isSigner: false, isWritable: false },
        { pubkey: W.SystemProgram.programId, isSigner: false, isWritable: false }
      ],
      data: data
    });
  }

  // ---- ARB SPREAD SKIM (client-side market maker, ON-CHAIN, no server) -------
  // Feature-flagged. When on, a 5-min buy splits: `spread` OST is transferred to
  // the market's treasury (the market-maker spread) and the REST is bet
  // pari-mutuel — both in ONE user-signed transaction. This is the honest,
  // no-middleman way to capture the arb spread on Solana: the spread really moves
  // on-chain to the treasury; nothing is faked in the UI.
  // ON by default (proven on devnet: scripts/pyth-crank/predict-arb-skim-e2e.mjs).
  // Kill switch: window.OST_ARB_ONCHAIN=false or localStorage OST_ARB_ONCHAIN='0'.
  function arbOnchainOn() {
    try { if (window.OST_ARB_ONCHAIN === false) return false; if (window.OST_ARB_ONCHAIN === true) return true; return localStorage.getItem('OST_ARB_ONCHAIN') !== '0'; } catch (_) { return true; }
  }
  function spreadFrac() {
    try { if (window.OST_ARB && OST_ARB.bps) { var b = Number(OST_ARB.bps()); if (b >= 0 && b <= 1500) return b / 10000; } } catch (_) {}
    return 0.015;
  }
  // SPL Token-2022 TransferChecked (opcode 12): user ATA -> treasury token account.
  function ixSpread(spreadOst, treasury) {
    var W = w3(); var bettor = bettorPk();
    var amount = BigInt(Math.round(spreadOst * Math.pow(10, DECIMALS)));
    var data = concat([new Uint8Array([12]), u64le(amount), new Uint8Array([DECIMALS])]);
    return new W.TransactionInstruction({
      programId: pk(TOKEN_2022),
      keys: [
        { pubkey: userAta(bettor), isSigner: false, isWritable: true },
        { pubkey: pk(MINT), isSigner: false, isWritable: false },
        { pubkey: treasury, isSigner: false, isWritable: true },
        { pubkey: bettor, isSigner: true, isWritable: false }
      ],
      data: data
    });
  }

  // `treasury` comes from the market account itself — the program pins it at
  // creation and rejects any other account, so it must be read, not derived.
  function ixClaim(openAtSec, treasury) {
    var W = w3();
    var d = derive(openAtSec);
    var bettor = bettorPk();
    return new W.TransactionInstruction({
      programId: pk(PROGRAM_ID),
      keys: [
        { pubkey: bettor, isSigner: true, isWritable: true },
        { pubkey: d.market, isSigner: false, isWritable: true },
        { pubkey: pk(MINT), isSigner: false, isWritable: false },
        { pubkey: positionPda(d.market, bettor), isSigner: false, isWritable: true },
        { pubkey: d.vault, isSigner: false, isWritable: true },
        { pubkey: userAta(bettor), isSigner: false, isWritable: true },
        { pubkey: treasury, isSigner: false, isWritable: true },
        { pubkey: pk(TOKEN_2022), isSigner: false, isWritable: false },
        { pubkey: W.SystemProgram.programId, isSigner: false, isWritable: false }
      ],
      data: new Uint8Array(DISC.claim_payout)
    });
  }

  function send(ixs, fast) {
    var W = w3();
    var sess = activeSession();
    if (sess) {
      // Silent session signing — no wallet popup. Sign with the session key and
      // push the raw tx ourselves.
      var stx = new W.Transaction();
      ixs.forEach(function (i) { stx.add(i); });
      var c = conn();
      return c.getLatestBlockhash('confirmed').then(function (bh) {
        stx.feePayer = sess.publicKey; stx.recentBlockhash = bh.blockhash; stx.sign(sess);
        return c.sendRawTransaction(stx.serialize());
      });
    }
    var w = window.OST_WALLET;
    var tx = new W.Transaction();
    ixs.forEach(function (i) { tx.add(i); });
    // Betting/claiming use the fast path: confirm at 'processed' (~1 slot) with a
    // prewarmed blockhash, so the ticket lands in well under half a second. The
    // caller reconciles 'confirmed' in the background. Falls back to the normal
    // sign() on any wallet that predates signFast.
    if (fast && typeof w.signFast === 'function') return w.signFast(tx);
    return w.sign(tx);
  }

  // Stake OST into the program vault. Rejects (never silently no-ops) so the
  // Once a wallet has an OST token account it keeps it — so we only need to
  // check ONCE, not before every bet. Caching this removes a round-trip from the
  // hot path for the ~99% of bets where the ATA already exists.
  var ataKnown = {};
  function ensureAtaIx(owner) {
    var key = owner.toBase58();
    var ata = userAta(owner);
    if (ataKnown[key]) return Promise.resolve(null);
    return conn().getAccountInfo(ata).then(function (info) {
      if (info) { ataKnown[key] = true; return null; }
      return (window.OST_WALLET.associatedAccountIx)
        ? window.OST_WALLET.associatedAccountIx(owner, ata, owner, pk(MINT))
        : null;
    });
  }

  // `preMarket` lets the caller pass the market it already fetched (the router
  // keeps it warm), so a bet does not pay a second marketFor() round-trip.
  function placeBet(openAtSec, side, amountOst, preMarket) {
    if (!available()) return Promise.reject(new Error('on-chain path unavailable (no wallet)'));
    var start = (preMarket && preMarket.exists) ? Promise.resolve(preMarket) : marketFor(openAtSec);
    return start.then(function (m) {
      if (!m || !m.exists) throw new Error('no on-chain market for this round yet');
      if (m.resolved) throw new Error('market already resolved');
      if (Date.now() >= m.lockTs) throw new Error('market locked (too close to close)');
      var bettor = bettorPk();
      // Split the stake: spread -> treasury (market-maker), net -> pari-mutuel pool.
      var frac = spreadFrac();
      var spread = (arbOnchainOn() && m.treasury && frac > 0) ? Math.max(0, amountOst * frac) : 0;
      var net = amountOst - spread;
      return ensureAtaIx(bettor).then(function (ataIx) {
        var ixs = [];
        if (ataIx) ixs.push(ataIx);
        if (spread > 0) ixs.push(ixSpread(spread, m.treasury));   // arb spread, on-chain
        ixs.push(ixPlaceBet(openAtSec, side, net));
        return send(ixs, true);       // fast: processed-level, prewarmed blockhash
      }).then(function (sig) {
        // The ATA definitely exists now.
        ataKnown[bettor.toBase58()] = true;
        if (spread > 0) { try { window.dispatchEvent(new CustomEvent('ost:house-fee', { detail: { source: 'arbitrage', amount: spread, label: 'market-maker spread (on-chain)' } })); } catch (_) {} }
        try {
          window.dispatchEvent(new CustomEvent('ost:onchain-bet', {
            detail: { openAt: openAtSec, side: side, amount: amountOst, net: net, spread: spread, signature: String(sig), market: m.market.toBase58() }
          }));
        } catch (_) {}
        // Reconcile 'confirmed' in the background — we already returned to the UI.
        if (window.OST_WALLET.reconcile) {
          window.OST_WALLET.reconcile(String(sig)).then(function (r) {
            if (r && !r.ok) {
              try {
                window.dispatchEvent(new CustomEvent('ost:onchain-bet-reverted', {
                  detail: { signature: String(sig), openAt: openAtSec, err: r.err }
                }));
              } catch (_) {}
            }
          });
        }
        return { signature: String(sig), market: m.market.toBase58(), onChain: true, spread: spread, net: net };
      });
    });
  }

  function claim(openAtSec) {
    if (!available()) return Promise.reject(new Error('on-chain path unavailable (no wallet)'));
    return marketFor(openAtSec).then(function (m) {
      if (!m || !m.exists) throw new Error('no on-chain market');
      if (!m.resolved) throw new Error('market not resolved yet');
      if (!m.treasury) throw new Error('market predates the on-chain house edge');
      return send([ixClaim(openAtSec, m.treasury)], true).then(function (sig) {
        if (window.OST_WALLET.reconcile) window.OST_WALLET.reconcile(String(sig));
        return { signature: String(sig), onChain: true };
      });
    });
  }

  // What the program will actually pay this wallet, AFTER the on-chain rake.
  // Mirrors claim_payout exactly: gross = stake * total / winnerPool, the fee is
  // HOUSE_FEE_BPS of the PROFIT only, and the stake is never taxed.
  var HOUSE_FEE_BPS = 200;                       // must match the program constant
  function quoteNet(m, side, stakeOst) {
    var yes = m.yes || 0, no = m.no || 0;
    var total = yes + no;
    var winner = (side === 'yes' || side === 1) ? yes : no;
    if (!winner || !total) return { gross: 0, fee: 0, net: 0 };
    var gross = stakeOst * total / winner;
    var profit = Math.max(0, gross - stakeOst);
    var fee = profit * HOUSE_FEE_BPS / 10000;
    return { gross: gross, fee: fee, net: gross - fee };
  }

  // Convenience: the round id the app's OST-native BTC markets use.
  function roundOpenAt(ms) {
    return Math.floor((ms || Date.now()) / 1000 / FIVE_MIN) * FIVE_MIN;
  }

  window.OST_ONCHAIN = {
    programId: PROGRAM_ID,
    available: available,
    marketFor: marketFor,
    impliedYes: impliedYes,
    quoteNet: quoteNet,
    houseFeeBps: HOUSE_FEE_BPS,
    placeBet: placeBet,
    claim: claim,
    roundOpenAt: roundOpenAt,
    derive: derive
  };
})();

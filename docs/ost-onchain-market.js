/* ==========================================================================
 * OST · On-chain prediction markets (client)
 * --------------------------------------------------------------------------
 * Talks DIRECTLY to the deployed ost-betting program on Solana devnet:
 *   program F82m45QUAFJ4GtMsJrSFnWzDrjWdZjdzyh8HTPgTBHXr
 *
 * place_bet   -> the user's OST is escrowed in a PROGRAM-OWNED vault
 * claim_payout-> winnings come back OUT of that vault, signed by the market PDA
 *
 * This is the real thing: no custodial pool, no server holding the money. The
 * only trusted step left is `resolve_market` (authority-signed by the crank) —
 * making that trustless means verifying a Pyth update inside the program.
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
  var MINT = '383pTzoZ8Gp83dzk23ZnvLcfX2Sq32TAGN48CMQu2pAJ';
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

  function available() {
    return !!(w3() && session() && conn() && authority());
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
  function parseMarket(data) {
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
    var winningSide = data[o];
    var ui = function (b) { return Number(b) / Math.pow(10, DECIMALS); };
    return {
      marketId: Number(marketId),
      lockTs: Number(lockTs) * 1000,
      resolveTs: Number(resolveTs) * 1000,
      yes: ui(yesPool), no: ui(noPool),
      resolved: resolved, winningSide: winningSide
    };
  }

  function marketFor(openAtSec) {
    if (!available()) return Promise.resolve(null);
    var d = derive(openAtSec);
    return conn().getAccountInfo(d.market).then(function (info) {
      if (!info) return { market: d.market, vault: d.vault, exists: false };
      var m = parseMarket(new Uint8Array(info.data));
      return Object.assign({ market: d.market, vault: d.vault, exists: true }, m);
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
    var s = session();
    var d = derive(openAtSec);
    var bettor = s.publicKey;
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

  function ixClaim(openAtSec) {
    var W = w3();
    var s = session();
    var d = derive(openAtSec);
    var bettor = s.publicKey;
    return new W.TransactionInstruction({
      programId: pk(PROGRAM_ID),
      keys: [
        { pubkey: bettor, isSigner: true, isWritable: true },
        { pubkey: d.market, isSigner: false, isWritable: true },
        { pubkey: pk(MINT), isSigner: false, isWritable: false },
        { pubkey: positionPda(d.market, bettor), isSigner: false, isWritable: true },
        { pubkey: d.vault, isSigner: false, isWritable: true },
        { pubkey: userAta(bettor), isSigner: false, isWritable: true },
        { pubkey: pk(TOKEN_2022), isSigner: false, isWritable: false },
        { pubkey: W.SystemProgram.programId, isSigner: false, isWritable: false }
      ],
      data: new Uint8Array(DISC.claim_payout)
    });
  }

  function send(ixs) {
    var W = w3();
    var w = window.OST_WALLET;
    var tx = new W.Transaction();
    ixs.forEach(function (i) { tx.add(i); });
    return w.sign(tx);            // app's signAndSendTransaction (local wallet or adapter)
  }

  // Stake OST into the program vault. Rejects (never silently no-ops) so the
  // caller can fall back to the off-chain path with a real reason.
  function placeBet(openAtSec, side, amountOst) {
    if (!available()) return Promise.reject(new Error('on-chain path unavailable (no wallet)'));
    return marketFor(openAtSec).then(function (m) {
      if (!m || !m.exists) throw new Error('no on-chain market for this round yet');
      if (m.resolved) throw new Error('market already resolved');
      if (Date.now() >= m.lockTs) throw new Error('market locked (too close to close)');
      var s = session();
      var ixs = [];
      // Make sure the bettor has an OST token account.
      var ata = userAta(s.publicKey);
      return conn().getAccountInfo(ata).then(function (info) {
        if (!info && window.OST_WALLET.associatedAccountIx) {
          ixs.push(window.OST_WALLET.associatedAccountIx(s.publicKey, ata, s.publicKey, pk(MINT)));
        }
        ixs.push(ixPlaceBet(openAtSec, side, amountOst));
        return send(ixs);
      }).then(function (sig) {
        try {
          window.dispatchEvent(new CustomEvent('ost:onchain-bet', {
            detail: { openAt: openAtSec, side: side, amount: amountOst, signature: String(sig), market: m.market.toBase58() }
          }));
        } catch (_) {}
        return { signature: String(sig), market: m.market.toBase58(), onChain: true };
      });
    });
  }

  function claim(openAtSec) {
    if (!available()) return Promise.reject(new Error('on-chain path unavailable (no wallet)'));
    return marketFor(openAtSec).then(function (m) {
      if (!m || !m.exists) throw new Error('no on-chain market');
      if (!m.resolved) throw new Error('market not resolved yet');
      return send([ixClaim(openAtSec)]).then(function (sig) {
        return { signature: String(sig), onChain: true };
      });
    });
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
    placeBet: placeBet,
    claim: claim,
    roundOpenAt: roundOpenAt,
    derive: derive
  };
})();

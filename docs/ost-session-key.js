/* ==========================================================================
 * OST · Session key — one-tap 5-min betting with a hard spend cap
 * --------------------------------------------------------------------------
 * Proven on devnet: scripts/pyth-crank/predict-sessionkey-e2e.mjs
 *
 * The user pre-funds an ephemeral SESSION keypair ONCE (one wallet signature).
 * That funded amount is the SPEND CAP — the only OSTG ever at risk. After that,
 * 5-min bets are signed by the session key silently (no popup per bet), routed
 * on-chain by OST_ONCHAIN. "End session" sweeps the leftover back to the wallet.
 *
 * Opt-in by nature: nothing exists until the user funds a session. The secret
 * lives in localStorage — acceptable ONLY because it is devnet and capped.
 * window.OST_SESSION.{ exists, keypair, pubkey, balance, cap, fund, end, refresh }
 * ========================================================================== */
(function () {
  'use strict';
  if (window.OST_SESSION) return;

  var MINT = 'DfgxMbdN49AX2Za9LuvsyixF1jgVh45RbgWYSGonxQos';
  var TOKEN_2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
  var ATA_PROGRAM = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
  var DEC = 9;
  var KEY = 'ost.session.key.v1';           // { secret:[...], cap:number, at:number }
  var FUND_SOL = 0.03;                        // gas float for the session

  function w3() { return window.solanaWeb3; }
  function pk(s) { return new (w3().PublicKey)(s); }
  function conn() { var w = window.OST_WALLET; return w && w.getConnection ? w.getConnection() : null; }
  function userPk() { var w = window.OST_WALLET; return (w && w.session && w.session.publicKey) ? w.session.publicKey : null; }
  function ataOf(owner) { return w3().PublicKey.findProgramAddressSync([owner.toBuffer(), pk(TOKEN_2022).toBuffer(), pk(MINT).toBuffer()], pk(ATA_PROGRAM))[0]; }
  function emit() { try { window.dispatchEvent(new CustomEvent('ost:session:change', { detail: { pubkey: pubkey() && pubkey().toBase58(), balance: cachedBal, cap: meta && meta.cap } })); } catch (_) {} }

  var kp = null, meta = null, cachedBal;

  function load() {
    if (kp) return kp;
    try { var raw = JSON.parse(localStorage.getItem(KEY) || 'null'); if (raw && raw.secret) { kp = w3().Keypair.fromSecretKey(Uint8Array.from(raw.secret)); meta = raw; } } catch (_) {}
    return kp;
  }
  function gen() { kp = w3().Keypair.generate(); meta = { secret: Array.from(kp.secretKey), cap: 0, at: Date.now() }; save(); return kp; }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(meta)); } catch (_) {} }
  function keypair() { return load(); }
  function pubkey() { var k = load(); return k ? k.publicKey : null; }
  function exists() { return !!load(); }
  function cap() { return (meta && meta.cap) || 0; }
  function balance() { return cachedBal; }

  // SPL Token-2022 TransferChecked (opcode 12).
  function transferCheckedIx(source, dest, owner, amountUi) {
    var W = w3(); var amt = BigInt(Math.round(amountUi * Math.pow(10, DEC)));
    var d = new Uint8Array(10); d[0] = 12; var v = amt; for (var i = 0; i < 8; i++) { d[1 + i] = Number(v & 0xffn); v >>= 8n; } d[9] = DEC;
    return new W.TransactionInstruction({
      programId: pk(TOKEN_2022),
      keys: [
        { pubkey: source, isSigner: false, isWritable: true },
        { pubkey: pk(MINT), isSigner: false, isWritable: false },
        { pubkey: dest, isSigner: false, isWritable: true },
        { pubkey: owner, isSigner: true, isWritable: false }
      ],
      data: d
    });
  }

  async function refresh() {
    var k = load(); if (!k || !conn()) { cachedBal = undefined; return cachedBal; }
    try { var r = await conn().getTokenAccountBalance(ataOf(k.publicKey)); cachedBal = Number(r.value.uiAmount) || 0; }
    catch (_) { cachedBal = 0; }
    emit(); return cachedBal;
  }

  // ONE user signature: SOL float + OSTG (the spend cap) -> the session key.
  async function fund(amountUi) {
    var W = w3(); var u = userPk();
    if (!u) throw new Error('Connect a wallet first.');
    if (!(amountUi > 0)) throw new Error('Enter an amount.');
    var k = load() || gen();
    var uAta = ataOf(u), sAta = ataOf(k.publicKey);
    var tx = new W.Transaction();
    tx.add(W.SystemProgram.transfer({ fromPubkey: u, toPubkey: k.publicKey, lamports: Math.round(FUND_SOL * 1e9) }));
    var need = false; try { need = !(await conn().getAccountInfo(sAta)); } catch (_) { need = true; }
    if (need && window.OST_WALLET.associatedAccountIx) { var ix = window.OST_WALLET.associatedAccountIx(k.publicKey, sAta, u, pk(MINT)); if (ix) tx.add(ix); }
    tx.add(transferCheckedIx(uAta, sAta, u, amountUi));
    await window.OST_WALLET.sign(tx);                 // the single user signature
    meta.cap = (meta.cap || 0) + amountUi; meta.at = Date.now(); save();
    await refresh();
    return { ok: true, cap: meta.cap };
  }

  async function sendSession(tx) {
    var c = conn(), k = load();
    tx.feePayer = k.publicKey;
    tx.recentBlockhash = (await c.getLatestBlockhash('confirmed')).blockhash;
    tx.sign(k);
    var sig = await c.sendRawTransaction(tx.serialize());
    try { await c.confirmTransaction(sig, 'confirmed'); } catch (_) {}
    return sig;
  }

  // Sweep the session's OSTG back to the wallet and clear the cap (SOL float
  // stays on the session key for any pending claims; it is dust).
  async function end() {
    var W = w3(); var k = load(); if (!k) return { ok: true };
    var u = userPk(); if (!u) throw new Error('Connect a wallet to sweep back.');
    var bal = await refresh();
    if (bal > 0) {
      var tx = new W.Transaction();
      tx.add(transferCheckedIx(ataOf(k.publicKey), ataOf(u), k.publicKey, bal));
      await sendSession(tx);
    }
    meta.cap = 0; save(); await refresh();
    return { ok: true };
  }

  window.OST_SESSION = { exists: exists, keypair: keypair, pubkey: pubkey, balance: balance, cap: cap, fund: fund, end: end, refresh: refresh };
  // Warm the cached balance if a session already exists.
  if (exists()) setTimeout(function () { try { refresh(); } catch (_) {} }, 1500);
})();

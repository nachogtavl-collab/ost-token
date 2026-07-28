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
  function userPk() {
    var w = window.OST_WALLET;
    if (w && w.session && w.session.publicKey) return w.session.publicKey;
    try { if (w && w.pubkey && w.pubkey()) return pk(w.pubkey()); } catch (_) {}   // fall back to the canonical mirror
    return null;
  }
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

  var cachedWallet;   // last-known WALLET OSTG (the unified spendable base)
  // SINGLE attempt — retry loops here amplify the request storm under a 429.
  // The last-known cache (below) already prevents a false zero on a miss.
  async function readOstg(owner) {
    if (!owner || !conn()) return null;
    try { var r = await conn().getTokenAccountBalance(ataOf(owner)); var v = Number(r.value.uiAmount); if (isFinite(v)) return v; } catch (_) {}
    return null;                       // unknown — keep last-known, never a false zero
  }
  // Refresh both balances. LAST-KNOWN semantics: a failed read keeps the old
  // value instead of showing 0/disconnected (the #2 "disconnections" fix).
  async function refresh() {
    var k = load();
    var s = k ? await readOstg(k.publicKey) : 0; if (s != null) cachedBal = s; else if (cachedBal == null) cachedBal = undefined;
    var u = userPk(); if (u) { var w = await readOstg(u); if (w != null) cachedWallet = w; }
    emit(); return cachedBal;
  }
  // The unified spendable = wallet OSTG + whatever is parked in the session key.
  function spendable() { if (cachedWallet == null && cachedBal == null) return undefined; return (cachedWallet || 0) + (cachedBal || 0); }
  function walletBalance() { return cachedWallet; }

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

  // ---- AUTO-ARM: the moment a wallet is sensed, arm a session automatically ----
  // No manual "Enable" tap. On a local browser wallet this is fully silent (it
  // signs with the stored key); on an external wallet it is the single fund
  // signature. Modest auto-cap, only if the wallet can cover gas. Once per load
  // and never if the user explicitly ended a session this session.
  var AUTO_CAP = 25, MIN_CAP = 5, MIN_SOL = 0.05;
  var autoArmedOnce = false, userEnded = false;
  // Balance reads gate auto-arm, so a single RPC 429 must not falsely report 0.
  // Retry a few times, and prefer the wallet's own OSTG helper when present.
  async function retry(fn, n) { for (var i = 0; i < n; i++) { try { var v = await fn(); if (v != null && !Number.isNaN(v)) return v; } catch (_) {} await new Promise(function (r) { setTimeout(r, 700); }); } return null; }
  async function walletOstg() {
    var u = userPk(); if (!u || !conn()) return 0;
    var v = await retry(async function () {
      if (window.OST_WALLET && OST_WALLET.getOstBalance) { var b = await OST_WALLET.getOstBalance(u.toBase58()); if (b != null) return Number(b); }
      var r = await conn().getTokenAccountBalance(ataOf(u)); return Number(r.value.uiAmount);
    }, 1);
    return v || 0;
  }
  async function walletSol() { var u = userPk(); if (!u || !conn()) return 0; var v = await retry(async function () { return (await conn().getBalance(u)) / 1e9; }, 4); return v || 0; }
  function onchainReady() { try { return !!(w3() && window.OST_ONCHAIN && OST_ONCHAIN.available && OST_ONCHAIN.available()); } catch (_) { return false; } }
  async function autoArm() {
    if (autoArmedOnce || userEnded || !userPk() || !onchainReady()) return;
    if (exists()) { await refresh(); if (cachedBal > 0) { autoArmedOnce = true; return; } }   // already armed
    if ((await walletSol()) < MIN_SOL) return;                 // can't cover gas — leave it
    var cap = Math.min(AUTO_CAP, Math.floor(await walletOstg()));
    if (!(cap >= MIN_CAP)) return;                             // too little OSTG to bother
    autoArmedOnce = true;
    try { await fund(cap); } catch (_) { autoArmedOnce = false; }
  }

  window.OST_SESSION = { exists: exists, keypair: keypair, pubkey: pubkey, balance: balance, spendable: spendable, walletBalance: walletBalance, cap: cap, fund: fund, end: end, refresh: refresh, autoArm: autoArm };
  // Sweeping = an explicit "off" for this page load, so we don't re-arm behind
  // the user's back after they end a session.
  var _end = end; end = function () { userEnded = true; return _end.apply(null, arguments); };
  window.OST_SESSION.end = end;

  if (exists()) setTimeout(function () { try { refresh(); } catch (_) {} }, 1500);
  // DETERMINISTIC 1-TAP DETECTION. OST_WALLET.onReady REPLAYS immediately if a
  // wallet is already connected, so 1-tap arms the exact instant the wallet core
  // is ready — killing the old blind-timeout race where autoArm ran before
  // OST_WALLET.session existed and quietly gave up ("1-tap won't detect wallet").
  function armSoon() { if (!userEnded && !document.hidden) setTimeout(autoArm, 800); }
  (function hookReady(n) {
    if (window.OST_WALLET && typeof window.OST_WALLET.onReady === 'function') { window.OST_WALLET.onReady(armSoon); return; }
    if (n > 40) return; setTimeout(function () { hookReady(n + 1); }, 150);   // OST_WALLET may define after us
  })(0);
  // Legacy + V2 events and provider account-switches also (re)arm; idempotent.
  window.addEventListener('ost:wallet-changed', armSoon);
  window.addEventListener('ost:wallet-ready', armSoon);
  window.addEventListener('ost:wallet-connected', armSoon);
  // Backstop poll so a transient 429 on the balance read doesn't leave it unarmed.
  var _armTries = 0;
  var _armIv = setInterval(function () {
    if (userEnded || _armTries++ > 3 || document.hidden) { if (_armTries > 3) clearInterval(_armIv); return; }
    if (exists() && cachedBal > 0) { clearInterval(_armIv); return; }
    if (userPk()) autoArm();
  }, 30000);
})();

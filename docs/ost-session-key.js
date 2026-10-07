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
 * Opt-in by nature: nothing exists until the user funds a session, and funding
 * is always a tap on an amount the user chose (fund(amount, {consent:true}),
 * capped at MAX_FUND). The secret lives in localStorage — acceptable ONLY
 * because it is devnet and capped.
 * window.OST_SESSION.{ exists, keypair, pubkey, balance, cap, status, fund, end, refresh, offer, limits }
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
    // A key whose funding was interrupted (tab closed mid-sign): recover it so
    // anything that did land can still be swept back with End.
    if (!kp) { try { var pend = JSON.parse(localStorage.getItem(KEY + '.pending') || 'null'); if (pend && pend.secret) { kp = w3().Keypair.fromSecretKey(Uint8Array.from(pend.secret)); meta = pend; save(); localStorage.removeItem(KEY + '.pending'); } } catch (_) {} }
    return kp;
  }
  // memoryOnly: a key for a fund() still in flight — saved once funding lands.
  function gen(memoryOnly) { kp = w3().Keypair.generate(); meta = { secret: Array.from(kp.secretKey), cap: 0, at: Date.now() }; if (!memoryOnly) save(); return kp; }
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
  // C6 / NET-3: the WALLET's own OSTG is read from OST_BALANCE (the app's one
  // balance poller) — never an extra RPC loop from here. Only an existing
  // session key's own account is read on chain, and only on demand.
  function walletOstgFromBalance() {
    try {
      var g = window.OST_BALANCE && typeof window.OST_BALANCE.get === 'function' ? window.OST_BALANCE.get() : null;
      if (g && g.ostg != null && isFinite(Number(g.ostg))) return Number(g.ostg);
    } catch (_) {}
    return null;
  }
  async function refresh() {
    var k = load();
    var s = k ? await readOstg(k.publicKey) : 0; if (s != null) cachedBal = s; else if (cachedBal == null) cachedBal = undefined;
    var u = userPk(); if (u) { var w = walletOstgFromBalance(); if (w != null) cachedWallet = w; }
    emit(); return cachedBal;
  }
  window.addEventListener('ost:balance', function () { var w = walletOstgFromBalance(); if (w != null && w !== cachedWallet) { cachedWallet = w; emit(); } });
  // The unified spendable = wallet OSTG + whatever is parked in the session key.
  function spendable() { if (cachedWallet == null && cachedBal == null) return undefined; return (cachedWallet || 0) + (cachedBal || 0); }
  function walletBalance() { return cachedWallet; }
  function status() {
    var k = load();
    return { exists: !!k, pubkey: k ? k.publicKey.toBase58() : null, balance: cachedBal, cap: cap(), wallet: cachedWallet, maxFund: MAX_FUND, defaultFund: DEFAULT_FUND, fundedAt: meta && meta.at };
  }

  // Funding limits. The amount a user parks in the session key is the ONLY OSTG
  // a leaked localStorage secret could ever spend, so it is bounded hard: the
  // user picks it, it can never exceed the wallet's OSTG, and never MAX_FUND
  // per session. There is NO automatic funding — every fund() is a user tap
  // on an amount they saw.
  var DEFAULT_FUND = 25, MAX_FUND = 500, MIN_FUND = 1;

  // ONE user signature: SOL float + OSTG (the spend cap) -> the session key.
  // opts.consent must be true: callers pass it from the tap handler of a button
  // whose label states the amount, so nothing can arm a session behind the user.
  async function fund(amountUi, opts) {
    opts = opts || {};
    var W = w3(); var u = userPk();
    if (!u) throw new Error('Connect a wallet first.');
    if (opts.consent !== true) throw new Error('1-tap funding needs your confirmation — pick an amount in the 1-tap panel.');
    amountUi = Math.floor(Number(amountUi) || 0);
    if (!(amountUi >= MIN_FUND)) throw new Error('Enter an amount (at least ' + MIN_FUND + ' OSTG).');
    if (amountUi > MAX_FUND) throw new Error('1-tap sessions are capped at ' + MAX_FUND + ' OSTG. Fund less, or end and refund.');
    if (cap() + amountUi > MAX_FUND) throw new Error('This session already holds ' + cap() + ' OSTG; the cap is ' + MAX_FUND + '.');
    var have = await readOstg(u); if (have == null) have = cachedWallet;
    if (have != null && amountUi > Math.floor(have)) throw new Error('Your wallet has ' + Math.floor(have) + ' OSTG — fund at most that.');
    // PRD-5: 1-tap needs a little SOL for the session float (+ account rent).
    // A 0-SOL wallet used to sign a transaction that could only fail on chain,
    // and leave a dead session key behind. Refuse up front, plainly.
    try {
      var solLam = await conn().getBalance(u);
      if (Number.isFinite(solLam) && solLam < Math.round((FUND_SOL + 0.003) * 1e9)) {
        var se = new Error('1-tap needs about ' + (FUND_SOL + 0.003).toFixed(3) + ' devnet SOL for the session’s fees. Your wallet has ' + (solLam / 1e9).toFixed(4) + ' SOL. Regular buys need no SOL.');
        se.code = 'no_sol'; throw se;
      }
    } catch (e) { if (e && e.code === 'no_sol') throw e; }
    var fresh = !load();
    var k = load() || gen(true);
    // The in-flight key is parked under a SEPARATE storage key (not read by
    // exists()/load()), so a tab closed mid-sign can still recover the funds
    // while the app never treats an unfunded key as an armed 1-tap session.
    if (fresh) { try { localStorage.setItem(KEY + '.pending', JSON.stringify(meta)); } catch (_) {} }
    var uAta = ataOf(u), sAta = ataOf(k.publicKey);
    var tx = new W.Transaction();
    // Gas float only when the session key is short of it (re-funding an armed
    // session must not keep piling SOL onto it).
    var lam = 0; try { lam = await conn().getBalance(k.publicKey); } catch (_) { lam = 0; }
    if (lam < FUND_SOL * 1e9 * 0.5) tx.add(W.SystemProgram.transfer({ fromPubkey: u, toPubkey: k.publicKey, lamports: Math.round(FUND_SOL * 1e9) }));
    var need = false; try { need = !(await conn().getAccountInfo(sAta)); } catch (_) { need = true; }
    // Create the SESSION's OSTG ATA: payer = the USER (they sign + pay), owner =
    // the SESSION key. The old arg order (payer=session, owner=user) made the tx
    // demand a signature from the unfunded session key AND derived the wrong ATA
    // address — so the one funding signature ALWAYS failed and 1-tap never armed.
    if (need && window.OST_WALLET.associatedAccountIx) { var ix = window.OST_WALLET.associatedAccountIx(u, sAta, k.publicKey, pk(MINT)); if (ix) tx.add(ix); }
    tx.add(transferCheckedIx(uAta, sAta, u, amountUi));
    // PRD-5: a NEW session key is persisted only once its funding transaction
    // has gone through. Before, the key was saved first; a failed fund left a
    // dead "1-tap" key behind. It is kept in memory while signing (and saved
    // the moment sign returns, so funds that did land are never orphaned).
    try {
      await window.OST_WALLET.sign(tx);               // the single user signature
    } catch (signErr) {
      if (fresh) {
        // Only forget the new key when nothing reached it.
        var reached = false;
        try { reached = (await conn().getBalance(k.publicKey)) > 0; } catch (_) { reached = true; }
        if (reached) save(); else { kp = null; meta = null; }
        try { localStorage.removeItem(KEY + '.pending'); } catch (_) {}
      }
      throw signErr;
    }
    meta.cap = (meta.cap || 0) + amountUi; meta.at = Date.now(); save();
    try { localStorage.removeItem(KEY + '.pending'); } catch (_) {}
    try { localStorage.setItem(KEY + '.ended', ''); } catch (_) {}
    await refresh();
    try { window.dispatchEvent(new CustomEvent('ost:session:funded', { detail: { amount: amountUi, cap: meta.cap } })); } catch (_) {}
    return { ok: true, cap: meta.cap };
  }

  async function sendSession(tx) {
    var c = conn(), k = load();
    tx.feePayer = k.publicKey;
    // Blockhash: prefer the wallet's warm/rotating source (falls back to the
    // worker when every browser RPC is throttled), then a direct read as a floor.
    var bh = null;
    try { if (window.OST_WALLET && OST_WALLET.warmBlockhash) bh = await OST_WALLET.warmBlockhash(); } catch (_) {}
    if (!bh || !bh.blockhash) { try { if (window.OST_WALLET && OST_WALLET.serverBlockhash) bh = await OST_WALLET.serverBlockhash(); } catch (_) {} }
    if (!bh || !bh.blockhash) bh = await c.getLatestBlockhash('confirmed');
    tx.recentBlockhash = bh.blockhash;
    tx.sign(k);
    var serialized = tx.serialize();
    var sig;
    try {
      sig = await c.sendRawTransaction(serialized);
    } catch (e) {
      // Every client RPC down → submit through the worker relay so 1-tap still lands.
      if (window.OST_WALLET && OST_WALLET.sendRawResilient) sig = await OST_WALLET.sendRawResilient(serialized, false);
      else throw e;
    }
    try { await c.confirmTransaction(sig, 'confirmed'); } catch (_) {}
    return sig;
  }

  // Sweep the session's OSTG back to the wallet and clear the cap. The SOL gas
  // float goes back too, minus a small reserve the session key needs to sign
  // any still-pending claim; a second End after claims returns the rest.
  var SOL_RESERVE = 0.004, TX_FEE = 0.000005;
  async function end() {
    var W = w3(); var k = load(); if (!k) return { ok: true };
    var u = userPk(); if (!u) throw new Error('Connect a wallet to sweep back.');
    var bal = await refresh();
    var swept = { ost: 0, sol: 0 };
    if (bal > 0) {
      var tx = new W.Transaction();
      tx.add(transferCheckedIx(ataOf(k.publicKey), ataOf(u), k.publicKey, bal));
      await sendSession(tx);
      swept.ost = bal;
    }
    try {
      var lam = await conn().getBalance(k.publicKey);
      var give = lam - Math.round((SOL_RESERVE + TX_FEE) * 1e9);
      if (give > 0) {
        var tx2 = new W.Transaction();
        tx2.add(W.SystemProgram.transfer({ fromPubkey: k.publicKey, toPubkey: u, lamports: give }));
        await sendSession(tx2);
        swept.sol = give / 1e9;
      }
    } catch (_) {}
    meta.cap = 0; save(); await refresh();
    try { window.dispatchEvent(new CustomEvent('ost:session:ended', { detail: swept })); } catch (_) {}
    return { ok: true, swept: swept };
  }

  // ---- NO AUTO-ARM. ----
  // Earlier builds moved the user's WHOLE wallet balance into the session key the
  // moment a wallet was sensed (and sized the cap from the OSTC helper, not the
  // OSTG the session actually spends). A session key is a hot key in
  // localStorage: funding it is a spend decision the user must make, on an
  // amount they can see. `offer()` only tells the UI that 1-tap is AVAILABLE
  // (on-chain rail present, wallet holds OSTG); the UI renders a button whose
  // label carries the amount, and that tap calls fund(amount, {consent:true}).
  function onchainReady() { try { return !!(w3() && window.OST_ONCHAIN && OST_ONCHAIN.available && OST_ONCHAIN.available()); } catch (_) { return false; } }
  async function onchainMarketExists() {
    try {
      if (!(onchainReady() && OST_ONCHAIN.marketFor)) return false;
      var FIVE = 300000;
      var openAtSec = Math.floor((Math.floor(Date.now() / FIVE) * FIVE) / 1000);
      var m = await OST_ONCHAIN.marketFor(openAtSec);
      return !!(m && m.exists);
    } catch (_) { return false; }
  }
  var offered = false, lastOfferCheckAt = 0;
  async function offer() {
    if (offered || !userPk() || !onchainReady()) return false;
    // NET-3: whether this round has an on-chain market is asked at most once
    // per 5-minute round (D4: the on-chain rail is offline until the crank runs).
    if (Date.now() - lastOfferCheckAt < 300000) return false;
    lastOfferCheckAt = Date.now();
    if (exists()) { await refresh(); if (cachedBal > 0) return false; }    // already armed
    if (!(await onchainMarketExists())) return false;
    var w = walletOstgFromBalance(); if (w != null) cachedWallet = w;
    if (!(cachedWallet >= MIN_FUND)) return false;
    offered = true;
    var suggest = Math.min(DEFAULT_FUND, MAX_FUND, Math.floor(cachedWallet));
    try { window.dispatchEvent(new CustomEvent('ost:session:offer', { detail: { wallet: cachedWallet, suggest: suggest, max: Math.min(MAX_FUND, Math.floor(cachedWallet)) } })); } catch (_) {}
    return true;
  }
  // Legacy name kept for callers; it never funds anything any more.
  function autoArm() { return offer(); }

  window.OST_SESSION = { exists: exists, keypair: keypair, pubkey: pubkey, balance: balance, spendable: spendable, walletBalance: walletBalance, cap: cap, status: status, fund: fund, end: end, refresh: refresh, offer: offer, autoArm: autoArm, limits: { min: MIN_FUND, max: MAX_FUND, suggested: DEFAULT_FUND } };

  if (exists()) setTimeout(function () { try { refresh(); } catch (_) {} }, 1500);
  // Refresh (read-only) when the wallet core is ready / changes, and let the UI
  // know whether 1-tap can be offered. OST_WALLET.onReady replays immediately
  // if a wallet is already connected.
  // A session key's own account is re-read only when one exists; otherwise
  // this is a memory read (no RPC on every wallet / money event — NET-3).
  function onWallet() {
    if (document.hidden) return;
    setTimeout(function () {
      var p = exists() ? refresh() : Promise.resolve((function () { var w = walletOstgFromBalance(); if (w != null) cachedWallet = w; return cachedBal; })());
      p.then(offer).catch(function () {});
    }, 800);
  }
  (function hookReady(n) {
    if (window.OST_WALLET && typeof window.OST_WALLET.onReady === 'function') { window.OST_WALLET.onReady(onWallet); return; }
    if (n > 40) return; setTimeout(function () { hookReady(n + 1); }, 150);   // OST_WALLET may define after us
  })(0);
  window.addEventListener('ost:wallet-changed', onWallet);
  window.addEventListener('ost:wallet-ready', onWallet);
  window.addEventListener('ost:wallet-connected', onWallet);
})();

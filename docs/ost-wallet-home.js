/* ==========================================================================
 * OST · Wallet home — one clear wallet surface (all devices)
 * --------------------------------------------------------------------------
 * The ONE get-started path (money plan C9). Every Start / Create / Connect /
 * Get-OST button in the app calls OST_WALLET.requireWallet(), which lands here:
 *   start   -> Create OST wallet · Restore from a backup · Phantom/Solflare/Backpack
 *   backup  -> Step 2 of 3 · Save your key (download / copy Phantom-format key /
 *              skip). Nothing downloads by itself; "backed up" is set only by an
 *              explicit download or copy.
 *   getost  -> Step 3 of 3 · Get 100 free devnet OST (OST pays every fee)
 *   funded  -> "100 OST arrived" + next-step tiles; a pending gate resumes.
 *   home    -> identity, balances (SOL row: not needed for OST · Get SOL),
 *              Send / Receive / Top up / Get OST / Convert, activity.
 *   restore -> file or pasted key (JSON, hex or base58); never silently
 *              replaces a different wallet.
 * Wallet identity is owned by app.js (OST_WALLET.connect / createLocal /
 * disconnect / requireWallet — contract C1). Nothing here moves money.
 * window.OST_WALLET_HOME.{ render, refresh, open(view, opts) }
 * ========================================================================== */
(function () {
  'use strict';
  if (window.OST_WALLET_HOME) return;

  var LOCAL_KEY = 'ost.localWallet.v1';
  var BACKUP_KEY = 'ost.localWallet.backupExportedAt';
  var CLAIMS_KEY = 'ost.reward.claims.v1';
  var ACT_KEY = 'ost.wallet.activity.v2:';
  var OSTG_MINT = 'DfgxMbdN49AX2Za9LuvsyixF1jgVh45RbgWYSGonxQos';
  var BRIDGE_PROGRAM = 'J7jqcwT44CY4oXjwu6fwfiFvQDWBQRsueqL7dsZjnrJd';
  var DAY_MS = 24 * 3600 * 1000;

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function w3() { return window.solanaWeb3; }
  function W() { return window.OST_WALLET; }
  function isMobile() { try { return (W() && W().isPhone) ? W().isPhone() : /Android|iPhone|iPad|iPod/i.test(navigator.userAgent); } catch (_) { return false; } }
  function pubkey() { try { return (W() && W().pubkey && W().pubkey()) || null; } catch (_) { return null; } }
  function session() { try { return W() && W().session; } catch (_) { return null; } }
  function cluster() { try { return (window.OST_CONFIG && OST_CONFIG.network) || 'devnet'; } catch (_) { return 'devnet'; } }
  function explorer(kind, v) { var c = cluster(); return 'https://explorer.solana.com/' + kind + '/' + v + (c === 'mainnet-beta' ? '' : '?cluster=' + c); }
  function short(a) { a = String(a || ''); return a.length > 12 ? a.slice(0, 4) + '…' + a.slice(-4) : a; }
  function fileShort(a) { a = String(a || ''); return a.length > 12 ? a.slice(0, 4) + '-' + a.slice(-4) : a; }
  function fmt(v, d) { return (v === undefined || v === null || !isFinite(Number(v))) ? '—' : Number(v).toLocaleString(undefined, { maximumFractionDigits: d == null ? 2 : d, minimumFractionDigits: 0 }); }
  function usd(n) { return (n == null || !isFinite(n)) ? '' : '$' + Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function ago(ts) { var s = Math.max(0, (Date.now() - ts) / 1000); if (s < 60) return 'now'; if (s < 3600) return Math.floor(s / 60) + 'm'; if (s < 86400) return Math.floor(s / 3600) + 'h'; if (s < 86400 * 30) return Math.floor(s / 86400) + 'd'; return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); }
  function countdown(ms) { var t = Math.max(0, Math.ceil(ms / 1000)); var h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60; return h > 0 ? h + 'h ' + String(m).padStart(2, '0') + 'm' : String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0'); }

  // C2: one notification surface (ost-optimistic.js).
  function toast(msg, kind, extra) {
    var k = kind === 'err' ? 'error' : (kind || 'info');
    try { if (typeof window.OST_NOTIFY === 'function') { window.OST_NOTIFY(Object.assign({ kind: k, title: msg }, extra || {})); return; } } catch (_) {}
    try { if (typeof window.toast === 'function') window.toast(k === 'error' ? '⚠️' : 'ℹ️', msg); } catch (_) {}
  }
  function copy(text, label, after) {
    var done = function () { toast((label || 'Copied') + (label && /key/i.test(label) ? '' : ' · ' + short(text)), 'ok'); if (after) after(); };
    try { if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text).then(done, function () { fallback(); }); } catch (_) {}
    fallback();
    function fallback() { try { var ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); var ok = document.execCommand('copy'); ta.remove(); if (ok === false) throw new Error('copy'); done(); } catch (_) { toast('Copy failed — reveal the key and copy it by hand.', 'err'); } }
  }

  /* ---------- local (browser) wallet helpers — same storage app.js uses ---------- */
  function storedLocal() { try { var r = JSON.parse(localStorage.getItem(LOCAL_KEY) || 'null'); return r && Array.isArray(r.secretKey) && r.secretKey.length ? r : null; } catch (_) { return null; } }
  function storedLocalPubkey() { var r = storedLocal(); if (!r || !w3()) return null; try { return w3().Keypair.fromSecretKey(Uint8Array.from(r.secretKey)).publicKey.toBase58(); } catch (_) { return null; } }
  function backedUpAt() { try { return Number(localStorage.getItem(BACKUP_KEY) || 0) || 0; } catch (_) { return 0; } }
  function markBackedUp() { try { localStorage.setItem(BACKUP_KEY, String(Date.now())); } catch (_) {} }
  function writeLocal(kp) { localStorage.setItem(LOCAL_KEY, JSON.stringify({ createdAt: Date.now(), secretKey: Array.from(kp.secretKey) })); }
  function base58Secret() { var r = storedLocal(); if (!r || !window.OST_BASE58) return ''; try { return window.OST_BASE58.encode(Uint8Array.from(r.secretKey)); } catch (_) { return ''; } }
  function download(name, text) {
    var blob = new Blob([text], { type: 'application/json' }); var url = URL.createObjectURL(blob);
    var a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(url); }, 0);
  }
  function backupFileName(pk) { return 'ost-browser-wallet-' + fileShort(pk) + '.json'; }
  // WAL-7: JSON array / {secretKey}, 128-hex, comma list, or base58 (Phantom export).
  function parseSecret(text) {
    var t = String(text || '').trim(); if (!t) throw new Error('Pick a backup file or paste a secret key first.');
    var bytes = null;
    if (t[0] === '[' || t[0] === '{') { var p; try { p = JSON.parse(t); } catch (_) { throw new Error('That file is not valid JSON.'); } var arr = Array.isArray(p) ? p : (p && p.secretKey); if (!Array.isArray(arr)) throw new Error('Not an OST backup.'); bytes = Uint8Array.from(arr.map(Number)); }
    else if (/^[0-9a-f]{128}$/i.test(t)) { bytes = new Uint8Array(64); for (var i = 0; i < 64; i++) bytes[i] = parseInt(t.substr(i * 2, 2), 16); }
    else if (/^[\d,\s]+$/.test(t)) { bytes = Uint8Array.from(t.split(/[,\s]+/).filter(Boolean).map(Number)); }
    else if (/^[1-9A-HJ-NP-Za-km-z]+$/.test(t)) { if (!window.OST_BASE58) throw new Error('Base58 support is still loading — try again in a second.'); bytes = window.OST_BASE58.decode(t); }
    else throw new Error('Unrecognised key. Paste a JSON array of 64 numbers, a 128-character hex key or a base58 (Phantom) key.');
    if (bytes.length !== 64) throw new Error('A secret key is 64 bytes — this one is ' + bytes.length + '.');
    try { return w3().Keypair.fromSecretKey(bytes); } catch (_) { throw new Error('That key is not a valid Solana secret key.'); }
  }

  /* ---------- providers ---------- */
  var WALLETS = {
    phantom: { label: 'Phantom', ico: '👻', dl: 'https://phantom.app/download' },
    solflare: { label: 'Solflare', ico: '☀️', dl: 'https://solflare.com/download' },
    backpack: { label: 'Backpack', ico: '🎒', dl: 'https://backpack.app/download' }
  };
  function hasProvider(type) { try { return !!(W() && W().getProvider && W().getProvider(type)); } catch (_) { return false; } }
  // WAL-6: one code path (OST_WALLET.connect); busy clears on the real outcome,
  // never on a blind timer.
  function connectExt(type) {
    var wdef = WALLETS[type]; if (!wdef || !W() || !W().connect) { toast('Wallet core is still loading — try again in a second.', 'err'); return; }
    var installed = hasProvider(type);
    if (installed) setBusy('Approve the connection in ' + wdef.label + '…');
    W().connect(type).then(function () { setBusy(''); }, function (e) {
      var code = e && e.code;
      if (code === 'not_installed' && !isMobile()) {
        setBusy('', '<span>' + esc(wdef.label) + ' is not installed in this browser.</span> <a href="' + esc(wdef.dl) + '" target="_blank" rel="noopener">Get ' + esc(wdef.label) + ' ↗</a>');
        return;
      }
      if (code === 'not_installed') { setBusy('Opening ' + wdef.label + '… connect from inside its app browser.'); return; }
      setBusy('');
      toast((e && e.message) || ('Could not connect ' + wdef.label + '.'), code === 'cancelled' ? 'info' : 'err');
    });
  }

  /* ---------- state ---------- */
  var S = { view: 'home', reason: '', onboarding: false, sol: undefined, solAt: 0, act: [], actTab: 'chain', actBusy: false, actErr: '', actAt: 0, reveal: false, busy: '', busyHtml: '', faucetBusy: false, status: '', statusKind: '', funded: null, mountedAt: Date.now(), seen: null };
  var root;

  // Conversion rate only (C7): never the display index / model price.
  function ostUsd() {
    try { if (window.OST_CONVERT_PRICE && typeof OST_CONVERT_PRICE.ostUsd === 'function') { var v = Number(OST_CONVERT_PRICE.ostUsd()); if (v > 0) return v; } } catch (_) {}
    try { var T = window.OST_TOPUP; if (T) { var a = typeof T.usdPerOst === 'function' ? T.usdPerOst() : T.usdPerOst; if (Number(a) > 0) return Number(a); } } catch (_) {}
    return null;
  }
  function bal(name) { try { return window.OST_BALANCE && OST_BALANCE[name] ? OST_BALANCE[name]() : undefined; } catch (_) { return undefined; } }
  function sessInfo() { try { return window.OST_SESSION && OST_SESSION.status ? OST_SESSION.status() : null; } catch (_) { return null; } }
  function readSol(force) {
    var pk = pubkey(); if (!pk) return Promise.resolve();
    // NET-3 / C6: OST_BALANCE already reads SOL with the other balances — use
    // it instead of a second getBalance loop.
    if (window.OST_BALANCE && typeof OST_BALANCE.sol === 'function') {
      var s0 = OST_BALANCE.sol();
      if (s0 != null && isFinite(s0)) { S.sol = Number(s0); paintBalances(); }
      return Promise.resolve();
    }
    if (!W() || !W().rpcCall || !w3()) return Promise.resolve();
    if (!force && Date.now() - S.solAt < 60000) return Promise.resolve();
    S.solAt = Date.now();
    return W().rpcCall(function (c) { return c.getBalance(new (w3().PublicKey)(pk)); }).then(function (l) { if (typeof l === 'number') { S.sol = l / 1e9; paintBalances(); } }).catch(function () {});
  }
  // C11: cooldowns use the server-corrected clock (OST_AUTH learns the offset).
  function srvNow() { try { if (window.OST_AUTH && typeof OST_AUTH.now === 'function') { var n = Number(OST_AUTH.now()); if (isFinite(n) && n > 0) return n; } } catch (_) {} return Date.now(); }
  function faucetInfo() {
    var pk = pubkey(); if (!pk) return null;
    try {
      var c = (JSON.parse(localStorage.getItem(CLAIMS_KEY) || '{}') || {})[pk] || {};
      var welcome = Number(c.welcomeClaimedAt || 0), last = Number(c.lastDailyClaimAt || welcome || 0);
      // SRV-1: a PAYING reservation stays pending past expiresAt; an unconfirmed
      // claim holds the wallet locally until it settles (app.js faucet watcher).
      var pr = c.pendingReservation;
      var pending = !!(pr && (pr.paying === true || Number(pr.expiresAt || 0) > srvNow()));
      var hold = !!(c.unconfirmedClaim && Number(c.unconfirmedClaim.until || 0) > Date.now() && !(c.unconfirmedClaim.kind === 'welcome' && welcome > 0));
      return { welcomeClaimed: welcome > 0, nextAt: welcome ? last + DAY_MS : 0, pending: pending || hold, hold: hold };
    } catch (_) { return { welcomeClaimed: false, nextAt: 0, pending: false }; }
  }

  /* ---------- on-chain activity ---------- */
  function actKey() { return ACT_KEY + (pubkey() || ''); }
  function loadAct() { try { var r = JSON.parse(localStorage.getItem(actKey()) || 'null'); return r && Array.isArray(r.rows) ? r.rows : []; } catch (_) { return []; } }
  function saveAct(rows) { try { localStorage.setItem(actKey(), JSON.stringify({ at: Date.now(), rows: rows.slice(0, 60) })); } catch (_) {} }
  function keyStr(k) { try { return k && k.pubkey ? (k.pubkey.toBase58 ? k.pubkey.toBase58() : String(k.pubkey)) : (k && k.toBase58 ? k.toBase58() : String(k)); } catch (_) { return ''; } }
  function parseTx(sig, tx, pk) {
    var row = { sig: sig, ts: 0, label: 'Program activity', amt: null, unit: '', dir: 0, ok: true, memo: '', from: '', legs: null };
    if (!tx) return row;
    row.ts = tx.blockTime ? tx.blockTime * 1000 : 0; row.ok = !(tx.meta && tx.meta.err);
    var meta = tx.meta || {}, msg = (tx.transaction && tx.transaction.message) || {};
    var keys = msg.accountKeys || [];
    var ostc = null; try { ostc = window.OST_CONFIG && OST_CONFIG.mint; } catch (_) {}
    function tokDelta(mint, owner) {
      var pre = 0, post = 0, seen = false;
      (meta.preTokenBalances || []).forEach(function (b) { if (b.owner === owner && b.mint === mint) { pre += Number(b.uiTokenAmount && b.uiTokenAmount.uiAmount) || 0; seen = true; } });
      (meta.postTokenBalances || []).forEach(function (b) { if (b.owner === owner && b.mint === mint) { post += Number(b.uiTokenAmount && b.uiTokenAmount.uiAmount) || 0; seen = true; } });
      return seen ? Math.round((post - pre) * 1e9) / 1e9 : 0;
    }
    function sender(mint) {
      var owners = {};
      (meta.preTokenBalances || []).concat(meta.postTokenBalances || []).forEach(function (b) { if (b.mint === mint && b.owner && b.owner !== pk) owners[b.owner] = 1; });
      var best = '', bestD = 0;
      Object.keys(owners).forEach(function (o) { var d = tokDelta(mint, o); if (d < bestD) { bestD = d; best = o; } });
      return best;
    }
    var dg = tokDelta(OSTG_MINT, pk), dc = ostc ? tokDelta(ostc, pk) : 0;
    var idx = -1, viaBridge = false;
    for (var i = 0; i < keys.length; i++) { var ks = keyStr(keys[i]); if (ks === pk && idx < 0) idx = i; if (ks === BRIDGE_PROGRAM) viaBridge = true; }
    var ds = (idx >= 0 && meta.preBalances && meta.postBalances) ? (meta.postBalances[idx] - meta.preBalances[idx]) / 1e9 : 0;
    var ataCreated = false;
    try { (msg.instructions || []).concat([].concat.apply([], (meta.innerInstructions || []).map(function (x) { return x.instructions || []; }))).forEach(function (ix) {
      if (ix && ix.program === 'spl-memo' && typeof ix.parsed === 'string' && !row.memo) row.memo = ix.parsed.slice(0, 400);
      if (ix && keyStr(ix.programId) === BRIDGE_PROGRAM) viaBridge = true;
      // A token account created FOR this wallet (the pool pays the rent/fee).
      if (ix && ix.program === 'spl-associated-token-account' && ix.parsed && /^create/.test(String(ix.parsed.type || '')) && ix.parsed.info && ix.parsed.info.wallet === pk) ataCreated = String(ix.parsed.info.mint || '');
    }); } catch (_) {}
    // The payout memo is "payoutId:faucet-<id> {json}" (wallet-payouts.js):
    // read the JSON from its first "{", and recognise the faucet payout id.
    var kind = '';
    try { var brace = row.memo.indexOf('{'); if (brace >= 0) { var mj = JSON.parse(row.memo.slice(brace)); kind = String((mj && (mj.k || mj.kind)) || ''); } } catch (_) {}
    if (!kind && /payoutId:faucet-/.test(row.memo)) kind = 'ost-new-here';
    row.memo = row.memo.slice(0, 160);
    var KIND = { 'ost-topup': 'Top-up delivered', 'ost-bet': 'Market ticket', 'prediction-settlement': 'Market payout', 'prediction-sell': 'Market sell', 'ost-new-here': 'Faucet claim', 'faucet-hub-cashout': 'Credits cash-out', 'memecoin-buy': 'Memecoin buy', 'memecoin-sell': 'Memecoin sell', 'sol-to-ost': 'Converted SOL → OST', 'ost-to-sol': 'Converted OST → SOL', 'peer-transfer': 'Peer transfer', 'treasury-deposit': 'Treasury deposit' };
    if (/^faucet-/.test(kind)) kind = 'ost-new-here';
    // BRG-6: an OST ⇄ OSTG bridge conversion shows BOTH legs, never "Sent OSTG".
    if (viaBridge && (Math.abs(dg) > 1e-9 || Math.abs(dc) > 1e-9)) {
      row.label = dc < 0 || dg > 0 ? 'Converted OST → OSTG' : 'Converted OSTG → OST';
      row.legs = [{ unit: 'OST', amt: dc }, { unit: 'OSTG', amt: dg }];
      row.amt = Math.abs(dg) || Math.abs(dc); row.unit = 'OSTG'; row.dir = 0; row.convert = true;
      if (!row.ok) row.label = 'Failed · ' + row.label;
      return row;
    }
    if (Math.abs(dg) > 1e-9) { row.amt = Math.abs(dg); row.unit = 'OSTG'; row.dir = dg > 0 ? 1 : -1; if (dg > 0) row.from = sender(OSTG_MINT); }
    else if (Math.abs(dc) > 1e-9) { row.amt = Math.abs(dc); row.unit = 'OST'; row.dir = dc > 0 ? 1 : -1; if (dc > 0) row.from = sender(ostc); }
    else if (Math.abs(ds) > 0.00001) { row.amt = Math.abs(ds); row.unit = 'SOL'; row.dir = ds > 0 ? 1 : -1; }
    row.kind = kind;
    var ataLabel = '';
    if (ataCreated && !row.unit) ataLabel = (ataCreated === OSTG_MINT ? 'OSTG' : (ataCreated === ostc ? 'OST' : 'Token')) + ' account created · fee paid by OST';
    row.label = KIND[kind] || ataLabel || (row.unit ? (row.dir > 0 ? 'Received ' : 'Sent ') + row.unit : (idx === 0 ? 'Transaction' : 'Program activity'));
    if (!row.ok) row.label = 'Failed · ' + row.label;
    return row;
  }
  // TRF-4: a transfer INTO an existing token account never references the owner
  // address, so also read the OST and OSTG token accounts' signatures.
  function activityAddresses(pk) {
    var out = [pk];
    try {
      var c = W() && W().constants; var assoc = W() && W().associatedAddress;
      if (c && assoc) {
        var mints = [];
        try { if (window.OST_CONFIG && OST_CONFIG.mint) mints.push(OST_CONFIG.mint); } catch (_) {}
        mints.push(OSTG_MINT);
        mints.forEach(function (m) { try { out.push(assoc(new (w3().PublicKey)(m), new (w3().PublicKey)(pk), false, c.TOKEN_2022_PROGRAM_ID, c.ASSOCIATED_TOKEN_PROGRAM_ID).toBase58()); } catch (_) {} });
      }
    } catch (_) {}
    return out;
  }
  function announceIncoming(rows) {
    rows.forEach(function (r) {
      if (!r || !r.ok || r.dir <= 0 || r.convert || !(r.unit === 'OST' || r.unit === 'OSTG')) return;
      if (r.kind === 'ost-new-here') return;              // the faucet flow already said "100 OST arrived"
      if (r.ts && r.ts < S.mountedAt - 30000) return;    // only what arrived while this page is open
      toast('Received ' + fmt(r.amt, 4) + ' ' + r.unit + (r.from ? ' from ' + short(r.from) : (r.label && !/^Received/.test(r.label) ? ' · ' + r.label : '')), 'ok', { sig: r.sig });
    });
  }
  function refreshActivity(force) {
    var pk = pubkey(); if (!pk || S.actBusy || !W() || !W().rpcCall || !w3()) return Promise.resolve();
    if (!force && Date.now() - S.actAt < 60000) return Promise.resolve();
    S.actBusy = true; S.actErr = ''; S.actAt = Date.now(); paintActivity();
    var have = loadAct(); var known = {}; have.forEach(function (r) { known[r.sig] = r; });
    var firstLoad = !S.seen; if (!S.seen) { S.seen = {}; have.forEach(function (r) { S.seen[r.sig] = 1; }); }
    var addrs = activityAddresses(pk);
    return Promise.all(addrs.map(function (a, i) {
      return W().rpcCall(function (c) { return c.getSignaturesForAddress(new (w3().PublicKey)(a), { limit: i === 0 ? 25 : 15 }); }).catch(function (e) { if (i === 0) throw e; return []; });
    })).then(function (lists) {
      var bySig = {};
      [].concat.apply([], lists).forEach(function (s) { if (s && s.signature && !bySig[s.signature]) bySig[s.signature] = s; });
      var sigs = Object.keys(bySig).map(function (k) { return bySig[k]; }).sort(function (a, b) { return (b.blockTime || 0) - (a.blockTime || 0); });
      var fresh = sigs.filter(function (s) { return !known[s.signature]; }).slice(0, 12);
      var p = fresh.length ? W().rpcCall(function (c) { return c.getParsedTransactions(fresh.map(function (s) { return s.signature; }), { maxSupportedTransactionVersion: 0 }); }) : Promise.resolve([]);
      return p.then(function (txs) {
        var newRows = [];
        fresh.forEach(function (s, i) { var r = parseTx(s.signature, txs && txs[i], pk); if (!r.ts && s.blockTime) r.ts = s.blockTime * 1000; if (s.err) r.ok = false; known[s.signature] = r; if (!S.seen[s.signature]) newRows.push(r); S.seen[s.signature] = 1; });
        var rows = Object.keys(known).map(function (k) { return known[k]; }).sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); });
        S.act = rows; saveAct(rows);
        if (!firstLoad || Date.now() - S.mountedAt > 5000) announceIncoming(newRows);
        return newRows.length;
      });
    })
      .catch(function (e) { S.actErr = (e && e.message) ? String(e.message).slice(0, 80) : 'RPC busy'; return 0; })
      .then(function (n) { S.actBusy = false; paintActivity(); return n || 0; });
  }
  // A push (account change) or a money event arrives at 'confirmed' — often a
  // moment BEFORE getSignaturesForAddress has indexed the new signature. Retry a
  // few times until a new row shows up, instead of waiting for the 60 s refresh.
  var chaseSeq = 0;
  function refreshUntilNew(delays) {
    var mine = ++chaseSeq, i = 0;
    (function step() {
      if (mine !== chaseSeq || i >= delays.length) return;
      setTimeout(function () {
        if (mine !== chaseSeq) return;
        i++;
        refreshActivity(true).then(function (n) { if (!(n > 0)) step(); });
      }, delays[i]);
    })();
  }
  // Push, not poll: watch the two token accounts while the page is visible so an
  // incoming transfer shows within seconds (falls back to the 60 s refresh).
  var subs = [], subPk = null, subConn = null, subTimer = 0;
  // A rate-limited RPC (429) refuses the WebSocket; web3.js then retries in a
  // loop and logs "ws error: undefined". After 2 socket errors, drop the
  // subscriptions and stay on the 60 s refresh for 5 minutes.
  var wsErrors = 0, wsBackoffUntil = 0, wsHooked = null;
  function hookWsErrors(conn) {
    try {
      var sock = conn && conn._rpcWebSocket;
      if (!sock || wsHooked === sock || typeof sock.on !== 'function') return;
      wsHooked = sock;
      sock.on('error', function () {
        if (++wsErrors >= 2) { wsErrors = 0; wsBackoffUntil = Date.now() + 5 * 60000; unwatch(); }
      });
    } catch (_) {}
  }
  function unwatch() {
    subs.forEach(function (id) { try { subConn && subConn.removeAccountChangeListener(id); } catch (_) {} });
    subs = []; subPk = null; subConn = null;
  }
  function watch() {
    var pk = pubkey();
    if (!pk || document.hidden || !W() || !W().getConnection || !w3()) { unwatch(); return; }
    if (Date.now() < wsBackoffUntil) return;
    if (subPk === pk && subs.length) return;
    unwatch();
    var conn = null; try { conn = W().getConnection(); } catch (_) {}
    if (!conn || typeof conn.onAccountChange !== 'function') return;
    subConn = conn; subPk = pk;
    hookWsErrors(conn);
    activityAddresses(pk).slice(1).forEach(function (ata) {
      try {
        subs.push(conn.onAccountChange(new (w3().PublicKey)(ata), function () {
          clearTimeout(subTimer);
          subTimer = setTimeout(function () { try { if (window.OST_BALANCE) OST_BALANCE.refresh(true); } catch (_) {} }, 1500);
          refreshUntilNew([1500, 3500, 7000, 12000]);
        }, 'confirmed'));
      } catch (_) {}
    });
  }

  /* ---------- rendering ---------- */
  function avatarStyle(pk) { var h = 0; for (var i = 0; i < pk.length; i++) h = (h * 31 + pk.charCodeAt(i)) >>> 0; var a = h % 360, b = (h >> 8) % 360; return 'background:linear-gradient(135deg,hsl(' + a + ',70%,55%),hsl(' + b + ',80%,45%))'; }
  function setBusy(t, html) { S.busy = t || ''; S.busyHtml = html || ''; var b = root && root.querySelector('.owh-busy'); if (b) { if (html) b.innerHTML = html; else b.textContent = t || ''; b.style.display = (t || html) ? '' : 'none'; } }
  function setStatus(t, kind) { S.status = t || ''; S.statusKind = kind || ''; var el = $('owhStatus'); if (el) { el.textContent = S.status; el.className = 'owh-status' + (S.statusKind ? ' ' + S.statusKind : ''); el.hidden = !S.status; } }

  function render() {
    root = $('ostWalletHome'); if (!root) return;
    var pk = pubkey();
    if (!pk && S.view !== 'restore') S.view = 'start';
    // Restore is reachable connected or not (Convert's "Restore from a backup").
    root.innerHTML = S.view === 'restore' ? restoreHtml() : (pk ? connectedHtml(pk) : startHtml());
    wire();
    if (S.busy || S.busyHtml) setBusy(S.busy, S.busyHtml);
    if (pk && S.view === 'home') { paintBalances(); paintSession(); paintActivity(); paintFaucetBtn(); setStatus(S.status, S.statusKind); }
  }

  function reasonHtml() {
    var req = null; try { req = W() && W().pendingRequirement ? W().pendingRequirement() : null; } catch (_) {}
    var label = (req && req.label) || S.reason;
    return label ? '<div class="owh-reason">Create or connect a wallet to <b>' + esc(label) + '</b>. You\'ll come straight back.</div>' : '';
  }
  function startHtml() {
    var local = storedLocalPubkey();
    return '<div class="owh-card owh-start">' +
      '<div class="owh-kicker">Step 1 of 3 · Solana devnet</div>' +
      '<h3>Create your OST wallet</h3>' +
      reasonHtml() +
      '<p>It lives in this browser — nothing is sent anywhere. One address for markets, games, perps and the faucet. You don\'t need SOL: OST pays every network fee.</p>' +
      (local ? '<button class="owh-primary" data-act="local">Open my browser wallet <small>' + esc(short(local)) + '</small></button>' : '<button class="owh-primary" data-act="create">Create OST wallet <small>free · takes one tap</small></button>') +
      '<div class="owh-links">' + (local ? '<button data-act="create-new">Start a different browser wallet</button>' : '') + '<button data-act="restore">Restore from a backup</button></div>' +
      '<div class="owh-or">or connect a wallet you already have</div>' +
      '<div class="owh-ext">' + Object.keys(WALLETS).map(function (k) { var d = WALLETS[k]; var st = hasProvider(k) ? 'detected' : (isMobile() ? 'opens the app' : 'not installed'); return '<button data-act="ext" data-w="' + k + '"><b>' + d.ico + '</b><span>' + d.label + '</span><em>' + st + '</em></button>'; }).join('') + '</div>' +
      '<div class="owh-busy" style="display:none"></div>' +
      '<div class="owh-note">Devnet test network — OST here has no cash value and nothing you do costs real money. A browser wallet lives only in this browser: save its key in the next step.</div>' +
      '</div>';
  }
  function restoreHtml() {
    var cur = storedLocalPubkey();
    return '<div class="owh-card owh-start">' +
      '<button class="owh-back" data-act="home">‹ Back</button>' +
      '<h3>Restore a wallet</h3>' +
      '<p>Pick the backup file OST gave you, or paste a secret key: a JSON list of 64 numbers, a hex key, or a base58 key exported from Phantom/Solflare.</p>' +
      (cur ? '<div class="owh-warn">This browser already holds wallet <b>' + esc(short(cur)) + '</b>' + (backedUpAt() ? '' : ' which was <b>never backed up</b>') + '. Restoring a different wallet replaces it here. <button data-act="backup-current">Download its backup first</button></div>' : '') +
      '<label class="owh-file"><input type="file" id="owhFile" accept="application/json,.json,.txt"><span id="owhFileName">Choose backup file…</span></label>' +
      '<textarea id="owhPaste" rows="3" placeholder="…or paste the secret key (JSON array, hex or base58)" autocomplete="off" spellcheck="false"></textarea>' +
      '<label class="owh-check' + (cur ? '' : ' hide') + '"><input type="checkbox" id="owhReplaceOk"> I understand this replaces the current browser wallet' + (cur && !backedUpAt() ? ' (it has no backup)' : '') + '</label>' +
      '<button class="owh-primary" data-act="restore-go">Restore wallet</button>' +
      archiveHtml(cur) +
      '<div class="owh-busy" style="display:none"></div>' +
      '</div>';
  }
  function archiveHtml(cur) {
    var list = readArchive().map(function (x, i) { return { x: x, i: i }; }).filter(function (o) { return o.x.pubkey !== cur; });
    if (!list.length) return '';
    return '<div class="owh-or">earlier browser wallets on this device</div><div class="owh-links">' +
      list.map(function (o) { return '<button data-act="use-archived" data-i="' + o.i + '">Use ' + esc(short(o.x.pubkey)) + (o.x.at ? ' · replaced ' + (ago(o.x.at) === 'now' ? 'just now' : esc(ago(o.x.at)) + ' ago') : '') + '</button>'; }).join('') + '</div>';
  }
  function backupHtml(pk) {
    var rec = storedLocal(); var secret = rec ? JSON.stringify(rec.secretKey) : '';
    var b58 = base58Secret();
    var done = backedUpAt();
    return '<div class="owh-card owh-backup">' +
      '<div class="owh-kicker">' + (S.onboarding ? 'Step 2 of 3 · ' : '') + 'Save your key</div><h3>Back up your wallet</h3>' +
      '<p>Your wallet <b>' + esc(short(pk)) + '</b> exists only in this browser. Anyone with this key controls the wallet — and clearing site data or losing this device loses it unless you keep a copy. Save it now, or later from ⋯.</p>' +
      '<div class="owh-row2"><button class="owh-primary" data-act="dl-backup">Download backup</button>' + (b58 ? '<button class="owh-ghost" data-act="copy-b58">Copy key (Phantom format)</button>' : '') + '</div>' +
      '<div class="owh-links"><button data-act="reveal">' + (S.reveal ? 'Hide secret key' : 'Show secret key') + '</button></div>' +
      (S.reveal ? '<textarea class="owh-secret" readonly>' + esc(b58 || secret) + '</textarea><div class="owh-note">' + (b58 ? 'Base58 (Phantom/Solflare import format).' : 'JSON array of 64 numbers.') + '</div>' : '') +
      (done ? '<div class="owh-ok">✓ Backup saved ' + esc(ago(done)) + ' ago. Keep it offline.</div>' : '') +
      '<div class="owh-note">Never share this key. OST will never ask you for it.</div>' +
      '<button class="owh-ghost" data-act="backup-next">' + (S.onboarding ? (done ? 'Continue' : 'Skip for now (you\'ll be reminded)') : 'Done') + '</button>' +
      '</div>';
  }
  function getOstHtml() {
    var f = faucetInfo() || {};
    var claimed = f.welcomeClaimed;
    return '<div class="owh-card owh-getost">' +
      '<div class="owh-kicker">Step 3 of 3 · Get free OST</div><h3>' + (claimed ? 'This wallet already has its welcome OST' : 'Get 100 free devnet OST') + '</h3>' +
      reasonHtml() +
      '<p>' + (claimed ? 'The 100 OST welcome drop was already claimed for this wallet.' : 'We\'ll send you 100 devnet OST. OST pays every network fee — you don\'t need SOL.') + '</p>' +
      // FCT-3: nothing optimistic before the reservation is granted — the
      // button says "Checking…" until the faucet answers, then "Sending…".
      (claimed ? '<button class="owh-primary" data-act="finish">Continue</button>' : '<button class="owh-primary" data-act="getost-go"' + (S.faucetBusy || f.pending ? ' disabled' : '') + '>' +
        (S.faucetBusy ? (S.faucetStage === 'sending' ? 'Sending 100 OST…' : (S.faucetStage === 'confirming' ? 'Confirming…' : 'Checking your claim…')) : (f.pending ? 'Confirming your claim…' : 'Get 100 free OST')) + '</button>') +
      '<div class="owh-status' + (S.statusKind ? ' ' + S.statusKind : '') + '" id="owhStatus"' + (S.status ? '' : ' hidden') + '>' + esc(S.status) + '</div>' +
      (claimed || S.faucetBusy ? '' : '<div class="owh-links"><button data-act="finish">Skip for now</button></div>') +
      '</div>';
  }
  function fundedHtml() {
    var f = S.funded || {};
    var req = null; try { req = W() && W().pendingRequirement ? W().pendingRequirement() : null; } catch (_) {}
    var cont = req && req.label ? '<button class="owh-primary" data-act="resume">Continue: ' + esc(req.label) + '</button><div class="owh-note owh-autocont">Taking you back in a moment…</div>' : '';
    return '<div class="owh-card owh-funded">' +
      '<div class="owh-kicker">Funded · devnet</div>' +
      '<h3 data-ost-fx-off>' + esc(fmt(f.amount || 100, 2)) + ' OST arrived</h3>' +
      (f.sig ? '<p>Paid on-chain · <a href="' + esc(explorer('tx', f.sig)) + '" target="_blank" rel="noopener">tx ' + esc(short(f.sig)) + ' ↗</a></p>' : '<p>Paid on-chain to your wallet.</p>') +
      cont +
      '<div class="owh-tiles">' +
        '<button data-act="tile-market"><b>📈</b><span>Try a 5-minute market</span></button>' +
        '<button data-act="send"><b>↑</b><span>Send to a friend</span></button>' +
        '<button data-act="tile-bridge"><b>⇄</b><span>Convert OST ⇄ OSTG</span></button>' +
      '</div>' +
      '<div class="owh-links"><button data-act="home">Open my wallet</button></div>' +
      '</div>';
  }
  function connectedHtml(pk) {
    if (S.view === 'backup' && storedLocal()) return backupHtml(pk);
    if (S.view === 'getost') return getOstHtml();
    if (S.view === 'funded') return fundedHtml();
    S.view = 'home';
    var s = session(); var kind = s && s.kind === 'local' ? 'Browser wallet' : ((s && s.label) || 'Wallet');
    var needBackup = s && s.kind === 'local' && !backedUpAt();
    return '' +
      '<div class="owh-card owh-id">' +
        '<div class="owh-idrow"><div class="owh-avatar" style="' + avatarStyle(pk) + '"></div>' +
          '<div class="owh-who"><div class="owh-addr" data-act="copy-addr" title="Copy address">' + esc(short(pk)) + ' <i>⧉</i></div><div class="owh-sub">' + esc(kind) + ' · <span class="owh-net">' + esc(cluster().toUpperCase()) + '</span></div></div>' +
          '<div class="owh-idbtns"><button data-act="receive" title="Receive" aria-label="Receive">⬇</button><a href="' + esc(explorer('address', pk)) + '" target="_blank" rel="noopener" title="Explorer" aria-label="Open in explorer">↗</a><button data-act="menu" title="More" aria-label="More wallet options">⋯</button></div></div>' +
        '<div class="owh-menu" id="owhMenu" hidden>' +
          '<button data-act="copy-addr">Copy address</button>' +
          (s && s.kind === 'local' ? '<button data-act="backup">Back up secret key</button>' : '') +
          '<button data-act="disconnect">Disconnect</button>' +
          (s && s.kind === 'local' ? '<button data-act="forget" class="danger">Forget this browser wallet</button>' : '') +
        '</div>' +
        '<div class="owh-confirm" id="owhConfirm" hidden></div>' +
        (needBackup ? '<div class="owh-warn">No backup yet — this browser wallet is lost if site data is cleared. <button data-act="backup">Back up now</button></div>' : '') +
        '<div class="owh-total"><span>Total</span><strong id="owhTotal">—</strong><em id="owhTotalUsd"></em></div>' +
        '<div class="owh-bals" id="owhBals"></div>' +
        '<div class="owh-actions">' +
          '<button data-act="send"><b>↑</b>Send</button><button data-act="receive"><b>↓</b>Receive</button><button data-act="topup"><b>＋</b>Top up</button><button data-act="faucet" id="owhFaucetBtn"><b>💧</b><span>Get OST</span></button><button data-act="convert"><b>⇄</b>Convert</button>' +
        '</div>' +
        '<div class="owh-status" id="owhStatus" hidden></div>' +
      '</div>' +
      '<div class="owh-card owh-sess" id="owhSess"></div>' +
      '<div class="owh-receive" id="owhReceive" hidden></div>' +
      '<div class="owh-card owh-act"><div class="owh-acthead"><h4>Activity</h4><div class="owh-tabs"><button data-tab="chain"' + (S.actTab === 'chain' ? ' class="on"' : '') + '>On-chain</button><button data-tab="app"' + (S.actTab === 'app' ? ' class="on"' : '') + '>App ledger</button></div><button class="owh-refresh" data-act="act-refresh" title="Refresh" aria-label="Refresh activity">↻</button></div><div id="owhActList"></div></div>';
  }

  function paintBalances() {
    var el = $('owhBals'); if (!el) return;
    var rate = ostUsd();
    var sol = bal('sol'); if (sol == null) sol = S.sol;
    var ostc = bal('onchainOstc'), ostg = bal('onchainOstg'), play = bal('play'), locked = bal('loanLocked');
    var si = sessInfo(); var sess = si && si.exists ? si.balance : undefined;
    var rows = [
      { k: 'OST', v: ostc, d: 2, note: 'on-chain · spend, send, convert' },
      { k: 'OSTG', v: ostg, d: 2, note: 'on-chain · markets & games' },
      { k: 'Play', v: play, d: 2, note: 'games · markets' + (locked > 0 ? ' · ' + fmt(locked) + ' locked' : '') }
    ];
    if (si && si.exists) rows.push({ k: '1-tap', v: sess, d: 2, note: 'session key' });
    // SOL-1: SOL is not needed for anything OST does (C8). It is only for sending
    // SOL or paying SOL -> OST; "Get SOL" = cash out at least 10 OST -> SOL.
    rows.push({ k: 'SOL', v: sol, d: 4, note: 'not needed for OST', sol: true });
    el.innerHTML = rows.map(function (r) {
      return '<div class="owh-bal' + (r.sol ? ' owh-bal-sol' : '') + '"><span>' + r.k + '</span><strong>' + fmt(r.v, r.d) + '</strong><em>' + esc(r.note) + '</em>' +
        (r.sol ? '<button class="owh-getsol" data-act="get-sol" title="Cash out 10 OST to devnet SOL">Get SOL</button>' : '') + '</div>';
    }).join('');
    // C6: the total is known only when BOTH on-chain balances are known — a sum
    // of whatever happened to load (e.g. Play 0) read as "Total 0 OST".
    var tot = 0, known = ostc != null && isFinite(ostc) && ostg != null && isFinite(ostg);
    if (known) [ostc, ostg, play, sess].forEach(function (v) { if (v != null && isFinite(v)) tot += Number(v); });
    var t = $('owhTotal'), tu = $('owhTotalUsd');
    if (t) t.textContent = known ? fmt(tot) + ' OST' : '—';
    // WAL-9 / C7: only the fixed devnet conversion rate, labelled — never the
    // display index (that 20x gap read as a real price).
    if (tu) tu.textContent = !known ? 'reading balances…' : (rate ? '≈ ' + usd(tot * rate) + ' at the devnet conversion rate (1 OST = $' + rate + ') · no cash value' : 'devnet · no cash value');
  }
  function paintSession() {
    var el = $('owhSess'); if (!el) return;
    var si = sessInfo();
    // D4: 1-tap only shows when a session actually exists (the on-chain rail is offline).
    if (!si || !si.exists) { el.hidden = true; el.innerHTML = ''; return; }
    el.hidden = false;
    el.innerHTML = '<div class="owh-sessrow"><div><b>⚡ 1-tap session</b><em>' + fmt(si.balance) + ' OSTG parked in a session key (cap ' + fmt(si.cap) + '). End it to move it back to your wallet.</em></div><button data-act="sess-end">End · refund</button></div>';
  }
  function paintFaucetBtn() {
    var b = $('owhFaucetBtn'); if (!b) return;
    var lbl = b.querySelector('span'); var f = faucetInfo() || {};
    // Short tile labels: the five action tiles are ~60 px wide on a 390 px phone.
    if (S.faucetBusy) { b.disabled = true; if (lbl) lbl.textContent = S.faucetStage === 'sending' ? 'Sending…' : (S.faucetStage === 'confirming' ? 'Pending…' : 'Checking…'); return; }
    if (f.pending) { b.disabled = true; b.title = f.hold ? 'We could not confirm your last claim yet — check your balance' : 'Your claim is confirming'; if (lbl) lbl.textContent = f.hold ? 'Checking…' : 'Pending…'; return; }
    var now = srvNow();
    if (f.welcomeClaimed && f.nextAt > now) { b.disabled = true; b.title = 'Next free OST in ' + countdown(f.nextAt - now); if (lbl) lbl.textContent = 'In ' + countdown(f.nextAt - now); return; }
    b.disabled = false; b.title = f.welcomeClaimed ? 'Claim today\'s 1 OST' : 'Claim 100 free devnet OST'; if (lbl) lbl.textContent = 'Get OST';
  }
  function appLedger() {
    var out = [];
    try { var snaps = JSON.parse(localStorage.getItem('ost.wallet.balanceHistory.v1') || '[]'); (Array.isArray(snaps) ? snaps : []).forEach(function (s) { if (s && s.kind && s.kind !== 'tick') out.push({ ts: Number(s.ts) || 0, label: String(s.kind).replace(/[-_]/g, ' '), amt: Number(s.amount) || null, unit: /sol/i.test(s.kind) && !/ost/i.test(s.kind) ? 'SOL' : 'OST', dir: /^(send|prediction-buy|game-loss|games-deposit|launchpad-buy|ost-to-sol|perp-open|stock-buy|parlay-stake)/.test(s.kind) ? -1 : 1, ok: true, sig: s.sig && /^[1-9A-HJ-NP-Za-km-z]{60,100}$/.test(String(s.sig)) ? String(s.sig) : '' }); }); } catch (_) {}
    try { var orders = JSON.parse(localStorage.getItem('ost.prediction.orders.v1') || '[]'); (Array.isArray(orders) ? orders : []).slice(-40).forEach(function (o) { if (!o) return; out.push({ ts: Number(o.placedAt || o.ts || o.createdAt) || 0, label: 'Market ' + (o.status || 'open') + (o.marketTitle || o.title ? ' · ' + String(o.marketTitle || o.title).slice(0, 48) : ''), amt: Number(o.amount || o.stake) || null, unit: o.unit || 'OST', dir: o.status === 'won' ? 1 : -1, ok: true, sig: '' }); }); } catch (_) {}
    return out.sort(function (a, b) { return b.ts - a.ts; }).slice(0, 60);
  }
  function paintActivity() {
    var el = $('owhActList'); if (!el) return;
    var rows = S.actTab === 'app' ? appLedger() : (S.act.length ? S.act : loadAct());
    if (S.actTab === 'chain' && S.actBusy && !rows.length) { el.innerHTML = '<div class="owh-empty">Reading the chain…</div>'; return; }
    if (!rows.length) { el.innerHTML = '<div class="owh-empty">' + (S.actTab === 'chain' ? (S.actErr ? 'Could not reach the network right now. <button data-act="act-refresh">Retry</button>' : 'No on-chain activity yet. Claim free OST or receive a transfer and it shows here.') : 'Nothing in the app ledger yet.') + '</div>'; return; }
    el.innerHTML = rows.map(function (r) {
      var cls = r.dir > 0 ? 'in' : (r.dir < 0 ? 'out' : 'neu');
      var amt;
      if (r.legs) amt = r.legs.filter(function (l) { return Math.abs(l.amt) > 1e-9; }).map(function (l) { return (l.amt > 0 ? '+' : '−') + fmt(Math.abs(l.amt), 4) + ' ' + esc(l.unit); }).join(' · ');
      else amt = r.amt != null ? (r.dir > 0 ? '+' : (r.dir < 0 ? '−' : '')) + fmt(r.amt, r.unit === 'SOL' ? 4 : 2) + ' ' + esc(r.unit) : '';
      var sub = (r.ts ? ago(r.ts) : '') + (r.from ? ' · from ' + esc(short(r.from)) : '') + (r.sig ? ' · <a href="' + esc(explorer('tx', r.sig)) + '" target="_blank" rel="noopener">' + esc(short(r.sig)) + '</a>' : '');
      return '<div class="owh-tx ' + cls + (r.ok === false ? ' bad' : '') + '"><b>' + (r.legs ? '⇄' : (r.dir > 0 ? '↓' : (r.dir < 0 ? '↑' : '•'))) + '</b><div class="owh-txmain"><span>' + esc(r.label) + '</span><em>' + sub + '</em></div><strong>' + amt + '</strong></div>';
    }).join('') + (S.actTab === 'chain' && S.actBusy ? '<div class="owh-empty">updating…</div>' : '');
  }

  /* ---------- receive sheet (local QR) ---------- */
  function ensureQr() {
    if (typeof window.qrcode === 'function') return Promise.resolve(true);
    return new Promise(function (res) { var s = document.createElement('script'); s.src = 'vendor/qrcode-generator.js'; s.onload = function () { res(typeof window.qrcode === 'function'); }; s.onerror = function () { res(false); }; document.head.appendChild(s); });
  }
  function drawQr(canvas, text) {
    try {
      var qr = window.qrcode(0, 'M'); qr.addData(text); qr.make();
      var n = qr.getModuleCount(), px = Math.max(3, Math.floor(208 / n)), pad = 12, dim = n * px + pad * 2;
      canvas.width = dim; canvas.height = dim; var ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, dim, dim); ctx.fillStyle = '#0b1020';
      for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) if (qr.isDark(r, c)) ctx.fillRect(pad + c * px, pad + r * px, px, px);
      return true;
    } catch (_) { return false; }
  }
  function toggleReceive(show) {
    var box = $('owhReceive'); if (!box) return;
    var pk = pubkey(); if (!pk) return;
    if (show === undefined) show = box.hidden;
    box.hidden = !show; if (!show) return;
    // TRF-5: honest receive note (C6 names: OST = the OST token, OSTG = game token).
    box.innerHTML = '<div class="owh-card"><div class="owh-acthead"><h4>Receive OST, OSTG or SOL</h4><button class="owh-refresh" data-act="receive-close" aria-label="Close">✕</button></div>' +
      '<div class="owh-qrwrap"><canvas id="owhQr" width="232" height="232"></canvas></div>' +
      '<div class="owh-full" data-act="copy-addr">' + esc(pk) + '</div>' +
      '<div class="owh-row2"><button class="owh-primary" data-act="copy-addr">Copy address</button>' + (navigator.share ? '<button class="owh-ghost" data-act="share-addr">Share</button>' : '') + '</div>' +
      '<div class="owh-note">Only send Solana <b>' + esc(cluster()) + '</b> assets to this address. When someone sends you OST or OSTG from the OST app, OST pays the network fee and creates your token account — you need no SOL first. Incoming transfers show in Activity.</div></div>';
    ensureQr().then(function (ok) { var cv = $('owhQr'); if (cv && !(ok && drawQr(cv, pk))) cv.replaceWith(Object.assign(document.createElement('div'), { className: 'owh-empty', textContent: 'QR unavailable — copy the address.' })); });
  }

  /* ---------- navigation helpers ---------- */
  function navigate() {
    try { if (window.OST_COMPARTMENTS && typeof OST_COMPARTMENTS.activate === 'function') OST_COMPARTMENTS.activate('wallet', false); } catch (_) {}
    try { if (typeof window.setWalletPanel === 'function') window.setWalletPanel('access'); } catch (_) {}
    var seq = ++navSeq;
    // Phones: an input that just lost focus (palette search, a form) runs the
    // keyboard-recovery scroll at +120/+380 ms, which cancels a SMOOTH scroll.
    // Scroll instantly on touch devices, then re-check after the recovery and
    // correct once if the wallet card is still off screen.
    var touch = false; try { touch = window.matchMedia('(pointer: coarse)').matches || isMobile(); } catch (_) {}
    var go = function (smooth) {
      var el = $('ostWalletHome');
      if (!el || el.offsetParent === null) return;
      try { el.scrollIntoView({ block: 'start', behavior: smooth ? 'smooth' : 'auto' }); } catch (_) { el.scrollIntoView(); }
    };
    setTimeout(function () { if (seq === navSeq) go(!touch); }, 160);
    setTimeout(function () {
      if (seq !== navSeq) return;
      var el = $('ostWalletHome'); if (!el || el.offsetParent === null) return;
      var top = el.getBoundingClientRect().top;
      if (top < -40 || top > window.innerHeight * 0.6) go(false);
    }, 700);
  }
  var navSeq = 0;
  function goConvert() {
    try { if (window.OST_COMPARTMENTS && typeof OST_COMPARTMENTS.activate === 'function') OST_COMPARTMENTS.activate('wallet', false); } catch (_) {}
    if (typeof window.setWalletPanel === 'function') { window.setWalletPanel('convert', { scroll: true }); return true; }
    var tb = document.querySelector('[data-wallet-panel-target="convert"]'); if (tb) { tb.click(); tb.scrollIntoView({ block: 'start', behavior: 'smooth' }); return true; }
    return false;
  }
  function goBridge() {
    try { if (window.OST_BRIDGE_UI && typeof OST_BRIDGE_UI.open === 'function') { OST_BRIDGE_UI.open(); return; } } catch (_) {}
    goConvert();
    setTimeout(function () { var b = document.querySelector('.ostb-wrap'); if (b) b.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, 300);
  }
  // SOL-1 / C8: "Get SOL" = cash out at least 10 OST -> devnet SOL on the Convert tab.
  function getSol() {
    try { if (window.OST_GET_SOL && typeof OST_GET_SOL.open === 'function') { OST_GET_SOL.open(10); toast('Cash out 10 OST → devnet SOL: review the quote, then confirm. A first cash-out must be at least ~9.2 OST (Solana rent minimum).', 'info'); return; } } catch (_) {}
    goConvert();
    setTimeout(function () {
      var sel = $('transferFrom'), amt = $('transferAmount');
      if (sel && sel.querySelector('option[value="OST"]')) { sel.value = 'OST'; sel.dispatchEvent(new Event('change', { bubbles: true })); }
      if (amt) { amt.value = '10'; amt.dispatchEvent(new Event('input', { bubbles: true })); }
      toast('Cash out 10 OST → devnet SOL: review the quote, then confirm. Solana needs ≥ 0.00089 SOL in a new account, so the first cash-out is at least ~9.2 OST.', 'info');
    }, 350);
  }

  /* ---------- actions ---------- */
  function confirmBox(html, onYes, danger) {
    var c = $('owhConfirm'); if (!c) return;
    c.hidden = false; c.innerHTML = '<div>' + html + '</div><div class="owh-row2"><button class="' + (danger ? 'owh-danger' : 'owh-primary') + '" data-act="confirm-yes">Confirm</button><button class="owh-ghost" data-act="confirm-no">Cancel</button></div>';
    S.onConfirm = onYes;
  }
  function confirmBoxStart(html, onYes) {
    var card = root && root.querySelector('.owh-card'); if (!card) return;
    var old = card.querySelector('.owh-confirm'); if (old) old.remove();
    var c = document.createElement('div'); c.className = 'owh-confirm'; c.innerHTML = '<div>' + html + '</div><div class="owh-row2"><button class="owh-primary" data-act="confirm-yes">Confirm</button><button class="owh-ghost" data-act="confirm-no">Cancel</button></div>';
    card.appendChild(c); S.onConfirm = onYes;
  }
  // Replaced browser wallets stay recoverable on THIS device (max 3, newest
  // first), listed under Restore. Same storage class as the live key.
  var ARCHIVE_KEY = 'ost.localWallet.archive.v1';
  function readArchive() { try { var a = JSON.parse(localStorage.getItem(ARCHIVE_KEY) || '[]'); return Array.isArray(a) ? a.filter(function (x) { return x && Array.isArray(x.secretKey) && x.pubkey; }) : []; } catch (_) { return []; } }
  function archiveLocalKey() {
    var rec = storedLocal(), pk = storedLocalPubkey();
    if (!rec || !pk) return;
    var list = readArchive().filter(function (x) { return x.pubkey !== pk; });
    list.unshift({ pubkey: pk, secretKey: rec.secretKey, at: Date.now(), backedUp: !!backedUpAt() });
    try { localStorage.setItem(ARCHIVE_KEY, JSON.stringify(list.slice(0, 3))); } catch (_) {}
  }
  function forgetLocalKeys() {
    try { localStorage.removeItem(LOCAL_KEY); localStorage.removeItem(BACKUP_KEY); } catch (_) {}
    // WAL-9: the Data Guard keeps a backup copy of the key; drop it too, or the
    // "forgotten" wallet comes back on the next load.
    try { if (window.OST_DATA_GUARD && typeof OST_DATA_GUARD.forget === 'function') { OST_DATA_GUARD.forget(LOCAL_KEY); OST_DATA_GUARD.forget(BACKUP_KEY); } } catch (_) {}
  }
  function finishOnboarding() {
    S.onboarding = false;
    var resumed = false;
    try { resumed = !!(W() && W().resumePending && W().resumePending()); } catch (_) {}
    S.view = 'home'; render();
    return resumed;
  }
  function afterBackupStep() {
    // A gate that is ITSELF the faucet resumes now (it claims on its own card);
    // anything else gets Step 3 (free OST) first so the resumed action has funds.
    var req = null; try { req = W() && W().pendingRequirement ? W().pendingRequirement() : null; } catch (_) {}
    if (!S.onboarding) { S.view = 'home'; render(); return; }
    if (req && req.reason === 'faucet') { finishOnboarding(); return; }
    var f = faucetInfo() || {};
    if (f.welcomeClaimed) { finishOnboarding(); return; }
    S.view = 'getost'; S.status = ''; S.statusKind = ''; render();
  }
  function runFaucet(fromStep) {
    if (typeof window.runOstFaucetFlow !== 'function') { toast('The faucet is still loading — try again in a second.', 'err'); return; }
    if (S.faucetBusy) return;
    S.faucetBusy = true; S.faucetStage = 'checking'; setStatus('Checking your claim…', 'pending');
    if (fromStep) render(); else paintFaucetBtn();
    var onStage = function (stage, info) {
      S.faucetStage = stage;
      var amt = (info && info.amount) || 100;
      if (stage === 'sending') setStatus('Sending ' + amt + ' OST… (a few seconds)', 'pending');
      else if (stage === 'confirming') setStatus('Confirming your claim… don\'t claim again.', 'pending');
      if (S.view === 'getost') render(); else paintFaucetBtn();
    };
    window.runOstFaucetFlow({ animate: false, onStage: onStage }).then(function (r) {
      r = r || {};
      S.faucetBusy = false; S.faucetStage = '';
      if (r.state === 'claimed' || r.ok) {
        setStatus('', '');
        S.funded = { amount: r.amount || 100, sig: r.signature || '' };
        if (fromStep || S.onboarding) { S.view = 'funded'; S.onboarding = false; render(); scheduleAutoResume(); }
        else { setStatus((r.amount || '') + ' OST arrived.', 'ok'); render(); }
      } else {
        // FCT-3: human message, never a raw reason code ('error', 'daily-cooldown').
        var msg = r.message ? r.message + (r.body ? ' ' + r.body : '') : 'The faucet is not available right now.';
        if (r.state === 'cooldown') msg = r.message || 'Already claimed today.';
        S.awaitClaim = r.state === 'pending';   // the watcher moves Step 3 on when it lands
        setStatus(msg, r.state === 'pending' ? 'pending' : (r.state === 'cooldown' ? '' : 'err'));
        if (!r.notified) toast(msg, r.state === 'cooldown' ? 'info' : 'err');
        render();
      }
      refresh(true);
    }, function (e) {
      S.faucetBusy = false; S.faucetStage = '';
      setStatus('The faucet is not available right now. Check your balance before trying again.', 'err');
      console.warn('[wallet-home] faucet', e);
      render();
    });
  }
  var autoTimer = 0;
  function scheduleAutoResume() {
    clearTimeout(autoTimer);
    var req = null; try { req = W() && W().pendingRequirement ? W().pendingRequirement() : null; } catch (_) {}
    if (!req || !req.label) return;
    autoTimer = setTimeout(function () { if (S.view === 'funded') finishOnboarding(); }, 2200);
  }

  function act(name, el) {
    var pk = pubkey();
    switch (name) {
      case 'home': S.view = pk ? 'home' : 'start'; S.reveal = false; render(); break;
      case 'restore': S.view = 'restore'; render(); break;
      case 'local': if (W() && W().connect) W().connect('local').catch(function (e) { toast((e && e.message) || 'Could not open the browser wallet.', 'err'); }); break;
      case 'create':
        if (!W() || !W().createLocal) { toast('Wallet core still loading — try again in a second.', 'err'); return; }
        S.onboarding = true;
        W().createLocal().catch(function (e) { S.onboarding = false; toast((e && e.message) || 'Could not create a wallet.', 'err'); });
        break;
      case 'create-new': {
        var oldPk = storedLocalPubkey();
        var unsaved = !backedUpAt();
        // Review fix: a download cannot be verified (in-app browsers and some
        // iOS contexts block or drop it). An un-backed-up key is only replaced
        // after an explicit "I saved this key", and the old key is archived on
        // this device (Restore lists it) instead of being deleted outright.
        confirmBoxStart('Start a new browser wallet? The current one <b>' + esc(short(oldPk)) + '</b> will be replaced in this browser.' +
          (unsaved ? ' It was <b>never backed up</b> — save its key first:' +
            '<div class="owh-row2"><button class="owh-ghost" data-act="cn-download">Download backup</button>' + (base58Secret() ? '<button class="owh-ghost" data-act="cn-copy">Copy key (Phantom format)</button>' : '') + '</div>' +
            '<label class="owh-check"><input type="checkbox" id="owhCnSaved"> I saved this key somewhere safe</label>' : ''), function () {
          try {
            archiveLocalKey();
            forgetLocalKeys();
            S.onboarding = true;
            W().createLocal().catch(function (e) { toast((e && e.message) || 'Could not create a wallet.', 'err'); });
          } catch (e) { toast(String(e && e.message || e), 'err'); }
        });
        S.confirmGuard = unsaved ? function () {
          var cb = $('owhCnSaved');
          if (cb && cb.checked) return true;
          toast('Save the current key first, then tick "I saved this key".', 'err');
          return false;
        } : null;
        break;
      }
      case 'cn-download': { var rr = storedLocal(); if (rr) { download(backupFileName(storedLocalPubkey()), JSON.stringify(rr.secretKey)); toast('Backup downloading — check that the file was saved, then tick the box.', 'info'); } break; }
      case 'cn-copy': { var kk = base58Secret(); if (kk) copy(kk, 'Secret key copied (Phantom format)'); break; }
      case 'use-archived': {
        var idx = Number(el.getAttribute('data-i'));
        var arc = readArchive()[idx];
        if (!arc) break;
        var curA = storedLocalPubkey();
        if (curA && curA !== arc.pubkey && !backedUpAt()) { toast('The current browser wallet has no backup — back it up first (⋯ → Back up secret key).', 'err'); break; }
        try {
          if (curA && curA !== arc.pubkey) archiveLocalKey();
          localStorage.setItem(LOCAL_KEY, JSON.stringify({ createdAt: Date.now(), secretKey: arc.secretKey }));
          try { localStorage.removeItem(BACKUP_KEY); } catch (_) {}
          S.view = 'home';
          W().connect('local').then(function () { toast('Wallet restored · ' + short(arc.pubkey), 'ok'); render(); }, function (e) { toast((e && e.message) || 'Restored, but could not connect it.', 'err'); });
        } catch (e) { toast(String(e && e.message || e), 'err'); }
        break;
      }
      case 'ext': connectExt(el.getAttribute('data-w')); break;
      case 'backup-current': { var rec = storedLocal(); if (rec) { download(backupFileName(storedLocalPubkey()), JSON.stringify(rec.secretKey)); markBackedUp(); toast('Backup downloaded — keep it offline.', 'ok'); render(); } break; }
      case 'restore-go': {
        var f = $('owhFile'), p = $('owhPaste'), ok = $('owhReplaceOk');
        var cur = storedLocalPubkey();
        var go = function (text, fromFile) {
          try {
            var kp = parseSecret(text); var npk = kp.publicKey.toBase58();
            // WAL-5: never silently replace a different wallet.
            if (cur && cur !== npk && !(ok && ok.checked)) { toast('Tick the box to replace the current browser wallet' + (backedUpAt() ? '.' : ' — it has no backup, download it first.'), 'err'); return; }
            if (cur && cur !== npk) archiveLocalKey();   // the replaced key stays recoverable here
            writeLocal(kp);
            // WAL-9: restoring FROM a backup means a backup exists.
            if (cur !== npk) { try { localStorage.removeItem(BACKUP_KEY); } catch (_) {} }
            if (fromFile) markBackedUp();
            S.view = 'home';
            W().connect('local').then(function () { toast('Wallet restored · ' + short(npk), 'ok'); render(); }, function (e) { toast((e && e.message) || 'Restored, but could not connect it.', 'err'); });
          } catch (e) { toast(String(e && e.message || e), 'err'); }
        };
        if (f && f.files && f.files[0]) f.files[0].text().then(function (t) { go(t, true); }, function () { toast('Could not read that file.', 'err'); }); else go(p && p.value, false);
        break;
      }
      case 'backup': S.view = 'backup'; S.reveal = false; S.onboarding = false; render(); break;
      case 'dl-backup': { var r2 = storedLocal(); if (!r2) return; download(backupFileName(pk), JSON.stringify(r2.secretKey)); markBackedUp(); toast('Backup downloaded — keep it offline.', 'ok'); render(); break; }
      case 'copy-b58': { var k = base58Secret(); if (k) copy(k, 'Secret key copied (Phantom format)', function () { markBackedUp(); render(); }); break; }
      case 'reveal': S.reveal = !S.reveal; render(); break;
      case 'backup-next': afterBackupStep(); break;
      case 'getost-go': runFaucet(true); break;
      case 'finish': finishOnboarding(); break;
      case 'resume': clearTimeout(autoTimer); finishOnboarding(); break;
      case 'tile-market': S.view = 'home'; render(); try { location.hash = '#markets'; } catch (_) {} break;
      case 'tile-bridge': S.view = 'home'; render(); goBridge(); break;
      case 'copy-addr': if (pk) copy(pk, 'Address copied'); break;
      case 'share-addr': if (pk && navigator.share) navigator.share({ title: 'My OST wallet', text: pk }).catch(function () {}); break;
      case 'menu': { var m = $('owhMenu'); if (m) m.hidden = !m.hidden; break; }
      case 'disconnect': {
        var m2 = $('owhMenu'); if (m2) m2.hidden = true;
        confirmBox('Disconnect this wallet from OST?' + (session() && session().kind === 'local' ? ' Your browser wallet stays saved here; open it again from Wallet.' : ' It stays disconnected until you connect again.'), function () { if (W() && W().disconnect) W().disconnect(); });
        break;
      }
      case 'forget': {
        var m3 = $('owhMenu'); if (m3) m3.hidden = true;
        confirmBox('<b>Remove this browser wallet from this device?</b> ' + (backedUpAt() ? 'You will need your backup to get it back.' : 'It was <b>never backed up</b>: any OST in it is lost for good. Download the backup first.'), function () {
          var wasLocal = session() && session().kind === 'local';
          forgetLocalKeys();
          if (wasLocal && W() && W().disconnect) W().disconnect();
          toast('Browser wallet removed from this device.', 'ok'); S.view = 'start'; setTimeout(render, 80);
        }, true);
        break;
      }
      case 'confirm-yes': { if (S.confirmGuard && !S.confirmGuard()) break; S.confirmGuard = null; var fn = S.onConfirm; S.onConfirm = null; var c = el.closest('.owh-confirm'); if (c) { if (c.id === 'owhConfirm') c.hidden = true; else c.remove(); } if (fn) fn(); break; }
      case 'confirm-no': { S.onConfirm = null; S.confirmGuard = null; var c2 = el.closest('.owh-confirm'); if (c2) { if (c2.id === 'owhConfirm') c2.hidden = true; else c2.remove(); } break; }
      case 'send': {
        if (!pk) { if (W() && W().requireWallet) W().requireWallet({ reason: 'send' }); return; }
        if (S.view !== 'home') { S.view = 'home'; render(); }
        var sb = $('wdSendBtn'); if (sb) sb.click(); else toast('Send is loading — try again in a second.', 'err');
        break;
      }
      case 'receive': toggleReceive(); break;
      case 'receive-close': toggleReceive(false); break;
      case 'topup': if (typeof window.openTopUpModal === 'function') window.openTopUpModal(); else toast('Top-up is loading — try again in a second.', 'err'); break;
      case 'faucet': runFaucet(false); break;
      case 'get-sol': getSol(); break;
      case 'convert': goConvert(); break;
      case 'sess-end':
        el.disabled = true; el.textContent = 'Refunding…';
        window.OST_SESSION.end().then(function (r) { var sw = r && r.swept; toast('Session ended' + (sw && sw.ost ? ' · ' + fmt(sw.ost) + ' OSTG back in your wallet' : '') + '.', 'ok'); refresh(true); }).catch(function (e) { toast((e && e.message) || 'Could not end the session', 'err'); }).then(function () { paintSession(); });
        break;
      case 'act-refresh': refreshActivity(true); break;
    }
  }
  function wire() {
    if (!root || root.__wired) return; root.__wired = true;
    root.addEventListener('click', function (e) {
      var t = e.target.closest('[data-act],[data-tab]'); if (!t || !root.contains(t)) return;
      if (t.hasAttribute('data-tab')) { S.actTab = t.getAttribute('data-tab'); render(); return; }
      e.preventDefault(); act(t.getAttribute('data-act'), t);
    });
    // WAL-9: show the picked backup file's name.
    root.addEventListener('change', function (e) {
      if (e.target && e.target.id === 'owhFile') {
        var n = $('owhFileName'), f = e.target.files && e.target.files[0];
        if (n) n.textContent = f ? '📄 ' + f.name : 'Choose backup file…';
      }
    });
  }

  /* ---------- lifecycle ---------- */
  var lastPk = null;
  function refresh(force) {
    var pk = pubkey();
    if (pk !== lastPk) {
      lastPk = pk; S.act = []; S.seen = null; S.status = ''; S.statusKind = ''; S.sol = undefined; S.solAt = 0; setBusy('');
      if (pk) S.view = /^(backup|getost|funded)$/.test(S.view) ? S.view : 'home';
      else { S.view = S.view === 'restore' ? 'restore' : 'start'; S.onboarding = false; }
      render();
      if (pk) { refreshActivity(true); watch(); } else unwatch();
    }
    if (!pk) return;
    try { if (window.OST_BALANCE) OST_BALANCE.refresh(!!force); } catch (_) {}
    try { if (window.OST_SESSION && OST_SESSION.refresh) OST_SESSION.refresh(); } catch (_) {}
    readSol(force); paintBalances(); paintSession(); paintFaucetBtn();
  }
  function idle() { try { return !!(window.OST_IDLE_GUARD && OST_IDLE_GUARD.isGated && OST_IDLE_GUARD.isGated()); } catch (_) { return false; } }
  function open(view, opts) {
    opts = opts || {};
    var pk = pubkey();
    if (view === 'convert') { goConvert(); return; }
    if (view === 'send') { act('send'); return; }
    if (view === 'receive') { S.view = pk ? 'home' : 'start'; navigate(); render(); if (pk) toggleReceive(true); return; }
    if (view === 'start' && pk) view = 'home';
    if (view === 'backup' && !storedLocal()) view = pk ? 'home' : 'start';
    if (/^(getost|funded)$/.test(view) && !pk) view = 'start';
    if (view === 'backup') { S.reveal = false; if (opts.onboarding != null) S.onboarding = !!opts.onboarding; }
    S.view = view || (pk ? 'home' : 'start');
    S.reason = opts.label || '';
    setBusy('');
    navigate(); render();
  }
  function mount() {
    var dash = $('walletDashboard'); if (!dash || $('ostWalletHome')) return;
    var host = document.createElement('div'); host.id = 'ostWalletHome'; host.className = 'owh';
    // Devnet OST has no cash value: no automatic "≈ $x" hints (ost-fx.js) here —
    // the only rate shown is the labelled devnet conversion rate.
    host.setAttribute('data-ost-fx-off', '');
    dash.insertBefore(host, dash.firstChild); dash.classList.add('owh-on');
    lastPk = pubkey();
    render(); if (lastPk) { refreshActivity(true); watch(); } refresh(true);
    // A request made before this module loaded (app.js openWalletHome fallback).
    var want = window.__ostWalletHomeWant; window.__ostWalletHomeWant = null;
    if (want && want.view) open(want.view, want.opts);
    ['ost:wallet-changed', 'ost:wallet-ready', 'ost:wallet-disconnected'].forEach(function (ev) { window.addEventListener(ev, function () { setTimeout(function () { refresh(true); }, 60); }); });
    window.addEventListener('ost:wallet-connect-failed', function () { setBusy(S.busyHtml ? S.busy : '', S.busyHtml); });
    window.addEventListener('ost:balance', function () { paintBalances(); });
    window.addEventListener('ost:session:change', function () { paintBalances(); paintSession(); });
    window.addEventListener('ost:session:funded', function () { refresh(true); });
    window.addEventListener('ost:faucet-state-synced', function () {
      paintFaucetBtn();
      // Step 3 waiting on a claim that settled from the server record (after a
      // reload or a slow confirm): move on to "funded" once it is recorded.
      if (S.view === 'getost' && !S.faucetBusy && S.awaitClaim) {
        var f = faucetInfo() || {};
        if (f.welcomeClaimed && !f.pending) {
          S.awaitClaim = false;
          var sig = ''; try { var c = (JSON.parse(localStorage.getItem(CLAIMS_KEY) || '{}') || {})[pubkey()] || {}; sig = c.lastSignature || ''; } catch (_) {}
          S.funded = { amount: 100, sig: sig }; S.view = 'funded'; S.onboarding = false; setStatus('', ''); render(); scheduleAutoResume();
        } else render();
      }
    });
    ['ost:money:change', 'ost:play:balance', 'ost:prediction:order-changed', 'ost-tx-history-update'].forEach(function (ev) { window.addEventListener(ev, function () { paintBalances(); if (S.actTab === 'app') paintActivity(); }); });
    window.addEventListener('ost:wallet-tx', function () { setTimeout(function () { refresh(true); }, 2500); refreshUntilNew([2500, 6000, 12000]); });
    // NET-3: at most one refresh a minute, only while visible and not idle.
    // Activity (3 getSignaturesForAddress) only while the wallet home is on
    // screen; push (account change) and ost:wallet-tx cover the rest.
    setInterval(function () { if (!document.hidden && !idle() && pubkey()) { refresh(false); if (root && root.offsetParent !== null && S.view === 'home') refreshActivity(false); } }, 60000);
    // The faucet countdown label (no network).
    setInterval(function () { if (!document.hidden && S.view === 'home') paintFaucetBtn(); }, 30000);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) { refresh(false); watch(); } else unwatch(); });
    if (W() && typeof W().onReady === 'function') W().onReady(function () { setTimeout(function () { refresh(true); }, 30); });
  }
  window.OST_WALLET_HOME = { render: render, refresh: refresh, open: open, view: function () { return S.view; } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true }); else mount();
})();

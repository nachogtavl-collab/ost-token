/* ==========================================================================
 * OST · Wallet home — one clear wallet surface (all devices)
 * --------------------------------------------------------------------------
 * Replaces the journey/intelligence/route-matrix maze on the Access tab with:
 *   · Get started: Create OST wallet (explicit backup step, no forced download),
 *     Connect Phantom/Solflare/Backpack (extension on desktop, universal link
 *     into the wallet's in-app browser on phones), Restore (overwrite-guarded).
 *   · Identity card: avatar, address, wallet type, DEVNET badge, local QR.
 *   · Balances from OST_BALANCE truth (unknown renders "—", never 0).
 *   · Actions: Send, Receive, Top up, Devnet OST, Convert.
 *   · 1-tap status (session key) with End; backup reminder for browser wallets.
 *   · Activity: REAL on-chain history (getSignaturesForAddress + parsed
 *     transfers), cached per wallet, plus the app ledger.
 * Everything routes through app.js / wallet-extras hooks (hidden legacy
 * controls, OST_WALLET, OST_BALANCE, OST_SESSION); nothing here moves money.
 * window.OST_WALLET_HOME.{ render, refresh, open }
 * ========================================================================== */
(function () {
  'use strict';
  if (window.OST_WALLET_HOME) return;

  var LOCAL_KEY = 'ost.localWallet.v1';
  var BACKUP_KEY = 'ost.localWallet.backupExportedAt';
  var ACT_KEY = 'ost.wallet.activity.v2:';
  var OSTG_MINT = 'DfgxMbdN49AX2Za9LuvsyixF1jgVh45RbgWYSGonxQos';
  var MOBILE = '(max-width: 820px), (pointer: coarse) and (max-width: 1024px)';

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function w3() { return window.solanaWeb3; }
  function W() { return window.OST_WALLET; }
  function isMobile() { try { return window.matchMedia(MOBILE).matches || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent); } catch (_) { return false; } }
  function isIos() { return /iPhone|iPad|iPod/i.test(navigator.userAgent); }
  function pubkey() { try { return (W() && W().pubkey && W().pubkey()) || window.OST_WALLET_PUBKEY || null; } catch (_) { return null; } }
  function session() { try { return W() && W().session; } catch (_) { return null; } }
  function cluster() { try { return (window.OST_CONFIG && OST_CONFIG.network) || 'devnet'; } catch (_) { return 'devnet'; } }
  function explorer(kind, v) { var c = cluster(); return 'https://explorer.solana.com/' + kind + '/' + v + (c === 'mainnet-beta' ? '' : '?cluster=' + c); }
  function short(a) { a = String(a || ''); return a.length > 12 ? a.slice(0, 4) + '…' + a.slice(-4) : a; }
  function fmt(v, d) { return (v === undefined || v === null || !isFinite(Number(v))) ? '—' : Number(v).toLocaleString(undefined, { maximumFractionDigits: d == null ? 2 : d, minimumFractionDigits: 0 }); }
  function usd(n) { return (n == null || !isFinite(n)) ? '' : '$' + Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function ago(ts) { var s = Math.max(0, (Date.now() - ts) / 1000); if (s < 60) return 'now'; if (s < 3600) return Math.floor(s / 60) + 'm'; if (s < 86400) return Math.floor(s / 3600) + 'h'; if (s < 86400 * 30) return Math.floor(s / 86400) + 'd'; return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); }

  var toastHost;
  function toast(msg, kind) {
    try {
      if (!toastHost) { toastHost = document.createElement('div'); toastHost.className = 'owh-toasts'; document.body.appendChild(toastHost); }
      var t = document.createElement('div'); t.className = 'owh-toast' + (kind ? ' ' + kind : ''); t.textContent = msg; toastHost.appendChild(t);
      setTimeout(function () { t.classList.add('out'); setTimeout(function () { t.remove(); }, 300); }, 3200);
    } catch (_) {}
  }
  function copy(text, label) {
    var done = function () { toast((label || 'Copied') + ' · ' + short(text)); };
    try { if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text).then(done, function () { fallback(); }); } catch (_) {}
    fallback();
    function fallback() { try { var ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); done(); } catch (_) { toast('Copy failed — long-press the address instead.', 'err'); } }
  }

  /* ---------- local (browser) wallet helpers — same storage app.js uses ---------- */
  function storedLocal() { try { var r = JSON.parse(localStorage.getItem(LOCAL_KEY) || 'null'); return r && Array.isArray(r.secretKey) && r.secretKey.length ? r : null; } catch (_) { return null; } }
  function storedLocalPubkey() { var r = storedLocal(); if (!r || !w3()) return null; try { return w3().Keypair.fromSecretKey(Uint8Array.from(r.secretKey)).publicKey.toBase58(); } catch (_) { return null; } }
  function backedUpAt() { try { return Number(localStorage.getItem(BACKUP_KEY) || 0) || 0; } catch (_) { return 0; } }
  function markBackedUp() { try { localStorage.setItem(BACKUP_KEY, String(Date.now())); } catch (_) {} }
  function writeLocal(kp) { localStorage.setItem(LOCAL_KEY, JSON.stringify({ createdAt: Date.now(), secretKey: Array.from(kp.secretKey) })); }
  function clickOption(type) {
    // app.js owns connect(): drive its hidden modal buttons so one code path
    // sets the session, announces it and attaches provider events.
    var b = document.querySelector('.wallet-option[data-wallet="' + type + '"]') || document.querySelector('.wd-connect-btn[data-wallet="' + type + '"]');
    if (!b) { toast('Wallet core not ready — reload the page.', 'err'); return false; }
    b.click(); return true;
  }
  function download(name, text) {
    var blob = new Blob([text], { type: 'application/json' }); var url = URL.createObjectURL(blob);
    var a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(url); }, 0);
  }
  function parseSecret(text) {
    var t = String(text || '').trim(); if (!t) throw new Error('Paste or pick a backup first.');
    var bytes = null;
    if (t[0] === '[' || t[0] === '{') { var p = JSON.parse(t); var arr = Array.isArray(p) ? p : (p && p.secretKey); if (!Array.isArray(arr)) throw new Error('Not an OST backup.'); bytes = Uint8Array.from(arr.map(Number)); }
    else if (/^[0-9a-f]{128}$/i.test(t)) { bytes = new Uint8Array(64); for (var i = 0; i < 64; i++) bytes[i] = parseInt(t.substr(i * 2, 2), 16); }
    else if (/^[\d,\s]+$/.test(t)) { bytes = Uint8Array.from(t.split(/[,\s]+/).filter(Boolean).map(Number)); }
    else { var bs = w3() && w3().utils && w3().utils.bytes && w3().utils.bytes.bs58; if (!bs) throw new Error('Base58 keys need the full wallet core — paste the JSON backup instead.'); bytes = Uint8Array.from(bs.decode(t)); }
    if (bytes.length !== 64) throw new Error('A secret key is 64 bytes — this is ' + bytes.length + '.');
    return w3().Keypair.fromSecretKey(bytes);
  }

  /* ---------- providers / deep links ---------- */
  var WALLETS = {
    phantom: { label: 'Phantom', ico: '👻', has: function () { return !!((window.phantom && window.phantom.solana) || (window.solana && window.solana.isPhantom)); }, ul: function (u, r) { return 'https://phantom.app/ul/browse/' + u + '?ref=' + r; }, dl: 'https://phantom.app/download' },
    solflare: { label: 'Solflare', ico: '☀️', has: function () { return !!(window.solflare && window.solflare.isSolflare); }, ul: function (u, r) { return 'https://solflare.com/ul/v1/browse/' + u + '?ref=' + r; }, dl: 'https://solflare.com/download' },
    backpack: { label: 'Backpack', ico: '🎒', has: function () { return !!window.backpack; }, ul: function (u, r) { return 'https://backpack.app/ul/v1/browse/' + u + '?ref=' + r; }, dl: 'https://www.backpack.app/download' }
  };
  function connectExt(type) {
    var wdef = WALLETS[type]; if (!wdef) return;
    if (wdef.has()) { setBusy('Approve the connection in ' + wdef.label + '…'); clickOption(type); setTimeout(function () { setBusy(''); }, 4000); return; }
    if (isMobile()) {
      // No injected provider = regular mobile browser. Hand this page to the
      // wallet's in-app browser (universal link); it injects the provider there.
      var here = location.href.split('#')[0] + '#wallet';
      var link = wdef.ul(encodeURIComponent(here), encodeURIComponent(location.origin));
      toast('Opening ' + wdef.label + '… connect from inside its browser.');
      try { window.location.href = link; } catch (_) { window.open(link, '_blank'); }
      return;
    }
    toast(wdef.label + ' is not installed in this browser.');
    window.open(wdef.dl, '_blank', 'noopener');
  }

  /* ---------- state ---------- */
  var S = { view: 'home', sol: undefined, solAt: 0, ostUsd: null, solUsd: null, act: [], actTab: 'chain', actBusy: false, actErr: '', reveal: false, confirm: '', busy: '' };
  var root;

  function prices() {
    try { var T = window.OST_TOPUP; if (T) { var a = typeof T.usdPerOst === 'function' ? T.usdPerOst() : T.usdPerOst; var b = typeof T.solUsd === 'function' ? T.solUsd() : T.solUsd; if (a > 0) S.ostUsd = Number(a); if (b > 0) S.solUsd = Number(b); } } catch (_) {}
    if (!S.ostUsd) { try { var el = $('ostLivePrice'); var m = el && /\$?([\d.]+)/.exec(el.textContent || ''); if (m && Number(m[1]) > 0) S.ostUsd = Number(m[1]); } catch (_) {} }
  }
  function bal(name) { try { return window.OST_BALANCE && OST_BALANCE[name] ? OST_BALANCE[name]() : undefined; } catch (_) { return undefined; } }
  function sessInfo() { try { return window.OST_SESSION && OST_SESSION.status ? OST_SESSION.status() : null; } catch (_) { return null; } }
  function readSol(force) {
    var pk = pubkey(); if (!pk || !W() || !W().rpcCall || !w3()) return Promise.resolve();
    if (!force && Date.now() - S.solAt < 15000) return Promise.resolve();
    S.solAt = Date.now();
    return W().rpcCall(function (c) { return c.getBalance(new (w3().PublicKey)(pk)); }).then(function (l) { if (typeof l === 'number') { S.sol = l / 1e9; paintBalances(); } }).catch(function () {});
  }

  /* ---------- on-chain activity ---------- */
  function actKey() { return ACT_KEY + (pubkey() || ''); }
  function loadAct() { try { var r = JSON.parse(localStorage.getItem(actKey()) || 'null'); return r && Array.isArray(r.rows) ? r.rows : []; } catch (_) { return []; } }
  function saveAct(rows) { try { localStorage.setItem(actKey(), JSON.stringify({ at: Date.now(), rows: rows.slice(0, 60) })); } catch (_) {} }
  function parseTx(sig, tx, pk) {
    var row = { sig: sig, ts: 0, label: 'Program activity', amt: null, unit: '', dir: 0, ok: true, memo: '' };
    if (!tx) return row;
    row.ts = tx.blockTime ? tx.blockTime * 1000 : 0; row.ok = !(tx.meta && tx.meta.err);
    var meta = tx.meta || {}, msg = (tx.transaction && tx.transaction.message) || {};
    var keys = msg.accountKeys || [];
    var ostc = null; try { ostc = window.OST_CONFIG && OST_CONFIG.mint; } catch (_) {}
    function tokDelta(mint) {
      var pre = 0, post = 0, seen = false;
      (meta.preTokenBalances || []).forEach(function (b) { if (b.owner === pk && b.mint === mint) { pre += Number(b.uiTokenAmount && b.uiTokenAmount.uiAmount) || 0; seen = true; } });
      (meta.postTokenBalances || []).forEach(function (b) { if (b.owner === pk && b.mint === mint) { post += Number(b.uiTokenAmount && b.uiTokenAmount.uiAmount) || 0; seen = true; } });
      return seen ? post - pre : 0;
    }
    var dg = tokDelta(OSTG_MINT), dc = ostc ? tokDelta(ostc) : 0;
    var idx = -1; for (var i = 0; i < keys.length; i++) { var k = keys[i]; var ks = k && k.pubkey ? (k.pubkey.toBase58 ? k.pubkey.toBase58() : String(k.pubkey)) : String(k); if (ks === pk) { idx = i; break; } }
    var ds = (idx >= 0 && meta.preBalances && meta.postBalances) ? (meta.postBalances[idx] - meta.preBalances[idx]) / 1e9 : 0;
    try { (msg.instructions || []).concat([].concat.apply([], (meta.innerInstructions || []).map(function (x) { return x.instructions || []; }))).forEach(function (ix) { if (ix && ix.program === 'spl-memo' && typeof ix.parsed === 'string' && !row.memo) row.memo = ix.parsed.slice(0, 160); }); } catch (_) {}
    var kind = ''; try { var mj = JSON.parse(row.memo); kind = String((mj && mj.k) || ''); } catch (_) {}
    var KIND = { 'ost-topup': 'Top-up delivered', 'ost-bet': 'Market ticket', 'prediction-settlement': 'Market payout', 'prediction-sell': 'Market sell', 'ost-new-here': 'Faucet claim', 'faucet-hub-cashout': 'Credits cash-out', 'memecoin-buy': 'Memecoin buy', 'memecoin-sell': 'Memecoin sell', 'sol-to-ost': 'Converted SOL → OST', 'ost-to-sol': 'Converted OST → SOL', 'peer-transfer': 'Peer transfer', 'treasury-deposit': 'Treasury deposit' };
    if (Math.abs(dg) > 1e-9) { row.amt = Math.abs(dg); row.unit = 'OSTG'; row.dir = dg > 0 ? 1 : -1; }
    else if (Math.abs(dc) > 1e-9) { row.amt = Math.abs(dc); row.unit = 'OST'; row.dir = dc > 0 ? 1 : -1; }
    else if (Math.abs(ds) > 0.00001) { row.amt = Math.abs(ds); row.unit = 'SOL'; row.dir = ds > 0 ? 1 : -1; }
    row.label = KIND[kind] || (row.unit ? (row.dir > 0 ? 'Received ' : 'Sent ') + row.unit : (idx === 0 ? 'Transaction' : 'Program activity'));
    if (!row.ok) row.label = 'Failed · ' + row.label;
    return row;
  }
  function refreshActivity(force) {
    var pk = pubkey(); if (!pk || S.actBusy || !W() || !W().rpcCall || !w3()) return Promise.resolve();
    S.actBusy = true; S.actErr = ''; paintActivity();
    var have = loadAct(); var known = {}; have.forEach(function (r) { known[r.sig] = r; });
    return W().rpcCall(function (c) { return c.getSignaturesForAddress(new (w3().PublicKey)(pk), { limit: 25 }); })
      .then(function (sigs) {
        sigs = sigs || [];
        var fresh = sigs.filter(function (s) { return !known[s.signature]; }).slice(0, 12);
        var p = fresh.length ? W().rpcCall(function (c) { return c.getParsedTransactions(fresh.map(function (s) { return s.signature; }), { maxSupportedTransactionVersion: 0 }); }) : Promise.resolve([]);
        return p.then(function (txs) {
          fresh.forEach(function (s, i) { var r = parseTx(s.signature, txs && txs[i], pk); if (!r.ts && s.blockTime) r.ts = s.blockTime * 1000; if (s.err) r.ok = false; known[s.signature] = r; });
          // Keep rows the chain still lists (plus older cached ones), newest first.
          var rows = Object.keys(known).map(function (k) { return known[k]; }).sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); });
          S.act = rows; saveAct(rows);
        });
      })
      .catch(function (e) { S.actErr = (e && e.message) || 'RPC busy'; })
      .then(function () { S.actBusy = false; paintActivity(); });
  }

  /* ---------- rendering ---------- */
  function avatarStyle(pk) { var h = 0; for (var i = 0; i < pk.length; i++) h = (h * 31 + pk.charCodeAt(i)) >>> 0; var a = h % 360, b = (h >> 8) % 360; return 'background:linear-gradient(135deg,hsl(' + a + ',70%,55%),hsl(' + b + ',80%,45%))'; }
  function setBusy(t) { S.busy = t; var b = root && root.querySelector('.owh-busy'); if (b) { b.textContent = t; b.style.display = t ? '' : 'none'; } }

  function render() {
    root = $('ostWalletHome'); if (!root) return;
    var pk = pubkey();
    root.innerHTML = pk ? connectedHtml(pk) : startHtml();
    wire();
    if (pk) { paintBalances(); paintSession(); paintActivity(); }
  }

  function startHtml() {
    var local = storedLocalPubkey();
    var v = S.view;
    if (v === 'restore') return restoreHtml();
    return '<div class="owh-card owh-start">' +
      '<div class="owh-kicker">Solana devnet · OST</div>' +
      '<h3>Your OST wallet</h3>' +
      '<p>One address for everything on OST: markets, games, perps and the faucet. Pick the way in that fits you — it takes under a minute.</p>' +
      (local ? '<button class="owh-primary" data-act="local">Open my browser wallet <small>' + esc(short(local)) + '</small></button>' : '<button class="owh-primary" data-act="create">Create OST wallet <small>new keys stay in this browser</small></button>') +
      '<div class="owh-or">or connect a wallet you already have</div>' +
      '<div class="owh-ext">' + Object.keys(WALLETS).map(function (k) { var d = WALLETS[k]; var st = d.has() ? 'detected' : (isMobile() ? 'opens the app' : 'install'); return '<button data-act="ext" data-w="' + k + '"><b>' + d.ico + '</b><span>' + d.label + '</span><em>' + st + '</em></button>'; }).join('') + '</div>' +
      '<div class="owh-links">' + (local ? '<button data-act="create-new">Start a different browser wallet</button>' : '') + '<button data-act="restore">Restore from a backup</button></div>' +
      '<div class="owh-busy" style="display:none"></div>' +
      '<div class="owh-note">Devnet only: OST here has no cash value and nothing you do costs real money. Browser wallets live in this browser — back them up before you rely on them.</div>' +
      '</div>';
  }
  function restoreHtml() {
    var cur = storedLocalPubkey();
    return '<div class="owh-card owh-start">' +
      '<button class="owh-back" data-act="home">‹ Back</button>' +
      '<h3>Restore a wallet</h3>' +
      '<p>Pick the backup file OST gave you (a JSON list of 64 numbers) or paste a secret key.</p>' +
      (cur ? '<div class="owh-warn">This browser already holds wallet <b>' + esc(short(cur)) + '</b>' + (backedUpAt() ? '' : ' which was <b>never backed up</b>') + '. Restoring replaces it. <button data-act="backup-current">Download its backup first</button></div>' : '') +
      '<label class="owh-file"><input type="file" id="owhFile" accept="application/json,.json,.txt"><span>Choose backup file…</span></label>' +
      '<textarea id="owhPaste" rows="3" placeholder="…or paste the secret key (JSON array, hex or base58)"></textarea>' +
      '<label class="owh-check' + (cur ? '' : ' hide') + '"><input type="checkbox" id="owhReplaceOk"> I understand this replaces the current browser wallet</label>' +
      '<button class="owh-primary" data-act="restore-go">Restore wallet</button>' +
      '<div class="owh-busy" style="display:none"></div>' +
      '</div>';
  }
  function backupHtml(pk) {
    var rec = storedLocal(); var secret = rec ? JSON.stringify(rec.secretKey) : '';
    return '<div class="owh-card owh-backup">' +
      '<div class="owh-kicker">Step 2 of 2</div><h3>Back up your wallet</h3>' +
      '<p>Your wallet <b>' + esc(short(pk)) + '</b> exists only in this browser. Clearing site data or losing this device loses it — unless you keep a copy of the secret key.</p>' +
      '<div class="owh-row2"><button class="owh-primary" data-act="dl-backup">Download backup file</button><button class="owh-ghost" data-act="reveal">' + (S.reveal ? 'Hide secret key' : 'Show secret key') + '</button></div>' +
      (S.reveal ? '<textarea class="owh-secret" readonly>' + esc(secret) + '</textarea><button class="owh-ghost" data-act="copy-secret">Copy secret key</button>' : '') +
      '<div class="owh-note">Never share this key. Anyone who has it controls the wallet.</div>' +
      '<button class="owh-ghost" data-act="home">' + (backedUpAt() ? 'Done' : 'Skip for now (you will be reminded)') + '</button>' +
      '</div>';
  }
  function connectedHtml(pk) {
    if (S.view === 'backup') return backupHtml(pk);
    var s = session(); var kind = s && s.kind === 'local' ? 'Browser wallet' : ((s && s.label) || 'Wallet');
    var needBackup = s && s.kind === 'local' && !backedUpAt();
    return '' +
      '<div class="owh-card owh-id">' +
        '<div class="owh-idrow"><div class="owh-avatar" style="' + avatarStyle(pk) + '"></div>' +
          '<div class="owh-who"><div class="owh-addr" data-act="copy-addr" title="Copy address">' + esc(short(pk)) + ' <i>⧉</i></div><div class="owh-sub">' + esc(kind) + ' · <span class="owh-net">' + esc(cluster().toUpperCase()) + '</span></div></div>' +
          '<div class="owh-idbtns"><button data-act="receive" title="Receive">⬇</button><a href="' + esc(explorer('address', pk)) + '" target="_blank" rel="noopener" title="Explorer">↗</a><button data-act="menu" title="More">⋯</button></div></div>' +
        '<div class="owh-menu" id="owhMenu" hidden>' +
          (s && s.kind === 'local' ? '<button data-act="backup">Back up secret key</button>' : '') +
          '<button data-act="disconnect">Disconnect</button>' +
          (s && s.kind === 'local' ? '<button data-act="forget" class="danger">Forget this browser wallet</button>' : '') +
        '</div>' +
        '<div class="owh-confirm" id="owhConfirm" hidden></div>' +
        (needBackup ? '<div class="owh-warn">This browser wallet has no backup yet. <button data-act="backup">Back up now</button></div>' : '') +
        '<div class="owh-total"><span>Total</span><strong id="owhTotal">—</strong><em id="owhTotalUsd"></em></div>' +
        '<div class="owh-bals" id="owhBals"></div>' +
        '<div class="owh-actions">' +
          '<button data-act="send"><b>↑</b>Send</button><button data-act="receive"><b>↓</b>Receive</button><button data-act="topup"><b>＋</b>Top up</button><button data-act="faucet"><b>💧</b>Devnet OST</button><button data-act="convert"><b>⇄</b>Convert</button>' +
        '</div>' +
      '</div>' +
      '<div class="owh-card owh-sess" id="owhSess"></div>' +
      '<div class="owh-receive" id="owhReceive" hidden></div>' +
      '<div class="owh-card owh-act"><div class="owh-acthead"><h4>Activity</h4><div class="owh-tabs"><button data-tab="chain"' + (S.actTab === 'chain' ? ' class="on"' : '') + '>On-chain</button><button data-tab="app"' + (S.actTab === 'app' ? ' class="on"' : '') + '>App ledger</button></div><button class="owh-refresh" data-act="act-refresh" title="Refresh">↻</button></div><div id="owhActList"></div></div>';
  }

  function paintBalances() {
    var el = $('owhBals'); if (!el) return;
    prices();
    var sol = S.sol, ostc = bal('onchainOstc'), ostg = bal('onchainOstg'), play = bal('play'), locked = bal('loanLocked');
    var si = sessInfo(); var sess = si && si.exists ? si.balance : undefined;
    var rows = [
      { k: 'SOL', v: sol, d: 4, u: S.solUsd ? sol * S.solUsd : null, note: 'gas · devnet' },
      { k: 'OST', v: ostc, d: 2, u: S.ostUsd ? ostc * S.ostUsd : null, note: 'on-chain' },
      { k: 'OSTG', v: ostg, d: 2, u: S.ostUsd ? ostg * S.ostUsd : null, note: 'on-chain · bets' },
      { k: 'Play', v: play, d: 2, u: S.ostUsd ? play * S.ostUsd : null, note: 'games · markets' + (locked > 0 ? ' · ' + fmt(locked) + ' locked' : '') }
    ];
    if (si && si.exists) rows.push({ k: '1-tap', v: sess, d: 2, u: S.ostUsd ? sess * S.ostUsd : null, note: 'session key' });
    el.innerHTML = rows.map(function (r) { return '<div class="owh-bal"><span>' + r.k + '</span><strong>' + fmt(r.v, r.d) + '</strong><em>' + (r.u != null && isFinite(r.u) ? usd(r.u) + ' · ' : '') + r.note + '</em></div>'; }).join('');
    var tot = 0, known = false; [ostc, ostg, play, sess].forEach(function (v) { if (v != null && isFinite(v)) { tot += Number(v); known = true; } });
    var t = $('owhTotal'), tu = $('owhTotalUsd');
    if (t) t.textContent = known ? fmt(tot) + ' OST' : '—';
    if (tu) tu.textContent = known && S.ostUsd ? usd(tot * S.ostUsd + (sol && S.solUsd ? sol * S.solUsd : 0)) + ' est.' : (known ? 'devnet · no cash value' : 'reading balances…');
  }
  function paintSession() {
    var el = $('owhSess'); if (!el) return;
    var si = sessInfo();
    if (!si) { el.hidden = true; return; }
    el.hidden = false;
    if (si.exists && si.balance > 0) {
      el.innerHTML = '<div class="owh-sessrow"><div><b>⚡ 1-tap betting ON</b><em>' + fmt(si.balance) + ' OSTG parked in a session key (cap ' + fmt(si.cap) + '). 5-min bets confirm instantly, no popups.</em></div><button data-act="sess-end">End · refund</button></div>';
    } else {
      el.innerHTML = '<div class="owh-sessrow"><div><b>⚡ 1-tap betting</b><em>Park a small, capped amount in a session key to bet 5-min markets without a signature each time. You choose the amount; End refunds it.</em></div><button data-act="sess-go">Set up</button></div>';
    }
  }
  function appLedger() {
    var out = [];
    try { var snaps = JSON.parse(localStorage.getItem('ost.wallet.balanceHistory.v1') || '[]'); (Array.isArray(snaps) ? snaps : []).forEach(function (s) { if (s && s.kind && s.kind !== 'tick') out.push({ ts: Number(s.ts) || 0, label: String(s.kind).replace(/[-_]/g, ' '), amt: Number(s.amount) || null, unit: /sol/i.test(s.kind) && !/ost/i.test(s.kind) ? 'SOL' : 'OST', dir: /^(send|prediction-buy|game-loss|games-deposit|launchpad-buy|ost-to-sol|perp-open|stock-buy|parlay-stake)/.test(s.kind) ? -1 : 1, ok: true, sig: s.sig && /^[1-9A-HJ-NP-Za-km-z]{60,100}$/.test(String(s.sig)) ? String(s.sig) : '' }); }); } catch (_) {}
    try { var orders = JSON.parse(localStorage.getItem('ost.prediction.orders.v1') || '[]'); (Array.isArray(orders) ? orders : []).slice(-40).forEach(function (o) { if (!o) return; out.push({ ts: Number(o.placedAt || o.ts || o.createdAt) || 0, label: 'Market ' + (o.status || 'open') + (o.marketTitle || o.title ? ' · ' + String(o.marketTitle || o.title).slice(0, 48) : ''), amt: Number(o.amount || o.stake) || null, unit: 'OST', dir: o.status === 'won' ? 1 : -1, ok: true, sig: '' }); }); } catch (_) {}
    return out.sort(function (a, b) { return b.ts - a.ts; }).slice(0, 60);
  }
  function paintActivity() {
    var el = $('owhActList'); if (!el) return;
    var rows = S.actTab === 'app' ? appLedger() : (S.act.length ? S.act : loadAct());
    if (S.actTab === 'chain' && S.actBusy && !rows.length) { el.innerHTML = '<div class="owh-empty">Reading the chain…</div>'; return; }
    if (!rows.length) { el.innerHTML = '<div class="owh-empty">' + (S.actTab === 'chain' ? (S.actErr ? 'Could not reach the RPC (' + esc(S.actErr) + '). <button data-act="act-refresh">Retry</button>' : 'No on-chain activity yet. Claim devnet OST or receive a transfer and it shows here.') : 'Nothing in the app ledger yet.') + '</div>'; return; }
    el.innerHTML = rows.map(function (r) {
      var cls = r.dir > 0 ? 'in' : (r.dir < 0 ? 'out' : 'neu');
      var amt = r.amt != null ? (r.dir > 0 ? '+' : (r.dir < 0 ? '−' : '')) + fmt(r.amt, r.unit === 'SOL' ? 4 : 2) + ' ' + esc(r.unit) : '';
      return '<div class="owh-tx ' + cls + (r.ok === false ? ' bad' : '') + '"><b>' + (r.dir > 0 ? '↓' : (r.dir < 0 ? '↑' : '•')) + '</b><div class="owh-txmain"><span>' + esc(r.label) + '</span><em>' + (r.ts ? ago(r.ts) : '') + (r.sig ? ' · <a href="' + esc(explorer('tx', r.sig)) + '" target="_blank" rel="noopener">' + esc(short(r.sig)) + '</a>' : '') + '</em></div><strong>' + amt + '</strong></div>';
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
    box.innerHTML = '<div class="owh-card"><div class="owh-acthead"><h4>Receive OST or SOL</h4><button class="owh-refresh" data-act="receive-close">✕</button></div>' +
      '<div class="owh-qrwrap"><canvas id="owhQr" width="232" height="232"></canvas></div>' +
      '<div class="owh-full" data-act="copy-addr">' + esc(pk) + '</div>' +
      '<div class="owh-row2"><button class="owh-primary" data-act="copy-addr">Copy address</button>' + (navigator.share ? '<button class="owh-ghost" data-act="share-addr">Share</button>' : '') + '</div>' +
      '<div class="owh-note">Only send Solana <b>' + esc(cluster()) + '</b> assets to this address. OST is a Token-2022 token; the sender\'s wallet creates your token account automatically.</div></div>';
    ensureQr().then(function (ok) { var cv = $('owhQr'); if (cv && !(ok && drawQr(cv, pk))) cv.replaceWith(Object.assign(document.createElement('div'), { className: 'owh-empty', textContent: 'QR unavailable — copy the address.' })); });
  }

  /* ---------- actions ---------- */
  function confirmBox(html, onYes, danger) {
    var c = $('owhConfirm'); if (!c) return;
    c.hidden = false; c.innerHTML = '<div>' + html + '</div><div class="owh-row2"><button class="' + (danger ? 'owh-danger' : 'owh-primary') + '" data-act="confirm-yes">Confirm</button><button class="owh-ghost" data-act="confirm-no">Cancel</button></div>';
    S.onConfirm = onYes;
  }
  function act(name, el) {
    var pk = pubkey();
    switch (name) {
      case 'home': S.view = 'home'; S.reveal = false; render(); break;
      case 'restore': S.view = 'restore'; render(); break;
      case 'local': clickOption('local'); break;
      case 'create':
        if (!w3()) { toast('Wallet core still loading — try again in a second.', 'err'); return; }
        if (storedLocal()) { clickOption('local'); return; }
        try { writeLocal(w3().Keypair.generate()); } catch (e) { toast('Could not create a wallet: ' + (e && e.message), 'err'); return; }
        S.view = 'backup'; S.reveal = false; clickOption('local'); setTimeout(render, 50); break;
      case 'create-new':
        confirmBoxStart('Start a new browser wallet? The current one <b>' + esc(short(storedLocalPubkey())) + '</b> will be replaced in this browser' + (backedUpAt() ? '.' : ' and it was <b>never backed up</b> — download its backup first.') + '', function () { try { var rec = storedLocal(); if (rec && !backedUpAt()) { download('ost-browser-wallet-' + short(storedLocalPubkey()) + '.json', JSON.stringify(rec.secretKey)); markBackedUp(); } writeLocal(w3().Keypair.generate()); try { localStorage.removeItem(BACKUP_KEY); } catch (_) {} S.view = 'backup'; clickOption('local'); setTimeout(render, 50); } catch (e) { toast(String(e && e.message || e), 'err'); } });
        break;
      case 'ext': connectExt(el.getAttribute('data-w')); break;
      case 'backup-current': { var rec = storedLocal(); if (rec) { download('ost-browser-wallet-' + short(storedLocalPubkey()) + '.json', JSON.stringify(rec.secretKey)); markBackedUp(); toast('Backup downloaded.'); render(); } break; }
      case 'restore-go': {
        var f = $('owhFile'), p = $('owhPaste'), ok = $('owhReplaceOk');
        var cur = storedLocalPubkey();
        var go = function (text) {
          try {
            var kp = parseSecret(text); var npk = kp.publicKey.toBase58();
            if (cur && cur !== npk && !(ok && ok.checked)) { toast('Tick the box to replace the current browser wallet.', 'err'); return; }
            writeLocal(kp); if (cur !== npk) { try { localStorage.removeItem(BACKUP_KEY); } catch (_) {} }
            S.view = 'home'; clickOption('local'); toast('Wallet restored · ' + short(npk)); setTimeout(render, 50);
          } catch (e) { toast(String(e && e.message || e), 'err'); }
        };
        if (f && f.files && f.files[0]) f.files[0].text().then(go, function () { toast('Could not read that file.', 'err'); }); else go(p && p.value);
        break;
      }
      case 'backup': S.view = 'backup'; S.reveal = false; render(); break;
      case 'dl-backup': { var r2 = storedLocal(); if (!r2) return; download('ost-browser-wallet-' + short(pk) + '.json', JSON.stringify(r2.secretKey)); markBackedUp(); toast('Backup downloaded — keep it offline.'); render(); break; }
      case 'reveal': S.reveal = !S.reveal; render(); break;
      case 'copy-secret': { var r3 = storedLocal(); if (r3) { copy(JSON.stringify(r3.secretKey), 'Secret key copied'); markBackedUp(); } break; }
      case 'copy-addr': if (pk) copy(pk, 'Address copied'); break;
      case 'share-addr': if (pk && navigator.share) navigator.share({ title: 'My OST wallet', text: pk }).catch(function () {}); break;
      case 'menu': { var m = $('owhMenu'); if (m) m.hidden = !m.hidden; break; }
      case 'disconnect': { var m2 = $('owhMenu'); if (m2) m2.hidden = true; confirmBox('Disconnect this wallet from OST?' + (session() && session().kind === 'local' ? ' Your browser wallet stays saved here and reconnects next time.' : ''), function () { var b = $('walletBtn'); if (b) b.click(); }); break; }
      case 'forget': { var m3 = $('owhMenu'); if (m3) m3.hidden = true; confirmBox('<b>Remove this browser wallet from this device?</b> ' + (backedUpAt() ? 'You will need your backup file to get it back.' : 'It was <b>never backed up</b>: any OST in it is lost for good. Download the backup first.'), function () { try { localStorage.removeItem(LOCAL_KEY); localStorage.removeItem(BACKUP_KEY); } catch (_) {} var b = $('walletBtn'); if (b && pubkey()) b.click(); toast('Browser wallet removed.'); setTimeout(render, 80); }, true); break; }
      case 'confirm-yes': { var fn = S.onConfirm; S.onConfirm = null; var c = $('owhConfirm'); if (c) c.hidden = true; if (fn) fn(); break; }
      case 'confirm-no': { S.onConfirm = null; var c2 = $('owhConfirm'); if (c2) c2.hidden = true; break; }
      case 'send': { var sb = $('wdSendBtn'); if (sb) sb.click(); else toast('Send is loading — try again.', 'err'); break; }
      case 'receive': toggleReceive(); break;
      case 'receive-close': toggleReceive(false); break;
      case 'topup': if (typeof window.openTopUpModal === 'function') window.openTopUpModal(); else toast('Top-up is loading — try again.', 'err'); break;
      case 'faucet':
        if (typeof window.runOstFaucetFlow !== 'function') { toast('Faucet is loading — try again.', 'err'); return; }
        el.disabled = true; el.innerHTML = '<b>…</b>Claiming';
        window.runOstFaucetFlow({ animate: false }).then(function (r) { toast(r && r.ok !== false ? 'Devnet OST on the way.' : ((r && (r.message || r.reason)) || 'Faucet not available right now.'), r && r.ok !== false ? '' : 'err'); }).catch(function (e) { toast((e && e.message) || 'Faucet failed', 'err'); }).then(function () { el.disabled = false; el.innerHTML = '<b>💧</b>Devnet OST'; refresh(true); });
        break;
      case 'convert': { var tb = document.querySelector('[data-wallet-panel-target="convert"]'); if (tb) { tb.click(); tb.scrollIntoView({ block: 'start', behavior: 'smooth' }); } break; }
      case 'sess-go': { var pt = document.querySelector('[data-wallet-panel-target="predict"]'); if (pt) pt.click(); try { if (window.OST_PREDICT_MOBILE && OST_PREDICT_MOBILE.showBrowse) OST_PREDICT_MOBILE.showBrowse(); } catch (_) {} toast('Open any BTC 5-min market — the 1-tap panel sits under the ticket.'); break; }
      case 'sess-end':
        el.disabled = true; el.textContent = 'Refunding…';
        window.OST_SESSION.end().then(function (r) { var sw = r && r.swept; toast('Session ended' + (sw && sw.ost ? ' · ' + fmt(sw.ost) + ' OSTG back in your wallet' : '') + '.'); refresh(true); }).catch(function (e) { toast((e && e.message) || 'Could not end the session', 'err'); }).then(function () { paintSession(); });
        break;
      case 'act-refresh': refreshActivity(true); break;
    }
  }
  function confirmBoxStart(html, onYes) {
    // Confirm inside the start card (no #owhConfirm there): reuse the busy line.
    var card = root && root.querySelector('.owh-card'); if (!card) return;
    var old = card.querySelector('.owh-confirm'); if (old) old.remove();
    var c = document.createElement('div'); c.className = 'owh-confirm'; c.innerHTML = '<div>' + html + '</div><div class="owh-row2"><button class="owh-primary" data-act="confirm-yes">Confirm</button><button class="owh-ghost" data-act="confirm-no">Cancel</button></div>';
    card.appendChild(c); S.onConfirm = onYes;
    c.querySelector('[data-act="confirm-no"]').onclick = function () { c.remove(); S.onConfirm = null; };
  }
  function wire() {
    if (!root || root.__wired) return; root.__wired = true;
    root.addEventListener('click', function (e) {
      var t = e.target.closest('[data-act],[data-tab]'); if (!t || !root.contains(t)) return;
      if (t.hasAttribute('data-tab')) { S.actTab = t.getAttribute('data-tab'); render(); return; }
      e.preventDefault(); act(t.getAttribute('data-act'), t);
    });
  }

  /* ---------- lifecycle ---------- */
  var lastPk = null;
  function refresh(force) {
    var pk = pubkey();
    if (pk !== lastPk) { lastPk = pk; S.act = []; S.view = S.view === 'backup' && pk ? 'backup' : 'home'; render(); if (pk) refreshActivity(true); }
    if (!pk) return;
    try { if (window.OST_BALANCE) OST_BALANCE.refresh(!!force); } catch (_) {}
    try { if (window.OST_SESSION && OST_SESSION.refresh) OST_SESSION.refresh(); } catch (_) {}
    readSol(force); paintBalances(); paintSession();
  }
  function mount() {
    var dash = $('walletDashboard'); if (!dash || $('ostWalletHome')) return;
    var host = document.createElement('div'); host.id = 'ostWalletHome'; host.className = 'owh';
    dash.insertBefore(host, dash.firstChild); dash.classList.add('owh-on');
    render(); refresh(true);
    ['ost:wallet-changed', 'ost:wallet-ready', 'ost:wallet-disconnected'].forEach(function (ev) { window.addEventListener(ev, function () { setTimeout(function () { refresh(true); }, 60); }); });
    window.addEventListener('ost:balance', function () { paintBalances(); });
    window.addEventListener('ost:session:change', function () { paintBalances(); paintSession(); });
    window.addEventListener('ost:session:funded', function () { refresh(true); });
    ['ost:money:change', 'ost:play:balance', 'ost:prediction:order-changed', 'ost-tx-history-update'].forEach(function (ev) { window.addEventListener(ev, function () { paintBalances(); if (S.actTab === 'app') paintActivity(); }); });
    window.addEventListener('ost:wallet-tx', function () { setTimeout(function () { refreshActivity(true); refresh(true); }, 2500); });
    setInterval(function () { if (!document.hidden && pubkey()) { refresh(false); if (Date.now() - (S.actAt || 0) > 60000) { S.actAt = Date.now(); refreshActivity(); } } }, 30000);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) refresh(true); });
    if (W() && typeof W().onReady === 'function') W().onReady(function () { setTimeout(function () { refresh(true); }, 30); });
  }
  window.OST_WALLET_HOME = { render: render, refresh: refresh, open: function (view) { S.view = view || 'home'; render(); } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true }); else mount();
})();

/* ============================================================
   mesh/mesh-play.js - encrypted Mesh Arena companion.
   Adds four provably fair peer games plus wallet and market share cards.
   ============================================================ */
(function () {
  'use strict';

  var STYLE_ID = 'ost-mesh-arena-style';
  var ROOT_ID = 'ost-mesh-arena';
  var FAIR_ENTRY_ID = 'ost-mesh-arena-fair-entry';
  var APP = 'ost-mesh-arena';
  var VERSION = 2;
  var FAIR_LEDGER_KEY = 'ost.mesh.fairGames.ledger.v1';
  var GAME_NAMES = {
    coinflip: 'Coin Flip',
    dice: 'Dice Duel',
    highcard: 'High Card',
    target: 'Target 50'
  };
  var challenges = new Map();
  var incomingChallenges = new Set();
  var selectedGame = 'coinflip';
  var knownPeerWallet = '';
  var activeVisual = null;

  function pavilion() {
    return window.OST_MESH && window.OST_MESH.pavilion;
  }

  function ready(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn, { once: true });
    else fn();
  }

  function waitForMesh(fn) {
    var p = pavilion();
    if (p) return fn(p);
    window.addEventListener('mesh:ready', function () { fn(pavilion()); }, { once: true });
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  function short(value) {
    value = String(value || '');
    return value.length > 14 ? value.slice(0, 7) + '...' + value.slice(-5) : value;
  }

  function amountText(stake) {
    if (!stake) return 'No stake';
    var amount = Number(stake.amount || 0);
    var text = Number.isFinite(amount) && amount > 0 ? amount.toFixed(amount >= 10 ? 2 : 4).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1') : '0';
    return text + ' ' + String(stake.asset || 'OST').toUpperCase();
  }

  function formatAmount(value) {
    var amount = Number(value || 0);
    if (!Number.isFinite(amount)) amount = 0;
    return amount.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: amount >= 10 ? 2 : 4 }).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
  }

  function readJson(key, fallback) {
    try {
      var parsed = JSON.parse(localStorage.getItem(key) || 'null');
      return parsed == null ? fallback : parsed;
    } catch (_) { return fallback; }
  }

  function writeJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) {}
  }

  function recordFairGame(kind, details) {
    var list = readJson(FAIR_LEDGER_KEY, []);
    if (!Array.isArray(list)) list = [];
    list.push(Object.assign({ ts: Date.now(), kind: kind }, details || {}));
    writeJson(FAIR_LEDGER_KEY, list.slice(-120));
    try { window.dispatchEvent(new CustomEvent('ost:wallet-changed')); } catch (_) {}
    return list;
  }

  function fairGameTotals() {
    var list = readJson(FAIR_LEDGER_KEY, []);
    if (!Array.isArray(list)) list = [];
    return list.reduce(function (acc, item) {
      var amount = Number(item.amount || item.pot || 0) || 0;
      if (item.kind === 'stake-deposit') acc.escrow += amount;
      if (item.kind === 'cashout') acc.cashout += amount;
      return acc;
    }, { escrow: 0, cashout: 0, rounds: list.length });
  }

  function randomHex(bytes) {
    var out = new Uint8Array(bytes);
    crypto.getRandomValues(out);
    return Array.prototype.map.call(out, function (b) { return b.toString(16).padStart(2, '0'); }).join('');
  }

  async function sha256Hex(text) {
    var buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(text)));
    return Array.prototype.map.call(new Uint8Array(buf), function (b) { return b.toString(16).padStart(2, '0'); }).join('');
  }

  function hexBytes(hex) {
    var bytes = [];
    for (var i = 0; i + 2 <= hex.length; i += 2) bytes.push(parseInt(hex.slice(i, i + 2), 16));
    return bytes;
  }

  function walletAddress() {
    try {
      var wallet = window.OST_WALLET;
      if (wallet && wallet.session && wallet.session.publicKey) {
        if (wallet.session.publicKey.toBase58) return wallet.session.publicKey.toBase58();
        return String(wallet.session.publicKey);
      }
      if (wallet && wallet.address) return String(wallet.address);
      if (window.OST_WALLET_PUBKEY) return String(window.OST_WALLET_PUBKEY);
      if (window.solana && window.solana.publicKey && window.solana.publicKey.toString) return window.solana.publicKey.toString();
    } catch (_) {}
    return '';
  }

  function openWallet() {
    location.hash = '#wallet';
    var btn = document.getElementById('walletBtn') || document.getElementById('connectWalletBtn');
    if (btn && !walletAddress()) btn.click();
  }

  function toast(text) {
    var p = pavilion();
    if (p && p._setStatus) p._setStatus(text, 'ok');
  }

  function notifyArena(type, title, body, options) {
    options = options || {};
    if (window.OST_NOTIFY && window.OST_NOTIFY.mesh) return window.OST_NOTIFY.mesh(type || 'challenge', title, body, options);
    if (window.OST_MESH_NOTIFY) return window.OST_MESH_NOTIFY(type || 'challenge', title, body, options);
    try { window.dispatchEvent(new CustomEvent('ost:mesh-notify', { detail: { type: type || 'challenge', title: title, body: body, options: options } })); } catch (_) {}
    return Promise.resolve(false);
  }

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = [
      '#ost-mesh-arena{order:1;position:relative;z-index:1;max-width:100%;overflow:hidden;border:1px solid rgba(0,212,255,.18);border-radius:14px;background:rgba(1,14,24,.76);padding:12px;margin:0;display:grid;gap:10px;align-self:start;isolation:isolate}',
      '#ost-mesh-arena-fair-entry{border:1px solid rgba(0,212,255,.22);border-radius:16px;background:linear-gradient(135deg,rgba(0,212,255,.12),rgba(0,255,159,.08));padding:14px;margin:12px 0;display:grid;gap:12px;color:#e8fbff;max-width:100%;overflow:hidden}',
      '#ost-mesh-arena *{box-sizing:border-box}',
      '#ost-mesh-arena-fair-entry *{box-sizing:border-box}',
      '.oma-head{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}',
      '.oma-head strong{color:#dff8ff;font-size:13px;letter-spacing:.04em;text-transform:uppercase}',
      '.oma-head span{color:#89b9ce;font-size:12px}',
      '.oma-fair-copy{display:grid;gap:4px}.oma-fair-copy strong{font-size:15px;color:#fff}.oma-fair-copy span{font-size:12px;color:#9bcbe6;line-height:1.45}',
      '.oma-fair-top{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}',
      '.oma-fair-games{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}',
      '@media(max-width:760px){.oma-fair-games{grid-template-columns:repeat(2,minmax(0,1fr))}}',
      '.oma-fair-game{min-height:58px;text-align:left;border:1px solid rgba(255,255,255,.12);border-radius:12px;background:rgba(0,0,0,.22);color:#e8fbff;padding:9px;cursor:pointer}',
      '.oma-fair-game strong{display:block;font-size:12px}.oma-fair-game span{display:block;color:#9bcbe6;font-size:11px;margin-top:3px}',
      '.oma-tabs{display:flex;gap:6px;flex-wrap:wrap}',
      '.oma-tabs button,.oma-btn{border:1px solid rgba(255,255,255,.12);border-radius:10px;background:rgba(255,255,255,.06);color:#e8fbff;padding:8px 10px;font-weight:750;font-size:12px;cursor:pointer}',
      '.oma-tabs button.is-active,.oma-btn.primary{background:linear-gradient(135deg,#00d4ff,#00ff9f);border-color:transparent;color:#03131c}',
      '.oma-pane{display:none;gap:10px}.oma-pane.is-active{display:grid}',
      '.oma-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}',
      '@media(max-width:760px){.oma-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}',
      '.oma-game{min-height:70px;text-align:left;border:1px solid rgba(255,255,255,.1);border-radius:12px;background:rgba(255,255,255,.045);color:#e8fbff;padding:10px;cursor:pointer}',
      '.oma-game.is-active{border-color:rgba(0,255,159,.55);box-shadow:0 0 0 1px rgba(0,255,159,.18) inset}',
      '.oma-game strong{display:block;font-size:13px}.oma-game span{display:block;color:#9bcbe6;font-size:11px;margin-top:4px}',
      '.oma-form{display:grid;grid-template-columns:1fr 120px auto;gap:8px;align-items:end}',
      '@media(max-width:760px){.oma-form{grid-template-columns:1fr}}',
      '.oma-field{display:grid;gap:4px;color:#9bcbe6;font-size:11px;font-weight:750}',
      '.oma-field input,.oma-field select{width:100%;border:1px solid rgba(255,255,255,.14);border-radius:10px;background:rgba(0,0,0,.32);color:#e8fbff;padding:9px;font:inherit}',
      '.oma-card{border:1px solid rgba(255,255,255,.1);border-radius:12px;background:rgba(255,255,255,.045);padding:10px;display:grid;gap:8px;color:#dff8ff}',
      '.oma-card h4{margin:0;font-size:13px;color:#fff}.oma-card p{margin:0;color:#9bcbe6;font-size:12px;line-height:1.45}',
      '.oma-card code{word-break:break-all;color:#9fffd0}',
      '.oma-table{position:relative;min-height:370px;border:1px solid rgba(94,234,212,.22);border-radius:16px;background:radial-gradient(circle at 50% 0%,rgba(94,234,212,.18),transparent 36%),linear-gradient(180deg,rgba(5,18,32,.94),rgba(1,8,18,.96));overflow:hidden;padding:14px;display:grid;gap:12px}',
      '.oma-table:before{content:"";position:absolute;inset:auto -20% -42% -20%;height:76%;background:radial-gradient(ellipse at center,rgba(0,255,159,.18),rgba(0,212,255,.06) 42%,transparent 70%);pointer-events:none}',
      '.oma-table-top{position:relative;display:flex;justify-content:space-between;gap:10px;align-items:center}.oma-table-top strong{color:#fff;font-size:14px}.oma-table-top span{color:#9bcbe6;font-size:12px}',
      '.oma-table-board{position:relative;display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:10px;min-height:74px}.oma-seat{border:1px solid rgba(255,255,255,.12);border-radius:14px;background:rgba(255,255,255,.055);padding:10px;display:grid;gap:5px;text-align:center}.oma-seat b{color:#fff;font-size:12px}.oma-seat small{color:#9bcbe6}.oma-versus{width:46px;height:46px;border-radius:50%;display:grid;place-items:center;background:linear-gradient(135deg,#00d4ff,#00ff9f);color:#02111c;font-weight:900;box-shadow:0 0 28px rgba(0,255,159,.22)}',
      '.oma-scene{position:relative;min-height:230px;border:1px solid rgba(255,255,255,.11);border-radius:18px;background:radial-gradient(circle at 50% 18%,rgba(255,255,255,.12),transparent 27%),linear-gradient(180deg,rgba(13,28,46,.72),rgba(3,9,18,.96));overflow:hidden;perspective:900px;isolation:isolate}',
      '.oma-scene:before{content:"";position:absolute;inset:0;background:linear-gradient(rgba(255,255,255,.035) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.03) 1px,transparent 1px);background-size:28px 28px;mask-image:linear-gradient(180deg,rgba(0,0,0,.65),transparent);pointer-events:none}',
      '.oma-three-canvas{position:relative;z-index:2;width:100%;height:230px;display:block;border-radius:18px}',
      '.oma-scene-fallback{position:absolute;inset:0;z-index:1;display:grid;place-items:center;padding:18px;transition:opacity .22s ease}.oma-scene.is-three .oma-scene-fallback{opacity:0;pointer-events:none}',
      '.oma-scene-title{position:absolute;left:12px;right:12px;bottom:10px;z-index:3;display:flex;justify-content:space-between;gap:8px;color:#c7f7ff;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.04em;text-shadow:0 1px 8px rgba(0,0,0,.65)}',
      '.oma-css-visual{position:relative;display:flex;align-items:center;justify-content:center;gap:24px;min-height:168px;width:100%;transform-style:preserve-3d}.oma-css-coin{width:108px;height:108px;border-radius:50%;position:relative;transform-style:preserve-3d;animation:oma-coin-spin 1.25s cubic-bezier(.38,.02,.2,1) infinite}.oma-css-coin:before,.oma-css-coin:after{content:attr(data-face);position:absolute;inset:0;border-radius:50%;display:grid;place-items:center;font-size:34px;font-weight:950;color:#3a2100;background:radial-gradient(circle at 32% 28%,#fff5bf,#f8c14b 42%,#b46b00);border:5px solid #ffe08a;box-shadow:inset 0 5px 12px rgba(255,255,255,.32),0 18px 34px rgba(0,0,0,.36)}.oma-css-coin:after{content:attr(data-back);transform:translateZ(-9px) rotateY(180deg);background:radial-gradient(circle at 32% 28%,#dbf9ff,#4fd1ff 42%,#075985);color:#03131c;border-color:#8be9ff}.oma-css-coin:before{transform:translateZ(9px)}',
      '.oma-css-die{width:88px;height:88px;border-radius:18px;display:grid;place-items:center;transform-style:preserve-3d;transform:rotateX(58deg) rotateZ(-28deg);animation:oma-die-tumble 1.35s ease-in-out infinite;background:linear-gradient(145deg,#f8fbff,#77d9ff);color:#061018;border:1px solid rgba(255,255,255,.75);box-shadow:inset 0 9px 14px rgba(255,255,255,.5),0 22px 36px rgba(0,0,0,.35)}.oma-css-die b{font-size:34px}.oma-css-die.peer{background:linear-gradient(145deg,#fff7ed,#f97316)}',
      '.oma-css-card{width:88px;height:124px;border-radius:13px;display:grid;place-items:center;transform-style:preserve-3d;animation:oma-card-flip 1.55s ease-in-out infinite;background:#f8fafc;color:#0f172a;border:1px solid rgba(255,255,255,.9);box-shadow:0 20px 38px rgba(0,0,0,.35)}.oma-css-card b{font-size:32px}.oma-css-card.peer{color:#7c2d12}.oma-css-card.back{background:linear-gradient(135deg,#13324d,#0e7490);color:#dff8ff}',
      '.oma-css-target{position:relative;width:178px;height:178px;border-radius:50%;animation:oma-pulse-target 1.6s ease-in-out infinite;background:radial-gradient(circle,#fff 0 9%,#ef4444 10% 22%,#fff 23% 38%,#38bdf8 39% 58%,#111827 59% 72%,#f59e0b 73%);box-shadow:0 24px 42px rgba(0,0,0,.4),inset 0 0 0 1px rgba(255,255,255,.2)}.oma-target-marker{position:absolute;width:26px;height:26px;border-radius:50%;transform:translate(-50%,-50%);border:2px solid rgba(255,255,255,.85);box-shadow:0 9px 16px rgba(0,0,0,.35)}.oma-target-marker.you{background:#00ff9f}.oma-target-marker.peer{background:#f97316}',
      '.oma-table.is-final .oma-css-coin,.oma-table.is-final .oma-css-die,.oma-table.is-final .oma-css-card,.oma-table.is-final .oma-css-target{animation-duration:2.6s}.oma-result-banner{position:relative;border:1px solid rgba(255,255,255,.12);border-radius:14px;background:rgba(255,255,255,.06);padding:10px;color:#dff8ff;font-size:12px;line-height:1.45}.oma-result-banner strong{color:#fff}',
      '.oma-balance-strip{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}@media(max-width:760px){.oma-balance-strip{grid-template-columns:repeat(2,minmax(0,1fr))}}.oma-balance-tile{border:1px solid rgba(255,255,255,.1);border-radius:12px;background:rgba(255,255,255,.045);padding:10px;display:grid;gap:3px}.oma-balance-tile span{color:#9bcbe6;font-size:11px}.oma-balance-tile strong{color:#fff;font-size:14px}',
      '.oma-wallet-actions{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}@media(max-width:760px){.oma-wallet-actions{grid-template-columns:repeat(2,minmax(0,1fr))}}.oma-wallet-actions button{border:1px solid rgba(255,255,255,.12);border-radius:12px;background:rgba(255,255,255,.07);color:#e8fbff;padding:10px;font-weight:800;cursor:pointer;text-align:left}.oma-wallet-actions button.primary{background:linear-gradient(135deg,#00d4ff,#00ff9f);color:#03131c;border-color:transparent}',
      '@media(max-width:760px){#ost-mesh-arena{padding:9px;gap:8px;border-radius:12px}.oma-head{gap:7px}.oma-head strong,.oma-fair-copy strong{font-size:12px}.oma-head span,.oma-fair-copy span{font-size:11px;line-height:1.35}.oma-tabs button,.oma-btn,.oma-actions button,.oma-wallet-actions button{min-height:38px;padding:7px 8px;font-size:11px;border-radius:9px}.oma-grid,.oma-fair-games{grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}.oma-game,.oma-fair-game{min-height:48px;padding:8px;border-radius:10px}.oma-game strong,.oma-fair-game strong{font-size:11px}.oma-game span,.oma-fair-game span{font-size:10px}.oma-card{padding:8px;border-radius:10px}.oma-form{gap:7px}.oma-field input,.oma-field select{min-height:38px;padding:8px}.oma-table{min-height:320px;padding:10px;border-radius:12px}.oma-table-board{grid-template-columns:1fr;min-height:0}.oma-seat{padding:8px}.oma-versus{width:34px;height:34px;margin:auto}.oma-scene{min-height:190px}.oma-three-canvas{height:190px}.oma-css-visual{gap:14px;min-height:140px}.oma-css-coin{width:82px;height:82px}.oma-css-die{width:68px;height:68px;border-radius:14px}.oma-css-card{width:68px;height:96px}.oma-css-target{width:136px;height:136px}.oma-balance-strip,.oma-wallet-actions{grid-template-columns:repeat(2,minmax(0,1fr))}}',
      '@media(max-width:380px){.oma-grid,.oma-fair-games,.oma-balance-strip,.oma-wallet-actions{grid-template-columns:1fr 1fr}.oma-tabs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr))}.oma-share-row{grid-template-columns:1fr}.oma-table-top{align-items:flex-start}.oma-css-visual{gap:10px}.oma-scene-title{font-size:10px}}',
      '@media(prefers-reduced-motion:reduce){.oma-css-coin,.oma-css-die,.oma-css-card,.oma-css-target{animation:none}}',
      '@keyframes oma-coin-spin{0%{transform:rotateY(0) rotateX(8deg) translateY(0)}48%{transform:rotateY(760deg) rotateX(18deg) translateY(-22px)}100%{transform:rotateY(1440deg) rotateX(8deg) translateY(0)}}@keyframes oma-die-tumble{0%,100%{transform:rotateX(58deg) rotateZ(-28deg) translateY(0)}50%{transform:rotateX(305deg) rotateZ(180deg) translateY(-16px)}}@keyframes oma-card-flip{0%,100%{transform:rotateY(-16deg) translateY(0)}50%{transform:rotateY(176deg) translateY(-10px)}}@keyframes oma-pulse-target{0%,100%{transform:rotateX(0) scale(1)}50%{transform:rotateX(9deg) scale(1.03)}}',
      '.oma-actions{display:flex;gap:6px;flex-wrap:wrap}.oma-actions button{border:1px solid rgba(255,255,255,.12);border-radius:9px;background:rgba(255,255,255,.07);color:#e8fbff;padding:7px 9px;font-weight:750;cursor:pointer}',
      '.oma-actions button.primary{background:#00ff9f;color:#03131c;border-color:transparent}',
      '.oma-log{display:grid;gap:8px;max-height:260px;overflow:auto}',
      '.oma-status{font-size:12px;color:#9bcbe6}',
      '.oma-share-row{display:grid;grid-template-columns:1fr 1fr;gap:8px}@media(max-width:760px){.oma-share-row{grid-template-columns:1fr}}'
    ].join('\n');
    document.head.appendChild(style);
  }

  function mount(p) {
    if (!p || document.getElementById(ROOT_ID)) return;
    injectStyle();
    var stage = p.root && p.root.querySelector('.ost-mesh-stage');
    var session = p.root && p.root.querySelector('.ost-mesh-session');
    if (!stage) return;
    var root = document.createElement('div');
    root.id = ROOT_ID;
    root.innerHTML = [
      '<div class="oma-head"><strong>OST Mesh Arena</strong><span id="omaStatus">Encrypted games, wallet requests, and live market shares.</span></div>',
      '<div class="oma-tabs" role="tablist">',
        '<button type="button" class="is-active" data-oma-tab="games">Games</button>',
        '<button type="button" data-oma-tab="wallet">Wallet</button>',
        '<button type="button" data-oma-tab="share">Share</button>',
      '</div>',
      '<div class="oma-pane is-active" data-oma-pane="games">',
        '<div class="oma-grid" id="omaGameGrid">',
          gameButton('coinflip', '50/50 commit reveal'),
          gameButton('dice', 'Best dice roll wins'),
          gameButton('highcard', 'Highest card wins'),
          gameButton('target', 'Closest to 50 wins'),
        '</div>',
        '<div class="oma-table" id="omaGameTable" aria-live="polite"></div>',
        '<div class="oma-form">',
          '<label class="oma-field">Stake amount<input id="omaStakeAmount" type="number" min="0" step="0.01" value="1"></label>',
          '<label class="oma-field">Asset<select id="omaStakeAsset"><option>OST</option><option>SOL</option><option>USDC</option><option>ANY</option></select></label>',
          '<button class="oma-btn primary" id="omaChallenge" type="button">Challenge peer</button>',
        '</div>',
        '<div class="oma-actions"><button type="button" id="omaVoice">Start voice</button><button type="button" id="omaVideo">Start video</button></div>',
        '<div class="oma-log" id="omaGameLog"></div>',
      '</div>',
      '<div class="oma-pane" data-oma-pane="wallet">',
        '<div class="oma-balance-strip" id="omaBalanceStrip"></div>',
        '<div class="oma-card"><h4>Connected wallet rail</h4><p id="omaWalletLine">Wallet not connected.</p></div>',
        '<div class="oma-wallet-actions">',
          '<button class="primary" type="button" data-oma-wallet-action="buy">Buy OST</button>',
          '<button type="button" data-oma-wallet-action="swap">Swap</button>',
          '<button type="button" data-oma-wallet-action="bridge">Bridge</button>',
          '<button type="button" data-oma-wallet-action="receive">Receive</button>',
          '<button type="button" data-oma-wallet-action="cashout">Cash out</button>',
          '<button type="button" data-oma-wallet-action="offline">Offline OST</button>',
        '</div>',
        '<div class="oma-form">',
          '<label class="oma-field">Amount<input id="omaPayAmount" type="number" min="0" step="0.01" value="1"></label>',
          '<label class="oma-field">Asset<select id="omaPayAsset"><option>OST</option><option>SOL</option><option>USDC</option><option>ANY</option></select></label>',
          '<button class="oma-btn primary" id="omaRequestPay" type="button">Request payment</button>',
        '</div>',
        '<label class="oma-field">Note<input id="omaPayNote" type="text" maxlength="120" placeholder="Game payout, invoice, tip, trade settlement"></label>',
        '<div class="oma-actions"><button class="primary" type="button" id="omaSendPeer">Send OST to peer</button><button type="button" id="omaShareReceive">Share receive address</button><button type="button" id="omaOpenWallet">Open wallet</button></div>',
      '</div>',
      '<div class="oma-pane" data-oma-pane="share">',
        '<div class="oma-share-row">',
          '<div class="oma-card"><h4>Prediction market</h4><p id="omaPredictionPreview">No market selected yet.</p><div class="oma-actions"><button class="primary" type="button" id="omaSharePrediction">Share active market</button></div></div>',
          '<div class="oma-card"><h4>Memecoin</h4><p id="omaCoinPreview">No coin selected yet.</p><div class="oma-actions"><button class="primary" type="button" id="omaShareCoin">Share hot coin</button></div></div>',
        '</div>',
      '</div>'
    ].join('');
    if (session && session.contains(stage)) session.insertBefore(root, stage);
    else stage.parentElement.insertBefore(root, stage);
    bind(root, p);
    updateGameTable();
    refreshWalletLine();
    refreshSharePreviews();
    refreshUnifiedBalances();
    setInterval(refreshWalletLine, 4000);
    setInterval(refreshSharePreviews, 5000);
    setInterval(refreshUnifiedBalances, 5000);
  }

  function mountFairGamesEntry() {
    if (document.getElementById(FAIR_ENTRY_ID)) return;
    injectStyle();
    var games = document.getElementById('ostGames');
    if (!games) {
      setTimeout(mountFairGamesEntry, 350);
      return;
    }
    var entry = document.createElement('div');
    entry.id = FAIR_ENTRY_ID;
    entry.innerHTML = [
      '<div class="oma-fair-top">',
        '<div class="oma-fair-copy"><strong>Mesh multiplayer fair games</strong><span>Start encrypted peer tables from Fair Games. The playable table opens inside the existing OST Mesh panel.</span></div>',
        '<button class="oma-btn primary" type="button" id="omaOpenMeshArena">Open in OST Mesh</button>',
      '</div>',
      '<div class="oma-fair-games">',
        fairGameButton('coinflip', '50/50 table'),
        fairGameButton('dice', 'Best roll wins'),
        fairGameButton('highcard', 'Highest card'),
        fairGameButton('target', 'Closest to 50'),
      '</div>'
    ].join('');
    var hero = games.querySelector('.ostg-casino-hero');
    if (hero && hero.nextSibling) games.insertBefore(entry, hero.nextSibling);
    else games.prepend(entry);
    entry.querySelector('#omaOpenMeshArena').addEventListener('click', function () { openMeshArena(selectedGame); });
    entry.querySelectorAll('[data-oma-entry-game]').forEach(function (button) {
      button.addEventListener('click', function () { openMeshArena(button.dataset.omaEntryGame); });
    });
  }

  function gameButton(key, sub) {
    return '<button class="oma-game' + (key === 'coinflip' ? ' is-active' : '') + '" type="button" data-oma-game="' + key + '"><strong>' + GAME_NAMES[key] + '</strong><span>' + sub + '</span></button>';
  }

  function fairGameButton(key, sub) {
    return '<button class="oma-fair-game" type="button" data-oma-entry-game="' + key + '"><strong>' + GAME_NAMES[key] + '</strong><span>' + sub + '</span></button>';
  }

  function bind(root, p) {
    root.querySelectorAll('[data-oma-tab]').forEach(function (button) {
      button.addEventListener('click', function () {
        selectTab(button.dataset.omaTab);
      });
    });
    root.querySelectorAll('[data-oma-game]').forEach(function (button) {
      button.addEventListener('click', function () {
        selectGame(button.dataset.omaGame);
      });
    });
    root.querySelector('#omaChallenge').addEventListener('click', function () { startChallenge(selectedGame); });
    root.querySelector('#omaVoice').addEventListener('click', function () { if (p.voiceBtn) p.voiceBtn.click(); });
    root.querySelector('#omaVideo').addEventListener('click', function () { if (p.videoBtn) p.videoBtn.click(); });
    root.querySelector('#omaRequestPay').addEventListener('click', sendPaymentRequest);
    root.querySelector('#omaSendPeer').addEventListener('click', sendOstToKnownPeer);
    root.querySelector('#omaShareReceive').addEventListener('click', shareReceiveAddress);
    root.querySelector('#omaOpenWallet').addEventListener('click', openWallet);
    root.querySelector('#omaSharePrediction').addEventListener('click', sharePrediction);
    root.querySelector('#omaShareCoin').addEventListener('click', shareCoin);
    root.querySelectorAll('[data-oma-wallet-action]').forEach(function (button) {
      button.addEventListener('click', function () { handleWalletAction(button.dataset.omaWalletAction); });
    });
  }

  function selectTab(tab) {
    var root = document.getElementById(ROOT_ID);
    if (!root) return;
    root.querySelectorAll('[data-oma-tab]').forEach(function (button) { button.classList.toggle('is-active', button.dataset.omaTab === tab); });
    root.querySelectorAll('[data-oma-pane]').forEach(function (pane) { pane.classList.toggle('is-active', pane.dataset.omaPane === tab); });
  }

  function selectGame(game) {
    if (!GAME_NAMES[game]) game = 'coinflip';
    selectedGame = game;
    var root = document.getElementById(ROOT_ID);
    if (!root) return;
    root.querySelectorAll('[data-oma-game]').forEach(function (button) { button.classList.toggle('is-active', button.dataset.omaGame === game); });
    updateGameTable();
  }

  function openMeshArena(game) {
    waitForMesh(function (p) {
      if (window.OST_MESH && typeof window.OST_MESH.open === 'function') window.OST_MESH.open();
      mount(p);
      selectGame(game || selectedGame);
      selectTab('games');
      refreshWalletLine();
      refreshSharePreviews();
      refreshUnifiedBalances();
      setArenaStatus('Pick a table, connect a peer, then challenge them from inside OST Mesh.');
      setTimeout(function () {
        var root = document.getElementById(ROOT_ID);
        if (root && root.scrollIntoView) root.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }, 80);
    });
  }

  function setArenaStatus(text) {
    var el = document.getElementById('omaStatus');
    if (el) el.textContent = text;
  }

  function gameLog(node) {
    var log = document.getElementById('omaGameLog');
    if (!log) return;
    log.prepend(node);
  }

  function makeCard(title, body) {
    var card = document.createElement('div');
    card.className = 'oma-card';
    card.innerHTML = '<h4>' + escapeHtml(title) + '</h4><p>' + body + '</p>';
    return card;
  }

  function updateGameTable(state, phase, result, digest) {
    var table = document.getElementById('omaGameTable');
    if (!table) return;
    var game = (state && state.game) || selectedGame;
    var stake = (state && state.stake) || { amount: Number(document.getElementById('omaStakeAmount')?.value || 0) || 0, asset: 'OST' };
    var label = GAME_NAMES[game] || 'Fair game';
    var phaseText = phase || 'Choose a table, connect a peer, then lock the stake before reveal.';
    stopActiveVisual();
    table.classList.toggle('is-final', !!result);
    table.innerHTML = [
      '<div class="oma-table-top"><div><strong>' + escapeHtml(label) + '</strong><br><span>' + escapeHtml(phaseText) + '</span></div><span>' + escapeHtml(amountText(stake)) + '</span></div>',
      '<div class="oma-table-board"><div class="oma-seat"><b>You</b><small>' + escapeHtml(short(walletAddress()) || 'link wallet') + '</small></div><div class="oma-versus">VS</div><div class="oma-seat"><b>Peer</b><small>' + escapeHtml(short(knownPeerWallet) || 'waiting') + '</small></div></div>',
      gameScene(game, result),
      result ? '<div class="oma-result-banner"><strong>' + escapeHtml(result.detail) + '</strong><br>Proof hash <code>' + escapeHtml(String(digest || '').slice(0, 24)) + '...</code></div>' : ''
    ].join('');
    activateVisual(table, game, result);
  }

  function gameScene(game, result) {
    var labels = gameSceneLabels(game, result);
    return '<div class="oma-scene" data-oma-visual="' + escapeHtml(game) + '"><canvas class="oma-three-canvas" aria-hidden="true"></canvas><div class="oma-scene-fallback">' + fallbackVisual(game, result) + '</div><div class="oma-scene-title"><span>' + escapeHtml(labels.left) + '</span><span>' + escapeHtml(labels.right) + '</span></div></div>';
  }

  function gameSceneLabels(game, result) {
    if (game === 'dice') return { left: 'Your dice ' + (result ? result.challenger : 'rolling'), right: 'Peer dice ' + (result ? result.opponent : 'rolling') };
    if (game === 'highcard') return { left: 'Your card ' + (result ? result.challenger : 'hidden'), right: 'Peer card ' + (result ? result.opponent : 'hidden') };
    if (game === 'target') return { left: 'You ' + (result ? result.challenger : 'aiming'), right: 'Peer ' + (result ? result.opponent : 'aiming') };
    return { left: 'Heads', right: 'Tails' };
  }

  function fallbackVisual(game, result) {
    if (game === 'dice') {
      return '<div class="oma-css-visual"><span class="oma-css-die"><b>' + escapeHtml(result ? result.challenger : '?') + '</b></span><span class="oma-css-die peer"><b>' + escapeHtml(result ? result.opponent : '?') + '</b></span></div>';
    }
    if (game === 'highcard') {
      return '<div class="oma-css-visual"><span class="oma-css-card ' + (result ? '' : 'back') + '"><b>' + escapeHtml(result ? result.challenger : 'OST') + '</b></span><span class="oma-css-card peer ' + (result ? '' : 'back') + '"><b>' + escapeHtml(result ? result.opponent : 'OST') + '</b></span></div>';
    }
    if (game === 'target') {
      return '<div class="oma-css-visual"><div class="oma-css-target"><span class="oma-target-marker you" style="' + targetMarkerStyle(result && result.challenger, 0) + '"></span><span class="oma-target-marker peer" style="' + targetMarkerStyle(result && result.opponent, 1) + '"></span></div></div>';
    }
    var coin = result && result.coin ? String(result.coin).toUpperCase() : 'OST';
    var back = coin === 'H' ? 'T' : 'H';
    return '<div class="oma-css-visual"><span class="oma-css-coin" data-face="' + escapeHtml(coin) + '" data-back="' + escapeHtml(back) + '"></span></div>';
  }

  function targetMarkerStyle(value, lane) {
    var number = Number(value);
    if (!Number.isFinite(number)) return 'left:50%;top:' + (lane ? 60 : 40) + '%';
    var left = Math.max(12, Math.min(88, 50 + ((number - 50) * 0.72)));
    var top = lane ? 58 : 42;
    return 'left:' + left.toFixed(1) + '%;top:' + top + '%';
  }

  function stopActiveVisual() {
    if (activeVisual && typeof activeVisual.stop === 'function') activeVisual.stop();
    activeVisual = null;
  }

  function activateVisual(table, game, result) {
    var sceneEl = table && table.querySelector('[data-oma-visual]');
    var canvas = sceneEl && sceneEl.querySelector('.oma-three-canvas');
    var THREE = window.THREE;
    if (!sceneEl || !canvas || !THREE || !THREE.WebGLRenderer) return;
    try {
      var renderer = new THREE.WebGLRenderer({ canvas: canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
      if (THREE.sRGBEncoding) renderer.outputEncoding = THREE.sRGBEncoding;
      var scene = new THREE.Scene();
      var camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
      camera.position.set(0, 0.34, 5.2);
      camera.lookAt(0, 0, 0);
      scene.add(new THREE.AmbientLight(0xb8f7ff, 0.62));
      var key = new THREE.DirectionalLight(0xffffff, 0.9);
      key.position.set(3.2, 4.5, 5.4);
      scene.add(key);
      var fill = new THREE.PointLight(0x00ff9f, 0.7, 8);
      fill.position.set(-2.8, 1.7, 2.4);
      scene.add(fill);
      addThreeFloor(THREE, scene);
      var visual = createThreeGame(THREE, scene, game, result);
      var frame = 0;
      var stopped = false;
      function resize() {
        var rect = sceneEl.getBoundingClientRect();
        var width = Math.max(220, Math.floor(rect.width || canvas.clientWidth || 320));
        var height = Math.max(170, Math.floor(rect.height || canvas.clientHeight || 220));
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
      }
      function animate(now) {
        if (stopped) return;
        if (visual && visual.userData && typeof visual.userData.animate === 'function') visual.userData.animate(now / 1000);
        renderer.render(scene, camera);
        frame = requestAnimationFrame(animate);
      }
      resize();
      var observer = window.ResizeObserver ? new ResizeObserver(resize) : null;
      if (observer) observer.observe(sceneEl);
      window.addEventListener('resize', resize);
      sceneEl.classList.add('is-three');
      activeVisual = {
        stop: function () {
          stopped = true;
          cancelAnimationFrame(frame);
          window.removeEventListener('resize', resize);
          if (observer) observer.disconnect();
          disposeThreeScene(scene);
          renderer.dispose();
        }
      };
      frame = requestAnimationFrame(animate);
    } catch (_) {
      sceneEl.classList.remove('is-three');
      stopActiveVisual();
    }
  }

  function addThreeFloor(THREE, scene) {
    var floor = new THREE.Mesh(
      new THREE.CircleGeometry(2.55, 72),
      new THREE.MeshStandardMaterial({ color: 0x082236, metalness: 0.25, roughness: 0.56, transparent: true, opacity: 0.72 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -1.05;
    scene.add(floor);
  }

  function createThreeGame(THREE, scene, game, result) {
    var group = new THREE.Group();
    scene.add(group);
    if (game === 'dice') createThreeDice(THREE, group, result);
    else if (game === 'highcard') createThreeCards(THREE, group, result);
    else if (game === 'target') createThreeTarget(THREE, group, result);
    else createThreeCoin(THREE, group, result);
    return group;
  }

  // Smooth easing helpers used by physics-style game animations.
  function easeOutCubic(k) { return 1 - Math.pow(1 - k, 3); }
  function easeOutQuart(k) { return 1 - Math.pow(1 - k, 4); }
  function smoothStep(k) { k = Math.max(0, Math.min(1, k)); return k * k * (3 - 2 * k); }

  function createThreeCoin(THREE, group, result) {
    var edge = new THREE.MeshStandardMaterial({ color: 0xb7791f, metalness: 0.8, roughness: 0.24 });
    var heads = new THREE.MeshStandardMaterial({ map: makeCoinTexture(THREE, 'H', '#ffe08a', '#b7791f'), metalness: 0.55, roughness: 0.18 });
    var tails = new THREE.MeshStandardMaterial({ map: makeCoinTexture(THREE, 'T', '#7dd3fc', '#075985'), metalness: 0.48, roughness: 0.2 });
    var coin = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.16, 72), [edge, heads, tails]);
    // Base rest orientation: cylinder axis vertical so heads (group 1) faces camera/up.
    coin.rotation.z = 0;
    group.add(coin);
    var t0 = null;
    var DUR = 2.6;
    // Heads (group 1) is the +Y face; flipping by an odd number of half-turns about X reveals tails.
    var landTails = !!(result && result.coin === 'T');
    var halfTurns = 9 + (landTails ? 1 : 0); // odd vs even ensures correct face up
    var totalAngle = halfTurns * Math.PI;
    group.userData.animate = function (t) {
      if (t0 == null) t0 = t;
      var dt = t - t0;
      if (!result) {
        // Hover & tumble until result lands
        coin.position.y = 0.18 + Math.sin(dt * 4.2) * 0.18;
        coin.rotation.x = dt * 7.5;
        coin.rotation.z = Math.sin(dt * 2.0) * 0.12;
        return;
      }
      var u = Math.min(dt / DUR, 1);
      // Vertical parabola: tossed up, returns to table.
      var arc = 4 * u * (1 - u);
      coin.position.y = arc * 1.6 - 0.05 * easeOutCubic(u);
      // Angular position: ease-out so spin slows and lands on the correct face.
      var ang = totalAngle * easeOutQuart(u);
      coin.rotation.x = ang;
      // Wobble subsides as it settles.
      coin.rotation.z = (1 - easeOutCubic(u)) * Math.sin(dt * 18) * 0.18;
      if (u >= 1) {
        var w = dt - DUR;
        var damp = Math.exp(-w * 3.2);
        coin.position.y = Math.abs(Math.sin(w * 14)) * damp * 0.06;
        coin.rotation.x = totalAngle + Math.sin(w * 12) * damp * 0.05;
        coin.rotation.z = Math.sin(w * 10) * damp * 0.04;
      }
    };
  }

  function createThreeDice(THREE, group, result) {
    var dieA = makeDieMesh(THREE, result && result.challenger, false);
    var dieB = makeDieMesh(THREE, result && result.opponent, true);
    dieA.position.x = -0.85;
    dieB.position.x = 0.85;
    group.add(dieA, dieB);
    var t0 = null;
    // Per-die settle target rotations (random-feeling but deterministic per side).
    var settleA = { x: 0.55, y: 0.42, z: -0.18 };
    var settleB = { x: 0.55, y: -0.38, z: 0.22 };
    var DUR = 2.4;
    group.userData.animate = function (t) {
      if (t0 == null) t0 = t;
      var dt = t - t0;
      if (!result) {
        [dieA, dieB].forEach(function (die, i) {
          die.position.y = 0.45 + Math.sin(dt * 5.4 + i * 1.3) * 0.22;
          die.rotation.x = dt * (3.2 + i * 0.4);
          die.rotation.y = dt * (2.7 + i * 0.3);
          die.rotation.z = dt * (1.8 + i * 0.2);
        });
        return;
      }
      var u = Math.min(dt / DUR, 1);
      var arc = 4 * u * (1 - u);
      [dieA, dieB].forEach(function (die, i) {
        var settle = i ? settleB : settleA;
        die.position.y = arc * (1.4 - i * 0.15);
        // Phase 1: tumble fast; ease into final orientation.
        var spin = (1 - easeOutQuart(u));
        die.rotation.x = settle.x + spin * (3.5 + i * 0.5) * Math.sin(dt * 4 + i);
        die.rotation.y = settle.y + spin * (3.0 + i * 0.4) * Math.cos(dt * 3.4 + i);
        die.rotation.z = settle.z + spin * 1.6 * Math.sin(dt * 2.6 + i);
        if (u >= 1) {
          var w = dt - DUR;
          var damp = Math.exp(-w * 4) * 0.05;
          die.position.y = Math.abs(Math.sin(w * 16)) * damp * 1.4;
          die.rotation.z = settle.z + Math.sin(w * 11) * damp;
        }
      });
    };
  }

  function makeDieMesh(THREE, value, peer) {
    var material = new THREE.MeshStandardMaterial({ map: makeDiceTexture(THREE, value || '?', peer), metalness: 0.12, roughness: 0.38 });
    return new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.78, 0.78), [material, material, material, material, material, material]);
  }

  function createThreeCards(THREE, group, result) {
    // Two cards: dealt face-down, slide into place, then flip face-up to reveal.
    var you = makeCardMesh(THREE, result && result.challenger, false, true);
    var peer = makeCardMesh(THREE, result && result.opponent, true, true);
    var youFace = makeCardFaceMesh(THREE, result && result.challenger, false);
    var peerFace = makeCardFaceMesh(THREE, result && result.opponent, true);
    // Stack face on the front of each card to reveal after flip without swapping textures.
    youFace.position.z = 0.001;
    peerFace.position.z = 0.001;
    you.add(youFace);
    peer.add(peerFace);
    group.add(you, peer);
    var t0 = null;
    var DEAL = 0.7;
    var FLIP = 1.2;
    group.userData.animate = function (t) {
      if (t0 == null) t0 = t;
      var dt = t - t0;
      if (!result) {
        // Cards glide in place, gently swaying face-down.
        [you, peer].forEach(function (card, i) {
          var sign = i ? 1 : -1;
          card.position.x = sign * (0.78 + Math.sin(dt * 1.4 + i) * 0.04);
          card.position.y = Math.sin(dt * 1.8 + i) * 0.05;
          card.rotation.y = Math.PI; // face-down (back showing)
          card.rotation.z = sign * 0.05 + Math.sin(dt * 1.6 + i) * 0.04;
        });
        return;
      }
      [you, peer].forEach(function (card, i) {
        var sign = i ? 1 : -1;
        // Phase 1: deal in from outside.
        var d = Math.min(dt / DEAL, 1);
        var dealEase = easeOutCubic(d);
        card.position.x = sign * (1.6 * (1 - dealEase) + 0.78 * dealEase);
        card.position.y = (1 - dealEase) * 0.45;
        card.rotation.z = sign * 0.05 * dealEase;
        // Phase 2: flip face-up after deal completes.
        var f = Math.max(0, Math.min((dt - DEAL) / FLIP, 1));
        var flipEase = smoothStep(f);
        // Lift while flipping for tactile feel.
        card.position.y += Math.sin(f * Math.PI) * 0.18;
        card.rotation.y = Math.PI * (1 - flipEase); // PI -> 0 (back -> face)
        if (f >= 1) {
          var w = dt - DEAL - FLIP;
          var damp = Math.exp(-w * 3) * 0.04;
          card.rotation.z = sign * 0.05 + Math.sin(w * 9) * damp;
        }
      });
    };
  }

  function makeCardMesh(THREE, value, peer, back) {
    var material = new THREE.MeshStandardMaterial({ map: makeCardTexture(THREE, value || 'OST', peer, back), side: THREE.DoubleSide, metalness: 0.05, roughness: 0.32 });
    return new THREE.Mesh(new THREE.PlaneGeometry(0.84, 1.18), material);
  }

  function makeCardFaceMesh(THREE, value, peer) {
    var material = new THREE.MeshStandardMaterial({ map: makeCardTexture(THREE, value || 'OST', peer, false), side: THREE.FrontSide, metalness: 0.05, roughness: 0.32, transparent: true });
    return new THREE.Mesh(new THREE.PlaneGeometry(0.84, 1.18), material);
  }

  function createThreeTarget(THREE, group, result) {
    var board = new THREE.Mesh(new THREE.PlaneGeometry(2.25, 2.25), new THREE.MeshStandardMaterial({ map: makeTargetTexture(THREE), side: THREE.DoubleSide, metalness: 0.08, roughness: 0.42 }));
    group.add(board);
    var you = makeMarkerMesh(THREE, 0x00ff9f);
    var peer = makeMarkerMesh(THREE, 0xf97316);
    group.add(you, peer);
    var t0 = null;
    var DUR = 1.6;
    group.userData.animate = function (t) {
      if (t0 == null) t0 = t;
      var dt = t - t0;
      board.rotation.z = Math.sin(dt * 0.9) * 0.018;
      if (!result) {
        // Markers orbit board while waiting for reveal.
        var aA = dt * 2.2;
        var aB = dt * 2.2 + Math.PI;
        you.position.set(Math.cos(aA) * 0.7, 0.4 + Math.sin(aA * 1.3) * 0.18, 0.18);
        peer.position.set(Math.cos(aB) * 0.7, -0.4 + Math.sin(aB * 1.3) * 0.18, 0.18);
        return;
      }
      placeTargetMarkerPhys(you, result.challenger, 0, dt, DUR);
      placeTargetMarkerPhys(peer, result.opponent, 1, dt, DUR);
    };
  }

  function makeMarkerMesh(THREE, color) {
    return new THREE.Mesh(new THREE.SphereGeometry(0.105, 24, 16), new THREE.MeshStandardMaterial({ color: color, metalness: 0.38, roughness: 0.26, emissive: color, emissiveIntensity: 0.18 }));
  }

  function placeTargetMarkerPhys(marker, value, lane, dt, DUR) {
    var number = Number(value);
    if (!Number.isFinite(number)) {
      marker.position.set(0, lane ? -0.4 : 0.4, 0.18);
      return;
    }
    var u = Math.min(dt / DUR, 1);
    var ease = easeOutCubic(u);
    var startX = lane ? 1.6 : -1.6;
    var endX = Math.max(-1.05, Math.min(1.05, (number - 50) / 50 * 1.05));
    var endY = lane ? -0.28 : 0.28;
    // Dart-throw: travel sideways while arcing.
    marker.position.x = startX + (endX - startX) * ease;
    marker.position.y = (lane ? -0.4 : 0.4) + (endY - (lane ? -0.4 : 0.4)) * ease;
    var arc = 4 * u * (1 - u);
    marker.position.z = 0.18 + arc * 0.55;
    if (u >= 1) {
      var w = dt - DUR;
      var damp = Math.exp(-w * 5) * 0.06;
      marker.position.z = 0.18 + Math.abs(Math.sin(w * 14)) * damp;
    }
  }

  function placeTargetMarker(marker, value, lane, t) {
    // Backwards-compat helper retained for any external callers.
    var number = Number(value);
    if (!Number.isFinite(number)) {
      var angle = t * 1.9 + lane * Math.PI;
      marker.position.set(Math.cos(angle) * 0.65, Math.sin(angle) * 0.42, 0.14);
      return;
    }
    marker.position.set(Math.max(-1.05, Math.min(1.05, (number - 50) / 50 * 1.05)), lane ? -0.28 : 0.28, 0.14);
  }

  function makeCoinTexture(THREE, label, light, dark) {
    return canvasTexture(THREE, function (ctx, size) {
      var gradient = ctx.createRadialGradient(size * 0.34, size * 0.3, 8, size * 0.5, size * 0.5, size * 0.5);
      gradient.addColorStop(0, '#ffffff');
      gradient.addColorStop(0.32, light);
      gradient.addColorStop(1, dark);
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size * 0.46, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 12;
      ctx.strokeStyle = 'rgba(255,255,255,.5)';
      ctx.stroke();
      ctx.fillStyle = '#08111c';
      ctx.font = '900 96px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, size / 2, size / 2 + 4);
    });
  }

  function makeDiceTexture(THREE, value, peer) {
    return canvasTexture(THREE, function (ctx, size) {
      ctx.fillStyle = peer ? '#fed7aa' : '#e0f2fe';
      roundRect(ctx, 18, 18, size - 36, size - 36, 28);
      ctx.fill();
      ctx.fillStyle = '#061018';
      ctx.font = '900 112px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(value), size / 2, size / 2 + 4);
    });
  }

  function makeCardTexture(THREE, value, peer, back) {
    return canvasTexture(THREE, function (ctx, size) {
      ctx.fillStyle = back ? '#0e7490' : '#f8fafc';
      roundRect(ctx, 24, 12, size - 48, size - 24, 22);
      ctx.fill();
      ctx.strokeStyle = back ? '#7dd3fc' : '#0f172a';
      ctx.lineWidth = 8;
      ctx.stroke();
      ctx.fillStyle = back ? '#dff8ff' : (peer ? '#9a3412' : '#0f172a');
      ctx.font = '900 84px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(value), size / 2, size / 2 + 2);
      ctx.font = '700 24px Arial';
      ctx.fillText(peer ? 'PEER' : 'YOU', size / 2, size - 34);
    });
  }

  function makeTargetTexture(THREE) {
    return canvasTexture(THREE, function (ctx, size) {
      var rings = [['#f59e0b', 0.48], ['#111827', 0.39], ['#38bdf8', 0.3], ['#ffffff', 0.2], ['#ef4444', 0.12], ['#ffffff', 0.055]];
      rings.forEach(function (ring) {
        ctx.fillStyle = ring[0];
        ctx.beginPath();
        ctx.arc(size / 2, size / 2, size * ring[1], 0, Math.PI * 2);
        ctx.fill();
      });
    });
  }

  function canvasTexture(THREE, draw) {
    var canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    var ctx = canvas.getContext('2d');
    draw(ctx, 256);
    var texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    return texture;
  }

  function roundRect(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + width, y, x + width, y + height, radius);
    ctx.arcTo(x + width, y + height, x, y + height, radius);
    ctx.arcTo(x, y + height, x, y, radius);
    ctx.arcTo(x, y, x + width, y, radius);
    ctx.closePath();
  }

  function disposeThreeScene(scene) {
    scene.traverse(function (object) {
      if (object.geometry && object.geometry.dispose) object.geometry.dispose();
      var materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach(function (material) {
        if (!material) return;
        if (material.map && material.map.dispose) material.map.dispose();
        if (material.dispose) material.dispose();
      });
    });
  }

  function requireWalletAddress() {
    var address = walletAddress();
    if (!address) {
      openWallet();
      throw new Error('Connect a wallet before using Mesh money rails.');
    }
    return address;
  }

  async function depositStake(state) {
    var amount = Number(state && state.stake && state.stake.amount || 0) || 0;
    var asset = String(state && state.stake && state.stake.asset || 'OST').toUpperCase();
    if (amount <= 0) return null;
    if (asset !== 'OST') throw new Error('Fair game stakes settle in OST. Use the Mesh wallet Swap or Bridge button first.');
    requireWalletAddress();
    if (!window.OST_RESCUE || typeof window.OST_RESCUE.userSendsOstToPool !== 'function') throw new Error('OST stake vault is still loading. Try again in a moment.');
    updateGameTable(state, 'Confirm the OST stake deposit in your wallet.');
    var memo = JSON.stringify({ k: 'mesh-game-stake', id: state.id, game: state.game, ost: amount, role: state.role, t: Date.now() });
    var result = await window.OST_RESCUE.userSendsOstToPool(amount, memo);
    recordFairGame('stake-deposit', { id: state.id, game: state.game, amount: amount, asset: asset, sig: result && result.sig, role: state.role });
    if (typeof window.recordOstSnapshot === 'function') window.recordOstSnapshot({ ts: Date.now(), kind: 'fair-game-stake', amount: amount, sig: result && result.sig, game: state.game });
    return { sig: result && result.sig, amount: amount, asset: asset, wallet: walletAddress(), paidAt: Date.now() };
  }

  async function cashOutPot(state, button) {
    var amount = Number(state && state.stake && state.stake.amount || 0) || 0;
    if (amount <= 0) return setArenaStatus('This round had no locked stake to cash out.');
    requireWalletAddress();
    if (!window.OST_RESCUE || typeof window.OST_RESCUE.payoutOst !== 'function') throw new Error('OST payout vault is still loading. Try again in a moment.');
    if (button) { button.disabled = true; button.textContent = 'Cashing out...'; }
    var pot = amount * 2;
    var memo = JSON.stringify({ k: 'mesh-game-cashout', id: state.id, game: state.game, pot: pot, t: Date.now() });
    var result = await window.OST_RESCUE.payoutOst(walletAddress(), pot, memo);
    recordFairGame('cashout', { id: state.id, game: state.game, pot: result && result.ost || pot, sig: result && result.sig });
    if (typeof window.recordOstSnapshot === 'function') window.recordOstSnapshot({ ts: Date.now(), kind: 'fair-game-cashout', amount: result && result.ost || pot, sig: result && result.sig, game: state.game });
    if (typeof window.syncOstWalletEventsFromRemote === 'function') window.syncOstWalletEventsFromRemote();
    refreshUnifiedBalances();
    setArenaStatus('Fair game pot cashed out to your linked wallet.');
    if (button) button.textContent = 'Cashed out';
    return result;
  }

  async function sendPayload(type, data, options) {
    options = options || {};
    var p = pavilion();
    if (!p || !p.peerAddr || !p.sessionKey) throw new Error('Connect to a Mesh peer first');
    var payload = Object.assign({ app: APP, v: VERSION, type: type }, data || {});
    if (options.reliable !== false && typeof p.sendAppPayloadReliable === 'function') {
      return p.sendAppPayloadReliable(payload, { timeoutMs: options.timeoutMs || 24000, reconnect: options.reconnect !== false });
    }
    if (typeof p.sendAppPayload !== 'function') throw new Error('Mesh app payload support is not loaded');
    var sent = await p.sendAppPayload(payload);
    if (options.reliable !== false && sent === false) throw new Error('Mesh peer channel is not open. Keep both users in OST Mesh, reconnect, then retry.');
    return sent;
  }

  async function ensureGameChannel() {
    var p = pavilion();
    if (!p || !p.peerAddr || !p.sessionKey) throw new Error('Connect to a Mesh peer first');
    if (typeof p.waitForDataChannel === 'function') {
      setArenaStatus('Checking encrypted peer channel before locking stake...');
      await p.waitForDataChannel({ timeoutMs: 18000, reconnect: true });
    } else if (!p.rtc || !p.rtc.isOpen || !p.rtc.isOpen()) {
      throw new Error('Mesh peer channel is not open. Reconnect before locking stake.');
    }
    return true;
  }

  function retryCard(title, body, label, fn) {
    var card = makeCard(title, body);
    var actions = document.createElement('div');
    actions.className = 'oma-actions';
    var retry = document.createElement('button');
    retry.className = 'primary';
    retry.textContent = label || 'Retry signal';
    retry.addEventListener('click', function () {
      retry.disabled = true;
      Promise.resolve(fn()).catch(function (err) {
        setArenaStatus(err.message);
        retry.disabled = false;
      });
    });
    actions.appendChild(retry);
    card.appendChild(actions);
    return card;
  }

  async function startChallenge(game) {
    var amount = Number(document.getElementById('omaStakeAmount')?.value || 0) || 0;
    var asset = document.getElementById('omaStakeAsset')?.value || 'OST';
    var id = 'game-' + randomHex(8);
    var secret = randomHex(32);
    var commit = await sha256Hex(secret);
    var state = {
      id: id,
      role: 'challenger',
      game: game,
      stake: { amount: amount, asset: asset },
      ownSecret: secret,
      ownCommit: commit,
      ownWallet: walletAddress(),
      peerCommit: '',
      peerSecret: '',
      peerWallet: '',
      ownDeposit: null,
      peerDeposit: null
    };
    challenges.set(id, state);
    try {
      state.ownWallet = requireWalletAddress();
      await ensureGameChannel();
      state.ownDeposit = await depositStake(state);
      var challengePayload = {
        id: id,
        game: game,
        gameLabel: GAME_NAMES[game],
        stake: state.stake,
        commit: commit,
        wallet: state.ownWallet,
        deposit: state.ownDeposit
      };
      await sendPayload('game.challenge', challengePayload, { reliable: true, timeoutMs: 30000 });
      updateGameTable(state, 'Stake locked. Waiting for peer to lock and accept.');
      gameLog(makeCard('Challenge sent', GAME_NAMES[game] + ' for ' + escapeHtml(amountText(state.stake)) + '. Stake is locked before reveal.'));
      setArenaStatus('Challenge sent over the encrypted Mesh channel.');
    } catch (err) {
      if (state.ownDeposit) {
        updateGameTable(state, 'Stake is locked, but the challenge signal did not reach the peer. Reconnect and retry the signal.');
        gameLog(retryCard('Challenge signal not delivered', 'Your stake is already locked. Do not lock again; reconnect Mesh and retry only the challenge signal.', 'Retry challenge signal', function () {
          return sendPayload('game.challenge', {
            id: state.id,
            game: state.game,
            gameLabel: GAME_NAMES[state.game],
            stake: state.stake,
            commit: state.ownCommit,
            wallet: state.ownWallet,
            deposit: state.ownDeposit
          }, { reliable: true, timeoutMs: 30000 }).then(function () {
            updateGameTable(state, 'Stake locked. Waiting for peer to lock and accept.');
            setArenaStatus('Challenge signal resent.');
          });
        }));
      } else {
        challenges.delete(id);
      }
      setArenaStatus(err.message);
    }
  }

  async function acceptChallenge(payload) {
    var state = challenges.get(payload.id);
    if (!state || state.role !== 'opponent') {
      var secret = randomHex(32);
      var commit = await sha256Hex(secret);
      state = {
        id: payload.id,
        role: 'opponent',
        game: payload.game,
        stake: payload.stake || { amount: 0, asset: 'OST' },
        ownSecret: secret,
        ownCommit: commit,
        ownWallet: walletAddress(),
        peerCommit: payload.commit,
        peerSecret: '',
        peerWallet: payload.wallet || '',
        ownDeposit: null,
        peerDeposit: payload.deposit || null
      };
      challenges.set(payload.id, state);
    } else {
      state.peerCommit = state.peerCommit || payload.commit || '';
      state.peerWallet = state.peerWallet || payload.wallet || '';
      state.peerDeposit = state.peerDeposit || payload.deposit || null;
    }
    if (state.peerWallet) knownPeerWallet = state.peerWallet;
    state.ownWallet = requireWalletAddress();
    await ensureGameChannel();
    if (!state.ownDeposit) state.ownDeposit = await depositStake(state);
    try {
      await sendPayload('game.accept', { id: payload.id, commit: state.ownCommit, wallet: state.ownWallet, deposit: state.ownDeposit }, { reliable: true, timeoutMs: 30000 });
    } catch (err) {
      updateGameTable(state, 'Stake is locked, but the accept signal did not reach the challenger. Reconnect and retry the accept signal.');
      gameLog(retryCard('Accept signal not delivered', 'Your stake is already locked. Do not lock again; reconnect Mesh and retry only the accept signal.', 'Retry accept signal', function () { return acceptChallenge(payload); }));
      throw err;
    }
    updateGameTable(state, 'Both stakes locked. Waiting for the challenger seed reveal.');
    incomingChallenges.delete(payload.id);
    gameLog(makeCard('Challenge accepted', 'Both players locked the stake before the reveal. Your commit is <code>' + escapeHtml(state.ownCommit.slice(0, 16)) + '...</code>.'));
  }

  async function handleGameAccept(payload) {
    var state = challenges.get(payload.id);
    if (!state || state.role !== 'challenger') {
      gameLog(makeCard('Accept could not attach', 'Peer accepted a challenge that is no longer active on this device. Ask them to keep the stake proof and start a fresh round.'));
      setArenaStatus('Received an accept for an unknown challenge.');
      return;
    }
    state.peerCommit = payload.commit || '';
    state.peerWallet = payload.wallet || '';
    state.peerDeposit = payload.deposit || null;
    if (state.peerWallet) knownPeerWallet = state.peerWallet;
    notifyArena('challenge', 'OST Mesh game accepted', 'Peer locked the stake and accepted ' + (GAME_NAMES[state.game] || 'the game') + '.', { force: true, tag: 'ost-mesh-game-accept-' + state.id });
    await sendPayload('game.reveal', { id: state.id, secret: state.ownSecret, wallet: state.ownWallet }, { reliable: true, timeoutMs: 30000 });
    updateGameTable(state, 'Peer stake locked. Revealing seeds now.');
    gameLog(makeCard('Peer accepted', 'Your seed was revealed. Waiting for peer reveal.'));
  }

  async function handleGameReveal(payload) {
    var state = challenges.get(payload.id);
    if (!state) return;
    var expected = state.role === 'challenger' ? state.peerCommit : state.peerCommit;
    if (expected) {
      var actual = await sha256Hex(payload.secret || '');
      if (actual !== expected) {
        gameLog(makeCard('Fairness check failed', 'The peer reveal did not match the original commit. Round void.'));
        return;
      }
    }
    state.peerSecret = payload.secret || '';
    state.peerWallet = payload.wallet || state.peerWallet || '';
    if (state.peerWallet) knownPeerWallet = state.peerWallet;
    if (state.role === 'opponent') {
      await sendPayload('game.reveal', { id: state.id, secret: state.ownSecret, wallet: state.ownWallet }, { reliable: true, timeoutMs: 30000 });
    }
    await finalizeGame(state);
  }

  async function finalizeGame(state) {
    if (state.done || !state.ownSecret || !state.peerSecret) return;
    state.done = true;
    var challengerSeed = state.role === 'challenger' ? state.ownSecret : state.peerSecret;
    var opponentSeed = state.role === 'challenger' ? state.peerSecret : state.ownSecret;
    var digest = await sha256Hex([state.id, state.game, challengerSeed, opponentSeed].join(':'));
    var result = resolveGame(state.game, digest);
    var localSide = state.role;
    var didWin = result.winner === localSide;
    var winnerWallet = didWin ? state.ownWallet : state.peerWallet;
    var loserWallet = didWin ? state.peerWallet : state.ownWallet;
    updateGameTable(state, didWin ? 'You won. Cash out the locked pot.' : 'Peer won. Your stake was already locked.', result, digest);
    var card = makeCard(didWin ? 'You won ' + GAME_NAMES[state.game] : 'You lost ' + GAME_NAMES[state.game],
      escapeHtml(result.detail) + '<br>Locked stake: <strong>' + escapeHtml(amountText(state.stake)) + '</strong><br>Pot: <strong>' + escapeHtml(formatAmount(Number(state.stake.amount || 0) * 2)) + ' OST</strong><br>Verify hash: <code>' + escapeHtml(digest.slice(0, 24)) + '...</code>');
    var actions = document.createElement('div');
    actions.className = 'oma-actions';
    if (didWin) {
      var req = document.createElement('button');
      req.className = 'primary';
      req.textContent = Number(state.stake.amount || 0) > 0 ? 'Cash out pot' : 'Request payout';
      req.addEventListener('click', function () {
        if (Number(state.stake.amount || 0) > 0) {
          cashOutPot(state, req).catch(function (err) { setArenaStatus(err.message); req.disabled = false; req.textContent = 'Cash out pot'; });
        } else {
          sendPaymentRequest({ amount: state.stake.amount, asset: state.stake.asset, note: 'Payout for ' + GAME_NAMES[state.game], address: winnerWallet });
        }
      });
      actions.appendChild(req);
    } else {
      var pay = document.createElement('button');
      pay.textContent = Number(state.stake.amount || 0) > 0 ? 'Stake already locked' : 'Pay winner';
      pay.disabled = Number(state.stake.amount || 0) > 0;
      pay.addEventListener('click', function () { copyOrOpenWallet(winnerWallet); });
      actions.appendChild(pay);
    }
    var details = document.createElement('button');
    details.textContent = 'Copy proof';
    details.addEventListener('click', function () {
      copyText(JSON.stringify({ id: state.id, game: state.game, stake: state.stake, result: result, digest: digest, commits: { local: state.ownCommit, peer: state.peerCommit }, wallets: { winner: winnerWallet, loser: loserWallet } }, null, 2));
    });
    actions.appendChild(details);
    card.appendChild(actions);
    gameLog(card);
    if (!didWin) {
      var lostStake = Math.max(0, Number(state.stake && state.stake.amount || 0) || 0);
      if (lostStake > 0) {
        recordFairGame('loss', { id: state.id, game: state.game, amount: lostStake, asset: 'OST', winner: winnerWallet, loser: loserWallet, digest: digest });
        if (typeof window.recordOstVaultRetainedLoss === 'function') {
          try {
            window.recordOstVaultRetainedLoss({
              source: 'mesh-fair-game',
              subKind: 'fair-game-loss',
              amount: lostStake,
              retainedOst: lostStake,
              stake: lostStake,
              payoutOst: 0,
              game: state.game,
              linkedId: state.id,
              winner: winnerWallet,
              loser: loserWallet,
              digest: digest
            });
          } catch (_) {}
        }
        if (typeof window.notifyOstTxHistory === 'function') window.notifyOstTxHistory();
      }
    }
    // FairGameFxHook: announce settled outcome so the FX polish layer can
    // play sounds, haptics, confetti and inject a Rematch button. Pure
    // event dispatch — no behaviour change here.
    try {
      window.dispatchEvent(new CustomEvent('ost:fair-game-settled', {
        detail: {
          id: state.id,
          game: state.game,
          gameLabel: GAME_NAMES[state.game] || state.game,
          didWin: didWin,
          stake: { amount: Number(state.stake.amount || 0), asset: state.stake.asset || 'OST' },
          peerWallet: state.peerWallet || '',
          ownWallet: state.ownWallet || '',
          digest: digest,
          card: card
        }
      }));
    } catch (_) {}
  }

  function resolveGame(game, digest) {
    var b = hexBytes(digest);
    if (game === 'dice') {
      for (var i = 0; i < b.length - 1; i += 2) {
        var c = 1 + (b[i] % 6);
        var o = 1 + (b[i + 1] % 6);
        if (c !== o) return { winner: c > o ? 'challenger' : 'opponent', detail: 'Dice rolled ' + c + ' vs ' + o + '.', challenger: c, opponent: o };
      }
    }
    if (game === 'highcard') {
      var names = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
      for (var j = 0; j < b.length - 1; j += 2) {
        var cv = b[j] % 13;
        var ov = b[j + 1] % 13;
        if (cv !== ov) return { winner: cv > ov ? 'challenger' : 'opponent', detail: 'Cards drew ' + names[cv] + ' vs ' + names[ov] + '.', challenger: names[cv], opponent: names[ov] };
      }
    }
    if (game === 'target') {
      for (var k = 0; k < b.length - 1; k += 2) {
        var cr = b[k] % 100;
        var or = b[k + 1] % 100;
        var cd = Math.abs(50 - cr);
        var od = Math.abs(50 - or);
        if (cd !== od) return { winner: cd < od ? 'challenger' : 'opponent', detail: 'Target rolls were ' + cr + ' vs ' + or + ', closest to 50 wins.', challenger: cr, opponent: or };
      }
    }
    var heads = b[0] % 2 === 0;
    return { winner: heads ? 'challenger' : 'opponent', detail: 'Coin landed ' + (heads ? 'heads' : 'tails') + '.', coin: heads ? 'H' : 'T' };
  }

  function renderIncomingChallenge(payload) {
    var p = pavilion();
    if (p && p.open) p.open();
    if (!document.getElementById(ROOT_ID) && p) mount(p);
    var existing = challenges.get(payload.id);
    if (existing && existing.role === 'opponent' && existing.ownDeposit) {
      setArenaStatus('Challenge signal repeated. Resending your locked accept signal.');
      acceptChallenge(payload).catch(function (err) { setArenaStatus(err.message); });
      return;
    }
    if (incomingChallenges.has(payload.id)) {
      setArenaStatus('This challenge is already open. Accept it or decline it.');
      return;
    }
    incomingChallenges.add(payload.id);
    if (payload.wallet) knownPeerWallet = payload.wallet;
    notifyArena('challenge', 'OST Mesh challenge', (payload.gameLabel || GAME_NAMES[payload.game] || 'Game') + ' for ' + amountText(payload.stake) + '.', { force: true, requireInteraction: true, tag: 'ost-mesh-challenge-' + payload.id });
    updateGameTable({ game: payload.game, stake: payload.stake || { amount: 0, asset: 'OST' }, peerWallet: payload.wallet || '' }, 'Incoming challenge. Accepting locks your matching stake first.');
    var card = makeCard('Game challenge', escapeHtml(payload.gameLabel || GAME_NAMES[payload.game] || 'Game') + ' for <strong>' + escapeHtml(amountText(payload.stake)) + '</strong><br>Peer commit: <code>' + escapeHtml(String(payload.commit || '').slice(0, 16)) + '...</code>');
    var actions = document.createElement('div');
    actions.className = 'oma-actions';
    var accept = document.createElement('button');
    accept.className = 'primary';
    accept.textContent = 'Accept';
    accept.addEventListener('click', function () {
      accept.disabled = true;
      acceptChallenge(payload).catch(function (err) { setArenaStatus(err.message); accept.disabled = false; });
    });
    var decline = document.createElement('button');
    decline.textContent = 'Decline';
    decline.addEventListener('click', function () { incomingChallenges.delete(payload.id); sendPayload('game.decline', { id: payload.id }, { reliable: false }).catch(function () {}); card.remove(); });
    actions.appendChild(accept);
    actions.appendChild(decline);
    card.appendChild(actions);
    renderPeerCard(card);
  }

  function handleRemotePayload(payload) {
    if (!payload || payload.kind !== 'mesh-app' || payload.app !== APP) return false;
    if (payload.type === 'game.challenge') renderIncomingChallenge(payload);
    else if (payload.type === 'game.accept') handleGameAccept(payload).catch(function (err) { setArenaStatus(err.message); });
    else if (payload.type === 'game.reveal') handleGameReveal(payload).catch(function (err) { setArenaStatus(err.message); });
    else if (payload.type === 'game.decline') gameLog(makeCard('Challenge declined', 'Peer declined the game challenge.'));
    else if (payload.type === 'wallet.card') renderWalletCard(payload);
    else if (payload.type === 'wallet.paid') renderWalletReceipt(payload);
    else if (payload.type === 'share.card') renderShareCard(payload);
    return true;
  }

  function renderPeerCard(card) {
    var p = pavilion();
    if (p && p._bubble) p._bubble('peer', card);
  }

  function renderLocalCard(card) {
    var p = pavilion();
    if (p && p._bubble) p._bubble('me', card);
  }

  function refreshWalletLine() {
    var el = document.getElementById('omaWalletLine');
    if (!el) return;
    var addr = walletAddress();
    el.innerHTML = addr ? 'Connected wallet <code>' + escapeHtml(short(addr)) + '</code>. Mesh can buy, receive, request, send OST, and lock fair-game stakes from this account.' : 'Wallet not connected. Open the wallet rail before sending payment requests or locking game stakes.';
    refreshUnifiedBalances();
  }

  async function refreshUnifiedBalances() {
    var strip = document.getElementById('omaBalanceStrip');
    if (!strip) return;
    var walletBal = 0;
    var addr = walletAddress();
    try {
      if (addr && window.OST_WALLET && typeof window.OST_WALLET.getOstBalance === 'function') walletBal = await window.OST_WALLET.getOstBalance(addr);
    } catch (_) {}
    var fair = fairGameTotals();
    var ledger = readJson('ost.wallet.platformLedger.v1', {}) || {};
    var predictionOrders = readJson('ost.prediction.orders.v1', []);
    if (!Array.isArray(predictionOrders)) predictionOrders = [];
    var predictionOpen = predictionOrders.reduce(function (sum, order) {
      return sum + (/open|pending|active/i.test(String(order.status || 'open')) ? Number(order.stake || order.amount || 0) || 0 : 0);
    }, 0);
    var offline = readJson('ost.offline.vault.v1', {}) || {};
    strip.innerHTML = [
      balanceTile('Wallet OST', formatAmount(walletBal)),
      balanceTile('Fair games', formatAmount(Math.max(0, fair.escrow - fair.cashout))),
      balanceTile('Predictions', formatAmount(predictionOpen)),
      balanceTile('Memecoins/offline', formatAmount(Number(ledger.launchpadExposure || 0) + Number(offline.balance || offline.total || 0)))
    ].join('');
  }

  function balanceTile(label, value) {
    return '<div class="oma-balance-tile"><span>' + escapeHtml(label) + '</span><strong>' + escapeHtml(value) + ' OST</strong></div>';
  }

  function handleWalletAction(action) {
    if (action === 'buy' || action === 'swap') return openWalletPanel('convert');
    if (action === 'bridge') return openWalletPanel('portals');
    if (action === 'receive') return shareReceiveAddress();
    if (action === 'cashout') return openWalletPanel('convert');
    if (action === 'offline') return activateSection('offline');
  }

  function activateSection(id) {
    if (window.OST_COMPARTMENTS && typeof window.OST_COMPARTMENTS.activate === 'function') window.OST_COMPARTMENTS.activate(id, true);
    else location.hash = '#' + id;
  }

  function openWalletPanel(panel) {
    activateSection('wallet');
    window.setTimeout(function () {
      var tab = document.querySelector('[data-wallet-tab="' + panel + '"], [data-wallet-panel-target="' + panel + '"]');
      if (tab && typeof tab.click === 'function') tab.click();
    }, 220);
  }

  function sendPaymentRequest(opts) {
    opts = opts || {};
    var amount = opts.amount != null ? Number(opts.amount) : Number(document.getElementById('omaPayAmount')?.value || 0);
    var asset = opts.asset || document.getElementById('omaPayAsset')?.value || 'OST';
    var note = opts.note || document.getElementById('omaPayNote')?.value || 'OST Mesh payment request';
    var address = opts.address || walletAddress();
    if (!address) return openWallet();
    var payload = { mode: 'request', amount: amount, asset: asset, note: note, address: address };
    sendPayload('wallet.card', payload).then(function () {
      renderLocalCard(walletCardNode('Payment request sent', payload));
      toast('Payment request sent.');
    }).catch(function (err) { setArenaStatus(err.message); });
  }

  function shareReceiveAddress() {
    var address = walletAddress();
    var asset = document.getElementById('omaPayAsset')?.value || 'OST';
    if (!address) return openWallet();
    var payload = { mode: 'receive', amount: 0, asset: asset, note: 'Receive ' + asset, address: address };
    sendPayload('wallet.card', payload).then(function () {
      renderLocalCard(walletCardNode('Receive address shared', payload));
      toast('Receive address shared.');
    }).catch(function (err) { setArenaStatus(err.message); });
  }

  function walletCardNode(title, payload) {
    var body = payload.mode === 'request'
      ? 'Request: <strong>' + escapeHtml(amountText(payload)) + '</strong><br>' + escapeHtml(payload.note || '') + '<br>Pay to <code>' + escapeHtml(payload.address || '') + '</code>'
      : 'Receive ' + escapeHtml(String(payload.asset || 'OST').toUpperCase()) + ' at <code>' + escapeHtml(payload.address || '') + '</code>';
    var card = makeCard(title, body);
    var actions = document.createElement('div');
    actions.className = 'oma-actions';
    var copy = document.createElement('button');
    copy.className = 'primary';
    copy.textContent = 'Copy address';
    copy.addEventListener('click', function () { copyText(payload.address || ''); });
    var wallet = document.createElement('button');
    wallet.textContent = 'Open wallet';
    wallet.addEventListener('click', openWallet);
    actions.appendChild(copy);
    if (payload.mode === 'request' && payload.address) {
      var pay = document.createElement('button');
      pay.className = 'primary';
      pay.textContent = String(payload.asset || 'OST').toUpperCase() === 'OST' ? 'Pay now' : 'Open swap';
      pay.addEventListener('click', function () {
        if (String(payload.asset || 'OST').toUpperCase() !== 'OST') return openWalletPanel('convert');
        directSendOst(payload.address, payload.amount, payload.note || 'OST Mesh payment').catch(function (err) { setArenaStatus(err.message); });
      });
      actions.appendChild(pay);
    }
    actions.appendChild(wallet);
    card.appendChild(actions);
    return card;
  }

  function renderWalletCard(payload) {
    if (payload.address) knownPeerWallet = payload.address;
    renderPeerCard(walletCardNode(payload.mode === 'request' ? 'Peer payment request' : 'Peer receive address', payload));
  }

  function renderWalletReceipt(payload) {
    renderPeerCard(makeCard('Payment received', 'Peer sent <strong>' + escapeHtml(amountText(payload)) + '</strong><br>' + escapeHtml(payload.note || '') + '<br>' + (payload.sig ? '<code>' + escapeHtml(payload.sig) + '</code>' : '')));
  }

  function sendOstToKnownPeer() {
    var amount = Number(document.getElementById('omaPayAmount')?.value || 0) || 0;
    var note = document.getElementById('omaPayNote')?.value || 'OST Mesh direct payment';
    if (!knownPeerWallet) return setArenaStatus('Ask the peer to share a receive address first.');
    directSendOst(knownPeerWallet, amount, note).catch(function (err) { setArenaStatus(err.message); });
  }

  async function directSendOst(toAddress, amount, note) {
    amount = Number(amount || 0);
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('Enter a valid OST amount.');
    requireWalletAddress();
    if (typeof solanaWeb3 === 'undefined') throw new Error('Solana web3 is still loading.');
    var w = window.OST_WALLET;
    if (!w || !w.session || !w.session.publicKey) throw new Error('Connect a wallet first.');
    if (!window.OST_RESCUE || typeof window.OST_RESCUE.ensureUserAta !== 'function' || typeof window.OST_RESCUE.sendUserSignedPoolPaidTx !== 'function') throw new Error('OST fee vault is still loading.');
    var c = w.constants;
    var toPubkey = new solanaWeb3.PublicKey(toAddress);
    var mintPk = new solanaWeb3.PublicKey(window.OST_SWAP_POOL.mint);
    var fromAta = await window.OST_RESCUE.ensureUserAta(w.session.publicKey);
    var toAta = await window.OST_RESCUE.ensureUserAta(toPubkey);
    var ixs = [w.transferChecked(fromAta, mintPk, toAta, w.session.publicKey, w.toBaseUnits(amount, c.OST_TOKEN_DECIMALS), c.OST_TOKEN_DECIMALS, c.TOKEN_2022_PROGRAM_ID)];
    if (note) ixs.push(w.memoIx(String(note), w.session.publicKey));
    setArenaStatus('Sending OST directly inside Mesh...');
    var sig = await window.OST_RESCUE.sendUserSignedPoolPaidTx(ixs);
    if (typeof window.recordOstSnapshot === 'function') window.recordOstSnapshot({ ts: Date.now(), kind: 'send', amount: amount, sig: sig, to: toAddress });
    try { window.dispatchEvent(new CustomEvent('ost:wallet-changed')); } catch (_) {}
    await sendPayload('wallet.paid', { mode: 'paid', amount: amount, asset: 'OST', note: note, address: walletAddress(), sig: sig }).catch(function () {});
    renderLocalCard(makeCard('OST sent', '<strong>' + escapeHtml(formatAmount(amount)) + ' OST</strong> sent to <code>' + escapeHtml(short(toAddress)) + '</code><br><code>' + escapeHtml(sig) + '</code>'));
    refreshUnifiedBalances();
    setArenaStatus('OST sent directly to peer wallet.');
    return sig;
  }

  function copyOrOpenWallet(address) {
    if (address) copyText(address);
    openWallet();
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(String(text || '')).catch(function () {});
  }

  function selectedPrediction() {
    var title = textOf('predictionSelectedTitle') || textOf('predictionStageTitle') || textOf('predictionHeroTitle');
    var detail = textOf('predictionSelectedDetail') || textOf('predictionStageDetail') || textOf('predictionHeroDetail');
    if (!title || /no market selected|select a/i.test(title)) {
      var card = document.querySelector('.prediction-market-card[data-prediction-market-id]');
      if (card) {
        title = (card.querySelector('h4,h5,h6,strong') || card).textContent.trim();
        detail = card.textContent.trim().replace(/\s+/g, ' ').slice(0, 180);
      }
    }
    return title ? { shareType: 'prediction', title: title, detail: detail, url: location.origin + location.pathname + '#wallet' } : null;
  }

  function selectedCoin() {
    var symbol = textOf('lpPulseHot') || textOf('lpPulseNew') || textOf('lpStatKoth');
    var row = document.querySelector('.ost-coin');
    if (row) {
      var name = row.querySelector('.ost-coin__name')?.textContent.trim() || '';
      var sym = row.querySelector('.ost-coin__sym')?.textContent.trim() || symbol || '';
      return { shareType: 'memecoin', title: name || sym || 'OST launchpad coin', detail: sym + ' ' + (row.querySelector('.ost-coin__mcap')?.textContent.trim() || ''), url: location.origin + location.pathname + '#launchpad' };
    }
    if (symbol && symbol !== '--') return { shareType: 'memecoin', title: symbol, detail: 'Hot OST launchpad coin', url: location.origin + location.pathname + '#launchpad' };
    return null;
  }

  function textOf(id) {
    var el = document.getElementById(id);
    return el ? el.textContent.trim() : '';
  }

  function refreshSharePreviews() {
    var prediction = selectedPrediction();
    var coin = selectedCoin();
    var pEl = document.getElementById('omaPredictionPreview');
    var cEl = document.getElementById('omaCoinPreview');
    if (pEl) pEl.textContent = prediction ? prediction.title : 'No market selected yet.';
    if (cEl) cEl.textContent = coin ? coin.title : 'No coin selected yet.';
  }

  function sharePrediction() {
    var share = selectedPrediction();
    if (!share) return setArenaStatus('Select a prediction market first.');
    sendShare(share);
  }

  function shareCoin() {
    var share = selectedCoin();
    if (!share) return setArenaStatus('Open a launchpad coin first.');
    sendShare(share);
  }

  function sendShare(share) {
    sendPayload('share.card', share).then(function () {
      renderLocalCard(shareCardNode('Shared ' + (share.shareType === 'prediction' ? 'prediction market' : 'memecoin'), share));
      toast('Share card sent.');
    }).catch(function (err) { setArenaStatus(err.message); });
  }

  function shareCardNode(title, payload) {
    var card = makeCard(title, '<strong>' + escapeHtml(payload.title || 'Shared item') + '</strong><br>' + escapeHtml(payload.detail || '') + '<br><code>' + escapeHtml(payload.url || '') + '</code>');
    var actions = document.createElement('div');
    actions.className = 'oma-actions';
    var open = document.createElement('button');
    open.className = 'primary';
    open.textContent = payload.shareType === 'prediction' ? 'Open market' : 'Open coin';
    open.addEventListener('click', function () { openShare(payload); });
    actions.appendChild(open);
    card.appendChild(actions);
    return card;
  }

  function renderShareCard(payload) {
    renderPeerCard(shareCardNode(payload.shareType === 'prediction' ? 'Peer shared a prediction market' : 'Peer shared a memecoin', payload));
  }

  function openShare(payload) {
    if (payload.shareType === 'memecoin') {
      location.hash = '#launchpad';
      setTimeout(function () {
        var tab = document.querySelector('[data-tab="feed"], [data-lp-jump="feed"]');
        if (tab) tab.click();
      }, 250);
      return;
    }
    location.hash = '#wallet';
    setTimeout(function () {
      var marketTab = document.querySelector('[data-wallet-panel-target="market"]');
      if (marketTab) marketTab.click();
      var search = document.getElementById('predictionMarketSearch');
      if (search && payload.title) {
        search.value = payload.title;
        search.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }, 300);
  }

  window.addEventListener('ost:mesh-payload', function (event) {
    if (handleRemotePayload(event.detail && event.detail.payload)) event.preventDefault();
  });

  window.OST_MESH_ARENA = {
    status: function () {
      return {
        mounted: !!document.getElementById(ROOT_ID),
        games: Object.keys(GAME_NAMES),
        pendingChallenges: challenges.size,
        wallet: walletAddress(),
        meshReady: !!(pavilion() && pavilion().sessionKey)
      };
    },
    refresh: function () {
      refreshWalletLine();
      refreshSharePreviews();
      refreshUnifiedBalances();
    },
    open: openMeshArena,
    focus: function (game) {
      selectGame(game || selectedGame);
      selectTab('games');
    },
    // ArenaLinkBridge: cross-service entry points used by mesh-link.js + contacts
    sendOstTo: function (address, amount, note) {
      if (!address) throw new Error('Send-to address is required.');
      openMeshArena();
      selectTab('wallet');
      knownPeerWallet = String(address);
      var amt = Number(amount || 0);
      if (Number.isFinite(amt) && amt > 0) {
        return directSendOst(String(address), amt, note || 'OST Mesh direct payment');
      }
      setArenaStatus('Peer wallet primed. Set an amount and tap "Send OST to peer".');
      return Promise.resolve(null);
    },
    requestPayment: function (amount, asset, note) {
      openMeshArena();
      selectTab('wallet');
      try { sendPaymentRequest({ amount: amount, asset: asset || 'OST', note: note }); }
      catch (err) { setArenaStatus(err && err.message ? err.message : 'Could not send request.'); }
      return true;
    },
    challenge: function (address, game) {
      openMeshArena();
      selectGame(game || selectedGame);
      selectTab('games');
      if (address) knownPeerWallet = String(address);
      setArenaStatus('Connect to the peer in OST Mesh, then tap "Challenge" on the game card.');
      return true;
    },
    share: function (kind /*, opts */) {
      openMeshArena();
      selectTab('share');
      if (kind === 'prediction' || kind === 'market') return sharePrediction();
      if (kind === 'coin' || kind === 'memecoin' || kind === 'launchpad') return shareCoin();
      if (kind === 'address' || kind === 'receive') return shareReceiveAddress();
      return false;
    },
    setKnownPeerWallet: function (address) { if (address) knownPeerWallet = String(address); }
  };

  ready(function () {
    waitForMesh(mount);
    mountFairGamesEntry();
  });
})();

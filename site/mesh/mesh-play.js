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
  var VERSION = 1;
  var GAME_NAMES = {
    coinflip: 'Coin Flip',
    dice: 'Dice Duel',
    highcard: 'High Card',
    target: 'Target 50'
  };
  var challenges = new Map();
  var selectedGame = 'coinflip';

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

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = [
      '#ost-mesh-arena{border:1px solid rgba(0,212,255,.18);border-radius:14px;background:rgba(1,14,24,.76);padding:12px;margin:10px 0;display:grid;gap:10px}',
      '#ost-mesh-arena-fair-entry{border:1px solid rgba(0,212,255,.22);border-radius:16px;background:linear-gradient(135deg,rgba(0,212,255,.12),rgba(0,255,159,.08));padding:14px;margin:12px 0;display:grid;gap:12px;color:#e8fbff}',
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
        '<div class="oma-form">',
          '<label class="oma-field">Stake amount<input id="omaStakeAmount" type="number" min="0" step="0.01" value="1"></label>',
          '<label class="oma-field">Asset<select id="omaStakeAsset"><option>OST</option><option>SOL</option><option>USDC</option><option>ANY</option></select></label>',
          '<button class="oma-btn primary" id="omaChallenge" type="button">Challenge peer</button>',
        '</div>',
        '<div class="oma-actions"><button type="button" id="omaVoice">Start voice</button><button type="button" id="omaVideo">Start video</button></div>',
        '<div class="oma-log" id="omaGameLog"></div>',
      '</div>',
      '<div class="oma-pane" data-oma-pane="wallet">',
        '<div class="oma-card"><h4>Connected wallet rail</h4><p id="omaWalletLine">Wallet not connected.</p></div>',
        '<div class="oma-form">',
          '<label class="oma-field">Amount<input id="omaPayAmount" type="number" min="0" step="0.01" value="1"></label>',
          '<label class="oma-field">Asset<select id="omaPayAsset"><option>OST</option><option>SOL</option><option>USDC</option><option>ANY</option></select></label>',
          '<button class="oma-btn primary" id="omaRequestPay" type="button">Request payment</button>',
        '</div>',
        '<label class="oma-field">Note<input id="omaPayNote" type="text" maxlength="120" placeholder="Game payout, invoice, tip, trade settlement"></label>',
        '<div class="oma-actions"><button type="button" id="omaShareReceive">Share receive address</button><button type="button" id="omaOpenWallet">Open wallet</button></div>',
      '</div>',
      '<div class="oma-pane" data-oma-pane="share">',
        '<div class="oma-share-row">',
          '<div class="oma-card"><h4>Prediction market</h4><p id="omaPredictionPreview">No market selected yet.</p><div class="oma-actions"><button class="primary" type="button" id="omaSharePrediction">Share active market</button></div></div>',
          '<div class="oma-card"><h4>Memecoin</h4><p id="omaCoinPreview">No coin selected yet.</p><div class="oma-actions"><button class="primary" type="button" id="omaShareCoin">Share hot coin</button></div></div>',
        '</div>',
      '</div>'
    ].join('');
    stage.parentElement.insertBefore(root, stage);
    bind(root, p);
    refreshWalletLine();
    refreshSharePreviews();
    setInterval(refreshWalletLine, 4000);
    setInterval(refreshSharePreviews, 5000);
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
    root.querySelector('#omaShareReceive').addEventListener('click', shareReceiveAddress);
    root.querySelector('#omaOpenWallet').addEventListener('click', openWallet);
    root.querySelector('#omaSharePrediction').addEventListener('click', sharePrediction);
    root.querySelector('#omaShareCoin').addEventListener('click', shareCoin);
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
  }

  function openMeshArena(game) {
    waitForMesh(function (p) {
      if (window.OST_MESH && typeof window.OST_MESH.open === 'function') window.OST_MESH.open();
      mount(p);
      selectGame(game || selectedGame);
      selectTab('games');
      refreshWalletLine();
      refreshSharePreviews();
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

  async function sendPayload(type, data) {
    var p = pavilion();
    if (!p || !p.peerAddr || !p.sessionKey) throw new Error('Connect to a Mesh peer first');
    if (typeof p.sendAppPayload !== 'function') throw new Error('Mesh app payload support is not loaded');
    return p.sendAppPayload(Object.assign({ app: APP, v: VERSION, type: type }, data || {}));
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
      peerWallet: ''
    };
    challenges.set(id, state);
    try {
      await sendPayload('game.challenge', {
        id: id,
        game: game,
        gameLabel: GAME_NAMES[game],
        stake: state.stake,
        commit: commit,
        wallet: state.ownWallet
      });
      gameLog(makeCard('Challenge sent', GAME_NAMES[game] + ' for ' + escapeHtml(amountText(state.stake)) + '. Waiting for peer to accept.'));
      setArenaStatus('Challenge sent over the encrypted Mesh channel.');
    } catch (err) {
      challenges.delete(id);
      setArenaStatus(err.message);
    }
  }

  async function acceptChallenge(payload) {
    var secret = randomHex(32);
    var commit = await sha256Hex(secret);
    var state = {
      id: payload.id,
      role: 'opponent',
      game: payload.game,
      stake: payload.stake || { amount: 0, asset: 'OST' },
      ownSecret: secret,
      ownCommit: commit,
      ownWallet: walletAddress(),
      peerCommit: payload.commit,
      peerSecret: '',
      peerWallet: payload.wallet || ''
    };
    challenges.set(payload.id, state);
    await sendPayload('game.accept', { id: payload.id, commit: commit, wallet: state.ownWallet });
    gameLog(makeCard('Challenge accepted', 'Waiting for the challenger seed reveal. Your commit is <code>' + escapeHtml(commit.slice(0, 16)) + '...</code>.'));
  }

  async function handleGameAccept(payload) {
    var state = challenges.get(payload.id);
    if (!state || state.role !== 'challenger') return;
    state.peerCommit = payload.commit || '';
    state.peerWallet = payload.wallet || '';
    await sendPayload('game.reveal', { id: state.id, secret: state.ownSecret, wallet: state.ownWallet });
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
    if (state.role === 'opponent') {
      await sendPayload('game.reveal', { id: state.id, secret: state.ownSecret, wallet: state.ownWallet });
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
    var card = makeCard(didWin ? 'You won ' + GAME_NAMES[state.game] : 'You lost ' + GAME_NAMES[state.game],
      escapeHtml(result.detail) + '<br>Stake: <strong>' + escapeHtml(amountText(state.stake)) + '</strong><br>Verify hash: <code>' + escapeHtml(digest.slice(0, 24)) + '...</code>');
    var actions = document.createElement('div');
    actions.className = 'oma-actions';
    if (didWin) {
      var req = document.createElement('button');
      req.className = 'primary';
      req.textContent = 'Request payout';
      req.addEventListener('click', function () {
        sendPaymentRequest({ amount: state.stake.amount, asset: state.stake.asset, note: 'Payout for ' + GAME_NAMES[state.game], address: winnerWallet });
      });
      actions.appendChild(req);
    } else {
      var pay = document.createElement('button');
      pay.className = 'primary';
      pay.textContent = 'Pay winner';
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
  }

  function resolveGame(game, digest) {
    var b = hexBytes(digest);
    if (game === 'dice') {
      for (var i = 0; i < b.length - 1; i += 2) {
        var c = 1 + (b[i] % 6);
        var o = 1 + (b[i + 1] % 6);
        if (c !== o) return { winner: c > o ? 'challenger' : 'opponent', detail: 'Dice rolled ' + c + ' vs ' + o + '.' };
      }
    }
    if (game === 'highcard') {
      var names = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
      for (var j = 0; j < b.length - 1; j += 2) {
        var cv = b[j] % 13;
        var ov = b[j + 1] % 13;
        if (cv !== ov) return { winner: cv > ov ? 'challenger' : 'opponent', detail: 'Cards drew ' + names[cv] + ' vs ' + names[ov] + '.' };
      }
    }
    if (game === 'target') {
      for (var k = 0; k < b.length - 1; k += 2) {
        var cr = b[k] % 100;
        var or = b[k + 1] % 100;
        var cd = Math.abs(50 - cr);
        var od = Math.abs(50 - or);
        if (cd !== od) return { winner: cd < od ? 'challenger' : 'opponent', detail: 'Target rolls were ' + cr + ' vs ' + or + ', closest to 50 wins.' };
      }
    }
    var heads = b[0] % 2 === 0;
    return { winner: heads ? 'challenger' : 'opponent', detail: 'Coin landed ' + (heads ? 'heads' : 'tails') + '.' };
  }

  function renderIncomingChallenge(payload) {
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
    decline.addEventListener('click', function () { sendPayload('game.decline', { id: payload.id }).catch(function () {}); card.remove(); });
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
    el.innerHTML = addr ? 'Connected wallet <code>' + escapeHtml(short(addr)) + '</code>. Payment cards always require user confirmation in the wallet.' : 'Wallet not connected. Open the wallet rail before sending payment requests.';
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
    actions.appendChild(wallet);
    card.appendChild(actions);
    return card;
  }

  function renderWalletCard(payload) {
    renderPeerCard(walletCardNode(payload.mode === 'request' ? 'Peer payment request' : 'Peer receive address', payload));
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
    },
    open: openMeshArena,
    focus: function (game) {
      selectGame(game || selectedGame);
      selectTab('games');
    }
  };

  ready(function () {
    waitForMesh(mount);
    mountFairGamesEntry();
  });
})();

/*
 * mesh-group-markets.js  (v2 — selfAddress aligned with mesh-social-x via pavilion())
 * --------------------------------------------------------------
 * OST's answer to iOS 26 Messages polls: stake-backed peer
 * prediction markets that live INSIDE existing mesh group chats.
 *
 * - Any group member can create a market (question + 2..6 options).
 * - Members back options with real OST credits (debited from
 *   `ost.faucet.hub.v2`).
 * - Only the creator can resolve. On resolve, the loser pot is
 *   distributed pro-rata to backers of the winning option (winners
 *   also get their original stake back).
 * - All state is mirrored peer-to-peer over the existing
 *   `ost:mesh-payload` bus that mesh-social-x.js already uses.
 *
 * This module hooks the existing #msxChatModal via a MutationObserver
 * and never touches mesh-social-x.js source.
 * --------------------------------------------------------------
 */
(function () {
  'use strict';

  var APP = 'mesh-group-markets';
  var MARKETS_PREFIX = 'ost.mesh.groupMarkets.v1.'; // + groupId
  var SEEN_KEY = 'ost.mesh.groupMarkets.seen.v1';
  var WALLET_KEY = 'ost.faucet.hub.v2';

  // ---------- Tiny helpers ----------
  function readJson(k, fb) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : fb; } catch (e) { return fb; } }
  function writeJson(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function uid(p) { return (p || 'gm') + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8); }
  function escapeHtml(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
  function clamp(n, lo, hi) { n = Number(n); if (!isFinite(n)) n = lo; return Math.max(lo, Math.min(hi, n)); }
  function fmt(n) { return Number(n || 0).toFixed(2); }
  function nowMs() { return Date.now(); }

  function shortAddr(a) {
    if (!a) return '?';
    a = String(a);
    return a.length > 10 ? a.slice(0, 4) + '…' + a.slice(-4) : a;
  }

  function selfAddress() {
    try {
      var p = pavilion();
      if (p && p.address) return p.address;
      if (window.OST_WALLET && typeof window.OST_WALLET.address === 'function') return window.OST_WALLET.address() || 'local';
      var pk = localStorage.getItem('ost.mesh.publicKey');
      if (pk) return pk;
    } catch (e) {}
    return 'local';
  }
  function selfNick() {
    try {
      var keys = ['ost.mesh.profile.v1', 'ost.mesh.profile', 'ost.profile.v1'];
      for (var i = 0; i < keys.length; i++) {
        var raw = localStorage.getItem(keys[i]);
        if (!raw) continue;
        try {
          var obj = JSON.parse(raw);
          if (obj && (obj.nickname || obj.handle)) return obj.nickname || obj.handle;
        } catch (e) {}
      }
      var nick = localStorage.getItem('ost.mesh.nick');
      if (nick) return nick;
    } catch (e) {}
    return 'You';
  }

  // ---------- Wallet (faucet hub credits) ----------
  function loadWallet() { try { return JSON.parse(localStorage.getItem(WALLET_KEY) || '{}'); } catch (e) { return {}; } }
  function saveWallet(s) { try { localStorage.setItem(WALLET_KEY, JSON.stringify(s)); } catch (e) {} }
  function getCredits() { return Number(loadWallet().credits || 0); }

  function debitCredits(amount, reason) {
    amount = Number(amount);
    if (!(amount > 0)) return false;
    var s = loadWallet();
    var bal = Number(s.credits || 0);
    if (bal < amount - 1e-9) return false;
    s.credits = +(bal - amount).toFixed(6);
    saveWallet(s);
    try { window.dispatchEvent(new CustomEvent('ost-faucet-hub-award', { detail: { credits: -amount, source: reason || 'market.debit', total: s.credits } })); } catch (e) {}
    if (window.OST_FAUCET_HUB && typeof window.OST_FAUCET_HUB.refresh === 'function') { try { window.OST_FAUCET_HUB.refresh(); } catch (e) {} }
    return true;
  }
  function creditCredits(amount, reason) {
    amount = Number(amount);
    if (!(amount > 0)) return;
    if (window.OST_FAUCET_HUB && typeof window.OST_FAUCET_HUB.award === 'function') {
      try { window.OST_FAUCET_HUB.award(amount, reason || 'market.payout'); return; } catch (e) {}
    }
    var s = loadWallet();
    s.credits = +((Number(s.credits || 0)) + amount).toFixed(6);
    s.lifetime = +((Number(s.lifetime || 0)) + amount).toFixed(6);
    saveWallet(s);
    try { window.dispatchEvent(new CustomEvent('ost-faucet-hub-award', { detail: { credits: amount, source: reason || 'market.payout', total: s.credits } })); } catch (e) {}
  }

  // ---------- Markets storage ----------
  function listMarkets(groupId) { return readJson(MARKETS_PREFIX + groupId, []); }
  function saveMarkets(groupId, list) { writeJson(MARKETS_PREFIX + groupId, list.slice(-200)); }
  function findMarket(groupId, marketId) {
    var list = listMarkets(groupId);
    for (var i = 0; i < list.length; i++) if (list[i].id === marketId) return list[i];
    return null;
  }
  function upsertMarket(market) {
    if (!market || !market.id || !market.groupId) return;
    var list = listMarkets(market.groupId);
    var found = false;
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === market.id) { list[i] = market; found = true; break; }
    }
    if (!found) list.push(market);
    saveMarkets(market.groupId, list);
  }

  function totalsFor(market) {
    var pot = 0, perOption = {};
    (market.options || []).forEach(function (o) {
      var t = (o.backers || []).reduce(function (acc, b) { return acc + Number(b.amount || 0); }, 0);
      perOption[o.id] = t; pot += t;
    });
    return { pot: pot, perOption: perOption };
  }

  // ---------- Pavilion / broadcast ----------
  function pavilion() {
    try {
      if (window.OST_MESH_PAVILION) return window.OST_MESH_PAVILION;
      if (window.MESH && window.MESH.pavilion) return window.MESH.pavilion;
    } catch (e) {}
    return null;
  }
  function broadcast(group, payload) {
    var p = pavilion();
    if (!p) return;
    payload.kind = 'mesh-app';
    payload.app = APP;
    var members = (group && group.members) || [];
    var me = selfAddress();
    var sent = false;
    members.forEach(function (addr) {
      if (!addr || addr === me) return;
      try {
        if (p.peerAddr && p.peerAddr === addr && typeof p.sendAppPayloadReliable === 'function') {
          p.sendAppPayloadReliable(payload, { timeoutMs: 6000 }).catch(function () {});
          sent = true;
        }
      } catch (e) {}
    });
    if (!sent) {
      try {
        if (p.peerAddr && typeof p.sendAppPayloadReliable === 'function') {
          p.sendAppPayloadReliable(payload, { timeoutMs: 6000 }).catch(function () {});
        } else if (typeof p.sendAppPayload === 'function') {
          p.sendAppPayload(payload);
        }
      } catch (e) {}
    }
  }

  // ---------- Style ----------
  function injectStyle() {
    if (document.getElementById('msxMarketStyle')) return;
    var css = [
      '.msx-market-card{border:1px solid rgba(255,255,255,0.12);background:linear-gradient(160deg,rgba(78,52,176,0.18),rgba(20,12,40,0.55));border-radius:14px;padding:12px;margin:8px 0;color:#f3eefb;font-size:13px;box-shadow:0 6px 22px rgba(0,0,0,0.25);}',
      '.msx-market-card .mm-q{font-weight:600;font-size:14px;margin:0 0 6px;line-height:1.25;}',
      '.msx-market-card .mm-meta{font-size:11px;opacity:0.72;margin-bottom:8px;display:flex;justify-content:space-between;gap:6px;flex-wrap:wrap;}',
      '.msx-market-card .mm-pill{background:rgba(255,255,255,0.09);padding:1px 7px;border-radius:999px;}',
      '.msx-market-card .mm-pill.live{background:#1f7a3a;color:#eaffe6;}',
      '.msx-market-card .mm-pill.done{background:#7a4d1f;color:#ffe8c2;}',
      '.msx-market-card .mm-pill.win{background:#0e8c4a;color:#eaffe6;}',
      '.msx-market-card .mm-opt{display:flex;align-items:center;gap:8px;margin:5px 0;padding:6px 8px;border-radius:10px;background:rgba(255,255,255,0.05);position:relative;overflow:hidden;}',
      '.msx-market-card .mm-opt .mm-bar{position:absolute;inset:0;background:linear-gradient(90deg,rgba(122,87,224,0.55),rgba(122,87,224,0.15));width:0%;z-index:0;transition:width 0.4s ease;}',
      '.msx-market-card .mm-opt.is-winner .mm-bar{background:linear-gradient(90deg,rgba(40,180,90,0.65),rgba(40,180,90,0.18));}',
      '.msx-market-card .mm-opt > *{position:relative;z-index:1;}',
      '.msx-market-card .mm-opt .mm-label{flex:1;font-weight:500;}',
      '.msx-market-card .mm-opt .mm-tot{font-variant-numeric:tabular-nums;font-size:11px;opacity:0.85;min-width:62px;text-align:right;}',
      '.msx-market-card .mm-opt .mm-back,.msx-market-card .mm-opt .mm-resolve{background:rgba(255,255,255,0.12);border:1px solid rgba(255,255,255,0.18);color:#fff;border-radius:8px;padding:3px 9px;font-size:11px;cursor:pointer;}',
      '.msx-market-card .mm-opt .mm-back:hover,.msx-market-card .mm-opt .mm-resolve:hover{background:rgba(255,255,255,0.22);}',
      '.msx-market-card .mm-opt .mm-resolve{background:#0e8c4a;border-color:#0e8c4a;}',
      '.msx-market-card .mm-foot{display:flex;justify-content:space-between;align-items:center;font-size:11px;opacity:0.78;margin-top:6px;gap:8px;flex-wrap:wrap;}',
      '#msxMarketBtn{background:linear-gradient(135deg,#7a57e0,#3f2a8c);color:#fff;border:none;border-radius:10px;padding:0 12px;margin-right:6px;font-weight:600;cursor:pointer;}',
      '#msxMarketBtn:hover{filter:brightness(1.1);}',
      '#msxNewMarketModal{position:fixed;inset:0;background:rgba(8,4,20,0.78);display:none;align-items:center;justify-content:center;z-index:10001;padding:14px;}',
      '#msxNewMarketModal.is-open{display:flex;}',
      '#msxNewMarketModal .mm-panel{background:#160d2c;color:#f3eefb;border:1px solid rgba(255,255,255,0.14);border-radius:14px;padding:16px;width:min(420px,100%);max-height:90vh;overflow:auto;}',
      '#msxNewMarketModal h3{margin:0 0 10px;font-size:15px;}',
      '#msxNewMarketModal label{display:block;font-size:11px;opacity:0.78;margin:8px 0 3px;}',
      '#msxNewMarketModal input,#msxNewMarketModal textarea,#msxNewMarketModal select{width:100%;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.14);color:#fff;border-radius:8px;padding:7px 9px;font-size:13px;box-sizing:border-box;}',
      '#msxNewMarketModal textarea{min-height:54px;resize:vertical;}',
      '#msxNewMarketModal .mm-opts{display:flex;flex-direction:column;gap:6px;}',
      '#msxNewMarketModal .mm-opt-row{display:flex;gap:6px;}',
      '#msxNewMarketModal .mm-opt-row button{background:rgba(255,80,80,0.22);border:1px solid rgba(255,80,80,0.35);color:#ffd9d9;border-radius:8px;width:34px;cursor:pointer;}',
      '#msxNewMarketModal .mm-actions{display:flex;justify-content:space-between;gap:8px;margin-top:14px;}',
      '#msxNewMarketModal .mm-actions button{flex:1;padding:8px;border-radius:9px;border:none;cursor:pointer;font-weight:600;}',
      '#msxNewMarketModal .mm-actions .mm-cancel{background:rgba(255,255,255,0.1);color:#fff;}',
      '#msxNewMarketModal .mm-actions .mm-create{background:linear-gradient(135deg,#7a57e0,#3f2a8c);color:#fff;}',
      '#msxNewMarketModal .mm-add{background:rgba(255,255,255,0.08);border:1px dashed rgba(255,255,255,0.25);color:#fff;border-radius:8px;padding:6px;cursor:pointer;font-size:12px;}',
      '.msx-market-empty{font-size:11px;opacity:0.55;font-style:italic;text-align:center;margin:6px 0;}'
    ].join('\n');
    var st = document.createElement('style');
    st.id = 'msxMarketStyle';
    st.textContent = css;
    document.head.appendChild(st);
  }

  // ---------- Render markets into chat log ----------
  function relTime(ms) {
    var d = ms - nowMs();
    var abs = Math.abs(d);
    var s = Math.floor(abs / 1000), m = Math.floor(s / 60), h = Math.floor(m / 60), days = Math.floor(h / 24);
    var txt = days >= 1 ? days + 'd' : h >= 1 ? h + 'h' : m >= 1 ? m + 'm' : s + 's';
    return d >= 0 ? 'in ' + txt : txt + ' ago';
  }

  function buildMarketCard(market, group) {
    var me = selfAddress();
    var totals = totalsFor(market);
    var status = market.status || 'open';
    var expired = market.expiresAt && market.expiresAt < nowMs();
    var isCreator = market.creator === me;
    var statusPill = status === 'resolved'
      ? '<span class="mm-pill done">Resolved</span>'
      : (expired ? '<span class="mm-pill done">Expired</span>' : '<span class="mm-pill live">Live</span>');

    var optsHtml = (market.options || []).map(function (o) {
      var t = totals.perOption[o.id] || 0;
      var pct = totals.pot > 0 ? Math.round((t / totals.pot) * 100) : 0;
      var isWin = status === 'resolved' && market.winnerOptionId === o.id;
      var canBack = status === 'open' && !expired;
      var canResolve = status === 'open' && isCreator;
      var btn = '';
      if (canBack) btn = '<button type="button" class="mm-back" data-act="back" data-market="' + escapeHtml(market.id) + '" data-opt="' + escapeHtml(o.id) + '">Back</button>';
      else if (canResolve) btn = '<button type="button" class="mm-resolve" data-act="resolve" data-market="' + escapeHtml(market.id) + '" data-opt="' + escapeHtml(o.id) + '">Win</button>';
      return '<div class="mm-opt' + (isWin ? ' is-winner' : '') + '">' +
        '<div class="mm-bar" style="width:' + pct + '%"></div>' +
        '<div class="mm-label">' + escapeHtml(o.label) + (isWin ? ' <span class="mm-pill win">Winner</span>' : '') + '</div>' +
        '<div class="mm-tot">' + fmt(t) + ' OST</div>' +
        btn +
      '</div>';
    }).join('');

    var meta = '<div class="mm-meta">' +
      '<span>by ' + escapeHtml(market.creatorNick || shortAddr(market.creator)) + '</span>' +
      statusPill +
      '<span class="mm-pill">Pot ' + fmt(totals.pot) + ' OST</span>' +
    '</div>';

    var foot = '<div class="mm-foot">' +
      '<span>Stake ' + fmt(market.minStake) + (market.maxStake ? '–' + fmt(market.maxStake) : '+') + ' OST</span>' +
      (market.expiresAt ? '<span>' + (expired ? 'Expired ' : 'Closes ') + relTime(market.expiresAt) + '</span>' : '') +
      (status === 'open' && isCreator ? '<button type="button" class="mm-back" data-act="cancel" data-market="' + escapeHtml(market.id) + '">Cancel</button>' : '') +
    '</div>';

    var card = document.createElement('div');
    card.className = 'msx-market-card';
    card.dataset.marketId = market.id;
    card.dataset.ts = String(market.createdAt || 0);
    card.innerHTML = '<div class="mm-q">📊 ' + escapeHtml(market.question) + '</div>' + meta + optsHtml + foot;
    return card;
  }

  function renderMarketsInLog(modal) {
    if (!modal || !modal._group) return;
    var log = modal.querySelector('#msxChatLog');
    if (!log) return;
    // Remove old market cards (they get re-injected to stay in sync).
    log.querySelectorAll('.msx-market-card').forEach(function (n) { n.remove(); });
    var markets = listMarkets(modal._group.id);
    if (!markets.length) return;
    // Sort by createdAt; append at the end (chronologically newest at bottom is fine for chat UX).
    markets.sort(function (a, b) { return (a.createdAt || 0) - (b.createdAt || 0); });
    markets.forEach(function (m) { log.appendChild(buildMarketCard(m, modal._group)); });
    log.scrollTop = log.scrollHeight;
  }

  // ---------- Actions ----------
  function actBack(modal, marketId, optId) {
    var group = modal && modal._group; if (!group) return;
    var market = findMarket(group.id, marketId); if (!market) return;
    if ((market.status || 'open') !== 'open') return alert('Market is closed.');
    if (market.expiresAt && market.expiresAt < nowMs()) return alert('Market expired.');
    var min = Number(market.minStake) || 0.01;
    var max = Number(market.maxStake) || 0;
    var bal = getCredits();
    var promptMsg = 'Stake OST on this option.\nMin: ' + fmt(min) + (max ? '   Max: ' + fmt(max) : '') + '\nYour balance: ' + fmt(bal) + ' OST';
    var raw = window.prompt(promptMsg, fmt(min));
    if (raw == null) return;
    var amt = Number(raw);
    if (!isFinite(amt) || amt <= 0) return alert('Invalid amount.');
    if (amt < min) return alert('Below minimum stake (' + fmt(min) + ').');
    if (max && amt > max) return alert('Above maximum stake (' + fmt(max) + ').');
    if (amt > bal) return alert('Insufficient OST credits.');
    if (!debitCredits(amt, 'market.stake')) return alert('Could not debit credits.');
    var stake = { id: uid('s'), marketId: marketId, optionId: optId, from: selfAddress(), nick: selfNick(), amount: amt, ts: nowMs() };
    applyStake(market, stake);
    upsertMarket(market);
    renderMarketsInLog(modal);
    broadcast(group, { type: 'group.market.stake', groupId: group.id, stake: stake });
  }

  function applyStake(market, stake) {
    if (!market || !stake || !stake.optionId) return false;
    var opt = (market.options || []).find(function (o) { return o.id === stake.optionId; });
    if (!opt) return false;
    opt.backers = opt.backers || [];
    // Dedup by stake.id
    if (opt.backers.some(function (b) { return b.id === stake.id; })) return false;
    opt.backers.push({ id: stake.id, addr: stake.from, nick: stake.nick, amount: Number(stake.amount) || 0, ts: stake.ts });
    return true;
  }

  function actResolve(modal, marketId, winnerId) {
    var group = modal && modal._group; if (!group) return;
    var market = findMarket(group.id, marketId); if (!market) return;
    if (market.creator !== selfAddress()) return alert('Only the creator can resolve.');
    if ((market.status || 'open') !== 'open') return alert('Already resolved.');
    var winner = (market.options || []).find(function (o) { return o.id === winnerId; });
    if (!winner) return;
    if (!confirm('Resolve "' + market.question + '" with winner: "' + winner.label + '" ? This pays the pot to its backers and cannot be undone.')) return;
    finalizeResolution(market, winnerId);
    upsertMarket(market);
    payoutLocal(market);
    renderMarketsInLog(modal);
    broadcast(group, { type: 'group.market.resolve', groupId: group.id, marketId: marketId, winnerOptionId: winnerId, resolvedAt: market.resolvedAt });
  }

  function finalizeResolution(market, winnerId) {
    market.status = 'resolved';
    market.winnerOptionId = winnerId;
    market.resolvedAt = nowMs();
  }

  // Pay our own backers locally if any of them is us. Each peer runs the same
  // logic on its own machine when it receives the resolve event.
  // 2% protocol rake on the loser pot (never on the returned stake, so a
  // winner can never receive less than they put in). Every peer runs the
  // same deterministic math, so all devices agree on the payout.
  var RAKE = 0.02;

  function payoutLocal(market) {
    var me = selfAddress();
    var totals = totalsFor(market);
    var winnerTot = totals.perOption[market.winnerOptionId] || 0;
    if (winnerTot <= 0) return;
    var loserPot = totals.pot - winnerTot;
    var winner = (market.options || []).find(function (o) { return o.id === market.winnerOptionId; });
    if (!winner) return;
    (winner.backers || []).forEach(function (b) {
      if (b.addr !== me) return;
      var fairProfit = (b.amount / winnerTot) * loserPot;
      var rakeKept = fairProfit * RAKE;
      var share = b.amount + fairProfit - rakeKept;
      if (share > 0) creditCredits(share, 'market.payout');
      if (rakeKept > 0.0001) {
        try { window.dispatchEvent(new CustomEvent('ost:house-fee', { detail: { source: 'mesh', amount: rakeKept, label: 'group market rake' } })); } catch (e) {}
      }
    });
  }

  function actCancel(modal, marketId) {
    var group = modal && modal._group; if (!group) return;
    var market = findMarket(group.id, marketId); if (!market) return;
    if (market.creator !== selfAddress()) return alert('Only the creator can cancel.');
    if ((market.status || 'open') !== 'open') return;
    if (!confirm('Cancel this market? All stakes will be refunded.')) return;
    market.status = 'cancelled';
    market.resolvedAt = nowMs();
    upsertMarket(market);
    refundLocal(market);
    renderMarketsInLog(modal);
    broadcast(group, { type: 'group.market.cancel', groupId: group.id, marketId: marketId, ts: market.resolvedAt });
  }

  function refundLocal(market) {
    var me = selfAddress();
    (market.options || []).forEach(function (o) {
      (o.backers || []).forEach(function (b) {
        if (b.addr === me && b.amount > 0) creditCredits(b.amount, 'market.refund');
      });
    });
  }

  // ---------- Create-market modal ----------
  function ensureNewMarketModal() {
    var modal = document.getElementById('msxNewMarketModal');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'msxNewMarketModal';
    modal.innerHTML = [
      '<div class="mm-panel">',
        '<h3>📊 New group market</h3>',
        '<label>Question (max 140 chars)</label>',
        '<textarea id="mmQ" maxlength="140" placeholder="Will the Lakers win tonight?"></textarea>',
        '<label>Options (2–6)</label>',
        '<div class="mm-opts" id="mmOpts"></div>',
        '<button type="button" class="mm-add" id="mmAdd">+ add option</button>',
        '<div style="display:flex;gap:8px;">',
          '<div style="flex:1;"><label>Min stake (OST)</label><input id="mmMin" type="number" min="0.01" step="0.01" value="1"></div>',
          '<div style="flex:1;"><label>Max stake (OST, 0 = none)</label><input id="mmMax" type="number" min="0" step="0.01" value="0"></div>',
        '</div>',
        '<label>Closes in</label>',
        '<select id="mmExp">',
          '<option value="900000">15 minutes</option>',
          '<option value="3600000" selected>1 hour</option>',
          '<option value="21600000">6 hours</option>',
          '<option value="86400000">24 hours</option>',
          '<option value="0">No expiry</option>',
        '</select>',
        '<div class="mm-actions"><button type="button" class="mm-cancel" id="mmCancel">Cancel</button><button type="button" class="mm-create" id="mmCreate">Create market</button></div>',
      '</div>'
    ].join('');
    document.body.appendChild(modal);

    function rebuildOpts(values) {
      var box = modal.querySelector('#mmOpts');
      box.innerHTML = '';
      values.forEach(function (v, idx) {
        var row = document.createElement('div');
        row.className = 'mm-opt-row';
        row.innerHTML = '<input type="text" maxlength="40" placeholder="Option ' + (idx + 1) + '" value="' + escapeHtml(v) + '">' +
          (values.length > 2 ? '<button type="button" data-rm="' + idx + '">×</button>' : '');
        box.appendChild(row);
      });
      box.querySelectorAll('button[data-rm]').forEach(function (b) {
        b.addEventListener('click', function () {
          var i = Number(b.getAttribute('data-rm'));
          var current = readOpts();
          current.splice(i, 1);
          rebuildOpts(current);
        });
      });
    }
    function readOpts() {
      return Array.prototype.slice.call(modal.querySelectorAll('#mmOpts input')).map(function (i) { return i.value; });
    }
    rebuildOpts(['', '']);

    modal.querySelector('#mmAdd').addEventListener('click', function () {
      var current = readOpts();
      if (current.length >= 6) return alert('Up to 6 options.');
      current.push('');
      rebuildOpts(current);
    });
    modal.querySelector('#mmCancel').addEventListener('click', function () { modal.classList.remove('is-open'); });
    modal.addEventListener('click', function (e) { if (e.target === modal) modal.classList.remove('is-open'); });

    modal.querySelector('#mmCreate').addEventListener('click', function () {
      var chat = document.getElementById('msxChatModal');
      var group = chat && chat._group;
      if (!group) return alert('Open a group chat first.');
      var q = (modal.querySelector('#mmQ').value || '').trim();
      if (!q) return alert('Question required.');
      var opts = readOpts().map(function (s) { return (s || '').trim(); }).filter(Boolean);
      if (opts.length < 2) return alert('Need at least 2 options.');
      if (opts.length > 6) opts = opts.slice(0, 6);
      var min = clamp(modal.querySelector('#mmMin').value, 0.01, 1e9);
      var maxRaw = Number(modal.querySelector('#mmMax').value) || 0;
      var max = maxRaw > 0 ? Math.max(min, maxRaw) : 0;
      var expMs = Number(modal.querySelector('#mmExp').value) || 0;
      var market = {
        id: uid('mk'),
        groupId: group.id,
        creator: selfAddress(),
        creatorNick: selfNick(),
        question: q,
        options: opts.map(function (label) { return { id: uid('o'), label: label, backers: [] }; }),
        minStake: min,
        maxStake: max,
        createdAt: nowMs(),
        expiresAt: expMs > 0 ? nowMs() + expMs : 0,
        status: 'open'
      };
      upsertMarket(market);
      renderMarketsInLog(chat);
      broadcast(group, { type: 'group.market.create', groupId: group.id, market: market });
      modal.classList.remove('is-open');
      // Reset for next time.
      modal.querySelector('#mmQ').value = '';
      rebuildOpts(['', '']);
    });
    return modal;
  }

  function openCreateMarket() {
    var chat = document.getElementById('msxChatModal');
    if (!chat || !chat._group) return alert('Open a group chat first.');
    ensureNewMarketModal().classList.add('is-open');
  }

  // ---------- Hook the chat composer ----------
  function injectComposerButton() {
    var form = document.getElementById('msxChatForm');
    if (!form || form.querySelector('#msxMarketBtn')) return;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'msxMarketBtn';
    btn.title = 'Create market';
    btn.textContent = '📊';
    btn.addEventListener('click', function (e) { e.preventDefault(); openCreateMarket(); });
    var send = form.querySelector('button[type="submit"]');
    if (send) form.insertBefore(btn, send); else form.appendChild(btn);
  }

  function bindChatLogClicks() {
    var log = document.getElementById('msxChatLog');
    if (!log || log._mmBound) return;
    log._mmBound = true;
    log.addEventListener('click', function (e) {
      var t = e.target.closest('button[data-act]');
      if (!t) return;
      var modal = document.getElementById('msxChatModal');
      if (!modal) return;
      var act = t.getAttribute('data-act');
      var marketId = t.getAttribute('data-market');
      var optId = t.getAttribute('data-opt');
      if (act === 'back') actBack(modal, marketId, optId);
      else if (act === 'resolve') actResolve(modal, marketId, optId);
      else if (act === 'cancel') actCancel(modal, marketId);
    });
  }

  function watchChatModal() {
    var modal = document.getElementById('msxChatModal');
    if (!modal || modal._mmWatched) return false;
    modal._mmWatched = true;
    injectComposerButton();
    bindChatLogClicks();
    renderMarketsInLog(modal);
    // When the chat modal opens (class 'is-open' added) and the group changes, re-render markets.
    var mo = new MutationObserver(function () {
      if (modal.classList.contains('is-open')) {
        injectComposerButton();
        bindChatLogClicks();
        renderMarketsInLog(modal);
      }
    });
    mo.observe(modal, { attributes: true, attributeFilter: ['class'] });
    // Also watch the chat log for re-renders by mesh-social-x (it does innerHTML reset on new messages).
    var log = modal.querySelector('#msxChatLog');
    if (log) {
      var lo = new MutationObserver(function (muts) {
        // Avoid infinite loop: only react when our cards are missing but markets exist.
        if (!modal._group) return;
        var markets = listMarkets(modal._group.id);
        if (!markets.length) return;
        if (!log.querySelector('.msx-market-card')) renderMarketsInLog(modal);
      });
      lo.observe(log, { childList: true });
    }
    return true;
  }

  // ---------- Incoming payloads ----------
  function isSeen(id) {
    var seen = readJson(SEEN_KEY, {});
    return !!seen[id];
  }
  function markSeen(id) {
    var seen = readJson(SEEN_KEY, {});
    seen[id] = nowMs();
    // Trim old entries periodically.
    var keys = Object.keys(seen);
    if (keys.length > 600) {
      keys.sort(function (a, b) { return seen[a] - seen[b]; });
      for (var i = 0; i < keys.length - 400; i++) delete seen[keys[i]];
    }
    writeJson(SEEN_KEY, seen);
  }

  function refreshIfOpen(groupId) {
    var modal = document.getElementById('msxChatModal');
    if (modal && modal._group && modal._group.id === groupId) renderMarketsInLog(modal);
  }

  function handleIncoming(event) {
    var payload = event.detail && event.detail.payload;
    if (!payload || payload.kind !== 'mesh-app' || payload.app !== APP) return;
    var t = payload.type;
    try {
      if (t === 'group.market.create' && payload.market && payload.market.id) {
        if (isSeen('c:' + payload.market.id)) return;
        markSeen('c:' + payload.market.id);
        upsertMarket(payload.market);
        refreshIfOpen(payload.market.groupId);
      } else if (t === 'group.market.stake' && payload.stake && payload.stake.marketId) {
        if (isSeen('s:' + payload.stake.id)) return;
        markSeen('s:' + payload.stake.id);
        var gid = payload.groupId || (function () {
          // fallback: scan
          var keys = Object.keys(localStorage);
          for (var i = 0; i < keys.length; i++) {
            if (keys[i].indexOf(MARKETS_PREFIX) === 0) {
              var arr = readJson(keys[i], []);
              if (arr.some(function (m) { return m.id === payload.stake.marketId; })) return keys[i].slice(MARKETS_PREFIX.length);
            }
          }
          return null;
        })();
        if (!gid) return;
        var mk = findMarket(gid, payload.stake.marketId);
        if (!mk) return;
        if (applyStake(mk, payload.stake)) {
          upsertMarket(mk);
          refreshIfOpen(gid);
        }
      } else if (t === 'group.market.resolve' && payload.marketId && payload.winnerOptionId) {
        var key = 'r:' + payload.marketId;
        if (isSeen(key)) return;
        markSeen(key);
        var gid2 = payload.groupId;
        if (!gid2) return;
        var mk2 = findMarket(gid2, payload.marketId);
        if (!mk2) return;
        if ((mk2.status || 'open') !== 'open') return;
        finalizeResolution(mk2, payload.winnerOptionId);
        if (payload.resolvedAt) mk2.resolvedAt = payload.resolvedAt;
        upsertMarket(mk2);
        payoutLocal(mk2);
        refreshIfOpen(gid2);
      } else if (t === 'group.market.cancel' && payload.marketId) {
        var key2 = 'x:' + payload.marketId;
        if (isSeen(key2)) return;
        markSeen(key2);
        var gid3 = payload.groupId;
        if (!gid3) return;
        var mk3 = findMarket(gid3, payload.marketId);
        if (!mk3) return;
        if ((mk3.status || 'open') !== 'open') return;
        mk3.status = 'cancelled';
        mk3.resolvedAt = payload.ts || nowMs();
        upsertMarket(mk3);
        refundLocal(mk3);
        refreshIfOpen(gid3);
      }
    } catch (e) {
      try { console.warn('[mesh-group-markets] incoming failed', e); } catch (_) {}
    }
  }

  // ---------- Boot ----------
  function ready(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  ready(function () {
    injectStyle();
    window.addEventListener('ost:mesh-payload', handleIncoming);
    // Try to wire immediately, then poll for the chat modal to appear.
    if (!watchChatModal()) {
      var n = 0;
      var iv = setInterval(function () {
        n++;
        if (watchChatModal() || n > 600) clearInterval(iv); // ~5 min max
      }, 500);
    }
    // Refresh open card periodically to update the countdown labels.
    setInterval(function () {
      var modal = document.getElementById('msxChatModal');
      if (modal && modal.classList.contains('is-open') && modal._group) renderMarketsInLog(modal);
    }, 30 * 1000);
  });

  // ---------- Public API ----------
  window.OST_MESH_GROUP_MARKETS = {
    list: listMarkets,
    open: function (groupId) {
      // Convenience: if the group is open, returns its markets.
      return listMarkets(groupId);
    },
    createPrompt: openCreateMarket
  };
})();

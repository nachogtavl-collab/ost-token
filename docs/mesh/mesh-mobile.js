/* ==========================================================================
 * OST · Mesh Mobile — turns the mesh overlay into a real mobile social app
 * --------------------------------------------------------------------------
 * Additive layer over the existing mesh shell. It does NOT move or rewrite any
 * wired element — it TAGS the core sections with data-mesh-view and adds a
 * bottom tab bar (Feed · Chats · Pay · Play · Profile). CSS then shows one view
 * at a time on phones; on desktop everything stacks as before.
 *
 * Steps delivered:
 *   A · Feed    — stories bar (OST_MESH_STORIES) + a wallet-signed post feed.
 *   B · Chats   — the existing connect/session UI, framed as a chat surface.
 *   D · Pay     — real send of OSTC (OST_RESCUE.sendPeerOst) or SOL (SystemProgram
 *                 transfer via OST_WALLET.sign) to a wallet address.
 *   Profile     — the wallet-linked hero + identity/QR.
 *   Play        — mesh games.
 * (C · directory hardening lives in mesh.js.)
 * ========================================================================== */
(function () {
  'use strict';
  if (window.__OST_MESH_MOBILE) return; window.__OST_MESH_MOBILE = true;

  var FEED_KEY = 'ost.mesh.feed.v1';
  var API = ((window.OST_API_BASE) || 'https://ost-api.nachogtavl.workers.dev').replace(/\/+$/, '');
  function wallet() { try { return window.OST_WALLET_PUBKEY || (window.OST_WALLET && OST_WALLET.pubkey && OST_WALLET.pubkey()) || ''; } catch (_) { return ''; } }
  function shortW(w) { return w ? w.slice(0, 4) + '·' + w.slice(-4) : 'Guest'; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function ago(t) { var s = (Date.now() - t) / 1000; if (s < 60) return Math.floor(s) + 's'; if (s < 3600) return Math.floor(s / 60) + 'm'; if (s < 86400) return Math.floor(s / 3600) + 'h'; return Math.floor(s / 86400) + 'd'; }
  function loadFeed() { try { var a = JSON.parse(localStorage.getItem(FEED_KEY) || '[]'); return Array.isArray(a) ? a : []; } catch (_) { return []; } }
  function saveFeed(a) { try { localStorage.setItem(FEED_KEY, JSON.stringify(a.slice(0, 200))); } catch (_) {} }

  var TABS = [
    { id: 'feed', label: 'Feed', icon: '&#8962;' },
    { id: 'chats', label: 'Chats', icon: '&#128172;' },
    { id: 'pay', label: 'Pay', icon: '&#128176;' },
    { id: 'play', label: 'Play', icon: '&#127918;' },
    { id: 'profile', label: 'Profile', icon: '&#128100;' }
  ];

  function styles() {
    if (document.getElementById('ostMeshMobileStyle')) return;
    var s = document.createElement('style'); s.id = 'ostMeshMobileStyle';
    s.textContent = [
      '.omm-tabbar{display:none}',
      '.omm-section{margin:0 0 12px}',
      '.omm-feedbox,.omm-paybox{border:1px solid rgba(94,234,212,.2);border-radius:16px;background:rgba(9,14,26,.6);padding:14px}',
      '.omm-compose{display:flex;gap:8px;align-items:flex-end}',
      '.omm-compose textarea{flex:1;min-height:44px;max-height:120px;resize:vertical;background:rgba(2,6,23,.6);border:1px solid rgba(148,163,184,.3);border-radius:12px;color:#eaf6ff;padding:10px 12px;font:inherit;font-size:13px}',
      '.omm-post-btn{border:none;border-radius:12px;padding:11px 16px;font-weight:800;background:linear-gradient(135deg,#00d4ff,#00ff9f);color:#04121a;cursor:pointer}',
      '.omm-feed-list{display:flex;flex-direction:column;gap:10px;margin-top:12px}',
      '.omm-post{border:1px solid rgba(148,163,184,.16);border-radius:14px;background:rgba(2,6,23,.45);padding:11px 13px}',
      '.omm-post-head{display:flex;align-items:center;gap:8px;font-size:12px;color:#9bcbe6;margin-bottom:5px}',
      '.omm-post-av{width:26px;height:26px;border-radius:8px;flex:0 0 auto}',
      '.omm-post-who{font-weight:800;color:#dff8ff}',
      '.omm-post-time{margin-left:auto;color:#64809a;font-size:11px}',
      '.omm-post-body{color:#e6f3ff;font-size:13.5px;line-height:1.5;white-space:pre-wrap;overflow-wrap:anywhere}',
      '.omm-post-actions{display:flex;gap:8px;margin-top:9px}',
      '.omm-pa{display:flex;align-items:center;gap:5px;background:rgba(2,6,23,.5);border:1px solid rgba(148,163,184,.2);color:#9bcbe6;border-radius:999px;padding:5px 12px;font-size:12px;font-weight:800;cursor:pointer}',
      '.omm-pa.on{color:#ff5e8a;border-color:rgba(255,94,138,.5);background:rgba(255,94,138,.08)}',
      '.omm-replies{margin-top:9px;border-top:1px solid rgba(148,163,184,.12);padding-top:9px;display:flex;flex-direction:column;gap:6px}',
      '.omm-reply{font-size:12.5px;color:#dbe9f5;line-height:1.45}.omm-reply b{color:#8fe6ff}',
      '.omm-reply-compose{display:flex;gap:6px;margin-top:4px}',
      '.omm-reply-compose input{flex:1;background:rgba(2,6,23,.6);border:1px solid rgba(148,163,184,.28);border-radius:10px;color:#eaf6ff;padding:8px 10px;font:inherit;font-size:12.5px}',
      '.omm-reply-compose button{border:none;border-radius:10px;padding:8px 14px;font-weight:800;background:rgba(94,234,212,.16);color:#7ff0d8;cursor:pointer}',
      '.omm-empty{color:#7fa8c4;font-size:12.5px;text-align:center;padding:20px 8px}',
      '.omm-field{display:flex;flex-direction:column;gap:5px;margin-bottom:11px}',
      '.omm-field label{font-size:11px;font-weight:800;letter-spacing:.5px;text-transform:uppercase;color:#7fd8ff}',
      '.omm-field input{background:rgba(2,6,23,.6);border:1px solid rgba(148,163,184,.3);border-radius:12px;color:#eaf6ff;padding:11px 12px;font:inherit;font-size:13px}',
      '.omm-toggle{display:flex;gap:8px}',
      '.omm-toggle button{flex:1;padding:10px;border-radius:11px;border:1px solid rgba(148,163,184,.3);background:rgba(2,6,23,.5);color:#cbd5e1;font-weight:800;cursor:pointer}',
      '.omm-toggle button.on{background:linear-gradient(135deg,#00d4ff,#00ff9f);color:#04121a;border-color:transparent}',
      '.omm-send{width:100%;border:none;border-radius:13px;padding:13px;font-weight:900;font-size:14px;cursor:pointer;background:linear-gradient(135deg,#f0c674,#e0a03a);color:#1a1206;margin-top:4px}',
      '.omm-pay-status{font-size:12px;color:#9bcbe6;margin-top:10px;min-height:16px}',
      '.omm-h{font-size:12px;letter-spacing:1px;text-transform:uppercase;color:#7fd8ff;font-weight:800;margin:0 0 10px}',
      '.omm-stories-row{display:flex;gap:10px;overflow-x:auto;padding:2px 0 12px;-webkit-overflow-scrolling:touch}',
      '.omm-story{flex:0 0 auto;display:grid;gap:4px;justify-items:center;background:none;border:none;cursor:pointer;width:64px}',
      '.omm-story .ring{width:56px;height:56px;border-radius:50%;display:grid;place-items:center;color:#04121a;font-weight:900;font-size:22px;background:conic-gradient(from 90deg,#00d4ff,#00ff9f,#ffe066,#00d4ff);padding:3px}',
      '.omm-story .inner{width:100%;height:100%;border-radius:50%;background:#0b1a2c;display:grid;place-items:center;color:#dff8ff;font-weight:800;font-size:18px}',
      '.omm-story-add .ring{background:rgba(127,216,255,.2);color:#7fd8ff}',
      '.omm-story .nm{font-size:10px;color:#9bcbe6;max-width:64px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '@media (max-width:760px){',
      '  #ost-mesh-pavilion.is-open .ost-mesh-shell{position:fixed;inset:0;max-width:none;max-height:none;width:100%;height:100%;border-radius:0;margin:0;padding:12px 14px 78px;overflow-y:auto;-webkit-overflow-scrolling:touch}',
      '  .ost-mesh-shell[data-view] [data-mesh-view]{display:none!important}',
      '  .ost-mesh-shell[data-view="feed"] [data-mesh-view~="feed"],',
      '  .ost-mesh-shell[data-view="chats"] [data-mesh-view~="chats"],',
      '  .ost-mesh-shell[data-view="pay"] [data-mesh-view~="pay"],',
      '  .ost-mesh-shell[data-view="play"] [data-mesh-view~="play"],',
      '  .ost-mesh-shell[data-view="profile"] [data-mesh-view~="profile"]{display:block!important}',
      '  .omm-tabbar{display:flex;position:fixed;left:0;right:0;bottom:0;z-index:20;background:rgba(6,10,20,.96);backdrop-filter:blur(10px);border-top:1px solid rgba(94,234,212,.2);padding:6px 4px calc(6px + env(safe-area-inset-bottom))}',
      '  .omm-tab{flex:1;display:flex;flex-direction:column;align-items:center;gap:2px;background:none;border:none;color:#7fa8c4;font-size:10px;font-weight:800;padding:6px 2px;cursor:pointer}',
      '  .omm-tab .i{font-size:20px;line-height:1}',
      '  .omm-tab.on{color:#00ffb0}',
      '}'
    ].join('');
    document.head.appendChild(s);
  }

  function tag(elm, view) { if (elm && !elm.hasAttribute('data-mesh-view')) elm.setAttribute('data-mesh-view', view); }

  function buildFeed(shell) {
    var sec = document.createElement('div'); sec.className = 'omm-section'; sec.setAttribute('data-mesh-view', 'feed');
    sec.innerHTML =
      '<div class="omm-feedbox">' +
        '<div class="omm-h">&#8962; Mesh Feed</div>' +
        '<div id="omm-stories"></div>' +
        '<div class="omm-compose"><textarea id="omm-post-text" placeholder="Share something with the mesh…" maxlength="500"></textarea><button class="omm-post-btn" id="omm-post-btn">Post</button></div>' +
        '<div class="omm-feed-list" id="omm-feed-list"></div>' +
      '</div>';
    shell.appendChild(sec);
    renderStories();
    var listEl = sec.querySelector('#omm-feed-list');
    listEl.addEventListener('click', onFeedClick);
    listEl.addEventListener('keydown', function (e) { if (e.key === 'Enter') { var ri = e.target.closest('[data-ri]'); if (ri) { e.preventDefault(); sendReply(ri.getAttribute('data-ri')); } } });
    sec.querySelector('#omm-post-btn').addEventListener('click', function () {
      var ta = document.getElementById('omm-post-text'); var t = (ta.value || '').trim(); if (!t) return;
      var w = wallet();
      var btn = document.getElementById('omm-post-btn'); btn.disabled = true;
      // Post to the SHARED mesh timeline so every user sees it. Keep a local copy
      // only if the network post fails (offline resilience).
      fetch(API + '/mesh/v1/feed/post', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ wallet: w, name: shortW(w), text: t }) })
        .then(function (r) { return r.json(); })
        .then(function (res) { if (!(res && res.ok)) throw new Error('post failed'); ta.value = ''; })
        .catch(function () { var feed = loadFeed(); feed.unshift({ id: 'p' + Date.now(), who: w || 'guest', text: t, ts: Date.now(), pending: true }); saveFeed(feed); ta.value = ''; })
        .then(function () { btn.disabled = false; renderFeed(); });
      try { window.dispatchEvent(new CustomEvent('mesh:feed-post', { detail: { text: t } })); } catch (_) {}
    });
    renderFeed();
  }
  function renderStories() {
    var host = document.getElementById('omm-stories'); if (!host) return;
    var list = []; try { if (window.OST_MESH_STORIES && OST_MESH_STORIES.list) list = OST_MESH_STORIES.list() || []; } catch (_) {}
    var bubbles = '<button class="omm-story omm-story-add" id="omm-story-add"><span class="ring">+</span><span class="nm">Add</span></button>';
    bubbles += list.slice(0, 20).map(function (s) {
      var who = shortW(s.who || s.wallet || s.author || '');
      return '<button class="omm-story"><span class="ring"><span class="inner">' + esc((who || '·')[0].toUpperCase()) + '</span></span><span class="nm">' + esc(who) + '</span></button>';
    }).join('');
    host.innerHTML = '<div class="omm-stories-row">' + bubbles + '</div>';
    var add = document.getElementById('omm-story-add');
    if (add) add.addEventListener('click', function () { try { if (window.OST_MESH_STORIES && OST_MESH_STORIES.open) OST_MESH_STORIES.open(); else alert('Stories are loading…'); } catch (_) {} });
  }
  function avatarDataUrl(seed) {
    var cv = document.createElement('canvas'); cv.width = cv.height = 52; var ctx = cv.getContext('2d');
    var h = 5381; for (var i = 0; i < seed.length; i++) h = ((h << 5) - h + seed.charCodeAt(i)) | 0;
    var hue = Math.abs(h) % 360; ctx.fillStyle = 'hsl(' + hue + ',20%,14%)'; ctx.fillRect(0, 0, 52, 52); ctx.fillStyle = 'hsl(' + hue + ',75%,62%)';
    var r = Math.abs(h); for (var x = 0; x < 3; x++) for (var y = 0; y < 5; y++) { r = (r * 1103515245 + 12345) & 0x7fffffff; if (r % 2 === 0) { ctx.fillRect(x * 10.4, y * 10.4, 11, 11); ctx.fillRect((4 - x) * 10.4, y * 10.4, 11, 11); } }
    return cv.toDataURL();
  }
  var openReplies = {};
  function paintFeed(items) {
    var list = document.getElementById('omm-feed-list'); if (!list) return;
    if (!items.length) { list.innerHTML = '<div class="omm-empty">No posts yet. Be the first to post to the mesh.</div>'; return; }
    var me = wallet();
    list.innerHTML = items.slice(0, 60).map(function (p) {
      var who = p.who || p.wallet || 'guest';
      var liked = (p.likedBy || []).indexOf(me) >= 0;
      var lc = p.likeCount || 0, reps = p.replies || [];
      var head = '<div class="omm-post-head"><img class="omm-post-av" src="' + avatarDataUrl(who) + '" alt=""><span class="omm-post-who">' + esc(shortW(who)) + '</span>' + (p.pending ? '<span style="color:#f0c674;font-size:10px">· sending</span>' : '') + '<span class="omm-post-time">' + ago(p.ts) + '</span></div>';
      var body = '<div class="omm-post-body">' + esc(p.text) + '</div>';
      if (!p.id) return '<div class="omm-post">' + head + body + '</div>';
      var actions = '<div class="omm-post-actions"><button class="omm-pa' + (liked ? ' on' : '') + '" data-like="' + esc(p.id) + '">&#9829; <span>' + lc + '</span></button><button class="omm-pa" data-rt="' + esc(p.id) + '">&#128172; <span>' + reps.length + '</span></button></div>';
      var repliesHtml = reps.map(function (r) { return '<div class="omm-reply"><b>' + esc(shortW(r.wallet || r.name)) + '</b> ' + esc(r.text) + '</div>'; }).join('');
      var thread = '<div class="omm-replies"' + (openReplies[p.id] ? '' : ' hidden') + ' id="rep-' + esc(p.id) + '">' + repliesHtml + '<div class="omm-reply-compose"><input placeholder="Reply…" data-ri="' + esc(p.id) + '"><button data-rs="' + esc(p.id) + '">Send</button></div></div>';
      return '<div class="omm-post" data-pid="' + esc(p.id) + '">' + head + body + actions + thread + '</div>';
    }).join('');
  }
  function reactPost(pid) {
    var me = wallet(); if (!me) return;
    fetch(API + '/mesh/v1/feed/react', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ postId: pid, wallet: me }) })
      .then(function (r) { return r.json(); }).then(function (j) { if (j && j.ok) renderFeed(); }).catch(function () {});
  }
  function sendReply(pid) {
    var inp = document.querySelector('[data-ri="' + pid + '"]'); var t = inp && (inp.value || '').trim(); if (!t) return;
    var me = wallet(); openReplies[pid] = true;
    fetch(API + '/mesh/v1/feed/reply', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ postId: pid, wallet: me, name: shortW(me), text: t }) })
      .then(function (r) { return r.json(); }).then(function () { if (inp) inp.value = ''; renderFeed(); }).catch(function () {});
  }
  function onFeedClick(e) {
    var like = e.target.closest('[data-like]'); if (like) { reactPost(like.getAttribute('data-like')); return; }
    var rt = e.target.closest('[data-rt]'); if (rt) { var id = rt.getAttribute('data-rt'); openReplies[id] = !openReplies[id]; var el = document.getElementById('rep-' + id); if (el) el.hidden = !openReplies[id]; return; }
    var rs = e.target.closest('[data-rs]'); if (rs) { sendReply(rs.getAttribute('data-rs')); return; }
  }
  // Render the SHARED timeline (worker) merged with any unsynced local posts.
  function renderFeed() {
    var local = loadFeed().filter(function (p) { return p.pending; });
    paintFeed(local.concat([]));   // instant paint of pending; shared arrives async
    fetch(API + '/mesh/v1/feed/recent?limit=60', { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        var shared = (j && j.posts) ? j.posts.map(function (p) { return { id: p.id, who: p.wallet || p.name, text: p.text, ts: p.ts }; }) : [];
        var seen = {}, merged = [];
        local.concat(shared).forEach(function (p) { var k = p.id || (p.who + ':' + p.ts); if (!seen[k]) { seen[k] = 1; merged.push(p); } });
        merged.sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); });
        paintFeed(merged);
      })
      .catch(function () { paintFeed(loadFeed()); });   // offline: show whatever we have locally
  }

  function buildPay(shell) {
    var sec = document.createElement('div'); sec.className = 'omm-section'; sec.setAttribute('data-mesh-view', 'pay');
    sec.innerHTML =
      '<div class="omm-paybox">' +
        '<div class="omm-h">&#128176; Send money</div>' +
        '<div class="omm-toggle" id="omm-tok"><button data-tok="ostc" class="on">OSTC</button><button data-tok="sol">SOL</button></div>' +
        '<div class="omm-field" style="margin-top:11px"><label>Recipient wallet</label><input id="omm-pay-to" placeholder="Solana wallet address" autocomplete="off"></div>' +
        '<div class="omm-field"><label>Amount</label><input id="omm-pay-amt" type="number" min="0" step="any" placeholder="0.00"></div>' +
        '<button class="omm-send" id="omm-pay-send">Send OSTC</button>' +
        '<div class="omm-pay-status" id="omm-pay-status">Sends real devnet value from your connected wallet.</div>' +
      '</div>';
    shell.appendChild(sec);
    var tok = 'ostc';
    sec.querySelectorAll('#omm-tok button').forEach(function (b) {
      b.addEventListener('click', function () { tok = b.getAttribute('data-tok'); sec.querySelectorAll('#omm-tok button').forEach(function (x) { x.classList.remove('on'); }); b.classList.add('on'); sec.querySelector('#omm-pay-send').textContent = 'Send ' + tok.toUpperCase(); });
    });
    sec.querySelector('#omm-pay-send').addEventListener('click', function () { doPay(tok, sec); });
  }
  function doPay(tok, sec) {
    var to = (sec.querySelector('#omm-pay-to').value || '').trim();
    var amt = parseFloat(sec.querySelector('#omm-pay-amt').value);
    var st = sec.querySelector('#omm-pay-status'); var btn = sec.querySelector('#omm-pay-send');
    var say = function (m) { if (st) st.textContent = m; };
    if (!wallet()) return say('Connect your wallet first.');
    if (!to || to.length < 32) return say('Enter a valid recipient wallet address.');
    if (!(amt > 0)) return say('Enter an amount greater than zero.');
    btn.disabled = true; var orig = btn.textContent; btn.textContent = 'Sending…'; say('Submitting ' + amt + ' ' + tok.toUpperCase() + '…');
    var done = function (sig) { btn.disabled = false; btn.textContent = orig; say('✓ Sent ' + amt + ' ' + tok.toUpperCase() + (sig ? ' (' + String(sig).slice(0, 8) + '…)' : '') + ' to ' + shortW(to)); sec.querySelector('#omm-pay-amt').value = ''; try { window.dispatchEvent(new CustomEvent('ost:money:change')); } catch (_) {} };
    var fail = function (e) { btn.disabled = false; btn.textContent = orig; say('✗ ' + ((e && e.message) || 'Send failed') + '.'); };
    try {
      if (tok === 'ostc') {
        if (!(window.OST_RESCUE && OST_RESCUE.sendPeerOst)) return fail(new Error('OSTC rail not ready'));
        Promise.resolve(OST_RESCUE.sendPeerOst(to, amt, 'mesh-pay')).then(done).catch(fail);
      } else {
        if (!(window.OST_WALLET && OST_WALLET.sign && window.solanaWeb3)) return fail(new Error('SOL rail not ready'));
        var conn = OST_WALLET.getConnection && OST_WALLET.getConnection();
        var from = new solanaWeb3.PublicKey(wallet());
        var tx = new solanaWeb3.Transaction().add(solanaWeb3.SystemProgram.transfer({ fromPubkey: from, toPubkey: new solanaWeb3.PublicKey(to), lamports: Math.round(amt * 1e9) }));
        Promise.resolve(OST_WALLET.sign(tx)).then(done).catch(fail);
      }
    } catch (e) { fail(e); }
  }

  function buildPlay(shell) {
    var sec = document.createElement('div'); sec.className = 'omm-section'; sec.setAttribute('data-mesh-view', 'play');
    sec.innerHTML = '<div class="omm-paybox"><div class="omm-h">&#127918; Play together</div><div class="omm-empty">Connect to a peer in Chats, then launch a fair multiplayer game (tic-tac-toe, chess, pool, and more) — moves are exchanged peer-to-peer and verified.</div><button class="omm-send" id="omm-play-go" style="background:linear-gradient(135deg,#a78bfa,#7c3aed);color:#fff">Open games</button></div>';
    shell.appendChild(sec);
    sec.querySelector('#omm-play-go').addEventListener('click', function () { try { window.dispatchEvent(new CustomEvent('mesh:open-games')); } catch (_) {} });
  }

  function buildTabbar(root, shell) {
    var bar = document.createElement('div'); bar.className = 'omm-tabbar';
    bar.innerHTML = TABS.map(function (t) { return '<button class="omm-tab" data-view="' + t.id + '"><span class="i">' + t.icon + '</span>' + t.label + '</button>'; }).join('');
    root.appendChild(bar);
    function setView(v) {
      shell.setAttribute('data-view', v);
      bar.querySelectorAll('.omm-tab').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-view') === v); });
      shell.scrollTop = 0;
      if (v === 'feed') { renderStories(); renderFeed(); }
      if (v === 'pay') { try { var to = document.getElementById('omm-pay-to'); if (to && !to.value && shell.__payTarget) to.value = shell.__payTarget; } catch (_) {} }
    }
    bar.addEventListener('click', function (e) { var b = e.target.closest('[data-view]'); if (b) setView(b.getAttribute('data-view')); });
    shell.__setView = setView;
    setView('feed');
  }

  function init() {
    var root = document.getElementById('ost-mesh-pavilion');
    var shell = root && root.querySelector('.ost-mesh-shell');
    if (!shell || shell.__mobileReady) return !!shell;
    shell.__mobileReady = true;
    styles();
    // tag existing core sections
    tag(root.querySelector('.ost-mesh-hero'), 'profile');
    tag(root.querySelector('.ost-mesh-id'), 'profile');
    tag(root.querySelector('.ost-mesh-row'), 'chats');
    tag(root.querySelector('.ost-mesh-callbar'), 'chats');
    tag(root.querySelector('.ost-mesh-status'), 'chats');
    tag(root.querySelector('.ost-mesh-session'), 'chats');
    // new views
    buildFeed(shell); buildPay(shell); buildPlay(shell);
    buildTabbar(root, shell);
    // hero quick-actions switch tabs on mobile
    var hero = root.querySelector('.ost-mesh-hero');
    if (hero) hero.addEventListener('click', function (e) {
      var b = e.target.closest('[data-hero]'); if (!b || !shell.__setView) return;
      var a = b.getAttribute('data-hero'), map = { chats: 'chats', pay: 'pay', games: 'play', stories: 'feed' };
      if (map[a]) shell.__setView(map[a]);
    }, true);
    // late-loaded mesh-upgrade panels default to Profile so they don't leak across tabs
    try {
      var obs = new MutationObserver(function (muts) {
        muts.forEach(function (m) { for (var i = 0; i < m.addedNodes.length; i++) { var n = m.addedNodes[i]; if (n.nodeType === 1 && n.parentNode === shell && !n.hasAttribute('data-mesh-view') && !n.classList.contains('omm-section')) n.setAttribute('data-mesh-view', 'profile'); } });
      });
      obs.observe(shell, { childList: true });
    } catch (_) {}
    window.addEventListener('ost:money:change', function () { try { renderFeed(); } catch (_) {} });
    // Live-refresh the shared feed while it is the active tab and the mesh is open.
    setInterval(function () {
      var root = document.getElementById('ost-mesh-pavilion');
      if (root && root.classList.contains('is-open') && shell.getAttribute('data-view') === 'feed' && !document.hidden) { try { renderFeed(); } catch (_) {} }
    }, 15000);
    return true;
  }

  // The mesh shell is lazy-built; poll briefly until it exists, and re-init after open.
  var tries = 0;
  var iv = setInterval(function () { if (init() || ++tries > 60) clearInterval(iv); }, 400);
  window.addEventListener('mesh:ready', function () { setTimeout(init, 200); });
  window.OST_MESH_MOBILE = { init: init, setView: function (v) { var s = document.querySelector('#ost-mesh-pavilion .ost-mesh-shell'); if (s && s.__setView) s.__setView(v); }, renderFeed: renderFeed };
})();

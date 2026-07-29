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

  /* ---- notifications: toast + tab/trigger badges ---- */
  var badges = { feed: 0, chats: 0 };
  function toast(msg) {
    var t = document.createElement('div'); t.className = 'omm-toast'; t.textContent = msg; document.body.appendChild(t);
    requestAnimationFrame(function () { t.classList.add('show'); });
    setTimeout(function () { t.classList.remove('show'); setTimeout(function () { t.remove(); }, 300); }, 3200);
  }
  function paintBadges() {
    ['feed', 'chats'].forEach(function (v) {
      var tab = document.querySelector('.omm-tab[data-view="' + v + '"]'); if (!tab) return;
      var b = tab.querySelector('.omm-badge'); var n = badges[v] || 0;
      if (n > 0) { if (!b) { b = document.createElement('span'); b.className = 'omm-badge'; tab.appendChild(b); } b.textContent = n > 9 ? '9+' : String(n); }
      else if (b) b.remove();
    });
    var trig = document.getElementById('ost-mesh-trigger');
    if (trig) { var tot = (badges.feed || 0) + (badges.chats || 0); trig.setAttribute('data-badge', tot > 0 ? (tot > 9 ? '9+' : String(tot)) : ''); trig.classList.toggle('has-badge', tot > 0); }
  }
  function bumpBadge(v, n) { badges[v] = (badges[v] || 0) + (n || 1); paintBadges(); }
  function clearBadge(v) { badges[v] = 0; paintBadges(); }
  function notifyFeedEngagement(shared) {
    var me = wallet(); if (!me) return;
    var seen = {}; try { seen = JSON.parse(localStorage.getItem('ost.mesh.feedseen.v1') || '{}') || {}; } catch (_) {}
    var gained = 0;
    shared.forEach(function (p) {
      if (p.who !== me || !p.id) return;
      var cur = (p.likeCount || 0) + ((p.replies || []).length);
      var prev = seen[p.id];
      if (prev != null && cur > prev) gained += (cur - prev);
      seen[p.id] = cur;
    });
    try { localStorage.setItem('ost.mesh.feedseen.v1', JSON.stringify(seen)); } catch (_) {}
    if (gained > 0) { toast('♥ ' + gained + ' new reaction' + (gained > 1 ? 's' : '') + ' on your posts'); if (currentView() !== 'feed') bumpBadge('feed', gained); }
  }
  function currentView() { var s = document.querySelector('#ost-mesh-pavilion .ost-mesh-shell'); return s && s.getAttribute('data-view'); }

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
      // media
      '.omm-compose-side{display:flex;flex-direction:column;gap:6px}',
      '.omm-attach{display:grid;place-items:center;width:44px;height:38px;border-radius:11px;background:rgba(2,6,23,.6);border:1px solid rgba(148,163,184,.3);color:#9bcbe6;font-size:18px;cursor:pointer}',
      '.omm-post-preview{position:relative;margin-top:8px;max-width:180px}',
      '.omm-post-preview img{width:100%;border-radius:12px;display:block}',
      '.omm-prev-x{position:absolute;top:-8px;right:-8px;width:24px;height:24px;border-radius:50%;border:none;background:#0b1a2c;color:#fff;font-size:16px;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.4)}',
      '.omm-post-img{margin-top:8px;width:100%;border-radius:12px;display:block;max-height:360px;object-fit:cover}',
      // notifications
      '.omm-toast{position:fixed;left:50%;bottom:84px;transform:translate(-50%,20px);z-index:1000600;background:rgba(6,10,20,.97);border:1px solid rgba(94,234,212,.4);color:#eaf6ff;padding:11px 16px;border-radius:14px;font-size:13px;font-weight:700;box-shadow:0 12px 34px rgba(0,0,0,.5);opacity:0;transition:.28s;max-width:88vw;text-align:center}',
      '.omm-toast.show{opacity:1;transform:translate(-50%,0)}',
      '.omm-badge{position:absolute;top:2px;left:56%;min-width:16px;height:16px;padding:0 4px;border-radius:999px;background:#ff3b6b;color:#fff;font-size:10px;font-weight:900;display:grid;place-items:center;box-shadow:0 0 0 2px rgba(6,10,20,.96)}',
      '.omm-tab{position:relative}',
      '#ost-mesh-trigger.has-badge::after{content:attr(data-badge);position:absolute;top:-4px;right:-4px;min-width:18px;height:18px;padding:0 5px;border-radius:999px;background:#ff3b6b;color:#fff;font-size:11px;font-weight:900;display:grid;place-items:center}',
      // conversations
      '.omm-chatsbox{border:1px solid rgba(94,234,212,.2);border-radius:16px;background:rgba(9,14,26,.6);padding:12px}',
      '.omm-convos{display:flex;flex-direction:column;gap:4px}',
      '.omm-convo{display:flex;align-items:center;gap:10px;width:100%;text-align:left;background:none;border:none;border-radius:12px;padding:9px;cursor:pointer;color:#dbe9f5}',
      '.omm-convo:hover{background:rgba(2,6,23,.5)}',
      '.omm-convo-av{width:40px;height:40px;border-radius:12px;flex:0 0 auto}',
      '.omm-convo-mid{flex:1;min-width:0}',
      '.omm-convo-top{display:flex;justify-content:space-between;gap:8px}',
      '.omm-convo-name{font-weight:800;color:#eaf6ff;font-size:13.5px}',
      '.omm-convo-time{color:#64809a;font-size:11px;flex:0 0 auto}',
      '.omm-convo-prev{color:#8fb3cc;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.omm-convo-unread{flex:0 0 auto;min-width:20px;height:20px;padding:0 6px;border-radius:999px;background:#00ffb0;color:#04121a;font-size:11px;font-weight:900;display:grid;place-items:center}',
      // profile
      '.omm-profilebox{border:1px solid rgba(94,234,212,.2);border-radius:16px;background:rgba(9,14,26,.6);padding:14px}',
      '.omm-stats{display:flex;gap:8px}',
      '.omm-stat{flex:1;text-align:center;background:rgba(2,6,23,.5);border:1px solid rgba(148,163,184,.18);border-radius:13px;padding:12px 6px}',
      '.omm-stat b{display:block;font-size:20px;color:#eaf6ff;font-weight:900}',
      '.omm-stat span{font-size:11px;color:#8fb3cc;letter-spacing:.4px}',
      // games
      '.omm-games{display:grid;grid-template-columns:repeat(2,1fr);gap:8px}',
      '.omm-game{display:flex;flex-direction:column;align-items:center;gap:6px;padding:16px 8px;border-radius:14px;border:1px solid rgba(148,163,184,.2);background:linear-gradient(180deg,rgba(30,41,59,.6),rgba(15,23,42,.6));color:#eaf6ff;font-weight:800;font-size:13px;cursor:pointer}',
      '.omm-game .gi{font-size:26px;line-height:1}',
      '.omm-game:hover{border-color:rgba(94,234,212,.5)}',
      '.omm-empty{color:#7fa8c4;font-size:12.5px;text-align:center;padding:20px 8px}',
      '.omm-field{display:flex;flex-direction:column;gap:5px;margin-bottom:11px}',
      '.omm-field label{font-size:11px;font-weight:800;letter-spacing:.5px;text-transform:uppercase;color:#7fd8ff}',
      '.omm-field input{background:rgba(2,6,23,.6);border:1px solid rgba(148,163,184,.3);border-radius:12px;color:#eaf6ff;padding:11px 12px;font:inherit;font-size:13px}',
      '.omm-toggle{display:flex;gap:8px}',
      '.omm-toggle button{flex:1;padding:10px;border-radius:11px;border:1px solid rgba(148,163,184,.3);background:rgba(2,6,23,.5);color:#cbd5e1;font-weight:800;cursor:pointer}',
      '.omm-toggle button.on{background:linear-gradient(135deg,#00d4ff,#00ff9f);color:#04121a;border-color:transparent}',
      '.omm-send{width:100%;border:none;border-radius:13px;padding:13px;font-weight:900;font-size:14px;cursor:pointer;background:linear-gradient(135deg,#f0c674,#e0a03a);color:#1a1206;margin-top:4px}',
      '.omm-pay-status{font-size:12px;color:#9bcbe6;margin-top:10px;min-height:16px}',
      '.omm-pay-tabs{display:flex;gap:6px;margin-bottom:12px;background:rgba(2,6,23,.5);border-radius:12px;padding:4px}',
      '.omm-pay-tabs button{flex:1;padding:9px;border:none;border-radius:9px;background:none;color:#9bcbe6;font-weight:800;cursor:pointer}',
      '.omm-pay-tabs button.on{background:linear-gradient(135deg,#00d4ff,#00ff9f);color:#04121a}',
      '.omm-scanrow{display:flex;gap:8px}.omm-scanrow input{flex:1}',
      '.omm-scanbtn{border:1px solid rgba(94,234,212,.4);background:rgba(94,234,212,.1);color:#7ff0d8;border-radius:12px;padding:0 14px;font-weight:800;cursor:pointer;white-space:nowrap}',
      '.omm-recv{text-align:center;display:flex;flex-direction:column;align-items:center;gap:12px}',
      '.omm-recv-qr img{width:220px;height:220px;border-radius:16px;background:#fff;padding:10px}',
      '.omm-recv-addr{font-family:ui-monospace,monospace;color:#9fffd0;font-size:13px}',
      '.omm-scan-overlay{position:fixed;inset:0;z-index:1000700;background:#000;display:flex;align-items:center;justify-content:center}',
      '.omm-scan-overlay[hidden]{display:none}',
      '.omm-scan-overlay video{width:100%;height:100%;object-fit:cover}',
      '.omm-scan-frame{position:absolute;width:64vw;height:64vw;max-width:300px;max-height:300px;border:3px solid #00ffb0;border-radius:24px;box-shadow:0 0 0 100vmax rgba(0,0,0,.5)}',
      '.omm-scan-close{position:fixed;bottom:calc(28px + env(safe-area-inset-bottom));left:50%;transform:translateX(-50%);z-index:2;border:none;border-radius:999px;padding:12px 28px;font-weight:800;background:#fff;color:#04121a;cursor:pointer}',
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
      // Close button: pin it TOP-RIGHT of the full-screen sheet, always tappable.
      '  #ost-mesh-pavilion.is-open .ost-mesh-close{position:fixed;top:calc(8px + env(safe-area-inset-top));right:12px;z-index:40;width:38px;height:38px;background:rgba(6,10,20,.85);backdrop-filter:blur(6px)}',
      // Slim the original head so it does not fight the wallet hero.
      '  #ost-mesh-pavilion.is-open .ost-mesh-head{order:0;padding-right:52px}',
      '  #ost-mesh-pavilion.is-open .ost-mesh-head h2{font-size:15px}',
      '  #ost-mesh-pavilion.is-open .ost-mesh-head .sub{display:none}',
      // The raw identity pills (address/fingerprint/directory) are dev detail —
      // hide them on mobile so the Profile reads like a social profile; keep the
      // action buttons (copy/QR/scan/rotate) in a tidy row.
      '  #ost-mesh-pavilion.is-open .ost-mesh-id{background:none;border:none;padding:0;gap:0}',
      '  #ost-mesh-pavilion.is-open .ost-mesh-id > div:not(.ost-mesh-id-actions){display:none}',
      '  #ost-mesh-pavilion.is-open .ost-mesh-id-actions{flex-wrap:wrap;gap:7px}',
      '  #ost-mesh-pavilion.is-open .ost-mesh-id-actions button{flex:1;min-width:88px}',
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
        '<div class="omm-compose"><textarea id="omm-post-text" placeholder="Share something with the mesh…" maxlength="500"></textarea>' +
          '<div class="omm-compose-side"><label class="omm-attach" title="Add image">&#128247;<input type="file" id="omm-post-img" accept="image/*" hidden></label><button class="omm-post-btn" id="omm-post-btn">Post</button></div></div>' +
        '<div id="omm-post-preview" class="omm-post-preview" hidden></div>' +
        '<div class="omm-feed-list" id="omm-feed-list"></div>' +
      '</div>';
    shell.appendChild(sec);
    renderStories();
    var listEl = sec.querySelector('#omm-feed-list');
    listEl.addEventListener('click', onFeedClick);
    listEl.addEventListener('keydown', function (e) { if (e.key === 'Enter') { var ri = e.target.closest('[data-ri]'); if (ri) { e.preventDefault(); sendReply(ri.getAttribute('data-ri')); } } });
    var pendingImg = '';
    var fileIn = document.getElementById('omm-post-img'), prev = document.getElementById('omm-post-preview');
    fileIn.addEventListener('change', function () {
      var f = fileIn.files && fileIn.files[0]; if (!f) return;
      resizeImage(f, 560, 0.62).then(function (d) { pendingImg = d; prev.hidden = false; prev.innerHTML = '<img src="' + d + '"><button class="omm-prev-x" id="omm-prev-x">&times;</button>'; document.getElementById('omm-prev-x').onclick = function () { pendingImg = ''; prev.hidden = true; prev.innerHTML = ''; fileIn.value = ''; }; }).catch(function () {});
    });
    sec.querySelector('#omm-post-btn').addEventListener('click', function () {
      var ta = document.getElementById('omm-post-text'); var t = (ta.value || '').trim(); if (!t && !pendingImg) return;
      var w = wallet(), img = pendingImg;
      var btn = document.getElementById('omm-post-btn'); btn.disabled = true;
      fetch(API + '/mesh/v1/feed/post', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ wallet: w, name: shortW(w), text: t, img: img }) })
        .then(function (r) { return r.json(); })
        .then(function (res) { if (!(res && res.ok)) throw new Error('post failed'); ta.value = ''; })
        .catch(function () { var feed = loadFeed(); feed.unshift({ id: 'p' + Date.now(), who: w || 'guest', text: t, img: img, ts: Date.now(), pending: true }); saveFeed(feed); ta.value = ''; })
        .then(function () { btn.disabled = false; pendingImg = ''; prev.hidden = true; prev.innerHTML = ''; fileIn.value = ''; renderFeed(); });
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
  // Client-side resize so feed images are small enough to relay (data URL).
  function resizeImage(file, maxDim, quality) {
    return new Promise(function (res, rej) {
      var fr = new FileReader();
      fr.onload = function () {
        var im = new Image();
        im.onload = function () {
          var s = Math.min(1, maxDim / Math.max(im.width, im.height));
          var w = Math.max(1, Math.round(im.width * s)), h = Math.max(1, Math.round(im.height * s));
          var cv = document.createElement('canvas'); cv.width = w; cv.height = h; cv.getContext('2d').drawImage(im, 0, 0, w, h);
          var out = cv.toDataURL('image/jpeg', quality || 0.6);
          if (out.length > 155000) out = cv.toDataURL('image/jpeg', 0.45);   // stay under the worker cap
          res(out);
        };
        im.onerror = rej; im.src = fr.result;
      };
      fr.onerror = rej; fr.readAsDataURL(file);
    });
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
      var body = (p.text ? '<div class="omm-post-body">' + esc(p.text) + '</div>' : '') + (p.img ? '<img class="omm-post-img" src="' + esc(p.img) + '" alt="">' : '');
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
  // NO pre-paint of an empty state (that caused the "jumping" between "no posts"
  // and the async load). Show a one-time loading line, then paint once per fetch;
  // on a transient failure keep the current render instead of flashing empty.
  var feedEverLoaded = false, feedFetching = false;
  function renderFeed() {
    var listEl = document.getElementById('omm-feed-list'); if (!listEl) return;
    if (!feedEverLoaded && !listEl.children.length) listEl.innerHTML = '<div class="omm-empty">Loading feed…</div>';
    if (feedFetching) return; feedFetching = true;
    fetch(API + '/mesh/v1/feed/recent?limit=60', { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        var shared = (j && j.posts) ? j.posts.map(function (p) { return { id: p.id, who: p.wallet || p.name, text: p.text, img: p.img || '', ts: p.ts, likeCount: p.likeCount || 0, likedBy: p.likedBy || [], replies: p.replies || [] }; }) : [];
        var local = loadFeed().filter(function (p) { return p.pending; });
        var seen = {}, merged = [];
        local.concat(shared).forEach(function (p) { var k = p.id || (p.who + ':' + p.ts); if (!seen[k]) { seen[k] = 1; merged.push(p); } });
        merged.sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); });
        feedEverLoaded = true;
        paintFeed(merged);
        notifyFeedEngagement(shared);
      })
      .catch(function () { if (!feedEverLoaded) { var l = loadFeed().filter(function (p) { return p.pending; }); if (l.length) paintFeed(l); } })
      .then(function () { feedFetching = false; });
  }

  function buildPay(shell) {
    var sec = document.createElement('div'); sec.className = 'omm-section'; sec.setAttribute('data-mesh-view', 'pay');
    sec.innerHTML =
      '<div class="omm-paybox">' +
        '<div class="omm-pay-tabs" id="omm-pay-tabs"><button data-pt="send" class="on">Send</button><button data-pt="receive">Receive</button></div>' +
        '<div id="omm-pay-send-pane">' +
          '<div class="omm-toggle" id="omm-tok"><button data-tok="ostc" class="on">OSTC</button><button data-tok="sol">SOL</button></div>' +
          '<div class="omm-field" style="margin-top:11px"><label>Recipient wallet</label><div class="omm-scanrow"><input id="omm-pay-to" placeholder="Wallet address" autocomplete="off"><button class="omm-scanbtn" id="omm-pay-scan">&#128247; Scan</button></div></div>' +
          '<div class="omm-field"><label>Amount</label><input id="omm-pay-amt" type="number" min="0" step="any" inputmode="decimal" placeholder="0.00"></div>' +
          '<button class="omm-send" id="omm-pay-send">Send OSTC</button>' +
          '<div class="omm-pay-status" id="omm-pay-status">Sends real devnet value from your connected wallet.</div>' +
        '</div>' +
        '<div id="omm-pay-recv-pane" hidden><div class="omm-recv"><div class="omm-recv-qr" id="omm-recv-qr"></div><div class="omm-recv-addr" id="omm-recv-addr"></div><button class="omm-send" id="omm-recv-copy" style="background:rgba(94,234,212,.16);color:#7ff0d8">Copy my address</button><div class="omm-pay-status">Have someone scan this to pay you.</div></div></div>' +
        '<div class="omm-scan-overlay" id="omm-scan-overlay" hidden><video id="omm-scan-video" playsinline></video><div class="omm-scan-frame"></div><button class="omm-scan-close" id="omm-scan-close">Cancel</button></div>' +
      '</div>';
    shell.appendChild(sec);
    // Send/Receive tab switch
    sec.querySelectorAll('#omm-pay-tabs button').forEach(function (b) {
      b.addEventListener('click', function () {
        sec.querySelectorAll('#omm-pay-tabs button').forEach(function (x) { x.classList.remove('on'); }); b.classList.add('on');
        var recv = b.getAttribute('data-pt') === 'receive';
        document.getElementById('omm-pay-send-pane').hidden = recv;
        document.getElementById('omm-pay-recv-pane').hidden = !recv;
        if (recv) renderReceive();
      });
    });
    sec.querySelector('#omm-pay-scan').addEventListener('click', startScan);
    sec.querySelector('#omm-scan-close').addEventListener('click', stopScan);
    sec.querySelector('#omm-recv-copy').addEventListener('click', function () { var w = wallet(); if (w && navigator.clipboard) navigator.clipboard.writeText(w).then(function () { toast('Address copied'); }); });
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

  function statTile(n, l) { return '<div class="omm-stat"><b>' + n + '</b><span>' + l + '</span></div>'; }
  function buildProfile(shell) {
    var sec = document.createElement('div'); sec.className = 'omm-section'; sec.setAttribute('data-mesh-view', 'profile');
    sec.innerHTML = '<div class="omm-profilebox"><div class="omm-stats" id="omm-stats">' + statTile('—', 'Posts') + statTile('—', 'Likes') + statTile('—', 'Contacts') + '</div>' +
      '<div class="omm-h" style="margin-top:14px">Your posts</div><div class="omm-feed-list" id="omm-my-posts"><div class="omm-empty">Loading…</div></div></div>';
    var hero = document.querySelector('#ost-mesh-pavilion .ost-mesh-hero');
    if (hero && hero.parentNode) hero.parentNode.insertBefore(sec, hero.nextSibling); else shell.appendChild(sec);
    renderProfile();
  }
  function renderProfile() {
    var me = wallet(); var statsEl = document.getElementById('omm-stats'), myEl = document.getElementById('omm-my-posts');
    if (!statsEl) return;
    var contacts = 0; try { contacts = (window.OST_MESH && OST_MESH.pavilion && OST_MESH.pavilion._enumerateChats() || []).length; } catch (_) {}
    fetch(API + '/mesh/v1/feed/recent?limit=60', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (j) {
      var posts = (j && j.posts) || [];
      var mine = me ? posts.filter(function (p) { return p.wallet === me; }) : [];
      var likes = mine.reduce(function (s, p) { return s + (p.likeCount || 0); }, 0);
      statsEl.innerHTML = statTile(mine.length, 'Posts') + statTile(likes, 'Likes') + statTile(contacts, 'Contacts');
      if (myEl) {
        if (!mine.length) myEl.innerHTML = '<div class="omm-empty">' + (me ? 'You haven’t posted yet — share something in the Feed tab.' : 'Connect your wallet to build your profile.') + '</div>';
        else myEl.innerHTML = mine.map(function (p) {
          return '<div class="omm-post">' + (p.text ? '<div class="omm-post-body">' + esc(p.text) + '</div>' : '') + (p.img ? '<img class="omm-post-img" src="' + esc(p.img) + '">' : '') +
            '<div class="omm-post-actions"><span class="omm-pa">&#9829; ' + (p.likeCount || 0) + '</span><span class="omm-pa">&#128172; ' + ((p.replies || []).length) + '</span><span class="omm-post-time" style="margin-left:auto">' + ago(p.ts) + '</span></div></div>';
        }).join('');
      }
    }).catch(function () { statsEl.innerHTML = statTile('—', 'Posts') + statTile('—', 'Likes') + statTile(contacts, 'Contacts'); });
  }
  function buildChats(shell) {
    var sec = document.createElement('div'); sec.className = 'omm-section'; sec.setAttribute('data-mesh-view', 'chats');
    sec.innerHTML = '<div class="omm-chatsbox"><div class="omm-h">&#128172; Conversations</div><div id="omm-convos" class="omm-convos"></div></div>';
    var row = document.querySelector('#ost-mesh-pavilion .ost-mesh-row');
    if (row && row.parentNode) row.parentNode.insertBefore(sec, row); else shell.appendChild(sec);
    renderChats();
  }
  function renderChats() {
    var host = document.getElementById('omm-convos'); if (!host) return;
    var list = []; try { if (window.OST_MESH && OST_MESH.pavilion && OST_MESH.pavilion._enumerateChats) list = OST_MESH.pavilion._enumerateChats() || []; } catch (_) {}
    var unread = {}; try { unread = JSON.parse(localStorage.getItem('ost.mesh.unread.v1') || '{}') || {}; } catch (_) {}
    if (!list.length) { host.innerHTML = '<div class="omm-empty">No conversations yet. Paste a peer address or invite below, or share your QR from Profile.</div>'; return; }
    host.innerHTML = list.map(function (c) {
      var u = unread[c.addr] || 0;
      return '<button class="omm-convo" data-addr="' + esc(c.addr) + '"><img class="omm-convo-av" src="' + avatarDataUrl(c.addr) + '"><div class="omm-convo-mid"><div class="omm-convo-top"><span class="omm-convo-name">' + esc(shortW(c.addr)) + '</span><span class="omm-convo-time">' + ago(c.lastTs) + '</span></div><div class="omm-convo-prev">' + (c.lastRole === 'me' ? 'You: ' : '') + esc((c.preview || '').slice(0, 60)) + '</div></div>' + (u > 0 ? '<span class="omm-convo-unread">' + (u > 9 ? '9+' : u) + '</span>' : '') + '</button>';
    }).join('');
    host.querySelectorAll('[data-addr]').forEach(function (b) { b.addEventListener('click', function () { openConvo(b.getAttribute('data-addr')); }); });
  }
  function openConvo(addr) {
    try { var u = JSON.parse(localStorage.getItem('ost.mesh.unread.v1') || '{}') || {}; delete u[addr]; localStorage.setItem('ost.mesh.unread.v1', JSON.stringify(u)); } catch (_) {}
    var inp = document.getElementById('mesh-peer-addr'); if (inp) inp.value = addr;
    try { if (window.OST_MESH && OST_MESH.pavilion && OST_MESH.pavilion._replayChatHistory) OST_MESH.pavilion._replayChatHistory(addr); } catch (_) {}
    var sess = document.querySelector('#ost-mesh-pavilion .ost-mesh-session'); if (sess) sess.scrollIntoView({ behavior: 'smooth', block: 'start' });
    renderChats();
  }
  function ensureQRLib() {
    if (typeof window.qrcode === 'function') return Promise.resolve(true);
    if (ensureQRLib._p) return ensureQRLib._p;
    ensureQRLib._p = new Promise(function (res) { var s = document.createElement('script'); s.src = 'vendor/qrcode-generator.js'; s.onload = function () { res(typeof window.qrcode === 'function'); }; s.onerror = function () { res(false); }; document.head.appendChild(s); });
    return ensureQRLib._p;
  }
  function renderReceive() {
    var w = wallet(); var qrEl = document.getElementById('omm-recv-qr'), addrEl = document.getElementById('omm-recv-addr');
    if (addrEl) addrEl.textContent = w ? (w.slice(0, 8) + '…' + w.slice(-6)) : 'Connect a wallet';
    if (!qrEl) return;
    if (!w) { qrEl.innerHTML = '<div class="omm-empty">Connect your wallet to show your pay code.</div>'; return; }
    ensureQRLib().then(function () { try { var q = window.qrcode(0, 'M'); q.addData(w); q.make(); qrEl.innerHTML = '<img src="' + q.createDataURL(6, 3) + '" alt="pay code">'; } catch (_) { qrEl.innerHTML = '<div class="omm-empty">' + esc(w) + '</div>'; } });
  }
  var scanStream = null, scanRAF = 0;
  function startScan() {
    var ov = document.getElementById('omm-scan-overlay'), vid = document.getElementById('omm-scan-video');
    if (!('BarcodeDetector' in window)) { toast('Scan-to-pay needs a camera browser (Android Chrome). Paste the address for now.'); return; }
    if (!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)) { toast('Camera unavailable here.'); return; }
    ov.hidden = false;
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }).then(function (stream) {
      scanStream = stream; vid.srcObject = stream; vid.play();
      var det = new window.BarcodeDetector({ formats: ['qr_code'] });
      var tick = function () { if (!scanStream) return; det.detect(vid).then(function (codes) { if (codes && codes[0]) { onScan(codes[0].rawValue); return; } scanRAF = requestAnimationFrame(tick); }).catch(function () { scanRAF = requestAnimationFrame(tick); }); };
      scanRAF = requestAnimationFrame(tick);
    }).catch(function () { ov.hidden = true; toast('Camera permission denied.'); });
  }
  function stopScan() { var ov = document.getElementById('omm-scan-overlay'); if (ov) ov.hidden = true; if (scanRAF) cancelAnimationFrame(scanRAF); scanRAF = 0; if (scanStream) { scanStream.getTracks().forEach(function (t) { t.stop(); }); scanStream = null; } }
  function onScan(raw) {
    stopScan();
    var m = String(raw || '').trim().match(/[1-9A-HJ-NP-Za-km-z]{32,44}/);   // base58 pubkey, also inside solana: URIs / mesh invites
    if (m) { var to = document.getElementById('omm-pay-to'); if (to) { to.value = m[0]; toast('Scanned ' + shortW(m[0])); } } else toast('No wallet address found in that code.');
  }
  var GAME_META = { tictactoe: { icon: '⭕', label: 'Tic-Tac-Toe' }, chess: { icon: '♟️', label: 'Chess' }, pool8: { icon: '🎱', label: '8-Ball Pool' }, cuppong: { icon: '🥤', label: 'Cup Pong' }, minigolf: { icon: '⛳', label: 'Mini Golf' } };
  function buildPlay(shell) {
    var sec = document.createElement('div'); sec.className = 'omm-section'; sec.setAttribute('data-mesh-view', 'play');
    sec.innerHTML = '<div class="omm-paybox">' +
      '<div class="omm-h">⚔ Fair games — provably fair, for OSTC</div>' +
      '<button class="omm-send" id="omm-fair" style="background:linear-gradient(135deg,#00d4ff,#00ff9f);color:#04121a">Open Fair Games arena</button>' +
      '<div class="omm-h" style="margin-top:16px">🎮 Peer games</div><div class="omm-games" id="omm-games"><div class="omm-empty">Loading games…</div></div>' +
      '<div class="omm-pay-status">Peer games run directly with a connected contact — moves are exchanged P2P and verified. Fair games settle in OSTC with a provably-fair seed.</div></div>';
    shell.appendChild(sec);
    sec.querySelector('#omm-fair').addEventListener('click', function () { try { if (window.OST_MESH_ARENA && OST_MESH_ARENA.open) OST_MESH_ARENA.open(); else window.dispatchEvent(new CustomEvent('mesh:open-games')); } catch (_) {} });
    renderGames();
  }
  function renderGames() {
    var host = document.getElementById('omm-games'); if (!host) return;
    var names = []; try { if (window.OST_MESH_GAMES && OST_MESH_GAMES.available) names = OST_MESH_GAMES.available() || []; } catch (_) {}
    if (!names.length) { host.innerHTML = '<div class="omm-empty">Games load when you connect to a peer — open a chat first, or tap Fair Games above.</div>'; return; }
    host.innerHTML = names.map(function (n) { var m = GAME_META[n] || { icon: '🎮', label: n }; return '<button class="omm-game" data-game="' + esc(n) + '"><span class="gi">' + m.icon + '</span>' + esc(m.label) + '</button>'; }).join('');
    host.querySelectorAll('[data-game]').forEach(function (b) { b.addEventListener('click', function () { try { if (window.OST_MESH_GAMES && OST_MESH_GAMES.open) OST_MESH_GAMES.open(b.getAttribute('data-game')); } catch (_) {} }); });
  }

  function buildTabbar(root, shell) {
    var bar = document.createElement('div'); bar.className = 'omm-tabbar';
    bar.innerHTML = TABS.map(function (t) { return '<button class="omm-tab" data-view="' + t.id + '"><span class="i">' + t.icon + '</span>' + t.label + '</button>'; }).join('');
    root.appendChild(bar);
    function setView(v) {
      shell.setAttribute('data-view', v);
      bar.querySelectorAll('.omm-tab').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-view') === v); });
      shell.scrollTop = 0;
      clearBadge(v);
      if (v === 'profile') renderProfile();
      if (v === 'chats') renderChats();
      if (v === 'play') renderGames();
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
    buildProfile(shell); buildChats(shell); buildFeed(shell); buildPay(shell); buildPlay(shell);
    buildTabbar(root, shell);
    // Notifications: inbound messages badge the Chats tab + toast, and update the
    // per-contact unread counts used by the conversation list.
    window.addEventListener('mesh:incoming-message', function (e) {
      var addr = e && e.detail && e.detail.addr;
      try { var u = JSON.parse(localStorage.getItem('ost.mesh.unread.v1') || '{}') || {}; if (addr) u[addr] = (u[addr] || 0) + 1; localStorage.setItem('ost.mesh.unread.v1', JSON.stringify(u)); } catch (_) {}
      if (currentView() !== 'chats') bumpBadge('chats', 1);
      toast('New message' + (addr ? ' from ' + shortW(addr) : ''));
      try { renderChats(); } catch (_) {}
    });
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

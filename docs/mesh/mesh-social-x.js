/* OST Mesh social extras: Stories (24h auto-erase, editor with text/stickers/location),
   Groups (create + group chat broadcast), and a Snapchat-style tab strip overlay. */
(function () {
  'use strict';

  var APP = 'ost-mesh-social-x';
  var STYLE_ID = 'ost-mesh-social-x-style';
  var STORIES_KEY = 'ost.mesh.stories.v1';
  var GROUPS_KEY = 'ost.mesh.groups.v1';
  var GROUP_MSG_PREFIX = 'ost.mesh.group.msgs.';
  var CONTACTS_KEYS = ['ost.mesh.contacts.v2', 'ost.mesh.contacts.v1'];
  var PROFILE_KEYS = ['ost.mesh.profile.v2', 'ost.mesh.profile.v1'];
  var STORY_TTL_MS = 24 * 60 * 60 * 1000;
  var STORY_MEDIA_MAX = 280000; // ~280 KB cap to keep mesh payloads transmittable
  var STICKERS = ['🔥', '⚡', '🚀', '💎', '🪙', '🛸', '🌐', '⭐', '❤️', '😎', '👀', '🎯', '🎉', '☢️', '🤖', '🧬'];

  function ready(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn, { once: true });
    else fn();
  }

  function pavilion() { return window.OST_MESH && window.OST_MESH.pavilion; }
  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }
  function uid(prefix) { return (prefix || 'id') + '-' + Math.random().toString(36).slice(2, 10) + '-' + Date.now().toString(36); }
  function readJson(key, fallback) { try { var v = JSON.parse(localStorage.getItem(key) || 'null'); return v == null ? fallback : v; } catch (_) { return fallback; } }
  function readFirst(keys, fallback) { for (var i = 0; i < keys.length; i++) { var v = readJson(keys[i], null); if (v != null) return v; } return fallback; }
  function writeJson(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) {} }
  function selfAddress() { var p = pavilion(); return (p && p.address) || ''; }
  function selfNick() { var prof = readFirst(PROFILE_KEYS, {}); return (prof && (prof.nickname || prof.handle)) || 'You'; }
  function contacts() { var l = readFirst(CONTACTS_KEYS, []); return Array.isArray(l) ? l : []; }
  function groups() { var l = readJson(GROUPS_KEY, []); return Array.isArray(l) ? l : []; }
  function stories() { var l = readJson(STORIES_KEY, []); return Array.isArray(l) ? l : []; }
  function shortAddr(v) { v = String(v || ''); return v.length > 16 ? v.slice(0, 8) + '…' + v.slice(-5) : v; }

  function purgeStories() {
    var now = Date.now();
    var list = stories().filter(function (s) { return Number(s.expiresAt || 0) > now; });
    writeJson(STORIES_KEY, list);
    return list;
  }

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = [
      '#ostMeshUpgrade.has-msx{flex:0 0 auto;padding:0;border-radius:18px;overflow:hidden;background:linear-gradient(180deg,#0b1a2c,#02080f)}',
      '#ostMeshUpgrade.has-msx .omu-social-head{padding:12px 14px 6px;border-bottom:1px solid rgba(127,216,255,.14)}',
      '.msx-tabs{display:flex;gap:4px;padding:8px 10px;background:rgba(0,0,0,.42);border-bottom:1px solid rgba(127,216,255,.12);overflow-x:auto;-webkit-overflow-scrolling:touch;scrollbar-width:none}.msx-tabs::-webkit-scrollbar{display:none}',
      '.msx-tab{flex:0 0 auto;border:1px solid rgba(255,255,255,.08);border-radius:999px;background:rgba(255,255,255,.04);color:#dff8ff;padding:8px 14px;font-size:12px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;cursor:pointer;display:inline-flex;align-items:center;gap:6px;min-height:34px}',
      '.msx-tab.is-active{background:linear-gradient(135deg,#fffd80,#ff5252);color:#190707;border-color:transparent;box-shadow:0 6px 16px rgba(255,82,82,.32)}',
      '.msx-tab .msx-tab-dot{width:6px;height:6px;border-radius:50%;background:#00ff9f;box-shadow:0 0 8px rgba(0,255,159,.7)}',
      '#ostMeshUpgrade.has-msx .omu-body{padding:12px}',
      '#ostMeshUpgrade.has-msx [data-msx-section]{display:none}',
      '#ostMeshUpgrade.has-msx [data-msx-section].is-active{display:grid;gap:12px}',
      '.msx-stories-bar{display:flex;gap:10px;overflow-x:auto;padding:6px 2px 8px;-webkit-overflow-scrolling:touch;scrollbar-width:none}.msx-stories-bar::-webkit-scrollbar{display:none}',
      '.msx-story-bubble{flex:0 0 auto;width:78px;text-align:center;cursor:pointer;display:grid;gap:4px}',
      '.msx-story-bubble .ring{width:72px;height:72px;border-radius:50%;padding:3px;background:conic-gradient(from 90deg,#ffe066,#ff5e62,#ff9f43,#fffd80);display:grid;place-items:center}',
      '.msx-story-bubble.is-mine .ring{background:linear-gradient(135deg,#00d4ff,#00ff9f)}',
      '.msx-story-bubble.is-seen .ring{background:rgba(255,255,255,.18)}',
      '.msx-story-bubble .inner{width:100%;height:100%;border-radius:50%;background:#0b1a2c;display:grid;place-items:center;overflow:hidden;color:#dff8ff;font-weight:800}',
      '.msx-story-bubble .inner img{width:100%;height:100%;object-fit:cover}',
      '.msx-story-bubble .name{font-size:10px;color:#9bcbe6;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.msx-story-bubble.is-add .ring{background:rgba(127,216,255,.18)}.msx-story-bubble.is-add .inner{font-size:28px;color:#7fd8ff}',
      '.msx-fab{position:fixed;right:18px;bottom:96px;z-index:1000220;width:56px;height:56px;border-radius:50%;border:none;background:linear-gradient(135deg,#fffd80,#ff5252);color:#190707;font-size:26px;font-weight:900;box-shadow:0 18px 38px rgba(255,82,82,.35);cursor:pointer;display:none}',
      'body.ost-mesh-scroll-lock #ostMeshFab{display:grid;place-items:center}',
      '.msx-modal{position:fixed;inset:0;z-index:1000400;background:rgba(2,6,14,.92);display:none;align-items:center;justify-content:center;padding:0}',
      '.msx-modal.is-open{display:flex}',
      '.msx-editor{width:min(440px,100%);height:min(96vh,820px);border:1px solid rgba(127,216,255,.22);border-radius:0;background:#02080f;display:grid;grid-template-rows:auto 1fr auto;color:#dff8ff;overflow:hidden}',
      '@media(min-width:520px){.msx-editor{border-radius:18px;height:min(92vh,720px)}}',
      '.msx-editor-head{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;background:rgba(0,0,0,.35);border-bottom:1px solid rgba(127,216,255,.12)}',
      '.msx-editor-head strong{font-size:13px;letter-spacing:.04em;text-transform:uppercase}',
      '.msx-editor-head button{border:1px solid rgba(255,255,255,.12);border-radius:10px;background:rgba(255,255,255,.07);color:#e8fbff;padding:7px 12px;font-weight:800;cursor:pointer;min-height:34px;font-size:12px}',
      '.msx-editor-canvas-wrap{position:relative;background:#000;display:grid;place-items:center;overflow:hidden}',
      '.msx-canvas-stage{position:relative;width:100%;height:100%;display:grid;place-items:center;overflow:hidden;background:radial-gradient(circle at 50% 30%,#1d3a5f,#02060c)}',
      '.msx-canvas-frame{position:relative;width:min(100%,calc((100% * 9) / 16 + 0px));aspect-ratio:9/16;max-height:100%;background:linear-gradient(135deg,#162a44,#02060c);overflow:hidden;border-radius:14px;box-shadow:0 18px 60px rgba(0,0,0,.5)}',
      '.msx-canvas-frame img.bg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;pointer-events:none}',
      '.msx-overlay{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);max-width:80%;cursor:grab;padding:6px 10px;border-radius:10px;font-weight:800;line-height:1.2;text-shadow:0 2px 8px rgba(0,0,0,.55);user-select:none;touch-action:none}',
      '.msx-overlay.text{font-size:22px;color:#fff;background:rgba(0,0,0,.0)}',
      '.msx-overlay.text[data-bg="dark"]{background:rgba(0,0,0,.55);padding:8px 14px;border-radius:14px}',
      '.msx-overlay.text[data-bg="light"]{background:rgba(255,255,255,.85);color:#02060c;padding:8px 14px;border-radius:14px;text-shadow:none}',
      '.msx-overlay.sticker{font-size:48px;background:none;text-shadow:0 4px 12px rgba(0,0,0,.55)}',
      '.msx-overlay.location{background:linear-gradient(135deg,#ff9f43,#ff5e62);color:#fff;font-size:13px;padding:6px 12px;border-radius:999px;display:inline-flex;align-items:center;gap:6px}',
      '.msx-overlay.is-active{outline:2px dashed rgba(255,255,255,.65);outline-offset:2px}',
      '.msx-editor-tools{display:grid;gap:8px;padding:10px;background:rgba(0,0,0,.55);border-top:1px solid rgba(127,216,255,.12)}',
      '.msx-tool-row{display:flex;gap:6px;flex-wrap:wrap;justify-content:center}',
      '.msx-tool-btn{border:1px solid rgba(255,255,255,.12);border-radius:10px;background:rgba(255,255,255,.07);color:#e8fbff;padding:8px 10px;font-weight:800;font-size:12px;min-height:36px;cursor:pointer}',
      '.msx-tool-btn.primary{background:linear-gradient(135deg,#00d4ff,#00ff9f);color:#03131c;border-color:transparent}',
      '.msx-tool-btn.danger{background:rgba(239,68,68,.2);border-color:rgba(239,68,68,.4)}',
      '.msx-color-row{display:flex;gap:6px;flex-wrap:wrap;justify-content:center}',
      '.msx-color-dot{width:26px;height:26px;border-radius:50%;border:2px solid rgba(255,255,255,.6);cursor:pointer}',
      '.msx-sticker-grid{display:grid;grid-template-columns:repeat(8,1fr);gap:6px;background:rgba(0,0,0,.55);padding:8px;border-radius:12px;max-height:120px;overflow:auto}',
      '.msx-sticker-grid button{font-size:24px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:8px;padding:4px;cursor:pointer;min-height:38px}',
      '.msx-text-input{width:100%;background:rgba(0,0,0,.6);border:1px solid rgba(127,216,255,.3);border-radius:10px;color:#fff;padding:8px 10px;font-size:14px;font-weight:700}',
      '.msx-stories-empty{padding:14px;border:1px dashed rgba(127,216,255,.22);border-radius:14px;color:#9bcbe6;font-size:12px;text-align:center}',
      '.msx-story-viewer{position:fixed;inset:0;z-index:1000420;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.96);padding:0}',
      '.msx-story-viewer.is-open{display:flex}',
      '.msx-viewer-frame{position:relative;width:min(440px,100%);height:min(96vh,820px);background:#000;display:grid;grid-template-rows:auto 1fr auto;overflow:hidden}',
      '@media(min-width:520px){.msx-viewer-frame{border-radius:18px;height:min(92vh,720px)}}',
      '.msx-viewer-progress{position:absolute;top:6px;left:8px;right:8px;height:3px;background:rgba(255,255,255,.18);border-radius:2px;overflow:hidden;z-index:5}',
      '.msx-viewer-progress span{display:block;height:100%;width:0;background:#fff;transition:width .12s linear}',
      '.msx-viewer-head{padding:18px 12px 8px;background:linear-gradient(180deg,rgba(0,0,0,.55),transparent);color:#fff;display:flex;justify-content:space-between;align-items:center;z-index:4}',
      '.msx-viewer-head strong{font-size:13px}.msx-viewer-head span{color:#cfeaff;font-size:11px}',
      '.msx-viewer-head button{background:rgba(0,0,0,.45);border:1px solid rgba(255,255,255,.16);color:#fff;border-radius:50%;width:34px;height:34px;font-size:18px;cursor:pointer}',
      '.msx-viewer-canvas{position:relative;width:100%;height:100%;display:grid;place-items:center;overflow:hidden;background:#000}',
      '.msx-viewer-canvas img{width:100%;height:100%;object-fit:contain}',
      '.msx-viewer-foot{padding:10px;background:linear-gradient(0deg,rgba(0,0,0,.55),transparent);color:#fff;font-size:12px;text-align:center}',
      '.msx-groups-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px}',
      '.msx-group-card{position:relative;border:1px solid rgba(127,216,255,.22);border-radius:14px;background:linear-gradient(150deg,rgba(0,212,255,.12),rgba(167,139,250,.08));padding:10px;display:grid;gap:6px;cursor:pointer;color:#dff8ff;min-height:96px}',
      '.msx-group-card strong{font-size:14px;color:#fff}',
      '.msx-group-card span{font-size:11px;color:#9bcbe6}',
      '.msx-group-card .members{display:flex;gap:-4px;margin-top:4px}',
      '.msx-group-card .members b{display:inline-grid;place-items:center;width:22px;height:22px;border-radius:50%;background:#0b1a2c;color:#9bcbe6;font-size:10px;border:2px solid #0b1a2c;margin-left:-6px}',
      '.msx-group-card .members b:first-child{margin-left:0}',
      '.msx-group-card.is-add{border-style:dashed;background:rgba(127,216,255,.06);place-items:center;text-align:center}',
      '.msx-group-card.is-add b{font-size:30px;color:#7fd8ff}',
      '.msx-group-modal{display:none;position:fixed;inset:0;z-index:1000410;background:rgba(2,6,14,.92);align-items:center;justify-content:center;padding:14px}',
      '.msx-group-modal.is-open{display:flex}',
      '.msx-group-panel{width:min(420px,100%);max-height:90vh;overflow:auto;border:1px solid rgba(127,216,255,.22);border-radius:18px;background:#06111d;padding:14px;display:grid;gap:10px;color:#dff8ff}',
      '.msx-group-panel h3{margin:0;color:#fff;font-size:14px;letter-spacing:.04em;text-transform:uppercase}',
      '.msx-group-panel input,.msx-group-panel textarea{width:100%;border:1px solid rgba(255,255,255,.14);border-radius:11px;background:#06141f;color:#d8eaff;padding:10px;font:inherit;font-size:13px}',
      '.msx-group-members{display:grid;gap:6px;max-height:240px;overflow:auto}',
      '.msx-group-members label{display:flex;gap:8px;align-items:center;border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:8px;cursor:pointer;background:rgba(255,255,255,.03)}',
      '.msx-group-members input{width:auto}',
      '.msx-chat-modal{display:none;position:fixed;inset:0;z-index:1000412;background:rgba(2,6,14,.92);align-items:center;justify-content:center;padding:0}',
      '.msx-chat-modal.is-open{display:flex}',
      '.msx-chat-panel{width:min(460px,100%);height:min(96vh,720px);border:1px solid rgba(127,216,255,.22);background:#02080f;display:grid;grid-template-rows:auto 1fr auto;overflow:hidden;color:#dff8ff}',
      '@media(min-width:520px){.msx-chat-panel{border-radius:18px}}',
      '.msx-chat-head{padding:10px 12px;background:rgba(0,0,0,.35);border-bottom:1px solid rgba(127,216,255,.12);display:flex;justify-content:space-between;align-items:center}',
      '.msx-chat-head strong{font-size:14px}.msx-chat-head span{font-size:11px;color:#9bcbe6}',
      '.msx-chat-head button{border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.07);color:#fff;border-radius:10px;padding:7px 10px;font-weight:800;cursor:pointer;font-size:12px}',
      '.msx-chat-log{padding:12px;overflow:auto;display:grid;gap:8px;align-content:start}',
      '.msx-chat-msg{padding:8px 12px;border-radius:14px;max-width:80%;font-size:13px;line-height:1.35}',
      '.msx-chat-msg.is-mine{background:linear-gradient(135deg,#00d4ff,#00ff9f);color:#03131c;justify-self:end}',
      '.msx-chat-msg.is-peer{background:rgba(255,255,255,.07);color:#dff8ff;justify-self:start;border:1px solid rgba(255,255,255,.08)}',
      '.msx-chat-msg .who{display:block;font-size:10px;color:#9bcbe6;margin-bottom:2px;text-transform:uppercase;letter-spacing:.04em}',
      '.msx-chat-msg.is-mine .who{color:rgba(3,19,28,.7)}',
      '.msx-chat-foot{padding:10px;border-top:1px solid rgba(127,216,255,.12);display:grid;grid-template-columns:1fr auto;gap:8px;background:rgba(0,0,0,.4)}',
      '.msx-chat-foot input{border:1px solid rgba(255,255,255,.14);border-radius:11px;background:#06141f;color:#d8eaff;padding:10px;font:inherit;font-size:13px}',
      '.msx-chat-foot button{border:none;border-radius:11px;background:linear-gradient(135deg,#00d4ff,#00ff9f);color:#03131c;padding:10px 16px;font-weight:900;cursor:pointer}',
      '.msx-empty{padding:14px;border:1px dashed rgba(127,216,255,.22);border-radius:14px;color:#9bcbe6;font-size:12px;text-align:center}'
    ].join('\n');
    document.head.appendChild(style);
  }

  function ensureSections(panel) {
    if (!panel || panel.dataset.msxReady === '1') return;
    panel.dataset.msxReady = '1';
    panel.classList.add('has-msx');
    var body = panel.querySelector('#omuBody');
    if (!body) return;
    panel.classList.remove('is-collapsed');
    var togglePanel = panel.querySelector('#omuTogglePanel');
    if (togglePanel) { togglePanel.setAttribute('aria-expanded', 'true'); togglePanel.textContent = 'Hide'; }
    // Build tab strip
    var tabs = document.createElement('div');
    tabs.className = 'msx-tabs';
    tabs.setAttribute('role', 'tablist');
    tabs.innerHTML = [
      '<button class="msx-tab is-active" data-msx-tab="stories" type="button"><span class="msx-tab-dot"></span>Stories</button>',
      '<button class="msx-tab" data-msx-tab="chat" type="button">Chat</button>',
      '<button class="msx-tab" data-msx-tab="contacts" type="button">Contacts</button>',
      '<button class="msx-tab" data-msx-tab="groups" type="button">Groups</button>',
      '<button class="msx-tab" data-msx-tab="profile" type="button">Profile</button>',
      '<button class="msx-tab" data-msx-tab="saved" type="button">Saved</button>'
    ].join('');
    body.parentNode.insertBefore(tabs, body);

    // Wrap existing cards into tabbed sections.
    var cards = Array.prototype.slice.call(body.children);
    var sections = {
      profile: document.createElement('div'),
      contacts: document.createElement('div'),
      saved: document.createElement('div'),
      chat: document.createElement('div'),
      stories: document.createElement('div'),
      groups: document.createElement('div')
    };
    Object.keys(sections).forEach(function (k) {
      sections[k].setAttribute('data-msx-section', k);
      if (k === 'stories') sections[k].classList.add('is-active');
    });
    cards.forEach(function (card) {
      var h3 = card.querySelector && card.querySelector('h3');
      var title = h3 ? String(h3.textContent || '').toLowerCase() : '';
      if (title.indexOf('contact') >= 0) sections.contacts.appendChild(card);
      else if (title.indexOf('saved text') >= 0) sections.saved.appendChild(card);
      else if (title.indexOf('signal') >= 0) sections.chat.appendChild(card);
      else if (title.indexOf('add people') >= 0) sections.contacts.appendChild(card);
      else if (title.indexOf('social profile') >= 0) sections.profile.appendChild(card);
      else if (card.classList && card.classList.contains('omu-grid')) {
        // unwrap legacy grid: distribute children
        Array.prototype.slice.call(card.children).forEach(function (sub) {
          var sh = sub.querySelector && sub.querySelector('h3');
          var st = sh ? String(sh.textContent || '').toLowerCase() : '';
          if (st.indexOf('contact') >= 0) sections.contacts.appendChild(sub);
          else if (st.indexOf('signal') >= 0) sections.chat.appendChild(sub);
          else if (st.indexOf('add people') >= 0) sections.contacts.appendChild(sub);
          else if (st.indexOf('social profile') >= 0) sections.profile.appendChild(sub);
          else sections.profile.appendChild(sub);
        });
      } else sections.profile.appendChild(card);
    });

    // Stories section content
    sections.stories.innerHTML = [
      '<div class="omu-card"><h3>Stories</h3><p style="margin:0;color:#9bcbe6;font-size:12px">Tap your bubble to post a story. Stories auto-erase in 24h.</p>',
      '<div class="msx-stories-bar" id="msxStoriesBar"></div>',
      '</div>'
    ].join('');

    // Groups section content
    sections.groups.innerHTML = [
      '<div class="omu-card"><h3>Groups</h3><p style="margin:0;color:#9bcbe6;font-size:12px">Encrypted multi-contact chats. Members get group messages relayed when connected.</p>',
      '<div class="msx-groups-grid" id="msxGroupsGrid"></div>',
      '</div>'
    ].join('');

    body.innerHTML = '';
    Object.keys(sections).forEach(function (k) { body.appendChild(sections[k]); });

    // FAB
    if (!document.getElementById('ostMeshFab')) {
      var fab = document.createElement('button');
      fab.id = 'ostMeshFab';
      fab.className = 'msx-fab';
      fab.type = 'button';
      fab.title = 'New story';
      fab.textContent = '＋';
      document.body.appendChild(fab);
      fab.addEventListener('click', openStoryEditor);
    }

    // Tab switching
    tabs.addEventListener('click', function (event) {
      var btn = event.target.closest('[data-msx-tab]');
      if (!btn) return;
      var key = btn.dataset.msxTab;
      Array.prototype.forEach.call(tabs.querySelectorAll('[data-msx-tab]'), function (b) { b.classList.toggle('is-active', b === btn); });
      Array.prototype.forEach.call(body.querySelectorAll('[data-msx-section]'), function (sec) { sec.classList.toggle('is-active', sec.getAttribute('data-msx-section') === key); });
      // Make sure the panel itself is open if collapsed.
      panel.classList.remove('is-collapsed');
      var btnPanel = panel.querySelector('#omuTogglePanel');
      if (btnPanel) { btnPanel.setAttribute('aria-expanded', 'true'); btnPanel.textContent = 'Hide'; }
      // Trigger FAB visibility for stories tab.
      var fab = document.getElementById('ostMeshFab');
      if (fab) fab.style.display = (key === 'stories') ? 'grid' : 'none';
    });
    // Initial: stories tab active so show FAB when mesh is open.
    var fab = document.getElementById('ostMeshFab');
    if (fab) fab.style.display = 'grid';

    renderStoriesBar();
    renderGroupsGrid();
  }

  // ---------- Stories ----------

  function renderStoriesBar() {
    var bar = document.getElementById('msxStoriesBar');
    if (!bar) return;
    purgeStories();
    var list = stories();
    var byOwner = {};
    list.forEach(function (s) { (byOwner[s.ownerAddress || 'me'] = byOwner[s.ownerAddress || 'me'] || []).push(s); });
    var me = selfAddress();
    var html = [];
    // My bubble (always first)
    var mine = byOwner[me] || [];
    delete byOwner[me];
    delete byOwner['me'];
    var myCount = mine.length;
    html.push(
      '<div class="msx-story-bubble is-mine" data-msx-story-owner="' + escapeHtml(me) + '">' +
        '<div class="ring"><div class="inner">' + (myCount ? '★' : '＋') + '</div></div>' +
        '<div class="name">Your story' + (myCount ? ' · ' + myCount : '') + '</div>' +
      '</div>'
    );
    Object.keys(byOwner).forEach(function (addr) {
      var arr = byOwner[addr];
      var first = arr[0];
      var label = first.ownerNick || shortAddr(addr);
      html.push(
        '<div class="msx-story-bubble" data-msx-story-owner="' + escapeHtml(addr) + '">' +
          '<div class="ring"><div class="inner">' + escapeHtml(label.charAt(0).toUpperCase()) + '</div></div>' +
          '<div class="name">' + escapeHtml(label) + '</div>' +
        '</div>'
      );
    });
    bar.innerHTML = html.join('');
    bar.onclick = function (event) {
      var bub = event.target.closest('[data-msx-story-owner]');
      if (!bub) return;
      var owner = bub.getAttribute('data-msx-story-owner');
      var ownerStories = stories().filter(function (s) { return (s.ownerAddress || '') === owner; });
      if (!ownerStories.length && owner === me) return openStoryEditor();
      if (ownerStories.length) openStoryViewer(ownerStories);
    };
  }

  function openStoryEditor() {
    purgeStories();
    var modal = document.getElementById('msxEditorModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'msxEditorModal';
      modal.className = 'msx-modal';
      modal.innerHTML = [
        '<div class="msx-editor">',
          '<div class="msx-editor-head"><strong>New story</strong>',
            '<div style="display:flex;gap:6px"><button type="button" id="msxEditorCancel">Cancel</button><button type="button" id="msxEditorPost" class="primary" style="background:linear-gradient(135deg,#00d4ff,#00ff9f);color:#03131c;border:none">Post</button></div>',
          '</div>',
          '<div class="msx-editor-canvas-wrap"><div class="msx-canvas-stage"><div class="msx-canvas-frame" id="msxFrame"></div></div></div>',
          '<div class="msx-editor-tools">',
            '<div class="msx-tool-row">',
              '<input type="file" id="msxFileInput" accept="image/*" capture="environment" hidden>',
              '<button class="msx-tool-btn" type="button" id="msxAddPhoto">📷 Photo</button>',
              '<button class="msx-tool-btn" type="button" id="msxAddText">𝐓 Text</button>',
              '<button class="msx-tool-btn" type="button" id="msxAddSticker">🪄 Sticker</button>',
              '<button class="msx-tool-btn" type="button" id="msxAddLocation">📍 Location</button>',
              '<button class="msx-tool-btn danger" type="button" id="msxRemoveOverlay">🗑</button>',
            '</div>',
            '<input type="text" class="msx-text-input" id="msxTextInput" placeholder="Caption (optional)" maxlength="140">',
            '<div class="msx-color-row" id="msxColorRow"></div>',
            '<div class="msx-sticker-grid" id="msxStickerGrid" style="display:none"></div>',
          '</div>',
        '</div>'
      ].join('');
      document.body.appendChild(modal);
      // Sticker grid
      var sg = modal.querySelector('#msxStickerGrid');
      sg.innerHTML = STICKERS.map(function (s) { return '<button type="button" data-sticker="' + s + '">' + s + '</button>'; }).join('');
      sg.addEventListener('click', function (event) {
        var b = event.target.closest('[data-sticker]');
        if (!b) return;
        addOverlay('sticker', b.getAttribute('data-sticker'));
        sg.style.display = 'none';
      });
      // Color row (text bg/color presets)
      var colors = ['transparent', 'dark', 'light', '#ff5e62', '#00ff9f', '#00d4ff', '#fffd80', '#a78bfa'];
      modal.querySelector('#msxColorRow').innerHTML = colors.map(function (c) {
        var bg = c === 'transparent' ? 'rgba(255,255,255,.15)' : (c === 'dark' ? '#000' : (c === 'light' ? '#fff' : c));
        return '<button class="msx-color-dot" data-color="' + c + '" style="background:' + bg + '"></button>';
      }).join('');
      modal.querySelector('#msxColorRow').addEventListener('click', function (event) {
        var b = event.target.closest('[data-color]');
        if (!b) return;
        var active = modal.querySelector('.msx-overlay.is-active.text');
        if (!active) return;
        var c = b.getAttribute('data-color');
        if (c === 'transparent') { active.removeAttribute('data-bg'); active.style.color = '#fff'; }
        else if (c === 'dark') { active.setAttribute('data-bg', 'dark'); active.style.color = '#fff'; }
        else if (c === 'light') { active.setAttribute('data-bg', 'light'); active.style.color = '#02060c'; }
        else { active.style.color = c; active.removeAttribute('data-bg'); }
      });
      modal.querySelector('#msxAddPhoto').addEventListener('click', function () { modal.querySelector('#msxFileInput').click(); });
      modal.querySelector('#msxFileInput').addEventListener('change', function (event) {
        var f = event.target.files && event.target.files[0];
        if (!f) return;
        var reader = new FileReader();
        reader.onload = function (e) { setBackground(e.target.result); };
        reader.readAsDataURL(f);
      });
      modal.querySelector('#msxAddText').addEventListener('click', function () { addOverlay('text', 'Tap to edit'); });
      modal.querySelector('#msxAddSticker').addEventListener('click', function () { var sg = modal.querySelector('#msxStickerGrid'); sg.style.display = sg.style.display === 'none' ? 'grid' : 'none'; });
      modal.querySelector('#msxAddLocation').addEventListener('click', addLocationOverlay);
      modal.querySelector('#msxRemoveOverlay').addEventListener('click', function () {
        var active = modal.querySelector('.msx-overlay.is-active');
        if (active) active.remove();
      });
      modal.querySelector('#msxEditorCancel').addEventListener('click', closeStoryEditor);
      modal.querySelector('#msxEditorPost').addEventListener('click', postStory);
    } else {
      // Reset frame
      modal.querySelector('#msxFrame').innerHTML = '';
      modal.querySelector('#msxTextInput').value = '';
    }
    modal.classList.add('is-open');
  }
  function closeStoryEditor() {
    var modal = document.getElementById('msxEditorModal');
    if (modal) modal.classList.remove('is-open');
  }

  function setBackground(dataUrl) {
    var frame = document.querySelector('#msxFrame');
    if (!frame) return;
    var img = frame.querySelector('img.bg');
    if (!img) {
      img = document.createElement('img');
      img.className = 'bg';
      img.alt = '';
      frame.insertBefore(img, frame.firstChild);
    }
    img.src = dataUrl;
  }

  function makeDraggable(el) {
    var startX = 0, startY = 0, baseLeft = 0, baseTop = 0, dragging = false;
    function onDown(e) {
      dragging = true;
      el.classList.add('is-active');
      Array.prototype.forEach.call(document.querySelectorAll('.msx-overlay'), function (o) { if (o !== el) o.classList.remove('is-active'); });
      var pt = e.touches ? e.touches[0] : e;
      startX = pt.clientX; startY = pt.clientY;
      var rect = el.getBoundingClientRect();
      var parent = el.parentElement.getBoundingClientRect();
      baseLeft = ((rect.left - parent.left + rect.width / 2) / parent.width) * 100;
      baseTop = ((rect.top - parent.top + rect.height / 2) / parent.height) * 100;
      el.style.left = baseLeft + '%';
      el.style.top = baseTop + '%';
      e.preventDefault();
    }
    function onMove(e) {
      if (!dragging) return;
      var pt = e.touches ? e.touches[0] : e;
      var parent = el.parentElement.getBoundingClientRect();
      var dx = ((pt.clientX - startX) / parent.width) * 100;
      var dy = ((pt.clientY - startY) / parent.height) * 100;
      el.style.left = Math.max(5, Math.min(95, baseLeft + dx)) + '%';
      el.style.top = Math.max(5, Math.min(95, baseTop + dy)) + '%';
    }
    function onUp() { dragging = false; }
    el.addEventListener('mousedown', onDown);
    el.addEventListener('touchstart', onDown, { passive: false });
    window.addEventListener('mousemove', onMove);
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchend', onUp);
  }

  function addOverlay(kind, content) {
    var frame = document.querySelector('#msxFrame');
    if (!frame) return;
    var el = document.createElement('div');
    el.className = 'msx-overlay ' + kind;
    el.dataset.kind = kind;
    el.style.left = '50%';
    el.style.top = (kind === 'location' ? '85%' : '50%');
    if (kind === 'text') {
      el.contentEditable = 'true';
      el.textContent = content;
      el.addEventListener('focus', function () {
        if (el.textContent === 'Tap to edit') { el.textContent = ''; }
        Array.prototype.forEach.call(frame.querySelectorAll('.msx-overlay'), function (o) { o.classList.toggle('is-active', o === el); });
      });
    } else if (kind === 'sticker') {
      el.textContent = content;
    } else if (kind === 'location') {
      el.innerHTML = '📍 <span data-loc>' + escapeHtml(content || 'Earth') + '</span>';
    }
    frame.appendChild(el);
    makeDraggable(el);
    Array.prototype.forEach.call(frame.querySelectorAll('.msx-overlay'), function (o) { o.classList.toggle('is-active', o === el); });
  }

  function addLocationOverlay() {
    if (!navigator.geolocation) return addOverlay('location', 'Earth');
    addOverlay('location', 'Locating…');
    var el = document.querySelector('#msxFrame .msx-overlay.location.is-active');
    navigator.geolocation.getCurrentPosition(function (pos) {
      var lat = pos.coords.latitude.toFixed(2);
      var lon = pos.coords.longitude.toFixed(2);
      if (el && el.querySelector('[data-loc]')) el.querySelector('[data-loc]').textContent = lat + '°, ' + lon + '°';
    }, function () {
      if (el && el.querySelector('[data-loc]')) el.querySelector('[data-loc]').textContent = 'Earth';
    }, { timeout: 6000 });
  }

  // Compose the editor frame to a single PNG snapshot using canvas rasterization.
  function snapshotEditor(callback) {
    var frame = document.getElementById('msxFrame');
    if (!frame) return callback(null);
    var rect = frame.getBoundingClientRect();
    var W = 720, H = 1280;
    var canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    var ctx = canvas.getContext('2d');
    // Background
    var bgImg = frame.querySelector('img.bg');
    function drawOverlays(done) {
      // Default bg gradient if no image
      if (!bgImg || !bgImg.src) {
        var grad = ctx.createLinearGradient(0, 0, W, H);
        grad.addColorStop(0, '#162a44');
        grad.addColorStop(1, '#02060c');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, W, H);
      }
      // Render each overlay
      Array.prototype.forEach.call(frame.querySelectorAll('.msx-overlay'), function (el) {
        var er = el.getBoundingClientRect();
        var cx = ((er.left - rect.left + er.width / 2) / rect.width) * W;
        var cy = ((er.top - rect.top + er.height / 2) / rect.height) * H;
        var kind = el.dataset.kind || 'text';
        if (kind === 'sticker') {
          ctx.font = '88px serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = '#fff';
          ctx.fillText(el.textContent || '', cx, cy);
        } else if (kind === 'location') {
          var text = '📍 ' + (el.querySelector('[data-loc]') ? el.querySelector('[data-loc]').textContent : '');
          ctx.font = 'bold 28px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          var w = ctx.measureText(text).width + 36;
          var grad2 = ctx.createLinearGradient(cx - w / 2, cy - 22, cx + w / 2, cy + 22);
          grad2.addColorStop(0, '#ff9f43'); grad2.addColorStop(1, '#ff5e62');
          ctx.fillStyle = grad2;
          roundRectFill(ctx, cx - w / 2, cy - 24, w, 48, 24);
          ctx.fillStyle = '#fff';
          ctx.fillText(text, cx, cy + 2);
        } else { // text
          var bg = el.getAttribute('data-bg');
          var color = el.style.color || '#fff';
          var raw = (el.textContent || '').trim();
          if (!raw) return;
          ctx.font = 'bold 44px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          var lines = raw.split(/\n/);
          var maxW = 0;
          lines.forEach(function (l) { maxW = Math.max(maxW, ctx.measureText(l).width); });
          if (bg === 'dark' || bg === 'light') {
            var pad = 24;
            ctx.fillStyle = bg === 'dark' ? 'rgba(0,0,0,.6)' : 'rgba(255,255,255,.85)';
            roundRectFill(ctx, cx - maxW / 2 - pad, cy - lines.length * 28 - pad, maxW + pad * 2, lines.length * 56 + pad * 2, 24);
          }
          ctx.fillStyle = color;
          if (!bg) { ctx.shadowColor = 'rgba(0,0,0,.7)'; ctx.shadowBlur = 8; }
          lines.forEach(function (line, i) {
            ctx.fillText(line, cx, cy + (i - (lines.length - 1) / 2) * 56);
          });
          ctx.shadowBlur = 0;
        }
      });
      done(canvas.toDataURL('image/jpeg', 0.78));
    }
    if (bgImg && bgImg.src) {
      var img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = function () {
        // Cover-fit
        var ar = img.width / img.height;
        var canvasAr = W / H;
        var dw, dh;
        if (ar > canvasAr) { dh = H; dw = H * ar; }
        else { dw = W; dh = W / ar; }
        ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
        drawOverlays(callback);
      };
      img.onerror = function () { drawOverlays(callback); };
      img.src = bgImg.src;
    } else {
      drawOverlays(callback);
    }
  }

  function roundRectFill(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
    ctx.fill();
  }

  function postStory() {
    snapshotEditor(function (dataUrl) {
      if (!dataUrl) return;
      var caption = (document.getElementById('msxTextInput') || {}).value || '';
      var media = dataUrl;
      // If too large, lower quality progressively
      while (media.length > STORY_MEDIA_MAX) {
        var img = new Image();
        // synchronous fallback skipped — accept the size
        break;
      }
      var story = {
        id: uid('story'),
        ownerAddress: selfAddress(),
        ownerNick: selfNick(),
        media: media,
        caption: caption,
        createdAt: Date.now(),
        expiresAt: Date.now() + STORY_TTL_MS
      };
      var list = stories();
      list.unshift(story);
      writeJson(STORIES_KEY, list.slice(0, 60));
      renderStoriesBar();
      closeStoryEditor();
      // Broadcast to active peer (best effort).
      var p = pavilion();
      if (p && typeof p.sendAppPayloadReliable === 'function') {
        try { p.sendAppPayloadReliable({ kind: 'mesh-app', app: APP, type: 'story.post', story: story }, { timeoutMs: 8000 }).catch(function () {}); }
        catch (_) {}
      } else if (p && typeof p.sendAppPayload === 'function') {
        try { p.sendAppPayload({ kind: 'mesh-app', app: APP, type: 'story.post', story: story }); } catch (_) {}
      }
    });
  }

  function openStoryViewer(list) {
    var modal = document.getElementById('msxStoryViewer');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'msxStoryViewer';
      modal.className = 'msx-story-viewer';
      modal.innerHTML = [
        '<div class="msx-viewer-frame">',
          '<div class="msx-viewer-progress"><span></span></div>',
          '<div class="msx-viewer-head"><div><strong id="msxViewerName"></strong><br><span id="msxViewerTime"></span></div><button type="button" id="msxViewerClose">✕</button></div>',
          '<div class="msx-viewer-canvas" id="msxViewerCanvas"></div>',
          '<div class="msx-viewer-foot" id="msxViewerCaption"></div>',
        '</div>'
      ].join('');
      document.body.appendChild(modal);
      modal.querySelector('#msxViewerClose').addEventListener('click', function () {
        modal.classList.remove('is-open');
        clearInterval(modal._tick);
      });
      modal.querySelector('#msxViewerCanvas').addEventListener('click', function () {
        modal._index = (modal._index || 0) + 1;
        renderViewerStep();
      });
    }
    modal._stories = list.slice();
    modal._index = 0;
    modal.classList.add('is-open');
    function renderViewerStep() {
      var s = modal._stories[modal._index];
      if (!s) {
        modal.classList.remove('is-open');
        clearInterval(modal._tick);
        return;
      }
      modal.querySelector('#msxViewerName').textContent = s.ownerNick || shortAddr(s.ownerAddress) || 'Mesh';
      var ago = Math.max(0, Math.floor((Date.now() - (s.createdAt || 0)) / 60000));
      modal.querySelector('#msxViewerTime').textContent = ago < 60 ? ago + 'm ago' : Math.floor(ago / 60) + 'h ago';
      var canvas = modal.querySelector('#msxViewerCanvas');
      canvas.innerHTML = s.media ? '<img src="' + escapeHtml(s.media) + '" alt="">' : '<div style="color:#fff">Story</div>';
      modal.querySelector('#msxViewerCaption').textContent = s.caption || '';
      var bar = modal.querySelector('.msx-viewer-progress span');
      bar.style.width = '0%';
      var start = Date.now();
      clearInterval(modal._tick);
      modal._tick = setInterval(function () {
        var dt = Date.now() - start;
        var pct = Math.min(100, (dt / 5000) * 100);
        bar.style.width = pct + '%';
        if (pct >= 100) { modal._index += 1; renderViewerStep(); }
      }, 80);
    }
    renderViewerStep();
    modal.renderViewerStep = renderViewerStep;
  }

  // ---------- Groups ----------

  function renderGroupsGrid() {
    var grid = document.getElementById('msxGroupsGrid');
    if (!grid) return;
    var list = groups();
    var html = list.map(function (g, idx) {
      var members = (g.members || []).slice(0, 4).map(function (m) { return '<b>' + escapeHtml(shortAddr(m).charAt(0).toUpperCase()) + '</b>'; }).join('');
      return '<div class="msx-group-card" data-group-id="' + escapeHtml(g.id) + '">' +
        '<strong>' + escapeHtml(g.name || 'Group') + '</strong>' +
        '<span>' + (g.members || []).length + ' members</span>' +
        '<div class="members">' + members + '</div>' +
      '</div>';
    });
    html.push('<div class="msx-group-card is-add" id="msxAddGroup"><b>＋</b><span>Create group</span></div>');
    grid.innerHTML = html.join('');
    grid.onclick = function (event) {
      if (event.target.closest('#msxAddGroup')) return openGroupCreator();
      var card = event.target.closest('[data-group-id]');
      if (!card) return;
      var id = card.getAttribute('data-group-id');
      var g = groups().find(function (x) { return x.id === id; });
      if (g) openGroupChat(g);
    };
  }

  function openGroupCreator() {
    var modal = document.getElementById('msxGroupModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'msxGroupModal';
      modal.className = 'msx-group-modal';
      modal.innerHTML = [
        '<div class="msx-group-panel">',
          '<h3>New group</h3>',
          '<input type="text" id="msxGroupName" placeholder="Group name" maxlength="48">',
          '<div class="msx-group-members" id="msxGroupMembers"></div>',
          '<div style="display:flex;gap:8px;justify-content:flex-end">',
            '<button class="msx-tool-btn" type="button" id="msxGroupCancel">Cancel</button>',
            '<button class="msx-tool-btn primary" type="button" id="msxGroupCreate">Create</button>',
          '</div>',
        '</div>'
      ].join('');
      document.body.appendChild(modal);
      modal.addEventListener('click', function (e) { if (e.target === modal) modal.classList.remove('is-open'); });
      modal.querySelector('#msxGroupCancel').addEventListener('click', function () { modal.classList.remove('is-open'); });
      modal.querySelector('#msxGroupCreate').addEventListener('click', function () {
        var name = (modal.querySelector('#msxGroupName').value || '').trim();
        if (!name) name = 'Group ' + new Date().toLocaleTimeString();
        var members = Array.prototype.slice.call(modal.querySelectorAll('input[type="checkbox"]:checked')).map(function (c) { return c.value; });
        if (selfAddress()) members.unshift(selfAddress());
        var group = { id: uid('grp'), name: name, members: members, createdAt: Date.now(), updatedAt: Date.now(), createdBy: selfAddress() };
        var list = groups();
        list.unshift(group);
        writeJson(GROUPS_KEY, list);
        modal.classList.remove('is-open');
        renderGroupsGrid();
        // Notify members about the new group definition.
        broadcastToMembers(group.members, { kind: 'mesh-app', app: APP, type: 'group.create', group: group });
      });
    }
    var box = modal.querySelector('#msxGroupMembers');
    var list = contacts();
    if (!list.length) box.innerHTML = '<div class="msx-empty">No contacts yet. Save contacts first to add them to a group.</div>';
    else box.innerHTML = list.map(function (c) {
      return '<label><input type="checkbox" value="' + escapeHtml(c.address) + '"> ' + escapeHtml(c.nick || c.address) + '</label>';
    }).join('');
    modal.querySelector('#msxGroupName').value = '';
    modal.classList.add('is-open');
  }

  function groupMessages(groupId) { return readJson(GROUP_MSG_PREFIX + groupId, []); }
  function saveGroupMessages(groupId, list) { writeJson(GROUP_MSG_PREFIX + groupId, list.slice(-200)); }

  function openGroupChat(group) {
    var modal = document.getElementById('msxChatModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'msxChatModal';
      modal.className = 'msx-chat-modal';
      modal.innerHTML = [
        '<div class="msx-chat-panel">',
          '<div class="msx-chat-head"><div><strong id="msxChatTitle"></strong><br><span id="msxChatSub"></span></div><button type="button" id="msxChatClose">Close</button></div>',
          '<div class="msx-chat-log" id="msxChatLog"></div>',
          '<form class="msx-chat-foot" id="msxChatForm"><input type="text" id="msxChatInput" placeholder="Encrypted group message" maxlength="500" autocomplete="off"><button type="submit">Send</button></form>',
        '</div>'
      ].join('');
      document.body.appendChild(modal);
      modal.querySelector('#msxChatClose').addEventListener('click', function () { modal.classList.remove('is-open'); modal._group = null; });
      modal.querySelector('#msxChatForm').addEventListener('submit', function (e) {
        e.preventDefault();
        var input = modal.querySelector('#msxChatInput');
        var text = (input.value || '').trim();
        if (!text || !modal._group) return;
        var msg = { id: uid('m'), groupId: modal._group.id, from: selfAddress(), nick: selfNick(), text: text, ts: Date.now() };
        var list = groupMessages(modal._group.id);
        list.push(msg);
        saveGroupMessages(modal._group.id, list);
        input.value = '';
        renderChatLog(modal);
        broadcastToMembers(modal._group.members, { kind: 'mesh-app', app: APP, type: 'group.message', message: msg });
      });
    }
    modal._group = group;
    modal.querySelector('#msxChatTitle').textContent = group.name;
    modal.querySelector('#msxChatSub').textContent = (group.members || []).length + ' members · encrypted';
    renderChatLog(modal);
    modal.classList.add('is-open');
  }

  function renderChatLog(modal) {
    if (!modal || !modal._group) return;
    var log = modal.querySelector('#msxChatLog');
    var list = groupMessages(modal._group.id);
    var me = selfAddress();
    log.innerHTML = list.map(function (m) {
      var mine = m.from === me;
      return '<div class="msx-chat-msg ' + (mine ? 'is-mine' : 'is-peer') + '">' +
        (mine ? '' : '<span class="who">' + escapeHtml(m.nick || shortAddr(m.from)) + '</span>') +
        escapeHtml(m.text) + '</div>';
    }).join('') || '<div class="msx-empty">No messages yet. Be the first to say hi.</div>';
    log.scrollTop = log.scrollHeight;
  }

  function broadcastToMembers(members, payload) {
    var p = pavilion();
    if (!p) return;
    var me = selfAddress();
    (members || []).forEach(function (addr) {
      if (!addr || addr === me) return;
      // Best-effort: only the currently-connected peer will receive in real time.
      if (p.peerAddr && p.peerAddr === addr) {
        try {
          if (typeof p.sendAppPayloadReliable === 'function') {
            p.sendAppPayloadReliable(payload, { timeoutMs: 6000 }).catch(function () {});
          } else if (typeof p.sendAppPayload === 'function') {
            p.sendAppPayload(payload);
          }
        } catch (_) {}
      }
    });
    // Also send to whoever is connected right now (group hubs work peer-by-peer in MVP).
    try {
      if (p.peerAddr && typeof p.sendAppPayloadReliable === 'function') {
        p.sendAppPayloadReliable(payload, { timeoutMs: 6000 }).catch(function () {});
      }
    } catch (_) {}
  }

  // ---------- Incoming payloads ----------

  function handleIncoming(event) {
    var payload = event.detail && event.detail.payload;
    if (!payload || payload.kind !== 'mesh-app' || payload.app !== APP) return;
    if (payload.type === 'story.post' && payload.story) {
      event.preventDefault();
      var s = payload.story;
      s.expiresAt = Math.min(Number(s.expiresAt) || 0, Date.now() + STORY_TTL_MS);
      var list = stories();
      // Skip duplicates by id.
      if (!list.some(function (x) { return x.id === s.id; })) {
        list.unshift(s);
        writeJson(STORIES_KEY, list.slice(0, 120));
        renderStoriesBar();
      }
      return;
    }
    if (payload.type === 'group.create' && payload.group) {
      event.preventDefault();
      var g = payload.group;
      var list = groups();
      if (!list.some(function (x) { return x.id === g.id; })) {
        list.unshift(g);
        writeJson(GROUPS_KEY, list);
        renderGroupsGrid();
      }
      return;
    }
    if (payload.type === 'group.message' && payload.message) {
      event.preventDefault();
      var m = payload.message;
      if (!m.groupId) return;
      var msgs = groupMessages(m.groupId);
      if (!msgs.some(function (x) { return x.id === m.id; })) {
        msgs.push(m);
        saveGroupMessages(m.groupId, msgs);
        var modal = document.getElementById('msxChatModal');
        if (modal && modal._group && modal._group.id === m.groupId) renderChatLog(modal);
      }
      return;
    }
  }

  ready(function () {
    injectStyle();
    function tryWire() {
      var panel = document.getElementById('ostMeshUpgrade');
      if (panel) {
        ensureSections(panel);
        return true;
      }
      return false;
    }
    if (!tryWire()) {
      var attempts = 0;
      var iv = setInterval(function () {
        attempts++;
        if (tryWire() || attempts > 60) clearInterval(iv);
      }, 250);
    }
    window.addEventListener('ost:mesh-payload', handleIncoming);
    // Periodic 24h purge for stories (every 5 minutes).
    setInterval(function () {
      var before = stories().length;
      var after = purgeStories().length;
      if (before !== after) renderStoriesBar();
    }, 5 * 60 * 1000);

    // Re-render bars when Mesh opens (so FAB shows once mesh visible).
    document.addEventListener('click', function () {
      var fab = document.getElementById('ostMeshFab');
      if (!fab) return;
      var meshOpen = document.body.classList.contains('ost-mesh-scroll-lock');
      var stories = document.querySelector('[data-msx-section="stories"].is-active');
      fab.style.display = (meshOpen && stories) ? 'grid' : 'none';
    }, true);

    window.OST_MESH_STORIES = {
      open: openStoryEditor,
      list: stories,
      purge: purgeStories
    };
    window.OST_MESH_GROUPS = {
      list: groups,
      create: openGroupCreator,
      open: openGroupChat
    };
  });
})();

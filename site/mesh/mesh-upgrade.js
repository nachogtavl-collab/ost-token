/* OST Mesh UX upgrade companion: contacts, profiles, saved texts, notifications, and call state polish. */
(function () {
  'use strict';

  var APP = 'ost-mesh-social';
  var STYLE_ID = 'ost-mesh-upgrade-style';
  var PROFILE_KEY = 'ost.mesh.profile.v1';
  var CONTACTS_KEY = 'ost.mesh.contacts.v1';
  var SNIPPETS_KEY = 'ost.mesh.snippets.v1';

  function ready(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn, { once: true });
    else fn();
  }

  function pavilion() {
    return window.OST_MESH && window.OST_MESH.pavilion;
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
    return value.length > 18 ? value.slice(0, 9) + '...' + value.slice(-6) : value;
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

  function walletAddress() {
    try {
      var wallet = window.OST_WALLET;
      if (wallet && wallet.session && wallet.session.publicKey) {
        if (wallet.session.publicKey.toBase58) return wallet.session.publicKey.toBase58();
        return String(wallet.session.publicKey);
      }
      if (wallet && wallet.address) return String(wallet.address);
      if (window.OST_WALLET_PUBKEY) return String(window.OST_WALLET_PUBKEY);
    } catch (_) {}
    return '';
  }

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = [
      '.ost-mesh-upgrade{border:1px solid rgba(127,216,255,.16);border-radius:16px;background:linear-gradient(180deg,rgba(8,18,30,.78),rgba(3,10,18,.72));padding:12px;display:grid;gap:10px}',
      '.ost-mesh-upgrade *{box-sizing:border-box}',
      '.omu-grid{display:grid;grid-template-columns:1.1fr .9fr;gap:10px}@media(max-width:760px){.omu-grid{grid-template-columns:1fr}}',
      '.omu-card{border:1px solid rgba(255,255,255,.1);border-radius:14px;background:rgba(255,255,255,.045);padding:10px;display:grid;gap:8px;color:#dff8ff}',
      '.omu-card h3{margin:0;color:#fff;font-size:13px;letter-spacing:.04em;text-transform:uppercase}.omu-card p{margin:0;color:#8ebbd5;font-size:12px;line-height:1.4}',
      '.omu-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.omu-row input,.omu-row textarea{flex:1 1 160px;min-width:0;border:1px solid rgba(255,255,255,.14);border-radius:11px;background:#06141f;color:#d8eaff;padding:9px 10px;font:inherit;font-size:13px}.omu-row textarea{min-height:42px;resize:vertical}',
      '.omu-actions{display:grid;grid-template-columns:repeat(auto-fit,minmax(118px,1fr));gap:6px}.omu-actions button,.omu-contact button,.omu-snippet{border:1px solid rgba(255,255,255,.12);border-radius:10px;background:rgba(255,255,255,.07);color:#e8fbff;padding:8px 9px;font-weight:750;font-size:12px;cursor:pointer;min-height:42px;white-space:normal;line-height:1.15}.omu-actions button.primary{background:linear-gradient(135deg,#00d4ff,#00ff9f);border-color:transparent;color:#03131c}',
      '.omu-list{display:grid;gap:7px;max-height:138px;overflow:auto}.omu-contact{display:grid;grid-template-columns:1fr auto;gap:8px;align-items:center;border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:8px;background:rgba(0,0,0,.16)}.omu-contact strong{display:block;color:#fff;font-size:12px}.omu-contact span{display:block;color:#8ebbd5;font-family:ui-monospace,Menlo,monospace;font-size:11px}',
      '.omu-snippets{display:grid;grid-template-columns:repeat(auto-fit,minmax(118px,1fr));gap:6px}.omu-snippet{max-width:100%;overflow:hidden;text-overflow:ellipsis}',
      '.ost-mesh-callbar.is-ringing{animation:omu-ring 1s ease-in-out infinite;border-color:rgba(251,191,36,.55);box-shadow:0 0 24px rgba(251,191,36,.12)}.ost-mesh-callbar.is-live{border-color:rgba(52,211,153,.45);box-shadow:0 0 28px rgba(52,211,153,.12)}',
      '#ost-mesh-pavilion.ost-mesh-ringing .ost-mesh-shell{box-shadow:inset 0 0 0 1px rgba(251,191,36,.24)}#ost-mesh-pavilion.ost-mesh-in-call .ost-mesh-video-grid.is-on video{box-shadow:0 0 0 1px rgba(94,234,212,.28),0 18px 48px rgba(0,0,0,.38)}',
      '.omu-profile-card{display:grid;gap:8px}.omu-profile-card strong{color:#fff}.omu-profile-card code{color:#9fffd0;word-break:break-all}',
      '@media(max-width:520px){.omu-contact{grid-template-columns:1fr}.omu-contact button{width:100%}.omu-actions,.omu-snippets{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:360px){.omu-actions,.omu-snippets{grid-template-columns:1fr}}',
      '@keyframes omu-ring{0%,100%{transform:translateY(0)}50%{transform:translateY(-1px)}}'
    ].join('\n');
    document.head.appendChild(style);
  }

  function defaultProfile(p) {
    var saved = readJson(PROFILE_KEY, {}) || {};
    return {
      nickname: saved.nickname || ('Mesh ' + String((p && p.address) || '').slice(-4)),
      status: saved.status || 'Available on OST Mesh',
      bio: saved.bio || '',
      wallet: walletAddress(),
      address: p && p.address || '',
      updatedAt: Date.now()
    };
  }

  function mountPanel(p) {
    if (!p || !p.root || document.getElementById('ostMeshUpgrade')) return;
    injectStyle();
    var profile = defaultProfile(p);
    var panel = document.createElement('div');
    panel.id = 'ostMeshUpgrade';
    panel.className = 'ost-mesh-upgrade';
    panel.innerHTML = [
      '<div class="omu-grid">',
        '<div class="omu-card">',
          '<h3>Profile</h3>',
          '<div class="omu-row"><input id="omuNick" maxlength="32" placeholder="Nickname" value="' + escapeHtml(profile.nickname) + '"><input id="omuStatus" maxlength="64" placeholder="Status" value="' + escapeHtml(profile.status) + '"></div>',
          '<div class="omu-row"><textarea id="omuBio" maxlength="180" placeholder="Profile note">' + escapeHtml(profile.bio) + '</textarea></div>',
          '<div class="omu-actions"><button class="primary" type="button" id="omuSaveProfile">Save profile</button><button type="button" id="omuPostProfile">Post to peer</button><button type="button" id="omuNotify">Notifications</button></div>',
        '</div>',
        '<div class="omu-card">',
          '<h3>Contacts</h3>',
          '<div class="omu-actions"><button class="primary" type="button" id="omuAddContact">Save current peer</button><button type="button" id="omuCopyInvite">Copy invite</button></div>',
          '<div class="omu-list" id="omuContactList"></div>',
        '</div>',
      '</div>',
      '<div class="omu-card">',
        '<h3>Saved texts</h3>',
        '<div class="omu-actions"><button class="primary" type="button" id="omuSaveText">Save typed text</button><button type="button" id="omuClearTexts">Clear saved</button></div>',
        '<div class="omu-snippets" id="omuSnippets"></div>',
      '</div>'
    ].join('');
    var stage = p.root.querySelector('.ost-mesh-stage');
    if (stage && stage.parentNode) stage.parentNode.insertBefore(panel, stage.nextSibling);
    else p.root.querySelector('.ost-mesh-shell').appendChild(panel);
    bindPanel(p, panel);
    renderContacts(p);
    renderSnippets(p);
    window.setInterval(function () { renderContacts(p); }, 5000);
  }

  function bindPanel(p, panel) {
    panel.querySelector('#omuSaveProfile').addEventListener('click', function () {
      var profile = collectProfile(p);
      writeJson(PROFILE_KEY, profile);
      setStatus(p, 'Profile saved on this device.', 'ok');
      renderContacts(p);
    });
    panel.querySelector('#omuPostProfile').addEventListener('click', function () { postProfile(p); });
    panel.querySelector('#omuNotify').addEventListener('click', requestNotifications);
    panel.querySelector('#omuAddContact').addEventListener('click', function () { saveCurrentPeer(p); });
    panel.querySelector('#omuCopyInvite').addEventListener('click', function () { if (p._copyInvite) p._copyInvite(); });
    panel.querySelector('#omuSaveText').addEventListener('click', function () { saveTypedText(p); });
    panel.querySelector('#omuClearTexts').addEventListener('click', function () { writeJson(SNIPPETS_KEY, []); renderSnippets(p); });
  }

  function collectProfile(p) {
    return {
      nickname: valueOf('omuNick') || ('Mesh ' + String((p && p.address) || '').slice(-4)),
      status: valueOf('omuStatus') || 'Available on OST Mesh',
      bio: valueOf('omuBio'),
      wallet: walletAddress(),
      address: p && p.address || '',
      updatedAt: Date.now()
    };
  }

  function valueOf(id) {
    var el = document.getElementById(id);
    return el ? String(el.value || '').trim() : '';
  }

  function setStatus(p, text, kind) {
    if (p && p._setStatus) p._setStatus(text, kind || '');
  }

  async function postProfile(p) {
    var profile = collectProfile(p);
    writeJson(PROFILE_KEY, profile);
    if (!p || !p.sessionKey || typeof p.sendAppPayload !== 'function') return setStatus(p, 'Connect to a peer before posting your profile.', 'warn');
    try {
      await p.sendAppPayload({ app: APP, v: 1, type: 'profile.card', profile: profile });
      renderProfileCard(p, profile, 'me');
      setStatus(p, 'Profile posted to peer.', 'ok');
    } catch (err) { setStatus(p, err.message, 'err'); }
  }

  function renderProfileCard(p, profile, role) {
    if (!p || !p._bubble) return;
    var card = document.createElement('div');
    card.className = 'omu-profile-card';
    card.innerHTML = '<strong>' + escapeHtml(profile.nickname || 'Mesh profile') + '</strong><span>' + escapeHtml(profile.status || '') + '</span><p>' + escapeHtml(profile.bio || '') + '</p><code>' + escapeHtml(profile.wallet || profile.address || '') + '</code>';
    p._bubble(role, card);
    if (role === 'peer') saveContact({ address: profile.address, nick: profile.nickname, wallet: profile.wallet, note: profile.status });
  }

  function saveCurrentPeer(p) {
    if (!p || !p.peerAddr) return setStatus(p, 'Connect to a peer before saving a contact.', 'warn');
    var nick = short(p.peerAddr);
    saveContact({ address: p.peerAddr, nick: nick || short(p.peerAddr), wallet: '', note: 'Saved from OST Mesh' });
    renderContacts(p);
    setStatus(p, 'Contact saved.', 'ok');
  }

  function saveContact(contact) {
    if (!contact || !contact.address) return;
    var list = readJson(CONTACTS_KEY, []);
    if (!Array.isArray(list)) list = [];
    var found = list.find(function (item) { return item.address === contact.address; });
    if (found) Object.assign(found, contact, { updatedAt: Date.now() });
    else list.unshift(Object.assign({ updatedAt: Date.now() }, contact));
    writeJson(CONTACTS_KEY, list.slice(0, 80));
  }

  function renderContacts(p) {
    var box = document.getElementById('omuContactList');
    if (!box) return;
    var list = readJson(CONTACTS_KEY, []);
    if (!Array.isArray(list) || !list.length) {
      box.innerHTML = '<p>No saved contacts yet.</p>';
      return;
    }
    box.innerHTML = list.map(function (contact, index) {
      return '<div class="omu-contact"><div><strong>' + escapeHtml(contact.nick || short(contact.address)) + '</strong><span>' + escapeHtml(short(contact.address)) + '</span></div><button type="button" data-omu-contact="' + index + '">Load</button></div>';
    }).join('');
    box.querySelectorAll('[data-omu-contact]').forEach(function (button) {
      button.addEventListener('click', function () {
        var contact = list[Number(button.dataset.omuContact)];
        if (!contact) return;
        p.peerInput.value = contact.address;
        p.open();
        if (p.peerInput && typeof p.peerInput.focus === 'function') {
          try { p.peerInput.focus({ preventScroll: true }); }
          catch (_) { p.peerInput.focus(); }
        }
        var row = p.root && p.root.querySelector('.ost-mesh-row');
        if (row && typeof row.scrollIntoView === 'function') row.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setStatus(p, 'Contact loaded in the peer address field. Press Connect securely when they are online.', 'ok');
      });
    });
  }

  function saveTypedText(p) {
    var text = p && p.textInput ? String(p.textInput.value || '').trim() : '';
    if (!text) return setStatus(p, 'Type a message before saving it.', 'warn');
    var list = readJson(SNIPPETS_KEY, []);
    if (!Array.isArray(list)) list = [];
    list.unshift({ text: text, ts: Date.now() });
    writeJson(SNIPPETS_KEY, list.slice(0, 24));
    renderSnippets(p);
    setStatus(p, 'Text saved.', 'ok');
  }

  function renderSnippets(p) {
    var box = document.getElementById('omuSnippets');
    if (!box) return;
    var list = readJson(SNIPPETS_KEY, []);
    if (!Array.isArray(list) || !list.length) {
      box.innerHTML = '<p>No saved texts yet.</p>';
      return;
    }
    box.innerHTML = list.map(function (item, index) {
      return '<button class="omu-snippet" type="button" data-omu-snippet="' + index + '">' + escapeHtml(item.text.slice(0, 80)) + '</button>';
    }).join('');
    box.querySelectorAll('[data-omu-snippet]').forEach(function (button) {
      button.addEventListener('click', function () {
        var item = list[Number(button.dataset.omuSnippet)];
        if (item && p && p.textInput) {
          p.textInput.value = item.text;
          p.textInput.focus();
        }
      });
    });
  }

  function requestNotifications() {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'default') Notification.requestPermission().catch(function () {});
  }

  function notify(title, body, tag) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    try {
      var note = new Notification(title, { body: body, tag: tag || 'ost-mesh', renotify: true });
      note.onclick = function () {
        try { window.focus(); } catch (_) {}
        var p = pavilion();
        if (p && p.open) p.open();
        note.close();
      };
    } catch (_) {}
  }

  function patchCalls(p) {
    if (!p || p.__meshUpgradePatched) return;
    p.__meshUpgradePatched = true;
    var showIncoming = p._showIncomingCall && p._showIncomingCall.bind(p);
    var markConnected = p._markCallConnected && p._markCallConnected.bind(p);
    var resetCall = p._resetCallState && p._resetCallState.bind(p);
    var setControls = p._setCallControls && p._setCallControls.bind(p);

    if (showIncoming) p._showIncomingCall = function (detail) {
      setCallClasses(p, 'ringing');
      notify('Incoming OST Mesh call', (detail && detail.video ? 'Video' : 'Voice') + ' call from ' + ((detail && detail.from) || 'peer'), 'ost-mesh-call');
      return showIncoming(detail);
    };
    if (markConnected) p._markCallConnected = function (video) {
      setCallClasses(p, 'in-call');
      return markConnected(video);
    };
    if (resetCall) p._resetCallState = function () {
      setCallClasses(p, 'idle');
      return resetCall();
    };
    if (setControls) p._setCallControls = function (mode, incomingVideo) {
      setCallClasses(p, mode);
      return setControls(mode, incomingVideo);
    };
  }

  function setCallClasses(p, mode) {
    if (!p || !p.root) return;
    p.root.classList.toggle('ost-mesh-ringing', mode === 'ringing' || mode === 'calling' || mode === 'answering');
    p.root.classList.toggle('ost-mesh-in-call', mode === 'in-call');
    if (p.callBar) {
      p.callBar.classList.toggle('is-ringing', mode === 'ringing' || mode === 'calling' || mode === 'answering');
      p.callBar.classList.toggle('is-live', mode === 'in-call');
    }
  }

  function bindPayloads() {
    window.addEventListener('ost:mesh-payload', function (event) {
      var payload = event.detail && event.detail.payload;
      var p = event.detail && event.detail.pavilion || pavilion();
      if (!payload) return;
      if (payload.kind === 'text') {
        notify('OST Mesh message', String(payload.text || '').slice(0, 120), 'ost-mesh-message');
        return;
      }
      if (payload.kind !== 'mesh-app' || payload.app !== APP) return;
      if (payload.type === 'profile.card') {
        event.preventDefault();
        renderProfileCard(p, payload.profile || {}, 'peer');
        notify('OST Mesh profile', ((payload.profile && payload.profile.nickname) || 'Peer') + ' shared a profile', 'ost-mesh-profile');
      }
    });
  }

  ready(function () {
    bindPayloads();
    waitForMesh(function (p) {
      mountPanel(p);
      patchCalls(p);
    });
  });
})();

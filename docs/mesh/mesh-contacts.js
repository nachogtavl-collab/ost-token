/* OST Mesh — CONTACT CORE (friends without P2P).
 *
 * The hub keeps the friend graph in Durable Object storage, so two people can find
 * and accept each other even when they are never online at the same time and even
 * when KV / the directory cache is exhausted. This module is the client side:
 *
 *   · every request is SIGNED with this device's own mesh key (ECDSA P-384) — the
 *     hub refuses anything else, so nobody can accept/block/read as you;
 *   · a Friends panel in the phone mesh's Chats tab: add by address, incoming
 *     requests (Accept / Decline / Block), friends (tap to open the chat), blocked;
 *   · NO polling. It loads when the Chats tab is opened and after each action.
 *
 * Failure is said plainly (no invented lists): if the hub can't be reached the panel
 * says so and offers Retry.
 */
(function () {
  'use strict';
  if (window.OST_CONTACTS) return;
  var API = (window.OST_API_BASE || 'https://ost-api.nachogtavl.workers.dev').replace(/\/+$/, '');
  var state = { data: null, error: '', note: '', loading: false, loadedAt: 0 };

  function pav() { return (window.OST_MESH && window.OST_MESH.pavilion) || null; }
  function myAddr() { var p = pav(); return (p && p.address) || ''; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function validAddr(a) { return typeof a === 'string' && a.length <= 80 && /^ost-mesh:[0-9a-f]{2,}(?:-[0-9a-f]{1,4})*$/i.test(a); }
  function shortA(a) { a = String(a || ''); return a.length > 22 ? a.slice(0, 14) + '…' + a.slice(-4) : a; }
  function hex(buf) { return Array.prototype.map.call(new Uint8Array(buf), function (b) { return b.toString(16).padStart(2, '0'); }).join(''); }
  function b64(buf) { var s = '', u = new Uint8Array(buf); for (var i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s); }

  // OST-MESH|v1|<addr>|<METHOD>|<path+query>|<sha256hex(body)>|<ts>|<nonce>
  function signedFetch(method, pathq, bodyObj) {
    var p = pav();
    if (!p || !p.identity || !p.identity.sig || !p.identity.sig.privateKey || !p.address) {
      return Promise.reject(new Error('Your mesh identity is still loading — try again in a moment.'));
    }
    var bodyText = bodyObj ? JSON.stringify(bodyObj) : '';
    var ts = Date.now(), nonce = hex(crypto.getRandomValues(new Uint8Array(12)));
    var enc = new TextEncoder();
    return crypto.subtle.digest('SHA-256', enc.encode(bodyText)).then(function (d) {
      var msg = 'OST-MESH|v1|' + p.address + '|' + method + '|' + pathq + '|' + hex(d) + '|' + ts + '|' + nonce;
      return crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-384' }, p.identity.sig.privateKey, enc.encode(msg));
    }).then(function (sig) {
      var headers = { 'x-mesh-addr': p.address, 'x-mesh-ts': String(ts), 'x-mesh-nonce': nonce, 'x-mesh-sig': b64(sig) };
      if (bodyText) headers['Content-Type'] = 'application/json';
      return fetch(API + pathq, { method: method, headers: headers, body: bodyText || undefined, cache: 'no-store' });
    }).then(function (r) {
      return r.json().catch(function () { return null; }).then(function (j) {
        if (r.ok && j && j.ok !== false) return j;
        var code = (j && j.error) || ('http_' + r.status);
        // The hub only knows keys that were announced. Announce once, then the caller may retry.
        if (code === 'mesh_identity_unknown' && p._announce) { try { Promise.resolve(p._announce()).catch(function () {}); } catch (_) {} }
        var e = new Error(explain(code)); e.code = code; throw e;
      });
    });
  }
  function explain(code) {
    if (code === 'mesh_identity_unknown') return 'Registering your mesh identity — tap Retry in a few seconds.';
    if (code === 'mesh_auth_stale') return 'Your device clock looks wrong — fix the time and retry.';
    if (/^mesh_auth/.test(code)) return 'The hub could not verify this device (' + code + ').';
    if (/^http_5|directory_unavailable/.test(code)) return 'The mesh hub is unavailable right now.';
    if (code === 'http_429' || /1027|daily/.test(code)) return 'The network is at its daily limit — try again later.';
    return 'Could not complete that (' + code + ').';
  }

  function load(force) {
    if (state.loading) return Promise.resolve(state.data);
    if (!force && state.data && Date.now() - state.loadedAt < 20000) return Promise.resolve(state.data);
    var me = myAddr(); if (!me) { state.error = 'Open the mesh to load your identity.'; render(); return Promise.resolve(null); }
    state.loading = true; render();
    return signedFetch('GET', '/mesh/v1/friend/list?wallet=' + encodeURIComponent(me)).then(function (j) {
      state.data = j; state.error = ''; state.loadedAt = Date.now();
    }).catch(function (e) { state.error = (e && e.message) || 'Could not load contacts.'; })
      .then(function () { state.loading = false; render(); badge(); return state.data; });
  }
  function request(addr) {
    addr = String(addr || '').trim();
    if (!validAddr(addr)) return Promise.reject(new Error('That is not a mesh address (it starts with ost-mesh:).'));
    if (addr === myAddr()) return Promise.reject(new Error('That is your own address.'));
    return signedFetch('POST', '/mesh/v1/friend/request', { from: myAddr(), to: addr }).then(function (j) { return load(true).then(function () { return j; }); });
  }
  function respond(addr, action) {
    return signedFetch('POST', '/mesh/v1/friend/respond', { wallet: myAddr(), other: addr, action: action }).then(function (j) { return load(true).then(function () { return j; }); });
  }

  /* ---- UI --------------------------------------------------------------- */
  function styles() {
    if (document.getElementById('omcStyle')) return;
    var st = document.createElement('style'); st.id = 'omcStyle';
    st.textContent = [
      '.omc-box{margin:0 0 14px;padding:14px;border-radius:16px;background:rgba(10,18,32,.9);border:1px solid rgba(0,255,176,.18)}',
      '.omc-h{display:flex;align-items:center;gap:8px;font-weight:800;font-size:14px;color:#dff7ee;margin:0 0 10px;padding-right:56px}',   /* clear of the pavilion close button */
      '.omc-h .n{margin-left:auto;font-size:11px;font-weight:700;color:#7fa8c4}',
      '.omc-add{display:flex;gap:8px;margin:0 0 10px}',
      '.omc-add input{flex:1 1 0;min-width:0;height:44px;border-radius:12px;border:1px solid rgba(127,168,196,.3);background:#060c18;color:#e8f4ff;padding:0 12px;font-size:14px}',
      '.omc-btn{height:44px;padding:0 14px;border-radius:12px;border:1px solid rgba(0,255,176,.4);background:rgba(0,255,176,.12);color:#00ffb0;font-weight:800;font-size:13px;white-space:nowrap;overflow-wrap:normal;flex:0 0 auto}',
      '.omc-btn.ghost{border-color:rgba(127,168,196,.35);background:transparent;color:#9fb9cc}',
      '.omc-btn.warn{border-color:rgba(251,113,133,.45);background:rgba(251,113,133,.1);color:#fb7185}',
      '.omc-btn:disabled{opacity:.5}',
      '.omc-sub{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#7fa8c4;margin:12px 0 6px}',
      '.omc-row{display:flex;align-items:center;gap:8px;padding:8px 0;border-top:1px solid rgba(127,168,196,.12)}',
      '.omc-row .a{flex:1 1 0;min-width:0;font-family:ui-monospace,monospace;font-size:12.5px;color:#e8f4ff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;overflow-wrap:normal}',
      '.omc-row .acts{display:flex;gap:6px;flex:0 0 auto}',
      '.omc-row .omc-btn{height:36px;padding:0 10px;font-size:12px}',
      '.omc-note{font-size:12.5px;color:#9fb9cc;line-height:1.45}',
      '.omc-err{font-size:12.5px;color:#fbbf24;line-height:1.45;margin:0 0 8px}',
      '.omc-dot{display:inline-block;min-width:18px;height:18px;line-height:18px;padding:0 5px;border-radius:9px;background:#fb7185;color:#fff;font-size:11px;font-weight:800;text-align:center}'
    ].join('');
    document.head.appendChild(st);
  }
  function host() {
    var sec = document.querySelector('[data-mesh-view="chats"]'); if (!sec) return null;
    var box = document.getElementById('omcBox');
    if (!box) { styles(); box = document.createElement('div'); box.id = 'omcBox'; box.className = 'omc-box'; sec.insertBefore(box, sec.firstChild); }
    return box;
  }
  function row(addr, buttons) {
    return '<div class="omc-row"><span class="a" title="' + esc(addr) + '">' + esc(shortA(addr)) + '</span><span class="acts">' + buttons.map(function (b) {
      return '<button class="omc-btn ' + (b.cls || '') + '" data-act="' + b.act + '" data-addr="' + esc(addr) + '">' + esc(b.label) + '</button>';
    }).join('') + '</span></div>';
  }
  function render() {
    var box = host(); if (!box) return;
    var d = state.data, html = '';
    var inN = d ? d.pendingIn.length : 0;
    html += '<div class="omc-h">&#129309; Friends' + (inN ? ' <span class="omc-dot">' + inN + '</span>' : '') + '<span class="n">' + (d ? d.friends.length + ' friend' + (d.friends.length === 1 ? '' : 's') : '') + '</span></div>';
    html += '<div class="omc-add"><input id="omcAddr" placeholder="Paste a friend’s ost-mesh: address" autocomplete="off" autocapitalize="off" spellcheck="false"><button class="omc-btn" id="omcAddBtn">Add</button></div>';
    if (state.error) html += '<div class="omc-err">' + esc(state.error) + ' <button class="omc-btn ghost" data-act="retry" style="height:30px;padding:0 10px;font-size:12px;margin-left:6px">Retry</button></div>';
    if (state.note) html += '<div class="omc-note" style="color:#00ffb0;margin:0 0 8px">' + esc(state.note) + '</div>';
    if (!d) html += '<div class="omc-note">' + (state.loading ? 'Loading your contacts…' : (state.error ? '' : 'Your friends list lives on the mesh hub, so it works even when the other person is offline.')) + '</div>';
    else {
      if (d.pendingIn.length) html += '<div class="omc-sub">Wants to be your friend</div>' + d.pendingIn.map(function (x) { return row(x.addr, [{ act: 'accept', label: 'Accept' }, { act: 'decline', label: 'Decline', cls: 'ghost' }, { act: 'block', label: 'Block', cls: 'warn' }]); }).join('');
      if (d.friends.length) html += '<div class="omc-sub">Friends</div>' + d.friends.map(function (x) { return row(x.addr, [{ act: 'chat', label: 'Chat' }, { act: 'remove', label: 'Remove', cls: 'ghost' }]); }).join('');
      if (d.pendingOut.length) html += '<div class="omc-sub">Requests you sent</div>' + d.pendingOut.map(function (x) { return row(x.addr, [{ act: 'remove', label: 'Cancel', cls: 'ghost' }]); }).join('');
      if (d.blocked.length) html += '<div class="omc-sub">Blocked</div>' + d.blocked.map(function (x) { return row(x.addr, [{ act: 'unblock', label: 'Unblock', cls: 'ghost' }]); }).join('');
      if (!d.pendingIn.length && !d.friends.length && !d.pendingOut.length && !d.blocked.length) html += '<div class="omc-note">No friends yet. Paste someone’s mesh address above — they can accept later, even if you are offline by then.</div>';
    }
    var keep = (document.getElementById('omcAddr') || {}).value || '';
    box.innerHTML = html;
    var inp = document.getElementById('omcAddr'); if (inp && keep) inp.value = keep;
  }
  function badge() {
    var tab = document.querySelector('.omm-tab[data-view="chats"]'); if (!tab) return;
    var n = state.data ? state.data.pendingIn.length : 0, dot = tab.querySelector('.omc-dot');
    if (!n) { if (dot) dot.remove(); return; }
    if (!dot) { dot = document.createElement('span'); dot.className = 'omc-dot'; dot.style.cssText = 'position:absolute;top:2px;right:22%'; tab.appendChild(dot); }
    dot.textContent = String(n);
  }
  function say(msg) { state.note = msg; render(); setTimeout(function () { if (state.note === msg) { state.note = ''; render(); } }, 5000); }

  document.addEventListener('click', function (e) {
    var t = e.target && e.target.closest ? e.target.closest('#omcAddBtn, #omcBox [data-act], .omm-tab[data-view="chats"]') : null;
    if (!t) return;
    if (t.classList.contains('omm-tab')) { setTimeout(function () { render(); load(false); }, 120); return; }
    if (t.id === 'omcAddBtn') {
      var inp = document.getElementById('omcAddr'), v = inp ? inp.value.trim() : '';
      t.disabled = true;
      request(v).then(function (j) { if (inp) inp.value = ''; state.error = ''; say(j && j.state === 'accepted' ? 'You are already friends.' : 'Friend request sent.'); })
        .catch(function (err) { state.error = (err && err.message) || 'Could not send the request.'; render(); })
        .then(function () { var b = document.getElementById('omcAddBtn'); if (b) b.disabled = false; });
      return;
    }
    var act = t.getAttribute('data-act'), addr = t.getAttribute('data-addr');
    if (act === 'retry') { load(true); return; }
    if (act === 'chat') {
      var peer = document.getElementById('mesh-peer-addr'); if (peer) { peer.value = addr; peer.dispatchEvent(new Event('input', { bubbles: true })); }
      try { var p = pav(); if (p && p._replayChatHistory) p._replayChatHistory(addr); } catch (_) {}
      var sess = document.querySelector('#ost-mesh-pavilion .ost-mesh-session'); if (sess) sess.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    if (act === 'block' && !window.confirm('Block this address? They will not be able to message or add you.')) return;
    t.disabled = true;
    respond(addr, act).catch(function (err) { state.error = (err && err.message) || 'That did not go through.'; render(); });
  });

  window.OST_CONTACTS = { load: load, request: request, respond: respond, list: function () { return state.data; }, signedFetch: signedFetch };
  // First paint once the mesh (and its identity) exists; the list itself loads when Chats opens.
  function first() { setTimeout(function () { if (host()) { render(); load(false); } }, 1800); }
  if (window.OST_MESH) first(); else window.addEventListener('mesh:ready', first, { once: true });
})();

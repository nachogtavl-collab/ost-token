/* ============================================================
   mesh/mesh.js — OST Mesh Pavilion bootstrap
   Quantum-resistant-ready P2P: text, media, location, voice, video.
   Discovery via OST worker signaling (KV inbox), transport via WebRTC.
   ============================================================ */

import {
  generateIdentity, exportPublicBundle, importPeerBundle,
  deriveSessionKey, sealPayload, openPayload,
  sealBytes, openBytes, fingerprint
} from './mesh-crypto.js?v=1';
import { MeshRTC } from './mesh-rtc.js?v=1';

const STYLE_HREF = './mesh/mesh.css?v=1';
const STORAGE_ID = 'ost_mesh_identity_v1';
const STORAGE_ADDR = 'ost_mesh_addr_v1';

function injectStyles() {
  if (document.getElementById('ost-mesh-style')) return;
  const link = document.createElement('link');
  link.id = 'ost-mesh-style';
  link.rel = 'stylesheet';
  link.href = STYLE_HREF;
  document.head.appendChild(link);
}

function buildDOM() {
  if (document.getElementById('ost-mesh-pavilion')) return;
  const trigger = document.createElement('button');
  trigger.id = 'ost-mesh-trigger';
  trigger.type = 'button';
  trigger.title = 'OST Mesh — quantum-ready P2P';
  trigger.setAttribute('aria-label', 'Open OST Mesh');
  document.body.appendChild(trigger);

  const root = document.createElement('div');
  root.id = 'ost-mesh-pavilion';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.innerHTML = `
    <div class="ost-mesh-shell">
      <div class="ost-mesh-head">
        <div>
          <h2>OST Mesh</h2>
          <div class="sub">Quantum-ready · End-to-end · Peer-to-peer</div>
        </div>
        <button class="ost-mesh-close" aria-label="Close">×</button>
      </div>

      <div class="ost-mesh-id">
        <div>
          <div class="sub">Your mesh address</div>
          <span class="pill" id="mesh-my-addr">…</span>
        </div>
        <div>
          <div class="sub">Public bundle fingerprint</div>
          <span class="pill" id="mesh-my-fpr">…</span>
        </div>
        <div style="display:flex; gap:6px;">
          <button id="mesh-copy-addr">Copy</button>
          <button id="mesh-rotate-id">Rotate keys</button>
        </div>
      </div>

      <div class="ost-mesh-row">
        <input id="mesh-peer-addr" type="text" placeholder="Peer mesh address (ost-mesh:abcd-1234…)" />
        <button id="mesh-connect">Connect securely</button>
        <button id="mesh-listen" class="ghost">Wait for incoming</button>
      </div>

      <div class="ost-mesh-status" id="mesh-status">Idle.</div>

      <div class="ost-mesh-stage">
        <div class="ost-mesh-video-grid" id="mesh-video">
          <video id="mesh-local-video" autoplay muted playsinline></video>
          <video id="mesh-remote-video" autoplay playsinline></video>
        </div>
        <div class="ost-mesh-feed" id="mesh-feed"></div>
        <div class="ost-mesh-compose">
          <input id="mesh-text" type="text" placeholder="Encrypted message…" disabled />
          <button id="mesh-send" disabled>Send</button>
        </div>
        <div class="ost-mesh-tools">
          <input type="file" id="mesh-file" accept="image/*,video/*" hidden />
          <button id="mesh-attach" disabled>📎 Photo / Video</button>
          <button id="mesh-loc" disabled>📍 Location</button>
          <button id="mesh-live" disabled>🛰 Live location</button>
          <button id="mesh-voice" disabled>📞 Voice</button>
          <button id="mesh-video-call" disabled>📹 Video</button>
          <button id="mesh-hangup" class="ghost" disabled>⛔ Hang up</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(root);
}

async function loadOrCreateIdentity() {
  // ECDH/ECDSA private keys are non-extractable in spec when generated
  // non-extractable; here we keep them extractable so we can persist.
  // For higher security, drop persistence and regenerate per session.
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(STORAGE_ID) || 'null'); } catch {}
  if (saved && saved.kex && saved.sig) {
    try {
      const kexPriv = await crypto.subtle.importKey('jwk', saved.kex.priv,
        { name: 'ECDH', namedCurve: 'P-384' }, true, ['deriveKey', 'deriveBits']);
      const kexPub  = await crypto.subtle.importKey('jwk', saved.kex.pub,
        { name: 'ECDH', namedCurve: 'P-384' }, true, []);
      const sigPriv = await crypto.subtle.importKey('jwk', saved.sig.priv,
        { name: 'ECDSA', namedCurve: 'P-384' }, true, ['sign']);
      const sigPub  = await crypto.subtle.importKey('jwk', saved.sig.pub,
        { name: 'ECDSA', namedCurve: 'P-384' }, true, ['verify']);
      return {
        kex: { privateKey: kexPriv, publicKey: kexPub },
        sig: { privateKey: sigPriv, publicKey: sigPub }
      };
    } catch {}
  }
  const id = await generateIdentity();
  const kexPriv = await crypto.subtle.exportKey('jwk', id.kex.privateKey);
  const kexPub  = await crypto.subtle.exportKey('jwk', id.kex.publicKey);
  const sigPriv = await crypto.subtle.exportKey('jwk', id.sig.privateKey);
  const sigPub  = await crypto.subtle.exportKey('jwk', id.sig.publicKey);
  try {
    localStorage.setItem(STORAGE_ID, JSON.stringify({
      kex: { priv: kexPriv, pub: kexPub },
      sig: { priv: sigPriv, pub: sigPub }
    }));
  } catch {}
  return id;
}

function getOrCreateAddress() {
  let a = null;
  try { a = localStorage.getItem(STORAGE_ADDR); } catch {}
  if (a) return a;
  const rnd = crypto.getRandomValues(new Uint8Array(8));
  const hex = Array.from(rnd).map((b) => b.toString(16).padStart(2, '0')).join('');
  a = 'ost-mesh:' + hex.match(/.{1,4}/g).join('-');
  try { localStorage.setItem(STORAGE_ADDR, a); } catch {}
  return a;
}

function apiBase() {
  if (window.OST_API_BASE) return window.OST_API_BASE;
  if (location.hostname.endsWith('github.io')) return 'https://ost-api.nachogtavl.workers.dev';
  return '';
}

class MeshPavilion {
  constructor() {
    injectStyles();
    buildDOM();

    this.root      = document.getElementById('ost-mesh-pavilion');
    this.trigger   = document.getElementById('ost-mesh-trigger');
    this.closeBtn  = this.root.querySelector('.ost-mesh-close');
    this.addrEl    = document.getElementById('mesh-my-addr');
    this.fprEl     = document.getElementById('mesh-my-fpr');
    this.peerInput = document.getElementById('mesh-peer-addr');
    this.connectBtn= document.getElementById('mesh-connect');
    this.listenBtn = document.getElementById('mesh-listen');
    this.statusEl  = document.getElementById('mesh-status');
    this.feedEl    = document.getElementById('mesh-feed');
    this.textInput = document.getElementById('mesh-text');
    this.sendBtn   = document.getElementById('mesh-send');
    this.fileInput = document.getElementById('mesh-file');
    this.attachBtn = document.getElementById('mesh-attach');
    this.locBtn    = document.getElementById('mesh-loc');
    this.liveBtn   = document.getElementById('mesh-live');
    this.voiceBtn  = document.getElementById('mesh-voice');
    this.videoBtn  = document.getElementById('mesh-video-call');
    this.hangBtn   = document.getElementById('mesh-hangup');
    this.videoGrid = document.getElementById('mesh-video');
    this.localVid  = document.getElementById('mesh-local-video');
    this.remoteVid = document.getElementById('mesh-remote-video');

    this.api = apiBase();
    this.identity = null;
    this.address = getOrCreateAddress();
    this.peerBundle = null;
    this.sessionKey = null;
    this.rtc = null;
    this.peerAddr = null;
    this.liveLocTimer = null;

    this._wire();
    this._initIdentity().catch((err) => this._setStatus('Identity error: ' + err.message, 'err'));
  }

  async _initIdentity() {
    this.identity = await loadOrCreateIdentity();
    const bundle = await exportPublicBundle(this.identity);
    this.publicBundle = bundle;
    this.fpr = await fingerprint(bundle);
    this.addrEl.textContent = this.address;
    this.fprEl.textContent = this.fpr;
    // Announce ourselves so peers can fetch our public bundle
    this._announce().catch(() => {});
  }

  _wire() {
    this.trigger.addEventListener('click', () => this.open());
    this.closeBtn.addEventListener('click', () => this.close());
    document.getElementById('mesh-copy-addr').addEventListener('click', () => {
      navigator.clipboard?.writeText(this.address).then(
        () => this._setStatus('Address copied.', 'ok'),
        () => this._setStatus('Copy blocked.', 'warn')
      );
    });
    document.getElementById('mesh-rotate-id').addEventListener('click', async () => {
      try { localStorage.removeItem(STORAGE_ID); } catch {}
      await this._initIdentity();
      this._setStatus('Keys rotated.', 'ok');
    });
    this.connectBtn.addEventListener('click', () => this._connectToPeer());
    this.listenBtn.addEventListener('click', () => this._waitForIncoming());
    this.sendBtn.addEventListener('click', () => this._sendText());
    this.textInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); this._sendText(); }
    });
    this.attachBtn.addEventListener('click', () => this.fileInput.click());
    this.fileInput.addEventListener('change', () => this._sendFile());
    this.locBtn.addEventListener('click', () => this._sendLocation(false));
    this.liveBtn.addEventListener('click', () => this._toggleLiveLocation());
    this.voiceBtn.addEventListener('click', () => this._startCall(false));
    this.videoBtn.addEventListener('click', () => this._startCall(true));
    this.hangBtn.addEventListener('click', () => this._hangup());
  }

  open()  { this.root.classList.add('is-open'); }
  close() { this.root.classList.remove('is-open'); }

  _setStatus(msg, kind = '') {
    this.statusEl.innerHTML = kind ? `<span class="${kind}">${msg}</span>` : msg;
  }

  _bubble(role, html) {
    const div = document.createElement('div');
    div.className = 'ost-mesh-bubble ' + role;
    if (typeof html === 'string') div.innerHTML = html;
    else div.appendChild(html);
    this.feedEl.appendChild(div);
    this.feedEl.scrollTop = this.feedEl.scrollHeight;
  }

  async _announce() {
    if (!this.api) return;
    try {
      await fetch(this.api + '/mesh/v1/identity/announce', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address: this.address,
          bundle: this.publicBundle,
          fingerprint: this.fpr
        })
      });
    } catch {}
  }

  async _fetchPeerBundle(addr) {
    if (!this.api) throw new Error('no API base');
    const r = await fetch(this.api + '/mesh/v1/identity/lookup?address=' + encodeURIComponent(addr));
    if (!r.ok) throw new Error('peer not found in directory');
    const data = await r.json();
    if (!data.bundle) throw new Error('peer has no bundle');
    return data;
  }

  async _connectToPeer() {
    const addr = (this.peerInput.value || '').trim();
    if (!addr) return this._setStatus('Enter peer address.', 'warn');
    try {
      this._setStatus('Looking up peer in OST directory…');
      const peer = await this._fetchPeerBundle(addr);
      this.peerBundle = peer.bundle;
      const imported = await importPeerBundle(peer.bundle);
      this._setStatus(`Peer found · fpr ${peer.fingerprint || '—'}. Deriving session key…`);
      this.sessionKey = await deriveSessionKey(this.identity, imported.kexPub);
      this.peerAddr = addr;
      this._setStatus(`🔒 Encrypted session ready with ${addr}`, 'ok');
      this._enableMessaging();
      this._bubble('system', `Encrypted channel established with <code>${addr}</code> · suite ${peer.bundle.suite}`);
      // Open WebRTC data channel automatically (caller role)
      this._startRTC('caller');
    } catch (err) {
      this._setStatus('Connect failed: ' + err.message, 'err');
    }
  }

  async _waitForIncoming() {
    if (!this.peerBundle) {
      // Wait for any incoming offer addressed to us — we still need a peer address
      // to derive a session key, so we'll learn it from the first signaling message.
      this._setStatus('Listening for incoming peers…');
      this._enableMessaging();
      this._startRTC('callee', { open: true });
    }
  }

  _enableMessaging() {
    this.textInput.disabled = false;
    this.sendBtn.disabled = false;
    this.attachBtn.disabled = false;
    this.locBtn.disabled = false;
    this.liveBtn.disabled = false;
    this.voiceBtn.disabled = false;
    this.videoBtn.disabled = false;
    this.hangBtn.disabled = false;
  }

  _startRTC(role, { withMedia = false, video = false } = {}) {
    if (this.rtc) try { this.rtc.hangup(); } catch {}
    this.rtc = new MeshRTC({ apiBase: this.api, myAddress: this.address, peerAddress: this.peerAddr || 'pending' });

    this.rtc.addEventListener('open', () => {
      this._setStatus('🔗 Direct P2P data channel open.', 'ok');
    });
    this.rtc.addEventListener('close', () => {
      this._setStatus('Channel closed.', 'warn');
    });
    this.rtc.addEventListener('state', (e) => {
      const s = e.detail.state;
      if (s === 'connected')      this._setStatus('🔗 P2P connected.', 'ok');
      else if (s === 'failed')    this._setStatus('P2P failed (no relay yet).', 'err');
      else if (s === 'connecting') this._setStatus('P2P connecting…');
    });
    this.rtc.addEventListener('message', (e) => this._onPeerMessage(e.detail.data));
    this.rtc.addEventListener('local-stream', (e) => {
      this.localVid.srcObject = e.detail.stream;
      this.videoGrid.classList.add('is-on');
    });
    this.rtc.addEventListener('remote-stream', (e) => {
      this.remoteVid.srcObject = e.detail.stream;
      this.videoGrid.classList.add('is-on');
    });

    if (role === 'caller') this.rtc.call({ withMedia, video });
    else                    this.rtc.listen({ withMedia, video });
  }

  async _sendText() {
    const txt = (this.textInput.value || '').trim();
    if (!txt) return;
    if (!this.sessionKey) return this._setStatus('No session key.', 'err');
    const sealed = await sealPayload(this.sessionKey, { kind: 'text', text: txt, ts: Date.now() });
    const sent = this.rtc?.send(JSON.stringify({ kind: 'enc', payload: sealed }));
    this._bubble('me', escapeHtml(txt));
    this.textInput.value = '';
    if (!sent) this._bubble('system', '(buffered — channel not open yet)');
  }

  async _sendFile() {
    const f = this.fileInput.files && this.fileInput.files[0];
    if (!f) return;
    if (!this.sessionKey) return this._setStatus('No session key.', 'err');
    const buf = new Uint8Array(await f.arrayBuffer());
    const sealed = await sealBytes(this.sessionKey, buf);
    const meta = { kind: 'file-meta', name: f.name, type: f.type, size: f.size };
    const sealedMeta = await sealPayload(this.sessionKey, meta);
    this.rtc?.send(JSON.stringify({ kind: 'enc', payload: sealedMeta }));
    this.rtc?.send(sealed.buffer);
    const url = URL.createObjectURL(f);
    if (f.type.startsWith('image/')) {
      const img = document.createElement('img'); img.src = url;
      this._bubble('me', img);
    } else if (f.type.startsWith('video/')) {
      const vid = document.createElement('video'); vid.src = url; vid.controls = true;
      this._bubble('me', vid);
    } else {
      this._bubble('me', `📎 ${f.name} (${(f.size/1024).toFixed(1)} KB)`);
    }
    this.fileInput.value = '';
  }

  async _sendLocation(live) {
    if (!navigator.geolocation) return this._setStatus('Geolocation unavailable.', 'err');
    navigator.geolocation.getCurrentPosition(async (pos) => {
      const payload = {
        kind: live ? 'location-live' : 'location-ping',
        lat: pos.coords.latitude,
        lon: pos.coords.longitude,
        acc: pos.coords.accuracy,
        ts: Date.now()
      };
      const sealed = await sealPayload(this.sessionKey, payload);
      this.rtc?.send(JSON.stringify({ kind: 'enc', payload: sealed }));
      const link = `https://www.openstreetmap.org/?mlat=${payload.lat}&mlon=${payload.lon}#map=15/${payload.lat}/${payload.lon}`;
      this._bubble('me',
        `📍 <a href="${link}" target="_blank" rel="noopener">${payload.lat.toFixed(4)}, ${payload.lon.toFixed(4)}</a>${live ? ' (live)' : ''}`
      );
    }, (err) => this._setStatus('Geo error: ' + err.message, 'err'));
  }

  _toggleLiveLocation() {
    if (this.liveLocTimer) {
      clearInterval(this.liveLocTimer);
      this.liveLocTimer = null;
      this.liveBtn.textContent = '🛰 Live location';
      return;
    }
    this._sendLocation(true);
    this.liveLocTimer = setInterval(() => this._sendLocation(true), 5000);
    this.liveBtn.textContent = '🛰 Stop live';
  }

  async _startCall(video) {
    if (!this.peerAddr) return this._setStatus('Connect to a peer first.', 'warn');
    this._startRTC('caller', { withMedia: true, video });
  }

  _hangup() {
    if (this.rtc) try { this.rtc.hangup(); } catch {}
    this.videoGrid.classList.remove('is-on');
    if (this.liveLocTimer) { clearInterval(this.liveLocTimer); this.liveLocTimer = null; }
    this._setStatus('Hung up.', 'warn');
  }

  async _onPeerMessage(data) {
    try {
      if (typeof data === 'string') {
        const msg = JSON.parse(data);
        if (msg.kind === 'enc' && this.sessionKey) {
          const inner = await openPayload(this.sessionKey, msg.payload);
          this._renderIncoming(inner);
        }
      } else if (data instanceof ArrayBuffer && this.sessionKey && this._pendingFile) {
        const bytes = await openBytes(this.sessionKey, new Uint8Array(data));
        const blob = new Blob([bytes], { type: this._pendingFile.type || 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        if ((this._pendingFile.type || '').startsWith('image/')) {
          const img = document.createElement('img'); img.src = url;
          this._bubble('peer', img);
        } else if ((this._pendingFile.type || '').startsWith('video/')) {
          const vid = document.createElement('video'); vid.src = url; vid.controls = true;
          this._bubble('peer', vid);
        } else {
          const a = document.createElement('a'); a.href = url; a.download = this._pendingFile.name || 'file';
          a.textContent = '📎 ' + (this._pendingFile.name || 'file');
          this._bubble('peer', a);
        }
        this._pendingFile = null;
      }
    } catch (err) {
      this._bubble('system', '⚠ decrypt failed: ' + err.message);
    }
  }

  _renderIncoming(inner) {
    if (inner.kind === 'text') {
      this._bubble('peer', escapeHtml(inner.text));
    } else if (inner.kind === 'file-meta') {
      this._pendingFile = inner;
      this._bubble('system', `Receiving ${inner.name} (${(inner.size/1024).toFixed(1)} KB)…`);
    } else if (inner.kind === 'location-ping' || inner.kind === 'location-live') {
      const link = `https://www.openstreetmap.org/?mlat=${inner.lat}&mlon=${inner.lon}#map=15/${inner.lat}/${inner.lon}`;
      this._bubble('peer',
        `📍 <a href="${link}" target="_blank" rel="noopener">${inner.lat.toFixed(4)}, ${inner.lon.toFixed(4)}</a>${inner.kind === 'location-live' ? ' (live)' : ''}`
      );
    } else {
      this._bubble('peer', '<em>(unknown payload)</em>');
    }
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function boot() {
  if (window.OST_MESH && window.OST_MESH.pavilion) return;
  const pavilion = new MeshPavilion();
  window.OST_MESH = {
    pavilion,
    open:  () => pavilion.open(),
    close: () => pavilion.close()
  };
  window.dispatchEvent(new CustomEvent('mesh:ready'));
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}

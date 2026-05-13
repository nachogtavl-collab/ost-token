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
import { MeshRTC } from './mesh-rtc.js?v=10';

const STYLE_HREF = './mesh/mesh.css?v=12';
const STORAGE_ID = 'ost_mesh_identity_v1';
const STORAGE_ADDR = 'ost_mesh_addr_v1';
const MAX_FILE_BYTES = 32 * 1024 * 1024;
const MEDIA_CHUNK_BYTES = 16 * 1024;
const DEFAULT_API_BASE = 'https://ost-api.nachogtavl.workers.dev';
const INVITE_PREFIX = 'ost-mesh-invite:';
const ANNOUNCE_REFRESH_MS = 45_000;
const LIVE_LOCATION_INTERVAL_MS = 10_000;
const DEFAULT_CALL_MINUTES = 30;
const CHAT_PREFIX = 'ost.mesh.chat.v1.';
const CHAT_MAX_ENTRIES = 400;
const LAST_PEER_KEY = 'ost.mesh.lastPeer.v1';
const QR_API = 'https://api.qrserver.com/v1/create-qr-code/?size=320x320&margin=12&data=';

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
  root.setAttribute('aria-hidden', 'true');
  root.tabIndex = -1;
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
        <div>
          <div class="sub">Directory</div>
          <span class="pill" id="mesh-dir-status">registering…</span>
        </div>
        <div class="ost-mesh-id-actions">
          <button id="mesh-copy-addr">Copy address</button>
          <button id="mesh-copy-invite">Copy invite</button>
          <button id="mesh-show-qr">Show QR</button>
          <button id="mesh-scan-qr" class="ghost">Scan QR</button>
          <button id="mesh-rotate-id" class="ghost">Rotate keys</button>
        </div>
      </div>

      <div class="ost-mesh-row">
        <input id="mesh-peer-addr" type="text" placeholder="Paste peer address, invite, or scan QR" />
        <button id="mesh-connect">Connect securely</button>
        <button id="mesh-listen" class="ghost">Wait for incoming</button>
        <button id="mesh-clear-history" class="ghost" title="Clear stored chat history with this peer">Clear chat</button>
      </div>

      <div id="mesh-qr-modal" class="ost-mesh-qr-modal" aria-hidden="true">
        <div class="ost-mesh-qr-card">
          <div class="ost-mesh-qr-head">
            <strong id="mesh-qr-title">Your invite QR</strong>
            <button id="mesh-qr-close" type="button" aria-label="Close">×</button>
          </div>
          <div id="mesh-qr-body" class="ost-mesh-qr-body"></div>
          <div class="ost-mesh-qr-actions">
            <button id="mesh-qr-copy" type="button">Copy invite text</button>
            <button id="mesh-qr-share" type="button" class="ghost">Share…</button>
          </div>
        </div>
      </div>

      <div class="ost-mesh-status" id="mesh-status">Idle.</div>

      <div class="ost-mesh-callbar" id="mesh-callbar">
        <div>
          <div class="sub">Call status</div>
          <strong id="mesh-call-title">No active call</strong>
          <span id="mesh-call-timer">00:00</span>
        </div>
        <div class="ost-mesh-call-actions">
          <button id="mesh-call-accept-audio" hidden>Accept voice</button>
          <button id="mesh-call-accept-video" hidden>Accept video</button>
          <button id="mesh-call-decline" hidden>Decline</button>
          <button id="mesh-call-extend" disabled>Prolong +15m</button>
          <button id="mesh-call-end" disabled>End call</button>
        </div>
      </div>

      <div class="ost-mesh-session" id="mesh-session">
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
            <button id="mesh-attach" class="ost-icon-btn" disabled><span data-icon="paperclip"></span> Photo / Video</button>
            <button id="mesh-loc" class="ost-icon-btn" disabled><span data-icon="pin"></span> Share map</button>
            <button id="mesh-live" class="ost-icon-btn" disabled><span data-icon="satellite"></span> Live location</button>
            <button id="mesh-voice" class="ost-icon-btn" disabled><span data-icon="phone"></span> Start voice</button>
            <button id="mesh-video-call" class="ost-icon-btn" disabled><span data-icon="video"></span> Start video</button>
            <button id="mesh-hangup" class="ghost ost-icon-btn" disabled><span data-icon="phone-off"></span> End session</button>
          </div>
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
  const configured = String(window.OST_MESH_API_BASE || window.OST_API_BASE || '').replace(/\/+$/, '');
  if (configured && !configured.includes('ost-api-pages.pages.dev')) return configured;
  return DEFAULT_API_BASE;
}

function normalizeAddress(value) {
  const text = String(value || '').trim();
  const match = text.match(/ost-mesh:[a-f0-9]{4}(?:-[a-f0-9]{4}){3}/i);
  return match ? match[0].toLowerCase() : '';
}

function b64urlEncode(value) {
  const bytes = new TextEncoder().encode(value);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(value) {
  const padded = String(value).replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function makeInvite({ address, bundle, fingerprint }) {
  return INVITE_PREFIX + b64urlEncode(JSON.stringify({ v: 1, address, bundle, fingerprint }));
}

function parsePeerInput(value) {
  const text = String(value || '').trim();
  const inviteMatch = text.match(/ost-mesh-invite:[A-Za-z0-9_-]+/);
  if (inviteMatch) {
    const parsed = JSON.parse(b64urlDecode(inviteMatch[0].slice(INVITE_PREFIX.length)));
    return {
      address: normalizeAddress(parsed.address),
      bundle: parsed.bundle || null,
      fingerprint: parsed.fingerprint || null,
      via: 'invite'
    };
  }
  if (text.startsWith('{')) {
    const parsed = JSON.parse(text);
    return {
      address: normalizeAddress(parsed.address),
      bundle: parsed.bundle || null,
      fingerprint: parsed.fingerprint || null,
      via: parsed.bundle ? 'json-invite' : 'address'
    };
  }
  return { address: normalizeAddress(text), bundle: null, fingerprint: null, via: 'address' };
}

function makeId(prefix = 'mesh') {
  return prefix + '-' + (crypto.randomUUID?.() || (Date.now().toString(36) + Math.random().toString(36).slice(2)));
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '0 B';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function formatClock(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const mins = Math.floor(total / 60).toString().padStart(2, '0');
  const secs = (total % 60).toString().padStart(2, '0');
  return `${mins}:${secs}`;
}

function mapEmbedUrl(lat, lon) {
  const pad = 0.01;
  const bbox = [lon - pad, lat - pad, lon + pad, lat + pad]
    .map((n) => n.toFixed(6))
    .join('%2C');
  return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat.toFixed(6)}%2C${lon.toFixed(6)}`;
}

function mapOpenUrl(lat, lon) {
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=16/${lat}/${lon}`;
}

function concatChunks(chunks, total) {
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

class MeshPavilion {
  constructor() {
    injectStyles();
    buildDOM();

    this.root      = document.getElementById('ost-mesh-pavilion');
    this.shell     = this.root.querySelector('.ost-mesh-shell');
    this.trigger   = document.getElementById('ost-mesh-trigger');
    this.closeBtn  = this.root.querySelector('.ost-mesh-close');
    this.addrEl    = document.getElementById('mesh-my-addr');
    this.fprEl     = document.getElementById('mesh-my-fpr');
    this.dirEl     = document.getElementById('mesh-dir-status');
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
    this.callBar   = document.getElementById('mesh-callbar');
    this.callTitle = document.getElementById('mesh-call-title');
    this.callTimer = document.getElementById('mesh-call-timer');
    this.acceptAudioBtn = document.getElementById('mesh-call-accept-audio');
    this.acceptVideoBtn = document.getElementById('mesh-call-accept-video');
    this.declineCallBtn = document.getElementById('mesh-call-decline');
    this.extendCallBtn = document.getElementById('mesh-call-extend');
    this.endCallBtn = document.getElementById('mesh-call-end');
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
    this.localLiveBubble = null;
    this.peerLiveBubble = null;
    this.announceTimer = null;
    this.callState = 'idle';
    this.callStartedAt = 0;
    this.callEndsAt = 0;
    this.callTimerId = null;
    this.pendingIncomingCall = null;
    this.incomingFile = null;
    this.outbox = [];
    this.replacingRTC = false;
    this.pageScrollLock = null;

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
    this._announceNow({ silent: false });
    if (this.announceTimer) clearInterval(this.announceTimer);
    this.announceTimer = setInterval(() => this._announceNow({ silent: true }), ANNOUNCE_REFRESH_MS);
    if (!this.rtc) this._startRTC('callee', { passive: true });
  }

  _wire() {
    this.trigger.addEventListener('click', () => this.open());
    this.closeBtn.addEventListener('click', () => this.close());
    document.getElementById('mesh-copy-addr').addEventListener('click', () => this._copyAddress());
    document.getElementById('mesh-copy-invite').addEventListener('click', () => this._copyInvite());
    const showQrBtn = document.getElementById('mesh-show-qr');
    if (showQrBtn) showQrBtn.addEventListener('click', () => this._showInviteQR());
    const scanQrBtn = document.getElementById('mesh-scan-qr');
    if (scanQrBtn) scanQrBtn.addEventListener('click', () => this._openQRScanner());
    const clearChatBtn = document.getElementById('mesh-clear-history');
    if (clearChatBtn) clearChatBtn.addEventListener('click', () => this._clearStoredChat());
    const qrCloseBtn = document.getElementById('mesh-qr-close');
    if (qrCloseBtn) qrCloseBtn.addEventListener('click', () => this._closeQRModal());
    const qrModal = document.getElementById('mesh-qr-modal');
    if (qrModal) qrModal.addEventListener('click', (e) => { if (e.target === qrModal) this._closeQRModal(); });
    const qrCopyBtn = document.getElementById('mesh-qr-copy');
    if (qrCopyBtn) qrCopyBtn.addEventListener('click', () => this._copyInvite());
    const qrShareBtn = document.getElementById('mesh-qr-share');
    if (qrShareBtn) qrShareBtn.addEventListener('click', () => this._shareInvite());
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
    this.hangBtn.addEventListener('click', () => this._hangup({ restoreData: false }));
    this.acceptAudioBtn.addEventListener('click', () => this._acceptIncomingCall(false));
    this.acceptVideoBtn.addEventListener('click', () => this._acceptIncomingCall(true));
    this.declineCallBtn.addEventListener('click', () => this._declineIncomingCall());
    this.extendCallBtn.addEventListener('click', () => this._extendCall());
    this.endCallBtn.addEventListener('click', () => this._hangup({ restoreData: true }));
  }

  open()  {
    this._lockPageScroll();
    this.root.classList.add('is-open');
    this.root.setAttribute('aria-hidden', 'false');
    if (this.shell) this.shell.scrollTop = 0;
    if (typeof this.root.focus === 'function') {
      try { this.root.focus({ preventScroll: true }); }
      catch (_) { this.root.focus(); }
    }
    // Auto-restore the last peer's chat history so the conversation is
    // linear across reloads / re-opens, even before reconnecting.
    try {
      const last = localStorage.getItem(LAST_PEER_KEY);
      if (last && this.peerInput && !this.peerInput.value) {
        this.peerInput.value = last;
        this._replayChatHistory(last);
      }
    } catch (_) {}
  }
  close() {
    this.root.classList.remove('is-open');
    this.root.setAttribute('aria-hidden', 'true');
    this._unlockPageScroll();
  }

  _lockPageScroll() {
    if (this.pageScrollLock) return;
    const doc = document.documentElement;
    const body = document.body;
    const scrollY = window.scrollY || doc.scrollTop || 0;
    this.pageScrollLock = {
      scrollY,
      htmlOverflow: doc.style.overflow,
      bodyOverflow: body.style.overflow,
      bodyPosition: body.style.position,
      bodyTop: body.style.top,
      bodyLeft: body.style.left,
      bodyRight: body.style.right,
      bodyWidth: body.style.width
    };
    doc.classList.add('ost-mesh-scroll-lock');
    body.classList.add('ost-mesh-scroll-lock');
    doc.style.overflow = 'hidden';
    body.style.overflow = 'hidden';
    body.style.position = 'fixed';
    body.style.top = `-${scrollY}px`;
    body.style.left = '0';
    body.style.right = '0';
    body.style.width = '100%';
  }

  _unlockPageScroll() {
    if (!this.pageScrollLock) return;
    const doc = document.documentElement;
    const body = document.body;
    const lock = this.pageScrollLock;
    doc.classList.remove('ost-mesh-scroll-lock');
    body.classList.remove('ost-mesh-scroll-lock');
    doc.style.overflow = lock.htmlOverflow;
    body.style.overflow = lock.bodyOverflow;
    body.style.position = lock.bodyPosition;
    body.style.top = lock.bodyTop;
    body.style.left = lock.bodyLeft;
    body.style.right = lock.bodyRight;
    body.style.width = lock.bodyWidth;
    this.pageScrollLock = null;
    window.scrollTo(0, lock.scrollY || 0);
  }

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
    return div;
  }

  async _announce() {
    if (!this.api) throw new Error('no API base');
    const r = await fetch(this.api + '/mesh/v1/identity/announce', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        address: this.address,
        bundle: this.publicBundle,
        fingerprint: this.fpr
      })
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || data.ok === false) throw new Error(data.error || ('announce ' + r.status));
    return data;
  }

  async _announceNow({ silent } = {}) {
    try {
      const data = await this._announce();
      if (this.dirEl) this.dirEl.textContent = 'live';
      if (!silent) this._setStatus('Directory registration live. Address and invite are ready.', 'ok');
      return data;
    } catch (err) {
      if (this.dirEl) this.dirEl.textContent = 'offline';
      if (!silent) this._setStatus('Directory registration failed. Use Copy invite instead. ' + err.message, 'warn');
      throw err;
    }
  }

  async _copyAddress() {
    try { await this._announceNow({ silent: true }); } catch {}
    this._copyText(this.address, 'Address copied. Peer can paste it while this tab stays open.', 'Copy blocked.');
  }

  async _copyInvite() {
    if (!this.publicBundle) return this._setStatus('Keys are still loading. Try again in a second.', 'warn');
    const invite = makeInvite({
      address: this.address,
      bundle: this.publicBundle,
      fingerprint: this.fpr
    });
    this._copyText(invite, 'Invite copied. This works even if the directory misses.', 'Copy blocked.');
  }

  _copyText(value, okMsg, failMsg) {
    if (!navigator.clipboard?.writeText) {
      this._setStatus(failMsg + ' Clipboard API unavailable.', 'warn');
      return;
    }
    navigator.clipboard.writeText(value)
      .then(() => this._setStatus(okMsg, 'ok'))
      .catch(() => this._setStatus(failMsg, 'warn'));
  }

  async _fetchPeerBundle(addr, fallback = null) {
    if (!this.api) throw new Error('no API base');
    try {
      const r = await fetch(this.api + '/mesh/v1/identity/lookup?address=' + encodeURIComponent(addr));
      if (!r.ok) throw new Error('lookup ' + r.status);
      const data = await r.json();
      if (!data.bundle) throw new Error('peer has no bundle');
      return data;
    } catch (err) {
      if (fallback?.bundle) return fallback;
      throw new Error('peer not found in directory. Ask them to open Mesh and Copy invite, then paste the invite here.');
    }
  }

  async _connectToPeer() {
    let peer;
    try {
      peer = parsePeerInput(this.peerInput.value || '');
    } catch (err) {
      return this._setStatus('Invalid invite: ' + err.message, 'err');
    }
    if (!peer.address) return this._setStatus('Paste a peer address or invite.', 'warn');
    try {
      await this._preparePeerSession(peer);
      this._enableMessaging();
      // Open WebRTC data channel automatically (caller role)
      this._startRTC('caller');
    } catch (err) {
      this._setStatus('Connect failed: ' + err.message, 'err');
    }
  }

  async _waitForIncoming() {
    this.peerAddr = '';
    this.sessionKey = null;
    this._setStatus('Listening for incoming peers…');
    this._startRTC('callee');
  }

  async _preparePeerSession(peerInput) {
    const peerInfo = typeof peerInput === 'string'
      ? { address: normalizeAddress(peerInput), bundle: null, fingerprint: null, via: 'address' }
      : peerInput;
    const addr = normalizeAddress(peerInfo.address);
    if (!addr) throw new Error('missing peer address');
    if (this.peerAddr === addr && this.sessionKey) return;
    this._setStatus('Looking up peer in OST directory…');
    const peer = await this._fetchPeerBundle(addr, peerInfo.bundle ? peerInfo : null);
    this.peerBundle = peer.bundle;
    const imported = await importPeerBundle(peer.bundle);
    const via = peerInfo.bundle ? 'invite' : 'directory';
    this._setStatus(`Peer found by ${via} · fpr ${peer.fingerprint || '—'}. Deriving session key…`);
    this.sessionKey = await deriveSessionKey(this.identity, imported.kexPub);
    this.peerAddr = addr;
    this.peerInput.value = addr;
    try { localStorage.setItem(LAST_PEER_KEY, addr); } catch (_) {}
    this._setStatus(`Encrypted session ready with ${addr}`, 'ok');
    this._replayChatHistory(addr);
    this._bubble('system', `Encrypted channel established with <code>${escapeHtml(addr)}</code> · suite ${escapeHtml(peer.bundle.suite || 'unknown')}`);
  }

  /* ----- Chat persistence (linear conversation history per peer) ----- */
  _chatKey(addr) { return CHAT_PREFIX + String(addr || this.peerAddr || ''); }
  _loadChat(addr) {
    try { const v = JSON.parse(localStorage.getItem(this._chatKey(addr)) || '[]'); return Array.isArray(v) ? v : []; }
    catch (_) { return []; }
  }
  _saveChat(addr, list) {
    try {
      const trimmed = list.slice(-CHAT_MAX_ENTRIES);
      localStorage.setItem(this._chatKey(addr), JSON.stringify(trimmed));
    } catch (_) {}
  }
  _persistEntry(role, kind, payload) {
    if (!this.peerAddr) return;
    const list = this._loadChat(this.peerAddr);
    list.push({ role, kind, payload, ts: Date.now() });
    this._saveChat(this.peerAddr, list);
  }
  _replayChatHistory(addr) {
    if (!this.feedEl) return;
    const entries = this._loadChat(addr);
    if (!entries.length) return;
    this.feedEl.innerHTML = '';
    this._bubble('system', `<em>↻ Restored ${entries.length} message${entries.length === 1 ? '' : 's'} with <code>${escapeHtml(addr)}</code></em>`);
    for (const e of entries) {
      try {
        if (e.kind === 'text') {
          this._bubble(e.role, `<span class="ts">${new Date(e.ts).toLocaleTimeString()}</span> ${escapeHtml(e.payload && e.payload.text || '')}`);
        } else if (e.kind === 'location') {
          const card = this._makeLocationCard(e.payload, e.role);
          this._bubble(e.role, card);
        } else if (e.kind === 'system') {
          this._bubble('system', String(e.payload && e.payload.html || ''));
        }
      } catch (_) {}
    }
  }
  _clearStoredChat() {
    const addr = this.peerAddr || (this.peerInput && this.peerInput.value) || '';
    if (!addr) { this._setStatus('No peer selected.', 'warn'); return; }
    if (!confirm('Clear stored chat history with ' + addr + '?')) return;
    try { localStorage.removeItem(this._chatKey(addr)); } catch (_) {}
    if (this.feedEl) this.feedEl.innerHTML = '';
    this._bubble('system', `<em>Chat history cleared.</em>`);
    this._setStatus('Chat history cleared.', 'ok');
  }

  /* ----- QR generation + scanning ----- */
  _showInviteQR() {
    if (!this.publicBundle) { this._setStatus('Keys still loading…', 'warn'); return; }
    const invite = makeInvite({ address: this.address, bundle: this.publicBundle, fingerprint: this.fpr });
    const modal = document.getElementById('mesh-qr-modal');
    const body = document.getElementById('mesh-qr-body');
    const title = document.getElementById('mesh-qr-title');
    if (!modal || !body) return;
    title.textContent = 'Your invite QR';
    body.innerHTML = `
      <img src="${QR_API}${encodeURIComponent(invite)}" alt="OST Mesh invite QR" loading="lazy" />
      <p class="ost-mesh-qr-hint">Have your peer scan this with their phone camera (or use Scan QR here).</p>
      <textarea readonly class="ost-mesh-qr-text">${escapeHtml(invite)}</textarea>
    `;
    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
  }
  _closeQRModal() {
    const modal = document.getElementById('mesh-qr-modal');
    if (!modal) return;
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
    if (this._qrScanStop) { try { this._qrScanStop(); } catch (_) {} this._qrScanStop = null; }
  }
  async _openQRScanner() {
    const modal = document.getElementById('mesh-qr-modal');
    const body = document.getElementById('mesh-qr-body');
    const title = document.getElementById('mesh-qr-title');
    if (!modal || !body) return;
    title.textContent = 'Scan peer QR';
    body.innerHTML = '<div class="ost-mesh-qr-scan"><video id="mesh-qr-video" autoplay playsinline muted></video><p class="ost-mesh-qr-hint">Point at a peer\'s invite QR, or upload an image.</p><label class="ost-mesh-qr-upload">Upload QR image<input type="file" id="mesh-qr-file" accept="image/*" hidden /></label></div>';
    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
    const video = document.getElementById('mesh-qr-video');
    const fileInput = document.getElementById('mesh-qr-file');
    if (fileInput) fileInput.addEventListener('change', () => this._scanQRFromFile(fileInput.files && fileInput.files[0]));
    if (!('BarcodeDetector' in window)) {
      this._setStatus('Live QR scan not supported on this browser. Use Upload QR image.', 'warn');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      video.srcObject = stream;
      const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
      let stopped = false;
      this._qrScanStop = () => { stopped = true; stream.getTracks().forEach((t) => t.stop()); };
      const tick = async () => {
        if (stopped) return;
        try {
          const codes = await detector.detect(video);
          if (codes && codes[0] && codes[0].rawValue) {
            this._handleScannedInvite(codes[0].rawValue);
            return;
          }
        } catch (_) {}
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    } catch (err) {
      this._setStatus('Camera blocked: ' + err.message + '. Use Upload QR image.', 'warn');
    }
  }
  async _scanQRFromFile(file) {
    if (!file) return;
    if (!('BarcodeDetector' in window)) { this._setStatus('QR decode not supported in this browser.', 'err'); return; }
    try {
      const bmp = await createImageBitmap(file);
      const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
      const codes = await detector.detect(bmp);
      if (!codes || !codes[0]) { this._setStatus('No QR detected in image.', 'warn'); return; }
      this._handleScannedInvite(codes[0].rawValue);
    } catch (err) {
      this._setStatus('QR decode failed: ' + err.message, 'err');
    }
  }
  _handleScannedInvite(value) {
    if (!value) return;
    if (this.peerInput) this.peerInput.value = value;
    this._closeQRModal();
    this._setStatus('QR scanned — connecting…', 'ok');
    this._connectToPeer();
  }
  async _shareInvite() {
    if (!this.publicBundle) return;
    const invite = makeInvite({ address: this.address, bundle: this.publicBundle, fingerprint: this.fpr });
    if (navigator.share) {
      try { await navigator.share({ title: 'OST Mesh invite', text: invite }); return; }
      catch (_) {}
    }
    this._copyInvite();
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
    if (this.callState === 'idle') this._setCallControls('idle');
  }

  _disableMessaging() {
    this.textInput.value = '';
    this.textInput.disabled = true;
    this.sendBtn.disabled = true;
    this.attachBtn.disabled = true;
    this.locBtn.disabled = true;
    this.liveBtn.disabled = true;
    this.voiceBtn.disabled = true;
    this.videoBtn.disabled = true;
    this.hangBtn.disabled = true;
  }

  _clearMessagingSession() {
    this.peerAddr = null;
    this.peerBundle = null;
    this.sessionKey = null;
    this.outbox = [];
    this._disableMessaging();
  }

  _startRTC(role, { withMedia = false, video = false, passive = false } = {}) {
    if (this.rtc) {
      this.replacingRTC = true;
      try { this.rtc.hangup({ notify: false }); } catch {}
      this.replacingRTC = false;
    }
    this.rtc = new MeshRTC({ apiBase: this.api, myAddress: this.address, peerAddress: this.peerAddr || '' });

    this.rtc.addEventListener('open', () => {
      this._setStatus('Direct P2P data channel open.', 'ok');
      if (this.peerAddr && this.sessionKey) this._enableMessaging();
      if (this.callState === 'calling' || this.callState === 'answering') this._markCallConnected(video);
      this._flushOutbox();
    });
    this.rtc.addEventListener('peer', (e) => {
      const addr = e.detail.address;
      this._preparePeerSession(addr)
        .then(() => this._enableMessaging())
        .catch((err) => this._setStatus('Incoming peer rejected: ' + err.message, 'err'));
    });
    this.rtc.addEventListener('close', (e) => {
      if (e.currentTarget !== this.rtc || this.replacingRTC) return;
      this._setStatus('Channel closed.', 'warn');
      if (this.callState === 'idle') this._clearMessagingSession();
    });
    this.rtc.addEventListener('state', (e) => {
      const s = e.detail.state;
      if (s === 'connected')      this._setStatus('P2P connected.', 'ok');
      else if (s === 'failed') {
        this._setStatus('P2P failed (no relay yet).', 'err');
        if (this.callState !== 'idle') {
          this._setCallStatus('Call connection lost.', 'warn');
          this._resetCallState();
        }
      }
      else if (s === 'connecting') this._setStatus('P2P connecting…');
    });
    this.rtc.addEventListener('incoming-call', (e) => this._showIncomingCall(e.detail));
    this.rtc.addEventListener('call-connected', () => {
      if (this.callState === 'calling' || this.callState === 'answering') this._markCallConnected(video);
    });
    this.rtc.addEventListener('call-decline', (e) => {
      this._setCallStatus('Call declined: ' + (e.detail.reason || 'declined'), 'warn');
      this._resetCallState();
    });
    this.rtc.addEventListener('call-end', (e) => this._handleRemoteCallEnd(e.detail.reason || 'ended'));
    this.rtc.addEventListener('call-extend', (e) => {
      const minutes = Number(e.detail.minutes || 15);
      this.callEndsAt = Math.max(this.callEndsAt || Date.now(), Date.now()) + minutes * 60_000;
      this._setCallStatus(`Call prolonged by ${minutes} minutes.`, 'ok');
    });
    this.rtc.addEventListener('hangup', () => {
      this.videoGrid.classList.remove('is-on');
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

    const started = role === 'caller'
      ? this.rtc.call({ withMedia, video })
      : this.rtc.listen({ withMedia, video });
    started.catch((err) => {
      this._setStatus('RTC error: ' + err.message, 'err');
      if (withMedia) {
        this._resetCallState();
        this._setCallStatus('Media permission failed: ' + err.message, 'err');
      }
      if (!passive) this._bubble('system', 'RTC error: ' + escapeHtml(err.message));
    });
  }

  async _sendText() {
    const txt = (this.textInput.value || '').trim();
    if (!txt) return;
    if (!this.sessionKey) return this._setStatus('No session key.', 'err');
    const sealed = await sealPayload(this.sessionKey, { kind: 'text', text: txt, ts: Date.now() });
    const sent = this._sendWire(JSON.stringify({ kind: 'enc', payload: sealed }));
    this._bubble('me', `<span class="ts">${new Date().toLocaleTimeString()}</span> ${escapeHtml(txt)}`);
    this._persistEntry('me', 'text', { text: txt });
    this.textInput.value = '';
    if (!sent) this._bubble('system', '(buffered — channel not open yet)');
  }

  async _sendFile() {
    const f = this.fileInput.files && this.fileInput.files[0];
    if (!f) return;
    if (!this.sessionKey) return this._setStatus('No session key.', 'err');
    if (!this.rtc?.isOpen?.()) return this._setStatus('Open the P2P channel before sending media.', 'warn');
    if (f.size > MAX_FILE_BYTES) return this._setStatus(`File too large. Keep media under ${formatBytes(MAX_FILE_BYTES)}.`, 'warn');
    try {
      const transferId = makeId('media');
      const progress = this._bubble('system', `Preparing ${escapeHtml(f.name)} (${formatBytes(f.size)})…`);
      const buf = new Uint8Array(await f.arrayBuffer());
      const sealed = await sealBytes(this.sessionKey, buf);
      const chunks = Math.ceil(sealed.byteLength / MEDIA_CHUNK_BYTES);
      const meta = {
        kind: 'file-start',
        transferId,
        name: f.name,
        type: f.type || 'application/octet-stream',
        size: f.size,
        sealedSize: sealed.byteLength,
        chunks,
        chunkBytes: MEDIA_CHUNK_BYTES,
        ts: Date.now()
      };
      const sealedMeta = await sealPayload(this.sessionKey, meta);
      await this._sendWireAsync(JSON.stringify({ kind: 'enc', payload: sealedMeta }));

      for (let offset = 0, index = 0; offset < sealed.byteLength; offset += MEDIA_CHUNK_BYTES, index++) {
        const chunk = sealed.slice(offset, offset + MEDIA_CHUNK_BYTES);
        await this._sendWireAsync(chunk.buffer);
        if (index % 16 === 0 || index + 1 === chunks) {
          progress.textContent = `Sending ${f.name}: ${Math.round(((index + 1) / chunks) * 100)}%`;
        }
      }

      progress.textContent = `Sent ${f.name} (${formatBytes(f.size)}).`;
      this._renderMediaPreview(f, 'me');
      this.fileInput.value = '';
    } catch (err) {
      this._setStatus('Media send failed: ' + err.message, 'err');
      this._bubble('system', 'Media send failed: ' + escapeHtml(err.message));
    }
  }

  async _sendLocation(live) {
    if (!this.sessionKey) {
      this._setStatus('No session key.', 'err');
      throw new Error('No session key');
    }
    if (!navigator.geolocation) {
      this._setStatus('Geolocation unavailable.', 'err');
      throw new Error('Geolocation unavailable');
    }
    return new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(async (pos) => {
        try {
          const payload = {
            kind: live ? 'location-live' : 'location-ping',
            lat: pos.coords.latitude,
            lon: pos.coords.longitude,
            acc: pos.coords.accuracy,
            ts: Date.now()
          };
          const sealed = await sealPayload(this.sessionKey, payload);
          this._sendWire(JSON.stringify({ kind: 'enc', payload: sealed }));
          this._renderLocation(payload, 'me');
          resolve(payload);
        } catch (err) {
          reject(err);
        }
      }, (err) => {
        this._setStatus('Geo error: ' + err.message, 'err');
        reject(err);
      }, {
        enableHighAccuracy: true,
        timeout: 12_000,
        maximumAge: 5_000
      });
    });
  }

  async _toggleLiveLocation() {
    if (this.liveLocTimer) {
      clearInterval(this.liveLocTimer);
      this.liveLocTimer = null;
      this.liveBtn.innerHTML = (window.OST_ICON ? window.OST_ICON('satellite') : '') + ' Live location';
      this._sendLiveStop().catch(() => {});
      this._setStatus('Live location stopped.', 'warn');
      return;
    }
    try {
      await this._sendLocation(true);
      this.liveLocTimer = setInterval(() => this._sendLocation(true).catch(() => {}), LIVE_LOCATION_INTERVAL_MS);
      this.liveBtn.innerHTML = (window.OST_ICON ? window.OST_ICON('satellite') : '') + ' Stop live';
      this._setStatus('Live location sharing started.', 'ok');
    } catch {}
  }

  async _sendLiveStop() {
    if (!this.sessionKey) return;
    const sealed = await sealPayload(this.sessionKey, { kind: 'location-live-stop', ts: Date.now() });
    this._sendWire(JSON.stringify({ kind: 'enc', payload: sealed }));
  }

  async sendAppPayload(payload = {}) {
    if (!this.sessionKey) throw new Error('No encrypted Mesh session is ready');
    const sealed = await sealPayload(this.sessionKey, {
      ...payload,
      kind: 'mesh-app',
      ts: Date.now()
    });
    const wire = JSON.stringify({ kind: 'enc', payload: sealed });
    return this._sendWire(wire);
  }

  async sendAppPayloadReliable(payload = {}, options = {}) {
    if (!this.sessionKey) throw new Error('No encrypted Mesh session is ready');
    await this.waitForDataChannel({ timeoutMs: options.timeoutMs || 18000, reconnect: options.reconnect !== false });
    const sealed = await sealPayload(this.sessionKey, {
      ...payload,
      kind: 'mesh-app',
      ts: Date.now()
    });
    const sent = await this._sendWireAsync(JSON.stringify({ kind: 'enc', payload: sealed }));
    if (!sent) throw new Error('Encrypted Mesh channel is not open');
    return true;
  }

  async waitForDataChannel(options = {}) {
    const timeoutMs = Math.max(1000, Number(options.timeoutMs || 12000));
    if (this.rtc?.isOpen?.()) return true;
    if (options.reconnect && this.peerAddr) {
      const state = this.rtc?.dc?.readyState || '';
      if (!this.rtc || state === 'closed' || state === 'closing') {
        this._setStatus('Reopening encrypted Mesh data channel...', 'warn');
        this._startRTC('caller', { passive: true });
      }
    }
    const rtc = this.rtc;
    if (!rtc) throw new Error('Connect to a Mesh peer first');
    await new Promise((resolve, reject) => {
      let done = false;
      const finish = (err) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        rtc.removeEventListener('open', onOpen);
        rtc.removeEventListener('close', onClose);
        if (err) reject(err);
        else resolve();
      };
      const onOpen = () => finish();
      const onClose = () => {
        if (!this.rtc?.isOpen?.()) this._setStatus('Mesh data channel closed while sending.', 'warn');
      };
      const timer = setTimeout(() => finish(new Error('Mesh peer channel is not open. Keep both phones on OST Mesh, reconnect, then retry.')), timeoutMs);
      rtc.addEventListener('open', onOpen, { once: true });
      rtc.addEventListener('close', onClose);
    });
    if (!this.rtc?.isOpen?.()) throw new Error('Mesh peer channel is not open. Keep both phones on OST Mesh, reconnect, then retry.');
    return true;
  }

  async _sendCallControl(kind, payload = {}) {
    if (!this.sessionKey || !this.rtc?.isOpen?.()) return false;
    const sealed = await sealPayload(this.sessionKey, { kind, ...payload, ts: Date.now() });
    const wire = JSON.stringify({ kind: 'enc', payload: sealed });
    if (this.rtc?.sendReliable) return this.rtc.sendReliable(wire);
    return this._sendWire(wire);
  }

  async _startCall(video) {
    if (!this.peerAddr) return this._setStatus('Connect to a peer first.', 'warn');
    this.callState = 'calling';
    this.callStartedAt = 0;
    this.callEndsAt = Date.now() + DEFAULT_CALL_MINUTES * 60_000;
    this._setCallStatus(`Calling ${this.peerAddr} by ${video ? 'video' : 'voice'}…`, 'ok');
    this._setCallControls('calling');
    this._startRTC('caller', { withMedia: true, video });
  }

  _showIncomingCall(detail) {
    this.pendingIncomingCall = detail;
    this.callState = 'ringing';
    const mode = detail.video ? 'video' : 'voice';
    this._setCallStatus(`Incoming ${mode} call from ${detail.from || 'peer'}.`, 'warn');
    this._setCallControls('ringing', detail.video);
    this.open();
  }

  async _acceptIncomingCall(video) {
    if (!this.rtc?.acceptIncoming) return this._setCallStatus('No incoming call to accept.', 'warn');
    this.callState = 'answering';
    this.callEndsAt = Date.now() + DEFAULT_CALL_MINUTES * 60_000;
    this._setCallStatus(`Accepting ${video ? 'video' : 'voice'} call…`, 'ok');
    this._setCallControls('answering');
    try {
      await this.rtc.acceptIncoming({ audio: true, video });
      this.pendingIncomingCall = null;
      this._markCallConnected(video);
    } catch (err) {
      this.callState = 'idle';
      this._setCallStatus('Call accept failed: ' + err.message, 'err');
      this._setCallControls('idle');
    }
  }

  async _declineIncomingCall() {
    try { await this.rtc?.declineIncoming?.('declined'); } catch {}
    this.pendingIncomingCall = null;
    this.callState = 'idle';
    this._setCallStatus('Incoming call declined.', 'warn');
    this._setCallControls('idle');
  }

  async _extendCall() {
    if (this.callState !== 'in-call') return;
    this.callEndsAt = Math.max(this.callEndsAt || Date.now(), Date.now()) + 15 * 60_000;
    let sentControl = false;
    try { sentControl = await this._sendCallControl('call-extend', { minutes: 15 }); } catch {}
    if (!sentControl) try { await this.rtc?.extendCall?.(15); } catch {}
    this._setCallStatus('Call prolonged by 15 minutes.', 'ok');
    this._updateCallTimer();
  }

  _markCallConnected(video) {
    if (this.callState === 'in-call') return;
    this.callState = 'in-call';
    this.callStartedAt = Date.now();
    this.callEndsAt = Date.now() + DEFAULT_CALL_MINUTES * 60_000;
    this._setCallStatus(`${video ? 'Video' : 'Voice'} call live.`, 'ok');
    this._setCallControls('in-call');
    this._startCallTimer();
  }

  _setCallStatus(text, kind = '') {
    this.callTitle.innerHTML = kind ? `<span class="${kind}">${escapeHtml(text)}</span>` : escapeHtml(text);
  }

  _setCallControls(mode, incomingVideo = false) {
    const ringing = mode === 'ringing';
    this.acceptAudioBtn.hidden = !ringing;
    this.acceptVideoBtn.hidden = !ringing || !incomingVideo;
    this.declineCallBtn.hidden = !ringing;
    this.extendCallBtn.disabled = mode !== 'in-call';
    this.endCallBtn.disabled = mode !== 'in-call' && mode !== 'calling' && mode !== 'answering';
    this.voiceBtn.disabled = mode !== 'idle' || !this.peerAddr;
    this.videoBtn.disabled = mode !== 'idle' || !this.peerAddr;
  }

  _startCallTimer() {
    this._stopCallTimer();
    this._updateCallTimer();
    this.callTimerId = setInterval(() => this._updateCallTimer(), 1000);
  }

  _updateCallTimer() {
    if (this.callState !== 'in-call') {
      this.callTimer.textContent = '00:00';
      return;
    }
    const elapsed = formatClock(Date.now() - this.callStartedAt);
    const remainingMs = (this.callEndsAt || Date.now()) - Date.now();
    if (remainingMs <= 0) {
      this._hangup();
      this._setCallStatus('Call ended. Use Prolong before the timer expires next time.', 'warn');
      return;
    }
    const remaining = formatClock(remainingMs);
    this.callTimer.textContent = `${elapsed} · ${remaining} left`;
  }

  _stopCallTimer() {
    if (this.callTimerId) clearInterval(this.callTimerId);
    this.callTimerId = null;
  }

  _resetCallState() {
    this.callState = 'idle';
    this.pendingIncomingCall = null;
    this.callStartedAt = 0;
    this.callEndsAt = 0;
    this._stopCallTimer();
    this.callTimer.textContent = '00:00';
    this._setCallControls('idle');
    this.videoGrid.classList.remove('is-on');
    this.localVid.srcObject = null;
    this.remoteVid.srcObject = null;
  }

  _restoreDataSessionAfterCall(role) {
    if (!this.peerAddr || !this.sessionKey) return;
    this._setStatus('Restoring encrypted message channel…');
    this._startRTC(role, { passive: role !== 'caller' });
  }

  async _handleRemoteCallEnd(reason = 'ended') {
    const hadCall = this.callState !== 'idle' || this.videoGrid.classList.contains('is-on');
    if (!hadCall) return;
    this._setCallStatus('Call ended: ' + reason, 'warn');
    try { await this.rtc?.hangup?.({ notify: false }); } catch {}
    this._resetCallState();
    this._restoreDataSessionAfterCall('callee');
  }

  async _hangup({ restoreData = false } = {}) {
    const rtc = this.rtc;
    const wasCalling = this.callState !== 'idle';
    if (wasCalling) {
      try { await this._sendCallControl('call-end', { reason: 'ended' }); } catch {}
    }
    if (rtc) {
      try {
        if (wasCalling && rtc.endCall) await rtc.endCall('ended');
        else await rtc.hangup({ notify: wasCalling });
      } catch {}
    }
    this.videoGrid.classList.remove('is-on');
    if (this.liveLocTimer) { clearInterval(this.liveLocTimer); this.liveLocTimer = null; }
    this.liveBtn.innerHTML = (window.OST_ICON ? window.OST_ICON('satellite') : '') + ' Live location';
    this._resetCallState();
    if (restoreData && wasCalling) {
      this._restoreDataSessionAfterCall('caller');
    } else {
      this._clearMessagingSession();
      this._setStatus('Hung up.', 'warn');
    }
    this._setCallStatus('No active call');
  }

  _sendWire(data) {
    const sent = this.rtc?.send(data);
    if (!sent) this.outbox.push(data);
    return sent;
  }

  async _sendWireAsync(data) {
    if (this.rtc?.sendReliable) {
      const sent = await this.rtc.sendReliable(data);
      if (!sent) throw new Error('P2P channel is not open');
      return true;
    }
    if (!this._sendWire(data)) throw new Error('P2P channel is not open');
    return true;
  }

  _renderMediaPreview(fileOrBlob, role, meta = {}) {
    const type = meta.type || fileOrBlob.type || '';
    const name = meta.name || fileOrBlob.name || 'media';
    const size = meta.size || fileOrBlob.size || 0;
    const url = URL.createObjectURL(fileOrBlob);
    const wrap = document.createElement('div');
    wrap.className = 'ost-mesh-media-card';
    const label = document.createElement('div');
    label.className = 'ost-mesh-media-meta';
    label.textContent = `${name} · ${formatBytes(size)}`;
    if (type.startsWith('image/')) {
      const img = document.createElement('img');
      img.src = url;
      img.alt = name;
      wrap.appendChild(img);
    } else if (type.startsWith('video/')) {
      const vid = document.createElement('video');
      vid.src = url;
      vid.controls = true;
      vid.playsInline = true;
      wrap.appendChild(vid);
    }
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.textContent = type.startsWith('image/') || type.startsWith('video/') ? 'Open / download' : `Download ${name}`;
    wrap.appendChild(label);
    wrap.appendChild(link);
    this._bubble(role, wrap);
  }

  _renderLocation(payload, role) {
    const live = payload.kind === 'location-live';
    const card = this._makeLocationCard(payload, role);
    // Persist every location ping so the chat keeps a linear trail and the
    // recipient can see past pins after the live session ends.
    this._persistEntry(role, 'location', payload);
    if (live) {
      const existing = role === 'me' ? this.localLiveBubble : this.peerLiveBubble;
      if (existing) {
        existing.innerHTML = '';
        existing.appendChild(card);
        this.feedEl.scrollTop = this.feedEl.scrollHeight;
        return existing;
      }
      const bubble = this._bubble(role, card);
      if (role === 'me') this.localLiveBubble = bubble;
      else this.peerLiveBubble = bubble;
      return bubble;
    }
    return this._bubble(role, card);
  }

  _makeLocationCard(payload, role) {
    const card = document.createElement('div');
    card.className = 'ost-mesh-map-card';
    const title = payload.kind === 'location-live'
      ? `${role === 'me' ? 'Your' : 'Peer'} live location`
      : `${role === 'me' ? 'Your' : 'Peer'} location`;
    card.innerHTML = `
      <div class="ost-mesh-map-head">
        <strong>${escapeHtml(title)}</strong>
        <span>${new Date(payload.ts || Date.now()).toLocaleTimeString()}</span>
      </div>
      <iframe title="OST Mesh shared map" loading="lazy" referrerpolicy="no-referrer-when-downgrade" src="${mapEmbedUrl(payload.lat, payload.lon)}"></iframe>
      <div class="ost-mesh-map-meta">
        <span>${payload.lat.toFixed(5)}, ${payload.lon.toFixed(5)}</span>
        <span>±${Math.round(payload.acc || 0)}m</span>
        <a href="${mapOpenUrl(payload.lat, payload.lon)}" target="_blank" rel="noopener">Open map</a>
      </div>
    `;
    return card;
  }

  _flushOutbox() {
    if (!this.outbox.length) return;
    const pending = this.outbox.splice(0);
    let sent = 0;
    for (const item of pending) {
      if (this.rtc?.send(item)) sent++;
      else this.outbox.push(item);
    }
    if (sent) this._bubble('system', `Sent ${sent} queued encrypted item${sent === 1 ? '' : 's'}.`);
  }

  async _onPeerMessage(data) {
    try {
      if (typeof data === 'string') {
        const msg = JSON.parse(data);
        if (msg.kind === 'enc' && this.sessionKey) {
          const inner = await openPayload(this.sessionKey, msg.payload);
          await this._renderIncoming(inner);
        }
      } else if (data instanceof ArrayBuffer && this.sessionKey) {
        await this._receiveFileChunk(new Uint8Array(data));
      }
    } catch (err) {
      this._bubble('system', 'decrypt failed: ' + err.message);
    }
  }

  async _receiveFileChunk(chunk) {
    if (!this.incomingFile) return;
    const transfer = this.incomingFile;
    transfer.chunks.push(chunk);
    transfer.received += chunk.byteLength;
    const pct = Math.min(100, Math.round((transfer.received / transfer.meta.sealedSize) * 100));
    transfer.progress.textContent = `Receiving ${transfer.meta.name}: ${pct}%`;
    if (transfer.received < transfer.meta.sealedSize) return;

    const sealed = concatChunks(transfer.chunks, transfer.received).slice(0, transfer.meta.sealedSize);
    const bytes = await openBytes(this.sessionKey, sealed);
    const blob = new Blob([bytes], { type: transfer.meta.type || 'application/octet-stream' });
    transfer.progress.textContent = `Received ${transfer.meta.name} (${formatBytes(transfer.meta.size)}).`;
    this._renderMediaPreview(blob, 'peer', transfer.meta);
    this.incomingFile = null;
  }

  async _renderIncoming(inner) {
    const appEvent = new CustomEvent('ost:mesh-payload', {
      cancelable: true,
      detail: { payload: inner, pavilion: this }
    });
    window.dispatchEvent(appEvent);
    if (appEvent.defaultPrevented) return;

    if (inner.kind === 'text') {
      this._bubble('peer', `<span class="ts">${new Date(inner.ts || Date.now()).toLocaleTimeString()}</span> ${escapeHtml(inner.text)}`);
      this._persistEntry('peer', 'text', { text: inner.text });
    } else if (inner.kind === 'file-start' || inner.kind === 'file-meta') {
      const meta = inner.kind === 'file-meta'
        ? { ...inner, sealedSize: inner.size || 0, chunks: 1 }
        : inner;
      const progress = this._bubble('system', `Receiving ${escapeHtml(meta.name)} (${formatBytes(meta.size)})…`);
      this.incomingFile = { meta, progress, chunks: [], received: 0 };
    } else if (inner.kind === 'location-ping' || inner.kind === 'location-live') {
      this._renderLocation(inner, 'peer');
    } else if (inner.kind === 'location-live-stop') {
      this._bubble('system', 'Peer stopped live location.');
      this.peerLiveBubble = null;
    } else if (inner.kind === 'call-extend') {
      const minutes = Number(inner.minutes || 15);
      this.callEndsAt = Math.max(this.callEndsAt || Date.now(), Date.now()) + minutes * 60_000;
      this._setCallStatus(`Call prolonged by ${minutes} minutes.`, 'ok');
      this._updateCallTimer();
    } else if (inner.kind === 'call-end') {
      await this._handleRemoteCallEnd(inner.reason || 'ended');
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

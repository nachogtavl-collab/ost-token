/* ============================================================
   mesh/veil.js - automatic OST Mesh presence companion.
   Uses the existing Mesh Pavilion node; does not proxy strangers,
   request geolocation, or promise surveillance immunity.
   ============================================================ */

const VEIL_STYLE_ID = 'ost-veil-style';
const VEIL_ROOT_ID = 'ost-veil-status-pill';
const VEIL_REFRESH_MS = 45_000;
const VEIL_READY_TIMEOUT_MS = 15_000;

const state = {
  active: false,
  address: '',
  fingerprint: '',
  directory: 'starting',
  transport: 'warming',
  lastAnnounce: 0,
  error: ''
};

function injectVeilStyles() {
  if (document.getElementById(VEIL_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = VEIL_STYLE_ID;
  style.textContent = `
    #${VEIL_ROOT_ID} {
      position: fixed;
      right: 18px;
      bottom: 18px;
      z-index: 999390;
      display: inline-flex;
      align-items: center;
      gap: 9px;
      max-width: min(280px, calc(100vw - 36px));
      min-height: 38px;
      padding: 8px 13px;
      border: 1px solid rgba(0, 212, 255, 0.38);
      border-radius: 999px;
      background: rgba(3, 18, 30, 0.92);
      color: #d8f6ff;
      box-shadow: 0 10px 26px rgba(0, 0, 0, 0.38), 0 0 18px rgba(0, 212, 255, 0.22);
      font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      line-height: 1.1;
      pointer-events: none;
      user-select: none;
    }
    #${VEIL_ROOT_ID} .ost-veil-dot {
      width: 9px;
      height: 9px;
      flex: 0 0 auto;
      border-radius: 50%;
      background: #00ff9f;
      box-shadow: 0 0 12px rgba(0, 255, 159, 0.72);
      animation: ost-veil-pulse 2.2s ease-in-out infinite;
    }
    #${VEIL_ROOT_ID}[data-state="warming"] .ost-veil-dot { background: #ffd066; box-shadow: 0 0 12px rgba(255, 208, 102, 0.55); }
    #${VEIL_ROOT_ID}[data-state="offline"] .ost-veil-dot { background: #ff7777; box-shadow: 0 0 12px rgba(255, 119, 119, 0.55); }
    #${VEIL_ROOT_ID} strong {
      display: block;
      color: #00d4ff;
      font-size: 11px;
      font-weight: 800;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      white-space: nowrap;
    }
    #${VEIL_ROOT_ID} span {
      display: block;
      color: #9bcbe6;
      font-size: 11px;
      font-weight: 650;
      max-width: 210px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    @keyframes ost-veil-pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.5; transform: scale(0.86); }
    }
    @media (max-width: 680px) {
      #${VEIL_ROOT_ID} {
        right: 12px;
        bottom: 12px;
        padding: 7px 10px;
      }
      #${VEIL_ROOT_ID} span { max-width: 150px; }
    }
  `;
  document.head.appendChild(style);
}

function ensurePill() {
  injectVeilStyles();
  let root = document.getElementById(VEIL_ROOT_ID);
  if (root) return root;
  root = document.createElement('div');
  root.id = VEIL_ROOT_ID;
  root.setAttribute('role', 'status');
  root.setAttribute('aria-live', 'polite');
  root.dataset.state = 'warming';
  root.innerHTML = `
    <div class="ost-veil-dot" aria-hidden="true"></div>
    <div>
      <strong>OST Veil</strong>
      <span id="ost-veil-status-text">Mesh warming</span>
    </div>
  `;
  document.body.appendChild(root);
  return root;
}

function setStatus(mode, text) {
  const root = ensurePill();
  root.dataset.state = mode;
  const label = document.getElementById('ost-veil-status-text');
  if (label) label.textContent = text;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function meshPavilion() {
  return window.OST_MESH && window.OST_MESH.pavilion;
}

function waitForMesh() {
  const existing = meshPavilion();
  if (existing) return Promise.resolve(existing);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      window.removeEventListener('mesh:ready', onReady);
      reject(new Error('Mesh did not become ready'));
    }, VEIL_READY_TIMEOUT_MS);
    function onReady() {
      clearTimeout(timeout);
      resolve(meshPavilion());
    }
    window.addEventListener('mesh:ready', onReady, { once: true });
  });
}

async function waitForIdentity(pavilion) {
  const started = Date.now();
  while ((!pavilion.address || !pavilion.publicBundle || !pavilion.fpr) && Date.now() - started < VEIL_READY_TIMEOUT_MS) {
    await wait(120);
  }
  if (!pavilion.address || !pavilion.publicBundle) throw new Error('Mesh identity is not ready');
}

function rtcNeedsPassiveListen(pavilion) {
  if (!pavilion || pavilion.peerAddr || pavilion.callState !== 'idle') return false;
  if (!pavilion.rtc) return true;
  const pcState = pavilion.rtc.pc && pavilion.rtc.pc.connectionState;
  const dcState = pavilion.rtc.dc && pavilion.rtc.dc.readyState;
  return pcState === 'failed' || pcState === 'closed' || dcState === 'closed';
}

async function warmMeshPresence(pavilion) {
  await waitForIdentity(pavilion);
  if (typeof pavilion._announceNow === 'function') {
    await pavilion._announceNow({ silent: true });
    state.lastAnnounce = Date.now();
    state.directory = 'live';
  }
  if (rtcNeedsPassiveListen(pavilion) && typeof pavilion._startRTC === 'function') {
    pavilion._startRTC('callee', { passive: true });
  }
  state.active = true;
  state.address = pavilion.address || '';
  state.fingerprint = pavilion.fpr || '';
  state.transport = pavilion.rtc ? 'ready' : 'warming';
  state.error = '';
  setStatus('active', 'Mesh node active');
}

function watchTransport(pavilion) {
  if (!pavilion || !pavilion.rtc || pavilion.rtc.__veilWatched) return;
  pavilion.rtc.__veilWatched = true;
  pavilion.rtc.addEventListener('open', () => {
    state.transport = 'p2p-open';
    setStatus('active', 'Encrypted peer link open');
  });
  pavilion.rtc.addEventListener('close', () => {
    state.transport = 'idle';
    setStatus('warming', 'Mesh node standing by');
  });
  pavilion.rtc.addEventListener('state', (event) => {
    if (event.detail && event.detail.state === 'failed') {
      state.transport = 'failed';
      setStatus('offline', 'Mesh transport retrying');
    }
  });
}

async function startVeil() {
  ensurePill();
  setStatus('warming', 'Mesh warming');
  try {
    const pavilion = await waitForMesh();
    await warmMeshPresence(pavilion);
    watchTransport(pavilion);
    setInterval(async () => {
      try {
        await warmMeshPresence(pavilion);
        watchTransport(pavilion);
      } catch (err) {
        state.error = err.message;
        state.directory = navigator.onLine ? 'degraded' : 'offline';
        setStatus(navigator.onLine ? 'warming' : 'offline', navigator.onLine ? 'Mesh retrying' : 'Offline');
      }
    }, VEIL_REFRESH_MS);
  } catch (err) {
    state.error = err.message;
    setStatus('offline', 'Mesh unavailable');
  }
}

window.addEventListener('online', () => setStatus('warming', 'Mesh reconnecting'));
window.addEventListener('offline', () => setStatus('offline', 'Offline'));

window.OST_VEIL = {
  status: () => ({ ...state }),
  refresh: async () => {
    const pavilion = await waitForMesh();
    await warmMeshPresence(pavilion);
    return { ...state };
  }
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startVeil, { once: true });
} else {
  startVeil();
}

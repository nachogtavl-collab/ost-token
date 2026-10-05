/* ==========================================================================
 * OST · Mesh calls — voice + video calls between contacts (WebRTC)
 * --------------------------------------------------------------------------
 * Plugs into ost-mesh-app.js (window.OST_MESH_APP.core):
 *   · ICE servers from the worker (/mesh/v1/ice → Cloudflare TURN), so calls
 *     connect across networks (LTE ↔ Wi-Fi), not just on the same LAN.
 *   · Signaling over the hub WebSocket (instant); HTTP relay + inbox polling
 *     when the socket is unavailable.
 *   · Offers/answers are signed with the caller's mesh ECDSA key and verified
 *     against the contact's directory bundle — nobody can ring you as someone
 *     else. Media is DTLS-SRTP encrypted end to end by WebRTC itself.
 *   · Missed / declined calls land in the chat through the 7-day mailbox.
 * window.OST_MESH_CALL.{ start(peer, video), state() }
 * ========================================================================== */
import { importPeerBundle } from './mesh/mesh-crypto.js?v=1';

(function boot() {
  if (window.OST_MESH_CALL) return;
  const core = window.OST_MESH_APP && window.OST_MESH_APP.core;
  if (!core) { window.addEventListener('ost:mesh-app:core', boot, { once: true }); return; }
  const { S, X, API, esc, toast, nameOf, emojiOf, avStyle, contact, lookup, signal } = core;
  const RING_MS = 45000;
  const enc = new TextEncoder();
  const hex = (b) => Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, '0')).join('');
  const b64 = (buf) => { let s = ''; const u = new Uint8Array(buf); for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s); };
  const unb64 = (s) => { const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
  const $ = (id) => document.getElementById(id);

  let C = null;          // active call
  const seen = new Set();
  let iceCache = { at: 0, servers: null };

  async function iceServers() {
    if (iceCache.servers && Date.now() - iceCache.at < 30 * 60 * 1000) return iceCache.servers;
    try {
      const r = await fetch(API + '/mesh/v1/ice', { cache: 'no-store' });
      const j = await r.json();
      if (j && Array.isArray(j.iceServers) && j.iceServers.length) { iceCache = { at: Date.now(), servers: j.iceServers }; return j.iceServers; }
    } catch (_) {}
    return [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }];
  }

  /* ---------- signing ---------- */
  async function sigMsg(p, from, to) { return `OMX-CALL|${p.type}|${p.callId}|${from}|${to}|${hex(await crypto.subtle.digest('SHA-256', enc.encode(p.sdp || '')))}|${p.ts}`; }
  async function signP(p, to) { const m = await sigMsg(p, S.address, to); p.sig = b64(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-384' }, S.identity.sig.privateKey, enc.encode(m))); return p; }
  async function verifyP(p, from) {
    try {
      if (!p.sig || Math.abs(Date.now() - Number(p.ts)) > 120000) return false;
      let c = contact(from), bundle = c && c.bundle;
      if (!bundle) { const rec = await lookup(from); bundle = rec && rec.bundle; }
      if (!bundle) return false;
      const { sigPub } = await importPeerBundle(bundle);
      return await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-384' }, sigPub, unb64(p.sig), enc.encode(await sigMsg(p, from, S.address)));
    } catch (_) { return false; }
  }
  function send(to, p) { return signal(to, Object.assign({ t: 'omx-call' }, p)); }

  /* ---------- UI ---------- */
  function ui() {
    let el = $('omxCall');
    if (!el) {
      el = document.createElement('div'); el.id = 'omxCall';
      el.innerHTML = `<video id="omxCallRemote" autoplay playsinline></video><audio id="omxCallAudio" autoplay></audio>
        <div class="omxc-top"><div class="omxc-av" id="omxCallAv"></div><b id="omxCallName"></b><span id="omxCallState"></span></div>
        <video id="omxCallLocal" autoplay playsinline muted></video>
        <div class="omxc-btns" id="omxCallBtns"></div>`;
      document.body.appendChild(el);
      el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-labelledby', 'omxCallName'); el.tabIndex = -1;
      el.addEventListener('click', onUiClick);
      // A call screen swallows Escape (hanging up must be a deliberate tap) and keeps Tab on its own buttons.
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); return; }
        if (e.key !== 'Tab') return;
        const f = Array.from(el.querySelectorAll('button')); if (!f.length) { e.preventDefault(); return; }
        const i = f.indexOf(document.activeElement);
        if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && (i < 0 || i === f.length - 1)) { e.preventDefault(); f[0].focus(); }
      });
    }
    return el;
  }
  // The call screen exists in the DOM only while a call is up (the core's Escape
  // handler treats any #omxCall as "a call owns the keyboard").
  function paint() {
    document.documentElement.classList.toggle('omx-incall', !!C);   // toasts move to the top, off the call buttons
    if (!C) { const old = $('omxCall'); if (old) { old.classList.remove('on'); old.remove(); } return; }
    const el = ui(), shown = el.classList.contains('on');
    const ae = document.activeElement, keep = ae && el.contains(ae) ? ae.getAttribute('data-c') : '';
    el.classList.add('on'); el.classList.toggle('video', !!C.video); el.classList.toggle('live', C.phase === 'live');
    const av = $('omxCallAv'); av.setAttribute('style', avStyle(C.peer)); av.textContent = emojiOf(C.peer) || nameOf(C.peer)[0].toUpperCase();
    $('omxCallName').textContent = nameOf(C.peer);
    const st = C.phase === 'incoming' ? (C.video ? 'Incoming video call…' : 'Incoming voice call…')
      : C.phase === 'calling' ? (C.ringing ? 'Ringing…' : 'Calling…')
      : C.phase === 'connecting' ? 'Connecting…'
      : C.phase === 'live' ? timer() + (C.relay ? ' · relayed' : '') + (C.muted ? ' · muted' : '')
      : C.phase === 'reconnecting' ? 'Reconnecting…' : '';
    $('omxCallState').textContent = st;
    const b = [];
    if (C.phase === 'incoming') {
      b.push('<button class="omxc-no" data-c="decline" aria-label="Decline">✕<small>Decline</small></button>');
      b.push('<button class="omxc-yes" data-c="accept" aria-label="Accept">📞<small>Accept</small></button>');
      if (C.video) b.push('<button class="omxc-yes" data-c="accept-video" aria-label="Accept with video">🎥<small>Video</small></button>');
    } else {
      b.push(`<button data-c="mute" class="${C.muted ? 'off' : ''}" aria-label="Mute">${C.muted ? '🔇' : '🎙️'}<small>${C.muted ? 'Unmute' : 'Mute'}</small></button>`);
      const hasCam = !!(C.local && C.local.getVideoTracks().length);
      if (hasCam) { b.push(`<button data-c="cam" class="${C.camOff ? 'off' : ''}" aria-label="Camera">${C.camOff ? '🚫' : '📷'}<small>Camera</small></button>`); b.push('<button data-c="flip" aria-label="Flip camera">🔄<small>Flip</small></button>'); }
      b.push('<button class="omxc-no" data-c="hangup" aria-label="Hang up">✕<small>End</small></button>');
    }
    $('omxCallBtns').innerHTML = b.join('');
    // Keyboard focus: the screen itself when it appears; the same button across repaints (the timer repaints every second).
    try { const same = keep && el.querySelector('[data-c="' + keep + '"]'); if (same) same.focus({ preventScroll: true }); else if (!shown || (keep && !same)) el.focus({ preventScroll: true }); } catch (_) {}
  }
  function timer() { if (!C || !C.liveAt) return '0:00'; const s = Math.floor((Date.now() - C.liveAt) / 1000); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
  let tickIv = null;
  function onUiClick(e) {
    const t = e.target.closest('[data-c]'); if (!t || !C) return;
    const c = t.getAttribute('data-c');
    if (c === 'accept') accept(false);
    else if (c === 'accept-video') accept(true);
    else if (c === 'decline') decline();
    else if (c === 'hangup') hangup('ended', true);
    else if (c === 'mute') { C.muted = !C.muted; (C.local ? C.local.getAudioTracks() : []).forEach((tr) => { tr.enabled = !C.muted; }); paint(); }
    else if (c === 'cam') { C.camOff = !C.camOff; (C.local ? C.local.getVideoTracks() : []).forEach((tr) => { tr.enabled = !C.camOff; }); paint(); }
    else if (c === 'flip') flip();
  }

  /* ---------- ringtone ---------- */
  let ringCtx = null, ringIv = null;
  function ring(on) {
    clearInterval(ringIv); ringIv = null;
    try { if (navigator.vibrate) navigator.vibrate(on ? [400, 200, 400] : 0); } catch (_) {}
    if (!on) return;
    const beep = () => {
      try {
        ringCtx = ringCtx || new (window.AudioContext || window.webkitAudioContext)();
        const o = ringCtx.createOscillator(), g = ringCtx.createGain();
        o.frequency.value = C && C.phase === 'incoming' ? 660 : 440; g.gain.value = 0.06;
        o.connect(g); g.connect(ringCtx.destination); o.start(); o.stop(ringCtx.currentTime + 0.9);
      } catch (_) {}
      try { if (navigator.vibrate && C && C.phase === 'incoming') navigator.vibrate([400, 200, 400]); } catch (_) {}
    };
    beep(); ringIv = setInterval(beep, 2400);
  }

  /* ---------- media ---------- */
  async function media(video) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('Calls need a browser with microphone access (HTTPS).');
    try { return await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: video ? { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } } : false }); }
    catch (e) {
      if (video) { toast('Camera unavailable — joining with audio only.', 'err'); return navigator.mediaDevices.getUserMedia({ audio: true, video: false }); }
      throw new Error(e && e.name === 'NotAllowedError' ? 'Microphone permission denied — allow it in your browser settings.' : 'No microphone available.');
    }
  }
  async function flip() {
    if (!C || !C.local || !C.pc) return;
    C.facing = C.facing === 'environment' ? 'user' : 'environment';
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: C.facing }, audio: false });
      const nt = s.getVideoTracks()[0]; if (!nt) return;
      const snd = C.pc.getSenders().find((x) => x.track && x.track.kind === 'video');
      if (snd) await snd.replaceTrack(nt);
      C.local.getVideoTracks().forEach((t) => { C.local.removeTrack(t); t.stop(); });
      C.local.addTrack(nt); $('omxCallLocal').srcObject = C.local;
    } catch (_) { toast('Could not switch camera', 'err'); }
  }
  function attachLocal() { const v = $('omxCallLocal'); if (v && C && C.local) { v.srcObject = C.local; v.hidden = !C.video; } }
  function newPc(servers) {
    const pc = new RTCPeerConnection({ iceServers: servers });
    pc.onicecandidate = (e) => { if (e.candidate && C && C.pc === pc) send(C.peer, { type: 'ice', callId: C.callId, c: e.candidate.toJSON() }); };
    pc.ontrack = (e) => {
      if (!C) return;
      const stream = e.streams && e.streams[0] ? e.streams[0] : new MediaStream([e.track]);
      const v = $('omxCallRemote'), a = $('omxCallAudio');
      if (C.video) { v.srcObject = stream; v.play().catch(() => {}); } else { a.srcObject = stream; a.play().catch(() => {}); }
    };
    pc.onconnectionstatechange = () => {
      if (!C || C.pc !== pc) return;
      const st = pc.connectionState;
      if (st === 'connected') {
        if (C.phase !== 'live') { C.phase = 'live'; C.liveAt = C.liveAt || Date.now(); ring(false); clearTimeout(C.ringTimer); }
        else C.phase = 'live';
        detectRelay(pc); paint();
        clearInterval(tickIv); tickIv = setInterval(() => { if (C && C.phase === 'live') { const s = $('omxCallState'); if (s) s.textContent = timer() + (C.relay ? ' · relayed' : '') + (C.muted ? ' · muted' : ''); } }, 1000);
      } else if (st === 'disconnected') { C.phase = 'reconnecting'; paint(); setTimeout(() => { if (C && C.pc === pc && pc.connectionState === 'disconnected') restartIce(); }, 4000); }
      else if (st === 'failed') { if (!C.restarted) restartIce(); else hangup('ended', true, 'Connection lost'); }
    };
    return pc;
  }
  async function detectRelay(pc) {
    try { const stats = await pc.getStats(); stats.forEach((r) => { if (r.type === 'candidate-pair' && r.state === 'succeeded' && r.nominated) { const l = stats.get(r.localCandidateId); if (l && l.candidateType === 'relay' && C) { C.relay = true; } } }); } catch (_) {}
  }
  async function restartIce() {
    if (!C || !C.pc || C.restarted || !C.caller) return;
    C.restarted = true; C.phase = 'reconnecting'; paint();
    try {
      const offer = await C.pc.createOffer({ iceRestart: true });
      await C.pc.setLocalDescription(offer);
      send(C.peer, await signP({ type: 'offer', callId: C.callId, video: C.video, sdp: C.pc.localDescription.sdp, ts: Date.now(), restart: true }, C.peer));
    } catch (_) { hangup('ended', true, 'Connection lost'); }
  }
  async function flushIce() { if (!C || !C.pc || !C.pc.remoteDescription) return; const q = C.iceQ.splice(0); for (const c of q) { try { await C.pc.addIceCandidate(c); } catch (_) {} } }

  /* ---------- outgoing ---------- */
  async function start(peer, video) {
    if (C) { toast('You are already in a call.'); return; }
    const ct = contact(peer);
    if (ct && ct.state === 'blocked') { toast('Unblock this contact to call.', 'err'); return; }
    C = { peer, video: !!video, caller: true, phase: 'calling', callId: 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8), iceQ: [], facing: 'user' };
    paint(); ring(true);
    try {
      const [servers, local] = await Promise.all([iceServers(), media(video)]);
      if (!C) { local.getTracks().forEach((t) => t.stop()); return; }
      C.local = local; C.video = C.video && local.getVideoTracks().length > 0; attachLocal(); paint();
      C.pc = newPc(servers);
      local.getTracks().forEach((t) => C.pc.addTrack(t, local));
      const offer = await C.pc.createOffer();
      await C.pc.setLocalDescription(offer);
      await send(peer, await signP({ type: 'offer', callId: C.callId, video: C.video, sdp: C.pc.localDescription.sdp, ts: Date.now() }, peer));
      pollSoon();
      C.ringTimer = setTimeout(() => { if (C && C.phase === 'calling') { send(peer, { type: 'cancel', callId: C.callId }); logCall('missed', true); hangup('missed', false, 'No answer'); } }, RING_MS);
    } catch (e) { toast(e.message || 'Call failed', 'err'); teardown(); }
  }

  /* ---------- incoming ---------- */
  async function onSignal(item) {
    if (!item || !item.payload || item.payload.t !== 'omx-call') return;
    const key = item.id || (item.from + ':' + item.payload.type + ':' + item.payload.callId + ':' + (item.payload.ts || (item.payload.c && item.payload.c.candidate)));
    if (seen.has(key)) return; seen.add(key); if (seen.size > 2000) seen.clear();
    const p = item.payload, from = item.from;
    if (p.type === 'offer') {
      if (C && C.callId === p.callId && C.pc) {         // ICE-restart renegotiation
        if (!(await verifyP(p, from))) return;
        await C.pc.setRemoteDescription({ type: 'offer', sdp: p.sdp });
        const ans = await C.pc.createAnswer(); await C.pc.setLocalDescription(ans);
        send(from, await signP({ type: 'answer', callId: p.callId, sdp: C.pc.localDescription.sdp, ts: Date.now() }, from));
        return;
      }
      // Only people you know can ring you: contacts, and people you asked to connect.
      // Strangers who wrote first ('request'), unanswered requests and blocked contacts never ring.
      const ct = contact(from);
      if (!ct || (ct.state !== 'friend' && ct.state !== 'pending-out')) return;
      if (Math.abs(Date.now() - Number(p.ts)) > RING_MS) return;
      if (!(await verifyP(p, from))) { console.warn('[mesh-call] unsigned/forged offer ignored'); return; }
      if (C) { send(from, { type: 'busy', callId: p.callId }); return; }
      C = { peer: from, video: !!p.video, caller: false, phase: 'incoming', callId: p.callId, offer: p, iceQ: [], facing: 'user' };
      paint(); ring(true);
      send(from, { type: 'ringing', callId: p.callId });
      try {
        if (!document.hidden) { /* the call screen itself is the alert */ }
        else if (window.OST_NOTIFY && typeof window.OST_NOTIFY.mesh === 'function') window.OST_NOTIFY.mesh(p.video ? 'video-call' : 'call', (p.video ? 'Video' : 'Voice') + ' call from ' + nameOf(from), 'Open OST to answer', { tag: 'ost-mesh-call-' + from, addr: from });
        else if ('Notification' in window && Notification.permission === 'granted') new Notification((p.video ? 'Video' : 'Voice') + ' call from ' + nameOf(from));
      } catch (_) {}
      C.ringTimer = setTimeout(() => { if (C && C.phase === 'incoming') { logLocal('missed'); teardown(); } }, RING_MS);
      return;
    }
    if (!C || p.callId !== C.callId || from !== C.peer) return;
    if (p.type === 'answer' && C.caller) {
      if (!(await verifyP(p, from))) return;
      C.phase = C.phase === 'live' ? 'live' : 'connecting'; ring(false); clearTimeout(C.ringTimer); paint();
      await C.pc.setRemoteDescription({ type: 'answer', sdp: p.sdp }); await flushIce();
    } else if (p.type === 'ringing' && C.caller) { C.ringing = true; paint(); }
    else if (p.type === 'ice' && p.c) { if (C.pc && C.pc.remoteDescription) { try { await C.pc.addIceCandidate(p.c); } catch (_) {} } else C.iceQ.push(p.c); }
    else if (p.type === 'decline') { if (C.caller) logCall('declined', true); hangup('declined', false, nameOf(from) + ' declined'); }
    else if (p.type === 'busy') { hangup('busy', false, nameOf(from) + ' is on another call'); logLocal('busy'); }
    else if (p.type === 'cancel') { if (C.phase === 'incoming') logLocal('missed'); teardown(); }
    else if (p.type === 'end') hangup('ended', false, 'Call ended');
  }
  async function accept(withVideo) {
    if (!C || C.phase !== 'incoming') return;
    ring(false); clearTimeout(C.ringTimer);
    C.phase = 'connecting'; C.video = !!(withVideo && C.offer.video); paint();
    try {
      const [servers, local] = await Promise.all([iceServers(), media(C.video)]);
      if (!C) { local.getTracks().forEach((t) => t.stop()); return; }
      C.local = local; attachLocal();
      C.pc = newPc(servers);
      // Keep video when the caller sends video even if we answer audio-only.
      if (C.offer.video && !C.video) C.video = true;
      local.getTracks().forEach((t) => C.pc.addTrack(t, local));
      await C.pc.setRemoteDescription({ type: 'offer', sdp: C.offer.sdp });
      await flushIce();
      const ans = await C.pc.createAnswer(); await C.pc.setLocalDescription(ans);
      await send(C.peer, await signP({ type: 'answer', callId: C.callId, sdp: C.pc.localDescription.sdp, ts: Date.now() }, C.peer));
      paint(); pollSoon();
    } catch (e) { toast(e.message || 'Could not answer', 'err'); send(C.peer, { type: 'decline', callId: C.callId }); teardown(); }
  }
  function decline() { if (!C) return; send(C.peer, { type: 'decline', callId: C.callId }); logLocal('declined'); teardown(); }
  function hangup(status, notify, msg) {
    if (!C) return;
    if (notify) send(C.peer, { type: C.phase === 'calling' ? 'cancel' : 'end', callId: C.callId });
    if (C.liveAt) logLocal('ended', Math.round((Date.now() - C.liveAt) / 1000));
    else if (notify && C.caller && C.phase === 'calling') logCall('missed', true);
    if (msg) toast(msg);
    teardown();
  }
  function teardown() {
    ring(false); clearInterval(tickIv);
    if (C) {
      clearTimeout(C.ringTimer);
      try { if (C.local) C.local.getTracks().forEach((t) => t.stop()); } catch (_) {}
      try { if (C.pc) C.pc.close(); } catch (_) {}
    }
    C = null;
    try { $('omxCallRemote').srcObject = null; $('omxCallAudio').srcObject = null; $('omxCallLocal').srcObject = null; } catch (_) {}
    paint();
  }
  // Local call log line (no network). `cst` = call outcome (Declined / No answer /
  // Missed stay visible); `status` is never a delivery state for these.
  const outcomeText = (status, mine) => status === 'missed' ? (mine ? 'No answer' : 'Missed call') : status === 'declined' ? 'Declined call' : status === 'busy' ? 'Busy' : 'Call';
  function logLocal(status, dur) {
    if (!C) return;
    const m = { id: 'call-' + C.callId + '-' + status, dir: C.caller ? 'me' : 'them', kind: 'call', status, cst: status, video: !!C.video, dur: dur || 0, ts: Date.now() };
    core.appendMsg(C.peer, m);
    core.upsertContact(C.peer, { last: { text: (C.video ? '🎥 ' : '📞 ') + outcomeText(status, C.caller), ts: m.ts } });
    if (S.view === 'chat' && S.peer === C.peer) core.paintMsgs();
  }
  // Durable record for the other side (offline users see "Missed call").
  function logCall(status, mine) {
    if (!C) return;
    const peer = C.peer, video = C.video, id = 'call-' + C.callId + '-' + status;
    core.sendInner(peer, { k: 'call', id, status, video }, mine ? { kind: 'call', status, cst: status, video } : null).catch(() => {});
  }

  /* ---------- transport: socket push + polling fallback ---------- */
  X.ws.push((m) => { if (m.t === 'signal' && m.item) onSignal(m.item); });
  // Honours HTTP 429 / Retry-After from the relay and the core's shared breaker.
  let pollT = null, pollFast = 0, pollWaitUntil = 0, pollFails = 0;
  function pollSoon() { pollFast = Date.now() + 60000; schedule(400); }
  function schedule(ms) { clearTimeout(pollT); pollT = setTimeout(poll, Math.max(ms, pollWaitUntil - Date.now())); }
  async function poll() {
    const busy = !!C || Date.now() < pollFast;
    const gated = (core.hubBusy && core.hubBusy()) || Date.now() < pollWaitUntil;
    const want = !gated && !document.hidden && S.address && Object.keys(S.contacts).length && (!S.wsOk || busy);
    if (want) {
      try {
        const r = await fetch(API + '/mesh/v1/signal/inbox?to=' + encodeURIComponent(S.address), { cache: 'no-store' });
        if (r.status === 429 || r.status >= 500) {
          let s = Number(r.headers.get('Retry-After')) || 0; pollFails++;
          pollWaitUntil = Date.now() + Math.min(120, Math.max(s, 2 * Math.pow(2, Math.min(5, pollFails - 1)))) * 1000;
        } else {
          pollFails = 0;
          const j = await r.json();
          for (const it of (j && j.messages) || []) await onSignal(it);
        }
      } catch (_) { pollFails++; pollWaitUntil = Date.now() + Math.min(60, 2 * Math.pow(2, Math.min(4, pollFails - 1))) * 1000; }
    }
    schedule(busy ? 1200 : (S.wsOk ? 15000 : 3500));
  }
  schedule(3000);

  /* ---------- hooks into the chat ---------- */
  // Header buttons; under 400 px they are hidden by CSS and offered in the chat ⋯ sheet instead.
  const narrow = () => !!(window.matchMedia && window.matchMedia('(max-width: 399.98px)').matches);
  X.headBtns.push((peer) => `<button type="button" class="omx-ib omx-hide-narrow" data-act="call-voice" aria-label="Voice call" title="Voice call">📞</button><button type="button" class="omx-ib omx-hide-narrow" data-act="call-video" aria-label="Video call" title="Video call">🎥</button>`);
  if (Array.isArray(X.menu)) X.menu.push((peer) => narrow() ? [{ label: '📞 Voice call', run: () => start(peer, false) }, { label: '🎥 Video call', run: () => start(peer, true) }] : []);
  X.actions['call-voice'] = () => start(S.peer, false);
  X.actions['call-video'] = () => start(S.peer, true);
  X.actions['call-back'] = (el) => start(S.peer, el.getAttribute('data-video') === '1');
  window.addEventListener('beforeunload', () => { if (C) send(C.peer, { type: C.phase === 'incoming' ? 'decline' : 'end', callId: C.callId }); });

  window.OST_MESH_CALL = { start, state: () => (C ? { peer: C.peer, phase: C.phase, video: C.video, relay: !!C.relay, callId: C.callId } : null), hangup: () => hangup('ended', true) };
})();

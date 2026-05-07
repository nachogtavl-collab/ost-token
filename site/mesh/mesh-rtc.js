/* ============================================================
   mesh/mesh-rtc.js — WebRTC peer transport for OST Mesh
   ----
   Two roles:
     • Caller   : creates offer, posts to worker signaling, polls answer
     • Callee   : polls offers for its inbox, posts answer
   Public STUN only (Google). No TURN by default — mesh relays come
   in Phase 2 (other OST users earning rewards as relay nodes).
   ============================================================ */

const STUN = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' }
];

const POLL_MS = 1500;
const POLL_BUDGET_MS = 5 * 60_000;
const BUFFER_HIGH_WATER = 1024 * 1024;
const BUFFER_LOW_WATER = 256 * 1024;
const SIGNAL_MAX_AGE_MS = 90_000;
const SIGNAL_SEEN_LIMIT = 1024;

const SEEN_SIGNAL_IDS = new Set();

export class MeshRTC extends EventTarget {
  constructor({ apiBase, myAddress, peerAddress }) {
    super();
    this.apiBase = apiBase;
    this.me = myAddress;
    this.peer = peerAddress || '';
    this.pc = null;
    this.dc = null;
    this.localStream = null;
    this.remoteStream = null;
    this.role = null;
    this._stopPolling = false;
    this._pendingOffer = null;
    this._pendingIce = [];
    this._localIceBuffer = [];
    this._suppressIce = false;
    this._callId = null;
  }

  _signalCall(extra = {}) {
    return this._callId ? { id: this._callId, ...extra } : extra;
  }

  _signalMatches(sig) {
    const incomingId = sig?.call?.id || '';
    return !incomingId || !this._callId || incomingId === this._callId;
  }

  _staleOffer(sig) {
    const ts = Number(sig?.call?.ts || 0);
    return Number.isFinite(ts) && ts > 0 && Date.now() - ts > SIGNAL_MAX_AGE_MS;
  }

  _rememberSignal(item) {
    const payload = item?.payload || {};
    const id = item?.id || [item?.from || '', item?.ts || '', payload.type || '', payload.call?.id || ''].join(':');
    if (SEEN_SIGNAL_IDS.has(id)) return false;
    SEEN_SIGNAL_IDS.add(id);
    if (SEEN_SIGNAL_IDS.size > SIGNAL_SEEN_LIMIT) SEEN_SIGNAL_IDS.clear();
    return true;
  }

  _resetPeerConnection() {
    try { this.dc?.close(); } catch {}
    try { this.pc?.close(); } catch {}
    this.dc = null;
    this.pc = this._newPC();
    this.remoteStream = null;
    this._pendingIce = [];
    this._localIceBuffer = [];
    this._suppressIce = false;
  }

  _emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  _newPC() {
    const pc = new RTCPeerConnection({ iceServers: STUN });
    pc.onicecandidate = (e) => {
      if (e.candidate) {
        if (this._suppressIce) {
          this._localIceBuffer.push(e.candidate.toJSON());
          return;
        }
        this._postSignal({ type: 'ice', candidate: e.candidate.toJSON(), call: this._signalCall() });
      }
    };
    pc.onconnectionstatechange = () => {
      this._emit('state', { state: pc.connectionState });
      if (pc.connectionState === 'connected') this._emit('call-connected', {});
    };
    pc.ondatachannel = (e) => {
      this._bindDataChannel(e.channel);
    };
    pc.ontrack = (e) => {
      if (!this.remoteStream) {
        this.remoteStream = new MediaStream();
        this._emit('remote-stream', { stream: this.remoteStream });
      }
      this.remoteStream.addTrack(e.track);
    };
    return pc;
  }

  _bindDataChannel(dc) {
    this.dc = dc;
    dc.binaryType = 'arraybuffer';
    dc.onopen = () => this._emit('open', {});
    dc.onclose = () => this._emit('close', {});
    dc.onmessage = (e) => this._emit('message', { data: e.data });
  }

  isOpen() {
    return !!this.dc && this.dc.readyState === 'open';
  }

  /** Start as caller — creates data channel and offer, polls for answer. */
  async call({ withMedia = false, video = false } = {}) {
    this.role = 'caller';
    this._callId = crypto.randomUUID?.() || String(Date.now());
    this.pc = this._newPC();

    if (withMedia) {
      this.localStream = await this._getLocalMedia({ audio: true, video });
      for (const t of this.localStream.getTracks()) this.pc.addTrack(t, this.localStream);
      this._emit('local-stream', { stream: this.localStream });
    }

    const dc = this.pc.createDataChannel('ost-mesh', { ordered: true });
    this._bindDataChannel(dc);

    const offer = await this.pc.createOffer();
    this._suppressIce = true;
    try {
      await this.pc.setLocalDescription(offer);
      await this._waitForIceGathering();
      await this._postSignal({
        type: 'offer',
        sdp: this.pc.localDescription.sdp,
        call: { id: this._callId, withMedia, video, ts: Date.now() }
      });
    } finally {
      this._localIceBuffer = [];
      this._suppressIce = false;
    }

    this._pollLoop();
  }

  /** Start as callee — waits for offer, returns answer. */
  async listen({ withMedia = false, video = false } = {}) {
    this.role = 'callee';
    this.pc = this._newPC();

    if (withMedia) {
      this.localStream = await this._getLocalMedia({ audio: true, video });
      for (const t of this.localStream.getTracks()) this.pc.addTrack(t, this.localStream);
      this._emit('local-stream', { stream: this.localStream });
    }

    this._pollLoop();
  }

  async acceptIncoming({ audio = true, video = false } = {}) {
    if (!this._pendingOffer) throw new Error('no incoming call');
    const { sig, from } = this._pendingOffer;
    this._pendingOffer = null;
    this.role = 'callee';
    if (from) this.peer = from;

    if (sig.call?.withMedia) {
      try { this.dc?.close(); } catch {}
      try { this.pc?.close(); } catch {}
      if (this.localStream) {
        for (const track of this.localStream.getTracks()) track.stop();
      }
      this.pc = null;
      this.dc = null;
      this.localStream = null;
      this.remoteStream = null;
      this._localIceBuffer = [];
      this._suppressIce = false;
    }

    if (!this.pc) this.pc = this._newPC();

    if (sig.call?.withMedia) {
      this.localStream = await this._getLocalMedia({ audio, video });
      for (const t of this.localStream.getTracks()) this.pc.addTrack(t, this.localStream);
      this._emit('local-stream', { stream: this.localStream });
    }

    await this._answerOffer(sig);
  }

  async declineIncoming(reason = 'declined') {
    const pending = this._pendingOffer;
    this._pendingOffer = null;
    if (pending?.from) this.peer = pending.from;
    await this._postSignal({ type: 'call-decline', reason, call: pending?.sig?.call || this._signalCall() });
    this._emit('call-decline', { reason });
  }

  async extendCall(minutes = 15) {
    await this._postSignal({ type: 'call-extend', minutes, ts: Date.now(), call: this._signalCall() });
  }

  async endCall(reason = 'ended') {
    await this._postSignal({ type: 'call-end', reason, ts: Date.now(), call: this._signalCall() });
    this.hangup({ notify: false });
  }

  async _getLocalMedia(constraints) {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('camera/microphone unavailable');
    return navigator.mediaDevices.getUserMedia(constraints);
  }

  async _handleSignal(sig, from) {
    if (!this.pc) return;
    if (from && !this.peer) {
      this.peer = from;
      this._emit('peer', { address: from });
    }
    if (sig.type === 'offer') {
      if (this._staleOffer(sig)) return;
      const incomingId = sig.call?.id || '';
      if (incomingId && this._callId && incomingId !== this._callId) this._resetPeerConnection();
      if (incomingId) this._callId = incomingId;
      if (sig.call?.withMedia) {
        this._pendingOffer = { sig, from };
        this._emit('incoming-call', {
          from,
          video: !!sig.call.video,
          withMedia: true,
          call: sig.call
        });
        return;
      }
      if (!this.pc || this.pc.localDescription || this.pc.remoteDescription) this._resetPeerConnection();
      await this._answerOffer(sig);
    } else if (sig.type === 'answer' && this.role === 'caller') {
      if (!this._signalMatches(sig)) return;
      await this.pc.setRemoteDescription({ type: 'answer', sdp: sig.sdp });
      await this._flushPendingIce();
    } else if (sig.type === 'ice' && sig.candidate) {
      if (!this._signalMatches(sig)) return;
      const pending = { candidate: sig.candidate, callId: sig.call?.id || null };
      if (this._pendingOffer) {
        this._pendingIce.push(pending);
        return;
      }
      if (this.pc.remoteDescription) {
        try { await this.pc.addIceCandidate(sig.candidate); } catch {}
      } else {
        this._pendingIce.push(pending);
      }
    } else if (sig.type === 'call-decline') {
      if (!this._signalMatches(sig)) return;
      this._emit('call-decline', { reason: sig.reason || 'declined' });
    } else if (sig.type === 'call-end') {
      if (!this._signalMatches(sig)) return;
      this._emit('call-end', { reason: sig.reason || 'ended' });
      this.hangup({ notify: false });
    } else if (sig.type === 'call-extend') {
      if (!this._signalMatches(sig)) return;
      this._emit('call-extend', { minutes: sig.minutes || 15 });
    }
  }

  async _answerOffer(sig) {
    await this.pc.setRemoteDescription({ type: 'offer', sdp: sig.sdp });
    await this._flushPendingIce();
    const answer = await this.pc.createAnswer();
    this._suppressIce = true;
    try {
      await this.pc.setLocalDescription(answer);
      await this._waitForIceGathering();
      await this._postSignal({ type: 'answer', sdp: this.pc.localDescription.sdp, call: sig.call || null });
    } finally {
      this._localIceBuffer = [];
      this._suppressIce = false;
    }
  }

  async _waitForIceGathering() {
    if (!this.pc || this.pc.iceGatheringState === 'complete') return;
    await new Promise((resolve) => {
      const done = () => {
        this.pc?.removeEventListener?.('icegatheringstatechange', onChange);
        resolve();
      };
      const onChange = () => {
        if (!this.pc || this.pc.iceGatheringState === 'complete') done();
      };
      this.pc.addEventListener?.('icegatheringstatechange', onChange);
      setTimeout(done, 2200);
    });
  }

  async _flushPendingIce() {
    if (!this.pc?.remoteDescription || !this._pendingIce.length) return;
    const pending = this._pendingIce.splice(0);
    for (const item of pending) {
      if (item.callId && this._callId && item.callId !== this._callId) continue;
      try { await this.pc.addIceCandidate(item.candidate || item); } catch {}
    }
  }

  async _pollLoop() {
    const start = Date.now();
    let cursor = 0;
    while (!this._stopPolling && Date.now() - start < POLL_BUDGET_MS) {
      try {
        const r = await fetch(
          `${this.apiBase}/mesh/v1/signal/inbox?to=${encodeURIComponent(this.me)}${this.peer ? '&from=' + encodeURIComponent(this.peer) : ''}&since=${cursor}`
        );
        if (r.ok) {
          const data = await r.json();
          const messages = data.messages || [];
          const latestOffer = new Map();
          for (const item of messages) {
            if (item.payload?.type === 'offer') latestOffer.set(item.from || '', item);
          }
          for (const item of messages) {
            cursor = Math.max(cursor, item.ts || cursor);
            if (item.payload?.type === 'offer' && latestOffer.get(item.from || '') !== item) continue;
            if (!this._rememberSignal(item)) continue;
            if (item.payload) {
              await this._handleSignal(item.payload, item.from);
            }
          }
        }
      } catch {}
      await new Promise((res) => setTimeout(res, POLL_MS));
    }
  }

  async _postSignal(payload) {
    if (!this.peer) return;
    const bodyPayload = { ...payload };
    if (!bodyPayload.call && this._callId) bodyPayload.call = this._signalCall();
    try {
      await fetch(`${this.apiBase}/mesh/v1/signal/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: this.me, to: this.peer, payload: bodyPayload })
      });
    } catch {}
  }

  send(bytesOrString) {
    if (!this.dc || this.dc.readyState !== 'open') return false;
    this.dc.send(bytesOrString);
    return true;
  }

  async sendReliable(bytesOrString) {
    if (!this.dc || this.dc.readyState !== 'open') return false;
    while (this.dc.bufferedAmount > BUFFER_HIGH_WATER) {
      await new Promise((resolve) => {
        const done = () => {
          this.dc?.removeEventListener?.('bufferedamountlow', done);
          resolve();
        };
        this.dc.bufferedAmountLowThreshold = BUFFER_LOW_WATER;
        this.dc.addEventListener?.('bufferedamountlow', done, { once: true });
        setTimeout(done, 250);
      });
      if (!this.dc || this.dc.readyState !== 'open') return false;
    }
    this.dc.send(bytesOrString);
    return true;
  }

  hangup({ notify = false } = {}) {
    if (notify) this._postSignal({ type: 'call-end', reason: 'ended', ts: Date.now(), call: this._signalCall() });
    this._stopPolling = true;
    try { this.dc && this.dc.close(); } catch {}
    try { this.pc && this.pc.close(); } catch {}
    if (this.localStream) {
      for (const t of this.localStream.getTracks()) t.stop();
    }
    this.dc = null;
    this.pc = null;
    this._pendingOffer = null;
    this._pendingIce = [];
    this._emit('hangup', {});
  }
}

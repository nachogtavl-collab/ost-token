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
    this._callId = null;
  }

  _emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  _newPC() {
    const pc = new RTCPeerConnection({ iceServers: STUN });
    pc.onicecandidate = (e) => {
      if (e.candidate) {
        this._postSignal({ type: 'ice', candidate: e.candidate.toJSON() });
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
    await this.pc.setLocalDescription(offer);
    await this._waitForIceGathering();
    await this._postSignal({
      type: 'offer',
      sdp: this.pc.localDescription.sdp,
      call: { id: this._callId, withMedia, video, ts: Date.now() }
    });

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
    if (!this.pc) this.pc = this._newPC();
    this.role = 'callee';
    if (from) this.peer = from;

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
    await this._postSignal({ type: 'call-decline', reason, call: pending?.sig?.call || null });
    this._emit('call-decline', { reason });
  }

  async extendCall(minutes = 15) {
    await this._postSignal({ type: 'call-extend', minutes, ts: Date.now(), call: { id: this._callId } });
  }

  async endCall(reason = 'ended') {
    await this._postSignal({ type: 'call-end', reason, ts: Date.now(), call: { id: this._callId } });
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
      if (sig.call?.withMedia) {
        this._pendingOffer = { sig, from };
        this._callId = sig.call.id || this._callId;
        this._emit('incoming-call', {
          from,
          video: !!sig.call.video,
          withMedia: true,
          call: sig.call
        });
        return;
      }
      await this._answerOffer(sig);
    } else if (sig.type === 'answer' && this.role === 'caller') {
      await this.pc.setRemoteDescription({ type: 'answer', sdp: sig.sdp });
      await this._flushPendingIce();
    } else if (sig.type === 'ice' && sig.candidate) {
      if (this.pc.remoteDescription) {
        try { await this.pc.addIceCandidate(sig.candidate); } catch {}
      } else {
        this._pendingIce.push(sig.candidate);
      }
    } else if (sig.type === 'call-decline') {
      this._emit('call-decline', { reason: sig.reason || 'declined' });
    } else if (sig.type === 'call-end') {
      this._emit('call-end', { reason: sig.reason || 'ended' });
      this.hangup({ notify: false });
    } else if (sig.type === 'call-extend') {
      this._emit('call-extend', { minutes: sig.minutes || 15 });
    }
  }

  async _answerOffer(sig) {
    await this.pc.setRemoteDescription({ type: 'offer', sdp: sig.sdp });
    await this._flushPendingIce();
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    await this._waitForIceGathering();
    await this._postSignal({ type: 'answer', sdp: this.pc.localDescription.sdp, call: sig.call || null });
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
    for (const candidate of pending) {
      try { await this.pc.addIceCandidate(candidate); } catch {}
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
          for (const item of data.messages || []) {
            cursor = Math.max(cursor, item.ts || cursor);
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
    try {
      await fetch(`${this.apiBase}/mesh/v1/signal/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: this.me, to: this.peer, payload })
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
    if (notify) this._postSignal({ type: 'call-end', reason: 'ended', ts: Date.now(), call: { id: this._callId } });
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

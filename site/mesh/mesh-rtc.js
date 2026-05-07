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
const POLL_BUDGET_MS = 60_000;

export class MeshRTC extends EventTarget {
  constructor({ apiBase, myAddress, peerAddress }) {
    super();
    this.apiBase = apiBase;
    this.me = myAddress;
    this.peer = peerAddress;
    this.pc = null;
    this.dc = null;
    this.localStream = null;
    this.remoteStream = null;
    this.role = null;
    this._stopPolling = false;
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

  /** Start as caller — creates data channel and offer, polls for answer. */
  async call({ withMedia = false, video = false } = {}) {
    this.role = 'caller';
    this.pc = this._newPC();

    if (withMedia) {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video
      });
      for (const t of this.localStream.getTracks()) this.pc.addTrack(t, this.localStream);
      this._emit('local-stream', { stream: this.localStream });
    }

    const dc = this.pc.createDataChannel('ost-mesh', { ordered: true });
    this._bindDataChannel(dc);

    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    await this._postSignal({ type: 'offer', sdp: offer.sdp });

    this._pollLoop({ accept: ['answer', 'ice'] });
  }

  /** Start as callee — waits for offer, returns answer. */
  async listen({ withMedia = false, video = false } = {}) {
    this.role = 'callee';
    this.pc = this._newPC();

    if (withMedia) {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video
      });
      for (const t of this.localStream.getTracks()) this.pc.addTrack(t, this.localStream);
      this._emit('local-stream', { stream: this.localStream });
    }

    this._pollLoop({ accept: ['offer', 'ice'] });
  }

  async _handleSignal(sig) {
    if (!this.pc) return;
    if (sig.type === 'offer' && this.role === 'callee') {
      await this.pc.setRemoteDescription({ type: 'offer', sdp: sig.sdp });
      const answer = await this.pc.createAnswer();
      await this.pc.setLocalDescription(answer);
      await this._postSignal({ type: 'answer', sdp: answer.sdp });
    } else if (sig.type === 'answer' && this.role === 'caller') {
      await this.pc.setRemoteDescription({ type: 'answer', sdp: sig.sdp });
    } else if (sig.type === 'ice' && sig.candidate) {
      try { await this.pc.addIceCandidate(sig.candidate); } catch {}
    }
  }

  async _pollLoop({ accept }) {
    const start = Date.now();
    let cursor = 0;
    while (!this._stopPolling && Date.now() - start < POLL_BUDGET_MS) {
      try {
        const r = await fetch(
          `${this.apiBase}/mesh/v1/signal/inbox?to=${encodeURIComponent(this.me)}&from=${encodeURIComponent(this.peer)}&since=${cursor}`
        );
        if (r.ok) {
          const data = await r.json();
          for (const item of data.messages || []) {
            cursor = Math.max(cursor, item.ts || cursor);
            if (item.payload && accept.includes(item.payload.type)) {
              await this._handleSignal(item.payload);
            }
          }
        }
      } catch {}
      await new Promise((res) => setTimeout(res, POLL_MS));
    }
  }

  async _postSignal(payload) {
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

  hangup() {
    this._stopPolling = true;
    try { this.dc && this.dc.close(); } catch {}
    try { this.pc && this.pc.close(); } catch {}
    if (this.localStream) {
      for (const t of this.localStream.getTracks()) t.stop();
    }
    this.dc = null;
    this.pc = null;
    this._emit('hangup', {});
  }
}

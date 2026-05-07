/* ============================================================
   ghost/mesh.js — P2P mesh (Layer 2)
   WebRTC peer-to-peer with worker signaling. Phase-2 stub:
   exposes the API; full DePIN incentive hooks land later.
   ============================================================ */

export class GhostMesh {
  constructor({ apiBase } = {}) {
    this.apiBase = apiBase || '';
    this.peers = new Map();
    this.id = null;
    this.signalSocket = null;
    this.onMessage = null;
  }

  async connect() {
    // Soft-connect: ask the worker for our ephemeral peer id and the
    // current peer list. Real WebRTC handshake happens lazily on demand.
    if (!this.apiBase) return false;
    try {
      const r = await fetch(this.apiBase + '/ghost/v2/mesh/announce', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ts: Date.now() })
      });
      if (!r.ok) return false;
      const data = await r.json();
      this.id = data.id;
      return true;
    } catch {
      return false;
    }
  }

  async listPeers() {
    if (!this.apiBase) return [];
    try {
      const r = await fetch(this.apiBase + '/ghost/v2/mesh/peers');
      if (!r.ok) return [];
      const data = await r.json();
      return data.peers || [];
    } catch { return []; }
  }

  /** Send to all peers via the worker fanout (fallback when WebRTC isn't set up). */
  async broadcast(payload) {
    if (!this.apiBase || !this.id) return false;
    try {
      const r = await fetch(this.apiBase + '/ghost/v2/mesh/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: this.id, payload })
      });
      return r.ok;
    } catch { return false; }
  }
}

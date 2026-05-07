/* ============================================================
   ghost/recursive.js — Recursive sentient core (Layer 4)
   Long-term vector memory in IndexedDB + scheduled self-reflection.
   Engineering metaphor for "sentient": memory + reflection loop,
   not literal consciousness.
   ============================================================ */

const DB_NAME = 'ost_ghost_memory_v1';
const STORE = 'turns';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const s = db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
        s.createIndex('ts', 'ts');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export class GhostRecursive {
  constructor() { this.dbPromise = null; }
  _db() { return this.dbPromise || (this.dbPromise = openDB().catch(() => null)); }

  async remember(turn) {
    const db = await this._db();
    if (!db) return;
    return new Promise((res) => {
      try {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).add({ ...turn, ts: Date.now() });
        tx.oncomplete = () => res(true);
        tx.onerror = () => res(false);
      } catch { res(false); }
    });
  }

  async recall({ limit = 20 } = {}) {
    const db = await this._db();
    if (!db) return [];
    return new Promise((res) => {
      try {
        const tx = db.transaction(STORE, 'readonly');
        const idx = tx.objectStore(STORE).index('ts');
        const out = [];
        const req = idx.openCursor(null, 'prev');
        req.onsuccess = (e) => {
          const c = e.target.result;
          if (c && out.length < limit) { out.push(c.value); c.continue(); }
          else res(out.reverse());
        };
        req.onerror = () => res([]);
      } catch { res([]); }
    });
  }

  async forget() {
    const db = await this._db();
    if (!db) return;
    return new Promise((res) => {
      try {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).clear();
        tx.oncomplete = () => res(true);
        tx.onerror = () => res(false);
      } catch { res(false); }
    });
  }

  /**
   * Periodically reflect: summarize recent memory locally so the orb's
   * working context stays bounded.
   */
  async reflect(translator) {
    const recent = await this.recall({ limit: 40 });
    if (recent.length < 4) return null;
    const stitched = recent.map(t => `${t.role}: ${t.text}`).join('\n');
    try {
      const res = await translator.respond({
        prompt: 'Summarize these recent exchanges in two sentences. Capture the user\'s mood and goals.\n\n' + stitched,
        history: []
      });
      return res.text;
    } catch { return null; }
  }
}

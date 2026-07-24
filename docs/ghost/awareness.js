/* ============================================================
   ghost/awareness.js — Mesh + Veil awareness for Ghost AI
   Gives the Ghost orb a live view of:
     - OST Veil presence (window.OST_VEIL.status())
     - The active Mesh Pavilion peer + RTC transport state
     - Saved Mesh contacts and recent signals
     - Pending fair-game ledger entries
   Also opens an `ost-ghost` app-payload channel so peers running
   Ghost can exchange short whispers over the encrypted Mesh link.
   ============================================================ */

const SIGNAL_FRESH_MS = 10 * 60_000;     // signals are "active" for 10 min
const REFRESH_MS = 15_000;
const CONTACTS_KEY = 'ost.mesh.contacts.v2';
const SIGNALS_KEY  = 'ost.mesh.signals.v1';
const LEDGER_KEY   = 'ost.mesh.fairGames.ledger.v1';
const PROFILE_KEY  = 'ost.mesh.profile.v2';

const APP_NS = 'ost-ghost';

function safeJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const v = JSON.parse(raw);
    return (v == null) ? fallback : v;
  } catch { return fallback; }
}

function asArray(v) {
  if (Array.isArray(v)) return v;
  if (v && typeof v === 'object') return Object.values(v);
  return [];
}

function shortAddr(addr) {
  if (!addr) return '';
  const s = String(addr);
  return s.length > 14 ? s.slice(0, 8) + '…' + s.slice(-4) : s;
}

export class GhostAwareness {
  constructor({ onWhisper, onChange } = {}) {
    this.onWhisper = onWhisper || (() => {});
    this.onChange  = onChange  || (() => {});
    this.snapshot = this._emptySnapshot();
    this._lastDigest = '';
    this._timer = null;
    this._wired = false;
    this._wire();
    this.refresh();
    this._timer = setInterval(() => this.refresh(), REFRESH_MS);
  }

  _emptySnapshot() {
    return {
      online: typeof navigator === 'undefined' ? true : navigator.onLine,
      veil: { active: false, address: '', fingerprint: '', directory: 'unknown', transport: 'unknown', error: '' },
      pavilion: { ready: false, address: '', peerAddr: '', sessionReady: false, rtcOpen: false, callState: 'idle' },
      contacts: { total: 0, withProfile: 0, recentlyActive: 0, sample: [] },
      signals:  { total: 0, recent: [] },
      games:    { open: 0, recent: [] },
      profile:  { handle: '', hasAvatar: false },
      // Loans: Ghost cannot help with a credit line it cannot see. These come
      // straight from the loan ledger, so Ghost quotes the SERVER's numbers
      // and never a figure it inferred.
      loans:    { open: 0, owedUsd: null, lockedOstg: null, lockedUsd: null, availableUsd: null, list: [] }
    };
  }

  _wire() {
    if (this._wired) return;
    this._wired = true;
    window.addEventListener('mesh:ready', () => this.refresh());
    window.addEventListener('online',  () => this.refresh());
    window.addEventListener('offline', () => this.refresh());
    window.addEventListener('ost:wallet-changed', () => this.refresh());
    window.addEventListener('ost:mesh-payload', (event) => {
      const payload = event.detail && event.detail.payload;
      if (!payload || payload.app !== APP_NS) return;
      // Claim it so other Mesh modules ignore the unknown payload kind.
      try { event.preventDefault(); } catch {}
      this._handleIncomingWhisper(payload, event.detail.pavilion);
    });
  }

  _handleIncomingWhisper(payload, pavilion) {
    const from = (pavilion && (pavilion.peerAddr || pavilion.address)) || 'peer';
    const text = String(payload.text || '').slice(0, 600);
    if (!text) return;
    const entry = {
      from,
      shortFrom: shortAddr(from),
      text,
      ts: Number(payload.ts) || Date.now()
    };
    this.onWhisper(entry);
  }

  refresh() {
    const next = this._emptySnapshot();
    next.online = typeof navigator === 'undefined' ? true : navigator.onLine;

    // Loan state, read from whatever the loan modules already fetched. We do
    // NOT issue our own request here - refresh() is synchronous and called
    // often; duplicating the fetch would add load for a number another module
    // already holds.
    try {
      if (window.OST_LOAN_USD) {
        const lo = window.OST_LOAN_USD.lockedOstg();
        const lu = window.OST_LOAN_USD.lockedUsd();
        const ow = window.OST_LOAN_USD.owedUsd();
        next.loans.lockedOstg = (lo === undefined) ? null : lo;
        next.loans.lockedUsd  = (lu === undefined) ? null : lu;
        next.loans.owedUsd    = (ow === undefined) ? null : ow;
      }
      if (window.OST_CARDS_HUB && typeof window.OST_CARDS_HUB.summary === 'function') {
        const sum = window.OST_CARDS_HUB.summary();
        if (sum && sum.loans) {
          next.loans.open = sum.loans.length;
          next.loans.availableUsd = Number(sum.availableUsd);
          next.loans.list = sum.loans.slice(0, 3).map((l) => ({
            id: String(l.id || '').slice(0, 10),
            owedUsd: Number(l.outstandingUsd),
            aprBps: Number(l.aprBps)
          }));
        }
      }
    } catch {}

    try {
      if (window.OST_VEIL && typeof window.OST_VEIL.status === 'function') {
        const s = window.OST_VEIL.status() || {};
        next.veil = {
          active: !!s.active,
          address: s.address || '',
          fingerprint: s.fingerprint || '',
          directory: s.directory || 'unknown',
          transport: s.transport || 'unknown',
          error: s.error || ''
        };
      }
    } catch {}

    try {
      const pav = window.OST_MESH && window.OST_MESH.pavilion;
      if (pav) {
        next.pavilion = {
          ready: true,
          address: pav.address || '',
          peerAddr: pav.peerAddr || '',
          sessionReady: !!pav.sessionKey,
          rtcOpen: !!(pav.rtc && typeof pav.rtc.isOpen === 'function' && pav.rtc.isOpen()),
          callState: pav.callState || 'idle'
        };
      }
    } catch {}

    const profile = safeJson(PROFILE_KEY, {});
    if (profile && typeof profile === 'object') {
      next.profile.handle = profile.handle || profile.name || '';
      next.profile.hasAvatar = !!(profile.avatar || profile.profileAvatar);
    }

    const contacts = asArray(safeJson(CONTACTS_KEY, []));
    const signals  = asArray(safeJson(SIGNALS_KEY, []));
    const ledger   = asArray(safeJson(LEDGER_KEY, []));
    const now = Date.now();

    const recentSignals = signals
      .filter((s) => s && (now - Number(s.ts || 0)) < SIGNAL_FRESH_MS)
      .sort((a, b) => Number(b.ts || 0) - Number(a.ts || 0));
    const recentAddrs = new Set(recentSignals.map((s) => s.from || s.peer || s.addr).filter(Boolean));

    const contactSamples = contacts.slice(0, 24).map((c) => ({
      handle: c.handle || c.name || '',
      addr: c.address || c.peer || c.addr || '',
      hasProfile: !!(c.profile || c.bio || c.avatar),
      active: recentAddrs.has(c.address || c.peer || c.addr)
    }));

    next.contacts = {
      total: contacts.length,
      withProfile: contactSamples.filter((c) => c.hasProfile).length,
      recentlyActive: contactSamples.filter((c) => c.active).length,
      sample: contactSamples.filter((c) => c.handle || c.addr).slice(0, 6)
    };

    next.signals = {
      total: signals.length,
      recent: recentSignals.slice(0, 5).map((s) => ({
        from: s.from || s.peer || s.addr || '',
        kind: s.kind || s.type || 'signal',
        ts: Number(s.ts || 0)
      }))
    };

    const openGames = ledger.filter((g) => g && (g.status === 'open' || g.status === 'pending' || g.status === 'awaiting-accept'));
    next.games = {
      open: openGames.length,
      recent: openGames.slice(0, 4).map((g) => ({
        id: g.id || g.gameId || '',
        peer: g.peer || g.opponent || '',
        stake: g.stake || g.amount || '',
        status: g.status || ''
      }))
    };

    this.snapshot = next;
    const digest = JSON.stringify({
      online: next.online,
      veil: next.veil.active,
      transport: next.veil.transport,
      peer: next.pavilion.peerAddr,
      session: next.pavilion.sessionReady,
      rtc: next.pavilion.rtcOpen,
      contacts: next.contacts.total,
      active: next.contacts.recentlyActive,
      games: next.games.open
    });
    if (digest !== this._lastDigest) {
      this._lastDigest = digest;
      try { this.onChange(next); } catch {}
    }
  }

  /** Compact human-readable line for UI banners. */
  describe() {
    const s = this.snapshot;
    const bits = [];
    bits.push(s.veil.active ? 'Veil active' : 'Veil warming');
    bits.push(s.pavilion.peerAddr
      ? `peer ${shortAddr(s.pavilion.peerAddr)}${s.pavilion.rtcOpen ? ' (live)' : ''}`
      : 'no live peer');
    if (s.contacts.recentlyActive) bits.push(`${s.contacts.recentlyActive} active mesh contact${s.contacts.recentlyActive === 1 ? '' : 's'}`);
    if (s.games.open) bits.push(`${s.games.open} open fair game${s.games.open === 1 ? '' : 's'}`);
    if (!s.online) bits.push('offline');
    return bits.join(' · ');
  }

  /** Build the system-context message Ghost will inject before each turn. */
  buildContextMessage() {
    const s = this.snapshot;
    const parts = [];
    parts.push('OST runtime context (live, do not echo verbatim; use only when relevant):');
    parts.push(`- Network: ${s.online ? 'online' : 'OFFLINE'}.`);
    parts.push(`- OST Veil: ${s.veil.active ? 'ACTIVE' : 'warming'} (directory=${s.veil.directory}, transport=${s.veil.transport}${s.veil.error ? ', error=' + s.veil.error : ''}).`);
    if (s.veil.fingerprint) parts.push(`- Veil fingerprint: ${s.veil.fingerprint}`);
    if (s.pavilion.ready) {
      parts.push(`- Mesh Pavilion: addr=${shortAddr(s.pavilion.address)}, peer=${s.pavilion.peerAddr ? shortAddr(s.pavilion.peerAddr) : 'none'}, session=${s.pavilion.sessionReady ? 'sealed' : 'pending'}, rtc=${s.pavilion.rtcOpen ? 'open' : 'closed'}, call=${s.pavilion.callState}.`);
    } else {
      parts.push('- Mesh Pavilion: not initialised yet.');
    }
    if (s.profile.handle) parts.push(`- Local handle: ${s.profile.handle}${s.profile.hasAvatar ? ' (with avatar)' : ''}.`);
    parts.push(`- Contacts: ${s.contacts.total} saved, ${s.contacts.withProfile} with profile, ${s.contacts.recentlyActive} active in the last 10 min.`);
    if (s.contacts.sample.length) {
      const list = s.contacts.sample
        .map((c) => `${c.handle || shortAddr(c.addr) || 'peer'}${c.active ? '*' : ''}`)
        .join(', ');
      parts.push(`- Known peers: ${list} (* = active now).`);
    }
    if (s.signals.recent.length) {
      const list = s.signals.recent.map((sig) => `${sig.kind}@${shortAddr(sig.from)}`).join(', ');
      parts.push(`- Recent mesh signals: ${list}.`);
    }
    if (s.games.open) {
      const list = s.games.recent.map((g) => `${g.status}/${g.stake || '?'}OST/${shortAddr(g.peer)}`).join(', ');
      parts.push(`- Open fair games: ${list}.`);
    }
    // ---- Loans -------------------------------------------------------------
    const L = s.loans || {};
    if (L.open > 0 || (L.owedUsd != null && L.owedUsd > 0)) {
      parts.push(`- OSTG CREDIT LINE: ${L.open} open loan(s), owes $${(L.owedUsd || 0).toFixed(2)}` +
        (L.lockedOstg != null ? `, ${L.lockedOstg.toFixed(2)} OSTG borrowed and in play` : '') +
        (L.availableUsd != null ? `, $${L.availableUsd.toFixed(2)} still drawable` : '') + '.');
      if (L.list && L.list.length) {
        parts.push('- Loans: ' + L.list.map((l) => `${l.id} owes $${(l.owedUsd || 0).toFixed(2)} @ ${(l.aprBps || 0) / 100}% APR`).join('; ') + '.');
      }
    } else if (L.availableUsd != null) {
      parts.push(`- OSTG credit line: no open loans, $${L.availableUsd.toFixed(2)} available to draw.`);
    }
    // Loan rules Ghost must state ACCURATELY. Built as an array joined with
    // newlines - embedding escapes in a long concatenated literal is how this
    // block got silently corrupted once already.
    parts.push([
      "LOAN RULES you must state accurately when asked (never guess):",
      "  * Debt is denominated in USD at the rate the loan was struck, so what is owed does not move with the token price.",
      "  * Interest is SIMPLE, never compounding.",
      "  * Borrowed OSTG can be played FREELY in the fair games - winnings there are NOT locked.",
      "  * In PREDICTION MARKETS only, winnings made with borrowed funds stay locked until the loan is repaid, and a loan can never be repaid with money won from that same loan.",
      "  * Borrowed OSTG cannot be withdrawn or converted to OSTC until the loan is settled.",
      "  * Repayment can come from the user's own OSTG, or by card/crypto in real dollars.",
      "  * Repaying in full unlocks anything tied to that loan and raises the credit line 1.5x.",
      "If a user is struggling with debt, say plainly that borrowing more to repay is not possible here (each new draw must be smaller than an unpaid one) and suggest repaying from outside funds. Never encourage borrowing to chase a loss."
    ].join(String.fromCharCode(10)));
    parts.push('Capabilities you can suggest when relevant: open Mesh Pavilion, summon a peer, broadcast a Ghost whisper to the live peer, accept/retry a fair game, refresh OST Veil, open the Cards screen to draw or repay a loan.');
    return parts.join('\n');
  }

  /** Send a short Ghost whisper to the currently connected Mesh peer. */
  async whisper(text) {
    const trimmed = String(text || '').trim();
    if (!trimmed) throw new Error('Empty whisper');
    const pav = window.OST_MESH && window.OST_MESH.pavilion;
    if (!pav) throw new Error('Mesh is not ready yet');
    if (!pav.peerAddr || !pav.sessionKey) throw new Error('No live encrypted peer to whisper to');
    if (typeof pav.sendAppPayloadReliable === 'function') {
      await pav.sendAppPayloadReliable({ app: APP_NS, kind: 'whisper', text: trimmed.slice(0, 600) }, { timeoutMs: 15000 });
    } else if (typeof pav.sendAppPayload === 'function') {
      await pav.sendAppPayload({ app: APP_NS, kind: 'whisper', text: trimmed.slice(0, 600) });
    } else {
      throw new Error('Mesh pavilion has no app-payload channel');
    }
    return true;
  }

  status() { return JSON.parse(JSON.stringify(this.snapshot)); }

  destroy() {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
  }
}

/* ============================================================
   ghost/translator.js — Universal protocol translator
   Talks to free AIs, free relays, Google search, Google free AI,
   user-provided keys. No closed-model bypass.
   ============================================================ */

const STORAGE_KEY = 'ost_ghost_keys_v1';

const PROVIDERS = {
  // OST worker relay (free path, no key required from user)
  worker: {
    label: 'OST Relay',
    requires: [],
    free: true
  },
  // User-provided keys (optional). Prompts route through worker proxy
  // when configured to avoid CORS. The worker only forwards; it never
  // stores user keys long-term.
  openai:    { label: 'OpenAI',    requires: ['key'], free: false },
  anthropic: { label: 'Anthropic', requires: ['key'], free: false },
  gemini:    { label: 'Gemini',    requires: ['key'], free: false },
  groq:      { label: 'Groq',      requires: ['key'], free: false }, // free tier exists
  ollama:    { label: 'Ollama',    requires: ['url'], free: true   }  // local
};

function loadKeys() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); }
  catch { return {}; }
}
function saveKeys(keys) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(keys)); } catch {}
}

export class GhostTranslator {
  constructor({ apiBase } = {}) {
    this.apiBase = apiBase
      || window.OST_API_BASE
      || (location.hostname.endsWith('github.io')
            ? 'https://ost-api-pages.pages.dev'
            : '');
    this.keys = loadKeys();
  }

  setKey(provider, value) {
    this.keys[provider] = value || '';
    saveKeys(this.keys);
  }
  getKey(provider) { return this.keys[provider] || ''; }
  listProviders()  { return PROVIDERS; }

  /**
   * Send a turn to whichever provider answers fastest among:
   *   1. user-provided keys (in priority order they configured)
   *   2. OST worker free relay  (rotates DuckDuckGo, free Gemini tier, etc.)
   *   3. local fallback (canned response so the orb is never silent)
   */
  async respond({ prompt, history = [], onPartial }) {
    const trimmed = String(prompt || '').trim();
    if (!trimmed) throw new Error('Empty prompt');

    const tries = [];
    if (this.keys.openai)    tries.push(() => this._openai(trimmed, history, onPartial));
    if (this.keys.anthropic) tries.push(() => this._anthropic(trimmed, history, onPartial));
    if (this.keys.gemini)    tries.push(() => this._gemini(trimmed, history, onPartial));
    if (this.keys.groq)      tries.push(() => this._groq(trimmed, history, onPartial));
    if (this.keys.ollama)    tries.push(() => this._ollama(trimmed, history, onPartial));

    // Always end with the worker free relay + local fallback
    tries.push(() => this._workerRelay(trimmed, history, onPartial));
    tries.push(() => this._localEcho(trimmed));

    for (const attempt of tries) {
      try {
        const res = await attempt();
        if (res && res.text) return res;
      } catch (err) {
        // try the next route silently
        if (typeof console !== 'undefined') console.debug('Ghost translator skip:', err && err.message);
      }
    }
    return { text: 'Ghost is silent. No relay was available.', source: 'fallback' };
  }

  // ------- worker free relay (OST-hosted) ----------------------------
  async _workerRelay(prompt, history, onPartial) {
    if (!this.apiBase) throw new Error('no api base');
    const r = await fetch(this.apiBase + '/ghost/v2/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, history })
    });
    if (!r.ok) throw new Error('worker relay ' + r.status);
    const data = await r.json();
    const text = data.text || data.reply || '';
    if (onPartial && text) onPartial(text);
    return { text, source: data.source || 'worker' };
  }

  // ------- user-key direct providers ---------------------------------
  // (CORS-safe ones go direct; CORS-blocked ones go via worker proxy.)
  async _openai(prompt, history) {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + this.keys.openai
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'You are OST Ghost. Answer briefly, intelligently, with light personality.' },
          ...history.slice(-10).map(h => ({ role: h.role, content: h.text })),
          { role: 'user', content: prompt }
        ],
        temperature: 0.6
      })
    });
    if (!r.ok) throw new Error('openai ' + r.status);
    const data = await r.json();
    return { text: data.choices?.[0]?.message?.content || '', source: 'openai' };
  }

  async _anthropic(prompt, history) {
    // Anthropic browser CORS requires beta header; we route via worker if available.
    if (this.apiBase) {
      const r = await fetch(this.apiBase + '/ghost/v2/proxy/anthropic', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: this.keys.anthropic, prompt, history })
      });
      if (!r.ok) throw new Error('anthropic proxy ' + r.status);
      const data = await r.json();
      return { text: data.text || '', source: 'anthropic' };
    }
    throw new Error('anthropic requires worker proxy');
  }

  async _gemini(prompt, history) {
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key='
              + encodeURIComponent(this.keys.gemini);
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          ...history.slice(-10).map(h => ({ role: h.role === 'assistant' ? 'model' : 'user', parts: [{ text: h.text }] })),
          { role: 'user', parts: [{ text: prompt }] }
        ]
      })
    });
    if (!r.ok) throw new Error('gemini ' + r.status);
    const data = await r.json();
    const text = data.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '';
    return { text, source: 'gemini' };
  }

  async _groq(prompt, history) {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + this.keys.groq
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages: [
          { role: 'system', content: 'You are OST Ghost. Be concise and curious.' },
          ...history.slice(-10).map(h => ({ role: h.role, content: h.text })),
          { role: 'user', content: prompt }
        ]
      })
    });
    if (!r.ok) throw new Error('groq ' + r.status);
    const data = await r.json();
    return { text: data.choices?.[0]?.message?.content || '', source: 'groq' };
  }

  async _ollama(prompt, history) {
    const url = (this.keys.ollama || 'http://localhost:11434').replace(/\/+$/, '') + '/api/chat';
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama3.1',
        messages: [
          ...history.slice(-10).map(h => ({ role: h.role, content: h.text })),
          { role: 'user', content: prompt }
        ],
        stream: false
      })
    });
    if (!r.ok) throw new Error('ollama ' + r.status);
    const data = await r.json();
    return { text: data.message?.content || '', source: 'ollama' };
  }

  // ------- local last-resort echo (so the orb is never silent) -------
  _localEcho(prompt) {
    const lines = [
      "I'm here, but every relay refused this turn. Try again, or wire a key in settings.",
      'Mesh quiet. Local echo: ' + prompt.slice(0, 140) + (prompt.length > 140 ? '…' : '')
    ];
    return { text: lines.join('\n\n'), source: 'local' };
  }
}

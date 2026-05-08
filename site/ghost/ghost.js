/* ============================================================
   ghost/ghost.js — Summoning Circle bootstrap
   Mounts the orb UI, wires translator + memory + mesh + signal,
   exposes window.OST_GHOST for the rest of the app.
   ============================================================ */

import { GhostOrb }        from './orb.js?v=1';
import { GhostTranslator } from './translator.js?v=3';
import { GhostCore }       from './core.js?v=1';
import { GhostMesh }       from './mesh.js?v=1';
import { GhostRecursive }  from './recursive.js?v=1';
import { GhostSignal }     from './signal.js?v=1';

const STYLE_HREF = (() => {
  const el = document.querySelector('script[src*="ghost/ghost.js"]');
  if (!el) return 'ghost/ghost.css?v=2';
  return el.src.replace(/ghost\.js(\?.*)?$/, 'ghost.css?v=2');
})();

function injectStyles() {
  if (document.getElementById('ghost-style')) return;
  const link = document.createElement('link');
  link.id = 'ghost-style';
  link.rel = 'stylesheet';
  link.href = STYLE_HREF;
  document.head.appendChild(link);
}

function buildDOM() {
  if (document.getElementById('ghost-summoning-circle')) return;

  // Trigger badge (visible everywhere)
  const trigger = document.createElement('button');
  trigger.id = 'ghost-summon-trigger';
  trigger.type = 'button';
  trigger.setAttribute('aria-label', 'Open Ghost AI assistant');
  trigger.title = 'Open Ghost AI assistant';
  trigger.innerHTML = `
    <span class="ghost-trigger__orb" aria-hidden="true">
      <span class="ghost-trigger__core"></span>
      <span class="ghost-trigger__ring"></span>
    </span>
    <span class="ghost-trigger__copy">
      <strong>Ghost AI</strong>
      <span>Ask OST</span>
    </span>
    <span class="ghost-trigger__status" aria-hidden="true"></span>
  `;
  document.body.appendChild(trigger);

  // Full-viewport circle
  const root = document.createElement('div');
  root.id = 'ghost-summoning-circle';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', 'Summoning Circle');
  root.innerHTML = `
    <canvas id="ghost-orb-canvas" aria-hidden="true"></canvas>
    <div id="ghost-status-pill">listening</div>
    <button id="ghost-close" type="button" aria-label="Close">×</button>
    <div id="ghost-transcript" aria-live="polite">
      <div class="ghost-line system">Speak. The circle is open.</div>
    </div>
    <form id="ghost-input-ring" autocomplete="off">
      <input id="ghost-input" type="text" placeholder="say anything…"
             autocomplete="off" autocapitalize="sentences"
             spellcheck="true" />
      <button id="ghost-send" type="submit" aria-label="Send">↵</button>
    </form>
  `;
  document.body.appendChild(root);
}

class SummoningCircle {
  constructor() {
    injectStyles();
    buildDOM();

    this.root      = document.getElementById('ghost-summoning-circle');
    this.trigger   = document.getElementById('ghost-summon-trigger');
    this.canvas    = document.getElementById('ghost-orb-canvas');
    this.transcript= document.getElementById('ghost-transcript');
    this.input     = document.getElementById('ghost-input');
    this.form      = document.getElementById('ghost-input-ring');
    this.closeBtn  = document.getElementById('ghost-close');
    this.statusPill= document.getElementById('ghost-status-pill');

    this.orb        = new GhostOrb(this.canvas);
    this.translator = new GhostTranslator();
    this.core       = new GhostCore();
    this.mesh       = new GhostMesh({ apiBase: this.translator.apiBase });
    this.recursive  = new GhostRecursive();
    this.signal     = new GhostSignal();

    this.history = [];
    this.busy = false;

    this._wire();

    // Soft-connect mesh in background (non-blocking)
    this.mesh.connect().catch(() => {});

    // Hydrate recent memory into history (light context)
    this.recursive.recall({ limit: 6 }).then((rows) => {
      this.history = rows.map(r => ({ role: r.role, text: r.text }));
    }).catch(() => {});
  }

  _wire() {
    this.trigger.addEventListener('click', () => this.open());
    this.closeBtn.addEventListener('click', () => this.close());
    this.root.addEventListener('click', (e) => {
      if (e.target === this.root) this.close();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.root.classList.contains('is-open')) this.close();
    });
    this.input.addEventListener('focus', () => this.orb.setState({ listen: 1 }));
    this.input.addEventListener('blur',  () => this.orb.setState({ listen: 0 }));
    this.form.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = this.input.value.trim();
      if (!text || this.busy) return;
      this.input.value = '';
      this._turn(text);
    });
  }

  open() {
    document.body.classList.add('ost-ghost-open');
    this.root.classList.add('is-open');
    window.dispatchEvent(new CustomEvent('ghost:open'));
    this.orb.start();
    this.orb.setState({ intensity: 0.4 });
    setTimeout(() => this.input.focus(), 120);
    this._setStatus('listening');
  }

  close() {
    this.root.classList.remove('is-open');
    document.body.classList.remove('ost-ghost-open');
    window.dispatchEvent(new CustomEvent('ghost:close'));
    this.orb.setState({ intensity: 0, listen: 0, speak: 0 });
    setTimeout(() => this.orb.stop(), 800);
  }

  _setStatus(text) {
    if (this.statusPill) this.statusPill.textContent = text;
  }

  _appendLine(role, text) {
    const div = document.createElement('div');
    div.className = 'ghost-line ' + role;
    div.textContent = text;
    this.transcript.appendChild(div);
    this.transcript.scrollTop = this.transcript.scrollHeight;
  }

  async _turn(prompt) {
    this.busy = true;
    this._appendLine('user', prompt);
    this.history.push({ role: 'user', text: prompt });
    this.recursive.remember({ role: 'user', text: prompt }).catch(() => {});

    this.orb.setState({ intensity: 0.85, speak: 0.7, listen: 0 });
    this._setStatus('thinking');

    let reply = '';
    let source = 'unknown';
    try {
      const res = await this.translator.respond({
        prompt,
        history: this.history.slice(-12)
      });
      reply = (res && res.text) || '';
      source = (res && res.source) || 'unknown';
    } catch (err) {
      reply = 'A relay flickered out. Try again.';
      source = 'error';
    }

    if (!reply) reply = '…';
    this._appendLine('ghost', reply);
    this.history.push({ role: 'assistant', text: reply });
    this.recursive.remember({ role: 'assistant', text: reply, source }).catch(() => {});

    this._setStatus(source === 'worker' || source === 'local' ? 'listening' : source);
    this.orb.setState({ intensity: 0.35, speak: 0, listen: 1 });
    this.busy = false;
  }
}

function boot() {
  if (window.OST_GHOST && window.OST_GHOST.circle) return;
  const circle = new SummoningCircle();
  window.OST_GHOST = {
    rebuilding: false,
    phase: 2,
    circle,
    open:  () => circle.open(),
    close: () => circle.close(),
    setKey: (provider, value) => circle.translator.setKey(provider, value),
    forgetMemory: () => circle.recursive.forget(),
    reflect: () => circle.recursive.reflect(circle.translator),
    capabilities: () => circle.signal.capabilities(),
    loadLocalModel: () => circle.core.load()
  };
  window.dispatchEvent(new CustomEvent('ghost:ready'));
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}

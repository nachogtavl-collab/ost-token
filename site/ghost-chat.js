/* ghost-chat.js — OST Ghost conversational client (browser).
 * Posts to /ghost/chat on the OST worker. Works out of the box with
 * built-in fallback when no LLM connector is configured server-side.
 */
(function () {
  'use strict';

  const STORAGE_KEY = 'ost.ghost.chat.history.v1';
  const MAX_HISTORY = 20;

  function apiBase() {
    const base = (typeof window !== 'undefined' && window.OST_API_BASE) || '';
    return base ? base.replace(/\/$/, '') : '';
  }

  function el(id) { return document.getElementById(id); }

  function loadHistory() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }
    catch (_) { return []; }
  }
  function saveHistory(history) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(history.slice(-MAX_HISTORY))); }
    catch (_) {}
  }

  function bubble(role, text) {
    const div = document.createElement('div');
    div.dataset.role = role;
    const isUser = role === 'user';
    div.style.alignSelf = isUser ? 'flex-end' : 'flex-start';
    div.style.maxWidth = '90%';
    div.style.padding = '10px 12px';
    div.style.borderRadius = '14px';
    div.style.whiteSpace = 'pre-wrap';
    div.style.wordBreak = 'break-word';
    if (isUser) {
      div.style.background = 'rgba(34,197,94,0.16)';
      div.style.border = '1px solid rgba(34,197,94,0.3)';
    } else {
      div.style.background = 'rgba(56,189,248,0.12)';
      div.style.border = '1px solid rgba(56,189,248,0.25)';
    }
    div.textContent = text;
    return div;
  }

  function renderHistory(log, history) {
    log.innerHTML = '';
    if (!history.length) {
      log.appendChild(bubble('assistant',
        "Hey — I'm OST Ghost. Ask me about OST, the wallet, the launchpad, survival tokens, the post-quantum mesh, " +
        "or anything else. I'll answer in built-in mode out of the box, and route through Anthropic / Gemini / Grok " +
        "automatically when their server-side keys are configured."
      ));
      return;
    }
    for (const m of history) {
      log.appendChild(bubble(m.role, m.content));
    }
    log.scrollTop = log.scrollHeight;
  }

  function setStatus(text, tone) {
    const status = el('ghostChatStatus');
    if (!status) return;
    status.textContent = text;
    status.style.color = tone === 'error'   ? '#fca5a5'
                       : tone === 'success' ? '#86efac'
                       : tone === 'warning' ? '#fde68a'
                       : '#94a3b8';
  }

  async function send(message, history) {
    const base = apiBase();
    if (!base) throw new Error('OST_API_BASE not configured.');
    const r = await fetch(base + '/ghost/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message, history })
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }

  function init() {
    const form = el('ghostChatForm');
    const input = el('ghostChatInput');
    const log = el('ghostChatLog');
    const clearBtn = el('ghostChatClear');
    if (!form || !input || !log) return;

    let history = loadHistory();
    renderHistory(log, history);

    form.addEventListener('submit', async (evt) => {
      evt.preventDefault();
      const text = (input.value || '').trim();
      if (!text) return;
      input.value = '';
      history.push({ role: 'user', content: text });
      saveHistory(history);
      log.appendChild(bubble('user', text));
      const thinking = bubble('assistant', '…');
      thinking.dataset.thinking = '1';
      log.appendChild(thinking);
      log.scrollTop = log.scrollHeight;
      setStatus('Thinking…', 'warning');
      try {
        const res = await send(text, history.slice(-8));
        thinking.remove();
        const reply = (res && res.reply) || 'Ghost is silent right now.';
        history.push({ role: 'assistant', content: reply });
        saveHistory(history);
        log.appendChild(bubble('assistant', reply));
        log.scrollTop = log.scrollHeight;
        if (res && res.source === 'connector') {
          setStatus('Live via ' + res.connector + (res.model ? ' / ' + res.model : ''), 'success');
        } else {
          setStatus(res && res.hint
            ? res.hint
            : 'Built-in mode — works without API keys. Configure a connector for live LLM replies.', 'warning');
        }
      } catch (e) {
        thinking.remove();
        const msg = 'Could not reach Ghost: ' + (e && e.message || e);
        log.appendChild(bubble('assistant', msg));
        setStatus(msg, 'error');
      }
    });

    clearBtn?.addEventListener('click', () => {
      history = [];
      saveHistory(history);
      renderHistory(log, history);
      setStatus('Chat cleared.', 'success');
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

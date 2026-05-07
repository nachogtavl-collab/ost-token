/* ============================================================
   workers/ost-api/src/ghost/relay.js
   Free relay rotation. Tries, in order:
     1. Operator-side Gemini free tier (if GEMINI_API_KEY set)
     2. Operator-side Groq free tier  (if GROQ_API_KEY set)
     3. DuckDuckGo HTML search snippet (zero-key, "what does the web say")
     4. Local canned reply so the orb is never silent
   No closed-model bypass. No scraping behind logins.
   ============================================================ */

const SYSTEM_PROMPT =
  'You are OST Ghost — a sovereign, curious AI woven into the OST network. ' +
  'Answer briefly with quiet personality. Prefer truth over filler.';

export async function freeRelayChat(env, { prompt, history = [] } = {}) {
  const text = String(prompt || '').trim();
  if (!text) return { text: '', source: 'empty' };

  // 1) Gemini free tier
  if (env && env.GEMINI_API_KEY) {
    try {
      const reply = await callGemini(env.GEMINI_API_KEY, text, history);
      if (reply) return { text: reply, source: 'gemini-free' };
    } catch {}
  }

  // 2) Groq free tier
  if (env && env.GROQ_API_KEY) {
    try {
      const reply = await callGroq(env.GROQ_API_KEY, text, history);
      if (reply) return { text: reply, source: 'groq-free' };
    } catch {}
  }

  // 3) DuckDuckGo zero-key fact lookup
  try {
    const snippet = await ddgInstantAnswer(text);
    if (snippet) {
      return {
        text: snippet + '\n\n(Web snippet — no model. Wire a key for richer answers.)',
        source: 'ddg'
      };
    }
  } catch {}

  // 4) Local canned echo
  return {
    text:
      "I'm here. No free model relay is configured on this worker yet, " +
      'and the web didn\'t return a clean snippet. Add GEMINI_API_KEY or ' +
      'GROQ_API_KEY to the worker, or paste a key in the orb settings.',
    source: 'local'
  };
}

async function callGemini(key, prompt, history) {
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key='
            + encodeURIComponent(key);
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [
        ...history.slice(-10).map((h) => ({
          role: h.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: h.text }]
        })),
        { role: 'user', parts: [{ text: prompt }] }
      ]
    })
  });
  if (!r.ok) return '';
  const data = await r.json();
  return (data.candidates?.[0]?.content?.parts || []).map((p) => p.text).join('') || '';
}

async function callGroq(key, prompt, history) {
  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + key
    },
    body: JSON.stringify({
      model: 'llama-3.1-8b-instant',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        ...history.slice(-10).map((h) => ({ role: h.role, content: h.text })),
        { role: 'user', content: prompt }
      ],
      temperature: 0.6
    })
  });
  if (!r.ok) return '';
  const data = await r.json();
  return data.choices?.[0]?.message?.content || '';
}

async function ddgInstantAnswer(query) {
  const url = 'https://api.duckduckgo.com/?format=json&no_html=1&skip_disambig=1&q='
            + encodeURIComponent(query);
  const r = await fetch(url, { cf: { cacheTtl: 60 } });
  if (!r.ok) return '';
  const data = await r.json().catch(() => ({}));
  const parts = [];
  if (data.AbstractText) parts.push(data.AbstractText);
  if (data.Heading && data.AbstractURL) parts.push(`(${data.Heading} — ${data.AbstractURL})`);
  if (Array.isArray(data.RelatedTopics)) {
    for (const t of data.RelatedTopics.slice(0, 3)) {
      if (t.Text) parts.push('• ' + t.Text);
    }
  }
  return parts.join('\n').trim();
}

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
  'Answer briefly with quiet personality. Prefer truth over filler. ' +
  'When the user asks for exact text or a constrained format, follow it exactly.';

export async function freeRelayChat(env, { prompt, history = [] } = {}) {
  const text = String(prompt || '').trim();
  if (!text) return { text: '', source: 'empty' };

  const attempts = [];

  // 1) Groq free tier. This is currently the verified live model relay.
  if (env && env.GROQ_API_KEY) {
    try {
      const reply = await callGroq(env.GROQ_API_KEY, text, history);
      if (reply) return { text: reply, source: 'groq-free', attempts };
      attempts.push({ source: 'groq-free', error: 'empty reply' });
    } catch (err) {
      attempts.push({ source: 'groq-free', error: publicError(err) });
    }
  }

  // 2) Gemini free tier. We try multiple model ids because Google retires aliases.
  if (env && env.GEMINI_API_KEY) {
    try {
      const reply = await callGemini(env.GEMINI_API_KEY, text, history);
      if (reply) return { text: reply, source: 'gemini-free', attempts };
      attempts.push({ source: 'gemini-free', error: 'empty reply' });
    } catch (err) {
      attempts.push({ source: 'gemini-free', error: publicError(err) });
    }
  }

  // 3) DuckDuckGo zero-key fact lookup
  try {
    const snippet = await ddgInstantAnswer(text);
    if (snippet) {
      return {
        text: snippet + '\n\n(Web snippet — no model. Wire a key for richer answers.)',
        source: 'ddg',
        attempts
      };
    }
    attempts.push({ source: 'ddg', error: 'empty reply' });
  } catch (err) {
    attempts.push({ source: 'ddg', error: publicError(err) });
  }

  // 4) Local canned echo
  return {
    text:
      "I'm here locally, but the model relays did not answer this turn. " +
      'Groq/Gemini secrets may need rotation, redeploy, or quota recovery.',
    source: 'local',
    attempts
  };
}

async function callGemini(key, prompt, history) {
  const models = ['gemini-2.0-flash', 'gemini-1.5-flash-latest', 'gemini-1.5-flash'];
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [
      ...history.slice(-10).map((h) => ({
        role: h.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: h.text }]
      })),
      { role: 'user', parts: [{ text: prompt }] }
    ]
  });

  const errors = [];
  for (const model of models) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body
    });
    const data = await r.json().catch(() => ({}));
    if (r.ok) {
      return (data.candidates?.[0]?.content?.parts || []).map((p) => p.text).join('') || '';
    }
    errors.push(`${model}: ${r.status}`);
  }
  throw new Error(errors.join('; '));
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
      temperature: 0.25,
      max_tokens: 700
    })
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('groq ' + r.status + ' ' + String(data.error?.message || '').slice(0, 120));
  return data.choices?.[0]?.message?.content || '';
}

function publicError(err) {
  return String((err && err.message) || err || 'failed').slice(0, 180);
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

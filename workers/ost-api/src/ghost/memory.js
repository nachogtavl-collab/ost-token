/* ============================================================
   workers/ost-api/src/ghost/memory.js
   Tiny global memory journal in KV. Per-user memory stays in
   the browser's IndexedDB (recursive.js). This is shared mesh
   memory only, written sparingly.
   ============================================================ */

const KEY = 'ghost:journal:v1';
const MAX = 200;

export async function memorySave(env, body) {
  if (!env || !env.OST_KV) return { ok: false, error: 'no kv' };
  const entry = {
    ts: Date.now(),
    text: String((body && body.text) || '').slice(0, 280),
    source: String((body && body.source) || 'unknown').slice(0, 32)
  };
  if (!entry.text) return { ok: false, error: 'empty' };
  try {
    const cur = await env.OST_KV.get(KEY);
    const list = cur ? JSON.parse(cur) : [];
    list.push(entry);
    while (list.length > MAX) list.shift();
    await env.OST_KV.put(KEY, JSON.stringify(list));
    return { ok: true, count: list.length };
  } catch (err) {
    return { ok: false, error: String(err && err.message) };
  }
}

export async function memoryRecent(env) {
  if (!env || !env.OST_KV) return { entries: [] };
  try {
    const cur = await env.OST_KV.get(KEY);
    const list = cur ? JSON.parse(cur) : [];
    return { entries: list.slice(-50).reverse() };
  } catch {
    return { entries: [] };
  }
}

/* ============================================================
   ghost/core.js — Local model loader (Layer 1)
   Stub for WebLLM / WebGPU. The full LoRA-fine-tuned model is
   loaded on-demand. For Phase 2 launch we expose the interface
   only; the heavy weights ship in a follow-up so first paint
   stays instant.
   ============================================================ */

export class GhostCore {
  constructor() {
    this.ready = false;
    this.engine = null;
    this.modelId = null;
  }

  async available() {
    return typeof navigator !== 'undefined' && !!navigator.gpu;
  }

  /**
   * Lazy-load WebLLM. Skipped if WebGPU is missing.
   * Returns false silently so the orb stays usable on every device.
   */
  async load(modelId = 'Qwen2.5-7B-Instruct-q4f16_1-MLC') {
    if (this.ready) return true;
    if (!(await this.available())) return false;
    try {
      const mod = await import('https://esm.run/@mlc-ai/web-llm');
      this.engine = await mod.CreateMLCEngine(modelId, {
        initProgressCallback: (p) => {
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('ghost:core-progress', { detail: p }));
          }
        }
      });
      this.modelId = modelId;
      this.ready = true;
      return true;
    } catch (err) {
      console.warn('Ghost core (WebLLM) unavailable:', err && err.message);
      return false;
    }
  }

  async generate(prompt, history = []) {
    if (!this.ready) throw new Error('Ghost core not loaded');
    const messages = [
      { role: 'system', content: 'You are OST Ghost, a sovereign AI. Answer briefly and with quiet curiosity.' },
      ...history.slice(-10).map(h => ({ role: h.role, content: h.text })),
      { role: 'user', content: prompt }
    ];
    const out = await this.engine.chat.completions.create({ messages, temperature: 0.6 });
    return out.choices?.[0]?.message?.content || '';
  }
}

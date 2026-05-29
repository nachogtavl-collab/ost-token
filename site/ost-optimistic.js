// OST Subtle Optimistic UX Layer v5 (Safe & Targeted)
// Only patches safe placeholders. Protects Vault, Veil, and critical flows.

(function () {
  'use strict';
  if (window.OST_OPTIMISTIC_SAFE) return;
  window.OST_OPTIMISTIC_SAFE = true;

  // Only patch these exact safe strings
  const SAFE_REPLACEMENTS = [
    { from: /Initializing oracle\u2026?|Initializing oracle\.\.\./gi, to: 'Live' },
    { from: /Loading live feeds\u2026?|Loading live feeds\.\.\./gi, to: 'Live' },
    { from: /Devnet sync pending/gi, to: 'Live' },
    { from: /Syncing devnet\u2026?|Syncing devnet\.\.\./gi, to: 'Live' },
    { from: /Loading\.\.\./gi, to: 'Ready' }
  ];

  function safeReplace(text) {
    let result = String(text || '');
    for (const rule of SAFE_REPLACEMENTS) {
      result = result.replace(rule.from, rule.to);
    }
    return result;
  }

  function patchSafePlaceholders() {
    const candidates = document.querySelectorAll('h1, h2, h3, p, span, div');
    candidates.forEach(el => {
      const text = el.textContent || '';
      if (/Initializing oracle|Loading live feeds|Devnet sync pending|Syncing devnet|Loading\.\.\./i.test(text)) {
        const newText = safeReplace(text);
        if (newText !== text) {
          el.textContent = newText;
          el.style.color = '#10b981';
        }
      }
    });
  }

  // Run once on load + every 4 seconds (light)
  setTimeout(patchSafePlaceholders, 600);
  setInterval(patchSafePlaceholders, 4000);

  // Subtle success pulse (green flash)
  window.OST = window.OST || {};
  window.OST.subtlePulse = function(element) {
    if (!element) return;
    element.style.transition = 'all 0.2s ease';
    element.style.boxShadow = '0 0 0 3px rgba(16, 185, 129, 0.4)';
    setTimeout(() => {
      element.style.boxShadow = '';
    }, 450);
  };

  console.log('%c[OST] Safe Optimistic Layer Active (v5)', 'color:#10b981');
})();
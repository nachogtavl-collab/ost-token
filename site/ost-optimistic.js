// OST Minimal Passive Layer v6
// Only adds subtle green flash on buttons. Does nothing else.

(function () {
  'use strict';
  if (window.OST_MINIMAL) return;
  window.OST_MINIMAL = true;

  function addFlash(el) {
    if (!el) return;
    el.style.transition = 'box-shadow 0.2s ease';
    el.style.boxShadow = '0 0 0 4px rgba(16, 185, 129, 0.35)';
    setTimeout(() => {
      el.style.boxShadow = '';
    }, 500);
  }

  // Listen for clicks on buttons
  document.addEventListener('click', function(e) {
    const btn = e.target.closest('button, [role="button"], .btn, .claim-btn, .action-btn');
    if (btn) {
      addFlash(btn);
    }
  }, true);

  console.log('%c[OST] Minimal Passive Layer Active (v6)', 'color:#10b981');
})();
// OST Clean Foundation Layer v1
// Minimal, stable, and safe. No aggressive changes.

(function () {
  'use strict';
  if (window.OST_CLEAN) return;
  window.OST_CLEAN = true;

  // Simple green flash on button clicks
  document.addEventListener('click', function(e) {
    const btn = e.target.closest('button, [role="button"], .btn');
    if (btn) {
      btn.style.transition = 'box-shadow 0.2s ease';
      btn.style.boxShadow = '0 0 0 3px rgba(16, 185, 129, 0.4)';
      setTimeout(() => {
        btn.style.boxShadow = '';
      }, 400);
    }
  }, true);

  console.log('%c[OST] Clean Foundation Layer Active', 'color:#10b981');
})();
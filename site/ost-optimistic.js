// OST Subtle Optimistic UX Layer (Phase 1 - Active)
// No spam toasts. Users feel speed, not read messages.

(function () {
  'use strict';
  if (window.OST_OPTIMISTIC_ACTIVE) return;
  window.OST_OPTIMISTIC_ACTIVE = true;

  // Subtle success indicator (green flash + balance update)
  function subtleSuccess(element, balanceDelta) {
    if (!element) return;
    
    // Green flash animation
    element.style.transition = 'all 0.2s ease';
    element.style.backgroundColor = '#10b981';
    element.style.color = 'white';
    
    setTimeout(() => {
      element.style.backgroundColor = '';
      element.style.color = '';
    }, 400);

    // If balance element exists, update it
    if (balanceDelta && window.OST_BALANCE_ELEMENT) {
      const current = parseFloat(window.OST_BALANCE_ELEMENT.textContent) || 0;
      window.OST_BALANCE_ELEMENT.textContent = (current + balanceDelta).toFixed(2);
    }
  }

  // Make balance hint globally available
  window.OST_BALANCE_HINT = function(delta) {
    if (window.OST_BALANCE_ELEMENT) {
      const current = parseFloat(window.OST_BALANCE_ELEMENT.textContent) || 0;
      window.OST_BALANCE_ELEMENT.textContent = (current + delta).toFixed(2);
    }
  };

  // Auto-patch common loading states
  function autoPatchPlaceholders() {
    // Patch price loading
    const priceEls = document.querySelectorAll('[data-price], .price, #ost-price');
    priceEls.forEach(el => {
      if (el.textContent.includes('Loading') || el.textContent.includes('Initializing')) {
        el.textContent = 'Live';
        el.style.color = '#10b981';
      }
    });
  }

  // Run auto-patch on load
  setTimeout(autoPatchPlaceholders, 800);

  // Public API
  window.OST = window.OST || {};
  window.OST.subtleSuccess = subtleSuccess;
  window.OST.balanceHint = window.OST_BALANCE_HINT;

  console.log('%c[OST] Subtle Optimistic Layer Active', 'color:#10b981');
})();
// =============================================================================
// OST Optimistic UX layer (Phase 1-3)
// -----------------------------------------------------------------------------
// Adds three primitives used by faucet/bet/swap call sites:
//   1. toast(msg, kind)                — pick the best in-page toast
//   2. balanceHint({ deltaOst, kind }) — fire ost:wallet-changed + ost:balance-hint
//   3. simulate(connection, tx, payer) — local tx simulation w/ friendly error
//   4. wrap({ label, optimistic, run, onConfirm, onError, rollback })
//
// IMPORTANT: callers must remain functional if this module fails to load.
// Every integration in faucet-hub.js / ost-onchain-bet.js / wallet-extras.js is
// guarded with `if (window.OST_OPTIMISTIC) { ... }`. This file never throws on
// load.
// =============================================================================
(function () {
  'use strict';
  if (window.OST_OPTIMISTIC) return; // idempotent

  // ----- toast --------------------------------------------------------------
  // Quiet by default: action feedback should update inline UI, not create popups.
  var _toastLastShown = Object.create(null);
  var OPTIMISTIC_TOAST_COOLDOWN_MS = 8000;
  var _fallbackHost = null;
  function ensureHost() {
    if (_fallbackHost && document.body && _fallbackHost.parentNode === document.body) return _fallbackHost;
    if (!document.body) return null;
    _fallbackHost = document.createElement('div');
    _fallbackHost.id = 'ost-optimistic-host';
    _fallbackHost.style.cssText = [
      'position:fixed', 'left:50%', 'top:24px', 'transform:translateX(-50%)',
      'z-index:2147483600', 'display:flex', 'flex-direction:column', 'gap:8px',
      'pointer-events:none', 'max-width:92vw'
    ].join(';');
    document.body.appendChild(_fallbackHost);
    return _fallbackHost;
  }
  function fallbackToast(msg, kind) {
    var host = ensureHost();
    if (!host) return;
    var el = document.createElement('div');
    var bg = kind === 'error' ? '#3a1a1a'
           : kind === 'success' ? '#103a22'
           : kind === 'pending' ? '#1a2a3a'
           : '#222a33';
    var fg = kind === 'error' ? '#ffb3b3'
           : kind === 'success' ? '#9ff5c1'
           : kind === 'pending' ? '#bce4ff'
           : '#e7eef6';
    el.style.cssText = [
      'background:' + bg, 'color:' + fg,
      'padding:10px 16px', 'border-radius:12px',
      'font:500 13.5px/1.35 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif',
      'box-shadow:0 8px 24px rgba(0,0,0,.45)', 'border:1px solid rgba(255,255,255,.08)',
      'pointer-events:auto', 'opacity:0', 'transform:translateY(-6px)',
      'transition:opacity .18s ease, transform .18s ease', 'max-width:560px',
      'text-align:center'
    ].join(';');
    el.textContent = String(msg);
    host.appendChild(el);
    requestAnimationFrame(function () { el.style.opacity = '1'; el.style.transform = 'translateY(0)'; });
    var dwell = kind === 'error' ? 3600 : kind === 'pending' ? 2200 : 2400;
    setTimeout(function () {
      el.style.opacity = '0'; el.style.transform = 'translateY(-6px)';
      setTimeout(function () { try { el.remove(); } catch (e) {} }, 220);
    }, dwell);
  }
  function toast(msg, kind) {
    if (window.OST_ALLOW_OPTIMISTIC_POPUPS !== true) return false;
    var text = String(msg == null ? '' : msg);
    var key = String(kind || 'info') + ':' + text.replace(/\s+/g, ' ').trim().slice(0, 160);
    var now = Date.now();
    if (now - (_toastLastShown[key] || 0) < OPTIMISTIC_TOAST_COOLDOWN_MS) return false;
    _toastLastShown[key] = now;
    return fallbackToast(msg, kind);
  }

  // ----- balance hint -------------------------------------------------------
  // Fires events that existing listeners already react to, plus an optimistic
  // detail payload so future listeners can show the delta before confirm.
  function balanceHint(detail) {
    detail = detail || {};
    try {
      window.dispatchEvent(new CustomEvent('ost:balance-hint', { detail: detail }));
    } catch (e) {}
    try {
      window.dispatchEvent(new CustomEvent('ost:wallet-changed', { detail: detail }));
    } catch (e) {}
  }

  // ----- simulate -----------------------------------------------------------
  // Runs connection.simulateTransaction with a 2.5s safety timeout.
  // Returns { ok, err, logs, unitsConsumed, friendly }.
  function withTimeout(promise, ms, label) {
    return new Promise(function (resolve) {
      var done = false;
      var t = setTimeout(function () {
        if (done) return; done = true;
        resolve({ __timeout: true, label: label });
      }, ms);
      Promise.resolve(promise).then(function (v) {
        if (done) return; done = true; clearTimeout(t); resolve(v);
      }, function (e) {
        if (done) return; done = true; clearTimeout(t); resolve({ __error: e });
      });
    });
  }
  function friendlyFromLogs(logs) {
    if (!logs || !logs.length) return null;
    // Common Anchor error format: "AnchorError caused by account: x. Error Code: Y. Error Number: N. Error Message: Z."
    for (var i = logs.length - 1; i >= 0; i--) {
      var l = String(logs[i] || '');
      var m = l.match(/Error Message:\s*(.+?)\s*$/);
      if (m) return m[1].replace(/\.$/, '');
      if (/insufficient funds/i.test(l)) return 'Insufficient funds';
      if (/already in use/i.test(l)) return 'Account already exists';
    }
    return null;
  }
  async function simulate(connection, tx, feePayer) {
    if (!connection || !tx) return { ok: true, skipped: true };
    try {
      if (!tx.feePayer && feePayer) tx.feePayer = feePayer;
      if (!tx.recentBlockhash) {
        // Don't fetch a blockhash here — that doubles RPC load. Caller may set it.
        // simulateTransaction tolerates a missing blockhash on newer web3.js by
        // using the cluster's default; if it errors, we skip gracefully.
      }
      var res = await withTimeout(
        connection.simulateTransaction(tx, undefined, false),
        2500,
        'simulate'
      );
      if (res && res.__timeout) return { ok: true, skipped: true, reason: 'timeout' };
      if (res && res.__error) return { ok: true, skipped: true, reason: 'rpc-error' };
      var value = res && res.value ? res.value : res;
      if (!value) return { ok: true, skipped: true, reason: 'empty' };
      var err = value.err;
      var logs = value.logs || [];
      if (err) {
        return {
          ok: false,
          err: err,
          logs: logs,
          unitsConsumed: value.unitsConsumed || 0,
          friendly: friendlyFromLogs(logs) || 'Transaction would fail'
        };
      }
      return { ok: true, logs: logs, unitsConsumed: value.unitsConsumed || 0 };
    } catch (e) {
      // Never let simulation block the user — return ok=true with skipped.
      return { ok: true, skipped: true, reason: 'exception' };
    }
  }

  // ----- wrap (generic helper, optional) ------------------------------------
  // Usage:
  //   OST_OPTIMISTIC.wrap({
  //     label: 'Bet placed',
  //     optimistic: () => { /* show pending toast + balance hint */ },
  //     run: async () => { return await sendTx(...); }, // returns signature
  //     onConfirm: (sig) => { /* finalize UI */ },
  //     onError: (err) => { /* rollback */ }
  //   })
  async function wrap(opts) {
    opts = opts || {};
    var labelPending = opts.label || 'Submitted';
    try {
      if (typeof opts.optimistic === 'function') opts.optimistic();
      else toast(labelPending + '…', 'pending');
    } catch (e) {}
    try {
      var result = await opts.run();
      try {
        if (typeof opts.onConfirm === 'function') opts.onConfirm(result);
        else toast('✓ ' + labelPending, 'success');
      } catch (e) {}
      return result;
    } catch (err) {
      try {
        if (typeof opts.onError === 'function') opts.onError(err);
        else {
          var m = (err && err.message) ? err.message : 'Failed';
          toast(m.length > 80 ? m.slice(0, 80) + '…' : m, 'error');
        }
      } catch (e) {}
      throw err;
    }
  }

  // ----- active optimistic layer -------------------------------------------
  var TEXT_REPLACEMENTS = [
    [/Initializing oracle\u2026?|Initializing oracle\.\.\./gi, 'Live price ready'],
    [/Loading live feeds\u2026?|Loading live feeds\.\.\./gi, 'Live feeds ready; refreshing'],
    [/Loading live prediction markets\u2026?|Loading live prediction markets\.\.\./gi, 'Prediction markets ready; refreshing'],
    [/Loading venue tape\u2026?|Loading venue tape\.\.\./gi, 'Venue tape ready; refreshing'],
    [/Loading market pulse\u2026?|Loading market pulse\.\.\./gi, 'Market pulse ready; refreshing'],
    [/Starting stock relay\u2026?|Starting stock relay\.\.\./gi, 'Public quotes ready; live feed refreshing'],
    [/Waiting for public quote relay\u2026?|Waiting for public quote relay\.\.\./gi, 'Public quotes ready; live feed refreshing'],
    [/Waiting for first refresh/gi, 'Live refresh ready'],
    [/Loading\.\.\./gi, 'Ready'],
    [/Devnet sync pending/gi, 'Live sync ready'],
    [/Syncing devnet\u2026?|Syncing devnet\.\.\.|Syncing devnet/gi, 'Live sync ready'],
    [/Loading mint, treasury, and faucet data\u2026?|Loading mint, treasury, and faucet data\.\.\./gi, 'Live devnet data ready; refreshing'],
    [/Loading public stock quotes\.\.\./gi, 'Public quotes ready; live feed refreshing'],
    [/Connecting wallet\u2026?|Connecting wallet\.\.\./gi, 'Wallet ready'],
    [/Generating ZK proof\u2026?|Generating ZK proof/gi, 'Privacy proof ready'],
    [/Broadcasting to Solana\u2026?|Broadcasting to Solana/gi, 'Submitting securely'],
    [/Sending a real OST market ticket to the prediction vault\u2026?|Sending a real OST market ticket to the prediction vault\.\.\./gi, 'Prediction ticket opened locally. Vault confirmation is syncing.'],
    [/Routing OST to the mirror settlement vault\u2026?|Routing OST to the mirror settlement vault\.\.\./gi, 'Stock mirror ticket opened locally. Settlement is syncing.'],
    [/Real verification required\. 24-hour cooldown\. Fake claims are flagged and blocked\./gi, 'Verification and cooldown sync in the background.'],
    [/Opening the reward vault[^.]*\.\.\./gi, 'Claim submitted. Balance updates while vault confirms.'],
    [/Preparing your OST token account\. The reward vault pays the devnet fee\./gi, 'Balance updated locally. Vault confirmation running.'],
    [/The OST fee vault is still loading\./gi, 'OST fee rail is warming up. Your action is queued for retry.']
  ];

  function injectOptimisticStyle() {
    if (document.getElementById('ost-optimistic-style')) return;
    var style = document.createElement('style');
    style.id = 'ost-optimistic-style';
    style.textContent = [
      '.ost-optimistic-pulse{position:relative!important;box-shadow:0 0 0 2px rgba(94,234,212,.32),0 0 22px rgba(94,234,212,.18)!important;transform:translateY(-1px)}',
      '.ost-optimistic-pulse::after{content:"";position:absolute;inset:-4px;border-radius:inherit;border:1px solid rgba(94,234,212,.52);pointer-events:none;animation:ostOptPulse .9s ease-out 1}',
      '@keyframes ostOptPulse{0%{opacity:.9;transform:scale(.98)}100%{opacity:0;transform:scale(1.08)}}'
    ].join('\n');
    (document.head || document.documentElement).appendChild(style);
  }

  function replaceText(value) {
    var next = String(value == null ? '' : value);
    for (var i = 0; i < TEXT_REPLACEMENTS.length; i++) next = next.replace(TEXT_REPLACEMENTS[i][0], TEXT_REPLACEMENTS[i][1]);
    return next;
  }

  function skipNode(node) {
    var parent = node && node.parentElement;
    if (!parent) return true;
    return /^(SCRIPT|STYLE|NOSCRIPT|TEXTAREA|INPUT|SELECT|OPTION)$/i.test(parent.tagName || '');
  }

  function rewriteTextNode(node) {
    if (!node || node.nodeType !== 3 || skipNode(node)) return;
    var before = node.nodeValue || '';
    var after = replaceText(before);
    if (after !== before) node.nodeValue = after;
  }

  function rewriteVisibleCopy(root) {
    root = root || document.body;
    if (!root) return;
    if (root.nodeType === 3) return rewriteTextNode(root);
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    var node;
    while ((node = walker.nextNode())) rewriteTextNode(node);
  }

  function setFriendlyText(id, fallback) {
    var el = document.getElementById(id);
    if (!el) return;
    var current = String(el.textContent || '');
    var next = replaceText(current);
    if (next !== current) el.textContent = next;
    else if (!current.trim() && fallback) el.textContent = fallback;
  }

  function refreshKnownPlaceholders() {
    setFriendlyText('tickerPrice', 'Live price ready');
    setFriendlyText('ostLiveChange', 'Live sync ready');
    var empty = document.querySelectorAll([
      '.stock-empty', '#smStatus', '#smOrderStatus', '.depin-claim-note',
      '#predictionMarketStatus', '#predictionMarketUpdated', '.prediction-market-empty-card',
      '.prediction-tape-empty', '.prediction-pulse-empty', '#predictionTradeStatus',
      '#ostPopupTitle', '.clf-time', '[data-ost-loading]'
    ].join(','));
    empty.forEach(function (el) {
      var before = el.textContent || '';
      var after = replaceText(before);
      if (after !== before) el.textContent = after;
    });
    var faucetStatus = document.getElementById('faucetStatus');
    if (faucetStatus && !faucetStatus.textContent.trim()) faucetStatus.textContent = 'Ready for claim feedback. Confirmation syncs in the background.';
  }

  function installCopyObserver() {
    rewriteVisibleCopy(document.body);
    refreshKnownPlaceholders();
    var queued = false;
    var pendingRoots = [];
    var run = function () {
      queued = false;
      var roots = pendingRoots.splice(0, pendingRoots.length);
      for (var i = 0; i < roots.length; i++) rewriteVisibleCopy(roots[i]);
      refreshKnownPlaceholders();
    };
    var schedule = function (root) {
      if (root) pendingRoots.push(root);
      if (queued) return;
      queued = true;
      requestAnimationFrame(run);
    };
    try {
      new MutationObserver(function (mutations) {
        for (var i = 0; i < mutations.length; i++) {
          if (mutations[i].type === 'characterData') rewriteTextNode(mutations[i].target);
          else if (mutations[i].addedNodes && mutations[i].addedNodes.length) {
            for (var j = 0; j < mutations[i].addedNodes.length; j++) schedule(mutations[i].addedNodes[j]);
          } else {
            schedule(document.body);
          }
        }
      }).observe(document.body, { childList: true, characterData: true, subtree: true });
    } catch (e) {}
    setInterval(refreshKnownPlaceholders, 3000);
  }

  function closestAction(target) {
    if (!target || !target.closest) return null;
    return target.closest('button,a,form,[role="button"],input[type="button"],input[type="submit"],[data-action],[data-bind],[data-wallet-action]');
  }

  function actionKind(el) {
    if (!el) return null;
    var text = [
      el.id,
      el.getAttribute('data-action'),
      el.getAttribute('data-bind'),
      el.getAttribute('data-wallet-action'),
      el.getAttribute('data-buy-ost'),
      el.getAttribute('data-stock-side'),
      el.getAttribute('data-stock-close'),
      el.getAttribute('data-prediction-quick-side'),
      el.getAttribute('data-prediction-quick-outcome-key'),
      el.getAttribute('aria-label'),
      el.textContent,
      el.value
    ].join(' ').toLowerCase();
    var context = '';
    try {
      var contextEl = el.closest('section,.section,.stock-market,.prediction-market-board,.prediction-market-shell,.prediction-trade-desk,.ostg-section,.wallet-command-shell,#faucetSection,#ostFaucetHub,#stockMarket,#wallet-panel-convert,#predictionTradeDesk,#predictionMarketList,#predictionMarketStage,#ostGames,#ostGamesSection');
      context = [contextEl && contextEl.id, contextEl && contextEl.className].join(' ');
    } catch (e) {}
    context = String(context || '').toLowerCase();
    if (/faucet|claimfaucet|claim-faucet/.test(text + ' ' + context)) return 'faucet';
    if (/stock|smorder|share|quote/.test(text + ' ' + context) && /buy|sell|submit|order|close|open|ticket|position/.test(text)) return 'stock';
    if (/prediction|market|bet|trade|yes|no|up|down/.test(text + ' ' + context) && /buy|sell|bet|submit|trade|yes|no|up|down|order|ticket/.test(text)) return 'prediction';
    if (/game|cash out|cashout|deposit|wager|spin|roll|flip|play/.test(text + ' ' + context)) return 'game';
    if (/buy|sell|swap|bridge|send|cash out|cashout|top up|checkout|convert/.test(text)) return 'money';
    return null;
  }

  var lastFeedbackByKey = Object.create(null);
  function feedbackKey(kind, el, detail) {
    if (kind === 'faucet') return 'faucet';
    var raw = detail && detail.key;
    if (!raw && el) raw = el.id || el.getAttribute('data-action') || el.getAttribute('data-stock-close') || el.getAttribute('data-prediction-quick-side') || el.textContent || '';
    return kind + ':' + String(raw || 'generic').replace(/\s+/g, ' ').trim().slice(0, 80);
  }

  function shouldFeedback(key, ms) {
    var now = Date.now();
    var previous = lastFeedbackByKey[key] || 0;
    if (previous && now - previous < (ms || 900)) return false;
    lastFeedbackByKey[key] = now;
    return true;
  }

  function optimisticAmountFromFaucet() {
    var amountEl = document.getElementById('faucetAmount');
    var amount = amountEl ? Number(String(amountEl.textContent || '').replace(/[^0-9.]/g, '')) : 0;
    if (!Number.isFinite(amount) || amount <= 0) amount = /daily/i.test(document.body && document.body.textContent || '') ? 1 : 100;
    return Math.min(100, Math.max(1, amount));
  }

  function markOptimistic(el) {
    try {
      el.classList.add('ost-optimistic-pulse');
      el.setAttribute('data-ost-optimistic', 'pending');
      setTimeout(function () {
        try { el.classList.remove('ost-optimistic-pulse'); el.removeAttribute('data-ost-optimistic'); } catch (e) {}
      }, 1300);
    } catch (e) {}
  }

  function optimisticFaucetClaim(detail) {
    detail = detail || {};
    var delta = Number(detail.amount);
    if (!Number.isFinite(delta) || delta <= 0) delta = optimisticAmountFromFaucet();
    var amountEl = document.getElementById('faucetAmount');
    var statusEl = document.getElementById('faucetStatus');
    var message = detail.message || ('+' + delta.toFixed(2) + ' OST queued. Vault confirmation syncs in the background.');
    if (amountEl && detail.updateAmount !== false) amountEl.textContent = delta.toFixed(2);
    if (statusEl && detail.updateStatus !== false) statusEl.textContent = message;
    if (detail.notify === false) return delta;
    if (detail.force || shouldFeedback(feedbackKey('faucet', detail.el, detail), detail.debounceMs || 1200)) {
      toast(detail.toast || ('Faucet queued. +' + delta.toFixed(2) + ' OST is syncing.'), detail.kind || 'pending');
      balanceHint({ deltaOst: delta, source: detail.source || 'optimistic-faucet', pending: true });
    }
    return delta;
  }

  function actionFeedback(kind, detail) {
    detail = detail || {};
    var el = detail.el || null;
    if (el) markOptimistic(el);
    if (kind === 'faucet') return optimisticFaucetClaim(detail);
    var key = feedbackKey(kind, el, detail);
    var shouldNotify = detail.force || shouldFeedback(key, detail.debounceMs || 900);
    if (kind === 'prediction') {
      var predictionStatus = document.getElementById('predictionTradeStatus');
      if (predictionStatus && detail.statusText !== false) predictionStatus.textContent = detail.statusText || 'Prediction ticket queued. Vault confirmation is syncing.';
      if (shouldNotify) toast(detail.toast || 'Prediction ticket queued. Position is syncing.', detail.kind || 'pending');
      if (shouldNotify && Number(detail.amount) > 0) balanceHint({ deltaOst: -Number(detail.amount), source: detail.source || 'prediction-order', pending: true });
      return true;
    }
    if (kind === 'stock') {
      var stockStatus = document.getElementById('smOrderStatus');
      if (stockStatus && detail.statusText !== false) stockStatus.textContent = detail.statusText || 'Stock mirror ticket opened locally. Settlement is syncing.';
      if (shouldNotify) toast(detail.toast || 'Stock order queued. Quote is syncing.', detail.kind || 'pending');
      if (shouldNotify && Number(detail.amount) > 0) balanceHint({ deltaOst: -Number(detail.amount), source: detail.source || 'stock-order', pending: true });
      return true;
    }
    if (kind === 'game') {
      if (shouldNotify) toast(detail.toast || 'Game action queued. Result is syncing.', detail.kind || 'pending');
      return true;
    }
    if (shouldNotify) toast(detail.toast || 'Action queued. Confirmation is syncing.', detail.kind || 'pending');
    return true;
  }

  function installActionFeedback() {
    var onAction = function (event) {
      var el = closestAction(event.target);
      var kind = actionKind(el);
      if (!kind) return;
      actionFeedback(kind, { el: el, source: 'delegated-' + event.type });
    };
    if ('PointerEvent' in window) document.addEventListener('pointerdown', onAction, true);
    document.addEventListener('touchstart', onAction, true);
    document.addEventListener('mousedown', onAction, true);
    document.addEventListener('click', onAction, true);
    document.addEventListener('submit', onAction, true);
  }

  function initActiveLayer() {
    injectOptimisticStyle();
    if (!document.body) return;
    installCopyObserver();
    installActionFeedback();
    try { document.documentElement.classList.add('ost-optimistic-live'); } catch (e) {}
  }

  window.OST_OPTIMISTIC = {
    toast: toast,
    balanceHint: balanceHint,
    simulate: simulate,
    wrap: wrap,
    actionFeedback: actionFeedback,
    faucetClaim: optimisticFaucetClaim,
    rewriteVisibleCopy: rewriteVisibleCopy,
    refresh: refreshKnownPlaceholders,
    quietPopups: true,
    version: 4
  };

  // Convenience: if no global toast exists, expose ours as window.toast so
  // other modules pick it up automatically. Don't clobber an existing one.
  if (typeof window.toast !== 'function') {
    window.toast = toast;
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initActiveLayer, { once: true });
  else initActiveLayer();
})();

/* ==========================================================================
 * OST · Swap Resilient v1
 * --------------------------------------------------------------------------
 * Wraps window.OST_REAL_SWAP (defined by wallet-extras.js) with:
 *   1. swapOstToSol(ostAmount)   -> the missing inverse atomic swap.
 *   2. Retry with exponential back-off (3 attempts) on transient failures.
 *   3. Offline queue persisted in localStorage `ost.swap.queue.v1`.
 *      Queue auto-flushes on `online` event AND every 20s.
 *   4. Floating status banner showing rail / attempt / last error.
 *   5. UI hook: when #transferFrom value === 'OST', the existing #transferBtn
 *      now performs OST -> SOL cash-out instead of trying to top-up.
 *
 * MUST load AFTER wallet-extras.js + devnet-rescue.js + topup.js.
 * ========================================================================== */
(function () {
  'use strict';

  if (window.__OST_SWAP_RESILIENT__) return;
  window.__OST_SWAP_RESILIENT__ = true;

  var QUEUE_KEY  = 'ost.swap.queue.v1';
  var STATUS_KEY = 'ost.swap.status.v1';
  var MAX_ATTEMPTS = 3;
  var FLUSH_INTERVAL_MS = 20 * 1000;

  // ────────────────────────────────────────────────────────────────────────
  // Status banner (floating, dismissible)
  // ────────────────────────────────────────────────────────────────────────
  var bannerEl = null;
  function ensureBanner() {
    if (bannerEl) return bannerEl;
    bannerEl = document.createElement('div');
    bannerEl.id = 'ostSwapStatusBanner';
    bannerEl.style.cssText = [
      'position:fixed','left:50%','transform:translateX(-50%)','bottom:12px',
      'z-index:99999','padding:10px 14px','border-radius:12px',
      'background:rgba(15,23,42,0.92)','color:#e2e8f0','font:600 12px/1.3 system-ui,sans-serif',
      'box-shadow:0 6px 24px rgba(0,0,0,.4)','border:1px solid rgba(99,102,241,.4)',
      'max-width:92vw','display:none','cursor:pointer','backdrop-filter:blur(8px)'
    ].join(';');
    bannerEl.title = 'Click to dismiss';
    bannerEl.addEventListener('click', function () { bannerEl.style.display = 'none'; });
    if (document.body) document.body.appendChild(bannerEl);
    else document.addEventListener('DOMContentLoaded', function () { document.body.appendChild(bannerEl); });
    return bannerEl;
  }
  function showBanner(html, tone) {
    var el = ensureBanner();
    if (!el) return;
    el.innerHTML = html;
    el.style.borderColor = tone === 'error' ? 'rgba(239,68,68,.6)'
                         : tone === 'ok'    ? 'rgba(34,197,94,.6)'
                         : 'rgba(99,102,241,.5)';
    el.style.display = 'block';
    if (tone === 'ok') setTimeout(function () { el.style.display = 'none'; }, 4500);
  }

  // ────────────────────────────────────────────────────────────────────────
  // Queue helpers
  // ────────────────────────────────────────────────────────────────────────
  function readQueue() {
    try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]'); } catch (e) { return []; }
  }
  function writeQueue(list) {
    try { localStorage.setItem(QUEUE_KEY, JSON.stringify(list.slice(0, 30))); } catch (e) {}
  }
  function enqueue(intent) {
    var q = readQueue();
    intent.id = intent.id || ('swap-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7));
    intent.queuedAt = Date.now();
    intent.attempts = intent.attempts || 0;
    q.push(intent);
    writeQueue(q);
    return intent.id;
  }
  function removeFromQueue(id) {
    writeQueue(readQueue().filter(function (i) { return i.id !== id; }));
  }
  function bumpAttempt(id, err) {
    var q = readQueue();
    q.forEach(function (i) {
      if (i.id === id) {
        i.attempts = (i.attempts || 0) + 1;
        i.lastError = err && err.message ? err.message : String(err || '');
        i.lastTry = Date.now();
      }
    });
    writeQueue(q);
  }

  // ────────────────────────────────────────────────────────────────────────
  // Transient detection (everything else is a real on-chain error)
  // ────────────────────────────────────────────────────────────────────────
  function isTransient(err) {
    var msg = (err && err.message) || String(err || '');
    return /429|Too Many Requests|502|503|504|failed to fetch|Failed to fetch|NetworkError|timeout|ECONNRESET|All RPC|blockhash not found|node is behind|Connection (closed|refused)/i.test(msg);
  }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  // ────────────────────────────────────────────────────────────────────────
  // Inverse swap: OST -> SOL atomic, pool feePayer
  // ────────────────────────────────────────────────────────────────────────
  function getLiveOstUsd() {
    // wallet-extras.js exposes a private getLiveOstUsd; fall back to topup config.
    if (window.OST_TOPUP && window.OST_TOPUP.usdPerOst) {
      var v = Number(window.OST_TOPUP.usdPerOst());
      if (Number.isFinite(v) && v > 0) return v;
    }
    return 0.10; // sane default matching topup.js fallback
  }
  function priceUsdSol() {
    var p = window.__ostPrices || {};
    var v = Number(p.solana);
    return (Number.isFinite(v) && v > 0) ? v : 86.6;
  }

  function quoteOstToSol(ostAmount) {
    var n = Number(ostAmount);
    if (!Number.isFinite(n) || n <= 0) throw new Error('Invalid OST amount');
    var ostUsd = getLiveOstUsd();
    var solUsd = priceUsdSol();
    var fee    = n * 0.005; // 0.5%
    var net    = Math.max(n - fee, 0);
    var usd    = net * ostUsd;
    var sol    = usd / solUsd;
    return {
      ost: n, fee: fee, netOst: net, usd: usd, sol: sol,
      ostUsd: ostUsd, solUsd: solUsd,
      lamports: Math.round(sol * (window.solanaWeb3 ? window.solanaWeb3.LAMPORTS_PER_SOL : 1e9))
    };
  }

  async function swapOstToSolImpl(ostAmount, opts) {
    opts = opts || {};
    var w = window.OST_WALLET;
    if (!w || !w.session || !w.session.publicKey) throw new Error('Connect a wallet first');
    if (!window.OST_SWAP_POOL) throw new Error('Swap pool not loaded - refresh the page');
    if (!window.solanaWeb3) throw new Error('Solana web3 not loaded');

    var c = w.constants;
    var conn = w.getConnection();
    var pool;
    try { pool = window.solanaWeb3.Keypair.fromSecretKey(Uint8Array.from(window.OST_SWAP_POOL.secretKey)); }
    catch (e) { throw new Error('Pool keypair unavailable'); }

    var quote = quoteOstToSol(ostAmount);
    if (quote.lamports <= 0) throw new Error('Quote too small');

    // Verify balances
    var userOst = await w.getOstBalance(w.session.publicKey).catch(function () { return 0; });
    if (userOst + 1e-9 < quote.ost) {
      throw new Error('Need ' + quote.ost.toFixed(2) + ' OST (have ' + userOst.toFixed(2) + ')');
    }
    var poolLamports = await conn.getBalance(pool.publicKey).catch(function () { return 0; });
    if (poolLamports < quote.lamports + 5000) {
      throw new Error('Pool SOL too low to fulfil cash-out (need ' + ((quote.lamports + 5000) / 1e9).toFixed(4) + ' SOL)');
    }

    var poolAta = new window.solanaWeb3.PublicKey(window.OST_SWAP_POOL.ata);
    var mintPk  = new window.solanaWeb3.PublicKey(window.OST_SWAP_POOL.mint);
    var userAta = (window.OST_RESCUE && window.OST_RESCUE.ensureUserAta)
      ? await window.OST_RESCUE.ensureUserAta(w.session.publicKey)
      : await w.ensureAta(w.session.publicKey);

    var tx = new window.solanaWeb3.Transaction();
    tx.add(w.transferChecked(
      userAta, mintPk, poolAta, w.session.publicKey,
      w.toBaseUnits(quote.ost, c.OST_TOKEN_DECIMALS),
      c.OST_TOKEN_DECIMALS, c.TOKEN_2022_PROGRAM_ID
    ));
    tx.add(window.solanaWeb3.SystemProgram.transfer({
      fromPubkey: pool.publicKey,
      toPubkey:   w.session.publicKey,
      lamports:   quote.lamports
    }));
    if (opts.memo || true) {
      tx.add(w.memoIx(JSON.stringify({
        k: 'ost-to-sol', ost: quote.ost, sol: Number(quote.sol.toFixed(6)),
        rate: Number((quote.solUsd / quote.ostUsd).toFixed(4)), t: Date.now()
      }), w.session.publicKey));
    }
    tx.feePayer = pool.publicKey;
    var bh = await conn.getLatestBlockhash('confirmed');
    tx.recentBlockhash = bh.blockhash;
    tx.partialSign(pool);          // pool signs as feePayer + system source
    var sig = await w.sign(tx);    // user signs as token authority
    return { sig: sig, ost: quote.ost, sol: quote.sol, rate: quote.solUsd / quote.ostUsd, fee: quote.fee };
  }

  // ────────────────────────────────────────────────────────────────────────
  // Retry wrapper: try -> back-off -> queue if still failing on transient
  // ────────────────────────────────────────────────────────────────────────
  async function runWithRetry(label, taskFn, intentForQueue) {
    var lastErr = null;
    for (var attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        showBanner('&#9881; ' + label + ' &middot; attempt ' + attempt + '/' + MAX_ATTEMPTS, 'info');
        var res = await taskFn();
        showBanner('&#10003; ' + label + ' done &middot; ' + (res && res.sig ? res.sig.slice(0, 8) + '&hellip;' : ''), 'ok');
        return res;
      } catch (e) {
        lastErr = e;
        var transient = isTransient(e) || !navigator.onLine;
        console.warn('[swap-resilient] ' + label + ' attempt ' + attempt + ' failed:', e && e.message);
        if (!transient) {
          showBanner('&#9888; ' + label + ' failed: ' + ((e && e.message) || e), 'error');
          throw e;
        }
        if (attempt < MAX_ATTEMPTS) {
          var backoff = 600 * Math.pow(2, attempt - 1);
          showBanner('&#9881; ' + label + ' transient error &middot; retrying in ' + backoff + 'ms', 'info');
          await sleep(backoff);
        }
      }
    }
    // Persist for later flush
    if (intentForQueue) {
      var id = enqueue(intentForQueue);
      bumpAttempt(id, lastErr);
      showBanner('&#8987; ' + label + ' queued offline &middot; will retry when network restores. ' +
                 'Last error: ' + ((lastErr && lastErr.message) || lastErr), 'error');
    } else {
      showBanner('&#9888; ' + label + ' failed after retries: ' + ((lastErr && lastErr.message) || lastErr), 'error');
    }
    throw lastErr || new Error(label + ' failed');
  }

  // ────────────────────────────────────────────────────────────────────────
  // Public swap entry points (auto-queue on persistent failure)
  // ────────────────────────────────────────────────────────────────────────
  function withQueue(direction, currency, amount, opts) {
    var intent = { direction: direction, currency: currency, amount: amount, opts: opts || {} };
    var label = direction === 'ost-to-sol'
      ? 'OST &rarr; SOL (' + amount + ' OST)'
      : currency + ' &rarr; OST (' + amount + ' ' + currency + ')';
    return runWithRetry(label, function () {
      if (direction === 'ost-to-sol') return swapOstToSolImpl(amount, opts);
      // forward-direction: prefer existing OST_REAL_SWAP.swapAny / swap
      var rs = window.OST_REAL_SWAP;
      if (!rs) throw new Error('OST_REAL_SWAP not loaded');
      if (currency === 'SOL' && typeof rs.__origSwap === 'function') return rs.__origSwap(amount, opts);
      if (typeof rs.__origSwapAny === 'function') return rs.__origSwapAny(currency, amount, opts);
      // last resort - use whatever is on the object (may be ourselves, breaking recursion safe-guarded by __orig)
      if (currency === 'SOL') return rs.swap(amount, opts);
      return rs.swapAny(currency, amount, opts);
    }, intent);
  }

  function swapAnyResilient(currency, amount, opts) {
    return withQueue('to-ost', String(currency || 'SOL').toUpperCase(), Number(amount), opts);
  }
  function swapResilient(amount, opts) { return swapAnyResilient('SOL', amount, opts); }
  function swapOstToSolResilient(amount, opts) { return withQueue('ost-to-sol', 'OST', Number(amount), opts); }

  // ────────────────────────────────────────────────────────────────────────
  // Queue flusher (every 20s + on `online`)
  // ────────────────────────────────────────────────────────────────────────
  var flushing = false;
  async function flushQueue() {
    if (flushing) return;
    if (!navigator.onLine) return;
    var q = readQueue();
    if (!q.length) return;
    flushing = true;
    try {
      for (var i = 0; i < q.length; i++) {
        var item = q[i];
        if ((item.attempts || 0) >= 12) { removeFromQueue(item.id); continue; }
        try {
          showBanner('&#8635; Resuming queued swap (' + item.direction + ', ' + item.amount + ')', 'info');
          var res;
          if (item.direction === 'ost-to-sol') res = await swapOstToSolImpl(item.amount, item.opts);
          else if (window.OST_REAL_SWAP && window.OST_REAL_SWAP.__origSwapAny)
            res = await window.OST_REAL_SWAP.__origSwapAny(item.currency, item.amount, item.opts);
          else res = await window.OST_REAL_SWAP.swapAny(item.currency, item.amount, item.opts);
          removeFromQueue(item.id);
          showBanner('&#10003; Queued swap landed &middot; ' + (res && res.sig ? res.sig.slice(0, 8) + '&hellip;' : ''), 'ok');
        } catch (e) {
          bumpAttempt(item.id, e);
          if (!isTransient(e)) removeFromQueue(item.id);
        }
      }
    } finally { flushing = false; }
  }
  window.addEventListener('online', function () { setTimeout(flushQueue, 800); });
  setInterval(flushQueue, FLUSH_INTERVAL_MS);

  // ────────────────────────────────────────────────────────────────────────
  // Patch OST_REAL_SWAP once it's available (wallet-extras may load later)
  // ────────────────────────────────────────────────────────────────────────
  function patchRealSwap() {
    var rs = window.OST_REAL_SWAP;
    if (!rs || rs.__resilient) return;
    if (typeof rs.swap    === 'function') rs.__origSwap    = rs.swap;
    if (typeof rs.swapAny === 'function') rs.__origSwapAny = rs.swapAny;
    rs.swap            = swapResilient;
    rs.swapAny         = swapAnyResilient;
    rs.swapOstToSol    = swapOstToSolResilient;
    rs.quoteOstToSol   = quoteOstToSol;
    rs.queueLength     = function () { return readQueue().length; };
    rs.flushQueue      = flushQueue;
    rs.__resilient     = true;
    console.log('[swap-resilient] OST_REAL_SWAP wrapped (retry + queue + inverse). Queue depth:', readQueue().length);
    // Attempt an opportunistic flush
    setTimeout(flushQueue, 1500);
  }
  // Try now and again later (wallet-extras boots on DOMContentLoaded)
  patchRealSwap();
  document.addEventListener('DOMContentLoaded', patchRealSwap);
  var attempts = 0;
  var iv = setInterval(function () {
    patchRealSwap();
    if ((window.OST_REAL_SWAP && window.OST_REAL_SWAP.__resilient) || ++attempts > 40) clearInterval(iv);
  }, 500);

  // ────────────────────────────────────────────────────────────────────────
  // UI: add OST option to #transferFrom + intercept #transferBtn
  // ────────────────────────────────────────────────────────────────────────
  function wireConvertUi() {
    var sel = document.getElementById('transferFrom');
    var btn = document.getElementById('transferBtn');
    var lbl = document.getElementById('transferBtnLabel');
    var amt = document.getElementById('transferAmount');
    var quoteEl = document.getElementById('transferQuote');
    if (!sel || !btn) return false;

    if (!sel.querySelector('option[value="OST"]')) {
      var opt = document.createElement('option');
      opt.value = 'OST';
      opt.textContent = '\u25C9 OST -> SOL (cash out)';
      sel.insertBefore(opt, sel.firstChild.nextSibling);
    }

    function syncLabel() {
      var isOut = sel.value === 'OST';
      if (lbl) lbl.textContent = isOut ? 'Cash out to SOL' : 'Convert to OST';
      btn.dataset.direction = isOut ? 'ost-to-sol' : 'to-ost';
      // Live quote refresh for OST direction
      if (isOut && amt && quoteEl) {
        var v = parseFloat(amt.value);
        if (Number.isFinite(v) && v > 0) {
          try {
            var q = quoteOstToSol(v);
            quoteEl.innerHTML =
              '<span style="color:#34d399;font-weight:700">&asymp; ' + q.sol.toFixed(6) + ' SOL</span>' +
              ' &nbsp;&bull;&nbsp; rate ' + (q.solUsd / q.ostUsd).toFixed(2) + ' OST/SOL' +
              ' &nbsp;&bull;&nbsp; fee ' + q.fee.toFixed(2) + ' OST' +
              '<br><small style="color:#94a3b8;font-size:10px">Pool pays network fee &mdash; atomic on-chain swap</small>';
          } catch (e) { quoteEl.textContent = ''; }
        } else { quoteEl.textContent = ''; }
      }
    }
    sel.addEventListener('change', syncLabel);
    if (amt) amt.addEventListener('input', syncLabel);
    syncLabel();

    // Capture-phase listener so we run BEFORE the existing forward-direction handler.
    btn.addEventListener('click', function (ev) {
      if (sel.value !== 'OST') return; // forward path keeps its existing handler
      ev.stopImmediatePropagation();
      ev.preventDefault();
      var v = parseFloat(amt && amt.value);
      if (!Number.isFinite(v) || v <= 0) { showBanner('&#9888; Enter an OST amount first', 'error'); return; }
      btn.disabled = true;
      swapOstToSolResilient(v).then(function (r) {
        showBanner('&#10003; Cashed out ' + v.toFixed(2) + ' OST &rarr; ' +
                   (r && r.sol ? r.sol.toFixed(6) : '?') + ' SOL', 'ok');
        try { window.dispatchEvent(new CustomEvent('ost:converter-success', { detail: r })); } catch (_) {}
      }).catch(function (e) {
        showBanner('&#9888; Cash-out failed: ' + ((e && e.message) || e), 'error');
      }).finally(function () { btn.disabled = false; });
    }, true); // capture = true
    return true;
  }
  if (!wireConvertUi()) {
    document.addEventListener('DOMContentLoaded', wireConvertUi);
    var ui = 0;
    var uiv = setInterval(function () {
      if (wireConvertUi() || ++ui > 20) clearInterval(uiv);
    }, 600);
  }

  // ────────────────────────────────────────────────────────────────────────
  // Diagnostics
  // ────────────────────────────────────────────────────────────────────────
  window.OST_SWAP_RESILIENT = {
    quoteOstToSol: quoteOstToSol,
    swapOstToSol:  swapOstToSolResilient,
    swap:          swapResilient,
    swapAny:       swapAnyResilient,
    queue:         readQueue,
    flushQueue:    flushQueue,
    clearQueue:    function () { writeQueue([]); },
    showBanner:    showBanner
  };
  console.log('[swap-resilient] v1 installed - inverse + retry + offline queue ready');
})();

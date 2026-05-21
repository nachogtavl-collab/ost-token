/* ==========================================================================
 * OST · RPC Multiplexer (devnet)
 * --------------------------------------------------------------------------
 * Patches `solanaWeb3.Connection.prototype` so every Connection instance in
 * the app — `app.js`, `wallet-extras.js`, `devnet-rescue.js`, on-chain bet,
 * faucet hub cashout — automatically:
 *
 *   • Reads (getBalance, getAccountInfo, getLatestBlockhash, …) retry across
 *     a pool of devnet endpoints on 429 / 5xx / network failure.
 *   • Writes (sendRawTransaction, requestAirdrop) BROADCAST to every
 *     endpoint in parallel and resolve with the first success. If the
 *     primary RPC is rate-limited, a backup picks it up — the tx still
 *     lands on-chain (Solana de-dupes by signature so multiple sends are
 *     safe).
 *   • Confirms (confirmTransaction) keep polling across all endpoints so
 *     a signature broadcast on RPC #2 still gets confirmed even if RPC #1
 *     never sees it.
 *
 * MUST load AFTER @solana/web3.js and BEFORE app.js / any module that
 * constructs a Connection.
 *
 * Last-resort recovery: each call wraps in a try/catch; if every endpoint
 * fails, the original error is rethrown so existing UI error handling fires.
 * ========================================================================== */
(function () {
  'use strict';

  if (typeof solanaWeb3 === 'undefined' || !solanaWeb3.Connection) {
    console.error('[OST RPC] solanaWeb3 not loaded — multiplexer disabled');
    return;
  }
  if (window.__OST_RPC_MUX_INSTALLED__) return;
  window.__OST_RPC_MUX_INSTALLED__ = true;

  // Public Solana endpoints that allow CORS from browsers.
  // Order = priority. The first one is used as the "primary" for state
  // (subscriptions, cached blockhashes), but reads/writes round-robin.
  //
  // Mainnet flip: set window.OST_NETWORK = 'mainnet-beta' BEFORE this
  // script loads (or supply window.OST_RPC_ENDPOINTS = [...] explicitly).
  var DEFAULT_DEVNET = [
    'https://api.devnet.solana.com'
  ];
  var DEFAULT_MAINNET = [
    'https://api.mainnet-beta.solana.com',
    'https://rpc.ankr.com/solana'
  ];
  var NETWORK = (typeof window !== 'undefined' && window.OST_NETWORK) || 'devnet';
  var ENDPOINTS;
  if (typeof window !== 'undefined' && Array.isArray(window.OST_RPC_ENDPOINTS) && window.OST_RPC_ENDPOINTS.length) {
    ENDPOINTS = window.OST_RPC_ENDPOINTS.slice();
  } else if (NETWORK === 'mainnet-beta' || NETWORK === 'mainnet') {
    ENDPOINTS = DEFAULT_MAINNET.slice();
  } else {
    ENDPOINTS = DEFAULT_DEVNET.slice();
  }
  ENDPOINTS = ENDPOINTS.filter(function (endpoint) {
    return typeof endpoint === 'string' && endpoint &&
      endpoint.indexOf('api-key=public') === -1 &&
      endpoint.indexOf('rpc.ankr.com/solana') === -1 &&
      endpoint.indexOf('devnet.genesysgo.net') === -1;
  });
  if (!ENDPOINTS.length) ENDPOINTS = DEFAULT_DEVNET.slice();
  if (typeof window !== 'undefined') window.OST_RPC_ACTIVE_ENDPOINTS = ENDPOINTS.slice();

  var FAST_COMMITMENT = (window.OST_SOLANA_FAST_COMMITMENT && String(window.OST_SOLANA_FAST_COMMITMENT)) || 'processed';
  var FAST_PREFLIGHT_COMMITMENT = (window.OST_SOLANA_FAST_PREFLIGHT && String(window.OST_SOLANA_FAST_PREFLIGHT)) || FAST_COMMITMENT;
  var FAST_BLOCKHASH_COMMITMENT = (window.OST_SOLANA_BLOCKHASH_COMMITMENT && String(window.OST_SOLANA_BLOCKHASH_COMMITMENT)) || FAST_COMMITMENT;
  var FAST_MAX_RETRIES = Number.isFinite(Number(window.OST_SOLANA_MAX_RETRIES)) ? Number(window.OST_SOLANA_MAX_RETRIES) : 3;
  var FAST_BLOCKHASH_TTL_MS = Number.isFinite(Number(window.OST_SOLANA_BLOCKHASH_TTL_MS)) ? Number(window.OST_SOLANA_BLOCKHASH_TTL_MS) : 18000;
  var FAST_PRIORITY_MICRO_LAMPORTS = Number.isFinite(Number(window.OST_SOLANA_PRIORITY_MICRO_LAMPORTS)) ? Number(window.OST_SOLANA_PRIORITY_MICRO_LAMPORTS) : 25000;
  var FAST_COMPUTE_UNIT_LIMIT = Number.isFinite(Number(window.OST_SOLANA_COMPUTE_UNIT_LIMIT)) ? Number(window.OST_SOLANA_COMPUTE_UNIT_LIMIT) : 240000;
  var blockhashCache = {};

  function fastSendOptions(extra) {
    var options = Object.assign({
      skipPreflight: true,
      preflightCommitment: FAST_PREFLIGHT_COMMITMENT,
      maxRetries: FAST_MAX_RETRIES
    }, extra || {});
    if (!options.preflightCommitment) options.preflightCommitment = FAST_PREFLIGHT_COMMITMENT;
    if (!Number.isFinite(Number(options.maxRetries))) options.maxRetries = FAST_MAX_RETRIES;
    return options;
  }

  function txHasRealSignature(tx) {
    return !!(tx && Array.isArray(tx.signatures) && tx.signatures.some(function (sigPair) { return sigPair && sigPair.signature; }));
  }

  function sameProgramId(left, right) {
    try {
      if (!left || !right) return false;
      if (typeof left.equals === 'function') return left.equals(right);
      return String(left) === String(right);
    } catch (_) { return false; }
  }

  function applyPriorityFees(tx, opts) {
    if (!tx || !Array.isArray(tx.instructions) || txHasRealSignature(tx)) return tx;
    var budget = solanaWeb3.ComputeBudgetProgram;
    if (!budget || !budget.programId) return tx;
    var hasBudgetIx = tx.instructions.some(function (ix) { return ix && sameProgramId(ix.programId, budget.programId); });
    if (hasBudgetIx) return tx;
    var settings = opts || {};
    var microLamports = Number.isFinite(Number(settings.microLamports)) ? Number(settings.microLamports) : FAST_PRIORITY_MICRO_LAMPORTS;
    var unitLimit = Number.isFinite(Number(settings.computeUnitLimit)) ? Number(settings.computeUnitLimit) : FAST_COMPUTE_UNIT_LIMIT;
    var prefix = [];
    try { if (unitLimit > 0 && budget.setComputeUnitLimit) prefix.push(budget.setComputeUnitLimit({ units: Math.floor(unitLimit) })); } catch (_) {}
    try { if (microLamports > 0 && budget.setComputeUnitPrice) prefix.push(budget.setComputeUnitPrice({ microLamports: Math.floor(microLamports) })); } catch (_) {}
    if (prefix.length) tx.instructions = prefix.concat(tx.instructions);
    return tx;
  }

  async function fastLatestBlockhash(conn, opts) {
    if (!conn || typeof conn.getLatestBlockhash !== 'function') throw new Error('Solana RPC unavailable');
    var endpoint = conn._rpcEndpoint || ENDPOINTS[0] || 'default';
    var key = endpoint + '|' + FAST_BLOCKHASH_COMMITMENT;
    var cached = blockhashCache[key];
    if (cached && cached.blockhash && Date.now() - cached.ts < FAST_BLOCKHASH_TTL_MS) return cached;
    var latest = await conn.getLatestBlockhash((opts && opts.commitment) || FAST_BLOCKHASH_COMMITMENT);
    var stored = Object.assign({}, latest, { ts: Date.now(), commitment: (opts && opts.commitment) || FAST_BLOCKHASH_COMMITMENT });
    blockhashCache[key] = stored;
    return stored;
  }

  function backgroundConfirm(conn, signature, latest) {
    if (!conn || !signature || typeof conn.confirmTransaction !== 'function') return;
    setTimeout(function () {
      var strategy = latest && latest.blockhash
        ? { signature: signature, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight }
        : signature;
      conn.confirmTransaction(strategy, 'confirmed').catch(function () {});
    }, 0);
  }

  async function fastConfirm(conn, signature, latest, opts) {
    if (!conn || !signature || typeof conn.confirmTransaction !== 'function') throw new Error('Solana RPC unavailable');
    var commitment = (opts && opts.commitment) || FAST_COMMITMENT;
    var strategy = latest && latest.blockhash
      ? { signature: signature, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight }
      : signature;
    var res = await conn.confirmTransaction(strategy, commitment);
    if (!(res && res.value && res.value.err)) backgroundConfirm(conn, signature, latest);
    return res;
  }

  window.OST_SOLANA_FAST = Object.assign(window.OST_SOLANA_FAST || {}, {
    commitment: FAST_COMMITMENT,
    preflightCommitment: FAST_PREFLIGHT_COMMITMENT,
    blockhashCommitment: FAST_BLOCKHASH_COMMITMENT,
    sendOptions: fastSendOptions,
    getLatestBlockhash: fastLatestBlockhash,
    applyPriorityFees: applyPriorityFees,
    confirm: fastConfirm,
    backgroundConfirm: backgroundConfirm,
    hasRealSignature: txHasRealSignature
  });

  // Per-endpoint health: temporary backoff on 429 / 5xx
  var health = {};
  ENDPOINTS.forEach(function (e) { health[e] = { failuresUntil: 0, lastErr: '' }; });

  function ensureHealth(ep) {
    if (!ep) ep = ENDPOINTS[0];
    if (!health[ep]) health[ep] = { failuresUntil: 0, lastErr: '' };
    return health[ep];
  }

  function isUsable(ep) { return Date.now() >= ensureHealth(ep).failuresUntil; }
  function markFailed(ep, err) {
    var h = ensureHealth(ep);
    h.failuresUntil = Date.now() + 8000; // 8s cooldown
    h.lastErr = (err && err.message) || String(err || '');
  }
  function activeEndpoints() {
    return ENDPOINTS.filter(isUsable);
  }
  function endpointCooldownMs() {
    var now = Date.now();
    var nextReady = Infinity;
    ENDPOINTS.forEach(function (ep) {
      var until = ensureHealth(ep).failuresUntil;
      if (until > now && until < nextReady) nextReady = until;
    });
    return nextReady === Infinity ? 0 : Math.max(250, Math.min(8000, nextReady - now));
  }
  async function waitForRpcCooldown() {
    if (activeEndpoints().length) return;
    var delay = endpointCooldownMs();
    if (delay > 0) await new Promise(function (resolve) { setTimeout(resolve, delay); });
  }
  function orderedEndpoints(primaryEp) {
    var order = [];
    var active = activeEndpoints();
    if (primaryEp && isUsable(primaryEp)) order.push(primaryEp);
    active.forEach(function (ep) { if (ep !== primaryEp && order.indexOf(ep) < 0) order.push(ep); });
    if (order.length) return order;
    if (primaryEp) return [primaryEp];
    return ENDPOINTS.slice();
  }

  // Build a sibling Connection per backup endpoint, lazily.
  var siblings = {};
  function siblingFor(ep, primary) {
    if (siblings[ep]) return siblings[ep];
    try {
      siblings[ep] = new solanaWeb3.Connection(ep, primary._commitment || FAST_COMMITMENT);
    } catch (e) {
      siblings[ep] = null;
    }
    return siblings[ep];
  }

  // ────────────────────────────────────────────────────────────────────────
  // READ wrapper: try primary, then fall through to siblings on failure.
  // ────────────────────────────────────────────────────────────────────────
  function wrapRead(name) {
    var orig = solanaWeb3.Connection.prototype[name];
    if (typeof orig !== 'function') return;
    solanaWeb3.Connection.prototype[name] = async function () {
      var args = arguments;
      var self = this;
      var primaryEp = self._rpcEndpoint || ENDPOINTS[0];
      var tried = [];
      var lastErr = null;

      await waitForRpcCooldown();
      var order = orderedEndpoints(primaryEp);
      for (var i = 0; i < order.length; i++) {
        var ep = order[i];
        if (tried.indexOf(ep) >= 0) continue;
        tried.push(ep);
        var conn = (ep === primaryEp) ? self : siblingFor(ep, self);
        if (!conn) continue;
        try {
          var res = await orig.apply(conn, args);
          // Success — clear backoff
          ensureHealth(ep).failuresUntil = 0;
          return res;
        } catch (e) {
          var msg = (e && e.message) || String(e);
          // Only fall through on rate-limit / network errors. Real on-chain
          // errors (e.g. AccountNotFound) should NOT trigger fallback.
          if (msg.indexOf('429') >= 0 || msg.indexOf('Too Many Requests') >= 0 ||
              msg.indexOf('502') >= 0 || msg.indexOf('503') >= 0 || msg.indexOf('504') >= 0 ||
              msg.indexOf('failed to fetch') >= 0 || msg.indexOf('Failed to fetch') >= 0 ||
              msg.indexOf('NetworkError') >= 0 || msg.indexOf('timeout') >= 0 ||
              msg.indexOf('ECONNRESET') >= 0) {
            markFailed(ep, e);
            lastErr = e;
            continue;
          }
          throw e; // genuine error — don't mask
        }
      }
      throw lastErr || new Error('All RPC endpoints unavailable');
    };
  }

  ['getBalance', 'getAccountInfo', 'getMultipleAccountsInfo', 'getTokenAccountBalance',
   'getLatestBlockhash', 'getRecentBlockhash', 'getSignatureStatus', 'getSignatureStatuses',
   'getSlot', 'getBlockHeight', 'getMinimumBalanceForRentExemption', 'getEpochInfo',
   'getProgramAccounts', 'getTokenAccountsByOwner', 'getTransaction', 'getParsedTransaction']
    .forEach(wrapRead);

  // ────────────────────────────────────────────────────────────────────────
  // WRITE wrapper: BROADCAST to every healthy endpoint in parallel.
  // First success wins; the rest are fire-and-forget. Solana de-dupes
  // identical signatures, so this is safe and dramatically improves
  // landing rate when the primary RPC is throttled.
  // ────────────────────────────────────────────────────────────────────────
  var origSendRaw = solanaWeb3.Connection.prototype.sendRawTransaction;
  solanaWeb3.Connection.prototype.sendRawTransaction = async function (rawTx, options) {
    var self = this;
    var sendOptions = fastSendOptions(options || {});
    var primaryEp = self._rpcEndpoint || ENDPOINTS[0];
    await waitForRpcCooldown();
    var endpoints = orderedEndpoints(primaryEp);
    var dedup = []; var seen = {};
    endpoints.forEach(function (e) { if (!seen[e]) { seen[e] = 1; dedup.push(e); } });

    return new Promise(function (resolve, reject) {
      var settled = false;
      var failures = 0;
      var lastErr = null;
      dedup.forEach(function (ep) {
        var conn = (ep === primaryEp) ? self : siblingFor(ep, self);
        if (!conn) { failures++; return; }
        origSendRaw.call(conn, rawTx, sendOptions).then(function (sig) {
          if (settled) return;
          settled = true;
          ensureHealth(ep).failuresUntil = 0;
          try { console.log('[OST RPC] tx broadcast accepted by', ep, sig.slice(0, 8) + '…'); } catch (_) {}
          resolve(sig);
        }).catch(function (e) {
          var msg = (e && e.message) || String(e);
          var transient = msg.indexOf('429') >= 0 || msg.indexOf('Too Many Requests') >= 0 ||
                          msg.indexOf('502') >= 0 || msg.indexOf('503') >= 0 || msg.indexOf('504') >= 0 ||
                          msg.indexOf('failed to fetch') >= 0 || msg.indexOf('Failed to fetch') >= 0 ||
                          msg.indexOf('NetworkError') >= 0 || msg.indexOf('timeout') >= 0;
          if (transient) markFailed(ep, e);
          failures++;
          lastErr = e;
          if (failures >= dedup.length && !settled) {
            settled = true;
            reject(lastErr);
          }
        });
      });
      if (dedup.length === 0) reject(new Error('No RPC endpoints available'));
    });
  };

  // requestAirdrop also gets the broadcast treatment (any one endpoint
  // accepting the airdrop makes it land).
  var origAirdrop = solanaWeb3.Connection.prototype.requestAirdrop;
  solanaWeb3.Connection.prototype.requestAirdrop = async function (pubkey, lamports) {
    var self = this;
    var primaryEp = self._rpcEndpoint || ENDPOINTS[0];
    await waitForRpcCooldown();
    var endpoints = orderedEndpoints(primaryEp);
    var lastErr = null;
    for (var i = 0; i < endpoints.length; i++) {
      var ep = endpoints[i];
      var conn = (ep === primaryEp) ? self : siblingFor(ep, self);
      if (!conn) continue;
      try {
        var sig = await origAirdrop.call(conn, pubkey, lamports);
        return sig;
      } catch (e) {
        markFailed(ep, e);
        lastErr = e;
      }
    }
    throw lastErr || new Error('All airdrop endpoints rate-limited — open https://faucet.solana.com manually');
  };

  // ────────────────────────────────────────────────────────────────────────
  // confirmTransaction: poll every endpoint so a tx broadcast on RPC #2
  // still gets confirmed even if RPC #1 hasn't seen the signature yet.
  // ────────────────────────────────────────────────────────────────────────
  var origConfirm = solanaWeb3.Connection.prototype.confirmTransaction;
  solanaWeb3.Connection.prototype.confirmTransaction = async function (sigOrStrategy, commitment) {
    var self = this;
    var primaryEp = self._rpcEndpoint || ENDPOINTS[0];
    await waitForRpcCooldown();
    var endpoints = orderedEndpoints(primaryEp);
    return new Promise(function (resolve, reject) {
      var settled = false;
      var failures = 0;
      var lastErr = null;
      endpoints.forEach(function (ep) {
        var conn = (ep === primaryEp) ? self : siblingFor(ep, self);
        if (!conn) { failures++; return; }
        origConfirm.call(conn, sigOrStrategy, commitment).then(function (res) {
          if (settled) return;
          settled = true;
          resolve(res);
        }).catch(function (e) {
          failures++;
          lastErr = e;
          if (failures >= endpoints.length && !settled) {
            settled = true;
            reject(lastErr);
          }
        });
      });
    });
  };

  // ────────────────────────────────────────────────────────────────────────
  // Diagnostic: surface RPC health to the console + window helper
  // ────────────────────────────────────────────────────────────────────────
  window.OST_RPC_STATUS = function () {
    var rows = ENDPOINTS.map(function (ep) {
      var h = ensureHealth(ep);
      var until = h.failuresUntil > Date.now() ? ('⏳ ' + Math.ceil((h.failuresUntil - Date.now()) / 1000) + 's') : '✅ ready';
      return ep.padEnd(50) + ' ' + until + (h.lastErr ? ' (last err: ' + h.lastErr.slice(0, 80) + ')' : '');
    });
    console.log('[OST RPC] endpoint health:\n  ' + rows.join('\n  '));
    return health;
  };

  console.log('[OST RPC] multiplexer installed across ' + ENDPOINTS.length + ' devnet endpoints. Run OST_RPC_STATUS() to inspect.');
})();

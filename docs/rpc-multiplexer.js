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
    'https://api.devnet.solana.com',
    'https://rpc.ankr.com/solana_devnet',
    'https://devnet.genesysgo.net'
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
  if (typeof window !== 'undefined') window.OST_RPC_ACTIVE_ENDPOINTS = ENDPOINTS.slice();

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
    var ok = ENDPOINTS.filter(isUsable);
    return ok.length ? ok : ENDPOINTS.slice(); // never return empty
  }

  // Build a sibling Connection per backup endpoint, lazily.
  var siblings = {};
  function siblingFor(ep, primary) {
    if (siblings[ep]) return siblings[ep];
    try {
      siblings[ep] = new solanaWeb3.Connection(ep, primary._commitment || 'confirmed');
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

      var order = [primaryEp].concat(activeEndpoints().filter(function (e) { return e !== primaryEp; }));
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
    var primaryEp = self._rpcEndpoint || ENDPOINTS[0];
    var endpoints = [primaryEp].concat(activeEndpoints().filter(function (e) { return e !== primaryEp; }));
    var dedup = []; var seen = {};
    endpoints.forEach(function (e) { if (!seen[e]) { seen[e] = 1; dedup.push(e); } });

    return new Promise(function (resolve, reject) {
      var settled = false;
      var failures = 0;
      var lastErr = null;
      dedup.forEach(function (ep) {
        var conn = (ep === primaryEp) ? self : siblingFor(ep, self);
        if (!conn) { failures++; return; }
        origSendRaw.call(conn, rawTx, options).then(function (sig) {
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
    var endpoints = [primaryEp].concat(activeEndpoints().filter(function (e) { return e !== primaryEp; }));
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
    var endpoints = [primaryEp].concat(activeEndpoints().filter(function (e) { return e !== primaryEp; }));
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

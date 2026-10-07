/* ==========================================================================
 * OST · RPC Multiplexer (devnet)
 * --------------------------------------------------------------------------
 * Patches `solanaWeb3.Connection.prototype` so every Connection instance in
 * the app — `app.js`, `wallet-extras.js`, `devnet-rescue.js`, faucet hub —
 * fails over between WORKING devnet endpoints:
 *
 *   • Endpoint list = the worker's /rpc-config answer (the dedicated browser
 *     RPC plus its fallbacks) followed by public devnet. Dead or keyed
 *     endpoints (ankr without a key, genesysgo serving HTML, the shared
 *     ?api-key=public Helius) are never used (NET-1).
 *   • Every Connection is created with disableRetryOnRateLimit:true, so a 429
 *     fails over at once instead of web3.js sleeping 0.5+1+2+4 s first.
 *   • Reads retry across endpoints on 429 / 5xx / network failure. An endpoint
 *     that rate-limited is parked for 20 s and NOT tried again while cooling
 *     (the primary included).
 *   • Writes (sendRawTransaction) are broadcast to the healthy endpoints in
 *     parallel; the first acceptance wins. Solana de-dupes by signature.
 *   • confirmTransaction polls getSignatureStatuses over HTTP across the
 *     healthy endpoints (SOL-4) — no websocket race against dead endpoints.
 *
 * MUST load AFTER @solana/web3.js and BEFORE app.js / any module that
 * constructs a Connection.
 * ========================================================================== */
(function () {
  'use strict';

  if (typeof solanaWeb3 === 'undefined' || !solanaWeb3.Connection) {
    console.error('[OST RPC] solanaWeb3 not loaded — multiplexer disabled');
    return;
  }
  if (window.__OST_RPC_MUX_INSTALLED__) return;
  window.__OST_RPC_MUX_INSTALLED__ = true;

  var PUBLIC_DEVNET = 'https://api.devnet.solana.com';
  var DEFAULT_MAINNET = ['https://api.mainnet-beta.solana.com'];
  var NETWORK = (typeof window !== 'undefined' && window.OST_NETWORK) || 'devnet';
  var COOLDOWN_MS = 20000;
  // Never route through these (dead, keyed, or a shared public key).
  var BANNED = /rpc\.ankr\.com|genesysgo|api-key=public|alchemy\.com\/v2\/demo/i;

  var ENDPOINTS;
  if (Array.isArray(window.OST_RPC_ENDPOINTS) && window.OST_RPC_ENDPOINTS.length) {
    ENDPOINTS = window.OST_RPC_ENDPOINTS.filter(function (u) { return !BANNED.test(u); });
  } else if (NETWORK === 'mainnet-beta' || NETWORK === 'mainnet') {
    ENDPOINTS = DEFAULT_MAINNET.slice();
  } else {
    ENDPOINTS = [PUBLIC_DEVNET];
  }
  if (!ENDPOINTS.length) ENDPOINTS = [PUBLIC_DEVNET];
  window.OST_RPC_ACTIVE_ENDPOINTS = ENDPOINTS.slice();

  var health = {};
  function ensureHealth(ep) {
    if (!health[ep]) health[ep] = { failuresUntil: 0, lastErr: '' };
    return health[ep];
  }
  function isUsable(ep) { return Date.now() >= ensureHealth(ep).failuresUntil; }
  function markFailed(ep, err) {
    var h = ensureHealth(ep);
    h.failuresUntil = Date.now() + COOLDOWN_MS;
    h.lastErr = (err && err.message) || String(err || '');
  }
  function markOk(ep) { ensureHealth(ep).failuresUntil = 0; }

  function setEndpoints(list) {
    var seen = {}, out = [];
    list.forEach(function (u) {
      if (typeof u !== 'string' || !/^https:\/\//.test(u) || BANNED.test(u) || seen[u]) return;
      seen[u] = 1; out.push(u);
    });
    if (!out.length) return;
    ENDPOINTS = out;
    window.OST_RPC_ACTIVE_ENDPOINTS = ENDPOINTS.slice();
  }

  // Same endpoints app.js uses (the worker's /rpc-config). ost-auth.js shares
  // this GET across modules, so it costs no extra worker request.
  if (NETWORK === 'devnet' && !(Array.isArray(window.OST_RPC_ENDPOINTS) && window.OST_RPC_ENDPOINTS.length)) {
    try {
      var base = String(window.OST_API_BASE || 'https://ost-api.nachogtavl.workers.dev').replace(/\/+$/, '');
      fetch(base + '/rpc-config', { cache: 'no-store' })
        .then(function (r) { return r.json(); })
        .then(function (c) {
          if (!c || typeof c.rpc !== 'string') return;
          var fb = Array.isArray(c.fallbacks) ? c.fallbacks : [];
          setEndpoints([c.rpc].concat(fb).concat([PUBLIC_DEVNET]));
        }).catch(function () {});
    } catch (_) {}
  }

  function isTransient(e) {
    var msg = (e && e.message) || String(e || '');
    return /\b(401|403|429|500|502|503|504)\b|too many requests|rate.?limit|failed to fetch|networkerror|load failed|timeout|timed out|econnreset|unexpected token|invalid api key|unauthorized|forbidden|not valid json/i.test(msg);
  }

  // Patch the ORIGINAL prototype (instances made before or after the swap
  // below all inherit it).
  var ConnProto = solanaWeb3.Connection.prototype;

  // Force disableRetryOnRateLimit on every Connection the app builds, so a 429
  // surfaces immediately and the failover below can move on.
  (function forceNoRateLimitSleep() {
    var Orig = solanaWeb3.Connection;
    function normalize(cfg) {
      if (typeof cfg === 'string') cfg = { commitment: cfg };
      return Object.assign({ disableRetryOnRateLimit: true }, cfg || {});
    }
    try {
      var Patched = class extends Orig {
        constructor(endpoint, cfg) { super(endpoint, normalize(cfg)); }
      };
      try { Object.defineProperty(Patched, 'name', { value: 'Connection' }); } catch (_) {}
      solanaWeb3.Connection = Patched;
    } catch (_) {
      // Read-only namespace: siblings below still set the flag themselves.
    }
  })();

  var siblings = {};
  function siblingFor(ep, primary) {
    if (siblings[ep]) return siblings[ep];
    try { siblings[ep] = new solanaWeb3.Connection(ep, { commitment: (primary && primary._commitment) || 'confirmed', disableRetryOnRateLimit: true }); }
    catch (e) { siblings[ep] = null; }
    return siblings[ep];
  }
  function endpointOf(conn) { return (conn && conn._rpcEndpoint) || ENDPOINTS[0]; }

  // Healthy order: the caller's endpoint first if it is not cooling, then every
  // other healthy endpoint. If ALL are cooling, try the soonest-recovering one.
  function order(primaryEp) {
    var list = [primaryEp].concat(ENDPOINTS.filter(function (e) { return e !== primaryEp; }));
    var healthy = list.filter(function (e) { return isUsable(e) && !BANNED.test(e); });
    if (healthy.length) return healthy;
    var all = list.filter(function (e) { return !BANNED.test(e); });
    all.sort(function (a, b) { return ensureHealth(a).failuresUntil - ensureHealth(b).failuresUntil; });
    return all.slice(0, 1).length ? all.slice(0, 1) : [PUBLIC_DEVNET];
  }

  function wrapRead(name) {
    var orig = ConnProto[name];
    if (typeof orig !== 'function' || orig.__ostMux) return;
    var wrapped = async function () {
      var args = arguments, self = this;
      var primaryEp = endpointOf(self);
      var seq = order(primaryEp), lastErr = null;
      for (var i = 0; i < seq.length; i++) {
        var ep = seq[i];
        var conn = (ep === primaryEp) ? self : siblingFor(ep, self);
        if (!conn) continue;
        try {
          var res = await orig.apply(conn, args);
          markOk(ep);
          return res;
        } catch (e) {
          if (!isTransient(e)) throw e;          // a genuine answer (e.g. account not found)
          markFailed(ep, e);
          lastErr = e;
        }
      }
      throw lastErr || new Error('All RPC endpoints unavailable');
    };
    wrapped.__ostMux = true;
    ConnProto[name] = wrapped;
  }

  ['getBalance', 'getAccountInfo', 'getParsedAccountInfo', 'getMultipleAccountsInfo', 'getTokenAccountBalance',
   'getLatestBlockhash', 'getRecentBlockhash', 'getSignatureStatus', 'getSignatureStatuses',
   'getSlot', 'getBlockHeight', 'getMinimumBalanceForRentExemption', 'getEpochInfo',
   'getProgramAccounts', 'getTokenAccountsByOwner', 'getParsedTokenAccountsByOwner',
   'getTransaction', 'getParsedTransaction', 'getParsedTransactions', 'getSignaturesForAddress',
   'getFeeForMessage', 'simulateTransaction', 'isBlockhashValid']
    .forEach(wrapRead);

  // WRITE: broadcast to every healthy endpoint; first acceptance wins. A
  // non-transient rejection (simulation failure) is a real answer and is
  // returned as soon as every endpoint has answered.
  var origSendRaw = ConnProto.sendRawTransaction;
  ConnProto.sendRawTransaction = async function (rawTx, options) {
    var self = this;
    var primaryEp = endpointOf(self);
    var seq = order(primaryEp);
    return new Promise(function (resolve, reject) {
      var settled = false, failures = 0, lastErr = null, realErr = null;
      seq.forEach(function (ep) {
        var conn = (ep === primaryEp) ? self : siblingFor(ep, self);
        if (!conn) { failures++; return; }
        origSendRaw.call(conn, rawTx, options).then(function (sig) {
          if (settled) return;
          settled = true;
          markOk(ep);
          resolve(sig);
        }).catch(function (e) {
          if (isTransient(e)) markFailed(ep, e); else realErr = realErr || e;
          failures++;
          lastErr = e;
          if (failures >= seq.length && !settled) { settled = true; reject(realErr || lastErr); }
        });
      });
      if (!seq.length) reject(new Error('No RPC endpoints available'));
    });
  };

  var origAirdrop = ConnProto.requestAirdrop;
  ConnProto.requestAirdrop = async function (pubkey, lamports) {
    var self = this, primaryEp = endpointOf(self), seq = order(primaryEp), lastErr = null;
    for (var i = 0; i < seq.length; i++) {
      var conn = (seq[i] === primaryEp) ? self : siblingFor(seq[i], self);
      if (!conn) continue;
      try { return await origAirdrop.call(conn, pubkey, lamports); }
      catch (e) { markFailed(seq[i], e); lastErr = e; }
    }
    throw lastErr || new Error('Devnet airdrops are rate-limited right now');
  };

  // CONFIRM over HTTP: poll getSignatureStatuses (failover-wrapped above) until
  // the requested commitment, an on-chain error, block-height expiry, or 60 s.
  function rank(c) { return c === 'finalized' ? 3 : c === 'confirmed' ? 2 : c === 'processed' ? 1 : 0; }
  ConnProto.confirmTransaction = async function (sigOrStrategy, commitment) {
    var self = this;
    var sig = typeof sigOrStrategy === 'string' ? sigOrStrategy : (sigOrStrategy && sigOrStrategy.signature);
    var lastValid = sigOrStrategy && typeof sigOrStrategy === 'object' ? Number(sigOrStrategy.lastValidBlockHeight) || 0 : 0;
    var want = rank(commitment || self._commitment || 'confirmed') || 2;
    if (!sig) throw new Error('confirmTransaction: missing signature');
    var deadline = Date.now() + 60000, poll = 0;
    while (Date.now() < deadline) {
      try {
        var r = await self.getSignatureStatuses([sig], { searchTransactionHistory: poll > 4 });
        var st = r && r.value && r.value[0];
        if (st) {
          if (st.err) return { context: r.context, value: { err: st.err } };
          if (rank(st.confirmationStatus) >= want || (st.confirmations == null && rank(st.confirmationStatus) >= 2)) {
            return { context: r.context, value: { err: null } };
          }
        } else if (lastValid && poll % 4 === 3) {
          try {
            var h = await self.getBlockHeight('confirmed');
            if (h > lastValid) {
              var ex = new Error('Signature ' + sig + ' has expired: block height exceeded.');
              ex.name = 'TransactionExpiredBlockheightExceededError';
              ex.signature = sig;
              throw ex;
            }
          } catch (e) { if (e && e.name === 'TransactionExpiredBlockheightExceededError') throw e; }
        }
      } catch (e) {
        if (e && e.name === 'TransactionExpiredBlockheightExceededError') throw e;
      }
      poll++;
      await new Promise(function (res) { setTimeout(res, poll < 6 ? 600 : 1200); });
    }
    var to = new Error('Transaction was not confirmed in 60 s. Signature ' + sig + ' — check it before retrying.');
    to.name = 'TransactionExpiredTimeoutError';
    to.signature = sig;
    throw to;
  };

  window.OST_RPC_STATUS = function () {
    var rows = ENDPOINTS.map(function (ep) {
      var h = ensureHealth(ep);
      var until = h.failuresUntil > Date.now() ? ('cooling ' + Math.ceil((h.failuresUntil - Date.now()) / 1000) + 's') : 'ready';
      return ep.replace(/api-key=[^&]+/, 'api-key=…').padEnd(60) + ' ' + until + (h.lastErr ? ' (last: ' + h.lastErr.slice(0, 80) + ')' : '');
    });
    console.log('[OST RPC] endpoint health:\n  ' + rows.join('\n  '));
    return health;
  };
  window.OST_RPC_MUX = { endpoints: function () { return ENDPOINTS.slice(); }, setEndpoints: setEndpoints, isUsable: isUsable, markFailed: markFailed };
})();

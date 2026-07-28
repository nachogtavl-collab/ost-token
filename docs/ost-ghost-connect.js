/* ==========================================================================
 * OST · Ghost Connect — REAL connectors for AIs, bots, servers & endpoints
 * --------------------------------------------------------------------------
 * WHAT THIS IS (and the honesty rule it obeys)
 *
 * The connector cards used to call a stub that returned a soft "ready" for
 * Anthropic/Gemini/MCP/Claude/Grok/GitHub — nothing actually connected. This
 * replaces that with connections that are REAL where a browser can make them,
 * and HONEST where it cannot:
 *
 *   • LLMs (OpenAI, Anthropic, Gemini, Grok) — a genuine authenticated request
 *     to the provider from your browser, with the exact CORS header each one
 *     requires. On success the model is registered so the Ghost can THINK with
 *     it: OST_GHOST_CONNECT.chat(messages) routes to your connected model.
 *   • Endpoints (Localhost, VPS/Cloud, Webhooks, MCP-over-HTTP, GPU Compute,
 *     Trading bots) — a real ping to your URL, then registered as a Ghost relay
 *     (it POSTs your question + grounded stats) and an emit target (OST posts
 *     live events to it). If CORS hides the response we say "reachable" and no
 *     more — never a fake "connected".
 *   • Bots (Telegram, GitHub) — real API calls (getMe, /user).
 *   • Things a browser genuinely CANNOT do (Discord gateway, stdio MCP) are
 *     labeled as needing a backend. We register intent, never a false success.
 *
 * KEYS NEVER LEAVE YOUR DEVICE. They live in localStorage and are sent ONLY to
 * the provider you typed them for — never to any OST server. A browser-side key
 * is visible to this page; for production, connect a relay URL instead of a raw
 * key. This is stated in the UI, not hidden.
 *
 * The Ghost is connected to every page/feature via siteMap(): a live inventory
 * of OST surfaces + your grounded stats, handed to every connected AI as context
 * so it actually KNOWS the app it is acting on.
 *
 * API: window.OST_GHOST_CONNECT
 *   .test(type, cfg) -> Promise<{ok, detail, kind}>   // real connect + register
 *   .chat(messages, opts) -> Promise<{text, provider}>// think via a connected LLM
 *   .emit(event) -> Promise<n>                         // POST to connected endpoints
 *   .list() / .status(type) / .disconnect(type)
 *   .siteMap() / .context()                            // what the Ghost knows
 * ========================================================================== */
(function () {
  'use strict';
  if (window.OST_GHOST_CONNECT) return;

  var STORE = 'ost.ghost.connectors.v1';
  var conns = load();

  function load() { try { return JSON.parse(localStorage.getItem(STORE) || '{}') || {}; } catch (_) { return {}; } }
  function save() { try { localStorage.setItem(STORE, JSON.stringify(conns)); } catch (_) {} }
  function emitChange(type) { try { window.dispatchEvent(new CustomEvent('ost:ghost-connector-changed', { detail: { type: type, connectors: publicList() } })); } catch (_) {} }

  function timeout(ms) { var c = new AbortController(); setTimeout(function () { try { c.abort(); } catch (_) {} }, ms || 12000); return c.signal; }
  function j(res) { return res.json().catch(function () { return null; }); }

  /* ---- provider metadata --------------------------------------------------
   * kind: 'llm' (the Ghost can think with it), 'endpoint' (relay + emit target),
   * 'bot' (validated integration). browser: can a browser reach it directly? */
  var PROVIDERS = {
    openai:     { label: 'OpenAI',       kind: 'llm',      browser: true },
    anthropic:  { label: 'Anthropic',    kind: 'llm',      browser: true },
    claude:     { label: 'Claude AI',    kind: 'llm',      browser: true, alias: 'anthropic' },
    gemini:     { label: 'Gemini',       kind: 'llm',      browser: true },
    grok:       { label: 'Grok',         kind: 'llm',      browser: true },
    telegram:   { label: 'Telegram',     kind: 'bot',      browser: true },
    github:     { label: 'GitHub',       kind: 'bot',      browser: true },
    discord:    { label: 'Discord',      kind: 'bot',      browser: false },
    webhook:    { label: 'Webhook',      kind: 'endpoint', browser: true },
    localhost:  { label: 'Localhost',    kind: 'endpoint', browser: true },
    vps:        { label: 'VPS/Cloud',    kind: 'endpoint', browser: true },
    gpu:        { label: 'GPU Compute',  kind: 'endpoint', browser: true },
    mcp:        { label: 'MCP Server',   kind: 'endpoint', browser: true },
    agent:      { label: 'AI Agent',     kind: 'endpoint', browser: true },
    chatbot:    { label: 'Chat Bot',     kind: 'endpoint', browser: true },
    trading:    { label: 'Trading Bot',  kind: 'endpoint', browser: true },
    vscode:     { label: 'VS Code',      kind: 'bot',      browser: true },
    polymarket: { label: 'Polymarket',   kind: 'bot',      browser: false },
    kalshi:     { label: 'Kalshi',       kind: 'bot',      browser: false }
  };

  function meta(type) { var m = PROVIDERS[type] || {}; return m.alias ? Object.assign({}, PROVIDERS[m.alias], { label: m.label, alias: m.alias }) : m; }

  /* ---- the REAL connection tests, per provider --------------------------- */

  // LLM: a genuine authenticated call using each provider's required CORS header.
  var LLM = {
    openai: {
      base: 'https://api.openai.com/v1',
      test: function (c) { return fetch('https://api.openai.com/v1/models', { headers: { Authorization: 'Bearer ' + c.key }, signal: timeout() }); },
      chat: function (c, messages) {
        return fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST', headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + c.key }, signal: timeout(30000),
          body: JSON.stringify({ model: c.model || 'gpt-4o-mini', messages: messages, max_tokens: 700 })
        }).then(j).then(function (d) { return d && d.choices && d.choices[0] && d.choices[0].message ? d.choices[0].message.content : null; });
      }
    },
    anthropic: {
      // Browser calls REQUIRE this opt-in header, or Anthropic's CORS blocks it.
      hdr: function (c) { return { 'x-api-key': c.key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true', 'content-type': 'application/json' }; },
      test: function (c) { return fetch('https://api.anthropic.com/v1/models', { headers: LLM.anthropic.hdr(c), signal: timeout() }); },
      chat: function (c, messages) {
        var sys = messages.filter(function (m) { return m.role === 'system'; }).map(function (m) { return m.content; }).join('\n');
        var turns = messages.filter(function (m) { return m.role !== 'system'; }).map(function (m) { return { role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content) }; });
        return fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST', headers: LLM.anthropic.hdr(c), signal: timeout(30000),
          body: JSON.stringify({ model: c.model || 'claude-3-5-haiku-20241022', max_tokens: 700, system: sys || undefined, messages: turns })
        }).then(j).then(function (d) { return d && d.content && d.content[0] ? d.content[0].text : null; });
      }
    },
    gemini: {
      test: function (c) { return fetch('https://generativelanguage.googleapis.com/v1beta/models?key=' + encodeURIComponent(c.key), { signal: timeout() }); },
      chat: function (c, messages) {
        var model = c.model || 'gemini-2.0-flash';
        var contents = messages.filter(function (m) { return m.role !== 'system'; }).map(function (m) { return { role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: String(m.content) }] }; });
        var sys = messages.filter(function (m) { return m.role === 'system'; }).map(function (m) { return m.content; }).join('\n');
        return fetch('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + encodeURIComponent(c.key), {
          method: 'POST', headers: { 'content-type': 'application/json' }, signal: timeout(30000),
          body: JSON.stringify({ contents: contents, systemInstruction: sys ? { parts: [{ text: sys }] } : undefined })
        }).then(j).then(function (d) { try { return d.candidates[0].content.parts[0].text; } catch (_) { return null; } });
      }
    },
    grok: {
      test: function (c) { return fetch('https://api.x.ai/v1/models', { headers: { Authorization: 'Bearer ' + c.key }, signal: timeout() }); },
      chat: function (c, messages) {
        return fetch('https://api.x.ai/v1/chat/completions', {
          method: 'POST', headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + c.key }, signal: timeout(30000),
          body: JSON.stringify({ model: c.model || 'grok-2-latest', messages: messages, max_tokens: 700 })
        }).then(j).then(function (d) { return d && d.choices && d.choices[0] && d.choices[0].message ? d.choices[0].message.content : null; });
      }
    }
  };

  function reg(type, cfg, kind, detail) {
    conns[type] = { type: type, kind: kind, cfg: cfg, detail: detail || '', connectedAt: Date.now() };
    save(); emitChange(type);
  }

  // Register an HTTP endpoint as a real Ghost relay + emit target.
  function registerEndpoint(type, url, headers, detail) {
    reg(type, { url: url, headers: headers || {} }, 'endpoint', detail);
    try { if (window.OST_GHOST_BRAIN && OST_GHOST_BRAIN.connect) OST_GHOST_BRAIN.connect({ name: meta(type).label || type, url: url, headers: headers || {} }); } catch (_) {}
  }

  async function test(type, cfg) {
    cfg = cfg || {};
    var m = meta(type);
    var realType = (PROVIDERS[type] && PROVIDERS[type].alias) || type;

    // ---- LLMs: real authenticated call, then registered as a thinking model ----
    if (m.kind === 'llm') {
      if (!cfg.key) return { ok: false, detail: 'Enter your ' + m.label + ' API key.' };
      var llm = LLM[realType];
      try {
        var r = await llm.test(cfg);
        if (!r.ok) {
          var body = await r.text().catch(function () { return ''; });
          return { ok: false, detail: m.label + ' rejected the key (HTTP ' + r.status + ')' + (body ? ': ' + body.slice(0, 120) : '') };
        }
        reg(realType, { key: cfg.key, model: cfg.model }, 'llm', m.label + ' · ' + (cfg.model || 'default'));
        return { ok: true, kind: 'llm', detail: m.label + ' connected — the Ghost can now think with ' + (cfg.model || 'this model') + '. Ask it anything on any page.' };
      } catch (e) {
        // A TypeError here is almost always the browser's CORS wall.
        return { ok: false, detail: m.label + ' could not be reached from the browser (likely CORS). Use a relay URL, or run it server-side. (' + (e && e.message || e) + ')' };
      }
    }

    // ---- Telegram: real getMe ----
    if (type === 'telegram') {
      if (!cfg.key || cfg.key.indexOf(':') < 0) return { ok: false, detail: 'Telegram bot token looks wrong (expected 123456:ABC...).' };
      try {
        var tg = await fetch('https://api.telegram.org/bot' + cfg.key + '/getMe', { signal: timeout() }).then(j);
        if (!tg || !tg.ok) return { ok: false, detail: (tg && tg.description) || 'Telegram rejected the token.' };
        reg('telegram', { key: cfg.key, webhook: cfg.webhook, bot: tg.result.username }, 'bot', '@' + tg.result.username);
        return { ok: true, kind: 'bot', detail: 'Telegram bot @' + tg.result.username + ' connected.' };
      } catch (e) { return { ok: false, detail: 'Could not reach Telegram: ' + (e && e.message || e) }; }
    }

    // ---- GitHub: real /user ----
    if (type === 'github') {
      if (!cfg.key) return { ok: false, detail: 'Enter a GitHub token.' };
      try {
        var gh = await fetch('https://api.github.com/user', { headers: { Authorization: 'Bearer ' + cfg.key, Accept: 'application/vnd.github+json' }, signal: timeout() });
        if (!gh.ok) return { ok: false, detail: 'GitHub rejected the token (HTTP ' + gh.status + ').' };
        var u = await j(gh);
        reg('github', { key: cfg.key, repo: cfg.repo, login: u && u.login }, 'bot', (u && u.login ? '@' + u.login : 'authenticated') + (cfg.repo ? ' · ' + cfg.repo : ''));
        return { ok: true, kind: 'bot', detail: 'GitHub connected as ' + (u && u.login ? '@' + u.login : 'user') + '.' };
      } catch (e) { return { ok: false, detail: 'Could not reach GitHub: ' + (e && e.message || e) }; }
    }

    // ---- VS Code / Copilot: validate the GitHub token that backs it ----
    if (type === 'vscode') {
      if (!cfg.key) return { ok: false, detail: 'Enter the GitHub token your VS Code AI (Copilot/Cline/Continue) uses.' };
      try {
        var vg = await fetch('https://api.github.com/user', { headers: { Authorization: 'Bearer ' + cfg.key, Accept: 'application/vnd.github+json' }, signal: timeout() });
        if (!vg.ok) return { ok: false, detail: 'GitHub rejected that token (HTTP ' + vg.status + ').' };
        var vu = await j(vg);
        reg('vscode', { key: cfg.key, login: vu && vu.login }, 'bot', (vu && vu.login ? '@' + vu.login : 'authenticated'));
        return { ok: true, kind: 'bot', detail: 'VS Code token valid (' + (vu && vu.login ? '@' + vu.login : 'user') + '). Point your extension at the OST bot API: /bot/v1/*.' };
      } catch (e) { return { ok: false, detail: 'Could not validate the token: ' + (e && e.message || e) }; }
    }

    // ---- Browser-impossible bots: honest, no fake success ----
    if (type === 'discord') {
      return { ok: false, detail: "Discord's bot API blocks browser calls (no CORS). Run your bot with discord.js/py and register ITS webhook URL under Webhook/VPS here — then OST can drive it." };
    }
    if (type === 'polymarket' || type === 'kalshi') {
      return { ok: false, detail: m.label + ' auth needs a server (no browser CORS). Register your trading bot HTTP endpoint under Trading Bot / VPS and OST will send it signals + settlements.' };
    }

    // ---- Endpoints: real ping, then registered as relay + emit target ----
    // localhost/vps/webhook/gpu/mcp/agent/chatbot all take a URL (+optional auth).
    var url = cfg.url && String(cfg.url).trim();
    if (!url) return { ok: false, detail: 'Enter the endpoint URL for your ' + m.label + '.' };
    try { new URL(url); } catch (_) { return { ok: false, detail: 'That is not a valid URL.' }; }
    var https = /^https:/i.test(location.protocol);
    if (https && /^http:\/\//i.test(url) && !/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])/i.test(url)) {
      return { ok: false, detail: 'This page is HTTPS, so it can only call HTTPS endpoints (or localhost). Serve your endpoint over HTTPS.' };
    }
    var headers = {}; if (cfg.auth) headers['Authorization'] = cfg.auth;
    var payload = type === 'mcp'
      ? { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'OST-Ghost', version: '1' } } }
      : { type: 'ost.ping', ts: Date.now(), from: 'ost-ghost' };
    try {
      var res = await fetch(url, { method: 'POST', headers: Object.assign({ 'content-type': 'application/json' }, headers), body: JSON.stringify(payload), signal: timeout() });
      var txt = await res.text().catch(function () { return ''; });
      registerEndpoint(type, url, headers, 'HTTP ' + res.status);
      return { ok: true, kind: 'endpoint', detail: m.label + ' reachable (HTTP ' + res.status + '). Registered as a Ghost relay + event target — OST will POST it questions and live events.' };
    } catch (e) {
      // CORS blocks READING the response, but the request may still land. Register
      // as an emit-only target (fire-and-forget) and say exactly that.
      try {
        await fetch(url, { method: 'POST', mode: 'no-cors', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
        registerEndpoint(type, url, headers, 'reachable (opaque/no-cors)');
        return { ok: true, kind: 'endpoint', detail: m.label + ' reachable, but its CORS hides the reply. Registered as a one-way event target (OST can POST to it; it cannot answer back until it sends CORS headers).' };
      } catch (e2) {
        return { ok: false, detail: 'Could not reach ' + m.label + ' at ' + url + '. Check it is running and allows this origin. (' + (e2 && e2.message || e2) + ')' };
      }
    }
  }

  /* ---- THINK with a connected LLM ---------------------------------------- */
  function connectedLLM() {
    var order = ['anthropic', 'openai', 'gemini', 'grok'];
    for (var i = 0; i < order.length; i++) if (conns[order[i]] && conns[order[i]].kind === 'llm') return order[i];
    return null;
  }
  function haveLLM() { return !!connectedLLM(); }

  // Route a chat to the connected model, grounded with the Ghost's site + stats
  // context so it actually knows the app. messages: [{role, content}].
  async function chat(messages, opts) {
    opts = opts || {};
    var type = opts.provider || connectedLLM();
    if (!type || !conns[type]) throw new Error('No AI model connected. Connect one in the AI page first.');
    var msgs = messages.slice();
    if (opts.ground !== false) msgs.unshift({ role: 'system', content: systemContext() });
    var text = await LLM[type].chat(conns[type].cfg, msgs);
    if (text == null) throw new Error(meta(type).label + ' returned no text.');
    return { text: text, provider: meta(type).label };
  }

  /* ---- POST live events to connected endpoints --------------------------- */
  function emit(event) {
    var targets = Object.keys(conns).filter(function (t) { return conns[t].kind === 'endpoint'; });
    if (!targets.length) return Promise.resolve(0);
    var body = JSON.stringify({ type: 'ost.event', event: event, ts: Date.now(), context: lightContext() });
    return Promise.all(targets.map(function (t) {
      var c = conns[t].cfg;
      return fetch(c.url, { method: 'POST', mode: 'no-cors', headers: Object.assign({ 'content-type': 'application/json' }, c.headers || {}), body: body }).then(function () { return 1; }).catch(function () { return 0; });
    })).then(function (a) { return a.reduce(function (s, n) { return s + n; }, 0); });
  }

  /* ---- what the Ghost KNOWS: every page + feature, live ------------------ */
  // A live inventory of OST surfaces. `on` reflects whether the module is loaded
  // in THIS session, so a connected AI sees the real, current app — not a brochure.
  function siteMap() {
    var has = function (g) { try { return !!window[g]; } catch (_) { return false; } };
    return [
      { id: 'predictions', name: 'Prediction markets (5-min BTC/ETH/SOL + more)', on: has('OST_PREDICT_MOBILE') || has('OST_PREDICTION_API'), actions: ['browse', 'buy', 'sell', 'positions'] },
      { id: 'faucet-games', name: 'Faucet games (Plinko, Crash, etc.)', on: has('OST_FAUCET') || has('OST_HOUSE'), actions: ['play', 'claim'] },
      { id: 'wallet', name: 'Wallet (OSTG/OSTC, SOL, send/receive)', on: has('OST_WALLET'), actions: ['balance', 'send', 'connect'] },
      { id: 'session-1tap', name: '1-tap betting (session key)', on: has('OST_SESSION'), actions: ['enable', 'end'] },
      { id: 'play-balance', name: 'Custodial play balance', on: has('OST_PLAY'), actions: ['deposit', 'balance'] },
      { id: 'world-browser', name: 'OST World (IPFS browser + media)', on: has('OST_WORLD'), actions: ['open', 'browse'] },
      { id: 'media-bubble', name: 'Floating media player', on: has('OST_WORLD_BUBBLE'), actions: ['play', 'queue'] },
      { id: 'commerce', name: 'Commerce / pay links', on: has('OST_MONEY') || has('OST_COMMERCE'), actions: ['pay', 'request'] },
      { id: 'mesh', name: 'P2P mesh (games/markets over WebRTC)', on: has('OST_MESH'), actions: ['open'] },
      { id: 'parlay', name: 'Parlay slips', on: has('OST_PARLAY'), actions: ['build', 'cashout'] },
      { id: 'vault', name: 'Survival / family vault', on: has('OST_VAULT') || has('OST_LOAN_USD'), actions: ['create', 'status'] },
      { id: 'onchain', name: 'On-chain betting program (devnet)', on: has('OST_ONCHAIN'), actions: ['bet', 'claim'] },
      { id: 'ghost', name: 'Ghost AI (grounded brain + connectors)', on: has('OST_GHOST_BRAIN'), actions: ['ask', 'connect'] }
    ];
  }

  function lightContext() {
    var s = null; try { if (window.OST_GHOST_BRAIN && OST_GHOST_BRAIN.snapshot) s = OST_GHOST_BRAIN.snapshot(); } catch (_) {}
    return { wallet: (window.OST_WALLET_PUBKEY || null), features: siteMap().filter(function (f) { return f.on; }).map(function (f) { return f.id; }), snapshot: s };
  }
  function context() { return { site: siteMap(), grounded: lightContext(), connectors: publicList() }; }

  function systemContext() {
    var feats = siteMap().filter(function (f) { return f.on; }).map(function (f) { return '- ' + f.name + ' [' + f.id + ']: ' + f.actions.join(', '); }).join('\n');
    var g = ''; try { if (window.OST_GHOST_BRAIN && OST_GHOST_BRAIN.snapshot) { var s = OST_GHOST_BRAIN.snapshot(); g = '\nUser grounded stats: ' + JSON.stringify(s).slice(0, 700); } } catch (_) {}
    return 'You are the OST Ghost — the AI embedded in the OST app (a Solana devnet SPL token app). You are connected to every OST surface. ' +
      'Answer as the in-app assistant, referencing real features by name. OST surfaces live in this session:\n' + feats + g +
      '\nBe concise and practical. Never invent balances or numbers — if unknown, say so.';
  }

  /* ---- introspection / management --------------------------------------- */
  function publicList() {
    return Object.keys(conns).map(function (t) { return { type: t, label: meta(t).label || t, kind: conns[t].kind, detail: conns[t].detail, connectedAt: conns[t].connectedAt }; });
  }
  function status(type) { var c = conns[(PROVIDERS[type] && PROVIDERS[type].alias) || type]; return c ? { connected: true, kind: c.kind, detail: c.detail } : { connected: false }; }
  function disconnect(type) { var t = (PROVIDERS[type] && PROVIDERS[type].alias) || type; if (conns[t]) { delete conns[t]; save(); emitChange(t); return true; } return false; }

  window.OST_GHOST_CONNECT = {
    test: test, chat: chat, emit: emit, haveLLM: haveLLM,
    list: publicList, status: status, disconnect: disconnect,
    siteMap: siteMap, context: context, providers: PROVIDERS
  };

  // Broadcast live OST events to connected endpoints (opt-in per endpoint). These
  // are the same events the rest of the app already fires — no new plumbing.
  ['ost:wallet-changed', 'ost:prediction-order-recorded', 'ost:money:change', 'ost:btc-round'].forEach(function (ev) {
    window.addEventListener(ev, function (e) { try { emit({ name: ev, detail: (e && e.detail) || null }); } catch (_) {} });
  });
})();

/* ==========================================================================
 * OST · Rainbet-style provably-fair mini-games
 * --------------------------------------------------------------------------
 * Replaces the old single-mini-game faucet model with a small casino-style
 * suite. All games:
 *   - Use the SAME bonus-credit balance from `ost.faucet.hub.v2` (so they
 *     plug into the existing cash-out → real on-chain OST flow).
 *   - Are provably fair: client seed + server seed (per-session pseudo-random
 *     hashed reveal, so the user can verify the outcome wasn't tampered).
 *   - Visualise risk with multipliers, exactly like Stake/Rainbet.
 *
 * Games shipped:
 *   • 18 provably-fair instant games, focused on Stake/Rainbet-style originals.
 *
 * Mounts a card panel inside the existing #ostFaucetHub section.
 * ========================================================================== */
(function () {
  'use strict';

  var STATE_KEY = 'ost.faucet.hub.v2';   // share balance with faucet-hub
  var GAMES_STATE_KEY = 'ost.games.v1';

  function offlineVaultApi() {
    return window.OSTOfflineVault || null;
  }
  function isOfflineVaultActive() {
    var vault = offlineVaultApi();
    try { return !!(vault && vault.isActive && vault.isActive()); }
    catch (_) { return false; }
  }

  function loadBank() { try { return JSON.parse(localStorage.getItem(STATE_KEY) || '{}'); } catch (_) { return {}; } }
  function saveBank(s) { try { localStorage.setItem(STATE_KEY, JSON.stringify(s)); } catch (_) {} }
  function loadGames() { try { return JSON.parse(localStorage.getItem(GAMES_STATE_KEY) || '{}'); } catch (_) { return {}; } }
  function saveGames(s) { try { localStorage.setItem(GAMES_STATE_KEY, JSON.stringify(s)); } catch (_) {} }

  function fmt(n) { return Number(n || 0).toFixed(2); }
  function clamp(n, min, max) { return Math.min(max, Math.max(min, Number(n) || 0)); }
  function fmtMult(n) { return 'x' + Number(n || 0).toFixed(Number(n || 0) >= 100 ? 0 : 2); }
  function shortMult(n) { return Number(n || 0).toFixed(Number(n || 0) >= 100 ? 0 : 2) + 'x'; }

  function parseBet(input, statusEl) {
    var amount = parseFloat(input && input.value);
    if (!Number.isFinite(amount) || amount <= 0) {
      if (statusEl) statusEl.textContent = 'Enter a positive OST bet.';
      return null;
    }
    if (amount > getBalance() + 1e-9) {
      if (statusEl) statusEl.textContent = 'Not enough play balance — deposit OST or earn credits first.';
      return null;
    }
    return Math.round(amount * 1000000) / 1000000;
  }

  function setBusy(elements, busy) {
    (elements || []).forEach(function (el) { if (el) el.disabled = !!busy; });
  }

  function delay(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function pulse(el, cls) {
    if (!el) return;
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
  }

  function toast(message, kind) {
    var host = document.getElementById('ostGames');
    if (!host) return;
    var el = document.createElement('div');
    el.className = 'ostg-toast ' + (kind || 'info');
    el.textContent = message;
    host.appendChild(el);
    requestAnimationFrame(function () { el.classList.add('show'); });
    setTimeout(function () {
      el.classList.remove('show');
      setTimeout(function () { if (el.parentElement) el.remove(); }, 240);
    }, 2400);
  }

  function popBurst(parent, count) {
    if (!parent) return;
    var box = parent.getBoundingClientRect();
    for (var i = 0; i < (count || 18); i++) {
      var s = document.createElement('i');
      s.className = 'ostg-spark';
      s.style.left = (45 + Math.random() * 10) + '%';
      s.style.top = (45 + Math.random() * 10) + '%';
      s.style.setProperty('--dx', ((Math.random() - 0.5) * Math.min(220, box.width || 160)) + 'px');
      s.style.setProperty('--dy', ((Math.random() - 0.85) * 170) + 'px');
      s.style.setProperty('--h', String(35 + Math.random() * 95));
      parent.appendChild(s);
      setTimeout((function (node) { return function () { if (node.parentElement) node.remove(); }; })(s), 950);
    }
  }

  function recordRound(game, bet, payout, mult) {
    var s = loadGames();
    s.stats = s.stats || {};
    var g = s.stats[game] || { rounds: 0, wagered: 0, paid: 0, best: 0 };
    g.rounds += 1;
    g.wagered += Number(bet || 0);
    g.paid += Number(payout || 0);
    g.best = Math.max(Number(g.best || 0), Number(mult || 0));
    s.stats[game] = g;
    s.lastRound = { game: game, bet: Number(bet || 0), payout: Number(payout || 0), mult: Number(mult || 0), ts: Date.now() };
    saveGames(s);
  }

  function settleGame(game, bet, payout, mult, statusEl, winText, stageEl) {
    if (payout > 0) credit(payout, game);
    recordRound(game, bet, payout, mult);
    pushHistory(mult);
    if (statusEl) statusEl.textContent = winText;
    if (payout > bet) {
      toast('+' + fmt(payout - bet) + ' OST · ' + shortMult(mult), 'win');
      popBurst(stageEl || statusEl && statusEl.parentElement, 20);
    } else if (payout > 0) {
      toast('Returned ' + fmt(payout) + ' OST · ' + shortMult(mult), 'soft');
    } else {
      toast('-' + fmt(bet) + ' OST', 'loss');
    }
    var net = Number(payout || 0) - Number(bet || 0);
    recordGameLedgerEvent(net > 0 ? 'game-win' : net < 0 ? 'game-loss' : 'game-push', Math.abs(net) || Number(bet || 0), {
      game: game,
      bet: Number(bet || 0),
      payout: Number(payout || 0),
      net: net,
      mult: Number(mult || 0)
    });
  }

  function getBalance() {
    if (isOfflineVaultActive()) {
      var vault = offlineVaultApi();
      try { return Number(vault && vault.getBalance ? vault.getBalance() : 0); }
      catch (_) { return 0; }
    }
    return Number(loadBank().credits || 0);
  }
  function debit(amount) {
    if (isOfflineVaultActive()) {
      var vault = offlineVaultApi();
      var ok = !!(vault && vault.debit && vault.debit(amount, { source: 'ost-games', reason: 'bet' }));
      fireBalanceChange();
      return ok;
    }
    var s = loadBank();
    var bal = Number(s.credits || 0);
    if (amount > bal + 1e-9) return false;
    s.credits = Math.max(0, bal - amount);
    saveBank(s);
    fireBalanceChange();
    return true;
  }
  function credit(amount, source) {
    if (isOfflineVaultActive()) {
      var vault = offlineVaultApi();
      if (vault && vault.credit) vault.credit(amount, { source: source || 'game', reason: 'payout' });
      fireBalanceChange();
      return;
    }
    var s = loadBank();
    s.credits = Number(s.credits || 0) + Number(amount || 0);
    s.lifetime = Number(s.lifetime || 0) + Number(amount || 0);
    saveBank(s);
    fireBalanceChange();
    try { window.dispatchEvent(new CustomEvent('ost-faucet-hub-award', { detail: { credits: amount, source: source || 'game', total: s.credits }})); } catch (_) {}
  }
  function fireBalanceChange() {
    document.querySelectorAll('[data-ostg-balance]').forEach(function (el) {
      el.textContent = fmt(getBalance());
    });
    var hub = document.getElementById('fhCredits');
    if (hub) hub.textContent = fmt(getBalance());
    var vault = offlineVaultApi();
    if (vault && vault.updateUI) {
      try { vault.updateUI(); } catch (_) {}
    }
  }
  function recordGameLedgerEvent(kind, amount, extra) {
    if (isOfflineVaultActive()) {
      var vault = offlineVaultApi();
      if (vault && vault.recordGameResult) {
        try { vault.recordGameResult({ kind: kind, amount: Number(amount || 0), game: extra && extra.game, extra: extra || {} }); } catch (_) {}
      }
    }
    if (!window.recordOstPlatformEvent) return;
    try {
      window.recordOstPlatformEvent(Object.assign({
        kind: kind,
        amount: Number(amount || 0),
        ts: Date.now(),
        source: 'games'
      }, extra || {}));
    } catch (_) {}
  }

  // ────────────────────────────────────────────────────────────────────────
  // Provably-fair RNG  (HMAC-SHA256 chunked into 32-bit values, then mapped)
  // Server seed is generated client-side per session and revealed when the
  // player asks; client seed is editable so the user can prove independence.
  // ────────────────────────────────────────────────────────────────────────
  var pf = {
    serverSeed: null,
    serverSeedHash: null,
    clientSeed: null,
    nonce: 0
  };

  async function sha256Hex(text) {
    var enc = new TextEncoder().encode(text);
    var buf = await crypto.subtle.digest('SHA-256', enc);
    return [].map.call(new Uint8Array(buf), function (b) { return b.toString(16).padStart(2, '0'); }).join('');
  }
  async function hmacSha256Hex(key, message) {
    var k = await crypto.subtle.importKey('raw', new TextEncoder().encode(key),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    var sig = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(message));
    return [].map.call(new Uint8Array(sig), function (b) { return b.toString(16).padStart(2, '0'); }).join('');
  }
  function randomHex(bytes) {
    var b = new Uint8Array(bytes);
    crypto.getRandomValues(b);
    return [].map.call(b, function (x) { return x.toString(16).padStart(2, '0'); }).join('');
  }
  async function rotateServerSeed() {
    pf.serverSeed = randomHex(32);
    pf.serverSeedHash = await sha256Hex(pf.serverSeed);
    pf.nonce = 0;
    var s = loadGames();
    s.serverSeedHash = pf.serverSeedHash;
    saveGames(s);
  }
  async function ensureSeeds() {
    if (!pf.serverSeed) await rotateServerSeed();
    if (!pf.clientSeed) pf.clientSeed = (loadGames().clientSeed || ('ost-' + randomHex(8)));
    var s = loadGames();
    s.clientSeed = pf.clientSeed;
    saveGames(s);
  }
  // Returns an async generator of floats in [0,1) for the current bet.
  async function pfFloats(count) {
    await ensureSeeds();
    pf.nonce += 1;
    var msg = pf.clientSeed + ':' + pf.nonce + ':0';
    var hex = await hmacSha256Hex(pf.serverSeed, msg);
    var floats = [];
    var idx = 0;
    while (floats.length < count && idx + 8 <= hex.length) {
      var slice = hex.substr(idx, 8); idx += 8;
      floats.push(parseInt(slice, 16) / 4294967296);
    }
    // If we need more than 8 floats, hash again with extended message
    var round = 1;
    while (floats.length < count) {
      hex = await hmacSha256Hex(pf.serverSeed, msg + ':' + round); round++;
      idx = 0;
      while (floats.length < count && idx + 8 <= hex.length) {
        floats.push(parseInt(hex.substr(idx, 8), 16) / 4294967296);
        idx += 8;
      }
    }
    return floats;
  }

  // ────────────────────────────────────────────────────────────────────────
  // Mount panel — appended after the existing faucet hub grid
  // ────────────────────────────────────────────────────────────────────────
  var GAME_ORDER = ['mines', 'crash', 'dice', 'plinko', 'limbo', 'hilo', 'wheel', 'coinflip', 'keno', 'tower', 'double', 'slide', 'pump', 'dragontower', 'diamonds', 'cases', 'tome', 'scarab'];
  var GAME_META = {
    mines: { label: 'Mines', icon: '💣', iconName: 'bomb', accent: '#22c55e', accent2: '#38bdf8', tag: 'Reveal grid', stat: 'Cashout ladder', hero: '💎', symbols: ['◆', '●', '✦'] },
    crash: { label: 'Crash', icon: '🚀', iconName: 'rocket', accent: '#f97316', accent2: '#facc15', tag: 'Rocket curve', stat: 'Live cashout', hero: '🚀', symbols: ['↗', '⤴', '×'] },
    dice: { label: 'Dice', icon: '🎲', iconName: 'dice', accent: '#38bdf8', accent2: '#22c55e', tag: 'Target roll', stat: 'Risk slider', hero: '🎲', symbols: ['⚀', '⚂', '⚅'] },
    plinko: { label: 'Plinko', icon: '●', iconName: 'coin', accent: '#facc15', accent2: '#fb7185', tag: 'Peg drop', stat: 'Multi-ball', hero: '●', symbols: ['●', '×', '↘'] },
    limbo: { label: 'Limbo', icon: '✦', iconName: 'sparkles', accent: '#a78bfa', accent2: '#38bdf8', tag: 'Multiplier chase', stat: 'High target', hero: '✦', symbols: ['×', '↑', '✦'] },
    hilo: { label: 'Hi-Lo', icon: '♠', iconName: 'star', accent: '#fb7185', accent2: '#facc15', tag: 'Card streak', stat: 'Compound', hero: '♠', symbols: ['A', 'K', 'Q'] },
    wheel: { label: 'Big Six', icon: '○', iconName: 'pie-chart', accent: '#fb7185', accent2: '#facc15', tag: 'Prize wheel', stat: 'Risk bands', hero: '○', symbols: ['0x', '2x', '12x'] },
    coinflip: { label: 'Coinflip', icon: '●', iconName: 'coin', accent: '#facc15', accent2: '#f97316', tag: 'Heads/Tails', stat: '1.98x', hero: '●', symbols: ['H', 'T', '×'] },
    keno: { label: 'Keno', icon: '#', iconName: 'list', accent: '#22c55e', accent2: '#a78bfa', tag: 'Number draw', stat: '10 picks', hero: '#', symbols: ['7', '21', '40'] },
    tower: { label: 'Tower', icon: '△', iconName: 'tower', accent: '#38bdf8', accent2: '#22c55e', tag: 'Climb rows', stat: 'Trap picks', hero: '△', symbols: ['◇', '◆', '×'] },
    double: { label: 'Double', icon: '●', iconName: 'target', accent: '#ef4444', accent2: '#22c55e', tag: 'Color strip', stat: 'Green chase', hero: '●', symbols: ['Red', 'Black', 'Green'] },
    slide: { label: 'Slide', icon: '↗', iconName: 'trending-up', accent: '#38bdf8', accent2: '#22c55e', tag: 'Target run', stat: '100x cap', hero: '↗', symbols: ['2x', '10x', '50x'] },
    pump: { label: 'Pump', icon: '○', iconName: 'flame', accent: '#fb7185', accent2: '#facc15', tag: 'Pressure ladder', stat: 'Bust point', hero: '○', symbols: ['1', '4', '8'] },
    dragontower: { label: 'Dragon Tower', icon: '△', iconName: 'tower', accent: '#f97316', accent2: '#22c55e', tag: 'Path tower', stat: 'Floor clear', hero: '△', symbols: ['○', '◆', '×'] },
    diamonds: { label: 'Diamonds', icon: '◆', iconName: 'sparkles', accent: '#38bdf8', accent2: '#a78bfa', tag: 'Gem match', stat: '50x top', hero: '◆', symbols: ['◆', '◈', '○'] },
    cases: { label: 'Case Battle', icon: '▣', iconName: 'package', accent: '#facc15', accent2: '#fb7185', tag: 'Drop battle', stat: 'You vs dealer', hero: '▣', symbols: ['Common', 'Epic', 'Gold'] },
    tome: { label: 'Tome', icon: '✎', iconName: 'book', accent: '#a78bfa', accent2: '#facc15', tag: 'Rune pages', stat: 'Curse risk', hero: '✎', symbols: ['ᚱ', 'ᚠ', '☠'] },
    scarab: { label: 'Scarab Spin', icon: '✦', iconName: 'sparkles', accent: '#facc15', accent2: '#22c55e', tag: '3x3 symbols', stat: 'Cluster pay', hero: '✦', symbols: ['◆', '◆', '☀'] }
  };

  function gameIconHTML(meta, size) {
    if (window.OST_ICON && meta && meta.iconName) {
      return window.OST_ICON(meta.iconName, { size: size || 18 });
    }
    return (meta && meta.icon) || '';
  }

  var GAME_ENGINE = {
    mines: { curve: 'Manual cashout', action: 'Reveal tiles', risk: 'Mine density', edge: '99% return curve' },
    crash: { curve: 'Live multiplier', action: 'Cash before bust', risk: 'Auto target', edge: 'Crash math' },
    dice: { curve: 'Target slider', action: 'Roll under / over', risk: 'Win chance', edge: '99% return curve' },
    plinko: { curve: 'Peg physics', action: 'Drop multi-ball', risk: 'Rows + volatility', edge: 'Bucket table' },
    limbo: { curve: 'Multiplier hunt', action: 'Beat target', risk: 'Target size', edge: 'Crash math' },
    hilo: { curve: 'Card streak', action: 'Higher / lower', risk: 'Rank odds', edge: 'Compounding ladder' },
    wheel: { curve: 'Prize segments', action: 'Spin wheel', risk: 'Risk band', edge: 'Weighted slices' },
    coinflip: { curve: 'Binary pick', action: 'Flip coin', risk: 'Side pick', edge: '1.98x table' },
    keno: { curve: 'Hit table', action: 'Pick numbers', risk: 'Ticket size', edge: 'Match payouts' },
    tower: { curve: 'Row ladder', action: 'Climb rows', risk: 'Trap columns', edge: 'Cashout ladder' },
    double: { curve: 'Color strip', action: 'Roll strip', risk: 'Green chase', edge: '2x / 14x table' },
    slide: { curve: 'Multiplier lane', action: 'Launch target', risk: 'Cashout target', edge: '99% curve' },
    pump: { curve: 'Pressure ladder', action: 'Pick pump count', risk: 'Bust point', edge: 'Survival table' },
    dragontower: { curve: 'Path tower', action: 'Clear floors', risk: 'Mode traps', edge: 'Survival table' },
    diamonds: { curve: 'Gem groups', action: 'Reveal five', risk: 'Match density', edge: 'Group paytable' },
    cases: { curve: 'Drop battle', action: 'Open cases', risk: 'Case tier', edge: 'Dealer duel' },
    tome: { curve: 'Rune pages', action: 'Open pages', risk: 'Curse odds', edge: 'Survival table' },
    scarab: { curve: 'Symbol cluster', action: 'Spin grid', risk: 'Wild mode', edge: 'Cluster paytable' }
  };

  function metaFor(game) {
    return GAME_META[game] || GAME_META.mines;
  }

  function engineFor(game) {
    return GAME_ENGINE[game] || GAME_ENGINE.mines;
  }

  var TEMPLATE =
    '<div class="container">' +
      '<div class="ostg-section" id="ostGames">' +
        '<div class="ostg-casino-hero" id="ostgCasinoHero">' +
          '<div class="ostg-hero-copy">' +
            '<span class="ostg-kicker">FAUCET FAIR GAMES</span>' +
            '<h3><span id="ostgHeroIcon">' + (window.OST_ICON ? window.OST_ICON('bomb', { size: 22 }) : '') + '</span> <span id="ostgHeroTitle">OST Arcade</span></h3>' +
            '<div class="ostg-hero-stats">' +
              '<span id="ostgHeroTag">Reveal grid</span>' +
              '<span id="ostgHeroStat">Cashout ladder</span>' +
              '<span>HMAC fair</span>' +
            '</div>' +
          '</div>' +
          '<div class="ostg-hero-scene" aria-hidden="true">' +
            '<span class="ostg-hero-token hero-a" id="ostgHeroA">◆</span>' +
            '<span class="ostg-hero-token hero-b" id="ostgHeroB">●</span>' +
            '<span class="ostg-hero-token hero-c" id="ostgHeroC">✦</span>' +
            '<span class="ostg-hero-card card-a">7</span>' +
            '<span class="ostg-hero-card card-b">×</span>' +
          '</div>' +
          '<div class="ostg-balance-card">' +
            '<span class="ostg-balance-label">Chips · play balance</span>' +
            '<span class="ostg-balance-amt"><strong data-ostg-balance>0.00</strong> OST</span>' +
            '<div class="ostg-wallet-line" id="ostgWalletLine">' +
              '<span class="ostg-wallet-dot" data-state="off"></span>' +
              '<span id="ostgWalletText">Wallet: not connected</span>' +
            '</div>' +
            '<div class="ostg-balance-actions">' +
              '<button class="ostg-deposit-btn ost-icon-btn" id="ostgDepositBtn" type="button" title="Move OST from your real wallet into the play balance"><span data-icon="download"></span> Deposit</button>' +
              '<button class="ostg-cash-btn ost-icon-btn" id="ostgCashBtn" type="button" title="Send earned OST to your real wallet"><span data-icon="send"></span> Cash out</button>' +
              '<button class="ostg-fair-btn ost-icon-btn" id="ostgFairBtn" type="button"><span data-icon="shield"></span> Fairness</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="ostg-lobby-strip" id="ostgLobbyStrip"></div>' +
        '<div class="ostg-tabs" id="ostgTabs">' +
          GAME_ORDER.map(function (g) {
            var m = GAME_META[g] || {};
            return '<button class="ostg-tab' + (g === 'mines' ? ' is-active' : '') + ' ost-icon-btn" data-game="' + g + '">' + gameIconHTML(m, 16) + ' ' + m.label + '</button>';
          }).join('') +
        '</div>' +
        '<div class="ostg-stage" id="ostgStage"></div>' +
        '<div class="ostg-history" id="ostgHistory"><span class="ostg-history-label">Recent multipliers:</span></div>' +
      '</div>' +
    '</div>';

  function mount() {
    if (document.getElementById('ostGames')) return;
    var anchor = document.getElementById('ostFaucetHubSection') || document.getElementById('faucetSection');
    if (!anchor) { setTimeout(mount, 400); return; }
    injectStyles();
    var wrap = document.createElement('section');
    wrap.id = 'ostGamesSection';
    wrap.className = 'section';
    wrap.style.padding = '20px 0 40px';
    wrap.innerHTML = TEMPLATE;
    anchor.parentElement.insertBefore(wrap, anchor.nextSibling);
    fireBalanceChange();
    bindTabs();
    buildLobbyStrip();
    showGame('mines');
    window.addEventListener('ost:offline-vault-changed', fireBalanceChange);
    document.getElementById('ostgFairBtn').addEventListener('click', openFairness);
    var cashBtn = document.getElementById('ostgCashBtn');
    if (cashBtn) {
      cashBtn.addEventListener('click', async function () {
        if (isOfflineVaultActive()) {
          var vault = offlineVaultApi();
          if (vault && vault.sync) {
            try { await vault.sync(); } catch (e) { alert('Offline sync failed: ' + (e && e.message ? e.message : e)); }
          }
          return;
        }
        var bal = getBalance();
        if (bal < 1) return;
        var w = window.OST_WALLET;
        if (!w || !w.session || !w.session.publicKey) {
          var b = document.getElementById('connectWalletBtn'); if (b) b.click();
          return;
        }
        if (!window.OST_RESCUE || !window.OST_RESCUE.payoutOst) {
          // Fall back to hub button if rescue helpers haven't loaded yet.
          var hubBtn = document.getElementById('fhCashout'); if (hubBtn) hubBtn.click();
          return;
        }
        var prev = cashBtn.textContent; cashBtn.disabled = true; cashBtn.textContent = 'Sending…';
        try {
          var memo = JSON.stringify({ k: 'games-cashout', ost: bal, t: Date.now() });
          var r = await window.OST_RESCUE.payoutOst(w.session.publicKey, bal, memo);
          // Debit ONLY after on-chain confirm.
          var s = loadBank();
          var remaining = Math.max(0, Number(s.credits || 0) - Number(r.ost || 0));
          s.credits = Number(r.ost || 0) + 0.000001 >= bal ? 0 : remaining;
          saveBank(s); fireBalanceChange();
          recordGameLedgerEvent('games-cashout', r.ost, { sig: r.sig, net: Number(r.ost || 0) });
          cashBtn.textContent = '✓ Sent ' + r.ost.toFixed(2) + ' OST';
          try { window.dispatchEvent(new CustomEvent('ost:wallet-changed')); } catch (_) {}
        } catch (e) {
          console.warn('[ostg] cashout failed', e);
          alert('Cash-out failed: ' + (e && e.message ? e.message : e));
          cashBtn.textContent = prev;
        } finally {
          setTimeout(function () { cashBtn.textContent = prev; sync(); }, 3500);
        }
      });
      var sync = function () {
        var bal = getBalance();
        if (isOfflineVaultActive()) {
          cashBtn.disabled = false;
          cashBtn.textContent = '🔁 Sync';
          cashBtn.title = 'Sync offline vault proofs when online';
          return;
        }
        cashBtn.textContent = '💸 Cash out';
        cashBtn.disabled = bal < 1;
        cashBtn.title = bal < 1 ? 'Need at least 1 OST to cash out' : 'Cash out ' + fmt(bal) + ' OST to your wallet';
      };
      sync();
      window.addEventListener('storage', sync);
      window.addEventListener('ost:offline-vault-changed', sync);
      setInterval(sync, 1500);
    }
    bindWalletStatus();
    bindDeposit();
  }

  // ────────────────────────────────────────────────────────────────────────
  // Wallet detection + on-chain deposit (Stake/Rainbet model: deposit real
  // OST from your wallet into a play balance, then play instantly off-chain
  // with full provably-fair logs, and cash out whenever you want).
  // ────────────────────────────────────────────────────────────────────────
  function shortAddr(a) { a = String(a || ''); return a.length > 8 ? a.slice(0, 4) + '…' + a.slice(-4) : a; }

  function bindWalletStatus() {
    var dot = document.querySelector('#ostgWalletLine .ostg-wallet-dot');
    var text = document.getElementById('ostgWalletText');
    var depBtn = document.getElementById('ostgDepositBtn');
    if (!dot || !text) return;
    var lastBal = null, lastAddr = null;
    async function refresh() {
      if (isOfflineVaultActive()) {
        dot.dataset.state = 'on';
        text.innerHTML = 'Offline Vault active · <strong>' + fmt(getBalance()) + ' OST</strong>';
        if (depBtn) { depBtn.disabled = false; depBtn.title = 'Import a paper, NFC, or digital bearer token'; }
        return;
      }
      var w = window.OST_WALLET;
      var connected = !!(w && w.session && w.session.publicKey);
      if (!connected) {
        dot.dataset.state = 'off';
        text.innerHTML = '<a href="#connectWalletBtn" id="ostgConnectLink" style="color:#bfdbfe;text-decoration:underline;">Connect wallet</a> to deposit real OST';
        if (depBtn) { depBtn.disabled = true; depBtn.title = 'Connect a wallet first'; }
        var link = document.getElementById('ostgConnectLink');
        if (link) link.addEventListener('click', function (e) {
          e.preventDefault();
          var b = document.getElementById('connectWalletBtn');
          if (b) b.click();
        });
        return;
      }
      var addr = w.session.publicKey.toBase58 ? w.session.publicKey.toBase58() : String(w.session.publicKey);
      dot.dataset.state = 'on';
      try {
        var bal = await w.getOstBalance(w.session.publicKey);
        lastBal = bal; lastAddr = addr;
        text.innerHTML = 'Wallet <code>' + shortAddr(addr) + '</code> · <strong>' + fmt(bal) + ' OST</strong>';
        if (depBtn) {
          depBtn.disabled = !(bal > 0);
          depBtn.title = bal > 0 ? 'Deposit OST into play balance' : 'Wallet has 0 OST — claim from the faucet first';
        }
      } catch (_) {
        text.innerHTML = 'Wallet <code>' + shortAddr(addr) + '</code> · balance unavailable';
      }
    }
    refresh();
    setInterval(refresh, 6000);
    window.addEventListener('ost:wallet-changed', refresh);
    window.addEventListener('ost:offline-vault-changed', refresh);
  }

  function bindDeposit() {
    var depBtn = document.getElementById('ostgDepositBtn');
    if (!depBtn) return;
    depBtn.addEventListener('click', async function () {
      if (isOfflineVaultActive()) {
        location.hash = '#offline';
        var importBtn = document.getElementById('offlineVaultImportBtn');
        if (importBtn) importBtn.focus();
        return;
      }
      var w = window.OST_WALLET;
      if (!w || !w.session || !w.session.publicKey) {
        var b = document.getElementById('connectWalletBtn'); if (b) b.click();
        return;
      }
      if (!window.OST_RESCUE || !window.OST_RESCUE.userSendsOstToPool) {
        alert('Wallet helpers still loading — try again in a second.');
        return;
      }
      var raw = prompt('How much OST to deposit into the play balance?\n(Will be transferred from your wallet to the rewards vault. Cash out anytime.)', '5');
      if (raw === null) return;
      var amt = parseFloat(raw);
      if (!Number.isFinite(amt) || amt <= 0) { alert('Enter a positive amount'); return; }
      var bal = 0;
      try { bal = await w.getOstBalance(w.session.publicKey); } catch (_) {}
      if (amt > bal + 1e-9) { alert('Wallet only has ' + fmt(bal) + ' OST.'); return; }
      var prev = depBtn.textContent; depBtn.disabled = true; depBtn.textContent = 'Sending…';
      try {
        var memo = JSON.stringify({ k: 'games-deposit', ost: amt, t: Date.now() });
        var r = await window.OST_RESCUE.userSendsOstToPool(amt, memo);
        // Local credit ONLY after on-chain confirm so failures don't grant chips.
        credit(r.ost, 'wallet-deposit');
        recordGameLedgerEvent('games-deposit', r.ost, { sig: r.sig, net: -Number(r.ost || 0) });
        depBtn.textContent = '✓ +' + r.ost.toFixed(2) + ' OST';
        try { window.dispatchEvent(new CustomEvent('ost:wallet-changed')); } catch (_) {}
      } catch (e) {
        console.warn('[ostg] deposit failed', e);
        alert('Deposit failed: ' + (e && e.message ? e.message : e));
        depBtn.textContent = prev;
      } finally {
        setTimeout(function () { depBtn.disabled = false; depBtn.textContent = prev; }, 3500);
      }
    });
  }

  var activeGameCleanup = null;
  var activeGameLoadId = 0;
  var activeGameLoadTimer = 0;

  function bindTabs() {
    document.querySelectorAll('#ostgTabs .ostg-tab').forEach(function (b) {
      b.addEventListener('click', function () {
        showGame(b.dataset.game);
      });
    });
  }

  function buildLobbyStrip() {
    var host = document.getElementById('ostgLobbyStrip');
    if (!host) return;
    host.innerHTML = GAME_ORDER.map(function (game) {
      var meta = metaFor(game);
      return '<button class="ostg-lobby-game" type="button" data-lobby-game="' + game + '">' +
        '<span class="ostg-lobby-icon">' + gameIconHTML(meta, 22) + '</span>' +
        '<span><b>' + meta.label + '</b><em>' + meta.tag + '</em></span>' +
        '<strong>' + meta.stat + '</strong>' +
      '</button>';
    }).join('');
    host.querySelectorAll('[data-lobby-game]').forEach(function (button) {
      button.addEventListener('click', function () { showGame(button.dataset.lobbyGame); });
    });
  }

  function updateGameNav(game) {
    var meta = metaFor(game);
    document.querySelectorAll('#ostgTabs .ostg-tab').forEach(function (button) {
      button.classList.toggle('is-active', button.dataset.game === game);
    });
    document.querySelectorAll('#ostgLobbyStrip [data-lobby-game]').forEach(function (button) {
      button.classList.toggle('is-active', button.dataset.lobbyGame === game);
    });
    var hero = document.getElementById('ostgCasinoHero');
    if (hero) {
      hero.style.setProperty('--ostg-accent', meta.accent);
      hero.style.setProperty('--ostg-accent-2', meta.accent2);
    }
    var icon = document.getElementById('ostgHeroIcon');
    var title = document.getElementById('ostgHeroTitle');
    var tag = document.getElementById('ostgHeroTag');
    var stat = document.getElementById('ostgHeroStat');
    var a = document.getElementById('ostgHeroA');
    var b = document.getElementById('ostgHeroB');
    var c = document.getElementById('ostgHeroC');
    if (icon) icon.innerHTML = gameIconHTML(meta, 24);
    if (title) title.textContent = meta.label;
    if (tag) tag.textContent = meta.tag;
    if (stat) stat.textContent = meta.stat;
    if (a) a.textContent = meta.symbols[0];
    if (b) b.textContent = meta.symbols[1];
    if (c) c.textContent = meta.symbols[2];
  }

  function renderGameLoading(game) {
    var meta = metaFor(game);
    var engine = engineFor(game);
    return '<div class="ostg-game-loading" style="--ostg-accent:' + meta.accent + ';--ostg-accent-2:' + meta.accent2 + '">' +
      '<div class="ostg-loader-cabinet">' +
        '<div class="ostg-loader-reels"><span>' + meta.symbols[0] + '</span><span>' + meta.symbols[1] + '</span><span>' + meta.symbols[2] + '</span></div>' +
        '<div class="ostg-loader-scan"></div>' +
      '</div>' +
      '<div class="ostg-loader-copy"><span>' + meta.tag + '</span><strong>' + meta.label + '</strong><em>' + engine.action + ' · ' + engine.risk + '</em></div>' +
    '</div>';
  }

  function renderSelectedGame(game, stage) {
    if (game === 'mines') renderMines(stage);
    else if (game === 'crash') renderCrash(stage);
    else if (game === 'dice') renderDice(stage);
    else if (game === 'plinko') renderPlinko(stage);
    else if (game === 'limbo') renderLimbo(stage);
    else if (game === 'hilo') renderHiLo(stage);
    else if (game === 'wheel') renderWheel(stage);
    else if (game === 'coinflip') renderCoinflip(stage);
    else if (game === 'keno') renderKeno(stage);
    else if (game === 'tower') renderTower(stage);
    else if (game === 'double') renderDouble(stage);
    else if (game === 'slide') renderSlide(stage);
    else if (game === 'pump') renderPump(stage);
    else if (game === 'dragontower') renderDragonTower(stage);
    else if (game === 'diamonds') renderDiamonds(stage);
    else if (game === 'cases') renderCaseBattle(stage);
    else if (game === 'tome') renderTome(stage);
    else if (game === 'scarab') renderScarabSpin(stage);
    else renderMines(stage);
  }

  function decorateActiveGame(game, stage) {
    var meta = metaFor(game);
    var engine = engineFor(game);
    stage.dataset.game = game;
    stage.dataset.loading = 'false';
    stage.style.setProperty('--ostg-accent', meta.accent);
    stage.style.setProperty('--ostg-accent-2', meta.accent2);
    updateGameNav(game);
    var panel = stage.querySelector('.ostg-game');
    if (panel && !panel.querySelector('.ostg-game-hero')) {
      var hero = document.createElement('div');
      hero.className = 'ostg-game-hero';
      hero.innerHTML = '<div class="ostg-game-hero-art"><span>' + meta.hero + '</span><i></i><i></i><i></i></div>' +
        '<div class="ostg-game-hero-text"><span>' + meta.tag + '</span><h4>' + meta.label + '</h4><p>' + meta.stat + '</p></div>' +
        '<div class="ostg-game-hero-mults"><b>' + meta.symbols[0] + '</b><b>' + meta.symbols[1] + '</b><b>' + meta.symbols[2] + '</b></div>';
      panel.insertBefore(hero, panel.firstChild);
      var hud = document.createElement('div');
      hud.className = 'ostg-game-hud';
      hud.innerHTML = '<div><span>Engine</span><strong>' + engine.curve + '</strong></div>' +
        '<div><span>Action</span><strong>' + engine.action + '</strong></div>' +
        '<div><span>Risk</span><strong>' + engine.risk + '</strong></div>' +
        '<div><span>Table</span><strong>' + engine.edge + '</strong></div>';
      panel.insertBefore(hud, hero.nextSibling);
    }
    enhanceBetControls(stage);
    requestAnimationFrame(function () { stage.classList.add('is-loaded'); });
  }

  function enhanceBetControls(stage) {
    var input = stage.querySelector('.ostg-controls input[id$="Bet"]');
    if (!input) return;
    var controls = input.closest('.ostg-controls');
    if (!controls || controls.querySelector('.ostg-bet-tools')) return;
    var tools = document.createElement('div');
    tools.className = 'ostg-bet-tools';
    tools.innerHTML = '<span>Bet size</span>' +
      '<button type="button" data-bet-chip="0.5">0.5</button>' +
      '<button type="button" data-bet-chip="1">1</button>' +
      '<button type="button" data-bet-chip="5">5</button>' +
      '<button type="button" data-bet-action="half">1/2</button>' +
      '<button type="button" data-bet-action="double">2x</button>' +
      '<button type="button" data-bet-action="max">Max</button>';
    tools.addEventListener('click', function (event) {
      var button = event.target.closest('button');
      if (!button || input.disabled) return;
      var current = parseFloat(input.value) || 0;
      var next = current;
      if (button.dataset.betChip) next = Number(button.dataset.betChip);
      if (button.dataset.betAction === 'half') next = Math.max(0.1, current / 2);
      if (button.dataset.betAction === 'double') next = Math.max(0.1, current * 2);
      if (button.dataset.betAction === 'max') next = Math.max(0.1, getBalance());
      input.value = fmt(next).replace(/\.00$/, '');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    controls.appendChild(tools);
  }

  function showGame(game) {
    var stage = document.getElementById('ostgStage');
    if (!stage) return;
    if (GAME_ORDER.indexOf(game) < 0) game = 'mines';
    if (activeGameCleanup) {
      try { activeGameCleanup(); } catch (_) {}
      activeGameCleanup = null;
    }
    activeGameLoadId += 1;
    var loadId = activeGameLoadId;
    if (activeGameLoadTimer) clearTimeout(activeGameLoadTimer);
    var meta = metaFor(game);
    stage.classList.remove('is-loaded');
    stage.dataset.game = game;
    stage.dataset.loading = 'true';
    stage.style.setProperty('--ostg-accent', meta.accent);
    stage.style.setProperty('--ostg-accent-2', meta.accent2);
    updateGameNav(game);
    stage.innerHTML = renderGameLoading(game);
    activeGameLoadTimer = setTimeout(function () {
      if (loadId !== activeGameLoadId) return;
      activeGameLoadTimer = 0;
      stage.innerHTML = '';
      renderSelectedGame(game, stage);
      decorateActiveGame(game, stage);
    }, 260);
  }

  function pushHistory(mult) {
    var h = document.getElementById('ostgHistory');
    if (!h) return;
    var pill = document.createElement('span');
    pill.className = 'ostg-mult-pill ' + (mult >= 2 ? 'win' : (mult >= 1 ? 'soft' : 'loss'));
    pill.textContent = mult.toFixed(2) + 'x';
    h.appendChild(pill);
    while (h.children.length > 16) h.removeChild(h.children[1]); // keep label first
  }

  function placeBet(amount) {
    if (!Number.isFinite(amount) || amount <= 0) return { ok: false, msg: 'Enter a positive bet.' };
    if (amount > getBalance() + 1e-9) return { ok: false, msg: 'Not enough play balance — deposit OST or earn credits first.' };
    debit(amount);
    return { ok: true };
  }

  // ────────────────────────────────────────────────────────────────────────
  // MINES
  // ────────────────────────────────────────────────────────────────────────
  function minesMultiplier(safeCount, mines) {
    // Standard Stake-style: house edge ~1%
    // Probability of safe N picks = C(25-mines, n) / C(25, n)
    var num = 1, den = 1;
    for (var i = 0; i < safeCount; i++) {
      num *= (25 - mines - i);
      den *= (25 - i);
    }
    var prob = num / den;
    return 0.99 / prob;
  }

  function renderMines(stage) {
    stage.innerHTML =
      '<div class="ostg-game ostg-mines">' +
        '<div class="ostg-controls">' +
          '<label>Bet (OST)<input type="number" id="mnBet" min="0.1" step="0.1" value="1" inputmode="decimal"></label>' +
          '<label>Mines<select id="mnMines">' +
            [1,3,5,8,10,15,24].map(function(n){ return '<option value="'+n+'">'+n+'</option>'; }).join('') +
          '</select></label>' +
          '<label>Auto cash<select id="mnAuto"><option value="0">Off</option><option value="2">2 safe</option><option value="3">3 safe</option><option value="5">5 safe</option><option value="8">8 safe</option><option value="12">12 safe</option></select></label>' +
          '<button class="ostg-btn ostg-btn-primary" id="mnStart">Place bet</button>' +
          '<button class="ostg-btn" id="mnQuick" disabled>Quick pick</button>' +
          '<button class="ostg-btn ostg-btn-cash" id="mnCash" disabled>Cash out</button>' +
          '<div class="ostg-meta"><span>Current</span> <strong id="mnCurrent">1.00x</strong></div>' +
          '<div class="ostg-meta"><span>Next safe</span> <strong id="mnNext">—</strong></div>' +
        '</div>' +
        '<div class="ostg-board ostg-board-5x5" id="mnBoard"></div>' +
        '<div class="ostg-status" id="mnStatus">Choose mines, place a bet, then reveal gems. Cash out before you hit a mine.</div>' +
      '</div>';

    var bet = document.getElementById('mnBet');
    var mines = document.getElementById('mnMines');
    var auto = document.getElementById('mnAuto');
    mines.value = '5';
    var startBtn = document.getElementById('mnStart');
    var quickBtn = document.getElementById('mnQuick');
    var cashBtn  = document.getElementById('mnCash');
    var currentEl = document.getElementById('mnCurrent');
    var nextEl   = document.getElementById('mnNext');
    var statusEl = document.getElementById('mnStatus');
    var board    = document.getElementById('mnBoard');

    var session = null;

    function buildBoard() {
      board.innerHTML = '';
      for (var i = 0; i < 25; i++) {
        var c = document.createElement('button');
        c.className = 'ostg-tile';
        c.dataset.idx = String(i);
        c.type = 'button';
        c.setAttribute('aria-label', 'Mines tile ' + (i + 1) + ' of 25, hidden');
        c.addEventListener('click', onPick);
        c.disabled = !session;
        board.appendChild(c);
      }
    }

    function updateMeta() {
      if (!session) {
        currentEl.textContent = '1.00x';
        nextEl.textContent = '—';
        return;
      }
      var current = session.safeRevealed ? minesMultiplier(session.safeRevealed, session.mines) : 1;
      var nextPick = Math.min(session.safeRevealed + 1, 25 - session.mines);
      currentEl.textContent = shortMult(current);
      nextEl.textContent = shortMult(minesMultiplier(nextPick, session.mines));
      cashBtn.textContent = session.safeRevealed ? ('Cash out · ' + (session.bet * current).toFixed(2) + ' OST') : 'Cash out';
      cashBtn.disabled = session.safeRevealed < 1;
    }

    async function onStart() {
      var amt = parseBet(bet, statusEl);
      if (amt === null) return;
      var res = placeBet(amt);
      if (!res.ok) { statusEl.textContent = res.msg; return; }
      var mineCount = parseInt(mines.value, 10);
      var floats = await pfFloats(25);
      // Fisher-Yates shuffle indices via floats
      var idxs = []; for (var i = 0; i < 25; i++) idxs.push(i);
      for (var i = 24; i > 0; i--) {
        var j = Math.floor(floats[i] * (i + 1));
        var t = idxs[i]; idxs[i] = idxs[j]; idxs[j] = t;
      }
      var minePositions = new Set(idxs.slice(0, mineCount));
      session = { bet: amt, mines: mineCount, minePositions: minePositions, safeRevealed: 0, revealed: new Set() };
      buildBoard();
      updateMeta();
      statusEl.textContent = 'Pick a tile. Each safe tile boosts your multiplier.';
      startBtn.disabled = true;
      quickBtn.disabled = false;
      mines.disabled = true;
      auto.disabled = true;
      bet.disabled = true;
    }

    function onPick(e) {
      if (!session) return;
      var idx = parseInt(e.currentTarget.dataset.idx, 10);
      var tile = e.currentTarget;
      if (tile.disabled) return;
      tile.disabled = true;
      session.revealed.add(idx);
      if (session.minePositions.has(idx)) {
        tile.classList.add('mine');
        tile.innerHTML = '<span>💣</span>';
        tile.setAttribute('aria-label', 'Mines tile ' + (idx + 1) + ', mine');
        pulse(tile, 'ostg-tile-pop');
        revealAll();
        settleGame('mines', session.bet, 0, 0, statusEl, '💥 Hit a mine. Lost ' + fmt(session.bet) + ' OST.', board);
        endRound();
      } else {
        session.safeRevealed += 1;
        tile.classList.add('safe');
        tile.innerHTML = '<span>💎</span>';
        tile.setAttribute('aria-label', 'Mines tile ' + (idx + 1) + ', safe gem');
        pulse(tile, 'ostg-tile-pop');
        var mult = minesMultiplier(session.safeRevealed, session.mines);
        updateMeta();
        statusEl.textContent = '✅ Safe ' + session.safeRevealed + '/' + (25 - session.mines) + ' · ' + shortMult(mult);
        var autoAt = parseInt(auto.value, 10) || 0;
        if (autoAt && session.safeRevealed >= autoAt) return onCash();
        if (session.safeRevealed === 25 - session.mines) onCash(); // perfect clear
      }
    }

    function onQuickPick() {
      if (!session) return;
      var tiles = Array.prototype.slice.call(board.querySelectorAll('.ostg-tile:not(:disabled)'));
      if (!tiles.length) return;
      tiles[Math.floor(Math.random() * tiles.length)].click();
    }

    function revealAll() {
      board.querySelectorAll('.ostg-tile').forEach(function (t) {
        t.disabled = true;
        var i = parseInt(t.dataset.idx, 10);
        if (session.minePositions.has(i) && !t.classList.contains('mine')) {
          t.classList.add('mine-reveal');
          t.innerHTML = '<span>💣</span>';
          t.setAttribute('aria-label', 'Mines tile ' + (i + 1) + ', revealed mine');
        }
      });
    }

    function onCash() {
      if (!session) return;
      var mult = minesMultiplier(session.safeRevealed, session.mines);
      var payout = session.bet * mult;
      settleGame('mines', session.bet, payout, mult, statusEl, '💰 Cashed out at ' + shortMult(mult) + ' for ' + payout.toFixed(2) + ' OST', board);
      revealAll();
      endRound();
    }

    function endRound() {
      session = null;
      startBtn.disabled = false;
      quickBtn.disabled = true;
      cashBtn.disabled = true;
      cashBtn.textContent = 'Cash out';
      mines.disabled = false;
      auto.disabled = false;
      bet.disabled = false;
      updateMeta();
    }

    startBtn.addEventListener('click', onStart);
    quickBtn.addEventListener('click', onQuickPick);
    cashBtn.addEventListener('click', onCash);
    buildBoard();
    updateMeta();
  }

  // ────────────────────────────────────────────────────────────────────────
  // CRASH
  // ────────────────────────────────────────────────────────────────────────
  function crashPoint(rand) {
    // Same formula as the popular open-source crash games:
    // crash = max(1, floor(100 / (1 - r)) / 100)  with 1% house edge by 99/100 prefix
    var h = Math.floor(99 / (1 - rand));
    return Math.max(1, h / 100);
  }

  function renderCrash(stage) {
    stage.innerHTML =
      '<div class="ostg-game ostg-crash">' +
        '<div class="ostg-controls">' +
          '<label>Bet (OST)<input type="number" id="crBet" min="0.1" step="0.1" value="1" inputmode="decimal"></label>' +
          '<label>Auto cash-out ×<input type="number" id="crAuto" min="1.01" step="0.01" value="3.00" inputmode="decimal"></label>' +
          '<button class="ostg-btn ostg-btn-primary" id="crStart">Place bet</button>' +
          '<button class="ostg-btn ostg-btn-cash" id="crCash" disabled>Cash out</button>' +
          '<div class="ostg-meta"><span>Peak</span> <strong id="crPeak">1.00x</strong></div>' +
        '</div>' +
        '<div class="ostg-crash-stage">' +
          '<canvas id="crCanvas" width="640" height="280"></canvas>' +
          '<div class="ostg-crash-mult" id="crMult">1.00×</div>' +
        '</div>' +
        '<div class="ostg-status" id="crStatus">Set your bet and your auto cash-out target. Watch the rocket — cash out before it crashes.</div>' +
      '</div>';

    var canvas = document.getElementById('crCanvas');
    var ctx = canvas.getContext('2d');
    var betEl = document.getElementById('crBet');
    var autoEl = document.getElementById('crAuto');
    var startBtn = document.getElementById('crStart');
    var cashBtn = document.getElementById('crCash');
    var multEl = document.getElementById('crMult');
    var peakEl = document.getElementById('crPeak');
    var statusEl = document.getElementById('crStatus');

    var session = null;
    var raf = 0;
    activeGameCleanup = function () {
      cancelAnimationFrame(raf);
      session = null;
    };

    function draw(mult, t, crashed) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      var gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
      gradient.addColorStop(0, '#111827');
      gradient.addColorStop(1, '#020617');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      // grid
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      for (var x = 0; x < canvas.width; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke(); }
      for (var y = 0; y < canvas.height; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke(); }
      // curve
      var maxMult = Math.max(3, mult, session && session.cashMult || 1, session && session.peak || 1);
      function yFor(value) {
        var ratio = Math.log(Math.max(1, value)) / Math.log(maxMult);
        return h - 22 - Math.min(h - 42, ratio * (h - 46));
      }
      ctx.beginPath();
      var w = canvas.width, h = canvas.height;
      for (var i = 0; i <= 100; i++) {
        var f = i / 100;
        var m = Math.pow(mult, f);
        var px = f * Math.min(w - 22, 10 + t * 76);
        var py = yFor(m);
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.strokeStyle = crashed ? '#dc2626' : '#34d399';
      ctx.lineWidth = 3;
      ctx.stroke();
      if (session && session.cashed && session.cashMult) {
        var cashY = yFor(session.cashMult);
        ctx.setLineDash([6, 6]);
        ctx.beginPath(); ctx.moveTo(0, cashY); ctx.lineTo(w, cashY);
        ctx.strokeStyle = 'rgba(245,196,104,0.6)'; ctx.lineWidth = 2; ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#fde68a'; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'left';
        ctx.fillText('cashout ' + session.cashMult.toFixed(2) + 'x', 12, Math.max(18, cashY - 8));
      }
      // rocket head
      var fx = Math.min(w - 20, Math.max(18, 10 + t * 76));
      var fy = yFor(mult);
      ctx.fillStyle = crashed ? '#dc2626' : '#f5c468';
      ctx.font = '28px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(crashed ? '💥' : '🚀', fx, fy);
    }

    async function onStart() {
      var amt = parseBet(betEl, statusEl);
      if (amt === null) return;
      var res = placeBet(amt);
      if (!res.ok) { statusEl.textContent = res.msg; return; }
      var floats = await pfFloats(1);
      var crashAt = crashPoint(floats[0]);
      var auto = clamp(parseFloat(autoEl.value) || 0, 0, 1000000);
      if (auto > 0 && auto < 1.01) auto = 1.01;
      session = { bet: amt, crashAt: crashAt, auto: auto, t0: performance.now(), cashed: false, cashMult: 0, peak: 1 };
      if (peakEl) peakEl.textContent = '1.00x';
      startBtn.disabled = true; cashBtn.disabled = false; betEl.disabled = true; autoEl.disabled = true;
      statusEl.textContent = 'Flying… cash out before the multiplier explodes.';
      function tick() {
        if (!session) return;
        var elapsed = (performance.now() - session.t0) / 1000;
        var mult = Math.pow(Math.E, 0.32 * elapsed); // punchier, more arcade-like exponential
        session.peak = Math.max(session.peak || 1, mult);
        if (peakEl) peakEl.textContent = shortMult(session.peak);
        if (mult >= session.crashAt) {
          mult = session.crashAt;
          draw(mult, elapsed, true);
          multEl.textContent = mult.toFixed(2) + '× CRASH';
          multEl.style.color = '#fca5a5';
          if (!session.cashed) {
            settleGame('crash', session.bet, 0, 0, statusEl, '💥 Crashed at ' + shortMult(mult) + ' — lost ' + session.bet.toFixed(2) + ' OST.', canvas.parentElement);
          } else {
            statusEl.textContent = 'Round crashed at ' + shortMult(mult) + '. You banked at ' + shortMult(session.cashMult) + '.';
          }
          endRound();
          return;
        }
        if (session.auto && mult >= session.auto && !session.cashed) {
          onCash(true);
        }
        multEl.textContent = mult.toFixed(2) + '×';
        multEl.style.color = mult >= 10 ? '#fca5a5' : mult >= 3 ? '#fde68a' : mult >= 2 ? '#86efac' : '#f8fafc';
        draw(mult, elapsed, false);
        raf = requestAnimationFrame(tick);
      }
      tick();
    }

    function onCash(isAuto) {
      if (!session || session.cashed) return;
      session.cashed = true;
      var elapsed = (performance.now() - session.t0) / 1000;
      var mult = Math.min(session.crashAt, Math.pow(Math.E, 0.32 * elapsed));
      session.cashMult = mult;
      var payout = session.bet * mult;
      cashBtn.disabled = true;
      settleGame('crash', session.bet, payout, mult, statusEl, (isAuto ? '🤖 Auto ' : '💰 ') + 'cashed out at ' + shortMult(mult) + ' for ' + payout.toFixed(2) + ' OST. Round keeps flying…', canvas.parentElement);
    }

    function endRound() {
      cancelAnimationFrame(raf);
      session = null;
      startBtn.disabled = false;
      cashBtn.disabled = true;
      betEl.disabled = false;
      autoEl.disabled = false;
    }

    startBtn.addEventListener('click', onStart);
    cashBtn.addEventListener('click', function () { onCash(false); });
    draw(1, 0, false);
  }

  // ────────────────────────────────────────────────────────────────────────
  // DICE
  // ────────────────────────────────────────────────────────────────────────
  function renderDice(stage) {
    stage.innerHTML =
      '<div class="ostg-game ostg-dice">' +
        '<div class="ostg-controls">' +
          '<label>Bet (OST)<input type="number" id="dcBet" min="0.1" step="0.1" value="1" inputmode="decimal"></label>' +
          '<label>Direction<select id="dcDir"><option value="under">Roll under</option><option value="over">Roll over</option></select></label>' +
          '<label>Target<input type="number" id="dcTarget" min="2" max="98" step="1" value="50"></label>' +
          '<button class="ostg-btn ostg-btn-primary" id="dcRoll">Roll</button>' +
        '</div>' +
        '<div class="ostg-dice-bar"><div class="ostg-dice-fill" id="dcFill"></div><div class="ostg-dice-marker" id="dcMarker"></div></div>' +
        '<div class="ostg-dice-stats">' +
          '<div><span>Win chance</span><strong id="dcChance">50.00%</strong></div>' +
          '<div><span>Multiplier</span><strong id="dcMult">×1.98</strong></div>' +
          '<div><span>Payout</span><strong id="dcPayout">1.98 OST</strong></div>' +
        '</div>' +
        '<div class="ostg-dice-result" id="dcRoll-out">—</div>' +
        '<div class="ostg-status" id="dcStatus">Pick a target. Higher risk = higher payout.</div>' +
      '</div>';

    var bet    = document.getElementById('dcBet');
    var dir    = document.getElementById('dcDir');
    var target = document.getElementById('dcTarget');
    var fill   = document.getElementById('dcFill');
    var marker = document.getElementById('dcMarker');
    var chance = document.getElementById('dcChance');
    var multEl = document.getElementById('dcMult');
    var payEl  = document.getElementById('dcPayout');
    var rollBtn= document.getElementById('dcRoll');
    var rollEl = document.getElementById('dcRoll-out');
    var statusEl = document.getElementById('dcStatus');

    function recalc() {
      var t = Math.min(98, Math.max(2, parseFloat(target.value) || 50));
      var winPct = dir.value === 'under' ? t : (100 - t);
      var mult = winPct > 0 ? (99 / winPct) : 0;
      var amt  = parseFloat(bet.value) || 0;
      chance.textContent = winPct.toFixed(2) + '%';
      multEl.textContent = '×' + mult.toFixed(2);
      payEl.textContent  = (amt * mult).toFixed(2) + ' OST';
      fill.style.width = (dir.value === 'under' ? t : (100 - t)) + '%';
      fill.style.marginLeft = dir.value === 'under' ? '0' : (t + '%');
      marker.style.left = t + '%';
    }
    [bet, dir, target].forEach(function (e) { e.addEventListener('input', recalc); e.addEventListener('change', recalc); });
    recalc();

    rollBtn.addEventListener('click', async function () {
      var amt = parseBet(bet, statusEl);
      if (amt === null) return;
      var res = placeBet(amt); if (!res.ok) { statusEl.textContent = res.msg; return; }
      var t = Math.min(98, Math.max(2, parseFloat(target.value) || 50));
      var floats = await pfFloats(1);
      var roll = floats[0] * 100; // 0..100
      var win = dir.value === 'under' ? (roll < t) : (roll > t);
      var chance = dir.value === 'under' ? t : (100 - t);
      var winMult = 99 / chance;
      var t0 = performance.now();
      var start = parseFloat(marker.style.left) || 0;
      setBusy([rollBtn, bet, dir, target], true);
      statusEl.textContent = 'Rolling…';
      function tick() {
        var p = Math.min(1, (performance.now() - t0) / 850);
        var ease = 1 - Math.pow(1 - p, 3);
        var visible = start + (roll - start) * ease;
        marker.style.left = visible + '%';
        rollEl.textContent = visible.toFixed(2);
        rollEl.style.color = '#f8fafc';
        if (p < 1) requestAnimationFrame(tick);
        else {
          rollEl.textContent = roll.toFixed(2);
          rollEl.style.color = win ? '#86efac' : '#fca5a5';
          pulse(rollEl, win ? 'ostg-pop-win' : 'ostg-pop-loss');
          var payout = win ? amt * winMult : 0;
          settleGame('dice', amt, payout, win ? winMult : 0, statusEl,
            win ? '✅ Rolled ' + roll.toFixed(2) + ' — won ' + payout.toFixed(2) + ' OST (' + shortMult(winMult) + ')'
                : '❌ Rolled ' + roll.toFixed(2) + ' — lost ' + amt.toFixed(2) + ' OST',
            rollEl.parentElement);
          setBusy([rollBtn, bet, dir, target], false);
        }
      }
      tick();
    });
  }

  // ────────────────────────────────────────────────────────────────────────
  // PLINKO
  // ────────────────────────────────────────────────────────────────────────
  // Multiplier tables (same shape Stake/Rainbet use, indexed by row count)
  var PLINKO_MULTS = {
    8:  { low: [5.6,2.1,1.1,1,0.5,1,1.1,2.1,5.6],
          medium:[13,3,1.3,0.7,0.4,0.7,1.3,3,13],
          high:  [29,4,1.5,0.3,0.2,0.3,1.5,4,29] },
    12: { low: [10,3,1.6,1.4,1.1,1,0.5,1,1.1,1.4,1.6,3,10],
          medium:[33,11,4,2,1.1,0.6,0.3,0.6,1.1,2,4,11,33],
          high:  [170,24,8.1,2,0.7,0.2,0.2,0.2,0.7,2,8.1,24,170] },
    16: { low: [16,9,2,1.4,1.4,1.2,1.1,1,0.5,1,1.1,1.2,1.4,1.4,2,9,16],
          medium:[110,41,10,5,3,1.5,1,0.5,0.3,0.5,1,1.5,3,5,10,41,110],
          high:  [1000,130,26,9,4,2,0.2,0.2,0.2,0.2,0.2,2,4,9,26,130,1000] }
  };

  function renderPlinko(stage) {
    stage.innerHTML =
      '<div class="ostg-game ostg-plinko">' +
        '<div class="ostg-controls">' +
          '<label>Bet (OST)<input type="number" id="plBet" min="0.1" step="0.1" value="1" inputmode="decimal"></label>' +
          '<label>Risk<select id="plRisk"><option value="low">Low</option><option value="medium" selected>Medium</option><option value="high">High</option></select></label>' +
          '<label>Rows<select id="plRows"><option value="8">8</option><option value="12" selected>12</option><option value="16">16</option></select></label>' +
          '<label>Balls<select id="plBalls"><option value="1">1</option><option value="3" selected>3</option><option value="5">5</option><option value="10">10</option></select></label>' +
          '<button class="ostg-btn ostg-btn-primary" id="plDrop">Drop ball</button>' +
        '</div>' +
        '<div class="ostg-plinko-stage">' +
          '<canvas id="plCanvas" width="640" height="380"></canvas>' +
        '</div>' +
        '<div class="ostg-plinko-mults" id="plMults"></div>' +
        '<div class="ostg-status" id="plStatus">Drop a ball — bounces left or right at every peg.</div>' +
      '</div>';

    var bet = document.getElementById('plBet');
    var risk = document.getElementById('plRisk');
    var rows = document.getElementById('plRows');
    var balls = document.getElementById('plBalls');
    var dropBtn = document.getElementById('plDrop');
    var canvas = document.getElementById('plCanvas');
    var ctx = canvas.getContext('2d');
    var multsBar = document.getElementById('plMults');
    var statusEl = document.getElementById('plStatus');

    function paintMults() {
      var n = parseInt(rows.value, 10);
      var arr = PLINKO_MULTS[n][risk.value];
      multsBar.innerHTML = arr.map(function (m) {
        var cls = m >= 5 ? 'big' : m >= 1.2 ? 'mid' : 'small';
        return '<span class="ostg-mult-cell ' + cls + '">' + m + '×</span>';
      }).join('');
    }
    [risk, rows].forEach(function (e) { e.addEventListener('change', function () { paintMults(); paintBoard(); }); });
    paintMults();

    function paintBoard(highlightBucket) {
      var n = parseInt(rows.value, 10);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      var topY = 30;
      var botY = canvas.height - 40;
      var spacingY = (botY - topY) / n;
      for (var r = 0; r < n; r++) {
        var pegs = r + 2;
        var totalW = (pegs - 1) * 28;
        var startX = canvas.width / 2 - totalW / 2;
        for (var p = 0; p < pegs; p++) {
          ctx.beginPath();
          ctx.arc(startX + p * 28, topY + r * spacingY, 3, 0, Math.PI * 2);
          ctx.fillStyle = '#bfdbfe';
          ctx.fill();
        }
      }
      // buckets
      var buckets = n + 1;
      var bw = canvas.width / buckets;
      for (var i = 0; i < buckets; i++) {
        ctx.fillStyle = i === highlightBucket ? 'rgba(245,196,104,0.5)' : 'rgba(255,255,255,0.06)';
        ctx.fillRect(i * bw + 2, botY + 4, bw - 4, 28);
      }
    }
    paintBoard();

    dropBtn.addEventListener('click', async function () {
      var amt = parseBet(bet, statusEl);
      if (amt === null) return;
      var res = placeBet(amt); if (!res.ok) { statusEl.textContent = res.msg; return; }
      var n = parseInt(rows.value, 10);
      var ballCount = parseInt(balls.value, 10) || 1;
      var allFloats = await pfFloats(n * ballCount);
      var topY = 30, botY = canvas.height - 40, spacingY = (botY - topY) / n;
      var pegSpacing = 28;
      var buckets = n + 1;
      var bw = canvas.width / buckets;
      var perBall = amt / ballCount;
      var totalPayout = 0;
      var landed = [];
      setBusy([dropBtn, bet, risk, rows, balls], true);
      function drawBall(px, py) {
        ctx.beginPath();
        ctx.arc(px, py, 8, 0, Math.PI * 2);
        ctx.fillStyle = '#f5c468';
        ctx.shadowColor = 'rgba(245,196,104,0.9)';
        ctx.shadowBlur = 16;
        ctx.fill();
        ctx.shadowBlur = 0;
      }
      function playBall(ballIndex) {
        var floats = allFloats.slice(ballIndex * n, ballIndex * n + n);
        var bucket = 0;
        for (var i = 0; i < n; i++) if (floats[i] >= 0.5) bucket++;
        var path = [{ x: canvas.width / 2, y: topY }];
        var x = canvas.width / 2, y = topY;
        for (var stepIdx = 0; stepIdx < n; stepIdx++) {
          x += (floats[stepIdx] >= 0.5 ? pegSpacing / 2 : -pegSpacing / 2);
          y += spacingY;
          path.push({ x: x, y: y });
        }
        path.push({ x: bucket * bw + bw / 2, y: botY + 18 });
        var seg = 0;
        var segStart = performance.now();
        var segDur = Math.max(62, 720 / path.length);
        statusEl.textContent = 'Dropping ball ' + (ballIndex + 1) + '/' + ballCount + ' through ' + n + ' rows...';
        function animate() {
        var p = Math.min(1, (performance.now() - segStart) / segDur);
        var ease = 1 - Math.pow(1 - p, 2);
        var a = path[seg], b = path[seg + 1];
        var px = a.x + (b.x - a.x) * ease;
        var py = a.y + (b.y - a.y) * ease + Math.sin(p * Math.PI) * 8;
        paintBoard(landed[landed.length - 1]);
        landed.forEach(function(previousBucket) {
          drawBall(previousBucket * bw + bw / 2, botY + 18);
        });
        drawBall(px, py);
        if (p < 1) return requestAnimationFrame(animate);
        seg++;
        if (seg < path.length - 1) {
          segStart = performance.now();
          return requestAnimationFrame(animate);
        }
        paintBoard(bucket);
        landed.push(bucket);
        landed.forEach(function(previousBucket) {
          drawBall(previousBucket * bw + bw / 2, botY + 18);
        });
        drawBall(path[path.length - 1].x, path[path.length - 1].y);
        var mult = PLINKO_MULTS[n][risk.value][bucket];
        totalPayout += perBall * mult;
        if (ballIndex + 1 < ballCount) return setTimeout(function() { playBall(ballIndex + 1); }, 120);
        var totalMultiplier = totalPayout / amt;
        settleGame('plinko', amt, totalPayout, totalMultiplier, statusEl,
          'Dropped ' + ballCount + ' ball' + (ballCount === 1 ? '' : 's') + ' · paid ' + totalPayout.toFixed(2) + ' OST at ' + shortMult(totalMultiplier) + ' total.',
          canvas.parentElement);
        setBusy([dropBtn, bet, risk, rows, balls], false);
        }
        animate();
      }
      playBall(0);
    });
  }

  // ────────────────────────────────────────────────────────────────────────
  // LIMBO — pick a target multiplier; you win if the random multiplier ≥ target.
  // crash-style formula: m = 99 / (100 * r), clipped to ≥1. House edge 1%.
  // ────────────────────────────────────────────────────────────────────────
  function renderLimbo(stage) {
    stage.innerHTML =
      '<div class="ostg-game ostg-limbo">' +
        '<div class="ostg-controls">' +
          '<label>Bet (OST)<input type="number" id="lbBet" min="0.1" step="0.1" value="1" inputmode="decimal"></label>' +
          '<label>Target ×<input type="number" id="lbTarget" min="1.01" max="1000000" step="0.01" value="2.00" inputmode="decimal"></label>' +
          '<button class="ostg-btn ostg-btn-primary" id="lbRoll">Roll</button>' +
          '<div class="ostg-meta"><span>Win chance</span> <strong id="lbChance">49.50%</strong></div>' +
          '<div class="ostg-meta"><span>Payout</span> <strong id="lbPay">2.00 OST</strong></div>' +
        '</div>' +
        '<div class="ostg-limbo-stage"><div class="ostg-limbo-mult" id="lbMult">1.00×</div></div>' +
        '<div class="ostg-status" id="lbStatus">Pick a target multiplier — higher target, lower chance.</div>' +
      '</div>';
    var bet = document.getElementById('lbBet');
    var tgt = document.getElementById('lbTarget');
    var roll = document.getElementById('lbRoll');
    var multEl = document.getElementById('lbMult');
    var chance = document.getElementById('lbChance');
    var payEl = document.getElementById('lbPay');
    var statusEl = document.getElementById('lbStatus');
    function recalc() {
      var t = Math.max(1.01, parseFloat(tgt.value) || 2);
      var p = 99 / t; // % win
      var amt = parseFloat(bet.value) || 0;
      chance.textContent = p.toFixed(2) + '%';
      payEl.textContent = (amt * t).toFixed(2) + ' OST';
    }
    [bet, tgt].forEach(function (e) { e.addEventListener('input', recalc); });
    recalc();
    roll.addEventListener('click', async function () {
      var amt = parseBet(bet, statusEl);
      if (amt === null) return;
      var r = placeBet(amt); if (!r.ok) { statusEl.textContent = r.msg; return; }
      var t = clamp(parseFloat(tgt.value) || 2, 1.01, 1000000);
      tgt.value = t.toFixed(t >= 100 ? 0 : 2);
      var floats = await pfFloats(1);
      // Limbo result: m = 99 / (100*(1-r)), with very low r → very high m.
      var rolled = Math.max(1.0, 99 / (100 * (1 - floats[0])));
      // Animate count-up
      var t0 = performance.now();
      setBusy([roll, bet, tgt], true);
      statusEl.textContent = 'Rolling against ' + shortMult(t) + '…';
      multEl.classList.remove('is-win', 'is-loss');
      function tick() {
        var p = Math.min(1, (performance.now() - t0) / 900);
        var m = 1 + (rolled - 1) * (1 - Math.pow(1 - p, 3));
        multEl.textContent = m.toFixed(2) + '×';
        if (p < 1) requestAnimationFrame(tick);
        else {
          var win = rolled >= t;
          multEl.classList.add(win ? 'is-win' : 'is-loss');
          if (win) {
            var pay = amt * t;
            settleGame('limbo', amt, pay, t, statusEl, '✅ Rolled ' + shortMult(rolled) + ' ≥ ' + shortMult(t) + ' — won ' + pay.toFixed(2) + ' OST', multEl.parentElement);
          } else {
            settleGame('limbo', amt, 0, 0, statusEl, '❌ Rolled ' + shortMult(rolled) + ' < ' + shortMult(t) + ' — lost ' + amt.toFixed(2) + ' OST', multEl.parentElement);
          }
          setBusy([roll, bet, tgt], false);
        }
      }
      tick();
    });
  }

  // ────────────────────────────────────────────────────────────────────────
  // HI-LO — guess if next card is higher or lower. Multiplier compounds.
  // ────────────────────────────────────────────────────────────────────────
  function renderHiLo(stage) {
    var DECK_SIZE = 13; // 1..13 (Ace..King)
    function cardLabel(v) { return ['A','2','3','4','5','6','7','8','9','10','J','Q','K'][v - 1]; }
    stage.innerHTML =
      '<div class="ostg-game ostg-hilo">' +
        '<div class="ostg-controls">' +
          '<label>Bet (OST)<input type="number" id="hlBet" min="0.1" step="0.1" value="1" inputmode="decimal"></label>' +
          '<button class="ostg-btn ostg-btn-primary" id="hlStart">Deal</button>' +
          '<button class="ostg-btn ostg-btn-cash" id="hlCash" disabled>Cash out</button>' +
          '<div class="ostg-meta"><span>Multiplier</span> <strong id="hlMult">1.00×</strong></div>' +
        '</div>' +
        '<div class="ostg-hilo-stage">' +
          '<div class="ostg-card" id="hlCard">?</div>' +
          '<div class="ostg-hilo-actions">' +
            '<button class="ostg-btn" id="hlHi" disabled>↑ Higher</button>' +
            '<button class="ostg-btn" id="hlLo" disabled>↓ Lower</button>' +
          '</div>' +
        '</div>' +
        '<div class="ostg-status" id="hlStatus">Press Deal to start. Then guess if the next card is higher or lower.</div>' +
      '</div>';
    var bet = document.getElementById('hlBet');
    var start = document.getElementById('hlStart');
    var cash = document.getElementById('hlCash');
    var multEl = document.getElementById('hlMult');
    var card = document.getElementById('hlCard');
    var hi = document.getElementById('hlHi');
    var lo = document.getElementById('hlLo');
    var statusEl = document.getElementById('hlStatus');
    var session = null;

    async function newCard() {
      var f = await pfFloats(1);
      return Math.floor(f[0] * DECK_SIZE) + 1;
    }
    function probHi(c) { return (DECK_SIZE - c) / (DECK_SIZE - 1); }   // strictly higher
    function probLo(c) { return (c - 1) / (DECK_SIZE - 1); }           // strictly lower
    function multFor(p) { return p > 0 ? 0.99 / p : 0; }

    function updateChoiceButtons() {
      if (!session) return;
      var ph = probHi(session.current);
      var pl = probLo(session.current);
      hi.disabled = ph <= 0;
      lo.disabled = pl <= 0;
      hi.textContent = ph > 0 ? ('↑ Higher · ' + shortMult(multFor(ph)) + ' · ' + (ph * 100).toFixed(1) + '%') : '↑ Higher · locked';
      lo.textContent = pl > 0 ? ('↓ Lower · ' + shortMult(multFor(pl)) + ' · ' + (pl * 100).toFixed(1) + '%') : '↓ Lower · locked';
    }

    start.addEventListener('click', async function () {
      var amt = parseBet(bet, statusEl);
      if (amt === null) return;
      var r = placeBet(amt); if (!r.ok) { statusEl.textContent = r.msg; return; }
      var c = await newCard();
      session = { bet: amt, current: c, mult: 1 };
      card.textContent = cardLabel(c);
      pulse(card, 'ostg-card-flip');
      multEl.textContent = '1.00×';
      start.disabled = true; bet.disabled = true; cash.disabled = true;
      updateChoiceButtons();
      statusEl.textContent = 'Higher or lower than ' + cardLabel(c) + '?';
    });

    async function pick(dir) {
      if (!session) return;
      var p = dir === 'hi' ? probHi(session.current) : probLo(session.current);
      if (p <= 0) { statusEl.textContent = 'Impossible direction — choose the other side.'; return; }
      var step = multFor(p);
      setBusy([hi, lo], true);
      var next = await newCard();
      var prev = session.current;
      var tie = next === prev;
      var win = dir === 'hi' ? (next > prev) : (next < prev);
      card.textContent = cardLabel(next);
      pulse(card, 'ostg-card-flip');
      session.current = next;
      if (tie) {
        statusEl.textContent = '↔ Push on ' + cardLabel(next) + '. No multiplier change — pick again.';
        updateChoiceButtons();
        return;
      } else if (win) {
        session.mult *= step;
        multEl.textContent = session.mult.toFixed(2) + '×';
        pulse(multEl, 'ostg-pop-win');
        cash.disabled = false;
        cash.textContent = 'Cash out · ' + (session.bet * session.mult).toFixed(2) + ' OST';
        statusEl.textContent = '✅ Correct! Multiplier compounded — keep going or cash out.';
        updateChoiceButtons();
      } else {
        settleGame('hilo', session.bet, 0, 0, statusEl, '❌ Wrong — lost ' + session.bet.toFixed(2) + ' OST', card.parentElement);
        end();
      }
    }
    hi.addEventListener('click', function () { pick('hi'); });
    lo.addEventListener('click', function () { pick('lo'); });
    cash.addEventListener('click', function () {
      if (!session) return;
      var pay = session.bet * session.mult;
      settleGame('hilo', session.bet, pay, session.mult, statusEl, '💰 Cashed out at ' + shortMult(session.mult) + ' for ' + pay.toFixed(2) + ' OST', card.parentElement);
      end();
    });
    function end() {
      session = null;
      hi.disabled = true; lo.disabled = true; cash.disabled = true; start.disabled = false; bet.disabled = false;
      hi.textContent = '↑ Higher'; lo.textContent = '↓ Lower';
      cash.textContent = 'Cash out';
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // BIG SIX MONEY WHEEL — configurable multiplier wheel, distinct from roulette.
  // ────────────────────────────────────────────────────────────────────────
  var WHEEL_SEGMENTS = {
    low:    [0,1.2,1.2,1.5,1.2,0,1.2,2,1.2,0,1.5,1.2,1.2,0,1.2,1.5,0,1.2,2,1.2,0,1.2,1.5,1.2,0,1.2,1.2,1.5,0,1.2],
    medium: [0,1.5,0,2,0,1.5,0,3,0,1.5,0,2,0,5,0,1.5,0,2,0,3,0,1.5,0,2,0,1.5,0,3,0,1.5],
    high:   [0,0,0,0,4,0,0,0,0,9,0,0,0,0,4,0,0,0,0,12,0,0,0,0,4,0,0,0,0,9]
  };
  function renderWheel(stage) {
    stage.innerHTML =
      '<div class="ostg-game ostg-wheel">' +
        '<div class="ostg-controls">' +
          '<label>Bet (OST)<input type="number" id="whBet" min="0.1" step="0.1" value="1" inputmode="decimal"></label>' +
          '<label>Risk<select id="whRisk"><option value="low">Low</option><option value="medium" selected>Medium</option><option value="high">High</option></select></label>' +
          '<button class="ostg-btn ostg-btn-primary" id="whSpin">Spin</button>' +
        '</div>' +
        '<div class="ostg-wheel-stage">' +
          '<div class="ostg-wheel-pin"></div>' +
          '<canvas id="whCanvas" width="360" height="360"></canvas>' +
        '</div>' +
        '<div class="ostg-status" id="whStatus">Spin the Big Six money wheel — this is a multiplier prize wheel, while Roulette stays the number wheel.</div>' +
      '</div>';
    var canvas = document.getElementById('whCanvas');
    var ctx = canvas.getContext('2d');
    var bet = document.getElementById('whBet');
    var risk = document.getElementById('whRisk');
    var spin = document.getElementById('whSpin');
    var statusEl = document.getElementById('whStatus');
    var pin = stage.querySelector('.ostg-wheel-pin');
    var rotation = 0;
    function colorFor(m) { return m === 0 ? '#374151' : m < 1.5 ? '#2563eb' : m < 3 ? '#f59e0b' : '#ef4444'; }
    function paint(rot) {
      var segs = WHEEL_SEGMENTS[risk.value];
      var n = segs.length;
      var cx = canvas.width / 2, cy = canvas.height / 2, r = canvas.width / 2 - 8;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(rot);
      for (var i = 0; i < n; i++) {
        var a0 = (i / n) * Math.PI * 2;
        var a1 = ((i + 1) / n) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, r, a0, a1);
        ctx.closePath();
        ctx.fillStyle = colorFor(segs[i]);
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.stroke();
        // label
        ctx.save();
        ctx.rotate((a0 + a1) / 2);
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 10px sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(segs[i] + '×', r - 10, 4);
        ctx.restore();
      }
      ctx.restore();
      // hub
      ctx.beginPath(); ctx.arc(cx, cy, 26, 0, Math.PI * 2); ctx.fillStyle = '#0f131e'; ctx.fill();
      ctx.strokeStyle = '#f5c468'; ctx.lineWidth = 2; ctx.stroke();
    }
    risk.addEventListener('change', function () { paint(rotation); });
    paint(rotation);
    spin.addEventListener('click', async function () {
      var amt = parseBet(bet, statusEl);
      if (amt === null) return;
      var r = placeBet(amt); if (!r.ok) { statusEl.textContent = r.msg; return; }
      var f = await pfFloats(1);
      var segs = WHEEL_SEGMENTS[risk.value];
      var landIdx = Math.floor(f[0] * segs.length);
      // The pin sits at the top (angle = -PI/2). We want segment `landIdx`
      // centre to align there → final rot = -PI/2 - (centreAngleOfSeg).
      var centre = ((landIdx + 0.5) / segs.length) * Math.PI * 2;
      var endRot = -Math.PI / 2 - centre + Math.PI * 2 * 6; // 6 full spins
      var startRot = rotation, t0 = performance.now(), dur = 3900;
      spin.disabled = true; bet.disabled = true; risk.disabled = true;
      statusEl.textContent = 'Spinning ' + risk.value + ' risk wheel…';
      pulse(pin, 'ostg-pin-bounce');
      function tick() {
        var p = Math.min(1, (performance.now() - t0) / dur);
        var ease = 1 - Math.pow(1 - p, 3);
        rotation = startRot + (endRot - startRot) * ease;
        paint(rotation);
        if (p < 1) requestAnimationFrame(tick);
        else {
          rotation = endRot % (Math.PI * 2);
          var mult = segs[landIdx];
          var pay = amt * mult;
          settleGame('wheel', amt, pay, mult, statusEl,
            mult > 0 ? '🎯 Landed on ' + shortMult(mult) + ' — won ' + pay.toFixed(2) + ' OST'
                     : '😬 Landed on 0x — lost ' + amt.toFixed(2) + ' OST',
            canvas.parentElement);
          if (pin) pin.classList.remove('ostg-pin-bounce');
          pulse(pin, 'ostg-pin-hit');
          spin.disabled = false; bet.disabled = false; risk.disabled = false;
        }
      }
      tick();
    });
  }

  // ────────────────────────────────────────────────────────────────────────
  // COINFLIP — pick heads/tails, ×1.98 payout.
  // ────────────────────────────────────────────────────────────────────────
  function renderCoinflip(stage) {
    stage.innerHTML =
      '<div class="ostg-game ostg-coin">' +
        '<div class="ostg-controls">' +
          '<label>Bet (OST)<input type="number" id="cfBet" min="0.1" step="0.1" value="1" inputmode="decimal"></label>' +
          '<button class="ostg-btn" id="cfHeads">🔆 Heads ×1.98</button>' +
          '<button class="ostg-btn" id="cfTails">🌙 Tails ×1.98</button>' +
        '</div>' +
        '<div class="ostg-coin-stage"><div class="ostg-coin-disk" id="cfDisk">?</div></div>' +
        '<div class="ostg-status" id="cfStatus">Pick heads or tails — instant 1.98× payout on a win.</div>' +
      '</div>';
    var bet = document.getElementById('cfBet');
    var heads = document.getElementById('cfHeads');
    var tails = document.getElementById('cfTails');
    var disk = document.getElementById('cfDisk');
    var statusEl = document.getElementById('cfStatus');
    async function flip(side) {
      var amt = parseBet(bet, statusEl);
      if (amt === null) return;
      var r = placeBet(amt); if (!r.ok) { statusEl.textContent = r.msg; return; }
      setBusy([heads, tails, bet], true);
      statusEl.textContent = 'Flipping for ' + (side === 'h' ? 'heads' : 'tails') + '…';
      disk.classList.remove('flip-h', 'flip-t');
      disk.textContent = side === 'h' ? '🔆' : '🌙';
      // tiny delay so the animation plays even on rapid clicks
      void disk.offsetWidth;
      var f = await pfFloats(1);
      var result = f[0] < 0.5 ? 'h' : 't';
      disk.classList.add('flip-' + result);
      setTimeout(function () {
        disk.textContent = result === 'h' ? '🔆' : '🌙';
        if (result === side) {
          var pay = amt * 1.98;
          settleGame('coinflip', amt, pay, 1.98, statusEl, '✅ ' + (result === 'h' ? 'Heads' : 'Tails') + '! Won ' + pay.toFixed(2) + ' OST', disk.parentElement);
        } else {
          settleGame('coinflip', amt, 0, 0, statusEl, '❌ ' + (result === 'h' ? 'Heads' : 'Tails') + ' — lost ' + amt.toFixed(2) + ' OST', disk.parentElement);
        }
        setBusy([heads, tails, bet], false);
      }, 700);
    }
    heads.addEventListener('click', function () { flip('h'); });
    tails.addEventListener('click', function () { flip('t'); });
  }

  function shuffleWithFloats(items, floats) {
    var result = items.slice();
    for (var index = result.length - 1; index > 0; index--) {
      var floatIndex = result.length - 1 - index;
      var swapIndex = Math.floor((floats[floatIndex] || 0) * (index + 1));
      var temp = result[index];
      result[index] = result[swapIndex];
      result[swapIndex] = temp;
    }
    return result;
  }

  // ────────────────────────────────────────────────────────────────────────
  // KENO — pick numbers, draw ten, chase match-based multipliers.
  // ────────────────────────────────────────────────────────────────────────
  var KENO_TABLES = {
    1: { 1: 3.8 },
    2: { 1: 1.2, 2: 10 },
    3: { 2: 2.2, 3: 45 },
    4: { 2: 1.5, 3: 6, 4: 110 },
    5: { 3: 3, 4: 18, 5: 450 },
    6: { 3: 1.6, 4: 8, 5: 90, 6: 1200 },
    7: { 3: 1.2, 4: 4, 5: 30, 6: 400, 7: 3000 },
    8: { 4: 3, 5: 12, 6: 150, 7: 1500, 8: 8000 },
    9: { 4: 2, 5: 8, 6: 70, 7: 600, 8: 4000, 9: 12000 },
    10: { 4: 1.4, 5: 5, 6: 40, 7: 400, 8: 2500, 9: 10000, 10: 25000 }
  };

  function renderKeno(stage) {
    stage.innerHTML =
      '<div class="ostg-game ostg-keno">' +
        '<div class="ostg-controls">' +
          '<label>Bet (OST)<input type="number" id="knBet" min="0.1" step="0.1" value="1" inputmode="decimal"></label>' +
          '<label>Quick picks<select id="knCount"><option value="3">3 numbers</option><option value="5" selected>5 numbers</option><option value="8">8 numbers</option><option value="10">10 numbers</option></select></label>' +
          '<button class="ostg-btn" id="knQuick">Quick pick</button>' +
          '<button class="ostg-btn" id="knClear">Clear</button>' +
          '<button class="ostg-btn ostg-btn-primary" id="knDraw">Draw 10</button>' +
          '<div class="ostg-meta"><span>Selected</span> <strong id="knSelected">0 / 10</strong></div>' +
        '</div>' +
        '<div class="ostg-keno-grid" id="knGrid"></div>' +
        '<div class="ostg-keno-pays" id="knPays"></div>' +
        '<div class="ostg-status" id="knStatus">Pick up to 10 numbers or use quick pick. Matching more numbers unlocks the big end of the table.</div>' +
      '</div>';

    var bet = document.getElementById('knBet');
    var count = document.getElementById('knCount');
    var quick = document.getElementById('knQuick');
    var clear = document.getElementById('knClear');
    var draw = document.getElementById('knDraw');
    var grid = document.getElementById('knGrid');
    var pays = document.getElementById('knPays');
    var selectedEl = document.getElementById('knSelected');
    var statusEl = document.getElementById('knStatus');
    var selectedNumbers = new Set();

    function allNumbers() {
      var numbers = [];
      for (var number = 1; number <= 40; number++) numbers.push(number);
      return numbers;
    }

    function refreshGrid() {
      grid.querySelectorAll('.ostg-keno-cell').forEach(function (button) {
        var number = parseInt(button.dataset.number, 10);
        button.classList.toggle('is-selected', selectedNumbers.has(number));
        button.classList.remove('is-drawn', 'is-hit');
      });
      var selectedCount = selectedNumbers.size;
      selectedEl.textContent = selectedCount + ' / 10';
      var table = KENO_TABLES[selectedCount] || {};
      var keys = Object.keys(table).map(Number).sort(function (left, right) { return left - right; });
      pays.innerHTML = keys.length ? keys.map(function (hits) {
        return '<span>' + hits + ' hit' + (hits === 1 ? '' : 's') + ' · ' + shortMult(table[hits]) + '</span>';
      }).join('') : '<span>Select numbers to preview payouts</span>';
    }

    for (var number = 1; number <= 40; number++) {
      var button = document.createElement('button');
      button.className = 'ostg-keno-cell';
      button.type = 'button';
      button.dataset.number = String(number);
      button.textContent = String(number);
      button.addEventListener('click', function (event) {
        var pickedNumber = parseInt(event.currentTarget.dataset.number, 10);
        if (selectedNumbers.has(pickedNumber)) selectedNumbers.delete(pickedNumber);
        else if (selectedNumbers.size < 10) selectedNumbers.add(pickedNumber);
        else statusEl.textContent = 'Keno tickets max out at 10 numbers.';
        refreshGrid();
      });
      grid.appendChild(button);
    }

    quick.addEventListener('click', async function () {
      var pickTotal = clamp(parseInt(count.value, 10), 1, 10);
      var shuffled = shuffleWithFloats(allNumbers(), await pfFloats(40));
      selectedNumbers = new Set(shuffled.slice(0, pickTotal));
      statusEl.textContent = 'Quick-picked ' + pickTotal + ' numbers. Draw when ready.';
      refreshGrid();
    });

    clear.addEventListener('click', function () {
      selectedNumbers.clear();
      statusEl.textContent = 'Ticket cleared.';
      refreshGrid();
    });

    draw.addEventListener('click', async function () {
      var amount = parseBet(bet, statusEl);
      if (amount === null) return;
      if (!selectedNumbers.size) { statusEl.textContent = 'Pick at least one number first.'; return; }
      var result = placeBet(amount);
      if (!result.ok) { statusEl.textContent = result.msg; return; }
      setBusy([bet, count, quick, clear, draw], true);
      refreshGrid();
      var drawnNumbers = shuffleWithFloats(allNumbers(), await pfFloats(40)).slice(0, 10).sort(function (left, right) { return left - right; });
      var hitCount = drawnNumbers.filter(function (number) { return selectedNumbers.has(number); }).length;
      statusEl.textContent = 'Drawing 10 numbers...';
      drawnNumbers.forEach(function (number, index) {
        setTimeout(function () {
          var cell = grid.querySelector('[data-number="' + number + '"]');
          if (!cell) return;
          cell.classList.add(selectedNumbers.has(number) ? 'is-hit' : 'is-drawn');
          pulse(cell, 'ostg-pop-win');
        }, index * 90);
      });
      setTimeout(function () {
        var table = KENO_TABLES[selectedNumbers.size] || {};
        var multiplier = table[hitCount] || 0;
        var payout = amount * multiplier;
        settleGame('keno', amount, payout, multiplier, statusEl,
          multiplier > 0 ? 'Matched ' + hitCount + '/' + selectedNumbers.size + ' for ' + shortMult(multiplier) + ' · ' + payout.toFixed(2) + ' OST'
                         : 'Matched ' + hitCount + '/' + selectedNumbers.size + ' — no payout this draw.',
          grid);
        setBusy([bet, count, quick, clear, draw], false);
      }, drawnNumbers.length * 90 + 260);
    });

    refreshGrid();
  }

  // ────────────────────────────────────────────────────────────────────────
  // TOWER — climb row by row, cash out before choosing a trap.
  // ────────────────────────────────────────────────────────────────────────
  var TOWER_MODES = {
    easy: { columns: 3, safe: 2, label: 'Easy' },
    medium: { columns: 4, safe: 2, label: 'Medium' },
    hard: { columns: 4, safe: 1, label: 'Hard' }
  };

  function towerMultiplier(level, config) {
    if (!level) return 1;
    return Math.pow(0.99 / (config.safe / config.columns), level);
  }

  function renderTower(stage) {
    stage.innerHTML =
      '<div class="ostg-game ostg-tower">' +
        '<div class="ostg-controls">' +
          '<label>Bet (OST)<input type="number" id="twBet" min="0.1" step="0.1" value="1" inputmode="decimal"></label>' +
          '<label>Difficulty<select id="twMode"><option value="easy">Easy · 2 safe / 3</option><option value="medium" selected>Medium · 2 safe / 4</option><option value="hard">Hard · 1 safe / 4</option></select></label>' +
          '<label>Rows<select id="twRows"><option value="6">6</option><option value="8" selected>8</option><option value="10">10</option></select></label>' +
          '<button class="ostg-btn ostg-btn-primary" id="twStart">Start climb</button>' +
          '<button class="ostg-btn" id="twPick" disabled>Auto pick</button>' +
          '<button class="ostg-btn ostg-btn-cash" id="twCash" disabled>Cash out</button>' +
          '<div class="ostg-meta"><span>Current</span> <strong id="twMult">1.00x</strong></div>' +
        '</div>' +
        '<div class="ostg-tower-board" id="twBoard"></div>' +
        '<div class="ostg-status" id="twStatus">Start a climb. Each row you clear raises the cash-out multiplier.</div>' +
      '</div>';

    var bet = document.getElementById('twBet');
    var mode = document.getElementById('twMode');
    var rows = document.getElementById('twRows');
    var start = document.getElementById('twStart');
    var autoPick = document.getElementById('twPick');
    var cash = document.getElementById('twCash');
    var multEl = document.getElementById('twMult');
    var board = document.getElementById('twBoard');
    var statusEl = document.getElementById('twStatus');
    var session = null;

    function updateTowerControls() {
      if (!session) {
        multEl.textContent = '1.00x';
        cash.disabled = true;
        autoPick.disabled = true;
        return;
      }
      var multiplier = towerMultiplier(session.level, session.config);
      multEl.textContent = shortMult(multiplier);
      cash.disabled = session.level < 1;
      autoPick.disabled = false;
      cash.textContent = session.level ? ('Cash out · ' + (session.bet * multiplier).toFixed(2) + ' OST') : 'Cash out';
      board.querySelectorAll('.ostg-tower-row').forEach(function (row) {
        row.classList.toggle('is-current', parseInt(row.dataset.row, 10) === session.level);
      });
    }

    function buildTower() {
      board.innerHTML = '';
      var config = session ? session.config : TOWER_MODES[mode.value];
      var rowTotal = session ? session.rows : parseInt(rows.value, 10);
      board.style.setProperty('--tower-cols', String(config.columns));
      for (var rowIndex = rowTotal - 1; rowIndex >= 0; rowIndex--) {
        var row = document.createElement('div');
        row.className = 'ostg-tower-row';
        row.dataset.row = String(rowIndex);
        for (var columnIndex = 0; columnIndex < config.columns; columnIndex++) {
          var cell = document.createElement('button');
          cell.type = 'button';
          cell.className = 'ostg-tower-cell';
          cell.dataset.row = String(rowIndex);
          cell.dataset.column = String(columnIndex);
          cell.textContent = '◆';
          if (session) {
            cell.disabled = rowIndex !== session.level;
            if (session.picks[rowIndex] === columnIndex) {
              cell.classList.add('is-safe');
              cell.textContent = '◇';
              cell.disabled = true;
            }
            if (rowIndex < session.level && session.picks[rowIndex] !== columnIndex) cell.disabled = true;
          } else {
            cell.disabled = true;
          }
          cell.addEventListener('click', chooseTowerCell);
          row.appendChild(cell);
        }
        board.appendChild(row);
      }
      updateTowerControls();
    }

    function revealTower() {
      if (!session) return;
      board.querySelectorAll('.ostg-tower-cell').forEach(function (cell) {
        var row = parseInt(cell.dataset.row, 10);
        var column = parseInt(cell.dataset.column, 10);
        var isSafe = session.safeRows[row].has(column);
        cell.disabled = true;
        cell.classList.add(isSafe ? 'is-safe' : 'is-trap');
        cell.textContent = isSafe ? '◇' : '×';
      });
    }

    async function startTower() {
      var amount = parseBet(bet, statusEl);
      if (amount === null) return;
      var result = placeBet(amount);
      if (!result.ok) { statusEl.textContent = result.msg; return; }
      var config = TOWER_MODES[mode.value];
      var rowTotal = parseInt(rows.value, 10);
      var floats = await pfFloats(rowTotal * config.columns);
      var safeRows = [];
      for (var rowIndex = 0; rowIndex < rowTotal; rowIndex++) {
        var columns = [];
        for (var columnIndex = 0; columnIndex < config.columns; columnIndex++) columns.push(columnIndex);
        var rowFloats = floats.slice(rowIndex * config.columns, rowIndex * config.columns + config.columns);
        safeRows[rowIndex] = new Set(shuffleWithFloats(columns, rowFloats).slice(0, config.safe));
      }
      session = { bet: amount, config: config, rows: rowTotal, safeRows: safeRows, level: 0, picks: {} };
      setBusy([bet, mode, rows, start], true);
      statusEl.textContent = 'Pick a tile on the glowing row. Climb or cash out.';
      buildTower();
    }

    function chooseTowerCell(event) {
      if (!session) return;
      var row = parseInt(event.currentTarget.dataset.row, 10);
      var column = parseInt(event.currentTarget.dataset.column, 10);
      if (row !== session.level) { statusEl.textContent = 'Choose from the active row first.'; return; }
      event.currentTarget.disabled = true;
      if (session.safeRows[row].has(column)) {
        session.picks[row] = column;
        event.currentTarget.classList.add('is-safe');
        event.currentTarget.textContent = '◇';
        session.level += 1;
        var multiplier = towerMultiplier(session.level, session.config);
        statusEl.textContent = 'Safe row ' + session.level + '/' + session.rows + ' · ' + shortMult(multiplier);
        pulse(event.currentTarget, 'ostg-pop-win');
        if (session.level >= session.rows) return cashTower();
        updateTowerControls();
      } else {
        event.currentTarget.classList.add('is-trap');
        event.currentTarget.textContent = '×';
        revealTower();
        settleGame('tower', session.bet, 0, 0, statusEl, 'Tower broke on row ' + (row + 1) + ' — lost ' + fmt(session.bet) + ' OST.', board);
        endTower();
      }
    }

    function cashTower() {
      if (!session || session.level < 1) return;
      var multiplier = towerMultiplier(session.level, session.config);
      var payout = session.bet * multiplier;
      revealTower();
      settleGame('tower', session.bet, payout, multiplier, statusEl, 'Cashed the tower at ' + shortMult(multiplier) + ' for ' + payout.toFixed(2) + ' OST.', board);
      endTower();
    }

    function endTower() {
      session = null;
      setBusy([bet, mode, rows, start], false);
      autoPick.disabled = true;
      cash.disabled = true;
      cash.textContent = 'Cash out';
      updateTowerControls();
    }

    start.addEventListener('click', startTower);
    autoPick.addEventListener('click', function () {
      if (!session) return;
      var choices = Array.prototype.slice.call(board.querySelectorAll('.ostg-tower-cell[data-row="' + session.level + '"]:not(:disabled)'));
      if (choices.length) choices[Math.floor(Math.random() * choices.length)].click();
    });
    cash.addEventListener('click', cashTower);
    buildTower();
  }

  // ────────────────────────────────────────────────────────────────────────
  // ROULETTE — European wheel with inside and outside bets.
  // ────────────────────────────────────────────────────────────────────────
  var ROULETTE_NUMBERS = [0,32,15,19,4,21,2,25,17,34,6,27,13,36,11,30,8,23,10,5,24,16,33,1,20,14,31,9,22,18,29,7,28,12,35,3,26];
  var ROULETTE_REDS = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);

  function rouletteOutcome(number, betType, betValue) {
    if (betType === 'straight') return number === parseInt(betValue, 10) ? 35.64 : 0;
    if (number === 0) return 0;
    if (betType === 'color') {
      var color = ROULETTE_REDS.has(number) ? 'red' : 'black';
      return color === betValue ? 1.98 : 0;
    }
    if (betType === 'parity') return (number % 2 === 0 ? 'even' : 'odd') === betValue ? 1.98 : 0;
    if (betType === 'range') return (number <= 18 ? 'low' : 'high') === betValue ? 1.98 : 0;
    if (betType === 'dozen') {
      var dozen = number <= 12 ? 'first' : number <= 24 ? 'second' : 'third';
      return dozen === betValue ? 2.97 : 0;
    }
    return 0;
  }

  function renderRoulette(stage) {
    stage.innerHTML =
      '<div class="ostg-game ostg-roulette">' +
        '<div class="ostg-controls">' +
          '<label>Bet (OST)<input type="number" id="rtBet" min="0.1" step="0.1" value="1" inputmode="decimal"></label>' +
          '<label>Bet type<select id="rtType"><option value="color">Color</option><option value="parity">Even / Odd</option><option value="range">Low / High</option><option value="dozen">Dozen</option><option value="straight">Straight number</option></select></label>' +
          '<label id="rtValueWrap">Pick<select id="rtValue"></select></label>' +
          '<label id="rtNumberWrap" style="display:none">Number<input type="number" id="rtNumber" min="0" max="36" step="1" value="17"></label>' +
          '<button class="ostg-btn ostg-btn-primary" id="rtSpin">Spin</button>' +
          '<div class="ostg-meta"><span>Payout</span> <strong id="rtMult">1.98x</strong></div>' +
        '</div>' +
        '<div class="ostg-roulette-stage"><div class="ostg-roulette-pointer"></div><canvas id="rtCanvas" width="380" height="380"></canvas><div class="ostg-roulette-result" id="rtResult">--</div></div>' +
        '<div class="ostg-status" id="rtStatus">Choose a bet type, then spin the European wheel.</div>' +
      '</div>';

    var canvas = document.getElementById('rtCanvas');
    var ctx = canvas.getContext('2d');
    var bet = document.getElementById('rtBet');
    var type = document.getElementById('rtType');
    var value = document.getElementById('rtValue');
    var valueWrap = document.getElementById('rtValueWrap');
    var numberWrap = document.getElementById('rtNumberWrap');
    var numberInput = document.getElementById('rtNumber');
    var spin = document.getElementById('rtSpin');
    var multEl = document.getElementById('rtMult');
    var resultEl = document.getElementById('rtResult');
    var statusEl = document.getElementById('rtStatus');
    var rotation = 0;

    function setOptions() {
      var options = [];
      if (type.value === 'color') options = [['red', 'Red'], ['black', 'Black']];
      if (type.value === 'parity') options = [['even', 'Even'], ['odd', 'Odd']];
      if (type.value === 'range') options = [['low', '1-18'], ['high', '19-36']];
      if (type.value === 'dozen') options = [['first', '1st 12'], ['second', '2nd 12'], ['third', '3rd 12']];
      valueWrap.style.display = type.value === 'straight' ? 'none' : '';
      numberWrap.style.display = type.value === 'straight' ? '' : 'none';
      value.innerHTML = options.map(function (option) { return '<option value="' + option[0] + '">' + option[1] + '</option>'; }).join('');
      var previewMult = type.value === 'straight' ? 35.64 : type.value === 'dozen' ? 2.97 : 1.98;
      multEl.textContent = shortMult(previewMult);
    }

    function paintWheel(rot) {
      var centerX = canvas.width / 2;
      var centerY = canvas.height / 2;
      var radius = centerX - 8;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      ctx.translate(centerX, centerY);
      ctx.rotate(rot);
      for (var index = 0; index < ROULETTE_NUMBERS.length; index++) {
        var number = ROULETTE_NUMBERS[index];
        var startAngle = (index / ROULETTE_NUMBERS.length) * Math.PI * 2;
        var endAngle = ((index + 1) / ROULETTE_NUMBERS.length) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, radius, startAngle, endAngle);
        ctx.closePath();
        ctx.fillStyle = number === 0 ? '#16a34a' : ROULETTE_REDS.has(number) ? '#dc2626' : '#111827';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.16)';
        ctx.stroke();
        ctx.save();
        ctx.rotate((startAngle + endAngle) / 2);
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 10px sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(String(number), radius - 10, 4);
        ctx.restore();
      }
      ctx.restore();
      ctx.beginPath();
      ctx.arc(centerX, centerY, 36, 0, Math.PI * 2);
      ctx.fillStyle = '#0f131e';
      ctx.fill();
      ctx.strokeStyle = '#f5c468';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    type.addEventListener('change', setOptions);
    setOptions();
    paintWheel(rotation);

    spin.addEventListener('click', async function () {
      var amount = parseBet(bet, statusEl);
      if (amount === null) return;
      var result = placeBet(amount);
      if (!result.ok) { statusEl.textContent = result.msg; return; }
      var floats = await pfFloats(1);
      var landIndex = Math.floor(floats[0] * ROULETTE_NUMBERS.length);
      var number = ROULETTE_NUMBERS[landIndex];
      var centerAngle = ((landIndex + 0.5) / ROULETTE_NUMBERS.length) * Math.PI * 2;
      var endRotation = -Math.PI / 2 - centerAngle + Math.PI * 2 * 7;
      var startRotation = rotation;
      var startedAt = performance.now();
      var duration = 4200;
      setBusy([bet, type, value, numberInput, spin], true);
      statusEl.textContent = 'Wheel spinning...';
      resultEl.textContent = '--';
      function tick() {
        var progress = Math.min(1, (performance.now() - startedAt) / duration);
        var ease = 1 - Math.pow(1 - progress, 3);
        rotation = startRotation + (endRotation - startRotation) * ease;
        paintWheel(rotation);
        if (progress < 1) return requestAnimationFrame(tick);
        rotation = endRotation % (Math.PI * 2);
        resultEl.textContent = String(number);
        resultEl.dataset.color = number === 0 ? 'green' : ROULETTE_REDS.has(number) ? 'red' : 'black';
        var pick = type.value === 'straight' ? numberInput.value : value.value;
        var multiplier = rouletteOutcome(number, type.value, pick);
        var payout = amount * multiplier;
        settleGame('roulette', amount, payout, multiplier, statusEl,
          multiplier > 0 ? 'Number ' + number + ' hit your bet · ' + shortMult(multiplier) + ' for ' + payout.toFixed(2) + ' OST.'
                         : 'Number ' + number + ' missed your bet — lost ' + amount.toFixed(2) + ' OST.',
          canvas.parentElement);
        setBusy([bet, type, value, numberInput, spin], false);
      }
      tick();
    });
  }

  // ────────────────────────────────────────────────────────────────────────
  // SLOTS — five reels, selectable paylines and volatility.
  // ────────────────────────────────────────────────────────────────────────
  var SLOT_SYMBOLS = [
    { id: 'cherry', icon: '🍒', classic: 28, hot: 24, chaos: 18, pays: { 3: 1.6, 4: 4, 5: 12 } },
    { id: 'lemon', icon: '🍋', classic: 24, hot: 22, chaos: 18, pays: { 3: 1.8, 4: 5, 5: 16 } },
    { id: 'bell', icon: '🔔', classic: 18, hot: 18, chaos: 17, pays: { 3: 2.4, 4: 8, 5: 28 } },
    { id: 'gem', icon: '💎', classic: 12, hot: 14, chaos: 15, pays: { 3: 4, 4: 16, 5: 75 } },
    { id: 'seven', icon: '7', classic: 8, hot: 10, chaos: 13, pays: { 3: 8, 4: 40, 5: 250 } },
    { id: 'wild', icon: '★', classic: 10, hot: 12, chaos: 19, pays: { 3: 5, 4: 30, 5: 180 } }
  ];
  var SLOT_LINES = [
    [[1,0],[1,1],[1,2],[1,3],[1,4]],
    [[0,0],[0,1],[0,2],[0,3],[0,4]],
    [[2,0],[2,1],[2,2],[2,3],[2,4]],
    [[0,0],[1,1],[2,2],[1,3],[0,4]],
    [[2,0],[1,1],[0,2],[1,3],[2,4]]
  ];

  function pickSlotSymbol(randomValue, mode) {
    var totalWeight = SLOT_SYMBOLS.reduce(function (sum, symbol) { return sum + symbol[mode]; }, 0);
    var cursor = randomValue * totalWeight;
    for (var index = 0; index < SLOT_SYMBOLS.length; index++) {
      cursor -= SLOT_SYMBOLS[index][mode];
      if (cursor <= 0) return SLOT_SYMBOLS[index];
    }
    return SLOT_SYMBOLS[SLOT_SYMBOLS.length - 1];
  }

  function scoreSlotLine(grid, line) {
    var symbols = line.map(function (point) { return grid[point[0]][point[1]]; });
    var base = symbols.find(function (symbol) { return symbol.id !== 'wild'; }) || symbols[0];
    var count = 0;
    for (var index = 0; index < symbols.length; index++) {
      if (symbols[index].id === base.id || symbols[index].id === 'wild') count++;
      else break;
    }
    if (count < 3) return 0;
    return base.pays[count] || 0;
  }

  function renderSlots(stage) {
    stage.innerHTML =
      '<div class="ostg-game ostg-slots">' +
        '<div class="ostg-controls">' +
          '<label>Bet (OST)<input type="number" id="slBet" min="0.1" step="0.1" value="1" inputmode="decimal"></label>' +
          '<label>Lines<select id="slLines"><option value="1">1 line</option><option value="3">3 lines</option><option value="5" selected>5 lines</option></select></label>' +
          '<label>Volatility<select id="slMode"><option value="classic">Classic</option><option value="hot" selected>Hot</option><option value="chaos">Chaos</option></select></label>' +
          '<button class="ostg-btn ostg-btn-primary" id="slSpin">Spin reels</button>' +
          '<div class="ostg-meta"><span>Wild</span> <strong>★ substitutes</strong></div>' +
        '</div>' +
        '<div class="ostg-slot-grid" id="slGrid"></div>' +
        '<div class="ostg-slot-pays">3+ left-to-right symbols pay. More lines split the bet across more chances.</div>' +
        '<div class="ostg-status" id="slStatus">Choose paylines and volatility, then spin.</div>' +
      '</div>';

    var bet = document.getElementById('slBet');
    var lines = document.getElementById('slLines');
    var mode = document.getElementById('slMode');
    var spin = document.getElementById('slSpin');
    var gridEl = document.getElementById('slGrid');
    var statusEl = document.getElementById('slStatus');
    for (var cellIndex = 0; cellIndex < 15; cellIndex++) {
      var cell = document.createElement('div');
      cell.className = 'ostg-slot-cell';
      cell.textContent = '•';
      gridEl.appendChild(cell);
    }

    spin.addEventListener('click', async function () {
      var amount = parseBet(bet, statusEl);
      if (amount === null) return;
      var result = placeBet(amount);
      if (!result.ok) { statusEl.textContent = result.msg; return; }
      setBusy([bet, lines, mode, spin], true);
      statusEl.textContent = 'Reels spinning...';
      var cells = Array.prototype.slice.call(gridEl.children);
      cells.forEach(function (cell) { cell.className = 'ostg-slot-cell is-spinning'; cell.textContent = '•'; });
      var floats = await pfFloats(15);
      var slotGrid = [[], [], []];
      for (var row = 0; row < 3; row++) {
        for (var column = 0; column < 5; column++) slotGrid[row][column] = pickSlotSymbol(floats[row * 5 + column], mode.value);
      }
      setTimeout(function () {
        cells.forEach(function (cell, index) {
          var row = Math.floor(index / 5);
          var column = index % 5;
          cell.textContent = slotGrid[row][column].icon;
          cell.className = 'ostg-slot-cell';
        });
        var lineCount = parseInt(lines.value, 10);
        var activeLines = SLOT_LINES.slice(0, lineCount);
        var lineBet = amount / lineCount;
        var totalPayout = 0;
        activeLines.forEach(function (line) {
          var multiplier = scoreSlotLine(slotGrid, line);
          if (multiplier > 0) {
            totalPayout += lineBet * multiplier;
            line.forEach(function (point) { cells[point[0] * 5 + point[1]].classList.add('is-hit'); });
          }
        });
        var totalMultiplier = totalPayout / amount;
        settleGame('slots', amount, totalPayout, totalMultiplier, statusEl,
          totalPayout > 0 ? 'Reels paid ' + totalPayout.toFixed(2) + ' OST · ' + shortMult(totalMultiplier) + ' total.'
                          : 'No line connected this spin — lost ' + amount.toFixed(2) + ' OST.',
          gridEl);
        setBusy([bet, lines, mode, spin], false);
      }, 760);
    });
  }

  var CARD_SUITS = ['♠', '♥', '♦', '♣'];
  var CARD_RANKS = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];

  function createCardDeck(floats) {
    var deck = [];
    CARD_SUITS.forEach(function (suit) {
      CARD_RANKS.forEach(function (rank, rankIndex) {
        deck.push({ rank: rank, suit: suit, order: rankIndex + 1 });
      });
    });
    return shuffleWithFloats(deck, floats);
  }

  function renderCard(card) {
    var red = card.suit === '♥' || card.suit === '♦';
    return '<span class="ostg-play-card ' + (red ? 'is-red' : '') + '"><b>' + card.rank + '</b><em>' + card.suit + '</em></span>';
  }

  function blackjackValue(cards) {
    var total = 0;
    var aces = 0;
    cards.forEach(function (card) {
      if (card.rank === 'A') { aces++; total += 11; }
      else total += Math.min(card.order, 10);
    });
    while (total > 21 && aces > 0) { total -= 10; aces--; }
    return total;
  }

  // ────────────────────────────────────────────────────────────────────────
  // BLACKJACK — simplified hit/stand table, dealer draws to 17.
  // ────────────────────────────────────────────────────────────────────────
  function renderBlackjack(stage) {
    stage.innerHTML =
      '<div class="ostg-game ostg-blackjack">' +
        '<div class="ostg-controls">' +
          '<label>Bet (OST)<input type="number" id="bjBet" min="0.1" step="0.1" value="1" inputmode="decimal"></label>' +
          '<button class="ostg-btn ostg-btn-primary" id="bjDeal">Deal</button>' +
          '<button class="ostg-btn" id="bjHit" disabled>Hit</button>' +
          '<button class="ostg-btn" id="bjStand" disabled>Stand</button>' +
          '<div class="ostg-meta"><span>Goal</span> <strong>Beat 21</strong></div>' +
        '</div>' +
        '<div class="ostg-table-stage">' +
          '<div class="ostg-hand"><span>Dealer <strong id="bjDealerTotal">0</strong></span><div id="bjDealerCards" class="ostg-card-row"></div></div>' +
          '<div class="ostg-hand"><span>You <strong id="bjPlayerTotal">0</strong></span><div id="bjPlayerCards" class="ostg-card-row"></div></div>' +
        '</div>' +
        '<div class="ostg-status" id="bjStatus">Easy blackjack: deal, hit until you like your total, then stand. Natural blackjack pays 2.5x.</div>' +
      '</div>';

    var bet = document.getElementById('bjBet');
    var deal = document.getElementById('bjDeal');
    var hit = document.getElementById('bjHit');
    var stand = document.getElementById('bjStand');
    var dealerCards = document.getElementById('bjDealerCards');
    var playerCards = document.getElementById('bjPlayerCards');
    var dealerTotal = document.getElementById('bjDealerTotal');
    var playerTotal = document.getElementById('bjPlayerTotal');
    var statusEl = document.getElementById('bjStatus');
    var session = null;

    function drawCard() { return session.deck.pop(); }

    function renderHands() {
      dealerCards.innerHTML = session ? session.dealer.map(renderCard).join('') : '';
      playerCards.innerHTML = session ? session.player.map(renderCard).join('') : '';
      dealerTotal.textContent = session ? String(blackjackValue(session.dealer)) : '0';
      playerTotal.textContent = session ? String(blackjackValue(session.player)) : '0';
    }

    function setPlaying(active) {
      bet.disabled = active;
      deal.disabled = active;
      hit.disabled = !active;
      stand.disabled = !active;
    }

    function finish(payout, multiplier, text) {
      settleGame('blackjack', session.bet, payout, multiplier, statusEl, text, stage.querySelector('.ostg-table-stage'));
      session = null;
      setPlaying(false);
    }

    function dealerTurn() {
      while (blackjackValue(session.dealer) < 17) session.dealer.push(drawCard());
      renderHands();
      var playerScore = blackjackValue(session.player);
      var dealerScore = blackjackValue(session.dealer);
      if (dealerScore > 21 || playerScore > dealerScore) return finish(session.bet * 1.98, 1.98, 'You beat the dealer for ' + (session.bet * 1.98).toFixed(2) + ' OST.');
      if (playerScore === dealerScore) return finish(session.bet, 1, 'Push. Your ' + session.bet.toFixed(2) + ' OST returned.');
      finish(0, 0, 'Dealer wins with ' + dealerScore + '. Lost ' + session.bet.toFixed(2) + ' OST.');
    }

    deal.addEventListener('click', async function () {
      var amount = parseBet(bet, statusEl);
      if (amount === null) return;
      var result = placeBet(amount);
      if (!result.ok) { statusEl.textContent = result.msg; return; }
      var deck = createCardDeck(await pfFloats(52));
      session = { bet: amount, deck: deck, player: [], dealer: [] };
      session.player.push(drawCard(), drawCard());
      session.dealer.push(drawCard(), drawCard());
      renderHands();
      setPlaying(true);
      var playerScore = blackjackValue(session.player);
      var dealerScore = blackjackValue(session.dealer);
      if (playerScore === 21 || dealerScore === 21) {
        if (playerScore === dealerScore) return finish(amount, 1, 'Double blackjack push. Bet returned.');
        if (playerScore === 21) return finish(amount * 2.5, 2.5, 'Natural blackjack! Paid ' + (amount * 2.5).toFixed(2) + ' OST.');
        return finish(0, 0, 'Dealer blackjack. Lost ' + amount.toFixed(2) + ' OST.');
      }
      statusEl.textContent = 'Hit for another card or stand to let the dealer draw.';
    });

    hit.addEventListener('click', function () {
      if (!session) return;
      session.player.push(drawCard());
      renderHands();
      if (blackjackValue(session.player) > 21) return finish(0, 0, 'Busted over 21. Lost ' + session.bet.toFixed(2) + ' OST.');
      statusEl.textContent = 'Card drawn. Hit again or stand.';
    });

    stand.addEventListener('click', function () { if (session) dealerTurn(); });
  }

  function baccaratValue(cards) {
    return cards.reduce(function (sum, card) { return sum + (card.order >= 10 ? 0 : card.order); }, 0) % 10;
  }

  // ────────────────────────────────────────────────────────────────────────
  // BACCARAT — player, banker, or tie with real third-card rules.
  // ────────────────────────────────────────────────────────────────────────
  function renderBaccarat(stage) {
    stage.innerHTML =
      '<div class="ostg-game ostg-baccarat">' +
        '<div class="ostg-controls">' +
          '<label>Bet (OST)<input type="number" id="baBet" min="0.1" step="0.1" value="1" inputmode="decimal"></label>' +
          '<label>Side<select id="baSide"><option value="player">Player · 1.98x</option><option value="banker">Banker · 1.95x</option><option value="tie">Tie · 8.80x</option></select></label>' +
          '<button class="ostg-btn ostg-btn-primary" id="baDeal">Deal</button>' +
        '</div>' +
        '<div class="ostg-table-stage">' +
          '<div class="ostg-hand"><span>Player <strong id="baPlayerTotal">0</strong></span><div id="baPlayerCards" class="ostg-card-row"></div></div>' +
          '<div class="ostg-hand"><span>Banker <strong id="baBankerTotal">0</strong></span><div id="baBankerCards" class="ostg-card-row"></div></div>' +
        '</div>' +
        '<div class="ostg-status" id="baStatus">Pick player, banker, or tie. Naturals and third-card draws are handled automatically.</div>' +
      '</div>';

    var bet = document.getElementById('baBet');
    var side = document.getElementById('baSide');
    var deal = document.getElementById('baDeal');
    var playerCards = document.getElementById('baPlayerCards');
    var bankerCards = document.getElementById('baBankerCards');
    var playerTotal = document.getElementById('baPlayerTotal');
    var bankerTotal = document.getElementById('baBankerTotal');
    var statusEl = document.getElementById('baStatus');

    deal.addEventListener('click', async function () {
      var amount = parseBet(bet, statusEl);
      if (amount === null) return;
      var result = placeBet(amount);
      if (!result.ok) { statusEl.textContent = result.msg; return; }
      setBusy([bet, side, deal], true);
      var deck = createCardDeck(await pfFloats(52));
      function drawCardFromDeck() { return deck.pop(); }
      var player = [drawCardFromDeck(), drawCardFromDeck()];
      var banker = [drawCardFromDeck(), drawCardFromDeck()];
      var playerThird = null;
      var playerScore = baccaratValue(player);
      var bankerScore = baccaratValue(banker);
      if (playerScore < 8 && bankerScore < 8) {
        if (playerScore <= 5) {
          playerThird = drawCardFromDeck();
          player.push(playerThird);
        }
        playerScore = baccaratValue(player);
        var bankerDraws = false;
        if (!playerThird) bankerDraws = bankerScore <= 5;
        else {
          var thirdValue = baccaratValue([playerThird]);
          bankerDraws = bankerScore <= 2 ||
            (bankerScore === 3 && thirdValue !== 8) ||
            (bankerScore === 4 && thirdValue >= 2 && thirdValue <= 7) ||
            (bankerScore === 5 && thirdValue >= 4 && thirdValue <= 7) ||
            (bankerScore === 6 && thirdValue >= 6 && thirdValue <= 7);
        }
        if (bankerDraws) banker.push(drawCardFromDeck());
      }
      playerScore = baccaratValue(player);
      bankerScore = baccaratValue(banker);
      playerCards.innerHTML = player.map(renderCard).join('');
      bankerCards.innerHTML = banker.map(renderCard).join('');
      playerTotal.textContent = String(playerScore);
      bankerTotal.textContent = String(bankerScore);
      var winner = playerScore > bankerScore ? 'player' : bankerScore > playerScore ? 'banker' : 'tie';
      var multiplier = winner === 'player' ? 1.98 : winner === 'banker' ? 1.95 : 8.8;
      var payout = side.value === winner ? amount * multiplier : (winner === 'tie' && side.value !== 'tie' ? amount : 0);
      var recordedMultiplier = payout === amount ? 1 : side.value === winner ? multiplier : 0;
      settleGame('baccarat', amount, payout, recordedMultiplier, statusEl,
        side.value === winner ? winner.toUpperCase() + ' wins ' + playerScore + '-' + bankerScore + ' · paid ' + payout.toFixed(2) + ' OST.'
                            : payout === amount ? 'Tie push. Your bet returned.'
                            : winner.toUpperCase() + ' wins ' + playerScore + '-' + bankerScore + ' — lost ' + amount.toFixed(2) + ' OST.',
        stage.querySelector('.ostg-table-stage'));
      setBusy([bet, side, deal], false);
    });
  }

  // ────────────────────────────────────────────────────────────────────────
  // SCRATCH — reveal nine tiles, match three multipliers to win.
  // ────────────────────────────────────────────────────────────────────────
  var SCRATCH_MODES = {
    steady: [{ m: 0, w: 7 }, { m: 1, w: 12 }, { m: 1.2, w: 10 }, { m: 1.5, w: 7 }, { m: 3, w: 2 }],
    burst: [{ m: 0, w: 12 }, { m: 1, w: 8 }, { m: 2, w: 7 }, { m: 5, w: 3 }, { m: 25, w: 1 }],
    jackpot: [{ m: 0, w: 18 }, { m: 2, w: 8 }, { m: 10, w: 3 }, { m: 75, w: 1 }, { m: 500, w: 0.4 }]
  };

  function pickScratchPrize(randomValue, mode) {
    var prizes = SCRATCH_MODES[mode];
    var total = prizes.reduce(function (sum, prize) { return sum + prize.w; }, 0);
    var cursor = randomValue * total;
    for (var index = 0; index < prizes.length; index++) {
      cursor -= prizes[index].w;
      if (cursor <= 0) return prizes[index].m;
    }
    return prizes[0].m;
  }

  function renderScratch(stage) {
    stage.innerHTML =
      '<div class="ostg-game ostg-scratch">' +
        '<div class="ostg-controls">' +
          '<label>Bet (OST)<input type="number" id="scBet" min="0.1" step="0.1" value="1" inputmode="decimal"></label>' +
          '<label>Ticket<select id="scMode"><option value="steady">Steady</option><option value="burst" selected>Burst</option><option value="jackpot">Jackpot</option></select></label>' +
          '<button class="ostg-btn ostg-btn-primary" id="scBuy">Buy ticket</button>' +
          '<button class="ostg-btn" id="scReveal" disabled>Scratch all</button>' +
        '</div>' +
        '<div class="ostg-scratch-grid" id="scGrid"></div>' +
        '<div class="ostg-status" id="scStatus">Buy a ticket, scratch nine panels, and match three multipliers to get paid.</div>' +
      '</div>';

    var bet = document.getElementById('scBet');
    var mode = document.getElementById('scMode');
    var buy = document.getElementById('scBuy');
    var reveal = document.getElementById('scReveal');
    var grid = document.getElementById('scGrid');
    var statusEl = document.getElementById('scStatus');
    var session = null;

    function buildBlankTicket() {
      grid.innerHTML = '';
      for (var index = 0; index < 9; index++) {
        var tile = document.createElement('button');
        tile.type = 'button';
        tile.className = 'ostg-scratch-tile';
        tile.dataset.index = String(index);
        tile.textContent = 'Scratch';
        tile.disabled = !session;
        tile.addEventListener('click', function (event) { scratchTile(parseInt(event.currentTarget.dataset.index, 10)); });
        grid.appendChild(tile);
      }
    }

    function bestScratchMatch() {
      var counts = {};
      session.prizes.forEach(function (prize) { counts[prize] = (counts[prize] || 0) + 1; });
      return Object.keys(counts).map(Number).filter(function (prize) { return counts[prize] >= 3; }).sort(function (left, right) { return right - left; })[0] || 0;
    }

    function finishTicket() {
      if (!session || session.done) return;
      session.done = true;
      var multiplier = bestScratchMatch();
      var payout = session.bet * multiplier;
      settleGame('scratch', session.bet, payout, multiplier, statusEl,
        multiplier > 0 ? 'Matched three ' + shortMult(multiplier) + ' tiles · paid ' + payout.toFixed(2) + ' OST.'
                       : 'No three-of-a-kind this ticket — lost ' + session.bet.toFixed(2) + ' OST.',
        grid);
      session = null;
      setBusy([bet, mode, buy], false);
      reveal.disabled = true;
    }

    function scratchTile(index) {
      if (!session || session.revealed.has(index)) return;
      session.revealed.add(index);
      var tile = grid.querySelector('[data-index="' + index + '"]');
      var prize = session.prizes[index];
      tile.disabled = true;
      tile.classList.add('is-revealed', prize >= 5 ? 'is-big' : prize > 0 ? 'is-soft' : 'is-zero');
      tile.textContent = prize > 0 ? shortMult(prize) : '0x';
      pulse(tile, prize > 0 ? 'ostg-pop-win' : 'ostg-pop-loss');
      statusEl.textContent = 'Scratched ' + session.revealed.size + '/9 panels.';
      if (session.revealed.size >= 9) finishTicket();
    }

    buy.addEventListener('click', async function () {
      var amount = parseBet(bet, statusEl);
      if (amount === null) return;
      var result = placeBet(amount);
      if (!result.ok) { statusEl.textContent = result.msg; return; }
      var floats = await pfFloats(9);
      session = { bet: amount, prizes: floats.map(function (randomValue) { return pickScratchPrize(randomValue, mode.value); }), revealed: new Set(), done: false };
      setBusy([bet, mode, buy], true);
      reveal.disabled = false;
      statusEl.textContent = 'Ticket live. Scratch panels one by one or reveal all.';
      buildBlankTicket();
    });

    reveal.addEventListener('click', function () {
      if (!session) return;
      for (var index = 0; index < 9; index++) {
        setTimeout((function (tileIndex) { return function () { scratchTile(tileIndex); }; })(index), index * 85);
      }
    });

    buildBlankTicket();
  }

  // ────────────────────────────────────────────────────────────────────────
  // PENALTY — pick aim and shot style, try to beat the keeper.
  // ────────────────────────────────────────────────────────────────────────
  var PENALTY_STYLES = {
    placed: { label: 'Placed', multiplier: 1.55, accuracy: 0.78, beat: 0.18 },
    power: { label: 'Power', multiplier: 2.25, accuracy: 0.58, beat: 0.28 },
    chip: { label: 'Chip', multiplier: 4.2, accuracy: 0.35, beat: 0.42 }
  };

  function renderPenalty(stage) {
    stage.innerHTML =
      '<div class="ostg-game ostg-penalty">' +
        '<div class="ostg-controls">' +
          '<label>Bet (OST)<input type="number" id="pnBet" min="0.1" step="0.1" value="1" inputmode="decimal"></label>' +
          '<label>Aim<select id="pnAim"><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option><option value="top">Top corner</option></select></label>' +
          '<label>Shot<select id="pnStyle"><option value="placed">Placed · safer</option><option value="power" selected>Power · balanced</option><option value="chip">Chip · risky</option></select></label>' +
          '<button class="ostg-btn ostg-btn-primary" id="pnShoot">Shoot</button>' +
          '<div class="ostg-meta"><span>Goal pays</span> <strong id="pnPay">2.25x</strong></div>' +
        '</div>' +
        '<div class="ostg-penalty-stage ostg-penalty-pitch">' +
          '<div class="ostg-penalty-goal"><div class="ostg-keeper" id="pnKeeper">🧤</div><div class="ostg-ball" id="pnBall">●</div><div class="ostg-net-line"></div></div>' +
          '<div class="ostg-penalty-lanes"><span>Left</span><span>Center</span><span>Right</span><span>Top</span></div>' +
        '</div>' +
        '<div class="ostg-status" id="pnStatus">Choose an aim and shot style. Safer shots pay less; fancy chips can beat a correct keeper guess.</div>' +
      '</div>';

    var bet = document.getElementById('pnBet');
    var aim = document.getElementById('pnAim');
    var style = document.getElementById('pnStyle');
    var shoot = document.getElementById('pnShoot');
    var pay = document.getElementById('pnPay');
    var keeper = document.getElementById('pnKeeper');
    var ball = document.getElementById('pnBall');
    var pitch = stage.querySelector('.ostg-penalty-pitch');
    var statusEl = document.getElementById('pnStatus');
    var sides = ['left', 'center', 'right', 'top'];

    function clearPenaltyPose() {
      pitch.dataset.result = '';
      keeper.dataset.side = '';
      ball.dataset.side = '';
      keeper.dataset.result = '';
      ball.dataset.result = '';
    }

    function refreshPenalty() {
      pay.textContent = shortMult(PENALTY_STYLES[style.value].multiplier);
    }
    style.addEventListener('change', refreshPenalty);
    refreshPenalty();

    shoot.addEventListener('click', async function () {
      var amount = parseBet(bet, statusEl);
      if (amount === null) return;
      var result = placeBet(amount);
      if (!result.ok) { statusEl.textContent = result.msg; return; }
      setBusy([bet, aim, style, shoot], true);
      clearPenaltyPose();
      var floats = await pfFloats(2);
      var shot = PENALTY_STYLES[style.value];
      var keeperSide = sides[Math.floor(floats[0] * sides.length)];
      var keeperMatched = keeperSide === aim.value;
      var scored = keeperMatched ? floats[1] < shot.beat : floats[1] < shot.accuracy;
      var stopType = keeperMatched ? 'saved' : 'missed';
      keeper.dataset.side = keeperSide;
      ball.dataset.side = aim.value;
      keeper.dataset.result = scored || stopType === 'missed' ? 'miss' : 'save';
      ball.dataset.result = scored ? 'goal' : stopType;
      pitch.dataset.result = scored ? 'goal' : stopType;
      statusEl.textContent = 'Shot away... keeper dives ' + keeperSide + '.';
      setTimeout(function () {
        var payout = scored ? amount * shot.multiplier : 0;
        var lossText = stopType === 'saved' ? 'Saved by the keeper.' : 'Shot missed the frame.';
        settleGame('penalty', amount, payout, scored ? shot.multiplier : 0, statusEl,
          scored ? shot.label + ' shot scores! Paid ' + payout.toFixed(2) + ' OST at ' + shortMult(shot.multiplier) + '.'
                 : lossText + ' Lost ' + amount.toFixed(2) + ' OST.',
          pitch);
        setBusy([bet, aim, style, shoot], false);
      }, 760);
    });
  }

  function diceFace(value) {
    return ['','⚀','⚁','⚂','⚃','⚄','⚅'][value] || String(value);
  }

  function rollDie(floatValue) {
    return Math.floor((floatValue || 0) * 6) + 1;
  }

  function cardRankValue(card) {
    if (!card) return 0;
    if (card.rank === 'A') return 14;
    return Math.min(card.order, 13);
  }

  function comparePokerScores(left, right) {
    return Number(left && left.score || 0) - Number(right && right.score || 0);
  }

  function scoreFiveCardPoker(cards) {
    var values = cards.map(cardRankValue).sort(function(a, b) { return b - a; });
    var counts = {};
    values.forEach(function(value) { counts[value] = (counts[value] || 0) + 1; });
    var groups = Object.keys(counts).map(Number).sort(function(a, b) {
      return counts[b] === counts[a] ? b - a : counts[b] - counts[a];
    });
    var unique = Object.keys(counts).map(Number).sort(function(a, b) { return b - a; });
    var straightHigh = 0;
    if (unique.length >= 5) {
      for (var index = 0; index <= unique.length - 5; index++) {
        var run = unique.slice(index, index + 5);
        if (run[0] - run[4] === 4) { straightHigh = run[0]; break; }
      }
      if (!straightHigh && unique.indexOf(14) >= 0 && unique.indexOf(5) >= 0 && unique.indexOf(4) >= 0 && unique.indexOf(3) >= 0 && unique.indexOf(2) >= 0) straightHigh = 5;
    }
    var flush = cards.every(function(card) { return card.suit === cards[0].suit; });
    var label = 'High card';
    var rank = 0;
    var kickers = values.slice();
    if (flush && straightHigh === 14) { rank = 9; label = 'Royal flush'; kickers = [14]; }
    else if (flush && straightHigh) { rank = 8; label = 'Straight flush'; kickers = [straightHigh]; }
    else if (counts[groups[0]] === 4) { rank = 7; label = 'Four of a kind'; kickers = [groups[0]].concat(values.filter(function(v) { return v !== groups[0]; })); }
    else if (counts[groups[0]] === 3 && counts[groups[1]] === 2) { rank = 6; label = 'Full house'; kickers = [groups[0], groups[1]]; }
    else if (flush) { rank = 5; label = 'Flush'; }
    else if (straightHigh) { rank = 4; label = 'Straight'; kickers = [straightHigh]; }
    else if (counts[groups[0]] === 3) { rank = 3; label = 'Three of a kind'; kickers = [groups[0]].concat(values.filter(function(v) { return v !== groups[0]; })); }
    else if (counts[groups[0]] === 2 && counts[groups[1]] === 2) { rank = 2; label = 'Two pair'; kickers = [groups[0], groups[1]].concat(values.filter(function(v) { return v !== groups[0] && v !== groups[1]; })); }
    else if (counts[groups[0]] === 2) { rank = 1; label = 'Pair'; kickers = [groups[0]].concat(values.filter(function(v) { return v !== groups[0]; })); }
    var score = rank * 10000000000;
    kickers.slice(0, 5).forEach(function(value, index) { score += value * Math.pow(100, 4 - index); });
    return { rank: rank, label: label, score: score, main: kickers[0] || 0 };
  }

  function bestPokerScore(cards) {
    var best = null;
    for (var a = 0; a < cards.length - 4; a++) {
      for (var b = a + 1; b < cards.length - 3; b++) {
        for (var c = b + 1; c < cards.length - 2; c++) {
          for (var d = c + 1; d < cards.length - 1; d++) {
            for (var e = d + 1; e < cards.length; e++) {
              var score = scoreFiveCardPoker([cards[a], cards[b], cards[c], cards[d], cards[e]]);
              if (!best || score.score > best.score) best = score;
            }
          }
        }
      }
    }
    return best || scoreFiveCardPoker(cards.slice(0, 5));
  }

  function scoreThreeCardPoker(cards) {
    var values = cards.map(cardRankValue).sort(function(a, b) { return b - a; });
    var counts = {};
    values.forEach(function(value) { counts[value] = (counts[value] || 0) + 1; });
    var unique = Object.keys(counts).map(Number).sort(function(a, b) { return b - a; });
    var flush = cards.every(function(card) { return card.suit === cards[0].suit; });
    var straight = unique.length === 3 && (unique[0] - unique[2] === 2 || (unique[0] === 14 && unique[1] === 3 && unique[2] === 2));
    var groups = Object.keys(counts).map(Number).sort(function(a, b) { return counts[b] === counts[a] ? b - a : counts[b] - counts[a]; });
    var rank = 0, label = 'High card', main = values[0];
    if (straight && flush) { rank = 5; label = 'Straight flush'; main = unique[0] === 14 && unique[1] === 3 ? 3 : unique[0]; }
    else if (counts[groups[0]] === 3) { rank = 4; label = 'Three of a kind'; main = groups[0]; }
    else if (straight) { rank = 3; label = 'Straight'; main = unique[0] === 14 && unique[1] === 3 ? 3 : unique[0]; }
    else if (flush) { rank = 2; label = 'Flush'; }
    else if (counts[groups[0]] === 2) { rank = 1; label = 'Pair'; main = groups[0]; }
    var score = rank * 1000000 + main * 10000 + values[0] * 100 + values[1];
    return { rank: rank, label: label, score: score, main: main };
  }

  function renderQuickIdle(config) {
    var meta = metaFor(config.id);
    var engine = engineFor(config.id);
    return '<div class="ostg-quick-idle">' +
      '<div class="ostg-quick-orbit"><span>' + meta.symbols[0] + '</span><span>' + meta.symbols[1] + '</span><span>' + meta.symbols[2] + '</span></div>' +
      '<div class="ostg-quick-core">' + config.idle + '</div>' +
      '<div class="ostg-quick-rails"><span>' + engine.curve + '</span><span>' + engine.action + '</span><span>' + engine.risk + '</span></div>' +
    '</div>';
  }

  function renderQuickPreview(preview) {
    preview = preview || {};
    return '<span><b>Chance</b><strong>' + (preview.chance || 'Live') + '</strong></span>' +
      '<span><b>Multiplier</b><strong>' + (preview.multiplier || 'Varies') + '</strong></span>' +
      '<span><b>Payout</b><strong>' + (preview.payout || 'Set bet') + '</strong></span>' +
      '<span><b>Risk</b><strong>' + (preview.risk || 'Fair draw') + '</strong></span>';
  }

  function renderQuickCasino(stage, config) {
    stage.innerHTML =
      '<div class="ostg-game ostg-world">' +
        '<div class="ostg-controls">' +
          '<label>Bet (OST)<input type="number" id="qgBet" min="0.1" step="0.1" value="1" inputmode="decimal"></label>' +
          (config.options && config.options.length ? '<label>' + (config.optionLabel || 'Pick') + '<select id="qgPick">' + config.options.map(function(option) { return '<option value="' + option.value + '">' + option.label + '</option>'; }).join('') + '</select></label>' : '') +
          '<button class="ostg-btn ostg-btn-primary" id="qgPlay">' + (config.button || 'Play') + '</button>' +
          '<div class="ostg-meta"><span>Table</span> <strong>' + config.meta + '</strong></div>' +
          '<div class="ostg-ticket-preview" id="qgPreview"></div>' +
        '</div>' +
        '<div class="ostg-world-stage" id="qgResult">' + renderQuickIdle(config) + '</div>' +
        '<div class="ostg-status" id="qgStatus">' + config.status + '</div>' +
      '</div>';
    var bet = document.getElementById('qgBet');
    var pick = document.getElementById('qgPick');
    var play = document.getElementById('qgPlay');
    var previewEl = document.getElementById('qgPreview');
    var resultEl = document.getElementById('qgResult');
    var statusEl = document.getElementById('qgStatus');
    function updatePreview() {
      if (!previewEl) return;
      var amount = parseFloat(bet.value) || 0;
      var value = pick ? pick.value : '';
      var preview = config.preview ? config.preview(value, amount) : { chance: 'HMAC', multiplier: config.meta, payout: amount ? fmt(amount) + ' OST base' : 'Set bet', risk: engineFor(config.id).risk };
      previewEl.innerHTML = renderQuickPreview(preview);
    }
    [bet, pick].forEach(function(element) {
      if (!element) return;
      element.addEventListener('input', updatePreview);
      element.addEventListener('change', updatePreview);
    });
    updatePreview();
    play.addEventListener('click', async function() {
      var amount = parseBet(bet, statusEl);
      if (amount === null) return;
      var placed = placeBet(amount);
      if (!placed.ok) { statusEl.textContent = placed.msg; return; }
      setBusy([bet, pick, play], true);
      statusEl.textContent = config.loading || 'Dealing...';
      resultEl.classList.remove('is-win', 'is-soft', 'is-loss');
      resultEl.classList.add('is-resolving');
      resultEl.innerHTML = renderQuickResolving(config.id);
      try {
        await delay(540);
        var outcome = await config.resolve(amount, pick ? pick.value : '');
        await delay(180);
        resultEl.classList.remove('is-resolving');
        resultEl.classList.add(outcome.payout > amount ? 'is-win' : outcome.payout > 0 ? 'is-soft' : 'is-loss');
        resultEl.innerHTML = outcome.html;
        settleGame(config.id, amount, outcome.payout, outcome.multiplier, statusEl, outcome.text, resultEl);
      } catch (error) {
        resultEl.classList.remove('is-resolving');
        credit(amount, config.id + '-refund');
        statusEl.textContent = 'Round failed safely. Bet returned.';
        console.warn('[ostg] quick casino failed', config.id, error);
      } finally {
        setBusy([bet, pick, play], false);
      }
    });
  }

  function renderQuickResolving(game) {
    var meta = metaFor(game);
    return '<div class="ostg-resolve-machine">' +
      '<div class="ostg-resolve-reels">' +
        '<span>' + meta.symbols[0] + '</span>' +
        '<span>' + meta.symbols[1] + '</span>' +
        '<span>' + meta.symbols[2] + '</span>' +
      '</div>' +
      '<div class="ostg-resolve-line"></div>' +
      '<strong>' + meta.label + '</strong>' +
    '</div>';
  }

  function renderDiceStrip(values) {
    return '<div class="ostg-dice-strip">' + values.map(function(value) { return '<span>' + diceFace(value) + '</span>'; }).join('') + '</div>';
  }

  function renderCardStrip(cards) {
    return '<div class="ostg-card-row ostg-card-row-center">' + cards.map(renderCard).join('') + '</div>';
  }

  function renderDouble(stage) {
    renderQuickCasino(stage, {
      id: 'double', meta: 'Red/black 2x · green 14x', button: 'Roll double', optionLabel: 'Pick',
      options: [
        { value: 'red', label: 'Red · 2x' },
        { value: 'black', label: 'Black · 2x' },
        { value: 'green', label: 'Green · 14x' }
      ],
      idle: '<div class="ostg-versus">Red · Black · Green</div>', status: 'Rainbet-style double: pick a color, roll the strip, and chase the green hit.',
      preview: function(pick, amount) {
        var multiplier = pick === 'green' ? 14 : 2;
        return { chance: pick === 'green' ? '5.00%' : '47.50%', multiplier: shortMult(multiplier), payout: fmt(amount * multiplier) + ' OST', risk: pick === 'green' ? 'Longshot' : 'Even strip' };
      },
      resolve: async function(amount, pick) {
        var value = (await pfFloats(1))[0];
        var color = value < 0.475 ? 'red' : value < 0.95 ? 'black' : 'green';
        var multiplier = pick === color ? (color === 'green' ? 14 : 2) : 0;
        var lanes = ['red','black','red','black','green','red','black','red','black','red','black','green','red','black'];
        var hitIndex = Math.floor(value * lanes.length);
        if (lanes[hitIndex] !== color) {
          hitIndex = lanes.reduce(function(bestIndex, lane, laneIndex) {
            if (lane !== color) return bestIndex;
            if (bestIndex < 0 || Math.abs(laneIndex - hitIndex) < Math.abs(bestIndex - hitIndex)) return laneIndex;
            return bestIndex;
          }, -1);
        }
        return {
          html: '<div class="ostg-double-strip">' + lanes.map(function(lane, index) { return '<span class="' + (index === hitIndex ? 'is-hit ' : '') + lane + '">' + lane + '</span>'; }).join('') + '</div><div class="ostg-world-note">Rolled ' + color.toUpperCase() + '</div>',
          payout: amount * multiplier,
          multiplier: multiplier,
          text: multiplier ? 'Double hit ' + color + ' for ' + shortMult(multiplier) + '.' : 'Double rolled ' + color + '. Ticket lost.'
        };
      }
    });
  }

  function renderSlide(stage) {
    renderQuickCasino(stage, {
      id: 'slide', meta: 'Target multiplier', button: 'Launch slide', optionLabel: 'Cashout target',
      options: [
        { value: '1.25', label: '1.25x' }, { value: '1.5', label: '1.50x' }, { value: '2', label: '2.00x' },
        { value: '5', label: '5.00x' }, { value: '10', label: '10.00x' }, { value: '25', label: '25.00x' }, { value: '50', label: '50.00x' }
      ],
      idle: '<div class="ostg-versus">Slide</div>', status: 'Pick a target. If the provably-fair slide reaches it, you cash at that multiplier.',
      preview: function(pick, amount) {
        var target = Number(pick) || 2;
        var chance = Math.min(99, 99 / target);
        return { chance: chance.toFixed(2) + '%', multiplier: shortMult(target), payout: fmt(amount * target) + ' OST', risk: target >= 10 ? 'High chase' : 'Target lane' };
      },
      resolve: async function(amount, pick) {
        var target = Number(pick) || 2;
        var value = Math.max(0.000001, (await pfFloats(1))[0]);
        var result = Math.min(100, Math.floor((0.99 / value) * 100) / 100);
        var multiplier = result >= target ? target : 0;
        var cells = [1.25,1.5,2,3,5,10,25,50,100];
        return {
          html: '<div class="ostg-slide-meter"><strong>' + shortMult(result) + '</strong><span style="width:' + Math.min(100, result) + '%"></span></div><div class="ostg-pachinko-lane">' + cells.map(function(cell) { return '<span class="' + (cell <= result ? 'is-hit' : '') + '">' + shortMult(cell) + '</span>'; }).join('') + '</div>',
          payout: amount * multiplier,
          multiplier: multiplier,
          text: multiplier ? 'Slide cleared ' + shortMult(target) + '.' : 'Slide stopped at ' + shortMult(result) + ', below your ' + shortMult(target) + ' target.'
        };
      }
    });
  }

  function renderPump(stage) {
    renderQuickCasino(stage, {
      id: 'pump', meta: 'Balloon ladder', button: 'Pump', optionLabel: 'Pumps',
      options: [1,2,3,4,5,6,7,8].map(function(count) {
        var prob = (9 - count) / 9;
        return { value: String(count), label: count + ' pumps · ' + shortMult(0.99 / prob) };
      }),
      idle: '<div class="ostg-versus">Pump</div>', status: 'Choose how many pumps to take. More pumps means more payout and a higher bust chance.',
      preview: function(pick, amount) {
        var target = clamp(Number(pick), 1, 8);
        var chance = ((9 - target) / 9) * 100;
        var multiplier = 0.99 / ((9 - target) / 9);
        return { chance: chance.toFixed(2) + '%', multiplier: shortMult(multiplier), payout: fmt(amount * multiplier) + ' OST', risk: target >= 6 ? 'Near bust' : 'Pressure' };
      },
      resolve: async function(amount, pick) {
        var target = clamp(Number(pick), 1, 8);
        var bustAt = 1 + Math.floor((await pfFloats(1))[0] * 9);
        var survived = target < bustAt;
        var multiplier = survived ? 0.99 / ((9 - target) / 9) : 0;
        return {
          html: '<div class="ostg-pachinko-lane">' + [1,2,3,4,5,6,7,8].map(function(index) { return '<span class="' + (index <= target && survived ? 'is-hit' : (index === bustAt ? 'is-bust' : '')) + '">🎈 ' + index + '</span>'; }).join('') + '</div><div class="ostg-world-note">Bust point: pump ' + bustAt + '</div>',
          payout: amount * multiplier,
          multiplier: multiplier,
          text: survived ? 'Pump survived ' + target + ' pumps for ' + shortMult(multiplier) + '.' : 'Balloon burst at pump ' + bustAt + '.'
        };
      }
    });
  }

  function renderDragonTower(stage) {
    renderQuickCasino(stage, {
      id: 'dragontower', meta: 'Path risk tower', button: 'Climb tower', optionLabel: 'Mode',
      options: [
        { value: 'easy', label: 'Easy · 4 floors' },
        { value: 'medium', label: 'Medium · 5 floors' },
        { value: 'hard', label: 'Hard · 5 floors' }
      ],
      idle: '<div class="ostg-versus">Dragon Tower</div>', status: 'Climb a tower of eggs. Hit a dragon trap and the run ends.',
      preview: function(pick, amount) {
        var modes = { easy: { rows: 4, trap: 0.18 }, medium: { rows: 5, trap: 0.28 }, hard: { rows: 5, trap: 0.42 } };
        var mode = modes[pick] || modes.easy;
        var chance = Math.pow(1 - mode.trap, mode.rows);
        var multiplier = 0.99 / chance;
        return { chance: (chance * 100).toFixed(2) + '%', multiplier: shortMult(multiplier), payout: fmt(amount * multiplier) + ' OST', risk: pick || 'easy' };
      },
      resolve: async function(amount, pick) {
        var modes = {
          easy: { rows: 4, cols: 4, trap: 0.18, label: 'Easy' },
          medium: { rows: 5, cols: 3, trap: 0.28, label: 'Medium' },
          hard: { rows: 5, cols: 2, trap: 0.42, label: 'Hard' }
        };
        var mode = modes[pick] || modes.easy;
        var floats = await pfFloats(mode.rows * 2);
        var survivedRows = 0;
        var bustRow = -1;
        for (var row = 0; row < mode.rows; row++) {
          if (floats[row] < mode.trap) { bustRow = row; break; }
          survivedRows += 1;
        }
        var survived = survivedRows === mode.rows;
        var multiplier = survived ? 0.99 / Math.pow(1 - mode.trap, mode.rows) : 0;
        var htmlRows = [];
        for (var r = mode.rows - 1; r >= 0; r--) {
          htmlRows.push('<div class="ostg-tower-row is-current" style="--tower-cols:' + mode.cols + '">' + Array.from({ length: mode.cols }).map(function(_, c) {
            var picked = c === Math.floor((floats[mode.rows + r] || 0) * mode.cols);
            var cleared = r < survivedRows || survived;
            var cls = picked && cleared ? 'is-safe' : (picked && r === bustRow ? 'is-trap' : '');
            return '<span class="ostg-tower-cell ' + cls + '">' + (cls === 'is-trap' ? '🐉' : picked ? '🥚' : '·') + '</span>';
          }).join('') + '</div>');
        }
        return {
          html: '<div class="ostg-tower-board">' + htmlRows.join('') + '</div><div class="ostg-world-note">' + mode.label + ' path · ' + survivedRows + '/' + mode.rows + ' floors</div>',
          payout: amount * multiplier,
          multiplier: multiplier,
          text: survived ? 'Dragon Tower cleared for ' + shortMult(multiplier) + '.' : 'Dragon trap on floor ' + (bustRow + 1) + '.'
        };
      }
    });
  }

  function renderDiamonds(stage) {
    renderQuickCasino(stage, {
      id: 'diamonds', meta: '5-gem reveal', button: 'Reveal gems', optionLabel: 'Bet',
      options: [{ value: 'spin', label: 'Five diamonds' }],
      idle: '<div class="ostg-versus">Diamonds</div>', status: 'Reveal five gems. Matching colors pay like the classic instant original.',
      resolve: async function(amount) {
        var gems = ['💎','🔷','🟢','🟣','🟡','🔴','⚪'];
        var floats = await pfFloats(5);
        var rolls = floats.map(function(value) { return gems[Math.floor(value * gems.length)]; });
        var counts = {};
        rolls.forEach(function(gem) { counts[gem] = (counts[gem] || 0) + 1; });
        var groups = Object.keys(counts).map(function(gem) { return counts[gem]; }).sort(function(a, b) { return b - a; });
        var multiplier = groups[0] === 5 ? 50 : groups[0] === 4 ? 10 : (groups[0] === 3 && groups[1] === 2 ? 5 : groups[0] === 3 ? 2 : (groups[0] === 2 && groups[1] === 2 ? 1.2 : 0));
        return {
          html: '<div class="ostg-diamond-row">' + rolls.map(function(gem) { return '<span class="' + (counts[gem] >= 3 ? 'is-hit' : '') + '">' + gem + '</span>'; }).join('') + '</div><div class="ostg-world-note">Best group: ' + groups[0] + ' matching gems</div>',
          payout: amount * multiplier,
          multiplier: multiplier,
          text: multiplier ? 'Diamonds paid ' + shortMult(multiplier) + '.' : 'No diamond match this round.'
        };
      }
    });
  }

  function renderCaseBattle(stage) {
    renderQuickCasino(stage, {
      id: 'cases', meta: 'You vs dealer', button: 'Open cases', optionLabel: 'Case',
      options: [
        { value: 'low', label: 'Starter case' },
        { value: 'standard', label: 'Rain case' },
        { value: 'high', label: 'High roller case' }
      ],
      idle: '<div class="ostg-versus">Case Battle</div>', status: 'Open three case drops against the dealer. Higher total wins the battle.',
      resolve: async function(amount, pick) {
        var tables = {
          low: [{ n: 'Common', v: 1 }, { n: 'Rare', v: 2 }, { n: 'Epic', v: 5 }, { n: 'Gold', v: 12 }],
          standard: [{ n: 'Common', v: 0.5 }, { n: 'Rare', v: 3 }, { n: 'Epic', v: 8 }, { n: 'Gold', v: 25 }],
          high: [{ n: 'Dust', v: 0.2 }, { n: 'Rare', v: 4 }, { n: 'Epic', v: 15 }, { n: 'Gold', v: 60 }]
        };
        var table = tables[pick] || tables.standard;
        function draw(value) {
          var index = value < 0.56 ? 0 : value < 0.84 ? 1 : value < 0.97 ? 2 : 3;
          return table[index];
        }
        var floats = await pfFloats(6);
        var player = floats.slice(0, 3).map(draw);
        var dealer = floats.slice(3, 6).map(draw);
        var playerTotal = player.reduce(function(sum, item) { return sum + item.v; }, 0);
        var dealerTotal = dealer.reduce(function(sum, item) { return sum + item.v; }, 0);
        var multiplier = playerTotal > dealerTotal ? 1.98 : (playerTotal === dealerTotal ? 1 : 0);
        function strip(items) { return '<div class="ostg-case-row">' + items.map(function(item) { return '<span>📦 <b>' + item.n + '</b><small>' + item.v + '</small></span>'; }).join('') + '</div>'; }
        return {
          html: '<div class="ostg-split-hands"><div><b>You · ' + playerTotal.toFixed(1) + '</b>' + strip(player) + '</div><div><b>Dealer · ' + dealerTotal.toFixed(1) + '</b>' + strip(dealer) + '</div></div>',
          payout: amount * multiplier,
          multiplier: multiplier,
          text: playerTotal > dealerTotal ? 'Case battle won.' : playerTotal === dealerTotal ? 'Case battle tied. Bet returned.' : 'Dealer won the case battle.'
        };
      }
    });
  }

  function renderTome(stage) {
    renderQuickCasino(stage, {
      id: 'tome', meta: 'Rune ladder', button: 'Open tome', optionLabel: 'Pages',
      options: [2,3,4,5,6,7,8].map(function(pages) { return { value: String(pages), label: pages + ' pages · ' + shortMult(0.99 / Math.pow(0.86, pages)) }; }),
      idle: '<div class="ostg-versus">Tome</div>', status: 'Open more rune pages for a bigger multiplier. A curse page burns the run.',
      preview: function(pick, amount) {
        var pages = clamp(Number(pick), 2, 8);
        var chance = Math.pow(0.86, pages);
        var multiplier = 0.99 / chance;
        return { chance: (chance * 100).toFixed(2) + '%', multiplier: shortMult(multiplier), payout: fmt(amount * multiplier) + ' OST', risk: pages + ' pages' };
      },
      resolve: async function(amount, pick) {
        var pages = clamp(Number(pick), 2, 8);
        var floats = await pfFloats(pages);
        var cursed = -1;
        for (var index = 0; index < pages; index++) if (floats[index] < 0.14) { cursed = index; break; }
        var survived = cursed < 0;
        var multiplier = survived ? 0.99 / Math.pow(0.86, pages) : 0;
        return {
          html: '<div class="ostg-tome-row">' + Array.from({ length: pages }).map(function(_, index) { return '<span class="' + (cursed === index ? 'is-bust' : 'is-hit') + '">' + (cursed === index ? '☠' : 'ᚱ') + '</span>'; }).join('') + '</div>',
          payout: amount * multiplier,
          multiplier: multiplier,
          text: survived ? 'Tome cleared ' + pages + ' pages for ' + shortMult(multiplier) + '.' : 'Curse page opened at page ' + (cursed + 1) + '.'
        };
      }
    });
  }

  function renderScarabSpin(stage) {
    renderQuickCasino(stage, {
      id: 'scarab', meta: '3x3 symbol grid', button: 'Spin scarabs', optionLabel: 'Mode',
      options: [{ value: 'normal', label: 'Normal volatility' }, { value: 'wild', label: 'Wild chase' }],
      idle: '<div class="ostg-versus">Scarab Spin</div>', status: 'Spin a 3x3 instant grid. Scarabs and wilds build the payout.',
      resolve: async function(amount, pick) {
        var symbols = ['🪲','☀','🔺','💎','🌙','⚱'];
        var floats = await pfFloats(9);
        var grid = floats.map(function(value) { return symbols[Math.floor(value * symbols.length)]; });
        var scarabs = grid.filter(function(symbol) { return symbol === '🪲'; }).length;
        var diamonds = grid.filter(function(symbol) { return symbol === '💎'; }).length;
        var multiplier = scarabs >= 6 ? 30 : scarabs >= 5 ? 12 : scarabs >= 4 ? 5 : scarabs >= 3 ? 2 : diamonds >= 4 ? 1.5 : 0;
        if (pick === 'wild' && multiplier > 0) multiplier *= 1.35;
        return {
          html: '<div class="ostg-scarab-grid">' + grid.map(function(symbol) { return '<span class="' + (symbol === '🪲' || symbol === '💎' ? 'is-hit' : '') + '">' + symbol + '</span>'; }).join('') + '</div><div class="ostg-world-note">Scarabs: ' + scarabs + ' · Diamonds: ' + diamonds + '</div>',
          payout: amount * multiplier,
          multiplier: multiplier,
          text: multiplier ? 'Scarab Spin paid ' + shortMult(multiplier) + '.' : 'No scarab cluster this spin.'
        };
      }
    });
  }

  function renderVideoPoker(stage) {
    stage.innerHTML =
      '<div class="ostg-game ostg-videopoker">' +
        '<div class="ostg-controls">' +
          '<label>Bet (OST)<input type="number" id="vpBet" min="0.1" step="0.1" value="1" inputmode="decimal"></label>' +
          '<button class="ostg-btn ostg-btn-primary" id="vpDeal">Deal</button>' +
          '<button class="ostg-btn ostg-btn-cash" id="vpDraw" disabled>Draw</button>' +
          '<div class="ostg-meta"><span>Paytable</span> <strong>Jacks or better</strong></div>' +
        '</div>' +
        '<div class="ostg-video-hand" id="vpHand"></div>' +
        '<div class="ostg-status" id="vpStatus">Deal five cards, hold what you like, then draw once.</div>' +
      '</div>';
    var bet = document.getElementById('vpBet');
    var deal = document.getElementById('vpDeal');
    var draw = document.getElementById('vpDraw');
    var handEl = document.getElementById('vpHand');
    var statusEl = document.getElementById('vpStatus');
    var session = null;
    function payFor(score) {
      if (score.rank === 9) return 250;
      if (score.rank === 8) return 50;
      if (score.rank === 7) return 25;
      if (score.rank === 6) return 9;
      if (score.rank === 5) return 6;
      if (score.rank === 4) return 4;
      if (score.rank === 3) return 3;
      if (score.rank === 2) return 2;
      if (score.rank === 1 && score.main >= 11) return 1.2;
      return 0;
    }
    function paint() {
      handEl.innerHTML = session.hand.map(function(card, index) {
        return '<button type="button" class="ostg-hold-card ' + (session.hold[index] ? 'is-held' : '') + '" data-index="' + index + '">' + renderCard(card) + '<small>' + (session.hold[index] ? 'Held' : 'Tap hold') + '</small></button>';
      }).join('');
      handEl.querySelectorAll('[data-index]').forEach(function(button) {
        button.addEventListener('click', function() {
          if (!session || session.done) return;
          var index = Number(button.dataset.index);
          session.hold[index] = !session.hold[index];
          paint();
        });
      });
    }
    deal.addEventListener('click', async function() {
      var amount = parseBet(bet, statusEl);
      if (amount === null) return;
      var placed = placeBet(amount);
      if (!placed.ok) { statusEl.textContent = placed.msg; return; }
      session = { bet: amount, deck: createCardDeck(await pfFloats(52)), hand: [], hold: [false,false,false,false,false], done: false };
      for (var index = 0; index < 5; index++) session.hand.push(session.deck.pop());
      bet.disabled = true; deal.disabled = true; draw.disabled = false;
      statusEl.textContent = 'Tap cards to hold, then draw.';
      paint();
    });
    draw.addEventListener('click', function() {
      if (!session || session.done) return;
      for (var index = 0; index < 5; index++) if (!session.hold[index]) session.hand[index] = session.deck.pop();
      session.done = true;
      paint();
      var score = scoreFiveCardPoker(session.hand);
      var multiplier = payFor(score);
      var payout = session.bet * multiplier;
      settleGame('videopoker', session.bet, payout, multiplier, statusEl,
        multiplier ? score.label + ' pays ' + shortMult(multiplier) + ' · ' + payout.toFixed(2) + ' OST.' : score.label + ' — no Jacks-or-better payout.',
        handEl);
      session = null; bet.disabled = false; deal.disabled = false; draw.disabled = true;
    });
  }

  function renderCraps(stage) {
    renderQuickCasino(stage, {
      id: 'craps', meta: 'Pass line', button: 'Roll dice', optionLabel: 'Bet',
      options: [{ value: 'pass', label: 'Pass line' }, { value: 'dont', label: 'Don’t pass' }, { value: 'field', label: 'Field one-roll' }],
      idle: renderDiceStrip([1, 1]), status: 'Pass line, don’t pass, or field. Point rolls resolve automatically.',
      resolve: async function(amount, pick) {
        var floats = await pfFloats(24);
        var rolls = [];
        function nextRoll(offset) { var pair = [rollDie(floats[offset]), rollDie(floats[offset + 1])]; rolls.push(pair); return pair[0] + pair[1]; }
        var total = nextRoll(0);
        var multiplier = 0, text = '';
        if (pick === 'field') {
          multiplier = total === 2 || total === 12 ? 2.97 : ([3,4,9,10,11].indexOf(total) >= 0 ? 1.98 : 0);
          text = multiplier ? 'Field hits on ' + total + ' for ' + shortMult(multiplier) + '.' : 'Field misses on ' + total + '.';
        } else if (total === 7 || total === 11) {
          multiplier = pick === 'pass' ? 1.98 : 0;
          text = (pick === 'pass' ? 'Pass line wins' : 'Don’t pass loses') + ' on come-out ' + total + '.';
        } else if (total === 2 || total === 3 || total === 12) {
          multiplier = pick === 'dont' && total !== 12 ? 1.98 : (pick === 'dont' && total === 12 ? 1 : 0);
          text = multiplier === 1 ? 'Don’t pass push on 12.' : (multiplier ? 'Don’t pass wins on ' + total + '.' : 'Pass line loses on ' + total + '.');
        } else {
          var point = total;
          for (var offset = 2; offset < floats.length - 1; offset += 2) {
            total = nextRoll(offset);
            if (total === point || total === 7) break;
          }
          var passWins = total === point;
          multiplier = pick === 'pass' ? (passWins ? 1.98 : 0) : (passWins ? 0 : 1.98);
          text = 'Point ' + point + ', rolled ' + total + '. ' + (multiplier ? 'Ticket wins.' : 'Ticket loses.');
        }
        return { html: renderDiceStrip(rolls[rolls.length - 1]) + '<div class="ostg-world-note">Roll path: ' + rolls.map(function(pair) { return pair[0] + '+' + pair[1]; }).join(' → ') + '</div>', payout: amount * multiplier, multiplier: multiplier, text: text };
      }
    });
  }

  function renderSicBo(stage) {
    renderQuickCasino(stage, {
      id: 'sicbo', meta: 'Three dice', button: 'Shake dice', optionLabel: 'Bet',
      options: [{ value: 'small', label: 'Small 4-10' }, { value: 'big', label: 'Big 11-17' }, { value: 'anytriple', label: 'Any triple 30x' }, { value: 'triple6', label: 'Triple six 150x' }, { value: 'total12', label: 'Total 12 · 6x' }],
      idle: renderDiceStrip([1, 2, 3]), status: 'Sic Bo rolls three dice. Triples cancel small/big.',
      resolve: async function(amount, pick) {
        var floats = await pfFloats(3);
        var dice = floats.map(rollDie);
        var total = dice[0] + dice[1] + dice[2];
        var triple = dice[0] === dice[1] && dice[1] === dice[2];
        var multiplier = 0;
        if (pick === 'small') multiplier = !triple && total >= 4 && total <= 10 ? 1.98 : 0;
        if (pick === 'big') multiplier = !triple && total >= 11 && total <= 17 ? 1.98 : 0;
        if (pick === 'anytriple') multiplier = triple ? 30 : 0;
        if (pick === 'triple6') multiplier = dice[0] === 6 && triple ? 150 : 0;
        if (pick === 'total12') multiplier = total === 12 ? 6 : 0;
        return { html: renderDiceStrip(dice) + '<div class="ostg-world-note">Total ' + total + (triple ? ' · triple' : '') + '</div>', payout: amount * multiplier, multiplier: multiplier, text: multiplier ? 'Sic Bo paid ' + shortMult(multiplier) + '.' : 'Sic Bo missed on total ' + total + '.' };
      }
    });
  }

  function renderDragonTiger(stage) {
    renderQuickCasino(stage, {
      id: 'dragontiger', meta: 'Asia classic', button: 'Deal', optionLabel: 'Side',
      options: [{ value: 'dragon', label: 'Dragon' }, { value: 'tiger', label: 'Tiger' }, { value: 'tie', label: 'Tie 8x' }],
      idle: '<div class="ostg-versus">Dragon vs Tiger</div>', status: 'Two cards. Higher card wins; tie pays big.',
      resolve: async function(amount, pick) {
        var deck = createCardDeck(await pfFloats(52));
        var dragon = deck.pop(), tiger = deck.pop();
        var winner = cardRankValue(dragon) > cardRankValue(tiger) ? 'dragon' : cardRankValue(tiger) > cardRankValue(dragon) ? 'tiger' : 'tie';
        var multiplier = pick === winner ? (winner === 'tie' ? 8 : 1.98) : 0;
        return { html: '<div class="ostg-split-hands"><div><b>Dragon</b>' + renderCardStrip([dragon]) + '</div><div><b>Tiger</b>' + renderCardStrip([tiger]) + '</div></div>', payout: amount * multiplier, multiplier: multiplier, text: winner.toUpperCase() + ' wins. ' + (multiplier ? 'Paid ' + shortMult(multiplier) + '.' : 'Ticket lost.') };
      }
    });
  }

  function renderAndarBahar(stage) {
    renderQuickCasino(stage, {
      id: 'andarbahar', meta: 'India classic', button: 'Deal sides', optionLabel: 'Side',
      options: [{ value: 'andar', label: 'Andar' }, { value: 'bahar', label: 'Bahar' }],
      idle: '<div class="ostg-versus">Andar / Bahar</div>', status: 'A joker rank is drawn, then sides alternate until the rank appears.',
      resolve: async function(amount, pick) {
        var deck = createCardDeck(await pfFloats(52));
        var joker = deck.pop();
        var side = 'andar';
        var trail = [];
        while (deck.length) {
          var card = deck.pop();
          trail.push({ side: side, card: card });
          if (card.rank === joker.rank) break;
          side = side === 'andar' ? 'bahar' : 'andar';
        }
        var multiplier = pick === side ? 1.95 : 0;
        return { html: '<div class="ostg-world-note">Joker rank</div>' + renderCardStrip([joker]) + '<div class="ostg-world-note">Match landed on ' + side.toUpperCase() + ' after ' + trail.length + ' cards</div>' + renderCardStrip(trail.slice(-6).map(function(item) { return item.card; })), payout: amount * multiplier, multiplier: multiplier, text: side.toUpperCase() + ' hits. ' + (multiplier ? 'Paid ' + shortMult(multiplier) + '.' : 'Ticket lost.') };
      }
    });
  }

  function renderTeenPatti(stage) {
    renderQuickCasino(stage, {
      id: 'teenpatti', meta: 'Three cards', button: 'Deal', optionLabel: 'Back',
      options: [{ value: 'player', label: 'Player' }, { value: 'dealer', label: 'Dealer' }, { value: 'tie', label: 'Tie 8x' }],
      idle: '<div class="ostg-versus">Teen Patti</div>', status: 'Three-card hands. Trail, pure sequence, sequence, color, pair, high card.',
      resolve: async function(amount, pick) {
        var deck = createCardDeck(await pfFloats(52));
        var player = [deck.pop(), deck.pop(), deck.pop()];
        var dealer = [deck.pop(), deck.pop(), deck.pop()];
        var ps = scoreThreeCardPoker(player), ds = scoreThreeCardPoker(dealer);
        var winner = comparePokerScores(ps, ds) > 0 ? 'player' : comparePokerScores(ps, ds) < 0 ? 'dealer' : 'tie';
        var multiplier = pick === winner ? (winner === 'tie' ? 8 : 1.98) : 0;
        return { html: '<div class="ostg-split-hands"><div><b>Player · ' + ps.label + '</b>' + renderCardStrip(player) + '</div><div><b>Dealer · ' + ds.label + '</b>' + renderCardStrip(dealer) + '</div></div>', payout: amount * multiplier, multiplier: multiplier, text: winner.toUpperCase() + ' wins Teen Patti. ' + (multiplier ? 'Paid ' + shortMult(multiplier) + '.' : 'Ticket lost.') };
      }
    });
  }

  function renderThreeCardPoker(stage) {
    renderQuickCasino(stage, {
      id: 'threecard', meta: 'Poker table', button: 'Deal', optionLabel: 'Bet',
      options: [{ value: 'ante', label: 'Ante vs dealer' }, { value: 'pairplus', label: 'Pair Plus' }],
      idle: '<div class="ostg-versus">Three Card Poker</div>', status: 'Ante beats dealer. Pair Plus pays only your hand strength.',
      resolve: async function(amount, pick) {
        var deck = createCardDeck(await pfFloats(52));
        var player = [deck.pop(), deck.pop(), deck.pop()];
        var dealer = [deck.pop(), deck.pop(), deck.pop()];
        var ps = scoreThreeCardPoker(player), ds = scoreThreeCardPoker(dealer);
        var multiplier = 0;
        if (pick === 'ante') multiplier = comparePokerScores(ps, ds) >= 0 ? 1.98 : 0;
        else multiplier = ps.rank >= 5 ? 40 : ps.rank === 4 ? 30 : ps.rank === 3 ? 6 : ps.rank === 2 ? 3 : ps.rank === 1 ? 1.5 : 0;
        return { html: '<div class="ostg-split-hands"><div><b>You · ' + ps.label + '</b>' + renderCardStrip(player) + '</div><div><b>Dealer · ' + ds.label + '</b>' + renderCardStrip(dealer) + '</div></div>', payout: amount * multiplier, multiplier: multiplier, text: multiplier ? 'Three Card Poker paid ' + shortMult(multiplier) + '.' : 'No Three Card payout.' };
      }
    });
  }

  function renderCasinoWar(stage) {
    renderQuickCasino(stage, {
      id: 'war', meta: 'High card', button: 'Flip cards', optionLabel: 'Mode',
      options: [{ value: 'play', label: 'Player high card' }], idle: '<div class="ostg-versus">Casino War</div>', status: 'Your card against the dealer. Higher card wins; tie pushes.',
      resolve: async function(amount) {
        var deck = createCardDeck(await pfFloats(52));
        var player = deck.pop(), dealer = deck.pop();
        var cmp = cardRankValue(player) - cardRankValue(dealer);
        var multiplier = cmp > 0 ? 1.98 : cmp === 0 ? 1 : 0;
        return { html: '<div class="ostg-split-hands"><div><b>You</b>' + renderCardStrip([player]) + '</div><div><b>Dealer</b>' + renderCardStrip([dealer]) + '</div></div>', payout: amount * multiplier, multiplier: multiplier, text: cmp > 0 ? 'You win the war.' : cmp === 0 ? 'War tie. Bet returned.' : 'Dealer wins the war.' };
      }
    });
  }

  function renderRedDog(stage) {
    renderQuickCasino(stage, {
      id: 'reddog', meta: 'Spread cards', button: 'Draw third', optionLabel: 'Bet',
      options: [{ value: 'spread', label: 'Third card between' }], idle: '<div class="ostg-versus">Red Dog</div>', status: 'Two cards make a spread. Third card must land between them.',
      resolve: async function(amount) {
        var deck = createCardDeck(await pfFloats(52));
        var first = deck.pop(), second = deck.pop(), third = deck.pop();
        var low = Math.min(cardRankValue(first), cardRankValue(second));
        var high = Math.max(cardRankValue(first), cardRankValue(second));
        var spread = high - low - 1;
        var multiplier = 0;
        if (spread < 1) multiplier = cardRankValue(third) === high ? 11 : 1;
        else if (cardRankValue(third) > low && cardRankValue(third) < high) multiplier = spread === 1 ? 5 : spread === 2 ? 4 : spread === 3 ? 2 : 1.5;
        return { html: '<div class="ostg-world-note">Spread ' + Math.max(0, spread) + '</div>' + renderCardStrip([first, second, third]), payout: amount * multiplier, multiplier: multiplier, text: multiplier > 1 ? 'Red Dog hit the spread for ' + shortMult(multiplier) + '.' : multiplier === 1 ? 'Red Dog push. Bet returned.' : 'Third card missed the spread.' };
      }
    });
  }

  function renderPaiGow(stage) {
    renderQuickCasino(stage, {
      id: 'paigow', meta: 'Simplified split', button: 'Set hands', optionLabel: 'Side',
      options: [{ value: 'player', label: 'Player' }], idle: '<div class="ostg-versus">Pai Gow Poker</div>', status: 'Auto-split four cards: best two-card high and low hands must both beat dealer.',
      resolve: async function(amount) {
        var deck = createCardDeck(await pfFloats(52));
        var player = [deck.pop(), deck.pop(), deck.pop(), deck.pop()].sort(function(a, b) { return cardRankValue(b) - cardRankValue(a); });
        var dealer = [deck.pop(), deck.pop(), deck.pop(), deck.pop()].sort(function(a, b) { return cardRankValue(b) - cardRankValue(a); });
        var playerWinsHigh = cardRankValue(player[0]) > cardRankValue(dealer[0]);
        var playerWinsLow = cardRankValue(player[2]) > cardRankValue(dealer[2]);
        var multiplier = playerWinsHigh && playerWinsLow ? 1.95 : (playerWinsHigh || playerWinsLow ? 1 : 0);
        return { html: '<div class="ostg-split-hands"><div><b>You</b>' + renderCardStrip(player) + '</div><div><b>Dealer</b>' + renderCardStrip(dealer) + '</div></div>', payout: amount * multiplier, multiplier: multiplier, text: multiplier > 1 ? 'Both Pai Gow hands win.' : multiplier === 1 ? 'One hand each. Push.' : 'Dealer wins both hands.' };
      }
    });
  }

  function renderCaribbeanStud(stage) {
    renderQuickCasino(stage, {
      id: 'caribbean', meta: 'Stud poker', button: 'Deal stud', optionLabel: 'Bet',
      options: [{ value: 'ante', label: 'Ante' }], idle: '<div class="ostg-versus">Caribbean Stud</div>', status: 'Five-card stud against the dealer. Stronger player hands pay more.',
      resolve: async function(amount) {
        var deck = createCardDeck(await pfFloats(52));
        var player = [deck.pop(), deck.pop(), deck.pop(), deck.pop(), deck.pop()];
        var dealer = [deck.pop(), deck.pop(), deck.pop(), deck.pop(), deck.pop()];
        var ps = scoreFiveCardPoker(player), ds = scoreFiveCardPoker(dealer);
        var dealerQualifies = ds.rank > 0 || ds.main >= 13;
        var multiplier = !dealerQualifies ? 1 : (comparePokerScores(ps, ds) > 0 ? Math.max(1.98, [1,1.98,2,3,4,5,7,20,50,100][ps.rank] || 1.98) : 0);
        return { html: '<div class="ostg-split-hands"><div><b>You · ' + ps.label + '</b>' + renderCardStrip(player) + '</div><div><b>Dealer · ' + ds.label + '</b>' + renderCardStrip(dealer) + '</div></div>', payout: amount * multiplier, multiplier: multiplier, text: !dealerQualifies ? 'Dealer does not qualify. Ante returned.' : multiplier ? 'Caribbean Stud pays ' + shortMult(multiplier) + '.' : 'Dealer wins Caribbean Stud.' };
      }
    });
  }

  function renderBingo(stage) {
    renderQuickCasino(stage, {
      id: 'bingo', meta: '75-ball', button: 'Call numbers', optionLabel: 'Card',
      options: [{ value: 'quick', label: 'Quick card' }], idle: '<div class="ostg-versus">Bingo 75</div>', status: 'Quick card gets 15 numbers. Caller draws 30.',
      resolve: async function(amount) {
        var numbers = [];
        for (var number = 1; number <= 75; number++) numbers.push(number);
        var shuffled = shuffleWithFloats(numbers, await pfFloats(75));
        var card = shuffled.slice(0, 15).sort(function(a, b) { return a - b; });
        var drawn = shuffled.slice(15, 45);
        var hits = card.filter(function(number) { return drawn.indexOf(number) >= 0; }).length;
        var multiplier = hits >= 15 ? 500 : hits >= 12 ? 25 : hits >= 10 ? 5 : hits >= 8 ? 2 : hits >= 5 ? 1.2 : 0;
        return { html: '<div class="ostg-world-note">Hits ' + hits + '/15</div><div class="ostg-number-grid">' + card.map(function(number) { return '<span class="' + (drawn.indexOf(number) >= 0 ? 'is-hit' : '') + '">' + number + '</span>'; }).join('') + '</div>', payout: amount * multiplier, multiplier: multiplier, text: multiplier ? 'Bingo card paid ' + shortMult(multiplier) + '.' : 'Bingo missed this call.' };
      }
    });
  }

  function renderPachinko(stage) {
    renderQuickCasino(stage, {
      id: 'pachinko', meta: 'Japan peg board', button: 'Launch ball', optionLabel: 'Tray',
      options: [{ value: 'center', label: 'Center tray' }, { value: 'edge', label: 'Edge chase' }], idle: '<div class="ostg-versus">Pachinko</div>', status: 'Ball bounces through twelve pegs into a prize pocket.',
      resolve: async function(amount, pick) {
        var floats = await pfFloats(12);
        var bucket = 0;
        floats.forEach(function(value) { if (value >= 0.5) bucket++; });
        var centerTable = [25,8,3,1.5,0.6,0.3,0.2,0.3,0.6,1.5,3,8,25];
        var edgeTable = [60,15,5,1.2,0.4,0.2,0.2,0.2,0.4,1.2,5,15,60];
        var table = pick === 'edge' ? edgeTable : centerTable;
        var multiplier = table[bucket];
        return { html: '<div class="ostg-pachinko-lane">' + table.map(function(mult, index) { return '<span class="' + (index === bucket ? 'is-hit' : '') + '">' + shortMult(mult) + '</span>'; }).join('') + '</div>', payout: amount * multiplier, multiplier: multiplier, text: 'Pachinko landed pocket ' + bucket + ' for ' + shortMult(multiplier) + '.' };
      }
    });
  }

  function renderLucky7(stage) {
    renderQuickCasino(stage, {
      id: 'lucky7', meta: 'Two dice', button: 'Roll 7', optionLabel: 'Bet',
      options: [{ value: 'under', label: 'Under 7' }, { value: 'seven', label: 'Exactly 7 · 5.8x' }, { value: 'over', label: 'Over 7' }], idle: renderDiceStrip([3, 4]), status: 'Two dice. Pick under, over, or exactly seven.',
      resolve: async function(amount, pick) {
        var floats = await pfFloats(2);
        var dice = floats.map(rollDie);
        var total = dice[0] + dice[1];
        var multiplier = pick === 'seven' ? (total === 7 ? 5.8 : 0) : pick === 'under' ? (total < 7 ? 1.9 : 0) : (total > 7 ? 1.9 : 0);
        return { html: renderDiceStrip(dice) + '<div class="ostg-world-note">Total ' + total + '</div>', payout: amount * multiplier, multiplier: multiplier, text: multiplier ? 'Lucky 7 paid ' + shortMult(multiplier) + '.' : 'Lucky 7 missed.' };
      }
    });
  }

  function renderHoldem(stage) {
    renderQuickCasino(stage, {
      id: 'holdem', meta: 'Texas Hold’em', button: 'Deal board', optionLabel: 'Back',
      options: [{ value: 'player', label: 'Player' }, { value: 'dealer', label: 'Dealer' }], idle: '<div class="ostg-versus">Hold’em Flip</div>', status: 'Two hole cards each and a five-card board. Best seven-card poker hand wins.',
      resolve: async function(amount, pick) {
        var deck = createCardDeck(await pfFloats(52));
        var player = [deck.pop(), deck.pop()];
        var dealer = [deck.pop(), deck.pop()];
        var board = [deck.pop(), deck.pop(), deck.pop(), deck.pop(), deck.pop()];
        var ps = bestPokerScore(player.concat(board));
        var ds = bestPokerScore(dealer.concat(board));
        var winner = comparePokerScores(ps, ds) > 0 ? 'player' : comparePokerScores(ps, ds) < 0 ? 'dealer' : 'tie';
        var multiplier = winner === 'tie' ? 1 : (pick === winner ? 1.98 : 0);
        return { html: '<div class="ostg-world-note">Board</div>' + renderCardStrip(board) + '<div class="ostg-split-hands"><div><b>Player · ' + ps.label + '</b>' + renderCardStrip(player) + '</div><div><b>Dealer · ' + ds.label + '</b>' + renderCardStrip(dealer) + '</div></div>', payout: amount * multiplier, multiplier: multiplier, text: winner === 'tie' ? 'Hold’em tie. Bet returned.' : winner.toUpperCase() + ' wins Hold’em. ' + (multiplier ? 'Paid.' : 'Ticket lost.') };
      }
    });
  }

  function renderRaceBook(stage) {
    renderQuickCasino(stage, {
      id: 'race', meta: 'Virtual race', button: 'Start race', optionLabel: 'Runner',
      options: [{ value: '0', label: 'Rocket Red · 2.4x' }, { value: '1', label: 'Blue Nova · 3x' }, { value: '2', label: 'Gold Drift · 4x' }, { value: '3', label: 'Night Ace · 6x' }, { value: '4', label: 'Solar Queen · 8x' }, { value: '5', label: 'Longshot 12x' }],
      idle: '<div class="ostg-race-lanes"><span>Red</span><span>Blue</span><span>Gold</span><span>Night</span><span>Solar</span><span>Longshot</span></div>', status: 'Pick a runner. Lower-odds runners get a small speed edge; longshots can still break out.',
      resolve: async function(amount, pick) {
        var floats = await pfFloats(6);
        var odds = [2.4, 3, 4, 6, 8, 12];
        var scores = floats.map(function(value, index) { return value + (1 / odds[index]) * 0.18; });
        var winner = scores.indexOf(Math.max.apply(Math, scores));
        var multiplier = Number(pick) === winner ? odds[winner] : 0;
        return { html: '<div class="ostg-race-lanes">' + scores.map(function(score, index) { return '<span class="' + (index === winner ? 'is-hit' : '') + '">' + (index + 1) + ' · ' + Math.round(score * 100) + '</span>'; }).join('') + '</div>', payout: amount * multiplier, multiplier: multiplier, text: 'Runner ' + (winner + 1) + ' wins. ' + (multiplier ? 'Paid ' + shortMult(multiplier) + '.' : 'Ticket lost.') };
      }
    });
  }

  // ────────────────────────────────────────────────────────────────────────
  // FAIRNESS MODAL
  // ────────────────────────────────────────────────────────────────────────
  async function openFairness() {
    await ensureSeeds();
    var existing = document.getElementById('ostgFairModal');
    if (existing) existing.remove();
    var modal = document.createElement('div');
    modal.id = 'ostgFairModal';
    modal.className = 'ostg-modal';
    modal.innerHTML =
      '<div class="ostg-modal-card">' +
        '<button class="ostg-modal-close" id="ostgFairClose">×</button>' +
        '<h3>🔐 Provably-Fair Verification</h3>' +
        '<p style="opacity:0.78;font-size:13px;">Every outcome is <code>HMAC-SHA256(serverSeed, clientSeed:nonce:0)</code>. Before each round we publish a hash of the server seed; you can verify the seed after rotation matches the hash.</p>' +
        '<label>Server seed (hashed, revealed on rotate)</label>' +
        '<div class="ostg-mono" id="ostgSrvHash"></div>' +
        '<label>Client seed (you can edit)</label>' +
        '<input class="ostg-mono-input" id="ostgClientSeed">' +
        '<label>Nonce</label>' +
        '<div class="ostg-mono"><span id="ostgNonce"></span></div>' +
        '<div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap;">' +
          '<button class="ostg-btn" id="ostgRotate">Reveal & rotate server seed</button>' +
          '<button class="ostg-btn ostg-btn-primary" id="ostgSaveSeed">Save client seed</button>' +
        '</div>' +
        '<div class="ostg-mono" id="ostgRevealed" style="margin-top:10px;display:none;"></div>' +
      '</div>';
    document.body.appendChild(modal);
    document.getElementById('ostgSrvHash').textContent = pf.serverSeedHash;
    document.getElementById('ostgClientSeed').value = pf.clientSeed;
    document.getElementById('ostgNonce').textContent = String(pf.nonce);
    document.getElementById('ostgFairClose').addEventListener('click', function () { modal.remove(); });
    modal.addEventListener('click', function (e) { if (e.target === modal) modal.remove(); });
    document.getElementById('ostgRotate').addEventListener('click', async function () {
      var oldSeed = pf.serverSeed;
      await rotateServerSeed();
      var rev = document.getElementById('ostgRevealed');
      rev.style.display = '';
      rev.innerHTML = '<strong>Previous server seed (revealed):</strong><br>' + oldSeed +
        '<br><br>Verify: SHA-256 of that string should match the hash you saw before this rotation.';
      document.getElementById('ostgSrvHash').textContent = pf.serverSeedHash;
      document.getElementById('ostgNonce').textContent = '0';
    });
    document.getElementById('ostgSaveSeed').addEventListener('click', function () {
      var v = document.getElementById('ostgClientSeed').value.trim();
      if (!v) return;
      pf.clientSeed = v;
      var s = loadGames(); s.clientSeed = v; saveGames(s);
    });
  }

  // ────────────────────────────────────────────────────────────────────────
  // STYLES
  // ────────────────────────────────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('ostgStyle')) return;
    var st = document.createElement('style');
    st.id = 'ostgStyle';
    st.textContent =
      '.ostg-section{position:relative;padding:24px;border-radius:20px;background:linear-gradient(180deg,rgba(15,18,30,0.92),rgba(8,11,22,0.95));border:1px solid rgba(120,180,255,0.18);box-shadow:0 12px 40px rgba(0,0,0,0.45);}' +
      '.ostg-head{display:flex;justify-content:space-between;align-items:flex-start;gap:14px;flex-wrap:wrap;margin-bottom:16px;}' +
      '.ostg-section h3{margin:0 0 4px;color:#f8fafc;font-size:1.3rem;}' +
      '.ostg-sub{margin:0;color:#94a3b8;font-size:13px;line-height:1.5;}' +
      '.ostg-sub code{background:rgba(120,180,255,0.12);padding:1px 6px;border-radius:4px;color:#bfdbfe;font-size:12px;}' +
      '.ostg-balance-card{display:flex;flex-direction:column;align-items:flex-end;gap:4px;padding:10px 14px;border-radius:12px;background:rgba(245,196,104,0.1);border:1px solid rgba(245,196,104,0.3);}' +
      '.ostg-balance-label{color:#f5c468;font-size:11px;text-transform:uppercase;letter-spacing:.06em;font-weight:700;}' +
      '.ostg-balance-amt{color:#f8fafc;font-size:18px;font-weight:700;}' +
      '.ostg-balance-amt strong{color:#f5c468;}' +
      '.ostg-fair-btn{margin-top:4px;padding:4px 10px;border-radius:6px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.12);color:#cbd5e1;font-size:11px;cursor:pointer;}' +
      '.ostg-tabs{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:18px;border-bottom:1px solid rgba(255,255,255,0.08);padding-bottom:10px;}' +
      '.ostg-tab{padding:10px 18px;border-radius:10px 10px 0 0;background:transparent;border:none;color:#94a3b8;font-weight:600;cursor:pointer;font-size:14px;}' +
      '.ostg-tab.is-active{background:rgba(56,118,252,0.18);color:#bfdbfe;border-bottom:2px solid #38bdf8;}' +
      '.ostg-game{display:flex;flex-direction:column;gap:14px;}' +
      '.ostg-controls{display:flex;flex-wrap:wrap;align-items:flex-end;gap:10px;padding:14px;border-radius:12px;background:rgba(0,0,0,0.25);border:1px solid rgba(255,255,255,0.06);}' +
      '.ostg-controls label{display:flex;flex-direction:column;gap:4px;color:#94a3b8;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;}' +
      '.ostg-controls input,.ostg-controls select{padding:9px 12px;border-radius:8px;border:1px solid rgba(255,255,255,0.12);background:rgba(0,0,0,0.4);color:#f8fafc;font-size:14px;min-width:110px;}' +
      '.ostg-btn{padding:11px 18px;border-radius:10px;border:1px solid rgba(120,180,255,0.35);background:rgba(56,118,252,0.18);color:#bfdbfe;font-weight:700;cursor:pointer;font-size:13px;}' +
      '.ostg-btn:disabled{opacity:0.4;cursor:not-allowed;}' +
      '.ostg-btn-primary{background:linear-gradient(135deg,#3876fc,#1d4ed8);color:#fff;border-color:transparent;}' +
      '.ostg-btn-cash{background:linear-gradient(135deg,#f5c468,#f59e0b);color:#1a1a1a;border-color:transparent;}' +
      '.ostg-meta{display:flex;flex-direction:column;gap:2px;color:#94a3b8;font-size:11px;text-transform:uppercase;}' +
      '.ostg-meta strong{color:#f5c468;font-size:14px;text-transform:none;}' +
      '.ostg-board-5x5{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;max-width:480px;margin:0 auto;}' +
      '.ostg-tile{aspect-ratio:1;background:linear-gradient(135deg,#1e293b,#0f172a);border:1px solid rgba(120,180,255,0.18);border-radius:10px;font-size:24px;cursor:pointer;color:#f8fafc;transition:all .15s;}' +
      '.ostg-tile:hover:not(:disabled){background:linear-gradient(135deg,#334155,#1e293b);transform:scale(1.04);}' +
      '.ostg-tile.safe{background:linear-gradient(135deg,#16a34a,#15803d);border-color:#22c55e;}' +
      '.ostg-tile.mine{background:linear-gradient(135deg,#dc2626,#991b1b);border-color:#ef4444;animation:ostg-shake .4s;}' +
      '.ostg-tile.mine-reveal{background:rgba(220,38,38,0.25);border-color:rgba(220,38,38,0.5);opacity:0.7;}' +
      '@keyframes ostg-shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-4px)}75%{transform:translateX(4px)}}' +
      '.ostg-status{padding:10px 14px;border-radius:10px;background:rgba(0,0,0,0.25);color:#cbd5e1;font-size:13px;text-align:center;min-height:18px;}' +
      '.ostg-history{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:14px;padding:10px;border-radius:10px;background:rgba(0,0,0,0.2);}' +
      '.ostg-history-label{color:#94a3b8;font-size:11px;text-transform:uppercase;letter-spacing:.06em;font-weight:700;margin-right:4px;}' +
      '.ostg-mult-pill{padding:3px 10px;border-radius:999px;font-size:11px;font-weight:700;}' +
      '.ostg-mult-pill.win{background:rgba(34,197,94,0.18);color:#86efac;}' +
      '.ostg-mult-pill.soft{background:rgba(56,118,252,0.18);color:#bfdbfe;}' +
      '.ostg-mult-pill.loss{background:rgba(220,38,38,0.18);color:#fca5a5;}' +
      '.ostg-crash-stage{position:relative;border-radius:12px;overflow:hidden;background:radial-gradient(ellipse at bottom,#1e293b,#020617);border:1px solid rgba(255,255,255,0.06);}' +
      '.ostg-crash-stage canvas{display:block;width:100%;height:auto;max-height:320px;}' +
      '.ostg-crash-mult{position:absolute;top:14px;left:14px;font-size:2.2rem;font-weight:800;color:#f8fafc;text-shadow:0 0 20px rgba(245,196,104,0.5);font-variant-numeric:tabular-nums;}' +
      '.ostg-dice-bar{position:relative;height:24px;border-radius:12px;background:linear-gradient(90deg,#dc2626,#f59e0b,#22c55e);overflow:hidden;}' +
      '.ostg-dice-fill{position:absolute;top:0;bottom:0;background:rgba(56,118,252,0.55);border-right:2px solid #fff;}' +
      '.ostg-dice-marker{position:absolute;top:-4px;bottom:-4px;width:3px;background:#fff;box-shadow:0 0 10px #fff;}' +
      '.ostg-dice-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;padding:12px;border-radius:10px;background:rgba(0,0,0,0.25);text-align:center;}' +
      '.ostg-dice-stats span{display:block;color:#94a3b8;font-size:11px;text-transform:uppercase;}' +
      '.ostg-dice-stats strong{color:#f8fafc;font-size:1.15rem;font-weight:700;}' +
      '.ostg-dice-result{text-align:center;font-size:2.5rem;font-weight:800;color:#f8fafc;font-variant-numeric:tabular-nums;}' +
      '.ostg-plinko-stage canvas{display:block;width:100%;height:auto;max-height:380px;border-radius:12px;background:radial-gradient(ellipse at top,#1e293b,#020617);}' +
      '.ostg-plinko-mults{display:flex;gap:3px;overflow-x:auto;padding:6px 0;-webkit-overflow-scrolling:touch;}' +
      '.ostg-mult-cell{flex:0 0 auto;padding:6px 10px;border-radius:6px;font-size:11px;font-weight:700;background:rgba(0,0,0,0.3);color:#cbd5e1;}' +
      '.ostg-mult-cell.mid{background:rgba(245,196,104,0.18);color:#fde68a;}' +
      '.ostg-mult-cell.big{background:rgba(220,38,38,0.22);color:#fca5a5;}' +
      '.ostg-modal{position:fixed;inset:0;background:rgba(2,6,16,0.85);backdrop-filter:blur(10px);z-index:10000;display:flex;align-items:center;justify-content:center;padding:20px;}' +
      '.ostg-modal-card{background:#0f131e;border:1px solid rgba(120,180,255,0.25);border-radius:18px;padding:22px;max-width:520px;width:100%;max-height:90vh;overflow-y:auto;position:relative;}' +
      '.ostg-modal-close{position:absolute;top:10px;right:14px;background:transparent;border:none;color:#94a3b8;font-size:1.5rem;cursor:pointer;}' +
      '.ostg-modal label{display:block;color:#94a3b8;font-size:11px;text-transform:uppercase;letter-spacing:.04em;margin:10px 0 4px;}' +
      '.ostg-mono{font-family:ui-monospace,Menlo,monospace;font-size:11px;background:rgba(0,0,0,0.4);padding:8px;border-radius:6px;color:#bfdbfe;word-break:break-all;}' +
      '.ostg-mono-input{font-family:ui-monospace,Menlo,monospace;font-size:12px;width:100%;padding:8px;border-radius:6px;background:rgba(0,0,0,0.4);border:1px solid rgba(255,255,255,0.12);color:#bfdbfe;}' +
      '@media (max-width:640px){.ostg-controls label{flex:1 1 100%;}.ostg-controls input,.ostg-controls select{width:100%;}.ostg-balance-card{align-items:flex-start;width:100%;}.ostg-tab{flex:1 1 calc(50% - 4px);text-align:center;}.ostg-crash-mult{font-size:1.6rem;}}' +
      // ── New games shipped 2026-04-28 ────────────────────────────────────
      '.ostg-balance-actions{display:flex;gap:6px;margin-top:6px;flex-wrap:wrap;}' +
      '.ostg-cash-btn{padding:6px 12px;border-radius:8px;background:linear-gradient(135deg,#22c55e,#15803d);border:none;color:#fff;font-weight:700;font-size:12px;cursor:pointer;box-shadow:0 4px 12px rgba(34,197,94,0.35);}' +
      '.ostg-cash-btn:disabled{opacity:0.4;cursor:not-allowed;box-shadow:none;}' +
      '.ostg-deposit-btn{padding:6px 12px;border-radius:8px;background:linear-gradient(135deg,#3876fc,#1d4ed8);border:none;color:#fff;font-weight:700;font-size:12px;cursor:pointer;box-shadow:0 4px 12px rgba(56,118,252,0.35);}' +
      '.ostg-deposit-btn:disabled{opacity:0.4;cursor:not-allowed;box-shadow:none;}' +
      '.ostg-wallet-line{display:flex;align-items:center;gap:6px;font-size:11px;color:#cbd5e1;margin-top:4px;}' +
      '.ostg-wallet-line code{background:rgba(0,0,0,0.4);padding:1px 6px;border-radius:4px;font-size:10px;color:#bfdbfe;}' +
      '.ostg-wallet-line strong{color:#f5c468;}' +
      '.ostg-wallet-dot{width:8px;height:8px;border-radius:50%;background:#64748b;flex:0 0 auto;}' +
      '.ostg-wallet-dot[data-state="on"]{background:#22c55e;box-shadow:0 0 8px #22c55e;}' +
      '.ostg-tabs{overflow-x:auto;-webkit-overflow-scrolling:touch;flex-wrap:nowrap;}' +
      '.ostg-tab{flex:0 0 auto;white-space:nowrap;}' +
      // Limbo
      '.ostg-limbo-stage{display:flex;align-items:center;justify-content:center;min-height:220px;border-radius:12px;background:radial-gradient(ellipse at center,#1e293b,#020617);border:1px solid rgba(255,255,255,0.06);}' +
      '.ostg-limbo-mult{font-size:4rem;font-weight:800;color:#f8fafc;font-variant-numeric:tabular-nums;text-shadow:0 0 30px rgba(245,196,104,0.45);transition:color .3s;}' +
      // Hi-Lo
      '.ostg-hilo-stage{display:flex;flex-direction:column;align-items:center;gap:14px;padding:16px;border-radius:12px;background:radial-gradient(ellipse at top,#1e293b,#020617);}' +
      '.ostg-card{width:120px;height:170px;border-radius:12px;background:linear-gradient(135deg,#fef3c7,#fde68a);color:#1a1a1a;display:flex;align-items:center;justify-content:center;font-size:3.5rem;font-weight:800;box-shadow:0 8px 24px rgba(0,0,0,0.4);font-family:Georgia,serif;}' +
      '.ostg-hilo-actions{display:flex;gap:10px;}' +
      // Wheel
      '.ostg-wheel-stage{position:relative;display:flex;justify-content:center;}' +
      '.ostg-wheel-stage canvas{display:block;max-width:100%;height:auto;}' +
      '.ostg-wheel-pin{position:absolute;top:-2px;left:50%;transform:translateX(-50%);width:0;height:0;border-left:14px solid transparent;border-right:14px solid transparent;border-top:22px solid #f5c468;z-index:2;filter:drop-shadow(0 2px 4px rgba(0,0,0,0.5));}' +
      // Coinflip
      '.ostg-coin-stage{display:flex;justify-content:center;padding:24px;}' +
      '.ostg-coin-disk{width:120px;height:120px;border-radius:50%;background:linear-gradient(135deg,#f5c468,#b45309);display:flex;align-items:center;justify-content:center;font-size:4rem;color:#1a1a1a;box-shadow:0 12px 32px rgba(245,196,104,0.4),inset 0 -4px 12px rgba(0,0,0,0.3);transform-style:preserve-3d;}' +
      '.ostg-coin-disk.flip-h{animation:ostg-coin-flip-h .7s ease-out;}' +
      '.ostg-coin-disk.flip-t{animation:ostg-coin-flip-t .7s ease-out;}' +
      '@keyframes ostg-coin-flip-h{0%{transform:rotateY(0)}100%{transform:rotateY(1080deg)}}' +
      '@keyframes ostg-coin-flip-t{0%{transform:rotateY(0)}100%{transform:rotateY(900deg)}}' +
      // Shared feel layer
      '.ostg-stage,.ostg-board,.ostg-crash-stage,.ostg-plinko-stage,.ostg-limbo-stage,.ostg-hilo-stage,.ostg-wheel-stage,.ostg-coin-stage{position:relative;}' +
      '.ostg-toast{position:absolute;right:18px;top:84px;z-index:6;transform:translateY(-8px);opacity:0;pointer-events:none;padding:9px 12px;border-radius:10px;font-size:12px;font-weight:800;letter-spacing:.01em;box-shadow:0 10px 24px rgba(0,0,0,.35);transition:opacity .22s,transform .22s;}' +
      '.ostg-toast.show{opacity:1;transform:translateY(0);}' +
      '.ostg-toast.win{background:rgba(34,197,94,.95);color:#052e16;}' +
      '.ostg-toast.loss{background:rgba(220,38,38,.95);color:#fff;}' +
      '.ostg-toast.soft{background:rgba(245,196,104,.95);color:#1f1300;}' +
      '.ostg-spark{position:absolute;width:7px;height:7px;border-radius:2px;background:hsl(var(--h),85%,62%);z-index:5;pointer-events:none;animation:ostg-spark .9s ease-out forwards;}' +
      '@keyframes ostg-spark{0%{opacity:1;transform:translate(0,0) scale(1) rotate(0)}100%{opacity:0;transform:translate(var(--dx),var(--dy)) scale(.25) rotate(260deg)}}' +
      '.ostg-tile span{display:inline-block;}' +
      '.ostg-tile-pop span{animation:ostg-pop .34s cubic-bezier(.2,1.6,.4,1);}' +
      '.ostg-pop-win{animation:ostg-pop-win .42s cubic-bezier(.2,1.6,.4,1);}' +
      '.ostg-pop-loss{animation:ostg-pop-loss .42s cubic-bezier(.2,1.6,.4,1);}' +
      '@keyframes ostg-pop{0%{transform:scale(.4)}70%{transform:scale(1.22)}100%{transform:scale(1)}}' +
      '@keyframes ostg-pop-win{0%{transform:scale(.86);text-shadow:none}60%{transform:scale(1.12);text-shadow:0 0 22px rgba(34,197,94,.8)}100%{transform:scale(1)}}' +
      '@keyframes ostg-pop-loss{0%,100%{transform:translateX(0)}20%{transform:translateX(-6px)}40%{transform:translateX(6px)}60%{transform:translateX(-3px)}80%{transform:translateX(3px)}}' +
      '.ostg-limbo-mult.is-win{color:#86efac;text-shadow:0 0 28px rgba(34,197,94,.72);}' +
      '.ostg-limbo-mult.is-loss{color:#fca5a5;text-shadow:0 0 24px rgba(220,38,38,.62);}' +
      '.ostg-card-flip{animation:ostg-card-flip .38s ease-out;}' +
      '@keyframes ostg-card-flip{0%{transform:rotateY(90deg) translateY(8px)}100%{transform:rotateY(0) translateY(0)}}' +
      '.ostg-pin-bounce{animation:ostg-pin-bounce .45s ease-in-out infinite alternate;}' +
      '.ostg-pin-hit{animation:ostg-pin-hit .5s ease-out;}' +
      '@keyframes ostg-pin-bounce{0%{transform:translateX(-50%) translateY(0)}100%{transform:translateX(-50%) translateY(8px)}}' +
      '@keyframes ostg-pin-hit{0%{transform:translateX(-50%) scale(1)}50%{transform:translateX(-50%) scale(1.22)}100%{transform:translateX(-50%) scale(1)}}' +
      '.ostg-keno-grid{display:grid;grid-template-columns:repeat(8,minmax(0,1fr));gap:7px;padding:12px;border-radius:14px;background:radial-gradient(circle at top,rgba(56,118,252,.14),rgba(2,6,16,.42));border:1px solid rgba(255,255,255,.07);}' +
      '.ostg-keno-cell{aspect-ratio:1;border-radius:999px;background:linear-gradient(135deg,#1e293b,#0f172a);border:1px solid rgba(148,163,184,.2);color:#dbeafe;font-weight:800;font-size:12px;box-shadow:inset 0 -6px 14px rgba(0,0,0,.24);transition:transform .15s,background .15s,border-color .15s;}' +
      '.ostg-keno-cell:hover:not(:disabled){transform:translateY(-2px);border-color:#60a5fa;}' +
      '.ostg-keno-cell.is-selected{background:linear-gradient(135deg,#2563eb,#7c3aed);border-color:#bfdbfe;color:#fff;box-shadow:0 0 18px rgba(96,165,250,.34);}' +
      '.ostg-keno-cell.is-drawn{background:linear-gradient(135deg,#334155,#111827);border-color:#f5c468;color:#fde68a;}' +
      '.ostg-keno-cell.is-hit{background:linear-gradient(135deg,#22c55e,#15803d);border-color:#86efac;color:#052e16;box-shadow:0 0 24px rgba(34,197,94,.48);}' +
      '.ostg-keno-pays{display:flex;gap:8px;flex-wrap:wrap;justify-content:center;color:#bfdbfe;font-size:12px;}' +
      '.ostg-keno-pays span{padding:6px 9px;border-radius:999px;background:rgba(56,118,252,.14);border:1px solid rgba(96,165,250,.18);}' +
      '.ostg-tower-board{display:flex;flex-direction:column;gap:7px;max-width:520px;margin:0 auto;padding:12px;border-radius:14px;background:linear-gradient(180deg,rgba(15,23,42,.82),rgba(2,6,23,.88));border:1px solid rgba(255,255,255,.07);}' +
      '.ostg-tower-row{display:grid;grid-template-columns:repeat(var(--tower-cols,4),minmax(0,1fr));gap:7px;opacity:.58;transition:opacity .18s,transform .18s;}' +
      '.ostg-tower-row.is-current{opacity:1;transform:scale(1.015);}' +
      '.ostg-tower-cell{height:44px;border-radius:10px;background:linear-gradient(135deg,#172033,#0f172a);border:1px solid rgba(148,163,184,.18);color:#93c5fd;font-size:18px;font-weight:900;transition:transform .16s,border-color .16s,background .16s;}' +
      '.ostg-tower-row.is-current .ostg-tower-cell:not(:disabled):hover{transform:translateY(-2px);border-color:#f5c468;}' +
      '.ostg-tower-cell.is-safe{background:linear-gradient(135deg,#16a34a,#065f46);border-color:#86efac;color:#dcfce7;}' +
      '.ostg-tower-cell.is-trap{background:linear-gradient(135deg,#dc2626,#7f1d1d);border-color:#fecaca;color:#fff;animation:ostg-shake .36s;}' +
      '.ostg-roulette-stage{position:relative;display:flex;justify-content:center;align-items:center;min-height:360px;border-radius:14px;background:radial-gradient(circle at center,rgba(245,196,104,.13),rgba(2,6,16,.88));overflow:hidden;border:1px solid rgba(255,255,255,.07);}' +
      '.ostg-roulette-stage canvas{display:block;max-width:100%;height:auto;}' +
      '.ostg-roulette-pointer{position:absolute;top:10px;left:50%;transform:translateX(-50%);width:0;height:0;border-left:13px solid transparent;border-right:13px solid transparent;border-top:24px solid #f5c468;z-index:3;filter:drop-shadow(0 2px 5px rgba(0,0,0,.55));}' +
      '.ostg-roulette-result{position:absolute;inset:auto auto 18px 50%;transform:translateX(-50%);min-width:62px;text-align:center;padding:7px 12px;border-radius:999px;background:rgba(2,6,16,.78);border:1px solid rgba(255,255,255,.16);font-size:24px;font-weight:900;color:#f8fafc;}' +
      '.ostg-roulette-result[data-color="red"]{color:#fecaca}.ostg-roulette-result[data-color="black"]{color:#cbd5e1}.ostg-roulette-result[data-color="green"]{color:#86efac}' +
      '.ostg-slot-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px;max-width:620px;margin:0 auto;padding:14px;border-radius:16px;background:linear-gradient(180deg,#111827,#020617);border:1px solid rgba(245,196,104,.22);box-shadow:inset 0 0 28px rgba(245,196,104,.06);}' +
      '.ostg-slot-cell{aspect-ratio:1.05;border-radius:12px;background:linear-gradient(180deg,#f8fafc,#cbd5e1);color:#111827;display:flex;align-items:center;justify-content:center;font-size:clamp(1.8rem,6vw,3.2rem);font-weight:900;box-shadow:inset 0 -8px 20px rgba(0,0,0,.18);}' +
      '.ostg-slot-cell.is-spinning{animation:ostg-slot-spin .42s linear infinite;color:transparent;text-shadow:0 0 18px rgba(255,255,255,.9);}' +
      '.ostg-slot-cell.is-hit{outline:3px solid #f5c468;box-shadow:0 0 24px rgba(245,196,104,.48),inset 0 -8px 20px rgba(0,0,0,.18);}' +
      '.ostg-slot-pays{text-align:center;color:#94a3b8;font-size:12px;}' +
      '@keyframes ostg-slot-spin{0%{transform:translateY(-3px)}50%{transform:translateY(3px)}100%{transform:translateY(-3px)}}' +
      '.ostg-table-stage{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;padding:16px;border-radius:14px;background:radial-gradient(circle at top,rgba(15,118,110,.16),rgba(2,6,23,.86));border:1px solid rgba(255,255,255,.07);}' +
      '.ostg-hand{min-height:190px;border-radius:12px;padding:14px;background:rgba(0,0,0,.24);border:1px solid rgba(255,255,255,.08);}' +
      '.ostg-hand>span{display:flex;justify-content:space-between;color:#cbd5e1;font-size:12px;text-transform:uppercase;letter-spacing:.05em;font-weight:800;margin-bottom:10px;}' +
      '.ostg-card-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;}' +
      '.ostg-play-card{width:64px;height:88px;border-radius:10px;background:linear-gradient(180deg,#f8fafc,#e2e8f0);color:#111827;display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:Georgia,serif;font-weight:900;font-size:22px;box-shadow:0 8px 18px rgba(0,0,0,.28);}' +
      '.ostg-play-card.is-red{color:#dc2626}.ostg-play-card em{font-style:normal;font-size:20px;line-height:1}' +
      '.ostg-scratch-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;max-width:520px;margin:0 auto;padding:14px;border-radius:16px;background:linear-gradient(135deg,rgba(88,28,135,.36),rgba(15,23,42,.86));border:1px solid rgba(216,180,254,.2);}' +
      '.ostg-scratch-tile{aspect-ratio:1.4;border-radius:12px;background:repeating-linear-gradient(135deg,#94a3b8 0,#94a3b8 8px,#64748b 8px,#64748b 16px);border:1px solid rgba(255,255,255,.2);color:#0f172a;font-weight:900;font-size:15px;text-transform:uppercase;letter-spacing:.03em;}' +
      '.ostg-scratch-tile.is-revealed{background:linear-gradient(135deg,#172033,#0f172a);color:#cbd5e1;text-transform:none;font-size:20px;}' +
      '.ostg-scratch-tile.is-soft{color:#fde68a;border-color:#f5c468}.ostg-scratch-tile.is-big{color:#86efac;border-color:#22c55e;box-shadow:0 0 22px rgba(34,197,94,.35)}.ostg-scratch-tile.is-zero{color:#94a3b8;}' +
      '.ostg-penalty-stage{padding:14px;border-radius:16px;background:linear-gradient(180deg,#14532d,#052e16);border:1px solid rgba(134,239,172,.18);transition:border-color .2s ease,box-shadow .2s ease;}' +
      '.ostg-penalty-stage[data-result="goal"]{border-color:rgba(34,197,94,.72);box-shadow:0 0 24px rgba(34,197,94,.2)}.ostg-penalty-stage[data-result="saved"]{border-color:rgba(96,165,250,.72);box-shadow:0 0 24px rgba(96,165,250,.2)}.ostg-penalty-stage[data-result="missed"]{border-color:rgba(245,158,11,.72);box-shadow:0 0 24px rgba(245,158,11,.18)}' +
      '.ostg-penalty-goal{position:relative;min-height:260px;border-radius:14px;overflow:hidden;background:linear-gradient(180deg,rgba(219,234,254,.18),rgba(21,128,61,.1));border:2px solid rgba(255,255,255,.42);}' +
      '.ostg-net-line{position:absolute;inset:18px 18px 92px;border:1px dashed rgba(255,255,255,.36);border-bottom:none;}' +
      '.ostg-keeper{position:absolute;left:50%;top:46%;transform:translate(-50%,-50%);font-size:42px;transition:left .42s cubic-bezier(.2,1.4,.3,1),top .42s cubic-bezier(.2,1.4,.3,1);z-index:2;}' +
      '.ostg-ball{position:absolute;left:50%;top:82%;transform:translate(-50%,-50%);width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:#f8fafc;color:#111827;font-size:18px;font-weight:900;box-shadow:0 6px 12px rgba(0,0,0,.35);transition:left .62s cubic-bezier(.2,1,.2,1),top .62s cubic-bezier(.2,1,.2,1);z-index:3;}' +
      '.ostg-keeper[data-side="left"]{left:24%;top:42%}.ostg-keeper[data-side="center"]{left:50%;top:48%}.ostg-keeper[data-side="right"]{left:76%;top:42%}.ostg-keeper[data-side="top"]{left:50%;top:22%}' +
      '.ostg-ball[data-side="left"]{left:24%;top:42%}.ostg-ball[data-side="center"]{left:50%;top:50%}.ostg-ball[data-side="right"]{left:76%;top:42%}.ostg-ball[data-side="top"]{left:50%;top:20%}' +
      '.ostg-ball[data-result="goal"][data-side="left"]{left:18%;top:18%}.ostg-ball[data-result="goal"][data-side="center"]{left:50%;top:24%}.ostg-ball[data-result="goal"][data-side="right"]{left:82%;top:18%}.ostg-ball[data-result="goal"][data-side="top"]{left:50%;top:12%}' +
      '.ostg-ball[data-result="saved"]{background:#dbeafe;color:#1e3a8a;box-shadow:0 0 22px rgba(96,165,250,.6)}.ostg-ball[data-result="missed"]{background:#fed7aa;color:#7c2d12;box-shadow:0 0 22px rgba(245,158,11,.55)}.ostg-keeper[data-result="save"]{filter:drop-shadow(0 0 14px rgba(96,165,250,.9))}.ostg-keeper[data-result="miss"]{opacity:.7;filter:grayscale(.2)}' +
      '.ostg-penalty-lanes{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-top:8px;color:#bbf7d0;font-size:11px;text-align:center;text-transform:uppercase;letter-spacing:.05em;font-weight:800;}' +
      '.ostg-world-stage{min-height:230px;border-radius:14px;background:radial-gradient(circle at top,rgba(56,118,252,.14),rgba(2,6,16,.86));border:1px solid rgba(255,255,255,.07);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:16px;text-align:center;overflow:auto;}' +
      '.ostg-versus{font-size:clamp(1.8rem,5vw,3.4rem);font-weight:900;color:#f8fafc;text-shadow:0 0 24px rgba(245,196,104,.32);}' +
      '.ostg-world-note{color:#cbd5e1;font-size:13px;font-weight:700;}' +
      '.ostg-dice-strip{display:flex;gap:10px;justify-content:center;align-items:center;font-size:clamp(2.4rem,8vw,4.2rem);line-height:1;}' +
      '.ostg-dice-strip span{filter:drop-shadow(0 10px 18px rgba(0,0,0,.35));}' +
      '.ostg-card-row-center{justify-content:center;}' +
      '.ostg-split-hands{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;width:100%;align-items:start;}' +
      '.ostg-split-hands>div{padding:10px;border-radius:12px;background:rgba(0,0,0,.24);border:1px solid rgba(255,255,255,.08);}' +
      '.ostg-split-hands b{display:block;color:#bfdbfe;font-size:12px;text-transform:uppercase;letter-spacing:.04em;margin-bottom:8px;}' +
      '.ostg-video-hand{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;padding:14px;border-radius:14px;background:radial-gradient(circle at top,rgba(15,118,110,.14),rgba(2,6,23,.86));border:1px solid rgba(255,255,255,.07);}' +
      '.ostg-hold-card{border:1px solid rgba(255,255,255,.16);border-radius:12px;background:rgba(0,0,0,.25);padding:8px;color:#cbd5e1;cursor:pointer;}' +
      '.ostg-hold-card.is-held{border-color:#f5c468;box-shadow:0 0 18px rgba(245,196,104,.28)}.ostg-hold-card small{display:block;margin-top:6px;font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:#94a3b8}.ostg-hold-card.is-held small{color:#fde68a}' +
      '.ostg-number-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:6px;max-width:420px;width:100%;}' +
      '.ostg-number-grid span,.ostg-pachinko-lane span,.ostg-race-lanes span{padding:7px 8px;border-radius:8px;background:rgba(15,23,42,.92);border:1px solid rgba(148,163,184,.18);color:#cbd5e1;font-weight:800;font-size:12px;}' +
      '.ostg-number-grid span.is-hit,.ostg-pachinko-lane span.is-hit,.ostg-race-lanes span.is-hit{background:linear-gradient(135deg,#22c55e,#15803d);color:#052e16;border-color:#86efac;box-shadow:0 0 18px rgba(34,197,94,.38);}' +
      '.ostg-pachinko-lane span.is-bust,.ostg-tome-row span.is-bust{background:linear-gradient(135deg,#dc2626,#7f1d1d);color:#fff;border-color:#fecaca;box-shadow:0 0 18px rgba(220,38,38,.42);animation:ostg-shake .36s;}' +
      '.ostg-pachinko-lane,.ostg-race-lanes{display:grid;grid-template-columns:repeat(auto-fit,minmax(72px,1fr));gap:6px;width:100%;}' +
      '.ostg-double-strip{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:6px;width:100%;max-width:680px;}' +
      '.ostg-double-strip span{padding:10px 8px;border-radius:9px;font-size:11px;font-weight:900;text-transform:uppercase;letter-spacing:.05em;border:1px solid rgba(255,255,255,.14);}' +
      '.ostg-double-strip .red{background:linear-gradient(135deg,#dc2626,#7f1d1d);color:#fee2e2}.ostg-double-strip .black{background:linear-gradient(135deg,#111827,#020617);color:#e5e7eb}.ostg-double-strip .green{background:linear-gradient(135deg,#16a34a,#065f46);color:#dcfce7}.ostg-double-strip .is-hit{outline:3px solid #f5c468;box-shadow:0 0 22px rgba(245,196,104,.5);}' +
      '.ostg-slide-meter{position:relative;width:100%;max-width:640px;height:64px;border-radius:16px;overflow:hidden;background:linear-gradient(90deg,#14532d,#1d4ed8,#7c2d12);border:1px solid rgba(255,255,255,.12);box-shadow:inset 0 0 24px rgba(0,0,0,.35);}' +
      '.ostg-slide-meter span{position:absolute;left:0;top:0;bottom:0;background:rgba(255,255,255,.22);border-right:2px solid #fff;}' +
      '.ostg-slide-meter strong{position:absolute;inset:0;z-index:2;display:flex;align-items:center;justify-content:center;color:#fff;font-size:clamp(1.6rem,6vw,3rem);font-weight:900;text-shadow:0 0 24px rgba(0,0,0,.65);}' +
      '.ostg-diamond-row,.ostg-tome-row{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;}' +
      '.ostg-diamond-row span,.ostg-tome-row span{width:68px;height:68px;border-radius:16px;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#172033,#0f172a);border:1px solid rgba(148,163,184,.2);font-size:2rem;box-shadow:inset 0 -8px 18px rgba(0,0,0,.25);}' +
      '.ostg-diamond-row span.is-hit,.ostg-tome-row span.is-hit{border-color:#86efac;background:linear-gradient(135deg,#14532d,#064e3b);box-shadow:0 0 20px rgba(34,197,94,.36),inset 0 -8px 18px rgba(0,0,0,.25);}' +
      '.ostg-case-row{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;}' +
      '.ostg-case-row span{display:flex;flex-direction:column;align-items:center;gap:3px;min-height:76px;padding:9px;border-radius:12px;background:linear-gradient(180deg,#172033,#0f172a);border:1px solid rgba(245,196,104,.18);color:#f8fafc;font-weight:800;}' +
      '.ostg-case-row b{margin:0;color:#fde68a;font-size:11px;}.ostg-case-row small{color:#bfdbfe;font-size:13px;font-weight:900;}' +
      '.ostg-scarab-grid{display:grid;grid-template-columns:repeat(3,minmax(0,92px));gap:10px;justify-content:center;}' +
      '.ostg-scarab-grid span{aspect-ratio:1;border-radius:14px;display:flex;align-items:center;justify-content:center;background:radial-gradient(circle at top,#334155,#0f172a);border:1px solid rgba(245,196,104,.16);font-size:2.2rem;box-shadow:inset 0 -10px 20px rgba(0,0,0,.24);}' +
      '.ostg-scarab-grid span.is-hit{border-color:#f5c468;box-shadow:0 0 22px rgba(245,196,104,.36),inset 0 -10px 20px rgba(0,0,0,.24);}' +
      '@media (max-width:640px){.ostg-keno-grid{grid-template-columns:repeat(5,minmax(0,1fr));}.ostg-table-stage{grid-template-columns:1fr}.ostg-slot-cell{font-size:1.8rem}.ostg-roulette-stage{min-height:300px}.ostg-penalty-goal{min-height:220px}}' +
      '@media (max-width:520px){.ostg-section{padding:16px}.ostg-limbo-mult{font-size:2.8rem}.ostg-dice-stats{grid-template-columns:1fr}.ostg-card{width:96px;height:136px;font-size:2.8rem}.ostg-toast{right:10px;top:74px}.ostg-split-hands{grid-template-columns:1fr}.ostg-play-card{width:52px;height:74px;font-size:18px}}' +
      '.ostg-section{--ostg-accent:#22c55e;--ostg-accent-2:#38bdf8;padding:18px;background:#07111f;background-image:linear-gradient(135deg,rgba(34,197,94,.14),transparent 28%),linear-gradient(225deg,rgba(251,113,133,.12),transparent 30%),linear-gradient(180deg,#111827,#050812 70%);border-color:rgba(255,255,255,.14);box-shadow:0 28px 90px rgba(0,0,0,.5),inset 0 1px 0 rgba(255,255,255,.08);overflow:hidden;}' +
      '.ostg-section:before{content:"";position:absolute;inset:0;pointer-events:none;background-image:linear-gradient(rgba(255,255,255,.035) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.028) 1px,transparent 1px);background-size:34px 34px;mask-image:linear-gradient(180deg,rgba(0,0,0,.72),transparent 82%);}' +
      '.ostg-casino-hero{position:relative;display:grid;grid-template-columns:minmax(260px,1.2fr) minmax(220px,.8fr) minmax(250px,auto);gap:16px;align-items:stretch;min-height:178px;margin-bottom:16px;padding:18px;border-radius:18px;background:linear-gradient(135deg,rgba(255,255,255,.1),rgba(255,255,255,.035));border:1px solid rgba(255,255,255,.14);box-shadow:inset 0 1px 0 rgba(255,255,255,.12);overflow:hidden;}' +
      '.ostg-casino-hero:after{content:"";position:absolute;left:0;right:0;bottom:0;height:4px;background:linear-gradient(90deg,var(--ostg-accent),var(--ostg-accent-2),#facc15,#fb7185);}' +
      '.ostg-hero-copy,.ostg-balance-card,.ostg-hero-scene{position:relative;z-index:1;}' +
      '.ostg-kicker{display:inline-flex;align-items:center;width:max-content;padding:5px 9px;border-radius:999px;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.18);color:#dbeafe;font-size:11px;font-weight:900;letter-spacing:.12em;}' +
      '.ostg-hero-copy h3{margin:10px 0 12px;font-size:clamp(2rem,4vw,3.8rem);line-height:.95;letter-spacing:0;color:#fff;text-shadow:0 10px 30px rgba(0,0,0,.45);}' +
      '.ostg-hero-stats{display:flex;gap:8px;flex-wrap:wrap;}' +
      '.ostg-hero-stats span{display:inline-flex;align-items:center;min-height:30px;padding:6px 10px;border-radius:10px;background:rgba(2,6,23,.58);border:1px solid rgba(255,255,255,.13);color:#e5e7eb;font-size:12px;font-weight:800;}' +
      '.ostg-hero-scene{min-height:142px;border-radius:16px;background:linear-gradient(135deg,rgba(2,6,23,.68),rgba(15,23,42,.34));border:1px solid rgba(255,255,255,.12);overflow:hidden;}' +
      '.ostg-hero-token,.ostg-hero-card{position:absolute;display:flex;align-items:center;justify-content:center;filter:drop-shadow(0 16px 20px rgba(0,0,0,.45));}' +
      '.ostg-hero-token{width:70px;height:70px;border-radius:18px;background:linear-gradient(145deg,var(--ostg-accent),var(--ostg-accent-2));font-size:2rem;box-shadow:inset 0 2px 0 rgba(255,255,255,.22),inset 0 -8px 18px rgba(0,0,0,.25);animation:ostg-hero-float 3.8s ease-in-out infinite;}' +
      '.ostg-hero-token.hero-a{left:18%;top:18%;}.ostg-hero-token.hero-b{right:15%;top:26%;animation-delay:-1.2s;}.ostg-hero-token.hero-c{left:44%;bottom:14%;animation-delay:-2s;}' +
      '.ostg-hero-card{width:56px;height:76px;border-radius:12px;background:linear-gradient(180deg,#fff,#cbd5e1);color:#111827;font-weight:1000;font-size:1.9rem;transform:rotate(-14deg);}' +
      '.ostg-hero-card.card-a{left:8%;bottom:12%;}.ostg-hero-card.card-b{right:8%;bottom:10%;transform:rotate(15deg);color:var(--ostg-accent);}' +
      '@keyframes ostg-hero-float{0%,100%{transform:translateY(0) rotate(-3deg)}50%{transform:translateY(-12px) rotate(4deg)}}' +
      '.ostg-balance-card{align-self:stretch;justify-content:center;align-items:flex-start;min-width:250px;padding:16px;border-radius:16px;background:linear-gradient(180deg,rgba(250,204,21,.18),rgba(15,23,42,.54));border:1px solid rgba(250,204,21,.32);box-shadow:inset 0 1px 0 rgba(255,255,255,.12);}' +
      '.ostg-balance-amt{font-size:clamp(1.8rem,3vw,2.8rem);line-height:1;}.ostg-balance-actions{width:100%;}.ostg-balance-actions button{min-height:34px;}' +
      '.ostg-lobby-strip{position:relative;z-index:1;display:grid;grid-auto-flow:column;grid-auto-columns:minmax(176px,1fr);gap:10px;overflow-x:auto;padding:2px 2px 12px;margin-bottom:8px;scroll-snap-type:x mandatory;}' +
      '.ostg-lobby-game{scroll-snap-align:start;display:grid;grid-template-columns:auto 1fr;grid-template-rows:auto auto;align-items:center;gap:4px 10px;min-height:86px;padding:12px;border-radius:14px;background:linear-gradient(180deg,rgba(255,255,255,.08),rgba(255,255,255,.035));border:1px solid rgba(255,255,255,.12);color:#e5e7eb;text-align:left;cursor:pointer;transition:transform .16s ease,border-color .16s ease,background .16s ease;}' +
      '.ostg-lobby-game:hover,.ostg-lobby-game.is-active{transform:translateY(-2px);border-color:var(--ostg-accent);background:linear-gradient(180deg,rgba(255,255,255,.14),rgba(255,255,255,.05));box-shadow:0 14px 34px rgba(0,0,0,.28);}' +
      '.ostg-lobby-icon{grid-row:1/3;width:46px;height:46px;border-radius:12px;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,var(--ostg-accent),var(--ostg-accent-2));font-size:1.35rem;box-shadow:inset 0 -8px 16px rgba(0,0,0,.2);}' +
      '.ostg-lobby-game b{display:block;color:#fff;font-size:14px;}.ostg-lobby-game em{display:block;color:#94a3b8;font-size:11px;font-style:normal;font-weight:700;}.ostg-lobby-game strong{grid-column:2;color:#fde68a;font-size:11px;text-transform:uppercase;letter-spacing:.06em;}' +
      '.ostg-tabs{position:relative;z-index:1;margin-bottom:12px;padding:8px;border:1px solid rgba(255,255,255,.1);border-radius:14px;background:rgba(2,6,23,.42);}' +
      '.ostg-tab{border-radius:10px;padding:9px 13px;background:rgba(255,255,255,.04);border:1px solid transparent;color:#cbd5e1;}.ostg-tab:hover{background:rgba(255,255,255,.08);}.ostg-tab.is-active{background:linear-gradient(135deg,var(--ostg-accent),var(--ostg-accent-2));color:#031018;border-color:rgba(255,255,255,.28);box-shadow:0 8px 22px rgba(0,0,0,.3);}' +
      '.ostg-stage{position:relative;z-index:1;border-radius:18px;padding:12px;background:linear-gradient(180deg,rgba(255,255,255,.06),rgba(255,255,255,.025));border:1px solid rgba(255,255,255,.09);}' +
      '.ostg-game{border-radius:16px;padding:14px;background:linear-gradient(180deg,rgba(15,23,42,.68),rgba(2,6,23,.82));border:1px solid rgba(255,255,255,.1);box-shadow:inset 0 1px 0 rgba(255,255,255,.07);}' +
      '.ostg-game-hero{display:grid;grid-template-columns:auto 1fr auto;gap:14px;align-items:center;min-height:106px;padding:14px;border-radius:14px;background:linear-gradient(135deg,color-mix(in srgb,var(--ostg-accent) 24%,transparent),rgba(2,6,23,.42));border:1px solid color-mix(in srgb,var(--ostg-accent) 36%,transparent);overflow:hidden;}' +
      '.ostg-game-hero-art{position:relative;width:92px;height:76px;border-radius:18px;background:linear-gradient(135deg,var(--ostg-accent),var(--ostg-accent-2));display:flex;align-items:center;justify-content:center;font-size:2.5rem;box-shadow:inset 0 2px 0 rgba(255,255,255,.22),inset 0 -12px 24px rgba(0,0,0,.25);}' +
      '.ostg-game-hero-art span{animation:ostg-hero-float 3.2s ease-in-out infinite;}.ostg-game-hero-art i{position:absolute;width:10px;height:10px;border-radius:3px;background:#fff;opacity:.75;animation:ostg-chip-sweep 2.6s linear infinite;}.ostg-game-hero-art i:nth-child(2){left:12px;top:12px;animation-delay:-.7s}.ostg-game-hero-art i:nth-child(3){right:14px;top:20px;animation-delay:-1.4s}.ostg-game-hero-art i:nth-child(4){left:36px;bottom:14px;animation-delay:-2s}' +
      '@keyframes ostg-chip-sweep{0%{transform:translateY(0) rotate(0);opacity:.18}50%{opacity:.9}100%{transform:translateY(-18px) rotate(180deg);opacity:.18}}' +
      '.ostg-game-hero-text span{display:block;color:#bfdbfe;font-size:11px;text-transform:uppercase;letter-spacing:.12em;font-weight:900;}.ostg-game-hero-text h4{margin:3px 0 3px;color:#fff;font-size:clamp(1.5rem,3vw,2.4rem);letter-spacing:0;}.ostg-game-hero-text p{margin:0;color:#cbd5e1;font-size:13px;font-weight:700;}' +
      '.ostg-game-hero-mults{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;}.ostg-game-hero-mults b{min-width:44px;height:38px;border-radius:10px;display:flex;align-items:center;justify-content:center;background:rgba(2,6,23,.65);border:1px solid rgba(255,255,255,.14);color:#f8fafc;font-size:13px;}' +
      '.ostg-controls{border-radius:14px;background:rgba(2,6,23,.58);border-color:rgba(255,255,255,.12);box-shadow:inset 0 1px 0 rgba(255,255,255,.06);}.ostg-controls input,.ostg-controls select{min-height:40px;border-radius:10px;background:#050b17;border-color:rgba(255,255,255,.16);}.ostg-controls input:focus,.ostg-controls select:focus{outline:2px solid color-mix(in srgb,var(--ostg-accent) 65%,transparent);outline-offset:1px;}' +
      '.ostg-btn{min-height:40px;border-radius:10px;background:rgba(255,255,255,.07);border-color:rgba(255,255,255,.15);color:#e5e7eb;transition:transform .12s ease,filter .12s ease,box-shadow .12s ease;}.ostg-btn:hover:not(:disabled){transform:translateY(-1px);filter:brightness(1.08);box-shadow:0 10px 22px rgba(0,0,0,.24);}.ostg-btn-primary{background:linear-gradient(135deg,var(--ostg-accent),var(--ostg-accent-2));color:#031018;}.ostg-btn-cash{background:linear-gradient(135deg,#facc15,#fb923c);color:#1a1000;}' +
      '.ostg-bet-tools{display:flex;align-items:end;gap:6px;flex-wrap:wrap;min-width:min(100%,330px);}.ostg-bet-tools span{flex-basis:100%;color:#94a3b8;font-size:11px;font-weight:900;text-transform:uppercase;letter-spacing:.07em;}.ostg-bet-tools button{min-height:32px;padding:6px 10px;border-radius:999px;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.07);color:#e5e7eb;font-weight:900;cursor:pointer;}.ostg-bet-tools button:hover{background:linear-gradient(135deg,var(--ostg-accent),var(--ostg-accent-2));color:#031018;}' +
      '.ostg-status{border:1px solid rgba(255,255,255,.1);background:rgba(2,6,23,.62);font-weight:700;color:#e2e8f0;}' +
      '.ostg-board-5x5{max-width:560px;gap:10px;padding:12px;border-radius:16px;background:linear-gradient(135deg,rgba(34,197,94,.11),rgba(56,189,248,.08));border:1px solid rgba(255,255,255,.1);}.ostg-tile{border-radius:12px;background:linear-gradient(145deg,#26364f,#0b1220);box-shadow:inset 0 1px 0 rgba(255,255,255,.12),inset 0 -10px 20px rgba(0,0,0,.28),0 10px 24px rgba(0,0,0,.18);}.ostg-tile:hover:not(:disabled){transform:translateY(-3px) scale(1.03);border-color:var(--ostg-accent);}' +
      '.ostg-crash-stage,.ostg-plinko-stage,.ostg-limbo-stage,.ostg-hilo-stage,.ostg-wheel-stage,.ostg-coin-stage,.ostg-world-stage{border-radius:16px;border:1px solid rgba(255,255,255,.12);box-shadow:inset 0 1px 0 rgba(255,255,255,.08),0 18px 44px rgba(0,0,0,.24);}' +
      '.ostg-crash-stage{background:linear-gradient(180deg,#071324,#020617);}.ostg-crash-mult{padding:8px 12px;border-radius:12px;background:rgba(2,6,23,.58);border:1px solid rgba(255,255,255,.12);}' +
      '.ostg-dice-bar{height:36px;border:1px solid rgba(255,255,255,.18);box-shadow:inset 0 0 18px rgba(0,0,0,.32);}.ostg-dice-marker{width:5px;box-shadow:0 0 18px #fff,0 0 28px var(--ostg-accent);}.ostg-dice-result{font-size:clamp(3rem,8vw,5.6rem);text-shadow:0 0 32px color-mix(in srgb,var(--ostg-accent) 56%,transparent);}' +
      '.ostg-plinko-stage{background:linear-gradient(180deg,rgba(250,204,21,.11),rgba(2,6,23,.78));overflow:hidden;}.ostg-plinko-stage canvas{max-height:460px;}' +
      '.ostg-limbo-stage{min-height:280px;background:linear-gradient(135deg,rgba(167,139,250,.22),rgba(56,189,248,.08),rgba(2,6,23,.84));}.ostg-limbo-mult{font-size:clamp(4rem,12vw,7rem);}' +
      '.ostg-hilo-stage{background:linear-gradient(135deg,rgba(251,113,133,.18),rgba(250,204,21,.1),rgba(2,6,23,.84));}.ostg-card{box-shadow:0 18px 42px rgba(0,0,0,.36),0 0 24px color-mix(in srgb,var(--ostg-accent) 24%,transparent);}' +
      '.ostg-wheel-stage{padding:12px;background:linear-gradient(135deg,rgba(251,113,133,.14),rgba(250,204,21,.09),rgba(2,6,23,.84));}.ostg-coin-stage{background:linear-gradient(135deg,rgba(250,204,21,.16),rgba(249,115,22,.1),rgba(2,6,23,.84));}' +
      '.ostg-keno-grid,.ostg-tower-board,.ostg-scratch-grid,.ostg-slot-grid,.ostg-table-stage,.ostg-video-hand,.ostg-world-stage{background-image:linear-gradient(135deg,color-mix(in srgb,var(--ostg-accent) 15%,transparent),rgba(2,6,23,.82));}' +
      '.ostg-world-stage.is-resolving{overflow:hidden;}.ostg-resolve-machine{position:relative;display:grid;gap:12px;place-items:center;min-width:min(100%,480px);padding:20px;border-radius:18px;background:rgba(2,6,23,.58);border:1px solid rgba(255,255,255,.14);}.ostg-resolve-machine strong{color:#fff;font-size:18px;letter-spacing:.04em;text-transform:uppercase;}.ostg-resolve-reels{display:grid;grid-template-columns:repeat(3,minmax(64px,1fr));gap:10px;width:min(100%,360px);}.ostg-resolve-reels span{height:82px;border-radius:14px;display:flex;align-items:center;justify-content:center;background:linear-gradient(180deg,#f8fafc,#cbd5e1);color:#111827;font-size:clamp(1.4rem,6vw,2.6rem);font-weight:1000;animation:ostg-reel-bounce .52s ease-in-out infinite;box-shadow:0 12px 24px rgba(0,0,0,.32);}.ostg-resolve-reels span:nth-child(2){animation-delay:.08s}.ostg-resolve-reels span:nth-child(3){animation-delay:.16s}.ostg-resolve-line{width:min(100%,420px);height:5px;border-radius:999px;background:linear-gradient(90deg,var(--ostg-accent),var(--ostg-accent-2),#facc15);animation:ostg-resolve-scan .76s ease-in-out infinite alternate;}' +
      '@keyframes ostg-reel-bounce{0%,100%{transform:translateY(0)}50%{transform:translateY(-10px)}}@keyframes ostg-resolve-scan{0%{transform:scaleX(.28);opacity:.55}100%{transform:scaleX(1);opacity:1}}' +
      '.ostg-stage{transition:opacity .18s ease,transform .18s ease,border-color .18s ease;}.ostg-stage:not(.is-loaded){opacity:.94}.ostg-game-loading{min-height:360px;border-radius:18px;display:grid;grid-template-columns:minmax(220px,.72fr) 1fr;gap:18px;align-items:center;padding:18px;background:radial-gradient(circle at 24% 18%,color-mix(in srgb,var(--ostg-accent) 28%,transparent),transparent 34%),linear-gradient(135deg,rgba(2,6,23,.84),rgba(15,23,42,.72));border:1px solid color-mix(in srgb,var(--ostg-accent) 32%,rgba(255,255,255,.14));overflow:hidden;}' +
      '.ostg-loader-cabinet{position:relative;min-height:230px;border-radius:18px;background:linear-gradient(180deg,rgba(255,255,255,.09),rgba(255,255,255,.025));border:1px solid rgba(255,255,255,.14);display:grid;place-items:center;box-shadow:inset 0 1px 0 rgba(255,255,255,.1),0 18px 42px rgba(0,0,0,.28);overflow:hidden;}' +
      '.ostg-loader-reels{display:grid;grid-template-columns:repeat(3,minmax(58px,1fr));gap:10px;width:min(100%,310px);padding:14px;}.ostg-loader-reels span{height:92px;border-radius:16px;display:flex;align-items:center;justify-content:center;background:linear-gradient(180deg,#f8fafc,#cbd5e1);color:#111827;font-size:2.3rem;font-weight:1000;box-shadow:0 12px 24px rgba(0,0,0,.32);animation:ostg-loader-reel .64s cubic-bezier(.4,0,.2,1) infinite;}.ostg-loader-reels span:nth-child(2){animation-delay:.08s}.ostg-loader-reels span:nth-child(3){animation-delay:.16s}' +
      '.ostg-loader-scan{position:absolute;left:10%;right:10%;bottom:22px;height:6px;border-radius:999px;background:linear-gradient(90deg,var(--ostg-accent),var(--ostg-accent-2),#facc15);animation:ostg-resolve-scan .72s ease-in-out infinite alternate;}.ostg-loader-copy{display:grid;gap:8px;align-content:center;}.ostg-loader-copy span{width:max-content;max-width:100%;padding:5px 9px;border-radius:999px;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.16);color:#bfdbfe;font-size:11px;font-weight:1000;text-transform:uppercase;letter-spacing:.12em;}.ostg-loader-copy strong{color:#fff;font-size:clamp(2rem,5vw,4.4rem);line-height:.94;}.ostg-loader-copy em{font-style:normal;color:#e5e7eb;font-weight:800;}' +
      '@keyframes ostg-loader-reel{0%,100%{transform:translateY(0) rotateX(0)}50%{transform:translateY(-12px) rotateX(18deg)}}' +
      '.ostg-game-hud{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-top:-6px;}.ostg-game-hud div,.ostg-ticket-preview span{padding:10px;border-radius:12px;background:rgba(2,6,23,.58);border:1px solid rgba(255,255,255,.1);box-shadow:inset 0 1px 0 rgba(255,255,255,.05);}.ostg-game-hud span,.ostg-ticket-preview b{display:block;color:#94a3b8;font-size:10px;font-weight:1000;text-transform:uppercase;letter-spacing:.08em;}.ostg-game-hud strong,.ostg-ticket-preview strong{display:block;color:#fff;font-size:13px;font-weight:900;margin-top:3px;overflow-wrap:anywhere;}' +
      '.ostg-ticket-preview{display:grid;grid-template-columns:repeat(4,minmax(86px,1fr));gap:6px;flex:1 1 440px;align-self:stretch;}.ostg-ticket-preview span{min-height:44px;}.ostg-ticket-preview strong{color:#fde68a;}' +
      '.ostg-quick-idle{position:relative;width:100%;min-height:220px;display:grid;place-items:center;gap:12px;padding:14px;}.ostg-quick-core{position:relative;z-index:2;display:grid;place-items:center;min-height:92px;}.ostg-quick-orbit{position:absolute;inset:12px;pointer-events:none;}.ostg-quick-orbit span{position:absolute;width:58px;height:58px;border-radius:16px;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,var(--ostg-accent),var(--ostg-accent-2));box-shadow:inset 0 2px 0 rgba(255,255,255,.18),0 14px 30px rgba(0,0,0,.34);font-size:1.6rem;animation:ostg-quick-float 3.4s ease-in-out infinite;}.ostg-quick-orbit span:nth-child(1){left:8%;top:10%;}.ostg-quick-orbit span:nth-child(2){right:9%;top:18%;animation-delay:-1.1s}.ostg-quick-orbit span:nth-child(3){left:44%;bottom:4%;animation-delay:-2s}' +
      '.ostg-quick-rails{display:flex;gap:7px;flex-wrap:wrap;justify-content:center;position:relative;z-index:2;}.ostg-quick-rails span{padding:6px 9px;border-radius:999px;background:rgba(2,6,23,.65);border:1px solid rgba(255,255,255,.12);color:#cbd5e1;font-size:11px;font-weight:900;}.ostg-world-stage.is-win{border-color:rgba(34,197,94,.48);box-shadow:0 0 36px rgba(34,197,94,.18),inset 0 1px 0 rgba(255,255,255,.08);}.ostg-world-stage.is-soft{border-color:rgba(245,196,104,.48);box-shadow:0 0 34px rgba(245,196,104,.16),inset 0 1px 0 rgba(255,255,255,.08);}.ostg-world-stage.is-loss{border-color:rgba(248,113,113,.38);box-shadow:0 0 28px rgba(248,113,113,.12),inset 0 1px 0 rgba(255,255,255,.08);}' +
      '@keyframes ostg-quick-float{0%,100%{transform:translateY(0) rotate(-4deg)}50%{transform:translateY(-12px) rotate(5deg)}}' +
      '.ostg-history{position:relative;z-index:1;border:1px solid rgba(255,255,255,.1);background:rgba(2,6,23,.46);}.ostg-mult-pill{min-height:24px;display:inline-flex;align-items:center;}' +
      '@media (max-width:980px){.ostg-casino-hero{grid-template-columns:1fr 1fr}.ostg-balance-card{grid-column:1/-1}.ostg-hero-scene{min-height:132px}}' +
      '@media (max-width:700px){.ostg-casino-hero{grid-template-columns:1fr;padding:14px}.ostg-hero-scene{min-height:118px}.ostg-lobby-strip{grid-auto-columns:minmax(150px,78vw)}.ostg-game-hero{grid-template-columns:1fr}.ostg-game-hero-mults{justify-content:flex-start}.ostg-game-hero-art{width:82px;height:68px}.ostg-game-hud,.ostg-ticket-preview{grid-template-columns:repeat(2,minmax(0,1fr))}.ostg-game-loading{grid-template-columns:1fr;min-height:360px}.ostg-stage{padding:8px}.ostg-game{padding:10px}.ostg-bet-tools{width:100%}.ostg-bet-tools button{flex:1 1 58px}.ostg-resolve-reels{grid-template-columns:repeat(3,minmax(0,1fr))}}' +
      '@media (max-width:700px){#ostGames.ostg-section{padding:12px!important;border-radius:14px!important}.ostg-casino-hero{min-height:0!important;margin-bottom:10px!important;padding:12px!important;gap:10px!important;border-radius:14px!important}.ostg-hero-scene{display:none!important}.ostg-hero-copy h3{font-size:clamp(1.45rem,8vw,2.1rem)!important;line-height:1.05!important;margin:8px 0!important}.ostg-hero-stats span{min-height:26px;padding:5px 8px;font-size:11px}.ostg-balance-card{min-width:0!important;width:100%!important;padding:10px!important;border-radius:12px!important}.ostg-balance-amt{font-size:1.45rem!important}.ostg-balance-actions button{min-height:34px!important;padding:6px 9px!important;font-size:11px!important}.ostg-lobby-strip{grid-auto-columns:minmax(116px,46vw)!important;gap:7px!important;padding-bottom:8px!important}.ostg-lobby-game{min-height:62px!important;padding:8px!important;border-radius:11px!important}.ostg-lobby-icon{width:34px!important;height:34px!important;border-radius:9px!important;font-size:1rem!important}.ostg-lobby-game b{font-size:12px!important}.ostg-lobby-game em,.ostg-lobby-game strong{font-size:10px!important}.ostg-tabs{gap:6px!important;padding:6px!important;margin-bottom:8px!important;border-radius:12px!important}.ostg-tab{min-height:36px!important;padding:7px 9px!important;font-size:12px!important;border-radius:9px!important}.ostg-stage{padding:6px!important;border-radius:14px!important}.ostg-game{gap:9px!important;padding:8px!important;border-radius:13px!important}.ostg-game-hero{min-height:0!important;padding:9px!important;gap:8px!important;border-radius:12px!important}.ostg-game-hero-art,.ostg-game-hud{display:none!important}.ostg-game-hero-text h4{font-size:1.25rem!important;line-height:1.1!important}.ostg-game-hero-text p{font-size:11px!important}.ostg-game-hero-mults b{min-width:36px;height:32px;font-size:11px}.ostg-controls{padding:8px!important;gap:7px!important;border-radius:12px!important}.ostg-controls label{font-size:10px!important}.ostg-controls input,.ostg-controls select{min-height:36px!important;padding:7px 9px!important;font-size:13px!important}.ostg-btn{min-height:38px!important;padding:8px 10px!important;font-size:12px!important;border-radius:9px!important}.ostg-bet-tools{gap:5px!important}.ostg-bet-tools button{min-height:34px!important;padding:5px 8px!important;flex:1 1 48px!important;font-size:11px!important}.ostg-board-5x5{gap:6px!important;padding:8px!important;border-radius:12px!important}.ostg-tile{font-size:18px!important;border-radius:9px!important}.ostg-status{padding:8px 10px!important;font-size:12px!important}.ostg-limbo-stage{min-height:180px!important}.ostg-limbo-mult,.ostg-dice-result{font-size:2.5rem!important}.ostg-coin-stage{padding:12px!important}.ostg-coin-disk{width:84px!important;height:84px!important;font-size:2.6rem!important}.ostg-card{width:82px!important;height:116px!important;font-size:2.35rem!important}.ostg-game-loading{min-height:220px!important;padding:12px!important;gap:10px!important}.ostg-loader-cabinet{min-height:140px!important}.ostg-loader-reels span{height:62px!important;font-size:1.6rem!important}.ostg-quick-idle,.ostg-world-stage{min-height:170px!important}.ostg-quick-orbit{display:none!important}.ostg-diamond-row span,.ostg-tome-row span{width:54px!important;height:54px!important;font-size:1.45rem!important}.ostg-scarab-grid{grid-template-columns:repeat(3,minmax(0,68px))!important}.ostg-case-row span{min-height:62px!important;padding:7px!important}.ostg-history{gap:5px!important;padding:8px!important}}' +
      '@media (max-width:420px){#ostGames.ostg-section{padding:10px!important}.ostg-lobby-strip{grid-auto-columns:minmax(108px,55vw)!important}.ostg-tab{font-size:11px!important;padding:7px 8px!important}.ostg-game-hero-mults{display:none!important}.ostg-ticket-preview{grid-template-columns:1fr 1fr!important}.ostg-keno-grid{grid-template-columns:repeat(5,minmax(0,1fr))!important;gap:5px!important;padding:8px!important}.ostg-keno-cell,.ostg-tower-cell{font-size:11px!important}.ostg-tower-board{gap:5px!important;padding:8px!important}.ostg-double-strip{grid-template-columns:repeat(4,minmax(0,1fr))!important}.ostg-number-grid{grid-template-columns:repeat(4,minmax(0,1fr))!important}.ostg-dice-stats,.ostg-split-hands,.ostg-case-row{grid-template-columns:1fr!important}.ostg-plinko-stage canvas,.ostg-crash-stage canvas{max-height:240px!important}}';
    document.head.appendChild(st);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    setTimeout(mount, 200);
  }
})();

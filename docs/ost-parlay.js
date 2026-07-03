/* ==========================================================================
 * OST · Fast Parlay — combo bets on the 5-minute markets
 * --------------------------------------------------------------------------
 * Pick UP or DOWN on 2–3 coins (BTC / ETH / SOL) for the CURRENT 5-minute
 * round. Odds multiply; every leg must win. Settlement is deterministic:
 * each leg resolves against the same public Binance 5-minute candle the
 * single-coin fast markets use, so every player sees identical results.
 *
 * Money: stakes/payouts move through the canonical credits pool via
 * window.OST_MONEY (ost.faucet.hub.v2). Tickets live in ost.parlays.v1.
 * Fully self-contained: dock UI, odds, settlement, history.
 * ========================================================================== */
(function () {
  'use strict';

  var FIVE_MIN = 5 * 60 * 1000;
  var SLIPS_KEY = 'ost.parlays.v1';
  var LOCK_LAST_MS = 20000;   // no new bets in the final 20s of a round
  var MIN_LEGS = 2, MAX_LEGS = 3;
  var MIN_STAKE = 1, MAX_STAKE = 500;

  var COINS = {
    btc: { symbol: 'BTCUSDT', label: 'BTC', emoji: '₿' },
    eth: { symbol: 'ETHUSDT', label: 'ETH', emoji: 'Ξ' },
    sol: { symbol: 'SOLUSDT', label: 'SOL', emoji: '◎' }
  };

  // ------------------------------------------------------------- utilities
  function boundaries(now) {
    var t = now || Date.now();
    var openAt = Math.floor(t / FIVE_MIN) * FIVE_MIN;
    return { openAt: openAt, closeAt: openAt + FIVE_MIN };
  }

  function fetchJson(url, timeoutMs) {
    return new Promise(function (resolve, reject) {
      var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var timer = setTimeout(function () { if (ctrl) ctrl.abort(); reject(new Error('timeout')); }, timeoutMs || 4000);
      fetch(url, { cache: 'no-store', signal: ctrl ? ctrl.signal : undefined })
        .then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.json(); })
        .then(function (j) { clearTimeout(timer); resolve(j); })
        .catch(function (e) { clearTimeout(timer); reject(e); });
    });
  }

  function fetchKline(symbol, openAt) {
    var q = '?symbol=' + symbol + '&interval=5m&limit=1&startTime=' + openAt;
    var urls = [
      'https://api.binance.com/api/v3/klines' + q,
      'https://data-api.binance.vision/api/v3/klines' + q
    ];
    var i = 0;
    function next() {
      if (i >= urls.length) return Promise.resolve(null);
      return fetchJson(urls[i++], 4000).then(function (rows) {
        var row = Array.isArray(rows) && Array.isArray(rows[0]) ? rows[0] : null;
        if (!row || Number(row[0]) !== openAt) return next();
        return { open: Number(row[1]), close: Number(row[4]) };
      }).catch(next);
    }
    return next();
  }

  // Live YES odds per coin, reusing the running engines when present.
  function liveYesOdds(coinKey) {
    try {
      if (coinKey === 'btc' && window.OST_PREDICTION_API && typeof window.OST_PREDICTION_API.fiveMinRound === 'function') {
        var rec = window.OST_PREDICTION_API.fiveMinRound() || {};
        var y = Number(rec.yesPriceNumber);
        if (Number.isFinite(y)) return Math.max(0.03, Math.min(0.97, y));
      }
      if (window.OST_FAST_MARKETS) {
        var st = window.OST_FAST_MARKETS.state(coinKey + '5m');
        if (st && window.OST_FAST_MARKETS.buildMarket) {
          // buildMarket computes odds from the live state
          var mk = null;
          try {
            mk = window.OST_FAST_MARKETS.buildMarket({ key: coinKey + '5m', idPrefix: 'ost-' + coinKey + '5m-', symbol: COINS[coinKey].symbol, name: COINS[coinKey].label, short: COINS[coinKey].label, coinbase: '', externalUrl: '' });
          } catch (_) {}
          var yy = mk && Number(mk.yesPriceNumber);
          if (Number.isFinite(yy) && yy > 0) return Math.max(0.03, Math.min(0.97, yy));
        }
      }
    } catch (_) {}
    return 0.5;
  }

  function legPrice(leg) {
    var yes = liveYesOdds(leg.coin);
    return leg.side === 'up' ? yes : 1 - yes;
  }

  // ------------------------------------------------------------- slip store
  function readSlips() {
    try { return JSON.parse(localStorage.getItem(SLIPS_KEY) || '[]') || []; } catch (_) { return []; }
  }
  function writeSlips(arr) {
    try { localStorage.setItem(SLIPS_KEY, JSON.stringify(arr.slice(-100))); } catch (_) {}
  }

  // ------------------------------------------------------------- state
  var picks = {};       // coin -> 'up' | 'down'
  var stake = 10;
  var dockEl = null;
  var collapsed = true;

  function pickCount() { return Object.keys(picks).length; }

  function combinedMultiplier() {
    var m = 1;
    Object.keys(picks).forEach(function (coin) {
      var p = legPrice({ coin: coin, side: picks[coin] });
      m *= 1 / Math.max(0.03, Math.min(0.97, p));
    });
    return m;
  }

  function roundLocked() {
    var b = boundaries();
    return (b.closeAt - Date.now()) < LOCK_LAST_MS;
  }

  // ------------------------------------------------------------- UI
  function injectStyles() {
    if (document.getElementById('ostParlayStyle')) return;
    var st = document.createElement('style');
    st.id = 'ostParlayStyle';
    st.textContent =
      '#ostParlayDock{position:fixed;right:14px;bottom:14px;z-index:9990;width:300px;max-width:calc(100vw - 28px);' +
      'background:linear-gradient(165deg,#101527,#0a0e1c);border:1px solid rgba(109,159,255,0.35);border-radius:16px;' +
      'box-shadow:0 12px 44px rgba(0,0,0,0.55);color:#e2e8f0;font-size:13px;overflow:hidden;}' +
      '#ostParlayDock.is-collapsed{width:auto;border-radius:999px;}' +
      '.opl-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 14px;cursor:pointer;' +
      'background:rgba(109,159,255,0.10);}' +
      '.opl-head-title{font-weight:800;letter-spacing:.02em;display:flex;align-items:center;gap:7px;}' +
      '.opl-badge{background:#f5c468;color:#151515;border-radius:999px;padding:1px 8px;font-size:11px;font-weight:800;}' +
      '.opl-body{padding:12px 14px;display:flex;flex-direction:column;gap:10px;}' +
      '.opl-coins{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;}' +
      '.opl-coin{border:1px solid rgba(255,255,255,0.10);border-radius:12px;padding:8px 6px;text-align:center;background:rgba(255,255,255,0.03);}' +
      '.opl-coin-name{font-weight:800;font-size:12px;margin-bottom:6px;color:#bfdbfe;}' +
      '.opl-side{display:flex;gap:4px;justify-content:center;}' +
      '.opl-side button{flex:1;border:1px solid rgba(255,255,255,0.12);background:transparent;color:#94a3b8;border-radius:8px;' +
      'padding:5px 0;font-size:11px;font-weight:800;cursor:pointer;}' +
      '.opl-side button.is-up.is-on{background:rgba(52,211,153,0.22);border-color:#34d399;color:#7ce6a8;}' +
      '.opl-side button.is-down.is-on{background:rgba(255,124,138,0.20);border-color:#ff7c8a;color:#ff9aa5;}' +
      '.opl-stake-row{display:flex;align-items:center;gap:6px;}' +
      '.opl-stake-row input{width:70px;background:rgba(0,0,0,0.4);border:1px solid rgba(120,180,255,0.3);border-radius:8px;' +
      'color:#f8fafc;padding:6px 8px;font-size:13px;font-weight:700;}' +
      '.opl-chip{border:1px solid rgba(255,255,255,0.14);background:transparent;color:#cbd5e1;border-radius:999px;' +
      'padding:4px 9px;font-size:11px;cursor:pointer;font-weight:700;}' +
      '.opl-chip:hover{background:rgba(255,255,255,0.08);}' +
      '.opl-summary{display:flex;justify-content:space-between;align-items:baseline;background:rgba(245,196,104,0.08);' +
      'border:1px solid rgba(245,196,104,0.25);border-radius:10px;padding:8px 10px;}' +
      '.opl-mult{font-size:20px;font-weight:900;color:#f5c468;}' +
      '.opl-payout{font-size:12px;color:#e2e8f0;font-weight:700;}' +
      '.opl-place{width:100%;padding:11px 0;border:none;border-radius:12px;background:linear-gradient(135deg,#f5c468,#f59e0b);' +
      'color:#141414;font-weight:900;font-size:14px;cursor:pointer;letter-spacing:.02em;}' +
      '.opl-place:disabled{opacity:.45;cursor:not-allowed;}' +
      '.opl-countdown{text-align:center;color:#94a3b8;font-size:11px;}' +
      '.opl-countdown b{color:#f5c468;}' +
      '.opl-history{max-height:150px;overflow-y:auto;display:flex;flex-direction:column;gap:5px;}' +
      '.opl-slip{display:flex;justify-content:space-between;gap:8px;background:rgba(255,255,255,0.04);border-radius:8px;' +
      'padding:6px 8px;font-size:11px;}' +
      '.opl-slip.is-won{border-left:3px solid #34d399;}' +
      '.opl-slip.is-lost{border-left:3px solid #ff7c8a;opacity:.75;}' +
      '.opl-slip.is-open{border-left:3px solid #f5c468;}' +
      '.opl-flash{animation:oplFlash 1.2s ease;}' +
      '@keyframes oplFlash{0%{box-shadow:0 0 0 rgba(245,196,104,0);}30%{box-shadow:0 0 42px rgba(245,196,104,0.8);}100%{box-shadow:0 12px 44px rgba(0,0,0,0.55);}}' +
      '@media (max-width:640px){#ostParlayDock{right:8px;bottom:64px;width:calc(100vw - 16px);}}';
    document.head.appendChild(st);
  }

  function buildDock() {
    if (dockEl) return dockEl;
    injectStyles();
    dockEl = document.createElement('div');
    dockEl.id = 'ostParlayDock';
    dockEl.className = 'is-collapsed';
    dockEl.innerHTML =
      '<div class="opl-head" id="oplHead">' +
        '<span class="opl-head-title">⚡ Fast Parlay <span class="opl-badge" id="oplCount">0</span></span>' +
        '<span id="oplToggle" style="color:#94a3b8;">▴</span>' +
      '</div>' +
      '<div class="opl-body" id="oplBody" style="display:none;">' +
        '<div style="color:#94a3b8;font-size:11px;line-height:1.45;">Pick UP or DOWN on 2–3 coins for <b style="color:#e2e8f0;">this 5-minute round</b>. All picks must hit. Settles on the Binance 5-min candle.</div>' +
        '<div class="opl-coins" id="oplCoins"></div>' +
        '<div class="opl-stake-row">' +
          '<span style="color:#94a3b8;font-size:11px;">Stake</span>' +
          '<input type="number" id="oplStake" min="1" max="500" step="1" value="10">' +
          '<button class="opl-chip" data-stake="5">5</button>' +
          '<button class="opl-chip" data-stake="10">10</button>' +
          '<button class="opl-chip" data-stake="25">25</button>' +
          '<button class="opl-chip" data-stake="50">50</button>' +
        '</div>' +
        '<div class="opl-summary"><span class="opl-mult" id="oplMult">×1.00</span><span class="opl-payout" id="oplPayout">win 0.00 OST</span></div>' +
        '<button class="opl-place" id="oplPlace" disabled>Pick at least 2 coins</button>' +
        '<div class="opl-countdown" id="oplCountdown"></div>' +
        '<div class="opl-history" id="oplHistory"></div>' +
      '</div>';
    document.body.appendChild(dockEl);

    var coinsEl = dockEl.querySelector('#oplCoins');
    Object.keys(COINS).forEach(function (key) {
      var c = COINS[key];
      var cell = document.createElement('div');
      cell.className = 'opl-coin';
      cell.innerHTML =
        '<div class="opl-coin-name">' + c.emoji + ' ' + c.label + ' <span data-odds="' + key + '" style="color:#64748b;font-weight:600;"></span></div>' +
        '<div class="opl-side">' +
          '<button class="is-up" data-coin="' + key + '" data-side="up">UP</button>' +
          '<button class="is-down" data-coin="' + key + '" data-side="down">DN</button>' +
        '</div>';
      coinsEl.appendChild(cell);
    });

    dockEl.querySelector('#oplHead').addEventListener('click', function () {
      collapsed = !collapsed;
      dockEl.classList.toggle('is-collapsed', collapsed);
      dockEl.querySelector('#oplBody').style.display = collapsed ? 'none' : 'flex';
      dockEl.querySelector('#oplToggle').textContent = collapsed ? '▴' : '▾';
    });

    coinsEl.addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-coin]');
      if (!btn) return;
      var coin = btn.dataset.coin, side = btn.dataset.side;
      if (picks[coin] === side) delete picks[coin];
      else picks[coin] = side;
      renderDock();
    });

    dockEl.querySelector('.opl-stake-row').addEventListener('click', function (e) {
      var chip = e.target.closest('[data-stake]');
      if (!chip) return;
      stake = Number(chip.dataset.stake);
      dockEl.querySelector('#oplStake').value = String(stake);
      renderDock();
    });
    dockEl.querySelector('#oplStake').addEventListener('input', function (e) {
      stake = Math.max(MIN_STAKE, Math.min(MAX_STAKE, Math.floor(Number(e.target.value) || 0)));
      renderDock();
    });

    dockEl.querySelector('#oplPlace').addEventListener('click', placeSlip);

    setInterval(tickCountdown, 1000);
    setInterval(renderOdds, 5000);
    return dockEl;
  }

  function renderOdds() {
    if (!dockEl || collapsed) return;
    Object.keys(COINS).forEach(function (key) {
      var el = dockEl.querySelector('[data-odds="' + key + '"]');
      if (el) el.textContent = Math.round(liveYesOdds(key) * 100) + '¢↑';
    });
    renderSummary();
  }

  function renderSummary() {
    if (!dockEl) return;
    var n = pickCount();
    var mult = combinedMultiplier();
    dockEl.querySelector('#oplCount').textContent = String(n);
    dockEl.querySelector('#oplMult').textContent = '×' + (n ? mult.toFixed(2) : '1.00');
    dockEl.querySelector('#oplPayout').textContent = 'win ' + (n ? (stake * mult).toFixed(2) : '0.00') + ' OST';
    var place = dockEl.querySelector('#oplPlace');
    var bal = window.OST_MONEY ? window.OST_MONEY.get() : 0;
    if (n < MIN_LEGS) { place.disabled = true; place.textContent = 'Pick at least ' + MIN_LEGS + ' coins'; }
    else if (roundLocked()) { place.disabled = true; place.textContent = 'Round locking — wait for next'; }
    else if (stake < MIN_STAKE) { place.disabled = true; place.textContent = 'Enter a stake'; }
    else if (bal < stake) { place.disabled = true; place.textContent = 'Need ' + stake + ' OST (have ' + bal.toFixed(2) + ')'; }
    else { place.disabled = false; place.textContent = '⚡ Place ' + stake + ' OST parlay'; }
  }

  function renderDock() {
    if (!dockEl) return;
    dockEl.querySelectorAll('button[data-coin]').forEach(function (b) {
      b.classList.toggle('is-on', picks[b.dataset.coin] === b.dataset.side);
    });
    renderSummary();
    renderHistory();
  }

  function tickCountdown() {
    if (!dockEl || collapsed) return;
    var b = boundaries();
    var s = Math.max(0, Math.floor((b.closeAt - Date.now()) / 1000));
    var el = dockEl.querySelector('#oplCountdown');
    if (el) el.innerHTML = 'Round closes in <b>' + Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0') + '</b>';
    // stake button lock state can flip in the last seconds
    if (s % 5 === 0) renderSummary();
  }

  function renderHistory() {
    if (!dockEl) return;
    var el = dockEl.querySelector('#oplHistory');
    var slips = readSlips().slice().reverse().slice(0, 8);
    el.innerHTML = slips.length ? slips.map(function (sl) {
      var legs = sl.legs.map(function (l) { return COINS[l.coin].label + (l.side === 'up' ? '↑' : '↓'); }).join(' + ');
      var cls = sl.status === 'won' ? 'is-won' : sl.status === 'lost' ? 'is-lost' : 'is-open';
      var right = sl.status === 'won' ? '+' + sl.payout.toFixed(2)
                : sl.status === 'lost' ? '−' + sl.stake.toFixed(2)
                : '×' + sl.multiplier.toFixed(2) + ' pending';
      return '<div class="opl-slip ' + cls + '"><span>' + legs + '</span><span>' + right + '</span></div>';
    }).join('') : '<div style="color:#475569;font-size:11px;text-align:center;">Your parlays will appear here.</div>';
  }

  // ------------------------------------------------------------- place/settle
  function placeSlip() {
    var n = pickCount();
    if (n < MIN_LEGS || n > MAX_LEGS || roundLocked()) return;
    if (!window.OST_MONEY) return;
    var b = boundaries();
    var legs = Object.keys(picks).map(function (coin) {
      return { coin: coin, side: picks[coin], price: Math.max(0.03, Math.min(0.97, legPrice({ coin: coin, side: picks[coin] }))) };
    });
    var mult = legs.reduce(function (m, l) { return m * (1 / l.price); }, 1);
    var amount = Math.max(MIN_STAKE, Math.min(MAX_STAKE, Math.floor(stake)));
    if (!window.OST_MONEY.spend(amount, 'parlay')) { renderSummary(); return; }

    var slips = readSlips();
    slips.push({
      id: 'parlay-' + b.openAt + '-' + Math.random().toString(36).slice(2, 8),
      openAt: b.openAt,
      closeAt: b.closeAt,
      legs: legs,
      stake: amount,
      multiplier: mult,
      payout: amount * mult,
      status: 'open',
      placedAt: Date.now()
    });
    writeSlips(slips);
    picks = {};
    renderDock();
    var body = dockEl.querySelector('#oplBody');
    dockEl.classList.add('opl-flash');
    setTimeout(function () { dockEl.classList.remove('opl-flash'); }, 1300);
    if (body) body.scrollTop = body.scrollHeight;
  }

  var settling = false;
  function settleScan() {
    if (settling) return;
    var slips = readSlips();
    var now = Date.now();
    var due = slips.filter(function (s) { return s.status === 'open' && (s.openAt + FIVE_MIN + 8000) <= now; });
    if (!due.length) return;
    settling = true;
    var chain = Promise.resolve();
    due.forEach(function (slip) {
      chain = chain.then(function () {
        return Promise.all(slip.legs.map(function (l) {
          return fetchKline(COINS[l.coin].symbol, slip.openAt);
        })).then(function (klines) {
          if (klines.some(function (k) { return !k || !(k.open > 0) || !(k.close > 0); })) return; // retry next scan
          var allWin = slip.legs.every(function (l, i) {
            var up = klines[i].close > klines[i].open;
            return l.side === 'up' ? up : !up;
          });
          slip.status = allWin ? 'won' : 'lost';
          slip.settledAt = Date.now();
          slip.results = klines;
          if (allWin && window.OST_MONEY) {
            window.OST_MONEY.add(slip.payout, 'parlay-win');
            try {
              window.dispatchEvent(new CustomEvent('ost:parlay-won', { detail: { payout: slip.payout, multiplier: slip.multiplier, legs: slip.legs } }));
            } catch (_) {}
          }
        });
      });
    });
    chain.then(function () {
      writeSlips(slips);
      renderDock();
    }).finally(function () { settling = false; });
  }

  // ------------------------------------------------------------- boot
  function boot() {
    // Only mount on pages that have the fast-market engines (the classic app)
    if (!document.getElementById('walletBtn')) return;
    buildDock();
    renderDock();
    renderOdds();
    setInterval(settleScan, 15000);
    setTimeout(settleScan, 5000);
  }

  window.OST_PARLAY = {
    open: function () {
      buildDock();
      if (collapsed) dockEl.querySelector('#oplHead').click();
    },
    slips: readSlips,
    settleScan: settleScan
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 1200); });
  else setTimeout(boot, 1200);
})();

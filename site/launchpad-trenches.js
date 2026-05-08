/* ============================================================================
 * launchpad-trenches.js
 * ----------------------------------------------------------------------------
 * Pump.fun-style fair-launch UI + padre.gg trenches feed for the OST Launchpad.
 *
 * Adds three live, globally-shared columns to the launchpad section:
 *   1. Fresh mints      (created in the last 30 min)
 *   2. Hot runners      (highest mcap right now)
 *   3. Near graduation  (curve > 60% — close to the 690K mcap graduation)
 *
 * Coins are fetched from the OST edge worker:
 *   GET  ${OST_API_BASE}/launchpad/coins         → shared coin registry
 *   POST ${OST_API_BASE}/launchpad/coins         → publish a new fair-launch
 *   POST ${OST_API_BASE}/launchpad/trade         → buy/sell on the bonding curve
 *
 * Soft-fails when the worker is unreachable (falls back to local demo data).
 * ============================================================================ */
(function () {
  'use strict';

  var REFRESH_MS = 5000;
  var GRADUATION_MCAP = 69000;       // OST mcap to "graduate" (move to a real DEX pool)
  var FRESH_WINDOW_MS = 30 * 60 * 1000;

  function apiBase() {
    var v = window.OST_API_BASE || '';
    return v ? String(v).replace(/\/$/, '') : '';
  }

  function fmtMcap(n) {
    n = Number(n) || 0;
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
    if (n >= 1_000)     return (n / 1_000).toFixed(1) + 'K';
    return n.toFixed(0);
  }
  function fmtAgo(ts) {
    var s = Math.max(0, Math.round((Date.now() - Number(ts)) / 1000));
    if (s < 60)   return s + 's';
    if (s < 3600) return Math.round(s / 60) + 'm';
    if (s < 86400) return Math.round(s / 3600) + 'h';
    return Math.round(s / 86400) + 'd';
  }
  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // ── Style injection (scoped to .ost-trenches) ──────────────────────────────
  function injectStyle() {
    if (document.getElementById('ost-trenches-style')) return;
    var s = document.createElement('style');
    s.id = 'ost-trenches-style';
    s.textContent = [
      '.ost-trenches{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-top:18px}',
      '@media (max-width:980px){.ost-trenches{grid-template-columns:1fr}}',
      '.ost-trench{background:linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.02));border:1px solid rgba(255,255,255,0.08);border-radius:14px;padding:14px;display:flex;flex-direction:column;gap:8px;min-height:380px}',
      '.ost-trench h4{margin:0;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#9ba0c8;display:flex;align-items:center;gap:6px}',
      '.ost-trench h4::before{content:"";width:8px;height:8px;border-radius:50%;background:#7ce6a8;box-shadow:0 0 8px #7ce6a8;animation:ostTrenchPulse 1.5s ease-in-out infinite}',
      '.ost-trench--hot   h4::before{background:#ffd980;box-shadow:0 0 8px #ffd980}',
      '.ost-trench--grad  h4::before{background:#ff7c8a;box-shadow:0 0 8px #ff7c8a}',
      '@keyframes ostTrenchPulse{0%,100%{opacity:0.4}50%{opacity:1}}',
      '.ost-trench__list{display:flex;flex-direction:column;gap:8px;max-height:420px;overflow-y:auto;scrollbar-gutter:stable}',
      '.ost-coin{display:grid;grid-template-columns:44px 1fr auto;gap:10px;align-items:center;padding:10px;border-radius:10px;background:rgba(0,0,0,0.25);border:1px solid rgba(255,255,255,0.05);cursor:pointer;transition:transform 80ms ease,border-color 120ms ease;animation:ostCoinIn 240ms ease}',
      '.ost-coin:hover{border-color:rgba(124,230,168,0.4);transform:translateY(-1px)}',
      '@keyframes ostCoinIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}',
      '.ost-coin__img{width:44px;height:44px;border-radius:50%;background:linear-gradient(135deg,#5a4ed6,#1a1340);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:14px;color:#fff;overflow:hidden}',
      '.ost-coin__img img{width:100%;height:100%;object-fit:cover}',
      '.ost-coin__meta{min-width:0}',
      '.ost-coin__name{font-weight:800;font-size:13px;color:#f4ead4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.ost-coin__sym{font-size:11px;color:#9ba0c8;letter-spacing:0.04em}',
      '.ost-coin__stats{text-align:right;font-variant-numeric:tabular-nums}',
      '.ost-coin__mcap{font-weight:800;color:#7ce6a8;font-size:13px}',
      '.ost-coin__age{font-size:10px;color:#6b7099}',
      '.ost-coin__bar{grid-column:1 / -1;height:4px;border-radius:3px;background:rgba(255,255,255,0.06);overflow:hidden;margin-top:4px}',
      '.ost-coin__bar-fill{height:100%;background:linear-gradient(90deg,#7ce6a8,#ffd980);transition:width 400ms ease}',
      '.ost-coin__bar-fill.is-grad{background:linear-gradient(90deg,#ffd980,#ff7c8a)}',
      '.ost-trench__empty{padding:30px 10px;text-align:center;color:#6b7099;font-size:12px}',
      '.ost-trade-pop{position:fixed;inset:0;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,0.7);z-index:99999;backdrop-filter:blur(4px)}',
      '.ost-trade-pop.is-open{display:flex}',
      '.ost-trade-pop__panel{width:min(420px,94vw);background:linear-gradient(170deg,#14102a,#06080f);border:1px solid rgba(108,230,164,0.2);border-radius:16px;padding:22px;box-shadow:0 30px 80px rgba(0,0,0,0.6)}',
      '.ost-trade-pop h3{margin:0 0 10px;font-size:16px}',
      '.ost-trade-pop__row{display:flex;gap:8px;margin:8px 0}',
      '.ost-trade-pop__row button{flex:1;padding:10px;border-radius:10px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.04);color:#f4ead4;font-weight:700;cursor:pointer}',
      '.ost-trade-pop__row button.is-buy.is-active{background:linear-gradient(135deg,#7ce6a8,#4cc985);color:#0a0a0a;border-color:transparent}',
      '.ost-trade-pop__row button.is-sell.is-active{background:linear-gradient(135deg,#ff7c8a,#e85565);color:#fff;border-color:transparent}',
      '.ost-trade-pop input{width:100%;padding:10px;border-radius:10px;border:1px solid rgba(255,255,255,0.1);background:rgba(0,0,0,0.3);color:#f4ead4;font-size:14px;margin:6px 0}',
      '.ost-trade-pop__submit{width:100%;padding:12px;border-radius:10px;border:0;background:linear-gradient(135deg,#7ce6a8,#4cc985);color:#0a0a0a;font-weight:800;cursor:pointer;margin-top:8px}',
      '.ost-trade-pop__close{position:absolute;top:14px;right:18px;background:transparent;border:0;color:#9ba0c8;font-size:20px;cursor:pointer}',
      '.ost-trade-pop__chart{height:120px;background:rgba(0,0,0,0.4);border-radius:8px;margin:10px 0;display:flex;align-items:end;padding:6px;gap:2px}',
      '.ost-trade-pop__chart span{display:block;width:6px;background:#7ce6a8;border-radius:2px;min-height:2px}',
      '.ost-trade-pop__ticks{max-height:120px;overflow-y:auto;font-size:11px;color:#9ba0c8;font-family:monospace}'
    ].join('\n');
    document.head.appendChild(s);
  }

  // ── Trenches grid mount ────────────────────────────────────────────────────
  function ensureTrenches() {
    var host = document.getElementById('lpPanelFeed') || document.getElementById('lpPanelBoard');
    if (!host) return null;
    var el = host.querySelector('.ost-trenches');
    if (el) return el;
    el = document.createElement('div');
    el.className = 'ost-trenches';
    el.innerHTML =
      '<section class="ost-trench ost-trench--fresh"><h4>Fresh mints</h4><div class="ost-trench__list" data-bind="fresh"></div></section>' +
      '<section class="ost-trench ost-trench--hot"><h4>Hot runners</h4><div class="ost-trench__list" data-bind="hot"></div></section>' +
      '<section class="ost-trench ost-trench--grad"><h4>Near graduation</h4><div class="ost-trench__list" data-bind="grad"></div></section>';
    host.insertBefore(el, host.firstChild);
    return el;
  }

  function renderColumn(node, coins, kind) {
    if (!node) return;
    if (!coins.length) {
      node.innerHTML = '<div class="ost-trench__empty">' +
        (kind === 'fresh' ? 'Be the first to launch a coin!' :
         kind === 'hot'   ? 'No coins trading yet.' :
                            'No coins close to graduation.') +
      '</div>';
      return;
    }
    node.innerHTML = coins.map(function (c) {
      var initial = (c.symbol || c.name || '?').slice(0, 2).toUpperCase();
      var img = c.image
        ? '<img src="' + escapeHtml(c.image) + '" alt="">'
        : escapeHtml(initial);
      var curve = Math.max(0, Math.min(100, Number(c.curve) || 0));
      var nearGrad = curve >= 60;
      return '<div class="ost-coin" data-mint="' + escapeHtml(c.mint || c.id) + '">' +
        '<div class="ost-coin__img">' + img + '</div>' +
        '<div class="ost-coin__meta">' +
          '<div class="ost-coin__name">' + escapeHtml(c.name || 'Unnamed') + '</div>' +
          '<div class="ost-coin__sym">$' + escapeHtml(c.symbol || '???') + ' · ' + (c.trades || 0) + ' trades</div>' +
        '</div>' +
        '<div class="ost-coin__stats">' +
          '<div class="ost-coin__mcap">' + fmtMcap(c.mcap) + ' OST</div>' +
          '<div class="ost-coin__age">' + fmtAgo(c.createdAt || Date.now()) + ' ago</div>' +
        '</div>' +
        '<div class="ost-coin__bar"><div class="ost-coin__bar-fill' + (nearGrad ? ' is-grad' : '') + '" style="width:' + curve + '%"></div></div>' +
      '</div>';
    }).join('');
    node.querySelectorAll('.ost-coin').forEach(function (row) {
      row.addEventListener('click', function () {
        var mint = row.getAttribute('data-mint');
        var coin = coins.find(function (c) { return (c.mint || c.id) === mint; });
        if (coin) openTradePopup(coin);
      });
    });
  }

  // ── Trade pop-up (buy/sell on bonding curve) ───────────────────────────────
  var tradePop = null;
  function ensureTradePopup() {
    if (tradePop) return tradePop;
    tradePop = document.createElement('div');
    tradePop.className = 'ost-trade-pop';
    tradePop.innerHTML =
      '<div class="ost-trade-pop__panel" style="position:relative;">' +
        '<button type="button" class="ost-trade-pop__close" data-act="close">×</button>' +
        '<h3 data-bind="title">Coin</h3>' +
        '<div data-bind="sub" style="font-size:12px;color:#9ba0c8;margin-bottom:8px">—</div>' +
        '<div class="ost-trade-pop__chart" data-bind="chart"></div>' +
        '<div class="ost-trade-pop__row">' +
          '<button type="button" class="is-buy is-active" data-side="buy">Buy</button>' +
          '<button type="button" class="is-sell" data-side="sell">Sell</button>' +
        '</div>' +
        '<input type="number" min="0.01" step="0.01" value="1" placeholder="OST amount" data-bind="amount">' +
        '<button type="button" class="ost-trade-pop__submit" data-act="submit">Place trade</button>' +
        '<div data-bind="status" style="font-size:11px;color:#9ba0c8;text-align:center;margin-top:8px">—</div>' +
        '<div class="ost-trade-pop__ticks" data-bind="ticks" style="margin-top:10px"></div>' +
      '</div>';
    document.body.appendChild(tradePop);
    tradePop.addEventListener('click', function (e) {
      if (e.target === tradePop || e.target.getAttribute('data-act') === 'close') closeTradePopup();
    });
    return tradePop;
  }

  var tradeTimer = null;
  function closeTradePopup() {
    if (tradePop) tradePop.classList.remove('is-open');
    if (tradeTimer) { clearInterval(tradeTimer); tradeTimer = null; }
  }
  function openTradePopup(coin) {
    var pop = ensureTradePopup();
    pop.classList.add('is-open');
    var side = 'buy';
    pop.querySelector('[data-bind="title"]').textContent = (coin.name || '') + '  ($' + (coin.symbol || '') + ')';
    pop.querySelector('[data-bind="sub"]').textContent = 'Mcap ' + fmtMcap(coin.mcap) + ' OST · curve ' + (Number(coin.curve) || 0) + '% · ' + (coin.trades || 0) + ' trades';
    pop.querySelector('[data-bind="status"]').textContent = '';
    pop.querySelectorAll('.ost-trade-pop__row button').forEach(function (b) {
      b.onclick = function () {
        side = b.getAttribute('data-side');
        pop.querySelectorAll('.ost-trade-pop__row button').forEach(function (x) { x.classList.remove('is-active'); });
        b.classList.add('is-active');
        var sub = pop.querySelector('.ost-trade-pop__submit');
        sub.style.background = side === 'sell'
          ? 'linear-gradient(135deg,#ff7c8a,#e85565)'
          : 'linear-gradient(135deg,#7ce6a8,#4cc985)';
        sub.style.color = side === 'sell' ? '#fff' : '#0a0a0a';
      };
    });
    pop.querySelector('[data-act="submit"]').onclick = function () {
      var amt = Number(pop.querySelector('[data-bind="amount"]').value) || 0;
      if (amt <= 0) return;
      var trader = (window.OST_WALLET && window.OST_WALLET.session && window.OST_WALLET.session.publicKey && window.OST_WALLET.session.publicKey.toBase58 && window.OST_WALLET.session.publicKey.toBase58()) ||
        window.OST_WALLET_PUBKEY ||
        (window.solana && window.solana.publicKey && window.solana.publicKey.toString && window.solana.publicKey.toString()) || '';
      var trade = window.OST_TRADE || null;
      if (!trader || !trade || !trade.memecoinBuy || !trade.memecoinSell) {
        pop.querySelector('[data-bind="status"]').textContent = 'Connect an OST wallet first.';
        return;
      }
      pop.querySelector('[data-bind="status"]').textContent = 'Submitting…';
      var base = apiBase();
      if (!base) {
        pop.querySelector('[data-bind="status"]').textContent = 'OST API base missing.';
        return;
      }
      var walletTrade = side === 'buy'
        ? trade.memecoinBuy(coin.symbol || coin.mint || coin.id, amt)
        : trade.memecoinSell(coin.symbol || coin.mint || coin.id, amt);
      walletTrade.then(function(result) {
        var ostAmount = Number(result && result.ost || amt) || amt;
        if (typeof window.recordOstPlatformEvent === 'function') {
          window.recordOstPlatformEvent({
            kind: side === 'buy' ? 'launchpad-buy' : 'launchpad-sell',
            amount: ostAmount,
            token: coin.symbol || coin.mint || coin.id,
            sig: result && result.sig,
            ts: Date.now(),
            source: 'launchpad'
          });
        }
        return fetch(base + '/launchpad/trade', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ mint: coin.mint || coin.id, side: side, amount: ostAmount, trader: trader, signature: result && result.sig })
        });
      }).then(function (r) { return r.json(); })
        .then(function (j) {
          if (j && j.ok && j.coin) {
            coin.mcap = j.coin.mcap; coin.curve = j.coin.curve; coin.trades = j.coin.trades;
            pop.querySelector('[data-bind="sub"]').textContent = 'Mcap ' + fmtMcap(coin.mcap) + ' OST · curve ' + (Number(coin.curve) || 0) + '% · ' + (coin.trades || 0) + ' trades';
            pop.querySelector('[data-bind="status"]').textContent = '✅ ' + side.toUpperCase() + ' ' + amt + ' OST';
            refreshTicks(coin);
            try { window.dispatchEvent(new CustomEvent('ost:wallet-changed')); } catch (_) {}
          } else {
            pop.querySelector('[data-bind="status"]').textContent = '⚠️ ' + (j && j.error || 'Trade failed');
          }
        })
        .catch(function (e) {
          pop.querySelector('[data-bind="status"]').textContent = '⚠️ ' + e.message;
        });
    };

    function refreshTicks(c) {
      var base = apiBase();
      if (!base) return;
      fetch(base + '/launchpad/ticks/' + encodeURIComponent(c.mint || c.id), { cache: 'no-store' })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          var ticks = (j && j.ticks) || [];
          var ticksEl = pop.querySelector('[data-bind="ticks"]');
          var chartEl = pop.querySelector('[data-bind="chart"]');
          ticksEl.innerHTML = ticks.slice(0, 10).map(function (t) {
            var color = t.side === 'buy' ? '#7ce6a8' : '#ff7c8a';
            return '<div><span style="color:' + color + '">' + t.side.toUpperCase() + '</span> ' +
                   Number(t.amount).toFixed(2) + ' OST · mcap ' + fmtMcap(t.mcap) + ' · ' + (t.trader || 'anon') + ' · ' + fmtAgo(t.ts) + ' ago</div>';
          }).join('') || '<div style="opacity:0.55">No trades yet</div>';
          // Mini bar chart of mcap over last ticks
          if (ticks.length) {
            var mcaps = ticks.slice(0, 30).reverse().map(function (t) { return Number(t.mcap); });
            var max = Math.max.apply(null, mcaps), min = Math.min.apply(null, mcaps);
            var rng = Math.max(1, max - min);
            chartEl.innerHTML = mcaps.map(function (m) {
              var h = Math.max(2, Math.round(((m - min) / rng) * 100)) + '%';
              return '<span style="height:' + h + '"></span>';
            }).join('');
          }
        })
        .catch(function () {});
    }
    refreshTicks(coin);
    tradeTimer = setInterval(function () { refreshTicks(coin); }, 4000);
  }

  // ── Refresh loop ───────────────────────────────────────────────────────────
  function classify(coins) {
    var now = Date.now();
    var fresh = coins.filter(function (c) { return now - Number(c.createdAt) < FRESH_WINDOW_MS; })
                     .sort(function (a, b) { return Number(b.createdAt) - Number(a.createdAt); })
                     .slice(0, 12);
    var hot = coins.slice().sort(function (a, b) { return Number(b.mcap) - Number(a.mcap); }).slice(0, 12);
    var grad = coins.filter(function (c) { return Number(c.curve) >= 60 && Number(c.mcap) < GRADUATION_MCAP; })
                    .sort(function (a, b) { return Number(b.curve) - Number(a.curve); })
                    .slice(0, 12);
    return { fresh: fresh, hot: hot, grad: grad };
  }

  function refresh() {
    var el = ensureTrenches();
    if (!el) return;
    var base = apiBase();
    if (!base) return;
    fetch(base + '/launchpad/coins', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        var coins = (j && Array.isArray(j.coins)) ? j.coins : [];
        var c = classify(coins);
        renderColumn(el.querySelector('[data-bind="fresh"]'), c.fresh, 'fresh');
        renderColumn(el.querySelector('[data-bind="hot"]'),   c.hot,   'hot');
        renderColumn(el.querySelector('[data-bind="grad"]'),  c.grad,  'grad');
      })
      .catch(function () { /* silent */ });
  }

  // ── Hook the existing "create coin" form to also publish to the worker ────
  function hookCreateForm() {
    var btn = document.getElementById('lpLaunchBtn') || document.getElementById('lpCreateBtn') || document.querySelector('[data-act="lp-create"]');
    if (!btn || btn.__ostHooked) return;
    btn.__ostHooked = true;
    btn.addEventListener('click', function () {
      // Wait a tick so the existing local-state code finishes, then mirror to the worker.
      setTimeout(function () {
        var base = apiBase();
        if (!base) return;
        try {
          var hist = JSON.parse(localStorage.getItem('ost_lp_history2') || '[]');
          var latest = hist && hist.slice().sort(function(a, b) { return Number(b.date || b.createdAt || 0) - Number(a.date || a.createdAt || 0); })[0];
          if (!latest || latest.__synced) return;
          fetch(base + '/launchpad/coins', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              name: latest.name, symbol: latest.symbol || latest.ticker, desc: latest.desc,
              image: latest.image || latest.img, twitter: latest.twitter, telegram: latest.telegram,
              website: latest.website,
              creator: window.OST_WALLET_PUBKEY || 'anon',
              mcap: latest.mcap || 100, curve: latest.curve || 1, supply: latest.supply || 1_000_000_000
            })
          }).then(function (r) { return r.json(); }).then(function (j) {
            if (j && j.ok) {
              latest.__synced = true;
              localStorage.setItem('ost_lp_history2', JSON.stringify(hist));
              refresh();
            }
          }).catch(function () {});
        } catch (_) {}
      }, 400);
    });
  }

  // ── Boot ───────────────────────────────────────────────────────────────────
  function boot() {
    injectStyle();
    refresh();
    setInterval(refresh, REFRESH_MS);
    hookCreateForm();
    setInterval(hookCreateForm, 3000); // catch buttons added later by tab switching
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();

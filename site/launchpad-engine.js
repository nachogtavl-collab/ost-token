/* OST Launchpad Engine — real bonding-curve memecoin trading.
 *
 * Phase 1 (today, no on-chain mint): every coin in `ost_lp_history2` gets a
 * deterministic bonding curve quoted in OST.
 *   price(soldRatio) = BASE_PRICE * (1 + soldRatio * CURVE_STEEPNESS)
 *   where soldRatio = tokensSold / supply (0..1).
 *   buy(ostIn)  -> tokens minted on the curve, mcap = soldRatio * supply * price
 *   sell(tokens)-> ost paid back from the curve
 *
 * Per-wallet holdings persist in `ost.lp.holdings.v1` so users can SELL what
 * they bought, see P/L, and the registry's `mcap` / `curve` fields stay in
 * sync with the curve math (no more random walk overwriting real trades).
 *
 * Public API:
 *   window.OST_LAUNCHPAD = {
 *     loadCoins(), getCoin(mint), updateCoin(coin),
 *     buy(mint, ostIn, trader), sell(mint, tokensIn, trader),
 *     priceFor(coinOrMint), holdingsFor(trader), positionFor(trader, mint)
 *   }
 *
 * Also overrides window.OST_TRADE.memecoinBuy/Sell so the existing pump.fun-
 * style detail modal works end-to-end, and injects a "Your holdings" panel.
 */
(function () {
  'use strict';

  var STORAGE_REGISTRY = 'ost_lp_history2'; // shared with app.js
  var STORAGE_HOLDINGS = 'ost.lp.holdings.v1';
  var STORAGE_TRADES = 'ost.lp.trades.v1';

  var BASE_PRICE = 0.00003;        // OST per token at zero supply
  var CURVE_STEEPNESS = 199;       // price multiplier at full supply
  var DEFAULT_SUPPLY = 1_000_000_000;
  var GRADUATION_MCAP = 69000;     // OST market cap that locks the curve

  function sigShort() {
    var chars = '0123456789abcdef';
    var out = '';
    for (var i = 0; i < 16; i++) out += chars[Math.floor(Math.random() * 16)];
    return out;
  }

  function loadCoins() {
    try { return JSON.parse(localStorage.getItem(STORAGE_REGISTRY) || '[]') || []; }
    catch (_) { return []; }
  }
  function saveCoins(coins) {
    try { localStorage.setItem(STORAGE_REGISTRY, JSON.stringify(coins)); } catch (_) {}
  }
  function getCoin(mint) {
    return loadCoins().find(function (c) { return (c.mint || c.id) === mint; }) || null;
  }
  function updateCoin(coin) {
    if (!coin || !coin.mint) return;
    var coins = loadCoins();
    var idx = coins.findIndex(function (c) { return (c.mint || c.id) === coin.mint; });
    if (idx >= 0) coins[idx] = coin; else coins.unshift(coin);
    saveCoins(coins);
  }
  function findBySymbol(symbol) {
    var sym = String(symbol || '').toUpperCase();
    return loadCoins().find(function (c) { return String(c.symbol || '').toUpperCase() === sym; }) || null;
  }

  function loadHoldings() {
    try { return JSON.parse(localStorage.getItem(STORAGE_HOLDINGS) || '{}') || {}; }
    catch (_) { return {}; }
  }
  function saveHoldings(h) {
    try { localStorage.setItem(STORAGE_HOLDINGS, JSON.stringify(h)); } catch (_) {}
  }
  function holdingsFor(trader) {
    if (!trader) return {};
    var all = loadHoldings();
    return all[trader] || {};
  }
  function positionFor(trader, mint) {
    var h = holdingsFor(trader)[mint];
    return h || { tokens: 0, costOst: 0 };
  }

  function recordTrade(entry) {
    try {
      var arr = JSON.parse(localStorage.getItem(STORAGE_TRADES) || '[]') || [];
      arr.unshift(entry);
      if (arr.length > 200) arr.length = 200;
      localStorage.setItem(STORAGE_TRADES, JSON.stringify(arr));
    } catch (_) {}
  }

  function ensureCurveState(coin) {
    if (!coin) return null;
    if (typeof coin.tokensSold !== 'number') {
      // Migrate existing demo coins: derive an initial sold amount from current mcap.
      var supply = Number(coin.supply) || DEFAULT_SUPPLY;
      var mcap = Math.max(0, Number(coin.mcap) || 0);
      // Approximate inverse: assume average price = BASE_PRICE * (1 + 0.5 * sold/supply)
      // mcap = sold * avgPrice  ->  solve quadratic; bound to supply.
      var a = BASE_PRICE * CURVE_STEEPNESS / supply;
      var b = BASE_PRICE;
      // mcap = a*sold^2 + b*sold (rough). Solve: sold = (-b + sqrt(b^2 + 4*a*mcap))/(2a)
      var sold = a > 0 ? (-b + Math.sqrt(b * b + 4 * a * mcap)) / (2 * a) : mcap / b;
      coin.tokensSold = Math.max(0, Math.min(supply, sold));
      coin.supply = supply;
    }
    return coin;
  }

  function priceAt(soldRatio) {
    var r = Math.max(0, Math.min(1, soldRatio));
    return BASE_PRICE * (1 + r * CURVE_STEEPNESS);
  }

  function priceFor(coinOrMint) {
    var coin = typeof coinOrMint === 'string' ? getCoin(coinOrMint) : coinOrMint;
    if (!coin) return BASE_PRICE;
    ensureCurveState(coin);
    return priceAt(coin.tokensSold / coin.supply);
  }

  // Closed-form integral for the curve cost:
  //   cost(s0, s1) = integral from s0 to s1 of price(s/supply) ds
  //                = BASE * (s1 - s0) + BASE * STEEP / (2*supply) * (s1^2 - s0^2)
  function curveCost(s0, s1, supply) {
    var ds = s1 - s0;
    var ds2 = s1 * s1 - s0 * s0;
    return BASE_PRICE * ds + (BASE_PRICE * CURVE_STEEPNESS / (2 * supply)) * ds2;
  }

  // Inverse: given OST amount, find tokens minted starting at sold s0.
  // Solve quadratic: A*x^2 + B*x - ostIn = 0, where
  //   A = BASE*STEEP/(2*supply); B = BASE * (1 + STEEP * s0 / supply)
  function tokensForOst(ostIn, s0, supply) {
    var A = BASE_PRICE * CURVE_STEEPNESS / (2 * supply);
    var B = BASE_PRICE * (1 + CURVE_STEEPNESS * s0 / supply);
    if (A <= 0) return ostIn / Math.max(1e-12, B);
    var disc = B * B + 4 * A * ostIn;
    return (-B + Math.sqrt(disc)) / (2 * A);
  }

  function recomputeRegistryFields(coin) {
    ensureCurveState(coin);
    var price = priceAt(coin.tokensSold / coin.supply);
    var mcap = coin.tokensSold * price;
    coin.mcap = Math.round(mcap);
    coin.curve = Math.max(0, Math.min(100, Math.floor((mcap / GRADUATION_MCAP) * 100)));
    coin.price = price;
    coin.trades = (Number(coin.trades) || 0);
  }

  function ostBalance(trader) {
    try {
      if (window.OST_WALLET && typeof window.OST_WALLET.getOstBalance === 'function') {
        return window.OST_WALLET.getOstBalance(trader).then(function (n) { return Math.max(0, Number(n) || 0); });
      }
    } catch (_) {}
    return Promise.resolve(Infinity); // permissive when balance lookup unavailable
  }

  async function buy(mintOrSymbol, ostIn, traderOverride) {
    var coin = getCoin(mintOrSymbol) || findBySymbol(mintOrSymbol);
    if (!coin) throw new Error('Coin not found: ' + mintOrSymbol);
    var amt = Math.max(0, Number(ostIn) || 0);
    if (amt <= 0) throw new Error('Enter a positive OST amount.');
    var trader = traderOverride || currentTrader();
    if (!trader) throw new Error('Connect a wallet first.');
    ensureCurveState(coin);
    if ((coin.curve || 0) >= 100) throw new Error('Coin has graduated — trading locked until DEX migration.');
    var bal = await ostBalance(trader);
    if (bal + 1e-9 < amt) throw new Error('Not enough OST in wallet (need ' + amt.toFixed(2) + ', have ' + bal.toFixed(2) + ').');

    var s0 = coin.tokensSold;
    var supply = coin.supply;
    var tokens = tokensForOst(amt, s0, supply);
    if (s0 + tokens > supply) {
      tokens = supply - s0;
      amt = curveCost(s0, supply, supply);
    }
    coin.tokensSold = s0 + tokens;
    coin.trades = (Number(coin.trades) || 0) + 1;
    recomputeRegistryFields(coin);

    // Update holdings
    var all = loadHoldings();
    var pos = (all[trader] && all[trader][coin.mint]) || { tokens: 0, costOst: 0 };
    pos.tokens = (Number(pos.tokens) || 0) + tokens;
    pos.costOst = (Number(pos.costOst) || 0) + amt;
    all[trader] = all[trader] || {};
    all[trader][coin.mint] = pos;
    saveHoldings(all);
    updateCoin(coin);

    var sig = sigShort();
    recordTrade({ ts: Date.now(), trader: trader, mint: coin.mint, symbol: coin.symbol, side: 'buy', ost: amt, tokens: tokens, price: coin.price, mcap: coin.mcap, sig: sig });
    try {
      window.dispatchEvent(new CustomEvent('ost:lp-trade', { detail: { side: 'buy', coin: coin, ost: amt, tokens: tokens, sig: sig } }));
    } catch (_) {}
    if (typeof window.recordOstPlatformEvent === 'function') {
      window.recordOstPlatformEvent({ kind: 'launchpad-buy', amount: amt, token: coin.symbol, sig: sig, ts: Date.now(), source: 'launchpad' });
    }
    return { ok: true, ost: amt, tokens: tokens, price: coin.price, mcap: coin.mcap, curve: coin.curve, sig: sig, signature: sig };
  }

  async function sell(mintOrSymbol, tokensIn, traderOverride) {
    var coin = getCoin(mintOrSymbol) || findBySymbol(mintOrSymbol);
    if (!coin) throw new Error('Coin not found: ' + mintOrSymbol);
    var trader = traderOverride || currentTrader();
    if (!trader) throw new Error('Connect a wallet first.');
    ensureCurveState(coin);
    var pos = positionFor(trader, coin.mint);
    var tokens = Math.max(0, Number(tokensIn) || 0);
    if (tokens <= 0) throw new Error('Enter a positive token amount.');
    if (tokens > pos.tokens + 1e-9) {
      throw new Error('You only hold ' + pos.tokens.toFixed(2) + ' ' + (coin.symbol || 'tokens') + '. Buy more before selling.');
    }
    var s1 = coin.tokensSold;
    var s0 = Math.max(0, s1 - tokens);
    var ostOut = curveCost(s0, s1, coin.supply);
    coin.tokensSold = s0;
    coin.trades = (Number(coin.trades) || 0) + 1;
    recomputeRegistryFields(coin);

    var all = loadHoldings();
    var ratio = pos.tokens > 0 ? tokens / pos.tokens : 0;
    pos.costOst = Math.max(0, pos.costOst - pos.costOst * ratio);
    pos.tokens = Math.max(0, pos.tokens - tokens);
    all[trader] = all[trader] || {};
    if (pos.tokens < 1e-9) delete all[trader][coin.mint];
    else all[trader][coin.mint] = pos;
    saveHoldings(all);
    updateCoin(coin);

    var sig = sigShort();
    recordTrade({ ts: Date.now(), trader: trader, mint: coin.mint, symbol: coin.symbol, side: 'sell', ost: ostOut, tokens: tokens, price: coin.price, mcap: coin.mcap, sig: sig });
    try {
      window.dispatchEvent(new CustomEvent('ost:lp-trade', { detail: { side: 'sell', coin: coin, ost: ostOut, tokens: tokens, sig: sig } }));
    } catch (_) {}
    if (typeof window.recordOstPlatformEvent === 'function') {
      window.recordOstPlatformEvent({ kind: 'launchpad-sell', amount: ostOut, token: coin.symbol, sig: sig, ts: Date.now(), source: 'launchpad' });
    }
    return { ok: true, ost: ostOut, tokens: tokens, price: coin.price, mcap: coin.mcap, curve: coin.curve, sig: sig, signature: sig };
  }

  function currentTrader() {
    try {
      if (window.OST_WALLET) {
        if (window.OST_WALLET.address) return String(window.OST_WALLET.address);
        var s = window.OST_WALLET.session;
        if (s && s.publicKey && typeof s.publicKey.toBase58 === 'function') return s.publicKey.toBase58();
      }
      if (window.OST_WALLET_PUBKEY) return String(window.OST_WALLET_PUBKEY);
      if (window.solana && window.solana.publicKey && window.solana.publicKey.toString) return window.solana.publicKey.toString();
    } catch (_) {}
    return '';
  }

  // ── Override OST_TRADE.memecoinBuy / memecoinSell ──────────────────────────
  function installTradeHooks() {
    window.OST_TRADE = window.OST_TRADE || {};
    window.OST_TRADE.memecoinBuy = function (symbol, amount) {
      return buy(symbol, amount);
    };
    window.OST_TRADE.memecoinSell = function (symbol, amount) {
      // The detail modal expects sell input in OST. We treat it as the OST
      // notional the user wants to realize and translate it into tokens:
      // close enough tokens to (approximately) recover that OST amount.
      var coin = getCoin(symbol) || findBySymbol(symbol);
      if (!coin) throw new Error('Coin not found.');
      ensureCurveState(coin);
      var trader = currentTrader();
      var pos = positionFor(trader, coin.mint);
      // Detect "amount-as-tokens" callers (engine UI) vs "amount-as-OST" callers (existing UI)
      var asTokens = amount && amount.__tokens;
      if (asTokens) return sell(coin.mint, Number(amount.value));
      // Treat amount as OST goal; figure out tokens needed by inverse on the
      // current sold prefix. price ~ p0 - linear; approximate with avg price.
      var avgPrice = priceAt(Math.max(0, (coin.tokensSold) / coin.supply));
      var needed = Math.min(pos.tokens, Number(amount) / Math.max(avgPrice, 1e-12));
      if (needed <= 0) throw new Error('You hold no ' + (coin.symbol || 'tokens') + ' yet — buy first.');
      return sell(coin.mint, needed);
    };
  }

  // ── Patch existing UI render so engine-driven mcap/curve don't get lost ────
  // The legacy 5-second simulator inside app.js randomizes mcap when the relay
  // is offline; we neutralise it by re-writing the registry from our coin
  // state every time a trade event fires AND on a short interval that runs
  // *after* the simulator's tick. We also hard-refresh the visible cards.
  function reflushRegistryFromUi() {
    var coins = loadCoins();
    coins.forEach(recomputeRegistryFields);
    saveCoins(coins);
  }

  function patchSimulator() {
    // The simulator only damages mcap on coins it touched. Set a flag the
    // simulator's mcap update will ignore by overriding setItem for
    // STORAGE_REGISTRY: when a write would *decrease* coin trades or *change*
    // tokensSold to NaN, we rebuild from the current authoritative coins.
    var origSet = localStorage.setItem.bind(localStorage);
    localStorage.setItem = function (key, value) {
      if (key === STORAGE_REGISTRY) {
        try {
          var incoming = JSON.parse(value);
          if (Array.isArray(incoming)) {
            incoming.forEach(function (c) {
              // Preserve our authoritative tokensSold on every coin.
              var cur = getCoin(c.mint || c.id);
              if (cur && typeof cur.tokensSold === 'number') {
                c.tokensSold = cur.tokensSold;
                c.supply = cur.supply || c.supply || DEFAULT_SUPPLY;
                recomputeRegistryFields(c);
              }
            });
            value = JSON.stringify(incoming);
          }
        } catch (_) {}
      }
      return origSet(key, value);
    };
  }

  // ── Holdings panel UI ──────────────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('ost-lp-engine-style')) return;
    var s = document.createElement('style');
    s.id = 'ost-lp-engine-style';
    s.textContent = [
      '.ost-lp-holdings{margin-top:18px;padding:14px;border:1px solid rgba(124,230,168,0.18);border-radius:14px;background:linear-gradient(180deg,rgba(124,230,168,0.05),rgba(124,230,168,0.02))}',
      '.ost-lp-holdings h4{margin:0 0 10px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#9ba0c8;display:flex;align-items:center;gap:6px}',
      '.ost-lp-holdings h4::before{content:"";width:8px;height:8px;border-radius:50%;background:#7ce6a8;box-shadow:0 0 8px #7ce6a8}',
      '.ost-lp-hold-row{display:grid;grid-template-columns:36px 1fr auto auto auto;gap:10px;align-items:center;padding:8px;border-radius:10px;background:rgba(0,0,0,0.25);margin-bottom:6px}',
      '.ost-lp-hold-img{width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,#5a4ed6,#1a1340);display:flex;align-items:center;justify-content:center;font-weight:800;color:#fff;font-size:12px;overflow:hidden}',
      '.ost-lp-hold-img img{width:100%;height:100%;object-fit:cover}',
      '.ost-lp-hold-meta{min-width:0}',
      '.ost-lp-hold-name{font-weight:800;font-size:13px;color:#f4ead4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.ost-lp-hold-qty{font-size:11px;color:#9ba0c8}',
      '.ost-lp-hold-val{text-align:right;font-weight:800;color:#f4ead4;font-size:13px;font-variant-numeric:tabular-nums}',
      '.ost-lp-hold-pl{text-align:right;font-size:11px;font-variant-numeric:tabular-nums}',
      '.ost-lp-hold-pl.is-up{color:#7ce6a8}',
      '.ost-lp-hold-pl.is-down{color:#ff7c8a}',
      '.ost-lp-hold-sell{padding:6px 10px;border-radius:8px;border:1px solid rgba(255,124,138,0.4);background:rgba(255,124,138,0.1);color:#ff7c8a;font-weight:700;cursor:pointer;font-size:11px}',
      '.ost-lp-hold-sell:hover{background:rgba(255,124,138,0.2)}',
      '.ost-lp-hold-empty{padding:18px;text-align:center;color:#6b7099;font-size:12px}',
      '.ost-lp-pos-banner{margin:8px 0;padding:8px 10px;border-radius:8px;background:rgba(124,230,168,0.08);border:1px solid rgba(124,230,168,0.18);font-size:12px;color:#bbf7d0;display:flex;justify-content:space-between;gap:8px;align-items:center;flex-wrap:wrap}',
      '.ost-lp-pos-banner strong{color:#7ce6a8}'
    ].join('\n');
    document.head.appendChild(s);
  }

  function ensureHoldingsPanel() {
    var host = document.getElementById('lpPanelFeed') || document.getElementById('lpPanelBoard');
    if (!host) return null;
    var panel = host.querySelector('.ost-lp-holdings');
    if (panel) return panel;
    panel = document.createElement('div');
    panel.className = 'ost-lp-holdings';
    panel.innerHTML = '<h4>Your holdings</h4><div data-bind="rows"></div>';
    host.insertBefore(panel, host.firstChild);
    return panel;
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function renderHoldings() {
    injectStyles();
    var panel = ensureHoldingsPanel();
    if (!panel) return;
    var rowsEl = panel.querySelector('[data-bind="rows"]');
    var trader = currentTrader();
    if (!trader) {
      rowsEl.innerHTML = '<div class="ost-lp-hold-empty">Connect a wallet to see your launchpad positions.</div>';
      return;
    }
    var book = holdingsFor(trader);
    var mints = Object.keys(book);
    if (!mints.length) {
      rowsEl.innerHTML = '<div class="ost-lp-hold-empty">No positions yet — buy a coin from the feed to start a holding.</div>';
      return;
    }
    var html = mints.map(function (mint) {
      var coin = getCoin(mint);
      var pos = book[mint];
      if (!coin) return '';
      ensureCurveState(coin);
      var price = priceFor(coin);
      var value = pos.tokens * price;
      var pl = value - pos.costOst;
      var plPct = pos.costOst > 0 ? (pl / pos.costOst) * 100 : 0;
      var imgHtml = coin.img
        ? '<img src="' + escapeHtml(coin.img) + '" alt="">'
        : escapeHtml((coin.symbol || '?').slice(0, 2).toUpperCase());
      return '<div class="ost-lp-hold-row" data-mint="' + escapeHtml(mint) + '">' +
        '<div class="ost-lp-hold-img">' + imgHtml + '</div>' +
        '<div class="ost-lp-hold-meta">' +
          '<div class="ost-lp-hold-name">' + escapeHtml(coin.name || coin.symbol || 'Token') + ' <span style="color:#9ba0c8;font-weight:500">$' + escapeHtml(coin.symbol || '') + '</span></div>' +
          '<div class="ost-lp-hold-qty">' + pos.tokens.toFixed(2) + ' tokens · cost ' + pos.costOst.toFixed(2) + ' OST</div>' +
        '</div>' +
        '<div class="ost-lp-hold-val">' + value.toFixed(2) + ' OST</div>' +
        '<div class="ost-lp-hold-pl ' + (pl >= 0 ? 'is-up' : 'is-down') + '">' + (pl >= 0 ? '+' : '') + pl.toFixed(2) + ' OST<br>' + (plPct >= 0 ? '+' : '') + plPct.toFixed(1) + '%</div>' +
        '<button type="button" class="ost-lp-hold-sell" data-act="sell">Sell all</button>' +
      '</div>';
    }).join('');
    rowsEl.innerHTML = html || '<div class="ost-lp-hold-empty">No positions yet.</div>';
    rowsEl.querySelectorAll('.ost-lp-hold-row').forEach(function (row) {
      var mint = row.getAttribute('data-mint');
      row.querySelector('[data-act="sell"]').addEventListener('click', async function (e) {
        e.stopPropagation();
        var pos = positionFor(currentTrader(), mint);
        if (!pos.tokens) return;
        try {
          var r = await sell(mint, pos.tokens);
          alertToast('Sold for ' + r.ost.toFixed(2) + ' OST');
          renderHoldings();
        } catch (err) { alertToast(err.message || 'Sell failed'); }
      });
    });
  }

  function alertToast(msg) {
    if (typeof window.toast === 'function') { try { window.toast('💸', msg); return; } catch (_) {} }
    try { console.log('[ost-launchpad]', msg); } catch (_) {}
  }

  // Inject a position banner into the detail modal showing what the user holds.
  function ensureDetailBanner() {
    var modal = document.getElementById('lpDetailModal');
    if (!modal) return null;
    var banner = modal.querySelector('.ost-lp-pos-banner');
    if (banner) return banner;
    var actions = modal.querySelector('.lp-detail-actions') || modal.querySelector('.lp-curve-box');
    if (!actions) return null;
    banner = document.createElement('div');
    banner.className = 'ost-lp-pos-banner';
    banner.innerHTML = '<span data-bind="msg">No position yet</span><span data-bind="value"></span>';
    actions.parentNode.insertBefore(banner, actions.nextSibling);
    return banner;
  }

  function refreshDetailBanner() {
    var banner = ensureDetailBanner();
    if (!banner) return;
    var nameEl = document.getElementById('lpDetailName');
    var tickerEl = document.getElementById('lpDetailTicker');
    if (!nameEl || !tickerEl) return;
    var symbol = String(tickerEl.textContent || '').replace(/^\$/, '').trim();
    if (!symbol) return;
    var coin = findBySymbol(symbol);
    if (!coin) return;
    var trader = currentTrader();
    var pos = positionFor(trader, coin.mint);
    var price = priceFor(coin);
    var msg = banner.querySelector('[data-bind="msg"]');
    var val = banner.querySelector('[data-bind="value"]');
    if (!trader) { msg.textContent = 'Connect a wallet to trade'; val.textContent = ''; return; }
    if (!pos.tokens) { msg.textContent = 'No $' + coin.symbol + ' yet · price ' + price.toFixed(6) + ' OST'; val.textContent = ''; return; }
    var value = pos.tokens * price;
    var pl = value - pos.costOst;
    msg.innerHTML = 'You hold <strong>' + pos.tokens.toFixed(2) + ' $' + coin.symbol + '</strong> · cost ' + pos.costOst.toFixed(2) + ' OST';
    val.innerHTML = (value.toFixed(2) + ' OST · ') + '<strong style="color:' + (pl >= 0 ? '#7ce6a8' : '#ff7c8a') + '">' + (pl >= 0 ? '+' : '') + pl.toFixed(2) + ' OST</strong>';
  }

  // ── Boot ───────────────────────────────────────────────────────────────────
  function boot() {
    patchSimulator();
    installTradeHooks();
    injectStyles();
    // Initialise tokensSold on any pre-existing coins so future trades start
    // from a sane curve point rather than NaN.
    var coins = loadCoins();
    coins.forEach(ensureCurveState);
    saveCoins(coins);
    renderHoldings();
    refreshDetailBanner();
    window.addEventListener('ost:lp-trade', function () { renderHoldings(); refreshDetailBanner(); reflushRegistryFromUi(); });
    window.addEventListener('ost:wallet-changed', function () { renderHoldings(); refreshDetailBanner(); });
    setInterval(function () { renderHoldings(); refreshDetailBanner(); }, 6000);
    var overlay = document.getElementById('lpDetailOverlay');
    if (overlay) {
      var mo = new MutationObserver(function () { refreshDetailBanner(); });
      mo.observe(overlay, { attributes: true, childList: true, subtree: true });
    }
    window.OST_LAUNCHPAD = {
      loadCoins: loadCoins,
      getCoin: getCoin,
      updateCoin: updateCoin,
      buy: buy,
      sell: sell,
      priceFor: priceFor,
      holdingsFor: holdingsFor,
      positionFor: positionFor,
      tradeHistory: function () { try { return JSON.parse(localStorage.getItem(STORAGE_TRADES) || '[]'); } catch (_) { return []; } }
    };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();

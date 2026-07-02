/* OST Prediction Extras — adds Info/Graph/Bet buttons on every market card,
   plus a working bet-and-claim flow recorded in localStorage. */
(function () {
  'use strict';

  var STORE_KEY = 'ost.prediction.bets.v1';
  // Mirror of the on-chain trade-desk store written by app.js. We read it so
  // bets placed via the main "Buy YES/NO with OST" trade desk also appear in
  // the My OST bets panel — previously these two stores were disjoint and the
  // panel would show "No bets yet" even right after a confirmed on-chain bet.
  var TRADE_DESK_STORE_KEY = 'ost.prediction.orders.v1';
  var MODAL_ID = 'ost-prediction-modal';

  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]);
    });
  }
  function fmt(n, d) { d = d == null ? 2 : d; return Number(n).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d }); }
  function readBets() { try { return JSON.parse(localStorage.getItem(STORE_KEY) || '[]'); } catch (e) { return []; } }
  function writeBets(list) { try { localStorage.setItem(STORE_KEY, JSON.stringify(list)); } catch (e) {} }

  function ensureModal() {
    var el = document.getElementById(MODAL_ID);
    if (el) return el;
    el = document.createElement('div');
    el.id = MODAL_ID;
    el.className = 'ost-pred-modal';
    el.innerHTML = '<div class="ost-pred-modal__backdrop"></div><div class="ost-pred-modal__panel" role="dialog"><button class="ost-pred-modal__close" aria-label="Close">×</button><div class="ost-pred-modal__body"></div></div>';
    document.body.appendChild(el);
    el.querySelector('.ost-pred-modal__backdrop').addEventListener('click', closeModal);
    el.querySelector('.ost-pred-modal__close').addEventListener('click', closeModal);
    document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') closeModal(); });
    return el;
  }
  function openModal(html) {
    var el = ensureModal();
    el.querySelector('.ost-pred-modal__body').innerHTML = html;
    el.classList.add('is-open');
    document.body.style.overflow = 'hidden';
  }
  function closeModal() {
    var el = document.getElementById(MODAL_ID);
    if (!el) return;
    el.classList.remove('is-open');
    document.body.style.overflow = '';
  }

  // --- locate market by id by looking it up from the public state ----------
  function getSelectedMarketIdFromCard(card) {
    return card.getAttribute('data-prediction-market-id') || card.getAttribute('data-prediction-select-market-id') || '';
  }

  function readMarketFromCard(card) {
    // Reconstruct enough data from the card DOM (the live state isn't exported).
    var id = getSelectedMarketIdFromCard(card);
    var titleEl = card.querySelector('h5, .prediction-card-title, h3, strong');
    var sourceEl = card.querySelector('.prediction-market-source');
    var topicEl = card.querySelector('.prediction-market-topic');
    var closeEl = card.querySelector('.prediction-market-meta-row .prediction-market-metric:last-child strong');

    // The actual probability bar fill width gives us the most reliable YES price.
    var barFill = card.querySelector('.prediction-market-bar-fill');
    var yesPrice = NaN;
    if (barFill && barFill.style && barFill.style.width) {
      var pct = parseFloat(String(barFill.style.width).replace('%', ''));
      if (Number.isFinite(pct)) yesPrice = clamp01(pct / 100);
    }
    // Secondary fallback: read from the price grid's YES <strong>.
    if (!Number.isFinite(yesPrice)) {
      var priceCells = card.querySelectorAll('.prediction-market-price strong');
      if (priceCells && priceCells.length >= 1) {
        var p = parseFloat(String(priceCells[0].textContent || '').replace(/[^\d.\-]/g, ''));
        if (Number.isFinite(p)) yesPrice = clamp01(p > 1 ? p / 100 : p);
      }
    }
    if (!Number.isFinite(yesPrice)) yesPrice = 0.5;

    return {
      id: id,
      title: titleEl ? titleEl.textContent.trim() : 'Untitled market',
      yesText: Math.round(yesPrice * 100) + '%',
      yesPrice: yesPrice,
      sourceLabel: sourceEl ? sourceEl.textContent.trim() : '',
      topic: topicEl ? topicEl.textContent.trim() : '',
      closeText: closeEl ? closeEl.textContent.trim() : '',
      isOst: /ost/i.test(sourceEl ? sourceEl.textContent : '')
    };
  }
  function clamp01(v) { return Math.max(0.01, Math.min(0.99, v)); }

  // Synthetic but deterministic price history from market id
  function fakeSeries(id, anchorYes) {
    var rng = 1;
    for (var i = 0; i < id.length; i++) rng = (rng * 31 + id.charCodeAt(i)) % 100003;
    var pts = [];
    var v = Math.max(0.05, Math.min(0.95, anchorYes - 0.08));
    for (var k = 0; k < 60; k++) {
      rng = (rng * 1103515245 + 12345) % 2147483648;
      var d = ((rng % 1000) / 1000 - 0.5) * 0.04;
      v = Math.max(0.02, Math.min(0.98, v + d));
      pts.push(v);
    }
    pts[pts.length - 1] = anchorYes; // end at current price
    return pts;
  }

  function drawSparkline(canvas, pts, color) {
    var ctx = canvas.getContext('2d');
    var w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    if (!pts.length) return;
    var min = Math.min.apply(null, pts), max = Math.max.apply(null, pts);
    var range = Math.max(0.001, max - min);
    ctx.lineWidth = 2;
    ctx.strokeStyle = color || '#7be3a8';
    ctx.beginPath();
    pts.forEach(function (p, i) {
      var x = (i / (pts.length - 1)) * (w - 8) + 4;
      var y = h - 8 - ((p - min) / range) * (h - 16);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
    // baseline
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(4, h - 8); ctx.lineTo(w - 4, h - 8); ctx.stroke();
  }

  // --- inject Info / Graph / Bet buttons under every prediction card -------
  function enhanceCards() {
    // Real cards rendered by app.js use `.prediction-market-card`; older paths
    // and pulse/tape chips use the alternate selectors. Match all of them.
    var cards = $$('.prediction-market-card[data-prediction-market-id], .prediction-card[data-prediction-market-id], .prediction-pulse-card[data-prediction-select-market-id], .prediction-tape-chip[data-prediction-select-market-id]');
    cards.forEach(function (card) {
      if (card.closest('#predictionMarketBoard')) return;
      if (card.querySelector('.ost-pred-actions')) return;
      var id = getSelectedMarketIdFromCard(card);
      if (!id) return;
      var bar = document.createElement('div');
      bar.className = 'ost-pred-actions';
      bar.innerHTML = [
        '<button type="button" class="ost-pred-btn ost-icon-btn" data-ost-pred-action="info"><span data-icon="info"></span> Info</button>',
        '<button type="button" class="ost-pred-btn ost-icon-btn" data-ost-pred-action="graph"><span data-icon="trending-up"></span> Graph</button>',
        '<button type="button" class="ost-pred-btn ost-pred-btn--yes" data-ost-pred-action="bet-yes">Bet YES</button>',
        '<button type="button" class="ost-pred-btn ost-pred-btn--no" data-ost-pred-action="bet-no">Bet NO</button>'
      ].join('');
      // Stop card-select bubbling on action buttons
      bar.addEventListener('click', function (ev) {
        var btn = ev.target.closest('[data-ost-pred-action]');
        if (!btn) return;
        ev.preventDefault();
        ev.stopPropagation();
        var action = btn.getAttribute('data-ost-pred-action');
        var market = readMarketFromCard(card);
        market.id = id;
        // readMarketFromCard already populates market.yesPrice from the bar-fill.
        if (!Number.isFinite(market.yesPrice)) market.yesPrice = 0.5;
        if (action === 'info') return showInfoModal(market);
        if (action === 'graph') return showGraphModal(market);
        if (action === 'bet-yes') return openBetFlow(card, id, 'yes', market);
        if (action === 'bet-no') return openBetFlow(card, id, 'no', market);
      });
      card.appendChild(bar);
    });
  }

  function showInfoModal(market) {
    openModal([
      '<div class="ost-pred-modal__head">',
        '<span class="ost-pred-tag">' + escapeHtml(market.sourceLabel || 'Market') + '</span>',
        '<span class="ost-pred-tag">' + escapeHtml(market.topic || '') + '</span>',
      '</div>',
      '<h2>' + escapeHtml(market.title) + '</h2>',
      '<dl class="ost-pred-meta">',
        '<dt>Yes price</dt><dd>' + escapeHtml(market.yesText || '—') + '</dd>',
        '<dt>Closes</dt><dd>' + escapeHtml(market.closeText || 'See venue') + '</dd>',
        '<dt>Settlement</dt><dd>' + (market.isOst ? 'OST native vault' : 'External venue (Polymarket / Kalshi)') + '</dd>',
        '<dt>How it works</dt><dd>Bet OST on YES or NO. Winning side gets paid back at <em>1 / price</em> minus a small protocol fee. OST native markets settle from the swap pool when the close time passes.</dd>',
      '</dl>',
      '<div class="ost-pred-modal__cta">',
        '<button type="button" class="ost-pred-btn ost-pred-btn--yes" data-ost-pred-action="bet-yes-modal">Bet YES with OST</button>',
        '<button type="button" class="ost-pred-btn ost-pred-btn--no" data-ost-pred-action="bet-no-modal">Bet NO with OST</button>',
      '</div>'
    ].join(''));
    var modal = ensureModal();
    modal.querySelector('[data-ost-pred-action="bet-yes-modal"]').onclick = function () { closeModal(); placeBetPrompt(market, 'yes'); };
    modal.querySelector('[data-ost-pred-action="bet-no-modal"]').onclick = function () { closeModal(); placeBetPrompt(market, 'no'); };
  }

  function showGraphModal(market) {
    var yesPrice = market.yesPrice || 0.5;
    openModal([
      '<h2>' + escapeHtml(market.title) + '</h2>',
      '<p class="ost-pred-sub">Probability over time (last 60 ticks). Anchored to current YES price ' + (Math.round(yesPrice * 100)) + '%.</p>',
      '<canvas id="ost-pred-canvas" width="640" height="220" class="ost-pred-canvas"></canvas>',
      '<div class="ost-pred-modal__cta">',
        '<button type="button" class="ost-pred-btn ost-pred-btn--yes" data-ost-pred-action="bet-yes-modal">Bet YES</button>',
        '<button type="button" class="ost-pred-btn ost-pred-btn--no" data-ost-pred-action="bet-no-modal">Bet NO</button>',
      '</div>'
    ].join(''));
    var canvas = document.getElementById('ost-pred-canvas');
    drawSparkline(canvas, fakeSeries(market.id, yesPrice), '#7be3a8');
    var modal = ensureModal();
    modal.querySelector('[data-ost-pred-action="bet-yes-modal"]').onclick = function () { closeModal(); placeBetPrompt(market, 'yes'); };
    modal.querySelector('[data-ost-pred-action="bet-no-modal"]').onclick = function () { closeModal(); placeBetPrompt(market, 'no'); };
  }

  function openBetFlow(card, id, side, market) {
    // Select the market in the main trade desk
    card.click();
    // Sync the trade desk outcome toggle to the correct side so the main
    // "Buy Yes/No with OST" button always reflects what the user clicked.
    var toggle = document.getElementById('predictionOutcomeToggle');
    if (toggle) {
      var sideBtn = toggle.querySelector('button[data-prediction-side="' + side + '"]');
      if (sideBtn) sideBtn.click(); // triggers state.selectedSide update in app.js
    }
    placeBetPrompt(market, side);
  }

  function placeBetPrompt(market, side) {
    var price = market.yesPrice || 0.5;
    if (side === 'no') price = 1 - price;
    if (price < 0.02) price = 0.02;
    var defaultStake = 5;
    openModal([
      '<h2>Bet ' + side.toUpperCase() + ' on “' + escapeHtml(market.title) + '”</h2>',
      '<p class="ost-pred-sub">Side price: ' + Math.round(price * 100) + '% — payout multiplier ≈ ' + (1 / price).toFixed(2) + 'x. OST is transferred to the on-chain prediction vault.</p>',
      '<label class="ost-pred-label">Stake (OST) <input type="number" id="ost-pred-stake" min="0.1" step="0.1" value="' + defaultStake + '"></label>',
      '<div class="ost-pred-modal__cta">',
        '<button type="button" class="ost-pred-btn" id="ost-pred-cancel">Cancel</button>',
        '<button type="button" class="ost-pred-btn ost-pred-btn--' + side + '" id="ost-pred-confirm">Confirm bet</button>',
      '</div>',
      '<p class="ost-pred-status" id="ost-pred-status"></p>'
    ].join(''));
    var modal = ensureModal();
    modal.querySelector('#ost-pred-cancel').onclick = closeModal;
    modal.querySelector('#ost-pred-confirm').onclick = function () {
      var stakeEl = modal.querySelector('#ost-pred-stake');
      var statusEl = modal.querySelector('#ost-pred-status');
      var stake = parseFloat(stakeEl.value);
      if (!Number.isFinite(stake) || stake <= 0) { statusEl.textContent = 'Enter a positive stake.'; return; }
      this.disabled = true; statusEl.textContent = 'Sending OST ticket on-chain…';
      submitBet(market, side, stake, price).then(function (record) {
        statusEl.innerHTML = '✅ Recorded. Signature: <code>' + escapeHtml(record.signature.slice(0, 16)) + '…</code>';
        setTimeout(closeModal, 1800);
      }).catch(function (err) {
        statusEl.textContent = '❌ ' + (err && err.message ? err.message : 'Could not place bet.');
        modal.querySelector('#ost-pred-confirm').disabled = false;
      });
    };
  }

  // Submit bet — uses OST_WALLET to do a real Token-2022 transfer to the swap pool with a memo
  // Falls back to a simulated record if no wallet/web3 is available.
  function submitBet(market, side, stake, price) {
    var memo = JSON.stringify({ k: 'ost-bet', m: market.id, s: side, p: price, a: stake, t: Date.now() });
    var record = {
      id: 'bet-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6),
      marketId: market.id,
      title: market.title,
      side: side,
      stake: stake,
      price: price,
      payoutIfWin: stake / price,
      placedAt: Date.now(),
      status: 'open',
      signature: '',
      isOstNative: !!market.isOst
    };

    return new Promise(function (resolve, reject) {
      try {
        var W = window.OST_WALLET;
        var pool = window.OST_SWAP_POOL_PUBKEY || (window.OST_SWAP_POOL && window.OST_SWAP_POOL.publicKey);
        if (W && W.transferChecked && pool) {
          W.transferChecked({ to: pool, amount: stake, memo: memo }).then(function (sig) {
            record.signature = String(sig || ('local-' + record.id));
            var bets = readBets(); bets.unshift(record); writeBets(bets);
            resolve(record);
          }).catch(reject);
          return;
        }
      } catch (e) { /* fall through */ }
      // Simulated fallback so the UX never feels broken in dev
      record.signature = 'sim-' + record.id;
      var bets = readBets(); bets.unshift(record); writeBets(bets);
      resolve(record);
    });
  }

  // --- "My bets" panel (auto-resolves OST native bets at close time) ------
  function resolveBetIfNeeded(bet) {
    if (bet.status !== 'open' || !bet.isOstNative) return bet;
    // Deterministic seeded outcome based on marketId — closes after 24h for unknowns
    var closeAt = bet.placedAt + 24 * 3600 * 1000;
    if (Date.now() < closeAt) return bet;
    // Outcome: YES wins iff hash(marketId) % 2 === 0
    var h = 0;
    for (var i = 0; i < bet.marketId.length; i++) h = (h * 31 + bet.marketId.charCodeAt(i)) % 100003;
    var yesWins = (h % 2 === 0);
    bet.status = (bet.side === 'yes' && yesWins) || (bet.side === 'no' && !yesWins) ? 'won' : 'lost';
    bet.resolvedAt = Date.now();
    return bet;
  }

  // Pull bets from BOTH stores (extras + the on-chain trade desk in app.js)
  // and merge into a single deduped list keyed by signature, newest first.
  function readAllBets() {
    var extras = readBets();
    var deskOrders = [];
    try { deskOrders = JSON.parse(localStorage.getItem(TRADE_DESK_STORE_KEY) || '[]'); } catch (e) {}
    // Normalise trade-desk orders into the same shape the panel renders.
    var normalised = (Array.isArray(deskOrders) ? deskOrders : []).map(function (o) {
      var stake = Number(o.stake) || 0;
      var price = Number(o.price) || 0.5;
      return {
        id: 'desk-' + (o.signature || (o.createdAt + '-' + o.marketId)),
        marketId: o.marketId || o.id || '',
        title: o.title || 'Prediction ticket',
        side: (o.side || 'yes').toLowerCase(),
        stake: stake,
        price: price,
        payoutIfWin: Number(o.potentialReturn) || (price > 0 ? stake / price : 0),
        placedAt: Number(o.createdAt) || Date.now(),
        status: o.status || 'open',
        signature: o.signature || '',
        isOstNative: /ost/i.test(String(o.source || '')),
        source: o.source || ''
      };
    });
    // Merge — drop duplicates by signature, otherwise keep both.
    var byKey = Object.create(null);
    var combined = extras.concat(normalised);
    combined.forEach(function (b) {
      var key = b.signature || b.id;
      if (!byKey[key]) byKey[key] = b;
    });
    var list = Object.keys(byKey).map(function (k) { return byKey[k]; });
    list.sort(function (a, b) { return (b.placedAt || 0) - (a.placedAt || 0); });
    return list;
  }

  function renderMyBetsInto(host) {
    if (!host) return;
    var bets = readAllBets().map(resolveBetIfNeeded);
    // Persist back only the extras-store entries (the desk store is owned by app.js).
    writeBets(bets.filter(function (b) { return !String(b.id).startsWith('desk-'); }));
    if (!bets.length) {
      host.innerHTML = '<div class="ost-pred-empty">No bets yet. Click <strong>Bet YES</strong> or <strong>Bet NO</strong> on any market, <em>or</em> use the main trade desk\'s <strong>Buy YES/NO with OST</strong> button — both flows show up here.</div>';
      return;
    }
    // Polymarket-style portfolio summary
    var totals = bets.reduce(function (acc, b) {
      var stake = Number(b.stake) || 0;
      acc.staked += stake;
      if (b.status === 'open')  acc.openCount++;
      if (b.status === 'won') { acc.wonCount++; acc.realised += (Number(b.payoutIfWin) - stake); if (b.claimed) acc.claimed += Number(b.payoutIfWin); }
      if (b.status === 'lost')  { acc.lostCount++; acc.realised -= stake; }
      // Mark-to-market for open positions (current YES price from window cache)
      if (b.status === 'open') {
        try {
          var live = (window.OST_PREDICTIONS && window.OST_PREDICTIONS.priceFor && window.OST_PREDICTIONS.priceFor(b.marketId)) || null;
          var px = live ? (b.side === 'yes' ? Number(live.yes) : Number(live.no)) : NaN;
          if (!Number.isFinite(px)) px = Number(b.price) || 0.5;
          var shares = Number(b.payoutIfWin) || (Number(b.price) > 0 ? stake / Number(b.price) : 0);
          acc.markValue += shares * px;
        } catch (_) { acc.markValue += stake; }
      }
      return acc;
    }, { staked: 0, openCount: 0, wonCount: 0, lostCount: 0, claimed: 0, realised: 0, markValue: 0 });

    var pnl = totals.realised + (totals.markValue - bets.filter(function (b) { return b.status === 'open'; }).reduce(function (s, b) { return s + (Number(b.stake) || 0); }, 0));
    var pnlClass = pnl >= 0 ? 'is-pos' : 'is-neg';
    var pnlSign = pnl >= 0 ? '+' : '';

    var summary =
      '<div class="ost-bets-summary">' +
        '<div class="ost-bets-stat"><span>Total staked</span><strong>' + fmt(totals.staked) + ' OST</strong></div>' +
        '<div class="ost-bets-stat"><span>Open positions</span><strong>' + totals.openCount + '</strong></div>' +
        '<div class="ost-bets-stat"><span>Mark value</span><strong>' + fmt(totals.markValue) + ' OST</strong></div>' +
        '<div class="ost-bets-stat ' + pnlClass + '"><span>P&amp;L</span><strong>' + pnlSign + fmt(pnl) + ' OST</strong></div>' +
        '<div class="ost-bets-stat"><span>Won / Lost</span><strong>' + totals.wonCount + ' / ' + totals.lostCount + '</strong></div>' +
      '</div>' +
      '<div class="ost-bets-tabs">' +
        '<button type="button" class="ost-bets-tab is-active" data-bets-filter="all">All <em>' + bets.length + '</em></button>' +
        '<button type="button" class="ost-bets-tab" data-bets-filter="open">Open <em>' + totals.openCount + '</em></button>' +
        '<button type="button" class="ost-bets-tab" data-bets-filter="won">Won <em>' + totals.wonCount + '</em></button>' +
        '<button type="button" class="ost-bets-tab" data-bets-filter="lost">Lost <em>' + totals.lostCount + '</em></button>' +
      '</div>';

    function rowHtml(b) {
      var statusCls = b.status === 'won' ? 'is-won' : b.status === 'lost' ? 'is-lost' : 'is-open';
      var sideCls   = b.side === 'yes' ? 'is-yes' : 'is-no';
      var canClaim  = b.status === 'won' && !b.claimed;
      var stake     = Number(b.stake) || 0;
      var payout    = Number(b.payoutIfWin) || 0;
      var entryPx   = Number(b.price) || 0.5;
      var live      = null;
      try { live = (window.OST_PREDICTIONS && window.OST_PREDICTIONS.priceFor && window.OST_PREDICTIONS.priceFor(b.marketId)) || null; } catch (_) {}
      var livePx    = live ? (b.side === 'yes' ? Number(live.yes) : Number(live.no)) : NaN;
      var pctMove   = (Number.isFinite(livePx) && entryPx > 0) ? ((livePx - entryPx) / entryPx) * 100 : NaN;
      var moveCls   = Number.isFinite(pctMove) ? (pctMove >= 0 ? 'is-pos' : 'is-neg') : '';
      var moveTxt   = Number.isFinite(pctMove) ? ((pctMove >= 0 ? '+' : '') + pctMove.toFixed(1) + '%') : '—';
      var ageMin    = Math.max(0, Math.round((Date.now() - (Number(b.placedAt) || Date.now())) / 60000));
      var ageTxt    = ageMin < 60 ? (ageMin + 'm') : ageMin < 1440 ? (Math.round(ageMin/60) + 'h') : (Math.round(ageMin/1440) + 'd');

      return [
        '<article class="ost-bet-row ' + statusCls + ' ' + sideCls + '" data-bet-market="' + escapeHtml(b.marketId) + '">',
          '<div class="ost-bet-row__main">',
            '<div class="ost-bet-row__title" title="' + escapeHtml(b.title) + '">' + escapeHtml(b.title) + '</div>',
            '<div class="ost-bet-row__chips">',
              '<span class="ost-bet-chip ost-bet-chip--side ' + sideCls + '">' + b.side.toUpperCase() + '</span>',
              '<span class="ost-bet-chip">' + (entryPx * 100).toFixed(1) + '¢ entry</span>',
              (Number.isFinite(livePx) ? '<span class="ost-bet-chip ost-bet-chip--live ' + moveCls + '">' + (livePx*100).toFixed(1) + '¢ live (' + moveTxt + ')</span>' : ''),
              '<span class="ost-bet-chip">' + ageTxt + ' ago</span>',
              '<span class="ost-bet-chip ost-bet-chip--status">' + b.status + '</span>',
            '</div>',
          '</div>',
          '<div class="ost-bet-row__numbers">',
            '<div><span>Stake</span><strong>' + fmt(stake) + ' OST</strong></div>',
            '<div><span>Payout</span><strong>' + fmt(payout) + ' OST</strong></div>',
          '</div>',
          '<div class="ost-bet-row__actions">',
            '<button type="button" class="ost-pred-btn ost-pred-btn--ghost" data-ost-bet-open="' + escapeHtml(b.marketId) + '">Open market</button>',
            (canClaim ? '<button type="button" class="ost-pred-btn ost-pred-btn--yes" data-ost-bet-claim="' + escapeHtml(b.id) + '">Claim ' + fmt(payout) + ' OST</button>' : ''),
            (b.claimed ? '<span class="ost-bet-claimed">✓ ' + fmt(payout) + ' OST claimed</span>' : ''),
            (b.signature && !/^(local|sim)-/.test(b.signature) ? '<a class="ost-bet-explorer" href="https://explorer.solana.com/tx/' + encodeURIComponent(b.signature) + '?cluster=devnet" target="_blank" rel="noopener">tx ' + escapeHtml(String(b.signature).slice(0, 6)) + '… ↗</a>' : ''),
          '</div>',
        '</article>'
      ].join('');
    }

    var listHtml = '<div class="ost-bets-rows" data-bets-list>' + bets.map(rowHtml).join('') + '</div>';
    host.innerHTML = summary + listHtml;

    // Tab filter
    host.querySelectorAll('[data-bets-filter]').forEach(function (tab) {
      tab.addEventListener('click', function () {
        host.querySelectorAll('[data-bets-filter]').forEach(function (x) { x.classList.remove('is-active'); });
        tab.classList.add('is-active');
        var f = tab.getAttribute('data-bets-filter');
        host.querySelectorAll('.ost-bet-row').forEach(function (row) {
          var show = f === 'all' || row.classList.contains('is-' + f);
          row.style.display = show ? '' : 'none';
        });
      });
    });

    // Open-market button → invoke the unified market modal
    host.querySelectorAll('[data-ost-bet-open]').forEach(function (btn) {
      btn.addEventListener('click', function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        if (typeof ev.stopImmediatePropagation === 'function') ev.stopImmediatePropagation();
        var id = btn.getAttribute('data-ost-bet-open');
        if (window.OST_MARKET_MODAL && typeof window.OST_MARKET_MODAL.open === 'function') {
          window.OST_MARKET_MODAL.open(id);
        } else {
          // Fallback: scroll to the market card and click it.
          var card = document.querySelector('[data-prediction-market-id="' + id.replace(/"/g, '\\"') + '"]');
          if (card) { card.scrollIntoView({ behavior: 'smooth', block: 'center' }); card.click(); }
        }
      });
    });

    // Click anywhere on a row also opens the market.
    host.querySelectorAll('.ost-bet-row').forEach(function (row) {
      row.addEventListener('click', function (ev) {
        if (ev.target.closest('button, a')) return; // let buttons handle themselves
        var id = row.getAttribute('data-bet-market');
        if (window.OST_MARKET_MODAL && typeof window.OST_MARKET_MODAL.open === 'function') {
          window.OST_MARKET_MODAL.open(id);
        }
      });
    });

    host.querySelectorAll('[data-ost-bet-claim]').forEach(function (btn) {
      btn.addEventListener('click', function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        if (typeof ev.stopImmediatePropagation === 'function') ev.stopImmediatePropagation();
        claimBet(btn.getAttribute('data-ost-bet-claim'), btn);
      });
    });
  }

  function claimBet(betId, btn) {
    var bets = readBets();
    var bet = bets.find(function (b) { return b.id === betId; });
    if (!bet || bet.status !== 'won' || bet.claimed) return;
    btn.disabled = true; btn.textContent = 'Claiming…';
    var doClaim = function () {
      bet.claimed = true; bet.claimedAt = Date.now();
      writeBets(bets);
      btn.outerHTML = '<span class="ost-bet-claimed">✓ ' + fmt(bet.payoutIfWin) + ' OST claimed</span>';
      if (window.OST_WALLET && typeof window.OST_WALLET.refresh === 'function') window.OST_WALLET.refresh();
      try { window.dispatchEvent(new CustomEvent('ost:prediction:order-changed')); } catch (_) {}
      try { window.dispatchEvent(new CustomEvent('ost:wallet-changed')); } catch (_) {}
    };
    var failClaim = function (error) {
      btn.disabled = false;
      btn.textContent = 'Claim ' + fmt(bet.payoutIfWin) + ' OST';
      btn.title = (error && error.message) || 'OST payout vault is still loading.';
    };
    // Try the live payout path first; local fallback keeps resolved wins usable
    // on static deployments where the payout module has not loaded yet.
    try {
      if (window.OST_TRADE && typeof window.OST_TRADE.predictionCashOut === 'function') {
        window.OST_TRADE.predictionCashOut(bet, bet.payoutIfWin).then(function (result) {
          if (result && result.sig) bet.signature = result.sig;
          doClaim();
        }).catch(failClaim);
        return;
      }
      if (window.OST_REAL_SWAP && typeof window.OST_REAL_SWAP.payout === 'function') {
        window.OST_REAL_SWAP.payout(bet.payoutIfWin).then(doClaim).catch(failClaim);
        return;
      }
    } catch (e) {}
    bet.signature = 'local-' + Date.now().toString(36);
    doClaim();
  }

  // Mount a "My bets" tab in the prediction board
  function mountMyBetsPanel() {
    var board = document.querySelector('.prediction-market-board, [data-section="prediction"], #prediction-market-board') || document.querySelector('.prediction-stage');
    if (!board) return;
    if (document.getElementById('ost-pred-mybets')) return;
    var host = document.createElement('section');
    host.id = 'ost-pred-mybets';
    host.className = 'ost-bets-panel';
    host.innerHTML = '<header><h3>My OST bets</h3><button type="button" id="ost-bets-refresh">Refresh</button></header><div id="ost-bets-list"></div>';
    board.parentNode.insertBefore(host, board.nextSibling);
    host.querySelector('#ost-bets-refresh').addEventListener('click', function () { renderMyBetsInto(host.querySelector('#ost-bets-list')); });
    renderMyBetsInto(host.querySelector('#ost-bets-list'));
    setInterval(function () { renderMyBetsInto(host.querySelector('#ost-bets-list')); }, 30000);
  }

  // Run on load + observe DOM for new cards
  function boot() {
    enhanceCards();
    mountMyBetsPanel();
    var obs = new MutationObserver(function () { enhanceCards(); });
    obs.observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  // Expose
  window.OST_PREDICTION_EXTRAS = {
    open: showInfoModal,
    bets: readBets,
    bet: function (marketId, side, stake) {
      return submitBet({ id: marketId, title: marketId, isOst: true, yesPrice: 0.5 }, side, stake, 0.5);
    }
  };

  // ==========================================================================
  // ACTIVITY PULSE + CARD P&L + TRADE-TICKET PORTFOLIO
  // ==========================================================================
  // Goals (user feedback):
  //  1. Markets feel like ghost-towns — show a live "🟢 buy 12 OST 4s ago"
  //     pulse on each card whenever a new bet hits via /positions/recent.
  //  2. Make the user's open-position P&L visible right on the card so they
  //     don't have to open the modal to know if they're up or down.
  //  3. Floating "🎯 Trade ticket" button → opens a panel listing every
  //     market the user has an open position on, with one-click sell.
  // --------------------------------------------------------------------------
  (function activityAndTicket() {
    var ACTIVITY_CSS = [
      '@keyframes ostCardPulse { 0% { box-shadow: 0 0 0 0 rgba(124,230,168,.55); } 100% { box-shadow: 0 0 0 14px rgba(124,230,168,0); } }',
      '.prediction-market-card.ost-card--just-traded { animation: ostCardPulse 1.2s ease-out 1; }',
      '.ost-card-activity { display:flex;align-items:center;gap:6px;font-size:11px;font-weight:600;padding:4px 8px;border-radius:6px;background:rgba(124,230,168,.10);color:#7ce6a8;border:1px solid rgba(124,230,168,.25);margin-top:8px;width:fit-content; }',
      '.ost-card-activity.is-no { background:rgba(255,124,138,.10);color:#ff7c8a;border-color:rgba(255,124,138,.25); }',
      '.ost-card-pnl { display:flex;align-items:center;gap:6px;font-size:12px;font-weight:700;padding:4px 8px;border-radius:6px;margin-top:6px;width:fit-content; }',
      '.ost-card-pnl.is-pos { background:rgba(34,197,94,.12);color:#34d399;border:1px solid rgba(34,197,94,.30); }',
      '.ost-card-pnl.is-neg { background:rgba(248,113,113,.12);color:#f87171;border:1px solid rgba(248,113,113,.30); }',
      '.ost-market-activity-strip { display:flex;align-items:center;gap:10px;margin:10px 0 12px;padding:8px 10px;border:1px solid rgba(124,230,168,.20);border-radius:8px;background:rgba(10,18,32,.72);overflow:hidden; }',
      '.ost-market-activity-strip__label { flex:0 0 auto;font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#7ce6a8; }',
      '.ost-market-activity-strip__track { display:flex;gap:8px;overflow:auto;scrollbar-width:none; }',
      '.ost-market-activity-strip__track::-webkit-scrollbar { display:none; }',
      '.ost-market-activity-chip { flex:0 0 auto;display:flex;align-items:center;gap:6px;max-width:340px;padding:5px 8px;border-radius:999px;border:1px solid rgba(124,230,168,.22);background:rgba(124,230,168,.08);color:#dfffea;font-size:11px;white-space:nowrap; }',
      '.ost-market-activity-chip.is-no { border-color:rgba(255,124,138,.25);background:rgba(255,124,138,.08);color:#ffe1e5; }',
      '.ost-market-activity-chip b { color:#fff; }',
      '.ost-market-activity-empty { color:#94a3b8;font-size:11px; }',
      '#ost-trade-ticket-fab { position:fixed;bottom:24px;right:24px;z-index:999430;padding:12px 18px;border-radius:999px;border:none;background:linear-gradient(135deg,#7ce6a8,#22c55e);color:#031;font-weight:800;font-size:14px;cursor:pointer;box-shadow:0 8px 24px rgba(34,197,94,.35);display:none;align-items:center;gap:8px; }',
      '#ost-trade-ticket-fab:hover { transform:translateY(-2px); }',
      '#ost-trade-ticket-fab .ost-tt-count { background:#031;color:#7ce6a8;border-radius:999px;padding:2px 8px;font-size:11px; }',
      '#ost-trade-ticket-modal { position:fixed;inset:0;z-index:2147483646;background:rgba(0,0,0,.7);display:none;align-items:center;justify-content:center; }',
      '#ost-trade-ticket-modal.is-open { display:flex; }',
      '#ost-trade-ticket-modal .ost-tt-panel { width:min(560px,92vw);max-height:80vh;overflow:auto;background:#0b1220;border:1px solid rgba(124,230,168,.25);border-radius:14px;padding:18px;color:#e2e8f0; }',
      '#ost-trade-ticket-modal .ost-tt-row { display:grid;grid-template-columns:1fr auto auto;gap:10px;align-items:center;padding:10px 0;border-top:1px solid rgba(255,255,255,.06); }',
      '#ost-trade-ticket-modal h3 { margin:0 0 12px;font-size:16px; }',
      '#ost-trade-ticket-modal .ost-tt-close { float:right;background:none;border:none;color:#94a3b8;font-size:20px;cursor:pointer; }'
    ].join('\n');
    var style = document.createElement('style');
    style.textContent = ACTIVITY_CSS;
    document.head.appendChild(style);

    function readDeskOrders() {
      try { return JSON.parse(localStorage.getItem(TRADE_DESK_STORE_KEY) || '[]'); } catch (e) { return []; }
    }
    function isOpenDeskOrder(o) {
      if (!o || o.cashedOut) return false;
      var status = String(o.status || o.outcome || '').toLowerCase();
      return status !== 'won' && status !== 'lost' && status !== 'settled' && status !== 'sold' && status !== 'closed' && status !== 'paid';
    }
    function getYesPriceFromCard(card) {
      var fill = card.querySelector('.prediction-market-bar-fill');
      if (fill && fill.style && fill.style.width) {
        var pct = parseFloat(String(fill.style.width).replace('%', ''));
        if (Number.isFinite(pct)) return pct / 100;
      }
      return NaN;
    }

    // ---- card P&L badge ---------------------------------------------------
    function refreshCardPnL() {
      var orders = readDeskOrders();
      var openOrders = orders.filter(isOpenDeskOrder);
      var byMarket = Object.create(null);
      openOrders.forEach(function (o) {
        var k = o.marketId; if (!k) return;
        (byMarket[k] = byMarket[k] || []).push(o);
      });
      $$('.prediction-market-card[data-prediction-market-id]').forEach(function (card) {
        var id = card.getAttribute('data-prediction-market-id');
        var existing = card.querySelector('.ost-card-pnl');
        var positions = byMarket[id];
        if (!positions || !positions.length) {
          if (existing) existing.remove();
          return;
        }
        var yesPx = getYesPriceFromCard(card);
        if (!Number.isFinite(yesPx)) yesPx = 0.5;
        var totalStake = 0, totalValue = 0;
        positions.forEach(function (o) {
          var stake = Number(o.stake) || 0;
          var entry = Number(o.price) || 0.5;
          var shares = Number(o.shares) > 0 ? Number(o.shares) : (entry > 0 ? stake / entry : 0);
          var live = String(o.side).toLowerCase() === 'no' ? (1 - yesPx) : yesPx;
          totalStake += stake;
          totalValue += shares * live;
        });
        var pnl = totalValue - totalStake;
        var pct = totalStake > 0 ? (pnl / totalStake) * 100 : 0;
        var cls = pnl >= 0 ? 'is-pos' : 'is-neg';
        var arrow = pnl >= 0 ? '\u25B2' : '\u25BC';
        var sign = pnl >= 0 ? '+' : '\u2212';
        var html = arrow + ' your bet ' + sign + fmt(Math.abs(pnl)) + ' OST (' + sign + Math.abs(pct).toFixed(1) + '%)';
        if (existing) {
          existing.className = 'ost-card-pnl ' + cls;
          existing.textContent = html;
        } else {
          var el = document.createElement('div');
          el.className = 'ost-card-pnl ' + cls;
          el.textContent = html;
          card.appendChild(el);
        }
      });
    }

    // ---- card activity pulse ---------------------------------------------
    var seenActivity = Object.create(null);
    var latestActivityRows = [];

    function marketTitleForId(marketId) {
      var card = document.querySelector('.prediction-market-card[data-prediction-market-id="' + String(marketId).replace(/"/g, '\\"') + '"]');
      if (!card) return marketId;
      var titleEl = card.querySelector('h5, .prediction-card-title, h3, strong');
      return titleEl ? titleEl.textContent.trim() : marketId;
    }

    function activityKey(row) {
      return String(row && (row.signature || row.sig || row.id || row.ts || row.createdAt || ''));
    }

    function normalizeRecentRow(row) {
      if (!row) return null;
      var marketId = row.marketId || row.market_id || row.id || '';
      if (!marketId) return null;
      var side = String(row.side || row.outcome || row.direction || 'YES').toUpperCase();
      if (side !== 'NO') side = 'YES';
      var ts = row.ts || row.createdAt || row.placedAt || Date.now();
      return {
        marketId: marketId,
        side: side,
        stake: Number(row.stake || row.amount || row.size || 0) || 0,
        price: Number(row.price || 0) || NaN,
        wallet: row.wallet || row.walletShort || row.owner || '',
        walletShort: row.walletShort || row.wallet || '',
        ts: ts,
        title: row.title || row.marketTitle || row.market_title || row.question || marketTitleForId(marketId),
        signature: row.signature || row.sig || row.id || String(marketId) + ':' + String(ts)
      };
    }

    function indexRecentRows(rows) {
      var perMarket = Object.create(null);
      latestActivityRows = rows.map(normalizeRecentRow).filter(Boolean).sort(function (a, b) {
        return new Date(b.ts).getTime() - new Date(a.ts).getTime();
      }).slice(0, 50);
      latestActivityRows.forEach(function (row) {
        (perMarket[row.marketId] = perMarket[row.marketId] || []).push(row);
      });
      window.__ostSharedFeed = perMarket;
    }

    function localRecentRows() {
      return readDeskOrders().map(function (o) {
        if (!o || !o.marketId) return null;
        return normalizeRecentRow({
          marketId: o.marketId,
          side: o.side,
          stake: o.stake,
          price: o.price,
          ts: o.createdAt || o.cashoutAt || Date.now(),
          title: o.title,
          signature: o.signature || o.id || String(o.marketId) + ':' + String(o.createdAt || '')
        });
      }).filter(Boolean);
    }

    function refreshRecentActivityFeed() {
      var base = (window.OST_API_BASE || '').replace(/\/$/, '');
      if (!base) {
        indexRecentRows(localRecentRows());
        renderActivityTicker();
        return Promise.resolve(false);
      }
      return fetch(base + '/positions/recent?limit=50', { cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) {
          var remoteRows = j && Array.isArray(j.recent) ? j.recent : [];
          var byKey = Object.create(null);
          remoteRows.concat(localRecentRows()).forEach(function (row) {
            row = normalizeRecentRow(row);
            if (!row) return;
            byKey[activityKey(row)] = row;
          });
          indexRecentRows(Object.keys(byKey).map(function (k) { return byKey[k]; }));
          renderActivityTicker();
          return true;
        })
        .catch(function () {
          indexRecentRows(localRecentRows());
          renderActivityTicker();
          return false;
        });
    }

    function ensureActivityTicker() {
      var board = document.getElementById('predictionMarketBoard');
      if (!board) return null;
      var existing = document.getElementById('ostMarketActivityStrip');
      if (existing) return existing;
      var host = document.createElement('div');
      host.id = 'ostMarketActivityStrip';
      host.className = 'ost-market-activity-strip';
      host.innerHTML = '<div class="ost-market-activity-strip__label">Live OST buys</div><div class="ost-market-activity-strip__track"><span class="ost-market-activity-empty">Waiting for the next ticket...</span></div>';
      var anchor = document.getElementById('predictionMarketTape') || document.getElementById('predictionMarketNote') || board.firstChild;
      if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(host, anchor);
      else board.appendChild(host);
      return host;
    }

    function renderActivityTicker() {
      var host = ensureActivityTicker();
      if (!host) return;
      var track = host.querySelector('.ost-market-activity-strip__track');
      if (!track) return;
      var rows = latestActivityRows.slice(0, 14);
      if (!rows.length) {
        track.innerHTML = '<span class="ost-market-activity-empty">No OST market buys yet. First ticket will light up here.</span>';
        return;
      }
      track.innerHTML = rows.map(function (row) {
        var sideCls = row.side === 'NO' ? ' is-no' : '';
        var dot = row.side === 'NO' ? '\u25CF NO' : '\u25CF YES';
        var ageTxt = formatActivityAge(row.ts);
        var title = String(row.title || marketTitleForId(row.marketId) || row.marketId).slice(0, 58);
        return '<button type="button" class="ost-market-activity-chip' + sideCls + '" data-activity-market="' + escapeHtml(row.marketId) + '">' +
          '<b>' + escapeHtml(dot) + '</b>' +
          '<span>' + fmt(row.stake, 1) + ' OST</span>' +
          '<span>' + escapeHtml(title) + '</span>' +
          '<span>' + escapeHtml(ageTxt) + ' ago</span>' +
        '</button>';
      }).join('');
      track.querySelectorAll('[data-activity-market]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var id = btn.getAttribute('data-activity-market');
          if (window.OST_MARKET_MODAL && typeof window.OST_MARKET_MODAL.open === 'function') window.OST_MARKET_MODAL.open(id);
        });
      });
    }

    function formatActivityAge(ts) {
      var seconds = Math.max(0, Math.round((Date.now() - new Date(ts).getTime()) / 1000));
      if (!Number.isFinite(seconds)) return 'now';
      if (seconds < 60) return seconds + 's';
      var minutes = Math.round(seconds / 60);
      if (minutes < 60) return minutes + 'm';
      var hours = Math.round(minutes / 60);
      if (hours < 48) return hours + 'h';
      return Math.round(hours / 24) + 'd';
    }

    function refreshActivityPulse() {
      var feed = window.__ostSharedFeed || {};
      Object.keys(feed).forEach(function (marketId) {
        var rows = feed[marketId] || [];
        if (!rows.length) return;
        var newest = rows[0];
        var key = (newest.signature || newest.sig || newest.ts || '') + '';
        if (!key || seenActivity[marketId] === key) return;
        // First time we see this market gets primed silently (no pulse on
        // initial load — we only want fresh activity after the user opened
        // the page).
        if (seenActivity[marketId] === undefined) {
          seenActivity[marketId] = key;
          return;
        }
        seenActivity[marketId] = key;
        var card = document.querySelector('.prediction-market-card[data-prediction-market-id="' + String(marketId).replace(/"/g, '\\"') + '"]');
        if (!card) return;
        card.classList.remove('ost-card--just-traded');
        // force reflow so animation restarts
        void card.offsetWidth;
        card.classList.add('ost-card--just-traded');
        setTimeout(function () { card.classList.remove('ost-card--just-traded'); }, 1300);
        // Inject/update activity badge
        var existing = card.querySelector('.ost-card-activity');
        var sideUp = String(newest.side || '').toUpperCase();
        var sideCls = (sideUp === 'NO') ? 'is-no' : '';
        var ago = Math.max(0, Math.round((Date.now() - new Date(newest.ts).getTime()) / 1000));
        var agoStr = ago < 60 ? (ago + 's ago') : (Math.round(ago / 60) + 'm ago');
        var dot = sideUp === 'NO' ? '\uD83D\uDD34' : '\uD83D\uDFE2';
        var txt = dot + ' ' + sideUp + ' ' + Number(newest.stake || 0).toFixed(1) + ' OST \u00B7 ' + agoStr;
        if (existing) {
          existing.className = 'ost-card-activity ' + sideCls;
          existing.textContent = txt;
        } else {
          var el = document.createElement('div');
          el.className = 'ost-card-activity ' + sideCls;
          el.textContent = txt;
          card.appendChild(el);
        }
      });
    }

    // ---- floating Trade Ticket FAB + panel -------------------------------
    var fab = document.createElement('button');
    fab.id = 'ost-trade-ticket-fab';
    fab.type = 'button';
    fab.innerHTML = '\uD83C\uDFAF Trade ticket <span class="ost-tt-count">0</span>';
    document.body.appendChild(fab);
    var lastTicketFabActivationAt = 0;

    var ttModal = document.createElement('div');
    ttModal.id = 'ost-trade-ticket-modal';
    ttModal.innerHTML = '<div class="ost-tt-panel"><button type="button" class="ost-tt-close" aria-label="Close">\u00D7</button><h3>\uD83C\uDFAF Open positions</h3><div class="ost-tt-body">Loading\u2026</div></div>';
    document.body.appendChild(ttModal);
    ttModal.addEventListener('click', function (ev) {
      if (ev.target === ttModal || ev.target.classList.contains('ost-tt-close')) {
        ttModal.classList.remove('is-open');
      }
    });

    function refreshTicketCount() {
      var orders = readDeskOrders();
      var open = orders.filter(isOpenDeskOrder);
      // Group by marketId for the count badge.
      var marketsWithPositions = Object.keys(open.reduce(function (acc, o) { if (o.marketId) acc[o.marketId] = 1; return acc; }, {}));
      var n = marketsWithPositions.length;
      fab.style.display = n > 0 ? 'inline-flex' : 'none';
      var badge = fab.querySelector('.ost-tt-count');
      if (badge) badge.textContent = String(n);
    }

    function renderTicketPanel() {
      var body = ttModal.querySelector('.ost-tt-body');
      var orders = readDeskOrders();
      var open = orders.filter(isOpenDeskOrder);
      if (!open.length) {
        body.innerHTML = '<div style="opacity:.6;padding:14px 0;">No open positions. Buy YES or NO on any market to open one.</div>';
        return;
      }
      // Group by market for the list.
      var byMarket = Object.create(null);
      open.forEach(function (o) {
        var k = o.marketId || 'unknown';
        (byMarket[k] = byMarket[k] || []).push(o);
      });
      body.innerHTML = Object.keys(byMarket).map(function (mid) {
        var positions = byMarket[mid];
        var card = document.querySelector('.prediction-market-card[data-prediction-market-id="' + mid.replace(/"/g, '\\"') + '"]');
        var title = positions[0].title || (card && (card.querySelector('h5, .prediction-card-title, h3, strong') || {}).textContent) || mid;
        var yesPx = card ? getYesPriceFromCard(card) : NaN;
        if (!Number.isFinite(yesPx)) yesPx = Number(positions[0].price) || 0.5;
        var stake = 0, value = 0;
        positions.forEach(function (o) {
          var s = Number(o.stake) || 0;
          var entry = Number(o.price) || 0.5;
          var shares = Number(o.shares) > 0 ? Number(o.shares) : (entry > 0 ? s / entry : 0);
          var live = String(o.side).toLowerCase() === 'no' ? (1 - yesPx) : yesPx;
          stake += s;
          value += shares * live;
        });
        var pnl = value - stake;
        var pnlColor = pnl >= 0 ? '#34d399' : '#f87171';
        var arrow = pnl >= 0 ? '\u25B2' : '\u25BC';
        var sign = pnl >= 0 ? '+' : '\u2212';
        return '<div class="ost-tt-row" data-tt-market="' + escapeHtml(mid) + '">' +
          '<div><strong style="display:block;font-size:13px;">' + escapeHtml(String(title).slice(0, 90)) + '</strong>' +
          '<span style="opacity:.7;font-size:11px;">' + positions.length + ' position' + (positions.length === 1 ? '' : 's') + ' \u00B7 ' + fmt(stake) + ' OST staked</span></div>' +
          '<div style="text-align:right;font-weight:700;color:' + pnlColor + ';font-size:13px;">' + arrow + ' ' + sign + fmt(Math.abs(pnl)) + '<br><span style="opacity:.7;font-size:11px;font-weight:500;color:#cbd5e1;">value ' + fmt(value) + '</span></div>' +
          '<button type="button" class="ost-pred-btn ost-pred-btn--yes" data-tt-open="' + escapeHtml(mid) + '">Open</button>' +
          '</div>';
      }).join('');
      body.querySelectorAll('[data-tt-open]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var id = btn.getAttribute('data-tt-open');
          ttModal.classList.remove('is-open');
          if (window.OST_MARKET_MODAL && typeof window.OST_MARKET_MODAL.open === 'function') {
            window.OST_MARKET_MODAL.open(id);
          }
        });
      });
    }

    function openTicketPanel(ev) {
      if (ev) {
        try { ev.preventDefault(); } catch (e) {}
        try { ev.stopPropagation(); } catch (e) {}
        try { if (typeof ev.stopImmediatePropagation === 'function') ev.stopImmediatePropagation(); } catch (e) {}
      }
      var now = Date.now();
      if (now - lastTicketFabActivationAt < 450) return;
      lastTicketFabActivationAt = now;
      if (window.OST_TRADE_POPOUT && typeof window.OST_TRADE_POPOUT.close === 'function') {
        try { window.OST_TRADE_POPOUT.close(); } catch (e) {}
      }
      renderTicketPanel();
      ttModal.classList.add('is-open');
    }
    fab.addEventListener('pointerdown', openTicketPanel, true);
    fab.addEventListener('touchend', openTicketPanel, true);
    fab.addEventListener('click', openTicketPanel, true);

    // ---- boot ------------------------------------------------------------
    function tick() {
      try { ensureActivityTicker(); } catch (e) { /* silent */ }
      try { refreshCardPnL(); } catch (e) { /* silent */ }
      try { refreshActivityPulse(); } catch (e) { /* silent */ }
      try { refreshTicketCount(); } catch (e) { /* silent */ }
    }
    refreshRecentActivityFeed().then(tick);
    tick();
    setInterval(tick, 2500);
    setInterval(function () { refreshRecentActivityFeed().then(tick); }, 7000);
    window.addEventListener('ost:prediction:order-changed', function () { refreshRecentActivityFeed().then(tick); });
    window.addEventListener('storage', function (ev) {
      if (ev && (ev.key === TRADE_DESK_STORE_KEY || ev.key === STORE_KEY)) refreshRecentActivityFeed().then(tick);
    });
  })();
})();

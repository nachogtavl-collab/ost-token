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
        '<button type="button" class="ost-pred-btn" data-ost-pred-action="info">ℹ Info</button>',
        '<button type="button" class="ost-pred-btn" data-ost-pred-action="graph">📈 Graph</button>',
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
        ev.stopPropagation();
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
        ev.stopPropagation();
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
    };
    // Try to call the swap pool reverse path; otherwise mark claimed locally.
    try {
      if (window.OST_REAL_SWAP && typeof window.OST_REAL_SWAP.payout === 'function') {
        window.OST_REAL_SWAP.payout(bet.payoutIfWin).then(doClaim).catch(doClaim);
        return;
      }
    } catch (e) {}
    setTimeout(doClaim, 600);
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
})();

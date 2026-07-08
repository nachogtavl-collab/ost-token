/* ==========================================================================
   OST Prediction — Scalar & Date Markets
   --------------------------------------------------------------------------
   Adds non-binary outcome support on top of prediction-pro.js / app.js.

   Three market types are supported:
     1) binary   — YES / NO (existing app.js path; this module is a no-op)
     2) scalar   — numeric range split into N buckets (e.g. "BTC end-of-month
                   price: <100k | 100-120k | 120-140k | 140-160k | >160k").
                   User picks one bucket; payout fires if final value lands in it.
     3) date     — date range split into N buckets ("Event happens in:
                   Q2'26 | Q3'26 | Q4'26 | 2027 | never"). Same mechanic, but
                   the resolution input is a timestamp instead of a number.

   Polymarket multi-outcome events (groupItemTitle, outcomes.length > 2) are
   auto-classified into scalar or date markets depending on whether the
   bucket labels parse as numbers or as ISO dates / months.

   Storage extends `ost.prediction.orders.v1` with three new optional fields:
     marketType : 'binary' | 'scalar' | 'date'
     bucketId   : index of the chosen bucket inside outcomeBuckets
     bucketLabel: human label, denormalized for display

   No private keys, no third-party services. The relay (when configured) is
   used for any Polymarket data fetches.
   ========================================================================== */
(function () {
  'use strict';

  var ORDERS_KEY  = 'ost.prediction.orders.v1';
  var SCALAR_KEY  = 'ost.prediction.scalar.markets.v1';

  // ---------------------------------------------------------------------------
  // 1) Classification — turn a Polymarket / Kalshi market record into a typed
  //    schema with outcomeBuckets[].
  // ---------------------------------------------------------------------------
  var DATE_REGEX  = /^\s*(?:by\s+)?(?:q[1-4]\s*['’]?\d{2,4}|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|\d{4}|before\s+\d{4}|by\s+\d{4})/i;
  var MONEY_REGEX = /\$?\s*\d[\d,]*\.?\d*\s*[kKmMbB]?(?:\s*-\s*\$?\s*\d[\d,]*\.?\d*\s*[kKmMbB]?)?/;
  var COMPARATOR  = /^(?:<|>|<=|>=|≤|≥|over|under|above|below|less than|more than|at least|at most)\b/i;

  function parseMoney(label) {
    if (!label) return null;
    var s = String(label).replace(/[\s,$]/g, '').toLowerCase();
    var mult = 1;
    if (s.endsWith('k')) { mult = 1e3; s = s.slice(0, -1); }
    else if (s.endsWith('m')) { mult = 1e6; s = s.slice(0, -1); }
    else if (s.endsWith('b')) { mult = 1e9; s = s.slice(0, -1); }
    var n = parseFloat(s);
    return Number.isFinite(n) ? n * mult : null;
  }

  function parseRangeLabel(label) {
    // "$140k - $160k", "<$100k", ">$200k", "100000-120000"
    if (!label) return null;
    var t = String(label).trim();
    if (/^(?:<|under|less than|below)\s*/i.test(t)) {
      var hi = parseMoney(t.replace(/^(?:<|under|less than|below)\s*/i, ''));
      if (hi != null) return { min: -Infinity, max: hi };
    }
    if (/^(?:>|over|more than|above|at least)\s*/i.test(t)) {
      var lo = parseMoney(t.replace(/^(?:>|over|more than|above|at least)\s*/i, ''));
      if (lo != null) return { min: lo, max: Infinity };
    }
    var m = t.match(/(\$?\s*[\d.,]+\s*[kmb]?)\s*[-–to]+\s*(\$?\s*[\d.,]+\s*[kmb]?)/i);
    if (m) {
      var a = parseMoney(m[1]); var b = parseMoney(m[2]);
      if (a != null && b != null) return { min: Math.min(a, b), max: Math.max(a, b) };
    }
    var single = parseMoney(t);
    if (single != null) return { min: single, max: single };
    return null;
  }

  function parseDateLabel(label) {
    if (!label) return null;
    var t = String(label).trim();
    var m;
    // "Q3 2026" / "Q3'26"
    m = t.match(/^q([1-4])\s*['’]?(\d{2,4})/i);
    if (m) {
      var q = parseInt(m[1], 10);
      var y = parseInt(m[2], 10); if (y < 100) y += 2000;
      var startMonth = (q - 1) * 3;
      return { min: Date.UTC(y, startMonth, 1), max: Date.UTC(y, startMonth + 3, 1) - 1 };
    }
    // "December 2026" / "Dec 2026"
    var months = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
    m = t.match(/^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{4})/i);
    if (m) {
      var mi = months.indexOf(m[1].toLowerCase());
      var yy = parseInt(m[2], 10);
      return { min: Date.UTC(yy, mi, 1), max: Date.UTC(yy, mi + 1, 1) - 1 };
    }
    // "by 2027" / "before 2027"
    m = t.match(/^(?:by|before)\s+(\d{4})/i);
    if (m) return { min: 0, max: Date.UTC(parseInt(m[1], 10), 0, 1) - 1 };
    // "2027"
    m = t.match(/^(\d{4})$/);
    if (m) {
      var y2 = parseInt(m[1], 10);
      return { min: Date.UTC(y2, 0, 1), max: Date.UTC(y2 + 1, 0, 1) - 1 };
    }
    return null;
  }

  function classifyOutcomes(outcomes) {
    // outcomes: [{ label, price }] (price 0..1 implied probability)
    if (!Array.isArray(outcomes) || outcomes.length < 3) return null;
    var dateBuckets = [];
    var scalarBuckets = [];
    for (var i = 0; i < outcomes.length; i++) {
      var o = outcomes[i] || {};
      var lbl = o.label || o.title || '';
      var dr = parseDateLabel(lbl);
      if (dr) dateBuckets.push({ id: i, label: lbl, min: dr.min, max: dr.max, price: o.price });
      var rr = parseRangeLabel(lbl);
      if (rr) scalarBuckets.push({ id: i, label: lbl, min: rr.min, max: rr.max, price: o.price });
    }
    if (dateBuckets.length >= Math.min(3, outcomes.length)) {
      return { type: 'date', buckets: dateBuckets };
    }
    if (scalarBuckets.length >= Math.min(3, outcomes.length)) {
      return { type: 'scalar', buckets: scalarBuckets };
    }
    return { type: 'categorical', buckets: outcomes.map(function (o, i) {
      return { id: i, label: o.label || o.title || ('Option ' + (i+1)), price: o.price };
    }) };
  }

  // Public: normalize a generic market record produced by app.js or a
  // Polymarket Gamma payload into a typed structure with buckets.
  function normalizeMarket(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var outcomes = Array.isArray(raw.outcomes)        ? raw.outcomes
                 : Array.isArray(raw.outcomeTokens)    ? raw.outcomeTokens
                 : Array.isArray(raw.outcomePrices) && Array.isArray(raw.outcomeNames)
                       ? raw.outcomeNames.map(function (n, i) { return { label: n, price: Number(raw.outcomePrices[i]) }; })
                       : null;
    var classification = outcomes ? classifyOutcomes(outcomes) : null;
    if (!classification || classification.type === 'categorical' && outcomes && outcomes.length === 2) {
      return {
        id: raw.id || raw.marketId,
        title: raw.title || raw.question || raw.name,
        marketType: 'binary',
        outcomeBuckets: [
          { id: 0, label: 'YES', price: Number(raw.yesPrice || (outcomes && outcomes[0] && outcomes[0].price) || 0.5) },
          { id: 1, label: 'NO',  price: Number(raw.noPrice  || (outcomes && outcomes[1] && outcomes[1].price) || 0.5) }
        ],
        raw: raw
      };
    }
    return {
      id: raw.id || raw.marketId,
      title: raw.title || raw.question || raw.name,
      marketType: classification.type,
      outcomeBuckets: classification.buckets,
      resolutionField: classification.type === 'date' ? 'timestamp' : (classification.type === 'scalar' ? 'value' : 'label'),
      raw: raw
    };
  }

  // ---------------------------------------------------------------------------
  // 2) Storage layer — extend the order schema with bucket fields.
  // ---------------------------------------------------------------------------
  function readOrders() {
    try { return JSON.parse(localStorage.getItem(ORDERS_KEY) || '[]') || []; }
    catch (_) { return []; }
  }
  function writeOrders(arr) {
    try { localStorage.setItem(ORDERS_KEY, JSON.stringify(arr.slice(-500))); } catch (_) {}
  }

  function recordScalarOrder(order) {
    // order: { marketId, marketTitle, marketType, bucketId, bucketLabel,
    //         stake, sig, ts, status }
    var arr = readOrders();
    arr.push(Object.assign({
      ts: Date.now(),
      status: 'open',
      schemaVersion: 2
    }, order));
    writeOrders(arr);
    return arr[arr.length - 1];
  }

  // ---------------------------------------------------------------------------
  // 3) Resolution helpers — given a final value (number or timestamp), find
  //    the winning bucket and mark matching orders as won/lost.
  // ---------------------------------------------------------------------------
  function resolveBucket(market, finalValue) {
    if (!market || !Array.isArray(market.outcomeBuckets)) return null;
    for (var i = 0; i < market.outcomeBuckets.length; i++) {
      var b = market.outcomeBuckets[i];
      if (typeof b.min === 'number' && typeof b.max === 'number' &&
          finalValue >= b.min && finalValue <= b.max) {
        return b;
      }
    }
    return null;
  }

  function settleScalarMarket(marketId, finalValue, bucketsHint) {
    var orders = readOrders();
    var changed = false;
    for (var i = 0; i < orders.length; i++) {
      var o = orders[i];
      if (o.marketId !== marketId || o.status !== 'open') continue;
      if (o.marketType !== 'scalar' && o.marketType !== 'date') continue;
      var buckets = bucketsHint || o.outcomeBuckets;
      if (!Array.isArray(buckets)) continue;
      var won = false;
      for (var j = 0; j < buckets.length; j++) {
        if (buckets[j].id === o.bucketId) {
          if (finalValue >= buckets[j].min && finalValue <= buckets[j].max) won = true;
          break;
        }
      }
      o.status = won ? 'won' : 'lost';
      o.settledAt = Date.now();
      o.finalValue = finalValue;
      changed = true;
    }
    if (changed) writeOrders(orders);
    return changed;
  }

  // ---------------------------------------------------------------------------
  // 4) UI — bucket picker injected into the trade desk and the detail modal.
  //    Renders only when the active market is non-binary.
  // ---------------------------------------------------------------------------
  function fmtMoney(n) {
    if (!Number.isFinite(n)) return '∞';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(1) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + (n / 1e3).toFixed(0) + 'k';
    return '$' + n.toFixed(0);
  }
  function fmtDate(ts) {
    if (!Number.isFinite(ts)) return '—';
    var d = new Date(ts);
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short' });
  }

  function renderBucketPicker(market, opts) {
    opts = opts || {};
    var container = document.createElement('div');
    container.className = 'ost-scalar-picker' + (market.marketType === 'date' ? ' ost-scalar-picker--date' : '');
    var head = document.createElement('div');
    head.className = 'ost-scalar-picker__head';
    head.textContent = market.marketType === 'date'
      ? 'Pick the time window'
      : 'Pick a price/value range';
    container.appendChild(head);

    var list = document.createElement('div');
    list.className = 'ost-scalar-picker__list';
    var selected = null;
    market.outcomeBuckets.forEach(function (b, idx) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ost-scalar-bucket';
      btn.dataset.bucketId = String(b.id);
      var lbl = document.createElement('span');
      lbl.className = 'ost-scalar-bucket__label';
      lbl.textContent = b.label || (market.marketType === 'date'
        ? (fmtDate(b.min) + ' – ' + fmtDate(b.max))
        : (fmtMoney(b.min) + ' – ' + fmtMoney(b.max)));
      var pr = document.createElement('span');
      pr.className = 'ost-scalar-bucket__price';
      var p = Number(b.price);
      pr.textContent = Number.isFinite(p) ? (Math.round(p * 100) + '¢') : '—';
      btn.appendChild(lbl); btn.appendChild(pr);
      btn.addEventListener('click', function () {
        list.querySelectorAll('.ost-scalar-bucket.is-selected')
            .forEach(function (n) { n.classList.remove('is-selected'); });
        btn.classList.add('is-selected');
        selected = b;
        if (typeof opts.onSelect === 'function') opts.onSelect(b);
      });
      if (idx === 0) { btn.classList.add('is-selected'); selected = b; }
      list.appendChild(btn);
    });
    container.appendChild(list);

    var foot = document.createElement('div');
    foot.className = 'ost-scalar-picker__foot';
    foot.innerHTML = '<span class="ost-scalar-foot__type">' + market.marketType.toUpperCase() +
                     '</span><span class="ost-scalar-foot__hint">Payout fires when the resolution value lands inside the chosen window.</span>';
    container.appendChild(foot);

    container._getSelected = function () { return selected; };
    return container;
  }

  // ---------------------------------------------------------------------------
  // 5) Auto-injection: watch market cards in the DOM. If a card is built from
  //    a non-binary market record, replace its YES/NO toggle with a picker.
  // ---------------------------------------------------------------------------
  function tryEnhanceCard(card) {
    if (!card || card.dataset.ostScalarReady === '1') return;
    var raw = null;
    try {
      var encoded = card.dataset.market || card.getAttribute('data-market');
      if (encoded) raw = JSON.parse(decodeURIComponent(encoded));
    } catch (_) { raw = null; }
    if (!raw && card._predictionMarket) raw = card._predictionMarket;
    // Look up the canonical market record from app.js state via the card id —
    // app.js renders `data-prediction-market-id` on every card and exposes the
    // full market list on `window.__predictionState.markets`. This is how we
    // detect Polymarket grouped/multi-outcome events (Trump/Harris/RFK,
    // tournament winners) plus scalar/date range markets without forcing
    // app.js to embed full JSON in every DOM node.
    if (!raw) {
      var lookupId = card.getAttribute('data-prediction-market-id') ||
                     card.getAttribute('data-market-id') ||
                     (card.dataset && card.dataset.predictionMarketId) ||
                     '';
      try {
        var st = window.__predictionState ||
                 (window.OST_PREDICTION_API && window.OST_PREDICTION_API._state);
        if (lookupId && st && Array.isArray(st.markets)) {
          raw = st.markets.find(function (mk) { return mk && mk.id === lookupId; }) || null;
          // Polymarket grouped-event payloads stash the per-leg outcomes inside
          // raw.polymarketEvent.markets — promote them so classifyOutcomes sees
          // a >2 outcome list and builds bucket UI for the picker.
          if (raw && (!Array.isArray(raw.outcomes) || raw.outcomes.length < 3) && raw.raw && raw.raw.polymarketEvent && Array.isArray(raw.raw.polymarketEvent.markets) && raw.raw.polymarketEvent.markets.length > 2) {
            var legs = raw.raw.polymarketEvent.markets.map(function (leg) {
              return {
                // Prefer the leg's REAL market id — orders route to it so the
                // existing binary resolution engine settles bucket bets.
                key: leg.id || leg.conditionId || leg.key || leg.groupItemTitle,
                label: leg.groupItemTitle || leg.label || leg.title || ('Leg ' + (leg.id || '')),
                price: Number(leg.price != null ? leg.price : (leg.outcomePrices && JSON.parse(typeof leg.outcomePrices === 'string' ? leg.outcomePrices : JSON.stringify(leg.outcomePrices))[0])) || 0
              };
            });
            raw = Object.assign({}, raw, { outcomes: legs });
          }
        }
      } catch (_) {}
    }
    if (!raw) return;
    var norm = normalizeMarket(raw);
    if (!norm || norm.marketType === 'binary') return;
    card.dataset.ostScalarReady = '1';
    card.dataset.ostMarketType = norm.marketType;
    var binaryToggle = card.querySelector('[data-role="binary-toggle"], .prediction-side-toggle, .prediction-card__sides');
    var enhancedRaw = raw; // keep the outcomes list for leg lookup on select
    var picker = renderBucketPicker(norm, {
      onSelect: function (b) {
        card.dataset.ostBucketId = String(b.id);
        card.dataset.ostBucketLabel = b.label || '';
        // Register the selection so placeOrder can route the bet to the REAL
        // underlying leg market (each Polymarket bucket is its own binary
        // market — betting the leg means the existing resolution engine
        // settles it natively, no bespoke oracle).
        var leg = null;
        try {
          leg = (enhancedRaw.outcomes || []).find(function (o) {
            return o && (o.label === b.label || o.key === b.key);
          }) || null;
        } catch (_) {}
        selections[String(norm.id)] = {
          marketId: String(norm.id),
          type: norm.marketType,
          bucketId: b.id,
          label: b.label || '',
          legId: leg && leg.key != null ? String(leg.key) : null,
          legPrice: Number(leg && leg.price != null ? leg.price : b.price) || 0,
          ts: Date.now()
        };
      }
    });
    if (binaryToggle) binaryToggle.replaceWith(picker);
    else card.appendChild(picker);
  }

  function observeCards() {
    if (!document.body) { setTimeout(observeCards, 200); return; }
    document.querySelectorAll('[data-prediction-card], .prediction-card, .market-card, .prediction-market-card[data-prediction-market-id]').forEach(tryEnhanceCard);
    var mo = new MutationObserver(function (muts) {
      for (var i = 0; i < muts.length; i++) {
        for (var j = 0; j < muts[i].addedNodes.length; j++) {
          var n = muts[i].addedNodes[j];
          if (!(n instanceof HTMLElement)) continue;
          if (n.matches && n.matches('[data-prediction-card], .prediction-card, .market-card, .prediction-market-card[data-prediction-market-id]')) tryEnhanceCard(n);
          n.querySelectorAll && n.querySelectorAll('[data-prediction-card], .prediction-card, .market-card, .prediction-market-card[data-prediction-market-id]').forEach(tryEnhanceCard);
        }
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });
    // Markets often arrive after the initial DOM scan — re-run when the
    // prediction list re-renders or when app.js dispatches an order-changed
    // event (which it does after every live refresh).
    var rescan = function () {
      document.querySelectorAll('.prediction-market-card[data-prediction-market-id]:not([data-ost-scalar-ready])').forEach(tryEnhanceCard);
    };
    window.addEventListener('ost:prediction:markets-updated', rescan);
    window.addEventListener('ost:prediction:order-changed', rescan);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', observeCards);
  else observeCards();

  // ---------------------------------------------------------------------------
  // 6) Public API — extends window.OST_PREDICTION_API non-destructively.
  // ---------------------------------------------------------------------------
  // Live bucket selections, keyed by event market id. placeOrder consults
  // this to route a multi-outcome bet to its real underlying leg market.
  var selections = {};
  function selection(marketId) {
    var s = selections[String(marketId)];
    if (!s) return null;
    if (Date.now() - s.ts > 15 * 60 * 1000) { delete selections[String(marketId)]; return null; }
    return s;
  }
  function clearSelection(marketId) { delete selections[String(marketId)]; }

  var api = {
    normalizeMarket: normalizeMarket,
    classifyOutcomes: classifyOutcomes,
    parseRangeLabel: parseRangeLabel,
    parseDateLabel: parseDateLabel,
    renderBucketPicker: renderBucketPicker,
    recordScalarOrder: recordScalarOrder,
    resolveBucket: resolveBucket,
    settleScalarMarket: settleScalarMarket,
    selection: selection,
    clearSelection: clearSelection
  };

  if (typeof window !== 'undefined') {
    window.OST_PREDICTION_SCALAR = api;
    if (window.OST_PREDICTION_API && !window.OST_PREDICTION_API.scalar) {
      window.OST_PREDICTION_API.scalar = api;
    }
  }
})();

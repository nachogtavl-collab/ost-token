/* ==========================================================================
 * OST · Market Art — every prediction market gets a face.
 *
 *   · Polymarket markets: the venue's own artwork (the worker feed carries it;
 *     snapshot markets are looked up on Gamma by market id, ladders by event id).
 *   · Everything else (Kalshi, OST 5-min coins, anything Gamma has no art for):
 *     a designed cover — a category palette, a glyph and the market's initials,
 *     rendered as an inline SVG so it never needs a network round-trip.
 *   · Applied to the browse cards, the featured tiles, the market page header,
 *     the hero, and the portfolio rows; re-applied whenever those re-render.
 *
 * window.OST_MARKET_ART = { imageFor(m), coverFor(m), resolve(ids), apply() }
 * ========================================================================== */
(function () {
  'use strict';
  if (window.OST_MARKET_ART) return;

  var GAMMA = 'https://gamma-api.polymarket.com';
  var API = String(window.OST_API_BASE || 'https://ost-api.nachogtavl.workers.dev').replace(/\/+$/, '');
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function markets() { try { return Array.isArray(window.__ostPredictionMarkets) ? window.__ostPredictionMarkets : []; } catch (_) { return []; } }
  function natives() { try { return (typeof window.buildOstNativeMarkets === 'function' && window.buildOstNativeMarkets()) || []; } catch (_) { return []; } }
  function byId(id) {
    id = String(id || ''); var a = markets(), i;
    for (i = 0; i < a.length; i++) if (a[i] && String(a[i].id) === id) return a[i];
    var n = natives(); for (i = 0; i < n.length; i++) if (n[i] && String(n[i].id) === id) return n[i];
    // ladder legs: the group that owns the leg id
    for (i = 0; i < a.length; i++) { var m = a[i]; if (m && m.isGrouped && Array.isArray(m.outcomes) && m.outcomes.some(function (o) { return o && String(o.marketId || o.key || '') === id; })) return m; }
    return null;
  }

  /* ------------------------------------------------------------------ venue art */
  var art = {};        // market id -> url ('' = none known)
  var asked = {};      // id -> true once requested from Gamma
  var bad = {};        // id -> ts of the last failed image load (retry after 2 min, never blank for good)
  function known(m) {
    if (!m) return '';
    var id = String(m.id);
    if (bad[id] && Date.now() - bad[id] < 120000) return '';
    if (art[id]) return art[id];
    var u = m.image || m.icon || (m.raw && (m.raw.image || m.raw.icon)) || '';
    if (u) art[id] = String(u);
    return art[id] || '';
  }
  function fetchJson(url, ms) {
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var t = setTimeout(function () { try { ctrl && ctrl.abort(); } catch (_) {} }, ms || 8000);
    return fetch(url, { signal: ctrl ? ctrl.signal : undefined }).then(function (r) { clearTimeout(t); if (!r.ok) throw new Error('http ' + r.status); return r.json(); }, function (e) { clearTimeout(t); throw e; });
  }
  var pending = [], flushTimer = 0;
  function resolve(ids) {
    (ids || []).forEach(function (id) {
      id = String(id || ''); var m = byId(id);
      if (!id || asked[id] || (m && known(m))) return;
      if (!m || String(m.source) !== 'polymarket') return;
      asked[id] = true; pending.push(id);
    });
    if (pending.length && !flushTimer) flushTimer = setTimeout(flush, 120);
  }
  function flush() {
    flushTimer = 0;
    var take = pending.splice(0, 40);
    var mIds = take.filter(function (id) { return /^\d+$/.test(id); });
    var eIds = take.filter(function (id) { return /^group:\d+$/.test(id); }).map(function (id) { return id.slice(6); });
    var jobs = [];
    // A market without its own artwork inherits its event's (ladder legs, most sub-markets).
    if (mIds.length) jobs.push(gammaBatch('/markets', mIds).then(function (arr) { arr.forEach(function (x) { if (!x || !x.id) return; var ev = Array.isArray(x.events) && x.events[0]; var u = x.image || x.icon || (ev && (ev.image || ev.icon)) || ''; if (u) art[String(x.id)] = String(u); }); }));
    if (eIds.length) jobs.push(gammaBatch('/events', eIds).then(function (arr) { arr.forEach(function (x) { if (x && x.id && (x.image || x.icon)) art['group:' + String(x.id)] = String(x.image || x.icon); }); }));
    Promise.all(jobs).then(apply).catch(apply);
    if (pending.length) flushTimer = setTimeout(flush, 400);
  }
  function gammaBatch(path, ids) {
    var q = ids.map(function (id) { return 'id=' + encodeURIComponent(id); }).join('&') + '&limit=' + ids.length;
    return fetchJson(GAMMA + path + '?' + q, 8000).catch(function () { return fetchJson(API + '/gamma' + path + '?' + q, 8000); })
      .then(function (arr) { return Array.isArray(arr) ? arr : []; }).catch(function () { return []; });
  }

  /* ------------------------------------------------------------------ designed covers */
  var THEMES = {
    btc:      { a: '#f7931a', b: '#3b1d05', g: '₿' },
    eth:      { a: '#8c9cff', b: '#141a4a', g: 'Ξ' },
    sol:      { a: '#14f195', b: '#1b0a3a', g: '◎' },
    politics: { a: '#ff6b8a', b: '#3a0b1d', g: '⚑' },
    sports:   { a: '#34d399', b: '#062a1f', g: '◍' },
    econ:     { a: '#7fd8ff', b: '#062033', g: '↗' },
    world:    { a: '#a97bff', b: '#1c0b3a', g: '◐' },
    crypto:   { a: '#ffc04a', b: '#33210a', g: '◆' },
    parlay:   { a: '#ffc04a', b: '#2b1b06', g: '⚡' },
    other:    { a: '#7fd8ff', b: '#0b1a2b', g: '★' }
  };
  function themeOf(m) {
    var s = ((m && m.title) || '') + ' ' + ((m && m.topic) || '') + ' ' + ((m && m.contractLabel) || '') + ' ' + ((m && m.id) || '');
    s = s.toLowerCase();
    if (/btc|bitcoin/.test(s)) return 'btc'; if (/\beth\b|ethereum/.test(s)) return 'eth'; if (/\bsol\b|solana/.test(s)) return 'sol';
    if (/parlay/.test(s)) return 'parlay';
    if (/crypto|coin|token|xrp|doge/.test(s)) return 'crypto';
    if (/elect|senate|president|trump|congress|vote|politic|governor|parliament|minister|nominee|impeach/.test(s)) return 'politics';
    if (/nba|nfl|nhl|mlb|ncaa|cup|league|match|playoff|champion|super bowl|wins|win\b|vs\b|f1|ufc|tennis|golf|soccer|football|basketball|baseball|hockey|liga|premier/.test(s)) return 'sports';
    if (/gdp|cpi|inflation|fed\b|rate|stock|s&p|nasdaq|jobs|econ|recession|tariff|oil|wti|gold|treasury|bps/.test(s)) return 'econ';
    if (/weather|temp|climate|world|country|war|ceasefire|israel|iran|russia|ukraine|china|global|un\b|nato/.test(s)) return 'world';
    return 'other';
  }
  function initials(m) {
    var t = String((m && (m.title || m.contractLabel)) || '?').replace(/[^A-Za-z0-9 ]/g, ' ').split(/\s+/).filter(function (w) { return w && !/^(will|the|a|an|of|in|on|by|to|be|at|for|is|vs|and|or|2026|2027|2028)$/i.test(w); });
    var out = t.slice(0, 2).map(function (w) { return w.charAt(0).toUpperCase(); }).join('');
    return out || '★';
  }
  function hash(s) { var h = 0; s = String(s || ''); for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); }
  var covers = {};
  function coverFor(m) {
    var id = String((m && m.id) || '?'); if (covers[id]) return covers[id];
    var th = THEMES[themeOf(m)] || THEMES.other, h = hash(id), rot = h % 360, ox = 20 + (h % 50), oy = 15 + ((h >> 3) % 50);
    var ini = initials(m);
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">' +
      '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="' + th.a + '" stop-opacity=".95"/><stop offset="1" stop-color="' + th.b + '"/></linearGradient>' +
      '<radialGradient id="r" cx="' + ox + '%" cy="' + oy + '%" r="70%"><stop offset="0" stop-color="#fff" stop-opacity=".35"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs>' +
      '<rect width="96" height="96" fill="url(#g)"/><rect width="96" height="96" fill="url(#r)"/>' +
      '<g transform="rotate(' + rot + ' 48 48)" opacity=".18" fill="#fff"><circle cx="48" cy="48" r="34" fill="none" stroke="#fff" stroke-width="10" stroke-dasharray="40 26"/></g>' +
      '<text x="48" y="44" text-anchor="middle" font-family="system-ui,-apple-system,Segoe UI,Roboto,sans-serif" font-size="30" font-weight="800" fill="#fff" opacity=".92">' + esc(th.g) + '</text>' +
      '<text x="48" y="76" text-anchor="middle" font-family="ui-monospace,SF Mono,Menlo,monospace" font-size="17" font-weight="800" fill="#fff" letter-spacing="1">' + esc(ini) + '</text>' +
      '</svg>';
    covers[id] = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    return covers[id];
  }
  function imageFor(m) { return known(m) || ''; }
  function faceFor(m) { return known(m) || coverFor(m); }

  /* ------------------------------------------------------------------ apply to the UI */
  function setFace(box, m, cls) {
    if (!box || !m) return;
    var url = faceFor(m), isVenue = !!known(m);
    if (box.getAttribute('data-art') === url) return;
    box.setAttribute('data-art', url);
    box.classList.add('oma-face'); box.classList.toggle('omp-has-img', true); box.classList.toggle('oma-cover', !isVenue);
    if (cls) box.classList.add(cls);
    box.innerHTML = '<img alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" src="' + esc(url) + '">';
    var img = box.firstChild;
    img.onerror = function () { if (isVenue) { bad[String(m.id)] = Date.now(); box.removeAttribute('data-art'); setFace(box, m, cls); } };
  }
  function apply() {
    var want = [];
    document.querySelectorAll('#opmGrid .opm-mcard[data-mid], #opmFeatWrap .opm-fcard[data-mid]').forEach(function (card) {
      var m = byId(card.getAttribute('data-mid')); if (!m) return;
      if (!known(m)) want.push(String(m.id));
      setFace(card.querySelector('.mi, .fi'), m);
    });
    var det = $('opmDetail');
    if (det && det.classList.contains('on')) {
      var m = byId(det.getAttribute('data-mid'));
      if (m) { if (!known(m)) want.push(String(m.id)); setFace(det.querySelector('.opm-qhead .ico'), m, 'oma-big'); }
    }
    document.querySelectorAll('#opmPosList [data-mid]').forEach(function (row) {
      var m = byId(row.getAttribute('data-mid')); var box = row.querySelector('.opm-timg'); if (m && box) { if (!known(m)) want.push(String(m.id)); setFace(box, m); }
    });
    if (want.length) resolve(want);
  }
  var applyTimer = 0;
  function scheduleApply() { clearTimeout(applyTimer); applyTimer = setTimeout(apply, 30); }

  function boot() {
    var host = $('ostPredictMobile');
    if (!host) { setTimeout(boot, 400); return; }
    new MutationObserver(scheduleApply).observe(host, { childList: true, subtree: true });
    window.addEventListener('ost:prediction-markets', scheduleApply);
    scheduleApply();
  }
  window.OST_MARKET_ART = { imageFor: imageFor, coverFor: coverFor, faceFor: faceFor, resolve: resolve, apply: scheduleApply, _debug: function () { return { art: Object.keys(art).length, asked: Object.keys(asked).length, pending: pending.length, sample: Object.keys(art).slice(0, 3) }; } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();

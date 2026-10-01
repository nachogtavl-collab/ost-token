/* ==========================================================================
 * OST · Perp Ledger — SERVER-authoritative perpetual futures on mirrored markets
 * --------------------------------------------------------------------------
 * Installed onto PlayLedger (same Durable Object, same play balance) so perps
 * spend and pay the exact OSTG the games, predictions and stock mirror use.
 *
 *   OPEN   the server prices the entry from ITS feed (Yahoo chart, the same
 *          source as the stock mirror), locks the liquidation price, debits
 *          margin + open fee, and records the position. Leverage is capped per
 *          market (stocks 10x, crypto 20x). A stock can only be opened while its
 *          quote is fresh (market open) — no trading a frozen Friday close.
 *   CLOSE  the server prices the exit, settles PnL × leverage, funding, the
 *          close fee and the house edge (2% of PROFIT, the site-wide rule), and
 *          credits the payout under the pool-solvency cap.
 *   SWEEP  a DO alarm marks every open position to a fresh price every 60s and
 *          liquidates the ones through their liquidation price. Margin is lost;
 *          nothing is ever owed beyond margin (isolated margin, no negative
 *          balances).
 *   FUNDING a per-market 8h rate = base 0.01% + skew of open interest
 *          (longs pay shorts when longs dominate), snapshotted at open and
 *          accrued pro-rata at close. Simple, visible, deterministic.
 *
 * Invariants: no client-supplied price is ever used; every payout is computed
 * here and bounded (max loss = margin; max credit ≤ pool bankroll); every write
 * happens under blockConcurrencyWhile; network I/O never inside the lock.
 * Devnet OSTG only — no cash value.
 * ========================================================================== */
import { publishRealtimeEvent } from './realtime.js';

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
const r9 = (n) => Math.round(Number(n) * 1e9) / 1e9;
const r6 = (n) => Math.round(Number(n) * 1e6) / 1e6;
const isPubkey = (s) => typeof s === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);

export const PERP_MARKETS = [
  { symbol: 'BTC-USD', name: 'Bitcoin', kind: 'crypto', maxLev: 20 },
  { symbol: 'ETH-USD', name: 'Ethereum', kind: 'crypto', maxLev: 20 },
  { symbol: 'SOL-USD', name: 'Solana', kind: 'crypto', maxLev: 20 },
  { symbol: 'SPY', name: 'S&P 500 ETF', kind: 'index', maxLev: 10 },
  { symbol: 'QQQ', name: 'Nasdaq-100 ETF', kind: 'index', maxLev: 10 },
  { symbol: 'NVDA', name: 'NVIDIA', kind: 'stock', maxLev: 10 },
  { symbol: 'TSLA', name: 'Tesla', kind: 'stock', maxLev: 10 },
  { symbol: 'AAPL', name: 'Apple', kind: 'stock', maxLev: 10 },
  { symbol: 'MSFT', name: 'Microsoft', kind: 'stock', maxLev: 10 },
  { symbol: 'AMZN', name: 'Amazon', kind: 'stock', maxLev: 10 },
  { symbol: 'META', name: 'Meta', kind: 'stock', maxLev: 10 },
  { symbol: 'GOOGL', name: 'Alphabet', kind: 'stock', maxLev: 10 },
  { symbol: 'AMD', name: 'AMD', kind: 'stock', maxLev: 10 },
  { symbol: 'COIN', name: 'Coinbase', kind: 'stock', maxLev: 10 },
  { symbol: 'MSTR', name: 'Strategy', kind: 'stock', maxLev: 10 },
  { symbol: 'GLD', name: 'Gold ETF', kind: 'index', maxLev: 10 }
];
const BY_SYMBOL = Object.fromEntries(PERP_MARKETS.map(m => [m.symbol, m]));

export const PERP = {
  MMR: 0.005,            // maintenance margin ratio: liquidated when equity ≤ 0.5% of notional
  FEE: 0.0005,           // 0.05% of notional, open and close
  EDGE: 0.02,            // house edge on PROFIT only (site-wide OST_HOUSE rule)
  FUNDING_BASE: 0.0001,  // 0.01% / 8h
  FUNDING_SKEW: 0.0005,  // × OI imbalance, clamped to ±0.1% / 8h
  FUNDING_MAX: 0.001,
  FUNDING_PERIOD_MS: 8 * 3600 * 1000,
  MIN_MARGIN: 1,
  STOCK_FRESH_MS: 20 * 60 * 1000,    // a stock quote older than this = market closed
  SWEEP_MS: 60 * 1000,
  HISTORY_KEEP: 40
};

/* ---- price feed (Yahoo chart meta, same source as the stock mirror) ------ */
const priceMem = new Map();   // symbol -> { at, q }
async function fetchQuote(symbol) {
  const hit = priceMem.get(symbol);
  if (hit && Date.now() - hit.at < 5000) return hit.q;
  const url = 'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(symbol) + '?range=1d&interval=5m&includePrePost=false';
  const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0', accept: 'application/json' }, cf: { cacheTtl: 5 } });
  if (!res.ok) throw new Error('quote_fetch_failed');
  const j = await res.json();
  const meta = j && j.chart && j.chart.result && j.chart.result[0] && j.chart.result[0].meta;
  const price = meta && Number(meta.regularMarketPrice);
  if (!(price > 0)) throw new Error('no_price');
  const prev = Number(meta.chartPreviousClose || meta.previousClose) || NaN;
  const asOf = Number(meta.regularMarketTime) > 0 ? Number(meta.regularMarketTime) * 1000 : Date.now();
  const q = { symbol, price, prevClose: prev > 0 ? prev : null, changePct: prev > 0 ? (price - prev) / prev : null, asOf, currency: meta.currency || 'USD' };
  priceMem.set(symbol, { at: Date.now(), q });
  return q;
}
function isFresh(m, q) { return m.kind === 'crypto' ? true : (Date.now() - Number(q.asOf || 0)) < PERP.STOCK_FRESH_MS; }

/* ---- math ----------------------------------------------------------------- */
export function liqPriceFor(side, entry, lev) {
  const f = 1 / lev - PERP.MMR;
  return side === 'long' ? entry * (1 - f) : entry * (1 + f);
}
function pnlOf(pos, mark) {
  const move = (mark - pos.entryPrice) / pos.entryPrice;
  return r9(pos.notional * (pos.side === 'short' ? -move : move));
}
function fundingOf(pos, now) {
  const periods = Math.max(0, (now - pos.openedAt) / PERP.FUNDING_PERIOD_MS);
  // longs pay when the rate is positive, shorts receive (and vice versa)
  const signed = pos.side === 'long' ? pos.fundingRate : -pos.fundingRate;
  return r9(pos.notional * signed * periods);
}
function fundingRate(oi) {
  const L = Number(oi && oi.long) || 0, S = Number(oi && oi.short) || 0, T = L + S;
  const skew = T > 0 ? (L - S) / T : 0;
  const r = PERP.FUNDING_BASE + PERP.FUNDING_SKEW * skew;
  return r6(Math.max(-PERP.FUNDING_MAX, Math.min(PERP.FUNDING_MAX, r)));
}
// Close out a position at `mark`: returns the settlement breakdown (pure).
export function settleAt(pos, mark, now, reason) {
  const pnl = pnlOf(pos, mark);
  const funding = fundingOf(pos, now);
  const closeFee = r9(pos.notional * PERP.FEE);
  let equity = r9(pos.margin + pnl - funding - closeFee);
  const maint = r9(pos.notional * PERP.MMR);
  let status = reason === 'liquidation' ? 'liquidated' : 'closed';
  if (equity <= maint) { status = 'liquidated'; equity = 0; }
  const profit = Math.max(0, equity - pos.margin);
  const edgeFee = r9(profit * PERP.EDGE);
  const payout = Math.max(0, r9(equity - edgeFee));
  return { pnl, funding, closeFee, edgeFee, payout, status, roe: pos.margin > 0 ? r6((payout - pos.margin) / pos.margin) : 0 };
}

export function installPerps(PlayLedger) {
  const P = PlayLedger.prototype;

  P.perpOi = async function (symbol) { return (await this.state.storage.get('perpoi:' + symbol)) || { long: 0, short: 0 }; };
  P.perpOiAdd = async function (symbol, side, delta) {
    const oi = await this.perpOi(symbol);
    oi[side] = Math.max(0, r9((oi[side] || 0) + delta));
    await this.state.storage.put('perpoi:' + symbol, oi);
    return oi;
  };
  P.perpArm = async function (atMs) {
    try { const cur = await this.state.storage.getAlarm(); if (!cur || cur > atMs) await this.state.storage.setAlarm(atMs); } catch (_) {}
  };

  /* ---- GET /play/perp/markets ------------------------------------------- */
  let marketsCache = null;
  P.handlePerpMarkets = async function () {
    if (marketsCache && Date.now() - marketsCache.at < 15000) return json(marketsCache.body);
    const quotes = await Promise.all(PERP_MARKETS.map(m => fetchQuote(m.symbol).catch(() => null)));
    const ois = await Promise.all(PERP_MARKETS.map(m => this.perpOi(m.symbol)));
    const markets = PERP_MARKETS.map((m, i) => {
      const q = quotes[i], oi = ois[i];
      return {
        symbol: m.symbol, name: m.name, kind: m.kind, maxLev: m.maxLev,
        mark: q ? q.price : null, prevClose: q ? q.prevClose : null, changePct: q ? q.changePct : null, asOf: q ? q.asOf : null,
        open: q ? isFresh(m, q) : false, fundingRate: fundingRate(oi), oiLong: r6(oi.long || 0), oiShort: r6(oi.short || 0),
        mmr: PERP.MMR, fee: PERP.FEE
      };
    });
    const body = { ok: true, markets, ts: Date.now(), rules: { mmr: PERP.MMR, fee: PERP.FEE, edge: PERP.EDGE, fundingPeriodMs: PERP.FUNDING_PERIOD_MS, minMargin: PERP.MIN_MARGIN } };
    marketsCache = { at: Date.now(), body };
    return json(body);
  };

  /* ---- GET /play/perp/positions?wallet= --------------------------------- */
  P.handlePerpPositions = async function (url) {
    const wallet = String(url.searchParams.get('wallet') || '');
    if (!isPubkey(wallet)) return json({ error: 'invalid_wallet' }, 400);
    const list = await this.state.storage.list({ prefix: 'perppos:' + wallet + ':' });
    const open = [], history = [];
    list.forEach((v) => { if (!v) return; if (v.open) open.push(v); else history.push(v); });
    open.sort((a, b) => b.openedAt - a.openedAt);
    history.sort((a, b) => (b.closedAt || 0) - (a.closedAt || 0));
    // Mark the open ones to the freshest price we have (never fabricate: null if unknown).
    const syms = Array.from(new Set(open.map(p => p.symbol)));
    const quotes = {}; await Promise.all(syms.map(s => fetchQuote(s).then(q => { quotes[s] = q; }).catch(() => {})));
    const now = Date.now();
    const marked = open.map(p => {
      const q = quotes[p.symbol]; if (!q) return Object.assign({}, p, { mark: null });
      const s = settleAt(p, q.price, now, 'close');
      return Object.assign({}, p, { mark: q.price, markAsOf: q.asOf, unrealized: s.pnl, fundingAccrued: s.funding, equity: s.payout, roe: s.roe, wouldLiquidate: s.status === 'liquidated' });
    });
    return json({ ok: true, wallet, positions: marked, history: history.slice(0, PERP.HISTORY_KEEP), ts: now });
  };

  /* ---- POST /play/perp/open --------------------------------------------- */
  P.handlePerpOpen = async function (request) {
    let body; try { body = await request.json(); } catch (_) { return json({ error: 'invalid_json' }, 400); }
    const wallet = String(body && body.wallet || '');
    const symbol = String(body && body.symbol || '').toUpperCase().slice(0, 12);
    const side = (body && body.side) === 'short' ? 'short' : 'long';
    const margin = r9(body && body.margin);
    const leverage = Math.floor(Number(body && body.leverage));
    const m = BY_SYMBOL[symbol];
    if (!isPubkey(wallet)) return json({ error: 'invalid_wallet' }, 400);
    if (!m) return json({ error: 'unknown_market', note: 'Perps are listed on a fixed set of mirrored markets.' }, 400);
    if (!(margin >= PERP.MIN_MARGIN)) return json({ error: 'invalid_margin', note: 'Minimum margin is ' + PERP.MIN_MARGIN + ' OSTG.' }, 400);
    if (!(leverage >= 1 && leverage <= m.maxLev)) return json({ error: 'invalid_leverage', note: 'Leverage must be 1–' + m.maxLev + 'x for ' + symbol + '.', maxLev: m.maxLev }, 400);

    // Price + bankroll UNLOCKED (network). Never fabricate a price.
    let q;
    try { q = await fetchQuote(symbol); } catch (_) { return json({ error: 'quote_unavailable', message: 'Could not fetch a live price for ' + symbol + '.' }, 502); }
    if (!isFresh(m, q)) return json({ error: 'market_closed', note: symbol + ' is not trading right now — stock perps open only during market hours. Crypto perps trade 24/7.', asOf: q.asOf }, 409);
    const bankroll = await this.poolBankroll();
    const notional = r9(margin * leverage);
    const openFee = r9(notional * PERP.FEE);
    const cost = r9(margin + openFee);
    // Exposure caps: one position ≤ 15% of the pool, and a wallet's open notional ≤ 50%.
    const cap = bankroll != null ? Math.max(50, bankroll * 0.15) : 1000;
    if (notional > cap) return json({ error: 'exposure_cap', note: 'Max notional right now is ' + Math.floor(cap) + ' OSTG. Lower the margin or leverage.', cap }, 409);
    const oi = await this.perpOi(symbol);
    const rate = fundingRate(oi);

    return await this.state.blockConcurrencyWhile(async () => {
      const balance = Number((await this.state.storage.get('bal:' + wallet)) || 0);
      if (balance + 1e-9 < cost) return json({ error: 'insufficient_balance', balance, need: cost }, 400);
      let walletNotional = 0;
      (await this.state.storage.list({ prefix: 'perppos:' + wallet + ':' })).forEach(v => { if (v && v.open) walletNotional += Number(v.notional) || 0; });
      if (bankroll != null && walletNotional + notional > bankroll * 0.5) return json({ error: 'exposure_cap', note: 'Your open perps already use most of what the pool can back. Close one first.' }, 409);
      const total = Number((await this.state.storage.get('total')) || 0);
      const id = 'perp_' + Date.now().toString(36) + '_' + crypto.randomUUID().slice(0, 8);
      const pos = {
        id, wallet, symbol, name: m.name, kind: m.kind, side, margin, leverage, notional, size: r9(notional / q.price),
        entryPrice: q.price, liqPrice: r6(liqPriceFor(side, q.price, leverage)), openFee, fundingRate: rate,
        openedAt: Date.now(), open: true, status: 'open'
      };
      await this.state.storage.put('bal:' + wallet, r9(balance - cost));
      await this.state.storage.put('total', r9(total - cost));
      const acc = Number((await this.state.storage.get('houseAccrued')) || 0) + openFee;
      await this.state.storage.put('houseAccrued', r6(acc));
      await this.state.storage.put('perppos:' + wallet + ':' + id, pos);
      await this.perpOiAdd(symbol, side, notional);
      await this.perpArm(Date.now() + PERP.SWEEP_MS);
      publishRealtimeEvent(this.env, {
        type: 'perp.fill', public: true, silent: true, channels: ['all', 'stock', 'perp', 'wallet:' + wallet], wallet,
        payload: { id, symbol, side, margin, leverage, notional, entryPrice: q.price, walletShort: wallet.slice(0, 4) + '…' + wallet.slice(-4), ts: pos.openedAt }
      }).catch(() => {});
      return json({ ok: true, position: pos, balance: r9(balance - cost) });
    });
  };

  /* ---- POST /play/perp/close -------------------------------------------- */
  P.handlePerpClose = async function (request) {
    let body; try { body = await request.json(); } catch (_) { return json({ error: 'invalid_json' }, 400); }
    const wallet = String(body && body.wallet || '');
    const id = String(body && (body.id || body.positionId) || '');
    if (!isPubkey(wallet)) return json({ error: 'invalid_wallet' }, 400);
    if (!id) return json({ error: 'missing_position' }, 400);
    const key = 'perppos:' + wallet + ':' + id;
    const pos = await this.state.storage.get(key);
    if (!pos) return json({ error: 'unknown_position' }, 404);
    if (!pos.open) return json({ ok: true, replay: true, position: pos, payout: pos.payout || 0, status: pos.status });
    let q;
    try { q = await fetchQuote(pos.symbol); } catch (_) { return json({ error: 'quote_unavailable', message: 'Could not fetch a live price to close.' }, 502); }
    const bankroll = await this.poolBankroll();
    if (bankroll == null) return json({ ok: false, error: 'bankroll_unreadable', note: 'refusing to credit against an unknown pool' }, 503);
    return await this.state.blockConcurrencyWhile(async () => {
      const fresh = await this.state.storage.get(key);
      if (!fresh || !fresh.open) return json({ ok: true, replay: true, position: fresh, payout: (fresh && fresh.payout) || 0, status: fresh && fresh.status });
      const now = Date.now();
      const s = settleAt(fresh, q.price, now, 'close');
      const balance = Number((await this.state.storage.get('bal:' + wallet)) || 0);
      const total = Number((await this.state.storage.get('total')) || 0);
      if (s.payout > 0 && (total + s.payout) > bankroll + 1e-9) return json({ error: 'bankroll_cap', message: 'Pool can’t back that close right now.' }, 409);
      Object.assign(fresh, { open: false, status: s.status, exitPrice: q.price, closedAt: now, pnl: s.pnl, funding: s.funding, closeFee: s.closeFee, edgeFee: s.edgeFee, payout: s.payout, roe: s.roe, closedBy: 'user' });
      await this.state.storage.put(key, fresh);
      if (s.payout > 0) { await this.state.storage.put('bal:' + wallet, r9(balance + s.payout)); await this.state.storage.put('total', r9(total + s.payout)); }
      const acc = Number((await this.state.storage.get('houseAccrued')) || 0) + s.closeFee + s.edgeFee;
      await this.state.storage.put('houseAccrued', r6(acc));
      await this.perpOiAdd(fresh.symbol, fresh.side, -fresh.notional);
      publishRealtimeEvent(this.env, {
        type: 'perp.close', public: true, silent: true, channels: ['all', 'stock', 'perp', 'wallet:' + wallet], wallet,
        payload: { id, symbol: fresh.symbol, side: fresh.side, status: s.status, pnl: s.pnl, payout: s.payout, exitPrice: q.price, ts: now }
      }).catch(() => {});
      return json({ ok: true, position: fresh, payout: s.payout, pnl: s.pnl, funding: s.funding, fee: r9(s.closeFee + s.edgeFee), status: s.status, exitPrice: q.price, balance: r9(balance + (s.payout > 0 ? s.payout : 0)) });
    });
  };

  /* ---- liquidation sweep (DO alarm) ------------------------------------ */
  P.perpSweep = async function () {
    let listed; try { listed = await this.state.storage.list({ prefix: 'perppos:', limit: 5000 }); } catch (_) { return false; }
    const open = []; listed.forEach(v => { if (v && v.open) open.push(v); });
    if (!open.length) return false;
    const syms = Array.from(new Set(open.map(p => p.symbol)));
    const quotes = {}; await Promise.all(syms.map(s => fetchQuote(s).then(q => { quotes[s] = q; }).catch(() => {})));
    const now = Date.now();
    for (const p of open) {
      const q = quotes[p.symbol]; const m = BY_SYMBOL[p.symbol]; if (!q || !m || !isFresh(m, q)) continue;
      const crossed = p.side === 'long' ? q.price <= p.liqPrice : q.price >= p.liqPrice;
      const s = settleAt(p, q.price, now, crossed ? 'liquidation' : 'close');
      if (!crossed && s.status !== 'liquidated') continue;
      const key = 'perppos:' + p.wallet + ':' + p.id;
      await this.state.blockConcurrencyWhile(async () => {
        const fresh = await this.state.storage.get(key); if (!fresh || !fresh.open) return;
        Object.assign(fresh, { open: false, status: 'liquidated', exitPrice: q.price, closedAt: now, pnl: s.pnl, funding: s.funding, closeFee: s.closeFee, edgeFee: 0, payout: 0, roe: -1, closedBy: 'liquidation' });
        await this.state.storage.put(key, fresh);
        const acc = Number((await this.state.storage.get('houseAccrued')) || 0) + fresh.margin;   // margin kept by the house
        await this.state.storage.put('houseAccrued', r6(acc));
        await this.perpOiAdd(fresh.symbol, fresh.side, -fresh.notional);
      });
      publishRealtimeEvent(this.env, {
        type: 'perp.liquidated', public: true, silent: true, channels: ['all', 'stock', 'perp', 'wallet:' + p.wallet], wallet: p.wallet,
        payload: { id: p.id, symbol: p.symbol, side: p.side, liqPrice: p.liqPrice, mark: q.price, margin: p.margin, ts: now }
      }).catch(() => {});
    }
    return true;
  };

  // The DO had no alarm before; perps own it. Re-arm while anything is open.
  P.alarm = async function () {
    let again = false;
    try { again = await this.perpSweep(); } catch (_) { again = true; }
    if (again) { try { await this.state.storage.setAlarm(Date.now() + PERP.SWEEP_MS); } catch (_) {} }
  };

  // Router hook: returns a Response or null.
  P.routePerp = async function (path, method, request, url) {
    if (path === '/play/perp/markets' && method === 'GET') return await this.handlePerpMarkets();
    if (path === '/play/perp/positions' && method === 'GET') return await this.handlePerpPositions(url);
    if (path === '/play/perp/open' && method === 'POST') return await this.handlePerpOpen(request);
    if (path === '/play/perp/close' && method === 'POST') return await this.handlePerpClose(request);
    if (path === '/play/perp/sweep' && method === 'POST') { const r = await this.perpSweep(); if (r) await this.perpArm(Date.now() + PERP.SWEEP_MS); return json({ ok: true, swept: r }); }
    return null;
  };
}

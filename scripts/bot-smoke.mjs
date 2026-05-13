#!/usr/bin/env node
/**
 * OST Bot API smoke test.
 *
 * Exercises the public bot surface end-to-end against the live worker:
 *   1. /health                       — auth-free service introspection
 *   2. /btc/round                    — canonical round (sanity)
 *   3. /bot/v1/health                — bot api docs
 *   4. /bot/v1/markets               — list (must include OST native btc5m)
 *   5. /bot/v1/btc/round             — same canonical state, via bot path
 *   6. /bot/v1/quote/<id>?side=yes   — buy quote
 *   7. /bot/v1/order  (BUY YES)      — place buy
 *   8. /bot/v1/order  (BUY NO)       — place hedge
 *   9. /bot/v1/order  (HOLD)         — record a no-op state
 *  10. /bot/v1/order  (REBUY)        — repeat last buy
 *  11. /bot/v1/order  (ARB)          — arbitrage pair (yes+no)
 *  12. /bot/v1/positions/<wallet>    — read back persisted orders
 *  13. /bot/v1/order/cashout         — close one order
 *
 * Usage:
 *   node scripts/bot-smoke.mjs                 # against prod worker
 *   API=https://ost-api.nachogtavl.workers.dev node scripts/bot-smoke.mjs
 *
 * Also runs a "two callers see the same number" assertion that proves the
 * cross-user data discrepancy is gone: two parallel /btc/round calls must
 * return the SAME openPrice + yesPriceNumber within tolerance.
 */

const API = process.env.API || 'https://ost-api.nachogtavl.workers.dev';
const KEY = process.env.OST_BOT_KEY || 'ost-bot-public-test-key';
const WALLET = process.env.WALLET || 'BotSmoke11111111111111111111111111111111111';
const HDRS = { 'content-type': 'application/json', 'x-ost-bot-key': KEY };

let pass = 0, fail = 0;
const log = (label, ok, extra) => {
  const tag = ok ? 'PASS' : 'FAIL';
  console.log(`[${tag}] ${label}${extra ? ' — ' + extra : ''}`);
  ok ? pass++ : fail++;
};

const req = async (path, init = {}) => {
  const r = await fetch(API + path, { ...init, headers: { ...HDRS, ...(init.headers || {}) } });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch (_) { /* plain text */ }
  return { status: r.status, json, text };
};

(async () => {
  console.log('OST Bot API smoke test against', API);
  console.log('  bot key      :', KEY);
  console.log('  test wallet  :', WALLET);
  console.log('');

  // 1. Worker health
  let h = await req('/health');
  log('GET /health', h.status === 200 && h.json && h.json.ok === true, h.status);

  // 2. Canonical round (proves new endpoint is live)
  let rd = await req('/btc/round');
  log('GET /btc/round', rd.status === 200 && rd.json && Number.isFinite(Number(rd.json.openPrice)), `open=${rd.json && rd.json.openPrice} yes=${rd.json && rd.json.yesPriceNumber}`);

  // ---- CRITICAL: two parallel callers MUST see identical canonical state ----
  const [a, b] = await Promise.all([req('/btc/round'), req('/btc/round')]);
  const sameOpen  = a.json && b.json && Number(a.json.openPrice) === Number(b.json.openPrice);
  const sameYesOk = a.json && b.json && Math.abs(Number(a.json.yesPriceNumber) - Number(b.json.yesPriceNumber)) < 0.005;
  log('cross-user parity (openPrice)', sameOpen, `${a.json && a.json.openPrice} vs ${b.json && b.json.openPrice}`);
  log('cross-user parity (yesProb)',  sameYesOk, `${a.json && a.json.yesPriceNumber} vs ${b.json && b.json.yesPriceNumber}`);

  // 3. Bot health
  let bh = await req('/bot/v1/health');
  log('GET /bot/v1/health', bh.status === 200 && bh.json && bh.json.ok === true);

  // 4. Bot markets (must include OST native btc5m at the front)
  let bm = await req('/bot/v1/markets');
  const ostNative = bm.json && Array.isArray(bm.json.markets) && bm.json.markets.find(m => m && m.id && String(m.id).indexOf('ost-btc5m-') === 0);
  log('GET /bot/v1/markets has OST native', !!ostNative, ostNative && ostNative.id);

  // 5. Bot btc/round
  let br = await req('/bot/v1/btc/round');
  log('GET /bot/v1/btc/round', br.status === 200 && br.json && Number.isFinite(Number(br.json.yesPriceNumber)));

  const marketId = ostNative ? ostNative.id : (br.json && br.json.id);

  // 6. Quote
  let q = await req(`/bot/v1/quote/${encodeURIComponent(marketId)}?side=yes&stake=10`);
  log('GET /bot/v1/quote', q.status === 200 && q.json && Number(q.json.price) > 0, `price=${q.json && q.json.price}`);

  // 7. Place BUY YES
  let buy = await req('/bot/v1/order', { method: 'POST', body: JSON.stringify({ wallet: WALLET, marketId, side: 'YES', stake: 10, channel: 'smoke-buy' }) });
  log('POST /bot/v1/order (BUY YES)', buy.status === 200 && buy.json && buy.json.ok === true, buy.json && buy.json.order && buy.json.order.id);

  // 8. Place BUY NO (hedge)
  let hedge = await req('/bot/v1/order', { method: 'POST', body: JSON.stringify({ wallet: WALLET, marketId, side: 'NO', stake: 5, channel: 'smoke-hedge' }) });
  log('POST /bot/v1/order (BUY NO hedge)', hedge.status === 200 && hedge.json && hedge.json.ok === true);

  // 9. HOLD (no-op state recorded)
  let hold = await req('/bot/v1/order', { method: 'POST', body: JSON.stringify({ wallet: WALLET, marketId, side: 'HOLD', stake: 0.01, channel: 'smoke-hold' }) });
  log('POST /bot/v1/order (HOLD)', hold.status === 200);

  // 10. REBUY (repeat last buy)
  let rebuy = await req('/bot/v1/order', { method: 'POST', body: JSON.stringify({ wallet: WALLET, marketId, side: 'YES', stake: 10, channel: 'smoke-rebuy' }) });
  log('POST /bot/v1/order (REBUY YES)', rebuy.status === 200);

  // 11. ARB pair (one yes, one no, opposite stakes)
  const [yArm, nArm] = await Promise.all([
    req('/bot/v1/order', { method: 'POST', body: JSON.stringify({ wallet: WALLET, marketId, side: 'YES', stake: 7, channel: 'smoke-arb' }) }),
    req('/bot/v1/order', { method: 'POST', body: JSON.stringify({ wallet: WALLET, marketId, side: 'NO',  stake: 7, channel: 'smoke-arb' }) })
  ]);
  log('POST /bot/v1/order (ARB pair)', yArm.status === 200 && nArm.status === 200);

  // 12. Read positions
  let pos = await req(`/bot/v1/positions/${WALLET}`);
  const posCount = pos.json && Array.isArray(pos.json.positions) ? pos.json.positions.length : 0;
  log('GET /bot/v1/positions', pos.status === 200 && posCount > 0, `count=${posCount}`);

  // 13. Cash out the original BUY
  if (buy.json && buy.json.order && buy.json.order.id) {
    let co = await req('/bot/v1/order/cashout', { method: 'POST', body: JSON.stringify({ wallet: WALLET, orderId: buy.json.order.id, payoutOst: 9.5, signature: 'smoke-cashout' }) });
    log('POST /bot/v1/order/cashout', co.status === 200 && co.json && co.json.ok === true);
  }

  console.log('');
  console.log(`Result: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(err => {
  console.error('SMOKE TEST CRASHED:', err);
  process.exit(2);
});

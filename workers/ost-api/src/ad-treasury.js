/* ==========================================================================
 * OST · Ad Treasury — the real ad-revenue -> OST loop
 * --------------------------------------------------------------------------
 * The loop only closes honestly if you separate two things that the old
 * client-side code conflated:
 *
 *   VIEWS  - a user watched an ad. We can count this, and we must rate-limit
 *            it SERVER-SIDE. The old cap lived in localStorage
 *            ('ost.ads.views.<uid>.<date>'), which any user can reset from
 *            devtools; the file's own comment said to replace it with a signed
 *            callback "when you deploy a backend". The backend exists now.
 *
 *   REVENUE - money an ad network actually owes or has paid us. This CANNOT be
 *            known from the browser. A view is not revenue: networks pay on
 *            their own reporting, net of invalid traffic, on Net-7/30 terms.
 *            So revenue is only ever recorded from an authenticated source
 *            (admin entry after a payout lands, or a signed S2S postback).
 *
 * Everything reported publicly distinguishes accrued (estimated, from views)
 * from received (money actually in hand). Showing an estimate as though it
 * were received is how a reserve stops reconciling - and if OSTG is sold
 * against this reserve, that gap is somebody's money.
 * ========================================================================== */

const VIEW_PREFIX = 'views:';        // views:<day>:<uid> -> count
const DAY_PREFIX  = 'day:';          // day:<day>         -> { views, uniques }
const REVENUE_KEY = 'revenue';       // lifetime received, per network
const ACCRUED_KEY = 'accrued';       // lifetime estimated, from views

const DAILY_VIEW_CAP = 20;
const VIEW_TTL_DAYS = 45;

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  });

const today = () => new Date().toISOString().slice(0, 10);

export class AdTreasury {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async recordView(uid, estimatedUsd) {
    const day = today();
    const key = `${VIEW_PREFIX}${day}:${uid}`;

    return await this.state.blockConcurrencyWhile(async () => {
      const count = Number(await this.state.storage.get(key)) || 0;
      if (count >= DAILY_VIEW_CAP) {
        return { ok: false, error: 'daily_cap_reached', views: count, cap: DAILY_VIEW_CAP };
      }
      await this.state.storage.put(key, count + 1, {
        expiration: Math.floor(Date.now() / 1000) + VIEW_TTL_DAYS * 86400
      });

      const dayKey = DAY_PREFIX + day;
      const dayRow = (await this.state.storage.get(dayKey)) || { views: 0, accruedUsd: 0 };
      dayRow.views += 1;
      dayRow.accruedUsd = Math.round((dayRow.accruedUsd + estimatedUsd) * 1e6) / 1e6;
      await this.state.storage.put(dayKey, dayRow);

      const accrued = (await this.state.storage.get(ACCRUED_KEY)) || { views: 0, usd: 0 };
      accrued.views += 1;
      accrued.usd = Math.round((accrued.usd + estimatedUsd) * 1e6) / 1e6;
      await this.state.storage.put(ACCRUED_KEY, accrued);

      return { ok: true, views: count + 1, cap: DAILY_VIEW_CAP, remaining: DAILY_VIEW_CAP - (count + 1) };
    });
  }

  // Money actually received from a network. Admin-authenticated upstream.
  async recordRevenue({ network, usd, currency, reference, note }) {
    return await this.state.blockConcurrencyWhile(async () => {
      const ledger = (await this.state.storage.get(REVENUE_KEY)) || { totalUsd: 0, entries: [], byNetwork: {} };
      // Idempotent on the payout reference so a re-submitted payout cannot
      // inflate the reserve.
      if (reference && ledger.entries.some((e) => e.reference === reference)) {
        return { ok: true, replay: true, totalUsd: ledger.totalUsd };
      }
      const entry = {
        network: String(network || 'unknown'),
        usd: Number(usd) || 0,
        currency: String(currency || 'USD'),
        reference: reference ? String(reference) : null,
        note: note ? String(note).slice(0, 300) : null,
        ts: Date.now()
      };
      ledger.entries.unshift(entry);
      ledger.entries = ledger.entries.slice(0, 500);
      ledger.totalUsd = Math.round((ledger.totalUsd + entry.usd) * 100) / 100;
      ledger.byNetwork[entry.network] = Math.round(((ledger.byNetwork[entry.network] || 0) + entry.usd) * 100) / 100;
      await this.state.storage.put(REVENUE_KEY, ledger);
      return { ok: true, replay: false, totalUsd: ledger.totalUsd, entry };
    });
  }

  async summary() {
    const accrued = (await this.state.storage.get(ACCRUED_KEY)) || { views: 0, usd: 0 };
    const revenue = (await this.state.storage.get(REVENUE_KEY)) || { totalUsd: 0, entries: [], byNetwork: {} };
    const day = today();
    const dayRow = (await this.state.storage.get(DAY_PREFIX + day)) || { views: 0, accruedUsd: 0 };

    return {
      ok: true,
      hub: 'durable-object',
      today: { day, views: dayRow.views, accruedUsd: dayRow.accruedUsd },
      lifetime: {
        views: accrued.views,
        // ESTIMATED from view counts at our assumed rate. Not money in hand.
        accruedUsd: accrued.usd,
        // ACTUALLY RECEIVED from networks. This is the only figure that may
        // ever back issued OSTG.
        receivedUsd: revenue.totalUsd,
        byNetwork: revenue.byNetwork
      },
      recentPayouts: revenue.entries.slice(0, 20),
      note: 'accruedUsd is an estimate from view counts; receivedUsd is money actually paid out by the networks. Only receivedUsd backs anything.',
      ts: Date.now()
    };
  }

  async fetch(request) {
    const url = new URL(request.url);
    const op = url.pathname.replace(/^\//, '') || 'summary';
    let body = {};
    if (request.method === 'POST') { try { body = await request.json(); } catch { body = {}; } }

    try {
      if (op === 'view')    return json(await this.recordView(String(body.uid || 'anon').slice(0, 80), Number(body.estimatedUsd) || 0));
      if (op === 'revenue') return json(await this.recordRevenue(body));
      if (op === 'summary') return json(await this.summary());
      return json({ ok: false, error: 'unknown op: ' + op }, 400);
    } catch (error) {
      return json({ ok: false, error: String(error?.message || error) }, 500);
    }
  }
}

/* ---- routes -------------------------------------------------------------- */

export async function handleAdRequest(request, env, { path, method, adminAuthorized }) {
  if (method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization'
      }
    });
  }

  if (!env.AD_TREASURY) return json({ ok: false, error: 'ad_treasury_not_configured' }, 503);
  const stub = env.AD_TREASURY.get(env.AD_TREASURY.idFromName('ads-v1'));

  // Public: the funding loop, with estimate and received kept apart.
  if (path === '/ads/treasury' && method === 'GET') {
    return await stub.fetch('https://ad-treasury/summary');
  }

  // Server-side view cap. Replaces the forgeable localStorage counter.
  if (path === '/ads/view' && method === 'POST') {
    let body; try { body = await request.json(); } catch { return json({ ok: false, error: 'invalid_json' }, 400); }
    return await stub.fetch('https://ad-treasury/view', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        uid: body.uid,
        // The per-view estimate is OUR assumption, set server-side so a client
        // cannot claim a higher rate for itself.
        estimatedUsd: Number(env.AD_ESTIMATED_USD_PER_VIEW || 0.002)
      })
    });
  }

  // Admin: record a payout that actually landed.
  if (path === '/ads/revenue' && method === 'POST') {
    if (!adminAuthorized(request, env)) return json({ ok: false, error: 'unauthorized' }, 401);
    let body; try { body = await request.json(); } catch { return json({ ok: false, error: 'invalid_json' }, 400); }
    return await stub.fetch('https://ad-treasury/revenue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
  }

  return null;
}

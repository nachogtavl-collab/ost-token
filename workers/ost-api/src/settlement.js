/* ==========================================================================
 * OST · Settlement — real money in, OSTG out, without ever holding keys
 * --------------------------------------------------------------------------
 * A payment processor takes the customer's BTC/ETH/USDT/SOL/card/bank, handles
 * confirmations, reorgs and refunds, and then tells US that money landed. We
 * never generate a deposit address, never hold a private key, never sweep a
 * hot wallet. That is the whole point of this file: the riskiest part of
 * selling a token is custody, and the correct amount of custody code to write
 * is none.
 *
 * PROVIDER-AGNOSTIC BY CONSTRUCTION. Everything below normalizes to:
 *
 *     { ref, orderId, status, paidUsd, payCurrency }
 *
 * so swapping NOWPayments for BitPay (or adding both) is a new adapter, not a
 * rewrite of the credit path. The credit path is PurchaseLedger.credit(), which
 * is idempotent on `ref` - so a processor that retries its webhook five times,
 * as they all do, credits exactly once.
 *
 * THE FOUR RULES THIS FILE EXISTS TO ENFORCE
 *   1. VERIFY THE SIGNATURE. An unsigned webhook is an attacker telling us
 *      they paid. Unverified => 401, never a credit.
 *   2. NEVER TRUST THE AMOUNT IN THE WEBHOOK ALONE. Compare against the intent
 *      we created. Underpayment does not silently become a full delivery.
 *   3. ONLY TERMINAL SUCCESS CREDITS. 'confirming' is not 'finished'. Crediting
 *      on a pending state is how you deliver goods for a payment that later
 *      fails or is refunded.
 *   4. IDEMPOTENT ON THE PROCESSOR'S PAYMENT ID, not on our own state.
 *
 * SETUP (secrets, never commit):
 *     npx wrangler secret put NOWPAYMENTS_API_KEY
 *     npx wrangler secret put NOWPAYMENTS_IPN_SECRET
 * ========================================================================== */

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  });

/* ---- crypto helpers ------------------------------------------------------ */

// Recursive key-sorted stringify. NOWPayments signs the IPN body with its keys
// sorted, so we must reproduce the exact same byte string or every signature
// mismatches.
function sortedStringify(value) {
  if (Array.isArray(value)) return '[' + value.map(sortedStringify).join(',') + ']';
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + sortedStringify(value[k])).join(',') + '}';
  }
  return JSON.stringify(value === undefined ? null : value);
}

async function hmacHex(secret, message, hash) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Length-invariant comparison. A plain === on secrets leaks timing.
function timingSafeEqual(a, b) {
  const x = String(a || '');
  const y = String(b || '');
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

/* ---- adapters ------------------------------------------------------------ */

const ADAPTERS = {
  /* NOWPayments — https://nowpayments.io
   * IPN: POST with header `x-nowpayments-sig` = HMAC-SHA512 of the key-sorted
   * JSON body, using the IPN secret.
   *
   * NOTE FOR GO-LIVE: confirm this signature scheme against a REAL test IPN
   * from your dashboard before switching the kill-switch on. If their scheme
   * ever changes, this must fail closed (401), which it does - it will never
   * fall through to a credit.
   */
  nowpayments: {
    id: 'nowpayments',
    secretName: 'NOWPAYMENTS_IPN_SECRET',

    async verify(env, request, rawBody) {
      const secret = env.NOWPAYMENTS_IPN_SECRET;
      if (!secret) return { ok: false, error: 'ipn_secret_not_configured' };
      const provided = request.headers.get('x-nowpayments-sig') || '';
      if (!provided) return { ok: false, error: 'missing_signature' };

      let parsed;
      try { parsed = JSON.parse(rawBody); }
      catch { return { ok: false, error: 'invalid_json' }; }

      const expected = await hmacHex(secret, sortedStringify(parsed), 'SHA-512');
      if (!timingSafeEqual(expected, provided)) return { ok: false, error: 'bad_signature' };
      return { ok: true, body: parsed };
    },

    normalize(body) {
      // finished  = settled and final.
      // confirmed = confirmed on chain but not yet settled to us.
      // Anything else is pending/failed and must NOT credit.
      const raw = String(body.payment_status || '').toLowerCase();
      const status = raw === 'finished' ? 'paid'
        : (raw === 'partially_paid' ? 'underpaid'
        : (['failed', 'refunded', 'expired'].includes(raw) ? 'failed' : 'pending'));

      return {
        ref: String(body.payment_id || ''),
        orderId: String(body.order_id || ''),
        status,
        rawStatus: raw,
        // price_amount is what we ASKED for in price_currency (we always ask in
        // USD). actually_paid is in the coin the customer sent, so it is NOT
        // comparable to USD and must never be used as a USD figure.
        askedUsd: Number(body.price_amount) || 0,
        payCurrency: String(body.pay_currency || '').toUpperCase(),
        outcomeAmount: Number(body.outcome_amount) || 0,
        outcomeCurrency: String(body.outcome_currency || '').toUpperCase()
      };
    },

    async createPayment(env, { intent, successUrl, cancelUrl }) {
      const apiKey = env.NOWPAYMENTS_API_KEY;
      if (!apiKey) return { ok: false, error: 'api_key_not_configured' };
      const r = await fetch('https://api.nowpayments.io/v1/invoice', {
        method: 'POST',
        headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          price_amount: intent.usd,
          price_currency: 'usd',
          order_id: intent.id,
          order_description: `OSTG game tokens (${intent.ostAmount} OSTG)`,
          ipn_callback_url: `${env.PUBLIC_API_URL || 'https://ost-api.nachogtavl.workers.dev'}/settlement/nowpayments/webhook`,
          success_url: successUrl || undefined,
          cancel_url: cancelUrl || undefined
        })
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) return { ok: false, error: 'provider_error', detail: body };
      return { ok: true, ref: String(body.id || ''), url: body.invoice_url || '', provider: 'nowpayments' };
    }
  }
};

/* ---- routes -------------------------------------------------------------- */

export async function handleSettlementRequest(request, env, ctx) {
  const { path, method, deps } = ctx;

  if (method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type,x-nowpayments-sig'
      }
    });
  }

  if (path === '/settlement/health') {
    return json({
      ok: true,
      providers: Object.keys(ADAPTERS).map((id) => ({
        id,
        configured: !!env[ADAPTERS[id].secretName],
        live: !!env[ADAPTERS[id].secretName] && env.SETTLEMENT_LIVE === 'true'
      })),
      // Explicit kill-switch. Until SETTLEMENT_LIVE is "true" no webhook can
      // credit, even with a valid signature. Selling before the licence and the
      // reserve are actually in place is the failure this guards.
      live: env.SETTLEMENT_LIVE === 'true',
      ts: Date.now()
    });
  }

  const webhookMatch = path.match(/^\/settlement\/([a-z0-9_-]+)\/webhook$/);
  if (webhookMatch && method === 'POST') {
    const adapter = ADAPTERS[webhookMatch[1]];
    if (!adapter) return json({ ok: false, error: 'unknown_provider' }, 404);

    const rawBody = await request.text();
    const verified = await adapter.verify(env, request, rawBody);
    if (!verified.ok) {
      // Fail closed and say why in the log, but never echo the reason in a way
      // that helps someone probe the signature scheme.
      return json({ ok: false, error: 'unauthorized' }, 401);
    }

    const event = adapter.normalize(verified.body);
    if (!event.ref || !event.orderId) return json({ ok: false, error: 'missing_ids' }, 400);

    // Acknowledge non-terminal states with 200 so the processor stops retrying
    // a payment that simply is not finished yet.
    if (event.status !== 'paid') {
      return json({ ok: true, credited: false, status: event.rawStatus, reason: 'not_terminal_success' });
    }

    if (env.SETTLEMENT_LIVE !== 'true') {
      return json({ ok: true, credited: false, reason: 'settlement_kill_switch_off', status: event.rawStatus });
    }

    const intent = await deps.loadIntent(env, event.orderId);
    if (!intent) return json({ ok: false, error: 'intent_not_found' }, 404);

    // Rule 2: the processor tells us what was asked for; we compare it to what
    // WE recorded when the customer started. A mismatch means the request was
    // tampered with between our intent and their invoice - do not deliver.
    const expectedUsd = Number(intent.usd) || 0;
    if (Math.abs(event.askedUsd - expectedUsd) > 0.01) {
      return json({
        ok: false,
        error: 'amount_mismatch',
        expectedUsd,
        reportedUsd: event.askedUsd,
        note: 'settle by hand; not auto-credited'
      }, 409);
    }

    const credited = await deps.creditIntent(env, {
      intentId: intent.id,
      ref: event.ref,
      rail: `${adapter.id}:${event.payCurrency || 'unknown'}`
    });
    if (!credited || !credited.ok) {
      return json({ ok: false, error: (credited && credited.error) || 'credit_failed' }, 409);
    }

    return json({
      ok: true,
      credited: !credited.replay,
      replay: !!credited.replay,
      intent: credited.intent && credited.intent.id,
      rail: `${adapter.id}:${event.payCurrency}`
    });
  }

  // Start a hosted checkout for an existing intent.
  if (path === '/settlement/checkout' && method === 'POST') {
    let body; try { body = await request.json(); } catch { return json({ ok: false, error: 'invalid_json' }, 400); }
    const adapter = ADAPTERS[String(body.provider || 'nowpayments')];
    if (!adapter) return json({ ok: false, error: 'unknown_provider' }, 404);

    const intent = await deps.loadIntent(env, body.intentId);
    if (!intent) return json({ ok: false, error: 'intent_not_found' }, 404);
    if (intent.status !== 'pending') return json({ ok: false, error: 'intent_not_pending', status: intent.status }, 409);

    const created = await adapter.createPayment(env, {
      intent,
      successUrl: body.successUrl,
      cancelUrl: body.cancelUrl
    });
    if (!created.ok) return json(created, 502);

    // Map processor ref -> intent so a webhook that only carries their id can
    // still find the customer.
    if (created.ref) await deps.mapRef(env, created.ref, intent.id);
    return json(created);
  }

  return null;
}

/* ==========================================================================
 * OST · Purchase Ledger — the authoritative record of every REAL-MONEY buy
 * --------------------------------------------------------------------------
 * Replaces the KV-backed topup intent store. Two reasons, both of which cost
 * real customers real money on the old path:
 *
 *   1. KV WRITE BUDGET. Every topup route began with
 *          if (!env.OST_KV) return 503 kv_not_configured
 *      and stored intents as KV writes. OST_KV runs on a ~1k writes/day budget
 *      with a tierDown('kv') breaker that SHEDS WRITES under pressure. On the
 *      game path a shed write costs a round. On the money path it costs a
 *      customer who paid and got nothing. A Durable Object has no daily write
 *      cap, so the money path can no longer be starved by game traffic.
 *
 *   2. DOUBLE-CREDIT RACE. markIntentPaidFromCrypto did:
 *          existing = await kvGet(sig)      // check
 *          ...
 *          await kvPut(sig, intent.id)      // write
 *      That is check-then-write over an EVENTUALLY CONSISTENT store, and two
 *      callers race it for real: /topup/crypto/verify (user pressed the button)
 *      and /topup/crypto/check/:intent (the auto-detect poller) can run at the
 *      same moment, in different colos, both read null, and both credit. One
 *      payment, credited twice. A single DO serializes every credit through one
 *      thread, so the check and the write can no longer be split.
 *
 * Everything here is idempotent BY PAYMENT REFERENCE, never by intent state:
 * the same on-chain signature (or processor payment id) can be presented any
 * number of times and credits exactly once.
 *
 * D1 carries an append-only journal beside the DO storage. The DO is the
 * operational truth; the journal is the audit trail you can hand a regulator
 * or reconcile a reserve against. A journal write that fails NEVER fails the
 * credit — but it is recorded as degraded, not swallowed.
 * ========================================================================== */

const INTENT_PREFIX = 'intent:';
const SIG_PREFIX    = 'sig:';
const PSP_PREFIX    = 'psp:';
const QUEUE_KEY     = 'queue';
const SENT_KEY      = 'sent';

const MAX_QUEUE = 500;
const MAX_SENT  = 200;

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

export class PurchaseLedger {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.journalReady = false;
  }

  /* ---- D1 append-only audit journal ------------------------------------ */

  async ensureJournal() {
    if (this.journalReady || !this.env.DB) return this.journalReady;
    try {
      await this.env.DB.prepare(
        'CREATE TABLE IF NOT EXISTS purchase_journal (' +
        ' id TEXT PRIMARY KEY,' +
        ' intent_id TEXT NOT NULL,' +
        ' event TEXT NOT NULL,' +
        ' wallet TEXT,' +
        ' rail TEXT,' +
        ' payment_ref TEXT,' +
        ' usd REAL,' +
        ' ost_amount REAL,' +
        ' ts INTEGER NOT NULL,' +
        ' detail TEXT)'
      ).run();
      await this.env.DB.prepare(
        'CREATE INDEX IF NOT EXISTS purchase_journal_intent ON purchase_journal (intent_id)'
      ).run();
      this.journalReady = true;
    } catch {
      this.journalReady = false;
    }
    return this.journalReady;
  }

  // Returns true when the row landed. Callers record the result rather than
  // assuming it worked - a silently missing audit row is how a reserve stops
  // reconciling months later with nothing to point at.
  async journal(event, intent, extra = {}) {
    if (!(await this.ensureJournal())) return false;
    try {
      await this.env.DB.prepare(
        'INSERT OR IGNORE INTO purchase_journal' +
        ' (id, intent_id, event, wallet, rail, payment_ref, usd, ost_amount, ts, detail)' +
        ' VALUES (?,?,?,?,?,?,?,?,?,?)'
      ).bind(
        `${intent.id}:${event}:${extra.paymentRef || intent.paymentRef || 'na'}`,
        intent.id,
        event,
        intent.wallet || null,
        extra.rail || intent.cryptoRail || intent.method || null,
        extra.paymentRef || intent.paymentRef || null,
        Number(intent.usd) || 0,
        Number(intent.ostAmount) || 0,
        Date.now(),
        extra.detail ? String(extra.detail).slice(0, 500) : null
      ).run();
      return true;
    } catch {
      return false;
    }
  }

  /* ---- storage helpers -------------------------------------------------- */

  async getIntent(id) {
    if (!id) return null;
    return (await this.state.storage.get(INTENT_PREFIX + id)) || null;
  }

  async putIntent(intent) {
    if (!intent || !intent.id) throw new Error('intent requires an id');
    await this.state.storage.put(INTENT_PREFIX + intent.id, intent);
    return intent;
  }

  async queuePush(id) {
    const q = ((await this.state.storage.get(QUEUE_KEY)) || []).filter((x) => x !== id);
    q.unshift(id);
    await this.state.storage.put(QUEUE_KEY, q.slice(0, MAX_QUEUE));
  }

  async queueRemove(id) {
    const q = ((await this.state.storage.get(QUEUE_KEY)) || []).filter((x) => x !== id);
    await this.state.storage.put(QUEUE_KEY, q);
  }

  /* ---- the one operation that must never race --------------------------- */

  /**
   * Credit a payment exactly once, keyed on its payment reference.
   *
   * `ref` is the on-chain signature for crypto rails, or the processor's
   * payment/session id for a PSP. Same ref twice => the SAME intent comes back
   * with ok:true and replay:true. It is never an error to re-present a payment
   * you already delivered; it IS an error to present one that paid a different
   * intent, because that means the caller mixed up two customers' money.
   */
  async credit(body) {
    const { intentId, ref, rail, enqueue = true, patch = {} } = body || {};
    if (!intentId) return json({ ok: false, error: 'intent_required' }, 400);
    if (!ref)      return json({ ok: false, error: 'payment_ref_required' }, 400);

    const sigKey = SIG_PREFIX + ref;

    // blockConcurrencyWhile is the serialization point. Everything inside is
    // storage-only and fast - no RPC, no fetch. (PlayLedger learned the hard
    // way that holding this lock across a slow network call hits Cloudflare's
    // lock ceiling; verification happens BEFORE we get here, unlocked.)
    const outcome = await this.state.blockConcurrencyWhile(async () => {
      const owner = await this.state.storage.get(sigKey);
      const intent = await this.getIntent(intentId);
      if (!intent) return { ok: false, error: 'intent_not_found', status: 404 };

      if (owner && owner !== intentId) {
        return { ok: false, error: 'signature_already_used', status: 409 };
      }
      if (owner === intentId) {
        // Already credited by an earlier caller. Idempotent replay.
        return { ok: true, intent, replay: true };
      }
      if (intent.status !== 'pending') {
        return { ok: false, error: 'intent_not_pending', status: 409, status_was: intent.status };
      }

      const now = Date.now();
      Object.assign(intent, patch, {
        status: 'paid',
        cryptoRail: rail || intent.cryptoRail || null,
        paymentRef: ref,
        paidAt: now,
        updatedAt: now
      });

      await this.state.storage.put(sigKey, intentId);
      await this.putIntent(intent);
      if (enqueue) await this.queuePush(intentId);
      return { ok: true, intent, replay: false };
    });

    if (!outcome.ok) return json(outcome, outcome.status || 409);

    let journaled = true;
    if (!outcome.replay) {
      journaled = await this.journal('paid', outcome.intent, { rail, paymentRef: ref });
    }
    return json({ ok: true, intent: outcome.intent, replay: !!outcome.replay, journaled });
  }

  /* ---- router ----------------------------------------------------------- */

  async fetch(request) {
    let body;
    try { body = await request.json(); } catch { return json({ ok: false, error: 'invalid_json' }, 400); }
    const op = body && body.op;

    try {
      switch (op) {
        case 'get':
          return json({ ok: true, intent: await this.getIntent(body.id) });

        case 'put': {
          const intent = await this.putIntent(body.intent);
          if (body.journalEvent) await this.journal(body.journalEvent, intent, { detail: body.detail });
          return json({ ok: true, intent });
        }

        case 'credit':
          return await this.credit(body);

        case 'queue.push':
          await this.queuePush(body.id);
          return json({ ok: true });

        case 'queue.remove':
          await this.queueRemove(body.id);
          return json({ ok: true });

        case 'queue.list':
          return json({ ok: true, ids: (await this.state.storage.get(QUEUE_KEY)) || [] });

        case 'sent.push': {
          const rows = (await this.state.storage.get(SENT_KEY)) || [];
          rows.unshift(body.row);
          await this.state.storage.put(SENT_KEY, rows.slice(0, MAX_SENT));
          if (body.row && body.row.id) {
            const intent = await this.getIntent(body.row.id);
            if (intent) await this.journal('delivered', intent, { detail: body.row.sig || null });
          }
          return json({ ok: true });
        }

        case 'sent.list':
          return json({ ok: true, rows: (await this.state.storage.get(SENT_KEY)) || [] });

        // Maps a processor session/payment id to an intent, so a webhook that
        // only knows the processor's id can find the customer it belongs to.
        // Batch "which of these payment refs are already spent?". The deposit
        // scanner walks ~120 recent signatures; asking one at a time would be
        // 120 round trips per poll.
        case 'sig.owners': {
          const refs = Array.isArray(body.refs) ? body.refs.slice(0, 250) : [];
          const owners = {};
          for (const ref of refs) {
            const owner = await this.state.storage.get(SIG_PREFIX + ref);
            if (owner) owners[ref] = owner;
          }
          return json({ ok: true, owners });
        }

        case 'ref.map':
          await this.state.storage.put(PSP_PREFIX + body.ref, body.intentId);
          return json({ ok: true });

        case 'ref.get':
          return json({ ok: true, intentId: (await this.state.storage.get(PSP_PREFIX + body.ref)) || null });

        case 'health': {
          const queue = (await this.state.storage.get(QUEUE_KEY)) || [];
          return json({
            ok: true,
            hub: 'durable-object',
            store: 'do-storage',
            queueDepth: queue.length,
            journal: await this.ensureJournal(),
            ts: Date.now()
          });
        }

        default:
          return json({ ok: false, error: 'unknown op: ' + op }, 400);
      }
    } catch (error) {
      return json({ ok: false, error: 'purchase ledger error: ' + String(error?.message || error) }, 500);
    }
  }
}

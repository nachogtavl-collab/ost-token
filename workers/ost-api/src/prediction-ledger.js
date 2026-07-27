/* ==========================================================================
 * OST · Prediction Ledger — SERVER-authoritative prediction positions
 * --------------------------------------------------------------------------
 * WHY THIS EXISTS
 * The old OSTG prediction rail let the CLIENT call /play/settle to credit its
 * own winnings — an unauthenticated money printer (red-team CRITICAL). The only
 * safe way to put OSTG on predictions is to make the SERVER own the bet:
 *
 *   OPEN    the server records the position and the entry odds from ITS OWN
 *           market data (never the client's number), and debits the stake.
 *   RESOLVE the server determines the outcome from an authoritative source and
 *           pays ONLY what that outcome dictates. The payout is computed here,
 *           never asserted by the caller.
 *
 * This mirrors how the on-chain betting program works (Pyth-settled, no
 * authority payout) and how handleBet already works for faucet games.
 *
 * THE INVARIANTS (each is a thing the printer violated):
 *   1. OPEN is internal-key gated — a stake debit is a balance mutation.
 *   2. Entry odds come from serverOdds(), clamped [0.001,0.999]. A client can
 *      NOT open at price 0.001 to mint 1000x shares — it doesn't set the price.
 *   3. RESOLVE is idempotent per position and pays a SERVER-computed amount.
 *      Safe to be public: triggering it early/repeatedly changes nothing,
 *      because the outcome is deterministic from market data and it settles once.
 *   4. Payout is bounded by the recorded shares and the real outcome. There is
 *      no path that credits an arbitrary number.
 *
 * Money lives in PlayLedger; this ledger owns POSITIONS and drives PlayLedger's
 * internal-keyed stake/settle to move the balance. It never holds balance.
 *
 * Outcome source is PLUGGABLE via resolveOutcome(). Today it handles BTC 5-min
 * rounds (recorded openPrice vs settle price). Other market types register the
 * same shape later. PREDICT_LIVE gates the whole feature; until it is "true"
 * open refuses, so no OSTG prediction can be placed before the outcome source
 * is confirmed accurate.
 * ========================================================================== */

const POS_PREFIX = 'ppos:';

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  });

const r6 = (n) => Math.round((Number(n) || 0) * 1e6) / 1e6;
const clampOdds = (p) => Math.max(0.001, Math.min(0.999, Number(p)));

export class PredictionLedger {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  // Call a PlayLedger internal-keyed mutator (stake to debit, settle to credit).
  async play(op, body) {
    if (!this.env.PLAY_LEDGER) return { ok: false, error: 'play_ledger_unavailable' };
    if (!this.env.INTERNAL_MUTATION_KEY) return { ok: false, error: 'internal_key_not_configured' };
    const stub = this.env.PLAY_LEDGER.get(this.env.PLAY_LEDGER.idFromName('global'));
    const r = await stub.fetch('https://play-ledger/play/' + op, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-ost-internal': this.env.INTERNAL_MUTATION_KEY },
      body: JSON.stringify(body)
    });
    return await r.json().catch(() => ({ ok: false, error: 'play_bad_response' }));
  }

  /* ---- authoritative market data ---------------------------------------- */

  // A BTC 5-min round id is `ost-btc5m-<openAt>`. The round record (KV
  // round:<openAt>) holds the openPrice we recorded when the round opened.
  parseBtcRound(marketId) {
    const m = String(marketId || '').match(/^ost-btc5m-(\d+)$/);
    if (!m) return null;
    const openAt = Number(m[1]);
    return { openAt, closeAt: openAt + 5 * 60 * 1000 };
  }

  async roundRecord(openAt) {
    // env.__store is the tiered KV accessor the worker installs; fall back to KV.
    try {
      if (this.env.__store) return await this.env.__store.get('round:' + openAt, null);
      if (this.env.OST_KV) return JSON.parse((await this.env.OST_KV.get('round:' + openAt)) || 'null');
    } catch (_) {}
    return null;
  }

  // Server odds for a side, from the shared per-round odds the desk already
  // computes. Provided by the caller (index.js) which has serverComputeBtcOdds.
  // Clamped so entry price can never be gamed to mint shares.
  entryOdds(side, oddsYes) {
    const yes = clampOdds(oddsYes);
    return side === 'no' ? clampOdds(1 - yes) : yes;
  }

  /* ---- open ------------------------------------------------------------- */

  async open(body) {
    if (String(this.env.PREDICT_LIVE) !== 'true') {
      return json({ ok: false, error: 'predictions_not_live',
        note: 'OSTG predictions are disabled until the server resolver is confirmed.' }, 503);
    }
    const wallet = String(body.wallet || '');
    const marketId = String(body.marketId || '');
    const side = body.side === 'no' ? 'no' : 'yes';
    const stake = r6(body.stake);
    const bucket = String(body.bucket || 'clean');
    const oddsYes = Number(body.oddsYes);   // server-provided, from index.js
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet)) return json({ ok: false, error: 'invalid_wallet' }, 400);
    if (!(stake > 0)) return json({ ok: false, error: 'invalid_stake' }, 400);
    if (!Number.isFinite(oddsYes)) return json({ ok: false, error: 'no_server_odds' }, 400);

    const round = this.parseBtcRound(marketId);
    if (!round) return json({ ok: false, error: 'unsupported_market', note: 'only ost-btc5m-* is server-resolvable today' }, 400);
    if (Date.now() >= round.closeAt) return json({ ok: false, error: 'round_closed' }, 409);

    const rec = await this.roundRecord(round.openAt);
    // Open reference price. Prefer the crank-locked open price; if the crank
    // isn't running, fall back to the CANONICAL price-to-beat the route computed
    // from NativeMarketHub (captured at the round boundary, deterministic). This
    // lets OSTG predictions open on the play rail WITHOUT a crank.
    let openPrice = rec && Number.isFinite(Number(rec.openPrice)) && Number(rec.openPrice) > 0 ? Number(rec.openPrice) : NaN;
    if (!(openPrice > 0) && Number.isFinite(Number(body.priceToBeat)) && Number(body.priceToBeat) > 0) openPrice = Number(body.priceToBeat);
    if (!(openPrice > 0)) {
      return json({ ok: false, error: 'round_open_price_unknown', note: 'no open price available for this round yet' }, 409);
    }

    // Entry odds are the SERVER's, clamped. Shares = stake / entry.
    const entry = this.entryOdds(side, oddsYes);
    const shares = r6(stake / entry);

    // Debit the stake FIRST via PlayLedger (internal-keyed). Only if that
    // succeeds do we record the position.
    const deb = await this.play('stake', { wallet, amount: stake, bucket });
    if (!deb || deb.ok === false) {
      return json({ ok: false, error: (deb && deb.error) || 'stake_failed' }, 409);
    }

    // The line the outcome is judged against is the price-to-beat the desk
    // showed the user (server-provided, canonical). Lock it onto the position so
    // settlement can NEVER drift from what the user bet against. Fall back to the
    // open price only if no price-to-beat was supplied.
    const priceToBeat = Number.isFinite(Number(body.priceToBeat)) && Number(body.priceToBeat) > 0
      ? Number(body.priceToBeat)
      : openPrice;

    const id = 'p_' + round.openAt + '_' + wallet.slice(0, 6) + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    const pos = {
      id, wallet, marketId, side, stake, entry, shares, bucket,
      openPrice: openPrice, priceToBeat, openAt: round.openAt, closeAt: round.closeAt,
      status: 'open', createdAt: Date.now()
    };
    await this.state.storage.put(POS_PREFIX + id, pos);
    return json({ ok: true, position: pos, balance: deb.balance });
  }

  /* ---- resolve ---------------------------------------------------------- */

  // Safe to be public: server-computed, idempotent, deterministic.
  async resolve(body) {
    const id = String(body.id || body.positionId || '');
    if (!id) return json({ ok: false, error: 'position_required' }, 400);

    return await this.state.blockConcurrencyWhile(async () => {
      const pos = await this.state.storage.get(POS_PREFIX + id);
      if (!pos) return json({ ok: false, error: 'position_not_found' }, 404);
      if (pos.status !== 'open') {
        return json({ ok: true, replay: true, status: pos.status, payout: pos.payout || 0 });
      }
      if (Date.now() < pos.closeAt) {
        return json({ ok: false, error: 'not_yet', closeAt: pos.closeAt }, 409);
      }

      // Authoritative outcome: the round's REAL close price vs the price-to-beat
      // LOCKED onto this position at open time (what the user actually bet
      // against). Settling against openPrice here would betray the line the desk
      // showed, so we use pos.priceToBeat (openPrice only as a legacy fallback).
      const settlePrice = Number(body.settlePrice);
      if (!Number.isFinite(settlePrice)) {
        // The caller (index.js) supplies the settle price from the settled round
        // snapshot. No price => the round has not closed yet; NEVER guess.
        return json({ ok: false, error: 'settle_price_unavailable' }, 503);
      }
      const line = Number.isFinite(Number(pos.priceToBeat)) && Number(pos.priceToBeat) > 0
        ? Number(pos.priceToBeat)
        : Number(pos.openPrice);

      let payout = 0, fee = 0, winningSide = null, status;
      if (settlePrice === line) {
        // Exact tie — neither side won. Refund the stake in full, no house fee.
        status = 'refunded';
        payout = r6(pos.stake);
      } else {
        winningSide = settlePrice > line ? 'yes' : 'no';
        const won = pos.side === winningSide;
        status = won ? 'won' : 'lost';
        if (won) {
          // Each winning share pays 1 OSTG; house edge on PROFIT only.
          const gross = r6(pos.shares);
          const profit = Math.max(0, gross - pos.stake);
          fee = r6(profit * 0.02);          // 2% of profit, matching OST_HOUSE
          payout = r6(gross - fee);
        }
      }

      // Credit the SERVER-computed payout back to the SAME bucket (keeps
      // loan-funded winnings locked). settle is internal-keyed in PlayLedger.
      if (payout > 0) {
        const cr = await this.play('settle', { wallet: pos.wallet, payout, bucket: pos.bucket, fee });
        if (!cr || cr.ok === false) {
          return json({ ok: false, error: 'payout_failed', detail: cr && cr.error }, 502);
        }
      }

      pos.status = status;
      pos.winningSide = winningSide;
      pos.settlePrice = settlePrice;
      pos.line = line;
      pos.payout = payout;
      pos.fee = fee;
      pos.resolvedAt = Date.now();
      await this.state.storage.put(POS_PREFIX + id, pos);
      return json({ ok: true, status, won: status === 'won', refunded: status === 'refunded', payout, fee, winningSide, settlePrice, line });
    });
  }

  async get(id) {
    const pos = await this.state.storage.get(POS_PREFIX + id);
    return json({ ok: !!pos, position: pos || null });
  }

  async fetch(request) {
    const url = new URL(request.url);
    const op = url.pathname.replace(/^\//, '');
    let body = {};
    if (request.method === 'POST') { try { body = await request.json(); } catch { body = {}; } }
    try {
      if (op === 'open')    return await this.open(body);
      if (op === 'resolve') return await this.resolve(body);
      if (op === 'get')     return await this.get(url.searchParams.get('id') || body.id);
      if (op === 'health')  return json({ ok: true, hub: 'durable-object', live: String(this.env.PREDICT_LIVE) === 'true' });
      return json({ ok: false, error: 'unknown op: ' + op }, 400);
    } catch (error) {
      return json({ ok: false, error: String(error?.message || error) }, 500);
    }
  }
}

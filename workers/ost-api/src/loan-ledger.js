/* ==========================================================================
 * OST · Loan Ledger — OSTG credit lines with fund provenance tracking
 * --------------------------------------------------------------------------
 * A wallet can draw OSTG against a credit line, play or invest with it, and
 * repay. The rule that shapes the entire design is this one:
 *
 *     MONEY WON WITH A LOAN CANNOT REPAY THAT LOAN.
 *
 * Enforcing that needs PROVENANCE, not a balance. A single number cannot tell
 * you where OSTG came from, so this ledger keeps a wallet's play money in
 * separate BUCKETS and never merges them:
 *
 *     clean            the user's own OSTG. Withdrawable. Can repay anything.
 *     tainted[loanId]  drawn from that loan, PLUS everything won with it.
 *                      Not withdrawable. Cannot repay loan <loanId>.
 *
 * Winnings inherit the taint of the stake that produced them - that is the
 * whole mechanism. Stake 100 tainted OSTG, win 250, and all 250 carry the same
 * taint. Otherwise a user draws a loan, wins, repays with the winnings, and
 * has effectively been given free money at the house's expense.
 *
 * A settled loan releases its bucket into `clean` - at that point the money IS
 * theirs and withdrawable, which is what makes repaying worth doing.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO
 *  · It never touches a user's own assets. Only tainted buckets are locked,
 *    and only until the loan behind them is settled.
 *  · It does not auto-select borrowed funds for a bet. The caller states the
 *    bucket. Silently spending borrowed money first is the mechanic that turns
 *    credit into a trap.
 *  · It does not go live on a flag flip. LOANS_LIVE must be "true" AND the
 *    cluster must be mainnet, because lending devnet tokens against real
 *    money would be lending against nothing.
 *
 * DO storage, not KV: the same reasoning as PurchaseLedger. A shed KV write
 * here would lose a debt or duplicate a draw, and the check-then-write races
 * that KV cannot prevent are exactly what a lending ledger must never have.
 * ========================================================================== */

const WALLET_PREFIX = 'w:';
const LOAN_PREFIX   = 'loan:';

// Credit-line policy. Deliberately conservative defaults.
const BASE_LINE_USD   = 100;    // every wallet starts here
const MAX_LINE_USD    = 5000;   // hard ceiling no repayment history can pass
const LINE_MULTIPLIER = 1.5;    // growth per settled loan
const MAX_OPEN_LOANS  = 3;      // concurrent slots per wallet
const APR_BPS         = 1200;   // 12% APR, simple - never compounding

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  });

const round6 = (n) => Math.round((Number(n) || 0) * 1e6) / 1e6;
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

export class LoanLedger {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async wallet(address) {
    const w = await this.state.storage.get(WALLET_PREFIX + address);
    return w || {
      address,
      lineUsd: BASE_LINE_USD,
      settledCount: 0,
      defaultedCount: 0,
      openLoans: [],      // loan ids
      clean: 0,           // own OSTG in the play system
      tainted: {},        // loanId -> OSTG balance derived from that loan
      createdAt: Date.now()
    };
  }

  async putWallet(w) {
    await this.state.storage.put(WALLET_PREFIX + w.address, w);
    return w;
  }

  /* ---- interest --------------------------------------------------------- */

  // Simple interest, never compounding. Compounding on a small balance is how
  // a $100 draw quietly becomes an unpayable number, and there is no honest
  // reason to use it here.
  interestOwed(loan, now = Date.now()) {
    const days = Math.max(0, (now - loan.grantedAt) / 86400000);
    return round6(loan.principalOstg * (APR_BPS / 10000) * (days / 365));
  }

  outstanding(loan, now = Date.now()) {
    return round6(loan.principalOstg + this.interestOwed(loan, now) - loan.repaidOstg);
  }

  /* ---- borrow ----------------------------------------------------------- */

  async borrow(body) {
    const { address, usd, usdPerOstg } = body || {};
    if (!address) return json({ ok: false, error: 'address_required' }, 400);

    const wantUsd = round2(usd);
    if (!(wantUsd > 0)) return json({ ok: false, error: 'invalid_amount' }, 400);
    const rate = Number(usdPerOstg);
    if (!(rate > 0)) return json({ ok: false, error: 'rate_required' }, 400);

    return await this.state.blockConcurrencyWhile(async () => {
      const w = await this.wallet(address);
      const now = Date.now();

      if (w.openLoans.length >= MAX_OPEN_LOANS) {
        return json({ ok: false, error: 'no_free_slots', openLoans: w.openLoans.length, max: MAX_OPEN_LOANS }, 409);
      }

      // Each new draw must be smaller than the last UNSETTLED one, so an
      // unpaid position can never be followed by a bigger one.
      const open = [];
      for (const id of w.openLoans) {
        const l = await this.state.storage.get(LOAN_PREFIX + id);
        if (l) open.push(l);
      }
      if (open.length) {
        const smallestOpen = Math.min(...open.map((l) => l.principalUsd));
        if (wantUsd >= smallestOpen) {
          return json({
            ok: false,
            error: 'must_be_smaller_than_open_loan',
            maxAllowedUsd: round2(Math.max(0, smallestOpen - 0.01)),
            note: 'while a loan is unpaid, each further draw must be smaller than it'
          }, 409);
        }
      }

      const committedUsd = open.reduce((sum, l) => sum + l.principalUsd, 0);
      const availableUsd = round2(w.lineUsd - committedUsd);
      if (wantUsd > availableUsd) {
        return json({ ok: false, error: 'exceeds_credit_line', availableUsd, lineUsd: w.lineUsd }, 409);
      }

      const id = `${address.slice(0, 6)}-${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      const principalOstg = round6(wantUsd / rate);
      const loan = {
        id,
        address,
        principalUsd: wantUsd,
        principalOstg,
        usdPerOstg: rate,
        aprBps: APR_BPS,
        repaidOstg: 0,
        status: 'open',
        grantedAt: now,
        settledAt: null
      };

      await this.state.storage.put(LOAN_PREFIX + id, loan);
      w.openLoans.push(id);
      // The draw lands in its OWN bucket - never added to clean.
      w.tainted[id] = round6((w.tainted[id] || 0) + principalOstg);
      await this.putWallet(w);

      return json({ ok: true, loan, tainted: w.tainted[id], wallet: this.publicWallet(w) });
    });
  }

  /* ---- staking + winnings (provenance) ---------------------------------- */

  /**
   * Move OSTG out of a named bucket to place a bet/trade. The CALLER names the
   * bucket; we never pick borrowed funds on the user's behalf.
   */
  async stake(body) {
    const { address, amount, bucket } = body || {};
    const amt = round6(amount);
    if (!address || !(amt > 0)) return json({ ok: false, error: 'invalid_stake' }, 400);
    const src = bucket || 'clean';

    return await this.state.blockConcurrencyWhile(async () => {
      const w = await this.wallet(address);
      const have = src === 'clean' ? w.clean : (w.tainted[src] || 0);
      if (have < amt) return json({ ok: false, error: 'insufficient_bucket', bucket: src, have: round6(have) }, 409);
      if (src === 'clean') w.clean = round6(w.clean - amt);
      else w.tainted[src] = round6(w.tainted[src] - amt);
      await this.putWallet(w);
      return json({ ok: true, bucket: src, staked: amt, wallet: this.publicWallet(w) });
    });
  }

  /**
   * Return a settled outcome to the SAME bucket the stake came from. This is
   * the line that makes the whole rule work: winnings inherit taint.
   */
  async settle(body) {
    const { address, payout, bucket } = body || {};
    const amt = round6(payout);
    if (!address || amt < 0) return json({ ok: false, error: 'invalid_settle' }, 400);
    const dst = bucket || 'clean';

    return await this.state.blockConcurrencyWhile(async () => {
      const w = await this.wallet(address);
      if (dst === 'clean') w.clean = round6(w.clean + amt);
      else {
        // If the loan is already settled its bucket is gone; those winnings are
        // genuinely the user's, so they land in clean.
        if (!(dst in w.tainted)) w.clean = round6(w.clean + amt);
        else w.tainted[dst] = round6(w.tainted[dst] + amt);
      }
      await this.putWallet(w);
      return json({ ok: true, bucket: dst, credited: amt, wallet: this.publicWallet(w) });
    });
  }

  /* ---- repay ------------------------------------------------------------ */

  async repay(body) {
    const { address, loanId, amount, from } = body || {};
    const amt = round6(amount);
    if (!address || !loanId || !(amt > 0)) return json({ ok: false, error: 'invalid_repayment' }, 400);
    const src = from || 'clean';

    // THE RULE. Money produced by a loan may not retire that loan.
    if (src === loanId) {
      return json({
        ok: false,
        error: 'cannot_repay_loan_with_its_own_funds',
        note: 'winnings carry the taint of the stake that produced them; repay from your own OSTG'
      }, 409);
    }

    return await this.state.blockConcurrencyWhile(async () => {
      const w = await this.wallet(address);
      const loan = await this.state.storage.get(LOAN_PREFIX + loanId);
      if (!loan) return json({ ok: false, error: 'loan_not_found' }, 404);
      if (loan.status !== 'open') return json({ ok: false, error: 'loan_not_open', status: loan.status }, 409);

      const have = src === 'clean' ? w.clean : (w.tainted[src] || 0);
      if (have < amt) return json({ ok: false, error: 'insufficient_bucket', bucket: src, have: round6(have) }, 409);

      const now = Date.now();
      const owed = this.outstanding(loan, now);
      const applied = Math.min(amt, owed);

      if (src === 'clean') w.clean = round6(w.clean - applied);
      else w.tainted[src] = round6(w.tainted[src] - applied);

      loan.repaidOstg = round6(loan.repaidOstg + applied);
      const remaining = this.outstanding(loan, now);

      let released = 0;
      if (remaining <= 0.000001) {
        loan.status = 'settled';
        loan.settledAt = now;
        w.openLoans = w.openLoans.filter((x) => x !== loanId);
        // Settled: the bucket is released and becomes withdrawable. This is the
        // reward for repaying, and the reason the lock is not punitive.
        released = round6(w.tainted[loanId] || 0);
        w.clean = round6(w.clean + released);
        delete w.tainted[loanId];
        w.settledCount += 1;
        w.lineUsd = round2(Math.min(MAX_LINE_USD, w.lineUsd * LINE_MULTIPLIER));
      }

      await this.state.storage.put(LOAN_PREFIX + loanId, loan);
      await this.putWallet(w);

      return json({
        ok: true,
        applied,
        remainingOstg: Math.max(0, remaining),
        status: loan.status,
        releasedToClean: released,
        lineUsd: w.lineUsd,
        wallet: this.publicWallet(w)
      });
    });
  }

  /* ---- views ------------------------------------------------------------ */

  publicWallet(w) {
    const taintedTotal = Object.values(w.tainted).reduce((a, b) => a + b, 0);
    return {
      address: w.address,
      lineUsd: w.lineUsd,
      settledCount: w.settledCount,
      openLoans: w.openLoans.length,
      maxOpenLoans: MAX_OPEN_LOANS,
      clean: round6(w.clean),
      // Split out so a UI can never show one blended number. A user must be
      // able to see at a glance what is theirs and what is locked.
      lockedTotal: round6(taintedTotal),
      locked: Object.fromEntries(Object.entries(w.tainted).map(([k, v]) => [k, round6(v)]))
    };
  }

  async summary(address) {
    const w = await this.wallet(address);
    const now = Date.now();
    const loans = [];
    for (const id of w.openLoans) {
      const l = await this.state.storage.get(LOAN_PREFIX + id);
      if (!l) continue;
      loans.push({
        id: l.id,
        principalUsd: l.principalUsd,
        principalOstg: l.principalOstg,
        repaidOstg: l.repaidOstg,
        interestOstg: this.interestOwed(l, now),
        outstandingOstg: this.outstanding(l, now),
        aprBps: l.aprBps,
        grantedAt: l.grantedAt
      });
    }
    const committed = loans.reduce((s, l) => s + l.principalUsd, 0);
    return {
      ok: true,
      wallet: this.publicWallet(w),
      loans,
      availableUsd: round2(Math.max(0, w.lineUsd - committed)),
      policy: {
        baseLineUsd: BASE_LINE_USD,
        maxLineUsd: MAX_LINE_USD,
        lineMultiplier: LINE_MULTIPLIER,
        maxOpenLoans: MAX_OPEN_LOANS,
        aprBps: APR_BPS,
        interest: 'simple, never compounding'
      }
    };
  }

  async fetch(request) {
    const url = new URL(request.url);
    const op = url.pathname.replace(/^\//, '') || 'summary';
    let body = {};
    if (request.method === 'POST') { try { body = await request.json(); } catch { body = {}; } }

    try {
      switch (op) {
        case 'summary': return json(await this.summary(String(body.address || url.searchParams.get('address') || '')));
        case 'borrow':  return await this.borrow(body);
        case 'stake':   return await this.stake(body);
        case 'settle':  return await this.settle(body);
        case 'repay':   return await this.repay(body);
        case 'health':  return json({ ok: true, hub: 'durable-object', policy: { BASE_LINE_USD, MAX_LINE_USD, LINE_MULTIPLIER, MAX_OPEN_LOANS, APR_BPS }, ts: Date.now() });
        default: return json({ ok: false, error: 'unknown op: ' + op }, 400);
      }
    } catch (error) {
      return json({ ok: false, error: String(error?.message || error) }, 500);
    }
  }
}

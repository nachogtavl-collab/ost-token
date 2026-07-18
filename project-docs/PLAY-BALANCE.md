# OSTG-backed Play Balance — Phase 2 design

Design doc, 2026-07-17. The chosen model (founder-approved) for making the in-app
game economy REAL instead of a forgeable localStorage number. Companion to
TOKEN-ARCHITECTURE.md. This is the spec; build it in the increments at the end.

---

## The problem it solves

Today the game economy is `localStorage['ost.faucet.hub.v2'].credits` — a plain
JSON number any player edits in devtools (see ost-games.js `loadBank`/`saveBank`).
That forgeability is the root of the two-pools bug class and the reason "the token
keeps failing because it's domestic to OST".

Games spend **per action, instantly** (every Plinko drop / Crash tick calls
`debit()`). So the fix cannot be "an on-chain OSTG transfer per spin" — that is
1–2s + gas per drop. And it cannot be "call the worker per spin" — the free tier
caps at ~100k requests/day (see REMODEL.md; we just fought that fire).

## The model: a play balance backed 1:1 by OSTG, authoritative on the server

```
 DEPOSIT   user OSTG ──on-chain──► pool (holds OSTG)   → server credits play balance
 PLAY      client debits/credits a LOCAL MIRROR instantly; server is authoritative
 CASH OUT  server debits play balance → pool ──on-chain──► user OSTG
```

- **Authority:** the per-player `GameSeedHub` Durable Object (rename → `PlayHub`,
  or add a balance to it) holds the authoritative play balance. It already holds
  the commit-reveal seed, which is exactly what lets it VALIDATE play.
- **Backing / the second peg (checkable):**
  `pool OSTG earmarked for play  >=  Σ all players' play balances`
  The margin above equality is house profit. `/health/peg` gets a sibling
  `/health/play` that reports this. If it ever inverts, we credited unbacked play
  balance — say so out loud.
- **No new Solana program.** The pool already holds tokens and signs server-side
  (Phase 0). Deposit = user→pool OSTG transfer (peer-transfer shape, gas-free).
  Cash out = pool→user OSTG payout (payout shape, gas-free). Both need the
  OST-only transfer paths generalised to OSTG (like ata-rent already was).

## Fairness + anti-cheat

### CORRECTION (2026-07-17): the "batched validate" model was CHEATABLE. Discarded.

The original plan (client plays a batch locally, submits `{bets, claimedBalance}`
at settlement, server recomputes) has a hole that only surfaced while building it:

> `/games/digest` returns the HEX for a nonce, and the client computes that bet's
> outcome from the hex LOCALLY. So the client KNOWS the roll before it has to tell
> the server what it bet. If bet params (target, wager, cash-out point) are only
> submitted at settlement, a modified client picks, for each nonce, the params
> that maximise payout for an outcome it already knows. Commit-reveal stops the
> HOUSE cheating; it does nothing against the CLIENT choosing params after the
> roll. For a real-money balance that is a drain.

Batched + reactive play + anti-cheat cannot all three hold: reactive play needs
each digest before choosing the next bet, and anti-cheat needs each bet's params
fixed before its digest is released. Those are the same round-trip.

### The correct model: SERVER-AUTHORITATIVE per bet

`POST /play/bet { wallet, game, params, wager, clientSeed, count? }`:
1. Debit `wager` from the play balance (reject if insufficient).
2. Server assigns the next nonce, computes the outcome from its SECRET seed at
   that nonce (params are now bound to the nonce BEFORE the outcome is known to
   anyone), applies the per-game payout math + house edge SERVER-SIDE.
3. Credit the payout, return `{nonce, outcome, payout, balance}`.
The client never chooses params after seeing a roll, and can't skip the edge.

Request-cap fit: bets are human-initiated (the idle guard killed all passive
polling), so manual play is a call per deliberate bet — fine. AUTO-BET uses fixed
params, so `count > 1` runs N nonces server-side in ONE call (safe precisely
because the params are fixed up front, not reactive). Reactive games (Crash
cash-out) submit the cash-out point as a param of the single bet.

Per-game outcome functions live server-side (this is unavoidable for any
authoritative model). Port them one at a time; `limbo` first (single float:
`rolled = max(1, 99/(100*(1-f)))`, win if `rolled >= target`, payout `wager*target`).

## House bankroll / solvency (also missed originally)

A game WIN raises a play balance with no new OSTG entering the pool. So
`pool OSTG >= Σ play balances` requires the pool to hold a **bankroll** beyond
deposits — the house's risk capital that covers players being collectively up.
The house edge makes it drift to the house over time, but variance means it can
dip. So: fund the pool's OSTG bankroll (bridge OST→OSTG into the pool), and
`/play/bet` must REFUSE a payout that would push `Σ balances` above pool OSTG
(cap max win / refuse when the bankroll can't cover it) — never pay what isn't
backed. `/health/play` already reports this; it must stay solvent by construction.

## Honesty / invariants (do NOT regress these)

- **Never credit play balance that isn't backed by OSTG in the pool.** Deposit is
  verified on-chain BEFORE the balance moves.
- **Never pay a cash-out the session validation didn't confirm.** No fabricated
  win, ever (this is literally the fake-signature bug in a new costume).
- **`/health/play` must report the real numbers or a read failure — never a fake
  "it's fine".** (ost-masking-antipattern.)
- House edge stays in `docs/ost-house.js` semantics (2% of profit), applied
  server-side at settlement so the client can't skip it.

## Migration (Phase 3, hard reset — already approved)

Existing `credits` are UNBACKED. Per the approved decision: they EXPIRE. Everyone
starts fresh, funding a play balance by depositing OSTG (which they get 1:1 from
OST via the bridge). No unbacked play balance is ever minted. Delete
`ost.faucet.hub.v2` + `OST_MONEY` once games read the backed balance.

## Build increments (each shippable + verifiable on its own)

1. **OSTG transfer rails.** Generalise the pool's transfer/payout paths from
   OST-only to `{OST, OSTG}` (allowlisted), like `/wallet/ata-rent` already is.
   Verify: pool can receive and send OSTG gas-free (extend the seedless e2e).
2. **Play ledger + deposit/cash-out.** Add authoritative balance to the player DO;
   `/play/deposit` (verify on-chain OSTG→pool, credit), `/play/cashout` (validate,
   debit, pool→user OSTG). `/health/play` peg. Verify: deposit→balance→cashout
   round-trips real OSTG; the play peg holds; a forged cash-out is rejected.
3. **Session fairness validation.** Batched digests + server recompute at
   settlement. Verify: a tampered `claimedBalance` is rejected; an honest session
   settles; revealed seed hashes match.
4. **Rewire ONE surface** (fair games first — highest volume, clearest) to spend
   the backed play balance instead of `loadBank().credits`. Verify end-to-end.
5. **Rewire the rest** (prediction markets → OSTG on-chain via the betting
   program's mint param; mirror stocks; memecoins). Delete `fundedBy`
   credits|wallet|onchain branching — one funding path.
6. **Phase 3 hard reset**: expire credits, delete the old pool + OST_MONEY.

Do them in order. Each is a real, testable unit; none "big-bangs" the money
surfaces that already caused the fake-signature loss.

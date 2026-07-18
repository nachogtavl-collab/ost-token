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

## Fairness + anti-cheat WITHOUT a server call per spin

This is the crux, and it reuses Phase 0's commit-reveal directly:

1. The DO publishes `serverSeedHash` and holds `serverSeed` secret (already does).
2. Each outcome is deterministic: `HMAC(serverSeed, clientSeed:nonce)` → the
   floats `pfFloats()` already consumes. The client fetches digests in BATCHES
   (e.g. 50 nonces at once), so it plays 50 spins instantly against the local
   mirror with ONE server round-trip, not 50.
3. At settlement/cash-out the client submits the session: `{clientSeed, bets:
   [{nonce, game, wager}], claimedBalance}`. The DO recomputes EVERY outcome from
   its secret seed and the submitted bets, applies the house edge, and checks the
   result equals `claimedBalance`. Mismatch → reject, balance unchanged. A player
   cannot invent a win because outcomes are pinned by a seed they never saw.
4. Then rotate the seed (reveal old, commit new) so the session is auditable.

The local mirror is optimistic UX only; the DO is the truth. This is the same
"optimistic client, authoritative server, never fabricate" discipline as the rest
of the codebase — applied so it survives the request cap.

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

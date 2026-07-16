# OST Token vs OST Currency — the divide, and how to execute it

Design doc, 2026-07-16. Companion to REMODEL.md (which fixes what is broken today).
This one fixes what is *structurally* wrong: two economies wearing one name.

---

## 1. Why this is the right call

The divide already exists. It is just implemented badly, and that is the source of
an entire bug class:

| | Today | Where it lives | Trustworthy? |
|---|---|---|---|
| **Currency** | SPL Token-2022 `383pTzoZ8Gp83dzk23ZnvLcfX2Sq32TAGN48CMQu2pAJ` | Solana devnet | Yes — on-chain |
| **Game economy** | "credits" | `localStorage['ost.faucet.hub.v2']` | **No** — user-editable text |

CLAUDE.md already warns: *"Two OST pools that DO NOT auto-sync… never invent a
third balance store."* That warning exists because the boundary leaks.

**Every money bug found on 2026-07-16 was a boundary leak:**
- Credits paying out an **on-chain** ticket → paid twice, minted unbacked OST.
- A wallet buy that "silently converts to a credits buy" when funding fails → the
  user believes they hold an on-chain position that does not exist.
- Four funding paths (`credits`, `wallet`, `onchain`, pool) for one action, each
  with its own payout logic, each able to fabricate a signature.

You cannot fix this by being careful. Two ledgers that can pay each other's debts
will always drift. **The fix is to make the game economy a real token on Solana**,
exactly as you said — then there is one ledger per economy and one explicit bridge
between them, instead of four ad-hoc paths.

---

## 2. The divide

**OSTC — OST Currency** (the existing mint; mainnet later)
- Real-world use: payments, commerce, transfers, **mesh**.
- Leaves the app. Has external value. This is "the currency of Earth & Space".
- Never directly spendable inside a market or a game.

**OSTG — OST Token** (a NEW Token-2022 mint, 9 decimals)
- In-app only: prediction markets, stock-mirror markets, memecoins, fair games.
- Lives on Solana → verifiable, explorer-visible, un-forgeable, and it inherits
  Solana's infrastructure for free. This is the part that replaces `localStorage`.
- This is what a third-party developer's game accepts, and what makes
  "any developer can launch a game" actually enforceable — their game reads an
  on-chain balance, not our private JSON blob.

**The rule that makes the divide real:** *a market or game accepts OSTG and
nothing else. A payment or mesh transfer moves OSTC and nothing else.* No code
path may substitute one for the other. The fake-signature and credits-pays-
on-chain bugs both become **unrepresentable** — not "fixed", unrepresentable.

---

## 3. The bridge (1:1, and why it must be the only door)

One program. Two instructions. Nothing else may move value between economies.

```
deposit(amount):  user OSTC ──► program vault (escrowed)
                  program mints `amount` OSTG ──► user

withdraw(amount): user OSTG ──► burned
                  program vault releases `amount` OSTC ──► user
```

**Invariant, checkable by anyone at any time:**
`OSTG total supply == OSTC held in the bridge vault`

That is what makes 1:1 true rather than promised. It is not a peg that can slip;
it is an accounting identity enforced by the program. Every OSTG in existence is
backed by an OSTC that cannot move until that OSTG is burned. If the invariant
ever breaks, we minted money — and a public checker will say so out loud.

**Why one door matters:** today there are four ways value crosses the boundary and
each one is a place a bug can print money. With a single mint/burn bridge, there
is exactly one place to audit, and its correctness is a one-line invariant.

---

## 4. Execution plan

Ordered. Each step is shippable and reversible on devnet.

### Phase 0 — Kill the blockers (BEFORE any value crosses)
1. **`docs/swap-pool.js` ships the pool's PRIVATE KEY to every browser.** Fine for
   a devnet toy; fatal the moment OSTG is purchasable. Payouts must move
   server-side or into a program. **This blocks everything below.**
2. **Game RNG is not fair.** `ost-games.js` generates the *server* seed in the
   player's own browser (`pf.serverSeed = randomHex(32)`). A licensed operator is
   held to a HIGHER bar here, not a lower one — client-generated seeds fail any
   gaming audit, and they cut both ways: the house can pick outcomes, and so can a
   modified client. Needs Switchboard VRF (already a repo dependency) or a
   server-side commit-reveal where the commitment is published BEFORE the bet.

### Phase 1 — Mint + bridge
3. Create the OSTG mint (Token-2022, 9 decimals, mint authority = bridge PDA).
4. Write the bridge program (`deposit`/`withdraw` above). The betting program's
   PDA-vault pattern already does exactly this shape — reuse it.
5. Publish an invariant checker: `supply(OSTG) == vault(OSTC)`. Run it in CI and
   expose it at `/health/peg`. If it ever drifts, everything halts.

### Phase 2 — One token per surface
6. Prediction markets, stock-mirror, memecoins, games: **accept OSTG only.**
   Delete `fundedBy: 'credits' | 'wallet' | 'onchain'` — there is one funding
   path now. This is what removes the bug class permanently.
7. Faucet mints **OSTG** (in-app play money), never OSTC. Rewards, game wins, and
   the house edge are all OSTG.
8. Mesh + commerce + payments: **OSTC only.**

### Phase 3 — Migration
9. One-time, idempotent: read each user's `ost.faucet.hub.v2.credits`, mint that
   much OSTG to their wallet, mark migrated on-chain (a PDA per wallet, so it
   cannot run twice — localStorage flags are user-editable and worthless here).
10. Credits are **unbacked** today, so migrating them mints OSTG with no OSTC
    behind it and breaks the peg on day one. Choose deliberately:
    - **(a)** Treasury deposits real OSTC to back the migrated balance, or
    - **(b)** Credits convert at a published ratio (< 1:1) reflecting what they
      actually are, or
    - **(c)** Credits expire; users start fresh in OSTG.
    There is no honest option where unbacked credits silently become backed OSTG.
11. Delete `ost.faucet.hub.v2` and `OST_MONEY`. The third balance store dies here.

### Phase 4 — Mainnet
12. OSTC mainnet mint + Confidential Transfers (Phase 1 of the roadmap).
13. OSTG stays devnet-only or gets its own mainnet mint — **decide explicitly**,
    because OSTG-on-mainnet + games = real-money wagering, which is exactly where
    the Phase-0 RNG work becomes legally load-bearing rather than merely correct.

---

## 5. Answering "1:1 similar ratio"

1:1 is achievable and correct **as an accounting identity** (§3): OSTG is a claim
on escrowed OSTC, and the program enforces it.

The thing to be clear-eyed about: **1:1 redeemability means OSTG carries OSTC's
value.** So OSTG is not "play money that happens to be tracked on Solana" — it is
OSTC with a different label and a narrower spend surface. Everything true of the
currency (value, taxability, gambling exposure when wagered) is true of the token.
The divide is real for *engineering* — one ledger per surface, one auditable door,
no forgeable localStorage — and that is worth doing on its own merits. It is not a
shield that makes the game economy legally distinct from the currency.

If you ever want the token to be genuinely *separate* in that stronger sense, the
lever is redeemability, not naming: one-way (OSTC → OSTG, never back) makes chips.
Two-way at par makes a receipt. Both are legitimate designs — but only one of them
is a different asset.

---

## 6. What this buys you

- **The bug class dies.** No credits-pays-on-chain, no silent downgrade to a
  ghost position, no fabricated signatures — those paths stop existing.
- **Balances become verifiable.** No `catch(() => 0)` inventing zeros from a
  localStorage read; an OSTG balance is an on-chain fact.
- **Third-party games become possible for real.** A developer reads an SPL
  balance and calls a program. They never touch our private JSON, and they cannot
  be broken by our refactors.
- **The peg is checkable by anyone**, which is the only kind of promise worth
  making about money.

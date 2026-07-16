# OST Next-Gen Remodel — the plan

Survey completed 2026-07-16. This is the demolition + rebuild order, and the
reasoning behind it. Work it top to bottom: each step is a prerequisite for the
one below, and doing them out of order will produce fixes that cannot be verified.

---

## The one finding everything else hangs off

OST does not have 135 bugs. It has **one belief implemented 135 times**:

> *Never show the user an error. Always return something that looks like an answer.*

Every major failure found in one day is that belief in a different costume:

| Costume | The lie it tells |
|---|---|
| `cashoutSig = 'local-' + Date.now()` | "Your payout succeeded" — it never ran |
| `recordVaultRetainedLoss()` on failure | "That OST was a normal loss" — we still owe it |
| Credits paying an on-chain ticket | "Here's your money" — minted, unbacked |
| `nativeMarketHubJson` → bare `null` | "Here's the price" — a 5-min-stale colo snapshot |
| `getBalance().catch(() => 0)` | "You have zero" — the RPC hiccuped |

A fallback returning a plausible value converts a **loud, fixable error** into a
**silent, permanent wrong answer**. For money and prices that is not degradation,
it is data corruption with a friendly face. It is also why these survived years of
patches: they never presented as bugs.

`0` is the worst offender — zero is a *legitimate* balance, so nothing downstream
can tell it from truth.

**Rule for all new code:** a function that cannot get the truth must either throw,
return `undefined`, or return the value **flagged** (`{ value, stale: true, reason }`).
It must never fabricate. A UX complaint is never a licence to fake a success —
that is exactly how the fake-signature bug shipped.

---

## Step 1 — Polling rate (DO THIS FIRST; the backend is down *now*)

**Symptom:** `error code: 1027` from ost-api = Cloudflare **daily request limit
exceeded**. Not KV, not CORS — the Workers Free plan's ~100k requests/day.

**Cause:** OST polls `markets/state` several times *per second, per user*. One
user at 3 req/s = ~259k/day = 2.5× the entire account budget alone. ~10 testers
exhaust it in under an hour. Measured: 12 requests still in flight 8s after load.

**Why first:** while the worker refuses requests, *nothing below can be verified* —
every client loses the authority and falls back to stale local state. This is the
"disconnection from our main server" report, and it makes Step 2 look broken even
when Step 2 is correct.

**Do:**
- Push, don't poll. `RealtimeHub` (Durable Object, already deployed) exists for
  exactly this: one WebSocket per client instead of 3 req/s.
- Any remaining poll: seconds not milliseconds, with backoff on failure, and
  **stop polling entirely when the tab is hidden**.
- Consider Workers Paid ($5/mo) — it would end the outages tonight and is cheaper
  than the engineering time to squeeze under the free cap.

**Verify:** `curl https://ost-api.nachogtavl.workers.dev/health/hub` answers at all;
requests/day in the Cloudflare dashboard trends under budget.

---

## Step 2 — The vanishing balances (highest user-visible impact)

**Symptom:** "hard refresh resets the balance in wallet, and faucet balance resets
each reset."

**Cause:** `getBalance().catch(() => 0)` — app.js 3641, 3684, 15260;
devnet-rescue.js 664; ost-appbar.js 55/73/87; ost-balance-tree.js 55. An RPC
hiccup at boot is rendered as a **real zero balance**.

**WE ALREADY MASKED THIS ONCE.** `OST_TREE` + the "on-chain last-known cache" was
layered on top to hide the zeroes rather than remove them. Do not repeat that:
**delete the lie, do not cache over it.** Treat every existing OST "fix" as a
suspect mask until proven otherwise.

**Do:** a balance read that fails returns `undefined` (unknown), never `0`. UI
shows the last known value with a "reconnecting" marker, or a skeleton — never a
confident `0`. Zero must only ever come from the chain actually saying zero.

---

## Step 3 — Recovery of stranded OST (needs real data first)

**Money is safe.** Swap-pool ATA `5b5DBGw1DocFqFaDxukRxEv46kKGXwQQNDRkHBAwAiGK`
holds ~10.01B OST. Failed payouts never paid *out*, so stakes stayed in. This is a
**replay of owed payouts**, not a hunt for lost tokens. Note stakes live in the
SWAP POOL, not the betting program's PDA vault — only `fundedBy:'onchain'` tickets
escrow in the PDA, which is why the vault looked empty.

**Blocked on:** testers running `OST_FORENSIC.run()` (deployed, read-only) and
sending `owedOst` / `phantomOst`.

**The distinction that must never be blurred:**
- **REAL** — buy signature genuine AND confirmed on-chain → stake reached the
  pool, payout was faked → genuinely owed.
- **PHANTOM** — the optimistic wallet buy "silently converts to a credits buy" on
  funding failure, so no stake ever left the wallet → **nothing to recover**.
  Paying these mints OST from nothing.

Recovery must live in its own reviewed file. `ost-audit.js` stays read-only
forever — it is trustworthy *because* it cannot move money.

---

## Step 4 — Audit the remaining ~130 silent catches

Grep:
```
grep -rnE "catch *\([^)]*\) *\{ *return (null|0|false|\{\}|\[\]|'')" --include=*.js docs workers/ost-api/src
```
Triage by blast radius: money > prices/balances > state > cosmetic. A silent catch
on a cosmetic path is fine; on a money path it is a defect by definition.

---

## Step 5 — Mainnet blockers (do not launch with these)

1. **`docs/swap-pool.js` ships the pool wallet's full `secretKey` to every
   browser.** Deliberate for devnet (client pays out with no server; the file says
   "DEVNET ONLY"). With real value it is an instant total loss. Payouts must move
   server-side or on-chain.
2. **Games are not provably fair.** `ost-games.js` generates the *server* seed in
   the player's own browser (`pf.serverSeed = randomHex(32)`). Not provable online;
   offline it is structurally impossible (fairness needs a commitment from someone
   who is not the player). Needs on-chain VRF (Switchboard) before the words
   "provably fair" are used, and offline winnings must stay provisional pending
   server verification or a modified client can mint OST.

---

## Already fixed and shipped (2026-07-16)

- **Update flow** — `respondWith()` on live API polls pinned the active service
  worker forever, so a new worker could NEVER take over a running page: in-session
  updates were structurally impossible. This is why shipped fixes never reached
  testers. Now: SW only handles what it can serve better than the browser;
  `ost-update.js` offers "New version ready · Reload".
- **Fake-signature money loss** — production has 0 fabricated signatures; failed
  payouts stay unpaid, claimable and honest; credits-pays-on-chain removed.
- **`OST_FORENSIC`** read-only audit deployed (NOT `OST_AUDIT` — mainnet-audit.js
  owns that global; squatting it silently no-op'd the whole module).
- **Offline mode** — real detection; `navigator.onLine === false` is authoritative
  (a service-worker cache hit is NOT proof of connectivity).
- **DO fallback honesty** — hub failures now logged + counted; degraded state is
  flagged `degraded: true` instead of masquerading as authoritative; `/health/hub`.
- **Media bridge**, **mobile globe tap**.

---

## Order of operations, one line

**1 (polling/outage) → 2 (balances) → 3 (recovery, needs tester data) →
4 (audit the rest) → 5 (mainnet blockers).**

Steps 1 and 2 are the ones testers feel. Step 3 is the one they are owed.

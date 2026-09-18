# OST Ground-Up Rebuild Plan — 2026-09-18

Founder brief: "fix the whole OSTC and OSTG from the ground up… backend, borrowing, mobile."
Standing constraint (2026-09-17): **the Cloudflare account stays on the free plan by design — users carry the load.**
Baseline: commit `f20e11c` (July 2026 work) + `e92402c` (adaptive round poll). Every phase below is diffed against it.
Evidence: `AUDIT-2026-09-17-maps.json` (8 subsystem maps, every finding with file:line).

## Executive summary

1. A read-only audit of 8 subsystems (worker, money core, borrowing, mobile, predictions, security, masking, mesh) found **177 defects — 22 critical, 47 high**. Each critical claim was made independently by 3–5 readers; I spot-checked ten single-source ones in code and all held.
2. They reduce to **five root causes**, not 177 bugs:
   - **Nothing proves who is calling.** No money mutator checks a wallet signature, and `POST /wallet/payout` pays any client-chosen amount from the OSTC pool to any wallet with no auth at all (`wallet-payouts.js:106-231`).
   - **Prices and rates enter money paths from the client or from fabrications:** the loan rate `usdPerOstg` comes from the request body (`play-ledger.js:182-187`), prediction odds default to `0.5` when no tick is cached (`index.js:3382`), SOL is quoted at a hardcoded `$150` when the feed fails (`solana-pool.js:486`).
   - **Three prediction rails + legacy credits** that still cash out as real OSTC (`faucet-hub.js:944-999`). The settled "OSTG in markets, OSTC in payments" rule is violated in code — this is the "OSTC and OSTG are not divided" symptom.
   - **A polling architecture** that spends the free plan's budget ~40× over: mesh ≈ 7 req/min per open tab, the mobile predict desk ≈ 17 req/min during a round, plus a `/balance/truth` refetch on every bet.
   - **175 silent catches** (up from 135 in July): when something fails the app shows a plausible number instead of the truth ("vault is being refilled" was a fabricated zero, never the vault).
3. **What is sound and must stay:** the Durable-Object ledgers' internal mechanics (PayoutGate's crash-safe state machine, PlayLedger deposit verification + debit-before-send, PredictionLedger's settle-price>0 guard, PurchaseLedger atomicity), `balance-truth.js` (unknown is never zero), the idle guard, the service-worker update flow, mesh TOFU, Stripe HMAC, and both on-chain programs. The rebuild puts **auth in front of** these and **honest inputs into** them; it does not rewrite them.
4. **The architecture** (the founder's directive): the worker becomes a thin authority — custody signing, ledger truth, ONE push WebSocket per session, a thin mailbox. Everything else runs on the user's device (own RPC keys, local compute), over P2P mesh, or on-chain. **Zero polls.**
5. Six phases, each shippable and testable, ~60 working days with one AI engineer pairing with the founder. Phase 0 is the first week.

## Founder-reported symptoms → where each is fixed

| Symptom (2026-09-18) | Root cause in code | Fixed in |
|---|---|---|
| Mobile spams toasts/notifications | `realtime.js:198/204/279` turns every realtime event into a toast, and any WS client can inject wallet/payout events (`realtime.js:345-352`); 102 `toast(` sites in app.js fire on balance/ledger churn | Phase 0 #6 (close injection) + #9 (one notification policy) |
| Prediction graphs won't load | Mobile BTC graph draws only from the tick buffer seeded by `/btc/ticks` + the Pyth stream (`ost-predict-mobile.js:348-432`); when the worker is capped (1027) or the stream is not up, the canvas is blank with no "no data" state | Phase 0 #8 (honest empty state) → Phase 2 (ticks over the push channel) |
| OSTC and OSTG not integrated/divided | Three prediction rails, credits cashing out as OSTC, five balance sources with blending (`ost-total-balance.js:18-38`) | Phase 3 + Phase 4 |
| OSTG borrowing is broken | Client-chosen rate, any loan op callable, no ownership check on repay, unsecured lines that can be farmed (`play-ledger.js:182-286`, `loan-ledger.js:65-96, 243-272`) | Phase 0 #3 (stop the bleeding) → Phase 5 (honest model) |

## Request budget — the math the free plan requires

Cap: ~100,000 worker requests/day for the whole account → **100 requests per user per day at 1,000 daily actives.**

**Today, per active user** (readers' counts + live measurement):

| Source | Requests |
|---|---|
| `/btc/round` poll (prediction-pro) — was 40/min, now 7.5/min after `e92402c` | ~450/hour |
| Mobile predict desk in a round: `loadRound` 6s + trades/position + balance 40s + autoclaim 60s | ~17/min ≈ 1,000/hour |
| app.js predictions: markets 10s, resolutions 20s/30s, wallet sync 30s | ~11/min ≈ 660/hour |
| Mesh open: two 45s announce loops + signal/relay/feed polls | ~7/min ≈ 400/hour |
| Per bet: forced `/balance/truth` (2 worker + 2 RPC) | +2 per bet |
| Stranded deposit sweep | 8 POST/min until it gives up (it never does) |

An active user on the predictions page with mesh open ≈ **2,000–2,700 requests/hour ≈ 2–3% of the daily budget per hour.** The free plan today supports roughly **40 active user-hours per day** — which is exactly why testers keep finding the backend down (1027).

**Target after Phase 2, per active user:** 1 WebSocket connect per session (+ reconnects), 10–20 authoritative writes (bets, claims, faucet), one catch-up GET per reconnect, no polls → **≈ 30–60 requests/user/day → 1,000 DAU ≈ 30–60k/day**, under the cap with headroom. Chain reads (balances, on-chain state) move to the browser's own RPC keys — a separate budget (Helius ×3 + QuickNode) that becomes the next ceiling; Phase 2 addresses it with client-side caching, `accountSubscribe`, and an optional "bring your own RPC key" setting.

## Phase 0 — Stop the bleeding (days 1–3, no new features)

Small, surgical, root-not-mask.
1. **`/wallet/payout` stops being client-callable.** Gate behind `x-ost-internal` today; every pool payout must reference a server-side entitlement (faucet reservation, PlayLedger cashout, PredictionLedger settlement) and take its amount from that record — never from the body. Faucet becomes fully server-side: `FaucetGate.commit` calls PayoutGate internally with the reservation's amount. (`wallet-payouts.js:106-231`, `index.js:3208`; callers `devnet-rescue.js:212`, `app.js:4380`, `faucet-hub.js:987`, `wallet-extras.js:1056,1127`, `mesh-play.js:882`)
2. **Legacy credits stop cashing out as OSTC** (`faucet-hub.js:944-999`) — the approved hard reset's first step.
3. **Loans:** allowlist `/loans/<op>` to `{summary, health, draw, repay}` (today `borrow/stake/settle/void` are client-callable and can erase a lock — `index.js:3353`); server-side `usdPerOstg` via `ostUsd(env)`; repay checks loan ownership and debits exactly the applied amount (`play-ledger.js:271-286`); `refunded` reported honestly (`:288-295`).
4. **Prediction odds refuse instead of fabricating:** delete `let oddsYes = 0.5` + `catch(_){}`; price from the DO snapshot; `503 price_unavailable` (`index.js:3382-3407, 3419-3441`).
5. **No fabricated prices in quotes:** `fetchSolUsd` never returns `150` — refuse the quote (`solana-pool.js:486`). Solvency guards **fail closed** on unknown bankroll exactly as `handleLoanDraw` already does (`play-ledger.js:635-646` and siblings).
6. **Realtime:** WS `publish` frames obey the public-type allowlist (`realtime.js:345-352`); private wallet events excluded from `GET /events` and require a signed subscription (`:250-259, 279-281`).
7. **Mesh:** escape the sender address before `innerHTML` (`mesh.js:1004`) + canonical address regex server-side (`hub.js:48-50`); TOFU fails closed when storage read fails (`hub.js:283-298`).
8. **Honesty on the phone:** delete the faucet's client pool pre-check (`app.js:4362-4368`) and the zero-on-failure in `devnet-rescue.js:118-125`; name the daily cap in the shared fetch wrapper ("OST is over its daily request budget — back at 00:00 UTC"); delete `clientRound()` (`ost-predict-mobile.js:580-614`) and the fabricated `25 OSTG` Max (`:789`); graph canvas shows "no price data yet" instead of blank.
9. **One notification policy:** toasts only for the user's own actions and their outcomes (bet placed, sold, settled, faucet landed, transfer received); realtime informational events go to a quiet activity feed; rate-limit to one toast per event class per 10s. Delete the `LIVE`/`OK` toast on every event (`realtime.js:198-204`).

**Acceptance:** anonymous `POST /wallet/payout` → 403; `POST /loans/void` → 404; predict open with no fresh price → 503; a fresh wallet on a phone claims 100 OSTC or sees the true reason; a 10-minute headless session on the predictions page produces ≤ 2 toasts.

## Phase 1 — One auth primitive (days 4–8)

- ed25519 signature over `{wallet, method, path, sha256(body), ts, nonce}`, verified in the target DO with a replay guard. Client helper `OST_WALLET.signedFetch` (local wallet + Phantom/Solflare `signMessage`).
- Games/1-tap: one signed challenge issues a short-lived session token so bets don't prompt each time (the session-key module already exists).
- Applied to **every** wallet-scoped mutator: `/play/*`, `/play/predict/*`, `/loans/*`, `/wallet/cosign`, `/wallet/ata-rent`, mesh ops (bound to the TOFU key), realtime wallet subscriptions.
- **Acceptance:** any mutator without a signature → 401; replayed request → 409; headless e2e: sign → bet → settle.

## Phase 2 — The push channel, zero polls (days 9–16) — the "users carry the load" core

- `RealtimeHub` is already the one long-lived channel and `NativeMarketHub` already publishes full round snapshots on `price.tick` (`index.js:1876-1896`). Extend it: round rollover, tick history, `prediction.resolved/sold` (from a PredictionLedger alarm at `closeAt+10s`), server-returned balances on every event (no refetch), mesh signals + mailbox + presence + feed deltas over a MeshHub socket.
- **Delete every poll:** `/btc/round` (prediction-pro, predict-mobile, hud), markets/resolutions/wallet-sync in app.js, both mesh announce loops (announce once + on socket open), signal/relay/feed polls; bound the deposit sweep with backoff and a hard stop. One catch-up GET on reconnect.
- Browser reads chain state with its own RPC keys, cached, with `accountSubscribe` where available; `OST_BALANCE` updates from event detail. Optional "bring your own RPC key" setting.
- **Acceptance (measured):** CDP on the predictions page with a round open ≤ 3 worker requests per 5 minutes (today ≈ 175); mesh open and idle ≤ 1 per 5 minutes; 20 simulated users for a day stay under 5% of the cap.

## Phase 3 — One money truth (days 17–24)

- Retire legacy credits (approved hard reset): stop minting them (games, code-academy, parlay, prediction-extras, offline-vault award paths → OSTG play via the server), stop cashing them out, delete the key through the data guards, 7-day banner.
- One renderer: every surface reads `OST_BALANCE` and shows `—` when any component is unknown. Delete `ost-total-balance.js` blending and every remaining fallback-to-0 (`app.js:3641/3684/15260`, `devnet-rescue.js:118-125`, appbar, tree).
- Faucet entirely server-side (reserve → payout → commit inside FaucetGate + PayoutGate). Deposit verification via `getSignatureStatuses(searchTransactionHistory)`.
- **Acceptance:** no file in `docs/` writes `ost.faucet.hub.v2`; the balance shown equals `/balance/truth` in CDP across 5 states including RPC-down.

## Phase 4 — One prediction rail (days 25–36)

- Collapse Rail C (client-settled credits/wallet) entirely; route BTC/ETH/SOL 5-min and OST-native markets through `PredictionLedger`; Rail B (on-chain) stays as an explicit opt-in toggle, never an automatic fallback.
- Server-held positions are the only ticket truth (`GET /play/predict/positions` signed + push events); `OST_PREDICTION_API.sellPosition(id)` used by desk, modal and mobile (no more scraping a hidden desktop button).
- Single close-price truth per round (Coinbase 5m candle, write-once); atomic idempotent resolve/sell (`settlementId`); one shared odds function.
- **Acceptance:** e2e open → sell → resolve on mobile; a replay cannot pay twice; two browsers see the identical close price.

## Phase 5 — Honest borrowing (days 37–44) — needs a decision

Today every loan is an unsecured free option on house capital, lines can be farmed by draw→repay, and debt can be fabricated on any wallet (`loan-ledger.js:65-96, 243-272`). Options: **(a) collateralized only** — draw ≤ 50% of the user's own OSTG, locked as collateral; server liquidation at threshold; interest accrues; due date; line growth gated on tenure — or **(b) remove borrowing until mainnet.** Recommended: (a), small and strict.

## Phase 6 — Mobile as the product (days 45–60)

Viewport-fixed buy bar and buy/sell sheet above the app bar; Markets tab → the mobile surface; lazy-queue flush on in-app navigation; `sw.js` precache generated from `index.html` at deploy; mesh contact core on the client (mailbox, friends, presence over the socket), Facebook-style profile, unified chat HUD (text, calls, video, map, media); accessibility floor (44px targets); and an **anti-masking lint in CI** (the regex set from the audit) that fails a deploy on any new silent-default catch on a money path.

## What is sound and stays (do not touch)

PayoutGate building→sent→confirmed state machine + payoutId memo; PlayLedger on-chain deposit verification and debit-before-send cashout with loan-lock fail-closed; PredictionLedger settle-price>0 guard and share-bounded sell; PurchaseLedger atomicity; settlement.js HMAC + kill switch; `balance-truth.js`; `getNativeMarketState` degraded flags; `x-ost-internal` gates; mesh TOFU; push endpoint allowlist; `ost-idle-guard`; sw.js/ost-update consent flow; `ost-qr-reader`; both Anchor programs (bridge + betting).

## Decisions I need from you

1. **Credits hard-reset date.** Phase 3 ships → localStorage credits stop being cashable. OK to announce with a 7-day notice?
2. **Borrowing:** collateralized-only (recommended) or remove until mainnet?
3. **Prediction rails:** confirm deleting the legacy wallet/credits rail; on-chain stays opt-in.
4. **Load target:** designed for 1,000 daily actives on the free plan. Above that, RPC provider quotas are the next ceiling — OK to add "bring your own RPC key" for power users?
5. **Games currency:** confirm OSTG play is the only game currency and credits award paths in games are deleted (settled decision; confirming the deletion).

## Confidence and gaps

- The `request-burn` reader and the adversarial-verification stage were refused by the account usage limit. In their place: cross-reader agreement (every critical claim was made by ≥3 independent readers), my code spot-check of the 10 single-source criticals (all confirmed), and today's live measurement of the round poll (5 requests/45s vs 30).
- 108 medium/low findings are in the audit JSON and are **unverified**; each is checked before it is fixed, inside the phase it belongs to.

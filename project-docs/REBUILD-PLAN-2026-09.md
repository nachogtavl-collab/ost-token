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

## Progress log

- **2026-09-18 — Phase 0 started; funnel verified working.** Headless iPhone run on prod: first-visit wallet → 100 OSTC claimed in 10s → 10 OSTC→OSTG bridged on-chain (90/10), 0 toasts, 0 errors. Root cause of "faucet doesn't drop": `devnet-rescue.js` pool read returned a fabricated 0 on RPC failure → "vault is being refilled" (pool actually holds 55 SOL / 9.5B OSTC). Fixed at the root (unknown ≠ 0; client pre-check deleted; server is the solvency authority). Cloudflare 1027 now named honestly. Bridge chain reads use the RPC rotation. Toasts deduped at the root (Phase 0 #8, #9). Commits `b7e6197`, and the burn cuts below.
- **Burn cuts (interim, toward Phase 2 — no new polls):** idle phone on the home page measured **135 → 48 worker requests/min**; mesh signal polling + announce only while the mesh is open; launchpad 5s→60s and only when visible; global activity feed 4s→30s and only when visible; native market state 3s→15s; markets list 10s→60s; live-stats 15s→120s; BTC round poll 1.5s→adaptive 8s (`e92402c`). QuickNode endpoint was found dead (TLS internal error) and removed from rotation — 3 Helius keys remain until a new provider key is added.
- **Still open from the funnel run:** `/positions/recent` ~9/min from the predict desk (predict-mobile 13s trades poll) and `sw.js` precache listing stale versions — both land in Phase 2 / Phase 6.
- **2026-09-18 (later) — Phase 0 #1/#2 shipped.** Faucet is paid SERVER-SIDE: `FaucetGate.commit` pays the reservation's amount through PayoutGate (idempotent `faucet-<reservationId>`), with the on-chain payout done OUTSIDE the global DO lock (lock → mark paying → pay → lock → finalize). `/wallet/payout` now has an origin gate: server-originated payouts carry `x-ost-internal`; client faucet payouts are refused (403 verified live); credits cash-out is refused from **2026-09-25** (7-day notice shown in faucet-hub); remaining client-asserted kinds (legacy prediction claims, memecoin sells, fair-game cash-outs) are rate-limited and capped (2,000 OST/wallet/24h; 100,000 OST global/24h) until Phase 1 auth + Phase 4 rail collapse delete them. Also shipped: loans allowlist + server rate + repay ownership/exact debit; odds refuse instead of 0.5; no fabricated SOL price; bankroll fail-closed; WS publish allowlist; mesh TOFU fail-closed + strict address + XSS escape. Phone funnel re-verified after every step (claim 6s, bridge 90/10, 0 toasts, ~100 requests/run vs 451).
- **2026-09-18 — Phase 1 SHIPPED and ENFORCED.** One wallet-signature primitive (`workers/ost-api/src/wallet-auth.js` + router guard; client `docs/ost-auth.js`): ed25519 over `OST-AUTH|v1|wallet|METHOD|path|sha256(body)|ts|nonce`, 5-min window, replay-nonce in PlayLedger, body wallet must match; extension wallets sign one challenge → 12h session token (`POST /auth/session`). Protected: `/play/*`, `/play/predict/*`, `/loans/*`, `/faucet/v1/*`, `/wallet/{payout,cosign,ata-rent}`. `WALLET_AUTH_MODE=enforce` in wrangler.toml (set to `log` to observe-only). Verified on prod: unsigned money POSTs → 401; signed phone funnel passes (`ok:sig`). Lessons: custom headers need `Access-Control-Allow-Headers` in EVERY CORS block (a missing entry made the browser drop signed requests silently); never re-send a failed signed request unsigned; never re-assert a fetch wrapper after other wrappers captured it (fetch cycle → page hang). **Untested: extension-wallet (Phantom/Solflare) session flow — needs one manual test; revert is the one var.**
- **2026-09-18 — Phase 2 increment 1 (push-first).** The realtime WebSocket already carries the full round snapshot (`ost:btc-round`); prediction-pro, predict-mobile and the HUD now consume it through the same code path as a `/btc/round` response and poll ONLY when the push is stale (>20s) — `/btc/round` disappeared from the idle profile entirely. `ost-balance` updates the play place from the `ost:play:balance` event's server-returned balance instead of refetching `/balance/truth` per bet. The fabricated `clientRound()` fallback on the phone is gone (last real round while still open, else "round unavailable" + Buy disabled). Idle phone: **54 worker req/min** (was 135). Remaining idle: `/positions/recent` ~9, `/ost/price` 5, `/markets` 3, `markets/state` 3, `/topup/config` 3. Next increments: server ticks from a NativeMarketHub alarm (today `price.tick` is published only when a snapshot is requested), positions/resolutions + mesh over the socket, then delete the rest.
- **2026-09-18 — Phase 2 increment 2 (server-driven ticks).** `RealtimeHub` pings `NativeMarketHub` `/hub/demand` (throttled ~60s) on socket connect and on every client heartbeat; `NativeMarketHub.alarm()` publishes a fresh snapshot every 5s while demand is <90s old, then stops itself. Verified on prod: **13 round snapshots + 153 ticks pushed per minute, 0 `/btc/round` requests.** Cost is O(1) for all connected users. Idle phone still 54 req/min from the remaining pollers (`/positions/recent` 9, `/ost/price` 5, `markets/state` 4, `/markets` 3, `/topup/config` 3) — next increments delete those via positions/resolutions push + mesh push.
- **2026-09-18 — Phase 2 increment 3 (server-side resolution + push) VERIFIED with real money.** `PredictionLedger` schedules an alarm at `closeAt+10s` on every open, groups open positions per round, takes the close price from `getBtcRoundResult` (DO snapshot → Coinbase 5m candle fallback), resolves each position with the existing idempotent `resolve()`, and pushes `prediction.resolved` (per-wallet channels + market channel); `open()` pushes `prediction.fill`. Clients patch tickets from the push (app.js), refresh trades/activity on fills (mobile, activity feed), and poll only when no push has arrived for 60s. E2E on prod: wallet → 100 OSTC → bridge 10 → deposit 5 OSTG → open 2 OSTG YES (signed, server odds) → `prediction.fill` pushed → round closed → alarm resolved → `prediction.resolved` pushed (lost, payout 0) → play 5→3. Fixes the audit finding that resolution depended on a client being present at close.
- **2026-09-18 — Phase 2 increment 4 (burn sweep).** Remaining pollers made push-first or slowed to their true change rate: recent-activity feed 7s→event-driven (60s fallback), OST price 10s→60s, native market state 15s→60s, dashboard relay/scalar 30s/60s→5min (visible only), top-up config 30s→10min, markets list 60s→5min, stock quotes only when on screen. Idle phone in a 60s window incl. page boot: **37 worker req/min (was 135)**; `/btc/round` and `/positions/recent` are gone from the profile.
- **2026-09-18 — steady-state measurement after Phase 2.1–2.4.** Headless phone, 3-minute window: page boot = 35 requests (one-time), then **11.5 worker req/min steady** (was ~135) while the socket pushed 37 round snapshots + 450 ticks. Remaining steady pollers: `OST_PREDICTION_API.markets()` → `/markets` + `/gamma/markets` every 30s (prediction-pro.js:1731/1736, ~4/min — cache 5 min next), `markets/state` 60s, `/ost/price` 60s, `/launchpad/coins` 60s. Against the 100 req/user/day budget this is still too chatty for long idle sessions; next: cache the markets list, push OST price + market state over the socket, then mesh over the socket.

### 2026-09-18 — UX pass 2: real graphs, trade speed, main thread

- **Real graph (mobile, Polymarket markets):** `drawStd()` now plots the real 7-day price series fetched browser-direct from `clob.polymarket.com/prices-history` (worker relay only as CORS fallback, 2-min cache), live mid appended as the tail. Verified headless: 200 from the CLOB, canvas painted. Markets with no history show "no price history for this market yet" — no invented line.
- **NOT done — Kalshi graphs:** 158 of ~320 markets are Kalshi. Their API is CORS-blocked and needs the series ticker, so it needs a cached worker relay. Still shows the honest empty state.
- **Sell is instant:** native sell closes the sheet at tap and shows "Selling…"; failure restores the position and says why.
- **Server trade path:** the 3 pricing reads in `/play/predict/open` and `/cashout` run in parallel (was sequential). Signed round-trip measured 700ms -> 643ms; the rest is the auth-nonce DO hop + PredictionLedger -> PlayLedger hops (Phase 4).
- **Main thread @4x CPU throttle:** 26% -> 18% busy (88% before pass 1). Cached `Intl.NumberFormat` in the live desk (toLocaleString was building a formatter 60x/s), skip unchanged DOM writes, price-signature memo on `getMarketOutcomeContracts`, popout observer 250ms -> 1500ms. Top remaining cost is the live graph's own `draw()`.
- **Known:** non-BTC buys on mobile still drive the desktop modal by DOM clicks (`prediction-pro.js placeBet`) — slow by construction; fixed by Phase 4 "one prediction rail".

### 2026-09-18 — HUD + hero pass (phone, verified by headless screenshots)

- **Header HUD:** 4 controls were squeezed into 168px — total-OST badge collapsed to 32px (amount clipped), "Ancient" truncated, hamburger pushed off-screen. On phones the badge is hidden (the bottom bar's Wallet tab is the balance HUD), Ancient is icon-only, hamburger is back.
- **Markets tab did nothing:** it scrolled to `#predictionMarketBoard`, which is hidden on phones. `scrollToFirst` now skips hidden targets; Markets targets `#ostPredictMobile` and calls `showBrowse()`.
- **"OST value" tile had 3 writers** (app.js "100 OST", ost-token-section chart oracle "$0.12", ost-live-stats "$0.01") and flipped between them. One owner now: ost-live-stats (canonical conversion price), shown as "$1.18 per 100 OST" because a 2-decimal format rounded $0.0118 to $0.01. `data-ost-fx-off` opt-out added to ost-fx so fiat figures are not re-hinted.
- **BTC hero graph:** (a) "1H/3H/6H/12H" were fake — they sliced 33xN live ticks (12H = ~2.5 min). Now LIVE + real 1H/6H/12H from Binance public 1-min klines, browser-direct, labelled. (b) LIVE plotted by tick index and dropped the server's round ticks whenever 8 live ticks had arrived (always) -> flat line; now time-based and merged with the server's round ticks from round open. (c) **Two feeds were mixed** in `ost:btc-spot` (server Coinbase = settlement feed, browser Pyth ~$60 away) -> sawtooth, and the hero could show "winning" against the settlement price. Round view now follows the settlement feed only; browser feed is a labelled fallback after 20s of server silence. (d) min vertical span 0.02% so cents are not drawn as cliffs.
- Predictions header chips no longer wrap mid-word ("Tick/ets", "OST/G").
- **Still open:** the same two-feed mixing likely affects the desktop hero / `ost-predict-hud.js` (not audited this pass); Kalshi history relay; wallet tab lands on marketing copy rather than the user's balances (Phase 6).

### 2026-09-18 — Stale market data: settlement-first cards, Kalshi live relay, KV write leak

- **BTC card odds were priced off the wrong feed:** `buildFiveMinBtcMarket` trusted the server price only under 2.5s old, but the server pushes every ~5s, so the browser's Pyth/exchange feed always won. Now settlement-first (server price if <20s old), local feed is backup.
- **Kalshi (158 of ~320 markets) was a frozen deploy-time snapshot** and direct `wrangler pages deploy` skipped the refresh. Rule: deploy the site with `npm run deploy:site` (runs the snapshot script first). Kalshi 403s browsers, so new worker route `GET /kalshi/market?ticker=`: live quote (edge cache 120s, 24h stale copy) + 7d history from REAL trade prints (cache 30 min). Called once per market OPEN, never polled. Phone desk reprices to the live quote and labels it. Kalshi 429s Cloudflare's shared IPs ~half the time (candlestick endpoint: always, so not used) -> 3 spaced tries on the worker, one 5s retry on the client, then an honest "price is from the site snapshot and may be old". Card LIST prices for Kalshi are still snapshot-age.
- **KV write leak:** `/markets` and `/markets/:id` did a `kvPut` on every call (free plan = 1,000 writes/day). Now at most once per 10 min per key per isolate, TTL 1h.

# Prediction markets fully on Solana — Switchboard for arbitrary events

Design doc, 2026-07-18. Founder direction: **the whole prediction market (Binance/
Pyth ticks, Polymarket data, share prices, probability, resolution) should live
inside the Solana network** — to maximize OST's on-chain infrastructure and stop
exhausting Cloudflare KV. Chosen event-resolution layer: **Switchboard** (Solana's
general-purpose oracle), because Pyth is a *price* oracle only and cannot resolve
"did event X happen".

This is a multi-increment initiative. This doc is the spec; build it in the stages
at the end. Nothing here ships until its stage is built AND proven on devnet.

---

## What already lives on Solana (verified 2026-07-18 — do NOT rebuild)

- **Price ticks** — `docs/ost-pyth.js` reads BTC/ETH/SOL from **Pyth Hermes**
  (Solana's oracle) client-side. Zero OST KV. (`OST_PYTH.get('BTC'|'ETH'|'SOL')`.)
- **Probability / odds** — `docs/ost-onchain-market.js` reads the **on-chain market
  account pools**; pari-mutuel, so the pool ratio IS the on-chain price. Zero KV.
- **Betting + escrow + resolution (price markets)** — the deployed `ost-betting`
  program (`F82m45QUAFJ4GtMsJrSFnWzDrjWdZjdzyh8HTPgTBHXr`), mint-agnostic, escrows
  **OSTG**, settles trustlessly via `resolve_with_pyth`. Proven: `predict-ostg-e2e`.
- **Stocks** — server fetches price via Cloudflare **edge cache** (not KV). Can move
  to Pyth equity feeds on-chain (stage 5).

**The only real gap:** arbitrary-event (Polymarket-style) markets — elections,
sports, "will X happen". Pyth can't resolve them. That is what Switchboard is for.

## KV drains to remove (the "without exhausting KV" goal)

Worker hot KV keys (see `index.js` KV_HOT_RE): `btc:latest`, `btc:ticks:`,
`launchpad:ticks:`, and the Polymarket odds relay. Target end state: clients read
**Pyth (ticks) + on-chain market accounts (pools/probability) + Switchboard
(event odds/resolution)** directly, so the worker is out of the market data plane.

---

## On-chain event markets — architecture

An event market is the SAME pari-mutuel shape as the price markets (OSTG escrow,
`yes_pool`/`no_pool` on-chain = probability, on-chain claim with the 2%-of-profit
edge), differing only in **how it resolves**:

- Price market → `resolve_with_pyth` (close vs open price).
- Event market → `resolve_with_switchboard` (reads a Switchboard feed's attested
  outcome: 1 = YES occurred, 0 = NO).

So betting, escrow, pools/probability, payout, and the edge are UNCHANGED and
already on-chain. Only the resolve instruction + the data feed are new.

### Program change (ost-betting) — the blocking foundation

Add to `programs/ost-betting`:

1. `Cargo.toml`: `switchboard-on-demand = "0.x"` (the On-Demand pull-feed SDK).
2. `Market`: reuse `feed_id: [u8;32]` to instead hold the **Switchboard feed
   pubkey bytes** for event markets, plus a `market_kind: u8` (0 = price/Pyth,
   1 = event/Switchboard) so `claim`/`resolve` pick the right path. (New field →
   the account layout grows; `init` new markets, leave old ones on the legacy path.)
3. `initialize_event_market(market_id, lock_ts, resolve_ts, sb_feed: Pubkey)` —
   like `initialize_market` but `market_kind = 1`, stores the Switchboard feed
   pubkey; NO `lock_open_price` (events have no open price).
4. `resolve_with_switchboard(ctx)` — PERMISSIONLESS + trustless, mirrors
   `resolve_with_pyth`:
   ```rust
   pub fn resolve_with_switchboard(ctx: Context<UseSwitchboard>) -> Result<()> {
       let clock = Clock::get()?;
       let market = &mut ctx.accounts.market;
       require!(!market.resolved, BettingError::MarketAlreadyResolved);
       require!(market.market_kind == 1, BettingError::WrongMarketKind);
       require!(clock.unix_timestamp >= market.resolve_ts, BettingError::ResolveTooEarly);
       // The feed account MUST be the one pinned at market creation — a caller
       // cannot swap in a feed that says what they want.
       require_keys_eq!(ctx.accounts.feed.key(), market.switchboard_feed(), BettingError::StaleOrWrongFeed);
       let feed = PullFeedAccountData::parse(ctx.accounts.feed.data.borrow())
           .map_err(|_| error!(BettingError::StaleOrWrongFeed))?;
       let value = feed.value(&clock).ok_or(error!(BettingError::StaleOrWrongFeed))?; // Decimal
       // Convention: feed resolves to 1.0 (YES) or 0.0 (NO). Guard staleness via
       // max_staleness in the feed config + a require! on the feed's last update slot.
       market.winning_side = if value >= Decimal::from(1) { 1 } else { 0 };
       market.resolved = true;
       Ok(())
   }
   ```
   `UseSwitchboard` ctx: `market` (mut), `feed: AccountInfo` (the Switchboard
   PullFeed account). No signer needed (permissionless, like the Pyth path).

Deploy via the fragile Windows recipe in CLAUDE.md (copy platform-tools to
`C:\sol-pt`, `cargo +solana build --release --target sbpf-solana-solana`, paced
`upload-buffer.mjs`, then `solana program deploy --buffer`). **This is the single
riskiest step — it is a program UPGRADE of a live money program.** Test on a
throwaway program-id first (like bridge-e2e uses a throwaway mint).

### Switchboard feed (the data source)

A Switchboard **On-Demand pull feed** whose job fetches the event's resolution and
outputs 1/0. For Polymarket-mirrored events the job hits Polymarket's public
resolution endpoint (the market's `resolved`/`winningOutcome`); for generic events,
any HTTPS+JSONPath job. The feed is created + funded once per event; the crank
(or anyone) posts the update the program reads. Odds DISPLAY for open events can
also come from a Switchboard feed of the Polymarket midpoint price, so the whole
data plane is on Solana, not the KV relay.

### Crank + client

- Crank: `initialize_event_market` per event, bound to its Switchboard feed;
  `resolve_with_switchboard` after `resolve_ts`. (`scripts/pyth-crank/crank.mjs`
  already opens/locks/resolves price markets — add the event path.)
- Client: `docs/ost-onchain-market.js` gains event-market create/read (pools =
  probability), and `ost-onchain-route.js` routes event markets on-chain. The
  Polymarket mirror UI reads odds from the Switchboard feed / on-chain pools, not
  the worker relay → removes that KV load.

## Stages (each shippable + proven on devnet before the next)

1. **Program**: add `switchboard-on-demand`, `market_kind`, `initialize_event_market`,
   `resolve_with_switchboard`. Build + deploy to a THROWAWAY program-id; prove a
   full event lifecycle (create → bet OSTG → Switchboard resolve → claim) with a
   test feed. Only then upgrade the live program-id.
2. **Switchboard feed**: stand up one On-Demand feed on devnet that resolves a real
   sample event to 1/0; prove the program reads it.
3. **Crank**: open + resolve event markets against feeds.
4. **Client**: event-market UI reads pools (probability) + Switchboard (odds/
   resolution) — no worker/KV. Route event bets on-chain (OSTG).
5. **Price-data KV removal**: point every remaining tick consumer at Pyth/on-chain,
   retire `btc:ticks`/`btc:latest` KV relays; optionally move stocks to Pyth equity
   feeds + on-chain resolution.
6. Delete the last `fundedBy` credits|wallet branches once all markets are on-chain.

## Risks / open items

- **Live program upgrade** of a money program via the fragile Windows build — do it
  on a throwaway id first; have a rollback plan.
- **Switchboard devnet** queue availability + feed funding/cranking cadence.
- **Feed trust**: a single-source job (Polymarket) is only as trustworthy as that
  source; multi-source jobs / a dispute window are the hardening path.
- Account-layout growth (`market_kind`) — new markets only; never reinterpret old
  market accounts.

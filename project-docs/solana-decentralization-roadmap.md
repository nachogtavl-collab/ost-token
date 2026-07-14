# OST → Fully on Solana: the honest roadmap

Goal: the entire user journey — buy/sell, games, wins/losses, predictions,
faucet — runs on Solana rails, with a decentralized frontend. This doc is the
truthful map from where the app IS to that goal, in shippable stages. No stage
claims more than it delivers.

## Where OST actually is today (audited 2026-07-13)

| Layer | Today | Decentralized? |
|---|---|---|
| Token | SPL Token-2022 on devnet, real transfers | ✅ on-chain |
| Bets / faucet / vault money movement | real SPL transfers to/from pool accounts | ✅ on-chain (custodial pool) |
| Prediction odds + settlement logic | client JS + Cloudflare Worker (BTC hub) | ❌ centralized |
| Games (Plinko/Crash/…) RNG + payouts | client JS + credits pool | ❌ centralized |
| Prices | exchange APIs (+ Pyth oracle as of Stage 1) | ⚠️ mixed |
| Frontend hosting | Cloudflare Pages | ❌ centralized |
| Backend (rounds, faucet gate, relay, realtime) | Cloudflare Workers + DO + KV/D1 | ❌ centralized |

**Already written but not deployed:** `programs/ost-betting` implements the full
on-chain market lifecycle — `initialize_market`, `place_bet`, `resolve_market`,
`claim_payout`. This is the single biggest unlock and it already exists in the
repo. `programs/ost-token` additionally has staking, voting, and confidential-
transfer instructions.

## Stage 1 — Solana-ecosystem data + decentralized frontend (SHIPPED)

- **Pyth oracle prices** (`docs/ost-pyth.js`): BTC/ETH/SOL prices now come from
  the Pyth Network — Solana's native oracle — with exchange APIs demoted to
  fallbacks. Honest detail: the legacy Pyth *push* accounts on devnet are
  deprecated (verified stale on-chain: BTC $59.5k/status=0 vs $62.8k real), so
  we consume Hermes, Pyth's signed-update distribution layer — the same data
  path a real dApp uses before posting updates on-chain.
- **IPFS frontend** (`scripts/deploy-ipfs.mjs`): pins `docs/` to IPFS →
  immutable CID served by any public gateway, no single host. Needs a free
  Pinata key (PINATA_JWT). Optional: point a `.sol` name (Solana Name Service)
  at the CID.
- Limits stated plainly: the IPFS build still calls the Cloudflare worker API;
  game RNG and settlement are still off-chain in this stage.

## Stage 2 — On-chain prediction markets — ✅ PROGRAM LIVE ON DEVNET

**Deployed:** `F82m45QUAFJ4GtMsJrSFnWzDrjWdZjdzyh8HTPgTBHXr`

Root fix before deploying: the program escrowed **native SOL**, but OST markets
stake **OST (Token-2022)** — deploying that would have been decentralization
theater (an "on-chain market" where the OST never moves on-chain). Rewritten to
escrow the real token via `token_interface::transfer_checked` into a
program-owned vault whose authority is the market PDA.

Proven end-to-end on devnet (`node scripts/onchain-market-e2e.mjs`, asserts on
real token balances, exits non-zero on mismatch):

| Step | Result |
|---|---|
| `initialize_market` | market PDA + program-owned OST vault created |
| `place_bet` ×2 | A: 20 OST YES, B: 10 OST NO → **vault really holds 30 OST**; pools YES=20 NO=10 |
| `resolve_market` | YES |
| `claim_payout` | A receives **30 OST back out of the vault**; vault → 0 |

Economics: pari-mutuel (`stake * total_pool / winner_pool`) — odds emerge from
the pools, so **settlement needs no oracle price**.

### Stage 2 — ✅ COMPLETE, AND TRUSTLESS

**The authority can no longer choose an outcome — the instruction that let it do
so was DELETED.** `resolve_market(winning_side)` is gone from the program. It is
not deprecated or gated; it does not exist. Two permissionless instructions
replace it (anyone may call them):

- `lock_open_price` — the program verifies a signed **Pyth** update and stores
  the round's OPEN price.
- `resolve_with_pyth` — the program verifies a fresh update, reads the CLOSE
  price and **decides the winner itself** (`close >= open => YES`).

In-program guards: the update must belong to the market's own `feed_id`, be
≤120s old (never settle on a stale price), and its exponent must match the
locked open price (refuse to compare mismatched scales rather than silently
settle on the wrong number). `feed_id`, `open_price`, `open_expo` and
`close_price` are stored on the market, so every settlement is auditable
on-chain forever.

**Proven end-to-end with real OST** (`scripts/pyth-crank/lifecycle-e2e.mjs`):

| Step | Result |
|---|---|
| `lock_open_price` | program read open **$62,708.87** from Pyth |
| `place_bet` ×2 | A: 20 OST YES, B: 10 OST NO → **vault holds 30 OST** |
| `resolve_with_pyth` | close **$62,691.12** → resolved **NO (down)** — the price fell, so the side the test could not predict won |
| `claim_payout` | winner staked 10, **received the whole 30 OST pool**; loser got nothing and cannot claim twice; **vault drained to 0** |

**Frontend:** `docs/ost-onchain-market.js` stakes real OST from the browser into
the program vault (proven: vault 0→5 OST, user 25→20 OST), and reads the odds
from the on-chain pools.

### Honest gaps that remain
- The **house edge and arbitrage spread are still off-chain**. On-chain
  economics are pure pari-mutuel — the program takes no rake.
- The crank is a **convenience, not an authority**: it signs transactions but
  cannot pick outcomes. If it vanishes, anyone can call the same instructions.
- The **desk still routes most bets through the off-chain path**. The on-chain
  rail is shipped and proven; making it the default is a product decision.
- Markets created **before** the Pyth upgrade use the old layout and can never
  be settled (authority-resolve is gone). Only test markets were affected — no
  user funds were ever in them.

## Stage 3 — Verifiable games

- RNG via **Switchboard VRF** (devnet) or commit-reveal against a future Solana
  blockhash. Each game round becomes: stake tx → VRF request → payout tx, all
  auditable. Start with one game (Limbo — single number, no physics), then port
  the rest. Plinko's ball paths stay client animation; the *outcome* is the
  on-chain verifiable part.

## Stage 4 — Shrink the backend to cranks

- BTC 5-min rounds: round open/close prices become Pyth-verified on-chain
  states; the worker's NativeMarketHub degrades to a mere crank/cache anyone
  can run.
- Faucet gate: replace the DO with an on-chain per-wallet PDA cooldown (the
  `FaucetClaim` account in ost-token already points this way).
- Credits pool: converts to real OST via the vault today; long-term, games pay
  from program vaults directly and the off-chain credits pool shrinks to a
  UX cache.

## What can NEVER honestly be claimed

- "The website runs on Solana" — no chain hosts websites. The honest claim is
  "frontend on IPFS/Arweave + all *logic and money* on Solana".
- Zero-latency on-chain games — devnet confirms in ~0.4–1s; game UX keeps
  optimistic animation with on-chain settlement.
- Decentralization of the Binance/Coinbase price fallbacks — only the oracle
  path (Pyth) is Solana-ecosystem; fallbacks exist so an oracle outage cannot
  freeze the app.

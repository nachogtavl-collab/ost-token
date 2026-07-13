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

## Stage 2 — On-chain prediction markets (the big one; program EXISTS)

1. `anchor build && anchor deploy` `ost-betting` to devnet.
2. Wire `placeOrder` for OST-native 5-min rounds to `place_bet` (funds move
   into the program vault PDA, not the custodial pool).
3. Settlement: a crank (initially the worker, later anyone) calls
   `resolve_market`; extend the program to verify a **Pyth price update**
   on-chain so the winning side is proven by oracle data, not trusted.
4. `claim_payout` replaces the client-side claim path for these markets.

Effort: days, not hours. Risk: program upgrade/authority management, compute
budget for Pyth verification. Payoff: bets/odds/settlement/claims all on-chain.

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

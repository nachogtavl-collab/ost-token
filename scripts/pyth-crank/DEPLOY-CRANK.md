# Persistent OST market crank

The crank pushes the on-chain BTC 5-min markets forward every minute:
`initialize_market` → `lock_open_price` → `resolve_with_pyth`. Lock/resolve are
**permissionless** (the program decides the winner from Pyth; there is no
authority-resolve). Only opening needs the crank key.

## Why it must be a Node host (not "Solana infrastructure" or a Worker)

- **On-chain automation is not available.** Clockwork (the Solana thread
  scheduler) is defunct, so nothing on-chain can self-trigger the crank.
- **Cloudflare Workers can't do it.** `lock/resolve` post a Pyth *pull-oracle*
  price update, which needs `@pythnetwork/pyth-solana-receiver` + `jito-ts` —
  Node-only deps that don't run in the Workers runtime.
- So the crank runs in **Node**, talking directly to a Solana RPC + Pyth Hermes.

## KV-proof by design

The crank uses **zero Cloudflare KV** — only Solana RPC + Pyth over HTTPS. If the
OST worker's KV is exhausted, on-chain rounds keep opening/locking/resolving and
the app still reads them directly via `OST_ONCHAIN` (also KV-free). The OST page
is never in the loop.

## Run modes

### 1. Local persistent (already set up on this machine)
A Windows Scheduled Task **`OST-Crank`** runs `ost-crank-run.cmd` (one-shot
`node crank.mjs`) every minute. Survives reboots while the machine is on + the
user is logged in. Log: `%TEMP%\ost-crank.log`.
- Remove: `schtasks /Delete /TN OST-Crank /F`
- This is an **interim** — it only runs while this machine is on.

### 2. Cloud 24/7 (recommended for real users)
Deploy the Dockerfile here as an always-on worker on Render / Railway / Fly.io /
any VPS, with:
- `OST_CRANK_KEY` = base64 (or JSON array) of the crank authority secret
- `OST_RPC` = a **dedicated** devnet RPC (Helius/QuickNode/Triton) — the public
  `api.devnet.solana.com` 429-throttles and will starve the crank.

`docker build -t ost-crank scripts/pyth-crank && docker run -e OST_CRANK_KEY=… -e OST_RPC=… ost-crank`

The container runs `crank.mjs --watch` (self-healing: transient RPC/Pyth errors
are swallowed, the loop never dies).

## The one dependency that still matters everywhere: a dedicated RPC

Both the crank and the app read Solana over RPC. On the public devnet endpoint,
reads 429 under any load (which is what makes markets/auto-arm look flaky). Point
`OST_RPC` (crank) and the app's connection at a dedicated devnet RPC to fix it.

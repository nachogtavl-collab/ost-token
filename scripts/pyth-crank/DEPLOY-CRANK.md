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

## Exact cloud steps (nothing runs on your PC)

### Step 0 — make the crank key (run once, locally; do NOT paste the key anywhere public)
```
node -e "const fs=require('fs');const s=JSON.parse(fs.readFileSync(process.env.USERPROFILE+'/.config/solana/id.json'));process.stdout.write(Buffer.from(Uint8Array.from(s)).toString('base64'))"
```
Copy the single line it prints — that's `OST_CRANK_KEY`. (It's the market-opening
key; it CANNOT choose outcomes, but still treat it as a secret.)

### Option A — Fly.io (recommended: tiny always-on, ~free)
```
# one-time: install flyctl + `fly auth login`
cd scripts/pyth-crank
fly launch --no-deploy --copy-config --name ost-crank
fly secrets set OST_CRANK_KEY="<paste base64>" OST_RPC="<dedicated devnet rpc>"
fly deploy
fly logs            # watch it open/lock/resolve every minute
```
`fly.toml` here keeps exactly one 256 MB worker alive (no ports). Redeploy with
`fly deploy`; pause with `fly scale count 0`.

### Option B — Render (Blueprint; background worker is ~$7/mo)
1. Push this repo to GitHub (already the backup remote).
2. Render → **New → Blueprint** → pick the repo → it reads `scripts/pyth-crank/render.yaml`.
3. In the service's **Environment**, set `OST_CRANK_KEY` (base64) and `OST_RPC`.
4. **Deploy**. Logs show the crank each minute.

### Option C — Railway (usage-based, a few $/mo)
1. Railway → **New Project → Deploy from GitHub repo**.
2. Service **Settings → Root Directory** = `scripts/pyth-crank` (it builds the Dockerfile).
3. **Variables**: `OST_CRANK_KEY` (base64), `OST_RPC`.
4. Deploy. It runs `crank.mjs --watch`.

Verify from anywhere (no wallet needed):
```
node -e "const {Connection,PublicKey}=require('@solana/web3.js');(async()=>{const c=new Connection('https://api.devnet.solana.com');const a=new PublicKey('6LvGarqaiQfaaZ8RsCd3NQE96UAhDYCz8MXvarw6bsfF'),p=new PublicKey('F82m45QUAFJ4GtMsJrSFnWzDrjWdZjdzyh8HTPgTBHXr');const u=n=>{const b=Buffer.alloc(8);b.writeBigUInt64LE(BigInt(n));return b;};const o=Math.floor(Date.now()/1000/300)*300;const[m]=PublicKey.findProgramAddressSync([Buffer.from('market'),a.toBuffer(),u(o)],p);console.log('current round on-chain:', !!(await c.getAccountInfo(m)));})()"
```

## The one dependency that still matters everywhere: a dedicated RPC

Both the crank and the app read Solana over RPC. On the public devnet endpoint,
reads 429 under any load (which is what makes markets/auto-arm look flaky). Point
`OST_RPC` (crank) and the app's connection at a dedicated devnet RPC to fix it.

# OST Token — Codebase Guide

Solana SPL Token-2022 project (devnet) + large static web app. **No build step for the site** — files in `docs/` deploy as-is.

## Deploy (the only two commands that matter)

```
git push origin master          # code backup (GitHub Actions is billing-locked — ignore its failure emails)
npm run deploy:site             # publishes docs/ to https://ost-token.pages.dev in ~10s (Cloudflare Pages)
```

GitHub Pages (nachogtavl-collab.github.io/ost-token) is a stale backup; Cloudflare is the live site.

## Layout

| Path | What |
|---|---|
| `docs/` | **The website.** `index.html` = classic full app (~6k lines, the real product). `desktop.html` = OS Desktop launcher. `markets.html` = alias of index. `commerce.html`, `grok.html`, `x-app.html`, `coding-studio.html` = OS apps. |
| `docs/app.js` | ~16k-line monolith: wallet, faucet, predictions, commerce, i18n, survival vault. Everything else hooks into it. **Edit surgically; never reformat.** |
| `docs/mesh/`, `docs/ghost/` | P2P mesh (WebRTC games/markets) and ghost AI layers. |
| `programs/` | Anchor programs (`ost-token`, `ost-betting`). **`ost-betting` is DEPLOYED to devnet: `F82m45QUAFJ4GtMsJrSFnWzDrjWdZjdzyh8HTPgTBHXr`** — escrows real OST (Token-2022) in a program-owned vault, pari-mutuel, and **settles from Pyth on-chain (trustless — there is NO authority-resolve instruction)**. Proof: `cd scripts/pyth-crank && node lifecycle-e2e.mjs`. See the build recipe below — `anchor build` does NOT work on this machine. |
| `scripts/pyth-crank/` | **Isolated npm package on purpose.** The Pyth receiver SDK pulls `jito-ts` → an OLD `@solana/web3.js` needing `rpc-websockets@7`, while the repo uses web3 1.98 needing `rpc-websockets@9`. A global override BREAKS the repo's web3 (`CommonClient` is a v9 API — verified, then reverted). Keep the crank's deps here; do not hoist them. Contains `crank.mjs` (opens/locks/resolves 5-min markets) and `lifecycle-e2e.mjs`. |
| `workers/ost-api/` | Cloudflare Worker backend: KV + Durable Objects (NativeMarketHub = shared BTC 5-min rounds, RealtimeHub = websocket, FaucetGate, MeshHub). Deploy: `npx wrangler deploy` from that folder. |
| `scripts/` | ts-node utilities (faucet funding, metadata, market snapshot). |
| `project-docs/` | Non-served markdown/docs. |

## Money — the #1 source of bugs

Two OST pools that DO NOT auto-sync:
1. **On-chain devnet balance** — real SPL tokens; wallet dashboard `#wdOstBal`; bets/faucet claims move real tokens via `OST_RESCUE`/`OST_SWAP_POOL` vault.
2. **Off-chain bonus credits** — `localStorage['ost.faucet.hub.v2']` `{credits, lifetime}`; earned in games/Code Academy/faucet-hub; converted to real OST only via vault cash-out.

Rules:
- Never invent a third balance store. Read/write those two.
- OS-app pages (commerce/desktop) use `docs/ost-money.js` (`window.OST_MONEY`) which wraps the credits pool and broadcasts changes.
- Award/spend events: `ost-faucet-hub-award`, `ost:money:change`, `ost:wallet-changed` — dispatch after any balance write so all UIs update.

## Prediction markets

- `app.js` `OST_PREDICTION_API.placeOrder` = real devnet token transfer to settlement vault; orders in `localStorage['ost.prediction.orders.v1']`; status `open→won/lost`; "Claim win" pays from vault.
- BTC 5-min: server-authoritative via worker NativeMarketHub (`ost-btc5m-<openAt>` ids).
- ETH/SOL 5-min: `docs/fast-markets.js`, client-side, settle against Binance 5m klines (deterministic for all users). Injected via `buildOstNativeMarkets()` chain — chain, never replace.
- Global bet feed: worker `GET /positions/recent`.
- **Market page = `docs/ost-predict-mobile.js`** (all devices; `ost-markets-desk.js` lays it out wide on desktop, `ost-markets-pro.js` adds the hero/sparklines/live odds). The legacy board in `index.html` stays hidden underneath; app.js's ledger + resolution engine still run there.
- **Charts = `docs/ost-market-chart.js`** (`window.OST_MARKET_CHART`): the one history engine (CLOB per Yes/No token, Kalshi via worker, 1H…ALL, crosshair, ladder outcome picker, live CLOB midpoint repricing → `ost:predict:quote` / `ost:predict:outcome`). Reuse `history()` / `draw()`; do not add another canvas renderer. Class prefix `mkc-` (`omc-` belongs to mesh-contacts).
- Buying on the market page calls `OST_PREDICTION_API.placeOrder(payload)` directly (see `buildDirectOrder`); a picked ladder outcome routes to the leg market id. Selling calls `OST_PREDICTION_API.cashOut(ref)` (app.js `cashOutPredictionOrder`, the one payout routine for every rail; it dispatches `ost:prediction:order-changed`). Never drive the hidden desk buttons from a new surface.
- **Images = `docs/ost-market-art.js`** (`window.OST_MARKET_ART`): venue artwork (worker `image`, Gamma market/event lookups) or a generated SVG cover per category; applied to cards, featured tiles, the page header and portfolio rows (`.oma-face`). Reuse `faceFor(m)`; do not add another image fetch.
- Market page panes: Trades = OST fills (`/positions/recent`) + Polymarket venue trades (`data-api /trades?market=<conditionId>`), Holders = venue `/holders`, Comments = worker + Gamma event thread (read-only). Every pane times out, retries with backoff and shows a Retry state.
- Portfolio = the positions view in `ost-predict-mobile.js` (`openPositions`): local ledger instantly, then `OST_PREDICTION_API.syncOrders()` (wallet) + `refreshResolutions()`; open tickets are marked to the live price; claim/sell go through `cashOut`.
- Parlays (`ost-parlay.js`) spend the credits pool only; slips mirror into the ledger as `source:'ost-parlay'` credits rows that the desk must never cash out (guard in `getPredictionOrderAction`). Venue legs settle via `/gamma/markets/:id`; `settleScan` re-reads slips before writing.

## Mirror stock markets + perps

- Spot mirror = `docs/stock-market.js` (1x, long-only UI) on the worker PlayLedger (`/play/stock/*`, Yahoo-priced server side). `loadOrders` merges `OST_PLAY.stockPositions()` so server positions survive devices.
- **Perps = `workers/ost-api/src/perp-ledger.js`** (mixin installed on `PlayLedger`, same play balance) + `docs/ost-perps.js/.css` (a "Perps" mode toggle inside `#stock-market`). Routes: `GET /play/perp/markets`, `GET /play/perp/positions?wallet=`, `POST /play/perp/open {wallet,symbol,side,margin,leverage}`, `POST /play/perp/close {wallet,id}` (POSTs need the ost-auth signature). Fixed universe `PERP_MARKETS` (crypto 20x 24/7, stocks/indexes 10x in market hours; a stale stock quote = `market_closed`). Math lives in `settleAt()`: isolated margin, MMR 0.5%, 0.05% fee open+close, 2%-of-profit edge, funding = base 0.01%/8h ± OI skew snapshotted at open. The DO alarm (`alarm()` → `perpSweep`) liquidates crossed positions every 60s; max loss is margin, payouts are bankroll-capped. Client math in `ost-perps.js` mirrors the server (`liqPrice`, `markPos`) for previews only — never credits anything. Deploy the worker with `npx wrangler deploy` from `workers/ost-api` (needs `npm install` there first).

## Wallet area + money rails (the user-facing money path)

- **Wallet home = `docs/ost-wallet-home.js/.css`** (`window.OST_WALLET_HOME`, prefix `owh-`), mounted at the top of `#walletDashboard`; the legacy journey/intelligence/not-connected/connected blocks stay in the DOM hidden (app.js still updates `#wdOstBal` etc. — the appbar reads them). It never moves money itself: connect/create/restore drive app.js's hidden `.wallet-option[data-wallet]` buttons (same storage `ost.localWallet.v1`, backup flag `ost.localWallet.backupExportedAt`), Send clicks `#wdSendBtn` (wallet-extras sheet), Top up → `openTopUpModal()`, faucet → `runOstFaucetFlow()`, disconnect → `#walletBtn` after an inline confirm. Balances come from `OST_BALANCE` (unknown = "—", never 0). Activity = real `getSignaturesForAddress` + `getParsedTransactions`, cached per wallet in `ost.wallet.activity.v2:<pk>`. On phones without an injected provider the Phantom/Solflare/Backpack buttons open the wallet's universal link (`…/ul/browse/<url>`).
- **Creating a browser wallet never force-downloads the key**: the explicit backup step offers download / reveal / skip. Restore over an existing browser wallet requires the checkbox and offers the old backup first.
- **1-tap = `docs/ost-session-key.js`** (`OST_SESSION`): there is NO auto-funding. `fund(amount, {consent:true})` is the only way OSTG enters the session key; it is capped (`limits.max` 500 OSTG, ≤ wallet OSTG, read from the OSTG mint — never `getOstBalance`, which is the OSTC mint). `offer()` only emits `ost:session:offer`; the market page renders an amount picker whose confirm label carries the amount. `end()` sweeps OSTG and the SOL float (minus a small reserve for pending claims).
- **Server-only payout kinds** (`workers/ost-api/src/wallet-payouts.js`): `ost-new-here`, `ost-topup`, `ost-topup-local-verified`, `treasury-deposit` are refused from the browser (403 `server_only_kind`). Top-ups are delivered by the worker (`deliverTopupIntent`) after Stripe webhook / crypto verification; the client only POSTs `/topup/claim {id, wallet}` and polls `/topup/status/:id`. Non-SOL "treasury deposits" in `OST_REAL_SWAP.swapAny` throw and route to Top up → Crypto (the browser cannot observe a BTC/ETH deposit, so it must never ask the vault to pay for one).
- **Stripe is gated**: `stripeUsable(env)` accepts test keys, and live keys only with `TOPUP_LIVE="true"`. No STRIPE_* secrets are configured today, so `/topup/config` returns `stripeEnabled:false, stripeMode:'off'`; card / Apple Pay UI must read that config (apple-tap shows "Rail off", top-up disables the card pane). Crypto top-ups verify on **devnet** (`topupCluster(env)`), so devnet SOL/USDC → devnet OST — never label them "mainnet payment".
- `/wallet/events` POSTs are wallet-signed (`ost-auth.js` + `isProtectedPath`), the server validates `kind`/`sig`, and the history renderer escapes every field — the old stored-XSS path is closed; keep new history sources escaped.
- Onramper/MoonPay/Jupiter/Wormhole are **external mainnet tools for SOL assets**; they never deliver OST and must be labelled that way. Tap-to-pay / OST card / bridges are R&D.

## Conventions

- Vanilla JS IIFEs, no modules/bundler. New features = new self-contained file + `<script>` tag in the html + add to `docs/sw.js` PRECACHE (and bump its cache version).
- Feature modules integrate by wrapping existing `window.*` hooks and listening to events — do not edit app.js internals unless the feature lives there.
- **No new floating corner buttons.** Mobile nav is `ost-appbar.js/css` (bottom tab bar + More sheet). A module that adds a fixed launcher MUST add its selector to the hide-list in `ost-appbar.css` and a tile in the appbar TOOLS list; never pin its own corner on phones. Mobile type scale lives in `ost-mobile-scale.css` (16px base — never reintroduce a global shrink).
- i18n: user-facing strings in app.js flow through `t(key, fallback)`; injected modules ship English (i18n-runtime translates common patterns).
- `docs/index.html` and `docs/markets.html` must stay content-identical except `<title>`.
- Honesty rule: never present unlaunched capabilities (VPN, NFC, mainnet, partnerships) as live. Label R&D as R&D.
- **Never sell/accept real money for devnet OST.** Purchase flows must use test payments until mainnet.

## Building Solana programs on THIS machine (anchor build / cargo build-sbf are BROKEN here)

Do not waste time on `anchor build` or `cargo build-sbf` — both fail permanently on this
Windows setup for three separate root causes (all diagnosed, none fixable by "reinstall"):
1. `~/.rustup/toolchains/solana` can be an **MSYS-style symlink** that rustup reports as
   uninstalled but cannot actually delete → cargo-build-sbf's re-link collides forever.
2. **solana 2.2.12's cargo-build-sbf canonicalizes** the SDK path (Windows always yields a
   `\\?\` prefix) then compares it to `rustup toolchain list -v` (plain path). These can
   NEVER match → permanent *"The Solana toolchain is corrupted"*. Cache repair cannot fix it.
3. platform-tools' host sysroot sits at a **260-char path = exactly Windows MAX_PATH**, so
   `link.exe` cannot open `libwindows_targets*.rlib` (LNK1104).

**The recipe that works (no admin, no Developer Mode, no WSL):**
```bash
# one-time: copy platform-tools (from the 3.1.12 release) to a SHORT path
#   C:\sol-pt   <- platform-tools-v1.52
rustup toolchain link solana 'C:\sol-pt\rust'

export PATH="/c/sol-pt/llvm/bin:$PATH"
export CARGO_TARGET_DIR='C:\ostb'          # repo lives under "OneDrive\Desktop\New folder" — too long
cargo +solana build --release --target sbpf-solana-solana -p ost-betting
cp /c/ostb/sbpf-solana-solana/release/ost_betting.so target/deploy/

# DO NOT use `solana program deploy` / `write-buffer` directly on public devnet.
# They blast all ~490 chunk-writes at once; devnet rate-limits per IP, so the CLI
# 429s ITSELF into a stall (observed: 55 min, zero progress, and even `getHealth`
# from the same IP started 429ing). Its retries make the throttling worse.
# Upload the buffer PACED instead, then do the (small, single-tx) upgrade:
cd scripts/deploy && npm i
node upload-buffer.mjs ../../target/deploy/ost_betting.so --rate 5   # prints BUFFER
cd ../.. && solana program deploy --buffer <BUFFER> \
  --program-id target/deploy/ost_betting-keypair.json --url devnet
```
If a deploy dies mid-upload it leaves an orphaned buffer holding ~3 SOL. Recover
with `solana program close --buffers --url devnet` (this has stranded 10+ SOL).
Helius's `?api-key=public` endpoint is READ-ONLY — it 401s on sendTransaction, so
it cannot be used to deploy.
IDL: `anchor idl build -p ost_betting` (needs the `idl-build` feature in Cargo.toml) → `target/idl/`.

Program-side gotchas learned the hard way:
- Escrow the **token**, not SOL. Use `anchor_spl::token_interface` (works with Token-2022, which OST is).
- On-chain checks use the **Clock sysvar**, which lags wall-clock on devnet — poll `getBlockTime`,
  not `Date.now()`, or you get spurious `ResolveTooEarly`.

## Known traps

- The repo sits in OneDrive — file locks cause `Permission denied` on renames; kill stray `python -m http.server` processes first.
- Windows sed mangles `&` in replacements — use python for html edits.
- Regex literals written through bash-heredoc→python can silently turn `\b` into 0x08 backspace chars (invisible in terminal, regex never matches). After patching any regex, verify with `python -c "print('\x08' in open(f,encoding='utf-8').read())"`.
- Uncommitted Rust changes in `programs/` predate current work — don't sweep into site commits.
- Worker CORS is `*` but rate-limits aggressively (429 on bare curl). Bare curl/PowerShell requests get 429 fast; test worker endpoints from a browser context or space calls ~8s apart.
- **Mobile CSS traps.** `mobile-shell.css` has a global `body.ost-mobile-shell * { min-width:0; overflow-wrap:anywhere; max-width:100% }` — it shatters any horizontal-scroller with fixed-width children (chips/tape render one char per line). Restore `min-width`/`flex:0 0 auto`/`overflow-wrap:normal` on those. Also, `style.css` desktop→mobile `@media` blocks that set `flex-basis`/`flex:0 0 <px>` for a *horizontal* rail turn into a huge **height** when another sheet (mobile-shell) forces that flex container to `flex-direction:column` — symptom is a big empty vertical gap. Fix by matching the offending selector's specificity (e.g. `.parent > .child`) since predict-mobile.css/etc. load last.
- Playwright headless throttles `requestAnimationFrame` — canvas game animations (Plinko drops, Crash) run much slower than on-device, so multi-round/auto-bet verifications need generous polling (90–130 × 700ms) or fewest-rows/1-ball settings.
- Bulk version-bump scripts: NEVER `open(path,'w').write(open(path).read()...)` in one expression — Python opens-for-write (truncating the file to 0 bytes) before the read runs, emptying it. Read fully into a var first, then open for write. (This wiped index.html/markets.html/sw.js once; restored via `git checkout --`.)
- House edge lives in `docs/ost-house.js` (`window.OST_HOUSE`): rake(gross, basis, kind) charges 2% of PROFIT (gross−basis) at every payout — games (settleGame), parlay win/cash-out, prediction claim/sell, stock/memecoin sell. Losses/refunds are never taxed. Add new payout paths through it, not a bespoke fee.
- **On-chain tickets are the exception.** A bet escrowed in the betting program (`onChain: true`, routed by `docs/ost-onchain-route.js`) has its edge charged BY THE PROGRAM inside `claim_payout` (`HOUSE_FEE_BPS = 200`, profit-only, swept to the treasury pinned on the market at creation). For those, `claimBet` must NOT call `rake()` — it calls `OST_HOUSE.book(fee)` instead, which records an already-charged fee exactly once. Calling `rake()` there books the same OST twice.
- The desk's default rail for `ost-btc5m-*` rounds is the on-chain program whenever a wallet is connected and the round's market is open; everything else (and any failure) falls back to the custodial pool. An on-chain ticket must never be paid from credits — its OST is in the program vault, so that would pay twice.

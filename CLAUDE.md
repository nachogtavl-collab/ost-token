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

## Mesh (chat / social) — the user-facing surface is `docs/ost-mesh-app.js`

- **One app, eager-loaded** (`<script type="module" src="ost-mesh-app.js">`, prefix `omx-`, `window.OST_MESH_APP.{open, close, openChat, addFromText, inviteLink, sync, state}`): Chats · Add person · Me. The legacy pavilion (`docs/mesh/mesh.js` + mesh-mobile/upgrade/social-x/contacts, lazy-loaded) stays reachable from Me → "Classic mesh" for calls/games/location; its floating `#ost-mesh-trigger` is hidden. Launchers (appbar Mesh tile, mobile home `data-mobile-mesh`, Nexus `go('mesh')`, `#mesh` hash) open the app first.
- **Identity is shared with the legacy mesh**: same `ost_mesh_identity_v1` keys (ECDH + ECDSA P-384) and `ost_mesh_addr_v1` address, so nobody loses contacts. Profile name/emoji in `ost.mesh.app.profile.v1` and announced to the directory (`profile` on `/identity/announce`; lookups return it). Contacts `ost.mesh.app.contacts.v1`, messages `ost.mesh.app.msgs.v1.<addr>` (cap 500), dedupe ids `ost.mesh.app.seen.v1`.
- **Delivery model = store-and-forward, E2E encrypted.** Every message is `sealPayload(pairKey, …)` and POSTed (mesh-signed) to `/mesh/v1/msg/send`; the hub keeps ciphertext 7 days and pushes it instantly over the hub WebSocket (`/mesh/v1/ws?maddr&mts&mnonce&msig`, same OST-MESH|v1 canonical with the four params stripped from the signed path) when the recipient is connected; the client acks (`{t:'ack'}` over WS or `POST /mesh/v1/msg/ack`) to delete delivered mail. No WebSocket → the sheet polls `/msg/inbox?drain=0` every 6s. **Never go back to the in-memory `/signal/*` inbox for chat** — that is for WebRTC offers only.
- **Files/images**: encrypted on the device (`sealBytes`) and uploaded as ciphertext to `POST /mesh/v1/blob?to=&mime=&name=` (mesh-signed over the raw bytes, ≤ 6 MB, images auto-shrunk to 1600px, 80/hour); the message carries the blob id + a tiny thumbnail inside the sealed payload; receivers `GET /mesh/v1/blob/:id` and decrypt. Blobs live 7 days in the MeshHub DO (chunked `blob:<id>:<n>` + `blobmeta:<id>`).
- **Adding a person** = invite link `…/#mesh-add=<b64url {v:2,a,n,e,f}>` (also drawn as a QR with the vendored `qrcode-generator`). The phone's camera app opens it → the app shows "Add <name>?" → mesh-signed `/friend/request`; the other side taps Accept (`/friend/respond`). Both can write immediately; hub notices (`friend-request`/`friend-accepted`) are pushed and carry the profile. In-app scanning uses BarcodeDetector, else vendored `jsqr`. Old `ost-mesh-invite:` strings and bare `ost-mesh:` addresses still parse. The fingerprint in the link is checked against the directory — mismatch refuses the add.
- **TURN**: `GET /mesh/v1/ice` mints Cloudflare TURN credentials (secrets `TURN_KEY_ID`/`TURN_KEY_SECRET`, key "ost-mesh" in the Cloudflare account, cached 10 min, 2h TTL) and falls back to public STUN. Any WebRTC code (legacy `mesh-rtc.js` still uses Google STUN only) should fetch its ICE servers from there.
- Sandbox note: the headless browser cannot reach the worker directly; `scratchpad/mesh.mjs` routes `ost-api…/` through curl and WebSockets never open there (the hub does answer 101 — verified with curl), so tests use `OST_MESH_APP.sync()`.

## OST Social (feed, stories, profiles, calls, location, payments)

- **Client = three modules on top of the mesh app**: `docs/ost-social.js/.css` (`window.OST_SOCIAL.{open, compose, share, profile, post, pay, refresh}`, prefix `osl-`) registers the Feed (home tab), Me (own profile), profile/post/compose/notifs/search/edit views through `OST_MESH_APP.core.register()`; `docs/ost-mesh-call.js` (`window.OST_MESH_CALL.{start, state, hangup}`, call screen `#omxCall`, prefix `omxc-`) adds voice/video calls; location, live location and pay/call message cards live in the core (`innerToMsg`, `sendInner`). The core plugin surface is `core.X` = `{ views, headBtns, attach, actions, ws, badges }` — add features there, never a second sheet.
- **Server = `workers/ost-api/src/mesh/social.js`** mixin on MeshHub (`installSocial`), routes under `/mesh/v1/social/*`. Every write is mesh-signed by its author (`from` must equal the signer). Media are PUBLIC: `POST /social/media?mime=&purpose=post|story|avatar&w=&h=` (signed over raw bytes; images ≤10 MB, video mp4/webm/mov ≤40 MB, 250 MB/day/user), `GET /social/media/:id` with HTTP Range (206) so phones can stream video; story media expire after 30 h. Posts may only attach media the author uploaded. Embeds are sanitized: `href` must be an in-app hash (`#market=`, `#perp=`, `#u=`, `#post=`).
- **Profiles change ONLY through `POST /social/profile`** (signed). `/identity/announce` can no longer overwrite an existing profile (the bundle is public). A wallet is linked only with an ed25519 signature from that wallet over `OST-MESH-LINK|v1|<meshAddr>|<wallet>|<ts>` (`OST_AUTH.signText`), so tips can't be redirected.
- **Tips / chat payments are real devnet transfers** from the connected wallet (`OST_SOCIAL.pay` → OST = `OST_CONFIG.mint`, OSTG, or SOL) with memo `ost-tip:<postId>`; `POST /social/tip {from, postId, sig, ccy}` re-reads the tx (jsonParsed, ≤3 h old, memo present, amount actually received by the author's linked wallet) before crediting the post, idempotent per signature. Never credit a tip client-side.
- **Calls**: offers/answers are ECDSA-signed (`OMX-CALL|type|callId|from|to|sha256(sdp)|ts`) and verified against the caller's directory bundle; only existing, unblocked contacts can ring you. ICE from `/mesh/v1/ice` (Cloudflare TURN). Signaling = hub WebSocket `{t:'signal'}`; without a socket the module POSTs `/mesh/v1/signal/send` and polls `/mesh/v1/signal/inbox` (3.5 s idle, 1.2 s during a call). Missed/declined calls go through the mailbox as `{k:'call'}`.
- **Live location** works only while the page is open (browser limitation, said in the UI); updates are throttled (≥15 s, or 20 m moved, or 60 s heartbeat) and update one bubble in place via `lid`.
- **Site wiring**: Social link in the desktop nav (`.ost-nav-social`), appbar More tile "Social", a "↗ Share" button injected into the market page header (`.osl-mshare`), a share offer after `ost:prediction-order-recorded` (never auto-posts), deep links `#social`, `#post=<id>`, `#u=<meshAddr>`.
- `sw.js` must not intercept `/mesh/v1/` URLs (media are immutable-HTTP-cached; Range requests must hit the network).
- Moderation: `POST /mesh/v1/social/admin {key, action:'delete-post'|'delete-author', postId|addr}` with worker secret `SOCIAL_ADMIN_KEY` (or `MESH_ADMIN_KEY`). Test runs (`scratchpad/socialapi.mjs`, `scratchpad/social.mjs`) create real public data — purge their identities afterwards.

## OST Studio (browser IDE + sandbox + app hosting) — contract in `project-docs/ost-studio.md`

- **Client = `docs/studio.html`** + classic-script modules on `window.STUDIO` (`docs/studio/`): `core.js` (fs, IndexedDB `ost-studio`, cloud sync, identity, UI registries — the only shared surface), `editor.js` (Monaco 0.52.2, explorer, search), `runtime.js` (esbuild-wasm 0.24.2 bundling, bare imports → esm.sh, Pyodide 0.26.4, Console/Problems), `terminal.js` (xterm shell), `agent.js` (AI tool loop + agent tokens), `deploy.js` (Run & Deploy, OST Apps gallery, Account & Projects with .zip import/export). Modules talk only through `STUDIO.*` and bus events; add a feature by registering an activity/panel/action/command, never a second shell.
- **Sandbox rule**: user code runs ONLY in `<iframe sandbox="allow-scripts …">` WITHOUT `allow-same-origin` (or a Worker made inside one) — the studio origin holds wallet keys in localStorage. Preview pages use `<base href="https://preview.ost-studio.invalid/…">` (never resolves), which is why the site CSP's `base-uri` lists that host.
- **Studio is never framed** (`_headers` `/studio*` → `frame-ancestors 'none'` + a boot guard). `#new=<b64url {name, files}>` links (Code Academy "Open in Studio") always ask before importing and stay local (`meta.fromLink`) until the user edits them; `#report=<slug>` files an app report.
- **Identity** = the OST Mesh ECDSA key (`ost_mesh_identity_v1`, shared with Mesh/Social); requests are mesh-signed (`x-mesh-addr/ts/nonce/sig`), the hub pins each address's key (`identity_key_changed` on mismatch). A cloud space belongs to one browser's identity — there is no identity backup yet; moving projects = .zip. External coding agents use `Bearer ostk_…` tokens (sha256-stored, scopes read/write/deploy; `GET /studio/v1/agents.md` documents the API).
- **Sync**: push `POST /projects/:id/sync {put, del}` every 1.5 s; pull `GET /changes?since=` 4–12 s adaptive (`full:true` = resync). The pending queue (`P.dirty`) is persisted in the project meta (`pending`) so offline edits survive reloads; a file the server refuses (`too_large`/`bad_path`) is quarantined (status shows which) instead of blocking the project.
- **Backend = `StudioHub` DO** in ost-api (`workers/ost-api/src/studio/hub.js`, routes `/studio/v1/*`, migration `studio_hub_v1`). AI proxy `/studio/v1/ai/chat`: Groq (`GROQ_API_KEY`; models picked from Groq's live `/models` list — pinned names get retired and return `model_not_found`) → Workers AI fallback (weak at stopping tool loops; fallback replies carry `fallback:[error codes]`), rate-limited per owner and globally. Moderation: `POST /studio/v1/apps/:slug/report` (anyone) and `POST /studio/v1/admin {key, action:'reports'|'unpublish', slug}` with `SOCIAL_ADMIN_KEY`/`MESH_ADMIN_KEY`.
- **Hosting = static only.** No Workers for Platforms and no R2 on this account → no server-side user code. Deployed apps live at `https://ost-apps.nachogtavl.workers.dev/<slug>/` (worker `workers/ost-apps`, service binding `API` → ost-api; deploy ost-api FIRST, then `../ost-api/node_modules/.bin/wrangler deploy` from `workers/ost-apps`). All apps share that one origin: the host namespaces localStorage per slug and injects a "Made with OST Studio · Report" badge; tell creators never to store secrets. Inside OST, `index.html#app=<slug>` opens an app (`docs/ost-apps-viewer.js`), Social embeds accept `kind:'app'`.
- Tests: `scratchpad/studio-e2e.mjs` (live; `--mobile` for phones) deploys a real `e2e-*` app — unpublish it afterwards with the admin route.

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

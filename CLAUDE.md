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
| `programs/` | Anchor programs (`ost-token`, `ost-betting`). Build: `anchor build` (needs `cargo build-sbf --force-tools-install` if toolchain corrupts). |
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

## Conventions

- Vanilla JS IIFEs, no modules/bundler. New features = new self-contained file + `<script>` tag in the html + add to `docs/sw.js` PRECACHE (and bump its cache version).
- Feature modules integrate by wrapping existing `window.*` hooks and listening to events — do not edit app.js internals unless the feature lives there.
- **No new floating corner buttons.** Mobile nav is `ost-appbar.js/css` (bottom tab bar + More sheet). A module that adds a fixed launcher MUST add its selector to the hide-list in `ost-appbar.css` and a tile in the appbar TOOLS list; never pin its own corner on phones. Mobile type scale lives in `ost-mobile-scale.css` (16px base — never reintroduce a global shrink).
- i18n: user-facing strings in app.js flow through `t(key, fallback)`; injected modules ship English (i18n-runtime translates common patterns).
- `docs/index.html` and `docs/markets.html` must stay content-identical except `<title>`.
- Honesty rule: never present unlaunched capabilities (VPN, NFC, mainnet, partnerships) as live. Label R&D as R&D.
- **Never sell/accept real money for devnet OST.** Purchase flows must use test payments until mainnet.

## Known traps

- The repo sits in OneDrive — file locks cause `Permission denied` on renames; kill stray `python -m http.server` processes first.
- Windows sed mangles `&` in replacements — use python for html edits.
- Regex literals written through bash-heredoc→python can silently turn `\b` into 0x08 backspace chars (invisible in terminal, regex never matches). After patching any regex, verify with `python -c "print('\x08' in open(f,encoding='utf-8').read())"`.
- Uncommitted Rust changes in `programs/` predate current work — don't sweep into site commits.
- Worker CORS is `*` but rate-limits aggressively (429 on bare curl). Bare curl/PowerShell requests get 429 fast; test worker endpoints from a browser context or space calls ~8s apart.
- **Mobile CSS traps.** `mobile-shell.css` has a global `body.ost-mobile-shell * { min-width:0; overflow-wrap:anywhere; max-width:100% }` — it shatters any horizontal-scroller with fixed-width children (chips/tape render one char per line). Restore `min-width`/`flex:0 0 auto`/`overflow-wrap:normal` on those. Also, `style.css` desktop→mobile `@media` blocks that set `flex-basis`/`flex:0 0 <px>` for a *horizontal* rail turn into a huge **height** when another sheet (mobile-shell) forces that flex container to `flex-direction:column` — symptom is a big empty vertical gap. Fix by matching the offending selector's specificity (e.g. `.parent > .child`) since predict-mobile.css/etc. load last.
- Playwright headless throttles `requestAnimationFrame` — canvas game animations (Plinko drops, Crash) run much slower than on-device, so multi-round/auto-bet verifications need generous polling (90–130 × 700ms) or fewest-rows/1-ball settings.

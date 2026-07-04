# OST Master Plan — vision → shipped, staged honestly

Rule this plan lives by: **we never claim a capability is live before it is.**
Every item below is marked ✅ shipped, 🔨 buildable now, 🏗️ staged (needs a
prerequisite), or 🔭 research. Updated 2026-07-03.

## 1. Money must be everything — one balance, everywhere
- ✅ One canonical credits pool (`ost.faucet.hub.v2`) used by games, Code
  Academy, faucet hub, commerce, mesh markets, and the `OST_MONEY` API.
- ✅ Nav total badge (wallet + credits) on the classic app; floating badge on
  OS pages. Welcome bonus of 25 OST for new visitors.
- ✅ Real on-chain devnet flows: faucet claims, prediction stakes, vault
  payouts (`OST_RESCUE` / swap pool).
- 🔨 Next: show credits→on-chain cash-out more prominently; unify XP/levels
  with OST earnings.

## 2. Quantum-ready
- ✅ **Real post-quantum signatures shipped**: Winternitz One-Time Signatures
  (WOTS, SHA-256, w=16) — the hash-based family behind NIST SLH-DSA and
  RFC 8391. Every offline bearer note now carries a PQ public-key
  fingerprint; the minting device holds the one-time spend key; redemption
  proofs verify in-browser. Self-tested on every load.
- 🏗️ On-chain PQ: Solana itself signs with Ed25519 (not PQ). When Solana
  ships PQ program support (or via off-chain PQ attestation accounts), the
  Anchor program's `quantum_realm` instructions are the landing zone.
- 🔭 Dilithium/Kyber in-browser for account keys (needs WASM lib vetting).

## 3. Clear foundation (the "everything is intertwined" problem)
- ✅ `CLAUDE.md` — the codebase map: where money lives, how modules
  integrate (wrap hooks + events, never fork state), deploy commands,
  known traps. Every future session (human or AI) starts from it.
- ✅ Anti-pattern purge #1: removed the third parallel balance store.
- 🔨 Ongoing rule: new features = self-contained file + script tag +
  service-worker precache entry. No new localStorage stores for money.

## 4. Mobile standards
- ✅ Homepage passes the horizontal-overflow audit at iPhone width (390px).
- 🔨 Next: run the same audit on every OS page + heavy panels (predictions
  board, launchpad) and fix per-panel offenders; add PWA install prompt
  polish for the world dev testers (MX/US/PA/CN).

## 5. Real utility / volatility / minting (mainnet path)
- ✅ Devnet: real token, real program (builds clean), faucet, staking,
  governance, betting vault.
- 🏗️ **Mainnet launch is the unlock** for real utility & volatility.
  Checklist already in repo (`GO-PUBLIC-CHECKLIST.md`): ~3–5 SOL deploy
  cost, multisig upgrade authority, supply/mint policy, liquidity pool.
- ⛔ **Never sell devnet OST for real money.** Devnet tokens are free test
  tokens; charging real BTC/ETH/SOL for them would defraud buyers and
  poison OST's reputation before launch. Purchase portal runs in
  test-payment mode until mainnet.

## 6. Offline / off-grid / NFC / Apple
- ✅ Offline vault + bearer notes (paper/QR/digital) with SHA-256
  commitments, now PQ-signed (see §2). PWA works offline via service
  worker.
- 🏗️ Apple tap-to-pay reality: iOS Safari has **no Web-NFC** — no website
  can do real NFC on iPhone. The honest paths: (a) QR-based tap flow
  (works today, shipped in apple-tap panel), (b) Apple Wallet .pkpass
  cards with QR — needs an Apple Developer account ($99/yr) to sign
  passes, (c) a native iOS app with NFC entitlement — the real "tap at
  gas stations" answer, post-mainnet.
- 🔨 Android: Chrome Web-NFC exists — a real NFC bearer-note tap demo is
  buildable now for Android testers.

## 7. Nodes / alive on the internet and off-grid
- ✅ WebRTC mesh (games, group markets, signal relay through the worker).
- 🏗️ True off-grid (LoRa/Bluetooth hop relay) needs hardware nodes;
  protocol sketches exist in the mesh code. Stage after mainnet.

## 8. Access everywhere (China, censorship)
- ✅ Today: two live mirrors — ost-token.pages.dev (primary) and the
  github.io backup. Worker API has CORS `*` so any mirror works.
- 🔨 Buildable now: more mirrors on independent networks (Netlify,
  IPFS/Fleek) listed on an access page, so blocking one host doesn't
  kill access; the PWA keeps working offline once installed.
- ⛔ Honest limit: **OST is not a VPN and we won't market it as one.**
  A real censorship-circumvention transport is a serious infrastructure
  project with real risks to users; overclaiming it would endanger the
  exact people (CN testers) we want to protect. Mirrors + PWA + mesh
  relay are the truthful v1.

## 9. Portals & live exchange rates
- ✅ Live oracle price, currency selector, exchange calculator, Jupiter/
  Raydium/Orca routing UI on devnet.
- 🔨 Next: verify every rate panel against the worker `/ost/price` feed
  and label devnet quotes as devnet everywhere.

## 10. Competing with Polymarket / Kalshi / pump.fun / Stake
- ✅ 5-min BTC (server-authoritative), ETH & SOL 5-min (deterministic
  kline settlement), real vault-backed stakes, global bet feed endpoint.
- 🔨 Next (unblocked — wrangler is logged in): worker upgrade for
  server-authoritative ETH/SOL rounds + realtime broadcast of every bet;
  leaderboards & win streaks; 1-min turbo rounds.

---

## Foundation findings (2026-07-04) — hard constraints, read before "mint trillions"

**Supply ceiling is REAL and physical.** The OST mint uses 9 decimals. SPL
amounts are u64, so max total supply = 2^64−1 / 10^9 = **18.446 billion OST**,
period. Current supply is ~11.04B, leaving only ~7.4B headroom. **Trillions
are impossible on this mint.** Options if a trillion-scale token is truly
wanted:
- **Keep 9 decimals** (recommended for now): 18.4B is plenty for devnet; the
  faucet problem is not a supply problem (see below).
- **New mint at 6 decimals** → 18.4 *trillion* cap. This is a hard migration
  (new mint address, re-issue balances, update pool/metadata/site). A
  deliberate decision, not a quick script.

**The faucet is NOT empty.** On-chain check 2026-07-04: faucet pool holds
~10 billion OST and ~30 SOL for fees. "Faucet keeps emptying" was a *display*
symptom, not depletion — the live tiles read hard-coded zero because the
client never reported activity to the worker. Fixed via ost-telemetry.js +
ost-live-stats.js. Real anti-whale armor (per-wallet daily caps, global rate
limit) belongs in the worker FaucetGate — staged, not yet built.

**"Every trade always profitable for everyone" is mathematically impossible.**
Every trade has two sides; if both always win, a third party always funds the
difference until it collapses (that is the definition of a Ponzi and would end
OST's credibility). What IS real: the **protocol/house** profits on every
transaction — the spread + fees route to the treasury vault, which funds the
faucet, payouts and buybacks. Build toward the casino-house model (already how
prediction losses fund the vault), not guaranteed user profit.

**OST price now responds to usage.** The worker computes price from 24h active
wallets + tx + volume. Telemetry wiring means real activity now moves the
price (verified: a couple of events moved it $0.101 → $0.125). This is the
honest source of "volatility" — organic, not fabricated.

**Mesh + Ghost**: both load without fatal errors (Mesh renders full DOM +
~730 controls; Ghost API present). A true "modern social + live P2P data"
rebuild is a dedicated multi-session effort — staged, not faked.

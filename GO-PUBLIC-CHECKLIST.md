# OST Token — GO PUBLIC CHECKLIST

Everything you need to deploy OST and go live.

---

## CURRENT STATUS

| Item | Status |
|------|--------|
| Program binary (`ost_token.so`, 572 KB) | ✅ Built |
| Program ID synced across all files | ✅ `J2jiS296YWVie1Sopb4SxcM3aJnP9aAwe6aLDhCqvGXY` |
| Anchor IDL generated (`target/idl/ost_token.json`) | ✅ Done |
| Website wired (network status, wallet, faucet) | ✅ Done |
| Deploy scripts ready | ✅ Done |
| Deployer wallet | ✅ `6LvGarqaiQfaaZ8RsCd3NQE96UAhDYCz8MXvarw6bsfF` |
| Devnet SOL balance | ❌ **0 SOL** (rate-limited) |
| Program deployed to devnet | ❌ Pending SOL |
| Mint + Treasury initialized | ❌ Pending deploy |

---

## STEP 1: GET DEVNET SOL (Required: ~10 SOL)

The CLI airdrop is IP-rate-limited. Use the **browser faucet** instead:

1. Open **https://faucet.solana.com** in your browser
2. Paste your deployer address:
   ```
   6LvGarqaiQfaaZ8RsCd3NQE96UAhDYCz8MXvarw6bsfF
   ```
3. Select **Devnet** and request **5 SOL**
4. Wait 30 seconds, then request **5 SOL** again (total: 10 SOL)
5. Verify in terminal:
   ```powershell
   solana balance
   ```
   Should show `10 SOL` (need at least 8 SOL for deployment)

---

## STEP 2: DEPLOY TO DEVNET

### Option A: One-Command Launch (Recommended)
```powershell
cd "C:\Users\neyma\OneDrive\Desktop\New folder\ost-token"
.\scripts\launch.ps1 -Cluster devnet
```
This does everything: checks balance → deploys → installs npm packages → initializes mint + treasury → verifies on-chain.

### Option B: Step-by-Step
```powershell
cd "C:\Users\neyma\OneDrive\Desktop\New folder\ost-token"

# Deploy the program
solana program deploy target\deploy\ost_token.so --program-id target\deploy\ost_token-keypair.json

# Verify deployment
solana program show J2jiS296YWVie1Sopb4SxcM3aJnP9aAwe6aLDhCqvGXY

# Install Node.js dependencies
npm install

# Initialize mint + treasury
npx ts-node scripts/init-program.ts
```

---

## STEP 3: VERIFY DEPLOYMENT

After deployment succeeds:

1. **Check Solana Explorer:**
   https://explorer.solana.com/address/J2jiS296YWVie1Sopb4SxcM3aJnP9aAwe6aLDhCqvGXY?cluster=devnet

2. **Check mint-info.json** — created by init script with the mint address

3. **Open the website:**
   Open `site/index.html` in browser — the network status bar should show a green dot and "Program deployed"

4. **Test wallet connect:**
   Install Phantom (phantom.app) → switch to Devnet → connect to site → verify balance shows

---

## STEP 4: TEST ON DEVNET

1. **Connect Phantom wallet** (set to Devnet in Settings → Developer Settings)
2. **Get devnet SOL** via the site's faucet or https://faucet.solana.com
3. **Claim OST faucet** — the site's faucet calls `claim_faucet` instruction
4. **Send a private transfer** — test confidential transfers
5. **Verify treasury fee** — 0.1% should accumulate in DAO treasury

---

## STEP 5: GO PUBLIC — MAINNET DEPLOYMENT

### Pre-Mainnet Checklist:
- [ ] All devnet tests passing
- [ ] Security audit completed (consider: Sec3, OtterSec, Neodyme)
- [ ] Multisig upgrade authority set (Squads Protocol)
- [ ] Admin keys secured (hardware wallet)
- [ ] Website deployed (Vercel, Netlify, or IPFS)
- [ ] Domain purchased and DNS configured
- [ ] SSL certificate active
- [ ] Social media accounts created (Twitter/X, Discord, Telegram)
- [ ] Documentation/whitepaper published

### Mainnet Deploy:
```powershell
# Switch to mainnet
solana config set --url https://api.mainnet-beta.solana.com

# Fund deployer with real SOL (~8 SOL needed)
# Transfer SOL from an exchange or another wallet to:
# 6LvGarqaiQfaaZ8RsCd3NQE96UAhDYCz8MXvarw6bsfF

# Deploy (will prompt for confirmation)
.\scripts\launch.ps1 -Cluster mainnet
```

### Post-Mainnet:
- [ ] Verify on Solana Explorer (mainnet)
- [ ] Set upgrade authority to multisig
- [ ] Create Raydium/Orca liquidity pool
- [ ] Submit token to Jupiter strict list
- [ ] Submit to CoinGecko / CoinMarketCap
- [ ] Update website to point to mainnet RPC
- [ ] Remove devnet references from site

---

## STEP 6: LIQUIDITY & LISTINGS

### Raydium Liquidity Pool:
1. Go to https://raydium.io/liquidity/create-pool/
2. Select your OST mint address + SOL (or USDC)
3. Set initial price and deposit liquidity
4. Share pool address for traders

### Jupiter Aggregator:
1. Submit token metadata to https://github.com/jup-ag/token-list
2. Include: mint address, name ("OST"), symbol, decimals (9), logo URL
3. Wait for approval to appear in Jupiter swap

### CoinGecko / CoinMarketCap:
1. Apply at https://www.coingecko.com/en/coins/forms/new
2. Apply at https://coinmarketcap.com/currencies/listing/
3. Need: contract address, website, whitepaper, social links

---

## STEP 7: LOCAL TESTING (Alternative to Devnet)

If devnet faucet stays rate-limited, test locally:

1. **Run test validator as Administrator:**
   Double-click `start-validator-admin.cmd` and approve the UAC prompt.
   Or right-click PowerShell → "Run as administrator":
   ```powershell
   cd "C:\Users\neyma\OneDrive\Desktop\New folder\ost-token"
   .\run-validator.ps1
   ```

2. **Deploy locally:**
   ```powershell
   .\scripts\launch.ps1 -Cluster localnet
   ```
   Airdrop works instantly on localnet (no rate limits).

---

## QUICK REFERENCE

| What | Value |
|------|-------|
| Program ID | `J2jiS296YWVie1Sopb4SxcM3aJnP9aAwe6aLDhCqvGXY` |
| Deployer | `6LvGarqaiQfaaZ8RsCd3NQE96UAhDYCz8MXvarw6bsfF` |
| Program Binary | `target/deploy/ost_token.so` (572 KB) |
| Program Keypair | `target/deploy/ost_token-keypair.json` |
| IDL | `target/idl/ost_token.json` |
| DAO Fee | 0.1% (10 basis points) |
| Token Decimals | 9 |
| Pre-mine | 0 (fair launch) |
| Build Command | `cargo-build-sbf --skip-tools-install --sbf-sdk "C:\sbf" --manifest-path "programs\ost-token\Cargo.toml" --sbf-out-dir "target\deploy"` |
| Deploy Cost | ~7.97 SOL (rent-exempt) + transaction fees |

---

## TROUBLESHOOTING

### "Access is denied (os error 5)" — Test Validator
**Cause:** Windows lacks symlink privileges for genesis extraction.
**Fix:** Run as Administrator. Use `start-validator-admin.cmd` or run PowerShell as admin.

### "Access is denied (os error 5)" — cargo-build-sbf
**Cause:** Platform-tools extraction needs symlinks.
**Fix:** Use `--skip-tools-install` flag (tools already at `C:\spt`).

### "Failed to install platform-tools" — anchor build
**Cause:** Same symlink issue.
**Fix:** Use `cargo-build-sbf --skip-tools-install` instead of `anchor build` for the SBF binary. Use `anchor idl build` separately for IDL.

### Airdrop Rate Limited
**Fix:** Use browser faucet at https://faucet.solana.com. Wait 8 hours between attempts if still limited.

### Program ID Mismatch
Verify all files match:
```powershell
Select-String "J2jiS296YWVie1Sopb4SxcM3aJnP9aAwe6aLDhCqvGXY" -Path programs\ost-token\src\lib.rs, Anchor.toml, client\ost-client.ts, site\app.js, deploy-devnet.ps1, scripts\init-program.ts, scripts\launch.ps1
```

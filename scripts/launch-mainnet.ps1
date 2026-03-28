#!/usr/bin/env pwsh
# =============================================================================
# OST Token — Mainnet Launch Script
# =============================================================================
# This script deploys OST to Solana mainnet-beta.
#
# PREREQUISITES:
#   1. Fund your wallet with real SOL (at least 6 SOL recommended)
#      Wallet: 6LvGarqaiQfaaZ8RsCd3NQE96UAhDYCz8MXvarw6bsfF
#      Buy SOL from an exchange (Coinbase, Binance, Kraken) and send to this address.
#
#   2. Build the program (already done if you deployed to devnet):
#      anchor build
#
# COST BREAKDOWN (approximate):
#   - Program deploy (~544 KB):  ~3.8 SOL (rent-exempt storage)
#   - Init mint + treasury:      ~0.01 SOL
#   - Mint supply:               ~0.01 SOL
#   - Create wOST wrapper:       ~0.01 SOL
#   - Set metadata:              ~0.01 SOL
#   - Create Raydium pool:       ~0.15 SOL (pool fee) + SOL liquidity
#   - Transaction fees:          ~0.01 SOL
#   - Total (excluding LP SOL):  ~4.0 SOL
#   - With 1 SOL in LP:          ~5.0 SOL
#
# USAGE:
#   .\scripts\launch-mainnet.ps1
#
# The script will prompt for confirmation at each step.
# =============================================================================

$ErrorActionPreference = "Stop"

# Add Solana to PATH
$env:PATH = "$env:USERPROFILE\.local\share\solana\install\active_release\bin;$env:PATH"

$ProjectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $ProjectRoot

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  OST Token — Mainnet Launch" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# ---------- Step 0: Verify wallet ----------
$wallet = solana address
Write-Host "Wallet: $wallet" -ForegroundColor Yellow

# Check mainnet balance
$mainnetBalance = solana balance --url https://api.mainnet-beta.solana.com 2>&1
Write-Host "Mainnet balance: $mainnetBalance" -ForegroundColor Yellow
Write-Host ""

# Parse balance
$balanceNum = 0
if ($mainnetBalance -match "(\d+\.?\d*)\s*SOL") {
    $balanceNum = [double]$Matches[1]
}

if ($balanceNum -lt 5) {
    Write-Host "WARNING: You have less than 5 SOL on mainnet." -ForegroundColor Red
    Write-Host "You need ~5 SOL for deployment + pool creation." -ForegroundColor Red
    Write-Host ""
    Write-Host "Send SOL to: $wallet" -ForegroundColor Yellow
    Write-Host ""
    $continue = Read-Host "Continue anyway? (y/N)"
    if ($continue -ne "y") {
        Write-Host "Aborting. Fund your wallet first."
        exit 0
    }
}

# ---------- Step 1: Switch to mainnet ----------
Write-Host ""
Write-Host "Step 1: Switching to mainnet-beta..." -ForegroundColor Green
solana config set --url https://api.mainnet-beta.solana.com
Write-Host ""

# ---------- Step 2: Deploy program ----------
Write-Host "Step 2: Deploy program to mainnet" -ForegroundColor Green
Write-Host "  Binary: target/deploy/ost_token.so (~544 KB)" -ForegroundColor Gray
Write-Host "  Cost: ~3.8 SOL (rent-exempt)" -ForegroundColor Gray
$confirm = Read-Host "Deploy? (y/N)"
if ($confirm -eq "y") {
    solana program deploy target/deploy/ost_token.so --program-id target/deploy/ost_token-keypair.json
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERROR: Program deployment failed!" -ForegroundColor Red
        exit 1
    }
    Write-Host "  Program deployed!" -ForegroundColor Green
} else {
    Write-Host "  Skipped."
}
Write-Host ""

# ---------- Step 3: Initialize program (mint + treasury + admin ATA) ----------
Write-Host "Step 3: Initialize program (create mint, treasury, admin ATA)" -ForegroundColor Green
$confirm = Read-Host "Initialize? (y/N)"
if ($confirm -eq "y") {
    npx ts-node scripts/init-program.ts --cluster mainnet
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERROR: Initialization failed!" -ForegroundColor Red
        exit 1
    }
} else {
    Write-Host "  Skipped."
}
Write-Host ""

# ---------- Step 4: Mint 1 billion OST ----------
Write-Host "Step 4: Mint 1,000,000,000 OST" -ForegroundColor Green
$confirm = Read-Host "Mint supply? (y/N)"
if ($confirm -eq "y") {
    npx ts-node scripts/mint-supply.ts --cluster mainnet --amount 1000000000
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERROR: Minting failed!" -ForegroundColor Red
        exit 1
    }
} else {
    Write-Host "  Skipped."
}
Write-Host ""

# ---------- Step 5: Create wOST wrapper token ----------
Write-Host "Step 5: Create wOST wrapper token (standard SPL for DEX trading)" -ForegroundColor Green
$confirm = Read-Host "Create wOST? (y/N)"
if ($confirm -eq "y") {
    npx ts-node scripts/create-wrapper-token.ts --cluster mainnet
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERROR: wOST creation failed!" -ForegroundColor Red
        exit 1
    }
} else {
    Write-Host "  Skipped."
}
Write-Host ""

# ---------- Step 6: Set on-chain metadata ----------
Write-Host "Step 6: Set on-chain metadata (Metaplex) for Jupiter/wallet display" -ForegroundColor Green
$confirm = Read-Host "Set metadata? (y/N)"
if ($confirm -eq "y") {
    npx ts-node scripts/set-token-metadata.ts --cluster mainnet
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERROR: Metadata failed!" -ForegroundColor Red
        exit 1
    }
} else {
    Write-Host "  Skipped."
}
Write-Host ""

# ---------- Step 7: Create Raydium pool ----------
Write-Host "Step 7: Create Raydium CPMM pool (wOST/SOL)" -ForegroundColor Green
Write-Host "  This pairs wOST with SOL on Raydium for trading." -ForegroundColor Gray
Write-Host "  Default: 100,000 wOST + 1 SOL (price: 1 wOST = 0.00001 SOL)" -ForegroundColor Gray
Write-Host ""
$solAmount = Read-Host "SOL amount for liquidity (default: 1)"
if ([string]::IsNullOrEmpty($solAmount)) { $solAmount = "1" }
$ostAmount = Read-Host "wOST amount for liquidity (default: 100000)"
if ([string]::IsNullOrEmpty($ostAmount)) { $ostAmount = "100000" }

$confirm = Read-Host "Create pool with $ostAmount wOST / $solAmount SOL? (y/N)"
if ($confirm -eq "y") {
    npx ts-node scripts/create-raydium-pool.ts --cluster mainnet --sol-amount $solAmount --ost-amount $ostAmount
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERROR: Pool creation failed!" -ForegroundColor Red
        exit 1
    }
} else {
    Write-Host "  Skipped."
}
Write-Host ""

# ---------- Step 8: Update website config ----------
Write-Host "Step 8: Update website to mainnet" -ForegroundColor Green
Write-Host "  After deployment, update site/app.js OST_CONFIG:" -ForegroundColor Gray
Write-Host "    network: 'mainnet-beta'" -ForegroundColor Gray
Write-Host "    rpcUrl:  'https://api.mainnet-beta.solana.com'" -ForegroundColor Gray
Write-Host "    mint:    <new mainnet mint address from mint-info.json>" -ForegroundColor Gray
Write-Host ""

# ---------- Done ----------
Write-Host ""
Write-Host "============================================" -ForegroundColor Green
Write-Host "  MAINNET LAUNCH COMPLETE!" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Website:  https://nachogtavl-collab.github.io/ost-token/" -ForegroundColor Cyan
Write-Host "  Raydium:  https://raydium.io/swap/" -ForegroundColor Cyan
Write-Host "  Jupiter:  https://jup.ag/tokens/<wOST-mint-address>" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Jupiter auto-discovers tokens with pools." -ForegroundColor Gray
Write-Host "  Share the token page link to get community smart likes." -ForegroundColor Gray
Write-Host ""

# Switch back to devnet for safety
Write-Host "Switching config back to devnet for safety..."
solana config set --url https://api.devnet.solana.com
Write-Host "Done. Solana CLI is back on devnet."

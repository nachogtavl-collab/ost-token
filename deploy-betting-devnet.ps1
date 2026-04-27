# =============================================================================
# OST Betting — Deploy to Devnet
# =============================================================================
# Builds and deploys the `ost_betting` Anchor program to Solana devnet.
#
# Prerequisites:
#   - Anchor + Rust + Solana CLI installed
#   - `solana config set --url https://api.devnet.solana.com`
#   - Deployer wallet has >= 3 SOL on devnet
# =============================================================================

$ErrorActionPreference = "Stop"

# ---- Environment Setup (mirrors deploy-devnet.ps1) ----
$env:SBF_SDK_PATH = "C:\sbf"
$env:RUSTC = "C:\spt\rust\bin\rustc.exe"
$solBin = "$env:USERPROFILE\.local\share\solana\install\active_release\solana-release\bin"
$cargoBin = "$env:USERPROFILE\.cargo\bin"
$env:PATH = "$solBin;$cargoBin;$env:PATH"

Write-Host "=== OST Betting Devnet Deployment ===" -ForegroundColor Cyan

# ---- 1. Build only the betting program ----
Write-Host "`n[1/4] Building ost_betting..." -ForegroundColor Yellow
anchor build -p ost_betting
if ($LASTEXITCODE -ne 0) {
    Write-Host "Build failed!" -ForegroundColor Red
    exit 1
}

$so = "target\deploy\ost_betting.so"
$kp = "target\deploy\ost_betting-keypair.json"
if (-not (Test-Path $so)) { Write-Host "ERROR: $so not found" -ForegroundColor Red; exit 1 }
$size = (Get-Item $so).Length
Write-Host "Built: $so ($([math]::Round($size/1024)) KB)"

# ---- 2. Verify config + balance ----
Write-Host "`n[2/4] Verifying Solana config..." -ForegroundColor Yellow
solana config get | Select-String "RPC URL"
$address = solana address
Write-Host "Deployer: $address"

$balance = solana balance
Write-Host "Balance: $balance"
$balNum = [double]($balance -replace ' SOL','')
if ($balNum -lt 3) {
    Write-Host "ERROR: Need at least 3 SOL on devnet. Current: $balance" -ForegroundColor Red
    Write-Host "Get SOL from: https://faucet.solana.com" -ForegroundColor Yellow
    exit 1
}

# ---- 3. Deploy ----
Write-Host "`n[3/4] Deploying ost_betting to devnet..." -ForegroundColor Yellow
solana program deploy $so --program-id $kp --url https://api.devnet.solana.com
if ($LASTEXITCODE -ne 0) {
    Write-Host "Deploy failed!" -ForegroundColor Red
    exit 1
}

# ---- 4. Verify ----
Write-Host "`n[4/4] Verifying deployment..." -ForegroundColor Yellow
$programId = "Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkgMQHGz5A9A"
solana program show $programId --url https://api.devnet.solana.com

Write-Host "`n=== Done ===" -ForegroundColor Green
Write-Host "Program ID: $programId"
Write-Host "Explorer: https://explorer.solana.com/address/$programId?cluster=devnet"

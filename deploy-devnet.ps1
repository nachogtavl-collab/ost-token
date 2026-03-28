# =============================================================================
# OST Token — Deploy to Devnet
# =============================================================================
# Prerequisites:
#   1. Build succeeded (ost_token.so exists in target/deploy/)
#   2. Deployer wallet has at least 8 SOL on devnet
#      - Get SOL from https://faucet.solana.com (max 2 requests per 8 hours)
#      - Or: solana airdrop 5 (subject to rate limits)
# =============================================================================

$ErrorActionPreference = "Stop"

# ---- Environment Setup ----
$env:SBF_SDK_PATH = "C:\sbf"
$env:RUSTC = "C:\spt\rust\bin\rustc.exe"
$solBin = "$env:USERPROFILE\.local\share\solana\install\active_release\solana-release\bin"
$cargoBin = "$env:USERPROFILE\.cargo\bin"
$env:PATH = "$solBin;$cargoBin;$env:PATH"

Write-Host "=== OST Token Devnet Deployment ===" -ForegroundColor Cyan

# ---- Verify config ----
Write-Host "`n[1/6] Verifying Solana config..." -ForegroundColor Yellow
$cluster = solana config get | Select-String "RPC URL"
Write-Host $cluster
$address = solana address
Write-Host "Deployer: $address"

# ---- Check balance ----
Write-Host "`n[2/6] Checking balance..." -ForegroundColor Yellow
$balance = solana balance
Write-Host "Balance: $balance"
$balNum = [double]($balance -replace ' SOL','')
if ($balNum -lt 8) {
    Write-Host "ERROR: Need at least 8 SOL for deployment (rent-exempt: ~7.97 SOL + fees). Current: $balance" -ForegroundColor Red
    Write-Host "Get SOL from: https://faucet.solana.com" -ForegroundColor Yellow
    Write-Host "Or run: solana airdrop 2" -ForegroundColor Yellow
    exit 1
}

# ---- Verify .so exists ----
Write-Host "`n[3/6] Verifying build artifact..." -ForegroundColor Yellow
$so = "target\deploy\ost_token.so"
if (-not (Test-Path $so)) {
    Write-Host "ERROR: $so not found. Run build first." -ForegroundColor Red
    exit 1
}
$size = (Get-Item $so).Length
Write-Host "Found: $so ($([math]::Round($size/1024)) KB)"

# ---- Deploy ----
Write-Host "`n[4/6] Deploying program to devnet..." -ForegroundColor Yellow
solana program deploy $so --program-id target\deploy\ost_token-keypair.json
if ($LASTEXITCODE -ne 0) {
    Write-Host "Deploy failed!" -ForegroundColor Red
    exit 1
}

# ---- Verify deployment ----
Write-Host "`n[5/6] Verifying deployment..." -ForegroundColor Yellow
$programId = "J2jiS296YWVie1Sopb4SxcM3aJnP9aAwe6aLDhCqvGXY"
solana program show $programId

# ---- Done ----
Write-Host "`n[6/6] Deployment complete!" -ForegroundColor Green
Write-Host "Program ID: $programId" -ForegroundColor Cyan
Write-Host "Explorer: https://explorer.solana.com/address/$($programId)?cluster=devnet" -ForegroundColor Cyan
Write-Host "`nNext steps:" -ForegroundColor Yellow
Write-Host "  1. Initialize the mint:  npx ts-node scripts/initialize-mint.ts"
Write-Host "  2. Initialize treasury:  npx ts-node scripts/initialize-treasury.ts"
Write-Host "  3. Run tests:           anchor test --skip-build"

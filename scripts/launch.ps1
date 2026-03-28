# =============================================================================
# OST Token — Complete Launch Script
# =============================================================================
# One-stop script: Fund → Deploy → Initialize → Verify
#
# Usage:
#   .\scripts\launch.ps1              # Launch to devnet (default)
#   .\scripts\launch.ps1 -Cluster mainnet  # Mainnet launch
# =============================================================================

param(
    [ValidateSet("devnet", "mainnet", "localnet")]
    [string]$Cluster = "devnet"
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectRoot

# Set environment vars for Solana build tools
$env:SBF_SDK_PATH = "C:\sbf"
$env:RUSTC = "C:\spt\rust\bin\rustc.exe"
$env:PATH = "C:\Program Files\GitHub CLI;C:\Program Files\Git\cmd;$env:USERPROFILE\.local\share\solana\install\active_release\bin;$env:USERPROFILE\.cargo\bin;$env:PATH"

$ProgramId = "J2jiS296YWVie1Sopb4SxcM3aJnP9aAwe6aLDhCqvGXY"

Write-Host ""
Write-Host "  ============================================" -ForegroundColor Magenta
Write-Host "  ✦  OST TOKEN — LAUNCH SEQUENCE  ✦" -ForegroundColor Magenta
Write-Host "  ============================================" -ForegroundColor Magenta
Write-Host "  Cluster:    $Cluster" -ForegroundColor White
Write-Host "  Program ID: $ProgramId" -ForegroundColor Cyan
Write-Host ""

# ---------------------------------------------------------------------------
# STEP 1: Check Prerequisites
# ---------------------------------------------------------------------------
Write-Host "[1/7] Checking prerequisites..." -ForegroundColor Yellow

$checks = @(
    @{ Name = "Solana CLI"; Cmd = "solana --version" },
    @{ Name = "Node.js"; Cmd = "node --version" }
)

foreach ($check in $checks) {
    try {
        $ver = Invoke-Expression $check.Cmd 2>$null
        Write-Host "  ✓ $($check.Name): $ver" -ForegroundColor Green
    } catch {
        Write-Host "  ✗ $($check.Name) NOT FOUND" -ForegroundColor Red
        exit 1
    }
}

# Check .so binary exists
$soBinary = "target\deploy\ost_token.so"
if (Test-Path $soBinary) {
    $size = (Get-Item $soBinary).Length
    Write-Host "  ✓ Program binary: $([math]::Round($size/1024))KB" -ForegroundColor Green
} else {
    Write-Host "  ✗ Program binary not found at $soBinary" -ForegroundColor Red
    Write-Host "    Run: anchor build" -ForegroundColor Yellow
    exit 1
}

# ---------------------------------------------------------------------------
# STEP 2: Configure Cluster
# ---------------------------------------------------------------------------
Write-Host "`n[2/7] Configuring for $Cluster..." -ForegroundColor Yellow

switch ($Cluster) {
    "devnet"   { solana config set --url https://api.devnet.solana.com | Out-Null }
    "mainnet"  { solana config set --url https://api.mainnet-beta.solana.com | Out-Null }
    "localnet" { solana config set --url http://localhost:8899 | Out-Null }
}

$address = solana address 2>$null
if (-not $address) {
    Write-Host "  No wallet found. Run: solana-keygen new" -ForegroundColor Red
    exit 1
}
Write-Host "  Deployer: $address" -ForegroundColor Green

# ---------------------------------------------------------------------------
# STEP 3: Check Balance
# ---------------------------------------------------------------------------
Write-Host "`n[3/7] Checking balance..." -ForegroundColor Yellow

$balStr = solana balance 2>$null
$balNum = [double]($balStr -replace ' SOL','')
Write-Host "  Balance: $balStr" -ForegroundColor $(if ($balNum -ge 4) { "Green" } else { "Red" })

if ($balNum -lt 4) {
    Write-Host ""
    Write-Host "  ╔══════════════════════════════════════════════╗" -ForegroundColor Yellow
    Write-Host "  ║  INSUFFICIENT SOL — Need at least 4 SOL     ║" -ForegroundColor Yellow
    Write-Host "  ║                                              ║" -ForegroundColor Yellow
    Write-Host "  ║  For devnet:                                 ║" -ForegroundColor Yellow
    Write-Host "  ║  1. Go to https://faucet.solana.com          ║" -ForegroundColor Cyan
    Write-Host "  ║  2. Enter: $address     ║" -ForegroundColor Cyan
    Write-Host "  ║  3. Request 5 SOL (may need multiple tries)  ║" -ForegroundColor Cyan
    Write-Host "  ║                                              ║" -ForegroundColor Yellow
    Write-Host "  ║  For mainnet: Transfer SOL to this address   ║" -ForegroundColor Yellow
    Write-Host "  ╚══════════════════════════════════════════════╝" -ForegroundColor Yellow
    Write-Host ""
    
    if ($Cluster -eq "devnet" -or $Cluster -eq "localnet") {
        Write-Host "  Trying CLI airdrop..." -ForegroundColor Yellow
        try {
            solana airdrop 5 2>$null
            Start-Sleep -Seconds 3
            $balStr = solana balance 2>$null
            $balNum = [double]($balStr -replace ' SOL','')
            Write-Host "  New balance: $balStr" -ForegroundColor Green
        } catch {
            Write-Host "  Airdrop failed. Use browser faucet for devnet." -ForegroundColor Yellow
        }
    }

    if ($balNum -lt 4) {
        Write-Host "  Waiting for funding... Press Enter when ready, or Ctrl+C to abort." -ForegroundColor Yellow
        Read-Host
        $balStr = solana balance
        $balNum = [double]($balStr -replace ' SOL','')
        if ($balNum -lt 4) {
            Write-Host "  Still insufficient: $balStr. Aborting." -ForegroundColor Red
            exit 1
        }
    }
}

# ---------------------------------------------------------------------------
# STEP 4: Deploy Program
# ---------------------------------------------------------------------------
Write-Host "`n[4/7] Deploying program..." -ForegroundColor Yellow

if ($Cluster -eq "mainnet") {
    Write-Host "  ⚠ MAINNET DEPLOYMENT — This is permanent!" -ForegroundColor Red
    $confirm = Read-Host "  Type 'LAUNCH' to confirm"
    if ($confirm -ne "LAUNCH") {
        Write-Host "  Aborted." -ForegroundColor Yellow
        exit 0
    }
}

$programKeypair = "target\deploy\ost_token-keypair.json"
solana program deploy $soBinary --program-id $programKeypair

if ($LASTEXITCODE -ne 0) {
    Write-Host "  ✗ Deployment failed!" -ForegroundColor Red
    Write-Host "  Check: sufficient SOL, correct keypair, network connectivity" -ForegroundColor Yellow
    exit 1
}

Write-Host "  ✓ Program deployed to $Cluster!" -ForegroundColor Green

# ---------------------------------------------------------------------------
# STEP 5: Install Node Dependencies
# ---------------------------------------------------------------------------
Write-Host "`n[5/7] Checking Node dependencies..." -ForegroundColor Yellow

if (-not (Test-Path "node_modules")) {
    Write-Host "  Installing npm packages..." -ForegroundColor Yellow
    npm install 2>&1 | Out-Null
    Write-Host "  ✓ Dependencies installed" -ForegroundColor Green
} else {
    Write-Host "  ✓ node_modules exists" -ForegroundColor Green
}

# ---------------------------------------------------------------------------
# STEP 6: Initialize Program (Mint + Treasury)
# ---------------------------------------------------------------------------
Write-Host "`n[6/7] Initializing OST mint & DAO treasury..." -ForegroundColor Yellow

$initArgs = if ($Cluster -eq "mainnet") { "--cluster mainnet" } else { "" }
npx ts-node scripts/init-program.ts $initArgs

if ($LASTEXITCODE -ne 0) {
    Write-Host "  ✗ Initialization failed!" -ForegroundColor Red
    Write-Host "  You can retry: npx ts-node scripts/init-program.ts $initArgs" -ForegroundColor Yellow
    exit 1
}

# ---------------------------------------------------------------------------
# STEP 7: Verify & Update Website
# ---------------------------------------------------------------------------
Write-Host "`n[7/7] Verifying deployment & updating website..." -ForegroundColor Yellow

# Verify program is deployed
$progInfo = solana program show $ProgramId 2>$null
if ($progInfo) {
    Write-Host "  ✓ Program verified on-chain" -ForegroundColor Green
} else {
    Write-Host "  ⚠ Could not verify program (may still be processing)" -ForegroundColor Yellow
}

# Update website config with mint address if available
$mintInfoPath = "mint-info.json"
if (Test-Path $mintInfoPath) {
    $mintInfo = Get-Content $mintInfoPath | ConvertFrom-Json
    Write-Host "  Mint address: $($mintInfo.mint)" -ForegroundColor Cyan

    # Update site/app.js with mint address
    $appJs = Get-Content "site/app.js" -Raw
    if ($appJs -match "mintAddress:") {
        Write-Host "  Website already has mint address" -ForegroundColor Green
    } else {
        $appJs = $appJs -replace "(programId: '[^']+')", "`$1,`n    mintAddress: '$($mintInfo.mint)'"
        Set-Content "site/app.js" $appJs
        Write-Host "  ✓ Updated site/app.js with mint address" -ForegroundColor Green
    }
}

# ---------------------------------------------------------------------------
# Final Summary
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "  ============================================" -ForegroundColor Green
Write-Host "  ✦  OST TOKEN — LAUNCH COMPLETE!  ✦" -ForegroundColor Green
Write-Host "  ============================================" -ForegroundColor Green
Write-Host "  Program:    $ProgramId" -ForegroundColor White
if (Test-Path $mintInfoPath) {
    $mi = Get-Content $mintInfoPath | ConvertFrom-Json
    Write-Host "  Mint:       $($mi.mint)" -ForegroundColor White
}
Write-Host "  Cluster:    $Cluster" -ForegroundColor White
Write-Host "  Deployer:   $address" -ForegroundColor White
Write-Host "  DAO Fee:    0.1% (for satellite funding)" -ForegroundColor White
Write-Host "  Pre-mine:   NONE (fair launch)" -ForegroundColor White
Write-Host "  ============================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Solana Explorer:" -ForegroundColor Yellow
if ($Cluster -eq "devnet") {
    Write-Host "  https://explorer.solana.com/address/$ProgramId`?cluster=devnet" -ForegroundColor Cyan
} else {
    Write-Host "  https://explorer.solana.com/address/$ProgramId" -ForegroundColor Cyan
}
Write-Host ""
Write-Host "  Next steps:" -ForegroundColor Yellow
Write-Host "  1. Open site/index.html in browser to test" -ForegroundColor White
Write-Host "  2. Connect wallet (Phantom/Solflare)" -ForegroundColor White
Write-Host "  3. Use faucet to get devnet SOL" -ForegroundColor White
Write-Host "  4. Set up Raydium liquidity pool" -ForegroundColor White
Write-Host "  5. Submit to Jupiter strict list" -ForegroundColor White
Write-Host ""

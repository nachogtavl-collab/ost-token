# =============================================================================
# OST Deploy Script — Devnet First
# =============================================================================
# Usage:
#   .\deploy-ost.ps1                  # Deploy to devnet (default)
#   .\deploy-ost.ps1 -Cluster mainnet # Deploy to mainnet-beta
# =============================================================================

param(
    [ValidateSet("devnet", "mainnet", "localnet")]
    [string]$Cluster = "devnet"
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectRoot

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  OST Token (Out-of-Space Token) Deployer"   -ForegroundColor Cyan
Write-Host "  Target: $Cluster"                            -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan

# ---------------------------------------------------------------------------
# 1. Check prerequisites
# ---------------------------------------------------------------------------
Write-Host "`n[1/6] Checking prerequisites..." -ForegroundColor Yellow

$solanaVersion = solana --version 2>$null
if (-not $solanaVersion) {
    Write-Host "ERROR: Solana CLI not found. Install from https://docs.solanalabs.com/cli/install" -ForegroundColor Red
    exit 1
}
Write-Host "  Solana: $solanaVersion" -ForegroundColor Green

$anchorVersion = anchor --version 2>$null
if (-not $anchorVersion) {
    Write-Host "ERROR: Anchor CLI not found. Install with: cargo install --git https://github.com/coral-xyz/anchor avm --locked --force; avm install latest; avm use latest" -ForegroundColor Red
    exit 1
}
Write-Host "  Anchor: $anchorVersion" -ForegroundColor Green

# ---------------------------------------------------------------------------
# 2. Configure Solana CLI for target cluster
# ---------------------------------------------------------------------------
Write-Host "`n[2/6] Configuring Solana CLI..." -ForegroundColor Yellow

switch ($Cluster) {
    "devnet"   { solana config set --url https://api.devnet.solana.com }
    "mainnet"  { solana config set --url https://api.mainnet-beta.solana.com }
    "localnet" { solana config set --url http://localhost:8899 }
}

$keypathRaw = solana config get keypair 2>$null
$keypath = ($keypathRaw -split "Keypair Path: ")[-1].Trim()

if (-not (Test-Path $keypath)) {
    Write-Host "  No keypair found. Generating new one..." -ForegroundColor Yellow
    solana-keygen new --outfile $keypath --no-bip39-passphrase
}

$address = solana address
Write-Host "  Deployer: $address" -ForegroundColor Green

# ---------------------------------------------------------------------------
# 3. Fund deployer on devnet
# ---------------------------------------------------------------------------
if ($Cluster -eq "devnet") {
    Write-Host "`n[3/6] Requesting devnet airdrop..." -ForegroundColor Yellow
    try {
        solana airdrop 2
        Write-Host "  Airdropped 2 SOL" -ForegroundColor Green
    } catch {
        Write-Host "  Airdrop failed (rate limited?). Ensure you have SOL." -ForegroundColor Yellow
    }
} else {
    Write-Host "`n[3/6] Skipping airdrop (not devnet)" -ForegroundColor Yellow
}

$balance = solana balance
Write-Host "  Balance: $balance" -ForegroundColor Green

# ---------------------------------------------------------------------------
# 4. Build the program
# ---------------------------------------------------------------------------
Write-Host "`n[4/6] Building Anchor program..." -ForegroundColor Yellow
anchor build

if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Build failed!" -ForegroundColor Red
    exit 1
}
Write-Host "  Build successful" -ForegroundColor Green

# Get program ID from keypair
$programKeypair = "target/deploy/ost_token-keypair.json"
if (Test-Path $programKeypair) {
    $programId = solana address -k $programKeypair
    Write-Host "  Program ID: $programId" -ForegroundColor Cyan

    # --- AUTO-SYNC program ID into all source files ---
    Write-Host "  Syncing program ID into source files..." -ForegroundColor Yellow

    # 1. lib.rs: declare_id!("...")
    $libRs = Get-Content "programs/ost-token/src/lib.rs" -Raw
    $libRs = $libRs -replace 'declare_id!\("[^"]+"\)', "declare_id!(""$programId"")"
    Set-Content "programs/ost-token/src/lib.rs" $libRs
    Write-Host "    [OK] programs/ost-token/src/lib.rs" -ForegroundColor Green

    # 2. Anchor.toml: both devnet and localnet sections
    $anchorToml = Get-Content "Anchor.toml" -Raw
    $anchorToml = $anchorToml -replace 'ost_token = "[^"]+"', "ost_token = ""$programId"""
    Set-Content "Anchor.toml" $anchorToml
    Write-Host "    [OK] Anchor.toml" -ForegroundColor Green

    # 3. TypeScript client: OST_PROGRAM_ID
    $clientTs = "client/ost-client.ts"
    if (Test-Path $clientTs) {
        $clientContent = Get-Content $clientTs -Raw
        $clientContent = $clientContent -replace 'const OST_PROGRAM_ID = new PublicKey\(\s*"[^"]+"\s*\)', "const OST_PROGRAM_ID = new PublicKey(`n  ""$programId""`n)"
        Set-Content $clientTs $clientContent
        Write-Host "    [OK] client/ost-client.ts" -ForegroundColor Green
    }

    # Rebuild with correct program ID
    Write-Host "  Rebuilding with correct program ID..." -ForegroundColor Yellow
    anchor build
    
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERROR: Rebuild with new program ID failed!" -ForegroundColor Red
        exit 1
    }
    Write-Host "  Rebuild successful" -ForegroundColor Green
} else {
    Write-Host "  WARNING: Program keypair not found at $programKeypair" -ForegroundColor Yellow
    Write-Host "  Run 'anchor build' manually first." -ForegroundColor Yellow
}

# ---------------------------------------------------------------------------
# 5. Deploy
# ---------------------------------------------------------------------------
Write-Host "`n[5/6] Deploying to $Cluster..." -ForegroundColor Yellow

if ($Cluster -eq "mainnet") {
    Write-Host "  WARNING: Deploying to MAINNET-BETA!" -ForegroundColor Red
    $confirm = Read-Host "  Type 'yes' to continue"
    if ($confirm -ne "yes") {
        Write-Host "  Aborted." -ForegroundColor Yellow
        exit 0
    }
}

anchor deploy --provider.cluster $Cluster

if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Deployment failed!" -ForegroundColor Red
    exit 1
}

# ---------------------------------------------------------------------------
# 6. Summary
# ---------------------------------------------------------------------------
Write-Host "`n[6/7] Deployment Complete!" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  Token:     OST (Out-of-Space Token)"       -ForegroundColor White
Write-Host "  Decimals:  9"                               -ForegroundColor White
Write-Host "  Program:   $programId"                      -ForegroundColor White
Write-Host "  Cluster:   $Cluster"                        -ForegroundColor White
Write-Host "  Pre-mine:  NONE (fair launch)"              -ForegroundColor White
Write-Host "  Features:  Confidential Transfers ON"       -ForegroundColor White
Write-Host "             Governance Staking"              -ForegroundColor White
Write-Host "             ZK Tax Reports"                  -ForegroundColor White
Write-Host "             DAO Treasury Fee (0.1%)"         -ForegroundColor White
Write-Host "             Solana Pay Merchant Payments"    -ForegroundColor White
Write-Host "             Deposit/Withdraw (Pub<->CT)"     -ForegroundColor White
Write-Host "============================================" -ForegroundColor Cyan

# ---------------------------------------------------------------------------
# 7. Post-deploy: Create Token-2022 mint via CLI (optional helper)
# ---------------------------------------------------------------------------
Write-Host "`n[7/7] Post-deploy setup hints..." -ForegroundColor Yellow
Write-Host ""
Write-Host "  To create the OST mint with confidential transfers via CLI:" -ForegroundColor White
Write-Host "    spl-token --program-id TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb \" -ForegroundColor Gray
Write-Host "      create-token --decimals 9 --enable-confidential-transfers auto" -ForegroundColor Gray
Write-Host ""
Write-Host "  Or use the program's initializeMint() instruction (recommended)." -ForegroundColor White
Write-Host ""
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "  1. Run tests:   anchor test --provider.cluster $Cluster" -ForegroundColor White
Write-Host "  2. Init mint:   Call initializeMint() from the client SDK" -ForegroundColor White
Write-Host "  3. Init DAO:    Call initializeTreasury() to set up 0.1% fee" -ForegroundColor White
Write-Host "  4. Distribute:  Use confidentialMint() + deposit() for fair launch" -ForegroundColor White
Write-Host "  5. Merchants:   Call registerMerchant() for Solana Pay vendors" -ForegroundColor White
Write-Host ""

# =============================================================================
# OST Token — Start Local Test Validator
# =============================================================================
# IMPORTANT: Must run as Administrator on Windows!
# Right-click PowerShell → "Run as Administrator" → then run this script.
# The Solana test-validator needs admin privileges for genesis extraction.
# =============================================================================

$ErrorActionPreference = "Stop"
$solBin = "$env:USERPROFILE\.local\share\solana\install\active_release\solana-release\bin"
$env:PATH = "$solBin;$env:USERPROFILE\.cargo\bin;$env:PATH"

# Check if admin
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "ERROR: Must run as Administrator!" -ForegroundColor Red
    Write-Host "Right-click PowerShell → 'Run as Administrator' → then run:" -ForegroundColor Yellow
    Write-Host "  cd '$PSScriptRoot'" -ForegroundColor Cyan
    Write-Host "  .\run-validator.ps1" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Or double-click: start-validator-admin.cmd" -ForegroundColor Cyan
    exit 1
}

# Add Defender exclusion
try { Add-MpPreference -ExclusionPath "C:\stl" -ErrorAction Stop; Write-Host "Added Defender exclusion for C:\stl" } catch {}

# Clean old ledger
if (Test-Path "C:\stl") { Remove-Item "C:\stl" -Recurse -Force -ErrorAction SilentlyContinue }

Write-Host ""
Write-Host "Starting Solana test validator..." -ForegroundColor Cyan
Write-Host "  Ledger: C:\stl" -ForegroundColor Gray
Write-Host "  RPC:    http://localhost:8899" -ForegroundColor Gray 
Write-Host ""
Write-Host "After this starts, open a new terminal and run:" -ForegroundColor Yellow
Write-Host "  solana config set --url http://localhost:8899" -ForegroundColor Cyan
Write-Host "  solana airdrop 5" -ForegroundColor Cyan
Write-Host "  .\scripts\launch.ps1 -Cluster localnet" -ForegroundColor Cyan
Write-Host ""

solana-test-validator --ledger C:\stl --reset

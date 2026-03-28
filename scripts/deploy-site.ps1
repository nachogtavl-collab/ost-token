# ================================================================== #
#  deploy-site.ps1 — Deploy OST website to IPFS                      #
# ================================================================== #
# Prerequisites:                                                      #
#   - IPFS CLI installed   (https://docs.ipfs.tech/install/)          #
#   - OR use Pinata / web3.storage for pinning                        #
# ================================================================== #

param(
    [switch]$UsePinata,
    [string]$PinataJwt
)

$ErrorActionPreference = "Stop"
$SiteDir = Join-Path $PSScriptRoot ".." "site"

Write-Host ""
Write-Host "=== OST Website — IPFS Deploy ===" -ForegroundColor Cyan
Write-Host ""

# ---- 1. Verify site directory ----
if (-not (Test-Path (Join-Path $SiteDir "index.html"))) {
    Write-Host "[ERROR] site/index.html not found. Run from the ost-token directory." -ForegroundColor Red
    exit 1
}

Write-Host "[1/4] Site directory: $SiteDir" -ForegroundColor Green

# ---- 2. List files being deployed ----
Write-Host "[2/4] Files to deploy:" -ForegroundColor Green
Get-ChildItem -Path $SiteDir -Recurse -File | ForEach-Object {
    Write-Host "      $($_.Name)" -ForegroundColor Gray
}
Write-Host ""

# ---- 3. Deploy ----
if ($UsePinata) {
    # ------- Pinata (remote pinning) -------
    Write-Host "[3/4] Uploading to Pinata..." -ForegroundColor Yellow

    if (-not $PinataJwt) {
        Write-Host "[ERROR] Supply -PinataJwt <token> for Pinata uploads." -ForegroundColor Red
        Write-Host "        Get a free JWT at https://app.pinata.cloud/developers/api-keys" -ForegroundColor Gray
        exit 1
    }

    # Tar the directory and upload via Pinata API
    $tarPath = Join-Path $env:TEMP "ost-site.tar"
    if (Test-Path $tarPath) { Remove-Item $tarPath }
    tar -cf $tarPath -C $SiteDir .

    $response = Invoke-RestMethod `
        -Uri "https://api.pinata.cloud/pinning/pinFileToIPFS" `
        -Method Post `
        -Headers @{ "Authorization" = "Bearer $PinataJwt" } `
        -Form @{
            file = Get-Item $tarPath
            pinataMetadata = '{"name":"ost-website"}'
        }

    $cid = $response.IpfsHash
    Remove-Item $tarPath -ErrorAction SilentlyContinue

} else {
    # ------- Local IPFS daemon -------
    Write-Host "[3/4] Adding to local IPFS daemon..." -ForegroundColor Yellow

    $ipfsCheck = Get-Command ipfs -ErrorAction SilentlyContinue
    if (-not $ipfsCheck) {
        Write-Host "[ERROR] IPFS CLI not found. Install from https://docs.ipfs.tech/install/" -ForegroundColor Red
        Write-Host "        Or use -UsePinata flag for remote pinning." -ForegroundColor Gray
        exit 1
    }

    $addOutput = ipfs add -r -Q $SiteDir
    $cid = $addOutput.Trim()
}

Write-Host ""
Write-Host "[4/4] Deployed!" -ForegroundColor Green
Write-Host ""
Write-Host "  CID:     $cid" -ForegroundColor White
Write-Host ""
Write-Host "  Gateways:" -ForegroundColor Cyan
Write-Host "    https://ipfs.io/ipfs/$cid"
Write-Host "    https://dweb.link/ipfs/$cid"
Write-Host "    https://cloudflare-ipfs.com/ipfs/$cid"
Write-Host "    https://$cid.ipfs.cf-ipfs.com"
Write-Host ""
Write-Host "  To pin permanently, use:" -ForegroundColor Gray
Write-Host "    ipfs pin add $cid"
Write-Host "    OR pin via Pinata / web3.storage / Filebase" -ForegroundColor Gray
Write-Host ""
Write-Host "  To use a custom domain (e.g. ost.earth):" -ForegroundColor Gray
Write-Host "    1. Set a DNS TXT record:  _dnslink.ost.earth  ->  dnslink=/ipfs/$cid"
Write-Host "    2. Point CNAME to gateway (e.g. cloudflare-ipfs.com)" -ForegroundColor Gray
Write-Host ""
Write-Host "=== Done ===" -ForegroundColor Cyan

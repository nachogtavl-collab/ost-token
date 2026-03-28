@echo off
:: =================================================================
:: OST Token — Solana Test Validator (Admin)
:: =================================================================
:: This script self-elevates to Administrator to fix the
:: "Access is denied (os error 5)" genesis extraction error.
::
:: USAGE: Double-click this file, then approve the UAC prompt
:: =================================================================

:: Check if already running as admin
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo Requesting Administrator privileges...
    powershell -Command "Start-Process cmd -Verb RunAs -ArgumentList '/c \"%~f0\"'"
    exit /b
)

:: Running as admin - set up environment
echo.
echo =============================================
echo   OST Token - Solana Test Validator (Admin)
echo =============================================
echo.

set "SOLANA_BIN=%USERPROFILE%\.local\share\solana\install\active_release\solana-release\bin"
set "PATH=%SOLANA_BIN%;%USERPROFILE%\.cargo\bin;%PATH%"

:: Add Windows Defender exclusion for ledger directory
echo Adding Defender exclusion for C:\stl...
powershell -Command "Add-MpPreference -ExclusionPath 'C:\stl' -ErrorAction SilentlyContinue" 2>nul

:: Clean up old ledger
if exist "C:\stl" (
    echo Cleaning old ledger at C:\stl...
    rmdir /s /q "C:\stl" 2>nul
)

:: Start validator
echo.
echo Starting Solana test validator...
echo Ledger: C:\stl
echo RPC:    http://localhost:8899
echo.
echo To connect:  solana config set --url http://localhost:8899
echo To deploy:   solana program deploy target\deploy\ost_token.so --program-id target\deploy\ost_token-keypair.json
echo.

solana-test-validator --ledger C:\stl --reset

:: Keep window open if it exits
echo.
echo Validator stopped. Press any key to exit.
pause >nul

@echo off
REM OST market crank — one-shot pass, run every minute by Windows Task Scheduler.
REM Persistent + KV-free: talks straight to Solana RPC + Pyth, no OST worker/KV.
REM Each run is independent, so a transient failure never stops future runs.
cd /d "C:\Users\neyma\OneDrive\Desktop\New folder\ost-token\scripts\pyth-crank"
"C:\Program Files\nodejs\node.exe" crank.mjs >> "%TEMP%\ost-crank.log" 2>&1

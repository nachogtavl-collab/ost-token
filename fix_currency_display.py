#!/usr/bin/env python3
"""Fix wallet balance display to respect selected currency (wdSolUsd / wdOstUsd)."""
import os

app_js = os.path.join(os.path.dirname(__file__), 'site', 'app.js')

with open(app_js, encoding='utf-8') as f:
    content = f.read()

OLD = (
    "        if (wdSolUsd) {\n"
    "          const solPrice = prices.solana || 0;\n"
    "          wdSolUsd.textContent = '$' + (solBal * solPrice).toFixed(2);\n"
    "        }\n"
    "        const ostBal = await getOstBalanceForAddress(pk);\n"
    "        if (wdOstBal) wdOstBal.textContent = ostBal.toFixed(2);\n"
    "        if (wdOstUsd) wdOstUsd.textContent = '$' + (ostBal * ostPrice).toFixed(2);"
)

NEW = (
    "        if (wdSolUsd) {\n"
    "          const solPrice = prices.solana || 0;\n"
    "          const cur = window.__ostCurrency || 'USD';\n"
    "          const fiatRate = (window.OST_TREASURY && window.OST_TREASURY.priceUsd)\n"
    "            ? (window.OST_TREASURY.priceUsd(cur) || 1) : 1;\n"
    "          // fiatRate is how many USD equal 1 unit of `cur`; invert to get cur per USD\n"
    "          const curSymbol = {'EUR':'\u20ac','GBP':'\u00a3','CAD':'C$','AUD':'A$','MXN':'MX$','JPY':'\u00a5','BTC':'\u20bf','ETH':'\u039e'}[cur] || cur + ' ';\n"
    "          const solInCur = solBal * solPrice / fiatRate;\n"
    "          wdSolUsd.textContent = curSymbol + solInCur.toFixed(cur === 'BTC' ? 6 : 2);\n"
    "        }\n"
    "        const ostBal = await getOstBalanceForAddress(pk);\n"
    "        if (wdOstBal) wdOstBal.textContent = ostBal.toFixed(2);\n"
    "        if (wdOstUsd) {\n"
    "          const cur2 = window.__ostCurrency || 'USD';\n"
    "          const fiatRate2 = (window.OST_TREASURY && window.OST_TREASURY.priceUsd)\n"
    "            ? (window.OST_TREASURY.priceUsd(cur2) || 1) : 1;\n"
    "          const curSymbol2 = {'EUR':'\u20ac','GBP':'\u00a3','CAD':'C$','AUD':'A$','MXN':'MX$','JPY':'\u00a5','BTC':'\u20bf','ETH':'\u039e'}[cur2] || cur2 + ' ';\n"
    "          wdOstUsd.textContent = curSymbol2 + (ostBal * ostPrice / fiatRate2).toFixed(cur2 === 'BTC' ? 6 : 2);\n"
    "        }"
)

if OLD not in content:
    print('ERROR: OLD string not found in app.js')
    # Try to find approximate location
    idx = content.find("wdSolUsd.textContent = '$'")
    if idx >= 0:
        print('Approximate location:', idx)
        print(repr(content[idx-100:idx+200]))
    import sys; sys.exit(1)

new_content = content.replace(OLD, NEW, 1)
with open(app_js, 'w', encoding='utf-8') as f:
    f.write(new_content)

print(f'Done. Delta: {len(new_content)-len(content):+d} chars')

#!/usr/bin/env python3
"""Fix renderPredictionLedger in app.js to show source badges, entry price, shares, correct payout."""
import os, sys

app_js = os.path.join(os.path.dirname(__file__), 'site', 'app.js')

with open(app_js, encoding='utf-8') as f:
    content = f.read()

start_marker = '    function renderPredictionLedger() {'
end_marker = ('btn.disabled = false; btn.textContent = orig;\n'
              '          }\n'
              '        });\n'
              '      });\n'
              '    }\n'
              '\n'
              '    function renderLatestReceipt')

start = content.index(start_marker)
end_idx = content.index(end_marker, start)
end = end_idx + len('btn.disabled = false; btn.textContent = orig;\n          }\n        });\n      });\n    }\n')

print(f'Replacing chars {start}..{end} ({end-start} chars)')

NEW_FUNC = r"""    function renderPredictionLedger() {
      if (!positionListEl) return;
      if (ledgerCountEl) ledgerCountEl.textContent = String(state.orderHistory.length);
      if (!state.orderHistory.length) {
        positionListEl.innerHTML = '<div class="prediction-position-empty">' + escapeHtml(t('wallet.portal.prediction.noTickets', 'No OST market tickets recorded yet.')) + '</div>';
        return;
      }

      positionListEl.innerHTML = state.orderHistory.map(function(order, idx) {
        var sideLabel = order.side === 'no'
          ? t('wallet.portal.prediction.buyNo', 'Buy No')
          : t('wallet.portal.prediction.buyYes', 'Buy Yes');
        var canCash = !order.cashedOut && Number(order.stake || 0) > 0;
        var cashBtn = canCash
          ? '<button class="prediction-cashout-btn" data-cashout-idx="' + idx + '" style="margin-left:auto;padding:4px 10px;border-radius:6px;background:#22c55e;color:#000;border:none;font-weight:700;cursor:pointer;font-size:12px">Cash out</button>'
          : (order.cashedOut ? '<span style="color:#22c55e;font-weight:700;font-size:12px;margin-left:auto">\u2713 Paid out ' + formatOst(order.cashoutOst || 0) + '</span>' : '');
        // Per-share info derived from the stored stake + potentialReturn
        var stake = Number(order.stake || 0);
        var potReturn = Number(order.potentialReturn || 0);
        var entryPrice = potReturn > 0 ? stake / potReturn : Number(order.price || 0);
        var shares = entryPrice > 0 ? (stake / entryPrice).toFixed(2) : potReturn.toFixed(2);
        var pricePct = Number.isFinite(entryPrice) && entryPrice > 0 ? (entryPrice * 100).toFixed(1) + '\u00a2' : '\u2014';
        // Source badge (Kalshi green, Polymarket blue, OST native amber)
        var src = (order.source || 'ost').toLowerCase();
        var srcColor = src === 'kalshi' ? '#00c896' : src === 'polymarket' ? '#6d9fff' : '#f5c468';
        var srcBadge = '<span style="font-size:10px;font-weight:700;padding:1px 6px;border-radius:4px;background:' + srcColor + '22;color:' + srcColor + ';border:1px solid ' + srcColor + '55;text-transform:uppercase;">' + escapeHtml(src) + '</span>';
        return [
          '<div class="prediction-position-row">',
            '<div class="prediction-position-row-top">',
              '<div style="display:flex;align-items:center;gap:6px;">',
                srcBadge,
                '<strong>' + escapeHtml(order.title || 'Prediction ticket') + '</strong>',
              '</div>',
              '<span class="prediction-position-pill side-' + escapeHtml(order.side || 'yes') + '">' + escapeHtml(sideLabel) + '</span>',
            '</div>',
            '<div class="prediction-position-row-meta" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">',
              '<span title="Stake / Entry price / Shares / Max return">',
                '<b>' + escapeHtml(formatOst(stake)) + '</b> stake',
                ' \u2022 <b>' + pricePct + '</b> entry',
                ' \u2022 <b>' + shares + '</b> shares',
                ' \u2022 max <b>' + escapeHtml(formatOst(potReturn)) + '</b>',
              '</span>',
              '<a class="prediction-market-api-link" href="' + escapeHtml(explorerTxUrl(order.signature)) + '" target="_blank" rel="noopener">' + escapeHtml(shortAddress(order.signature || '')) + '</a>',
              cashBtn,
            '</div>',
          '</div>'
        ].join('');
      }).join('');

      // Wire cash-out buttons
      positionListEl.querySelectorAll('[data-cashout-idx]').forEach(function(btn) {
        btn.addEventListener('click', async function() {
          var idx = Number(btn.getAttribute('data-cashout-idx'));
          var orders = readPredictionOrderRecords();
          var order = orders[idx];
          if (!order) return;
          if (!window.OST_TRADE || !window.OST_TRADE.predictionCashOut) {
            try { alert('Trading module not loaded \u2014 refresh the page'); } catch(e){}
            return;
          }
          // Payout = potentialReturn * 0.8 (devnet win simulation; minimum = stake back)
          var stake = Number(order.stake || 0);
          var potReturn = Number(order.potentialReturn || 0);
          var payout = Math.max(stake, potReturn > 0 ? potReturn * 0.8 : stake * 1.5);
          var orig = btn.textContent;
          btn.disabled = true; btn.textContent = '\u2026';
          try {
            var r = await window.OST_TRADE.predictionCashOut(order, payout);
            order.cashedOut = true;
            order.cashoutSig = r.sig;
            order.cashoutOst = r.ost;
            order.cashoutAt = Date.now();
            orders[idx] = order;
            try { localStorage.setItem(PREDICTION_ORDERS_STORAGE_KEY, JSON.stringify(orders)); } catch(e){}
            state.orderHistory = orders;
            renderPredictionLedger();
            try { window.dispatchEvent(new CustomEvent('ost:wallet-changed')); } catch(e){}
            if (typeof window.notifyOstTxHistory === 'function') window.notifyOstTxHistory();
          } catch (err) {
            console.warn('[prediction cashout] failed', err);
            var msg = (err && err.message) ? err.message : 'Cash-out failed';
            try { alert('Prediction cash-out failed:\n\n' + msg); } catch(e){}
            btn.disabled = false; btn.textContent = orig;
          }
        });
      });
    }
"""

new_content = content[:start] + NEW_FUNC + content[end:]
with open(app_js, 'w', encoding='utf-8') as f:
    f.write(new_content)

print(f'Done. app.js rewritten ({len(new_content)} chars). Delta: {len(new_content)-len(content):+d}')

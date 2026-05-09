// One-shot transform: move predictionMarketBoard out of wallet-panel-portals
// into its own wallet-panel-predict, and add the 5th wallet tab button.
const fs = require('fs');
const path = require('path');

const file = path.resolve(__dirname, '..', 'site', 'index.html');
const src = fs.readFileSync(file, 'utf8');
const useCRLF = src.includes('\r\n');
const eol = useCRLF ? '\r\n' : '\n';
const lines = src.split(/\r?\n/);

function expect(idx, predicate, label) {
  if (!predicate(lines[idx])) {
    throw new Error(`Expected ${label} at line ${idx + 1}, got: ${JSON.stringify(lines[idx])}`);
  }
}

// 1-indexed -> 0-indexed
const BOARD_OPEN = 2347 - 1;   // '              <div class="prediction-market-board" id="predictionMarketBoard">'
const BOARD_CLOSE = 2714 - 1;  // '            </div>'  (closes board)
const PORTALS_PANEL_CLOSE = 2727 - 1; // '        </div>'  (closes wallet-panel-portals)

expect(BOARD_OPEN, l => l.includes('id="predictionMarketBoard"'), 'board open');
expect(BOARD_CLOSE, l => l.trim() === '</div>', 'board close');
expect(PORTALS_PANEL_CLOSE, l => l === '        </div>', 'portals panel close');

// Extract the board block (lines BOARD_OPEN..BOARD_CLOSE inclusive).
const boardBlock = lines.slice(BOARD_OPEN, BOARD_CLOSE + 1);

// Re-indent: original outer indent was 14 spaces (oddly nested in wallet-portal-grid).
// New container is wallet-tab-panel at 8-space indent; we want the board at 10-space indent.
// Strip 4 leading spaces from each line that has at least 4 leading spaces.
const reindented = boardBlock.map(line => {
  if (/^\s*$/.test(line)) return line;
  return line.startsWith('    ') ? line.slice(4) : line;
});

// Build the new predict panel.
const predictPanel = [
  '',
  '        <div class="wallet-tab-panel" id="wallet-panel-predict" hidden>',
  ...reindented,
  '        </div>',
];

// Splice: remove the old board lines (BOARD_OPEN..BOARD_CLOSE), then insert the new panel after PORTALS_PANEL_CLOSE.
// Because we remove lines BEFORE the insertion point, the insertion index after removal shifts.
const removed = BOARD_CLOSE - BOARD_OPEN + 1;
const newPortalsClose = PORTALS_PANEL_CLOSE - removed; // index after removal
const next = [
  ...lines.slice(0, BOARD_OPEN),
  ...lines.slice(BOARD_CLOSE + 1, PORTALS_PANEL_CLOSE + 1),
  ...predictPanel,
  ...lines.slice(PORTALS_PANEL_CLOSE + 1),
];

// 2. Add 5th tab button.
const TABS_PORTALS_BTN = 1768 - 1;
expect(TABS_PORTALS_BTN, l => l.includes('data-wallet-panel-target="portals"'), 'portals tab button');

// Find shifted index of the portals tab button in the new array.
let portalsBtnIdx = -1;
for (let i = 0; i < next.length; i++) {
  if (next[i].includes('data-wallet-panel-target="portals"') && next[i].includes('wallet-tab-btn')) {
    portalsBtnIdx = i;
    break;
  }
}
if (portalsBtnIdx === -1) throw new Error('portals tab button not found');

const predictBtn = '          <button class="wallet-tab-btn" data-wallet-panel-target="predict" data-i18n="wallet.tabs.predict">Predict</button>';
next.splice(portalsBtnIdx + 1, 0, predictBtn);

const out = next.join(eol);
fs.writeFileSync(file, out, 'utf8');
console.log(`Wrote ${file}`);
console.log(`Removed ${removed} lines, inserted ${predictPanel.length + 1} lines.`);
console.log(`New total lines: ${next.length}`);

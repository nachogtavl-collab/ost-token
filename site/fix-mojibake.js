// One-shot mojibake repair: undo the "UTF-8 -> Latin-1 -> re-saved as UTF-8"
// double-encoding present in app.js / index.html translation strings.
//
// Strategy: walk runs of non-ASCII characters whose code points all fit in
// 0..255. Pack them as Latin-1 bytes and try to decode as UTF-8. If the
// decode produces no replacement characters, replace the run with the result.
// Otherwise keep the original (so legitimate text isn't damaged).
const fs = require('fs');

function fixMojibake(text) {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const c = text.charCodeAt(i);
    if (c < 0x80) { out += text[i]; i++; continue; }
    let j = i;
    while (j < text.length) {
      const cc = text.charCodeAt(j);
      if (cc < 0x80 || cc > 0xFF) break;
      j++;
    }
    const run = text.slice(i, j);
    const bytes = Buffer.alloc(run.length);
    for (let k = 0; k < run.length; k++) bytes[k] = run.charCodeAt(k);
    const decoded = bytes.toString('utf8');
    if (!decoded.includes('\uFFFD')) {
      out += decoded;
    } else {
      out += run;
    }
    i = j;
  }
  return out;
}

const targets = process.argv.slice(2);
if (!targets.length) { console.error('usage: node fix-mojibake.js <file...>'); process.exit(1); }
for (const f of targets) {
  const buf = fs.readFileSync(f);
  let hasBom = buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF;
  const text = buf.toString('utf8').replace(/^\uFEFF/, '');
  const fixed = fixMojibake(text);
  const out = (hasBom ? '\uFEFF' : '') + fixed;
  fs.writeFileSync(f, out, 'utf8');
  const before = (text.match(/Ã[\u0080-\u00FF]|â€/g) || []).length;
  const after  = (fixed.match(/Ã[\u0080-\u00FF]|â€/g) || []).length;
  console.log(`${f}: mojibake ${before} -> ${after}`);
}

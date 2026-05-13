// Fast mojibake repair via direct buffer transcoding.
// The double-encode pattern: original UTF-8 bytes interpreted as Windows-1252 (or Latin-1)
// then re-encoded as UTF-8. To undo: extract the visible chars (cp1252 codepoints), pack as
// bytes, then decode as UTF-8.
const fs = require('fs');

// Windows-1252 codepoint -> byte (covers 0x80-0x9F slots that don't match Latin-1)
const cp1252Extra = {
  0x20AC: 0x80, 0x201A: 0x82, 0x0192: 0x83, 0x201E: 0x84, 0x2026: 0x85, 0x2020: 0x86,
  0x2021: 0x87, 0x02C6: 0x88, 0x2030: 0x89, 0x0160: 0x8A, 0x2039: 0x8B, 0x0152: 0x8C,
  0x017D: 0x8E, 0x2018: 0x91, 0x2019: 0x92, 0x201C: 0x93, 0x201D: 0x94, 0x2022: 0x95,
  0x2013: 0x96, 0x2014: 0x97, 0x02DC: 0x98, 0x2122: 0x99, 0x0161: 0x9A, 0x203A: 0x9B,
  0x0153: 0x9C, 0x017E: 0x9E, 0x0178: 0x9F
};

function fixFile(path) {
  const orig = fs.readFileSync(path, 'utf8');
  const before = (orig.match(/Ã[\u0080-\u00FF]|â€/g) || []).length;
  if (before === 0) { console.log(`${path}: 0 (skip)`); return; }

  const chars = [...orig];
  const out = [];
  const buf = [];
  const flushBuf = () => {
    if (buf.length === 0) return;
    const b = Buffer.from(buf);
    const decoded = b.toString('utf8');
    out.push(decoded.includes('\uFFFD') ? b.toString('binary') : decoded);
    buf.length = 0;
  };
  for (const ch of chars) {
    const cp = ch.codePointAt(0);
    let byte = -1;
    if (cp >= 0x80 && cp <= 0xFF) byte = cp;
    else if (cp1252Extra[cp] !== undefined) byte = cp1252Extra[cp];
    if (byte >= 0) {
      buf.push(byte);
    } else {
      flushBuf();
      out.push(ch);
    }
  }
  flushBuf();
  const fixed = out.join('');
  const after = (fixed.match(/Ã[\u0080-\u00FF]|â€/g) || []).length;
  fs.writeFileSync(path, fixed, 'utf8');
  console.log(`${path}: mojibake ${before} -> ${after}`);
}

const targets = process.argv.slice(2);
if (!targets.length) { console.error('usage: node fix-mojibake.js <file...>'); process.exit(1); }
for (const f of targets) fixFile(f);

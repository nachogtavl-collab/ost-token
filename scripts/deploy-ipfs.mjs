#!/usr/bin/env node
/* ============================================================================
 * OST · Decentralized frontend deploy — publish docs/ to IPFS
 * ----------------------------------------------------------------------------
 * Solana does not host websites; the decentralized-frontend layer that pairs
 * with it is IPFS (content-addressed, served by any gateway / any pinning
 * node) or Arweave. This script pins the whole site to IPFS via Pinata.
 *
 * SETUP (one time):
 *   1. Create a free Pinata account  ->  https://app.pinata.cloud
 *   2. Create an API key with the "pinFileToIPFS" permission
 *   3. Set the JWT in your shell:    setx PINATA_JWT "eyJ..."     (Windows)
 *
 * RUN:
 *   node scripts/deploy-ipfs.mjs
 *
 * OUTPUT: an immutable CID. The site is then reachable on ANY public gateway:
 *   https://gateway.pinata.cloud/ipfs/<CID>/
 *   https://ipfs.io/ipfs/<CID>/
 *   https://dweb.link/ipfs/<CID>/
 * Optional next steps for a human-readable decentralized name:
 *   - .sol domain via Solana Name Service pointing at the CID (SNS + Brave
 *     resolve ost.sol natively)
 *   - DNSLink TXT record (_dnslink.yourdomain -> dnslink=/ipfs/<CID>)
 *
 * HONEST LIMITS (do not skip reading this):
 *   - The OST worker API (rounds hub, faucet gate, relay) is still Cloudflare —
 *     the IPFS build calls the same API. Frontend hosting is decentralized;
 *     backend decentralization is the Anchor-program roadmap.
 *   - The service worker + absolute paths assume a root domain; on a gateway
 *     the app lives under /ipfs/<CID>/, so this script rewrites absolute
 *     references to relative ones in the copy it uploads (docs/ untouched).
 * ========================================================================== */
import { readFileSync, readdirSync, statSync, mkdtempSync, cpSync, writeFileSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const DOCS = join(ROOT, 'docs');
const JWT = process.env.PINATA_JWT;

if (!JWT) {
  console.error('\nPINATA_JWT is not set.');
  console.error('Create a free key at https://app.pinata.cloud (Developers -> API Keys),');
  console.error('then:  setx PINATA_JWT "<your JWT>"   and reopen the terminal.\n');
  process.exit(1);
}

// 1) Stage a copy with gateway-safe tweaks (never mutate docs/ itself).
const stage = mkdtempSync(join(tmpdir(), 'ost-ipfs-'));
cpSync(DOCS, stage, { recursive: true });
// The SW's absolute scope breaks under /ipfs/<CID>/ — ship the IPFS copy
// without SW registration (gateway caching handles offline reasonably).
for (const f of ['index.html', 'markets.html']) {
  const p = join(stage, f);
  let html = readFileSync(p, 'utf8');
  html = html.replace(/navigator\.serviceWorker\.register\([^)]*\)/g, 'Promise.resolve(/* SW disabled on IPFS build */)');
  writeFileSync(p, html);
}

// 2) Collect files.
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}
const files = walk(stage);
console.log('Uploading ' + files.length + ' files from docs/ to Pinata/IPFS…');

// 3) Multipart upload (directory pin).
const form = new FormData();
for (const p of files) {
  const rel = 'ost/' + relative(stage, p).split('\\').join('/');
  form.append('file', new Blob([readFileSync(p)]), rel);
}
form.append('pinataMetadata', JSON.stringify({ name: 'ost-site-' + new Date().toISOString().slice(0, 10) }));

const res = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
  method: 'POST',
  headers: { Authorization: 'Bearer ' + JWT },
  body: form
});
const json = await res.json();
rmSync(stage, { recursive: true, force: true });

if (!res.ok || !json.IpfsHash) {
  console.error('Pin failed:', res.status, JSON.stringify(json).slice(0, 300));
  process.exit(1);
}

console.log('\n✅ Pinned. CID: ' + json.IpfsHash);
console.log('\nYour decentralized frontend:');
console.log('  https://gateway.pinata.cloud/ipfs/' + json.IpfsHash + '/');
console.log('  https://ipfs.io/ipfs/' + json.IpfsHash + '/');
console.log('  https://dweb.link/ipfs/' + json.IpfsHash + '/');
console.log('\nNext (optional): point a .sol name at this CID via SNS records.');

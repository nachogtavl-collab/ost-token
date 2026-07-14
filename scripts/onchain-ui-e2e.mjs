/* Prove the BROWSER can stake OST into the on-chain program vault. */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import {
  Connection, Keypair, PublicKey, SystemProgram, Transaction, LAMPORTS_PER_SOL, sendAndConfirmTransaction
} from '@solana/web3.js';
import {
  TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction, createTransferCheckedInstruction, getAccount
} from '@solana/spl-token';

const REPO = 'C:\\Users\\neyma\\OneDrive\\Desktop\\New folder\\ost-token';
const require = createRequire(import.meta.url);
const { chromium } = require(require.resolve('playwright', { paths: [REPO] }));

const RPC = 'https://api.devnet.solana.com';
const MINT = new PublicKey('383pTzoZ8Gp83dzk23ZnvLcfX2Sq32TAGN48CMQu2pAJ');
const DEC = 9;
const BASE = process.env.OST_BASE || 'http://127.0.0.1:9010/index.html';

const conn = new Connection(RPC, 'confirmed');
const authority = Keypair.fromSecretKey(Uint8Array.from(
  JSON.parse(readFileSync(process.env.USERPROFILE + '/.config/solana/id.json', 'utf8'))));

const ui = n => Number(n) / 10 ** DEC;
async function bal(owner) {
  const ata = getAssociatedTokenAddressSync(MINT, owner, true, TOKEN_2022_PROGRAM_ID);
  try { return ui((await getAccount(conn, ata, 'confirmed', TOKEN_2022_PROGRAM_ID)).amount); } catch { return 0; }
}

let fails = 0; const say = (ok, m) => { console.log((ok ? '  PASS ' : '  FAIL ') + m); if (!ok) fails++; };

// 1) Make a browser wallet and fund it with SOL + OST
const user = Keypair.generate();
{
  const tx = new Transaction();
  tx.add(SystemProgram.transfer({ fromPubkey: authority.publicKey, toPubkey: user.publicKey, lamports: 0.05 * LAMPORTS_PER_SOL }));
  const ata = getAssociatedTokenAddressSync(MINT, user.publicKey, true, TOKEN_2022_PROGRAM_ID);
  const src = getAssociatedTokenAddressSync(MINT, authority.publicKey, true, TOKEN_2022_PROGRAM_ID);
  tx.add(createAssociatedTokenAccountIdempotentInstruction(authority.publicKey, ata, user.publicKey, MINT, TOKEN_2022_PROGRAM_ID));
  tx.add(createTransferCheckedInstruction(src, MINT, ata, authority.publicKey, BigInt(25 * 10 ** DEC), DEC, [], TOKEN_2022_PROGRAM_ID));
  await sendAndConfirmTransaction(conn, tx, [authority]);
}
console.log('browser wallet:', user.publicKey.toBase58(), '=', await bal(user.publicKey), 'OST');

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const secret = Array.from(user.secretKey);
await ctx.addInitScript(([sk]) => {
  localStorage.setItem('ost_prefs', JSON.stringify({ lang: 'en', currency: 'USD' }));
  localStorage.setItem('ost.tour.completed', '1');
  localStorage.setItem('ost.compartments.guideSeen.v1', '1');
  sessionStorage.setItem('ost.welcome.seen.session', '1');
  // Seed the app's local browser wallet with our funded keypair (LOCAL_WALLET_STORAGE_KEY).
  localStorage.setItem('ost.localWallet.v1', JSON.stringify({ secretKey: sk }));
}, [secret]);

const page = await ctx.newPage();
const errs = []; page.on('pageerror', e => errs.push(String(e)));
await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 45000 });
await page.waitForTimeout(7000);

console.log('\n== 1 · module present + points at the deployed program ==');
const mod = await page.evaluate(() => ({
  present: !!window.OST_ONCHAIN,
  program: window.OST_ONCHAIN && window.OST_ONCHAIN.programId,
  authority: window.OST_ONCHAIN_AUTHORITY,
  hasWeb3: !!window.solanaWeb3
}));
say(mod.present && mod.program === 'F82m45QUAFJ4GtMsJrSFnWzDrjWdZjdzyh8HTPgTBHXr', `OST_ONCHAIN -> ${mod.program}`);

console.log('\n== 2 · the page derives the SAME market the crank opened ==');
const openAt = Math.floor(Date.now() / 1000 / 300) * 300;
const derived = await page.evaluate((o) => {
  const d = window.OST_ONCHAIN.derive(o);
  return { market: d.market.toBase58(), vault: d.vault.toBase58() };
}, openAt);
const { PublicKey: PK } = await import('@solana/web3.js');
const PROGRAM = new PK('F82m45QUAFJ4GtMsJrSFnWzDrjWdZjdzyh8HTPgTBHXr');
const b8 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const [expMarket] = PK.findProgramAddressSync([Buffer.from('market'), authority.publicKey.toBuffer(), b8(openAt)], PROGRAM);
say(derived.market === expMarket.toBase58(), `browser PDA ${derived.market.slice(0, 10)}… == crank PDA ${expMarket.toBase58().slice(0, 10)}…`);

console.log('\n== 3 · the market the crank opened is visible from the page ==');
const m = await page.evaluate(o => window.OST_ONCHAIN.marketFor(o).then(x => x && ({
  exists: x.exists, yes: x.yes, no: x.no, resolved: x.resolved, lockTs: x.lockTs
})), openAt);
say(m && m.exists, `on-chain market exists: yes=${m && m.yes} no=${m && m.no} resolved=${m && m.resolved}`);

console.log('\n== 4 · THE REAL TEST: the browser stakes OST into the program vault ==');
const vaultPk = new PK(derived.vault);
const vaultBefore = await (async () => { try { return ui((await getAccount(conn, vaultPk, 'confirmed', TOKEN_2022_PROGRAM_ID)).amount); } catch { return 0; } })();
const userBefore = await bal(user.publicKey);

const res = await page.evaluate(async (o) => {
  try { return await window.OST_ONCHAIN.placeBet(o, 'yes', 5); }
  catch (e) { return { err: e.message }; }
}, openAt);

if (res.err) { say(false, 'placeBet failed: ' + res.err); }
else {
  await new Promise(r => setTimeout(r, 4000));
  const vaultAfter = ui((await getAccount(conn, vaultPk, 'confirmed', TOKEN_2022_PROGRAM_ID)).amount);
  const userAfter = await bal(user.publicKey);
  console.log('   tx: https://explorer.solana.com/tx/' + res.signature + '?cluster=devnet');
  say(vaultAfter - vaultBefore === 5, `VAULT received the stake: ${vaultBefore} -> ${vaultAfter} OST (+${(vaultAfter - vaultBefore).toFixed(2)})`);
  say(userBefore - userAfter === 5, `user's OST really left the wallet: ${userBefore} -> ${userAfter}`);
  const m2 = await page.evaluate(o => window.OST_ONCHAIN.marketFor(o).then(x => ({ yes: x.yes, no: x.no, implied: window.OST_ONCHAIN.impliedYes(x) })), openAt);
  say(m2.yes >= 5, `on-chain YES pool now ${m2.yes} OST · implied YES ${(m2.implied * 100).toFixed(1)}% (pari-mutuel odds from the pools)`);
}

console.log('\n== 5 · no fatal errors ==');
const fatal = errs.filter(e => !/Failed to fetch|NetworkError|429|binance|WebSocket|Durable|mesh hub|overpass|tile/i.test(e));
say(fatal.length === 0, fatal.length ? fatal.slice(0, 3).join(' | ') : 'clean');

await browser.close();
console.log(fails ? `\n${fails} FAIL` : '\nBROWSER -> ON-CHAIN VERIFIED: the app stakes real OST into the program vault');
process.exit(fails ? 1 : 0);

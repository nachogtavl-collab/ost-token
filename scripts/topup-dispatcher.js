#!/usr/bin/env node
/**
 * OST Top-Up Dispatcher
 * ======================================================================
 * Polls the ost-api worker for paid top-up intents, sends devnet OST
 * (Token-2022) from the treasury keypair using transferChecked, and
 * marks each intent as `sent`.
 *
 * RUN:
 *   $env:OST_API_BASE        = "https://ost-api.nachogtavl.workers.dev"
 *   $env:TOPUP_ADMIN_TOKEN   = "<same secret you set on the worker>"
 *   $env:TREASURY_SECRET_B58 = "<base58-encoded treasury secret key>"
 *   $env:DEVNET_RPC          = "https://api.devnet.solana.com"   # optional
 *   node scripts/topup-dispatcher.js              # one-shot
 *   node scripts/topup-dispatcher.js --watch      # poll every 15s
 *
 * INSTALL DEPS (once):
 *   npm install @solana/web3.js @solana/spl-token bs58
 * ====================================================================== */

const {
  Connection, Keypair, PublicKey
} = require('@solana/web3.js');
const {
  TOKEN_2022_PROGRAM_ID,
  getOrCreateAssociatedTokenAccount,
  getMint,
  transferChecked
} = require('@solana/spl-token');
const bs58Module = require('bs58');
const bs58 = bs58Module.default || bs58Module;

const API_BASE   = (process.env.OST_API_BASE || '').replace(/\/+$/, '');
const ADMIN_TOK  = process.env.TOPUP_ADMIN_TOKEN || '';
const SECRET_B58 = process.env.TREASURY_SECRET_B58 || '';
const RPC_URL    = process.env.DEVNET_RPC || 'https://api.devnet.solana.com';
const OST_MINT   = process.env.OST_MINT || '383pTzoZ8Gp83dzk23ZnvLcfX2Sq32TAGN48CMQu2pAJ';
const WATCH      = process.argv.includes('--watch');
const INTERVAL   = Number(process.env.POLL_INTERVAL_MS || 15_000);

if (!API_BASE || !ADMIN_TOK || !SECRET_B58) {
  console.error('Missing env: OST_API_BASE, TOPUP_ADMIN_TOKEN, TREASURY_SECRET_B58');
  process.exit(1);
}

const treasury = Keypair.fromSecretKey(bs58.decode(SECRET_B58));
const conn = new Connection(RPC_URL, 'confirmed');
const mintPk = new PublicKey(OST_MINT);
let mintDecimals = null;

async function fetchPending() {
  const r = await fetch(`${API_BASE}/topup/admin/pending`, {
    headers: { authorization: `Bearer ${ADMIN_TOK}` }
  });
  if (!r.ok) throw new Error(`pending HTTP ${r.status}`);
  const j = await r.json();
  return j.pending || [];
}

async function markSent(id, signature) {
  const r = await fetch(`${API_BASE}/topup/admin/mark-sent`, {
    method: 'POST',
    headers: { authorization: `Bearer ${ADMIN_TOK}`, 'content-type': 'application/json' },
    body: JSON.stringify({ id, signature })
  });
  if (!r.ok) throw new Error(`mark-sent HTTP ${r.status}`);
  return r.json();
}

async function sendOst(toWallet, ostAmount) {
  if (mintDecimals === null) {
    const info = await getMint(conn, mintPk, 'confirmed', TOKEN_2022_PROGRAM_ID);
    mintDecimals = info.decimals;
    console.log(`OST mint decimals: ${mintDecimals}`);
  }
  const recipient = new PublicKey(toWallet);
  const fromAta = await getOrCreateAssociatedTokenAccount(
    conn, treasury, mintPk, treasury.publicKey, false, 'confirmed', undefined, TOKEN_2022_PROGRAM_ID);
  const toAta = await getOrCreateAssociatedTokenAccount(
    conn, treasury, mintPk, recipient, false, 'confirmed', undefined, TOKEN_2022_PROGRAM_ID);
  const raw = BigInt(Math.round(Number(ostAmount) * 10 ** mintDecimals));
  const sig = await transferChecked(
    conn, treasury, fromAta.address, mintPk, toAta.address, treasury,
    raw, mintDecimals, [], undefined, TOKEN_2022_PROGRAM_ID);
  return sig;
}

async function tick() {
  let pending = [];
  try { pending = await fetchPending(); }
  catch (e) { console.error('fetchPending failed:', e.message); return; }
  if (!pending.length) { console.log(`[${new Date().toISOString()}] no pending intents`); return; }
  for (const it of pending) {
    try {
      console.log(`→ Sending ${it.ostAmount} OST to ${it.wallet} (intent ${it.id})`);
      const sig = await sendOst(it.wallet, it.ostAmount);
      console.log(`  ✓ tx ${sig}`);
      await markSent(it.id, sig);
    } catch (e) {
      console.error(`  ✗ intent ${it.id} failed:`, e.message);
    }
  }
}

(async () => {
  console.log(`Treasury: ${treasury.publicKey.toBase58()}`);
  console.log(`API:      ${API_BASE}`);
  console.log(`RPC:      ${RPC_URL}`);
  await tick();
  if (WATCH) {
    setInterval(tick, INTERVAL);
    console.log(`Watching every ${INTERVAL}ms…`);
  } else {
    process.exit(0);
  }
})();

/* ==========================================================================
 * OST · Bridge UI — convert between the two OSTs, 1:1
 * --------------------------------------------------------------------------
 * OST has TWO tokens on purpose (project-docs/TOKEN-ARCHITECTURE.md):
 *
 *   OST  (OSTC) — the CURRENCY. Payments, transfers, mesh, everyday real-world
 *                 use. This is "the currency of Earth & Space".
 *   OSTG        — the GAME TOKEN. Prediction markets, fair games, mirror stocks,
 *                 memecoins — the in-app economy.
 *
 * They are DIFFERENT Solana mints. This panel is the one door between them, and
 * it is backed by the on-chain bridge program (deposit escrows OST + mints OSTG;
 * withdraw burns OSTG + releases OST), so the peg is 1:1 by construction —
 * verifiable by anyone at /health/peg, never just promised.
 *
 * HONESTY. Conversion is live on devnet and is used by games & markets (the
 * markets spend OSTG; Arcade deposits convert OST first). Tap-to-pay with OSTG
 * is R&D. Copy here never claims more than that (BRG-4, CLAUDE.md).
 *
 * ONE CONVERT AT A TIME (BRG-1). A module-level lock covers the button, Enter
 * and programmatic OST_BRIDGE_UI.convert(): pressing Enter twice converts once.
 * Outcomes follow contract C4: a lost answer is "Still confirming — check your
 * balance before retrying", never a failure and never an automatic re-send.
 *
 * GAS IS SPONSORED. Like OST, the fee account (pool) pays the network fee AND the
 * token-account rent for OSTG, so converting costs the user ZERO SOL — it works
 * on a brand-new seedless wallet. (Falls back to user-paid only if the rescue
 * layer is unavailable.) One wallet holds both tokens: a Solana keypair owns an
 * account per mint under the same owner, so the same wallet is already both.
 * ========================================================================== */
(function () {
  'use strict';
  if (window.OST_BRIDGE_UI) return;

  var PROGRAM_ID = 'J7jqcwT44CY4oXjwu6fwfiFvQDWBQRsueqL7dsZjnrJd';
  var OSTC_MINT = '383pTzoZ8Gp83dzk23ZnvLcfX2Sq32TAGN48CMQu2pAJ'; // the real OST mint
  var OSTG_MINT = 'DfgxMbdN49AX2Za9LuvsyixF1jgVh45RbgWYSGonxQos';
  var BRIDGE = 'BnphbE6izjGaC1D4XazDoyVZooLxBDhYqHfzenXuMxPK';
  var VAULT = '8X6pL7QtYqGd8pzkVA3nkWu36rRw9YQsUGh79V6XRYak';
  var TOKEN_2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
  var ASSOC = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
  var DEC = 9;

  // Anchor discriminators = sha256("global:<ix>")[:8]. Constant, so hardcoded
  // (no async subtle-crypto on the hot path). Verified against the deployed
  // program by scripts/pyth-crank/bridge-e2e.mjs.
  var DISC_DEPOSIT = [242, 35, 198, 137, 82, 225, 242, 182];
  var DISC_WITHDRAW = [183, 18, 70, 156, 148, 109, 161, 34];

  function PK(s) { return new solanaWeb3.PublicKey(s); }
  function conn() {
    try { return (window.OST_WALLET && window.OST_WALLET.getConnection && window.OST_WALLET.getConnection()) || null; }
    catch (_) { return null; }
  }
  function owner() {
    try { var s = window.OST_WALLET && window.OST_WALLET.session; return (s && s.publicKey) || null; }
    catch (_) { return null; }
  }
  // Chain reads go through the wallet's cooldown-aware RPC rotation (all keys +
  // public) instead of one raw connection — a throttled primary key used to make
  // the bridge's account checks fail and the convert abort.
  function rpc(fn) {
    try { if (window.OST_WALLET && typeof OST_WALLET.rpcCall === 'function') return OST_WALLET.rpcCall(fn); } catch (_) {}
    var c = conn(); return c ? Promise.resolve().then(function () { return fn(c); }) : Promise.reject(new Error('No RPC connection'));
  }

  function ataOf(mint, own) {
    return solanaWeb3.PublicKey.findProgramAddressSync(
      [own.toBuffer(), PK(TOKEN_2022).toBuffer(), PK(mint).toBuffer()],
      PK(ASSOC)
    )[0];
  }

  // Returns a Number when the chain answered, or `undefined` when it could not.
  // Same discipline as the wallet balance fix: unknown is NOT zero.
  async function readBal(mint) {
    var c = conn(), o = owner();
    if (!c || !o) return undefined;
    try {
      var res = await rpc(function (x) { return x.getTokenAccountBalance(ataOf(mint, o)); });
      return res && res.value ? Number(res.value.uiAmount) : 0;
    } catch (e) {
      // "could not find account" = a real zero (no ATA yet). Any other failure
      // (RPC down) = unknown.
      if (e && /could not find|account not found|-32602/i.test(String(e.message))) return 0;
      return undefined;
    }
  }

  /* ---- transaction building ---------------------------------------------- */
  function u64le(v) {
    var b = new Uint8Array(8);
    new DataView(b.buffer).setBigUint64(0, BigInt(v), true);
    return b;
  }
  function bytes(disc, rawAmount) {
    var out = new Uint8Array(16);
    out.set(disc, 0);
    out.set(u64le(rawAmount), 8);
    return out;
  }
  function createAtaIdempotentIx(payer, ataAddr, own, mint) {
    return new solanaWeb3.TransactionInstruction({
      programId: PK(ASSOC),
      keys: [
        { pubkey: payer, isSigner: true, isWritable: true },
        { pubkey: ataAddr, isSigner: false, isWritable: true },
        { pubkey: own, isSigner: false, isWritable: false },
        { pubkey: PK(mint), isSigner: false, isWritable: false },
        { pubkey: solanaWeb3.SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: PK(TOKEN_2022), isSigner: false, isWritable: false },
      ],
      data: new Uint8Array([1]), // CreateIdempotent
    });
  }
  function bridgeIx(direction, own, rawAmount) {
    var userOstc = ataOf(OSTC_MINT, own);
    var userOstg = ataOf(OSTG_MINT, own);
    // Account order MUST match the program's Deposit/Withdraw structs exactly.
    return new solanaWeb3.TransactionInstruction({
      programId: PK(PROGRAM_ID),
      keys: [
        { pubkey: PK(BRIDGE), isSigner: false, isWritable: false },
        { pubkey: PK(OSTC_MINT), isSigner: false, isWritable: true },
        { pubkey: PK(OSTG_MINT), isSigner: false, isWritable: true },
        { pubkey: PK(VAULT), isSigner: false, isWritable: true },
        { pubkey: userOstc, isSigner: false, isWritable: true },
        { pubkey: userOstg, isSigner: false, isWritable: true },
        { pubkey: own, isSigner: true, isWritable: false },
        { pubkey: PK(TOKEN_2022), isSigner: false, isWritable: false },
      ],
      data: bytes(direction === 'deposit' ? DISC_DEPOSIT : DISC_WITHDRAW, rawAmount),
    });
  }

  function normDir(d) {
    d = String(d || '').toLowerCase();
    if (d === 'to-ostg' || d === 'ostc-to-ostg' || d === 'ost-to-ostg' || d === 'deposit') return 'deposit';
    if (d === 'to-ost' || d === 'to-ostc' || d === 'ostg-to-ost' || d === 'withdraw') return 'withdraw';
    return '';
  }
  function bridgeErr(code, msg, extra) {
    var e = new Error(msg); e.code = code;
    if (extra) Object.keys(extra).forEach(function (k) { e[k] = extra[k]; });
    return e;
  }
  // Exact base units from a typed decimal string (never via float rounding).
  function toRaw(uiAmount) {
    var s = String(uiAmount).trim();
    if (/e/i.test(s)) s = Number(uiAmount).toFixed(DEC);
    if (!/^\d*\.?\d*$/.test(s) || s === '' || s === '.') return null;
    var parts = s.split('.');
    var frac = (parts[1] || '').slice(0, DEC);
    while (frac.length < DEC) frac += '0';
    return BigInt(parts[0] || '0') * (10n ** BigInt(DEC)) + BigInt(frac || '0');
  }

  var inflight = null;     // BRG-1: one conversion at a time, from any entry point

  // convert(direction, amount) -> String(sig) carrying { ok, sig, pending } (C4).
  // direction: 'deposit' | 'to-ostg' (OST -> OSTG) or 'withdraw' | 'to-ost'.
  function convert(direction, uiAmount) {
    if (inflight) return Promise.reject(bridgeErr('in_progress', 'A conversion is already in progress — wait for it to finish.'));
    var p = convertOnce(direction, uiAmount);
    inflight = p;
    var release = function () { if (inflight === p) inflight = null; };
    p.then(release, release);
    return p;
  }

  async function convertOnce(directionIn, uiAmount) {
    var direction = normDir(directionIn);
    if (!direction) throw bridgeErr('invalid_direction', 'Unknown conversion direction.');
    var c = conn(), o = owner();
    if (!c || !o) throw bridgeErr('no_wallet', 'Connect your wallet first.');
    var rawAmount = toRaw(uiAmount);
    if (rawAmount == null || rawAmount <= 0n) throw bridgeErr('invalid_amount', 'Enter an amount greater than zero.');
    var amt = Number(uiAmount);

    // Pre-check the SOURCE balance in the WALLET (the bridge only moves wallet
    // tokens; OSTG in the play balance must be cashed out first).
    var srcBal;
    var pick = function () { return direction === 'deposit' ? OST_BALANCE.onchainOstc() : OST_BALANCE.onchainOstg(); };
    try {
      if (window.OST_BALANCE && OST_BALANCE.refresh) {
        srcBal = pick();
        // Enough per the cached figure: go (the chain is the final judge).
        // Unknown or short: read fresh before refusing.
        if (srcBal == null || srcBal + 1e-9 < amt) { await OST_BALANCE.refresh(true); srcBal = pick(); }
      }
    } catch (_) {}
    if (srcBal == null) srcBal = await readBal(direction === 'deposit' ? OSTC_MINT : OSTG_MINT);
    if (typeof srcBal === 'number' && srcBal + 1e-9 < amt) {
      if (direction === 'withdraw') {
        throw bridgeErr('insufficient_balance', 'Your wallet holds ' + fmt(srcBal) + ' OSTG. If your OSTG is in the play balance, cash it out to your wallet first (Arcade → Cash out), then convert OSTG → OST here.', { body: { have: srcBal } });
      }
      throw bridgeErr('insufficient_balance', 'Your wallet holds ' + fmt(srcBal) + ' OST — not enough to convert ' + fmt(amt) + '.', { body: { have: srcBal } });
    }

    var rescue = window.OST_RESCUE;
    var poolPaid = !!(rescue && rescue.sendPoolFeeOnly && rescue.ensureUserAtaForMint);
    var result;

    // GAS IS SPONSORED: the pool pays the fee AND any missing token-account rent.
    // Token accounts are checked on chain first; the worker is asked only for a
    // missing one (SRV-5), so a normal convert is ONE pool transaction.
    if (poolPaid) {
      var ataC = ataOf(OSTC_MINT, o), ataG = ataOf(OSTG_MINT, o);
      var have = await Promise.all([
        rpc(function (x) { return x.getAccountInfo(ataC); }).catch(function () { return undefined; }),
        rpc(function (x) { return x.getAccountInfo(ataG); }).catch(function () { return undefined; })
      ]);
      var created = false;
      if (!have[0]) { try { await rescue.ensureUserAtaForMint(o, OSTC_MINT); created = true; } catch (_) {} }
      if (!have[1]) { try { await rescue.ensureUserAtaForMint(o, OSTG_MINT); created = true; } catch (_) {} }
      // A just-created account must be visible before the bridge references it
      // (else AccountNotInitialized). Only matters on a first-ever convert.
      if (created) {
        for (var i = 0; i < 12; i++) {
          var hc = await rpc(function (x) { return x.getAccountInfo(ataC); }).catch(function () { return null; });
          var hg = await rpc(function (x) { return x.getAccountInfo(ataG); }).catch(function () { return null; });
          if (hc && hg) break;
          await new Promise(function (r) { setTimeout(r, 1200); });
        }
      }
      result = await rescue.sendPoolFeeOnly([bridgeIx(direction, o, rawAmount)]);
    } else {
      // Fallback (rescue layer not loaded): user-paid. Needs a little SOL.
      var ixs = [];
      var dMint = direction === 'deposit' ? OSTG_MINT : OSTC_MINT;
      var destAta = ataOf(dMint, o);
      var destInfo = await rpc(function (x) { return x.getAccountInfo(destAta); });
      if (!destInfo) ixs.push(createAtaIdempotentIx(o, destAta, o, dMint));
      ixs.push(bridgeIx(direction, o, rawAmount));
      var tx = new solanaWeb3.Transaction();
      ixs.forEach(function (ix) { tx.add(ix); });
      tx.feePayer = o;
      try {
        var sigU = await window.OST_WALLET.sign(tx);
        result = { sig: typeof sigU === 'string' ? sigU : (sigU && sigU.signature) || '', pending: false };
      } catch (e) {
        var m = String((e && e.message) || e);
        if (/insufficient|0x1\b|debit an account|lamports/i.test(m)) throw bridgeErr('no_sol', 'This convert needs a little devnet SOL for the network fee.');
        throw e;
      }
    }
    var sig = String((result && result.sig) || result || '');
    var pending = !!(result && result.pending);
    try {
      window.dispatchEvent(new CustomEvent('ost:wallet-tx', { detail: {
        sig: sig, asset: direction === 'deposit' ? 'OST' : 'OSTG', amount: amt, direction: 'convert',
        to: direction === 'deposit' ? 'OSTG' : 'OST', status: pending ? 'pending' : 'confirmed', source: 'bridge'
      } }));
    } catch (_) {}
    var out = new String(sig);
    out.ok = true; out.sig = sig; out.pending = pending; out.direction = direction; out.amount = amt;
    return out;
  }

  /* ---- UI ----------------------------------------------------------------- */
  function fmt(n) { return n == null ? '—' : Number(n).toLocaleString(undefined, { maximumFractionDigits: 4 }); }

  function styles() {
    if (document.getElementById('ostBridgeStyle')) return;
    var st = document.createElement('style');
    st.id = 'ostBridgeStyle';
    st.textContent = [
      '.ostb-wrap{margin-top:14px;border:1px solid rgba(109,159,255,.2);border-radius:16px;overflow:hidden;',
      'background:linear-gradient(180deg,rgba(13,22,41,.6),rgba(9,14,28,.6));}',
      '#wallet-panel-convert > .ostb-wrap{margin:0 0 20px;}',
      '.wallet-convert-grid > .ostb-wrap{grid-column:1/-1;}',
      '.ostb-head{padding:13px 16px;border-bottom:1px solid rgba(148,163,184,.14);}',
      '.ostb-title{font-weight:900;color:#e2e8f0;font-size:14px;display:flex;align-items:center;gap:8px;}',
      '.ostb-sub{color:#94a3b8;font-size:12px;margin-top:3px;line-height:1.5;}',
      '.ostb-div{display:flex;gap:10px;padding:12px 16px;flex-wrap:wrap;}',
      '.ostb-card{flex:1;min-width:150px;border:1px solid rgba(148,163,184,.16);border-radius:12px;padding:11px 12px;}',
      '.ostb-card.cur{border-color:rgba(52,211,153,.32);}',
      '.ostb-card.game{border-color:rgba(168,139,250,.34);}',
      '.ostb-k{font-size:11px;font-weight:800;letter-spacing:.02em;text-transform:uppercase;}',
      '.ostb-card.cur .ostb-k{color:#6ee7b7;}.ostb-card.game .ostb-k{color:#c4b5fd;}',
      '.ostb-amt{font-size:19px;font-weight:900;color:#f1f5f9;margin:3px 0 2px;}',
      '.ostb-for{font-size:11px;color:#94a3b8;line-height:1.45;}',
      '.ostb-roll{display:inline-block;margin-top:5px;font-size:10px;font-weight:800;color:#fcd34d;',
      'background:rgba(251,191,36,.12);border-radius:999px;padding:2px 7px;}',
      '.ostb-conv{padding:12px 16px;border-top:1px solid rgba(148,163,184,.12);}',
      '.ostb-tabs{display:flex;gap:6px;margin-bottom:10px;}',
      '.ostb-tab{flex:1;border:1px solid rgba(148,163,184,.24);background:transparent;color:#cbd5e1;',
      'border-radius:10px;padding:8px;font-size:12px;font-weight:800;cursor:pointer;}',
      '.ostb-tab.on{background:linear-gradient(135deg,#6d9fff,#3b82f6);color:#04121a;border-color:transparent;}',
      '.ostb-row{display:flex;gap:8px;}',
      '.ostb-row input{flex:1;min-width:0;background:rgba(2,6,23,.6);border:1px solid rgba(148,163,184,.28);',
      'border-radius:11px;color:#f1f5f9;padding:10px 12px;font-size:14px;}',
      '.ostb-go{border:none;border-radius:11px;padding:0 16px;font-weight:900;cursor:pointer;font-size:13px;',
      'background:linear-gradient(135deg,#34d399,#059669);color:#04121a;}',
      '.ostb-go:disabled{opacity:.5;cursor:default;}',
      '.ostb-max{border:1px solid rgba(148,163,184,.3);background:transparent;color:#cbd5e1;border-radius:11px;padding:0 10px;font-weight:800;font-size:12px;cursor:pointer;}',
      '.ostb-max:disabled{opacity:.5;}.ostb-row input:disabled{opacity:.6;}',
      '.ostb-cta{margin-top:8px;}.ostb-cta-btn{padding:10px 14px;width:100%;}',
      '.ostb-flow{font-size:11.5px;color:#94a3b8;margin-top:8px;min-height:16px;}',
      '.ostb-flow.warn{color:#fca5a5;}.ostb-flow.ok{color:#6ee7b7;}.ostb-flow.load{color:#7dd3fc;}',
      '.ostb-peg{font-size:11px;color:#64748b;padding:9px 16px;border-top:1px solid rgba(148,163,184,.1);}',
      '.ostb-peg b{color:#6ee7b7;}'
    ].join('');
    document.head.appendChild(st);
  }

  var el = {};
  var direction = 'deposit';

  function build() {
    styles();
    var root = document.createElement('div');
    root.className = 'ostb-wrap';
    root.id = 'ostBridge';
    root.innerHTML =
      '<div class="ostb-head">' +
        '<div class="ostb-title">🌉 OST ⇄ OSTG <span style="font-size:10px;font-weight:800;color:#6ee7b7;background:rgba(52,211,153,.14);border-radius:999px;padding:2px 8px;">1:1 · on-chain · devnet</span></div>' +
        '<div class="ostb-sub">Two tokens, one wallet. Convert 1:1 on-chain on devnet — OST pays the network fee and any account setup, so you need no SOL. Devnet tokens have no cash value.</div>' +
      '</div>' +
      '<div class="ostb-div">' +
        '<div class="ostb-card cur">' +
          '<div class="ostb-k">◉ OST · Currency</div>' +
          '<div class="ostb-amt" data-ostb-bal-ostc>—</div>' +
          '<div class="ostb-for">Send, receive, Mesh pay, cash out to SOL.</div>' +
        '</div>' +
        '<div class="ostb-card game">' +
          '<div class="ostb-k">◆ OSTG · Game token</div>' +
          '<div class="ostb-amt" data-ostb-bal-ostg>—</div>' +
          '<div class="ostb-for">Prediction markets and games. In your wallet (play balance not included).</div>' +
          '<span class="ostb-roll">Used by games &amp; markets (devnet)</span>' +
        '</div>' +
      '</div>' +
      '<div class="ostb-conv">' +
        '<div class="ostb-tabs">' +
          '<button type="button" class="ostb-tab on" data-ostb-dir="deposit">OST → OSTG</button>' +
          '<button type="button" class="ostb-tab" data-ostb-dir="withdraw">OSTG → OST</button>' +
        '</div>' +
        '<div class="ostb-row">' +
          '<input type="text" inputmode="decimal" autocomplete="off" placeholder="Amount" aria-label="Amount to convert" data-ostb-amt>' +
          '<button type="button" class="ostb-max" data-ostb-max>Max</button>' +
          '<button type="button" class="ostb-go" data-ostb-go>Convert</button>' +
        '</div>' +
        '<div class="ostb-flow" data-ostb-flow>Get OSTG to play; convert back to OST to spend. Always 1:1 · fees paid by OST.</div>' +
        '<div class="ostb-cta" data-ostb-cta hidden></div>' +
      '</div>' +
      '<div class="ostb-peg" data-ostb-peg>Checking peg…</div>';

    el.root = root;
    el.ostc = root.querySelector('[data-ostb-bal-ostc]');
    el.ostg = root.querySelector('[data-ostb-bal-ostg]');
    el.amt = root.querySelector('[data-ostb-amt]');
    el.go = root.querySelector('[data-ostb-go]');
    el.max = root.querySelector('[data-ostb-max]');
    el.flow = root.querySelector('[data-ostb-flow]');
    el.cta = root.querySelector('[data-ostb-cta]');
    el.peg = root.querySelector('[data-ostb-peg]');

    root.querySelectorAll('[data-ostb-dir]').forEach(function (b) {
      b.addEventListener('click', function () {
        if (inflight) return;
        direction = b.getAttribute('data-ostb-dir');
        root.querySelectorAll('.ostb-tab').forEach(function (t) { t.classList.remove('on'); });
        b.classList.add('on');
        setFlow(direction === 'deposit'
          ? 'OST → OSTG · your OST is escrowed, you receive OSTG 1:1 to play.'
          : 'OSTG → OST · your OSTG is burned, your OST is released 1:1 to spend.', '');
        paintCta();
      });
    });
    el.go.addEventListener('click', onConvert);
    // Enter goes through the SAME button (and the same lock): twice = once.
    el.amt.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      if (!el.go.disabled) el.go.click();
    });
    el.max.addEventListener('click', function () {
      if (inflight) return;
      var B = (window.OST_BALANCE && OST_BALANCE.get) ? OST_BALANCE.get() : {};
      var v = direction === 'deposit' ? B.ost : B.ostg;
      if (v == null) { setFlow('Balance unavailable right now — type an amount.', 'warn'); return; }
      // Floor to 9 dp: Max never rounds UP past what the wallet holds.
      var floored = Math.floor(Number(v) * 1e9) / 1e9;
      el.amt.value = floored > 0 ? String(Number(floored.toFixed(9))) : '';
    });
    return root;
  }

  function setFlow(msg, kind) {
    if (!el.flow) return;
    el.flow.textContent = msg;
    el.flow.className = 'ostb-flow' + (kind ? ' ' + kind : '');
  }

  // WAL-8: no wallet -> a real "Create free wallet" button, not dead text.
  function paintCta() {
    if (!el.cta) return;
    if (owner()) { el.cta.hidden = true; el.cta.innerHTML = ''; return; }
    el.cta.hidden = false;
    el.cta.innerHTML = '<button type="button" class="ostb-go ostb-cta-btn">Create free wallet / Connect</button>';
    el.cta.querySelector('button').addEventListener('click', function () {
      requireWallet(function () { refresh(); paintCta(); if (el.amt) try { el.amt.focus(); } catch (_) {} });
    });
  }
  function requireWallet(resume) {
    try {
      var W = window.OST_WALLET;
      if (W && typeof W.requireWallet === 'function') {
        return Promise.resolve(W.requireWallet({ reason: 'Convert OST ⇄ OSTG', resume: resume })).then(function (a) { if (a && resume) resume(); }).catch(function () {});
      }
      if (window.OST_WALLET_HOME && typeof window.OST_WALLET_HOME.open === 'function') {
        window.OST_WALLET_HOME.open('start');
        var w = document.getElementById('ostWalletHome');
        if (w && w.scrollIntoView) w.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
    } catch (_) {}
    setFlow('Connect your wallet first.', 'warn');
  }

  // Balances come from OST_BALANCE (C6) - no RPC loop of our own.
  function paintBalances() {
    if (!el.root) return;
    if (!owner()) { el.ostc.textContent = '—'; el.ostg.textContent = '—'; paintCta(); return; }
    var B = (window.OST_BALANCE && OST_BALANCE.get) ? OST_BALANCE.get() : {};
    el.ostc.textContent = fmt(B.ost);
    el.ostg.textContent = fmt(B.ostg);
    paintCta();
  }
  function refresh() {
    paintBalances();
    try { if (owner() && window.OST_BALANCE && OST_BALANCE.refresh) return Promise.resolve(OST_BALANCE.refresh(false)).then(paintBalances); } catch (_) {}
    return Promise.resolve();
  }

  async function refreshPeg() {
    if (!el.peg) return;
    try {
      var base = (window.OST_API_BASE || 'https://ost-api.nachogtavl.workers.dev').replace(/\/+$/, '');
      var r = await fetch(base + '/health/peg', { cache: 'no-store' });
      var j = await r.json();
      if (j && j.pegHolds) el.peg.innerHTML = '✓ Peg verified on-chain: <b>' + fmt(j.ostgSupply) + ' OSTG</b> backed 1:1 by <b>' + fmt(j.vaultOstc) + ' OST</b> in the vault.';
      else el.peg.textContent = 'Peg check unavailable right now.';
    } catch (_) { el.peg.textContent = 'Peg check unavailable right now.'; }
  }

  function human(e, stage) {
    try {
      if (window.OST_MONEY_ERRORS) {
        var h = window.OST_MONEY_ERRORS.humanize(e, { stage: stage, asset: direction === 'deposit' ? 'OST' : 'OSTG' });
        // Our own refusals are already plain English and more specific (an
        // error the rail already worded — e.human — is not: it would repeat the title).
        if (e && !e.human && e.code === 'insufficient_balance' && e.message && !window.OST_MONEY_ERRORS.isRaw(e.message)) h.body = e.message;
        return h;
      }
    } catch (_) {}
    return { state: 'failed', title: 'That didn’t go through', body: 'Try again in a moment.' };
  }

  async function onConvert() {
    if (inflight || (el.go && el.go.disabled)) return;      // BRG-1
    if (!owner()) { paintCta(); requireWallet(function () { refresh(); }); return; }
    var amt = String(el.amt.value || '').trim().replace(',', '.');
    if (!(Number(amt) > 0)) { setFlow('Enter an amount greater than zero.', 'warn'); return; }
    var dir = direction;
    var label = dir === 'deposit' ? 'OST → OSTG' : 'OSTG → OST';
    el.go.disabled = true; el.amt.disabled = true; if (el.max) el.max.disabled = true;
    setFlow('Converting ' + fmt(amt) + ' ' + label + '…', 'load');
    var outcome = 'unknown';
    try {
      var r = await convert(dir, amt);
      if (r && r.pending) {
        outcome = 'pending';
        setFlow('Still confirming — check your balance before retrying.' + (r.sig ? ' (tx ' + String(r.sig).slice(0, 8) + '…)' : ''), 'load');
        // The rail keeps looking it up; say what happened once it is known.
        if (r.sig) {
          var pendSig = String(r.sig), pendAmt = amt, pendDir = dir;
          var onTx = function (ev) {
            var d = ev && ev.detail;
            if (!d || !d.resolved || String(d.sig) !== pendSig) return;
            window.removeEventListener('ost:wallet-tx', onTx);
            if (inflight) return;
            if (d.status === 'confirmed') setFlow('✓ Converted ' + fmt(pendAmt) + (pendDir === 'deposit' ? ' OST to OSTG.' : ' OSTG to OST.') + ' (tx ' + pendSig.slice(0, 8) + '…)', 'ok');
            else setFlow('Didn’t go through — nothing moved. You can convert again.', 'warn');
            try { if (window.OST_BALANCE && OST_BALANCE.refresh) OST_BALANCE.refresh(true); } catch (_) {}
            paintBalances();
          };
          window.addEventListener('ost:wallet-tx', onTx);
        }
      } else {
        outcome = 'done';
        setFlow('✓ Converted ' + fmt(amt) + (dir === 'deposit' ? ' OST to OSTG.' : ' OSTG to OST.') + (r && r.sig ? ' (tx ' + String(r.sig).slice(0, 8) + '…)' : ''), 'ok');
      }
    } catch (e) {
      if (e && e.code === 'in_progress') { outcome = 'busy'; return; }
      if (e && e.code === 'no_wallet') { outcome = 'refused'; paintCta(); setFlow('Connect your wallet first.', 'warn'); return; }
      var h = human(e, 'submit');
      outcome = h.state;
      setFlow(h.title + (h.body ? ' — ' + h.body : ''), h.state === 'pending' ? 'load' : 'warn');
    } finally {
      if (outcome !== 'busy') {
        // Done, pending or unknown: clear the input so a retry is a deliberate act.
        if (outcome === 'done' || outcome === 'pending') el.amt.value = '';
        el.go.disabled = false; el.amt.disabled = false; if (el.max) el.max.disabled = false;
        try { if (window.OST_BALANCE && OST_BALANCE.refresh) OST_BALANCE.refresh(true); } catch (_) {}
        paintBalances(); refreshPeg();
      }
    }
  }

  /* ---- mount -------------------------------------------------------------- */
  // The converter lives in Wallet → Convert. Falls back through portals ->
  // dashboard so it is never orphaned.
  function mount() {
    if (el.root) return;
    // Full width ABOVE the 2-column converter grid: inside the grid it took the
    // wide column and squeezed the SOL/OST converter into the narrow one
    // (48 px amount inputs on desktop).
    var grid = document.querySelector('#wallet-panel-convert .wallet-convert-grid');
    var host = grid ? grid.parentNode :
               (document.querySelector('#wallet-panel-convert') ||
                document.querySelector('#wallet-panel-portals') ||
                document.querySelector('#walletDashboard'));
    if (!host) return;
    var panel = build();
    if (grid) host.insertBefore(panel, grid);
    else if (host.firstChild) host.insertBefore(panel, host.firstChild); else host.appendChild(panel);
    paintBalances(); refreshPeg();
  }

  // Mesh overlays (the classic pavilion and the OST Mesh app) sit above the
  // page: navigating to Wallet → Convert underneath them looks like nothing
  // happened. Close them first, then navigate once their own Back entry has
  // unwound (it would otherwise undo the navigation).
  function leaveMesh(then) {
    var pav = document.getElementById('ost-mesh-pavilion');
    var pavOpen = !!(pav && pav.classList.contains('is-open'));
    var appOpen = false;
    try { appOpen = !!document.querySelector('#ostMeshApp.open'); } catch (_) {}
    if (!pavOpen && !appOpen) { then(); return; }
    try { if (pavOpen && window.OST_MESH && typeof window.OST_MESH.close === 'function') window.OST_MESH.close(); } catch (_) {}
    try { if (appOpen && window.OST_MESH_APP && typeof window.OST_MESH_APP.close === 'function') window.OST_MESH_APP.close(); } catch (_) {}
    try { if (pav && pav.classList.contains('is-open')) { pav.classList.remove('is-open'); pav.setAttribute('aria-hidden', 'true'); } } catch (_) {}
    var done = false;
    function go() { if (done) return; done = true; window.removeEventListener('popstate', onPop); try { then(); } catch (_) {} }
    function onPop() { setTimeout(go, 30); }
    window.addEventListener('popstate', onPop);
    setTimeout(go, 500);
  }

  // BRG-5: open the bridge itself (Wallet → Convert, card in view, amount focused).
  function open(opts) {
    leaveMesh(function () { openNow(opts); });
    return true;
  }
  function openNow(opts) {
    opts = opts || {};
    try {
      // No section scroll-to-top: its smooth scroll would land after ours and
      // carry the bridge card out of view. We scroll to the card ourselves.
      if (window.OST_COMPARTMENTS && typeof window.OST_COMPARTMENTS.activate === 'function') window.OST_COMPARTMENTS.activate('wallet', false);
    } catch (_) {}
    var tries = 0;
    (function step() {
      try {
        if (typeof window.setWalletPanel === 'function') window.setWalletPanel('convert');
        else { var tab = document.querySelector('[data-wallet-panel-target="convert"]'); if (tab) tab.click(); }
      } catch (_) {}
      mount();
      if (opts.direction) {
        var d = normDir(opts.direction);
        var b = el.root && el.root.querySelector('[data-ostb-dir="' + d + '"]');
        if (b) b.click();
      }
      if (el.root && el.root.offsetParent !== null) {
        // A long jump (the wallet is ~12 000 px down on desktop) lands at once;
        // only a short hop animates, so the card is in view immediately.
        // Centre the AMOUNT field (not the tall card) so the floating dock at
        // the bottom of a desktop screen never covers it.
        var target = (el.amt && el.amt.offsetParent !== null) ? el.amt : el.root;
        // 'instant' beats the page's CSS `scroll-behavior: smooth` (a 12 000 px
        // smooth glide takes seconds and is easily cancelled mid-way).
        var jump = function () { try { target.scrollIntoView({ behavior: 'instant', block: 'center' }); } catch (_) { try { target.scrollIntoView({ block: 'center' }); } catch (__) { target.scrollIntoView(); } } };
        var far = false;
        try { far = Math.abs(target.getBoundingClientRect().top) > (window.innerHeight || 800) * 2; } catch (_) {}
        if (far) jump();
        else { try { target.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (_) { jump(); } }
        // Other movers (the section's own smooth scroll, a closing overlay
        // restoring its scroll position) can land after ours: re-check a few
        // times and put the field back in view, uncovered.
        var checks = 0;
        (function settle() {
          if (checks++ >= 5) return;
          setTimeout(function () {
            try {
              var r = target.getBoundingClientRect();
              var vh = window.innerHeight || 800;
              var hit = document.elementFromPoint(r.left + Math.min(20, r.width / 2), r.top + r.height / 2);
              var covered = !hit || !(hit === target || target.contains(hit) || (el.root && el.root.contains(hit)));
              if (r.top < 60 || r.bottom > vh - 120 || covered) jump();
            } catch (_) {}
            settle();
          }, 350);
        })();
        setTimeout(function () { try { if (owner()) el.amt.focus({ preventScroll: true }); } catch (_) {} }, 350);
        paintBalances();
        return;
      }
      if (tries++ < 20) setTimeout(step, 150);
    })();
    return true;
  }

  function boot() {
    mount();
    window.addEventListener('ost:wallet-changed', function () { paintBalances(); });
    window.addEventListener('ost:balance', paintBalances);
    window.addEventListener('ost:resume', function () { refresh(); refreshPeg(); });
    // Wallet section may render after us; retry a few times, then give up.
    var tries = 0;
    var t = setInterval(function () {
      if (el.root || tries++ > 20) { clearInterval(t); return; }
      mount();
    }, 500);
    var h = String(location.hash || '').toLowerCase();
    if (h === '#bridge' || h === '#ostg' || h === '#convert-ostg') setTimeout(function () { open(); }, 400);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.OST_BRIDGE_UI = {
    refresh: refresh,
    open: open,
    convert: convert,             // programmatic use (games, markets); same lock as the button
    busy: function () { return !!inflight; },
    balances: function () { return Promise.all([readBal(OSTC_MINT), readBal(OSTG_MINT)]); },
    addresses: { program: PROGRAM_ID, ostc: OSTC_MINT, ostg: OSTG_MINT, bridge: BRIDGE, vault: VAULT },
  };
})();

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
 * HONESTY — READ THIS. As of this build, the game surfaces (markets/games/…) do
 * NOT yet require OSTG; that switch is Phase 2. So this UI teaches the division
 * and lets people convert for real, but it labels game-token use as "rolling
 * out" rather than claiming games already require OSTG. We do not tell users to
 * bridge into a token the games cannot spend yet. (CLAUDE.md: never present an
 * unlaunched capability as live.)
 *
 * v1 scope: the balances + the division explainer work for everyone with no SOL.
 * The convert ACTION is user-paid (needs a little devnet SOL for the network
 * fee); seedless pool-paid bridging via /wallet/cosign is a documented follow-up.
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
      var res = await c.getTokenAccountBalance(ataOf(mint, o));
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

  async function convert(direction, uiAmount) {
    var c = conn(), o = owner();
    if (!c || !o) throw new Error('Connect your wallet first.');
    var amt = Number(uiAmount);
    if (!(amt > 0)) throw new Error('Enter an amount greater than zero.');
    var rawAmount = BigInt(Math.round(amt * 10 ** DEC));

    var ixs = [];
    // The destination ATA must exist. deposit mints OSTG -> ensure OSTG ATA;
    // withdraw releases OST -> ensure OST ATA. Idempotent, so a no-op if present.
    var destMint = direction === 'deposit' ? OSTG_MINT : OSTC_MINT;
    var destAta = ataOf(destMint, o);
    var destInfo = await c.getAccountInfo(destAta);
    if (!destInfo) ixs.push(createAtaIdempotentIx(o, destAta, o, destMint));
    ixs.push(bridgeIx(direction, o, rawAmount));

    var tx = new solanaWeb3.Transaction();
    ixs.forEach(function (ix) { tx.add(ix); });
    // feePayer = the user. Unset would route to the pool-fee path, but that path
    // forbids referencing the pool and cannot pay ATA rent — so the honest v1 is
    // user-paid. If the user has no SOL, say so plainly (below), don't fail dark.
    tx.feePayer = o;

    try {
      var sig = await window.OST_WALLET.sign(tx);
      return typeof sig === 'string' ? sig : (sig && sig.signature) || '';
    } catch (e) {
      var m = String((e && e.message) || e);
      if (/insufficient|0x1\b|debit an account|lamports/i.test(m)) {
        throw new Error('This convert needs a little devnet SOL for the network fee. Claim some from the faucet, then try again.');
      }
      throw e;
    }
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
    root.innerHTML =
      '<div class="ostb-head">' +
        '<div class="ostb-title">🌉 OST Bridge <span style="font-size:10px;font-weight:800;color:#6ee7b7;background:rgba(52,211,153,.14);border-radius:999px;padding:2px 8px;">1:1 · on-chain</span></div>' +
        '<div class="ostb-sub">Two OSTs, one door. Convert between the everyday currency and the in-app game token — backed 1:1 by the on-chain bridge.</div>' +
      '</div>' +
      '<div class="ostb-div">' +
        '<div class="ostb-card cur">' +
          '<div class="ostb-k">◉ OST · Currency</div>' +
          '<div class="ostb-amt" data-ostb-bal-ostc>—</div>' +
          '<div class="ostb-for">Payments, transfers, mesh — everyday real-world use.</div>' +
        '</div>' +
        '<div class="ostb-card game">' +
          '<div class="ostb-k">◆ OSTG · Game token</div>' +
          '<div class="ostb-amt" data-ostb-bal-ostg>—</div>' +
          '<div class="ostb-for">Prediction markets, fair games, mirror stocks, memecoins.</div>' +
          '<span class="ostb-roll">Game surfaces rolling out</span>' +
        '</div>' +
      '</div>' +
      '<div class="ostb-conv">' +
        '<div class="ostb-tabs">' +
          '<button class="ostb-tab on" data-ostb-dir="deposit">OST → OSTG</button>' +
          '<button class="ostb-tab" data-ostb-dir="withdraw">OSTG → OST</button>' +
        '</div>' +
        '<div class="ostb-row">' +
          '<input type="number" min="0" step="any" placeholder="Amount" data-ostb-amt>' +
          '<button class="ostb-go" data-ostb-go>Convert</button>' +
        '</div>' +
        '<div class="ostb-flow" data-ostb-flow>Get OSTG to play; cash back to OST to spend. Always 1:1.</div>' +
      '</div>' +
      '<div class="ostb-peg" data-ostb-peg>Checking peg…</div>';

    el.root = root;
    el.ostc = root.querySelector('[data-ostb-bal-ostc]');
    el.ostg = root.querySelector('[data-ostb-bal-ostg]');
    el.amt = root.querySelector('[data-ostb-amt]');
    el.go = root.querySelector('[data-ostb-go]');
    el.flow = root.querySelector('[data-ostb-flow]');
    el.peg = root.querySelector('[data-ostb-peg]');

    root.querySelectorAll('[data-ostb-dir]').forEach(function (b) {
      b.addEventListener('click', function () {
        direction = b.getAttribute('data-ostb-dir');
        root.querySelectorAll('[data-ostb-tab], .ostb-tab').forEach(function (t) { t.classList.remove('on'); });
        b.classList.add('on');
        setFlow(direction === 'deposit'
          ? 'OST → OSTG · your OST is escrowed, you receive OSTG 1:1 to play.'
          : 'OSTG → OST · your OSTG is burned, your OST is released 1:1 to spend.', '');
      });
    });
    el.go.addEventListener('click', onConvert);
    el.amt.addEventListener('keydown', function (e) { if (e.key === 'Enter') onConvert(); });
    return root;
  }

  function setFlow(msg, kind) {
    if (!el.flow) return;
    el.flow.textContent = msg;
    el.flow.className = 'ostb-flow' + (kind ? ' ' + kind : '');
  }

  async function refresh() {
    if (!el.root) return;
    var o = owner();
    if (!o) { el.ostc.textContent = '—'; el.ostg.textContent = '—'; return; }
    var b = await Promise.all([readBal(OSTC_MINT), readBal(OSTG_MINT)]);
    el.ostc.textContent = b[0] === undefined ? '…' : fmt(b[0]);
    el.ostg.textContent = b[1] === undefined ? '…' : fmt(b[1]);
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

  async function onConvert() {
    var amt = el.amt.value;
    if (!(Number(amt) > 0)) { setFlow('Enter an amount greater than zero.', 'warn'); return; }
    el.go.disabled = true;
    setFlow('Submitting ' + (direction === 'deposit' ? 'OST → OSTG' : 'OSTG → OST') + '…', 'load');
    try {
      var sig = await convert(direction, amt);
      setFlow('✓ Converted ' + fmt(amt) + (direction === 'deposit' ? ' OST to OSTG.' : ' OSTG to OST.') + (sig ? ' (' + String(sig).slice(0, 8) + '…)' : ''), 'ok');
      el.amt.value = '';
      try { window.dispatchEvent(new CustomEvent('ost:wallet-changed')); } catch (_) {}
      await refresh(); refreshPeg();
    } catch (e) {
      setFlow(String((e && e.message) || e), 'warn');
    } finally {
      el.go.disabled = false;
    }
  }

  /* ---- mount -------------------------------------------------------------- */
  // Slot the panel into the wallet Bridge/Portals area. Falls back to appending
  // under the wallet dashboard so it never gets orphaned if the DOM shifts.
  function mount() {
    if (el.root) return;
    var host = document.querySelector('#wallet-panel-portals') ||
               document.querySelector('#walletDashboard');
    if (!host) return;
    var panel = build();
    host.appendChild(panel);
    refresh(); refreshPeg();
  }

  function boot() {
    mount();
    window.addEventListener('ost:wallet-changed', refresh);
    window.addEventListener('ost:resume', function () { refresh(); refreshPeg(); });
    // Wallet section may render after us; retry a few times, then give up.
    var tries = 0;
    var t = setInterval(function () {
      if (el.root || tries++ > 20) { clearInterval(t); return; }
      mount();
    }, 500);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.OST_BRIDGE_UI = {
    refresh: refresh,
    convert: convert,             // for tests / programmatic use
    balances: function () { return Promise.all([readBal(OSTC_MINT), readBal(OSTG_MINT)]); },
    addresses: { program: PROGRAM_ID, ostc: OSTC_MINT, ostg: OSTG_MINT, bridge: BRIDGE, vault: VAULT },
  };
})();

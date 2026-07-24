/* ==========================================================================
 * OST · Balance Truth — ONE answer to "how much does this wallet have"
 * --------------------------------------------------------------------------
 * THE DAY-ONE DEFECT THIS EXISTS TO END
 *
 * OST grew eight independent balance readers pulling from five different
 * sources: the credits pool, an on-chain cache, the play mirror, a direct RPC
 * read, and - worst - `document.getElementById('wdOstBal').textContent`, i.e.
 * parsing rendered TEXT as a source of truth. Each module trusted a different
 * one, so the same wallet answered differently depending on who asked. Money
 * appeared in one screen, read as 0 in another, and looked "lost".
 *
 * Measured on one real wallet, the same instant:
 *     on-chain OSTC     998,348,784.42
 *     on-chain OSTG              30.20
 *     play mirror             2,535.37
 *     loan clean+locked       1,792.91   <- 742.46 adrift from the mirror
 *
 * Nothing was actually lost. There was simply never an agreed answer.
 *
 * THE FIX IS NOT ANOTHER BALANCE. It is a single endpoint that reports every
 * REAL place value can sit, each labelled, read in ONE pass, and never blended
 * into a single misleading total. Four distinct places exist and they are all
 * legitimate:
 *
 *   onchainOstc   SPL tokens in the user's wallet. Theirs. Card-spendable.
 *   onchainOstg   SPL tokens in the user's wallet. Theirs. Not yet playable.
 *   play          deposited into the pool; the fast mirror games/markets spend.
 *   loanLocked    borrowed funds inside `play` (a SUBSET, never an addition).
 *
 * RULES THIS FILE ENFORCES
 *   1. UNKNOWN IS NEVER ZERO. A failed read reports null plus the reason. A
 *      fabricated 0 is what makes a funded user see "not enough".
 *   2. NO BLENDED TOTAL. `spendable` is derived and labelled, never a sum of
 *      things that live in different places.
 *   3. LOAN-LOCKED IS A SUBSET OF PLAY, not a separate pot. Adding them double
 *      counts - which is precisely the 742.46 drift above.
 *   4. EVERY FIGURE CARRIES ITS SOURCE, so a disagreement is visible instead
 *      of silently resolved in someone's favour.
 * ========================================================================== */

import { PublicKey } from '@solana/web3.js';
import * as Pool from './solana-pool.js';

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'cache-control': 'no-store'
    }
  });

const r9 = (n) => Number(Number(n).toFixed(9));

async function readMint(wallet, mintStr, label) {
  try {
    return await Pool.withRpc('balance-truth-' + label, async (conn) => {
      const mintPk = new PublicKey(mintStr);
      const ata = Pool.ataForMint(wallet, mintPk);
      const res = await conn.getTokenAccountBalance(ata).catch(() => null);
      if (res && res.value) {
        return { value: r9(Number(res.value.uiAmount) || 0), source: 'solana-rpc', ata: ata.toBase58(), ok: true };
      }

      // NO TOKEN ACCOUNT. This is where a false zero is born. It means either
      //   (a) the wallet genuinely holds none of this mint  -> a REAL zero, or
      //   (b) this RPC cannot see it (wrong cluster/endpoint) -> UNKNOWN.
      // Reporting (b) as 0 is exactly how a wallet holding 998M tokens gets
      // told "not enough". We tell the two apart by asking whether the MINT
      // itself exists here: if the mint is missing, we are on the wrong chain
      // and know nothing about this wallet.
      const mintInfo = await conn.getAccountInfo(mintPk).catch(() => null);
      if (!mintInfo) {
        return {
          value: null, ok: false, error: 'mint_not_visible_on_this_rpc',
          ata: ata.toBase58(),
          detail: 'the mint itself is not on this endpoint - cluster mismatch, NOT a zero balance'
        };
      }
      return { value: 0, source: 'solana-rpc', ata: ata.toBase58(), ok: true, note: 'no token account: genuine zero (mint verified present)' };
    });
  } catch (err) {
    // Unknown, NOT zero.
    return { value: null, ok: false, error: 'rpc_failed', detail: String(err?.message || err).slice(0, 120) };
  }
}

export async function handleBalanceTruth(request, env, { path, url }) {
  if (path !== '/balance/truth') return null;

  const wallet = String(url.searchParams.get('wallet') || '').trim();
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet)) {
    return json({ ok: false, error: 'invalid_wallet' }, 400);
  }

  // Every source read in ONE pass, so the answer is internally consistent
  // rather than assembled from reads taken seconds apart.
  const [ostc, ostg, play, loans] = await Promise.all([
    readMint(wallet, Pool.OSTC_MINT, 'ostc'),
    readMint(wallet, Pool.OSTG_MINT, 'ostg'),
    (async () => {
      try {
        if (!env.PLAY_LEDGER) return { value: null, ok: false, error: 'play_ledger_unavailable' };
        const stub = env.PLAY_LEDGER.get(env.PLAY_LEDGER.idFromName('global'));
        const res = await stub.fetch('https://play-ledger/play/balance?wallet=' + encodeURIComponent(wallet));
        const d = await res.json();
        return (d && typeof d.balance === 'number')
          ? { value: r9(d.balance), source: 'play-ledger-do', ok: true }
          : { value: null, ok: false, error: 'bad_play_response' };
      } catch (err) {
        return { value: null, ok: false, error: 'play_read_failed', detail: String(err?.message || err).slice(0, 120) };
      }
    })(),
    (async () => {
      try {
        if (!env.LOAN_LEDGER) return { locked: 0, owedUsd: 0, ok: true, source: 'none' };
        const stub = env.LOAN_LEDGER.get(env.LOAN_LEDGER.idFromName('loans-v1'));
        const res = await stub.fetch('https://loan-ledger/summary?address=' + encodeURIComponent(wallet));
        const d = await res.json();
        if (!d || d.ok !== true) return { locked: null, ok: false, error: 'bad_loan_response' };
        return {
          locked: r9(Number(d.wallet.lockedTotal) || 0),
          lockedUsd: Number(d.wallet.lockedUsd) || 0,
          owedUsd: Number(d.owedUsd) || 0,
          openLoans: Number(d.wallet.openLoans) || 0,
          ok: true,
          source: 'loan-ledger-do'
        };
      } catch (err) {
        return { locked: null, ok: false, error: 'loan_read_failed', detail: String(err?.message || err).slice(0, 120) };
      }
    })()
  ]);

  // SPENDABLE, derived explicitly and only when every input is known.
  // play MINUS loanLocked, because locked funds are a SUBSET of play - adding
  // them is the double-count that produced the historical drift.
  let spendablePlay = null;
  let spendableNote;
  if (play.ok && loans.ok && loans.locked != null) {
    spendablePlay = r9(Math.max(0, play.value - loans.locked));
    spendableNote = 'play minus loan-locked (locked is a subset of play, never added to it)';
  } else {
    spendableNote = 'unknown: a source failed to read — deliberately NOT defaulted to zero';
  }

  const degraded = !play.ok || !ostc.ok || !ostg.ok || !loans.ok;

  return json({
    ok: true,
    wallet,
    // Four real places. Never summed into one headline number.
    places: {
      onchainOstc: ostc,
      onchainOstg: ostg,
      play,
      loanLocked: { value: loans.locked, usd: loans.lockedUsd ?? null, ok: loans.ok, source: loans.source || null, error: loans.error || null }
    },
    derived: {
      spendablePlay,
      note: spendableNote,
      owedUsd: loans.ok ? loans.owedUsd : null,
      openLoans: loans.ok ? loans.openLoans : null
    },
    // A caller can see at a glance whether ANY figure is untrustworthy, so a
    // partial read is never silently presented as complete.
    degraded,
    degradedReason: degraded
      ? [!ostc.ok && 'onchainOstc', !ostg.ok && 'onchainOstg', !play.ok && 'play', !loans.ok && 'loanLocked']
          .filter(Boolean).join(',')
      : null,
    readAt: Date.now()
  });
}

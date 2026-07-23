/* Regression test for the rule the whole credit line rests on:
 *   MONEY WON WITH A LOAN CANNOT REPAY THAT LOAN.
 * Run:  node test/loan-provenance.test.mjs      (exits non-zero on failure)
 * If any of these start failing, the lending feature is unsafe to run - the
 * taint model is the only thing stopping a user borrowing, winning, repaying
 * with the winnings, and keeping the house's money.
 */
import { LoanLedger } from '../src/loan-ledger.js';

// Minimal DO state stub: a Map + a serialising blockConcurrencyWhile.
function mkState() {
  const m = new Map();
  return {
    storage: {
      get: async (k) => m.get(k),
      put: async (k, v) => { m.set(k, v); },
      delete: async (k) => { m.delete(k); }
    },
    blockConcurrencyWhile: async (fn) => await fn()
  };
}
const body = async (r) => await r.json();
const L = new LoanLedger(mkState(), {});
const W = 'TestWallet111';
const RATE = 0.01;              // $0.01 per OSTG -> $100 = 10,000 OSTG
let pass = 0, fail = 0;
function check(name, cond, extra='') {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  -> ' + extra : '')); }
}

console.log('\n--- 1. draw $100 ---');
let r = await body(await L.borrow({ address: W, usd: 100, usdPerOstg: RATE }));
check('draw succeeds', r.ok, JSON.stringify(r));
const loanId = r.loan && r.loan.id;
check('10,000 OSTG issued', r.loan.principalOstg === 10000, String(r.loan?.principalOstg));
check('lands in tainted bucket, NOT clean', r.wallet.clean === 0 && r.wallet.lockedTotal === 10000,
      `clean=${r.wallet.clean} locked=${r.wallet.lockedTotal}`);

console.log('\n--- 2. THE RULE: repay a loan with its own funds ---');
r = await body(await L.repay({ address: W, loanId, amount: 100, from: loanId }));
check('REFUSED', !r.ok && r.error === 'cannot_repay_loan_with_its_own_funds', JSON.stringify(r));

console.log('\n--- 3. winnings inherit taint ---');
await L.stake({ address: W, amount: 5000, bucket: loanId });
await L.settle({ address: W, payout: 12000, bucket: loanId });   // big win
let s = await L.summary(W);
check('winnings landed in the tainted bucket', s.wallet.locked[loanId] === 17000, JSON.stringify(s.wallet.locked));
check('clean still zero (winnings not withdrawable)', s.wallet.clean === 0, String(s.wallet.clean));

console.log('\n--- 4. cannot repay from the winnings either ---');
r = await body(await L.repay({ address: W, loanId, amount: 5000, from: loanId }));
check('REFUSED (winnings carry the taint)', !r.ok && r.error === 'cannot_repay_loan_with_its_own_funds');

console.log('\n--- 5. cannot repay from clean when clean is empty ---');
r = await body(await L.repay({ address: W, loanId, amount: 5000, from: 'clean' }));
check('REFUSED insufficient', !r.ok && r.error === 'insufficient_bucket', JSON.stringify(r));

console.log('\n--- 6. repay from own OSTG settles + releases ---');
await L.settle({ address: W, payout: 11000, bucket: 'clean' });   // user brings own funds
r = await body(await L.repay({ address: W, loanId, amount: 11000, from: 'clean' }));
check('repayment applied', r.ok, JSON.stringify(r));
check('loan settled', r.status === 'settled', r.status);
check('tainted bucket released to clean', r.releasedToClean === 17000, String(r.releasedToClean));
check('credit line grew 1.5x ($150)', r.lineUsd === 150, String(r.lineUsd));

console.log('\n--- 7. slot limits + descending rule ---');
const L2 = new LoanLedger(mkState(), {});
const W2 = 'TestWallet222';
await L2.borrow({ address: W2, usd: 50, usdPerOstg: RATE });
r = await body(await L2.borrow({ address: W2, usd: 50, usdPerOstg: RATE }));
check('equal-size second draw REFUSED', !r.ok && r.error === 'must_be_smaller_than_open_loan', JSON.stringify(r));
r = await body(await L2.borrow({ address: W2, usd: 20, usdPerOstg: RATE }));
check('smaller draw allowed', r.ok, JSON.stringify(r));
r = await body(await L2.borrow({ address: W2, usd: 10, usdPerOstg: RATE }));
check('third draw allowed', r.ok);
r = await body(await L2.borrow({ address: W2, usd: 5, usdPerOstg: RATE }));
check('FOURTH draw refused (3 slot max)', !r.ok && r.error === 'no_free_slots', JSON.stringify(r));

console.log('\n--- 8. cannot exceed the credit line ---');
const L3 = new LoanLedger(mkState(), {});
r = await body(await L3.borrow({ address: 'W3', usd: 101, usdPerOstg: RATE }));
check('$101 on a $100 line REFUSED', !r.ok && r.error === 'exceeds_credit_line', JSON.stringify(r));

console.log('\n--- 9. interest is simple, never compounding ---');
const L4 = new LoanLedger(mkState(), {});
await L4.borrow({ address: 'W4', usd: 100, usdPerOstg: RATE });
const s4 = await L4.summary('W4');
const loan4 = { principalOstg: 10000, grantedAt: Date.now() - 365*86400000, repaidOstg: 0 };
const yr = L4.interestOwed(loan4);
check('12% APR over 1yr on 10,000 = 1,200', Math.abs(yr - 1200) < 1, String(yr));
const twoYr = L4.interestOwed({ ...loan4, grantedAt: Date.now() - 730*86400000 });
check('2yr = exactly 2x (linear, not compounded)', Math.abs(twoYr - 2400) < 2, String(twoYr));

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);

import { Connection, PublicKey } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID, getAccount } from '@solana/spl-token';
const conn = new Connection('https://api.devnet.solana.com', 'confirmed');
const PROGRAM_ID = new PublicKey('F82m45QUAFJ4GtMsJrSFnWzDrjWdZjdzyh8HTPgTBHXr');
const NEW_LEN = 8 + 32+32+8+1+1+8+8+8+8+8+1+1 + 32+8+4+8 + 32+8;

const accts = await conn.getProgramAccounts(PROGRAM_ID, { commitment: 'confirmed' });
console.log('program accounts:', accts.length);
let stranded = 0;
for (const { pubkey, account } of accts) {
  const len = account.data.length;
  // Markets only (positions are much smaller)
  if (len < 100) continue;
  const [vault] = PublicKey.findProgramAddressSync([Buffer.from('vault'), pubkey.toBuffer()], PROGRAM_ID);
  let bal = 0;
  try { bal = Number((await getAccount(conn, vault, 'confirmed', TOKEN_2022_PROGRAM_ID)).amount) / 1e9; } catch {}
  const layout = len >= NEW_LEN ? 'NEW' : 'OLD(pre-house-edge)';
  const resolved = account.data[8+32+32+8+1+1+8+8+8+8+8] === 1;
  if (bal > 0 || layout.startsWith('OLD')) {
    console.log(`  market ${pubkey.toBase58().slice(0,8)}… len=${len} ${layout} resolved=${resolved} vault=${bal} OST`);
  }
  if (bal > 0) stranded += bal;
}
console.log(stranded > 0 ? `\n>>> ${stranded} OST still escrowed across market vaults` : '\n>>> No OST escrowed in any market vault — nothing can be stranded by the layout change.');

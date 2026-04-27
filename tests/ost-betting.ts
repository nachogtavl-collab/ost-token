// =============================================================================
// OST Betting — Integration Tests
// =============================================================================
// Lifecycle:
//   1. Initialize market (lock soon, resolve after that)
//   2. Two bettors stake on opposite sides
//   3. Wait until resolve_ts, then resolve_market
//   4. Winner claims pari-mutuel payout, loser claim is a no-op
//
// Run: `anchor test`
// =============================================================================

import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, BN } from "@coral-xyz/anchor";
import { expect } from "chai";
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram } from "@solana/web3.js";

import {
  OstBettingClient,
  OST_BETTING_PROGRAM_ID,
  SIDE_NO,
  SIDE_YES,
  getMarketPda,
  getVaultPda,
  getPositionPda,
} from "../client/ost-betting-client";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("ost_betting", () => {
  const provider = AnchorProvider.env();
  anchor.setProvider(provider);

  const program = (anchor.workspace as any).OstBetting as Program;
  const client = new OstBettingClient(program, OST_BETTING_PROGRAM_ID);

  const authority = (provider.wallet as anchor.Wallet).payer;
  const yesBettor = Keypair.generate();
  const noBettor = Keypair.generate();

  const marketId = new BN(Date.now()); // unique per test run
  let market: PublicKey;
  let vault: PublicKey;

  before(async () => {
    // Fund bettors from authority (which is `provider.wallet`)
    const fund = async (to: PublicKey, sol: number) => {
      const tx = await provider.connection.requestAirdrop(to, sol * LAMPORTS_PER_SOL).catch(() => null);
      if (tx) await provider.connection.confirmTransaction(tx, "confirmed");
    };
    await fund(yesBettor.publicKey, 2);
    await fund(noBettor.publicKey, 2);

    // Fallback transfer if airdrop is rate-limited (devnet)
    const ensure = async (to: PublicKey, minSol: number) => {
      const bal = await provider.connection.getBalance(to);
      if (bal < minSol * LAMPORTS_PER_SOL) {
        const ix = SystemProgram.transfer({
          fromPubkey: authority.publicKey,
          toPubkey: to,
          lamports: minSol * LAMPORTS_PER_SOL,
        });
        const tx = new anchor.web3.Transaction().add(ix);
        await provider.sendAndConfirm(tx, []);
      }
    };
    await ensure(yesBettor.publicKey, 1.5);
    await ensure(noBettor.publicKey, 1.5);
  });

  it("initializes a market", async () => {
    const now = Math.floor(Date.now() / 1000);
    const lockTs = new BN(now + 6);
    const resolveTs = new BN(now + 10);

    const res = await client.initializeMarket({
      authority: authority.publicKey,
      marketId,
      lockTs,
      resolveTs,
    });
    market = res.market;
    vault = res.vault;

    const m = await client.fetchMarket(market);
    expect(m.authority.toBase58()).to.eq(authority.publicKey.toBase58());
    expect(m.marketId.toString()).to.eq(marketId.toString());
    expect(m.resolved).to.eq(false);
    expect(m.yesPool.toString()).to.eq("0");
    expect(m.noPool.toString()).to.eq("0");
  });

  it("rejects an invalid side", async () => {
    let threw = false;
    try {
      await (program.methods as any)
        .placeBet(2, new BN(1000))
        .accounts({
          bettor: yesBettor.publicKey,
          market,
          vault,
          position: getPositionPda(market, yesBettor.publicKey)[0],
          systemProgram: SystemProgram.programId,
        })
        .signers([yesBettor])
        .rpc();
    } catch (_) {
      threw = true;
    }
    expect(threw).to.eq(true);
  });

  it("places YES and NO bets", async () => {
    const yesAmount = new BN(0.4 * LAMPORTS_PER_SOL);
    const noAmount = new BN(0.1 * LAMPORTS_PER_SOL);

    // YES side
    await (program.methods as any)
      .placeBet(SIDE_YES, yesAmount)
      .accounts({
        bettor: yesBettor.publicKey,
        market,
        vault,
        position: getPositionPda(market, yesBettor.publicKey)[0],
        systemProgram: SystemProgram.programId,
      })
      .signers([yesBettor])
      .rpc();

    // NO side
    await (program.methods as any)
      .placeBet(SIDE_NO, noAmount)
      .accounts({
        bettor: noBettor.publicKey,
        market,
        vault,
        position: getPositionPda(market, noBettor.publicKey)[0],
        systemProgram: SystemProgram.programId,
      })
      .signers([noBettor])
      .rpc();

    const m = await client.fetchMarket(market);
    expect(m.yesPool.toString()).to.eq(yesAmount.toString());
    expect(m.noPool.toString()).to.eq(noAmount.toString());
  });

  it("rejects resolve before resolve_ts", async () => {
    let threw = false;
    try {
      await client.resolveMarket({
        authority: authority.publicKey,
        market,
        winningSide: SIDE_YES,
      });
    } catch (_) {
      threw = true;
    }
    expect(threw).to.eq(true);
  });

  it("resolves market YES after resolve_ts", async () => {
    const m1 = await client.fetchMarket(market);
    const now = Math.floor(Date.now() / 1000);
    const wait = Math.max(0, m1.resolveTs.toNumber() - now + 1);
    await sleep(wait * 1000);

    await client.resolveMarket({
      authority: authority.publicKey,
      market,
      winningSide: SIDE_YES,
    });

    const m = await client.fetchMarket(market);
    expect(m.resolved).to.eq(true);
    expect(m.winningSide).to.eq(SIDE_YES);
  });

  it("YES bettor claims pari-mutuel payout", async () => {
    const before = await provider.connection.getBalance(yesBettor.publicKey);
    const m = await client.fetchMarket(market);

    await (program.methods as any)
      .claimPayout()
      .accounts({
        bettor: yesBettor.publicKey,
        market,
        position: getPositionPda(market, yesBettor.publicKey)[0],
        vault,
        systemProgram: SystemProgram.programId,
      })
      .signers([yesBettor])
      .rpc();

    const after = await provider.connection.getBalance(yesBettor.publicKey);
    const totalPool = m.yesPool.add(m.noPool).toNumber();
    // Payout should be > original stake (since YES pool < total pool).
    expect(after).to.be.greaterThan(before);
    // Sanity: gained roughly totalPool worth of lamports minus tx fee
    const gained = after - before;
    expect(gained).to.be.greaterThan(m.yesPool.toNumber() - 50_000); // allow fee variance
    expect(gained).to.be.lessThanOrEqual(totalPool);
  });

  it("NO bettor claim is a no-op (no payout)", async () => {
    const before = await provider.connection.getBalance(noBettor.publicKey);

    await (program.methods as any)
      .claimPayout()
      .accounts({
        bettor: noBettor.publicKey,
        market,
        position: getPositionPda(market, noBettor.publicKey)[0],
        vault,
        systemProgram: SystemProgram.programId,
      })
      .signers([noBettor])
      .rpc();

    const after = await provider.connection.getBalance(noBettor.publicKey);
    // Loser pays only tx fee, so balance should decrease slightly (not increase).
    expect(after).to.be.lessThanOrEqual(before);
  });

  it("rejects double-claim by winner", async () => {
    let threw = false;
    try {
      await (program.methods as any)
        .claimPayout()
        .accounts({
          bettor: yesBettor.publicKey,
          market,
          position: getPositionPda(market, yesBettor.publicKey)[0],
          vault,
          systemProgram: SystemProgram.programId,
        })
        .signers([yesBettor])
        .rpc();
    } catch (_) {
      threw = true;
    }
    expect(threw).to.eq(true);
  });
});

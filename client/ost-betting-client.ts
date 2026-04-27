// =============================================================================
// OST Betting Client SDK
// =============================================================================
// TypeScript wrapper for the on-chain `ost_betting` Anchor program.
//
//   - PDA derivation helpers for Market / Vault / Position
//   - High-level helpers: initializeMarket / placeBet / resolveMarket / claim
//
// Program: programs/ost-betting/src/lib.rs
// =============================================================================

import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, BN } from "@coral-xyz/anchor";
import {
  PublicKey,
  Keypair,
  SystemProgram,
  Connection,
  TransactionSignature,
} from "@solana/web3.js";

export const OST_BETTING_PROGRAM_ID = new PublicKey(
  "Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkgMQHGz5A9A"
);

export const SIDE_NO = 0;
export const SIDE_YES = 1;

// ---------------------------------------------------------------------------
// PDA helpers
// ---------------------------------------------------------------------------

function u64Le(n: anchor.BN | number | bigint): Buffer {
  const bn = anchor.BN.isBN(n as any)
    ? (n as anchor.BN)
    : new anchor.BN((typeof n === "bigint" ? n.toString() : n).toString());
  return bn.toArrayLike(Buffer, "le", 8);
}

export function getMarketPda(
  authority: PublicKey,
  marketId: anchor.BN | number,
  programId: PublicKey = OST_BETTING_PROGRAM_ID
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("market"), authority.toBuffer(), u64Le(marketId)],
    programId
  );
}

export function getVaultPda(
  market: PublicKey,
  marketId: anchor.BN | number,
  programId: PublicKey = OST_BETTING_PROGRAM_ID
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), market.toBuffer(), u64Le(marketId)],
    programId
  );
}

export function getPositionPda(
  market: PublicKey,
  bettor: PublicKey,
  programId: PublicKey = OST_BETTING_PROGRAM_ID
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("position"), market.toBuffer(), bettor.toBuffer()],
    programId
  );
}

// ---------------------------------------------------------------------------
// Account types (mirror Rust state)
// ---------------------------------------------------------------------------

export interface MarketAccount {
  authority: PublicKey;
  marketId: anchor.BN;
  bump: number;
  vaultBump: number;
  createdAt: anchor.BN;
  lockTs: anchor.BN;
  resolveTs: anchor.BN;
  yesPool: anchor.BN;
  noPool: anchor.BN;
  resolved: boolean;
  winningSide: number;
}

export interface PositionAccount {
  market: PublicKey;
  bettor: PublicKey;
  side: number;
  stake: anchor.BN;
  claimed: boolean;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class OstBettingClient {
  readonly program: Program;
  readonly programId: PublicKey;
  readonly provider: AnchorProvider;

  constructor(program: Program, programId: PublicKey = OST_BETTING_PROGRAM_ID) {
    this.program = program;
    this.programId = programId;
    this.provider = program.provider as AnchorProvider;
  }

  // -- Reads -----------------------------------------------------------------

  async fetchMarket(market: PublicKey): Promise<MarketAccount> {
    return (await (this.program.account as any).market.fetch(
      market
    )) as MarketAccount;
  }

  async fetchPosition(position: PublicKey): Promise<PositionAccount> {
    return (await (this.program.account as any).position.fetch(
      position
    )) as PositionAccount;
  }

  // -- Writes ----------------------------------------------------------------

  async initializeMarket(params: {
    authority: PublicKey;
    marketId: anchor.BN | number;
    lockTs: anchor.BN | number;
    resolveTs: anchor.BN | number;
  }): Promise<{ tx: TransactionSignature; market: PublicKey; vault: PublicKey }> {
    const marketIdBn = new anchor.BN(params.marketId.toString());
    const lockTsBn = new anchor.BN(params.lockTs.toString());
    const resolveTsBn = new anchor.BN(params.resolveTs.toString());

    const [market] = getMarketPda(params.authority, marketIdBn, this.programId);
    const [vault] = getVaultPda(market, marketIdBn, this.programId);

    const tx = await (this.program.methods as any)
      .initializeMarket(marketIdBn, lockTsBn, resolveTsBn)
      .accounts({
        authority: params.authority,
        market,
        vault,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    return { tx, market, vault };
  }

  async placeBet(params: {
    bettor: PublicKey;
    market: PublicKey;
    side: 0 | 1;
    amountLamports: anchor.BN | number | bigint;
  }): Promise<{ tx: TransactionSignature; position: PublicKey }> {
    const marketAcc = await this.fetchMarket(params.market);
    const [vault] = getVaultPda(params.market, marketAcc.marketId, this.programId);
    const [position] = getPositionPda(params.market, params.bettor, this.programId);

    const amountBn = new anchor.BN(params.amountLamports.toString());

    const tx = await (this.program.methods as any)
      .placeBet(params.side, amountBn)
      .accounts({
        bettor: params.bettor,
        market: params.market,
        vault,
        position,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    return { tx, position };
  }

  async resolveMarket(params: {
    authority: PublicKey;
    market: PublicKey;
    winningSide: 0 | 1;
  }): Promise<TransactionSignature> {
    return (this.program.methods as any)
      .resolveMarket(params.winningSide)
      .accounts({
        authority: params.authority,
        market: params.market,
      })
      .rpc();
  }

  async claimPayout(params: {
    bettor: PublicKey;
    market: PublicKey;
  }): Promise<TransactionSignature> {
    const marketAcc = await this.fetchMarket(params.market);
    const [vault] = getVaultPda(params.market, marketAcc.marketId, this.programId);
    const [position] = getPositionPda(params.market, params.bettor, this.programId);

    return (this.program.methods as any)
      .claimPayout()
      .accounts({
        bettor: params.bettor,
        market: params.market,
        position,
        vault,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  }
}

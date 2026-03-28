// ============================================================================
// ZK Tax Report — Private proof of tax compliance
// ============================================================================
// Generates an on-chain attestation that a user's taxes were calculated
// correctly over a set of confidential transactions, WITHOUT revealing:
//   - Individual transaction amounts
//   - Counterparties
//   - Account balances
//
// The proof_hash is a SHA-256 hash of a ZK proof generated off-chain
// (e.g., using a Groth16 circuit). Auditors can verify the proof
// off-chain against the hash stored here.
//
// This is entirely optional — users who want to prove tax compliance
// to regulators without sacrificing privacy can use this.
// ============================================================================

use anchor_lang::prelude::*;

use crate::state::ZkTaxReport;
use crate::errors::OstError;

#[derive(Accounts)]
#[instruction(tax_year: u16)]
pub struct SubmitZkTaxReport<'info> {
    /// The taxpayer
    #[account(mut)]
    pub owner: Signer<'info>,

    /// Tax report PDA (one per user per year)
    #[account(
        init,
        payer = owner,
        space = ZkTaxReport::LEN,
        seeds = [b"tax-report", owner.key().as_ref(), &tax_year.to_le_bytes()],
        bump,
    )]
    pub tax_report: Account<'info, ZkTaxReport>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<SubmitZkTaxReport>,
    tax_year: u16,
    total_transactions: u32,
    proof_hash: [u8; 32],
    jurisdiction_code: [u8; 2],
) -> Result<()> {
    // ---- Basic validation ----
    require!(tax_year >= 2020 && tax_year <= 2100, OstError::InvalidTaxYear);

    // Ensure proof_hash is not all zeros (client must provide real proof)
    require!(
        proof_hash.iter().any(|&b| b != 0),
        OstError::InvalidProofData
    );

    let report = &mut ctx.accounts.tax_report;
    report.owner = ctx.accounts.owner.key();
    report.tax_year = tax_year;
    report.total_transactions = total_transactions;
    report.proof_hash = proof_hash;
    report.jurisdiction_code = jurisdiction_code;
    report.submitted_at = Clock::get()?.unix_timestamp;
    report.bump = ctx.bumps.tax_report;

    msg!(
        "ZK Tax Report submitted: year={}, txns={}, jurisdiction={}{}",
        tax_year,
        total_transactions,
        jurisdiction_code[0] as char,
        jurisdiction_code[1] as char,
    );

    Ok(())
}

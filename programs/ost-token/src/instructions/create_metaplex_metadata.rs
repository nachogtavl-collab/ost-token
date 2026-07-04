// ============================================================================
// Create Metaplex Token Metadata for the existing OST Token-2022 mint.
//
// Phantom, Solscan, Jupiter, and most current Solana indexers read this
// metadata PDA, not the Token-2022 metadata extension.
// ============================================================================

use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::invoke_signed,
    sysvar,
};

use crate::errors::OstError;
use crate::state::MintConfig;

pub const TOKEN_METADATA_PROGRAM_ID: Pubkey =
    pubkey!("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
pub const TOKEN_2022_PROGRAM_ID: Pubkey =
    pubkey!("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

#[derive(Accounts)]
pub struct CreateMetaplexMetadata<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    /// CHECK: Existing Token-2022 OST mint. Metaplex validates the mint account.
    /// Marked mut because Metaplex's Create instruction may update mint extensions
    /// (e.g., MetadataPointer) when present. Safe: only Metaplex CPI writes to it.
    #[account(mut)]
    pub mint: UncheckedAccount<'info>,

    /// CHECK: Metaplex metadata PDA derived from ["metadata", metadata program, mint].
    #[account(mut)]
    pub metadata: UncheckedAccount<'info>,

    #[account(
        seeds = [b"mint-config"],
        bump = mint_config.bump,
        constraint = mint_config.admin == admin.key() @ OstError::Unauthorized,
    )]
    pub mint_config: Account<'info, MintConfig>,

    /// CHECK: PDA mint authority. The program signs for it with seeds.
    #[account(
        seeds = [b"mint-authority"],
        bump = mint_config.authority_bump,
    )]
    pub mint_authority: UncheckedAccount<'info>,

    /// CHECK: Fixed Metaplex Token Metadata program.
    #[account(address = TOKEN_METADATA_PROGRAM_ID)]
    pub token_metadata_program: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
    /// CHECK: Sysvar Instructions, required by Metaplex Create v1.
    #[account(address = sysvar::instructions::ID)]
    pub sysvar_instructions: UncheckedAccount<'info>,
    /// CHECK: SPL Token-2022 program, required by Metaplex Create v1 for Token-2022 mints.
    #[account(address = TOKEN_2022_PROGRAM_ID)]
    pub spl_token_program: UncheckedAccount<'info>,
}

pub fn handler(
    ctx: Context<CreateMetaplexMetadata>,
    name: String,
    symbol: String,
    uri: String,
) -> Result<()> {
    require!(name.as_bytes().len() <= 32, OstError::MetadataNameTooLong);
    require!(
        symbol.as_bytes().len() <= 10,
        OstError::MetadataSymbolTooLong
    );
    require!(uri.as_bytes().len() <= 200, OstError::MetadataUriTooLong);

    let expected_metadata = Pubkey::find_program_address(
        &[
            b"metadata",
            TOKEN_METADATA_PROGRAM_ID.as_ref(),
            ctx.accounts.mint.key().as_ref(),
        ],
        &TOKEN_METADATA_PROGRAM_ID,
    )
    .0;
    require_keys_eq!(
        ctx.accounts.metadata.key(),
        expected_metadata,
        OstError::InvalidMetadataPda
    );

    let data = encode_create_v1(&name, &symbol, &uri);
    let accounts = vec![
        AccountMeta::new(ctx.accounts.metadata.key(), false),                 // metadata
        AccountMeta::new_readonly(ctx.accounts.token_metadata_program.key(), false), // master_edition (None -> pass program id)
        AccountMeta::new(ctx.accounts.mint.key(), false),                     // mint (writable, not signer for existing mint)
        AccountMeta::new_readonly(ctx.accounts.mint_authority.key(), true),   // authority (mint authority signer)
        AccountMeta::new(ctx.accounts.admin.key(), true),                     // payer
        AccountMeta::new_readonly(ctx.accounts.mint_authority.key(), false),  // update_authority (PDA, not signer here)
        AccountMeta::new_readonly(ctx.accounts.system_program.key(), false),
        AccountMeta::new_readonly(ctx.accounts.sysvar_instructions.key(), false),
        AccountMeta::new_readonly(ctx.accounts.spl_token_program.key(), false),
    ];
    let ix = Instruction {
        program_id: TOKEN_METADATA_PROGRAM_ID,
        accounts,
        data,
    };

    let authority_bump = [ctx.accounts.mint_config.authority_bump];
    let signer_seeds: &[&[u8]] = &[b"mint-authority", &authority_bump];

    invoke_signed(
        &ix,
        &[
            ctx.accounts.metadata.to_account_info(),
            ctx.accounts.token_metadata_program.to_account_info(),
            ctx.accounts.mint.to_account_info(),
            ctx.accounts.mint_authority.to_account_info(),
            ctx.accounts.admin.to_account_info(),
            ctx.accounts.mint_authority.to_account_info(),
            ctx.accounts.system_program.to_account_info(),
            ctx.accounts.sysvar_instructions.to_account_info(),
            ctx.accounts.spl_token_program.to_account_info(),
        ],
        &[signer_seeds],
    )?;

    msg!(
        "Metaplex metadata created for mint {}",
        ctx.accounts.mint.key()
    );
    msg!("Name: {}, Symbol: {}, URI: {}", name, symbol, uri);
    Ok(())
}

fn encode_string(value: &str, out: &mut Vec<u8>) {
    let bytes = value.as_bytes();
    out.extend_from_slice(&(bytes.len() as u32).to_le_bytes());
    out.extend_from_slice(bytes);
}

fn encode_create_v1(name: &str, symbol: &str, uri: &str) -> Vec<u8> {
    // Metaplex Token Metadata `Create` (instruction discriminator = 42).
    // CreateArgs is a borsh enum with one variant (V1, tag = 0):
    //   V1 { asset_data: AssetData, decimals: Option<u8>, print_supply: Option<PrintSupply> }
    // AssetData fields (in order):
    //   name, symbol, uri, seller_fee_basis_points, creators, primary_sale_happened,
    //   is_mutable, token_standard, collection, uses, collection_details, rule_set.
    let mut out = Vec::with_capacity(64 + name.len() + symbol.len() + uri.len());

    out.push(42); // Create discriminator
    out.push(0);  // CreateArgs::V1 variant tag

    // AssetData
    encode_string(name, &mut out);
    encode_string(symbol, &mut out);
    encode_string(uri, &mut out);
    out.extend_from_slice(&0u16.to_le_bytes()); // seller_fee_basis_points
    out.push(0); // creators: None
    out.push(0); // primary_sale_happened: false
    out.push(1); // is_mutable: true
    out.push(2); // token_standard: Fungible
    out.push(0); // collection: None
    out.push(0); // uses: None
    out.push(0); // collection_details: None
    out.push(0); // rule_set: None

    out.push(0); // decimals: None (read from existing mint)
    out.push(0); // print_supply: None

    out
}

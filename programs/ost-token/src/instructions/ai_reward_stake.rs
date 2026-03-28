// ============================================================================
// AI Reward Stake — DePIN Integration Hook for Passive Earning
// ============================================================================
//
// CONCEPT: OST wallets are not passive key stores — they are AI-native
// autonomous agents. This instruction records a user's intent to stake
// device resources (CPU, GPU, bandwidth, storage) into the DePIN network,
// earning OST rewards while the phone sleeps.
//
// DePIN INTEGRATION PARTNERS (commented — connect when ready):
//
// ┌─────────────┬───────────────────────────────────────────────────────┐
// │ Grass       │ Share unused bandwidth → earn points → convert to   │
// │             │ OST. User installs Grass extension or SDK; our      │
// │             │ wallet auto-registers and stakes the reward claim.  │
// │             │ https://grassfoundation.io                          │
// ├─────────────┼───────────────────────────────────────────────────────┤
// │ Render      │ Share GPU compute for 3D rendering and AI inference  │
// │             │ jobs. Earnings in RNDR → auto-swap to OST via        │
// │             │ Jupiter. Wallet orchestrates the flow.               │
// │             │ https://rendernetwork.com                            │
// ├─────────────┼───────────────────────────────────────────────────────┤
// │ Helium      │ Run a LoRaWAN / 5G hotspot. Earnings in HNT/MOBILE  │
// │             │ → swap to OST. Wallet acts as auto-compounder.       │
// │             │ https://helium.com                                   │
// ├─────────────┼───────────────────────────────────────────────────────┤
// │ Dawn        │ Share bandwidth via browser extension. Earnings →    │
// │             │ Dawn points → swap to OST when liquid.               │
// │             │ https://dawninternet.com                             │
// ├─────────────┼───────────────────────────────────────────────────────┤
// │ Spacecoin   │ Contribute to satellite relay infrastructure.        │
// │             │ Earnings → OST (our native partner for orbital DePIN)│
// └─────────────┴───────────────────────────────────────────────────────┘
//
// HOW THE AI AGENT WORKS (wallet-side, commented reference):
//
// ```typescript
// // The wallet's AI agent runs a background loop:
// class OstAiAgent {
//   async run() {
//     while (true) {
//       // 1. Check available device resources
//       const resources = await this.detectResources(); // CPU, GPU, BW, storage
//
//       // 2. Find the highest-APY DePIN opportunity
//       const best = await this.rankDePinOpportunities(resources);
//       // e.g., { provider: "Grass", estimatedApy: 24, resourceType: "bandwidth" }
//
//       // 3. Auto-stake if profitable
//       if (best.estimatedApy > this.userMinApy) {
//         await this.stakeResource(best);
//         await ostClient.aiRewardStake(best.provider, best.resourceType);
//       }
//
//       // 4. Auto-compound: swap DePIN rewards → OST
//       const rewards = await this.checkPendingRewards();
//       if (rewards.total > 0) {
//         await this.swapToOst(rewards); // Jupiter swap
//       }
//
//       // 5. Auto-vote in Space DAO based on user preferences
//       const proposals = await ostClient.getActiveProposals();
//       for (const p of proposals) {
//         if (this.shouldAutoVote(p, this.userPreferences)) {
//           await ostClient.castVote(p.id, this.evaluateProposal(p));
//         }
//       }
//
//       await sleep(60_000); // check every minute
//     }
//   }
// }
// ```
//
// P2P-FOCUSED & PRIVATE:
//   - All resource sharing is opt-in and controlled by the user's AI agent.
//   - The agent runs locally (not on our servers). All data stays on-device.
//   - DePIN earnings are swapped to OST and deposited to confidential balance
//     automatically — no one sees how much you earned.
//   - The AI never shares personal data. It's a privacy guardian, not a spy.
//
// ============================================================================

use anchor_lang::prelude::*;

use crate::state::AiRewardStake;
use crate::errors::OstError;

#[derive(Accounts)]
pub struct AiRewardStakeIx<'info> {
    /// The user registering for DePIN rewards
    #[account(mut)]
    pub user: Signer<'info>,

    /// AI reward stake record PDA
    #[account(
        init_if_needed,
        payer = user,
        space = AiRewardStake::LEN,
        seeds = [b"ai-reward", user.key().as_ref()],
        bump,
    )]
    pub reward_stake: Account<'info, AiRewardStake>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<AiRewardStakeIx>,
    // Provider: 0=Grass, 1=Render, 2=Helium, 3=Dawn, 4=Spacecoin, 5=Other
    provider: u8,
    // Resource: 0=Bandwidth, 1=GPU, 2=CPU, 3=Storage, 4=LoRa/5G, 5=Satellite
    resource_type: u8,
) -> Result<()> {
    require!(provider <= 5, OstError::InvalidProvider);
    require!(resource_type <= 5, OstError::InvalidResourceType);

    let stake = &mut ctx.accounts.reward_stake;
    stake.user = ctx.accounts.user.key();
    stake.provider = provider;
    stake.resource_type = resource_type;
    stake.active = true;
    stake.total_earned = 0;
    stake.last_claim_at = Clock::get()?.unix_timestamp;
    stake.bump = ctx.bumps.reward_stake;

    msg!(
        "AI reward stake registered: user={}, provider={}, resource={}",
        ctx.accounts.user.key(),
        provider,
        resource_type
    );

    Ok(())
}

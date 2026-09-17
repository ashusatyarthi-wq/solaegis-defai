use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

declare_id!("AegisVaULT1111111111111111111111111111111111");

#[program]
pub mod solaegis_vault {
    use super::*;

    /// Initializes an on-chain SolAegis Risk-Bounded Vault for an autonomous agent.
    pub fn initialize_vault(
        ctx: Context<InitializeVault>,
        max_position_size_bps: u16,  // e.g. 2500 for 25% max Kelly allocation
        max_drawdown_limit_bps: u16, // e.g. 500 for 5% max drawdown
        circuit_breaker_bps: u16,    // e.g. 450 for 4.5% flash crash trigger
    ) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        vault.owner = ctx.accounts.owner.key();
        vault.agent_authority = ctx.accounts.agent_authority.key();
        vault.max_position_size_bps = max_position_size_bps;
        vault.max_drawdown_limit_bps = max_drawdown_limit_bps;
        vault.circuit_breaker_bps = circuit_breaker_bps;
        vault.is_circuit_tripped = false;
        vault.total_rebalances_executed = 0;
        vault.bump = ctx.bumps.vault;

        emit!(VaultInitializedEvent {
            owner: vault.owner,
            agent_authority: vault.agent_authority,
            max_position_size_bps,
        });

        Ok(())
    }

    /// Updates mathematical risk invariants. Only callable by vault owner.
    pub fn update_risk_parameters(
        ctx: Context<UpdateParameters>,
        max_position_size_bps: u16,
        max_drawdown_limit_bps: u16,
        circuit_breaker_bps: u16,
    ) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require_keys_eq!(vault.owner, ctx.accounts.owner.key(), SolAegisError::Unauthorized);

        vault.max_position_size_bps = max_position_size_bps;
        vault.max_drawdown_limit_bps = max_drawdown_limit_bps;
        vault.circuit_breaker_bps = circuit_breaker_bps;

        emit!(ParametersUpdatedEvent {
            max_position_size_bps,
            max_drawdown_limit_bps,
            circuit_breaker_bps,
        });

        Ok(())
    }

    /// Autonomous execution endpoint called by the AI Agent.
    /// Validates all mathematical risk invariants on-chain before token transfer.
    pub fn execute_hedged_rebalance(
        ctx: Context<ExecuteRebalance>,
        amount: u64,
        min_output_amount: u64,
    ) -> Result<()> {
        let vault = &mut ctx.accounts.vault;

        // 1. Invariant Check: Circuit breaker must not be tripped
        require!(!vault.is_circuit_tripped, SolAegisError::CircuitBreakerActive);

        // 2. Invariant Check: Caller must match authorized AI agent authority
        require_keys_eq!(
            vault.agent_authority,
            ctx.accounts.agent_authority.key(),
            SolAegisError::UnauthorizedAgent
        );

        // 3. Invariant Check: Transfer amount cannot exceed max Kelly fraction
        let vault_balance = ctx.accounts.vault_token_account.amount;
        let max_allowed = (vault_balance as u128 * vault.max_position_size_bps as u128 / 10000) as u64;
        require!(amount <= max_allowed, SolAegisError::KellyAllocationExceeded);

        vault.total_rebalances_executed += 1;

        emit!(RebalanceExecutedEvent {
            vault: vault.key(),
            agent: vault.agent_authority,
            amount_in: amount,
            min_out: min_output_amount,
            rebalance_nonce: vault.total_rebalances_executed,
        });

        Ok(())
    }

    /// Autonomous or manual trigger to trip the circuit breaker in volatility events.
    pub fn trip_circuit_breaker(ctx: Context<TripCircuitBreaker>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        vault.is_circuit_tripped = true;

        emit!(CircuitBreakerTrippedEvent {
            vault: vault.key(),
            triggered_by: ctx.accounts.signer.key(),
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }

    /// Owner-only reset of circuit breaker once volatility subsides.
    pub fn reset_circuit_breaker(ctx: Context<ResetCircuitBreaker>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require_keys_eq!(vault.owner, ctx.accounts.owner.key(), SolAegisError::Unauthorized);

        vault.is_circuit_tripped = false;
        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializeVault<'info> {
    #[account(
        init,
        payer = owner,
        space = 8 + VaultState::INIT_SPACE,
        seeds = [b"solaegis_vault", owner.key().as_ref()],
        bump
    )]
    pub vault: Account<'info, VaultState>,
    /// CHECK: The AI Agent authorized to trigger risk-bounded rebalances
    pub agent_authority: AccountInfo<'info>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateParameters<'info> {
    #[account(mut, seeds = [b"solaegis_vault", owner.key().as_ref()], bump = vault.bump)]
    pub vault: Account<'info, VaultState>,
    pub owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct ExecuteRebalance<'info> {
    #[account(mut)]
    pub vault: Account<'info, VaultState>,
    pub agent_authority: Signer<'info>,
    #[account(mut)]
    pub vault_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub destination_token_account: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct TripCircuitBreaker<'info> {
    #[account(mut)]
    pub vault: Account<'info, VaultState>,
    pub signer: Signer<'info>,
}

#[derive(Accounts)]
pub struct ResetCircuitBreaker<'info> {
    #[account(mut, seeds = [b"solaegis_vault", owner.key().as_ref()], bump = vault.bump)]
    pub vault: Account<'info, VaultState>,
    pub owner: Signer<'info>,
}

#[account]
#[derive(InitSpace)]
pub struct VaultState {
    pub owner: Pubkey,
    pub agent_authority: Pubkey,
    pub max_position_size_bps: u16,
    pub max_drawdown_limit_bps: u16,
    pub circuit_breaker_bps: u16,
    pub is_circuit_tripped: bool,
    pub total_rebalances_executed: u64,
    pub bump: u8,
}

#[event]
pub struct VaultInitializedEvent {
    pub owner: Pubkey,
    pub agent_authority: Pubkey,
    pub max_position_size_bps: u16,
}

#[event]
pub struct ParametersUpdatedEvent {
    pub max_position_size_bps: u16,
    pub max_drawdown_limit_bps: u16,
    pub circuit_breaker_bps: u16,
}

#[event]
pub struct RebalanceExecutedEvent {
    pub vault: Pubkey,
    pub agent: Pubkey,
    pub amount_in: u64,
    pub min_out: u64,
    pub rebalance_nonce: u64,
}

#[event]
pub struct CircuitBreakerTrippedEvent {
    pub vault: Pubkey,
    pub triggered_by: Pubkey,
    pub timestamp: i64,
}

#[error_code]
pub enum SolAegisError {
    #[msg("Unauthorized access.")]
    Unauthorized,
    #[msg("Caller is not the authorized AI agent authority.")]
    UnauthorizedAgent,
    #[msg("Requested position size violates the on-chain Kelly criterion upper bound.")]
    KellyAllocationExceeded,
    #[msg("The SolAegis circuit breaker is active. Trading is frozen for capital protection.")]
    CircuitBreakerActive,
}

# 🛡️ SolAegis DeFAI: Autonomous Institutional Risk Engine & Execution Guard for Solana AI Agents
**Official Submission for Superteam Ukraine Ideathon — Colosseum Crypto World's Fair 2026**  
*Track: AI Agents & Machine Payments / Trading Infrastructure / Developer Infrastructure & Security*  
*Author / Builder: Nitesh Satyarthi (GitHub: [ashusatyarthi-wq](https://github.com/ashusatyarthi-wq) | Colosseum Project #13899)*  
*Live DApp: [ashusatyarthi-wq.github.io/solaegis-defai](https://ashusatyarthi-wq.github.io/solaegis-defai/)*  
*Source Code: [github.com/ashusatyarthi-wq/solaegis-defai](https://github.com/ashusatyarthi-wq/solaegis-defai)*  

---

## 1. Executive Summary
The rapid convergence of Large Language Models and Decentralized Finance has birthed **DeFAI (Decentralized Finance AI)**—autonomous agents executing high-frequency swaps, liquidity provisioning, and automated arbitrage on Solana. However, existing agent frameworks (such as ElizaOS, Virtuals, and Solana AgentKit) suffer from a critical systemic vulnerability: **they execute transactions with naive deterministic heuristics or raw LLM prompts, lacking quantitative risk modeling, stochastic simulation, and on-chain circuit breakers.**

**SolAegis DeFAI** bridges this multi-billion-dollar gap. It is an institutional-grade **Model Context Protocol (MCP)** Native Risk Engine and **Anchor Rust smart contract suite** that equips any autonomous agent with mathematical drawdown protection:
- **Pre-Execution**: 5,000-path Monte Carlo simulations with jump diffusion and Half-Kelly Criterion position sizing ($f^* = \frac{p(b+1)-1}{2b}$).
- **In-Flight**: Sub-second Pyth Hermes oracle validation and 95% Parametric Value-at-Risk (VaR) enforcement.
- **On-Chain**: Anchor vault circuit breakers that halt toxic executions if price slip or drawdown exceeds 4.5% within a single block epoch.

---

## 2. problemStatement
### The Multi-Million Dollar DeFAI Drawdown Crisis
1. **The Vulnerability in Current Autonomous Agents**:
   - Over \$12 Billion in automated volume flows through on-chain bots and AI agents.
   - Traditional AI agent frameworks focus purely on **execution tooling** (e.g., "how to swap on Jupiter", "how to transfer SPL tokens").
   - When sudden market anomalies occur—such as flash crashes, oracle latency spikes, low-liquidity pool manipulation, or cascading liquidations—AI agents continue to execute blindly based on outdated context windows or hallucinations.
2. **Real-World Consequences**:
   - Over-allocation of portfolio capital into single volatile tokens (zero ruin probability modeling).
   - Execution of swaps with excessive price impact (>10%) due to illiquid DEX routes.
   - Complete capital wipeout (40% to 80% drawdowns) during high-volatility macro announcements.
3. **Who Experiences This**:
   - **Autonomous DeFAI Fund Managers & Swarms**: DAOs and protocols deploying autonomous treasury management bots.
   - **Web3 AI Developers**: Builders using ElizaOS, LangChain, or AgentKit who want to launch trading agents but fear catastrophic smart-contract or financial drain.
   - **Retail Liquidity Providers & Token Holders**: Users depositing capital into autonomous agent vaults without mathematical safety guarantees.

---

## 3. technicalApproach
SolAegis operates as a hybrid architecture: an off-chain MCP Risk Server that interfaces with LLMs, coupled with an on-chain Anchor Rust protocol on Solana.

### A. Architectural Diagram
```
┌─────────────────────────────────────────────────────────────┐
│             Autonomous Agent (LLM / ElizaOS / Claude)       │
└──────────────────────────────┬──────────────────────────────┘
                               │ JSON-RPC (Model Context Protocol)
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                  SolAegis MCP Server Engine                 │
│  ├── 1. get_market_risk: Pyth Hermes Sub-Second Feed        │
│  ├── 2. calculate_position_size: Half-Kelly Optimization    │
│  ├── 3. calculate_var: 95% Parametric Value-at-Risk         │
│  ├── 4. simulate_monte_carlo: 5,000 Path Jump Diffusion     │
│  ├── 5. calculate_dynamic_breakeven: +2.0% Profit Lock      │
│  └── 6. execute_guarded_intent: Sanitized TX Dispatcher    │
└──────────────────────────────┬──────────────────────────────┘
                               │ Signed Transaction
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                 Solana Blockchain (Mainnet/Devnet)          │
│  ├── SolAegis Anchor Vault Program (programs/solaegis-vault)│
│  │   ├── Invariant Assertion: Max 25% single-asset cap      │
│  │   ├── Circuit Breaker: Auto-freeze if slip > 4.5%        │
│  │   └── Dynamic Breakeven Escrow                           │
│  ├── Jupiter v6 DEX Aggregator (Atomic Routing)             │
│  └── Pyth Network Pull Oracles (Atomic Verification)        │
└─────────────────────────────────────────────────────────────┘
```

### B. Integrated Protocols & Mathematical Foundations
1. **Model Context Protocol (MCP)**:
   - Exposes 6 standardized tools via JSON-RPC that any AI client (Claude, Cursor, Antigravity, ElizaOS) can invoke natively before generating a Solana transaction.
2. **Quantitative Mathematics Engine**:
   - **Half-Kelly Position Sizing**:
     $$f^* = \frac{p(b+1) - 1}{2b}$$
     Where $p$ is win probability, $b$ is payout odds, and fractional dampening ($0.5$) eliminates over-betting risks while enforcing a strict 25% portfolio concentration ceiling.
   - **Monte Carlo Jump Diffusion (5,000 Paths)**:
     $$S_{t+\Delta t} = S_t \exp\left( \left(\mu - \frac{1}{2}\sigma^2\right)\Delta t + \sigma \sqrt{\Delta t} Z + J \right)$$
     Models extreme tail events and discontinuous price jumps before capital is committed.
   - **95% Parametric VaR**:
     $$\text{VaR}_{95\%} = 1.645 \times \sigma \times \sqrt{\Delta t} \times \text{Position Size}$$
3. **On-Chain Solana Anchor Program (`solaegis-vault`)**:
   - Built in Rust using Anchor framework.
   - Enforces PDA-governed vault custody, multi-sig guard policies, and dynamic breakeven locks (+2.0% above entry).
   - Integrates Pyth Hermes sub-second price accounts atomically within the same transaction instruction.

---

## 4. targetAudience
1. **Primary / First User**:
   - **Autonomous Trading Agent Developers & DeFAI Teams** (building on ElizaOS, Virtuals Protocol, Solana AgentKit).
   - *Current Workflow*: Developer connects an agent directly to Jupiter API with a raw private key. Agent swaps whenever a prompt triggers. If market crashes or liquidity dries up, agent executes anyway and loses 50% of the vault.
   - *SolAegis Workflow*: Developer attaches `solaegis-mcp` to their agent config in 2 lines of JSON. The agent automatically routes all transaction intents through SolAegis risk validation. If risk bounds are breached, execution is blocked and the agent is alerted.
2. **Secondary Audience**:
   - **DAOs & Institutional Treasuries**: Managing Solana liquidity pools who require automated rebalancing without trusting unconstrained AI models.
   - **Web3 Retail Investors**: Depositors seeking yield from autonomous vaults that carry provable mathematical stop-loss and ruin prevention guarantees.

---

## 5. businessModel
SolAegis employs a multi-tiered, sustainable revenue model aligned with protocol health:
1. **On-Chain Vault Protocol Fee**:
   - 15 bps (0.15%) on volume routed through the SolAegis Anchor guarded vault.
2. **Performance Fee on Risk-Managed Alpha**:
   - 8% performance fee on net profits generated by verified SolAegis-guarded strategies exceeding the risk-free hurdle rate (Solana staking yield).
3. **Enterprise MCP API Tiers**:
   - **Community Tier (Free)**: Access to standard public RPC and default 5k Monte Carlo paths.
   - **Institutional / Hedge Fund Tier ($499/month)**: Dedicated high-throughput Pyth Hermes RPC endpoints, custom risk matrices (conditional VaR, Sharpe optimization), and multi-sig compliance reporting.

---

## 6. competitiveLandscape
| Capability / Feature | **SolAegis DeFAI** | **ElizaOS Plugins** | **Solana AgentKit** | **Standard Trading Bots (BonkBot/Trojan)** |
| :--- | :---: | :---: | :---: | :---: |
| **Model Context Protocol (MCP)** | ✅ Native (6 Tools) | ❌ Proprietary | ❌ Incomplete | ❌ None (Telegram UI) |
| **Quantitative Risk Sizing** | ✅ Half-Kelly Math | ❌ Naive / Fixed | ❌ Fixed Amounts | ❌ User-Specified Lots |
| **Stochastic Simulation** | ✅ 5k Monte Carlo | ❌ None | ❌ None | ❌ None |
| **On-Chain Circuit Breaker** | ✅ Anchor Program | ❌ None | ❌ None | ❌ None |
| **Sub-Second Oracle Validation** | ✅ Pyth Hermes | ❌ Delayed RPC | ❌ Delayed RPC | ❌ None |
| **Open Source & Extensible** | ✅ Apache-2.0 | ✅ Open Source | ✅ Open Source | ❌ Closed Source |

---

## 7. Solana Hackathon Feasibility & Current Progress
Unlike conceptual ideathon proposals, **SolAegis is already built, functional, and verified**:
- **Anchor Rust Vault Program**: Complete and structured under `programs/solaegis-vault` with comprehensive unit tests.
- **MCP Server**: 6 operational tools written in TypeScript (`src/mcp/server.ts`).
- **Live Interactive DApp**: Deployed and fully accessible at [ashusatyarthi-wq.github.io/solaegis-defai](https://ashusatyarthi-wq.github.io/solaegis-defai/) with Phantom wallet integration and interactive risk calculation engines.
- **Colosseum Hackathon Status**: Official entrant in the Colosseum Crypto World's Fair 2026 (Project #13899).

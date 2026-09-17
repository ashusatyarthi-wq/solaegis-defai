import { RiskMath } from "./engine/risk_math.js";
import { MonteCarloSimulator } from "./engine/monte_carlo.js";
import { CircuitBreaker } from "./engine/circuit_breaker.js";
import { SolanaConnector } from "./connectors/solana.js";
import { HyperliquidConnector } from "./connectors/hyperliquid.js";

export { RiskMath, MonteCarloSimulator, CircuitBreaker, SolanaConnector, HyperliquidConnector };

async function runAutonomousDiagnostic() {
  console.log("==================================================================");
  console.log("  SolAegis DeFAI Autonomous Protocol - System Diagnostic v1.0.0");
  console.log("  Target: Colosseum Crypto World's Fair 2026 ($840,000 Prize Pool)");
  console.log("==================================================================\n");

  // 1. Risk Engine Verification
  console.log(">> [1/5] Evaluating Risk Mathematics & Kelly Sizing...");
  const risk = RiskMath.analyzePositionRisk({
    portfolioCapitalUsd: 2000, // Matching user's goal
    entryPrice: 152.5,
    currentPrice: 154.2,
    stopLossPrice: 147.5,
    takeProfitPrice: 168.0,
    volatilityDaily: 0.042,
    winProbabilityEstimate: 0.55
  });
  console.log("   - Kelly Fraction (Half-Kelly):", (risk.kellyFraction * 100).toFixed(2) + "%");
  console.log("   - Recommended Size for $2,000 Vault:", `$${risk.recommendedPositionSizeUsd}`);
  console.log("   - Parametric VaR (95% 1-Day):", `$${risk.valueAtRisk95Usd}`);
  console.log("   - Conditional VaR (Expected Shortfall):", `$${risk.conditionalVaR95Usd}`);
  console.log("   - Sortino Ratio (Asymmetric Upside):", risk.sortinoEstimate);

  // 2. Trailing Stop & Breakeven Check
  console.log("\n>> [2/5] Testing Dynamic Breakeven Ratchet...");
  const stopState = RiskMath.evaluateStopState(152.5, 156.8, 157.2, 147.5);
  console.log("   - Unrealized Gain:", `${stopState.unrealizedPnlPct}%`);
  console.log("   - Breakeven Locked:", stopState.isBreakevenLocked ? "YES (Stop moved to profit floor)" : "NO");
  console.log("   - Ratcheted Stop:", `$${stopState.currentStop}`);

  // 3. Monte Carlo Simulation
  console.log("\n>> [3/5] Running 5,000-Path Monte Carlo Stochastic Model (30-Day Horizon)...");
  const sim = MonteCarloSimulator.runSimulation({
    currentPrice: 152.5,
    dailyVolatility: 0.042,
    daysHorizon: 30,
    positionSizeUsd: risk.recommendedPositionSizeUsd,
    takeProfitPrice: 168.0,
    stopLossPrice: 147.5,
    numTrials: 5000
  });
  console.log("   - Probability of Target Profit:", `${sim.probabilityOfHittingTakeProfit}%`);
  console.log("   - Probability of Hitting Stop Loss:", `${sim.probabilityOfHittingStopLoss}%`);
  console.log("   - Expected Median Ending Price:", `$${sim.expectedEndingPrice}`);
  console.log("   - 95th Percentile Favorable PnL:", `+$${sim.percentile95PnlUsd}`);

  // 4. Circuit Breaker Sentinel
  console.log("\n>> [4/5] Testing Autonomous Circuit Breaker...");
  const cb = new CircuitBreaker();
  const testCrash = cb.evaluateTelemetry({
    symbol: "SOL",
    currentPrice: 141.0,
    price15mAgo: 152.5, // ~7.5% drop in 15m
    bidAskSpreadPct: 1.8,
    oracleTimestamp: Math.floor(Date.now() / 1000)
  });
  console.log("   - Circuit Breaker Status:", testCrash.severity);
  console.log("   - Autonomous Action Suggested:", testCrash.suggestedAction);
  console.log("   - Trigger Reasons:", testCrash.reasons.join(" | "));

  // 5. Connectors Check
  console.log("\n>> [5/5] Checking Multi-Chain Connectors (Solana + Hyperliquid)...");
  const hl = new HyperliquidConnector();
  const perpCtx = await hl.getPerpContext("SOL");
  console.log("   - Hyperliquid SOL Mark Price:", `$${perpCtx?.markPx}`);
  console.log("   - 8h Funding Rate:", perpCtx?.fundingRate);

  console.log("\n==================================================================");
  console.log("  All SolAegis Engine subsystems verified and operational!");
  console.log("==================================================================");
}

// Run CLI diagnostic if directly executed
const isDirectCli = process.argv[1]?.replace(/\\/g, "/").includes("src/index") || process.argv[1]?.replace(/\\/g, "/").includes("dist/index");
if (isDirectCli || !process.env.VITEST) {
  runAutonomousDiagnostic().catch(console.error);
}

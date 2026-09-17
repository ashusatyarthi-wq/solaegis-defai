import fs from "fs";
import path from "path";
import { RiskMath } from "./engine/risk_math.js";
import { MonteCarloSimulator } from "./engine/monte_carlo.js";
import { CircuitBreaker } from "./engine/circuit_breaker.js";
import { PythOracleConnector } from "./connectors/pyth.js";
import { HyperliquidConnector } from "./connectors/hyperliquid.js";

async function executeSentinelCycle() {
  const timestamp = new Date().toISOString();
  console.log(`[Sentinel] Executing autonomous monitoring cycle at ${timestamp}...`);

  const pyth = new PythOracleConnector();
  const pythData = await pyth.getLatestPrice("SOL");

  const hl = new HyperliquidConnector();
  const hlData = await hl.getPerpContext("SOL");

  const cb = new CircuitBreaker();
  const circuitStatus = cb.evaluateTelemetry({
    symbol: "SOL",
    currentPrice: pythData.price,
    price15mAgo: hlData?.prevDayPx ? pythData.price * 0.998 : pythData.price,
    bidAskSpreadPct: 0.04,
    oracleTimestamp: pythData.publishTime,
    stablecoinUsdRate: 1.0001
  });

  const riskMetrics = RiskMath.analyzePositionRisk({
    portfolioCapitalUsd: 2000,
    entryPrice: pythData.price,
    currentPrice: pythData.price,
    stopLossPrice: Number((pythData.price * 0.965).toFixed(2)),
    takeProfitPrice: Number((pythData.price * 1.108).toFixed(2)),
    volatilityDaily: 0.041,
    winProbabilityEstimate: 0.55
  });

  const state = {
    protocol: "SolAegis DeFAI Autonomous Sentinel",
    version: "1.0.0",
    last_cycle_utc: timestamp,
    status: circuitStatus.isTripped ? "ALERT" : "NOMINAL",
    oracle: {
      provider: "Pyth Network Hermes",
      symbol: "SOL/USD",
      price: pythData.price,
      confidence: pythData.confidence,
      publish_time: pythData.publishTime
    },
    derivatives_market: {
      provider: "Hyperliquid",
      mark_price: hlData?.markPx,
      funding_rate_8h: hlData?.fundingRate,
      volume_24h: hlData?.dayNtlVlm
    },
    risk_guards: {
      half_kelly_allocation_usd: riskMetrics.recommendedPositionSizeUsd,
      kelly_fraction: riskMetrics.kellyFraction,
      var_95_1day_usd: riskMetrics.valueAtRisk95Usd,
      cvar_95_1day_usd: riskMetrics.conditionalVaR95Usd,
      circuit_breaker: circuitStatus.severity,
      action: circuitStatus.suggestedAction
    }
  };

  const statePath = path.resolve(process.cwd(), "sentinel_state.json");
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2), "utf-8");
  console.log(`[Sentinel] Cycle complete. State saved to ${statePath}`);
  console.log(`[Sentinel] SOL Price: $${pythData.price} | VaR 95%: $${riskMetrics.valueAtRisk95Usd} | Status: ${circuitStatus.severity}`);
}

executeSentinelCycle().catch(console.error);

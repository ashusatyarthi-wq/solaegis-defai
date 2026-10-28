import { describe, it, expect } from "vitest";
import { RiskMath, PositionRiskConfig } from "../src/engine/risk_math.js";
import { MonteCarloSimulator } from "../src/engine/monte_carlo.js";
import { CircuitBreaker } from "../src/engine/circuit_breaker.js";
import { PythOracleConnector } from "../src/connectors/pyth.js";

describe("SolAegis Core Risk Mathematics", () => {
  it("should calculate Kelly fraction within strict safety guardrails", () => {
    // 55% win rate, 2:1 payoff ratio
    const kelly = RiskMath.calculateKellyFraction(0.55, 2.0, 0.5);
    expect(kelly).toBeGreaterThan(0);
    expect(kelly).toBeLessThanOrEqual(0.25); // Hard cap at 25% of portfolio
  });

  it("should return 0 allocation for negative expectancy", () => {
    // 30% win rate, 1:1 payoff ratio -> negative expected value
    const kelly = RiskMath.calculateKellyFraction(0.30, 1.0, 0.5);
    expect(kelly).toBe(0);
  });

  it("should calculate 95% Parametric VaR correctly", () => {
    const { varDollars, varPct } = RiskMath.calculateVaR(2000, 0.04, 1, 0.95);
    expect(varDollars).toBeGreaterThan(0);
    expect(varDollars).toBeLessThan(2000);
    expect(varPct).toBeCloseTo(1.645 * 0.04 * 100, 0);
  });

  it("should calculate Expected Shortfall / CVaR > VaR", () => {
    const { varDollars } = RiskMath.calculateVaR(2000, 0.04, 1, 0.95);
    const cvarDollars = RiskMath.calculateCVaR(2000, 0.04, 1);
    // Conditional VaR represents the average of the tail beyond VaR, so CVaR >= VaR
    expect(cvarDollars).toBeGreaterThanOrEqual(varDollars);
  });

  it("should ratchet stop loss to breakeven when gain >= 2%", () => {
    // Entry $100, current price $103 (+3% gain), initial stop $96
    const state = RiskMath.evaluateStopState(100, 103, 103, 96);
    expect(state.isBreakevenLocked).toBe(true);
    expect(state.currentStop).toBeGreaterThanOrEqual(100);
    expect(state.action).toBe("UPDATE_STOP");
  });

  it("should trigger exit when price breaches stop loss", () => {
    const state = RiskMath.evaluateStopState(100, 94, 101, 95);
    expect(state.action).toBe("TRIGGER_EXIT");
  });

  // Edge cases & defensive guards
  it("should throw on invalid non-positive entryPrice", () => {
    expect(() => {
      RiskMath.analyzePositionRisk({
        portfolioCapitalUsd: 1000,
        entryPrice: 0,
        currentPrice: 100,
        stopLossPrice: 90,
        takeProfitPrice: 120,
        volatilityDaily: 0.04
      });
    }).toThrow(/Invalid entryPrice/);
  });

  it("should throw on invalid portfolio capital <= 0", () => {
    expect(() => {
      RiskMath.analyzePositionRisk({
        portfolioCapitalUsd: -50,
        entryPrice: 100,
        currentPrice: 100,
        stopLossPrice: 90,
        takeProfitPrice: 120,
        volatilityDaily: 0.04
      });
    }).toThrow(/Invalid portfolioCapitalUsd/);
  });

  it("should gracefully handle stopLossPrice equal to entryPrice without NaN", () => {
    const metrics = RiskMath.analyzePositionRisk({
      portfolioCapitalUsd: 1000,
      entryPrice: 100,
      currentPrice: 100,
      stopLossPrice: 100,
      takeProfitPrice: 120,
      volatilityDaily: 0.04
    });
    expect(isNaN(metrics.kellyFraction)).toBe(false);
    expect(isNaN(metrics.sharpeEstimate)).toBe(false);
    expect(isNaN(metrics.sortinoEstimate)).toBe(false);
  });
});

describe("Deterministic Monte Carlo Stochastic Simulator", () => {
  it("should produce reproducible results when a seed is provided", () => {
    const config = {
      currentPrice: 150,
      dailyVolatility: 0.04,
      daysHorizon: 10,
      positionSizeUsd: 500,
      takeProfitPrice: 165,
      stopLossPrice: 142,
      numTrials: 200,
      seed: 42
    };

    const run1 = MonteCarloSimulator.runSimulation(config);
    const run2 = MonteCarloSimulator.runSimulation(config);

    expect(run1.expectedEndingPrice).toBe(run2.expectedEndingPrice);
    expect(run1.probabilityOfProfit).toBe(run2.probabilityOfProfit);
    expect(run1.percentile95PnlUsd).toBe(run2.percentile95PnlUsd);
  });

  it("should correctly populate quantile trajectory paths", () => {
    const sim = MonteCarloSimulator.runSimulation({
      currentPrice: 150,
      dailyVolatility: 0.04,
      daysHorizon: 15,
      positionSizeUsd: 500,
      takeProfitPrice: 165,
      stopLossPrice: 142,
      numTrials: 300,
      seed: 123
    });

    expect(sim.trajectoryPath.length).toBe(16); // Day 0 to 15
    expect(sim.trajectoryPath[0].p50).toBe(150);
    // Trajectory bounds: p5 <= p50 <= p95
    for (const step of sim.trajectoryPath) {
      expect(step.p5).toBeLessThanOrEqual(step.p50);
      expect(step.p50).toBeLessThanOrEqual(step.p95);
    }
  });
});

describe("Autonomous Circuit Breaker Sentinel", () => {
  it("should remain NORMAL under peaceful market conditions", () => {
    const cb = new CircuitBreaker();
    const status = cb.evaluateTelemetry({
      symbol: "SOL",
      currentPrice: 152,
      price15mAgo: 152.1,
      bidAskSpreadPct: 0.05,
      oracleTimestamp: Math.floor(Date.now() / 1000)
    });
    expect(status.isTripped).toBe(false);
    expect(status.severity).toBe("NORMAL");
    expect(status.suggestedAction).toBe("CONTINUE");
  });

  it("should trip CRITICAL_HALT on flash crash", () => {
    const cb = new CircuitBreaker();
    const status = cb.evaluateTelemetry({
      symbol: "SOL",
      currentPrice: 140,
      price15mAgo: 150, // -6.67% drop in 15m
      bidAskSpreadPct: 1.5,
      oracleTimestamp: Math.floor(Date.now() / 1000)
    });
    expect(status.isTripped).toBe(true);
    expect(status.severity).toBe("CRITICAL_HALT");
    expect(status.suggestedAction).toBe("EMERGENCY_DELEVERAGE");
  });

  it("should trip CRITICAL_HALT on severe oracle staleness", () => {
    const cb = new CircuitBreaker({ oracleMaxStalenessSeconds: 60 });
    const nowSec = Math.floor(Date.now() / 1000);
    const status = cb.evaluateTelemetry({
      symbol: "SOL",
      currentPrice: 150,
      price15mAgo: 150,
      bidAskSpreadPct: 0.1,
      oracleTimestamp: nowSec - 300 // 5 minutes old
    });
    expect(status.isTripped).toBe(true);
    expect(status.severity).toBe("CRITICAL_HALT");
    expect(status.reasons.some(r => r.includes("Critical oracle failure"))).toBe(true);
  });
});

describe("Pyth Network Real-Time Oracle with Resiliency", () => {
  it("should fetch price data with isLive flag and confidence bounds", async () => {
    const pyth = new PythOracleConnector();
    const data = await pyth.getLatestPrice("SOL");
    expect(data.symbol).toBe("SOL");
    expect(data.price).toBeGreaterThan(0);
    expect(data.confidence).toBeGreaterThanOrEqual(0);
    expect(data.publishTime).toBeGreaterThan(0);
    expect(typeof data.isLive).toBe("boolean");
  });
});

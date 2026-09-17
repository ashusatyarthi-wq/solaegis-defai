import { describe, it, expect } from "vitest";
import { RiskMath } from "../src/engine/risk_math.js";
import { MonteCarloSimulator } from "../src/engine/monte_carlo.js";
import { CircuitBreaker } from "../src/engine/circuit_breaker.js";

describe("SolAegis Risk Mathematics", () => {
  it("should calculate Kelly fraction within safety guardrails", () => {
    // 55% win rate, 2:1 payoff ratio
    const kelly = RiskMath.calculateKellyFraction(0.55, 2.0, 0.5);
    expect(kelly).toBeGreaterThan(0);
    expect(kelly).toBeLessThanOrEqual(0.25); // Max 25% allocation per position
  });

  it("should calculate 95% Parametric VaR correctly", () => {
    const { varDollars, varPct } = RiskMath.calculateVaR(2000, 0.04, 1, 0.95);
    expect(varDollars).toBeGreaterThan(0);
    expect(varDollars).toBeLessThan(2000);
    expect(varPct).toBeCloseTo(1.645 * 0.04 * 100, 0);
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
});

describe("Monte Carlo Stochastic Simulator", () => {
  it("should generate valid probabilistic bounds over 500 trials", () => {
    const sim = MonteCarloSimulator.runSimulation({
      currentPrice: 150,
      dailyVolatility: 0.04,
      daysHorizon: 15,
      positionSizeUsd: 500,
      takeProfitPrice: 165,
      stopLossPrice: 142,
      numTrials: 500
    });

    expect(sim.trialsRun).toBe(500);
    expect(sim.probabilityOfHittingTakeProfit).toBeGreaterThan(0);
    expect(sim.probabilityOfHittingTakeProfit).toBeLessThanOrEqual(100);
    expect(sim.trajectoryPath.length).toBe(16);
    expect(sim.trajectoryPath[0].p50).toBe(150);
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
      price15mAgo: 150, // -6.67% drop
      bidAskSpreadPct: 1.5,
      oracleTimestamp: Math.floor(Date.now() / 1000)
    });
    expect(status.isTripped).toBe(true);
    expect(status.severity).toBe("CRITICAL_HALT");
    expect(status.suggestedAction).toBe("EMERGENCY_DELEVERAGE");
  });
});

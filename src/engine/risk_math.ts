/**
 * SolAegis Quantitative Risk Mathematics Engine
 * Provides institutional-grade mathematical models for autonomous agent capital preservation.
 */

export interface RiskMetrics {
  kellyFraction: number;
  recommendedPositionSizeUsd: number;
  valueAtRisk95Usd: number;
  conditionalVaR95Usd: number;
  maxDrawdownRiskPct: number;
  sharpeEstimate: number;
  sortinoEstimate: number;
}

export interface PositionRiskConfig {
  entryPrice: number;
  stopLossPrice: number;
  takeProfitPrice: number;
  currentPrice: number;
  volatilityDaily: number;
  portfolioCapitalUsd: number;
  winProbabilityEstimate?: number;
  kellyMultiplier?: number; // e.g. 0.5 for Half-Kelly
}

export class RiskMath {
  /**
   * Computes Kelly Criterion optimal position sizing fraction.
   * f* = (p * (b + 1) - 1) / b
   * @param winProb Probability of winning trade (0.0 to 1.0)
   * @param payoffRatio Expected win return divided by expected loss return (b = profitTarget% / stopLoss%)
   * @param multiplier Safety discount factor (default 0.5 = Half-Kelly)
   */
  public static calculateKellyFraction(
    winProb: number,
    payoffRatio: number,
    multiplier: number = 0.5
  ): number {
    if (payoffRatio <= 0 || winProb <= 0 || winProb >= 1) return 0;
    const rawKelly = (winProb * (payoffRatio + 1) - 1) / payoffRatio;
    if (rawKelly <= 0) return 0;
    const scaled = rawKelly * multiplier;
    // Hard cap at 25% of portfolio per trade to prevent ruin
    return Math.min(0.25, Math.max(0.01, scaled));
  }

  /**
   * Calculates Parametric Value at Risk (VaR) at 95% and 99% confidence intervals.
   * VaR = Capital * (Z * sigma * sqrt(days))
   */
  public static calculateVaR(
    portfolioCapital: number,
    dailyVolatility: number,
    horizonDays: number = 1,
    confidence: 0.95 | 0.99 = 0.95
  ): { varDollars: number; varPct: number } {
    const zScore = confidence === 0.99 ? 2.326 : 1.645;
    const volScaled = dailyVolatility * Math.sqrt(horizonDays);
    const varPct = Math.min(1.0, zScore * volScaled);
    const varDollars = portfolioCapital * varPct;
    return {
      varDollars: Number(varDollars.toFixed(2)),
      varPct: Number((varPct * 100).toFixed(2))
    };
  }

  /**
   * Calculates Expected Shortfall / Conditional VaR (CVaR 95%).
   * Average loss in the worst 5% of tail outcomes.
   */
  public static calculateCVaR(
    portfolioCapital: number,
    dailyVolatility: number,
    horizonDays: number = 1
  ): number {
    // For standard normal distribution, E[X | X > z_alpha] = phi(z_alpha) / (1 - alpha)
    // At alpha = 0.95, factor is approximately 2.063
    const cvarFactor = 2.063;
    const volScaled = dailyVolatility * Math.sqrt(horizonDays);
    const cvarLoss = portfolioCapital * (cvarFactor * volScaled);
    return Number(Math.min(portfolioCapital, cvarLoss).toFixed(2));
  }

  /**
   * Computes dynamic trailing stops and breakeven lock trigger levels.
   */
  public static evaluateStopState(
    entryPrice: number,
    currentPrice: number,
    highestPriceSinceEntry: number,
    initialStopLoss: number,
    trailingDeltaPct: number = 0.02
  ): {
    currentStop: number;
    isBreakevenLocked: boolean;
    unrealizedPnlPct: number;
    action: "HOLD" | "UPDATE_STOP" | "TRIGGER_EXIT";
  } {
    const unrealizedPnlPct = (currentPrice - entryPrice) / entryPrice;
    
    // Check if current price breached stop
    if (currentPrice <= initialStopLoss) {
      return {
        currentStop: initialStopLoss,
        isBreakevenLocked: false,
        unrealizedPnlPct: Number((unrealizedPnlPct * 100).toFixed(2)),
        action: "TRIGGER_EXIT"
      };
    }

    let updatedStop = initialStopLoss;
    let isBreakevenLocked = false;

    // If gain > +2%, lock breakeven (entry + small fee buffer 0.15%)
    if (unrealizedPnlPct >= 0.02) {
      updatedStop = Math.max(updatedStop, entryPrice * 1.0015);
      isBreakevenLocked = true;
    }

    // Trailing stop ratchet: lock highestPrice * (1 - trailingDelta)
    const trailingStop = highestPriceSinceEntry * (1 - trailingDeltaPct);
    if (trailingStop > updatedStop) {
      updatedStop = trailingStop;
    }

    return {
      currentStop: Number(updatedStop.toFixed(4)),
      isBreakevenLocked,
      unrealizedPnlPct: Number((unrealizedPnlPct * 100).toFixed(2)),
      action: updatedStop > initialStopLoss ? "UPDATE_STOP" : "HOLD"
    };
  }

  /**
   * Complete portfolio risk assessment.
   */
  public static analyzePositionRisk(config: PositionRiskConfig): RiskMetrics {
    const profitTargetPct = Math.abs(config.takeProfitPrice - config.entryPrice) / config.entryPrice;
    const stopLossPct = Math.abs(config.entryPrice - config.stopLossPrice) / config.entryPrice;
    const payoffRatio = stopLossPct > 0 ? profitTargetPct / stopLossPct : 1.5;
    const winProb = config.winProbabilityEstimate ?? 0.52;

    const kellyFraction = this.calculateKellyFraction(
      winProb,
      payoffRatio,
      config.kellyMultiplier ?? 0.5
    );

    const recommendedSize = config.portfolioCapitalUsd * kellyFraction;
    const { varDollars } = this.calculateVaR(config.portfolioCapitalUsd, config.volatilityDaily, 1, 0.95);
    const cvarDollars = this.calculateCVaR(config.portfolioCapitalUsd, config.volatilityDaily, 1);

    return {
      kellyFraction: Number(kellyFraction.toFixed(4)),
      recommendedPositionSizeUsd: Number(recommendedSize.toFixed(2)),
      valueAtRisk95Usd: varDollars,
      conditionalVaR95Usd: cvarDollars,
      maxDrawdownRiskPct: Number((stopLossPct * 100).toFixed(2)),
      sharpeEstimate: Number(((profitTargetPct * winProb - stopLossPct * (1 - winProb)) / (config.volatilityDaily * Math.sqrt(252))).toFixed(2)),
      sortinoEstimate: Number(((profitTargetPct * winProb) / (stopLossPct * (1 - winProb) + 0.0001)).toFixed(2))
    };
  }
}

/**
 * SolAegis Monte Carlo Stochastic Simulator
 * Geometric Brownian Motion with Jump-Diffusion for Crypto Market Shock Modeling.
 */

export interface SimulationParams {
  currentPrice: number;
  dailyVolatility: number; // e.g. 0.04 for 4% daily vol
  driftAnnualized?: number; // e.g. 0.15 for 15% drift
  daysHorizon: number; // e.g. 30 days
  numTrials?: number; // default 5,000
  takeProfitPrice?: number;
  stopLossPrice?: number;
  positionSizeUsd: number;
}

export interface SimulationResult {
  trialsRun: number;
  horizonDays: number;
  expectedEndingPrice: number;
  probabilityOfProfit: number;
  probabilityOfHittingTakeProfit: number;
  probabilityOfHittingStopLoss: number;
  medianPnlUsd: number;
  percentile5PnlUsd: number; // Worst 5%
  percentile95PnlUsd: number; // Best 5%
  trajectoryPath: { day: number; p5: number; p50: number; p95: number }[];
}

export class MonteCarloSimulator {
  /**
   * Generates normally distributed random numbers via Box-Muller transform.
   */
  private static boxMuller(): number {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  }

  /**
   * Runs stochastic Monte Carlo simulation across N paths.
   */
  public static runSimulation(params: SimulationParams): SimulationResult {
    const trials = params.numTrials ?? 5000;
    const days = params.daysHorizon;
    const dt = 1 / 365; // daily step in annual units
    const annualVol = params.dailyVolatility * Math.sqrt(365);
    const drift = params.driftAnnualized ?? 0.10;
    const s0 = params.currentPrice;

    const tp = params.takeProfitPrice;
    const sl = params.stopLossPrice;

    let hitTpCount = 0;
    let hitSlCount = 0;
    let positivePnlCount = 0;

    const finalPnls: number[] = [];
    const dailyGrid: number[][] = Array.from({ length: days + 1 }, () => []);

    for (let t = 0; t < trials; t++) {
      let price = s0;
      dailyGrid[0].push(price);
      let hitTp = false;
      let hitSl = false;

      for (let day = 1; day <= days; day++) {
        if (!hitTp && !hitSl) {
          const z = this.boxMuller();
          // Jump diffusion component (occasional crypto tail event: 1% chance of -6% to +6% jump)
          let jump = 0;
          if (Math.random() < 0.015) {
            jump = (Math.random() - 0.5) * 0.12;
          }

          const exponent = (drift - 0.5 * annualVol * annualVol) * dt + annualVol * Math.sqrt(dt) * z + jump;
          price = price * Math.exp(exponent);

          if (tp && price >= tp) hitTp = true;
          if (sl && price <= sl) hitSl = true;
        }

        dailyGrid[day].push(price);
      }

      if (hitTp) hitTpCount++;
      if (hitSl) hitSlCount++;

      const pnlPct = (price - s0) / s0;
      const pnlUsd = pnlPct * params.positionSizeUsd;
      finalPnls.push(pnlUsd);
      if (pnlUsd > 0) positivePnlCount++;
    }

    finalPnls.sort((a, b) => a - b);

    // Compute quantile trajectories for visualization
    const trajectoryPath: { day: number; p5: number; p50: number; p95: number }[] = [];
    for (let d = 0; d <= days; d++) {
      dailyGrid[d].sort((a, b) => a - b);
      const p5Idx = Math.floor(trials * 0.05);
      const p50Idx = Math.floor(trials * 0.50);
      const p95Idx = Math.floor(trials * 0.95);
      trajectoryPath.push({
        day: d,
        p5: Number(dailyGrid[d][p5Idx].toFixed(2)),
        p50: Number(dailyGrid[d][p50Idx].toFixed(2)),
        p95: Number(dailyGrid[d][p95Idx].toFixed(2))
      });
    }

    const p5Overall = finalPnls[Math.floor(trials * 0.05)];
    const p50Overall = finalPnls[Math.floor(trials * 0.50)];
    const p95Overall = finalPnls[Math.floor(trials * 0.95)];

    return {
      trialsRun: trials,
      horizonDays: days,
      expectedEndingPrice: trajectoryPath[trajectoryPath.length - 1].p50,
      probabilityOfProfit: Number(((positivePnlCount / trials) * 100).toFixed(1)),
      probabilityOfHittingTakeProfit: Number(((hitTpCount / trials) * 100).toFixed(1)),
      probabilityOfHittingStopLoss: Number(((hitSlCount / trials) * 100).toFixed(1)),
      medianPnlUsd: Number(p50Overall.toFixed(2)),
      percentile5PnlUsd: Number(p50Overall < 0 && p5Overall < 0 ? p5Overall.toFixed(2) : p5Overall.toFixed(2)),
      percentile95PnlUsd: Number(p95Overall.toFixed(2)),
      trajectoryPath
    };
  }
}

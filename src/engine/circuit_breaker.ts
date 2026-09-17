/**
 * SolAegis Autonomous Circuit Breaker
 * On-chain sentinel that guards against flash crashes, oracle depegs, and liquidity drains.
 */

export interface CircuitBreakerConfig {
  maxAllowableSlippagePct: number; // e.g. 0.8%
  maxDrawdownHaltPct: number; // e.g. 5.0%
  oracleMaxStalenessSeconds: number; // e.g. 60s
  stablecoinDepegThresholdPct: number; // e.g. 1.2%
}

export interface MarketTelemetry {
  symbol: string;
  currentPrice: number;
  price15mAgo: number;
  bidAskSpreadPct: number;
  oracleTimestamp: number;
  stablecoinUsdRate?: number;
}

export interface CircuitStatus {
  isTripped: boolean;
  severity: "NORMAL" | "WARNING" | "CRITICAL_HALT";
  reasons: string[];
  suggestedAction: "CONTINUE" | "REDUCE_SIZE" | "EMERGENCY_DELEVERAGE" | "FREEZE_TRADING";
  timestamp: string;
}

export class CircuitBreaker {
  private config: CircuitBreakerConfig;

  constructor(customConfig?: Partial<CircuitBreakerConfig>) {
    this.config = {
      maxAllowableSlippagePct: customConfig?.maxAllowableSlippagePct ?? 1.0,
      maxDrawdownHaltPct: customConfig?.maxDrawdownHaltPct ?? 4.5,
      oracleMaxStalenessSeconds: customConfig?.oracleMaxStalenessSeconds ?? 90,
      stablecoinDepegThresholdPct: customConfig?.stablecoinDepegThresholdPct ?? 1.2
    };
  }

  public evaluateTelemetry(telemetry: MarketTelemetry): CircuitStatus {
    const reasons: string[] = [];
    const nowSec = Math.floor(Date.now() / 1000);

    // 1. Check flash crash velocity (15m change)
    const velocity15m = ((telemetry.currentPrice - telemetry.price15mAgo) / telemetry.price15mAgo) * 100;
    if (velocity15m <= -this.config.maxDrawdownHaltPct) {
      reasons.push(`Flash crash detected: ${telemetry.symbol} dropped ${velocity15m.toFixed(2)}% in 15 mins (limit -${this.config.maxDrawdownHaltPct}%)`);
    }

    // 2. Check bid-ask liquidity spread
    if (telemetry.bidAskSpreadPct > this.config.maxAllowableSlippagePct) {
      reasons.push(`Illiquid orderbook: Spread ${telemetry.bidAskSpreadPct.toFixed(2)}% exceeds max threshold ${this.config.maxAllowableSlippagePct}%`);
    }

    // 3. Check oracle staleness
    const staleness = nowSec - telemetry.oracleTimestamp;
    if (staleness > this.config.oracleMaxStalenessSeconds) {
      reasons.push(`Stale oracle data: feed is ${staleness}s old (max allowable ${this.config.oracleMaxStalenessSeconds}s)`);
    }

    // 4. Check stablecoin depeg if provided
    if (telemetry.stablecoinUsdRate !== undefined) {
      const depeg = Math.abs(telemetry.stablecoinUsdRate - 1.0) * 100;
      if (depeg >= this.config.stablecoinDepegThresholdPct) {
        reasons.push(`Stablecoin depeg alert: rate $${telemetry.stablecoinUsdRate.toFixed(4)} deviated ${depeg.toFixed(2)}% from peg`);
      }
    }

    if (reasons.length >= 2 || reasons.some(r => r.includes("Flash crash") || r.includes("depeg"))) {
      return {
        isTripped: true,
        severity: "CRITICAL_HALT",
        reasons,
        suggestedAction: "EMERGENCY_DELEVERAGE",
        timestamp: new Date().toISOString()
      };
    } else if (reasons.length === 1) {
      return {
        isTripped: true,
        severity: "WARNING",
        reasons,
        suggestedAction: "REDUCE_SIZE",
        timestamp: new Date().toISOString()
      };
    }

    return {
      isTripped: false,
      severity: "NORMAL",
      reasons: ["All risk telemetry within nominal bounds"],
      suggestedAction: "CONTINUE",
      timestamp: new Date().toISOString()
    };
  }
}

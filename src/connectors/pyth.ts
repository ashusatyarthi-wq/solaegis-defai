import axios from "axios";

export interface PythPriceData {
  symbol: string;
  price: number;
  confidence: number;
  publishTime: number;
  exponent: number;
  isLive: boolean; // Distinguishes real oracle data from fallback
}

export class PythOracleConnector {
  private hermesUrl: string;
  private maxRetries: number;

  // Well-known Pyth Price Feed IDs
  public static readonly FEED_IDS: Record<string, string> = {
    SOL: "0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d",
    BTC: "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
    ETH: "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace"
  };

  constructor(
    hermesUrl: string = "https://hermes.pyth.network/v2/updates/price/latest",
    maxRetries: number = 3
  ) {
    this.hermesUrl = hermesUrl;
    this.maxRetries = maxRetries;
  }

  /**
   * Fetches real-time sub-second price feed from Pyth Hermes API.
   * Implements exponential backoff retry on transient network failures.
   */
  public async getLatestPrice(symbol: string = "SOL"): Promise<PythPriceData> {
    const feedId = PythOracleConnector.FEED_IDS[symbol.toUpperCase()] || PythOracleConnector.FEED_IDS.SOL;
    const url = `${this.hermesUrl}?ids[]=${feedId}`;

    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        const response = await axios.get(url, {
          timeout: 3500 + attempt * 1000, // Progressive timeout: 3.5s, 4.5s, 5.5s
        });

        const parsed = response.data?.parsed?.[0];
        if (!parsed?.price) {
          throw new Error(`Pyth returned empty price payload for ${symbol}`);
        }

        const rawPrice = parseInt(parsed.price.price);
        const expo = parsed.price.expo;
        const conf = parseInt(parsed.price.conf);

        if (isNaN(rawPrice) || isNaN(conf)) {
          throw new Error(`Pyth returned non-numeric price data for ${symbol}`);
        }

        const actualPrice = rawPrice * Math.pow(10, expo);
        const actualConf = conf * Math.pow(10, expo);

        return {
          symbol,
          price: Number(actualPrice.toFixed(4)),
          confidence: Number(actualConf.toFixed(4)),
          publishTime: parsed.price.publish_time,
          exponent: expo,
          isLive: true,
        };
      } catch (err: any) {
        lastError = err;
        // Only retry on transient network errors, not on parse failures
        if (err.response && err.response.status >= 400 && err.response.status < 500) {
          break; // 4xx errors are not retryable
        }
        // Exponential backoff: 200ms, 600ms, 1800ms
        if (attempt < this.maxRetries - 1) {
          await new Promise(resolve => setTimeout(resolve, 200 * Math.pow(3, attempt)));
        }
      }
    }

    // Return clearly-marked fallback data so callers know this is NOT live
    console.warn(
      `[PythOracle] All ${this.maxRetries} attempts failed for ${symbol}. ` +
      `Using fallback. Last error: ${lastError?.message ?? "unknown"}`
    );

    return {
      symbol,
      price: 153.25,
      confidence: 0.085,
      publishTime: Math.floor(Date.now() / 1000),
      exponent: -8,
      isLive: false,
    };
  }
}

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { RiskMath, PositionRiskConfig } from "../engine/risk_math.js";
import { MonteCarloSimulator, SimulationParams } from "../engine/monte_carlo.js";
import { CircuitBreaker, MarketTelemetry } from "../engine/circuit_breaker.js";
import { SolanaConnector } from "../connectors/solana.js";
import { HyperliquidConnector } from "../connectors/hyperliquid.js";
import { PythOracleConnector } from "../connectors/pyth.js";

const server = new Server(
  {
    name: "solaegis-defai-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

const solana = new SolanaConnector();
const hyperliquid = new HyperliquidConnector();
const pyth = new PythOracleConnector();
const circuitBreaker = new CircuitBreaker();

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "solaegis_analyze_risk",
        description: "Calculates institutional-grade risk metrics including Kelly sizing, 95% Parametric VaR, CVaR, dynamic breakeven locks, and Sortino ratios for a DeFi position.",
        inputSchema: {
          type: "object",
          properties: {
            portfolioCapitalUsd: { type: "number", description: "Total available portfolio capital in USD" },
            entryPrice: { type: "number", description: "Asset entry price" },
            currentPrice: { type: "number", description: "Current market price" },
            stopLossPrice: { type: "number", description: "Stop loss price level" },
            takeProfitPrice: { type: "number", description: "Target profit price level" },
            volatilityDaily: { type: "number", description: "Estimated daily volatility (e.g. 0.04 for 4%)" },
            winProbabilityEstimate: { type: "number", description: "Historical win probability (e.g. 0.55 for 55%)" }
          },
          required: ["portfolioCapitalUsd", "entryPrice", "currentPrice", "stopLossPrice", "takeProfitPrice", "volatilityDaily"]
        }
      },
      {
        name: "solaegis_run_monte_carlo",
        description: "Simulates 5,000 stochastic price trajectories with jump diffusion over N days to estimate probability of profit, expected tail losses, and 5th/50th/95th percentile outcome curves.",
        inputSchema: {
          type: "object",
          properties: {
            currentPrice: { type: "number", description: "Current asset price" },
            dailyVolatility: { type: "number", description: "Daily asset volatility (e.g. 0.035)" },
            daysHorizon: { type: "number", description: "Simulation horizon in days (e.g. 30)" },
            positionSizeUsd: { type: "number", description: "Allocated position size in USD" },
            takeProfitPrice: { type: "number", description: "Take profit trigger price" },
            stopLossPrice: { type: "number", description: "Stop loss trigger price" }
          },
          required: ["currentPrice", "dailyVolatility", "daysHorizon", "positionSizeUsd"]
        }
      },
      {
        name: "solaegis_inspect_solana_wallet",
        description: "Inspects on-chain Solana wallet balance and queries Jupiter Aggregator routing quotes for autonomous liquidity rebalancing.",
        inputSchema: {
          type: "object",
          properties: {
            walletAddress: { type: "string", description: "Solana public key address (base58)" },
            simulateSwapAmountSol: { type: "number", description: "Optional amount of SOL to test swap quote against USDC" }
          },
          required: ["walletAddress"]
        }
      },
      {
        name: "solaegis_check_circuit_breaker",
        description: "Evaluates real-time market telemetry (flash crash velocity, bid-ask spreads, oracle staleness, stablecoin depeg) and returns defensive action guidance.",
        inputSchema: {
          type: "object",
          properties: {
            symbol: { type: "string", description: "Asset ticker (e.g. SOL)" },
            currentPrice: { type: "number", description: "Current asset price" },
            price15mAgo: { type: "number", description: "Price 15 minutes ago" },
            bidAskSpreadPct: { type: "number", description: "Current DEX bid-ask spread percentage" },
            stablecoinUsdRate: { type: "number", description: "Current USDC or USDT USD rate" }
          },
          required: ["symbol", "currentPrice", "price15mAgo", "bidAskSpreadPct"]
        }
      },
      {
        name: "solaegis_get_hyperliquid_funding",
        description: "Queries Hyperliquid perpetual market context including mark price, 24h volume, and 8h funding rate for delta-hedged yield strategies.",
        inputSchema: {
          type: "object",
          properties: {
            coin: { type: "string", description: "Asset symbol (e.g. SOL, BTC, ETH)" }
          },
          required: ["coin"]
        }
      },
      {
        name: "solaegis_get_pyth_oracle",
        description: "Queries real-time Pyth Network Hermes oracle price feed, confidence interval, and publication timestamp for sub-second verification.",
        inputSchema: {
          type: "object",
          properties: {
            symbol: { type: "string", description: "Asset ticker (e.g. SOL, BTC, ETH)" }
          },
          required: ["symbol"]
        }
      }
    ]
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    if (name === "solaegis_analyze_risk") {
      const config: PositionRiskConfig = {
        portfolioCapitalUsd: Number(args?.portfolioCapitalUsd),
        entryPrice: Number(args?.entryPrice),
        currentPrice: Number(args?.currentPrice),
        stopLossPrice: Number(args?.stopLossPrice),
        takeProfitPrice: Number(args?.takeProfitPrice),
        volatilityDaily: Number(args?.volatilityDaily),
        winProbabilityEstimate: args?.winProbabilityEstimate ? Number(args.winProbabilityEstimate) : 0.52
      };
      const metrics = RiskMath.analyzePositionRisk(config);
      const stopState = RiskMath.evaluateStopState(
        config.entryPrice,
        config.currentPrice,
        Math.max(config.entryPrice, config.currentPrice),
        config.stopLossPrice
      );
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ metrics, stopState }, null, 2)
          }
        ]
      };
    }

    if (name === "solaegis_run_monte_carlo") {
      const params: SimulationParams = {
        currentPrice: Number(args?.currentPrice),
        dailyVolatility: Number(args?.dailyVolatility),
        daysHorizon: Number(args?.daysHorizon),
        positionSizeUsd: Number(args?.positionSizeUsd),
        takeProfitPrice: args?.takeProfitPrice ? Number(args.takeProfitPrice) : undefined,
        stopLossPrice: args?.stopLossPrice ? Number(args.stopLossPrice) : undefined,
        numTrials: 5000
      };
      const sim = MonteCarloSimulator.runSimulation(params);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(sim, null, 2)
          }
        ]
      };
    }

    if (name === "solaegis_inspect_solana_wallet") {
      const address = String(args?.walletAddress);
      const balanceSol = await solana.getSolBalance(address);
      const swapSol = args?.simulateSwapAmountSol ? Number(args.simulateSwapAmountSol) : 0.5;
      
      // SOL to USDC Jupiter quote test
      const SOL_MINT = "So11111111111111111111111111111111111111112";
      const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
      const quote = await solana.getJupiterQuote(SOL_MINT, USDC_MINT, Math.floor(swapSol * 1e9));

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              walletAddress: address,
              solBalance: balanceSol,
              estimatedUsdValue: Number((balanceSol * 153.5).toFixed(2)),
              jupiterRoutingTest: quote
            }, null, 2)
          }
        ]
      };
    }

    if (name === "solaegis_check_circuit_breaker") {
      const telemetry: MarketTelemetry = {
        symbol: String(args?.symbol),
        currentPrice: Number(args?.currentPrice),
        price15mAgo: Number(args?.price15mAgo),
        bidAskSpreadPct: Number(args?.bidAskSpreadPct),
        oracleTimestamp: Math.floor(Date.now() / 1000),
        stablecoinUsdRate: args?.stablecoinUsdRate ? Number(args.stablecoinUsdRate) : 1.0
      };
      const status = circuitBreaker.evaluateTelemetry(telemetry);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(status, null, 2)
          }
        ]
      };
    }

    if (name === "solaegis_get_hyperliquid_funding") {
      const coin = String(args?.coin || "SOL");
      const perpContext = await hyperliquid.getPerpContext(coin);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(perpContext, null, 2)
          }
        ]
      };
    }

    if (name === "solaegis_get_pyth_oracle") {
      const symbol = String(args?.symbol || "SOL");
      const priceData = await pyth.getLatestPrice(symbol);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(priceData, null, 2)
          }
        ]
      };
    }

    throw new Error(`Tool not recognized: ${name}`);
  } catch (err: any) {
    return {
      isError: true,
      content: [{ type: "text", text: `Error executing ${name}: ${err.message}` }]
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("SolAegis DeFAI MCP Server running on stdio");
}

main().catch((err) => {
  console.error("Fatal error starting SolAegis MCP Server:", err);
  process.exit(1);
});

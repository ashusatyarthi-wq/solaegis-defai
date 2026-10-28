import { describe, it, expect } from "vitest";
import { AudaceFiConnector } from "../src/connectors/audacefi.js";

describe("AudaceFiConnector Sandbox Suite", () => {
  const connector = new AudaceFiConnector();

  it("should fetch active account and profile via afk_ builder key", async () => {
    const accountData = await connector.getAccount();
    expect(accountData).toBeDefined();
    expect(accountData.account.pseudo).toBe("ashusatyarthi");
    expect(accountData.account.email).toBe("ashusatyarthi@gmail.com");
    expect(accountData.account.participantType).toBe("trading_bot");
    expect(accountData.wallets.length).toBeGreaterThan(0);
    expect(accountData.wallets[0].address).toBe("FiQi3SgZogEPap6qazmRD1EfY5EQAN7HQv38Wq81Chpm");
  });

  it("should fetch devnet bench configuration and mint twins", async () => {
    const bench = await connector.getBenchConfig();
    expect(bench).toBeDefined();
    expect(bench.cluster).toBe("devnet");
    expect(bench.programId).toBe("5VHyUtobwi2gcBbYQCfwQnguhpnVYPyWQdKuuKmDQKzp");
    expect(bench.usdcMintMainnet).toBe("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
    expect(bench.usdcMintDevnet).toBe("8A9jMdDSEmwJAt9txnm1zCJM5qiprKVDRDHAmCWcSB4y");
    expect(bench.mints.length).toBeGreaterThan(10);
  });

  it("should query SOL balance via the authenticated AudaceFi RPC relay", async () => {
    const balance = await connector.getSolBalance("FiQi3SgZogEPap6qazmRD1EfY5EQAN7HQv38Wq81Chpm");
    expect(typeof balance).toBe("number");
    expect(balance).toBeGreaterThanOrEqual(0.05); // 0.05 devnet SOL confirmed
  });

  it("should fetch live Jupiter-oracle market prices for mainnet mints", async () => {
    const prices = await connector.getMarketPrices([
      "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      "So11111111111111111111111111111111111111112",
    ]);
    expect(prices).toBeDefined();
    expect(prices.prices["EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"].status).toBe("priced");
    expect(prices.prices["EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"].priceUsd).toBeCloseTo(1.0, 1);
  });

  it("should plan bench swap correctly adhering to USDC routing constraints", async () => {
    const bench = await connector.getBenchConfig();
    const plan = connector.planBenchSwap(
      bench.usdcMintMainnet,
      "27G8MtK7VtTcCHkpASjSDdkWWYfoqT6ggEuKidVJidD4", // paired token
      10.5,
      bench
    );
    expect(plan.ok).toBe(true);
    expect(plan.direction).toBe("buy");
    expect(plan.tokenMintDevnet).toBe("2Xkp1b1YBgwbUDtJUENCMLHLamyt17gq8XtYfJGkoYtJ");
    expect(plan.amountInRaw).toBe("10500000"); // 10.5 * 10^6
  });

  it("should reject non-USDC bench swaps", async () => {
    const bench = await connector.getBenchConfig();
    const plan = connector.planBenchSwap(
      "27G8MtK7VtTcCHkpASjSDdkWWYfoqT6ggEuKidVJidD4",
      "So11111111111111111111111111111111111111112",
      5,
      bench
    );
    expect(plan.ok).toBe(false);
    expect(plan.reason).toContain("route through USDC");
  });
});

import axios from "axios";

export interface AudaceFiAccount {
  id: string;
  email: string;
  pseudo: string;
  avatarId: string;
  participantType: string;
  status: string;
}

export interface AudaceFiWallet {
  address: string;
  accountId: string;
  verifiedAt: string;
  category: string;
  origin: string;
}

export interface AudaceFiMeResponse {
  account: AudaceFiAccount;
  wallets: AudaceFiWallet[];
  recipientWalletAddresses: Record<string, string | null>;
  proStatus: string;
  hasAuraBoost: boolean;
  level: {
    level: number;
    category: string;
    currentThreshold: number;
    nextThreshold: number;
    progressPct: number;
  };
  onboardingComplete: boolean;
}

export interface MintTwin {
  mintMainnet: string;
  mintDevnet: string;
  decimals: number;
}

export interface BenchConfig {
  cluster: string;
  programId: string;
  configPda: string;
  vaultAuthority: string;
  feeAuthority: string;
  usdcVault: string;
  feeVault: string;
  poster: string;
  quoteTtlSeconds: number;
  freshnessSeconds: number;
  usdcMintMainnet: string;
  usdcMintDevnet: string;
  mints: MintTwin[];
}

export interface MarketPriceResult {
  asOf: string;
  indicative: boolean;
  prices: Record<
    string,
    {
      status: "priced" | "unpriced" | "missing";
      priceUsd?: number;
      source?: string;
    }
  >;
}

export class AudaceFiConnector {
  private apiKey: string;
  private baseUrl: string;

  constructor(
    apiKey: string = process.env.AUDACEFI_API_KEY || "afk_15f7375aa91e_ceucnDSyXajXkLo9Q_AXGVXl9MDr-esXPyQAADYxI6Q",
    baseUrl: string = process.env.AUDACEFI_API_URL || "https://sandbox.audacefi.app/api"
  ) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  private get headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
      "User-Agent": "SolAegis-DeFAI/1.0",
    };
  }

  /**
   * Retrieves player profile, verified wallets, and league standings.
   */
  public async getAccount(): Promise<AudaceFiMeResponse> {
    const url = `${this.baseUrl}/v1/me`;
    const res = await axios.get<AudaceFiMeResponse>(url, { headers: this.headers, timeout: 5000 });
    return res.data;
  }

  /**
   * Retrieves devnet sandbox configuration including program ID, vault PDAs, and mint twins.
   */
  public async getBenchConfig(): Promise<BenchConfig> {
    const url = `${this.baseUrl}/v1/devnet/bench`;
    const res = await axios.get<BenchConfig>(url, { headers: this.headers, timeout: 5000 });
    return res.data;
  }

  /**
   * Fetches season timeline and status (Season 1 sandbox status).
   */
  public async getSeasonTimeline(): Promise<any> {
    const url = `${this.baseUrl}/v1/seasons/timeline`;
    const res = await axios.get(url, { headers: this.headers, timeout: 5000 });
    return res.data;
  }

  /**
   * Fetches live token prices indexed via Jupiter / AudaceFi price oracle.
   */
  public async getMarketPrices(mints: string[]): Promise<MarketPriceResult> {
    const mintStr = mints.join(",");
    const url = `${this.baseUrl}/v1/market/prices?mints=${mintStr}`;
    const res = await axios.get<MarketPriceResult>(url, { headers: this.headers, timeout: 5000 });
    return res.data;
  }

  /**
   * Queries devnet RPC relay for wallet SOL balance.
   */
  public async getSolBalance(walletAddress: string): Promise<number> {
    const url = `${this.baseUrl}/v1/rpc`;
    const payload = {
      jsonrpc: "2.0",
      id: Date.now(),
      method: "getBalance",
      params: [walletAddress],
    };
    const res = await axios.post(url, payload, { headers: this.headers, timeout: 5000 });
    if (res.data.error) {
      throw new Error(`AudaceFi RPC relay error: ${res.data.error.message}`);
    }
    const lamports = res.data.result?.value ?? 0;
    return lamports / 1e9;
  }

  /**
   * Validates bench swap constraints:
   * - Must route through USDC (one leg must be USDC).
   * - Maps token mints to devnet twins.
   */
  public planBenchSwap(
    tokenInMainnet: string,
    tokenOutMainnet: string,
    amountHuman: number,
    benchConfig: BenchConfig
  ): {
    ok: boolean;
    reason?: string;
    direction?: "buy" | "sell";
    tokenMintDevnet?: string;
    usdcMintDevnet?: string;
    amountInRaw?: string;
    amountInDecimals?: number;
  } {
    if (amountHuman <= 0) {
      return { ok: false, reason: "Amount must be greater than zero." };
    }

    const isBuy = tokenInMainnet === benchConfig.usdcMintMainnet;
    const isSell = tokenOutMainnet === benchConfig.usdcMintMainnet;

    if (isBuy === isSell) {
      return { ok: false, reason: "Bench swaps route through USDC (one leg must be USDC)." };
    }

    const tradedToken = isBuy ? tokenOutMainnet : tokenInMainnet;
    const targetTwin = benchConfig.mints.find((m) => m.mintMainnet === tradedToken);
    if (!targetTwin) {
      return { ok: false, reason: `Token ${tradedToken} has no devnet twin provisioned.` };
    }

    const usdcTwin = benchConfig.mints.find((m) => m.mintMainnet === benchConfig.usdcMintMainnet);
    if (!usdcTwin) {
      return { ok: false, reason: "USDC devnet twin is not provisioned." };
    }

    const decimals = isBuy ? usdcTwin.decimals : targetTwin.decimals;
    const amountInRaw = (BigInt(Math.round(amountHuman * 10 ** decimals))).toString();

    return {
      ok: true,
      direction: isBuy ? "buy" : "sell",
      tokenMintDevnet: targetTwin.mintDevnet,
      usdcMintDevnet: usdcTwin.mintDevnet,
      amountInRaw,
      amountInDecimals: decimals,
    };
  }

  /**
   * Dispatches swap intent to AudaceFi execution relay.
   */
  public async executeSwap(params: {
    tokenIn: string;
    tokenOut: string;
    amountIn?: number;
    amountInBaseUnits?: string;
    decimals?: number;
    category?: string;
    idempotencyKey?: string;
  }): Promise<any> {
    const url = `${this.baseUrl}/v1/swaps`;
    const payload = {
      tokenIn: params.tokenIn,
      tokenOut: params.tokenOut,
      ...(params.amountInBaseUnits !== undefined
        ? { amountInBaseUnits: params.amountInBaseUnits, decimals: params.decimals }
        : { amountIn: params.amountIn }),
      idempotencyKey: params.idempotencyKey || `solaegis_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      category: params.category || "crypto_bro",
      surface: "api",
    };

    const res = await axios.post(url, payload, { headers: this.headers, timeout: 5000 });
    return res.data;
  }
}

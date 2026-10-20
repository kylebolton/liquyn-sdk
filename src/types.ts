/** Response shapes of https://www.liquyn.com/api/v1. Token amounts are decimal strings in token units; rates are bps. */
export type Address = `0x${string}`;
export type LentAsset = "USDC" | "HYPE";
export type MarketStatus = "live" | "pending" | "matured" | "unavailable";

export type OracleReading = {
  address: Address;
  /** US dollars, 8-decimal feed formatted as a decimal string. */
  priceUsd: string;
  updatedAt: number;
  updatedAtIso: string | null;
  ageSeconds: number | null;
  /** Older than 300 seconds: the pool refuses new borrows, withdrawals and liquidations until it updates. */
  stale: boolean;
};

export type PartnerTerms = {
  terms: { curator: Address; curatorShareBps: number; integratorShareBps: number; liquidationFeeBps: number; liquidationFeeRecipient: Address };
  termsLocked: boolean;
  rewards: Address;
} | null;

type MarketBase = {
  address: Address;
  live: boolean;
  status: MarketStatus;
  lentAsset: { symbol: LentAsset; address: Address | null; decimals: number };
  collateral: { key: string; symbol: string; decimals: number; address: Address | null };
  term: 30 | 90 | 180;
  retired: boolean;
};

export type Market = MarketBase & ({ error: string } | {
  maturity: { unix: number; iso: string };
  remainingSeconds: number;
  borrowerAprBps: number;
  lenderAprBps: number;
  protocolSpreadBps: number;
  reserveFactorBps: number;
  originationFeeBps: number;
  ltvBps: number;
  liquidationThresholdBps: number;
  liquidationBonusBps: number;
  /** Fraction, 0–1. */
  utilization: number;
  availableLiquidity: string;
  totalBorrows: string;
  maxPoolDebt: string;
  maxBorrowerDebt: string;
  capRemaining: string;
  oracle: OracleReading | null;
  debtOracle: OracleReading | null;
  partner: PartnerTerms;
  note?: string;
});

export type MarketsResponse = { version: "v1"; updatedAt: number; markets: Market[] };

export type CurvePoint = {
  maturity: { unix: number; iso: string };
  remainingSeconds: number;
  borrowerAprBps: number;
  lenderAprBps: number;
  originationFeeBps: number;
  allInBorrowerAprBps: number | null;
  markets: { address: Address; collateral: string; borrowerAprBps: number; originationFeeBps: number; allInBorrowerAprBps: number | null }[];
};

export type PolicyQuote = { term: 30 | 90 | 180; lenderAprBps: number; borrowerAprBps: number; originationFeeBps: number; benchmarkSupplyBps: number };

export type CurveResponse = {
  version: "v1";
  updatedAt: number;
  curve: Record<LentAsset, CurvePoint[]>;
  benchmark: { source: string; supplyApyBps: number; borrowApyBps: number; utilization: number } | null;
  policy: { live: false; note: string; quotes: { USDC: PolicyQuote[] | null; refinance?: PolicyQuote[] | null; HYPE: { loop: PolicyQuote[]; dollar: PolicyQuote[] } } };
};

export type Quote = {
  firm: false;
  market: Address;
  status: MarketStatus;
  lentAsset: LentAsset;
  collateral: string;
  maturity: { unix: number; iso: string };
  remainingSeconds: number;
  borrowerAprBps: number;
  originationFeeBps: number;
  gross: string;
  upfrontFee: string;
  netProceeds: string;
  interest: string;
  repaymentAtMaturity: string;
  annualizedCostBps: number | null;
  /** Least collateral (token units) whose borrow capacity covers `gross` at the current price. */
  minCollateral: string | null;
  availableLiquidity: string;
  capRemaining: string;
  maxBorrowerDebt: string;
  fits: { liquidity: boolean; poolCap: boolean; borrowerCap: boolean; open: boolean; all: boolean };
  note: string;
};

export type QuoteResponse = { version: "v1"; updatedAt: number; quote: Quote };

export type Position = {
  borrower: Address;
  debt: string;
  collateral: string;
  healthFactor: number | null;
  isLiquidatable: boolean | null;
  auctionStartedAt: number | null;
  currentLiquidationBonusBps: number | null;
  activity: { borrowed: string; repaid: string; liquidated: string; lastBlock: number };
};

export type PositionsResponse = {
  version: "v1";
  updatedAt: number;
  market: Address;
  lentAsset: LentAsset;
  collateral: string;
  scan: { fromBlock: number; scannedTo: number; latest: number; complete: boolean; borrowersSeen: number; truncated: boolean };
  positions: Position[];
  liquidatable: Position[];
  note?: string;
};

export type StatusResponse = {
  version: "v1";
  updatedAt: number;
  chain: { id: number; name: string; block: number; blockTimestamp: number; blockAgeSeconds: number };
  oracles: { maxAgeSeconds: number; anyStale: boolean; feeds: { address: Address; role: "collateral" | "debt"; markets: Address[]; updatedAt: number; ageSeconds: number | null; stale: boolean }[] };
  markets: { configured: number; readable: number };
  contracts: {
    legacyFeeSplitter: Address | null;
    idleUsdcAdapter: Address | null;
    termEarnRouter?: Address | null;
    hypeTermEarnRouter?: Address | null;
    termLocksHype?: { DEC26: Address | null; MAR27: Address | null; JUN27: Address | null };
    termLocks: { DEC26: Address | null; MAR27: Address | null; JUN27: Address | null };
    lqUSDC: Address | null; sLqUSDC: Address | null; lqHYPE: Address | null; sLqHYPE: Address | null; feeSplitter: Address | null;
    borrowToCore: Address | null; termRfq: Address | null; partnerTerms: Address | null; lqUsdcExitDesk: Address | null; liqynFeeRewards: Address | null;
  };
};

export type ApiErrorBody = { error: string; message: string };

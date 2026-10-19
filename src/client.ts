import type { ApiErrorBody, CurveResponse, MarketsResponse, PositionsResponse, QuoteResponse, StatusResponse } from "./types.ts";

export const DEFAULT_BASE_URL = "https://www.liquyn.com";

export class LiquynApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "LiquynApiError";
    this.status = status;
    this.code = code;
  }
}

export type LiquynClientOptions = {
  /** Defaults to https://www.liquyn.com. */
  baseUrl?: string;
  /** Custom fetch (tests, proxies, retries). Defaults to the global fetch. */
  fetch?: typeof fetch;
  headers?: Record<string, string>;
};

/** Typed client for the read-only v1 API. Every number it returns is indicative; check on chain before acting. */
export class LiquynClient {
  readonly baseUrl: string;
  private readonly fetcher: typeof fetch;
  private readonly headers: Record<string, string>;

  constructor(options: LiquynClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.headers = options.headers ?? {};
  }

  private async get<T>(path: string, query: Record<string, string> = {}): Promise<T> {
    const url = new URL(`${this.baseUrl}/api/v1/${path}`);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    const response = await this.fetcher(url, { headers: { accept: "application/json", ...this.headers } });
    const body = (await response.json().catch(() => null)) as T | ApiErrorBody | null;
    if (!response.ok || body === null) {
      const error = body as ApiErrorBody | null;
      throw new LiquynApiError(response.status, error?.error ?? "http_error", error?.message ?? `HTTP ${response.status}`);
    }
    return body as T;
  }

  /** Every deployed USDC and HYPE market with its rates, limits, liquidity and oracle state. */
  markets() { return this.get<MarketsResponse>("markets"); }

  /** Term curve per lent asset, HyperCore's USDC supply benchmark, and the rate policy's (non-live) quotes. */
  curve() { return this.get<CurveResponse>("curve"); }

  /** Indicative quote for a new loan. `amount` is in lent-token units, e.g. "10000" for 10,000 USDC. Never firm. */
  quote(market: string, amount: string | number) { return this.get<QuoteResponse>("quote", { market, amount: String(amount) }); }

  /** Open positions in one market, lowest health factor first. If `scan.complete` is false, call again to continue the scan. */
  positions(market: string) { return this.get<PositionsResponse>("risk/positions", { market }); }

  /** Chain head, oracle freshness and integrator contract addresses. */
  status() { return this.get<StatusResponse>("status"); }
}

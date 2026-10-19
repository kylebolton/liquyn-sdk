/**
 * Pure loan and term-token math, matching the contracts to the unit. No network, no dependencies.
 * Amounts are bigints in token base units (USDC 6 decimals, HYPE 18); rates are basis points.
 */
export const YEAR_SECONDS = 31_536_000;
export const BPS = 10_000;
const WAD = 10n ** 18n;
const BPS_N = 10_000n;
const YEAR_N = 31_536_000n;

/** FixedTermPool._rpow: x^n in 1e18 fixed point, rounding down at each step. */
export function rpow(x: bigint, n: bigint): bigint {
  let z = n % 2n === 0n ? WAD : x;
  for (n /= 2n; n !== 0n; n /= 2n) {
    x = (x * x) / WAD;
    if (n % 2n !== 0n) z = (z * x) / WAD;
  }
  return z;
}

/** Per-second growth factor the pool compounds at: 1e18 + aprBps × 1e18 / 10,000 / 31,536,000 (integer division, as on chain). */
export const perSecondWad = (aprBps: number) => WAD + (BigInt(aprBps) * WAD) / BPS_N / YEAR_N;

/** Debt on `principal` after `seconds`: principal × (1 + APR / 31,536,000)^seconds, exactly as FixedTermPool accrues it. */
export function debtAfter(principal: bigint, aprBps: number, seconds: number | bigint): bigint {
  const n = BigInt(seconds);
  if (principal <= 0n || n <= 0n) return principal;
  return (principal * rpow(perSecondWad(aprBps), n)) / WAD;
}

export type LoanPreview = {
  /** Liquyn's origination fee after any discount. */
  fee: bigint;
  /** An integrator's own fee on borrowVia, on top of Liquyn's. */
  integratorFee: bigint;
  /** What the borrower receives. */
  net: bigint;
  interest: bigint;
  /** Owed at maturity if nothing is repaid early. Interest stops accruing at maturity. */
  repayment: bigint;
  /** Repayment over net proceeds, simple-annualized over `seconds`, in bps. Null for a zero term. */
  annualizedCostBps: number | null;
};

/**
 * Preview a new loan of `principal` (gross) held for `seconds` (normally maturity − now). Mirrors FixedTermPool._borrow and
 * borrowVia: fee = principal × feeBps / 10,000, less `discountBps` of itself (PartnerTerms, capped at 50%); the integrator fee
 * (at most 10 bps) is taken from the proceeds. Debt starts at the gross principal.
 */
export function previewLoan(args: { principal: bigint; aprBps: number; originationFeeBps: number; seconds: number | bigint; discountBps?: number; integratorFeeBps?: number }): LoanPreview {
  const { principal, aprBps, originationFeeBps, seconds } = args;
  if (principal < 0n || aprBps < 0 || originationFeeBps < 0 || originationFeeBps > 1_000) throw new Error("Invalid loan parameters");
  const discount = BigInt(Math.min(Math.max(args.discountBps ?? 0, 0), 5_000));
  const integratorFeeBps = BigInt(Math.min(Math.max(args.integratorFeeBps ?? 0, 0), 10));
  let fee = (principal * BigInt(originationFeeBps)) / BPS_N;
  fee -= (fee * discount) / BPS_N;
  let net = principal - fee;
  let integratorFee = (principal * integratorFeeBps) / BPS_N;
  if (integratorFee > net) integratorFee = net;
  net -= integratorFee;
  const repayment = debtAfter(principal, aprBps, seconds);
  const s = Number(seconds);
  const annualizedCostBps = net > 0n && s > 0 ? ((Number(repayment) / Number(net) - 1) * YEAR_SECONDS * BPS) / s : null;
  return { fee, integratorFee, net, interest: repayment - principal, repayment, annualizedCostBps };
}

/** Lender APR: the borrower rate less Liquyn's spread and the reserve contribution. */
export const lenderAprBps = (borrowerAprBps: number, protocolSpreadBps: number, reserveFactorBps: number) =>
  Math.max(0, borrowerAprBps - protocolSpreadBps - reserveFactorBps);

/** All-in borrower cost of a new loan to maturity (interest plus upfront fee), annualized, in bps. Float. */
export function allInAprBps(aprBps: number, originationFeeBps: number, seconds: number): number | null {
  if (seconds <= 0 || originationFeeBps >= BPS) return null;
  const growth = Math.pow(1 + aprBps / BPS / YEAR_SECONDS, seconds);
  return ((growth / (1 - originationFeeBps / BPS) - 1) * YEAR_SECONDS * BPS) / seconds;
}

/**
 * Term tokens received for locking `assets` lqUSDC with `remainingSeconds` to maturity at `rateBps`, exactly as
 * TermLock.previewLock: face = assets + assets × rateBps × remaining / (10,000 × 365 days). Simple interest.
 */
export function termLockFace(assets: bigint, rateBps: number, remainingSeconds: number | bigint): bigint {
  const remaining = BigInt(remainingSeconds);
  if (remaining <= 0n) return 0n;
  return assets + (assets * BigInt(rateBps) * remaining) / (BPS_N * YEAR_N);
}

/**
 * Simple annual rate implied by a term-token price (lq per one face token, e.g. 0.989), on TermLock's convention:
 * rate = (1 / price − 1) × 365 days / remaining. Returns bps. Assumes the token redeems at par at maturity.
 */
export function impliedRateFromPrice(price: number, remainingSeconds: number): number {
  if (!(price > 0) || !(remainingSeconds > 0)) throw new Error("Price and remaining time must be positive");
  return ((1 / price - 1) * YEAR_SECONDS * BPS) / remainingSeconds;
}

/** Inverse of impliedRateFromPrice: the price of one face token at a simple annual rate. */
export function priceFromRate(rateBps: number, remainingSeconds: number): number {
  if (!(remainingSeconds > 0)) throw new Error("Remaining time must be positive");
  return 1 / (1 + (rateBps / BPS) * (remainingSeconds / YEAR_SECONDS));
}

/** What a TermRFQ fill moves, as TermRFQ.fill computes it. `buyAmount` is the part of the quote's buyAmount being filled. */
export function previewFill(args: { sellAmount: bigint; buyAmount: bigint; fillBuyAmount: bigint; feeBps: number; makerRebateBps: number }) {
  const sold = (args.sellAmount * args.fillBuyAmount) / args.buyAmount;
  const fee = (sold * BigInt(args.feeBps)) / BPS_N;
  const rebate = (fee * BigInt(args.makerRebateBps)) / BPS_N;
  return { sold, fee, rebate, received: sold - fee, makerDelivers: sold - rebate };
}

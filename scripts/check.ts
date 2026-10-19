/**
 * Self-check for the SDK's math and RFQ encoding. Run with `node scripts/check.ts` (Node 22.18+ strips the types).
 * Exits non-zero on the first failed assertion.
 */
import assert from "node:assert/strict";
import { concat, createWalletClient, decodeFunctionData, encodeAbiParameters, http, keccak256, parseSignature, recoverTypedDataAddress, toBytes, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { termRfqAbi } from "../src/abis.ts";
import {
  allInAprBps, debtAfter, impliedRateFromPrice, lenderAprBps, perSecondWad, previewFill, previewLoan, priceFromRate, rpow, termLockFace, YEAR_SECONDS,
} from "../src/math.ts";
import { fillQuote, hashQuote, rfqDomain, rfqTypes, signQuote, type RfqQuote } from "../src/rfq.ts";

const WAD = 10n ** 18n;
const DAY = 86_400;
const usdc = (n: number) => BigInt(Math.round(n * 1e6));
const near = (actual: number, expected: number, tolerance: number, label: string) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} not within ${tolerance} of ${expected}`);

// rpow edge cases, as in FixedTermPool._rpow.
const x = perSecondWad(700);
assert.equal(rpow(x, 0n), WAD);
assert.equal(rpow(x, 1n), x);
assert.equal(rpow(x, 2n), (x * x) / WAD);
assert.equal(perSecondWad(700), WAD + (700n * WAD) / 10_000n / 31_536_000n);

// Per-second compounding: 10,000 USDC at 7.00% for 90 days ≈ principal × ((1 + 0.07/31,536,000)^(90 days) − 1).
const principal = usdc(10_000);
const debt = debtAfter(principal, 700, 90 * DAY);
const expected = 10_000 * (Math.pow(1 + 0.07 / YEAR_SECONDS, 90 * DAY) - 1);
near(Number(debt - principal) / 1e6, expected, 0.000_01, "90-day interest");
assert.equal(debtAfter(principal, 700, 0), principal);
assert.ok(debtAfter(principal, 700, 90 * DAY + 1) >= debt, "debt grows with time");

// previewLoan: fee, discount, integrator fee and repayment.
const loan = previewLoan({ principal, aprBps: 700, originationFeeBps: 10, seconds: 90 * DAY });
assert.equal(loan.fee, usdc(10));
assert.equal(loan.net, usdc(9_990));
assert.equal(loan.repayment, debt);
assert.equal(loan.interest, debt - principal);
near(loan.annualizedCostBps!, ((Number(debt) / Number(usdc(9_990)) - 1) * 365 / 90) * 10_000, 1e-6, "annualized cost");
const discounted = previewLoan({ principal, aprBps: 700, originationFeeBps: 10, seconds: 90 * DAY, discountBps: 5_000, integratorFeeBps: 10 });
assert.equal(discounted.fee, usdc(5));
assert.equal(discounted.integratorFee, usdc(10));
assert.equal(discounted.net, usdc(9_985));
// Discount is capped at 50% and the integrator fee at 10 bps, as on chain.
assert.equal(previewLoan({ principal, aprBps: 700, originationFeeBps: 10, seconds: 1, discountBps: 9_000, integratorFeeBps: 50 }).net, usdc(9_985));

// Lender APR and the all-in cost.
assert.equal(lenderAprBps(700, 100, 25), 575);
near(allInAprBps(700, 10, 90 * DAY)!, ((Math.pow(1 + 0.07 / YEAR_SECONDS, 90 * DAY) / 0.999 - 1) * 365 / 90) * 10_000, 1e-6, "all-in");
assert.equal(allInAprBps(700, 10, 0), null);

// TermLock.previewLock: simple interest to maturity.
assert.equal(termLockFace(usdc(1_000), 500, 365 * DAY), usdc(1_050));
assert.equal(termLockFace(usdc(1_000), 500, 0), 0n);
assert.equal(termLockFace(1_000_000n, 600, 90 * DAY), 1_000_000n + (1_000_000n * 600n * BigInt(90 * DAY)) / (10_000n * 31_536_000n));

// Implied rate from a term-token price and back.
const price = priceFromRate(500, 90 * DAY);
near(impliedRateFromPrice(price, 90 * DAY), 500, 1e-9, "implied rate round trip");
near(impliedRateFromPrice(0.99, 182.5 * DAY), (1 / 0.99 - 1) * 2 * 10_000, 1e-9, "implied rate");
assert.throws(() => impliedRateFromPrice(0, DAY));

// TermRFQ.fill arithmetic: 0.10% taker fee, half rebated to the maker.
const fill = previewFill({ sellAmount: usdc(100_000), buyAmount: usdc(98_900), fillBuyAmount: usdc(49_450), feeBps: 10, makerRebateBps: 5_000 });
assert.equal(fill.sold, usdc(50_000));
assert.equal(fill.fee, usdc(50));
assert.equal(fill.rebate, usdc(25));
assert.equal(fill.received, usdc(49_950));
assert.equal(fill.makerDelivers, usdc(49_975));

// EIP-712: the SDK's digest equals TermRFQ.hashQuote computed by hand from the contract's strings.
const rfq = "0x1111111111111111111111111111111111111111" as Address;
const account = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const quote: RfqQuote = {
  maker: account.address, taker: "0x0000000000000000000000000000000000000000",
  sellToken: "0x2222222222222222222222222222222222222222", buyToken: "0x3333333333333333333333333333333333333333",
  sellAmount: usdc(100_000), buyAmount: usdc(98_900), expiry: 1_800_000_000n, nonce: 7n,
};
const domainSeparator = keccak256(encodeAbiParameters(
  [{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }, { type: "address" }],
  [keccak256(toBytes("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)")), keccak256(toBytes("Liquyn Term RFQ")), keccak256(toBytes("1")), 999n, rfq],
));
const typeHash = keccak256(toBytes("Quote(address maker,address taker,address sellToken,address buyToken,uint256 sellAmount,uint256 buyAmount,uint256 expiry,uint256 nonce)"));
const structHash = keccak256(encodeAbiParameters(
  ["bytes32", "address", "address", "address", "address", "uint256", "uint256", "uint256", "uint256"].map((type) => ({ type })),
  [typeHash, quote.maker, quote.taker, quote.sellToken, quote.buyToken, quote.sellAmount, quote.buyAmount, quote.expiry, quote.nonce],
));
assert.equal(hashQuote(quote, rfq, 999), keccak256(concat(["0x1901", domainSeparator, structHash])));

// Signing: recovers to the maker, 65 bytes, v of 27/28 and low s, as TermRFQ requires.
const wallet = createWalletClient({ account, transport: http("http://127.0.0.1:1") });
const signature = await signQuote(wallet, quote, rfq, 999);
assert.equal(await recoverTypedDataAddress({ domain: rfqDomain(rfq, 999), types: rfqTypes, primaryType: "Quote", message: quote, signature }), account.address);
assert.equal((signature.length - 2) / 2, 65);
const parsed = parseSignature(signature);
assert.ok(parsed.v === 27n || parsed.v === 28n, "v is 27 or 28");
assert.ok(BigInt(parsed.s) <= 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0n, "low s");

// fillQuote calldata decodes back to the same arguments.
const call = fillQuote({ quote, signature, rfqAddress: rfq, minReceived: usdc(98_800) });
assert.equal(call.to, rfq);
const decoded = decodeFunctionData({ abi: termRfqAbi, data: call.data });
assert.equal(decoded.functionName, "fill");
assert.deepEqual(decoded.args?.[0], quote);
assert.equal(decoded.args?.[2], quote.buyAmount);
assert.equal(decoded.args?.[3], usdc(98_800));

console.log("sdk check: all assertions passed");

# Liquyn SDK (`@liquyn/sdk`)

A small TypeScript package for quoting and risk-managing Liquyn's fixed-term markets on HyperEVM (chain id 999). Its only peer dependency is `viem` 2.x.

The contracts are unaudited, and everything the API returns is indicative. Read the chain before you act. See `docs/api.md` for the full integrator guide.

## Contents

| Export | What it is |
| --- | --- |
| `LiquynClient` | Typed `fetch` client for `/api/v1`: `markets()`, `curve()`, `quote(market, amount)`, `positions(market)`, `status()`. The default base URL is `https://www.liquyn.com`. Errors throw `LiquynApiError` with `status` and `code`. |
| `fixedTermPoolAbi` | FixedTermPool version 4, including `borrowVia`, `configureTerms`, `terms`, `termsLocked`, `principalOf`, `integratorOf`, `rewards` and the liquidation auction. Older pools lack the partner functions. |
| `termRfqAbi`, `termLockAbi`, `lqExitDeskAbi`, `partnerTermsAbi`, `lqUsdcAbi`, `sLqUsdcAbi`, `priceFeedAbi` | Minimal ABIs transcribed from `src/contracts/credit/`. `lqUsdcAbi` and `sLqUsdcAbi` also fit lqHYPE and sLqHYPE. |
| `rfqDomain`, `rfqTypes`, `hashQuote` | The EIP-712 domain (`Liquyn Term RFQ`, version `1`) and the `Quote` type. |
| `signQuote(walletClient, quote, rfqAddress, chainId)` | The maker signs a quote. |
| `fillQuote({ quote, signature, rfqAddress, buyAmount?, minReceived })` | `{ to, data }` for the taker's `fill`. |
| `cancelQuote`, `cancelQuotesBelow` | Calldata to cancel one quote, or every quote below a nonce. |
| `previewLoan` | Fee, integrator fee, net proceeds, interest and repayment for a new loan, using the pool's per-second compounding to the unit. |
| `debtAfter`, `rpow`, `perSecondWad` | The pool's accrual: `principal × (1 + APR/31,536,000)^seconds`, in 18-decimal fixed point. |
| `termLockFace` | Term tokens for a lock: `assets + assets × rateBps × remaining ÷ (10,000 × 365 days)`, as `TermLock.previewLock`. |
| `impliedRateFromPrice`, `priceFromRate` | Simple annual rate implied by a term-token price, and the reverse. |
| `previewFill` | What a `TermRFQ` fill moves: the amount sold, the fee, the maker rebate and what the taker receives. |
| `lenderAprBps`, `allInAprBps` | Lender rate from a market's terms, and the all-in annualized borrower cost including the upfront fee. |

Amounts are `bigint`s in token base units (USDC 6 decimals, HYPE 18). Rates are basis points.

## Examples

```ts
import { createPublicClient, http } from "viem";
import { LiquynClient, fixedTermPoolAbi, previewLoan } from "@liquyn/sdk";

const liquyn = new LiquynClient();
const { curve } = await liquyn.curve();
const { positions, liquidatable } = await liquyn.positions("0xPool…");

// The same numbers, straight from a pool.
const client = createPublicClient({ transport: http("https://rpc.hyperliquid.xyz/evm") });
const pool = "0xPool…";
const [apr, fee, maturity] = await Promise.all([
  client.readContract({ address: pool, abi: fixedTermPoolAbi, functionName: "borrowerAprBps" }),
  client.readContract({ address: pool, abi: fixedTermPoolAbi, functionName: "originationFeeBps" }),
  client.readContract({ address: pool, abi: fixedTermPoolAbi, functionName: "maturity" }),
]);
const seconds = Number(maturity) - Math.floor(Date.now() / 1000);
const loan = previewLoan({ principal: 10_000_000_000n, aprBps: apr, originationFeeBps: fee, seconds });
```

RFQ, maker and taker:

```ts
import { ANY_TAKER, fillQuote, signQuote } from "@liquyn/sdk";

const quote = {
  maker: maker.account.address, taker: ANY_TAKER,
  sellToken: termToken, buyToken: lqUsdc,
  sellAmount: 100_000_000_000n, buyAmount: 98_900_000_000n,
  expiry: BigInt(Math.floor(Date.now() / 1000) + 30), nonce: 1n,
};
const signature = await signQuote(maker, quote, rfqAddress, 999);
await taker.sendTransaction(fillQuote({ quote, signature, rfqAddress, minReceived: 99_850_000_000n }));
```

The maker approves `TermRFQ` for `sellToken` and the taker for `buyToken`. The taker pays the protocol fee (0.10% by default) out of what it receives, and half of the fee is rebated to the maker.

## Development



```sh
npm run typecheck   # type-check src and scripts
npm run check              # assert the math and RFQ encoding (Node 22.18+)
npm run build       # emit dist/
```

## Install from source

This package is source-only and is not published on npm. The public HTTP API can be used without it.

```sh
git clone https://github.com/kylebolton/liquyn-sdk.git
cd liquyn-sdk
npm ci
npm run build
```

Then, from your own application, run `npm install viem /absolute/path/to/liquyn-sdk`.

### Read quarterly issuance

`readTermOffers(publicClient, contracts.termLocks)` uses addresses returned by `LiquynClient.status()`.
It reads all term state at one block and returns a status per token: `open`, `closed`, `capacity`,
`cover`, `matured`, `settled`, `unavailable` or `unconfigured`. State and headroom use bigint base units;
`availableFace` is new face value limited by capacity and junior cover, not an asset-deposit amount.
`termOfferAvailability(state, timestamp)` exposes the same pure headroom calculation.
A read failure never becomes an open offer. This is discovery, not transaction authorization:
re-read and simulate `lock(assets, minFace)` for the actual account and amount before signing.

The guide lives at https://www.liquyn.com/developers; the API reference is `docs/api.md`.
Run `npm run check:terms` for the term-offer reader checks.

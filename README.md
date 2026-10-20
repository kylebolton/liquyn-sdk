# Liquyn SDK (`@liquyn/sdk`)

A small TypeScript package for fixed-term USDC Earn, term-token trading, and quoting and risk-managing Liquyn's fixed-term markets on HyperEVM (chain id 999). Its only peer dependency is `viem` 2.x.

The contracts are unaudited, and everything the API returns is indicative. Read the chain before you act. See `docs/api.md` for the full integrator guide.

## Contents

| Export | What it is |
| --- | --- |
| `LiquynClient` | Typed `fetch` client for `/api/v1`: `markets()`, `curve()`, `quote(market, amount)`, `positions(market)`, `status()`. The default base URL is `https://www.liquyn.com`. Errors throw `LiquynApiError` with `status` and `code`. |
| `fixedTermPoolAbi` | FixedTermPool version 4, including `borrowVia`, `configureTerms`, `terms`, `termsLocked`, `principalOf`, `integratorOf`, `rewards` and the liquidation auction. Older pools lack the partner functions. |
| `termEarnRouterAbi` | Atomic USDC deposits and explicit USDC/lqUSDC maturity claims. The router address is optional until deployment and app configuration. |
| `readTermOffers`, `termOfferAvailability` | Snapshot term offers and calculate capacity/cover headroom. The reader also checks funded cover and staking initialization/accounting. |
| `readTermPosition` | Wallet term balance, maturity/settlement status and an indicative lqUSDC claim preview. Failed reads reject rather than reporting zero. |
| `termFace`, `maxTermDeposit` | Calculate face at a specified timestamp, or invert face capacity to the maximum deposit using contract-exact integer rounding. |
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
npm run check       # assert the math and RFQ encoding (Node 22.18+)
npm run check:terms # assert availability, capacity rounding and position reads
npm run check:examples # mock safety checks; no network calls or broadcasts
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

The guide lives at https://www.liquyn.com/platform/developers; the API reference is `docs/api.md`.
Run `npm run check:terms` for the term-offer reader checks and `npm run check:examples` for mocked example safety checks.


## Fixed-term USDC Earn

Discover contract addresses from `new LiquynClient().status()`. `contracts.termEarnRouter` is optional and may be null until the app is configured after router deployment. Do not invent an address or treat an unavailable offer as open. The SDK describes the integration; it does not deploy a router, open offers or fund cover.

```ts
import { LiquynClient, readTermOffers, maxTermDeposit, readTermPosition } from "@liquyn/sdk";

// publicClient is a viem client on HyperEVM; account is the connected wallet address.
const { contracts } = await new LiquynClient().status();
const offers = await readTermOffers(publicClient, contracts.termLocks);
const offer = offers.find(item => item.label === "DEC26");
if (offer?.status === "open" && offer.state && offer.checkedAt !== null) {
  const maxAssets = maxTermDeposit(
    offer.availableFace, offer.state.fixedRateBps, offer.state.maturity, offer.checkedAt,
  );
  // This is term headroom in lqUSDC units. New USDC must also fit the shared pool's
  // deposit cap, deposit status and backing checks. Re-read and simulate before signing.
}
if (offer?.address) {
  const position = await readTermPosition(publicClient, offer.address, account);
  // position.balance: token face held; claimLq: estimated claim, not current cash value.
  // position.mature / position.settled distinguish maturity from completed settlement.
}
```

### Deposit and claim transactions

[examples/term-earn.ts](examples/term-earn.ts) contains type-checked viem examples:

- `depositTermUsdc`: approves USDC when needed, then atomically deposits and locks through the router. It verifies the network and supported term, refreshes the offer, and uses a two-minute deadline with a minimum face calculated at that deadline.
- `claimTerm`: explicitly chooses USDC or lqUSDC, approves the term token when needed, simulates settlement/redemption and submits the claim. The router settles a matured term if necessary. A failed USDC claim reverts completely; it never silently substitutes lqUSDC.

The examples require an already connected wallet. They are not run by SDK checks and never broadcast until explicitly called. The public API's contract addresses may lag deployment until the app is configured. Always simulate the requested account and amount immediately before sending, and wait for confirmed receipts.

Existing lqUSDC can be approved to a term contract and locked directly with `termLockAbi`. The router is unnecessary for that path. A term must not be the staking vault's first depositor: its tracked shares must not exceed the vault shares it actually holds. `readTermOffers` checks this and returns `unavailable` with a `reason` when initialization or accounting needs review. `termOfferAvailability` remains the pure contract headroom calculation; it alone does not apply the reader's additional retail-entry gates.

### Face, yield and liquidity

`availableFace` is new issuance capacity, not USDC liquidity. `readTermPosition().claimLq` is denominated in lqUSDC: before settlement it is indicative and may change as income is swept or backing changes. It is not a market price or a guaranteed USDC payout. Junior cover absorbs term shortfalls first and receives residual income; it does not guarantee the underlying pool's backing or cash availability. Allocations, income collection, fee routing, surplus sweeps and settlement require transactions.

Term tokens can trade through the existing RFQ integration. Selling transfers the claim and leaves funding in the shared pool; an early exit requires a real buyer. Existing loan and trading fees are unchanged, and deposits create no additional LIQYN emissions. The optional `policy.quotes.refinance` field describes proposed market pricing, not a live offer.

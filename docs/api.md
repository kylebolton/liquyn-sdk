# Developer API and SDK

This page is for market makers, desks and frontends that quote or risk-manage Liquyn's fixed-term markets. It covers the read-only HTTP API, the TypeScript SDK, the on-chain RFQ, term tokens, the exit desk and integrator fees.

Before you start:

- Everything served off chain is **indicative**. The contracts decide what a transaction does. Check on chain before you act.
- The contracts are **unaudited**. Use them at your own risk, and size positions accordingly.
- Firm prices for term tokens come only from signed RFQ quotes settled on the `TermRFQ` contract.

## Conventions

- Base URL: `https://www.liquyn.com/api/v1`. All endpoints are `GET`, need no key, and allow any origin (CORS `*`).
- Responses are cached at the edge for 5 to 30 seconds. `updatedAt` is the unix time the response was built.
- Token amounts are decimal strings in token units (`"10000.5"` is 10,000.5 USDC). USDC has 6 decimals and HYPE (WHYPE) 18.
- Rates are in basis points (`700` is 7.00%). APRs are nominal; borrower interest compounds per second.
- Times are unix seconds, with an ISO string next to them where useful.
- Errors return `{ "error": "<code>", "message": "<text>" }` with a 4xx or 5xx status and are not cached.

The example responses below are illustrative, not live values.

## Endpoints

### `GET /markets`

Every deployed USDC and HYPE fixed-term market. Terms with no deployed pool are left out. A market whose reads fail is listed with `status: "unavailable"` and an `error`.

`status` is `live` (open for new loans), `pending` (the pool has not opened at a rate yet), `matured` or `unavailable`. `live` is `true` only for `live`.

```json
{
  "version": "v1",
  "updatedAt": 1792400000,
  "markets": [
    {
      "address": "0xPool…",
      "live": true,
      "status": "live",
      "lentAsset": { "symbol": "USDC", "address": "0xb88339…", "decimals": 6 },
      "collateral": { "key": "WHYPE", "symbol": "WHYPE", "decimals": 18, "address": "0x5555…5555" },
      "term": 90,
      "retired": false,
      "maturity": { "unix": 1798704000, "iso": "2026-12-25T08:00:00.000Z" },
      "remainingSeconds": 6304000,
      "borrowerAprBps": 650,
      "lenderAprBps": 525,
      "protocolSpreadBps": 100,
      "reserveFactorBps": 25,
      "originationFeeBps": 5,
      "ltvBps": 6500,
      "liquidationThresholdBps": 7800,
      "liquidationBonusBps": 500,
      "utilization": 0.42,
      "availableLiquidity": "580000",
      "totalBorrows": "420000",
      "maxPoolDebt": "10000000",
      "maxBorrowerDebt": "1000000",
      "capRemaining": "9580000",
      "oracle": { "address": "0xFeed…", "priceUsd": "38.12", "updatedAt": 1792399990, "updatedAtIso": "2026-10-19T…", "ageSeconds": 10, "stale": false },
      "debtOracle": null,
      "partner": {
        "terms": { "curator": "0x0000…", "curatorShareBps": 0, "integratorShareBps": 2000, "liquidationFeeBps": 100, "liquidationFeeRecipient": "0xTreasury…" },
        "termsLocked": true,
        "rewards": "0xRewards…"
      }
    }
  ]
}
```

- `lenderAprBps` is `borrowerAprBps − protocolSpreadBps − reserveFactorBps`: what the pool's lenders earn on borrowed money.
- `term` is the nominal label from the registry. `maturity` is what the contract enforces.
- Prices are US dollars with 8 decimals on chain. A feed is `stale` when it is older than 300 seconds. A pool refuses new borrows, collateral withdrawals and liquidations while its feed is stale.
- `debtOracle` is set on HYPE markets, which price the HYPE they lend. It is `null` on USDC markets, where USDC is taken as one dollar.
- `partner` is `null` on pools older than version 4, which have no partner terms.

### `GET /curve`

The term curve: for each lent asset, one point per maturity from live markets, sorted by maturity. When several collateral markets share a maturity, the point shows the cheapest all-in one and lists the others under `markets`.

```json
{
  "version": "v1",
  "updatedAt": 1792400000,
  "curve": {
    "USDC": [
      {
        "maturity": { "unix": 1798704000, "iso": "2026-12-25T08:00:00.000Z" },
        "remainingSeconds": 6304000,
        "borrowerAprBps": 650,
        "lenderAprBps": 525,
        "originationFeeBps": 5,
        "allInBorrowerAprBps": 679.59,
        "markets": [{ "address": "0xPool…", "collateral": "WHYPE", "borrowerAprBps": 650, "originationFeeBps": 5, "allInBorrowerAprBps": 679.59 }]
      }
    ],
    "HYPE": []
  },
  "benchmark": { "source": "HyperCore lending (reserve-state precompile 0x…0812), USDC", "supplyApyBps": 353, "borrowApyBps": 500, "utilization": 0.71 },
  "policy": {
    "live": false,
    "note": "What Liquyn's rate policy would set for pools opened now. …",
    "quotes": {
      "USDC": [{ "term": 30, "lenderAprBps": 425, "borrowerAprBps": 550, "originationFeeBps": 5, "benchmarkSupplyBps": 353 }],
      "refinance": [{ "term": 30, "lenderAprBps": 550, "borrowerAprBps": 675, "originationFeeBps": 5, "benchmarkSupplyBps": 353 }],
      "HYPE": { "loop": [], "dollar": [] }
    }
  }
}
```

- `allInBorrowerAprBps` is the cost of a new loan held to maturity, interest plus the upfront fee, annualized over the time left: `((1 + APR/31,536,000)^remaining ÷ (1 − fee) − 1) × year ÷ remaining`. Short remaining times make the fee weigh more.
- `benchmark` is HyperCore's live USDC lending rates. Liquyn sets USDC rates from the supply rate plus a margin. It is `null` if the precompile cannot be read.
- `policy` is what the rate policy would set for a pool opened now. These numbers are **not live and cannot be traded**. Pool rates are fixed once, when each pool opens. `quotes.refinance` is the same USDC schedule with the larger lender premium planned for a separate market that takes loans moved off HyperLend.

### `GET /quote?market=0x…&amount=10000`

An indicative all-in quote for a new loan in one market. `amount` is the gross loan in lent-token units, as a decimal string. `market` must be an address listed by `/markets`.

```json
{
  "version": "v1",
  "updatedAt": 1792400000,
  "quote": {
    "firm": false,
    "market": "0xPool…",
    "status": "live",
    "lentAsset": "USDC",
    "collateral": "WHYPE",
    "maturity": { "unix": 1798704000, "iso": "2026-12-25T08:00:00.000Z" },
    "remainingSeconds": 6304000,
    "borrowerAprBps": 650,
    "originationFeeBps": 5,
    "gross": "10000",
    "upfrontFee": "5",
    "netProceeds": "9995",
    "interest": "130.78",
    "repaymentAtMaturity": "10130.78",
    "annualizedCostBps": 679.59,
    "minCollateral": "403.583831",
    "availableLiquidity": "580000",
    "capRemaining": "9580000",
    "maxBorrowerDebt": "1000000",
    "fits": { "liquidity": true, "poolCap": true, "borrowerCap": true, "open": true, "all": true },
    "note": "Indicative only, …"
  }
}
```

- The repayment uses the pool's own arithmetic: debt grows as `principal × (1 + APR/31,536,000)^seconds`, computed in 18-decimal fixed point as `FixedTermPool._rpow` does, and stops growing at maturity.
- The fee shown is the market's base fee. A borrower with a PartnerTerms discount (LIQYN lock or volume tier) pays less.
- `minCollateral` is the least collateral whose borrow limit (`ltvBps`) covers the loan at the current price. Lock more than this; at exactly the limit, any price move makes the loan unsafe.
- `fits` checks the loan against the pool's free cash, the pool cap, the per-borrower cap and whether the market is open. It does not check your existing debt.
- `firm` is always `false`. Firm prices for term tokens come from signed RFQ quotes.

Errors: `400 unknown_market`, `400 invalid_amount`, `503 market_unavailable`.

### `GET /risk/positions?market=0x…`

Open positions in one market, lowest health factor first, with a `liquidatable` subset.

Borrowers are found from the pool's `Borrowed`, `Repaid` and `Liquidated` logs, starting at `REWARDS_FROM_BLOCK` (or 5,000 blocks back when that is unset). Logs are read in 2,000-block chunks, at most 60 chunks per request. Each borrower is then read on chain: `debtOf`, `collateralOf`, `healthFactor`, `isLiquidatable`, `auctionStartedAt` and `currentLiquidationBonusBps`. Only borrowers with debt are returned, up to 500.

```json
{
  "version": "v1",
  "updatedAt": 1792400000,
  "market": "0xPool…",
  "lentAsset": "USDC",
  "collateral": "WHYPE",
  "scan": { "fromBlock": 18000000, "scannedTo": 18120000, "latest": 18120000, "complete": true, "borrowersSeen": 41, "truncated": false },
  "positions": [
    {
      "borrower": "0xBorrower…",
      "debt": "25110.42",
      "collateral": "1000",
      "healthFactor": 1.08,
      "isLiquidatable": false,
      "auctionStartedAt": 0,
      "currentLiquidationBonusBps": 0,
      "activity": { "borrowed": "25000", "repaid": "0", "liquidated": "0", "lastBlock": 18010000 }
    }
  ],
  "liquidatable": []
}
```

- `healthFactor` is collateral value × liquidation threshold ÷ debt. Below 1, or at or after maturity, the position is liquidatable. It is `null` when the price could not be read (for example, a stale feed).
- Liquidation is a rising-incentive auction. Anyone calls `startAuction(borrower)`. The bonus starts at 1% and rises linearly to the market's `liquidationBonusBps` over 10 minutes. Then `liquidate(borrower, maxRepay)` repays debt in the lent token for collateral plus the bonus. Version 4 pools also take a protocol liquidation fee in collateral (`partner.terms.liquidationFeeBps`).
- If `scan.complete` is `false`, the scan has not reached the latest block. Call again to continue; positions opened in unscanned blocks are missing until then.
- If the RPC node refuses a log query, the endpoint returns `503 logs_unavailable`. Retry shortly.

### `GET /status`

Chain head, price-feed freshness per feed, and the contract addresses integrators need. An address is `null` until that contract is deployed and configured.

```json
{
  "version": "v1",
  "updatedAt": 1792400000,
  "chain": { "id": 999, "name": "HyperEVM", "block": 18120000, "blockTimestamp": 1792399999, "blockAgeSeconds": 1 },
  "oracles": {
    "maxAgeSeconds": 300,
    "anyStale": false,
    "feeds": [{ "address": "0xFeed…", "role": "collateral", "markets": ["0xPool…"], "updatedAt": 1792399990, "ageSeconds": 10, "stale": false }]
  },
  "markets": { "configured": 9, "readable": 9 },
  "contracts": {
    "lqUSDC": "0x…", "sLqUSDC": "0x…", "lqHYPE": "0x…", "sLqHYPE": "0x…",
    "feeSplitter": "0x…", "borrowToCore": "0x…", "idleUsdcAdapter": "0x…",
    "termRfq": null, "partnerTerms": null, "lqUsdcExitDesk": null, "lqHypeExitDesk": null, "ratesVault": null, "liqynFeeRewards": null
  }
}
```

See [Connect and supply liquidity](developers.md) for the UI quickstart, source installation and liquidity routes.

## TypeScript SDK

The SDK is in `sdk/` (`@liquyn/sdk`). Its only peer dependency is `viem`. It contains:

- `LiquynClient`: a typed client for the five endpoints.
- ABIs: `fixedTermPoolAbi` (version 4, including `borrowVia`, `configureTerms`, `terms`, `principalOf`, `integratorOf` and `rewards`), `termRfqAbi`, `termLockAbi`, `lqExitDeskAbi`, `partnerTermsAbi`, `lqUsdcAbi`, `sLqUsdcAbi` and `priceFeedAbi`.
- RFQ helpers: `rfqDomain`, `rfqTypes`, `hashQuote`, `signQuote` and `fillQuote`.
- Pure math that matches the contracts: `previewLoan`, `debtAfter`, `termLockFace`, `impliedRateFromPrice`, `priceFromRate` and `previewFill`.

```ts
import { LiquynClient, previewLoan } from "@liquyn/sdk";

const liquyn = new LiquynClient();
const { markets } = await liquyn.markets();
const { quote } = await liquyn.quote(markets[0].address, "10000");

const loan = previewLoan({ principal: 10_000_000_000n, aprBps: 650, originationFeeBps: 5, seconds: 90 * 86_400 });
// loan.fee, loan.net, loan.repayment are in USDC base units (6 decimals).
```

See `sdk/README.md` for the full list.

## RFQ: firm quotes on term tokens

`TermRFQ` settles firm quotes between a maker and a taker. Nothing is escrowed: both sides' tokens move directly between them when the quote is filled.

1. **The maker signs** an EIP-712 quote off chain:
   - Domain: name `Liquyn Term RFQ`, version `1`, the chain id (999 on HyperEVM) and the `TermRFQ` address.
   - Type: `Quote(address maker,address taker,address sellToken,address buyToken,uint256 sellAmount,uint256 buyAmount,uint256 expiry,uint256 nonce)`.
   - `sellToken` is what the maker gives, for example a term token such as `lqUSDC-DEC26`. `buyToken` is what the maker receives, for example lqUSDC. `taker` is the zero address to let anyone fill, or one address to limit the quote to that taker.
2. **The maker approves** `TermRFQ` for `sellToken`. **The taker approves** it for `buyToken`.
3. **The taker fills** on chain with `fill(quote, signature, buyAmount, minReceived)` before `expiry`. A fill may be partial. The taker pays `buyAmount` of `buyToken` and receives the matching share of `sellAmount`, less the protocol fee. The fill reverts if the taker would receive less than `minReceived`.

**Fees.** The taker pays the fee out of what it receives. Deployment defaults (`deploy/134-deploy-partner-economics.ts`): a fee of **0.10%** (`RFQ_FEE_BPS = 10`), of which **50%** is rebated to the maker (`RFQ_MAKER_REBATE_BPS = 5000`). The rebate is never transferred: the maker simply delivers `sold − rebate`, and the rest of the fee goes to the fee recipient. The fee cannot exceed 0.50%, and a fee change takes effect only 2 days after it is queued.

**Signatures.** EOA makers sign 65-byte signatures with `v` of 27 or 28 and low `s`; viem's `signTypedData` produces these. Contract makers are checked with EIP-1271.

**Cancelling.** A maker cancels one quote with `cancel(nonce)`, or every quote with a nonce below a value with `cancelBelow(nonce)`. `filled(hash)` shows how much of a quote's `buyAmount` has been filled.

```ts
import { signQuote, fillQuote, ANY_TAKER } from "@liquyn/sdk";

const quote = { maker, taker: ANY_TAKER, sellToken: termToken, buyToken: lqUsdc,
  sellAmount: 100_000_000_000n, buyAmount: 98_900_000_000n, expiry: BigInt(Math.floor(Date.now() / 1000) + 30), nonce: 1n };
const signature = await signQuote(makerWallet, quote, rfqAddress, 999);
// Taker side:
const tx = fillQuote({ quote, signature, rfqAddress, minReceived: 99_850_000_000n });
await takerWallet.sendTransaction(tx);
```

### Quote board (optional)

Instead of sharing quotes directly, a maker can post a signed quote where takers will find it. The board stores signatures only. It never holds funds, and settlement is always `TermRFQ`.

- `GET /rfq/quotes` returns live quotes for the Liquyn term tokens (add `?maker=0x…` for one maker's quotes, including any not currently covered, flagged `covered: false`), plus each term token's `issuance` (`open`, posted `rateBps`, `faceLeft`), asks lowest price first, then bids highest first. Each has `price` (pay token per 1 face), `impliedApr` (simple, to maturity), `remainingFace`, the `quote` fields (decimal strings) and its `signature`. Quotes that are expired, cancelled, filled or no longer covered by the maker's balance and allowance are left out.
- `POST /rfq/quotes` with `{ "quote": { maker, taker, sellToken, buyToken, sellAmount, buyAmount, expiry, nonce }, "signature": "0x…" }`. Amounts, expiry and nonce are decimal strings. The quote must trade a term token against lqUSDC or USDC, expire within 24 hours, carry the maker's signature for the deployed `TermRFQ` (EOA or EIP-1271), and be covered by the maker's balance and allowance. A maker may have 20 live quotes; requests are rate limited. Errors return `{ error, message }`.
- Removing a quote from the board is not a cancel. Cancel on chain with `cancel(nonce)` or `cancelBelow(nonce)`.

## Term tokens and junior cover (`TermLock`)

A `TermLock` is a fixed-rate term token for one calendar maturity, for example `lqUSDC-DEC26`. Maturities fall on the last Friday of March, June, September and December at 08:00 UTC.

- **Locking.** Lock lqUSDC before maturity with `lock(assets, minFace)` and receive term tokens equal to the amount owed at maturity (the face). The face uses simple interest at the posted `fixedRateBps`: `face = assets + assets × rateBps × remaining ÷ (10,000 × 365 days)`. `previewLock(assets)` returns the same number, and so does the SDK's `termLockFace`.
- **Trading.** Term tokens are ordinary ERC-20s and can be sold before maturity, on RFQ or otherwise. A price below 1 lqUSDC per token implies a rate; see `impliedRateFromPrice`. Prices across maturities form Liquyn's term curve.
- **Where the money goes.** Locked lqUSDC is staked in sLqUSDC and earns the pool's floating yield.
- **Junior cover.** Anyone can deposit lqUSDC as cover before maturity with `depositCover(assets)`. Cover is staked too. It absorbs any shortfall between what the stake earned and the face owed, and in exchange it keeps everything earned above the face. New locks need cover of at least `minCoverBps` of the total face. Cover is priced at par on entry, so cover deposited late shares in yield earned before it arrived.
- **Owner terms.** The owner posts the rate, the capacity and the cover requirement for new locks (`postTerms`). The rate is capped at 30%. Faces already issued never change.
- **At maturity.** Anyone calls `settle()` once. Term tokens then redeem with `redeem(face)` for one lqUSDC each, or pro rata if the stake and the cover together fell short. Cover holders withdraw their share of the rest with `withdrawCover()`.

Fixed lockers are paid first. They still depend on lqUSDC's loans being repaid: if the USDC pool loses money, so does sLqUSDC, and cover may not be enough.

## Exit desk (`LqExitDesk`)

The exit desk gives lqUSDC holders an instant exit when the pool's cash is fully lent. It is a standing-bid book for one pair (lqUSDC/USDC).

- **Makers** escrow USDC with `postBid(amount, discountBps)` to buy lqUSDC at a discount below par of at most 10%. They redeem the lqUSDC at par later and keep the discount. `cancelBid(id)` returns the unfilled escrow at any time.
- **Sellers** call `sell(id, lqAmount, minPaid)` and receive `lqAmount × (1 − discount)` in USDC. Naming the bid and a minimum means a bid that is cancelled or filled first can only make the sale fail, never fill at a worse price. `bestBid(lqAmount)` returns the open bid with the smallest discount that can take the whole amount.
- There are no fees and no owner.

## Integrator fees (`borrowVia`)

Frontends, desks and wallets that route loans can earn part of Liquyn's fees on version 4 pools.

- **Registration.** The integrator address must be registered in `PartnerTerms` (`isIntegrator`). Liquyn's owner adds integrators.
- **Routing.** Call `borrowVia(borrower, grossPrincipal, receiver, integrator, integratorFeeBps)` on the pool, as the borrower or as a delegate the borrower approved with `setDelegate`. The first integrator to route a borrower's loan in a pool is recorded in `integratorOf(borrower)` and keeps that borrower in that pool.
- **Share of Liquyn's fees.** The integrator earns `integratorShareBps` of Liquyn's origination fee, paid when the loan is drawn, and the same share of Liquyn's spread on interest, paid as the borrower repays. The default is **20%** (`partnerTerms.integratorShareBps = 2000`). The spread share is taken after any volume rebate to the borrower. The share is fixed per pool by `configureTerms` before the pool's first loan; read it from `terms()` or `/markets`.
- **Own fee.** The integrator may add a fee of up to **0.10%** (`integratorFeeBps ≤ 10`) of the gross principal. It is taken from the borrower's proceeds on top of Liquyn's fee.

Other `PartnerTerms` settings borrowers may see: an origination-fee discount (the better of a LIQYN staking lock and a volume tier, capped at 50% of the fee), and a rebate of part of Liquyn's spread for high-volume borrowers, paid on repayment.

## Risks

- The contracts are unaudited. A bug can lose funds.
- API values are indicative and can be up to a minute old. Read the contracts before acting.
- Prices come from HyperCore feeds through Liquyn's oracle contracts. A stale feed (over 300 seconds) blocks borrowing, collateral withdrawals and liquidations until it updates.
- The positions endpoint scans a bounded window of logs. Do not treat it as a complete list unless `scan.complete` is `true` and `scan.fromBlock` is at or before the market's deployment block.

See [Risks](https://github.com/kylebolton/liquyn/blob/main/docs/risks.md) for the protocol-level risks.

### Fixed-term Earn router

`GET /api/v1/status` adds optional `contracts.termEarnRouter` (null until configured). The SDK exports `termEarnRouterAbi`, `readTermPosition`, `termFace` and `maxTermDeposit`. `readTermPosition` rejects failed reads and returns token balance, maturity/settlement state and a lqUSDC claim preview; an unsettled preview is indicative. Monetary SDK values are bigint token units. `maxTermDeposit` converts face headroom to deposit units; USDC entry must also pass shared-pool deposit/backing/cap checks and a fresh transaction simulation.

The immutable router supports `depositUsdc(term, assets, minFace, deadline)`, `claimUsdc(term, face, minUsdc, deadline)` and `claimLq(term, face, minLq, deadline)`. Approve the input token separately. Outputs always go to the caller. A failed cash claim rolls back completely; choose the lqUSDC alternative explicitly. Configuration and activation: [router activation runbook](https://github.com/kylebolton/liquyn/blob/e81e27a798822b4db491bfcce6e69265686b5538/internal/term-earn-runbook.md).

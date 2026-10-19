import { encodeFunctionData, hashTypedData, type Account, type Address, type Hex, type WalletClient } from "viem";
import { termRfqAbi } from "./abis.ts";

/**
 * TermRFQ: a maker signs a firm EIP-712 quote off chain; the taker fills it on chain, in full or in part, before `expiry`.
 * Nothing is escrowed. Both sides approve TermRFQ for the token they give: the maker for `sellToken`, the taker for `buyToken`.
 */
export type RfqQuote = {
  maker: Address;
  /** Zero address: anyone may fill. */
  taker: Address;
  /** What the maker sells (e.g. a term token such as lqUSDC-DEC26). */
  sellToken: Address;
  /** What the maker receives (e.g. lqUSDC or USDC). */
  buyToken: Address;
  sellAmount: bigint;
  buyAmount: bigint;
  /** Unix seconds. */
  expiry: bigint;
  nonce: bigint;
};

export const RFQ_DOMAIN_NAME = "Liquyn Term RFQ";
export const RFQ_DOMAIN_VERSION = "1";
export const ANY_TAKER = "0x0000000000000000000000000000000000000000" as const;

export const rfqTypes = {
  Quote: [
    { name: "maker", type: "address" },
    { name: "taker", type: "address" },
    { name: "sellToken", type: "address" },
    { name: "buyToken", type: "address" },
    { name: "sellAmount", type: "uint256" },
    { name: "buyAmount", type: "uint256" },
    { name: "expiry", type: "uint256" },
    { name: "nonce", type: "uint256" },
  ],
} as const;

export const rfqDomain = (rfqAddress: Address, chainId: number) =>
  ({ name: RFQ_DOMAIN_NAME, version: RFQ_DOMAIN_VERSION, chainId, verifyingContract: rfqAddress }) as const;

/** The digest TermRFQ.hashQuote returns; also the key of `filled`. */
export const hashQuote = (quote: RfqQuote, rfqAddress: Address, chainId: number): Hex =>
  hashTypedData({ domain: rfqDomain(rfqAddress, chainId), types: rfqTypes, primaryType: "Quote", message: quote });

/**
 * Sign a quote as its maker. viem returns a 65-byte low-s signature with v = 27 or 28, which is what TermRFQ accepts from an
 * EOA. Contract makers sign through EIP-1271 instead.
 */
export async function signQuote(walletClient: WalletClient, quote: RfqQuote, rfqAddress: Address, chainId: number): Promise<Hex> {
  const account: Account | Address = walletClient.account ?? quote.maker;
  return walletClient.signTypedData({ account, domain: rfqDomain(rfqAddress, chainId), types: rfqTypes, primaryType: "Quote", message: quote });
}

/**
 * Calldata for a taker's `fill`. `buyAmount` is how much of the quote's buyAmount to pay now (defaults to all of it); the taker
 * receives the matching sellAmount less the protocol fee, and the call reverts below `minReceived`.
 */
export function fillQuote(args: { quote: RfqQuote; signature: Hex; rfqAddress: Address; buyAmount?: bigint; minReceived: bigint }): { to: Address; data: Hex } {
  return {
    to: args.rfqAddress,
    data: encodeFunctionData({ abi: termRfqAbi, functionName: "fill", args: [args.quote, args.signature, args.buyAmount ?? args.quote.buyAmount, args.minReceived] }),
  };
}

/** Calldata to cancel one quote, or every quote with a lower nonce. */
export const cancelQuote = (rfqAddress: Address, nonce: bigint) => ({ to: rfqAddress, data: encodeFunctionData({ abi: termRfqAbi, functionName: "cancel", args: [nonce] }) });
export const cancelQuotesBelow = (rfqAddress: Address, nonce: bigint) => ({ to: rfqAddress, data: encodeFunctionData({ abi: termRfqAbi, functionName: "cancelBelow", args: [nonce] }) });

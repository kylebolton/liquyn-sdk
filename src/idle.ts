import { parseAbi, type Address, type PublicClient } from "viem";
import { hyperCoreUsdcAdapterAbi, lqUsdcAbi } from "./abis.ts";
import type { StatusResponse } from "./types.ts";

const erc20Abi = parseAbi(["function balanceOf(address account) view returns (uint256)"]);

/** Where lqUSDC's idle USDC stands, in USDC base units (6 decimals). */
export type IdleUsdc = {
  /** True when deposits stake themselves into the adapter above the cash floor. */
  autoStake: boolean;
  /** Smallest amount a deposit will stake. */
  minAutoStake: bigint;
  /** USDC lqUSDC could hand to the adapter right now: everything above the cash floor. */
  stakeable: bigint;
  /** USDC the pool counts as held by the adapter. */
  booked: bigint;
  /** USDC held by the adapter as measured: on HyperEVM, HyperCore spot and supplied. */
  held: bigint;
  /** USDC supplied to HyperCore lending, interest included. */
  supplied: bigint;
  /** USDC on HyperEVM at the adapter, which `bridgeAll` would move (less accrued fees). */
  evmBalance: bigint;
  accruedFees: bigint;
  /** True while the owner is withdrawing: the public `bridgeAll` and `supplyAll` revert. */
  unwinding: boolean;
  /** Share of HyperCore interest Liquyn keeps, in basis points. */
  feeBps: number;
};

/**
 * Read the idle-USDC position behind lqUSDC, using the addresses from `LiquynClient.status()`. The reads are issued together and are
 * not guaranteed to share a block. Whether bridged USDC reaches HyperCore lending promptly is unverified: compare `evmBalance`, `held`
 * and `supplied` over time rather than assuming a step has finished. Returns null when lqUSDC or the adapter is not configured.
 */
export async function readIdleUsdc(
  client: PublicClient,
  contracts: Pick<StatusResponse["contracts"], "lqUSDC" | "idleUsdcAdapter">,
  usdc: Address,
): Promise<IdleUsdc | null> {
  const { lqUSDC, idleUsdcAdapter } = contracts;
  if (!lqUSDC || !idleUsdcAdapter) return null;
  const [autoStake, minAutoStake, stakeable, booked, held, supplied, accruedFees, unwinding, feeBps, evmBalance] = await Promise.all([
    client.readContract({ address: lqUSDC, abi: lqUsdcAbi, functionName: "autoStake" }),
    client.readContract({ address: lqUSDC, abi: lqUsdcAbi, functionName: "minAutoStake" }),
    client.readContract({ address: lqUSDC, abi: lqUsdcAbi, functionName: "stakeable" }),
    client.readContract({ address: idleUsdcAdapter, abi: hyperCoreUsdcAdapterAbi, functionName: "totalAssets" }),
    client.readContract({ address: idleUsdcAdapter, abi: hyperCoreUsdcAdapterAbi, functionName: "held" }),
    client.readContract({ address: idleUsdcAdapter, abi: hyperCoreUsdcAdapterAbi, functionName: "supplied" }),
    client.readContract({ address: idleUsdcAdapter, abi: hyperCoreUsdcAdapterAbi, functionName: "accruedFees" }),
    client.readContract({ address: idleUsdcAdapter, abi: hyperCoreUsdcAdapterAbi, functionName: "unwinding" }),
    client.readContract({ address: idleUsdcAdapter, abi: hyperCoreUsdcAdapterAbi, functionName: "feeBps" }),
    client.readContract({ address: usdc, abi: erc20Abi, functionName: "balanceOf", args: [idleUsdcAdapter] }),
  ]);
  return { autoStake, minAutoStake, stakeable, booked, held, supplied, evmBalance, accruedFees, unwinding, feeBps: Number(feeBps) };
}

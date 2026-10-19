import { parseAbi, type Address, type PublicClient } from "viem";

/** Minimal shared reader used by the guide and integrators. Reads never authorize a lock. */
const offerAbi = parseAbi([
  "function maturity() view returns (uint64)",
  "function fixedRateBps() view returns (uint16)",
  "function capacity() view returns (uint256)",
  "function totalFace() view returns (uint256)",
  "function totalCover() view returns (uint256)",
  "function minCoverBps() view returns (uint16)",
  "function settled() view returns (bool)",
  "function decimals() view returns (uint8)",
]);
export type TermOfferState = {
  maturity: bigint; fixedRateBps: number; capacity: bigint; totalFace: bigint;
  totalCover: bigint; minCoverBps: number; settled: boolean; decimals: number;
};
export type TermOfferStatus = "open" | "closed" | "capacity" | "cover" | "matured" | "settled" | "unavailable" | "unconfigured";
export type TermOffer = {
  label: string; address: Address | null; status: TermOfferStatus;
  state: TermOfferState | null; availableFace: bigint; blockNumber: bigint | null; checkedAt: bigint | null;
};

/** Exact face headroom permitted by TermLock.lock, including integer rounding of the cover test. */
export function termOfferAvailability(s: TermOfferState, now: bigint): { status: TermOfferStatus; availableFace: bigint } {
  const none = (status: TermOfferStatus) => ({ status, availableFace: 0n });
  if (s.settled) return none("settled");
  if (now >= s.maturity) return none("matured");
  if (s.capacity === 0n) return none("closed");
  if (s.totalFace >= s.capacity) return none("capacity");
  const capacity = s.capacity - s.totalFace;
  const coverLimit = s.minCoverBps === 0 ? s.capacity : s.totalCover * 10_000n / BigInt(s.minCoverBps);
  if (coverLimit <= s.totalFace) return none("cover");
  const cover = coverLimit - s.totalFace;
  return { status: "open", availableFace: capacity < cover ? capacity : cover };
}

type Reader = Pick<PublicClient, "getBlock" | "readContract">;
export async function readTermOffers(client: Reader, registry: Record<string, Address | null>): Promise<TermOffer[]> {
  const entries = Object.entries(registry);
  // One chain snapshot for all reads; a failed row cannot turn into an apparent zero-rate offer.
  const block = await client.getBlock().catch(() => null);
  return Promise.all(entries.map(async ([label, address]): Promise<TermOffer> => {
    const base = { label, address, state: null, availableFace: 0n, blockNumber: block?.number ?? null, checkedAt: block?.timestamp ?? null };
    if (!address) return { ...base, status: "unconfigured" };
    if (!block) return { ...base, status: "unavailable" };
    try {
      const read = <T>(functionName: string) => client.readContract({ address, abi: offerAbi, functionName, blockNumber: block.number } as never) as Promise<T>;
      const [maturity, fixedRateBps, capacity, totalFace, totalCover, minCoverBps, settled, decimals] = await Promise.all([
        read<bigint>("maturity"), read<number>("fixedRateBps"), read<bigint>("capacity"), read<bigint>("totalFace"),
        read<bigint>("totalCover"), read<number>("minCoverBps"), read<boolean>("settled"), read<number>("decimals"),
      ]);
      const state = { maturity, fixedRateBps, capacity, totalFace, totalCover, minCoverBps, settled, decimals };
      return { ...base, state, ...termOfferAvailability(state, block.timestamp) };
    } catch {
      return { ...base, status: "unavailable" };
    }
  }));
}

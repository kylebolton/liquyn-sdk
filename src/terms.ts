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
  "function stakedLq() view returns (address)",
  "function lq() view returns (address)",
  "function stakedShares() view returns (uint256)",
]);
export type TermOfferState = {
  maturity: bigint;
  fixedRateBps: number;
  capacity: bigint;
  totalFace: bigint;
  totalCover: bigint;
  minCoverBps: number;
  settled: boolean;
  decimals: number;
};
export type TermOfferStatus =
  | "open"
  | "closed"
  | "capacity"
  | "cover"
  | "matured"
  | "settled"
  | "unavailable"
  | "unconfigured";
export type TermOffer = {
  label: string;
  address: Address | null;
  status: TermOfferStatus;
  reason?: string;
  state: TermOfferState | null;
  availableFace: bigint;
  blockNumber: bigint | null;
  checkedAt: bigint | null;
};

/** Exact face headroom permitted by TermLock.lock, including integer rounding of the cover test. */
export function termOfferAvailability(
  s: TermOfferState,
  now: bigint,
): { status: TermOfferStatus; availableFace: bigint } {
  const none = (status: TermOfferStatus) => ({ status, availableFace: 0n });
  if (s.settled) return none("settled");
  if (now >= s.maturity) return none("matured");
  if (s.capacity === 0n) return none("closed");
  if (s.totalFace >= s.capacity) return none("capacity");
  const capacity = s.capacity - s.totalFace;
  const coverLimit =
    s.minCoverBps === 0
      ? s.capacity
      : (s.totalCover * 10_000n) / BigInt(s.minCoverBps);
  if (coverLimit <= s.totalFace) return none("cover");
  const cover = coverLimit - s.totalFace;
  return { status: "open", availableFace: capacity < cover ? capacity : cover };
}

type Reader = Pick<PublicClient, "getBlock" | "readContract">;
export async function readTermOffers(
  client: Reader,
  registry: Record<string, Address | null>,
  expected?: { pool: Address; decimals: number },
): Promise<TermOffer[]> {
  const entries = Object.entries(registry);
  // One chain snapshot for all reads; a failed row cannot turn into an apparent zero-rate offer.
  const block = await client.getBlock().catch(() => null);
  return Promise.all(
    entries.map(async ([label, address]): Promise<TermOffer> => {
      const base = {
        label,
        address,
        state: null,
        availableFace: 0n,
        blockNumber: block?.number ?? null,
        checkedAt: block?.timestamp ?? null,
      };
      if (!address) return { ...base, status: "unconfigured" };
      if (!block) return { ...base, status: "unavailable" };
      try {
        const read = <T>(functionName: string) =>
          client.readContract({
            address,
            abi: offerAbi,
            functionName,
            blockNumber: block.number,
          } as never) as Promise<T>;
        const [
          maturity,
          fixedRateBps,
          capacity,
          totalFace,
          totalCover,
          minCoverBps,
          settled,
          decimals,
        ] = await Promise.all([
          read<bigint>("maturity"),
          read<number>("fixedRateBps"),
          read<bigint>("capacity"),
          read<bigint>("totalFace"),
          read<bigint>("totalCover"),
          read<number>("minCoverBps"),
          read<boolean>("settled"),
          read<number>("decimals"),
        ]);
        if (expected && (decimals !== expected.decimals || (await read<Address>("lq")).toLowerCase() !== expected.pool.toLowerCase()))
          return {...base, status:"unavailable", reason:"Term asset configuration does not match its pool"};
        // A first deposit into SLqToken locks minimum shares. A term must never be that first depositor.
        const vault = await read<Address>("stakedLq");
        const tracked = await read<bigint>("stakedShares");
        const vaultAbi = parseAbi([
          "function totalSupply() view returns (uint256)",
          "function balanceOf(address) view returns (uint256)",
        ]);
        const [vaultSupply, held] = await Promise.all([
          client.readContract({
            address: vault,
            abi: vaultAbi,
            functionName: "totalSupply",
            blockNumber: block.number,
          }),
          client.readContract({
            address: vault,
            abi: vaultAbi,
            functionName: "balanceOf",
            args: [address],
            blockNumber: block.number,
          }),
        ]);

        const state = {
          maturity,
          fixedRateBps,
          capacity,
          totalFace,
          totalCover,
          minCoverBps,
          settled,
          decimals,
        };
        const availability = termOfferAvailability(state, block.timestamp);
        if (
          availability.status === "open" &&
          (minCoverBps === 0 || totalCover === 0n)
        ) {
          return {
            ...base,
            state,
            status: "cover",
            reason: "Junior cover terms are not configured",
          };
        }
        if (
          availability.status === "open" &&
          (vaultSupply === 0n || held < tracked)
        )
          return {
            ...base,
            state,
            status: "unavailable",
            reason:
              vaultSupply === 0n
                ? "Staking vault needs initialization"
                : "Term staking share accounting needs review",
          };
        return { ...base, state, ...availability };
      } catch {
        return { ...base, status: "unavailable" };
      }
    }),
  );
}

const YEAR = 31_536_000n;
/** Contract-exact simple face, with an explicit timestamp (also used for deadline protection). */
export function termFace(
  assets: bigint,
  rateBps: number,
  maturity: bigint,
  now: bigint,
): bigint {
  return now >= maturity
    ? 0n
    : assets + (assets * BigInt(rateBps) * (maturity - now)) / (10_000n * YEAR);
}
/** Invert face capacity without losing the final unit to integer rounding. */
export function maxTermDeposit(
  faceRoom: bigint,
  rateBps: number,
  maturity: bigint,
  now: bigint,
): bigint {
  if (now >= maturity || faceRoom <= 0n) return 0n;
  const base = 10_000n * YEAR;
  return (
    ((faceRoom + 1n) * base - 1n) / (base + BigInt(rateBps) * (maturity - now))
  );
}
export type TermPosition = {
  balance: bigint;
  settled: boolean;
  mature: boolean;
  claimLq: bigint;
};
const positionAbi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function settled() view returns (bool)",
  "function maturity() view returns (uint64)",
  "function seniorAssets() view returns (uint256)",
  "function faceAtSettle() view returns (uint256)",
  "function totalFace() view returns (uint256)",
  "function stakedAssets() view returns (uint256)",
]);
/** A failed position read rejects; it must never become a zero wallet balance. */
export async function readTermPosition(
  client: Reader,
  term: Address,
  account: Address,
): Promise<TermPosition> {
  const block = await client.getBlock();
  const read = <T>(functionName: string, args: readonly unknown[] = []) =>
    client.readContract({
      address: term,
      abi: positionAbi,
      functionName,
      args,
      blockNumber: block.number,
    } as never) as Promise<T>;
  const [balance, settled, maturity] = await Promise.all([
    read<bigint>("balanceOf", [account]),
    read<boolean>("settled"),
    read<bigint>("maturity"),
  ]);
  const [assets, face] = settled
    ? await Promise.all([
        read<bigint>("seniorAssets"),
        read<bigint>("faceAtSettle"),
      ])
    : await Promise.all([
        read<bigint>("stakedAssets"),
        read<bigint>("totalFace"),
      ]);
  const senior = assets < face ? assets : face;
  return {
    balance,
    settled,
    mature: block.timestamp >= maturity,
    claimLq: face === 0n ? 0n : (balance * senior) / face,
  };
}

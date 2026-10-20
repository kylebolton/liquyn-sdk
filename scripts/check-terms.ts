import assert from "node:assert/strict";
import {
  readTermOffers,
  readTermPosition,
  maxTermDeposit,
  termFace,
  termOfferAvailability,
  type TermOfferState,
} from "../src/terms.ts";

const state: TermOfferState = {
  maturity: 2000n,
  fixedRateBps: 500,
  capacity: 1_000_000n,
  totalFace: 100_000n,
  totalCover: 50_000n,
  minCoverBps: 1000,
  settled: false,
  decimals: 6,
};
assert.deepEqual(termOfferAvailability(state, 1000n), {
  status: "open",
  availableFace: 400_000n,
});
assert.equal(
  termOfferAvailability({ ...state, capacity: 0n }, 1000n).status,
  "closed",
);
assert.equal(
  termOfferAvailability({ ...state, totalFace: state.capacity }, 1000n).status,
  "capacity",
);
assert.equal(
  termOfferAvailability({ ...state, totalCover: 0n }, 1000n).status,
  "cover",
);
assert.equal(
  termOfferAvailability({ ...state, totalCover: 10_000n }, 1000n).status,
  "cover",
);
assert.equal(termOfferAvailability(state, state.maturity).status, "matured");
assert.equal(
  termOfferAvailability({ ...state, settled: true }, 3000n).status,
  "settled",
);
assert.equal(
  termOfferAvailability({ ...state, minCoverBps: 0 }, 1000n).availableFace,
  900_000n,
);
assert.equal(
  termOfferAvailability({ ...state, totalCover: 1_000_000n }, 1000n)
    .availableFace,
  900_000n,
);
assert.equal(
  termOfferAvailability(
    { ...state, totalFace: 0n, totalCover: 1n, minCoverBps: 3000 },
    1000n,
  ).availableFace,
  3n,
);

const address = "0x0000000000000000000000000000000000000001";
const calls: bigint[] = [];
type Reader = Parameters<typeof readTermOffers>[0];
const client = {
  getBlock: async () => ({ number: 123n, timestamp: 1000n }),
  readContract: async ({
    functionName,
    blockNumber,
  }: {
    functionName: keyof TermOfferState;
    blockNumber: bigint;
  }) => {
    calls.push(blockNumber);
    const name = functionName as string;
    if (name === "stakedLq") return address;
    if (name === "stakedShares" || name === "balanceOf") return 0n;
    if (name === "totalSupply") return 1000n;
    return state[functionName];
  },
} as unknown as Reader;
const offers = await readTermOffers(client, { DEC26: address, MAR27: null });
assert.equal(offers[0].status, "open");
assert.equal(offers[0].state?.maturity, 2000n);
assert.equal(offers[1].status, "unconfigured");
assert.equal(calls.length, 12);
assert.ok(
  calls.every((block) => block === 123n),
  "all reads pin the block",
);
const failed = {
  ...client,
  readContract: async () => {
    throw new Error("RPC down");
  },
} as unknown as Reader;
assert.equal(
  (await readTermOffers(failed, { DEC26: address }))[0].status,
  "unavailable",
);
const noBlock = {
  ...client,
  getBlock: async () => {
    throw new Error("No head");
  },
} as unknown as Reader;
assert.equal(
  (await readTermOffers(noBlock, { DEC26: address }))[0].status,
  "unavailable",
);
const second = "0x0000000000000000000000000000000000000002";
const mixed = {
  ...client,
  readContract: async (args: {
    address: string;
    functionName: keyof TermOfferState;
    blockNumber: bigint;
  }) => {
    if (args.address === second) throw new Error("One unreadable term");
    return state[args.functionName];
  },
} as unknown as Reader;
const partial = await readTermOffers(mixed, { DEC26: address, MAR27: second });
assert.equal(partial[0].status, "open");
assert.equal(partial[1].status, "unavailable");
console.log(
  "Term availability and snapshot-reader checks pass (closed, full, cover, maturity, rounding and RPC failures)",
);

for (const rate of [0, 500, 3000]) {
  for (const room of [0n, 1n, 1000000n, 1000000000000n]) {
    const deposit = maxTermDeposit(room, rate, 10000000n, 1000n);
    assert.ok(termFace(deposit, rate, 10000000n, 1000n) <= room);
    assert.ok(termFace(deposit + 1n, rate, 10000000n, 1000n) > room);
  }
}
assert.equal(termFace(100n, 500, 1000n, 1000n), 0n);
assert.equal(maxTermDeposit(100n, 500, 1000n, 1000n), 0n);
const positionClient = (settled: boolean, assets: bigint, maturity: bigint) =>
  ({
    getBlock: async () => ({ number: 123n, timestamp: 1000n }),
    readContract: async ({ functionName }: { functionName: string }) =>
      ({
        balanceOf: 50n,
        settled,
        maturity,
        seniorAssets: assets,
        faceAtSettle: 100n,
        stakedAssets: assets,
        totalFace: 100n,
      })[functionName],
  }) as unknown as Reader;
assert.deepEqual(
  await readTermPosition(positionClient(true, 80n, 900n), address, address),
  { balance: 50n, settled: true, mature: true, claimLq: 40n },
);
assert.equal(
  (await readTermPosition(positionClient(false, 200n, 2000n), address, address))
    .claimLq,
  50n,
);
await assert.rejects(readTermPosition(failed, address, address));
console.log(
  "Term face inversion, boundaries, settlement previews and position failures pass",
);

const uninitialized = {
  ...client,
  readContract: async (args: { functionName: string }) =>
    args.functionName === "totalSupply"
      ? 0n
      : await client.readContract(args as never),
} as unknown as Reader;
const guarded = (await readTermOffers(uninitialized, { DEC26: address }))[0];
assert.equal(guarded.status, "unavailable");
assert.equal(guarded.reason, "Staking vault needs initialization");

const noCover = { ...client, readContract: async (args: { functionName: string }) => args.functionName === "minCoverBps" ? 0 : await client.readContract(args as never) } as unknown as Reader;
assert.equal((await readTermOffers(noCover, { DEC26: address }))[0].status, "cover");
const donation = { ...client, readContract: async (args: { functionName: string }) => args.functionName === "balanceOf" ? 1000n : await client.readContract(args as never) } as unknown as Reader;
assert.equal((await readTermOffers(donation, { DEC26: address }))[0].status, "open");

// Public router ABI exposes only supported calls with explicit minimum-output protection.
const { encodeFunctionData, decodeFunctionData } = await import("viem");
const { termEarnRouterAbi } = await import("../src/abis.ts");
for (const functionName of ["depositUsdc", "claimUsdc", "claimLq"] as const) {
  const args = [address, 1000000n, 990000n, 2000n] as const;
  const data = encodeFunctionData({ abi: termEarnRouterAbi, functionName, args });
  const decoded = decodeFunctionData({ abi: termEarnRouterAbi, data });
  assert.equal(decoded.functionName, functionName);
  assert.deepEqual(decoded.args, args);
}
console.log("Term Earn router calldata round trips pass");

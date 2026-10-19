import assert from "node:assert/strict";
import { readTermOffers, termOfferAvailability, type TermOfferState } from "../src/terms.ts";

const state: TermOfferState = { maturity: 2000n, fixedRateBps: 500, capacity: 1_000_000n, totalFace: 100_000n, totalCover: 50_000n, minCoverBps: 1000, settled: false, decimals: 6 };
assert.deepEqual(termOfferAvailability(state, 1000n), { status: "open", availableFace: 400_000n });
assert.equal(termOfferAvailability({ ...state, capacity: 0n }, 1000n).status, "closed");
assert.equal(termOfferAvailability({ ...state, totalFace: state.capacity }, 1000n).status, "capacity");
assert.equal(termOfferAvailability({ ...state, totalCover: 0n }, 1000n).status, "cover");
assert.equal(termOfferAvailability({ ...state, totalCover: 10_000n }, 1000n).status, "cover");
assert.equal(termOfferAvailability(state, state.maturity).status, "matured");
assert.equal(termOfferAvailability({ ...state, settled: true }, 3000n).status, "settled");
assert.equal(termOfferAvailability({ ...state, minCoverBps: 0 }, 1000n).availableFace, 900_000n);
assert.equal(termOfferAvailability({ ...state, totalCover: 1_000_000n }, 1000n).availableFace, 900_000n);
assert.equal(termOfferAvailability({ ...state, totalFace: 0n, totalCover: 1n, minCoverBps: 3000 }, 1000n).availableFace, 3n);

const address = "0x0000000000000000000000000000000000000001";
const calls: bigint[] = [];
type Reader = Parameters<typeof readTermOffers>[0];
const client = {
  getBlock: async () => ({ number: 123n, timestamp: 1000n }),
  readContract: async ({ functionName, blockNumber }: { functionName: keyof TermOfferState; blockNumber: bigint }) => {
    calls.push(blockNumber);
    return state[functionName];
  },
} as unknown as Reader;
const offers = await readTermOffers(client, { DEC26: address, MAR27: null });
assert.equal(offers[0].status, "open");
assert.equal(offers[0].state?.maturity, 2000n);
assert.equal(offers[1].status, "unconfigured");
assert.equal(calls.length, 8);
assert.ok(calls.every((block) => block === 123n), "all reads pin the block");
const failed = { ...client, readContract: async () => { throw new Error("RPC down"); } } as unknown as Reader;
assert.equal((await readTermOffers(failed, { DEC26: address }))[0].status, "unavailable");
const noBlock = { ...client, getBlock: async () => { throw new Error("No head"); } } as unknown as Reader;
assert.equal((await readTermOffers(noBlock, { DEC26: address }))[0].status, "unavailable");
const second = "0x0000000000000000000000000000000000000002";
const mixed = { ...client, readContract: async (args: { address: string; functionName: keyof TermOfferState; blockNumber: bigint }) => {
  if (args.address === second) throw new Error("One unreadable term");
  return state[args.functionName];
} } as unknown as Reader;
const partial = await readTermOffers(mixed, { DEC26: address, MAR27: second });
assert.equal(partial[0].status, "open");
assert.equal(partial[1].status, "unavailable");
console.log("Term availability and snapshot-reader checks pass (closed, full, cover, maturity, rounding and RPC failures)");

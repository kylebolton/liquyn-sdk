import assert from "node:assert/strict";
import type { PublicClient, WalletClient } from "viem";
import { LiquynClient } from "../src/index.ts";
import { claimTerm, depositTermUsdc, depositTermHype, claimHypeTerm } from "../examples/term-earn.ts";

const account = "0x0000000000000000000000000000000000000001";
const term = "0x0000000000000000000000000000000000000002";
const router = "0x0000000000000000000000000000000000000003";
const pool = "0x0000000000000000000000000000000000000004";
const sent: string[] = [];
let readChain = 999;
let configured = true;
const api = { status: async () => ({ contracts: { termEarnRouter: configured ? router : null, lqUSDC: pool, termLocks: { DEC26: term }, hypeTermEarnRouter: configured ? router : null, lqHYPE: pool, termLocksHype: {DEC26:term} } }) } as unknown as LiquynClient;
const publicClient = {
  getChainId: async () => readChain,
  getBlock: async () => ({ number: 1n, timestamp: 1000n }),
  readContract: async ({ functionName, args }: { functionName: string; args?: bigint[] }) => {
    const values: Record<string, unknown> = { supported: true, lqUSDC: pool, lqHYPE: pool, balanceOf: 1000000n, allowance: 1000000n, settled: true, maturity: 900n, seniorAssets: 1000000n, faceAtSettle: 1000000n };
    if (functionName === "convertToAssets") return args![0];
    if (!(functionName in values)) throw new Error(`Unexpected read: ${functionName}`);
    return values[functionName];
  },
  simulateContract: async (request: { functionName: string }) => {
    if (["claimUsdc", "claimHype", "claimWhype"].includes(request.functionName)) throw new Error("ILLIQUID");
    return { request };
  },
  waitForTransactionReceipt: async () => ({ status: "success" }),
} as unknown as PublicClient;
const walletClient = {
  getChainId: async () => 999,
  getAddresses: async () => [account],
  writeContract: async ({ functionName }: { functionName: string }) => { sent.push(functionName); return `0x${"1".repeat(64)}`; },
} as unknown as WalletClient;
const ctx = { account, publicClient, walletClient, api } as const;

configured = false;
await assert.rejects(depositTermUsdc(ctx, term, 1000000n), /not configured/);
assert.equal(sent.length, 0, "missing configuration never reaches wallet submission");
configured = true;
readChain = 1;
await assert.rejects(claimTerm(ctx, term, "lqUSDC"), /chain 999/);
assert.equal(sent.length, 0, "a wrong network never reaches wallet submission");
readChain = 999;
await assert.rejects(claimTerm(ctx, term, "USDC"), /ILLIQUID/);
assert.equal(sent.length, 0, "failed cash simulation never sends or silently changes the claim asset");
await claimTerm(ctx, term, "lqUSDC");
assert.deepEqual(sent, ["claimLq"], "the lqUSDC alternative is submitted only after an explicit caller choice");
console.log("Earn examples: missing configuration, wrong network, failed cash claim and explicit lqUSDC alternative pass");

sent.length=0;
configured=false;
await assert.rejects(depositTermHype(ctx,term,1n,"HYPE"), /not configured/);
configured=true;
await assert.rejects(claimHypeTerm(ctx,term,"HYPE"), /ILLIQUID/);
await assert.rejects(claimHypeTerm(ctx,term,"WHYPE"), /ILLIQUID/);
assert.equal(sent.length,0,"failed HYPE/WHYPE simulation never silently submits a receipt claim");
await claimHypeTerm(ctx,term,"lqHYPE");
assert.deepEqual(sent,["claimLq"]);
console.log("HYPE examples: optional configuration and explicit HYPE/WHYPE/lqHYPE claim outcomes pass");

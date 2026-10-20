/** Connected-wallet examples. Importing this module never submits a transaction. */
import { erc20Abi, type Address, type PublicClient, type WalletClient } from "viem";
import {
  LiquynClient, HYPEREVM_CHAIN_ID, lqUsdcAbi, termEarnRouterAbi,
  readTermOffers, readTermPosition, termFace,
} from "../src/index.ts";

type Context = { publicClient: PublicClient; walletClient: WalletClient; account: Address; api?: LiquynClient };

async function checkWallet(ctx: Context) {
  const [readChain, walletChain, accounts] = await Promise.all([
    ctx.publicClient.getChainId(), ctx.walletClient.getChainId(), ctx.walletClient.getAddresses(),
  ]);
  if (readChain !== HYPEREVM_CHAIN_ID || walletChain !== HYPEREVM_CHAIN_ID) throw new Error("Use HyperEVM chain 999.");
  if (!accounts.some(account => account.toLowerCase() === ctx.account.toLowerCase())) throw new Error("The requested account is not connected.");
}
async function approve(ctx: Context, token: Address, spender: Address, amount: bigint) {
  const allowance = await ctx.publicClient.readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [ctx.account, spender] });
  if (allowance >= amount) return;
  await checkWallet(ctx);
  const hash = await ctx.walletClient.writeContract({ address: token, abi: erc20Abi, functionName: "approve", args: [spender, amount], account: ctx.account, chain: ctx.walletClient.chain ?? null });
  const receipt = await ctx.publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error("Token approval reverted.");
}
async function routerContext(ctx: Context, term: Address) {
  await checkWallet(ctx);
  const { contracts } = await (ctx.api ?? new LiquynClient()).status();
  if (!contracts.termEarnRouter || !contracts.lqUSDC) throw new Error("The Earn router is not configured yet.");
  if (!Object.values(contracts.termLocks).some(address => address?.toLowerCase() === term.toLowerCase())) throw new Error("Select a configured term.");
  const router = contracts.termEarnRouter;
  const [supported, pool] = await Promise.all([
    ctx.publicClient.readContract({ address: router, abi: termEarnRouterAbi, functionName: "supported", args: [term] }),
    ctx.publicClient.readContract({ address: router, abi: termEarnRouterAbi, functionName: "lqUSDC" }),
  ]);
  if (!supported || pool.toLowerCase() !== contracts.lqUSDC.toLowerCase()) throw new Error("Router/term configuration does not match the pool.");
  return { router, pool };
}

/** After a separate approval if required, the USDC deposit and term lock are atomic. */
export async function depositTermUsdc(ctx: Context, term: Address, assets: bigint) {
  if (assets <= 0n) throw new Error("Deposit must be positive, in USDC base units.");
  const { router } = await routerContext(ctx, term);
  const [quoted] = await readTermOffers(ctx.publicClient, { selected: term });
  if (quoted.status !== "open" || !quoted.state) throw new Error(quoted.reason ?? "This term is not open.");
  const rate = quoted.state.fixedRateBps;
  const usdc = await ctx.publicClient.readContract({ address: router, abi: termEarnRouterAbi, functionName: "usdc" });
  await approve(ctx, usdc, router, assets);
  await checkWallet(ctx);
  const [fresh] = await readTermOffers(ctx.publicClient, { selected: term });
  if (fresh.status !== "open" || !fresh.state || fresh.state.fixedRateBps < rate) throw new Error("Offer changed; review it again.");
  const deadline = (await ctx.publicClient.getBlock()).timestamp + 120n;
  if (deadline >= fresh.state.maturity) throw new Error("Too close to maturity for a new deposit.");
  const minFace = termFace(assets, rate, fresh.state.maturity, deadline);
  // Simulation also checks shared-pool cap, backing, deposit status and cover.
  const { request } = await ctx.publicClient.simulateContract({ address: router, abi: termEarnRouterAbi, functionName: "depositUsdc", args: [term, assets, minFace, deadline], account: ctx.account });
  await checkWallet(ctx);
  const hash = await ctx.walletClient.writeContract({ ...request, chain: ctx.walletClient.chain ?? null });
  const receipt = await ctx.publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error("Deposit reverted; no USDC was deposited or locked.");
  return receipt;
}

/** Explicit asset choice. A failed cash claim is not retried as a different asset. */
export async function claimTerm(ctx: Context, term: Address, asset: "USDC" | "lqUSDC") {
  const { router, pool } = await routerContext(ctx, term);
  const quoted = await readTermPosition(ctx.publicClient, term, ctx.account);
  if (!quoted.mature || quoted.balance <= 0n) throw new Error("No matured term balance to claim.");
  await approve(ctx, term, router, quoted.balance);
  await checkWallet(ctx);
  const fresh = await readTermPosition(ctx.publicClient, term, ctx.account);
  if (!fresh.mature || fresh.balance !== quoted.balance) throw new Error("Position changed; review the claim again.");
  const minimum = asset === "USDC"
    ? await ctx.publicClient.readContract({ address: pool, abi: lqUsdcAbi, functionName: "convertToAssets", args: [fresh.claimLq] })
    : fresh.claimLq;
  const deadline = (await ctx.publicClient.getBlock()).timestamp + 120n;
  const { request } = await ctx.publicClient.simulateContract({ address: router, abi: termEarnRouterAbi, functionName: asset === "USDC" ? "claimUsdc" : "claimLq", args: [term, fresh.balance, minimum, deadline], account: ctx.account });
  await checkWallet(ctx);
  const hash = await ctx.walletClient.writeContract({ ...request, chain: ctx.walletClient.chain ?? null });
  const receipt = await ctx.publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error("Claim reverted; term tokens remain in the wallet.");
  return receipt;
}

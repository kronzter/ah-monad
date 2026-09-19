import "dotenv/config";
import { readFileSync, existsSync } from "node:fs";
import { defineChain, type Address, type Chain, type Hex } from "viem";
import { foundry, monadTestnet } from "viem/chains";

export type Network = "local" | "monad-testnet";

export const NETWORK = (process.env.NETWORK ?? "local") as Network;

export const chain: Chain =
  NETWORK === "monad-testnet"
    ? defineChain({ ...monadTestnet, rpcUrls: { default: { http: [process.env.RPC_URL ?? "https://testnet-rpc.monad.xyz"] } } })
    : foundry;

export const rpcUrl = chain.rpcUrls.default.http[0];

// anvil default dev keys, local only
export const ANVIL_KEYS: Hex[] = [
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
];

export function relayerKeys(): Hex[] {
  const env = process.env.RELAYER_PKS;
  if (env) return env.split(",").map((s) => s.trim() as Hex);
  if (NETWORK === "local") return [ANVIL_KEYS[0]];
  throw new Error("RELAYER_PKS required for monad-testnet");
}

export interface Deployments {
  chainId: number;
  token: Address;
  announcer: Address;
  settlement: Address;
}

export function loadDeployments(path = `deployments.${NETWORK}.json`): Deployments {
  if (!existsSync(path)) throw new Error(`${path} missing, run script/deploy.ts`);
  return JSON.parse(readFileSync(path, "utf8"));
}

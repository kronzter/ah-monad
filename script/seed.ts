import { parseUnits, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { signPermit } from "../lib/permit";
import type { Relayer } from "../relayer/relayer";
import type { Deployments } from "./config";

/** Mint mock tokens to a fresh treasury, then fund the vendor's pseudonymous vault key through the relayer. */
export async function seedVendorVault(relayer: Relayer, dep: Deployments, vaultAddress: Hex, amountTokens: number) {
  const treasury = privateKeyToAccount(generatePrivateKey());
  const amount = parseUnits(String(amountTokens), 18);
  await relayer.mint(treasury.address, amount);
  const permit = await signPermit(relayer.publicClient, treasury, dep.token, dep.chainId, dep.settlement, amount);
  return relayer.depositWithPermit(vaultAddress, permit);
}

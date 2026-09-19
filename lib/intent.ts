import type { Address, Hex, LocalAccount } from "viem";

export interface Intent {
  stealthAddr: Address;
  amount: bigint;
  invoiceHash: Hex;
  ephemeralPubKey: Hex;
  viewTag: Hex;
  nonce: bigint;
  deadline: bigint;
}

export const intentTypes = {
  Intent: [
    { name: "stealthAddr", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "invoiceHash", type: "bytes32" },
    { name: "ephemeralPubKey", type: "bytes" },
    { name: "viewTag", type: "bytes1" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export function intentDomain(chainId: number, settlement: Address) {
  return { name: "Shade Settlement", version: "1", chainId, verifyingContract: settlement } as const;
}

export function signIntent(
  account: LocalAccount,
  chainId: number,
  settlement: Address,
  intent: Intent,
): Promise<Hex> {
  return account.signTypedData({
    domain: intentDomain(chainId, settlement),
    types: intentTypes,
    primaryType: "Intent",
    message: intent,
  });
}

/** Random 256-bit nonce: unordered nonces let a burst of intents land in any order. */
export function randomNonce(): bigint {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return BigInt("0x" + Buffer.from(b).toString("hex"));
}

import type { Address, Hex, LocalAccount, PublicClient } from "viem";
import { tokenAbi } from "./abis";

export async function signPermit(
  pub: PublicClient,
  owner: LocalAccount,
  token: Address,
  chainId: number,
  spender: Address,
  value: bigint,
  deadlineSecs = 300,
) {
  const [name, nonce] = await Promise.all([
    pub.readContract({ address: token, abi: tokenAbi, functionName: "name" }),
    pub.readContract({ address: token, abi: tokenAbi, functionName: "nonces", args: [owner.address] }),
  ]);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + deadlineSecs);
  const sig = await owner.signTypedData({
    domain: { name, version: "1", chainId, verifyingContract: token },
    types: {
      Permit: [
        { name: "owner", type: "address" },
        { name: "spender", type: "address" },
        { name: "value", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    },
    primaryType: "Permit",
    message: { owner: owner.address, spender, value, nonce, deadline },
  });
  return {
    owner: owner.address as Hex,
    amount: value,
    deadline,
    r: `0x${sig.slice(2, 66)}` as Hex,
    s: `0x${sig.slice(66, 130)}` as Hex,
    v: parseInt(sig.slice(130, 132), 16),
  };
}

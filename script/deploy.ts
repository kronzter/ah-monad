import { readFileSync, writeFileSync } from "node:fs";
import { createPublicClient, createWalletClient, http, type Abi, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { chain, deploymentPath, relayerKeys, rpcUrl, type Deployments } from "./config";

const artifact = (name: string): { abi: Abi; bytecode: Hex } => {
  const j = JSON.parse(readFileSync(`contracts/out/${name}.sol/${name}.json`, "utf8"));
  return { abi: j.abi, bytecode: j.bytecode.object };
};

async function main() {
  const deployer = privateKeyToAccount(relayerKeys()[0]);
  const pub = createPublicClient({ chain, transport: http(rpcUrl) });
  const wallet = createWalletClient({ account: deployer, chain, transport: http(rpcUrl) });

  const deploy = async (name: string, args: unknown[] = []) => {
    const a = artifact(name);
    const hash = await wallet.deployContract({ abi: a.abi, bytecode: a.bytecode, args });
    const r = await pub.waitForTransactionReceipt({ hash });
    if (!r.contractAddress) throw new Error(`${name} deploy failed`);
    console.log(`${name.padEnd(18)} ${r.contractAddress}`);
    return r.contractAddress;
  };

  const token = await deploy("MockPermitToken");
  const announcer = await deploy("StealthAnnouncer");
  const settlement = await deploy("Settlement", [token, announcer]);

  const dep: Deployments = { chainId: chain.id, token, announcer, settlement };
  const path = deploymentPath();
  writeFileSync(path, JSON.stringify(dep, null, 2));
  console.log(`wrote ${path}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

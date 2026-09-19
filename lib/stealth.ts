// ERC-5564 scheme 1 (secp256k1 + view tags).
// Pure crypto, no network, no LLM. Only the wallet module and supplier scanner import this.
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { bytesToHex, hexToBytes, keccak256, type Address, type Hex } from "viem";
import { publicKeyToAddress } from "viem/accounts";

const Point = secp256k1.Point;
const N = Point.Fn.ORDER;

export interface StealthKeys {
  spendPriv: Hex;
  viewPriv: Hex;
  meta: StealthMetaAddress;
}

/** Public part. Safe to store off-chain in the vendor wallet registry. Never sent to an LLM. */
export interface StealthMetaAddress {
  spendPub: Hex; // 33B compressed
  viewPub: Hex; // 33B compressed
}

export interface StealthPayment {
  stealthAddress: Address;
  ephemeralPubKey: Hex; // 33B compressed
  viewTag: Hex; // 1B
}

const toBig = (h: Hex | Uint8Array) => BigInt(typeof h === "string" ? h : bytesToHex(h));
const toKey = (n: bigint): Hex => `0x${n.toString(16).padStart(64, "0")}`;

function pubOf(priv: Hex): Hex {
  return bytesToHex(secp256k1.getPublicKey(hexToBytes(priv), true));
}

function addressOfPoint(p: InstanceType<typeof Point>): Address {
  return publicKeyToAddress(bytesToHex(p.toBytes(false)));
}

/** keccak(x-coordinate of shared point), as in the scopelift reference SDK. */
function hashSharedSecret(priv: Hex, pub: Hex): Uint8Array {
  const shared = secp256k1.getSharedSecret(hexToBytes(priv), hexToBytes(pub), true);
  return hexToBytes(keccak256(shared.slice(1)));
}

export function generateStealthKeys(): StealthKeys {
  const spendPriv = bytesToHex(secp256k1.utils.randomSecretKey());
  const viewPriv = bytesToHex(secp256k1.utils.randomSecretKey());
  return { spendPriv, viewPriv, meta: { spendPub: pubOf(spendPriv), viewPub: pubOf(viewPriv) } };
}

/** Rebuild a full key set from two private keys (deterministic identities, e.g. derived from a seed). */
export function stealthKeysFromPrivs(spendPriv: Hex, viewPriv: Hex): StealthKeys {
  return { spendPriv, viewPriv, meta: { spendPub: pubOf(spendPriv), viewPub: pubOf(viewPriv) } };
}

/** Sender side: derive a fresh one-time address for `meta`. */
export function generateStealthPayment(meta: StealthMetaAddress): StealthPayment {
  const ephPriv = bytesToHex(secp256k1.utils.randomSecretKey());
  const sh = hashSharedSecret(ephPriv, meta.viewPub);
  const stealthPoint = Point.fromBytes(hexToBytes(meta.spendPub)).add(Point.BASE.multiply(toBig(sh) % N));
  return {
    stealthAddress: addressOfPoint(stealthPoint),
    ephemeralPubKey: pubOf(ephPriv),
    viewTag: bytesToHex(sh.slice(0, 1)),
  };
}

/** Receiver side: returns the stealth address if the announcement is for us, else null. */
export function checkAnnouncement(
  viewPriv: Hex,
  spendPub: Hex,
  ephemeralPubKey: Hex,
  viewTag: Hex,
): Address | null {
  const sh = hashSharedSecret(viewPriv, ephemeralPubKey);
  if (bytesToHex(sh.slice(0, 1)) !== viewTag.toLowerCase()) return null;
  const p = Point.fromBytes(hexToBytes(spendPub)).add(Point.BASE.multiply(toBig(sh) % N));
  return addressOfPoint(p);
}

/** Receiver side: private key controlling the stealth address. */
export function computeStealthKey(spendPriv: Hex, viewPriv: Hex, ephemeralPubKey: Hex): Hex {
  const sh = hashSharedSecret(viewPriv, ephemeralPubKey);
  return toKey((toBig(spendPriv) + toBig(sh)) % N);
}

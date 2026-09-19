import { describe, expect, it } from "vitest";
import { privateKeyToAddress } from "viem/accounts";
import { checkAnnouncement, computeStealthKey, generateStealthKeys, generateStealthPayment } from "./stealth";

describe("stealth (ERC-5564 scheme 1)", () => {
  const supplier = generateStealthKeys();

  it("sender derives an address the receiver can find and control", () => {
    const pay = generateStealthPayment(supplier.meta);
    const found = checkAnnouncement(supplier.viewPriv, supplier.meta.spendPub, pay.ephemeralPubKey, pay.viewTag);
    expect(found).toBe(pay.stealthAddress);
    const key = computeStealthKey(supplier.spendPriv, supplier.viewPriv, pay.ephemeralPubKey);
    expect(privateKeyToAddress(key)).toBe(pay.stealthAddress);
  });

  it("two payments to same meta-address are unlinkable", () => {
    const a = generateStealthPayment(supplier.meta);
    const b = generateStealthPayment(supplier.meta);
    expect(a.stealthAddress).not.toBe(b.stealthAddress);
  });

  it("a different receiver does not match (view tag or address)", () => {
    const other = generateStealthKeys();
    let matches = 0;
    for (let i = 0; i < 200; i++) {
      const pay = generateStealthPayment(supplier.meta);
      const found = checkAnnouncement(other.viewPriv, other.meta.spendPub, pay.ephemeralPubKey, pay.viewTag);
      if (found === pay.stealthAddress) matches++;
    }
    expect(matches).toBe(0);
  });
});

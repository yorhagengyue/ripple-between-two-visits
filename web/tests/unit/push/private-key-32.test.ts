/**
 * Node's ECDH getPrivateKey() drops leading zero bytes; about one generated key in 256 then came out as 31 bytes and the
 * push key tests failed now and then (a 42-character VAPID private key). privateKey32 pads it back to 32.
 */
import { describe, expect, it } from "vitest";
import { generateVapidKeys, privateKey32 } from "@/lib/push/crypto";

describe("a P-256 private key is always 32 bytes", () => {
  it("pads a key whose first bytes are zero", () => {
    const short = Buffer.from("01".repeat(30), "hex"); // what getPrivateKey() returns for a key starting with two zero bytes
    const padded = privateKey32({ getPrivateKey: () => short });
    expect(padded.length).toBe(32);
    expect(padded.subarray(0, 2)).toEqual(Buffer.alloc(2));
    expect(padded.subarray(2)).toEqual(short);
    const full = Buffer.alloc(32, 7);
    expect(privateKey32({ getPrivateKey: () => full })).toBe(full);
  });

  it("generated VAPID private keys are always 43 base64url characters", () => {
    for (let i = 0; i < 600; i++) expect(generateVapidKeys().privateKey).toHaveLength(43);
  });
});

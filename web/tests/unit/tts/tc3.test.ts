/**
 * Signature v3 (lib/tts/tc3.ts) against the vendor's own worked example, page "Signature v3"
 * (https://www.tencentcloud.com/document/api/647/34264, read 2026-10-11). The page prints its key pair masked, as
 * "AKID" plus 32 asterisks and 32 asterisks; its numbers are computed from exactly those printed strings (the third
 * test shows it: the page's final signature comes out of the 32 asterisks), so the whole example is a usable vector.
 * Nothing here is a real key.
 */
import { describe, expect, it } from "vitest";
import { TC3_CONTENT_TYPE, tc3Sign } from "@/lib/tts/tc3";

/** The page's example: CVM DescribeInstances, 2019-02-25 16:44:25 UTC. */
const DOC = {
  secretId: `AKID${"*".repeat(32)}`,
  secretKey: "*".repeat(32),
  service: "cvm",
  host: "cvm.tencentcloudapi.com",
  payload: '{"Limit": 1, "Filters": [{"Values": ["unnamed"], "Name": "instance-name"}]}',
  timestamp: 1551113065,
};

describe("the vendor's worked example", () => {
  const signed = tc3Sign(DOC);

  it("the canonical request, line for line", () => {
    expect(TC3_CONTENT_TYPE).toBe("application/json; charset=utf-8");
    expect(signed.hashedPayload).toBe("99d58dfbc6745f6747f36bfca17dee5e6881dc0428a0a36f96199342bc5b4907");
    expect(signed.canonicalRequest.split("\n")).toEqual([
      "POST",
      "/",
      "",
      "content-type:application/json; charset=utf-8",
      "host:cvm.tencentcloudapi.com",
      "",
      "content-type;host",
      "99d58dfbc6745f6747f36bfca17dee5e6881dc0428a0a36f96199342bc5b4907",
    ]);
  });

  it("the string to sign: the UTC date of the timestamp, and the hashed canonical request", () => {
    expect(signed.date).toBe("2019-02-25");
    expect(signed.stringToSign.split("\n")).toEqual([
      "TC3-HMAC-SHA256",
      "1551113065",
      "2019-02-25/cvm/tc3_request",
      "2815843035062fffda5fd6f2a44ea8a34818b0dc46f024b8b3786976a3adda7a",
    ]);
  });

  it("the signature and the Authorization header, exactly as the page prints them", () => {
    expect(signed.signature).toBe("a7b8551448762bd123d6f79e81815e31a92013640a6cef36a08ad4b292a4d2f2");
    expect(signed.authorization).toBe(
      `TC3-HMAC-SHA256 Credential=AKID${"*".repeat(32)}/2019-02-25/cvm/tc3_request, SignedHeaders=content-type;host, Signature=a7b8551448762bd123d6f79e81815e31a92013640a6cef36a08ad4b292a4d2f2`,
    );
  });
});

describe("what changes a signature", () => {
  const base = tc3Sign(DOC).signature;

  it("the body, the key, the host, the service and the second each do; the key id does not (it only names the key)", () => {
    expect(tc3Sign({ ...DOC, payload: `${DOC.payload} ` }).signature).not.toBe(base);
    expect(tc3Sign({ ...DOC, secretKey: `${DOC.secretKey}x` }).signature).not.toBe(base);
    expect(tc3Sign({ ...DOC, host: "cvm.intl.tencentcloudapi.com" }).signature).not.toBe(base);
    expect(tc3Sign({ ...DOC, service: "trtc" }).signature).not.toBe(base);
    expect(tc3Sign({ ...DOC, timestamp: DOC.timestamp + 1 }).signature).not.toBe(base);
    expect(tc3Sign({ ...DOC, secretId: "another-id" }).signature).toBe(base);
    expect(tc3Sign({ ...DOC, secretId: "another-id" }).authorization).toContain("Credential=another-id/2019-02-25/cvm/tc3_request");
  });

  it("the date is UTC: one second before and after midnight UTC, whatever the server's own time zone", () => {
    const midnight = Date.UTC(2026, 9, 12, 0, 0, 0) / 1000;
    expect(tc3Sign({ ...DOC, timestamp: midnight - 1 }).date).toBe("2026-10-11");
    expect(tc3Sign({ ...DOC, timestamp: midnight }).date).toBe("2026-10-12");
    // 07:59 on the 12th in Singapore is still the 11th in UTC
    expect(tc3Sign({ ...DOC, timestamp: Date.parse("2026-10-12T07:59:30+08:00") / 1000 }).date).toBe("2026-10-11");
  });

  it("a host written in capitals is signed in lower case, as the page's rule for header values says", () => {
    expect(tc3Sign({ ...DOC, host: "CVM.TencentCloudAPI.com" }).signature).toBe(base);
  });
});

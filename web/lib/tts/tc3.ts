/**
 * Tencent Cloud API request signing, "Signature v3" (TC3-HMAC-SHA256), for a JSON POST to the root path. Written to
 * the vendor's page "Signature v3" (https://www.tencentcloud.com/document/api/647/34264, read 2026-10-11) and checked
 * against that page's own worked example in tests/unit/tts/tc3.test.ts (the hashed payload, the hashed canonical
 * request and the final signature all come out as printed there).
 *
 *   CanonicalRequest = "POST\n/\n\ncontent-type:<content type>\nhost:<host>\n\ncontent-type;host\n" + hex(sha256(payload))
 *   StringToSign     = "TC3-HMAC-SHA256\n<timestamp>\n<date>/<service>/tc3_request\n" + hex(sha256(CanonicalRequest))
 *   SecretDate       = HMAC_SHA256("TC3" + SecretKey, <date>)
 *   SecretService    = HMAC_SHA256(SecretDate, <service>)
 *   SecretSigning    = HMAC_SHA256(SecretService, "tc3_request")
 *   Signature        = hex(HMAC_SHA256(SecretSigning, StringToSign))
 *   Authorization    = "TC3-HMAC-SHA256 Credential=<SecretId>/<date>/<service>/tc3_request, SignedHeaders=content-type;host, Signature=<Signature>"
 *
 * <date> is the UTC date of the timestamp (not the server's local date: the page warns that a UTC+8 date fails after
 * midnight). The content type signed must be byte for byte the one sent, and the payload hashed must be the exact body
 * sent, so the caller serialises the body once and hands that same string to both. Server-only; nothing is logged.
 */
import { createHash, createHmac } from "node:crypto";

/** The content type every signed request here is sent with (the one the vendor's worked example uses). */
export const TC3_CONTENT_TYPE = "application/json; charset=utf-8";

export interface Tc3Input {
  secretId: string;
  secretKey: string;
  /** the product's domain prefix: "trtc" for trtc.intl.tencentcloudapi.com, "cvm" in the vendor's example */
  service: string;
  /** the host name the request is sent to, exactly as in the URL */
  host: string;
  /** the request body, exactly as it is sent */
  payload: string;
  /** UNIX seconds; also sent as X-TC-Timestamp */
  timestamp: number;
}

export interface Tc3Signed {
  /** the Authorization header's value */
  authorization: string;
  signature: string;
  /** the UTC date of the timestamp, yyyy-mm-dd */
  date: string;
  hashedPayload: string;
  canonicalRequest: string;
  stringToSign: string;
}

const sha256Hex = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");
const hmac = (key: string | Buffer, text: string): Buffer => createHmac("sha256", key).update(text, "utf8").digest();

export function tc3Sign(input: Tc3Input): Tc3Signed {
  const date = new Date(input.timestamp * 1000).toISOString().slice(0, 10);
  const hashedPayload = sha256Hex(input.payload);
  const signedHeaders = "content-type;host";
  const canonicalRequest = ["POST", "/", "", `content-type:${TC3_CONTENT_TYPE}`, `host:${input.host.toLowerCase()}`, "", signedHeaders, hashedPayload].join("\n");
  const scope = `${date}/${input.service}/tc3_request`;
  const stringToSign = ["TC3-HMAC-SHA256", String(input.timestamp), scope, sha256Hex(canonicalRequest)].join("\n");
  const secretDate = hmac(`TC3${input.secretKey}`, date);
  const secretService = hmac(secretDate, input.service);
  const secretSigning = hmac(secretService, "tc3_request");
  const signature = createHmac("sha256", secretSigning).update(stringToSign, "utf8").digest("hex");
  return {
    authorization: `TC3-HMAC-SHA256 Credential=${input.secretId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    signature,
    date,
    hashedPayload,
    canonicalRequest,
    stringToSign,
  };
}

/**
 * Tencent Cloud OCR for label photos (the owner's decision of 2026-10-16: no Hunyuan model on the account reads images,
 * so the printed words of a label are read by Tencent Cloud's general text recognition). Server-only; nothing here logs.
 *
 *   POST https://ocr.intl.tencentcloudapi.com/   X-TC-Action: GeneralAccurateOCR | GeneralBasicOCR,
 *   X-TC-Version: 2018-11-19, X-TC-Region: ap-singapore, signed with Signature v3 (lib/tts/tc3.ts, the signer the
 *   speech recognition and read-aloud use). Body { ImageBase64 }: PNG, JPG, JPEG, BMP or PDF, at most 10 MB once
 *   encoded (https://www.tencentcloud.com/document/api/1005/38268, read 2026-10-16). At most 10 requests a second.
 *
 * The answer is Response.TextDetections[]: DetectedText, Confidence (0-100), Polygon (four corners) and ItemPolygon
 * (X, Y, Width, Height "after rotation correction", https://www.tencentcloud.com/document/api/1005/37316), plus Angle,
 * the image's rotation (the text's horizontal is 0 degrees, clockwise positive). ocrLines puts the detections in reading
 * order: by ItemPolygon (already upright), else by the Polygon corners turned back by Angle; rows top to bottom (two
 * detections whose middles are within half a line height of each other are one row), each row left to right. Every
 * detection stays a line of its own: two columns side by side are never glued into one line.
 *
 * A line whose Confidence is under OCR_MIN_CONFIDENCE is written "[?]" (the mark the model transcription uses for a word
 * it could not read): the parser and lib/vision/check.ts then treat it as nothing read, never as a fact.
 *
 * Keys: TENCENT_SECRET_ID and TENCENT_SECRET_KEY, the Tencent Cloud API key pair of speech recognition and read-aloud;
 * the sub-user needs the OCR policy (without it: AuthFailure.UnauthorizedOperation -> "unauthorized") and the service
 * opened on the account (FailedOperation.UnOpenError -> "not_activated").
 *
 * Errors are OcrError with a code and the vendor's error code and RequestId, never the image, the recognised text or the
 * vendor's message.
 */
import { TC3_CONTENT_TYPE, tc3Sign } from "@/lib/tts/tc3";

type Env = Record<string, string | undefined>;

export const OCR_HOST = "ocr.intl.tencentcloudapi.com";
export const OCR_SERVICE = "ocr";
export const OCR_VERSION = "2018-11-19";
export const OCR_REGION = "ap-singapore";
export const OCR_ACCURATE = "GeneralAccurateOCR";
export const OCR_BASIC = "GeneralBasicOCR";
export type OcrAction = typeof OCR_ACCURATE | typeof OCR_BASIC;
/** Each request waits at most this long (both reads run side by side, so a photo waits at most this long too). */
export const OCR_TIMEOUT_MS = 15_000;
/** Tencent's limit on ImageBase64 (10 MB after encoding): a larger photo is refused here, without a call. */
export const OCR_MAX_BASE64 = 10 * 1024 * 1024;
/**
 * A line read with less confidence than this is "[?]". Set from the live runs of 2026-10-16 (scripts/ocr/read-labels.ts on
 * the four fixture labels, the four printed labels, the filmed label photo, one turned 90 and one 12 degrees): every line
 * GeneralAccurateOCR read was right and read at 92-100; GeneralBasicOCR's lines were 89-99, its one line under 90 garbled
 * ("Te{6000000o"). Confidence does not catch a character misread (Basic's "5OOMG" came at 95, "AMLODIPTNE SMG" at 96):
 * that is the second read's job (lib/vision/check.ts). The threshold only drops what an engine itself doubts, with room
 * below the clean labels' 92 for a phone photo's.
 */
export const OCR_MIN_CONFIDENCE = 85;

export type OcrErrorCode = "unauthorized" | "not_activated" | "timeout" | "bad_image" | "unreadable" | "ocr_failed";

export class OcrError extends Error {
  constructor(
    readonly code: OcrErrorCode,
    message: string,
    /** Tencent's error code (AuthFailure.UnauthorizedOperation ...), null when the request got no answer */
    readonly vendorCode: string | null = null,
    readonly requestId: string | null = null,
  ) {
    super(message);
    this.name = "OcrError";
  }
}

const BAD_IMAGE = new Set([
  "FailedOperation.ImageDecodeFailed",
  "InvalidParameter.EngineImageDecodeFailed",
  "FailedOperation.EmptyImageError",
  "FailedOperation.ImageSizeTooLarge",
  "LimitExceeded.TooLargeFileError",
  "FailedOperation.DownLoadError",
]);
/** The service cannot be used on this account: not opened, in arrears, its package used up, billing stopped. */
const NOT_ACTIVATED = new Set(["FailedOperation.UnOpenError", "ResourceUnavailable.InArrears", "ResourceUnavailable.ResourcePackageRunOut", "ResourcesSoldOut.ChargeStatusException"]);
/** The photo was read and has nothing legible on it: a new photo is what helps. */
const UNREADABLE = new Set(["FailedOperation.ImageNoText", "FailedOperation.ImageBlur"]);

/** What a Tencent OCR error code means for Ripple. */
export function classifyOcrError(vendorCode: string): OcrErrorCode {
  if (vendorCode.startsWith("AuthFailure")) return "unauthorized";
  if (NOT_ACTIVATED.has(vendorCode)) return "not_activated";
  if (BAD_IMAGE.has(vendorCode)) return "bad_image";
  if (UNREADABLE.has(vendorCode)) return "unreadable";
  if (vendorCode === "FailedOperation.EngineRecognizeTimeout") return "timeout";
  return "ocr_failed";
}

export interface OcrKeys {
  secretId: string;
  secretKey: string;
}

/** The Tencent Cloud API key pair, or null when either half is missing. */
export function ocrKeys(env: Env = process.env): OcrKeys | null {
  const secretId = (env.TENCENT_SECRET_ID ?? "").trim();
  const secretKey = (env.TENCENT_SECRET_KEY ?? "").trim();
  return secretId && secretKey ? { secretId, secretKey } : null;
}

export interface OcrPoint {
  X: number;
  Y: number;
}

export interface OcrDetection {
  DetectedText: string;
  /** 0-100 */
  Confidence: number;
  Polygon?: OcrPoint[] | null;
  ItemPolygon?: { X: number; Y: number; Width: number; Height: number } | null;
}

export interface OcrResult {
  action: OcrAction;
  detections: OcrDetection[];
  /** the image's rotation in degrees, clockwise positive (0 when not given) */
  angle: number;
  requestId: string | null;
}

export interface OcrDeps {
  fetch?: (input: string, init: RequestInit) => Promise<Response>;
  /** the real clock in ms (a signature's timestamp must be the true time: never the app's test clock) */
  now?: () => number;
  timeoutMs?: number;
}

const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function detectionsOf(raw: unknown): OcrDetection[] {
  if (!Array.isArray(raw)) return [];
  const out: OcrDetection[] = [];
  for (const d of raw as Array<Record<string, unknown>>) {
    if (!d || typeof d.DetectedText !== "string") continue;
    const poly = Array.isArray(d.Polygon) ? (d.Polygon as Array<Record<string, unknown>>).filter((p) => p && num(p.X) && num(p.Y)).map((p) => ({ X: p.X as number, Y: p.Y as number })) : null;
    const ip = d.ItemPolygon as Record<string, unknown> | null | undefined;
    out.push({
      DetectedText: d.DetectedText,
      Confidence: num(d.Confidence) ? d.Confidence : 0,
      Polygon: poly && poly.length ? poly : null,
      ItemPolygon: ip && num(ip.X) && num(ip.Y) && num(ip.Width) && num(ip.Height) ? { X: ip.X, Y: ip.Y, Width: ip.Width, Height: ip.Height } : null,
    });
  }
  return out;
}

/** One signed OCR request. Throws OcrError (see the header). */
export async function recogniseText(action: OcrAction, imageBase64: string, keys: OcrKeys, deps: OcrDeps = {}): Promise<OcrResult> {
  if (imageBase64.length > OCR_MAX_BASE64) throw new OcrError("bad_image", `the photo is larger than Tencent OCR takes (${OCR_MAX_BASE64} bytes once encoded)`);
  const send = deps.fetch ?? ((input: string, init: RequestInit) => fetch(input, init));
  const now = deps.now ?? Date.now;
  // serialised once: the bytes signed are the bytes sent
  const payload = JSON.stringify({ ImageBase64: imageBase64 });
  const timestamp = Math.floor(now() / 1000);
  const signed = tc3Sign({ secretId: keys.secretId, secretKey: keys.secretKey, service: OCR_SERVICE, host: OCR_HOST, payload, timestamp });
  let status: number;
  let text: string;
  try {
    const res = await send(`https://${OCR_HOST}/`, {
      method: "POST",
      headers: {
        Authorization: signed.authorization,
        "Content-Type": TC3_CONTENT_TYPE,
        "X-TC-Action": action,
        "X-TC-Version": OCR_VERSION,
        "X-TC-Region": OCR_REGION,
        "X-TC-Timestamp": String(timestamp),
      },
      body: payload,
      signal: AbortSignal.timeout(Math.max(1, deps.timeoutMs ?? OCR_TIMEOUT_MS)),
      cache: "no-store",
      redirect: "error",
    });
    status = res.status;
    text = await res.text();
  } catch (err) {
    // the cause is dropped on purpose: a fetch error can carry the request (his photo)
    const name = (err as { name?: string })?.name;
    if (name === "TimeoutError" || name === "AbortError") throw new OcrError("timeout", `Tencent OCR ${action} did not answer within ${deps.timeoutMs ?? OCR_TIMEOUT_MS} ms`);
    throw new OcrError("ocr_failed", `Tencent OCR ${action} could not be reached`);
  }
  type Answer = { Error?: { Code?: unknown }; TextDetections?: unknown; Angle?: unknown; RequestId?: unknown };
  let response: Answer | null = null;
  try {
    const parsed = JSON.parse(text) as { Response?: unknown } | null;
    if (parsed && typeof parsed.Response === "object" && parsed.Response !== null) response = parsed.Response as Answer;
  } catch {
    response = null;
  }
  if (!response) throw new OcrError("ocr_failed", `Tencent OCR ${action} answered HTTP ${status} without a Response`);
  const requestId = typeof response.RequestId === "string" && /^[\w-]{1,80}$/.test(response.RequestId) ? response.RequestId : null;
  if (response.Error) {
    const vendorCode = typeof response.Error.Code === "string" && /^[\w.]{1,80}$/.test(response.Error.Code) ? response.Error.Code : "UnknownError";
    throw new OcrError(classifyOcrError(vendorCode), `Tencent OCR ${action} answered ${vendorCode} (RequestId ${requestId ?? "none"})`, vendorCode, requestId);
  }
  if (status < 200 || status > 299) throw new OcrError("ocr_failed", `Tencent OCR ${action} answered HTTP ${status}`, null, requestId);
  return { action, detections: detectionsOf(response.TextDetections), angle: num(response.Angle) ? response.Angle : 0, requestId };
}

// ------------------------------------------------------------------ reading order

interface Placed {
  d: OcrDetection;
  i: number;
  left: number;
  mid: number;
  height: number;
}

/** Where a detection sits on the upright page: ItemPolygon as given, else the Polygon corners turned back by `angle`. */
function place(d: OcrDetection, i: number, angle: number): Placed | null {
  const ip = d.ItemPolygon;
  if (ip && ip.Height > 0) return { d, i, left: ip.X, mid: ip.Y + ip.Height / 2, height: ip.Height };
  if (!d.Polygon?.length) return null;
  // the text runs at `angle` degrees clockwise (y points down): turn every corner back by it
  const a = (angle * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const xs: number[] = [];
  const ys: number[] = [];
  for (const p of d.Polygon) {
    xs.push(p.X * cos + p.Y * sin);
    ys.push(-p.X * sin + p.Y * cos);
  }
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);
  return { d, i, left: Math.min(...xs), mid: (top + bottom) / 2, height: Math.max(1, bottom - top) };
}

/** The detections in reading order (see the header). Detections without any position keep their place at the end. */
export function readingOrder(detections: readonly OcrDetection[], angle = 0): OcrDetection[] {
  const placed: Placed[] = [];
  const loose: OcrDetection[] = [];
  detections.forEach((d, i) => {
    const p = place(d, i, angle);
    if (p) placed.push(p);
    else loose.push(d);
  });
  placed.sort((a, b) => a.mid - b.mid || a.left - b.left || a.i - b.i);
  const rows: Placed[][] = [];
  for (const p of placed) {
    const row = rows.at(-1);
    const anchor = row?.[0];
    if (row && anchor && Math.abs(p.mid - anchor.mid) <= 0.5 * Math.min(p.height, anchor.height)) row.push(p);
    else rows.push([p]);
  }
  return [...rows.flatMap((r) => r.sort((a, b) => a.left - b.left || a.i - b.i).map((p) => p.d)), ...loose];
}

/** The transcription: one detection per line in reading order, a line under `minConfidence` as "[?]". */
export function ocrTranscript(result: Pick<OcrResult, "detections" | "angle">, minConfidence: number = OCR_MIN_CONFIDENCE): string {
  return readingOrder(result.detections, result.angle)
    .map((d) => ({ text: d.DetectedText.replace(/\s+/g, " ").trim(), sure: d.Confidence >= minConfidence }))
    .filter((l) => l.text)
    .map((l) => (l.sure ? l.text : "[?]"))
    .join("\n");
}

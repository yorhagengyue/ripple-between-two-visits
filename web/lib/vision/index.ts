/**
 * Label reading, step 1 of "photograph a medicine label" (web-app.md section 8, M3): image bytes -> the raw text
 * printed on the label. Nothing here interprets the text; lib/meds/parse-label.ts turns it into fields, so every
 * reader shares one parser.
 *
 * Which reader (visionMode; names only, never a key):
 *   ocr       Tencent Cloud OCR (./ocr.ts), the owner's decision of 2026-10-16: GeneralAccurateOCR transcribes, and
 *             GeneralBasicOCR reads the same photo side by side as the second, independent read (below). The default
 *             when the main model is Hunyuan without a model that reads images and the Tencent Cloud API key pair of
 *             speech recognition (TENCENT_SECRET_ID, TENCENT_SECRET_KEY) is set: the deployment, with no setting of its own.
 *   model     lib/llm createVisionLlm (`images` input): OpenAI's main model, a recorded replay (LLM_PROVIDER=replay,
 *             web/fixtures/cassettes, prompt + image digest key), or a Hunyuan model that reads images when
 *             LLM_VISION_MODEL names one (none on this account, 10-16: lib/llm/hunyuan.ts HUNYUAN_VISION_MODEL); told to
 *             transcribe only; one attempt waits up to LLM_VISION_TIMEOUT_MS (default 45 s)
 *   cassette  web/fixtures/cassettes/vision/<sha256 of the image bytes>.json, which holds only { "text": "<what a reader
 *             would transcribe>" }: the offline path (mock / stub / unset, or Hunyuan with neither a vision model nor the
 *             Tencent key pair). A photo without a cassette is an error (VisionError cassette_missing), never a network call.
 * LABEL_READER = ocr | model | cassette chooses one over that default; a choice that cannot run here (ocr without the key
 * pair, model without a model that reads images) is said once in the server log and the default is used.
 * With OCR refused for the account's configuration (unauthorized: the sub-user lacks the OCR policy; not_activated), a
 * bundled sample photo still reads from its cassette (LabelText.readerError says why), so the example's labels work while
 * the console is being set up; any other photo gets the error.
 *
 * CASSETTE_DIR moves both cassette folders (vision/ sits inside it). Server-only (node:fs, node:crypto).
 *
 * A second, independent read (10-09 fixer): the main model of that day invented a whole label from a rotated, blurred
 * photo (a Ghana address, a patient and a doctor that are not on it, a 2024 date) and said nothing about it being unsure.
 * So every live reader reads twice, in parallel: the model path asks for the five fields as JSON with null for anything
 * not clearly legible (FIELDS_SYSTEM); the OCR path runs Tencent's second engine (GeneralBasicOCR), whose reading of
 * the same printed lines is the second read (secondReadFromOcr). lib/vision/check.ts compares the two reads field by
 * field: with the model, a medicine line or directions they disagree on make the photo unreadable (retake); with OCR
 * (whose second engine misreads digits as letters on clear photos: 5OOMG, 2OMG, SMG) only a different medicine is a
 * retake, and a strength or directions the engines read differently are left for him to fill in. A date or clinic
 * they disagree on is left empty. Two reads agreeing on the same mistake is still possible; his field-by-field confirmation stays the
 * last gate. A transcription with no readable line at all ("[?]", also every OCR line under OCR_MIN_CONFIDENCE) is an
 * "unreadable" error.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { cassetteDir, createVisionLlm, mainProviderKind, visionModel } from "@/lib/llm";
import { parseModelJson } from "@/lib/llm/json";
import type { LlmClient } from "@/lib/llm/types";
import { parseLabelText } from "@/lib/meds/parse-label";
import { fixOcrDigits, similarity } from "./check";
import { OCR_ACCURATE, OCR_BASIC, OcrError, ocrKeys, ocrTranscript, recogniseText, type OcrDeps, type OcrErrorCode, type OcrKeys } from "./ocr";

type Env = Record<string, string | undefined>;

/**
 * unauthorized, not_activated, timeout, bad_image, ocr_failed: Tencent Cloud OCR (./ocr.ts); unreadable also when OCR
 * says the photo has no text or is blurred.
 */
export type VisionErrorCode = "cassette_missing" | "bad_cassette" | "unsupported_image" | "model_failed" | "empty" | "unreadable" | Exclude<OcrErrorCode, "unreadable">;

export class VisionError extends Error {
  constructor(
    readonly code: VisionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "VisionError";
  }
}

export interface LabelImage {
  bytes: Uint8Array;
  /** image/png, image/jpeg or image/webp */
  mime: string;
}

export interface LabelText {
  /** every printed line, in reading order, as transcribed */
  text: string;
  /** "tencent-ocr", "mock:vision-cassette", "hunyuan", "openai", "replay:openai" ... (never a key) */
  provider: string;
  model: string | null;
  /** mock: the cassette file name */
  cassette: string | null;
  tokens: number;
  /** the independent second read (null when it failed; undefined in cassette mode, which has none) */
  second?: SecondRead | null;
  /** why the second read failed (code only, no content) */
  secondError?: string;
  /** who made the second read (lib/vision/check.ts compares them differently) */
  secondBy?: "model" | "ocr";
  /** OCR mode answered from a sample photo's cassette: why OCR could not read it (unauthorized | not_activated) */
  readerError?: string;
}

/** The second read: the five fields, each null unless the model could read every character of it. */
export interface SecondRead {
  medicine: string | null;
  directions: string | null;
  date: string | null;
  clinic: string | null;
}

const IMAGE_MIME = new Set(["image/png", "image/jpeg", "image/webp"]);

export const TRANSCRIBE_SYSTEM = [
  "You transcribe the printed text on a photo of a medicine label, box or bag.",
  "Copy every line exactly as printed, top to bottom, one printed line per output line, keeping the original language, spelling, capitals and numbers.",
  "Do not translate, correct, summarise, explain or add anything. If a word is unreadable, write [?] in its place.",
  "Output only the transcribed text, no commentary and no code fences.",
].join(" ");
export const TRANSCRIBE_USER = "Transcribe the printed text on this label.";

export const FIELDS_SYSTEM = [
  "You look at a photo of a medicine label, box or bag. For each field, copy the printed text exactly as printed if, and only if, you can read every character of it clearly; otherwise use null.",
  "Never guess, complete or correct anything from what labels usually say.",
  'Answer JSON only: {"medicine": <the line with the medicine name (and strength) or null>, "directions": <the dosing line or null>, "date": <the dispensing date as printed or null>, "clinic": <the clinic or pharmacy name or null>}.',
].join(" ");
export const FIELDS_USER = "Read these fields on this label.";

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() && v.trim().toLowerCase() !== "null" ? v.trim() : null);

/** The field read's JSON, or null when it is not the expected object. */
export function parseSecondRead(content: string): SecondRead | null {
  let parsed: Record<string, unknown> | null;
  try {
    parsed = parseModelJson(content) as Record<string, unknown> | null;
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  return { medicine: str(parsed.medicine), directions: str(parsed.directions), date: str(parsed.date), clinic: str(parsed.clinic) };
}

/** True when the transcription has at least one line with three letters that are not "[?]". */
export function hasReadableLine(text: string): boolean {
  return text.split("\n").some((l) => (l.replace(/\[\?\]/g, "").match(/[\p{L}]/gu) ?? []).length >= 3);
}

export const sha256Hex = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

/** web/fixtures/cassettes/vision (or <CASSETTE_DIR>/vision). */
export function visionCassetteDir(env: Env = process.env): string {
  return path.join(cassetteDir(env), "vision");
}

/** Path of the mock cassette for these image bytes. */
export function visionCassettePath(bytes: Uint8Array, env: Env = process.env): string {
  return path.join(visionCassetteDir(env), `${sha256Hex(bytes)}.json`);
}

export type VisionMode = "ocr" | "model" | "cassette";

const warned = new Set<string>();
const warnOnce = (line: string) => {
  if (warned.has(line)) return;
  warned.add(line);
  console.warn(line);
};

/** A model that reads images answers here (OpenAI, a replay, or Hunyuan with LLM_VISION_MODEL). */
function modelReads(env: Env): boolean {
  const kind = mainProviderKind(env);
  return kind === "openai" || kind === "replay" || (kind === "hunyuan" && !!visionModel(env));
}

/** The reader without LABEL_READER (see the header). */
function defaultVisionMode(env: Env): VisionMode {
  if (modelReads(env)) return "model";
  return mainProviderKind(env) === "hunyuan" && ocrKeys(env) ? "ocr" : "cassette";
}

/** Which reader this process uses (names only). */
export function visionMode(env: Env = process.env): VisionMode {
  const raw = (env.LABEL_READER ?? "").trim().toLowerCase();
  const fallback = defaultVisionMode(env);
  if (!raw) return fallback;
  if (raw === "cassette") return "cassette";
  if (raw === "ocr") {
    if (ocrKeys(env)) return "ocr";
    warnOnce(`[vision] LABEL_READER=ocr but TENCENT_SECRET_ID or TENCENT_SECRET_KEY is not set; label photos are read by: ${fallback}`);
    return fallback;
  }
  if (raw === "model") {
    if (modelReads(env)) return "model";
    warnOnce(`[vision] LABEL_READER=model but no model that reads images is configured; label photos are read by: ${fallback}`);
    return fallback;
  }
  warnOnce(`[vision] LABEL_READER is not ocr, model or cassette; label photos are read by: ${fallback}`);
  return fallback;
}

/** Per-attempt timeout for reading one label photo. */
export function visionTimeoutMs(env: Env = process.env): number {
  const n = Number(env.LLM_VISION_TIMEOUT_MS);
  return env.LLM_VISION_TIMEOUT_MS && Number.isFinite(n) && n > 0 ? n : 45_000;
}

/** Strip a code fence or stray whitespace a model may wrap around the transcription. */
export function cleanTranscript(raw: string): string {
  let s = raw.replace(/\r\n?/g, "\n").trim();
  const fence = /^```[a-z]*\n([\s\S]*?)\n```$/i.exec(s);
  if (fence) s = fence[1];
  return s
    .split("\n")
    .map((l) => l.replace(/\s+$/, ""))
    .join("\n")
    .trim();
}

function readCassette(image: LabelImage, env: Env): LabelText {
  const file = visionCassettePath(image.bytes, env);
  const name = path.basename(file);
  if (!existsSync(file)) throw new VisionError("cassette_missing", `no vision cassette ${name}`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    throw new VisionError("bad_cassette", `vision cassette ${name} is not JSON`);
  }
  const text = (parsed as { text?: unknown }).text;
  if (typeof text !== "string") throw new VisionError("bad_cassette", `vision cassette ${name} has no text`);
  return { text: cleanTranscript(text), provider: "mock:vision-cassette", model: null, cassette: name, tokens: 0 };
}

export interface ReadLabelDeps {
  env?: Env;
  /** the model client (tests); default createVisionLlm(env) */
  llm?: LlmClient;
  /** Tencent Cloud OCR's transport and keys (tests: a fake fetch); given, the OCR path is used */
  ocr?: OcrDeps & { keys?: OcrKeys };
}

/** How alike a line of the second engine must be to the first engine's line to be its reading of the same print. */
export const OCR_ALIGN_MIN = 0.5;

/**
 * The second read from the second OCR engine's transcription (`second`), for the first engine's (`first`): its reading of
 * the medicine line and the dose line the first engine's parse found (the most alike of its lines, or of two of its lines
 * in a row, for a line it split; digits repaired with fixOcrDigits), else the medicine and directions its own parse finds
 * (so a different medicine line on its own is still a disagreement); the date and the clinic as its own parse finds
 * them. Lines it was unsure of ("[?]") are not taken.
 */
export function secondReadFromOcr(second: string, first: string): SecondRead {
  const fixed = fixOcrDigits(second);
  const own = parseLabelText(fixed);
  const firstFields = parseLabelText(first);
  const lines = fixed
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.replace(/\[\?\]/g, "").trim());
  const candidates = [...lines, ...lines.slice(1).map((l, i) => `${lines[i]} ${l}`)];
  const closest = (target: string | null): string | null => {
    if (!target) return null;
    let best: string | null = null;
    let score = OCR_ALIGN_MIN;
    for (const c of candidates) {
      const s = similarity(fixOcrDigits(target), c);
      if (s >= score) [best, score] = [c, s];
    }
    return best;
  };
  return {
    medicine: closest(firstFields.drug_text) ?? own.drug_text,
    directions: closest(firstFields.directions) ?? own.directions,
    date: own.dispensed,
    clinic: own.clinic,
  };
}

const ocrCode = (err: unknown): OcrErrorCode => (err instanceof OcrError ? err.code : "ocr_failed");

/** OCR mode: GeneralAccurateOCR transcribes, GeneralBasicOCR is the second read (see the header). */
async function readByOcr(image: LabelImage, env: Env, deps: NonNullable<ReadLabelDeps["ocr"]>): Promise<LabelText> {
  const keys = deps.keys ?? ocrKeys(env);
  if (!keys) throw new VisionError("unauthorized", "Tencent Cloud OCR has no key pair here (TENCENT_SECRET_ID, TENCENT_SECRET_KEY)");
  const base64 = Buffer.from(image.bytes).toString("base64");
  // both engines side by side (no extra wait)
  const [first, second] = await Promise.allSettled([recogniseText(OCR_ACCURATE, base64, keys, deps), recogniseText(OCR_BASIC, base64, keys, deps)]);
  if (first.status === "rejected") {
    const code = ocrCode(first.reason);
    // the account is not set up for OCR yet: a bundled sample photo still reads from its recorded transcription
    if (code === "unauthorized" || code === "not_activated") {
      try {
        return { ...readCassette(image, env), readerError: code };
      } catch (e) {
        if (!(e instanceof VisionError && e.code === "cassette_missing")) throw e;
      }
    }
    const message = first.reason instanceof Error ? first.reason.message.slice(0, 160) : "no answer";
    throw new VisionError(code, `label reading failed: ${message}`);
  }
  const out: LabelText = { text: ocrTranscript(first.value), provider: "tencent-ocr", model: OCR_ACCURATE, cassette: null, tokens: 0, secondBy: "ocr" };
  if (second.status === "fulfilled") {
    out.second = secondReadFromOcr(ocrTranscript(second.value), out.text);
  } else if (ocrCode(second.reason) === "unreadable") {
    // the second engine saw no text: nothing is confirmed by it (every field then unconfirmed, the dose line dropped)
    out.second = { medicine: null, directions: null, date: null, clinic: null };
  } else {
    out.second = null;
    out.secondError = ocrCode(second.reason);
  }
  return out;
}

/** Image -> raw label text. Throws VisionError. */
export async function readLabelText(image: LabelImage, deps: ReadLabelDeps = {}): Promise<LabelText> {
  const env = deps.env ?? process.env;
  const mime = image.mime.split(";")[0].trim().toLowerCase();
  if (!IMAGE_MIME.has(mime)) throw new VisionError("unsupported_image", `cannot read ${mime}`);
  let out: LabelText;
  const mode: VisionMode = deps.llm ? "model" : deps.ocr ? "ocr" : visionMode(env);
  if (mode === "cassette") {
    out = readCassette(image, env);
  } else if (mode === "ocr") {
    out = await readByOcr(image, env, deps.ocr ?? {});
  } else {
    const llm = deps.llm ?? createVisionLlm(env);
    const images = [{ mime, base64: Buffer.from(image.bytes).toString("base64") }];
    const common = { temperature: 0, timeoutMs: visionTimeoutMs(env), purpose: "vision" as const, images };
    // the transcription and the independent field read run side by side (no extra wait)
    const [first, second] = await Promise.allSettled([
      llm.chat({ ...common, system: TRANSCRIBE_SYSTEM, user: TRANSCRIBE_USER, maxTokens: 800 }),
      llm.chat({ ...common, system: FIELDS_SYSTEM, user: FIELDS_USER, maxTokens: 300, json: true }),
    ]);
    if (first.status === "rejected") {
      throw new VisionError("model_failed", `label reading failed: ${(first.reason as Error).message.slice(0, 120)}`);
    }
    const res = first.value;
    out = { text: cleanTranscript(res.content), provider: res.provider ?? llm.provider, model: res.model ?? llm.model, cassette: res.cassette ?? null, tokens: res.tokens, secondBy: "model" };
    if (second.status === "fulfilled") {
      out.second = parseSecondRead(second.value.content);
      out.tokens += second.value.tokens;
      if (!out.second) out.secondError = "bad_json";
    } else {
      out.second = null;
      const code = (second.reason as { code?: string })?.code;
      out.secondError = typeof code === "string" ? code : "error";
    }
  }
  if (!out.text) throw new VisionError("empty", "no text on the label");
  if (!hasReadableLine(out.text)) throw new VisionError("unreadable", "nothing on the photo could be read; retake it flat, upright and in good light");
  return out;
}

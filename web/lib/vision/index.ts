/**
 * Label reading, step 1 of "photograph a medicine label" (web-app.md section 8, M3): image bytes -> the raw text
 * printed on the label. Nothing here interprets the text; lib/meds/parse-label.ts turns it into fields, so the
 * model path and the offline path share one parser.
 *
 *   LLM_PROVIDER=hunyuan | openai -> lib/llm createVisionLlm (`images` input): OpenAI's main model, or a Hunyuan model
 *                          that reads images when LLM_VISION_MODEL names one; told to transcribe only; one attempt waits
 *                          up to LLM_VISION_TIMEOUT_MS (default 45 s). Hunyuan has none on this account (10-16; lib/llm/
 *                          hunyuan.ts HUNYUAN_VISION_MODEL: hy3 even answers as if it saw an image), so LLM_PROVIDER=hunyuan
 *                          without LLM_VISION_MODEL reads as the offline path below
 *   LLM_PROVIDER=replay -> the same lib/llm call answered from web/fixtures/cassettes (prompt + image digest key)
 *   mock / stub / unset without a key -> web/fixtures/cassettes/vision/<sha256 of the image bytes>.json,
 *                          which holds only { "text": "<what a model would transcribe>" }. A photo without a
 *                          cassette is an error (VisionError cassette_missing), never a network call.
 *
 * CASSETTE_DIR moves both cassette folders (vision/ sits inside it). Server-only (node:fs, node:crypto).
 *
 * A second, independent read (model path only; 10-09 fixer): the main model of that day invented a whole label from a
 * rotated, blurred photo (a Ghana address, a patient and a doctor that are not on it, a 2024 date) and said nothing
 * about it being unsure. So the model path also asks, in parallel, for the five fields as JSON with null for
 * anything not clearly legible (FIELDS_SYSTEM). lib/vision/check.ts compares the two reads field by field: a
 * medicine line or directions they disagree on make the photo unreadable (retake), a date or clinic they disagree on
 * is left empty. A model hallucinating twice the same way is still possible; his field-by-field confirmation stays
 * the last gate. A transcription with no readable line at all ("[?]") is an "unreadable" error.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { cassetteDir, createVisionLlm, mainProviderKind, visionModel } from "@/lib/llm";
import { parseModelJson } from "@/lib/llm/json";
import type { LlmClient } from "@/lib/llm/types";

type Env = Record<string, string | undefined>;

export type VisionErrorCode = "cassette_missing" | "bad_cassette" | "unsupported_image" | "model_failed" | "empty" | "unreadable";

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
  /** "mock:vision-cassette", "hunyuan", "openai", "replay:openai" ... (never a key) */
  provider: string;
  model: string | null;
  /** mock: the cassette file name */
  cassette: string | null;
  tokens: number;
  /** model path: the independent field read (null when it failed; undefined in cassette mode, which has none) */
  second?: SecondRead | null;
  /** why the field read failed (code only, no content) */
  secondError?: string;
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

/** Which reader this process uses (names only). */
export function visionMode(env: Env = process.env): "model" | "cassette" {
  const kind = mainProviderKind(env);
  if (kind === "hunyuan") return visionModel(env) ? "model" : "cassette";
  return kind === "openai" || kind === "replay" ? "model" : "cassette";
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
}

/** Image -> raw label text. Throws VisionError. */
export async function readLabelText(image: LabelImage, deps: ReadLabelDeps = {}): Promise<LabelText> {
  const env = deps.env ?? process.env;
  const mime = image.mime.split(";")[0].trim().toLowerCase();
  if (!IMAGE_MIME.has(mime)) throw new VisionError("unsupported_image", `cannot read ${mime}`);
  let out: LabelText;
  if (!deps.llm && visionMode(env) === "cassette") {
    out = readCassette(image, env);
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
    out = { text: cleanTranscript(res.content), provider: res.provider ?? llm.provider, model: res.model ?? llm.model, cassette: res.cassette ?? null, tokens: res.tokens };
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

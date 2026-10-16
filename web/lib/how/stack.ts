/**
 * The one config behind /how (task M8 item 3): every box of the architecture diagram names its product and
 * model from here, nowhere else. Keep it to what the code and the decisions in CODEBUDDY.md and docs/plan/hosting.md
 * say today; a decision that is made but not running yet is "planned", an open one "undecided".
 * Speech-to-text is Tencent Cloud speech recognition (the owner's decision of 10-14; the local Whisper service on the
 * filming laptop answers the same screens), never "TRTC speech recognition".
 * Server-only (reads the DeepSeek model defaults from lib/llm).
 *
 * The checker note quotes the 10-09 live runs: web/eval/results/deepseek-run1.json and deepseek-run2.json (51 cases
 * each, layer 3 called 0 times) and deepseek-checker.json (14 written sentences). tests/unit/how/how.test.ts reads
 * those files, so a new live run that changes the numbers fails the test until this note is updated.
 */
import { DEEPSEEK_CHECKER_MODEL, DEEPSEEK_MAIN_MODEL } from "@/lib/llm";

export type BoxStatus = "in_use" | "planned" | "undecided" | "mock_until_keys" | "filming_laptop_only";

export interface StackBox {
  id: "phones" | "app" | "main_model" | "checker" | "stt" | "tts" | "database" | "hosting";
  /** what the box does */
  role: string;
  /** the product (or "to be decided") */
  product: string;
  /** Mandarin name, where the plan names it in Mandarin */
  productZh?: string;
  /** the model, when there is one */
  model: string | null;
  status: BoxStatus;
  /** one line on how it is used */
  note: string;
}

export const STATUS_TEXT: Record<BoxStatus, string> = {
  in_use: "in use",
  planned: "decided, not running yet",
  undecided: "to be decided",
  mock_until_keys: "mock until keys exist and the TRTC voice is checked",
  filming_laptop_only: "filming laptop only",
};

export const STACK: Record<StackBox["id"], StackBox> = {
  phones: {
    id: "phones",
    role: "Phones and screens",
    product: "Browser (Mr Tan's phone, Wei Ling's phone, backstage, director)",
    model: null,
    status: "in_use",
    note: "Records visits as 16 kHz WAV and uploads straight to private storage with a signed link; no keys in the browser.",
  },
  app: {
    id: "app",
    role: "Web app and APIs",
    product: "Next.js (App Router, TypeScript)",
    model: null,
    status: "in_use",
    note: "Pages, the API routes, the safety layer and the live event stream.",
  },
  hosting: {
    id: "hosting",
    role: "Hosting",
    product: "Tencent Cloud Lighthouse + EdgeOne",
    model: null,
    status: "planned",
    note:
      "One always-on server runs next start, with EdgeOne in front for HTTPS and caching of static files. Always-on rather than serverless because the visit replay is pushed sentence by sentence by a timer inside the server process, and some state still lives in that process's memory (voice transcription jobs, the film crew's unlock of the scripted fallback). The live event stream alone would not need it: it can be set to reconnect on a timer without losing or repeating events. Region: Singapore recommended, next to the production database; not final yet. The server is not bought yet.",
  },
  main_model: {
    id: "main_model",
    role: "Main model",
    product: "DeepSeek",
    model: DEEPSEEK_MAIN_MODEL,
    status: "in_use",
    note:
      "Runs in non-thinking mode. Sorts a question the rules cannot, picks sentences from the sources it is given, copies the printed text off a label photo, marks the doctor's instructions in a finished visit transcript, writes short notes of what was said at a visit (shown as Ripple's and not confirmed, never a source), and screens messages for an emergency or self-harm the rules missed. Since 15 October it also answers everyday health questions in his language as the owner's policy file says (shown after his own sources as general information from Ripple), and words the 995 and self-harm answers for what he said (the fixed sentences stand when it fails). It never tells him to change his medicines.",
  },
  checker: {
    id: "checker",
    role: "Checker model (layer 3)",
    product: "DeepSeek",
    model: DEEPSEEK_CHECKER_MODEL,
    status: "in_use",
    note:
      "Gets a sentence the main model worded itself together with the whole source passage, and says whether the source supports it. It is the same vendor as the main model (a different model), so it is less independent than a checker from a second vendor would be. Not configured, a timeout, the answer's time limit reached, a call refused by the spend cap, or anything but a clear yes: the sentence is blocked. In the 51-question evaluation, run twice with these two models, no sentence needed layer 3 (0 checker calls); on its own it was tested with 14 written sentences: 3 faithful ones passed, all 11 unsupported ones were blocked, 5 of them by the checker alone.",
  },
  stt: {
    id: "stt",
    role: "Speech to text",
    product: "Tencent Cloud speech recognition",
    model: "16k_zh_en (Mandarin and English mixed in one engine), with the names of the medicines Ripple knows as hot words",
    status: "in_use",
    note: "Decided on 14 October: recording file recognition, in Singapore. While he records, each line he finishes at a pause is sent on its own and its caption comes back about 2 to 3 seconds later; when the visit ends, the saved recording is sent in pieces of at most 100 seconds, cut at pauses, and becomes the record. Not split by speaker: who said what comes from the words and Mr Tan's confirmation. The deployment uses it since the evening of 14 October (the sample visits still play their recorded replays); the local Whisper service on the filming laptop can answer the same screens.",
  },
  tts: {
    id: "tts",
    role: "Text to speech",
    product: "Tencent TRTC TTS",
    model: null,
    status: "mock_until_keys",
    note:
      "Meant to read the explain card aloud in Mandarin. Today a placeholder test voice plays (one short tone per character, not a voice). The TRTC adapter is written to Tencent's published TextToSpeech documentation and has never been run against the real service: there are no keys yet. Real speech needs a TRTC application and a Tencent Cloud API key pair, then one sentence checked by ear. Until the adapter is configured, read-aloud is not offered on an account at all: no button is drawn while it cannot speak, so nobody taps one that fails.",
  },
  database: {
    id: "database",
    role: "Database, storage, live sync",
    product: "Supabase",
    model: null,
    status: "in_use",
    note:
      "Postgres tables with row level security and no public access, two private storage buckets, the event table behind the live stream. The project in use today is in Tokyo (ap-northeast-1); the deployed app gets its own production project in the server's region.",
  },
};

/** Boxes in diagram order: who uses it, the app, then what the app calls. */
export const ARCHITECTURE_ROWS: StackBox["id"][][] = [["phones"], ["app", "hosting"], ["main_model", "checker", "stt", "tts", "database"]];

/** Every word the architecture diagram shows (tests scan it). */
export function stackText(): string {
  return Object.values(STACK)
    .flatMap((b) => [b.role, b.product, b.productZh ?? "", b.model ?? "", STATUS_TEXT[b.status], b.note])
    .join("\n");
}

/** AIHGle 2.0, quoted verbatim and only these strings (docs/analysis/ntu-track-deep-read.md). */
export const AIHGLE = {
  citation: "AIHGle 2.0 (MOH & HSA, March 2026), Table 3, p.15",
  device: ["LLMs that use patient data to provide clinical recommendations to clinicians", "recommendations for medication combinations and dosage adjustments"],
  nonDevice: ["LLMs that explain side effects of medication prescribed to patients... The software does not provide medical diagnosis or treatment recommendation"],
} as const;

/**
 * Label photos read by Tencent Cloud OCR (lib/vision/ocr.ts, lib/vision/index.ts OCR mode; the owner's decision of
 * 2026-10-16). Everything here runs against a fake transport: the request Tencent gets (signed TC3, the action, the
 * version, the region, the photo as ImageBase64), the reading order (rows top to bottom, each left to right, a rotated
 * photo turned back by Angle), a line read with low confidence as "[?]", the two engines as two independent reads that
 * lib/vision/check.ts compares (a different medicine -> retake; a strength or dose line read otherwise -> that field left
 * for him; the second engine's digit misreads seen live on 10-16 are not disagreements), each failure's code, the sample
 * photos' recorded readings while the account is not set up, the choice of reader, and that no label text or photo
 * reaches the console or an error.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MedsError } from "@/lib/meds/errors";
import { readLabel } from "@/lib/meds/write";
import { readLabelText, secondReadFromOcr, VisionError, visionMode } from "@/lib/vision";
import { fixOcrDigits, sameMedicine } from "@/lib/vision/check";
import {
  classifyOcrError,
  OCR_ACCURATE,
  OCR_BASIC,
  OCR_HOST,
  OCR_MAX_BASE64,
  OCR_MIN_CONFIDENCE,
  OCR_REGION,
  OCR_VERSION,
  ocrKeys,
  ocrTranscript,
  readingOrder,
  type OcrDetection,
} from "@/lib/vision/ocr";
import { setup, type Ctx } from "../meds/helpers";

const FIXTURES = fileURLToPath(new URL("../../../fixtures/", import.meta.url));
const png = (name: string) => new Uint8Array(readFileSync(path.join(FIXTURES, "labels", `${name}.png`)));
/** a photo of his own: not one of the bundled samples (no cassette) */
const ownPhoto = () => new Uint8Array([...png("ibuprofen"), 0]);
const KEYS = { secretId: "AKIDtestid0000000000", secretKey: "test-secret-key-not-real" };

/** A line printed at (x, y) with height h, upright. */
const line = (text: string, x: number, y: number, confidence = 99, h = 40, w = 400): OcrDetection => ({
  DetectedText: text,
  Confidence: confidence,
  Polygon: [
    { X: x, Y: y },
    { X: x + w, Y: y },
    { X: x + w, Y: y + h },
    { X: x, Y: y + h },
  ],
  ItemPolygon: { X: x, Y: y, Width: w, Height: h },
});

const AMLODIPINE: OcrDetection[] = [
  line("BLOSSOM FAMILY CLINIC (FICTIONAL)", 40, 20),
  line("Blk 000 Demo Ave, Singapore 000000", 40, 70, 98, 30),
  line("Tel 6000 0000", 520, 72, 98, 30, 150),
  line("Patient: TAN (DEMO)", 40, 120, 97, 32),
  line("Date: 01/09/2026", 520, 118, 99, 32, 200),
  line("AMLODIPINE 5MG TABLET", 40, 180, 99, 50),
  line("Take ONE tablet every MORNING", 40, 250, 99, 44),
  line("For: high blood pressure", 40, 310, 96, 34),
  line("Qty: 35 tablets", 40, 360, 96, 34),
];
const AMLODIPINE_TEXT = [
  "BLOSSOM FAMILY CLINIC (FICTIONAL)",
  "Blk 000 Demo Ave, Singapore 000000",
  "Tel 6000 0000",
  "Patient: TAN (DEMO)",
  "Date: 01/09/2026",
  "AMLODIPINE 5MG TABLET",
  "Take ONE tablet every MORNING",
  "For: high blood pressure",
  "Qty: 35 tablets",
].join("\n");

/** Turn an upright detection by `deg` clockwise (y points down), as a photo taken at that angle would place it. */
function rotated(d: OcrDetection, deg: number): OcrDetection {
  const a = (deg * Math.PI) / 180;
  return {
    ...d,
    Polygon: d.Polygon!.map((p) => ({ X: p.X * Math.cos(a) - p.Y * Math.sin(a), Y: p.X * Math.sin(a) + p.Y * Math.cos(a) })),
    ItemPolygon: null,
  };
}

function shuffle<T>(xs: readonly T[], seed = 7): T[] {
  const out = [...xs];
  let s = seed;
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 9301 + 49297) % 233280;
    const j = Math.floor((s / 233280) * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

type Answer = { detections?: OcrDetection[]; angle?: number; error?: string; status?: number; raw?: string; hang?: boolean };

interface Sent {
  url: string;
  action: string;
  headers: Record<string, string>;
  body: { ImageBase64?: string };
}

/** A fake Tencent: answers each action as told, records what was sent. */
function fakeTencent(answers: Partial<Record<string, Answer>>) {
  const sent: Sent[] = [];
  const fetch = async (url: string, init: RequestInit): Promise<Response> => {
    const headers = init.headers as Record<string, string>;
    const action = headers["X-TC-Action"];
    sent.push({ url, action, headers, body: JSON.parse(String(init.body)) });
    const a = answers[action] ?? { error: "InternalError" };
    if (a.hang) {
      return new Promise<Response>((_, reject) => {
        init.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "TimeoutError" })));
      });
    }
    if (a.raw !== undefined) return new Response(a.raw, { status: a.status ?? 200 });
    const response = a.error
      ? { Error: { Code: a.error, Message: "the vendor's message, with whatever it says" }, RequestId: "req-1" }
      : { TextDetections: a.detections ?? [], Angle: a.angle ?? 0, RequestId: `req-${action}` };
    return new Response(JSON.stringify({ Response: response }), { status: a.status ?? 200 });
  };
  return { fetch, sent };
}

const ocrDeps = (answers: Partial<Record<string, Answer>>) => {
  const fake = fakeTencent(answers);
  return { fake, deps: { ocr: { fetch: fake.fetch, keys: KEYS, now: () => Date.UTC(2026, 9, 16, 2, 0, 0) } } };
};

describe("reading order", () => {
  it("rows top to bottom, each row left to right, whatever order Tencent lists them in", () => {
    const order = readingOrder(shuffle(AMLODIPINE)).map((d) => d.DetectedText);
    expect(order.join("\n")).toBe(AMLODIPINE_TEXT);
  });

  it("two detections a few pixels apart in height are one row (left first); every detection stays its own line", () => {
    const text = ocrTranscript({ detections: [line("Date: 01/09/2026", 520, 118, 99, 32), line("Patient: TAN (DEMO)", 40, 124, 99, 32)], angle: 0 });
    expect(text).toBe("Patient: TAN (DEMO)\nDate: 01/09/2026");
  });

  for (const deg of [90, -90, 180, 12, -25]) {
    it(`a photo turned ${deg} degrees with only the corner points: turned back by Angle`, () => {
      const turned = shuffle(AMLODIPINE.map((d) => rotated(d, deg)));
      expect(ocrTranscript({ detections: turned, angle: deg })).toBe(AMLODIPINE_TEXT);
    });
  }

  it("ItemPolygon (upright already) wins over the corner points", () => {
    const turned = AMLODIPINE.map((d) => ({ ...rotated(d, 90), ItemPolygon: d.ItemPolygon }));
    expect(ocrTranscript({ detections: shuffle(turned), angle: 90 })).toBe(AMLODIPINE_TEXT);
  });

  it("a detection with no position keeps its place after the others", () => {
    const loose: OcrDetection = { DetectedText: "Keep out of reach of children.", Confidence: 99, Polygon: null, ItemPolygon: null };
    expect(readingOrder([loose, ...AMLODIPINE]).at(-1)).toBe(loose);
  });
});

describe("low confidence", () => {
  it(`a line under ${OCR_MIN_CONFIDENCE} is "[?]", never its guessed words; spaces are tidied`, () => {
    const text = ocrTranscript({
      detections: [line("AMLODIPINE  5MG   TABLET ", 40, 180, 99), line("Take TWO tablets every MORNING", 40, 250, OCR_MIN_CONFIDENCE - 1)],
      angle: 0,
    });
    expect(text).toBe("AMLODIPINE 5MG TABLET\n[?]");
    expect(text).not.toContain("TWO");
  });

  it("a [?] line of the second engine is nothing read: no directions from it", () => {
    const second = secondReadFromOcr("AMLODIPINE 5MG TABLET\n[?]\nFor: high blood pressure", AMLODIPINE_TEXT);
    expect(second).toEqual({ medicine: "AMLODIPINE 5MG TABLET", directions: null, date: null, clinic: null });
  });

  it("a photo whose every line is unsure is unreadable (retake)", async () => {
    const blurred = AMLODIPINE.map((d) => ({ ...d, Confidence: 40 }));
    const { deps } = ocrDeps({ [OCR_ACCURATE]: { detections: blurred }, [OCR_BASIC]: { detections: blurred } });
    await expect(readLabelText({ bytes: ownPhoto(), mime: "image/png" }, deps)).rejects.toMatchObject({ code: "unreadable" });
  });
});

describe("the request and the two reads", () => {
  it("both engines are asked side by side with the photo, signed TC3, OCR 2018-11-19 in ap-singapore", async () => {
    const { fake, deps } = ocrDeps({ [OCR_ACCURATE]: { detections: shuffle(AMLODIPINE) }, [OCR_BASIC]: { detections: AMLODIPINE } });
    const bytes = ownPhoto();
    const out = await readLabelText({ bytes, mime: "image/png" }, deps);
    expect(fake.sent.map((s) => s.action).sort()).toEqual([OCR_ACCURATE, OCR_BASIC]);
    for (const s of fake.sent) {
      expect(s.url).toBe(`https://${OCR_HOST}/`);
      expect(s.headers).toMatchObject({ "X-TC-Version": OCR_VERSION, "X-TC-Region": OCR_REGION, "X-TC-Timestamp": String(Date.UTC(2026, 9, 16, 2, 0, 0) / 1000) });
      expect(s.headers.Authorization).toMatch(new RegExp(`^TC3-HMAC-SHA256 Credential=${KEYS.secretId}/2026-10-16/ocr/tc3_request, SignedHeaders=content-type;host, Signature=[0-9a-f]{64}$`));
      expect(s.headers.Authorization).not.toContain(KEYS.secretKey);
      expect(s.body).toEqual({ ImageBase64: Buffer.from(bytes).toString("base64") });
    }
    expect(out).toMatchObject({ text: AMLODIPINE_TEXT, provider: "tencent-ocr", model: OCR_ACCURATE, cassette: null, tokens: 0, secondBy: "ocr" });
    expect(out.second).toEqual({ medicine: "AMLODIPINE 5MG TABLET", directions: "Take ONE tablet every MORNING", date: "2026-09-01", clinic: "Blossom Family Clinic (Fictional)" });
  });

  it("the second engine failing leaves no second read (a warning later), with its code only", async () => {
    const { deps } = ocrDeps({ [OCR_ACCURATE]: { detections: AMLODIPINE }, [OCR_BASIC]: { error: "RequestLimitExceeded" } });
    const out = await readLabelText({ bytes: ownPhoto(), mime: "image/png" }, deps);
    expect(out).toMatchObject({ second: null, secondError: "ocr_failed", text: AMLODIPINE_TEXT });
  });

  it("the second engine seeing no text confirms nothing (every field of the second read empty)", async () => {
    const { deps } = ocrDeps({ [OCR_ACCURATE]: { detections: AMLODIPINE }, [OCR_BASIC]: { error: "FailedOperation.ImageNoText" } });
    const out = await readLabelText({ bytes: ownPhoto(), mime: "image/png" }, deps);
    expect(out.second).toEqual({ medicine: null, directions: null, date: null, clinic: null });
  });

  it("a photo larger than Tencent takes is refused here without a call", async () => {
    const { fake, deps } = ocrDeps({});
    const big = new Uint8Array(Math.ceil((OCR_MAX_BASE64 / 4) * 3) + 3);
    big.set(png("ibuprofen").slice(0, 8));
    await expect(readLabelText({ bytes: big, mime: "image/png" }, deps)).rejects.toMatchObject({ code: "bad_image" });
    expect(fake.sent).toHaveLength(0);
  });
});

describe("the second engine's reading, and its digit misreads (seen live on 10-16)", () => {
  it("fixOcrDigits undoes the look-alikes inside numbers only, and a unit glued to the next word", () => {
    expect(fixOcrDigits("METFORMIN 5OOMG TABLET")).toBe("METFORMIN 500MG TABLET");
    expect(fixOcrDigits("ATORVASTATIN 2OMG TABLET")).toBe("ATORVASTATIN 20MG TABLET");
    expect(fixOcrDigits("LOSARTAN 5OMGTABLET")).toBe("LOSARTAN 50MG TABLET");
    expect(fixOcrDigits("Date: O1/O9/2026  1S0 mg  l0 ml")).toBe("Date: 01/09/2026  150 mg  10 ml");
    // an S standing alone as the number before a unit (the printed film label: "AMLODIPTNE SMG"), never inside a word
    expect(fixOcrDigits("AMLODIPTNE SMG TABLET")).toBe("AMLODIPTNE 5MG TABLET");
    expect(fixOcrDigits("AMLODIPINE S MG TABLET / S mcg / (S ml)")).toBe("AMLODIPINE 5 MG TABLET / 5 mcg / (5 ml)");
    for (const word of ["ASMG TABLET", "GLASS mg", "TABLETS mg", "S MGX", "SMGTABLET", "S tablets", "S"]) expect(fixOcrDigits(word), word).toBe(word);
    // words keep their letters: no digit in the run
    expect(fixOcrDigits("Take ONE tablet every MORNING. Blk COOL")).toBe("Take ONE tablet every MORNING. Blk COOL");
  });

  it("sameMedicine: the same medicine to the kb's matcher (fuzzy step included), a misread strength set aside", () => {
    expect(sameMedicine("AMLODIPINE 5MG TABLET", "AMLODIPTNE SMG TABLET")).toBe(true);
    expect(sameMedicine("AMLODIPINE 5MG TABLET", "LOSARTAN 50MG TABLET")).toBe(false);
    expect(sameMedicine("宁和平压丸", "宁和平压丸")).toBe(false); // not a medicine Ripple knows: only the same text agrees
  });

  it("the second engine's line for each of the first engine's lines: a split line joined, digits repaired", () => {
    const first = "IBUPROFEN 200 mg\nTake ONE tablet every MORNING";
    expect(secondReadFromOcr("IBUPROFEN 200\nmg\nTake\nONE tablet every MORNING", first)).toMatchObject({ medicine: "IBUPROFEN 200 mg", directions: "Take ONE tablet every MORNING" });
    expect(secondReadFromOcr("METFORMIN 5OOMG TABLET\nDate:O1/O9/2026", "METFORMIN 500MG TABLET\nDate: 01/09/2026")).toMatchObject({ medicine: "METFORMIN 500MG TABLET", date: "2026-09-01" });
    // nothing alike: its own medicine line stands, so a different medicine is still a disagreement
    expect(secondReadFromOcr("LOSARTAN 50MG TABLET", "AMLODIPINE 5MG TABLET").medicine).toBe("LOSARTAN 50MG TABLET");
  });
});

describe("each failure has its code", () => {
  const cases: Array<[Answer, string]> = [
    [{ error: "AuthFailure.UnauthorizedOperation" }, "unauthorized"],
    [{ error: "AuthFailure.SignatureFailure" }, "unauthorized"],
    [{ error: "FailedOperation.UnOpenError" }, "not_activated"],
    [{ error: "ResourceUnavailable.InArrears" }, "not_activated"],
    [{ error: "FailedOperation.ImageDecodeFailed" }, "bad_image"],
    [{ error: "LimitExceeded.TooLargeFileError" }, "bad_image"],
    [{ error: "FailedOperation.ImageNoText" }, "unreadable"],
    [{ error: "FailedOperation.ImageBlur" }, "unreadable"],
    [{ error: "FailedOperation.EngineRecognizeTimeout" }, "timeout"],
    [{ hang: true }, "timeout"],
    [{ error: "RequestLimitExceeded" }, "ocr_failed"],
    [{ error: "InternalError" }, "ocr_failed"],
    [{ raw: "<html>bad gateway</html>", status: 502 }, "ocr_failed"],
  ];
  for (const [answer, code] of cases) {
    it(`${answer.error ?? (answer.hang ? "no answer in time" : "HTTP 502 without a Response")} -> ${code}`, async () => {
      const { deps } = ocrDeps({ [OCR_ACCURATE]: answer, [OCR_BASIC]: answer });
      const err = await readLabelText({ bytes: ownPhoto(), mime: "image/png" }, { ocr: { ...deps.ocr, timeoutMs: 30 } }).catch((e) => e);
      expect(err).toBeInstanceOf(VisionError);
      expect(err.code).toBe(code);
      // the vendor's own message is never passed on
      expect(err.message).not.toContain("the vendor's message");
    });
  }

  it("classifyOcrError", () => {
    expect(classifyOcrError("AuthFailure.UnauthorizedOperation")).toBe("unauthorized");
    expect(classifyOcrError("FailedOperation.UnOpenError")).toBe("not_activated");
    expect(classifyOcrError("Something.New")).toBe("ocr_failed");
  });

  it("while the account is not set up for OCR, a bundled sample photo reads from its recorded transcription (and says why)", async () => {
    for (const error of ["AuthFailure.UnauthorizedOperation", "FailedOperation.UnOpenError"]) {
      const { deps } = ocrDeps({ [OCR_ACCURATE]: { error }, [OCR_BASIC]: { error } });
      const out = await readLabelText({ bytes: png("amlodipine"), mime: "image/png" }, deps);
      expect(out).toMatchObject({ provider: "mock:vision-cassette", readerError: error === "FailedOperation.UnOpenError" ? "not_activated" : "unauthorized" });
      expect(out.text.split("\n")).toContain("AMLODIPINE 5MG TABLET");
      expect(out.second).toBeUndefined();
    }
    // any other failure on a sample photo is the failure: no recorded reading stands in for a photo OCR could not read
    const { deps } = ocrDeps({ [OCR_ACCURATE]: { error: "FailedOperation.ImageBlur" }, [OCR_BASIC]: { error: "FailedOperation.ImageBlur" } });
    await expect(readLabelText({ bytes: png("amlodipine"), mime: "image/png" }, deps)).rejects.toMatchObject({ code: "unreadable" });
  });
});

describe("which reader", () => {
  const HY = { LLM_PROVIDER: "hunyuan", HUNYUAN_API_KEY: "sk-test" };
  const TC = { TENCENT_SECRET_ID: "id", TENCENT_SECRET_KEY: "key" };

  it("the deployment's settings (Hunyuan, no model that reads images, the speech key pair) read with OCR; no new setting needed", () => {
    expect(visionMode({ ...HY, ...TC })).toBe("ocr");
    expect(ocrKeys({ ...TC })).toEqual({ secretId: "id", secretKey: "key" });
    expect(ocrKeys({ TENCENT_SECRET_ID: "id", TENCENT_SECRET_KEY: " " })).toBeNull();
  });

  it("otherwise today's behaviour: a model that reads images, else the offline cassettes; a key alone never turns OCR on offline", () => {
    expect(visionMode(HY)).toBe("cassette");
    expect(visionMode({ ...HY, ...TC, LLM_VISION_MODEL: "some-vision" })).toBe("model");
    expect(visionMode({ LLM_PROVIDER: "mock", ...TC })).toBe("cassette");
    expect(visionMode({ ...TC })).toBe("cassette");
    expect(visionMode({ LLM_PROVIDER: "openai", OPENAI_API_KEY: "x", ...TC })).toBe("model");
    expect(visionMode({ LLM_PROVIDER: "replay", ...TC })).toBe("model");
  });

  it("LABEL_READER chooses; a choice that cannot run here falls back with one warning (no value of a key in it)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(visionMode({ LLM_PROVIDER: "mock", ...TC, LABEL_READER: "ocr" })).toBe("ocr");
      expect(visionMode({ ...HY, ...TC, LABEL_READER: "cassette" })).toBe("cassette");
      expect(visionMode({ ...HY, ...TC, LLM_VISION_MODEL: "v", LABEL_READER: "OCR" })).toBe("ocr");
      expect(visionMode({ LLM_PROVIDER: "mock", LABEL_READER: "ocr" })).toBe("cassette");
      expect(visionMode({ ...HY, ...TC, LABEL_READER: "model" })).toBe("ocr");
      expect(visionMode({ ...HY, ...TC, LABEL_READER: "camera" })).toBe("ocr");
      const said = warn.mock.calls.map((c) => String(c[0])).join("\n");
      expect(said).toContain("LABEL_READER=ocr but TENCENT_SECRET_ID or TENCENT_SECRET_KEY is not set");
      expect(said).not.toMatch(/sk-test|\bkey\b=|camera/);
    } finally {
      warn.mockRestore();
    }
  });
});

describe("readLabel (M3) with OCR", () => {
  let dir: string;
  let ctx: Ctx;
  beforeEach(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "ripple-ocr-"));
    ctx = await setup(dir, 29);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const putOwn = async () => {
    const p = `${ctx.sessionId}/labels/own-${Math.random().toString(36).slice(2)}.png`;
    await ctx.deps.blob!.putObject("labels", p, ownPhoto(), "image/png");
    return p;
  };
  const LABEL_WORDS = /AMLODIPINE|MORNING|BLOSSOM|Demo Ave|TAN \(DEMO\)|TWO tablets|01\/09\/2026/;

  it("both engines agree: the fields go to him to confirm, read by tencent-ocr; nothing of the label in the console", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    try {
      const { deps } = ocrDeps({ [OCR_ACCURATE]: { detections: shuffle(AMLODIPINE) }, [OCR_BASIC]: { detections: AMLODIPINE } });
      const res = await readLabel({ sessionId: ctx.sessionId, path: await putOwn() }, { ...ctx.deps, vision: deps });
      expect(res).toMatchObject({ provider: "tencent-ocr", warnings: [] });
      expect(res.fields).toMatchObject({ drug_id: "amlodipine", strength: "5 mg", directions: "Take ONE tablet every MORNING", dispensed: "2026-09-01", clinic: "Blossom Family Clinic (fictional)" });
      const printed = spies.flatMap((s) => s.mock.calls.map((c) => c.map(String).join(" "))).join("\n");
      expect(printed).not.toMatch(LABEL_WORDS);
      expect(printed).not.toContain(Buffer.from(ownPhoto()).toString("base64").slice(0, 40));
    } finally {
      for (const s of spies) s.mockRestore();
    }
  });

  it("the engines read the dose line differently: it is left empty for him (not from either engine), the rest stands", async () => {
    const other = AMLODIPINE.map((d) => (d.DetectedText.startsWith("Take") ? { ...d, DetectedText: "Take TWO tablets every MORNING" } : d));
    const { deps } = ocrDeps({ [OCR_ACCURATE]: { detections: AMLODIPINE }, [OCR_BASIC]: { detections: other } });
    const res = await readLabel({ sessionId: ctx.sessionId, path: await putOwn() }, { ...ctx.deps, vision: deps });
    expect(res.fields).toMatchObject({ drug_id: "amlodipine", strength: "5 mg", directions: null, slots: null, dispensed: "2026-09-01" });
    expect(res.warnings).toEqual(["directions_unconfirmed"]);
    expect(res.dose_slots).toBeNull();
  });

  it("the engines read different medicines: label_unreadable (retake); the event names the reason, not the words", async () => {
    const other = AMLODIPINE.map((d) => (d.DetectedText.startsWith("AMLODIPINE") ? { ...d, DetectedText: "LOSARTAN 50MG TABLET" } : d));
    const { deps } = ocrDeps({ [OCR_ACCURATE]: { detections: AMLODIPINE }, [OCR_BASIC]: { detections: other } });
    const err = await readLabel({ sessionId: ctx.sessionId, path: await putOwn() }, { ...ctx.deps, vision: deps }).catch((e) => e);
    expect(err).toBeInstanceOf(MedsError);
    expect(err).toMatchObject({ code: "label_unreadable", detail: { code: "reads_disagree" } });
    const failed = ctx.events.find((e) => (e.data as { kind?: string }).kind === "label.read_failed")!;
    expect(failed.data).toMatchObject({ code: "reads_disagree" });
    expect(`${failed.say} ${JSON.stringify(failed.data)}`).not.toMatch(LABEL_WORDS);
  });

  it("the same medicine with another strength (10 mg against 5 mg): the strength is left empty for him, not a retake", async () => {
    const other = AMLODIPINE.map((d) => (d.DetectedText.startsWith("AMLODIPINE") ? { ...d, DetectedText: "AMLODIPINE 10MG TABLET" } : d));
    const { deps } = ocrDeps({ [OCR_ACCURATE]: { detections: AMLODIPINE }, [OCR_BASIC]: { detections: other } });
    const res = await readLabel({ sessionId: ctx.sessionId, path: await putOwn() }, { ...ctx.deps, vision: deps });
    expect(res.fields).toMatchObject({ drug_id: "amlodipine", strength: null, directions: "Take ONE tablet every MORNING" });
    expect(res.warnings).toEqual(["strength_unconfirmed"]);
  });

  it("the printed film label as the second engine read it live (AMLODIPTNE SMG, Singapore O00000, MRTAN): accepted, every field confirmed", async () => {
    const live = AMLODIPINE.map((d) =>
      d.DetectedText.startsWith("AMLODIPINE")
        ? { ...d, DetectedText: "AMLODIPTNE SMG TABLET" }
        : d.DetectedText.startsWith("Blk")
          ? { ...d, DetectedText: "BIk 000 Demo Ave, Singapore O00000" }
          : d.DetectedText.startsWith("Patient")
            ? { ...d, DetectedText: "Patient:TAN(DEMO)" }
            : d,
    );
    const { deps } = ocrDeps({ [OCR_ACCURATE]: { detections: AMLODIPINE }, [OCR_BASIC]: { detections: live } });
    const res = await readLabel({ sessionId: ctx.sessionId, path: await putOwn() }, { ...ctx.deps, vision: deps });
    expect(res.fields).toMatchObject({ drug_text: "AMLODIPINE 5MG TABLET", drug_id: "amlodipine", strength: "5 mg", directions: "Take ONE tablet every MORNING", dispensed: "2026-09-01" });
    expect(res.warnings).toEqual([]);
  });

  it("the second engine's misreads seen live are not disagreements (a unit glued to TABLET, spacing, O for 0 in the date)", async () => {
    for (const misread of ["AMLODIPINE 5MGTABLET", "AMLODIPINE 5 MG  TABLET", "AMLODIPINE5MG TABLET"]) {
      const live = AMLODIPINE.map((d) => (d.DetectedText.startsWith("AMLODIPINE") ? { ...d, DetectedText: misread } : d.DetectedText.startsWith("Date") ? { ...d, DetectedText: "Date:O1/O9/2026" } : d));
      const { deps } = ocrDeps({ [OCR_ACCURATE]: { detections: AMLODIPINE }, [OCR_BASIC]: { detections: live } });
      const res = await readLabel({ sessionId: ctx.sessionId, path: await putOwn() }, { ...ctx.deps, vision: deps });
      expect(res.warnings, misread).toEqual([]);
      expect(res.fields, misread).toMatchObject({ strength: "5 mg", dispensed: "2026-09-01" });
    }
  });

  it("a dose line the second engine read unsure is left empty, not taken from one read", async () => {
    const unsure = AMLODIPINE.map((d) => (d.DetectedText.startsWith("Take") ? { ...d, Confidence: 50 } : d));
    const { deps } = ocrDeps({ [OCR_ACCURATE]: { detections: AMLODIPINE }, [OCR_BASIC]: { detections: unsure } });
    const res = await readLabel({ sessionId: ctx.sessionId, path: await putOwn() }, { ...ctx.deps, vision: deps });
    expect(res.fields).toMatchObject({ drug_id: "amlodipine", directions: null, slots: null });
    expect(res.warnings).toContain("directions_unconfirmed");
  });

  it("OCR refused for the account (no policy yet): his own photo is label_unreadable with the code; the event has the code only", async () => {
    const { deps } = ocrDeps({ [OCR_ACCURATE]: { error: "AuthFailure.UnauthorizedOperation" }, [OCR_BASIC]: { error: "AuthFailure.UnauthorizedOperation" } });
    const err = await readLabel({ sessionId: ctx.sessionId, path: await putOwn() }, { ...ctx.deps, vision: deps }).catch((e) => e);
    expect(err).toMatchObject({ code: "label_unreadable", detail: { code: "unauthorized" } });
    expect(ctx.events.at(-1)!.data).toEqual({ kind: "label.read_failed", code: "unauthorized" });
  });

  it("OCR refused for the account: the sample photo still reads, and the event says why it was the recorded reading", async () => {
    const { deps } = ocrDeps({ [OCR_ACCURATE]: { error: "FailedOperation.UnOpenError" }, [OCR_BASIC]: { error: "FailedOperation.UnOpenError" } });
    const res = await readLabel({ sessionId: ctx.sessionId, path: await ctx.upload("amlodipine") }, { ...ctx.deps, vision: deps });
    expect(res).toMatchObject({ provider: "mock:vision-cassette", fields: { drug_id: "amlodipine" } });
    const ev = ctx.events.find((e) => (e.data as { kind?: string }).kind === "label.read")!;
    expect(ev.data).toMatchObject({ provider: "mock:vision-cassette", reader_error: "not_activated" });
  });
});

/**
 * lib/vision: the offline reader answers from web/fixtures/cassettes/vision/<sha256 of the image>.json, which holds
 * only the transcribed text; the model path goes through lib/llm with the image attached; nothing goes to the
 * network without a key.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { ChatOpts, LlmClient } from "@/lib/llm/types";
import { cleanTranscript, FIELDS_SYSTEM, readLabelText, sha256Hex, VisionError, visionCassetteDir, visionCassettePath, visionMode } from "@/lib/vision";

const FIXTURES = fileURLToPath(new URL("../../../fixtures/", import.meta.url));
const png = (name: string) => new Uint8Array(readFileSync(path.join(FIXTURES, "labels", `${name}.png`)));
const MOCK_ENV = { LLM_PROVIDER: "mock" };

describe("vision cassettes", () => {
  it("every label photo under fixtures/labels has a cassette keyed by the sha256 of its bytes", () => {
    const photos = readdirSync(path.join(FIXTURES, "labels")).filter((f) => f.endsWith(".png"));
    // losartan.png: the example's sample label for today's planned follow-up (track C, real-app 4.6)
    expect(photos.sort()).toEqual(["amlodipine.png", "ibuprofen.png", "losartan.png", "relative_box.png"]);
    const files = readdirSync(visionCassetteDir(MOCK_ENV)).sort();
    for (const p of photos) {
      const bytes = new Uint8Array(readFileSync(path.join(FIXTURES, "labels", p)));
      expect(files, p).toContain(`${sha256Hex(bytes)}.json`);
    }
    expect(files).toHaveLength(photos.length);
  });

  it("a cassette holds only the raw text (no parsed fields)", () => {
    for (const f of readdirSync(visionCassetteDir(MOCK_ENV))) {
      const json = JSON.parse(readFileSync(path.join(visionCassetteDir(MOCK_ENV), f), "utf8"));
      expect(Object.keys(json), f).toEqual(["text"]);
      expect(typeof json.text).toBe("string");
      for (const field of ["drug_id", "strength", "directions", "slots", "dispensed", "clinic"]) expect(json[field], f).toBeUndefined();
    }
  });

  it("mock mode reads the cassette for the image bytes", async () => {
    expect(visionMode(MOCK_ENV)).toBe("cassette");
    expect(visionMode({})).toBe("cassette"); // no key, no provider
    const out = await readLabelText({ bytes: png("amlodipine"), mime: "image/png" }, { env: MOCK_ENV });
    expect(out.provider).toBe("mock:vision-cassette");
    expect(out.cassette).toBe(path.basename(visionCassettePath(png("amlodipine"), MOCK_ENV)));
    expect(out.text.split("\n")).toContain("AMLODIPINE 5MG TABLET");
    expect(out.text.split("\n")).toContain("Take ONE tablet every MORNING");
  });

  it("Chinese survives the round trip", async () => {
    const out = await readLabelText({ bytes: png("relative_box"), mime: "image/png" }, { env: MOCK_ENV });
    expect(out.text.split("\n")[0]).toBe("宁和平压丸");
  });

  it("a photo without a cassette is an error, never a network call", async () => {
    const other = new Uint8Array([...png("ibuprofen"), 0]);
    await expect(readLabelText({ bytes: other, mime: "image/png" }, { env: MOCK_ENV })).rejects.toMatchObject({ code: "cassette_missing" });
    await expect(readLabelText({ bytes: png("ibuprofen"), mime: "audio/wav" }, { env: MOCK_ENV })).rejects.toBeInstanceOf(VisionError);
  });

  it("LLM_PROVIDER=openai without a key falls back to the cassettes", () => {
    expect(visionMode({ LLM_PROVIDER: "openai" })).toBe("cassette");
    expect(visionMode({ LLM_PROVIDER: "openai", OPENAI_API_KEY: "x" })).toBe("model");
    expect(visionMode({ LLM_PROVIDER: "replay" })).toBe("model");
  });
});

describe("model path", () => {
  it("sends the image through lib/llm's images input: a transcription and, side by side, an independent field read", async () => {
    const calls: ChatOpts[] = [];
    const llm: LlmClient = {
      provider: "fake",
      model: "fake-vision",
      async chat(opts) {
        calls.push(opts);
        if (opts.system === FIELDS_SYSTEM) return { content: JSON.stringify({ medicine: "IBUPROFEN 200 mg", directions: null, date: null, clinic: null }), tokens: 8 };
        return { content: "```\nIBUPROFEN 200 mg  \nTake with or after food.\n```", tokens: 42 };
      },
    };
    const bytes = png("ibuprofen");
    const out = await readLabelText({ bytes, mime: "image/png" }, { llm });
    expect(calls).toHaveLength(2);
    for (const c of calls) expect(c.images).toEqual([{ mime: "image/png", base64: Buffer.from(bytes).toString("base64") }]);
    expect(calls[0].system).toMatch(/transcribe/i);
    expect(calls[0].system).toMatch(/do not translate, correct, summarise/i);
    expect(calls[1].system).toBe(FIELDS_SYSTEM);
    expect(calls[1].json).toBe(true);
    expect(out.text).toBe("IBUPROFEN 200 mg\nTake with or after food.");
    expect(out.provider).toBe("fake");
    expect(out.tokens).toBe(50);
    expect(out.second).toEqual({ medicine: "IBUPROFEN 200 mg", directions: null, date: null, clinic: null });
  });

  it("a failing model is a VisionError with no detail beyond the message", async () => {
    const llm: LlmClient = {
      provider: "fake",
      model: "m",
      async chat() {
        throw new Error("upstream 500");
      },
    };
    await expect(readLabelText({ bytes: png("ibuprofen"), mime: "image/png" }, { llm })).rejects.toMatchObject({ code: "model_failed" });
  });

  it("cleanTranscript strips fences and trailing spaces", () => {
    expect(cleanTranscript("```text\nA  \nB\n```")).toBe("A\nB");
    expect(cleanTranscript("\r\nA\r\nB\r\n")).toBe("A\nB");
  });
});

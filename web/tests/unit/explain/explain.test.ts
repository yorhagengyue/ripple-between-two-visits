/**
 * M5 explain card 「为什么没感觉也要吃」, read-aloud and medication day gating.
 *   - the card appears only from D8 (R3 is said at the v2 visit); before that it is absent;
 *   - every sentence is R3 verbatim (doctor), a confirmed counter line verbatim, or an amlodipine patient_text entry,
 *     each with its source chip, and each passes lib/safety's three checks (layer 3 with the mock checker);
 *   - R3's chip follows the transcript: 推断：医生 after a replay he has not confirmed, 医生说 otherwise; its clip is
 *     fixtures/visits/clips/v2-u06.wav, a stand-in;
 *   - Mandarin: doctor and counter lines stay in their own language, patient_text uses its own zh;
 *   - read-aloud: the text sent to TTS is exactly the card's rendered text; mock TTS returns a playable WAV;
 *   - med-relative-box is not on /p/meds before D8.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { POST as ttsPOST } from "@/app/api/tts/route";
import { buildExplainCard, explainSpeechText, LEAFLET_SUFFIXES, pickExplainSources, sentenceFor } from "@/lib/explain/card";
import { allExplainStrings } from "@/lib/explain/i18n";
import { readExplainCardAloud, textSha256 } from "@/lib/explain/read-aloud";
import type { ExplainCardView } from "@/lib/explain/types";
import { createMockLlm } from "@/lib/llm";
import { chipKindText } from "@/lib/meds/chips";
import { listMedGroups } from "@/lib/meds/list";
import { buildCandidates, medsOnDay, verifySentences, type Sentence } from "@/lib/safety";
import { getMemoryStore } from "@/lib/store/memory";
import type { SessionRow } from "@/lib/store/types";
import { createMockTts } from "@/lib/tts/mock";
import type { TtsProvider, TtsRequest } from "@/lib/tts";
import { parseWav } from "@/lib/visit/wav";
import { confirmVisit } from "@/lib/visit/pipeline";
import { finalizeReplay, newSession, replayLive } from "../visit/helpers";

const FIXTURES = path.join(process.cwd(), "fixtures");
const seed = JSON.parse(readFileSync(path.join(FIXTURES, "timeline.seed.json"), "utf8")) as {
  required_doctor_lines: { id: string; text: string }[];
};
const R3 = seed.required_doctor_lines.find((r) => r.id === "R3")!.text;
const patientText = JSON.parse(readFileSync(path.join(process.cwd(), "kb", "patient_text.json"), "utf8")) as {
  entries: { id: string; drug: string; en: string; zh: string }[];
};
const PT = (id: string) => patientText.entries.find((e) => e.id === id)!;
const COUNTER_U12 = "陈先生，这是 amlodipine，每天早上吃一粒，饭前饭后都可以。";
const COUNTER_U13 = "忘了吃的话，想起来就吃，但是不要一次吃两粒。";

async function card(s: SessionRow, locale: "en" | "zh-Hans", day = s.story_day): Promise<ExplainCardView | null> {
  const store = getMemoryStore();
  const med = (await store.getMed(s.id, "med-amlodipine"))!;
  return buildExplainCard(store, s.id, med, { day, locale });
}

/** Replay v2, run the whole-visit pass, and confirm the cards whose anchors are given (null = every card). */
async function replayAndConfirm(s: SessionRow, anchors: string[] | null) {
  await replayLive(s, "v2");
  const done = await finalizeReplay(s, "v2");
  const items: Record<string, "right"> = {};
  for (const c of done.cards) {
    if (c.kind !== "doc") continue;
    if (anchors && !anchors.includes(c.anchor)) continue;
    for (const r of c.rows) items[r.itemId] = "right";
  }
  await confirmVisit(getMemoryStore(), s, "v2", { mine: ["v2-u02", "v2-u03", "v2-u10", "v2-u14", "v2-u16"], items });
}

describe("explain card: story day gating", () => {
  it("absent on D0 and D7, present from D8 (R3 is said at the v2 visit)", async () => {
    for (const day of [0, 7]) {
      const s = await newSession({ story_day: day });
      expect(await card(s, "zh-Hans"), `D${day}`).toBeNull();
      expect(await card(s, "en"), `D${day}`).toBeNull();
    }
    for (const day of [8, 9, 29, 43]) {
      const s = await newSession({ story_day: day });
      const c = await card(s, "zh-Hans");
      expect(c, `D${day}`).not.toBeNull();
      expect(c!.lines[0]).toMatchObject({ kind: "doctor", sourceId: "visit:v2:R3", text: R3 });
    }
  });

  it("no card for a medicine with no doctor's reason (ibuprofen, the relative's box, losartan)", async () => {
    const s = await newSession({ story_day: 43 });
    const store = getMemoryStore();
    for (const id of ["med-ibuprofen", "med-relative-box", "med-losartan"]) {
      const med = (await store.getMed(s.id, id))!;
      expect(await buildExplainCard(store, s.id, med, { day: 43, locale: "zh-Hans" }), id).toBeNull();
    }
  });
});

describe("explain card: only R3, confirmed counter lines and patient_text; every sentence sourced and checked", () => {
  it("seed session: R3 (医生说, with its stand-in clip) and the amlodipine leaflet lines, in both languages", async () => {
    const s = await newSession({ story_day: 9 });
    const zh = (await card(s, "zh-Hans"))!;
    const en = (await card(s, "en"))!;
    const leafletIds = LEAFLET_SUFFIXES.map((x) => `amlodipine.${x}`);
    expect(zh.lines.map((l) => l.kind)).toEqual(["doctor", ...leafletIds.map(() => "leaflet")]);
    expect(zh.lines.map((l) => l.sourceId)).toEqual(["visit:v2:R3", ...leafletIds.map((id) => `hh-amlodipine:${id}`)]);
    expect(zh.hidden).toEqual([]);

    // R3 verbatim in English on the Mandarin card, with a Mandarin source label; leaflet lines in their own zh
    expect(zh.lines[0]).toMatchObject({ text: R3, lang: "en", requiredLine: "R3" });
    expect(chipKindText("zh-Hans", zh.lines[0].chip)).toBe("医生说");
    expect(chipKindText("en", en.lines[0].chip)).toBe("Doctor said");
    expect(zh.lines[0].chip).toMatchObject({ kind: "doctor", date: "2026-09-01", tStartMs: 20767, standInVoice: true });
    expect(zh.lines[0].clip).toEqual({ url: `/api/visits/v2/clip?u=v2-u06&session=${encodeURIComponent(s.id)}`, standIn: true });
    for (const [i, id] of leafletIds.entries()) {
      expect(zh.lines[i + 1]).toMatchObject({ text: PT(id).zh, lang: "zh-Hans", clip: null });
      expect(en.lines[i + 1]).toMatchObject({ text: PT(id).en, lang: "en", clip: null });
      expect(chipKindText("zh-Hans", zh.lines[i + 1].chip)).toBe("单张");
    }
    // every line has a source chip
    for (const l of [...zh.lines, ...en.lines]) expect(l.chip.kind).toMatch(/^(doctor|dispenser|pharmacist|leaflet)$/);
  });

  it("every sentence passes the three checks (layer 3 with the mock checker, which approves nothing it is asked)", async () => {
    for (const setup of ["seed", "confirmed replay"] as const) {
      const s = await newSession({ story_day: 29 });
      if (setup === "confirmed replay") await replayAndConfirm(s, null);
      const store = getMemoryStore();
      const med = (await store.getMed(s.id, "med-amlodipine"))!;
      const cands = await buildCandidates(store, s.id, { day: 29, route: "explain", topics: ["why_take"] });
      const picked = pickExplainSources(cands, med);
      expect(picked.length).toBeGreaterThanOrEqual(4);
      const sentences = picked.map((p) => sentenceFor(p.candidate));
      const checker = createMockLlm();
      const { verdicts } = await verifySentences(sentences, { candidates: cands.byId, checker, checkerReason: "test" });
      for (const v of verdicts) {
        expect(v.pass, `${setup}: ${v.sentence.sourceId} ${JSON.stringify(v.layer1.reasons)}`).toBe(true);
        expect(v.layer1.pass && v.layer2!.pass && v.layer3!.pass).toBe(true);
        expect(v.layer3!.needed, v.sentence.sourceId).toBe(false); // a quote or a reviewed restatement, never a paraphrase
        expect(v.sentence.sourceId).toBeTruthy();
        expect(["span", "patient_text"]).toContain(v.sentence.origin);
      }
      // the same checks do stop a sentence nobody said, on the same source
      const made: Sentence = { ...sentences[0], en: "It is safe to take an extra tablet when you feel fine.", origin: undefined };
      const blocked = (await verifySentences([made], { candidates: cands.byId, checker, checkerReason: "test" })).verdicts[0];
      expect(blocked.pass).toBe(false);
    }
  });

  it("counter lines join the card only once he confirmed who said them; only the ones about this medicine or a missed dose", async () => {
    const replayed = await newSession({ story_day: 29 });
    await replayLive(replayed, "v2");
    await finalizeReplay(replayed, "v2");
    const before = (await card(replayed, "zh-Hans"))!;
    expect(before.lines.filter((l) => l.kind === "counter")).toEqual([]);

    const s = await newSession({ story_day: 29 });
    await replayAndConfirm(s, null);
    for (const locale of ["zh-Hans", "en"] as const) {
      const c = (await card(s, locale))!;
      const counter = c.lines.filter((l) => l.kind === "counter");
      expect(counter.map((l) => l.text), locale).toEqual([COUNTER_U12, COUNTER_U13]);
      // confirmed counter items of the v2 visit (lib/safety source ids visit:v2:<item>), quoting v2-u12 and v2-u13
      expect(counter.map((l) => l.sourceId)).toEqual([expect.stringMatching(/^visit:v2:v2-u12/), expect.stringMatching(/^visit:v2:v2-u13/)]);
      for (const l of counter) {
        expect(l.lang).toBe("zh-Hans"); // her own words, in her language, also on the English card
        expect(l.chip).toMatchObject({ kind: "dispenser", date: "2026-09-01" });
        expect(l.chip.inferred).toBeUndefined();
      }
      expect(chipKindText(locale, counter[0].chip)).toBe(locale === "zh-Hans" ? "柜台说" : "Clinic counter said");
      // 「对。」 alone and the relative's box line are not about why he takes this medicine
      expect(c.lines.some((l) => l.text === "对。")).toBe(false);
      expect(c.lines.some((l) => l.text.includes("不认得"))).toBe(false);
      // nothing else: every line is R3, a confirmed counter line of v2, or an amlodipine patient_text entry
      for (const l of c.lines) {
        const ok =
          (l.kind === "doctor" && l.text === R3) ||
          (l.kind === "counter" && [COUNTER_U12, COUNTER_U13].includes(l.text)) ||
          (l.kind === "leaflet" && patientText.entries.some((e) => e.drug === "amlodipine" && (e.en === l.text || e.zh === l.text)));
        expect(ok, l.text).toBe(true);
      }
    }
  });

  it("R3's chip follows the transcript: 推断：医生 after an unconfirmed replay, 医生说 once he confirms it", async () => {
    const s = await newSession({ story_day: 29 });
    await replayAndConfirm(s, ["v2-u08"]); // confirms R4 only
    const zh = (await card(s, "zh-Hans"))!;
    const en = (await card(s, "en"))!;
    expect(zh.lines[0].chip.inferred).toBe(true);
    expect(chipKindText("zh-Hans", zh.lines[0].chip)).toBe("推断：医生");
    expect(chipKindText("en", en.lines[0].chip)).toBe("Inferred: doctor");
    expect(zh.lines[0].clip?.url).toContain("u=v2-u06");

    const t = await newSession({ story_day: 29 });
    await replayAndConfirm(t, ["v2-u06", "v2-u08"]);
    const zh2 = (await card(t, "zh-Hans"))!;
    expect(zh2.lines[0].chip.inferred).toBeUndefined();
    expect(chipKindText("zh-Hans", zh2.lines[0].chip)).toBe("医生说");
  });
});

describe("read-aloud", () => {
  it("sends exactly the card's rendered text to TTS (no title, no labels, nothing added)", async () => {
    const s = await newSession({ story_day: 29 });
    const zh = (await card(s, "zh-Hans"))!;
    expect(zh.speechText).toBe(zh.lines.map((l) => l.text).join("\n"));
    expect(explainSpeechText(zh.lines)).toBe(zh.speechText);
    const heard: TtsRequest[] = [];
    const spy: TtsProvider = {
      name: "mock",
      ready: true,
      async synthesize(req) {
        heard.push(req);
        return createMockTts().synthesize(req);
      },
    };
    const out = await readExplainCardAloud(getMemoryStore(), s.id, "med-amlodipine", "zh-Hans", spy);
    expect(heard).toEqual([{ text: zh.speechText, lang: "zh-Hans" }]);
    expect(out.text).toBe(zh.speechText);
    expect(out.sha256).toBe(textSha256(zh.speechText));
    for (const extra of ["为什么没感觉也要吃", "医生说", "推断", "代录音", "草稿措辞", "朗读", "hh-amlodipine", "healthhub"]) expect(heard[0].text).not.toContain(extra);
    expect(heard[0].text.split("\n")).toEqual(zh.lines.map((l) => l.text));
  });

  it("mock TTS: a playable 16 kHz mono WAV, the same bytes for the same text, longer for longer text", async () => {
    const tts = createMockTts();
    const a = await tts.synthesize({ text: "今天", lang: "zh-Hans" });
    const b = await tts.synthesize({ text: "今天", lang: "zh-Hans" });
    expect(Buffer.from(a.audio).equals(Buffer.from(b.audio))).toBe(true);
    const info = parseWav(a.audio)!;
    expect(info).toMatchObject({ sampleRate: 16000, channels: 1, bitsPerSample: 16 });
    expect(info.durationMs).toBeGreaterThanOrEqual(1500);
    const long = await tts.synthesize({ text: R3, lang: "en" });
    expect(parseWav(long.audio)!.durationMs).toBeGreaterThan(info.durationMs);
    await expect(tts.synthesize({ text: "  ", lang: "en" })).rejects.toMatchObject({ code: "empty_text" });
  });

  it("POST /api/tts: 200 audio/wav of the whole zh card, 409 before D8, 404 unknown medicine, 400 for free text", async () => {
    const s = await newSession({ story_day: 29 });
    const req = (sid: string, body: unknown) =>
      new NextRequest(`http://localhost/api/tts?session=${sid}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const res = await ttsPOST(req(s.id, { card: "explain", med_id: "med-amlodipine", locale: "zh-Hans" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("audio/wav");
    expect(res.headers.get("x-ripple-tts-provider")).toBe("mock");
    const zh = (await card(s, "zh-Hans"))!;
    expect(res.headers.get("x-ripple-tts-sha256")).toBe(textSha256(zh.speechText));
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe("RIFF");
    expect(parseWav(bytes)!.durationMs).toBeGreaterThan(3000);

    const early = await newSession({ story_day: 7 });
    const r7 = await ttsPOST(req(early.id, { card: "explain", med_id: "med-amlodipine" }));
    expect(r7.status).toBe(409);
    expect((await ttsPOST(req(s.id, { card: "explain", med_id: "med-nope" }))).status).toBe(404);
    // the browser cannot make it read its own words
    expect((await ttsPOST(req(s.id, { text: "Take two tablets." }))).status).toBe(400);
    expect((await ttsPOST(req(s.id, { card: "explain", med_id: "med-amlodipine", text: "extra" }))).status).toBe(400);
  });
});

describe("interface wording", () => {
  it("no judgement about readings and no right / wrong wording in the card or checklist chrome", () => {
    const strings = allExplainStrings().join("\n");
    for (const w of ["正常", "偏高", "危险", "答对", "答错", "正确", "错误", "分数", "对吗", "不对"]) expect(strings).not.toContain(w);
    for (const w of ["normal", "high", "dangerous", "good", "correct", "wrong", "right", "score", "passed", "failed the"]) {
      expect(strings, w).not.toMatch(new RegExp(`\\b${w}\\b`, "i"));
    }
  });
});

describe("medication day gating: the relative's box arrives at the D8 counter", () => {
  it("not on /p/meds on D0 or D7; listed from D8 (and not a source for lib/safety before then)", async () => {
    const store = getMemoryStore();
    for (const [day, listed] of [
      [0, false],
      [7, false],
      [8, true],
      [29, true],
    ] as const) {
      const s = await newSession({ story_day: day });
      const groups = await listMedGroups(store, s.id, day, "zh-Hans");
      const ids = groups.flatMap((g) => g.items.map((i) => i.id));
      expect(ids.includes("med-relative-box"), `D${day}`).toBe(listed);
      expect(groups.some((g) => g.origin === "relative"), `D${day}`).toBe(listed);
      const meds = medsOnDay(await store.listMeds(s.id), await store.listVisits(s.id), day);
      expect(meds.some((m) => m.id === "med-relative-box"), `D${day}`).toBe(listed);
    }
    // the store row itself keeps everything else the seed says
    const s = await newSession({ story_day: 8 });
    expect(await store.getMed(s.id, "med-relative-box")).toMatchObject({ start_day: 8, origin: "relative", status: "unidentified", drug_id: null });
  });
});

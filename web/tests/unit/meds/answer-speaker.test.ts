/**
 * Who said the recorded answer to a medicine's question (web-app.md section 8 hard rule: a medication sentence
 * never becomes "X said" by inference; it needs his confirmation). Fixes the M3 verification finding where an
 * unconfirmed line defaulted to the person the question was for:
 * - D12, his own line p1-u01 picked as the answer showed under 药剂师说;
 * - with the question open at D43 the picker offered v3 lines too, and Dr Lim's v3-u17 showed under 药剂师说.
 * Now: a confirmed role from his review, or the speaker he names, or nobody; only lines from the visits where the
 * question's addressee works, after the question, are offered or accepted.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import v3Utterances from "@/fixtures/visits/v3.utterances.json";
import { answerChoices, linkAnswer, questionForMed } from "@/lib/meds/answers";
import { buildMedCardView, cardText } from "@/lib/meds/card";
import { chipKindText } from "@/lib/meds/chips";
import type { StoredLabel } from "@/lib/meds/types";
import { confirmLabel, readLabel, requiredConfirmations } from "@/lib/meds/write";
import { p1Fixture, setup, type Ctx } from "./helpers";

let blobDir: string;
beforeAll(() => {
  blobDir = mkdtempSync(path.join(tmpdir(), "ripple-m3-speaker-"));
});
afterAll(() => rmSync(blobDir, { recursive: true, force: true }));

const ENV = { SPEECH_PROVIDER: "mock" };
const P1 = Object.fromEntries(p1Fixture().map((u) => [u.id, u.text]));
const NAMED = ["doctor", "dispenser", "pharmacist"];
const NAMED_TEXT = ["药剂师说", "医生说", "柜台说", "Pharmacist said", "Doctor said", "Clinic counter said"];

/** The relative's box photographed and confirmed on `day`: the unknown medicine and its question for the pharmacist. */
async function unknownBox(ctx: Ctx) {
  const read = await readLabel({ sessionId: ctx.sessionId, path: await ctx.upload("relative_box") }, ctx.deps);
  const res = await confirmLabel(
    { sessionId: ctx.sessionId, readToken: read.read_token, origin: "relative", confirmed: requiredConfirmations(read.fields), locale: "en" },
    ctx.deps,
  );
  expect(res.outcome).toBe("unidentified");
  return res.med;
}

const deps = (ctx: Ctx) => ({ store: ctx.store, publish: ctx.deps.publish, env: ENV });

async function views(ctx: Ctx, medId: string, day: number) {
  const med = (await ctx.store.getMed(ctx.sessionId, medId))!;
  return {
    zh: await buildMedCardView(ctx.store, ctx.sessionId, med, { day, locale: "zh-Hans", env: ENV }),
    en: await buildMedCardView(ctx.store, ctx.sessionId, med, { day, locale: "en", env: ENV }),
  };
}

describe("the speaker of a linked answer is never inferred", () => {
  it("D12: his own line p1-u01 linked without naming anyone shows as a recording, never 药剂师说", async () => {
    const ctx = await setup(blobDir, 12);
    const med = await unknownBox(ctx);
    const { question, med: after } = await linkAnswer({ sessionId: ctx.sessionId, medId: med.id, visitId: "p1", utteranceId: "p1-u01" }, deps(ctx));
    expect(question).toMatchObject({ status: "answered", answer_text: P1["p1-u01"], answer_utterance_id: "p1-u01", answer_visit_id: "p1", answer_speaker: null });
    expect(after?.pharmacist_answer).toBeNull(); // the medicine keeps a pharmacist's answer only when the pharmacist is named

    const { zh, en } = await views(ctx, med.id, 12);
    for (const [locale, view] of [["zh-Hans", zh], ["en", en]] as const) {
      const answer = view.question?.answer;
      expect(answer?.text).toBe(P1["p1-u01"]);
      expect(answer?.chip.kind).toBe("recording");
      expect(NAMED).not.toContain(answer?.chip.kind);
      expect(chipKindText(locale, answer!.chip)).toBe(locale === "zh-Hans" ? "录音" : "Recording");
      expect(view.question?.answerSpeaker).toBeNull();
      // nobody named yet: he may pick again and say who said it
      expect(view.question?.answerChoices.map((c) => c.utteranceId)).toEqual(["p1-u01", "p1-u02", "p1-u03"]);
    }
  });

  it("D12: p1-u03 (an instruction) linked without naming anyone is saved word for word but not shown; naming the pharmacist shows it", async () => {
    const ctx = await setup(blobDir, 12);
    // The seed is the story's end state: q-relative-box already records the pharmacist saying p1-u03, and lib/safety
    // takes that line's attribution from that record. Clear the record so no stored record names the speaker.
    await ctx.store.updateQuestion(ctx.sessionId, "q-relative-box", { status: "open", answer_text: null, answer_visit_id: null, answer_speaker: null });
    const med = await unknownBox(ctx);
    const first = await linkAnswer({ sessionId: ctx.sessionId, medId: med.id, visitId: "p1", utteranceId: "p1-u03", speaker: null }, deps(ctx));
    expect(first.question).toMatchObject({ answer_text: P1["p1-u03"], answer_utterance_id: "p1-u03", answer_speaker: null });

    const unnamed = await views(ctx, med.id, 12);
    for (const view of [unnamed.zh, unnamed.en]) {
      expect(view.question?.answer).toBeNull();
      expect(view.question?.answerHidden).toBe(true);
      expect(view.question?.answerSpeaker).toBeNull();
      const hidden = view.hidden.find((h) => h.section === "answer");
      expect(hidden?.reasons).toContain("directive_without_attribution"); // lib/safety's layer 2
      expect(cardText(view)).not.toContain("Please don't take it for now");
    }

    const named = await linkAnswer({ sessionId: ctx.sessionId, medId: med.id, visitId: "p1", utteranceId: "p1-u03", speaker: "pharmacist" }, deps(ctx));
    expect(named.question.answer_speaker).toBe("pharmacist");
    expect(named.med?.pharmacist_answer).toEqual({ visit_id: "p1", text: P1["p1-u03"] });
    const { zh } = await views(ctx, med.id, 12);
    expect(zh.question?.answer).toMatchObject({ text: P1["p1-u03"], chip: { kind: "pharmacist", date: "2026-09-05" } });
    expect(zh.question?.answerHidden).toBe(false);
    expect(zh.question?.answerChoices).toEqual([]);
  });

  it("question still open at D43: only the pharmacy visit's lines are offered, and Dr Lim's v3-u17 cannot be linked to it", async () => {
    const ctx = await setup(blobDir, 8);
    const med = await unknownBox(ctx);
    await ctx.store.setStoryDay(ctx.sessionId, 43);
    const { zh, en } = await views(ctx, med.id, 43);
    for (const view of [zh, en]) {
      const choices = view.question?.answerChoices ?? [];
      expect(choices.map((c) => c.utteranceId)).toEqual(["p1-u01", "p1-u02", "p1-u03"]);
      expect(choices.every((c) => c.visitId === "p1" && c.speaker === null && c.speakerOptions.join() === "pharmacist")).toBe(true);
    }

    for (const speaker of [undefined, "pharmacist" as const, "doctor" as const]) {
      await expect(linkAnswer({ sessionId: ctx.sessionId, medId: med.id, visitId: "v3", utteranceId: "v3-u17", speaker }, deps(ctx))).rejects.toMatchObject({
        code: "visit_not_for_question",
        status: 409,
      });
    }
    // a clinic visit on the day the question was raised does not answer a question for the pharmacist either
    await expect(linkAnswer({ sessionId: ctx.sessionId, medId: med.id, visitId: "v2", utteranceId: "v2-u08" }, deps(ctx))).rejects.toMatchObject({
      code: "visit_not_for_question",
    });
    // and he cannot name a doctor for a line at the pharmacy
    await expect(
      linkAnswer({ sessionId: ctx.sessionId, medId: med.id, visitId: "p1", utteranceId: "p1-u03", speaker: "doctor" }, deps(ctx)),
    ).rejects.toMatchObject({ code: "speaker_not_at_visit", status: 400 });

    const q = questionForMed((await ctx.store.getMed(ctx.sessionId, med.id))!, await ctx.store.listQuestions(ctx.sessionId));
    expect(q).toMatchObject({ status: "open", answer_text: null, answer_speaker: null });
    const text = cardText(zh) + cardText(en);
    expect(text).not.toContain("ibuprofen");
    for (const view of [zh, en]) {
      for (const line of [...view.purpose, ...view.howToTake, ...view.leaflet, ...view.unknown]) expect(NAMED).not.toContain(line.chip.kind);
    }
  });

  it("roles M2 only inferred do not count: he names the speaker, or nobody is named", async () => {
    const ctx = await setup(blobDir, 12);
    const rows = p1Fixture().map((u, i) => ({ ...u, role: (i === 0 ? "patient" : "pharmacist") as "patient" | "pharmacist", role_state: "inferred" as const }));
    await ctx.store.addUtterances(ctx.sessionId, "p1", rows);
    const med = await unknownBox(ctx);
    const choices = (await views(ctx, med.id, 12)).en.question?.answerChoices ?? [];
    expect(choices.map((c) => [c.utteranceId, c.speaker])).toEqual([
      ["p1-u01", null],
      ["p1-u02", null],
      ["p1-u03", null],
    ]);
    const { question } = await linkAnswer({ sessionId: ctx.sessionId, medId: med.id, visitId: "p1", utteranceId: "p1-u03" }, { ...deps(ctx), env: { SPEECH_PROVIDER: "trtc" } });
    expect(question.answer_speaker).toBeNull();
  });

  it("roles he confirmed in his review: his own line is not an answer; a confirmed clinician role wins over the one he names", async () => {
    const ctx = await setup(blobDir, 43);
    const p1Rows = p1Fixture().map((u, i) => ({ ...u, role: (i === 0 ? "patient" : "pharmacist") as "patient" | "pharmacist", role_state: "confirmed" as const }));
    await ctx.store.addUtterances(ctx.sessionId, "p1", p1Rows);
    const med = await unknownBox(ctx); // raised on D43: the D12 pharmacy visit is before it
    await expect(linkAnswer({ sessionId: ctx.sessionId, medId: med.id, visitId: "p1", utteranceId: "p1-u03" }, deps(ctx))).rejects.toMatchObject({
      code: "visit_not_for_question",
    });

    // the seeded question for the doctor about the knee (raised on D30), answered at the D42 clinic visit
    const knee = (await ctx.store.getQuestion(ctx.sessionId, "q-knee-2"))!;
    expect(knee).toMatchObject({ for: "doctor", status: "open" });
    const offered = await answerChoices(ctx.store, ctx.sessionId, knee, 43, ENV);
    expect(offered.length).toBeGreaterThan(0);
    expect(offered.every((c) => c.visitId === "v3" && c.speakerOptions.join() === "doctor,dispenser" && c.speaker === null)).toBe(true);
    await expect(linkAnswer({ sessionId: ctx.sessionId, questionId: "q-knee-2", visitId: "p1", utteranceId: "p1-u02" }, deps(ctx))).rejects.toMatchObject({
      code: "visit_not_for_question",
    });
    await expect(
      linkAnswer({ sessionId: ctx.sessionId, questionId: "q-knee-2", visitId: "v3", utteranceId: "v3-u17", speaker: "pharmacist" }, deps(ctx)),
    ).rejects.toMatchObject({ code: "speaker_not_at_visit" });
    const named = await linkAnswer({ sessionId: ctx.sessionId, questionId: "q-knee-2", visitId: "v3", utteranceId: "v3-u17", speaker: "doctor" }, deps(ctx));
    expect(named.question.answer_speaker).toBe("doctor");

    // with his review in the store, the confirmed role is used whatever he names now
    const ctx2 = await setup(blobDir, 43);
    await ctx2.store.addUtterances(
      ctx2.sessionId,
      "v3",
      v3Utterances.utterances.map((u) => ({ ...u, role: (u.id === "v3-u17" ? "doctor" : "unknown") as "doctor" | "unknown", role_state: (u.id === "v3-u17" ? "confirmed" : "unknown") as "confirmed" | "unknown" })),
    );
    const confirmed = await linkAnswer({ sessionId: ctx2.sessionId, questionId: "q-knee-2", visitId: "v3", utteranceId: "v3-u17", speaker: "dispenser" }, deps(ctx2));
    expect(confirmed.question.answer_speaker).toBe("doctor");
  });

  it("the seeded box: relinking its recorded line keeps the speaker the record holds; another line with nobody named drops it", async () => {
    const ctx = await setup(blobDir, 29);
    const same = await linkAnswer({ sessionId: ctx.sessionId, medId: "med-relative-box", visitId: "p1", utteranceId: "p1-u03" }, deps(ctx));
    expect(same.question).toMatchObject({ id: "q-relative-box", answer_utterance_id: "p1-u03", answer_speaker: "pharmacist" });
    expect((same.med?.label as StoredLabel).question_id).toBe("q-relative-box"); // found by id from now on
    // he says he is not sure: the record no longer names anyone
    const unsure = await linkAnswer({ sessionId: ctx.sessionId, medId: "med-relative-box", visitId: "p1", utteranceId: "p1-u03", speaker: null }, deps(ctx));
    expect(unsure.question.answer_speaker).toBeNull();
    expect(unsure.med?.pharmacist_answer).toBeNull();
    expect((await views(ctx, "med-relative-box", 29)).en.question).toMatchObject({ id: "q-relative-box", answer: null, answerHidden: true });

    const other = await linkAnswer({ sessionId: ctx.sessionId, medId: "med-relative-box", visitId: "p1", utteranceId: "p1-u02" }, deps(ctx));
    expect(other.question).toMatchObject({ id: "q-relative-box", answer_text: P1["p1-u02"], answer_speaker: null });
    expect(other.med?.pharmacist_answer).toBeNull();
    const { zh } = await views(ctx, "med-relative-box", 29);
    expect(zh.question?.id).toBe("q-relative-box");
    expect(zh.question?.answer?.chip.kind).toBe("recording");
    for (const t of NAMED_TEXT) expect(chipKindText("zh-Hans", zh.question!.answer!.chip)).not.toBe(t);
    expect(zh.question?.answerChoices.length).toBe(3);
  });
});

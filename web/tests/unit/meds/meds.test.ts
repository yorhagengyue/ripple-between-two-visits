/**
 * Task M3 acceptance, at the library level (docs/plan/tasks/M3-meds.md):
 * - amlodipine.png -> fields equal amlodipine.expected.json; after he confirms, status label_confirmed
 * - relative_box.png -> exactly the fixed sentence, and one question for the pharmacist
 * - ibuprofen: the standard leaflet card (no blood pressure, 血压, amlodipine) and his question for the pharmacist,
 *   no judgement about taking it with anything
 * - amlodipine card: R3 first (doctor, visit date and time point), then the leaflet; how to take from the label;
 *   before the label is confirmed, the leaflet parts and "awaiting label"
 * - the pharmacist's answer in visit p1 links to the unknown-medicine question (verbatim, with the utterance id)
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { linkAnswer, questionForMed } from "@/lib/meds/answers";
import { buildMedCardView, cardText } from "@/lib/meds/card";
import { listMedGroups } from "@/lib/meds/list";
import { signReadToken } from "@/lib/meds/read-token";
import type { StoredLabel } from "@/lib/meds/types";
import { confirmLabel, readLabel, relabelMed, requiredConfirmations } from "@/lib/meds/write";
import { UNKNOWN_MED_SENTENCE } from "@/lib/safety";
import { expectedLabel, p1Fixture, setup, type Ctx } from "./helpers";

let blobDir: string;
beforeAll(() => {
  blobDir = mkdtempSync(path.join(tmpdir(), "ripple-m3-"));
});
afterAll(() => rmSync(blobDir, { recursive: true, force: true }));

const ALL = ["drug_text", "strength", "directions", "dispensed", "clinic"];
const R3 =
  "This tablet works quietly. You won't feel it, and you don't feel the high pressure either, but over the years high pressure damages the heart, the brain and the kidneys. So you take it every day, even when you feel fine.";
/** amlodipine patient_text whose wording drifts from its evidence (web/PROGRESS.md, M1); fixed ones simply stop being hidden */
const KNOWN_DRIFT = ["hh-amlodipine:amlodipine.food", "hh-amlodipine:amlodipine.missed", "hh-ibuprofen:ibuprofen.food"];

async function readAndConfirm(ctx: Ctx, name: "amlodipine" | "ibuprofen" | "relative_box", opts: { origin?: "prescription" | "self_bought" | "relative" | "supplement"; medId?: string; locale?: "en" | "zh-Hans" } = {}) {
  const read = await readLabel({ sessionId: ctx.sessionId, path: await ctx.upload(name) }, ctx.deps);
  const res = await confirmLabel(
    { sessionId: ctx.sessionId, readToken: read.read_token, origin: opts.origin, medId: opts.medId, confirmed: requiredConfirmations(read.fields), locale: opts.locale ?? "en" },
    ctx.deps,
  );
  return { read, res };
}

describe("amlodipine label", () => {
  it("fields equal amlodipine.expected.json; after he confirms each one the status is label_confirmed", async () => {
    const ctx = await setup(blobDir, 8);
    await relabelMed({ sessionId: ctx.sessionId, medId: "med-amlodipine" }, ctx.deps);
    const read = await readLabel({ sessionId: ctx.sessionId, path: await ctx.upload("amlodipine") }, ctx.deps);
    const want = expectedLabel("amlodipine");
    for (const k of ["drug_text", "drug_id", "strength", "directions", "slots", "dispensed", "clinic"] as const) expect(read.fields[k], k).toEqual(want[k]);
    expect(read.display_name).toBe("Amlodipine");
    expect(read.provider).toBe("mock:vision-cassette");
    expect(JSON.stringify(read)).not.toMatch(/Keep out of reach/); // raw text stays on the server

    // every line must be ticked
    await expect(
      confirmLabel({ sessionId: ctx.sessionId, readToken: read.read_token, origin: "prescription", confirmed: ["drug_text", "strength"], locale: "en" }, ctx.deps),
    ).rejects.toMatchObject({ code: "not_all_confirmed", status: 400 });

    const questionsBefore = (await ctx.store.listQuestions(ctx.sessionId)).length;
    const res = await confirmLabel({ sessionId: ctx.sessionId, readToken: read.read_token, origin: "prescription", confirmed: ALL, locale: "en" }, ctx.deps);
    expect(res.outcome).toBe("label_confirmed");
    expect(res.created).toBe(false); // the prescription already on his list
    expect(res.med.id).toBe("med-amlodipine");
    expect(res.med.status).toBe(want.expected_status_after_confirm);
    const label = res.med.label as StoredLabel;
    expect(label.directions).toBe(want.directions);
    expect(label.strength).toBe(want.strength);
    expect(label.dispensed).toBe(want.dispensed);
    expect(label.clinic).toBe(want.clinic);
    expect(label.slots).toEqual(want.slots);
    expect(label.photo_path?.startsWith(`${ctx.sessionId}/labels/`)).toBe(true);
    expect(res.questions).toEqual([]);
    expect((await ctx.store.listQuestions(ctx.sessionId)).length).toBe(questionsBefore);
    expect(ctx.events.some((e) => e.type === "med.changed" && /confirmed the label/.test(e.say))).toBe(true);
  });

  it("a new prescription label goes on the list as a new medicine", async () => {
    const ctx = await setup(blobDir, 5); // before the D8 visit: no amlodipine yet
    const { res } = await readAndConfirm(ctx, "amlodipine", { origin: "prescription" });
    expect(res.created).toBe(true);
    expect(res.med.id).toBe("med-amlodipine-2");
    expect(res.med.start_day).toBe(5);
    const groups = await listMedGroups(ctx.store, ctx.sessionId, 5, "en");
    expect(groups.find((g) => g.origin === "prescription")?.items.map((i) => [i.name, i.strength, i.status])).toEqual([["Amlodipine", "5 mg", "label_confirmed"]]);
  });

  it("the read token is the server's: forged, foreign or expired tokens are refused", async () => {
    const ctx = await setup(blobDir, 8);
    const other = await setup(blobDir, 8);
    const read = await readLabel({ sessionId: ctx.sessionId, path: await ctx.upload("amlodipine") }, ctx.deps);
    const [body, sig] = read.read_token.split(".");
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    payload.fields.directions = "Take TWO tablets every MORNING";
    const forged = `${Buffer.from(JSON.stringify(payload)).toString("base64url")}.${sig}`;
    const base = { origin: "prescription" as const, confirmed: ALL, locale: "en" as const };
    await expect(confirmLabel({ ...base, sessionId: ctx.sessionId, readToken: forged }, ctx.deps)).rejects.toMatchObject({ code: "bad_read_token" });
    await expect(confirmLabel({ ...base, sessionId: other.sessionId, readToken: read.read_token }, other.deps)).rejects.toMatchObject({ code: "read_token_session" });
    const old = signReadToken({ sid: ctx.sessionId, path: "x", fields: read.fields, by: "t" }, { nowMs: Date.now() - 2 * 3600_000 });
    await expect(confirmLabel({ ...base, sessionId: ctx.sessionId, readToken: old }, ctx.deps)).rejects.toMatchObject({ code: "read_token_expired" });
  });

  it("a photo outside the session, or not uploaded, is refused", async () => {
    const ctx = await setup(blobDir, 8);
    await expect(readLabel({ sessionId: ctx.sessionId, path: `someone-else/labels/a.png` }, ctx.deps)).rejects.toMatchObject({ code: "photo_not_in_session" });
    await expect(readLabel({ sessionId: ctx.sessionId, path: `${ctx.sessionId}/labels/missing.png` }, ctx.deps)).rejects.toMatchObject({ code: "photo_not_found" });
  });

  it("a label for another medicine cannot be attached to this one", async () => {
    const ctx = await setup(blobDir, 29);
    const read = await readLabel({ sessionId: ctx.sessionId, path: await ctx.upload("ibuprofen") }, ctx.deps);
    await expect(
      confirmLabel({ sessionId: ctx.sessionId, readToken: read.read_token, medId: "med-amlodipine", confirmed: requiredConfirmations(read.fields), locale: "en" }, ctx.deps),
    ).rejects.toMatchObject({ code: "label_mismatch", status: 409 });
  });
});

describe("amlodipine card", () => {
  it("before the label is confirmed: the leaflet parts and the awaiting-label marker; R3 first", async () => {
    const ctx = await setup(blobDir, 8);
    const med = await relabelMed({ sessionId: ctx.sessionId, medId: "med-amlodipine" }, ctx.deps);
    const view = await buildMedCardView(ctx.store, ctx.sessionId, med, { day: 8, locale: "en" });
    expect(view.awaitingLabel).toBe(true);
    expect(view.howToTake).toEqual([]);
    expect(view.purpose[0].text).toBe(R3);
    expect(view.purpose[0].chip).toMatchObject({ kind: "doctor", date: "2026-09-01" });
    expect(view.purpose[0].chip.tStartMs).toBeGreaterThan(0);
    expect(view.purpose[1].chip.kind).toBe("leaflet");
    expect(view.purpose[1].sourceId).toBe("hh-amlodipine:amlodipine.purpose");
    expect(view.leaflet.length).toBeGreaterThan(0);
    expect(view.leaflet.every((l) => l.chip.kind === "leaflet")).toBe(true);
  });

  it("after: purpose R3 then leaflet, how to take from the label, each with its source; failing parts are hidden", async () => {
    const ctx = await setup(blobDir, 8);
    await relabelMed({ sessionId: ctx.sessionId, medId: "med-amlodipine" }, ctx.deps);
    const { res } = await readAndConfirm(ctx, "amlodipine", { medId: "med-amlodipine" });
    const view = await buildMedCardView(ctx.store, ctx.sessionId, res.med, { day: 8, locale: "en" });
    expect(view.awaitingLabel).toBe(false);
    expect(view.status).toBe("label_confirmed");
    expect(view.purpose.map((l) => l.chip.kind)).toEqual(["doctor", "leaflet"]);
    expect(view.purpose[0].text).toBe(R3);
    expect(view.howToTake).toHaveLength(1);
    expect(view.howToTake[0]).toMatchObject({ text: "Take ONE tablet every MORNING", chip: { kind: "label", date: "2026-09-01" } });
    for (const h of view.hidden) expect(KNOWN_DRIFT, `${h.sourceId}: ${h.reasons.join(",")}`).toContain(h.sourceId);

    const zh = await buildMedCardView(ctx.store, ctx.sessionId, res.med, { day: 8, locale: "zh-Hans" });
    expect(zh.purpose[0].text).toBe(R3); // the doctor's own words stay in English
    expect(zh.howToTake[0].text).toMatch(/一片/);
    expect(zh.howToTake[0]).toMatchObject({ secondLine: "Take ONE tablet every MORNING", secondIsOriginal: true });
    expect(zh.purpose[1].text).toMatch(/降血压/);
  });

  it("before the D8 visit there is no doctor line to quote", async () => {
    const ctx = await setup(blobDir, 5);
    const { res } = await readAndConfirm(ctx, "amlodipine", { origin: "prescription" });
    const view = await buildMedCardView(ctx.store, ctx.sessionId, res.med, { day: 5, locale: "en" });
    expect(view.purpose.map((l) => l.chip.kind)).toEqual(["leaflet"]);
  });
});

describe("medicine from a relative (relative_box.png)", () => {
  it("not identified: exactly the fixed sentence, and one question for the pharmacist", async () => {
    const ctx = await setup(blobDir, 8);
    const pharmacistBefore = (await ctx.store.listQuestions(ctx.sessionId, { for: "pharmacist" })).length;
    const allBefore = (await ctx.store.listQuestions(ctx.sessionId)).length;
    const { read, res } = await readAndConfirm(ctx, "relative_box", { origin: "relative", locale: "zh-Hans" });
    expect(read.fields.drug_id).toBeNull();
    expect(read.fields.drug_text).toBe("宁和平压丸");
    expect(requiredConfirmations(read.fields)).toEqual(["drug_text"]);
    expect(res.outcome).toBe("unidentified");
    expect(res.med.status).toBe("unidentified");
    expect(res.med.origin).toBe("relative");
    expect(res.answer?.route).toBe("unknown_med");
    expect(res.answer?.fixedText).toBe(UNKNOWN_MED_SENTENCE);
    expect(res.answer?.fixedText).toBe("I'm not able to identify that medication, please check with your pharmacist.");
    expect(res.answer?.sentences.map((s) => s.en)).toContain(UNKNOWN_MED_SENTENCE);
    expect((await ctx.store.listQuestions(ctx.sessionId, { for: "pharmacist" })).length).toBe(pharmacistBefore + 1);
    expect((await ctx.store.listQuestions(ctx.sessionId)).length).toBe(allBefore + 1);
    expect(res.questions).toHaveLength(1);
    expect(res.questions[0]).toMatchObject({ for: "pharmacist", origin: "unidentified_medicine", status: "open" });
    expect(res.questions[0].text).toContain("宁和平压丸");
    expect((res.med.label as StoredLabel).question_id).toBe(res.questions[0].id);

    // the box's printed dosing never leaves the server, in any output
    const everything = JSON.stringify({ read, res, events: ctx.events, safety: await ctx.store.listSafetyEvents(ctx.sessionId) });
    for (const banned of expectedLabel("relative_box").must_not_relay as string[]) expect(everything).not.toContain(banned);
    expect(everything).not.toContain("六粒");

    const view = await buildMedCardView(ctx.store, ctx.sessionId, res.med, { day: 8, locale: "zh-Hans" });
    expect(view.name).toBe("宁和平压丸");
    expect(view.unknown).toHaveLength(1);
    expect(view.unknown[0].text).toBe(UNKNOWN_MED_SENTENCE);
    expect(view.unknown[0].secondLine).toMatch(/药剂师/);
    expect(view.purpose).toEqual([]);
    expect(view.howToTake).toEqual([]);
    expect(view.question).toMatchObject({ for: "pharmacist", status: "open", answer: null, answerChoices: [] }); // D12 has not happened
  });

  it("a second photo of the same unidentified medicine does not add a second question", async () => {
    const ctx = await setup(blobDir, 8);
    const first = await readAndConfirm(ctx, "relative_box", { origin: "relative" });
    const before = (await ctx.store.listQuestions(ctx.sessionId)).length;
    const again = await readAndConfirm(ctx, "relative_box", { medId: first.res.med.id });
    expect(again.res.questions).toEqual([]);
    expect((await ctx.store.listQuestions(ctx.sessionId)).length).toBe(before);
  });

  it("the pharmacist's answer in visit p1 links to that question: verbatim, with the utterance id; he names the pharmacist", async () => {
    const ctx = await setup(blobDir, 8);
    const { res } = await readAndConfirm(ctx, "relative_box", { origin: "relative" });
    const medId = res.med.id;
    await expect(linkAnswer({ sessionId: ctx.sessionId, medId, visitId: "p1", utteranceId: "p1-u03" }, { store: ctx.store, publish: ctx.deps.publish })).rejects.toMatchObject({
      code: "visit_not_yet",
    });

    await ctx.store.setStoryDay(ctx.sessionId, 12);
    const med = (await ctx.store.getMed(ctx.sessionId, medId))!;
    const before = await buildMedCardView(ctx.store, ctx.sessionId, med, { day: 12, locale: "en", env: { SPEECH_PROVIDER: "mock" } });
    const p1u03 = p1Fixture().find((u) => u.id === "p1-u03")!;
    expect(before.question?.answerChoices.map((c) => c.utteranceId)).toContain("p1-u03");
    // the developer tools' stand-in (devfake) replays the same files: the same lines are offered (C2's gate runs on it)
    const devfake = await buildMedCardView(ctx.store, ctx.sessionId, med, { day: 12, locale: "en", env: { SPEECH_PROVIDER: "devfake" } });
    expect(devfake.question?.answerChoices.map((c) => c.utteranceId)).toEqual(before.question?.answerChoices.map((c) => c.utteranceId));

    expect(before.question?.answerChoices.every((c) => c.speaker === null && c.speakerOptions.join() === "pharmacist")).toBe(true);
    const { question, med: after } = await linkAnswer(
      { sessionId: ctx.sessionId, medId, visitId: "p1", utteranceId: "p1-u03", speaker: "pharmacist" },
      { store: ctx.store, publish: ctx.deps.publish, env: { SPEECH_PROVIDER: "mock" } },
    );
    expect(question.id).toBe(res.questions[0].id);
    expect(question.status).toBe("answered");
    expect(question.answer_text).toBe(p1u03.text);
    expect(question.answer_utterance_id).toBe("p1-u03");
    expect(question.answer_visit_id).toBe("p1");
    expect(question.answer_speaker).toBe("pharmacist");
    expect(after?.pharmacist_answer).toEqual({ visit_id: "p1", text: p1u03.text });

    const view = await buildMedCardView(ctx.store, ctx.sessionId, after!, { day: 12, locale: "zh-Hans" });
    expect(view.question?.answer).toMatchObject({ text: p1u03.text, chip: { kind: "pharmacist", date: "2026-09-05" } });
    expect(view.question?.answerChoices).toEqual([]);
  });

  it("with M2's transcript in the store, the stored line and its confirmed role are used", async () => {
    const ctx = await setup(blobDir, 12);
    const rows = p1Fixture().map((u, i) => ({ ...u, role: (i === 0 ? "patient" : "pharmacist") as "patient" | "pharmacist", role_state: "confirmed" as const }));
    await ctx.store.addUtterances(ctx.sessionId, "p1", rows);
    const { res } = await readAndConfirm(ctx, "relative_box", { origin: "relative" });
    // created on day 12, the same day as the pharmacy visit: his own line is not offered as an answer
    const view = await buildMedCardView(ctx.store, ctx.sessionId, res.med, { day: 12, locale: "en", env: { SPEECH_PROVIDER: "trtc" } });
    expect(view.question?.answerChoices.map((c) => c.utteranceId)).toEqual(["p1-u02", "p1-u03"]);
    expect(view.question?.answerChoices.map((c) => c.speaker)).toEqual(["pharmacist", "pharmacist"]); // confirmed in his review
    const { question } = await linkAnswer({ sessionId: ctx.sessionId, medId: res.med.id, visitId: "p1", utteranceId: "p1-u03" }, { store: ctx.store, publish: ctx.deps.publish, env: { SPEECH_PROVIDER: "trtc" } });
    expect(question.answer_utterance_id).toBe("p1-u03");
    expect(question.answer_text).toBe(rows[2].text);
    expect(question.answer_speaker).toBe("pharmacist");
  });

  it("the seeded box finds its seeded question, and gets the utterance id when linked", async () => {
    const ctx = await setup(blobDir, 29);
    const med = (await ctx.store.getMed(ctx.sessionId, "med-relative-box"))!;
    const q = questionForMed(med, await ctx.store.listQuestions(ctx.sessionId));
    expect(q?.id).toBe("q-relative-box");
    expect(q?.answer_utterance_id).toBeNull();
    const { question } = await linkAnswer({ sessionId: ctx.sessionId, medId: med.id, visitId: "p1", utteranceId: "p1-u03" }, { store: ctx.store, publish: ctx.deps.publish, env: {} });
    expect(question.id).toBe("q-relative-box");
    expect(question.answer_utterance_id).toBe("p1-u03");
    expect(question.answer_text).toBe(med.pharmacist_answer?.text);

    const view = await buildMedCardView(ctx.store, ctx.sessionId, med, { day: 29, locale: "en" });
    expect(view.unknown[0].text).toBe(UNKNOWN_MED_SENTENCE);
    expect(view.question?.answer?.chip.kind).toBe("pharmacist");
    expect(cardText(view)).not.toContain("六粒");
  });

  it("an unknown utterance or visit is refused", async () => {
    const ctx = await setup(blobDir, 29);
    const deps = { store: ctx.store, publish: ctx.deps.publish, env: {} };
    await expect(linkAnswer({ sessionId: ctx.sessionId, medId: "med-relative-box", visitId: "p1", utteranceId: "p1-u99" }, deps)).rejects.toMatchObject({ code: "utterance_not_found" });
    await expect(linkAnswer({ sessionId: ctx.sessionId, medId: "med-relative-box", visitId: "zz", utteranceId: "p1-u03" }, deps)).rejects.toMatchObject({ code: "visit_not_found" });
    await expect(linkAnswer({ sessionId: ctx.sessionId, medId: "med-amlodipine", visitId: "p1", utteranceId: "p1-u03" }, deps)).rejects.toMatchObject({ code: "no_question" });
  });
});

describe("self-bought ibuprofen", () => {
  const BANNED = ["blood pressure", "血压", "amlodipine"];

  it("the standard leaflet card, his question for the pharmacist, and nothing else", async () => {
    for (const locale of ["en", "zh-Hans"] as const) {
      const ctx = await setup(blobDir, 29);
      const safetyBefore = (await ctx.store.listSafetyEvents(ctx.sessionId)).length;
      const before = await ctx.store.listQuestions(ctx.sessionId);
      const { read, res } = await readAndConfirm(ctx, "ibuprofen", { origin: "self_bought", locale });
      const want = expectedLabel("ibuprofen");
      expect(read.fields.drug_id).toBe(want.drug_id);
      expect(res.outcome).toBe("label_confirmed");
      expect(res.med.status).toBe(want.expected_status_after_confirm);
      expect(res.med.id).toBe("med-ibuprofen"); // the box already on his list
      expect(res.answer).toBeNull(); // no ask(): no generated text at all
      expect((await ctx.store.listSafetyEvents(ctx.sessionId)).length).toBe(safetyBefore);

      const after = await ctx.store.listQuestions(ctx.sessionId);
      expect(after.length).toBe(before.length + 1);
      expect(res.questions).toHaveLength(1);
      const q = res.questions[0];
      expect(q).toMatchObject({ for: "pharmacist", status: "open", lang: locale });
      if (locale === "en") expect(q.text).toBe("ask the pharmacist about taking this with my other medicines");
      else expect(q.text).toBe("这个药和我其他的药一起吃，要问药剂师");
      expect(q.evidence).toContain("med-ibuprofen");
      for (const b of BANNED) expect(q.text.toLowerCase()).not.toContain(b);

      for (const l of ["en", "zh-Hans"] as const) {
        const view = await buildMedCardView(ctx.store, ctx.sessionId, res.med, { day: 29, locale: l });
        const text = cardText(view).toLowerCase();
        for (const b of BANNED) expect(text, `${l}: ${b}`).not.toContain(b);
        expect(view.purpose.map((p) => p.chip.kind)).toEqual(["leaflet"]);
        expect(view.howToTake).toEqual([]); // the box has no dose line
        expect(view.awaitingLabel).toBe(false);
        expect(view.leaflet.length).toBeGreaterThan(0);
      }

      // confirming the same box again does not repeat the question
      await readAndConfirm(ctx, "ibuprofen", { origin: "self_bought", locale });
      expect((await ctx.store.listQuestions(ctx.sessionId)).length).toBe(after.length);
    }
  });

  it("the card is the same as for any user: it does not change with his other medicines", async () => {
    const early = await setup(blobDir, 0); // D0: no amlodipine yet
    const late = await setup(blobDir, 43); // D43: amlodipine and losartan
    const cards = [];
    for (const ctx of [early, late]) {
      const med = (await ctx.store.getMed(ctx.sessionId, "med-ibuprofen"))!;
      const view = await buildMedCardView(ctx.store, ctx.sessionId, med, { day: (await ctx.store.getSession(ctx.sessionId))!.story_day, locale: "en" });
      cards.push(cardText(view));
    }
    expect(cards[0]).toBe(cards[1]);
  });
});

describe("list", () => {
  it("groups by origin with the check status; only what exists on the story day", async () => {
    const ctx = await setup(blobDir, 29);
    const groups = await listMedGroups(ctx.store, ctx.sessionId, 29, "zh-Hans");
    expect(groups.map((g) => g.origin)).toEqual(["prescription", "self_bought", "relative"]);
    expect(groups[0].items.map((i) => i.id)).toEqual(["med-amlodipine"]); // losartan starts on D43
    expect(groups[1].items[0]).toMatchObject({ id: "med-ibuprofen", name: "Ibuprofen", strength: "200 mg", status: "label_confirmed" });
    expect(groups[2].items[0]).toMatchObject({ id: "med-relative-box", status: "unidentified", name: "Ripple 认不出的药" });
    const d43 = await listMedGroups(ctx.store, ctx.sessionId, 43, "en");
    expect(d43[0].items.map((i) => [i.id, i.status])).toEqual([
      ["med-amlodipine", "label_confirmed"],
      ["med-losartan", "awaiting_label"],
    ]);
  });

  it("relabel only for an identified medicine", async () => {
    const ctx = await setup(blobDir, 29);
    await expect(relabelMed({ sessionId: ctx.sessionId, medId: "med-relative-box" }, ctx.deps)).rejects.toMatchObject({ code: "cannot_relabel" });
    await expect(relabelMed({ sessionId: ctx.sessionId, medId: "nope" }, ctx.deps)).rejects.toMatchObject({ code: "med_not_found" });
    expect((await relabelMed({ sessionId: ctx.sessionId, medId: "med-amlodipine" }, ctx.deps)).status).toBe("awaiting_label");
  });
});

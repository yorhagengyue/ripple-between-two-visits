/**
 * M3 acceptance: no output anywhere carries an interaction verdict the app made up (任何输出里没有 app 自己判断的相互
 * 作用; safety_event 里该类拦截记录为零误放).
 *
 * Runs the M3 flows (amlodipine, ibuprofen, the relative's box) and the "ask about this" questions about taking
 * medicines together, in both languages, then checks:
 * - every sentence shown (cards, confirm results, /api/ask answers, every safety_event output) is a quote, a label
 *   line, a leaflet restatement or a fixed template; none is the model's own wording;
 * - nothing the app worded itself (model sentences, or the M3 UI dictionary) carries an interaction word, apart
 *   from his own questions (the quick question and the question-list entries);
 * - a model that tries to slip in an interaction verdict is blocked by lib/safety, and the block is recorded.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMockLlm } from "@/lib/llm";
import type { ComposePayload } from "@/lib/llm/protocol";
import { buildMedCardView } from "@/lib/meds/card";
import { mt, type MedsKey } from "@/lib/meds/i18n";
import { confirmLabel, readLabel, requiredConfirmations } from "@/lib/meds/write";
import { ask } from "@/lib/safety";
import { judgementHits } from "@/lib/safety/judgement";
import type { Sentence } from "@/lib/safety/types";
import { setup, type Ctx } from "./helpers";

let blobDir: string;
beforeAll(() => {
  blobDir = mkdtempSync(path.join(tmpdir(), "ripple-m3-nc-"));
});
afterAll(() => rmSync(blobDir, { recursive: true, force: true }));

const SOURCED = new Set(["span", "patient_text", "template", "slot_template"]);
const interactionWords = (text: string) => judgementHits(text).filter((h) => h.category === "interaction");

/** Dictionary entries that are his own questions, not statements (they may say 一起吃 / "with my other medicines"). */
const HIS_QUESTIONS: MedsKey[] = ["ask.together", "question.otherMeds", "question.unknown"];

async function addAll(ctx: Ctx, locale: "en" | "zh-Hans") {
  const out = [];
  for (const [name, origin] of [
    ["amlodipine", "prescription"],
    ["ibuprofen", "self_bought"],
    ["relative_box", "relative"],
  ] as const) {
    const read = await readLabel({ sessionId: ctx.sessionId, path: await ctx.upload(name) }, ctx.deps);
    out.push(await confirmLabel({ sessionId: ctx.sessionId, readToken: read.read_token, origin, confirmed: requiredConfirmations(read.fields), locale }, ctx.deps));
  }
  return out;
}

describe("no app-originated interaction verdict", () => {
  it("cards, confirmations, 'ask about this' and every safety_event output are sourced sentences only", async () => {
    for (const locale of ["en", "zh-Hans"] as const) {
      const ctx = await setup(blobDir, 29);
      const confirmed = await addAll(ctx, locale);
      const shown: Sentence[] = [];
      for (const c of confirmed) shown.push(...(c.answer?.sentences ?? []));

      const questions =
        locale === "en"
          ? ["Can I take this with my other medicines?", "Can I take ibuprofen with amlodipine?", "Is it safe to take these together?"]
          : ["可以和我其他的药一起吃吗？", "布洛芬和氨氯地平可以一起吃吗？", "这两个药一起吃有没有问题？"];
      for (const medId of ["med-ibuprofen", "med-amlodipine", "med-relative-box"]) {
        for (const text of questions) {
          const res = await ask({ sessionId: ctx.sessionId, text, locale, role: "patient", medIds: [medId] }, { ...ctx.deps.ask, store: ctx.store });
          expect(["refuse_route", "unknown_med", "uncertain"], `${medId}: ${text} -> ${res.route}`).toContain(res.route);
          shown.push(...res.sentences);
        }
      }
      for (const s of shown) {
        expect(SOURCED.has(s.origin ?? ""), `${s.origin}: ${s.en}`).toBe(true);
        if (s.origin !== "span" && s.origin !== "patient_text") expect(interactionWords(`${s.en}\n${s.zh ?? ""}`), s.en).toEqual([]);
      }

      // every safety_event of the session: no model-worded sentence reached the screen
      const events = await ctx.store.listSafetyEvents(ctx.sessionId);
      expect(events.length).toBeGreaterThan(0);
      for (const e of events) {
        const out = e.output as { sentences: { origin: string | null; en: string; zh: string | null }[] };
        for (const s of out.sentences) {
          expect(SOURCED.has(s.origin ?? ""), `${e.input}: ${s.origin} ${s.en}`).toBe(true);
          if (s.origin === "model") expect(interactionWords(`${s.en}\n${s.zh ?? ""}`)).toEqual([]);
        }
      }

      // the cards
      for (const med of await ctx.store.listMeds(ctx.sessionId)) {
        const view = await buildMedCardView(ctx.store, ctx.sessionId, med, { day: 29, locale });
        const lines = [...view.purpose, ...view.howToTake, ...view.leaflet, ...view.unknown];
        expect(lines.every((l) => ["doctor", "dispenser", "pharmacist", "label", "leaflet", "ripple"].includes(l.chip.kind))).toBe(true);
      }
    }
  });

  it("a made-up interaction verdict from the model is blocked and recorded", async () => {
    const ctx = await setup(blobDir, 29);
    const inject = (p: ComposePayload) => {
      const c = p.candidates.find((x) => x.sourceId.startsWith("hh-ibuprofen:")) ?? p.candidates[0];
      return [
        { speechAct: "restate" as const, sourceId: c.sourceId, span: c.span, slots: {}, en: "You can take ibuprofen together with amlodipine." },
        { speechAct: "restate" as const, sourceId: c.sourceId, span: c.span, slots: {}, en: "These two are safe to combine." },
      ];
    };
    const res = await ask(
      { sessionId: ctx.sessionId, text: "What is ibuprofen for?", locale: "en", role: "patient", medIds: ["med-ibuprofen"] },
      { ...ctx.deps.ask, store: ctx.store, llm: createMockLlm({ inject }) },
    );
    const shownText = res.sentences.map((s) => `${s.en}\n${s.zh ?? ""}`).join("\n");
    expect(shownText).not.toContain("together with amlodipine");
    expect(shownText).not.toContain("safe to combine");
    expect(res.blocked.map((b) => b.sentence.en)).toEqual(expect.arrayContaining(["You can take ibuprofen together with amlodipine.", "These two are safe to combine."]));
    const event = (await ctx.store.listSafetyEvents(ctx.sessionId)).at(-1)!;
    expect(JSON.stringify(event.blocked)).toContain("safe to combine");
  });

  it("the M3 UI words carry no interaction word except in his own questions", () => {
    const all = Object.keys(DICT_KEYS) as MedsKey[];
    for (const locale of ["en", "zh-Hans"] as const) {
      for (const key of all) {
        if (HIS_QUESTIONS.includes(key)) continue;
        expect(interactionWords(mt(locale, key)), `${locale} ${key}`).toEqual([]);
      }
    }
  });
});

// every key in lib/meds/i18n.ts (typed: a missing or extra key fails typecheck)
const DICT_KEYS: Record<MedsKey, true> = {
  "meds.add": true,
  "meds.empty": true,
  "meds.open": true,
  "origin.prescription": true,
  "origin.self_bought": true,
  "origin.relative": true,
  "origin.supplement": true,
  "status.awaiting_label": true,
  "status.label_confirmed": true,
  "status.pharmacist_checked": true,
  "status.unverified": true,
  "status.unidentified": true,
  "name.unknown": true,
  "card.purpose": true,
  "card.howToTake": true,
  "card.leaflet": true,
  "card.unknown": true,
  "card.awaiting": true,
  "card.awaitingBody": true,
  "card.photograph": true,
  "card.relabel": true,
  "card.original": true,
  "card.questionFor": true,
  "card.questionAnswered": true,
  "card.questionOpen": true,
  "card.answer": true,
  "card.pickAnswer": true,
  "card.thisIsAnswer": true,
  "card.linking": true,
  "card.whoSaid": true,
  "card.answerUnnamed": true,
  "card.answerNotShown": true,
  "speaker.pharmacist": true,
  "speaker.doctor": true,
  "speaker.dispenser": true,
  "speaker.unsure": true,
  "card.hiddenParts": true,
  "card.hiddenPartsMany": true,
  "card.back": true,
  "chip.ripple": true,
  "chip.records": true,
  "chip.recording": true,
  "chip.standIn": true,
  "chip.draft": true,
  "chip.at": true,
  "ask.title": true,
  "ask.placeholder": true,
  "ask.send": true,
  "ask.sending": true,
  "ask.purpose": true,
  "ask.missed": true,
  "ask.together": true,
  "ask.added": true,
  "ask.error": true,
  "ask.limit": true,
  "add.title": true,
  "add.forMed": true,
  "add.originQ": true,
  "add.photoQ": true,
  "add.takePhoto": true,
  "add.samples": true,
  "add.sample.amlodipine": true,
  "add.sample.ibuprofen": true,
  "add.sample.relative_box": true,
  "add.uploading": true,
  "add.reading": true,
  "add.checkQ": true,
  "add.checkHint": true,
  "add.field.drug_text": true,
  "add.field.strength": true,
  "add.field.directions": true,
  "add.field.dispensed": true,
  "add.field.clinic": true,
  "add.notOnLabel": true,
  "add.right": true,
  "add.isRight": true,
  "add.save": true,
  "add.saving": true,
  "add.retake": true,
  "add.unreadable": true,
  "add.failed": true,
  "add.mismatch": true,
  "add.done": true,
  "add.openCard": true,
  "add.another": true,
  "add.questionAdded": true,
  "question.otherMeds": true,
  "question.unknown": true,
};

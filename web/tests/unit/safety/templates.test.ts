import { describe, expect, it } from "vitest";
import { doNotDisplayNumbers } from "@/lib/kb/load";
import { templateCandidate } from "@/lib/safety/candidates";
import { findForbiddenNumbers } from "@/lib/safety/forbidden";
import { ALL_TEMPLATES, selfHarmTemplateIds, TEMPLATES, UNKNOWN_MED_SENTENCE } from "@/lib/safety/templates";
import type { Sentence } from "@/lib/safety/types";
import { verifySentences } from "@/lib/safety/verify";

const digits = (s: string) => s.replace(/\D/g, "");

describe("fixed texts", () => {
  it("the unknown-medicine sentence is exactly the plan's sentence", () => {
    expect(UNKNOWN_MED_SENTENCE).toBe("I'm not able to identify that medication, please check with your pharmacist.");
    expect(TEMPLATES.unknown_med.en).toBe(UNKNOWN_MED_SENTENCE);
  });

  it("no template, in either language, contains a referrals.json B4-06 number", () => {
    const forbidden = doNotDisplayNumbers();
    for (const t of ALL_TEMPLATES) {
      for (const text of [t.en, t.zh]) {
        for (const n of forbidden) {
          expect(text.includes(n), `${t.id}: ${n}`).toBe(false);
          expect(digits(text).includes(digits(n)), `${t.id}: ${n} without separators`).toBe(false);
        }
        expect(findForbiddenNumbers(text), t.id).toEqual([]);
      }
    }
  });

  it("emergency gives 995 only; self-harm gives 995, 1767, 9151 1767, 1771 and, in Mandarin, Care Corner", () => {
    for (const text of [TEMPLATES.emergency_995.en, TEMPLATES.emergency_995.zh]) {
      expect(text).toContain("995");
      expect(text).not.toContain("1767");
      expect(text).not.toContain("1771");
    }
    const en = selfHarmTemplateIds("en").map((id) => TEMPLATES[id].en).join(" ");
    for (const n of ["995", "1767", "9151 1767", "1771"]) expect(en).toContain(n);
    expect(en).not.toContain("1800-3535-800");
    const zh = selfHarmTemplateIds("zh-Hans").map((id) => TEMPLATES[id].zh).join(" ");
    for (const n of ["995", "1767", "9151 1767", "1771", "1800-3535-800"]) expect(zh).toContain(n);
  });

  it("no judgement words and no dose-change words in any template", () => {
    for (const t of ALL_TEMPLATES) {
      for (const w of ["正常", "很好", "危险", "加药", "减药", "不要紧"]) expect(t.zh.includes(w), `${t.id} ${w}`).toBe(false);
      for (const w of ["normal", "dangerous", "too high"]) expect(t.en.toLowerCase().includes(w), `${t.id} ${w}`).toBe(false);
    }
  });

  it("every template passes the three checks against its own source (referral rows for the crisis numbers)", async () => {
    const sentences: Sentence[] = [];
    const candidates = new Map();
    for (const t of ALL_TEMPLATES) {
      const c = templateCandidate(t);
      candidates.set(c.sourceId, c);
      sentences.push({ speechAct: t.speechAct, sourceId: c.sourceId, span: c.span, slots: {}, en: t.en, zh: t.zh, origin: "template", templateId: t.id });
    }
    const { verdicts } = await verifySentences(sentences, { candidates, checker: null, checkerReason: null });
    for (const v of verdicts) {
      expect(v.pass, `${v.sentence.templateId}: ${[...v.layer1.reasons, ...(v.layer2?.reasons ?? [])].join(",")}`).toBe(true);
    }
  });
});

/**
 * Tap to dial on the answer card (docs/plan/e2e-chains.md 7.1, 8.1; components/daily/dial.ts, AnswerView): the numbers
 * in the fixed crisis templates are links (tel: for 995, 1767, 1771, 1800-3535-800; WhatsApp for SOS CareText
 * 9151 1767), the words on screen stay the template's character for character, and nothing else becomes a link (not
 * the doctor's own "call 995" in R2, not a model or leaflet line, never a B4-06 number). AnswerView is rendered on the
 * server (no DOM), as tests/unit/ui/components.test.ts does; the crisis answers come from POST /api/ask itself.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { POST as askRoute } from "@/app/api/ask/route";
import { AnswerView } from "@/components/daily/AnswerView";
import { DIAL_NUMBERS, dialLabel, dialParts, dialRuns } from "@/components/daily/dial";
import { ALL_TEMPLATES, TEMPLATES, type TemplateId } from "@/lib/safety/templates";
import type { AskResult, Sentence } from "@/lib/safety/types";
import { postReq, sessionAt } from "./helpers";

type Lang = "zh-Hans" | "en";

const R2 = "If your reading at home is above 180 on top, or you get chest pain, weakness on one side, or your speech becomes slurred, go to A&E or call 995.";
/** kb/referrals.json B4-06, never shown (tests/unit/safety/never-cross-probes.test.ts reads them from the file) */
const NEVER = ["6389 2222", "1800-221-4444"];
const HREF: Record<string, string> = {
  "995": "tel:995",
  "1767": "tel:1767",
  "9151 1767": "https://wa.me/6591511767",
  "1771": "tel:1771",
  "1800-3535-800": "tel:18003535800",
};
/** the numbers each crisis template carries, in order (both languages write them the same way) */
const LINKED: Partial<Record<TemplateId, string[]>> = {
  emergency_995: ["995"],
  emergency_overdose: ["995"],
  emergency_overdose_other: ["995"],
  self_harm_995: ["995"],
  self_harm_995_other: ["995"],
  self_harm_sos: ["1767", "9151 1767"],
  self_harm_mindline: ["1771"],
  self_harm_care_corner: ["1800-3535-800"],
  safety_line: ["995"],
  extra_dose_taken: ["995"],
  // 10-14 (the owner's decision): 995 for when it gets bad, after a sign kept for his doctor
  signal_995_chest: ["995"],
  signal_995_stroke: ["995"],
  signal_995_unwell: ["995"],
};

const digitsOf = (s: string) => s.replace(/\D/g, "");
const decode = (s: string) =>
  s.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">");
const textOf = (id: TemplateId, lang: Lang) => (lang === "zh-Hans" ? TEMPLATES[id].zh : TEMPLATES[id].en);
const linkedIn = (text: string) => dialParts(text).filter((p) => p.dial).map((p) => [p.text, p.dial!.href]);

interface LinkSeen {
  attrs: Record<string, string>;
  text: string;
}

/** Each answer line's text paragraph (inner HTML), in order. */
function answerTexts(html: string): string[] {
  return [...html.matchAll(/<p[^>]*data-testid="answer-text"[^>]*>([\s\S]*?)<\/p>/g)].map((m) => m[1]);
}

function linksIn(html: string): LinkSeen[] {
  return [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map((m) => ({
    attrs: Object.fromEntries([...m[1].matchAll(/([\w-]+)="([^"]*)"/g)].map((a) => [a[1], decode(a[2])])),
    text: decode(m[2]),
  }));
}

const render = (result: AskResult, locale: Lang) => renderToStaticMarkup(createElement(AnswerView, { result, asked: null, locale }));

function resultOf(route: AskResult["route"], sentences: Sentence[], locale: Lang): AskResult {
  return { route, sentences, events: [], locale, blocked: [], routeReason: "rule:test", latencyMs: 0, llm: { provider: "mock", model: "mock", tokens: 0, calls: 0 } };
}

async function ask(text: string, locale: Lang): Promise<AskResult> {
  const s = await sessionAt(29, "20:15");
  const res = await askRoute(postReq("/api/ask", s.id, { text, locale, role: "patient" }));
  expect(res.status, text).toBe(200);
  return (await res.json()) as AskResult;
}

describe("dialParts (components/daily/dial.ts)", () => {
  it("cuts every template, in both languages, into parts that join back to the template character for character", () => {
    for (const t of ALL_TEMPLATES) {
      for (const text of [t.en, t.zh]) expect(dialParts(text).map((p) => p.text).join(""), t.id).toBe(text);
    }
  });

  it("links exactly the crisis numbers, each to its own target: tel: for the calls, WhatsApp for CareText", () => {
    for (const t of ALL_TEMPLATES) {
      const want = (LINKED[t.id as TemplateId] ?? []).map((n) => [n, HREF[n]]);
      for (const lang of ["en", "zh-Hans"] as const) expect(linkedIn(textOf(t.id as TemplateId, lang)), `${t.id} ${lang}`).toEqual(want);
    }
    // the CareText number is one WhatsApp link, never "9151 " plus a call to 1767
    expect(linkedIn(TEMPLATES.self_harm_sos.en)).toEqual([
      ["1767", "tel:1767"],
      ["9151 1767", "https://wa.me/6591511767"],
    ]);
  });

  it("leaves no phone number in a template unlinked (a template edit that adds one fails here)", () => {
    for (const t of ALL_TEMPLATES) {
      for (const text of [t.en, t.zh]) {
        const groups = (text.match(/\d(?:[\d -]*\d)?/g) ?? []).filter((g) => digitsOf(g).length >= 3);
        const linked = dialParts(text).filter((p) => p.dial).map((p) => p.text);
        expect(linked, `${t.id}: ${text}`).toEqual(groups);
      }
    }
  });

  it("never links a number inside a longer one, nor the B4-06 numbers", () => {
    expect(linkedIn("19951 9950 1995 21767 17670 1771-2 2-1771 9151 17670 1800-3535-8000")).toEqual([]);
    expect(linkedIn(`call ${NEVER.join(" or ")} or ${NEVER.map(digitsOf).join(" or ")}`)).toEqual([]);
    for (const d of DIAL_NUMBERS) for (const n of NEVER) expect(digitsOf(d.href)).not.toContain(digitsOf(n));
    // at the very start and end of a line, and next to Chinese punctuation
    expect(linkedIn("995")).toEqual([["995", "tel:995"]]);
    expect(linkedIn("打 1771，或 995。")).toEqual([
      ["1771", "tel:1771"],
      ["995", "tel:995"],
    ]);
  });

  it("dialRuns keeps the closing marks right after a number with it, and joins back to the template", () => {
    const glued = (text: string) => dialRuns(text).filter((r) => r.dial).map((r) => [r.text, r.after ?? ""]);
    for (const t of ALL_TEMPLATES) {
      for (const text of [t.en, t.zh]) {
        const runs = dialRuns(text);
        expect(runs.map((r) => r.text + (r.after ?? "")).join(""), t.id).toBe(text);
        for (const r of runs) if (r.after) expect(r.after, `${t.id}: ${r.after}`).toMatch(/^[，。、；：！？）」』】〉》”’,.;:!?)\]]+$/);
        for (const r of runs) if (!r.dial) expect(r.after, t.id).toBeUndefined();
      }
    }
    expect(glued(TEMPLATES.self_harm_mindline.zh)).toEqual([["1771", "，"]]);
    expect(glued(TEMPLATES.self_harm_care_corner.zh)).toEqual([["1800-3535-800", "，"]]);
    expect(glued(TEMPLATES.self_harm_995.zh)).toEqual([["995", "，"]]);
    // an opening bracket may start a line, and a space is a break anyway: nothing glued
    expect(glued(TEMPLATES.self_harm_sos.zh)).toEqual([
      ["1767", ""],
      ["9151 1767", ""],
    ]);
    expect(glued(TEMPLATES.emergency_995.zh)).toEqual([["995", ""]]);
    expect(glued(TEMPLATES.self_harm_sos.en)).toEqual([
      ["1767", ""],
      ["9151 1767", "."],
    ]);
    expect(glued(TEMPLATES.self_harm_mindline.en)).toEqual([["1771", ","]]);
  });

  it("labels CareText as WhatsApp text, keeping the number in the name; a call link has no extra label", () => {
    const careText = DIAL_NUMBERS.find((d) => d.kind === "whatsapp")!;
    expect(careText.text).toBe("9151 1767");
    expect(dialLabel(careText, "en")).toBe("WhatsApp text 9151 1767");
    expect(dialLabel(careText, "zh-Hans")).toBe("WhatsApp 发文字 9151 1767");
    for (const d of DIAL_NUMBERS.filter((x) => x.kind === "tel")) expect(dialLabel(d, "en")).toBeUndefined();
  });
});

describe("AnswerView: the crisis answers from POST /api/ask", () => {
  it("emergency (华语 and English): the 995 template is one tel:995 link, its words unchanged; R2 (Dr Lim's own 'call 995') stays plain text", async () => {
    for (const [lang, text] of [
      ["zh-Hans", "我胸口好痛，左手没力"],
      ["en", "My chest hurts and my left arm is weak"],
    ] as const) {
      const result = await ask(text, lang);
      expect(result.route, text).toBe("emergency");
      // the 995 template (backed by a B1 row: B1-01 chest pain, B1-03 stroke), then R2 in the doctor's words
      expect(result.sentences.map((s) => s.sourceId)).toEqual([expect.stringMatching(/^referral:B1-\d\d$/), "visit:v1:R2"]);
      expect(result.sentences[0]).toMatchObject({ origin: "template", templateId: "emergency_995" });
      const html = render(result, lang);
      const [first, second] = answerTexts(html);
      expect(decode(first)).toBe(textOf("emergency_995", lang));
      expect(decode(second)).toBe(R2);
      expect(second).not.toContain("<a");
      const links = linksIn(html);
      expect(links.map((l) => [l.text, l.attrs.href])).toEqual([["995", "tel:995"]]);
      expect(links[0].attrs["data-dial"]).toBe("tel");
      // a box at least 48 px tall (the e2e measures it and taps its edges)
      expect(links[0].attrs.class).toContain("inline-flex");
      expect(links[0].attrs.class).toContain("min-h-[48px]");
    }
  });

  it("self-harm (华语): 995, 1767, 1771 and 1800-3535-800 are tel: links and CareText a WhatsApp link, each once; every line's words unchanged", async () => {
    const result = await ask("我不想活了", "zh-Hans");
    expect(result.route).toBe("self_harm");
    const ids: TemplateId[] = ["self_harm_995", "self_harm_sos", "self_harm_mindline", "self_harm_care_corner"];
    expect(result.sentences.map((s) => s.templateId)).toEqual(ids);
    const html = render(result, "zh-Hans");
    expect(answerTexts(html).map(decode)).toEqual(ids.map((id) => TEMPLATES[id].zh));
    const links = linksIn(html);
    expect(links.map((l) => [l.text, l.attrs.href])).toEqual([
      ["995", "tel:995"],
      ["1767", "tel:1767"],
      ["9151 1767", "https://wa.me/6591511767"],
      ["1771", "tel:1771"],
      ["1800-3535-800", "tel:18003535800"],
    ]);
    const wa = links[2];
    expect(wa.attrs["data-dial"]).toBe("whatsapp");
    expect(wa.attrs["aria-label"]).toBe("WhatsApp 发文字 9151 1767");
    expect(wa.attrs.target).toBe("_blank");
    expect(wa.attrs.rel).toBe("noopener noreferrer");
    for (const l of links.filter((x) => x.attrs["data-dial"] === "tel")) {
      expect(l.attrs["aria-label"], l.text).toBeUndefined();
      expect(l.attrs.target, l.text).toBeUndefined();
    }
    for (const l of links) expect(l.attrs.class, l.text).toContain("min-h-[48px]");
    // 「1771，」: the comma after a number is rendered in one no-wrap group with its link, so it never starts a line
    expect(html).toMatch(/<span class="whitespace-nowrap"><a [^>]*href="tel:1771"[^>]*>1771<\/a>，<\/span>/);
    expect(html).toMatch(/<span class="whitespace-nowrap"><a [^>]*href="tel:18003535800"[^>]*>1800-3535-800<\/a>，<\/span>/);
  });

  it("self-harm (English): the same links without the Mandarin line; the visible text is the English templates", async () => {
    const result = await ask("I don't want to live anymore", "en");
    expect(result.route).toBe("self_harm");
    const html = render(result, "en");
    expect(answerTexts(html).map(decode)).toEqual([TEMPLATES.self_harm_995.en, TEMPLATES.self_harm_sos.en, TEMPLATES.self_harm_mindline.en]);
    expect(linksIn(html).map((l) => l.attrs.href)).toEqual(["tel:995", "tel:1767", "https://wa.me/6591511767", "tel:1771"]);
    expect(linksIn(html)[2].attrs["aria-label"]).toBe("WhatsApp text 9151 1767");
  });
});

describe("AnswerView: only fixed template lines get links", () => {
  it("a doctor's, a leaflet's or a model's line that names 995 or a helpline stays plain text", () => {
    const plain = (sourceId: string, en: string, origin: Sentence["origin"]): Sentence => ({ speechAct: "restate", sourceId, span: en, slots: {}, en, origin });
    const sentences = [
      plain("visit:v1:R2", R2, "span"),
      plain("hh-amlodipine:amlodipine.x", "Call 995 or SOS 1767 if you feel unwell.", "span"),
      plain("tpl:noted", "Call 995 now for an ambulance, even if you are not sure.", "model"),
      plain("label:med-amlodipine", "Take ONE tablet every MORNING. Helpline 1771.", "slot_template"),
    ];
    const html = render(resultOf("explain", sentences, "en"), "en");
    expect(linksIn(html)).toEqual([]);
    expect(answerTexts(html).map(decode)).toEqual(sentences.map((s) => s.en));
  });

  it("the safety line under a note is a template too: its 995 is a link", () => {
    const t = TEMPLATES.safety_line;
    const line: Sentence = { speechAct: t.speechAct, sourceId: `referral:${t.referralId}`, span: t.en, slots: {}, en: t.en, zh: t.zh, origin: "template", templateId: t.id };
    const html = render(resultOf("log_only", [line], "zh-Hans"), "zh-Hans");
    expect(decode(answerTexts(html)[0])).toBe(t.zh);
    expect(linksIn(html).map((l) => [l.text, l.attrs.href])).toEqual([["995", "tel:995"]]);
  });
});

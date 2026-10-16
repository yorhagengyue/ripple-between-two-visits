/**
 * One answer of /api/ask as the parts the elder screen draws (C2 track S; components/daily/AnswerCard.tsx draws them
 * with components/ui). Pure and client-safe: it only sorts the sentences lib/safety returned into kinds and carries their
 * own words and sources across. It never writes a sentence:
 *
 *   emergency  the fixed 995 templates (the red block, one call button)
 *   hotlines   the self-harm templates, the fixed safety line and the sentences whose 995 is for when it gets bad (one
 *              tablet too many; a sign kept for his doctor, 10-14), each with its numbers as call buttons
 *   ripple     any other fixed template (Ripple's own sentence; the unknown medicine's English line and its Chinese line;
 *              the sentence that says a sign was kept for his doctor, with its date and time)
 *   quote      a doctor's, pharmacist's or counter's own words: who, 医生说 or 推断, the date and time point, the clip, and
 *              a checked translation under the original when there is one
 *   label      the label as printed, and the Chinese line built from its own slots (zh UI)
 *   leaflet    the leaflet's reviewed restatement and where it is from
 *   record     a count from his own records
 * Numbers on the template lines become call buttons only for the five numbers components/daily/dial.ts knows.
 *
 * answerLine (the ask screen) also places Ripple's own explanation of the quotes (10-14; lib/safety/gloss.ts, stored with
 * the answer as AskResult.gloss) where the answer says it stands, as one more part:
 *   gloss      Ripple's sentences as the guards let them through, each with chips naming the quotes it rests on (医生
 *              9月10日 / 药品标签 / 单张), and the quiet line under them. It carries the model's words only as they were
 *              stored; a sentence whose quote is not in the answer is not drawn
 */
import { UNKNOWN_MED_SENTENCE } from "@/lib/safety/templates";
import type { Gloss, Sentence } from "@/lib/safety/types";
import type { UiLocale } from "@/lib/ui/tokens";
import { clipTime } from "@/lib/ui/props";
import { askCopy, shortDate } from "./ask-copy";
import { dialParts } from "./dial";

export interface CallButton {
  number: string;
  href: string;
  urgent?: boolean;
  whatsapp?: boolean;
}

export type AnswerPart =
  | { kind: "emergency"; source: string; text: string }
  | { kind: "hotlines"; source: string; lines: { source: string; text: string; calls: CallButton[] }[] }
  | { kind: "ripple"; source: string; text: string; lang: UiLocale; second?: string }
  | {
      kind: "quote";
      source: string;
      speaker: "doctor" | "pharmacist" | "dispenser";
      inferred: boolean;
      text: string;
      lang: UiLocale;
      /** "9月6日 · 0:43" */
      when?: string;
      /** the record id of the words (an utterance id), for <Said> */
      ref: string;
      clipUrl?: string;
      standIn: boolean;
      translation?: string;
    }
  | { kind: "label"; source: string; restated?: string; printed: string }
  | { kind: "leaflet"; source: string; text: string; lang: UiLocale; from?: string }
  | { kind: "record"; source: string; text: string; lang: UiLocale };

const EMERGENCY_TEMPLATES = new Set(["emergency_995", "emergency_overdose", "emergency_overdose_other"]);
// (10-14, the owner's decisions: a fixed sentence whose 995 is for when it gets bad is Ripple's line with the 打 995 button,
// never the red card: one tablet too many, and a sign kept for his doctor: lib/safety/templates.ts SIGNAL_995)
const HOTLINE_TEMPLATES = new Set([
  "self_harm_995",
  "self_harm_995_other",
  "self_harm_sos",
  "self_harm_mindline",
  "self_harm_care_corner",
  "safety_line",
  "extra_dose_taken",
  "signal_995_chest",
  "signal_995_stroke",
  "signal_995_unwell",
]);

const hasHan = (s: string) => /\p{Script=Han}/u.test(s);

/**
 * The tag above a label or leaflet part already says 「药品标签」 / 「单张写着」 (components/ui SourceTag): the same words
 * leading the line itself are left out once, so the screen does not say them twice. Nothing else of the line changes.
 * The label's lead-in was 「药袋上写着：」 until the owner's decision of 2026-10-14 (lib/safety/zh.ts PREFIX): an answer
 * kept before then still carries it, so both are taken off.
 */
const LEAD_INS = [/^(?:药品标签|药袋上写着)[：:]\s*/u, /^单张写着[：:]\s*/u, /^The label says:?\s+/u, /^The leaflet says:?\s+/u];
function withoutLeadIn(text: string): string {
  for (const re of LEAD_INS) if (re.test(text)) return text.replace(re, "");
  return text;
}
const langOf = (s: string): UiLocale => (hasHan(s) ? "zh-Hans" : "en");
const shown = (s: Sentence, locale: UiLocale) => (locale === "zh-Hans" && s.zh ? s.zh : s.en);

/** The call buttons of a fixed line: its numbers that dial.ts knows, in order (995 urgent, CareText by WhatsApp). */
export function callsOf(text: string): CallButton[] {
  const out: CallButton[] = [];
  for (const p of dialParts(text)) {
    if (!p.dial || out.some((c) => c.number === p.dial!.text)) continue;
    out.push({ number: p.dial.text, href: p.dial.href, ...(p.dial.text === "995" ? { urgent: true } : {}), ...(p.dial.kind === "whatsapp" ? { whatsapp: true } : {}) });
  }
  return out;
}

export function answerParts(sentences: readonly Sentence[], locale: UiLocale): AnswerPart[] {
  const parts: AnswerPart[] = [];
  for (const s of sentences) {
    const text = shown(s, locale);
    if (s.origin === "template" || s.templateId) {
      const id = s.templateId ?? "";
      if (EMERGENCY_TEMPLATES.has(id)) {
        parts.push({ kind: "emergency", source: s.sourceId, text });
      } else if (HOTLINE_TEMPLATES.has(id)) {
        const line = { source: s.sourceId, text, calls: callsOf(text) };
        const last = parts[parts.length - 1];
        if (last?.kind === "hotlines") last.lines.push(line);
        else parts.push({ kind: "hotlines", source: s.sourceId, lines: [line] });
      } else if (id === "unknown_med") {
        // the fixed English sentence as it is, and in the Chinese UI one Chinese line under it
        const zh = locale === "zh-Hans" ? (s.zh ?? "").split("\n").filter((l) => l && l !== UNKNOWN_MED_SENTENCE).pop() : undefined;
        parts.push({ kind: "ripple", source: s.sourceId, text: UNKNOWN_MED_SENTENCE, lang: "en", ...(zh ? { second: zh } : {}) });
      } else {
        parts.push({ kind: "ripple", source: s.sourceId, text, lang: langOf(text) });
      }
      continue;
    }
    if (s.sourceId.startsWith("visit:")) {
      const cite = s.cite ?? {};
      const speaker = s.attribution === "pharmacist" || s.attribution === "dispenser" ? s.attribution : "doctor";
      const when = [cite.date ? shortDate(cite.date, locale) : null, typeof cite.tStartMs === "number" ? clipTime(cite.tStartMs) : null].filter(Boolean).join(" · ");
      const lang = langOf(s.en);
      parts.push({
        kind: "quote",
        source: s.sourceId,
        speaker,
        inferred: !s.attribution || cite.roleState !== "confirmed",
        text: s.en,
        lang,
        ...(when ? { when } : {}),
        ref: cite.utteranceId ?? s.sourceId,
        ...(cite.clipUrl ? { clipUrl: cite.clipUrl } : {}),
        standIn: !!cite.standInVoice,
        ...(locale === "zh-Hans" && lang === "en" && s.translation?.text ? { translation: s.translation.text } : {}),
      });
      continue;
    }
    if (s.sourceId.startsWith("label:")) {
      parts.push({ kind: "label", source: s.sourceId, printed: s.en, ...(locale === "zh-Hans" && s.zh && s.zh !== s.en ? { restated: withoutLeadIn(s.zh) } : {}) });
      continue;
    }
    if (s.sourceId.startsWith("log:")) {
      parts.push({ kind: "record", source: s.sourceId, text, lang: langOf(text) });
      continue;
    }
    if (s.attribution === "leaflet" || s.origin === "patient_text") {
      parts.push({ kind: "leaflet", source: s.sourceId, text: withoutLeadIn(text), lang: langOf(text), ...(s.cite?.title ? { from: s.cite.title } : {}) });
      continue;
    }
    parts.push({ kind: "ripple", source: s.sourceId, text, lang: langOf(text) });
  }
  return parts;
}

/** A chip after a sentence of Ripple's explanation: the quote it rests on (its source id) and the words that name it. */
export interface GlossChip {
  source: string;
  words: string;
}

/**
 * Ripple's own explanation of the quotes above it (lib/safety/gloss.ts), or (owner 10-15, source "general") Ripple's own
 * answer to his question (lib/safety/general.ts: no chips, the line under it says it is general information from Ripple),
 * as one entry of Ripple's.
 */
export interface GlossPart {
  kind: "gloss";
  source: "gloss" | "general";
  lang: UiLocale;
  lines: { text: string; chips: GlossChip[] }[];
  /** the quiet line under it (gloss-note.ts) */
  note: string;
  /** general only: whom Ripple suggests he ask (the screen offers to put his question on that list) */
  offer?: "doctor" | "pharmacist";
}

/** The chip's words for one quote: who said it and when (「医生 9月10日」), or where it is written (「药品标签」, 「单张」). */
export function glossChip(s: Sentence, locale: UiLocale): string {
  const from = askCopy(locale).glossFrom;
  if (s.sourceId.startsWith("visit:")) {
    // who, as the quote's own entry says it: a guess until he confirmed the speaker
    const who = s.attribution === "pharmacist" ? from.pharmacist : s.attribution === "dispenser" ? from.dispenser : s.attribution && s.cite?.roleState === "confirmed" ? from.doctor : from.inferredDoctor;
    return s.cite?.date ? `${who} ${shortDate(s.cite.date, locale)}` : who;
  }
  return s.sourceId.startsWith("label:") ? from.label : from.leaflet;
}

/** The explanation as a part: each sentence with the chips of its quotes in this answer (a sentence with none is left out). */
export function glossPart(gloss: Gloss, sentences: readonly Sentence[], locale: UiLocale): GlossPart | null {
  if (gloss.kind === "general") {
    // Ripple's own answer names no quote: its words as they were kept, and the line that says whose they are
    const general = gloss.sentences.filter((g) => g.text.trim()).map((g) => ({ text: g.text, chips: [] as GlossChip[] }));
    if (general.length === 0) return null;
    return {
      kind: "gloss",
      source: "general",
      lang: langOf(general.map((l) => l.text).join("")),
      lines: general,
      note: askCopy(locale).generalNote,
      ...(gloss.offer ? { offer: gloss.offer } : {}),
    };
  }
  const lines = gloss.sentences
    .map((g) => ({
      text: g.text,
      chips: g.sourceIds.flatMap((id) => {
        const quote = sentences.find((s) => s.sourceId === id && s.origin !== "template");
        return quote ? [{ source: id, words: glossChip(quote, locale) }] : [];
      }),
    }))
    .filter((l) => l.text.trim() && l.chips.length > 0);
  if (lines.length === 0) return null;
  return { kind: "gloss", source: "gloss", lang: langOf(lines.map((l) => l.text).join("")), lines, note: askCopy(locale).glossNote };
}

/**
 * The parts of an answer in order, with Ripple's explanation where the answer says it stands (before the sentence at
 * `gloss.at`: after the last quote, before Ripple's fixed referral line). Without an explanation: answerParts as it is.
 */
export function answerLine(sentences: readonly Sentence[], locale: UiLocale, gloss?: Gloss): (AnswerPart | GlossPart)[] {
  const part = gloss ? glossPart(gloss, sentences, locale) : null;
  if (!gloss || !part) return answerParts(sentences, locale);
  const at = Math.max(0, Math.min(gloss.at, sentences.length));
  return [...answerParts(sentences.slice(0, at), locale), part, ...answerParts(sentences.slice(at), locale)];
}

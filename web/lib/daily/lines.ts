/**
 * Source chips for quoted lines on the daily screens (出处小标签). The source decides the chip, never the words:
 * 医生说 / 柜台说 / 药剂师说 only when the speaker is confirmed; 推断：医生 when lib/safety marks the line as
 * inferred from a replayed visit he has not confirmed (the visit screen's own wording, lib/visit/strings.ts);
 * 录音 when nobody knows who said it. Client-safe (types only from lib/safety).
 */
import { t, type Locale } from "@/lib/i18n";
import type { Candidate, Sentence } from "@/lib/safety/types";
import { vt, type VisitKey } from "@/lib/visit/strings";
import { clipTime, dt, longDay } from "./i18n";
import type { LineChip } from "./types";

type Clinician = "doctor" | "dispenser" | "pharmacist";
const isClinician = (x: unknown): x is Clinician => x === "doctor" || x === "dispenser" || x === "pharmacist";

export function chipFromCandidate(c: Pick<Candidate, "attribution" | "kind" | "cite">): LineChip {
  const cite = c.cite ?? {};
  if (isClinician(c.attribution)) {
    return { kind: c.attribution, inferred: cite.roleState === "inferred", date: cite.date ?? null, tStartMs: cite.tStartMs ?? null, standInVoice: !!cite.standInVoice };
  }
  if (c.attribution === "label") return { kind: "label", date: cite.date ?? null };
  if (c.attribution === "leaflet") return { kind: "leaflet" };
  if (c.kind === "log") return { kind: "records" };
  if (c.kind === "visit") return { kind: "recording", date: cite.date ?? null, tStartMs: cite.tStartMs ?? null, standInVoice: !!cite.standInVoice };
  return { kind: "ripple" };
}

export function chipFromSentence(s: Pick<Sentence, "attribution" | "origin" | "sourceId" | "cite">): LineChip {
  if (s.origin === "template") return { kind: "ripple" };
  const kind = s.sourceId.startsWith("log:") ? "log" : s.sourceId.startsWith("visit:") ? "visit" : s.sourceId.startsWith("label:") ? "label" : "kb";
  return chipFromCandidate({ attribution: s.attribution, kind, cite: s.cite });
}

/** Who said it: 医生说 / 推断：医生 / 药袋 / 单张 / 你的记录 / 录音 / Ripple. */
export function chipText(locale: Locale, chip: LineChip): string {
  if (isClinician(chip.kind)) {
    if (chip.inferred) {
      const name = vt(locale, `role.${chip.kind}` as VisitKey);
      return vt(locale, "chip.inferred", { role: locale === "en" ? name.toLowerCase() : name });
    }
    return t(locale, chip.kind === "doctor" ? "source.doctor" : chip.kind === "dispenser" ? "source.dispenser" : "source.pharmacist");
  }
  switch (chip.kind) {
    case "label":
      return t(locale, "source.label");
    case "leaflet":
      return t(locale, "source.leaflet");
    case "family":
      return t(locale, "source.family");
    case "self":
      return t(locale, "source.self");
    case "records":
      return dt(locale, "chip.records");
    case "recording":
      return dt(locale, "chip.recording");
    default:
      return dt(locale, "chip.ripple");
  }
}

/** When and where: visit date · time point in the recording · stand-in recording (代录音). */
export function chipDetail(locale: Locale, chip: LineChip): string {
  const parts: string[] = [];
  if (chip.date) parts.push(longDay(locale, chip.date));
  if (chip.tStartMs != null) parts.push(dt(locale, "answer.at", { time: clipTime(chip.tStartMs) }));
  if (chip.standInVoice) parts.push(dt(locale, "answer.standIn"));
  return parts.join(" · ");
}

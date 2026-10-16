/**
 * Source chips (出处小标签: 医生说 / 柜台说 / 药剂师说 / 药袋 / 单张 / 本人说 / 女儿说) for card lines and for
 * /api/ask sentences. The chip's kind names who said it; the detail line says when and where. Client-safe.
 */
import { t, type Locale } from "@/lib/i18n";
import type { Sentence } from "@/lib/safety/types";
import { vt, type VisitKey } from "@/lib/visit/strings";
import { formatClipTime, formatDate, mt } from "./i18n";
import type { CardChip } from "./types";

/** 推断：医生 / Inferred: doctor, worded exactly as on the visit screen (components/visit/labels.ts chipText). */
function inferredText(locale: Locale, role: "doctor" | "dispenser" | "pharmacist"): string {
  const name = vt(locale, `role.${role}` as VisitKey);
  return vt(locale, "chip.inferred", { role: locale === "en" ? name.toLowerCase() : name });
}

/** The chip's first part: who said it. */
export function chipKindText(locale: Locale, chip: CardChip): string {
  if (chip.inferred && (chip.kind === "doctor" || chip.kind === "dispenser" || chip.kind === "pharmacist")) return inferredText(locale, chip.kind);
  switch (chip.kind) {
    case "doctor":
      return t(locale, "source.doctor");
    case "dispenser":
      return t(locale, "source.dispenser");
    case "pharmacist":
      return t(locale, "source.pharmacist");
    case "label":
      return t(locale, "source.label");
    case "leaflet":
      return t(locale, "source.leaflet");
    case "self":
      return t(locale, "source.self");
    case "family":
      return t(locale, "source.family");
    case "records":
      return mt(locale, "chip.records");
    case "recording":
      return mt(locale, "chip.recording");
    default:
      return mt(locale, "chip.ripple");
  }
}

/** The chip's detail: visit date and time point, label date, leaflet site, stand-in voice, draft wording. */
export function chipDetailText(locale: Locale, chip: CardChip): string {
  const parts: string[] = [];
  if (chip.kind === "leaflet") {
    if (chip.title) parts.push(chip.title);
    if (chip.reviewStatus && chip.reviewStatus !== "reviewed") parts.push(mt(locale, "chip.draft"));
    return parts.join(" · ");
  }
  if (chip.date) parts.push(formatDate(locale, chip.date));
  if (chip.tStartMs != null) parts.push(mt(locale, "chip.at", { time: formatClipTime(chip.tStartMs) }));
  if (chip.standInVoice) parts.push(mt(locale, "chip.standIn"));
  return parts.join(" · ");
}

/** Chip for a sentence from POST /api/ask (the source decides it, never the model). */
export function chipFromSentence(s: Sentence): CardChip {
  if (s.origin === "template") return { kind: "ripple" };
  const c = s.cite ?? {};
  switch (s.attribution) {
    case "doctor":
    case "dispenser":
    case "pharmacist":
      return {
        kind: s.attribution,
        date: c.date ?? null,
        tStartMs: c.tStartMs ?? null,
        standInVoice: !!c.standInVoice,
        ...(c.roleState === "inferred" ? { inferred: true } : {}),
      };
    case "label":
      return { kind: "label", date: c.date ?? null };
    case "leaflet": {
      let host: string | null = null;
      try {
        host = c.url ? new URL(c.url).hostname.replace(/^www\./, "") : null;
      } catch {
        host = null;
      }
      return { kind: "leaflet", title: host, reviewStatus: c.reviewStatus ?? null };
    }
    default:
      return s.sourceId.startsWith("log:") ? { kind: "records" } : { kind: "ripple" };
  }
}

/** What a sentence shows in this UI language (the zh-Hans UI shows its Mandarin when it has one). */
export function sentenceShown(s: Sentence, locale: Locale): string {
  return locale === "zh-Hans" && s.zh ? s.zh : s.en;
}

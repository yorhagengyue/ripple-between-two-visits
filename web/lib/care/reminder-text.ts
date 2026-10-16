/**
 * Her reminder's words on his card (C2 track D; architecture review 还开着的决定: 「女儿录的提醒文字：数字、药名、剂量要过检查；
 * 带临床内容的只显示『女儿的录音』，不显示文字」). Server-only (it reads the glossary).
 *
 * The words are the transcript of the clip itself (lib/care/transcribe.ts), so the card's text and the sound are the
 * same recording. Before they go on his card they pass the safety layer's own reading of a sentence
 * (lib/safety/slots.ts extractSlots, the closed glossary of medicines, units and numbers; lib/safety/classify.ts
 * unknownDrugName for a medicine name the glossary does not know): any medicine name, any number, any dose unit and the
 * card shows only 「女儿的录音」 with her voice, no words. Times of day and frequencies alone do not count ("早餐", "每天"
 * are how a daughter says good morning). Nothing is rewritten: the words pass whole or not at all.
 */
import { unknownDrugName } from "@/lib/safety/classify";
import { extractSlots } from "@/lib/safety/slots";

export type ClinicalSignal = "drug" | "number" | "unit" | "unknown_drug";

export interface ReminderTextCheck {
  clinical: boolean;
  signals: ClinicalSignal[];
}

export function reminderTextCheck(text: string): ReminderTextCheck {
  const t = text.normalize("NFKC").trim();
  if (!t) return { clinical: false, signals: [] };
  const slots = extractSlots(t);
  const signals: ClinicalSignal[] = [];
  if (slots.drugs.length) signals.push("drug");
  if (slots.numbers.length) signals.push("number");
  if (slots.units.length) signals.push("unit");
  if (unknownDrugName(t)) signals.push("unknown_drug");
  return { clinical: signals.length > 0, signals };
}

/** What his card may say: the words when they pass, else null (only 「女儿的录音」). */
export function cardText(transcript: string | null | undefined): { text: string | null; why: "clinical" | "no_transcript" | null } {
  const t = transcript?.trim() ?? "";
  if (!t) return { text: null, why: "no_transcript" };
  return reminderTextCheck(t).clinical ? { text: null, why: "clinical" } : { text: t, why: null };
}

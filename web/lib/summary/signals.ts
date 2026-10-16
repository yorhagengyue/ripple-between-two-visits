/**
 * The visit brief's 「要告诉医生的情况」 / "For the doctor" (10-14, the owner's decision: 「记下这个信号，下次告诉医生；不是问题，只是
 * 要告诉医生的情况：什么时候、几点出现了不舒服」). Server-only. Read-only: his words as he told Ripple (chest pain, a stroke sign, a
 * reading above the doctor's line: lib/daily/signals.ts), and when. Both briefs (lib/summary/brief.ts, account-brief.ts) and
 * the page for the doctor show them; the words are not repeated under his notes there. His readings above the doctor's line
 * are on the brief already, next to that line, so they are not here again.
 */
import { doctorSignalItems } from "@/lib/daily/signals";
import type { Locale } from "@/lib/i18n";
import type { SessionRow, Store } from "@/lib/store/types";

/** One thing he told Ripple that is for the doctor: his words as he said them, and when. */
export interface BriefSignal {
  id: string;
  /** his date, YYYY-MM-DD */
  date: string;
  /** his clock time, "HH:MM", on an account; null on the demo (its rows carry no story clock time) */
  time: string | null;
  /** his words, verbatim */
  text: string;
  lang: string | null;
}

/** His words kept for the doctor since the last visit that happened (or over the last 30 days before any), oldest first like the rest of the brief. */
export async function briefSignals(store: Store, scope: SessionRow, locale: Locale): Promise<BriefSignal[]> {
  const items = await doctorSignalItems(store, scope, locale, { readings: false });
  return items.reverse().map((s) => ({ id: s.id, date: s.day, time: s.time, text: s.text, lang: s.lang }));
}

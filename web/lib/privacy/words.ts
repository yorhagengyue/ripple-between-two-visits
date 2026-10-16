/**
 * Moments and places as track H's screens say them: 「10月11日 晚上 9:40」 / "11 Oct 9:40 pm", a visit's place in his
 * words. Pure; client-safe (the export button words the links' expiry in the browser).
 */
import { clockWords, shortDate } from "@/lib/profile/dates";
import type { VisitRow } from "@/lib/store/types";
import { DEFAULT_TZ, localDate, localHHMM } from "@/lib/time/clock";
import type { HLocale } from "./copy";

/** An ISO moment in his time zone: 「10月11日 晚上 9:40」 / "11 Oct 9:40 pm". */
export function momentWords(iso: string, locale: HLocale, tz: string = DEFAULT_TZ): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  return `${shortDate(localDate(ms, tz), locale)} ${clockWords(localHHMM(ms, tz), locale)}`;
}

/** A date on its own: 「11月22日」 / "22 Nov". */
export function dateWords(isoDate: string, locale: HLocale): string {
  return shortDate(isoDate, locale);
}

/** Where a visit was, as his list shows it: the clinic's name, or 「药房」 for a pharmacy visit without one. */
export function placeWords(visit: Pick<VisitRow, "kind" | "place">, pharmacyWord: string): string {
  const place = (visit.place ?? "").trim();
  if (place && !/^(clinic|pharmacy|unknown)$/i.test(place)) return place;
  return visit.kind === "pharmacy" ? pharmacyWord : "";
}

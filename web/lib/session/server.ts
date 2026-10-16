/**
 * Helpers for server components (pages and layouts): which language to show, the backstage feed and the template
 * constants the shells need. Server-only. Which scope a page is for is lib/subject (getPageSubject): the demo session
 * from the rp_session cookie, or a signed-in account.
 */
import { cookies } from "next/headers";
import { getBus, type BusEvent } from "@/lib/bus";
import { DEFAULT_PATIENT_LOCALE, DEFAULT_STAFF_LOCALE, LOCALE_COOKIE, toLocale, type Locale } from "@/lib/i18n";
import { templateDefaults } from "@/lib/story/seed";

/** Mr Tan's and Wei Ling's pages: zh-Hans unless the rp_lang cookie says otherwise. */
export async function getPatientLocale(): Promise<Locale> {
  const jar = await cookies();
  return toLocale(jar.get(LOCALE_COOKIE)?.value, DEFAULT_PATIENT_LOCALE);
}

/** Judge, backstage and director screens are English. */
export function getStaffLocale(): Locale {
  return DEFAULT_STAFF_LOCALE;
}

/** Recent events for the backstage feed (oldest first). */
export function recentEvents(sessionId: string, limit = 60): BusEvent[] {
  return getBus().recent(sessionId, { limit });
}

/** Template D0 when there is no session yet. */
export function defaultD0(): string {
  return templateDefaults().d0;
}

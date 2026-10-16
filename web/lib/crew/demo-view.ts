/**
 * The browser looking at the judges' demo (/demo; real-app 5.3, C2 F1's hand-off to track E). Pure helpers, client-safe.
 *
 *   rp_view=demo   set when /demo opens (POST /api/demo/view): a browser that is also signed in to an account then
 *                  shows the demo copy in the split view's phone (lib/subject/resolve.ts reads rp_session first while
 *                  rp_view is demo); "Back to my account" (DELETE /api/demo/view) clears it, and /p/today is his own
 *                  account again. A session cookie: it does not outlive the browser.
 *   rp_lang        the phone's language follows the browser's (Accept-Language) the first time; the phone's own switch
 *                  and the demo page's switch change it afterwards. Not httpOnly: the phone's switch writes it.
 */
import { DEFAULT_PATIENT_LOCALE, type Locale } from "@/lib/i18n";

export const VIEW_COOKIE = "rp_view";
export const DEMO_VIEW = "demo";

/**
 * Where a judge's own phone starts the real app: the front door "/" (real-app 2.1), whose 注册 leads to sign-up (track A),
 * where the data step offers "use Mr Tan's example data" (track C), and whose 登录 serves a judge who already has one.
 */
export const PHONE_APP_PATH = "/";

/** Singapore has no daylight saving: UTC+8 all year. */
const SGT_OFFSET_MS = 8 * 60 * 60 * 1000;

/** "HH:MM:SS" of an ISO instant in Singapore time; the same on the server and in any browser (no Intl, no zone data). */
export function sgtClock(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  return new Date(t + SGT_OFFSET_MS).toISOString().slice(11, 19);
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Mon 12 Oct, 8:15 pm" in Singapore time, deterministic everywhere (no Intl). */
export function sgtDateTime(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const d = new Date(t + SGT_OFFSET_MS);
  const h = d.getUTCHours();
  const m = String(d.getUTCMinutes()).padStart(2, "0");
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}, ${h12}:${m} ${h < 12 ? "am" : "pm"}`;
}

/** The phone's language from an Accept-Language header: the most preferred of Chinese and English, else 华语. */
export function localeFromAcceptLanguage(header: string | null | undefined): Locale {
  if (!header) return DEFAULT_PATIENT_LOCALE;
  const ranked = header
    .split(",")
    .map((part, i) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
      const weight = q ? Number(q.slice(2)) : 1;
      return { tag: tag.trim().toLowerCase(), weight: Number.isFinite(weight) ? weight : 0, i };
    })
    .filter((x) => x.tag && x.weight > 0)
    .sort((a, b) => b.weight - a.weight || a.i - b.i);
  for (const { tag } of ranked) {
    if (tag.startsWith("zh")) return "zh-Hans";
    if (tag.startsWith("en")) return "en";
  }
  return DEFAULT_PATIENT_LOCALE;
}

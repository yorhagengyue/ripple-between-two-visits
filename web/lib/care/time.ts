/**
 * Times on her screens, in HIS time zone (his day is the one she is looking at). Client-safe, pure.
 */

/** "2026-10-10T00:52:00.000Z" in Asia/Singapore -> "8:52" */
export function hmIn(iso: string | null | undefined, tz: string): string {
  if (!iso) return "";
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  const parts = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: tz }).formatToParts(new Date(ms));
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const m = parts.find((p) => p.type === "minute")?.value ?? "00";
  return `${h}:${m}`;
}

/** The date of an instant in his zone, "YYYY-MM-DD". */
export function dateIn(iso: string | null | undefined, tz: string): string {
  if (!iso) return "";
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  const parts = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: tz }).formatToParts(new Date(ms));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** 「昨晚 9:12」 / 「今天 8:52」 / 「9月17日 8:52」 relative to `today` (his date). */
export function whenWords(iso: string, today: string, tz: string, locale: "zh-Hans" | "en"): string {
  const d = dateIn(iso, tz);
  const t = hmIn(iso, tz);
  const h = Number(t.split(":")[0]);
  const prev = new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  if (locale === "en") {
    if (d === today) return `today ${t}`;
    if (d === prev) return `${h >= 18 ? "last night" : "yesterday"} ${t}`;
    const [, mo, da] = d.split("-").map(Number);
    return `${da} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][mo - 1]} ${t}`;
  }
  if (d === today) return `今天 ${t}`;
  if (d === prev) return `${h >= 18 ? "昨晚" : "昨天"} ${t}`;
  const [, mo, da] = d.split("-").map(Number);
  return `${mo}月${da}日 ${t}`;
}

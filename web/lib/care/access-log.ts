/**
 * When she looked (C2 track D; real-app 2.21 「她每看一次，留一条访问记录」, 3.10 care_access_log). Server-only.
 *
 *   logLook(store, scopeId, look, nowMs)          her one allowed write on a read: a row in his access log, at most one
 *                                                 per link, route and set of sections every ACCESS_THROTTLE_MS (her page
 *                                                 re-reads on every live hint; he should see "looked at 9:02", not fifty
 *                                                 rows a minute)
 *   careAccessEntries(store, scope, opts)         his view, newest first (track H's 查看记录 reads it too)
 *   accessWords(entry, locale, tz)                「Wei Ling 看了你的服药情况，10月10日 晚上 7:40」
 *
 * The rows hold what she looked at (his switch names, "reminder"), never what was in it.
 */
import { clockWords, shortDay } from "@/lib/daily/i18n";
import type { Locale } from "@/lib/i18n";
import type { CareAccessLogRow, SessionRow, Store } from "@/lib/store/types";
import { localDate, localHHMM } from "@/lib/time/clock";
import type { CareAccessEntry } from "./types";

export const ACCESS_THROTTLE_MS = 10 * 60_000;

export interface Look {
  linkId: string;
  userId: string;
  /** her label as he named her, kept with the row */
  label: string | null;
  route: string;
  items: string[];
}

const itemsKey = (items: readonly string[]) => [...new Set(items)].sort().join(",");

/** Her look, unless the same look was logged within ACCESS_THROTTLE_MS. true when a row was written. */
export async function logLook(store: Pick<Store, "listCareAccessLog" | "addCareAccessLog">, scopeId: string, look: Look, nowMs: number): Promise<boolean> {
  return logLookAfter(store, scopeId, look, nowMs, await recentLooks(store, scopeId));
}

/**
 * logLook in two halves, for a caller that reads other things at the same time (her home: lib/care/home.ts herHomeNow).
 * On a hosted database each call is a round trip, and her home is read again every time something of his changes; the
 * recent rows are read alongside her switches, the new row is written alongside her sections.
 */
export function recentLooks(store: Pick<Store, "listCareAccessLog">, scopeId: string): Promise<CareAccessLogRow[]> {
  return store.listCareAccessLog(scopeId, { limit: 40 });
}

export async function logLookAfter(store: Pick<Store, "addCareAccessLog">, scopeId: string, look: Look, nowMs: number, recent: readonly CareAccessLogRow[]): Promise<boolean> {
  const key = itemsKey(look.items);
  const same = recent.some(
    (r) => r.link_id === look.linkId && r.route === look.route && itemsKey(r.items) === key && nowMs - Date.parse(r.created_at) < ACCESS_THROTTLE_MS && nowMs >= Date.parse(r.created_at),
  );
  if (same) return false;
  await store.addCareAccessLog(scopeId, { link_id: look.linkId, family_user_id: look.userId, family_label: look.label, route: look.route, items: [...new Set(look.items)] });
  return true;
}

function entryOf(r: CareAccessLogRow): CareAccessEntry {
  return { id: r.id, at: r.created_at, linkId: r.link_id, who: r.family_label, items: [...r.items], route: r.route };
}

/** His access log, newest first; one link's rows with `linkId`. */
export async function careAccessEntries(store: Pick<Store, "listCareAccessLog">, scope: Pick<SessionRow, "id">, opts: { linkId?: string; limit?: number } = {}): Promise<CareAccessEntry[]> {
  const rows = await store.listCareAccessLog(scope.id, opts.limit && !opts.linkId ? { limit: opts.limit } : {});
  const out = rows
    .filter((r) => !opts.linkId || r.link_id === opts.linkId)
    .map(entryOf)
    .sort((a, b) => b.at.localeCompare(a.at));
  return opts.limit ? out.slice(0, opts.limit) : out;
}

/**
 * zh: bare nouns after 「看了你的」; en: whole phrases. The owner's decision of 2026-10-14: what she looks at under the
 * blood pressure and questions switches is the readings and the questions themselves (it was 「量血压次数」, 「问题个数」).
 */
const ITEM_WORDS: Record<Locale, Record<string, string>> = {
  "zh-Hans": {
    dose_summary: "服药情况",
    bp_summary: "血压读数",
    questions_count: "待问医生的问题",
    no_reply_alert: "未回应提醒的通知",
    visit_transcripts: "就诊记录",
    notes: "笔记",
    reminder: "提醒录音",
    // owner 10-16 (lib/care/told.ts): the conversation she was told about, whatever his switches
    told: "Ripple 对话（可能要留意的那段）",
  },
  en: {
    dose_summary: "your medicine check-ins",
    bp_summary: "your blood pressure readings",
    questions_count: "your questions for the doctor",
    no_reply_alert: "the no-reply alert",
    visit_transcripts: "your visit records",
    notes: "your notes",
    reminder: "the reminder she recorded for you",
    told: "what you told Ripple that may need attention",
  },
};

/** What she looked at, in words: 「你的吃药情况、血压读数」 / "your medicine check-ins, ...". */
export function accessItemWords(items: readonly string[], locale: Locale): string {
  const words = ITEM_WORDS[locale];
  const list = [...new Set(items)].filter((i) => words[i]).map((i) => words[i]);
  if (!list.length) return locale === "zh-Hans" ? "你分享的内容" : "what you share";
  return locale === "zh-Hans" ? `你的${list.join("、")}` : list.join(", ");
}

/** 「Wei Ling 看了你的服药情况，10月10日 晚上 7:40」 / "Wei Ling looked at your medicine check-ins, 10 Oct 7:40 pm". */
export function accessWords(entry: Pick<CareAccessEntry, "at" | "who" | "items">, locale: Locale, tz = "Asia/Singapore"): string {
  const ms = Date.parse(entry.at);
  const when = `${shortDay(locale, localDate(ms, tz))} ${clockWords(locale, localHHMM(ms, tz))}`;
  const who = entry.who?.trim() || (locale === "zh-Hans" ? "家人" : "Your family member");
  const what = accessItemWords(entry.items, locale);
  return locale === "zh-Hans" ? `${who} 看了${what}，${when}` : `${who} looked at ${what}, ${when}`;
}

/**
 * The words of 「记录」 (/p/records; owner's decision of 2026-10-14: the elder's four tabs are 今天 / 就诊 / 记录 / 我, and
 * 记录 holds his medicines, his blood pressure and everything else he keeps). Only the words this screen adds: its
 * title, its three section titles, its buttons and links, the counts on its rows and the notes screen under it. The
 * sentences it shows from elsewhere stay where they are (lib/daily/i18n.ts 「记录一次血压」, 「医生说过的数字」,
 * 「该测量血压了（早间）」; components/bp/copy.ts 「本周 N 次」; lib/meds/account-copy.ts 「早间服用 · 依药品标签」).
 *
 * Professional register (owner 10-14): 测量 / 记录, never 量血压 or 吃了 / 没吃 as a label. Nothing here judges a reading or
 * says anything about a medicine. Client-safe (components/daily/elder/BpAccount.tsx, a client component, names the way
 * back here).
 */
import type { Locale } from "@/lib/i18n";

/** Where 「记录」 is (the bar's place "records", lib/ui/copy.ts TAB_HREFS). */
export const RECORDS_HREF = "/p/records";

const zh = {
  title: "记录",
  /** the three sections, top to bottom */
  meds: "药物",
  bp: "血压",
  other: "其他记录",
  /** the way to adding a medicine (the existing flow at /p/meds/add) */
  medsAdd: "拍药袋新增药物",
  /** the way to /p/meds: the same medicines grouped by where they came from (医生开的 / 自己买的 / 亲戚带的 / 保健品) */
  medsByOrigin: "按来源查看",
  medsEmpty: "暂无药物",
  /** under the latest reading: 「最近一次 · 10月9日 早上 8:00」 */
  bpLatest: "最近一次 · {when}",
  bpToday: "今天",
  bpNone: "暂无读数",
  /** the way to the week's page (/p/bp) */
  bpAll: "看全部",
  bpAllLabel: "看全部血压读数",
  notes: "笔记",
  notesCount: "{n} 条",
  notesEmpty: "暂无笔记",
  noteVoice: "语音",
  noteTyped: "打字",
  chat: "和 Ripple 说过的话",
  chatCount: "{n} 句",
};

export type RecordsKey = keyof typeof zh;

const en: Record<RecordsKey, string> = {
  title: "Records",
  meds: "Medicines",
  bp: "Blood pressure",
  other: "Other records",
  medsAdd: "Photograph a label to add",
  medsByOrigin: "By where they came from",
  medsEmpty: "No medicines yet",
  bpLatest: "Latest · {when}",
  bpToday: "Today",
  bpNone: "No readings yet",
  bpAll: "See all",
  bpAllLabel: "See all blood pressure readings",
  notes: "Notes",
  notesCount: "{n}",
  notesEmpty: "No notes yet",
  noteVoice: "Spoken",
  noteTyped: "Typed",
  chat: "What you said to Ripple",
  chatCount: "{n}",
};

const ALL: Record<Locale, Record<RecordsKey, string>> = { "zh-Hans": zh, en };

/** One of this screen's words, with its values filled in. */
export function rc(locale: Locale, key: RecordsKey, vars?: Record<string, string | number>): string {
  const template = ALL[locale]?.[key] ?? zh[key];
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => (Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : whole));
}

/** Every word of one language with its key (the word scans in tests). */
export function allRecordsStrings(locale: Locale): [RecordsKey, string][] {
  return Object.entries(ALL[locale]) as [RecordsKey, string][];
}

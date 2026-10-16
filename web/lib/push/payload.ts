/**
 * What a phone receives in one push (C2 track I; real-app 2.24 通知一览), and the lock-screen rule. Server-only.
 *
 * The payload is the notification and nothing else: the words for the lock screen, where a tap lands, the tag that
 * lets a later notice replace an earlier one, and the reminder_delivery id (so a tap can mark it opened). Never a scope
 * id, a user id, a medicine name, a dose or a reading. (Her alert's address carries her link's id, as her pages do.)
 *
 * The lock-screen rule (守线: 推送和锁屏不出药名和剂量，只说时段): before anything is encrypted, the title and body are
 * checked against every medicine name the knowledge base knows (names and aliases, Chinese included) plus the names
 * on his own medicine list, and against dose and reading patterns (5 mg, 一粒, 150/95). Track B's sentences never
 * contain them; a family member's label for him might. A notice that fails is sent with the plain fallback words
 * instead (「Ripple 的提醒」 / 「打开 Ripple 看看」), never with the words that failed, and the sender logs that it
 * happened (no content).
 */
import type { Notice, NoticeKind } from "@/lib/jobs/notify";
import { getKb } from "@/lib/kb/load";

export type PushLocale = "zh-Hans" | "en";

/** Kinds a phone can get: the jobs' notices, plus the 「试一下」 and 「提醒已经开好了」 ones. */
export type PushKind = NoticeKind | "test" | "welcome";

export interface PushPayload {
  v: 1;
  kind: PushKind;
  title: string;
  body: string;
  /** a path on this site; the service worker opens nothing else */
  url: string;
  /** the same tag replaces the notification already shown (his second reminder replaces the first) */
  tag: string;
  /** a replacing notification still alerts (sound, vibration) */
  renotify: boolean;
  /** reminder_delivery id: the tap marks it opened (his reminders on his phone, her alert on hers; null for a test) */
  delivery: string | null;
  lang: PushLocale;
  /** real time it was sent (ISO) */
  sent_at: string;
}

export const FALLBACK_WORDS: Record<PushLocale, { title: string; body: string }> = {
  "zh-Hans": { title: "Ripple 的提醒", body: "打开 Ripple 看看" },
  en: { title: "A reminder from Ripple", body: "Open Ripple to see it" },
};

/**
 * The words of the pushes this track sends itself (not a job's): welcome after turning notifications on, and a test.
 * His are about his reminders; hers (a family member, no space of her own) about being told when a reminder goes
 * unanswered.
 */
export const OWN_WORDS: Record<"patient" | "family", Record<PushLocale, Record<"welcome" | "test", { title: string; body: string }>>> = {
  patient: {
    "zh-Hans": {
      welcome: { title: "提醒已经开好了", body: "服药的时间到了，手机会这样提醒你。" },
      test: { title: "这是一条试试的提醒", body: "提醒会这样出现在锁屏上。" },
    },
    en: {
      welcome: { title: "Reminders are on", body: "When it is time for your medicine, your phone will show this." },
      test: { title: "This is a test reminder", body: "Reminders will look like this on your lock screen." },
    },
  },
  family: {
    "zh-Hans": {
      welcome: { title: "通知已经开好了", body: "家人两次提醒均未回应时，手机会收到这样的通知。" },
      test: { title: "这是一条试试的通知", body: "通知会这样出现在锁屏上。" },
    },
    en: {
      welcome: { title: "Notifications are on", body: "If your family member does not answer two reminders, your phone will show this." },
      test: { title: "This is a test notification", body: "Notifications will look like this on your lock screen." },
    },
  },
};

// ---------------------------------------------------------------- the lock-screen rule

const DOSE = /\d+(?:[.,]\d+)?\s*(?:mg|mcg|µg|μg|g|ml|iu|毫克|微克|克|毫升|片|粒|颗|tab(?:let)?s?|pills?|capsules?)(?![a-z])/i;
const READING = /\b\d{2,3}\s*\/\s*\d{2,3}\b/;
const CHINESE_COUNT = /[一二两三四五六七八九十半]\s*(?:粒|片|颗|毫克)/;

let kbNames: string[] | null = null;

/** Every medicine name and alias in the knowledge base, lower case, longest first. */
export function knownMedicineNames(): string[] {
  if (!kbNames) {
    const names = new Set<string>();
    for (const d of getKb().drugs) for (const n of [d.id, d.display_name, ...d.aliases]) if (n && n.trim().length >= 3) names.add(n.trim().toLowerCase());
    kbNames = [...names].sort((a, b) => b.length - a.length);
  }
  return kbNames;
}

const latin = (s: string) => /^[a-z0-9 .'-]+$/.test(s);

/** The medicine names, doses or readings found in `text` (empty: it may go on a lock screen). */
export function lockScreenProblems(text: string, extraNames: readonly string[] = []): string[] {
  const lower = text.toLowerCase();
  const found: string[] = [];
  const names = [...knownMedicineNames(), ...extraNames.map((n) => n.trim().toLowerCase()).filter((n) => n.length >= 3)];
  for (const name of names) {
    if (found.includes(name)) continue;
    if (latin(name)) {
      // a whole word (so "Ripple" never trips on a short alias)
      const re = new RegExp(`(^|[^a-z0-9])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^a-z0-9])`, "i");
      if (re.test(lower)) found.push(name);
    } else if (lower.includes(name)) {
      found.push(name);
    }
  }
  if (DOSE.test(text)) found.push("dose");
  if (CHINESE_COUNT.test(text)) found.push("dose");
  if (READING.test(text)) found.push("reading");
  return found;
}

/** A path on this site, or null (an absolute URL, a protocol-relative one, a backslash trick). */
export function sitePath(url: string): string | null {
  if (typeof url !== "string" || !url.startsWith("/") || url.startsWith("//") || url.includes("\\")) return null;
  try {
    const u = new URL(url, "https://ripple.invalid");
    return u.origin === "https://ripple.invalid" ? `${u.pathname}${u.search}` : null;
  } catch {
    return null;
  }
}

export interface BuiltPayload {
  payload: PushPayload;
  /** the words failed the lock-screen rule and were replaced by the fallback */
  replaced: boolean;
}

/** A payload from words, with the lock-screen rule applied. */
export function buildPayload(
  input: { kind: PushKind; title: string; body: string; url: string; tag: string; delivery?: string | null; locale: PushLocale; renotify?: boolean },
  opts: { medicineNames?: readonly string[]; realNowMs?: number } = {},
): BuiltPayload {
  const problems = [...lockScreenProblems(input.title, opts.medicineNames), ...lockScreenProblems(input.body, opts.medicineNames)];
  const words = problems.length ? FALLBACK_WORDS[input.locale] : { title: input.title, body: input.body };
  const payload: PushPayload = {
    v: 1,
    kind: input.kind,
    title: words.title.slice(0, 120),
    body: words.body.slice(0, 240),
    url: sitePath(input.url) ?? "/p/today",
    tag: (input.tag || "ripple").slice(0, 100),
    renotify: input.renotify ?? false,
    delivery: input.delivery ?? null,
    lang: input.locale,
    sent_at: new Date(opts.realNowMs ?? Date.now()).toISOString(),
  };
  return { payload, replaced: problems.length > 0 };
}

/** The payload for one of the jobs' notices (his second reminder re-alerts while replacing the first). */
export function payloadFromNotice(notice: Notice, opts: { medicineNames?: readonly string[]; realNowMs?: number } = {}): BuiltPayload {
  return buildPayload(
    {
      kind: notice.kind,
      title: notice.title,
      body: notice.body,
      url: notice.url,
      tag: notice.tag,
      // his reminders and her alert alike: the tap marks the row opened (POST /api/push/opened; hers through her link)
      delivery: notice.deliveryId,
      locale: notice.locale,
      renotify: notice.kind === "dose_second",
    },
    opts,
  );
}

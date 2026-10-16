/**
 * What the phone says without a network (C2 track O; real-app 2.25). Fixed sentences only, both languages; none of them
 * names a medicine or says anything about a reading. 「要连上网才能问」 is the design's own words, and so was 「已记下（等连网）」
 * until the owner's decision of 10-14 made it 「已记录（等连网）」.
 */
import type { Locale } from "@/lib/i18n";

export interface OfflineCopy {
  /** over the list of what waits on the phone */
  waiting: string;
  /** on a page that is still open while the network is gone */
  noNetwork: string;
  /** an entry is going out right now */
  sending: string;
  /** over the entries the server did not take */
  refused: string;
  putAway: string;
  /** a reading still on the phone can be taken out again */
  takeOut: string;
  taken: string;
  missed: string;
  later: string;
  notMeasured: string;
  bp: string;
  pulse: (n: number) => string;
  /** why the server refused, by its code */
  why: (code: string | null) => string;
  /** an answer that already reached Ripple cannot be undone without a network */
  undoNeedsNetwork: string;
  /** changing or deleting a reading that is already with Ripple needs a network */
  changeNeedsNetwork: string;
  /** asking is never queued */
  askNeedsNetwork: string;
  /** the phone could not keep it (its storage refused) */
  notKept: string;
}

const ZH: OfflineCopy = {
  waiting: "已记录（等连网）",
  noNetwork: "现在没有网络。在这一页记录的，连上网就发出去。",
  sending: "正在发出去……",
  refused: "没有记上",
  putAway: "知道了",
  takeOut: "删掉这一条",
  // owner 10-14: the answers as Today says them (已服药 / 未服药 / 稍后服用)
  taken: "已服药",
  missed: "未服药",
  later: "稍后服用",
  notMeasured: "本次未测量",
  bp: "血压",
  pulse: (n) => `脉搏 ${n}`,
  why: (code) => {
    if (code === "too_late") return "隔了一天多才连上网，这一条未能记录。";
    if (code === "not_due") return "这个时段现在没有这种药物，这一条未能记录。";
    if (code === "not_found") return "这种药物已经不在药单上，这一条未能记录。";
    return "Ripple 没有收下这一条。";
  },
  undoNeedsNetwork: "没有网络，现在撤销不了。连上以后点「改一下」。",
  changeNeedsNetwork: "没有网络，现在改不了。连上以后再改。",
  askNeedsNetwork: "要连上网才能问。",
  notKept: "手机未能记录这一条，请再试一次。",
};

const EN: OfflineCopy = {
  waiting: "Recorded (waiting for a connection)",
  noNetwork: "No connection right now. What you record on this page is sent once you are back online.",
  sending: "Sending…",
  refused: "Not recorded",
  putAway: "Got it",
  takeOut: "Delete this one",
  taken: "Taken",
  missed: "Not taken",
  later: "Later",
  notMeasured: "Not measured",
  bp: "Blood pressure",
  pulse: (n) => `Pulse ${n}`,
  why: (code) => {
    if (code === "too_late") return "It reached Ripple a day or longer after you recorded it, so it could not be kept.";
    if (code === "not_due") return "That medicine is not taken at that time now, so this was not recorded.";
    if (code === "not_found") return "That medicine is no longer on your list, so this was not recorded.";
    return "Ripple did not accept this one.";
  },
  undoNeedsNetwork: "No connection, so this cannot be undone now. Use “Change” once you are back online.",
  changeNeedsNetwork: "No connection, so this cannot be changed now. Change it once you are back online.",
  askNeedsNetwork: "You need a connection to ask.",
  notKept: "The phone could not keep this one. Try again.",
};

export function offlineCopy(locale: Locale | "en" | "zh-Hans"): OfflineCopy {
  return locale === "en" ? EN : ZH;
}

/** Every string, for the tests that scan fixed copy (no judging word, no medicine name). */
export function allOfflineStrings(): string[] {
  const out: string[] = [];
  for (const c of [ZH, EN]) {
    for (const v of Object.values(c)) if (typeof v === "string") out.push(v);
    out.push(c.pulse(72), c.why("too_late"), c.why("not_due"), c.why("not_found"), c.why(null));
  }
  return out;
}

/**
 * The words the visit screens gained when they were laid out after the timeline draft (web/progress/fe-05.md): the
 * names of new interface pieces only (a header's title, a section's title, a button that did not exist). Everything
 * the screens said before stays in lib/visit/account-copy.ts and lib/ui/copy.ts, word for word; nothing here restates
 * a clinical sentence, a source label that carries a rule, or a sentence docs/plan/real-app.md spells out. Client-safe.
 */
import type { AccountLocale } from "@/lib/visit/account-copy";

const zh = {
  // where a visit is, as the grey line under a header (the stored default is the English word "Clinic" / "Pharmacy")
  "place.clinic": "诊所",
  "place.pharmacy": "药房",
  // the visit list (the draft's 05-9): a recording this phone keeps that was never sent (its visit is not on the
  // server's list any more, or already has its record)
  "held.section": "手机上留着的录音",
  "held.title": "这台手机上还留着一段录音（{min} 分 {sec} 秒）。",
  "held.sub": "它没有传上去：服务器上找不到它对应的那次就诊，或者那次就诊已经有记录了。录音还在这台手机上，可以听；退出登录时会清掉。",
  "held.listen": "听这段录音",
  "held.preparing": "正在准备这段录音……",
  // recording (05-2): the old sentence 「手机放在桌上就好，屏幕不会关。」 in two places
  "live.lastTwo": "最近两句",
  "live.caption": "字幕",
  // Ripple's notes while he records and at the top of the review (owner's decision of 10-14; lib/visit/ripple-summary.ts):
  // always named as Ripple's and as not confirmed
  "live.notes": "实时总结",
  "live.notesNote": "Ripple 根据录到的话整理，未经确认",
  // scene 1 (owner 10-15): the summary large (a tap, or by itself while he records), and who said each caption: Ripple's
  // guess from the voices and the words until he checks the lines in the review. His own lines are 「你」, his daughter's
  // carry her name (the link's), else 「家人」
  "live.notesOpen": "点一下放大看",
  "live.who.doctor": "医生",
  "live.who.pharmacist": "药剂师",
  "live.who.dispenser": "柜台",
  "live.who.patient": "你",
  "live.who.family": "家人",
  "live.whoGuess": "谁说的是 Ripple 根据声音和内容猜的，录完后由你确认。",
  "review.notes": "Ripple 的总结",
  "review.notesNote": "Ripple 根据录音整理，未经确认。医生的原话在下面。",
  // after 「录完了」, while the text is made: the recording is with the server (the first entry of the draft's 05-3)
  "ending.saved": "录音已经存下来了",
  // before leaving (05-10)
  "leaving.title": "离开前要问的",
  "leaving.count": "离开前要问的（{n} 个）",
  "leaving.sub": "录音里听到你问了，这里会打勾。",
  "leaving.back": "看最近两句",
  // one line at a time (05-4, 05-5)
  "review.checked": "你认过",
  "review.next": "下一件，等你认",
  "review.nextOne": "下一件",
  "review.toSummary": "认完了，看一遍",
  "review.undoNo": "已记录：不是",
  "review.kept": "这一条留着，不删。",
  "review.keptWarning": "这一条留着，不删。读数超过医生说的警示线时，这一句照样会出现。",
  // the record after the review (05-6, 06-1, 06-2)
  "summary.done": "认完了",
  // his own lines, behind one row of the record (real-app 2.15 「他点出哪几句是自己说的」)
  "own.count": "我说的话 {n} 句",
  "own.open": "看一下",
  "own.title": "我说的话",
  "own.sub": "这些是录音里听出来是你说的话。哪一句不是你说的，点它下面的「不是我说的」。",
  "own.guess": "好像是你说的",
  "own.done": "看完了",
  "summary.section.doctor": "医生交代的事",
  "summary.section.dispenser": "柜台说的",
  "summary.section.pharmacist": "药剂师说的",
  // Today's entry for a review he has not finished (05-8)
  "today.reviewSaved": "{date}的就诊 · 录音已保存",
  "today.reviewOpen": "{date}的就诊尚未确认完。",
  "today.reviewOpenSub": "认过的留着；没认的还标「好像是医生说的」。",
  "today.reviewGoOn": "接着认",
  "today.reviewEnd": "结束",
  "today.reviewEndFailed": "没结束成，再点一次。",
  // the visit pages could not be opened (the draft's 通用-2)
  "problem.title": "就诊记录这次没打开。",
  "problem.kept": "已经存下的录音和记录都还在。",
  "problem.today": "先看今天",
  // the visit tab's first screen (owner 10-14, ./VisitHub.tsx): an earlier visit opened in place, the next visit, what
  // to tell the doctor (the record's own section names stay summary.section.*)
  "hub.watch": "要注意的",
  "hub.more": "还有 {n} 件，在这次的全部记录里。",
  "hub.none": "这次没有你认过的原话。",
  "hub.all": "看这次的全部记录",
  "hub.nextNone": "下次就诊还没有定",
  "hub.signals": "要告诉医生的情况",
  // what the microphone hears while he records (10-15, ./MicCheck.tsx)
  "mic.level": "麦克风",
  "mic.dead": "听不到声音",
  "mic.deadSub": "麦克风没有声音进来，现在录到的是静音。看看耳机或麦克风开着没有，或者换一个：",
  "mic.deadSubOne": "麦克风没有声音进来，现在录到的是静音。看看耳机或麦克风开着没有、有没有被静音。",
  "mic.switchFailed": "这个麦克风打不开，还在用原来的。",
  // which microphone, and the list to pick another (10-15: 「检索我使用的麦克风」)
  "mic.named": "麦克风：{name}",
  "mic.switch": "换一个",
  "mic.done": "收起",
  "mic.looking": "正在找这台设备上的麦克风……",
  "mic.none": "这台设备上找不到麦克风。",
  "mic.pickHint": "说几句话，看哪一个的格子在跳，点它就换过去：",
  "mic.unnamed": "麦克风 {n}",
  "mic.inUse": "在用",
  "mic.cannotOpen": "打不开",
} as const;

export type VisitWord = keyof typeof zh;

const en: Record<VisitWord, string> = {
  "place.clinic": "Clinic",
  "place.pharmacy": "Pharmacy",
  "held.section": "Recordings kept on this phone",
  "held.title": "This phone still keeps a recording ({min} min {sec} s).",
  "held.sub": "It was not uploaded: the server no longer lists the visit it belongs to, or that visit already has its record. The recording is still on this phone and you can listen to it; it is cleared when you sign out.",
  "held.listen": "Listen to this recording",
  "held.preparing": "Getting this recording ready…",
  "live.lastTwo": "The last two lines",
  "live.caption": "Caption",
  "live.notes": "Live summary",
  "live.notesNote": "Ripple's notes from what was said; not confirmed",
  "live.notesOpen": "Tap to see it large",
  "live.who.doctor": "Doctor",
  "live.who.pharmacist": "Pharmacist",
  "live.who.dispenser": "Counter",
  "live.who.patient": "You",
  "live.who.family": "Family",
  "live.whoGuess": "Who said each line is Ripple's guess from the voices and the words; you check it after the visit.",
  "review.notes": "Ripple's summary",
  "review.notesNote": "Ripple's notes from the recording; not confirmed. The doctor's own words are below.",
  "ending.saved": "The recording is saved",
  "leaving.title": "To ask before you go",
  "leaving.count": "To ask before you go ({n})",
  "leaving.sub": "When the recording hears you ask one, it is ticked here.",
  "leaving.back": "See the last two lines",
  "review.checked": "you checked this",
  "review.next": "Next one, waiting for you",
  "review.nextOne": "Next one",
  "review.toSummary": "All checked: look through them",
  "review.undoNo": "Noted: No",
  "review.kept": "This line stays. Nothing is deleted.",
  "review.keptWarning": "This line stays. Nothing is deleted. When a reading passes the doctor's warning line, this line still shows.",
  "summary.done": "All checked",
  "own.count": "Lines I said: {n}",
  "own.open": "Look",
  "own.title": "Lines I said",
  "own.sub": "These are the lines the recording heard as yours. If one was not yours, tap “Not me” under it.",
  "own.guess": "Maybe you",
  "own.done": "Done",
  "summary.section.doctor": "What the doctor told you",
  "summary.section.dispenser": "What the clinic counter said",
  "summary.section.pharmacist": "What the pharmacist said",
  "today.reviewSaved": "Visit on {date} · the recording is saved",
  "today.reviewOpen": "The visit on {date} is not checked through yet.",
  "today.reviewOpenSub": "What you checked stays; the rest still says “Maybe the doctor”.",
  "today.reviewGoOn": "Go on",
  "today.reviewEnd": "Finish",
  "today.reviewEndFailed": "That did not finish. Tap once more.",
  "problem.title": "The visit records did not open this time.",
  "problem.kept": "The recordings and records already saved are still there.",
  "problem.today": "See today first",
  "hub.watch": "To watch for",
  "hub.more": "{n} more in this visit's whole record.",
  "hub.none": "No lines from this visit that you confirmed.",
  "hub.all": "See this visit's whole record",
  "hub.nextNone": "No next visit yet",
  "hub.signals": "For the doctor",
  "mic.level": "Microphone",
  "mic.dead": "No sound is coming in",
  "mic.deadSub": "The microphone is sending no sound, so this is recording silence. Check that the headset or microphone is on, or switch to another one:",
  "mic.deadSubOne": "The microphone is sending no sound, so this is recording silence. Check that the headset or microphone is on and not muted.",
  "mic.switchFailed": "That microphone could not be opened; still using the one before.",
  "mic.named": "Microphone: {name}",
  "mic.switch": "Switch",
  "mic.done": "Done",
  "mic.looking": "Looking for the microphones on this device…",
  "mic.none": "No microphone was found on this device.",
  "mic.pickHint": "Say a few words and see whose bars move; tap it to switch:",
  "mic.unnamed": "Microphone {n}",
  "mic.inUse": "In use",
  "mic.cannotOpen": "Can't open",
};

const TABLE: Record<AccountLocale, Record<VisitWord, string>> = { "zh-Hans": zh, en };

export function vw(locale: AccountLocale, key: VisitWord, vars: Record<string, string | number> = {}): string {
  let s = TABLE[locale]?.[key] ?? zh[key];
  for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

/**
 * Where a visit was, for the grey line under a header: his clinic's own name when the visit has one; the stored
 * defaults ("Clinic", "Pharmacy": lib/visit/pipeline.ts DEFAULT_PLACE) in the screen's language.
 */
export function placeWords(locale: AccountLocale, visit: { place: string; kind: string }): string {
  return clinicName(visit.place) ?? vw(locale, visit.kind === "pharmacy" || visit.place.trim() === "Pharmacy" ? "place.pharmacy" : "place.clinic");
}

/** A place's own name (his clinic as he told the app), or null when there is none: nothing, or one of the stored defaults. */
export function clinicName(place: string | null | undefined): string | null {
  const name = (place ?? "").trim();
  return !name || name === "Clinic" || name === "Pharmacy" ? null : name;
}

/**
 * An existing sentence pair as two entries of a line: 「录音（12 分 30 秒）已经存好。」 and what follows it. Cut after the
 * first full stop; the words themselves are untouched. A sentence with no second part comes back whole.
 */
export function twoSentences(text: string): [string, string | null] {
  const zhStop = text.indexOf("。");
  const enStop = text.search(/\.\s/);
  const at = zhStop >= 0 ? zhStop + 1 : enStop >= 0 ? enStop + 1 : -1;
  if (at <= 0 || at >= text.trim().length) return [text, null];
  const rest = text.slice(at).trim();
  return rest ? [text.slice(0, at).trim(), rest] : [text, null];
}

/**
 * 「爸爸跟 Ripple 说了一件可能要留意的事」 (owner, 2026-10-16: 「直接把功能做出来，通知相应的对话」). Server-only.
 *
 * When Ripple answers HIM on the emergency route because of his own message, every family member bound to him is told,
 * with the conversation: what he said, when, and what Ripple answered him (the lines as his screen showed them: the 995
 * line, his doctor's warning line, "kept for your doctor"). Nothing new is said to her: no advice of Ripple's own, only
 * what was said and what Ripple showed him.
 *
 * THE BASELINE (the owner: the most basic behaviour). This notice reaches every active care link of his WHATEVER HIS
 * SHARING SWITCHES SAY. Everything else of his that her screens show is cut by his switches for her link (lib/care/home.ts,
 * lib/care/record.ts, lib/care/alerts.ts); this is the one thing that is not: no switch is read here, nor when she reads
 * it (toldNotices), nor when the push goes out (lib/push/sender.ts checks only that her link is still active and hers:
 * lib/care/recipients.ts mayTellFamily). Her link waiting for the family text in force (lib/care/reconsent.ts) does not
 * hold it back either.
 *
 *   familyAlarm(answer)           whether an answer is one she is told about, and which kind:
 *                                   emergency   the 995 answer to his own message (also his own overdose)
 *                                   signal      his chest pain, a stroke sign or a reading above his doctor's number kept
 *                                               for his doctor, with his doctor's warning line and when to call 995
 *                                               (pipeline.ts, the owner's 10-14 decision; templates.ts SIGNAL_RECORDED)
 *                                   self_harm   the helpline answer to his own words about hurting himself (the
 *                                               owner, 10-16: 「也通知女儿」; TELL_FAMILY_ON_SELF_HARM below)
 *                                 never someone else's crisis (classify.ts: the third_person signal; a crisis a family
 *                                 member reports is her own message), never an ask that is not his (role), never any
 *                                 other route
 *   tellFamily(input, deps)       one reminder_delivery per link and ask (kind TOLD_KIND, ref = her link, slot = the ask's
 *                                 safety_event id: never twice), the content-free hint her open pages read themselves
 *                                 again on (bus "family.told", lib/family/events.ts), and the push to her phones in her
 *                                 language. The lock screen never carries his words or Ripple's (lib/push/payload.ts:
 *                                 no medicine name, dose or reading there): only that there is something, and the tap
 *                                 opens the conversation. Never throws.
 *   toldNotices(store, scope, linkId)   what her 「留意」 and her home show: the notices sent to her link, newest first,
 *                                 each with his words, the moment he said them and Ripple's lines as he saw them (from
 *                                 the ask's two chat rows, lib/safety/turns.ts; before they are written, from the ask's
 *                                 safety_event output). Read only.
 *
 * The pipeline calls tellFamily after the ask's safety_event is written, and does not wait for it (lib/safety/pipeline.ts:
 * his answer never waits for her phone).
 */
import { publish as busPublish, type BusEventType } from "@/lib/bus";
import { sendNotice, type Notice } from "@/lib/jobs/notify";
import { glossLines, sentenceText } from "@/lib/safety/render";
import { SIGNAL_RECORDED } from "@/lib/safety/templates";
import { hasHan } from "@/lib/safety/text";
import type { StoredAnswer } from "@/lib/safety/turns";
import type { Attribution, Locale, Sentence } from "@/lib/safety/types";
import type { ChatMessageRow, SessionRow, Store } from "@/lib/store/types";
import { dadWord } from "./copy";
import { hc } from "./her-copy";
import { familyRecipients } from "./recipients";
import type { FamilyRecipient } from "./types";

/**
 * The owner's decision of 2026-10-16 (「也通知女儿」): she is told when he gets the helpline answer for his own words about
 * hurting himself, as for his 995 answers: his words, Ripple's helpline lines as he saw them, and the call button; the
 * lock screen says only that there is something. Someone else's crisis he reports is still not his (third_person).
 * Turning it off again is this one line.
 */
export const TELL_FAMILY_ON_SELF_HARM = true;

/** reminder_delivery kind of this notice (ref = her link's id, slot = the ask's safety_event id). */
export const TOLD_KIND = "family_told";

/** The bus event her open pages read themselves again on (data: { link: { id } }, nothing else). */
export const TOLD_EVENT: BusEventType = "family.told";

/** How far back her 「留意」 lists them (days, today included). */
export const TOLD_DAYS = 14;

/** How long the push service may hold it: the most it allows (lib/push/sender.ts MAX_HOLD_S). */
const TOLD_TTL_S = 3600;

export type ToldKind = "emergency" | "signal" | "self_harm";

/** What familyAlarm looks at: the answer's final route, the classification's signals, who asked, what was shown. */
export interface AlarmInput {
  route: string;
  signals: readonly string[];
  /** who asked (pipeline AskInput.role); absent: him */
  role?: string | null;
  sentences: readonly Pick<Sentence, "templateId">[];
}

/** Which kind of notice an answer is, or null when she is not told (see the header). */
export function familyAlarm(a: AlarmInput, opts: { selfHarm?: boolean } = {}): ToldKind | null {
  if (a.role && a.role !== "patient") return null;
  // someone else's crisis (a report about his wife, a grandchild who swallowed his tablets): not his
  if (a.signals.includes("third_person") || a.signals.includes("child")) return null;
  if (a.route === "emergency") return a.sentences.some((s) => s.templateId === SIGNAL_RECORDED.id) ? "signal" : "emergency";
  if (a.route === "self_harm") return (opts.selfHarm ?? TELL_FAMILY_ON_SELF_HARM) ? "self_harm" : null;
  return null;
}

/** The lock-screen words in her language, his name as she calls him: never his words, never Ripple's. */
export function toldPushWords(patientLabel: string | null | undefined, locale: Locale): { title: string; body: string } {
  const vars = { dad: dadWord(patientLabel, locale) };
  return { title: hc(locale, "toldPushTitle", vars), body: hc(locale, "toldPushBody", vars) };
}

/** Where her tap lands: the conversation itself. */
export function toldHref(linkId: string, deliveryId: string): string {
  return `/f/alert/told?link=${encodeURIComponent(linkId)}&id=${encodeURIComponent(deliveryId)}`;
}

export interface TellInput {
  /** a store that may write in his scope (the ask's own, or a job's) */
  store: Store;
  scope: Pick<SessionRow, "id" | "kind" | "owner_user_id" | "story_day">;
  /** the ask's safety_event id: the once-key, and where her notice finds the conversation */
  eventId: string;
  kind: ToldKind;
}

export interface TellDeps {
  /** his active links (default lib/care/recipients.ts familyRecipients: every active link, no switch) */
  recipients?: (scopeId: string) => Promise<FamilyRecipient[]>;
  /** where the push goes (default lib/jobs/notify.ts sendNotice: the registered web push sender) */
  send?: (notice: Notice, store: Store) => Promise<{ sent: number }>;
  publish?: (sessionId: string, type: BusEventType, say: string, data: unknown) => void;
}

export interface TellResult {
  /** his active links with a family member */
  links: number;
  /** notices recorded now (a second call for the same ask records none) */
  recorded: number;
  /** phones the push service took */
  sent: number;
}

/** Tell every family member bound to him (see the header). Never throws. */
export async function tellFamily(input: TellInput, deps: TellDeps = {}): Promise<TellResult> {
  const out: TellResult = { links: 0, recorded: 0, sent: 0 };
  const { store, scope } = input;
  if (scope.kind !== "account" || !scope.owner_user_id) return out;
  let recipients: FamilyRecipient[];
  try {
    // BASELINE: every active link of his, whatever his switches for it (recipients carry them; none is read here)
    recipients = (await (deps.recipients ?? familyRecipients)(scope.id)).filter((r) => !!r.userId);
  } catch (err) {
    console.warn(`[care] told: his links could not be read (${err instanceof Error ? err.name : "error"})`);
    return out;
  }
  out.links = recipients.length;
  const pub = deps.publish ?? ((sid: string, type: BusEventType, say: string, data: unknown) => void busPublish(sid, type, say, data));
  for (const r of recipients) {
    try {
      const { created, delivery } = await store.recordDelivery(scope.id, { kind: TOLD_KIND, ref: r.linkId, day: scope.story_day, slot: input.eventId });
      if (!created) continue;
      out.recorded += 1;
      try {
        // her open 「留意」 and home read themselves again (the event names her link and nothing of what was said)
        pub(scope.id, TOLD_EVENT, "A family member was told he said something that may need attention.", { link: { id: r.linkId }, kind: input.kind });
      } catch {
        // the bus is best effort: the delivery row is the record
      }
      const words = toldPushWords(r.patientLabel, r.locale);
      const notice: Notice = {
        kind: TOLD_KIND,
        to: { role: "family", userId: r.userId, linkId: r.linkId },
        title: words.title,
        body: words.body,
        url: toldHref(r.linkId, delivery.id),
        tag: `told-${input.eventId}`,
        ttlS: TOLD_TTL_S,
        deliveryId: delivery.id,
        scopeId: scope.id,
        locale: r.locale,
      };
      out.sent += (await (deps.send ?? sendNotice)(notice, store)).sent;
    } catch (err) {
      console.warn(`[care] told: a notice could not be recorded or sent (${err instanceof Error ? err.name : "error"})`);
    }
  }
  return out;
}

// ---------------------------------------------------------------- her side: the notices as she reads them

/** One line of Ripple's answer as his screen showed it. */
export interface ToldLine {
  text: string;
  /** the language the line is in (his answer's, or a doctor's English words) */
  lang: string;
  /** a clinician's own words (his doctor's warning line): drawn as theirs, with the day they said it */
  by?: Exclude<Attribution, "label" | "leaflet"> | null;
  /** the day they said it (YYYY-MM-DD) */
  said?: string | null;
  /** a checked translation shown under a clinician's English words on his screen */
  translation?: string | null;
}

/** One notice sent to her link. */
export interface ToldNotice {
  /** the reminder_delivery id (her tap, the address of the conversation) */
  id: string;
  /** when he said it (ISO) */
  at: string;
  /** his words, as he typed or said them */
  words: string;
  /** the language of his words */
  lang: string | null;
  /** Ripple's answer to him, line by line, as he saw it */
  lines: ToldLine[];
  /** the language his answer was shown in */
  answerLang: Locale;
  /** when she opened the push (ISO), or null */
  openedAt: string | null;
}

const asLocale = (v: unknown): Locale => (v === "en" ? "en" : "zh-Hans");

const CLINICIANS = new Set(["doctor", "dispenser", "pharmacist"]);

/** The language a shown line is in: his answer's, unless the words stood as said (a doctor's English line). */
const lineLang = (text: string, locale: Locale): string => (locale === "zh-Hans" && !hasHan(text) ? "en" : locale);

/** His answer's lines from the stored answer (the chat row): what his screen drew, in its order (lib/safety/render.ts). */
function linesOfAnswer(answer: StoredAnswer): ToldLine[] {
  const locale = asLocale(answer.locale);
  const out: ToldLine[] = answer.sentences.map((s) => {
    const text = sentenceText(s, locale);
    const by = s.attribution && CLINICIANS.has(s.attribution) ? (s.attribution as ToldLine["by"]) : null;
    return { text, lang: lineLang(text, locale), ...(by ? { by, said: s.cite?.date ?? null, translation: s.translation?.text ?? null } : {}) };
  });
  // Ripple's own explanation, where his screen put it (none on a crisis answer; kept for completeness)
  if (answer.gloss) {
    const gloss = glossLines(answer.gloss, locale).map((text) => ({ text, lang: lineLang(text, locale) }));
    out.splice(Math.max(0, Math.min(answer.gloss.at, out.length)), 0, ...gloss);
  }
  return out;
}

interface EventOutput {
  locale?: unknown;
  sentences?: { en?: unknown; zh?: unknown; attribution?: unknown; origin?: unknown }[];
}

/** His answer's lines from the safety_event (before the chat rows are written): the sentences shown, nothing else. */
function linesOfEvent(output: unknown): { lines: ToldLine[]; locale: Locale } {
  const o = (output && typeof output === "object" ? output : {}) as EventOutput;
  const locale = asLocale(o.locale);
  const lines: ToldLine[] = [];
  for (const s of Array.isArray(o.sentences) ? o.sentences : []) {
    const en = typeof s.en === "string" ? s.en : "";
    const zh = typeof s.zh === "string" ? s.zh : "";
    const text = locale === "zh-Hans" && zh ? zh : en;
    if (!text) continue;
    const by = typeof s.attribution === "string" && CLINICIANS.has(s.attribution) ? (s.attribution as ToldLine["by"]) : null;
    lines.push({ text, lang: lineLang(text, locale), ...(by ? { by } : {}) });
  }
  return { lines, locale };
}

/**
 * The notices sent to her link in the last `days` days (default TOLD_DAYS), newest first. Read only, through her own
 * store (family mode reads his deliveries, chat rows and safety events; what is handed on is only the fields above).
 * BASELINE: no switch is read; a notice whose conversation is no longer there (his account's data was reset) is left out.
 */
export async function toldNotices(store: Store, scope: Pick<SessionRow, "id" | "story_day">, linkId: string, opts: { days?: number } = {}): Promise<ToldNotice[]> {
  const toDay = scope.story_day;
  const fromDay = toDay - (opts.days ?? TOLD_DAYS) + 1;
  const mine = (await store.listDeliveries(scope.id, { fromDay, toDay })).filter((d) => d.kind === TOLD_KIND && d.ref === linkId);
  if (mine.length === 0) return [];
  const days = mine.map((d) => d.day);
  const chats = await store.listChatMessages(scope.id, { fromDay: Math.min(...days), toDay: Math.max(...days) }).catch(() => [] as ChatMessageRow[]);
  // the safety records only for an ask whose chat rows are not written yet (or could not be): the newest few
  const kept = (d: { slot: string }) => chats.some((c) => c.safety_event_id === d.slot && c.role === "ripple") && chats.some((c) => c.safety_event_id === d.slot && c.role === "patient");
  const events = mine.every(kept) ? [] : await store.listSafetyEvents(scope.id, { limit: 50 }).catch(() => []);
  const out: ToldNotice[] = [];
  for (const d of mine) {
    const his = chats.find((c) => c.safety_event_id === d.slot && c.role === "patient");
    const ripple = chats.find((c) => c.safety_event_id === d.slot && c.role === "ripple");
    const answer = ripple?.answer && typeof ripple.answer === "object" ? (ripple.answer as StoredAnswer) : null;
    if (his && answer && Array.isArray(answer.sentences)) {
      out.push({ id: d.id, at: his.created_at, words: his.text, lang: his.lang, lines: linesOfAnswer(answer), answerLang: asLocale(answer.locale), openedAt: d.opened_at });
      continue;
    }
    const ev = events.find((e) => e.id === d.slot);
    if (!ev) continue;
    const { lines, locale } = linesOfEvent(ev.output);
    out.push({ id: d.id, at: ev.created_at, words: ev.input, lang: ev.lang, lines, answerLang: locale, openedAt: d.opened_at });
  }
  return out.sort((a, b) => b.at.localeCompare(a.at));
}

/** One notice of hers by its id (the conversation page), or null. */
export async function toldNotice(store: Store, scope: Pick<SessionRow, "id" | "story_day">, linkId: string, id: string): Promise<ToldNotice | null> {
  return (await toldNotices(store, scope, linkId, { days: TOLD_DAYS })).find((n) => n.id === id) ?? null;
}

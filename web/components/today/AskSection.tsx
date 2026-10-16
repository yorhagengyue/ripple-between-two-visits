"use client";

/**
 * 问一句 (C2 track S; journey 07, real-app 2.10): where he types or says a question and reads the answer, drawn as the
 * timeline draft's 07 screens (with 09 and 10, the answers that are 995 or the helplines, and the general states that
 * are drawn on this screen: 通用-3, 通用-4a to 4c).
 *
 *   mode "today"   the Today screen's typing dock (the draft's 04-1): the field and 「改用说的 / 问这句」 in the strip above
 *                  the tab bar, where the 「按一下说 / 打字」 bar was (components/daily/elder/TodayAccount.tsx mounts it
 *                  when he taps 「打字」 and hands it AskDockContext). Sending opens /p/ask, the answer's own screen (one
 *                  thing per screen; a refresh keeps it).
 *   mode "screen"  /p/ask. From the top: what stands in the way (no network, 通用-3; no consent to AI processing, 07-7;
 *                  the microphone refused or missing, 通用-4b and 4c), then the one thing the screen is about:
 *                    - the question he just sent, at once, with the waiting line under it, until its answer is there;
 *                    - the microphone while he speaks (通用-4a while the browser asks, 07-1a, 07-1b);
 *                    - the latest answer as a line (his question first; components/daily/AnswerCard.tsx: 07-2a to
 *                      07-5, 09-1, 09-2, 10-1);
 *                    - before he asked anything today, one sentence; on an example account 「可以这样问」 with its three
 *                      sentences (22-2; a tap only puts the words into the field).
 *                  Under an answer: today's earlier questions as a list (07-6), each opening its answer in place (the
 *                  example's three sentences are on the empty screen only: owner's tidy of 10-13). At the bottom,
 *                  always, the dock: the field and 「问这句」 (07-1c), and next to it the worded microphone button
 *                  when this server can listen.
 *
 * The answer is word for word what lib/safety returned. Today's turns come from the server (/p/ask renders them; GET
 * /api/ask/history), so nothing is lost on a refresh. The microphone (AskMic.tsx) is there only when the server says a
 * transcription service is connected (`voice`: the page's prop; lib/safety/voice.ts); without one nothing of it is
 * rendered (real-app 2.10: 没有 Whisper 时，不显示麦克风按钮). What he says is shown for him to check and asked through the
 * same `ask` as a typed question, only when he taps 「问这句」. Typing works everywhere. Too many questions in an hour:
 * 「这个小时问得太多了，11:00 以后再问。」; his day's allowance used up: 「今天问得太多了，明天再问。」 (ask-copy.ts limitWords: the
 * 429 says which). Without a network (C2 track O; real-app 2.25): a grey box says so, and a tap on 「问这句」 answers
 * 「要连上网才能问。」; a question is never queued, what he typed stays in the field.
 *
 * A sign-in that ended sends him to the login and back here (lib/session/client.ts fetchSignedIn). The sentence that is
 * on its way is kept on this phone for that trip (sessionStorage, under his own tag, half an hour at most) and is back in
 * the field when he returns; it is asked only when he taps 「问这句」, and forgotten once it was answered, could not be
 * sent for another reason, or he emptied the field. Logging out clears it with everything else the phone keeps
 * (lib/offline/forget.ts).
 *
 * The request names no scope: the device's own cookie does (an account's sign-in, or the demo phone's rp_session). Works
 * without a live-session provider (the /design gallery renders it with only `locale`).
 *
 * SSE (owner 10-15: 「需要非常完整的 SSE 的输出」): a question goes as POST /api/ask with Accept: text/event-stream (streamAsk,
 * lib/sse/client.ts). While its answer is on its way the screen shows what has come so far: his question, the sentences that
 * are final already, Ripple's own words as they are written with a soft caret, and the stage line under them
 * (「在找医生说过的话……」, then 「正在写……」), all drawn by AnswerCard's draft; then the final answer, drawn exactly as before.
 * A refusal (429) is the plain answer it always was; a stream that breaks off is asked once more without streaming.
 *
 * The guided harness (2026-10-16, lib/safety/risk/types.ts): an answer may end on one scripted follow-up question with buttons
 * (AnswerCard draws it last, components/daily/FollowUpQuestion.tsx). The stream's "followup" event is kept with what has come
 * so far, and the question is drawn once the answer is final (a draft offers nothing to tap). His tap is asked through the
 * same `ask` as a typed question, with `reply` (the question's id and the chosen options) and his words = the options' words:
 * while it is on its way the answer he tapped stays on the screen with what he chose marked and the waiting line under it,
 * until the new answer's first sentence comes; then the new answer is the next turn, drawn as a typed question's is, and
 * the focus moves to it. A failure opens the question again, with the sentence that says why where a typed question has it.
 * Only the latest answer's question can be answered; an earlier one is drawn answered (what he chose marked: the turn that
 * answered it says so, AskTurn.reply) or closed. Typing and speaking work while a question is there: a new ask like any other.
 * When an answer with a question arrives (or the page opens on one), the screen goes where the question shows with the 995
 * line still in view (components/daily/follow-up-place.ts); when the two cannot show together it stays on the 995 line and
 * the chip 「Ripple 想问你一句 ↓」 at the foot of the view takes him to the question (the owner's coordinator's decision,
 * 10-16). Hook: ask-followup-chip.
 *
 * Test hooks: ask-section (data-mode, data-turns, data-urgent), ask-input, ask-field, ask-send, ask-to-speak, ask-asking
 * (his sentence while its answer is on the way), ask-pending, ask-error, ask-start, ask-earlier, ask-earlier-turn,
 * ask-earlier-question, ask-no-ai (and ask-no-ai-change), ask-offline, the example sentences ([data-rp="example-asks"],
 * [data-action="example-ask"]), and the microphone's (AskMic.tsx).
 */
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { AnswerCard } from "@/components/daily/AnswerCard";
import { FollowUpChip } from "@/components/daily/FollowUpQuestion";
import { placeFollowUp } from "@/components/daily/follow-up-place";
import { askCopy, limitWords } from "@/components/daily/ask-copy";
import { answeredFollowUps, followUpOf } from "@/components/daily/follow-up";
import { useOfflineKit } from "@/components/offline/OfflineProvider";
import { MicBlocked, MicButton, MicControls, MicNote, MicStage, useAskMic } from "@/components/today/AskMic";
import { EXAMPLE_ASKS, fillAskBox } from "@/components/today/ExampleBanner";
import { ActionDock, Box, Chevron, ListCard, ListItem, ListMark, Tag, Timeline, TimelineItem } from "@/components/ui";
import { Icon } from "@/components/ui/icons";
import { exampleCopy } from "@/lib/profile/copy";
import { uiCopy } from "@/lib/ui/copy";
import { fetchSignedIn } from "@/lib/session/client";
import type { FollowUp, FollowUpReply } from "@/lib/safety/risk/types";
import type { AskResult, Route, Sentence } from "@/lib/safety/types";
import type { AskTurn, StoredAnswer } from "@/lib/safety/turns";
import { postEventStream } from "@/lib/sse/client";
import type { UiLocale } from "@/lib/ui/tokens";

declare global {
  interface Window {
    /** e2e timing marks: tap -> answer shown (performance.now() ms) */
    __rpAsk?: { text: string; sentAt: number; answeredAt: number | null };
  }
}

export const ASK_SCREEN = "/p/ask";
/** Where Today's 「按一下说」 goes: the ask screen, listening at once. */
export const ASK_SPEAK = `${ASK_SCREEN}?speak=1`;

/**
 * What the screen that hosts Today's typing dock hands it: the way back to speaking (「改用说的」; none: there is no way to
 * listen on this server, the button is grey), and words to start the field with (an example sentence he tapped).
 */
export const AskDockContext = createContext<{ onSpeak?: () => void; onBack?: () => void; prefill?: string } | null>(null);

/** Today's typing field is as tall as his words (ux pass, 10-12); the stylesheet stops it at four lines, then it scrolls. */
function fit(el: HTMLTextAreaElement): void {
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`;
}

// ---- the sentence kept for the trip to the login page

const DRAFT_KEY = "rp_ask_draft";
const DRAFT_KEEP_MS = 30 * 60_000;

function tabStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * The sentence that was on its way when his sign-in ended, if this phone keeps one, it is his (the opaque owner tag of
 * the account's pages) and it is recent. Someone else's, or an old one, is forgotten on the spot.
 */
export function askDraft(owner: string | null): string | null {
  if (!owner) return null;
  try {
    const raw = tabStorage()?.getItem(DRAFT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as { text?: unknown; at?: unknown; owner?: unknown };
    if (d.owner === owner && typeof d.text === "string" && d.text.trim() && typeof d.at === "number" && Date.now() - d.at <= DRAFT_KEEP_MS) return d.text;
    tabStorage()?.removeItem(DRAFT_KEY);
  } catch {
    // storage blocked or not JSON: nothing is kept
  }
  return null;
}

function keepDraft(owner: string | null, text: string): void {
  if (!owner) return;
  try {
    tabStorage()?.setItem(DRAFT_KEY, JSON.stringify({ text, at: Date.now(), owner }));
  } catch {
    // storage blocked: the sentence is simply not kept
  }
}

function dropDraft(): void {
  try {
    tabStorage()?.removeItem(DRAFT_KEY);
  } catch {
    // nothing was kept
  }
}

/** He edits a sentence the phone keeps: the kept copy follows his words; an emptied field forgets it. */
function followDraft(owner: string | null, value: string): void {
  if (!owner) return;
  try {
    if (tabStorage()?.getItem(DRAFT_KEY) == null) return;
  } catch {
    return;
  }
  if (value.trim()) keepDraft(owner, value);
  else dropDraft();
}

// ---- asking

export type AskOutcome = { ok: true; turn: AskTurn } | { ok: false; status: number; code: string | null; retryAt: string | null; limit?: string | null };

/** The kept turn as /p/ask will show it, from the answer the server gave (`reply`: the ask was his tap on a follow-up). */
function turnFrom(text: string, r: AskResult, reply?: FollowUpReply): AskTurn {
  return {
    id: `local-${Date.now()}`,
    day: 0,
    at: new Date().toISOString(),
    text,
    lang: null,
    ...(reply ? { reply } : {}),
    answer: {
      route: r.route,
      sentences: r.sentences,
      locale: r.locale,
      ...(r.addedQuestionId ? { addedQuestionId: r.addedQuestionId } : {}),
      ...(r.questionReused ? { questionReused: r.questionReused } : {}),
      ...(r.reusedQuestion ? { reusedQuestion: r.reusedQuestion } : {}),
      ...(r.answeredBefore ? { answeredBefore: r.answeredBefore } : {}),
      ...(r.noAiConsent ? { noAiConsent: r.noAiConsent } : {}),
      // 10-14: Ripple's own words under the quotes (lib/safety/gloss.ts), as the kept turn has them
      ...(r.gloss ? { gloss: r.gloss } : {}),
      // harness (10-16): the follow-up question, as the kept turn has it (never the risk summary)
      ...(r.followUp ? { followUp: r.followUp } : {}),
    },
  };
}

/** A plain answer of POST /api/ask (JSON): the turn, or why there is none. */
async function outcomeFrom(res: Response, text: string, reply?: FollowUpReply): Promise<AskOutcome> {
  const data = (await res.json().catch(() => ({}))) as Partial<AskResult> & { retryAt?: string; limit?: string; error?: unknown };
  if (!res.ok || !data.route || !Array.isArray(data.sentences)) {
    return { ok: false, status: res.status, code: typeof data.error === "string" ? data.error : null, retryAt: data.retryAt ?? null, limit: data.limit ?? null };
  }
  return { ok: true, turn: turnFrom(text, data as AskResult, reply) };
}

/** The body of POST /api/ask: his words, the screen's language, and his tap on a follow-up question when it is one. */
export function askBody(text: string, locale: UiLocale, reply?: FollowUpReply): { text: string; locale: UiLocale; reply?: FollowUpReply } {
  return { text, locale, ...(reply ? { reply } : {}) };
}

/**
 * POST /api/ask with the device's own cookie; the kept turn as /p/ask will show it. `reply`: the ask is his tap on a
 * follow-up question (harness, 2026-10-16), `text` the chosen options' words.
 */
export async function sendAsk(text: string, locale: UiLocale, reply?: FollowUpReply): Promise<AskOutcome> {
  // track O: fetchSignedIn, so a sign-in that ended goes to /login?next= and comes back (real-app 2.25)
  const res = await fetchSignedIn("/api/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(askBody(text, locale, reply)),
  }).catch(() => null);
  if (!res) return { ok: false, status: 0, code: null, retryAt: null };
  return outcomeFrom(res, text, reply);
}

/**
 * SSE (owner 10-15: 「需要非常完整的 SSE 的输出」): the answer as it stands while it is being made, from POST /api/ask's events
 * in order (lib/safety/types.ts AskStreamEvent). The screens draw it with AnswerCard's draft until the final answer comes.
 */
export interface AskProgress {
  /** sending: nothing has come yet; reading: his question was taken and his sources are looked at; writing: Ripple writes */
  stage: "sending" | "reading" | "writing";
  /** the answer's sentences that are final already, in its order */
  sentences: Sentence[];
  route: Route | null;
  /** Ripple's own words so far (taken back when the server retracts them) */
  words: string;
  /** Ripple's own words are still coming (the caret) */
  writing: boolean;
  /**
   * harness (2026-10-16): the follow-up question, when its event came (after the answer's sentences). Kept, not drawn: a
   * draft offers nothing to tap, and the final answer carries the same question.
   */
  followUp?: FollowUp;
}

export const NO_PROGRESS: AskProgress = { stage: "sending", sentences: [], route: null, words: "", writing: false };

/** Something of the answer has come (a sentence, or Ripple's own words): the screen draws it. */
export function hasProgress(p: AskProgress | null): p is AskProgress {
  return !!p && (p.sentences.length > 0 || p.words.trim().length > 0);
}

const HAN = /\p{Script=Han}/u;

/**
 * What has come so far as an answer AnswerCard can draw (with `draft`): the sentences, and Ripple's own words where the
 * answer will put them (after the last quote, before Ripple's fixed lines: lib/safety/gloss.ts glossAt).
 */
export function draftAnswer(p: AskProgress, locale: UiLocale): StoredAnswer {
  let at = 0;
  p.sentences.forEach((s, i) => {
    if (s.origin !== "template" && !s.templateId) at = i + 1;
  });
  const words = p.words.trim() ? p.words : "";
  return {
    route: p.route ?? "explain",
    sentences: p.sentences,
    locale,
    ...(words ? { gloss: { kind: "general" as const, lang: HAN.test(words) ? ("zh-Hans" as const) : ("en" as const), sentences: [{ text: words, sourceIds: [] }], at } } : {}),
  };
}

/** The stage line's words for where the answer is (the line under his question while it is on its way). */
export function stageWords(locale: UiLocale, p: AskProgress | null): string {
  const copy = askCopy(locale);
  return p?.stage === "writing" ? copy.writing : copy.sending;
}

/**
 * POST /api/ask as Server-Sent Events: each step of the answer goes to `onProgress` as it comes, and the outcome is the
 * same as sendAsk's (the final event is exactly the plain answer). A refusal (429 and the rest) comes as the plain answer
 * it always was. A stream that breaks off before its end is asked once more without streaming, so he always gets his
 * answer (lib/sse/client.ts). `reply`: the ask is his tap on a follow-up question (harness, 2026-10-16).
 */
export async function streamAsk(text: string, locale: UiLocale, onProgress: (p: AskProgress) => void, reply?: FollowUpReply): Promise<AskOutcome> {
  let p = NO_PROGRESS;
  const set = (next: AskProgress) => {
    p = next;
    onProgress(next);
  };
  const got: { final: AskResult | null; failed: AskOutcome | null } = { final: null, failed: null };
  const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
  const out = await postEventStream(
    "/api/ask",
    askBody(text, locale, reply),
    {
      fetchImpl: fetchSignedIn,
      onEvent: ({ event, data }) => {
        const d = (data ?? {}) as Record<string, unknown>;
        if (event === "stage") set({ ...p, stage: d.stage === "writing" ? "writing" : "reading" });
        else if (event === "sentence" && d.sentence)
          set({ ...p, stage: p.stage === "sending" ? "reading" : p.stage, sentences: [...p.sentences, d.sentence as Sentence], route: (str(d.route) as Route | null) ?? p.route });
        else if (event === "delta") set({ ...p, stage: "writing", words: p.words + (str(d.text) ?? ""), writing: true });
        else if (event === "retract") set({ ...p, words: "", writing: false });
        else if (event === "replace" && Array.isArray(d.sentences)) set({ ...p, sentences: d.sentences as Sentence[], route: (str(d.route) as Route | null) ?? p.route });
        else if (event === "followup" && d.followUp && typeof d.followUp === "object") set({ ...p, followUp: d.followUp as FollowUp });
        else if (event === "final") got.final = d as unknown as AskResult;
        else if (event === "error") got.failed = { ok: false, status: Number(d.status) || 500, code: str(d.error), retryAt: str(d.retryAt), limit: str(d.limit) };
      },
    },
  ).catch(() => null);
  if (!out) return { ok: false, status: 0, code: null, retryAt: null };
  if (!out.streamed) return outcomeFrom(out.res, text, reply);
  const final = got.final;
  if (final && final.route && Array.isArray(final.sentences)) return { ok: true, turn: turnFrom(text, final, reply) };
  if (got.failed) return got.failed;
  // the stream broke off before its end (the network, a proxy): the plain request once
  return sendAsk(text, locale, reply);
}

function useAsk(
  locale: UiLocale,
  owner: string | null,
  on: {
    /** the answer is in */
    answered: (turn: AskTurn) => void;
    /** the question is on its way (his words, trimmed; `reply`: it is his tap on a follow-up question) */
    started?: (text: string, reply?: FollowUpReply) => void;
    /** it did not go through: the screen is what it was, with the sentence that says why */
    failed?: () => void;
    /** SSE: the answer as it stands while it is being made (lib/sse; AskProgress) */
    progress?: (p: AskProgress) => void;
  },
) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const copy = askCopy(locale);
  /**
   * One question, typed or spoken (the microphone's 「问这句」), or his tap on a follow-up question (`reply`, harness
   * 2026-10-16): the same request, waiting words, 429 sentences and what follows the answer. `sent` runs once the answer is
   * in, before `on.answered` (the typing field empties itself there). False when nothing was asked or it did not go through.
   */
  async function ask(raw: string, sent?: () => void, reply?: FollowUpReply): Promise<boolean> {
    const text = raw.trim();
    if (!text || pending) return false;
    // track O: no network, nothing is sent and nothing is queued
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setError(copy.offline);
      return false;
    }
    setPending(true);
    setError(null);
    on.started?.(text, reply);
    // kept before it leaves: when his sign-in has ended the page goes to the login as soon as the server says so (not a
    // tap on a follow-up question: those words were never in the field)
    if (!reply) keepDraft(owner, text);
    window.__rpAsk = { text, sentAt: performance.now(), answeredAt: null };
    // SSE (owner 10-15): the answer told as it is made; the outcome is sendAsk's
    const out = await streamAsk(text, locale, (p) => on.progress?.(p), reply);
    setPending(false);
    if (!out.ok) {
      // his sign-in ended (401, or no cookie left at all): the page is on its way to the login and his sentence waits
      // on this phone for when he is back. Any other failure: his words are still in the field, nothing is kept
      if (out.status !== 401 && out.code !== "no_session") dropDraft();
      setError(out.status === 429 ? limitWords(locale, out) : out.status === 0 ? copy.offline : copy.failed);
      on.failed?.();
      return false;
    }
    dropDraft();
    sent?.();
    on.answered(out.turn);
    return true;
  }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    await ask(String(new FormData(form).get("q") ?? ""), () => form.reset());
  }
  return { pending, error, submit, ask };
}

/**
 * Today's typing dock (the draft's 04-1): the field, then 「改用说的」 and 「问这句」 side by side. Sending opens the answer's
 * screen. The field takes the words an example sentence put there (AskDockContext.prefill, and the rp:ask-prefill event
 * while it is open), or the sentence kept for a trip to the login page.
 */
function TodayAsk({ locale, example }: { locale: UiLocale; example: boolean }) {
  const router = useRouter();
  const copy = askCopy(locale);
  const ui = uiCopy(locale);
  const dock = useContext(AskDockContext);
  const owner = useOfflineKit().owner;
  const input = useRef<HTMLTextAreaElement | null>(null);
  const [aiOff, setAiOff] = useState(false);
  useEffect(() => {
    let live = true;
    fetch("/api/ask/history", { credentials: "same-origin" })
      .then((r) => (r.ok ? (r.json() as Promise<{ turns: AskTurn[]; ai?: boolean }>) : null))
      .then((d) => {
        if (live && d) setAiOff(d.ai === false);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  // the words an example sentence put here (or the sentence kept while he logged in again), and the field ready to type in
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    if (dock?.prefill !== undefined) el.value = dock.prefill;
    else if (!el.value) el.value = askDraft(owner) ?? "";
    fit(el);
    el.focus({ preventScroll: true });
  }, [dock?.prefill, owner]);
  useEffect(() => {
    const fill = (e: Event) => {
      const text = (e as CustomEvent<{ text?: unknown }>).detail?.text;
      if (typeof text === "string" && input.current) {
        input.current.value = text;
        fit(input.current);
      }
    };
    window.addEventListener("rp:ask-prefill", fill);
    return () => window.removeEventListener("rp:ask-prefill", fill);
  }, []);
  const [progress, setProgress] = useState<AskProgress | null>(null);
  const { pending, error, submit } = useAsk(locale, owner, { answered: () => router.push(ASK_SCREEN), progress: setProgress, started: () => setProgress(null) });
  return (
    <div className="rpu rpu-typedock" data-rp="type-dock" data-testid="ask-section" data-mode="today" lang={locale}>
      {/* an example account: the example's sentences rise over the field while it is empty (ux pass, 10-12) */}
      {example ? (
        <div className="rpu-askideas" data-rp="ask-ideas" data-testid="ask-ideas">
          <ExampleAsks locale={locale} heading="h2" />
        </div>
      ) : null}
      {aiOff && <NoAiLine locale={locale} />}
      {pending && (
        <p className="rpu-cite" role="status" data-testid="ask-pending" style={{ marginTop: 0 }}>
          {stageWords(locale, progress)}
        </p>
      )}
      {error && (
        <p className="rpu-cite" role="alert" data-testid="ask-error" style={{ marginTop: 0 }}>
          {error}
        </p>
      )}
      <div data-testid="ask-field">
        <form className="rpu-typedock-form" data-rp="ask" onSubmit={submit}>
          {/* the field grows with what he writes, up to four lines (ux pass, 10-12); the Enter key still sends */}
          <textarea
            ref={input}
            id="rpu-ask-q"
            name="q"
            rows={1}
            className="rpu-field-input"
            data-rp-role="say"
            data-testid="ask-input"
            enterKeyHint="send"
            autoComplete="off"
            maxLength={500}
            placeholder={ui.typePlaceholder}
            aria-label={copy.fieldLabel}
            disabled={pending}
            onInput={(e) => {
              followDraft(owner, e.currentTarget.value);
              fit(e.currentTarget);
            }}
            onKeyDown={(e) => {
              if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }}
          />
          {/* one round button at the field's right: back to the say bar while the field is empty, sending once it holds
              words (which of the two shows is the stylesheet's: .rpu-say-icon in app/ripple-ui.css) */}
          <button type="button" className="rpu-say-icon" data-kind="speak" data-testid="ask-to-speak" aria-label={ui.saySwitchToSpeak} onClick={dock?.onBack}>
            <Icon name="mic" size={30} />
          </button>
          <button type="submit" className="rpu-say-icon" data-kind="send" data-testid="ask-send" aria-label={ui.askThis} disabled={pending} aria-busy={pending ? true : undefined}>
            <Icon name="send" size={30} stroke={2.6} />
          </button>
        </form>
      </div>
    </div>
  );
}

/**
 * Real-app 2.10: while he has not agreed to AI processing the ask screen says so, in the design's one sentence
 * (lib/safety/no-ai.ts), before he asks and under his answers. On Today's dock it is this one line.
 */
function NoAiLine({ locale }: { locale: UiLocale }) {
  return (
    <p className="rpu-cite" role="note" data-testid="ask-no-ai" style={{ marginTop: 0 }}>
      {askCopy(locale).noAi}
    </p>
  );
}

/** The same sentence on the ask screen, above the answer (the draft's 07-7): a grey box with the way to change it. */
function NoAiBox({ locale }: { locale: UiLocale }) {
  const copy = askCopy(locale);
  return (
    <Box
      variant="grey"
      title={
        <span role="note" data-testid="ask-no-ai">
          {copy.noAi}
        </span>
      }
      link={{ href: "/p/me/ai", label: copy.noAiChange, testId: "ask-no-ai-change" }}
    />
  );
}

function subscribeOnline(onChange: () => void): () => void {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}
/** Whether the phone says it has a network (it does on the server and until the browser says otherwise). */
function useOnline(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine !== false,
    () => true,
  );
}

/**
 * 「可以这样问」 on an example account (the draft's 22-2; real-app 4.7): the example's three sentences, marked 「示例」. A tap
 * only puts the words into the field; he asks them as he would his own. `heading`: the level its title has on the
 * screen (the screen's own heading before he asked anything, a section's over Today's typing field).
 */
function ExampleAsks({ locale, heading, testId }: { locale: UiLocale; heading: "h1" | "h2"; testId?: string }) {
  const c = exampleCopy(locale);
  const Title = heading;
  return (
    <section className="rpu rpu-list" data-rp="example-asks" data-testid={testId}>
      <Title className="rpu-text" data-variant="strong" data-size="large" style={{ margin: 0, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
        {c.tryAsking} <Tag tone="neutral">{c.exampleTag}</Tag>
      </Title>
      <ListCard>
        {EXAMPLE_ASKS[locale].map((text) => (
          <ListItem key={text} mark="me" title={text} chevron onClick={() => void fillAskBox(text)} attrs={{ "data-action": "example-ask", "data-text": text }} />
        ))}
      </ListCard>
    </section>
  );
}

/**
 * Before he asked anything today: one sentence. On an example account 「可以这样问」 and the example's three sentences
 * instead (22-2).
 */
function Start({ locale, voice, example }: { locale: UiLocale; voice: boolean; example: boolean }) {
  if (example) return <ExampleAsks locale={locale} heading="h1" testId="ask-start" />;
  const prompt = (voice ? uiCopy(locale).askPrompt : askCopy(locale).prompt).join("");
  return (
    <h1 className="rpu-text" data-variant="lede" data-testid="ask-start" style={{ margin: 0 }}>
      {prompt}
    </h1>
  );
}

/** /p/ask: what stands in the way, the one thing the screen is about, today's earlier questions, the dock. */
function AskScreen({
  locale,
  initialTurns,
  aiOff,
  voice,
  example,
  autoSpeak,
}: {
  locale: UiLocale;
  initialTurns: AskTurn[];
  aiOff: boolean;
  voice: boolean;
  example: boolean;
  autoSpeak: boolean;
}) {
  const copy = askCopy(locale);
  const ui = uiCopy(locale);
  const owner = useOfflineKit().owner;
  const online = useOnline();
  const [turns, setTurns] = useState<AskTurn[]>(initialTurns);
  /** the sentence that is on its way: it has the screen until its answer is there */
  const [asking, setAsking] = useState<string | null>(null);
  /** SSE: its answer as it stands while it is being made */
  const [progress, setProgress] = useState<AskProgress | null>(null);
  /** SSE: a draft of this answer was on the screen; the answer that takes its place (its turn id) does not rise in again */
  const drafted = useRef(false);
  const [settledId, setSettledId] = useState<string | null>(null);
  const top = useRef<HTMLDivElement | null>(null);
  const input = useRef<HTMLInputElement | null>(null);
  /**
   * harness (2026-10-16): the ask on its way is his tap on the latest answer's follow-up question. Until the new answer's
   * first sentence comes, the answer he tapped keeps the screen (what he chose marked, the waiting line under it).
   */
  const [replying, setReplying] = useState<FollowUpReply | null>(null);
  const replyingNow = useRef(false);
  /** harness (10-16): the answer (its turn id) whose question could not show with its 995 line on arrival: the chip */
  const [chipFor, setChipFor] = useState<string | null>(null);
  const hideChip = useCallback(() => setChipFor(null), []);
  /** the latest answer's open question, for the chip */
  const openQuestion = useCallback(() => top.current?.parentElement?.querySelector<HTMLElement>('[data-testid="ask-answer"] [data-testid="ask-followup"][data-state="open"]') ?? null, []);
  /** the latest answer, placed as its question wants it (follow-up-place.ts); true when the chip is wanted */
  const placeQuestion = () => {
    const answer = top.current?.parentElement?.querySelector<HTMLElement>('[data-testid="ask-answer"]');
    return answer ? placeFollowUp(answer, document.querySelector<HTMLElement>('.rpu-tabs[data-placement="fixed"]')) : false;
  };
  /** the screen from its header down: his question is the first thing under it (the window scrolls; a phone drawn inside a box scrolls its own page) */
  const toTop = () => {
    window.scrollTo({ top: 0 });
    top.current?.closest<HTMLElement>(".rpu-page")?.scrollTo({ top: 0 });
  };
  /** after his tap was answered: the focus on the new answer (his words, its heading), where a screen reader reads on */
  const focusAnswer = () => {
    const heading = top.current?.parentElement?.querySelector<HTMLElement>('[data-testid="ask-answer"] h1');
    if (!heading) return;
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
  };
  const { pending, error, submit, ask } = useAsk(locale, owner, {
    started: (text, reply) => {
      setAsking(text);
      setProgress(NO_PROGRESS);
      drafted.current = false;
      replyingNow.current = !!reply;
      setReplying(reply ?? null);
      // a typed question has the screen from the top at once; a tap stays where he tapped until the answer comes
      if (!reply) requestAnimationFrame(toTop);
    },
    failed: () => {
      setAsking(null);
      setProgress(null);
      setReplying(null);
      replyingNow.current = false;
    },
    progress: (p) => {
      if (hasProgress(p)) {
        // his tap's answer has begun: it is the next turn now, from the top, as a typed question's is
        if (!drafted.current && replyingNow.current) requestAnimationFrame(toTop);
        drafted.current = true;
      }
      setProgress(p);
    },
    answered: (turn) => {
      const wasReply = replyingNow.current;
      replyingNow.current = false;
      setTurns((t) => [...t, turn]);
      setAsking(null);
      setProgress(null);
      setReplying(null);
      setSettledId(drafted.current ? turn.id : null);
      requestAnimationFrame(() => {
        if (window.__rpAsk) window.__rpAsk.answeredAt = performance.now();
        toTop();
        // harness (10-16): an answer with a question: where the question shows, the 995 line kept in view
        setChipFor(placeQuestion() ? turn.id : null);
        if (wasReply) focusAnswer();
      });
    },
  });
  const mic = useAskMic({ onAsk: (text) => ask(text), auto: voice && autoSpeak });
  // he came through 「按一下说」: the address goes back to the screen's own, so a refresh does not listen again
  useEffect(() => {
    if (autoSpeak && window.location.search) window.history.replaceState(window.history.state, "", ASK_SCREEN);
  }, [autoSpeak]);
  // the sentence kept while he logged in again is back in the field; it is asked only when he taps 「问这句」
  useEffect(() => {
    const el = input.current;
    const kept = askDraft(owner);
    if (el && kept && !el.value) el.value = kept;
  }, [owner]);
  // harness (10-16): the page opens on an answer with an open question (a refresh, the way back from another page)
  const firstLatest = useRef(initialTurns.filter((t) => t.answer).at(-1)?.id ?? null);
  useEffect(() => {
    const id = firstLatest.current;
    if (!id) return;
    const raf = requestAnimationFrame(() => setChipFor(placeQuestion() ? id : null));
    return () => cancelAnimationFrame(raf);
    // (once, on the first paint)
  }, []);
  // the microphone was refused or is missing: the box that says so is at the top of the screen
  const blocked = voice && (mic.state === "denied" || mic.state === "unavailable");
  useEffect(() => {
    if (!blocked) return;
    window.scrollTo({ top: 0 });
    top.current?.closest<HTMLElement>(".rpu-page")?.scrollTo({ top: 0 });
  }, [blocked]);

  const answered = turns.filter((t) => t.answer);
  const latest = answered[answered.length - 1];
  const earlier = answered.slice(0, -1).reverse();
  /** harness: the follow-up questions he answered today, and with what (the turns that answered them say so) */
  const replies = answeredFollowUps(turns);
  /** what a tap on the latest answer's question does: asked as a typed question is, with the reply */
  const onReply = (a: { text: string; reply: FollowUpReply }) => ask(a.text, undefined, a.reply);
  /** the microphone has the screen (the browser is asking for it, listening, turning into words, his words to check) */
  const speaking = voice && (mic.active || mic.state === "starting");
  /** his tap on the latest answer's question is on its way and nothing of its answer has come yet: that answer keeps the screen */
  const waitingOnTap = asking !== null && replying !== null && !hasProgress(progress) && !!latest;
  /**
   * his question, or the microphone, has the screen: nothing else is on it. Not while the answer he tapped is still up: the
   * screen stays as it was (the dock where it stood, today's earlier questions under it), so nothing moves over the question
   * he is looking at
   */
  const busy = (asking !== null && !waitingOnTap) || speaking;
  const route = latest?.answer?.route;
  const urgent = !busy && (route === "emergency" || route === "self_harm");
  return (
    <div className="rpu-askscreen" data-rp="ask-screen" data-testid="ask-section" data-mode="screen" data-turns={answered.length} data-urgent={urgent ? "true" : undefined}>
      <div ref={top} />
      <div className="rpu-stack">
        {!online && (
          <Box variant="grey" testId="ask-offline" title={ui.offlineTitle}>
            {ui.offlineBody}
          </Box>
        )}
        {aiOff && <NoAiBox locale={locale} />}
        {voice && <MicBlocked mic={mic} locale={locale} />}
        {asking !== null && !waitingOnTap && hasProgress(progress) ? (
          // SSE: what has come of the answer so far, drawn by the answer's own card (its draft), the stage line under it
          <div data-testid="ask-asking">
            <AnswerCard question={asking} answer={draftAnswer(progress, locale)} locale={locale} draft={{ line: stageWords(locale, progress), writing: progress.writing, testId: "ask-pending" }} />
          </div>
        ) : asking !== null && !waitingOnTap ? (
          <Timeline testId="ask-asking">
            <TimelineItem node="me" who={ui.asked}>
              <p className="rpu-bubble" data-rp="bubble" data-rp-role="say">
                {asking}
              </p>
            </TimelineItem>
            <TimelineItem node="rip">
              <p className="rpu-tl-note" role="status" data-testid="ask-pending">
                {stageWords(locale, progress)}
              </p>
            </TimelineItem>
          </Timeline>
        ) : speaking ? (
          <MicStage mic={mic} locale={locale} />
        ) : latest ? (
          // (the same element while his tap on its question is on its way, so what he chose stays marked)
          <AnswerCard
            key={latest.id}
            question={latest.text}
            answer={latest.answer!}
            locale={locale}
            latest
            noted={latest.noted}
            aiNote={!aiOff}
            askedAt={latest.at}
            settled={latest.id === settledId}
            followUp={followUpOf(latest.answer!, replies, waitingOnTap ? replying : null, onReply)}
          />
        ) : (
          <Start locale={locale} voice={voice} example={example} />
        )}
        {!busy && earlier.length > 0 && (
          <div className="rpu rpu-list" data-testid="ask-earlier">
            <p className="rpu-label">{copy.earlierCount(earlier.length)}</p>
            <div className="rpu-list-card">
              {earlier.map((t) => (
                <details key={t.id} className="rpu-fold" data-testid="ask-earlier-turn">
                  <summary className="rpu-li">
                    <ListMark kind="me" />
                    <span className="rpu-li-main">
                      <span className="rpu-li-t" data-testid="ask-earlier-question">
                        {t.text}
                      </span>
                      {/* where that question went, when it went onto his list */}
                      {t.answer!.addedQuestionId && !t.answer!.answeredBefore ? <span className="rpu-li-s">{ui.added}</span> : null}
                    </span>
                    <Chevron />
                  </summary>
                  <div className="rpu-fold-body">
                    <AnswerCard question={t.text} answer={t.answer!} locale={locale} latest={false} showQuestion={false} noted={t.noted} aiNote={!aiOff} followUp={followUpOf(t.answer!, replies)} />
                  </div>
                </details>
              ))}
            </div>
          </div>
        )}
        {/* the example's three sentences are on the empty screen only (Start): once he has asked today they are not
            drawn again under the answer (owner's tidy of 10-13) */}
      </div>

      {/* the dock: at the foot of the screen, above the tab bar, while the screen is about asking (the start, his
          sentence on its way, the microphone). Once an answer has the screen, the answer has all of it (the draft's
          answer screens draw no dock): the field stands at the end of the page, under the answer */}
      {/* harness (10-16): the question could not show with the 995 line: the chip at the foot of the view takes him there */}
      {chipFor !== null && latest?.id === chipFor && !busy ? (
        <FollowUpChip locale={latest.answer?.locale ?? locale} question={openQuestion} bottom="calc(var(--rpu-bottom, 0px) + 12px)" onSeen={hideChip} />
      ) : null}
      <ActionDock bar className="rpu-askdock" data-pinned={latest && !busy ? "false" : "true"}>
        {error && (
          <p className="rpu-cite" role="alert" data-testid="ask-error" style={{ marginTop: 0 }}>
            {error}
          </p>
        )}
        {voice && <MicNote mic={mic} locale={locale} />}
        {speaking && <MicControls mic={mic} locale={locale} disabled={pending} />}
        {/* the field stays mounted while he speaks, so what he typed is still there when he comes back to it */}
        <div data-testid="ask-field" hidden={speaking}>
          <form className="rpu-askdock-form" data-rp="ask" onSubmit={submit}>
            <input
              ref={input}
              id="rpu-ask-q"
              name="q"
              className="rpu-field-input"
              data-rp-role="say"
              data-testid="ask-input"
              enterKeyHint="send"
              autoComplete="off"
              maxLength={500}
              placeholder={ui.typePlaceholder}
              aria-label={latest ? copy.promptAgain : copy.fieldLabel}
              disabled={pending}
              onInput={(e) => followDraft(owner, e.currentTarget.value)}
            />
            <div className="rpu-askdock-row" data-voice={voice && mic.state !== "unavailable" ? "true" : undefined}>
              {voice && !speaking && mic.state !== "unavailable" ? (
                <div data-testid="ask-mic-section" data-state={mic.state} style={{ display: "contents" }}>
                  <MicButton mic={mic} locale={locale} disabled={pending} compact />
                </div>
              ) : null}
              <button type="submit" className="rpu-btn" data-variant="primary" data-testid="ask-send" disabled={pending} aria-busy={pending ? true : undefined}>
                <span>{ui.askThis}</span>
              </button>
            </div>
          </form>
        </div>
      </ActionDock>
    </div>
  );
}

export function AskSection({
  locale,
  mode = "today",
  initialTurns = [],
  aiOff = false,
  voice = false,
  example = false,
  autoSpeak = false,
}: {
  locale: UiLocale;
  mode?: "today" | "screen";
  initialTurns?: AskTurn[];
  /** mode "screen": he has not agreed to AI processing (the page reads his consent; Today's dock asks the history route) */
  aiOff?: boolean;
  /** mode "screen": a transcription service is connected, so the microphone is drawn (the page asks lib/safety/voice.ts) */
  voice?: boolean;
  /** mode "screen": the account runs on the example data, so the screen shows 「可以这样问」 */
  example?: boolean;
  /** mode "screen": he came through 「按一下说」 (/p/ask?speak=1): the screen opens listening */
  autoSpeak?: boolean;
}) {
  return mode === "screen" ? (
    <AskScreen locale={locale} initialTurns={initialTurns} aiOff={aiOff} voice={voice} example={example} autoSpeak={autoSpeak} />
  ) : (
    <TodayAsk locale={locale} example={example} />
  );
}
